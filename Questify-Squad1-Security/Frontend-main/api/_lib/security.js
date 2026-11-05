const { createHash, randomBytes, sign, verify } = require('node:crypto');

const ISSUER = process.env.JWT_ISSUER || 'questify-auth';
const AUDIENCE = process.env.JWT_AUDIENCE || 'questify-services';
const ACCESS_TOKEN_SECONDS = 15 * 60;
const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;
const COOKIE_NAME = 'questify_refresh';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function pem(value) {
  return value.replace(/\\n/g, '\n');
}

function issueAccessToken(user) {
  const privateKey = pem(requiredEnv('JWT_PRIVATE_KEY'));
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: String(user.id),
    role: user.role || 'student',
    iat: now,
    exp: now + ACCESS_TOKEN_SECONDS,
    jti: randomBytes(16).toString('hex'),
  })).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

function verifyAccessToken(token) {
  if (typeof token !== 'string' || token.length > 8192) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (header.alg !== 'RS256' || header.typ !== 'JWT') return null;
    if (!verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), pem(requiredEnv('JWT_PUBLIC_KEY')), Buffer.from(parts[2], 'base64url'))) return null;
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== ISSUER || claims.aud !== AUDIENCE || !/^\d+$/.test(String(claims.sub || '')) ||
        !['student', 'monitor', 'admin'].includes(claims.role) ||
        !Number.isFinite(claims.iat) || claims.iat > now + 60 ||
        !Number.isFinite(claims.exp) || claims.exp <= now || claims.exp <= claims.iat ||
        claims.exp - claims.iat > ACCESS_TOKEN_SECONDS) return null;
    return claims;
  } catch {
    return null;
  }
}

function createRefreshToken() {
  const token = randomBytes(48).toString('base64url');
  return { token, hash: hashToken(token), expiresAt: Math.floor(Date.now() / 1000) + REFRESH_TOKEN_SECONDS };
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try { return [key, decodeURIComponent(value)]; } catch { return [key, '']; }
  }).filter(([key]) => key));
}

function refreshCookie(token, maxAge = REFRESH_TOKEN_SECONDS) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clearRefreshCookie() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function requestIp(request) {
  const forwarded = request.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length < 512) return forwarded.split(',')[0].trim();
  return request.socket?.remoteAddress || 'unknown';
}

function assertSameOrigin(request) {
  const origin = request.headers?.origin;
  if (!origin) return process.env.NODE_ENV !== 'production';
  const allowed = (process.env.APP_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
  try {
    const originUrl = new URL(origin);
    return allowed.includes(originUrl.origin) || originUrl.host === request.headers?.host ||
      (process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(originUrl.hostname));
  } catch { return false; }
}

module.exports = {
  ACCESS_TOKEN_SECONDS, COOKIE_NAME, REFRESH_TOKEN_SECONDS,
  issueAccessToken, verifyAccessToken, createRefreshToken, hashToken,
  parseCookies, refreshCookie, clearRefreshCookie, requestIp, assertSameOrigin,
};
