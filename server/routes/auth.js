/**
 * Authentication routes: register, login, device binding, logout.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const config = require('../config');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (username.length < 3) {
    return res.status(400).json({ error: '用户名至少 3 个字符' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少 6 个字符' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: '用户名已被占用' });
  }

  const hashed = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (username, password) VALUES (?, ?)'
  ).run(username, hashed);

  // Give new users a trial membership (7 days)
  const expireAt = new Date();
  expireAt.setDate(expireAt.getDate() + 7);
  db.prepare(
    `INSERT INTO memberships (user_id, is_active, expire_at) VALUES (?, 1, ?)`
  ).run(result.lastInsertRowid, expireAt.toISOString());

  const token = jwt.sign(
    { id: result.lastInsertRowid, username },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  res.json({
    token,
    user: {
      id: result.lastInsertRowid,
      username,
    },
    membership: {
      isActive: true,
      expireAt: expireAt.toISOString(),
    },
  });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password, deviceId } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  // Update device_id if provided
  if (deviceId) {
    db.prepare('UPDATE users SET device_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(deviceId, user.id);
  }

  const membership = db.prepare('SELECT * FROM memberships WHERE user_id = ?').get(user.id);

  const token = jwt.sign(
    { id: user.id, username: user.username },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  res.json({
    token,
    user: { id: user.id, username: user.username },
    membership: membership ? {
      isActive: !!membership.is_active,
      deviceId: membership.device_id,
      expireAt: membership.expire_at,
    } : null,
  });
});

// GET /api/auth/me
router.get('/me', authRequired, (req, res) => {
  const user = db.prepare('SELECT id, username, device_id, created_at FROM users WHERE id = ?')
    .get(req.user.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const membership = db.prepare('SELECT * FROM memberships WHERE user_id = ?').get(user.id);

  res.json({
    user,
    membership: membership ? {
      isActive: !!membership.is_active,
      deviceId: membership.device_id,
      expireAt: membership.expire_at,
    } : null,
  });
});

// POST /api/auth/device/bind
router.post('/device/bind', authRequired, (req, res) => {
  const { deviceId } = req.body;
  if (!deviceId) return res.status(400).json({ error: 'deviceId 不能为空' });

  db.prepare('UPDATE users SET device_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(deviceId, req.user.id);

  // Bind device to membership as well
  const membership = db.prepare('SELECT * FROM memberships WHERE user_id = ?').get(req.user.id);
  if (membership) {
    db.prepare('UPDATE memberships SET device_id = ? WHERE user_id = ?')
      .run(deviceId, req.user.id);
  }

  res.json({ message: '设备绑定成功', deviceId });
});

// POST /api/auth/activate  (redeem activation code)
router.post('/activate', authRequired, (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: '激活码不能为空' });

  const row = db.prepare('SELECT * FROM activation_codes WHERE code = ? AND used_by IS NULL').get(code);
  if (!row) return res.status(400).json({ error: '激活码无效或已被使用' });

  const expireAt = new Date();
  // If user already has active membership, extend from current expiry; else from now
  const current = db.prepare('SELECT * FROM memberships WHERE user_id = ?').get(req.user.id);
  if (current && current.expire_at && new Date(current.expire_at) > new Date()) {
    expireAt.setTime(new Date(current.expire_at).getTime());
  }
  expireAt.setDate(expireAt.getDate() + row.duration_days);

  db.prepare(`
    INSERT INTO memberships (user_id, is_active, expire_at)
    VALUES (?, 1, ?)
    ON CONFLICT(user_id) DO UPDATE SET is_active = 1, expire_at = ?, device_id = device_id
  `).run(req.user.id, expireAt.toISOString(), expireAt.toISOString());

  db.prepare('UPDATE activation_codes SET used_by = ?, used_at = datetime(\'now\') WHERE id = ?')
    .run(req.user.id, row.id);

  res.json({
    message: '激活成功',
    membership: { isActive: true, expireAt: expireAt.toISOString() },
  });
});

module.exports = router;
