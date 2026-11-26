/**
 * Local development & visual testing seed script for Isrunner.
 * HONESTY RULE:
 * - Creates ONLY legacy runs (`source_type = 'self_reported_legacy'`, `source_verified = 0`,
 *   labeled "דיווח עצמי, לא מאומת").
 * - NEVER creates fake Garmin connections or fake "verified" runs.
 * - Intended strictly for local SQLite testing (`DB_PATH` or `./data/isrunner.db`).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, runInTransaction } from '../src/db.mjs';
import { generateId, hashPassword } from '../src/crypto.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, '../data/isrunner.db');

async function seed() {
  const db = openDatabase(DB_PATH);
  const existing = db.prepare('SELECT COUNT(*) AS cnt FROM users').get();
  if (existing.cnt > 0 && process.env.FORCE_RESEED !== '1') {
    console.log(`Database already has ${existing.cnt} users. Set FORCE_RESEED=1 to reset.`);
    db.close();
    return;
  }

  const now = Date.now();
  const daysAgo = (d, hours = 7) => new Date(now - d * 86400_000 - hours * 3600_000).toISOString();
  const nowIso = new Date(now).toISOString();

  const pw = await hashPassword('RunSafe123!');

  const users = [
    {
      id: generateId(),
      username: 'noa_levi',
      display_name: 'נועה לוי',
      email: 'noa.levi@example.com',
      bio: 'רצה 10 ק"מ וחצי מרתון בפארק הירקון',
      run_privacy: 'everyone',
      show_in_global_leaderboard: 1,
      weekly_goal_km: 30,
    },
    {
      id: generateId(),
      username: 'omer_cohen',
      display_name: 'עומר כהן',
      email: 'omer.cohen@example.com',
      bio: 'אוהב ריצות שחר רגועות על הטיילת',
      run_privacy: 'everyone',
      show_in_global_leaderboard: 1,
      weekly_goal_km: 40,
    },
    {
      id: generateId(),
      username: 'maya_sharon',
      display_name: 'מאיה שרון',
      email: 'maya.sharon@example.com',
      bio: 'מתאמנת ל-5 ק"מ הראשון מתחת ל-24 דקות',
      run_privacy: 'friends',
      show_in_global_leaderboard: 1,
      weekly_goal_km: 20,
    },
    {
      id: generateId(),
      username: 'dan_private',
      display_name: 'דן מזרחי',
      email: 'dan.mizrachi@example.com',
      bio: 'רץ בשקט בשביל הראש',
      run_privacy: 'none',
      show_in_global_leaderboard: 0,
      weekly_goal_km: null,
    },
  ];

  const [noa, omer, maya, dan] = users;

  runInTransaction(db, () => {
    if (process.env.FORCE_RESEED === '1') {
      db.exec('DELETE FROM reports; DELETE FROM notifications; DELETE FROM group_members; DELETE FROM groups; DELETE FROM blocks; DELETE FROM friendships; DELETE FROM runs; DELETE FROM provider_connections; DELETE FROM sessions; DELETE FROM users;');
    }

    const insertUser = db.prepare(
      `INSERT INTO users (id, username, display_name, email, email_canonical, email_verified, password_hash, run_privacy, show_in_global_leaderboard, weekly_goal_km, bio, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const u of users) {
      insertUser.run(
        u.id,
        u.username,
        u.display_name,
        u.email,
        u.email,
        pw,
        u.run_privacy,
        u.show_in_global_leaderboard,
        u.weekly_goal_km,
        u.bio,
        daysAgo(30),
        nowIso
      );
    }

    // Friendships: Noa <-> Omer (accepted), Maya -> Noa (pending incoming for Noa)
    db.prepare(
      `INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'accepted', ?, ?)`
    ).run(generateId(), noa.id, omer.id, daysAgo(20), daysAgo(19));

    db.prepare(
      `INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`
    ).run(generateId(), maya.id, noa.id, daysAgo(1), daysAgo(1));

    // Legacy self-reported runs ONLY (source_type='self_reported_legacy', source_verified=0)
    const insertRun = db.prepare(
      `INSERT INTO runs (
        id, user_id, distance_km, duration_sec, ran_at, note, is_shared,
        first_shared_at, notifications_dispatched, source_type, source_verified,
        source_external_id, source_ingested_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'self_reported_legacy', 0, NULL, NULL, ?, ?)`
    );

    const noaRuns = [
      { id: generateId(), km: 5.08, sec: 1412, at: daysAgo(1), note: 'בוקר קריר בפארק, הרגשה מצוינת', shared: 1 },
      { id: generateId(), km: 10.12, sec: 2985, at: daysAgo(3), note: 'קצב אחיד לאורך הירקון', shared: 1 },
      { id: generateId(), km: 21.15, sec: 6540, at: daysAgo(16), note: 'חצי מרתון אימון שבת', shared: 1 },
      { id: generateId(), km: 6.2, sec: 2220, at: daysAgo(0, 2), note: 'ריצת התאוששות פרטית — לא לשיתוף', shared: 0 },
    ];
    for (const r of noaRuns) {
      insertRun.run(r.id, noa.id, r.km, r.sec, r.at, r.note, r.shared, r.shared ? r.at : null, r.at, r.at);
    }

    const omerRunRecentId = generateId();
    const omerRuns = [
      { id: omerRunRecentId, km: 5.14, sec: 1305, at: daysAgo(0, 4), note: 'טמפו על הטיילת — הערה שלא אמורה להופיע בהתראה', shared: 1 },
      { id: generateId(), km: 10.05, sec: 2790, at: daysAgo(4), note: '10 ק"מ בוקר', shared: 1 },
      { id: generateId(), km: 24.5, sec: 7850, at: daysAgo(9), note: 'ארוכה של שבת', shared: 1 },
    ];
    for (const r of omerRuns) {
      insertRun.run(r.id, omer.id, r.km, r.sec, r.at, r.note, r.shared, r.at, r.at, r.at);
    }

    // One in-app notification for Noa about Omer's recent shared run (no note included!)
    db.prepare(
      `INSERT INTO notifications (id, recipient_id, actor_id, run_id, type, is_read, created_at)
       VALUES (?, ?, ?, ?, 'friend_shared_run', 0, ?)`
    ).run(generateId(), noa.id, omer.id, omerRunRecentId, daysAgo(0, 4));

    // Maya & Dan runs
    insertRun.run(generateId(), maya.id, 5.05, 1480, daysAgo(2), 'אימון מהירות', 1, daysAgo(2), daysAgo(2), daysAgo(2));
    insertRun.run(generateId(), dan.id, 5.02, 1200, daysAgo(2), 'ריצה פרטית', 1, daysAgo(2), daysAgo(2), daysAgo(2));

    // Sample Group
    const groupId = generateId();
    db.prepare(
      `INSERT INTO groups (id, name, description, join_code, owner_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(groupId, 'רצי פארק הירקון', 'קבוצת חברים לריצות בוקר ושישי רגועות.', 'YARKON', noa.id, daysAgo(15));

    db.prepare(
      `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)`
    ).run(groupId, noa.id, daysAgo(15));
    db.prepare(
      `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`
    ).run(groupId, omer.id, daysAgo(14));

    // Second group Noa is NOT in yet (to demonstrate preview-by-code & join)
    const group2Id = generateId();
    db.prepare(
      `INSERT INTO groups (id, name, description, join_code, owner_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(group2Id, 'ריצת שבת על הטיילת', 'נפגשים בשבת ב-06:30 לריצה משותפת בקצב נוח.', 'SEA630', omer.id, daysAgo(10));
    db.prepare(
      `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)`
    ).run(group2Id, omer.id, daysAgo(10));
  });

  console.log(`Seeded local demo DB at ${DB_PATH}`);
  console.log('Users (password for all: RunSafe123!): noa_levi, omer_cohen, maya_sharon, dan_private');
  console.log('Note: All seeded runs are explicitly marked "self_reported_legacy" (unverified).');
  db.close();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
