/**
 * Server configuration — personal single-user mode.
 * IP-only deployment with single-user HTTP Basic authentication.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));

function port(name, fallback) {
  if (process.env[name] === undefined || process.env[name] === '') return fallback;
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(`${name} must be an integer between 0 and 65535`);
  }
  return value;
}

const config = {
  port: port('PORT', 3000),
  httpsPort: port('HTTPS_PORT', 8444),
  wlocPort: port('WLOC_PORT', 8445),
  httpHost: process.env.HTTP_HOST || '127.0.0.1',
  httpsHost: process.env.HTTPS_HOST || '0.0.0.0',
  wlocHost: '127.0.0.1',
  corsOrigin: process.env.CORS_ORIGIN || false,
  serverBundleToken: process.env.SERVER_BUNDLE_TOKEN || '',
  auth: {
    username: process.env.ADMIN_USERNAME || '',
    password: process.env.ADMIN_PASSWORD || '',
    production: process.env.NODE_ENV === 'production',
  },

  vpn: {
    serverAddress: process.env.VPN_SERVER_ADDRESS || 'vpn.example.com',
    remoteId: process.env.VPN_REMOTE_ID || process.env.VPN_SERVER_ADDRESS || 'vpn.example.com',
  },

  cert: {
    organization: process.env.CERT_ORGANIZATION || 'Virtual Location',
    organizationalUnit: process.env.CERT_ORGANIZATIONAL_UNIT || 'iOS Services',
    country: process.env.CERT_COUNTRY || 'CN',
    state: process.env.CERT_STATE || 'Beijing',
    locality: process.env.CERT_LOCALITY || 'Beijing',
    validityDays: parseInt(process.env.CERT_VALIDITY_DAYS, 10) || 3650,
  },

  paths: {
    root: path.join(__dirname, '..'),
    data: dataDir,
    certs: path.join(dataDir, 'certs'),
    keys: path.join(dataDir, 'keys'),
    db: path.join(dataDir, 'app.db'),
    public: path.join(__dirname, '..', 'public'),
    httpsCert: path.join(dataDir, 'certs', 'server-cert.pem'),
    httpsKey: path.join(dataDir, 'keys', 'server-key.pem'),
    wlocCert: path.join(dataDir, 'certs', 'wloc-cert.pem'),
    wlocKey: path.join(dataDir, 'keys', 'wloc-key.pem'),
  },
};

function ensureDirs() {
  for (const dir of [config.paths.data, config.paths.certs, config.paths.keys]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

ensureDirs();

module.exports = config;
