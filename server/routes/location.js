/**
 * Target location routes: get and save the active spoofed location.
 */
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// GET /api/location
router.get('/', authRequired, (req, res) => {
  const loc = db.prepare('SELECT * FROM locations WHERE user_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1')
    .get(req.user.id);

  if (!loc) {
    // Default: Beijing
    return res.json({
      latitude: 39.9087,
      longitude: 116.3975,
      altitude: 0,
      accuracy: 65,
    });
  }

  res.json({
    latitude: loc.latitude,
    longitude: loc.longitude,
    altitude: loc.altitude,
    accuracy: loc.accuracy,
  });
});

// POST /api/location
router.post('/', authRequired, (req, res) => {
  const { latitude, longitude, altitude, accuracy } = req.body;

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: '纬度和经度必须为数字' });
  }
  if (latitude < -90 || latitude > 90) {
    return res.status(400).json({ error: '纬度范围 -90 ~ 90' });
  }
  if (longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: '经度范围 -180 ~ 180' });
  }

  // Deactivate previous locations
  db.prepare('UPDATE locations SET is_active = 0 WHERE user_id = ?').run(req.user.id);

  const result = db.prepare(
    `INSERT INTO locations (user_id, latitude, longitude, altitude, accuracy, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`
  ).run(
    req.user.id,
    latitude,
    longitude,
    altitude || 0,
    accuracy || 65
  );

  res.json({
    id: result.lastInsertRowid,
    latitude,
    longitude,
    altitude: altitude || 0,
    accuracy: accuracy || 65,
    message: '目标位置已保存',
  });
});

module.exports = router;
