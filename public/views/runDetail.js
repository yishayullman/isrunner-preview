import { api } from '../api.js';
import {
  escapeHtml,
  formatDateTimeHe,
  formatDistance,
  formatDuration,
  formatPace,
  openShareRunCardModal,
  renderRouteSvg,
  renderSourceBadge,
  renderSplitsTable,
  showToast,
} from '../utils.js';
import { openReportModal } from './profile.js';

export async function renderRunDetailView(container, app, runId) {
  container.innerHTML = '<div class="loading-box">טוען פרטי ריצה...</div>';
  const data = await api.getRun(runId);
  const run = data.run;
  const hasRoute = Array.isArray(run.route_polyline) && run.route_polyline.length >= 2;
  const hasSplits = Array.isArray(run.splits) && run.splits.length > 0;

  container.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h1 class="card-title" style="font-size:1.22rem;">פרטי ריצה</h1>
          <p class="card-subtitle">
            <button type="button" class="user-name-link" id="btn-run-owner">${escapeHtml(run.owner.display_name)}</button>
            • ${formatDateTimeHe(run.ran_at)}
          </p>
        </div>
        ${!run.is_shared ? '<span class="badge badge-private">ריצה פרטית (רק לך)</span>' : '<span class="badge badge-neutral">משותפת</span>'}
      </div>

      <div class="stats-grid">
        <div class="stat-tile">
          <div class="stat-label">מרחק שנמדד</div>
          <div class="stat-value tabular">${formatDistance(run.distance_km)}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">זמן שנמדד (ללא נרמול)</div>
          <div class="stat-value tabular">${formatDuration(run.duration_sec)}</div>
        </div>
        <div class="stat-tile stat-tile-wide">
          <div class="stat-label">קצב ממוצע</div>
          <div class="stat-value tabular">${formatPace(run.pace_sec_per_km)}</div>
          ${
            run.is_anomalous_pace
              ? '<div style="margin-top:6px;"><span class="badge badge-anomaly">קצב חריג — מסומן לשקיפות ואינו חסום</span></div>'
              : ''
          }
        </div>
      </div>

      ${
        hasRoute
          ? `<div style="margin-bottom:14px;">
               <div class="form-label">מסלול GPS שנמדד</div>
               ${renderRouteSvg(run.route_polyline)}
             </div>`
          : ''
      }

      ${
        hasSplits
          ? `<div style="margin-bottom:14px;">
               <div class="form-label">פיצולי ק"מ (Splits)</div>
               ${renderSplitsTable(run.splits)}
             </div>`
          : ''
      }

      <!-- Run Measurement Source Provenance -->
      <div class="info-box" style="margin-bottom:12px;">
        <div style="font-weight:700;margin-bottom:4px;color:var(--green-dark);">מקור הריצה</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
          ${renderSourceBadge(run.source)}
          ${run.device_name ? `<span class="badge badge-neutral">${escapeHtml(run.device_name)}</span>` : ''}
          ${run.avg_accuracy_m ? `<span class="badge badge-neutral tabular">דיוק ממוצע ±${run.avg_accuracy_m}מ׳</span>` : ''}
        </div>
        <p style="margin:6px 0 0;font-size:0.83rem;">
          ${
            run.source.code === 'app_gps'
              ? 'ריצה זו נמדדה ב-GPS חי בתוך Isrunner וחושבה ואומתה מחדש בשרת מתוך נקודות ה-GPS.'
              : run.source.verified
                ? 'ריצה זו נקלטה בנתיב השרת המאומת ממקור מדידה מחובר.'
                : 'ריצה זו מסומנת בשקיפות כלא מאומתת (היסטורית מדיווח עצמי או הזנה ידנית בספק חיצוני).'
          }
        </p>
      </div>

      ${
        run.note
          ? `
            <div style="margin-bottom:14px;">
              <div class="form-label">הערה לריצה</div>
              <div class="info-box" style="white-space:pre-wrap;">${escapeHtml(run.note)}</div>
            </div>
          `
          : ''
      }

      <div class="btn-row" style="margin-bottom:14px;">
        <button type="button" id="btn-share-run-card" class="btn btn-primary btn-sm">
          שתף כרטיס ריצה (וואטסאפ / סטורי)
        </button>
      </div>

      ${
        run.is_owner
          ? `
            <div class="card card-soft" style="margin-bottom:12px;">
              <h2 class="card-title" style="font-size:0.98rem;margin-bottom:6px;">שיתוף הריצה</h2>
              <p class="help-text" style="margin-top:0;margin-bottom:10px;">
                ריצה פרטית נראית רק לך: היא לא מופיעה בפרופיל שלך אצל אחרים, לא בשיאים אצל אחרים, לא בדירוגים, ללא קישור ישיר ואי אפשר לדווח עליה.
              </p>
              <button type="button" id="btn-toggle-share" class="btn ${run.is_shared ? 'btn-outline' : 'btn-primary'} btn-sm">
                ${run.is_shared ? 'הפוך לריצה פרטית (הסר משיתוף)' : 'שתף ריצה זו שוב'}
              </button>
            </div>

            <form id="edit-note-form" style="margin-bottom:14px;">
              <div class="form-group">
                <label class="form-label" for="run-note-input">עריכת הערה (מרחק, זמן ומקור אינם ניתנים לעריכה)</label>
                <textarea id="run-note-input" class="textarea" maxlength="500" placeholder="איך הרגשת בריצה?">${escapeHtml(run.note || '')}</textarea>
              </div>
              <button type="submit" class="btn btn-secondary btn-sm">שמור הערה</button>
            </form>

            <div style="border-top:1px solid var(--green-border);padding-top:12px;">
              <button type="button" id="btn-delete-run" class="btn btn-danger btn-sm">מחיקת ריצה לצמיתות</button>
            </div>
          `
          : `
            <div class="btn-row">
              <button type="button" id="btn-report-run" class="btn btn-outline btn-sm">דיווח על ריצה זו</button>
            </div>
          `
      }
    </section>
  `;

  container.querySelector('#btn-share-run-card')?.addEventListener('click', () => {
    openShareRunCardModal(run, run.owner?.display_name || '');
  });

  container.querySelector('#btn-run-owner').addEventListener('click', () => {
    app.navigate(`#/user/${encodeURIComponent(run.owner.id)}`);
  });

  if (run.is_owner) {
    container.querySelector('#btn-toggle-share').addEventListener('click', async () => {
      try {
        const nextShared = !run.is_shared;
        await api.toggleRunShare(run.id, nextShared);
        showToast(
          nextShared
            ? 'הריצה משותפת כעת (בהתאם להגדרות הפרטיות שלך)'
            : 'הריצה הפכה לפרטית וההתראות עליה הוסרו מיד'
        );
        renderRunDetailView(container, app, runId);
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });

    container.querySelector('#edit-note-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const note = container.querySelector('#run-note-input').value.trim();
      try {
        await api.updateRunNote(run.id, note);
        showToast('ההערה עודכנה');
        renderRunDetailView(container, app, runId);
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });

    container.querySelector('#btn-delete-run').addEventListener('click', async () => {
      try {
        await api.deleteRun(run.id);
        showToast('הריצה וההתראות הקשורות אליה נמחקו');
        app.navigate('#/home');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  } else {
    container.querySelector('#btn-report-run').addEventListener('click', () => {
      openReportModal({
        target_type: 'run',
        target_run_id: run.id,
        targetLabel: `${formatDistance(run.distance_km)} של ${run.owner.display_name}`,
      });
    });
  }
}
