const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProxyStore, parseProxyLine, parseProxyList, publicLabel } = require('../yt-proxies');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ytpx-'));

test('parseProxyLine يفهم الصيغ الشائعة', () => {
  assert.equal(parseProxyLine('1.2.3.4:8080'), 'http://1.2.3.4:8080');
  assert.equal(parseProxyLine('1.2.3.4:8080:user:pa:ss'), 'http://user:pa%3Ass@1.2.3.4:8080');
  assert.equal(parseProxyLine('user:pass@proxy.example.com:3128'), 'http://user:pass@proxy.example.com:3128');
  assert.equal(parseProxyLine('socks5://u:p@10.0.0.1:1080'), 'socks5://u:p@10.0.0.1:1080');
  assert.equal(parseProxyLine('HTTPS://Host.Example.com:443/'), 'https://host.example.com:443');
});

test('parseProxyLine يرفض المدخلات الخاطئة', () => {
  assert.throws(() => parseProxyLine('hello'), /الصيغة/);
  assert.throws(() => parseProxyLine('1.2.3.4:99999'), /المنفذ/);
  assert.throws(() => parseProxyLine('ftp://1.2.3.4:21'), /غير مدعوم/);
  assert.throws(() => parseProxyLine('1.2.3.4:80 extra'), /مسافات/);
});

test('parseProxyList يتجاهل المكرر والتعليقات ولا يكشف كلمة المرور في الأخطاء', () => {
  const r = parseProxyList('# قائمة\n1.1.1.1:80\n1.1.1.1:80\nuser:secretpass@bad host:1\nnope');
  assert.deepEqual(r.valid, ['http://1.1.1.1:80']);
  assert.equal(r.invalid.length, 2);
  assert.ok(!JSON.stringify(r.invalid).includes('secretpass'));
});

test('describe لا يُعيد بيانات الدخول أبداً', () => {
  const root = tmp();
  const st = createProxyStore(root);
  st.add('user:topsecret@9.9.9.9:8000');
  const d = st.describe();
  assert.equal(d.proxies[0].label, 'http://9.9.9.9:8000');
  assert.equal(d.proxies[0].auth, true);
  assert.ok(!JSON.stringify(d).includes('topsecret'));
  assert.equal(publicLabel('socks5://a:b@h.com:1'), 'socks5://h.com:1');
});

test('الحفظ على القرص بصلاحيات 600 ويُستعاد بعد إعادة التشغيل', () => {
  const root = tmp();
  const a = createProxyStore(root);
  a.add('1.1.1.1:80\n2.2.2.2:80');
  a.setMode({ enabled: true, fallbackDirect: true });
  const f = path.join(root, 'data', 'yt-proxies.json');
  if (process.platform !== 'win32') assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  const b = createProxyStore(root);
  assert.equal(b.isActive(), true);
  assert.equal(b.allowDirect(), true);
  assert.equal(b.describe().count, 2);
});

test('التدوير: كل استدعاء يبدأ ببروكسي مختلف', () => {
  const st = createProxyStore(tmp());
  st.add('1.1.1.1:80\n2.2.2.2:80\n3.3.3.3:80');
  st.setMode({ enabled: true });
  const firsts = [st.candidates(3)[0], st.candidates(3)[0], st.candidates(3)[0], st.candidates(3)[0]];
  assert.deepEqual(firsts, ['http://1.1.1.1:80', 'http://2.2.2.2:80', 'http://3.3.3.3:80', 'http://1.1.1.1:80']);
});

test('البروكسي المحجوب (bot) يُوقَف مؤقتاً ثم يعود عند النجاح/فكّ الإيقاف', () => {
  let t = 1000000;
  const st = createProxyStore(tmp(), { now: () => t });
  st.add('1.1.1.1:80\n2.2.2.2:80');
  st.setMode({ enabled: true });
  st.report('http://1.1.1.1:80', false, { bot: true });
  for (let i = 0; i < 4; i++) assert.deepEqual(st.candidates(5), ['http://2.2.2.2:80']);
  t += 11 * 60 * 1000;                       // انتهى الإيقاف المؤقت
  assert.equal(st.candidates(5).length, 2);
  st.report('http://2.2.2.2:80', false, { bot: true });
  st.report('http://1.1.1.1:80', false, { bot: true });
  assert.equal(st.candidates(5).length, 1, 'إن كانت كلها موقوفة نُرجع الأقرب انتهاءً بدل قائمة فارغة');
});

test('فشل الشبكة المتكرر يوقف البروكسي بعد 3 مرات فقط', () => {
  const st = createProxyStore(tmp());
  st.add('1.1.1.1:80\n2.2.2.2:80'); st.setMode({ enabled: true });
  st.report('http://1.1.1.1:80', false, { net: true });
  st.report('http://1.1.1.1:80', false, { net: true });
  assert.equal(st.describe().proxies[0].cooling, false);
  st.report('http://1.1.1.1:80', false, { net: true });
  assert.equal(st.describe().proxies[0].cooling, true);
  st.report('http://1.1.1.1:80', true);
  assert.equal(st.describe().proxies[0].cooling, false);
});

test('isActive يتطلب التفعيل وبروكسياً مفعّلاً', () => {
  const st = createProxyStore(tmp());
  st.setMode({ enabled: true });
  assert.equal(st.isActive(), false);
  st.add('1.1.1.1:80');
  assert.equal(st.isActive(), true);
  const id = st.describe().proxies[0].id;
  st.setEnabled(id, false);
  assert.equal(st.isActive(), false);
  assert.equal(st.next(), '');
});
