// yt-mp3-saver.js — يحفظ صوت يوتيوب كـ MP3 صغير: أقل صيغة صوت متاحة ثم ترميز مونو 32kbps.
// يحتاج ffmpeg حتى لا يُحفظ ملف بصيغة مختلفة عن MP3 دون تنبيه.
// الملف يُخزَّن مرة واحدة لكل فيديو (ytm-<id>.mp3) ويُشارَك بين المستخدمين.
//
// بلا حدود افتراضية: لا حدّ للمدة ولا لحجم الملف (يمكن ضبطهما عبر YT_MAX_SECONDS / YT_MAX_FILESIZE).
// يدعم تدوير عدة ملفات كوكيز (حسابات مختلفة) والتبديل تلقائياً عند حجب/انتهاء حساب.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, spawnSync } = require('child_process');

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const SOURCE_EXTS = ['m4a', 'webm', 'opus', 'mp4'];

// أخطاء تعني أن يوتيوب يطلب التحقق من الجلسة (bot / login) — تُعالَج بكوكيز أو بروكسي أو عميل آخر
const BOT_RE = /confirm you.?re not a bot|sign in to confirm|not a bot|please sign in|login required|log in to confirm|cookies? (?:are|is) no longer valid|this video is age.?restricted|age.?restricted|use --cookies|po.?token/i;
// مشاكل الشبكة/DNS/البروكسي على الخادم — ليست حجب حساب، وقد تنجح إعادة المحاولة لاحقاً
const NET_RE = /getaddrinfo|name or service not known|temporary failure in name resolution|connection refused|connection timed out|connection reset|network is unreachable|econnrefused|etimedout|enetunreach|proxyerror|tunnel connection failed|could not resolve host|ssl/i;
// أخطاء دائمة: إعادة المحاولة لن تنفع مهما طال الانتظار
const PERMANENT_RE = /private video|video is private|has been removed|video unavailable|members.?only|removed by the uploader|this video is not available/i;

function envNum(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function createYtMp3Saver({
  ensureYtDlp,
  findYtDlp,
  outDir,
  urlBase = '/uploads',
  clientSets = [''],
  altSource = null,
  concurrency,
  log = console.error,
  cookieFiles = () => []
}) {
  fs.mkdirSync(outDir, { recursive: true });

  const BITRATE = process.env.YT_MP3_BITRATE || '32k';            // ملف صغير؛ مونو 32kbps ≈ 240KB لكل دقيقة
  const MAX_SECONDS = envNum('YT_MAX_SECONDS', 0);                 // 0 = بلا حد للمدة (الافتراضي)
  const MAX_FILESIZE = String(process.env.YT_MAX_FILESIZE || '').trim(); // فارغ = بلا حد للحجم
  const CONCURRENCY = Math.max(1, concurrency || envNum('YT_MP3_CONCURRENCY', 3));
  const MAX_TRIES = Math.max(2, envNum('YT_MP3_TRIES', 12));       // عدد المحاولات الكلية لكل مقطع
  const EXEC_TIMEOUT = Math.max(60000, envNum('YT_MP3_TIMEOUT_MS', 20 * 60 * 1000));
  const COOKIE_COOLDOWN = Math.max(30000, envNum('YT_COOKIE_COOLDOWN_MS', 15 * 60 * 1000));
  const JS_RUNTIME = String(process.env.YTDLP_JS_RUNTIME || 'node').trim();
  const versionCache = new Map(); // bin -> إصدار yt-dlp

  const inflight = new Map();   // videoId -> Promise<{url,file,format}>
  const waiting = [];
  const jobs = new Map();       // videoId -> {status, startedAt, finishedAt, error, attempts}
  const cookieCooldown = new Map(); // cookieFile -> وقت انتهاء الحجب
  let running = 0;

  // ── ffmpeg ──
  let _ffmpeg;
  function findFfmpeg() {
    if (_ffmpeg) return _ffmpeg;
    const local = path.join(__dirname, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    for (const bin of [process.env.FFMPEG_PATH, local, 'ffmpeg', 'ffmpeg.exe'].filter(Boolean)) {
      try { const r = spawnSync(bin, ['-version'], { timeout: 5000 }); if (r.status === 0) { _ffmpeg = bin; return bin; } } catch (e) { /* جرّب التالي */ }
    }
    _ffmpeg = null; return null;
  }

  // ── ملفات الإخراج ──
  function existing(id) {
    if (!ID_RE.test(id)) return null;
    // نعتبر ملف MP3 فقط جاهزاً، حتى لا يُعاد ملف قديم بصيغة مختلفة على أنه النتيجة الجديدة.
    const f = path.join(outDir, 'ytm-' + id + '.mp3');
    try { if (fs.statSync(f).size > 1024) return { file: f, url: urlBase + '/ytm-' + id + '.mp3', format: 'mp3' }; } catch (e) { /* غير موجود */ }
    return null;
  }

  function cachedSource(id) {
    if (!ID_RE.test(id)) return null;
    for (const ext of SOURCE_EXTS) {
      const f = path.join(outDir, 'ytm-' + id + '.' + ext);
      try { const size = fs.statSync(f).size; if (size > 1024) return { file: f, size }; } catch (e) { /* جرّب التالي */ }
    }
    return null;
  }

  function cleanupStaleTmp() {
    try {
      const now = Date.now();
      for (const name of fs.readdirSync(outDir)) {
        if (!/^\.ytm-tmp-/.test(name)) continue;
        const dir = path.join(outDir, name);
        try { if (now - fs.statSync(dir).mtimeMs > 24 * 3600 * 1000) fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* غير مهم */ }
      }
    } catch (e) { /* غير مهم */ }
  }
  cleanupStaleTmp();

  function runExec(bin, args, timeout) {
    return new Promise((resolve) => {
      execFile(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, so, se) => {
        resolve({ err, out: String(so || ''), errOut: String(se || '') });
      });
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
    } catch (e) { /* المجلد غير موجود */ }
    return best;
  }

  // ── الكوكيز ──
  function cookieList() {
    try {
      const v = typeof cookieFiles === 'function' ? cookieFiles() : cookieFiles;
      const list = [...(v || [])];
      // احتياط: متغير البيئة قد يحمل ملفاً أو أكثر مفصولة بفاصلة/فاصلة منقوطة
      for (const raw of String(process.env.YTDLP_COOKIES || '').split(/[;,]/)) {
        const p = raw.trim();
        if (p) list.push(p);
      }
      return [...new Set(list.filter(Boolean))].filter(f => {
        try { return fs.statSync(f).size > 20; } catch (e) { return false; }
      });
    } catch (e) { return []; }
  }
  function cookieBlocked(file) {
    const until = cookieCooldown.get(file) || 0;
    if (until > Date.now()) return true;
    if (until) cookieCooldown.delete(file);
    return false;
  }
  function blockCookie(file) {
    if (!file) return;
    cookieCooldown.set(file, Date.now() + COOKIE_COOLDOWN);
    log('كوكيز محجوبة مؤقتاً (bot/limit):', path.basename(file));
  }

  // خيار --js-runtimes موجود فقط في إصدارات yt-dlp الحديثة؛ نضيفه عندما يكون الإصدار معروفاً وحديثاً
  // حتى لا تفشل كل المحاولات على خادم فيه نسخة قديمة من yt-dlp.
  function supportsJsRuntime(bin) {
    if (!versionCache.has(bin)) {
      let version = '';
      try { const r = spawnSync(bin, ['--version'], { timeout: 8000 }); version = String(r.stdout || '').trim().split('\n')[0]; } catch (e) { /* غير معروف */ }
      versionCache.set(bin, version);
    }
    const m = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(versionCache.get(bin) || '');
    if (!m) return false;
    return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) >= 20250400;
  }

  function clientSetList() {
    return [...new Set((Array.isArray(clientSets) && clientSets.length ? clientSets : ['']).map(s => String(s || '')))];
  }

  // نبني قائمة المحاولات: كل الكوكيز غير المحجوبة × العميل الافتراضي، ثم الكوكيز × بقية العملاء، ثم بدون كوكيز.
  function buildAttempts() {
    const sets = clientSetList();
    const all = cookieList();
    const fresh = all.filter(c => !cookieBlocked(c));
    const usable = fresh.length ? fresh : all;
    const out = [];
    const seen = new Set();
    const push = (cookie, extractor) => {
      const key = cookie + '|' + extractor;
      if (seen.has(key) || out.length >= MAX_TRIES) return;
      seen.add(key); out.push({ cookie, extractor });
    };
    for (const c of usable) push(c, '');
    for (const c of usable) for (const ex of sets) if (ex) push(c, ex);
    for (const ex of sets) push('', ex);
    return out;
  }

  function describeError(errs, { botBlock, permanentMsg, usedCookie }) {
    let err;
    if (/does not pass filter|larger than max-filesize|file is larger/i.test(errs)) {
      err = new Error(MAX_SECONDS > 0
        ? 'المقطع أطول من الحد المسموح (' + Math.round(MAX_SECONDS / 60) + ' دقيقة) — ارفع القيمة من إعدادات YT_MAX_SECONDS'
        : 'حجم المقطع أكبر من الحد المسموح — ارفع YT_MAX_FILESIZE أو أزله');
      err.code = 'too-long';
      err.permanent = true;
    } else if (permanentMsg) {
      err = new Error('المقطع غير متاح للتحميل (قد يكون خاصاً أو محذوفاً أو مقيّداً)');
      err.code = 'unavailable';
      err.permanent = true;
    } else if (botBlock) {
      err = new Error('يوتيوب يطلب تسجيل الدخول/التحقق من هذا الخادم — أضف كوكيز جديدة أو بروكسي');
      err.code = 'bot';
      err.botBlock = true;
    } else if (NET_RE.test(errs)) {
      err = new Error('تعذر الاتصال بيوتيوب من الخادم (شبكة/DNS/بروكسي) — تحقق من اتصال الخادم أو اضبط YTDLP_PROXY');
      err.code = 'network';
    } else {
      err = new Error(errs || 'فشل تنزيل صوت يوتيوب');
    }
    err.details = String(errs || '').slice(0, 1200);
    if (usedCookie) err.cookie = path.basename(usedCookie);
    return err;
  }

  async function downloadLowest(id, tmpDir) {
    await ensureYtDlp();
    const bin = findYtDlp(); if (!bin) throw new Error('yt-dlp غير مثبت');
    const attempts = buildAttempts();
    const errs = [];
    let botBlock = false, permanentMsg = '', lastCookie = '';

    for (let i = 0; i < attempts.length; i++) {
      const { cookie, extractor } = attempts[i];
      lastCookie = cookie || lastCookie;
      // لا نسمح لملف جزئي من محاولة فاشلة أن يُعتبر ملفاً صالحاً في المحاولة التالية.
      try { for (const n of fs.readdirSync(tmpDir)) if (/^src\./.test(n)) fs.unlinkSync(path.join(tmpDir, n)); } catch (e) { /* لا شيء */ }

      const args = [
        '-f', 'worstaudio/bestaudio',   // أقل جودة صوت متاحة دون تفضيل حاوية أكبر
        '--no-playlist', '--no-warnings', '--no-part', '--no-progress',
        '--retries', '5', '--fragment-retries', '5', '--socket-timeout', '20',
        '--concurrent-fragments', '4',
        '--no-cache-dir',
        '-o', path.join(tmpDir, 'src.%(ext)s')
      ];
      if (JS_RUNTIME && supportsJsRuntime(bin)) args.push('--js-runtimes', JS_RUNTIME);
      if (MAX_SECONDS > 0) args.push('--match-filter', 'duration<=' + MAX_SECONDS);
      if (MAX_FILESIZE) args.push('--max-filesize', MAX_FILESIZE);
      if (extractor) args.push('--extractor-args', extractor);
      if (process.env.YTDLP_PROXY) args.push('--proxy', process.env.YTDLP_PROXY);
      if (cookie) args.push('--cookies', cookie);
      else if (process.env.YTDLP_COOKIES_FROM_BROWSER) args.push('--cookies-from-browser', process.env.YTDLP_COOKIES_FROM_BROWSER);
      args.push('https://www.youtube.com/watch?v=' + id);

      const r = await runExec(bin, args, EXEC_TIMEOUT);
      const msg = (r.errOut + ' ' + r.out + ' ' + (r.err && r.err.message || '')).trim();
      const got = pickDownloaded(tmpDir);
      if (!r.err && got) return got;

      const short = (msg || 'فشل غير معروف').replace(/\s+/g, ' ').slice(0, 300);
      errs.push((cookie ? path.basename(cookie) : 'بدون كوكيز') + (extractor ? ' [' + extractor + ']' : '') + ': ' + short);
      if (BOT_RE.test(msg)) { botBlock = true; if (cookie) blockCookie(cookie); }
      if (PERMANENT_RE.test(msg)) { permanentMsg = msg; break; }
      if (/does not pass filter|larger than max-filesize|file is larger/i.test(msg)) { permanentMsg = msg; break; }
      // فشل عابر (شبكة/توقيت): انتظر قليلاً قبل المحاولة التالية
      if (i + 1 < attempts.length) await new Promise(res => setTimeout(res, 700 + i * 400));
    }
    throw describeError(errs.join(' | '), { botBlock, permanentMsg, usedCookie: lastCookie });
  }

  async function work(id) {
    const hit = existing(id);
    if (hit) return hit;
    const ffmpeg = findFfmpeg();
    if (!ffmpeg) {
      const e = new Error('ffmpeg غير مثبت على الخادم — ثبّته (Ubuntu/Debian: apt install ffmpeg) أو اضبط FFMPEG_PATH حتى يُحفظ الصوت بصيغة MP3');
      e.code = 'no-ffmpeg'; e.permanent = true;
      throw e;
    }

    const tmpDir = path.join(outDir, '.ytm-tmp-' + id + '-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      let src = cachedSource(id); // حوّل كاش m4a/webm القديم محلياً بدلاً من تنزيله مجدداً.
      if (!src) {
        try {
          src = await downloadLowest(id, tmpDir);
        } catch (e) {
          if (e.permanent) throw e;
          if (!altSource) throw e;
          // yt-dlp فشل (غالباً حجب IP الخادم): جرّب مصدر الصوت البديل، ثم حوّله إلى MP3.
          log('yt-dlp failed (' + (e.botBlock ? 'bot-block' : String(e.message).slice(0, 80)) + ') — trying alternate audio source for', id);
          try {
            const a = await altSource(id);
            src = { file: a.file, size: a.size };
          } catch (e2) {
            const err = new Error(e.message + ' — والبديل أيضاً فشل: ' + String(e2.message || e2).slice(0, 160));
            err.code = e.code; err.botBlock = e.botBlock; err.permanent = false;
            throw err;
          }
        }
      }

      const tmpOut = path.join(tmpDir, 'out.mp3');
      // وقت الترميز يتناسب مع حجم المصدر (32kbps مونو سريع جداً، لكن المقاطع الطويلة تحتاج وقتاً)
      const ffTimeout = Math.max(120000, Math.min(30 * 60 * 1000, Math.ceil((src.size || 0) / (1024 * 1024)) * 4000));
      const r = await runExec(ffmpeg, ['-y', '-v', 'error', '-i', src.file, '-vn', '-map_metadata', '-1',
        '-codec:a', 'libmp3lame', '-b:a', BITRATE, '-ac', '1', '-ar', '22050', tmpOut], ffTimeout);
      let ok = false; try { ok = fs.statSync(tmpOut).size > 1024; } catch (e) { /* لم يُنشأ */ }
      if (!ok || r.err) {
        const detail = (r.errOut || (r.err && r.err.message) || 'ffmpeg did not create an output file').trim().slice(0, 240);
        throw new Error('فشل تحويل الصوت إلى MP3: ' + detail);
      }
      const final = path.join(outDir, 'ytm-' + id + '.mp3');
      fs.renameSync(tmpOut, final);
      return { file: final, url: urlBase + '/ytm-' + id + '.mp3', format: 'mp3' };
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* غير مهم */ }
    }
  }

  function pump() {
    while (running < CONCURRENCY && waiting.length) {
      const job = waiting.shift();
      running++;
      const rec = jobs.get(job.id);
      if (rec) { rec.status = 'running'; rec.startedAt = Date.now(); }
      work(job.id).then((res) => {
        if (rec) { rec.status = 'done'; rec.finishedAt = Date.now(); rec.url = res.url; }
        job.resolve(res);
      }, (err) => {
        if (rec) { rec.status = 'error'; rec.finishedAt = Date.now(); rec.error = String(err && err.message || err).slice(0, 400); }
        job.reject(err);
      }).finally(() => { running--; pump(); });
    }
  }

  // يضيف مهمة (أو يعيد الموجودة). يعيد Promise<{url,file,format}>
  function queue(id) {
    if (!ID_RE.test(id)) return Promise.reject(new Error('معرّف غير صالح'));
    if (inflight.has(id)) return inflight.get(id);
    if (!jobs.has(id)) jobs.set(id, { id, status: 'queued', queuedAt: Date.now(), attempts: 0 });
    const rec = jobs.get(id);
    rec.status = 'queued'; rec.error = ''; rec.attempts = (rec.attempts || 0) + 1;
    const p = new Promise((resolve, reject) => { waiting.push({ id, resolve, reject }); pump(); });
    inflight.set(id, p);
    const clear = () => inflight.delete(id);
    p.then(clear, clear);
    return p;
  }

  function stats() {
    const list = [...jobs.values()].sort((a, b) => (b.queuedAt || 0) - (a.queuedAt || 0)).slice(0, 20);
    return {
      running,
      waiting: waiting.length,
      concurrency: CONCURRENCY,
      cookies: cookieList().map(f => ({ name: path.basename(f), blocked: cookieBlocked(f) })),
      jobs: list
    };
  }

  function job(id) { return jobs.get(id) || null; }

  // مسح حالة مقطع بعد حذفه/إعادة المحاولة اليدوية حتى يبدأ من جديد
  function reset(id) {
    if (id) jobs.delete(id); else jobs.clear();
  }

  return {
    queue, existing, findFfmpeg, stats, job, reset,
    limits: { bitrate: BITRATE, maxSeconds: MAX_SECONDS, maxFilesize: MAX_FILESIZE || 'unlimited', concurrency: CONCURRENCY, maxTries: MAX_TRIES }
  };
}

module.exports = { createYtMp3Saver };
