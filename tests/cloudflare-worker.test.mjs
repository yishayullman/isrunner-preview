import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../cloudflare/worker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCHEMA_SQL = fs.readFileSync(path.join(ROOT, 'cloudflare/d1-schema.sql'), 'utf8');

/**
 * Faithful local mock of Cloudflare D1Database API backed by Node 22 node:sqlite.
 * Enforces D1's strict rule against `undefined` bind parameters.
 */
class MockD1Statement {
  constructor(sqlite, sql, params = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.params = params;
  }

  bind(...args) {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === undefined) {
        throw new TypeError(`D1_TYPE_ERROR: Type 'undefined' not supported at bind index ${i}`);
      }
    }
    return new MockD1Statement(this.sqlite, this.sql, args);
  }

  async first() {
    const stmt = this.sqlite.prepare(this.sql);
    const row = stmt.get(...this.params);
    return row === undefined ? null : row;
  }

  async all() {
    const stmt = this.sqlite.prepare(this.sql);
    const results = stmt.all(...this.params);
    return { results, success: true, meta: {} };
  }

  async run() {
    const stmt = this.sqlite.prepare(this.sql);
    const info = stmt.run(...this.params);
    return {
      success: true,
      meta: { changes: Number(info.changes || 0), last_row_id: info.lastInsertRowid },
    };
  }
}

class MockD1Database {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys = ON;');
  }

  prepare(sql) {
    return new MockD1Statement(this.sqlite, sql);
  }

  async batch(statements) {
    this.sqlite.exec('BEGIN;');
    try {
      const out = [];
      for (const s of statements) {
        const isSelect = /^\s*SELECT\b/i.test(s.sql);
        out.push(isSelect ? await s.all() : await s.run());
      }
      this.sqlite.exec('COMMIT;');
      return out;
    } catch (err) {
      this.sqlite.exec('ROLLBACK;');
      throw err;
    }
  }

  applySchemaStatementByStatement(sqlText) {
    // Strip comment lines and split on semicolons just like pasting into Cloudflare D1 Console
    const cleaned = sqlText
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    const statements = cleaned
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      this.sqlite.exec(stmt + ';');
    }
    return statements.length;
  }

  close() {
    this.sqlite.close();
  }
}

async function hmacHex(secret, rawBody) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

class WorkerClient {
  constructor(env, origin = 'https://isrunner-test.example.workers.dev') {
    this.env = env;
    this.origin = origin;
    this.cookie = '';
  }

  async req(pathname, { method = 'GET', body, headers = {}, omitOrigin = false } = {}) {
    const h = new Headers(headers);
    if (this.cookie) h.set('Cookie', this.cookie);
    if (!omitOrigin && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !h.has('Origin')) {
      h.set('Origin', this.origin);
    }
    let payload;
    if (body !== undefined) {
      h.set('Content-Type', 'application/json');
      payload = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const req = new Request(`${this.origin}${pathname}`, { method, headers: h, body: payload });
    const res = await worker.fetch(req, this.env);
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const pair = setCookie.split(';')[0];
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, text, json };
  }

  async register(username, display_name, email = `${username}@example.com`, password = 'Password123!') {
    const res = await this.req('/api/auth/register', {
      method: 'POST',
      body: { username, display_name, email, password },
    });
    assert.equal(res.status, 201, `register failed: ${JSON.stringify(res.json)}`);
    return res.json.user;
  }
}

test('Cloudflare D1 schema executes statement-by-statement and worker serves embedded INDEX_HTML + DB binding check', async () => {
  const db = new MockD1Database();
  const stmtCount = db.applySchemaStatementByStatement(SCHEMA_SQL);
  assert.ok(stmtCount >= 15, `expected >= 15 statements, got ${stmtCount}`);

  // Serves embedded INDEX_HTML on root and arbitrary non-API routes
  const htmlRes = await worker.fetch(new Request('https://isrunner-test.example.workers.dev/'), { DB: db });
  assert.equal(htmlRes.status, 200);
  assert.match(htmlRes.headers.get('content-type'), /text\/html/);
  const html = await htmlRes.text();
  assert.match(html, /Isrunner/);
  assert.match(html, /dir="rtl"/);

  const subPathRes = await worker.fetch(
    new Request('https://isrunner-test.example.workers.dev/some/path'),
    { DB: db }
  );
  assert.equal(subPathRes.status, 200);

  const iconRes = await worker.fetch(
    new Request('https://isrunner-test.example.workers.dev/icon.svg'),
    { DB: db }
  );
  assert.equal(iconRes.status, 200);
  assert.match(iconRes.headers.get('content-type'), /image\/svg\+xml/);

  const manifestRes = await worker.fetch(
    new Request('https://isrunner-test.example.workers.dev/manifest.webmanifest'),
    { DB: db }
  );
  assert.equal(manifestRes.status, 200);
  assert.match(manifestRes.headers.get('content-type'), /manifest\+json/);
  assert.equal((await manifestRes.json()).short_name, 'Isrunner');

  // Helpful Hebrew error if env.DB binding is missing
  const noDbRes = await worker.fetch(
    new Request('https://isrunner-test.example.workers.dev/api/auth/me'),
    {}
  );
  assert.equal(noDbRes.status, 500);
  const noDbJson = await noDbRes.json();
  assert.equal(noDbJson.error, 'db_not_bound');

  db.close();
});

test('Cloudflare Worker full end-to-end: auth (WebCrypto PBKDF2), Origin CSRF, hardcoded 403, provider HMAC ingest, 3 privacy levels, private run, notifications, groups, account deletion', async () => {
  const db = new MockD1Database();
  db.applySchemaStatementByStatement(SCHEMA_SQL);
  const webhookSecret = 'cf-test-webhook-secret';
  const env = {
    DB: db,
    AUTH_RATE_LIMIT: '100',
    LOGIN_RATE_LIMIT: '100',
    GARMIN_CONSUMER_KEY: 'k',
    GARMIN_CONSUMER_SECRET: 's',
    GARMIN_WEBHOOK_SECRET: webhookSecret,
  };

  try {
    const ownerC = new WorkerClient(env);
    const friendC = new WorkerClient(env);
    const strangerC = new WorkerClient(env);

    // Cross-origin write blocked with 403
    const badOrigin = await ownerC.req('/api/auth/register', {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com' },
      body: { username: 'bad', display_name: 'bad', password: 'Password123!' },
    });
    assert.equal(badOrigin.status, 403);

    const owner = await ownerC.register('cf_owner', 'נועה בעלים', 'noa@example.com');
    const friend = await friendC.register('cf_friend', 'עומר חבר');
    const stranger = await strangerC.register('cf_stranger', 'זר');

    // Verify PBKDF2 100k WebCrypto hash stored cleanly + Secure cookie on HTTPS
    const pwRow = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(owner.id).first();
    assert.match(pwRow.password_hash, /^pbkdf2\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);

    // Manual POST /api/runs is hardcoded 403
    const manual = await ownerC.req('/api/runs', {
      method: 'POST',
      body: { distance_km: 5.05, duration_sec: 1400, source_verified: true },
    });
    assert.equal(manual.status, 403);
    assert.match(manual.json.message, /הוספת ריצות סגורה כרגע/);

    // Make owner & friend friends
    await ownerC.req('/api/friends/requests', { method: 'POST', body: { target_user_id: friend.id } });
    await friendC.req(`/api/friends/requests/${owner.id}`, { method: 'PATCH', body: { action: 'accept' } });

    // Create active provider connection & ingest via HMAC-signed server route
    const nowIso = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO provider_connections (id, user_id, provider, provider_user_id, consent_version, consented_at, connected_at, status)
         VALUES ('pc1', ?, 'garmin_connect', 'g-u-1', '2026-draft-v1', ?, ?, 'active')`
      )
      .bind(owner.id, nowIso, nowIso)
      .run();

    const rawBody = JSON.stringify({
      provider_user_id: 'g-u-1',
      external_activity_id: 'act-cf-1',
      distance_km: 5.1,
      duration_sec: 1350,
      ran_at: nowIso,
      note: 'הערה שלא אמורה להופיע בהתראה',
    });
    const sig = await hmacHex(webhookSecret, rawBody);
    const ingest = await ownerC.req('/api/ingest/provider/garmin_connect', {
      method: 'POST',
      omitOrigin: true,
      headers: { 'X-Isrunner-Provider-Signature': sig },
      body: rawBody,
    });
    assert.equal(ingest.status, 201);
    assert.equal(ingest.json.run.source.verified, true);
    assert.equal(ingest.json.notifications_sent, 1);
    const runId = ingest.json.run.id;

    // Friend got 1 notification WITHOUT run note
    const fNotifs = await friendC.req('/api/notifications');
    assert.equal(fNotifs.json.unread_count, 1);
    assert.equal(JSON.stringify(fNotifs.json.notifications[0]).includes('הערה שלא אמורה'), false);

    // Unshare -> notification removed immediately, direct access 404, cannot report, re-share does not re-send!
    await ownerC.req(`/api/runs/${runId}/share`, { method: 'PATCH', body: { is_shared: false } });
    assert.equal((await friendC.req('/api/notifications')).json.notifications.length, 0);
    assert.equal((await friendC.req(`/api/runs/${runId}`)).status, 404);
    assert.equal(
      (await friendC.req('/api/reports', { method: 'POST', body: { target_type: 'run', target_run_id: runId, reason: 'other' } })).status,
      404
    );

    const reshare = await ownerC.req(`/api/runs/${runId}/share`, { method: 'PATCH', body: { is_shared: true } });
    assert.equal(reshare.json.notifications_sent, 0);

    // Privacy levels: friends -> stranger sees 0 runs & all-null PRs; none -> friend also blocked
    await ownerC.req('/api/me/settings', { method: 'PATCH', body: { run_privacy: 'friends' } });
    assert.equal((await friendC.req(`/api/users/${owner.id}`)).json.profile.can_view_runs, true);
    const sProf = await strangerC.req(`/api/users/${owner.id}`);
    assert.equal(sProf.json.profile.can_view_runs, false);
    assert.ok(sProf.json.personal_records.every((p) => p.record === null));
    assert.equal((await strangerC.req('/api/leaderboard?category=5k')).json.entries.length, 0);

    await ownerC.req('/api/me/settings', { method: 'PATCH', body: { run_privacy: 'none' } });
    assert.equal((await friendC.req(`/api/users/${owner.id}`)).json.profile.can_view_runs, false);

    // Group + Report + Account Deletion (anonymized report + reserved username + group transfer)
    const grp = await ownerC.req('/api/groups', { method: 'POST', body: { name: 'קבוצת CF' } });
    const grpId = grp.json.group.id;
    await friendC.req('/api/groups/join', { method: 'POST', body: { join_code: grp.json.group.join_code } });
    const rep = await ownerC.req('/api/reports', {
      method: 'POST',
      body: { target_type: 'user', target_user_id: stranger.id, reason: 'other' },
    });
    assert.equal(rep.status, 201);

    const del = await ownerC.req('/api/me/account', {
      method: 'DELETE',
      body: { password: 'Password123!' },
    });
    assert.equal(del.status, 200);
    assert.equal(del.json.transferred_groups, 1);

    const savedRep = await db.prepare('SELECT reporter_id FROM reports WHERE id = ?').bind(rep.json.report_id).first();
    assert.equal(savedRep.reporter_id, null);
    const grpAfter = await friendC.req(`/api/groups/${grpId}`);
    assert.equal(grpAfter.json.group.owner_id, friend.id);

    const reuse = await new WorkerClient(env).req('/api/auth/register', {
      method: 'POST',
      body: { username: 'cf_owner', display_name: 'מתחזה', email: 'cf_imp@example.com', password: 'Password123!' },
    });
    assert.equal(reuse.status, 409);
  } finally {
    db.close();
  }
});

test('Cloudflare Worker: mandatory canonical email, disposable blocklist, and Resend 6-digit OTP verification', async () => {
  const db = new MockD1Database();
  db.applySchemaStatementByStatement(SCHEMA_SQL);
  const sentEmails = [];
  const env = {
    DB: db,
    RESEND_API_KEY: 're_cf_test',
    EMAIL_FROM: 'Isrunner <noreply@isrunner.test>',
    __FETCH: async (url, init) => {
      if (String(url).startsWith('https://api.resend.com/emails')) {
        sentEmails.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ id: 're_cf_1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  };

  try {
    const c1 = new WorkerClient(env);
    const c2 = new WorkerClient(env);

    const noEmail = await c1.req('/api/auth/register', {
      method: 'POST',
      body: { username: 'cf_noemail', display_name: 'בלי מייל', password: 'Password123!' },
    });
    assert.equal(noEmail.status, 400);
    assert.equal(noEmail.json.error, 'missing_email');

    const disp = await c1.req('/api/auth/register', {
      method: 'POST',
      body: { username: 'cf_disp', display_name: 'זמני', email: 'x@mailinator.com', password: 'Password123!' },
    });
    assert.equal(disp.status, 400);
    assert.equal(disp.json.error, 'disposable_email');

    const reg = await c1.req('/api/auth/register', {
      method: 'POST',
      body: { username: 'cf_real', display_name: 'רץ אמיתי', email: 'runner.one@gmail.com', password: 'Password123!' },
    });
    assert.equal(reg.status, 201);
    assert.equal(reg.json.verification_code_sent, true);
    assert.equal(sentEmails.length, 1);

    // Gmail alias duplicate blocked
    const dupAlias = await c2.req('/api/auth/register', {
      method: 'POST',
      body: { username: 'cf_clone', display_name: 'כפיל', email: 'runnerone+alt@googlemail.com', password: 'Password123!' },
    });
    assert.equal(dupAlias.status, 409);
    assert.equal(dupAlias.json.error, 'email_taken');

    const code = sentEmails[0].text.match(/\b(\d{6})\b/)[1];
    const verified = await c1.req('/api/auth/email/verify-code', {
      method: 'POST',
      body: { code },
    });
    assert.equal(verified.status, 200);
    assert.equal(verified.json.user.email_verified, true);
  } finally {
    db.close();
  }
});
