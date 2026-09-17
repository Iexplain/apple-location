/**
 * Favorites routes — single-user data, protected by the app middleware.
 *   GET    /api/favorites       → list all
 *   POST   /api/favorites       → add
 *   DELETE /api/favorites/:id    → delete
 */
const express = require('express');
const db = require('../db');
const { validateLocation } = require('../utils/location');

const router = express.Router();

// GET /api/favorites
router.get('/', (req, res) => {
  const favs = db.prepare('SELECT * FROM favorites ORDER BY created_at DESC').all();
  res.json(favs);
});

// POST /api/favorites
router.post('/', (req, res) => {
  const { name } = req.body || {};

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: '位置名称不能为空' });
  }
  if (name.trim().length > 120) {
    return res.status(400).json({ error: '位置名称不能超过 120 个字符' });
  }
  const location = validateLocation(req.body);
  if (location.error) return res.status(400).json({ error: location.error });
  const { latitude, longitude, altitude, accuracy } = location;

  const normalizedName = name.trim();

  const info = db.prepare(`
    INSERT INTO favorites (name, latitude, longitude, altitude, accuracy)
    VALUES (?, ?, ?, ?, ?)
  `).run(normalizedName, latitude, longitude, altitude, accuracy);

  res.json({
    id: Number(info.lastInsertRowid),
    name: normalizedName, latitude, longitude, altitude, accuracy,
    message: '收藏成功',
  });
});

// DELETE /api/favorites/:id
router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM favorites WHERE id = ?').run(req.params.id);
  if (Number(info.changes) === 0) return res.status(404).json({ error: '收藏不存在' });
  res.json({ message: '已删除' });
});

module.exports = router;
