// Transparent ranking rules & personal records calculations for Isrunner.
// No time normalization is performed: measured duration is used as-is.
// Distances are compared using integer decimeters (distance_km * 10000) to avoid floating-point edge bugs.

export const WINDOW_EXTRA_KM = 0.25;
export const ANOMALOUS_FAST_PACE_SEC_PER_KM = 165; // Faster than 2:45 / km
export const ANOMALOUS_SLOW_PACE_SEC_PER_KM = 900; // Slower than 15:00 / km

export const RANKING_CATEGORIES = [
  {
    key: '5k',
    label: '5 ק"מ',
    shortLabel: '5 ק"מ',
    type: 'time',
    nominalKm: 5.0,
    minDecimeters: 50_000,
    maxExclusiveDecimeters: 52_500,
    rangeText: '5.00 עד 5.24 ק"מ',
  },
  {
    key: '10k',
    label: '10 ק"מ',
    shortLabel: '10 ק"מ',
    type: 'time',
    nominalKm: 10.0,
    minDecimeters: 100_000,
    maxExclusiveDecimeters: 102_500,
    rangeText: '10.00 עד 10.24 ק"מ',
  },
  {
    key: 'half',
    label: 'חצי מרתון',
    shortLabel: 'חצי מרתון',
    type: 'time',
    nominalKm: 21.0975,
    minDecimeters: 210_975,
    maxExclusiveDecimeters: 213_475,
    rangeText: '21.0975 עד 21.3474 ק"מ',
  },
  {
    key: 'marathon',
    label: 'מרתון',
    shortLabel: 'מרתון',
    type: 'time',
    nominalKm: 42.195,
    minDecimeters: 421_950,
    maxExclusiveDecimeters: 424_450,
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

export const CATEGORY_BY_KEY = Object.fromEntries(
  RANKING_CATEGORIES.map((c) => [c.key, c])
);

export function toDecimeters(distanceKm) {
  return Math.round(Number(distanceKm) * 10_000);
}

export function matchesCategory(distanceKm, categoryKey) {
  const cat = CATEGORY_BY_KEY[categoryKey];
  if (!cat) return false;
  const dm = toDecimeters(distanceKm);
  if (cat.type === 'distance') {
    return dm >= cat.minDecimeters;
  }
  return dm >= cat.minDecimeters && dm < cat.maxExclusiveDecimeters;
}

export function computePaceSecPerKm(distanceKm, durationSec) {
  if (!distanceKm || distanceKm <= 0 || !durationSec || durationSec <= 0) return null;
  return durationSec / distanceKm;
}

export function isAnomalousPace(distanceKm, durationSec) {
  const pace = computePaceSecPerKm(distanceKm, durationSec);
  if (pace === null) return false;
  return pace < ANOMALOUS_FAST_PACE_SEC_PER_KM || pace > ANOMALOUS_SLOW_PACE_SEC_PER_KM;
}

export function getSourceDisplay(sourceType, sourceVerified) {
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

export function decorateRun(run, { includeNote = true, includeTelemetry = false } = {}) {
  const paceSecPerKm = computePaceSecPerKm(run.distance_km, run.duration_sec);
  const anomalous = isAnomalousPace(run.distance_km, run.duration_sec);
  const source = getSourceDisplay(run.source_type, run.source_verified);
  const out = {
    id: run.id,
    user_id: run.user_id,
    distance_km: Number(run.distance_km),
    duration_sec: Number(run.duration_sec),
    pace_sec_per_km: paceSecPerKm !== null ? Math.round(paceSecPerKm) : null,
    is_anomalous_pace: anomalous,
    ran_at: run.ran_at,
    note: includeNote ? run.note || '' : undefined,
    is_shared: Boolean(run.is_shared),
    source,
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

/**
 * Always returns all 5 personal record slots.
 * Missing categories have `record: null` so UI renders "—".
 */
export function computePersonalRecords(runs) {
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
      const current = records[cat.key].record;
      let isBetter = false;

      if (!current) {
        isBetter = true;
      } else if (cat.type === 'time') {
        if (dur < current.duration_sec) isBetter = true;
        else if (dur === current.duration_sec && run.ran_at < current.ran_at) isBetter = true;
      } else {
        const curDm = toDecimeters(current.distance_km);
        if (dm > curDm) isBetter = true;
        else if (dm === curDm && dur < current.duration_sec) isBetter = true;
      }

      if (isBetter) {
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

/**
 * Builds ranked rows for a single category from already-privacy-filtered runs.
 * Each row has `{ user_id, display_name, username, distance_km, duration_sec, ran_at, source_type, source_verified, id }`.
 * Best single result per runner counts.
 */
export function buildLeaderboardEntries(runs, categoryKey) {
  const cat = CATEGORY_BY_KEY[categoryKey];
  if (!cat) return [];

  const bestByUser = new Map();
  for (const run of runs) {
    if (!matchesCategory(run.distance_km, categoryKey)) continue;
    const prev = bestByUser.get(run.user_id);
    let isBetter = false;
    if (!prev) {
      isBetter = true;
    } else if (cat.type === 'time') {
      if (run.duration_sec < prev.duration_sec) isBetter = true;
      else if (run.duration_sec === prev.duration_sec && run.ran_at < prev.ran_at) isBetter = true;
    } else {
      const dm = toDecimeters(run.distance_km);
      const prevDm = toDecimeters(prev.distance_km);
      if (dm > prevDm) isBetter = true;
      else if (dm === prevDm && run.duration_sec < prev.duration_sec) isBetter = true;
    }
    if (isBetter) {
      bestByUser.set(run.user_id, run);
    }
  }

  const list = Array.from(bestByUser.values());
  list.sort((a, b) => {
    if (cat.type === 'time') {
      if (a.duration_sec !== b.duration_sec) return a.duration_sec - b.duration_sec;
      return a.ran_at.localeCompare(b.ran_at);
    }
    const diffDm = toDecimeters(b.distance_km) - toDecimeters(a.distance_km);
    if (diffDm !== 0) return diffDm;
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

export const RANKING_RULE_EXPLANATION = {
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
