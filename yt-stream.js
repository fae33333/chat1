// yt-stream.js — يحمّل صوت يوتيوب كاملاً إلى القرص أولاً ثم يقدّمه من ملف محلي (يدعم Range).
// هذا يلغي تقطّع البث المباشر: المتصفح يقرأ من ملف محلي سريع وثابت.
const fs = require('fs');
const path = require('path');

const CHUNK = 2 * 1024 * 1024;
const MAX_BYTES = 80 * 1024 * 1024;
const MAX_FILES = 80;

function createYtStream({ resolve, fetchChunk, cacheDir, fallbackDownload, log = console.error }) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const inflight = new Map(); // videoId -> Promise<{file,size,mime}>

  const extOf = (mime) => (/webm/i.test(mime) ? 'webm' : 'm4a');
  const mimeOf = (file) => (file.endsWith('.webm') ? 'audio/webm' : 'audio/mp4');

  function findCached(id) {
    for (const ext of ['m4a', 'webm']) {
      const f = path.join(cacheDir, id + '.' + ext);
      try { const st = fs.statSync(f); if (st.size > 0) return { file: f, size: st.size, mime: mimeOf(f) }; } catch (e) {}
    }
    return null;
  }

  function prune() {
    try {
      const files = fs.readdirSync(cacheDir).map(n => { const f = path.join(cacheDir, n); const st = fs.statSync(f); return { f, t: st.mtimeMs }; })
        .sort((a, b) => b.t - a.t);
      files.slice(MAX_FILES).forEach(x => { try { fs.unlinkSync(x.f); } catch (e) {} });
    } catch (e) {}
  }

  // تحميل مرشّح واحد كاملاً؛ يرمي خطأ يحمل status عند رفض يوتيوب (403/410...) لننتقل لمرشّح آخر
  async function downloadWith(id, cand) {
    if (!cand.total || cand.total > MAX_BYTES) throw new Error('حجم الملف غير مناسب');
    const final = path.join(cacheDir, id + '.' + extOf(cand.mime));
    const tmp = final + '.part' + process.pid + '-' + Date.now();
    const fd = fs.openSync(tmp, 'w');
    try {
      let pos = 0, fails = 0;
      while (pos < cand.total) {
        const to = Math.min(pos + CHUNK - 1, cand.total - 1);
        let buf;
        try {
          const r = await fetchChunk(cand, pos, to);
          if (!(r.status === 200 || r.status === 206)) {
            try { await r.arrayBuffer(); } catch (x) {}
            const e = new Error('HTTP ' + r.status); e.status = r.status; throw e;
          }
          buf = Buffer.from(await r.arrayBuffer());
          if (!buf.length) throw new Error('empty chunk');
        } catch (e) {
          // 403/404/410 = الرابط مرفوض/منتهٍ: إعادة المحاولة على نفس الرابط لا تفيد، جرّب مرشّحاً آخر فوراً
          if ([400, 401, 403, 404, 410].includes(e.status)) throw e;
          if (++fails > 3) throw e;
          await new Promise(r => setTimeout(r, 300 * fails));
          continue;
        }
        if (buf.length > to - pos + 1) buf = buf.subarray(0, to - pos + 1);
        fs.writeSync(fd, buf, 0, buf.length, pos);
        pos += buf.length;                           // قد تُرجع الدفعة أقل من المطلوب — نكمل من حيث توقفت
      }
    } catch (e) { try { fs.closeSync(fd); } catch (x) {} try { fs.unlinkSync(tmp); } catch (x) {} throw e; }
    fs.closeSync(fd);
    fs.renameSync(tmp, final);
    prune();
    return { file: final, size: cand.total, mime: mimeOf(final) };
  }

  async function download(id, opts) {
    const errs = [];
    const tried = new Set();
    // yt-dlp أولاً إن وُجد: الأكثر موثوقية (يتعامل مع التوقيعات والتوكنات والحجب)
    if (typeof fallbackDownload === 'function' && !(opts && opts.skipFallback)) {
      try {
        const f = await fallbackDownload(id, cacheDir);
        if (f) { prune(); return { file: f, size: fs.statSync(f).size, mime: mimeOf(f) }; }
      } catch (e) { errs.push('yt-dlp: ' + e.message); log('yt-dlp failed:', e.message); }
    }
    // حتى جولتين: الجولة الثانية تعيد حل الروابط من جديد (روابط جديدة غير منتهية)
    for (let round = 0; round < 2; round++) {
      let cands;
      try { cands = await resolve(id); } catch (e) { errs.push('resolve: ' + e.message); continue; }
      if (!Array.isArray(cands)) cands = [cands];
      for (const cand of cands) {
        const key = (cand.client || 'x') + ':' + round;
        if (tried.has(key)) continue; tried.add(key);
        try { return await downloadWith(id, cand); }
        catch (e) { errs.push((cand.client || 'yt-dlp') + ' ' + e.message); log('yt candidate failed:', (cand.client || 'yt-dlp'), e.message); }
      }
    }
    throw new Error('download chunk failed: ' + errs.join(' || ').slice(0, 600));
  }

  function ensure(id, fresh, opts) {
    if (fresh && !inflight.has(id)) { for (const ext of ['m4a', 'webm']) { try { fs.unlinkSync(path.join(cacheDir, id + '.' + ext)); } catch (e) {} } }
    const hit = findCached(id);
    if (hit) { try { fs.utimesSync(hit.file, new Date(), new Date()); } catch (e) {} return Promise.resolve(hit); }
    if (!inflight.has(id)) {
      const p = download(id, opts).finally(() => inflight.delete(id));
      inflight.set(id, p);
    }
    return inflight.get(id);
  }

  async function handle(req, res, id, opts) {
    let info;
    try { info = await ensure(id, opts && opts.fresh); }
    catch (err) {
      log('youtube stream error:', err.message);
      if (!res.headersSent) {
        res.statusCode = 502; res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ success: false, error: String(err.message || 'فشل جلب الصوت').slice(0, 700) }));
      }
      return;
    }
    const total = info.size;
    let start = 0, end = total - 1, partial = false;
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      partial = true;
      if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), end); }
      else start = Math.max(0, total - Number(m[2]));
    }
    if (start > end || start >= total) { res.statusCode = 416; res.setHeader('Content-Range', 'bytes */' + total); return res.end(); }
    res.statusCode = partial ? 206 : 200;
    res.setHeader('Content-Type', info.mime);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', end - start + 1);
    res.setHeader('Cache-Control', 'no-store');
    if (partial) res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    if (req.method === 'HEAD') return res.end();
    const rs = fs.createReadStream(info.file, { start, end });
    res.on('close', () => rs.destroy());
    rs.on('error', () => { try { res.destroy(); } catch (e) {} });
    rs.pipe(res);
  }
  return { handle, ensure };
}
module.exports = { createYtStream };
