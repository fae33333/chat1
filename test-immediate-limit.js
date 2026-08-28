process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const io = require('/home/user/chat1/node_modules/socket.io-client');
const sqlite3 = require('/home/user/chat1/node_modules/sqlite3');
const bcrypt = require('/home/user/chat1/node_modules/bcryptjs');
const d = () => ((x => x + String(x * 257))((Math.floor(Math.random() * 9000000000) + 1000000000)));
const BASE = 'https://localhost:2083';
const DB = new sqlite3.Database('/home/user/chat1/chat.db');
const qrun = (s, p = []) => new Promise((r, j) => DB.run(s, p, e => e ? j(e) : r()));
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? (pass++, console.log('  ✔ ' + n)) : (fail++, console.log('  ✘ ' + n + ' ' + x)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const emit = (s, ev, ...a) => new Promise(r => s.emit(ev, ...a, r));

(async () => {
  const T = 'imm' + Date.now() % 100000;
  const pw = 'imm12345', hash = bcrypt.hashSync(pw, 10);
  const names = [T + 'a', T + 'b'];
  await qrun(`DELETE FROM users WHERE username IN (?,?)`, names);
  for (const n of names) await qrun(`INSERT INTO users (username,password,email,email_verified,gender,age,country,balance,membership,rank,registered) VALUES (?,?,?,1,'boy',25,'jo',100,'none','user',1)`, [n, hash, '']);
  const lg = await (await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-chat-client': '1' }, body: JSON.stringify({ username: 'ax', password: '123456' }) })).json();
  const setLimit = async (v) => {
    const r = await fetch(BASE + '/api/admin/settings', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': lg.admin_access_token }, body: JSON.stringify({ max_live_speakers: String(v) }) });
    return r.status;
  };
  ok('ضبط الحد = 1 عبر الإدارة', (await setLimit(1)) === 200);

  const socks = [];
  for (const n of names) {
    const l = await (await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-chat-client': '1' }, body: JSON.stringify({ username: n, password: pw }) })).json();
    const s = await new Promise((resolve, reject) => {
      const x = io(BASE, { auth: { client: 'chat', token: l.tab_token }, query: { key: d() }, transports: ['websocket'], rejectUnauthorized: false });
      x.on('connect', () => setTimeout(() => resolve(x), 300));
      x.on('connect_error', reject);
    });
    socks.push(s);
  }
  const ROOM = 8;
  for (const s of socks) await emit(s, 'join', ROOM, '');
  await sleep(200);

  console.log('— الحد 1: الأول يصعد والثاني مرفوض');
  const r1 = await emit(socks[0], 'bcast:start', ROOM);
  ok('المذيع 1 صعد', r1 && r1.ok, JSON.stringify(r1));
  const r2 = await emit(socks[1], 'bcast:start', ROOM);
  ok('المذيع 2 مرفوض (ممتلئة)', r2 && r2.ok === false && /ممتلئة/.test(r2.text || ''), JSON.stringify(r2));

  console.log('— رفع الحد إلى 2 فوراً (بدون أي إعادة تشغيل) → الثاني يصعد مباشرة');
  ok('الحفظ الفوري', (await setLimit(2)) === 200);
  const r3 = await emit(socks[1], 'bcast:start', ROOM);
  ok('المذيع 2 صعد فوراً بعد رفع الحد', r3 && r3.ok, JSON.stringify(r3));

  ok('استعادة الحد 4', (await setLimit(4)) === 200);
  await emit(socks[0], 'bcast:stop', ROOM);
  await sleep(200);
  await emit(socks[1], 'bcast:stop', ROOM);
  for (const s of socks) s.disconnect();
  await qrun(`DELETE FROM users WHERE username IN (?,?)`, names);
  DB.close();
  console.log(`\nالنتيجة: ${pass} نجح / ${fail} فشل`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
