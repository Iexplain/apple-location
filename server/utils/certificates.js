/**
 * Certificate Authority & server/client certificate management.
 *
 * Key generation uses Node.js native crypto (OpenSSL-backed, ~10ms per key).
 * Certificate creation/signing uses node-forge.
 *
 *  1. Generate a self-signed Root CA (cached on disk)
 *  2. Issue a server certificate for the VPN endpoint
 *  3. Issue a client certificate (embedded in .mobileconfig)
 *  4. Package client cert + key into PKCS12
 *
 * Certificates are generated once and cached in server/data/certs.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

const CA_CN = 'WKT6-2 Root CA';

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
  cert.serialNumber = (Math.random() * 1e16).toFixed(0).padStart(16, '0');

  const notBefore = new Date();
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
      { name: 'keyUsage', keyCertSign: true, digitalSignature: true, critical: true },
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
      { name: 'subjectKeyIdentifier' },
    ];
    cert.setExtensions(exts);
    cert.sign(opts.issuerKey, forge.md.sha256.create());
  }

  return { cert, key: forgePrivateKey };
}

/** Initialize all certificates if they don't exist yet */
function initCertificates() {
  const caExists = fs.existsSync(CA_CERT_PATH) && fs.existsSync(CA_KEY_PATH);

  let caCert, caKey;

  if (!caExists) {
    console.log('[certs] Generating Root CA...');
    const ca = generateCertificate({
      commonName: CA_CN,
      isCA: true,
    });
    fs.writeFileSync(CA_CERT_PATH, forge.pki.certificateToPem(ca.cert));
    fs.writeFileSync(CA_KEY_PATH, forge.pki.privateKeyToPem(ca.key));
    caCert = ca.cert;
    caKey = ca.key;
    console.log('[certs] Root CA generated.');
  } else {
    caCert = forge.pki.certificateFromPem(fs.readFileSync(CA_CERT_PATH, 'utf8'));
    caKey = forge.pki.privateKeyFromPem(fs.readFileSync(CA_KEY_PATH, 'utf8'));
  }

  // Server cert
  if (!fs.existsSync(SERVER_CERT_PATH) || !fs.existsSync(SERVER_KEY_PATH)) {
    console.log('[certs] Generating server certificate...');
    const server = generateCertificate({
      commonName: config.vpn.serverAddress,
      isServer: true,
      issuerCert: caCert,
      issuerKey: caKey,
      altNames: [{ type: 2, value: config.vpn.serverAddress }],
    });
    fs.writeFileSync(SERVER_CERT_PATH, forge.pki.certificateToPem(server.cert));
    fs.writeFileSync(SERVER_KEY_PATH, forge.pki.privateKeyToPem(server.key));
    console.log('[certs] Server certificate generated.');
  }

  // Client cert
  if (!fs.existsSync(CLIENT_CERT_PATH) || !fs.existsSync(CLIENT_KEY_PATH)) {
    console.log('[certs] Generating client certificate...');
    const client = generateCertificate({
      commonName: 'apple-location-client',
      isServer: false,
      issuerCert: caCert,
      issuerKey: caKey,
    });
    fs.writeFileSync(CLIENT_CERT_PATH, forge.pki.certificateToPem(client.cert));
    fs.writeFileSync(CLIENT_KEY_PATH, forge.pki.privateKeyToPem(client.key));
    console.log('[certs] Client certificate generated.');
  }
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
  const caPem = getCACertPEM();

  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);
  const caCert = forge.pki.certificateFromPem(caPem);

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    key,
    [cert, caCert],
    password,
    { generateLocalKeyId: true, algorithm: 'aes256' }
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
  paths: {
    CA_CERT_PATH,
    CA_KEY_PATH,
    SERVER_CERT_PATH,
    SERVER_KEY_PATH,
    CLIENT_CERT_PATH,
    CLIENT_KEY_PATH,
  },
};
