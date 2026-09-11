// =====================================================
//  ضغط صور GIF الكبيرة (الهدايا والدخول الملكي)
// =====================================================
// الهدف: أي صورة/GIF تتجاوز الحد (2 ميجا افتراضياً) تُضغط تلقائياً بعد الرفع
// مع الحفاظ على الحركة، بدون أي تدخل من المشرف.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const GIF_MAX_BYTES = Math.max(256 * 1024, Number(process.env.GIF_MAX_BYTES) || 2 * 1024 * 1024);

function hasBinary(binary) {
  try { execFileSync('which', [binary], { stdio: 'ignore' }); return true; }
  catch (e) { return false; }
}
const HAS_GIFSICLE = hasBinary('gifsicle');
const HAS_MAGICK = hasBinary('convert') || hasBinary('magick');
const MAGICK_BIN = hasBinary('magick') ? 'magick' : 'convert';

function fileSizeOf(filePath) {
  try { return fs.statSync(filePath).size; } catch (e) { return 0; }
}

// يضغط ملف صورة (GIF متحرك أو صورة عادية) ليصبح أصغر من الحد المطلوب.
// يعيد { compressed, before, after }. لا يفشل أبداً: عند تعذر الضغط يُبقي الأصل.
function compressUploadedImage(filePath, maxBytes = GIF_MAX_BYTES) {
  const before = fileSizeOf(filePath);
  if (!before || before <= maxBytes) return { compressed: false, before, after: before };
  const ext = path.extname(filePath).toLowerCase();
  const tmp = filePath + '.tmp' + ext;
  const tryRun = (bin, args) => {
    try {
      execFileSync(bin, args, { stdio: 'ignore', timeout: 120000 });
      const size = fileSizeOf(tmp);
      if (size > 0 && size < fileSizeOf(filePath)) return size;
    } catch (e) { }
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e) { }
    return 0;
  };

  if (ext === '.gif') {
    // مراحل تصاعدية: تقليل الألوان ثم الأبعاد حتى النزول تحت الحد.
    const steps = HAS_GIFSICLE ? [
      ['gifsicle', ['-O3', '--colors', '256', filePath, '-o', tmp]],
      ['gifsicle', ['-O3', '--colors', '128', '--lossy=40', filePath, '-o', tmp]],
      ['gifsicle', ['-O3', '--colors', '96', '--lossy=90', '--scale', '0.8', filePath, '-o', tmp]],
      ['gifsicle', ['-O3', '--colors', '64', '--lossy=140', '--scale', '0.6', filePath, '-o', tmp]],
      ['gifsicle', ['-O3', '--colors', '48', '--lossy=200', '--scale', '0.45', filePath, '-o', tmp]]
    ] : [];
    if (HAS_MAGICK) {
      steps.push([MAGICK_BIN, [filePath, '-coalesce', '-layers', 'optimize', '-fuzz', '5%', '+dither', '-colors', '128', tmp]]);
      steps.push([MAGICK_BIN, [filePath, '-coalesce', '-resize', '70%', '-layers', 'optimize', '-fuzz', '8%', '+dither', '-colors', '96', tmp]]);
      steps.push([MAGICK_BIN, [filePath, '-coalesce', '-resize', '50%', '-layers', 'optimize', '-fuzz', '12%', '+dither', '-colors', '64', tmp]]);
    }
    for (const [bin, args] of steps) {
      const size = tryRun(bin, args);
      if (!size) continue;
      try { fs.renameSync(tmp, filePath); } catch (e) { continue; }
      if (fileSizeOf(filePath) <= maxBytes) break;
    }
  } else if (HAS_MAGICK) {
    const steps = [
      [MAGICK_BIN, [filePath, '-strip', '-quality', '82', tmp]],
      [MAGICK_BIN, [filePath, '-strip', '-resize', '1400x1400>', '-quality', '75', tmp]],
      [MAGICK_BIN, [filePath, '-strip', '-resize', '1000x1000>', '-quality', '65', tmp]]
    ];
    for (const [bin, args] of steps) {
      const size = tryRun(bin, args);
      if (!size) continue;
      try { fs.renameSync(tmp, filePath); } catch (e) { continue; }
      if (fileSizeOf(filePath) <= maxBytes) break;
    }
  }
  const after = fileSizeOf(filePath);
  return { compressed: after < before, before, after };
}

// يعيد تكبير/تصغير صورة ثابتة (png/jpg/jpeg/webp) لتُلائم حدّاً أقصى للبعد دون
// تكبير الصور الأصغر، مع إزالة البيانات الوصفية. لا يمس GIF (الحفاظ على الحركة)
// ولا يفشل أبداً: عند تعذر المعالجة يُبقي الأصل كما هو.
function fitImage(filePath, maxDim = 1024) {
  const before = fileSizeOf(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (!HAS_MAGICK || !before || !['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    return { resized: false, before, after: before };
  }
  const tmp = filePath + '.fit' + ext;
  try {
    const args = [filePath, '-auto-orient', '-strip', '-resize', `${maxDim}x${maxDim}>`];
    if (ext === '.webp') args.push('-quality', '82');
    else if (ext === '.png') args.push('-define', 'png:compression-level=9');
    else args.push('-quality', '82');
    args.push(tmp);
    execFileSync(MAGICK_BIN, args, { stdio: 'ignore', timeout: 60000 });
    const size = fileSizeOf(tmp);
    if (size > 0 && size < before) {
      fs.renameSync(tmp, filePath);
      return { resized: true, before, after: size };
    }
    try { fs.unlinkSync(tmp); } catch (e) { }
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { }
  }
  return { resized: false, before, after: before };
}

// يولّد نسخة مصغّرة (thumbnail) من صورة: قصّ مربّع مركزي عند cover، أو ملاءمة داخل
// الأبعاد عند fit. يعيد true عند النجاح. يُستخدم لتوليد أحجام صغيرة من الصور
// المرفوعة (شعار/غرف/أيقونات) لتقليل حجم التنزيل على الشبكات البطيئة.
function makeThumb(srcAbs, outAbs, w, h, mode = 'cover') {
  if (!HAS_MAGICK) return false;
  try {
    const geom = mode === 'cover'
      ? [`${w}x${h}^`, '-gravity', 'center', '-extent', `${w}x${h}`]
      : [`${w}x${h}>`];
    execFileSync(MAGICK_BIN, [srcAbs, '-auto-orient', '-strip', '-resize', ...geom, '-quality', '82', outAbs],
      { stdio: 'ignore', timeout: 60000 });
    return fileSizeOf(outAbs) > 0;
  } catch (e) {
    try { if (fs.existsSync(outAbs)) fs.unlinkSync(outAbs); } catch (_) { }
    return false;
  }
}

module.exports = { compressUploadedImage, fitImage, makeThumb, GIF_MAX_BYTES, fileSizeOf, HAS_MAGICK, MAGICK_BIN };
