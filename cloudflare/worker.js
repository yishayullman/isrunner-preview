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

const ICON_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 192 192\" width=\"192\" height=\"192\">\n  <rect width=\"192\" height=\"192\" rx=\"44\" fill=\"#0d1016\" />\n  <circle cx=\"150\" cy=\"160\" r=\"90\" fill=\"#ff4d1c\" opacity=\"0.16\" />\n  <g fill=\"none\" stroke-linecap=\"round\" stroke-width=\"20\">\n    <path d=\"M44 134 L84 62\" stroke=\"#ffffff\" />\n    <path d=\"M86 134 L126 62\" stroke=\"#ff4d1c\" />\n    <path d=\"M128 134 L148 98\" stroke=\"#ffffff\" opacity=\"0.45\" />\n  </g>\n</svg>\n";
const MANIFEST_JSON = "{\n  \"name\": \"Isrunner — קהילת רצים בעברית\",\n  \"short_name\": \"Isrunner\",\n  \"description\": \"קהילת רצים בעברית — שיאים אישיים, חברים, קבוצות ודירוגים שקופים.\",\n  \"lang\": \"he\",\n  \"dir\": \"rtl\",\n  \"start_url\": \"/#/home\",\n  \"display\": \"standalone\",\n  \"background_color\": \"#f6f3ee\",\n  \"theme_color\": \"#f6f3ee\",\n  \"icons\": [\n    {\n      \"src\": \"/icon.svg\",\n      \"sizes\": \"any\",\n      \"type\": \"image/svg+xml\",\n      \"purpose\": \"any maskable\"\n    }\n  ]\n}\n";
const INDEX_HTML = "<!DOCTYPE html>\n<html lang=\"he\" dir=\"rtl\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, viewport-fit=cover\" />\n  <meta name=\"description\" content=\"Isrunner — קהילת רצים בעברית: שיאים אישיים, דירוגים שקופים, חברים וקבוצות.\" />\n  <meta name=\"theme-color\" content=\"#f6f3ee\" />\n  <title>Isrunner — קהילת רצים בעברית</title>\n  <link rel=\"icon\" type=\"image/svg+xml\" href=\"/icon.svg\" />\n  <link rel=\"manifest\" href=\"/manifest.webmanifest\" />\n  <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\" />\n  <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin />\n  <link href=\"https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700&family=Rubik:wght@500;600;700&display=swap\" rel=\"stylesheet\" />\n  <style>\n/* ==========================================================================\n   Isrunner — Flagship Athletic-Editorial Design System\n   Warm alabaster canvas · Deep obsidian carbon · Signal vermilion · GPS emerald\n   ========================================================================== */\n:root {\n  /* Canvas & elevated surfaces */\n  --canvas: #f4f1ec;\n  --canvas-deep: #ebe6de;\n  --surface: #ffffff;\n  --surface-2: #f8f6f2;\n  --surface-3: #efebe4;\n\n  /* Obsidian & ink typography */\n  --obsidian: #0d1016;\n  --obsidian-2: #161b24;\n  --ink: #11141b;\n  --ink-2: #242934;\n  --ink-soft: #4e5563;\n  --ink-mute: #767d8a;\n  --line: rgba(17, 20, 27, 0.075);\n  --line-strong: rgba(17, 20, 27, 0.14);\n\n  /* Signature athletic accents */\n  --coral: #ff4d1c;\n  --coral-deep: #df3a0e;\n  --coral-grad: linear-gradient(135deg, #ff5d2e 0%, #e63c10 100%);\n  --coral-soft: #fff0eb;\n  --coral-line: #f8c6b6;\n\n  --teal: #0b7a62;\n  --teal-bright: #22c997;\n  --teal-soft: #e6f6f1;\n  --teal-line: #b2e2d4;\n\n  --gold: #d99b1e;\n  --gold-soft: #fef7e4;\n  --silver: #6e7785;\n  --bronze: #b86c3b;\n\n  --amber-bg: #fdf7e9;\n  --amber-border: #eed297;\n  --amber-text: #744d0a;\n\n  --red-badge: #ff4d1c;\n  --red-bg: #fdeeec;\n  --red-border: #f3c0b8;\n  --red-text: #a52a16;\n\n  /* Compatibility aliases */\n  --green-dark: var(--ink);\n  --green-primary: var(--coral);\n  --green-accent: var(--coral);\n  --green-border: var(--line-strong);\n  --green-soft-bg: var(--surface-3);\n  --text-main: var(--ink);\n  --text-secondary: var(--ink-soft);\n  --text-muted: var(--ink-mute);\n  --surface-card: var(--surface);\n  --surface-soft: var(--surface-2);\n  --surface-muted: var(--surface-3);\n\n  --radius-card: 24px;\n  --radius-md: 15px;\n  --radius-sm: 10px;\n  --radius-pill: 999px;\n\n  --shadow-card: 0 1px 2px rgba(13, 16, 22, 0.04), 0 10px 28px -14px rgba(13, 16, 22, 0.12);\n  --shadow-lift: 0 4px 12px rgba(13, 16, 22, 0.08), 0 24px 48px -18px rgba(13, 16, 22, 0.42);\n  --font-display: 'Rubik', 'Heebo', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;\n  --font-sans: 'Heebo', 'Rubik', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;\n  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);\n}\n\n*,\n*::before,\n*::after {\n  box-sizing: border-box;\n}\n\nhtml {\n  font-size: 16px;\n  -webkit-text-size-adjust: 100%;\n}\n\nbody {\n  margin: 0;\n  font-family: var(--font-sans);\n  background:\n    radial-gradient(960px 380px at 95% -8%, rgba(255, 77, 28, 0.085), transparent 62%),\n    radial-gradient(760px 340px at -8% 2%, rgba(11, 122, 98, 0.065), transparent 60%),\n    var(--canvas);\n  background-attachment: fixed;\n  color: var(--ink);\n  line-height: 1.55;\n  min-height: 100vh;\n  overflow-x: hidden;\n  -webkit-font-smoothing: antialiased;\n}\n\na {\n  color: var(--teal);\n  text-decoration: none;\n  font-weight: 600;\n}\n\na:hover {\n  text-decoration: underline;\n  text-underline-offset: 3px;\n}\n\nbutton,\ninput,\nselect,\ntextarea {\n  font-family: inherit;\n  font-size: 1rem;\n  color: inherit;\n}\n\n.hidden {\n  display: none !important;\n}\n\n.tabular {\n  font-variant-numeric: tabular-nums;\n}\n\n/* App Shell */\n.app-shell {\n  min-height: 100vh;\n  display: flex;\n  flex-direction: column;\n}\n\n/* ---------- Header: sleek frosted athletic bar ---------- */\n.top-header {\n  position: sticky;\n  top: 0;\n  z-index: 40;\n  background: rgba(244, 241, 236, 0.82);\n  -webkit-backdrop-filter: saturate(180%) blur(16px);\n  backdrop-filter: saturate(180%) blur(16px);\n  border-bottom: 1px solid var(--line);\n  color: var(--ink);\n}\n\n.track-motif {\n  display: none;\n}\n\n.header-inner {\n  position: relative;\n  max-width: 880px;\n  margin: 0 auto;\n  padding: 10px 16px;\n  padding-top: calc(10px + env(safe-area-inset-top, 0px));\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 10px;\n  min-height: 60px;\n}\n\n.header-brand {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  min-width: 0;\n}\n\n.brand-link {\n  display: inline-flex;\n  align-items: center;\n  gap: 9px;\n  color: var(--ink);\n  text-decoration: none;\n  font-family: var(--font-display);\n  font-weight: 700;\n  font-size: 1.24rem;\n  letter-spacing: -0.03em;\n}\n\n.brand-link:hover {\n  text-decoration: none;\n}\n\n.brand-mark {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 35px;\n  height: 35px;\n  border-radius: 12px;\n  background: linear-gradient(145deg, #1b202b, #0d1016);\n  color: #fff;\n  flex-shrink: 0;\n  box-shadow: 0 8px 18px -6px rgba(13, 16, 22, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.14);\n}\n\n.brand-name {\n  direction: ltr;\n  unicode-bidi: isolate;\n}\n\n.header-back-btn {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  background: var(--surface);\n  color: var(--ink);\n  border: 1px solid var(--line-strong);\n  border-radius: var(--radius-pill);\n  padding: 6px 12px;\n  font-size: 0.83rem;\n  font-weight: 600;\n  cursor: pointer;\n  white-space: nowrap;\n  transition: background 0.15s ease;\n}\n\n.header-back-btn:hover {\n  background: var(--surface-3);\n}\n\n.header-right {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-size: 0.83rem;\n  color: var(--ink-soft);\n  min-width: 0;\n}\n\n.header-run-pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  background: var(--coral-grad);\n  color: #fff;\n  border: none;\n  border-radius: var(--radius-pill);\n  padding: 6px 12px;\n  font-size: 0.78rem;\n  font-weight: 700;\n  cursor: pointer;\n  white-space: nowrap;\n  box-shadow: 0 6px 16px -6px rgba(255, 77, 28, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.25);\n  transition: transform 0.12s ease, opacity 0.15s ease;\n}\n\n.header-run-pill:active {\n  transform: scale(0.96);\n}\n\n.header-user-pill {\n  background: var(--surface);\n  border: 1px solid var(--line-strong);\n  color: var(--ink);\n  padding: 5px 12px;\n  border-radius: var(--radius-pill);\n  font-weight: 600;\n  max-width: 140px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.header-user-pill::before {\n  content: '';\n  display: inline-block;\n  width: 7px;\n  height: 7px;\n  border-radius: 50%;\n  background: var(--teal-bright);\n  margin-left: 7px;\n  vertical-align: middle;\n}\n\n/* ---------- Desktop navigation ---------- */\n.desktop-nav {\n  display: none;\n  position: sticky;\n  top: 61px;\n  z-index: 39;\n  background: transparent;\n}\n\n.desktop-nav-inner {\n  width: fit-content;\n  margin: 14px auto 0;\n  background: rgba(255, 255, 255, 0.9);\n  -webkit-backdrop-filter: blur(12px);\n  backdrop-filter: blur(12px);\n  border: 1px solid var(--line);\n  border-radius: var(--radius-pill);\n  padding: 5px;\n  display: flex;\n  gap: 4px;\n  box-shadow: var(--shadow-card);\n}\n\n.desktop-nav-btn {\n  position: relative;\n  display: inline-flex;\n  align-items: center;\n  gap: 7px;\n  padding: 8px 18px;\n  border: none;\n  background: transparent;\n  border-radius: var(--radius-pill);\n  color: var(--ink-soft);\n  font-weight: 600;\n  font-size: 0.93rem;\n  cursor: pointer;\n  transition: background 0.2s var(--ease), color 0.2s var(--ease);\n}\n\n.desktop-nav-btn:hover {\n  color: var(--ink);\n  background: var(--surface-3);\n}\n\n.desktop-nav-btn.active {\n  background: var(--obsidian);\n  color: #fff;\n  box-shadow: 0 4px 12px -4px rgba(13, 16, 22, 0.45);\n}\n\n/* ---------- Main ---------- */\n.main-content {\n  flex: 1;\n  width: 100%;\n  max-width: 880px;\n  margin: 0 auto;\n  padding: 18px 14px 116px;\n  animation: page-in 0.32s var(--ease);\n}\n\n@keyframes page-in {\n  from { opacity: 0; transform: translateY(6px); }\n  to { opacity: 1; transform: none; }\n}\n\n.loading-box {\n  text-align: center;\n  color: var(--ink-mute);\n  padding: 56px 16px;\n  font-weight: 500;\n}\n\n/* ---------- Bottom tab bar: floating obsidian capsule ---------- */\n.bottom-nav {\n  position: fixed;\n  bottom: calc(10px + env(safe-area-inset-bottom, 0px));\n  left: 10px;\n  right: 10px;\n  z-index: 45;\n  max-width: 480px;\n  margin: 0 auto;\n  background: rgba(13, 16, 22, 0.94);\n  -webkit-backdrop-filter: saturate(160%) blur(18px);\n  backdrop-filter: saturate(160%) blur(18px);\n  border-radius: 26px;\n  box-shadow: 0 20px 44px -12px rgba(13, 16, 22, 0.62), inset 0 1px 0 rgba(255, 255, 255, 0.08);\n  display: grid;\n  grid-template-columns: repeat(5, 1fr);\n  padding: 6px;\n  gap: 2px;\n}\n\n.bottom-nav-btn {\n  position: relative;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  gap: 3px;\n  min-height: 54px;\n  border: none;\n  background: transparent;\n  color: rgba(255, 255, 255, 0.56);\n  font-size: 0.71rem;\n  font-weight: 600;\n  cursor: pointer;\n  padding: 4px 2px;\n  border-radius: 20px;\n  transition: color 0.2s var(--ease), background 0.2s var(--ease);\n}\n\n.bottom-nav-btn svg {\n  width: 21px;\n  height: 21px;\n  stroke-width: 2;\n}\n\n.bottom-nav-btn:hover {\n  color: #fff;\n}\n\n.bottom-nav-btn.active {\n  color: #fff;\n  background: rgba(255, 255, 255, 0.11);\n}\n\n.bottom-nav-btn.active svg {\n  color: var(--coral);\n}\n\n.bottom-nav-btn.active::after {\n  content: '';\n  position: absolute;\n  bottom: 4px;\n  width: 14px;\n  height: 2.5px;\n  border-radius: 999px;\n  background: var(--coral);\n}\n\n.nav-badge {\n  position: absolute;\n  top: 5px;\n  left: 50%;\n  transform: translateX(-18px);\n  min-width: 18px;\n  height: 18px;\n  padding: 0 5px;\n  border-radius: var(--radius-pill);\n  background: var(--coral);\n  color: #fff;\n  font-size: 0.68rem;\n  font-weight: 800;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  line-height: 1;\n  box-shadow: 0 0 0 2px var(--obsidian);\n}\n\n.desktop-nav-btn .nav-badge {\n  position: static;\n  transform: none;\n  box-shadow: none;\n}\n\n/* ---------- Cards ---------- */\n.card {\n  background: var(--surface);\n  border-radius: var(--radius-card);\n  border: 1px solid var(--line);\n  box-shadow: var(--shadow-card);\n  padding: 20px 18px;\n  margin-bottom: 14px;\n}\n\n.card-amber {\n  background: linear-gradient(180deg, #fffaf0, #fff);\n  border-color: var(--amber-border);\n}\n\n.card-soft {\n  background: var(--surface-2);\n  border: 1px solid var(--line);\n  box-shadow: none;\n}\n\n.card-header {\n  display: flex;\n  align-items: flex-start;\n  justify-content: space-between;\n  gap: 10px;\n  margin-bottom: 14px;\n  flex-wrap: wrap;\n}\n\n.card-title {\n  margin: 0;\n  font-family: var(--font-display);\n  font-size: 1.08rem;\n  font-weight: 700;\n  letter-spacing: -0.015em;\n  color: var(--ink);\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  flex-wrap: wrap;\n}\n\n.card-subtitle {\n  margin: 3px 0 0;\n  font-size: 0.84rem;\n  color: var(--ink-mute);\n}\n\n.page-eyebrow {\n  font-size: 0.78rem;\n  font-weight: 700;\n  letter-spacing: 0.02em;\n  color: var(--coral-deep);\n  margin: 0 2px 2px;\n}\n\n.page-title {\n  margin: 2px 2px 16px;\n  font-family: var(--font-display);\n  font-size: 1.82rem;\n  font-weight: 700;\n  letter-spacing: -0.035em;\n  line-height: 1.12;\n  color: var(--ink);\n}\n\n.section-heading {\n  margin: 22px 2px 10px;\n  font-family: var(--font-display);\n  font-size: 0.8rem;\n  font-weight: 700;\n  letter-spacing: 0.05em;\n  color: var(--ink-mute);\n}\n\n/* ---------- Hero card: Flagship Obsidian Athletic Cockpit ---------- */\n.hero-card {\n  position: relative;\n  overflow: hidden;\n  background:\n    radial-gradient(420px 260px at 0% 100%, rgba(255, 77, 28, 0.24), transparent 68%),\n    radial-gradient(360px 220px at 100% 0%, rgba(34, 201, 151, 0.14), transparent 64%),\n    linear-gradient(155deg, #161b25 0%, #0d1016 58%, #121620 100%);\n  color: #fff;\n  border: 1px solid rgba(255, 255, 255, 0.08);\n  box-shadow: var(--shadow-lift);\n}\n\n.hero-card::before {\n  content: '';\n  position: absolute;\n  top: -70px;\n  left: -80px;\n  width: 280px;\n  height: 150px;\n  border: 1.5px solid rgba(255, 255, 255, 0.055);\n  border-radius: 999px;\n  box-shadow: 0 0 0 18px rgba(255, 255, 255, 0.02), 0 0 0 36px rgba(255, 255, 255, 0.015);\n  pointer-events: none;\n}\n\n.hero-card > * {\n  position: relative;\n  z-index: 1;\n}\n\n.hero-card .card-title {\n  color: #fff;\n}\n\n.hero-card .card-subtitle,\n.hero-card .stat-label,\n.hero-card .stat-sub,\n.hero-card .weekly-goal-legend,\n.hero-card .weekly-bar-label,\n.hero-card .weekly-chart-title {\n  color: rgba(255, 255, 255, 0.62);\n}\n\n.hero-card .btn-outline {\n  background: rgba(255, 255, 255, 0.08);\n  border-color: rgba(255, 255, 255, 0.18);\n  color: #fff;\n}\n\n.hero-card .btn-outline:hover:not(:disabled) {\n  background: rgba(255, 255, 255, 0.15);\n}\n\n.hero-card .stat-tile {\n  background: rgba(255, 255, 255, 0.055);\n  border-color: rgba(255, 255, 255, 0.09);\n}\n\n.hero-card .stat-value,\n.hero-card .goal-figure {\n  color: #fff;\n}\n\n.hero-card .progress-bar-wrap {\n  background: rgba(255, 255, 255, 0.12);\n}\n\n.hero-card .weekly-chart-wrap {\n  border-top-color: rgba(255, 255, 255, 0.1);\n}\n\n.hero-card .weekly-bar-track {\n  background: rgba(255, 255, 255, 0.06);\n}\n\n.hero-card .weekly-bar-fill {\n  background: rgba(255, 255, 255, 0.28);\n}\n\n.hero-card .weekly-bar-col.is-current .weekly-bar-fill {\n  background: var(--coral-grad);\n}\n\n.hero-card .weekly-bar-fill.hit-goal {\n  background: linear-gradient(180deg, #34d399, #0b9b6c);\n}\n\n.hero-card .weekly-bar-fill.empty {\n  background: rgba(255, 255, 255, 0.06);\n}\n\n.hero-card .weekly-bar-val {\n  color: rgba(255, 255, 255, 0.85);\n}\n\n.hero-card .weekly-bar-col.is-current .weekly-bar-label {\n  color: #fff;\n}\n\n.hero-card .weekly-goal-line {\n  border-top-color: rgba(255, 255, 255, 0.34);\n}\n\n.hero-action-bar {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n  margin-top: 14px;\n  padding-top: 14px;\n  border-top: 1px solid rgba(255, 255, 255, 0.09);\n}\n\n.goal-figure {\n  font-family: var(--font-display);\n  font-weight: 700;\n  color: var(--ink);\n}\n\n/* ---------- Buttons ---------- */\n.btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 7px;\n  min-height: 42px;\n  padding: 9px 17px;\n  border-radius: var(--radius-pill);\n  border: 1px solid transparent;\n  font-weight: 700;\n  font-size: 0.91rem;\n  cursor: pointer;\n  transition: background 0.18s var(--ease), border-color 0.18s var(--ease), transform 0.1s ease, box-shadow 0.18s var(--ease);\n  text-decoration: none;\n  text-align: center;\n  line-height: 1.3;\n  max-width: 100%;\n}\n\n.btn:hover {\n  text-decoration: none;\n}\n\n.btn:active {\n  transform: scale(0.97);\n}\n\n.btn:disabled {\n  opacity: 0.48;\n  cursor: not-allowed;\n}\n\n.btn-primary {\n  background: var(--coral-grad);\n  color: #fff;\n  box-shadow: 0 10px 22px -10px rgba(255, 77, 28, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.25);\n}\n\n.btn-primary:hover:not(:disabled) {\n  filter: brightness(1.05);\n}\n\n.btn-secondary {\n  background: var(--obsidian);\n  color: #fff;\n  box-shadow: 0 6px 16px -8px rgba(13, 16, 22, 0.55);\n}\n\n.btn-secondary:hover:not(:disabled) {\n  background: var(--obsidian-2);\n}\n\n.btn-outline {\n  background: var(--surface);\n  color: var(--ink);\n  border-color: var(--line-strong);\n}\n\n.btn-outline:hover:not(:disabled) {\n  background: var(--surface-3);\n}\n\n.btn-danger {\n  background: var(--red-bg);\n  color: var(--red-text);\n  border-color: var(--red-border);\n}\n\n.btn-danger:hover:not(:disabled) {\n  background: #fbdcd6;\n}\n\n.btn-sm {\n  min-height: 35px;\n  padding: 6px 13px;\n  font-size: 0.82rem;\n}\n\n.btn-block {\n  width: 100%;\n}\n\n.btn-row {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n}\n\n/* ---------- Forms ---------- */\n.form-group {\n  margin-bottom: 14px;\n}\n\n.form-label {\n  display: block;\n  font-size: 0.85rem;\n  font-weight: 700;\n  color: var(--ink-2);\n  margin-bottom: 6px;\n}\n\n.input,\n.select,\n.textarea {\n  width: 100%;\n  min-height: 46px;\n  padding: 10px 14px;\n  border: 1px solid var(--line-strong);\n  border-radius: var(--radius-md);\n  background: var(--surface-2);\n  color: var(--ink);\n  font-size: 1rem;\n  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;\n  min-width: 0;\n}\n\n.input::placeholder,\n.textarea::placeholder {\n  color: #9ea4b0;\n}\n\n.input:focus,\n.select:focus,\n.textarea:focus {\n  outline: none;\n  background: #fff;\n  border-color: var(--obsidian);\n  box-shadow: 0 0 0 4px rgba(13, 16, 22, 0.08);\n}\n\n.textarea {\n  min-height: 86px;\n  resize: vertical;\n}\n\n.help-text {\n  font-size: 0.8rem;\n  color: var(--ink-mute);\n  margin-top: 5px;\n}\n\n/* ---------- Badges ---------- */\n.badge {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  padding: 3px 10px;\n  border-radius: var(--radius-pill);\n  font-size: 0.73rem;\n  font-weight: 700;\n  line-height: 1.35;\n  white-space: nowrap;\n  border: 1px solid transparent;\n}\n\n.badge-legacy {\n  background: var(--amber-bg);\n  color: var(--amber-text);\n  border-color: var(--amber-border);\n}\n\n.badge-verified {\n  background: var(--teal-soft);\n  color: var(--teal);\n  border-color: var(--teal-line);\n}\n\n.badge-private {\n  background: var(--surface-3);\n  color: var(--ink-soft);\n  border-color: var(--line-strong);\n}\n\n.badge-anomaly {\n  background: var(--coral-soft);\n  color: var(--red-text);\n  border-color: var(--coral-line);\n}\n\n.badge-neutral {\n  background: var(--surface-3);\n  color: var(--ink-soft);\n  border-color: var(--line);\n}\n\n/* ---------- Stats ---------- */\n.stats-grid {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 10px;\n  margin-bottom: 4px;\n}\n\n.stat-tile {\n  background: var(--surface-2);\n  border: 1px solid var(--line);\n  border-radius: 16px;\n  padding: 12px 14px;\n  min-width: 0;\n}\n\n.stat-label {\n  font-size: 0.75rem;\n  color: var(--ink-mute);\n  font-weight: 600;\n}\n\n.stat-value {\n  font-family: var(--font-display);\n  font-size: 1.48rem;\n  font-weight: 700;\n  letter-spacing: -0.025em;\n  color: var(--ink);\n  margin-top: 2px;\n  line-height: 1.15;\n  font-variant-numeric: tabular-nums;\n}\n\n.stat-sub {\n  font-size: 0.74rem;\n  color: var(--ink-mute);\n  margin-top: 3px;\n}\n\n.progress-bar-wrap {\n  width: 100%;\n  height: 8px;\n  border-radius: var(--radius-pill);\n  background: var(--surface-3);\n  overflow: hidden;\n  margin-top: 8px;\n}\n\n.progress-bar-fill {\n  height: 100%;\n  border-radius: var(--radius-pill);\n  background: linear-gradient(270deg, #ff875c, var(--coral));\n  transition: width 0.5s var(--ease);\n}\n\n/* ---------- Personal Records Trophy Wall ---------- */\n.pr-grid {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 10px;\n}\n\n.pr-card {\n  position: relative;\n  background: linear-gradient(180deg, #ffffff 0%, #f8f6f2 100%);\n  border: 1px solid var(--line);\n  border-radius: 18px;\n  padding: 13px 14px;\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  min-width: 0;\n  overflow: hidden;\n  transition: transform 0.18s var(--ease), border-color 0.18s var(--ease), box-shadow 0.18s var(--ease);\n}\n\n.pr-card.pr-unlocked {\n  border-color: rgba(255, 77, 28, 0.24);\n  background: linear-gradient(180deg, #ffffff 0%, #fff7f4 100%);\n  cursor: pointer;\n}\n\n.pr-card.pr-unlocked:hover {\n  transform: translateY(-2px);\n  box-shadow: 0 10px 22px -12px rgba(255, 77, 28, 0.35);\n}\n\n.pr-card.pr-wide {\n  grid-column: span 2;\n}\n\n.pr-top-row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 6px;\n}\n\n.pr-code-chip {\n  direction: ltr;\n  unicode-bidi: isolate;\n  display: inline-flex;\n  align-items: center;\n  padding: 2px 7px;\n  border-radius: 7px;\n  font-family: var(--font-display);\n  font-size: 0.68rem;\n  font-weight: 700;\n  letter-spacing: 0.03em;\n  background: var(--surface-3);\n  color: var(--ink-soft);\n}\n\n.pr-card.pr-unlocked .pr-code-chip {\n  background: var(--obsidian);\n  color: #fff;\n}\n\n.pr-label {\n  font-size: 0.77rem;\n  font-weight: 700;\n  color: var(--ink-soft);\n}\n\n.pr-value {\n  font-family: var(--font-display);\n  font-size: 1.42rem;\n  font-weight: 700;\n  letter-spacing: -0.025em;\n  color: var(--ink);\n  font-variant-numeric: tabular-nums;\n}\n\n.pr-card:not(.pr-unlocked) .pr-value {\n  color: #c2bdb5;\n}\n\n.pr-meta {\n  font-size: 0.73rem;\n  color: var(--ink-mute);\n  display: flex;\n  flex-wrap: wrap;\n  gap: 5px;\n  align-items: center;\n}\n\n/* ---------- Trust & Integrity Strip (Closed manual run notice) ---------- */\n.closed-add-card {\n  position: relative;\n  background: var(--surface);\n  border: 1px solid var(--line);\n  border-radius: 20px;\n  padding: 14px 16px;\n  padding-right: 54px;\n  margin-bottom: 14px;\n  box-shadow: var(--shadow-card);\n}\n\n.closed-add-card::before {\n  content: '';\n  position: absolute;\n  top: 15px;\n  right: 15px;\n  width: 30px;\n  height: 30px;\n  border-radius: 10px;\n  background:\n    url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%230b7a62' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'/%3E%3Cpath d='m9 12 2 2 4-4'/%3E%3C/svg%3E\") center / 17px no-repeat,\n    var(--teal-soft);\n}\n\n.closed-add-title {\n  margin: 0 0 3px;\n  font-family: var(--font-display);\n  font-size: 0.94rem;\n  font-weight: 700;\n  color: var(--ink);\n}\n\n.closed-add-text {\n  margin: 0 0 10px;\n  font-size: 0.84rem;\n  color: var(--ink-soft);\n}\n\n/* ---------- Quick Utility Strip (Pace Calculator & Tools) ---------- */\n.quick-tools-grid {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 10px;\n  margin-bottom: 14px;\n}\n\n.quick-tool-tile {\n  display: flex;\n  align-items: center;\n  gap: 11px;\n  padding: 13px 14px;\n  border-radius: 20px;\n  background: var(--surface);\n  border: 1px solid var(--line);\n  box-shadow: var(--shadow-card);\n  cursor: pointer;\n  text-align: right;\n  transition: transform 0.16s var(--ease), border-color 0.16s var(--ease);\n}\n\n.quick-tool-tile:hover {\n  transform: translateY(-2px);\n  border-color: var(--line-strong);\n}\n\n.quick-tool-ic {\n  width: 38px;\n  height: 38px;\n  border-radius: 12px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  flex-shrink: 0;\n}\n\n.quick-tool-tile b {\n  display: block;\n  font-family: var(--font-display);\n  font-size: 0.9rem;\n  font-weight: 700;\n  color: var(--ink);\n}\n\n.quick-tool-tile span {\n  display: block;\n  font-size: 0.74rem;\n  color: var(--ink-mute);\n}\n\n/* ---------- Lists & runs ---------- */\n.list-stack {\n  display: flex;\n  flex-direction: column;\n  gap: 9px;\n}\n\n.run-item {\n  border: 1px solid var(--line);\n  border-radius: 18px;\n  background: var(--surface-2);\n  padding: 13px 15px;\n  cursor: pointer;\n  transition: border-color 0.18s var(--ease), background 0.18s var(--ease), transform 0.18s var(--ease), box-shadow 0.18s var(--ease);\n}\n\n.run-item:hover {\n  border-color: var(--line-strong);\n  background: #fff;\n  transform: translateY(-1px);\n  box-shadow: 0 8px 20px -14px rgba(13, 16, 22, 0.25);\n}\n\n.run-item-top {\n  display: flex;\n  align-items: baseline;\n  justify-content: space-between;\n  gap: 8px;\n  flex-wrap: wrap;\n}\n\n.run-metrics {\n  display: flex;\n  align-items: baseline;\n  gap: 10px;\n  flex-wrap: wrap;\n}\n\n.run-dist {\n  font-family: var(--font-display);\n  font-weight: 700;\n  font-size: 1.16rem;\n  letter-spacing: -0.02em;\n  color: var(--ink);\n}\n\n.run-time {\n  font-weight: 700;\n  font-size: 0.96rem;\n  color: var(--ink-2);\n}\n\n.run-pace {\n  font-size: 0.83rem;\n  color: var(--ink-soft);\n}\n\n.run-date {\n  font-size: 0.77rem;\n  color: var(--ink-mute);\n}\n\n.run-badges {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 5px;\n  margin-top: 8px;\n}\n\n.run-note {\n  margin: 6px 0 0;\n  font-size: 0.86rem;\n  color: var(--ink-soft);\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n\n/* ---------- Notifications ---------- */\n.notif-item {\n  display: flex;\n  align-items: flex-start;\n  justify-content: space-between;\n  gap: 10px;\n  padding: 12px 14px;\n  border-radius: 16px;\n  border: 1px solid var(--line);\n  background: var(--surface-2);\n  cursor: pointer;\n  transition: background 0.15s ease;\n}\n\n.notif-item.unread {\n  background: var(--coral-soft);\n  border-color: var(--coral-line);\n}\n\n.notif-dot {\n  width: 8px;\n  height: 8px;\n  border-radius: 50%;\n  background: var(--coral);\n  flex-shrink: 0;\n  margin-top: 8px;\n  box-shadow: 0 0 0 4px rgba(255, 77, 28, 0.18);\n}\n\n.notif-body {\n  flex: 1;\n  min-width: 0;\n  font-size: 0.9rem;\n}\n\n/* ---------- Pills / segmented filters ---------- */\n.tabs-scroll {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n  margin-bottom: 14px;\n}\n\n.tab-pill {\n  flex: 0 0 auto;\n  padding: 7px 14px;\n  border-radius: var(--radius-pill);\n  border: 1px solid var(--line-strong);\n  background: var(--surface);\n  color: var(--ink-soft);\n  font-weight: 700;\n  font-size: 0.83rem;\n  cursor: pointer;\n  white-space: nowrap;\n  transition: all 0.18s var(--ease);\n}\n\n.tab-pill:hover {\n  color: var(--ink);\n  border-color: var(--ink-mute);\n}\n\n.tab-pill.active {\n  background: var(--obsidian);\n  color: #fff;\n  border-color: var(--obsidian);\n  box-shadow: 0 6px 14px -6px rgba(13, 16, 22, 0.45);\n}\n\n/* ---------- Leaderboard & Podium ---------- */\n.podium-grid {\n  display: grid;\n  grid-template-columns: repeat(3, minmax(0, 1fr));\n  gap: 8px;\n  align-items: end;\n  margin-bottom: 14px;\n}\n\n.podium-card {\n  border-radius: 18px;\n  padding: 12px 10px;\n  text-align: center;\n  background: var(--surface-2);\n  border: 1px solid var(--line);\n  cursor: pointer;\n  min-width: 0;\n}\n\n.podium-card.podium-1 {\n  background: linear-gradient(160deg, #171c26 0%, #0d1016 100%);\n  color: #fff;\n  border-color: rgba(255, 77, 28, 0.4);\n  padding: 16px 10px;\n  box-shadow: 0 14px 30px -14px rgba(13, 16, 22, 0.55);\n}\n\n.podium-medal {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 28px;\n  height: 28px;\n  border-radius: 50%;\n  font-family: var(--font-display);\n  font-weight: 800;\n  font-size: 0.84rem;\n  margin-bottom: 6px;\n}\n\n.podium-1 .podium-medal {\n  background: var(--coral-grad);\n  color: #fff;\n}\n\n.podium-2 .podium-medal {\n  background: var(--obsidian);\n  color: #fff;\n}\n\n.podium-3 .podium-medal {\n  background: var(--teal);\n  color: #fff;\n}\n\n.podium-name {\n  font-weight: 700;\n  font-size: 0.84rem;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.podium-val {\n  font-family: var(--font-display);\n  font-weight: 700;\n  font-size: 1.06rem;\n  margin-top: 3px;\n}\n\n.podium-1 .podium-val {\n  color: #ff8a66;\n}\n\n.lb-row {\n  display: grid;\n  grid-template-columns: 36px minmax(0, 1fr) auto;\n  align-items: center;\n  gap: 12px;\n  padding: 11px 12px;\n  border-radius: 16px;\n  border: 1px solid var(--line);\n  background: var(--surface-2);\n}\n\n.lb-rank {\n  width: 34px;\n  height: 34px;\n  border-radius: 11px;\n  background: var(--surface-3);\n  color: var(--ink-soft);\n  font-family: var(--font-display);\n  font-weight: 700;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 0.94rem;\n  font-variant-numeric: tabular-nums;\n}\n\n.lb-rank.rank-1 {\n  background: var(--coral-grad);\n  color: #fff;\n}\n\n.lb-rank.rank-2 {\n  background: var(--obsidian);\n  color: #fff;\n}\n\n.lb-rank.rank-3 {\n  background: var(--teal);\n  color: #fff;\n}\n\n.lb-runner {\n  min-width: 0;\n}\n\n.lb-name {\n  font-weight: 700;\n  color: var(--ink);\n  display: inline-block;\n  max-width: 100%;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.lb-result {\n  text-align: left;\n}\n\n.lb-primary-val {\n  font-family: var(--font-display);\n  font-weight: 700;\n  font-size: 1.08rem;\n  color: var(--ink);\n  font-variant-numeric: tabular-nums;\n}\n\n.lb-sub-val {\n  font-size: 0.76rem;\n  color: var(--ink-mute);\n}\n\n/* ---------- Users ---------- */\n.user-row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 10px;\n  padding: 11px 12px;\n  border-radius: 16px;\n  border: 1px solid var(--line);\n  background: var(--surface-2);\n  flex-wrap: wrap;\n}\n\n.user-row-info {\n  display: flex;\n  align-items: center;\n  gap: 11px;\n  min-width: 0;\n  flex: 1;\n}\n\n.avatar {\n  width: 40px;\n  height: 40px;\n  border-radius: 50%;\n  background: var(--coral-grad);\n  color: #fff;\n  font-family: var(--font-display);\n  font-weight: 700;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  flex-shrink: 0;\n  box-shadow: 0 0 0 3px #fff, 0 0 0 4px var(--line);\n}\n\n.user-name-link {\n  font-weight: 700;\n  color: var(--ink);\n  cursor: pointer;\n  background: none;\n  border: none;\n  padding: 0;\n  text-align: right;\n}\n\n.user-name-link:hover {\n  text-decoration: underline;\n  text-underline-offset: 3px;\n}\n\n.user-handle {\n  font-size: 0.79rem;\n  color: var(--ink-mute);\n  direction: ltr;\n  unicode-bidi: isolate;\n  display: inline-block;\n}\n\ncode {\n  direction: ltr;\n  unicode-bidi: isolate;\n  display: inline;\n  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;\n  font-size: 0.84em;\n  background: var(--surface-3);\n  padding: 1px 6px;\n  border-radius: 6px;\n  overflow-wrap: anywhere;\n  word-break: break-word;\n  max-width: 100%;\n}\n\n.stat-tile-wide {\n  grid-column: span 2;\n}\n\n/* ---------- Info & alerts ---------- */\n.info-box {\n  background: var(--surface-2);\n  border: 1px solid var(--line);\n  border-radius: 16px;\n  padding: 12px 14px;\n  font-size: 0.87rem;\n  color: var(--ink-soft);\n}\n\n.alert-error {\n  background: var(--red-bg);\n  border: 1px solid var(--red-border);\n  color: var(--red-text);\n  border-radius: var(--radius-md);\n  padding: 10px 14px;\n  font-size: 0.9rem;\n  margin-bottom: 12px;\n}\n\n.alert-amber {\n  background: var(--amber-bg);\n  border: 1px solid var(--amber-border);\n  color: var(--amber-text);\n  border-radius: var(--radius-md);\n  padding: 10px 14px;\n  font-size: 0.87rem;\n}\n\n.empty-state {\n  text-align: center;\n  padding: 22px 14px;\n  color: var(--ink-mute);\n  font-size: 0.89rem;\n  background: var(--surface-2);\n  border: 1px dashed var(--line-strong);\n  border-radius: 16px;\n}\n\n/* ---------- Join code ---------- */\n.join-code-pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  direction: ltr;\n  unicode-bidi: isolate;\n  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;\n  font-size: 1rem;\n  font-weight: 700;\n  letter-spacing: 0.12em;\n  background: var(--obsidian);\n  color: #fff;\n  border-radius: var(--radius-sm);\n  padding: 5px 12px;\n}\n\n/* ---------- Auth Flagship Hero ---------- */\n.auth-wrap {\n  max-width: 460px;\n  margin: 4px auto 0;\n}\n\n.auth-hero {\n  text-align: right;\n  margin: 0 0 14px;\n}\n\n.auth-hero h1 {\n  margin: 0 0 6px;\n  font-family: var(--font-display);\n  font-size: 1.85rem;\n  font-weight: 700;\n  letter-spacing: -0.035em;\n  line-height: 1.12;\n  color: #fff;\n}\n\n.auth-hero p {\n  margin: 0 0 14px;\n  color: rgba(255, 255, 255, 0.72);\n  font-size: 0.92rem;\n}\n\n.auth-pillars {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n\n.auth-pillar {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  padding: 4px 10px;\n  border-radius: var(--radius-pill);\n  background: rgba(255, 255, 255, 0.08);\n  border: 1px solid rgba(255, 255, 255, 0.12);\n  color: rgba(255, 255, 255, 0.9);\n  font-size: 0.76rem;\n  font-weight: 600;\n}\n\n.segmented {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  background: var(--surface-3);\n  border-radius: var(--radius-pill);\n  padding: 4px;\n  margin-bottom: 16px;\n}\n\n.segmented-btn {\n  border: none;\n  background: transparent;\n  padding: 9px;\n  border-radius: var(--radius-pill);\n  font-weight: 700;\n  color: var(--ink-soft);\n  cursor: pointer;\n  transition: all 0.18s var(--ease);\n}\n\n.segmented-btn.active {\n  background: #fff;\n  color: var(--ink);\n  box-shadow: 0 1px 2px rgba(13, 16, 22, 0.08), 0 4px 12px -4px rgba(13, 16, 22, 0.16);\n}\n\n/* ---------- Radio & checkbox ---------- */\n.radio-option {\n  display: flex;\n  align-items: flex-start;\n  gap: 11px;\n  padding: 12px 14px;\n  border: 1px solid var(--line);\n  border-radius: 16px;\n  background: var(--surface-2);\n  cursor: pointer;\n  margin-bottom: 8px;\n  transition: border-color 0.15s ease, background 0.15s ease;\n}\n\n.radio-option:has(input:checked) {\n  border-color: var(--obsidian);\n  background: #fff;\n  box-shadow: 0 0 0 3px rgba(13, 16, 22, 0.06);\n}\n\n.radio-option input {\n  margin-top: 4px;\n  accent-color: var(--coral);\n}\n\n.radio-title {\n  font-weight: 700;\n  font-size: 0.93rem;\n  color: var(--ink);\n}\n\n.radio-desc {\n  font-size: 0.81rem;\n  color: var(--ink-mute);\n}\n\n.checkbox-row {\n  display: flex;\n  align-items: flex-start;\n  gap: 10px;\n  cursor: pointer;\n  font-size: 0.9rem;\n}\n\n.checkbox-row input {\n  margin-top: 4px;\n  accent-color: var(--coral);\n  width: 18px;\n  height: 18px;\n  flex-shrink: 0;\n}\n\n/* ---------- Modal ---------- */\n.modal-root {\n  position: fixed;\n  inset: 0;\n  z-index: 80;\n  background: rgba(13, 16, 22, 0.56);\n  -webkit-backdrop-filter: blur(6px);\n  backdrop-filter: blur(6px);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 14px;\n}\n\n.modal-card {\n  width: 100%;\n  max-width: 440px;\n  max-height: 90vh;\n  overflow-y: auto;\n  background: #fff;\n  border-radius: 26px;\n  padding: 20px;\n  box-shadow: 0 30px 64px -20px rgba(13, 16, 22, 0.55);\n  animation: page-in 0.24s var(--ease);\n}\n\n/* ---------- Toast ---------- */\n.toast-container {\n  position: fixed;\n  bottom: calc(92px + env(safe-area-inset-bottom, 0px));\n  left: 50%;\n  transform: translateX(-50%);\n  z-index: 90;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  width: calc(100% - 28px);\n  max-width: 420px;\n  pointer-events: none;\n}\n\n.toast {\n  background: var(--obsidian);\n  color: #fff;\n  padding: 11px 16px;\n  border-radius: var(--radius-pill);\n  font-size: 0.89rem;\n  font-weight: 700;\n  box-shadow: 0 14px 32px -12px rgba(13, 16, 22, 0.65);\n  text-align: center;\n  animation: page-in 0.25s var(--ease);\n}\n\n.toast.toast-error {\n  background: var(--red-text);\n}\n\n/* ---------- Weekly chart ---------- */\n.weekly-chart-wrap {\n  margin-top: 14px;\n  padding-top: 14px;\n  border-top: 1px solid var(--line);\n}\n\n.weekly-chart-title {\n  display: flex;\n  align-items: baseline;\n  justify-content: space-between;\n  gap: 8px;\n  flex-wrap: wrap;\n  font-size: 0.78rem;\n  font-weight: 600;\n  color: var(--ink-soft);\n  margin-bottom: 12px;\n}\n\n.weekly-goal-legend {\n  font-size: 0.73rem;\n  font-weight: 500;\n  color: var(--ink-mute);\n}\n\n.weekly-chart-bars {\n  position: relative;\n  display: grid;\n  grid-template-columns: repeat(6, minmax(0, 1fr));\n  gap: 8px;\n  align-items: end;\n  padding-top: 6px;\n}\n\n.weekly-goal-line {\n  position: absolute;\n  left: 0;\n  right: 0;\n  border-top: 1.5px dashed rgba(13, 16, 22, 0.25);\n  pointer-events: none;\n  z-index: 1;\n}\n\n.weekly-bar-col {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 5px;\n  z-index: 2;\n}\n\n.weekly-bar-val {\n  font-size: 0.71rem;\n  font-weight: 700;\n  color: var(--ink-soft);\n  font-variant-numeric: tabular-nums;\n}\n\n.weekly-bar-track {\n  width: 100%;\n  max-width: 36px;\n  height: 72px;\n  background: var(--surface-3);\n  border-radius: 10px;\n  display: flex;\n  align-items: flex-end;\n  overflow: hidden;\n}\n\n.weekly-bar-fill {\n  width: 100%;\n  border-radius: 10px;\n  background: #c9c4bc;\n  transition: height 0.4s var(--ease);\n}\n\n.weekly-bar-col.is-current .weekly-bar-fill {\n  background: var(--coral-grad);\n}\n\n.weekly-bar-fill.hit-goal {\n  background: var(--teal);\n}\n\n.weekly-bar-fill.empty {\n  background: transparent;\n}\n\n.weekly-bar-label {\n  font-size: 0.69rem;\n  color: var(--ink-mute);\n  white-space: nowrap;\n}\n\n.weekly-bar-col.is-current .weekly-bar-label {\n  font-weight: 700;\n  color: var(--ink);\n}\n\n/* ---------- Leaderboard self-rank ---------- */\n.my-rank-banner {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 10px;\n  background: linear-gradient(135deg, #161b25, #0d1016);\n  color: #fff;\n  border-radius: 16px;\n  padding: 12px 15px;\n  font-size: 0.89rem;\n  margin-bottom: 12px;\n}\n\n.my-rank-banner * {\n  color: inherit;\n}\n\n.lb-row-me {\n  background: var(--coral-soft);\n  border-color: var(--coral-line);\n}\n\n/* ---------- Focus ---------- */\nbutton:focus-visible,\na:focus-visible,\n[role=\"button\"]:focus-visible {\n  outline: 2px solid var(--coral);\n  outline-offset: 2px;\n}\n\nhr {\n  border: none;\n  border-top: 1px solid var(--line);\n}\n\n/* ---------- Live GPS Tracker, Pacer, Route SVG & Splits ---------- */\n.track-status-bar {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  flex-wrap: wrap;\n}\n\n.gps-pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 7px;\n  padding: 4px 11px;\n  border-radius: var(--radius-pill);\n  font-size: 0.76rem;\n  font-weight: 700;\n  background: rgba(255, 255, 255, 0.09);\n  color: #fff;\n  border: 1px solid rgba(255, 255, 255, 0.14);\n}\n\n.gps-pill i {\n  width: 8px;\n  height: 8px;\n  border-radius: 50%;\n  display: inline-block;\n}\n\n.gps-pill.gps-ok i {\n  background: #22c997;\n  box-shadow: 0 0 0 3px rgba(34, 201, 151, 0.28);\n}\n\n.gps-pill.gps-warn i {\n  background: #f5b942;\n}\n\n.gps-pill.gps-bad i {\n  background: #f25f5c;\n}\n\n.wake-pill {\n  display: inline-flex;\n  align-items: center;\n  padding: 4px 10px;\n  border-radius: var(--radius-pill);\n  font-size: 0.73rem;\n  font-weight: 600;\n  color: rgba(255, 255, 255, 0.58);\n  background: rgba(255, 255, 255, 0.06);\n  border: 1px solid rgba(255, 255, 255, 0.1);\n}\n\n.wake-pill.active {\n  color: #8df0d1;\n  border-color: rgba(34, 201, 151, 0.38);\n}\n\n.track-big-distance {\n  text-align: center;\n  padding: 18px 0 12px;\n}\n\n.track-big-distance span {\n  display: block;\n  font-family: var(--font-display);\n  font-size: 4.3rem;\n  font-weight: 700;\n  line-height: 0.92;\n  letter-spacing: -0.045em;\n  color: #fff;\n}\n\n.track-big-distance small {\n  display: inline-block;\n  margin-top: 6px;\n  font-size: 0.88rem;\n  font-weight: 700;\n  color: rgba(255, 255, 255, 0.58);\n}\n\n.track-metrics-row {\n  display: grid;\n  grid-template-columns: repeat(3, minmax(0, 1fr));\n  gap: 8px;\n}\n\n.track-metrics-row .stat-tile {\n  padding: 10px 8px;\n  text-align: center;\n}\n\n.track-metrics-row .stat-value {\n  font-size: 1.24rem;\n}\n\n.pacer-row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  flex-wrap: wrap;\n  margin-top: 12px;\n  padding: 9px 12px;\n  border-radius: 14px;\n  background: rgba(255, 255, 255, 0.06);\n  border: 1px solid rgba(255, 255, 255, 0.09);\n  font-size: 0.8rem;\n}\n\n.pacer-pills {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 5px;\n}\n\n.pacer-chip {\n  border: 1px solid rgba(255, 255, 255, 0.18);\n  background: rgba(255, 255, 255, 0.06);\n  color: rgba(255, 255, 255, 0.78);\n  border-radius: var(--radius-pill);\n  padding: 3px 9px;\n  font-size: 0.74rem;\n  font-weight: 700;\n  cursor: pointer;\n}\n\n.pacer-chip.active {\n  background: var(--coral);\n  border-color: var(--coral);\n  color: #fff;\n}\n\n.pacer-ahead {\n  color: #5eead4;\n  font-weight: 700;\n}\n\n.pacer-behind {\n  color: #fca5a5;\n  font-weight: 700;\n}\n\n.track-controls {\n  display: flex;\n  gap: 8px;\n  margin-top: 16px;\n  flex-wrap: wrap;\n}\n\n.route-svg-wrap {\n  border-radius: 16px;\n  background: var(--surface-2);\n  border: 1px solid var(--line);\n  overflow: hidden;\n  padding: 4px;\n}\n\n.route-svg-wrap.dark {\n  background: rgba(255, 255, 255, 0.04);\n  border-color: rgba(255, 255, 255, 0.09);\n}\n\n.route-svg-empty {\n  text-align: center;\n  padding: 20px 12px;\n  border-radius: 16px;\n  font-size: 0.8rem;\n  color: var(--ink-mute);\n  border: 1px dashed var(--line-strong);\n}\n\n.route-svg-empty.dark {\n  color: rgba(255, 255, 255, 0.45);\n  border-color: rgba(255, 255, 255, 0.14);\n}\n\n.splits-list {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n\n.split-row {\n  display: grid;\n  grid-template-columns: 52px minmax(0, 1fr) auto auto;\n  align-items: center;\n  gap: 10px;\n  padding: 8px 10px;\n  border-radius: 12px;\n  background: var(--surface-2);\n  border: 1px solid var(--line);\n  font-size: 0.84rem;\n}\n\n.split-km {\n  font-weight: 700;\n  color: var(--ink);\n}\n\n.split-bar-track {\n  height: 8px;\n  border-radius: var(--radius-pill);\n  background: var(--surface-3);\n  overflow: hidden;\n}\n\n.split-bar-fill {\n  height: 100%;\n  border-radius: var(--radius-pill);\n  background: var(--coral-grad);\n}\n\n.split-pace {\n  font-weight: 700;\n  color: var(--ink);\n  white-space: nowrap;\n}\n\n.split-elapsed {\n  font-size: 0.78rem;\n  color: var(--ink-mute);\n  white-space: nowrap;\n}\n\n/* ---------- Pace & Race Calculator ---------- */\n.pace-slider {\n  width: 100%;\n  accent-color: var(--coral);\n  cursor: pointer;\n}\n\n.pace-race-grid {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 8px;\n  margin-top: 12px;\n}\n\n.pace-zone-row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 9px 12px;\n  border-radius: 12px;\n  background: var(--surface-2);\n  border: 1px solid var(--line);\n  font-size: 0.84rem;\n}\n\n.share-preview-img {\n  width: 100%;\n  border-radius: 18px;\n  display: block;\n  box-shadow: var(--shadow-lift);\n  margin-bottom: 12px;\n}\n\n/* ---------- 320px ---------- */\n@media (max-width: 350px) {\n  .main-content {\n    padding: 14px 10px 104px;\n  }\n  .card {\n    padding: 15px 12px;\n    border-radius: 20px;\n  }\n  .page-title {\n    font-size: 1.48rem;\n  }\n  .stat-value {\n    font-size: 1.24rem;\n  }\n  .track-big-distance span {\n    font-size: 3.3rem;\n  }\n  .bottom-nav {\n    left: 6px;\n    right: 6px;\n    padding: 5px;\n  }\n  .bottom-nav-btn {\n    font-size: 0.65rem;\n  }\n  .closed-add-card {\n    padding-right: 14px;\n  }\n  .closed-add-card::before {\n    display: none;\n  }\n  .header-user-pill {\n    max-width: 96px;\n    padding: 4px 9px;\n    font-size: 0.74rem;\n  }\n  .header-run-pill {\n    display: none;\n  }\n  .quick-tools-grid {\n    grid-template-columns: 1fr;\n  }\n}\n\n/* ---------- Desktop ---------- */\n@media (min-width: 768px) {\n  .desktop-nav {\n    display: block;\n  }\n  .bottom-nav {\n    display: none !important;\n  }\n  .main-content {\n    padding: 22px 18px 56px;\n  }\n  .toast-container {\n    bottom: 24px;\n  }\n  .card {\n    padding: 22px 22px;\n  }\n  .page-title {\n    font-size: 2.05rem;\n  }\n  .pr-grid {\n    grid-template-columns: repeat(3, minmax(0, 1fr));\n  }\n  .pr-card.pr-wide {\n    grid-column: span 1;\n  }\n  .stats-grid {\n    grid-template-columns: repeat(3, minmax(0, 1fr));\n  }\n  .stat-tile-wide {\n    grid-column: span 1;\n  }\n  .pace-race-grid {\n    grid-template-columns: repeat(4, minmax(0, 1fr));\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  *,\n  *::before,\n  *::after {\n    animation: none !important;\n    transition: none !important;\n  }\n}\n\n  </style>\n</head>\n<body>\n  <div id=\"app\" class=\"app-shell\">\n    <header class=\"top-header\" id=\"top-header\">\n      <div class=\"header-inner\">\n        <div class=\"header-brand\">\n          <button id=\"header-back-btn\" class=\"header-back-btn hidden\" type=\"button\" aria-label=\"חזרה\">\n            &#8594;&nbsp;חזרה\n          </button>\n          <a href=\"#/home\" class=\"brand-link\" aria-label=\"Isrunner דף הבית\">\n            <span class=\"brand-mark\" aria-hidden=\"true\">\n              <svg viewBox=\"0 0 24 24\" width=\"20\" height=\"20\" fill=\"none\" stroke-linecap=\"round\">\n                <path d=\"M5 16.5 L11 7.5\" stroke=\"#ffffff\" stroke-width=\"2.6\" />\n                <path d=\"M10.5 16.5 L16.5 7.5\" stroke=\"#e2552f\" stroke-width=\"2.6\" />\n                <path d=\"M16 16.5 L19 12\" stroke=\"#ffffff\" stroke-width=\"2.6\" opacity=\"0.45\" />\n              </svg>\n            </span>\n            <span class=\"brand-name\">Isrunner</span>\n          </a>\n        </div>\n        <div class=\"header-right\" id=\"header-right\"></div>\n      </div>\n    </header>\n\n    <nav class=\"desktop-nav hidden\" id=\"desktop-nav\" aria-label=\"ניווט ראשי\"></nav>\n\n    <main id=\"main-content\" class=\"main-content\" tabindex=\"-1\">\n      <div class=\"loading-box\">טוען את Isrunner...</div>\n    </main>\n\n    <nav class=\"bottom-nav hidden\" id=\"bottom-nav\" aria-label=\"ניווט תחתון\"></nav>\n\n    <div id=\"toast-container\" class=\"toast-container\" role=\"status\" aria-live=\"polite\"></div>\n    <div id=\"modal-root\" class=\"modal-root hidden\" role=\"dialog\" aria-modal=\"true\"></div>\n  </div>\n\n  <script>\n(function () {\n\n'use strict';\n\n// --- public/api.js ---\nclass ApiError extends Error {\n  constructor(status, code, message, payload = {}) {\n    super(message || 'שגיאה בתקשורת מול השרת');\n    this.status = status;\n    this.code = code;\n    this.payload = payload;\n  }\n}\n\nasync function apiRequest(path, { method = 'GET', body } = {}) {\n  const opts = {\n    method,\n    credentials: 'same-origin',\n    headers: {},\n  };\n\n  if (body !== undefined) {\n    opts.headers['Content-Type'] = 'application/json';\n    opts.body = JSON.stringify(body);\n  }\n\n  const res = await fetch(path, opts);\n  let data = {};\n  try {\n    data = await res.json();\n  } catch {\n    data = {};\n  }\n\n  if (!res.ok) {\n    throw new ApiError(\n      res.status,\n      data.error || 'request_failed',\n      data.message || `שגיאת שרת (${res.status})`,\n      data\n    );\n  }\n\n  return data;\n}\n\nconst api = {\n  me: () => apiRequest('/api/auth/me'),\n  register: (payload) => apiRequest('/api/auth/register', { method: 'POST', body: payload }),\n  login: (payload) => apiRequest('/api/auth/login', { method: 'POST', body: payload }),\n  logout: () => apiRequest('/api/auth/logout', { method: 'POST' }),\n  logoutAll: () => apiRequest('/api/auth/logout-all', { method: 'POST' }),\n  changePassword: (current_password, new_password) =>\n    apiRequest('/api/me/password', { method: 'POST', body: { current_password, new_password } }),\n  requestPasswordReset: (email) =>\n    apiRequest('/api/auth/password-reset/request', { method: 'POST', body: { email } }),\n  sendEmailCode: () => apiRequest('/api/auth/email/send-code', { method: 'POST' }),\n  verifyEmailCode: (code) =>\n    apiRequest('/api/auth/email/verify-code', { method: 'POST', body: { code } }),\n  updateSettings: (payload) => apiRequest('/api/me/settings', { method: 'PATCH', body: payload }),\n  exportMyData: () => apiRequest('/api/me/export'),\n  deleteMyAccount: (password) =>\n    apiRequest('/api/me/account', { method: 'DELETE', body: { password } }),\n\n  home: () => apiRequest('/api/home'),\n  myRuns: () => apiRequest('/api/runs'),\n  createGpsRun: (payload) => apiRequest('/api/runs/gps', { method: 'POST', body: payload }),\n  getRun: (id) => apiRequest(`/api/runs/${encodeURIComponent(id)}`),\n  toggleRunShare: (id, is_shared) =>\n    apiRequest(`/api/runs/${encodeURIComponent(id)}/share`, { method: 'PATCH', body: { is_shared } }),\n  updateRunNote: (id, note) =>\n    apiRequest(`/api/runs/${encodeURIComponent(id)}/note`, { method: 'PATCH', body: { note } }),\n  deleteRun: (id) => apiRequest(`/api/runs/${encodeURIComponent(id)}`, { method: 'DELETE' }),\n\n  sources: () => apiRequest('/api/sources'),\n  connectGarmin: (consent_accepted) =>\n    apiRequest('/api/sources/garmin/connect', {\n      method: 'POST',\n      body: { consent_accepted },\n    }),\n  connectStrava: (consent_accepted) =>\n    apiRequest('/api/sources/strava/connect', {\n      method: 'POST',\n      body: { consent_accepted },\n    }),\n  syncStrava: () => apiRequest('/api/sources/strava/sync', { method: 'POST' }),\n  disconnectSource: (provider, delete_source_runs) =>\n    apiRequest(`/api/sources/${encodeURIComponent(provider)}/disconnect`, {\n      method: 'POST',\n      body: { delete_source_runs },\n    }),\n  deleteSourceData: (provider) =>\n    apiRequest(`/api/sources/${encodeURIComponent(provider)}/data`, { method: 'DELETE' }),\n\n  leaderboard: (category = '5k') =>\n    apiRequest(`/api/leaderboard?category=${encodeURIComponent(category)}`),\n\n  friends: () => apiRequest('/api/friends'),\n  searchUsers: (q) => apiRequest(`/api/users/search?q=${encodeURIComponent(q)}`),\n  sendFriendRequest: (target_user_id) =>\n    apiRequest('/api/friends/requests', { method: 'POST', body: { target_user_id } }),\n  respondFriendRequest: (userId, action) =>\n    apiRequest(`/api/friends/requests/${encodeURIComponent(userId)}`, {\n      method: 'PATCH',\n      body: { action },\n    }),\n  removeFriend: (userId) =>\n    apiRequest(`/api/friends/${encodeURIComponent(userId)}`, { method: 'DELETE' }),\n  blockUser: (userId) =>\n    apiRequest(`/api/blocks/${encodeURIComponent(userId)}`, { method: 'POST' }),\n  unblockUser: (userId) =>\n    apiRequest(`/api/blocks/${encodeURIComponent(userId)}`, { method: 'DELETE' }),\n  userProfile: (userId) => apiRequest(`/api/users/${encodeURIComponent(userId)}`),\n\n  notifications: () => apiRequest('/api/notifications'),\n  markNotificationRead: (id) =>\n    apiRequest(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),\n  markAllNotificationsRead: () =>\n    apiRequest('/api/notifications/read-all', { method: 'POST' }),\n\n  groups: () => apiRequest('/api/groups'),\n  createGroup: (payload) => apiRequest('/api/groups', { method: 'POST', body: payload }),\n  previewGroup: (code) => apiRequest(`/api/groups/preview?code=${encodeURIComponent(code)}`),\n  joinGroup: (join_code) => apiRequest('/api/groups/join', { method: 'POST', body: { join_code } }),\n  leaveGroup: (groupId) =>\n    apiRequest(`/api/groups/${encodeURIComponent(groupId)}/leave`, { method: 'POST' }),\n  groupDetail: (groupId, category = '5k') =>\n    apiRequest(\n      `/api/groups/${encodeURIComponent(groupId)}?category=${encodeURIComponent(category)}`\n    ),\n\n  createReport: (payload) => apiRequest('/api/reports', { method: 'POST', body: payload }),\n  resources: () => apiRequest('/api/resources'),\n};\n\n\n// --- public/utils.js ---\nfunction escapeHtml(str) {\n  if (str === null || str === undefined) return '';\n  return String(str)\n    .replace(/&/g, '&amp;')\n    .replace(/</g, '&lt;')\n    .replace(/>/g, '&gt;')\n    .replace(/\"/g, '&quot;')\n    .replace(/'/g, '&#39;');\n}\n\nfunction formatDistance(km) {\n  if (km === null || km === undefined || Number.isNaN(Number(km))) return '—';\n  const n = Number(km);\n  return `${n.toFixed(2).replace(/\\.00$/, '')} ק\"מ`;\n}\n\nfunction formatDuration(totalSec) {\n  if (!totalSec || totalSec <= 0) return '—';\n  const sec = Math.round(Number(totalSec));\n  const h = Math.floor(sec / 3600);\n  const m = Math.floor((sec % 3600) / 60);\n  const s = sec % 60;\n  const pad = (v) => String(v).padStart(2, '0');\n  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;\n  return `${m}:${pad(s)}`;\n}\n\nfunction formatPace(secPerKm) {\n  if (!secPerKm || secPerKm <= 0) return '—';\n  const sec = Math.round(Number(secPerKm));\n  const m = Math.floor(sec / 60);\n  const s = sec % 60;\n  return `${m}:${String(s).padStart(2, '0')} דק'/ק\"מ`;\n}\n\nfunction formatDateHe(isoStr) {\n  if (!isoStr) return '';\n  const d = new Date(isoStr);\n  if (Number.isNaN(d.getTime())) return '';\n  return new Intl.DateTimeFormat('he-IL', {\n    day: 'numeric',\n    month: 'short',\n    year: 'numeric',\n  }).format(d);\n}\n\nfunction formatDateTimeHe(isoStr) {\n  if (!isoStr) return '';\n  const d = new Date(isoStr);\n  if (Number.isNaN(d.getTime())) return '';\n  return new Intl.DateTimeFormat('he-IL', {\n    day: 'numeric',\n    month: 'short',\n    hour: '2-digit',\n    minute: '2-digit',\n  }).format(d);\n}\n\nfunction initialsOf(name) {\n  if (!name) return 'ר';\n  const parts = String(name).trim().split(/\\s+/);\n  if (parts.length >= 2) {\n    return (parts[0][0] + parts[1][0]).toUpperCase();\n  }\n  return parts[0].slice(0, 2).toUpperCase();\n}\n\nfunction renderSourceBadge(source) {\n  if (source && source.verified) {\n    return `<span class=\"badge badge-verified\">${escapeHtml(source.label)}</span>`;\n  }\n  return `<span class=\"badge badge-legacy\">${escapeHtml(source?.label || 'דיווח עצמי, לא מאומת')}</span>`;\n}\n\nconst PR_CODES = {\n  '5k': '5K',\n  '10k': '10K',\n  half: '21.1K',\n  marathon: '42.2K',\n  longest: 'MAX',\n};\n\nfunction renderPersonalRecordsGrid(records) {\n  if (!Array.isArray(records) || records.length === 0) return '';\n  return `\n    <div class=\"pr-grid\">\n      ${records\n        .map((item) => {\n          const rec = item.record;\n          const isWide = item.key === 'longest';\n          const code = PR_CODES[item.key] || item.key;\n          const mainValue = !rec\n            ? '—'\n            : item.type === 'distance'\n              ? formatDistance(rec.distance_km)\n              : formatDuration(rec.duration_sec);\n\n          const meta = !rec\n            ? `<span class=\"pr-meta\">${escapeHtml(item.range_text || 'אין תוצאה עדיין')}</span>`\n            : `<div class=\"pr-meta\">\n                <span class=\"tabular\">${item.type === 'distance' ? formatDuration(rec.duration_sec) : formatDistance(rec.distance_km)}</span>\n                <span>•</span>\n                <span>${formatDateHe(rec.ran_at)}</span>\n                ${rec.is_anomalous_pace ? '<span class=\"badge badge-anomaly\">קצב חריג</span>' : ''}\n              </div>`;\n\n          return `\n            <div class=\"pr-card ${isWide ? 'pr-wide' : ''} ${rec ? 'pr-unlocked' : ''}\" ${rec ? `data-open-run=\"${escapeHtml(rec.run_id)}\" role=\"button\" tabindex=\"0\"` : ''}>\n              <div class=\"pr-top-row\">\n                <div class=\"pr-label\">${escapeHtml(item.short_label || item.label)}</div>\n                <span class=\"pr-code-chip\">${escapeHtml(code)}</span>\n              </div>\n              <div class=\"pr-value tabular\">${escapeHtml(mainValue)}</div>\n              ${meta}\n            </div>\n          `;\n        })\n        .join('')}\n    </div>\n  `;\n}\n\nfunction renderRunCard(run, { showRunner = false } = {}) {\n  const runnerHeader =\n    showRunner && run.runner\n      ? `<div style=\"margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;gap:8px;\">\n           <button type=\"button\" class=\"user-name-link\" data-open-profile=\"${escapeHtml(run.runner.id)}\">\n             ${escapeHtml(run.runner.display_name)}\n           </button>\n           <span class=\"run-date\">${formatDateHe(run.ran_at)}</span>\n         </div>`\n      : '';\n\n  return `\n    <article class=\"run-item\" data-open-run=\"${escapeHtml(run.id)}\">\n      ${runnerHeader}\n      <div class=\"run-item-top\">\n        <div class=\"run-metrics\">\n          <span class=\"run-dist tabular\">${formatDistance(run.distance_km)}</span>\n          <span class=\"run-time tabular\">${formatDuration(run.duration_sec)}</span>\n          <span class=\"run-pace tabular\">${formatPace(run.pace_sec_per_km)}</span>\n        </div>\n        ${!showRunner ? `<span class=\"run-date\">${formatDateHe(run.ran_at)}</span>` : ''}\n      </div>\n      <div class=\"run-badges\">\n        ${renderSourceBadge(run.source)}\n        ${!run.is_shared ? '<span class=\"badge badge-private\">פרטית (רק לך)</span>' : ''}\n        ${run.is_anomalous_pace ? '<span class=\"badge badge-anomaly\">קצב חריג</span>' : ''}\n      </div>\n      ${run.note ? `<p class=\"run-note\">${escapeHtml(run.note)}</p>` : ''}\n    </article>\n  `;\n}\n\nfunction pluralHe(count, singular, plural) {\n  return Number(count) === 1 ? singular : `${count} ${plural}`;\n}\n\nfunction renderWeeklyMileageChart(history, goalKm) {\n  if (!Array.isArray(history) || history.length === 0) return '';\n  const maxKm = Math.max(\n    5,\n    Number(goalKm) || 0,\n    ...history.map((w) => Number(w.km) || 0)\n  );\n  const goalPct = goalKm && goalKm > 0 ? Math.min(96, Math.round((goalKm / maxKm) * 100)) : null;\n\n  return `\n    <div class=\"weekly-chart-wrap\" aria-label=\"גרף קילומטרים ל-6 שבועות אחרונים\">\n      <div class=\"weekly-chart-title\">\n        <span>רצף 6 שבועות אחרונים (ק\"מ)</span>\n        ${goalKm ? `<span class=\"weekly-goal-legend\">קו מקווקו: יעד ${escapeHtml(goalKm)} ק\"מ</span>` : ''}\n      </div>\n      <div class=\"weekly-chart-bars\">\n        ${\n          goalPct !== null\n            ? `<div class=\"weekly-goal-line\" style=\"bottom:${goalPct}%\"></div>`\n            : ''\n        }\n        ${history\n          .map((w) => {\n            const km = Number(w.km) || 0;\n            const hPct = km > 0 ? Math.max(6, Math.round((km / maxKm) * 100)) : 2;\n            const hitGoal = goalKm && km >= goalKm;\n            return `\n              <div class=\"weekly-bar-col ${w.is_current ? 'is-current' : ''}\">\n                <div class=\"weekly-bar-val tabular\">${km > 0 ? km.toFixed(1).replace(/\\.0$/, '') : '0'}</div>\n                <div class=\"weekly-bar-track\">\n                  <div class=\"weekly-bar-fill ${hitGoal ? 'hit-goal' : ''} ${km === 0 ? 'empty' : ''}\" style=\"height:${hPct}%\"></div>\n                </div>\n                <div class=\"weekly-bar-label\">${escapeHtml(w.label)}</div>\n              </div>\n            `;\n          })\n          .join('')}\n      </div>\n    </div>\n  `;\n}\n\nfunction showToast(message, { error = false } = {}) {\n  const container = document.getElementById('toast-container');\n  if (!container) return;\n  const el = document.createElement('div');\n  el.className = `toast ${error ? 'toast-error' : ''}`;\n  el.textContent = message;\n  container.appendChild(el);\n  setTimeout(() => {\n    el.remove();\n  }, 3400);\n}\n\nfunction openModal(html, onBind) {\n  const root = document.getElementById('modal-root');\n  if (!root) return;\n  root.innerHTML = `<div class=\"modal-card\">${html}</div>`;\n  root.classList.remove('hidden');\n\n  const onKeyDown = (e) => {\n    if (e.key === 'Escape') close();\n  };\n\n  const close = () => {\n    document.removeEventListener('keydown', onKeyDown);\n    root.classList.add('hidden');\n    root.innerHTML = '';\n  };\n\n  document.addEventListener('keydown', onKeyDown);\n  root.onclick = (e) => {\n    if (e.target === root) close();\n  };\n\n  if (onBind) onBind(root, close);\n  return close;\n}\n\nfunction renderRouteSvg(polyline, { dark = false } = {}) {\n  if (!Array.isArray(polyline) || polyline.length < 2) {\n    return `<div class=\"route-svg-empty ${dark ? 'dark' : ''}\">מסלול ה-GPS יצויר כאן אוטומטית תוך כדי תנועה</div>`;\n  }\n  const lats = polyline.map((p) => Number(p[0]));\n  const lngs = polyline.map((p) => Number(p[1]));\n  const minLat = Math.min(...lats);\n  const maxLat = Math.max(...lats);\n  const minLng = Math.min(...lngs);\n  const maxLng = Math.max(...lngs);\n\n  const avgLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180;\n  const cosLat = Math.max(0.2, Math.cos(avgLatRad));\n  const spanX = Math.max(0.00015, (maxLng - minLng) * cosLat);\n  const spanY = Math.max(0.00015, maxLat - minLat);\n\n  const W = 320;\n  const H = 140;\n  const pad = 16;\n  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);\n  const usedW = spanX * scale;\n  const usedH = spanY * scale;\n  const offsetX = (W - usedW) / 2;\n  const offsetY = (H - usedH) / 2;\n\n  const pts = polyline.map(([lat, lng]) => {\n    const x = offsetX + (lng - minLng) * cosLat * scale;\n    const y = H - (offsetY + (lat - minLat) * scale);\n    return `${x.toFixed(1)},${y.toFixed(1)}`;\n  });\n\n  const [sx, sy] = pts[0].split(',');\n  const [ex, ey] = pts[pts.length - 1].split(',');\n  const gridStroke = dark ? 'rgba(255,255,255,0.06)' : 'rgba(21,24,30,0.06)';\n  const startFill = dark ? '#ffffff' : '#1d5c63';\n\n  return `\n    <div class=\"route-svg-wrap ${dark ? 'dark' : ''}\">\n      <svg viewBox=\"0 0 ${W} ${H}\" width=\"100%\" height=\"140\" role=\"img\" aria-label=\"מסלול ריצת GPS\">\n        <g stroke=\"${gridStroke}\" stroke-width=\"1\">\n          <line x1=\"0\" y1=\"35\" x2=\"${W}\" y2=\"35\" />\n          <line x1=\"0\" y1=\"70\" x2=\"${W}\" y2=\"70\" />\n          <line x1=\"0\" y1=\"105\" x2=\"${W}\" y2=\"105\" />\n        </g>\n        <polyline points=\"${pts.join(' ')}\" fill=\"none\" stroke=\"#e2552f\" stroke-width=\"3.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" />\n        <circle cx=\"${sx}\" cy=\"${sy}\" r=\"4.2\" fill=\"${startFill}\" />\n        <circle cx=\"${ex}\" cy=\"${ey}\" r=\"5.5\" fill=\"#e2552f\" stroke=\"${dark ? '#15181e' : '#ffffff'}\" stroke-width=\"2\" />\n      </svg>\n    </div>\n  `;\n}\n\nfunction renderSplitsTable(splits) {\n  if (!Array.isArray(splits) || splits.length === 0) return '';\n  const paces = splits.map((s) => Number(s.pace_sec_per_km || s.split_sec || 0)).filter((v) => v > 0);\n  const fastest = Math.min(...paces);\n  const slowest = Math.max(...paces);\n  const span = Math.max(1, slowest - fastest);\n\n  return `\n    <div class=\"splits-list\">\n      ${splits\n        .map((s) => {\n          const pace = Number(s.pace_sec_per_km || s.split_sec || 0);\n          // Faster split gets a longer bar (Garmin-style speed bar)\n          const pct = paces.length === 1 ? 80 : Math.round(35 + ((slowest - pace) / span) * 65);\n          return `\n            <div class=\"split-row\">\n              <span class=\"split-km tabular\">ק\"מ ${escapeHtml(s.km)}</span>\n              <div class=\"split-bar-track\">\n                <div class=\"split-bar-fill\" style=\"width:${pct}%\"></div>\n              </div>\n              <span class=\"split-pace tabular\">${formatPace(pace)}</span>\n              <span class=\"split-elapsed tabular\">${formatDuration(s.elapsed_sec)}</span>\n            </div>\n          `;\n        })\n        .join('')}\n    </div>\n  `;\n}\n\nfunction getHebrewGreeting(now = new Date()) {\n  const h = now.getHours();\n  if (h >= 5 && h < 12) return 'בוקר טוב';\n  if (h >= 12 && h < 17) return 'אחר צהריים טובים';\n  if (h >= 17 && h < 22) return 'ערב טוב';\n  return 'לילה טוב';\n}\n\nfunction openPaceCalculatorModal(initialPaceSec = 315) {\n  let paceSec = Math.max(180, Math.min(540, Math.round(initialPaceSec)));\n\n  openModal(\n    `\n      <div class=\"card-header\" style=\"margin-bottom:10px;\">\n        <div>\n          <h3 class=\"card-title\">מחשבון קצב וזמני מירוץ</h3>\n          <p class=\"card-subtitle\">גרור את הקצב וראה זמני סיום וטווחי אימון</p>\n        </div>\n        <button type=\"button\" class=\"btn btn-outline btn-sm\" id=\"btn-pace-close\">סגור</button>\n      </div>\n\n      <div class=\"card hero-card\" style=\"padding:16px;margin-bottom:12px;\">\n        <div style=\"display:flex;justify-content:space-between;align-items:baseline;gap:8px;\">\n          <div>\n            <div class=\"stat-label\">קצב יעד</div>\n            <div id=\"pc-pace-val\" class=\"stat-value tabular\" style=\"font-size:2rem;\">${formatPace(paceSec)}</div>\n          </div>\n          <div style=\"text-align:left;\">\n            <div class=\"stat-label\">מהירות</div>\n            <div id=\"pc-speed-val\" class=\"stat-value tabular\" style=\"font-size:1.35rem;\">${(3600 / paceSec).toFixed(1)} קמ\"ש</div>\n          </div>\n        </div>\n        <input id=\"pc-slider\" class=\"pace-slider\" type=\"range\" min=\"180\" max=\"540\" step=\"5\" value=\"${paceSec}\" style=\"margin-top:12px;\" aria-label=\"בחירת קצב בשניות לקילומטר\" />\n        <div style=\"display:flex;justify-content:space-between;font-size:0.72rem;color:rgba(255,255,255,0.55);margin-top:4px;\">\n          <span>3:00 (מהיר)</span>\n          <span>6:00</span>\n          <span>9:00 (קל)</span>\n        </div>\n      </div>\n\n      <div class=\"form-label\">זמני סיום משוערים בקצב הזה</div>\n      <div class=\"pace-race-grid\" id=\"pc-races\" style=\"margin-bottom:14px;\"></div>\n\n      <div class=\"form-label\">טווחי אימון מומלצים לפי קצב בסיס</div>\n      <div class=\"list-stack\" id=\"pc-zones\"></div>\n    `,\n    (root, close) => {\n      const renderCalc = () => {\n        const speed = (3600 / paceSec).toFixed(1);\n        root.querySelector('#pc-pace-val').textContent = formatPace(paceSec);\n        root.querySelector('#pc-speed-val').textContent = `${speed} קמ\"ש`;\n\n        const races = [\n          { label: '5 ק\"מ', km: 5 },\n          { label: '10 ק\"מ', km: 10 },\n          { label: 'חצי מרתון', km: 21.0975 },\n          { label: 'מרתון', km: 42.195 },\n        ];\n        root.querySelector('#pc-races').innerHTML = races\n          .map(\n            (r) => `\n              <div class=\"stat-tile\">\n                <div class=\"stat-label\">${r.label}</div>\n                <div class=\"stat-value tabular\" style=\"font-size:1.18rem;\">${formatDuration(Math.round(r.km * paceSec))}</div>\n              </div>\n            `\n          )\n          .join('');\n\n        const zones = [\n          { name: 'ריצה קלה / התאוששות', val: `${formatPace(paceSec + 45)} – ${formatPace(paceSec + 75)}` },\n          { name: 'קצב מרתון', val: formatPace(paceSec + 15) },\n          { name: 'טמפו / סף', val: formatPace(Math.max(170, paceSec - 10)) },\n          { name: 'אינטרוולים (1,000 מ׳)', val: formatPace(Math.max(160, paceSec - 25)) },\n        ];\n        root.querySelector('#pc-zones').innerHTML = zones\n          .map(\n            (z) => `\n              <div class=\"pace-zone-row\">\n                <strong>${z.name}</strong>\n                <span class=\"tabular\" style=\"color:var(--coral-deep);font-weight:700;\">${z.val}</span>\n              </div>\n            `\n          )\n          .join('');\n      };\n\n      renderCalc();\n      root.querySelector('#pc-slider').addEventListener('input', (e) => {\n        paceSec = Number(e.target.value);\n        renderCalc();\n      });\n      root.querySelector('#btn-pace-close').addEventListener('click', close);\n    }\n  );\n}\n\nfunction openShareRunCardModal(run, ownerName = '') {\n  const canvas = document.createElement('canvas');\n  const W = 720;\n  const H = 900;\n  canvas.width = W;\n  canvas.height = H;\n  const ctx = canvas.getContext('2d');\n\n  // Deep obsidian editorial background + vermilion & emerald glows\n  const bgGrad = ctx.createLinearGradient(0, 0, W, H);\n  bgGrad.addColorStop(0, '#171c27');\n  bgGrad.addColorStop(0.55, '#0d1016');\n  bgGrad.addColorStop(1, '#121621');\n  ctx.fillStyle = bgGrad;\n  ctx.fillRect(0, 0, W, H);\n\n  const glow1 = ctx.createRadialGradient(120, H - 120, 20, 120, H - 120, 420);\n  glow1.addColorStop(0, 'rgba(255, 77, 28, 0.34)');\n  glow1.addColorStop(1, 'rgba(255, 77, 28, 0)');\n  ctx.fillStyle = glow1;\n  ctx.fillRect(0, 0, W, H);\n\n  const glow2 = ctx.createRadialGradient(W - 80, 120, 10, W - 80, 120, 340);\n  glow2.addColorStop(0, 'rgba(34, 201, 151, 0.18)');\n  glow2.addColorStop(1, 'rgba(34, 201, 151, 0)');\n  ctx.fillStyle = glow2;\n  ctx.fillRect(0, 0, W, H);\n\n  // Subtle decorative track arc\n  ctx.strokeStyle = 'rgba(255,255,255,0.06)';\n  ctx.lineWidth = 2;\n  ctx.beginPath();\n  ctx.roundRect(-90, -70, 380, 200, 100);\n  ctx.stroke();\n\n  // Brand top-right + date top-left\n  ctx.fillStyle = '#ffffff';\n  ctx.font = '700 34px Rubik, Heebo, sans-serif';\n  ctx.textAlign = 'left';\n  ctx.fillText('Isrunner', 48, 82);\n\n  // Orange brand bars next to logo\n  ctx.strokeStyle = '#ff4d1c';\n  ctx.lineWidth = 5;\n  ctx.lineCap = 'round';\n  ctx.beginPath();\n  ctx.moveTo(48, 100);\n  ctx.lineTo(148, 100);\n  ctx.stroke();\n\n  ctx.fillStyle = 'rgba(255,255,255,0.62)';\n  ctx.font = '600 22px Heebo, sans-serif';\n  ctx.textAlign = 'right';\n  ctx.fillText(formatDateHe(run.ran_at), W - 48, 80);\n  if (ownerName) {\n    ctx.fillStyle = 'rgba(255,255,255,0.85)';\n    ctx.fillText(ownerName, W - 48, 114);\n  }\n\n  // Optional GPS Route Trace in center\n  const poly = Array.isArray(run.route_polyline) ? run.route_polyline : [];\n  if (poly.length >= 2) {\n    const lats = poly.map((p) => Number(p[0]));\n    const lngs = poly.map((p) => Number(p[1]));\n    const minLat = Math.min(...lats);\n    const maxLat = Math.max(...lats);\n    const minLng = Math.min(...lngs);\n    const maxLng = Math.max(...lngs);\n    const cosLat = Math.max(0.2, Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180));\n    const spanX = Math.max(0.00015, (maxLng - minLng) * cosLat);\n    const spanY = Math.max(0.00015, maxLat - minLat);\n    const boxW = W - 120;\n    const boxH = 260;\n    const sc = Math.min(boxW / spanX, boxH / spanY);\n    const ox = (W - spanX * sc) / 2;\n    const oy = 175 + (boxH - spanY * sc) / 2;\n\n    ctx.strokeStyle = '#ff5722';\n    ctx.lineWidth = 7;\n    ctx.lineJoin = 'round';\n    ctx.lineCap = 'round';\n    ctx.beginPath();\n    poly.forEach(([lat, lng], idx) => {\n      const x = ox + (lng - minLng) * cosLat * sc;\n      const y = oy + (maxLat - lat) * sc;\n      if (idx === 0) ctx.moveTo(x, y);\n      else ctx.lineTo(x, y);\n    });\n    ctx.stroke();\n  }\n\n  // Giant hero distance metric\n  const yHero = poly.length >= 2 ? 555 : 420;\n  ctx.fillStyle = '#ffffff';\n  ctx.textAlign = 'center';\n  ctx.font = '700 132px Rubik, sans-serif';\n  ctx.fillText(`${Number(run.distance_km).toFixed(2)}`, W / 2, yHero);\n  ctx.fillStyle = 'rgba(255,255,255,0.62)';\n  ctx.font = '600 30px Heebo, sans-serif';\n  ctx.fillText('ק\"מ', W / 2, yHero + 46);\n\n  // Two bottom stat boxes: Time & Pace\n  const yBoxes = yHero + 95;\n  ctx.fillStyle = 'rgba(255,255,255,0.06)';\n  ctx.strokeStyle = 'rgba(255,255,255,0.12)';\n  ctx.lineWidth = 2;\n  ctx.beginPath();\n  ctx.roundRect(48, yBoxes, 296, 130, 24);\n  ctx.fill();\n  ctx.stroke();\n\n  ctx.beginPath();\n  ctx.roundRect(W - 48 - 296, yBoxes, 296, 130, 24);\n  ctx.fill();\n  ctx.stroke();\n\n  ctx.fillStyle = 'rgba(255,255,255,0.58)';\n  ctx.font = '600 22px Heebo, sans-serif';\n  ctx.fillText('קצב ממוצע', 48 + 148, yBoxes + 44);\n  ctx.fillText('זמן נטו', W - 48 - 148, yBoxes + 44);\n\n  ctx.fillStyle = '#ffffff';\n  ctx.font = '700 44px Rubik, sans-serif';\n  ctx.fillText(\n    formatPace(run.pace_sec_per_km).replace(\" דק'/ק\\\"מ\", ''),\n    48 + 148,\n    yBoxes + 100\n  );\n  ctx.fillText(formatDuration(run.duration_sec), W - 48 - 148, yBoxes + 100);\n\n  // Honest source footer\n  ctx.fillStyle = run.source?.verified ? '#22c997' : '#f5b942';\n  ctx.font = '600 21px Heebo, sans-serif';\n  ctx.fillText(run.source?.label || '', W / 2, H - 36);\n\n  const dataUrl = canvas.toDataURL('image/png');\n  const shareText = `ריצה ב-Isrunner: ${formatDistance(run.distance_km)} ב-${formatDuration(run.duration_sec)} (קצב ${formatPace(run.pace_sec_per_km)})`;\n\n  openModal(\n    `\n      <div class=\"card-header\" style=\"margin-bottom:10px;\">\n        <div>\n          <h3 class=\"card-title\">כרטיס שיתוף ריצה</h3>\n          <p class=\"card-subtitle\">מוכן לשליחה לוואטסאפ או לסטורי</p>\n        </div>\n        <button type=\"button\" class=\"btn btn-outline btn-sm\" id=\"btn-share-close\">סגור</button>\n      </div>\n      <img src=\"${dataUrl}\" alt=\"כרטיס שיתוף ריצה\" class=\"share-preview-img\" />\n      <div class=\"btn-row\">\n        <button type=\"button\" id=\"btn-native-share\" class=\"btn btn-primary\" style=\"flex:1;\">שתף עכשיו</button>\n        <a href=\"${dataUrl}\" download=\"isrunner-run.png\" class=\"btn btn-secondary\">הורד תמונה</a>\n      </div>\n    `,\n    (root, close) => {\n      root.querySelector('#btn-share-close').addEventListener('click', close);\n      root.querySelector('#btn-native-share').addEventListener('click', async () => {\n        try {\n          if (navigator.share) {\n            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));\n            const file = blob ? new File([blob], 'isrunner-run.png', { type: 'image/png' }) : null;\n            if (file && navigator.canShare && navigator.canShare({ files: [file] })) {\n              await navigator.share({ title: 'Isrunner', text: shareText, files: [file] });\n              return;\n            }\n            await navigator.share({ title: 'Isrunner', text: shareText });\n            return;\n          }\n          if (navigator.clipboard?.writeText) {\n            await navigator.clipboard.writeText(shareText);\n            showToast('סיכום הריצה הועתק ללוח!');\n          }\n        } catch {\n          // User canceled share sheet\n        }\n      });\n    }\n  );\n}\n\n\n// --- public/views/auth.js ---\n\n\nfunction renderAuthView(container, app) {\n  let mode = 'login';\n\n  function draw() {\n    container.innerHTML = `\n      <section class=\"auth-wrap\">\n        <div class=\"card hero-card auth-hero\">\n          <div style=\"font-size:0.78rem;font-weight:700;color:#ff8a66;margin-bottom:4px;\">קהילת הרצים של ישראל</div>\n          <h1>כל ריצה אמיתית נספרת.</h1>\n          <p>מדידת GPS חיה מהטלפון, חיבורי Garmin ו-Strava, שיאים אישיים ודירוגים שקופים עם חברים וקבוצות.</p>\n          <div class=\"auth-pillars\">\n            <span class=\"auth-pillar\">שעון GPS חי</span>\n            <span class=\"auth-pillar\">Garmin ו-Strava</span>\n            <span class=\"auth-pillar\">דירוגים ללא זיופים</span>\n          </div>\n        </div>\n\n        <div class=\"card\">\n          <div class=\"segmented\" role=\"tablist\">\n            <button type=\"button\" id=\"tab-login\" class=\"segmented-btn ${mode === 'login' ? 'active' : ''}\" role=\"tab\" aria-selected=\"${mode === 'login'}\">\n              התחברות\n            </button>\n            <button type=\"button\" id=\"tab-register\" class=\"segmented-btn ${mode === 'register' ? 'active' : ''}\" role=\"tab\" aria-selected=\"${mode === 'register'}\">\n              הרשמה\n            </button>\n          </div>\n\n          <div id=\"auth-error\" class=\"alert-error hidden\"></div>\n\n          <form id=\"auth-form\" novalidate>\n            <div class=\"form-group\">\n              <label class=\"form-label\" for=\"auth-username\">${mode === 'login' ? 'שם משתמש או אימייל' : 'שם משתמש'}</label>\n              <input id=\"auth-username\" class=\"input\" type=\"text\" autocomplete=\"username\" required placeholder=\"למשל: noa_runs\" />\n              ${mode === 'register' ? '<div class=\"help-text\">2 עד 30 תווים (עברית, אנגלית, ספרות, נקודה או קו תחתון).</div>' : ''}\n            </div>\n\n            ${\n              mode === 'register'\n                ? `\n                  <div class=\"form-group\">\n                    <label class=\"form-label\" for=\"auth-display-name\">שם תצוגה</label>\n                    <input id=\"auth-display-name\" class=\"input\" type=\"text\" autocomplete=\"name\" required placeholder=\"למשל: נועה לוי\" />\n                  </div>\n                  <div class=\"form-group\">\n                    <label class=\"form-label\" for=\"auth-email\">אימייל אישי (חובה)</label>\n                    <input id=\"auth-email\" class=\"input\" type=\"email\" autocomplete=\"email\" required placeholder=\"name@example.com\" />\n                    <div class=\"help-text\">כתובת אימייל אחת לכל רץ (ללא מיילים זמניים או כפילויות +tag). כל רץ מופיע פעם אחת בלבד בכל טבלת דירוג.</div>\n                  </div>\n                `\n                : ''\n            }\n\n            <div class=\"form-group\">\n              <label class=\"form-label\" for=\"auth-password\">סיסמה</label>\n              <input id=\"auth-password\" class=\"input\" type=\"password\" autocomplete=\"${mode === 'login' ? 'current-password' : 'new-password'}\" required placeholder=\"לפחות 8 תווים\" />\n              ${mode === 'register' ? '<div class=\"help-text\">מינימום 8 תווים. הסיסמה נשמרת מוצפנת (PBKDF2 עם סולט).</div>' : ''}\n            </div>\n\n            <button id=\"auth-submit-btn\" type=\"submit\" class=\"btn btn-primary btn-block\">\n              ${mode === 'login' ? 'כניסה לחשבון' : 'פתיחת חשבון חדש'}\n            </button>\n          </form>\n\n          <div class=\"info-box\" style=\"margin-top: 14px;\">\n            <strong>דירוג הוגן ופרטיות:</strong>\n            אי אפשר להשתמש באפליקציה בלי הרשמה עם אימייל אישי ייחודי, וכל רץ נספר פעם אחת בלבד בטבלה (השיא הטוב ביותר שלו).\n            <a href=\"#/privacy\" style=\"font-weight:700;\">טיוטת מדיניות פרטיות (גיל 18+)</a>\n          </div>\n        </div>\n\n        <div class=\"card card-soft\">\n          <h2 class=\"card-title\" style=\"margin-bottom:6px;\">שקיפות מקורות מדידה</h2>\n          <p style=\"margin:0;font-size:0.88rem;color:var(--text-secondary);\">\n            Isrunner נבנית סביב דירוג אמין ממקור מדידה אמיתי (GPS חי, Garmin Connect או Strava). הוספת ריצות ידנית סגורה.\n          </p>\n        </div>\n      </section>\n    `;\n\n    container.querySelector('#tab-login').addEventListener('click', () => {\n      mode = 'login';\n      draw();\n    });\n    container.querySelector('#tab-register').addEventListener('click', () => {\n      mode = 'register';\n      draw();\n    });\n\n    const form = container.querySelector('#auth-form');\n    const errorEl = container.querySelector('#auth-error');\n    const submitBtn = container.querySelector('#auth-submit-btn');\n\n    form.addEventListener('submit', async (e) => {\n      e.preventDefault();\n      errorEl.classList.add('hidden');\n      const username = container.querySelector('#auth-username').value.trim();\n      const password = container.querySelector('#auth-password').value;\n      const displayNameInput = container.querySelector('#auth-display-name');\n      const emailInput = container.querySelector('#auth-email');\n      const display_name = displayNameInput ? displayNameInput.value.trim() : undefined;\n      const email = emailInput ? emailInput.value.trim() : undefined;\n\n      if (mode === 'register' && !email) {\n        errorEl.textContent = 'חובה להזין כתובת אימייל אישית כדי להירשם.';\n        errorEl.classList.remove('hidden');\n        return;\n      }\n\n      submitBtn.disabled = true;\n      try {\n        const res =\n          mode === 'login'\n            ? await api.login({ username, password })\n            : await api.register({ username, display_name, email, password });\n        if (typeof res.email_verification_enabled === 'boolean') {\n          app.emailVerificationEnabled = res.email_verification_enabled;\n        }\n        app.setUser(res.user);\n        if (mode === 'register' && res.verification_code_sent) {\n          showToast('החשבון נוצר! נשלח קוד אימות למייל שלך (אפשר לאמת במסך \"אני\").');\n        } else {\n          showToast(mode === 'login' ? `שלום ${res.user.display_name}!` : 'החשבון נוצר בהצלחה!');\n        }\n        app.navigate('#/home');\n      } catch (err) {\n        errorEl.textContent = err.message || 'שגיאה בכניסה';\n        errorEl.classList.remove('hidden');\n      } finally {\n        submitBtn.disabled = false;\n      }\n    });\n  }\n\n  draw();\n}\n\n\n// --- public/views/home.js ---\n\n\nasync function renderHomeView(container, app) {\n  container.innerHTML = '<div class=\"loading-box\">טוען נתוני בית...</div>';\n  const data = await api.home();\n  app.setUnreadCount(data.unread_notifications_count || 0);\n\n  let runFilter = 'all';\n\n  function draw() {\n    const s = data.summary;\n    const goalKm = s.weekly_goal_km;\n    const pct = goalKm ? Math.min(100, Math.round((s.weekly_km / goalKm) * 100)) : 0;\n\n    const filteredRuns = data.recent_runs.filter((r) => {\n      if (runFilter === 'shared') return r.is_shared;\n      if (runFilter === 'private') return !r.is_shared;\n      return true;\n    });\n\n    container.innerHTML = `\n      <div class=\"page-eyebrow\">${escapeHtml(getHebrewGreeting())}</div>\n      <h1 class=\"page-title\">${escapeHtml(app.user.display_name)}</h1>\n\n      <!-- Flagship Athletic Hero Card (Hero-first!) -->\n      <section class=\"card hero-card\">\n        <div class=\"card-header\">\n          <div>\n            <h2 class=\"card-title\">השבוע שלי</h2>\n            <p class=\"card-subtitle\">מיום ראשון ועד היום</p>\n          </div>\n          <button type=\"button\" class=\"btn btn-outline btn-sm\" id=\"btn-edit-goal\">\n            ${goalKm ? 'עדכן יעד' : '+ הגדר יעד שבועי'}\n          </button>\n        </div>\n\n        <div class=\"stats-grid\">\n          <div class=\"stat-tile\">\n            <div class=\"stat-label\">ק\"מ השבוע</div>\n            <div class=\"stat-value tabular\">${s.weekly_km.toFixed(1)} ק\"מ</div>\n            <div class=\"stat-sub\">${pluralHe(s.weekly_runs_count, 'ריצה אחת', 'ריצות')} השבוע</div>\n          </div>\n          <div class=\"stat-tile\">\n            <div class=\"stat-label\">קצב ממוצע</div>\n            <div class=\"stat-value tabular\">${s.avg_pace_sec_per_km ? formatPace(s.avg_pace_sec_per_km) : '—'}</div>\n            <div class=\"stat-sub\">מתוך ${pluralHe(s.total_runs, 'ריצה אחת', 'ריצות')}</div>\n          </div>\n          <div class=\"stat-tile stat-tile-wide\">\n            <div class=\"stat-label\">יעד שבועי (אופציונלי)</div>\n            ${\n              goalKm\n                ? `\n                  <div style=\"display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-top:2px;\">\n                    <strong class=\"tabular goal-figure\">${s.weekly_km.toFixed(1)} / ${goalKm} ק\"מ</strong>\n                    <span class=\"stat-sub tabular\">${pct}%</span>\n                  </div>\n                  <div class=\"progress-bar-wrap\" role=\"progressbar\" aria-valuenow=\"${pct}\" aria-valuemin=\"0\" aria-valuemax=\"100\">\n                    <div class=\"progress-bar-fill\" style=\"width:${pct}%\"></div>\n                  </div>\n                `\n                : '<div class=\"stat-sub\" style=\"margin-top:4px;\">אין יעד שבועי מוגדר כרגע — אפשר להגדיר בכל זמן.</div>'\n            }\n          </div>\n        </div>\n\n        ${renderWeeklyMileageChart(data.weekly_history, goalKm)}\n\n        <div class=\"hero-action-bar\">\n          <button type=\"button\" class=\"btn btn-primary\" id=\"btn-start-gps-hero\" style=\"flex:1;\">\n            ▶ התחל ריצה עם GPS\n          </button>\n          <button type=\"button\" class=\"btn btn-outline\" id=\"btn-open-sources-hero\">\n            שעון Garmin / Strava\n          </button>\n        </div>\n      </section>\n\n      <!-- Quick Runner Utilities -->\n      <div class=\"quick-tools-grid\">\n        <button type=\"button\" class=\"quick-tool-tile\" id=\"btn-open-pace-calc\">\n          <span class=\"quick-tool-ic\" style=\"background:var(--coral-soft);color:var(--coral-deep);\">\n            <svg viewBox=\"0 0 24 24\" width=\"20\" height=\"20\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.1\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/></svg>\n          </span>\n          <span>\n            <b>מחשבון קצב ומירוץ</b>\n            <span>חישוב 5K, 10K, חצי ומרתון</span>\n          </span>\n        </button>\n        <button type=\"button\" class=\"quick-tool-tile\" id=\"btn-open-sources-tile\">\n          <span class=\"quick-tool-ic\" style=\"background:var(--teal-soft);color:var(--teal);\">\n            <svg viewBox=\"0 0 24 24\" width=\"20\" height=\"20\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.1\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M13 2 3 14h9l-1 8 10-12h-9l1-8z\"/></svg>\n          </span>\n          <span>\n            <b>חיבור Garmin ו-Strava</b>\n            <span>סנכרון אוטומטי ואמין</span>\n          </span>\n        </button>\n      </div>\n\n      <!-- Trust & Integrity Strip (Closed manual run addition notice) -->\n      <section class=\"closed-add-card\" id=\"closed-add-card\" aria-label=\"סטטוס הוספת ריצות\">\n        <h2 class=\"closed-add-title\">דירוג אמין ללא הזנה ידנית</h2>\n        <p class=\"closed-add-text\">${escapeHtml(data.add_run_status.message)}</p>\n        <div class=\"btn-row\">\n          <button type=\"button\" class=\"btn btn-outline btn-sm\" id=\"btn-start-gps-home\">\n            ▶ מדוד עם GPS\n          </button>\n          <button type=\"button\" class=\"btn btn-outline btn-sm\" id=\"btn-open-sources\">\n            מקורות מדידה\n          </button>\n        </div>\n      </section>\n\n      <!-- In-app Notifications -->\n      <section class=\"card\" id=\"notifications-card\">\n        <div class=\"card-header\">\n          <div>\n            <h2 class=\"card-title\">\n              התראות ${data.unread_notifications_count > 0 ? `<span class=\"badge badge-anomaly\">${pluralHe(data.unread_notifications_count, 'התראה חדשה', 'חדשות')}</span>` : ''}\n            </h2>\n            <p class=\"card-subtitle\">כשחבר משתף ריצה בפעם הראשונה</p>\n          </div>\n          ${\n            data.unread_notifications_count > 0\n              ? '<button type=\"button\" class=\"btn btn-outline btn-sm\" id=\"btn-mark-all-read\">סמן הכול כנקרא</button>'\n              : ''\n          }\n        </div>\n\n        ${\n          data.notifications.length === 0\n            ? '<div class=\"empty-state\">אין התראות כרגע. כשחברים ישתפו ריצה חדשה, תראה אותה כאן.</div>'\n            : `<div class=\"list-stack\">\n                ${data.notifications\n                  .map(\n                    (n) => `\n                      <div class=\"notif-item ${n.is_read ? '' : 'unread'}\" data-notif-id=\"${escapeHtml(n.id)}\" data-run-id=\"${escapeHtml(n.run_id)}\" role=\"button\" tabindex=\"0\">\n                        ${n.is_read ? '' : '<span class=\"notif-dot\" aria-label=\"לא נקרא\"></span>'}\n                        <div class=\"notif-body\">\n                          <div>\n                            <strong>${escapeHtml(n.actor_display_name)}</strong> שיתף/ה ריצה של\n                            <strong class=\"tabular\">${formatDistance(n.distance_km)}</strong>\n                            (<span class=\"tabular\">${formatDuration(n.duration_sec)}</span>)\n                          </div>\n                          <div class=\"run-date\">${formatDateTimeHe(n.created_at)}</div>\n                        </div>\n                        ${\n                          !n.is_read\n                            ? `<button type=\"button\" class=\"btn btn-outline btn-sm\" data-mark-read=\"${escapeHtml(n.id)}\">נקרא</button>`\n                            : '<span class=\"badge badge-neutral\">נקרא</span>'\n                        }\n                      </div>\n                    `\n                  )\n                  .join('')}\n              </div>`\n        }\n        <p class=\"help-text\" style=\"margin-top:10px;margin-bottom:0;\">\n          התראות לטלפון כשהאפליקציה סגורה הן שלב עתידי נפרד שידרוש הסכמה מפורשת.\n        </p>\n      </section>\n\n      <!-- Personal Records Summary -->\n      <section class=\"card\">\n        <div class=\"card-header\">\n          <div>\n            <h2 class=\"card-title\">השיאים האישיים שלי</h2>\n            <p class=\"card-subtitle\">5 ק\"מ, 10 ק\"מ, חצי מרתון, מרתון והארוכה ביותר</p>\n          </div>\n        </div>\n        ${renderPersonalRecordsGrid(data.personal_records)}\n      </section>\n\n      <!-- Friends Activity (last 14 days, newest first) -->\n      <section class=\"card\">\n        <div class=\"card-header\">\n          <div>\n            <h2 class=\"card-title\">פעילות חברים (14 ימים אחרונים)</h2>\n            <p class=\"card-subtitle\">החדש ראשון — רק ריצות משותפות</p>\n          </div>\n          <button type=\"button\" class=\"btn btn-outline btn-sm\" id=\"btn-go-friends\">חברים</button>\n        </div>\n\n        ${\n          data.friends_activity.length === 0\n            ? '<div class=\"empty-state\">אין פעילות חברים ב-14 הימים האחרונים. הזמן חברים כדי לעקוב יחד.</div>'\n            : `<div class=\"list-stack\">\n                ${data.friends_activity.map((r) => renderRunCard(r, { showRunner: true })).join('')}\n              </div>`\n        }\n      </section>\n\n      <!-- Recent Own Runs with quick filter -->\n      <section class=\"card\">\n        <div class=\"card-header\">\n          <div>\n            <h2 class=\"card-title\">הריצות האחרונות שלי</h2>\n            <p class=\"card-subtitle\">לחיצה על ריצה פותחת פרטים, שיתוף ומקור</p>\n          </div>\n        </div>\n        ${\n          data.recent_runs.length > 0\n            ? `<div class=\"tabs-scroll\" style=\"margin-bottom:10px;\">\n                <button type=\"button\" class=\"tab-pill ${runFilter === 'all' ? 'active' : ''}\" data-run-filter=\"all\">הכול (${data.recent_runs.length})</button>\n                <button type=\"button\" class=\"tab-pill ${runFilter === 'shared' ? 'active' : ''}\" data-run-filter=\"shared\">משותפות</button>\n                <button type=\"button\" class=\"tab-pill ${runFilter === 'private' ? 'active' : ''}\" data-run-filter=\"private\">פרטיות</button>\n              </div>`\n            : ''\n        }\n\n        ${\n          filteredRuns.length === 0\n            ? '<div class=\"empty-state\">אין ריצות להצגה בסינון זה.</div>'\n            : `<div class=\"list-stack\">\n                ${filteredRuns.map((r) => renderRunCard(r)).join('')}\n              </div>`\n        }\n      </section>\n    `;\n\n    container.querySelector('#btn-start-gps-hero')?.addEventListener('click', () => {\n      app.navigate('#/track');\n    });\n    container.querySelector('#btn-start-gps-home')?.addEventListener('click', () => {\n      app.navigate('#/track');\n    });\n    container.querySelector('#btn-open-sources-hero')?.addEventListener('click', () => {\n      app.navigate('#/sources');\n    });\n    container.querySelector('#btn-open-sources-tile')?.addEventListener('click', () => {\n      app.navigate('#/sources');\n    });\n    container.querySelector('#btn-open-pace-calc')?.addEventListener('click', () => {\n      openPaceCalculatorModal(s.avg_pace_sec_per_km || 315);\n    });\n    container.querySelector('#btn-open-sources').addEventListener('click', () => {\n      app.navigate('#/sources');\n    });\n\n    container.querySelector('#btn-go-friends').addEventListener('click', () => {\n      app.navigate('#/friends');\n    });\n\n    container.querySelectorAll('[data-run-filter]').forEach((btn) => {\n      btn.addEventListener('click', () => {\n        runFilter = btn.getAttribute('data-run-filter');\n        draw();\n      });\n    });\n\n    container.querySelector('#btn-edit-goal').addEventListener('click', () => {\n      openModal(\n        `\n          <h3 class=\"card-title\" style=\"margin-bottom:10px;\">יעד שבועי (ק\"מ)</h3>\n          <form id=\"goal-form\">\n            <div class=\"form-group\">\n              <label class=\"form-label\" for=\"goal-input\">כמה ק\"מ תרצה לרוץ בשבוע? (אופציונלי)</label>\n              <input id=\"goal-input\" class=\"input\" type=\"number\" step=\"0.5\" min=\"1\" max=\"500\" value=\"${goalKm ?? ''}\" placeholder=\"למשל: 25\" />\n              <div class=\"help-text\">השאר ריק כדי לבטל את היעד השבועי.</div>\n            </div>\n            <div class=\"btn-row\">\n              <button type=\"submit\" class=\"btn btn-primary\">שמירה</button>\n              <button type=\"button\" class=\"btn btn-outline\" id=\"goal-cancel\">ביטול</button>\n            </div>\n          </form>\n        `,\n        (root, close) => {\n          root.querySelector('#goal-cancel').addEventListener('click', close);\n          root.querySelector('#goal-form').addEventListener('submit', async (e) => {\n            e.preventDefault();\n            const rawVal = root.querySelector('#goal-input').value.trim();\n            const weekly_goal_km = rawVal === '' ? null : Number(rawVal);\n            try {\n              const res = await api.updateSettings({ weekly_goal_km });\n              app.setUser(res.user);\n              close();\n              showToast(weekly_goal_km ? `יעד שבועי עודכן ל-${weekly_goal_km} ק\"מ` : 'היעד השבועי הוסר');\n              renderHomeView(container, app);\n            } catch (err) {\n              showToast(err.message, { error: true });\n            }\n          });\n        }\n      );\n    });\n\n    const markAllBtn = container.querySelector('#btn-mark-all-read');\n    if (markAllBtn) {\n      markAllBtn.addEventListener('click', async () => {\n        try {\n          await api.markAllNotificationsRead();\n          showToast('כל ההתראות סומנו כנקראו');\n          renderHomeView(container, app);\n        } catch (err) {\n          showToast(err.message, { error: true });\n        }\n      });\n    }\n\n    container.querySelectorAll('[data-mark-read]').forEach((btn) => {\n      btn.addEventListener('click', async (e) => {\n        e.stopPropagation();\n        const id = btn.getAttribute('data-mark-read');\n        try {\n          await api.markNotificationRead(id);\n          renderHomeView(container, app);\n        } catch (err) {\n          showToast(err.message, { error: true });\n        }\n      });\n    });\n\n    container.querySelectorAll('.notif-item').forEach((item) => {\n      item.addEventListener('click', async () => {\n        const id = item.getAttribute('data-notif-id');\n        const runId = item.getAttribute('data-run-id');\n        if (item.classList.contains('unread')) {\n          try {\n            await api.markNotificationRead(id);\n          } catch {\n            // continue opening run\n          }\n        }\n        app.navigate(`#/run/${encodeURIComponent(runId)}`);\n      });\n    });\n\n    bindRunAndProfileClicks(container, app);\n  }\n\n  draw();\n}\n\nfunction bindRunAndProfileClicks(container, app) {\n  container.querySelectorAll('[data-open-profile]').forEach((el) => {\n    el.addEventListener('click', (e) => {\n      e.stopPropagation();\n      const userId = el.getAttribute('data-open-profile');\n      if (userId) app.navigate(`#/user/${encodeURIComponent(userId)}`);\n    });\n  });\n  container.querySelectorAll('[data-open-run]').forEach((el) => {\n    el.addEventListener('click', () => {\n      const runId = el.getAttribute('data-open-run');\n      if (runId) app.navigate(`#/run/${encodeURIComponent(runId)}`);\n    });\n  });\n}\n\n\n// --- public/views/track.js ---\n\n\nconst EARTH_RADIUS_M = 6_371_000;\nconst MAX_ACC_M = 38;\nconst MAX_JUMP_SPEED_MPS = 12.0;\n\nfunction haversineM(lat1, lng1, lat2, lng2) {\n  const toRad = (d) => (d * Math.PI) / 180;\n  const dLat = toRad(lat2 - lat1);\n  const dLng = toRad(lng2 - lng1);\n  const a =\n    Math.sin(dLat / 2) ** 2 +\n    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;\n  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));\n}\n\nfunction playSplitBeep() {\n  try {\n    const AudioCtx = window.AudioContext || window.webkitAudioContext;\n    if (!AudioCtx) return;\n    const ctx = new AudioCtx();\n    [0, 0.16].forEach((offset, idx) => {\n      const osc = ctx.createOscillator();\n      const gain = ctx.createGain();\n      osc.type = 'sine';\n      osc.frequency.value = idx === 0 ? 880 : 1175;\n      gain.gain.value = 0.12;\n      osc.connect(gain);\n      gain.connect(ctx.destination);\n      osc.start(ctx.currentTime + offset);\n      osc.stop(ctx.currentTime + offset + 0.11);\n    });\n  } catch {\n    // Audio cue is optional\n  }\n}\n\nasync function renderTrackView(container, app) {\n  const geoSupported = typeof navigator !== 'undefined' && 'geolocation' in navigator;\n\n  const state = {\n    phase: 'idle', // idle | running | paused | finished\n    watchId: null,\n    timerId: null,\n    wakeLock: null,\n    wakeLockActive: false,\n    soundEnabled: true,\n    gpsStatus: geoSupported ? 'ready' : 'unsupported', // ready | waiting | good | weak | denied | unsupported\n    gpsError: '',\n    lastAccuracy: null,\n    segment: 0,\n    points: [], // { lat, lng, ts, acc, seg }\n    routeCoords: [], // [lat, lng]\n    distanceM: 0,\n    accumulatedMs: 0,\n    runStartWallMs: null,\n    splits: [], // { km, split_sec, elapsed_sec, pace_sec_per_km }\n    nextKmTarget: 1000,\n    prevSplitElapsedSec: 0,\n    currentPaceSecPerKm: null,\n    targetPaceSec: null, // Optional Garmin-style pacer (sec/km)\n    saving: false,\n  };\n\n  function getNetElapsedSec() {\n    let ms = state.accumulatedMs;\n    if (state.phase === 'running' && state.runStartWallMs) {\n      ms += Date.now() - state.runStartWallMs;\n    }\n    return Math.max(0, Math.floor(ms / 1000));\n  }\n\n  function computeCurrentPace() {\n    // Rolling smoothed pace over last ~18 seconds in current segment\n    const pts = state.points;\n    if (pts.length < 2) return null;\n    const latest = pts[pts.length - 1];\n    let dist = 0;\n    let firstTs = latest.ts;\n    for (let i = pts.length - 1; i > 0; i -= 1) {\n      const a = pts[i - 1];\n      const b = pts[i];\n      if (a.seg !== latest.seg || b.seg !== latest.seg) break;\n      const dt = (b.ts - a.ts) / 1000;\n      if (dt <= 0 || dt > 30) break;\n      dist += haversineM(a.lat, a.lng, b.lat, b.lng);\n      firstTs = a.ts;\n      if (latest.ts - firstTs >= 18_000 && dist >= 35) break;\n    }\n    const windowSec = (latest.ts - firstTs) / 1000;\n    if (dist < 20 || windowSec < 4) return null;\n    const pace = windowSec / (dist / 1000);\n    if (pace < 90 || pace > 1800) return null;\n    return Math.round(pace);\n  }\n\n  async function requestWakeLock() {\n    if (!navigator.wakeLock || !navigator.wakeLock.request) return;\n    try {\n      state.wakeLock = await navigator.wakeLock.request('screen');\n      state.wakeLockActive = true;\n      state.wakeLock.addEventListener('release', () => {\n        state.wakeLockActive = false;\n        updateLiveNodes();\n      });\n    } catch {\n      state.wakeLockActive = false;\n    }\n    updateLiveNodes();\n  }\n\n  async function releaseWakeLock() {\n    if (state.wakeLock) {\n      try {\n        await state.wakeLock.release();\n      } catch {\n        // ignore\n      }\n      state.wakeLock = null;\n      state.wakeLockActive = false;\n    }\n  }\n\n  function onVisibilityChange() {\n    if (document.visibilityState === 'visible' && state.phase === 'running' && !state.wakeLockActive) {\n      requestWakeLock();\n    }\n  }\n\n  function stopWatchers() {\n    if (state.watchId !== null && geoSupported) {\n      navigator.geolocation.clearWatch(state.watchId);\n      state.watchId = null;\n    }\n    if (state.timerId !== null) {\n      clearInterval(state.timerId);\n      state.timerId = null;\n    }\n    document.removeEventListener('visibilitychange', onVisibilityChange);\n    releaseWakeLock();\n  }\n\n  if (typeof app.setCleanup === 'function') {\n    app.setCleanup(() => stopWatchers());\n  }\n\n  function handleGpsPosition(pos) {\n    const lat = pos.coords.latitude;\n    const lng = pos.coords.longitude;\n    const acc = Math.round(pos.coords.accuracy || 0);\n    const ts = pos.timestamp || Date.now();\n\n    state.lastAccuracy = acc;\n    state.gpsError = '';\n    state.gpsStatus = acc <= MAX_ACC_M ? 'good' : 'weak';\n\n    if (state.phase !== 'running') {\n      updateLiveNodes();\n      return;\n    }\n\n    if (acc > MAX_ACC_M) {\n      updateLiveNodes();\n      return;\n    }\n\n    const pt = { lat, lng, ts, acc, seg: state.segment };\n    const prev = state.points.length > 0 ? state.points[state.points.length - 1] : null;\n\n    if (prev && ts <= prev.ts) {\n      updateLiveNodes();\n      return;\n    }\n\n    if (prev && prev.seg === state.segment) {\n      const dtSec = (ts - prev.ts) / 1000;\n      if (dtSec > 0 && dtSec <= 60) {\n        const stepM = haversineM(prev.lat, prev.lng, lat, lng);\n        const speedMps = stepM / dtSec;\n        if (speedMps > MAX_JUMP_SPEED_MPS && stepM > 25) {\n          // Ignore GPS teleport jump\n          updateLiveNodes();\n          return;\n        }\n        const effectiveM = speedMps < 0.25 && stepM < 1.0 ? 0 : stepM;\n        const prevDist = state.distanceM;\n        const elapsedNowSec = getNetElapsedSec();\n        state.distanceM += effectiveM;\n\n        while (effectiveM > 0 && state.distanceM >= state.nextKmTarget) {\n          const frac = (state.nextKmTarget - prevDist) / effectiveM;\n          const crossingSec = Math.max(\n            state.prevSplitElapsedSec + 1,\n            Math.round(elapsedNowSec - dtSec * (1 - Math.max(0, Math.min(1, frac))))\n          );\n          const splitSec = Math.max(1, crossingSec - state.prevSplitElapsedSec);\n          state.splits.push({\n            km: Math.round(state.nextKmTarget / 1000),\n            split_sec: splitSec,\n            elapsed_sec: crossingSec,\n            pace_sec_per_km: splitSec,\n          });\n          state.prevSplitElapsedSec = crossingSec;\n          state.nextKmTarget += 1000;\n          if (state.soundEnabled) playSplitBeep();\n          renderSplitsNode();\n        }\n      }\n    }\n\n    state.points.push(pt);\n    state.routeCoords.push([lat, lng]);\n    state.currentPaceSecPerKm = computeCurrentPace();\n    updateLiveNodes();\n    renderRouteNode();\n  }\n\n  function handleGpsError(err) {\n    if (err.code === 1) {\n      state.gpsStatus = 'denied';\n      state.gpsError =\n        'גישה למיקום נדחתה. באייפון: הגדרות -> פרטיות ואבטחה -> שירותי מיקום -> Safari -> \"בעת שימוש באפליקציה\".';\n    } else if (err.code === 2) {\n      state.gpsStatus = 'weak';\n      state.gpsError = 'אות GPS לא זמין כרגע — מומלץ לצאת לשטח פתוח ולהמתין כמה שניות.';\n    } else {\n      state.gpsStatus = 'waiting';\n      state.gpsError = 'עדיין מאתר לווייני GPS...';\n    }\n    updateLiveNodes();\n  }\n\n  function startGpsWatch() {\n    if (!geoSupported || state.watchId !== null) return;\n    if (state.gpsStatus === 'ready') state.gpsStatus = 'waiting';\n    state.watchId = navigator.geolocation.watchPosition(handleGpsPosition, handleGpsError, {\n      enableHighAccuracy: true,\n      maximumAge: 0,\n      timeout: 15000,\n    });\n  }\n\n  function startRun() {\n    if (!geoSupported) {\n      showToast('הדפדפן הזה אינו תומך ב-GPS.', { error: true });\n      return;\n    }\n    state.phase = 'running';\n    state.runStartWallMs = Date.now();\n    startGpsWatch();\n    requestWakeLock();\n    document.addEventListener('visibilitychange', onVisibilityChange);\n    if (!state.timerId) {\n      state.timerId = setInterval(updateLiveNodes, 250);\n    }\n    draw();\n  }\n\n  function pauseRun() {\n    if (state.phase !== 'running') return;\n    if (state.runStartWallMs) {\n      state.accumulatedMs += Date.now() - state.runStartWallMs;\n      state.runStartWallMs = null;\n    }\n    state.phase = 'paused';\n    state.currentPaceSecPerKm = null;\n    draw();\n  }\n\n  function resumeRun() {\n    if (state.phase !== 'paused') return;\n    state.segment += 1;\n    state.phase = 'running';\n    state.runStartWallMs = Date.now();\n    requestWakeLock();\n    draw();\n  }\n\n  function finishRun() {\n    if (state.phase === 'running' && state.runStartWallMs) {\n      state.accumulatedMs += Date.now() - state.runStartWallMs;\n      state.runStartWallMs = null;\n    }\n    stopWatchers();\n    state.phase = 'finished';\n    draw();\n  }\n\n  function resetRun() {\n    stopWatchers();\n    state.phase = 'idle';\n    state.segment = 0;\n    state.points = [];\n    state.routeCoords = [];\n    state.distanceM = 0;\n    state.accumulatedMs = 0;\n    state.runStartWallMs = null;\n    state.splits = [];\n    state.nextKmTarget = 1000;\n    state.prevSplitElapsedSec = 0;\n    state.currentPaceSecPerKm = null;\n    state.gpsError = '';\n    state.gpsStatus = geoSupported ? 'ready' : 'unsupported';\n    draw();\n  }\n\n  function getGpsBadgeHtml() {\n    if (state.gpsStatus === 'unsupported') {\n      return '<span class=\"gps-pill gps-bad\"><i></i>GPS לא נתמך</span>';\n    }\n    if (state.gpsStatus === 'denied') {\n      return '<span class=\"gps-pill gps-bad\"><i></i>אין הרשאת מיקום</span>';\n    }\n    if (state.gpsStatus === 'ready') {\n      return '<span class=\"gps-pill gps-ok\"><i></i>GPS מוכן</span>';\n    }\n    if (state.gpsStatus === 'good') {\n      const label = state.lastAccuracy <= 15 ? 'GPS מדויק' : 'GPS טוב';\n      return `<span class=\"gps-pill gps-ok\"><i></i>${label} (±${state.lastAccuracy}מ׳)</span>`;\n    }\n    if (state.gpsStatus === 'weak') {\n      return `<span class=\"gps-pill gps-warn\"><i></i>GPS חלש (±${state.lastAccuracy || '?'}מ׳)</span>`;\n    }\n    return '<span class=\"gps-pill gps-warn\"><i></i>מאתר GPS...</span>';\n  }\n\n  function updateLiveNodes() {\n    const distKm = state.distanceM / 1000;\n    const elapsedSec = getNetElapsedSec();\n    const avgPace = distKm >= 0.03 && elapsedSec > 0 ? Math.round(elapsedSec / distKm) : null;\n    const kmProgressM = Math.round(state.distanceM % 1000);\n    const kmProgressPct = Math.min(100, Math.round((kmProgressM / 1000) * 100));\n\n    const elDist = container.querySelector('#live-dist');\n    const elTime = container.querySelector('#live-time');\n    const elAvgPace = container.querySelector('#live-avg-pace');\n    const elCurPace = container.querySelector('#live-cur-pace');\n    const elGps = container.querySelector('#live-gps-slot');\n    const elWake = container.querySelector('#live-wake-pill');\n    const elKmText = container.querySelector('#live-km-progress-text');\n    const elKmBar = container.querySelector('#live-km-progress-bar');\n    const elErr = container.querySelector('#live-gps-error');\n    const elPacerDelta = container.querySelector('#live-pacer-delta');\n\n    if (elDist) elDist.textContent = distKm.toFixed(2);\n    if (elTime) elTime.textContent = formatDuration(elapsedSec) === '—' ? '0:00' : formatDuration(elapsedSec);\n    if (elAvgPace) elAvgPace.textContent = avgPace ? formatPace(avgPace).replace(\" דק'/ק\\\"מ\", '') : '—';\n    if (elCurPace) {\n      elCurPace.textContent = state.currentPaceSecPerKm\n        ? formatPace(state.currentPaceSecPerKm).replace(\" דק'/ק\\\"מ\", '')\n        : '—';\n    }\n    if (elGps) elGps.innerHTML = getGpsBadgeHtml();\n    if (elWake) {\n      elWake.textContent = state.wakeLockActive ? 'מסך נשאר ער' : 'שמירת מסך כבויה';\n      elWake.classList.toggle('active', state.wakeLockActive);\n    }\n    if (elKmText) elKmText.textContent = `${kmProgressM} / 1,000 מ׳ לק\"מ הבא`;\n    if (elKmBar) elKmBar.style.width = `${kmProgressPct}%`;\n    if (elErr) {\n      elErr.textContent = state.gpsError;\n      elErr.classList.toggle('hidden', !state.gpsError);\n    }\n    if (elPacerDelta && state.targetPaceSec && distKm >= 0.05) {\n      const targetElapsed = Math.round(distKm * state.targetPaceSec);\n      const diff = targetElapsed - elapsedSec; // positive = ahead of target!\n      if (diff >= 0) {\n        elPacerDelta.className = 'pacer-ahead tabular';\n        elPacerDelta.textContent = `מקדים ב-${diff} שנ׳`;\n      } else {\n        elPacerDelta.className = 'pacer-behind tabular';\n        elPacerDelta.textContent = `מאחר ב-${Math.abs(diff)} שנ׳`;\n      }\n    }\n  }\n\n  function renderRouteNode() {\n    const slot = container.querySelector('#live-route-slot');\n    if (slot) slot.innerHTML = renderRouteSvg(state.routeCoords, { dark: true });\n  }\n\n  function renderSplitsNode() {\n    const slot = container.querySelector('#live-splits-slot');\n    if (slot) {\n      slot.innerHTML =\n        state.splits.length > 0\n          ? renderSplitsTable(state.splits)\n          : '<div class=\"empty-state\">כל קילומטר שלם שיושלם יופיע כאן אוטומטית עם הקצב שלו.</div>';\n    }\n  }\n\n  function draw() {\n    const distKm = state.distanceM / 1000;\n    const elapsedSec = getNetElapsedSec();\n    const avgPace = distKm >= 0.03 && elapsedSec > 0 ? Math.round(elapsedSec / distKm) : null;\n    const canSave = state.points.length >= 3 && distKm >= 0.05 && elapsedSec >= 10;\n\n    if (state.phase === 'finished') {\n      container.innerHTML = `\n        <h1 class=\"page-title\">סיכום ריצה</h1>\n\n        <section class=\"card hero-card\">\n          <div class=\"card-header\">\n            <div>\n              <h2 class=\"card-title\">מדידת GPS הושלמה</h2>\n              <p class=\"card-subtitle\">השרת יחשב ויאמת מחדש את המרחק והזמן ישירות מנקודות ה-GPS</p>\n            </div>\n            <span class=\"badge badge-verified\">Isrunner GPS</span>\n          </div>\n\n          <div class=\"track-big-distance\">\n            <span class=\"tabular\">${distKm.toFixed(2)}</span>\n            <small>ק\"מ</small>\n          </div>\n\n          <div class=\"track-metrics-row\">\n            <div class=\"stat-tile\">\n              <div class=\"stat-label\">זמן נטו</div>\n              <div class=\"stat-value tabular\">${formatDuration(elapsedSec) === '—' ? '0:00' : formatDuration(elapsedSec)}</div>\n            </div>\n            <div class=\"stat-tile\">\n              <div class=\"stat-label\">קצב ממוצע</div>\n              <div class=\"stat-value tabular\">${avgPace ? formatPace(avgPace).replace(\" דק'/ק\\\"מ\", '') : '—'}</div>\n              <div class=\"stat-sub\">דק'/ק\"מ</div>\n            </div>\n            <div class=\"stat-tile\">\n              <div class=\"stat-label\">נקודות GPS</div>\n              <div class=\"stat-value tabular\">${state.points.length}</div>\n            </div>\n          </div>\n\n          <div style=\"margin-top:14px;\">${renderRouteSvg(state.routeCoords, { dark: true })}</div>\n        </section>\n\n        ${\n          state.splits.length > 0\n            ? `<section class=\"card\">\n                 <h2 class=\"card-title\" style=\"margin-bottom:10px;\">פיצולי ק\"מ (Splits)</h2>\n                 ${renderSplitsTable(state.splits)}\n               </section>`\n            : ''\n        }\n\n        <section class=\"card\">\n          ${\n            !canSave\n              ? `<div class=\"alert-amber\" style=\"margin-bottom:12px;\">\n                   הריצה קצרה מדי לשמירה (נדרשות לפחות 3 נקודות GPS תקינות, 50 מטר תנועה ו-10 שניות).\n                 </div>`\n              : `<form id=\"save-gps-run-form\">\n                   <div class=\"form-group\">\n                     <label class=\"form-label\" for=\"gps-run-note\">הערה לריצה (אופציונלי)</label>\n                     <textarea id=\"gps-run-note\" class=\"textarea\" maxlength=\"500\" placeholder=\"איך הרגשת בריצה?\"></textarea>\n                   </div>\n                   <label class=\"checkbox-row\" style=\"margin-bottom:14px;\">\n                     <input type=\"checkbox\" id=\"gps-run-shared\" checked />\n                     <span>שתף ריצה זו עם חברים ובדירוגים (בהתאם להגדרות הפרטיות שלך)</span>\n                   </label>\n                   <div class=\"btn-row\">\n                     <button type=\"submit\" id=\"btn-save-gps-run\" class=\"btn btn-primary btn-block\" ${state.saving ? 'disabled' : ''}>\n                       ${state.saving ? 'מאמת ושומר בשרת...' : 'שמור ריצה ל-Isrunner'}\n                     </button>\n                   </div>\n                 </form>`\n          }\n          <div class=\"btn-row\" style=\"margin-top:10px;\">\n            <button type=\"button\" id=\"btn-discard-gps-run\" class=\"btn btn-outline btn-block\">\n              מחק ופתח מדידה חדשה\n            </button>\n          </div>\n        </section>\n      `;\n\n      const form = container.querySelector('#save-gps-run-form');\n      if (form) {\n        form.addEventListener('submit', async (e) => {\n          e.preventDefault();\n          if (state.saving) return;\n          state.saving = true;\n          const btn = container.querySelector('#btn-save-gps-run');\n          if (btn) {\n            btn.disabled = true;\n            btn.textContent = 'מאמת ושומר בשרת...';\n          }\n          try {\n            const note = container.querySelector('#gps-run-note')?.value?.trim() || '';\n            const isShared = container.querySelector('#gps-run-shared')?.checked !== false;\n            const res = await api.createGpsRun({\n              points: state.points,\n              note,\n              is_shared: isShared,\n              device_name: 'Isrunner GPS (דפדפן)',\n            });\n            showToast('הריצה אומתה ונשמרה בהצלחה!');\n            app.navigate(`#/run/${encodeURIComponent(res.run.id)}`);\n          } catch (err) {\n            state.saving = false;\n            if (btn) {\n              btn.disabled = false;\n              btn.textContent = 'שמור ריצה ל-Isrunner';\n            }\n            showToast(err.message, { error: true });\n          }\n        });\n      }\n\n      container.querySelector('#btn-discard-gps-run').addEventListener('click', () => {\n        resetRun();\n      });\n      return;\n    }\n\n    container.innerHTML = `\n      <div class=\"card-header\" style=\"margin-bottom:10px;\">\n        <div>\n          <h1 class=\"page-title\" style=\"margin-bottom:2px;\">מדידת ריצה חיה (GPS)</h1>\n          <p class=\"card-subtitle\">מדידה ישירה מהטלפון — מרחק, זמן, קצב חי ופיצולי ק\"מ</p>\n        </div>\n      </div>\n\n      <section class=\"card hero-card\" id=\"gps-cockpit-card\">\n        <div class=\"track-status-bar\">\n          <div id=\"live-gps-slot\">${getGpsBadgeHtml()}</div>\n          <div style=\"display:flex;gap:6px;align-items:center;flex-wrap:wrap;\">\n            <span id=\"live-wake-pill\" class=\"wake-pill ${state.wakeLockActive ? 'active' : ''}\">\n              ${state.wakeLockActive ? 'מסך נשאר ער' : 'שמירת מסך כבויה'}\n            </span>\n            <button type=\"button\" id=\"btn-toggle-sound\" class=\"btn btn-outline btn-sm\" style=\"min-height:30px;padding:3px 10px;font-size:0.76rem;\">\n              ${state.soundEnabled ? 'צליל כל ק\"מ: פעיל' : 'צליל כל ק\"מ: כבוי'}\n            </button>\n          </div>\n        </div>\n\n        <div id=\"live-gps-error\" class=\"alert-error ${state.gpsError ? '' : 'hidden'}\" style=\"margin-top:10px;margin-bottom:0;\">\n          ${escapeHtml(state.gpsError)}\n        </div>\n\n        <div class=\"track-big-distance\">\n          <span id=\"live-dist\" class=\"tabular\">${distKm.toFixed(2)}</span>\n          <small>ק\"מ</small>\n        </div>\n\n        <div class=\"track-metrics-row\">\n          <div class=\"stat-tile\">\n            <div class=\"stat-label\">זמן נטו</div>\n            <div id=\"live-time\" class=\"stat-value tabular\">${formatDuration(elapsedSec) === '—' ? '0:00' : formatDuration(elapsedSec)}</div>\n          </div>\n          <div class=\"stat-tile\">\n            <div class=\"stat-label\">קצב ממוצע</div>\n            <div id=\"live-avg-pace\" class=\"stat-value tabular\">${avgPace ? formatPace(avgPace).replace(\" דק'/ק\\\"מ\", '') : '—'}</div>\n            <div class=\"stat-sub\">דק'/ק\"מ</div>\n          </div>\n          <div class=\"stat-tile\">\n            <div class=\"stat-label\">קצב נוכחי</div>\n            <div id=\"live-cur-pace\" class=\"stat-value tabular\">${state.currentPaceSecPerKm ? formatPace(state.currentPaceSecPerKm).replace(\" דק'/ק\\\"מ\", '') : '—'}</div>\n            <div class=\"stat-sub\">דק'/ק\"מ</div>\n          </div>\n        </div>\n\n        <div class=\"pacer-row\">\n          <span style=\"color:rgba(255,255,255,0.72);font-weight:600;\">\n            ${\n              state.targetPaceSec\n                ? `קצב יעד: <strong class=\"tabular\" style=\"color:#fff;\">${formatPace(state.targetPaceSec).replace(\" דק'/ק\\\"מ\", '')}</strong> · <span id=\"live-pacer-delta\" class=\"pacer-ahead\">מוכן</span>`\n                : 'קצב יעד (Pacer):'\n            }\n          </span>\n          <div class=\"pacer-pills\">\n            ${[\n              [null, 'ללא'],\n              [270, '4:30'],\n              [300, '5:00'],\n              [330, '5:30'],\n              [360, '6:00'],\n              [390, '6:30'],\n            ]\n              .map(\n                ([sec, lbl]) => `\n                  <button type=\"button\" class=\"pacer-chip ${state.targetPaceSec === sec ? 'active' : ''}\" data-pacer=\"${sec === null ? '' : sec}\">${lbl}</button>\n                `\n              )\n              .join('')}\n          </div>\n        </div>\n\n        <div style=\"margin-top:12px;\">\n          <div style=\"display:flex;justify-content:space-between;font-size:0.75rem;color:rgba(255,255,255,0.62);\">\n            <span id=\"live-km-progress-text\" class=\"tabular\">${Math.round(state.distanceM % 1000)} / 1,000 מ׳ לק\"מ הבא</span>\n            <span>${state.phase === 'paused' ? 'מושהה' : state.phase === 'running' ? 'מקליט GPS' : 'מוכן ליציאה'}</span>\n          </div>\n          <div class=\"progress-bar-wrap\">\n            <div id=\"live-km-progress-bar\" class=\"progress-bar-fill\" style=\"width:${Math.min(100, Math.round(((state.distanceM % 1000) / 1000) * 100))}%\"></div>\n          </div>\n        </div>\n\n        <div id=\"live-route-slot\" style=\"margin-top:14px;\">\n          ${renderRouteSvg(state.routeCoords, { dark: true })}\n        </div>\n\n        <div class=\"track-controls\">\n          ${\n            state.phase === 'idle'\n              ? '<button type=\"button\" id=\"btn-track-start\" class=\"btn btn-primary btn-block\" style=\"min-height:50px;font-size:1.05rem;\">▶ התחל ריצה</button>'\n              : state.phase === 'running'\n                ? `\n                  <button type=\"button\" id=\"btn-track-pause\" class=\"btn btn-outline\" style=\"flex:1;min-height:48px;\">⏸ השהה</button>\n                  <button type=\"button\" id=\"btn-track-finish\" class=\"btn btn-primary\" style=\"flex:1;min-height:48px;\">■ סיים ריצה</button>\n                `\n                : `\n                  <button type=\"button\" id=\"btn-track-resume\" class=\"btn btn-primary\" style=\"flex:1;min-height:48px;\">▶ המשך</button>\n                  <button type=\"button\" id=\"btn-track-finish\" class=\"btn btn-outline\" style=\"flex:1;min-height:48px;\">✓ סיים ושמור</button>\n                  <button type=\"button\" id=\"btn-track-cancel\" class=\"btn btn-danger\" style=\"min-height:48px;\">בטל</button>\n                `\n          }\n        </div>\n      </section>\n\n      <section class=\"card\">\n        <div class=\"card-header\">\n          <div>\n            <h2 class=\"card-title\">פיצולי ק\"מ (Splits)</h2>\n            <p class=\"card-subtitle\">כמו בשעון ריצה — קצב לכל קילומטר שלם</p>\n          </div>\n        </div>\n        <div id=\"live-splits-slot\">\n          ${\n            state.splits.length > 0\n              ? renderSplitsTable(state.splits)\n              : '<div class=\"empty-state\">כל קילומטר שלם שיושלם יופיע כאן אוטומטית עם הקצב שלו.</div>'\n          }\n        </div>\n      </section>\n\n      <section class=\"card card-soft\">\n        <h2 class=\"card-title\" style=\"margin-bottom:6px;\">איך מדידת ה-GPS עובדת</h2>\n        <p style=\"margin:0;font-size:0.86rem;color:var(--text-secondary);\">\n          האפליקציה מודדת מרחק, זמן ופיצולים ישירות מ-GPS הטלפון ומאמתת את המסלול בשרת (סינון קפיצות GPS וחישוב מרחק מחדש).\n          <strong>חשוב לדעת בדפדפן בטלפון:</strong> כדי לשמור על רצף GPS מדויק, יש להשאיר את המסך פתוח (אנחנו מפעילים אוטומטית שמירת מסך ער). למדידה עם מסך כבוי בכיס מומלץ לחבר שעון Garmin או Strava.\n        </p>\n      </section>\n    `;\n\n    container.querySelectorAll('[data-pacer]').forEach((btn) => {\n      btn.addEventListener('click', () => {\n        const raw = btn.getAttribute('data-pacer');\n        state.targetPaceSec = raw ? Number(raw) : null;\n        draw();\n      });\n    });\n    container.querySelector('#btn-toggle-sound')?.addEventListener('click', () => {\n      state.soundEnabled = !state.soundEnabled;\n      draw();\n    });\n    container.querySelector('#btn-track-start')?.addEventListener('click', startRun);\n    container.querySelector('#btn-track-pause')?.addEventListener('click', pauseRun);\n    container.querySelector('#btn-track-resume')?.addEventListener('click', resumeRun);\n    container.querySelector('#btn-track-finish')?.addEventListener('click', finishRun);\n    container.querySelector('#btn-track-cancel')?.addEventListener('click', () => {\n      resetRun();\n      showToast('המדידה בוטלה');\n    });\n  }\n\n  draw();\n}\n\n\n// --- public/views/leaderboard.js ---\n\n\n\nasync function renderLeaderboardView(container, app, initialCategory = '5k') {\n  let activeCategory = initialCategory;\n\n  async function load() {\n    container.innerHTML = '<div class=\"loading-box\">טוען טבלת דירוג...</div>';\n    const data = await api.leaderboard(activeCategory);\n    const activeCatObj = data.categories.find((c) => c.key === activeCategory);\n\n    container.innerHTML = `\n      <h1 class=\"page-title\">שיאים ודירוג כללי</h1>\n\n      <div class=\"tabs-scroll\" role=\"tablist\" aria-label=\"קטגוריות דירוג\">\n        ${data.categories\n          .map(\n            (c) => `\n              <button type=\"button\"\n                class=\"tab-pill ${c.key === activeCategory ? 'active' : ''}\"\n                data-cat=\"${escapeHtml(c.key)}\"\n                role=\"tab\"\n                aria-selected=\"${c.key === activeCategory}\">\n                ${escapeHtml(c.short_label)}\n              </button>\n            `\n          )\n          .join('')}\n      </div>\n\n      ${\n        data.requires_email_verification && !data.viewer_email_verified\n          ? `\n            <section class=\"card card-soft\">\n              <h2 class=\"card-title\" style=\"margin-bottom:4px;\">אימות אימייל להופעה בדירוג</h2>\n              <p class=\"card-subtitle\" style=\"margin-bottom:10px;\">כדי למנוע כפילויות וריבוי חשבונות בטבלה, רק חשבונות עם אימייל מאומת נכנסים לדירוג הכללי.</p>\n              <button type=\"button\" class=\"btn btn-primary btn-sm\" id=\"btn-lb-verify-email\">אמת את האימייל שלי עכשיו</button>\n            </section>\n          `\n          : ''\n      }\n\n      <section class=\"card\">\n        <div class=\"card-header\">\n          <div>\n            <h2 class=\"card-title\">טבלת ${escapeHtml(activeCatObj?.label || '')}</h2>\n            <p class=\"card-subtitle\">רק רצים שבחרו להופיע בדירוג הכללי וריצות משותפות (תוצאה אחת לכל רץ)</p>\n          </div>\n          <span class=\"badge badge-neutral tabular\">${data.entries.length} רצים</span>\n        </div>\n\n        ${\n          data.my_entry\n            ? `<div class=\"my-rank-banner\">\n                 <span>המיקום שלך בטבלה זו: <strong class=\"tabular\">#${data.my_entry.rank}</strong></span>\n                 <strong class=\"tabular\">${activeCategory === 'longest' ? formatDistance(data.my_entry.distance_km) : formatDuration(data.my_entry.duration_sec)}</strong>\n               </div>`\n            : ''\n        }\n\n        ${\n          data.entries.length >= 2\n            ? (() => {\n                const top = data.entries.slice(0, 3);\n                const ordered = top.length === 3 ? [top[1], top[0], top[2]] : [top[0], top[1]];\n                const isLongest = activeCategory === 'longest';\n                return `\n                  <div class=\"podium-grid\" style=\"${ordered.length === 2 ? 'grid-template-columns:repeat(2,minmax(0,1fr));' : ''}\">\n                    ${ordered\n                      .map(\n                        (e) => `\n                          <div class=\"podium-card podium-${e.rank}\" data-open-run=\"${escapeHtml(e.run_id)}\" role=\"button\" tabindex=\"0\">\n                            <span class=\"podium-medal tabular\">#${e.rank}</span>\n                            <div class=\"podium-name\">${escapeHtml(e.display_name)}</div>\n                            <div class=\"podium-val tabular\">${isLongest ? formatDistance(e.distance_km) : formatDuration(e.duration_sec)}</div>\n                            <div class=\"lb-sub-val tabular\" style=\"${e.rank === 1 ? 'color:rgba(255,255,255,0.62);' : ''}\">${formatPace(e.pace_sec_per_km)}</div>\n                          </div>\n                        `\n                      )\n                      .join('')}\n                  </div>\n                `;\n              })()\n            : ''\n        }\n\n        ${\n          data.entries.length === 0\n            ? '<div class=\"empty-state\">אין עדיין תוצאות משותפות בטווח הזה. צא לריצה עם GPS או חבר Strava / Garmin כדי לתפוס את המקום הראשון.</div>'\n            : `<div class=\"list-stack\">\n                ${data.entries\n                  .map((entry) => {\n                    const rankClass = entry.rank <= 3 ? `rank-${entry.rank}` : '';\n                    const isLongest = activeCategory === 'longest';\n                    const isMe = app.user && entry.user_id === app.user.id;\n                    return `\n                      <div class=\"lb-row ${isMe ? 'lb-row-me' : ''}\">\n                        <div class=\"lb-rank ${rankClass} tabular\">${entry.rank}</div>\n                        <div class=\"lb-runner\">\n                          <button type=\"button\" class=\"user-name-link lb-name\" data-open-profile=\"${escapeHtml(entry.user_id)}\">\n                            ${escapeHtml(entry.display_name)}${isMe ? ' (אני)' : ''}\n                          </button>\n                          <div class=\"run-badges\" style=\"margin-top:4px;\">\n                            ${renderSourceBadge(entry.source)}\n                            ${entry.is_anomalous_pace ? '<span class=\"badge badge-anomaly\">קצב חריג</span>' : ''}\n                          </div>\n                        </div>\n                        <div class=\"lb-result\" data-open-run=\"${escapeHtml(entry.run_id)}\" role=\"button\" tabindex=\"0\" style=\"cursor:pointer;\">\n                          <div class=\"lb-primary-val tabular\">\n                            ${isLongest ? formatDistance(entry.distance_km) : formatDuration(entry.duration_sec)}\n                          </div>\n                          <div class=\"lb-sub-val tabular\">\n                            ${isLongest ? formatDuration(entry.duration_sec) : formatDistance(entry.distance_km)}\n                            • ${formatPace(entry.pace_sec_per_km)}\n                          </div>\n                          <div class=\"lb-sub-val\">${formatDateHe(entry.ran_at)}</div>\n                        </div>\n                      </div>\n                    `;\n                  })\n                  .join('')}\n              </div>`\n        }\n      </section>\n\n      <!-- Transparent Ranking Rule Explanation (Section 3) -->\n      <section class=\"card card-soft\" id=\"ranking-rule-box\">\n        <div class=\"card-header\" style=\"margin-bottom:6px;\">\n          <h2 class=\"card-title\">${escapeHtml(data.rule.title)}</h2>\n        </div>\n        <p style=\"margin:0 0 8px;font-size:0.88rem;color:var(--text-secondary);\">\n          ${escapeHtml(data.rule.summary)}\n        </p>\n        <div style=\"font-size:0.82rem;color:var(--green-dark);font-weight:600;\">\n          טווח הקטגוריה הנוכחית (${escapeHtml(activeCatObj?.label || '')}):\n          <span class=\"tabular\">${escapeHtml(activeCatObj?.range_text || '')}</span>\n        </div>\n        <p class=\"help-text\" style=\"margin:6px 0 0;\">\n          ${escapeHtml(data.rule.anomaly_note)}\n        </p>\n      </section>\n    `;\n\n    container.querySelectorAll('[data-cat]').forEach((btn) => {\n      btn.addEventListener('click', () => {\n        activeCategory = btn.getAttribute('data-cat');\n        load();\n      });\n    });\n\n    container.querySelector('#btn-lb-verify-email')?.addEventListener('click', () => {\n      app.navigate('#/me');\n    });\n\n    bindRunAndProfileClicks(container, app);\n  }\n\n  await load();\n}\n\n\n// --- public/views/friends.js ---\n\n\nasync function renderFriendsView(container, app) {\n  let searchQuery = '';\n  let searchResults = [];\n\n  async function load() {\n    container.innerHTML = '<div class=\"loading-box\">טוען חברים...</div>';\n    const data = await api.friends();\n    draw(data);\n  }\n\n  function draw(data) {\n    container.innerHTML = `\n      <h1 class=\"page-title\">חברים</h1>\n\n      <!-- Search users by name -->\n      <section class=\"card\">\n        <h2 class=\"card-title\" style=\"margin-bottom:8px;\">חיפוש רצים לפי שם</h2>\n        <form id=\"friend-search-form\" style=\"display:flex;gap:8px;\">\n          <input id=\"friend-search-input\" class=\"input\" type=\"search\" value=\"${escapeHtml(searchQuery)}\" placeholder=\"הקלד שם או שם משתמש...\" />\n          <button type=\"submit\" class=\"btn btn-primary\" style=\"flex-shrink:0;\">חפש</button>\n        </form>\n        <div id=\"friend-search-results\" style=\"margin-top:10px;\">\n          ${renderSearchResults(searchResults, searchQuery)}\n        </div>\n      </section>\n\n      <!-- Incoming requests -->\n      ${\n        data.incoming.length > 0\n          ? `\n            <section class=\"card\">\n              <div class=\"card-header\">\n                <h2 class=\"card-title\">בקשות חברות ממתינות (${data.incoming.length})</h2>\n              </div>\n              <div class=\"list-stack\">\n                ${data.incoming\n                  .map(\n                    (u) => `\n                      <div class=\"user-row\">\n                        <div class=\"user-row-info\">\n                          <div class=\"avatar\">${escapeHtml(initialsOf(u.display_name))}</div>\n                          <div>\n                            <button type=\"button\" class=\"user-name-link\" data-open-profile=\"${escapeHtml(u.id)}\">${escapeHtml(u.display_name)}</button>\n                            <div class=\"user-handle\">@${escapeHtml(u.username)}</div>\n                          </div>\n                        </div>\n                        <div class=\"btn-row\">\n                          <button type=\"button\" class=\"btn btn-primary btn-sm\" data-accept=\"${escapeHtml(u.id)}\">אישור</button>\n                          <button type=\"button\" class=\"btn btn-outline btn-sm\" data-decline=\"${escapeHtml(u.id)}\">דחייה</button>\n                        </div>\n                      </div>\n                    `\n                  )\n                  .join('')}\n              </div>\n            </section>\n          `\n          : ''\n      }\n\n      <!-- Friends list -->\n      <section class=\"card\">\n        <div class=\"card-header\">\n          <h2 class=\"card-title\">החברים שלי (${data.friends.length})</h2>\n        </div>\n        ${\n          data.friends.length === 0\n            ? '<div class=\"empty-state\">עדיין אין חברים ברשימה. חפש רצים למעלה או היכנס לפרופיל מהדירוג והזמן לחברות.</div>'\n            : `<div class=\"list-stack\">\n                ${data.friends\n                  .map(\n                    (f) => `\n                      <div class=\"user-row\">\n                        <div class=\"user-row-info\">\n                          <div class=\"avatar\">${escapeHtml(initialsOf(f.display_name))}</div>\n                          <div style=\"min-width:0;\">\n                            <button type=\"button\" class=\"user-name-link\" data-open-profile=\"${escapeHtml(f.id)}\">${escapeHtml(f.display_name)}</button>\n                            <div class=\"user-handle\">@${escapeHtml(f.username)}</div>\n                          </div>\n                        </div>\n                        <div class=\"btn-row\">\n                          <button type=\"button\" class=\"btn btn-secondary btn-sm\" data-open-profile=\"${escapeHtml(f.id)}\">פרופיל</button>\n                          <button type=\"button\" class=\"btn btn-outline btn-sm\" data-remove=\"${escapeHtml(f.id)}\">הסרה</button>\n                          <button type=\"button\" class=\"btn btn-danger btn-sm\" data-block=\"${escapeHtml(f.id)}\">חסימה</button>\n                        </div>\n                      </div>\n                    `\n                  )\n                  .join('')}\n              </div>`\n        }\n      </section>\n\n      <!-- Outgoing requests -->\n      ${\n        data.outgoing.length > 0\n          ? `\n            <section class=\"card\">\n              <div class=\"card-header\">\n                <h2 class=\"card-title\">בקשות שנשלחו (${data.outgoing.length})</h2>\n              </div>\n              <div class=\"list-stack\">\n                ${data.outgoing\n                  .map(\n                    (u) => `\n                      <div class=\"user-row\">\n                        <div class=\"user-row-info\">\n                          <div class=\"avatar\">${escapeHtml(initialsOf(u.display_name))}</div>\n                          <div>\n                            <button type=\"button\" class=\"user-name-link\" data-open-profile=\"${escapeHtml(u.id)}\">${escapeHtml(u.display_name)}</button>\n                            <div class=\"user-handle\">@${escapeHtml(u.username)} • ממתין לאישור</div>\n                          </div>\n                        </div>\n                        <button type=\"button\" class=\"btn btn-outline btn-sm\" data-remove=\"${escapeHtml(u.id)}\">ביטול</button>\n                      </div>\n                    `\n                  )\n                  .join('')}\n              </div>\n            </section>\n          `\n          : ''\n      }\n\n      <!-- Blocked users -->\n      ${\n        data.blocked.length > 0\n          ? `\n            <section class=\"card\">\n              <div class=\"card-header\">\n                <h2 class=\"card-title\">משתמשים חסומים (${data.blocked.length})</h2>\n              </div>\n              <div class=\"list-stack\">\n                ${data.blocked\n                  .map(\n                    (u) => `\n                      <div class=\"user-row\">\n                        <div class=\"user-row-info\">\n                          <div class=\"avatar\">${escapeHtml(initialsOf(u.display_name))}</div>\n                          <div>\n                            <div style=\"font-weight:700;\">${escapeHtml(u.display_name)}</div>\n                            <div class=\"user-handle\">@${escapeHtml(u.username)}</div>\n                          </div>\n                        </div>\n                        <button type=\"button\" class=\"btn btn-outline btn-sm\" data-unblock=\"${escapeHtml(u.id)}\">ביטול חסימה</button>\n                      </div>\n                    `\n                  )\n                  .join('')}\n              </div>\n            </section>\n          `\n          : ''\n      }\n    `;\n\n    // Bind search\n    container.querySelector('#friend-search-form').addEventListener('submit', async (e) => {\n      e.preventDefault();\n      searchQuery = container.querySelector('#friend-search-input').value.trim();\n      if (!searchQuery) {\n        searchResults = [];\n        draw(data);\n        return;\n      }\n      try {\n        const res = await api.searchUsers(searchQuery);\n        searchResults = res.users || [];\n        draw(data);\n      } catch (err) {\n        showToast(err.message, { error: true });\n      }\n    });\n\n    container.querySelectorAll('[data-open-profile]').forEach((el) => {\n      el.addEventListener('click', () => {\n        app.navigate(`#/user/${encodeURIComponent(el.getAttribute('data-open-profile'))}`);\n      });\n    });\n\n    container.querySelectorAll('[data-invite]').forEach((btn) => {\n      btn.addEventListener('click', async () => {\n        try {\n          const res = await api.sendFriendRequest(btn.getAttribute('data-invite'));\n          showToast(res.message || 'הבקשה נשלחה');\n          if (searchQuery) {\n            const sr = await api.searchUsers(searchQuery);\n            searchResults = sr.users || [];\n          }\n          await load();\n        } catch (err) {\n          showToast(err.message, { error: true });\n        }\n      });\n    });\n\n    container.querySelectorAll('[data-accept]').forEach((btn) => {\n      btn.addEventListener('click', async () => {\n        try {\n          await api.respondFriendRequest(btn.getAttribute('data-accept'), 'accept');\n          showToast('בקשת החברות אושרה!');\n          await load();\n        } catch (err) {\n          showToast(err.message, { error: true });\n        }\n      });\n    });\n\n    container.querySelectorAll('[data-decline]').forEach((btn) => {\n      btn.addEventListener('click', async () => {\n        try {\n          await api.respondFriendRequest(btn.getAttribute('data-decline'), 'decline');\n          showToast('הבקשה נדחתה');\n          await load();\n        } catch (err) {\n          showToast(err.message, { error: true });\n        }\n      });\n    });\n\n    container.querySelectorAll('[data-remove]').forEach((btn) => {\n      btn.addEventListener('click', async () => {\n        try {\n          await api.removeFriend(btn.getAttribute('data-remove'));\n          showToast('הוסר מרשימת החברים וההתראות נוקו');\n          await load();\n        } catch (err) {\n          showToast(err.message, { error: true });\n        }\n      });\n    });\n\n    container.querySelectorAll('[data-block]').forEach((btn) => {\n      btn.addEventListener('click', async () => {\n        try {\n          await api.blockUser(btn.getAttribute('data-block'));\n          showToast('המשתמש נחסם והגישה הוסרה מיד');\n          await load();\n        } catch (err) {\n          showToast(err.message, { error: true });\n        }\n      });\n    });\n\n    container.querySelectorAll('[data-unblock]').forEach((btn) => {\n      btn.addEventListener('click', async () => {\n        try {\n          await api.unblockUser(btn.getAttribute('data-unblock'));\n          showToast('החסימה בוטלה');\n          await load();\n        } catch (err) {\n          showToast(err.message, { error: true });\n        }\n      });\n    });\n  }\n\n  await load();\n}\n\nfunction renderSearchResults(results, query) {\n  if (!query) return '';\n  if (results.length === 0) {\n    return '<div class=\"empty-state\" style=\"padding:10px;\">לא נמצאו רצים בשם הזה.</div>';\n  }\n  return `\n    <div class=\"list-stack\">\n      ${results\n        .map((u) => {\n          let actionBtn = '';\n          if (u.relation === 'none') {\n            actionBtn = `<button type=\"button\" class=\"btn btn-primary btn-sm\" data-invite=\"${escapeHtml(u.id)}\">הזמן לחברות</button>`;\n          } else if (u.relation === 'outgoing_pending') {\n            actionBtn = '<span class=\"badge badge-neutral\">בקשה ממתינה</span>';\n          } else if (u.relation === 'incoming_pending') {\n            actionBtn = `<button type=\"button\" class=\"btn btn-primary btn-sm\" data-accept=\"${escapeHtml(u.id)}\">אשר בקשה</button>`;\n          } else if (u.relation === 'friends') {\n            actionBtn = '<span class=\"badge badge-verified\">חברים</span>';\n          }\n          return `\n            <div class=\"user-row\">\n              <div class=\"user-row-info\">\n                <div class=\"avatar\">${escapeHtml(initialsOf(u.display_name))}</div>\n                <div>\n                  <button type=\"button\" class=\"user-name-link\" data-open-profile=\"${escapeHtml(u.id)}\">${escapeHtml(u.display_name)}</button>\n                  <div class=\"user-handle\">@${escapeHtml(u.username)}</div>\n                </div>\n              </div>\n              <div class=\"btn-row\">\n                ${actionBtn}\n                <button type=\"button\" class=\"btn btn-outline btn-sm\" data-open-profile=\"${escapeHtml(u.id)}\">פרופיל</button>\n              </div>\n            </div>\n          `;\n        })\n        .join('')}\n    </div>\n  `;\n}\n\n\n// --- public/views/groups.js ---\n\n\n\nasync function renderGroupsView(container, app) {\n  let previewData = null;\n  let previewError = '';\n\n  async function load() {\n    container.innerHTML = '<div class=\"loading-box\">טוען קבוצות...</div>';\n    const data = await api.groups();\n    draw(data.groups || []);\n  }\n\n  function draw(groups) {\n    container.innerHTML = `\n      <h1 class=\"page-title\">קבוצות</h1>\n\n      <!-- Join by code with preview -->\n      <section class=\"card\">\n        <h2 class=\"card-title\" style=\"margin-bottom:6px;\">הצטרפות לקבוצה עם קוד</h2>\n        <p class=\"card-subtitle\" style=\"margin-bottom:10px;\">הזן קוד כדי לראות תצוגה מקדימה לפני ההצטרפות</p>\n        <form id=\"group-preview-form\" style=\"display:flex;gap:8px;\">\n          <input id=\"group-code-input\" class=\"input\" type=\"text\" placeholder=\"למשל: RUN5K2\" style=\"text-transform:uppercase;letter-spacing:0.06em;\" />\n          <button type=\"submit\" class=\"btn btn-secondary\" style=\"flex-shrink:0;\">תצוגה מקדימה</button>\n        </form>\n        ${previewError ? `<div class=\"alert-error\" style=\"margin-top:10px;margin-bottom:0;\">${escapeHtml(previewError)}</div>` : ''}\n        ${\n          previewData\n            ? `\n              <div class=\"info-box\" style=\"margin-top:10px;\" id=\"group-preview-box\">\n                <div style=\"display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;\">\n                  <strong style=\"font-size:1rem;color:var(--green-dark);\">${escapeHtml(previewData.name)}</strong>\n                  <span class=\"badge badge-neutral\">${previewData.member_count} חברים</span>\n                </div>\n                ${previewData.description ? `<p style=\"margin:6px 0 8px;\">${escapeHtml(previewData.description)}</p>` : '<div style=\"height:6px;\"></div>'}\n                <div style=\"font-size:0.8rem;color:var(--text-muted);margin-bottom:10px;\">מנהל/ת הקבוצה: ${escapeHtml(previewData.owner_display_name)}</div>\n                ${\n                  previewData.already_member\n                    ? `<button type=\"button\" class=\"btn btn-primary btn-sm\" id=\"btn-open-previewed-group\">אתה כבר חבר — פתח קבוצה</button>`\n                    : `<button type=\"button\" class=\"btn btn-primary btn-sm\" id=\"btn-confirm-join-group\">אישור והצטרפות לקבוצה</button>`\n                }\n              </div>\n            `\n            : ''\n        }\n      </section>\n\n      <!-- My Groups -->\n      <section class=\"card\">\n        <div class=\"card-header\">\n          <h2 class=\"card-title\">הקבוצות שלי (${groups.length})</h2>\n        </div>\n        ${\n          groups.length === 0\n            ? '<div class=\"empty-state\">עדיין לא הצטרפת לקבוצות. צור קבוצה חדשה למטה או הזן קוד הצטרפות.</div>'\n            : `<div class=\"list-stack\">\n                ${groups\n                  .map(\n                    (g) => `\n                      <div class=\"run-item\" data-open-group=\"${escapeHtml(g.id)}\">\n                        <div class=\"run-item-top\">\n                          <strong style=\"color:var(--green-dark);font-size:1.02rem;\">${escapeHtml(g.name)}</strong>\n                          <span class=\"badge badge-neutral\">${g.member_count} חברים</span>\n                        </div>\n                        ${g.description ? `<p class=\"run-note\" style=\"margin-top:4px;\">${escapeHtml(g.description)}</p>` : ''}\n                        <div class=\"run-badges\" style=\"margin-top:8px;align-items:center;\">\n                          <span class=\"join-code-pill\" title=\"קוד הצטרפות\">${escapeHtml(g.join_code)}</span>\n                          ${g.role === 'owner' ? '<span class=\"badge badge-verified\">מנהל קבוצה</span>' : ''}\n                        </div>\n                      </div>\n                    `\n                  )\n                  .join('')}\n              </div>`\n        }\n      </section>\n\n      <!-- Create Group -->\n      <section class=\"card\">\n        <h2 class=\"card-title\" style=\"margin-bottom:10px;\">יצירת קבוצה חדשה</h2>\n        <form id=\"create-group-form\">\n          <div class=\"form-group\">\n            <label class=\"form-label\" for=\"new-group-name\">שם הקבוצה</label>\n            <input id=\"new-group-name\" class=\"input\" type=\"text\" required minlength=\"2\" maxlength=\"50\" placeholder=\"למשל: רצי פארק הירקון\" />\n          </div>\n          <div class=\"form-group\">\n            <label class=\"form-label\" for=\"new-group-desc\">תיאור קצר (אופציונלי)</label>\n            <textarea id=\"new-group-desc\" class=\"textarea\" maxlength=\"300\" placeholder=\"ריצות בוקר רגועות בשישי, כולם מוזמנים...\"></textarea>\n          </div>\n          <button type=\"submit\" class=\"btn btn-primary\">יצירת קבוצה וקבלת קוד הצטרפות</button>\n        </form>\n      </section>\n    `;\n\n    container.querySelector('#group-preview-form').addEventListener('submit', async (e) => {\n      e.preventDefault();\n      const code = container.querySelector('#group-code-input').value.trim().toUpperCase();\n      previewError = '';\n      previewData = null;\n      if (!code) {\n        previewError = 'נא להזין קוד הצטרפות.';\n        draw(groups);\n        return;\n      }\n      try {\n        const res = await api.previewGroup(code);\n        previewData = res.preview;\n        draw(groups);\n      } catch (err) {\n        previewError = err.message || 'לא נמצאה קבוצה.';\n        draw(groups);\n      }\n    });\n\n    const openPrevBtn = container.querySelector('#btn-open-previewed-group');\n    if (openPrevBtn && previewData) {\n      openPrevBtn.addEventListener('click', () => {\n        app.navigate(`#/group/${encodeURIComponent(previewData.id)}`);\n      });\n    }\n\n    const joinBtn = container.querySelector('#btn-confirm-join-group');\n    if (joinBtn && previewData) {\n      joinBtn.addEventListener('click', async () => {\n        try {\n          const res = await api.joinGroup(previewData.join_code);\n          showToast(`הצטרפת לקבוצה \"${res.name}\"!`);\n          previewData = null;\n          app.navigate(`#/group/${encodeURIComponent(res.group_id)}`);\n        } catch (err) {\n          showToast(err.message, { error: true });\n        }\n      });\n    }\n\n    container.querySelectorAll('[data-open-group]').forEach((el) => {\n      el.addEventListener('click', () => {\n        app.navigate(`#/group/${encodeURIComponent(el.getAttribute('data-open-group'))}`);\n      });\n    });\n\n    container.querySelector('#create-group-form').addEventListener('submit', async (e) => {\n      e.preventDefault();\n      const name = container.querySelector('#new-group-name').value.trim();\n      const description = container.querySelector('#new-group-desc').value.trim();\n      try {\n        const res = await api.createGroup({ name, description });\n        showToast(`הקבוצה נוצרה! קוד הצטרפות: ${res.group.join_code}`);\n        app.navigate(`#/group/${encodeURIComponent(res.group.id)}`);\n      } catch (err) {\n        showToast(err.message, { error: true });\n      }\n    });\n  }\n\n  await load();\n}\n\nasync function renderGroupDetailView(container, app, groupId) {\n  let activeCategory = '5k';\n\n  async function load() {\n    container.innerHTML = '<div class=\"loading-box\">טוען קבוצה וטבלת דירוג...</div>';\n    const data = await api.groupDetail(groupId, activeCategory);\n    const g = data.group;\n    const activeCatObj = data.categories.find((c) => c.key === activeCategory);\n\n    container.innerHTML = `\n      <section class=\"card\">\n        <div class=\"card-header\">\n          <div>\n            <h1 class=\"card-title\" style=\"font-size:1.25rem;\">${escapeHtml(g.name)}</h1>\n            ${g.description ? `<p class=\"card-subtitle\">${escapeHtml(g.description)}</p>` : ''}\n          </div>\n          <span class=\"badge badge-neutral\">${g.member_count} חברים</span>\n        </div>\n\n        <div style=\"display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:8px;\">\n          <div>\n            <span style=\"font-size:0.84rem;color:var(--text-muted);margin-left:6px;\">קוד הצטרפות:</span>\n            <span class=\"join-code-pill\" id=\"group-join-code\">${escapeHtml(g.join_code)}</span>\n          </div>\n          <div class=\"btn-row\">\n            <button type=\"button\" class=\"btn btn-secondary btn-sm\" id=\"btn-copy-code\">העתק קוד</button>\n            <button type=\"button\" class=\"btn btn-danger btn-sm\" id=\"btn-leave-group\">עזיבת קבוצה</button>\n          </div>\n        </div>\n      </section>\n\n      <div class=\"tabs-scroll\" role=\"tablist\" aria-label=\"קטגוריות דירוג קבוצה\">\n        ${data.categories\n          .map(\n            (c) => `\n              <button type=\"button\"\n                class=\"tab-pill ${c.key === activeCategory ? 'active' : ''}\"\n                data-cat=\"${escapeHtml(c.key)}\"\n                role=\"tab\"\n                aria-selected=\"${c.key === activeCategory}\">\n                ${escapeHtml(c.short_label)}\n              </button>\n            `\n          )\n          .join('')}\n      </div>\n\n      <section class=\"card\">\n        <div class=\"card-header\">\n          <div>\n            <h2 class=\"card-title\">טבלת דירוג קבוצתית — ${escapeHtml(activeCatObj?.label || '')}</h2>\n            <p class=\"card-subtitle\">טווח: ${escapeHtml(activeCatObj?.range_text || '')} • זמן מדוד ללא נרמול</p>\n          </div>\n        </div>\n\n        ${\n          data.entries.length === 0\n            ? '<div class=\"empty-state\">אין עדיין ריצות משותפות בקטגוריה הזו בקבוצה.</div>'\n            : `<div class=\"list-stack\">\n                ${data.entries\n                  .map((entry) => {\n                    const rankClass = entry.rank <= 3 ? `rank-${entry.rank}` : '';\n                    const isLongest = activeCategory === 'longest';\n                    return `\n                      <div class=\"lb-row\">\n                        <div class=\"lb-rank ${rankClass} tabular\">${entry.rank}</div>\n                        <div class=\"lb-runner\">\n                          <button type=\"button\" class=\"user-name-link lb-name\" data-open-profile=\"${escapeHtml(entry.user_id)}\">\n                            ${escapeHtml(entry.display_name)}\n                          </button>\n                          <div class=\"run-badges\" style=\"margin-top:4px;\">\n                            ${renderSourceBadge(entry.source)}\n                            ${entry.is_anomalous_pace ? '<span class=\"badge badge-anomaly\">קצב חריג</span>' : ''}\n                          </div>\n                        </div>\n                        <div class=\"lb-result\" data-open-run=\"${escapeHtml(entry.run_id)}\" role=\"button\" tabindex=\"0\" style=\"cursor:pointer;\">\n                          <div class=\"lb-primary-val tabular\">\n                            ${isLongest ? formatDistance(entry.distance_km) : formatDuration(entry.duration_sec)}\n                          </div>\n                          <div class=\"lb-sub-val tabular\">\n                            ${isLongest ? formatDuration(entry.duration_sec) : formatDistance(entry.distance_km)}\n                            • ${formatPace(entry.pace_sec_per_km)}\n                          </div>\n                          <div class=\"lb-sub-val\">${formatDateHe(entry.ran_at)}</div>\n                        </div>\n                      </div>\n                    `;\n                  })\n                  .join('')}\n              </div>`\n        }\n      </section>\n\n      <section class=\"card\">\n        <h2 class=\"card-title\" style=\"margin-bottom:10px;\">חברי הקבוצה (${data.members.length})</h2>\n        <div class=\"list-stack\">\n          ${data.members\n            .map(\n              (m) => `\n                <div class=\"user-row\">\n                  <div class=\"user-row-info\">\n                    <div class=\"avatar\">${escapeHtml(initialsOf(m.display_name))}</div>\n                    <div>\n                      <button type=\"button\" class=\"user-name-link\" data-open-profile=\"${escapeHtml(m.id)}\">${escapeHtml(m.display_name)}</button>\n                      <div class=\"user-handle\">@${escapeHtml(m.username)} ${m.role === 'owner' ? '• מנהל/ת' : ''}</div>\n                    </div>\n                  </div>\n                  <button type=\"button\" class=\"btn btn-outline btn-sm\" data-open-profile=\"${escapeHtml(m.id)}\">פרופיל</button>\n                </div>\n              `\n            )\n            .join('')}\n        </div>\n      </section>\n    `;\n\n    container.querySelectorAll('[data-cat]').forEach((btn) => {\n      btn.addEventListener('click', () => {\n        activeCategory = btn.getAttribute('data-cat');\n        load();\n      });\n    });\n\n    container.querySelector('#btn-copy-code').addEventListener('click', async () => {\n      try {\n        await navigator.clipboard.writeText(g.join_code);\n        showToast(`קוד ההצטרפות ${g.join_code} הועתק`);\n      } catch {\n        showToast(`קוד ההצטרפות: ${g.join_code}`);\n      }\n    });\n\n    container.querySelector('#btn-leave-group').addEventListener('click', async () => {\n      try {\n        await api.leaveGroup(g.id);\n        showToast('עזבת את הקבוצה');\n        app.navigate('#/groups');\n      } catch (err) {\n        showToast(err.message, { error: true });\n      }\n    });\n\n    bindRunAndProfileClicks(container, app);\n  }\n\n  await load();\n}\n\n\n// --- public/views/profile.js ---\n\n\n\nasync function renderProfileView(container, app, userId) {\n  container.innerHTML = '<div class=\"loading-box\">טוען פרופיל רץ...</div>';\n  const data = await api.userProfile(userId);\n  const p = data.profile;\n\n  let relationButtons = '';\n  if (!p.is_self) {\n    if (p.relation === 'none') {\n      relationButtons = `<button type=\"button\" class=\"btn btn-primary btn-sm\" id=\"btn-invite-friend\">הזמן לחברות</button>`;\n    } else if (p.relation === 'outgoing_pending') {\n      relationButtons = `<button type=\"button\" class=\"btn btn-outline btn-sm\" id=\"btn-cancel-friend\">בקשה נשלחה (ביטול)</button>`;\n    } else if (p.relation === 'incoming_pending') {\n      relationButtons = `\n        <button type=\"button\" class=\"btn btn-primary btn-sm\" id=\"btn-accept-friend\">אישור חברות</button>\n        <button type=\"button\" class=\"btn btn-outline btn-sm\" id=\"btn-decline-friend\">דחייה</button>\n      `;\n    } else if (p.relation === 'friends') {\n      relationButtons = `\n        <span class=\"badge badge-verified\">חברים</span>\n        <button type=\"button\" class=\"btn btn-outline btn-sm\" id=\"btn-remove-friend\">הסר חבר</button>\n      `;\n    } else if (p.relation === 'blocked_by_me') {\n      relationButtons = `<button type=\"button\" class=\"btn btn-outline btn-sm\" id=\"btn-unblock-user\">ביטול חסימה</button>`;\n    }\n  }\n\n  container.innerHTML = `\n    <section class=\"card\">\n      <div style=\"display:flex;align-items:center;gap:12px;margin-bottom:10px;\">\n        <div class=\"avatar\" style=\"width:48px;height:48px;font-size:1.1rem;\">${escapeHtml(initialsOf(p.display_name))}</div>\n        <div style=\"min-width:0;flex:1;\">\n          <h1 class=\"card-title\" style=\"font-size:1.22rem;\">${escapeHtml(p.display_name)}</h1>\n          <div class=\"user-handle\">@${escapeHtml(p.username)}</div>\n        </div>\n      </div>\n\n      ${p.bio ? `<p style=\"margin:0 0 12px;font-size:0.92rem;color:var(--text-secondary);\">${escapeHtml(p.bio)}</p>` : ''}\n\n      ${\n        !p.is_self\n          ? `\n            <div class=\"btn-row\">\n              ${relationButtons}\n              ${p.relation !== 'blocked_by_me' ? '<button type=\"button\" class=\"btn btn-danger btn-sm\" id=\"btn-block-user\">חסימה</button>' : ''}\n              ${p.relation !== 'blocked_by_me' ? '<button type=\"button\" class=\"btn btn-outline btn-sm\" id=\"btn-report-user\">דיווח על משתמש</button>' : ''}\n            </div>\n          `\n          : '<a href=\"#/me\" class=\"btn btn-secondary btn-sm\">עריכת פרופיל והגדרות פרטיות</a>'\n      }\n    </section>\n\n    <!-- Personal Records (Always all 5 slots, \"—\" when absent or hidden by privacy) -->\n    <section class=\"card\">\n      <div class=\"card-header\">\n        <div>\n          <h2 class=\"card-title\">שיאים אישיים</h2>\n          <p class=\"card-subtitle\">5 ק\"מ, 10 ק\"מ, חצי מרתון, מרתון והריצה הארוכה ביותר</p>\n        </div>\n      </div>\n      ${p.privacy_note ? `<div class=\"info-box\" style=\"margin-bottom:10px;\">${escapeHtml(p.privacy_note)}</div>` : ''}\n      ${renderPersonalRecordsGrid(data.personal_records)}\n    </section>\n\n    <!-- Runs list -->\n    <section class=\"card\">\n      <div class=\"card-header\">\n        <h2 class=\"card-title\">${p.is_self ? 'הריצות שלי' : 'ריצות משותפות'}</h2>\n      </div>\n      ${\n        !p.can_view_runs\n          ? `<div class=\"empty-state\">${escapeHtml(p.privacy_note || 'הריצות אינן זמינות לצפייה.')}</div>`\n          : data.runs.length === 0\n            ? '<div class=\"empty-state\">אין ריצות להצגה.</div>'\n            : `<div class=\"list-stack\">${data.runs.map((r) => renderRunCard(r)).join('')}</div>`\n      }\n    </section>\n  `;\n\n  const bind = (sel, fn) => {\n    const el = container.querySelector(sel);\n    if (el) el.addEventListener('click', fn);\n  };\n\n  bind('#btn-invite-friend', async () => {\n    try {\n      const res = await api.sendFriendRequest(p.id);\n      showToast(res.message || 'בקשת החברות נשלחה');\n      renderProfileView(container, app, userId);\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n\n  bind('#btn-cancel-friend', async () => {\n    try {\n      await api.removeFriend(p.id);\n      showToast('הבקשה בוטלה');\n      renderProfileView(container, app, userId);\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n\n  bind('#btn-accept-friend', async () => {\n    try {\n      await api.respondFriendRequest(p.id, 'accept');\n      showToast('החברות אושרה!');\n      renderProfileView(container, app, userId);\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n\n  bind('#btn-decline-friend', async () => {\n    try {\n      await api.respondFriendRequest(p.id, 'decline');\n      showToast('הבקשה נדחתה');\n      renderProfileView(container, app, userId);\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n\n  bind('#btn-remove-friend', async () => {\n    try {\n      await api.removeFriend(p.id);\n      showToast('החבר הוסר וההתראות נוקו');\n      renderProfileView(container, app, userId);\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n\n  bind('#btn-block-user', async () => {\n    try {\n      await api.blockUser(p.id);\n      showToast('המשתמש נחסם');\n      renderProfileView(container, app, userId);\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n\n  bind('#btn-unblock-user', async () => {\n    try {\n      await api.unblockUser(p.id);\n      showToast('החסימה בוטלה');\n      renderProfileView(container, app, userId);\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n\n  bind('#btn-report-user', () => {\n    openReportModal({ target_type: 'user', target_user_id: p.id, targetLabel: p.display_name });\n  });\n\n  bindRunAndProfileClicks(container, app);\n}\n\nfunction openReportModal({ target_type, target_user_id, target_run_id, targetLabel }) {\n  openModal(\n    `\n      <h3 class=\"card-title\" style=\"margin-bottom:8px;\">\n        דיווח על ${target_type === 'user' ? 'משתמש' : 'ריצה'}: ${escapeHtml(targetLabel)}\n      </h3>\n      <form id=\"report-form\">\n        <div class=\"form-group\">\n          <label class=\"form-label\" for=\"report-reason\">סיבת הדיווח</label>\n          <select id=\"report-reason\" class=\"select\" required>\n            <option value=\"anomalous_result\">תוצאה חריגה / חשד לנתון לא תקין</option>\n            <option value=\"inappropriate_content\">תוכן פוגעני או לא הולם</option>\n            <option value=\"harassment\">הטרדה</option>\n            <option value=\"impersonation\">התחזות</option>\n            <option value=\"other\">אחר</option>\n          </select>\n        </div>\n        <div class=\"form-group\">\n          <label class=\"form-label\" for=\"report-details\">פירוט (אופציונלי)</label>\n          <textarea id=\"report-details\" class=\"textarea\" maxlength=\"500\" placeholder=\"פרט בקצרה מה הפריע לך...\"></textarea>\n        </div>\n        <div class=\"btn-row\">\n          <button type=\"submit\" class=\"btn btn-danger\">שליחת דיווח</button>\n          <button type=\"button\" class=\"btn btn-outline\" id=\"report-cancel\">ביטול</button>\n        </div>\n      </form>\n    `,\n    (root, close) => {\n      root.querySelector('#report-cancel').addEventListener('click', close);\n      root.querySelector('#report-form').addEventListener('submit', async (e) => {\n        e.preventDefault();\n        const reason = root.querySelector('#report-reason').value;\n        const details = root.querySelector('#report-details').value.trim();\n        try {\n          const res = await api.createReport({\n            target_type,\n            target_user_id,\n            target_run_id,\n            reason,\n            details,\n          });\n          close();\n          showToast(res.message || 'הדיווח נשלח');\n        } catch (err) {\n          showToast(err.message, { error: true });\n        }\n      });\n    }\n  );\n}\n\n\n// --- public/views/runDetail.js ---\n\n\n\nasync function renderRunDetailView(container, app, runId) {\n  container.innerHTML = '<div class=\"loading-box\">טוען פרטי ריצה...</div>';\n  const data = await api.getRun(runId);\n  const run = data.run;\n  const hasRoute = Array.isArray(run.route_polyline) && run.route_polyline.length >= 2;\n  const hasSplits = Array.isArray(run.splits) && run.splits.length > 0;\n\n  container.innerHTML = `\n    <section class=\"card\">\n      <div class=\"card-header\">\n        <div>\n          <h1 class=\"card-title\" style=\"font-size:1.22rem;\">פרטי ריצה</h1>\n          <p class=\"card-subtitle\">\n            <button type=\"button\" class=\"user-name-link\" id=\"btn-run-owner\">${escapeHtml(run.owner.display_name)}</button>\n            • ${formatDateTimeHe(run.ran_at)}\n          </p>\n        </div>\n        ${!run.is_shared ? '<span class=\"badge badge-private\">ריצה פרטית (רק לך)</span>' : '<span class=\"badge badge-neutral\">משותפת</span>'}\n      </div>\n\n      <div class=\"stats-grid\">\n        <div class=\"stat-tile\">\n          <div class=\"stat-label\">מרחק שנמדד</div>\n          <div class=\"stat-value tabular\">${formatDistance(run.distance_km)}</div>\n        </div>\n        <div class=\"stat-tile\">\n          <div class=\"stat-label\">זמן שנמדד (ללא נרמול)</div>\n          <div class=\"stat-value tabular\">${formatDuration(run.duration_sec)}</div>\n        </div>\n        <div class=\"stat-tile stat-tile-wide\">\n          <div class=\"stat-label\">קצב ממוצע</div>\n          <div class=\"stat-value tabular\">${formatPace(run.pace_sec_per_km)}</div>\n          ${\n            run.is_anomalous_pace\n              ? '<div style=\"margin-top:6px;\"><span class=\"badge badge-anomaly\">קצב חריג — מסומן לשקיפות ואינו חסום</span></div>'\n              : ''\n          }\n        </div>\n      </div>\n\n      ${\n        hasRoute\n          ? `<div style=\"margin-bottom:14px;\">\n               <div class=\"form-label\">מסלול GPS שנמדד</div>\n               ${renderRouteSvg(run.route_polyline)}\n             </div>`\n          : ''\n      }\n\n      ${\n        hasSplits\n          ? `<div style=\"margin-bottom:14px;\">\n               <div class=\"form-label\">פיצולי ק\"מ (Splits)</div>\n               ${renderSplitsTable(run.splits)}\n             </div>`\n          : ''\n      }\n\n      <!-- Run Measurement Source Provenance -->\n      <div class=\"info-box\" style=\"margin-bottom:12px;\">\n        <div style=\"font-weight:700;margin-bottom:4px;color:var(--green-dark);\">מקור הריצה</div>\n        <div style=\"display:flex;flex-wrap:wrap;gap:6px;align-items:center;\">\n          ${renderSourceBadge(run.source)}\n          ${run.device_name ? `<span class=\"badge badge-neutral\">${escapeHtml(run.device_name)}</span>` : ''}\n          ${run.avg_accuracy_m ? `<span class=\"badge badge-neutral tabular\">דיוק ממוצע ±${run.avg_accuracy_m}מ׳</span>` : ''}\n        </div>\n        <p style=\"margin:6px 0 0;font-size:0.83rem;\">\n          ${\n            run.source.code === 'app_gps'\n              ? 'ריצה זו נמדדה ב-GPS חי בתוך Isrunner וחושבה ואומתה מחדש בשרת מתוך נקודות ה-GPS.'\n              : run.source.verified\n                ? 'ריצה זו נקלטה בנתיב השרת המאומת ממקור מדידה מחובר.'\n                : 'ריצה זו מסומנת בשקיפות כלא מאומתת (היסטורית מדיווח עצמי או הזנה ידנית בספק חיצוני).'\n          }\n        </p>\n      </div>\n\n      ${\n        run.note\n          ? `\n            <div style=\"margin-bottom:14px;\">\n              <div class=\"form-label\">הערה לריצה</div>\n              <div class=\"info-box\" style=\"white-space:pre-wrap;\">${escapeHtml(run.note)}</div>\n            </div>\n          `\n          : ''\n      }\n\n      <div class=\"btn-row\" style=\"margin-bottom:14px;\">\n        <button type=\"button\" id=\"btn-share-run-card\" class=\"btn btn-primary btn-sm\">\n          שתף כרטיס ריצה (וואטסאפ / סטורי)\n        </button>\n      </div>\n\n      ${\n        run.is_owner\n          ? `\n            <div class=\"card card-soft\" style=\"margin-bottom:12px;\">\n              <h2 class=\"card-title\" style=\"font-size:0.98rem;margin-bottom:6px;\">שיתוף הריצה</h2>\n              <p class=\"help-text\" style=\"margin-top:0;margin-bottom:10px;\">\n                ריצה פרטית נראית רק לך: היא לא מופיעה בפרופיל שלך אצל אחרים, לא בשיאים אצל אחרים, לא בדירוגים, ללא קישור ישיר ואי אפשר לדווח עליה.\n              </p>\n              <button type=\"button\" id=\"btn-toggle-share\" class=\"btn ${run.is_shared ? 'btn-outline' : 'btn-primary'} btn-sm\">\n                ${run.is_shared ? 'הפוך לריצה פרטית (הסר משיתוף)' : 'שתף ריצה זו שוב'}\n              </button>\n            </div>\n\n            <form id=\"edit-note-form\" style=\"margin-bottom:14px;\">\n              <div class=\"form-group\">\n                <label class=\"form-label\" for=\"run-note-input\">עריכת הערה (מרחק, זמן ומקור אינם ניתנים לעריכה)</label>\n                <textarea id=\"run-note-input\" class=\"textarea\" maxlength=\"500\" placeholder=\"איך הרגשת בריצה?\">${escapeHtml(run.note || '')}</textarea>\n              </div>\n              <button type=\"submit\" class=\"btn btn-secondary btn-sm\">שמור הערה</button>\n            </form>\n\n            <div style=\"border-top:1px solid var(--green-border);padding-top:12px;\">\n              <button type=\"button\" id=\"btn-delete-run\" class=\"btn btn-danger btn-sm\">מחיקת ריצה לצמיתות</button>\n            </div>\n          `\n          : `\n            <div class=\"btn-row\">\n              <button type=\"button\" id=\"btn-report-run\" class=\"btn btn-outline btn-sm\">דיווח על ריצה זו</button>\n            </div>\n          `\n      }\n    </section>\n  `;\n\n  container.querySelector('#btn-share-run-card')?.addEventListener('click', () => {\n    openShareRunCardModal(run, run.owner?.display_name || '');\n  });\n\n  container.querySelector('#btn-run-owner').addEventListener('click', () => {\n    app.navigate(`#/user/${encodeURIComponent(run.owner.id)}`);\n  });\n\n  if (run.is_owner) {\n    container.querySelector('#btn-toggle-share').addEventListener('click', async () => {\n      try {\n        const nextShared = !run.is_shared;\n        await api.toggleRunShare(run.id, nextShared);\n        showToast(\n          nextShared\n            ? 'הריצה משותפת כעת (בהתאם להגדרות הפרטיות שלך)'\n            : 'הריצה הפכה לפרטית וההתראות עליה הוסרו מיד'\n        );\n        renderRunDetailView(container, app, runId);\n      } catch (err) {\n        showToast(err.message, { error: true });\n      }\n    });\n\n    container.querySelector('#edit-note-form').addEventListener('submit', async (e) => {\n      e.preventDefault();\n      const note = container.querySelector('#run-note-input').value.trim();\n      try {\n        await api.updateRunNote(run.id, note);\n        showToast('ההערה עודכנה');\n        renderRunDetailView(container, app, runId);\n      } catch (err) {\n        showToast(err.message, { error: true });\n      }\n    });\n\n    container.querySelector('#btn-delete-run').addEventListener('click', async () => {\n      try {\n        await api.deleteRun(run.id);\n        showToast('הריצה וההתראות הקשורות אליה נמחקו');\n        app.navigate('#/home');\n      } catch (err) {\n        showToast(err.message, { error: true });\n      }\n    });\n  } else {\n    container.querySelector('#btn-report-run').addEventListener('click', () => {\n      openReportModal({\n        target_type: 'run',\n        target_run_id: run.id,\n        targetLabel: `${formatDistance(run.distance_km)} של ${run.owner.display_name}`,\n      });\n    });\n  }\n}\n\n\n// --- public/views/sources.js ---\n\n\nfunction readHashQuery() {\n  const hash = window.location.hash || '';\n  const idx = hash.indexOf('?');\n  if (idx === -1) return new URLSearchParams();\n  return new URLSearchParams(hash.slice(idx + 1));\n}\n\nasync function renderSourcesView(container, app) {\n  container.innerHTML = '<div class=\"loading-box\">טוען סטטוס מקורות מדידה...</div>';\n  const params = readHashQuery();\n  const connectedParam = params.get('connected');\n  const syncedParam = params.get('synced');\n  const oauthError = params.get('oauth_error');\n\n  if (connectedParam === 'strava') {\n    showToast(\n      syncedParam && Number(syncedParam) > 0\n        ? `Strava חוברה בהצלחה! יובאו ${syncedParam} ריצות.`\n        : 'חשבון Strava חובר בהצלחה!'\n    );\n  } else if (connectedParam === 'garmin_connect') {\n    showToast('חשבון Garmin Connect חובר בהצלחה!');\n  } else if (oauthError) {\n    showToast(`שגיאה בחיבור OAuth: ${oauthError}`, { error: true });\n  }\n\n  const data = await api.sources();\n  const garmin = data.sources.find((s) => s.provider === 'garmin_connect');\n  const strava = data.sources.find((s) => s.provider === 'strava');\n\n  container.innerHTML = `\n    <h1 class=\"page-title\">מקורות מדידה</h1>\n\n    <section class=\"card card-amber\">\n      <h2 class=\"card-title\" style=\"margin-bottom:6px;\">עיקרון האמינות ב-Isrunner</h2>\n      <p style=\"margin:0;font-size:0.9rem;color:var(--text-secondary);\">\n        ריצות חדשות נקלטות <strong>רק</strong> ממקור מדידה אמיתי: חיבור OAuth ישיר ל-Garmin Connect או Strava, או מדידת GPS חיה מתוך האפליקציה עם חישוב ואימות בשרת — ללא הקלדה ידנית של מרחק/זמן.\n      </p>\n    </section>\n\n    <!-- In-App Live GPS Recorder (Works right now on any phone!) -->\n    <section class=\"card hero-card\" id=\"in-app-gps-card\">\n      <div class=\"card-header\">\n        <div>\n          <h2 class=\"card-title\">מדידת ריצה ישירה ב-Isrunner (GPS חי)</h2>\n          <p class=\"card-subtitle\">כמו שעון ריצה — מרחק, זמן, קצב חי, פיצולי ק\"מ ומפת מסלול</p>\n        </div>\n        <span class=\"badge badge-verified\">פעיל עכשיו</span>\n      </div>\n      <p style=\"margin:0 0 12px;font-size:0.88rem;color:rgba(255,255,255,0.78);\">\n        ${escapeHtml(data.in_app_gps?.description || '')}\n        ${data.in_app_gps?.runs_count ? ` (נמדדו עד כה ${data.in_app_gps.runs_count} ריצות).` : ''}\n      </p>\n      <div class=\"btn-row\">\n        <button type=\"button\" class=\"btn btn-primary\" id=\"btn-start-live-gps\">▶ התחל מדידת ריצה (GPS)</button>\n      </div>\n    </section>\n\n    <!-- Strava OAuth 2.0 + Sync -->\n    <section class=\"card\" id=\"strava-source-card\">\n      <div class=\"card-header\">\n        <div>\n          <h2 class=\"card-title\">Strava (כולל ריצות שסונכרנו משעון Garmin)</h2>\n          <p class=\"card-subtitle\">חיבור OAuth 2.0 רשמי + סנכרון ריצות אוטומטי וידני</p>\n        </div>\n        ${\n          strava.connected\n            ? '<span class=\"badge badge-verified\">מחובר</span>'\n            : strava.server_configured\n              ? '<span class=\"badge badge-neutral\">מוכן לחיבור</span>'\n              : '<span class=\"badge badge-legacy\">לא מחובר</span>'\n        }\n      </div>\n\n      <div class=\"info-box\" style=\"margin-bottom:12px;\">\n        <strong>סטטוס נוכחי:</strong> ${escapeHtml(strava.status_label)}<br />\n        <span>${escapeHtml(strava.honest_explanation)}</span>\n      </div>\n\n      ${\n        strava.connected\n          ? `\n            <div class=\"info-box\" style=\"margin-bottom:12px;\">\n              ${strava.connection?.provider_username ? `<div><strong>חשבון מחובר:</strong> <bdi dir=\"ltr\">${escapeHtml(strava.connection.provider_username)}</bdi></div>` : ''}\n              <div><strong>חובר בתאריך:</strong> ${formatDateTimeHe(strava.connection.connected_at)}</div>\n              <div><strong>סנכרון אחרון:</strong> ${strava.connection.last_sync_at ? formatDateTimeHe(strava.connection.last_sync_at) : 'טרם סונכרנו ריצות'}</div>\n              <div><strong>ריצות שנקלטו מ-Strava:</strong> <span class=\"tabular\">${strava.runs_count}</span></div>\n            </div>\n            <div class=\"btn-row\">\n              <button type=\"button\" class=\"btn btn-primary btn-sm\" id=\"btn-sync-strava\">סנכרן ריצות מ-Strava עכשיו</button>\n              <button type=\"button\" class=\"btn btn-outline btn-sm\" id=\"btn-disconnect-strava-keep\">ניתוק (שמירת ריצות)</button>\n              <button type=\"button\" class=\"btn btn-danger btn-sm\" id=\"btn-disconnect-strava-delete\">ניתוק ומחיקת ריצות Strava</button>\n            </div>\n          `\n          : `\n            <div class=\"info-box\" style=\"margin-bottom:12px;\">\n              <div style=\"font-weight:700;color:var(--green-dark);margin-bottom:6px;\">\n                תצוגת הסכמה לפני חיבור Strava (<bdi dir=\"ltr\">${escapeHtml(strava.consent.version)}</bdi>)\n              </div>\n              <ul style=\"margin:0;padding-right:18px;font-size:0.84rem;\">\n                ${strava.consent.data_collected.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}\n                ${strava.consent.data_not_collected.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}\n              </ul>\n            </div>\n\n            <label class=\"checkbox-row\" style=\"margin-bottom:12px;\">\n              <input type=\"checkbox\" id=\"strava-consent-checkbox\" />\n              <span>קראתי ואני מסכים/ה לקליטת ריצות מחשבון ה-Strava שלי (קריאה בלבד).</span>\n            </label>\n\n            <div class=\"btn-row\">\n              <button type=\"button\" id=\"btn-connect-strava\" class=\"btn btn-primary\" ${strava.server_configured ? '' : 'disabled'}>\n                ${strava.server_configured ? 'התחבר עם Strava (OAuth 2.0)' : 'חיבור Strava — ממתין למפתחות API בשרת'}\n              </button>\n            </div>\n            ${\n              !strava.server_configured\n                ? `<p class=\"help-text\" style=\"margin-top:8px;margin-bottom:0;\">\n                     להפעלה ב-2 דקות: צור אפליקציית API ב-<bdi dir=\"ltr\">strava.com/settings/api</bdi>, הזן Callback Domain מתאים, והגדר בשרת את <code>STRAVA_CLIENT_ID</code> ו-<code>STRAVA_CLIENT_SECRET</code>.\n                     כתובת Callback: <code>${escapeHtml(strava.callback_url)}</code>\n                   </p>`\n                : ''\n            }\n          `\n      }\n\n      ${\n        strava.runs_count > 0 && !strava.connected\n          ? `\n            <div style=\"margin-top:12px;border-top:1px solid var(--green-border);padding-top:10px;\">\n              <p class=\"help-text\" style=\"margin-top:0;\">קיימות בחשבונך ${strava.runs_count} ריצות שמקורן ב-Strava.</p>\n              <button type=\"button\" class=\"btn btn-danger btn-sm\" id=\"btn-delete-strava-data\">מחק את כל נתוני Strava שלי</button>\n            </div>\n          `\n          : ''\n      }\n    </section>\n\n    <!-- Primary Source: Garmin Connect OAuth 2.0 PKCE -->\n    <section class=\"card\" id=\"garmin-source-card\">\n      <div class=\"card-header\">\n        <div>\n          <h2 class=\"card-title\">Garmin Connect (שעון או אפליקציה)</h2>\n          <p class=\"card-subtitle\">חיבור OAuth 2.0 (PKCE) + Push Webhook ישיר מגרמין</p>\n        </div>\n        ${\n          garmin.connected\n            ? '<span class=\"badge badge-verified\">מחובר</span>'\n            : garmin.server_configured\n              ? '<span class=\"badge badge-neutral\">מוכן לחיבור</span>'\n              : '<span class=\"badge badge-legacy\">לא מחובר</span>'\n        }\n      </div>\n\n      <div class=\"alert-amber\" style=\"margin-bottom:12px;\">\n        <strong>סטטוס נוכחי:</strong> ${escapeHtml(garmin.status_label)}<br />\n        <span>${escapeHtml(garmin.honest_explanation)}</span>\n      </div>\n\n      ${\n        garmin.connected\n          ? `\n            <div class=\"info-box\" style=\"margin-bottom:12px;\">\n              <div><strong>חובר בתאריך:</strong> ${formatDateTimeHe(garmin.connection.connected_at)}</div>\n              <div><strong>סנכרון אחרון:</strong> ${garmin.connection.last_sync_at ? formatDateTimeHe(garmin.connection.last_sync_at) : 'טרם סונכרנו ריצות'}</div>\n              <div><strong>ריצות שנקלטו מגרמין:</strong> <span class=\"tabular\">${garmin.runs_count}</span></div>\n            </div>\n            <div class=\"btn-row\">\n              <button type=\"button\" class=\"btn btn-outline btn-sm\" id=\"btn-disconnect-keep\">ניתוק חיבור (שמירת ריצות)</button>\n              <button type=\"button\" class=\"btn btn-danger btn-sm\" id=\"btn-disconnect-delete\">ניתוק ומחיקת כל נתוני Garmin</button>\n            </div>\n          `\n          : `\n            <!-- Consent Screen Preview (transparent, never fakes connection) -->\n            <div class=\"info-box\" style=\"margin-bottom:12px;\">\n              <div style=\"font-weight:700;color:var(--green-dark);margin-bottom:6px;\">\n                תצוגת הסכמה לפני חיבור (<bdi dir=\"ltr\">${escapeHtml(garmin.consent.version)}</bdi>)\n              </div>\n              <div style=\"font-size:0.85rem;margin-bottom:6px;\"><strong>מה ייקלט לאחר אישור וחיבור:</strong></div>\n              <ul style=\"margin:0 0 8px;padding-right:18px;font-size:0.84rem;\">\n                ${garmin.consent.data_collected.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}\n              </ul>\n              <div style=\"font-size:0.85rem;margin-bottom:6px;\"><strong>מה לא נקלט:</strong></div>\n              <ul style=\"margin:0 0 8px;padding-right:18px;font-size:0.84rem;\">\n                ${garmin.consent.data_not_collected.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}\n              </ul>\n              <div style=\"font-size:0.85rem;margin-bottom:6px;\"><strong>השליטה שלך:</strong></div>\n              <ul style=\"margin:0;padding-right:18px;font-size:0.84rem;\">\n                ${garmin.consent.user_controls.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}\n              </ul>\n            </div>\n\n            <label class=\"checkbox-row\" style=\"margin-bottom:12px;\">\n              <input type=\"checkbox\" id=\"garmin-consent-checkbox\" />\n              <span>קראתי ואני מסכים/ה לתנאי קליטת הריצות מ-Garmin Connect (פעיל לאחר אישור תוכנית המפתחים של Garmin).</span>\n            </label>\n\n            <div class=\"btn-row\">\n              <button type=\"button\" id=\"btn-connect-garmin\" class=\"btn btn-primary\" ${garmin.server_configured ? '' : 'disabled'}>\n                ${garmin.server_configured ? 'התחבר עם Garmin Connect (OAuth 2.0)' : 'חיבור Garmin לא זמין עדיין (ממתין לאישור ספק)'}\n              </button>\n            </div>\n            ${\n              !garmin.server_configured\n                ? `<p class=\"help-text\" style=\"margin-top:8px;margin-bottom:0;\">\n                     טיוטת הבקשה ל-Garmin Connect Developer Program מוכנה בקובץ <code>docs/garmin-developer-application-draft.md</code>.\n                     כתובת Callback: <code>${escapeHtml(garmin.callback_url)}</code> · Webhook: <code>${escapeHtml(garmin.webhook_url)}</code>\n                   </p>`\n                : ''\n            }\n          `\n      }\n\n      ${\n        garmin.runs_count > 0 && !garmin.connected\n          ? `\n            <div style=\"margin-top:12px;border-top:1px solid var(--green-border);padding-top:10px;\">\n              <p class=\"help-text\" style=\"margin-top:0;\">קיימות בחשבונך ${garmin.runs_count} ריצות שמקורן ב-Garmin Connect.</p>\n              <button type=\"button\" class=\"btn btn-danger btn-sm\" id=\"btn-delete-garmin-data\">מחק את כל נתוני Garmin שלי</button>\n            </div>\n          `\n          : ''\n      }\n    </section>\n\n    <!-- Legacy self-reported runs explanation -->\n    <section class=\"card card-soft\">\n      <h2 class=\"card-title\" style=\"margin-bottom:6px;\">ריצות קיימות מדיווח עצמי</h2>\n      <p style=\"margin:0 0 6px;font-size:0.88rem;color:var(--text-secondary);\">\n        ${escapeHtml(data.legacy_note)}\n      </p>\n      <div style=\"font-size:0.86rem;font-weight:700;color:var(--green-dark);\">\n        ריצות מדיווח עצמי בחשבונך כרגע: <span class=\"tabular\">${data.legacy_runs_count}</span>\n      </div>\n    </section>\n  `;\n\n  container.querySelector('#btn-start-live-gps')?.addEventListener('click', () => {\n    app.navigate('#/track');\n  });\n\n  // Garmin connect / disconnect / delete\n  container.querySelector('#btn-connect-garmin')?.addEventListener('click', async () => {\n    const checked = container.querySelector('#garmin-consent-checkbox')?.checked === true;\n    try {\n      const res = await api.connectGarmin(checked);\n      if (res.authorize_url) {\n        window.location.href = res.authorize_url;\n      }\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n\n  container.querySelector('#btn-disconnect-keep')?.addEventListener('click', async () => {\n    try {\n      const res = await api.disconnectSource('garmin_connect', false);\n      showToast(res.message);\n      renderSourcesView(container, app);\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n\n  container.querySelector('#btn-disconnect-delete')?.addEventListener('click', async () => {\n    try {\n      const res = await api.disconnectSource('garmin_connect', true);\n      showToast(res.message);\n      renderSourcesView(container, app);\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n\n  container.querySelector('#btn-delete-garmin-data')?.addEventListener('click', async () => {\n    try {\n      const res = await api.deleteSourceData('garmin_connect');\n      showToast(res.message);\n      renderSourcesView(container, app);\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n\n  // Strava connect / sync / disconnect / delete\n  container.querySelector('#btn-connect-strava')?.addEventListener('click', async () => {\n    const checked = container.querySelector('#strava-consent-checkbox')?.checked === true;\n    try {\n      const res = await api.connectStrava(checked);\n      if (res.authorize_url) {\n        window.location.href = res.authorize_url;\n      }\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n\n  container.querySelector('#btn-sync-strava')?.addEventListener('click', async () => {\n    const btn = container.querySelector('#btn-sync-strava');\n    if (btn) {\n      btn.disabled = true;\n      btn.textContent = 'מסנכרן מ-Strava...';\n    }\n    try {\n      const res = await api.syncStrava();\n      showToast(res.message);\n      renderSourcesView(container, app);\n    } catch (err) {\n      if (btn) {\n        btn.disabled = false;\n        btn.textContent = 'סנכרן ריצות מ-Strava עכשיו';\n      }\n      showToast(err.message, { error: true });\n    }\n  });\n\n  container.querySelector('#btn-disconnect-strava-keep')?.addEventListener('click', async () => {\n    try {\n      const res = await api.disconnectSource('strava', false);\n      showToast(res.message);\n      renderSourcesView(container, app);\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n\n  container.querySelector('#btn-disconnect-strava-delete')?.addEventListener('click', async () => {\n    try {\n      const res = await api.disconnectSource('strava', true);\n      showToast(res.message);\n      renderSourcesView(container, app);\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n\n  container.querySelector('#btn-delete-strava-data')?.addEventListener('click', async () => {\n    try {\n      const res = await api.deleteSourceData('strava');\n      showToast(res.message);\n      renderSourcesView(container, app);\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n}\n\n\n// --- public/views/resources.js ---\n\n\nasync function renderResourcesView(container) {\n  container.innerHTML = '<div class=\"loading-box\">טוען דף משאבים...</div>';\n  const data = await api.resources();\n\n  container.innerHTML = `\n    <h1 class=\"page-title\">משאבים לרצים</h1>\n\n    <!-- Warm-up -->\n    <section class=\"card\">\n      <h2 class=\"card-title\">${escapeHtml(data.warmup.title)}</h2>\n      <p class=\"card-subtitle\" style=\"margin-bottom:10px;\">${escapeHtml(data.warmup.note)}</p>\n      <div class=\"list-stack\">\n        ${data.warmup.steps\n          .map(\n            (st, i) => `\n              <div class=\"info-box\">\n                <div style=\"display:flex;justify-content:space-between;gap:8px;align-items:baseline;\">\n                  <strong style=\"color:var(--green-dark);\">${i + 1}. ${escapeHtml(st.name)}</strong>\n                  <span class=\"badge badge-neutral\">${escapeHtml(st.duration)}</span>\n                </div>\n                <div style=\"font-size:0.84rem;margin-top:4px;\">${escapeHtml(st.detail)}</div>\n              </div>\n            `\n          )\n          .join('')}\n      </div>\n    </section>\n\n    <!-- Cool-down -->\n    <section class=\"card\">\n      <h2 class=\"card-title\">${escapeHtml(data.cooldown.title)}</h2>\n      <p class=\"card-subtitle\" style=\"margin-bottom:10px;\">${escapeHtml(data.cooldown.note)}</p>\n      <div class=\"list-stack\">\n        ${data.cooldown.steps\n          .map(\n            (st, i) => `\n              <div class=\"info-box\">\n                <div style=\"display:flex;justify-content:space-between;gap:8px;align-items:baseline;\">\n                  <strong style=\"color:var(--green-dark);\">${i + 1}. ${escapeHtml(st.name)}</strong>\n                  <span class=\"badge badge-neutral\">${escapeHtml(st.duration)}</span>\n                </div>\n                <div style=\"font-size:0.84rem;margin-top:4px;\">${escapeHtml(st.detail)}</div>\n              </div>\n            `\n          )\n          .join('')}\n      </div>\n    </section>\n\n    <!-- Instructional Videos -->\n    <section class=\"card\">\n      <h2 class=\"card-title\" style=\"margin-bottom:10px;\">סרטוני הדרכה מומלצים</h2>\n      <div class=\"list-stack\">\n        ${data.videos\n          .map(\n            (v) => `\n              <div class=\"info-box\">\n                <div style=\"display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:4px;\">\n                  <strong style=\"color:var(--green-dark);\">${escapeHtml(v.title)}</strong>\n                  <span class=\"badge badge-neutral\">${escapeHtml(v.duration)} • ${escapeHtml(v.level)}</span>\n                </div>\n                <div style=\"font-size:0.85rem;\">${escapeHtml(v.summary)}</div>\n              </div>\n            `\n          )\n          .join('')}\n      </div>\n    </section>\n\n    <!-- Podcasts -->\n    <section class=\"card\">\n      <h2 class=\"card-title\" style=\"margin-bottom:10px;\">פודקאסטים לריצה</h2>\n      <div class=\"list-stack\">\n        ${data.podcasts\n          .map(\n            (p) => `\n              <div class=\"info-box\">\n                <strong style=\"color:var(--green-dark);display:block;margin-bottom:3px;\">${escapeHtml(p.title)}</strong>\n                <div style=\"font-size:0.83rem;color:var(--text-muted);margin-bottom:4px;\">${escapeHtml(p.host)}</div>\n                <div style=\"font-size:0.86rem;margin-bottom:4px;\">${escapeHtml(p.topic)}</div>\n                <div style=\"font-size:0.82rem;color:var(--green-primary);font-weight:600;\">טיפ: ${escapeHtml(p.tip)}</div>\n              </div>\n            `\n          )\n          .join('')}\n      </div>\n    </section>\n\n    <!-- Garmin & Running App Ideas for Owner to Choose -->\n    <section class=\"card card-soft\" id=\"product-ideas-section\">\n      <h2 class=\"card-title\">${escapeHtml(data.product_ideas.title)}</h2>\n      <p class=\"card-subtitle\" style=\"margin-bottom:10px;\">${escapeHtml(data.product_ideas.subtitle)}</p>\n      <div class=\"list-stack\">\n        ${data.product_ideas.items\n          .map(\n            (idea) => `\n              <div class=\"info-box\" style=\"background:#ffffff;\">\n                <div style=\"display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:4px;\">\n                  <strong style=\"color:var(--green-dark);\">${escapeHtml(idea.title)}</strong>\n                  <span class=\"badge badge-neutral\">השראה: ${escapeHtml(idea.inspired_by)}</span>\n                </div>\n                <div style=\"font-size:0.85rem;margin-bottom:4px;\">${escapeHtml(idea.benefit)}</div>\n                <div style=\"font-size:0.78rem;color:var(--text-muted);\">מורכבות משוערת: ${escapeHtml(idea.complexity)}</div>\n              </div>\n            `\n          )\n          .join('')}\n      </div>\n    </section>\n  `;\n}\n\n\n// --- public/views/privacy.js ---\nfunction renderPrivacyView(container) {\n  container.innerHTML = `\n    <h1 class=\"page-title\">מדיניות פרטיות (טיוטה מקומית)</h1>\n\n    <section class=\"card card-amber\">\n      <h2 class=\"card-title\" style=\"margin-bottom:6px;\">סטטוס מסמך</h2>\n      <p style=\"margin:0;font-size:0.9rem;color:var(--text-secondary);\">\n        זו טיוטת מדיניות פרטיות להכנה מקומית בלבד. לפני עלייה לאוויר ולפני הגשת בקשת Garmin, בעל השירות ימלא את פרטיו האישיים ויאשר את הנוסח הסופי.\n      </p>\n    </section>\n\n    <section class=\"card\">\n      <h2 class=\"card-title\" style=\"margin-bottom:8px;\">1. מפעיל השירות ויצירת קשר</h2>\n      <div class=\"info-box\">\n        <div><strong>שם בעל השירות:</strong> [למילוי על ידך לפני עלייה לאוויר]</div>\n        <div><strong>אימייל לפניות פרטיות ומחיקה:</strong> [למילוי על ידך לפני עלייה לאוויר]</div>\n        <div><strong>גיל מינימום מומלץ:</strong> 18+ (מפחית מורכבות משפטית של הסכמת הורים ומתאים לתנאי ספקי מדידה כמו Garmin).</div>\n      </div>\n    </section>\n\n    <section class=\"card\">\n      <h2 class=\"card-title\" style=\"margin-bottom:8px;\">2. איזה מידע נשמר ב-Isrunner</h2>\n      <ul style=\"margin:0;padding-right:18px;font-size:0.9rem;color:var(--text-secondary);\">\n        <li>פרטי חשבון: שם משתמש, שם תצוגה, תיאור קצר, סיסמה מוצפנת (PBKDF2 עם סולט), וכתובת אימייל (אם הוזנה — לאימות ושחזור סיסמה בלבד).</li>\n        <li>נתוני ריצה: מרחק, זמן מדידה, תאריך, הערה אופציונלית, הגדרת שיתוף ומקור הריצה.</li>\n        <li>קשרים חברתיים: חברים, חסימות, חברות בקבוצות, התראות בתוך האפליקציה ודיווחים.</li>\n        <li>בעתיד (רק לאחר אישור Garmin והסכמה מפורשת שלך): פרטי חיבור OAuth ומזהי פעילות מ-Garmin Connect.</li>\n      </ul>\n    </section>\n\n    <section class=\"card\">\n      <h2 class=\"card-title\" style=\"margin-bottom:8px;\">3. שליטה, ייצוא ומחיקת חשבון</h2>\n      <ul style=\"margin:0;padding-right:18px;font-size:0.9rem;color:var(--text-secondary);\">\n        <li><strong>פרטיות גמישה:</strong> ניתן לבחור בכל רגע בין \"כולם\", \"חברים בלבד\" או \"אף אחד\", להחליט אם להופיע בדירוג הכללי, ולהפוך כל ריצה בודדת לפרטית.</li>\n        <li><strong>ניתוק מקור מדידה:</strong> ניתן לנתק מקור מדידה ולמחוק את כל הריצות שנקלטו ממנו בכל עת.</li>\n        <li><strong>ייצוא נתונים:</strong> ניתן להוריד עותק JSON של נתוני החשבון והריצות שלך ממסך \"אני\".</li>\n        <li><strong>מחיקת חשבון:</strong> מוחקת לצמיתות את החשבון, הריצות, החברויות, ההתראות וחיבורי הספק. דיווחים קיימים עוברים אנונימיזציה (ללא שם המשתמש) לשמירת בטיחות הקהילה, שם המשתמש נשמר תפוס (כ-hash בלבד) למניעת התחזות, וניהול קבוצה עובר אוטומטית לחבר הוותיק ביותר.</li>\n      </ul>\n    </section>\n  `;\n}\n\n\n// --- public/views/me.js ---\n\n\n\nasync function renderMeView(container, app) {\n  container.innerHTML = '<div class=\"loading-box\">טוען פרופיל והגדרות...</div>';\n  const [profileData, sourcesData] = await Promise.all([\n    api.userProfile(app.user.id),\n    api.sources(),\n  ]);\n  const u = app.user;\n  const garmin = sourcesData.sources.find((s) => s.provider === 'garmin_connect');\n\n  container.innerHTML = `\n    <h1 class=\"page-title\">אני והגדרות</h1>\n\n    <!-- Quick Profile Header -->\n    <section class=\"card\">\n      <div style=\"display:flex;align-items:center;gap:12px;margin-bottom:12px;\">\n        <div class=\"avatar\" style=\"width:48px;height:48px;font-size:1.1rem;\">${escapeHtml(initialsOf(u.display_name))}</div>\n        <div style=\"min-width:0;flex:1;\">\n          <strong style=\"font-size:1.1rem;color:var(--green-dark);display:block;\">${escapeHtml(u.display_name)}</strong>\n          <span class=\"user-handle\">@${escapeHtml(u.username)}</span>\n        </div>\n      </div>\n      <div class=\"btn-row\">\n        <button type=\"button\" class=\"btn btn-secondary btn-sm\" id=\"btn-go-sources\">\n          מקורות מדידה (${garmin?.connected ? 'מחובר' : 'לא מחובר'})\n        </button>\n        <button type=\"button\" class=\"btn btn-secondary btn-sm\" id=\"btn-go-resources\">\n          משאבים וחימום/שחרור\n        </button>\n        <button type=\"button\" class=\"btn btn-outline btn-sm\" id=\"btn-view-my-profile\">\n          הפרופיל שלי\n        </button>\n      </div>\n    </section>\n\n    ${\n      u.email && !u.email_verified && app.emailVerificationEnabled\n        ? `\n          <section class=\"card\" id=\"email-verify-card\">\n            <div class=\"card-header\">\n              <div>\n                <h2 class=\"card-title\">אימות אימייל להשתתפות בדירוג</h2>\n                <p class=\"card-subtitle\">אימות קוד חד-פעמי אל ${escapeHtml(u.email)} מונע חשבונות כפולים בדירוג הכללי.</p>\n              </div>\n              <span class=\"badge badge-unverified\">ממתין לאימות</span>\n            </div>\n            <div class=\"btn-row\" style=\"margin-bottom:10px;\">\n              <button type=\"button\" class=\"btn btn-secondary btn-sm\" id=\"btn-send-email-code\">שלח קוד בן 6 ספרות למייל</button>\n            </div>\n            <form id=\"verify-email-form\" style=\"display:flex;gap:8px;flex-wrap:wrap;\">\n              <input id=\"email-otp-input\" class=\"input tabular\" dir=\"ltr\" inputmode=\"numeric\" maxlength=\"6\" placeholder=\"123456\" style=\"flex:1;min-width:140px;letter-spacing:0.18em;text-align:center;\" />\n              <button type=\"submit\" class=\"btn btn-primary btn-sm\" id=\"btn-verify-email-code\">אמת אימייל</button>\n            </form>\n          </section>\n        `\n        : ''\n    }\n\n    <!-- My Personal Records -->\n    <section class=\"card\">\n      <h2 class=\"card-title\" style=\"margin-bottom:10px;\">השיאים האישיים שלי</h2>\n      ${renderPersonalRecordsGrid(profileData.personal_records)}\n    </section>\n\n    <!-- Privacy & Leaderboard Settings -->\n    <section class=\"card\" id=\"privacy-settings-card\">\n      <h2 class=\"card-title\" style=\"margin-bottom:4px;\">פרטיות הריצות והדירוג</h2>\n      <p class=\"card-subtitle\" style=\"margin-bottom:12px;\">נאכף בשרת בכל קריאה. תמיד אפשר גם להפוך ריצה בודדת לפרטית.</p>\n\n      <form id=\"settings-form\">\n        <div class=\"form-group\">\n          <div class=\"form-label\">מי יכול לראות את הריצות המשותפות והשיאים שלי?</div>\n\n          <label class=\"radio-option\">\n            <input type=\"radio\" name=\"run_privacy\" value=\"everyone\" ${u.run_privacy === 'everyone' ? 'checked' : ''} />\n            <div>\n              <div class=\"radio-title\">כולם</div>\n              <div class=\"radio-desc\">כל מי שרואה ריצה שלך ומתלהב יכול להיכנס לפרופיל שלך ולראות את כל הריצות המשותפות והשיאים.</div>\n            </div>\n          </label>\n\n          <label class=\"radio-option\">\n            <input type=\"radio\" name=\"run_privacy\" value=\"friends\" ${u.run_privacy === 'friends' ? 'checked' : ''} />\n            <div>\n              <div class=\"radio-title\">חברים בלבד</div>\n              <div class=\"radio-desc\">רק חברים מאושרים יכולים לראות את הריצות המשותפות והשיאים שלך.</div>\n            </div>\n          </label>\n\n          <label class=\"radio-option\">\n            <input type=\"radio\" name=\"run_privacy\" value=\"none\" ${u.run_privacy === 'none' ? 'checked' : ''} />\n            <div>\n              <div class=\"radio-title\">אף אחד</div>\n              <div class=\"radio-desc\">רק אתה רואה את הריצות והשיאים שלך. בחירה זו מסירה מיד גם התראות קיימות אצל חברים.</div>\n            </div>\n          </label>\n        </div>\n\n        <div class=\"form-group\">\n          <label class=\"checkbox-row\">\n            <input type=\"checkbox\" id=\"show-global-lb\" ${u.show_in_global_leaderboard ? 'checked' : ''} />\n            <span><strong>להופיע בדירוג הכללי</strong> (בכפוף לפרטיות הריצות ולריצות משותפות)</span>\n          </label>\n        </div>\n\n        <hr style=\"border:none;border-top:1px solid var(--green-border);margin:14px 0;\" />\n\n        <div class=\"form-group\">\n          <label class=\"form-label\" for=\"set-display-name\">שם תצוגה</label>\n          <input id=\"set-display-name\" class=\"input\" type=\"text\" required minlength=\"2\" maxlength=\"40\" value=\"${escapeHtml(u.display_name)}\" />\n        </div>\n\n        <div class=\"form-group\">\n          <label class=\"form-label\" for=\"set-email\" style=\"display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;\">\n            <span>אימייל אישי (חובה — מונע כפילויות בדירוג)</span>\n            ${\n              u.email\n                ? u.email_verified\n                  ? '<span class=\"badge badge-verified\">מאומת</span>'\n                  : '<span class=\"badge badge-neutral\">טרם אומת</span>'\n                : ''\n            }\n          </label>\n          <input id=\"set-email\" class=\"input\" type=\"email\" ${u.email ? 'required' : ''} value=\"${escapeHtml(u.email || '')}\" placeholder=\"name@example.com\" />\n        </div>\n\n        <div class=\"form-group\">\n          <label class=\"form-label\" for=\"set-bio\">תיאור קצר (אופציונלי)</label>\n          <textarea id=\"set-bio\" class=\"textarea\" maxlength=\"200\" placeholder=\"למשל: רץ 10 ק\"מ בפארק הירקון...\">${escapeHtml(u.bio || '')}</textarea>\n        </div>\n\n        <div class=\"form-group\">\n          <label class=\"form-label\" for=\"set-weekly-goal\">יעד ק\"מ שבועי (אופציונלי)</label>\n          <input id=\"set-weekly-goal\" class=\"input\" type=\"number\" step=\"0.5\" min=\"1\" max=\"500\" value=\"${u.weekly_goal_km ?? ''}\" placeholder=\"ללא יעד\" />\n        </div>\n\n        <button type=\"submit\" class=\"btn btn-primary\" id=\"btn-save-settings\">שמירת הגדרות</button>\n      </form>\n    </section>\n\n    <!-- Data Export, Privacy Draft & Account Deletion -->\n    <section class=\"card card-soft\">\n      <h2 class=\"card-title\" style=\"margin-bottom:6px;\">נתונים, מדיניות וחשבון</h2>\n      <p class=\"help-text\" style=\"margin-top:0;margin-bottom:10px;\">\n        טיוטת מדיניות הפרטיות (גיל 18+) ומחיקת החשבון פועלות כאן לבדיקה מקומית בלבד — לפני עלייה לאוויר יש למלא את פרטי בעל השירות ולאשר.\n      </p>\n      <div class=\"btn-row\">\n        <button type=\"button\" class=\"btn btn-outline btn-sm\" id=\"btn-change-password\">החלפת סיסמה</button>\n        <button type=\"button\" class=\"btn btn-outline btn-sm\" id=\"btn-go-privacy\">טיוטת מדיניות פרטיות</button>\n        <button type=\"button\" class=\"btn btn-outline btn-sm\" id=\"btn-export-data\">ייצוא הנתונים שלי (JSON)</button>\n        <button type=\"button\" class=\"btn btn-outline btn-sm\" id=\"btn-logout\">התנתקות</button>\n        <button type=\"button\" class=\"btn btn-outline btn-sm\" id=\"btn-logout-all\">התנתקות מכל המכשירים</button>\n        <button type=\"button\" class=\"btn btn-danger btn-sm\" id=\"btn-delete-account\">מחיקת חשבון</button>\n      </div>\n    </section>\n  `;\n\n  container.querySelector('#btn-send-email-code')?.addEventListener('click', async () => {\n    try {\n      const res = await api.sendEmailCode();\n      showToast(res.message || 'קוד האימות נשלח למייל');\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n\n  container.querySelector('#verify-email-form')?.addEventListener('submit', async (e) => {\n    e.preventDefault();\n    const code = container.querySelector('#email-otp-input').value.trim();\n    try {\n      const res = await api.verifyEmailCode(code);\n      if (res.user) app.setUser(res.user);\n      showToast(res.message || 'האימייל אומת בהצלחה!');\n      renderMeView(container, app);\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n\n  container.querySelector('#btn-go-sources').addEventListener('click', () => app.navigate('#/sources'));\n  container.querySelector('#btn-go-resources').addEventListener('click', () => app.navigate('#/resources'));\n  container.querySelector('#btn-go-privacy').addEventListener('click', () => app.navigate('#/privacy'));\n  container.querySelector('#btn-view-my-profile').addEventListener('click', () =>\n    app.navigate(`#/user/${encodeURIComponent(u.id)}`)\n  );\n\n  container.querySelector('#btn-change-password').addEventListener('click', () => {\n    openModal(\n      `\n        <h3 class=\"card-title\" style=\"margin-bottom:8px;\">החלפת סיסמה</h3>\n        <p class=\"help-text\" style=\"margin-top:0;margin-bottom:10px;\">\n          החלפת הסיסמה תנתק אוטומטית מכשירים אחרים שמחוברים לחשבונך.\n        </p>\n        <form id=\"change-pw-form\">\n          <div class=\"form-group\">\n            <label class=\"form-label\" for=\"cur-pw\">סיסמה נוכחית</label>\n            <input id=\"cur-pw\" class=\"input\" type=\"password\" required autocomplete=\"current-password\" />\n          </div>\n          <div class=\"form-group\">\n            <label class=\"form-label\" for=\"new-pw\">סיסמה חדשה (לפחות 8 תווים)</label>\n            <input id=\"new-pw\" class=\"input\" type=\"password\" required minlength=\"8\" autocomplete=\"new-password\" />\n          </div>\n          <div class=\"btn-row\">\n            <button type=\"submit\" class=\"btn btn-primary\">עדכון סיסמה</button>\n            <button type=\"button\" class=\"btn btn-outline\" id=\"chpw-cancel\">ביטול</button>\n          </div>\n        </form>\n      `,\n      (root, close) => {\n        root.querySelector('#chpw-cancel').addEventListener('click', close);\n        root.querySelector('#change-pw-form').addEventListener('submit', async (e) => {\n          e.preventDefault();\n          const cur = root.querySelector('#cur-pw').value;\n          const next = root.querySelector('#new-pw').value;\n          try {\n            const res = await api.changePassword(cur, next);\n            close();\n            showToast(res.message || 'הסיסמה עודכנה');\n          } catch (err) {\n            showToast(err.message, { error: true });\n          }\n        });\n      }\n    );\n  });\n\n  container.querySelector('#btn-logout-all').addEventListener('click', async () => {\n    try {\n      const res = await api.logoutAll();\n      app.setUser(null);\n      app.setUnreadCount(0);\n      showToast(res.message || 'התנתקת מכל המכשירים');\n      app.navigate('#/auth');\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n\n  container.querySelector('#settings-form').addEventListener('submit', async (e) => {\n    e.preventDefault();\n    const run_privacy = container.querySelector('input[name=\"run_privacy\"]:checked')?.value;\n    const show_in_global_leaderboard = container.querySelector('#show-global-lb').checked;\n    const display_name = container.querySelector('#set-display-name').value.trim();\n    const email = container.querySelector('#set-email').value.trim();\n    const bio = container.querySelector('#set-bio').value.trim();\n    const goalRaw = container.querySelector('#set-weekly-goal').value.trim();\n    const weekly_goal_km = goalRaw === '' ? null : Number(goalRaw);\n\n    try {\n      const res = await api.updateSettings({\n        run_privacy,\n        show_in_global_leaderboard,\n        display_name,\n        email,\n        bio,\n        weekly_goal_km,\n      });\n      app.setUser(res.user);\n      showToast('ההגדרות נשמרו בהצלחה');\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n\n  container.querySelector('#btn-export-data').addEventListener('click', async () => {\n    try {\n      const exported = await api.exportMyData();\n      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });\n      const url = URL.createObjectURL(blob);\n      const a = document.createElement('a');\n      a.href = url;\n      a.download = `isrunner-${u.username}-export.json`;\n      a.click();\n      URL.revokeObjectURL(url);\n      showToast('קובץ ייצוא הנתונים הורד');\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n\n  container.querySelector('#btn-logout').addEventListener('click', async () => {\n    try {\n      await api.logout();\n      app.setUser(null);\n      app.setUnreadCount(0);\n      showToast('התנתקת מהחשבון');\n      app.navigate('#/auth');\n    } catch (err) {\n      showToast(err.message, { error: true });\n    }\n  });\n\n  container.querySelector('#btn-delete-account').addEventListener('click', () => {\n    openModal(\n      `\n        <h3 class=\"card-title\" style=\"margin-bottom:8px;color:var(--red-text);\">מחיקת חשבון לצמיתות</h3>\n        <div class=\"info-box\" style=\"margin-bottom:12px;\">\n          <ul style=\"margin:0;padding-right:18px;font-size:0.84rem;\">\n            <li>כל הריצות, החברויות, ההתראות וחיבורי הספק שלך יימחקו.</li>\n            <li>דיווחים קיימים עוברים לאנונימיזציה (ללא שמך) לצורכי בקרה.</li>\n            <li>שם המשתמש שלך נשמר תפוס (כ-hash) למניעת התחזות.</li>\n            <li>קבוצות שאתה מנהל עוברות אוטומטית לחבר הוותיק ביותר.</li>\n          </ul>\n        </div>\n        <form id=\"delete-account-form\">\n          <div class=\"form-group\">\n            <label class=\"form-label\" for=\"del-acct-pw\">הזן את הסיסמה הנוכחית לאישור</label>\n            <input id=\"del-acct-pw\" class=\"input\" type=\"password\" required autocomplete=\"current-password\" />\n          </div>\n          <div class=\"btn-row\">\n            <button type=\"submit\" class=\"btn btn-danger\">אישור מחיקת חשבון</button>\n            <button type=\"button\" class=\"btn btn-outline\" id=\"del-acct-cancel\">ביטול</button>\n          </div>\n        </form>\n      `,\n      (root, close) => {\n        root.querySelector('#del-acct-cancel').addEventListener('click', close);\n        root.querySelector('#delete-account-form').addEventListener('submit', async (e) => {\n          e.preventDefault();\n          const pw = root.querySelector('#del-acct-pw').value;\n          try {\n            await api.deleteMyAccount(pw);\n            close();\n            app.setUser(null);\n            app.setUnreadCount(0);\n            showToast('החשבון נמחק לצמיתות');\n            app.navigate('#/auth');\n          } catch (err) {\n            showToast(err.message, { error: true });\n          }\n        });\n      }\n    );\n  });\n\n  bindRunAndProfileClicks(container, app);\n}\n\n\n// --- public/app.js ---\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nconst NAV_TABS = [\n  {\n    key: 'home',\n    label: 'בית',\n    hash: '#/home',\n    icon: '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\"><path d=\"M3 10.5L12 3l9 7.5\"/><path d=\"M5 9.5V20h14V9.5\"/></svg>',\n  },\n  {\n    key: 'leaderboard',\n    label: 'שיאים',\n    hash: '#/leaderboard',\n    icon: '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\"><path d=\"M8 21h8\"/><path d=\"M12 17v4\"/><path d=\"M7 4h10v5a5 5 0 0 1-10 0V4Z\"/><path d=\"M7 6H4v2a3 3 0 0 0 3 3\"/><path d=\"M17 6h3v2a3 3 0 0 1-3 3\"/></svg>',\n  },\n  {\n    key: 'friends',\n    label: 'חברים',\n    hash: '#/friends',\n    icon: '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\"><circle cx=\"9\" cy=\"8\" r=\"3.5\"/><path d=\"M2.5 19.5a6.5 6.5 0 0 1 13 0\"/><circle cx=\"17\" cy=\"9\" r=\"2.5\"/><path d=\"M17.5 14.5a4.5 4.5 0 0 1 4 4.5\"/></svg>',\n  },\n  {\n    key: 'groups',\n    label: 'קבוצות',\n    hash: '#/groups',\n    icon: '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\"><rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"3\"/><path d=\"M8 10h8\"/><path d=\"M8 14h5\"/></svg>',\n  },\n  {\n    key: 'me',\n    label: 'אני',\n    hash: '#/me',\n    icon: '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\"><circle cx=\"12\" cy=\"8\" r=\"4\"/><path d=\"M4.5 20a7.5 7.5 0 0 1 15 0\"/></svg>',\n  },\n];\n\nlet activeCleanup = null;\n\nconst app = {\n  user: null,\n  unreadCount: 0,\n  activeTab: 'home',\n\n  setCleanup(fn) {\n    activeCleanup = typeof fn === 'function' ? fn : null;\n  },\n\n  setUser(user) {\n    this.user = user;\n    renderHeader();\n    renderNavigation();\n  },\n\n  setUnreadCount(count) {\n    this.unreadCount = Number(count) || 0;\n    renderNavigation();\n  },\n\n  navigate(hash) {\n    if (window.location.hash === hash) {\n      route();\n    } else {\n      window.location.hash = hash;\n    }\n  },\n};\n\nfunction renderHeader(isSubpage = false) {\n  const rightEl = document.getElementById('header-right');\n  const backBtn = document.getElementById('header-back-btn');\n\n  if (isSubpage && app.user) {\n    backBtn.classList.remove('hidden');\n  } else {\n    backBtn.classList.add('hidden');\n  }\n\n  if (app.user) {\n    rightEl.innerHTML = `\n      ${isSubpage ? '' : '<button type=\"button\" class=\"header-run-pill\" id=\"header-quick-run\">▶ רוץ</button>'}\n      <span class=\"header-user-pill\">${escapeHtml(app.user.display_name)}</span>\n    `;\n    rightEl.querySelector('#header-quick-run')?.addEventListener('click', () => {\n      app.navigate('#/track');\n    });\n  } else {\n    rightEl.innerHTML = '<span>קהילת רצים בעברית</span>';\n  }\n}\n\nfunction renderNavigation() {\n  const bottomNav = document.getElementById('bottom-nav');\n  const desktopNav = document.getElementById('desktop-nav');\n\n  if (!app.user) {\n    bottomNav.classList.add('hidden');\n    desktopNav.classList.add('hidden');\n    return;\n  }\n\n  bottomNav.classList.remove('hidden');\n  desktopNav.classList.remove('hidden');\n\n  const badgeHtml = (key) =>\n    key === 'home' && app.unreadCount > 0\n      ? `<span class=\"nav-badge\" aria-label=\"${app.unreadCount} התראות חדשות\">${app.unreadCount > 99 ? '99+' : app.unreadCount}</span>`\n      : '';\n\n  bottomNav.innerHTML = NAV_TABS.map(\n    (t) => `\n      <button type=\"button\"\n        class=\"bottom-nav-btn ${app.activeTab === t.key ? 'active' : ''}\"\n        data-nav=\"${t.hash}\"\n        aria-current=\"${app.activeTab === t.key ? 'page' : 'false'}\">\n        ${badgeHtml(t.key)}\n        ${t.icon}\n        <span>${t.label}</span>\n      </button>\n    `\n  ).join('');\n\n  desktopNav.innerHTML = `\n    <div class=\"desktop-nav-inner\">\n      ${NAV_TABS.map(\n        (t) => `\n          <button type=\"button\"\n            class=\"desktop-nav-btn ${app.activeTab === t.key ? 'active' : ''}\"\n            data-nav=\"${t.hash}\"\n            aria-current=\"${app.activeTab === t.key ? 'page' : 'false'}\">\n            <span>${t.label}</span>\n            ${badgeHtml(t.key)}\n          </button>\n        `\n      ).join('')}\n    </div>\n  `;\n\n  document.querySelectorAll('[data-nav]').forEach((btn) => {\n    btn.addEventListener('click', () => {\n      app.navigate(btn.getAttribute('data-nav'));\n    });\n  });\n}\n\nasync function refreshUnreadCount() {\n  if (!app.user) return;\n  try {\n    const res = await api.notifications();\n    app.setUnreadCount(res.unread_count || 0);\n  } catch {\n    // ignore transient failures\n  }\n}\n\nasync function route() {\n  if (activeCleanup) {\n    try {\n      activeCleanup();\n    } catch {\n      // ignore cleanup error\n    }\n    activeCleanup = null;\n  }\n\n  const main = document.getElementById('main-content');\n  const rawHash = window.location.hash || '#/home';\n  const hash = rawHash.split('?')[0];\n\n  if (hash === '#/privacy') {\n    app.activeTab = 'me';\n    renderHeader(true);\n    renderNavigation();\n    renderPrivacyView(main);\n    window.scrollTo({ top: 0, behavior: 'instant' });\n    return;\n  }\n\n  if (!app.user) {\n    renderHeader(false);\n    renderNavigation();\n    renderAuthView(main, app);\n    return;\n  }\n\n  try {\n    if (hash === '#/home' || hash === '#' || hash === '' || hash === '#/auth') {\n      app.activeTab = 'home';\n      renderHeader(false);\n      renderNavigation();\n      await renderHomeView(main, app);\n    } else if (hash === '#/track') {\n      app.activeTab = 'home';\n      renderHeader(true);\n      renderNavigation();\n      await renderTrackView(main, app);\n    } else if (hash.startsWith('#/leaderboard')) {\n      app.activeTab = 'leaderboard';\n      renderHeader(false);\n      renderNavigation();\n      await renderLeaderboardView(main, app);\n      refreshUnreadCount();\n    } else if (hash === '#/friends') {\n      app.activeTab = 'friends';\n      renderHeader(false);\n      renderNavigation();\n      await renderFriendsView(main, app);\n      refreshUnreadCount();\n    } else if (hash === '#/groups') {\n      app.activeTab = 'groups';\n      renderHeader(false);\n      renderNavigation();\n      await renderGroupsView(main, app);\n      refreshUnreadCount();\n    } else if (hash.startsWith('#/group/')) {\n      const groupId = decodeURIComponent(hash.slice('#/group/'.length));\n      app.activeTab = 'groups';\n      renderHeader(true);\n      renderNavigation();\n      await renderGroupDetailView(main, app, groupId);\n    } else if (hash === '#/me') {\n      app.activeTab = 'me';\n      renderHeader(false);\n      renderNavigation();\n      await renderMeView(main, app);\n      refreshUnreadCount();\n    } else if (hash === '#/sources') {\n      app.activeTab = 'me';\n      renderHeader(true);\n      renderNavigation();\n      await renderSourcesView(main, app);\n    } else if (hash === '#/resources') {\n      app.activeTab = 'me';\n      renderHeader(true);\n      renderNavigation();\n      await renderResourcesView(main, app);\n    } else if (hash.startsWith('#/user/')) {\n      const userId = decodeURIComponent(hash.slice('#/user/'.length));\n      app.activeTab = 'friends';\n      renderHeader(true);\n      renderNavigation();\n      await renderProfileView(main, app, userId);\n    } else if (hash.startsWith('#/run/')) {\n      const runId = decodeURIComponent(hash.slice('#/run/'.length));\n      app.activeTab = 'home';\n      renderHeader(true);\n      renderNavigation();\n      await renderRunDetailView(main, app, runId);\n    } else {\n      app.navigate('#/home');\n      return;\n    }\n    window.scrollTo({ top: 0, behavior: 'instant' });\n  } catch (err) {\n    if (err.status === 401) {\n      app.setUser(null);\n      app.navigate('#/auth');\n      return;\n    }\n    main.innerHTML = `\n      <div class=\"card\">\n        <h2 class=\"card-title\" style=\"margin-bottom:6px;\">לא ניתן לטעון את המסך</h2>\n        <p style=\"margin:0 0 12px;color:var(--text-secondary);\">${escapeHtml(err.message || 'שגיאה לא צפויה')}</p>\n        <button type=\"button\" class=\"btn btn-primary btn-sm\" id=\"btn-err-home\">חזרה לבית</button>\n      </div>\n    `;\n    main.querySelector('#btn-err-home')?.addEventListener('click', () => app.navigate('#/home'));\n  }\n}\n\ndocument.getElementById('header-back-btn').addEventListener('click', () => {\n  if (window.history.length > 1) {\n    window.history.back();\n  } else {\n    app.navigate('#/home');\n  }\n});\n\nwindow.addEventListener('hashchange', route);\n\nasync function boot() {\n  try {\n    const res = await api.me();\n    app.emailVerificationEnabled = Boolean(res.email_verification_enabled);\n    app.setUser(res.user || null);\n  } catch {\n    app.emailVerificationEnabled = false;\n    app.setUser(null);\n  }\n  await route();\n}\n\nboot();\n\n\n})();\n  </script>\n</body>\n</html>";
