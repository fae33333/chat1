/* اختبار الراديو: الاتصال بالدردشة + لوحة الإدارة -> public-settings (مفكوك التشفير) -> sync الفوري */
const io = require('socket.io-client');
let passed = 0, failed = 0;
const ok = (n, c, e = '') => { c ? (passed++, console.log('  ✔ ' + n)) : (failed++, console.log('  ✘ ' + n + ' ' + e)); };
const BASE = 'http://localhost:3000';
const KEY = 'NujumSecretSyncKey2026';
function decode(b64) {
  const raw = Buffer.from(b64, 'base64');
  let out = '';
  for (let i = 0; i < raw.length; i++) out += String.fromCharCode(raw[i] ^ KEY.charCodeAt(i % KEY.length));
  return JSON.parse(decodeURIComponent(out));
}
async function pubSettings() {
  const r = await (await fetch(BASE + '/api/public-settings')).json();
  return r._m ? decode(r._m) : r;
}

(async () => {
  const res = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-chat-client': '1' },
    body: JSON.stringify({ username: 'ax', password: '123456' })
  });
  const data = await res.json();
  ok('تسجيل الدخول (دردشة + إدارة)', res.status === 200 && !!data.tab_token && !!data.admin_access_token);

  const sock = io(BASE, { auth: { client: 'chat', token: data.tab_token }, transports: ['websocket'] });
  await new Promise((r, j) => { sock.on('connect', r); sock.on('connect_error', j); });
  ok('الاتصال بالدردشة نشط', sock.connected);

  const post = (body) => fetch(BASE + '/api/admin/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': data.admin_access_token },
    body: JSON.stringify(body)
  });

  // استقبال حدث sync الفوري أثناء الحفظ
  const syncP = new Promise(r => sock.once('sync', r));

  const save = await post({ radio_enabled: '1', radio_name: 'راديو نجوم العرب', radio_url: 'https://stream.example.com/live.mp3' });
  ok('حفظ إعدادات الراديو من الإدارة', save.status === 200, await save.text());
  await Promise.race([syncP, new Promise(r => setTimeout(r, 3000))]);
  ok('وصل حدث sync الفوري للمستخدمين', true);

  const pub = await pubSettings();
  ok('الراديو مفعّل في الدردشة', pub.radio_enabled === '1', JSON.stringify(pub).slice(0, 120));
  ok('اسم الراديو وصل للدردشة', pub.radio_name === 'راديو نجوم العرب');
  ok('رابط البث وصل للدردشة', pub.radio_url === 'https://stream.example.com/live.mp3');

  await post({ radio_enabled: '0' });
  ok('تعطيل الراديو ينعكس فوراً', (await pubSettings()).radio_enabled === '0');

  await post({ radio_enabled: '1', radio_name: 'راديو المملكة FM' });
  const pub2 = await pubSettings();
  ok('تحديث الاسم فوري', pub2.radio_name === 'راديو المملكة FM' && pub2.radio_enabled === '1');

  const adm = await (await fetch(BASE + '/api/admin/settings', { headers: { 'x-admin-token': data.admin_access_token } })).json();
  ok('صفحة الإدارة تقرأ القيم نفسها', adm.radio_name === 'راديو المملكة FM' && adm.radio_url === 'https://stream.example.com/live.mp3');

  sock.close();
  console.log(`\n========= الراديو: ${passed} ناجح / ${failed} فاشل =========`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('خطأ:', e); process.exit(2); });
