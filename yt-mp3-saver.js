// yt-mp3-saver.js — يحفظ صوت يوتيوب كـ MP3 صغير: أقل صيغة صوت متاحة ثم ترميز مونو 32kbps.
// يحتاج ffmpeg حتى لا يُحفظ ملف بصيغة مختلفة عن MP3 دون تنبيه.
// الملف يُخزَّن مرة واحدة لكل فيديو (ytm-<id>.mp3) ويُشارَك بين المستخدمين.
const fs = require('fs');
const path = require('path');
const { execFile, spawnSync } = require('child_process');

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const SOURCE_EXTS = ['m4a', 'webm', 'opus', 'mp4'];

function createYtMp3Saver({ ensureYtDlp, findYtDlp, outDir, urlBase = '/uploads', clientSets = [''], altSource = null, concurrency = 2, log = console.error }) {
  fs.mkdirSync(outDir, { recursive: true });

  const BITRATE = process.env.YT_MP3_BITRATE || '32k';        // ملف صغير؛ مونو 32kbps ≈ 240KB لكل دقيقة
  const MAX_SECONDS = Number(process.env.YT_MAX_SECONDS || 1500); // أقصى مدة للمقطع (25 دقيقة)
  const MAX_FILESIZE = process.env.YT_MAX_FILESIZE || '50M';

  const inflight = new Map(); // videoId -> Promise<{url,file,format}>
  const waiting = [];
  let running = 0;

  let _ffmpeg; // يُخزّن المسار عند وجود ffmpeg؛ يعاد الفحص إذا لم يكن موجوداً (لدعم إعادة المحاولة بعد التثبيت)
  function findFfmpeg() {
    if (_ffmpeg) return _ffmpeg;
    const local = path.join(__dirname, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    for (const bin of [process.env.FFMPEG_PATH, local, 'ffmpeg', 'ffmpeg.exe'].filter(Boolean)) {
      try { const r = spawnSync(bin, ['-version'], { timeout: 5000 }); if (r.status === 0) { _ffmpeg = bin; return bin; } } catch (e) {}
    }
    _ffmpeg = null; return null;
  }

  function existing(id) {
    if (!ID_RE.test(id)) return null;
    // نعتبر ملف MP3 فقط جاهزاً، حتى لا يُعاد ملف قديم بصيغة مختلفة على أنه النتيجة الجديدة.
    const f = path.join(outDir, 'ytm-' + id + '.mp3');
    try { if (fs.statSync(f).size > 1024) return { file: f, url: urlBase + '/ytm-' + id + '.mp3', format: 'mp3' }; } catch (e) {}
    return null;
  }

  function cachedSource(id) {
    if (!ID_RE.test(id)) return null;
    for (const ext of SOURCE_EXTS) {
      const f = path.join(outDir, 'ytm-' + id + '.' + ext);
      try { const size = fs.statSync(f).size; if (size > 1024) return { file: f, size }; } catch (e) {}
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
    let botBlockSeen = false;
    // عند وجود كوكيز نجرّب العميل الافتراضي أولاً (الأفضل مع تسجيل الدخول)، ثم بقية العملاء.
    const hasCookies = !!(process.env.YTDLP_COOKIES || process.env.YTDLP_COOKIES_FROM_BROWSER);
    const sets = hasCookies ? [''].concat(clientSets.filter(Boolean)) : clientSets;
    for (const ex of [...new Set(sets)]) {
      // لا نسمح لملف جزئي من محاولة فاشلة أن يُعتبر ملفاً صالحاً في المحاولة التالية.
      try { for (const n of fs.readdirSync(tmpDir)) if (/^src\./.test(n)) fs.unlinkSync(path.join(tmpDir, n)); } catch (e) {}
      const args = [
        '-f', 'worstaudio/bestaudio',   // أقل جودة صوت متاحة دون تفضيل حاوية أكبر
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
      const msg = (r.errOut + ' ' + r.out + ' ' + (r.err && r.err.message || '')).trim();
      const got = pickDownloaded(tmpDir);
      if (!r.err && got) return got;
      if (/does not pass filter|larger than max-filesize|File is larger/i.test(msg)) throw new Error('المقطع طويل أو كبير جداً');
      if (/confirm you.re not a bot|Sign in to confirm/i.test(msg)) botBlockSeen = true;
      errs.push((ex || 'default') + ': ' + msg.slice(-160));
    }
    const error = new Error(errs.join(' | ').slice(0, 700) || 'فشل تنزيل صوت يوتيوب');
    if (botBlockSeen) error.botBlock = true;
    throw error;
  }

  async function work(id) {
    const hit = existing(id);
    if (hit) return hit;
    const ffmpeg = findFfmpeg();
    if (!ffmpeg) throw new Error('ffmpeg غير مثبت على الخادم — ثبّته (Ubuntu/Debian: apt install ffmpeg) أو اضبط FFMPEG_PATH حتى يُحفظ الصوت بصيغة MP3');

    const tmpDir = path.join(outDir, '.ytm-tmp-' + id + '-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      let src = cachedSource(id); // حوّل كاش m4a/webm القديم محلياً بدلاً من تنزيله مجدداً.
      if (!src) {
        try {
          src = await downloadLowest(id, tmpDir);
        } catch (e) {
          if (/طويل أو كبير/.test(e.message)) throw e;
          if (!altSource) throw e.botBlock ? new Error('يوتيوب يحجب IP الخادم: أضف cookies.txt أو اضبط YTDLP_COOKIES أو YTDLP_PROXY') : e;
          // yt-dlp فشل (غالباً حجب IP الخادم): جرّب مصدر الصوت البديل، ثم حوّله إلى MP3.
          log('yt-dlp failed (' + (e.botBlock ? 'bot-block' : e.message.slice(0, 80)) + ') — trying alternate audio source for', id);
          try {
            const a = await altSource(id);
            src = { file: a.file, size: a.size };
          } catch (e2) {
            if (e.botBlock) throw new Error('يوتيوب يحجب IP الخادم: أضف cookies.txt أو اضبط YTDLP_COOKIES أو YTDLP_PROXY (' + String(e2.message).slice(0, 150) + ')');
            throw e2;
          }
        }
      }

      const tmpOut = path.join(tmpDir, 'out.mp3');
      const r = await runExec(ffmpeg, ['-y', '-v', 'error', '-i', src.file, '-vn', '-map_metadata', '-1',
        '-codec:a', 'libmp3lame', '-b:a', BITRATE, '-ac', '1', '-ar', '22050', tmpOut], 120000);
      let ok = false; try { ok = fs.statSync(tmpOut).size > 1024; } catch (e) {}
      if (!ok || r.err) {
        const detail = (r.errOut || (r.err && r.err.message) || 'ffmpeg did not create an output file').trim().slice(0, 240);
        throw new Error('فشل تحويل الصوت إلى MP3: ' + detail);
      }
      const final = path.join(outDir, 'ytm-' + id + '.mp3');
      fs.renameSync(tmpOut, final);
      return { file: final, url: urlBase + '/ytm-' + id + '.mp3', format: 'mp3' };
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
