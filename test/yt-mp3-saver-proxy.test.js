// يختبر yt-mp3-saver مع yt-dlp وهمي: هل يمرّر --proxy، يدوّر عند الفشل، ويحترم منع الاتصال المباشر؟
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createYtMp3Saver } = require('../yt-mp3-saver');
const { createProxyStore } = require('../yt-proxies');

process.env.YT_NO_NICE = '1';
process.env.YT_OUTPUT = 'mp3';
process.env.YT_MP3_TIMEOUT_MS = '60000';

function setup({ goodProxy }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytsv-'));
  const log = path.join(dir, 'calls.log');
  const ytdlp = path.join(dir, 'fake-yt-dlp.sh');
  const ffmpeg = path.join(dir, 'fake-ffmpeg.sh');
  // yt-dlp وهمي: ينجح فقط إن كان --proxy يساوي goodProxy، وإلا يحاكي حجب البوت
  fs.writeFileSync(ytdlp, `#!/bin/sh
if [ "$1" = "--version" ]; then echo 2024.01.01; exit 0; fi
PX=""; OUT=""; PREV=""
for a in "$@"; do
  [ "$PREV" = "--proxy" ] && PX="$a"
  [ "$PREV" = "-o" ] && OUT="$a"
  PREV="$a"
done
echo "proxy=$PX" >> "${log}"
if [ "$PX" = "${goodProxy}" ]; then
  head -c 5000 /dev/zero > "$(echo "$OUT" | sed 's/%(ext)s/m4a/')"
  exit 0
fi
echo "ERROR: Sign in to confirm you're not a bot" >&2
exit 1
`, { mode: 0o755 });
  fs.writeFileSync(ffmpeg, `#!/bin/sh
for a in "$@"; do OUT="$a"; done
head -c 4000 /dev/zero > "$OUT"
`, { mode: 0o755 });
  process.env.FFMPEG_PATH = ffmpeg;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytpxr-'));
  const proxies = createProxyStore(root);
  const outDir = path.join(dir, 'out');
  const saver = createYtMp3Saver({
    ensureYtDlp: async () => true, findYtDlp: () => ytdlp, outDir,
    clientSets: [''], cookieFiles: () => [], proxies, log: () => {}, concurrency: 1
  });
  return { saver, proxies, log, outDir };
}
const calls = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n') : []);

test('يجرّب البروكسي الأول فيفشل ثم ينتقل للثاني وينجح، ويسجّل النتيجتين', async () => {
  const t = setup({ goodProxy: 'http://2.2.2.2:80' });
  t.proxies.add('1.1.1.1:80\n2.2.2.2:80');
  t.proxies.setMode({ enabled: true });
  const r = await t.saver.queue('dQw4w9WgXcQ');
  assert.equal(r.format, 'mp3');
  assert.ok(fs.existsSync(r.file));
  assert.deepEqual(calls(t.log), ['proxy=http://1.1.1.1:80', 'proxy=http://2.2.2.2:80']);
  const d = t.proxies.describe().proxies;
  assert.equal(d[0].cooling, true, 'المحجوب يُوقَف مؤقتاً');
  assert.equal(d[1].ok, 1);
  assert.equal(t.saver.limits.proxyMode, true);
});

test('كل البروكسيات محجوبة وبدون اتصال مباشر ← يفشل بخطأ bot ولا يخرج مباشرة', async () => {
  const t = setup({ goodProxy: 'none' });
  t.proxies.add('1.1.1.1:80');
  t.proxies.setMode({ enabled: true, fallbackDirect: false });
  await assert.rejects(t.saver.queue('abcdefghijk'), (e) => e.botBlock === true && /البروكسيات/.test(e.message));
  assert.ok(calls(t.log).every(l => l !== 'proxy='), 'يجب ألا تحدث أي محاولة مباشرة');
});

test('مع السماح بالاتصال المباشر يجرّب المباشر بعد فشل البروكسيات', async () => {
  const t = setup({ goodProxy: '' });          // ينجح فقط بدون --proxy
  t.proxies.add('1.1.1.1:80');
  t.proxies.setMode({ enabled: true, fallbackDirect: true });
  const r = await t.saver.queue('abcdefghijk');
  assert.ok(fs.existsSync(r.file));
  const c = calls(t.log);
  assert.equal(c[0], 'proxy=http://1.1.1.1:80');
  assert.equal(c[c.length - 1], 'proxy=');
});

test('وضع البروكسي متوقف ← اتصال مباشر كالمعتاد بلا --proxy', async () => {
  const t = setup({ goodProxy: '' });
  t.proxies.add('1.1.1.1:80');               // مضاف لكن الوضع غير مفعّل
  const r = await t.saver.queue('abcdefghijk');
  assert.ok(fs.existsSync(r.file));
  assert.deepEqual(calls(t.log), ['proxy=']);
  assert.equal(t.proxies.describe().proxies[0].ok, 0);
});
