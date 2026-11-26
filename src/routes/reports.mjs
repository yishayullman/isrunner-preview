import { generateId } from '../crypto.mjs';
import { getClientIp, readJsonBody, sendError, sendJson } from '../http-utils.mjs';
import { canViewRun, isBlockedBetween } from '../privacy.mjs';

const VALID_REASONS = new Set([
  'anomalous_result',
  'harassment',
  'impersonation',
  'inappropriate_content',
  'other',
]);

export async function handleCreateReport(req, res, ctx) {
  const ip = getClientIp(req);
  const rl = ctx.rateLimiter.check(`report:${ctx.user.id}:${ip}`, 15, 60 * 60 * 1000);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return sendError(res, 429, 'rate_limited', 'נשלחו יותר מדי דיווחים לאחרונה. נסה שוב מאוחר יותר.');
  }

  const { body } = await readJsonBody(req);
  const targetType = body.target_type;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const details = typeof body.details === 'string' ? body.details.trim().slice(0, 500) : '';

  if (!['user', 'run'].includes(targetType)) {
    return sendError(res, 400, 'invalid_target_type', 'סוג דיווח לא חוקי.');
  }
  if (!VALID_REASONS.has(reason)) {
    return sendError(res, 400, 'invalid_reason', 'נא לבחור סיבת דיווח תקינה.');
  }

  let targetUserId = null;
  let targetRunId = null;

  if (targetType === 'user') {
    const uid = typeof body.target_user_id === 'string' ? body.target_user_id.trim() : '';
    if (!uid || uid === ctx.user.id) {
      return sendError(res, 400, 'invalid_target', 'אי אפשר לדווח על עצמך.');
    }
    const target = ctx.db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
    if (!target || isBlockedBetween(ctx.db, ctx.user.id, uid)) {
      return sendError(res, 404, 'not_found', 'המשתמש לא נמצא.');
    }
    targetUserId = target.id;
  } else {
    const rid = typeof body.target_run_id === 'string' ? body.target_run_id.trim() : '';
    if (!rid) {
      return sendError(res, 400, 'invalid_target', 'חסר מזהה ריצה לדיווח.');
    }
    const run = ctx.db.prepare('SELECT * FROM runs WHERE id = ?').get(rid);
    if (!run) {
      return sendError(res, 404, 'not_found', 'הריצה לא נמצאה.');
    }
    if (run.user_id === ctx.user.id) {
      return sendError(res, 400, 'invalid_target', 'אי אפשר לדווח על ריצה שלך.');
    }
    // Private runs or runs viewer cannot see CANNOT be reported!
    const owner = ctx.db
      .prepare('SELECT id, run_privacy FROM users WHERE id = ?')
      .get(run.user_id);
    if (!owner || !run.is_shared || !canViewRun(ctx.db, ctx.user.id, run, owner)) {
      return sendError(res, 404, 'not_found', 'אי אפשר לדווח על ריצה זו.');
    }
    targetRunId = run.id;
    targetUserId = run.user_id;
  }

  const reportId = generateId();
  const nowIso = new Date().toISOString();

  ctx.db
    .prepare(
      `INSERT INTO reports (id, reporter_id, target_type, target_user_id, target_run_id, reason, details, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`
    )
    .run(reportId, ctx.user.id, targetType, targetUserId, targetRunId, reason, details, nowIso);

  return sendJson(res, 201, {
    ok: true,
    report_id: reportId,
    message: 'הדיווח התקבל וייבדק. תודה שעזרת לשמור על הקהילה.',
  });
}

export async function handleListMyReports(req, res, ctx) {
  const reports = ctx.db
    .prepare(
      `SELECT id, target_type, target_user_id, target_run_id, reason, details, status, created_at
       FROM reports
       WHERE reporter_id = ?
       ORDER BY created_at DESC
       LIMIT 30`
    )
    .all(ctx.user.id);
  return sendJson(res, 200, { reports });
                                                                               }
