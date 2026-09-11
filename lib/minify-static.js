// =====================================================
//  تصغير JS/CSS عند الإرسال — بلا تغيير للملفات الأصلية
// =====================================================
// يقلّل حجم النقل وزمن تحليل المتصفح (خصوصاً style.css الحاجب للرسم) عبر
// تصغير المحتوى عند أول طلب وتخزينه مؤقتاً في الذاكرة + قرص (.cache/min)
// مفتاحه (المسار + وقت التعديل + الحجم) فيُبنى من جديد تلقائياً بعد أي تعديل.
// تبقى الملفات الأصلية مقروءة كما هي — التعديل لا يتطلب خطوة بناء منفصلة.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let _terserMinify = null;
let _CleanCSS = null;

function loadMinifiers() {
  if (!_terserMinify) {
    try { _terserMinify = require('terser').minify; } catch (e) { _terserMinify = false; }
  }
  if (!_CleanCSS) {
    try { _CleanCSS = require('clean-css'); } catch (e) { _CleanCSS = false; }
  }
}

const MEM = new Map();      // مفتاح كامل -> Promise<Buffer> (إزالة تكرار العمل المتزامن)
const DISK_DIR = path.join(__dirname, '..', '.cache', 'min');

function diskFile(fullKey, ext) {
  try { fs.mkdirSync(DISK_DIR, { recursive: true }); } catch (e) { }
  return path.join(DISK_DIR, crypto.createHash('sha1').update(fullKey).digest('hex') + ext);
}

// تصغير نصّ حسب الامتداد. يعيد النص الأصلي عند أي خطأ (أمان مطلق).
async function minifyText(ext, text) {
  if (ext === '.css' && _CleanCSS) {
    try {
      const out = new _CleanCSS({ level: 2 }).minify(text);
      if (out && !out.errors.length && typeof out.styles === 'string') return out.styles;
    } catch (e) { }
    return text;
  }
  if (ext === '.js' && _terserMinify) {
    try {
      const out = await _terserMinify(text, {
        compress: true,
        mangle: true,
        toplevel: false,          // لا يُعاد تسمية المتغيرات/الدوال العامة (تستخدمها ملفات أخرى)
        format: { comments: false }
      });
      if (out && typeof out.code === 'string') return out.code;
    } catch (e) { }
    return text;
  }
  return text;
}

// يحصل على النسخة المصغّرة (من الذاكرة أو القرص، أو يبنيها). يعيد Buffer.
async function getMinified(absFile, ext) {
  const stats = fs.statSync(absFile);
  const fullKey = `${absFile}::${stats.mtimeMs}::${stats.size}`;
  const hit = MEM.get(fullKey);
  if (hit) return hit;

  const promise = (async () => {
    // 1) قرص مؤقت (يبقى بين إعادات التشغيل ما دام الملف لم يتغيّر)
    const cached = diskFile(fullKey, ext);
    try {
      const buf = fs.readFileSync(cached);
      if (buf && buf.length) return buf;
    } catch (e) { }
    // 2) بناء جديد
    const src = fs.readFileSync(absFile, 'utf8');
    const out = await minifyText(ext, src);
    const buf = Buffer.from(out, 'utf8');
    try { fs.writeFileSync(cached, buf); } catch (e) { }
    return buf;
  })();

  MEM.set(fullKey, promise);
  return promise;
}

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

// مصنّع وسيط: يعترض GET/HEAD لملفات css/js داخل مجلد عامّ واحد (public/css|public/js)
// ويخدم النسخة المصغّرة؛ يمرر الطلب للتالي إن لم يكن الملف ضمن نطاقه.
function minifyStatic(dirName) {
  const publicDir = path.join(__dirname, '..', 'public');
  const rootDir = path.join(publicDir, dirName);
  const rootPrefix = rootDir.endsWith(path.sep) ? rootDir : rootDir + path.sep;

  return async function minifyHandler(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const rel = decodeURIComponent(String(req.path || ''));
    if (!rel || rel.includes('\0') || rel.includes('..')) return next();
    const ext = path.extname(rel).toLowerCase();
    if (!MIME[ext]) return next();

    const absFile = path.join(rootDir, rel);
    // حماية من الخروج خارج مجلد public/<dirName>
    if (!absFile.startsWith(rootPrefix)) return next();

    let stats;
    try { stats = fs.statSync(absFile); } catch (e) { return next(); }
    if (!stats.isFile()) return next();

    // نفس سياسة التخزين المعتمدة لملفات JS/CSS في الموقع: لا تخزين قديم بعد النشر.
    res.setHeader('Content-Type', MIME[ext]);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    try {
      const body = await getMinified(absFile, ext);
      res.status(200).send(body);
    } catch (e) {
      next(e);
    }
  };
}

// تسخين مسبق للملفات المعروفة حتى لا ينتظر أول مستخدم التصغير.
async function prewarm(files) {
  loadMinifiers();
  for (const rel of files) {
    const absFile = path.join(__dirname, '..', 'public', rel);
    const ext = path.extname(absFile).toLowerCase();
    if (!MIME[ext] || !fs.existsSync(absFile)) continue;
    getMinified(absFile, ext).catch(() => { });
  }
}

module.exports = { minifyStatic, prewarm };
