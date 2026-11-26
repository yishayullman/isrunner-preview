-- Migration 0002: Email support (optional for legacy users), reserved deleted usernames,
-- password reset tokens, and anonymized reports on account deletion.

PRAGMA foreign_keys = OFF;

ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1));
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;

-- Prevents impersonation after account deletion by reserving a hash of the deleted username
CREATE TABLE IF NOT EXISTS reserved_usernames (
  username_hash TEXT PRIMARY KEY,
  reserved_at TEXT NOT NULL
);

-- Single-use expiring password reset tokens (active only after an email delivery provider is configured)
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pw_reset_user ON password_reset_tokens(user_id);

-- Rebuild reports table so reporter_id becomes NULL on user deletion (anonymized moderation log)
CREATE TABLE reports_new (
  id TEXT PRIMARY KEY,
  reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('user', 'run')),
  target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'closed')),
  created_at TEXT NOT NULL
);

INSERT INTO reports_new (id, reporter_id, target_type, target_user_id, target_run_id, reason, details, status, created_at)
SELECT id, reporter_id, target_type, target_user_id, target_run_id, reason, details, status, created_at
FROM reports;

DROP TABLE reports;
ALTER TABLE reports_new RENAME TO reports;
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id, created_at DESC);

PRAGMA foreign_keys = ON;
