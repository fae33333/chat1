// اختبار: الحساب غير الموثَّق لا يحجز اسم/بريد — تبقى حرة حتى التوثيق
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const sqlite3 = require('sqlite3');
const bcrypt = require('bcryptjs');
const BASE = 'https://localhost:2083';

let pass = 0, fail = 0;
function ok(c, label) { if (c) { pass++; console.log('  ✔ ' + label); } else { fail++; console.log('  ✖ ' + label); } }

const db = new sqlite3.Database(__dirname + '/chat.db');
const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, e => (e ? rej(e) : res())));
const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => (e ? rej(e) : res(r))));
const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'X-Chat-Client': '1' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['X-Chat-Token'] = token;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, rejectUnauthorized: false });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
}

(async () => {
  const T = Date.now() % 1000000;
  const nA = 'frname' + T, nB = 'frname2' + T;
  const eX = 'frtest' + T + '@gmail.com', eY = 'frtest2' + T + '@gmail.com';
  const eV = 'frtest3' + T + '@gmail.com';
  const nV = 'frverif' + T;
  const pw = 'freepass1';

  // حساب مفعَّل (بريد مفعول) — اسمه وبريده يجب أن يبقيا محجوزين
  await run(`DELETE FROM users WHERE username IN (?,?,?,?,?)`, [nA, nB, nV, nA + '_old0', nB + '_old0']);
  await run(`INSERT INTO users (username,password,email,email_verified,gender,age,country,balance,membership,rank,registered)
    VALUES (?,?,?,1,'boy',25,'jo',100,'none','user',1)`, [nV, bcrypt.hashSync(pw, 10), eV]);

  console.log('— 1) تسجيل nameA + emailX (غير مفعَّل بعد)');
  let r = await api('/api/register', { method: 'POST', body: { username: nA, password: pw, gender: 'boy', age: 25, email: eX } });
  ok(r.status === 200 && r.d.needs_verification === true, 'التسجيل نجح ويطلب التفعيل');
  let row = await get(`SELECT username, email, email_verified, pending_activation FROM users WHERE username=?`, nA);
  ok(row && row.email === eX && row.email_verified === 0, 'الحساب غير مفعَّل لديه البريد');

  console.log('— 2) إعادة التسجيل باسم جديد + نفس البريد → مقبولة (البريد غير الموثَّق حر)');
  r = await api('/api/register', { method: 'POST', body: { username: nB, password: pw, gender: 'boy', age: 25, email: eX } });
  ok(r.status === 200 && r.d.needs_verification === true, 'التسجيل بالبريد المحرَّر مقبول');
  const oldA = await all(`SELECT username, email, pending_activation FROM users WHERE username LIKE ?`, nA + '%');
  ok(oldA.some(x => x.email === '' && x.pending_activation === 1), 'الحساب القديم خسر بريده وبقى «محتاجاً للتفعيل»');
  row = await get(`SELECT username, email, email_verified FROM users WHERE username=?`, nB);
  ok(row && row.email === eX && row.email_verified === 0, 'البريد انتقل للحساب الجديد');

  console.log('— 3) إعادة التسجيل بالاسم القديم (nameA) + بريد آخر → مقبول (الاسم حر)');
  r = await api('/api/register', { method: 'POST', body: { username: nA, password: pw, gender: 'boy', age: 25, email: eY } });
  ok(r.status === 200 && r.d.needs_verification === true, 'الاسم المحرَّر يُقبل من جديد');
  // ملاحظة: نفتح وصلة SQLite جديدة للفحص (الوصلة الدائمة قد تقرأ لقطة WAL قديمة)
  const freshAll = (sql, p = []) => new Promise((res, rej) => {
    const d2 = new sqlite3.Database(__dirname + '/chat.db');
    d2.all(sql, p, (e, r) => { d2.close(); e ? rej(e) : res(r); });
  });
  let renamed = [];
  for (let i = 0; i < 5; i++) {
    renamed = await freshAll(`SELECT username, email, pending_activation FROM users WHERE username LIKE ? AND username<>?`, nA + '%', nA);
    if (renamed.length >= 1) break;
    await new Promise(rs => setTimeout(rs, 100));
  }
  const persistentRows = await all(`SELECT username, email, pending_activation FROM users WHERE username LIKE ?`, nA + '%');
  console.log('DBG fresh:', JSON.stringify(renamed));
  console.log('DBG persistent:', JSON.stringify(persistentRows));
  if (renamed.length === 0 && persistentRows.length > 0) renamed = persistentRows.filter(x => x.username !== nA);
  ok(renamed.length >= 1 && renamed.every(x => x.email === '' && x.pending_activation === 1), 'الحساب المهمل أُعيدت تسميته وبقي محجوزاً');
  row = await get(`SELECT email FROM users WHERE username=?`, nA);
  ok(row && row.email === eY, 'الاسم القديم عاد بحوزة التسجيل الجديد');

  console.log('— 4) الحساب المهمل (بدون بريد) لا يتجاوز التوثيق');
  const oldRow = renamed[0];
  r = await api('/api/login', { method: 'POST', body: { username: oldRow.username, password: pw } });
  ok(r.status === 200 && r.d.needs_verification === true, 'الدخول يطلب التفعيل رغم عدم وجود بريد');
  const tok = r.d.tab_token;
  r = await api('/api/chat/change-password', { method: 'POST', body: { current: pw, next: 'newpass9' }, token: tok });
  ok(r.status === 403 && /غير مفعّل/.test(r.d.error || ''), 'الـ API يحظر العمليات (403)');

  console.log('— 5) الحساب المفعَّل: اسمه وبريده ما زالا محجوزين');
  r = await api('/api/register', { method: 'POST', body: { username: nV, password: pw, gender: 'boy', age: 25, email: eY } });
  ok(r.status === 400 && /الاسم مستخدم/.test(r.d.error || ''), 'اسم الحساب المفعَّل محجوز');
  r = await api('/api/register', { method: 'POST', body: { username: 'frnew' + T, password: pw, gender: 'boy', age: 25, email: eV } });
  ok(r.status === 400 && /مستخدم لحساب آخر/.test(r.d.error || ''), 'بريد الحساب المفعَّل محجوز');

  // تنظيف
  const testUsers = await all(`SELECT id FROM users WHERE username LIKE 'frname%' OR username LIKE ? OR username LIKE ? OR username LIKE ?`, [nV + '%', 'frnew' + T + '%', nA + '%']);
  for (const u of testUsers) await run(`DELETE FROM users WHERE id=?`, u.id);
  db.close();

  console.log(`\nالنتيجة: ${pass} نجح / ${fail} فشل`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
