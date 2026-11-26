import { api } from '../api.js';
import { escapeHtml, formatDateTimeHe, showToast } from '../utils.js';

function readHashQuery() {
  const hash = window.location.hash || '';
  const idx = hash.indexOf('?');
  if (idx === -1) return new URLSearchParams();
  return new URLSearchParams(hash.slice(idx + 1));
}

export async function renderSourcesView(container, app) {
  container.innerHTML = '<div class="loading-box">טוען סטטוס מקורות מדידה...</div>';
  const params = readHashQuery();
  const connectedParam = params.get('connected');
  const syncedParam = params.get('synced');
  const oauthError = params.get('oauth_error');

  if (connectedParam === 'strava') {
    showToast(
      syncedParam && Number(syncedParam) > 0
        ? `Strava חוברה בהצלחה! יובאו ${syncedParam} ריצות.`
        : 'חשבון Strava חובר בהצלחה!'
    );
  } else if (connectedParam === 'garmin_connect') {
    showToast('חשבון Garmin Connect חובר בהצלחה!');
  } else if (oauthError) {
    showToast(`שגיאה בחיבור OAuth: ${oauthError}`, { error: true });
  }

  const data = await api.sources();
  const garmin = data.sources.find((s) => s.provider === 'garmin_connect');
  const strava = data.sources.find((s) => s.provider === 'strava');

  container.innerHTML = `
    <h1 class="page-title">מקורות מדידה</h1>

    <section class="card card-amber">
      <h2 class="card-title" style="margin-bottom:6px;">עיקרון האמינות ב-Isrunner</h2>
      <p style="margin:0;font-size:0.9rem;color:var(--text-secondary);">
        ריצות חדשות נקלטות <strong>רק</strong> ממקור מדידה אמיתי: חיבור OAuth ישיר ל-Garmin Connect או Strava, או מדידת GPS חיה מתוך האפליקציה עם חישוב ואימות בשרת — ללא הקלדה ידנית של מרחק/זמן.
      </p>
    </section>

    <!-- In-App Live GPS Recorder (Works right now on any phone!) -->
    <section class="card hero-card" id="in-app-gps-card">
      <div class="card-header">
        <div>
          <h2 class="card-title">מדידת ריצה ישירה ב-Isrunner (GPS חי)</h2>
          <p class="card-subtitle">כמו שעון ריצה — מרחק, זמן, קצב חי, פיצולי ק"מ ומפת מסלול</p>
        </div>
        <span class="badge badge-verified">פעיל עכשיו</span>
      </div>
      <p style="margin:0 0 12px;font-size:0.88rem;color:rgba(255,255,255,0.78);">
        ${escapeHtml(data.in_app_gps?.description || '')}
        ${data.in_app_gps?.runs_count ? ` (נמדדו עד כה ${data.in_app_gps.runs_count} ריצות).` : ''}
      </p>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" id="btn-start-live-gps">▶ התחל מדידת ריצה (GPS)</button>
      </div>
    </section>

    <!-- Strava OAuth 2.0 + Sync -->
    <section class="card" id="strava-source-card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Strava (כולל ריצות שסונכרנו משעון Garmin)</h2>
          <p class="card-subtitle">חיבור OAuth 2.0 רשמי + סנכרון ריצות אוטומטי וידני</p>
        </div>
        ${
          strava.connected
            ? '<span class="badge badge-verified">מחובר</span>'
            : strava.server_configured
              ? '<span class="badge badge-neutral">מוכן לחיבור</span>'
              : '<span class="badge badge-legacy">לא מחובר</span>'
        }
      </div>

      <div class="info-box" style="margin-bottom:12px;">
        <strong>סטטוס נוכחי:</strong> ${escapeHtml(strava.status_label)}<br />
        <span>${escapeHtml(strava.honest_explanation)}</span>
      </div>

      ${
        strava.connected
          ? `
            <div class="info-box" style="margin-bottom:12px;">
              ${strava.connection?.provider_username ? `<div><strong>חשבון מחובר:</strong> <bdi dir="ltr">${escapeHtml(strava.connection.provider_username)}</bdi></div>` : ''}
              <div><strong>חובר בתאריך:</strong> ${formatDateTimeHe(strava.connection.connected_at)}</div>
              <div><strong>סנכרון אחרון:</strong> ${strava.connection.last_sync_at ? formatDateTimeHe(strava.connection.last_sync_at) : 'טרם סונכרנו ריצות'}</div>
              <div><strong>ריצות שנקלטו מ-Strava:</strong> <span class="tabular">${strava.runs_count}</span></div>
            </div>
            <div class="btn-row">
              <button type="button" class="btn btn-primary btn-sm" id="btn-sync-strava">סנכרן ריצות מ-Strava עכשיו</button>
              <button type="button" class="btn btn-outline btn-sm" id="btn-disconnect-strava-keep">ניתוק (שמירת ריצות)</button>
              <button type="button" class="btn btn-danger btn-sm" id="btn-disconnect-strava-delete">ניתוק ומחיקת ריצות Strava</button>
            </div>
          `
          : `
            <div class="info-box" style="margin-bottom:12px;">
              <div style="font-weight:700;color:var(--green-dark);margin-bottom:6px;">
                תצוגת הסכמה לפני חיבור Strava (<bdi dir="ltr">${escapeHtml(strava.consent.version)}</bdi>)
              </div>
              <ul style="margin:0;padding-right:18px;font-size:0.84rem;">
                ${strava.consent.data_collected.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
                ${strava.consent.data_not_collected.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
              </ul>
            </div>

            <label class="checkbox-row" style="margin-bottom:12px;">
              <input type="checkbox" id="strava-consent-checkbox" />
              <span>קראתי ואני מסכים/ה לקליטת ריצות מחשבון ה-Strava שלי (קריאה בלבד).</span>
            </label>

            <div class="btn-row">
              <button type="button" id="btn-connect-strava" class="btn btn-primary" ${strava.server_configured ? '' : 'disabled'}>
                ${strava.server_configured ? 'התחבר עם Strava (OAuth 2.0)' : 'חיבור Strava — ממתין למפתחות API בשרת'}
              </button>
            </div>
            ${
              !strava.server_configured
                ? `<p class="help-text" style="margin-top:8px;margin-bottom:0;">
                     להפעלה ב-2 דקות: צור אפליקציית API ב-<bdi dir="ltr">strava.com/settings/api</bdi>, הזן Callback Domain מתאים, והגדר בשרת את <code>STRAVA_CLIENT_ID</code> ו-<code>STRAVA_CLIENT_SECRET</code>.
                     כתובת Callback: <code>${escapeHtml(strava.callback_url)}</code>
                   </p>`
                : ''
            }
          `
      }

      ${
        strava.runs_count > 0 && !strava.connected
          ? `
            <div style="margin-top:12px;border-top:1px solid var(--green-border);padding-top:10px;">
              <p class="help-text" style="margin-top:0;">קיימות בחשבונך ${strava.runs_count} ריצות שמקורן ב-Strava.</p>
              <button type="button" class="btn btn-danger btn-sm" id="btn-delete-strava-data">מחק את כל נתוני Strava שלי</button>
            </div>
          `
          : ''
      }
    </section>

    <!-- Primary Source: Garmin Connect OAuth 2.0 PKCE -->
    <section class="card" id="garmin-source-card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Garmin Connect (שעון או אפליקציה)</h2>
          <p class="card-subtitle">חיבור OAuth 2.0 (PKCE) + Push Webhook ישיר מגרמין</p>
        </div>
        ${
          garmin.connected
            ? '<span class="badge badge-verified">מחובר</span>'
            : garmin.server_configured
              ? '<span class="badge badge-neutral">מוכן לחיבור</span>'
              : '<span class="badge badge-legacy">לא מחובר</span>'
        }
      </div>

      <div class="alert-amber" style="margin-bottom:12px;">
        <strong>סטטוס נוכחי:</strong> ${escapeHtml(garmin.status_label)}<br />
        <span>${escapeHtml(garmin.honest_explanation)}</span>
      </div>

      ${
        garmin.connected
          ? `
            <div class="info-box" style="margin-bottom:12px;">
              <div><strong>חובר בתאריך:</strong> ${formatDateTimeHe(garmin.connection.connected_at)}</div>
              <div><strong>סנכרון אחרון:</strong> ${garmin.connection.last_sync_at ? formatDateTimeHe(garmin.connection.last_sync_at) : 'טרם סונכרנו ריצות'}</div>
              <div><strong>ריצות שנקלטו מגרמין:</strong> <span class="tabular">${garmin.runs_count}</span></div>
            </div>
            <div class="btn-row">
              <button type="button" class="btn btn-outline btn-sm" id="btn-disconnect-keep">ניתוק חיבור (שמירת ריצות)</button>
              <button type="button" class="btn btn-danger btn-sm" id="btn-disconnect-delete">ניתוק ומחיקת כל נתוני Garmin</button>
            </div>
          `
          : `
            <!-- Consent Screen Preview (transparent, never fakes connection) -->
            <div class="info-box" style="margin-bottom:12px;">
              <div style="font-weight:700;color:var(--green-dark);margin-bottom:6px;">
                תצוגת הסכמה לפני חיבור (<bdi dir="ltr">${escapeHtml(garmin.consent.version)}</bdi>)
              </div>
              <div style="font-size:0.85rem;margin-bottom:6px;"><strong>מה ייקלט לאחר אישור וחיבור:</strong></div>
              <ul style="margin:0 0 8px;padding-right:18px;font-size:0.84rem;">
                ${garmin.consent.data_collected.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
              </ul>
              <div style="font-size:0.85rem;margin-bottom:6px;"><strong>מה לא נקלט:</strong></div>
              <ul style="margin:0 0 8px;padding-right:18px;font-size:0.84rem;">
                ${garmin.consent.data_not_collected.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
              </ul>
              <div style="font-size:0.85rem;margin-bottom:6px;"><strong>השליטה שלך:</strong></div>
              <ul style="margin:0;padding-right:18px;font-size:0.84rem;">
                ${garmin.consent.user_controls.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
              </ul>
            </div>

            <label class="checkbox-row" style="margin-bottom:12px;">
              <input type="checkbox" id="garmin-consent-checkbox" />
              <span>קראתי ואני מסכים/ה לתנאי קליטת הריצות מ-Garmin Connect (פעיל לאחר אישור תוכנית המפתחים של Garmin).</span>
            </label>

            <div class="btn-row">
              <button type="button" id="btn-connect-garmin" class="btn btn-primary" ${garmin.server_configured ? '' : 'disabled'}>
                ${garmin.server_configured ? 'התחבר עם Garmin Connect (OAuth 2.0)' : 'חיבור Garmin לא זמין עדיין (ממתין לאישור ספק)'}
              </button>
            </div>
            ${
              !garmin.server_configured
                ? `<p class="help-text" style="margin-top:8px;margin-bottom:0;">
                     טיוטת הבקשה ל-Garmin Connect Developer Program מוכנה בקובץ <code>docs/garmin-developer-application-draft.md</code>.
                     כתובת Callback: <code>${escapeHtml(garmin.callback_url)}</code> · Webhook: <code>${escapeHtml(garmin.webhook_url)}</code>
                   </p>`
                : ''
            }
          `
      }

      ${
        garmin.runs_count > 0 && !garmin.connected
          ? `
            <div style="margin-top:12px;border-top:1px solid var(--green-border);padding-top:10px;">
              <p class="help-text" style="margin-top:0;">קיימות בחשבונך ${garmin.runs_count} ריצות שמקורן ב-Garmin Connect.</p>
              <button type="button" class="btn btn-danger btn-sm" id="btn-delete-garmin-data">מחק את כל נתוני Garmin שלי</button>
            </div>
          `
          : ''
      }
    </section>

    <!-- Legacy self-reported runs explanation -->
    <section class="card card-soft">
      <h2 class="card-title" style="margin-bottom:6px;">ריצות קיימות מדיווח עצמי</h2>
      <p style="margin:0 0 6px;font-size:0.88rem;color:var(--text-secondary);">
        ${escapeHtml(data.legacy_note)}
      </p>
      <div style="font-size:0.86rem;font-weight:700;color:var(--green-dark);">
        ריצות מדיווח עצמי בחשבונך כרגע: <span class="tabular">${data.legacy_runs_count}</span>
      </div>
    </section>
  `;

  container.querySelector('#btn-start-live-gps')?.addEventListener('click', () => {
    app.navigate('#/track');
  });

  // Garmin connect / disconnect / delete
  container.querySelector('#btn-connect-garmin')?.addEventListener('click', async () => {
    const checked = container.querySelector('#garmin-consent-checkbox')?.checked === true;
    try {
      const res = await api.connectGarmin(checked);
      if (res.authorize_url) {
        window.location.href = res.authorize_url;
      }
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#btn-disconnect-keep')?.addEventListener('click', async () => {
    try {
      const res = await api.disconnectSource('garmin_connect', false);
      showToast(res.message);
      renderSourcesView(container, app);
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#btn-disconnect-delete')?.addEventListener('click', async () => {
    try {
      const res = await api.disconnectSource('garmin_connect', true);
      showToast(res.message);
      renderSourcesView(container, app);
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#btn-delete-garmin-data')?.addEventListener('click', async () => {
    try {
      const res = await api.deleteSourceData('garmin_connect');
      showToast(res.message);
      renderSourcesView(container, app);
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  // Strava connect / sync / disconnect / delete
  container.querySelector('#btn-connect-strava')?.addEventListener('click', async () => {
    const checked = container.querySelector('#strava-consent-checkbox')?.checked === true;
    try {
      const res = await api.connectStrava(checked);
      if (res.authorize_url) {
        window.location.href = res.authorize_url;
      }
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#btn-sync-strava')?.addEventListener('click', async () => {
    const btn = container.querySelector('#btn-sync-strava');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'מסנכרן מ-Strava...';
    }
    try {
      const res = await api.syncStrava();
      showToast(res.message);
      renderSourcesView(container, app);
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'סנכרן ריצות מ-Strava עכשיו';
      }
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#btn-disconnect-strava-keep')?.addEventListener('click', async () => {
    try {
      const res = await api.disconnectSource('strava', false);
      showToast(res.message);
      renderSourcesView(container, app);
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#btn-disconnect-strava-delete')?.addEventListener('click', async () => {
    try {
      const res = await api.disconnectSource('strava', true);
      showToast(res.message);
      renderSourcesView(container, app);
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#btn-delete-strava-data')?.addEventListener('click', async () => {
    try {
      const res = await api.deleteSourceData('strava');
      showToast(res.message);
      renderSourcesView(container, app);
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });
}
