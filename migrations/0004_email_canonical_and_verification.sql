-- Canonical email deduplication (blocks Gmail dot/+tag aliases) & real 6-digit email verification codes
ALTER TABLE users ADD COLUMN email_canonical TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_canonical_unique
ON users(email_canonical) WHERE email_canonical IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_canonical TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_verif_user ON email_verification_codes(user_id, created_at DESC);
