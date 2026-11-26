import { api } from '../api.js';
import {
  escapeHtml,
  formatDateHe,
  formatDistance,
  formatDuration,
  formatPace,
  renderSourceBadge,
} from '../utils.js';
import { bindRunAndProfileClicks } from './home.js';

export async function renderLeaderboardView(container, app, initialCategory = '5k') {
  let activeCategory = initialCategory;

  async function load() {
    container.innerHTML = '<div class="loading-box">טוען טבלת דירוג...</div>';
    const data = await api.leaderboard(activeCategory);
    const activeCatObj = data.categories.find((c) => c.key === activeCategory);

    container.innerHTML = `
      <h1 class="page-title">שיאים ודירוג כללי</h1>

      <div class="tabs-scroll" role="tablist" aria-label="קטגוריות דירוג">
        ${data.categories
          .map(
            (c) => `
              <button type="button"
                class="tab-pill ${c.key === activeCategory ? 'active' : ''}"
                data-cat="${escapeHtml(c.key)}"
                role="tab"
                aria-selected="${c.key === activeCategory}">
                ${escapeHtml(c.short_label)}
              </button>
            `
          )
          .join('')}
      </div>

      ${
        data.requires_email_verification && !data.viewer_email_verified
          ? `
            <section class="card card-soft">
              <h2 class="card-title" style="margin-bottom:4px;">אימות אימייל להופעה בדירוג</h2>
              <p class="card-subtitle" style="margin-bottom:10px;">כדי למנוע כפילויות וריבוי חשבונות בטבלה, רק חשבונות עם אימייל מאומת נכנסים לדירוג הכללי.</p>
              <button type="button" class="btn btn-primary btn-sm" id="btn-lb-verify-email">אמת את האימייל שלי עכשיו</button>
            </section>
          `
          : ''
      }

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">טבלת ${escapeHtml(activeCatObj?.label || '')}</h2>
            <p class="card-subtitle">רק רצים שבחרו להופיע בדירוג הכללי וריצות משותפות (תוצאה אחת לכל רץ)</p>
          </div>
          <span class="badge badge-neutral tabular">${data.entries.length} רצים</span>
        </div>

        ${
          data.my_entry
            ? `<div class="my-rank-banner">
                 <span>המיקום שלך בטבלה זו: <strong class="tabular">#${data.my_entry.rank}</strong></span>
                 <strong class="tabular">${activeCategory === 'longest' ? formatDistance(data.my_entry.distance_km) : formatDuration(data.my_entry.duration_sec)}</strong>
               </div>`
            : ''
        }

        ${
          data.entries.length >= 2
            ? (() => {
                const top = data.entries.slice(0, 3);
                const ordered = top.length === 3 ? [top[1], top[0], top[2]] : [top[0], top[1]];
                const isLongest = activeCategory === 'longest';
                return `
                  <div class="podium-grid" style="${ordered.length === 2 ? 'grid-template-columns:repeat(2,minmax(0,1fr));' : ''}">
                    ${ordered
                      .map(
                        (e) => `
                          <div class="podium-card podium-${e.rank}" data-open-run="${escapeHtml(e.run_id)}" role="button" tabindex="0">
                            <span class="podium-medal tabular">#${e.rank}</span>
                            <div class="podium-name">${escapeHtml(e.display_name)}</div>
                            <div class="podium-val tabular">${isLongest ? formatDistance(e.distance_km) : formatDuration(e.duration_sec)}</div>
                            <div class="lb-sub-val tabular" style="${e.rank === 1 ? 'color:rgba(255,255,255,0.62);' : ''}">${formatPace(e.pace_sec_per_km)}</div>
                          </div>
                        `
                      )
                      .join('')}
                  </div>
                `;
              })()
            : ''
        }

        ${
          data.entries.length === 0
            ? '<div class="empty-state">אין עדיין תוצאות משותפות בטווח הזה. צא לריצה עם GPS או חבר Strava / Garmin כדי לתפוס את המקום הראשון.</div>'
            : `<div class="list-stack">
                ${data.entries
                  .map((entry) => {
                    const rankClass = entry.rank <= 3 ? `rank-${entry.rank}` : '';
                    const isLongest = activeCategory === 'longest';
                    const isMe = app.user && entry.user_id === app.user.id;
                    return `
                      <div class="lb-row ${isMe ? 'lb-row-me' : ''}">
                        <div class="lb-rank ${rankClass} tabular">${entry.rank}</div>
                        <div class="lb-runner">
                          <button type="button" class="user-name-link lb-name" data-open-profile="${escapeHtml(entry.user_id)}">
                            ${escapeHtml(entry.display_name)}${isMe ? ' (אני)' : ''}
                          </button>
                          <div class="run-badges" style="margin-top:4px;">
                            ${renderSourceBadge(entry.source)}
                            ${entry.is_anomalous_pace ? '<span class="badge badge-anomaly">קצב חריג</span>' : ''}
                          </div>
                        </div>
                        <div class="lb-result" data-open-run="${escapeHtml(entry.run_id)}" role="button" tabindex="0" style="cursor:pointer;">
                          <div class="lb-primary-val tabular">
                            ${isLongest ? formatDistance(entry.distance_km) : formatDuration(entry.duration_sec)}
                          </div>
                          <div class="lb-sub-val tabular">
                            ${isLongest ? formatDuration(entry.duration_sec) : formatDistance(entry.distance_km)}
                            • ${formatPace(entry.pace_sec_per_km)}
                          </div>
                          <div class="lb-sub-val">${formatDateHe(entry.ran_at)}</div>
                        </div>
                      </div>
                    `;
                  })
                  .join('')}
              </div>`
        }
      </section>

      <!-- Transparent Ranking Rule Explanation (Section 3) -->
      <section class="card card-soft" id="ranking-rule-box">
        <div class="card-header" style="margin-bottom:6px;">
          <h2 class="card-title">${escapeHtml(data.rule.title)}</h2>
        </div>
        <p style="margin:0 0 8px;font-size:0.88rem;color:var(--text-secondary);">
          ${escapeHtml(data.rule.summary)}
        </p>
        <div style="font-size:0.82rem;color:var(--green-dark);font-weight:600;">
          טווח הקטגוריה הנוכחית (${escapeHtml(activeCatObj?.label || '')}):
          <span class="tabular">${escapeHtml(activeCatObj?.range_text || '')}</span>
        </div>
        <p class="help-text" style="margin:6px 0 0;">
          ${escapeHtml(data.rule.anomaly_note)}
        </p>
      </section>
    `;

    container.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeCategory = btn.getAttribute('data-cat');
        load();
      });
    });

    container.querySelector('#btn-lb-verify-email')?.addEventListener('click', () => {
      app.navigate('#/me');
    });

    bindRunAndProfileClicks(container, app);
  }

  await load();
}
