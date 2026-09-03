// اختبار نظام التسكير: الهدايا المتكررة (خصم جزئي) + تحقق رقم الحساب
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const https = require('https');
const sqlite3 = require('/home/user/chat1/node_modules/sqlite3');
const bcrypt = require('/home/user/chat1/node_modules/bcryptjs');

function req(method, path, { body, token, adminToken } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'X-Chat-Client': '1' };
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers['X-Chat-Token'] = token;
    if (adminToken) headers['x-admin-token'] = adminToken;
    const r = https.request('https://localhost:2083' + path, { method, headers }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(d || '{}') }); }
        catch (e) { resolve({ status: res.statusCode, raw: d }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const PASS = [], FAIL = [];
function check(name, cond, extra = '') {
  (cond ? PASS : FAIL).push(name);
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra ? '  → ' + extra : ''));
}

(async () => {
  const db = new sqlite3.Database('/home/user/chat1/chat.db');
  const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, e => e ? rej(e) : res()));
  const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));
  const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));

  console.log('=== 1) بيئة: حد 100 ذهب ← 5$ ===');
  await run(`DELETE FROM gifts_log WHERE to_name IN ('TestGirl')`);
  await run(`DELETE FROM gift_cashouts WHERE username IN ('test_girl_2','test_admin_2')`);
  await run(`DELETE FROM users WHERE username IN ('test_girl_2','test_admin_2')`);
  for (const [k, v] of [['cashout_enabled', '1'], ['cashout_gold_min', '100'], ['cashout_usd_amount', '5'], ['cashout_source_account', '4263 8890 1234 5678']])
    await run(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [k, v]);

  console.log('=== 2) فتاة لديها 100 هدية متطابقة (5 ذهب = 500 ذهب) + سطر بكمية 10 ===');
  // إنشاء مباشرة في القاعدة (تفادي حد تسجيلات الـ API) ثم دخول للحصول على رمز الجلسة
  const pw = bcrypt.hashSync('123456', 10);
  await run(`INSERT INTO users (username,password,gender,age,country,bio,registered,balance,email_verified) VALUES ('test_girl_2',?,'girl',25,'jo','',1,100,1)`, [pw]);
  let r = await req('POST', '/api/login', { body: { username: 'test_girl_2', password: '123456' } });
  const girlToken = r.json.tab_token;
  check('دخول الفتاة', r.status === 200 && !!girlToken, JSON.stringify({ status: r.status, err: r.json.error }));
  const gu = (await get(`SELECT id FROM users WHERE username='test_girl_2'`)).id;
  // 100 سطور: وردة ×5 ذهب
  for (let i = 0; i < 100; i++)
    await run(`INSERT INTO gifts_log (from_id,from_name,to_id,to_name,gift_name,gift_img,price,qty) VALUES (1,'t',?,'TestGirl','وردة متكررة','🌹',5,1)`, [gu]);
  // سطر واحد بكمية 10 (هدية سيارة 25 ذهب)
  await run(`INSERT INTO gifts_log (from_id,from_name,to_id,to_name,gift_name,gift_img,price,qty) VALUES (1,'t',?,'TestGirl','سيارة','🚗',25,10)`, [gu]);

  r = await req('GET', '/api/gift-cashout', { token: girlToken });
  check('مجموع الذهب 750 (500 ورد + 250 سيارة)', r.json.gold_total === 750, 'gold=' + r.json.gold_total);
  const groupRose = (r.json.gift_groups || []).find(g => g.name === 'وردة متكررة');
  check('الورد مجمعة: 100 هدية × 5 = 500', !!groupRose && groupRose.qty === 100 && groupRose.gold === 500, JSON.stringify(groupRose || {}).slice(0, 80));
  const groupCar = (r.json.gift_groups || []).find(g => g.name === 'سيارة');
  check('السيارة مجمعة: 10 × 25 = 250', !!groupCar && groupCar.qty === 10 && groupCar.gold === 250);

  console.log('=== 3) اختيار 20 وردة فقط (100 ذهب) — الباقي 80 وردة يبقى ===');
  const roseRows = groupRose.rows.slice(0, 20);
  r = await req('POST', '/api/gift-cashout', {
    token: girlToken,
    body: { account_number: '4263889012345678', account_name: 'Test Girl', selection: roseRows.map(row => ({ row_id: row.id, qty: 1 })) }
  });
  check('الطلب مقبول: 20 هدية / 100 ذهب / 5$', r.status === 200 && r.json.ok && r.json.count === 20 && r.json.gold === 100 && r.json.usd === 5, JSON.stringify(r.json));

  console.log('=== 4) اتمام التحويل → يخصم 20 وردة فقط وتبقى 80 ===');
  await run(`INSERT INTO users (username,password,gender,age,country,bio,registered,balance,rank,email_verified) VALUES ('test_admin_2',?,'boy',30,'jo','',1,500,'superadmin',1)`, [pw]);
  const adminToken = (await req('POST', '/api/login', { body: { username: 'test_admin_2', password: '123456' } })).json.admin_access_token;
  const list = (await req('GET', '/api/admin/gift-cashouts', { adminToken })).json.list || [];
  const myReq = list.find(x => x.username === 'test_girl_2' && x.status === 'pending');
  check('الطلب يظهر للإدارة بتفاصيل الاختيار', !!myReq && myReq.gifts_count === 20 && myReq.gold_total === 100 && !!myReq.selection_json);
  r = await req('POST', '/api/admin/gift-cashout/' + myReq.id + '/complete', { adminToken });
  check('اكتمل (20 محذوفة)', r.status === 200 && r.json.deleted === 20, JSON.stringify(r.json));
  let roses = await get(`SELECT COUNT(*) c, COALESCE(SUM(price*qty),0) g FROM gifts_log WHERE to_id=? AND gift_name='وردة متكررة'`, [gu]);
  check('بقيت 80 وردة (400 ذهب)', roses.c === 80 && roses.g === 400, `rows=${roses.c} gold=${roses.g}`);
  let cars = await get(`SELECT COALESCE(SUM(qty),0) q FROM gifts_log WHERE to_id=? AND gift_name='سيارة'`, [gu]);
  check('السيارات لم تُمس (10)', cars.q === 10, 'qty=' + cars.q);
  r = await req('GET', '/api/gift-cashout', { token: girlToken });
  check('المجموع الآن 650 (400+250)', r.json.gold_total === 650, 'gold=' + r.json.gold_total);

  console.log('=== 5) خصم جزئي من سطر بكمية 10: اختيار 8 سيارات (200 ذهب) ===');
  const carRow = (await get(`SELECT id, qty FROM gifts_log WHERE to_id=? AND gift_name='سيارة'`, [gu]));
  r = await req('POST', '/api/gift-cashout', {
    token: girlToken,
    body: { account_number: '9876543210', account_name: 'TG', selection: [{ row_id: carRow.id, qty: 8 }] }
  });
  check('اختيار 8 من 10 سيارات (200 ذهب = 10$)', r.status === 200 && r.json.count === 8 && r.json.gold === 200 && r.json.usd === 10, JSON.stringify(r.json));
  const list2 = (await req('GET', '/api/admin/gift-cashouts', { adminToken })).json.list || [];
  const req2 = list2.find(x => x.username === 'test_girl_2' && x.status === 'pending');
  r = await req('POST', '/api/admin/gift-cashout/' + req2.id + '/complete', { adminToken });
  check('اكتمل (8 محذوفة من السطر، 10$ محفوظة)', r.status === 200 && r.json.deleted === 8 && r.json.usd === 10, JSON.stringify(r.json));
  let carsAfter = await get(`SELECT qty FROM gifts_log WHERE to_id=? AND gift_name='سيارة'`, [gu]);
  check('بقيت 2 سيارة في السطر نفسه (qty=2)', carsAfter.qty === 2, 'qty=' + carsAfter.qty);

  console.log('=== 6) تناسُب المبلغ مع الكمية: 80 وردة (400 ذهب) = 20$ + قصّ الكمية ===');
  const roseRowsAll = (await req('GET', '/api/gift-cashout', { token: girlToken })).json.gift_groups.find(g => g.name === 'وردة متكررة').rows;
  r = await req('POST', '/api/gift-cashout', {
    token: girlToken,
    body: { account_number: '123456789012', account_name: 'TG', selection: roseRowsAll.slice(0, 99).map(row => ({ row_id: row.id, qty: 1 })) }
  });
  check('اختيار 99 (المتاح 80) → 80 وردة = 400 ذهب = 20$', r.status === 200 && r.json.count === 80 && r.json.gold === 400 && r.json.usd === 20, JSON.stringify(r.json));
  const list3 = (await req('GET', '/api/admin/gift-cashouts', { adminToken })).json.list || [];
  const req3 = list3.find(x => x.username === 'test_girl_2' && x.status === 'pending');
  r = await req('POST', '/api/admin/gift-cashout/' + req3.id + '/reject', { adminToken, body: { note: 'اختبار' } });
  check('رفض (الهدايا لم تُحذف)', r.status === 200);

  console.log('=== 7) تحقق رقم الحساب المستلم ===');
  const rose20 = roseRowsAll.slice(0, 20);
  r = await req('POST', '/api/gift-cashout', { token: girlToken, body: { account_number: '12-AB', account_name: 'X', selection: rose20.map(row => ({ row_id: row.id, qty: 1 })) } });
  check('حساب بأحرف → رفض', r.status === 400 && /8 إلى 19/.test(r.json.error || ''), r.json.error);
  r = await req('POST', '/api/gift-cashout', { token: girlToken, body: { account_number: '12345', account_name: 'X', selection: rose20.map(row => ({ row_id: row.id, qty: 1 })) } });
  check('حساب قصير (5 أرقام) → رفض', r.status === 400, r.json.error);
  r = await req('POST', '/api/gift-cashout', { token: girlToken, body: { account_number: '123456789012', account_name: 'X', selection: rose20.map(row => ({ row_id: row.id, qty: 1 })) } });
  check('حساب صالح + 20 وردة (100 ذهب) → مقبول بـ 5$', r.status === 200 && r.json.gold === 100 && r.json.usd === 5, JSON.stringify(r.json));
  const list4 = (await req('GET', '/api/admin/gift-cashouts', { adminToken })).json.list || [];
  const req4 = list4.find(x => x.username === 'test_girl_2' && x.status === 'pending');
  r = await req('POST', '/api/admin/gift-cashout/' + req4.id + '/reject', { adminToken, body: { note: 'اختبار' } });
  check('رفض الطلب الأخير', r.status === 200);

  console.log('=== 8) أقل من الحد الأدنى: 2 سيارة (50 ذهب) → رفض ===');
  r = await req('POST', '/api/gift-cashout', { token: girlToken, body: { account_number: '123456789012', account_name: 'X', selection: [{ row_id: carRow.id, qty: 2 }] } });
  check('50 ذهب < 100 → رفض', r.status === 400 && /أقل من/.test(r.json.error || ''), r.json.error);

  // تنظيف
  await run(`DELETE FROM gifts_log WHERE to_name='TestGirl'`);
  await run(`DELETE FROM gift_cashouts WHERE username IN ('test_girl_2','test_admin_2')`);
  await run(`DELETE FROM users WHERE username IN ('test_girl_2','test_admin_2')`);
  db.close();
  console.log(`\nالنتيجة: ${PASS.length} نجح / ${FAIL.length} فشل`);
  if (FAIL.length) { console.log('الفاشلة:', FAIL); process.exit(1); }
})().catch(e => { console.error('TEST ERROR:', e); process.exit(1); });
