/**
 * Favorites routes — no auth, no user_id.
 *   GET    /api/favorites       → list all
 *   POST   /api/favorites       → add
 *   DELETE /api/favorites/:id    → delete
 */
const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/favorites
router.get('/', (req, res) => {
  const favs = db.prepare('SELECT * FROM favorites ORDER BY created_at DESC').all();
  res.json(favs);
});

// POST /api/favorites
router.post('/', (req, res) => {
  const { name, latitude, longitude, altitude = 0, accuracy = 65 } = req.body;

  if (!name || typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: '名称、纬度、经度不能为空' });
  }

  const info = db.prepare(`
    INSERT INTO favorites (name, latitude, longitude, altitude, accuracy)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, latitude, longitude, altitude, accuracy);

  res.json({
    id: Number(info.lastInsertRowid),
    name, latitude, longitude, altitude, accuracy,
    message: '收藏成功',
  });
});

// DELETE /api/favorites/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM favorites WHERE id = ?').run(req.params.id);
  res.json({ message: '已删除' });
});

module.exports = router;
