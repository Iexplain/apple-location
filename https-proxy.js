/**
 * HTTPS reverse proxy for apple-location (port 8444).
 *
 * Replaces the Caddy instance because Caddy v2.10 on this host rejects
 * TLS handshakes from OpenSSL-based clients (curl/python/Safari all get
 * "tlsv1 alert internal error"). Node's OpenSSL-backed https server is
 * a drop-in replacement: terminates TLS with the project's self-signed
 * cert (SAN=IP) and proxies to the express app on 127.0.0.1:3000.
 *
 * Run via pm2: pm2 start https-proxy.js --name apple-location-https
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CERT_DIR = path.join(__dirname, 'conf', 'certs');

const server = https.createServer(
  {
    key: fs.readFileSync(path.join(CERT_DIR, 'server-key.pem')),
    cert: fs.readFileSync(path.join(CERT_DIR, 'server-cert.pem')),
  },
  (req, res) => {
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: 3000,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: '127.0.0.1:3000' },
      },
      (upRes) => {
        res.writeHead(upRes.statusCode, upRes.headers);
        upRes.pipe(res);
      }
    );
    upstream.on('error', () => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('bad gateway');
    });
    req.pipe(upstream);
  }
);

server.listen(8444, () => {
  console.log('[https-proxy] apple-location HTTPS listening on 8444');
});
