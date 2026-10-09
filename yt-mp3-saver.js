// yt-mp3-saver.js — عند حفظ أغنية يوتيوب في المكتبة: يحمّل أقل جودة صوت متاحة (سريع جداً)
// ثم يحوّلها إلى MP3 صغير (48kbps مونو افتراضياً) ويحفظها كملف عادي يُشغَّل كمقطع صوتي.
// - بدون ffmpeg: يحتفظ بالملف الأصلي (m4a/webm) كما نزل، وهو يُشغَّل أيضاً كصوت.
// - الملف يُخزَّن مرة واحدة لكل فيديو (ytm-<id>.mp3) ويُشارَك بين المستخدمين.
const fs = require('fs');
const path = require('path');
const { execFile, spawnSync } = require('child_process');

const EXTS = ['mp3', 'm4a', 'webm', 'opus', 'mp4'];
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

function createYtMp3Saver({ ensureYtDlp, findYtDlp, outDir, urlBase = '/uploads', clientSets = [''], altSource = null, concurrency = 2, log = console.error }) {
  fs.mkdirSync(outDir, { recursive: true });

  const BITRATE = process.env.YT_MP3_BITRATE || '48k';        // أقل = أسرع وأصغر
  const MAX_SECONDS = Number(process.env.YT_MAX_SECONDS || 1500); // أقصى مدة للمقطع (25 دقيقة)
  const MAX_FILESIZE = process.env.YT_MAX_FILESIZE || '50M';

  const inflight = new Map(); // videoId -> Promise<{url,file,format}>
  const waiting = [];
  let running = 0;

  let _ffmpeg; // undefined=لم يُفحص، null=غير موجود
  function findFfmpeg() {
    if (_ffmpeg !== undefined) return _ffmpeg;
    const local = path.join(__dirname, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    for (const bin of [process.env.FFMPEG_PATH, local, 'ffmpeg', 'ffmpeg.exe'].filter(Boolean)) {
      try { const r = spawnSync(bin, ['-version'], { timeout: 5000 }); if (r.status === 0) { _ffmpeg = bin; return bin; } } catch (e) {}
    }
    _ffmpeg = null; return null;
  }

  function existing(id) {
    if (!ID_RE.test(id)) return null;
    for (const ext of EXTS) {
      const f = path.join(outDir, 'ytm-' + id + '.' + ext);
      try { if (fs.statSync(f).size > 1024) return { file: f, url: urlBase + '/ytm-' + id + '.' + ext, format: ext }; } catch (e) {}
    }
    return null;
  }

  function runExec(bin, args, timeout) {
    return new Promise((resolve) => {
      execFile(bin, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, so, se) => resolve({ err, out: String(so || ''), errOut: String(se || '') }));
    });
  }

  function pickDownloaded(dir) {
    let best = null;
    try {
      for (const n of fs.readdirSync(dir)) {
        if (!/^src\./.test(n) || /\.(part|ytdl|temp)$/i.test(n)) continue;
        const f = path.join(dir, n); const st = fs.statSync(f);
        if (st.size > 1024 && (!best || st.size > best.size)) best = { file: f, size: st.size, ext: path.extname(n).slice(1).toLowerCase() };
      }
    } catch (e) {}
    return best;
  }

  async function downloadLowest(id, tmpDir) {
    await ensureYtDlp();
    const bin = findYtDlp(); if (!bin) throw new Error('yt-dlp غير مثبت');
    const errs = [];
    // مع الكوكيز: العميل الافتراضي (web/mweb) هو الأنسب؛ عملاء TV لا تدعم الكوكيز
    const sets = process.env.YTDLP_COOKIES ? [''].concat(clientSets.filter(Boolean)) : clientSets;
    for (const ex of sets) {
      const args = [
        '-f', 'worstaudio[ext=m4a]/worstaudio/worst',   // أصغر ملف صوت = أسرع تحميل
        '--no-playlist', '--no-warnings', '--no-part', '--no-progress',
        '--js-runtimes', 'node',
        '--max-filesize', MAX_FILESIZE,
        '--match-filter', 'duration<=' + MAX_SECONDS,
        '-o', path.join(tmpDir, 'src.%(ext)s')
      ];
      if (ex) args.push('--extractor-args', ex);
      if (process.env.YTDLP_PROXY) args.push('--proxy', process.env.YTDLP_PROXY);
      if (process.env.YTDLP_COOKIES) args.push('--cookies', process.env.YTDLP_COOKIES);
      else if (process.env.YTDLP_COOKIES_FROM_BROWSER) args.push('--cookies-from-browser', process.env.YTDLP_COOKIES_FROM_BROWSER);
      args.push('https://www.youtube.com/watch?v=' + id);
      const r = await runExec(bin, args, 90000);
      const got = pickDownloaded(tmpDir);
      if (got) return got;
      const msg = (r.errOut + ' ' + r.out + ' ' + (r.err && r.err.message || '')).trim();
      if (/does not pass filter|larger than max-filesize|File is larger/i.test(msg)) throw new Error('المقطع طويل أو كبير جداً');
      if (/confirm you.re not a bot|Sign in to confirm/i.test(msg)) { const e = new Error('BOT_BLOCK'); e.botBlock = true; throw e; }
      errs.push((ex || 'default') + ': ' + msg.slice(-120));
    }
    throw new Error(errs.join(' | ').slice(0, 500));
  }

  async function work(id) {
    const hit = existing(id);
    if (hit) return hit;
    const tmpDir = path.join(outDir, '.ytm-tmp-' + id + '-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      let src, fromCache = false;
      try {
        src = await downloadLowest(id, tmpDir);
      } catch (e) {
        if (/طويل أو كبير/.test(e.message)) throw e;
        if (!altSource) throw e.botBlock ? new Error('يوتيوب يحجب IP الخادم: أضف ملف cookies.txt في مجلد المشروع أو اضبط YTDLP_PROXY') : e;
        // yt-dlp فشل (غالباً حجب يوتيوب لـ IP الخادم): جرّب مسار Innertube (عملاء أندرويد/TV) ثم حوّل الملف
        log('yt-dlp failed (' + (e.botBlock ? 'bot-block' : e.message.slice(0, 80)) + ') — trying Innertube fallback for', id);
        try {
          const a = await altSource(id);
          src = { file: a.file, ext: path.extname(a.file).slice(1).toLowerCase() }; fromCache = true;
        } catch (e2) {
          if (e.botBlock) throw new Error('يوتيوب يحجب IP الخادم: أضف ملف cookies.txt في مجلد المشروع أو اضبط YTDLP_PROXY (' + String(e2.message).slice(0, 150) + ')');
          throw e2;
        }
      }
      if (src.size === undefined) { try { src.size = fs.statSync(src.file).size; } catch (e) {} }
      const ffmpeg = findFfmpeg();
      if (ffmpeg) {
        const tmpOut = path.join(tmpDir, 'out.mp3');
        const r = await runExec(ffmpeg, ['-y', '-v', 'error', '-i', src.file, '-vn', '-map_metadata', '-1',
          '-codec:a', 'libmp3lame', '-b:a', BITRATE, '-ac', '1', '-ar', '32000', tmpOut], 120000);
        let ok = false; try { ok = fs.statSync(tmpOut).size > 1024; } catch (e) {}
        if (ok) {
          const final = path.join(outDir, 'ytm-' + id + '.mp3');
          fs.renameSync(tmpOut, final);
          return { file: final, url: urlBase + '/ytm-' + id + '.mp3', format: 'mp3' };
        }
        log('ffmpeg convert failed, keeping original:', (r.errOut || (r.err && r.err.message) || '').slice(0, 200));
      }
      // بدون ffmpeg (أو فشل التحويل): نحتفظ بالملف كما نزل — يُشغَّل كصوت عادي
      const ext = EXTS.includes(src.ext) ? src.ext : 'm4a';
      const final = path.join(outDir, 'ytm-' + id + '.' + ext);
      if (fromCache) fs.copyFileSync(src.file, final); else fs.renameSync(src.file, final);
      return { file: final, url: urlBase + '/ytm-' + id + '.' + ext, format: ext };
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  }

  function pump() {
    while (running < concurrency && waiting.length) {
      const job = waiting.shift();
      running++;
      work(job.id).then(job.resolve, job.reject).finally(() => { running--; pump(); });
    }
  }

  // يضيف مهمة (أو يعيد الموجودة). يعيد Promise<{url,file,format}>
  function queue(id) {
    if (!ID_RE.test(id)) return Promise.reject(new Error('معرّف غير صالح'));
    if (inflight.has(id)) return inflight.get(id);
    const p = new Promise((resolve, reject) => { waiting.push({ id, resolve, reject }); pump(); });
    inflight.set(id, p);
    const clear = () => inflight.delete(id);
    p.then(clear, clear);
    return p;
  }

  return { queue, existing, findFfmpeg };
}

module.exports = { createYtMp3Saver };
