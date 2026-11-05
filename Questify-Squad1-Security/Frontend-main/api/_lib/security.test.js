const test = require('node:test');
const assert = require('node:assert/strict');
const security = require('./security');

test('refresh token hash is deterministic and does not expose original token', () => {
  const { token, hash } = security.createRefreshToken();
  assert.equal(typeof token, 'string');
  assert.equal(hash, security.hashToken(token));
  assert.notEqual(hash, token);
});

test('cookie parser handles encoded values', () => {
  assert.deepEqual(security.parseCookies('a=1; questify_refresh=abc%2Fdef'), {
    a: '1', questify_refresh: 'abc/def',
  });
});

test('JWT verification rejects malformed tokens', () => {
  assert.equal(security.verifyAccessToken('not.a.jwt'), null);
  assert.equal(security.verifyAccessToken(''), null);
});

test('RS256 access token signs and verifies expected claims', () => {
  const { generateKeyPairSync } = require('node:crypto');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const previousPrivate = process.env.JWT_PRIVATE_KEY;
  const previousPublic = process.env.JWT_PUBLIC_KEY;
  process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  process.env.JWT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  try {
    const token = security.issueAccessToken({ id: 7, name: 'Rob', email: 'rob@example.test', role: 'student' });
    const claims = security.verifyAccessToken(token);
    assert.equal(claims.sub, '7');
    assert.equal(claims.role, 'student');
    assert.equal(claims.iss, 'questify-auth');
  } finally {
    if (previousPrivate === undefined) delete process.env.JWT_PRIVATE_KEY; else process.env.JWT_PRIVATE_KEY = previousPrivate;
    if (previousPublic === undefined) delete process.env.JWT_PUBLIC_KEY; else process.env.JWT_PUBLIC_KEY = previousPublic;
  }
});
