/**
 * Fake Apple Wi-Fi location API (wloc) — serves forged coordinates to iOS.
 *
 * iOS locationd resolves an Apple/AutoNavi WLOC endpoint (DNS hijacked via
 * dnsmasq to 10.8.1.1), then POSTs a framed protobuf request to /clls/wloc.
 * iptables DNAT forwards 10.8.1.1:443 → 127.0.0.1:8445 where this server
 * listens. Coordinates come from the location table (set on the web UI).
 *
 * `server/index.js` starts this listener in the normal single-process setup.
 * Run this file separately only for a dedicated WLOC process; do not run both
 * listeners on the same port.
 */
const https = require('https');
const fs = require('fs');
const config = require('./config');
const certs = require('./utils/certificates');
const db = require('./db');
const { createWlocHandler } = require('./utils/wloc-handler');

certs.initCertificates();

function getTargetLocation() {
  return db.prepare('SELECT latitude, longitude, altitude, accuracy FROM location WHERE id = 1').get();
}

const server = https.createServer(
  {
    key: fs.readFileSync(config.paths.wlocKey),
    cert: fs.readFileSync(config.paths.wlocCert),
  },
  createWlocHandler({ getLocation: getTargetLocation })
);

server.on('tlsClientError', (error, socket) => {
  const sni = socket && socket.servername ? socket.servername : '(unknown SNI)';
  console.error(`[wloc] TLS client error for ${sni}: ${error.message}`);
});

server.listen(config.wlocPort, '127.0.0.1', () => {
  console.log(`[wloc] fake location API listening on 127.0.0.1:${config.wlocPort} (DNAT from 10.8.1.1:443)`);
});
