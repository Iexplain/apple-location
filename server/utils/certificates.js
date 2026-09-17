/**
 * Certificate Authority & server/client certificate management.
 *
 * Key generation uses Node.js native crypto (OpenSSL-backed, ~10ms per key).
 * Certificate creation/signing uses node-forge.
 *
 *  1. Generate a self-signed Root CA (cached on disk)
 *  2. Issue a server certificate for the VPN endpoint
 *  3. Issue a client certificate (embedded in .mobileconfig)
 *  4. Issue a WLOC certificate for the DNS-hijacked Apple endpoints
 *  5. Package client cert + key into PKCS12
 *
 * Certificates are generated once and cached in server/data/certs.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const forge = require('node-forge');
const config = require('../config');

const CERTS_DIR = config.paths.certs;
const KEYS_DIR = config.paths.keys;

const CA_CERT_PATH = path.join(CERTS_DIR, 'ca-cert.pem');
const CA_KEY_PATH = path.join(KEYS_DIR, 'ca-key.pem');
const SERVER_CERT_PATH = path.join(CERTS_DIR, 'server-cert.pem');
const SERVER_KEY_PATH = path.join(KEYS_DIR, 'server-key.pem');
const CLIENT_CERT_PATH = path.join(CERTS_DIR, 'client-cert.pem');
const CLIENT_KEY_PATH = path.join(KEYS_DIR, 'client-key.pem');
const WLOC_CERT_PATH = path.join(CERTS_DIR, 'wloc-cert.pem');
const WLOC_KEY_PATH = path.join(KEYS_DIR, 'wloc-key.pem');

const CA_CN = 'Virtual Location Root CA';
const CLIENT_CN = 'apple-location-client';
// Modern Apple TLS clients enforce a short lifetime for server leaf
// certificates.  Keep the private WLOC leaf within the 398-day limit while
// leaving the long-lived Root CA untouched.
const WLOC_VALIDITY_DAYS = 397;
const WLOC_DOMAINS = [
  'gs-loc.apple.com',
  'gs-loc-new.apple.com',
  'gs-loc-cn.apple.com',
  'gsp-ssl.ls.apple.com',
  'bluedot.is.autonavi.com',
  'bluedot.is.autonavi.com.gds.alibabadns.com',
];

/**
 * Generate a key pair + certificate.
 *
 * Key pairs are generated via Node.js native crypto (fast OpenSSL),
 * then imported into node-forge for certificate creation.
 *
 * @param {object} opts - subject info, issuer cert (for signing), isCA
 * @returns {{cert, key}} forge cert and key objects
 */
function generateCertificate(opts) {
  // Fast RSA key generation via native OpenSSL
  const { privateKey: privPem, publicKey: pubPem } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // Import into node-forge format for certificate signing
  const forgePrivateKey = forge.pki.privateKeyFromPem(privPem);
  const forgePublicKey = forge.pki.publicKeyFromPem(pubPem);

  const cert = forge.pki.createCertificate();
  cert.publicKey = forgePublicKey;
  const serial = crypto.randomBytes(16);
  serial[0] &= 0x7f; // X.509 serial numbers must be positive.
  cert.serialNumber = serial.toString('hex');

  const notBefore = new Date();
  notBefore.setMinutes(notBefore.getMinutes() - 5);
  const notAfter = new Date();
  notAfter.setDate(notAfter.getDate() + (opts.validityDays || config.cert.validityDays));

  cert.validity.notBefore = notBefore;
  cert.validity.notAfter = notAfter;

  const attrs = [
    { name: 'commonName', value: opts.commonName },
    { name: 'organizationName', value: opts.organization || config.cert.organization },
    { name: 'organizationalUnitName', value: opts.organizationalUnit || config.cert.organizationalUnit },
    { name: 'countryName', value: config.cert.country },
    { name: 'stateOrProvinceName', value: config.cert.state },
    { name: 'localityName', value: config.cert.locality },
  ];

  cert.setSubject(attrs);

  if (opts.isCA) {
    cert.setIssuer(attrs); // self-signed
    cert.setExtensions([
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
      { name: 'subjectKeyIdentifier' },
    ]);
    cert.sign(forgePrivateKey, forge.md.sha256.create());
  } else {
    cert.setIssuer(opts.issuerCert.subject.attributes);
    const exts = [
      { name: 'basicConstraints', cA: false },
      {
        name: 'keyUsage',
        digitalSignature: true,
        keyEncipherment: true,
      },
      { name: 'extKeyUsage', serverAuth: opts.isServer, clientAuth: !opts.isServer },
      { name: 'subjectAltName', altNames: opts.altNames || [] },
      {
        name: 'authorityKeyIdentifier',
        keyIdentifier: opts.issuerCert.generateSubjectKeyIdentifier().getBytes(),
      },
      { name: 'subjectKeyIdentifier' },
    ];
    cert.setExtensions(exts);
    cert.sign(opts.issuerKey, forge.md.sha256.create());
  }

  return { cert, key: forgePrivateKey };
}

function serverAddressAltName(address) {
  return net.isIP(address) ? { type: 7, ip: address } : { type: 2, value: address };
}

function writeCertificatePair(certPath, keyPath, cert, key) {
  fs.writeFileSync(certPath, forge.pki.certificateToPem(cert), { mode: 0o644 });
  fs.writeFileSync(keyPath, forge.pki.privateKeyToPem(key), { mode: 0o600 });
  fs.chmodSync(keyPath, 0o600);
}

function certMatchesKey(cert, key) {
  return cert.publicKey.n.compareTo(key.n) === 0 && cert.publicKey.e.compareTo(key.e) === 0;
}

function readValidPair(certPath, keyPath, issuerCert) {
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) return null;
  try {
    const cert = forge.pki.certificateFromPem(fs.readFileSync(certPath, 'utf8'));
    const key = forge.pki.privateKeyFromPem(fs.readFileSync(keyPath, 'utf8'));
    const now = new Date();
    if (!certMatchesKey(cert, key)
        || cert.validity.notBefore > now
        || cert.validity.notAfter <= now
        || (issuerCert && !issuerCert.verify(cert))) return null;
    return { cert, key };
  } catch (_) {
    return null;
  }
}

function hasServerAddressSAN(certPath, address) {
  try {
    const cert = forge.pki.certificateFromPem(fs.readFileSync(certPath, 'utf8'));
    const ext = cert.getExtension('subjectAltName');
    const expectedType = net.isIP(address) ? 7 : 2;
    return Boolean(ext && ext.altNames && ext.altNames.some((alt) => {
      const value = alt.type === 7 ? alt.ip : alt.value;
      return alt.type === expectedType && value === address;
    }));
  } catch (_) {
    return false;
  }
}

function hasExpectedCommonName(certPath, commonName) {
  try {
    const cert = forge.pki.certificateFromPem(fs.readFileSync(certPath, 'utf8'));
    return cert.subject.attributes.some((attr) => attr.name === 'commonName' && attr.value === commonName);
  } catch (_) {
    return false;
  }
}

function hasWlocSANs(certPath) {
  try {
    const cert = forge.pki.certificateFromPem(fs.readFileSync(certPath, 'utf8'));
    const ext = cert.getExtension('subjectAltName');
    const names = new Set((ext && ext.altNames || [])
      .filter((alt) => alt.type === 2)
      .map((alt) => alt.value));
    return WLOC_DOMAINS.every((domain) => names.has(domain));
  } catch (_) {
    return false;
  }
}

function hasAppleCompatibleTlsLifetime(certPath) {
  try {
    const cert = forge.pki.certificateFromPem(fs.readFileSync(certPath, 'utf8'));
    const lifetimeMs = cert.validity.notAfter.getTime() - cert.validity.notBefore.getTime();
    return lifetimeMs <= 398 * 24 * 60 * 60 * 1000;
  } catch (_) {
    return false;
  }
}

function hasClientSAN(certPath) {
  try {
    const cert = forge.pki.certificateFromPem(fs.readFileSync(certPath, 'utf8'));
    const ext = cert.getExtension('subjectAltName');
    return Boolean(ext && ext.altNames && ext.altNames.some(
      (alt) => alt.type === 2 && alt.value === CLIENT_CN,
    ));
  } catch (_) {
    return false;
  }
}

/** Initialize all certificates if they don't exist yet */
function initCertificates() {
  const caCertExists = fs.existsSync(CA_CERT_PATH);
  const caKeyExists = fs.existsSync(CA_KEY_PATH);

  if (caCertExists !== caKeyExists) {
    throw new Error('Root CA 证书或私钥缺失；请从备份恢复，服务不会自动替换现有 CA');
  }

  let caCert, caKey;

  if (!caCertExists) {
    console.log('[certs] Generating Root CA...');
    const ca = generateCertificate({
      commonName: CA_CN,
      isCA: true,
    });
    writeCertificatePair(CA_CERT_PATH, CA_KEY_PATH, ca.cert, ca.key);
    caCert = ca.cert;
    caKey = ca.key;
    console.log('[certs] Root CA generated.');
  } else {
    const ca = readValidPair(CA_CERT_PATH, CA_KEY_PATH);
    if (!ca || !ca.cert.verify(ca.cert)) {
      throw new Error('Root CA 证书无效或与私钥不匹配；请从备份恢复');
    }
    caCert = ca.cert;
    caKey = ca.key;
    fs.chmodSync(CA_KEY_PATH, 0o600);
  }

  // Server cert
  if (!readValidPair(SERVER_CERT_PATH, SERVER_KEY_PATH, caCert)
      || !hasServerAddressSAN(SERVER_CERT_PATH, config.vpn.serverAddress)
      || !hasExpectedCommonName(SERVER_CERT_PATH, config.vpn.serverAddress)) {
    console.log('[certs] Generating server certificate...');
    const server = generateCertificate({
      commonName: config.vpn.serverAddress,
      isServer: true,
      issuerCert: caCert,
      issuerKey: caKey,
      altNames: [serverAddressAltName(config.vpn.serverAddress)],
    });
    writeCertificatePair(SERVER_CERT_PATH, SERVER_KEY_PATH, server.cert, server.key);
    console.log('[certs] Server certificate generated.');
  }

  // Client cert
  if (!readValidPair(CLIENT_CERT_PATH, CLIENT_KEY_PATH, caCert) || !hasClientSAN(CLIENT_CERT_PATH)) {
    console.log('[certs] Generating client certificate...');
    const client = generateCertificate({
      commonName: CLIENT_CN,
      isServer: false,
      issuerCert: caCert,
      issuerKey: caKey,
      altNames: [{ type: 2, value: CLIENT_CN }],
    });
    writeCertificatePair(CLIENT_CERT_PATH, CLIENT_KEY_PATH, client.cert, client.key);
    console.log('[certs] Client certificate generated.');
  }

  // WLOC certificate must cover the Apple endpoints redirected by dnsmasq.
  if (!readValidPair(WLOC_CERT_PATH, WLOC_KEY_PATH, caCert)
      || !hasWlocSANs(WLOC_CERT_PATH)
      || !hasAppleCompatibleTlsLifetime(WLOC_CERT_PATH)
      || !hasExpectedCommonName(WLOC_CERT_PATH, WLOC_DOMAINS[0])) {
    console.log('[certs] Generating WLOC certificate...');
    const wloc = generateCertificate({
      commonName: WLOC_DOMAINS[0],
      isServer: true,
      issuerCert: caCert,
      issuerKey: caKey,
      validityDays: WLOC_VALIDITY_DAYS,
      altNames: WLOC_DOMAINS.map((domain) => ({ type: 2, value: domain })),
    });
    writeCertificatePair(WLOC_CERT_PATH, WLOC_KEY_PATH, wloc.cert, wloc.key);
    console.log('[certs] WLOC certificate generated.');
  } else {
    fs.chmodSync(WLOC_KEY_PATH, 0o600);
  }
  fs.chmodSync(SERVER_KEY_PATH, 0o600);
  fs.chmodSync(CLIENT_KEY_PATH, 0o600);
}

/** Get the CA certificate in PEM format */
function getCACertPEM() {
  return fs.readFileSync(CA_CERT_PATH, 'utf8');
}

/** Get the CA certificate in DER (base64) format for plist <data> */
function getCACertDERBase64() {
  const pem = getCACertPEM();
  const cert = forge.pki.certificateFromPem(pem);
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return Buffer.from(der, 'binary').toString('base64');
}

/**
 * Get client cert + key as PKCS12 in base64.
 * @param {string} password - PKCS12 protection password
 */
function getClientPKCS12Base64(password) {
  const certPem = fs.readFileSync(CLIENT_CERT_PATH, 'utf8');
  const keyPem = fs.readFileSync(CLIENT_KEY_PATH, 'utf8');

  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);

  // Only include client cert + key, not CA (CA is separate in mobileconfig)
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    key,
    [cert],
    password,
    {
      algorithm: '3des',
      count: 2048,
      generateLocalKeyId: true,
      friendlyName: 'VPN Client'
    }
  );

  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  return Buffer.from(p12Der, 'binary').toString('base64');
}

/**
 * Get server cert + key + CA for strongSwan deployment.
 * Returns an object with PEM strings.
 */
function getServerCertBundle() {
  return {
    serverCert: fs.readFileSync(SERVER_CERT_PATH, 'utf8'),
    serverKey: fs.readFileSync(SERVER_KEY_PATH, 'utf8'),
    caCert: getCACertPEM(),
  };
}

module.exports = {
  initCertificates,
  getCACertPEM,
  getCACertDERBase64,
  getClientPKCS12Base64,
  getServerCertBundle,
  CA_CN,
  CLIENT_CN,
  paths: {
    CA_CERT_PATH,
    CA_KEY_PATH,
    SERVER_CERT_PATH,
    SERVER_KEY_PATH,
    CLIENT_CERT_PATH,
    CLIENT_KEY_PATH,
    WLOC_CERT_PATH,
    WLOC_KEY_PATH,
  },
  WLOC_DOMAINS,
};
