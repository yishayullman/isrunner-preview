import { api } from '../api.js';
import { escapeHtml, showToast } from '../utils.js';

export function renderAuthView(container, app) {
  let mode = 'login';

  function draw() {
    container.innerHTML = `
      <section class="auth-wrap">
        <div class="card hero-card auth-hero">
          <div style="font-size:0.78rem;font-weight:700;color:#ff8a66;margin-bottom:4px;">קהילת הרצים של ישראל</div>
          <h1>כל ריצה אמיתית נספרת.</h1>
          <p>מדידת GPS חיה מהטלפון, חיבורי Garmin ו-Strava, שיאים אישיים ודירוגים שקופים עם חברים וקבוצות.</p>
          <div class="auth-pillars">
            <span class="auth-pillar">שעון GPS חי</span>
            <span class="auth-pillar">Garmin ו-Strava</span>
            <span class="auth-pillar">דירוגים ללא זיופים</span>
          </div>
        </div>

        <div class="card">
          <div class="segmented" role="tablist">
            <button type="button" id="tab-login" class="segmented-btn ${mode === 'login' ? 'active' : ''}" role="tab" aria-selected="${mode === 'login'}">
              התחברות
            </button>
            <button type="button" id="tab-register" class="segmented-btn ${mode === 'register' ? 'active' : ''}" role="tab" aria-selected="${mode === 'register'}">
              הרשמה
            </button>
          </div>

          <div id="auth-error" class="alert-error hidden"></div>

          <form id="auth-form" novalidate>
            <div class="form-group">
              <label class="form-label" for="auth-username">${mode === 'login' ? 'שם משתמש או אימייל' : 'שם משתמש'}</label>
              <input id="auth-username" class="input" type="text" autocomplete="username" required placeholder="למשל: noa_runs" />
              ${mode === 'register' ? '<div class="help-text">2 עד 30 תווים (עברית, אנגלית, ספרות, נקודה או קו תחתון).</div>' : ''}
            </div>

            ${
              mode === 'register'
                ? `
                  <div class="form-group">
                    <label class="form-label" for="auth-display-name">שם תצוגה</label>
                    <input id="auth-display-name" class="input" type="text" autocomplete="name" required placeholder="למשל: נועה לוי" />
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="auth-email">אימייל אישי (חובה)</label>
                    <input id="auth-email" class="input" type="email" autocomplete="email" required placeholder="name@example.com" />
                    <div class="help-text">כתובת אימייל אחת לכל רץ (ללא מיילים זמניים או כפילויות +tag). כל רץ מופיע פעם אחת בלבד בכל טבלת דירוג.</div>
                  </div>
                `
                : ''
            }

            <div class="form-group">
              <label class="form-label" for="auth-password">סיסמה</label>
              <input id="auth-password" class="input" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required placeholder="לפחות 8 תווים" />
              ${mode === 'register' ? '<div class="help-text">מינימום 8 תווים. הסיסמה נשמרת מוצפנת (PBKDF2 עם סולט).</div>' : ''}
            </div>

            <button id="auth-submit-btn" type="submit" class="btn btn-primary btn-block">
              ${mode === 'login' ? 'כניסה לחשבון' : 'פתיחת חשבון חדש'}
            </button>
          </form>

          <div class="info-box" style="margin-top: 14px;">
            <strong>דירוג הוגן ופרטיות:</strong>
            אי אפשר להשתמש באפליקציה בלי הרשמה עם אימייל אישי ייחודי, וכל רץ נספר פעם אחת בלבד בטבלה (השיא הטוב ביותר שלו).
            <a href="#/privacy" style="font-weight:700;">טיוטת מדיניות פרטיות (גיל 18+)</a>
          </div>
        </div>

        <div class="card card-soft">
          <h2 class="card-title" style="margin-bottom:6px;">שקיפות מקורות מדידה</h2>
          <p style="margin:0;font-size:0.88rem;color:var(--text-secondary);">
            Isrunner נבנית סביב דירוג אמין ממקור מדידה אמיתי (GPS חי, Garmin Connect או Strava). הוספת ריצות ידנית סגורה.
          </p>
        </div>
      </section>
    `;

    container.querySelector('#tab-login').addEventListener('click', () => {
      mode = 'login';
      draw();
    });
    container.querySelector('#tab-register').addEventListener('click', () => {
      mode = 'register';
      draw();
    });

    const form = container.querySelector('#auth-form');
    const errorEl = container.querySelector('#auth-error');
    const submitBtn = container.querySelector('#auth-submit-btn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.classList.add('hidden');
      const username = container.querySelector('#auth-username').value.trim();
      const password = container.querySelector('#auth-password').value;
      const displayNameInput = container.querySelector('#auth-display-name');
      const emailInput = container.querySelector('#auth-email');
      const display_name = displayNameInput ? displayNameInput.value.trim() : undefined;
      const email = emailInput ? emailInput.value.trim() : undefined;

      if (mode === 'register' && !email) {
        errorEl.textContent = 'חובה להזין כתובת אימייל אישית כדי להירשם.';
        errorEl.classList.remove('hidden');
        return;
      }

      submitBtn.disabled = true;
      try {
        const res =
          mode === 'login'
            ? await api.login({ username, password })
            : await api.register({ username, display_name, email, password });
        if (typeof res.email_verification_enabled === 'boolean') {
          app.emailVerificationEnabled = res.email_verification_enabled;
        }
        app.setUser(res.user);
        if (mode === 'register' && res.verification_code_sent) {
          showToast('החשבון נוצר! נשלח קוד אימות למייל שלך (אפשר לאמת במסך "אני").');
        } else {
          showToast(mode === 'login' ? `שלום ${res.user.display_name}!` : 'החשבון נוצר בהצלחה!');
        }
        app.navigate('#/home');
      } catch (err) {
        errorEl.textContent = err.message || 'שגיאה בכניסה';
        errorEl.classList.remove('hidden');
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  draw();
}
