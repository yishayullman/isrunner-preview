import { api } from '../api.js';
import {
  escapeHtml,
  formatDuration,
  formatPace,
  renderRouteSvg,
  renderSplitsTable,
  showToast,
} from '../utils.js';

const EARTH_RADIUS_M = 6_371_000;
const MAX_ACC_M = 38;
const MAX_JUMP_SPEED_MPS = 12.0;

function haversineM(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function playSplitBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    [0, 0.16].forEach((offset, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = idx === 0 ? 880 : 1175;
      gain.gain.value = 0.12;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.11);
    });
  } catch {
    // Audio cue is optional
  }
}

export async function renderTrackView(container, app) {
  const geoSupported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

  const state = {
    phase: 'idle', // idle | running | paused | finished
    watchId: null,
    timerId: null,
    wakeLock: null,
    wakeLockActive: false,
    soundEnabled: true,
    gpsStatus: geoSupported ? 'ready' : 'unsupported', // ready | waiting | good | weak | denied | unsupported
    gpsError: '',
    lastAccuracy: null,
    segment: 0,
    points: [], // { lat, lng, ts, acc, seg }
    routeCoords: [], // [lat, lng]
    distanceM: 0,
    accumulatedMs: 0,
    runStartWallMs: null,
    splits: [], // { km, split_sec, elapsed_sec, pace_sec_per_km }
    nextKmTarget: 1000,
    prevSplitElapsedSec: 0,
    currentPaceSecPerKm: null,
    targetPaceSec: null, // Optional Garmin-style pacer (sec/km)
    saving: false,
  };

  function getNetElapsedSec() {
    let ms = state.accumulatedMs;
    if (state.phase === 'running' && state.runStartWallMs) {
      ms += Date.now() - state.runStartWallMs;
    }
    return Math.max(0, Math.floor(ms / 1000));
  }

  function computeCurrentPace() {
    // Rolling smoothed pace over last ~18 seconds in current segment
    const pts = state.points;
    if (pts.length < 2) return null;
    const latest = pts[pts.length - 1];
    let dist = 0;
    let firstTs = latest.ts;
    for (let i = pts.length - 1; i > 0; i -= 1) {
      const a = pts[i - 1];
      const b = pts[i];
      if (a.seg !== latest.seg || b.seg !== latest.seg) break;
      const dt = (b.ts - a.ts) / 1000;
      if (dt <= 0 || dt > 30) break;
      dist += haversineM(a.lat, a.lng, b.lat, b.lng);
      firstTs = a.ts;
      if (latest.ts - firstTs >= 18_000 && dist >= 35) break;
    }
    const windowSec = (latest.ts - firstTs) / 1000;
    if (dist < 20 || windowSec < 4) return null;
    const pace = windowSec / (dist / 1000);
    if (pace < 90 || pace > 1800) return null;
    return Math.round(pace);
  }

  async function requestWakeLock() {
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLockActive = true;
      state.wakeLock.addEventListener('release', () => {
        state.wakeLockActive = false;
        updateLiveNodes();
      });
    } catch {
      state.wakeLockActive = false;
    }
    updateLiveNodes();
  }

  async function releaseWakeLock() {
    if (state.wakeLock) {
      try {
        await state.wakeLock.release();
      } catch {
        // ignore
      }
      state.wakeLock = null;
      state.wakeLockActive = false;
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible' && state.phase === 'running' && !state.wakeLockActive) {
      requestWakeLock();
    }
  }

  function stopWatchers() {
    if (state.watchId !== null && geoSupported) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
    if (state.timerId !== null) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
    releaseWakeLock();
  }

  if (typeof app.setCleanup === 'function') {
    app.setCleanup(() => stopWatchers());
  }

  function handleGpsPosition(pos) {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const acc = Math.round(pos.coords.accuracy || 0);
    const ts = pos.timestamp || Date.now();

    state.lastAccuracy = acc;
    state.gpsError = '';
    state.gpsStatus = acc <= MAX_ACC_M ? 'good' : 'weak';

    if (state.phase !== 'running') {
      updateLiveNodes();
      return;
    }

    if (acc > MAX_ACC_M) {
      updateLiveNodes();
      return;
    }

    const pt = { lat, lng, ts, acc, seg: state.segment };
    const prev = state.points.length > 0 ? state.points[state.points.length - 1] : null;

    if (prev && ts <= prev.ts) {
      updateLiveNodes();
      return;
    }

    if (prev && prev.seg === state.segment) {
      const dtSec = (ts - prev.ts) / 1000;
      if (dtSec > 0 && dtSec <= 60) {
        const stepM = haversineM(prev.lat, prev.lng, lat, lng);
        const speedMps = stepM / dtSec;
        if (speedMps > MAX_JUMP_SPEED_MPS && stepM > 25) {
          // Ignore GPS teleport jump
          updateLiveNodes();
          return;
        }
        const effectiveM = speedMps < 0.25 && stepM < 1.0 ? 0 : stepM;
        const prevDist = state.distanceM;
        const elapsedNowSec = getNetElapsedSec();
        state.distanceM += effectiveM;

        while (effectiveM > 0 && state.distanceM >= state.nextKmTarget) {
          const frac = (state.nextKmTarget - prevDist) / effectiveM;
          const crossingSec = Math.max(
            state.prevSplitElapsedSec + 1,
            Math.round(elapsedNowSec - dtSec * (1 - Math.max(0, Math.min(1, frac))))
          );
          const splitSec = Math.max(1, crossingSec - state.prevSplitElapsedSec);
          state.splits.push({
            km: Math.round(state.nextKmTarget / 1000),
            split_sec: splitSec,
            elapsed_sec: crossingSec,
            pace_sec_per_km: splitSec,
          });
          state.prevSplitElapsedSec = crossingSec;
          state.nextKmTarget += 1000;
          if (state.soundEnabled) playSplitBeep();
          renderSplitsNode();
        }
      }
    }

    state.points.push(pt);
    state.routeCoords.push([lat, lng]);
    state.currentPaceSecPerKm = computeCurrentPace();
    updateLiveNodes();
    renderRouteNode();
  }

  function handleGpsError(err) {
    if (err.code === 1) {
      state.gpsStatus = 'denied';
      state.gpsError =
        'גישה למיקום נדחתה. באייפון: הגדרות -> פרטיות ואבטחה -> שירותי מיקום -> Safari -> "בעת שימוש באפליקציה".';
    } else if (err.code === 2) {
      state.gpsStatus = 'weak';
      state.gpsError = 'אות GPS לא זמין כרגע — מומלץ לצאת לשטח פתוח ולהמתין כמה שניות.';
    } else {
      state.gpsStatus = 'waiting';
      state.gpsError = 'עדיין מאתר לווייני GPS...';
    }
    updateLiveNodes();
  }

  function startGpsWatch() {
    if (!geoSupported || state.watchId !== null) return;
    if (state.gpsStatus === 'ready') state.gpsStatus = 'waiting';
    state.watchId = navigator.geolocation.watchPosition(handleGpsPosition, handleGpsError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000,
    });
  }

  function startRun() {
    if (!geoSupported) {
      showToast('הדפדפן הזה אינו תומך ב-GPS.', { error: true });
      return;
    }
    state.phase = 'running';
    state.runStartWallMs = Date.now();
    startGpsWatch();
    requestWakeLock();
    document.addEventListener('visibilitychange', onVisibilityChange);
    if (!state.timerId) {
      state.timerId = setInterval(updateLiveNodes, 250);
    }
    draw();
  }

  function pauseRun() {
    if (state.phase !== 'running') return;
    if (state.runStartWallMs) {
      state.accumulatedMs += Date.now() - state.runStartWallMs;
      state.runStartWallMs = null;
    }
    state.phase = 'paused';
    state.currentPaceSecPerKm = null;
    draw();
  }

  function resumeRun() {
    if (state.phase !== 'paused') return;
    state.segment += 1;
    state.phase = 'running';
    state.runStartWallMs = Date.now();
    requestWakeLock();
    draw();
  }

  function finishRun() {
    if (state.phase === 'running' && state.runStartWallMs) {
      state.accumulatedMs += Date.now() - state.runStartWallMs;
      state.runStartWallMs = null;
    }
    stopWatchers();
    state.phase = 'finished';
    draw();
  }

  function resetRun() {
    stopWatchers();
    state.phase = 'idle';
    state.segment = 0;
    state.points = [];
    state.routeCoords = [];
    state.distanceM = 0;
    state.accumulatedMs = 0;
    state.runStartWallMs = null;
    state.splits = [];
    state.nextKmTarget = 1000;
    state.prevSplitElapsedSec = 0;
    state.currentPaceSecPerKm = null;
    state.gpsError = '';
    state.gpsStatus = geoSupported ? 'ready' : 'unsupported';
    draw();
  }

  function getGpsBadgeHtml() {
    if (state.gpsStatus === 'unsupported') {
      return '<span class="gps-pill gps-bad"><i></i>GPS לא נתמך</span>';
    }
    if (state.gpsStatus === 'denied') {
      return '<span class="gps-pill gps-bad"><i></i>אין הרשאת מיקום</span>';
    }
    if (state.gpsStatus === 'ready') {
      return '<span class="gps-pill gps-ok"><i></i>GPS מוכן</span>';
    }
    if (state.gpsStatus === 'good') {
      const label = state.lastAccuracy <= 15 ? 'GPS מדויק' : 'GPS טוב';
      return `<span class="gps-pill gps-ok"><i></i>${label} (±${state.lastAccuracy}מ׳)</span>`;
    }
    if (state.gpsStatus === 'weak') {
      return `<span class="gps-pill gps-warn"><i></i>GPS חלש (±${state.lastAccuracy || '?'}מ׳)</span>`;
    }
    return '<span class="gps-pill gps-warn"><i></i>מאתר GPS...</span>';
  }

  function updateLiveNodes() {
    const distKm = state.distanceM / 1000;
    const elapsedSec = getNetElapsedSec();
    const avgPace = distKm >= 0.03 && elapsedSec > 0 ? Math.round(elapsedSec / distKm) : null;
    const kmProgressM = Math.round(state.distanceM % 1000);
    const kmProgressPct = Math.min(100, Math.round((kmProgressM / 1000) * 100));

    const elDist = container.querySelector('#live-dist');
    const elTime = container.querySelector('#live-time');
    const elAvgPace = container.querySelector('#live-avg-pace');
    const elCurPace = container.querySelector('#live-cur-pace');
    const elGps = container.querySelector('#live-gps-slot');
    const elWake = container.querySelector('#live-wake-pill');
    const elKmText = container.querySelector('#live-km-progress-text');
    const elKmBar = container.querySelector('#live-km-progress-bar');
    const elErr = container.querySelector('#live-gps-error');
    const elPacerDelta = container.querySelector('#live-pacer-delta');

    if (elDist) elDist.textContent = distKm.toFixed(2);
    if (elTime) elTime.textContent = formatDuration(elapsedSec) === '—' ? '0:00' : formatDuration(elapsedSec);
    if (elAvgPace) elAvgPace.textContent = avgPace ? formatPace(avgPace).replace(" דק'/ק\"מ", '') : '—';
    if (elCurPace) {
      elCurPace.textContent = state.currentPaceSecPerKm
        ? formatPace(state.currentPaceSecPerKm).replace(" דק'/ק\"מ", '')
        : '—';
    }
    if (elGps) elGps.innerHTML = getGpsBadgeHtml();
    if (elWake) {
      elWake.textContent = state.wakeLockActive ? 'מסך נשאר ער' : 'שמירת מסך כבויה';
      elWake.classList.toggle('active', state.wakeLockActive);
    }
    if (elKmText) elKmText.textContent = `${kmProgressM} / 1,000 מ׳ לק"מ הבא`;
    if (elKmBar) elKmBar.style.width = `${kmProgressPct}%`;
    if (elErr) {
      elErr.textContent = state.gpsError;
      elErr.classList.toggle('hidden', !state.gpsError);
    }
    if (elPacerDelta && state.targetPaceSec && distKm >= 0.05) {
      const targetElapsed = Math.round(distKm * state.targetPaceSec);
      const diff = targetElapsed - elapsedSec; // positive = ahead of target!
      if (diff >= 0) {
        elPacerDelta.className = 'pacer-ahead tabular';
        elPacerDelta.textContent = `מקדים ב-${diff} שנ׳`;
      } else {
        elPacerDelta.className = 'pacer-behind tabular';
        elPacerDelta.textContent = `מאחר ב-${Math.abs(diff)} שנ׳`;
      }
    }
  }

  function renderRouteNode() {
    const slot = container.querySelector('#live-route-slot');
    if (slot) slot.innerHTML = renderRouteSvg(state.routeCoords, { dark: true });
  }

  function renderSplitsNode() {
    const slot = container.querySelector('#live-splits-slot');
    if (slot) {
      slot.innerHTML =
        state.splits.length > 0
          ? renderSplitsTable(state.splits)
          : '<div class="empty-state">כל קילומטר שלם שיושלם יופיע כאן אוטומטית עם הקצב שלו.</div>';
    }
  }

  function draw() {
    const distKm = state.distanceM / 1000;
    const elapsedSec = getNetElapsedSec();
    const avgPace = distKm >= 0.03 && elapsedSec > 0 ? Math.round(elapsedSec / distKm) : null;
    const canSave = state.points.length >= 3 && distKm >= 0.05 && elapsedSec >= 10;

    if (state.phase === 'finished') {
      container.innerHTML = `
        <h1 class="page-title">סיכום ריצה</h1>

        <section class="card hero-card">
          <div class="card-header">
            <div>
              <h2 class="card-title">מדידת GPS הושלמה</h2>
              <p class="card-subtitle">השרת יחשב ויאמת מחדש את המרחק והזמן ישירות מנקודות ה-GPS</p>
            </div>
            <span class="badge badge-verified">Isrunner GPS</span>
          </div>

          <div class="track-big-distance">
            <span class="tabular">${distKm.toFixed(2)}</span>
            <small>ק"מ</small>
          </div>

          <div class="track-metrics-row">
            <div class="stat-tile">
              <div class="stat-label">זמן נטו</div>
              <div class="stat-value tabular">${formatDuration(elapsedSec) === '—' ? '0:00' : formatDuration(elapsedSec)}</div>
            </div>
            <div class="stat-tile">
              <div class="stat-label">קצב ממוצע</div>
              <div class="stat-value tabular">${avgPace ? formatPace(avgPace).replace(" דק'/ק\"מ", '') : '—'}</div>
              <div class="stat-sub">דק'/ק"מ</div>
            </div>
            <div class="stat-tile">
              <div class="stat-label">נקודות GPS</div>
              <div class="stat-value tabular">${state.points.length}</div>
            </div>
          </div>

          <div style="margin-top:14px;">${renderRouteSvg(state.routeCoords, { dark: true })}</div>
        </section>

        ${
          state.splits.length > 0
            ? `<section class="card">
                 <h2 class="card-title" style="margin-bottom:10px;">פיצולי ק"מ (Splits)</h2>
                 ${renderSplitsTable(state.splits)}
               </section>`
            : ''
        }

        <section class="card">
          ${
            !canSave
              ? `<div class="alert-amber" style="margin-bottom:12px;">
                   הריצה קצרה מדי לשמירה (נדרשות לפחות 3 נקודות GPS תקינות, 50 מטר תנועה ו-10 שניות).
                 </div>`
              : `<form id="save-gps-run-form">
                   <div class="form-group">
                     <label class="form-label" for="gps-run-note">הערה לריצה (אופציונלי)</label>
                     <textarea id="gps-run-note" class="textarea" maxlength="500" placeholder="איך הרגשת בריצה?"></textarea>
                   </div>
                   <label class="checkbox-row" style="margin-bottom:14px;">
                     <input type="checkbox" id="gps-run-shared" checked />
                     <span>שתף ריצה זו עם חברים ובדירוגים (בהתאם להגדרות הפרטיות שלך)</span>
                   </label>
                   <div class="btn-row">
                     <button type="submit" id="btn-save-gps-run" class="btn btn-primary btn-block" ${state.saving ? 'disabled' : ''}>
                       ${state.saving ? 'מאמת ושומר בשרת...' : 'שמור ריצה ל-Isrunner'}
                     </button>
                   </div>
                 </form>`
          }
          <div class="btn-row" style="margin-top:10px;">
            <button type="button" id="btn-discard-gps-run" class="btn btn-outline btn-block">
              מחק ופתח מדידה חדשה
            </button>
          </div>
        </section>
      `;

      const form = container.querySelector('#save-gps-run-form');
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (state.saving) return;
          state.saving = true;
          const btn = container.querySelector('#btn-save-gps-run');
          if (btn) {
            btn.disabled = true;
            btn.textContent = 'מאמת ושומר בשרת...';
          }
          try {
            const note = container.querySelector('#gps-run-note')?.value?.trim() || '';
            const isShared = container.querySelector('#gps-run-shared')?.checked !== false;
            const res = await api.createGpsRun({
              points: state.points,
              note,
              is_shared: isShared,
              device_name: 'Isrunner GPS (דפדפן)',
            });
            showToast('הריצה אומתה ונשמרה בהצלחה!');
            app.navigate(`#/run/${encodeURIComponent(res.run.id)}`);
          } catch (err) {
            state.saving = false;
            if (btn) {
              btn.disabled = false;
              btn.textContent = 'שמור ריצה ל-Isrunner';
            }
            showToast(err.message, { error: true });
          }
        });
      }

      container.querySelector('#btn-discard-gps-run').addEventListener('click', () => {
        resetRun();
      });
      return;
    }

    container.innerHTML = `
      <div class="card-header" style="margin-bottom:10px;">
        <div>
          <h1 class="page-title" style="margin-bottom:2px;">מדידת ריצה חיה (GPS)</h1>
          <p class="card-subtitle">מדידה ישירה מהטלפון — מרחק, זמן, קצב חי ופיצולי ק"מ</p>
        </div>
      </div>

      <section class="card hero-card" id="gps-cockpit-card">
        <div class="track-status-bar">
          <div id="live-gps-slot">${getGpsBadgeHtml()}</div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <span id="live-wake-pill" class="wake-pill ${state.wakeLockActive ? 'active' : ''}">
              ${state.wakeLockActive ? 'מסך נשאר ער' : 'שמירת מסך כבויה'}
            </span>
            <button type="button" id="btn-toggle-sound" class="btn btn-outline btn-sm" style="min-height:30px;padding:3px 10px;font-size:0.76rem;">
              ${state.soundEnabled ? 'צליל כל ק"מ: פעיל' : 'צליל כל ק"מ: כבוי'}
            </button>
          </div>
        </div>

        <div id="live-gps-error" class="alert-error ${state.gpsError ? '' : 'hidden'}" style="margin-top:10px;margin-bottom:0;">
          ${escapeHtml(state.gpsError)}
        </div>

        <div class="track-big-distance">
          <span id="live-dist" class="tabular">${distKm.toFixed(2)}</span>
          <small>ק"מ</small>
        </div>

        <div class="track-metrics-row">
          <div class="stat-tile">
            <div class="stat-label">זמן נטו</div>
            <div id="live-time" class="stat-value tabular">${formatDuration(elapsedSec) === '—' ? '0:00' : formatDuration(elapsedSec)}</div>
          </div>
          <div class="stat-tile">
            <div class="stat-label">קצב ממוצע</div>
            <div id="live-avg-pace" class="stat-value tabular">${avgPace ? formatPace(avgPace).replace(" דק'/ק\"מ", '') : '—'}</div>
            <div class="stat-sub">דק'/ק"מ</div>
          </div>
          <div class="stat-tile">
            <div class="stat-label">קצב נוכחי</div>
            <div id="live-cur-pace" class="stat-value tabular">${state.currentPaceSecPerKm ? formatPace(state.currentPaceSecPerKm).replace(" דק'/ק\"מ", '') : '—'}</div>
            <div class="stat-sub">דק'/ק"מ</div>
          </div>
        </div>

        <div class="pacer-row">
          <span style="color:rgba(255,255,255,0.72);font-weight:600;">
            ${
              state.targetPaceSec
                ? `קצב יעד: <strong class="tabular" style="color:#fff;">${formatPace(state.targetPaceSec).replace(" דק'/ק\"מ", '')}</strong> · <span id="live-pacer-delta" class="pacer-ahead">מוכן</span>`
                : 'קצב יעד (Pacer):'
            }
          </span>
          <div class="pacer-pills">
            ${[
              [null, 'ללא'],
              [270, '4:30'],
              [300, '5:00'],
              [330, '5:30'],
              [360, '6:00'],
              [390, '6:30'],
            ]
              .map(
                ([sec, lbl]) => `
                  <button type="button" class="pacer-chip ${state.targetPaceSec === sec ? 'active' : ''}" data-pacer="${sec === null ? '' : sec}">${lbl}</button>
                `
              )
              .join('')}
          </div>
        </div>

        <div style="margin-top:12px;">
          <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:rgba(255,255,255,0.62);">
            <span id="live-km-progress-text" class="tabular">${Math.round(state.distanceM % 1000)} / 1,000 מ׳ לק"מ הבא</span>
            <span>${state.phase === 'paused' ? 'מושהה' : state.phase === 'running' ? 'מקליט GPS' : 'מוכן ליציאה'}</span>
          </div>
          <div class="progress-bar-wrap">
            <div id="live-km-progress-bar" class="progress-bar-fill" style="width:${Math.min(100, Math.round(((state.distanceM % 1000) / 1000) * 100))}%"></div>
          </div>
        </div>

        <div id="live-route-slot" style="margin-top:14px;">
          ${renderRouteSvg(state.routeCoords, { dark: true })}
        </div>

        <div class="track-controls">
          ${
            state.phase === 'idle'
              ? '<button type="button" id="btn-track-start" class="btn btn-primary btn-block" style="min-height:50px;font-size:1.05rem;">▶ התחל ריצה</button>'
              : state.phase === 'running'
                ? `
                  <button type="button" id="btn-track-pause" class="btn btn-outline" style="flex:1;min-height:48px;">⏸ השהה</button>
                  <button type="button" id="btn-track-finish" class="btn btn-primary" style="flex:1;min-height:48px;">■ סיים ריצה</button>
                `
                : `
                  <button type="button" id="btn-track-resume" class="btn btn-primary" style="flex:1;min-height:48px;">▶ המשך</button>
                  <button type="button" id="btn-track-finish" class="btn btn-outline" style="flex:1;min-height:48px;">✓ סיים ושמור</button>
                  <button type="button" id="btn-track-cancel" class="btn btn-danger" style="min-height:48px;">בטל</button>
                `
          }
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">פיצולי ק"מ (Splits)</h2>
            <p class="card-subtitle">כמו בשעון ריצה — קצב לכל קילומטר שלם</p>
          </div>
        </div>
        <div id="live-splits-slot">
          ${
            state.splits.length > 0
              ? renderSplitsTable(state.splits)
              : '<div class="empty-state">כל קילומטר שלם שיושלם יופיע כאן אוטומטית עם הקצב שלו.</div>'
          }
        </div>
      </section>

      <section class="card card-soft">
        <h2 class="card-title" style="margin-bottom:6px;">איך מדידת ה-GPS עובדת</h2>
        <p style="margin:0;font-size:0.86rem;color:var(--text-secondary);">
          האפליקציה מודדת מרחק, זמן ופיצולים ישירות מ-GPS הטלפון ומאמתת את המסלול בשרת (סינון קפיצות GPS וחישוב מרחק מחדש).
          <strong>חשוב לדעת בדפדפן בטלפון:</strong> כדי לשמור על רצף GPS מדויק, יש להשאיר את המסך פתוח (אנחנו מפעילים אוטומטית שמירת מסך ער). למדידה עם מסך כבוי בכיס מומלץ לחבר שעון Garmin או Strava.
        </p>
      </section>
    `;

    container.querySelectorAll('[data-pacer]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const raw = btn.getAttribute('data-pacer');
        state.targetPaceSec = raw ? Number(raw) : null;
        draw();
      });
    });
    container.querySelector('#btn-toggle-sound')?.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      draw();
    });
    container.querySelector('#btn-track-start')?.addEventListener('click', startRun);
    container.querySelector('#btn-track-pause')?.addEventListener('click', pauseRun);
    container.querySelector('#btn-track-resume')?.addEventListener('click', resumeRun);
    container.querySelector('#btn-track-finish')?.addEventListener('click', finishRun);
    container.querySelector('#btn-track-cancel')?.addEventListener('click', () => {
      resetRun();
      showToast('המדידה בוטלה');
    });
  }

  draw();
        }
