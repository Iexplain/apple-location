/**
 * Express server — personal single-user mode, no auth.
 *
 * Serves:
 *  - Static frontend from /public
 *  - REST API from /api/*
 *  - Certificate initialization on startup
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const certs = require('./utils/certificates');

certs.initCertificates();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- API routes ---
const profileRoutes = require('./routes/profile');
app.use('/api/location', require('./routes/location'));
app.use('/api/favorites', require('./routes/favorites'));
app.use('/api/vpn', profileRoutes);
app.use('/api/certificate', profileRoutes.certRouter);

// --- Health check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// --- Static frontend ---
app.use(express.static(config.paths.public));

// SPA fallback
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

app.listen(config.port, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║  WKT6 定位 2 - Server Started         ║`);
  console.log(`  ╠══════════════════════════════════════╣`);
  console.log(`  ║  URL:  http://localhost:${config.port}          ║`);
  console.log(`  ║  API:  http://localhost:${config.port}/api     ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});
