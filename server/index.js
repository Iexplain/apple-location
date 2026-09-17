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
const { createBasicAuth } = require('./utils/auth');
const db = require('./db');
const { createWlocHandler } = require('./utils/wloc-handler');

const httpsServers = [];
let wlocReady = false;

// ── Certificates ──────────────────────────────────────────────────────────────
certs.initCertificates();

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
if (config.corsOrigin) app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: true, limit: '32kb' }));

// The web UI and API are private except for the non-sensitive health endpoint.
// WLOC is a separate localhost-only HTTPS listener and is not affected.
app.use(createBasicAuth({ ...config.auth, token: config.serverBundleToken }));

const profileRoutes = require('./routes/profile');
app.use('/api/location', require('./routes/location'));
app.use('/api/favorites', require('./routes/favorites'));
app.use('/api/vpn', profileRoutes);
app.use('/api/certificate', profileRoutes.certRouter);

app.get('/api/health', (req, res) => {
  const status = wlocReady ? 'ok' : 'degraded';
  res.status(wlocReady ? 200 : 503).json({
    status,
    wloc: wlocReady,
    time: new Date().toISOString(),
  });
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
const httpServer = app.listen(config.port, config.httpHost, () => {
  console.log(`[http]  listening on ${config.httpHost}:${config.port}`);
});

// ── :8444 HTTPS reverse proxy → :3000 ────────────────────────────────────────
function startHttpsProxy() {
  const keyPath = config.paths.httpsKey;
  const certPath = config.paths.httpsCert;

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.warn('[https-proxy] HTTPS certificate not found — skipping HTTPS listener');
    return;
  }

  const tlsOpts = {
    key:  fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };

  const server = https.createServer(tlsOpts, (req, res) => {
    const upstream = http.request(
      { host: '127.0.0.1', port: config.port, path: req.url,
        method: req.method, headers: { ...req.headers, host: `127.0.0.1:${config.port}` } },
      (upRes) => { res.writeHead(upRes.statusCode, upRes.headers); upRes.pipe(res); }
    );
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('bad gateway'); });
    req.pipe(upstream);
  });
  httpsServers.push(server);
  server.on('error', (error) => console.error(`[https-proxy] listener error: ${error.message}`));
  server.listen(config.httpsPort, config.httpsHost, () => console.log(`[https-proxy] listening on ${config.httpsHost}:${config.httpsPort}`));
}

startHttpsProxy();

// ── :8445 HTTPS fake Apple wloc API ──────────────────────────────────────────
function startWlocServer() {
  const keyPath = config.paths.wlocKey;
  const certPath = config.paths.wlocCert;

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.error('[wloc] certificate not found — WLOC listener is unavailable');
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

  const server = https.createServer(tlsOpts, createWlocHandler({ getLocation }));
  httpsServers.push(server);
  server.on('tlsClientError', (error, socket) => {
    const sni = socket && socket.servername ? socket.servername : '(unknown SNI)';
    console.error(`[wloc] TLS client error for ${sni}: ${error.message}`);
  });
  server.on('error', (error) => {
    wlocReady = false;
    console.error(`[wloc] listener error: ${error.message}`);
  });
  server.listen(config.wlocPort, '127.0.0.1', () => {
    wlocReady = true;
    console.log(`[wloc] listening on 127.0.0.1:${config.wlocPort} (DNAT from 10.8.1.1:443)`);
  });
}

startWlocServer();

// ── 启动日志 ───────────────────────────────────────────────────────────────────
console.log(`\n  ╔══════════════════════════════════════╗`);
console.log(`  ║  Virtual Location - Started          ║`);
console.log(`  ╠══════════════════════════════════════╣`);
console.log(`  ║  HTTP : http://${config.httpHost}:${config.port}           ║`);
console.log(`  ║  HTTPS: https://localhost:${config.httpsPort}         ║`);
console.log(`  ║  WLOC : https://127.0.0.1:${config.wlocPort}         ║`);
console.log(`  ╚══════════════════════════════════════╝\n`);

// ── 优雅关闭 ───────────────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n[${signal}] 正在关闭服务器...`);
  const servers = [httpServer, ...httpsServers].filter((server) => server.listening);
  let remaining = servers.length;
  const done = () => {
    remaining -= 1;
    if (remaining <= 0) process.exit(0);
  };
  if (!remaining) process.exit(0);
  servers.forEach((server) => server.close(done));
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
