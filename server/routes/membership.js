/**
 * Membership status and management.
 */
const express = require('express');
const db = require('../db');
const config = require('../config');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// GET /api/membership
router.get('/', authRequired, (req, res) => {
  const m = db.prepare('SELECT * FROM memberships WHERE user_id = ?').get(req.user.id);

  if (!m) {
    return res.json({
      isActive: false,
      deviceId: null,
      expireAt: null,
    });
  }

  // Check expiry
  const isExpired = m.expire_at && new Date(m.expire_at) < new Date();

  res.json({
    isActive: !!m.is_active && !isExpired,
    deviceId: m.device_id,
    expireAt: m.expire_at,
    isExpired,
  });
});

// POST /api/membership/bind-device
router.post('/bind-device', authRequired, (req, res) => {
  const { deviceId } = req.body;
  if (!deviceId) return res.status(400).json({ error: 'deviceId 不能为空' });

  const m = db.prepare('SELECT * FROM memberships WHERE user_id = ?').get(req.user.id);
  if (!m || !m.is_active) {
    return res.status(403).json({ error: '会员未激活' });
  }
  if (m.expire_at && new Date(m.expire_at) < new Date()) {
    return res.status(403).json({ error: '会员已过期' });
  }

  // Bind device
  db.prepare('UPDATE memberships SET device_id = ? WHERE user_id = ?')
    .run(deviceId, req.user.id);
  db.prepare('UPDATE users SET device_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(deviceId, req.user.id);

  res.json({
    message: '设备绑定成功',
    deviceId,
    expireAt: m.expire_at,
  });
});

// GET /api/membership/codes (admin only - simple check)
router.get('/codes', authRequired, (req, res) => {
  // Simple admin check by username
  if (req.user.username !== config.admin.username) {
    return res.status(403).json({ error: '无权限' });
  }

  const codes = db.prepare('SELECT * FROM activation_codes ORDER BY created_at DESC').all();
  res.json(codes);
});

// POST /api/membership/codes (admin only - generate activation code)
router.post('/codes', authRequired, (req, res) => {
  if (req.user.username !== config.admin.username) {
    return res.status(403).json({ error: '无权限' });
  }

  const { durationDays = 30, count = 1 } = req.body;
  const { v4: uuidv4 } = require('uuid');
  const codes = [];

  for (let i = 0; i < count; i++) {
    const code = uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase();
    db.prepare(
      'INSERT INTO activation_codes (code, duration_days) VALUES (?, ?)'
    ).run(code, durationDays);
    codes.push({ code, durationDays });
  }

  res.json({ codes });
});

module.exports = router;
