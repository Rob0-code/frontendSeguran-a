// Helpers for the other Questify frontend screens. The refresh token is kept
// only in an HttpOnly cookie; JavaScript never reads or stores it.
export async function refreshAccessToken() {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    sessionStorage.removeItem('questify_access_token');
    sessionStorage.removeItem('questify_access_expires_at');
    throw new Error(data.message || 'Sessão expirada. Faça login novamente.');
  }
  sessionStorage.setItem('questify_access_token', data.accessToken);
  sessionStorage.setItem('questify_access_expires_at', String(Date.now() + data.expiresIn * 1000));
  return data.accessToken;
}

export async function getAccessToken() {
  const token = sessionStorage.getItem('questify_access_token');
  const expiresAt = Number(sessionStorage.getItem('questify_access_expires_at') || 0);
  if (token && expiresAt > Date.now() + 30_000) return token;
  return refreshAccessToken();
}

export async function logout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  } finally {
    sessionStorage.removeItem('questify_access_token');
    sessionStorage.removeItem('questify_access_expires_at');
  }
}

export async function authenticatedFetch(url, options = {}) {
  const token = await getAccessToken();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...options, headers, credentials: 'same-origin' });
}
