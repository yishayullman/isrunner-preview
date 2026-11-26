import { generateId } from '../crypto.mjs';
import { runInTransaction } from '../db.mjs';
import { getClientIp, readJsonBody, sendError, sendJson } from '../http-utils.mjs';
import {
  canViewUserRuns,
  deleteNotificationsBetweenUsers,
  getFriendshipRelation,
  isBlockedBetween,
} from '../privacy.mjs';
import { computePersonalRecords, decorateRun } from '../ranking.mjs';

export async function handleListFriends(req, res, ctx) {
  const userId = ctx.user.id;

  const friends = ctx.db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.bio, f.updated_at AS friends_since
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
       WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?)
       ORDER BY u.display_name COLLATE NOCASE ASC`
    )
    .all(userId, userId, userId);

  const incoming = ctx.db
    .prepare(
      `SELECT f.id AS request_id, u.id, u.username, u.display_name, f.created_at
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.status = 'pending' AND f.addressee_id = ?
       ORDER BY f.created_at DESC`
    )
    .all(userId);

  const outgoing = ctx.db
    .prepare(
      `SELECT f.id AS request_id, u.id, u.username, u.display_name, f.created_at
       FROM friendships f
       JOIN users u ON u.id = f.addressee_id
       WHERE f.status = 'pending' AND f.requester_id = ?
       ORDER BY f.created_at DESC`
    )
    .all(userId);

  const blocked = ctx.db
    .prepare(
      `SELECT u.id, u.username, u.display_name, b.created_at AS blocked_at
       FROM blocks b
       JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = ?
       ORDER BY b.created_at DESC`
    )
    .all(userId);

  return sendJson(res, 200, { friends, incoming, outgoing, blocked });
}

export async function handleSearchUsers(req, res, ctx, url) {
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 1) {
    return sendJson(res, 200, { users: [] });
  }

  const pattern = `%${q}%`;
  const rows = ctx.db
    .prepare(
      `SELECT id, username, display_name, bio
       FROM users
       WHERE id <> ?
         AND (display_name LIKE ? COLLATE NOCASE OR username LIKE ? COLLATE NOCASE)
       ORDER BY display_name COLLATE NOCASE ASC
       LIMIT 30`
    )
    .all(ctx.user.id, pattern, pattern);

  const users = [];
  for (const row of rows) {
    if (isBlockedBetween(ctx.db, ctx.user.id, row.id)) continue;
    users.push({
      id: row.id,
      username: row.username,
      display_name: row.display_name,
      bio: row.bio || '',
      relation: getFriendshipRelation(ctx.db, ctx.user.id, row.id),
    });
  }

  return sendJson(res, 200, { users });
}

export async function handleSendFriendRequest(req, res, ctx) {
  const ip = getClientIp(req);
  const rl = ctx.rateLimiter.check(`friend_req:${ctx.user.id}:${ip}`, 30, 15 * 60 * 1000);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return sendError(res, 429, 'rate_limited', 'יותר מדי בקשות חברות. נסה שוב מאוחר יותר.');
  }

  const { body } = await readJsonBody(req);
  const targetUserId = typeof body.target_user_id === 'string' ? body.target_user_id.trim() : '';
  if (!targetUserId || targetUserId === ctx.user.id) {
    return sendError(res, 400, 'invalid_target', 'אי אפשר לשלוח בקשת חברות לעצמך.');
  }

  const target = ctx.db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId);
  if (!target) {
    return sendError(res, 404, 'not_found', 'המשתמש לא נמצא.');
  }

  if (isBlockedBetween(ctx.db, ctx.user.id, targetUserId)) {
    return sendError(res, 403, 'blocked', 'אי אפשר לשלוח בקשת חברות למשתמש זה.');
  }

  const existing = ctx.db
    .prepare(
      `SELECT * FROM friendships
       WHERE (requester_id = ? AND addressee_id = ?)
          OR (requester_id = ? AND addressee_id = ?)`
    )
    .get(ctx.user.id, targetUserId, targetUserId, ctx.user.id);

  const nowIso = new Date().toISOString();

  if (existing) {
    if (existing.status === 'accepted') {
      return sendJson(res, 200, { ok: true, status: 'accepted', message: 'אתם כבר חברים.' });
    }
    if (existing.requester_id === targetUserId) {
      // Mutual request: auto-accept
      ctx.db
        .prepare("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE id = ?")
        .run(nowIso, existing.id);
      return sendJson(res, 200, { ok: true, status: 'accepted', message: 'החברות אושרה.' });
    }
    return sendJson(res, 200, { ok: true, status: 'pending', message: 'בקשת החברות כבר ממתינה.' });
  }

  ctx.db
    .prepare(
      `INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`
    )
    .run(generateId(), ctx.user.id, targetUserId, nowIso, nowIso);

  return sendJson(res, 201, { ok: true, status: 'pending', message: 'בקשת חברות נשלחה.' });
}

export async function handleRespondFriendRequest(req, res, ctx, otherUserId) {
  const { body } = await readJsonBody(req);
  const action = body.action;
  if (!['accept', 'decline'].includes(action)) {
    return sendError(res, 400, 'invalid_action', 'פעולה לא חוקית.');
  }

  const pending = ctx.db
    .prepare(
      `SELECT * FROM friendships
       WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`
    )
    .get(otherUserId, ctx.user.id);

  if (!pending) {
    return sendError(res, 404, 'not_found', 'לא נמצאה בקשת חברות ממתינה.');
  }

  if (action === 'accept') {
    if (isBlockedBetween(ctx.db, ctx.user.id, otherUserId)) {
      return sendError(res, 403, 'blocked', 'אי אפשר לאשר בקשה ממשתמש חסום.');
    }
    ctx.db
      .prepare("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), pending.id);
    return sendJson(res, 200, { ok: true, status: 'accepted' });
  }

  ctx.db.prepare('DELETE FROM friendships WHERE id = ?').run(pending.id);
  return sendJson(res, 200, { ok: true, status: 'declined' });
}

export async function handleRemoveFriend(req, res, ctx, otherUserId) {
  runInTransaction(ctx.db, () => {
    ctx.db
      .prepare(
        `DELETE FROM friendships
         WHERE (requester_id = ? AND addressee_id = ?)
            OR (requester_id = ? AND addressee_id = ?)`
      )
      .run(ctx.user.id, otherUserId, otherUserId, ctx.user.id);

    // Immediately remove in-app notifications between both users
    deleteNotificationsBetweenUsers(ctx.db, ctx.user.id, otherUserId);
  });

  return sendJson(res, 200, { ok: true });
}

export async function handleBlockUser(req, res, ctx, targetUserId) {
  if (targetUserId === ctx.user.id) {
    return sendError(res, 400, 'invalid_target', 'אי אפשר לחסום את עצמך.');
  }
  const target = ctx.db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId);
  if (!target) {
    return sendError(res, 404, 'not_found', 'המשתמש לא נמצא.');
  }

  const nowIso = new Date().toISOString();
  runInTransaction(ctx.db, () => {
    ctx.db
      .prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)')
      .run(ctx.user.id, targetUserId, nowIso);

    ctx.db
      .prepare(
        `DELETE FROM friendships
         WHERE (requester_id = ? AND addressee_id = ?)
            OR (requester_id = ? AND addressee_id = ?)`
      )
      .run(ctx.user.id, targetUserId, targetUserId, ctx.user.id);

    // Immediately delete all notifications in both directions
    deleteNotificationsBetweenUsers(ctx.db, ctx.user.id, targetUserId);
  });

  return sendJson(res, 200, { ok: true, blocked_user_id: targetUserId });
}

export async function handleUnblockUser(req, res, ctx, targetUserId) {
  ctx.db
    .prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
    .run(ctx.user.id, targetUserId);
  return sendJson(res, 200, { ok: true, unblocked_user_id: targetUserId });
}

export async function handleGetUserProfile(req, res, ctx, targetUserId) {
  const target = ctx.db
    .prepare(
      `SELECT id, username, display_name, bio, run_privacy, show_in_global_leaderboard, created_at
       FROM users WHERE id = ?`
    )
    .get(targetUserId);

  if (!target) {
    return sendError(res, 404, 'not_found', 'המשתמש לא נמצא.');
  }

  const relation = getFriendshipRelation(ctx.db, ctx.user.id, target.id);
  if (relation === 'blocked_me') {
    return sendError(res, 404, 'not_found', 'הפרופיל אינו זמין.');
  }

  const isSelf = ctx.user.id === target.id;
  const canViewRuns = relation !== 'blocked_by_me' && canViewUserRuns(ctx.db, ctx.user.id, target);

  let visibleRuns = [];
  if (canViewRuns) {
    visibleRuns = isSelf
      ? ctx.db
          .prepare('SELECT * FROM runs WHERE user_id = ? ORDER BY ran_at DESC, created_at DESC')
          .all(target.id)
      : ctx.db
          .prepare(
            'SELECT * FROM runs WHERE user_id = ? AND is_shared = 1 ORDER BY ran_at DESC, created_at DESC'
          )
          .all(target.id);
  }

  // Personal records ALWAYS return all 5 slots ("—" on frontend when record is null).
  // For other users, computed ONLY from shared runs & strictly subject to privacy.
  const personalRecords = computePersonalRecords(visibleRuns);

  let privacyNote = null;
  if (!canViewRuns && !isSelf) {
    if (relation === 'blocked_by_me') {
      privacyNote = 'משתמש זה חסום על ידך.';
    } else if (target.run_privacy === 'friends') {
      privacyNote = 'הריצות והשיאים של רץ זה זמינים לחברים בלבד.';
    } else {
      privacyNote = 'הרץ בחר לשמור את הריצות והשיאים שלו פרטיים.';
    }
  }

  return sendJson(res, 200, {
    profile: {
      id: target.id,
      username: target.username,
      display_name: target.display_name,
      bio: target.bio || '',
      created_at: target.created_at,
      relation,
      is_self: isSelf,
      can_view_runs: canViewRuns,
      privacy_note: privacyNote,
    },
    personal_records: personalRecords,
    runs: visibleRuns.slice(0, 50).map((r) => decorateRun(r, { includeNote: true })),
  });
}
