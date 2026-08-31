/**
 * Location routes — single global location, no auth.
 *   GET  /api/location  → get current target location
 *   POST /api/location  → save target location
 */
const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/location
router.get('/', (req, res) => {
  const loc = db.prepare('SELECT latitude, longitude, altitude, accuracy FROM location WHERE id = 1').get();
  res.json(loc);
});

// POST /api/location
router.post('/', (req, res) => {
  const { latitude, longitude, altitude = 0, accuracy = 65 } = req.body;

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: '纬度和经度必须为数字' });
  }

  db.prepare(`
    UPDATE location
    SET latitude = ?, longitude = ?, altitude = ?, accuracy = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(latitude, longitude, altitude, accuracy);

  res.json({ latitude, longitude, altitude, accuracy, message: '目标位置已保存' });
});

module.exports = router;
