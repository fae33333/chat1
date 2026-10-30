// اختبارات: بلا حدود افتراضية + تدوير ملفات الكوكيز عند الحجب
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createYtMp3Saver } = require('../yt-mp3-saver');

const SKIP = process.platform === 'win32';

function makeToolchain(root) {
  const log = path.join(root, 'yt-calls.log');
  const ytDlp = path.join(root, 'fake-yt-dlp');
  const ffmpeg = path.join(root, 'fake-ffmpeg');
  fs.writeFileSync(ytDlp, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args.includes('--version')) process.exit(0);
const ci = args.indexOf('--cookies');
const cookie = ci >= 0 ? args[ci + 1] : '';
if (/bad/.test(cookie)) { process.stderr.write("ERROR: Sign in to confirm you're not a bot\\n"); process.exit(1); }
const oi = args.indexOf('-o');
if (oi < 0) { process.stderr.write('no output arg\\n'); process.exit(2); }
fs.writeFileSync(args[oi + 1].replace('%(ext)s', 'm4a'), Buffer.alloc(4096, 1));
`, { mode: 0o755 });
  fs.writeFileSync(ffmpeg, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '-version') process.exit(0);
fs.writeFileSync(args[args.length - 1], Buffer.alloc(2048, 2));
`, { mode: 0o755 });
  return { log, ytDlp, ffmpeg };
}

function readCalls(log) {
  try {
    return fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      .filter(args => !args.includes('--version'));
  } catch (e) { return []; }
}

function makeSaver(root, tools, extra = {}) {
  return createYtMp3Saver(Object.assign({
    ensureYtDlp: async () => true,
    findYtDlp: () => tools.ytDlp,
    outDir: path.join(root, 'uploads'),
    clientSets: [''],
    log: () => {}
  }, extra));
}

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  return Promise.resolve().then(fn).finally(() => {
    for (const k of Object.keys(vars)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  });
}

test('بلا حد للمدة أو الحجم افتراضياً (لا نمرر --match-filter أو --max-filesize)', { skip: SKIP }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmp3-unlimited-'));
  const tools = makeToolchain(root);
  fs.mkdirSync(path.join(root, 'uploads'));
  try {
    await withEnv({
      FFMPEG_PATH: tools.ffmpeg, YT_MAX_SECONDS: undefined, YT_MAX_FILESIZE: undefined,
      YTDLP_COOKIES: undefined, YTDLP_PROXY: undefined, YTDLP_COOKIES_FROM_BROWSER: undefined
    }, async () => {
      const saver = makeSaver(root, tools);
      const res = await saver.queue('abcdefghijk');
      assert.equal(res.format, 'mp3');
      const calls = readCalls(tools.log);
      assert.equal(calls.length, 1);
      assert.ok(!calls[0].includes('--match-filter'), 'لا يجب تقييد المدة افتراضياً');
      assert.ok(!calls[0].includes('--max-filesize'), 'لا يجب تقييد الحجم افتراضياً');
      assert.equal(saver.limits.maxSeconds, 0);
      assert.equal(saver.limits.maxFilesize, 'unlimited');
      assert.equal(saver.stats().concurrency, 3);
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('يمكن تقييد المدة اختيارياً عبر YT_MAX_SECONDS', { skip: SKIP }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmp3-limited-'));
  const tools = makeToolchain(root);
  fs.mkdirSync(path.join(root, 'uploads'));
  try {
    await withEnv({ FFMPEG_PATH: tools.ffmpeg, YT_MAX_SECONDS: '600', YT_MAX_FILESIZE: '90M', YTDLP_COOKIES: undefined }, async () => {
      const saver = makeSaver(root, tools);
      await saver.queue('abcdefghijk');
      const args = readCalls(tools.log)[0];
      assert.equal(args[args.indexOf('--match-filter') + 1], 'duration<=600');
      assert.equal(args[args.indexOf('--max-filesize') + 1], '90M');
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('يدوّر ملفات الكوكيز: يتخطى الكوكيز المحجوبة ويكمل بالملف الصالح', { skip: SKIP }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmp3-cookies-'));
  const tools = makeToolchain(root);
  fs.mkdirSync(path.join(root, 'uploads'));
  const bad = path.join(root, 'bad-cookies.txt');
  const good = path.join(root, 'good-cookies.txt');
  fs.writeFileSync(bad, '.youtube.com\tTRUE\t/\tTRUE\t' + (Math.floor(Date.now() / 1000) + 9999) + '\tSID\tx\n');
  fs.writeFileSync(good, '.youtube.com\tTRUE\t/\tTRUE\t' + (Math.floor(Date.now() / 1000) + 9999) + '\tSID\ty\n');
  try {
    await withEnv({ FFMPEG_PATH: tools.ffmpeg, YT_MAX_SECONDS: undefined, YT_MAX_FILESIZE: undefined, YTDLP_COOKIES: undefined, YTDLP_PROXY: undefined, YTDLP_COOKIES_FROM_BROWSER: undefined }, async () => {
      const saver = makeSaver(root, tools, { cookieFiles: () => [bad, good] });
      const res = await saver.queue('abcdefghijk');
      assert.equal(res.format, 'mp3');
      const calls = readCalls(tools.log);
      const usedCookies = calls.map(args => { const i = args.indexOf('--cookies'); return i >= 0 ? path.basename(args[i + 1]) : ''; });
      assert.ok(usedCookies.includes('bad-cookies.txt'), 'يجب أن يحاول ملف الكوكيز الأول');
      assert.ok(usedCookies.includes('good-cookies.txt'), 'يجب أن ينتقل للملف الصالح بعد الحجب');
      assert.ok(fs.statSync(res.file).size > 1024);
      // الملف المحجوب يُستبعد مؤقتاً من المحاولات التالية
      const blocked = saver.stats().cookies.find(c => c.name === 'bad-cookies.txt');
      assert.equal(blocked.blocked, true);
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('يصنّف أخطاء الشبكة وحجب يوتيوب برسائل عربية واضحة', { skip: SKIP }, async () => {
  for (const scenario of [
    { stderr: "ERROR: Unable to download API page: TLS/SSL connection has been closed", code: 'network', match: /شبكة/ },
    { stderr: "ERROR: [youtube] x: Sign in to confirm you're not a bot. Use --cookies-from-browser", code: 'bot', match: /كوكيز/ }
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmp3-errors-'));
    const ytDlp = path.join(root, 'fake-yt-dlp');
    const ffmpeg = path.join(root, 'fake-ffmpeg');
    fs.writeFileSync(ytDlp, `#!/usr/bin/env node
if (process.argv.includes('--version')) process.exit(0);
process.stderr.write(${JSON.stringify(scenario.stderr)} + '\\n');
process.exit(1);
`, { mode: 0o755 });
    fs.writeFileSync(ffmpeg, '#!/usr/bin/env node\nif (process.argv[2] === "-version") process.exit(0);\nprocess.exit(0);\n', { mode: 0o755 });
    fs.mkdirSync(path.join(root, 'uploads'));
    try {
      await withEnv({ FFMPEG_PATH: ffmpeg, YT_MAX_SECONDS: undefined, YT_MAX_FILESIZE: undefined, YTDLP_COOKIES: undefined, YTDLP_PROXY: undefined, YTDLP_COOKIES_FROM_BROWSER: undefined }, async () => {
        const saver = makeSaver(root, { ytDlp, ffmpeg, log: path.join(root, 'x.log') }, { cookieFiles: () => [] });
        await assert.rejects(() => saver.queue('abcdefghijk'), (e) => {
          assert.equal(e.code, scenario.code);
          assert.match(e.message, scenario.match);
          return true;
        });
      });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});
