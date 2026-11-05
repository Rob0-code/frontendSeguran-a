const { verifyAccessToken } = require('../_lib/security');

module.exports = function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.statusCode = 405;
    return response.end();
  }
  const authorization = request.headers?.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const claims = match ? verifyAccessToken(match[1]) : null;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!claims) {
    response.statusCode = 401;
    return response.end(JSON.stringify({ message: 'Token ausente, inválido ou expirado.' }));
  }
  response.statusCode = 200;
  return response.end(JSON.stringify({
    id: claims.sub,
    role: claims.role,
  }));
};
