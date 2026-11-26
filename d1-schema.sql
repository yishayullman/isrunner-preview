-- ============================================================
-- Isrunner — Cloudflare D1 Schema (עבור מסד בדיקה נפרד: isrunner-test)
-- הוראות: פתח את המסד החדש ב-Cloudflare D1 -> לשונית Console
-- אפשר להדביק ולהריץ פקודה אחת בכל פעם (או כמה יחד).
-- אל תריץ על המסד החי "isrunner" בלי גיבוי ואישור מפורש!
-- ============================================================

-- 1. טבלת משתמשים
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  email TEXT,
  email_canonical TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  password_hash TEXT NOT NULL,
  run_privacy TEXT NOT NULL DEFAULT 'everyone' CHECK (run_privacy IN ('everyone', 'friends', 'none')),
  show_in_global_leaderboard INTEGER NOT NULL DEFAULT 1 CHECK (show_in_global_leaderboard IN (0, 1)),
  weekly_goal_km REAL,
  bio TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 2. אינדקסי ייחודיות לאימייל (רגיל + קנוני למניעת כפילויות Gmail/+tag)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_canonical_unique
ON users(email_canonical) WHERE email_canonical IS NOT NULL;

-- 2ב. קודי אימות לאימייל (נשמרים כ-SHA-256 hash בלבד, תוקף 15 דקות)
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

-- 3. שמות משתמש שמורים לאחר מחיקת חשבון (למניעת התחזות)
CREATE TABLE IF NOT EXISTS reserved_usernames (
  username_hash TEXT PRIMARY KEY,
  reserved_at TEXT NOT NULL
);

-- 4. טבלת סשנים (התחברות)
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 5. חיבורי ספקי מדידה (Garmin Connect / Strava — רק דרך OAuth מאושר בשרת)
CREATE TABLE IF NOT EXISTS provider_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('garmin_connect', 'strava')),
  provider_user_id TEXT NOT NULL,
  provider_username TEXT,
  access_token_enc TEXT,
  token_secret_enc TEXT,
  refresh_token_enc TEXT,
  token_expires_at TEXT,
  consent_version TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  last_sync_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  UNIQUE (user_id, provider),
  UNIQUE (provider, provider_user_id)
);

-- 5ב. מצבי OAuth חד-פעמיים + PKCE (לחיבור מאובטח מול Garmin / Strava)
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('garmin_connect', 'strava')),
  code_verifier TEXT,
  consent_version TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_user ON oauth_states(user_id, provider);

-- 6. טבלת ריצות (מקור ריצה + טלמטריית GPS מנוהלים בשרת בלבד)
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  distance_km REAL NOT NULL CHECK (distance_km > 0 AND distance_km <= 500),
  duration_sec INTEGER NOT NULL CHECK (duration_sec > 0 AND duration_sec <= 604800),
  ran_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  is_shared INTEGER NOT NULL DEFAULT 1 CHECK (is_shared IN (0, 1)),
  first_shared_at TEXT,
  notifications_dispatched INTEGER NOT NULL DEFAULT 0 CHECK (notifications_dispatched IN (0, 1)),
  source_type TEXT NOT NULL DEFAULT 'self_reported_legacy'
    CHECK (source_type IN ('self_reported_legacy', 'garmin_connect', 'strava', 'app_gps')),
  source_verified INTEGER NOT NULL DEFAULT 0 CHECK (source_verified IN (0, 1)),
  source_external_id TEXT,
  source_ingested_at TEXT,
  device_name TEXT,
  gps_points_count INTEGER,
  avg_accuracy_m REAL,
  splits_json TEXT,
  route_polyline_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_type, source_external_id)
);

CREATE INDEX IF NOT EXISTS idx_runs_user_ran_at ON runs(user_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_shared_ran_at ON runs(is_shared, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_source ON runs(user_id, source_type);

-- 7. טבלת חברויות
CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (requester_id <> addressee_id),
  UNIQUE (requester_id, addressee_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id, status);

-- 8. טבלת חסימות
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  CHECK (blocker_id <> blocked_id),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);

-- 9. התראות בתוך האפליקציה (ללא הערת הריצה!)
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'friend_shared_run' CHECK (type IN ('friend_shared_run')),
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (recipient_id, run_id, type)
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient
ON notifications(recipient_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_run ON notifications(run_id);

-- 10. קבוצות
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  join_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

-- 11. חברי קבוצות
CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);

-- 12. דיווחים (אנונימיזציה אוטומטית במחיקת משתמש דרך ON DELETE SET NULL)
CREATE TABLE IF NOT EXISTS reports (
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

CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id, created_at DESC);

-- 13. טוקנים לשחזור סיסמה (לשימוש עתידי לאחר חיבור ספק אימייל)
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
