// =====================================================
//  اختبار: زحف محركات البحث عبر بوابة الحماية + إزالة قالب تثبيت الرفرش
//  - يعيد إنتاج سبب فشل «أرشفة مسار» في أدوات مشرفي المواقع:
//    بوابة VPN/استضافة كانت تحجب Googlebot نفسه (نطاقات Google = hosting)
//    وقائمة المتصفحات المسموحة تعتبره «unknown» → 403 + noindex.
//  - يتأكد أن الروبوت الموثوق (rDNS مطابق) يمر، والمنتحل يُحجب كالمعتاد.
// =====================================================
process.env.PORT = '2085';
process.env.HTTPS_KEY = '/nonexistent-test-key';   // تشغيل HTTP للاختبار فقط
process.env.HTTPS_CERT = '/nonexistent-test-cert';

const path = require('path');
const ROOT = __dirname;

// --- Stub DNS: 66.249.66.1 فقط هو Googlebot الحقيقي ---
const dns = require('dns');
dns.promises.reverse = async (ip) => {
  if (ip === '66.249.66.1') return ['crawl-66-249-66-1.googlebot.com'];
  return ['evil.example.com'];
};
dns.promises.resolve4 = async (host) => {
  if (host === 'crawl-66-249-66-1.googlebot.com') return ['66.249.66.1'];
  return ['9.9.9.9'];
};

// --- Stub لخدمات فحص IP الخارجية: Google Cloud يظهر كاستضافة ---
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('ip-api.com/json/66.249.66.1')) {
    return { ok: true, json: async () => ({ status: 'success', proxy: false, hosting: true, as: 'AS15169 Google LLC hosting' }) };
  }
  if (u.includes('ip-api.com/json/127.0.0.1')) {
    return { ok: true, json: async () => ({ status: 'success', proxy: false, hosting: false, as: 'AS0 Localhost' }) };
  }
  return { ok: false, json: async () => ({}) };
};

const sqlite3 = require(path.join(ROOT, 'node_modules/sqlite3'));
const DB = new sqlite3.Database(path.join(ROOT, 'chat.db'));
const qGet = (s, p = []) => new Promise((r, j) => DB.get(s, p, (e, x) => e ? j(e) : r(x)));
const qRun = (s, p = []) => new Promise((r, j) => DB.run(s, p, e => e ? j(e) : r()));
const BASE = 'http://127.0.0.1:2085';
const GOOGLEBOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const GOOGLE_INSPECTION_UA = 'Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)';
const CHROME_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const SLUG = 'zztestseo1';
let passed = 0, failed = 0;
const ok = (n, c, x = '') => { c ? (passed++, console.log('  ✔ ' + n)) : (failed++, console.log('  ✘ ' + n + ' ' + x)); };

(async () => {
  // حفظ إعدادات البوابة الحالية ثم تفعيلها بأقصى صرامة
  const keep = {};
  for (const k of ['allowed_browsers', 'block_vpn_proxy', 'vpn_proxy_check', 'vpn_proxy_block_hosting']) {
    keep[k] = (await qGet(`SELECT value FROM settings WHERE key=?`, k))?.value;
  }
  const set = async (k, v) => qRun(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [k, v]);
  await set('allowed_browsers', 'chrome,firefox,safari,edge');
  await set('block_vpn_proxy', '1');
  await set('vpn_proxy_check', 'both');
  await set('vpn_proxy_block_hosting', '1');
  await qRun(`DELETE FROM seo_pages WHERE slug=?`, [SLUG]);
  await qRun(`INSERT INTO seo_pages (slug,title,description,active,updated_at) VALUES (?,?,?,1,strftime('%s','now'))`,
    [SLUG, 'غرفة اختبار للأرشفة', 'وصف اختباري لمسار الأرشفة']);

  await new Promise((r) => setTimeout(r, 1200)); // انتظار تزامن ACCESS_SETTINGS (تحديث دوري)

  require('./server.js');
  await new Promise(r => setTimeout(r, 1500));

  const get = async (p, ua, xff) => {
    const headers = { 'user-agent': ua };
    if (xff) headers['x-forwarded-for'] = xff;
    const res = await realFetch(BASE + p, { headers, redirect: 'manual' });
    const body = await res.text();
    return { status: res.status, body };
  };

  console.log('— المسار /' + SLUG + ' أمام محركات البحث');
  let r = await get('/' + SLUG, GOOGLEBOT_UA, '66.249.66.1');
  ok('Googlebot موثوق من نطاق جوجل → 200', r.status === 200, 'status=' + r.status);
  ok('صفحة المسار قابلة للفهرسة (index, follow)', r.body.includes('content="index, follow'), r.body.slice(0, 150));
  ok('المحتوى الفريد يُخدَم للمحرك (seo-only)', r.body.includes('seoLandingContent'));
  ok('canonical يشير للمسار الصحيح', r.body.includes('rel="canonical"') && r.body.includes('/' + SLUG));
  r = await get('/' + SLUG, GOOGLE_INSPECTION_UA, '66.249.66.1');
  ok('Google Inspection Tool → 200 بلا حظر', r.status === 200, 'status=' + r.status);

  console.log('— الروبوت المنتحل لا يُمرَّر');
  r = await get('/' + SLUG, GOOGLEBOT_UA, '1.2.3.4');
  ok('UA روبوت بـ IP لا يطابق rDNS → 403', r.status === 403, 'status=' + r.status);
  r = await get('/' + SLUG, 'Mozilla/5.0 (compatible; FakeBot-Googlebot/1.0)', '1.2.3.4');
  ok('UA منتحل باسم bot → 403', r.status === 403, 'status=' + r.status);

  console.log('— المستخدمون العاديون لم يتأثروا');
  r = await get('/' + SLUG, CHROME_UA);
  ok('متصفح كروم من IP غير مضيّف → 200', r.status === 200, 'status=' + r.status);
  r = await get('/' + SLUG, 'curl/8.5.0');
  ok('متصفح غير مسموح → 403 (البوابة ما زالت تعمل)', r.status === 403, 'status=' + r.status);
  r = await get('/' + SLUG, CHROME_UA, '66.249.66.1');
  ok('كروم من IP استضافة (VPN) → 403 (المنع ما زال يعمل)', r.status === 403, 'status=' + r.status);

  console.log('— الصفحة الرئيسية وrobots/sitemap');
  r = await get('/', GOOGLEBOT_UA, '66.249.66.1');
  ok('الرئيسية / لـ Googlebot → 200', r.status === 200, 'status=' + r.status);
  ok('الرئيسية بلا وسم noindex', !r.body.includes('noindex'));
  r = await get('/robots.txt', GOOGLEBOT_UA);
  ok('robots.txt → 200 ويرشد للخريطة', r.status === 200 && r.body.includes('Sitemap:'), r.body.slice(0, 120));
  ok('robots.txt يسمح بكل شيء عدا الإدارة/API', r.body.includes('Allow: /') && r.body.includes('Disallow: /api/'));
  r = await get('/sitemap.xml', GOOGLEBOT_UA);
  ok('sitemap.xml يضم المسار الجديد تلقائياً', r.status === 200 && r.body.includes('/' + SLUG), r.body.slice(0, 160));

  console.log('— إزالة قالب تثبيت الرفرش (refreshExitOv)');
  const home = await get('/', CHROME_UA);
  ok('صفحة الدردشة لا تتضمن overlay الرفرش', !home.body.includes('refreshExitOv'));
  const fsx = require('fs');
  const cssTxt = fsx.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf-8');
  ok('CSS نظيف من قواعد mode-refresh', !cssTxt.includes('mode-refresh'));
  const appJs = fsx.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf-8');
  ok('app.js لم يعد يعترض F5/العصر+R', !appJs.includes('isRefreshKey') && !appJs.includes('showRefreshExitBlock'));
  ok('app.js أزال قالب الرفرش بكل اعتراضاته (Go/Block/isRefreshKey)', !appJs.includes('refreshExitGo') && !appJs.includes('showRefreshExitBlock') && !appJs.includes('isRefreshKey') && !appJs.includes('NAV_API_OK'));
  ok('تنظيف الوسائط عند الإغلاق ما زال موجوداً (pagehide)', appJs.includes('silentCleanExitOnUnload') && appJs.includes("addEventListener('pagehide'"));

  // استعادة الإعدادات وحذف بيانات الاختبار
  for (const [k, v] of Object.entries(keep)) {
    if (v === undefined) await qRun(`DELETE FROM settings WHERE key=?`, [k]);
    else await qRun(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [k, v]);
  }
  await qRun(`DELETE FROM seo_pages WHERE slug=?`, [SLUG]);
  await qRun(`DELETE FROM seo_pages WHERE slug=?`, [SLUG]);
  DB.close();
  console.log(`\nالنتيجة: ${passed} نجح / ${failed} فشل`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('فشل الاختبار:', e); process.exit(2); });
