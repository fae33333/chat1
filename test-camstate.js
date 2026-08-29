// اختبار: إشارة حالة الكاميرا في مكالمة الفيديو (أغلق/فتح الكاميرا)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const io = require('/home/user/chat1/node_modules/socket.io-client');
const sqlite3 = require('/home/user/chat1/node_modules/sqlite3');
const bcrypt = require('/home/user/chat1/node_modules/bcryptjs');
const d = () => ((x => x + String(x * 257))((Math.floor(Math.random() * 9000000000) + 1000000000)));
const BASE = 'https://localhost:2083';

let passed = 0, failed = 0;
const ok = (n, c, x = '') => { c ? (passed++, console.log('  ✅ ' + n)) : (failed++, console.log('  ❌ ' + n + ' ' + x)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const db = new sqlite3.Database('/home/user/chat1/chat.db');
  const run = (s, p = []) => new Promise((r, j) => db.run(s, p, e => e ? j(e) : r()));
  const get = (s, p = []) => new Promise((r, j) => db.get(s, p, (e, x) => e ? j(x) : r(x)));
  await run(`DELETE FROM users WHERE username IN ('cam_a','cam_b')`);
  const pw = bcrypt.hashSync('123456', 10);
  await run(`INSERT INTO users (username,password,gender,age,country,bio,registered,balance,rank,membership) VALUES ('cam_a',?,'boy',25,'jo','',1,500,'user','vip'),('cam_b',?,'girl',25,'jo','',1,500,'user','vip')`, [pw, pw]);

  const a = await (async () => { const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-chat-client': '1' }, body: JSON.stringify({ username: 'cam_a', password: '123456' }) }); return r.json(); })();
  const b = await (async () => { const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-chat-client': '1' }, body: JSON.stringify({ username: 'cam_b', password: '123456' }) }); return r.json(); })();

  const A = await new Promise((res, rej) => { const s = io(BASE, { auth: { client: 'chat', token: a.tab_token }, query: { key: d() }, transports: ['websocket'], rejectUnauthorized: false }); s.on('connect', () => res(s)); s.on('connect_error', rej); });
  const B = await new Promise((res, rej) => { const s = io(BASE, { auth: { client: 'chat', token: b.tab_token }, query: { key: d() }, transports: ['websocket'], rejectUnauthorized: false }); s.on('connect', () => res(s)); s.on('connect_error', rej); });
  await sleep(300);

  const bId = (await get(`SELECT id FROM users WHERE username='cam_b'`)).id;
  const aId = (await get(`SELECT id FROM users WHERE username='cam_a'`)).id;

  console.log('— بدء مكالمة فيديو (A → B) —');
  const inc = new Promise(r => B.once('call:incoming', r));
  A.emit('call:request', { toId: bId, type: 'video' }, () => {});
  const incoming = await inc;
  ok('وصلت مكالمة فيديو', incoming.type === 'video');
  B.emit('call:accept', { toId: aId }, () => {});
  const acc = await new Promise(r => A.once('call:accepted', r));
  ok('قُبلت المكالمة (video)', acc.type === 'video');
  await sleep(200);

  console.log('— A أغلق الكاميرا → B يجب أن يستلم الإشعار —');
  const offEvt = new Promise(r => B.once('call:cam_state', r));
  A.emit('call:cam_state', { toId: bId, on: false }, () => {});
  const off = await offEvt;
  ok('B استلم: الكاميرا أُغلقت', off.on === false && off.fromId === aId, JSON.stringify(off));

  console.log('— A فتح الكاميرا → B يستلم الفتح —');
  const onEvt = new Promise(r => B.once('call:cam_state', r));
  A.emit('call:cam_state', { toId: bId, on: true }, () => {});
  const on = await onEvt;
  ok('B استلم: الكاميرا فُتحت', on.on === true && on.fromId === aId, JSON.stringify(on));

  // إنهاء
  A.emit('call:end', { toId: bId, reason: 'ended' }, () => {});
  await sleep(150);
  A.close(); B.close();
  await run(`DELETE FROM users WHERE username IN ('cam_a','cam_b')`);
  db.close();
  console.log(`\nالنتيجة: ${passed} نجح / ${failed} فشل`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('TEST ERROR:', e.message); process.exit(1); });
