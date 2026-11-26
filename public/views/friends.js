import { api } from '../api.js';
import { escapeHtml, initialsOf, showToast } from '../utils.js';

export async function renderFriendsView(container, app) {
  let searchQuery = '';
  let searchResults = [];

  async function load() {
    container.innerHTML = '<div class="loading-box">טוען חברים...</div>';
    const data = await api.friends();
    draw(data);
  }

  function draw(data) {
    container.innerHTML = `
      <h1 class="page-title">חברים</h1>

      <!-- Search users by name -->
      <section class="card">
        <h2 class="card-title" style="margin-bottom:8px;">חיפוש רצים לפי שם</h2>
        <form id="friend-search-form" style="display:flex;gap:8px;">
          <input id="friend-search-input" class="input" type="search" value="${escapeHtml(searchQuery)}" placeholder="הקלד שם או שם משתמש..." />
          <button type="submit" class="btn btn-primary" style="flex-shrink:0;">חפש</button>
        </form>
        <div id="friend-search-results" style="margin-top:10px;">
          ${renderSearchResults(searchResults, searchQuery)}
        </div>
      </section>

      <!-- Incoming requests -->
      ${
        data.incoming.length > 0
          ? `
            <section class="card">
              <div class="card-header">
                <h2 class="card-title">בקשות חברות ממתינות (${data.incoming.length})</h2>
              </div>
              <div class="list-stack">
                ${data.incoming
                  .map(
                    (u) => `
                      <div class="user-row">
                        <div class="user-row-info">
                          <div class="avatar">${escapeHtml(initialsOf(u.display_name))}</div>
                          <div>
                            <button type="button" class="user-name-link" data-open-profile="${escapeHtml(u.id)}">${escapeHtml(u.display_name)}</button>
                            <div class="user-handle">@${escapeHtml(u.username)}</div>
                          </div>
                        </div>
                        <div class="btn-row">
                          <button type="button" class="btn btn-primary btn-sm" data-accept="${escapeHtml(u.id)}">אישור</button>
                          <button type="button" class="btn btn-outline btn-sm" data-decline="${escapeHtml(u.id)}">דחייה</button>
                        </div>
                      </div>
                    `
                  )
                  .join('')}
              </div>
            </section>
          `
          : ''
      }

      <!-- Friends list -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">החברים שלי (${data.friends.length})</h2>
        </div>
        ${
          data.friends.length === 0
            ? '<div class="empty-state">עדיין אין חברים ברשימה. חפש רצים למעלה או היכנס לפרופיל מהדירוג והזמן לחברות.</div>'
            : `<div class="list-stack">
                ${data.friends
                  .map(
                    (f) => `
                      <div class="user-row">
                        <div class="user-row-info">
                          <div class="avatar">${escapeHtml(initialsOf(f.display_name))}</div>
                          <div style="min-width:0;">
                            <button type="button" class="user-name-link" data-open-profile="${escapeHtml(f.id)}">${escapeHtml(f.display_name)}</button>
                            <div class="user-handle">@${escapeHtml(f.username)}</div>
                          </div>
                        </div>
                        <div class="btn-row">
                          <button type="button" class="btn btn-secondary btn-sm" data-open-profile="${escapeHtml(f.id)}">פרופיל</button>
                          <button type="button" class="btn btn-outline btn-sm" data-remove="${escapeHtml(f.id)}">הסרה</button>
                          <button type="button" class="btn btn-danger btn-sm" data-block="${escapeHtml(f.id)}">חסימה</button>
                        </div>
                      </div>
                    `
                  )
                  .join('')}
              </div>`
        }
      </section>

      <!-- Outgoing requests -->
      ${
        data.outgoing.length > 0
          ? `
            <section class="card">
              <div class="card-header">
                <h2 class="card-title">בקשות שנשלחו (${data.outgoing.length})</h2>
              </div>
              <div class="list-stack">
                ${data.outgoing
                  .map(
                    (u) => `
                      <div class="user-row">
                        <div class="user-row-info">
                          <div class="avatar">${escapeHtml(initialsOf(u.display_name))}</div>
                          <div>
                            <button type="button" class="user-name-link" data-open-profile="${escapeHtml(u.id)}">${escapeHtml(u.display_name)}</button>
                            <div class="user-handle">@${escapeHtml(u.username)} • ממתין לאישור</div>
                          </div>
                        </div>
                        <button type="button" class="btn btn-outline btn-sm" data-remove="${escapeHtml(u.id)}">ביטול</button>
                      </div>
                    `
                  )
                  .join('')}
              </div>
            </section>
          `
          : ''
      }

      <!-- Blocked users -->
      ${
        data.blocked.length > 0
          ? `
            <section class="card">
              <div class="card-header">
                <h2 class="card-title">משתמשים חסומים (${data.blocked.length})</h2>
              </div>
              <div class="list-stack">
                ${data.blocked
                  .map(
                    (u) => `
                      <div class="user-row">
                        <div class="user-row-info">
                          <div class="avatar">${escapeHtml(initialsOf(u.display_name))}</div>
                          <div>
                            <div style="font-weight:700;">${escapeHtml(u.display_name)}</div>
                            <div class="user-handle">@${escapeHtml(u.username)}</div>
                          </div>
                        </div>
                        <button type="button" class="btn btn-outline btn-sm" data-unblock="${escapeHtml(u.id)}">ביטול חסימה</button>
                      </div>
                    `
                  )
                  .join('')}
              </div>
            </section>
          `
          : ''
      }
    `;

    // Bind search
    container.querySelector('#friend-search-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      searchQuery = container.querySelector('#friend-search-input').value.trim();
      if (!searchQuery) {
        searchResults = [];
        draw(data);
        return;
      }
      try {
        const res = await api.searchUsers(searchQuery);
        searchResults = res.users || [];
        draw(data);
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });

    container.querySelectorAll('[data-open-profile]').forEach((el) => {
      el.addEventListener('click', () => {
        app.navigate(`#/user/${encodeURIComponent(el.getAttribute('data-open-profile'))}`);
      });
    });

    container.querySelectorAll('[data-invite]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const res = await api.sendFriendRequest(btn.getAttribute('data-invite'));
          showToast(res.message || 'הבקשה נשלחה');
          if (searchQuery) {
            const sr = await api.searchUsers(searchQuery);
            searchResults = sr.users || [];
          }
          await load();
        } catch (err) {
          showToast(err.message, { error: true });
        }
      });
    });

    container.querySelectorAll('[data-accept]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api.respondFriendRequest(btn.getAttribute('data-accept'), 'accept');
          showToast('בקשת החברות אושרה!');
          await load();
        } catch (err) {
          showToast(err.message, { error: true });
        }
      });
    });

    container.querySelectorAll('[data-decline]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api.respondFriendRequest(btn.getAttribute('data-decline'), 'decline');
          showToast('הבקשה נדחתה');
          await load();
        } catch (err) {
          showToast(err.message, { error: true });
        }
      });
    });

    container.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api.removeFriend(btn.getAttribute('data-remove'));
          showToast('הוסר מרשימת החברים וההתראות נוקו');
          await load();
        } catch (err) {
          showToast(err.message, { error: true });
        }
      });
    });

    container.querySelectorAll('[data-block]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api.blockUser(btn.getAttribute('data-block'));
          showToast('המשתמש נחסם והגישה הוסרה מיד');
          await load();
        } catch (err) {
          showToast(err.message, { error: true });
        }
      });
    });

    container.querySelectorAll('[data-unblock]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api.unblockUser(btn.getAttribute('data-unblock'));
          showToast('החסימה בוטלה');
          await load();
        } catch (err) {
          showToast(err.message, { error: true });
        }
      });
    });
  }

  await load();
}

function renderSearchResults(results, query) {
  if (!query) return '';
  if (results.length === 0) {
    return '<div class="empty-state" style="padding:10px;">לא נמצאו רצים בשם הזה.</div>';
  }
  return `
    <div class="list-stack">
      ${results
        .map((u) => {
          let actionBtn = '';
          if (u.relation === 'none') {
            actionBtn = `<button type="button" class="btn btn-primary btn-sm" data-invite="${escapeHtml(u.id)}">הזמן לחברות</button>`;
          } else if (u.relation === 'outgoing_pending') {
            actionBtn = '<span class="badge badge-neutral">בקשה ממתינה</span>';
          } else if (u.relation === 'incoming_pending') {
            actionBtn = `<button type="button" class="btn btn-primary btn-sm" data-accept="${escapeHtml(u.id)}">אשר בקשה</button>`;
          } else if (u.relation === 'friends') {
            actionBtn = '<span class="badge badge-verified">חברים</span>';
          }
          return `
            <div class="user-row">
              <div class="user-row-info">
                <div class="avatar">${escapeHtml(initialsOf(u.display_name))}</div>
                <div>
                  <button type="button" class="user-name-link" data-open-profile="${escapeHtml(u.id)}">${escapeHtml(u.display_name)}</button>
                  <div class="user-handle">@${escapeHtml(u.username)}</div>
                </div>
              </div>
              <div class="btn-row">
                ${actionBtn}
                <button type="button" class="btn btn-outline btn-sm" data-open-profile="${escapeHtml(u.id)}">פרופיל</button>
              </div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}
