// =====================================================
//  اختبار: حساب supermaster «شبح» — لا يظهر في قوائم العضوية ولا الرصد،
//  بينما يرى هو الجميع. (قوائم الغرف + رسائل الدخول/الخروج + إحصاء المتصلين
//  + صفحة الرصد + كشف النكات)
// =====================================================
process.env.PORT = '2096';
process.env.HTTPS_KEY = '/nonexistent-test-key';
process.env.HTTPS_CERT = '/nonexistent-test-cert';

const path = require('path');
const io = require(path.join(__dirname, 'node_modules/socket.io-client'));
const sqlite3 = require(path.join(__dirname, 'node_modules/sqlite3'));
const bcrypt = require(path.join(__dirname, 'node_modules/bcryptjs'));

const DB = new sqlite3.Database(path.join(__dirname, 'chat.db'));
const qGet = (s, p = []) => new Promise((r, j) => DB.get(s, p, (e, x) => e ? j(e) : r(x)));
const qRun = (s, p = []) => new Promise((r, j) => DB.run(s, p, e => e ? j(e) : r()));
const d = () => ((x => x + String(x * 257))((Math.floor(Math.random() * 9000000000) + 1000000000)));
const BASE = 'http://127.0.0.1:2096';
let passed = 0, failed = 0;
const ok = (n, c, x = '') => { c ? (passed++, console.log('  ✔ ' + n)) : (failed++, console.log('  ✘ ' + n + ' ' + x)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function apiLogin(username, password) {
  const res = await fetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-chat-client': '1' },
    body: JSON.stringify({ username, password })
  });
  return res.json();
}
function connectChat(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { client: 'chat', token }, query: { key: d() }, transports: ['websocket'] });
    s.on('connect', () => setTimeout(() => resolve(s), 250));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('sock timeout')), 8000);
  });
}
const joinRoom = (s, roomId) => new Promise((resolve, reject) => {
  s.emit('join', roomId, res => res && res.ok ? resolve(res) : reject(new Error(JSON.stringify(res))));
  setTimeout(() => reject(new Error('join timeout')), 6000);
});

(async () => {
  const suffix = Date.now() % 100000;
  const peerName = 'ghpeer' + suffix;
  const peerPw = 'gh12345';
  await qRun(`INSERT INTO users (username,password,gender,age,balance,membership,rank,registered,status)
    VALUES (?,?, 'boy', 24, 50, 'none', 'user', 1, 'متصل')`, [peerName, bcrypt.hashSync(peerPw, 10)]);
  const master = await qGet(`SELECT id FROM users WHERE username='supermaster'`);
  if (!master) throw new Error('لا يوجد حساب supermaster');
  const ROOM = (await qGet(`SELECT id FROM rooms WHERE (password IS NULL OR password='') ORDER BY sort,id LIMIT 1`)).id;

  require('./server.js');
  await sleep(1400);

  // --- دخول الأطراف الثلاثة ---
  const peer = await apiLogin(peerName, peerPw);
  const ghost = await apiLogin('supermaster', 'supermaster');
  const ax = await apiLogin('ax', '123456');
  if (!peer.tab_token || !ghost.tab_token || !ax.tab_token) throw new Error('login failed: ' + JSON.stringify([peer, ghost, ax].map(x => !!x.tab_token)));

  const sPeer = await connectChat(peer.tab_token);
  const sGhost = await connectChat(ghost.tab_token);
  const sAx = await connectChat(ax.tab_token);

  const peerState = { users: null, sysMsgs: [] };
  sPeer.on('roomUsers', p => { if (p.roomId === +ROOM) peerState.users = p; });
  sPeer.on('msg', m => { if (m.room_id === +ROOM && (m.type === 'join' || m.type === 'leave')) peerState.sysMsgs.push(m.text || ''); });
  const ghostState = { users: null };
  sGhost.on('roomUsers', p => { if (p.roomId === +ROOM) ghostState.users = p; });

  await joinRoom(sPeer, ROOM);
  await sleep(400);
  await joinRoom(sGhost, ROOM);   // المالك يدخل — يجب أن يكون شبحاً
  await sleep(700);

  console.log('— داخل الغرفة (من منظور عضو عادي)');
  const peerSeesGhost = !!(peerState.users && peerState.users.users.some(u => +u.id === +master.id));
  ok('قائمة أعضاء الغرفة لا تحتوي supermaster', !peerSeesGhost, JSON.stringify((peerState.users || {}).users || []));
  ok('لا رسالة ترحيب/دخول عن supermaster', !peerState.sysMsgs.some(t => /supermaster/i.test(t)), peerState.sysMsgs.join(' | '));
  const peerCount = (peerState.users || {}).count || 0;
  ok('عدّاد الأعضاء لا يحسبه', peerCount >= 1 && peerCount <= 3, 'count=' + peerCount);

  console.log('— منظور الشبح نفسه (يرى الجميع)');
  const ghostSeesPeer = !!(ghostState.users && ghostState.users.users.some(u => u.username === peerName));
  ok('supermaster يرى العضو العادي في القائمة', ghostSeesPeer, JSON.stringify((ghostState.users || {}).users || []).slice(0, 200));

  console.log('— HTTP: قائمة أعضاء الغرفة');
  const listRes = await fetch(BASE + '/api/rooms/' + ROOM + '/users', { headers: { 'x-chat-client': '1', 'x-chat-token': peer.tab_token } });
  const list = await listRes.json();
  ok('/api/rooms/:id/users لا يعيد supermaster', Array.isArray(list) && !list.some(u => +u.id === +master.id), JSON.stringify(list).slice(0, 160));

  console.log('— الرصد والإحصاءات (من حساب إداري آخر: ax)');
  const monRes = await fetch(BASE + '/api/admin/monitor?token=' + encodeURIComponent(ax.admin_access_token), { headers: { 'x-admin-token': ax.admin_access_token } });
  const mon = await monRes.json();
  ok('/api/admin/monitor → 200', monRes.status === 200 && Array.isArray(mon), String(monRes.status));
  const monHasGhost = Array.isArray(mon) && mon.some(g => (g.users || []).some(u => +u.id === +master.id));
  ok('الرصد لا يُظهر أن supermaster دخل الدردشة', !monHasGhost, JSON.stringify(mon).slice(0, 240));
  const monHasPeer = Array.isArray(mon) && mon.some(g => (g.users || []).some(u => u.username === peerName));
  ok('الرصد ما زال يرى الأعضاء الآخرين', monHasPeer);

  const stRes = await fetch(BASE + '/api/admin/stats?token=' + encodeURIComponent(ax.admin_access_token), { headers: { 'x-admin-token': ax.admin_access_token } });
  const st = await stRes.json();
  // ثلاثة سوكيتات متصلة (peer + ghost + ax) — العداد يجب أن يحسب اثنين فقط
  ok('عداد «المتصلون» يستثني الشبح', st.online === 2, 'online=' + st.online);

  console.log('— مغادرة صامتة');
  peerState.sysMsgs = [];
  sGhost.emit('leave', +ROOM);
  await sleep(500);
  ok('خروج الشبح بلا إعلان «خرج من الغرفة»', !peerState.sysMsgs.some(t => /supermaster/i.test(t)), peerState.sysMsgs.join(' | '));

  // --- تنظيف ---
  sPeer.close(); sGhost.close(); sAx.close();
  await qRun(`DELETE FROM users WHERE username=?`, [peerName]);
  await qRun(`DELETE FROM private_messages WHERE from_id NOT IN (SELECT id FROM users)`);
  DB.close();
  console.log(`\nالنتيجة: ${passed} نجح / ${failed} فشل`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('فشل الاختبار:', e); process.exit(2); });
