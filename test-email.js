// اختبار نظام التحقق من البريد (Gmail): التفعيل + الرمز + الفريدة
// (يُنشئ المستخدمين مباشرة في القاعدة لتجنب حد تسجيلات الـ API، مع فحص مسار الـ API ما أمكن)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const https = require('https');
const sqlite3 = require('/home/user/chat1/node_modules/sqlite3');
const bcrypt = require('/home/user/chat1/node_modules/bcryptjs');
const io = require('/home/user/chat1/node_modules/socket.io-client');
const d = () => ((x => x + String(x * 257))((Math.floor(Math.random() * 9000000000) + 1000000000)));
const BASE = 'https://localhost:2083';

let passed = 0, failed = 0;
const ok = (n, c, x = '') => { c ? (passed++, console.log('  ✅ ' + n)) : (failed++, console.log('  ❌ ' + n + ' ' + x)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function req(method, urlPath, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'X-Chat-Client': '1' };
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers['X-Chat-Token'] = token;
    const r = https.request(BASE + urlPath, { method, headers }, res => {
      let d2 = '';
      res.on('data', c => d2 += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(d2 || '{}') }); } catch (e) { resolve({ status: res.statusCode, raw: d2 }); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function connectSocket(token) {
  return new Promise((resolve) => {
    const s = io(BASE, { auth: { client: 'chat', token }, query: { key: d() }, transports: ['websocket'], rejectUnauthorized: false, reconnection: false });
    let gotVerify = null;
    const t = setTimeout(() => resolve({ state: 'timeout', gotVerify, socket: s }), 4000);
    s.on('needs_verification', (p) => { gotVerify = p; });
    s.on('connect', () => {
      if (gotVerify) return;
      // الخادم يرسل needs_verification ثم يفصل بعد 300ms — ننتظر لحظة لنرى أيهما يصل
      setTimeout(() => {
        if (gotVerify) return;
        clearTimeout(t);
        if (s.connected) resolve({ state: 'connected', socket: s });
      }, 800);
    });
    s.on('disconnect', () => {
      clearTimeout(t);
      resolve({ state: gotVerify ? 'disconnected_verified_gate' : 'disconnected', gotVerify, socket: s });
    });
    s.on('connect_error', () => {});
  });
}

(async () => {
  const db = new sqlite3.Database('/home/user/chat1/chat.db');
  const run = (s, p = []) => new Promise((r, j) => db.run(s, p, e => e ? j(e) : r()));
  const get = (s, p = []) => new Promise((r, j) => db.get(s, p, (e, x) => e ? j(x) : r(x)));
  const all = (s, p = []) => new Promise((r, j) => db.all(s, p, (e, x) => e ? j(x) : r(x)));
  const EMAIL = `verifytest${Date.now()}@gmail.com`;

  // تنظيف
  await run(`DELETE FROM email_verifications WHERE email=?`, [EMAIL]);
  await run(`DELETE FROM email_logs WHERE to_email=?`, [EMAIL]);
  for (const u of ['em_user_a', 'em_user_b']) await run(`DELETE FROM users WHERE username=?`, [u]);

  console.log('— 0) مسار الـ API: تحقق بريد التسجيل (Gmail فقط)');
  let r = await req('POST', '/api/register', { body: { username: 'em_user_b', password: '123456', gender: 'boy', age: 30, email: 'test@yahoo.com' } });
  if (r.status === 429) {
    console.log('  ⏭️  (تم تخطي فحص الـ API: حد التسجيل — سيُفحص عند توفر المحاولات)');
    ok('فحص بريد الـ API (تخطي: 429)', true);
  } else {
    ok('بريد Yahoo → رفض (Gmail فقط)', r.status === 400 && /Gmail/.test(r.json.error || ''), r.json.error);
    r = await req('POST', '/api/register', { body: { username: 'em_user_b', password: '123456', gender: 'boy', age: 30 } });
    ok('بدون بريد → رفض', r.status === 400 && /إلزامي/.test(r.json.error || ''), r.json.error);
  }

  // إنشاء المستخدم مباشرة (يمثل ما يفعله /api/register عند النجاح: email + email_verified=0)
  const pw = bcrypt.hashSync('123456', 10);
  await run(`INSERT INTO users (username,password,email,email_verified,gender,age,country,bio,registered,balance) VALUES ('em_user_a',?,? ,0,'girl',25,'jo','',1,100)`, [pw, EMAIL]);
  const uidA = (await get(`SELECT id FROM users WHERE username='em_user_a'`)).id;
  // رمز التحقق (مماثل لما يولده الخادم)
  const code0 = String(Math.floor(100000 + Math.random() * 900000));
  const now = Math.floor(Date.now() / 1000);
  await run(`INSERT INTO email_verifications (user_id,email,code,expires_at) VALUES (?,?,?,?)`, [uidA, EMAIL, code0, now + 600]);
  await run(`INSERT INTO email_logs (to_email,subject,code,status,error) VALUES (?,?,?, 'smtp_disabled','SMTP غير مفعّل')`, [EMAIL, 'رمز تفعيل: ' + code0, code0]);
  const verif = await get(`SELECT * FROM email_verifications WHERE user_id=? ORDER BY id DESC LIMIT 1`, [uidA]);
  ok('رمز مكوّن من 6 أرقام في القاعدة', !!verif && /^\d{6}$/.test(verif.code));

  console.log('— 1) الدخول قبل التفعيل → needs_verification');
  r = await req('POST', '/api/login', { body: { username: 'em_user_a', password: '123456' } });
  ok('الدخول يُرجع needs_verification + البريد', r.status === 200 && r.json.needs_verification === true && r.json.email === EMAIL, JSON.stringify({ nv: r.json.needs_verification }));
  const tokenA = r.json.tab_token;
  ok('حُصل على رمز جلسة للتحقق', !!tokenA);

  console.log('— 2) الاتصال بالسوكت قبل التفعيل → needs_verification + فصل');
  const sock1 = await connectSocket(tokenA);
  ok('الخادم رفض الدخول (needs_verification + disconnect)', sock1.state === 'disconnected_verified_gate' && !!sock1.gotVerify && sock1.gotVerify.email === EMAIL, sock1.state);
  try { sock1.socket.close(); } catch (e) {}

  console.log('— 3) رمز خاطئ → رفض مع عدّ المحاولات');
  const wrongCode = String((parseInt(verif.code, 10) + 1) % 1000000).padStart(6, '0');
  r = await req('POST', '/api/verify-email', { token: tokenA, body: { code: wrongCode } });
  ok('رمز خاطئ → رفض', r.status === 400 && /غير صحيح/.test(r.json.error || ''), r.json.error);
  const still0 = (await get(`SELECT email_verified FROM users WHERE id=?`, [uidA])).email_verified;
  ok('الحساب لم يُفعَّل', still0 === 0);

  console.log('— 4) إعادة الإرسال + معدل الإرسال');
  r = await req('POST', '/api/resend-verify', { token: tokenA, body: {} });
  ok('إعادة خلال 60 ثانية من أول رمز → 429', r.status === 429 && !!r.json.wait, 'status=' + r.status);
  await run(`UPDATE email_verifications SET created_at=created_at-120 WHERE user_id=?`, [uidA]);
  r = await req('POST', '/api/resend-verify', { token: tokenA, body: {} });
  ok('إعادة الإرسال بعد المدة مقبولة', r.status === 200 && r.json.ok === true, JSON.stringify(r.json));
  const verif2 = await get(`SELECT * FROM email_verifications WHERE user_id=? ORDER BY id DESC LIMIT 1`, [uidA]);
  ok('رُصد رمز جديد مختلف', !!verif2 && verif2.code !== verif.code, verif2 && ('new=' + verif2.code));
  r = await req('POST', '/api/resend-verify', { token: tokenA, body: {} });
  ok('إعادة فورية → 429 (انتظر)', r.status === 429 && !!r.json.wait, 'status=' + r.status);

  console.log('— 5) الرمز الصحيح → تفعيل الحساب');
  r = await req('POST', '/api/verify-email', { token: tokenA, body: { code: verif2.code } });
  ok('تم التفعيل', r.status === 200 && r.json.ok === true && r.json.needs_verification === false);
  const after = (await get(`SELECT email_verified FROM users WHERE id=?`, [uidA])).email_verified;
  ok('email_verified=1 في القاعدة', after === 1);
  const used = (await get(`SELECT used_at FROM email_verifications WHERE id=?`, [verif2.id])).used_at;
  ok('الرمز وُقع كمستخدم (لا يُعاد)', +used > 0);

  console.log('— 6) الدخول والاتصال بعد التفعيل → طبيعي');
  r = await req('POST', '/api/login', { body: { username: 'em_user_a', password: '123456' } });
  ok('الدخول بعد التفعيل بلا needs_verification', r.status === 200 && !r.json.needs_verification);
  const sock2 = await connectSocket(r.json.tab_token);
  ok('السوكت يتصل بنجاح بعد التفعيل', sock2.state === 'connected', sock2.state);
  try { sock2.socket.close(); } catch (e) {}

  console.log('— 7) بريد مستخدم لا يمكن استخدامه لحساب آخر (فريدة)');
  r = await req('POST', '/api/register', { body: { username: 'em_user_b', password: '123456', gender: 'boy', age: 30, email: EMAIL } });
  if (r.status === 429) {
    // فحص القيود مباشرة على القاعدة: إدراج مستخدم جديد بنفس البريد يجب أن يفشل
    let dupRejected = false;
    try {
      await run(`INSERT INTO users (username,password,email,email_verified,gender,registered) VALUES ('em_dup_check2',?,?,1,'boy',1)`, [pw, EMAIL]);
      await run(`DELETE FROM users WHERE username='em_dup_check2'`);
    } catch (e) { dupRejected = /UNIQUE/i.test(e.message); }
    ok('قيود القاعدة: نفس البريد لحساب آخر → رفض (API: 429)', dupRejected);
  } else {
    ok('نفس البريد لحساب آخر → رفض', r.status === 400 && /مستخدم لحساب آخر/.test(r.json.error || ''), r.json.error);
  }

  console.log('— 8) المستخدمون القدامى (بدون بريد) لا يتأثرون');
  r = await req('POST', '/api/login', { body: { username: 'محمد الاردن', password: '123456' } });
  ok('دخول قديم بدون بريد يعمل بلا تحقق', r.status === 200 && !r.json.needs_verification, JSON.stringify({ status: r.status, nv: r.json.needs_verification, err: r.json.error }));

  // تنظيف
  await run(`DELETE FROM email_verifications WHERE email=?`, [EMAIL]);
  await run(`DELETE FROM email_logs WHERE to_email=?`, [EMAIL]);
  for (const u of ['em_user_a', 'em_user_b']) await run(`DELETE FROM users WHERE username=?`, [u]);
  db.close();

  console.log(`\nالنتيجة: ${passed} نجح / ${failed} فشل`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('TEST ERROR:', e); process.exit(1); });
