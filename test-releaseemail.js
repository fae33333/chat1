// اختبار: إلغاء/تحرير أي بريد عبر الإدارة + بقاء الحساب غير المفعَّل «محتاجاً للتفعيل»
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const sqlite3 = require('sqlite3');
const bcrypt = require('bcryptjs');
const BASE = 'https://localhost:2083';

let pass = 0, fail = 0;
function ok(c, label) { if (c) { pass++; console.log('  ✔ ' + label); } else { fail++; console.log('  ✖ ' + label); } }

const db = new sqlite3.Database(__dirname + '/chat.db');
const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, e => (e ? rej(e) : res())));
const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => (e ? rej(e) : res(r))));

async function api(path, { method = 'GET', body, token, adminToken } = {}) {
  const headers = { 'X-Chat-Client': '1' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['X-Chat-Token'] = token;
  if (adminToken) headers['X-Admin-Token'] = adminToken;
  const r = await fetch(BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
    rejectUnauthorized: false
  });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
}

(async () => {
  // إعداد: حساب مفعَّل + حساب غير مفعَّل (بريدان) + حساب غير مفعَّل لاختبار البوابة
  await run(`DELETE FROM users WHERE username IN ('relv_test','relu_test','gate_test')`);
  await run(`INSERT INTO users (username,password,email,email_verified,gender,age,country,balance,membership,rank,registered)
    VALUES ('relv_test',?,'vreleased1@gmail.com',1,'boy',25,'jo',100,'none','user',1)`, [bcrypt.hashSync('vpass1', 10)]);
  await run(`INSERT INTO users (username,password,email,email_verified,gender,age,country,balance,membership,rank,registered)
    VALUES ('relu_test',?,'vunrel1@gmail.com',0,'boy',25,'jo',100,'none','user',1)`, [bcrypt.hashSync('upass1', 10)]);
  await run(`INSERT INTO users (username,password,email,email_verified,gender,age,country,balance,membership,rank,registered)
    VALUES ('gate_test',?,'vgate1@gmail.com',0,'boy',25,'jo',100,'none','user',1)`, [bcrypt.hashSync('gpass1', 10)]);

  // دخول السوبر إدمين للحصول على رمز الإدارة
  let r = await api('/api/login', { method: 'POST', body: { username: 'ax', password: '123456' } });
  ok(r.status === 200 && r.d.admin_access_token, 'دخول السوبر إدمين + رمز الإدارة');
  const adminToken = r.d.admin_access_token;

  console.log('— 1) بحث عن حسابات بالبريد');
  r = await api('/api/admin/find-account?q=vreleased1@gmail.com', { adminToken });
  ok(r.status === 200 && (r.d.found || []).some(x => x.username === 'relv_test'), 'البحث يجد الحساب المفعَّل');
  r = await api('/api/admin/find-account?q=vunrel1', { adminToken });
  ok(r.status === 200 && (r.d.found || []).some(x => x.username === 'relu_test'), 'البحث بالاسم/البريد الجزئي');

  console.log('— 2) إلغاء بريد حساب مفعَّل (أي إيميل)');
  const v = await get(`SELECT id FROM users WHERE username='relv_test'`);
  r = await api(`/api/admin/release-email/${v.id}`, { method: 'POST', adminToken });
  ok(r.status === 200 && r.d.ok && r.d.released === 'vreleased1@gmail.com', 'تم إلغاء بريد الحساب المفعَّل');
  const vAfter = await get(`SELECT email, email_verified FROM users WHERE id=?`, v.id);
  ok(vAfter.email === '' && vAfter.email_verified === 0, 'البريد حُذف والحالة صارت غير مفعَّلة');

  console.log('— 3) إلغاء بريد حساب غير مفعَّل');
  const u = await get(`SELECT id FROM users WHERE username='relu_test'`);
  r = await api(`/api/admin/release-email/${u.id}`, { method: 'POST', adminToken });
  ok(r.status === 200 && r.d.released === 'vunrel1@gmail.com', 'تم إلغاء بريد الحساب غير المفعَّل');
  const uAfter = await get(`SELECT email FROM users WHERE id=?`, u.id);
  ok(uAfter.email === '', 'البريد حُذف');

  console.log('— 4) البرد المحرَّر يُستخدم لحساب آخر (فريدة البريد)');
  r = await api('/api/register', { method: 'POST', body: { username: 'reuse_' + Date.now() % 100000, password: 'pass1234', gender: 'boy', age: 25, email: 'vreleased1@gmail.com' } });
  ok(r.status === 200, 'التسجيل بالبريد المحرَّر مقبول');
  if (r.status === 200) {
    const row = await get(`SELECT id FROM users WHERE email='vreleased1@gmail.com'`);
    await run(`DELETE FROM users WHERE id=?`, row.id);
  }

  console.log('— 5) حساب غير مفعَّل: يبقى «محتاجاً للتفعيل» (بوابة API)');
  r = await api('/api/login', { method: 'POST', body: { username: 'gate_test', password: 'gpass1' } });
  ok(r.status === 200 && r.d.needs_verification === true, 'الدخول يطلب التحقق (needs_verification)');
  const tok = r.d.tab_token;
  r = await api('/api/chat/change-password', { method: 'POST', body: { current: 'gpass1', next: 'newpass9' }, token: tok });
  ok(r.status === 403 && /غير مفعّل/.test(r.d.error || ''), 'الـ API يحظر أي عملية قبل التفعيل (403)');
  r = await api('/api/verify-email', { method: 'POST', body: { code: '000000' }, token: tok });
  ok(r.status !== 403 || !/غير مفعّل/.test(r.d.error || ''), 'مسار التفعيل نفسه غير محظور');

  // تنظيف
  await run(`DELETE FROM users WHERE username IN ('relv_test','relu_test','gate_test')`);
  db.close();

  console.log(`\nالنتيجة: ${pass} نجح / ${fail} فشل`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
