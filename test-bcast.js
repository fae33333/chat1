/* اختبار آلي شامل لاستقلالية البثوث (فيديو) عبر Socket.IO */
const io = require('socket.io-client');

const BASE = process.env.BASE || 'https://localhost:2083';
const ROOM_ID = 1; // غرفة افتراضية (فيديو)

let passed = 0, failed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  ✘ ${name} ${extra}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function login(username, password) {
  const res = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-chat-client': '1' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!data.tab_token) throw new Error('no tab_token for ' + username + ': ' + JSON.stringify(data));
  return data;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const sock = io(BASE, { auth: { client: 'chat', token }, transports: ['websocket'], rejectUnauthorized: false });
    sock.on('connect', () => resolve(sock));
    sock.on('connect_error', reject);
    setTimeout(() => reject(new Error('timeout')), 8000);
  });
}

function emit(sock, ev, ...args) {
  return new Promise((resolve) => { sock.emit(ev, ...args, resolve); });
}

function once(sock, ev, timeout = 5000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ __timeout: true }), timeout);
    sock.once(ev, (data) => { clearTimeout(t); resolve(data || {}); });
  });
}

function expectNone(sock, ev, ms = 1200) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(true), ms);
    sock.once(ev, () => { clearTimeout(t); resolve(false); });
  });
}

(async () => {
  console.log('— تسجيل الدخول…');
  const [ax, admin, moh] = await Promise.all([
    login('ax', '123456'), login('admin', 'admin123'), login('محمد الاردن', '123456')
  ]);
  const A = await connect(ax.tab_token);    // المذيع الأول
  const B = await connect(admin.tab_token); // المذيع الثاني
  const C = await connect(moh.tab_token);   // مشاهد
  console.log('— الاتصال والانضمام للغرفة…');
  const j1 = await emit(A, 'join', ROOM_ID, '', {});
  const j2 = await emit(B, 'join', ROOM_ID, '', {});
  const j3 = await emit(C, 'join', ROOM_ID, '', {});
  ok('انضمام الأطراف الثلاثة', j1.ok && j2.ok && j3.ok);
  await sleep(400);

  console.log('\n[1] بدء بث فيديو مستقل — المذيع A');
  const pStart = once(B, 'bcast:started');
  const ackA = await emit(A, 'bcast:start', ROOM_ID);
  ok('بدأ بث A', ackA.ok && ackA.mode === 'video' && ackA.isNewBroadcast, JSON.stringify(ackA));
  const evStart = await pStart;
  ok('وصل bcast:started للآخرين', evStart.host && evStart.host.username === 'ax');
  const uidA = evStart.host.id;

  console.log('\n[2] مذيع ثانٍ B — لا دمج تلقائي بين المذيعين');
  const pHostJoined = once(C, 'bcast:host_joined');
  const ackB = await emit(B, 'bcast:start', ROOM_ID);
  ok('بدأ بث B', ackB.ok && ackB.mode === 'video');
  ok('لا يوجد existingHosts للدمج مع A', Array.isArray(ackB.existingHosts) && ackB.existingHosts.length === 0, JSON.stringify(ackB.existingHosts || null));
  ok('لا يوجد viewers يربطون B بمشاهدي A', Array.isArray(ackB.viewers) && ackB.viewers.length === 0);
  const evHJ = await pHostJoined;
  ok('وصل bcast:host_joined للمذيعين (A,B)', Array.isArray(evHJ.hosts) && evHJ.hosts.length === 2);
  const uidB = evHJ.host.id;

  console.log('\n[3] مشاهد C يطلب مشاهدة A — A يوافق');
  const badTarget = await emit(C, 'bcast:watch_request', ROOM_ID, 999999);
  ok('هدف غير صحيح يُرفض', badTarget.ok === false);
  const pReqA = once(A, 'bcast:watch_request');
  const ackC2 = await emit(C, 'bcast:watch_request', ROOM_ID, uidA);
  ok('أُرسل طلب المشاهدة إلى A', ackC2.ok, JSON.stringify(ackC2));
  const reqA = await pReqA;
  ok('وصل الطلب إلى A وحده', reqA.user && reqA.user.username === 'محمد الاردن');
  const uidC = reqA.user.id;
  const pAccC = once(C, 'bcast:watch_response');
  A.emit('bcast:watch_response', ROOM_ID, uidC, true);
  const accC = await pAccC;
  ok('قُبل الطلب ووصلت الموافقة إلى C', accC.accept === true && accC.hosts && accC.hosts.length === 1 && accC.hosts[0].id === uidA);

  console.log('\n[4] C تطلب مشاهدة B أيضاً — البثّان يعملان معاً بعد الموافقة');
  const noLeftYet = await expectNone(A, 'bcast:viewer_left', 1000);
  const pReqB = once(B, 'bcast:watch_request');
  const ackC3 = await emit(C, 'bcast:watch_request', ROOM_ID, uidB);
  ok('أُرسل طلب المشاهدة إلى B', ackC3.ok, JSON.stringify(ackC3));
  const stillWatchingA = await noLeftYet;
  ok('لم تُغلق مشاهدة A أثناء انتظار موافقة B', stillWatchingA === true);
  const reqB = await pReqB;
  ok('وصل طلب C إلى B تحديداً', reqB.user && reqB.user.id === uidC);
  const noLeftAfterAccept = expectNone(A, 'bcast:viewer_left', 1200);
  const pAccC2 = once(C, 'bcast:watch_response');
  B.emit('bcast:watch_response', ROOM_ID, uidC, true);
  const accC2 = await pAccC2;
  ok('قبل B طلب C', accC2.accept && accC2.hosts[0].id === uidB);
  ok('مشاهدة A لم تُغلق بعد قبول B (البثّان معاً)', (await noLeftAfterAccept) === true);

  console.log('\n[5] توجيه إشارات WebRTC — C تتواصل مع المذيعَين في نفس الوقت');
  const pSigA = once(A, 'bcast:signal');
  const pSigB = once(B, 'bcast:signal');
  C.emit('bcast:signal', ROOM_ID, uidA, { type: 'offer', dir: 'in', sdp: { type: 'offer', sdp: 'x' } });
  C.emit('bcast:signal', ROOM_ID, uidB, { type: 'offer', dir: 'in', sdp: { type: 'offer', sdp: 'y' } });
  const gotA = await pSigA, gotB = await pSigB;
  ok('إشارة C→A مسموحة (ما زالت تشاهده)', gotA.__timeout !== true && gotA.data && gotA.data.sdp.sdp === 'x', JSON.stringify(gotA));
  ok('إشارة C→B مسموحة (تشاهده أيضاً)', gotB.__timeout !== true && gotB.data && gotB.data.sdp.sdp === 'y', JSON.stringify(gotB));

  console.log('\n[6] مذيع B يطلب مشاهدة مذيع A (اتجاه واحد بموافقة مستقلة)');
  const pReqA2 = once(A, 'bcast:watch_request');
  const ackB2 = await emit(B, 'bcast:watch_request', ROOM_ID, uidA);
  ok('سُمح لمذيع بطلب مشاهدة مذيع آخر', ackB2.ok, JSON.stringify(ackB2));
  const reqA2 = await pReqA2;
  ok('وصل طلب B إلى A', reqA2.user && reqA2.user.username === 'admin');
  const uidBReal = reqA2.user.id;
  const pAccB = once(B, 'bcast:watch_response');
  A.emit('bcast:watch_response', ROOM_ID, uidBReal, true);
  const accB = await pAccB;
  ok('B يشاهد A الآن (اتجاه واحد)', accB.accept && accB.hosts[0].id === uidA);
  // A ما زال يبث لمشاهديه بشكل طبيعي رغم أنه صار مصدراً لمذيع آخر أيضاً
  const pSigC3 = once(C, 'bcast:signal');
  A.emit('bcast:signal', ROOM_ID, uidC, { type: 'offer', dir: 'out', sdp: { type: 'offer', sdp: 'a2c' } });
  const gotC3 = await pSigC3;
  ok('بث A لم يتوقف بعد دخول مذيع آخر عليه (إشارته تصل لمشاهده)', gotC3.__timeout !== true && gotC3.data.sdp.sdp === 'a2c');
  const pSigB3 = once(B, 'bcast:signal');
  A.emit('bcast:signal', ROOM_ID, uidBReal, { type: 'offer', dir: 'out', sdp: { type: 'offer', sdp: 'a2b' } });
  const gotB3 = await pSigB3;
  ok('A يرسل بثه للمذيع B الذي وافق على مشاهدته', gotB3.__timeout !== true && gotB3.data.sdp.sdp === 'a2b');

  console.log('\n[7] C توقف مشاهدة A وحده — بقية بثوثها تعمل، ثم رفض/قبول طلب جديد');
  const pViewerLeftA3 = once(A, 'bcast:viewer_left');
  C.emit('bcast:leave', ROOM_ID, uidA);
  const vl3 = await pViewerLeftA3;
  ok('أُعلم A بإيقاف C لمشاهدة بثه وحده', vl3.userId === uidC, JSON.stringify(vl3));
  const pSigB2 = once(B, 'bcast:signal');
  C.emit('bcast:signal', ROOM_ID, uidB, { type: 'candidate', dir: 'in', candidate: { cand: 'z' } });
  const gotB2 = await pSigB2;
  ok('C ما زالت تشاهد B بعد إيقافها مشاهدة A', gotB2.__timeout !== true && gotB2.data.type === 'candidate');
  const pReqA3 = once(A, 'bcast:watch_request');
  await emit(C, 'bcast:watch_request', ROOM_ID, uidA);
  await pReqA3;
  const pRejC = once(C, 'bcast:watch_response');
  A.emit('bcast:watch_response', ROOM_ID, uidC, false);
  const rejC = await pRejC;
  ok('وصل الرفض إلى C مع تحديد صاحب البث', rejC.accept === false && rejC.hostId === uidA, JSON.stringify(rejC));
  const pReqA4 = once(A, 'bcast:watch_request');
  await emit(C, 'bcast:watch_request', ROOM_ID, uidA);
  await pReqA4;
  const pAccC4 = once(C, 'bcast:watch_response');
  A.emit('bcast:watch_response', ROOM_ID, uidC, true);
  ok('عادت C لمشاهدة A بجانب B (بثّان معاً)', (await pAccC4).accept === true);

  console.log('\n[8] انتهاء بث B — تنقطع مشاهدة C له ويُعلم A بمغادرة B لمشاهدته');
  const pWatchEnded = once(C, 'bcast:watch_ended');
  const pViewerLeftA2 = once(A, 'bcast:viewer_left');
  const pStopped = expectNone(C, 'bcast:stopped', 1500);
  const ackStopB = await emit(B, 'bcast:stop', ROOM_ID);
  ok('توقف B عن البث', ackStopB.ok);
  const wEnded = await pWatchEnded;
  ok('وصل bcast:watch_ended إلى C (كانت تشاهده)', wEnded.hostId === uidB, JSON.stringify(wEnded));
  const vlA2 = await pViewerLeftA2;
  ok('أُعلم A بأن B لم يعد يشاهده', vlA2.userId === uidBReal);
  ok('البث الكلي لم ينته (A ما زال يبث)', (await pStopped) === true);
  const pSigA4 = once(A, 'bcast:signal');
  C.emit('bcast:signal', ROOM_ID, uidA, { type: 'candidate', dir: 'in', candidate: { cand: 'k' } });
  const gotA4 = await pSigA4;
  ok('C ما زالت تشاهد A بعد انتهاء بث B', gotA4.__timeout !== true && gotA4.data.type === 'candidate');

  console.log('\n[9] انتهاء بث A — ينتهي البث كاملاً');
  const pStopped2 = once(C, 'bcast:stopped');
  await emit(A, 'bcast:stop', ROOM_ID);
  const st2 = await pStopped2;
  ok('وصل bcast:stopped للجميع', st2.__timeout !== true);

  console.log(`\n========= النتيجة: ${passed} ناجح / ${failed} فاشل =========`);
  A.close(); B.close(); C.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('خطأ في الاختبار:', e); process.exit(2); });
