-- Isrunner Initial Schema (SQLite / Cloudflare D1 compatible)
-- All timestamps are ISO-8601 UTC strings for portability between node:sqlite and Cloudflare D1.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  run_privacy TEXT NOT NULL DEFAULT 'everyone' CHECK (run_privacy IN ('everyone', 'friends', 'none')),
  show_in_global_leaderboard INTEGER NOT NULL DEFAULT 1 CHECK (show_in_global_leaderboard IN (0, 1)),
  weekly_goal_km REAL,
  bio TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Measurement provider connections (e.g., garmin_connect).
-- Only created via real server-side OAuth completion; never via client flags.
CREATE TABLE IF NOT EXISTS provider_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('garmin_connect')),
  provider_user_id TEXT NOT NULL,
  access_token_enc TEXT,
  token_secret_enc TEXT,
  consent_version TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  last_sync_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  UNIQUE (user_id, provider),
  UNIQUE (provider, provider_user_id)
);

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
  -- Source provenance (set strictly server-side, never from client input)
  source_type TEXT NOT NULL DEFAULT 'self_reported_legacy'
    CHECK (source_type IN ('self_reported_legacy', 'garmin_connect')),
  source_verified INTEGER NOT NULL DEFAULT 0 CHECK (source_verified IN (0, 1)),
  source_external_id TEXT,
  source_ingested_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_type, source_external_id)
);
CREATE INDEX IF NOT EXISTS idx_runs_user_ran_at ON runs(user_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_shared_ran_at ON runs(is_shared, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_source ON runs(user_id, source_type);

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

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  CHECK (blocker_id <> blocked_id),
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);

-- In-app notifications: intentionally does NOT store run note!
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
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_run ON notifications(run_id);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  join_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('user', 'run')),
  target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'closed')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id, created_at DESC);
