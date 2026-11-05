import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../style.css';

const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
let recaptchaLoader;

function loadRecaptcha() {
  if (!RECAPTCHA_SITE_KEY) return Promise.resolve(false);
  if (window.grecaptcha?.execute) return Promise.resolve(true);
  if (!recaptchaLoader) {
    recaptchaLoader = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(RECAPTCHA_SITE_KEY)}`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(true);
      script.onerror = () => { recaptchaLoader = undefined; reject(new Error('Não foi possível carregar a verificação de segurança.')); };
      document.head.appendChild(script);
    });
  }
  return recaptchaLoader;
}

async function getRecaptchaToken(action) {
  if (!RECAPTCHA_SITE_KEY && import.meta.env.DEV) return undefined;
  if (!RECAPTCHA_SITE_KEY) throw new Error('A chave pública do reCAPTCHA não foi configurada.');
  await loadRecaptcha();
  return new Promise((resolve, reject) => {
    window.grecaptcha.ready(async () => {
      try { resolve(await window.grecaptcha.execute(RECAPTCHA_SITE_KEY, { action })); }
      catch { reject(new Error('Falha ao executar a verificação de segurança.')); }
    });
  });
}

async function readApiResponse(response) {
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`A API retornou uma resposta inválida (HTTP ${response.status}). Confira os logs da função na Vercel.`);
  }
  if (!response.ok) throw new Error(data.message || `Erro da API (HTTP ${response.status}).`);
  return data;
}

function AuthCard({ registering }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const requirements = [
    [password.length >= 10, 'Pelo menos 10 caracteres'],
    [/[a-z]/.test(password) && /[A-Z]/.test(password), 'Letra maiúscula e minúscula'],
    [/\d/.test(password), 'Pelo menos um número'],
    [/[^A-Za-z0-9]/.test(password), 'Pelo menos um símbolo (!@#$...)'],
  ];

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (registering && !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,}$/.test(password)) {
      setError('A senha deve cumprir todos os requisitos de segurança indicados.');
      return;
    }

    setSubmitting(true);
    try {
      const recaptchaToken = await getRecaptchaToken(registering ? 'register' : 'login');
      const response = await fetch(registering ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(registering ? { name, email, password, recaptchaToken } : { email, password, recaptchaToken }),
      });
      const data = await readApiResponse(response);

      if (registering) {
        setSuccess('Conta criada com sucesso! Redirecionando...');
        window.setTimeout(() => { window.location.href = 'index.html'; }, 2000);
      } else {
        sessionStorage.setItem('questify_access_token', data.accessToken);
        sessionStorage.setItem('questify_access_expires_at', String(Date.now() + data.expiresIn * 1000));
        window.location.href = 'dashboard.html';
      }
    } catch (submitError) {
      setError(submitError.message || 'Erro ao conectar com o servidor.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-container">
      <section className="auth-card" aria-labelledby="auth-title">
        <h2 id="auth-title">{registering ? 'Criar Conta' : 'Questify'}</h2>
        <p className="subtitle">
          {registering ? 'Junte-se ao Questify e comece sua jornada' : 'Faça login para continuar sua jornada'}
        </p>
        <form onSubmit={handleSubmit}>
          {registering && (
            <div className="input-group">
              <label htmlFor="name">Nome completo</label>
              <input id="name" type="text" required maxLength="120" autoComplete="name" placeholder="Seu nome" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
          )}
          <div className="input-group">
            <label htmlFor="email">E-mail</label>
            <input id="email" type="email" required maxLength="254" autoComplete="email" placeholder="seu.email@exemplo.com" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className="input-group">
            <label htmlFor="password">{registering ? 'Senha forte' : 'Senha'}</label>
            <input id="password" type="password" required maxLength="256" placeholder={registering ? 'Digite sua senha' : '********'} autoComplete={registering ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} />
            {registering && (
              <ul className="password-requirements" aria-label="Requisitos da senha">
                {requirements.map(([valid, label]) => <li key={label} className={valid ? 'valid' : ''}>{valid ? '✔️' : '❌'} {label}</li>)}
              </ul>
            )}
          </div>
          {error && <div className="error-message" role="alert">{error}</div>}
          {success && <div className="success-message" role="status">{success}</div>}
          <button className="btn-primary" type="submit" disabled={submitting}>{submitting ? 'Aguarde...' : registering ? 'Cadastrar' : 'Entrar'}</button>
        </form>
        <p className="footer-link">
          {registering ? 'Já tem uma conta? ' : 'Ainda não tem uma conta? '}
          <a href={registering ? 'index.html' : 'register.html'}>{registering ? 'Faça login' : 'Cadastre-se'}</a>
        </p>
      </section>
    </main>
  );
}

const registering = window.location.pathname.endsWith('/register.html') || window.location.pathname.endsWith('/register');
createRoot(document.getElementById('root')).render(<React.StrictMode><AuthCard registering={registering} /></React.StrictMode>);
