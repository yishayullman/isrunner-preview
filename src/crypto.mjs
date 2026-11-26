import crypto from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2Async = promisify(crypto.pbkdf2);

// Matches existing Cloudflare Workers + D1 production hash parameters.
// Any change to live user hashing parameters requires explicit owner approval.
export const PBKDF2_ITERATIONS = 100_000;
export const PBKDF2_KEYLEN = 32;
export const PBKDF2_DIGEST = 'sha256';
export const PASSWORD_MIN_LENGTH = 8;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await pbkdf2Async(
    password,
    salt,
    PBKDF2_ITERATIONS,
    PBKDF2_KEYLEN,
    PBKDF2_DIGEST
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number.parseInt(parts[1], 10);
  const salt = parts[2];
  const expectedHex = parts[3];
  if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > 2_000_000) {
    return false;
  }
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (expectedBuf.length === 0) return false;
  const actualBuf = await pbkdf2Async(
    password,
    salt,
    iterations,
    expectedBuf.length,
    PBKDF2_DIGEST
  );
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

export function generateId() {
  return crypto.randomUUID();
}

export function generateSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateJoinCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += JOIN_CODE_ALPHABET[bytes[i] % JOIN_CODE_ALPHABET.length];
  }
  return out;
}

export function signWebhookPayload(secret, rawBody) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifyWebhookSignature(secret, rawBody, providedSignature) {
  if (!secret || typeof providedSignature !== 'string') return false;
  const clean = providedSignature.replace(/^sha256=/i, '').trim();
  const expected = signWebhookPayload(secret, rawBody);
  const a = Buffer.from(clean, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function generatePkcePair() {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export const DISPOSABLE_EMAIL_DOMAINS = new Set([
  '10minutemail.com',
  '10minutemail.net',
  'burnermail.io',
  'discard.email',
  'dispostable.com',
  'emailondeck.com',
  'fakeinbox.com',
  'getnada.com',
  'grr.la',
  'guerrillamail.biz',
  'guerrillamail.com',
  'guerrillamail.de',
  'guerrillamail.net',
  'guerrillamail.org',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mintemail.com',
  'mohmal.com',
  'mytemp.email',
  'nada.email',
  'sharklasers.com',
  'temp-mail.io',
  'temp-mail.org',
  'tempail.com',
  'tempmail.com',
  'tempmail.net',
  'tempr.email',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.de',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
]);

export function canonicalizeEmail(raw) {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.trim().toLowerCase();
  const atIdx = cleaned.lastIndexOf('@');
  if (atIdx <= 0 || atIdx === cleaned.length - 1) return cleaned;
  let local = cleaned.slice(0, atIdx);
  let domain = cleaned.slice(atIdx + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  const plusIdx = local.indexOf('+');
  if (plusIdx > 0) local = local.slice(0, plusIdx);
  if (domain === 'gmail.com') {
    local = local.replace(/\./g, '');
  }
  return `${local}@${domain}`;
}

export function isDisposableEmail(raw) {
  if (typeof raw !== 'string') return false;
  const cleaned = raw.trim().toLowerCase();
  const atIdx = cleaned.lastIndexOf('@');
  if (atIdx <= 0) return false;
  const domain = cleaned.slice(atIdx + 1);
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return true;
  for (const blocked of DISPOSABLE_EMAIL_DOMAINS) {
    if (domain.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

export function generateOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}
