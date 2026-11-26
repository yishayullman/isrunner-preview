import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDatabase } from '../src/db.mjs';
import { createApp } from '../src/app.mjs';
import { generateId, signWebhookPayload } from '../src/crypto.mjs';
import { matchesCategory } from '../src/ranking.mjs';

async function startTestServer(configOverrides = {}) {
  const db = openDatabase(':memory:');
  const handler = createApp({
    db,
    config: {
      cookieSecure: false,
      authRateLimit: 100,
      loginRateLimit: 100,
      ...configOverrides,
    },
  });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    db,
    server,
    baseUrl,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}

class TestClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
  }

  async req(path, { method = 'GET', body, headers = {}, omitOrigin = false } = {}) {
    const reqHeaders = { ...headers };
    if (this.cookie) reqHeaders.Cookie = this.cookie;
    if (!omitOrigin && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !reqHeaders.Origin) {
      reqHeaders.Origin = this.baseUrl;
    }
    let rawBody;
    if (body !== undefined) {
      reqHeaders['Content-Type'] = 'application/json';
      rawBody = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: reqHeaders,
      body: rawBody,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const pair = setCookie.split(';')[0];
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, json };
  }

  async register(username, display_name, password = 'Password123!', email = `${username}@example.com`) {
    const res = await this.req('/api/auth/register', {
      method: 'POST',
      body: { username, display_name, email, password },
    });
    assert.equal(res.status, 201, `register failed: ${JSON.stringify(res.json)}`);
    return res.json.user;
  }
}

function insertLegacyRun(db, userId, { distance_km, duration_sec, ran_at, note = '', is_shared = 1 }) {
  const id = generateId();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO runs (
      id, user_id, distance_km, duration_sec, ran_at, note, is_shared,
      first_shared_at, notifications_dispatched, source_type, source_verified,
      source_external_id, source_ingested_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'self_reported_legacy', 0, NULL, NULL, ?, ?)`
  ).run(id, userId, distance_km, duration_sec, ran_at, note, is_shared, is_shared ? ran_at : null, now, now);
  return id;
}

function createServerProviderConnection(db, userId, providerUserId) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO provider_connections (id, user_id, provider, provider_user_id, consent_version, consented_at, connected_at, status)
     VALUES (?, ?, 'garmin_connect', ?, '2026-draft-v1', ?, ?, 'active')`
  ).run(generateId(), userId, providerUserId, now, now);
}

test('Ranking boundary math: [nominal, nominal + 0.25) with zero float drift', () => {
  // 5k: 5.00 to < 5.25
  assert.equal(matchesCategory(4.999, '5k'), false);
  assert.equal(matchesCategory(5.0, '5k'), true);
  assert.equal(matchesCategory(5.24, '5k'), true);
  assert.equal(matchesCategory(5.2499, '5k'), true);
  assert.equal(matchesCategory(5.25, '5k'), false);

  // 10k: 10.00 to < 10.25
  assert.equal(matchesCategory(9.99, '10k'), false);
  assert.equal(matchesCategory(10.0, '10k'), true);
  assert.equal(matchesCategory(10.2499, '10k'), true);
  assert.equal(matchesCategory(10.25, '10k'), false);

  // Half marathon: 21.0975 to < 21.3475
  assert.equal(matchesCategory(21.0974, 'half'), false);
  assert.equal(matchesCategory(21.0975, 'half'), true);
  assert.equal(matchesCategory(21.3474, 'half'), true);
  assert.equal(matchesCategory(21.3475, 'half'), false);

  // Marathon: 42.195 to < 42.445
  assert.equal(matchesCategory(42.1949, 'marathon'), false);
  assert.equal(matchesCategory(42.195, 'marathon'), true);
  assert.equal(matchesCategory(42.4449, 'marathon'), true);
  assert.equal(matchesCategory(42.445, 'marathon'), false);
});

test('Auth, PBKDF2 hashing, Origin CSRF check, and login rate limiting', async () => {
  const srv = await startTestServer({ loginRateLimit: 3 });
  try {
    const c = new TestClient(srv.baseUrl);

    // Rejects short password
    const weak = await c.req('/api/auth/register', {
      method: 'POST',
      body: { username: 'shortpw', display_name: 'קצר', password: '1234567' },
    });
    assert.equal(weak.status, 400);

    // Rejects cross-origin and missing-origin write requests
    const badOrigin = await c.req('/api/auth/register', {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com' },
      body: { username: 'csrfuser', display_name: 'טסט', password: 'Password123!' },
    });
    assert.equal(badOrigin.status, 403);
    assert.equal(badOrigin.json.error, 'invalid_origin');

    const noOrigin = await c.req('/api/auth/register', {
      method: 'POST',
      omitOrigin: true,
      body: { username: 'csrfuser2', display_name: 'טסט', password: 'Password123!' },
    });
    assert.equal(noOrigin.status, 403);

    // Valid registration stores PBKDF2 100k salted hash
    const user = await c.register('dana_run', 'דנה רצה', 'MySecurePass99');
    const row = srv.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    assert.match(row.password_hash, /^pbkdf2\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);

    // Logout & rate limit login attempts
    const logout = await c.req('/api/auth/logout', { method: 'POST' });
    assert.equal(logout.status, 200);

    for (let i = 0; i < 3; i++) {
      const bad = await c.req('/api/auth/login', {
        method: 'POST',
        body: { username: 'dana_run', password: 'WrongPassword!' },
      });
      assert.equal(bad.status, 401);
    }
    const limited = await c.req('/api/auth/login', {
      method: 'POST',
      body: { username: 'dana_run', password: 'MySecurePass99' },
    });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  } finally {
    await srv.close();
  }
});

test('Manual run addition is hardcoded 403; provider ingestion requires server secret, valid HMAC, active connection & supports disconnect+delete', async () => {
  // 1) Without Garmin env credentials
  const srvNoCreds = await startTestServer();
  try {
    const c = new TestClient(srvNoCreds.baseUrl);
    const user = await c.register('runner_one', 'רץ אחד');

    // Manual POST /api/runs is ALWAYS 403 even if client tries spoofing source fields
    const manual = await c.req('/api/runs', {
      method: 'POST',
      body: {
        distance_km: 5.0,
        duration_sec: 1200,
        source_type: 'garmin_connect',
        source_verified: true,
      },
    });
    assert.equal(manual.status, 403);
    assert.match(manual.json.message, /הוספת ריצות סגורה כרגע/);

    // Sources reports honestly NOT connected
    const sources = await c.req('/api/sources');
    assert.equal(sources.status, 200);
    assert.equal(sources.json.has_any_connected_source, false);
    const garmin = sources.json.sources.find((s) => s.provider === 'garmin_connect');
    assert.equal(garmin.connected, false);
    assert.equal(garmin.server_configured, false);

    // Connect attempt returns 503 honestly
    const connectAttempt = await c.req('/api/sources/garmin/connect', {
      method: 'POST',
      body: { consent_accepted: true },
    });
    assert.equal(connectAttempt.status, 503);

    // Ingestion endpoint refuses when server secret is unconfigured
    const ingestAttempt = await c.req('/api/ingest/provider/garmin_connect', {
      method: 'POST',
      omitOrigin: true,
      body: {
        provider_user_id: 'g-1',
        external_activity_id: 'act-1',
        distance_km: 5.1,
        duration_sec: 1400,
        ran_at: new Date().toISOString(),
      },
    });
    assert.equal(ingestAttempt.status, 503);

    // Legacy run stays intact and explicitly unverified
    const legacyId = insertLegacyRun(srvNoCreds.db, user.id, {
      distance_km: 5.05,
      duration_sec: 1500,
      ran_at: new Date().toISOString(),
    });
    const runGet = await c.req(`/api/runs/${legacyId}`);
    assert.equal(runGet.status, 200);
    assert.equal(runGet.json.run.source.verified, false);
    assert.equal(runGet.json.run.source.label, 'דיווח עצמי, לא מאומת');
  } finally {
    await srvNoCreds.close();
  }

  // 2) With server-configured webhook secret in isolated test environment
  const secret = 'test-only-server-webhook-secret';
  const srvWithSecret = await startTestServer({
    garminConsumerKey: 'test-key',
    garminConsumerSecret: 'test-secret',
    garminWebhookSecret: secret,
  });
  try {
    const c = new TestClient(srvWithSecret.baseUrl);
    const user = await c.register('garmin_tester', 'בודק גרמין');
    const legacyId = insertLegacyRun(srvWithSecret.db, user.id, {
      distance_km: 5.1,
      duration_sec: 1600,
      ran_at: new Date().toISOString(),
    });
    createServerProviderConnection(srvWithSecret.db, user.id, 'garmin-user-42');

    const payloadObj = {
      provider_user_id: 'garmin-user-42',
      external_activity_id: 'garmin-act-1001',
      distance_km: 5.05,
      duration_sec: 1320,
      ran_at: new Date().toISOString(),
      note: 'סנכרון שעון',
    };
    const rawPayload = JSON.stringify(payloadObj);

    // Bad HMAC signature rejected (401)
    const badSig = await c.req('/api/ingest/provider/garmin_connect', {
      method: 'POST',
      omitOrigin: true,
      headers: { 'X-Isrunner-Provider-Signature': 'deadbeef' },
      body: rawPayload,
    });
    assert.equal(badSig.status, 401);

    // Valid HMAC signature succeeds (201)
    const sig = signWebhookPayload(secret, rawPayload);
    const okIngest = await c.req('/api/ingest/provider/garmin_connect', {
      method: 'POST',
      omitOrigin: true,
      headers: { 'X-Isrunner-Provider-Signature': sig },
      body: rawPayload,
    });
    assert.equal(okIngest.status, 201);
    assert.equal(okIngest.json.run.source.verified, true);
    assert.equal(okIngest.json.run.source.code, 'garmin_connect');

    // Duplicate external_activity_id is deduplicated (200 duplicate: true)
    const dupIngest = await c.req('/api/ingest/provider/garmin_connect', {
      method: 'POST',
      omitOrigin: true,
      headers: { 'X-Isrunner-Provider-Signature': sig },
      body: rawPayload,
    });
    assert.equal(dupIngest.status, 200);
    assert.equal(dupIngest.json.duplicate, true);

    // Disconnect + delete source runs removes ONLY garmin runs, preserving legacy self-reported runs!
    const disc = await c.req('/api/sources/garmin_connect/disconnect', {
      method: 'POST',
      body: { delete_source_runs: true },
    });
    assert.equal(disc.status, 200);
    assert.equal(disc.json.disconnected, true);
    assert.equal(disc.json.deleted_source_runs, 1);

    const remainingRuns = await c.req('/api/runs');
    assert.equal(remainingRuns.json.runs.length, 1);
    assert.equal(remainingRuns.json.runs[0].id, legacyId);
    assert.equal(remainingRuns.json.runs[0].source.verified, false);
  } finally {
    await srvWithSecret.close();
  }
});

test('Three privacy levels (everyone / friends / none), global leaderboard opt-out, and private run enforcement on every endpoint', async () => {
  const srv = await startTestServer();
  try {
    const ownerClient = new TestClient(srv.baseUrl);
    const friendClient = new TestClient(srv.baseUrl);
    const strangerClient = new TestClient(srv.baseUrl);

    const owner = await ownerClient.register('owner_u', 'בעלים');
    const friend = await friendClient.register('friend_u', 'חבר');
    const stranger = await strangerClient.register('stranger_u', 'זר');

    // Make owner and friend accepted friends
    await ownerClient.req('/api/friends/requests', {
      method: 'POST',
      body: { target_user_id: friend.id },
    });
    await friendClient.req(`/api/friends/requests/${owner.id}`, {
      method: 'PATCH',
      body: { action: 'accept' },
    });

    const recentIso = new Date(Date.now() - 3600_000).toISOString();
    // Shared 5k run (22:00)
    const sharedRunId = insertLegacyRun(srv.db, owner.id, {
      distance_km: 5.1,
      duration_sec: 1320,
      ran_at: recentIso,
      is_shared: 1,
    });
    // Faster PRIVATE 5k run (18:00 — recovery/private) — MUST NEVER leak to others or leaderboards!
    const privateRunId = insertLegacyRun(srv.db, owner.id, {
      distance_km: 5.05,
      duration_sec: 1080,
      ran_at: recentIso,
      is_shared: 0,
    });
    // Anomalous fast 10k shared run (20:00 -> 2:00/km) — MUST be flagged, NOT blocked!
    const anomalousRunId = insertLegacyRun(srv.db, owner.id, {
      distance_km: 10.1,
      duration_sec: 1200,
      ran_at: recentIso,
      is_shared: 1,
    });

    // Create a group containing owner, friend, and stranger
    const grp = await ownerClient.req('/api/groups', {
      method: 'POST',
      body: { name: 'קבוצת בדיקה' },
    });
    const code = grp.json.group.join_code;
    const groupId = grp.json.group.id;
    await friendClient.req('/api/groups/join', { method: 'POST', body: { join_code: code } });
    await strangerClient.req('/api/groups/join', { method: 'POST', body: { join_code: code } });

    // --- Check PRIVATE RUN rules (even when run_privacy = 'everyone') ---
    // Owner CAN view own private run and sees 18:00 in own PRs
    const ownerSelfRun = await ownerClient.req(`/api/runs/${privateRunId}`);
    assert.equal(ownerSelfRun.status, 200);
    const ownerSelfProfile = await ownerClient.req(`/api/users/${owner.id}`);
    assert.equal(ownerSelfProfile.json.personal_records.find((p) => p.key === '5k').record.duration_sec, 1080);

    // Friend & stranger CANNOT access private run directly
    assert.equal((await friendClient.req(`/api/runs/${privateRunId}`)).status, 404);
    assert.equal((await strangerClient.req(`/api/runs/${privateRunId}`)).status, 404);

    // Friend & stranger CANNOT report private run
    const reportPrivate = await friendClient.req('/api/reports', {
      method: 'POST',
      body: { target_type: 'run', target_run_id: privateRunId, reason: 'anomalous_result' },
    });
    assert.equal(reportPrivate.status, 404);

    // Friend & stranger CAN report visible shared run
    const reportShared = await friendClient.req('/api/reports', {
      method: 'POST',
      body: { target_type: 'run', target_run_id: sharedRunId, reason: 'other', details: 'בדיקה' },
    });
    assert.equal(reportShared.status, 201);

    // Others' view of owner's PRs sees ONLY the shared 22:00 (1320s), NEVER private 18:00 (1080s)
    const friendSeesOwner = await friendClient.req(`/api/users/${owner.id}`);
    assert.equal(friendSeesOwner.json.personal_records.length, 5);
    assert.equal(friendSeesOwner.json.personal_records.find((p) => p.key === '5k').record.duration_sec, 1320);
    assert.equal(friendSeesOwner.json.runs.some((r) => r.id === privateRunId), false);

    // Global & Group leaderboards show shared 1320s, NEVER private 1080s
    const globalLb5k = await strangerClient.req('/api/leaderboard?category=5k');
    assert.equal(globalLb5k.json.entries.length, 1);
    assert.equal(globalLb5k.json.entries[0].duration_sec, 1320);

    const groupLb5k = await strangerClient.req(`/api/groups/${groupId}?category=5k`);
    assert.equal(groupLb5k.json.entries.length, 1);
    assert.equal(groupLb5k.json.entries[0].duration_sec, 1320);

    // Anomalous 10k run is present in leaderboard and flagged (NOT blocked!)
    const globalLb10k = await strangerClient.req('/api/leaderboard?category=10k');
    assert.equal(globalLb10k.json.entries.length, 1);
    assert.equal(globalLb10k.json.entries[0].run_id, anomalousRunId);
    assert.equal(globalLb10k.json.entries[0].is_anomalous_pace, true);

    // --- LEVEL 1: everyone + show_in_global_leaderboard = false ---
    await ownerClient.req('/api/me/settings', {
      method: 'PATCH',
      body: { run_privacy: 'everyone', show_in_global_leaderboard: false },
    });
    assert.equal((await strangerClient.req('/api/leaderboard?category=5k')).json.entries.length, 0);
    // Still visible on profile because run_privacy = 'everyone'
    assert.equal((await strangerClient.req(`/api/users/${owner.id}`)).json.profile.can_view_runs, true);

    // Re-enable global leaderboard and test LEVEL 2: friends ---
    await ownerClient.req('/api/me/settings', {
      method: 'PATCH',
      body: { run_privacy: 'friends', show_in_global_leaderboard: true },
    });
    // Friend still sees profile runs, PRs, direct run link, group leaderboard
    const fProf = await friendClient.req(`/api/users/${owner.id}`);
    assert.equal(fProf.json.profile.can_view_runs, true);
    assert.equal(fProf.json.personal_records.find((p) => p.key === '5k').record.duration_sec, 1320);
    assert.equal((await friendClient.req(`/api/runs/${sharedRunId}`)).status, 200);
    assert.equal((await friendClient.req(`/api/groups/${groupId}?category=5k`)).json.entries.length, 1);

    // Stranger CANNOT see profile runs, PRs (all null), direct link, global lb, or group lb!
    const sProf = await strangerClient.req(`/api/users/${owner.id}`);
    assert.equal(sProf.json.profile.can_view_runs, false);
    assert.equal(sProf.json.runs.length, 0);
    assert.equal(sProf.json.personal_records.length, 5);
    assert.ok(sProf.json.personal_records.every((p) => p.record === null));
    assert.equal((await strangerClient.req(`/api/runs/${sharedRunId}`)).status, 404);
    assert.equal((await strangerClient.req('/api/leaderboard?category=5k')).json.entries.length, 0);
    assert.equal((await strangerClient.req(`/api/groups/${groupId}?category=5k`)).json.entries.length, 0);

    // --- LEVEL 3: none ---
    await ownerClient.req('/api/me/settings', {
      method: 'PATCH',
      body: { run_privacy: 'none', show_in_global_leaderboard: true },
    });
    // Now even accepted FRIEND cannot see runs, PRs, direct link, activity feed, or leaderboards!
    const fProfNone = await friendClient.req(`/api/users/${owner.id}`);
    assert.equal(fProfNone.json.profile.can_view_runs, false);
    assert.equal(fProfNone.json.runs.length, 0);
    assert.ok(fProfNone.json.personal_records.every((p) => p.record === null));
    assert.equal((await friendClient.req(`/api/runs/${sharedRunId}`)).status, 404);
    assert.equal((await friendClient.req('/api/home')).json.friends_activity.length, 0);
    assert.equal((await friendClient.req(`/api/groups/${groupId}?category=5k`)).json.entries.length, 0);
  } finally {
    await srv.close();
  }
});

test('In-app notifications: first share only, excludes note, no old runs, no re-send, immediate removal on unshare/unfriend/block/delete', async () => {
  const secret = 'notif-test-secret';
  const srv = await startTestServer({
    garminConsumerKey: 'k',
    garminConsumerSecret: 's',
    garminWebhookSecret: secret,
  });

  async function ingestRun(providerUserId, extId, { ranAt, note = 'הערה סודית', is_shared = true }) {
    const raw = JSON.stringify({
      provider_user_id: providerUserId,
      external_activity_id: extId,
      distance_km: 5.12,
      duration_sec: 1400,
      ran_at: ranAt,
      note,
      is_shared,
    });
    const sig = signWebhookPayload(secret, raw);
    const res = await fetch(`${srv.baseUrl}/api/ingest/provider/garmin_connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Isrunner-Provider-Signature': sig,
      },
      body: raw,
    });
    return { status: res.status, json: await res.json() };
  }

  try {
    const runnerC = new TestClient(srv.baseUrl);
    const friend1C = new TestClient(srv.baseUrl);
    const friend2C = new TestClient(srv.baseUrl);
    const friend3C = new TestClient(srv.baseUrl);

    const runner = await runnerC.register('r_main', 'רץ ראשי');
    const f1 = await friend1C.register('f_one', 'חבר 1');
    const f2 = await friend2C.register('f_two', 'חבר 2');
    const f3 = await friend3C.register('f_three', 'חבר 3');

    for (const [fc, fu] of [
      [friend1C, f1],
      [friend2C, f2],
      [friend3C, f3],
    ]) {
      await runnerC.req('/api/friends/requests', {
        method: 'POST',
        body: { target_user_id: fu.id },
      });
      await fc.req(`/api/friends/requests/${runner.id}`, {
        method: 'PATCH',
        body: { action: 'accept' },
      });
    }

    createServerProviderConnection(srv.db, runner.id, 'g-main');

    // 1) Old run (> 14 days ago) MUST NOT send notifications
    const oldIso = new Date(Date.now() - 20 * 86400_000).toISOString();
    const oldRes = await ingestRun('g-main', 'old-1', { ranAt: oldIso });
    assert.equal(oldRes.status, 201);
    assert.equal(oldRes.json.notifications_sent, 0);
    assert.equal((await friend1C.req('/api/notifications')).json.notifications.length, 0);

    // 2) Fresh shared run sends 1 notification per current friend, WITHOUT run note!
    const freshIso = new Date(Date.now() - 3600_000).toISOString();
    const run1Res = await ingestRun('g-main', 'fresh-1', {
      ranAt: freshIso,
      note: 'הערה פרטית שלא תופיע בהתראה',
    });
    assert.equal(run1Res.status, 201);
    assert.equal(run1Res.json.notifications_sent, 3);
    const run1Id = run1Res.json.run.id;

    const f1Notifs = await friend1C.req('/api/notifications');
    assert.equal(f1Notifs.json.unread_count, 1);
    assert.equal(f1Notifs.json.notifications.length, 1);
    assert.equal(f1Notifs.json.notifications[0].note, undefined);
    assert.equal(JSON.stringify(f1Notifs.json.notifications[0]).includes('הערה פרטית'), false);

    // Mark read works
    await friend1C.req(`/api/notifications/${f1Notifs.json.notifications[0].id}/read`, {
      method: 'POST',
    });
    assert.equal((await friend1C.req('/api/notifications')).json.unread_count, 0);

    // 3) Unsharing IMMEDIATELY deletes notification & revokes access, and re-sharing does NOT re-send!
    await runnerC.req(`/api/runs/${run1Id}/share`, {
      method: 'PATCH',
      body: { is_shared: false },
    });
    assert.equal((await friend1C.req('/api/notifications')).json.notifications.length, 0);
    assert.equal((await friend2C.req('/api/notifications')).json.notifications.length, 0);
    assert.equal((await friend1C.req(`/api/runs/${run1Id}`)).status, 404);

    const reshare = await runnerC.req(`/api/runs/${run1Id}/share`, {
      method: 'PATCH',
      body: { is_shared: true },
    });
    assert.equal(reshare.json.notifications_sent, 0);
    assert.equal((await friend1C.req('/api/notifications')).json.notifications.length, 0);

    // 4) Second fresh run to test immediate cleanup on remove friend, block, and delete run
    const run2Res = await ingestRun('g-main', 'fresh-2', { ranAt: freshIso });
    const run2Id = run2Res.json.run.id;
    assert.equal(run2Res.json.notifications_sent, 3);

    // Remove friend1 -> friend1's notification immediately removed
    await runnerC.req(`/api/friends/${f1.id}`, { method: 'DELETE' });
    assert.equal((await friend1C.req('/api/notifications')).json.notifications.length, 0);

    // Block friend2 -> friend2's notification immediately removed & access revoked
    await runnerC.req(`/api/blocks/${f2.id}`, { method: 'POST' });
    assert.equal((await friend2C.req('/api/notifications')).json.notifications.length, 0);
    assert.equal((await friend2C.req(`/api/runs/${run2Id}`)).status, 404);

    // Delete run -> friend3's notification immediately removed
    assert.equal((await friend3C.req('/api/notifications')).json.notifications.length, 1);
    await runnerC.req(`/api/runs/${run2Id}`, { method: 'DELETE' });
    assert.equal((await friend3C.req('/api/notifications')).json.notifications.length, 0);

    // 5) Switching run_privacy to 'none' immediately removes actor's notifications at friends
    const run3Res = await ingestRun('g-main', 'fresh-3', { ranAt: freshIso });
    assert.equal(run3Res.status, 201);
    assert.equal((await friend3C.req('/api/notifications')).json.notifications.length, 1);

    await runnerC.req('/api/me/settings', { method: 'PATCH', body: { run_privacy: 'none' } });
    assert.equal((await friend3C.req('/api/notifications')).json.notifications.length, 0);

    // 6) PATCH /api/runs/:id/note ONLY modifies note, never distance/duration/source
    const notePatch = await runnerC.req(`/api/runs/${run3Res.json.run.id}/note`, {
      method: 'PATCH',
      body: {
        note: 'הערה מעודכנת',
        distance_km: 42.2,
        duration_sec: 100,
        source_type: 'self_reported_legacy',
        source_verified: false,
      },
    });
    assert.equal(notePatch.status, 200);
    assert.equal(notePatch.json.run.note, 'הערה מעודכנת');
    assert.equal(notePatch.json.run.distance_km, 5.12);
    assert.equal(notePatch.json.run.duration_sec, 1400);
    assert.equal(notePatch.json.run.source.verified, true);
  } finally {
    await srv.close();
  }
});

test('Groups: create, preview by join code, join, leave with ownership transfer', async () => {
  const srv = await startTestServer();
  try {
    const a = new TestClient(srv.baseUrl);
    const b = new TestClient(srv.baseUrl);
    await a.register('grp_owner', 'מנהלת');
    const userB = await b.register('grp_member', 'חבר קבוצה');

    const created = await a.req('/api/groups', {
      method: 'POST',
      body: { name: 'רצי הצפון', description: 'ריצות בוקר' },
    });
    assert.equal(created.status, 201);
    const { id: groupId, join_code: code } = created.json.group;

    // Preview before joining
    const preview = await b.req(`/api/groups/preview?code=${code}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.json.preview.name, 'רצי הצפון');
    assert.equal(preview.json.preview.member_count, 1);
    assert.equal(preview.json.preview.already_member, false);

    // Non-member cannot read group leaderboard before joining
    assert.equal((await b.req(`/api/groups/${groupId}`)).status, 403);

    // Join & read group detail
    assert.equal(
      (await b.req('/api/groups/join', { method: 'POST', body: { join_code: code } })).status,
      200
    );
    const detail = await b.req(`/api/groups/${groupId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.members.length, 2);

    // Owner leaves -> ownership transfers cleanly to userB
    const leave = await a.req(`/api/groups/${groupId}/leave`, { method: 'POST' });
    assert.equal(leave.status, 200);
    assert.equal(leave.json.ownership_transferred, true);

    const after = await b.req(`/api/groups/${groupId}`);
    assert.equal(after.json.group.owner_id, userB.id);
    assert.equal(after.json.group.my_role, 'owner');
  } finally {
    await srv.close();
  }
});

test('Email support, honest password reset 503, and account deletion (anonymized reports, reserved username, group ownership transfer)', async () => {
  const srv = await startTestServer();
  try {
    const a = new TestClient(srv.baseUrl);
    const b = new TestClient(srv.baseUrl);

    // Register with email
    const regA = await a.req('/api/auth/register', {
      method: 'POST',
      body: {
        username: 'owner_del',
        display_name: 'מוחק חשבון',
        email: 'runner@example.com',
        password: 'DeleteMe123!',
      },
    });
    assert.equal(regA.status, 201);
    assert.equal(regA.json.user.email, 'runner@example.com');
    const userA = regA.json.user;

    // Duplicate email rejected
    const dupEmail = await b.req('/api/auth/register', {
      method: 'POST',
      body: {
        username: 'other_user',
        display_name: 'אחר',
        email: 'RUNNER@example.com',
        password: 'Password123!',
      },
    });
    assert.equal(dupEmail.status, 409);
    assert.equal(dupEmail.json.error, 'email_taken');

    const userB = await b.register('member_stay', 'נשארת בקבוצה');

    // Password reset honestly returns 503 until an email provider is configured
    const pwReset = await b.req('/api/auth/password-reset/request', {
      method: 'POST',
      body: { email: 'runner@example.com' },
    });
    assert.equal(pwReset.status, 503);

    // User A creates a group and User B joins
    const grp = await a.req('/api/groups', { method: 'POST', body: { name: 'קבוצת המשך' } });
    const groupId = grp.json.group.id;
    await b.req('/api/groups/join', {
      method: 'POST',
      body: { join_code: grp.json.group.join_code },
    });

    // User A submits a report on User B
    const rep = await a.req('/api/reports', {
      method: 'POST',
      body: { target_type: 'user', target_user_id: userB.id, reason: 'other', details: 'דיווח לבדיקה' },
    });
    assert.equal(rep.status, 201);
    const reportId = rep.json.report_id;

    // Wrong password rejected on account delete
    const badDel = await a.req('/api/me/account', {
      method: 'DELETE',
      body: { password: 'WrongPassword!' },
    });
    assert.equal(badDel.status, 401);

    // Valid account deletion
    const delRes = await a.req('/api/me/account', {
      method: 'DELETE',
      body: { password: 'DeleteMe123!' },
    });
    assert.equal(delRes.status, 200);
    assert.equal(delRes.json.transferred_groups, 1);

    // 1) Report still exists in anonymized form (reporter_id = NULL)
    const savedRep = srv.db.prepare('SELECT reporter_id, reason FROM reports WHERE id = ?').get(reportId);
    assert.ok(savedRep);
    assert.equal(savedRep.reporter_id, null);
    assert.equal(savedRep.reason, 'other');

    // 2) Username remains reserved to prevent impersonation
    const reuse = await new TestClient(srv.baseUrl).req('/api/auth/register', {
      method: 'POST',
      body: { username: 'owner_del', display_name: 'מתחזה', email: 'impostor@example.com', password: 'Password123!' },
    });
    assert.equal(reuse.status, 409);
    assert.equal(reuse.json.error, 'username_taken');

    // 3) Group ownership transferred automatically to userB
    const grpAfter = await b.req(`/api/groups/${groupId}`);
    assert.equal(grpAfter.status, 200);
    assert.equal(grpAfter.json.group.owner_id, userB.id);
    assert.equal(grpAfter.json.group.my_role, 'owner');
  } finally {
    await srv.close();
  }
});

test('Change password invalidates other device sessions, logout-all revokes all sessions, and Home returns 6-week history + Leaderboard returns my_entry', async () => {
  const srv = await startTestServer();
  try {
    const dev1 = new TestClient(srv.baseUrl);
    const dev2 = new TestClient(srv.baseUrl);

    const user = await dev1.register('sec_runner', 'רצה מאובטחת', 'InitialPass1!');
    const login2 = await dev2.req('/api/auth/login', {
      method: 'POST',
      body: { username: 'sec_runner', password: 'InitialPass1!' },
    });
    assert.equal(login2.status, 200);

    // Insert a run this week so 6-week history & my_entry are populated
    insertLegacyRun(srv.db, user.id, {
      distance_km: 5.1,
      duration_sec: 1400,
      ran_at: new Date().toISOString(),
      is_shared: 1,
    });

    const home = await dev1.req('/api/home');
    assert.equal(home.status, 200);
    assert.equal(home.json.weekly_history.length, 6);
    assert.equal(home.json.weekly_history[5].is_current, true);
    assert.equal(home.json.weekly_history[5].km, 5.1);

    const lb = await dev1.req('/api/leaderboard?category=5k');
    assert.equal(lb.status, 200);
    assert.equal(lb.json.my_entry.rank, 1);
    assert.equal(lb.json.my_entry.user_id, user.id);

    // Change password from dev1 -> dev1 stays logged in, dev2 is IMMEDIATELY revoked!
    const chpw = await dev1.req('/api/me/password', {
      method: 'POST',
      body: { current_password: 'InitialPass1!', new_password: 'NewStrongPass2!' },
    });
    assert.equal(chpw.status, 200);

    assert.equal((await dev1.req('/api/home')).status, 200);
    assert.equal((await dev2.req('/api/home')).status, 401);

    // Logout-all revokes dev1 as well
    const la = await dev1.req('/api/auth/logout-all', { method: 'POST' });
    assert.equal(la.status, 200);
    assert.equal((await dev1.req('/api/home')).status, 401);

    // New password logs in cleanly
    const relogin = await dev2.req('/api/auth/login', {
      method: 'POST',
      body: { username: 'sec_runner', password: 'NewStrongPass2!' },
    });
    assert.equal(relogin.status, 200);
  } finally {
    await srv.close();
  }
});

test('Anti-duplicate signup: email required, disposable emails blocked, Gmail dot/+tag aliases deduplicated, and Resend 6-digit OTP gates leaderboard', async () => {
  const sentEmails = [];
  const fakeFetch = async (url, init) => {
    if (String(url).startsWith('https://api.resend.com/emails')) {
      sentEmails.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: 're_test_123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const srv = await startTestServer({
    resendApiKey: 're_test_key',
    emailFrom: 'Isrunner <noreply@isrunner.test>',
    fetchImpl: fakeFetch,
  });

  try {
    const c1 = new TestClient(srv.baseUrl);
    const c2 = new TestClient(srv.baseUrl);

    // 1. Missing email rejected
    const noEmail = await c1.req('/api/auth/register', {
      method: 'POST',
      body: { username: 'no_email_u', display_name: 'ללא מייל', password: 'Password123!' },
    });
    assert.equal(noEmail.status, 400);
    assert.equal(noEmail.json.error, 'missing_email');

    // 2. Disposable email blocked
    const disp = await c1.req('/api/auth/register', {
      method: 'POST',
      body: {
        username: 'temp_u',
        display_name: 'מייל זמני',
        email: 'fake@10minutemail.com',
        password: 'Password123!',
      },
    });
    assert.equal(disp.status, 400);
    assert.equal(disp.json.error, 'disposable_email');

    // 3. Valid registration triggers real Resend OTP email
    const reg1 = await c1.req('/api/auth/register', {
      method: 'POST',
      body: {
        username: 'yishay_real',
        display_name: 'ישי',
        email: 'yishay.runner@gmail.com',
        password: 'Password123!',
      },
    });
    assert.equal(reg1.status, 201);
    assert.equal(reg1.json.email_verification_enabled, true);
    assert.equal(reg1.json.verification_code_sent, true);
    assert.equal(reg1.json.user.email_verified, false);
    assert.equal(sentEmails.length, 1);

    // 4. Gmail dot-trick + +tag alias + googlemail.com all blocked as duplicates!
    for (const alias of [
      'yishayrunner+top2@gmail.com',
      'y.i.s.h.a.y.r.u.n.n.e.r@gmail.com',
      'yishayrunner+3@googlemail.com',
    ]) {
      const dup = await c2.req('/api/auth/register', {
        method: 'POST',
        body: {
          username: `alt_${Math.random().toString(36).slice(2, 7)}`,
          display_name: 'כפיל',
          email: alias,
          password: 'Password123!',
        },
      });
      assert.equal(dup.status, 409, `Expected 409 for alias ${alias}`);
      assert.equal(dup.json.error, 'email_taken');
    }

    // 5. Cannot clear email from settings once set
    const clearEmail = await c1.req('/api/me/settings', {
      method: 'PATCH',
      body: { email: '' },
    });
    assert.equal(clearEmail.status, 400);
    assert.equal(clearEmail.json.error, 'email_required');

    // 6. Insert TWO fast 5K runs for the same user
    insertLegacyRun(srv.db, reg1.json.user.id, {
      distance_km: 5.05,
      duration_sec: 1200,
      ran_at: new Date().toISOString(),
    });
    insertLegacyRun(srv.db, reg1.json.user.id, {
      distance_km: 5.1,
      duration_sec: 1150,
      ran_at: new Date().toISOString(),
    });

    // Before email verification, leaderboard hides unverified account when Resend is enabled
    const lbBefore = await c1.req('/api/leaderboard?category=5k');
    assert.equal(lbBefore.status, 200);
    assert.equal(lbBefore.json.requires_email_verification, true);
    assert.equal(lbBefore.json.viewer_email_verified, false);
    assert.equal(lbBefore.json.entries.length, 0);

    // Extract 6-digit OTP code from sent email
    const codeMatch = sentEmails[0].text.match(/\b(\d{6})\b/);
    assert.ok(codeMatch, 'Expected 6-digit code in email body');
    const code = codeMatch[1];

    // Wrong code rejected
    const wrong = await c1.req('/api/auth/email/verify-code', {
      method: 'POST',
      body: { code: code === '000000' ? '111111' : '000000' },
    });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.json.error, 'invalid_code');

    // Correct code verifies email
    const okVerify = await c1.req('/api/auth/email/verify-code', {
      method: 'POST',
      body: { code },
    });
    assert.equal(okVerify.status, 200);
    assert.equal(okVerify.json.user.email_verified, true);

    // Now appears in leaderboard — and ONLY ONCE (best of the two runs: 1150 sec)!
    const lbAfter = await c1.req('/api/leaderboard?category=5k');
    assert.equal(lbAfter.status, 200);
    assert.equal(lbAfter.json.viewer_email_verified, true);
    assert.equal(lbAfter.json.entries.length, 1);
    assert.equal(lbAfter.json.entries[0].duration_sec, 1150);
  } finally {
    await srv.close();
  }
});
