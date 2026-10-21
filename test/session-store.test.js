const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// نختبر الموديول على ملف JSON مؤقت في مجلد مؤقت (لا نلمس data/sessions.json الحقيقي)
process.env.SESSIONS_JSON_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'sc-sessions-')),
  'sessions.json'
);
const store = require('../session-store');

test('session-store: إنشاء جلسة ثم قراءتها وحذفها', () => {
  const token = store.createSession('user', { userId: 'u1', nickname: 'tester' }, 60 * 1000);
  assert.ok(token.startsWith('usr_'), 'رمز الجلسة يبدأ بـ usr_');

  const rec = store.getSession('user', token);
  assert.ok(rec, 'الجلسة تُقرأ بعد الإنشاء');
  assert.strictEqual(rec.userId, 'u1');
  assert.strictEqual(rec.nickname, 'tester');

  assert.strictEqual(store.deleteSession('user', token), true);
  assert.strictEqual(store.getSession('user', token), null);
});

test('session-store: جلسة منتهية الصلاحية لا تُقرأ', () => {
  const token = store.createSession('admin', { username: 'root', role: 'owner' }, 60 * 1000);
  const rec = store.getSession('admin', token);
  assert.ok(rec && rec.username === 'root');

  // ندّيّن الانتهاء مباشرة في الملف ثم نتأكد من عدم القراءة
  const raw = JSON.parse(fs.readFileSync(store.FILE_PATH, 'utf8'));
  raw.admin[token].expiresAt = Date.now() - 1000;
  fs.writeFileSync(store.FILE_PATH, JSON.stringify(raw), 'utf8');
  assert.strictEqual(store.getSession('admin', token), null);
});

test('session-store: الرموز الخاطئة أو المجهولة تُرجع null', () => {
  assert.strictEqual(store.getSession('user', ''), null);
  assert.strictEqual(store.getSession('user', null), null);
  assert.strictEqual(store.getSession('user', 'usr_not_exists'), null);
  assert.strictEqual(store.getSession('nonsense', 'x'), null);
});

test('session-store: deleteUserSessions يحذف كل جلسات المستخدم', () => {
  const t1 = store.createSession('user', { userId: 'u-del' }, 60 * 1000);
  const t2 = store.createSession('user', { userId: 'u-del' }, 60 * 1000);
  const tKeep = store.createSession('user', { userId: 'u-keep' }, 60 * 1000);
  const n = store.deleteUserSessions('u-del');
  assert.strictEqual(n, 2);
  assert.strictEqual(store.getSession('user', t1), null);
  assert.strictEqual(store.getSession('user', t2), null);
  assert.ok(store.getSession('user', tKeep), 'جلسات بقية المستخدمين تبقى');
  store.deleteSession('user', tKeep);
});

test('session-store: حد أقصى 10 جلسات لكل مستخدم', () => {
  const tokens = [];
  for (let i = 0; i < 12; i++) {
    tokens.push(store.createSession('user', { userId: 'u-cap', nickname: 'n' + i }, 60 * 1000));
  }
  let alive = 0;
  for (const t of tokens) if (store.getSession('user', t)) alive++;
  assert.ok(alive <= 10, `لا يبقى أكثر من 10 جلسات (بقي ${alive})`);
  for (const t of tokens) store.deleteSession('user', t);
});

test('session-store: الملف يُكتب كـ JSON صالح', () => {
  const token = store.createSession('user', { userId: 'u-json' }, 60 * 1000);
  const raw = fs.readFileSync(store.FILE_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  assert.ok(parsed.user && parsed.user[token], 'الجلسة محفوظة داخل بنية JSON');
  assert.strictEqual(parsed.user[token].userId, 'u-json');
  store.deleteSession('user', token);
});
