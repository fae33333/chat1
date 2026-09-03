// اختبار مرئي حقيقي: بانر الدخول الملكي يظهر فوق كل شيء وباقي المشهد بالخلفية
const { chromium } = require('/home/user/chat1/node_modules/playwright-core');
const sqlite3 = require('/home/user/chat1/node_modules/sqlite3');
const bcrypt = require('/home/user/chat1/node_modules/bcryptjs');
const BASE = 'https://localhost:2083';
const DB = new sqlite3.Database('/home/user/chat1/chat.db');
const qrun = (s, p = []) => new Promise((r, j) => DB.run(s, p, e => e ? j(e) : r()));
const qget = (s, p = []) => new Promise((r, j) => DB.get(s, p, (e, x) => e ? j(e) : r(x)));
let passed = 0, failed = 0;
const ok = (n, c, x = '') => { c ? (passed++, console.log('  ✔ ' + n)) : (failed++, console.log('  ✘ ' + n + ' ' + x)); };

(async () => {
  const NAME = 'rbUser';
  await qrun(`DELETE FROM users WHERE username=?`, [NAME]);
  await qrun(`INSERT INTO users (username,password,email,email_verified,gender,age,country,balance,membership,rank,registered)
    VALUES (?,?,'',1,'boy',25,'jo',100,'none','user',1)`, [NAME, bcrypt.hashSync('pw1234', 10)]);
  const room = await qget(`SELECT id,name FROM rooms WHERE status='open' ORDER BY id LIMIT 1`);

  const browser = await chromium.launch({ args: ['--ignore-certificate-errors'] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 420, height: 820 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.triggerRoyalEntry === 'function', { timeout: 15000 });

  // شغّل مشهد الدخول الملكي مباشرة (نفس ما يستدعيه حدث royal_enter)
  await page.evaluate(() => {
    window.SETTINGS = window.SETTINGS || {};
    triggerRoyalEntry('ax', '/avatars/def/01.jpg', 'butterfly', 'girl', {});
  });
  await page.waitForTimeout(1200);

  const r = await page.evaluate(() => {
    const banner = document.querySelector('#royalBannerLayer .rt-banner-tiktok');
    const scene = document.getElementById('royalEntryLayer');
    const bannerLayer = document.getElementById('royalBannerLayer');
    if (!banner) return { noBanner: true };
    const cs = getComputedStyle(bannerLayer);
    const sceneCs = getComputedStyle(scene);
    const rect = banner.getBoundingClientRect();
    const cx = Math.round(rect.left + rect.width / 2);
    const cy = Math.round(rect.top + rect.height / 2);
    const hit = document.elementFromPoint(cx, cy);
    return {
      bannerInOwnLayer: banner.parentElement.id === 'royalBannerLayer',
      layerOpacity: cs.opacity,
      layerZ: cs.zIndex,
      sceneOpacity: sceneCs.opacity,
      sceneZ: sceneCs.zIndex,
      visible: rect.width > 0 && rect.height > 0,
      // elementFromPoint يتجاهل pointer-events:none (وهو مقصود كي لا يحجب البانر
      // النقر على الدردشة)، لذلك نفعّل الالتقاط مؤقتاً لقياس ترتيب التكديس الحقيقي.
      topMostIsBanner: (() => {
        const prevLayer = bannerLayer.style.pointerEvents;
        const prevBanner = banner.style.pointerEvents;
        bannerLayer.style.pointerEvents = 'auto';
        banner.style.pointerEvents = 'auto';
        const probe = document.elementFromPoint(cx, cy);
        bannerLayer.style.pointerEvents = prevLayer;
        banner.style.pointerEvents = prevBanner;
        return !!(probe && (probe === banner || banner.contains(probe)));
      })(),
      hitTag: hit ? (hit.className || hit.tagName) : null,
      centerX: cx, centerY: cy,
      text: banner.innerText.replace(/\s+/g, ' ').trim()
    };
  });

  console.log('\n— بانر الدخول الملكي');
  ok('البانر موجود ومرئي', !r.noBanner && r.visible, JSON.stringify(r));
  ok('البانر داخل طبقته المستقلة', r.bannerInOwnLayer === true);
  ok('طبقة البانر بشفافية كاملة (opacity=1)', r.layerOpacity === '1', 'opacity=' + r.layerOpacity);
  ok('البانر هو العنصر الأعلى فعلياً فوق كل شيء', r.topMostIsBanner === true, 'hit=' + r.hitTag);
  ok('نص البانر صحيح', /دخول ملكي/.test(r.text || ''), r.text);

  console.log('\n— باقي المشهد يبقى بالخلفية كما هو');
  ok('مشهد الدخول باقٍ بشفافية الخلفية 0.2', r.sceneOpacity === '0.2', 'opacity=' + r.sceneOpacity);
  ok('طبقة البانر أعلى من طبقة المشهد', +r.layerZ > +r.sceneZ, `banner=${r.layerZ} scene=${r.sceneZ}`);

  await page.screenshot({ path: '/home/user/chat1/royal-banner-proof.png' });

  // إثبات بصري: بكسل مركز البانر لامع/ذهبي وليس باهتاً كخلفية المشهد (شفافية 0.2).
  const shot = await page.screenshot({ clip: { x: r.centerX - 3, y: r.centerY - 3, width: 6, height: 6 } });
  const png = shot.toString('base64');
  const pixel = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let rr = 0, gg = 0, bb = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { rr += d[i]; gg += d[i + 1]; bb += d[i + 2]; n++; }
    return { r: Math.round(rr / n), g: Math.round(gg / n), b: Math.round(bb / n) };
  }, png);
  // خلفية الدردشة الفاتحة تكون رمادية شبه محايدة؛ البانر أغمق/ملون بوضوح.
  const isChatBg = pixel.r > 200 && pixel.g > 200 && pixel.b > 200;
  ok('بكسل مركز البانر مرسوم فعلاً وليس خلفية الدردشة', !isChatBg, JSON.stringify(pixel));

  console.log('\n— الاختفاء بعد انتهاء المشهد');
  await page.waitForTimeout(6000);
  const gone = await page.evaluate(() => {
    const bl = document.getElementById('royalBannerLayer');
    return { empty: bl.innerHTML === '', hidden: !bl.classList.contains('show') };
  });
  ok('البانر يُنظَّف بعد انتهاء المشهد', gone.empty && gone.hidden, JSON.stringify(gone));
  ok('لا أخطاء جافاسكربت', errors.length === 0, errors.join(' | '));

  await browser.close();
  await qrun(`DELETE FROM users WHERE username=?`, [NAME]);
  DB.close();
  console.log(`\nالنتيجة: ${passed} نجح / ${failed} فشل`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
