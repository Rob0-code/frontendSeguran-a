async function verifyRecaptcha(token, expectedAction, hostname) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV !== 'production' && process.env.RECAPTCHA_REQUIRED !== 'true') return { ok: true, skipped: true };
    throw new Error('RECAPTCHA_SECRET_KEY não configurada.');
  }
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) return { ok: false, reason: 'missing_or_invalid_token' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const body = new URLSearchParams({ secret, response: token });
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`reCAPTCHA HTTP ${response.status}`);
    const result = await response.json();
    const allowedHostnames = (process.env.RECAPTCHA_ALLOWED_HOSTNAMES || hostname || '')
      .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
    const validHostname = allowedHostnames.length === 0 || allowedHostnames.includes(String(result.hostname || '').toLowerCase());
    const threshold = Number(process.env.RECAPTCHA_MIN_SCORE || 0.5);
    const ok = result.success === true && result.action === expectedAction &&
      Number.isFinite(result.score) && result.score >= threshold && validHostname;
    return { ok, score: result.score, action: result.action, hostname: result.hostname };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { verifyRecaptcha };
