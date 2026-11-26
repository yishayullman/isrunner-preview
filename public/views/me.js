import { api } from '../api.js';
import { escapeHtml, initialsOf, openModal, renderPersonalRecordsGrid, showToast } from '../utils.js';
import { bindRunAndProfileClicks } from './home.js';

export async function renderMeView(container, app) {
  container.innerHTML = '<div class="loading-box">טוען פרופיל והגדרות...</div>';
  const [profileData, sourcesData] = await Promise.all([
    api.userProfile(app.user.id),
    api.sources(),
  ]);
  const u = app.user;
  const garmin = sourcesData.sources.find((s) => s.provider === 'garmin_connect');

  container.innerHTML = `
    <h1 class="page-title">אני והגדרות</h1>

    <!-- Quick Profile Header -->
    <section class="card">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <div class="avatar" style="width:48px;height:48px;font-size:1.1rem;">${escapeHtml(initialsOf(u.display_name))}</div>
        <div style="min-width:0;flex:1;">
          <strong style="font-size:1.1rem;color:var(--green-dark);display:block;">${escapeHtml(u.display_name)}</strong>
          <span class="user-handle">@${escapeHtml(u.username)}</span>
        </div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary btn-sm" id="btn-go-sources">
          מקורות מדידה (${garmin?.connected ? 'מחובר' : 'לא מחובר'})
        </button>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-go-resources">
          משאבים וחימום/שחרור
        </button>
        <button type="button" class="btn btn-outline btn-sm" id="btn-view-my-profile">
          הפרופיל שלי
        </button>
      </div>
    </section>

    ${
      u.email && !u.email_verified && app.emailVerificationEnabled
        ? `
          <section class="card" id="email-verify-card">
            <div class="card-header">
              <div>
                <h2 class="card-title">אימות אימייל להשתתפות בדירוג</h2>
                <p class="card-subtitle">אימות קוד חד-פעמי אל ${escapeHtml(u.email)} מונע חשבונות כפולים בדירוג הכללי.</p>
              </div>
              <span class="badge badge-unverified">ממתין לאימות</span>
            </div>
            <div class="btn-row" style="margin-bottom:10px;">
              <button type="button" class="btn btn-secondary btn-sm" id="btn-send-email-code">שלח קוד בן 6 ספרות למייל</button>
            </div>
            <form id="verify-email-form" style="display:flex;gap:8px;flex-wrap:wrap;">
              <input id="email-otp-input" class="input tabular" dir="ltr" inputmode="numeric" maxlength="6" placeholder="123456" style="flex:1;min-width:140px;letter-spacing:0.18em;text-align:center;" />
              <button type="submit" class="btn btn-primary btn-sm" id="btn-verify-email-code">אמת אימייל</button>
            </form>
          </section>
        `
        : ''
    }

    <!-- My Personal Records -->
    <section class="card">
      <h2 class="card-title" style="margin-bottom:10px;">השיאים האישיים שלי</h2>
      ${renderPersonalRecordsGrid(profileData.personal_records)}
    </section>

    <!-- Privacy & Leaderboard Settings -->
    <section class="card" id="privacy-settings-card">
      <h2 class="card-title" style="margin-bottom:4px;">פרטיות הריצות והדירוג</h2>
      <p class="card-subtitle" style="margin-bottom:12px;">נאכף בשרת בכל קריאה. תמיד אפשר גם להפוך ריצה בודדת לפרטית.</p>

      <form id="settings-form">
        <div class="form-group">
          <div class="form-label">מי יכול לראות את הריצות המשותפות והשיאים שלי?</div>

          <label class="radio-option">
            <input type="radio" name="run_privacy" value="everyone" ${u.run_privacy === 'everyone' ? 'checked' : ''} />
            <div>
              <div class="radio-title">כולם</div>
              <div class="radio-desc">כל מי שרואה ריצה שלך ומתלהב יכול להיכנס לפרופיל שלך ולראות את כל הריצות המשותפות והשיאים.</div>
            </div>
          </label>

          <label class="radio-option">
            <input type="radio" name="run_privacy" value="friends" ${u.run_privacy === 'friends' ? 'checked' : ''} />
            <div>
              <div class="radio-title">חברים בלבד</div>
              <div class="radio-desc">רק חברים מאושרים יכולים לראות את הריצות המשותפות והשיאים שלך.</div>
            </div>
          </label>

          <label class="radio-option">
            <input type="radio" name="run_privacy" value="none" ${u.run_privacy === 'none' ? 'checked' : ''} />
            <div>
              <div class="radio-title">אף אחד</div>
              <div class="radio-desc">רק אתה רואה את הריצות והשיאים שלך. בחירה זו מסירה מיד גם התראות קיימות אצל חברים.</div>
            </div>
          </label>
        </div>

        <div class="form-group">
          <label class="checkbox-row">
            <input type="checkbox" id="show-global-lb" ${u.show_in_global_leaderboard ? 'checked' : ''} />
            <span><strong>להופיע בדירוג הכללי</strong> (בכפוף לפרטיות הריצות ולריצות משותפות)</span>
          </label>
        </div>

        <hr style="border:none;border-top:1px solid var(--green-border);margin:14px 0;" />

        <div class="form-group">
          <label class="form-label" for="set-display-name">שם תצוגה</label>
          <input id="set-display-name" class="input" type="text" required minlength="2" maxlength="40" value="${escapeHtml(u.display_name)}" />
        </div>

        <div class="form-group">
          <label class="form-label" for="set-email" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <span>אימייל אישי (חובה — מונע כפילויות בדירוג)</span>
            ${
              u.email
                ? u.email_verified
                  ? '<span class="badge badge-verified">מאומת</span>'
                  : '<span class="badge badge-neutral">טרם אומת</span>'
                : ''
            }
          </label>
          <input id="set-email" class="input" type="email" ${u.email ? 'required' : ''} value="${escapeHtml(u.email || '')}" placeholder="name@example.com" />
        </div>

        <div class="form-group">
          <label class="form-label" for="set-bio">תיאור קצר (אופציונלי)</label>
          <textarea id="set-bio" class="textarea" maxlength="200" placeholder="למשל: רץ 10 ק"מ בפארק הירקון...">${escapeHtml(u.bio || '')}</textarea>
        </div>

        <div class="form-group">
          <label class="form-label" for="set-weekly-goal">יעד ק"מ שבועי (אופציונלי)</label>
          <input id="set-weekly-goal" class="input" type="number" step="0.5" min="1" max="500" value="${u.weekly_goal_km ?? ''}" placeholder="ללא יעד" />
        </div>

        <button type="submit" class="btn btn-primary" id="btn-save-settings">שמירת הגדרות</button>
      </form>
    </section>

    <!-- Data Export, Privacy Draft & Account Deletion -->
    <section class="card card-soft">
      <h2 class="card-title" style="margin-bottom:6px;">נתונים, מדיניות וחשבון</h2>
      <p class="help-text" style="margin-top:0;margin-bottom:10px;">
        טיוטת מדיניות הפרטיות (גיל 18+) ומחיקת החשבון פועלות כאן לבדיקה מקומית בלבד — לפני עלייה לאוויר יש למלא את פרטי בעל השירות ולאשר.
      </p>
      <div class="btn-row">
        <button type="button" class="btn btn-outline btn-sm" id="btn-change-password">החלפת סיסמה</button>
        <button type="button" class="btn btn-outline btn-sm" id="btn-go-privacy">טיוטת מדיניות פרטיות</button>
        <button type="button" class="btn btn-outline btn-sm" id="btn-export-data">ייצוא הנתונים שלי (JSON)</button>
        <button type="button" class="btn btn-outline btn-sm" id="btn-logout">התנתקות</button>
        <button type="button" class="btn btn-outline btn-sm" id="btn-logout-all">התנתקות מכל המכשירים</button>
        <button type="button" class="btn btn-danger btn-sm" id="btn-delete-account">מחיקת חשבון</button>
      </div>
    </section>
  `;

  container.querySelector('#btn-send-email-code')?.addEventListener('click', async () => {
    try {
      const res = await api.sendEmailCode();
      showToast(res.message || 'קוד האימות נשלח למייל');
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#verify-email-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = container.querySelector('#email-otp-input').value.trim();
    try {
      const res = await api.verifyEmailCode(code);
      if (res.user) app.setUser(res.user);
      showToast(res.message || 'האימייל אומת בהצלחה!');
      renderMeView(container, app);
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#btn-go-sources').addEventListener('click', () => app.navigate('#/sources'));
  container.querySelector('#btn-go-resources').addEventListener('click', () => app.navigate('#/resources'));
  container.querySelector('#btn-go-privacy').addEventListener('click', () => app.navigate('#/privacy'));
  container.querySelector('#btn-view-my-profile').addEventListener('click', () =>
    app.navigate(`#/user/${encodeURIComponent(u.id)}`)
  );

  container.querySelector('#btn-change-password').addEventListener('click', () => {
    openModal(
      `
        <h3 class="card-title" style="margin-bottom:8px;">החלפת סיסמה</h3>
        <p class="help-text" style="margin-top:0;margin-bottom:10px;">
          החלפת הסיסמה תנתק אוטומטית מכשירים אחרים שמחוברים לחשבונך.
        </p>
        <form id="change-pw-form">
          <div class="form-group">
            <label class="form-label" for="cur-pw">סיסמה נוכחית</label>
            <input id="cur-pw" class="input" type="password" required autocomplete="current-password" />
          </div>
          <div class="form-group">
            <label class="form-label" for="new-pw">סיסמה חדשה (לפחות 8 תווים)</label>
            <input id="new-pw" class="input" type="password" required minlength="8" autocomplete="new-password" />
          </div>
          <div class="btn-row">
            <button type="submit" class="btn btn-primary">עדכון סיסמה</button>
            <button type="button" class="btn btn-outline" id="chpw-cancel">ביטול</button>
          </div>
        </form>
      `,
      (root, close) => {
        root.querySelector('#chpw-cancel').addEventListener('click', close);
        root.querySelector('#change-pw-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const cur = root.querySelector('#cur-pw').value;
          const next = root.querySelector('#new-pw').value;
          try {
            const res = await api.changePassword(cur, next);
            close();
            showToast(res.message || 'הסיסמה עודכנה');
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      }
    );
  });

  container.querySelector('#btn-logout-all').addEventListener('click', async () => {
    try {
      const res = await api.logoutAll();
      app.setUser(null);
      app.setUnreadCount(0);
      showToast(res.message || 'התנתקת מכל המכשירים');
      app.navigate('#/auth');
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const run_privacy = container.querySelector('input[name="run_privacy"]:checked')?.value;
    const show_in_global_leaderboard = container.querySelector('#show-global-lb').checked;
    const display_name = container.querySelector('#set-display-name').value.trim();
    const email = container.querySelector('#set-email').value.trim();
    const bio = container.querySelector('#set-bio').value.trim();
    const goalRaw = container.querySelector('#set-weekly-goal').value.trim();
    const weekly_goal_km = goalRaw === '' ? null : Number(goalRaw);

    try {
      const res = await api.updateSettings({
        run_privacy,
        show_in_global_leaderboard,
        display_name,
        email,
        bio,
        weekly_goal_km,
      });
      app.setUser(res.user);
      showToast('ההגדרות נשמרו בהצלחה');
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#btn-export-data').addEventListener('click', async () => {
    try {
      const exported = await api.exportMyData();
      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `isrunner-${u.username}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('קובץ ייצוא הנתונים הורד');
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#btn-logout').addEventListener('click', async () => {
    try {
      await api.logout();
      app.setUser(null);
      app.setUnreadCount(0);
      showToast('התנתקת מהחשבון');
      app.navigate('#/auth');
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#btn-delete-account').addEventListener('click', () => {
    openModal(
      `
        <h3 class="card-title" style="margin-bottom:8px;color:var(--red-text);">מחיקת חשבון לצמיתות</h3>
        <div class="info-box" style="margin-bottom:12px;">
          <ul style="margin:0;padding-right:18px;font-size:0.84rem;">
            <li>כל הריצות, החברויות, ההתראות וחיבורי הספק שלך יימחקו.</li>
            <li>דיווחים קיימים עוברים לאנונימיזציה (ללא שמך) לצורכי בקרה.</li>
            <li>שם המשתמש שלך נשמר תפוס (כ-hash) למניעת התחזות.</li>
            <li>קבוצות שאתה מנהל עוברות אוטומטית לחבר הוותיק ביותר.</li>
          </ul>
        </div>
        <form id="delete-account-form">
          <div class="form-group">
            <label class="form-label" for="del-acct-pw">הזן את הסיסמה הנוכחית לאישור</label>
            <input id="del-acct-pw" class="input" type="password" required autocomplete="current-password" />
          </div>
          <div class="btn-row">
            <button type="submit" class="btn btn-danger">אישור מחיקת חשבון</button>
            <button type="button" class="btn btn-outline" id="del-acct-cancel">ביטול</button>
          </div>
        </form>
      `,
      (root, close) => {
        root.querySelector('#del-acct-cancel').addEventListener('click', close);
        root.querySelector('#delete-account-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const pw = root.querySelector('#del-acct-pw').value;
          try {
            await api.deleteMyAccount(pw);
            close();
            app.setUser(null);
            app.setUnreadCount(0);
            showToast('החשבון נמחק לצמיתות');
            app.navigate('#/auth');
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      }
    );
  });

  bindRunAndProfileClicks(container, app);
}
