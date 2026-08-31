/**
 * Profile download routes.
 *
 * Exports two routers:
 *  - vpnRouter   → mount at /api/vpn
 *      GET /profile        → .mobileconfig (IKEv2 + Root CA + client cert)
 *      GET /server-bundle  → server cert + key + CA (admin only, for strongSwan)
 *
 *  - certRouter   → mount at /api/certificate
 *      GET /               → Root CA certificate (.cer)
 */
const express = require('express');
const forge = require('node-forge');
const db = require('../db');
const config = require('../config');
const { authRequired } = require('../middleware/auth');
const certs = require('../utils/certificates');
const { buildMobileConfig } = require('../utils/mobileconfig');

// ── VPN router (mount at /api/vpn) ──
const vpnRouter = express.Router();

// GET /api/vpn/profile — download .mobileconfig
vpnRouter.get('/profile', authRequired, (req, res) => {
  const m = db.prepare('SELECT * FROM memberships WHERE user_id = ?').get(req.user.id);
  if (!m || !m.is_active) {
    return res.status(403).json({ error: '会员未激活，无法下载配置' });
  }
  if (m.expire_at && new Date(m.expire_at) < new Date()) {
    return res.status(403).json({ error: '会员已过期' });
  }

  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.id);
  const username = user ? user.username : 'user';

  const plist = buildMobileConfig({ username });

  res.setHeader('Content-Type', 'application/x-apple-aspen-config');
  res.setHeader('Content-Disposition', 'attachment; filename="wkt6-location.mobileconfig"');
  res.send(plist);
});

// GET /api/vpn/server-bundle — admin only: get server cert/key/CA for strongSwan
vpnRouter.get('/server-bundle', authRequired, (req, res) => {
  if (req.user.username !== config.admin.username) {
    return res.status(403).json({ error: '无权限' });
  }
  const bundle = certs.getServerCertBundle();
  res.json(bundle);
});

// ── Certificate router (mount at /api/certificate) ──
const certRouter = express.Router();

// GET /api/certificate — download Root CA certificate (.cer)
certRouter.get('/', authRequired, (req, res) => {
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
