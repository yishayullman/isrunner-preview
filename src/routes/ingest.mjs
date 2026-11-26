import {
  generateId,
  generatePkcePair,
  generateSessionToken,
  verifyWebhookSignature,
} from '../crypto.mjs';
import { readJsonBody, sendError, sendJson } from '../http-utils.mjs';
import { dispatchFirstShareNotifications } from '../privacy.mjs';
import { decorateRun } from '../ranking.mjs';
import { runInTransaction } from '../db.mjs';

export const GARMIN_CONSENT_VERSION = '2026-oauth2-v1';
export const STRAVA_CONSENT_VERSION = '2026-oauth2-v1';

const GARMIN_OAUTH_AUTHORIZE_URL = 'https://connect.garmin.com/oauth2Confirm';
const GARMIN_OAUTH_TOKEN_URL = 'https://diauth.garmin.com/di-oauth2-service/oauth/token';
const GARMIN_USER_ID_URL = 'https://apis.garmin.com/wellness-api/rest/user/id';
const GARMIN_DEREGISTER_URL = 'https://apis.garmin.com/wellness-api/rest/user/registration';

const STRAVA_OAUTH_AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_OAUTH_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API_BASE = 'https://www.strava.com/api/v3';
const STRAVA_OAUTH_REVOKE_URL = 'https://www.strava.com/oauth/revoke';

const GARMIN_RUN_TYPES = new Set([
  'RUNNING',
  'TRAIL_RUNNING',
  'TREADMILL_RUNNING',
  'TRACK_RUNNING',
  'STREET_RUNNING',
  'INDOOR_RUNNING',
  'ULTRA_RUN',
  'OBSTACLE_RUN',
  'VIRTUAL_RUN',
]);

const STRAVA_RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun', 'Treadmill']);

export const GARMIN_CONSENT_SUMMARY = {
  version: GARMIN_CONSENT_VERSION,
  provider: 'garmin_connect',
  provider_name: 'Garmin Connect',
  data_collected: [
    'ריצות שנקלטו בשעון או באפליקציית Garmin Connect (מרחק, זמן מדידה, תאריך, דגם שעון)',
    'מזהה פעילות ייחודי מגרמין למניעת כפילויות ולשמירת מקור הריצה',
  ],
  data_not_collected: [
    'לא נקלטת סיסמת Garmin שלך (החיבור נעשה ב-OAuth 2.0 PKCE בלבד)',
    'לא מועלים ולא נערכים קבצים ידניים',
  ],
  user_controls: [
    'כל ריצה שנקלטת מסומנת כמשותפת כברירת מחדל וניתנת להפיכה לפרטית בכל רגע',
    'אפשר לנתק את החיבור ולמחוק את כל הריצות שנקלטו מגרמין בכל עת',
  ],
};

export const STRAVA_CONSENT_SUMMARY = {
  version: STRAVA_CONSENT_VERSION,
  provider: 'strava',
  provider_name: 'Strava',
  data_collected: [
    'ריצות מ-Strava (מרחק, זמן מדידה, תאריך, שם מכשיר — כולל ריצות שהגיעו משעון Garmin ל-Strava)',
    'מזהה פעילות ייחודי מ-Strava למניעת כפילויות; ריצות שהוזנו ידנית ב-Strava מסומנות בשקיפות כלא מאומתות',
  ],
  data_not_collected: [
    'לא נקלטת סיסמת Strava שלך (OAuth 2.0 עם הרשאת קריאה בלבד: read,activity:read_all)',
    'Isrunner לא משנה ולא מוחקת שום דבר בחשבון Strava שלך',
  ],
  user_controls: [
    'אפשר לסנכרן ריצות ידנית בלחיצת כפתור וגם לקלוט אוטומטית דרך Webhook',
    'אפשר לנתק את Strava ולמחוק את כל הריצות שנקלטו ממנה בכל עת',
  ],
};

function getGarminCreds(config) {
  const clientId = config.garminClientId || config.garminConsumerKey || '';
  const clientSecret = config.garminClientSecret || config.garminConsumerSecret || '';
  return { clientId, clientSecret, webhookSecret: config.garminWebhookSecret || '' };
}

function isGarminConfigured(config) {
  const { clientId, clientSecret } = getGarminCreds(config);
  return Boolean(clientId && clientSecret);
}

function isStravaConfigured(config) {
  return Boolean(config.stravaClientId && config.stravaClientSecret);
}

function getBaseUrl(req, config) {
  if (config.publicBaseUrl) return config.publicBaseUrl.replace(/\/+$/, '');
  const proto =
    req.headers['x-forwarded-proto']?.split(',')[0]?.trim() ||
    (config.cookieSecure ? 'https' : 'http');
  const host = req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

function getFetcher(config) {
  return config.fetchImpl || globalThis.fetch;
}

function sendRedirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function upsertConnection(db, data) {
  const existing = db
    .prepare('SELECT id FROM provider_connections WHERE user_id = ? AND provider = ?')
    .get(data.user_id, data.provider);

  if (existing) {
    db.prepare(
      `UPDATE provider_connections
       SET provider_user_id = ?, provider_username = ?, access_token_enc = ?,
           refresh_token_enc = ?, token_expires_at = ?, consent_version = ?,
           consented_at = ?, connected_at = ?, last_sync_at = COALESCE(?, last_sync_at),
           status = 'active'
       WHERE id = ?`
    ).run(
      data.provider_user_id,
      data.provider_username || null,
      data.access_token || null,
      data.refresh_token || null,
      data.token_expires_at || null,
      data.consent_version,
      data.nowIso,
      data.nowIso,
      data.last_sync_at || null,
      existing.id
    );
    return existing.id;
  }

  const id = generateId();
  db.prepare(
    `INSERT INTO provider_connections (
      id, user_id, provider, provider_user_id, provider_username,
      access_token_enc, refresh_token_enc, token_expires_at,
      consent_version, consented_at, connected_at, last_sync_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
  ).run(
    id,
    data.user_id,
    data.provider,
    data.provider_user_id,
    data.provider_username || null,
    data.access_token || null,
    data.refresh_token || null,
    data.token_expires_at || null,
    data.consent_version,
    data.nowIso,
    data.nowIso,
    data.last_sync_at || null
  );
  return id;
}

function insertProviderRun(db, {
  userId,
  runPrivacy,
  provider,
  externalId,
  distanceKm,
  durationSec,
  ranAtIso,
  note = '',
  deviceName = null,
  verified = 1,
  isShared = 1,
}) {
  const dup = db
    .prepare('SELECT id FROM runs WHERE source_type = ? AND source_external_id = ?')
    .get(provider, externalId);
  if (dup) {
    return { duplicate: true, runId: dup.id, notificationsSent: 0 };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const runId = generateId();
  let notificationsSent = 0;

  runInTransaction(db, () => {
    db.prepare(
      `INSERT INTO runs (
        id, user_id, distance_km, duration_sec, ran_at, note, is_shared,
        first_shared_at, notifications_dispatched,
        source_type, source_verified, source_external_id, source_ingested_at,
        device_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      runId,
      userId,
      Math.round(distanceKm * 10000) / 10000,
      Math.round(durationSec),
      ranAtIso,
      note.slice(0, 500),
      isShared ? 1 : 0,
      provider,
      verified ? 1 : 0,
      externalId,
      nowIso,
      deviceName ? String(deviceName).slice(0, 80) : null,
      nowIso,
      nowIso
    );

    const createdRun = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
    if (isShared) {
      notificationsSent = dispatchFirstShareNotifications(
        db,
        createdRun,
        { id: userId, run_privacy: runPrivacy },
        now
      );
    }
  });

  return { duplicate: false, runId, notificationsSent };
}

export async function handleGetSources(req, res, ctx) {
  const garminConfigured = isGarminConfigured(ctx.config);
  const stravaConfigured = isStravaConfigured(ctx.config);
  const baseUrl = getBaseUrl(req, ctx.config);

  const conns = ctx.db
    .prepare(
      `SELECT id, provider, provider_user_id, provider_username, consent_version,
              consented_at, connected_at, last_sync_at, status
       FROM provider_connections
       WHERE user_id = ? AND status = 'active'`
    )
    .all(ctx.user.id);
  const connByProvider = Object.fromEntries(conns.map((c) => [c.provider, c]));

  const counts = ctx.db
    .prepare(
      `SELECT source_type, COUNT(*) AS cnt
       FROM runs WHERE user_id = ?
       GROUP BY source_type`
    )
    .all(ctx.user.id);
  const countMap = Object.fromEntries(counts.map((r) => [r.source_type, Number(r.cnt)]));

  const garminConn = connByProvider.garmin_connect || null;
  const stravaConn = connByProvider.strava || null;

  const garminConnected = Boolean(garminConn && garminConfigured);
  const stravaConnected = Boolean(stravaConn && stravaConfigured);

  return sendJson(res, 200, {
    has_any_connected_source: garminConnected || stravaConnected,
    in_app_gps: {
      available: true,
      runs_count: countMap.app_gps || 0,
      label: 'מדידת GPS ישירות מתוך Isrunner',
      description:
        'מדידת מרחק, זמן, קצב חי ופיצולי ק"מ ישירות מ-GPS הטלפון בדפדפן, עם אימות וחישוב מחדש בשרת.',
    },
    sources: [
      {
        provider: 'garmin_connect',
        name: 'Garmin Connect',
        priority: 'primary',
        server_configured: garminConfigured,
        connected: garminConnected,
        callback_url: `${baseUrl}/api/oauth/garmin/callback`,
        webhook_url: `${baseUrl}/api/webhooks/garmin`,
        connection: garminConn
          ? {
              connected_at: garminConn.connected_at,
              last_sync_at: garminConn.last_sync_at,
              consent_version: garminConn.consent_version,
              consented_at: garminConn.consented_at,
              provider_username: garminConn.provider_username || null,
            }
          : null,
        runs_count: countMap.garmin_connect || 0,
        status_label: garminConnected
          ? 'מחובר ל-Garmin Connect'
          : garminConfigured
            ? 'מוכן לחיבור OAuth 2.0 מול Garmin'
            : 'לא מחובר — ממתין לאישור תוכנית המפתחים של Garmin',
        honest_explanation: garminConfigured
          ? 'החיבור זמין להרשאת OAuth 2.0 (PKCE) אמיתית מול Garmin Connect. לאחר אישור, ריצות חדשות ייקלטו אוטומטית ב-Webhook.'
          : 'חיבור ל-Garmin Connect דורש הגשת בקשה ואישור בתוכנית המפתחים של Garmin (Garmin Connect Developer Program), הסכם API ומפתחות OAuth (GARMIN_CLIENT_ID ו-GARMIN_CLIENT_SECRET). עד להזנת מפתחות מאושרים בשרת, החיבור אינו פעיל.',
        consent: GARMIN_CONSENT_SUMMARY,
      },
      {
        provider: 'strava',
        name: 'Strava',
        priority: 'secondary',
        server_configured: stravaConfigured,
        connected: stravaConnected,
        callback_url: `${baseUrl}/api/oauth/strava/callback`,
        webhook_url: `${baseUrl}/api/webhooks/strava`,
        connection: stravaConn
          ? {
              connected_at: stravaConn.connected_at,
              last_sync_at: stravaConn.last_sync_at,
              consent_version: stravaConn.consent_version,
              consented_at: stravaConn.consented_at,
              provider_username: stravaConn.provider_username || null,
            }
          : null,
        runs_count: countMap.strava || 0,
        status_label: stravaConnected
          ? 'מחובר ל-Strava'
          : stravaConfigured
            ? 'מוכן לחיבור OAuth 2.0 מול Strava'
            : 'מוכן בקוד — נדרש להזין מפתחות Strava API בשרת',
        honest_explanation: stravaConfigured
          ? 'החיבור זמין להרשאת OAuth 2.0 אמיתית מול Strava. אפשר לייבא ריצות מיידית (כולל ריצות שסונכרנו משעון Garmin אל Strava).'
          : 'הקוד לחיבור Strava מוכן במלואו. כדי להפעיל אותו לוקח 2 דקות: פותחים אפליקציית API חינמית ב-strava.com/settings/api ומגדירים בשרת את STRAVA_CLIENT_ID ו-STRAVA_CLIENT_SECRET.',
        consent: STRAVA_CONSENT_SUMMARY,
      },
    ],
    legacy_runs_count: countMap.self_reported_legacy || 0,
    legacy_note:
      'ריצות קיימות מהתקופה שלפני סגירת ההזנה הידנית נשמרות ומסומנות "דיווח עצמי, לא מאומת". הן לא נמחקות ולא הופכות למאומתות.',
  });
}

// ============================================================
// Garmin Connect OAuth 2.0 (PKCE S256)
// ============================================================

export async function handleStartGarminConnect(req, res, ctx) {
  const { body } = await readJsonBody(req);
  if (body.consent_accepted !== true) {
    return sendError(
      res,
      400,
      'consent_required',
      'נדרשת הסכמה מפורשת לתנאי קליטת הנתונים לפני תחילת חיבור.'
    );
  }

  if (!isGarminConfigured(ctx.config)) {
    return sendError(
      res,
      503,
      'garmin_not_configured',
      'חיבור Garmin Connect עדיין לא פעיל: נדרש אישור ב-Garmin Connect Developer Program ומפתחות OAuth אמיתיים בשרת. לא בוצע חיבור.'
    );
  }

  const { clientId } = getGarminCreds(ctx.config);
  const state = generateSessionToken();
  const { verifier, challenge } = generatePkcePair();
  const redirectUri = `${getBaseUrl(req, ctx.config)}/api/oauth/garmin/callback`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

  ctx.db
    .prepare(
      `INSERT INTO oauth_states (state, user_id, provider, code_verifier, consent_version, redirect_uri, created_at, expires_at)
       VALUES (?, ?, 'garmin_connect', ?, ?, ?, ?, ?)`
    )
    .run(state, ctx.user.id, verifier, GARMIN_CONSENT_VERSION, redirectUri, now.toISOString(), expiresAt);

  const authUrl = new URL(GARMIN_OAUTH_AUTHORIZE_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);

  return sendJson(res, 200, {
    ok: true,
    provider: 'garmin_connect',
    authorize_url: authUrl.toString(),
  });
}

export async function handleGarminOAuthCallback(req, res, ctx, url) {
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const oauthErr = url.searchParams.get('error') || '';

  if (oauthErr) {
    return sendRedirect(res, `/#/sources?oauth_error=${encodeURIComponent(oauthErr)}`);
  }
  if (!code || !state || !isGarminConfigured(ctx.config)) {
    return sendRedirect(res, '/#/sources?oauth_error=garmin_invalid_callback');
  }

  const stateRow = ctx.db
    .prepare(`SELECT * FROM oauth_states WHERE state = ? AND provider = 'garmin_connect'`)
    .get(state);

  if (!stateRow || stateRow.expires_at < new Date().toISOString()) {
    ctx.db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
    return sendRedirect(res, '/#/sources?oauth_error=oauth_state_expired');
  }
  ctx.db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);

  const { clientId, clientSecret } = getGarminCreds(ctx.config);
  const fetcher = getFetcher(ctx.config);

  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: stateRow.code_verifier || '',
    redirect_uri: stateRow.redirect_uri,
  });

  const tokenRes = await fetcher(GARMIN_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams.toString(),
  });
  if (!tokenRes.ok) {
    return sendRedirect(res, '/#/sources?oauth_error=garmin_token_exchange_failed');
  }
  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token || '';
  const refreshToken = tokenData.refresh_token || '';
  const expiresIn = Number(tokenData.expires_in) || 3600;
  if (!accessToken) {
    return sendRedirect(res, '/#/sources?oauth_error=garmin_missing_token');
  }

  // Fetch stable Garmin API User ID (used to match incoming Push webhooks)
  let providerUserId = '';
  try {
    const uidRes = await fetcher(GARMIN_USER_ID_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (uidRes.ok) {
      const uidData = await uidRes.json();
      providerUserId = String(uidData.userId || uidData.user_id || '').trim();
    }
  } catch {
    // handled below
  }
  if (!providerUserId) {
    return sendRedirect(res, '/#/sources?oauth_error=garmin_user_id_failed');
  }

  const nowIso = new Date().toISOString();
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  upsertConnection(ctx.db, {
    user_id: stateRow.user_id,
    provider: 'garmin_connect',
    provider_user_id: providerUserId,
    access_token: accessToken,
    refresh_token: refreshToken,
    token_expires_at: tokenExpiresAt,
    consent_version: stateRow.consent_version,
    nowIso,
  });

  return sendRedirect(res, '/#/sources?connected=garmin_connect');
}

// Garmin Connect Push API webhook receiver
export async function handleGarminWebhook(req, res, ctx) {
  const { webhookSecret } = getGarminCreds(ctx.config);
  const { raw, body } = await readJsonBody(req, 512 * 1024);

  if (webhookSecret) {
    const sig = req.headers['x-isrunner-provider-signature'] || '';
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const sigOk = sig ? verifyWebhookSignature(webhookSecret, raw, sig) : false;
    const tokenOk = bearer && bearer === webhookSecret;
    if (!sigOk && !tokenOk) {
      return sendError(res, 401, 'invalid_webhook_auth', 'אימות Webhook של Garmin נכשל.');
    }
  } else if (!isGarminConfigured(ctx.config)) {
    return sendError(res, 503, 'garmin_not_configured', 'חיבור Garmin לא מוגדר בשרת.');
  }

  const activities = Array.isArray(body.activities)
    ? body.activities
    : Array.isArray(body.activityDetails)
      ? body.activityDetails
      : [];

  let imported = 0;
  let skipped = 0;

  for (const act of activities) {
    const providerUserId = String(act.userId || act.userAccessToken || '').trim();
    const externalId = String(act.activityId || act.summaryId || '').trim();
    const actType = String(act.activityType || '').toUpperCase();
    const distMeters = Number(act.distanceInMeters);
    const durSec = Math.round(Number(act.durationInSeconds));
    const startSec = Number(act.startTimeInSeconds);

    if (!providerUserId || !externalId || !GARMIN_RUN_TYPES.has(actType)) {
      skipped += 1;
      continue;
    }
    if (!Number.isFinite(distMeters) || distMeters < 50 || !Number.isFinite(durSec) || durSec < 10) {
      skipped += 1;
      continue;
    }

    const conn = ctx.db
      .prepare(
        `SELECT pc.*, u.run_privacy
         FROM provider_connections pc
         JOIN users u ON u.id = pc.user_id
         WHERE pc.provider = 'garmin_connect' AND pc.provider_user_id = ? AND pc.status = 'active'`
      )
      .get(providerUserId);

    if (!conn) {
      skipped += 1;
      continue;
    }

    const ranAtIso = Number.isFinite(startSec)
      ? new Date(startSec * 1000).toISOString()
      : new Date().toISOString();

    const r = insertProviderRun(ctx.db, {
      userId: conn.user_id,
      runPrivacy: conn.run_privacy,
      provider: 'garmin_connect',
      externalId,
      distanceKm: distMeters / 1000,
      durationSec: durSec,
      ranAtIso,
      note: typeof act.activityName === 'string' ? act.activityName.trim() : '',
      deviceName: act.deviceName || 'Garmin',
      verified: act.manual === true ? 0 : 1,
    });

    ctx.db
      .prepare('UPDATE provider_connections SET last_sync_at = ? WHERE id = ?')
      .run(new Date().toISOString(), conn.id);

    if (r.duplicate) skipped += 1;
    else imported += 1;
  }

  return sendJson(res, 200, { ok: true, imported, skipped });
}

// ============================================================
// Strava API v3 OAuth 2.0 + Sync + Webhook
// ============================================================

export async function handleStartStravaConnect(req, res, ctx) {
  const { body } = await readJsonBody(req);
  if (body.consent_accepted !== true) {
    return sendError(
      res,
      400,
      'consent_required',
      'נדרשת הסכמה מפורשת לתנאי קליטת הנתונים לפני תחילת חיבור ל-Strava.'
    );
  }

  if (!isStravaConfigured(ctx.config)) {
    return sendError(
      res,
      503,
      'strava_not_configured',
      'חיבור Strava מוכן בקוד אך טרם הוגדרו מפתחות STRAVA_CLIENT_ID ו-STRAVA_CLIENT_SECRET בשרת. לא בוצע חיבור.'
    );
  }

  const state = generateSessionToken();
  const redirectUri = `${getBaseUrl(req, ctx.config)}/api/oauth/strava/callback`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

  ctx.db
    .prepare(
      `INSERT INTO oauth_states (state, user_id, provider, code_verifier, consent_version, redirect_uri, created_at, expires_at)
       VALUES (?, ?, 'strava', NULL, ?, ?, ?, ?)`
    )
    .run(state, ctx.user.id, STRAVA_CONSENT_VERSION, redirectUri, now.toISOString(), expiresAt);

  const authUrl = new URL(STRAVA_OAUTH_AUTHORIZE_URL);
  authUrl.searchParams.set('client_id', ctx.config.stravaClientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('approval_prompt', 'auto');
  authUrl.searchParams.set('scope', 'read,activity:read_all');
  authUrl.searchParams.set('state', state);

  return sendJson(res, 200, {
    ok: true,
    provider: 'strava',
    authorize_url: authUrl.toString(),
  });
}

async function ensureFreshStravaToken(db, config, conn) {
  const expiresAtMs = conn.token_expires_at ? Date.parse(conn.token_expires_at) : 0;
  if (conn.access_token_enc && expiresAtMs > Date.now() + 5 * 60 * 1000) {
    return conn.access_token_enc;
  }
  if (!conn.refresh_token_enc) {
    throw Object.assign(new Error('חסר טוקן רענון של Strava — יש לחבר מחדש.'), { status: 401 });
  }
  const fetcher = getFetcher(config);
  const res = await fetcher(STRAVA_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.stravaClientId,
      client_secret: config.stravaClientSecret,
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token_enc,
    }),
  });
  if (!res.ok) {
    throw Object.assign(new Error('רענון ההרשאה מול Strava נכשל — נסה לחבר מחדש.'), { status: 502 });
  }
  const data = await res.json();
  const nextAccess = data.access_token;
  const nextRefresh = data.refresh_token || conn.refresh_token_enc;
  const nextExpiresIso = data.expires_at
    ? new Date(Number(data.expires_at) * 1000).toISOString()
    : new Date(Date.now() + (Number(data.expires_in) || 21600) * 1000).toISOString();

  db.prepare(
    `UPDATE provider_connections
     SET access_token_enc = ?, refresh_token_enc = ?, token_expires_at = ?
     WHERE id = ?`
  ).run(nextAccess, nextRefresh, nextExpiresIso, conn.id);

  return nextAccess;
}

function ingestStravaActivity(db, userId, runPrivacy, act) {
  const sportType = String(act.sport_type || act.type || '');
  if (!STRAVA_RUN_TYPES.has(sportType)) {
    return { skipped: true, reason: 'not_a_run' };
  }
  const distMeters = Number(act.distance);
  // Raw elapsed/moving time without normalization (prefer moving_time if valid, else elapsed_time)
  const durSec = Math.round(Number(act.moving_time || act.elapsed_time));
  if (!Number.isFinite(distMeters) || distMeters < 50 || !Number.isFinite(durSec) || durSec < 10) {
    return { skipped: true, reason: 'invalid_metrics' };
  }
  const externalId = String(act.id || '').trim();
  if (!externalId) return { skipped: true, reason: 'missing_id' };

  const ranAtIso = act.start_date && !Number.isNaN(Date.parse(act.start_date))
    ? new Date(act.start_date).toISOString()
    : new Date().toISOString();

  const deviceName = act.device_name || (act.manual ? 'Strava (הזנה ידנית)' : 'Strava');
  const r = insertProviderRun(db, {
    userId,
    runPrivacy,
    provider: 'strava',
    externalId,
    distanceKm: distMeters / 1000,
    durationSec: durSec,
    ranAtIso,
    note: typeof act.name === 'string' ? act.name.trim() : '',
    deviceName,
    verified: act.manual === true ? 0 : 1,
  });
  return { skipped: false, duplicate: r.duplicate, runId: r.runId };
}

async function syncStravaForConnection(db, config, conn, runPrivacy) {
  const accessToken = await ensureFreshStravaToken(db, config, conn);
  const fetcher = getFetcher(config);
  const listRes = await fetcher(`${STRAVA_API_BASE}/athlete/activities?per_page=30`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) {
    throw Object.assign(new Error(`קריאת ריצות מ-Strava נכשלה (HTTP ${listRes.status}).`), {
      status: 502,
    });
  }
  const activities = await listRes.json();
  let imported = 0;
  let duplicates = 0;
  let nonRuns = 0;

  if (Array.isArray(activities)) {
    for (const act of activities) {
      const outcome = ingestStravaActivity(db, conn.user_id, runPrivacy, act);
      if (outcome.skipped) nonRuns += 1;
      else if (outcome.duplicate) duplicates += 1;
      else imported += 1;
    }
  }

  db.prepare('UPDATE provider_connections SET last_sync_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    conn.id
  );

  return {
    imported,
    duplicates,
    non_runs_skipped: nonRuns,
    total_fetched: Array.isArray(activities) ? activities.length : 0,
  };
}

export async function handleStravaOAuthCallback(req, res, ctx, url) {
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const oauthErr = url.searchParams.get('error') || '';

  if (oauthErr) {
    return sendRedirect(res, `/#/sources?oauth_error=${encodeURIComponent(oauthErr)}`);
  }
  if (!code || !state || !isStravaConfigured(ctx.config)) {
    return sendRedirect(res, '/#/sources?oauth_error=strava_invalid_callback');
  }

  const stateRow = ctx.db
    .prepare(`SELECT * FROM oauth_states WHERE state = ? AND provider = 'strava'`)
    .get(state);

  if (!stateRow || stateRow.expires_at < new Date().toISOString()) {
    ctx.db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
    return sendRedirect(res, '/#/sources?oauth_error=oauth_state_expired');
  }
  ctx.db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);

  const fetcher = getFetcher(ctx.config);
  const tokenRes = await fetcher(STRAVA_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: ctx.config.stravaClientId,
      client_secret: ctx.config.stravaClientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    return sendRedirect(res, '/#/sources?oauth_error=strava_token_exchange_failed');
  }
  const data = await tokenRes.json();
  const accessToken = data.access_token || '';
  const refreshToken = data.refresh_token || '';
  const athleteId = data.athlete?.id ? String(data.athlete.id) : '';
  const athleteName =
    data.athlete?.username ||
    [data.athlete?.firstname, data.athlete?.lastname].filter(Boolean).join(' ') ||
    null;

  if (!accessToken || !athleteId) {
    return sendRedirect(res, '/#/sources?oauth_error=strava_missing_athlete');
  }

  const nowIso = new Date().toISOString();
  const expiresAtIso = data.expires_at
    ? new Date(Number(data.expires_at) * 1000).toISOString()
    : new Date(Date.now() + 6 * 3600 * 1000).toISOString();

  upsertConnection(ctx.db, {
    user_id: stateRow.user_id,
    provider: 'strava',
    provider_user_id: athleteId,
    provider_username: athleteName,
    access_token: accessToken,
    refresh_token: refreshToken,
    token_expires_at: expiresAtIso,
    consent_version: stateRow.consent_version,
    nowIso,
  });

  let synced = 0;
  try {
    const conn = ctx.db
      .prepare(`SELECT * FROM provider_connections WHERE user_id = ? AND provider = 'strava'`)
      .get(stateRow.user_id);
    const owner = ctx.db.prepare('SELECT run_privacy FROM users WHERE id = ?').get(stateRow.user_id);
    if (conn && owner) {
      const result = await syncStravaForConnection(ctx.db, ctx.config, conn, owner.run_privacy);
      synced = result.imported;
    }
  } catch {
    // Initial sync failure shouldn't fail OAuth connection itself; user can retry Sync Now
  }

  return sendRedirect(res, `/#/sources?connected=strava&synced=${synced}`);
}

export async function handleSyncStrava(req, res, ctx) {
  if (!isStravaConfigured(ctx.config)) {
    return sendError(res, 503, 'strava_not_configured', 'מפתחות Strava אינם מוגדרים בשרת.');
  }

  const conn = ctx.db
    .prepare(
      `SELECT * FROM provider_connections WHERE user_id = ? AND provider = 'strava' AND status = 'active'`
    )
    .get(ctx.user.id);
  if (!conn) {
    return sendError(res, 404, 'not_connected', 'חשבון Strava אינו מחובר.');
  }

  const result = await syncStravaForConnection(ctx.db, ctx.config, conn, ctx.user.run_privacy);
  return sendJson(res, 200, {
    ok: true,
    ...result,
    message:
      result.imported > 0
        ? `סונכרנו ${result.imported} ריצות חדשות מ-Strava.`
        : 'הסנכרון הושלם — אין ריצות חדשות לייבוא.',
  });
}

export async function handleStravaWebhookVerify(req, res, ctx, url) {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const expected = ctx.config.stravaWebhookVerifyToken || '';

  if (!expected) {
    return sendError(res, 503, 'webhook_not_configured', 'STRAVA_WEBHOOK_VERIFY_TOKEN לא מוגדר.');
  }
  if (mode === 'subscribe' && token === expected && challenge) {
    return sendJson(res, 200, { 'hub.challenge': challenge });
  }
  return sendError(res, 403, 'invalid_verify_token', 'אימות Webhook נכשל.');
}

export async function handleStravaWebhookEvent(req, res, ctx) {
  if (!isStravaConfigured(ctx.config)) {
    return sendError(res, 503, 'strava_not_configured', 'Strava לא מוגדר בשרת.');
  }
  const { body } = await readJsonBody(req);
  if (body.object_type !== 'activity' || !['create', 'update'].includes(body.aspect_type)) {
    return sendJson(res, 200, { ok: true, ignored: true });
  }
  const ownerId = String(body.owner_id || '').trim();
  const activityId = String(body.object_id || '').trim();
  if (!ownerId || !activityId) {
    return sendJson(res, 200, { ok: true, ignored: true });
  }

  const conn = ctx.db
    .prepare(
      `SELECT pc.*, u.run_privacy
       FROM provider_connections pc
       JOIN users u ON u.id = pc.user_id
       WHERE pc.provider = 'strava' AND pc.provider_user_id = ? AND pc.status = 'active'`
    )
    .get(ownerId);
  if (!conn) {
    return sendJson(res, 200, { ok: true, ignored: true });
  }

  const accessToken = await ensureFreshStravaToken(ctx.db, ctx.config, conn);
  const fetcher = getFetcher(ctx.config);
  const actRes = await fetcher(`${STRAVA_API_BASE}/activities/${encodeURIComponent(activityId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!actRes.ok) {
    return sendJson(res, 200, { ok: true, fetch_failed: true });
  }
  const act = await actRes.json();
  const outcome = ingestStravaActivity(ctx.db, conn.user_id, conn.run_privacy, act);
  ctx.db
    .prepare('UPDATE provider_connections SET last_sync_at = ? WHERE id = ?')
    .run(new Date().toISOString(), conn.id);

  return sendJson(res, 200, { ok: true, outcome });
}

// ============================================================
// Disconnect & Delete Source Data (Garmin + Strava)
// ============================================================

const SUPPORTED_PROVIDERS = new Set(['garmin_connect', 'strava']);

export async function handleDisconnectSource(req, res, ctx, provider) {
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    return sendError(res, 404, 'unknown_provider', 'מקור מדידה לא מוכר.');
  }

  const { body } = await readJsonBody(req);
  const deleteSourceRuns = body.delete_source_runs === true;

  const existing = ctx.db
    .prepare('SELECT access_token_enc FROM provider_connections WHERE user_id = ? AND provider = ?')
    .get(ctx.user.id, provider);

  // Best-effort upstream revocation with provider
  if (existing?.access_token_enc) {
    const fetcher = getFetcher(ctx.config);
    try {
      if (provider === 'strava') {
        await fetcher(STRAVA_OAUTH_REVOKE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: existing.access_token_enc }).toString(),
        });
      } else if (provider === 'garmin_connect') {
        await fetcher(GARMIN_DEREGISTER_URL, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${existing.access_token_enc}` },
        });
      }
    } catch {
      // Never block local disconnect on upstream outage
    }
  }

  let deletedRuns = 0;
  let removedConnections = 0;

  runInTransaction(ctx.db, () => {
    const connInfo = ctx.db
      .prepare('DELETE FROM provider_connections WHERE user_id = ? AND provider = ?')
      .run(ctx.user.id, provider);
    removedConnections = connInfo.changes || 0;

    if (deleteSourceRuns) {
      ctx.db
        .prepare(
          `DELETE FROM notifications
           WHERE run_id IN (SELECT id FROM runs WHERE user_id = ? AND source_type = ?)`
        )
        .run(ctx.user.id, provider);

      const runInfo = ctx.db
        .prepare('DELETE FROM runs WHERE user_id = ? AND source_type = ?')
        .run(ctx.user.id, provider);
      deletedRuns = runInfo.changes || 0;
    }
  });

  return sendJson(res, 200, {
    ok: true,
    provider,
    disconnected: removedConnections > 0,
    deleted_source_runs: deletedRuns,
    message: deleteSourceRuns
      ? `החיבור נותק ונמחקו ${deletedRuns} ריצות ממקור זה. ריצות היסטוריות מדיווח עצמי לא שונו.`
      : 'החיבור נותק. ריצות קיימות נשמרו.',
  });
}

export async function handleDeleteSourceData(req, res, ctx, provider) {
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    return sendError(res, 404, 'unknown_provider', 'מקור מדידה לא מוכר.');
  }

  let deletedRuns = 0;
  runInTransaction(ctx.db, () => {
    ctx.db
      .prepare(
        `DELETE FROM notifications
         WHERE run_id IN (SELECT id FROM runs WHERE user_id = ? AND source_type = ?)`
      )
      .run(ctx.user.id, provider);

    const runInfo = ctx.db
      .prepare('DELETE FROM runs WHERE user_id = ? AND source_type = ?')
      .run(ctx.user.id, provider);
    deletedRuns = runInfo.changes || 0;
  });

  return sendJson(res, 200, {
    ok: true,
    provider,
    deleted_source_runs: deletedRuns,
    message: `נמחקו ${deletedRuns} ריצות שמקורן ב-${provider}. ריצות מדיווח עצמי לא שונו.`,
  });
}

/**
 * Dedicated server-side HMAC provider ingestion path (supports garmin_connect and strava).
 * Separate from user-facing /api/runs (hardcoded 403).
 */
export async function handleProviderIngest(req, res, ctx, provider) {
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    return sendError(res, 404, 'unknown_provider', 'ספק מדידה לא נתמך.');
  }

  const webhookSecret = ctx.config.garminWebhookSecret;
  if (!webhookSecret) {
    return sendError(
      res,
      503,
      'provider_not_configured',
      'נתיב קליטת הספק אינו פעיל כי לא הוגדרו מפתחות ספק מאושרים בשרת.'
    );
  }

  const { raw, body } = await readJsonBody(req);
  const signature = req.headers['x-isrunner-provider-signature'];
  if (!verifyWebhookSignature(webhookSecret, raw, signature)) {
    return sendError(res, 401, 'invalid_provider_signature', 'חתימת ספק לא תקינה או חסרה.');
  }

  const providerUserId = typeof body.provider_user_id === 'string' ? body.provider_user_id.trim() : '';
  const externalId = typeof body.external_activity_id === 'string' ? body.external_activity_id.trim() : '';
  const distanceKm = Number(body.distance_km);
  const durationSec = Math.round(Number(body.duration_sec));
  const ranAt = typeof body.ran_at === 'string' ? body.ran_at : '';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  const deviceName = typeof body.device_name === 'string' ? body.device_name.trim() : null;
  const isShared = body.is_shared === false ? 0 : 1;

  if (!providerUserId || !externalId) {
    return sendError(res, 400, 'missing_provider_ids', 'חסרים מזהי משתמש או פעילות מהספק.');
  }
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > 500) {
    return sendError(res, 400, 'invalid_distance', 'מרחק לא תקין.');
  }
  if (!Number.isInteger(durationSec) || durationSec <= 0 || durationSec > 604800) {
    return sendError(res, 400, 'invalid_duration', 'משך ריצה לא תקין.');
  }
  if (!ranAt || Number.isNaN(Date.parse(ranAt))) {
    return sendError(res, 400, 'invalid_ran_at', 'תאריך ריצה לא תקין.');
  }

  const conn = ctx.db
    .prepare(
      `SELECT pc.*, u.id AS uid, u.run_privacy
       FROM provider_connections pc
       JOIN users u ON u.id = pc.user_id
       WHERE pc.provider = ? AND pc.provider_user_id = ? AND pc.status = 'active'`
    )
    .get(provider, providerUserId);

  if (!conn) {
    return sendError(res, 404, 'connection_not_found', 'לא נמצא חיבור ספק פעיל למשתמש זה.');
  }

  const r = insertProviderRun(ctx.db, {
    userId: conn.user_id,
    runPrivacy: conn.run_privacy,
    provider,
    externalId,
    distanceKm,
    durationSec,
    ranAtIso: new Date(ranAt).toISOString(),
    note,
    deviceName,
    verified: 1,
    isShared,
  });

  if (r.duplicate) {
    return sendJson(res, 200, { ok: true, duplicate: true, run_id: r.runId });
  }

  ctx.db
    .prepare('UPDATE provider_connections SET last_sync_at = ? WHERE id = ?')
    .run(new Date().toISOString(), conn.id);

  const saved = ctx.db.prepare('SELECT * FROM runs WHERE id = ?').get(r.runId);
  return sendJson(res, 201, {
    ok: true,
    duplicate: false,
    run: decorateRun(saved, { includeNote: true }),
    notifications_sent: r.notificationsSent,
  });
      }
