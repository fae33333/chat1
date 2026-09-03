// اختبار نقطة تغيير كلمة المرور /api/chat/change-password
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // شهادة محلية
const sqlite3 = require('sqlite3');
const bcrypt = require('bcryptjs');
const BASE = 'https://localhost:2083';

let pass = 0, fail = 0;
function ok(c, label) {
  if (c) { pass++; console.log('  ✔ ' + label); }
  else { fail++; console.log('  ✖ ' + label); }
}

const db = new sqlite3.Database(__dirname + '/chat.db');
const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, e => (e ? rej(e) : res())));

async function api(path, body, token) {
  const headers = { 'Content-Type': 'application/json', 'X-Chat-Client': '1' };
  if (token) headers['X-Chat-Token'] = token;
  const r = await fetch(BASE + path, {
    method: 'POST', headers, body: JSON.stringify(body || {}),
    rejectUnauthorized: false
  });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
}

// إعداد المستخدم التجريبي مباشرة في قاعدة البيانات
async function setup() {
  await run(`DELETE FROM users WHERE username IN ('chpw_test_reg','chpw_test_guest')`);
  await run(`INSERT INTO users (username,password,email,email_verified,gender,age,country,balance,membership,rank,registered)
    VALUES ('chpw_test_reg',?,'',1,'boy',25,'jo',100,'none','user',1)`, [bcrypt.hashSync('oldpass1', 10)]);
  await run(`INSERT INTO users (username,email,gender,age,country,balance,membership,rank,registered)
    VALUES ('chpw_test_guest','','boy',25,'jo',100,'none','user',0)`);
}
(async () => {
  await setup();
  console.log('— 1) تسجيل دخول الحساب المسجل');
  let r = await api('/api/login', { username: 'chpw_test_reg', password: 'oldpass1' });
  ok(r.status === 200 && r.d.user && r.d.user.registered === 1, 'الدخول ناجح + registered=1');
  const tok = r.d.tab_token;
  ok(!!tok, 'حصلنا على tab_token');

  console.log('— 2) محاولات غير صالحة');
  r = await api('/api/chat/change-password', { current: 'wrong', next: 'newpass2' }, tok);
  ok(r.status === 400 && /غير صحيحة/.test(r.d.error || ''), 'رفض كلمة المرور الحالية الخاطئة');
  r = await api('/api/chat/change-password', { current: 'oldpass1', next: '123' }, tok);
  ok(r.status === 400, 'رفض كلمة المرور الجديدة القصيرة');
  r = await api('/api/chat/change-password', { current: 'oldpass1', next: 'oldpass1' }, tok);
  ok(r.status === 400, 'رفض كلمة المرور المتطابقة');

  console.log('— 3) تغيير ناجح + التحقق بالدخول');
  r = await api('/api/chat/change-password', { current: 'oldpass1', next: 'newpass2' }, tok);
  ok(r.status === 200 && r.d.ok === true, 'تم التغيير بنجاح');
  r = await api('/api/login', { username: 'chpw_test_reg', password: 'oldpass1' });
  ok(r.status === 400, 'كلمة المرور القديمة لم تعد تعمل');
  r = await api('/api/login', { username: 'chpw_test_reg', password: 'newpass2' });
  ok(r.status === 200, 'كلمة المرور الجديدة تعمل');

  console.log('— 4) الضيف (غير مسجل) لا يمكنه تغيير كلمة المرور');
  r = await api('/api/guest', { username: 'chpw_test_guest', gender: 'boy' });
  ok(r.status === 200 && r.d.tab_token, 'دخول الضيف');
  r = await api('/api/chat/change-password', { current: 'x', next: 'newpass2' }, r.d.tab_token);
  ok(r.status === 403, 'الضيف → 403');

  console.log('— 5) بدون توكن → 401');
  r = await api('/api/chat/change-password', { current: 'x', next: 'newpass2' });
  ok(r.status === 401, '401 بدون توكن');

  // تنظيف
  await run(`DELETE FROM users WHERE username IN ('chpw_test_reg','chpw_test_guest')`);
  db.close();

  console.log(`\nالنتيجة: ${pass} نجح / ${fail} فشل`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
