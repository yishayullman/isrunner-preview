import { sendJson } from '../http-utils.mjs';
import { canViewUserRuns, getAcceptedFriendIds, isBlockedBetween } from '../privacy.mjs';
import { computePaceSecPerKm, computePersonalRecords, decorateRun } from '../ranking.mjs';
import { MANUAL_RUN_CLOSED_MESSAGE, MANUAL_RUN_ENTRY_CLOSED } from './runs.mjs';

/**
 * Computes start of the current Israeli week (Sunday 00:00 in Asia/Jerusalem) as a UTC Date.
 */
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

  // Compute Israel local wall clock offset relative to UTC
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

export async function handleGetHome(req, res, ctx) {
  const userId = ctx.user.id;
  const now = new Date();
  const weekStartDate = getStartOfIsraeliWeekUtc(now);
  const weekStartIso = weekStartDate.toISOString();
  const fourteenDaysAgoIso = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  // Build 6 weekly buckets (oldest -> current week)
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

  // Own runs (all runs, including private, because viewer IS the owner)
  const ownRuns = ctx.db
    .prepare('SELECT * FROM runs WHERE user_id = ? ORDER BY ran_at DESC, created_at DESC')
    .all(userId);

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

  const avgPaceSecPerKm =
    totalKm > 0 ? Math.round(computePaceSecPerKm(totalKm, totalSec)) : null;

  const personalRecords = computePersonalRecords(ownRuns);

  // In-app notifications (explicitly omits run.note!)
  const rawNotifications = ctx.db
    .prepare(
      `SELECT n.id, n.actor_id, n.run_id, n.is_read, n.created_at,
              u.username AS actor_username, u.display_name AS actor_display_name, u.run_privacy AS actor_privacy,
              r.distance_km, r.duration_sec, r.ran_at, r.is_shared, r.source_type, r.source_verified
       FROM notifications n
       JOIN users u ON u.id = n.actor_id
       JOIN runs r ON r.id = n.run_id
       WHERE n.recipient_id = ?
       ORDER BY n.created_at DESC
       LIMIT 30`
    )
    .all(userId);

  const notifications = [];
  let unreadCount = 0;
  for (const n of rawNotifications) {
    if (!n.is_shared) continue;
    if (isBlockedBetween(ctx.db, userId, n.actor_id)) continue;
    if (!canViewUserRuns(ctx.db, userId, { id: n.actor_id, run_privacy: n.actor_privacy })) {
      continue;
    }
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

  // Friends activity: last 14 days, newest first, only shared runs & respecting privacy/blocks
  const friendIds = getAcceptedFriendIds(ctx.db, userId);
  let friendsActivity = [];
  if (friendIds.length > 0) {
    const placeholders = friendIds.map(() => '?').join(',');
    const rows = ctx.db
      .prepare(
        `SELECT r.*, u.username, u.display_name, u.run_privacy
         FROM runs r
         JOIN users u ON u.id = r.user_id
         WHERE r.user_id IN (${placeholders})
           AND r.is_shared = 1
           AND r.ran_at >= ?
         ORDER BY r.ran_at DESC, r.created_at DESC
         LIMIT 50`
      )
      .all(...friendIds, fourteenDaysAgoIso);

    friendsActivity = rows
      .filter((row) =>
        canViewUserRuns(ctx.db, userId, { id: row.user_id, run_privacy: row.run_privacy })
      )
      .map((row) => ({
        ...decorateRun(row, { includeNote: true }),
        runner: {
          id: row.user_id,
          username: row.username,
          display_name: row.display_name,
        },
      }));
  }

  const activeSource = ctx.db
    .prepare(
      `SELECT provider, connected_at, last_sync_at FROM provider_connections
       WHERE user_id = ? AND status = 'active' LIMIT 1`
    )
    .get(userId);
  const serverGarminReady = Boolean(
    ctx.config.garminConsumerKey &&
      ctx.config.garminConsumerSecret &&
      ctx.config.garminWebhookSecret
  );

  return sendJson(res, 200, {
    summary: {
      weekly_km: Math.round(weeklyKm * 100) / 100,
      weekly_runs_count: weeklyRunsCount,
      weekly_goal_km: ctx.user.weekly_goal_km !== null ? Number(ctx.user.weekly_goal_km) : null,
      week_start_iso: weekStartIso,
      avg_pace_sec_per_km: avgPaceSecPerKm,
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
      has_connected_source: Boolean(activeSource && serverGarminReady),
    },
    personal_records: personalRecords,
    unread_notifications_count: unreadCount,
    notifications,
    friends_activity: friendsActivity,
    recent_runs: ownRuns.slice(0, 10).map((r) => decorateRun(r, { includeNote: true })),
  });
  }
