/**
 * Server configuration
 * Reads from environment variables with sensible defaults.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    expiresIn: '7d',
  },

  vpn: {
    serverAddress: process.env.VPN_SERVER_ADDRESS || 'vpn.example.com',
    remoteId: process.env.VPN_REMOTE_ID || process.env.VPN_SERVER_ADDRESS || 'vpn.example.com',
  },

  cert: {
    organization: process.env.CERT_ORGANIZATION || 'Apple Location',
    organizationalUnit: process.env.CERT_ORGANIZATIONAL_UNIT || 'iPhone Location Services',
    country: process.env.CERT_COUNTRY || 'CN',
    state: process.env.CERT_STATE || 'Beijing',
    locality: process.env.CERT_LOCALITY || 'Beijing',
    validityDays: parseInt(process.env.CERT_VALIDITY_DAYS, 10) || 3650,
  },

  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },

  paths: {
    root: path.join(__dirname, '..'),
    data: path.join(__dirname, 'data'),
    certs: path.join(__dirname, 'data', 'certs'),
    keys: path.join(__dirname, 'data', 'keys'),
    db: path.join(__dirname, 'data', 'app.db'),
    public: path.join(__dirname, '..', 'public'),
  },
};

/** Ensure required directories exist */
function ensureDirs() {
  const dirs = [
    config.paths.data,
    config.paths.certs,
    config.paths.keys,
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

ensureDirs();

module.exports = config;
