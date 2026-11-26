// ============================================================================
// Isrunner — Single-File Cloudflare Worker (D1 Binding: env.DB)
// Paste this entire file into Cloudflare Dashboard -> Workers & Pages -> Edit Code.
// Zero imports, zero npm dependencies, zero secrets in code.
// ============================================================================

const MANUAL_RUN_ENTRY_CLOSED = true;
const MANUAL_RUN_CLOSED_MESSAGE =
  'הוספת ריצות סגורה כרגע, ריצה נקלטת רק ממקור מדידה מחובר, כרגע אין מקור מחובר';

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEYLEN_BITS = 256;
const PASSWORD_MIN_LENGTH = 8;
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const FRESH_NOTIFICATION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;

const ANOMALOUS_FAST_PACE_SEC_PER_KM = 165;
const ANOMALOUS_SLOW_PACE_SEC_PER_KM = 900;

const USERNAME_RE = /^[\p{L}\p{N}_.-]{2,30}$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const VALID_REPORT_REASONS = new Set([
  'anomalous_result',
  'harassment',
  'impersonation',
  'inappropriate_content',
  'other',
]);

const RANKING_CATEGORIES = [
  {
    key: '5k',
    label: '5 ק"מ',
    shortLabel: '5 ק"מ',
    type: 'time',
    nominalKm: 5.0,
    minDecimeters: 50000,
    maxExclusiveDecimeters: 52500,
    rangeText: '5.00 עד 5.24 ק"מ',
  },
  {
    key: '10k',
    label: '10 ק"מ',
    shortLabel: '10 ק"מ',
    type: 'time',
    nominalKm: 10.0,
    minDecimeters: 100000,
    maxExclusiveDecimeters: 102500,
    rangeText: '10.00 עד 10.24 ק"מ',
  },
  {
    key: 'half',
    label: 'חצי מרתון',
    shortLabel: 'חצי מרתון',
    type: 'time',
    nominalKm: 21.0975,
    minDecimeters: 210975,
    maxExclusiveDecimeters: 213475,
    rangeText: '21.0975 עד 21.3474 ק"מ',
  },
  {
    key: 'marathon',
    label: 'מרתון',
    shortLabel: 'מרתון',
    type: 'time',
    nominalKm: 42.195,
    minDecimeters: 421950,
    maxExclusiveDecimeters: 424450,
    rangeText: '42.195 עד 42.4449 ק"מ',
  },
  {
    key: 'longest',
    label: 'הריצה הארוכה ביותר',
    shortLabel: 'הארוכה ביותר',
    type: 'distance',
    nominalKm: null,
    minDecimeters: 1,
    maxExclusiveDecimeters: null,
    rangeText: 'המרחק הגבוה ביותר שנמדד',
  },
];

const CATEGORY_BY_KEY = Object.fromEntries(RANKING_CATEGORIES.map((c) => [c.key, c]));

const RANKING_RULE_EXPLANATION = {
  title: 'איך הדירוג עובד (שקוף, לא "זמן מירוץ מאומת")',
  summary:
    'ריצה נספרת בקטגוריית מרחק אם המרחק שנמדד הוא לפחות המרחק הנומינלי ופחות מהמרחק הנומינלי + 0.25 ק"מ (לדוגמה ב-5 ק"מ: 5.00 עד 5.24 ק"מ). הזמן נלקח כפי שנמדד ללא נרמול. לכל רץ נספרת התוצאה הטובה ביותר. ריצות עם קצב חריג מסומנות ולא נחסמות.',
  categories: RANKING_CATEGORIES.map((c) => ({
    key: c.key,
    label: c.label,
    range_text: c.rangeText,
  })),
  anomaly_note:
    'קצב מהיר מ-2:45 דק\'/ק"מ או איטי מ-15:00 דק\'/ק"מ מסומן כ"קצב חריג" לשקיפות בלבד ואינו נחסם.',
};

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
const SUPPORTED_PROVIDERS = new Set(['garmin_connect', 'strava']);

const GARMIN_CONSENT_SUMMARY = {
  version: '2026-oauth2-v1',
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

const STRAVA_CONSENT_SUMMARY = {
  version: '2026-oauth2-v1',
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

const RESOURCES_CONTENT = {
  podcasts: [
    {
      id: 'pod-running-il',
      title: 'פודקאסט ריצה למרחקים בעברית — אימון חכם ומניעת פציעות',
      host: 'קהילת רצים ישראלית',
      topic: 'בניית נפח שבועי, חלוקת קצב (Pacing) והתאוששות',
      tip: 'מומלץ להקשיב בריצה קלה (Zone 2) — בלי לרדוף אחרי השעון.',
    },
    {
      id: 'pod-strength-for-runners',
      title: 'כוח, שינה ותזונה לרצים חובבים',
      host: 'מדעי הספורט והריצה',
      topic: 'למה שני אימוני כוח קצרים בשבוע משפרים 5 ו-10 ק"מ יותר מעוד נפח',
      tip: 'מתאים במיוחד לפני כניסה לתקופת הכנה לחצי מרתון.',
    },
    {
      id: 'pod-marathon-mindset',
      title: 'הכנה מנטלית לריצות ארוכות ומרתון ראשון',
      host: 'שיחות עם מאמנים ורצים',
      topic: 'ניהול משברים בק"מ ה-30, תכנון שתייה וג\'לים, ובחירת קצב פתיחה שפוי',
      tip: 'שימושי לבניית תוכנית מירוץ פשוטה ומציאותית.',
    },
  ],
  videos: [
    {
      id: 'vid-cadence-form',
      title: 'טכניקת ריצה יעילה וקצב צעדים (Cadence)',
      duration: '8 דקות',
      level: 'כל הרמות',
      summary: 'נחיתה מתחת למרכז הכובד, הרפיית כתפיים ומניעת צעד ארוך מדי (Overstriding).',
    },
    {
      id: 'vid-pacing-5k-10k',
      title: 'איך לחלק קצב נכון ב-5 ק"מ וב-10 ק"מ',
      duration: '10 דקות',
      level: 'מתחילים ומתקדמים',
      summary: 'הימנעות מפתיחה מהירה מדי בקילומטר הראשון ובניית Negative Split מאוזן.',
    },
    {
      id: 'vid-injury-prevention',
      title: 'תרגילי חיזוק לקרסוליים, תאומים וירכיים (בלי ציוד)',
      duration: '12 דקות',
      level: 'כל הרמות',
      summary: 'שגרה קצרה של 10 דקות פעמיים בשבוע להפחתת עומס על ברכיים ושוקיים.',
    },
  ],
  warmup: {
    title: 'חימום דינמי לפני ריצה (5–7 דקות)',
    note: 'חימום דינמי בתנועה ולא מתיחות סטטיות ארוכות לפני היציאה.',
    steps: [
      { name: 'הליכה מהירה / ריצה קלה מאוד', duration: '2 דקות', detail: 'העלאת דופק הדרגתית וחימום מפרקים.' },
      { name: 'הנפות רגליים קדימה-אחורה ולצדדים', duration: '10 לכל רגל', detail: 'פתיחת מפרק הירך בתנועה נשלטת.' },
      { name: 'סיבובי קרסוליים ועליות קלות על קצות האצבעות', duration: '45 שניות', detail: 'הכנת גיד אכילס ושרירי התאומים.' },
      { name: 'ברכיים לחזה + עקבים לישבן קלים', duration: '30 שניות כל אחד', detail: 'התעוררות שרירית לפני קצב הריצה.' },
      { name: '2–3 האצות קצרות (Strides) לפני ריצה מהירה', duration: '15 שניות', detail: 'רק לפני אימון איכות או ניסיון שיא.' },
    ],
  },
  cooldown: {
    title: 'שחרור אחרי ריצה (5–8 דקות)',
    note: 'הורדת דופק הדרגתית ומתיחות עדינות כשהשרירים חמים.',
    steps: [
      { name: 'הליכת התאוששות', duration: '3–5 דקות', detail: 'לא לעצור בבת אחת אחרי מאמץ חזק.' },
      { name: 'מתיחת תאומים וסולאוס מול קיר', duration: '30 שניות לכל צד', detail: 'ברך ישרה ואז ברך מעט כפופה.' },
      { name: 'מתיחת ארבע-ראשי וירך אחורית', duration: '30 שניות לכל צד', detail: 'מתיחה עדינה ללא כאב חד.' },
      { name: 'מתיחת מכופפי ירך וישבן (Figure-4)', duration: '30 שניות לכל צד', detail: 'מקל על עומס בגב התחתון אחרי ריצות ארוכות.' },
      { name: 'שתייה ומעט חלבון/פחמימה', duration: 'תוך 45 דקות', detail: 'במיוחד בימים חמים או אחרי מעל 10 ק"מ.' },
    ],
  },
  product_ideas: {
    title: 'רעיונות לפיצ\'רים עתידיים (השראה מגרמין ואפליקציות ריצה — לבחירתך)',
    subtitle: 'אלו הצעות פתוחות בלבד ולא פיצ\'רים פעילים עדיין. אפשר לבחור מה ייכנס לגרסה הבאה.',
    items: [
      {
        id: 'idea-shoe-mileage',
        inspired_by: 'Garmin Gear / Strava Gear',
        title: 'מעקב קילומטראז\' לנעלי ריצה',
        benefit: 'התראה פשוטה כשהנעל מתקרבת ל-600–700 ק"מ כדי למנוע פציעות.',
        complexity: 'נמוכה',
      },
      {
        id: 'idea-splits-hr',
        inspired_by: 'Garmin Connect Activity Splits',
        title: 'פירוט קילומטרים וטווחי דופק (לאחר חיבור גרמין)',
        benefit: 'הצגת קצב לכל ק"מ וגרף פשוט מתוך הנתון המדוד, בלי חישובי "AI" יומרניים.',
        complexity: 'בינונית (תלוי בחיבור ספק)',
      },
      {
        id: 'idea-weekly-streak',
        inspired_by: 'Garmin Badges / Nike Run Club',
        title: 'רצף שבועות פעילים ואבני דרך קהילתיות',
        benefit: 'עידוד התמדה רגועה (למשל 4 שבועות רצופים עם עמידה ביעד) בלי לחץ מיותר.',
        complexity: 'נמוכה',
      },
      {
        id: 'idea-group-challenges',
        inspired_by: 'Garmin Group Challenges',
        title: 'אתגר חודשי בקבוצה (סך ק"מ או מספר ריצות)',
        benefit: 'נותן סיבה טובה גם לרצים מתחילים להשתתף לצד רצים מהירים.',
        complexity: 'בינונית',
      },
      {
        id: 'idea-race-calendar',
        inspired_by: 'קהילות ריצה בישראל',
        title: 'לוח מירוצים מקומי + "מי מהחברים נרשם"',
        benefit: 'חיבור בין ריצות האימון לקהילה בשטח (תל אביב, ירושלים, טבריה, מירוצי לילה).',
        complexity: 'בינונית',
      },
      {
        id: 'idea-web-push',
        inspired_by: 'התראות מובייל',
        title: 'התראות לטלפון כשהאפליקציה סגורה (Web Push בהסכמה)',
        benefit: 'שלב נפרד לאחר שתושלם התשתית, עם אישור מפורש ובחירת שעות שקט.',
        complexity: 'בינונית',
      },
    ],
  },
};

// ---------------- WebCrypto Helpers (Cloudflare Workers Native) ----------------

const textEncoder = new TextEncoder();

function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length === 0 || hex.length % 2 !== 0) return null;
  if (!/^[0-9a-f]+$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function timingSafeEqualBytes(a, b) {
  if (!a || !b || a.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

function generateId() {
  return crypto.randomUUID();
}

function generateSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateJoinCode(length = 6) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += JOIN_CODE_ALPHABET[bytes[i] % JOIN_CODE_ALPHABET.length];
  }
  return out;
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', textEncoder.encode(str));
  return bytesToHex(new Uint8Array(buf));
}

async function hashPassword(password) {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const saltHex = bytesToHex(saltBytes);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: textEncoder.encode(saltHex),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    PBKDF2_KEYLEN_BITS
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltHex}$${bytesToHex(new Uint8Array(derived))}`;
}

async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number.parseInt(parts[1], 10);
  const saltHex = parts[2];
  const expected = hexToBytes(parts[3]);
  if (!Number.isInteger(iterations) || iterations < 10000 || iterations > 100000 || !expected) {
    return false;
  }
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: textEncoder.encode(saltHex),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    expected.length * 8
  );
  return timingSafeEqualBytes(new Uint8Array(derived), expected);
}

async function verifyWebhookSignature(secret, rawBody, providedSignature) {
  if (!secret || typeof providedSignature !== 'string') return false;
  const clean = providedSignature.replace(/^sha256=/i, '').trim();
  const providedBytes = hexToBytes(clean);
  if (!providedBytes) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, textEncoder.encode(rawBody));
  return timingSafeEqualBytes(new Uint8Array(sigBuf), providedBytes);
}

// ---------------- Rate Limiter (Per-Isolate Sliding Window) ----------------

const rateBuckets = new Map();

function checkRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const cutoff = now - windowMs;
  if (rateBuckets.size > 2000) {
    for (const [k, arr] of rateBuckets.entries()) {
      if (arr.length === 0 || arr[arr.length - 1] <= cutoff) rateBuckets.delete(k);
    }
  }
  let arr = rateBuckets.get(key);
  if (!arr) {
    arr = [];
    rateBuckets.set(key, arr);
  }
  while (arr.length > 0 && arr[0] <= cutoff) arr.shift();
  if (arr.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  arr.push(now);
  return { allowed: true, retryAfterSec: 0 };
}

// ---------------- HTTP / Security Helpers ----------------

function securityHeaders(isHtml = false) {
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  };
  if (isHtml) {
    h['Content-Security-Policy'] =
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self';";
  }
  return h;
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...securityHeaders(false),
      ...extraHeaders,
    },
  });
}

function bytesToBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generatePkcePair() {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  const verifier = bytesToBase64Url(bytes);
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(verifier));
  const challenge = bytesToBase64Url(new Uint8Array(digest));
  return { verifier, challenge };
}

const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const DISPOSABLE_EMAIL_DOMAINS = new Set([
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

function canonicalizeEmail(raw) {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.trim().toLowerCase();
  const atIdx = cleaned.lastIndexOf('@');
  if (atIdx <= 0 || atIdx === cleaned.length - 1) return cleaned;
  let local = cleaned.slice(0, atIdx);
  let domain = cleaned.slice(atIdx + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  const plusIdx = local.indexOf('+');
  if (plusIdx > 0) local = local.slice(0, plusIdx);
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

function isDisposableEmail(raw) {
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

function generateOtpCode() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}

async function dispatchWorkerEmailCode(env, db, { userId, email, emailCanonical, displayName }) {
  const apiKey = env && env.RESEND_API_KEY;
  if (!apiKey) return { configured: false, sent: false };

  const code = generateOtpCode();
  const codeHash = await sha256Hex(`${userId}:${emailCanonical}:${code}`);
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  await db.batch([
    db.prepare('DELETE FROM email_verification_codes WHERE user_id = ?').bind(userId),
    db
      .prepare(
        `INSERT INTO email_verification_codes (id, user_id, email_canonical, code_hash, attempts, expires_at, created_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`
      )
      .bind(generateId(), userId, emailCanonical, codeHash, expiresAt, nowIso),
  ]);

  const fetcher = (env && env.__FETCH) || fetch;
  const fromAddr = (env && env.EMAIL_FROM) || 'Isrunner <onboarding@resend.dev>';
  const res = await fetcher('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddr,
      to: [email],
      subject: `קוד האימות שלך ל-Isrunner: ${code}`,
      text: `שלום ${displayName},\n\nקוד האימות שלך ל-Isrunner הוא: ${code}\nהקוד תקף ל-15 דקות.`,
      html: `<div dir="rtl" style="font-family:sans-serif;line-height:1.6;color:#11141c"><h2>אימות אימייל ב-Isrunner</h2><p>שלום ${displayName.replace(/[<>&"]/g, '')},</p><p>קוד האימות החד-פעמי שלך הוא:</p><div style="font-size:28px;font-weight:800;letter-spacing:6px;padding:12px 18px;background:#f4f1ec;border-radius:12px;display:inline-block">${code}</div><p style="color:#5c6370;font-size:13px">הקוד תקף ל-15 דקות.</p></div>`,
    }),
  });
  return { configured: true, sent: res.ok, status: res.status };
}

function redirectResponse(location) {
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'no-store', ...securityHeaders(false) },
  });
}

function errorResponse(status, errorCode, message, extraHeaders = {}) {
  return jsonResponse({ error: errorCode, message }, status, extraHeaders);
}

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  const raw = await request.text();
  if (raw.length > maxBytes) {
    throw Object.assign(new Error('הבקשה גדולה מדי.'), { status: 413 });
  }
  if (!raw.trim()) return { raw, body: {} };
  try {
    const body = JSON.parse(raw);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw Object.assign(new Error('מבנה JSON לא תקין.'), { status: 400 });
    }
    return { raw, body };
  } catch (err) {
    if (err.status) throw err;
    throw Object.assign(new Error('JSON לא תקין.'), { status: 400 });
  }
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

function buildSessionCookie(token, isHttps) {
  const parts = [
    `isrunner_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}`,
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie(isHttps) {
  const parts = ['isrunner_session=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

function isAllowedOrigin(request, url, env) {
  const allowed = new Set([url.origin.toLowerCase()]);
  const host = request.headers.get('host');
  if (host) {
    allowed.add(`http://${host.toLowerCase()}`);
    allowed.add(`https://${host.toLowerCase()}`);
  }
  if (env && typeof env.ALLOWED_ORIGINS === 'string') {
    for (const o of env.ALLOWED_ORIGINS.split(',')) {
      if (o.trim()) allowed.add(o.trim().toLowerCase());
    }
  }
  const originHeader = request.headers.get('origin');
  if (originHeader) return allowed.has(originHeader.toLowerCase());

  const refererHeader = request.headers.get('referer');
  if (refererHeader) {
    try {
      return allowed.has(new URL(refererHeader).origin.toLowerCase());
    } catch {
      return false;
    }
  }
  return false;
}

function getClientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  );
}

// ---------------- Ranking & Source Provenance Helpers ----------------

function toDecimeters(distanceKm) {
  return Math.round(Number(distanceKm) * 10000);
}

function matchesCategory(distanceKm, categoryKey) {
  const cat = CATEGORY_BY_KEY[categoryKey];
  if (!cat) return false;
  const dm = toDecimeters(distanceKm);
  if (cat.type === 'distance') return dm >= cat.minDecimeters;
  return dm >= cat.minDecimeters && dm < cat.maxExclusiveDecimeters;
}

function computePaceSecPerKm(distanceKm, durationSec) {
  if (!distanceKm || distanceKm <= 0 || !durationSec || durationSec <= 0) return null;
  return durationSec / distanceKm;
}

function isAnomalousPace(distanceKm, durationSec) {
  const pace = computePaceSecPerKm(distanceKm, durationSec);
  if (pace === null) return false;
  return pace < ANOMALOUS_FAST_PACE_SEC_PER_KM || pace > ANOMALOUS_SLOW_PACE_SEC_PER_KM;
}

function getSourceDisplay(sourceType, sourceVerified) {
  if (sourceType === 'garmin_connect' && Number(sourceVerified) === 1) {
    return {
      code: 'garmin_connect',
      verified: true,
      label: 'Garmin Connect (מקור מדידה מחובר)',
      shortLabel: 'Garmin Connect',
    };
  }
  if (sourceType === 'garmin_connect') {
    return {
      code: 'garmin_manual',
      verified: false,
      label: 'Garmin Connect (הזנה ידנית בגרמין, לא מאומת)',
      shortLabel: 'Garmin (ידני)',
    };
  }
  if (sourceType === 'strava' && Number(sourceVerified) === 1) {
    return {
      code: 'strava',
      verified: true,
      label: 'Strava (מקור מדידה מחובר)',
      shortLabel: 'Strava',
    };
  }
  if (sourceType === 'strava') {
    return {
      code: 'strava_manual',
      verified: false,
      label: 'Strava (הזנה ידנית ב-Strava, לא מאומת)',
      shortLabel: 'Strava (ידני)',
    };
  }
  if (sourceType === 'app_gps' && Number(sourceVerified) === 1) {
    return {
      code: 'app_gps',
      verified: true,
      label: 'מדידת GPS ב-Isrunner',
      shortLabel: 'Isrunner GPS',
    };
  }
  return {
    code: 'self_reported_legacy',
    verified: false,
    label: 'דיווח עצמי, לא מאומת',
    shortLabel: 'דיווח עצמי, לא מאומת',
  };
}

function safeParseJson(str) {
  if (!str || typeof str !== 'string') return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function decorateRun(run, includeNote = true, includeTelemetry = false) {
  const pace = computePaceSecPerKm(run.distance_km, run.duration_sec);
  const out = {
    id: run.id,
    user_id: run.user_id,
    distance_km: Number(run.distance_km),
    duration_sec: Number(run.duration_sec),
    pace_sec_per_km: pace !== null ? Math.round(pace) : null,
    is_anomalous_pace: isAnomalousPace(run.distance_km, run.duration_sec),
    ran_at: run.ran_at,
    note: includeNote ? run.note || '' : undefined,
    is_shared: Boolean(run.is_shared),
    source: getSourceDisplay(run.source_type, run.source_verified),
    device_name: run.device_name || null,
    created_at: run.created_at,
  };
  if (includeTelemetry) {
    out.gps_points_count = run.gps_points_count != null ? Number(run.gps_points_count) : null;
    out.avg_accuracy_m = run.avg_accuracy_m != null ? Number(run.avg_accuracy_m) : null;
    out.splits = safeParseJson(run.splits_json) || [];
    out.route_polyline = safeParseJson(run.route_polyline_json) || [];
  }
  return out;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function downsampleRoute(coords, maxPoints = 120) {
  if (coords.length <= maxPoints) {
    return coords.map(([lat, lng]) => [
      Math.round(lat * 100000) / 100000,
      Math.round(lng * 100000) / 100000,
    ]);
  }
  const out = [];
  const step = (coords.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    const idx = Math.min(coords.length - 1, Math.round(i * step));
    const [lat, lng] = coords[idx];
    out.push([Math.round(lat * 100000) / 100000, Math.round(lng * 100000) / 100000]);
  }
  return out;
}

function verifyAndComputeGpsRun(rawPoints) {
  if (!Array.isArray(rawPoints) || rawPoints.length < 3) {
    return {
      ok: false,
      code: 'insufficient_gps_points',
      message: 'נדרשות לפחות 3 נקודות GPS תקינות כדי לשמור ריצה שנמדדה באפליקציה.',
    };
  }
  if (rawPoints.length > 15000) {
    return {
      ok: false,
      code: 'too_many_gps_points',
      message: 'מספר נקודות ה-GPS חורג מהמותר לבקשה אחת.',
    };
  }
  const valid = [];
  let accSum = 0;
  let accCount = 0;
  for (const pt of rawPoints) {
    if (!pt || typeof pt !== 'object') continue;
    const lat = Number(pt.lat);
    const lng = Number(pt.lng);
    const ts = Number(pt.ts);
    const acc = pt.acc !== undefined && pt.acc !== null ? Number(pt.acc) : null;
    const seg = Number.isInteger(pt.seg) ? pt.seg : 0;
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) continue;
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) continue;
    if (!Number.isFinite(ts) || ts <= 0) continue;
    if (acc !== null && (!Number.isFinite(acc) || acc < 0 || acc > 50)) continue;
    if (valid.length > 0 && ts <= valid[valid.length - 1].ts) continue;
    valid.push({ lat, lng, ts, acc, seg });
    if (acc !== null) {
      accSum += acc;
      accCount += 1;
    }
  }
  if (valid.length < 3) {
    return {
      ok: false,
      code: 'poor_gps_signal',
      message: 'לא נקלטו מספיק נקודות GPS מדויקות (דיוק עד 50 מ׳). מומלץ למדוד בחוץ בשטח פתוח.',
    };
  }

  let totalMeters = 0;
  let totalSec = 0;
  let rejectedJumpMeters = 0;
  const splits = [];
  let nextKmTarget = 1000;
  let prevSplitElapsedSec = 0;
  const routeCoords = [[valid[0].lat, valid[0].lng]];

  for (let i = 1; i < valid.length; i += 1) {
    const prev = valid[i - 1];
    const cur = valid[i];
    if (cur.seg !== prev.seg) {
      routeCoords.push([cur.lat, cur.lng]);
      continue;
    }
    const dtSec = (cur.ts - prev.ts) / 1000;
    if (dtSec <= 0 || dtSec > 60) {
      routeCoords.push([cur.lat, cur.lng]);
      continue;
    }
    const stepMeters = haversineMeters(prev.lat, prev.lng, cur.lat, cur.lng);
    const speedMps = stepMeters / dtSec;
    if (speedMps > 12.0 && stepMeters > 25) {
      rejectedJumpMeters += stepMeters;
      continue;
    }
    const effectiveStep = speedMps < 0.25 && stepMeters < 1.0 ? 0 : stepMeters;
    const prevDist = totalMeters;
    const prevElapsed = totalSec;
    totalMeters += effectiveStep;
    totalSec += dtSec;
    routeCoords.push([cur.lat, cur.lng]);

    while (effectiveStep > 0 && totalMeters >= nextKmTarget) {
      const frac = (nextKmTarget - prevDist) / effectiveStep;
      const crossingSec = prevElapsed + dtSec * Math.max(0, Math.min(1, frac));
      const splitSec = Math.max(1, Math.round(crossingSec - prevSplitElapsedSec));
      splits.push({
        km: Math.round(nextKmTarget / 1000),
        split_sec: splitSec,
        elapsed_sec: Math.round(crossingSec),
        pace_sec_per_km: splitSec,
      });
      prevSplitElapsedSec = crossingSec;
      nextKmTarget += 1000;
    }
  }

  const distanceKm = Math.round((totalMeters / 1000) * 10000) / 10000;
  const durationSec = Math.round(totalSec);
  if (distanceKm < 0.05) {
    return {
      ok: false,
      code: 'distance_too_short',
      message: 'המרחק שנמדד קצר מדי (נדרשים לפחות 50 מטרים של תנועה ב-GPS).',
    };
  }
  if (distanceKm > 500) {
    return { ok: false, code: 'distance_too_long', message: 'המרחק שנמדד חורג מהגבול המותר (500 ק"מ).' };
  }
  if (durationSec < 10 || durationSec > 604800) {
    return { ok: false, code: 'invalid_duration', message: 'משך הריצה שנמדד חייב להיות לפחות 10 שניות.' };
  }
  if (rejectedJumpMeters > totalMeters * 0.4 && rejectedJumpMeters > 200) {
    return {
      ok: false,
      code: 'gps_jumps_detected',
      message: 'זוהו קפיצות GPS חריגות מדי במסלול ולא ניתן לאמת את המדידה.',
    };
  }
  return {
    ok: true,
    data: {
      distance_km: distanceKm,
      duration_sec: durationSec,
      ran_at: new Date(valid[0].ts).toISOString(),
      gps_points_count: valid.length,
      avg_accuracy_m: accCount > 0 ? Math.round((accSum / accCount) * 10) / 10 : null,
      splits,
      route_polyline: downsampleRoute(routeCoords),
    },
  };
}

function computePersonalRecords(runs) {
  const records = {};
  for (const cat of RANKING_CATEGORIES) {
    records[cat.key] = {
      key: cat.key,
      label: cat.label,
      short_label: cat.shortLabel,
      type: cat.type,
      range_text: cat.rangeText,
      record: null,
    };
  }
  for (const run of runs) {
    const dm = toDecimeters(run.distance_km);
    const dur = Number(run.duration_sec);
    for (const cat of RANKING_CATEGORIES) {
      if (!matchesCategory(run.distance_km, cat.key)) continue;
      const cur = records[cat.key].record;
      let better = false;
      if (!cur) better = true;
      else if (cat.type === 'time') {
        if (dur < cur.duration_sec || (dur === cur.duration_sec && run.ran_at < cur.ran_at)) {
          better = true;
        }
      } else {
        const curDm = toDecimeters(cur.distance_km);
        if (dm > curDm || (dm === curDm && dur < cur.duration_sec)) better = true;
      }
      if (better) {
        const pace = computePaceSecPerKm(run.distance_km, dur);
        records[cat.key].record = {
          run_id: run.id,
          distance_km: Number(run.distance_km),
          duration_sec: dur,
          pace_sec_per_km: pace !== null ? Math.round(pace) : null,
          is_anomalous_pace: isAnomalousPace(run.distance_km, dur),
          ran_at: run.ran_at,
          source: getSourceDisplay(run.source_type, run.source_verified),
        };
      }
    }
  }
  return RANKING_CATEGORIES.map((c) => records[c.key]);
}

function buildLeaderboardEntries(runs, categoryKey) {
  const cat = CATEGORY_BY_KEY[categoryKey];
  if (!cat) return [];
  const bestByUser = new Map();
  for (const run of runs) {
    if (!matchesCategory(run.distance_km, categoryKey)) continue;
    const prev = bestByUser.get(run.user_id);
    let better = false;
    if (!prev) better = true;
    else if (cat.type === 'time') {
      if (
        run.duration_sec < prev.duration_sec ||
        (run.duration_sec === prev.duration_sec && run.ran_at < prev.ran_at)
      ) {
        better = true;
      }
    } else {
      const dm = toDecimeters(run.distance_km);
      const prevDm = toDecimeters(prev.distance_km);
      if (dm > prevDm || (dm === prevDm && run.duration_sec < prev.duration_sec)) better = true;
    }
    if (better) bestByUser.set(run.user_id, run);
  }
  const list = Array.from(bestByUser.values());
  list.sort((a, b) => {
    if (cat.type === 'time') {
      if (a.duration_sec !== b.duration_sec) return a.duration_sec - b.duration_sec;
      return a.ran_at.localeCompare(b.ran_at);
    }
    const diff = toDecimeters(b.distance_km) - toDecimeters(a.distance_km);
    if (diff !== 0) return diff;
    if (a.duration_sec !== b.duration_sec) return a.duration_sec - b.duration_sec;
    return a.ran_at.localeCompare(b.ran_at);
  });
  return list.map((run, idx) => {
    const pace = computePaceSecPerKm(run.distance_km, run.duration_sec);
    return {
      rank: idx + 1,
      run_id: run.id,
      user_id: run.user_id,
      username: run.username,
      display_name: run.display_name,
      distance_km: Number(run.distance_km),
      duration_sec: Number(run.duration_sec),
      pace_sec_per_km: pace !== null ? Math.round(pace) : null,
      is_anomalous_pace: isAnomalousPace(run.distance_km, run.duration_sec),
      ran_at: run.ran_at,
      source: getSourceDisplay(run.source_type, run.source_verified),
    };
  });
}

function getStartOfIsraeliWeekUtc(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekdayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[map.weekday] ?? 0;
  const localAsUtcMs = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second)
  );
  const offsetMs = localAsUtcMs - now.getTime();
  const localMidnightUtcMs =
    Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), 0, 0, 0) -
    weekdayIndex * 24 * 60 * 60 * 1000;
  return new Date(localMidnightUtcMs - offsetMs);
}

// ---------------- D1 Privacy & Notification Helpers ----------------

async function isBlockedBetween(db, userA, userB) {
  if (!userA || !userB || userA === userB) return false;
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM blocks
       WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
       LIMIT 1`
    )
    .bind(userA, userB, userB, userA)
    .first();
  return Boolean(row);
}

async function areFriends(db, userA, userB) {
  if (!userA || !userB || userA === userB) return false;
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM friendships
       WHERE status = 'accepted'
         AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
       LIMIT 1`
    )
    .bind(userA, userB, userB, userA)
    .first();
  return Boolean(row);
}

async function getRelationSets(db, viewerId) {
  const [friendRes, blockRes] = await Promise.all([
    db
      .prepare(
        `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS other_id
         FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`
      )
      .bind(viewerId, viewerId, viewerId)
      .all(),
    db
      .prepare(
        `SELECT CASE WHEN blocker_id = ? THEN blocked_id ELSE blocker_id END AS other_id
         FROM blocks WHERE blocker_id = ? OR blocked_id = ?`
      )
      .bind(viewerId, viewerId, viewerId)
      .all(),
  ]);
  return {
    friends: new Set((friendRes.results || []).map((r) => r.other_id)),
    blocked: new Set((blockRes.results || []).map((r) => r.other_id)),
  };
}

function canViewUserRunsFast(viewerId, targetUser, relSets) {
  if (!targetUser) return false;
  if (viewerId && viewerId === targetUser.id) return true;
  if (relSets.blocked.has(targetUser.id)) return false;
  if (targetUser.run_privacy === 'none') return false;
  if (targetUser.run_privacy === 'everyone') return true;
  if (targetUser.run_privacy === 'friends') return relSets.friends.has(targetUser.id);
  return false;
}

async function canViewUserRuns(db, viewerId, targetUser) {
  if (!targetUser) return false;
  if (viewerId && viewerId === targetUser.id) return true;
  if (viewerId && (await isBlockedBetween(db, viewerId, targetUser.id))) return false;
  if (targetUser.run_privacy === 'none') return false;
  if (targetUser.run_privacy === 'everyone') return true;
  if (targetUser.run_privacy === 'friends') {
    if (!viewerId) return false;
    return await areFriends(db, viewerId, targetUser.id);
  }
  return false;
}

async function canViewRun(db, viewerId, run, ownerUser) {
  if (!run || !ownerUser) return false;
  if (viewerId && viewerId === run.user_id) return true;
  if (!run.is_shared) return false;
  return await canViewUserRuns(db, viewerId, ownerUser);
}

async function getFriendshipRelation(db, viewerId, targetId) {
  if (!viewerId || !targetId) return 'none';
  if (viewerId === targetId) return 'self';

  const blockedByMe = await db
    .prepare('SELECT 1 AS ok FROM blocks WHERE blocker_id = ? AND blocked_id = ? LIMIT 1')
    .bind(viewerId, targetId)
    .first();
  if (blockedByMe) return 'blocked_by_me';

  const blockedMe = await db
    .prepare('SELECT 1 AS ok FROM blocks WHERE blocker_id = ? AND blocked_id = ? LIMIT 1')
    .bind(targetId, viewerId)
    .first();
  if (blockedMe) return 'blocked_me';

  const row = await db
    .prepare(
      `SELECT requester_id, addressee_id, status FROM friendships
       WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
       LIMIT 1`
    )
    .bind(viewerId, targetId, targetId, viewerId)
    .first();
  if (!row) return 'none';
  if (row.status === 'accepted') return 'friends';
  return row.requester_id === viewerId ? 'outgoing_pending' : 'incoming_pending';
}

async function dispatchFirstShareNotifications(db, run, ownerUser, now = new Date()) {
  if (!run || !ownerUser || !run.is_shared || Number(run.notifications_dispatched) === 1) return 0;

  const nowIso = now.toISOString();
  const ranAtMs = Date.parse(run.ran_at);
  const isTooOld = Number.isNaN(ranAtMs) || now.getTime() - ranAtMs > FRESH_NOTIFICATION_WINDOW_MS;
  const isLegacy = run.source_type === 'self_reported_legacy';

  await db
    .prepare(
      `UPDATE runs
       SET notifications_dispatched = 1, first_shared_at = COALESCE(first_shared_at, ?), updated_at = ?
       WHERE id = ?`
    )
    .bind(nowIso, nowIso, run.id)
    .run();

  if (isTooOld || isLegacy || ownerUser.run_privacy === 'none') return 0;

  const relSets = await getRelationSets(db, ownerUser.id);
  const stmts = [];
  for (const friendId of relSets.friends) {
    if (relSets.blocked.has(friendId)) continue;
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO notifications (id, recipient_id, actor_id, run_id, type, is_read, created_at)
           VALUES (?, ?, ?, ?, 'friend_shared_run', 0, ?)`
        )
        .bind(generateId(), friendId, ownerUser.id, run.id, nowIso)
    );
  }
  if (stmts.length === 0) return 0;
  const results = await db.batch(stmts);
  return results.reduce((acc, r) => acc + (r?.meta?.changes || 0), 0);
}

function sanitizeUserSelf(user) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    email: user.email || null,
    email_verified: Boolean(user.email_verified),
    run_privacy: user.run_privacy,
    show_in_global_leaderboard: Boolean(user.show_in_global_leaderboard),
    weekly_goal_km: user.weekly_goal_km !== null && user.weekly_goal_km !== undefined ? Number(user.weekly_goal_km) : null,
    bio: user.bio || '',
    created_at: user.created_at,
  };
}

function getGarminCreds(env) {
  const clientId = (env && (env.GARMIN_CLIENT_ID || env.GARMIN_CONSUMER_KEY)) || '';
  const clientSecret = (env && (env.GARMIN_CLIENT_SECRET || env.GARMIN_CONSUMER_SECRET)) || '';
  return { clientId, clientSecret, webhookSecret: (env && env.GARMIN_WEBHOOK_SECRET) || '' };
}

function isGarminConfigured(env) {
  const { clientId, clientSecret } = getGarminCreds(env);
  return Boolean(clientId && clientSecret);
}

function isStravaConfigured(env) {
  return Boolean(env && env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET);
}

function getWorkerBaseUrl(url, env) {
  if (env && env.PUBLIC_BASE_URL) return String(env.PUBLIC_BASE_URL).replace(/\/+$/, '');
  return url.origin;
}

// ---------------- Main Worker Fetch Handler ----------------

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;
      const method = request.method || 'GET';
      const isHttps = url.protocol === 'https:';

      // Serve single-file SPA for every non-API route
      if (!pathname.startsWith('/api/')) {
        if (method !== 'GET' && method !== 'HEAD') {
          return errorResponse(405, 'method_not_allowed', 'שיטת בקשה לא נתמכת.');
        }
        if (pathname === '/icon.svg') {
          return new Response(ICON_SVG, {
            status: 200,
            headers: {
              'Content-Type': 'image/svg+xml; charset=utf-8',
              'Cache-Control': 'public, max-age=86400',
              ...securityHeaders(false),
            },
          });
        }
        if (pathname === '/manifest.webmanifest') {
          return new Response(MANIFEST_JSON, {
            status: 200,
            headers: {
              'Content-Type': 'application/manifest+json; charset=utf-8',
              'Cache-Control': 'public, max-age=3600',
              ...securityHeaders(false),
            },
          });
        }
        return new Response(INDEX_HTML, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache',
            ...securityHeaders(true),
          },
        });
      }

      if (pathname === '/api/health' && method === 'GET') {
        return jsonResponse({ ok: true, app: 'Isrunner', db_bound: Boolean(env && env.DB) });
      }

      if (!env || !env.DB) {
        return errorResponse(
          500,
          'db_not_bound',
          'מסד הנתונים (DB) עדיין לא חובר ל-Worker. חבר D1 binding בשם DB בהגדרות ה-Worker ופרסם שוב (Deploy).'
        );
      }

      const db = env.DB;

      // Server-to-server provider webhooks & ingestion (authenticated by provider secret/HMAC, NOT cookies/Origin)
      const ingestMatch = pathname.match(/^\/api\/ingest\/provider\/([a-z0-9_]+)$/);
      if (ingestMatch && method === 'POST') {
        return await handleProviderIngest(request, env, db, ingestMatch[1]);
      }
      if (pathname === '/api/webhooks/garmin' && method === 'POST') {
        return await handleGarminWebhook(request, env, db);
      }
      if (pathname === '/api/webhooks/strava' && method === 'GET') {
        return await handleStravaWebhookVerify(env, url);
      }
      if (pathname === '/api/webhooks/strava' && method === 'POST') {
        return await handleStravaWebhookEvent(request, env, db);
      }

      // OAuth 2.0 browser callbacks (authenticated via single-use server-side oauth_states.state)
      if (pathname === '/api/oauth/garmin/callback' && method === 'GET') {
        return await handleGarminOAuthCallback(env, db, url);
      }
      if (pathname === '/api/oauth/strava/callback' && method === 'GET') {
        return await handleStravaOAuthCallback(env, db, url);
      }

      // Origin CSRF check on all browser write operations
      if (WRITE_METHODS.has(method)) {
        if (!isAllowedOrigin(request, url, env)) {
          return errorResponse(
            403,
            'invalid_origin',
            'בקשה נדחתה: מקור הבקשה (Origin) אינו מאושר לפעולה כותבת.'
          );
        }
      }

      // Authenticate session cookie
      const cookies = parseCookies(request.headers.get('cookie'));
      let user = null;
      let sessionTokenHash = null;
      if (cookies.isrunner_session) {
        sessionTokenHash = await sha256Hex(cookies.isrunner_session);
        const nowIso = new Date().toISOString();
        user = await db
          .prepare(
            `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = ? AND s.expires_at > ?`
          )
          .bind(sessionTokenHash, nowIso)
          .first();
      }

      // Public endpoints
      if (pathname === '/api/auth/register' && method === 'POST') {
        return await handleRegister(request, env, db, isHttps);
      }
      if (pathname === '/api/auth/login' && method === 'POST') {
        return await handleLogin(request, env, db, isHttps);
      }
      if (pathname === '/api/auth/logout' && method === 'POST') {
        if (sessionTokenHash) {
          await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(sessionTokenHash).run();
        }
        return jsonResponse({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(isHttps) });
      }
      if (pathname === '/api/auth/password-reset/request' && method === 'POST') {
        return errorResponse(
          503,
          'email_provider_not_configured',
          'שליחת מייל לשחזור סיסמה עדיין אינה מחוברת. תופעל רק לאחר חיבור ספק אימיילים בייצור.'
        );
      }
      if (pathname === '/api/auth/me' && method === 'GET') {
        return jsonResponse({
          user: user ? sanitizeUserSelf(user) : null,
          email_verification_enabled: Boolean(env && env.RESEND_API_KEY),
        });
      }
      if (pathname === '/api/resources' && method === 'GET') {
        return jsonResponse(RESOURCES_CONTENT);
      }

      // Authenticated endpoints
      if (!user) {
        return errorResponse(401, 'unauthorized', 'נדרשת התחברות כדי לבצע פעולה זו.');
      }

      if (pathname === '/api/auth/email/send-code' && method === 'POST') {
        return await handleSendEmailVerificationCode(env, db, user);
      }
      if (pathname === '/api/auth/email/verify-code' && method === 'POST') {
        return await handleVerifyEmailCode(request, db, user);
      }

      if (pathname === '/api/auth/logout-all' && method === 'POST') {
        await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
        return jsonResponse(
          { ok: true, message: 'התנתקת מכל המכשירים הפעילים.' },
          200,
          { 'Set-Cookie': clearSessionCookie(isHttps) }
        );
      }
      if (pathname === '/api/me/password' && method === 'POST') {
        return await handleChangePassword(request, db, user, sessionTokenHash);
      }
      if (pathname === '/api/me/settings' && method === 'PATCH') {
        return await handleUpdateSettings(request, db, user);
      }
      if (pathname === '/api/me/export' && method === 'GET') {
        return await handleExportMyData(db, user);
      }
      if (pathname === '/api/me/account' && method === 'DELETE') {
        return await handleDeleteMyAccount(request, db, user, isHttps);
      }
      if (pathname === '/api/home' && method === 'GET') {
        return await handleGetHome(env, db, user);
      }

      // Runs
      if (pathname === '/api/runs' && method === 'POST') {
        if (MANUAL_RUN_ENTRY_CLOSED) {
          return errorResponse(403, 'manual_run_entry_closed', MANUAL_RUN_CLOSED_MESSAGE);
        }
      }
      if (pathname === '/api/runs/gps' && method === 'POST') {
        return await handleCreateGpsRun(request, db, user);
      }
      if (pathname === '/api/runs' && method === 'GET') {
        const res = await db
          .prepare('SELECT * FROM runs WHERE user_id = ? ORDER BY ran_at DESC, created_at DESC LIMIT 200')
          .bind(user.id)
          .all();
        return jsonResponse({
          runs: (res.results || []).map((r) => decorateRun(r, true)),
          manual_entry_closed: MANUAL_RUN_ENTRY_CLOSED,
          manual_entry_message: MANUAL_RUN_CLOSED_MESSAGE,
        });
      }
      const runShareMatch = pathname.match(/^\/api\/runs\/([^/]+)\/share$/);
      if (runShareMatch && method === 'PATCH') {
        return await handleToggleRunShare(request, db, user, decodeURIComponent(runShareMatch[1]));
      }
      const runNoteMatch = pathname.match(/^\/api\/runs\/([^/]+)\/note$/);
      if (runNoteMatch && method === 'PATCH') {
        return await handleUpdateRunNote(request, db, user, decodeURIComponent(runNoteMatch[1]));
      }
      const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (runMatch && method === 'GET') {
        return await handleGetRun(db, user, decodeURIComponent(runMatch[1]));
      }
      if (runMatch && method === 'DELETE') {
        return await handleDeleteRun(db, user, decodeURIComponent(runMatch[1]));
      }

      // Measurement Sources (Garmin Connect + Strava)
      if (pathname === '/api/sources' && method === 'GET') {
        return await handleGetSources(env, db, user, url);
      }
      if (pathname === '/api/sources/garmin/connect' && method === 'POST') {
        return await handleStartGarminConnect(request, env, db, user, url);
      }
      if (pathname === '/api/sources/strava/connect' && method === 'POST') {
        return await handleStartStravaConnect(request, env, db, user, url);
      }
      if (pathname === '/api/sources/strava/sync' && method === 'POST') {
        return await handleSyncStrava(env, db, user);
      }
      const srcDiscMatch = pathname.match(/^\/api\/sources\/([a-z0-9_]+)\/disconnect$/);
      if (srcDiscMatch && method === 'POST') {
        return await handleDisconnectSource(request, env, db, user, srcDiscMatch[1]);
      }
      const srcDataMatch = pathname.match(/^\/api\/sources\/([a-z0-9_]+)\/data$/);
      if (srcDataMatch && method === 'DELETE') {
        return await handleDeleteSourceData(db, user, srcDataMatch[1]);
      }

      // Global Leaderboard
      if (pathname === '/api/leaderboard' && method === 'GET') {
        return await handleGlobalLeaderboard(env, db, user, url);
      }

      // Friends, Search, Block, Profiles
      if (pathname === '/api/friends' && method === 'GET') {
        return await handleListFriends(db, user);
      }
      if (pathname === '/api/users/search' && method === 'GET') {
        return await handleSearchUsers(db, user, url);
      }
      if (pathname === '/api/friends/requests' && method === 'POST') {
        return await handleSendFriendRequest(request, db, user);
      }
      const friendRespMatch = pathname.match(/^\/api\/friends\/requests\/([^/]+)$/);
      if (friendRespMatch && method === 'PATCH') {
        return await handleRespondFriendRequest(
          request,
          db,
          user,
          decodeURIComponent(friendRespMatch[1])
        );
      }
      const friendRemMatch = pathname.match(/^\/api\/friends\/([^/]+)$/);
      if (friendRemMatch && method === 'DELETE') {
        return await handleRemoveFriend(db, user, decodeURIComponent(friendRemMatch[1]));
      }
      const blockMatch = pathname.match(/^\/api\/blocks\/([^/]+)$/);
      if (blockMatch && method === 'POST') {
        return await handleBlockUser(db, user, decodeURIComponent(blockMatch[1]));
      }
      if (blockMatch && method === 'DELETE') {
        await db
          .prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
          .bind(user.id, decodeURIComponent(blockMatch[1]))
          .run();
        return jsonResponse({ ok: true });
      }
      const userProfileMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
      if (userProfileMatch && method === 'GET') {
        return await handleGetUserProfile(db, user, decodeURIComponent(userProfileMatch[1]));
      }

      // Notifications
      if (pathname === '/api/notifications' && method === 'GET') {
        return await handleListNotifications(db, user);
      }
      if (pathname === '/api/notifications/read-all' && method === 'POST') {
        await db
          .prepare('UPDATE notifications SET is_read = 1 WHERE recipient_id = ? AND is_read = 0')
          .bind(user.id)
          .run();
        return jsonResponse({ ok: true });
      }
      const notifReadMatch = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
      if (notifReadMatch && method === 'POST') {
        const res = await db
          .prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND recipient_id = ?')
          .bind(decodeURIComponent(notifReadMatch[1]), user.id)
          .run();
        if (!(res.meta && res.meta.changes)) {
          return errorResponse(404, 'not_found', 'ההתראה לא נמצאה.');
        }
        return jsonResponse({ ok: true });
      }

      // Groups
      if (pathname === '/api/groups' && method === 'GET') {
        const res = await db
          .prepare(
            `SELECT g.id, g.name, g.description, g.join_code, g.owner_id, g.created_at,
                    gm.role, gm.joined_at,
                    (SELECT COUNT(*) FROM group_members gm2 WHERE gm2.group_id = g.id) AS member_count
             FROM group_members gm JOIN groups g ON g.id = gm.group_id
             WHERE gm.user_id = ? ORDER BY g.created_at DESC`
          )
          .bind(user.id)
          .all();
        return jsonResponse({ groups: res.results || [] });
      }
      if (pathname === '/api/groups' && method === 'POST') {
        return await handleCreateGroup(request, db, user);
      }
      if (pathname === '/api/groups/preview' && method === 'GET') {
        return await handlePreviewGroupByCode(request, db, user, url);
      }
      if (pathname === '/api/groups/join' && method === 'POST') {
        return await handleJoinGroup(request, db, user);
      }
      const grpLeaveMatch = pathname.match(/^\/api\/groups\/([^/]+)\/leave$/);
      if (grpLeaveMatch && method === 'POST') {
        return await handleLeaveGroup(db, user, decodeURIComponent(grpLeaveMatch[1]));
      }
      const grpDetailMatch = pathname.match(/^\/api\/groups\/([^/]+)$/);
      if (grpDetailMatch && method === 'GET') {
        return await handleGetGroupDetail(db, user, decodeURIComponent(grpDetailMatch[1]), url);
      }

      // Reports
      if (pathname === '/api/reports' && method === 'POST') {
        return await handleCreateReport(request, db, user);
      }
      if (pathname === '/api/reports/mine' && method === 'GET') {
        const res = await db
          .prepare(
            `SELECT id, target_type, target_user_id, target_run_id, reason, details, status, created_at
             FROM reports WHERE reporter_id = ? ORDER BY created_at DESC LIMIT 30`
          )
          .bind(user.id)
          .all();
        return jsonResponse({ reports: res.results || [] });
      }

      return errorResponse(404, 'not_found', 'הנתיב המבוקש לא נמצא.');
    } catch (err) {
      if (err && typeof err.status === 'number') {
        return errorResponse(err.status, 'request_error', err.message);
      }
      return errorResponse(500, 'internal_error', 'אירעה שגיאה פנימית בשרת.');
    }
  },
};

// ---------------- Route Implementations ----------------

async function handleRegister(request, env, db, isHttps) {
  const ip = getClientIp(request);
  const limit = Number(env.AUTH_RATE_LIMIT || 15);
  const rl = checkRateLimit(`register:${ip}`, limit, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(429, 'rate_limited', 'יותר מדי ניסיונות הרשמה. נסה שוב בעוד כמה דקות.', {
      'Retry-After': String(rl.retryAfterSec),
    });
  }

  const { body } = await readJson(request);
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const displayName =
    typeof body.display_name === 'string' && body.display_name.trim()
      ? body.display_name.trim()
      : username;
  const password = typeof body.password === 'string' ? body.password : '';
  const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!USERNAME_RE.test(username)) {
    return errorResponse(
      400,
      'invalid_username',
      'שם משתמש חייב להכיל 2 עד 30 תווים (עברית, אנגלית, ספרות, נקודה, מקף או קו תחתון).'
    );
  }
  if (displayName.length < 2 || displayName.length > 40) {
    return errorResponse(400, 'invalid_display_name', 'שם תצוגה חייב להכיל 2 עד 40 תווים.');
  }
  if (!rawEmail) {
    return errorResponse(
      400,
      'missing_email',
      'חובה להזין כתובת אימייל כדי להירשם (אימייל אחד לכל רץ למניעת כפילויות בדירוג).'
    );
  }
  if (!EMAIL_RE.test(rawEmail) || rawEmail.length > 120) {
    return errorResponse(400, 'invalid_email', 'כתובת האימייל אינה תקינה.');
  }
  if (isDisposableEmail(rawEmail)) {
    return errorResponse(
      400,
      'disposable_email',
      'לא ניתן להירשם עם כתובת אימייל זמנית או חד-פעמית. השתמש בכתובת אימייל אישית קבועה.'
    );
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return errorResponse(
      400,
      'weak_password',
      `הסיסמה חייבת להכיל לפחות ${PASSWORD_MIN_LENGTH} תווים.`
    );
  }

  const emailCanonical = canonicalizeEmail(rawEmail);
  const usernameHash = await sha256Hex(username.toLowerCase());
  const [existing, reserved, emailTaken] = await Promise.all([
    db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').bind(username).first(),
    db.prepare('SELECT 1 AS ok FROM reserved_usernames WHERE username_hash = ?').bind(usernameHash).first(),
    db
      .prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE OR email_canonical = ?')
      .bind(rawEmail, emailCanonical)
      .first(),
  ]);
  if (existing || reserved) {
    return errorResponse(409, 'username_taken', 'שם המשתמש כבר תפוס. בחר שם אחר.');
  }
  if (emailTaken) {
    return errorResponse(
      409,
      'email_taken',
      'כתובת האימייל הזו (או כינוי שלה) כבר משויכת לחשבון קיים.'
    );
  }

  const nowIso = new Date().toISOString();
  const userId = generateId();
  const passwordHash = await hashPassword(password);
  const sessionToken = generateSessionToken();
  const tokenHash = await sha256Hex(sessionToken);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, username, display_name, email, email_canonical, email_verified, password_hash, run_privacy, show_in_global_leaderboard, weekly_goal_km, bio, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, 'everyone', 1, NULL, '', ?, ?)`
      )
      .bind(userId, username, displayName, rawEmail, emailCanonical, passwordHash, nowIso, nowIso),
    db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(tokenHash, userId, nowIso, expiresAt),
  ]);

  let verificationCodeSent = false;
  if (env && env.RESEND_API_KEY) {
    try {
      const sent = await dispatchWorkerEmailCode(env, db, {
        userId,
        email: rawEmail,
        emailCanonical,
        displayName,
      });
      verificationCodeSent = Boolean(sent.sent);
    } catch {
      verificationCodeSent = false;
    }
  }

  const created = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  return jsonResponse(
    {
      user: sanitizeUserSelf(created),
      email_verification_enabled: Boolean(env && env.RESEND_API_KEY),
      verification_code_sent: verificationCodeSent,
    },
    201,
    { 'Set-Cookie': buildSessionCookie(sessionToken, isHttps) }
  );
}

async function handleLogin(request, env, db, isHttps) {
  const ip = getClientIp(request);
  const limit = Number(env.LOGIN_RATE_LIMIT || 10);
  const rl = checkRateLimit(`login:${ip}`, limit, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(429, 'rate_limited', 'יותר מדי ניסיונות התחברות. המתן מעט ונסה שוב.', {
      'Retry-After': String(rl.retryAfterSec),
    });
  }

  const { body } = await readJson(request);
  const identifier = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!identifier || !password) {
    return errorResponse(400, 'missing_credentials', 'נא למלא שם משתמש (או אימייל) וסיסמה.');
  }

  const canonicalId = identifier.includes('@') ? canonicalizeEmail(identifier) : '';
  const user = await db
    .prepare(
      `SELECT * FROM users
       WHERE username = ? COLLATE NOCASE
          OR (email IS NOT NULL AND email = ? COLLATE NOCASE)
          OR (email_canonical IS NOT NULL AND email_canonical = ?)`
    )
    .bind(identifier, identifier, canonicalId)
    .first();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return errorResponse(401, 'invalid_credentials', 'שם משתמש או סיסמה שגויים.');
  }

  const nowIso = new Date().toISOString();
  const sessionToken = generateSessionToken();
  const tokenHash = await sha256Hex(sessionToken);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  await db.batch([
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?').bind(user.id, nowIso),
    db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(tokenHash, user.id, nowIso, expiresAt),
  ]);

  return jsonResponse(
    {
      user: sanitizeUserSelf(user),
      email_verification_enabled: Boolean(env && env.RESEND_API_KEY),
    },
    200,
    { 'Set-Cookie': buildSessionCookie(sessionToken, isHttps) }
  );
}

async function handleSendEmailVerificationCode(env, db, user) {
  const rl = checkRateLimit(`email_otp:${user.id}`, 5, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(429, 'rate_limited', 'נשלחו יותר מדי קודים לאימות. המתן מעט ונסה שוב.', {
      'Retry-After': String(rl.retryAfterSec),
    });
  }
  if (!user.email) {
    return errorResponse(400, 'missing_email', 'יש להזין כתובת אימייל בהגדרות החשבון לפני האימות.');
  }
  if (user.email_verified) {
    return jsonResponse({ ok: true, already_verified: true, message: 'האימייל כבר מאומת.' });
  }
  if (!env || !env.RESEND_API_KEY) {
    return errorResponse(
      503,
      'email_provider_not_configured',
      'שליחת קוד אימות למייל תופעל לאחר הגדרת RESEND_API_KEY בשרת.'
    );
  }
  const emailCanonical = user.email_canonical || canonicalizeEmail(user.email);
  const res = await dispatchWorkerEmailCode(env, db, {
    userId: user.id,
    email: user.email,
    emailCanonical,
    displayName: user.display_name,
  });
  if (!res.sent) {
    return errorResponse(502, 'email_send_failed', 'שליחת מייל האימות נכשלה כרגע. נסה שוב בעוד רגע.');
  }
  return jsonResponse({ ok: true, message: `קוד אימות בן 6 ספרות נשלח אל ${user.email}.` });
}

async function handleVerifyEmailCode(request, db, user) {
  const rl = checkRateLimit(`email_verify:${user.id}`, 10, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(429, 'rate_limited', 'יותר מדי ניסיונות אימות. נסה שוב מאוחר יותר.', {
      'Retry-After': String(rl.retryAfterSec),
    });
  }
  if (!user.email) return errorResponse(400, 'missing_email', 'אין אימייל משויך לחשבון.');
  if (user.email_verified) return jsonResponse({ ok: true, user: sanitizeUserSelf(user) });

  const { body } = await readJson(request);
  const code = typeof body.code === 'string' ? body.code.replace(/\s+/g, '') : '';
  if (!/^\d{6}$/.test(code)) {
    return errorResponse(400, 'invalid_code', 'יש להזין קוד אימות בן 6 ספרות.');
  }

  const emailCanonical = user.email_canonical || canonicalizeEmail(user.email);
  const nowIso = new Date().toISOString();
  const row = await db
    .prepare(
      `SELECT * FROM email_verification_codes
       WHERE user_id = ? AND email_canonical = ? AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(user.id, emailCanonical, nowIso)
    .first();

  if (!row) {
    return errorResponse(400, 'code_expired', 'לא נמצא קוד בתוקף. בקש שליחת קוד חדש.');
  }
  if (Number(row.attempts) >= OTP_MAX_ATTEMPTS) {
    return errorResponse(429, 'too_many_attempts', 'חרגת ממספר הניסיונות. בקש קוד אימות חדש.');
  }

  const expectedHash = await sha256Hex(`${user.id}:${emailCanonical}:${code}`);
  if (expectedHash !== row.code_hash) {
    await db
      .prepare('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?')
      .bind(row.id)
      .run();
    return errorResponse(400, 'invalid_code', 'קוד האימות שגוי. בדוק שוב את המייל.');
  }

  await db.batch([
    db
      .prepare('UPDATE users SET email_verified = 1, email_canonical = ?, updated_at = ? WHERE id = ?')
      .bind(emailCanonical, nowIso, user.id),
    db.prepare('DELETE FROM email_verification_codes WHERE user_id = ?').bind(user.id),
  ]);

  const updated = await db.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
  return jsonResponse({ ok: true, user: sanitizeUserSelf(updated), message: 'האימייל אומת בהצלחה!' });
}

async function handleChangePassword(request, db, user, currentSessionHash) {
  const rl = checkRateLimit(`chpw:${user.id}:${getClientIp(request)}`, 8, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(429, 'rate_limited', 'יותר מדי ניסיונות החלפת סיסמה. המתן מעט.', {
      'Retry-After': String(rl.retryAfterSec),
    });
  }
  const { body } = await readJson(request);
  const currentPassword = typeof body.current_password === 'string' ? body.current_password : '';
  const newPassword = typeof body.new_password === 'string' ? body.new_password : '';
  if (!currentPassword || !newPassword) {
    return errorResponse(400, 'missing_passwords', 'נא למלא סיסמה נוכחית וסיסמה חדשה.');
  }
  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    return errorResponse(
      400,
      'weak_password',
      `הסיסמה החדשה חייבת להכיל לפחות ${PASSWORD_MIN_LENGTH} תווים.`
    );
  }
  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    return errorResponse(401, 'invalid_credentials', 'הסיסמה הנוכחית שגויה.');
  }
  const nextHash = await hashPassword(newPassword);
  const nowIso = new Date().toISOString();
  await db.batch([
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').bind(nextHash, nowIso, user.id),
    db
      .prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?')
      .bind(user.id, currentSessionHash || ''),
  ]);
  return jsonResponse({
    ok: true,
    message: 'הסיסמה עודכנה בהצלחה. מכשירים אחרים נותקו לביטחונך.',
  });
}

async function handleUpdateSettings(request, db, user) {
  const { body } = await readJson(request);
  const updates = [];
  const params = [];
  let privacyChangedToNone = false;
  let emailChanged = false;

  if (body.display_name !== undefined) {
    const dn = typeof body.display_name === 'string' ? body.display_name.trim() : '';
    if (dn.length < 2 || dn.length > 40) {
      return errorResponse(400, 'invalid_display_name', 'שם תצוגה חייב להכיל 2 עד 40 תווים.');
    }
    updates.push('display_name = ?');
    params.push(dn);
  }
  if (body.email !== undefined) {
    const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const currentEmail = (user.email || '').trim().toLowerCase();
    if (rawEmail === '') {
      if (currentEmail) {
        return errorResponse(
          400,
          'email_required',
          'אי אפשר להסיר אימייל מהחשבון — הוא משמש לאימות ולמניעת כפילויות בדירוג.'
        );
      }
    } else if (rawEmail !== currentEmail) {
      if (!EMAIL_RE.test(rawEmail) || rawEmail.length > 120) {
        return errorResponse(400, 'invalid_email', 'כתובת האימייל אינה תקינה.');
      }
      if (isDisposableEmail(rawEmail)) {
        return errorResponse(400, 'disposable_email', 'לא ניתן להשתמש בכתובת אימייל זמנית או חד-פעמית.');
      }
      const emailCanonical = canonicalizeEmail(rawEmail);
      const taken = await db
        .prepare(
          'SELECT id FROM users WHERE (email = ? COLLATE NOCASE OR email_canonical = ?) AND id <> ?'
        )
        .bind(rawEmail, emailCanonical, user.id)
        .first();
      if (taken) {
        return errorResponse(
          409,
          'email_taken',
          'כתובת האימייל הזו (או כינוי שלה) כבר משויכת לחשבון אחר.'
        );
      }
      updates.push('email = ?', 'email_canonical = ?', 'email_verified = 0');
      params.push(rawEmail, emailCanonical);
      emailChanged = true;
    }
  }
  if (body.bio !== undefined) {
    const bio = typeof body.bio === 'string' ? body.bio.trim().slice(0, 200) : '';
    updates.push('bio = ?');
    params.push(bio);
  }
  if (body.run_privacy !== undefined) {
    if (!['everyone', 'friends', 'none'].includes(body.run_privacy)) {
      return errorResponse(400, 'invalid_privacy', 'רמת פרטיות לא חוקית.');
    }
    updates.push('run_privacy = ?');
    params.push(body.run_privacy);
    if (body.run_privacy === 'none') privacyChangedToNone = true;
  }
  if (body.show_in_global_leaderboard !== undefined) {
    updates.push('show_in_global_leaderboard = ?');
    params.push(body.show_in_global_leaderboard ? 1 : 0);
  }
  if (body.weekly_goal_km !== undefined) {
    if (body.weekly_goal_km === null || body.weekly_goal_km === '') {
      updates.push('weekly_goal_km = NULL');
    } else {
      const goal = Number(body.weekly_goal_km);
      if (!Number.isFinite(goal) || goal < 1 || goal > 500) {
        return errorResponse(400, 'invalid_goal', 'יעד שבועי חייב להיות בין 1 ל-500 ק"מ.');
      }
      updates.push('weekly_goal_km = ?');
      params.push(Math.round(goal * 10) / 10);
    }
  }

  if (updates.length === 0) return jsonResponse({ user: sanitizeUserSelf(user) });

  const nowIso = new Date().toISOString();
  updates.push('updated_at = ?');
  params.push(nowIso, user.id);

  const stmts = [db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...params)];
  if (privacyChangedToNone) {
    stmts.push(db.prepare('DELETE FROM notifications WHERE actor_id = ?').bind(user.id));
  }
  if (emailChanged) {
    stmts.push(db.prepare('DELETE FROM email_verification_codes WHERE user_id = ?').bind(user.id));
  }
  await db.batch(stmts);

  const updated = await db.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
  return jsonResponse({ user: sanitizeUserSelf(updated) });
}

async function handleExportMyData(db, user) {
  const [runsRes, groupsRes, srcRes] = await Promise.all([
    db
      .prepare(
        `SELECT id, distance_km, duration_sec, ran_at, note, is_shared, source_type, source_verified, source_ingested_at, created_at
         FROM runs WHERE user_id = ? ORDER BY ran_at DESC`
      )
      .bind(user.id)
      .all(),
    db
      .prepare(
        `SELECT g.id, g.name, gm.role, gm.joined_at
         FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE gm.user_id = ?`
      )
      .bind(user.id)
      .all(),
    db
      .prepare(
        `SELECT provider, consent_version, consented_at, connected_at, last_sync_at, status
         FROM provider_connections WHERE user_id = ?`
      )
      .bind(user.id)
      .all(),
  ]);
  return jsonResponse({
    exported_at: new Date().toISOString(),
    user: sanitizeUserSelf(user),
    runs: runsRes.results || [],
    groups: groupsRes.results || [],
    sources: srcRes.results || [],
  });
}

async function handleDeleteMyAccount(request, db, user, isHttps) {
  const { body } = await readJson(request);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) {
    return errorResponse(400, 'password_required', 'נא להזין את הסיסמה הנוכחית לאישור מחיקת חשבון.');
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    return errorResponse(401, 'invalid_credentials', 'הסיסמה שהוזנה שגויה.');
  }

  const ownedRes = await db.prepare('SELECT id FROM groups WHERE owner_id = ?').bind(user.id).all();
  const stmts = [];
  let transferredGroups = 0;
  let deletedGroups = 0;

  for (const grp of ownedRes.results || []) {
    const next = await db
      .prepare(
        `SELECT user_id FROM group_members WHERE group_id = ? AND user_id <> ?
         ORDER BY joined_at ASC LIMIT 1`
      )
      .bind(grp.id, user.id)
      .first();
    if (next) {
      stmts.push(
        db.prepare('UPDATE groups SET owner_id = ? WHERE id = ?').bind(next.user_id, grp.id),
        db
          .prepare("UPDATE group_members SET role = 'owner' WHERE group_id = ? AND user_id = ?")
          .bind(grp.id, next.user_id)
      );
      transferredGroups += 1;
    } else {
      stmts.push(db.prepare('DELETE FROM groups WHERE id = ?').bind(grp.id));
      deletedGroups += 1;
    }
  }

  const usernameHash = await sha256Hex(user.username.toLowerCase());
  const nowIso = new Date().toISOString();
  stmts.push(
    db
      .prepare('INSERT OR IGNORE INTO reserved_usernames (username_hash, reserved_at) VALUES (?, ?)')
      .bind(usernameHash, nowIso),
    db.prepare('UPDATE reports SET reporter_id = NULL WHERE reporter_id = ?').bind(user.id),
    db.prepare('UPDATE reports SET target_user_id = NULL WHERE target_user_id = ?').bind(user.id),
    db.prepare('DELETE FROM notifications WHERE recipient_id = ? OR actor_id = ?').bind(user.id, user.id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM users WHERE id = ?').bind(user.id)
  );
  await db.batch(stmts);

  return jsonResponse(
    {
      ok: true,
      transferred_groups: transferredGroups,
      deleted_groups: deletedGroups,
      message: 'החשבון נמחק. דיווחים הועברו למצב אנונימי ושם המשתמש נשמר תפוס למניעת התחזות.',
    },
    200,
    { 'Set-Cookie': clearSessionCookie(isHttps) }
  );
}

async function handleGetHome(env, db, user) {
  const now = new Date();
  const weekStartDate = getStartOfIsraeliWeekUtc(now);
  const weekStartIso = weekStartDate.toISOString();
  const fourteenDaysAgoIso = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const weekFormatter = new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: 'numeric',
    month: 'numeric',
  });
  const weeklyHistory = [];
  for (let i = 5; i >= 0; i--) {
    const startMs = weekStartDate.getTime() - i * WEEK_MS;
    const endMs = startMs + WEEK_MS;
    weeklyHistory.push({
      startMs,
      endMs,
      week_start_iso: new Date(startMs).toISOString(),
      label: i === 0 ? 'השבוע' : weekFormatter.format(new Date(startMs)),
      km: 0,
      runs_count: 0,
      is_current: i === 0,
    });
  }

  const [ownRes, notifRes, relSets, activeSrc] = await Promise.all([
    db
      .prepare('SELECT * FROM runs WHERE user_id = ? ORDER BY ran_at DESC, created_at DESC')
      .bind(user.id)
      .all(),
    db
      .prepare(
        `SELECT n.id, n.actor_id, n.run_id, n.is_read, n.created_at,
                u.username AS actor_username, u.display_name AS actor_display_name, u.run_privacy AS actor_privacy,
                r.distance_km, r.duration_sec, r.ran_at, r.is_shared
         FROM notifications n
         JOIN users u ON u.id = n.actor_id
         JOIN runs r ON r.id = n.run_id
         WHERE n.recipient_id = ?
         ORDER BY n.created_at DESC LIMIT 30`
      )
      .bind(user.id)
      .all(),
    getRelationSets(db, user.id),
    db
      .prepare(
        `SELECT provider, connected_at, last_sync_at FROM provider_connections
         WHERE user_id = ? AND status = 'active' LIMIT 1`
      )
      .bind(user.id)
      .first(),
  ]);

  const ownRuns = ownRes.results || [];
  let weeklyKm = 0;
  let weeklyRunsCount = 0;
  let totalKm = 0;
  let totalSec = 0;
  for (const r of ownRuns) {
    const km = Number(r.distance_km);
    const sec = Number(r.duration_sec);
    totalKm += km;
    totalSec += sec;
    if (r.ran_at >= weekStartIso) {
      weeklyKm += km;
      weeklyRunsCount += 1;
    }
    const ranMs = Date.parse(r.ran_at);
    if (!Number.isNaN(ranMs)) {
      for (const b of weeklyHistory) {
        if (ranMs >= b.startMs && ranMs < b.endMs) {
          b.km += km;
          b.runs_count += 1;
          break;
        }
      }
    }
  }
  const avgPace = totalKm > 0 ? Math.round(computePaceSecPerKm(totalKm, totalSec)) : null;

  const notifications = [];
  let unreadCount = 0;
  for (const n of notifRes.results || []) {
    if (!n.is_shared) continue;
    if (!canViewUserRunsFast(user.id, { id: n.actor_id, run_privacy: n.actor_privacy }, relSets)) continue;
    if (!n.is_read) unreadCount += 1;
    notifications.push({
      id: n.id,
      run_id: n.run_id,
      actor_id: n.actor_id,
      actor_username: n.actor_username,
      actor_display_name: n.actor_display_name,
      distance_km: Number(n.distance_km),
      duration_sec: Number(n.duration_sec),
      ran_at: n.ran_at,
      is_read: Boolean(n.is_read),
      created_at: n.created_at,
    });
  }

  let friendsActivity = [];
  const friendIds = Array.from(relSets.friends);
  if (friendIds.length > 0) {
    const placeholders = friendIds.map(() => '?').join(',');
    const feedRes = await db
      .prepare(
        `SELECT r.*, u.username, u.display_name, u.run_privacy
         FROM runs r JOIN users u ON u.id = r.user_id
         WHERE r.user_id IN (${placeholders}) AND r.is_shared = 1 AND r.ran_at >= ?
         ORDER BY r.ran_at DESC, r.created_at DESC LIMIT 50`
      )
      .bind(...friendIds, fourteenDaysAgoIso)
      .all();

    friendsActivity = (feedRes.results || [])
      .filter((row) =>
        canViewUserRunsFast(user.id, { id: row.user_id, run_privacy: row.run_privacy }, relSets)
      )
      .map((row) => ({
        ...decorateRun(row, true),
        runner: { id: row.user_id, username: row.username, display_name: row.display_name },
      }));
  }

  return jsonResponse({
    summary: {
      weekly_km: Math.round(weeklyKm * 100) / 100,
      weekly_runs_count: weeklyRunsCount,
      weekly_goal_km: user.weekly_goal_km !== null && user.weekly_goal_km !== undefined ? Number(user.weekly_goal_km) : null,
      week_start_iso: weekStartIso,
      avg_pace_sec_per_km: avgPace,
      total_runs: ownRuns.length,
    },
    weekly_history: weeklyHistory.map((b) => ({
      week_start_iso: b.week_start_iso,
      label: b.label,
      km: Math.round(b.km * 10) / 10,
      runs_count: b.runs_count,
      is_current: b.is_current,
    })),
    add_run_status: {
      manual_closed: MANUAL_RUN_ENTRY_CLOSED,
      message: MANUAL_RUN_CLOSED_MESSAGE,
      has_connected_source: Boolean(activeSrc && isGarminConfigured(env)),
    },
    personal_records: computePersonalRecords(ownRuns),
    unread_notifications_count: unreadCount,
    notifications,
    friends_activity: friendsActivity,
    recent_runs: ownRuns.slice(0, 10).map((r) => decorateRun(r, true)),
  });
}

async function handleCreateGpsRun(request, db, user) {
  const { body } = await readJson(request, 1500000);
  const computed = verifyAndComputeGpsRun(body.points);
  if (!computed.ok) return errorResponse(400, computed.code, computed.message);

  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  const isShared = body.is_shared === false ? 0 : 1;
  const deviceName =
    typeof body.device_name === 'string' && body.device_name.trim()
      ? body.device_name.trim().slice(0, 80)
      : 'Isrunner GPS';
  const now = new Date();
  const nowIso = now.toISOString();
  const runId = generateId();

  await db
    .prepare(
      `INSERT INTO runs (
        id, user_id, distance_km, duration_sec, ran_at, note, is_shared,
        first_shared_at, notifications_dispatched, source_type, source_verified,
        source_external_id, source_ingested_at, device_name, gps_points_count,
        avg_accuracy_m, splits_json, route_polyline_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, 'app_gps', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      runId,
      user.id,
      computed.data.distance_km,
      computed.data.duration_sec,
      computed.data.ran_at,
      note,
      isShared,
      `gps_${runId}`,
      nowIso,
      deviceName,
      computed.data.gps_points_count,
      computed.data.avg_accuracy_m,
      JSON.stringify(computed.data.splits),
      JSON.stringify(computed.data.route_polyline),
      nowIso,
      nowIso
    )
    .run();

  const saved = await db.prepare('SELECT * FROM runs WHERE id = ?').bind(runId).first();
  let notificationsSent = 0;
  if (isShared === 1) {
    notificationsSent = await dispatchFirstShareNotifications(db, saved, user, now);
  }
  return jsonResponse(
    { ok: true, run: decorateRun(saved, true, true), notifications_sent: notificationsSent },
    201
  );
}

async function handleGetRun(db, user, runId) {
  const run = await db.prepare('SELECT * FROM runs WHERE id = ?').bind(runId).first();
  if (!run) return errorResponse(404, 'not_found', 'הריצה לא נמצאה.');
  const owner = await db
    .prepare('SELECT id, username, display_name, run_privacy FROM users WHERE id = ?')
    .bind(run.user_id)
    .first();
  if (!owner || !(await canViewRun(db, user.id, run, owner))) {
    return errorResponse(404, 'not_found', 'הריצה לא נמצאה או שאין הרשאה לצפות בה.');
  }
  return jsonResponse({
    run: {
      ...decorateRun(run, true, true),
      owner: { id: owner.id, username: owner.username, display_name: owner.display_name },
      is_owner: user.id === run.user_id,
    },
  });
}

async function handleToggleRunShare(request, db, user, runId) {
  const run = await db.prepare('SELECT * FROM runs WHERE id = ?').bind(runId).first();
  if (!run || run.user_id !== user.id) return errorResponse(404, 'not_found', 'הריצה לא נמצאה.');
  const { body } = await readJson(request);
  if (typeof body.is_shared !== 'boolean') {
    return errorResponse(400, 'invalid_is_shared', 'נדרש ערך בוליאני עבור is_shared.');
  }
  const nextShared = body.is_shared ? 1 : 0;
  const now = new Date();
  const nowIso = now.toISOString();
  let notificationsSent = 0;

  if (nextShared === 0) {
    await db.batch([
      db.prepare('UPDATE runs SET is_shared = 0, updated_at = ? WHERE id = ?').bind(nowIso, runId),
      db.prepare('DELETE FROM notifications WHERE run_id = ?').bind(runId),
    ]);
  } else {
    await db.prepare('UPDATE runs SET is_shared = 1, updated_at = ? WHERE id = ?').bind(nowIso, runId).run();
    const fresh = await db.prepare('SELECT * FROM runs WHERE id = ?').bind(runId).first();
    notificationsSent = await dispatchFirstShareNotifications(db, fresh, user, now);
  }

  const updated = await db.prepare('SELECT * FROM runs WHERE id = ?').bind(runId).first();
  return jsonResponse({ run: decorateRun(updated, true), notifications_sent: notificationsSent });
}

async function handleUpdateRunNote(request, db, user, runId) {
  const run = await db.prepare('SELECT * FROM runs WHERE id = ?').bind(runId).first();
  if (!run || run.user_id !== user.id) return errorResponse(404, 'not_found', 'הריצה לא נמצאה.');
  const { body } = await readJson(request);
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  await db
    .prepare('UPDATE runs SET note = ?, updated_at = ? WHERE id = ?')
    .bind(note, new Date().toISOString(), runId)
    .run();
  const updated = await db.prepare('SELECT * FROM runs WHERE id = ?').bind(runId).first();
  return jsonResponse({ run: decorateRun(updated, true) });
}

async function handleDeleteRun(db, user, runId) {
  const run = await db.prepare('SELECT * FROM runs WHERE id = ?').bind(runId).first();
  if (!run || run.user_id !== user.id) return errorResponse(404, 'not_found', 'הריצה לא נמצאה.');
  await db.batch([
    db.prepare('DELETE FROM notifications WHERE run_id = ?').bind(runId),
    db.prepare('DELETE FROM runs WHERE id = ?').bind(runId),
  ]);
  return jsonResponse({ ok: true, deleted_run_id: runId });
}

async function upsertWorkerConnection(db, d) {
  const existing = await db
    .prepare('SELECT id FROM provider_connections WHERE user_id = ? AND provider = ?')
    .bind(d.user_id, d.provider)
    .first();
  if (existing) {
    await db
      .prepare(
        `UPDATE provider_connections
         SET provider_user_id = ?, provider_username = ?, access_token_enc = ?,
             refresh_token_enc = ?, token_expires_at = ?, consent_version = ?,
             consented_at = ?, connected_at = ?, last_sync_at = COALESCE(?, last_sync_at),
             status = 'active'
         WHERE id = ?`
      )
      .bind(
        d.provider_user_id,
        d.provider_username || null,
        d.access_token || null,
        d.refresh_token || null,
        d.token_expires_at || null,
        d.consent_version,
        d.nowIso,
        d.nowIso,
        d.last_sync_at || null,
        existing.id
      )
      .run();
    return existing.id;
  }
  const id = generateId();
  await db
    .prepare(
      `INSERT INTO provider_connections (
        id, user_id, provider, provider_user_id, provider_username,
        access_token_enc, refresh_token_enc, token_expires_at,
        consent_version, consented_at, connected_at, last_sync_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
    )
    .bind(
      id,
      d.user_id,
      d.provider,
      d.provider_user_id,
      d.provider_username || null,
      d.access_token || null,
      d.refresh_token || null,
      d.token_expires_at || null,
      d.consent_version,
      d.nowIso,
      d.nowIso,
      d.last_sync_at || null
    )
    .run();
  return id;
}

async function insertWorkerProviderRun(db, opts) {
  const dup = await db
    .prepare('SELECT id FROM runs WHERE source_type = ? AND source_external_id = ?')
    .bind(opts.provider, opts.externalId)
    .first();
  if (dup) return { duplicate: true, runId: dup.id, notificationsSent: 0 };

  const now = new Date();
  const nowIso = now.toISOString();
  const runId = generateId();
  await db
    .prepare(
      `INSERT INTO runs (
        id, user_id, distance_km, duration_sec, ran_at, note, is_shared,
        first_shared_at, notifications_dispatched, source_type, source_verified,
        source_external_id, source_ingested_at, device_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      runId,
      opts.userId,
      Math.round(opts.distanceKm * 10000) / 10000,
      Math.round(opts.durationSec),
      opts.ranAtIso,
      (opts.note || '').slice(0, 500),
      opts.isShared === false ? 0 : 1,
      opts.provider,
      opts.verified ? 1 : 0,
      opts.externalId,
      nowIso,
      opts.deviceName ? String(opts.deviceName).slice(0, 80) : null,
      nowIso,
      nowIso
    )
    .run();

  const saved = await db.prepare('SELECT * FROM runs WHERE id = ?').bind(runId).first();
  let notificationsSent = 0;
  if (opts.isShared !== false) {
    notificationsSent = await dispatchFirstShareNotifications(
      db,
      saved,
      { id: opts.userId, run_privacy: opts.runPrivacy },
      now
    );
  }
  return { duplicate: false, runId, notificationsSent, saved };
}

async function handleGetSources(env, db, user, url) {
  const garminConfigured = isGarminConfigured(env);
  const stravaConfigured = isStravaConfigured(env);
  const baseUrl = getWorkerBaseUrl(url, env);

  const [connsRes, countsRes] = await Promise.all([
    db
      .prepare(
        `SELECT id, provider, provider_user_id, provider_username, consent_version,
                consented_at, connected_at, last_sync_at, status
         FROM provider_connections WHERE user_id = ? AND status = 'active'`
      )
      .bind(user.id)
      .all(),
    db
      .prepare('SELECT source_type, COUNT(*) AS cnt FROM runs WHERE user_id = ? GROUP BY source_type')
      .bind(user.id)
      .all(),
  ]);
  const connByProvider = Object.fromEntries((connsRes.results || []).map((c) => [c.provider, c]));
  const countMap = Object.fromEntries((countsRes.results || []).map((r) => [r.source_type, Number(r.cnt)]));

  const garminConn = connByProvider.garmin_connect || null;
  const stravaConn = connByProvider.strava || null;
  const garminConnected = Boolean(garminConn && garminConfigured);
  const stravaConnected = Boolean(stravaConn && stravaConfigured);

  return jsonResponse({
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
          : 'הקוד לחיבור Strava מוכן במלואו. כדי להפעיל אותו לוקח 2 דקות: פותחים אפליקציית API חינמית ב-strava.com/settings/api ומגדירים ב-Cloudflare Secrets את STRAVA_CLIENT_ID ו-STRAVA_CLIENT_SECRET.',
        consent: STRAVA_CONSENT_SUMMARY,
      },
    ],
    legacy_runs_count: countMap.self_reported_legacy || 0,
    legacy_note:
      'ריצות קיימות מהתקופה שלפני סגירת ההזנה הידנית נשמרות ומסומנות "דיווח עצמי, לא מאומת". הן לא נמחקות ולא הופכות למאומתות.',
  });
}

async function handleStartGarminConnect(request, env, db, user, url) {
  const { body } = await readJson(request);
  if (body.consent_accepted !== true) {
    return errorResponse(400, 'consent_required', 'נדרשת הסכמה מפורשת לפני תחילת חיבור.');
  }
  if (!isGarminConfigured(env)) {
    return errorResponse(
      503,
      'garmin_not_configured',
      'חיבור Garmin Connect עדיין לא פעיל: נדרש אישור ב-Garmin Connect Developer Program ומפתחות OAuth אמיתיים בשרת. לא בוצע חיבור.'
    );
  }
  const { clientId } = getGarminCreds(env);
  const state = generateSessionToken();
  const { verifier, challenge } = await generatePkcePair();
  const redirectUri = `${getWorkerBaseUrl(url, env)}/api/oauth/garmin/callback`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

  await db
    .prepare(
      `INSERT INTO oauth_states (state, user_id, provider, code_verifier, consent_version, redirect_uri, created_at, expires_at)
       VALUES (?, ?, 'garmin_connect', ?, ?, ?, ?, ?)`
    )
    .bind(state, user.id, verifier, GARMIN_CONSENT_SUMMARY.version, redirectUri, now.toISOString(), expiresAt)
    .run();

  const authUrl = new URL(GARMIN_OAUTH_AUTHORIZE_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  return jsonResponse({ ok: true, provider: 'garmin_connect', authorize_url: authUrl.toString() });
}

async function handleGarminOAuthCallback(env, db, url) {
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const oauthErr = url.searchParams.get('error') || '';
  if (oauthErr) return redirectResponse(`/#/sources?oauth_error=${encodeURIComponent(oauthErr)}`);
  if (!code || !state || !isGarminConfigured(env)) {
    return redirectResponse('/#/sources?oauth_error=garmin_invalid_callback');
  }
  const stateRow = await db
    .prepare("SELECT * FROM oauth_states WHERE state = ? AND provider = 'garmin_connect'")
    .bind(state)
    .first();
  await db.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
  if (!stateRow || stateRow.expires_at < new Date().toISOString()) {
    return redirectResponse('/#/sources?oauth_error=oauth_state_expired');
  }
  const { clientId, clientSecret } = getGarminCreds(env);
  const fetcher = (env && env.__FETCH) || fetch;
  const tokenRes = await fetcher(GARMIN_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: stateRow.code_verifier || '',
      redirect_uri: stateRow.redirect_uri,
    }).toString(),
  });
  if (!tokenRes.ok) return redirectResponse('/#/sources?oauth_error=garmin_token_exchange_failed');
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return redirectResponse('/#/sources?oauth_error=garmin_missing_token');

  let providerUserId = '';
  try {
    const uidRes = await fetcher(GARMIN_USER_ID_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (uidRes.ok) {
      const uidData = await uidRes.json();
      providerUserId = String(uidData.userId || uidData.user_id || '').trim();
    }
  } catch {}
  if (!providerUserId) return redirectResponse('/#/sources?oauth_error=garmin_user_id_failed');

  await upsertWorkerConnection(db, {
    user_id: stateRow.user_id,
    provider: 'garmin_connect',
    provider_user_id: providerUserId,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || '',
    token_expires_at: new Date(Date.now() + (Number(tokenData.expires_in) || 3600) * 1000).toISOString(),
    consent_version: stateRow.consent_version,
    nowIso: new Date().toISOString(),
  });
  return redirectResponse('/#/sources?connected=garmin_connect');
}

async function handleGarminWebhook(request, env, db) {
  const { webhookSecret } = getGarminCreds(env);
  const { raw, body } = await readJson(request, 512 * 1024);
  if (webhookSecret) {
    const sig = request.headers.get('x-isrunner-provider-signature') || '';
    const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const sigOk = sig ? await verifyWebhookSignature(webhookSecret, raw, sig) : false;
    if (!sigOk && !(bearer && bearer === webhookSecret)) {
      return errorResponse(401, 'invalid_webhook_auth', 'אימות Webhook של Garmin נכשל.');
    }
  } else if (!isGarminConfigured(env)) {
    return errorResponse(503, 'garmin_not_configured', 'חיבור Garmin לא מוגדר בשרת.');
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
    if (!providerUserId || !externalId || !GARMIN_RUN_TYPES.has(actType) || distMeters < 50 || durSec < 10) {
      skipped += 1;
      continue;
    }
    const conn = await db
      .prepare(
        `SELECT pc.*, u.run_privacy FROM provider_connections pc JOIN users u ON u.id = pc.user_id
         WHERE pc.provider = 'garmin_connect' AND pc.provider_user_id = ? AND pc.status = 'active'`
      )
      .bind(providerUserId)
      .first();
    if (!conn) {
      skipped += 1;
      continue;
    }
    const r = await insertWorkerProviderRun(db, {
      userId: conn.user_id,
      runPrivacy: conn.run_privacy,
      provider: 'garmin_connect',
      externalId,
      distanceKm: distMeters / 1000,
      durationSec: durSec,
      ranAtIso: Number.isFinite(Number(act.startTimeInSeconds))
        ? new Date(Number(act.startTimeInSeconds) * 1000).toISOString()
        : new Date().toISOString(),
      note: typeof act.activityName === 'string' ? act.activityName.trim() : '',
      deviceName: act.deviceName || 'Garmin',
      verified: act.manual === true ? 0 : 1,
    });
    await db
      .prepare('UPDATE provider_connections SET last_sync_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), conn.id)
      .run();
    if (r.duplicate) skipped += 1;
    else imported += 1;
  }
  return jsonResponse({ ok: true, imported, skipped });
}

async function handleStartStravaConnect(request, env, db, user, url) {
  const { body } = await readJson(request);
  if (body.consent_accepted !== true) {
    return errorResponse(400, 'consent_required', 'נדרשת הסכמה מפורשת לפני תחילת חיבור ל-Strava.');
  }
  if (!isStravaConfigured(env)) {
    return errorResponse(
      503,
      'strava_not_configured',
      'חיבור Strava מוכן בקוד אך טרם הוגדרו מפתחות STRAVA_CLIENT_ID ו-STRAVA_CLIENT_SECRET בשרת. לא בוצע חיבור.'
    );
  }
  const state = generateSessionToken();
  const redirectUri = `${getWorkerBaseUrl(url, env)}/api/oauth/strava/callback`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO oauth_states (state, user_id, provider, code_verifier, consent_version, redirect_uri, created_at, expires_at)
       VALUES (?, ?, 'strava', NULL, ?, ?, ?, ?)`
    )
    .bind(state, user.id, STRAVA_CONSENT_SUMMARY.version, redirectUri, now.toISOString(), expiresAt)
    .run();

  const authUrl = new URL(STRAVA_OAUTH_AUTHORIZE_URL);
  authUrl.searchParams.set('client_id', env.STRAVA_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('approval_prompt', 'auto');
  authUrl.searchParams.set('scope', 'read,activity:read_all');
  authUrl.searchParams.set('state', state);
  return jsonResponse({ ok: true, provider: 'strava', authorize_url: authUrl.toString() });
}

async function ensureFreshWorkerStravaToken(env, db, conn) {
  const expMs = conn.token_expires_at ? Date.parse(conn.token_expires_at) : 0;
  if (conn.access_token_enc && expMs > Date.now() + 5 * 60 * 1000) return conn.access_token_enc;
  if (!conn.refresh_token_enc) {
    throw Object.assign(new Error('חסר טוקן רענון של Strava — יש לחבר מחדש.'), { status: 401 });
  }
  const fetcher = (env && env.__FETCH) || fetch;
  const res = await fetcher(STRAVA_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token_enc,
    }),
  });
  if (!res.ok) throw Object.assign(new Error('רענון ההרשאה מול Strava נכשל.'), { status: 502 });
  const data = await res.json();
  const nextExp = data.expires_at
    ? new Date(Number(data.expires_at) * 1000).toISOString()
    : new Date(Date.now() + 6 * 3600 * 1000).toISOString();
  await db
    .prepare(
      'UPDATE provider_connections SET access_token_enc = ?, refresh_token_enc = ?, token_expires_at = ? WHERE id = ?'
    )
    .bind(data.access_token, data.refresh_token || conn.refresh_token_enc, nextExp, conn.id)
    .run();
  return data.access_token;
}

async function ingestWorkerStravaActivity(db, userId, runPrivacy, act) {
  const sportType = String(act.sport_type || act.type || '');
  if (!STRAVA_RUN_TYPES.has(sportType)) return { skipped: true };
  const distMeters = Number(act.distance);
  const durSec = Math.round(Number(act.moving_time || act.elapsed_time));
  const externalId = String(act.id || '').trim();
  if (!externalId || !Number.isFinite(distMeters) || distMeters < 50 || !Number.isFinite(durSec) || durSec < 10) {
    return { skipped: true };
  }
  const ranAtIso = act.start_date && !Number.isNaN(Date.parse(act.start_date))
    ? new Date(act.start_date).toISOString()
    : new Date().toISOString();
  const r = await insertWorkerProviderRun(db, {
    userId,
    runPrivacy,
    provider: 'strava',
    externalId,
    distanceKm: distMeters / 1000,
    durationSec: durSec,
    ranAtIso,
    note: typeof act.name === 'string' ? act.name.trim() : '',
    deviceName: act.device_name || (act.manual ? 'Strava (הזנה ידנית)' : 'Strava'),
    verified: act.manual === true ? 0 : 1,
  });
  return { skipped: false, duplicate: r.duplicate, runId: r.runId };
}

async function syncWorkerStrava(env, db, conn, runPrivacy) {
  const accessToken = await ensureFreshWorkerStravaToken(env, db, conn);
  const fetcher = (env && env.__FETCH) || fetch;
  const listRes = await fetcher(`${STRAVA_API_BASE}/athlete/activities?per_page=30`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) {
    throw Object.assign(new Error(`קריאת ריצות מ-Strava נכשלה (HTTP ${listRes.status}).`), { status: 502 });
  }
  const activities = await listRes.json();
  let imported = 0;
  let duplicates = 0;
  let nonRuns = 0;
  if (Array.isArray(activities)) {
    for (const act of activities) {
      const outcome = await ingestWorkerStravaActivity(db, conn.user_id, runPrivacy, act);
      if (outcome.skipped) nonRuns += 1;
      else if (outcome.duplicate) duplicates += 1;
      else imported += 1;
    }
  }
  await db
    .prepare('UPDATE provider_connections SET last_sync_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), conn.id)
    .run();
  return {
    imported,
    duplicates,
    non_runs_skipped: nonRuns,
    total_fetched: Array.isArray(activities) ? activities.length : 0,
  };
}

async function handleStravaOAuthCallback(env, db, url) {
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const oauthErr = url.searchParams.get('error') || '';
  if (oauthErr) return redirectResponse(`/#/sources?oauth_error=${encodeURIComponent(oauthErr)}`);
  if (!code || !state || !isStravaConfigured(env)) {
    return redirectResponse('/#/sources?oauth_error=strava_invalid_callback');
  }
  const stateRow = await db
    .prepare("SELECT * FROM oauth_states WHERE state = ? AND provider = 'strava'")
    .bind(state)
    .first();
  await db.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
  if (!stateRow || stateRow.expires_at < new Date().toISOString()) {
    return redirectResponse('/#/sources?oauth_error=oauth_state_expired');
  }
  const fetcher = (env && env.__FETCH) || fetch;
  const tokenRes = await fetcher(STRAVA_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return redirectResponse('/#/sources?oauth_error=strava_token_exchange_failed');
  const data = await tokenRes.json();
  const athleteId = data.athlete?.id ? String(data.athlete.id) : '';
  if (!data.access_token || !athleteId) return redirectResponse('/#/sources?oauth_error=strava_missing_athlete');

  const athleteName =
    data.athlete?.username ||
    [data.athlete?.firstname, data.athlete?.lastname].filter(Boolean).join(' ') ||
    null;
  const expIso = data.expires_at
    ? new Date(Number(data.expires_at) * 1000).toISOString()
    : new Date(Date.now() + 6 * 3600 * 1000).toISOString();

  await upsertWorkerConnection(db, {
    user_id: stateRow.user_id,
    provider: 'strava',
    provider_user_id: athleteId,
    provider_username: athleteName,
    access_token: data.access_token,
    refresh_token: data.refresh_token || '',
    token_expires_at: expIso,
    consent_version: stateRow.consent_version,
    nowIso: new Date().toISOString(),
  });

  let synced = 0;
  try {
    const conn = await db
      .prepare("SELECT * FROM provider_connections WHERE user_id = ? AND provider = 'strava'")
      .bind(stateRow.user_id)
      .first();
    const owner = await db
      .prepare('SELECT run_privacy FROM users WHERE id = ?')
      .bind(stateRow.user_id)
      .first();
    if (conn && owner) {
      const r = await syncWorkerStrava(env, db, conn, owner.run_privacy);
      synced = r.imported;
    }
  } catch {}
  return redirectResponse(`/#/sources?connected=strava&synced=${synced}`);
}

async function handleSyncStrava(env, db, user) {
  if (!isStravaConfigured(env)) {
    return errorResponse(503, 'strava_not_configured', 'מפתחות Strava אינם מוגדרים בשרת.');
  }
  const conn = await db
    .prepare("SELECT * FROM provider_connections WHERE user_id = ? AND provider = 'strava' AND status = 'active'")
    .bind(user.id)
    .first();
  if (!conn) return errorResponse(404, 'not_connected', 'חשבון Strava אינו מחובר.');
  const result = await syncWorkerStrava(env, db, conn, user.run_privacy);
  return jsonResponse({
    ok: true,
    ...result,
    message:
      result.imported > 0
        ? `סונכרנו ${result.imported} ריצות חדשות מ-Strava.`
        : 'הסנכרון הושלם — אין ריצות חדשות לייבוא.',
  });
}

async function handleStravaWebhookVerify(env, url) {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const expected = (env && env.STRAVA_WEBHOOK_VERIFY_TOKEN) || '';
  if (!expected) return errorResponse(503, 'webhook_not_configured', 'STRAVA_WEBHOOK_VERIFY_TOKEN לא מוגדר.');
  if (mode === 'subscribe' && token === expected && challenge) {
    return jsonResponse({ 'hub.challenge': challenge });
  }
  return errorResponse(403, 'invalid_verify_token', 'אימות Webhook נכשל.');
}

async function handleStravaWebhookEvent(request, env, db) {
  if (!isStravaConfigured(env)) return errorResponse(503, 'strava_not_configured', 'Strava לא מוגדר בשרת.');
  const { body } = await readJson(request);
  if (body.object_type !== 'activity' || !['create', 'update'].includes(body.aspect_type)) {
    return jsonResponse({ ok: true, ignored: true });
  }
  const ownerId = String(body.owner_id || '').trim();
  const activityId = String(body.object_id || '').trim();
  if (!ownerId || !activityId) return jsonResponse({ ok: true, ignored: true });
  const conn = await db
    .prepare(
      `SELECT pc.*, u.run_privacy FROM provider_connections pc JOIN users u ON u.id = pc.user_id
       WHERE pc.provider = 'strava' AND pc.provider_user_id = ? AND pc.status = 'active'`
    )
    .bind(ownerId)
    .first();
  if (!conn) return jsonResponse({ ok: true, ignored: true });
  const accessToken = await ensureFreshWorkerStravaToken(env, db, conn);
  const fetcher = (env && env.__FETCH) || fetch;
  const actRes = await fetcher(`${STRAVA_API_BASE}/activities/${encodeURIComponent(activityId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!actRes.ok) return jsonResponse({ ok: true, fetch_failed: true });
  const act = await actRes.json();
  const outcome = await ingestWorkerStravaActivity(db, conn.user_id, conn.run_privacy, act);
  await db
    .prepare('UPDATE provider_connections SET last_sync_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), conn.id)
    .run();
  return jsonResponse({ ok: true, outcome });
}

async function handleDisconnectSource(request, env, db, user, provider) {
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    return errorResponse(404, 'unknown_provider', 'מקור מדידה לא מוכר.');
  }
  const { body } = await readJson(request);
  const deleteRuns = body.delete_source_runs === true;

  const existing = await db
    .prepare('SELECT access_token_enc FROM provider_connections WHERE user_id = ? AND provider = ?')
    .bind(user.id, provider)
    .first();
  if (existing?.access_token_enc) {
    const fetcher = (env && env.__FETCH) || fetch;
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
    } catch {}
  }

  const stmts = [
    db.prepare('DELETE FROM provider_connections WHERE user_id = ? AND provider = ?').bind(user.id, provider),
  ];
  if (deleteRuns) {
    stmts.push(
      db
        .prepare(
          'DELETE FROM notifications WHERE run_id IN (SELECT id FROM runs WHERE user_id = ? AND source_type = ?)'
        )
        .bind(user.id, provider),
      db.prepare('DELETE FROM runs WHERE user_id = ? AND source_type = ?').bind(user.id, provider)
    );
  }
  const results = await db.batch(stmts);
  const disconnected = (results[0]?.meta?.changes || 0) > 0;
  const deletedRuns = deleteRuns ? results[2]?.meta?.changes || 0 : 0;

  return jsonResponse({
    ok: true,
    provider,
    disconnected,
    deleted_source_runs: deletedRuns,
    message: deleteRuns
      ? `החיבור נותק ונמחקו ${deletedRuns} ריצות ממקור זה. ריצות היסטוריות מדיווח עצמי לא שונו.`
      : 'החיבור נותק. ריצות קיימות נשמרו.',
  });
}

async function handleDeleteSourceData(db, user, provider) {
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    return errorResponse(404, 'unknown_provider', 'מקור מדידה לא מוכר.');
  }
  const results = await db.batch([
    db
      .prepare(
        'DELETE FROM notifications WHERE run_id IN (SELECT id FROM runs WHERE user_id = ? AND source_type = ?)'
      )
      .bind(user.id, provider),
    db.prepare('DELETE FROM runs WHERE user_id = ? AND source_type = ?').bind(user.id, provider),
  ]);
  const deletedRuns = results[1]?.meta?.changes || 0;
  return jsonResponse({
    ok: true,
    provider,
    deleted_source_runs: deletedRuns,
    message: `נמחקו ${deletedRuns} ריצות שמקורן ב-${provider}. ריצות מדיווח עצמי לא שונו.`,
  });
}

async function handleProviderIngest(request, env, db, provider) {
  if (!SUPPORTED_PROVIDERS.has(provider)) return errorResponse(404, 'unknown_provider', 'ספק מדידה לא נתמך.');
  const secret = env.GARMIN_WEBHOOK_SECRET;
  if (!secret) {
    return errorResponse(
      503,
      'provider_not_configured',
      'נתיב קליטת הספק אינו פעיל כי לא הוגדרו מפתחות ספק מאושרים בשרת.'
    );
  }

  const { raw, body } = await readJson(request);
  const sig = request.headers.get('x-isrunner-provider-signature');
  if (!(await verifyWebhookSignature(secret, raw, sig))) {
    return errorResponse(401, 'invalid_provider_signature', 'חתימת ספק לא תקינה או חסרה.');
  }

  const providerUserId = typeof body.provider_user_id === 'string' ? body.provider_user_id.trim() : '';
  const externalId = typeof body.external_activity_id === 'string' ? body.external_activity_id.trim() : '';
  const distanceKm = Number(body.distance_km);
  const durationSec = Math.round(Number(body.duration_sec));
  const ranAt = typeof body.ran_at === 'string' ? body.ran_at : '';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  const deviceName = typeof body.device_name === 'string' ? body.device_name.trim() : null;
  const isShared = body.is_shared === false ? 0 : 1;

  if (!providerUserId || !externalId) return errorResponse(400, 'missing_provider_ids', 'חסרים מזהי ספק.');
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > 500) {
    return errorResponse(400, 'invalid_distance', 'מרחק לא תקין.');
  }
  if (!Number.isInteger(durationSec) || durationSec <= 0 || durationSec > 604800) {
    return errorResponse(400, 'invalid_duration', 'משך ריצה לא תקין.');
  }
  if (!ranAt || Number.isNaN(Date.parse(ranAt))) {
    return errorResponse(400, 'invalid_ran_at', 'תאריך ריצה לא תקין.');
  }

  const conn = await db
    .prepare(
      `SELECT pc.*, u.run_privacy FROM provider_connections pc JOIN users u ON u.id = pc.user_id
       WHERE pc.provider = ? AND pc.provider_user_id = ? AND pc.status = 'active'`
    )
    .bind(provider, providerUserId)
    .first();
  if (!conn) return errorResponse(404, 'connection_not_found', 'לא נמצא חיבור ספק פעיל למשתמש זה.');

  const r = await insertWorkerProviderRun(db, {
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
    isShared: isShared === 1,
  });
  if (r.duplicate) return jsonResponse({ ok: true, duplicate: true, run_id: r.runId });

  await db
    .prepare('UPDATE provider_connections SET last_sync_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), conn.id)
    .run();

  return jsonResponse(
    { ok: true, duplicate: false, run: decorateRun(r.saved, true), notifications_sent: r.notificationsSent },
    201
  );
}

async function handleGlobalLeaderboard(env, db, user, url) {
  const category = url.searchParams.get('category') || '5k';
  if (!CATEGORY_BY_KEY[category]) return errorResponse(400, 'invalid_category', 'קטגוריית דירוג לא חוקית.');

  const requireVerified = Boolean(
    env && (env.RESEND_API_KEY || env.REQUIRE_VERIFIED_EMAIL === 'true')
  );

  const [rowsRes, relSets] = await Promise.all([
    db
      .prepare(
        `SELECT r.id, r.user_id, r.distance_km, r.duration_sec, r.ran_at, r.source_type, r.source_verified,
                u.username, u.display_name, u.run_privacy, u.email_verified
         FROM runs r JOIN users u ON u.id = r.user_id
         WHERE r.is_shared = 1 AND u.show_in_global_leaderboard = 1
           ${requireVerified ? 'AND u.email_verified = 1' : ''}`
      )
      .all(),
    getRelationSets(db, user.id),
  ]);

  const visible = (rowsRes.results || []).filter((row) =>
    canViewUserRunsFast(user.id, { id: row.user_id, run_privacy: row.run_privacy }, relSets)
  );

  const entries = buildLeaderboardEntries(visible, category);
  const myEntry = entries.find((e) => e.user_id === user.id) || null;

  return jsonResponse({
    category,
    categories: RANKING_CATEGORIES.map((c) => ({
      key: c.key,
      label: c.label,
      short_label: c.shortLabel,
      range_text: c.rangeText,
      type: c.type,
    })),
    rule: RANKING_RULE_EXPLANATION,
    requires_email_verification: requireVerified,
    viewer_email_verified: Boolean(user.email_verified),
    my_entry: myEntry,
    entries,
  });
}

async function handleListFriends(db, user) {
  const [friendsRes, incomingRes, outgoingRes, blockedRes] = await Promise.all([
    db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.bio, f.updated_at AS friends_since
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
         WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?)
         ORDER BY u.display_name COLLATE NOCASE ASC`
      )
      .bind(user.id, user.id, user.id)
      .all(),
    db
      .prepare(
        `SELECT f.id AS request_id, u.id, u.username, u.display_name, f.created_at
         FROM friendships f JOIN users u ON u.id = f.requester_id
         WHERE f.status = 'pending' AND f.addressee_id = ? ORDER BY f.created_at DESC`
      )
      .bind(user.id)
      .all(),
    db
      .prepare(
        `SELECT f.id AS request_id, u.id, u.username, u.display_name, f.created_at
         FROM friendships f JOIN users u ON u.id = f.addressee_id
         WHERE f.status = 'pending' AND f.requester_id = ? ORDER BY f.created_at DESC`
      )
      .bind(user.id)
      .all(),
    db
      .prepare(
        `SELECT u.id, u.username, u.display_name, b.created_at AS blocked_at
         FROM blocks b JOIN users u ON u.id = b.blocked_id
         WHERE b.blocker_id = ? ORDER BY b.created_at DESC`
      )
      .bind(user.id)
      .all(),
  ]);
  return jsonResponse({
    friends: friendsRes.results || [],
    incoming: incomingRes.results || [],
    outgoing: outgoingRes.results || [],
    blocked: blockedRes.results || [],
  });
}

async function handleSearchUsers(db, user, url) {
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return jsonResponse({ users: [] });
  const pattern = `%${q}%`;
  const [res, relSets] = await Promise.all([
    db
      .prepare(
        `SELECT id, username, display_name, bio FROM users
         WHERE id <> ? AND (display_name LIKE ? COLLATE NOCASE OR username LIKE ? COLLATE NOCASE)
         ORDER BY display_name COLLATE NOCASE ASC LIMIT 30`
      )
      .bind(user.id, pattern, pattern)
      .all(),
    getRelationSets(db, user.id),
  ]);
  const users = [];
  for (const row of res.results || []) {
    if (relSets.blocked.has(row.id)) continue;
    users.push({
      id: row.id,
      username: row.username,
      display_name: row.display_name,
      bio: row.bio || '',
      relation: await getFriendshipRelation(db, user.id, row.id),
    });
  }
  return jsonResponse({ users });
}

async function handleSendFriendRequest(request, db, user) {
  const rl = checkRateLimit(`friend_req:${user.id}:${getClientIp(request)}`, 30, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(429, 'rate_limited', 'יותר מדי בקשות חברות. נסה שוב מאוחר יותר.', {
      'Retry-After': String(rl.retryAfterSec),
    });
  }
  const { body } = await readJson(request);
  const targetId = typeof body.target_user_id === 'string' ? body.target_user_id.trim() : '';
  if (!targetId || targetId === user.id) {
    return errorResponse(400, 'invalid_target', 'אי אפשר לשלוח בקשת חברות לעצמך.');
  }
  const target = await db.prepare('SELECT id FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return errorResponse(404, 'not_found', 'המשתמש לא נמצא.');
  if (await isBlockedBetween(db, user.id, targetId)) {
    return errorResponse(403, 'blocked', 'אי אפשר לשלוח בקשת חברות למשתמש זה.');
  }

  const existing = await db
    .prepare(
      `SELECT * FROM friendships
       WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`
    )
    .bind(user.id, targetId, targetId, user.id)
    .first();

  const nowIso = new Date().toISOString();
  if (existing) {
    if (existing.status === 'accepted') return jsonResponse({ ok: true, status: 'accepted', message: 'אתם כבר חברים.' });
    if (existing.requester_id === targetId) {
      await db
        .prepare("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE id = ?")
        .bind(nowIso, existing.id)
        .run();
      return jsonResponse({ ok: true, status: 'accepted', message: 'החברות אושרה.' });
    }
    return jsonResponse({ ok: true, status: 'pending', message: 'בקשת החברות כבר ממתינה.' });
  }

  await db
    .prepare(
      `INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`
    )
    .bind(generateId(), user.id, targetId, nowIso, nowIso)
    .run();
  return jsonResponse({ ok: true, status: 'pending', message: 'בקשת חברות נשלחה.' }, 201);
}

async function handleRespondFriendRequest(request, db, user, otherUserId) {
  const { body } = await readJson(request);
  const action = body.action;
  if (!['accept', 'decline'].includes(action)) return errorResponse(400, 'invalid_action', 'פעולה לא חוקית.');
  const pending = await db
    .prepare("SELECT * FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'")
    .bind(otherUserId, user.id)
    .first();
  if (!pending) return errorResponse(404, 'not_found', 'לא נמצאה בקשת חברות ממתינה.');

  if (action === 'accept') {
    if (await isBlockedBetween(db, user.id, otherUserId)) {
      return errorResponse(403, 'blocked', 'אי אפשר לאשר בקשה ממשתמש חסום.');
    }
    await db
      .prepare("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), pending.id)
      .run();
    return jsonResponse({ ok: true, status: 'accepted' });
  }
  await db.prepare('DELETE FROM friendships WHERE id = ?').bind(pending.id).run();
  return jsonResponse({ ok: true, status: 'declined' });
}

async function handleRemoveFriend(db, user, otherUserId) {
  await db.batch([
    db
      .prepare(
        `DELETE FROM friendships
         WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`
      )
      .bind(user.id, otherUserId, otherUserId, user.id),
    db
      .prepare(
        `DELETE FROM notifications
         WHERE (recipient_id = ? AND actor_id = ?) OR (recipient_id = ? AND actor_id = ?)`
      )
      .bind(user.id, otherUserId, otherUserId, user.id),
  ]);
  return jsonResponse({ ok: true });
}

async function handleBlockUser(db, user, targetUserId) {
  if (targetUserId === user.id) return errorResponse(400, 'invalid_target', 'אי אפשר לחסום את עצמך.');
  const target = await db.prepare('SELECT id FROM users WHERE id = ?').bind(targetUserId).first();
  if (!target) return errorResponse(404, 'not_found', 'המשתמש לא נמצא.');
  const nowIso = new Date().toISOString();
  await db.batch([
    db
      .prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)')
      .bind(user.id, targetUserId, nowIso),
    db
      .prepare(
        `DELETE FROM friendships
         WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`
      )
      .bind(user.id, targetUserId, targetUserId, user.id),
    db
      .prepare(
        `DELETE FROM notifications
         WHERE (recipient_id = ? AND actor_id = ?) OR (recipient_id = ? AND actor_id = ?)`
      )
      .bind(user.id, targetUserId, targetUserId, user.id),
  ]);
  return jsonResponse({ ok: true, blocked_user_id: targetUserId });
}

async function handleGetUserProfile(db, user, targetUserId) {
  const target = await db
    .prepare('SELECT id, username, display_name, bio, run_privacy, created_at FROM users WHERE id = ?')
    .bind(targetUserId)
    .first();
  if (!target) return errorResponse(404, 'not_found', 'המשתמש לא נמצא.');

  const relation = await getFriendshipRelation(db, user.id, target.id);
  if (relation === 'blocked_me') return errorResponse(404, 'not_found', 'הפרופיל אינו זמין.');

  const isSelf = user.id === target.id;
  const canView = relation !== 'blocked_by_me' && (await canViewUserRuns(db, user.id, target));

  let visibleRuns = [];
  if (canView) {
    const res = isSelf
      ? await db
          .prepare('SELECT * FROM runs WHERE user_id = ? ORDER BY ran_at DESC, created_at DESC')
          .bind(target.id)
          .all()
      : await db
          .prepare('SELECT * FROM runs WHERE user_id = ? AND is_shared = 1 ORDER BY ran_at DESC, created_at DESC')
          .bind(target.id)
          .all();
    visibleRuns = res.results || [];
  }

  let privacyNote = null;
  if (!canView && !isSelf) {
    if (relation === 'blocked_by_me') privacyNote = 'משתמש זה חסום על ידך.';
    else if (target.run_privacy === 'friends') privacyNote = 'הריצות והשיאים של רץ זה זמינים לחברים בלבד.';
    else privacyNote = 'הרץ בחר לשמור את הריצות והשיאים שלו פרטיים.';
  }

  return jsonResponse({
    profile: {
      id: target.id,
      username: target.username,
      display_name: target.display_name,
      bio: target.bio || '',
      created_at: target.created_at,
      relation,
      is_self: isSelf,
      can_view_runs: canView,
      privacy_note: privacyNote,
    },
    personal_records: computePersonalRecords(visibleRuns),
    runs: visibleRuns.slice(0, 50).map((r) => decorateRun(r, true)),
  });
}

async function handleListNotifications(db, user) {
  const [res, relSets] = await Promise.all([
    db
      .prepare(
        `SELECT n.id, n.actor_id, n.run_id, n.is_read, n.created_at,
                u.username AS actor_username, u.display_name AS actor_display_name, u.run_privacy AS actor_privacy,
                r.distance_km, r.duration_sec, r.ran_at, r.is_shared
         FROM notifications n
         JOIN users u ON u.id = n.actor_id
         JOIN runs r ON r.id = n.run_id
         WHERE n.recipient_id = ?
         ORDER BY n.created_at DESC LIMIT 50`
      )
      .bind(user.id)
      .all(),
    getRelationSets(db, user.id),
  ]);

  const notifications = [];
  let unreadCount = 0;
  for (const row of res.results || []) {
    if (!row.is_shared) continue;
    if (!canViewUserRunsFast(user.id, { id: row.actor_id, run_privacy: row.actor_privacy }, relSets)) continue;
    if (!row.is_read) unreadCount += 1;
    notifications.push({
      id: row.id,
      run_id: row.run_id,
      actor_id: row.actor_id,
      actor_username: row.actor_username,
      actor_display_name: row.actor_display_name,
      distance_km: Number(row.distance_km),
      duration_sec: Number(row.duration_sec),
      ran_at: row.ran_at,
      is_read: Boolean(row.is_read),
      created_at: row.created_at,
    });
  }
  return jsonResponse({
    unread_count: unreadCount,
    notifications,
    push_note: 'התראות לטלפון כשהאפליקציה סגורה (Web Push) הן שלב עתידי נפרד שידרוש הסכמה מפורשת שלך.',
  });
}

async function handleCreateGroup(request, db, user) {
  const rl = checkRateLimit(`create_group:${user.id}:${getClientIp(request)}`, 10, 60 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(429, 'rate_limited', 'יצרת יותר מדי קבוצות לאחרונה.', {
      'Retry-After': String(rl.retryAfterSec),
    });
  }
  const { body } = await readJson(request);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 300) : '';
  if (name.length < 2 || name.length > 50) {
    return errorResponse(400, 'invalid_name', 'שם הקבוצה חייב להכיל 2 עד 50 תווים.');
  }

  let joinCode = '';
  for (let i = 0; i < 8; i++) {
    const candidate = generateJoinCode(6);
    const exists = await db
      .prepare('SELECT 1 AS ok FROM groups WHERE join_code = ? COLLATE NOCASE')
      .bind(candidate)
      .first();
    if (!exists) {
      joinCode = candidate;
      break;
    }
  }
  if (!joinCode) joinCode = generateJoinCode(8);

  const groupId = generateId();
  const nowIso = new Date().toISOString();
  await db.batch([
    db
      .prepare('INSERT INTO groups (id, name, description, join_code, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(groupId, name, description, joinCode, user.id, nowIso),
    db
      .prepare("INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)")
      .bind(groupId, user.id, nowIso),
  ]);
  const group = await db
    .prepare("SELECT g.*, 1 AS member_count, 'owner' AS role FROM groups g WHERE g.id = ?")
    .bind(groupId)
    .first();
  return jsonResponse({ group }, 201);
}

async function handlePreviewGroupByCode(request, db, user, url) {
  const rl = checkRateLimit(`group_preview:${user.id}:${getClientIp(request)}`, 25, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(429, 'rate_limited', 'יותר מדי חיפושי קוד הצטרפות.', {
      'Retry-After': String(rl.retryAfterSec),
    });
  }
  const code = (url.searchParams.get('code') || '').trim().toUpperCase();
  if (code.length < 4 || code.length > 12) return errorResponse(400, 'invalid_code', 'קוד הצטרפות לא תקין.');

  const group = await db
    .prepare(
      `SELECT g.id, g.name, g.description, g.join_code, g.created_at,
              u.display_name AS owner_display_name,
              (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count
       FROM groups g JOIN users u ON u.id = g.owner_id
       WHERE g.join_code = ? COLLATE NOCASE`
    )
    .bind(code)
    .first();
  if (!group) return errorResponse(404, 'not_found', 'לא נמצאה קבוצה עם קוד ההצטרפות הזה.');

  const membership = await db
    .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(group.id, user.id)
    .first();

  return jsonResponse({
    preview: {
      id: group.id,
      name: group.name,
      description: group.description,
      join_code: group.join_code,
      owner_display_name: group.owner_display_name,
      member_count: Number(group.member_count),
      already_member: Boolean(membership),
    },
  });
}

async function handleJoinGroup(request, db, user) {
  const rl = checkRateLimit(`group_join:${user.id}:${getClientIp(request)}`, 20, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(429, 'rate_limited', 'יותר מדי ניסיונות הצטרפות.', {
      'Retry-After': String(rl.retryAfterSec),
    });
  }
  const { body } = await readJson(request);
  const code = typeof body.join_code === 'string' ? body.join_code.trim().toUpperCase() : '';
  if (!code) return errorResponse(400, 'invalid_code', 'נא להזין קוד הצטרפות.');

  const group = await db
    .prepare('SELECT id, name FROM groups WHERE join_code = ? COLLATE NOCASE')
    .bind(code)
    .first();
  if (!group) return errorResponse(404, 'not_found', 'קוד ההצטרפות לא נמצא.');

  await db
    .prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)")
    .bind(group.id, user.id, new Date().toISOString())
    .run();
  return jsonResponse({ ok: true, group_id: group.id, name: group.name });
}

async function handleLeaveGroup(db, user, groupId) {
  const membership = await db
    .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(groupId, user.id)
    .first();
  if (!membership) return errorResponse(404, 'not_found', 'אינך חבר בקבוצה זו.');

  if (membership.role === 'owner') {
    const next = await db
      .prepare(
        'SELECT user_id FROM group_members WHERE group_id = ? AND user_id <> ? ORDER BY joined_at ASC LIMIT 1'
      )
      .bind(groupId, user.id)
      .first();
    if (!next) {
      await db.prepare('DELETE FROM groups WHERE id = ?').bind(groupId).run();
      return jsonResponse({ ok: true, group_deleted: true });
    }
    await db.batch([
      db.prepare('UPDATE groups SET owner_id = ? WHERE id = ?').bind(next.user_id, groupId),
      db
        .prepare("UPDATE group_members SET role = 'owner' WHERE group_id = ? AND user_id = ?")
        .bind(groupId, next.user_id),
      db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').bind(groupId, user.id),
    ]);
    return jsonResponse({ ok: true, ownership_transferred: true });
  }
  await db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').bind(groupId, user.id).run();
  return jsonResponse({ ok: true });
}

async function handleGetGroupDetail(db, user, groupId, url) {
  const membership = await db
    .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(groupId, user.id)
    .first();
  if (!membership) {
    return errorResponse(403, 'not_a_member', 'יש להצטרף לקבוצה כדי לצפות בטבלת הדירוג ובחברים.');
  }
  const category = url.searchParams.get('category') || '5k';
  if (!CATEGORY_BY_KEY[category]) return errorResponse(400, 'invalid_category', 'קטגוריית דירוג לא חוקית.');

  const [group, membersRes, runsRes, relSets] = await Promise.all([
    db.prepare('SELECT * FROM groups WHERE id = ?').bind(groupId).first(),
    db
      .prepare(
        `SELECT u.id, u.username, u.display_name, gm.role, gm.joined_at
         FROM group_members gm JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = ?
         ORDER BY CASE WHEN gm.role = 'owner' THEN 0 ELSE 1 END, u.display_name COLLATE NOCASE ASC`
      )
      .bind(groupId)
      .all(),
    db
      .prepare(
        `SELECT r.id, r.user_id, r.distance_km, r.duration_sec, r.ran_at, r.source_type, r.source_verified,
                u.username, u.display_name, u.run_privacy
         FROM group_members gm
         JOIN runs r ON r.user_id = gm.user_id
         JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = ? AND r.is_shared = 1`
      )
      .bind(groupId)
      .all(),
    getRelationSets(db, user.id),
  ]);

  if (!group) return errorResponse(404, 'not_found', 'הקבוצה לא נמצאה.');
  const members = (membersRes.results || []).filter((m) => !relSets.blocked.has(m.id));
  const visibleRuns = (runsRes.results || []).filter((row) =>
    canViewUserRunsFast(user.id, { id: row.user_id, run_privacy: row.run_privacy }, relSets)
  );

  const entries = buildLeaderboardEntries(visibleRuns, category);
  const myEntry = entries.find((e) => e.user_id === user.id) || null;

  return jsonResponse({
    group: {
      id: group.id,
      name: group.name,
      description: group.description,
      join_code: group.join_code,
      owner_id: group.owner_id,
      my_role: membership.role,
      member_count: members.length,
      created_at: group.created_at,
    },
    members,
    category,
    categories: RANKING_CATEGORIES.map((c) => ({
      key: c.key,
      label: c.label,
      short_label: c.shortLabel,
      range_text: c.rangeText,
      type: c.type,
    })),
    rule: RANKING_RULE_EXPLANATION,
    my_entry: myEntry,
    entries,
  });
}

async function handleCreateReport(request, db, user) {
  const rl = checkRateLimit(`report:${user.id}:${getClientIp(request)}`, 15, 60 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(429, 'rate_limited', 'נשלחו יותר מדי דיווחים לאחרונה.', {
      'Retry-After': String(rl.retryAfterSec),
    });
  }
  const { body } = await readJson(request);
  const targetType = body.target_type;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const details = typeof body.details === 'string' ? body.details.trim().slice(0, 500) : '';

  if (!['user', 'run'].includes(targetType)) return errorResponse(400, 'invalid_target_type', 'סוג דיווח לא חוקי.');
  if (!VALID_REPORT_REASONS.has(reason)) return errorResponse(400, 'invalid_reason', 'נא לבחור סיבת דיווח תקינה.');

  let targetUserId = null;
  let targetRunId = null;

  if (targetType === 'user') {
    const uid = typeof body.target_user_id === 'string' ? body.target_user_id.trim() : '';
    if (!uid || uid === user.id) return errorResponse(400, 'invalid_target', 'אי אפשר לדווח על עצמך.');
    const target = await db.prepare('SELECT id FROM users WHERE id = ?').bind(uid).first();
    if (!target || (await isBlockedBetween(db, user.id, uid))) {
      return errorResponse(404, 'not_found', 'המשתמש לא נמצא.');
    }
    targetUserId = target.id;
  } else {
    const rid = typeof body.target_run_id === 'string' ? body.target_run_id.trim() : '';
    if (!rid) return errorResponse(400, 'invalid_target', 'חסר מזהה ריצה לדיווח.');
    const run = await db.prepare('SELECT * FROM runs WHERE id = ?').bind(rid).first();
    if (!run) return errorResponse(404, 'not_found', 'הריצה לא נמצאה.');
    if (run.user_id === user.id) return errorResponse(400, 'invalid_target', 'אי אפשר לדווח על ריצה שלך.');
    const owner = await db.prepare('SELECT id, run_privacy FROM users WHERE id = ?').bind(run.user_id).first();
    if (!owner || !run.is_shared || !(await canViewRun(db, user.id, run, owner))) {
      return errorResponse(404, 'not_found', 'אי אפשר לדווח על ריצה זו.');
    }
    targetRunId = run.id;
    targetUserId = run.user_id;
  }

  const reportId = generateId();
  await db
    .prepare(
      `INSERT INTO reports (id, reporter_id, target_type, target_user_id, target_run_id, reason, details, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`
    )
    .bind(reportId, user.id, targetType, targetUserId, targetRunId, reason, details, new Date().toISOString())
    .run();

  return jsonResponse(
    { ok: true, report_id: reportId, message: 'הדיווח התקבל וייבדק. תודה שעזרת לשמור על הקהילה.' },
    201
  );
}

// ---------------- Embedded Single-File Frontend & PWA Assets ----------------

const ICON_SVG = __ISRUNNER_ICON_SVG__;
const MANIFEST_JSON = __ISRUNNER_MANIFEST_JSON__;
const INDEX_HTML = __ISRUNNER_INDEX_HTML__;
