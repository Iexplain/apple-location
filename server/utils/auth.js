const crypto = require('crypto');

function equalSecret(actual, expected) {
  const a = crypto.createHash('sha256').update(actual).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function isDocumentationPlaceholder(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized
    || normalized.startsWith('replace-with-')
    || normalized.startsWith('change-me')
    || normalized.startsWith('changeme')
    || normalized.startsWith('your-')
    || normalized.includes('<your-');
}

function createBasicAuth(auth) {
  if (auth.production && isDocumentationPlaceholder(auth.username)) {
    throw new Error('生产环境必须设置非示例值的 ADMIN_USERNAME');
  }
  if (auth.production
      && (isDocumentationPlaceholder(auth.password) || auth.password.length < 16)) {
    throw new Error('生产环境必须设置至少 16 字符且不是示例值的 ADMIN_PASSWORD');
  }
  if (auth.production
      && (isDocumentationPlaceholder(auth.token) || auth.token.length < 16)) {
    throw new Error('生产环境必须设置至少 16 字符且不是示例值的 SERVER_BUNDLE_TOKEN');
  }
  if (auth.username.includes(':')) throw new Error('ADMIN_USERNAME 不能包含冒号');
  if (!auth.password) {
    console.warn('[auth] 本地开发未设置密码；不要暴露到公网');
  }
  return (req, res, next) => {
    // Liveness/readiness does not expose coordinates, certificates or keys.
    const rawPath = (req.originalUrl || req.url || '').split('?')[0];
    const requestPath = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;
    if (req.method === 'GET' && requestPath === '/api/health') return next();
    res.setHeader('Cache-Control', 'no-store');
    if (requestPath === '/api/vpn/server-bundle') {
      if (!auth.token) return res.status(503).json({ error: '服务器证书包接口未配置访问令牌' });
      const bearer = /^Bearer /i.test(req.get('authorization') || '')
        ? req.get('authorization').slice(7) : '';
      if (equalSecret(bearer, auth.token)) return next();
      res.setHeader('WWW-Authenticate', 'Bearer realm="Virtual Location server bundle"');
      return res.status(401).json({ error: '需要有效的证书包访问令牌' });
    }
    if (!auth.password) return next();
    const header = req.get('authorization') || '';
    let credentials = '';
    if (/^Basic /i.test(header)) {
      credentials = Buffer.from(header.slice(6), 'base64').toString('utf8');
    }
    if (equalSecret(credentials, `${auth.username}:${auth.password}`)) return next();
    res.setHeader('WWW-Authenticate', 'Basic realm="Virtual Location", charset="UTF-8"');
    res.status(401).json({ error: '请使用管理账号和密码登录' });
  };
}

module.exports = { createBasicAuth, equalSecret, isDocumentationPlaceholder };
