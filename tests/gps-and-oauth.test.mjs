import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db.mjs';
import { createApp } from '../src/app.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function makeGpsTrack({ startLat = 32.0853, startLng = 34.7818, totalSteps = 120, stepLat = 0.00016, stepMs = 5000, pauseAt = 60, pauseMs = 120_000 }) {
  // ~17.8 m per 5 sec => ~3.56 m/s (~4:41 /km), 120 steps ~= 2.12 km in ~10 min active + 2 min paused
  const pts = [];
  let ts = Date.now() - 1_200_000;
  let lat = startLat;
  let seg = 0;
  for (let i = 0; i <= totalSteps; i += 1) {
    if (i === pauseAt) {
      ts += pauseMs;
      seg += 1;
    }
    pts.push({ lat, lng: startLng, ts, acc: 8, seg });
    lat += stepLat;
    ts += stepMs;
  }
  return pts;
}

async function startNodeServer(config = {}) {
  const db = openDatabase(':memory:');
  const server = http.createServer(createApp({ db, config }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    db,
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

class Client {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
  }
  async req(pathUrl, { method = 'GET', body, redirect = 'manual' } = {}) {
    const headers = { Origin: this.baseUrl };
    if (this.cookies.size > 0) {
      headers.Cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    let payload;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${this.baseUrl}${pathUrl}`, { method, headers, body: payload, redirect });
    for (const sc of res.headers.getSetCookie?.() || []) {
      const [pair] = sc.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const k = pair.slice(0, eq).trim();
        const v = pair.slice(eq + 1).trim();
        if (v) this.cookies.set(k, v);
        else this.cookies.delete(k);
      }
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, headers: res.headers, json, text };
  }
}

test('Node: In-App GPS Run recomputes distance, net moving duration (ignoring pause), 1-km splits, route polyline & rejects teleports', async () => {
  const srv = await startNodeServer();
  try {
    const u1 = new Client(srv.baseUrl);
    await u1.req('/api/auth/register', {
      method: 'POST',
      body: { username: 'gps_runner', display_name: 'רץ GPS', email: 'gps_runner@example.com', password: 'Password123!' },
    });

    // Manual POST /api/runs MUST remain hardcoded 403
    const manualRes = await u1.req('/api/runs', {
      method: 'POST',
      body: { distance_km: 5, duration_sec: 1200 },
    });
    assert.equal(manualRes.status, 403);

    // Reject spoofed teleport GPS track
    const now = Date.now() - 60_000;
    const spoofRes = await u1.req('/api/runs/gps', {
      method: 'POST',
      body: {
        points: [
          { lat: 32.0853, lng: 34.7818, ts: now, acc: 5, seg: 0 },
          { lat: 32.1853, lng: 34.7818, ts: now + 5000, acc: 5, seg: 0 }, // 11 km in 5 sec!
          { lat: 32.1855, lng: 34.7818, ts: now + 10000, acc: 5, seg: 0 },
        ],
      },
    });
    assert.equal(spoofRes.status, 400);

    // Valid 2.1 km run with a 2-minute pause in the middle
    const points = makeGpsTrack({});
    const saveRes = await u1.req('/api/runs/gps', {
      method: 'POST',
      body: {
        points,
        note: 'ריצת בוקר בפארק',
        is_shared: true,
        device_name: 'iPhone Safari GPS',
      },
    });
    assert.equal(saveRes.status, 201, JSON.stringify(saveRes.json));
    const run = saveRes.json.run;
    assert.equal(run.source.code, 'app_gps');
    assert.equal(run.source.verified, true);
    assert.ok(run.distance_km > 2.0 && run.distance_km < 2.25, `Unexpected km: ${run.distance_km}`);
    // Pause of 120s MUST NOT be counted in duration_sec (~595s active, not 715s!)
    assert.ok(run.duration_sec >= 580 && run.duration_sec <= 610, `Unexpected dur: ${run.duration_sec}`);
    assert.equal(run.splits.length, 2, `Expected 2 full km splits, got ${run.splits.length}`);
    assert.ok(run.route_polyline.length >= 20 && run.route_polyline.length <= 120);
    assert.equal(run.device_name, 'iPhone Safari GPS');

    // Detail endpoint returns splits + route polyline
    const detail = await u1.req(`/api/runs/${run.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.run.splits.length, 2);
    assert.ok(detail.json.run.route_polyline.length >= 20);
  } finally {
    await srv.close();
  }
});

test('Node: Real Garmin Connect OAuth 2.0 PKCE + Push Webhook & Real Strava OAuth 2.0 + Sync + Token Refresh + Webhook', async () => {
  const fetchCalls = [];
  let stravaSyncPhase = 1;

  const mockFetch = async (urlStr, opts = {}) => {
    fetchCalls.push({ url: urlStr, method: opts.method || 'GET', body: opts.body });
    // Garmin token exchange
    if (urlStr === 'https://diauth.garmin.com/di-oauth2-service/oauth/token') {
      const params = new URLSearchParams(opts.body);
      assert.equal(params.get('grant_type'), 'authorization_code');
      assert.ok((params.get('code_verifier') || '').length >= 43, 'PKCE code_verifier required');
      return new Response(
        JSON.stringify({ access_token: 'garmin_at_1', refresh_token: 'garmin_rt_1', expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (urlStr === 'https://apis.garmin.com/wellness-api/rest/user/id') {
      return new Response(JSON.stringify({ userId: 'garmin_u_999' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (urlStr === 'https://apis.garmin.com/wellness-api/rest/user/registration') {
      return new Response('', { status: 204 });
    }
    // Strava token exchange & refresh
    if (urlStr === 'https://www.strava.com/oauth/token') {
      const parsed = JSON.parse(opts.body);
      if (parsed.grant_type === 'authorization_code') {
        return new Response(
          JSON.stringify({
            access_token: 'strava_at_1',
            refresh_token: 'strava_rt_1',
            // Already near-expired so next sync exercises refresh_token!
            expires_at: Math.floor(Date.now() / 1000) + 60,
            athlete: { id: 777123, username: 'yishay_runs', firstname: 'Yishay' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      assert.equal(parsed.grant_type, 'refresh_token');
      return new Response(
        JSON.stringify({
          access_token: 'strava_at_refreshed',
          refresh_token: 'strava_rt_2',
          expires_at: Math.floor(Date.now() / 1000) + 21600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (urlStr.startsWith('https://www.strava.com/api/v3/athlete/activities')) {
      const base = [
        {
          id: 5001,
          type: 'Run',
          sport_type: 'Run',
          name: 'Morning 5K',
          distance: 5120,
          moving_time: 1310,
          start_date: new Date(Date.now() - 86400000).toISOString(),
          device_name: 'Garmin Forerunner 265',
          manual: false,
        },
        {
          id: 5002,
          type: 'Run',
          sport_type: 'Run',
          name: 'Manual treadmill entry',
          distance: 6000,
          moving_time: 1800,
          start_date: new Date(Date.now() - 172800000).toISOString(),
          manual: true,
        },
        {
          id: 5003,
          type: 'Ride',
          sport_type: 'Ride',
          name: 'Cycling ignored',
          distance: 25000,
          moving_time: 3600,
          start_date: new Date().toISOString(),
        },
      ];
      if (stravaSyncPhase >= 2) {
        base.push({
          id: 5004,
          type: 'Run',
          sport_type: 'TrailRun',
          name: 'Trail 10K',
          distance: 10150,
          moving_time: 2800,
          start_date: new Date(Date.now() - 3600000).toISOString(),
          device_name: 'Garmin Fenix 7',
          manual: false,
        });
      }
      return new Response(JSON.stringify(base), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (urlStr === 'https://www.strava.com/api/v3/activities/5005') {
      return new Response(
        JSON.stringify({
          id: 5005,
          type: 'Run',
          sport_type: 'Run',
          name: 'Webhook 5K',
          distance: 5050,
          moving_time: 1250,
          start_date: new Date().toISOString(),
          device_name: 'Garmin Forerunner 965',
          manual: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (urlStr === 'https://www.strava.com/oauth/revoke') {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    throw new Error(`Unexpected fetch URL: ${urlStr}`);
  };

  const srv = await startNodeServer({
    garminClientId: 'g_cid',
    garminClientSecret: 'g_sec',
    garminWebhookSecret: 'g_wh_sec',
    stravaClientId: 's_cid',
    stravaClientSecret: 's_sec',
    stravaWebhookVerifyToken: 's_verify_tok',
    fetchImpl: mockFetch,
  });

  try {
    const u = new Client(srv.baseUrl);
    await u.req('/api/auth/register', {
      method: 'POST',
      body: { username: 'oauth_runner', display_name: 'רץ מחובר', email: 'oauth_runner@example.com', password: 'Password123!' },
    });

    // 1. Garmin OAuth 2.0 PKCE start -> callback
    const gStart = await u.req('/api/sources/garmin/connect', {
      method: 'POST',
      body: { consent_accepted: true },
    });
    assert.equal(gStart.status, 200);
    const gAuthUrl = new URL(gStart.json.authorize_url);
    assert.equal(gAuthUrl.origin + gAuthUrl.pathname, 'https://connect.garmin.com/oauth2Confirm');
    assert.equal(gAuthUrl.searchParams.get('code_challenge_method'), 'S256');
    const gState = gAuthUrl.searchParams.get('state');
    assert.ok(gState);

    const gCb = await u.req(`/api/oauth/garmin/callback?code=g_code_1&state=${encodeURIComponent(gState)}`);
    assert.equal(gCb.status, 302);
    assert.equal(gCb.headers.get('location'), '/#/sources?connected=garmin_connect');

    // Garmin Push webhook ingests RUNNING activity with HMAC signature, skips CYCLING
    const gPayload = JSON.stringify({
      activities: [
        {
          userId: 'garmin_u_999',
          activityId: 'g_act_1',
          activityType: 'RUNNING',
          activityName: 'Tel Aviv 10K',
          distanceInMeters: 10090,
          durationInSeconds: 2650,
          startTimeInSeconds: Math.floor(Date.now() / 1000) - 3600,
          deviceName: 'Garmin Forerunner 265',
          manual: false,
        },
        {
          userId: 'garmin_u_999',
          activityId: 'g_act_bike',
          activityType: 'CYCLING',
          distanceInMeters: 30000,
          durationInSeconds: 3600,
          startTimeInSeconds: Math.floor(Date.now() / 1000) - 7200,
        },
      ],
    });
    const gSig = crypto.createHmac('sha256', 'g_wh_sec').update(gPayload).digest('hex');
    const gWhRes = await fetch(`${srv.baseUrl}/api/webhooks/garmin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-isrunner-provider-signature': `sha256=${gSig}`,
      },
      body: gPayload,
    });
    const gWhJson = await gWhRes.json();
    assert.equal(gWhRes.status, 200);
    assert.equal(gWhJson.imported, 1);
    assert.equal(gWhJson.skipped, 1);

    // 2. Strava OAuth 2.0 start -> callback (auto initial sync imports 2 runs, skips Ride)
    const sStart = await u.req('/api/sources/strava/connect', {
      method: 'POST',
      body: { consent_accepted: true },
    });
    assert.equal(sStart.status, 200);
    const sAuthUrl = new URL(sStart.json.authorize_url);
    assert.equal(sAuthUrl.origin + sAuthUrl.pathname, 'https://www.strava.com/oauth/authorize');
    const sState = sAuthUrl.searchParams.get('state');

    const sCb = await u.req(`/api/oauth/strava/callback?code=s_code_1&state=${encodeURIComponent(sState)}`);
    assert.equal(sCb.status, 302);
    assert.equal(sCb.headers.get('location'), '/#/sources?connected=strava&synced=2');

    // 3. Strava manual Sync Now triggers refresh_token and imports only the 1 new TrailRun (dedupes 5001, 5002)
    stravaSyncPhase = 2;
    const syncRes = await u.req('/api/sources/strava/sync', { method: 'POST' });
    assert.equal(syncRes.status, 200);
    assert.equal(syncRes.json.imported, 1);
    assert.equal(syncRes.json.duplicates, 2);

    // 4. Strava Webhook verification + activity create event
    const whVer = await fetch(
      `${srv.baseUrl}/api/webhooks/strava?hub.mode=subscribe&hub.verify_token=s_verify_tok&hub.challenge=chal_abc`
    );
    assert.equal(whVer.status, 200);
    assert.deepEqual(await whVer.json(), { 'hub.challenge': 'chal_abc' });

    const whEv = await fetch(`${srv.baseUrl}/api/webhooks/strava`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        object_type: 'activity',
        aspect_type: 'create',
        object_id: 5005,
        owner_id: 777123,
      }),
    });
    assert.equal(whEv.status, 200);

    // Verify runs provenance honesty: Garmin verified, Strava GPS verified, Strava manual unverified!
    const myRuns = await u.req('/api/runs');
    assert.equal(myRuns.json.runs.length, 5); // 1 Garmin + 4 Strava (5001, 5002 manual, 5004, 5005)
    const manualStrava = myRuns.json.runs.find((r) => r.note === 'Manual treadmill entry');
    assert.equal(manualStrava.source.verified, false);
    assert.equal(manualStrava.source.code, 'strava_manual');
    const verifiedStrava = myRuns.json.runs.find((r) => r.note === 'Morning 5K');
    assert.equal(verifiedStrava.source.verified, true);
    assert.equal(verifiedStrava.source.code, 'strava');
    assert.equal(verifiedStrava.device_name, 'Garmin Forerunner 265');

    // Disconnect Strava + delete Strava runs leaves Garmin run intact
    const discStrava = await u.req('/api/sources/strava/disconnect', {
      method: 'POST',
      body: { delete_source_runs: true },
    });
    assert.equal(discStrava.status, 200);
    assert.equal(discStrava.json.deleted_source_runs, 4);
    assert.ok(fetchCalls.some((c) => c.url === 'https://www.strava.com/oauth/revoke'));

    const remaining = await u.req('/api/runs');
    assert.equal(remaining.json.runs.length, 1);
    assert.equal(remaining.json.runs[0].source.code, 'garmin_connect');
  } finally {
    await srv.close();
  }
});

test('Cloudflare Worker: GPS run endpoint + Strava & Garmin OAuth 2.0 flows work identically in built worker.js', async () => {
  const schemaSql = fs.readFileSync(path.join(ROOT, 'cloudflare/d1-schema.sql'), 'utf8');
  const rawDb = new DatabaseSync(':memory:');
  rawDb.exec('PRAGMA foreign_keys = ON;');
  rawDb.exec(schemaSql);

  const mockDb = {
    prepare(sql) {
      const bound = [];
      const api = {
        bind(...args) {
          bound.push(...args);
          return api;
        },
        async first() {
          return rawDb.prepare(sql).get(...bound) ?? null;
        },
        async all() {
          return { results: rawDb.prepare(sql).all(...bound) };
        },
        async run() {
          const info = rawDb.prepare(sql).run(...bound);
          return { success: true, meta: { changes: Number(info.changes || 0) } };
        },
        _exec() {
          const info = rawDb.prepare(sql).run(...bound);
          return { success: true, meta: { changes: Number(info.changes || 0) } };
        },
      };
      return api;
    },
    async batch(stmts) {
      rawDb.exec('BEGIN;');
      try {
        const out = stmts.map((s) => s._exec());
        rawDb.exec('COMMIT;');
        return out;
      } catch (e) {
        rawDb.exec('ROLLBACK;');
        throw e;
      }
    },
  };

  const workerMod = await import(`../cloudflare/worker.js?v=${Date.now()}`);
  const worker = workerMod.default;
  const env = {
    DB: mockDb,
    STRAVA_CLIENT_ID: 'cf_s_id',
    STRAVA_CLIENT_SECRET: 'cf_s_sec',
    GARMIN_CLIENT_ID: 'cf_g_id',
    GARMIN_CLIENT_SECRET: 'cf_g_sec',
  };

  const origin = 'https://isrunner-test.workers.dev';
  const regRes = await worker.fetch(
    new Request(`${origin}/api/auth/register`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cf_gps', display_name: 'CF רץ', email: 'cf_gps@example.com', password: 'Password123!' }),
    }),
    env
  );
  assert.equal(regRes.status, 201);
  const cookie = regRes.headers.get('set-cookie').split(';')[0];

  // GPS run in Cloudflare Worker
  const gpsRes = await worker.fetch(
    new Request(`${origin}/api/runs/gps`, {
      method: 'POST',
      headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: makeGpsTrack({}), note: 'CF GPS run' }),
    }),
    env
  );
  assert.equal(gpsRes.status, 201);
  const gpsJson = await gpsRes.json();
  assert.equal(gpsJson.run.source.code, 'app_gps');
  assert.equal(gpsJson.run.splits.length, 2);

  // Strava + Garmin connect return real OAuth authorize URLs
  const stravaStart = await worker.fetch(
    new Request(`${origin}/api/sources/strava/connect`, {
      method: 'POST',
      headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent_accepted: true }),
    }),
    env
  );
  assert.equal(stravaStart.status, 200);
  assert.match((await stravaStart.json()).authorize_url, /^https:\/\/www\.strava\.com\/oauth\/authorize\?/);

  const garminStart = await worker.fetch(
    new Request(`${origin}/api/sources/garmin/connect`, {
      method: 'POST',
      headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent_accepted: true }),
    }),
    env
  );
  assert.equal(garminStart.status, 200);
  assert.match((await garminStart.json()).authorize_url, /^https:\/\/connect\.garmin\.com\/oauth2Confirm\?/);

  rawDb.close();
});
