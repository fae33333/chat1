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

module.exports = { compressUploadedImage, GIF_MAX_BYTES, fileSizeOf };
