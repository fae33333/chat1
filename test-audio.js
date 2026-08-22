/* اختبار تراجعي: البث الصوتي في الغرف الصوتية (mesh تلقائي كما كان) */
const io = require('socket.io-client');
const d = () => ((x => x + String(x * 257))((Math.floor(Math.random() * 9000000000) + 1000000000)));
const BASE = process.env.BASE || 'https://localhost:2083';
const ROOM_ID = 8; // غرفة صوتية

let passed = 0, failed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  ✘ ${name} ${extra}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function login(u, p) {
  const res = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-chat-client': '1' },
    body: JSON.stringify({ username: u, password: p })
  });
  const d = await res.json();
  if (!d.tab_token) throw new Error('login failed: ' + JSON.stringify(d));
  return d;
}
function connect(token) {
  return new Promise((resolve, reject) => {
    const sock = io(BASE, { auth: { client: 'chat', token }, query: { key: d() }, transports: ['websocket'], rejectUnauthorized: false });
    sock.on('connect', () => resolve(sock));
    sock.on('connect_error', reject);
    setTimeout(() => reject(new Error('timeout')), 8000);
  });
}
function emit(sock, ev, ...args) { return new Promise(r => sock.emit(ev, ...args, r)); }
function once(sock, ev, timeout = 5000) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve({ __timeout: true }), timeout);
    sock.once(ev, d => { clearTimeout(t); resolve(d || {}); });
  });
}

(async () => {
  const [ax, admin, moh] = await Promise.all([login('ax', '123456'), login('admin', 'admin123'), login('محمد الاردن', '123456')]);
  const A = await connect(ax.tab_token), B = await connect(admin.tab_token), C = await connect(moh.tab_token);
  await emit(A, 'join', ROOM_ID, '', {});
  await emit(B, 'join', ROOM_ID, '', {});
  await sleep(300);

  console.log('[1] A يبدأ بثاً صوتياً');
  const pStart = once(B, 'bcast:started');
  const ackA = await emit(A, 'bcast:start', ROOM_ID);
  ok('بدأ البث الصوتي', ackA.ok && ackA.mode === 'audio' && ackA.isNewBroadcast, JSON.stringify(ackA));
  ok('B مسجل كمستمع تلقائياً', Array.isArray(ackA.viewers));
  const evS = await pStart;
  ok('وصل bcast:started', evS.mode === 'audio');
  const uidA = evS.host.id;

  console.log('[2] إشارات A→B مسموحة تلقائياً (استماع حر)');
  A.emit('bcast:signal', ROOM_ID, 999999, { type: 'offer', sdp: 'a' }); // معرف غير موجود عمداً
  const gotWrong = await once(B, 'bcast:signal', 900);
  ok('إشارة لغير مستمع تُحجب', gotWrong.__timeout === true);

  console.log('[3] C يدخل الغرفة أثناء البث — يُسجل مستمعاً تلقائياً');
  const pNewListener = once(A, 'bcast:new_listener');
  const jC = await emit(C, 'join', ROOM_ID, '', {});
  ok('دخل C واستلم حالة البث', jC.ok && jC.broadcast && jC.broadcast.mode === 'audio');
  const nl = await pNewListener;
  ok('وصل bcast:new_listener إلى A', nl.__timeout !== true);
  const uidC = nl.listenerId;

  console.log('[4] طلب تحدث C — A يقبل');
  const pSpeak = once(A, 'bcast:speak_request');
  const ackSp = await emit(C, 'bcast:speak_request', ROOM_ID);
  ok('أُرسل طلب التحدث', ackSp.ok);
  const sp = await pSpeak;
  ok('وصل طلب التحدث إلى المضيف الأساسي', sp.user && sp.user.id === uidC);
  const pSpRes = once(C, 'bcast:speak_response');
  const pHJ = once(B, 'bcast:host_joined');
  A.emit('bcast:speak_response', ROOM_ID, sp.user.id, true);
  const sr = await pSpRes;
  ok('قُبل التحدث وأصبح C مذيعاً', sr.accept === true && Array.isArray(sr.existingHosts) && sr.existingHosts.length === 1);
  const hj = await pHJ;
  ok('وصل bcast:host_joined بمذيعَين', Array.isArray(hj.hosts) && hj.hosts.length === 2);

  console.log('[5] إشارات mesh بين المذيعَين A↔C');
  const pSigC = once(C, 'bcast:signal');
  const pSigA = once(A, 'bcast:signal');
  A.emit('bcast:signal', ROOM_ID, uidC, { type: 'offer', sdp: 'meshA' });
  C.emit('bcast:signal', ROOM_ID, uidA, { type: 'answer', sdp: 'meshC' });
  const toC = await pSigC, toA = await pSigA;
  ok('A→C وصلت', toC.__timeout !== true && toC.data.sdp === 'meshA');
  ok('C→A وصلت', toA.__timeout !== true && toA.data.sdp === 'meshC');

  console.log('[6] C يتوقف عن البث — يعود مستمعاً ويستمر بث A');
  const pNewL2 = once(A, 'bcast:new_listener');
  const ackStop = await emit(C, 'bcast:stop', ROOM_ID);
  ok('توقف C وأصبح مستمعاً', ackStop.ok && ackStop.becameListener === true);
  const nl2 = await pNewL2;
  ok('وصل bcast:new_listener إلى A بعد نزول C', nl2.__timeout !== true);

  console.log('[7] إنهاء بث A');
  const pStopped = once(B, 'bcast:stopped');
  await emit(A, 'bcast:stop', ROOM_ID);
  ok('انتهى البث للجميع', (await pStopped).__timeout !== true);

  console.log(`\n========= الصوتي: ${passed} ناجح / ${failed} فاشل =========`);
  A.close(); B.close(); C.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('خطأ:', e); process.exit(2); });
