// اختبار خط أنابيب تسجيل المكالمات (رفع → عرض بالسوبر ماستر → حذف → منع غير السوبر ماستر)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const https = require('https');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('/home/user/chat1/node_modules/sqlite3');

const UPLOAD_DIR = '/home/user/chat1/public/uploads/calls';
const PASS = [], FAIL = [];
function check(n, c, x = '') { (c ? PASS : FAIL).push(n); console.log((c ? '  ✅ ' : '  ❌ ') + n + (x ? '  → ' + x : '')); }

function req(method, urlPath, { body, token, adminToken } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const headers = { 'X-Chat-Client': '1' };
    if (body && typeof body === 'object') headers['Content-Type'] = 'application/json';
    if (typeof body === 'string') headers['Content-Type'] = 'application/octet-stream';
    if (token) headers['X-Chat-Token'] = token;
    if (adminToken) headers['x-admin-token'] = adminToken;
    const r = https.request('https://localhost:2083' + urlPath, { method, headers }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(d || '{}') }); } catch (e) { resolve({ status: res.statusCode, raw: d.slice(0, 120) }); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
// رفع multipart يدوي
function upload(urlPath, fields, fileField, fileBuf, fileExt, token) {
  return new Promise((resolve, reject) => {
    const boundary = '----formboundary' + Math.random().toString(36).slice(2);
    const chunks = [];
    for (const [k, v] of Object.entries(fields)) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    }
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="test_rec_${Date.now()}${fileExt}"\r\nContent-Type: video/webm\r\n\r\n`));
    chunks.push(fileBuf);
    chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const body = Buffer.concat(chunks);
    const headers = { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'X-Chat-Client': '1', 'Content-Length': body.length };
    if (token) headers['X-Chat-Token'] = token;
    const r = https.request('https://localhost:2083' + urlPath, { method: 'POST', headers }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(d || '{}') }); } catch (e) { resolve({ status: res.statusCode, raw: d }); } });
    });
    r.on('error', reject);
    r.write(body);
    r.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const db = new sqlite3.Database('/home/user/chat1/chat.db');
  const run = (s, p = []) => new Promise((r, j) => db.run(s, p, e => e ? j(e) : r()));
  const get = (s, p = []) => new Promise((r, j) => db.get(s, p, (e, x) => e ? j(x) : r(x)));

  // تنظيف + إنشاء المستخدمين مباشرة في القاعدة (تفادي حد تسجيلات الـ API)
  await run(`DELETE FROM users WHERE username IN ('rec_tester','rec_master','rec_super')`);
  const bcrypt = require('/home/user/chat1/node_modules/bcryptjs');
  const pw = bcrypt.hashSync('123456', 10);
  await run(`INSERT INTO users (username,password,gender,age,country,bio,registered,balance,rank,membership) VALUES ('rec_tester',?,'boy',25,'jo','',1,100,'user','vip')`, [pw]);
  await run(`INSERT INTO users (username,password,gender,age,country,bio,registered,balance,rank,membership) VALUES ('rec_master',?,'boy',30,'jo','',1,999,'supermaster','vip')`, [pw]);
  await run(`INSERT INTO users (username,password,gender,age,country,bio,registered,balance,rank,membership) VALUES ('rec_super',?,'boy',30,'jo','',1,999,'superadmin','vip')`, [pw]);
  const filesBefore = fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR).filter(f => f.startsWith('test_rec_')) : [];

  console.log('=== 1) الدخول (مستخدم عادي + سوبر ماستر + سوبر أدمن) ===');
  let r = await req('POST', '/api/login', { body: { username: 'rec_tester', password: '123456' } });
  check('دخول المستخدم العادي', r.status === 200 && !!r.json.tab_token);
  const testerToken = r.json.tab_token;

  r = await req('POST', '/api/login', { body: { username: 'rec_master', password: '123456' } });
  const masterAdmin = r.json.admin_access_token;
  check('السوبر ماستر حصل على رمز الإدارة', !!masterAdmin);
  r = await req('POST', '/api/login', { body: { username: 'rec_super', password: '123456' } });
  const superAdmin = r.json.admin_access_token;
  check('السوبر أدمن حصل على رمز الإدارة', !!superAdmin);

  // ملف webm وهمي صغير (رأس webm صالح + بعض البايتات)
  const webmHeader = Buffer.from('1A45DFA34D80000000000000000000000123456789ABCDEF');
  const fakeVideo = Buffer.concat([webmHeader, Buffer.alloc(4000, 7)]);

  console.log('=== 2) رفع تسجيل فيديو ===');
  r = await upload('/api/chat/save-call-recording',
    { sid: '1', sname: 'rec_tester', tid: '2', tname: 'rec_master', dur: '95', ctype: 'video' },
    'audio', fakeVideo, '.webm', testerToken);
  check('الرفع نجح (رد مموه)', r.status === 200 && r.json.ok === true, JSON.stringify(r.json));
  await sleep(300);

  const recs = await new Promise((res, rej) => db.all(`SELECT * FROM call_recordings WHERE caller_name='rec_tester' ORDER BY id DESC LIMIT 1`, (e, rows) => e ? rej(e) : res(rows)));
  check('سُجّل في القاعدة بنوع video', recs.length === 1 && recs[0].call_type === 'video', JSON.stringify(recs[0] || {}));
  check('مسار الفيديو مُخزَّن', !!recs[0] && recs[0].video_path && recs[0].video_path.startsWith('/uploads/calls/'), recs[0] && recs[0].video_path);
  check('مدة المكالمة محفوظة', recs[0] && recs[0].duration === 95, 'dur=' + (recs[0] && recs[0].duration));
  check('الملف موجود على القرص', !!recs[0] && fs.existsSync(path.join('/home/user/chat1/public', recs[0].video_path)));

  console.log('=== 3) عرض التسجيلات ===');
  r = await req('GET', '/api/admin/call-recordings', { adminToken: masterAdmin });
  const myRec = (r.json || []).find(x => x.caller_name === 'rec_tester' && x.call_type === 'video');
  check('السوبر ماستر يرى تسجيل الفيديو', !!myRec, JSON.stringify(myRec || {}).slice(0, 100));

  r = await req('GET', '/api/admin/call-recordings', { adminToken: superAdmin });
  check('السوبر أدمن ممنوع (403)', r.status === 403, 'status=' + r.status);

  console.log('=== 4) حذف التسجيل (ملف + سجل) ===');
  if (myRec) {
    r = await req('DELETE', '/api/admin/call-recordings/' + myRec.id, { adminToken: masterAdmin });
    check('الحذف نجح', r.status === 200 && r.json.ok === true);
    await sleep(200);
    check('الملف حُذف من القرص', !fs.existsSync(path.join('/home/user/chat1/public', myRec.video_path)), myRec.video_path);
  }

  // تنظيف كامل
  await run(`DELETE FROM call_recordings WHERE caller_name='rec_tester'`);
  await run(`DELETE FROM users WHERE username IN ('rec_tester','rec_master','rec_super')`);
  if (fs.existsSync(UPLOAD_DIR)) for (const f of fs.readdirSync(UPLOAD_DIR)) if (f.startsWith('test_rec_') || f.startsWith('rec_')) { try { fs.unlinkSync(path.join(UPLOAD_DIR, f)); } catch (e) {} }
  db.close();

  console.log(`\nالنتيجة: ${PASS.length} نجح / ${FAIL.length} فشل`);
  if (FAIL.length) { console.log('الفاشلة:', FAIL); process.exit(1); }
})().catch(e => { console.error('TEST ERROR:', e); process.exit(1); });
