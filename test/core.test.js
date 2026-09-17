const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// Keep certificate/database tests isolated from a developer's real data.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-location-test-'));
process.env.DATA_DIR = dataDir;
process.env.VPN_SERVER_ADDRESS = '203.0.113.10';
process.env.VPN_REMOTE_ID = '203.0.113.10';
process.env.NODE_ENV = 'production';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'test-password-012345';
process.env.SERVER_BUNDLE_TOKEN = 'bundle-token-0123456789';

const config = require('../server/config');
const certs = require('../server/utils/certificates');
const { createBasicAuth, isDocumentationPlaceholder } = require('../server/utils/auth');
const { validateLocation } = require('../server/utils/location');
const { buildMobileConfig } = require('../server/utils/mobileconfig');
const { patchWlocFrame, _internals: wlocProtocol } = require('../server/utils/wloc-protocol');
const forge = require('node-forge');

function responseMock() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    body: null,
    setHeader(name, value) { headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('initializes an IP SAN server certificate and Apple WLOC certificate', () => {
  certs.initCertificates();

  const profile = buildMobileConfig();
  assert.match(profile, /<key>LocalIdentifier<\/key>\s*<string>apple-location-client<\/string>/);
  assert.doesNotMatch(profile, /<string>client@203\.0\.113\.10<\/string>/);

  const server = forge.pki.certificateFromPem(
    fs.readFileSync(certs.paths.SERVER_CERT_PATH, 'utf8'),
  );
  const wloc = forge.pki.certificateFromPem(
    fs.readFileSync(certs.paths.WLOC_CERT_PATH, 'utf8'),
  );
  const client = forge.pki.certificateFromPem(
    fs.readFileSync(certs.paths.CLIENT_CERT_PATH, 'utf8'),
  );
  const serverSAN = server.getExtension('subjectAltName').altNames;
  const wlocSAN = wloc.getExtension('subjectAltName').altNames;
  const clientSAN = client.getExtension('subjectAltName').altNames;
  const wlocLifetimeDays = (wloc.validity.notAfter - wloc.validity.notBefore) / 86400000;

  assert.ok(serverSAN.some((entry) => entry.type === 7 && entry.ip === '203.0.113.10'));
  for (const domain of certs.WLOC_DOMAINS) {
    assert.ok(wlocSAN.some((entry) => entry.type === 2 && entry.value === domain));
  }
  assert.ok(clientSAN.some((entry) => entry.type === 2 && entry.value === certs.CLIENT_CN));
  assert.ok(wlocLifetimeDays <= 398, `WLOC leaf lifetime is ${wlocLifetimeDays} days`);
  assert.equal(forge.pki.certificateFromPem(fs.readFileSync(certs.paths.CA_CERT_PATH, 'utf8'))
    .verify(server), true);
  assert.equal(forge.pki.certificateFromPem(fs.readFileSync(certs.paths.CA_CERT_PATH, 'utf8'))
    .verify(wloc), true);
});

test('does not replace an existing Root CA when its key is missing', () => {
  const original = fs.readFileSync(certs.paths.CA_CERT_PATH);
  fs.renameSync(certs.paths.CA_KEY_PATH, `${certs.paths.CA_KEY_PATH}.bak`);
  assert.throws(() => certs.initCertificates(), /Root CA 证书或私钥缺失/);
  fs.renameSync(`${certs.paths.CA_KEY_PATH}.bak`, certs.paths.CA_KEY_PATH);
  assert.deepEqual(fs.readFileSync(certs.paths.CA_CERT_PATH), original);
});

test('validates coordinate ranges and finite values', () => {
  assert.deepEqual(validateLocation({ latitude: 39.9, longitude: 116.4 }), {
    latitude: 39.9, longitude: 116.4, altitude: 0, accuracy: 65,
  });
  assert.match(validateLocation({ latitude: 91, longitude: 0 }).error, /纬度/);
  assert.match(validateLocation({ latitude: 0, longitude: -181 }).error, /经度/);
  assert.match(validateLocation({ latitude: 0, longitude: 0, accuracy: -1 }).error, /精度/);
  assert.match(validateLocation({ latitude: '39.9', longitude: 116.4 }).error, /有限数字/);
});

test('protects management routes with Basic Auth and the bundle with Bearer token', () => {
  const middleware = createBasicAuth({
    username: 'admin',
    password: 'test-password-012345',
    token: 'bundle-token-0123456789',
    production: true,
  });

  let nextCalled = false;
  const healthRes = responseMock();
  middleware({ method: 'GET', originalUrl: '/api/health' }, healthRes, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  const unauthorized = responseMock();
  middleware({ method: 'GET', originalUrl: '/api/location', get: () => '' }, unauthorized, () => {});
  assert.equal(unauthorized.statusCode, 401);

  const authorized = responseMock();
  middleware({
    method: 'GET',
    originalUrl: '/api/location',
    get(name) {
      return name.toLowerCase() === 'authorization'
        ? `Basic ${Buffer.from('admin:test-password-012345').toString('base64')}` : '';
    },
  }, authorized, () => { nextCalled = true; });
  assert.equal(authorized.statusCode, 200);

  const bundle = responseMock();
  middleware({
    method: 'GET',
    originalUrl: '/api/vpn/server-bundle',
    get(name) {
      return name.toLowerCase() === 'authorization' ? 'Bearer bundle-token-0123456789' : '';
    },
  }, bundle, () => { nextCalled = true; });
  assert.equal(bundle.statusCode, 200);

  let trailingSlashNextCalled = false;
  const trailingSlashBundle = responseMock();
  middleware({
    method: 'GET',
    originalUrl: '/api/vpn/server-bundle/',
    get(name) {
      return name.toLowerCase() === 'authorization'
        ? `Basic ${Buffer.from('admin:test-password-012345').toString('base64')}` : '';
    },
  }, trailingSlashBundle, () => { trailingSlashNextCalled = true; });
  assert.equal(trailingSlashBundle.statusCode, 401);
  assert.equal(trailingSlashBundle.headers['WWW-Authenticate'],
    'Bearer realm="Virtual Location server bundle"');
  assert.equal(trailingSlashNextCalled, false);
});

test('rejects production startup without a sufficiently long bundle token', () => {
  assert.throws(() => createBasicAuth({
    username: 'admin',
    password: 'test-password-012345',
    token: 'too-short',
    production: true,
  }), /SERVER_BUNDLE_TOKEN/);
});

test('rejects production startup without an explicit admin username', () => {
  assert.throws(() => createBasicAuth({
    username: '',
    password: 'test-password-012345',
    token: 'bundle-token-0123456789',
    production: true,
  }), /ADMIN_USERNAME/);
});

test('rejects documentation placeholder credentials in production', () => {
  assert.equal(isDocumentationPlaceholder('replace-with-private-admin-username'), true);
  assert.throws(() => createBasicAuth({
    username: 'replace-with-private-admin-username',
    password: 'replace-with-at-least-16-random-characters',
    token: 'replace-with-at-least-32-random-characters',
    production: true,
  }), /ADMIN_USERNAME/);
  assert.throws(() => createBasicAuth({
    username: 'private-operator',
    password: 'replace-with-at-least-16-random-characters',
    token: 'bundle-token-0123456789',
    production: true,
  }), /ADMIN_PASSWORD/);
  assert.throws(() => createBasicAuth({
    username: 'private-operator',
    password: 'test-password-012345',
    token: 'replace-with-at-least-32-random-characters',
    production: true,
  }), /SERVER_BUNDLE_TOKEN/);
});

test('uses the configured data directory and localhost WLOC listener defaults', () => {
  assert.equal(config.paths.data, path.resolve(dataDir));
  assert.equal(config.wlocHost, '127.0.0.1');
  assert.equal(config.wlocPort, 8445);
});

test('patches real framed protobuf WLOC responses without losing containers', () => {
  // Captured-format fixture from the public tuupola/corelocation protocol test.
  // It contains seven Wi-Fi containers and no device/user-specific information.
  const frame = Buffer.from(
    '0001000000010000016e12410a1162343a35643a35303a39343a33393a62'
    + '33122c088098f7f8bcffffffff01108098f7f8bcffffffff0118ffffffff'
    + 'ffffffffff0128ffffffffffffffffff0112300a1039383a313a61373a65'
    + '363a38353a3730121908a1fbf8911610b7cedd9c09182a20002811300c58'
    + '3c608201a8010612310a1137343a38353a32613a32663a34393a36611219'
    + '08beb0fa911610f7abe29c09182b2000280c300e583f60e108a801011230'
    + '0a10383a37363a66663a38363a33333a6335121908ddd9f7911610caede3'
    + '9c09182a2000280e300d583f609501a80106122f0a0f303a32323a373a36'
    + '343a31393a3439121908e5b7fa91161096a7e29c09182a2000280b301058'
    + '3f609b02a8010b122e0a0e65633a383a36623a34623a383a631219088484'
    + 'fb911610aaa8e39c09182a2000280d300e583f60ac02a8010412310a1133'
    + '633a38633a66383a38303a38363a6265121908eeb6f7911610a7a3e29c09'
    + '182e2000280d300d583f60a801a80102',
    'hex',
  );
  const target = { latitude: 31.2397, longitude: 121.4994, accuracy: 25 };
  const patched = patchWlocFrame(frame, target);

  assert.equal(patched.stats.wifi, 7);
  assert.equal(patched.stats.locations, 7);
  assert.equal(patched.body.readUInt16BE(8), patched.body.length - 10);

  const payloadFields = wlocProtocol.parseFields(patched.body.subarray(10));
  const wifiFields = payloadFields.filter((field) => field.fieldNo === 2 && field.wireType === 2);
  assert.equal(wifiFields.length, 7);
  for (const wifi of wifiFields) {
    const container = wlocProtocol.parseFields(wifi.value);
    const location = container.find((field) => field.fieldNo === 2 && field.wireType === 2);
    assert.ok(location);
    const coordinates = wlocProtocol.parseFields(location.value);
    const latitude = coordinates.find((field) => field.fieldNo === 1).value;
    const longitude = coordinates.find((field) => field.fieldNo === 2).value;
    const accuracy = coordinates.find((field) => field.fieldNo === 3).value;
    assert.equal(BigInt.asIntN(64, latitude), BigInt(Math.round(target.latitude * 1e8)));
    assert.equal(BigInt.asIntN(64, longitude), BigInt(Math.round(target.longitude * 1e8)));
    assert.equal(accuracy, 25n);
  }
});

test('covers current Apple and China-region WLOC TLS hostnames', () => {
  for (const hostname of [
    'gs-loc.apple.com',
    'gs-loc-cn.apple.com',
    'gsp-ssl.ls.apple.com',
    'bluedot.is.autonavi.com',
    'bluedot.is.autonavi.com.gds.alibabadns.com',
  ]) {
    assert.ok(certs.WLOC_DOMAINS.includes(hostname));
  }
});
