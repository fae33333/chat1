// اختبار: بحث عن حساب + عرض هداياه + حذفها من لوحة الإدارة
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const sqlite3 = require('/home/user/chat1/node_modules/sqlite3');
const bcrypt = require('/home/user/chat1/node_modules/bcryptjs');
const BASE = 'https://localhost:2083';
const DB = new sqlite3.Database('/home/user/chat1/chat.db');
const qrun = (s, p = []) => new Promise((r, j) => DB.run(s, p, e => e ? j(e) : r()));
const qget = (s, p = []) => new Promise((r, j) => DB.get(s, p, (e, x) => e ? j(e) : r(x)));
let passed = 0, failed = 0;
const ok = (n, c, x = '') => { c ? (passed++, console.log('  ✔ ' + n)) : (failed++, console.log('  ✘ ' + n + ' ' + x)); };

const A = 'ugAdmin', V = 'ugVictim', O = 'ugOther';
async function mk(name, rank = 'user') {
  await qrun(`DELETE FROM users WHERE username=?`, [name]);
  await qrun(`INSERT INTO users (username,password,email,email_verified,gender,age,country,balance,membership,rank,registered)
    VALUES (?,?,'',1,'girl',25,'jo',500,'none',?,1)`, [name, bcrypt.hashSync('pw1234', 10), rank]);
  return (await qget(`SELECT id FROM users WHERE username=?`, [name])).id;
}
async function adminToken(name) {
  const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-chat-client': '1' }, body: JSON.stringify({ username: name, password: 'pw1234' }) });
  return (await r.json()).admin_access_token;
}
const api = (tok, p, m = 'GET', b) => fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', 'x-admin-token': tok }, body: b ? JSON.stringify(b) : undefined })
  .then(async r => ({ s: r.status, j: await r.json().catch(() => ({})) }));

(async () => {
  const aid = await mk(A, 'superadmin');
  const vid = await mk(V);
  const oid = await mk(O);
  // هدايا في حساب الضحية + هدية في حساب آخر (للتأكد أنها لا تتأثر)
  await qrun(`DELETE FROM gifts_log WHERE to_id IN (?,?)`, [vid, oid]);
  await qrun(`INSERT INTO gifts_log (from_id,from_name,to_id,to_name,gift_name,gift_img,price,qty) VALUES (?,?,?,?,'وردة','🌹',10,2)`, [oid, O, vid, V]);
  await qrun(`INSERT INTO gifts_log (from_id,from_name,to_id,to_name,gift_name,gift_img,price,qty) VALUES (?,?,?,?,'تاج','👑',50,1)`, [oid, O, vid, V]);
  await qrun(`INSERT INTO gifts_log (from_id,from_name,to_id,to_name,gift_name,gift_img,price,qty) VALUES (?,?,?,?,'قلب','❤️',5,3)`, [oid, O, vid, V]);
  await qrun(`INSERT INTO gifts_log (from_id,from_name,to_id,to_name,gift_name,gift_img,price,qty) VALUES (?,?,?,?,'نجمة','⭐',7,1)`, [vid, V, oid, O]);

  const tok = await adminToken(A);
  ok('الحصول على رمز الإدارة', !!tok);

  console.log('\n— البحث عن الحساب');
  let r = await api(tok, '/api/admin/users?q=' + encodeURIComponent('ugVictim'));
  ok('البحث يرجع الحساب', r.s === 200 && r.j.some(u => u.username === V), JSON.stringify(r.j).slice(0, 120));

  console.log('\n— عرض هدايا الحساب');
  r = await api(tok, `/api/admin/users/${vid}/gifts`);
  ok('الطلب ينجح', r.s === 200 && r.j.ok === true, JSON.stringify(r.j).slice(0, 150));
  ok('عدد سطور الهدايا = 3', r.j.totals.rows === 3, JSON.stringify(r.j.totals));
  ok('إجمالي القطع = 6', r.j.totals.items === 6, JSON.stringify(r.j.totals));
  // 10*2 + 50*1 + 5*3 = 85
  ok('مجموع الذهب = 85', r.j.totals.gold === 85, JSON.stringify(r.j.totals));
  ok('تفاصيل كل هدية (اسم/مرسل/كمية)', r.j.gifts.every(g => g.gift_name && g.from_name && g.qty > 0));
  ok('اسم صاحب الحساب ظاهر', r.j.user.username === V);

  console.log('\n— حذف هدية واحدة');
  const crown = r.j.gifts.find(g => g.gift_name === 'تاج');
  let d = await api(tok, `/api/admin/users/${vid}/gifts/${crown.id}`, 'DELETE');
  ok('الحذف ينجح', d.s === 200 && d.j.ok === true, JSON.stringify(d.j));
  ok('الإجماليات تتحدث فوراً (85-50=35)', d.j.totals.gold === 35 && d.j.totals.rows === 2, JSON.stringify(d.j.totals));
  const still = await qget(`SELECT COUNT(*) c FROM gifts_log WHERE id=?`, [crown.id]);
  ok('الهدية حُذفت فعلاً من قاعدة البيانات', still.c === 0);

  console.log('\n— الحماية: لا يمكن حذف هدية حساب آخر عبر تمرير معرّف غريب');
  const otherGift = await qget(`SELECT id FROM gifts_log WHERE to_id=?`, [oid]);
  d = await api(tok, `/api/admin/users/${vid}/gifts/${otherGift.id}`, 'DELETE');
  ok('يُرفض حذف سطر لا يخص هذا الحساب (404)', d.s === 404, 'status=' + d.s);
  const otherStill = await qget(`SELECT COUNT(*) c FROM gifts_log WHERE id=?`, [otherGift.id]);
  ok('هدية الحساب الآخر لم تتأثر', otherStill.c === 1);

  console.log('\n— حذف كل الهدايا');
  d = await api(tok, `/api/admin/users/${vid}/gifts`, 'DELETE');
  ok('حذف الكل ينجح', d.s === 200 && d.j.deleted === 2, JSON.stringify(d.j));
  r = await api(tok, `/api/admin/users/${vid}/gifts`);
  ok('لم تعد هناك هدايا', r.j.totals.rows === 0 && r.j.totals.gold === 0, JSON.stringify(r.j.totals));
  const otherLeft = await qget(`SELECT COUNT(*) c FROM gifts_log WHERE to_id=?`, [oid]);
  ok('هدايا الحسابات الأخرى سليمة', otherLeft.c === 1);

  console.log('\n— الصلاحية');
  const uTok = await adminToken(V);
  ok('العضو العادي لا يحصل على رمز إدارة', !uTok, 'tok=' + uTok);
  r = await api('', `/api/admin/users/${vid}/gifts`);
  ok('بدون رمز يُرفض (403)', r.s === 403, 'status=' + r.s);
  r = await api(tok, `/api/admin/users/999999/gifts`);
  ok('حساب غير موجود يُرفض (404)', r.s === 404, 'status=' + r.s);

  await qrun(`DELETE FROM gifts_log WHERE to_id IN (?,?) OR from_id IN (?,?)`, [vid, oid, vid, oid]);
  for (const n of [A, V, O]) {
    const u = await qget(`SELECT id FROM users WHERE username=?`, [n]);
    if (u) await qrun(`DELETE FROM login_history WHERE user_id=?`, [u.id]);
    await qrun(`DELETE FROM users WHERE username=?`, [n]);
  }
  DB.close();
  console.log(`\nالنتيجة: ${passed} نجح / ${failed} فشل`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
