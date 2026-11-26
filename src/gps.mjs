// Server-side GPS telemetry verification & computation for Isrunner in-app GPS runs.
// Distance, net moving duration, 1-km splits, and route polyline are ALWAYS computed server-side
// from raw GPS points — never trusted from client-submitted summary totals.

const EARTH_RADIUS_M = 6_371_000;
const MAX_GPS_POINTS = 15_000;
const MIN_VALID_POINTS = 3;
const MAX_ACCURACY_M = 50;
const MAX_SEGMENT_GAP_SEC = 60;
const MAX_PLAUSIBLE_SPEED_MPS = 12.0; // ~1:23 / km (faster than sprint world record -> GPS jump)
const MIN_DISTANCE_KM = 0.05; // 50m minimum
const MIN_DURATION_SEC = 10;
const MAX_POLYLINE_POINTS = 120;

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function downsampleRoute(coords, maxPoints = MAX_POLYLINE_POINTS) {
  if (coords.length <= maxPoints) {
    return coords.map(([lat, lng]) => [
      Math.round(lat * 100000) / 100000,
      Math.round(lng * 100000) / 100000,
    ]);
  }
  const out = [];
  const step = (coords.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    const idx = Math.min(coords.length - 1, Math.round(i * step));
    const [lat, lng] = coords[idx];
    out.push([Math.round(lat * 100000) / 100000, Math.round(lng * 100000) / 100000]);
  }
  return out;
}

/**
 * Validates raw GPS trackpoints and recomputes distance_km, duration_sec, splits,
 * avg_accuracy_m, and route_polyline strictly server-side.
 *
 * Returns `{ ok: true, data }` or `{ ok: false, code, message }`.
 */
export function verifyAndComputeGpsRun(rawPoints) {
  if (!Array.isArray(rawPoints) || rawPoints.length < MIN_VALID_POINTS) {
    return {
      ok: false,
      code: 'insufficient_gps_points',
      message: 'נדרשות לפחות 3 נקודות GPS תקינות כדי לשמור ריצה שנמדדה באפליקציה.',
    };
  }
  if (rawPoints.length > MAX_GPS_POINTS) {
    return {
      ok: false,
      code: 'too_many_gps_points',
      message: 'מספר נקודות ה-GPS חורג מהמותר לבקשה אחת.',
    };
  }

  const valid = [];
  let accuracySum = 0;
  let accuracyCount = 0;

  for (const pt of rawPoints) {
    if (!pt || typeof pt !== 'object') continue;
    const lat = Number(pt.lat);
    const lng = Number(pt.lng);
    const ts = Number(pt.ts);
    const acc = pt.acc !== undefined && pt.acc !== null ? Number(pt.acc) : null;
    const seg = Number.isInteger(pt.seg) ? pt.seg : 0;

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) continue;
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) continue;
    if (!Number.isFinite(ts) || ts <= 0) continue;
    if (acc !== null && (!Number.isFinite(acc) || acc < 0 || acc > MAX_ACCURACY_M)) continue;

    if (valid.length > 0 && ts <= valid[valid.length - 1].ts) {
      continue;
    }

    valid.push({ lat, lng, ts, acc, seg });
    if (acc !== null) {
      accuracySum += acc;
      accuracyCount += 1;
    }
  }

  if (valid.length < MIN_VALID_POINTS) {
    return {
      ok: false,
      code: 'poor_gps_signal',
      message: 'לא נקלטו מספיק נקודות GPS מדויקות (דיוק עד 50 מ׳). מומלץ למדוד בחוץ בשטח פתוח.',
    };
  }

  let totalMeters = 0;
  let totalSec = 0;
  let rejectedJumpMeters = 0;
  const splits = [];
  let nextKmTarget = 1000;
  let prevSplitElapsedSec = 0;
  const routeCoords = [[valid[0].lat, valid[0].lng]];

  for (let i = 1; i < valid.length; i += 1) {
    const prev = valid[i - 1];
    const cur = valid[i];

    // Pause boundary: start a new segment without adding paused time or jump distance
    if (cur.seg !== prev.seg) {
      routeCoords.push([cur.lat, cur.lng]);
      continue;
    }

    const dtSec = (cur.ts - prev.ts) / 1000;
    if (dtSec <= 0 || dtSec > MAX_SEGMENT_GAP_SEC) {
      routeCoords.push([cur.lat, cur.lng]);
      continue;
    }

    const stepMeters = haversineMeters(prev.lat, prev.lng, cur.lat, cur.lng);
    const speedMps = stepMeters / dtSec;

    if (speedMps > MAX_PLAUSIBLE_SPEED_MPS && stepMeters > 25) {
      rejectedJumpMeters += stepMeters;
      continue;
    }

    const effectiveStep = speedMps < 0.25 && stepMeters < 1.0 ? 0 : stepMeters;
    const prevDist = totalMeters;
    const prevElapsed = totalSec;

    totalMeters += effectiveStep;
    totalSec += dtSec;
    routeCoords.push([cur.lat, cur.lng]);

    // Interpolate 1-km split crossings accurately
    while (effectiveStep > 0 && totalMeters >= nextKmTarget) {
      const frac = (nextKmTarget - prevDist) / effectiveStep;
      const crossingSec = prevElapsed + dtSec * Math.max(0, Math.min(1, frac));
      const splitSec = Math.max(1, Math.round(crossingSec - prevSplitElapsedSec));
      splits.push({
        km: Math.round(nextKmTarget / 1000),
        split_sec: splitSec,
        elapsed_sec: Math.round(crossingSec),
        pace_sec_per_km: splitSec,
      });
      prevSplitElapsedSec = crossingSec;
      nextKmTarget += 1000;
    }
  }

  const distanceKm = Math.round((totalMeters / 1000) * 10000) / 10000;
  const durationSec = Math.round(totalSec);

  if (distanceKm < MIN_DISTANCE_KM) {
    return {
      ok: false,
      code: 'distance_too_short',
      message: 'המרחק שנמדד קצר מדי (נדרשים לפחות 50 מטרים של תנועה ב-GPS).',
    };
  }
  if (distanceKm > 500) {
    return {
      ok: false,
      code: 'distance_too_long',
      message: 'המרחק שנמדד חורג מהגבול המותר (500 ק"מ).',
    };
  }
  if (durationSec < MIN_DURATION_SEC || durationSec > 604800) {
    return {
      ok: false,
      code: 'invalid_duration',
      message: 'משך הריצה שנמדד חייב להיות לפחות 10 שניות.',
    };
  }
  if (rejectedJumpMeters > totalMeters * 0.4 && rejectedJumpMeters > 200) {
    return {
      ok: false,
      code: 'gps_jumps_detected',
      message: 'זוהו קפיצות GPS חריגות מדי במסלול ולא ניתן לאמת את המדידה.',
    };
  }

  const avgAccuracyM =
    accuracyCount > 0 ? Math.round((accuracySum / accuracyCount) * 10) / 10 : null;

  return {
    ok: true,
    data: {
      distance_km: distanceKm,
      duration_sec: durationSec,
      ran_at: new Date(valid[0].ts).toISOString(),
      gps_points_count: valid.length,
      avg_accuracy_m: avgAccuracyM,
      splits,
      route_polyline: downsampleRoute(routeCoords),
    },
  };
}
