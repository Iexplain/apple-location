/**
 * apple-location — all-in-one server.
 *
 * Starts three listeners in one process:
 *  :3000  HTTP  — Express REST API + static frontend
 *  :8444  HTTPS — reverse proxy to :3000 (for iOS mobileconfig download)
 *  :8445  HTTPS — fake Apple wloc API (DNS-hijacked gs-loc.apple.com)
 */
const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const certs = require('./utils/certificates');
const db = require('./db');
const bplistParser = require('bplist-parser');
const bplistCreator = require('bplist-creator');

// ── Certificates ──────────────────────────────────────────────────────────────
certs.initCertificates();

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const profileRoutes = require('./routes/profile');
app.use('/api/location', require('./routes/location'));
app.use('/api/favorites', require('./routes/favorites'));
app.use('/api/vpn', profileRoutes);
app.use('/api/certificate', profileRoutes.certRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use(express.static(config.paths.public));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(config.paths.public, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: '服务器内部错误' });
});

// ── :3000 HTTP ────────────────────────────────────────────────────────────────
const httpServer = app.listen(config.port, () => {
  console.log(`[http]  listening on :${config.port}`);
});

// ── :8444 HTTPS reverse proxy → :3000 ────────────────────────────────────────
function startHttpsProxy() {
  const certDir = path.join(__dirname, '..', 'conf', 'certs');
  const keyPath  = path.join(certDir, 'server-key.pem');
  const certPath = path.join(certDir, 'server-cert.pem');

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.warn('[https-proxy] cert not found at conf/certs — skipping :8444');
    return;
  }

  const tlsOpts = {
    key:  fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };

  https.createServer(tlsOpts, (req, res) => {
    const upstream = http.request(
      { host: '127.0.0.1', port: config.port, path: req.url,
        method: req.method, headers: { ...req.headers, host: `127.0.0.1:${config.port}` } },
      (upRes) => { res.writeHead(upRes.statusCode, upRes.headers); upRes.pipe(res); }
    );
    upstream.on('error', () => { res.writeHead(502); res.end('bad gateway'); });
    req.pipe(upstream);
  }).listen(8444, () => console.log('[https-proxy] listening on :8444'));
}

startHttpsProxy();

// ── :8445 HTTPS fake Apple wloc API ──────────────────────────────────────────
function startWlocServer() {
  const keyPath  = path.join(config.paths.keys,  'wloc-key.pem');
  const certPath = path.join(config.paths.certs, 'wloc-cert.pem');

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.warn('[wloc] cert not found — skipping :8445');
    return;
  }

  const tlsOpts = {
    key:  fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };

  function getLocation() {
    return db.prepare(
      'SELECT latitude, longitude, altitude, accuracy FROM location WHERE id = 1'
    ).get();
  }

  https.createServer(tlsOpts, (req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/location/wloc')) {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const objs   = bplistParser.parseBuffer(Buffer.concat(chunks));
          const reqObj = (objs && objs[0]) || {};
          const aps    = Array.isArray(reqObj.ap) ? reqObj.ap : [];
          const loc    = getLocation();
          const resp   = {
            ap: aps.map(ap => ({
              key:      ap.key || '',
              latitude: loc.latitude,
              longitude:loc.longitude,
              accuracy: Math.round(loc.accuracy || 65),
              altitude: Math.round(loc.altitude  || 0),
            })),
            statusCode: 0,
          };
          res.writeHead(200, { 'Content-Type': 'application/x-www-form-urlencoded' });
          res.end(bplistCreator(resp));
          console.log(`[wloc] → ${loc.latitude},${loc.longitude} (${aps.length} APs)`);
        } catch (e) {
          console.error('[wloc] error:', e.message);
          res.writeHead(500); res.end();
        }
      });
    } else {
      res.writeHead(404); res.end();
    }
  }).listen(8445, () => console.log('[wloc] listening on :8445 (DNAT from 10.8.1.1:443)'));
}

startWlocServer();

// ── 启动日志 ───────────────────────────────────────────────────────────────────
console.log(`\n  ╔══════════════════════════════════════╗`);
console.log(`  ║  Virtual Location - Started          ║`);
console.log(`  ╠══════════════════════════════════════╣`);
console.log(`  ║  HTTP : http://localhost:${config.port}           ║`);
console.log(`  ║  HTTPS: https://localhost:8444         ║`);
console.log(`  ║  WLOC : https://localhost:8445         ║`);
console.log(`  ╚══════════════════════════════════════╝\n`);

// ── 优雅关闭 ───────────────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n[${signal}] 正在关闭服务器...`);
  httpServer.close(() => { console.log('HTTP 已关闭。'); process.exit(0); });
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
