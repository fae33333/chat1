// اختبار /api/chat/ping — نبضة الاحتفاظ بالجلسة + حالة السوكيت
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const io = require('socket.io-client');
const sqlite3 = require('/home/user/chat1/node_modules/sqlite3');
const bcrypt = require('/home/user/chat1/node_modules/bcryptjs');
const d = () => ((x => x + String(x * 257))((Math.floor(Math.random() * 9000000000) + 1000000000)));
const BASE = 'https://localhost:2083';
const DB = new sqlite3.Database('/home/user/chat1/chat.db');
const qrun = (s, p = []) => new Promise((r, j) => DB.run(s, p, e => e ? j(e) : r()));
let passed = 0, failed = 0;
const ok = (n, c, x = '') => { c ? (passed++, console.log('  ✔ ' + n)) : (failed++, console.log('  ✘ ' + n + ' ' + x)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const T = 'ping' + Date.now() % 100000;
  const uname = T;
  const pw = 'ping1234';
  const hash = bcrypt.hashSync(pw, 10);
  await qrun(`DELETE FROM users WHERE username=?`, [uname]);
  await qrun(`INSERT INTO users (username,password,email,email_verified,gender,age,country,balance,membership,rank,registered)
    VALUES (?,?,?,1,'boy',25,'jo',100,'none','user',1)`, [uname, hash, '']);

  // دخول
  const lr = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-chat-client': '1' }, body: JSON.stringify({ username: uname, password: pw }) });
  const lg = await lr.json();
  ok('تسجيل الدخول', lr.status === 200 && !!lg.tab_token, JSON.stringify(lg).slice(0, 120));
  const tok = lg.tab_token;

  console.log('— ping بدون سوكيت متصل');
  let r = await fetch(BASE + '/api/chat/ping', { headers: { 'x-chat-client': '1', 'x-chat-token': tok } });
  let d2 = await r.json().catch(() => ({}));
  ok('GET ping → ok:true', r.status === 200 && d2.ok === true, JSON.stringify(d2));
  ok('حالة السوكيت: غير متصل', d2.socket === false, JSON.stringify(d2));

  console.log('— ping مع سوكيت متصل');
  const sock = await new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { client: 'chat', token: tok }, query: { key: d() }, transports: ['websocket'], rejectUnauthorized: false });
    s.on('connect', () => setTimeout(() => resolve(s), 300));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('timeout')), 8000);
  });
  r = await fetch(BASE + '/api/chat/ping', { method: 'POST', headers: { 'x-chat-client': '1', 'x-chat-token': tok } });
  d2 = await r.json().catch(() => ({}));
  ok('POST ping → ok:true', r.status === 200 && d2.ok === true, JSON.stringify(d2));
  ok('حالة السوكيت: متصل', d2.socket === true, JSON.stringify(d2));

  console.log('— بعد قطع السوكيت تعود الحالة');
  sock.disconnect();
  await sleep(400);
  r = await fetch(BASE + '/api/chat/ping', { headers: { 'x-chat-client': '1', 'x-chat-token': tok } });
  d2 = await r.json().catch(() => ({}));
  ok('حالة السوكيت: غير متصل بعد القطع', d2.socket === false, JSON.stringify(d2));

  console.log('— بدون توكن → 401');
  r = await fetch(BASE + '/api/chat/ping', { headers: { 'x-chat-client': '1' } });
  ok('401 بدون توكن', r.status === 401, 'status=' + r.status);

  await qrun(`DELETE FROM users WHERE username=?`, [uname]);
  DB.close();
  console.log(`\nالنتيجة: ${passed} نجح / ${failed} فشل`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
