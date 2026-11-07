const test = require('node:test');
const assert = require('node:assert');
const {
  CALLBACK_PATH,
  normalizeRedirectUri,
  parseRedirectList,
  requestOrigin,
  derivedRedirectUri,
  pickRedirectUri
} = require('../google-redirect');

test('normalizeRedirectUri: يقبل العنوان الصحيح ويتطّبع', () => {
  assert.strictEqual(
    normalizeRedirectUri('https://Soul.Example.com/api/auth/google/callback'),
    'https://soul.example.com/api/auth/google/callback'
  );
  // شرطة مائلة نهائية → سبب شائع جداً لخطأ عدم التطابق
  assert.strictEqual(
    normalizeRedirectUri('https://soul.example.com/api/auth/google/callback/'),
    'https://soul.example.com/api/auth/google/callback'
  );
  // منفذ افتراضي يُلغى تلقائياً
  assert.strictEqual(
    normalizeRedirectUri('https://soul.example.com:443/api/auth/google/callback'),
    'https://soul.example.com/api/auth/google/callback'
  );
  // مسافات حول العنوان
  assert.strictEqual(
    normalizeRedirectUri('  http://localhost:3000/api/auth/google/callback  '),
    'http://localhost:3000/api/auth/google/callback'
  );
  // منفذ غير افتراضي يبقى كما هو (موقع على 2083)
  assert.strictEqual(
    normalizeRedirectUri('https://soul.example.com:2083/api/auth/google/callback'),
    'https://soul.example.com:2083/api/auth/google/callback'
  );
});

test('normalizeRedirectUri: يرفض العناوين غير الصالحة', () => {
  assert.strictEqual(normalizeRedirectUri(''), '');
  assert.strictEqual(normalizeRedirectUri(null), '');
  assert.strictEqual(normalizeRedirectUri('not-a-url'), '');
  assert.strictEqual(normalizeRedirectUri('ftp://x.com/api/auth/google/callback'), '');
  // مسار خاطئ
  assert.strictEqual(normalizeRedirectUri('https://x.com/api/auth/google/redirect'), '');
  assert.strictEqual(normalizeRedirectUri('https://x.com/'), '');
  // بحث أو تجزئة مرفوضة (ليست جزءاً من العنوان المطابق)
  assert.strictEqual(normalizeRedirectUri('https://x.com/api/auth/google/callback?a=1'), '');
  assert.strictEqual(normalizeRedirectUri('https://x.com/api/auth/google/callback#x'), '');
  // مصادقة داخل الرابط مرفوضة
  assert.strictEqual(normalizeRedirectUri('https://u:p@x.com/api/auth/google/callback'), '');
});

test('parseRedirectList: فاصلة وسطور متعددة مع إزالة التكرار', () => {
  const list = parseRedirectList([
    'https://soul.example.com/api/auth/google/callback',
    'http://192.168.1.10:3000/api/auth/google/callback/',
    'https://soul.example.com/api/auth/google/callback', // تكرار
    ' garbage ',
    'https://soul.example.com:2083/api/auth/google/callback'
  ].join('\n'));
  assert.deepStrictEqual(list, [
    'https://soul.example.com/api/auth/google/callback',
    'http://192.168.1.10:3000/api/auth/google/callback',
    'https://soul.example.com:2083/api/auth/google/callback'
  ]);
  assert.deepStrictEqual(parseRedirectList(''), []);
  assert.deepStrictEqual(parseRedirectList('a,b,c'), []);
});

test('requestOrigin: يدعم x-forwarded-* خلف البروكسي', () => {
  // بدون بروكسي
  assert.strictEqual(
    requestOrigin({ headers: { host: 'localhost:3000' }, protocol: 'http' }),
    'http://localhost:3000'
  );
  // خلف nginx/Cloudflare: https عام لكن الخادم يتلقى http داخلياً
  assert.strictEqual(
    requestOrigin({
      headers: { host: 'soul.example.com', 'x-forwarded-proto': 'https' },
      protocol: 'http'
    }),
    'https://soul.example.com'
  );
  // بروكسي يعيد كتابة المضيف
  assert.strictEqual(
    requestOrigin({
      headers: { host: '127.0.0.1:3000', 'x-forwarded-host': 'soul.example.com', 'x-forwarded-proto': 'https' },
      protocol: 'http'
    }),
    'https://soul.example.com'
  );
  // قيم مفصولة بفواصل (أول قيمة فقط)
  assert.strictEqual(
    requestOrigin({ headers: { host: 'a.com', 'x-forwarded-proto': 'https, http' } }),
    'https://a.com'
  );
  // مضيف مشبوه (مسار داخل الترويسة) يُرفض
  assert.strictEqual(requestOrigin({ headers: { host: 'evil.com/api?x=1' } }), '');
});

test('derivedRedirectUri: يبني العنوان من المنظور', () => {
  assert.strictEqual(
    derivedRedirectUri({ headers: { host: 'soul.example.com', 'x-forwarded-proto': 'https' } }),
    'https://soul.example.com' + CALLBACK_PATH
  );
});

test('pickRedirectUri: ترتيب الأولويات', () => {
  const here = { headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http' } };
  const prod = { headers: { host: 'soul.example.com', 'x-forwarded-proto': 'https' } };

  // 1) لا إعداد → اشتقاق من الطلب
  assert.strictEqual(pickRedirectUri(here, { redirectUris: [] }), 'http://localhost:3000' + CALLBACK_PATH);

  // 2) إعداد متعدد ومطابق للزيارة الحالية → يُختار المطابق
  const multi = {
    redirectUris: [
      'https://soul.example.com' + CALLBACK_PATH,
      'http://localhost:3000' + CALLBACK_PATH
    ]
  };
  assert.strictEqual(pickRedirectUri(here, multi), 'http://localhost:3000' + CALLBACK_PATH);
  assert.strictEqual(pickRedirectUri(prod, multi), 'https://soul.example.com' + CALLBACK_PATH);

  // 3) إعداد لا يطابق عنوان الزيارة → يُستخدم المُهيّأ (المسجّل في Google)
  const onlyProd = { redirectUris: ['https://soul.example.com' + CALLBACK_PATH] };
  assert.strictEqual(pickRedirectUri(here, onlyProd), 'https://soul.example.com' + CALLBACK_PATH);

  // 4) إعداد غير صالح يُتجاهل ويعود الاشتقاق
  assert.strictEqual(
    pickRedirectUri(here, { redirectUris: ['', 'not-valid'] }),
    'http://localhost:3000' + CALLBACK_PATH
  );
});
