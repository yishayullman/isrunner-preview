import { sendError, sendJson } from '../http-utils.mjs';
import { canViewUserRuns, isBlockedBetween } from '../privacy.mjs';

export async function handleListNotifications(req, res, ctx) {
  const userId = ctx.user.id;
  // Explicitly NEVER selects or returns run.note!
  const rows = ctx.db
    .prepare(
      `SELECT n.id, n.actor_id, n.run_id, n.is_read, n.created_at,
              u.username AS actor_username, u.display_name AS actor_display_name, u.run_privacy AS actor_privacy,
              r.distance_km, r.duration_sec, r.ran_at, r.is_shared
       FROM notifications n
       JOIN users u ON u.id = n.actor_id
       JOIN runs r ON r.id = n.run_id
       WHERE n.recipient_id = ?
       ORDER BY n.created_at DESC
       LIMIT 50`
    )
    .all(userId);

  const notifications = [];
  let unreadCount = 0;

  for (const row of rows) {
    if (!row.is_shared) continue;
    if (isBlockedBetween(ctx.db, userId, row.actor_id)) continue;
    if (!canViewUserRuns(ctx.db, userId, { id: row.actor_id, run_privacy: row.actor_privacy })) {
      continue;
    }
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

  return sendJson(res, 200, {
    unread_count: unreadCount,
    notifications,
    push_note:
      'התראות לטלפון כשהאפליקציה סגורה (Web Push) הן שלב עתידי נפרד שידרוש הסכמה מפורשת שלך.',
  });
}

export async function handleMarkNotificationRead(req, res, ctx, notificationId) {
  const info = ctx.db
    .prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND recipient_id = ?')
    .run(notificationId, ctx.user.id);

  if (!info.changes) {
    return sendError(res, 404, 'not_found', 'ההתראה לא נמצאה.');
  }
  return sendJson(res, 200, { ok: true });
}

export async function handleMarkAllNotificationsRead(req, res, ctx) {
  ctx.db
    .prepare('UPDATE notifications SET is_read = 1 WHERE recipient_id = ? AND is_read = 0')
    .run(ctx.user.id);
  return sendJson(res, 200, { ok: true });
}
