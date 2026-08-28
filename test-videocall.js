/* اختبار آلي لمكالمات الفيديو الخاصة (سناب شات) عبر Socket.IO */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const io = require('socket.io-client');
const sqlite3 = require('/home/user/chat1/node_modules/sqlite3');
const d = () => ((x => x + String(x * 257))((Math.floor(Math.random() * 9000000000) + 1000000000)));

const BASE = 'https://localhost:2083';
const DB = new sqlite3.Database('/home/user/chat1/chat.db');
const qrun = (sql, p = []) => new Promise((res, rej) => DB.run(sql, p, e => e ? rej(e) : res()));
const qget = (sql, p = []) => new Promise((res, rej) => DB.get(sql, p, (e, r) => e ? rej(e) : res(r)));

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
    const sock = io(BASE, { auth: { client: 'chat', token }, query: { key: d() }, transports: ['websocket'], rejectUnauthorized: false });
    // مهلة قصيرة بعد الاتصال قبل إرسال أوامر الغرف (المستخدم الحقيقي لا يضغط الغرفة إلا بعد اكتمال الواجهة)
    sock.on('connect', () => setTimeout(() => resolve(sock), 200));
    sock.on('connect_error', reject);
    setTimeout(() => reject(new Error('timeout')), 8000);
  });
}
function emitAck(sock, ev, ...args) {
  return new Promise((resolve) => sock.emit(ev, ...args, resolve));
}
function once(sock, ev, timeout = 5000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ __timeout: true }), timeout);
    sock.once(ev, (data) => { clearTimeout(t); resolve(data || {}); });
  });
}

(async () => {
  // تجهيز حسابين تجريبيين
  const bcrypt = require('/home/user/chat1/node_modules/bcryptjs');
  const hash = bcrypt.hashSync('x123456', 10);
  await qrun(`DELETE FROM users WHERE username IN ('vc_caller','vc_target')`);
  await qrun(`INSERT INTO users (username,password,gender,age,country,bio,registered,balance,rank,membership) VALUES ('vc_caller',?,'boy',25,'','',1,0,'user','none'), ('vc_target',?,'girl',25,'','',1,0,'user','none')`, [hash, hash]);
  // مكالمة الفيديو مسموحة الآن لـ mmez,plus,premium,vip فقط (الافتراضي)
  const [a, b] = await Promise.all([login('vc_caller', 'x123456'), login('vc_target', 'x123456')]);
  const A = await connect(a.tab_token);
  const B = await connect(b.tab_token);
  const aId = (await qget(`SELECT id FROM users WHERE username='vc_caller'`)).id;
  const bId = (await qget(`SELECT id FROM users WHERE username='vc_target'`)).id;
  await sleep(400);

  console.log('— 1) محاولة مكالمة فيديو بصلاحية غير مسموحة (registered)');
  let inc = once(B, 'call:incoming');
  let rej = once(A, 'call:rejected');
  emitAck(A, 'call:request', { toId: bId, type: 'video' });
  const rejected = await rej;
  ok('رُفضت المكالمة: not_allowed', rejected.reason === 'not_allowed', JSON.stringify(rejected));
  const noInc = await inc;
  ok('لم يصل رنين للطرف الآخر', noInc.__timeout === true);

  console.log('— 2) رفع العضوية إلى vip → رصيد 0 → رفض لعدم كفاية الرصيد');
  await qrun(`UPDATE users SET membership='vip' WHERE id=?`, [aId]);
  await sleep(200);
  inc = once(B, 'call:incoming');
  rej = once(A, 'call:rejected');
  emitAck(A, 'call:request', { toId: bId, type: 'video' });
  const rej2 = await rej;
  ok('رُفضت: insufficient_balance', rej2.reason === 'insufficient_balance', JSON.stringify(rej2));
  const noInc2 = await inc;
  ok('لم يصل رنين (رصيد غير كافٍ)', noInc2.__timeout === true);

  console.log('— 3) شحن رصيد 10 → مكالمة فيديو ناجحة مع رنين للطرف الآخر');
  await qrun(`UPDATE users SET balance=10, free_call_used=1 WHERE id=?`, [aId]);
  await sleep(200);
  inc = once(B, 'call:incoming');
  const ringing = once(A, 'call:ringing');
  emitAck(A, 'call:request', { toId: bId, type: 'video' });
  const incoming = await inc;
  const ring = await ringing;
  ok('وصل call:incoming بنوع video', incoming.type === 'video', JSON.stringify(incoming));
  ok('كلفة الفيديو 5 في الرنين', ring.callCost === 5, JSON.stringify(ring));

  console.log('— 4) قبول الطرف الآخر → خصم 5 من المتصل (video)');
  const accEvt = once(A, 'call:accepted');
  const goldEvt = once(A, 'call:gold_deducted');
  emitAck(B, 'call:accept', { toId: aId });
  const accepted = await accEvt;
  ok('وصل call:accepted بنوع video', accepted.type === 'video', JSON.stringify(accepted));
  const gold = await goldEvt;
  ok('تم خصم 5 ذهب من المتصل', gold.amount === 5 && gold.balance === 5, JSON.stringify(gold));
  ok('نوع الخصم video', gold.callType === 'video');

  console.log('— 5) إنهاء المكالمة');
  emitAck(A, 'call:end', { toId: bId, reason: 'ended' });
  const ended = once(B, 'call:ended');
  await sleep(300);
  const endEvt = await ended;
  ok('وصل call:ended للطرف الآخر', endEvt.reason === 'ended', JSON.stringify(endEvt));

  console.log('— 6) المكالمة الصوتية لا تزال تعمل (مكلفة بعد استهلاك التجربة)');
  const inc3 = once(B, 'call:incoming');
  emitAck(A, 'call:request', { toId: bId, type: 'audio' });
  const incoming3 = await inc3;
  ok('وصل رنين صوتي بنوع audio', incoming3.type === 'audio', JSON.stringify(incoming3));
  const gold3 = once(A, 'call:gold_deducted');
  emitAck(B, 'call:accept', { toId: aId });
  const gold3evt = await gold3;
  ok('خصم 2 ذهب للمكالمة الصوتية', gold3evt.amount === 2 && gold3evt.balance === 3, JSON.stringify(gold3evt));
  emitAck(A, 'call:end', { toId: bId, reason: 'ended' });

  A.close(); B.close();
  // تنظيف
  await qrun(`DELETE FROM users WHERE username IN ('vc_caller','vc_target')`);
  DB.close();
  console.log(`\nالنتيجة: ${passed} نجح / ${failed} فشل`);
  if (failed) process.exit(1);
})().catch(e => { console.error('TEST ERROR:', e.message); process.exit(1); });
