const { createServer } = require('node:http');
const { createReadStream, existsSync } = require('node:fs');
const { extname, resolve, sep } = require('node:path');

const frontendRoot = resolve(__dirname, '..', 'frontend', 'dist');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8000);
const publicKeyHandler = require('../api/auth/public-key');
const meHandler = require('../api/auth/me');
const handlers = {
  '/api/auth/login': require('../api/_lib/auth-handler')('login'),
  '/api/auth/register': require('../api/_lib/auth-handler')('register'),
  '/api/auth/refresh': require('../api/_lib/auth-handler')('refresh'),
  '/api/auth/logout': require('../api/_lib/auth-handler')('logout'),
};

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 16_384) throw new Error('payload_too_large');
  }
  try {
    const value = JSON.parse(body || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/auth/public-key') {
    return publicKeyHandler(req, res);
  }
  if (url.pathname === '/api/auth/me') {
    return meHandler(req, res);
  }
  if (url.pathname.startsWith('/api/')) {
    const handler = handlers[url.pathname];
    if (!handler) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"message":"Rota não encontrada."}'); }
    try {
      if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
      const body = await readJson(req);
      if (!body) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end('{"message":"Requisição JSON inválida."}'); }
      req.body = body;
      await handler(req, res);
    } catch (error) {
      console.error('Questify API error:', error.message);
      if (!res.headersSent) res.writeHead(error.message === 'payload_too_large' ? 413 : 500, { 'Content-Type': 'application/json' });
      if (!res.writableEnded) res.end(JSON.stringify({ message: error.message === 'payload_too_large' ? 'A requisição excede o tamanho permitido.' : 'Erro interno do servidor.' }));
    }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = resolve(frontendRoot, relativePath);
  if (filePath !== frontendRoot && !filePath.startsWith(frontendRoot + sep)) { res.writeHead(403); return res.end(); }
  if (!existsSync(filePath)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
  if (req.method === 'HEAD') return res.end();
  createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => console.log(`Questify em http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
