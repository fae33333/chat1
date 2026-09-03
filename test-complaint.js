// اختبار شكاوى المستخدمين: المسجل يُبلِّغ (مع تحديد المُبلَّغ عنه) / الزائر مرفوض / الإدارة تعرض وتحذف
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const sqlite3 = require('/home/user/chat1/node_modules/sqlite3');
const bcrypt = require('/home/user/chat1/node_modules/bcryptjs');
const BASE = 'https://localhost:2083';
const DB = new sqlite3.Database('/home/user/chat1/chat.db');
const qrun = (s, p = []) => new Promise((r, j) => DB.run(s, p, e => e ? j(e) : r()));
const qget = (s, p = []) => new Promise((r, j) => DB.get(s, p, (e, x) => e ? j(e) : r(x)));
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? (pass++, console.log('  ✔ ' + n)) : (fail++, console.log('  ✘ ' + n + ' ' + x)); };

(async () => {
  const T = 'cmp' + Date.now() % 100000;
  const pw = 'cmp12345', hash = bcrypt.hashSync(pw, 10);
  const names = [T + 'reg', T + 'guest', T + 'target'];
  await qrun(`DELETE FROM users WHERE username IN (?,?,?)`, names);
  await qrun(`INSERT INTO users (username,password,email,email_verified,gender,age,country,balance,membership,rank,registered) VALUES (?,?,?,1,'boy',25,'jo',100,'none','user',1)`, [T + 'reg', hash, '']);
  await qrun(`INSERT INTO users (username,gender,registered,membership,rank,balance) VALUES (?,?,0,'none','user',50)`, [T + 'guest']);
  await qrun(`INSERT INTO users (username,password,email,email_verified,gender,age,country,balance,membership,rank,registered) VALUES (?,?,?,1,'boy',25,'jo',100,'none','user',1)`, [T + 'target', hash, '']);

  const regId = (await qget(`SELECT id FROM users WHERE username=?`, T + 'reg')).id;
  const guestId = (await qget(`SELECT id FROM users WHERE username=?`, T + 'guest')).id;
  const targetId = (await qget(`SELECT id FROM users WHERE username=?`, T + 'target')).id;

  const login = async (u, p) => {
    const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-chat-client': '1' }, body: JSON.stringify({ username: u, password: p }) });
    return { status: r.status, d: await r.json().catch(() => ({})) };
  };
  const guestJoin = async (u) => {
    const r = await fetch(BASE + '/api/guest', { method: 'POST', headers: { 'content-type': 'application/json', 'x-chat-client': '1' }, body: JSON.stringify({ username: u, gender: 'boy' }) });
    return { status: r.status, d: await r.json().catch(() => ({})) };
  };
  const complain = async (token, body) => {
    const r = await fetch(BASE + '/api/complaint', { method: 'POST', headers: { 'content-type': 'application/json', 'x-chat-client': '1', 'x-chat-token': token }, body: JSON.stringify(body) });
    return { status: r.status, d: await r.json().catch(() => ({})) };
  };

  console.log('— 1) مسجل يُبلِّغ عن مستخدم (مع تحديد المُبلَّغ عنه)');
  const lg = await login(T + 'reg', pw);
  ok('دخول المسجل', lg.status === 200 && !!lg.d.tab_token);
  let r = await complain(lg.d.tab_token, { subject: 'إبلاغ عن ' + (T + 'target'), message: 'ي spam في الغرفة', targetId });
  ok('الشكوى مقبولة', r.status === 200 && r.d.ok === true, JSON.stringify(r.d));
  const row = await qget(`SELECT * FROM complaints WHERE user_id=? ORDER BY id DESC LIMIT 1`, regId);
  ok('حُفظ اسم المُبلَّغ عنه', row && +row.target_id === targetId && row.target_name === T + 'target', JSON.stringify(row || {}));

  console.log('— 2) زائر يحاول الإبلاغ عن ملف شخصي → مرفوض');
  const g = await guestJoin(T + 'guest');
  ok('دخول الزائر', g.status === 200 && !!g.d.tab_token, JSON.stringify(g.d).slice(0, 120));
  r = await complain(g.d.tab_token, { subject: 'إبلاغ عن ' + (T + 'target'), message: 'شكوى زائر', targetId });
  ok('مرفوض (403)', r.status === 403, 'status=' + r.status + ' ' + JSON.stringify(r.d));

  console.log('— 3) الزائر يستخدم النافذة لاستعادة كلمة السر (بدون مستخدم) → مقبول');
  r = await complain(g.d.tab_token, { subject: 'استعادة كلمة السر', message: 'نسيت كلمة المرور' });
  ok('مقبول بلا target', r.status === 200 && r.d.ok === true, 'status=' + r.status);

  console.log('— 3b) إرفاق صورة (دليل) مع الشكوى');
  const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('media', new Blob([PNG_1PX], { type: 'image/png' }), 'proof.png');
  const upR = await fetch(BASE + '/api/chat/upload-media', { method: 'POST', headers: { 'x-chat-client': '1', 'x-chat-token': lg.d.tab_token }, body: fd });
  const upD = await upR.json().catch(() => ({}));
  ok('رفع صورة الدليل', upR.status === 200 && !!upD.path, 'status=' + upR.status + ' ' + JSON.stringify(upD));
  r = await complain(lg.d.tab_token, { subject: 'شكوى مع صورة', message: 'انظروا للصورة', targetId, image: upD.path || '' });
  ok('الشكوى بالصورة مقبولة', r.status === 200 && r.d.ok === true, 'status=' + r.status);
  const row2 = await qget(`SELECT * FROM complaints WHERE user_id=? ORDER BY id DESC LIMIT 1`, regId);
  ok('مسار الصورة حُفظ في الشكوى', row2 && row2.image === upD.path, JSON.stringify(row2 || {}));

  console.log('— 4) الإدارة: عرض الشكاوى ثم حذفها');
  const adm = await login('ax', '123456');
  ok('دخول الإدارة', adm.status === 200 && !!adm.d.admin_access_token);
  const ah = { 'content-type': 'application/json', 'x-admin-token': adm.d.admin_access_token };
  let list = await (await fetch(BASE + '/api/admin/complaints', { headers: { 'x-admin-token': adm.d.admin_access_token } })).json();
  const mine = (list || []).find(c => c.username === T + 'reg' && c.target_id === targetId);
  ok('الشكوى تظهر بقسم الإدارة مع المُبلَّغ عنه', !!mine && mine.target_name === T + 'target', JSON.stringify(mine || {}));
  const mineImg = (list || []).find(c => c.image && c.username === T + 'reg');
  ok('صورة الدليل تظهر في قسم الإدارة', !!mineImg && mineImg.image.startsWith('/uploads/'), JSON.stringify((mineImg || {}).image || ''));
  const delR = await fetch(BASE + `/api/admin/complaints/${mine ? mine.id : 0}`, { method: 'DELETE', headers: { 'x-admin-token': adm.d.admin_access_token } });
  ok('حذف الشكوى', delR.status === 200, 'status=' + delR.status);
  list = await (await fetch(BASE + '/api/admin/complaints', { headers: { 'x-admin-token': adm.d.admin_access_token } })).json();
  ok('اختفت من القائمة', !(list || []).some(c => c.id === (mine && mine.id)), '');

  // تنظيف
  await qrun(`DELETE FROM complaints WHERE username=?`, T + 'reg');
  await qrun(`DELETE FROM users WHERE username IN (?,?,?)`, names);
  DB.close();
  console.log(`\nالنتيجة: ${pass} نجح / ${fail} فشل`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
