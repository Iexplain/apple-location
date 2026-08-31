/**
 * JWT authentication middleware.
 *
 * Token sources (checked in order):
 *  1. Authorization: Bearer <token>
 *  2. ?token=<token>  (for file download links that browsers open directly)
 */
const jwt = require('jsonwebtoken');
const config = require('../config');

function extractToken(req) {
  // 1. Authorization header
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);

  // 2. Query param (for <a href> downloads on iOS Safari)
  if (req.query && req.query.token) return req.query.token;

  return null;
}

function authRequired(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: '未登录或令牌缺失' });
  }

  try {
    const payload = jwt.verify(token, config.jwt.secret);
    req.user = { id: payload.id, username: payload.username };
    next();
  } catch (err) {
    return res.status(401).json({ error: '令牌无效或已过期' });
  }
}

/** Optional auth — attaches req.user if token is valid, but never blocks */
function authOptional(req, res, next) {
  const token = extractToken(req);

  if (token) {
    try {
      const payload = jwt.verify(token, config.jwt.secret);
      req.user = { id: payload.id, username: payload.username };
    } catch {
      /* ignore invalid token */
    }
  }
  next();
}

module.exports = { authRequired, authOptional };
