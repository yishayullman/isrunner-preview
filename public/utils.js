export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDistance(km) {
  if (km === null || km === undefined || Number.isNaN(Number(km))) return '—';
  const n = Number(km);
  return `${n.toFixed(2).replace(/\.00$/, '')} ק"מ`;
}

export function formatDuration(totalSec) {
  if (!totalSec || totalSec <= 0) return '—';
  const sec = Math.round(Number(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (v) => String(v).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

export function formatPace(secPerKm) {
  if (!secPerKm || secPerKm <= 0) return '—';
  const sec = Math.round(Number(secPerKm));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')} דק'/ק"מ`;
}

export function formatDateHe(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('he-IL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

export function formatDateTimeHe(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('he-IL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function initialsOf(name) {
  if (!name) return 'ר';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

export function renderSourceBadge(source) {
  if (source && source.verified) {
    return `<span class="badge badge-verified">${escapeHtml(source.label)}</span>`;
  }
  return `<span class="badge badge-legacy">${escapeHtml(source?.label || 'דיווח עצמי, לא מאומת')}</span>`;
}

const PR_CODES = {
  '5k': '5K',
  '10k': '10K',
  half: '21.1K',
  marathon: '42.2K',
  longest: 'MAX',
};

export function renderPersonalRecordsGrid(records) {
  if (!Array.isArray(records) || records.length === 0) return '';
  return `
    <div class="pr-grid">
      ${records
        .map((item) => {
          const rec = item.record;
          const isWide = item.key === 'longest';
          const code = PR_CODES[item.key] || item.key;
          const mainValue = !rec
            ? '—'
            : item.type === 'distance'
              ? formatDistance(rec.distance_km)
              : formatDuration(rec.duration_sec);

          const meta = !rec
            ? `<span class="pr-meta">${escapeHtml(item.range_text || 'אין תוצאה עדיין')}</span>`
            : `<div class="pr-meta">
                <span class="tabular">${item.type === 'distance' ? formatDuration(rec.duration_sec) : formatDistance(rec.distance_km)}</span>
                <span>•</span>
                <span>${formatDateHe(rec.ran_at)}</span>
                ${rec.is_anomalous_pace ? '<span class="badge badge-anomaly">קצב חריג</span>' : ''}
              </div>`;

          return `
            <div class="pr-card ${isWide ? 'pr-wide' : ''} ${rec ? 'pr-unlocked' : ''}" ${rec ? `data-open-run="${escapeHtml(rec.run_id)}" role="button" tabindex="0"` : ''}>
              <div class="pr-top-row">
                <div class="pr-label">${escapeHtml(item.short_label || item.label)}</div>
                <span class="pr-code-chip">${escapeHtml(code)}</span>
              </div>
              <div class="pr-value tabular">${escapeHtml(mainValue)}</div>
              ${meta}
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

export function renderRunCard(run, { showRunner = false } = {}) {
  const runnerHeader =
    showRunner && run.runner
      ? `<div style="margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
           <button type="button" class="user-name-link" data-open-profile="${escapeHtml(run.runner.id)}">
             ${escapeHtml(run.runner.display_name)}
           </button>
           <span class="run-date">${formatDateHe(run.ran_at)}</span>
         </div>`
      : '';

  return `
    <article class="run-item" data-open-run="${escapeHtml(run.id)}">
      ${runnerHeader}
      <div class="run-item-top">
        <div class="run-metrics">
          <span class="run-dist tabular">${formatDistance(run.distance_km)}</span>
          <span class="run-time tabular">${formatDuration(run.duration_sec)}</span>
          <span class="run-pace tabular">${formatPace(run.pace_sec_per_km)}</span>
        </div>
        ${!showRunner ? `<span class="run-date">${formatDateHe(run.ran_at)}</span>` : ''}
      </div>
      <div class="run-badges">
        ${renderSourceBadge(run.source)}
        ${!run.is_shared ? '<span class="badge badge-private">פרטית (רק לך)</span>' : ''}
        ${run.is_anomalous_pace ? '<span class="badge badge-anomaly">קצב חריג</span>' : ''}
      </div>
      ${run.note ? `<p class="run-note">${escapeHtml(run.note)}</p>` : ''}
    </article>
  `;
}

export function pluralHe(count, singular, plural) {
  return Number(count) === 1 ? singular : `${count} ${plural}`;
}

export function renderWeeklyMileageChart(history, goalKm) {
  if (!Array.isArray(history) || history.length === 0) return '';
  const maxKm = Math.max(
    5,
    Number(goalKm) || 0,
    ...history.map((w) => Number(w.km) || 0)
  );
  const goalPct = goalKm && goalKm > 0 ? Math.min(96, Math.round((goalKm / maxKm) * 100)) : null;

  return `
    <div class="weekly-chart-wrap" aria-label="גרף קילומטרים ל-6 שבועות אחרונים">
      <div class="weekly-chart-title">
        <span>רצף 6 שבועות אחרונים (ק"מ)</span>
        ${goalKm ? `<span class="weekly-goal-legend">קו מקווקו: יעד ${escapeHtml(goalKm)} ק"מ</span>` : ''}
      </div>
      <div class="weekly-chart-bars">
        ${
          goalPct !== null
            ? `<div class="weekly-goal-line" style="bottom:${goalPct}%"></div>`
            : ''
        }
        ${history
          .map((w) => {
            const km = Number(w.km) || 0;
            const hPct = km > 0 ? Math.max(6, Math.round((km / maxKm) * 100)) : 2;
            const hitGoal = goalKm && km >= goalKm;
            return `
              <div class="weekly-bar-col ${w.is_current ? 'is-current' : ''}">
                <div class="weekly-bar-val tabular">${km > 0 ? km.toFixed(1).replace(/\.0$/, '') : '0'}</div>
                <div class="weekly-bar-track">
                  <div class="weekly-bar-fill ${hitGoal ? 'hit-goal' : ''} ${km === 0 ? 'empty' : ''}" style="height:${hPct}%"></div>
                </div>
                <div class="weekly-bar-label">${escapeHtml(w.label)}</div>
              </div>
            `;
          })
          .join('')}
      </div>
    </div>
  `;
}

export function showToast(message, { error = false } = {}) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${error ? 'toast-error' : ''}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 3400);
}

export function openModal(html, onBind) {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.innerHTML = `<div class="modal-card">${html}</div>`;
  root.classList.remove('hidden');

  const onKeyDown = (e) => {
    if (e.key === 'Escape') close();
  };

  const close = () => {
    document.removeEventListener('keydown', onKeyDown);
    root.classList.add('hidden');
    root.innerHTML = '';
  };

  document.addEventListener('keydown', onKeyDown);
  root.onclick = (e) => {
    if (e.target === root) close();
  };

  if (onBind) onBind(root, close);
  return close;
}

export function renderRouteSvg(polyline, { dark = false } = {}) {
  if (!Array.isArray(polyline) || polyline.length < 2) {
    return `<div class="route-svg-empty ${dark ? 'dark' : ''}">מסלול ה-GPS יצויר כאן אוטומטית תוך כדי תנועה</div>`;
  }
  const lats = polyline.map((p) => Number(p[0]));
  const lngs = polyline.map((p) => Number(p[1]));
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const avgLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180;
  const cosLat = Math.max(0.2, Math.cos(avgLatRad));
  const spanX = Math.max(0.00015, (maxLng - minLng) * cosLat);
  const spanY = Math.max(0.00015, maxLat - minLat);

  const W = 320;
  const H = 140;
  const pad = 16;
  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
  const usedW = spanX * scale;
  const usedH = spanY * scale;
  const offsetX = (W - usedW) / 2;
  const offsetY = (H - usedH) / 2;

  const pts = polyline.map(([lat, lng]) => {
    const x = offsetX + (lng - minLng) * cosLat * scale;
    const y = H - (offsetY + (lat - minLat) * scale);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const [sx, sy] = pts[0].split(',');
  const [ex, ey] = pts[pts.length - 1].split(',');
  const gridStroke = dark ? 'rgba(255,255,255,0.06)' : 'rgba(21,24,30,0.06)';
  const startFill = dark ? '#ffffff' : '#1d5c63';

  return `
    <div class="route-svg-wrap ${dark ? 'dark' : ''}">
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="140" role="img" aria-label="מסלול ריצת GPS">
        <g stroke="${gridStroke}" stroke-width="1">
          <line x1="0" y1="35" x2="${W}" y2="35" />
          <line x1="0" y1="70" x2="${W}" y2="70" />
          <line x1="0" y1="105" x2="${W}" y2="105" />
        </g>
        <polyline points="${pts.join(' ')}" fill="none" stroke="#e2552f" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="${sx}" cy="${sy}" r="4.2" fill="${startFill}" />
        <circle cx="${ex}" cy="${ey}" r="5.5" fill="#e2552f" stroke="${dark ? '#15181e' : '#ffffff'}" stroke-width="2" />
      </svg>
    </div>
  `;
}

export function renderSplitsTable(splits) {
  if (!Array.isArray(splits) || splits.length === 0) return '';
  const paces = splits.map((s) => Number(s.pace_sec_per_km || s.split_sec || 0)).filter((v) => v > 0);
  const fastest = Math.min(...paces);
  const slowest = Math.max(...paces);
  const span = Math.max(1, slowest - fastest);

  return `
    <div class="splits-list">
      ${splits
        .map((s) => {
          const pace = Number(s.pace_sec_per_km || s.split_sec || 0);
          // Faster split gets a longer bar (Garmin-style speed bar)
          const pct = paces.length === 1 ? 80 : Math.round(35 + ((slowest - pace) / span) * 65);
          return `
            <div class="split-row">
              <span class="split-km tabular">ק"מ ${escapeHtml(s.km)}</span>
              <div class="split-bar-track">
                <div class="split-bar-fill" style="width:${pct}%"></div>
              </div>
              <span class="split-pace tabular">${formatPace(pace)}</span>
              <span class="split-elapsed tabular">${formatDuration(s.elapsed_sec)}</span>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

export function getHebrewGreeting(now = new Date()) {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'בוקר טוב';
  if (h >= 12 && h < 17) return 'אחר צהריים טובים';
  if (h >= 17 && h < 22) return 'ערב טוב';
  return 'לילה טוב';
}

export function openPaceCalculatorModal(initialPaceSec = 315) {
  let paceSec = Math.max(180, Math.min(540, Math.round(initialPaceSec)));

  openModal(
    `
      <div class="card-header" style="margin-bottom:10px;">
        <div>
          <h3 class="card-title">מחשבון קצב וזמני מירוץ</h3>
          <p class="card-subtitle">גרור את הקצב וראה זמני סיום וטווחי אימון</p>
        </div>
        <button type="button" class="btn btn-outline btn-sm" id="btn-pace-close">סגור</button>
      </div>

      <div class="card hero-card" style="padding:16px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
          <div>
            <div class="stat-label">קצב יעד</div>
            <div id="pc-pace-val" class="stat-value tabular" style="font-size:2rem;">${formatPace(paceSec)}</div>
          </div>
          <div style="text-align:left;">
            <div class="stat-label">מהירות</div>
            <div id="pc-speed-val" class="stat-value tabular" style="font-size:1.35rem;">${(3600 / paceSec).toFixed(1)} קמ"ש</div>
          </div>
        </div>
        <input id="pc-slider" class="pace-slider" type="range" min="180" max="540" step="5" value="${paceSec}" style="margin-top:12px;" aria-label="בחירת קצב בשניות לקילומטר" />
        <div style="display:flex;justify-content:space-between;font-size:0.72rem;color:rgba(255,255,255,0.55);margin-top:4px;">
          <span>3:00 (מהיר)</span>
          <span>6:00</span>
          <span>9:00 (קל)</span>
        </div>
      </div>

      <div class="form-label">זמני סיום משוערים בקצב הזה</div>
      <div class="pace-race-grid" id="pc-races" style="margin-bottom:14px;"></div>

      <div class="form-label">טווחי אימון מומלצים לפי קצב בסיס</div>
      <div class="list-stack" id="pc-zones"></div>
    `,
    (root, close) => {
      const renderCalc = () => {
        const speed = (3600 / paceSec).toFixed(1);
        root.querySelector('#pc-pace-val').textContent = formatPace(paceSec);
        root.querySelector('#pc-speed-val').textContent = `${speed} קמ"ש`;

        const races = [
          { label: '5 ק"מ', km: 5 },
          { label: '10 ק"מ', km: 10 },
          { label: 'חצי מרתון', km: 21.0975 },
          { label: 'מרתון', km: 42.195 },
        ];
        root.querySelector('#pc-races').innerHTML = races
          .map(
            (r) => `
              <div class="stat-tile">
                <div class="stat-label">${r.label}</div>
                <div class="stat-value tabular" style="font-size:1.18rem;">${formatDuration(Math.round(r.km * paceSec))}</div>
              </div>
            `
          )
          .join('');

        const zones = [
          { name: 'ריצה קלה / התאוששות', val: `${formatPace(paceSec + 45)} – ${formatPace(paceSec + 75)}` },
          { name: 'קצב מרתון', val: formatPace(paceSec + 15) },
          { name: 'טמפו / סף', val: formatPace(Math.max(170, paceSec - 10)) },
          { name: 'אינטרוולים (1,000 מ׳)', val: formatPace(Math.max(160, paceSec - 25)) },
        ];
        root.querySelector('#pc-zones').innerHTML = zones
          .map(
            (z) => `
              <div class="pace-zone-row">
                <strong>${z.name}</strong>
                <span class="tabular" style="color:var(--coral-deep);font-weight:700;">${z.val}</span>
              </div>
            `
          )
          .join('');
      };

      renderCalc();
      root.querySelector('#pc-slider').addEventListener('input', (e) => {
        paceSec = Number(e.target.value);
        renderCalc();
      });
      root.querySelector('#btn-pace-close').addEventListener('click', close);
    }
  );
}

export function openShareRunCardModal(run, ownerName = '') {
  const canvas = document.createElement('canvas');
  const W = 720;
  const H = 900;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Deep obsidian editorial background + vermilion & emerald glows
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, '#171c27');
  bgGrad.addColorStop(0.55, '#0d1016');
  bgGrad.addColorStop(1, '#121621');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  const glow1 = ctx.createRadialGradient(120, H - 120, 20, 120, H - 120, 420);
  glow1.addColorStop(0, 'rgba(255, 77, 28, 0.34)');
  glow1.addColorStop(1, 'rgba(255, 77, 28, 0)');
  ctx.fillStyle = glow1;
  ctx.fillRect(0, 0, W, H);

  const glow2 = ctx.createRadialGradient(W - 80, 120, 10, W - 80, 120, 340);
  glow2.addColorStop(0, 'rgba(34, 201, 151, 0.18)');
  glow2.addColorStop(1, 'rgba(34, 201, 151, 0)');
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, W, H);

  // Subtle decorative track arc
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-90, -70, 380, 200, 100);
  ctx.stroke();

  // Brand top-right + date top-left
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 34px Rubik, Heebo, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Isrunner', 48, 82);

  // Orange brand bars next to logo
  ctx.strokeStyle = '#ff4d1c';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(48, 100);
  ctx.lineTo(148, 100);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.font = '600 22px Heebo, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(formatDateHe(run.ran_at), W - 48, 80);
  if (ownerName) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(ownerName, W - 48, 114);
  }

  // Optional GPS Route Trace in center
  const poly = Array.isArray(run.route_polyline) ? run.route_polyline : [];
  if (poly.length >= 2) {
    const lats = poly.map((p) => Number(p[0]));
    const lngs = poly.map((p) => Number(p[1]));
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const cosLat = Math.max(0.2, Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180));
    const spanX = Math.max(0.00015, (maxLng - minLng) * cosLat);
    const spanY = Math.max(0.00015, maxLat - minLat);
    const boxW = W - 120;
    const boxH = 260;
    const sc = Math.min(boxW / spanX, boxH / spanY);
    const ox = (W - spanX * sc) / 2;
    const oy = 175 + (boxH - spanY * sc) / 2;

    ctx.strokeStyle = '#ff5722';
    ctx.lineWidth = 7;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    poly.forEach(([lat, lng], idx) => {
      const x = ox + (lng - minLng) * cosLat * sc;
      const y = oy + (maxLat - lat) * sc;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // Giant hero distance metric
  const yHero = poly.length >= 2 ? 555 : 420;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = '700 132px Rubik, sans-serif';
  ctx.fillText(`${Number(run.distance_km).toFixed(2)}`, W / 2, yHero);
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.font = '600 30px Heebo, sans-serif';
  ctx.fillText('ק"מ', W / 2, yHero + 46);

  // Two bottom stat boxes: Time & Pace
  const yBoxes = yHero + 95;
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(48, yBoxes, 296, 130, 24);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.roundRect(W - 48 - 296, yBoxes, 296, 130, 24);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.58)';
  ctx.font = '600 22px Heebo, sans-serif';
  ctx.fillText('קצב ממוצע', 48 + 148, yBoxes + 44);
  ctx.fillText('זמן נטו', W - 48 - 148, yBoxes + 44);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 44px Rubik, sans-serif';
  ctx.fillText(
    formatPace(run.pace_sec_per_km).replace(" דק'/ק\"מ", ''),
    48 + 148,
    yBoxes + 100
  );
  ctx.fillText(formatDuration(run.duration_sec), W - 48 - 148, yBoxes + 100);

  // Honest source footer
  ctx.fillStyle = run.source?.verified ? '#22c997' : '#f5b942';
  ctx.font = '600 21px Heebo, sans-serif';
  ctx.fillText(run.source?.label || '', W / 2, H - 36);

  const dataUrl = canvas.toDataURL('image/png');
  const shareText = `ריצה ב-Isrunner: ${formatDistance(run.distance_km)} ב-${formatDuration(run.duration_sec)} (קצב ${formatPace(run.pace_sec_per_km)})`;

  openModal(
    `
      <div class="card-header" style="margin-bottom:10px;">
        <div>
          <h3 class="card-title">כרטיס שיתוף ריצה</h3>
          <p class="card-subtitle">מוכן לשליחה לוואטסאפ או לסטורי</p>
        </div>
        <button type="button" class="btn btn-outline btn-sm" id="btn-share-close">סגור</button>
      </div>
      <img src="${dataUrl}" alt="כרטיס שיתוף ריצה" class="share-preview-img" />
      <div class="btn-row">
        <button type="button" id="btn-native-share" class="btn btn-primary" style="flex:1;">שתף עכשיו</button>
        <a href="${dataUrl}" download="isrunner-run.png" class="btn btn-secondary">הורד תמונה</a>
      </div>
    `,
    (root, close) => {
      root.querySelector('#btn-share-close').addEventListener('click', close);
      root.querySelector('#btn-native-share').addEventListener('click', async () => {
        try {
          if (navigator.share) {
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
            const file = blob ? new File([blob], 'isrunner-run.png', { type: 'image/png' }) : null;
            if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({ title: 'Isrunner', text: shareText, files: [file] });
              return;
            }
            await navigator.share({ title: 'Isrunner', text: shareText });
            return;
          }
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(shareText);
            showToast('סיכום הריצה הועתק ללוח!');
          }
        } catch {
          // User canceled share sheet
        }
      });
    }
  );
}
