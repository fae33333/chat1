const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ytCookies = require('../yt-cookies');

const FUTURE = Math.floor(Date.now() / 1000) + 80 * 24 * 3600;
const PAST = Math.floor(Date.now() / 1000) - 24 * 3600;

function netscape(extraLines = []) {
  return [
    '# Netscape HTTP Cookie File',
    '# https://curl.haxx.se/rfc/cookie_spec.html',
    '',
    `.youtube.com\tTRUE\t/\tTRUE\t${FUTURE}\tLOGIN_INFO\tlogin-value`,
    `.youtube.com\tTRUE\t/\tFALSE\t${FUTURE}\tHSID\thsid-value`,
    `.youtube.com\tTRUE\t/\tTRUE\t${FUTURE}\tSID\tsid-value`,
    `.youtube.com\tTRUE\t/\tTRUE\t0\tYSC\tysc-value`,
    `.google.com\tTRUE\t/\tFALSE\t${FUTURE}\tSID\tother-domain`,
    ...extraLines
  ].join('\n') + '\n';
}

test('parseNetscape يفهم سطور HttpOnly ويعرف جلسة الدخول', () => {
  const withHttpOnly = netscape([`#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t${FUTURE}\t__Secure-1PSID\thttponly-value`]).replace('\tHSID\t', '\tSSID\t');
  const info = ytCookies.parseNetscape(withHttpOnly);
  assert.equal(info.youtube, 5, 'يجب عدّ سطور #HttpOnly_ ضمن كوكيز يوتيوب');
  assert.equal(info.login, true);
  assert.equal(info.expired, false);
  assert.ok(info.names.includes('__Secure-1PSID'));
});

test('normalizeCookieText يحوّل JSON (Cookie-Editor) إلى Netscape', () => {
  const json = JSON.stringify([
    { name: 'SID', value: 'json-sid', domain: '.youtube.com', path: '/', secure: true, expirationDate: FUTURE },
    { name: 'PREF', value: 'tz=Asia.Amman', domain: '.youtube.com', path: '/', secure: true, expirationDate: FUTURE }
  ]);
  const out = ytCookies.normalizeCookieText(json);
  assert.match(out.text, /^# Netscape HTTP Cookie File/);
  assert.equal(out.info.youtube, 2);
  assert.equal(out.info.login, true);
  assert.match(out.text, /\.youtube\.com\tTRUE\t\/\tTRUE\t\d+\tSID\tjson-sid/);
});

test('normalizeCookieText يرفض الملف الفارغ والمنتهي وغير يوتيوب', () => {
  assert.throws(() => ytCookies.normalizeCookieText(''), /الصق محتوى ملف الكوكيز/);
  assert.throws(() => ytCookies.normalizeCookieText('[]'), /لم نجد أي كوكيز/);
  assert.throws(() => ytCookies.normalizeCookieText('.google.com\tTRUE\t/\tFALSE\t' + FUTURE + '\tSID\tx'), /youtube\.com/);
  const expired = netscape([`.youtube.com\tTRUE\t/\tTRUE\t${PAST}\tSID\told`]);
  // SID مكرر: الثاني منتهٍ، لذلك يُرفض الملف بالكامل حتى لا نُبقي جلسة ميتة
  assert.throws(() => ytCookies.normalizeCookieText(expired), /منتهية الصلاحية/);
});

test('saveCookieFile / listCookieFiles / deleteCookieFile تعمل داخل data فقط', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-cookies-test-'));
  const prevEnv = process.env.YTDLP_COOKIES;
  delete process.env.YTDLP_COOKIES;
  try {
    const first = ytCookies.saveCookieFile(root, netscape(), '');
    assert.equal(first.name, 'yt-cookies.txt');
    const second = ytCookies.saveCookieFile(root, netscape(), 'account2');
    assert.equal(second.name, 'yt-cookies-account2.txt');

    const files = ytCookies.listCookieFiles(root);
    assert.equal(files.length, 2);
    assert.ok(files.every(f => f.startsWith(path.join(root, 'data'))));

    const described = ytCookies.describeAll(root);
    assert.equal(described.length, 2);
    assert.ok(described.every(d => d.youtubeCookies >= 4 && d.loggedIn && !d.expired));

    // ملف خارج data لا يُحذف حتى لو طُلب باسم مشابه
    const outside = path.join(root, 'notes.txt');
    fs.writeFileSync(outside, netscape());
    assert.throws(() => ytCookies.deleteCookieFile(root, '../notes.txt'), /اسم ملف غير صالح/);
    assert.ok(fs.existsSync(outside));

    ytCookies.deleteCookieFile(root, first.name);
    assert.equal(ytCookies.listCookieFiles(root).length, 1);
  } finally {
    if (prevEnv === undefined) delete process.env.YTDLP_COOKIES;
    else process.env.YTDLP_COOKIES = prevEnv;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('يقبل نصاً ملصوقاً من محادثة (روابط Markdown ورموز HTML)', () => {
  const messy = [
    '# Netscape HTTP Cookie File',
    '.[youtube.com](http://youtube.com)\tTRUE\t/\tTRUE\t' + FUTURE + '\tLOGIN_INFO\tlogin',
    '.[youtube.com](http://youtube.com)\tTRUE\t/\tFALSE\t' + FUTURE + '\tHSID\thsid',
    '.[youtube.com](http://youtube.com)\tTRUE\t/\tTRUE\t' + FUTURE + '\tSID\tsid&amp;value'
  ].join('\n');
  const out = ytCookies.normalizeCookieText(messy);
  assert.equal(out.info.youtube, 3);
  assert.equal(out.info.login, true);
  assert.match(out.text, /^\.youtube\.com\tTRUE\t\/\tTRUE\t/m);
  assert.ok(out.text.includes('sid&value'), 'يجب فك ترميز &amp; في القيم');
});
