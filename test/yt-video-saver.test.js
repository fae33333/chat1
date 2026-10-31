// وضع الفيديو الافتراضي: أقل جودة فيديو+صوت بدون أي ترميز MP3، ويُحفظ mp4 جاهزاً للتشغيل كصوت فقط.
delete process.env.YT_OUTPUT;
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createYtMp3Saver } = require('../yt-mp3-saver');

test('saves the lowest video as mp4 without re-encoding to mp3', { skip: process.platform === 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-video-saver-test-'));
  const prevFfmpeg = process.env.FFMPEG_PATH;
  try {
    const ytLog = path.join(root, 'yt.json'), ffLog = path.join(root, 'ff.json');
    const ytDlp = path.join(root, 'yt-dlp'), ffmpeg = path.join(root, 'ffmpeg');
    fs.writeFileSync(ytDlp, `#!/usr/bin/env node\nconst fs=require('node:fs');const a=process.argv.slice(2);if(a.includes('--version'))process.exit(0);fs.writeFileSync(${JSON.stringify(ytLog)},JSON.stringify(a));fs.writeFileSync(a[a.indexOf('-o')+1].replace('%(ext)s','mp4'),Buffer.alloc(4096,1));\n`, { mode: 0o755 });
    fs.writeFileSync(ffmpeg, `#!/usr/bin/env node\nconst fs=require('node:fs');const a=process.argv.slice(2);if(a[0]==='-version')process.exit(0);fs.writeFileSync(${JSON.stringify(ffLog)},JSON.stringify(a));fs.writeFileSync(a[a.length-1],Buffer.alloc(3000,2));\n`, { mode: 0o755 });
    process.env.FFMPEG_PATH = ffmpeg;

    const outDir = path.join(root, 'uploads');
    const saver = createYtMp3Saver({ ensureYtDlp: async () => {}, findYtDlp: () => ytDlp, outDir });
    assert.equal(saver.limits.output, 'video');

    const id = 'abcDEF12345';
    const res = await saver.queue(id);
    assert.equal(res.format, 'mp4');
    assert.equal(path.basename(res.file), `ytm-${id}.mp4`);
    assert.equal(res.url, `/uploads/ytm-${id}.mp4`);
    assert.equal(saver.existing(id).format, 'mp4');

    const yt = JSON.parse(fs.readFileSync(ytLog, 'utf8'));
    assert.match(yt[yt.indexOf('-f') + 1], /^worstvideo\[ext=mp4\]\[vcodec\^=avc1\]\+worstaudio/);
    assert.equal(yt[yt.indexOf('--merge-output-format') + 1], 'mp4');
    assert.ok(yt.includes('--ffmpeg-location'));

    const ff = JSON.parse(fs.readFileSync(ffLog, 'utf8'));
    assert.ok(!ff.includes('libmp3lame'), 'no mp3 re-encoding in video mode');
    assert.equal(ff[ff.indexOf('-c') + 1], 'copy');
    assert.ok(ff.includes('+faststart'));
  } finally {
    if (prevFfmpeg === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = prevFfmpeg;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
