/* اختبار تراجعي: البث الصوتي في الغرف (الغرف كلها صوتية الآن) */
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
    // مهلة قصيرة بعد الاتصال قبل إرسال أوامر الغرف (المستخدم الحقيقي لا يضغط الغرفة إلا بعد اكتمال الواجهة)
    sock.on('connect', () => setTimeout(() => resolve(sock), 200));
    sock.on('connect_error', reject);
    setTimeout(() => reject(new Error('timeout')), 8000);
  });
}
const emit = (s, ev, ...a) => new Promise(r => s.emit(ev, ...a, r));
const once = (s, ev, t = 5000) => new Promise(r => { const x = setTimeout(() => r({ __timeout: true }), t); s.once(ev, d2 => { clearTimeout(x); r(d2 || {}); }); });

(async () => {
  const hash = bcrypt.hashSync('bc123456', 10);
  await qrun(`DELETE FROM users WHERE username IN ('bc_a','bc_b','bc_c')`);
  await qrun(`INSERT INTO users (username,password,gender,age,country,bio,registered,balance,rank,membership) VALUES ('bc_a',?,'boy',25,'','',1,0,'user','vip'), ('bc_b',?,'girl',25,'','',1,0,'user','vip')`, [hash, hash]);
  const [a, b] = await Promise.all([login('bc_a', 'bc123456'), login('bc_b', 'bc123456')]);
  const A = await connect(a.tab_token), B = await connect(b.tab_token);
  const ROOM = 8; // غرفة صوتية
  const jA = await emit(A, 'join', ROOM, '', {});
  const jB = await emit(B, 'join', ROOM, '');
  await sleep(300);
  ok('الانضمام للغرفة الصوتية', jA && jA.ok && jB && jB.ok, JSON.stringify(jA));

  console.log('— A يبدأ بثاً صوتياً');
  const pStart = once(B, 'bcast:started');
  const ackA = await emit(A, 'bcast:start', ROOM);
  const started = await pStart;
  ok('المستمع يستلم bcast:started', !!started && !!started.hosts, JSON.stringify(started).slice(0, 120));

  console.log('— B يستمع ثم ينضم C كمستمع جديد');
  const hashC = hash;
  await qrun(`INSERT INTO users (username,password,gender,age,country,bio,registered,balance,rank,membership) VALUES ('bc_c',?,'boy',25,'','',1,0,'user','vip')`, [hashC]);
  const c = await login('bc_c', 'bc123456');
  const C = await connect(c.tab_token);
  const newListener = once(A, 'bcast:new_listener');
  await emit(C, 'join', ROOM, '');
  await sleep(300);
  const nl = await newListener;
  ok('المذيع يستلم bcast:new_listener', !!nl && !nl.__timeout, JSON.stringify(nl));

  console.log('— B يطلب التحدث (speak_request)');
  const speakReq = once(A, 'bcast:speak_request');
  emit(B, 'bcast:speak_request', ROOM);
  const sr = await speakReq;
  ok('المذيع يستلم طلب التحدث', !!sr && !sr.__timeout, JSON.stringify(sr));

  console.log('— A ينهي البث');
  const pStop = once(B, 'bcast:stopped');
  await emit(A, 'bcast:stop', ROOM);
  const stopped = await pStop;
  ok('المستمع يستلم bcast:stopped', !!stopped && !stopped.__timeout, JSON.stringify(stopped));

  A.close(); B.close(); C.close();
  await qrun(`DELETE FROM users WHERE username IN ('bc_a','bc_b','bc_c')`);
  DB.close();
  console.log(`\nالنتيجة: ${passed} نجح / ${failed} فشل`);
  if (failed) process.exit(1);
})().catch(e => { console.error('TEST ERROR:', e.message); process.exit(1); });
