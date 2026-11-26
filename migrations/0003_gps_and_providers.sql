-- Migration 0003: Real Garmin OAuth 2.0 PKCE + Strava OAuth 2.0 + In-App Live GPS Runs
-- Expands provider_connections (garmin_connect, strava + refresh tokens),
-- adds oauth_states (PKCE + anti-CSRF), and adds GPS telemetry columns to runs.

CREATE TABLE provider_connections_new (
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

INSERT INTO provider_connections_new (
  id, user_id, provider, provider_user_id, access_token_enc, token_secret_enc,
  consent_version, consented_at, connected_at, last_sync_at, status
)
SELECT
  id, user_id, provider, provider_user_id, access_token_enc, token_secret_enc,
  consent_version, consented_at, connected_at, last_sync_at, status
FROM provider_connections;

DROP TABLE provider_connections;
ALTER TABLE provider_connections_new RENAME TO provider_connections;

-- Single-use expiring OAuth state & PKCE verifier storage
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

-- Rebuild runs table to allow strava & app_gps sources plus GPS telemetry columns
CREATE TABLE runs_new (
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

INSERT INTO runs_new (
  id, user_id, distance_km, duration_sec, ran_at, note, is_shared,
  first_shared_at, notifications_dispatched,
  source_type, source_verified, source_external_id, source_ingested_at,
  created_at, updated_at
)
SELECT
  id, user_id, distance_km, duration_sec, ran_at, note, is_shared,
  first_shared_at, notifications_dispatched,
  source_type, source_verified, source_external_id, source_ingested_at,
  created_at, updated_at
FROM runs;

DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;
CREATE INDEX IF NOT EXISTS idx_runs_user_ran_at ON runs(user_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_shared_ran_at ON runs(is_shared, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_source ON runs(user_id, source_type);
