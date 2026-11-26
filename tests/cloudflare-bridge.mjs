import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../cloudflare/worker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCHEMA_SQL = fs.readFileSync(path.join(ROOT, 'cloudflare/d1-schema.sql'), 'utf8');

class MockD1Stmt {
  constructor(sqlite, sql, params = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.params = params;
  }
  bind(...args) {
    return new MockD1Stmt(this.sqlite, this.sql, args);
  }
  async first() {
    const r = this.sqlite.prepare(this.sql).get(...this.params);
    return r === undefined ? null : r;
  }
  async all() {
    return { results: this.sqlite.prepare(this.sql).all(...this.params), success: true, meta: {} };
  }
  async run() {
    const i = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(i.changes || 0) } };
  }
}

class MockD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys = ON;');
    const cleaned = SCHEMA_SQL.split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    for (const s of cleaned.split(';').map((x) => x.trim()).filter(Boolean)) {
      this.sqlite.exec(s + ';');
    }
  }
  prepare(sql) {
    return new MockD1Stmt(this.sqlite, sql);
  }
  async batch(stmts) {
    this.sqlite.exec('BEGIN;');
    try {
      const out = [];
      for (const s of stmts) {
        out.push(/^\s*SELECT\b/i.test(s.sql) ? await s.all() : await s.run());
      }
      this.sqlite.exec('COMMIT;');
      return out;
    } catch (e) {
      this.sqlite.exec('ROLLBACK;');
      throw e;
    }
  }
}

const db = new MockD1();
const port = Number(process.env.PORT || 3901);

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const url = `http://127.0.0.1:${port}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v);
  }
  const request = new Request(url, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
  });
  const response = await worker.fetch(request, { DB: db });
  const outHeaders = {};
  response.headers.forEach((v, k) => {
    outHeaders[k] = v;
  });
  res.writeHead(response.status, outHeaders);
  res.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Worker test bridge listening on http://127.0.0.1:${port}`);
});
