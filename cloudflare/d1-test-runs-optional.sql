-- ============================================================
-- אופציונלי בלבד — עבור מסד הבדיקה isrunner-test בלבד!
-- אל תריץ על המסד החי "isrunner"!
--
-- איך להשתמש (רק אם תרצה לראות ריצות לדוגמה בטבלאות הדירוג):
-- 1. הירשם באפליקציית הבדיקה (למשל עם שם משתמש test1).
-- 2. ב-D1 Console של isrunner-test, החלף את 'test1' למטה בשם המשתמש שנרשמת איתו והרץ.
-- כל הריצות כאן מסומנות בכנות "דיווח עצמי, לא מאומת" (source_verified = 0).
-- ============================================================

INSERT INTO runs (
  id, user_id, distance_km, duration_sec, ran_at, note, is_shared,
  first_shared_at, notifications_dispatched, source_type, source_verified,
  source_external_id, source_ingested_at, created_at, updated_at
)
SELECT
  'demo-run-5k-1', id, 5.08, 1412, datetime('now', '-1 day') || 'Z',
  'ריצת בדיקה 5 ק"מ', 1, datetime('now', '-1 day') || 'Z', 1,
  'self_reported_legacy', 0, NULL, NULL, datetime('now') || 'Z', datetime('now') || 'Z'
FROM users WHERE username = 'test1' COLLATE NOCASE;

INSERT INTO runs (
  id, user_id, distance_km, duration_sec, ran_at, note, is_shared,
  first_shared_at, notifications_dispatched, source_type, source_verified,
  source_external_id, source_ingested_at, created_at, updated_at
)
SELECT
  'demo-run-10k-1', id, 10.12, 2985, datetime('now', '-3 days') || 'Z',
  'ריצת בדיקה 10 ק"מ', 1, datetime('now', '-3 days') || 'Z', 1,
  'self_reported_legacy', 0, NULL, NULL, datetime('now') || 'Z', datetime('now') || 'Z'
FROM users WHERE username = 'test1' COLLATE NOCASE;

INSERT INTO runs (
  id, user_id, distance_km, duration_sec, ran_at, note, is_shared,
  first_shared_at, notifications_dispatched, source_type, source_verified,
  source_external_id, source_ingested_at, created_at, updated_at
)
SELECT
  'demo-run-private-1', id, 6.20, 2220, datetime('now') || 'Z',
  'ריצת התאוששות פרטית (נראית רק לך)', 0, NULL, 1,
  'self_reported_legacy', 0, NULL, NULL, datetime('now') || 'Z', datetime('now') || 'Z'
FROM users WHERE username = 'test1' COLLATE NOCASE;
