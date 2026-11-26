# טיוטת בקשה ל-Garmin Connect Developer Program (Isrunner)

> **הבהרה חשובה:** מסמך זה הוא **טיוטה בלבד** להכנה. לא הוגש שום טופס, לא נפתח חשבון מפתח ולא נחתם שום הסכם בשמך. ההגשה, הזכאות, ההסכמים ומפתחות ה-OAuth הם באחריות בעל השירות בלבד.

---

## 1. מה חסר לפני שאפשר להגיש (רשימת בדיקה)

1. **זכאות לתוכנית המפתחים של Garmin:**
   - Garmin Connect Developer Program מיועדת בדרך כלל ליישומי בריאות/כושר מסחריים או ארגוניים ודורשת בחינת זכאות ואישור ידני ע"י Garmin. עדיין לא ידוע אם Isrunner עומדת בקריטריוני הזכאות הנוכחיים (למשל דרישת ישות עסקית/עוסק/חברה, נפח משתמשים או תחום פעילות).
2. **פרטי המבקש (לא הונחו — נדרש מילוי ידני שלך):**
   - `[נדרש מילוי: שם מלא של המבקש / בעל השירות]`
   - `[נדרש מילוי: כתובת אימייל ליצירת קשר עם Garmin]`
   - `[נדרש מילוי: ישות משפטית — פרטי / עוסק מורשה / חברה, אם רלוונטי]`
   - `[נדרש מילוי: כתובת אתר ייצור של Isrunner]`
3. **כתובות ותשתית ייצור נדרשות:**
   - `[נדרש מילוי: Privacy Policy URL פומבי ופעיל]` (תלוי באישור דף מדיניות הפרטיות ופרטי בעל השירות)
   - `[נדרש מילוי: OAuth Callback URL ב-HTTPS]` (לדוגמה: `https://<your-domain>/api/integrations/garmin/callback`)
   - `[נדרש מילוי: Webhook / Push Endpoint URL ב-HTTPS]` (לדוגמה: `https://<your-domain>/api/ingest/provider/garmin_connect`)
4. **אישור הסכם ה-API וקבלת מפתחות:**
   - לאחר אישור הבקשה, Garmin מספקת סביבת Evaluation/Production עם `Consumer Key` ו-`Consumer Secret`.
   - המפתחות יוגדרו **רק** כמשתני סביבה/סודות בשרת (`GARMIN_CONSUMER_KEY`, `GARMIN_CONSUMER_SECRET`, `GARMIN_WEBHOOK_SECRET`) — לעולם לא בקוד המקור.

---

## 2. טיוטת תיאור הבקשה (אנגלית — לשדות הטופס של Garmin)

### Application Name
`Isrunner`

### Applicant / Organization
- Contact Name: `[OWNER_FULL_NAME — TO BE FILLED BY OWNER]`
- Contact Email: `[OWNER_CONTACT_EMAIL — TO BE FILLED BY OWNER]`
- Organization / Legal Entity: `[LEGAL_ENTITY_OR_INDIVIDUAL — TO BE FILLED BY OWNER]`
- Website URL: `[PRODUCTION_WEBSITE_URL — TO BE FILLED BY OWNER]`
- Privacy Policy URL: `[PRIVACY_POLICY_URL — TO BE FILLED BY OWNER]`

### Requested API
- **Garmin Connect Activity API** (read-only ingestion of user-consented running activities via Push/Ping notifications).

### Application Description (Draft)
> **Isrunner** is a Hebrew-language, mobile-first running community web application where runners track weekly mileage, view personal records (5K, 10K, Half Marathon, Marathon, and Longest Run), and participate in transparent friend and group leaderboards.
>
> To keep community rankings trustworthy and prevent fabricated or manually edited entries, Isrunner does not allow manual run logging or editable GPX/FIT uploads. Instead, we aim to ingest running activities exclusively from verified measurement sources such as Garmin Connect after explicit user OAuth consent.
>
> **Data Usage & User Control:**
> - Only running activity summaries (distance, measured duration, start timestamp, and Garmin activity ID for deduplication) are stored.
> - Users explicitly review a consent screen before initiating OAuth.
> - Every synced run displays its measurement source transparently.
> - Users can mark any individual run as private at any time, choose profile privacy (`everyone`, `friends`, `none`), opt out of global leaderboards, disconnect their Garmin account at any time, and delete all Garmin-sourced runs from Isrunner with one action.
> - Isrunner does not sell user data and does not perform automated medical/AI diagnostics.

### Technical Architecture Summary (Draft)
- Server-side OAuth authentication and server-side verified ingestion endpoint (`/api/ingest/provider/garmin_connect`).
- No client-supplied verification flags; source provenance (`source_type`, `source_external_id`, `source_ingested_at`) is stamped strictly by the backend.
- Full support for Garmin deregistration/revocation callbacks and user-initiated disconnect + data deletion.

---

## 3. תזכורת לאלטרנטיבות אם Garmin לא תאשר

אם יתברר שאין זכאות ישירה ל-Garmin Connect Developer Program בשלב זה, ניתן לבחון (רק בהחלטתך):
- שילוב אפליקציות מדידה אחרות עם תוכניות מפתחים פתוחות יותר (כגון Polar AccessLink / Suunto / Coros / Strava — תוך בדיקת תנאי השימוש של כל ספק לגבי טבלאות דירוג).
- עד להחלטה וחיבור אמיתי, הוספת הריצות נשארת סגורה והאפליקציה מציגה זאת בשקיפות מלאה.
