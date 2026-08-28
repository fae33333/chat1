// اختبار نظام استعادة كلمة المرور: رمز 6 أرقام عبر البريد + تغيير كلمة المرور
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const sqlite3 = require('/home/user/chat1/node_modules/sqlite3');
const bcrypt = require('/home/user/chat1/node_modules/bcryptjs');
const BASE = 'https://localhost:2083';
const DB = new sqlite3.Database('/home/user/chat1/chat.db');
const qrun = (s, p = []) => new Promise((r, j) => DB.run(s, p, e => e ? j(e) : r()));
const qget = (s, p = []) => new Promise((r, j) => DB.get(s, p, (e, x) => e ? j(e) : r(x)));
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? (pass++, console.log('  ✔ ' + n)) : (fail++, console.log('  ✘ ' + n + ' ' + x)); };

(async () => {
  const T = Date.now() % 100000000;
  // بريد حقيقي لتصل رسالة الرمز فعلياً (برهان كامل المسار) — حساب تجريبي سيُحذف بعدها
  const email = 'remanatsheh066@gmail.com';
  const uname = 'resetpw' + T;
  const oldPw = 'oldpass1', newPw = 'newpass2';
  await qrun(`DELETE FROM users WHERE username=?`, [uname]);
  await qrun(`INSERT INTO users (username,password,email,email_verified,gender,age,country,balance,membership,rank,registered)
    VALUES (?,?,?,1,'boy',25,'jo',100,'none','user',1)`, [uname, bcrypt.hashSync(oldPw, 10), email]);
  const uid = (await qget(`SELECT id FROM users WHERE username=?`, uname)).id;

  const post = async (path, body, token) => {
    const h = { 'content-type': 'application/json', 'x-chat-client': '1' };
    if (token) h['x-chat-token'] = token;
    const r = await fetch(BASE + path, { method: 'POST', headers: h, body: JSON.stringify(body) });
    return { status: r.status, d: await r.json().catch(() => ({})) };
  };
  const login = async (u, p) => {
    const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-chat-client': '1' }, body: JSON.stringify({ username: u, password: p }) });
    return { status: r.status, d: await r.json().catch(() => ({})) };
  };
  const latestCode = () => qget(`SELECT code FROM password_resets WHERE user_id=? ORDER BY id DESC LIMIT 1`, uid);

  console.log('— 1) بريد غير مسجل → مرفوض');
  let r = await post('/api/forgot-password', { email: 'nouser' + T + '@gmail.com' });
  ok('404 بريد غير مسجل', r.status === 404, 'status=' + r.status);

  console.log('— 2) إرسال رمز الاستعادة');
  r = await post('/api/forgot-password', { email });
  ok('إرسال الرمز (ok)', r.status === 200 && r.d.ok === true, 'status=' + r.status + ' ' + JSON.stringify(r.d));
  const v = await latestCode();
  ok('الرمز حُفظ (6 أرقام)', v && /^\d{6}$/.test(String(v.code)), JSON.stringify(v || {}));
  const code = String(v.code);

  console.log('— 3) إعادة الإرسال قبل انتهاء الانتظار → محجوز');
  r = await post('/api/forgot-password', { email });
  ok('429 انتظار بين الإرسالات', r.status === 429, 'status=' + r.status + ' ' + JSON.stringify(r.d));

  console.log('— 4) رمز خاطئ → مرفوض');
  r = await post('/api/reset-password', { email, code: '000000', newPassword: newPw });
  ok('400 رمز خاطئ', r.status === 400 && /غير صحيح/.test(r.d.error || ''), 'status=' + r.status + ' ' + JSON.stringify(r.d));

  console.log('— 5) الرمز الصحيح + كلمة مرور جديدة → تم');
  r = await post('/api/reset-password', { email, code, newPassword: newPw });
  ok('تم التغيير', r.status === 200 && r.d.ok === true, 'status=' + r.status + ' ' + JSON.stringify(r.d));

  console.log('— 6) التحقق: القديمة لا تعمل والجديدة تعمل');
  r = await login(uname, oldPw);
  ok('الكلمة القديمة مرفوضة', r.status === 400, 'status=' + r.status);
  r = await login(uname, newPw);
  ok('الكلمة الجديدة تعمل', r.status === 200 && !!r.d.tab_token, 'status=' + r.status);

  console.log('— 7) إعادة استخدام الرمز المستنفد → مرفوض');
  r = await post('/api/reset-password', { email, code, newPassword: 'another1' });
  ok('400 الرمز مستنفد', r.status === 400, 'status=' + r.status + ' ' + JSON.stringify(r.d));

  console.log('— 8) كلمة مرور قصيرة → مرفوضة');
  await post('/api/forgot-password', { email }); // رمز جديد بعد الانتظار؟ لا — ما زال في الانتظار؛ نعدل صلاحية الانتظار يدوياً
  await qrun(`UPDATE password_resets SET created_at=created_at-120, used_at=0 WHERE user_id=?`, [uid]);
  const r2 = await post('/api/forgot-password', { email });
  ok('رمز جديد بعد انتهاء الانتظار', r2.status === 200, 'status=' + r2.status + ' ' + JSON.stringify(r2.d));
  const v2 = await latestCode();
  r = await post('/api/reset-password', { email, code: v2 ? v2.code : '111111', newPassword: '12' });
  ok('400 كلمة مرور قصيرة', r.status === 400 && /4 خانات/.test(r.d.error || ''), 'status=' + r.status);

  // تنظيف
  await qrun(`DELETE FROM password_resets WHERE user_id=?`, [uid]);
  await qrun(`DELETE FROM users WHERE username=?`, [uname]);
  DB.close();
  console.log(`\nالنتيجة: ${pass} نجح / ${fail} فشل`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
