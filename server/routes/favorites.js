/**
 * Favorite locations CRUD.
 */
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// GET /api/favorites
router.get('/', authRequired, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.user.id);

  res.json(rows.map(r => ({
    id: r.id,
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    altitude: r.altitude,
    accuracy: r.accuracy,
    createdAt: r.created_at,
  })));
});

// POST /api/favorites
router.post('/', authRequired, (req, res) => {
  const { name, latitude, longitude, altitude, accuracy } = req.body;

  if (!name || typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: '名称、纬度、经度不能为空' });
  }

  const result = db.prepare(
    `INSERT INTO favorites (user_id, name, latitude, longitude, altitude, accuracy)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(req.user.id, name, latitude, longitude, altitude || 0, accuracy || 65);

  res.json({
    id: result.lastInsertRowid,
    name,
    latitude,
    longitude,
    altitude: altitude || 0,
    accuracy: accuracy || 65,
    message: '收藏成功',
  });
});

// DELETE /api/favorites/:id
router.delete('/:id', authRequired, (req, res) => {
  const result = db.prepare('DELETE FROM favorites WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: '收藏不存在' });
  }

  res.json({ message: '已删除' });
});

module.exports = router;
