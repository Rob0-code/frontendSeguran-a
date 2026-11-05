module.exports = function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.statusCode = 405;
    return response.end();
  }
  const key = process.env.JWT_PUBLIC_KEY?.replace(/\\n/g, '\n');
  if (!key) {
    response.statusCode = 503;
    response.setHeader('Cache-Control', 'no-store');
    return response.end(JSON.stringify({ message: 'Chave pública JWT não configurada.' }));
  }
  response.statusCode = 200;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'public, max-age=300');
  return response.end(JSON.stringify({ algorithm: 'RS256', publicKey: key }));
};
