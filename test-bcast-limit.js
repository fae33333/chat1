// اختبار: حد المذيعين المتزامنين (الميكروفونات) من لوحة الإدارة
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

async function login(u, p) {
  const res = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-chat-client': '1' }, body: JSON.stringify({ username: u, password: p }) });
  const data = await res.json();
  if (!data.tab_token) throw new Error('login failed: ' + JSON.stringify(data));
  return data;
}
function connect(token) {
  return new Promise((resolve, reject) => {
    const sock = io(BASE, { auth: { client: 'chat', token }, query: { key: d() }, transports: ['websocket'], rejectUnauthorized: false });
    sock.on('connect', () => setTimeout(() => resolve(sock), 200));
    sock.on('connect_error', reject);
    setTimeout(() => reject(new Error('timeout')), 8000);
  });
}
const emit = (s, ev, ...a) => new Promise(r => s.emit(ev, ...a, r));

(async () => {
  const T = Date.now() % 100000;
  const names = ['lim_a' + T, 'lim_b' + T, 'lim_c' + T, 'lim_d' + T];
  const pw = 'lim12345';
  const hash = bcrypt.hashSync(pw, 10);
  await qrun(`DELETE FROM users WHERE username IN (${names.map(() => '?').join(',')})`, names);
  for (const n of names) {
    await qrun(`INSERT INTO users (username,password,gender,age,country,bio,registered,balance,rank,membership,email,email_verified) VALUES (?,?,'boy',25,'','',1,0,'user','vip','',1)`, [n, hash]);
  }

  // ضبط الحد = 2 من لوحة الإدارة (دخول السوبر إدمين)
  const admin = await login('ax', '123456');
  if (!admin.admin_access_token) throw new Error('no admin token');
  let res = await fetch(BASE + '/api/admin/settings', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': admin.admin_access_token }, body: JSON.stringify({ max_live_speakers: '2' }) });
  ok('ضبط الحد = 2 عبر الإدارة', res.status === 200);
  const ROOM = 8;

  const socks = [];
  for (const n of names) {
    const lg = await login(n, pw);
    const s = await connect(lg.tab_token);
    socks.push(s);
  }
  for (const s of socks) { await emit(s, 'join', ROOM, ''); }
  await sleep(300);

  console.log('— المذيع 1 يصعد (بث جديد)');
  const ack1 = await emit(socks[0], 'bcast:start', ROOM);
  ok('المذيع 1 صعد', ack1 && ack1.ok, JSON.stringify(ack1));

  console.log('— المذيع 2 يصعد (يملأ الميكروفونات)');
  const ack2 = await emit(socks[1], 'bcast:start', ROOM);
  ok('المذيع 2 صعد', ack2 && ack2.ok, JSON.stringify(ack2));
  await sleep(200);

  console.log('— المذيع 3 يحاول الصعود → مرفوض (الميكروفونات ممتلئة)');
  const ack3 = await emit(socks[2], 'bcast:start', ROOM);
  ok('الطلب رُفض', ack3 && ack3.ok === false, JSON.stringify(ack3));
  ok('رسالة الميكروفونات الممتلئة', /ممتلئة/.test((ack3 && ack3.text) || ''), JSON.stringify(ack3));

  console.log('— المذيع 4 يحاول الصعود → مرفوض أيضاً');
  const ack4 = await emit(socks[3], 'bcast:start', ROOM);
  ok('الطلب رُفض', ack4 && ack4.ok === false && /ممتلئة/.test((ack4 && ack4.text) || ''), JSON.stringify(ack4));

  console.log('— بعد توقف البث، المكان يُفرَّغ للشخص التالي');
  const stopAck = await emit(socks[0], 'bcast:stop', ROOM);
  await sleep(300);
  const ack5 = await emit(socks[2], 'bcast:start', ROOM);
  ok('بعد الفراغ: المذيع 3 صعد', ack5 && ack5.ok, JSON.stringify(ack5));

  // استعادة الحد الافتراضي 4 وإنهاء البث
  res = await fetch(BASE + '/api/admin/settings', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': admin.admin_access_token }, body: JSON.stringify({ max_live_speakers: '4' }) });
  ok('استعادة الحد 4', res.status === 200);
  await emit(socks[2], 'bcast:stop', ROOM);
  for (const s of socks) { try { s.disconnect(); } catch (e) {} }

  await qrun(`DELETE FROM users WHERE username IN (${names.map(() => '?').join(',')})`, names);
  DB.close();

  console.log(`\nالنتيجة: ${passed} نجح / ${failed} فشل`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
