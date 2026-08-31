/**
 * Profile download routes — no auth, direct download.
 *
 *  vpnRouter → mount at /api/vpn
 *      GET /profile        → .mobileconfig (IKEv2 + Root CA + client cert)
 *      GET /server-bundle  → server cert + key + CA (for strongSwan)
 *
 *  certRouter → mount at /api/certificate
 *      GET /               → Root CA certificate (.cer)
 */
const express = require('express');
const forge = require('node-forge');
const certs = require('../utils/certificates');
const { buildMobileConfig } = require('../utils/mobileconfig');

// ── VPN router ──
const vpnRouter = express.Router();

// GET /api/vpn/profile — download .mobileconfig
vpnRouter.get('/profile', (req, res) => {
  const plist = buildMobileConfig();
  res.setHeader('Content-Type', 'application/x-apple-aspen-config');
  res.setHeader('Content-Disposition', 'attachment; filename="wkt6-location.mobileconfig"');
  res.send(plist);
});

// GET /api/vpn/server-bundle — get server cert/key/CA for strongSwan
vpnRouter.get('/server-bundle', (req, res) => {
  const bundle = certs.getServerCertBundle();
  res.json(bundle);
});

// ── Certificate router ──
const certRouter = express.Router();

// GET /api/certificate — download Root CA .cer
certRouter.get('/', (req, res) => {
  const pem = certs.getCACertPEM();
  const cert = forge.pki.certificateFromPem(pem);
  const der = Buffer.from(
    forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),
    'binary'
  );

  res.setHeader('Content-Type', 'application/x-x509-ca-cert');
  res.setHeader('Content-Disposition', 'attachment; filename="wkt6-root-ca.cer"');
  res.send(der);
});

module.exports = vpnRouter;
module.exports.certRouter = certRouter;
