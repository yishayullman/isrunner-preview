import { generateId } from './crypto.mjs';

const FRESH_NOTIFICATION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function isBlockedBetween(db, userA, userB) {
  if (!userA || !userB || userA === userB) return false;
  const row = db
    .prepare(
      `SELECT 1 FROM blocks
       WHERE (blocker_id = ? AND blocked_id = ?)
          OR (blocker_id = ? AND blocked_id = ?)
       LIMIT 1`
    )
    .get(userA, userB, userB, userA);
  return Boolean(row);
}

export function areFriends(db, userA, userB) {
  if (!userA || !userB || userA === userB) return false;
  const row = db
    .prepare(
      `SELECT 1 FROM friendships
       WHERE status = 'accepted'
         AND ((requester_id = ? AND addressee_id = ?)
           OR (requester_id = ? AND addressee_id = ?))
       LIMIT 1`
    )
    .get(userA, userB, userB, userA);
  return Boolean(row);
}

export function getFriendshipRelation(db, viewerId, targetId) {
  if (!viewerId || !targetId) return 'none';
  if (viewerId === targetId) return 'self';

  const blockedByMe = db
    .prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ? LIMIT 1')
    .get(viewerId, targetId);
  if (blockedByMe) return 'blocked_by_me';

  const blockedMe = db
    .prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ? LIMIT 1')
    .get(targetId, viewerId);
  if (blockedMe) return 'blocked_me';

  const row = db
    .prepare(
      `SELECT requester_id, addressee_id, status FROM friendships
       WHERE (requester_id = ? AND addressee_id = ?)
          OR (requester_id = ? AND addressee_id = ?)
       LIMIT 1`
    )
    .get(viewerId, targetId, targetId, viewerId);

  if (!row) return 'none';
  if (row.status === 'accepted') return 'friends';
  if (row.requester_id === viewerId) return 'outgoing_pending';
  return 'incoming_pending';
}

/**
 * Server-side privacy enforcement for viewing another user's shared runs & PRs.
 * Three levels:
 * - 'everyone': any non-blocked authenticated user can view shared runs
 * - 'friends': only accepted friends (and owner)
 * - 'none': only owner
 */
export function canViewUserRuns(db, viewerId, targetUser) {
  if (!targetUser) return false;
  if (viewerId && viewerId === targetUser.id) return true;
  if (viewerId && isBlockedBetween(db, viewerId, targetUser.id)) return false;

  if (targetUser.run_privacy === 'none') return false;
  if (targetUser.run_privacy === 'everyone') return true;
  if (targetUser.run_privacy === 'friends') {
    if (!viewerId) return false;
    return areFriends(db, viewerId, targetUser.id);
  }
  return false;
}

/**
 * Server-side visibility check for a single run.
 * Private runs (is_shared === 0) are visible ONLY to the owner.
 */
export function canViewRun(db, viewerId, run, ownerUser) {
  if (!run || !ownerUser) return false;
  if (viewerId && viewerId === run.user_id) return true;
  if (!run.is_shared) return false;
  return canViewUserRuns(db, viewerId, ownerUser);
}

export function getAcceptedFriendIds(db, userId) {
  const rows = db
    .prepare(
      `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS friend_id
       FROM friendships
       WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`
    )
    .all(userId, userId, userId);
  return rows.map((r) => r.friend_id);
}

/**
 * Dispatches one in-app notification per current accepted friend the FIRST time a recent run is shared.
 * Rules:
 * - Never sends for old runs (> 14 days old at share time) or legacy runs.
 * - Never re-sends after unshare + re-share (tracked via notifications_dispatched = 1).
 * - Never sends if owner's run_privacy is 'none' (friends cannot access the run).
 * - Notification intentionally omits the run's note.
 */
export function dispatchFirstShareNotifications(db, run, ownerUser, now = new Date()) {
  if (!run || !ownerUser) return 0;
  if (!run.is_shared) return 0;
  if (Number(run.notifications_dispatched) === 1) return 0;

  const nowIso = now.toISOString();
  const ranAtMs = Date.parse(run.ran_at);
  const isTooOld = Number.isNaN(ranAtMs) || now.getTime() - ranAtMs > FRESH_NOTIFICATION_WINDOW_MS;
  const isLegacy = run.source_type === 'self_reported_legacy';

  if (isTooOld || isLegacy) {
    db.prepare(
      `UPDATE runs
       SET notifications_dispatched = 1, first_shared_at = COALESCE(first_shared_at, ?), updated_at = ?
       WHERE id = ?`
    ).run(nowIso, nowIso, run.id);
    return 0;
  }

  // Mark dispatched immediately so even if unshared and re-shared later, no duplicate notifications are sent.
  db.prepare(
    `UPDATE runs
     SET notifications_dispatched = 1, first_shared_at = COALESCE(first_shared_at, ?), updated_at = ?
     WHERE id = ?`
  ).run(nowIso, nowIso, run.id);

  if (ownerUser.run_privacy === 'none') {
    return 0;
  }

  const friendIds = getAcceptedFriendIds(db, ownerUser.id);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO notifications (id, recipient_id, actor_id, run_id, type, is_read, created_at)
     VALUES (?, ?, ?, ?, 'friend_shared_run', 0, ?)`
  );

  let created = 0;
  for (const friendId of friendIds) {
    if (isBlockedBetween(db, ownerUser.id, friendId)) continue;
    const info = insert.run(generateId(), friendId, ownerUser.id, run.id, nowIso);
    created += info.changes || 0;
  }
  return created;
}

export function deleteNotificationsForRun(db, runId) {
  db.prepare('DELETE FROM notifications WHERE run_id = ?').run(runId);
}

export function deleteNotificationsBetweenUsers(db, userA, userB) {
  db.prepare(
    `DELETE FROM notifications
     WHERE (recipient_id = ? AND actor_id = ?)
        OR (recipient_id = ? AND actor_id = ?)`
  ).run(userA, userB, userB, userA);
}

export function deleteNotificationsFromActor(db, actorId) {
  db.prepare('DELETE FROM notifications WHERE actor_id = ?').run(actorId);
}
