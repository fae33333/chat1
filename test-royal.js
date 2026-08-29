// اختبار نظام الدخول الملكي: طلب + موافقة + شارة + توهج الدخول (royal_enter)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const io = require('/home/user/chat1/node_modules/socket.io-client');
const sqlite3 = require('/home/user/chat1/node_modules/sqlite3');
const bcrypt = require('/home/user/chat1/node_modules/bcryptjs');
const BASE = 'https://localhost:2083';
const DB = new sqlite3.Database('/home/user/chat1/chat.db');
const qrun = (s, p = []) => new Promise((r, j) => DB.run(s, p, e => e ? j(e) : r()));
const qget = (s, p = []) => new Promise((r, j) => DB.get(s, p, (e, x) => e ? j(e) : r(x)));
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? (pass++, console.log('  ✔ ' + n)) : (fail++, console.log('  ✘ ' + n + ' ' + x)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const emit = (s, ev, ...a) => new Promise(r => s.emit(ev, ...a, r));

(async () => {
  const T = Date.now() % 100000000;
  const uname = 'royal' + T;
  const pw = 'royal1234';
  await qrun(`DELETE FROM users WHERE username IN (?,?)`, [uname, 'royallist' + T]);
  await qrun(`DELETE FROM royal_users WHERE username=?`, [uname]);
  await qrun(`INSERT INTO users (username,password,email,email_verified,gender,age,country,balance,membership,rank,registered)
    VALUES (?,?,?,1,'boy',25,'jo',200,'none','user',1)`, [uname, bcrypt.hashSync(pw, 10), 'royal' + T + '@gmail.com']);
  const uid = (await qget(`SELECT id FROM users WHERE username=?`, uname)).id;
  await qrun(`INSERT INTO users (username,password,email,email_verified,gender,age,country,balance,membership,rank,registered)
    VALUES (?,?,?,1,'boy',25,'jo',50,'none','user',1)`, ['royallist' + T, bcrypt.hashSync(pw, 10), 'royallist' + T + '@gmail.com']);

  const post = async (path, body, token) => {
    const h = { 'content-type': 'application/json', 'x-chat-client': '1' };
    if (token) h['x-chat-token'] = token;
    const r = await fetch(BASE + path, { method: 'POST', headers: h, body: JSON.stringify(body || {}) });
    return { status: r.status, d: await r.json().catch(() => ({})) };
  };
  const get = async (path, token) => {
    const h = { 'x-chat-client': '1' };
    if (token) h['x-chat-token'] = token;
    const r = await fetch(BASE + path, { headers: h });
    return { status: r.status, d: await r.json().catch(() => ({})) };
  };
  const login = async (u, p) => {
    const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-chat-client': '1' }, body: JSON.stringify({ username: u, password: p }) });
    return { status: r.status, d: await r.json().catch(() => ({})) };
  };
  const connect = async (token) => new Promise((resolve, reject) => {
    const d = () => ((x => x + String(x * 257))((Math.floor(Math.random() * 9000000000) + 1000000000)));
    const s = io(BASE, { auth: { client: 'chat', token }, query: { key: d() }, transports: ['websocket'], rejectUnauthorized: false });
    s.on('connect', () => setTimeout(() => resolve(s), 300));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('timeout')), 8000);
  });

  console.log('— 1) معلومات الملكية قبل الطلب');
  const lg = await login(uname, pw);
  ok('دخول المستخدم', lg.status === 200 && !!lg.d.tab_token);
  let r = await get('/api/royal-info', lg.d.tab_token);
  ok('السعر الافتراضي 50 ذهب', r.status === 200 && r.d.price === 50, JSON.stringify(r.d));
  ok('غير ملكي بعد', r.d.isRoyal === false && r.d.hasPending === false);

  console.log('— 2) طلب الدخول الملكي مع اختيار الحيوان (حوت)');
  r = await post('/api/royal-request', { animal: 'whale' }, lg.d.tab_token);
  ok('الطلب مقبول بالحيوان whale', r.status === 200 && r.d.requested === true && r.d.animal === 'whale', 'status=' + r.status + ' ' + JSON.stringify(r.d));
  r = await post('/api/royal-request', { animal: 'dragon' }, lg.d.tab_token);
  ok('طلب مكرر مرفوض', r.status === 400, 'status=' + r.status + ' ' + JSON.stringify(r.d));
  r = await get('/api/royal-info', lg.d.tab_token);
  ok('الحالة: طلب قيد المراجعة بالحيوان whale', r.d.hasPending === true && r.d.pendingAnimal === 'whale', JSON.stringify(r.d));

  console.log('— 3) موافقة الإدارة (خصم 50 ذهب)');
  const adm = await login('ax', '123456');
  const reqRow = await qget(`SELECT id, plan FROM service_requests WHERE user_id=? AND request_type='royal' ORDER BY id DESC LIMIT 1`, uid);
  ok('الحيوان محفوظ في الطلب', reqRow.plan === 'whale', JSON.stringify(reqRow));
  const ah = { 'x-admin-token': adm.d.admin_access_token, 'content-type': 'application/json' };
  r = await (await fetch(BASE + `/api/admin/service-requests/${reqRow.id}/approve`, { method: 'POST', headers: ah, body: JSON.stringify({ gold: 50 }) })).json();
  ok('الموافقة نجحت', r.ok === true, JSON.stringify(r));
  const row = await qget(`SELECT * FROM royal_users WHERE username=?`, uname);
  ok('أُضيف لقائمة الملكية بالحيوان whale', !!row && row.animal === 'whale', JSON.stringify(row || {}));
  const bal = (await qget(`SELECT balance FROM users WHERE id=?`, uid)).balance;
  ok('خُصم 50 ذهب', bal === 150, 'balance=' + bal);

  console.log('— 4) بعد الموافقة: الشارة + الحيوان + رفض الطلب الجديد');
  r = await get('/api/royal-info', lg.d.tab_token);
  ok('isRoyal = true مع الحيوان whale', r.d.isRoyal === true && r.d.animal === 'whale', JSON.stringify(r.d));
  r = await post('/api/royal-request', { animal: 'lion' }, lg.d.tab_token);
  ok('طلب جديد مرفوض (ملكياً بالفعل)', r.status === 400, 'status=' + r.status);
  const lg2 = await login(uname, pw);
  ok('شارة الملكية + الحيوان في بيانات المستخدم', lg2.d.user && lg2.d.user.royal === 1 && lg2.d.user.royal_animal === 'whale', JSON.stringify(lg2.d.user || {}).slice(0, 160));

  console.log('— 5) توهج الدخول: مستمع يستقبل royal_enter بالحيوان والجنس');
  const listLg = await login('royallist' + T, pw);
  const listener = await connect(listLg.d.tab_token);
  const royalSock = await connect(lg2.d.tab_token);
  await emit(listener, 'join', 8, '');
  await sleep(300);
  const royalEnterP = new Promise(resolve => {
    const t = setTimeout(() => resolve(null), 6000);
    listener.once('royal_enter', d => { clearTimeout(t); resolve(d); });
  });
  const joinR = await emit(royalSock, 'join', 8, '');
  ok('الملك دخل الغرفة', joinR && joinR.ok, JSON.stringify(joinR));
  const ev = await royalEnterP;
  ok('المستمع استقبل royal_enter', !!ev && ev.username === uname, JSON.stringify(ev || {}));
  ok('الحيوان والجنس في الحدث', ev && ev.animal === 'whale' && ev.gender === 'boy', JSON.stringify(ev || {}));

  console.log('— 5b) فتاة ملكية (أسد): royal_enter بجنس girl → أسلوب هدية تيك توك');
  const gname = 'royalgirl' + T;
  await qrun(`DELETE FROM users WHERE username=?`, [gname]);
  await qrun(`DELETE FROM royal_users WHERE username=?`, [gname]);
  await qrun(`INSERT INTO users (username,password,email,email_verified,gender,age,country,balance,membership,rank,registered)
    VALUES (?,?,?,1,'girl',22,'jo',50,'none','user',1)`, [gname, bcrypt.hashSync(pw, 10), 'royalgirl' + T + '@gmail.com']);
  await qrun(`INSERT INTO royal_users (username, animal) VALUES (?, 'lion')`, [gname]);
  const girlSock = await connect((await login(gname, pw)).d.tab_token);
  const girlEnterP = new Promise(resolve => {
    const t = setTimeout(() => resolve(null), 6000);
    listener.once('royal_enter', d => { clearTimeout(t); resolve(d); });
  });
  await emit(girlSock, 'join', 8, '');
  const gev = await girlEnterP;
  ok('الفتاة الملكية دخلت', !!gev && gev.username === gname, JSON.stringify(gev || {}));
  ok('الجنس girl + الحيوان lion', gev && gev.gender === 'girl' && gev.animal === 'lion', JSON.stringify(gev || {}));
  try { girlSock.disconnect(); } catch (e) {}
  await qrun(`DELETE FROM royal_users WHERE username=?`, [gname]);
  await qrun(`DELETE FROM users WHERE username=?`, [gname]);

  console.log('— 6) زائر يطلب ملكياً → مرفوض');
  const gR = await fetch(BASE + '/api/guest', { method: 'POST', headers: { 'content-type': 'application/json', 'x-chat-client': '1' }, body: JSON.stringify({ username: 'royalguest' + T, gender: 'boy' }) });
  const gD = await gR.json().catch(() => ({}));
  r = await post('/api/royal-request', {}, gD.tab_token);
  ok('الزائر مرفوض (403)', r.status === 403, 'status=' + r.status);

  // تنظيف
  try { listener.disconnect(); royalSock.disconnect(); } catch (e) {}
  await qrun(`DELETE FROM royal_users WHERE username=?`, [uname]);
  await qrun(`DELETE FROM users WHERE username IN (?,?)`, [uname, 'royallist' + T]);
  DB.close();
  console.log(`\nالنتيجة: ${pass} نجح / ${fail} فشل`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
