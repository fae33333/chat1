const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createYtMp3Saver } = require('../yt-mp3-saver');

test('saves the lowest audio source as a compact MP3', { skip: process.platform === 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-mp3-saver-test-'));
  const prev = {
    ffmpeg: process.env.FFMPEG_PATH,
    bitrate: process.env.YT_MP3_BITRATE,
    cookies: process.env.YTDLP_COOKIES,
    browserCookies: process.env.YTDLP_COOKIES_FROM_BROWSER,
    proxy: process.env.YTDLP_PROXY
  };
  const restore = (key, value) => value === undefined ? delete process.env[key] : (process.env[key] = value);

  try {
    const ytArgsLog = path.join(root, 'yt-dlp-args.json');
    const ffmpegArgsLog = path.join(root, 'ffmpeg-args.json');
    const ytDlp = path.join(root, 'fake-yt-dlp');
    const ffmpeg = path.join(root, 'fake-ffmpeg');
    fs.writeFileSync(ytDlp, `#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);if(args.includes('--version'))process.exit(0);fs.writeFileSync(${JSON.stringify(ytArgsLog)},JSON.stringify(args));const out=args[args.indexOf('-o')+1].replace('%(ext)s','m4a');fs.writeFileSync(out,Buffer.alloc(4096,1));\n`, { mode: 0o755 });
    fs.writeFileSync(ffmpeg, `#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);if(args[0]==='-version')process.exit(0);fs.writeFileSync(${JSON.stringify(ffmpegArgsLog)},JSON.stringify(args));fs.writeFileSync(args[args.length-1],Buffer.alloc(2048,2));\n`, { mode: 0o755 });

    delete process.env.YT_MP3_BITRATE;
    delete process.env.YTDLP_COOKIES;
    delete process.env.YTDLP_COOKIES_FROM_BROWSER;
    delete process.env.YTDLP_PROXY;
    process.env.FFMPEG_PATH = ffmpeg;

    const outDir = path.join(root, 'uploads');
    fs.mkdirSync(outDir);
    const id = 'abcdefghijk';
    const saver = createYtMp3Saver({
      ensureYtDlp: async () => true,
      findYtDlp: () => ytDlp,
      outDir,
      clientSets: [''],
      log: () => {}
    });

    assert.equal(saver.existing(id), null, 'a legacy m4a must not be mistaken for the requested MP3');
    const result = await saver.queue(id);
    assert.equal(result.format, 'mp3');
    assert.equal(result.url, `/uploads/ytm-${id}.mp3`);
    assert.ok(fs.statSync(result.file).size > 1024);

    // Cache audio left by the older code is converted locally, and never reported as MP3 before conversion.
    const legacyId = 'lmnopqrstuv';
    fs.writeFileSync(path.join(outDir, `ytm-${legacyId}.m4a`), Buffer.alloc(2048));
    assert.equal(saver.existing(legacyId), null);
    const convertedLegacy = await saver.queue(legacyId);
    assert.equal(convertedLegacy.format, 'mp3');

    const ytArgs = JSON.parse(fs.readFileSync(ytArgsLog, 'utf8'));
    assert.equal(ytArgs[ytArgs.indexOf('-f') + 1], 'worstaudio/bestaudio');
    assert.ok(ytArgs.includes(`https://www.youtube.com/watch?v=${id}`));
    assert.ok(!ytArgs.includes(`https://www.youtube.com/watch?v=${legacyId}`), 'legacy cached audio should not be downloaded again');
    const ffmpegArgs = JSON.parse(fs.readFileSync(ffmpegArgsLog, 'utf8'));
    assert.equal(ffmpegArgs[ffmpegArgs.indexOf('-b:a') + 1], '32k');
    assert.equal(ffmpegArgs[ffmpegArgs.indexOf('-ac') + 1], '1');
    assert.equal(ffmpegArgs[ffmpegArgs.indexOf('-ar') + 1], '22050');
    assert.equal(saver.existing(id).format, 'mp3');
  } finally {
    restore('FFMPEG_PATH', prev.ffmpeg);
    restore('YT_MP3_BITRATE', prev.bitrate);
    restore('YTDLP_COOKIES', prev.cookies);
    restore('YTDLP_COOKIES_FROM_BROWSER', prev.browserCookies);
    restore('YTDLP_PROXY', prev.proxy);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
