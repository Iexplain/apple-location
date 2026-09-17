/**
 * Location routes — single global location (protected by the app middleware).
 *   GET  /api/location  → get current target location
 *   POST /api/location  → save target location
 */
const express = require('express');
const db = require('../db');
const { validateLocation } = require('../utils/location');

const router = express.Router();

// GET /api/location
router.get('/', (req, res) => {
  const loc = db.prepare('SELECT latitude, longitude, altitude, accuracy FROM location WHERE id = 1').get();
  res.json(loc);
});

// POST /api/location
router.post('/', (req, res) => {
  const location = validateLocation(req.body);
  if (location.error) return res.status(400).json({ error: location.error });
  const { latitude, longitude, altitude, accuracy } = location;

  db.prepare(`
    UPDATE location
    SET latitude = ?, longitude = ?, altitude = ?, accuracy = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(latitude, longitude, altitude, accuracy);

  res.json({ latitude, longitude, altitude, accuracy, message: '目标位置已保存' });
});

module.exports = router;
