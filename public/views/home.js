import { api } from '../api.js';
import {
  escapeHtml,
  formatDateTimeHe,
  formatDistance,
  formatDuration,
  formatPace,
  getHebrewGreeting,
  openModal,
  openPaceCalculatorModal,
  pluralHe,
  renderPersonalRecordsGrid,
  renderRunCard,
  renderWeeklyMileageChart,
  showToast,
} from '../utils.js';

export async function renderHomeView(container, app) {
  container.innerHTML = '<div class="loading-box">טוען נתוני בית...</div>';
  const data = await api.home();
  app.setUnreadCount(data.unread_notifications_count || 0);

  let runFilter = 'all';

  function draw() {
    const s = data.summary;
    const goalKm = s.weekly_goal_km;
    const pct = goalKm ? Math.min(100, Math.round((s.weekly_km / goalKm) * 100)) : 0;

    const filteredRuns = data.recent_runs.filter((r) => {
      if (runFilter === 'shared') return r.is_shared;
      if (runFilter === 'private') return !r.is_shared;
      return true;
    });

    container.innerHTML = `
      <div class="page-eyebrow">${escapeHtml(getHebrewGreeting())}</div>
      <h1 class="page-title">${escapeHtml(app.user.display_name)}</h1>

      <!-- Flagship Athletic Hero Card (Hero-first!) -->
      <section class="card hero-card">
        <div class="card-header">
          <div>
            <h2 class="card-title">השבוע שלי</h2>
            <p class="card-subtitle">מיום ראשון ועד היום</p>
          </div>
          <button type="button" class="btn btn-outline btn-sm" id="btn-edit-goal">
            ${goalKm ? 'עדכן יעד' : '+ הגדר יעד שבועי'}
          </button>
        </div>

        <div class="stats-grid">
          <div class="stat-tile">
            <div class="stat-label">ק"מ השבוע</div>
            <div class="stat-value tabular">${s.weekly_km.toFixed(1)} ק"מ</div>
            <div class="stat-sub">${pluralHe(s.weekly_runs_count, 'ריצה אחת', 'ריצות')} השבוע</div>
          </div>
          <div class="stat-tile">
            <div class="stat-label">קצב ממוצע</div>
            <div class="stat-value tabular">${s.avg_pace_sec_per_km ? formatPace(s.avg_pace_sec_per_km) : '—'}</div>
            <div class="stat-sub">מתוך ${pluralHe(s.total_runs, 'ריצה אחת', 'ריצות')}</div>
          </div>
          <div class="stat-tile stat-tile-wide">
            <div class="stat-label">יעד שבועי (אופציונלי)</div>
            ${
              goalKm
                ? `
                  <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-top:2px;">
                    <strong class="tabular goal-figure">${s.weekly_km.toFixed(1)} / ${goalKm} ק"מ</strong>
                    <span class="stat-sub tabular">${pct}%</span>
                  </div>
                  <div class="progress-bar-wrap" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
                    <div class="progress-bar-fill" style="width:${pct}%"></div>
                  </div>
                `
                : '<div class="stat-sub" style="margin-top:4px;">אין יעד שבועי מוגדר כרגע — אפשר להגדיר בכל זמן.</div>'
            }
          </div>
        </div>

        ${renderWeeklyMileageChart(data.weekly_history, goalKm)}

        <div class="hero-action-bar">
          <button type="button" class="btn btn-primary" id="btn-start-gps-hero" style="flex:1;">
            ▶ התחל ריצה עם GPS
          </button>
          <button type="button" class="btn btn-outline" id="btn-open-sources-hero">
            שעון Garmin / Strava
          </button>
        </div>
      </section>

      <!-- Quick Runner Utilities -->
      <div class="quick-tools-grid">
        <button type="button" class="quick-tool-tile" id="btn-open-pace-calc">
          <span class="quick-tool-ic" style="background:var(--coral-soft);color:var(--coral-deep);">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          </span>
          <span>
            <b>מחשבון קצב ומירוץ</b>
            <span>חישוב 5K, 10K, חצי ומרתון</span>
          </span>
        </button>
        <button type="button" class="quick-tool-tile" id="btn-open-sources-tile">
          <span class="quick-tool-ic" style="background:var(--teal-soft);color:var(--teal);">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          </span>
          <span>
            <b>חיבור Garmin ו-Strava</b>
            <span>סנכרון אוטומטי ואמין</span>
          </span>
        </button>
      </div>

      <!-- Trust & Integrity Strip (Closed manual run addition notice) -->
      <section class="closed-add-card" id="closed-add-card" aria-label="סטטוס הוספת ריצות">
        <h2 class="closed-add-title">דירוג אמין ללא הזנה ידנית</h2>
        <p class="closed-add-text">${escapeHtml(data.add_run_status.message)}</p>
        <div class="btn-row">
          <button type="button" class="btn btn-outline btn-sm" id="btn-start-gps-home">
            ▶ מדוד עם GPS
          </button>
          <button type="button" class="btn btn-outline btn-sm" id="btn-open-sources">
            מקורות מדידה
          </button>
        </div>
      </section>

      <!-- In-app Notifications -->
      <section class="card" id="notifications-card">
        <div class="card-header">
          <div>
            <h2 class="card-title">
              התראות ${data.unread_notifications_count > 0 ? `<span class="badge badge-anomaly">${pluralHe(data.unread_notifications_count, 'התראה חדשה', 'חדשות')}</span>` : ''}
            </h2>
            <p class="card-subtitle">כשחבר משתף ריצה בפעם הראשונה</p>
          </div>
          ${
            data.unread_notifications_count > 0
              ? '<button type="button" class="btn btn-outline btn-sm" id="btn-mark-all-read">סמן הכול כנקרא</button>'
              : ''
          }
        </div>

        ${
          data.notifications.length === 0
            ? '<div class="empty-state">אין התראות כרגע. כשחברים ישתפו ריצה חדשה, תראה אותה כאן.</div>'
            : `<div class="list-stack">
                ${data.notifications
                  .map(
                    (n) => `
                      <div class="notif-item ${n.is_read ? '' : 'unread'}" data-notif-id="${escapeHtml(n.id)}" data-run-id="${escapeHtml(n.run_id)}" role="button" tabindex="0">
                        ${n.is_read ? '' : '<span class="notif-dot" aria-label="לא נקרא"></span>'}
                        <div class="notif-body">
                          <div>
                            <strong>${escapeHtml(n.actor_display_name)}</strong> שיתף/ה ריצה של
                            <strong class="tabular">${formatDistance(n.distance_km)}</strong>
                            (<span class="tabular">${formatDuration(n.duration_sec)}</span>)
                          </div>
                          <div class="run-date">${formatDateTimeHe(n.created_at)}</div>
                        </div>
                        ${
                          !n.is_read
                            ? `<button type="button" class="btn btn-outline btn-sm" data-mark-read="${escapeHtml(n.id)}">נקרא</button>`
                            : '<span class="badge badge-neutral">נקרא</span>'
                        }
                      </div>
                    `
                  )
                  .join('')}
              </div>`
        }
        <p class="help-text" style="margin-top:10px;margin-bottom:0;">
          התראות לטלפון כשהאפליקציה סגורה הן שלב עתידי נפרד שידרוש הסכמה מפורשת.
        </p>
      </section>

      <!-- Personal Records Summary -->
      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">השיאים האישיים שלי</h2>
            <p class="card-subtitle">5 ק"מ, 10 ק"מ, חצי מרתון, מרתון והארוכה ביותר</p>
          </div>
        </div>
        ${renderPersonalRecordsGrid(data.personal_records)}
      </section>

      <!-- Friends Activity (last 14 days, newest first) -->
      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">פעילות חברים (14 ימים אחרונים)</h2>
            <p class="card-subtitle">החדש ראשון — רק ריצות משותפות</p>
          </div>
          <button type="button" class="btn btn-outline btn-sm" id="btn-go-friends">חברים</button>
        </div>

        ${
          data.friends_activity.length === 0
            ? '<div class="empty-state">אין פעילות חברים ב-14 הימים האחרונים. הזמן חברים כדי לעקוב יחד.</div>'
            : `<div class="list-stack">
                ${data.friends_activity.map((r) => renderRunCard(r, { showRunner: true })).join('')}
              </div>`
        }
      </section>

      <!-- Recent Own Runs with quick filter -->
      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">הריצות האחרונות שלי</h2>
            <p class="card-subtitle">לחיצה על ריצה פותחת פרטים, שיתוף ומקור</p>
          </div>
        </div>
        ${
          data.recent_runs.length > 0
            ? `<div class="tabs-scroll" style="margin-bottom:10px;">
                <button type="button" class="tab-pill ${runFilter === 'all' ? 'active' : ''}" data-run-filter="all">הכול (${data.recent_runs.length})</button>
                <button type="button" class="tab-pill ${runFilter === 'shared' ? 'active' : ''}" data-run-filter="shared">משותפות</button>
                <button type="button" class="tab-pill ${runFilter === 'private' ? 'active' : ''}" data-run-filter="private">פרטיות</button>
              </div>`
            : ''
        }

        ${
          filteredRuns.length === 0
            ? '<div class="empty-state">אין ריצות להצגה בסינון זה.</div>'
            : `<div class="list-stack">
                ${filteredRuns.map((r) => renderRunCard(r)).join('')}
              </div>`
        }
      </section>
    `;

    container.querySelector('#btn-start-gps-hero')?.addEventListener('click', () => {
      app.navigate('#/track');
    });
    container.querySelector('#btn-start-gps-home')?.addEventListener('click', () => {
      app.navigate('#/track');
    });
    container.querySelector('#btn-open-sources-hero')?.addEventListener('click', () => {
      app.navigate('#/sources');
    });
    container.querySelector('#btn-open-sources-tile')?.addEventListener('click', () => {
      app.navigate('#/sources');
    });
    container.querySelector('#btn-open-pace-calc')?.addEventListener('click', () => {
      openPaceCalculatorModal(s.avg_pace_sec_per_km || 315);
    });
    container.querySelector('#btn-open-sources').addEventListener('click', () => {
      app.navigate('#/sources');
    });

    container.querySelector('#btn-go-friends').addEventListener('click', () => {
      app.navigate('#/friends');
    });

    container.querySelectorAll('[data-run-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        runFilter = btn.getAttribute('data-run-filter');
        draw();
      });
    });

    container.querySelector('#btn-edit-goal').addEventListener('click', () => {
      openModal(
        `
          <h3 class="card-title" style="margin-bottom:10px;">יעד שבועי (ק"מ)</h3>
          <form id="goal-form">
            <div class="form-group">
              <label class="form-label" for="goal-input">כמה ק"מ תרצה לרוץ בשבוע? (אופציונלי)</label>
              <input id="goal-input" class="input" type="number" step="0.5" min="1" max="500" value="${goalKm ?? ''}" placeholder="למשל: 25" />
              <div class="help-text">השאר ריק כדי לבטל את היעד השבועי.</div>
            </div>
            <div class="btn-row">
              <button type="submit" class="btn btn-primary">שמירה</button>
              <button type="button" class="btn btn-outline" id="goal-cancel">ביטול</button>
            </div>
          </form>
        `,
        (root, close) => {
          root.querySelector('#goal-cancel').addEventListener('click', close);
          root.querySelector('#goal-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const rawVal = root.querySelector('#goal-input').value.trim();
            const weekly_goal_km = rawVal === '' ? null : Number(rawVal);
            try {
              const res = await api.updateSettings({ weekly_goal_km });
              app.setUser(res.user);
              close();
              showToast(weekly_goal_km ? `יעד שבועי עודכן ל-${weekly_goal_km} ק"מ` : 'היעד השבועי הוסר');
              renderHomeView(container, app);
            } catch (err) {
              showToast(err.message, { error: true });
            }
          });
        }
      );
    });

    const markAllBtn = container.querySelector('#btn-mark-all-read');
    if (markAllBtn) {
      markAllBtn.addEventListener('click', async () => {
        try {
          await api.markAllNotificationsRead();
          showToast('כל ההתראות סומנו כנקראו');
          renderHomeView(container, app);
        } catch (err) {
          showToast(err.message, { error: true });
        }
      });
    }

    container.querySelectorAll('[data-mark-read]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-mark-read');
        try {
          await api.markNotificationRead(id);
          renderHomeView(container, app);
        } catch (err) {
          showToast(err.message, { error: true });
        }
      });
    });

    container.querySelectorAll('.notif-item').forEach((item) => {
      item.addEventListener('click', async () => {
        const id = item.getAttribute('data-notif-id');
        const runId = item.getAttribute('data-run-id');
        if (item.classList.contains('unread')) {
          try {
            await api.markNotificationRead(id);
          } catch {
            // continue opening run
          }
        }
        app.navigate(`#/run/${encodeURIComponent(runId)}`);
      });
    });

    bindRunAndProfileClicks(container, app);
  }

  draw();
}

export function bindRunAndProfileClicks(container, app) {
  container.querySelectorAll('[data-open-profile]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const userId = el.getAttribute('data-open-profile');
      if (userId) app.navigate(`#/user/${encodeURIComponent(userId)}`);
    });
  });
  container.querySelectorAll('[data-open-run]').forEach((el) => {
    el.addEventListener('click', () => {
      const runId = el.getAttribute('data-open-run');
      if (runId) app.navigate(`#/run/${encodeURIComponent(runId)}`);
    });
  });
}
