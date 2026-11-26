# הפעלת חיבורים אמיתיים ל־Strava ול־Garmin Connect ב־Isrunner

הקוד ל־**OAuth 2.0**, לסנכרון ריצות ול־**Webhooks** כבר מוכן במלואו גם בשרת ה־Node.js וגם בקובץ `cloudflare/worker.js`.
כדי להפעיל כל ספק בפועל, צריך להזין רק את מפתחות ה־API ב־**Cloudflare Dashboard → Workers & Pages → `isrunner-test` → Settings → Variables and Secrets**.

---

## 1. הפעלת Strava (לוקח כ־2 דקות, חינמי, בלי להמתין לאישור)

> **טיפ לרצי Garmin:** רוב רצי Garmin כבר מסנכרנים את השעון אוטומטית אל Strava (ב־Garmin Connect → הגדרות → אפליקציות מחוברות → Strava). ברגע ש־Strava מחוברת ל־Isrunner, גם ריצות משעון Garmin נקלטות ל־Isrunner אוטומטית (עם שם שעון ה־Garmin)!

1. פתח https://www.strava.com/settings/api וצור אפליקציה:
   - **Application Name:** `Isrunner`
   - **Website:** `https://<הכתובת-שלך>.workers.dev`
   - **Authorization Callback Domain:** `<הכתובת-שלך>.workers.dev` (רק הדומיין, בלי `https://` ובלי `/`)
2. העתק משם את **Client ID** ו־**Client Secret**.
3. ב־Cloudflare Worker (`isrunner-test`) → **Settings → Variables and Secrets**, הוסף שני **Secrets**:
   - `STRAVA_CLIENT_ID`
   - `STRAVA_CLIENT_SECRET`
   - *(אופציונלי ל־Webhook אוטומטי)*: `STRAVA_WEBHOOK_VERIFY_TOKEN` (מחרוזת אקראית שתבחר, ותירשם מול Strava ל־`https://<הכתובת-שלך>.workers.dev/api/webhooks/strava`)
4. לחץ **Deploy**. מעכשיו כפתור **"התחבר עם Strava (OAuth 2.0)"** במסך **מקורות מדידה** ייפתח למסך ההתחברות האמיתי של Strava וייבא ריצות אמיתיות!

---

## 2. הפעלת Garmin Connect ישירות (OAuth 2.0 PKCE + Push Webhook)

Garmin Connect Developer Program דורש הגשת בקשה ואישור רשמי (ראה טיוטה מוכנה ב־`docs/garmin-developer-application-draft.md`).

לאחר קבלת האישור מ־Garmin:
1. בפורטל המפתחים של Garmin הגדר:
   - **OAuth 2.0 Redirect URI:** `https://<הכתובת-שלך>.workers.dev/api/oauth/garmin/callback`
   - **Activity Push Endpoint URL:** `https://<הכתובת-שלך>.workers.dev/api/webhooks/garmin`
2. ב־Cloudflare Worker (`isrunner-test`) → **Settings → Variables and Secrets**, הוסף:
   - `GARMIN_CLIENT_ID` (Consumer Key / Client ID מפורטל Garmin)
   - `GARMIN_CLIENT_SECRET` (Consumer Secret מפורטל Garmin)
   - `GARMIN_WEBHOOK_SECRET` *(אופציונלי — מומלץ לאימות חתימת Webhook)*
3. לחץ **Deploy**. מעכשיו כפתור **"התחבר עם Garmin Connect (OAuth 2.0)"** יפעל ישירות מול Garmin!

---

## 3. מדידת ריצה חיה בתוך Isrunner (GPS)

**פועל מיד ללא שום מפתחות חיצוניים!**
- בדף הבית ובמסך **מקורות מדידה** יש כפתור **`▶ מדוד ריצה עכשיו (GPS)`**.
- מודד מרחק, זמן נטו (עם השהיה), קצב ממוצע, קצב נוכחי, פיצולי ק"מ (Splits) ומפת מסלול חיה באמצעות `navigator.geolocation.watchPosition` + `Wake Lock`.
- בסיום הריצה, הנקודות נשלחות אל `POST /api/runs/gps`, והשרת מחשב ומאמת מחדש את המרחק, הזמן והפיצולים (מסנן קפיצות GPS) ושומר תחת המקור השקוף **`מדידת GPS ב-Isrunner`**.

---

## 4. הפעלת אימות אימייל בקוד בן 6 ספרות (Resend — חינם עד 3,000 מיילים בחודש)

1. פתח חשבון חינמי ב־https://resend.com וצור **API Key**.
2. ב־Cloudflare Worker (`isrunner-test`) → **Settings → Variables and Secrets**, הוסף:
   - `RESEND_API_KEY` (מפתח ה־API מ־Resend)
   - `EMAIL_FROM` *(אופציונלי — ברירת מחדל `Isrunner <onboarding@resend.dev>`, ובדומיין שלך למשל `Isrunner <noreply@yourdomain.com>`)*
3. לחץ **Deploy**. מעכשיו כל נרשם חדש מקבל קוד בן 6 ספרות למייל, ורק חשבונות **מאומתים** מופיעים בדירוג הכללי (בנוסף לחסימת מיילים זמניים וכפילויות Gmail/+tag שכבר פועלות תמיד).
