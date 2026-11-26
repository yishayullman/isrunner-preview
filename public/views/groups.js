import { api } from '../api.js';
import {
  escapeHtml,
  formatDateHe,
  formatDistance,
  formatDuration,
  formatPace,
  initialsOf,
  renderSourceBadge,
  showToast,
} from '../utils.js';
import { bindRunAndProfileClicks } from './home.js';

export async function renderGroupsView(container, app) {
  let previewData = null;
  let previewError = '';

  async function load() {
    container.innerHTML = '<div class="loading-box">טוען קבוצות...</div>';
    const data = await api.groups();
    draw(data.groups || []);
  }

  function draw(groups) {
    container.innerHTML = `
      <h1 class="page-title">קבוצות</h1>

      <!-- Join by code with preview -->
      <section class="card">
        <h2 class="card-title" style="margin-bottom:6px;">הצטרפות לקבוצה עם קוד</h2>
        <p class="card-subtitle" style="margin-bottom:10px;">הזן קוד כדי לראות תצוגה מקדימה לפני ההצטרפות</p>
        <form id="group-preview-form" style="display:flex;gap:8px;">
          <input id="group-code-input" class="input" type="text" placeholder="למשל: RUN5K2" style="text-transform:uppercase;letter-spacing:0.06em;" />
          <button type="submit" class="btn btn-secondary" style="flex-shrink:0;">תצוגה מקדימה</button>
        </form>
        ${previewError ? `<div class="alert-error" style="margin-top:10px;margin-bottom:0;">${escapeHtml(previewError)}</div>` : ''}
        ${
          previewData
            ? `
              <div class="info-box" style="margin-top:10px;" id="group-preview-box">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                  <strong style="font-size:1rem;color:var(--green-dark);">${escapeHtml(previewData.name)}</strong>
                  <span class="badge badge-neutral">${previewData.member_count} חברים</span>
                </div>
                ${previewData.description ? `<p style="margin:6px 0 8px;">${escapeHtml(previewData.description)}</p>` : '<div style="height:6px;"></div>'}
                <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:10px;">מנהל/ת הקבוצה: ${escapeHtml(previewData.owner_display_name)}</div>
                ${
                  previewData.already_member
                    ? `<button type="button" class="btn btn-primary btn-sm" id="btn-open-previewed-group">אתה כבר חבר — פתח קבוצה</button>`
                    : `<button type="button" class="btn btn-primary btn-sm" id="btn-confirm-join-group">אישור והצטרפות לקבוצה</button>`
                }
              </div>
            `
            : ''
        }
      </section>

      <!-- My Groups -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">הקבוצות שלי (${groups.length})</h2>
        </div>
        ${
          groups.length === 0
            ? '<div class="empty-state">עדיין לא הצטרפת לקבוצות. צור קבוצה חדשה למטה או הזן קוד הצטרפות.</div>'
            : `<div class="list-stack">
                ${groups
                  .map(
                    (g) => `
                      <div class="run-item" data-open-group="${escapeHtml(g.id)}">
                        <div class="run-item-top">
                          <strong style="color:var(--green-dark);font-size:1.02rem;">${escapeHtml(g.name)}</strong>
                          <span class="badge badge-neutral">${g.member_count} חברים</span>
                        </div>
                        ${g.description ? `<p class="run-note" style="margin-top:4px;">${escapeHtml(g.description)}</p>` : ''}
                        <div class="run-badges" style="margin-top:8px;align-items:center;">
                          <span class="join-code-pill" title="קוד הצטרפות">${escapeHtml(g.join_code)}</span>
                          ${g.role === 'owner' ? '<span class="badge badge-verified">מנהל קבוצה</span>' : ''}
                        </div>
                      </div>
                    `
                  )
                  .join('')}
              </div>`
        }
      </section>

      <!-- Create Group -->
      <section class="card">
        <h2 class="card-title" style="margin-bottom:10px;">יצירת קבוצה חדשה</h2>
        <form id="create-group-form">
          <div class="form-group">
            <label class="form-label" for="new-group-name">שם הקבוצה</label>
            <input id="new-group-name" class="input" type="text" required minlength="2" maxlength="50" placeholder="למשל: רצי פארק הירקון" />
          </div>
          <div class="form-group">
            <label class="form-label" for="new-group-desc">תיאור קצר (אופציונלי)</label>
            <textarea id="new-group-desc" class="textarea" maxlength="300" placeholder="ריצות בוקר רגועות בשישי, כולם מוזמנים..."></textarea>
          </div>
          <button type="submit" class="btn btn-primary">יצירת קבוצה וקבלת קוד הצטרפות</button>
        </form>
      </section>
    `;

    container.querySelector('#group-preview-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = container.querySelector('#group-code-input').value.trim().toUpperCase();
      previewError = '';
      previewData = null;
      if (!code) {
        previewError = 'נא להזין קוד הצטרפות.';
        draw(groups);
        return;
      }
      try {
        const res = await api.previewGroup(code);
        previewData = res.preview;
        draw(groups);
      } catch (err) {
        previewError = err.message || 'לא נמצאה קבוצה.';
        draw(groups);
      }
    });

    const openPrevBtn = container.querySelector('#btn-open-previewed-group');
    if (openPrevBtn && previewData) {
      openPrevBtn.addEventListener('click', () => {
        app.navigate(`#/group/${encodeURIComponent(previewData.id)}`);
      });
    }

    const joinBtn = container.querySelector('#btn-confirm-join-group');
    if (joinBtn && previewData) {
      joinBtn.addEventListener('click', async () => {
        try {
          const res = await api.joinGroup(previewData.join_code);
          showToast(`הצטרפת לקבוצה "${res.name}"!`);
          previewData = null;
          app.navigate(`#/group/${encodeURIComponent(res.group_id)}`);
        } catch (err) {
          showToast(err.message, { error: true });
        }
      });
    }

    container.querySelectorAll('[data-open-group]').forEach((el) => {
      el.addEventListener('click', () => {
        app.navigate(`#/group/${encodeURIComponent(el.getAttribute('data-open-group'))}`);
      });
    });

    container.querySelector('#create-group-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = container.querySelector('#new-group-name').value.trim();
      const description = container.querySelector('#new-group-desc').value.trim();
      try {
        const res = await api.createGroup({ name, description });
        showToast(`הקבוצה נוצרה! קוד הצטרפות: ${res.group.join_code}`);
        app.navigate(`#/group/${encodeURIComponent(res.group.id)}`);
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  }

  await load();
}

export async function renderGroupDetailView(container, app, groupId) {
  let activeCategory = '5k';

  async function load() {
    container.innerHTML = '<div class="loading-box">טוען קבוצה וטבלת דירוג...</div>';
    const data = await api.groupDetail(groupId, activeCategory);
    const g = data.group;
    const activeCatObj = data.categories.find((c) => c.key === activeCategory);

    container.innerHTML = `
      <section class="card">
        <div class="card-header">
          <div>
            <h1 class="card-title" style="font-size:1.25rem;">${escapeHtml(g.name)}</h1>
            ${g.description ? `<p class="card-subtitle">${escapeHtml(g.description)}</p>` : ''}
          </div>
          <span class="badge badge-neutral">${g.member_count} חברים</span>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:8px;">
          <div>
            <span style="font-size:0.84rem;color:var(--text-muted);margin-left:6px;">קוד הצטרפות:</span>
            <span class="join-code-pill" id="group-join-code">${escapeHtml(g.join_code)}</span>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-copy-code">העתק קוד</button>
            <button type="button" class="btn btn-danger btn-sm" id="btn-leave-group">עזיבת קבוצה</button>
          </div>
        </div>
      </section>

      <div class="tabs-scroll" role="tablist" aria-label="קטגוריות דירוג קבוצה">
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

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">טבלת דירוג קבוצתית — ${escapeHtml(activeCatObj?.label || '')}</h2>
            <p class="card-subtitle">טווח: ${escapeHtml(activeCatObj?.range_text || '')} • זמן מדוד ללא נרמול</p>
          </div>
        </div>

        ${
          data.entries.length === 0
            ? '<div class="empty-state">אין עדיין ריצות משותפות בקטגוריה הזו בקבוצה.</div>'
            : `<div class="list-stack">
                ${data.entries
                  .map((entry) => {
                    const rankClass = entry.rank <= 3 ? `rank-${entry.rank}` : '';
                    const isLongest = activeCategory === 'longest';
                    return `
                      <div class="lb-row">
                        <div class="lb-rank ${rankClass} tabular">${entry.rank}</div>
                        <div class="lb-runner">
                          <button type="button" class="user-name-link lb-name" data-open-profile="${escapeHtml(entry.user_id)}">
                            ${escapeHtml(entry.display_name)}
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

      <section class="card">
        <h2 class="card-title" style="margin-bottom:10px;">חברי הקבוצה (${data.members.length})</h2>
        <div class="list-stack">
          ${data.members
            .map(
              (m) => `
                <div class="user-row">
                  <div class="user-row-info">
                    <div class="avatar">${escapeHtml(initialsOf(m.display_name))}</div>
                    <div>
                      <button type="button" class="user-name-link" data-open-profile="${escapeHtml(m.id)}">${escapeHtml(m.display_name)}</button>
                      <div class="user-handle">@${escapeHtml(m.username)} ${m.role === 'owner' ? '• מנהל/ת' : ''}</div>
                    </div>
                  </div>
                  <button type="button" class="btn btn-outline btn-sm" data-open-profile="${escapeHtml(m.id)}">פרופיל</button>
                </div>
              `
            )
            .join('')}
        </div>
      </section>
    `;

    container.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeCategory = btn.getAttribute('data-cat');
        load();
      });
    });

    container.querySelector('#btn-copy-code').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(g.join_code);
        showToast(`קוד ההצטרפות ${g.join_code} הועתק`);
      } catch {
        showToast(`קוד ההצטרפות: ${g.join_code}`);
      }
    });

    container.querySelector('#btn-leave-group').addEventListener('click', async () => {
      try {
        await api.leaveGroup(g.id);
        showToast('עזבת את הקבוצה');
        app.navigate('#/groups');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });

    bindRunAndProfileClicks(container, app);
  }

  await load();
}
