import {
  PASSWORD_MIN_LENGTH,
  canonicalizeEmail,
  generateId,
  generateOtpCode,
  generateSessionToken,
  hashPassword,
  hashToken,
  isDisposableEmail,
  verifyPassword,
} from '../crypto.mjs';
import {
  buildSessionCookie,
  clearSessionCookie,
  getClientIp,
  readJsonBody,
  sendError,
  sendJson,
} from '../http-utils.mjs';
import { deleteNotificationsFromActor } from '../privacy.mjs';
import { runInTransaction } from '../db.mjs';

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const USERNAME_RE = /^[\p{L}\p{N}_.-]{2,30}$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function dispatchEmailVerificationCode(ctx, { userId, email, emailCanonical, displayName }) {
  const apiKey = ctx.config.resendApiKey;
  if (!apiKey) return { configured: false, sent: false };

  const code = generateOtpCode();
  const codeHash = hashToken(`${userId}:${emailCanonical}:${code}`);
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  runInTransaction(ctx.db, () => {
    ctx.db.prepare('DELETE FROM email_verification_codes WHERE user_id = ?').run(userId);
    ctx.db
      .prepare(
        `INSERT INTO email_verification_codes (id, user_id, email_canonical, code_hash, attempts, expires_at, created_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`
      )
      .run(generateId(), userId, emailCanonical, codeHash, expiresAt, nowIso);
  });

  const fetcher = ctx.config.fetchImpl || fetch;
  const fromAddr = ctx.config.emailFrom || 'Isrunner <onboarding@resend.dev>';
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
      text: `שלום ${displayName},\n\nקוד האימות שלך ל-Isrunner הוא: ${code}\nהקוד תקף ל-15 דקות.\n\nאם לא ביקשת קוד זה, אפשר להתעלם מהמייל.`,
      html: `<div dir="rtl" style="font-family:sans-serif;line-height:1.6;color:#11141c"><h2>אימות אימייל ב-Isrunner</h2><p>שלום ${displayName.replace(/[<>&"]/g, '')},</p><p>קוד האימות החד-פעמי שלך הוא:</p><div style="font-size:28px;font-weight:800;letter-spacing:6px;padding:12px 18px;background:#f4f1ec;border-radius:12px;display:inline-block">${code}</div><p style="color:#5c6370;font-size:13px">הקוד תקף ל-15 דקות.</p></div>`,
    }),
  });

  if (!res.ok) {
    return { configured: true, sent: false, status: res.status };
  }
  return { configured: true, sent: true };
}

export function sanitizeUserSelf(user) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    email: user.email || null,
    email_verified: Boolean(user.email_verified),
    run_privacy: user.run_privacy,
    show_in_global_leaderboard: Boolean(user.show_in_global_leaderboard),
    weekly_goal_km: user.weekly_goal_km !== null ? Number(user.weekly_goal_km) : null,
    bio: user.bio || '',
    created_at: user.created_at,
  };
}

export async function handleRegister(req, res, ctx) {
  const ip = getClientIp(req);
  const rl = ctx.rateLimiter.check(`register:${ip}`, ctx.config.authRateLimit ?? 15, 15 * 60 * 1000);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return sendError(res, 429, 'rate_limited', 'יותר מדי ניסיונות הרשמה. נסה שוב בעוד כמה דקות.');
  }

  const { body } = await readJsonBody(req);
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const displayName =
    typeof body.display_name === 'string' && body.display_name.trim()
      ? body.display_name.trim()
      : username;
  const password = typeof body.password === 'string' ? body.password : '';
  const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!USERNAME_RE.test(username)) {
    return sendError(
      res,
      400,
      'invalid_username',
      'שם משתמש חייב להכיל 2 עד 30 תווים (אותיות בעברית או אנגלית, ספרות, נקודה, מקף או קו תחתון).'
    );
  }
  if (displayName.length < 2 || displayName.length > 40) {
    return sendError(res, 400, 'invalid_display_name', 'שם תצוגה חייב להכיל 2 עד 40 תווים.');
  }
  if (!rawEmail) {
    return sendError(
      res,
      400,
      'missing_email',
      'חובה להזין כתובת אימייל כדי להירשם (אימייל אחד לכל רץ למניעת כפילויות בדירוג).'
    );
  }
  if (!EMAIL_RE.test(rawEmail) || rawEmail.length > 120) {
    return sendError(res, 400, 'invalid_email', 'כתובת האימייל אינה תקינה.');
  }
  if (isDisposableEmail(rawEmail)) {
    return sendError(
      res,
      400,
      'disposable_email',
      'לא ניתן להירשם עם כתובת אימייל זמנית או חד-פעמית. השתמש בכתובת אימייל אישית קבועה.'
    );
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return sendError(
      res,
      400,
      'weak_password',
      `הסיסמה חייבת להכיל לפחות ${PASSWORD_MIN_LENGTH} תווים.`
    );
  }

  const emailCanonical = canonicalizeEmail(rawEmail);

  const existing = ctx.db
    .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
    .get(username);
  const reserved = ctx.db
    .prepare('SELECT 1 FROM reserved_usernames WHERE username_hash = ?')
    .get(hashToken(username.toLowerCase()));

  if (existing || reserved) {
    return sendError(res, 409, 'username_taken', 'שם המשתמש כבר תפוס. בחר שם אחר.');
  }

  const emailTaken = ctx.db
    .prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE OR email_canonical = ?')
    .get(rawEmail, emailCanonical);
  if (emailTaken) {
    return sendError(
      res,
      409,
      'email_taken',
      'כתובת האימייל הזו (או כינוי שלה) כבר משויכת לחשבון קיים.'
    );
  }

  const nowIso = new Date().toISOString();
  const userId = generateId();
  const passwordHash = await hashPassword(password);
  const sessionToken = generateSessionToken();
  const tokenHash = hashToken(sessionToken);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  runInTransaction(ctx.db, () => {
    ctx.db
      .prepare(
        `INSERT INTO users (id, username, display_name, email, email_canonical, email_verified, password_hash, run_privacy, show_in_global_leaderboard, weekly_goal_km, bio, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, 'everyone', 1, NULL, '', ?, ?)`
      )
      .run(userId, username, displayName, rawEmail, emailCanonical, passwordHash, nowIso, nowIso);

    ctx.db
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(tokenHash, userId, nowIso, expiresAt);
  });

  let verificationCodeSent = false;
  if (ctx.config.resendApiKey) {
    try {
      const sent = await dispatchEmailVerificationCode(ctx, {
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

  const user = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return sendJson(
    res,
    201,
    {
      user: sanitizeUserSelf(user),
      email_verification_enabled: Boolean(ctx.config.resendApiKey),
      verification_code_sent: verificationCodeSent,
    },
    { 'Set-Cookie': buildSessionCookie(sessionToken, { secure: ctx.config.cookieSecure }) }
  );
}

export async function handleLogin(req, res, ctx) {
  const ip = getClientIp(req);
  const rl = ctx.rateLimiter.check(`login:${ip}`, ctx.config.loginRateLimit ?? 10, 15 * 60 * 1000);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return sendError(res, 429, 'rate_limited', 'יותר מדי ניסיונות התחברות. המתן מעט ונסה שוב.');
  }

  const { body } = await readJsonBody(req);
  const identifier = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!identifier || !password) {
    return sendError(res, 400, 'missing_credentials', 'נא למלא שם משתמש (או אימייל) וסיסמה.');
  }

  const canonicalId = identifier.includes('@') ? canonicalizeEmail(identifier) : '';
  const user = ctx.db
    .prepare(
      `SELECT * FROM users
       WHERE username = ? COLLATE NOCASE
          OR (email IS NOT NULL AND email = ? COLLATE NOCASE)
          OR (email_canonical IS NOT NULL AND email_canonical = ?)`
    )
    .get(identifier, identifier, canonicalId);

  if (!user) {
    return sendError(res, 401, 'invalid_credentials', 'שם משתמש או סיסמה שגויים.');
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return sendError(res, 401, 'invalid_credentials', 'שם משתמש או סיסמה שגויים.');
  }

  const nowIso = new Date().toISOString();
  const sessionToken = generateSessionToken();
  const tokenHash = hashToken(sessionToken);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  runInTransaction(ctx.db, () => {
    ctx.db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?').run(user.id, nowIso);
    ctx.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, user.id, nowIso, expiresAt);
  });

  return sendJson(
    res,
    200,
    {
      user: sanitizeUserSelf(user),
      email_verification_enabled: Boolean(ctx.config.resendApiKey),
    },
    { 'Set-Cookie': buildSessionCookie(sessionToken, { secure: ctx.config.cookieSecure }) }
  );
}

export async function handleLogout(req, res, ctx) {
  if (ctx.sessionTokenHash) {
    ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(ctx.sessionTokenHash);
  }
  return sendJson(
    res,
    200,
    { ok: true },
    { 'Set-Cookie': clearSessionCookie({ secure: ctx.config.cookieSecure }) }
  );
}

export async function handleLogoutAll(req, res, ctx) {
  ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(ctx.user.id);
  return sendJson(
    res,
    200,
    { ok: true, message: 'התנתקת מכל המכשירים הפעילים.' },
    { 'Set-Cookie': clearSessionCookie({ secure: ctx.config.cookieSecure }) }
  );
}

export async function handleChangePassword(req, res, ctx) {
  const ip = getClientIp(req);
  const rl = ctx.rateLimiter.check(`chpw:${ctx.user.id}:${ip}`, 8, 15 * 60 * 1000);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return sendError(res, 429, 'rate_limited', 'יותר מדי ניסיונות החלפת סיסמה. המתן מעט.');
  }

  const { body } = await readJsonBody(req);
  const currentPassword = typeof body.current_password === 'string' ? body.current_password : '';
  const newPassword = typeof body.new_password === 'string' ? body.new_password : '';

  if (!currentPassword || !newPassword) {
    return sendError(res, 400, 'missing_passwords', 'נא למלא סיסמה נוכחית וסיסמה חדשה.');
  }
  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    return sendError(
      res,
      400,
      'weak_password',
      `הסיסמה החדשה חייבת להכיל לפחות ${PASSWORD_MIN_LENGTH} תווים.`
    );
  }
  const valid = await verifyPassword(currentPassword, ctx.user.password_hash);
  if (!valid) {
    return sendError(res, 401, 'invalid_credentials', 'הסיסמה הנוכחית שגויה.');
  }

  const nextHash = await hashPassword(newPassword);
  const nowIso = new Date().toISOString();

  runInTransaction(ctx.db, () => {
    ctx.db
      .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(nextHash, nowIso, ctx.user.id);
    // Security: invalidate all OTHER active sessions across other devices
    ctx.db
      .prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?')
      .run(ctx.user.id, ctx.sessionTokenHash || '');
  });

  return sendJson(res, 200, {
    ok: true,
    message: 'הסיסמה עודכנה בהצלחה. מכשירים אחרים נותקו לביטחונך.',
  });
}

export async function handleRequestPasswordReset(req, res) {
  return sendError(
    res,
    503,
    'email_provider_not_configured',
    'שליחת מייל לשחזור סיסמה עדיין אינה מחוברת בסביבה המקומית. היא תופעל רק לאחר חיבור ספק שליחת אימיילים בייצור.'
  );
}

export async function handleGetMe(req, res, ctx) {
  const emailVerificationEnabled = Boolean(ctx.config.resendApiKey);
  if (!ctx.user) {
    return sendJson(res, 200, { user: null, email_verification_enabled: emailVerificationEnabled });
  }
  return sendJson(res, 200, {
    user: sanitizeUserSelf(ctx.user),
    email_verification_enabled: emailVerificationEnabled,
  });
}

export async function handleSendEmailVerificationCode(req, res, ctx) {
  const rl = ctx.rateLimiter.check(`email_otp:${ctx.user.id}`, 5, 15 * 60 * 1000);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return sendError(res, 429, 'rate_limited', 'נשלחו יותר מדי קודים לאימות. המתן מעט ונסה שוב.');
  }

  if (!ctx.user.email) {
    return sendError(res, 400, 'missing_email', 'יש להזין כתובת אימייל בהגדרות החשבון לפני האימות.');
  }
  if (ctx.user.email_verified) {
    return sendJson(res, 200, { ok: true, already_verified: true, message: 'האימייל כבר מאומת.' });
  }
  if (!ctx.config.resendApiKey) {
    return sendError(
      res,
      503,
      'email_provider_not_configured',
      'שליחת קוד אימות למייל תופעל לאחר הגדרת RESEND_API_KEY בשרת.'
    );
  }

  const emailCanonical = ctx.user.email_canonical || canonicalizeEmail(ctx.user.email);
  const result = await dispatchEmailVerificationCode(ctx, {
    userId: ctx.user.id,
    email: ctx.user.email,
    emailCanonical,
    displayName: ctx.user.display_name,
  });

  if (!result.sent) {
    return sendError(
      res,
      502,
      'email_send_failed',
      'שליחת מייל האימות נכשלה כרגע. נסה שוב בעוד רגע.'
    );
  }

  return sendJson(res, 200, {
    ok: true,
    message: `קוד אימות בן 6 ספרות נשלח אל ${ctx.user.email}.`,
  });
}

export async function handleVerifyEmailCode(req, res, ctx) {
  const rl = ctx.rateLimiter.check(`email_verify:${ctx.user.id}`, 10, 15 * 60 * 1000);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return sendError(res, 429, 'rate_limited', 'יותר מדי ניסיונות אימות. נסה שוב מאוחר יותר.');
  }

  if (!ctx.user.email) {
    return sendError(res, 400, 'missing_email', 'אין אימייל משויך לחשבון.');
  }
  if (ctx.user.email_verified) {
    return sendJson(res, 200, { ok: true, user: sanitizeUserSelf(ctx.user) });
  }

  const { body } = await readJsonBody(req);
  const code = typeof body.code === 'string' ? body.code.replace(/\s+/g, '') : '';
  if (!/^\d{6}$/.test(code)) {
    return sendError(res, 400, 'invalid_code', 'יש להזין קוד אימות בן 6 ספרות.');
  }

  const emailCanonical = ctx.user.email_canonical || canonicalizeEmail(ctx.user.email);
  const nowIso = new Date().toISOString();
  const row = ctx.db
    .prepare(
      `SELECT * FROM email_verification_codes
       WHERE user_id = ? AND email_canonical = ? AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(ctx.user.id, emailCanonical, nowIso);

  if (!row) {
    return sendError(res, 400, 'code_expired', 'לא נמצא קוד בתוקף. בקש שליחת קוד חדש.');
  }
  if (Number(row.attempts) >= OTP_MAX_ATTEMPTS) {
    return sendError(res, 429, 'too_many_attempts', 'חרגת ממספר הניסיונות. בקש קוד אימות חדש.');
  }

  const expectedHash = hashToken(`${ctx.user.id}:${emailCanonical}:${code}`);
  if (expectedHash !== row.code_hash) {
    ctx.db
      .prepare('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?')
      .run(row.id);
    return sendError(res, 400, 'invalid_code', 'קוד האימות שגוי. בדוק שוב את המייל.');
  }

  runInTransaction(ctx.db, () => {
    ctx.db
      .prepare('UPDATE users SET email_verified = 1, email_canonical = ?, updated_at = ? WHERE id = ?')
      .run(emailCanonical, nowIso, ctx.user.id);
    ctx.db.prepare('DELETE FROM email_verification_codes WHERE user_id = ?').run(ctx.user.id);
  });

  const updated = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id);
  return sendJson(res, 200, {
    ok: true,
    user: sanitizeUserSelf(updated),
    message: 'האימייל אומת בהצלחה!',
  });
}

export async function handleUpdateSettings(req, res, ctx) {
  const { body } = await readJsonBody(req);
  const updates = [];
  const params = [];

  let privacyChangedToNone = false;
  let emailChanged = false;

  if (body.display_name !== undefined) {
    const dn = typeof body.display_name === 'string' ? body.display_name.trim() : '';
    if (dn.length < 2 || dn.length > 40) {
      return sendError(res, 400, 'invalid_display_name', 'שם תצוגה חייב להכיל 2 עד 40 תווים.');
    }
    updates.push('display_name = ?');
    params.push(dn);
  }

  if (body.email !== undefined) {
    const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const currentEmail = (ctx.user.email || '').trim().toLowerCase();
    if (rawEmail === '') {
      if (currentEmail) {
        return sendError(
          res,
          400,
          'email_required',
          'אי אפשר להסיר אימייל מהחשבון — הוא משמש לאימות ולמניעת כפילויות בדירוג.'
        );
      }
    } else if (rawEmail !== currentEmail) {
      if (!EMAIL_RE.test(rawEmail) || rawEmail.length > 120) {
        return sendError(res, 400, 'invalid_email', 'כתובת האימייל אינה תקינה.');
      }
      if (isDisposableEmail(rawEmail)) {
        return sendError(
          res,
          400,
          'disposable_email',
          'לא ניתן להשתמש בכתובת אימייל זמנית או חד-פעמית.'
        );
      }
      const emailCanonical = canonicalizeEmail(rawEmail);
      const taken = ctx.db
        .prepare(
          'SELECT id FROM users WHERE (email = ? COLLATE NOCASE OR email_canonical = ?) AND id <> ?'
        )
        .get(rawEmail, emailCanonical, ctx.user.id);
      if (taken) {
        return sendError(
          res,
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
      return sendError(res, 400, 'invalid_privacy', 'רמת פרטיות לא חוקית.');
    }
    updates.push('run_privacy = ?');
    params.push(body.run_privacy);
    if (body.run_privacy === 'none') {
      privacyChangedToNone = true;
    }
  }

  if (body.show_in_global_leaderboard !== undefined) {
    const flag = body.show_in_global_leaderboard ? 1 : 0;
    updates.push('show_in_global_leaderboard = ?');
    params.push(flag);
  }

  if (body.weekly_goal_km !== undefined) {
    if (body.weekly_goal_km === null || body.weekly_goal_km === '') {
      updates.push('weekly_goal_km = NULL');
    } else {
      const goal = Number(body.weekly_goal_km);
      if (!Number.isFinite(goal) || goal < 1 || goal > 500) {
        return sendError(res, 400, 'invalid_goal', 'יעד שבועי חייב להיות בין 1 ל-500 ק"מ.');
      }
      updates.push('weekly_goal_km = ?');
      params.push(Math.round(goal * 10) / 10);
    }
  }

  if (updates.length === 0) {
    return sendJson(res, 200, { user: sanitizeUserSelf(ctx.user) });
  }

  const nowIso = new Date().toISOString();
  updates.push('updated_at = ?');
  params.push(nowIso, ctx.user.id);

  runInTransaction(ctx.db, () => {
    ctx.db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    if (privacyChangedToNone) {
      deleteNotificationsFromActor(ctx.db, ctx.user.id);
    }
    if (emailChanged) {
      ctx.db.prepare('DELETE FROM email_verification_codes WHERE user_id = ?').run(ctx.user.id);
    }
  });

  const updated = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id);
  return sendJson(res, 200, { user: sanitizeUserSelf(updated) });
}

export async function handleExportMyData(req, res, ctx) {
  const userId = ctx.user.id;
  const user = sanitizeUserSelf(ctx.user);
  const runs = ctx.db
    .prepare(
      `SELECT id, distance_km, duration_sec, ran_at, note, is_shared, source_type, source_verified, source_ingested_at, created_at
       FROM runs WHERE user_id = ? ORDER BY ran_at DESC`
    )
    .all(userId);
  const groups = ctx.db
    .prepare(
      `SELECT g.id, g.name, gm.role, gm.joined_at
       FROM group_members gm JOIN groups g ON g.id = gm.group_id
       WHERE gm.user_id = ?`
    )
    .all(userId);
  const sources = ctx.db
    .prepare(
      `SELECT provider, consent_version, consented_at, connected_at, last_sync_at, status
       FROM provider_connections WHERE user_id = ?`
    )
    .all(userId);

  return sendJson(res, 200, {
    exported_at: new Date().toISOString(),
    note: 'ייצוא נתונים מקומי. החלה על נתונים חיים מחייבת אישור בעל השירות לפני העלאה לאוויר.',
    user,
    runs,
    groups,
    sources,
  });
}

/**
 * Local Account Deletion following recommended policies:
 * 1. Requires password re-verification.
 * 2. Group ownership transfers to earliest remaining member (or deletes empty group).
 * 3. Username hash is stored in reserved_usernames to prevent impersonation.
 * 4. Existing reports remain anonymized (reporter_id/target_user_id -> NULL via ON DELETE SET NULL).
 * 5. Runs, sessions, notifications, friendships, blocks, and provider connections are deleted.
 */
export async function handleDeleteMyAccount(req, res, ctx) {
  const { body } = await readJsonBody(req);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) {
    return sendError(res, 400, 'password_required', 'נא להזין את הסיסמה הנוכחית כדי לאשר מחיקת חשבון.');
  }

  const valid = await verifyPassword(password, ctx.user.password_hash);
  if (!valid) {
    return sendError(res, 401, 'invalid_credentials', 'הסיסמה שהוזנה שגויה.');
  }

  const userId = ctx.user.id;
  const usernameHash = hashToken(ctx.user.username.toLowerCase());
  const nowIso = new Date().toISOString();

  let transferredGroups = 0;
  let deletedGroups = 0;

  runInTransaction(ctx.db, () => {
    // Handle groups owned by this user BEFORE deleting user row
    const ownedGroups = ctx.db
      .prepare('SELECT id FROM groups WHERE owner_id = ?')
      .all(userId);

    for (const grp of ownedGroups) {
      const nextMember = ctx.db
        .prepare(
          `SELECT user_id FROM group_members
           WHERE group_id = ? AND user_id <> ?
           ORDER BY joined_at ASC LIMIT 1`
        )
        .get(grp.id, userId);

      if (nextMember) {
        ctx.db.prepare('UPDATE groups SET owner_id = ? WHERE id = ?').run(nextMember.user_id, grp.id);
        ctx.db
          .prepare("UPDATE group_members SET role = 'owner' WHERE group_id = ? AND user_id = ?")
          .run(grp.id, nextMember.user_id);
        transferredGroups += 1;
      } else {
        ctx.db.prepare('DELETE FROM groups WHERE id = ?').run(grp.id);
        deletedGroups += 1;
      }
    }

    // Reserve username hash to prevent future impersonation
    ctx.db
      .prepare('INSERT OR IGNORE INTO reserved_usernames (username_hash, reserved_at) VALUES (?, ?)')
      .run(usernameHash, nowIso);

    // Delete user (cascades runs/sessions/notifications/friendships/blocks/sources; anonymizes reports via SET NULL)
    ctx.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });

  return sendJson(
    res,
    200,
    {
      ok: true,
      transferred_groups: transferredGroups,
      deleted_groups: deletedGroups,
      message: 'החשבון נמחק. דיווחים קיימים הועברו למצב אנונימי ושם המשתמש נשמר תפוס למניעת התחזות.',
    },
    { 'Set-Cookie': clearSessionCookie({ secure: ctx.config.cookieSecure }) }
  );
      }
