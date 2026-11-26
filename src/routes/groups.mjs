import { generateId, generateJoinCode } from '../crypto.mjs';
import { runInTransaction } from '../db.mjs';
import { getClientIp, readJsonBody, sendError, sendJson } from '../http-utils.mjs';
import { canViewUserRuns, isBlockedBetween } from '../privacy.mjs';
import {
  CATEGORY_BY_KEY,
  RANKING_CATEGORIES,
  RANKING_RULE_EXPLANATION,
  buildLeaderboardEntries,
} from '../ranking.mjs';

export async function handleListMyGroups(req, res, ctx) {
  const rows = ctx.db
    .prepare(
      `SELECT g.id, g.name, g.description, g.join_code, g.owner_id, g.created_at,
              gm.role, gm.joined_at,
              (SELECT COUNT(*) FROM group_members gm2 WHERE gm2.group_id = g.id) AS member_count
       FROM group_members gm
       JOIN groups g ON g.id = gm.group_id
       WHERE gm.user_id = ?
       ORDER BY g.created_at DESC`
    )
    .all(ctx.user.id);

  return sendJson(res, 200, { groups: rows });
}

export async function handleCreateGroup(req, res, ctx) {
  const ip = getClientIp(req);
  const rl = ctx.rateLimiter.check(`create_group:${ctx.user.id}:${ip}`, 10, 60 * 60 * 1000);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return sendError(res, 429, 'rate_limited', 'יצרת יותר מדי קבוצות לאחרונה. נסה שוב מאוחר יותר.');
  }

  const { body } = await readJsonBody(req);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description =
    typeof body.description === 'string' ? body.description.trim().slice(0, 300) : '';

  if (name.length < 2 || name.length > 50) {
    return sendError(res, 400, 'invalid_name', 'שם הקבוצה חייב להכיל 2 עד 50 תווים.');
  }

  const groupId = generateId();
  const nowIso = new Date().toISOString();

  let joinCode = '';
  for (let i = 0; i < 8; i++) {
    const candidate = generateJoinCode(6);
    const exists = ctx.db
      .prepare('SELECT 1 FROM groups WHERE join_code = ? COLLATE NOCASE')
      .get(candidate);
    if (!exists) {
      joinCode = candidate;
      break;
    }
  }
  if (!joinCode) {
    joinCode = generateJoinCode(8);
  }

  runInTransaction(ctx.db, () => {
    ctx.db
      .prepare(
        `INSERT INTO groups (id, name, description, join_code, owner_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(groupId, name, description, joinCode, ctx.user.id, nowIso);

    ctx.db
      .prepare(
        `INSERT INTO group_members (group_id, user_id, role, joined_at)
         VALUES (?, ?, 'owner', ?)`
      )
      .run(groupId, ctx.user.id, nowIso);
  });

  const group = ctx.db
    .prepare(
      `SELECT g.*, 1 AS member_count, 'owner' AS role
       FROM groups g WHERE g.id = ?`
    )
    .get(groupId);

  return sendJson(res, 201, { group });
}

export async function handlePreviewGroupByCode(req, res, ctx, url) {
  const ip = getClientIp(req);
  const rl = ctx.rateLimiter.check(`group_preview:${ctx.user.id}:${ip}`, 25, 15 * 60 * 1000);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return sendError(res, 429, 'rate_limited', 'יותר מדי חיפושי קוד הצטרפות. המתן מעט.');
  }

  const code = (url.searchParams.get('code') || '').trim().toUpperCase();
  if (code.length < 4 || code.length > 12) {
    return sendError(res, 400, 'invalid_code', 'קוד הצטרפות לא תקין.');
  }

  const group = ctx.db
    .prepare(
      `SELECT g.id, g.name, g.description, g.join_code, g.created_at,
              u.display_name AS owner_display_name,
              (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count
       FROM groups g
       JOIN users u ON u.id = g.owner_id
       WHERE g.join_code = ? COLLATE NOCASE`
    )
    .get(code);

  if (!group) {
    return sendError(res, 404, 'not_found', 'לא נמצאה קבוצה עם קוד ההצטרפות הזה.');
  }

  const membership = ctx.db
    .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(group.id, ctx.user.id);

  return sendJson(res, 200, {
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

export async function handleJoinGroup(req, res, ctx) {
  const ip = getClientIp(req);
  const rl = ctx.rateLimiter.check(`group_join:${ctx.user.id}:${ip}`, 20, 15 * 60 * 1000);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return sendError(res, 429, 'rate_limited', 'יותר מדי ניסיונות הצטרפות. נסה שוב מאוחר יותר.');
  }

  const { body } = await readJsonBody(req);
  const code = typeof body.join_code === 'string' ? body.join_code.trim().toUpperCase() : '';
  if (!code) {
    return sendError(res, 400, 'invalid_code', 'נא להזין קוד הצטרפות.');
  }

  const group = ctx.db
    .prepare('SELECT id, name, description, join_code, owner_id FROM groups WHERE join_code = ? COLLATE NOCASE')
    .get(code);

  if (!group) {
    return sendError(res, 404, 'not_found', 'קוד ההצטרפות לא נמצא.');
  }

  const nowIso = new Date().toISOString();
  ctx.db
    .prepare(
      `INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at)
       VALUES (?, ?, 'member', ?)`
    )
    .run(group.id, ctx.user.id, nowIso);

  return sendJson(res, 200, { ok: true, group_id: group.id, name: group.name });
}

export async function handleLeaveGroup(req, res, ctx, groupId) {
  const membership = ctx.db
    .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(groupId, ctx.user.id);

  if (!membership) {
    return sendError(res, 404, 'not_found', 'אינך חבר בקבוצה זו.');
  }

  if (membership.role === 'owner') {
    const otherMembers = ctx.db
      .prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id <> ? ORDER BY joined_at ASC')
      .all(groupId, ctx.user.id);

    if (otherMembers.length === 0) {
      // Sole member leaving: delete empty group cleanly
      ctx.db.prepare('DELETE FROM groups WHERE id = ?').run(groupId);
      return sendJson(res, 200, { ok: true, group_deleted: true });
    }

    // Transfer ownership to earliest remaining member (policy choice documented in docs/open-decisions.md)
    runInTransaction(ctx.db, () => {
      const nextOwnerId = otherMembers[0].user_id;
      ctx.db.prepare('UPDATE groups SET owner_id = ? WHERE id = ?').run(nextOwnerId, groupId);
      ctx.db
        .prepare("UPDATE group_members SET role = 'owner' WHERE group_id = ? AND user_id = ?")
        .run(groupId, nextOwnerId);
      ctx.db
        .prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?')
        .run(groupId, ctx.user.id);
    });
    return sendJson(res, 200, { ok: true, ownership_transferred: true });
  }

  ctx.db
    .prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?')
    .run(groupId, ctx.user.id);
  return sendJson(res, 200, { ok: true });
}

export async function handleGetGroupDetail(req, res, ctx, groupId, url) {
  const membership = ctx.db
    .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(groupId, ctx.user.id);

  if (!membership) {
    return sendError(res, 403, 'not_a_member', 'יש להצטרף לקבוצה כדי לצפות בטבלת הדירוג ובחברים.');
  }

  const category = url.searchParams.get('category') || '5k';
  if (!CATEGORY_BY_KEY[category]) {
    return sendError(res, 400, 'invalid_category', 'קטגוריית דירוג לא חוקית.');
  }

  const group = ctx.db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  if (!group) {
    return sendError(res, 404, 'not_found', 'הקבוצה לא נמצאה.');
  }

  const members = ctx.db
    .prepare(
      `SELECT u.id, u.username, u.display_name, gm.role, gm.joined_at
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?
       ORDER BY CASE WHEN gm.role = 'owner' THEN 0 ELSE 1 END, u.display_name COLLATE NOCASE ASC`
    )
    .all(groupId)
    .filter((m) => !isBlockedBetween(ctx.db, ctx.user.id, m.id));

  // Shared runs of group members, strictly subject to each user's privacy & block status
  const rows = ctx.db
    .prepare(
      `SELECT r.id, r.user_id, r.distance_km, r.duration_sec, r.ran_at, r.source_type, r.source_verified,
              u.username, u.display_name, u.run_privacy
       FROM group_members gm
       JOIN runs r ON r.user_id = gm.user_id
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?
         AND r.is_shared = 1`
    )
    .all(groupId);

  const visibleRuns = rows.filter((row) =>
    canViewUserRuns(ctx.db, ctx.user.id, {
      id: row.user_id,
      run_privacy: row.run_privacy,
    })
  );

  const entries = buildLeaderboardEntries(visibleRuns, category);
  const myEntry = entries.find((e) => e.user_id === ctx.user.id) || null;

  return sendJson(res, 200, {
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
