// اختبار: كشف النكات + العدّاد اللحظي + الحظر/الطرد/الكتم في الوقت الفعلي
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const io = require('/home/user/chat1/node_modules/socket.io-client');
const sqlite3 = require('/home/user/chat1/node_modules/sqlite3');
const bcrypt = require('/home/user/chat1/node_modules/bcryptjs');
const d = () => ((x => x + String(x * 257))((Math.floor(Math.random() * 9000000000) + 1000000000)));
const BASE = 'https://localhost:2083';
const DB = new sqlite3.Database('/home/user/chat1/chat.db');
const qrun = (s, p = []) => new Promise((r, j) => DB.run(s, p, e => e ? j(e) : r()));
const qget = (s, p = []) => new Promise((r, j) => DB.get(s, p, (e, x) => e ? j(e) : r(x)));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0;
const ok = (n, c, x = '') => { c ? (passed++, console.log('  ✔ ' + n)) : (failed++, console.log('  ✘ ' + n + ' ' + x)); };

const NAMES = ['taAdmin', 'taNick1', 'taNick2', 'taVictim'];
async function mk(name, rank = 'user') {
  await qrun(`DELETE FROM users WHERE username=?`, [name]);
  await qrun(`INSERT INTO users (username,password,email,email_verified,gender,age,country,balance,membership,rank,registered)
    VALUES (?,?,'',1,'boy',25,'jo',100,'none',?,1)`, [name, bcrypt.hashSync('pw1234', 10), rank]);
  const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-chat-client': '1' }, body: JSON.stringify({ username: name, password: 'pw1234' }) });
  const j = await r.json();
  return j.tab_token;
}
const conn = tok => new Promise((res, rej) => {
  const s = io(BASE, { auth: { client: 'chat', token: tok }, query: { key: d() }, transports: ['websocket'], rejectUnauthorized: false });
  s.on('connect', () => setTimeout(() => res(s), 200)); s.on('connect_error', rej);
  setTimeout(() => rej(new Error('timeout')), 8000);
});
const api = (tok, p, m = 'GET', b) => fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', 'x-chat-client': '1', 'x-chat-token': tok }, body: b ? JSON.stringify(b) : undefined })
  .then(async r => ({ s: r.status, j: await r.json().catch(() => ({})) }));

(async () => {
  const room = await qget(`SELECT id,name FROM rooms WHERE status='open' ORDER BY id LIMIT 1`);
  console.log('الغرفة:', room.name, '#' + room.id);

  const tAdmin = await mk('taAdmin', 'superadmin');
  const tN1 = await mk('taNick1');
  const tN2 = await mk('taNick2');
  const tVic = await mk('taVictim');

  const sAdmin = await conn(tAdmin);
  let counts = [], users = [];
  sAdmin.on('roomCounts', c => counts.push(c[room.id]));
  sAdmin.on('roomUsers', u => users.push(u.users.map(x => x.username)));
  await new Promise(r => sAdmin.emit('join', room.id, '', {}, r));
  await sleep(300);

  console.log('\n— العدّاد لحظي عند دخول شخص آخر');
  counts = []; users = [];
  const sVic = await conn(tVic);
  await new Promise(r => sVic.emit('join', room.id, '', {}, r));
  await sleep(500);
  ok('العدّاد ارتفع فوراً إلى 2', counts.includes(2), 'counts=' + JSON.stringify(counts));
  ok('قائمة المستخدمين تضم الاسم الجديد فوراً', users.some(u => u.includes('taVictim')), JSON.stringify(users));

  console.log('\n— الكتم لحظي');
  let mutedEv = null; sVic.on('mute_changed', p => mutedEv = p);
  users = [];
  const vid = (await qget(`SELECT id FROM users WHERE username='taVictim'`)).id;
  await api(tAdmin, `/api/admin/users/${vid}/mute`, 'POST', { muted: true, room_id: room.id });
  await sleep(500);
  ok('المكتوم يستلم mute_changed فوراً', mutedEv && mutedEv.muted === 1, JSON.stringify(mutedEv));
  ok('قائمة المستخدمين تحدّثت بحالة الكتم', users.length > 0, 'events=' + users.length);

  console.log('\n— الطرد يخرجه فوراً ويزيل اسمه');
  let kickEv = null; sVic.on('kicked', p => kickEv = p);
  counts = []; users = [];
  await api(tAdmin, `/api/admin/users/${vid}/kick`, 'POST', { room_id: room.id });
  await sleep(600);
  ok('المطرود يستلم kicked فوراً', !!kickEv, JSON.stringify(kickEv));
  ok('العدّاد نزل إلى 1 فوراً', counts.includes(1), 'counts=' + JSON.stringify(counts));
  ok('اسم المطرود اختفى من القائمة', users.length && !users[users.length - 1].includes('taVictim'), JSON.stringify(users));

  console.log('\n— الحظر يخرجه فوراً ويزيل اسمه');
  await qrun(`DELETE FROM room_kicks WHERE username='taVictim'`);
  const sVic2 = await conn(tVic);
  await new Promise(r => sVic2.emit('join', room.id, '', {}, r));
  await sleep(400);
  let banEv = null; sVic2.on('banned', p => banEv = p);
  counts = []; users = [];
  await api(tAdmin, `/api/admin/users/${vid}/ban`, 'POST', { banned: true, reason: 'اختبار', room_id: room.id });
  await sleep(800);
  ok('المحظور يستلم banned فوراً', !!banEv, JSON.stringify(banEv));
  ok('العدّاد نزل إلى 1 فوراً بعد الحظر', counts.includes(1), 'counts=' + JSON.stringify(counts));
  ok('اسم المحظور اختفى من قائمة المستخدمين', users.length && !users[users.length - 1].includes('taVictim'), JSON.stringify(users));

  console.log('\n— كشف النكات');
  const n1id = (await qget(`SELECT id FROM users WHERE username='taNick1'`)).id;
  let r = await api(tAdmin, `/api/admin/users/${n1id}/aliases?room_id=${room.id}`);
  ok('الطلب ينجح للسوبر ادمن', r.s === 200 && r.j.ok === true, JSON.stringify(r.j).slice(0, 150));
  const names = (r.j.aliases || []).map(a => a.username);
  ok('يعرض عنوان IP', !!r.j.ip, 'ip=' + r.j.ip);
  ok('يعرض الدولة', !!r.j.country, 'country=' + r.j.country);
  ok('يكشف النكات الأخرى من نفس الـ IP', names.includes('taNick1') && names.includes('taNick2'), JSON.stringify(names));
  const withTime = (r.j.aliases || []).every(a => typeof a.last_login === 'number');
  ok('كل اسم معه وقت الدخول', withTime);
  const eachHasIpCountry = (r.j.aliases || []).every(a => a.ip && a.country);
  ok('كل اسم معه IP ودولة', eachHasIpCountry);

  console.log('\n— الصلاحية: عضو عادي ممنوع');
  r = await api(tN1, `/api/admin/users/${n1id}/aliases?room_id=${room.id}`);
  ok('العضو العادي يُرفض (403)', r.s === 403, 'status=' + r.s);

  sAdmin.disconnect(); sVic.disconnect(); sVic2.disconnect();
  await sleep(300);
  await qrun(`DELETE FROM bans WHERE username='taVictim'`);
  await qrun(`DELETE FROM room_kicks WHERE username='taVictim'`);
  for (const n of NAMES) {
    const u = await qget(`SELECT id FROM users WHERE username=?`, [n]);
    if (u) await qrun(`DELETE FROM login_history WHERE user_id=?`, [u.id]);
    await qrun(`DELETE FROM users WHERE username=?`, [n]);
  }
  DB.close();
  console.log(`\nالنتيجة: ${passed} نجح / ${failed} فشل`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
