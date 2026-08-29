// اختبار سريع: دخول مستخدم ملكي للغرفة 8 → استقبال royal_enter
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const io = require('/home/user/chat1/node_modules/socket.io-client');
const sqlite3 = require('/home/user/chat1/node_modules/sqlite3');
const bcrypt = require('/home/user/chat1/node_modules/bcryptjs');
const BASE = 'http://localhost:3000';
const DB = new sqlite3.Database('/home/user/chat1/chat.db');
const qrun = (s, p = []) => new Promise((r, j) => DB.run(s, p, e => e ? j(e) : r()));
const qget = (s, p = []) => new Promise((r, j) => DB.get(s, p, (e, x) => e ? j(e) : r(x)));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const emit = (s, ev, ...a) => new Promise(r => s.emit(ev, ...a, r));

(async () => {
  const T = Date.now() % 100000000;
  const uname = 'royalfs' + T;
  const pw = 'royal1234';
  await qrun(`DELETE FROM users WHERE username=?`, [uname]);
  await qrun(`DELETE FROM royal_users WHERE username=?`, [uname]);
  await qrun(`INSERT INTO users (username,password,email,email_verified,gender,age,country,balance,membership,rank,registered)
    VALUES (?,?,?,1,'boy',25,'jo',200,'none','user',1)`, [uname, bcrypt.hashSync(pw, 10), uname + '@gmail.com']);
  await qrun(`INSERT INTO royal_users (username, animal) VALUES (?, 'lion')`, [uname]);

  const login = async (u, p) => {
    const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-chat-client': '1' }, body: JSON.stringify({ username: u, password: p }) });
    return { status: r.status, d: await r.json().catch(() => ({})) };
  };
  const connect = async (token) => new Promise((resolve, reject) => {
    const d = () => ((x => x + String(x * 257))((Math.floor(Math.random() * 9000000000) + 1000000000)));
    const s = io(BASE, { auth: { client: 'chat', token }, query: { key: d() }, transports: ['websocket'] });
    s.on('connect', () => setTimeout(() => resolve(s), 300));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('timeout')), 8000);
  });

  const listLg = await login('ax', '123456');
  console.log('listener (ax) login:', listLg.status);
  const listener = await connect(listLg.d.tab_token);

  const lg = await login(uname, pw);
  console.log('royal login:', lg.status, lg.d.user ? ('royal=' + lg.d.user.royal + ' animal=' + lg.d.user.royal_animal) : 'no user');
  const royalSock = await connect(lg.d.tab_token);

  await emit(listener, 'join', 8, '');
  await sleep(300);
  const royalEnterP = new Promise(resolve => {
    const t = setTimeout(() => resolve(null), 6000);
    listener.once('royal_enter', d => { clearTimeout(t); resolve(d); });
  });
  const joinR = await emit(royalSock, 'join', 8, '');
  console.log('royal join:', JSON.stringify(joinR));
  const ev = await royalEnterP;
  console.log('royal_enter received:', JSON.stringify(ev || null));
  console.log(ev && ev.username === uname ? '✅ PASS royal_enter' : '❌ FAIL');
  try { royalSock.disconnect(); listener.disconnect(); } catch (e) {}
  await qrun(`DELETE FROM royal_users WHERE username=?`, [uname]);
  await qrun(`DELETE FROM users WHERE username=?`, [uname]);
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
