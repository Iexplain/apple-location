/**
 * Fake Apple Wi-Fi location API (wloc) — serves forged coordinates to iOS.
 *
 * iOS locationd resolves gs-loc.apple.com (DNS hijacked via dnsmasq to
 * 10.8.1.1), then POSTs a binary-plist request to /location/wloc on :443.
 * iptables DNAT forwards 10.8.1.1:443 → 127.0.0.1:8445 where this server
 * listens. Coordinates come from the location table (set on the web UI).
 *
 * Run via pm2: pm2 start server/wloc-server.js --name apple-location-wloc
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const bplistParser = require('bplist-parser');
const bplistCreator = require('bplist-creator');
const config = require('./config');

const db = new DatabaseSync(config.paths.db);

// Initialize database schema
db.exec(`
  DROP TABLE IF EXISTS location;
  CREATE TABLE location (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    latitude REAL NOT NULL DEFAULT 37.7749,
    longitude REAL NOT NULL DEFAULT -122.4194,
    altitude REAL NOT NULL DEFAULT 0,
    accuracy REAL NOT NULL DEFAULT 65,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO location (id, latitude, longitude, altitude, accuracy)
  VALUES (1, 37.7749, -122.4194, 0, 65);
`);

function getTargetLocation() {
  return db.prepare('SELECT latitude, longitude, altitude, accuracy FROM location WHERE id = 1').get();
}

const server = https.createServer(
  {
    key: fs.readFileSync(path.join(config.paths.keys, 'wloc-key.pem')),
    cert: fs.readFileSync(path.join(config.paths.certs, 'wloc-cert.pem')),
  },
  (req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/location/wloc')) {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks);
          // bplist-parser 0.3.x parseBuffer is SYNCHRONOUS (returns array).
          // Passing a callback silently ignores it and the request hangs.
          const objs = bplistParser.parseBuffer(body);
          const reqObj = (objs && objs[0]) || {};
          const aps = Array.isArray(reqObj.ap) ? reqObj.ap : [];
          const loc = getTargetLocation();
          const apResp = aps.map((ap) => ({
            key: ap.key || '',
            latitude: loc.latitude,
            longitude: loc.longitude,
            accuracy: Math.round(loc.accuracy || 65),
            altitude: Math.round(loc.altitude || 0),
          }));
          const resp = { ap: apResp, statusCode: 0 };
          res.writeHead(200, { 'Content-Type': 'application/x-www-form-urlencoded' });
          res.end(bplistCreator(resp));
          console.log(`[wloc] answered ${aps.length} APs → ${loc.latitude},${loc.longitude}`);
        } catch (e) {
          console.error('[wloc] error:', e.message);
          res.writeHead(500);
          res.end();
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  }
);

server.listen(8445, '0.0.0.0', () => {
  console.log('[wloc] fake location API listening on 0.0.0.0:8445 (DNAT from 10.8.1.1:443)');
});
