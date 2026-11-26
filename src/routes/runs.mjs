import { generateId } from '../crypto.mjs';
import { verifyAndComputeGpsRun } from '../gps.mjs';
import { readJsonBody, sendError, sendJson } from '../http-utils.mjs';
import {
  canViewRun,
  deleteNotificationsForRun,
  dispatchFirstShareNotifications,
} from '../privacy.mjs';
import { decorateRun } from '../ranking.mjs';
import { runInTransaction } from '../db.mjs';

// Hardcoded constant — NOT a runtime feature flag or client toggle.
// Manual run submission remains permanently closed; runs enter ONLY via verified providers
// (/api/ingest/provider/:provider, OAuth sync/webhooks) or live server-verified GPS telemetry (/api/runs/gps).
export const MANUAL_RUN_ENTRY_CLOSED = true;
export const MANUAL_RUN_CLOSED_MESSAGE =
  'הוספת ריצות סגורה כרגע, ריצה נקלטת רק ממקור מדידה מחובר, כרגע אין מקור מחובר';

export async function handleCreateRunClosed(req, res) {
  if (MANUAL_RUN_ENTRY_CLOSED) {
    return sendError(res, 403, 'manual_run_entry_closed', MANUAL_RUN_CLOSED_MESSAGE);
  }
}

export async function handleCreateGpsRun(req, res, ctx) {
  const { body } = await readJsonBody(req, 1_500_000);
  const computed = verifyAndComputeGpsRun(body.points);
  if (!computed.ok) {
    return sendError(res, 400, computed.code, computed.message);
  }

  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  const isShared = body.is_shared === false ? 0 : 1;
  const deviceName =
    typeof body.device_name === 'string' && body.device_name.trim()
      ? body.device_name.trim().slice(0, 80)
      : 'Isrunner GPS';

  const now = new Date();
  const nowIso = now.toISOString();
  const runId = generateId();
  let notificationsSent = 0;

  runInTransaction(ctx.db, () => {
    ctx.db
      .prepare(
        `INSERT INTO runs (
          id, user_id, distance_km, duration_sec, ran_at, note, is_shared,
          first_shared_at, notifications_dispatched,
          source_type, source_verified, source_external_id, source_ingested_at,
          device_name, gps_points_count, avg_accuracy_m, splits_json, route_polyline_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, 'app_gps', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        runId,
        ctx.user.id,
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
      );

    const created = ctx.db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
    if (isShared === 1) {
      notificationsSent = dispatchFirstShareNotifications(ctx.db, created, ctx.user, now);
    }
  });

  const saved = ctx.db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  return sendJson(res, 201, {
    ok: true,
    run: decorateRun(saved, { includeNote: true, includeTelemetry: true }),
    notifications_sent: notificationsSent,
  });
}

export async function handleListMyRuns(req, res, ctx) {
  const rows = ctx.db
    .prepare('SELECT * FROM runs WHERE user_id = ? ORDER BY ran_at DESC, created_at DESC LIMIT 200')
    .all(ctx.user.id);

  return sendJson(res, 200, {
    runs: rows.map((r) => decorateRun(r, { includeNote: true })),
    manual_entry_closed: MANUAL_RUN_ENTRY_CLOSED,
    manual_entry_message: MANUAL_RUN_CLOSED_MESSAGE,
  });
}

export async function handleGetRun(req, res, ctx, runId) {
  const run = ctx.db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  if (!run) {
    return sendError(res, 404, 'not_found', 'הריצה לא נמצאה.');
  }

  const owner = ctx.db
    .prepare('SELECT id, username, display_name, run_privacy, show_in_global_leaderboard FROM users WHERE id = ?')
    .get(run.user_id);

  if (!owner || !canViewRun(ctx.db, ctx.user.id, run, owner)) {
    return sendError(res, 404, 'not_found', 'הריצה לא נמצאה או שאין הרשאה לצפות בה.');
  }

  const isOwner = ctx.user.id === run.user_id;
  return sendJson(res, 200, {
    run: {
      ...decorateRun(run, { includeNote: true, includeTelemetry: true }),
      owner: {
        id: owner.id,
        username: owner.username,
        display_name: owner.display_name,
      },
      is_owner: isOwner,
    },
  });
}

export async function handleToggleRunShare(req, res, ctx, runId) {
  const run = ctx.db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  if (!run || run.user_id !== ctx.user.id) {
    return sendError(res, 404, 'not_found', 'הריצה לא נמצאה.');
  }

  const { body } = await readJsonBody(req);
  if (typeof body.is_shared !== 'boolean') {
    return sendError(res, 400, 'invalid_is_shared', 'נדרש ערך בוליאני עבור is_shared.');
  }

  const nextShared = body.is_shared ? 1 : 0;
  const now = new Date();
  const nowIso = now.toISOString();
  let notificationsSent = 0;

  runInTransaction(ctx.db, () => {
    ctx.db
      .prepare('UPDATE runs SET is_shared = ?, updated_at = ? WHERE id = ?')
      .run(nextShared, nowIso, runId);

    if (nextShared === 0) {
      // Immediately revoke notifications & visibility when run becomes private
      deleteNotificationsForRun(ctx.db, runId);
    } else {
      const freshRun = ctx.db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
      notificationsSent = dispatchFirstShareNotifications(ctx.db, freshRun, ctx.user, now);
    }
  });

  const updated = ctx.db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  return sendJson(res, 200, {
    run: decorateRun(updated, { includeNote: true }),
    notifications_sent: notificationsSent,
  });
}

export async function handleUpdateRunNote(req, res, ctx, runId) {
  const run = ctx.db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  if (!run || run.user_id !== ctx.user.id) {
    return sendError(res, 404, 'not_found', 'הריצה לא נמצאה.');
  }

  const { body } = await readJsonBody(req);
  // Only the text note can be edited — distance, duration, date, and source provenance are immutable.
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  const nowIso = new Date().toISOString();

  ctx.db.prepare('UPDATE runs SET note = ?, updated_at = ? WHERE id = ?').run(note, nowIso, runId);
  const updated = ctx.db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  return sendJson(res, 200, { run: decorateRun(updated, { includeNote: true }) });
}

export async function handleDeleteRun(req, res, ctx, runId) {
  const run = ctx.db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  if (!run || run.user_id !== ctx.user.id) {
    return sendError(res, 404, 'not_found', 'הריצה לא נמצאה.');
  }

  runInTransaction(ctx.db, () => {
    deleteNotificationsForRun(ctx.db, runId);
    ctx.db.prepare('DELETE FROM runs WHERE id = ?').run(runId);
  });

  return sendJson(res, 200, { ok: true, deleted_run_id: runId });
}
