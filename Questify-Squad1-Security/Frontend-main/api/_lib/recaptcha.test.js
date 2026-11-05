const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyRecaptcha } = require('./recaptcha');

test('reCAPTCHA accepts only successful expected action, score and hostname', async () => {
  const previous = {
    secret: process.env.RECAPTCHA_SECRET_KEY,
    hostnames: process.env.RECAPTCHA_ALLOWED_HOSTNAMES,
    score: process.env.RECAPTCHA_MIN_SCORE,
    fetch: global.fetch,
  };
  process.env.RECAPTCHA_SECRET_KEY = 'test-secret';
  process.env.RECAPTCHA_ALLOWED_HOSTNAMES = 'questify.example';
  process.env.RECAPTCHA_MIN_SCORE = '0.5';
  global.fetch = async () => ({ ok: true, json: async () => ({ success: true, action: 'login', score: 0.9, hostname: 'questify.example' }) });
  try {
    const result = await verifyRecaptcha('a'.repeat(30), 'login', 'questify.example');
    assert.equal(result.ok, true);
    assert.equal((await verifyRecaptcha('a'.repeat(30), 'register', 'questify.example')).ok, false);
  } finally {
    if (previous.secret === undefined) delete process.env.RECAPTCHA_SECRET_KEY; else process.env.RECAPTCHA_SECRET_KEY = previous.secret;
    if (previous.hostnames === undefined) delete process.env.RECAPTCHA_ALLOWED_HOSTNAMES; else process.env.RECAPTCHA_ALLOWED_HOSTNAMES = previous.hostnames;
    if (previous.score === undefined) delete process.env.RECAPTCHA_MIN_SCORE; else process.env.RECAPTCHA_MIN_SCORE = previous.score;
    global.fetch = previous.fetch;
  }
});
