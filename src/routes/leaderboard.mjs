import { sendError, sendJson } from '../http-utils.mjs';
import { canViewUserRuns } from '../privacy.mjs';
import {
  CATEGORY_BY_KEY,
  RANKING_CATEGORIES,
  RANKING_RULE_EXPLANATION,
  buildLeaderboardEntries,
} from '../ranking.mjs';

export async function handleGlobalLeaderboard(req, res, ctx, url) {
  const category = url.searchParams.get('category') || '5k';
  if (!CATEGORY_BY_KEY[category]) {
    return sendError(res, 400, 'invalid_category', 'קטגוריית דירוג לא חוקית.');
  }

  const requireVerified = Boolean(
    ctx.config.resendApiKey || ctx.config.requireVerifiedEmailForLeaderboard
  );

  // Only shared runs from users who opted in to the global leaderboard AND are viewable by viewer.
  // When real email verification is enabled, only verified accounts appear in the global leaderboard.
  const rows = ctx.db
    .prepare(
      `SELECT r.id, r.user_id, r.distance_km, r.duration_sec, r.ran_at, r.source_type, r.source_verified,
              u.username, u.display_name, u.run_privacy, u.show_in_global_leaderboard, u.email_verified
       FROM runs r
       JOIN users u ON u.id = r.user_id
       WHERE r.is_shared = 1
         AND u.show_in_global_leaderboard = 1
         ${requireVerified ? 'AND u.email_verified = 1' : ''}`
    )
    .all();

  const visibleRuns = rows.filter((row) =>
    canViewUserRuns(ctx.db, ctx.user.id, {
      id: row.user_id,
      run_privacy: row.run_privacy,
    })
  );

  const entries = buildLeaderboardEntries(visibleRuns, category);
  const myEntry = entries.find((e) => e.user_id === ctx.user.id) || null;

  return sendJson(res, 200, {
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
    viewer_email_verified: Boolean(ctx.user.email_verified),
    my_entry: myEntry,
    entries,
  });
}
