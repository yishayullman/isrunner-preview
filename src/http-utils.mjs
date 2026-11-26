export const MAX_BODY_BYTES = 64 * 1024; // 64 KB

export function sendJson(res, status, data, extraHeaders = {}) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(payload);
}

export function sendError(res, status, errorCode, message, extra = {}) {
  sendJson(res, status, {
    error: errorCode,
    message,
    ...extra,
  });
}

export function readRawBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  const raw = await readRawBody(req, maxBytes);
  if (!raw.trim()) return { raw, body: {} };
  try {
    const body = JSON.parse(raw);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw Object.assign(new Error('Invalid JSON object'), { status: 400 });
    }
    return { raw, body };
  } catch (err) {
    if (err.status) throw err;
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

export function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

export function buildSessionCookie(token, { secure = false, maxAgeSec = 60 * 60 * 24 * 30 } = {}) {
  const parts = [
    `isrunner_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie({ secure = false } = {}) {
  const parts = [
    'isrunner_session=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Validates Origin (or Referer fallback) on state-changing requests.
 * Blocks cross-origin CSRF attempts with 403.
 */
export function isAllowedOrigin(req, allowedOrigins = []) {
  const host = req.headers.host;
  const forwardedHost = req.headers['x-forwarded-host'];
  const allowed = new Set(allowedOrigins.map((o) => o.toLowerCase()));
  if (host) {
    allowed.add(`http://${host.toLowerCase()}`);
    allowed.add(`https://${host.toLowerCase()}`);
  }
  if (typeof forwardedHost === 'string' && forwardedHost.trim()) {
    const cleanHost = forwardedHost.split(',')[0].trim().toLowerCase();
    allowed.add(`http://${cleanHost}`);
    allowed.add(`https://${cleanHost}`);
  }

  const originHeader = req.headers.origin;
  if (originHeader) {
    return allowed.has(originHeader.toLowerCase());
  }

  const refererHeader = req.headers.referer;
  if (refererHeader) {
    try {
      const refOrigin = new URL(refererHeader).origin.toLowerCase();
      return allowed.has(refOrigin);
    } catch {
      return false;
    }
  }

  // Reject mutating requests with neither Origin nor Referer (except dedicated server-to-server webhook route)
  return false;
}

export class RateLimiter {
  constructor() {
    this.buckets = new Map();
  }

  check(key, limit, windowMs) {
    const now = Date.now();
    const cutoff = now - windowMs;
    let timestamps = this.buckets.get(key);
    if (!timestamps) {
      timestamps = [];
      this.buckets.set(key, timestamps);
    }
    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }
    if (timestamps.length >= limit) {
      const retryAfterSec = Math.max(1, Math.ceil((timestamps[0] + windowMs - now) / 1000));
      return { allowed: false, retryAfterSec };
    }
    timestamps.push(now);
    return { allowed: true, retryAfterSec: 0 };
  }

  reset() {
    this.buckets.clear();
  }
}

export function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

export function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self';"
  );
}
