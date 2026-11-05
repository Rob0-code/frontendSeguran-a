const { randomBytes, pbkdf2, timingSafeEqual, createHash } = require('node:crypto');
const getDatabase = require('./db');
const { verifyRecaptcha } = require('./recaptcha');
const security = require('./security');

const PBKDF2_ITERATIONS = 310_000;
const PASSWORD_MAX_BYTES = 1024;
const LOGIN_WINDOW = 15 * 60;
const LOGIN_LIMIT = 10;
const REGISTER_WINDOW = 60 * 60;
const REGISTER_LIMIT = 5;
const DUMMY_PASSWORD_HASH = passwordHash('Questify-Dummy-Password-For-Timing-Only-2026!');
let schemaReady;

function json(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  for (const [key, value] of Object.entries(headers)) response.setHeader(key, value);
  return response.end(body);
}

function passwordHash(password, salt = randomBytes(16)) {
  return new Promise((resolve, reject) => pbkdf2(password, salt, PBKDF2_ITERATIONS, 32, 'sha256', (error, digest) => {
    if (error) return reject(error);
    resolve(`pbkdf2_sha256$${PBKDF2_ITERATIONS}$${salt.toString('hex')}$${digest.toString('hex')}`);
  }));
}

async function verifyPassword(password, stored) {
  try {
    const [algorithm, roundsText, saltHex, expectedHex] = String(stored).split('$');
    const rounds = Number(roundsText);
    if (algorithm !== 'pbkdf2_sha256' || !Number.isInteger(rounds) || rounds < 100_000 || rounds > 1_000_000 || !/^[a-f0-9]{32}$/.test(saltHex) || !/^[a-f0-9]{64}$/.test(expectedHex)) return false;
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = await new Promise((resolve, reject) => pbkdf2(password, Buffer.from(saltHex, 'hex'), rounds, expected.length, 'sha256', (error, digest) => error ? reject(error) : resolve(digest)));
    return timingSafeEqual(actual, expected);
  } catch { return false; }
}

async function ensureSchema(sql) {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
  await sql`CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'monitor', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'student'`;
  await sql`CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS auth_rate_limits (
    bucket_key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL,
    window_started_at BIGINT NOT NULL,
    blocked_until BIGINT NOT NULL DEFAULT 0
  )`;
  await sql`ALTER TABLE users ENABLE ROW LEVEL SECURITY`;
  await sql`ALTER TABLE sessions ENABLE ROW LEVEL SECURITY`;
  await sql`ALTER TABLE auth_rate_limits ENABLE ROW LEVEL SECURITY`;
  await sql`DO $$ BEGIN ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('student', 'monitor', 'admin')); EXCEPTION WHEN duplicate_object THEN NULL; END $$`;
  await sql`REVOKE ALL ON TABLE users, sessions, auth_rate_limits FROM anon, authenticated`;
  })().catch((error) => { schemaReady = undefined; throw error; });
  return schemaReady;
}

async function rateLimit(sql, key, limit, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const rows = await sql`
    INSERT INTO auth_rate_limits (bucket_key, attempts, window_started_at, blocked_until)
    VALUES (${key}, 1, ${now}, 0)
    ON CONFLICT (bucket_key) DO UPDATE SET
      attempts = CASE WHEN auth_rate_limits.window_started_at + ${windowSeconds} <= ${now} THEN 1 ELSE auth_rate_limits.attempts + 1 END,
      window_started_at = CASE WHEN auth_rate_limits.window_started_at + ${windowSeconds} <= ${now} THEN ${now} ELSE auth_rate_limits.window_started_at END,
      blocked_until = CASE
        WHEN auth_rate_limits.blocked_until > ${now} THEN auth_rate_limits.blocked_until
        WHEN auth_rate_limits.window_started_at + ${windowSeconds} <= ${now} THEN 0
        WHEN auth_rate_limits.attempts + 1 > ${limit} THEN ${now} + ${windowSeconds}
        ELSE 0 END
    RETURNING attempts, blocked_until
  `;
  return Number(rows[0].blocked_until) > now;
}

function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254; }
function validPassword(password) {
  return typeof password === 'string' && Buffer.byteLength(password, 'utf8') <= PASSWORD_MAX_BYTES &&
    password.length >= 10 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

async function checkCaptcha(payload, action, request) {
  try {
    const result = await verifyRecaptcha(payload.recaptchaToken, action, request.headers?.host);
    return result.ok;
  } catch (error) {
    console.error('reCAPTCHA verification unavailable:', error.message);
    return false;
  }
}

async function createSession(sql, user, response) {
  const refresh = security.createRefreshToken();
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${refresh.hash}, ${user.id}, ${refresh.expiresAt})`;
  const accessToken = security.issueAccessToken(user);
  return json(response, 200, {
    accessToken,
    tokenType: 'Bearer',
    expiresIn: security.ACCESS_TOKEN_SECONDS,
    user: { id: Number(user.id), name: user.name, email: user.email, role: user.role || 'student' },
  }, { 'Set-Cookie': security.refreshCookie(refresh.token) });
}

module.exports = function createAuthHandler(action) {
  return async function handler(request, response) {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return json(response, 405, { message: 'Método não permitido.' });
    }
    let payload;
    try {
      if (Buffer.byteLength(JSON.stringify(request.body ?? {})) > 16_384) return json(response, 413, { message: 'A requisição excede o tamanho permitido.' });
      payload = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid_json');
    } catch { return json(response, 400, { message: 'Requisição JSON inválida.' }); }

    try {
      const sql = getDatabase();
      await ensureSchema(sql);
      const ipHash = createHash('sha256').update(security.requestIp(request)).digest('hex');

      if (action === 'register' || action === 'login') {
        const captchaAction = action;
        if (!await checkCaptcha(payload, captchaAction, request)) return json(response, 403, { message: 'Não foi possível validar a verificação de segurança. Atualize a página e tente novamente.' });
      }

      if (action === 'register') {
        const name = typeof payload.name === 'string' ? payload.name.trim() : '';
        const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
        const password = payload.password;
        if (!name || name.length > 120 || !validEmail(email)) return json(response, 400, { message: 'Informe nome e e-mail válidos.' });
        if (!validPassword(password)) return json(response, 400, { message: 'A senha deve ter pelo menos 10 caracteres, incluindo maiúscula, minúscula, número e símbolo.' });
        if (await rateLimit(sql, `register:${ipHash}`, REGISTER_LIMIT, REGISTER_WINDOW)) return json(response, 429, { message: 'Muitas tentativas de cadastro. Aguarde antes de tentar novamente.' });
        try {
          const users = await sql`INSERT INTO users (name, email, password_hash) VALUES (${name}, ${email}, ${await passwordHash(password)}) RETURNING id, name, email, role`;
          return json(response, 201, { id: Number(users[0].id), name: users[0].name, email: users[0].email, role: users[0].role });
        } catch (error) {
          if (error.code === '23505') return json(response, 409, { message: 'Este e-mail já está cadastrado.' });
          throw error;
        }
      }

      if (action === 'login') {
        const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
        const password = payload.password;
        if (!validEmail(email) || typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) return json(response, 400, { message: 'Informe e-mail e senha válidos.' });
        const emailHash = createHash('sha256').update(email).digest('hex');
        const ipBlocked = await rateLimit(sql, `login-ip:${ipHash}`, LOGIN_LIMIT, LOGIN_WINDOW);
        const emailBlocked = await rateLimit(sql, `login-email:${emailHash}`, LOGIN_LIMIT, LOGIN_WINDOW);
        if (ipBlocked || emailBlocked) return json(response, 429, { message: 'Muitas tentativas de login. Aguarde 15 minutos.' });
        const users = await sql`SELECT id, name, email, password_hash, role FROM users WHERE email = ${email} LIMIT 1`;
        const user = users[0];
        if (!user) {
          await verifyPassword(password, await DUMMY_PASSWORD_HASH);
          return json(response, 401, { message: 'E-mail ou senha inválidos.' });
        }
        if (!await verifyPassword(password, user.password_hash)) return json(response, 401, { message: 'E-mail ou senha inválidos.' });
        return createSession(sql, user, response);
      }

      if (action === 'refresh') {
        if (!security.assertSameOrigin(request)) return json(response, 403, { message: 'Origem não autorizada.' }, { 'Set-Cookie': security.clearRefreshCookie() });
        const cookies = security.parseCookies(request.headers?.cookie);
        const refreshToken = cookies[security.COOKIE_NAME];
        if (!refreshToken) return json(response, 401, { message: 'Sessão expirada. Faça login novamente.' });
        const tokenHash = security.hashToken(refreshToken);
        const next = security.createRefreshToken();
        const session = await sql.begin(async (tx) => {
          // Consume the old refresh token atomically: a token can rotate only once.
          const consumed = await tx`DELETE FROM sessions WHERE token_hash = ${tokenHash} AND expires_at > ${Math.floor(Date.now() / 1000)} RETURNING user_id`;
          if (!consumed[0]) return null;
          const users = await tx`SELECT id, name, email, role FROM users WHERE id = ${consumed[0].user_id} LIMIT 1`;
          if (!users[0]) return null;
          await tx`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${next.hash}, ${users[0].id}, ${next.expiresAt})`;
          return users[0];
        });
        if (!session) return json(response, 401, { message: 'Sessão expirada ou já utilizada. Faça login novamente.' }, { 'Set-Cookie': security.clearRefreshCookie() });
        const accessToken = security.issueAccessToken({ id: session.id, name: session.name, email: session.email, role: session.role });
        return json(response, 200, { accessToken, tokenType: 'Bearer', expiresIn: security.ACCESS_TOKEN_SECONDS, user: { id: Number(session.id), name: session.name, email: session.email, role: session.role } }, { 'Set-Cookie': security.refreshCookie(next.token) });
      }

      if (action === 'logout') {
        if (!security.assertSameOrigin(request)) return json(response, 403, { message: 'Origem não autorizada.' });
        const token = security.parseCookies(request.headers?.cookie)[security.COOKIE_NAME];
        if (token) await sql`DELETE FROM sessions WHERE token_hash = ${security.hashToken(token)}`;
        return json(response, 200, { message: 'Logout realizado.' }, { 'Set-Cookie': security.clearRefreshCookie() });
      }

      return json(response, 404, { message: 'Rota não encontrada.' });
    } catch (error) {
      const code = error.message?.startsWith('Defina SUPABASE_DB_URL') ? 'MISSING_SUPABASE_DB_URL' : error.message?.startsWith('Missing required environment variable') ? 'MISSING_JWT_CONFIGURATION' : error.code || 'INTERNAL_ERROR';
      console.error('Questify auth request failed:', { code, message: error.message });
      const status = code === 'MISSING_SUPABASE_DB_URL' || code === 'MISSING_JWT_CONFIGURATION' ? 503 : 500;
      return json(response, status, { message: status === 503 ? 'A autenticação não está configurada corretamente no servidor.' : 'Erro interno do servidor.' });
    }
  };
};
