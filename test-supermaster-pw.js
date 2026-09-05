// =====================================================
//  اختبار: كلمة مرور supermaster = الاسم + نافذة تأكيد التحديث (beforeunload)
// =====================================================
process.env.PORT = '2095';
process.env.HTTPS_KEY = '/nonexistent-test-key';
process.env.HTTPS_CERT = '/nonexistent-test-cert';

const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

// لا نريد شبكات خارجية في هذا الاختبار (بصفتنا محلياً تفشل fail-open أصلاً)
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const BASE = 'http://127.0.0.1:2095';
let passed = 0, failed = 0;
const ok = (n, c, x = '') => { c ? (passed++, console.log('  ✔ ' + n)) : (failed++, console.log('  ✘ ' + n + ' ' + x)); };

(async () => {
  console.log('— تسجيل دخول supermaster بكلمة = الاسم');
  require('./server.js');
  await new Promise(r => setTimeout(r, 1500));

  const login = async (username, password) => {
    const res = await realFetch(BASE + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-chat-client': '1' },
      body: JSON.stringify({ username, password })
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };

  let r = await login('supermaster', 'supermaster');
  ok('supermaster / supermaster → 200 + توكن', r.status === 200 && !!r.json.tab_token, JSON.stringify(r.json).slice(0, 140));
  r = await login('supermaster', '123456');
  ok('الكلمة القديمة 123456 مرفوضة', r.status === 400 && /غير صحيحة/.test(r.json.error || ''), JSON.stringify(r.json).slice(0, 140));
  r = await login('ax', '123456');
  ok('حساب ax لم يتأثر (123456 ما زالت تعمل)', r.status === 200 && !!r.json.tab_token, JSON.stringify(r.json).slice(0, 140));

  console.log('— البذر في database.js (منشآت جديدة/ملك مفقود)');
  const seed = fs.readFileSync(path.join(ROOT, 'database.js'), 'utf-8');
  ok("hashSync('supermaster') يُستخدم للمالك", seed.includes("bcrypt.hashSync('supermaster', 10)"));
  ok('ax ما زال 123456 في البذر', seed.includes("bcrypt.hashSync('123456', 10)"));
  ok('رسالة التثبيت الجديد تعرض supermaster/supermaster', seed.includes('supermaster/supermaster'));

  console.log('— نافذة تأكيد المغادرة عند التحديث (app.js)');
  const app = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf-8');
  ok('مستمع beforeunload يعرض نافذة المتصفح الأصلية',
    /beforeunload[\s\S]{0,400}e\.preventDefault\(\);[\s\S]{0,120}e\.returnValue\s*=\s*''/.test(app));
  ok('مغير تجاوز الخروج البرمجي موجود ومُهيّأ', app.includes('let REFRESH_LEAVING = false;') && (app.match(/REFRESH_LEAVING = true;/g) || []).length === 3, 'count=' + (app.match(/REFRESH_LEAVING = true;/g) || []).length);
  ok('زر إعادة التحقق بعد فك الحظر يعيد التحميل بلا سؤال', app.includes("if (!state.banned) { REFRESH_LEAVING = true; return location.reload(); }"));
  ok('زر «العودة لتسجيل الدخول» يعيد التحميل بلا سؤال', app.includes("onclick = () => { REFRESH_LEAVING = true; location.reload(); }"));
  ok('خروج DevTools الطارئ لا تُعطّله النافذة', /NUJUM_EMERGENCY_EXIT[\s\S]{0,200}REFRESH_LEAVING = true;/.test(app));
  ok('قالب refreshExitOv لم يعد موجوداً إطلاقاً', !app.includes('refreshExitOv') && !fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf-8').includes('refreshExitOv'));

  console.log(`\nالنتيجة: ${passed} نجح / ${failed} فشل`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('فشل الاختبار:', e); process.exit(2); });
