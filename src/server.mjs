import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.mjs';
import { createApp } from './app.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, '../data/isrunner.db');

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const db = openDatabase(DB_PATH);
const handler = createApp({
  db,
  config: {
    allowedOrigins: ALLOWED_ORIGINS,
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
    garminClientId: process.env.GARMIN_CLIENT_ID || process.env.GARMIN_CONSUMER_KEY || '',
    garminClientSecret: process.env.GARMIN_CLIENT_SECRET || process.env.GARMIN_CONSUMER_SECRET || '',
    garminConsumerKey: process.env.GARMIN_CONSUMER_KEY || process.env.GARMIN_CLIENT_ID || '',
    garminConsumerSecret: process.env.GARMIN_CONSUMER_SECRET || process.env.GARMIN_CLIENT_SECRET || '',
    garminWebhookSecret: process.env.GARMIN_WEBHOOK_SECRET || '',
    stravaClientId: process.env.STRAVA_CLIENT_ID || '',
    stravaClientSecret: process.env.STRAVA_CLIENT_SECRET || '',
    stravaWebhookVerifyToken: process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || '',
    resendApiKey: process.env.RESEND_API_KEY || '',
    emailFrom: process.env.EMAIL_FROM || '',
  },
});

const server = http.createServer(handler);

server.listen(PORT, HOST, () => {
  console.log(`Isrunner local server running at http://${HOST}:${PORT} (DB: ${DB_PATH})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
