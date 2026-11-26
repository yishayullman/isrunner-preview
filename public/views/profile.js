import { api } from '../api.js';
import {
  escapeHtml,
  initialsOf,
  openModal,
  renderPersonalRecordsGrid,
  renderRunCard,
  showToast,
} from '../utils.js';
import { bindRunAndProfileClicks } from './home.js';

export async function renderProfileView(container, app, userId) {
  container.innerHTML = '<div class="loading-box">טוען פרופיל רץ...</div>';
  const data = await api.userProfile(userId);
  const p = data.profile;

  let relationButtons = '';
  if (!p.is_self) {
    if (p.relation === 'none') {
      relationButtons = `<button type="button" class="btn btn-primary btn-sm" id="btn-invite-friend">הזמן לחברות</button>`;
    } else if (p.relation === 'outgoing_pending') {
      relationButtons = `<button type="button" class="btn btn-outline btn-sm" id="btn-cancel-friend">בקשה נשלחה (ביטול)</button>`;
    } else if (p.relation === 'incoming_pending') {
      relationButtons = `
        <button type="button" class="btn btn-primary btn-sm" id="btn-accept-friend">אישור חברות</button>
        <button type="button" class="btn btn-outline btn-sm" id="btn-decline-friend">דחייה</button>
      `;
    } else if (p.relation === 'friends') {
      relationButtons = `
        <span class="badge badge-verified">חברים</span>
        <button type="button" class="btn btn-outline btn-sm" id="btn-remove-friend">הסר חבר</button>
      `;
    } else if (p.relation === 'blocked_by_me') {
      relationButtons = `<button type="button" class="btn btn-outline btn-sm" id="btn-unblock-user">ביטול חסימה</button>`;
    }
  }

  container.innerHTML = `
    <section class="card">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
        <div class="avatar" style="width:48px;height:48px;font-size:1.1rem;">${escapeHtml(initialsOf(p.display_name))}</div>
        <div style="min-width:0;flex:1;">
          <h1 class="card-title" style="font-size:1.22rem;">${escapeHtml(p.display_name)}</h1>
          <div class="user-handle">@${escapeHtml(p.username)}</div>
        </div>
      </div>

      ${p.bio ? `<p style="margin:0 0 12px;font-size:0.92rem;color:var(--text-secondary);">${escapeHtml(p.bio)}</p>` : ''}

      ${
        !p.is_self
          ? `
            <div class="btn-row">
              ${relationButtons}
              ${p.relation !== 'blocked_by_me' ? '<button type="button" class="btn btn-danger btn-sm" id="btn-block-user">חסימה</button>' : ''}
              ${p.relation !== 'blocked_by_me' ? '<button type="button" class="btn btn-outline btn-sm" id="btn-report-user">דיווח על משתמש</button>' : ''}
            </div>
          `
          : '<a href="#/me" class="btn btn-secondary btn-sm">עריכת פרופיל והגדרות פרטיות</a>'
      }
    </section>

    <!-- Personal Records (Always all 5 slots, "—" when absent or hidden by privacy) -->
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">שיאים אישיים</h2>
          <p class="card-subtitle">5 ק"מ, 10 ק"מ, חצי מרתון, מרתון והריצה הארוכה ביותר</p>
        </div>
      </div>
      ${p.privacy_note ? `<div class="info-box" style="margin-bottom:10px;">${escapeHtml(p.privacy_note)}</div>` : ''}
      ${renderPersonalRecordsGrid(data.personal_records)}
    </section>

    <!-- Runs list -->
    <section class="card">
      <div class="card-header">
        <h2 class="card-title">${p.is_self ? 'הריצות שלי' : 'ריצות משותפות'}</h2>
      </div>
      ${
        !p.can_view_runs
          ? `<div class="empty-state">${escapeHtml(p.privacy_note || 'הריצות אינן זמינות לצפייה.')}</div>`
          : data.runs.length === 0
            ? '<div class="empty-state">אין ריצות להצגה.</div>'
            : `<div class="list-stack">${data.runs.map((r) => renderRunCard(r)).join('')}</div>`
      }
    </section>
  `;

  const bind = (sel, fn) => {
    const el = container.querySelector(sel);
    if (el) el.addEventListener('click', fn);
  };

  bind('#btn-invite-friend', async () => {
    try {
      const res = await api.sendFriendRequest(p.id);
      showToast(res.message || 'בקשת החברות נשלחה');
      renderProfileView(container, app, userId);
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  bind('#btn-cancel-friend', async () => {
    try {
      await api.removeFriend(p.id);
      showToast('הבקשה בוטלה');
      renderProfileView(container, app, userId);
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  bind('#btn-accept-friend', async () => {
    try {
      await api.respondFriendRequest(p.id, 'accept');
      showToast('החברות אושרה!');
      renderProfileView(container, app, userId);
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  bind('#btn-decline-friend', async () => {
    try {
      await api.respondFriendRequest(p.id, 'decline');
      showToast('הבקשה נדחתה');
      renderProfileView(container, app, userId);
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  bind('#btn-remove-friend', async () => {
    try {
      await api.removeFriend(p.id);
      showToast('החבר הוסר וההתראות נוקו');
      renderProfileView(container, app, userId);
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  bind('#btn-block-user', async () => {
    try {
      await api.blockUser(p.id);
      showToast('המשתמש נחסם');
      renderProfileView(container, app, userId);
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  bind('#btn-unblock-user', async () => {
    try {
      await api.unblockUser(p.id);
      showToast('החסימה בוטלה');
      renderProfileView(container, app, userId);
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  bind('#btn-report-user', () => {
    openReportModal({ target_type: 'user', target_user_id: p.id, targetLabel: p.display_name });
  });

  bindRunAndProfileClicks(container, app);
}

export function openReportModal({ target_type, target_user_id, target_run_id, targetLabel }) {
  openModal(
    `
      <h3 class="card-title" style="margin-bottom:8px;">
        דיווח על ${target_type === 'user' ? 'משתמש' : 'ריצה'}: ${escapeHtml(targetLabel)}
      </h3>
      <form id="report-form">
        <div class="form-group">
          <label class="form-label" for="report-reason">סיבת הדיווח</label>
          <select id="report-reason" class="select" required>
            <option value="anomalous_result">תוצאה חריגה / חשד לנתון לא תקין</option>
            <option value="inappropriate_content">תוכן פוגעני או לא הולם</option>
            <option value="harassment">הטרדה</option>
            <option value="impersonation">התחזות</option>
            <option value="other">אחר</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="report-details">פירוט (אופציונלי)</label>
          <textarea id="report-details" class="textarea" maxlength="500" placeholder="פרט בקצרה מה הפריע לך..."></textarea>
        </div>
        <div class="btn-row">
          <button type="submit" class="btn btn-danger">שליחת דיווח</button>
          <button type="button" class="btn btn-outline" id="report-cancel">ביטול</button>
        </div>
      </form>
    `,
    (root, close) => {
      root.querySelector('#report-cancel').addEventListener('click', close);
      root.querySelector('#report-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const reason = root.querySelector('#report-reason').value;
        const details = root.querySelector('#report-details').value.trim();
        try {
          const res = await api.createReport({
            target_type,
            target_user_id,
            target_run_id,
            reason,
            details,
          });
          close();
          showToast(res.message || 'הדיווח נשלח');
        } catch (err) {
          showToast(err.message, { error: true });
        }
      });
    }
  );
}
