export function renderPrivacyView(container) {
  container.innerHTML = `
    <h1 class="page-title">מדיניות פרטיות (טיוטה מקומית)</h1>

    <section class="card card-amber">
      <h2 class="card-title" style="margin-bottom:6px;">סטטוס מסמך</h2>
      <p style="margin:0;font-size:0.9rem;color:var(--text-secondary);">
        זו טיוטת מדיניות פרטיות להכנה מקומית בלבד. לפני עלייה לאוויר ולפני הגשת בקשת Garmin, בעל השירות ימלא את פרטיו האישיים ויאשר את הנוסח הסופי.
      </p>
    </section>

    <section class="card">
      <h2 class="card-title" style="margin-bottom:8px;">1. מפעיל השירות ויצירת קשר</h2>
      <div class="info-box">
        <div><strong>שם בעל השירות:</strong> [למילוי על ידך לפני עלייה לאוויר]</div>
        <div><strong>אימייל לפניות פרטיות ומחיקה:</strong> [למילוי על ידך לפני עלייה לאוויר]</div>
        <div><strong>גיל מינימום מומלץ:</strong> 18+ (מפחית מורכבות משפטית של הסכמת הורים ומתאים לתנאי ספקי מדידה כמו Garmin).</div>
      </div>
    </section>

    <section class="card">
      <h2 class="card-title" style="margin-bottom:8px;">2. איזה מידע נשמר ב-Isrunner</h2>
      <ul style="margin:0;padding-right:18px;font-size:0.9rem;color:var(--text-secondary);">
        <li>פרטי חשבון: שם משתמש, שם תצוגה, תיאור קצר, סיסמה מוצפנת (PBKDF2 עם סולט), וכתובת אימייל (אם הוזנה — לאימות ושחזור סיסמה בלבד).</li>
        <li>נתוני ריצה: מרחק, זמן מדידה, תאריך, הערה אופציונלית, הגדרת שיתוף ומקור הריצה.</li>
        <li>קשרים חברתיים: חברים, חסימות, חברות בקבוצות, התראות בתוך האפליקציה ודיווחים.</li>
        <li>בעתיד (רק לאחר אישור Garmin והסכמה מפורשת שלך): פרטי חיבור OAuth ומזהי פעילות מ-Garmin Connect.</li>
      </ul>
    </section>

    <section class="card">
      <h2 class="card-title" style="margin-bottom:8px;">3. שליטה, ייצוא ומחיקת חשבון</h2>
      <ul style="margin:0;padding-right:18px;font-size:0.9rem;color:var(--text-secondary);">
        <li><strong>פרטיות גמישה:</strong> ניתן לבחור בכל רגע בין "כולם", "חברים בלבד" או "אף אחד", להחליט אם להופיע בדירוג הכללי, ולהפוך כל ריצה בודדת לפרטית.</li>
        <li><strong>ניתוק מקור מדידה:</strong> ניתן לנתק מקור מדידה ולמחוק את כל הריצות שנקלטו ממנו בכל עת.</li>
        <li><strong>ייצוא נתונים:</strong> ניתן להוריד עותק JSON של נתוני החשבון והריצות שלך ממסך "אני".</li>
        <li><strong>מחיקת חשבון:</strong> מוחקת לצמיתות את החשבון, הריצות, החברויות, ההתראות וחיבורי הספק. דיווחים קיימים עוברים אנונימיזציה (ללא שם המשתמש) לשמירת בטיחות הקהילה, שם המשתמש נשמר תפוס (כ-hash בלבד) למניעת התחזות, וניהול קבוצה עובר אוטומטית לחבר הוותיק ביותר.</li>
      </ul>
    </section>
  `;
}
