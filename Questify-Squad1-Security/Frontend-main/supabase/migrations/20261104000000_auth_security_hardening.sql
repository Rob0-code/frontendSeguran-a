-- Squad 1: authentication hardening for existing Questify installations.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'student';

DO $$ BEGIN
  ALTER TABLE public.users
    ADD CONSTRAINT users_role_check CHECK (role IN ('student', 'monitor', 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  window_started_at BIGINT NOT NULL,
  blocked_until BIGINT NOT NULL DEFAULT 0
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.users, public.sessions, public.auth_rate_limits FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON public.sessions(expires_at);
