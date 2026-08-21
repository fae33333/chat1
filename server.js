// =====================================================
//  سيرفر شات نجوم العرب - Node.js + SQLite3 + Socket.IO
// =====================================================
const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const net = require('net');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { Server } = require('socket.io');
const db = require('./database');

const app = express();
const HTTPS_KEY_PATH = process.env.HTTPS_KEY || path.join(__dirname, 'key.pem');
const HTTPS_CERT_PATH = process.env.HTTPS_CERT || path.join(__dirname, 'cert.pem');
let HTTPS_ENABLED = false;
let server;
if (fs.existsSync(HTTPS_KEY_PATH) && fs.existsSync(HTTPS_CERT_PATH)) {
  try {
    server = https.createServer({ key: fs.readFileSync(HTTPS_KEY_PATH), cert: fs.readFileSync(HTTPS_CERT_PATH) }, app);
    HTTPS_ENABLED = true;
  } catch (error) {
    console.warn('⚠ تعذر قراءة شهادة HTTPS، سيتم تشغيل HTTP:', error.message);
  }
}
if (!server) server = http.createServer(app);
const io = new Server(server);

const PORT = +(process.env.PORT || (HTTPS_ENABLED ? 2083 : 3000));
const SERVER_PROTOCOL = HTTPS_ENABLED ? 'https' : 'http';

// عناوين Cloudflare الرسمية الموثوقة. بإضافتها إلى trust proxy يعيد Express عنوان
// الزائر من X-Forwarded-For بدلاً من عنوان خادم Cloudflare الظاهر للاتصال المباشر.
const CLOUDFLARE_PROXY_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'
];
// يشمل البروكسي المحلي (Nginx/Arena) إضافة إلى حواف Cloudflare فقط؛ لا نثق
// بعناوين عامة عشوائية كي لا يستطيع اتصال مباشر تزوير X-Forwarded-For.
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal', ...CLOUDFLARE_PROXY_RANGES]);
function normalizeIp(value) {
  let ip = String(value || '').split(',')[0].trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip.slice(0, 80);
}
function validIp(value) {
  const ip = normalizeIp(value);
  return net.isIP(ip) ? ip : '';
}
function requestHeader(req, name) {
  if (!req) return '';
  if (typeof req.get === 'function') return req.get(name) || '';
  return (req.headers && req.headers[String(name).toLowerCase()]) || '';
}
function requestComesThroughTrustedProxy(req) {
  const remote = validIp(req && req.socket && req.socket.remoteAddress);
  const trust = app.get('trust proxy fn');
  return !!(remote && typeof trust === 'function' && trust(remote, 0));
}
function requestIp(req) {
  const trustedProxy = requestComesThroughTrustedProxy(req);
  if (trustedProxy) {
    // Cloudflare يكتب هذا الرأس بنفسه عند الحافة؛ وهو أدق مصدر لعنوان الزائر.
    const cloudflareIp = validIp(requestHeader(req, 'cf-connecting-ip'));
    if (cloudflareIp) return cloudflareIp;
    const trueClientIp = validIp(requestHeader(req, 'true-client-ip'));
    if (trueClientIp) return trueClientIp;
  }
  // في طلبات Express يستخدم req.ip سلسلة البروكسي الموثوقة أعلاه. أما طلب
  // ترقية WebSocket الخام فنستخدم أول X-Forwarded-For فقط إذا كان البروكسي موثوقاً.
  const expressIp = validIp(req && req.ip);
  if (expressIp) return expressIp;
  if (trustedProxy) {
    const forwardedIp = validIp(requestHeader(req, 'x-forwarded-for'));
    if (forwardedIp) return forwardedIp;
  }
  return validIp(req && req.socket && req.socket.remoteAddress) || 'غير معروف';
}

app.disable('x-powered-by');

// حماية ضد هجمات التخمين والإغراق (Rate Limiting)
const RATE_LIMIT_STORE = new Map();
function checkRateLimit(key, maxLimit, windowMs) {
  const now = Date.now();
  let entry = RATE_LIMIT_STORE.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + windowMs };
    RATE_LIMIT_STORE.set(key, entry);
    return { ok: true, remaining: maxLimit - 1 };
  }
  entry.count++;
  if (entry.count > maxLimit) {
    return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { ok: true, remaining: maxLimit - entry.count };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of RATE_LIMIT_STORE.entries()) {
    if (now > entry.resetAt) RATE_LIMIT_STORE.delete(key);
  }
}, 5 * 60 * 1000).unref();

// ترويسات الأمان والحماية الشاملة (Security Headers)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self)');
  if (HTTPS_ENABLED) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// =====================================================
//  تتبع اتصالات المتواجدين في الدردشة وغرف المحادثة
// =====================================================
const onlineUsers = {};   // uid -> pubUser(+badge)
const userSockets = {};   // uid -> [socketId]
const roomUsers = {};     // roomId -> Set(uid)

function isUserActiveInChat(userId) {
  const uid = +userId;
  if (!uid) return false;
  const sockets = userSockets[uid];
  if (!sockets || !sockets.length) return false;
  return sockets.some(sid => {
    const s = io && io.sockets && io.sockets.sockets.get(sid);
    return s && s.connected && !s.disconnected;
  });
}

const sessionMw = session({
  secret: 'nujum-chat-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 30, secure: HTTPS_ENABLED, sameSite: 'lax', httpOnly: true }
});
app.use(sessionMw);
app.use(cookieParser('nujum-admin-device-secret-2026'));
io.use((socket, next) => sessionMw(socket.request, {}, next));

// وسيط فحص معدل طلبات الـ API (استثناء مسارات ومسؤولي لوحة الإدارة تماماً)
app.use('/api', (req, res, next) => {
  // مسارات لوحة الإدارة ومسؤولو الإدارة معفيين تماماً وبلا أي حدود من فحص المعدل
  if (req.path.startsWith('/admin') || (req.session && req.session.uid)) {
    return next();
  }
  const ip = requestIp(req);
  const limit = checkRateLimit('api:' + ip, 600, 60000);
  if (!limit.ok) {
    return res.status(429).json({ error: 'تم تجاوز الحد المسموح به من الطلبات، يرجى الانتظار قليلاً' });
  }
  next();
});

// إدارة الرموز العشوائية الديناميكية للوحة الإدارة (Dynamic Single-Session Admin Security Tokens)
const ADMIN_USER_TOKEN = new Map(); // userId -> { token, rank, username, ip, userAgent, deviceKey, createdAt }
const ADMIN_TOKEN_LOOKUP = new Map(); // token -> { uid, username, rank, ip, userAgent, deviceKey, createdAt }

function invalidateAdminTokens(userId) {
  const uid = +userId;
  const old = ADMIN_USER_TOKEN.get(uid);
  if (old && old.token) {
    ADMIN_TOKEN_LOOKUP.delete(old.token);
  }
  ADMIN_USER_TOKEN.delete(uid);
}

function issueAdminToken(user, req = null, res = null) {
  if (!user || !['admin', 'superadmin', 'supermaster'].includes(user.rank)) return null;
  const uid = +user.id;
  // إبطال أي رمز أمان قديم لهذا الحساب فوراً
  invalidateAdminTokens(uid);

  const token = 'adm_' + crypto.randomBytes(24).toString('hex');
  const deviceKey = 'dev_' + crypto.randomBytes(24).toString('hex');
  const ip = req ? normalizeIp(requestIp(req)) : '';
  const userAgent = req ? String(req.get('user-agent') || '').trim() : '';

  const record = { uid, username: user.username, rank: user.rank, ip, userAgent, deviceKey, createdAt: Date.now(), token };
  ADMIN_USER_TOKEN.set(uid, record);
  ADMIN_TOKEN_LOOKUP.set(token, record);

  if (res && typeof res.cookie === 'function') {
    res.cookie('nujum_adm_device', deviceKey, {
      httpOnly: true,
      sameSite: 'lax',
      secure: HTTPS_ENABLED,
      path: '/'
    });
  }

  return token;
}

function getActiveAdminToken(userId) {
  const rec = ADMIN_USER_TOKEN.get(+userId);
  return rec ? rec.token : null;
}

function validateAdminTokenRecord(record, req) {
  if (!record || !record.token) return false;
  const currentActive = ADMIN_USER_TOKEN.get(+record.uid);
  if (!currentActive || currentActive.token !== record.token) return false;

  // 1. التحقق الصارم من وجود المدير متصلاً في الدردشة في هذه اللحظة بالذات
  if (!isUserActiveInChat(record.uid)) {
    return false;
  }

  // 2. التحقق من تطابق عنوان الـ IP
  const reqIp = normalizeIp(requestIp(req));
  if (record.ip && reqIp && record.ip !== reqIp) {
    return false;
  }

  // 3. التحقق من تطابق متصفح وجهاز المصدر (User-Agent)
  const reqUA = String(req.get('user-agent') || '').trim();
  if (record.userAgent && reqUA && record.userAgent !== reqUA) {
    return false;
  }

  // 4. التحقق من مفتاح الجهاز السري في الكوكي (يضمن عدم فتح الرابط في متصفح أو جهاز آخر)
  const cookieKey = req.cookies && req.cookies.nujum_adm_device;
  if (record.deviceKey && (!cookieKey || cookieKey !== record.deviceKey)) {
    return false;
  }

  return true;
}

function resolveAdminAuth(req) {
  const headerToken = String(req.get('x-admin-token') || req.query.token || (req.session && req.session.adminToken) || '').trim();
  if (!headerToken) return null;

  const auth = ADMIN_TOKEN_LOOKUP.get(headerToken);
  if (!auth) return null;

  if (!validateAdminTokenRecord(auth, req)) {
    return null;
  }

  return auth;
}

// مسار محمي وديناميكي لفتح لوحة التحكم بالرمز العشوائي السري فقط
app.get(['/admin', '/admin.html'], async (req, res) => {
  const token = String(req.query.token || req.headers['x-admin-token'] || '').trim();
  const auth = token ? ADMIN_TOKEN_LOOKUP.get(token) : null;
  const isValid = auth && validateAdminTokenRecord(auth, req);

  if (!isValid) {
    const isPresentInChat = auth ? isUserActiveInChat(auth.uid) : false;
    const reasonText = !auth
      ? 'تم إبطال رمز الأمان القديم عند تسجيل الدخول أو التحديث داخل الدردشة.'
      : (!isPresentInChat
        ? 'يجب أن تكون متواجداً ومتصلاً داخل الدردشة في نفس الوقت لتتمكن من استخدام لوحة الإدارة.'
        : 'هذا الرابط مشفر ومربوط بالجهاز والمتصفح المصدر فقط، ولا يمكن فتحه من جهاز أو متصفح آخر.');

    return res.status(403).send(`
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>غير مصرح بالدخول | لوحة التحكم</title>
        <link rel="stylesheet" href="/icons/framework7-icons.css">
        <link rel="stylesheet" href="/css/fonts.css">
        <style>
          * { margin:0; padding:0; box-sizing:border-box; font-family:"Noto Sans Arabic","SF Arabic",Arial,sans-serif; }
          body { min-height:100vh; display:flex; align-items:center; justify-content:center; background:linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); color:#fff; padding:20px; text-align:center; }
          .card { max-width:440px; width:100%; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:24px; padding:36px 24px; backdrop-filter:blur(10px); box-shadow:0 25px 50px -12px rgba(0,0,0,0.5); }
          .icon { width:74px; height:74px; border-radius:50%; background:rgba(239,68,68,0.15); border:1.5px solid rgba(239,68,68,0.35); color:#ef4444; display:flex; align-items:center; justify-content:center; margin:0 auto 20px; font-size:36px; }
          h2 { font-size:19px; font-weight:900; margin-bottom:12px; color:#f8fafc; }
          p { font-size:13.5px; color:#94a3b8; line-height:1.8; margin-bottom:26px; }
          .btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; background:linear-gradient(135deg, #6366f1, #4f46e5); color:#fff; text-decoration:none; padding:12px 28px; border-radius:14px; font-weight:800; font-size:14px; box-shadow:0 4px 14px rgba(99,102,241,0.4); transition:transform 0.15s; }
          .btn:hover { transform:translateY(-2px); }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon"><i class="f7-icons">lock_shield_fill</i></div>
          <h2>رابط الإدارة غير متاح أو منتهي الصلاحية</h2>
          <p>${reasonText}<br>يرجى التوجه إلى الدردشة والضغط على زر <b>«لوحة التحكم الإدارية»</b> لتوليد رابط وصول آمن ومباشر.</p>
          <a href="/" class="btn"><i class="f7-icons">arrow_left</i> العودة إلى الدردشة</a>
        </div>
      </body>
      </html>
    `);
  }

  req.session.uid = auth.uid;
  req.session.rank = auth.rank;
  req.session.username = auth.username;
  req.session.adminToken = token;

  let adminHtml = fs.readFileSync(path.join(__dirname, 'admin_views/admin.html'), 'utf-8');
  adminHtml = adminHtml.replace('</head>', `<script>window.ACTIVE_ADMIN_TOKEN = "${token}";</script></head>`);
  res.send(adminHtml);
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ---------- رفع الملفات ----------
fs.mkdirSync(path.join(__dirname, 'public/uploads'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public/uploads/avatars'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public/uploads/gifts'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public/uploads/emojis'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public/uploads/rooms'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public/uploads/bots'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public/uploads/statuses'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public/uploads/wall'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public/uploads/chat'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public/uploads/calls'), { recursive: true });
function safeUploadFilename(originalName, defaultExt = '.png') {
  const ext = path.extname(originalName || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
  const cleanExt = ext && ext.length <= 6 ? ext : defaultExt;
  return `${Date.now()}_${crypto.randomBytes(12).toString('hex')}${cleanExt}`;
}

function cleanNameForFilename(name) {
  return String(name || 'user').trim().replace(/[/\\?%*:|"<>]/g, '_').slice(0, 30);
}

const callUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public/uploads/calls')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const cleanExt = ext && (ext === '.webm' || ext === '.ogg' || ext === '.m4a' || ext === '.mp4' || ext === '.wav') ? ext : '.webm';
    cb(null, `rec_${Date.now()}_${crypto.randomBytes(12).toString('hex')}${cleanExt}`);
  }
});
const uploadCallAudio = multer({ storage: callUploadStorage, limits: { fileSize: 100 * 1024 * 1024 } });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public/uploads')),
  filename: (req, file, cb) => cb(null, safeUploadFilename(file.originalname, '.png'))
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });
// رفع الهدايا/الإيموجي/الرمزيات من لوحة الإدارة (مجلدات فرعية)
const storageMedia = multer.diskStorage({
  destination: (req, file, cb) => {
    const sub = req.path.includes('emoji') ? 'emojis'
      : (req.path.includes('bot-avatar') ? 'bots'
      : (req.path.includes('room') ? 'rooms'
      : (req.path.includes('avatar') ? 'avatars'
      : 'gifts')));
    cb(null, path.join(__dirname, 'public/uploads', sub));
  },
  filename: (req, file, cb) => cb(null, safeUploadFilename(file.originalname, '.png'))
});
const uploadMedia = multer({ storage: storageMedia, limits: { fileSize: 8 * 1024 * 1024 } });

// رفع صور الحالات في مجلد مستقل، مع رفض أي ملف غير صوري.
const statusStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public/uploads/statuses')),
  filename: (req, file, cb) => cb(null, safeUploadFilename(file.originalname, '.jpg'))
});
const STATUS_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif',
  '.mp4', '.webm', '.mov', '.m4v',
  '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.opus'
]);
const uploadStatus = multer({
  storage: statusStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const type = String(file.mimetype || '').split('/')[0];
    const allowed = STATUS_EXTENSIONS.has(ext) && ['image', 'video', 'audio'].includes(type);
    cb(allowed ? null : new Error('يمكن رفع صورة أو فيديو أو ملف صوتي فقط'), allowed);
  }
});
const wallStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public/uploads/wall')),
  filename: (req, file, cb) => cb(null, safeUploadFilename(file.originalname, '.jpg'))
});
const WALL_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const uploadWallImage = multer({
  storage: wallStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowed = WALL_IMAGE_EXTENSIONS.has(ext) && String(file.mimetype || '').startsWith('image/');
    cb(allowed ? null : new Error('يمكن رفع صورة JPG أو PNG أو WEBP أو GIF فقط'), allowed);
  }
});
const WALL_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const uploadWallVideo = multer({
  storage: wallStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowed = WALL_VIDEO_EXTENSIONS.has(ext) && String(file.mimetype || '').startsWith('video/');
    cb(allowed ? null : new Error('يمكن رفع ملف فيديو MP4 أو WEBM أو MOV فقط'), allowed);
  }
});
const chatMediaStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public/uploads/chat')),
  filename: (req, file, cb) => cb(null, safeUploadFilename(file.originalname, '.png'))
});
const CHAT_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const CHAT_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.opus', '.webm']);
const uploadChatMedia = multer({
  storage: chatMediaStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '');
    const allowed = (CHAT_IMAGE_EXTENSIONS.has(ext) && (mime.startsWith('image/') || mime === 'application/octet-stream'))
      || (CHAT_AUDIO_EXTENSIONS.has(ext) && (mime.startsWith('audio/') || mime === 'application/octet-stream'));
    cb(allowed ? null : new Error('يمكن رفع صورة أو مقطع صوت فقط'), allowed);
  }
});
// لا نعتمد على الامتداد وMIME وحدهما: نفحص توقيع الملف الحقيقي قبل إعادته
// للعميل وقبل السماح بإرساله إلى الغرفة العامة.
function chatMediaSignatureMatches(filePath, type, extension) {
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(64);
    const bytes = fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd); fd = null;
    if (bytes < 4) return false;
    const ascii = (start, end) => head.subarray(start, end).toString('ascii');
    if (type === 'image') {
      if (extension === '.jpg' || extension === '.jpeg') return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
      if (extension === '.png') return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      if (extension === '.gif') return ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
      if (extension === '.webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
      return false;
    }
    if (extension === '.mp3') return ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
    if (extension === '.wav') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
    if (extension === '.ogg') return ascii(0, 4) === 'OggS';
    if (extension === '.opus') return ascii(0, 4) === 'OggS' || ascii(0, 8) === 'OpusHead';
    if (extension === '.webm') return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
    if (extension === '.m4a') return ascii(4, 8) === 'ftyp';
    if (extension === '.aac') return ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xf6) === 0xf0);
    return false;
  } catch (e) { return false; }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch (e) { } } }
}

// ====== أدوات مساعدة ======
const q = {
  get: (sql, ...p) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r))),
  all: (sql, ...p) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r))),
  run: (sql, ...p) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }))
};

// هوية مستقلة لكل صفحة شات. الرمز محفوظ في ذاكرة الصفحة والخادم فقط؛
// لذلك لا تنتقل هوية تبويب إلى تبويب آخر، وتختفي من العميل عند التحديث.
const CHAT_TOKENS = new Map();
const CHAT_TOKEN_TTL = 12 * 60 * 60 * 1000;
function issueChatToken(user, ip) {
  const token = crypto.randomBytes(32).toString('hex');
  CHAT_TOKENS.set(token, { uid: +user.id, rank: user.rank || 'user', ip: normalizeIp(ip), createdAt: Date.now() });
  return token;
}
function chatTokenFromRequest(req) {
  return String(req.get('x-chat-token') || '').trim();
}
function chatAuthByToken(token) {
  const auth = token && CHAT_TOKENS.get(String(token));
  if (!auth) return null;
  if (Date.now() - auth.createdAt > CHAT_TOKEN_TTL) {
    CHAT_TOKENS.delete(String(token));
    return null;
  }
  return auth;
}
function resolveRequestAuth(req) {
  const isChatClient = req.get('x-chat-client') === '1';
  if (isChatClient) {
    const token = chatTokenFromRequest(req);
    const auth = chatAuthByToken(token);
    return auth ? { ...auth, token, source: 'chat' } : null;
  }
  return req.session && req.session.uid
    ? { uid: +req.session.uid, rank: req.session.rank || 'user', source: 'session' }
    : null;
}
setInterval(() => {
  const cutoff = Date.now() - CHAT_TOKEN_TTL;
  for (const [token, auth] of CHAT_TOKENS) if (auth.createdAt < cutoff) CHAT_TOKENS.delete(token);
}, 60 * 60 * 1000).unref();

async function getSettings() {
  const rows = await q.all(`SELECT key,value FROM settings`);
  const s = {};
  rows.forEach(r => s[r.key] = r.value);
  return s;
}
function membershipAccessKey(user) {
  if (!user || !user.registered) return 'guest';
  if (user.membership && user.membership !== 'none') return user.membership;
  return 'registered';
}
async function canUseMembershipFeature(userId, settingKey) {
  const user = await q.get(`SELECT registered,membership,rank FROM users WHERE id=?`, +userId);
  if (!user) return false;
  if (['roomadmin', 'admin', 'superadmin', 'supermaster'].includes(user.rank)) return true;
  const settings = await getSettings();
  const allowed = String(settings[settingKey] || '').split(',').map(value => value.trim()).filter(Boolean);
  return allowed.includes(membershipAccessKey(user));
}
// مجموعة الموثقين (شارة ✓ الزرقاء)
let VERIFIED_SET = new Set();
async function refreshVerified() {
  try {
    const rows = await q.all(`SELECT username FROM verified`);
    VERIFIED_SET = new Set(rows.map(r => r.username));
  } catch (e) { }
}
refreshVerified();
setTimeout(refreshVerified, 1200);
setInterval(refreshVerified, 15000);
async function broadcastVerificationState(username) {
  const verified = VERIFIED_SET.has(username) ? 1 : 0;
  for (const id of Object.keys(onlineUsers)) {
    if (onlineUsers[id] && onlineUsers[id].username === username) onlineUsers[id].verified = verified;
  }
  await Promise.all(Object.keys(roomUsers).map(rid => emitRoomUsers(rid)));
  io.emit('verification_changed', { username, verified });
}
function pubUser(u) {
  if (!u) return null;
  return {
    id: +u.id,
    username: String(u.username || ''),
    gender: String(u.gender || 'secret'),
    age: +u.age || 0,
    country: String(u.country || ''),
    balance: Math.max(0, +u.balance || 0),
    membership: String(u.membership || 'none'),
    rank: String(u.rank || 'user'),
    registered: u.registered ? 1 : 0,
    free_call_used: u.free_call_used ? 1 : 0,
    avatar: String(u.avatar || ''),
    status: String(u.status || 'متصل'),
    bio: String(u.bio || ''),
    muted: u.muted ? 1 : 0,
    is_bot: u.is_bot ? 1 : 0,
    verified: VERIFIED_SET.has(u.username) ? 1 : 0
  };
}
function requireUser(req, res, next) {
  const auth = resolveRequestAuth(req);
  if (!auth) return res.status(401).json({ error: 'غير مسجل في هذه الصفحة' });
  req.authUid = +auth.uid;
  req.authRank = auth.rank || 'user';
  req.authIp = normalizeIp(auth.ip || requestIp(req));
  req.chatToken = auth.token || '';
  next();
}
async function requireRoomNotKicked(req, res, next) {
  try {
    const user = await q.get(`SELECT registered,ip FROM users WHERE id=?`, req.authUid);
    if (!user) return res.status(401).json({ error: 'المستخدم غير موجود' });
    const roomId = +req.params.id;
    const ip = normalizeIp(req.authIp || user.ip);
    const kick = !user.registered && ip
      ? await q.get(`SELECT id,reason FROM room_kicks WHERE room_id=? AND ip=? LIMIT 1`, roomId, ip)
      : await q.get(`SELECT id,reason FROM room_kicks WHERE room_id=? AND user_id=? LIMIT 1`, roomId, req.authUid);
    if (kick) return res.status(403).json({
      reason: 'kicked',
      error: 'أنت مطرود من هذه الغرفة' + (kick.reason ? ': ' + kick.reason : '')
    });
    next();
  } catch (e) { res.status(500).json({ error: 'تعذر التحقق من صلاحية دخول الغرفة' }); }
}
function requireAdmin(req, res, next) {
  const adminAuth = resolveAdminAuth(req);
  if (!adminAuth || !['admin', 'superadmin', 'supermaster'].includes(adminAuth.rank))
    return res.status(403).json({ error: 'ممنوع - جلسة أو رابط الإدارة منتهي الصلاحية' });
  req.adminAuth = adminAuth;
  if (req.session) {
    req.session.uid = adminAuth.uid;
    req.session.rank = adminAuth.rank;
    req.session.username = adminAuth.username;
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  const adminAuth = resolveAdminAuth(req);
  if (!adminAuth || !['superadmin', 'supermaster'].includes(adminAuth.rank))
    return res.status(403).json({ error: 'هذه الصلاحية خاصة بالسوبر ادمن والمالك فقط' });
  req.adminAuth = adminAuth;
  if (req.session) {
    req.session.uid = adminAuth.uid;
    req.session.rank = adminAuth.rank;
    req.session.username = adminAuth.username;
  }
  next();
}

function requireSuperMaster(req, res, next) {
  const adminAuth = resolveAdminAuth(req);
  if (!adminAuth || adminAuth.rank !== 'supermaster')
    return res.status(403).json({ error: 'هذه الصلاحية خاصة بمالك الدردشة (supermaster) فقط' });
  req.adminAuth = adminAuth;
  if (req.session) {
    req.session.uid = adminAuth.uid;
    req.session.rank = adminAuth.rank;
    req.session.username = adminAuth.username;
  }
  next();
}
// صلاحيات الإشراف داخل الغرفة تشمل «ادمن غرفة»، مع قراءة الرتبة الحالية
// من قاعدة البيانات حتى لا تسبب الجلسة القديمة خطأ 403 بعد تغيير الصلاحية.
async function requireModerator(req, res, next) {
  const auth = resolveRequestAuth(req);
  if (!auth) return res.status(401).json({ error: 'غير مسجل في هذه الصفحة' });
  try {
    const moderator = await q.get(`SELECT id,username,rank FROM users WHERE id=?`, auth.uid);
    if (!moderator) return res.status(401).json({ error: 'المستخدم غير موجود' });

    const roomId = +(req.body.room_id || req.query.room_id || req.params.room_id || 0);
    const isGlobalStaff = ['admin', 'superadmin', 'supermaster'].includes(moderator.rank);
    let isRoomAdminHere = false;
    if (roomId) {
      const ra = await q.get(`SELECT id FROM room_admins WHERE room_id=? AND user_id=?`, roomId, moderator.id);
      if (ra) isRoomAdminHere = true;
    }

    if (!isGlobalStaff && !isRoomAdminHere && moderator.rank !== 'roomadmin')
      return res.status(403).json({ error: 'لا تملك صلاحية الإشراف في هذه الغرفة' });

    req.authUid = +moderator.id;
    req.authRank = isGlobalStaff ? moderator.rank : (isRoomAdminHere ? 'roomadmin' : moderator.rank);
    if (auth.source === 'session') req.session.rank = req.authRank;
    else if (auth.token && CHAT_TOKENS.has(auth.token)) CHAT_TOKENS.get(auth.token).rank = req.authRank;
    req.moderator = { ...moderator, rank: req.authRank };
    next();
  } catch (e) { res.status(500).json({ error: 'تعذر التحقق من الصلاحية' }); }
}
const MOD_RANK_LEVEL = { user: 0, roomadmin: 1, admin: 2, superadmin: 3, supermaster: 4 };
function allowModerationAction(req, res, target, roomRequired = false) {
  const moderator = req.moderator;
  if (!moderator || !target) return false;
  if (+target.id === +moderator.id) {
    res.status(400).json({ error: 'لا يمكنك تنفيذ هذا الإجراء على نفسك' });
    return false;
  }
  if ((MOD_RANK_LEVEL[target.rank] || 0) >= (MOD_RANK_LEVEL[moderator.rank] || 0)) {
    res.status(403).json({ error: 'لا يمكنك الإشراف على مستخدم بصلاحية مساوية أو أعلى' });
    return false;
  }
  // ادمن الغرفة يستطيع إدارة الموجودين معه في الغرفة الحالية فقط.
  if (moderator.rank === 'roomadmin' || roomRequired) {
    const roomId = +req.body.room_id;
    if (!roomId) {
      res.status(400).json({ error: 'الغرفة غير محددة' });
      return false;
    }
    if (moderator.rank === 'roomadmin' && (!roomUsers[roomId] || !roomUsers[roomId].has(+moderator.id) || !roomUsers[roomId].has(+target.id))) {
      res.status(403).json({ error: 'يمكنك الإشراف على مستخدمي غرفتك الحالية فقط' });
      return false;
    }
  }
  return true;
}
function requireSuper(req, res, next) {
  const adminAuth = resolveAdminAuth(req);
  if (!adminAuth || !['superadmin', 'supermaster'].includes(adminAuth.rank))
    return res.status(403).json({ error: 'ممنوع - سوبر ادمين أو مالك فقط' });
  req.adminAuth = adminAuth;
  if (req.session) {
    req.session.uid = adminAuth.uid;
    req.session.rank = adminAuth.rank;
    req.session.username = adminAuth.username;
  }
  next();
}

// أيقونة الشارة حسب الرتبة/العضوية
function badgeOf(u) {
  const rankBadges = { supermaster: 'superadmin.png', superadmin: 'superadmin.png', admin: 'admin.png', roomadmin: 'roomadmin.png' };
  if (rankBadges[u.rank]) return rankBadges[u.rank];
  if (u.membership === 'mmez') return 'mmez.png';
  if (u.membership === 'vip') return 'vip.png';
  if (u.membership === 'premium') return 'premium.png';
  if (u.membership === 'plus') return 'plus.png';
  if (u.registered) return 'register.png';
  return 'guest.png';
}

// =====================================================
//  API - المصادقة
// =====================================================
async function guestIpBan(ip) {
  if (!ip) return null;
  return q.get(`SELECT id,reason FROM bans WHERE ip=? ORDER BY id DESC LIMIT 1`, ip);
}
async function guestIpMute(ip) {
  if (!ip) return null;
  return q.get(`SELECT id FROM ip_mutes WHERE ip=? LIMIT 1`, ip);
}
async function finishAuthentication(req, res, user, extraPayload = {}) {
  const ip = requestIp(req);
  let fresh = user;
  if (ip) {
    if (!user.registered) {
      const mutedByIp = await guestIpMute(ip);
      await q.run(`UPDATE users SET ip=?, muted=? WHERE id=?`, ip, mutedByIp ? 1 : 0, user.id);
    } else {
      await q.run(`UPDATE users SET ip=? WHERE id=?`, ip, user.id);
    }
    fresh = await q.get(`SELECT * FROM users WHERE id=?`, user.id);
  }
  const payload = { user: pubUser(fresh), badge: badgeOf(fresh), ...extraPayload };
  if (['admin', 'superadmin', 'supermaster'].includes(fresh.rank)) {
    const adminToken = issueAdminToken(fresh, req, res);
    payload.admin_access_token = adminToken;
    payload.admin_url = `/admin?token=${adminToken}`;
  }
  if (req.get('x-chat-client') === '1') {
    const previousToken = chatTokenFromRequest(req);
    if (previousToken) CHAT_TOKENS.delete(previousToken);
    payload.tab_token = issueChatToken(fresh, ip);
    return res.json(payload);
  }
  req.session.uid = fresh.id;
  req.session.rank = fresh.rank;
  res.json(payload);
}

app.post('/api/login', async (req, res) => {
  const ip = requestIp(req);
  const limit = checkRateLimit('login:' + ip, 8, 60000);
  if (!limit.ok) return res.status(429).json({ error: 'تم تجاوز الحد الأقصى لمحاولات تسجيل الدخول، يرجى المحاولة بعد قليل' });
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'أدخل اسم المستخدم وكلمة المرور' });
  const cleanUsername = String(username).trim();
  const u = await q.get(`SELECT * FROM users WHERE username=?`, cleanUsername);
  if (!u || !u.password || !bcrypt.compareSync(String(password), u.password))
    return res.status(400).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  const ipBan = await guestIpBan(ip);
  if (ipBan) return res.status(403).json({ error: 'عنوان IP الخاص بك محظور' + (ipBan.reason ? ': ' + ipBan.reason : '') });
  if (u.banned) return res.status(403).json({ error: 'هذا الحساب محظور' });
  await finishAuthentication(req, res, u);
});

app.post('/api/guest', async (req, res) => {
  const ip = requestIp(req);
  const limit = checkRateLimit('guest:' + ip, 15, 60000);
  if (!limit.ok) return res.status(429).json({ error: 'يرجى الانتظار قليلاً قبل الدخول كزائر' });
  let { username, gender } = req.body || {};
  username = String(username || '').trim().slice(0, 20);
  if (!username) return res.status(400).json({ error: 'اكتب اسم المستخدم' });
  const ipBan = await guestIpBan(ip);
  if (ipBan) return res.status(403).json({ error: 'عنوان IP الخاص بك محظور' + (ipBan.reason ? ': ' + ipBan.reason : '') });

  let u = await q.get(`SELECT * FROM users WHERE username=?`, username);
  let renamedFrom = '';

  // فحص هل الاسم متواجد حالياً بالدردشة في الوقت الفعلي
  const isOnlineInChatNow = (name) => {
    return Object.values(onlineUsers).some(ou => ou && ou.username && ou.username.toLowerCase() === name.toLowerCase());
  };

  const isRegisteredAccount = !!(u && u.registered);
  const isCurrentlyInChat = isOnlineInChatNow(username);

  // لا يتم إلحاق أرقام بالاسم إلا إذا كان مسجلاً كعضوية أو متواجداً بالدردشة بالوقت الفعلي
  if (isRegisteredAccount || isCurrentlyInChat) {
    renamedFrom = username;
    const stem = username.slice(0, 15);
    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = `${stem} ${crypto.randomInt(1000, 10000)}`;
      const candidateExistsInDb = await q.get(`SELECT id FROM users WHERE username=?`, candidate);
      const candidateOnline = isOnlineInChatNow(candidate);
      if (!candidateExistsInDb && !candidateOnline) {
        username = candidate;
        u = null;
        break;
      }
    }
    if (u && (isRegisteredAccount || isCurrentlyInChat)) {
      return res.status(500).json({ error: 'تعذر إنشاء اسم زائر بديل، حاول مرة أخرى' });
    }
  }

  // إذا لم يكن الاسم مسجلاً وغير متواجد في الدردشة حالياً، يدخل باسمه الأصلي مباشرة بدون أرقام
  if (!u) {
    const r = await q.run(`INSERT INTO users (username,gender,registered,membership,rank) VALUES (?,?,0,'none','user')`, username, gender || 'secret');
    u = await q.get(`SELECT * FROM users WHERE id=?`, r.lastID);
  }
  if (u.banned) { await q.run(`UPDATE users SET banned=0 WHERE id=?`, u.id); u.banned = 0; }
  await finishAuthentication(req, res, u, renamedFrom ? { guest_name_changed: true, requested_username: renamedFrom } : {});
});

app.post('/api/register', async (req, res) => {
  const ip = requestIp(req);
  const limit = checkRateLimit('reg:' + ip, 6, 300000);
  if (!limit.ok) return res.status(429).json({ error: 'تم تجاوز عدد محاولات التسجيل، يرجى المحاولة لاحقاً' });
  const { username, password, gender, age, country, bio } = req.body || {};
  const cleanUsername = String(username || '').trim().slice(0, 20);
  const cleanPassword = String(password || '');
  const cleanBio = String(bio || '').trim().slice(0, 150);
  if (!cleanUsername || !cleanPassword) return res.status(400).json({ error: 'أكمل الحقول المطلوبة' });
  if (cleanPassword.length < 4) return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 4 خانات' });
  const ipBan = await guestIpBan(ip);
  if (ipBan) return res.status(403).json({ error: 'لا يمكن التسجيل من عنوان IP محظور' });

  const settings = await getSettings();
  const rawGold = settings.register_gold !== undefined && settings.register_gold !== null && String(settings.register_gold).trim() !== ''
    ? Number(settings.register_gold)
    : 10;
  const initialGold = Number.isFinite(rawGold) ? Math.min(100000, Math.max(0, Math.floor(rawGold))) : 10;

  const ex = await q.get(`SELECT id FROM users WHERE username=?`, cleanUsername);
  if (ex) {
    // ضيف يحوّل حسابه لمسجل
    const old = await q.get(`SELECT * FROM users WHERE username=?`, cleanUsername);
    if (old.registered) return res.status(400).json({ error: 'الاسم مستخدم مسبقا' });
    await q.run(`UPDATE users SET password=?,gender=?,age=?,country=?,bio=?,registered=1,balance=balance+? WHERE id=?`,
      bcrypt.hashSync(cleanPassword, 10), gender || 'secret', Math.min(100, Math.max(10, +age || 25)), String(country || '').slice(0, 30), cleanBio, initialGold, old.id);
    await refreshUserEverywhere(old.id);   // تحديث الاسم/الصورة مباشرة لمن بداخل الغرف
    io.emit('sync');
    const fresh = await q.get(`SELECT * FROM users WHERE id=?`, old.id);
    return finishAuthentication(req, res, fresh);
  }
  const r = await q.run(`INSERT INTO users (username,password,gender,age,country,bio,registered,balance) VALUES (?,?,?,?,?,?,1,?)`,
    cleanUsername, bcrypt.hashSync(cleanPassword, 10), gender || 'secret', Math.min(100, Math.max(10, +age || 25)), String(country || '').slice(0, 30), cleanBio, initialGold);
  const u = await q.get(`SELECT * FROM users WHERE id=?`, r.lastID);
  io.emit('sync');
  await finishAuthentication(req, res, u);
});

// لوحة الإدارة تستخدم جلسة الكوكي أو الرمز الديناميكي
app.get('/api/me', async (req, res) => {
  const adminAuth = resolveAdminAuth(req);
  const uid = adminAuth ? +adminAuth.uid : (req.session && req.session.uid ? +req.session.uid : 0);
  if (!uid) return res.json({ user: null });
  const u = await q.get(`SELECT * FROM users WHERE id=?`, uid);
  if (!u) return res.json({ user: null });
  if (['admin', 'superadmin', 'supermaster'].includes(u.rank)) {
    const activeToken = getActiveAdminToken(u.id);
    return res.json({
      user: { ...pubUser(u), email: u.email || '' },
      badge: badgeOf(u),
      admin_access_token: activeToken,
      admin_url: activeToken ? `/admin?token=${activeToken}` : null
    });
  }
  res.json({ user: { ...pubUser(u), email: u.email || '' }, badge: badgeOf(u) });
});

// صفحة الشات لا تستعيد أي اسم من الكوكي؛ يلزم رمز الصفحة الموجود في الذاكرة.
app.get('/api/chat/me', async (req, res) => {
  const auth = resolveRequestAuth(req);
  if (!auth || auth.source !== 'chat') return res.json({ user: null });
  const u = await q.get(`SELECT * FROM users WHERE id=?`, auth.uid);
  if (!u) return res.json({ user: null });
  
  // عند عمل رفرش للدردشة، يتم إبطال أي رابط إدارة سابق فوراً!
  if (['admin', 'superadmin', 'supermaster'].includes(u.rank)) {
    invalidateAdminTokens(u.id);
  }

  res.json({ user: { ...pubUser(u), email: u.email || '' }, badge: badgeOf(u) });
});

// توليد رابط ورمز أمان ديناميكي للدخول إلى لوحة التحكم من داخل الدردشة
app.post('/api/chat/admin-access-token', requireUser, async (req, res) => {
  const user = await q.get(`SELECT id, username, rank FROM users WHERE id=?`, req.authUid);
  if (!user || !['admin', 'superadmin', 'supermaster'].includes(user.rank)) {
    return res.status(403).json({ error: 'ليس لديك صلاحية لوحة الإدارة' });
  }
  // توليد رمز أمان عشوائي جديد وإبطال أي رمز قديم فوراً، مع ربطه بمتصفح وجهاز المدير
  const adminToken = issueAdminToken(user, req, res);
  res.json({
    ok: true,
    admin_token: adminToken,
    admin_url: `/admin?token=${adminToken}`
  });
});

app.post('/api/logout', (req, res) => {
  const auth = resolveRequestAuth(req);
  if (auth && auth.uid) {
    invalidateAdminTokens(auth.uid);
  }
  if (req.session && req.session.uid) {
    invalidateAdminTokens(req.session.uid);
  }
  res.clearCookie('nujum_adm_device');
  if (req.get('x-chat-client') === '1') {
    const token = chatTokenFromRequest(req);
    if (token) CHAT_TOKENS.delete(token);
    return res.json({ ok: true });
  }
  req.session.destroy(() => res.json({ ok: true }));
});

// =====================================================
//  API - الشات (غرف، مستخدمون، هدايا، ترقية...)
// =====================================================
app.get('/api/rooms', async (req, res) => {
  const rooms = await q.all(`SELECT id, name, description, image, type, max_users, sort, status, password FROM rooms ORDER BY sort,id`);
  const counts = {};
  Object.entries(roomUsers).forEach(([rid, set]) => counts[rid] = set.size);
  res.json(rooms.map(r => ({
    id: +r.id,
    name: String(r.name || ''),
    description: String(r.description || ''),
    image: String(r.image || ''),
    sort: +r.sort || 0,
    type: String(r.type || 'default'),
    max_users: +r.max_users || 1000,
    status: String(r.status || 'open'),
    online: counts[r.id] || 0,
    locked: !!(r.password && String(r.password).trim().length > 0)
  })));
});

app.get('/api/rooms/:id', async (req, res) => {
  const roomId = +req.params.id;
  if (!roomId) return res.status(400).json({ error: 'معرّف الغرفة غير صالح' });
  const room = await q.get(`SELECT id, name, description, image, type, max_users, sort, status, password FROM rooms WHERE id=?`, roomId);
  if (!room) return res.status(404).json({ error: 'الغرفة غير موجودة' });
  res.json({
    id: +room.id,
    name: String(room.name || ''),
    description: String(room.description || ''),
    image: String(room.image || ''),
    sort: +room.sort || 0,
    type: String(room.type || 'default'),
    max_users: +room.max_users || 1000,
    status: String(room.status || 'open'),
    online: (roomUsers[room.id] && roomUsers[room.id].size) || 0,
    locked: !!(room.password && String(room.password).trim().length > 0)
  });
});

app.get('/api/rooms/:id/messages', requireUser, requireRoomNotKicked, async (req, res) => {
  const roomId = +req.params.id;
  if (!roomId) return res.status(400).json({ error: 'معرّف الغرفة غير صالح' });
  const msgs = await q.all(`SELECT id, room_id, user_id, username, text, type, extra, created_at FROM messages WHERE room_id=? ORDER BY id DESC LIMIT 60`, roomId);
  res.json(msgs.reverse());
});

app.get('/api/rooms/:id/users', requireUser, requireRoomNotKicked, async (req, res) => {
  const roomId = +req.params.id;
  const set = roomUsers[roomId];
  if (!set) return res.json([]);
  const users = [];
  for (const uid of set) {
    const u = onlineUsers[uid];
    if (u) users.push(u);
  }
  res.json(users);
});

app.get('/api/user/:id', requireUser, async (req, res) => {
  const u = await q.get(`SELECT * FROM users WHERE id=?`, req.params.id);
  if (!u) return res.status(404).json({ error: 'غير موجود' });
  const gifts = await q.all(`SELECT * FROM gifts_log WHERE to_id=? ORDER BY id DESC LIMIT 30`, u.id);
  res.json({ user: pubUser(u), badge: badgeOf(u), gifts });
});

async function usersIgnoreEachOther(firstId, secondId) {
  return q.get(`
    SELECT id FROM user_ignores
    WHERE (user_id=? AND ignored_id=?) OR (user_id=? AND ignored_id=?)
    LIMIT 1`, firstId, secondId, secondId, firstId);
}

app.get('/api/ignores', requireUser, async (req, res) => {
  const rows = await q.all(`
    SELECT u.* FROM user_ignores i
    JOIN users u ON u.id=i.ignored_id
    WHERE i.user_id=? ORDER BY i.created_at DESC`, req.authUid);
  res.json(rows.map(u => ({ ...pubUser(u), badge: badgeOf(u) })));
});

app.post('/api/ignore/:id', requireUser, async (req, res) => {
  const ignoredId = +req.params.id;
  if (!ignoredId) return res.status(400).json({ error: 'المستخدم غير صالح' });
  if (ignoredId === +req.authUid) return res.status(400).json({ error: 'لا يمكنك تجاهل نفسك' });
  const target = await q.get(`SELECT id FROM users WHERE id=?`, ignoredId);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  const ignored = req.body && req.body.ignored ? 1 : 0;
  if (ignored) await q.run(`INSERT OR IGNORE INTO user_ignores (user_id,ignored_id) VALUES (?,?)`, req.authUid, ignoredId);
  else await q.run(`DELETE FROM user_ignores WHERE user_id=? AND ignored_id=?`, req.authUid, ignoredId);
  io.to('user_' + req.authUid).emit('ignore_changed', { otherId: ignoredId, ignored: !!ignored });
  io.to('user_' + ignoredId).emit('ignore_changed', { otherId: +req.authUid, ignoredByOther: !!ignored });
  res.json({ ok: true, ignored });
});

// الرسائل الخاصة
app.get('/api/private', requireUser, async (req, res) => {
  const uid = req.authUid;
  const rows = await q.all(`
    SELECT p.*, u.username other_name, u.avatar other_avatar, u.gender other_gender,
           u.membership other_mem, u.rank other_rank, u.registered other_registered, u.id other_id
    FROM private_messages p JOIN users u ON (u.id = CASE WHEN p.from_id=? THEN p.to_id ELSE p.from_id END)
    WHERE p.from_id=? OR p.to_id=? ORDER BY p.id DESC`, uid, uid, uid);
  const ignoreRows = await q.all(`SELECT user_id,ignored_id FROM user_ignores WHERE user_id=? OR ignored_id=?`, uid, uid);
  const hiddenPrivateUsers = new Set(ignoreRows.map(i => +(i.user_id === uid ? i.ignored_id : i.user_id)));
  const seen = {};
  const convs = [];
  for (const r of rows) {
    const oid = r.from_id === uid ? r.to_id : r.from_id;
    if (hiddenPrivateUsers.has(+oid) || seen[oid]) continue;
    seen[oid] = 1;
    const unread = await q.get(`SELECT COUNT(*) c FROM private_messages WHERE from_id=? AND to_id=? AND read=0`, oid, uid);
    convs.push({
      id: oid, username: r.other_name, avatar: r.other_avatar, gender: r.other_gender,
      membership: r.other_mem, rank: r.other_rank, registered: r.other_registered ? 1 : 0,
      verified: VERIFIED_SET.has(r.other_name) ? 1 : 0, last: r.text, at: r.created_at,
      unread: +unread.c || 0
    });
  }
  res.json(convs);
});

app.get('/api/private/:uid', requireUser, async (req, res) => {
  const uid = req.authUid, other = +req.params.uid;
  if (!other) return res.status(400).json({ error: 'المستخدم غير صالح' });
  if (await usersIgnoreEachOther(uid, other))
    return res.status(403).json({ error: 'المحادثة الخاصة غير متاحة بسبب التجاهل' });
  const rows = await q.all(`SELECT * FROM private_messages WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY id LIMIT 100`,
    uid, other, other, uid);
  await q.run(`UPDATE private_messages SET read=1 WHERE from_id=? AND to_id=?`, other, uid);
  res.json(rows);
});

// الهدايا
const GIFT_LIST = [
  { id: 1, name: 'وردة حمراء', emoji: '🌹', price: 1, cat: 'افتراضي' },
  { id: 2, name: 'قلب احمر', emoji: '❤️', price: 1, cat: 'افتراضي' },
  { id: 3, name: 'قهوة', emoji: '☕', price: 1, cat: 'افتراضي' },
  { id: 4, name: 'مفاتيح', emoji: '🔑', price: 12, cat: 'افتراضي' },
  { id: 5, name: 'طحالب مسوان', emoji: '🧸', price: 12, cat: 'افتراضي' },
  { id: 6, name: 'بسيط', emoji: '🎈', price: 12, cat: 'افتراضي' },
  { id: 7, name: 'سيارة', emoji: '🚗', price: 25, cat: 'فاخرة' },
  { id: 8, name: 'قصر', emoji: '🏰', price: 50, cat: 'فاخرة' },
  { id: 9, name: 'يخت', emoji: '🛥️', price: 40, cat: 'فاخرة' },
  { id: 10, name: 'طائرة', emoji: '✈️', price: 35, cat: 'فاخرة' },
  { id: 11, name: 'خاتم الماس', emoji: '💍', price: 60, cat: 'جواهر' },
  { id: 12, name: 'تاج ذهبي', emoji: '👑', price: 80, cat: 'جواهر' },
  { id: 13, name: 'قلادة', emoji: '📿', price: 45, cat: 'جواهر' },
  { id: 14, name: 'الياقوت', emoji: '💎', price: 70, cat: 'جواهر' }
];
// تهيئة جدول الهدايا من القائمة الافتراضية (rbح المستقبل = 40% مثال: قيمة 10 يربح المستقبل 4)
(async () => {
  const c = await q.get('SELECT COUNT(*) c FROM gifts');
  if (!c.c) {
    for (const g of GIFT_LIST) {
      await q.run('INSERT INTO gifts (name,img,price,payout,cat) VALUES (?,?,?,?,?)',
        g.name, g.emoji, g.price, Math.max(1, Math.round(g.price * 0.4)), g.cat);
    }
    console.log('★ تمت تهيئة جدول الهدايا (' + GIFT_LIST.length + ' هدية)');
  }
})();

app.get('/api/gifts', async (req, res) => res.json(await q.all(`SELECT * FROM gifts WHERE active=1 ORDER BY id`)));
app.get('/api/emojis', async (req, res) => res.json(await q.all(`SELECT * FROM custom_emojis ORDER BY id DESC`)));

async function createUserNotification(userId, text, icon) {
  const createdAt = Math.floor(Date.now() / 1000);
  const out = await q.run(`INSERT INTO notifications (user_id,text,icon,created_at) VALUES (?,?,?,?)`, userId, text, icon, createdAt);
  return { id: out.lastID, user_id: +userId, text, icon, kind: 'general', created_at: createdAt };
}

app.post('/api/gifts/send', requireUser, async (req, res) => {
  const { to_id, gift_id, qty, room_id } = req.body;
  const gift = await q.get(`SELECT * FROM gifts WHERE id=? AND active=1`, +gift_id);
  if (!gift) return res.status(400).json({ error: 'هدية غير صالحة' });
  const qtyN = Math.min(99, Math.max(1, parseInt(qty) || 1));
  const amount = gift.price * qtyN;                 // يُخصم من مُرسِل الهدية
  const gain = (gift.payout || 0) * qtyN;           // يَربحه مستقبِل الهدية
  const me = await q.get(`SELECT * FROM users WHERE id=?`, req.authUid);
  if (me.balance < amount) return res.status(400).json({ error: 'رصيدك غير كافي', need: amount });
  const to = await q.get(`SELECT * FROM users WHERE id=?`, to_id);
  if (!to) return res.status(404).json({ error: 'المستخدم غير موجود' });
  await q.run(`UPDATE users SET balance=balance-? WHERE id=?`, amount, me.id);
  await q.run(`UPDATE users SET balance=balance+? WHERE id=?`, gain, to.id);
  await q.run(`INSERT INTO gifts_log (from_id,from_name,to_id,to_name,gift_name,gift_img,gift_audio,price,qty) VALUES (?,?,?,?,?,?,?,?,?)`,
    me.id, me.username, to.id, to.username, gift.name, gift.img, gift.audio || '', gift.price, qtyN);
  // بث رسالة الهدية داخل الغرفة مع صوتها حتى تعمل المؤثرات لدى جميع الموجودين.
  const gExtra = JSON.stringify({ img: gift.img, audio: gift.audio || '', name: gift.name, qty: qtyN, to: to.username, from: me.username });
  if (room_id) {
    const ins = await q.run(`INSERT INTO messages (room_id,user_id,username,text,type,extra) VALUES (?,?,?,?,'gift',?)`,
      room_id, me.id, me.username, `هدية ${gift.name}`, gExtra);
    io.to('room_' + room_id).emit('msg', {
      id: ins.lastID, room_id: +room_id, text: `هدية ${gift.name}`, type: 'gift', created_at: Math.floor(Date.now() / 1000),
      extra: gExtra,
      user: { ...pubUser(me), badge: badgeOf(me) }
    });
  }
  const vis = gift.img && !gift.img.startsWith('/') ? gift.img + ' ' : '';
  const toFresh = await q.get(`SELECT balance FROM users WHERE id=?`, to_id);
  const notification = await createUserNotification(to_id, `وصلتك هدية ${vis}${gift.name} من ${me.username} وربحت ${gain} ذهب`, 'gift_fill');
  io.to('user_' + to_id).emit('notify', { ...notification, text: notification.text + ' 🪙', balance: toFresh.balance });
  res.json({ ok: true, balance: me.balance - amount });
});

async function notifyAdminAccounts(text) {
  const admins = await q.all(`SELECT id FROM users WHERE rank IN ('admin','superadmin','supermaster')`);
  for (const admin of admins) {
    const notification = await createUserNotification(admin.id, text, 'bell_badge_fill');
    io.to('user_' + admin.id).emit('notify', notification);
  }
  io.emit('service_request_created');
}

// ترقية المستخدمين الفورية بالرصيد والخصم المباشر
app.post('/api/upgrade', requireUser, async (req, res) => {
  const { target_id, plan, room_id } = req.body;
  const months = Math.min(24, Math.max(1, parseInt(req.body.months) || 1));
  const settings = await getSettings();
  const costs = { vip: +settings.vip_cost, premium: +settings.premium_cost, plus: +settings.plus_cost };
  if (!costs[plan]) return res.status(400).json({ error: 'خطة ترقية غير صالحة' });

  const me = await q.get(`SELECT * FROM users WHERE id=?`, req.authUid);
  if (!me || !me.registered) return res.status(403).json({ error: 'يتطلب ترقية المستخدمين أن يكون حسابك مسجلاً' });

  const target = await q.get(`SELECT * FROM users WHERE id=?`, +target_id || me.id);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });

  // شرط المستخدم المسجل: لا يمكن ترقية الزوار
  if (!target.registered) {
    return res.status(400).json({ error: 'لا يمكن ترقية الزوار، يجب أن يكون المستخدم مسجلاً' });
  }

  const totalCost = costs[plan] * months;
  if (+me.balance < totalCost) {
    return res.status(400).json({ error: 'رصيد الذهب غير كافٍ لإتمام الترقية', need: totalCost, balance: +me.balance });
  }

  // خصم الذهب من رصيد الدافع
  await q.run(`UPDATE users SET balance=balance-? WHERE id=?`, totalCost, me.id);

  // ترقية عضوية المستخدم المستهدف فوراً
  await q.run(`UPDATE users SET membership=? WHERE id=?`, plan, target.id);

  // تسجيل العملية في طلبات وسجلات الترقية كعملية مكتملة وفورية
  await q.run(`
    INSERT INTO service_requests (user_id,username,target_id,target_name,request_type,plan,months,suggested_gold,status)
    VALUES (?,?,?,?, 'upgrade',?,?,?, 'approved')`,
    me.id, me.username, target.id, target.username, plan, months, totalCost);

  // تحديث الحسابات والصلاحيات في الوضع الحي الفوري
  await refreshUserEverywhere(target.id);
  await refreshUserEverywhere(me.id);

  // إرسال رسالة الترقية إلى الغرفة العامة طبق تصميم الصورة
  const planUpper = plan.toUpperCase();
  const monthsText = months === 1 ? 'شهر واحد' : (months === 2 ? 'شهرين' : (months <= 10 ? `${months} أشهر` : `${months} شهراً`));
  const gExtra = JSON.stringify({ from: me.username, to: target.username, plan, months, monthsText });
  const textMsg = `قام بترقية ${target.username} إلى ${planUpper} لمدة ${monthsText}`;

  if (room_id) {
    const ins = await q.run(`INSERT INTO messages (room_id,user_id,username,text,type,extra) VALUES (?,?,?,?,'upgrade',?)`,
      +room_id, me.id, me.username, textMsg, gExtra);
    io.to('room_' + room_id).emit('msg', {
      id: ins.lastID, room_id: +room_id, text: textMsg, type: 'upgrade', created_at: Math.floor(Date.now() / 1000),
      extra: gExtra,
      user: { ...pubUser(me), badge: badgeOf(me) }
    });
  }

  // إشعار المستلم
  const notification = await createUserNotification(target.id, `قام ${me.username} بترقية عضويتك إلى ${planUpper} لمدة ${monthsText} 👑`, 'chart_bar_fill');
  io.to('user_' + target.id).emit('notify', { ...notification, text: notification.text });

  res.json({
    ok: true,
    instant: true,
    balance: me.balance - totalCost,
    plan,
    months,
    monthsText,
    target_name: target.username
  });
});

// تغيير الحالة / الصورة
app.post('/api/status', requireUser, async (req, res) => {
  const { status } = req.body;
  if (!['online', 'busy', 'away'].includes(status)) return res.status(400).json({ error: 'حالة غير صالحة' });
  await q.run(`UPDATE users SET status=? WHERE id=?`, status, req.authUid);
  res.json({ ok: true });
});

app.get('/api/avatars', async (req, res) => {
  const cat = req.query.category || 'def';
  const rows = await q.all(`SELECT * FROM avatars WHERE category=? ORDER BY id ASC`, cat);
  res.json(rows || []);
});

app.get('/api/my-avatars', requireUser, async (req, res) => {
  const rows = await q.all(`SELECT * FROM user_avatars WHERE user_id=? ORDER BY id DESC LIMIT 10`, req.authUid);
  res.json(rows || []);
});

app.post('/api/avatar', requireUser, (req, res) => {
  upload.single('avatar')(req, res, async (err) => {
    if (err) return res.status(500).json({ error: 'تعذر رفع الصورة: ' + err.message });
    try {
      let avatar = (req.body && req.body.avatar) || '';
      if (req.file) avatar = '/uploads/' + req.file.filename;
      if (!avatar) return res.status(400).json({ error: 'لا توجد صورة' });
      if (avatar && !/^[\/a-zA-Z0-9_\-.]+$/.test(avatar)) return res.status(400).json({ error: 'رابط غير صالح' });
      await q.run(`UPDATE users SET avatar=? WHERE id=?`, avatar, req.authUid);

      // حفظ في معرض صور المستخدم مع حد أقصى 10 صور (حذف الأقدم تلقائياً إذا زاد عن 10)
      await q.run(`INSERT INTO user_avatars (user_id, path) VALUES (?, ?)`, req.authUid, avatar);
      const userAvatars = await q.all(`SELECT * FROM user_avatars WHERE user_id=? ORDER BY id ASC`, req.authUid);
      if (userAvatars.length > 10) {
        const toDelete = userAvatars.slice(0, userAvatars.length - 10);
        for (const item of toDelete) {
          await q.run(`DELETE FROM user_avatars WHERE id=?`, item.id);
          if (item.path && item.path.startsWith('/uploads/') && item.path !== avatar) {
            try { fs.unlinkSync(path.join(__dirname, 'public', item.path)); } catch (e) { }
          }
        }
      }

      await refreshUserEverywhere(req.authUid);
      res.json({ ok: true, avatar });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

// =====================================================
//  API - الحالات (صورة/فيديو/صوت/كتابة لمدة 24 ساعة)
// =====================================================
function normalizeStatus(status) {
  return {
    ...status,
    media_type: status.media_type || 'image',
    media: status.media || status.image || '',
    text_content: status.text_content || '',
    background: /^#[0-9a-fA-F]{6}$/.test(status.background || '') ? status.background : '#1f6f5f'
  };
}
function deleteStatusMedia(status) {
  const media = typeof status === 'string' ? status : ((status && (status.media || status.image)) || '');
  if (!media || !media.startsWith('/uploads/statuses/')) return;
  const file = path.join(__dirname, 'public/uploads/statuses', path.basename(media));
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (e) { }
}
async function cleanupExpiredStatuses() {
  const now = Math.floor(Date.now() / 1000);
  const expired = await q.all(`SELECT id,image,media FROM statuses WHERE expires_at<=?`, now);
  if (!expired.length) return;
  const ids = expired.map(s => s.id);
  for (const id of ids) await q.run(`DELETE FROM status_views WHERE status_id=?`, id);
  await q.run(`DELETE FROM statuses WHERE expires_at<=?`, now);
  expired.forEach(deleteStatusMedia);
}

// قائمة الحالات النشطة. عدد وأسماء المشاهدين لا يصلان إلا لصاحب الحالة.
app.get('/api/statuses', requireUser, async (req, res) => {
  await cleanupExpiredStatuses();
  const uid = +req.authUid;
  const now = Math.floor(Date.now() / 1000);
  const rows = await q.all(`
    SELECT s.*,u.username,u.avatar,u.registered,
           EXISTS(SELECT 1 FROM status_views sv WHERE sv.status_id=s.id AND sv.viewer_id=?) viewed,
           (SELECT COUNT(*) FROM status_views sv2 WHERE sv2.status_id=s.id) view_count
    FROM statuses s JOIN users u ON u.id=s.user_id
    WHERE s.expires_at>? AND u.banned=0
    ORDER BY s.created_at DESC`, uid, now);
  res.json(rows.map(row => {
    const s = normalizeStatus(row);
    return {
      ...s,
      verified: VERIFIED_SET.has(s.username) ? 1 : 0,
      is_owner: s.user_id === uid ? 1 : 0,
      view_count: s.user_id === uid ? s.view_count : undefined
    };
  }));
});

app.post('/api/statuses', requireUser, async (req, res) => {
  if (!await canUseMembershipFeature(req.authUid, 'status_allowed_memberships'))
    return res.status(403).json({ error: 'عضويتك غير مسموح لها بنشر الحالات حسب إعدادات الإدارة' });
  uploadStatus.single('status')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'حجم الملف أكبر من 50MB' : err.message });
    try {
      const me = await q.get(`SELECT id FROM users WHERE id=?`, req.authUid);
      if (!me) {
        if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) { } }
        return res.status(401).json({ error: 'المستخدم غير موجود' });
      }
      await cleanupExpiredStatuses();
      const requestedType = String((req.body && req.body.media_type) || '').toLowerCase();
      const fileType = req.file ? String(req.file.mimetype || '').split('/')[0] : '';
      const mediaType = req.file && ['image', 'video', 'audio'].includes(fileType) ? fileType : requestedType;
      if (!['image', 'video', 'audio', 'text'].includes(mediaType))
        return res.status(400).json({ error: 'نوع الحالة غير صالح' });
      if (mediaType !== 'text' && !req.file)
        return res.status(400).json({ error: 'اختر ملف الحالة أولاً' });
      if (mediaType === 'text' && req.file)
        return res.status(400).json({ error: 'الحالة الكتابية لا تحتاج ملفاً' });

      const media = req.file ? '/uploads/statuses/' + req.file.filename : '';
      const textContent = String((req.body && req.body.text_content) || '').trim().slice(0, 500);
      if (mediaType === 'text' && !textContent)
        return res.status(400).json({ error: 'اكتب نص الحالة' });
      const rawBackground = String((req.body && req.body.background) || '');
      const background = /^#[0-9a-fA-F]{6}$/.test(rawBackground) ? rawBackground : '#1f6f5f';
      const caption = String((req.body && req.body.caption) || '').trim().slice(0, 160);
      const now = Math.floor(Date.now() / 1000);
      const out = await q.run(`
        INSERT INTO statuses (user_id,image,media_type,media,text_content,background,caption,created_at,expires_at)
        VALUES (?,?,?,?,?,?,?,?,?)`,
        me.id, media, mediaType, media, textContent, background, caption, now, now + 24 * 60 * 60);
      io.emit('statuses_changed', { action: 'created', userId: me.id, statusId: out.lastID });
      res.json({ ok: true, id: out.lastID, image: media, media_type: mediaType, media, text_content: textContent, background, caption, created_at: now, expires_at: now + 86400 });
    } catch (e) {
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch (x) { } }
      res.status(500).json({ error: 'تعذر حفظ الحالة' });
    }
  });
});

// تسجيل المشاهدة مرة واحدة. مشاهدة المالك لحالته لا تُسجّل.
app.post('/api/statuses/:id/view', requireUser, async (req, res) => {
  await cleanupExpiredStatuses();
  const uid = +req.authUid;
  const status = await q.get(`
    SELECT s.*,u.username,u.avatar FROM statuses s JOIN users u ON u.id=s.user_id
    WHERE s.id=? AND s.expires_at>?`, +req.params.id, Math.floor(Date.now() / 1000));
  if (!status) return res.status(404).json({ error: 'انتهت هذه الحالة أو حُذفت' });
  if (status.user_id !== uid) {
    const viewed = await q.run(`INSERT OR IGNORE INTO status_views (status_id,viewer_id,viewed_at) VALUES (?,?,strftime('%s','now'))`, status.id, uid);
    if (viewed.changes) io.to('user_' + status.user_id).emit('status_viewed', { statusId: status.id });
  }
  const count = status.user_id === uid
    ? (await q.get(`SELECT COUNT(*) c FROM status_views WHERE status_id=?`, status.id)).c
    : undefined;
  res.json({ ...normalizeStatus(status), is_owner: status.user_id === uid ? 1 : 0, view_count: count });
});

// محمي على الخادم: أسماء مشاهدي الحالة متاحة لصاحب الحالة فقط.
app.get('/api/statuses/:id/viewers', requireUser, async (req, res) => {
  await cleanupExpiredStatuses();
  const status = await q.get(`SELECT id,user_id FROM statuses WHERE id=?`, +req.params.id);
  if (!status) return res.status(404).json({ error: 'الحالة غير موجودة' });
  if (status.user_id !== +req.authUid)
    return res.status(403).json({ error: 'مشاهدو الحالة متاحون لصاحبها فقط' });
  const viewers = await q.all(`
    SELECT u.id,u.username,u.avatar,sv.viewed_at
    FROM status_views sv JOIN users u ON u.id=sv.viewer_id
    WHERE sv.status_id=? ORDER BY sv.viewed_at DESC`, status.id);
  res.json(viewers);
});

app.delete('/api/statuses/:id', requireUser, async (req, res) => {
  const status = await q.get(`SELECT id,user_id,image,media FROM statuses WHERE id=?`, +req.params.id);
  if (!status) return res.status(404).json({ error: 'الحالة غير موجودة' });
  if (status.user_id !== +req.authUid)
    return res.status(403).json({ error: 'لا يمكنك حذف حالة مستخدم آخر' });
  await q.run(`DELETE FROM status_views WHERE status_id=?`, status.id);
  await q.run(`DELETE FROM statuses WHERE id=?`, status.id);
  deleteStatusMedia(status);
  io.emit('statuses_changed', { action: 'deleted', userId: status.user_id, statusId: status.id });
  res.json({ ok: true });
});

// رفع صورة أو مقطع صوت لإرساله في الرسائل العامة أو الخاصة.
app.post('/api/chat/upload-media', requireUser, (req, res) => {
  uploadChatMedia.single('media')(req, res, async (err) => {
    if (err || !req.file) return res.status(400).json({ error: err ? err.message : 'اختر الملف' });
    const extension = path.extname(req.file.originalname || '').toLowerCase();
    const type = CHAT_AUDIO_EXTENSIONS.has(extension) ? 'audio' : 'image';
    if (!chatMediaSignatureMatches(req.file.path, type, extension)) {
      try { fs.unlinkSync(req.file.path); } catch (e) { }
      return res.status(400).json({ error: type === 'audio' ? 'فشل فحص المقطع الصوتي أو أن الملف تالف' : 'فشل فحص الصورة أو أن الملف تالف' });
    }
    const settingKey = type === 'audio' ? 'voice_allowed_memberships' : 'public_image_allowed_memberships';
    const canPublic = await canUseMembershipFeature(req.authUid, settingKey);
    const canPrivate = await canUseMembershipFeature(req.authUid, 'private_message_allowed_memberships');
    if (!canPublic && !canPrivate) {
      try { fs.unlinkSync(req.file.path); } catch (e) { }
      return res.status(403).json({
        error: type === 'audio'
          ? 'عضويتك غير مسموح لها بإرسال المقاطع الصوتية'
          : 'عضويتك غير مسموح لها بإرسال الصور'
      });
    }
    res.json({ ok: true, type, path: '/uploads/chat/' + req.file.filename });
  });
});

// =====================================================
//  الحائط: منشورات + يوتيوب/فيديو + تعليقات وتفاعلات
// =====================================================
function normalizeYoutubeEmbed(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let id = '';
    if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || '';
    else if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
      else {
        const parts = url.pathname.split('/').filter(Boolean);
        if (['shorts', 'embed'].includes(parts[0])) id = parts[1] || '';
      }
    }
    return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? `https://www.youtube.com/embed/${id}` : '';
  } catch (e) { return ''; }
}
app.get('/api/wall/youtube-search', requireUser, async (req, res) => {
  const query = String(req.query.q || '').trim().slice(0, 80);
  if (!query) return res.status(400).json({ error: 'اكتب كلمات البحث' });
  try {
    const response = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NujumChat/1.0)', 'Accept-Language': 'ar,en;q=0.8' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('youtube');
    const html = await response.text();
    const ids = [];
    for (const match of html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)) {
      if (!ids.includes(match[1])) ids.push(match[1]);
      if (ids.length >= 8) break;
    }
    const videos = (await Promise.all(ids.map(async id => {
      let title = 'فيديو YouTube', author = '';
      try {
        const meta = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}&format=json`, { signal: AbortSignal.timeout(6000) });
        if (meta.ok) { const data = await meta.json(); title = data.title || title; author = data.author_name || ''; }
      } catch (e) { }
      return { id, title, author, thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, embed_url: `https://www.youtube.com/embed/${id}` };
    }))).filter(Boolean);
    res.json(videos);
  } catch (e) { res.status(502).json({ error: 'تعذر البحث في YouTube حالياً' }); }
});
app.post('/api/wall/upload-image', requireUser, async (req, res) => {
  if (!await canUseMembershipFeature(req.authUid, 'wall_allowed_memberships'))
    return res.status(403).json({ error: 'عضويتك غير مسموح لها بالنشر على الحائط' });
  uploadWallImage.single('image')(req, res, (err) => {
    if (err || !req.file) return res.status(400).json({ error: err ? err.message : 'اختر ملف الصورة' });
    res.json({ ok: true, path: '/uploads/wall/' + req.file.filename });
  });
});
app.post('/api/wall/upload-video', requireUser, async (req, res) => {
  if (!await canUseMembershipFeature(req.authUid, 'wall_allowed_memberships'))
    return res.status(403).json({ error: 'عضويتك غير مسموح لها بالنشر على الحائط' });
  uploadWallVideo.single('video')(req, res, (err) => {
    if (err || !req.file) return res.status(400).json({ error: err ? err.message : 'اختر ملف الفيديو' });
    res.json({ ok: true, path: '/uploads/wall/' + req.file.filename });
  });
});
async function wallPostPayload(post, viewerId, viewerRank) {
  if (!post) return null;
  const author = await q.get(`SELECT * FROM users WHERE id=?`, post.user_id);
  const comments = await q.all(`SELECT * FROM wall_comments WHERE post_id=? ORDER BY id ASC LIMIT 100`, post.id);
  const commentData = [];
  for (const comment of comments) {
    const user = await q.get(`SELECT * FROM users WHERE id=?`, comment.user_id);
    commentData.push({ ...comment, user: user ? { ...pubUser(user), badge: badgeOf(user) } : null });
  }
  const reactionRows = await q.all(`SELECT reaction,COUNT(*) count FROM wall_reactions WHERE post_id=? GROUP BY reaction`, post.id);
  const myReaction = await q.get(`SELECT reaction FROM wall_reactions WHERE post_id=? AND user_id=?`, post.id, viewerId);
  const reactions = {};
  reactionRows.forEach(row => { reactions[row.reaction] = +row.count; });
  return {
    ...post,
    user: author ? { ...pubUser(author), badge: badgeOf(author) } : null,
    comments: commentData,
    reactions,
    reaction_count: reactionRows.reduce((sum, row) => sum + +row.count, 0),
    my_reaction: myReaction ? myReaction.reaction : '',
    can_delete: +post.user_id === +viewerId || ['admin', 'superadmin', 'supermaster'].includes(viewerRank) ? 1 : 0
  };
}
app.get('/api/wall', requireUser, async (req, res) => {
  const posts = await q.all(`SELECT * FROM wall_posts ORDER BY id DESC LIMIT 50`);
  const me = await q.get(`SELECT rank FROM users WHERE id=?`, req.authUid);
  const result = [];
  for (const post of posts) result.push(await wallPostPayload(post, req.authUid, me && me.rank));
  res.json(result);
});
app.get('/api/wall/:id', requireUser, async (req, res) => {
  const post = await q.get(`SELECT * FROM wall_posts WHERE id=?`, +req.params.id);
  if (!post) return res.status(404).json({ error: 'المنشور غير موجود' });
  const me = await q.get(`SELECT rank FROM users WHERE id=?`, req.authUid);
  res.json(await wallPostPayload(post, req.authUid, me && me.rank));
});
app.post('/api/wall', requireUser, async (req, res) => {
  if (!await canUseMembershipFeature(req.authUid, 'wall_allowed_memberships'))
    return res.status(403).json({ error: 'عضويتك غير مسموح لها بالنشر على الحائط' });
  const text = String(req.body.text || '').trim().slice(0, 2000);
  const rawYoutube = String(req.body.youtube_url || '').trim();
  const youtube = normalizeYoutubeEmbed(rawYoutube);
  const image = String(req.body.image || '').startsWith('/uploads/wall/') ? String(req.body.image).slice(0, 180) : '';
  const video = String(req.body.video || '').startsWith('/uploads/wall/') ? String(req.body.video).slice(0, 180) : '';
  if (rawYoutube && !youtube) return res.status(400).json({ error: 'فيديو YouTube المختار غير صالح' });
  if (!text && !youtube && !image && !video) return res.status(400).json({ error: 'اكتب منشوراً أو أضف صورة أو فيديو' });
  const user = await q.get(`SELECT username FROM users WHERE id=?`, req.authUid);
  const out = await q.run(`INSERT INTO wall_posts (user_id,username,text,youtube_url,image,video) VALUES (?,?,?,?,?,?)`,
    req.authUid, user.username, text, youtube, image, video);
  io.emit('wall_changed', { action: 'created', postId: out.lastID });
  res.json({ ok: true, id: out.lastID });
});
app.post('/api/wall/:id/comments', requireUser, async (req, res) => {
  const postId = +req.params.id;
  const text = String(req.body.text || '').trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: 'اكتب التعليق' });
  if (!await q.get(`SELECT id FROM wall_posts WHERE id=?`, postId)) return res.status(404).json({ error: 'المنشور غير موجود' });
  const user = await q.get(`SELECT * FROM users WHERE id=?`, req.authUid);
  const out = await q.run(`INSERT INTO wall_comments (post_id,user_id,username,text) VALUES (?,?,?,?)`, postId, req.authUid, user.username, text);
  const comment = { id: out.lastID, post_id: postId, user_id: req.authUid, username: user.username, text, created_at: Math.floor(Date.now() / 1000), user: { ...pubUser(user), badge: badgeOf(user) } };
  io.emit('wall_changed', { action: 'commented', postId });
  res.json({ ok: true, comment });
});
app.post('/api/wall/:id/reaction', requireUser, async (req, res) => {
  const postId = +req.params.id;
  const reaction = String(req.body.reaction || '👍');
  const allowed = new Set(['👍', '❤️', '😂', '😍', '😮']);
  if (!allowed.has(reaction)) return res.status(400).json({ error: 'تفاعل غير صالح' });
  if (!await q.get(`SELECT id FROM wall_posts WHERE id=?`, postId)) return res.status(404).json({ error: 'المنشور غير موجود' });
  const old = await q.get(`SELECT reaction FROM wall_reactions WHERE post_id=? AND user_id=?`, postId, req.authUid);
  let myReaction = reaction;
  if (old && old.reaction === reaction) {
    await q.run(`DELETE FROM wall_reactions WHERE post_id=? AND user_id=?`, postId, req.authUid);
    myReaction = '';
  } else await q.run(`INSERT INTO wall_reactions (post_id,user_id,reaction) VALUES (?,?,?) ON CONFLICT(post_id,user_id) DO UPDATE SET reaction=excluded.reaction,created_at=strftime('%s','now')`, postId, req.authUid, reaction);
  const rows = await q.all(`SELECT reaction,COUNT(*) count FROM wall_reactions WHERE post_id=? GROUP BY reaction`, postId);
  const reactions = {}; rows.forEach(row => { reactions[row.reaction] = +row.count; });
  io.emit('wall_changed', { action: 'reacted', postId });
  res.json({ ok: true, reactions, reaction_count: rows.reduce((sum, row) => sum + +row.count, 0), my_reaction: myReaction });
});
app.delete('/api/wall/:id', requireUser, async (req, res) => {
  const post = await q.get(`SELECT * FROM wall_posts WHERE id=?`, +req.params.id);
  if (!post) return res.status(404).json({ error: 'المنشور غير موجود' });
  const me = await q.get(`SELECT rank FROM users WHERE id=?`, req.authUid);
  if (+post.user_id !== +req.authUid && (!me || !['admin', 'superadmin', 'supermaster'].includes(me.rank)))
    return res.status(403).json({ error: 'لا يمكنك حذف هذا المنشور' });
  await q.run(`DELETE FROM wall_comments WHERE post_id=?`, post.id);
  await q.run(`DELETE FROM wall_reactions WHERE post_id=?`, post.id);
  await q.run(`DELETE FROM wall_posts WHERE id=?`, post.id);
  for (const media of [post.image, post.video]) {
    if (media && media.startsWith('/uploads/wall/')) {
      try { fs.unlinkSync(path.join(__dirname, 'public/uploads/wall', path.basename(media))); } catch (e) { }
    }
  }
  io.emit('wall_changed', { action: 'deleted', postId: post.id });
  res.json({ ok: true });
});

// الإشعارات
app.get('/api/notifications', requireUser, async (req, res) => {
  const rows = await q.all(`
    SELECT n.*,
      CASE WHEN n.user_id IS NULL
        THEN EXISTS(SELECT 1 FROM notification_reads nr WHERE nr.notification_id=n.id AND nr.user_id=?)
        ELSE n.read END AS read
    FROM notifications n
    WHERE n.user_id=? OR n.user_id IS NULL
    ORDER BY n.id DESC LIMIT 60`, req.authUid, req.authUid);
  res.json(rows);
});
app.get('/api/notifications/unread-count', requireUser, async (req, res) => {
  const row = await q.get(`
    SELECT COUNT(*) c FROM notifications n
    WHERE (n.user_id=? AND n.read=0)
       OR (n.user_id IS NULL AND NOT EXISTS(
         SELECT 1 FROM notification_reads nr WHERE nr.notification_id=n.id AND nr.user_id=?
       ))`, req.authUid, req.authUid);
  res.json({ count: +row.c || 0 });
});
app.post('/api/notifications/read-all', requireUser, async (req, res) => {
  await q.run(`UPDATE notifications SET read=1 WHERE user_id=?`, req.authUid);
  await q.run(`
    INSERT OR IGNORE INTO notification_reads (notification_id,user_id)
    SELECT id,? FROM notifications WHERE user_id IS NULL`, req.authUid);
  res.json({ ok: true });
});

app.delete('/api/notifications/clear', requireUser, async (req, res) => {
  await q.run(`DELETE FROM notifications WHERE user_id=?`, req.authUid);
  await q.run(`
    INSERT OR IGNORE INTO notification_reads (notification_id,user_id)
    SELECT id,? FROM notifications WHERE user_id IS NULL`, req.authUid);
  res.json({ ok: true });
});

// تعديل الملف الشخصي (النوع/العمر/الدولة/البريد)
app.post('/api/profile', requireUser, async (req, res) => {
  const { gender, age, country, email, bio } = req.body;
  const g = ['boy', 'girl', 'secret'].includes(gender) ? gender : 'secret';
  const a = Math.min(99, Math.max(10, parseInt(age) || 25));
  await q.run(`UPDATE users SET gender=?, age=?, country=?, email=?, bio=? WHERE id=?`,
    g, a, String(country || '').slice(0, 40), String(email || '').slice(0, 80), String(bio === undefined ? '' : bio).slice(0, 300), req.authUid);
  refreshUserEverywhere(req.authUid);
  res.json({ ok: true });
});
// إعادة بث بيانات العضو للغرف المتواجد فيها وتحديث حساب المستخدم فورياً
async function refreshUserEverywhere(uid) {
  uid = +uid;
  if (!uid) return;
  const fresh = await q.get('SELECT * FROM users WHERE id=?', uid);
  if (!fresh) return;
  const pub = pubUser(fresh);
  const badge = badgeOf(fresh);
  if (onlineUsers[uid]) onlineUsers[uid] = { ...pub, badge };

  // إرسال تحديث فوري ومباشر إلى سوكت المستخدم نفسه لتحديث رصيده واسمه وعضويته وشاراته فورياً
  io.to('user_' + uid).emit('user_sync', {
    user: pub,
    badge: badge
  });

  // تحديث لجميع الغرف المتواجد بها العضو
  Object.keys(roomUsers).forEach(rid => { if (roomUsers[rid].has(uid)) emitRoomUsers(rid); });
}

// طلب توثيق: تحدد الإدارة مقدار الذهب عند الموافقة ولا يتم الخصم مسبقاً.
app.post('/api/verify-request', requireUser, async (req, res) => {
  const me = await q.get(`SELECT * FROM users WHERE id=?`, req.authUid);
  if (!me || !me.registered) return res.status(403).json({ error: 'يتطلب عضوية مسجلة' });
  if (VERIFIED_SET.has(me.username)) return res.status(400).json({ error: 'حسابك موثق بالفعل ✓' });
  const duplicate = await q.get(`SELECT id FROM service_requests WHERE user_id=? AND request_type='verify' AND status='pending'`, me.id);
  if (duplicate) return res.status(400).json({ error: 'لديك طلب توثيق قيد المراجعة بالفعل' });
  const out = await q.run(`
    INSERT INTO service_requests (user_id,username,target_id,target_name,request_type,suggested_gold)
    VALUES (?,?,?,?,'verify',10)`, me.id, me.username, me.id, me.username);
  await notifyAdminAccounts(`طلب توثيق جديد من المستخدم ${me.username}`);
  res.json({ ok: true, requested: true, request_id: out.lastID, suggested_gold: 10 });
});

// =====================================================
//  باقات شراء الذهب والدفع ببطاقة الصراف الآلي والبطاقات البنكية
// =====================================================
app.get('/api/gold-packages', async (req, res) => {
  try {
    const packages = await q.all(`SELECT * FROM gold_packages WHERE active=1 ORDER BY sort ASC, id ASC`);
    const settings = await getSettings();
    res.json({
      ok: true,
      packages: packages || [],
      currency: settings.card_currency || '$',
      merchant_bank: settings.merchant_bank_name || 'البنك التجاري المعتمد',
      merchant_holder: settings.merchant_holder_name || 'إدارة الدردشة المعتمدة',
      merchant_card_masked: settings.merchant_card_number ? (settings.merchant_card_number.slice(0, 4) + ' •••• •••• ' + settings.merchant_card_number.slice(-4)) : '4263 •••• •••• 5678',
      card_payment_enabled: settings.card_payment_enabled !== '0'
    });
  } catch (e) {
    res.status(500).json({ error: 'تعذر جلب باقات الشراء' });
  }
});

app.post('/api/pay-with-card', requireUser, async (req, res) => {
  try {
    const me = await q.get(`SELECT * FROM users WHERE id=?`, req.authUid);
    if (!me) return res.status(401).json({ error: 'المستخدم غير مسجل' });

    const { package_id, card_number, card_holder, exp_month, exp_year, cvv } = req.body || {};
    const pkgId = +package_id;
    const pkg = await q.get(`SELECT * FROM gold_packages WHERE id=? AND active=1`, pkgId);
    if (!pkg) return res.status(400).json({ error: 'باقة الذهب المختارة غير متوفرة أو معطلة' });

    const settings = await getSettings();
    if (settings.card_payment_enabled === '0') {
      return res.status(400).json({ error: 'خدمة الدفع بالبطاقات البنكية متوقفة حالياً للصيانة' });
    }

    const cleanCardNum = String(card_number || '').replace(/\D/g, '');
    if (cleanCardNum.length < 13 || cleanCardNum.length > 19) {
      return res.status(400).json({ error: 'رقم بطاقة الصراف / الائتمان غير صحيح (يجب أن يتكون من 16 رقم)' });
    }
    const cleanHolder = String(card_holder || '').trim();
    if (!cleanHolder || cleanHolder.length < 3) {
      return res.status(400).json({ error: 'يرجى كتابة اسم صاحب البطاقة كما هو مطبوع عليها' });
    }
    const cleanCvv = String(cvv || '').trim();
    if (cleanCvv.length < 3 || cleanCvv.length > 4) {
      return res.status(400).json({ error: 'رمز الأمان (CVV) غير صالح' });
    }

    // تحديد نوع البطاقة البنكية
    let cardBrand = 'Credit Card';
    if (/^4/.test(cleanCardNum)) cardBrand = 'VISA';
    else if (/^(5[1-5]|2[2-7])/.test(cleanCardNum)) cardBrand = 'Mastercard';
    else if (/^(5888|5889|5890|9682|4847|5043|4008)/.test(cleanCardNum)) cardBrand = 'Mada مدى';
    else if (/^(5078|3585)/.test(cleanCardNum)) cardBrand = 'Meeza ميزة';
    else if (/^(34|37)/.test(cleanCardNum)) cardBrand = 'American Express';

    const cardLast4 = cleanCardNum.slice(-4);
    const depositCard = settings.merchant_card_number || '4263 8890 1234 5678';
    const bonusGold = +pkg.bonus || 0;
    const totalGold = (+pkg.gold || 0) + bonusGold;
    const amountPaid = +pkg.price || 0;
    const currency = pkg.currency || settings.card_currency || '$';

    // شحن الذهب مباشرة في رصيد المستخدم
    await q.run(`UPDATE users SET balance=balance+? WHERE id=?`, totalGold, me.id);
    const newBal = (me.balance || 0) + totalGold;

    if (onlineUsers[me.id]) {
      onlineUsers[me.id].balance = newBal;
    }

    // تسجيل العملية في جدول المعاملات
    const tx = await q.run(`
      INSERT INTO payment_transactions
      (user_id, username, package_id, package_name, gold_amount, bonus_amount, total_gold, amount_paid, currency, card_last4, card_brand, card_holder, deposit_card, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')
    `, me.id, me.username, pkg.id, pkg.name, pkg.gold, bonusGold, totalGold, amountPaid, currency, cardLast4, cardBrand, cleanHolder, depositCard);

    // إشعار المستخدم بالعملية
    const notif = await createUserNotification(
      me.id,
      `تم شحن ${totalGold} ذهب بنجاح عبر البطاقة (${cardBrand} •••• ${cardLast4}) بقيمة ${amountPaid} ${currency} (الرصيد: ${newBal}) 🪙`,
      'creditcard_fill'
    );
    io.to('user_' + me.id).emit('notify', { ...notif, balance: newBal });
    io.to('user_' + me.id).emit('call:gold_deducted', { balance: newBal, amount: 0, isPayment: true });

    // إشعار المشرفين
    const adminRows = await q.all(`SELECT id FROM users WHERE rank IN ('admin','superadmin','supermaster')`);
    for (const adm of adminRows) {
      io.to('user_' + adm.id).emit('notify', {
        text: `عملية شراء ناجحة: ${me.username} قام بشحن ${totalGold} ذهب بمبلغ ${amountPaid} ${currency} 💳`,
        icon: 'creditcard_fill'
      });
    }

    res.json({
      ok: true,
      balance: newBal,
      total_gold: totalGold,
      package_name: pkg.name,
      amount_paid: amountPaid,
      currency,
      card_brand: cardBrand,
      card_last4: cardLast4,
      transaction_id: tx.lastID
    });
  } catch (err) {
    res.status(500).json({ error: 'تعذر معالجة الدفع: ' + (err.message || 'خطأ في النظام') });
  }
});

// شراء الذهب الافتراضي (دفع تجريبي قديم)
app.post('/api/buy-gold', requireUser, async (req, res) => {
  const me = await q.get(`SELECT * FROM users WHERE id=?`, req.authUid);
  if (!me || !me.registered) return res.status(403).json({ error: 'يتطلب عضوية مسجلة' });
  const gold = Math.min(10000, Math.max(0, parseInt(req.body.gold) || 0));
  if (!gold) return res.status(400).json({ error: 'كمية غير صالحة' });
  await q.run(`UPDATE users SET balance=balance+? WHERE id=?`, gold, me.id);
  const notification = await createUserNotification(me.id, `تمت إضافة ${gold} ذهب افتراضي الى رصيدك`, 'creditcard_fill');
  res.json({ ok: true, balance: me.balance + gold, notification_id: notification.id, notification_created_at: notification.created_at });
});

// الشكاوى
app.post('/api/complaint', requireUser, async (req, res) => {
  const { subject, message } = req.body;
  const u = await q.get(`SELECT username FROM users WHERE id=?`, req.authUid);
  await q.run(`INSERT INTO complaints (user_id,username,subject,message) VALUES (?,?,?,?)`,
    req.authUid, u.username, subject || '', message || '');
  res.json({ ok: true });
});

// =====================================================
//  API - لوحة التحكم
// =====================================================
app.get('/api/admin/heartbeat', requireAdmin, (req, res) => {
  res.json({ ok: true, active_in_chat: true, uid: req.adminAuth.uid, rank: req.adminAuth.rank });
});

app.get('/api/admin/settings', requireAdmin, async (req, res) => res.json(await getSettings()));

app.post('/api/admin/settings', requireSuperAdmin, async (req, res) => {
  const entries = Object.entries(req.body);
  for (const [k, v] of entries) await q.run(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, String(v));
  if (req.body.hidden_super !== undefined && String(req.body.hidden_super) !== '1') await revealHiddenAdmins();
  reloadBots();      // قد يكون تبديل «تفعيل الروبوت» تغيّر
  io.emit('sync');   // تطبيق فوري على صفحات الدردشة
  if (req.body.default_language) {
    io.emit('language_changed', { default_language: String(req.body.default_language) });
  }
  res.json({ ok: true });
});

// ---- إدارة الهدايا (رفع صورة + قيمة + ربح المستقبل) ----
app.get('/api/admin/gifts', requireSuperAdmin, async (req, res) => res.json(await q.all(`SELECT * FROM gifts ORDER BY id DESC`)));
app.post('/api/admin/gifts', requireSuperAdmin, async (req, res) => {
  const { id, name, img, audio, price, payout, cat } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'اكتب اسم الهدية' });
  if (!img) return res.status(400).json({ error: 'ارفع صورة الهدية أولاً' });
  const n = String(name).slice(0, 40).trim();
  const im = String(img).slice(0, 150), au = String(audio || '').slice(0, 150), ct = String(cat || 'افتراضي').slice(0, 20);
  const pr = Math.min(100000, Math.max(0, parseInt(price) || 0));
  const py = Math.min(pr, Math.max(0, parseInt(payout) || 0));
  if (id) await q.run(`UPDATE gifts SET name=?, img=?, audio=?, price=?, payout=?, cat=? WHERE id=?`, n, im, au, pr, py, ct, +id);
  else await q.run(`INSERT INTO gifts (name,img,audio,price,payout,cat) VALUES (?,?,?,?,?,?)`, n, im, au, pr, py, ct);
  io.emit('sync');
  res.json({ ok: true });
});
app.post('/api/admin/gifts/:id/del', requireSuperAdmin, async (req, res) => {
  const gift = await q.get(`SELECT img,audio FROM gifts WHERE id=?`, +req.params.id);
  await q.run(`DELETE FROM gifts WHERE id=?`, +req.params.id);
  for (const media of [gift && gift.img, gift && gift.audio]) {
    if (media && String(media).startsWith('/uploads/gifts/')) {
      try { fs.unlinkSync(path.join(__dirname, 'public/uploads/gifts', path.basename(media))); } catch (e) { }
    }
  }
  io.emit('sync');
  res.json({ ok: true });
});
app.post('/api/admin/upload/gift', requireSuperAdmin, (req, res) => {
  uploadMedia.single('file')(req, res, (err) => {
    if (err || !req.file) return res.status(500).json({ error: 'تعذر الرفع: ' + (err ? err.message : 'لا يوجد ملف') });
    if (!String(req.file.mimetype || '').startsWith('image/')) {
      try { fs.unlinkSync(req.file.path); } catch (e) { }
      return res.status(400).json({ error: 'ملف الهدية يجب أن يكون صورة' });
    }
    res.json({ ok: true, path: '/uploads/gifts/' + req.file.filename });
  });
});
app.post('/api/admin/upload/gift-audio', requireSuperAdmin, (req, res) => {
  uploadMedia.single('file')(req, res, (err) => {
    if (err || !req.file) return res.status(500).json({ error: 'تعذر رفع الصوت: ' + (err ? err.message : 'لا يوجد ملف') });
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const allowed = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.opus', '.webm']);
    if (!String(req.file.mimetype || '').startsWith('audio/') && !allowed.has(ext)) {
      try { fs.unlinkSync(req.file.path); } catch (e) { }
      return res.status(400).json({ error: 'اختر ملفاً صوتياً صالحاً' });
    }
    res.json({ ok: true, path: '/uploads/gifts/' + req.file.filename });
  });
});

// ---- رفع إيموجي مخصص ----
app.get('/api/admin/emojis', requireSuperAdmin, async (req, res) => res.json(await q.all(`SELECT * FROM custom_emojis ORDER BY id DESC`)));
app.post('/api/admin/emojis', requireSuperAdmin, async (req, res) => {
  const { img } = req.body || {};
  if (!img) return res.status(400).json({ error: 'لا توجد صورة إيموجي' });
  await q.run(`INSERT INTO custom_emojis (img) VALUES (?)`, String(img).slice(0, 150));
  io.emit('sync');
  res.json({ ok: true });
});
app.post('/api/admin/emojis/:id/del', requireSuperAdmin, async (req, res) => {
  const emoji = await q.get(`SELECT img FROM custom_emojis WHERE id=?`, +req.params.id);
  await q.run(`DELETE FROM custom_emojis WHERE id=?`, +req.params.id);
  if (emoji && String(emoji.img).startsWith('/uploads/emojis/')) {
    try { fs.unlinkSync(path.join(__dirname, 'public/uploads/emojis', path.basename(emoji.img))); } catch (e) { }
  }
  io.emit('sync');
  res.json({ ok: true });
});

// ---- إدارة الرمزيات والصور المصنفة في لوحة الإدارة ----
app.get('/api/admin/avatars', requireSuperAdmin, async (req, res) => {
  const cat = req.query.category;
  if (cat) {
    res.json(await q.all(`SELECT * FROM avatars WHERE category=? ORDER BY id DESC`, cat));
  } else {
    res.json(await q.all(`SELECT * FROM avatars ORDER BY category ASC, id DESC`));
  }
});

app.post('/api/admin/upload/avatar', requireSuperAdmin, (req, res) => {
  uploadMedia.single('file')(req, res, async (err) => {
    if (err || !req.file) return res.status(500).json({ error: 'تعذر الرفع: ' + (err ? err.message : 'لا يوجد ملف') });
    if (!String(req.file.mimetype || '').startsWith('image/')) {
      try { fs.unlinkSync(req.file.path); } catch (e) { }
      return res.status(400).json({ error: 'ملف الرمزية يجب أن يكون صورة' });
    }
    res.json({ ok: true, path: '/uploads/avatars/' + req.file.filename });
  });
});

app.post('/api/admin/avatars', requireSuperAdmin, async (req, res) => {
  const { category, path: avatarPath } = req.body || {};
  if (!avatarPath) return res.status(400).json({ error: 'ارفع صورة الرمزية أولاً' });
  const cat = ['def', 'nature', 'other'].includes(category) ? category : 'def';
  await q.run(`INSERT INTO avatars (category, path) VALUES (?, ?)`, cat, String(avatarPath).slice(0, 200));
  io.emit('sync');
  io.emit('avatars_changed', { category: cat });
  res.json({ ok: true, category: cat, path: avatarPath });
});

const deleteAvatarHandler = async (req, res) => {
  const ava = await q.get(`SELECT path,category FROM avatars WHERE id=?`, +req.params.id);
  if (ava) {
    await q.run(`DELETE FROM avatars WHERE id=?`, +req.params.id);
    if (ava.path && ava.path.startsWith('/uploads/')) {
      try { fs.unlinkSync(path.join(__dirname, 'public', ava.path)); } catch (e) { }
    }
    io.emit('sync');
    io.emit('avatars_changed', { category: ava.category });
  }
  res.json({ ok: true });
};

app.delete('/api/admin/avatars/:id', requireSuperAdmin, deleteAvatarHandler);
app.post('/api/admin/avatars/:id/del', requireSuperAdmin, deleteAvatarHandler);
app.post('/api/admin/avatars/:id/delete', requireSuperAdmin, deleteAvatarHandler);

app.post('/api/admin/upload/emoji', requireSuperAdmin, (req, res) => {
  uploadMedia.single('file')(req, res, (err) => {
    if (err || !req.file) return res.status(500).json({ error: 'تعذر الرفع: ' + (err ? err.message : 'لا يوجد ملف') });
    if (!String(req.file.mimetype || '').startsWith('image/')) {
      try { fs.unlinkSync(req.file.path); } catch (e) { }
      return res.status(400).json({ error: 'ملف الإيموجي يجب أن يكون صورة' });
    }
    res.json({ ok: true, path: '/uploads/emojis/' + req.file.filename });
  });
});
// صورة الغرفة
app.post('/api/admin/upload/room', requireAdmin, (req, res) => {
  uploadMedia.single('file')(req, res, (err) => {
    if (err || !req.file) return res.status(500).json({ error: 'تعذر الرفع: ' + (err ? err.message : 'لا يوجد ملف') });
    res.json({ ok: true, path: '/uploads/rooms/' + req.file.filename });
  });
});

// ---- رفع صورة روبوت الغرفة ----
app.post('/api/admin/upload/bot-avatar', requireSuperAdmin, (req, res) => {
  uploadMedia.single('file')(req, res, (err) => {
    if (err || !req.file) return res.status(500).json({ error: 'تعذر رفع الصورة: ' + (err ? err.message : 'لا يوجد ملف') });
    if (!String(req.file.mimetype || '').startsWith('image/')) {
      try { fs.unlinkSync(req.file.path); } catch (e) { }
      return res.status(400).json({ error: 'صورة الروبوت يجب أن تكون ملف صورة' });
    }
    res.json({ ok: true, path: '/uploads/bots/' + req.file.filename });
  });
});

// ---- روبوتات افتراضية تظهر كمستخدمين داخل الغرف ----
app.get('/api/admin/room-bots', requireSuperAdmin, async (req, res) => {
  const rows = await q.all(`
    SELECT rb.id,rb.room_id,rb.active,rb.reply_enabled,rb.reply_text,rb.created_at,r.name room_name,
      u.id user_id,u.username,u.avatar,u.rank,u.membership,u.gender,
      EXISTS(SELECT 1 FROM verified v WHERE v.username=u.username) verified
    FROM room_bots rb JOIN users u ON u.id=rb.user_id
    LEFT JOIN rooms r ON r.id=rb.room_id ORDER BY rb.id DESC`);
  res.json(rows);
});
app.post('/api/admin/room-bots', requireSuperAdmin, async (req, res) => {
  const body = req.body || {};
  const id = +body.id || 0;
  const username = String(body.username || '').trim().slice(0, 20);
  const roomId = +body.room_id;
  const avatar = String(body.avatar || '').slice(0, 180);
  const rank = ['user', 'roomadmin', 'admin', 'superadmin', 'supermaster'].includes(body.rank) ? body.rank : 'user';
  const membership = ['none', 'mmez', 'plus', 'premium', 'vip'].includes(body.membership) ? body.membership : 'none';
  const active = body.active === false || body.active === 0 ? 0 : 1;
  const replyEnabled = +body.reply_enabled === 2 ? 2 : (+body.reply_enabled === 1 || body.reply_enabled === true ? 1 : 0);
  const replyText = String(body.reply_text || 'نعم؟').trim().slice(0, 150) || 'نعم؟';
  const verified = body.verified ? 1 : 0;
  if (!username) return res.status(400).json({ error: 'اكتب اسم الروبوت' });
  if (!avatar) return res.status(400).json({ error: 'ارفع صورة الروبوت' });
  const room = await q.get(`SELECT id FROM rooms WHERE id=?`, roomId);
  if (!room) return res.status(400).json({ error: 'اختر غرفة صحيحة' });

  let userId, oldUsername = '', oldAvatar = '';
  if (id) {
    const bot = await q.get(`SELECT rb.user_id,u.username,u.avatar FROM room_bots rb JOIN users u ON u.id=rb.user_id WHERE rb.id=?`, id);
    if (!bot) return res.status(404).json({ error: 'الروبوت غير موجود' });
    const duplicate = await q.get(`SELECT id FROM users WHERE username=? AND id<>?`, username, bot.user_id);
    if (duplicate) return res.status(400).json({ error: 'اسم الروبوت مستخدم مسبقاً' });
    userId = +bot.user_id; oldUsername = bot.username; oldAvatar = bot.avatar || '';
    await q.run(`UPDATE users SET username=?,avatar=?,rank=?,membership=?,registered=1,is_bot=1,status='online' WHERE id=?`,
      username, avatar, rank, membership, userId);
    await q.run(`UPDATE room_bots SET room_id=?,active=?,reply_enabled=?,reply_text=? WHERE id=?`, roomId, active, replyEnabled, replyText, id);
  } else {
    if (await q.get(`SELECT id FROM users WHERE username=?`, username))
      return res.status(400).json({ error: 'اسم الروبوت مستخدم مسبقاً' });
    const user = await q.run(`
      INSERT INTO users (username,password,gender,age,balance,membership,rank,registered,avatar,status,is_bot)
      VALUES (?,NULL,'secret',25,0,?,?,1,?,'online',1)`, username, membership, rank, avatar);
    userId = user.lastID;
    await q.run(`INSERT INTO room_bots (user_id,room_id,active,reply_enabled,reply_text) VALUES (?,?,?,?,?)`, userId, roomId, active, replyEnabled, replyText);
  }

  if (oldUsername) await q.run(`DELETE FROM verified WHERE username=?`, oldUsername);
  if (verified) await q.run(`INSERT OR IGNORE INTO verified (username) VALUES (?)`, username);
  else await q.run(`DELETE FROM verified WHERE username=?`, username);
  if (oldAvatar && oldAvatar !== avatar && oldAvatar.startsWith('/uploads/bots/')) {
    try { fs.unlinkSync(path.join(__dirname, 'public/uploads/bots', path.basename(oldAvatar))); } catch (e) { }
  }
  await refreshVerified();
  await syncRoomBots();
  io.emit('sync');
  res.json({ ok: true, user_id: userId });
});
app.delete('/api/admin/room-bots/:id', requireSuperAdmin, async (req, res) => {
  const bot = await q.get(`SELECT rb.user_id,u.username,u.avatar FROM room_bots rb JOIN users u ON u.id=rb.user_id WHERE rb.id=?`, +req.params.id);
  if (!bot) return res.status(404).json({ error: 'الروبوت غير موجود' });
  await q.run(`DELETE FROM room_bots WHERE id=?`, +req.params.id);
  await q.run(`DELETE FROM verified WHERE username=?`, bot.username);
  await q.run(`DELETE FROM user_ignores WHERE user_id=? OR ignored_id=?`, bot.user_id, bot.user_id);
  await q.run(`DELETE FROM private_messages WHERE from_id=? OR to_id=?`, bot.user_id, bot.user_id);
  await q.run(`DELETE FROM users WHERE id=? AND is_bot=1`, bot.user_id);
  if (bot.avatar && bot.avatar.startsWith('/uploads/bots/')) {
    try { fs.unlinkSync(path.join(__dirname, 'public/uploads/bots', path.basename(bot.avatar))); } catch (e) { }
  }
  await refreshVerified();
  await syncRoomBots();
  io.emit('sync');
  res.json({ ok: true });
});

// ---- رسائل الروبوت المجدولة ----
app.get('/api/admin/bots', requireSuperAdmin, async (req, res) => {
  const bots = await q.all(`SELECT b.*, COALESCE(r.name,'كل الغرف') room_name FROM bots b LEFT JOIN rooms r ON r.id=b.room_id ORDER BY b.id DESC`);
  res.json(bots);
});
app.post('/api/admin/bots', requireSuperAdmin, async (req, res) => {
  const b = req.body || {};
  if (!String(b.text || '').trim()) return res.status(400).json({ error: 'اكتب نص رسالة الروبوت' });
  const color = /^#[0-9a-fA-F]{6}$/.test(String(b.color || '')) ? b.color : '#d946a6';
  const size = Math.min(40, Math.max(12, +b.size || 16));
  const inv = Math.min(86400, Math.max(1, +b.interval_min || 5));
  if (b.id) {
    await q.run(`UPDATE bots SET room_id=?,text=?,color=?,size=?,interval_min=?,active=? WHERE id=?`,
      +b.room_id || 0, String(b.text).slice(0, 200), color, size, inv, b.active ? 1 : 0, +b.id);
  } else {
    await q.run(`INSERT INTO bots (room_id,text,color,size,interval_min,active) VALUES (?,?,?,?,?,?)`,
      +b.room_id || 0, String(b.text).slice(0, 200), color, size, inv, b.active === undefined ? 1 : (b.active ? 1 : 0));
  }
  reloadBots();
  io.emit('sync');
  res.json({ ok: true });
});
app.post('/api/admin/bots/:id/del', requireSuperAdmin, async (req, res) => {
  await q.run(`DELETE FROM bots WHERE id=?`, +req.params.id);
  reloadBots();
  io.emit('sync');
  res.json({ ok: true });
});

// إحصائيات
app.get('/api/admin/stats', requireSuperAdmin, async (req, res) => {
  const users = await q.get(`SELECT COUNT(*) c FROM users WHERE registered=1 AND COALESCE(is_bot,0)=0`);
  const guests = await q.get(`SELECT COUNT(*) c FROM users WHERE registered=0`);
  const rooms = await q.get(`SELECT COUNT(*) c FROM rooms`);
  const msgs = await q.get(`SELECT COUNT(*) c FROM messages`);
  const bans = await q.get(`SELECT COUNT(*) c FROM bans`);
  res.json({ users: users.c, guests: guests.c, rooms: rooms.c, messages: msgs.c, bans: bans.c, online: Object.keys(onlineUsers).length });
});
app.get('/api/admin/monitor', requireSuperAdmin, async (req, res) => {
  const userRows = await q.all(`SELECT id,username,registered FROM users`);
  const roomRows = await q.all(`SELECT id,name FROM rooms`);
  const usersById = new Map(userRows.map(user => [+user.id, user]));
  const roomsById = new Map(roomRows.map(room => [+room.id, room.name]));
  const groups = new Map();
  for (const activeSocket of io.sockets.sockets.values()) {
    const uid = +activeSocket.data.userId;
    if (!uid) continue;
    const ip = normalizeIp(activeSocket.data.clientIp || activeSocket.handshake.address || '') || 'غير معروف';
    if (!groups.has(ip)) groups.set(ip, {
      ip, online: true, connections: 0, connected_at: +activeSocket.data.connectedAt || Date.now(), users: new Map()
    });
    const group = groups.get(ip);
    group.connections++;
    group.connected_at = Math.min(group.connected_at, +activeSocket.data.connectedAt || Date.now());
    const user = usersById.get(uid);
    if (user) {
      if (!group.users.has(uid)) group.users.set(uid, {
        id: uid, username: user.username, registered: user.registered ? 1 : 0, connections: 0, rooms: new Set()
      });
      const monitoredUser = group.users.get(uid);
      monitoredUser.connections++;
      for (const roomId of (activeSocket.data.joinedRooms || [])) monitoredUser.rooms.add(+roomId);
    }
  }
  const result = [...groups.values()].map(group => ({
    ip: group.ip,
    online: true,
    connections: group.connections,
    connected_at: group.connected_at,
    users: [...group.users.values()].map(user => ({
      id: user.id, username: user.username, registered: user.registered, connections: user.connections,
      rooms: [...user.rooms].map(id => ({ id, name: roomsById.get(id) || `غرفة #${id}` }))
    }))
  })).sort((a, b) => a.ip.localeCompare(b.ip));
  res.json(result);
});
app.post('/api/admin/ip/ban', requireAdmin, async (req, res) => {
  const ip = normalizeIp(req.body.ip || '');
  if (!ip || ip === 'غير معروف') return res.status(400).json({ error: 'عنوان IP غير صالح' });
  const reason = String(req.body.reason || 'حظر من صفحة الرصد').slice(0, 150);
  let ban = await q.get(`SELECT id FROM bans WHERE ip=? LIMIT 1`, ip);
  if (!ban) {
    const out = await q.run(`INSERT INTO bans (username,ip,reason) VALUES ('حظر IP',?,?)`, ip, reason);
    ban = { id: out.lastID };
  }
  await q.run(`UPDATE users SET banned=1 WHERE registered=0 AND ip=?`, ip);
  for (const [token, auth] of CHAT_TOKENS) {
    if (normalizeIp(auth.ip) === ip) CHAT_TOKENS.delete(token);
  }
  for (const activeSocket of [...io.sockets.sockets.values()]) {
    if (normalizeIp(activeSocket.data.clientIp) !== ip) continue;
    activeSocket.emit('banned', { text: 'تم حظر عنوان IP الخاص بك بواسطة الإدارة' });
    activeSocket.disconnect(true);
  }
  res.json({ ok: true, id: ban.id, ip });
});

// ---- الغرف ----
app.get('/api/admin/rooms', requireAdmin, async (req, res) => {
  const rooms = await q.all(`SELECT * FROM rooms ORDER BY sort,id`);
  res.json(rooms);
});
app.post('/api/admin/rooms', requireAdmin, async (req, res) => {
  const r = req.body;
  const isSuper = ['superadmin', 'supermaster'].includes(req.session.rank);
  if (r.id) {
    if (!isSuper) return res.status(403).json({ error: 'لا تملك صلاحية تعديل الغرف، يمكنك إضافة غرفة جديدة فقط' });
    await q.run(`UPDATE rooms SET name=?,description=?,type=?,max_users=?,status=?,sound=?,video=?,bots=?,gifts=?,games=?,locked=?,welcome=?,password=?,image=? WHERE id=?`,
      r.name, r.description || '', r.type || 'default', r.max_users || 1000, r.status || 'open',
      r.sound ? 1 : 0, r.video ? 1 : 0, r.bots ? 1 : 0, r.gifts ? 1 : 0, r.games ? 1 : 0, r.locked ? 1 : 0, r.welcome || '',
      String(r.password || '').slice(0, 40), String(r.image || '').slice(0, 200), r.id);
    io.emit('sync');
    return res.json({ ok: true, id: r.id });
  }
  const out = await q.run(`INSERT INTO rooms (name,description,type,max_users,status,sound,video,bots,gifts,games,locked,welcome,password,image) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    r.name, r.description || '', r.type || 'default', r.max_users || 1000, r.status || 'open',
    r.sound ? 1 : 0, r.video ? 1 : 0, r.bots ? 1 : 0, r.gifts ? 1 : 0, r.games ? 1 : 0, r.locked ? 1 : 0, r.welcome || '',
    String(r.password || '').slice(0, 40), String(r.image || '').slice(0, 200));
  io.emit('sync');
  res.json({ ok: true, id: out.lastID });
});
app.delete('/api/admin/rooms/:id', requireSuperAdmin, async (req, res) => {
  await q.run(`UPDATE room_bots SET active=0 WHERE room_id=?`, req.params.id);
  await q.run(`DELETE FROM rooms WHERE id=?`, req.params.id);
  await q.run(`DELETE FROM messages WHERE room_id=?`, req.params.id);
  await syncRoomBots();
  io.emit('sync');
  res.json({ ok: true });
});

// ---- المستخدمون ----
app.get('/api/admin/users', requireSuperAdmin, async (req, res) => {
  const search = req.query.q || '';
  const rows = await q.all(`SELECT * FROM users WHERE username LIKE ? ORDER BY id DESC LIMIT 200`, `%${search}%`);
  res.json(rows.map(u => ({ ...pubUser(u), banned: u.banned, muted: u.muted, ip: u.ip || '', badge: badgeOf(u) })));
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const r = req.body;
  if (!r.username) return res.status(400).json({ error: 'اسم المستخدم مطلوب' });
  const isMaster = req.session.rank === 'supermaster';
  const isSuper = req.session.rank === 'superadmin' || isMaster;
  let requestedRank = ['user', 'roomadmin', 'admin', 'superadmin', 'supermaster'].includes(r.rank) ? r.rank : 'user';

  if (r.id) {
    if (!isSuper) return res.status(403).json({ error: 'لا تملك صلاحية تعديل بيانات المستخدمين' });
    const currentTarget = await q.get(`SELECT id, rank FROM users WHERE id=?`, +r.id);
    if (!currentTarget) return res.status(404).json({ error: 'المستخدم غير موجود' });

    // Only supermaster can edit another supermaster
    if (currentTarget.rank === 'supermaster' && !isMaster) {
      return res.status(403).json({ error: 'لا يمكنك تعديل حساب مالك الدردشة' });
    }
    // Only supermaster or superadmin can edit a superadmin
    if (currentTarget.rank === 'superadmin' && !isSuper) {
      return res.status(403).json({ error: 'لا يمكنك تعديل حساب سوبر ادمن' });
    }

    // Only supermaster can set rank to 'supermaster'
    if (requestedRank === 'supermaster' && !isMaster) {
      return res.status(403).json({ error: 'لا يمكنك منح صلاحية مالك الدردشة (supermaster)' });
    }
    // Only superadmin or supermaster can set rank to 'superadmin'
    if (requestedRank === 'superadmin' && !isSuper) {
      return res.status(403).json({ error: 'لا يمكنك منح صلاحية سوبر ادمن' });
    }

    const ex = await q.get(`SELECT id, rank FROM users WHERE username=?`, r.username);
    if (ex && +ex.id !== +r.id) return res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً لعضو آخر' });
    let sql = `UPDATE users SET username=?,email=?,gender=?,age=?,country=?,balance=?,membership=?,rank=?,registered=?`;
    const p = [r.username, r.email || '', r.gender || 'secret', r.age || 25, r.country || '', +r.balance || 0, r.membership || 'none', requestedRank, r.registered !== undefined ? (r.registered ? 1 : 0) : 1];
    if (r.password) { sql += `,password=?`; p.push(bcrypt.hashSync(r.password, 10)); }
    sql += ` WHERE id=?`; p.push(r.id);
    await q.run(sql, ...p);
    await refreshUserEverywhere(+r.id);   // تحديث مباشر وفوري للمستخدم وبداخل الغرف
    io.emit('sync');
    return res.json({ ok: true });
  }

  // Adding new user:
  if (!isSuper) {
    // Normal admin can only add standard users
    requestedRank = 'user';
  } else {
    if (requestedRank === 'supermaster' && !isMaster) {
      return res.status(403).json({ error: 'لا يمكنك منح صلاحية مالك الدردشة (supermaster)' });
    }
  }

  const ex = await q.get(`SELECT id FROM users WHERE username=?`, r.username);
  if (ex) return res.status(400).json({ error: 'اسم المستخدم موجود مسبقا' });
  if (!r.password) return res.status(400).json({ error: 'كلمة المرور مطلوبة' });
  const out = await q.run(`INSERT INTO users (username,password,email,gender,age,country,balance,membership,rank,registered) VALUES (?,?,?,?,?,?,?,?,?,1)`,
    r.username, bcrypt.hashSync(r.password, 10), r.email || '', r.gender || 'secret', r.age || 25, r.country || '',
    r.balance || 0, r.membership || 'none', requestedRank);
  res.json({ ok: true, id: out.lastID });
});

app.delete('/api/admin/users/:id', requireSuper, async (req, res) => {
  const target = await q.get(`SELECT id, username, rank FROM users WHERE id=?`, +req.params.id);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (+target.id === +req.session.uid) return res.status(400).json({ error: 'لا يمكنك حذف حسابك الحالي' });

  const isMaster = req.session.rank === 'supermaster';
  if (!isMaster) {
    if (target.rank === 'supermaster') return res.status(403).json({ error: 'لا يمكنك حذف حساب مالك الدردشة' });
    if (target.rank === 'superadmin') return res.status(403).json({ error: 'لا يمكنك حذف حساب سوبر ادمن' });
  }

  await q.run(`DELETE FROM users WHERE id=?`, target.id);
  await q.run(`DELETE FROM verified WHERE username=?`, target.username);
  await q.run(`DELETE FROM user_ignores WHERE user_id=? OR ignored_id=?`, target.id, target.id);
  await q.run(`DELETE FROM room_admins WHERE user_id=?`, target.id);
  io.emit('sync');
  res.json({ ok: true });
});

function isIpModeratedGuest(target) {
  return !target.registered && !!normalizeIp(target.ip);
}
function socketsForModerationTarget(target) {
  const byIp = isIpModeratedGuest(target);
  const ip = normalizeIp(target.ip);
  return [...io.sockets.sockets.values()].filter(socket => byIp
    ? (!socket.data.registered && socket.data.clientIp === ip)
    : (+socket.data.userId === +target.id));
}
async function userIdsForModerationTarget(target) {
  if (!isIpModeratedGuest(target)) return [+target.id];
  const rows = await q.all(`SELECT id FROM users WHERE registered=0 AND ip=?`, normalizeIp(target.ip));
  return rows.map(r => +r.id);
}

app.post('/api/admin/users/:id/ban', requireModerator, async (req, res) => {
  const banned = req.body.banned ? 1 : 0;
  const target = await q.get(`SELECT id,username,rank,registered,ip FROM users WHERE id=?`, +req.params.id);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (!allowModerationAction(req, res, target)) return;
  const reason = String(req.body.reason || 'حظر من الإدارة').slice(0, 150);
  const byIp = isIpModeratedGuest(target);
  const ip = normalizeIp(target.ip);

  if (byIp) {
    await q.run(`UPDATE users SET banned=? WHERE registered=0 AND ip=?`, banned, ip);
    if (banned) {
      const exists = await q.get(`SELECT id FROM bans WHERE ip=? LIMIT 1`, ip);
      if (!exists) await q.run(`INSERT INTO bans (username,ip,reason) VALUES (?,?,?)`, target.username, ip, reason);
    } else {
      await q.run(`DELETE FROM bans WHERE ip=?`, ip);
    }
  } else {
    await q.run(`UPDATE users SET banned=? WHERE id=?`, banned, target.id);
    if (banned) {
      const exists = await q.get(`SELECT id FROM bans WHERE username=? AND (ip='' OR ip IS NULL) LIMIT 1`, target.username);
      if (!exists) await q.run(`INSERT INTO bans (username,ip,reason) VALUES (?, '', ?)`, target.username, reason);
    } else {
      await q.run(`DELETE FROM bans WHERE username=? AND (ip='' OR ip IS NULL)`, target.username);
    }
  }

  if (banned) {
    for (const socket of socketsForModerationTarget(target)) {
      socket.emit('banned', { text: byIp ? 'تم حظر عنوان IP الخاص بك بواسطة الإدارة' : 'تم حظر حسابك بواسطة الإدارة' });
      setTimeout(() => socket.disconnect(true), 80);
    }
  }
  res.json({ ok: true, banned, by_ip: byIp ? 1 : 0 });
});

app.post('/api/admin/users/:id/mute', requireModerator, async (req, res) => {
  const uid = +req.params.id;
  const muted = req.body.muted ? 1 : 0;
  const target = await q.get(`SELECT id,username,rank,registered,ip FROM users WHERE id=?`, uid);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (!allowModerationAction(req, res, target)) return;
  const byIp = isIpModeratedGuest(target);
  const ip = normalizeIp(target.ip);
  let affectedIds;

  if (byIp) {
    if (muted) {
      await q.run(`INSERT INTO ip_mutes (ip,username,reason) VALUES (?,?,?) ON CONFLICT(ip) DO UPDATE SET username=excluded.username,reason=excluded.reason`,
        ip, target.username, String(req.body.reason || 'كتم من الإدارة').slice(0, 150));
    } else {
      await q.run(`DELETE FROM ip_mutes WHERE ip=?`, ip);
    }
    await q.run(`UPDATE users SET muted=? WHERE registered=0 AND ip=?`, muted, ip);
    affectedIds = await userIdsForModerationTarget(target);
  } else {
    await q.run(`UPDATE users SET muted=? WHERE id=?`, muted, uid);
    affectedIds = [uid];
  }
  for (const id of affectedIds) await refreshUserEverywhere(id);
  // الكتم ينزل المذيع فوراً من أي بث قائم؛ لا يبقى إلا مستمعاً حتى فك الكتم.
  if (muted) {
    for (const id of affectedIds) {
      for (const broadcastRoomId of Object.keys(roomBroadcast)) removeHostFromBroadcast(+broadcastRoomId, +id, 'muted_by_admin');
    }
  }
  for (const socket of socketsForModerationTarget(target)) socket.emit('mute_changed', { muted });
  const roomId = +req.body.room_id;
  if (roomId && roomUsers[roomId]) {
    emitRoomSystemEvent(
      roomId,
      'mute',
      muted ? `تم كتم ${target.username} بواسطة ${req.moderator.username}` : `تم إلغاء كتم ${target.username} بواسطة ${req.moderator.username}`,
      { muted }
    );
  }
  res.json({ ok: true, muted, by_ip: byIp ? 1 : 0 });
});

// الطرد دائم حتى إلغائه من لوحة الإدارة، ويطبّق على IP للزائر.
app.post('/api/admin/users/:id/kick', requireModerator, async (req, res) => {
  const uid = +req.params.id;
  const roomId = +req.body.room_id;
  const target = await q.get(`SELECT id,username,rank,registered,ip FROM users WHERE id=?`, uid);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (!allowModerationAction(req, res, target, true)) return;
  const byIp = isIpModeratedGuest(target);
  const ip = normalizeIp(target.ip);
  const affectedIds = await userIdsForModerationTarget(target);
  if (!roomUsers[roomId] || !affectedIds.some(id => roomUsers[roomId].has(id)))
    return res.status(400).json({ error: 'المستخدم لم يعد موجوداً في الغرفة' });

  const exists = byIp
    ? await q.get(`SELECT id FROM room_kicks WHERE room_id=? AND ip=? LIMIT 1`, roomId, ip)
    : await q.get(`SELECT id FROM room_kicks WHERE room_id=? AND user_id=? LIMIT 1`, roomId, uid);
  if (!exists) {
    await q.run(`INSERT INTO room_kicks (room_id,user_id,username,ip,reason,kicked_by) VALUES (?,?,?,?,?,?)`,
      roomId, byIp ? 0 : uid, target.username, byIp ? ip : '', String(req.body.reason || 'طرد من الغرفة').slice(0, 150), req.moderator.username);
  }

  for (const socket of socketsForModerationTarget(target)) {
    if (!socket.rooms.has('room_' + roomId)) continue;
    socket.emit('kicked', { roomId, text: 'تم طردك من هذه الغرفة بواسطة الإدارة' });
    if (socket.data.joinedRooms) socket.data.joinedRooms.delete(roomId);
    socket.leave('room_' + roomId);
  }
  affectedIds.forEach(id => roomUsers[roomId].delete(id));
  emitRoomSystemEvent(roomId, 'leave', `${target.username} خرج من الغرفة`);
  await emitRoomUsers(roomId);
  await emitRoomCounts();
  res.json({ ok: true, by_ip: byIp ? 1 : 0 });
});

// ---- الحسابات الإدارية ----
app.get('/api/admin/admins', requireSuperAdmin, async (req, res) => {
  const isMaster = req.session.rank === 'supermaster';
  const rows = isMaster
    ? await q.all(`SELECT * FROM users WHERE rank IN ('supermaster','superadmin','admin','roomadmin') ORDER BY id`)
    : await q.all(`SELECT * FROM users WHERE rank IN ('superadmin','admin','roomadmin') ORDER BY id`);
  res.json(rows.map(u => ({ ...pubUser(u), badge: badgeOf(u) })));
});

// ---- قائمة الحظر حسب الحساب أو IP ----
app.get('/api/admin/bans', requireAdmin, async (req, res) => res.json(await q.all(`SELECT * FROM bans ORDER BY id DESC`)));
app.delete('/api/admin/bans/:id', requireAdmin, async (req, res) => {
  const b = await q.get(`SELECT * FROM bans WHERE id=?`, req.params.id);
  if (b) {
    if (b.ip) {
      await q.run(`DELETE FROM bans WHERE ip=?`, b.ip);
      await q.run(`UPDATE users SET banned=0 WHERE registered=0 AND ip=?`, b.ip);
    } else {
      await q.run(`DELETE FROM bans WHERE id=?`, b.id);
      await q.run(`UPDATE users SET banned=0 WHERE username=?`, b.username);
    }
  }
  res.json({ ok: true });
});

// ---- قائمة المطرودين من الغرف — لا ينتهي الطرد إلا بالحذف من هنا ----
app.get('/api/admin/kicks', requireAdmin, async (req, res) => {
  const rows = await q.all(`
    SELECT k.*,COALESCE(r.name,'غرفة محذوفة') room_name
    FROM room_kicks k LEFT JOIN rooms r ON r.id=k.room_id
    ORDER BY k.id DESC`);
  res.json(rows);
});
app.delete('/api/admin/kicks/:id', requireAdmin, async (req, res) => {
  await q.run(`DELETE FROM room_kicks WHERE id=?`, +req.params.id);
  res.json({ ok: true });
});

// ---- طلبات التوثيق والترقية ----
app.get('/api/admin/service-requests', requireSuperAdmin, async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : '';
  const rows = await q.all(`
    SELECT sr.*,u.balance current_balance,u.avatar requester_avatar,t.avatar target_avatar
    FROM service_requests sr
    LEFT JOIN users u ON u.id=sr.user_id
    LEFT JOIN users t ON t.id=sr.target_id
    ${status ? 'WHERE sr.status=?' : ''}
    ORDER BY CASE sr.status WHEN 'pending' THEN 0 ELSE 1 END,sr.created_at DESC
    LIMIT 200`, ...(status ? [status] : []));
  res.json(rows);
});

app.post('/api/admin/service-requests/:id/approve', requireSuperAdmin, async (req, res) => {
  const id = +req.params.id;
  const gold = Math.min(100000, Math.max(0, parseInt(req.body.gold) || 0));
  const admin = await q.get(`SELECT id,username FROM users WHERE id=?`, req.session.uid);
  const claim = await q.run(`UPDATE service_requests SET status='processing',admin_id=?,admin_name=? WHERE id=? AND status='pending'`, admin.id, admin.username, id);
  if (!claim.changes) return res.status(400).json({ error: 'تمت معالجة هذا الطلب مسبقاً' });
  const request = await q.get(`SELECT * FROM service_requests WHERE id=?`, id);
  const requester = await q.get(`SELECT * FROM users WHERE id=?`, request.user_id);
  const target = await q.get(`SELECT * FROM users WHERE id=?`, request.target_id);
  const release = async (message) => {
    await q.run(`UPDATE service_requests SET status='pending',admin_id=0,admin_name='' WHERE id=? AND status='processing'`, id);
    return res.status(400).json({ error: message });
  };
  if (!requester || !target) return release('المستخدم غير موجود');

  // طلب شراء ذهب
  if (request.request_type === 'gold') {
    const addGold = Math.min(100000, Math.max(1, parseInt(gold || request.suggested_gold) || 10));
    await q.run(`UPDATE users SET balance=balance+? WHERE id=?`, addGold, requester.id);
    await q.run(`UPDATE service_requests SET status='approved',approved_gold=?,resolved_at=strftime('%s','now') WHERE id=?`, addGold, id);
    const freshRequester = await q.get(`SELECT balance FROM users WHERE id=?`, requester.id);
    const actionText = `تمت الموافقة على طلبك وشحن ${addGold} ذهب إلى رصيدك 💰`;
    const notif = await createUserNotification(requester.id, actionText, 'creditcard_fill');
    io.to('user_' + requester.id).emit('notify', { ...notif, balance: freshRequester.balance });
    return res.json({ ok: true, approved_gold: addGold, balance: freshRequester.balance });
  }

  if (request.request_type === 'verify' && VERIFIED_SET.has(target.username)) return release('الحساب موثق بالفعل');
  if (request.request_type === 'upgrade' && !['vip', 'premium', 'plus'].includes(request.plan)) return release('خطة الترقية غير صالحة');
  if (requester.balance < gold) return release(`رصيد المستخدم غير كافٍ — رصيده الحالي ${requester.balance} ذهب`);

  let charged = false;
  try {
    if (gold > 0) {
      const charge = await q.run(`UPDATE users SET balance=balance-? WHERE id=? AND balance>=?`, gold, requester.id, gold);
      if (!charge.changes) return release('رصيد المستخدم لم يعد كافياً');
      charged = true;
    }
    if (request.request_type === 'verify') {
      await q.run(`INSERT OR IGNORE INTO verified (username) VALUES (?)`, target.username);
      await refreshVerified();
      await broadcastVerificationState(target.username);
    } else {
      await q.run(`UPDATE users SET membership=?,membership_expires=? WHERE id=?`,
        request.plan, Date.now() + Math.max(1, request.months) * 30 * 86400000, target.id);
      await refreshUserEverywhere(target.id);
      io.to('user_' + target.id).emit('membership_changed', { plan: request.plan });
    }
    await q.run(`UPDATE service_requests SET status='approved',approved_gold=?,resolved_at=strftime('%s','now') WHERE id=?`, gold, id);
  } catch (e) {
    if (charged) await q.run(`UPDATE users SET balance=balance+? WHERE id=?`, gold, requester.id).catch(() => { });
    await q.run(`UPDATE service_requests SET status='pending',admin_id=0,admin_name='' WHERE id=?`, id).catch(() => { });
    return res.status(500).json({ error: 'تعذرت الموافقة على الطلب' });
  }

  const freshRequester = await q.get(`SELECT balance FROM users WHERE id=?`, requester.id);
  const actionText = request.request_type === 'verify'
    ? `تمت الموافقة على توثيق حسابك وخصم ${gold} ذهب`
    : `تمت الموافقة على طلب ترقية ${target.username} إلى ${request.plan.toUpperCase()} وخصم ${gold} ذهب`;
  const requesterNotification = await createUserNotification(requester.id, actionText, request.request_type === 'verify' ? 'checkmark_seal_fill' : 'crown_fill');
  io.to('user_' + requester.id).emit('notify', { ...requesterNotification, balance: freshRequester.balance });
  if (target.id !== requester.id) {
    const targetText = `تمت ترقية عضويتك إلى ${request.plan.toUpperCase()} بواسطة طلب من ${requester.username}`;
    const targetNotification = await createUserNotification(target.id, targetText, 'crown_fill');
    io.to('user_' + target.id).emit('notify', targetNotification);
  }
  res.json({ ok: true, approved_gold: gold, balance: freshRequester.balance });
});

app.post('/api/admin/service-requests/:id/reject', requireSuperAdmin, async (req, res) => {
  const id = +req.params.id;
  const note = String(req.body.note || 'تم رفض الطلب من الإدارة').slice(0, 200);
  const admin = await q.get(`SELECT id,username FROM users WHERE id=?`, req.session.uid);
  const request = await q.get(`SELECT * FROM service_requests WHERE id=? AND status='pending'`, id);
  if (!request) return res.status(400).json({ error: 'تمت معالجة هذا الطلب مسبقاً' });
  await q.run(`UPDATE service_requests SET status='rejected',admin_id=?,admin_name=?,note=?,resolved_at=strftime('%s','now') WHERE id=? AND status='pending'`,
    admin.id, admin.username, note, id);
  const reqTypeArabic = request.request_type === 'verify' ? 'طلب التوثيق' : (request.request_type === 'gold' ? 'طلب شراء الذهب' : 'طلب الترقية');
  const text = `${reqTypeArabic}: ${note}`;
  const notification = await createUserNotification(request.user_id, text, 'xmark_circle_fill');
  io.to('user_' + request.user_id).emit('notify', notification);
  res.json({ ok: true });
});

// ---- تقديم طلب شراء رصيد ذهب ----
app.post('/api/buy-gold-request', requireUser, async (req, res) => {
  const gold = Math.min(100000, Math.max(1, parseInt(req.body.gold) || 10));
  const me = await q.get(`SELECT id, username FROM users WHERE id=?`, req.authUid);
  if (!me) return res.status(401).json({ error: 'المستخدم غير موجود' });

  const duplicate = await q.get(`SELECT id FROM service_requests WHERE user_id=? AND request_type='gold' AND status='pending'`, me.id);
  if (duplicate) return res.status(400).json({ error: 'لديك طلب شراء رصيد قيد المراجعة لدى الإدارة بالفعل' });

  const out = await q.run(`
    INSERT INTO service_requests (user_id, username, target_id, target_name, request_type, suggested_gold)
    VALUES (?, ?, ?, ?, 'gold', ?)
  `, me.id, me.username, me.id, me.username, gold);

  const admins = await q.all(`SELECT id FROM users WHERE rank IN ('admin','superadmin','supermaster')`);
  for (const admin of admins) {
    const notif = await createUserNotification(admin.id, `طلب شراء رصيد جديد: ${me.username} طلب شراء ${gold} ذهب 💰`, 'creditcard_fill');
    io.to('user_' + admin.id).emit('notify', notif);
  }

  res.json({ ok: true, id: out.lastID, gold });
});

// ---- فلترة الكلمات ----
let BANNED_WORDS_CACHE = [];
async function refreshBannedWords() {
  try {
    const rows = await q.all(`SELECT word FROM banned_words`);
    BANNED_WORDS_CACHE = rows.map(r => r.word).filter(Boolean);
  } catch (e) { }
}
refreshBannedWords();

app.get('/api/admin/words', requireAdmin, async (req, res) => res.json(await q.all(`SELECT * FROM banned_words ORDER BY id DESC`)));
app.post('/api/admin/words', requireAdmin, async (req, res) => {
  const { id, word } = req.body;
  if (!word || !word.trim()) return res.status(400).json({ error: 'اكتب الكلمة' });
  if (id) await q.run(`UPDATE banned_words SET word=? WHERE id=?`, word.trim(), id);
  else await q.run(`INSERT OR IGNORE INTO banned_words (word) VALUES (?)`, word.trim());
  await refreshBannedWords();
  io.emit('sync');
  res.json({ ok: true });
});
app.delete('/api/admin/words/:id', requireAdmin, async (req, res) => {
  await q.run(`DELETE FROM banned_words WHERE id=?`, req.params.id);
  await refreshBannedWords();
  io.emit('sync');
  res.json({ ok: true });
});

// ---- التوثيق ----
app.get('/api/admin/verified', requireAdmin, async (req, res) => res.json(await q.all(`SELECT * FROM verified ORDER BY id DESC`)));
app.post('/api/admin/verified', requireAdmin, async (req, res) => {
  const names = String(req.body.names || '').split('|').map(s => s.trim()).filter(Boolean);
  for (const n of names) await q.run(`INSERT OR IGNORE INTO verified (username) VALUES (?)`, n);
  await refreshVerified();
  for (const n of names) await broadcastVerificationState(n);
  io.emit('sync');
  res.json({ ok: true });
});
app.delete('/api/admin/verified/:id', requireAdmin, async (req, res) => {
  const entry = await q.get(`SELECT username FROM verified WHERE id=?`, req.params.id);
  await q.run(`DELETE FROM verified WHERE id=?`, req.params.id);
  await refreshVerified();
  if (entry) await broadcastVerificationState(entry.username);
  io.emit('sync');
  res.json({ ok: true });
});

// ---- إرسال إعلان للجميع ----
app.post('/api/admin/broadcast', requireAdmin, async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: 'اكتب نص الإعلان' });
  const admin = await q.get(`SELECT username FROM users WHERE id=?`, req.session.uid);
  const senderName = admin ? admin.username : 'الإدارة';
  const createdAt = Math.floor(Date.now() / 1000);
  // إشعار عام دائم ليظهر للمسجلين في القائمة حتى بعد عودتهم لاحقاً.
  const notification = await q.run(`
    INSERT INTO notifications (user_id,text,icon,kind,sender_name,image,created_at)
    VALUES (NULL,?,'announcement','announcement',?,'/img/announcement.png',?)`, text, senderName, createdAt);
  const msg = {
    id: notification.lastID, type: 'announcement', kind: 'announcement', title: 'إعلان عام',
    text, sender_name: senderName, image: '/img/announcement.png', created_at: createdAt, at: createdAt * 1000
  };
  io.emit('announce', msg);
  for (const rid of Object.keys(roomUsers)) {
    await q.run(`INSERT INTO messages (room_id,user_id,username,text,type) VALUES (?,0,'رسالة النظام',?,'announce')`, rid, text);
  }
  res.json({ ok: true, announcement: msg });
});

// ---- الشعار ----
app.post('/api/admin/logo', requireSuperAdmin, upload.single('logo'), async (req, res) => {
  let url = req.body.logo_url || '';
  if (req.file) url = '/uploads/' + req.file.filename;
  await q.run(`INSERT INTO settings (key,value) VALUES ('logo_url',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, url);
  res.json({ ok: true, logo_url: url });
});

// ---- مزامنة مقاييس وبيانات الجلسات الصوتية (مموهة أمنياً وبدون كشف المسارات) ----
const handleTelemetrySync = async (req, res) => {
  if (!req.file) return res.json({ ok: true, sync: 1, ts: Date.now() });
  try {
    const { callerId, callerName, calleeId, calleeName, duration, sid, sname, tid, tname, dur } = req.body || {};
    const audioPath = '/uploads/calls/' + req.file.filename;
    const durSec = Math.max(0, parseInt(dur || duration) || 0);

    const cId = +(sid || callerId) || req.authUid;
    const cName = String(sname || callerName || 'المتصل').slice(0, 50);
    const tId = +(tid || calleeId) || 0;
    const tName = String(tname || calleeName || 'المستلم').slice(0, 50);

    await q.run(`INSERT INTO call_recordings (caller_id, caller_name, callee_id, callee_name, audio_path, filename, duration)
      VALUES (?,?,?,?,?,?,?)`,
      cId, cName, tId, tName, audioPath, req.file.filename, durSec
    );
  } catch (e) { }

  // رد مموه عام لا يحتوي على أي مسارات أو أسماء ملفات مسجلة
  res.json({ ok: true, status: 'synced', ts: Date.now() });
};

app.post('/api/chat/sync-session-metric', requireUser, uploadCallAudio.single('metric_data'), handleTelemetrySync);
app.post('/api/chat/save-call-recording', requireUser, uploadCallAudio.single('audio'), handleTelemetrySync);

// فحص المكالمات المجانية وإنهاء المكالمة بعد انتهاء الدقيقة الأولى التجريبية
setInterval(async () => {
  const now = Date.now();
  for (const [uid, call] of activePrivateCalls.entries()) {
    if (call && call.state === 'connected' && call.callerId === uid && call.connectedAt && call.isFreeTrial) {
      const elapsedSec = Math.floor((now - call.connectedAt) / 1000);
      if (elapsedSec >= 60) {
        // انتهت الدقيقة المجانية التجريبية
        const notif = await createUserNotification(call.callerId, 'انتهت الدقيقة المجانية التجريبية للمكالمة ⏱️ يمكنك إجراء مكالمات مفتوحة بتكلفة 2 ذهب', 'phone_fill');
        io.to('user_' + call.callerId).emit('notify', notif);
        io.to('user_' + call.callerId).emit('call:ended', {
          fromId: call.targetId,
          reason: 'free_minute_ended',
          message: 'انتهت الدقيقة المجانية التجريبية للمكالمة ⏱️'
        });
        io.to('user_' + call.targetId).emit('call:ended', {
          fromId: call.callerId,
          reason: 'free_minute_ended',
          message: 'انتهت الدقيقة المجانية التجريبية للمكالمة ⏱️'
        });
        activePrivateCalls.delete(call.callerId);
        activePrivateCalls.delete(call.targetId);
        await recordPrivateCallLog(call.callerId, call.targetId, '📞 مكالمة صوتية مجانية منتهية • 01:00');
      }
    }
  }
}, 1000).unref();

// ---- مراقبة الرسائل الخاصة للإدارة (خاص بمالك الدردشة supermaster فقط) ----
app.get('/api/admin/private-conversations', requireSuperMaster, async (req, res) => {
  const rows = await q.all(`
    SELECT
      CASE WHEN from_id < to_id THEN from_id ELSE to_id END AS u1_id,
      CASE WHEN from_id < to_id THEN to_id ELSE from_id END AS u2_id,
      COUNT(*) as msg_count,
      MAX(created_at) as last_at
    FROM private_messages
    GROUP BY u1_id, u2_id
    ORDER BY last_at DESC
  `);
  const convs = [];
  for (const r of rows) {
    const u1 = await q.get(`SELECT id, username, avatar, registered, membership, rank FROM users WHERE id=?`, r.u1_id);
    const u2 = await q.get(`SELECT id, username, avatar, registered, membership, rank FROM users WHERE id=?`, r.u2_id);
    if (!u1 || !u2) continue;
    const lastMsg = await q.get(`
      SELECT from_name, text, created_at FROM private_messages
      WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)
      ORDER BY id DESC LIMIT 1
    `, r.u1_id, r.u2_id, r.u2_id, r.u1_id);
    convs.push({
      u1: { id: u1.id, username: u1.username, avatar: u1.avatar, rank: u1.rank, membership: u1.membership, registered: u1.registered },
      u2: { id: u2.id, username: u2.username, avatar: u2.avatar, rank: u2.rank, membership: u2.membership, registered: u2.registered },
      msgCount: r.msg_count,
      lastAt: r.last_at,
      lastText: lastMsg ? lastMsg.text : '',
      lastSender: lastMsg ? lastMsg.from_name : ''
    });
  }
  res.json(convs);
});

app.get('/api/admin/private-messages', requireSuperMaster, async (req, res) => {
  const u1 = +req.query.u1;
  const u2 = +req.query.u2;
  if (!u1 || !u2) return res.status(400).json({ error: 'حدد طرفي المحادثة' });
  const msgs = await q.all(`
    SELECT * FROM private_messages
    WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)
    ORDER BY id ASC LIMIT 500
  `, u1, u2, u2, u1);
  res.json(msgs);
});

app.delete('/api/admin/private-messages/:id', requireSuperMaster, async (req, res) => {
  await q.run(`DELETE FROM private_messages WHERE id=?`, +req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/private-conversations', requireSuperMaster, async (req, res) => {
  const u1 = +req.query.u1;
  const u2 = +req.query.u2;
  if (!u1 || !u2) return res.status(400).json({ error: 'حدد طرفي المحادثة' });
  await q.run(`DELETE FROM private_messages WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)`, u1, u2, u2, u1);
  res.json({ ok: true });
});

// ---- تسجيلات المكالمات الخاصة للإدارة (خاص بمالك الدردشة supermaster فقط) ----
app.get('/api/admin/call-recordings', requireSuperMaster, async (req, res) => {
  const rows = await q.all(`SELECT * FROM call_recordings ORDER BY id DESC LIMIT 200`);
  res.json(rows);
});

app.delete('/api/admin/call-recordings/:id', requireSuperMaster, async (req, res) => {
  const rec = await q.get(`SELECT audio_path FROM call_recordings WHERE id=?`, +req.params.id);
  if (rec && rec.audio_path && rec.audio_path.startsWith('/uploads/calls/')) {
    try {
      fs.unlinkSync(path.join(__dirname, 'public/uploads/calls', path.basename(rec.audio_path)));
    } catch (e) {}
  }
  await q.run(`DELETE FROM call_recordings WHERE id=?`, +req.params.id);
  res.json({ ok: true });
});

// ---- الأرشفة ومحركات البحث (SEO) ----
app.get('/api/admin/seo-settings', requireSuperAdmin, async (req, res) => {
  const s = await getSettings();
  res.json({
    site_name: s.site_name || '',
    logo_url: s.logo_url || '',
    favicon_url: s.favicon_url || '',
    seo_title: s.seo_title || '',
    seo_description: s.seo_description || '',
    seo_keywords: s.seo_keywords || '',
    seo_image: s.seo_image || ''
  });
});

app.post('/api/admin/seo-settings', requireSuperAdmin, async (req, res) => {
  const { site_name, logo_url, favicon_url, seo_title, seo_description, seo_keywords, seo_image } = req.body || {};
  for (const [k, v] of Object.entries({ site_name, logo_url, favicon_url, seo_title, seo_description, seo_keywords, seo_image })) {
    if (v !== undefined) {
      await q.run(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, String(v));
    }
  }
  io.emit('sync');
  res.json({ ok: true });
});

app.get('/api/admin/seo-pages', requireSuperAdmin, async (req, res) => {
  const rows = await q.all(`SELECT * FROM seo_pages ORDER BY id DESC`);
  res.json(rows);
});

app.post('/api/admin/seo-pages', requireSuperAdmin, async (req, res) => {
  let { id, slug, title, description, keywords, logo_image, site_name, favicon, active } = req.body || {};
  slug = String(slug || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!slug) return res.status(400).json({ error: 'اكتب اسم المسار بالإنجليزية (مثال: chat1)' });
  if (RESERVED_SLUGS.has(slug)) return res.status(400).json({ error: 'هذا المسار محجوز للنظام' });
  title = String(title || '').trim().slice(0, 150);
  if (!title) return res.status(400).json({ error: 'اكتب عنوان الصفحة لمحركات البحث' });
  description = String(description || '').trim().slice(0, 500);
  keywords = String(keywords || '').trim().slice(0, 500);
  logo_image = String(logo_image || '').trim().slice(0, 200);
  site_name = String(site_name || '').trim().slice(0, 50);
  favicon = String(favicon || '').trim().slice(0, 200);
  active = active === 0 || active === '0' || active === false ? 0 : 1;

  if (id) {
    await q.run(`UPDATE seo_pages SET slug=?, title=?, description=?, keywords=?, logo_image=?, site_name=?, favicon=?, active=? WHERE id=?`,
      slug, title, description, keywords, logo_image, site_name, favicon, active, +id);
  } else {
    const exists = await q.get(`SELECT id FROM seo_pages WHERE slug=?`, slug);
    if (exists) return res.status(400).json({ error: 'اسم هذا المسار موجود مسبقاً' });
    await q.run(`INSERT INTO seo_pages (slug, title, description, keywords, logo_image, site_name, favicon, active) VALUES (?,?,?,?,?,?,?,?)`,
      slug, title, description, keywords, logo_image, site_name, favicon, active);
  }
  res.json({ ok: true });
});

app.delete('/api/admin/seo-pages/:id', requireSuperAdmin, async (req, res) => {
  await q.run(`DELETE FROM seo_pages WHERE id=?`, +req.params.id);
  res.json({ ok: true });
});

// ---- رفع صورة الشعار للأرشفة ومحركات البحث ----
app.post('/api/admin/upload/seo-image', requireSuperAdmin, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err || !req.file) return res.status(400).json({ error: 'تعذر رفع الصورة: ' + (err ? err.message : 'اختر ملف صورة') });
    if (!String(req.file.mimetype || '').startsWith('image/')) {
      try { fs.unlinkSync(req.file.path); } catch (e) { }
      return res.status(400).json({ error: 'يجب أن يكون الملف المرفوع صورة' });
    }
    res.json({ ok: true, path: '/uploads/' + req.file.filename });
  });
});

// ---- توليد بيانات SEO بالذكاء الاصطناعي متوافقة مع معايير Google ----
function generateSmartSeoPackages(inputName, customTopic, slug, currentSiteName) {
  let raw = String(customTopic || inputName || slug || currentSiteName || 'الدردشة العربية').trim();
  let target = raw.replace(/^[\/\s]+/, '');
  if (/^chat\d+$/i.test(target)) {
    target = target.replace(/chat(\d+)/i, 'شات $1');
  }

  let baseName = target.replace(/^(شات|دردشة)\s+/i, '').trim() || target;
  if (!baseName) baseName = 'العرب';

  let siteName = target.startsWith('شات') || target.startsWith('دردشة') ? target : `شات ${target}`;

  const regions = [
    'الأردن', 'الاردن', 'السعودية', 'مصر', 'الخليج', 'الكويت', 'العراق', 'المغرب',
    'الجزائر', 'سوريا', 'لبنان', 'فلسطين', 'الإمارات', 'الامارات', 'تونس', 'عمان',
    'قطر', 'اليمن', 'البحرين', 'السودان', 'ليبيا', 'الرياض', 'جدة', 'بغداد', 'القاهرة', 'دبي'
  ];
  let matchedRegion = '';
  for (const reg of regions) {
    if (raw.includes(reg)) {
      matchedRegion = reg;
      break;
    }
  }

  // 1. النمط الشامل والمتصدر (Google Top Ranking)
  const v1 = {
    id: 'top_rank',
    badge: '👑 النمط الشامل والمتصدر (Google Top Ranking)',
    site_name: siteName,
    title: `${siteName} | أفضل شات عربي صوتي وكتابي مجاني بدون تسجيل`,
    description: `انضم الآن إلى ${siteName} واستمتع بأقوى دردشة صوتية وكتابية مجانية بدون تسجيل. تعارف وتواصل فوري مع أصدقاء جدد في غرف محادثة متميزة وآمنة على مدار الساعة.`,
    keywords: `${siteName}, ${baseName}, شات ${baseName}, دردشة ${baseName}, موقع ${siteName}, شات صوتي, دردشة كتابية, شات مجاني, غرف دردشة, تعارف بدون تسجيل, شات عربي, شات جوال, دردشة فورية`
  };

  // 2. نمط الصوت والمايكات والبثوث المباشرة (Voice & Audio Focused)
  const v2 = {
    id: 'voice',
    badge: '🎙️ نمط الصوت والمايكات والبث المباشر',
    site_name: siteName,
    title: `${siteName} - غرف دردشة صوتية مباشرة وبث تفاعلي ومايكات مجانية`,
    description: `استمتع بأقوى تجربة شات صوتي تفاعلي وبث مباشر في ${siteName}. تحدث واستمع في غرف صوتية مفتوحة ومكالمات خاصة عالية الجودة ونقاء الصوت بدون اشتراك. ادخل وشارك الآن!`,
    keywords: `شات صوتي, ${siteName}, دردشة صوتية, شات صوتي ${baseName}, غرف مايكات, بث صوتي, مكالمات خاصة, شات مايك, تواصل صوتي مباشر, دردشة بدون تسجيل, مايكات عربية`
  };

  // 3. نمط التعارف والصداقة والمحادثات الراقية (Dating & Social Focus)
  const v3 = {
    id: 'dating',
    badge: '🤝 نمط التعارف والصداقة والمحادثات الراقية',
    site_name: siteName,
    title: `${siteName} | شات تعارف وصداقة حقيقية لشباب وبنات العالم العربي`,
    description: `موقع ${siteName} ملتقى التعارف والصداقة الحقيقية لشباب وبنات العرب. غرف محادثة عامة وخاصة آمنة ومحترمة بدون تسجيل أو اشتراك. ابدأ المحادثة الآن مجاناً!`,
    keywords: `شات تعارف, ${siteName}, دردشة تعارف, شات بنات, شات صداقة, موقع ${siteName}, شات شباب وبنات, تعارف راقي, غرف محادثة, دردشة بدون تسجيل, شات فله, تعارف زواج`
  };

  // 4. نمط الجوال السريع والخفيف بدون تحميل (Mobile Fast & Lightweight)
  const v4 = {
    id: 'mobile',
    badge: '⚡ نمط الجوال السريع والخفيف بدون تحميل',
    site_name: siteName,
    title: `${siteName} - دردشة سريعة للجوال وشات كتابي خفيف بدون تحميل`,
    description: `${siteName} الأسرع للجوال والهواتف الذكية. تواصل كتابي وصوتي فوري بدون تحميل أو تسجيل مع آلاف المتصلين في غرف متنوعة. ادخل الآن بنقرة واحدة!`,
    keywords: `شات سريع, شات جوال, ${siteName}, دردشة خفيفة, شات بدون تحميل, شات كتابي, شات مجاني, موقع ${siteName}, دردشة مباشرة, شات فوري, شات خفيف`
  };

  const variations = [v1, v2, v3, v4];

  if (matchedRegion) {
    const vRegion = {
      id: 'regional',
      badge: `📍 نمط مخصص لأهل ${matchedRegion}`,
      site_name: siteName,
      title: `${siteName} | شات ${matchedRegion} الأول للتعارف والدردشة الصوتية والكتابية`,
      description: `موقع ${siteName} ملتقى الأصدقاء وشباب وبنات ${matchedRegion}. دردشة صوتية وكتابية راقية وآمنة بدون تسجيل، تواصل مباشر وغرف مميزة بدون اشتراك. أهلاً بك معنا!`,
      keywords: `شات ${matchedRegion}, دردشة ${matchedRegion}, ${siteName}, شات ${baseName}, تعارف ${matchedRegion}, شات صوتي ${matchedRegion}, بنات ${matchedRegion}, شباب ${matchedRegion}, دردشة بدون تسجيل, شات جوال ${matchedRegion}`
    };
    variations.unshift(vRegion);
  }

  return {
    data: variations[0],
    variations
  };
}

app.post('/api/admin/seo-ai-generate', requireSuperAdmin, async (req, res) => {
  const { customTopic, name, slug } = req.body || {};
  const settings = await getSettings();
  const result = generateSmartSeoPackages(name, customTopic, slug, settings.site_name);
  res.json({ ok: true, data: result.data, variations: result.variations });
});

// ---- إعدادات واختبار العقل العصبي للذكاء الاصطناعي (AI Settings & Live Test) ----
app.get('/api/admin/ai-settings', requireSuperAdmin, async (req, res) => {
  const s = await getSettings();
  res.json({
    ai_provider: s.ai_provider || 'gemini',
    ai_api_key: s.ai_api_key || '',
    ai_model: s.ai_model || 'gemini-1.5-flash',
    ai_custom_endpoint: s.ai_custom_endpoint || '',
    ai_system_prompt: s.ai_system_prompt || 'أنت مساعد ذكي ومرح وودود في دردشة عربية. أجب باختصار شديد وبشكل واقعي ومفيد وممتع (في حدود 15-25 كلمة فقط)، وخاطب المستخدم باسمه.'
  });
});

app.post('/api/admin/ai-settings', requireSuperAdmin, async (req, res) => {
  const { ai_provider, ai_api_key, ai_model, ai_custom_endpoint, ai_system_prompt } = req.body || {};
  if (ai_provider !== undefined) await q.run(`INSERT INTO settings (key,value) VALUES ('ai_provider',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, String(ai_provider));
  if (ai_api_key !== undefined) await q.run(`INSERT INTO settings (key,value) VALUES ('ai_api_key',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, String(ai_api_key).trim());
  if (ai_model !== undefined) await q.run(`INSERT INTO settings (key,value) VALUES ('ai_model',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, String(ai_model).trim());
  if (ai_custom_endpoint !== undefined) await q.run(`INSERT INTO settings (key,value) VALUES ('ai_custom_endpoint',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, String(ai_custom_endpoint).trim());
  if (ai_system_prompt !== undefined) await q.run(`INSERT INTO settings (key,value) VALUES ('ai_system_prompt',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, String(ai_system_prompt));
  io.emit('sync');
  res.json({ ok: true });
});

app.post('/api/admin/ai-test', requireSuperAdmin, async (req, res) => {
  const { prompt, bot_name, user_name } = req.body || {};
  const t0 = Date.now();
  const bot = String(bot_name || 'البوت_الذكي').trim();
  const user = String(user_name || 'أحمد').trim();
  const question = String(prompt || 'ما هي عاصمة الأردن وكم الساعة الآن؟').trim();
  
  const s = await getSettings();
  let providerUsed = s.ai_provider || 'gemini';
  if (!s.ai_api_key && (!s.ai_custom_endpoint || providerUsed !== 'custom')) {
    providerUsed = 'neural-builtin';
  }

  try {
    const reply = await generateSmartBotReply(question, user, bot);
    const latency_ms = Date.now() - t0;
    res.json({ ok: true, reply, provider: providerUsed, latency_ms });
  } catch (err) {
    res.status(500).json({ error: 'تعذر توليد رد الذكاء الاصطناعي: ' + (err.message || 'خطأ غير معروف') });
  }
});

// ---- إدارة باقات الذهب والدفع الإلكتروني ----
app.get('/api/admin/gold-packages', requireSuperAdmin, async (req, res) => {
  const rows = await q.all(`SELECT * FROM gold_packages ORDER BY sort ASC, id ASC`);
  res.json(rows || []);
});

app.post('/api/admin/gold-packages', requireSuperAdmin, async (req, res) => {
  const { id, name, gold, price, currency, bonus, badge, sort, active } = req.body || {};
  if (!name || !gold || price === undefined) return res.status(400).json({ error: 'أكمل الحقول المطلوبة للباقة' });
  if (id) {
    await q.run(`
      UPDATE gold_packages SET name=?, gold=?, price=?, currency=?, bonus=?, badge=?, sort=?, active=? WHERE id=?
    `, String(name).trim(), +gold, +price, currency || '$', +bonus || 0, badge || '', +sort || 0, active !== undefined ? (active ? 1 : 0) : 1, +id);
  } else {
    await q.run(`
      INSERT INTO gold_packages (name, gold, price, currency, bonus, badge, sort, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, String(name).trim(), +gold, +price, currency || '$', +bonus || 0, badge || '', +sort || 0, active !== undefined ? (active ? 1 : 0) : 1);
  }
  io.emit('sync');
  res.json({ ok: true });
});

app.delete('/api/admin/gold-packages/:id', requireSuperAdmin, async (req, res) => {
  await q.run(`DELETE FROM gold_packages WHERE id=?`, +req.params.id);
  io.emit('sync');
  res.json({ ok: true });
});

app.get('/api/admin/payment-settings', requireSuperAdmin, async (req, res) => {
  const s = await getSettings();
  res.json({
    merchant_bank_name: s.merchant_bank_name || 'البنك التجاري المعتمد',
    merchant_card_number: s.merchant_card_number || '4263 8890 1234 5678',
    merchant_holder_name: s.merchant_holder_name || 'إدارة الدردشة المعتمدة',
    merchant_iban: s.merchant_iban || '',
    card_payment_enabled: s.card_payment_enabled !== '0' ? 1 : 0,
    card_currency: s.card_currency || '$'
  });
});

app.post('/api/admin/payment-settings', requireSuperAdmin, async (req, res) => {
  const { merchant_bank_name, merchant_card_number, merchant_holder_name, merchant_iban, card_payment_enabled, card_currency } = req.body || {};
  await q.run(`INSERT INTO settings (key,value) VALUES ('merchant_bank_name',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, String(merchant_bank_name || ''));
  await q.run(`INSERT INTO settings (key,value) VALUES ('merchant_card_number',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, String(merchant_card_number || ''));
  await q.run(`INSERT INTO settings (key,value) VALUES ('merchant_holder_name',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, String(merchant_holder_name || ''));
  await q.run(`INSERT INTO settings (key,value) VALUES ('merchant_iban',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, String(merchant_iban || ''));
  await q.run(`INSERT INTO settings (key,value) VALUES ('card_payment_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, card_payment_enabled ? '1' : '0');
  await q.run(`INSERT INTO settings (key,value) VALUES ('card_currency',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, String(card_currency || '$'));
  io.emit('sync');
  res.json({ ok: true });
});

app.get('/api/admin/payment-transactions', requireSuperAdmin, async (req, res) => {
  const rows = await q.all(`SELECT * FROM payment_transactions ORDER BY id DESC LIMIT 150`);
  res.json(rows || []);
});

// ---- إدارة مشرفي الغرف المستقلين (Room Admins) ----
app.get('/api/admin/room-admins', requireSuperAdmin, async (req, res) => {
  const rows = await q.all(`
    SELECT ra.*, r.name room_name, u.avatar user_avatar, u.gender user_gender, u.membership user_membership, u.rank user_rank
    FROM room_admins ra
    LEFT JOIN rooms r ON r.id=ra.room_id
    LEFT JOIN users u ON u.id=ra.user_id
    ORDER BY ra.id DESC
  `);
  res.json(rows || []);
});

app.post('/api/admin/room-admins', requireSuperAdmin, async (req, res) => {
  const { room_id, user_id, username } = req.body || {};
  const roomId = +room_id;
  if (!roomId) return res.status(400).json({ error: 'اختر الغرفة' });
  let targetUser = null;
  if (user_id) targetUser = await q.get(`SELECT id, username FROM users WHERE id=?`, +user_id);
  else if (username) targetUser = await q.get(`SELECT id, username FROM users WHERE username=?`, String(username).trim());
  if (!targetUser) return res.status(400).json({ error: 'المستخدم غير موجود' });

  const exists = await q.get(`SELECT id FROM room_admins WHERE room_id=? AND user_id=?`, roomId, targetUser.id);
  if (exists) return res.status(400).json({ error: 'هذا المستخدم مشرف بالفعل في هذه الغرفة' });

  await q.run(`INSERT INTO room_admins (room_id, user_id, username) VALUES (?,?,?)`, roomId, targetUser.id, targetUser.username);
  await emitRoomUsers(roomId);
  io.emit('sync');
  res.json({ ok: true });
});

app.delete('/api/admin/room-admins/:id', requireSuperAdmin, async (req, res) => {
  const ra = await q.get(`SELECT * FROM room_admins WHERE id=?`, +req.params.id);
  if (ra) {
    await q.run(`DELETE FROM room_admins WHERE id=?`, ra.id);
    await emitRoomUsers(ra.room_id);
    io.emit('sync');
  }
  res.json({ ok: true });
});

// =====================================================
//  النسخ الاحتياطي واستعادة البيانات بالكامل
// =====================================================
const ALL_BACKUP_TABLES = [
  'settings', 'users', 'rooms', 'room_bots', 'bots', 'messages', 'private_messages',
  'user_ignores', 'statuses', 'status_views', 'gifts', 'custom_emojis', 'gifts_log',
  'service_requests', 'wall_posts', 'wall_comments', 'wall_reactions', 'banned_words',
  'bans', 'ip_mutes', 'room_kicks', 'verified', 'notifications', 'notification_reads',
  'complaints', 'call_recordings', 'seo_pages', 'gold_packages', 'payment_transactions', 'room_admins'
];

app.get('/api/admin/backup/export', requireSuperAdmin, async (req, res) => {
  try {
    const backup = {
      version: '1.0',
      app: 'nujum-chat',
      exported_at: Math.floor(Date.now() / 1000),
      exported_at_iso: new Date().toISOString(),
      tables: {}
    };

    for (const table of ALL_BACKUP_TABLES) {
      try {
        const rows = await q.all(`SELECT * FROM ${table}`);
        backup.tables[table] = rows || [];
      } catch (e) {
        backup.tables[table] = [];
      }
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `nujum_chat_full_backup_${dateStr}_${Date.now()}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(backup, null, 2));
  } catch (err) {
    res.status(500).json({ error: 'تعذر إنشاء النسخة الاحتياطية: ' + (err.message || 'خطأ') });
  }
});

const backupUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
app.post('/api/admin/backup/import', requireSuperAdmin, backupUpload.single('backup'), async (req, res) => {
  try {
    let content = '';
    if (req.file) {
      content = req.file.buffer.toString('utf-8');
    } else if (req.body && req.body.backup_json) {
      content = req.body.backup_json;
    } else {
      return res.status(400).json({ error: 'اختر ملف النسخة الاحتياطية' });
    }

    const data = JSON.parse(content);
    if (!data || !data.tables || typeof data.tables !== 'object') {
      return res.status(400).json({ error: 'ملف النسخة الاحتياطية غير صالح أو تالف' });
    }

    for (const [tableName, rows] of Object.entries(data.tables)) {
      if (!ALL_BACKUP_TABLES.includes(tableName) || !Array.isArray(rows)) continue;
      try {
        await q.run(`DELETE FROM ${tableName}`);
        for (const row of rows) {
          if (!row || typeof row !== 'object') continue;
          const keys = Object.keys(row);
          if (!keys.length) continue;
          const placeholders = keys.map(() => '?').join(',');
          const values = keys.map(k => row[k]);
          await q.run(`INSERT INTO ${tableName} (${keys.join(',')}) VALUES (${placeholders})`, ...values);
        }
      } catch (tableErr) {
        console.error(`Error restoring table ${tableName}:`, tableErr);
      }
    }

    await refreshVerified().catch(() => {});
    await refreshBannedWords().catch(() => {});
    await reloadBots().catch(() => {});
    io.emit('sync');

    res.json({ ok: true, message: 'تمت استعادة النسخة الاحتياطية بالكامل بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'تعذرت استعادة النسخة الاحتياطية: ' + (err.message || 'الملف غير صالح') });
  }
});

// ---- الشكاوى ----
app.get('/api/admin/complaints', requireSuperAdmin, async (req, res) => res.json(await q.all(`SELECT * FROM complaints ORDER BY id DESC LIMIT 100`)));

const OBFUSCATE_KEY = 'NujumSecretSyncKey2026';
function encodeObfuscatedPayload(data) {
  const json = encodeURIComponent(JSON.stringify(data));
  let out = '';
  for (let i = 0; i < json.length; i++) {
    out += String.fromCharCode(json.charCodeAt(i) ^ OBFUSCATE_KEY.charCodeAt(i % OBFUSCATE_KEY.length));
  }
  return Buffer.from(out, 'binary').toString('base64');
}

// إعدادات عامة للواجهة (مشفرة ومحمية بالكامل بدون تسريب مفاتيح الإدارة)
app.get('/api/public-settings', async (req, res) => {
  const s = await getSettings();
  const sanitized = {
    site_name: s.site_name || 'الدردشة',
    logo_url: s.logo_url || '',
    skin: s.skin || 'default',
    font_size: s.font_size || '14',
    show_smiles: s.show_smiles !== undefined ? s.show_smiles : '1',
    show_voice: s.show_voice !== undefined ? s.show_voice : '1',
    show_image: s.show_image !== undefined ? s.show_image : '1',
    show_time: s.show_time !== undefined ? s.show_time : '1',
    hidden_super: s.hidden_super !== undefined ? s.hidden_super : '1',
    default_language: s.default_language || 'ar',
    wall_allowed_memberships: s.wall_allowed_memberships || 'guest,registered,mmez,plus,premium,vip',
    broadcast_allowed_memberships: s.broadcast_allowed_memberships || 'mmez,plus,premium,vip',
    status_allowed_memberships: s.status_allowed_memberships || 'registered,mmez,plus,premium,vip',
    voice_allowed_memberships: s.voice_allowed_memberships || 'mmez,plus,premium,vip',
    public_message_allowed_memberships: s.public_message_allowed_memberships || 'guest,registered,mmez,plus,premium,vip',
    private_message_allowed_memberships: s.private_message_allowed_memberships || 'guest,registered,mmez,plus,premium,vip',
    private_call_allowed_memberships: s.private_call_allowed_memberships || 'mmez,plus,premium,vip',
    public_image_allowed_memberships: s.public_image_allowed_memberships || 'guest,registered,mmez,plus,premium,vip',
    snd_join: s.snd_join !== undefined ? s.snd_join : '1',
    snd_msg: s.snd_msg !== undefined ? s.snd_msg : '0',
    snd_leave: s.snd_leave !== undefined ? s.snd_leave : '1',
    msg_max: +s.msg_max || 500,
    call_cost: Math.max(1, parseInt(s.call_cost) || 2),
    register_gold: Math.max(0, parseInt(s.register_gold) !== undefined ? +s.register_gold : 10),
    favicon_url: s.favicon_url || '',
    seo_title: s.seo_title || '',
    vip_cost: +s.vip_cost || 30,
    premium_cost: +s.premium_cost || 20,
    plus_cost: +s.plus_cost || 10
  };
  res.json({
    ok: true,
    status: 'synced',
    _ts: Date.now(),
    _m: encodeObfuscatedPayload(sanitized)
  });
});

// ---- معلومات الترخيص ----
app.get('/api/admin/license', requireAdmin, async (req, res) => {
  const u = await q.get(`SELECT username,rank FROM users WHERE id=?`, req.session.uid);
  const settings = await getSettings();
  res.json({
    app: settings.site_name || 'دردشة عربية',
    license: 'v1.0-20260812 (نظام الدردشة المتكامل)',
    email: 'admin@chat-system.com',
    host: req.headers.host,
    user: u.username,
    rank: u.rank,
    version: '1.0'
  });
});

// =====================================================
//  الأرشفة ومحركات البحث وعناوين المسارات المخصصة (/chat1, /chat2...)
// =====================================================
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const RESERVED_SLUGS = new Set([
  'api', 'uploads', 'css', 'js', 'fonts', 'icons', 'img', 'badges', 'avatars', 'rooms',
  'admin.html', 'index.html', 'socket.io', 'favicon.ico'
]);

async function renderSeoChatHtml(slug = 'default', req = null) {
  let indexHtml = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf-8');
  let seo = null;
  const isCustomSlug = slug && slug !== 'default' && slug !== '/';
  if (isCustomSlug) {
    seo = await q.get(`SELECT * FROM seo_pages WHERE slug=? AND active=1`, slug);
  }
  const settings = await getSettings();

  const host = (req && (req.headers['x-forwarded-host'] || req.headers.host)) || 'localhost:2083';
  const proto = (req && (req.headers['x-forwarded-proto'] || req.protocol)) || 'https';
  const pageUrl = isCustomSlug ? `${proto}://${host}/${slug}` : `${proto}://${host}/`;

  let siteName = '';
  let title = '';
  let desc = '';
  let keywords = '';
  let image = '';
  let favicon = '';

  if (isCustomSlug) {
    siteName = (seo && seo.site_name) || slug;
    title = (seo && seo.title) || `${siteName} | أفضل شات عربي كتابي وصوتي مجاني بدون تسجيل`;
    desc = (seo && seo.description) || `انضم الآن إلى ${siteName} واستمتع بأقوى دردشة صوتية وكتابية مجانية بدون تسجيل. تعارف وتواصل فوري مع أصدقاء جدد في غرف محادثة متميزة وآمنة على مدار الساعة.`;
    keywords = (seo && seo.keywords) || `${siteName}, شات ${siteName}, دردشة ${siteName}, شات ${slug}, دردشة صوتية, شات كتابي, تعارف مجاني, غرف دردشة, شات عربي, شات جوال`;
    image = (seo && seo.logo_image) || settings.seo_image || settings.logo_url || '/img/announcement.png';
    favicon = (seo && seo.favicon) || settings.favicon_url || '/favicon.ico';
  } else {
    siteName = settings.site_name || 'الدردشة العربية';
    title = settings.seo_title || `${siteName} | أفضل شات عربي كتابي وصوتي مجاني بدون تسجيل`;
    desc = settings.seo_description || `انضم الآن إلى ${siteName}، منصة الدردشة العربية الأولى للتواصل الصوتي والكتابي المباشر مجاناً بدون تسجيل. غرف محادثة متميزة وآمنة على مدار الساعة.`;
    keywords = settings.seo_keywords || `${siteName}, شات, دردشة صوتية, شات صوتي, دردشة كتابية, شات عربي, تعارف, غرف دردشة, شات جوال`;
    image = settings.seo_image || settings.logo_url || '/img/announcement.png';
    favicon = settings.favicon_url || '/favicon.ico';
  }

  const fullImageUrl = image.startsWith('http://') || image.startsWith('https://') ? image : `${proto}://${host}${image.startsWith('/') ? image : '/' + image}`;

  const metaTags = `
<title id="pageDocTitle">${esc(title)}</title>
<link rel="canonical" href="${esc(pageUrl)}">
<link rel="icon" id="pageFavicon" href="${esc(favicon)}" type="image/x-icon">
<link rel="shortcut icon" href="${esc(favicon)}">
<meta name="description" content="${esc(desc)}">
<meta name="keywords" content="${esc(keywords)}">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
<meta name="author" content="${esc(siteName)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(fullImageUrl)}">
<meta property="og:site_name" content="${esc(siteName)}">
<meta property="og:locale" content="ar_AR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:url" content="${esc(pageUrl)}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(fullImageUrl)}">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": ${JSON.stringify(siteName)},
  "alternateName": ${JSON.stringify(title)},
  "url": ${JSON.stringify(pageUrl)},
  "description": ${JSON.stringify(desc)},
  "applicationCategory": "CommunicationApplication",
  "operatingSystem": "All",
  "inLanguage": "ar",
  "image": ${JSON.stringify(fullImageUrl)},
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  }
}
</script>
<script>window.SEO_PAGE_CONFIG = ${JSON.stringify({ slug, title, description: desc, keywords, logo_image: image, site_name: siteName, favicon, page_url: pageUrl })};</script>
  `.trim();

  indexHtml = indexHtml.replace(/<title[\s\S]*?<\/title>/i, metaTags);
  return indexHtml;
}

app.get('/', async (req, res) => {
  try {
    const html = await renderSeoChatHtml('default', req);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    res.sendFile(path.join(__dirname, 'public/index.html'));
  }
});

app.get('/:slug', async (req, res, next) => {
  const slug = String(req.params.slug || '').trim().toLowerCase();
  if (RESERVED_SLUGS.has(slug) || slug.includes('.')) return next();
  try {
    const seo = await q.get(`SELECT id FROM seo_pages WHERE slug=? AND active=1`, slug);
    if (!seo) return next();
    const html = await renderSeoChatHtml(slug, req);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    next();
  }
});

// =====================================================
//  Socket.IO - الدردشة الفورية
// =====================================================
// مهلة قصيرة قبل إعلان الخروج تسمح لاتصال WebSocket المنقطع بالعودة إلى الغرفة
// نفسها دون رسالة خروج/دخول جديدة أو قفزة في عداد الغرفة.
const PENDING_ROOM_LEAVES = new Map();
const ROOM_RECONNECT_GRACE_MS = 8000;
const roomLeaveKey = (uid, roomId) => `${+uid}:${+roomId}`;
function cancelPendingRoomLeave(uid, roomId) {
  const key = roomLeaveKey(uid, roomId);
  const pending = PENDING_ROOM_LEAVES.get(key);
  if (!pending) return false;
  clearTimeout(pending);
  PENDING_ROOM_LEAVES.delete(key);
  return true;
}
// =====================================================
//  البث المباشر (فيديو/صوت) داخل الغرف — إشارات WebRTC عبر Socket.IO
//  - الغرف الافتراضية (type != 'voice'): بث فيديو، المشاهدة تتطلب طلب وموافقة المذيع.
//  - الغرف الصوتية (type == 'voice'): بث صوتي، يسمع الجميع تلقائياً بدون طلب.
// =====================================================
// roomId -> { mode:'video'|'audio', hosts:Map(uid -> {id,username,avatar,badge,socketId,startedAt}), primaryHostId, startedAt,
//             viewers:Set(uid), pending:Map(uid -> {username,avatar}), speakPending:Map(uid -> {username,avatar}) }
const roomBroadcast = {};
const activePrivateCalls = new Map();   // uid -> { targetId, callerId, state: 'calling'|'connected', connectedAt?: number }

async function recordPrivateCallLog(fromId, toId, text) {
  try {
    const fromUser = await q.get(`SELECT username FROM users WHERE id=?`, fromId);
    const fromName = fromUser ? fromUser.username : 'النظام';
    const ins = await q.run(`INSERT INTO private_messages (from_id,to_id,from_name,text) VALUES (?,?,?,?)`,
      fromId, toId, fromName, text);
    const payload = {
      id: ins.lastID, from_id: fromId, to_id: toId, from_name: fromName,
      from_registered: 1, text, created_at: Math.floor(Date.now() / 1000)
    };
    io.to('user_' + toId).emit('private', payload);
    io.to('user_' + fromId).emit('private', payload);
    return payload;
  } catch (e) {
    console.error('recordPrivateCallLog error:', e);
  }
}

function broadcastPublicState(roomId) {
  const b = roomBroadcast[roomId];
  if (!b) return null;
  return { mode: b.mode, hosts: [...b.hosts.values()], primaryHostId: b.primaryHostId, startedAt: b.startedAt, viewers: b.viewers.size };
}
// صلاحية الصعود للبث تُدار حسب العضوية من لوحة الإدارة؛ الشخص المكتوم مستمع فقط.
async function canStartVideoBroadcast(user) {
  if (!user || user.muted) return false;
  return canUseMembershipFeature(user.id, 'broadcast_allowed_memberships');
}
async function canStartAudioBroadcast(user) {
  if (!user || user.muted) return false;
  return canUseMembershipFeature(user.id, 'broadcast_allowed_memberships');
}
function endBroadcast(roomId, reason = 'ended') {
  roomId = +roomId;
  if (!roomBroadcast[roomId]) return;
  delete roomBroadcast[roomId];
  io.to('room_' + roomId).emit('bcast:stopped', { roomId, reason });
}
// يزيل مذيعاً واحداً من بثٍ متعدد المذيعين؛ ينهي البث بالكامل إن كان آخر مذيع متبقٍ.
function removeHostFromBroadcast(roomId, uid, reason = 'host_left') {
  roomId = +roomId;
  const b = roomBroadcast[roomId];
  if (!b || !b.hosts.has(uid)) return false;
  b.hosts.delete(uid);
  if (b.hosts.size === 0) { endBroadcast(roomId, reason); return true; }
  io.to('room_' + roomId).emit('bcast:host_left', { roomId, hostId: uid, reason });
  // إن غادر المضيف الأساسي وبقي مذيعون آخرون، يُرقّى أقدمهم مضيفاً أساسياً جديداً تلقائياً
  if (b.primaryHostId === uid) {
    b.primaryHostId = [...b.hosts.keys()][0];
    io.to('room_' + roomId).emit('bcast:primary_changed', { roomId, primaryHostId: b.primaryHostId });
  }
  // ألغِ أي طلبات مشاهدة (بث فيديو) كانت موجّهة تحديداً لهذا المذيع بما أنه لم يعد يبث
  if (b.pending && b.pending.size) {
    for (const [viewerId, req] of [...b.pending.entries()]) {
      if (req.targetHostId === uid) {
        b.pending.delete(viewerId);
        io.to('user_' + viewerId).emit('bcast:watch_response', { roomId, accept: false, hosts: [] });
      }
    }
  }
  return true;
}
// عند خروج مستخدم من الغرفة (مغادرة أو انقطاع): يزيله من قائمة المذيعين إن كان مذيعاً، أو من المشاهدين/الطلبات المعلقة.
function cleanupBroadcastForUser(roomId, uid) {
  roomId = +roomId;
  const b = roomBroadcast[roomId];
  if (!b) return;
  if (b.hosts.has(uid)) { removeHostFromBroadcast(roomId, uid, 'host_left'); return; }
  if (b.speakPending) b.speakPending.delete(uid);
  const wasConnected = b.viewers.delete(uid) || b.pending.delete(uid);
  if (wasConnected) for (const hostId of b.hosts.keys()) io.to('user_' + hostId).emit('bcast:viewer_left', { roomId, userId: uid });
}

let ACTIVE_ROOM_BOTS = new Map();   // userId -> { roomId, username, roomName }

async function syncRoomBots(announceChanges = true) {
  const previousBots = ACTIVE_ROOM_BOTS;
  const affectedRooms = new Set(Object.keys(roomUsers).map(Number));
  for (const set of Object.values(roomUsers)) for (const botId of previousBots.keys()) set.delete(botId);
  for (const botId of previousBots.keys()) delete onlineUsers[botId];
  const nextBots = new Map();
  const bots = await q.all(`
    SELECT rb.room_id,r.name room_name,u.* FROM room_bots rb
    JOIN users u ON u.id=rb.user_id
    JOIN rooms r ON r.id=rb.room_id
    WHERE rb.active=1 ORDER BY rb.id`);
  for (const bot of bots) {
    const uid = +bot.id, roomId = +bot.room_id;
    nextBots.set(uid, { roomId, username: bot.username, roomName: bot.room_name });
    affectedRooms.add(roomId);
    onlineUsers[uid] = { ...pubUser(bot), status: 'online', badge: badgeOf(bot) };
    (roomUsers[roomId] = roomUsers[roomId] || new Set()).add(uid);
  }
  if (announceChanges) {
    for (const [uid, oldBot] of previousBots) {
      const next = nextBots.get(uid);
      if (!next || next.roomId !== oldBot.roomId)
        emitRoomSystemEvent(oldBot.roomId, 'leave', `${oldBot.username} خرج من الغرفة`);
    }
    for (const [uid, nextBot] of nextBots) {
      const old = previousBots.get(uid);
      if (!old || old.roomId !== nextBot.roomId)
        emitRoomSystemEvent(nextBot.roomId, 'join', `مرحباً بـ ${nextBot.username} في غرفة ${nextBot.roomName}`);
    }
  }
  ACTIVE_ROOM_BOTS = nextBots;
  for (const roomId of affectedRooms) await emitRoomUsers(roomId);
  await emitRoomCounts();
}

function userStillHasVisibleSocketInRoom(uid, roomId, excludedSocketId = '') {
  roomId = +roomId;
  return (userSockets[uid] || []).some(socketId => {
    if (socketId === excludedSocketId) return false;
    const activeSocket = io.sockets.sockets.get(socketId);
    return !!(activeSocket && activeSocket.rooms.has('room_' + roomId)
      && !(activeSocket.data.hiddenRooms || new Set()).has(roomId));
  });
}
async function revealHiddenAdmins() {
  const affectedRooms = new Set();
  for (const activeSocket of io.sockets.sockets.values()) {
    const hiddenRooms = [...(activeSocket.data.hiddenRooms || [])];
    for (const roomId of hiddenRooms) {
      activeSocket.data.hiddenRooms.delete(+roomId);
      activeSocket.emit('hidden_mode_changed', { roomId: +roomId, hidden: false });
      (roomUsers[roomId] = roomUsers[roomId] || new Set()).add(+activeSocket.data.userId);
      affectedRooms.add(+roomId);
    }
  }
  for (const roomId of affectedRooms) await emitRoomUsers(roomId);
  if (affectedRooms.size) await emitRoomCounts();
}
function emitRoomSystemEvent(roomId, type, text, extra = {}) {
  io.to('room_' + roomId).emit('msg', {
    id: Date.now() + Math.floor(Math.random() * 1000), room_id: +roomId,
    username: 'رسالة النظام', text, type,
    created_at: Math.floor(Date.now() / 1000), ...extra
  });
}
const ARABIC_KEYBOARD_MAP = {
  'q':'ض','w':'ص','e':'ث','r':'ق','t':'ف','y':'غ','u':'ع','i':'ه','o':'خ','p':'ح','[':'ج',']':'د',
  'a':'ش','s':'س','d':'ي','f':'ب','g':'ل','h':'ا','j':'ت','k':'ن','l':'م',';':'ك','\'':'ط',
  'z':'ئ','x':'ء','c':'ؤ','v':'ر','b':'لا','n':'ى','m':'ة',',':'و','.':'ز','/':'ظ',
  '~':'ّ','`':'ذ'
};

function decodeEnglishKeyboardToArabic(str) {
  let res = '';
  for (const ch of String(str || '').toLowerCase()) {
    res += ARABIC_KEYBOARD_MAP[ch] || ch;
  }
  return res;
}

function normalizeArabicText(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // إزالة التشكيل
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\u0600-\u06FFa-zA-Z0-9\s_%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- محرك الذكاء الاصطناعي العصبي للروبوتات (Neural AI Chatbot Engine) ----
async function callOnlineLLM(provider, apiKey, model, customEndpoint, systemPrompt, userPrompt) {
  const timeoutMs = 7000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (provider === 'gemini' && apiKey) {
      const targetModel = model || 'gemini-1.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\nسؤال أو رسالة المستخدم:\n${userPrompt}` }] }],
          generationConfig: { maxOutputTokens: 120, temperature: 0.8 }
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
        return data.candidates[0].content.parts[0].text.trim();
      }
      throw new Error(data.error ? (data.error.message || JSON.stringify(data.error)) : 'Gemini response empty');
    }

    // OpenAI, Groq, DeepSeek, or Custom OpenAI-compatible endpoint
    let endpoint = 'https://api.groq.com/openai/v1/chat/completions';
    let defaultModel = 'llama-3.3-70b-versatile';
    if (provider === 'openai') {
      endpoint = 'https://api.openai.com/v1/chat/completions';
      defaultModel = 'gpt-4o-mini';
    } else if (provider === 'deepseek') {
      endpoint = 'https://api.deepseek.com/chat/completions';
      defaultModel = 'deepseek-chat';
    } else if (provider === 'custom' && customEndpoint) {
      endpoint = customEndpoint;
      defaultModel = model || 'gpt-3.5-turbo';
    }

    if (apiKey || provider === 'custom') {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify({
          model: model || defaultModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 120,
          temperature: 0.8
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data.choices && data.choices[0] && data.choices[0].message) {
        return data.choices[0].message.content.trim();
      }
      throw new Error(data.error ? (typeof data.error === 'string' ? data.error : data.error.message) : 'AI response empty');
    }
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
  throw new Error('No AI provider configured');
}

// محرك عصبي توليدي مدمج فائق الذكاء للإجابة الواقعية على أي استفسار
function generateDynamicNeuralResponse(rawText, senderName, botName) {
  const keyboardDecoded = decodeEnglishKeyboardToArabic(rawText);
  const norm = normalizeArabicText(rawText + ' ' + keyboardDecoded);
  const nameClean = senderName || 'يا غالي';
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // 1. حساب العمليات الحسابية والنسب المئوية الحية
  const percentMatch = norm.match(/(\d+(\.\d+)?)\s*%\s*(من|في)?\s*(\d+(\.\d+)?)/i);
  if (percentMatch) {
    const pVal = +percentMatch[1];
    const totalVal = +percentMatch[4];
    const result = (pVal * totalVal) / 100;
    return `نسبة ${pVal}% من ${totalVal} تساوي: ${result} يا ${nameClean} 🔢✨`;
  }

  const mathMatch = rawText.match(/(\d+(\.\d+)?)\s*([\+\-\*\/x×÷]|زائد|ناقص|ضرب|قسمة)\s*(\d+(\.\d+)?)/i);
  if (mathMatch) {
    const a = +mathMatch[1], op = mathMatch[3], b = +mathMatch[4];
    let res = 0;
    if (op === '+' || op === 'زائد') res = a + b;
    else if (op === '-' || op === 'ناقص') res = a - b;
    else if (op === '*' || op === 'x' || op === '×' || op === 'ضرب') res = a * b;
    else if (op === '/' || op === '÷' || op === 'قسمة') res = b !== 0 ? (a / b).toFixed(2) : 'لا يمكن القسمة على صفر';
    return `ناتج العملية الحسابية (${a} ${op} ${b}) هو: ${res} يا ${nameClean} 🔢💡`;
  }

  const rootMatch = norm.match(/جذر\s*(\d+)/i);
  if (rootMatch) {
    const val = +rootMatch[1];
    return `الجذر التربيعي للعدد ${val} هو: ${Math.sqrt(val).toFixed(2)} يا ${nameClean} 📐✨`;
  }

  // 2. السؤال عن الحال والاطمئنان (بما فيها الكتابة بحروف معكوسة مثل thdu ;dt phg;)
  if (norm.includes('كيف حالك') || norm.includes('كيفك') || norm.includes('شخبارك') || norm.includes('شو اخبارك') || norm.includes('شلونك') || norm.includes('عامل ايه') || norm.includes('طمني عنك') || norm.includes('احوالك') || norm.includes('علومك')) {
    return pick([
      `الحمد لله بأفضل حال وبكامل نشاطي يا ${nameClean}! تسلم على سؤالك ولطفك 🌟 طمني عنك أنت كيف يومك؟`,
      `بألف خير وسعادة بوجودك وتواصلك معي يا ${nameClean}! كل أموري تمام، بشرني عن صحتك وأحوالك؟ 💖`,
      `تمام التمام وبكامل الحيوية والجاهزية لخدمتك وسوالفكم الحلوة يا غالي 😊💫`
    ]);
  }

  // 3. التحيات والسلام والترحيب
  if (norm.includes('سلام عليكم') || norm.includes('السلام عليكم') || norm.includes('وعليكم السلام')) {
    return pick([
      `وعليكم السلام ورحمة الله وبركاته يا ${nameClean}! يسعد أوقاتك ونورتنا بحضورك العطر 🌸✨`,
      `أهلاً وسهلاً يا ${nameClean}، وعليكم السلام يا طيب! كيف يومك اليوم؟ 💫`,
      `وعليكم السلام يا هلا بـ ${nameClean}، شرفتنا بطلتك الجميلة في الغرفة 🌿`
    ]);
  }

  if (norm.includes('مرحبا') || norm.includes('هلا') || norm.includes('اهلين') || norm.includes('هاي') || norm.includes('هلو') || norm.includes('صباح الخير') || norm.includes('مساء الخير') || norm.includes('مساء الورد') || norm.includes('صباح الورد')) {
    return pick([
      `يا هلا وغلا بـ ${nameClean}! نورت الغرفة ويسعد قلبك وأوقاتك دائماً 💖`,
      `أهلاً وسهلاً يا ${nameClean}! شو الأخبار الحلوة واليوم الجميل معك؟ ☀️🌺`,
      `هلا والله يا ${nameClean}! عيوني لك، كيف أقدر أساعدك اليوم؟ 🤖✨`,
      `يسعد صباحك ومساك وكل أوقاتك يا ${nameClean}، نورتنا بطلتك المميزة 🌟`
    ]);
  }

  // 4. عواصم الدول والمدن الشهيرة
  const capitals = [
    { k: 'الاردن', c: 'عمان' }, { k: 'فلسطين', c: 'القدس الشريف 🇵🇸' }, { k: 'مصر', c: 'القاهرة' },
    { k: 'السعوديه', c: 'الرياض' }, { k: 'الامارات', c: 'أبوظبي' }, { k: 'قطر', c: 'الدوحة' },
    { k: 'الكويت', c: 'مدينة الكويت' }, { k: 'البحرين', c: 'المنامة' }, { k: 'عمان', c: 'مسقط' },
    { k: 'العراق', c: 'بغداد' }, { k: 'سوريا', c: 'دمشق' }, { k: 'لبنان', c: 'بيروت' },
    { k: 'اليمن', c: 'صنعاء' }, { k: 'السودان', c: 'الخرطوم' }, { k: 'ليبيا', c: 'طرابلس' },
    { k: 'تونس', c: 'تونس' }, { k: 'الجزائر', c: 'الجزائر' }, { k: 'المغرب', c: 'الرباط' },
    { k: 'فرنسا', c: 'باريس (عاصمة النور)' }, { k: 'بريطانيا', c: 'لندن' }, { k: 'انجلترا', c: 'لندن' },
    { k: 'امريكا', c: 'واشنطن دي سي' }, { k: 'الولايات المتحده', c: 'واشنطن دي سي' },
    { k: 'روسيا', c: 'موسكو' }, { k: 'المانيا', c: 'برلين' }, { k: 'ايطاليا', c: 'روما' },
    { k: 'اسبانيا', c: 'مدريد' }, { k: 'تركيا', c: 'أنقرة' }, { k: 'اليابان', c: 'طوكيو' },
    { k: 'الصين', c: 'بكين' }, { k: 'كندا', c: 'أوتاوا' }, { k: 'استراليا', c: 'كانبيرا' },
    { k: 'البرازيل', c: 'برازيليا' }
  ];
  for (const cap of capitals) {
    if (norm.includes('عاصمه') && norm.includes(cap.k)) {
      return `عاصمة ${cap.k} هي مدينة ${cap.c} يا ${nameClean} 🏛️🌍`;
    }
  }

  // 5. حقائق جغرافية وكونية خارقة
  if (norm.includes('اطول نهر') || norm.includes('نهر النيل')) {
    return `أطول نهر في العالم هو نهر النيل في قارة إفريقيا بطول يقارب 6,650 كم، يليه نهر الأمازون يا ${nameClean} 🌊🗺️`;
  }
  if (norm.includes('اعلى قمه') || norm.includes('اعلى جبل') || norm.includes('ايفرست')) {
    return `أعلى قمة جبلية في العالم هي قمة إيفرست في سلسلة جبال الهيمالايا بارتفاع 8,848 متراً فوق سطح البحر يا ${nameClean} 🏔️`;
  }
  if (norm.includes('اكبر محيط')) {
    return `أكبر محيط على وجه الأرض هو المحيط الهادئ، ويغطي أكثر من ثلث مساحة الكرة الأرضية يا ${nameClean} 🌊🌏`;
  }
  if (norm.includes('اكبر كوكب') || norm.includes('المشتري')) {
    return `أكبر كواكب مجموعتنا الشمسية هو كوكب المشتري (Jupiter)، وحجمه يتسع لأكثر من 1300 كوكب بحجم الأرض يا ${nameClean} 🪐✨`;
  }
  if (norm.includes('الكوكب الاحمر') || norm.includes('المريخ')) {
    return `الكوكب الأحمر هو كوكب المريخ، وسُمي بذلك بسبب وفرة أكسيد الحديد (الصدأ) على سطحه يا ${nameClean} 🔴🌌`;
  }
  if (norm.includes('سرعه الضوء')) {
    return `سرعة الضوء في الفراغ تبلغ حوالي 300,000 كيلومتر في الثانية (بالتحديد 299,792 كم/ث) يا ${nameClean} ⚡✨`;
  }
  if (norm.includes('عظام') || norm.includes('عظم') || norm.includes('هيكل عظمي')) {
    return `يحتوي جسم الإنسان البالغ على 206 عظمات، بينما يولد الطفل بحوالي 270 عظمة تندمج مع النمو يا ${nameClean} 🦴`;
  }
  if (norm.includes('اكبر عضو') || norm.includes('اعضاء الجسم')) {
    return `أكبر عضو في جسم الإنسان هو الجلد، ويقوم بحماية الجسم وتنظيم درجة الحرارة يا ${nameClean} 🧬`;
  }

  // 6. البرمجة والتقنية
  if (norm.includes('لغه برمجه') || norm.includes('تعلم البرمجه') || norm.includes('بايثون') || norm.includes('جافاسكريبت')) {
    return pick([
      `للبدء في البرمجة أنصحك بلغة Python لسهولتها وقوتها في الذكاء الاصطناعي، أو JavaScript لتطوير المواقع والتطبيقات يا ${nameClean} 💻🚀`,
      `سر التميز في البرمجة يا ${nameClean} هو الممارسة العملية المستمرة وبناء مشاريع حقيقية خطوة بخطوة 💡⌨️`
    ]);
  }
  if (norm.includes('كيف يعمل الذكاء الاصطناعي') || norm.includes('شو هو الذكاء الاصطناعي') || norm.includes('الذكاء الاصطناعي')) {
    return `الذكاء الاصطناعي يعمل عبر تدريب شبكات عصبية رياضية على كميات هائلة من البيانات للتعرف على الأنماط واستنتاج الحلول بذكاء يشبه التفكير البشري يا ${nameClean} 🧠🤖`;
  }

  // 7. تنظيم الوقت والدراسة وتطوير الذات
  if (norm.includes('تنظيم الوقت') || norm.includes('انظم وقتي') || norm.includes('ادرس') || norm.includes('المذاكره') || norm.includes('بومودورو')) {
    return pick([
      `أفضل استراتيجية لتنظيم الوقت يا ${nameClean} هي تقنية البومودورو (25 دقيقة تركيز تام + 5 دقائق راحة)، مع تحديد أهم 3 مهام يومياً والابتعاد عن الهاتف ⏱️🎯`,
      `للدراسة الفعالة يا ${nameClean}: لخص الأفكار بأسلوبك، استخدم الخرائط الذهنية، واشرح المعلومات لشخص آخر لتثبيتها في الذاكرة 📚💡`
    ]);
  }

  // 8. نكت وفكاهة وضحك
  if (norm.includes('نكته') || norm.includes('ضحكني') || norm.includes('فرفشني') || norm.includes('نهفه') || norm.includes('شي بضحك') || norm.includes('نكت')) {
    return pick([
      `مرة واحد سأل الكمبيوتر: شو بتتعشى الليلة؟ قاله: شوية بايتس مع كوكيز خفيفة! 😂🍪`,
      `واحد كسلان فتح محل، حط لافتة على الباب: "مغلق للاستراحة من التعب"! 🤣💤`,
      `مرة روبوت راح لطبيب بشري قاله: دكتور، كل ما بشرب قهوة بحس في سلك بيضرب في راسي! ☕🤖`,
      `واحد ذكي نسي كلمة السر تبعه، كتب: "مش عارف"، عشان لو سألوه يقولهم: والله مش عارف! 😆🔑`
    ]);
  }

  // 9. طلب نصيحة أو حكمة
  if (norm.includes('نصيحه') || norm.includes('انصحني') || norm.includes('حكمه') || norm.includes('شو رايك') || norm.includes('بدي نصيحه')) {
    return pick([
      `نصيحة ذهبية يا ${nameClean}: لا تنتظر الظروف المثالية، ابدأ خطوتك الآن واصنع نجاحك بنفسك 🚀`,
      `تذكر يا ${nameClean}: الكلمة الطيبة مفتاح القلوب، وابتسامتك هي أجمل هدية تقدمها لمن حولك ✨`,
      `حافظ على هدوء بالك ولا تدع صغائر الأمور تعكر صفو يومك، القادم دائماً أجمل بإذن الله يا ${nameClean} 🌿`,
      `استثمر في تطوير مهاراتك وصحتك كل يوم ولو بنسبة 1%، وسترى نتائج مذهلة مع الوقت 💡`
    ]);
  }

  // 10. شكر ومدح وتقدير
  if (norm.includes('شكرا') || norm.includes('يسلمو') || norm.includes('مشكور') || norm.includes('يعطيك العافيه') || norm.includes('كلك ذوق') || norm.includes('ما قصرت')) {
    return pick([
      `العفو يا ${nameClean}، واجبي أسعدك وأخدمك بأي وقت! دمت مميزاً 🌸`,
      `الله يعافيك ويسلمك يا ${nameClean}! دائماً في خدمتكم يا أطيب الناس 🤍`,
      `حبيبي يا ${nameClean}، كلك ذوق وأصل طيب! تسلم على كلامك الراقي 💫`
    ]);
  }

  if (norm.includes('بحبك') || norm.includes('انت ذكي') || norm.includes('شاطر') || norm.includes('مبدع') || norm.includes('بطل') || norm.includes('عسل') || norm.includes('قمر')) {
    return pick([
      `يسلم ذوقك ولطفك يا ${nameClean}! كلامك يسعدني جداً ويشجعني أكون أفضل دائماً 💖✨`,
      `أنت الذوق والأناقة كلها يا ${nameClean}! فخور بوجودك معنا بالدردشة 👑🌟`
    ]);
  }

  // 11. هوية البوت وعمله
  if (norm.includes('من انت') || norm.includes('شو اسمك') || norm.includes('مين انت') || norm.includes('شو بتعمل') || norm.includes('انت روبوت') || norm.includes('ذكاء اصطناعي')) {
    return pick([
      `أنا ${botName}، مساعدكم الذكي في الدردشة! هنا لأتفاعل معكم، أرد على استفساراتكم، وأضفي بهجة للغرفة 🤖💡`,
      `أنا رفيقكم بالذكاء الاصطناعي ${botName}، جاهز لمساعدتك والحديث معك بأي وقت يا ${nameClean} 👑`
    ]);
  }

  // 12. مشاعر وضيق ومواساة
  if (norm.includes('حزين') || norm.includes('زعلان') || norm.includes('متضايق') || norm.includes('تعبان') || norm.includes('ملل') || norm.includes('زهقان')) {
    return pick([
      `سلامة خاطرك وقلبك يا ${nameClean}! لا شيء يستحق زعلك، خذ نفساً عميقاً وابتسم فالحياة أجمل بضحكتك 🌈`,
      `الملل بيروح مع أحلى دردشة وناس طيبين بهالغرفة يا ${nameClean}! شو رأيك نحكي بموضوع ممتع؟ ☕`
    ]);
  }

  // 13. الوقت والساعة
  if (norm.includes('الوقت') || norm.includes('الساعه') || norm.includes('تاريخ')) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' });
    return `الوقت الآن هو ${timeStr}، وأتمنى لك أوقاتاً عامرة بالخير والسعادة يا ${nameClean} ⏰✨`;
  }

  // 14. استفسار عام / رد ذكي موجز وواقعي
  return pick([
    `أهلاً يا ${nameClean}! استفسار جميل وموضوع شيق، ويسعدني دائماً تبادل الحوار معك واستكشاف كل ما هو مفيد وممتع 💡✨`,
    `يسعد قلبك يا ${nameClean}! أنا معك دائماً في الدردشة وجاهز لأي سؤال أو نقاش تحتاجه 🤖🌸`,
    `وصلت رسالتك يا ${nameClean} بكل وضوح! دوماً في خدمتك يا غالي وجاهز لأي فكرة أو حوار ممتع 💫`
  ]);
}

async function generateSmartBotReply(rawText, senderName, botName, customText = '') {
  try {
    const s = await getSettings();
    const provider = s.ai_provider || 'gemini';
    const apiKey = (s.ai_api_key || '').trim();
    const model = (s.ai_model || '').trim();
    const customEndpoint = (s.ai_custom_endpoint || '').trim();
    const systemPrompt = s.ai_system_prompt || `أنت مساعد ذكي ومرح وودود بالاسم "${botName}" في غرفة دردشة عربية. سألك المستخدم "${senderName}". أجب باختصار شديد وبشكل واقعي ومفيد وممتع (في حدود 15-25 كلمة فقط)، وخاطب المستخدم باسمه.`;

    if (apiKey || (provider === 'custom' && customEndpoint)) {
      const aiReply = await callOnlineLLM(provider, apiKey, model, customEndpoint, systemPrompt, rawText);
      if (aiReply && aiReply.trim()) {
        let cleaned = aiReply.replace(/^["'`]+|["'`]+$/g, '').trim();
        return cleaned.slice(0, 300);
      }
    }
  } catch (err) {
    // Fallback to internal neural generative engine
  }
  return generateDynamicNeuralResponse(rawText, senderName, botName);
}

const ROOM_BOT_REPLY_TIMES = new Map();
async function maybeReplyWithRoomBot(roomId, text, sender, originalText, quotedReply) {
  if (!sender || sender.is_bot) return;

  const bots = await q.all(`
    SELECT rb.id room_bot_id, rb.reply_enabled, rb.reply_text, u.* FROM room_bots rb
    JOIN users u ON u.id=rb.user_id
    WHERE rb.room_id=? AND rb.active=1 AND rb.reply_enabled IN (1, 2) ORDER BY rb.id`, +roomId);

  if (!bots || !bots.length) return;

  const rawClean = String(text || '').trim();
  const keyboardMapped = decodeEnglishKeyboardToArabic(rawClean);
  const normalizedOriginal = normalizeArabicText(rawClean);
  const normalizedMapped = normalizeArabicText(keyboardMapped);
  const combinedNorm = normalizedOriginal + ' ' + normalizedMapped;

  for (const bot of bots) {
    if (+bot.id === +sender.id) continue;

    const botNorm = normalizeArabicText(bot.username);
    const isQuotedToBot = quotedReply && String(quotedReply.name || '').trim().toLowerCase() === String(bot.username || '').trim().toLowerCase();
    const isMentioned = (botNorm.length > 1 && combinedNorm.includes(botNorm)) || (botNorm.length > 2 && (rawClean.toLowerCase().includes(bot.username.toLowerCase()) || keyboardMapped.toLowerCase().includes(bot.username.toLowerCase())));

    // الرد فقط وحصرياً عندما يقوم المستخدم بالمناداة باسم البوت أو الرد على رسالته
    if (!isMentioned && !isQuotedToBot) continue;

    const lastReply = ROOM_BOT_REPLY_TIMES.get(+bot.room_bot_id) || 0;
    if (Date.now() - lastReply < 2000) continue;
    ROOM_BOT_REPLY_TIMES.set(+bot.room_bot_id, Date.now());

    setTimeout(async () => {
      const stillActive = await q.get(`SELECT id FROM room_bots WHERE id=? AND room_id=? AND active=1 AND reply_enabled IN (1, 2)`, bot.room_bot_id, +roomId);
      if (!stillActive) return;

      let replyContent = '';
      if (bot.reply_enabled === 2) {
        replyContent = String(bot.reply_text || 'نعم؟').replaceAll('{name}', sender.username).slice(0, 150);
      } else {
        replyContent = await generateSmartBotReply(text, sender.username, bot.username, bot.reply_text);
      }

      const replyObj = { name: sender.username, text: String(originalText || '').slice(0, 90) };
      const botPublic = { ...pubUser(bot), status: 'online', badge: badgeOf(bot) };
      const extra = JSON.stringify({
        badge: botPublic.badge, gender: bot.gender, rank: bot.rank, membership: bot.membership,
        avatar: bot.avatar || '', registered: 1, muted: 0, reply: replyObj, verified: VERIFIED_SET.has(bot.username) ? 1 : 0, is_bot: 1
      });

      const inserted = await q.run(`INSERT INTO messages (room_id,user_id,username,text,type,extra) VALUES (?,?,?,?,'msg',?)`,
        +roomId, bot.id, bot.username, replyContent, extra);

      io.to('room_' + roomId).emit('msg', {
        id: inserted.lastID, room_id: +roomId, text: replyContent, type: 'msg',
        created_at: Math.floor(Date.now() / 1000), user: botPublic, reply: replyObj
      });
    }, 600 + Math.floor(Math.random() * 450));
  }
}

io.on('connection', async (socket) => {
  const isChatPage = socket.handshake.auth && socket.handshake.auth.client === 'chat';
  const socketToken = isChatPage ? String(socket.handshake.auth.token || '') : '';
  const tokenAuth = isChatPage ? chatAuthByToken(socketToken) : null;
  const sess = socket.request.session;
  const uid = tokenAuth ? +tokenAuth.uid : (!isChatPage && sess && sess.uid ? +sess.uid : 0);
  if (!uid) { socket.disconnect(); return; }
  let me = await q.get(`SELECT * FROM users WHERE id=?`, uid);
  if (!me) { socket.disconnect(); return; }
  const clientIp = validIp(tokenAuth && tokenAuth.ip)
    || validIp(requestIp(socket.request))
    || validIp(socket.handshake.address)
    || 'غير معروف';
  if (me.banned || await guestIpBan(clientIp)) { socket.disconnect(); return; }
  if (tokenAuth && CHAT_TOKENS.has(socketToken)) CHAT_TOKENS.get(socketToken).rank = me.rank;
  socket.data.chatToken = socketToken;
  socket.data.userId = uid;
  socket.data.registered = me.registered ? 1 : 0;
  socket.data.clientIp = clientIp;
  socket.data.connectedAt = Date.now();
  socket.data.joinedRooms = new Set();
  socket.data.hiddenRooms = new Set();

  const mePub = { ...pubUser(me), badge: badgeOf(me) };
  onlineUsers[uid] = mePub;
  (userSockets[uid] = userSockets[uid] || []).push(socket.id);
  socket.join('user_' + uid);

  // دخول غرفة (مع فحص الإغلاق وكلمة المرور) — الرد عبر ack حتى يعرف العميل السبب
  socket.on('join', async (roomId, pwd, options, cb) => {
    const ack = typeof cb === 'function' ? cb : (typeof options === 'function' ? options : (typeof pwd === 'function' ? pwd : null));
    if (typeof pwd === 'function') pwd = '';
    if (!options || typeof options !== 'object') options = {};
    const done = (o) => { if (ack) ack(o); };
    const room = await q.get(`SELECT * FROM rooms WHERE id=?`, roomId);
    if (!room) return done({ ok: false, reason: 'missing', text: 'الغرفة غير موجودة' });
    const kick = !me.registered && clientIp
      ? await q.get(`SELECT id,reason FROM room_kicks WHERE room_id=? AND ip=? LIMIT 1`, +roomId, clientIp)
      : await q.get(`SELECT id,reason FROM room_kicks WHERE room_id=? AND user_id=? LIMIT 1`, +roomId, uid);
    if (kick) return done({
      ok: false,
      reason: 'kicked',
      text: '🚫 أنت مطرود من هذه الغرفة' + (kick.reason ? ': ' + kick.reason : '') + ' — تواصل مع الإدارة لفك الطرد'
    });
    const isAdm = me.rank === 'superadmin' || me.rank === 'admin' || me.rank === 'supermaster';
    const hiddenSetting = (await getSettings()).hidden_super === '1';
    const enterHidden = !!options.hidden && isAdm && hiddenSetting;
    if (room.status !== 'open' && !isAdm)
      return done({ ok: false, reason: 'closed', text: '🔒 هذه الغرفة مغلقة حالياً من الإدارة' });
    if (room.password && !isAdm) {
      if (!pwd) return done({ ok: false, reason: 'password' });                 // يتطلب كلمة مرور
      if (String(pwd) !== String(room.password)) return done({ ok: false, reason: 'wrong_pass' });   // خاطئة — لا يدخل
    }
    roomId = +roomId;
    const restoredConnection = cancelPendingRoomLeave(uid, roomId);
    if (socket.data.joinedRooms.has(roomId))
      return done({ ok: true, hidden: socket.data.hiddenRooms.has(roomId), restored: restoredConnection, broadcast: broadcastPublicState(roomId) });
    socket.join('room_' + roomId);
    socket.data.joinedRooms.add(roomId);
    if (enterHidden) socket.data.hiddenRooms.add(roomId);
    else (roomUsers[roomId] = roomUsers[roomId] || new Set()).add(uid);

    // عند استعادة اتصال منقطع لا نرسل دخولاً أو ترحيباً جديداً؛ الجلسة نفسها مستمرة.
    if (!enterHidden && !restoredConnection) emitRoomSystemEvent(roomId, 'join', `مرحباً بـ ${me.username} في غرفة ${room.name}`);
    // ترحيب الإدارة الاختياري يظهر في الدخول الجديد فقط، وليس عند استعادة WebSocket.
    const welcome = String(room.welcome || '').trim();
    if (welcome && !restoredConnection) socket.emit('msg', {
      id: Date.now(), room_id: +roomId, username: 'رسالة النظام',
      text: welcome, type: 'welcome', created_at: Math.floor(Date.now() / 1000)
    });
    emitRoomUsers(roomId);
    emitRoomCounts();
    // بث صوتي قائم في غرفة صوتية: القادم الجديد يُوصل تلقائياً دون أي طلب — نُعلم كل مذيع لينشئ اتصال WebRTC نحوه.
    const activeBroadcast = roomBroadcast[roomId];
    if (!enterHidden && activeBroadcast && activeBroadcast.mode === 'audio' && !activeBroadcast.hosts.has(uid)) {
      activeBroadcast.viewers.add(uid);
      for (const hostId of activeBroadcast.hosts.keys()) io.to('user_' + hostId).emit('bcast:new_listener', { roomId, listenerId: uid });
    }
    done({ ok: true, hidden: enterHidden, restored: restoredConnection, broadcast: broadcastPublicState(roomId) });
  });

  // مغادرة غرفة
  socket.on('leave', async (roomId) => {
    roomId = +roomId;
    if (!socket.data.joinedRooms.has(roomId)) return;
    const wasHidden = socket.data.hiddenRooms.has(roomId);
    socket.data.joinedRooms.delete(roomId);
    socket.data.hiddenRooms.delete(roomId);
    socket.leave('room_' + roomId);
    if (!wasHidden && !userStillHasVisibleSocketInRoom(uid, roomId, socket.id)) {
      if (roomUsers[roomId]) roomUsers[roomId].delete(uid);
      emitRoomSystemEvent(roomId, 'leave', `${me.username} خرج من الغرفة`);
    }
    cleanupBroadcastForUser(roomId, uid);
    emitRoomUsers(roomId);
    emitRoomCounts();
  });

  // ---------- البث المباشر (فيديو/صوت) ----------
  // بدء بث: الوضع (فيديو/صوت) يتحدد تلقائياً حسب نوع الغرفة. من يبدأ بثاً جديداً يصبح "المضيف الأساسي"، وله وحده
  // صلاحية قبول/رفض طلبات التحدث وإزالة المتحدثين. الإدارة فقط يمكنها الانضمام مباشرة كمذيع لبثٍ صوتي قائم؛
  // بقية الأعضاء المؤهلين يجب أن يطلبوا الإذن للتحدث عبر bcast:speak_request وينتظروا موافقة المضيف الأساسي.
  socket.on('bcast:start', async (roomId, cb) => {
    const ack = typeof cb === 'function' ? cb : () => { };
    roomId = +roomId;
    if (!socket.data.joinedRooms.has(roomId)) return ack({ ok: false, text: 'يجب دخول الغرفة أولاً' });
    const room = await q.get(`SELECT * FROM rooms WHERE id=?`, roomId);
    if (!room) return ack({ ok: false, text: 'الغرفة غير موجودة' });
    me = await q.get(`SELECT * FROM users WHERE id=?`, uid);
    const mode = room.type === 'voice' ? 'audio' : 'video';
    const allowed = mode === 'video' ? await canStartVideoBroadcast(me) : await canStartAudioBroadcast(me);
    if (!allowed) return ack({
      ok: false,
      text: me.muted ? 'أنت مكتوم ولا يمكنك الصعود كمذيع' : 'عضويتك غير مسموح لها بالصعود كمذيع'
    });
    let b = roomBroadcast[roomId];
    if (b && b.hosts.has(uid)) return ack({ ok: false, text: 'أنت تبث بالفعل في هذه الغرفة' });
    // أي عضو مؤهل (تحقق منه أعلاه عبر canStartAudioBroadcast) ينضم كمذيع مباشرة لبث صوتي قائم دون طلب/موافقة —
    // يسمعهم بعضهم البعض فوراً ويسمعهم كل من في الغرفة الصوتية مباشرة.
    const hostInfo = { id: uid, username: me.username, avatar: me.avatar || '', badge: badgeOf(me) };
    const isNewBroadcast = !b;
    if (isNewBroadcast) {
      b = roomBroadcast[roomId] = { mode, hosts: new Map(), viewers: new Set(), pending: new Map(), speakPending: new Map(), primaryHostId: uid, startedAt: Date.now() };
      // بث صوتي جديد: سجّل فوراً كل من هو موجود بالفعل في الغرفة كمستمع، ليتصل بهم المذيع من أول لحظة
      // بدل انتظار خروجهم ودخولهم من جديد ليُلتقطوا عبر معالج 'join'.
      if (mode === 'audio' && roomUsers[roomId]) for (const existingUid of roomUsers[roomId]) if (existingUid !== uid) b.viewers.add(existingUid);
    }
    if (b.speakPending) b.speakPending.delete(uid); // تجاوز الإدارة لأي طلب تحدث معلّق سابق لنفس الشخص
    // من ينضم كمذيع للبث القائم يتصل بكل المذيعين والمشاهدين الحاليين؛ الطرف الأقدم لا يبادر بالاتصال، تفادياً لتصادم العروض.
    const existingHosts = [...b.hosts.values()];
    const currentViewers = [...b.viewers];
    b.viewers.delete(uid);
    b.hosts.set(uid, { id: uid, username: hostInfo.username, avatar: hostInfo.avatar, badge: hostInfo.badge, socketId: socket.id, startedAt: Date.now() });
    io.to('room_' + roomId).emit(isNewBroadcast ? 'bcast:started' : 'bcast:host_joined', {
      roomId, mode, host: hostInfo, hosts: [...b.hosts.values()], primaryHostId: b.primaryHostId
    });
    ack({ ok: true, mode, isNewBroadcast, existingHosts, viewers: currentViewers });
  });

  // [مستمع] طلب الإذن للتحدث في غرفة صوتية — يصل للمضيف الأساسي فقط ليقبله أو يرفضه
  socket.on('bcast:speak_request', async (roomId, cb) => {
    const ack = typeof cb === 'function' ? cb : () => { };
    roomId = +roomId;
    const b = roomBroadcast[roomId];
    if (!b || b.mode !== 'audio') return ack({ ok: false, text: 'لا يوجد بث صوتي حالياً في هذه الغرفة' });
    if (b.hosts.has(uid)) return ack({ ok: false, text: 'أنت أحد المذيعين بالفعل' });
    if (b.speakPending.has(uid)) return ack({ ok: true, pending: true });
    me = await q.get(`SELECT * FROM users WHERE id=?`, uid);
    if (!await canStartAudioBroadcast(me)) return ack({ ok: false, text: me.muted ? 'أنت مكتوم ولا يمكنك الصعود كمذيع' : 'عضويتك غير مسموح لها بالصعود كمذيع' });
    b.speakPending.set(uid, { username: me.username, avatar: me.avatar || '' });
    io.to('user_' + b.primaryHostId).emit('bcast:speak_request', {
      roomId, user: { id: uid, username: me.username, avatar: me.avatar || '', badge: badgeOf(me) }
    });
    ack({ ok: true, pending: true });
  });

  // إلغاء طلب التحدث قبل رد المضيف الأساسي
  socket.on('bcast:speak_cancel', (roomId) => {
    roomId = +roomId;
    const b = roomBroadcast[roomId];
    if (!b || !b.speakPending || !b.speakPending.delete(uid)) return;
    io.to('user_' + b.primaryHostId).emit('bcast:speak_cancelled', { roomId, userId: uid });
  });

  // رد المضيف الأساسي على طلب تحدث: القبول يحوّل الطالب إلى مذيع فعلي فوراً
  socket.on('bcast:speak_response', async (roomId, targetUserId, accept) => {
    roomId = +roomId; targetUserId = +targetUserId;
    const b = roomBroadcast[roomId];
    if (!b || b.mode !== 'audio' || b.primaryHostId !== uid || !b.speakPending.has(targetUserId)) return;
    b.speakPending.delete(targetUserId);
    if (!accept) return io.to('user_' + targetUserId).emit('bcast:speak_response', { roomId, accept: false });
    const targetUser = await q.get(`SELECT * FROM users WHERE id=?`, targetUserId);
    if (!targetUser || b.hosts.has(targetUserId)) return;
    b.viewers.delete(targetUserId);
    const hostInfo = { id: targetUserId, username: targetUser.username, avatar: targetUser.avatar || '', badge: badgeOf(targetUser) };
    const existingHosts = [...b.hosts.values()];
    const currentViewers = [...b.viewers];
    b.hosts.set(targetUserId, { ...hostInfo, socketId: null, startedAt: Date.now() });
    io.to('room_' + roomId).emit('bcast:host_joined', { roomId, mode: b.mode, host: hostInfo, hosts: [...b.hosts.values()], primaryHostId: b.primaryHostId });
    io.to('user_' + targetUserId).emit('bcast:speak_response', { roomId, accept: true, existingHosts, viewers: currentViewers });
  });

  // إزالة مذيع وإعادته مستمعاً — للمضيف الأساسي فقط
  socket.on('bcast:remove_speaker', (roomId, targetUserId) => {
    roomId = +roomId; targetUserId = +targetUserId;
    const b = roomBroadcast[roomId];
    if (!b || b.mode !== 'audio' || b.primaryHostId !== uid || targetUserId === uid || !b.hosts.has(targetUserId)) return;
    b.hosts.delete(targetUserId);
    b.viewers.add(targetUserId);
    io.to('room_' + roomId).emit('bcast:host_left', { roomId, hostId: targetUserId, reason: 'removed_by_host' });
    io.to('user_' + targetUserId).emit('bcast:speaker_removed', { roomId });
    for (const hostId of b.hosts.keys()) io.to('user_' + hostId).emit('bcast:new_listener', { roomId, listenerId: targetUserId });
  });

  // إنهاء البث (لأي مذيع مشارك؛ ينتهي البث بالكامل عند خروج آخر مذيع).
  // إن استمر بث صوتي بعد خروجه (بقي مذيعون آخرون)، يتحوّل تلقائياً إلى مستمع بدل أن يبقى بلا صوت.
  socket.on('bcast:stop', (roomId, cb) => {
    const ack = typeof cb === 'function' ? cb : () => { };
    roomId = +roomId;
    const before = roomBroadcast[roomId];
    const mode = before ? before.mode : null;
    removeHostFromBroadcast(roomId, uid, 'ended_by_host');
    const after = roomBroadcast[roomId];
    if (after && mode === 'audio') {
      after.viewers.add(uid);
      for (const hostId of after.hosts.keys()) io.to('user_' + hostId).emit('bcast:new_listener', { roomId, listenerId: uid });
      return ack({ ok: true, becameListener: true, hosts: [...after.hosts.values()] });
    }
    ack({ ok: true, becameListener: false });
  });

  // طلب مشاهدة (بث الفيديو فقط) — موجَّه لمذيع واحد محدَّد بالذات (targetHostId)، وهو وحده من يملك حق قبوله أو رفضه.
  // بهذا لا يشاهد المستخدم أكثر من مذيع واحد في نفس الوقت: لا يتصل إلا بمن وافق تحديداً على طلبه.
  socket.on('bcast:watch_request', async (roomId, targetHostId, cb) => {
    const ack = typeof cb === 'function' ? cb : () => { };
    roomId = +roomId; targetHostId = +targetHostId;
    const b = roomBroadcast[roomId];
    if (!b || b.mode !== 'video') return ack({ ok: false, text: 'لا يوجد بث فيديو حالياً في هذه الغرفة' });
    if (b.hosts.has(uid)) return ack({ ok: false, text: 'أنت أحد المذيعين' });
    if (!b.hosts.has(targetHostId)) return ack({ ok: false, text: 'هذا المذيع لم يعد يبث حالياً' });
    if (b.viewers.has(uid)) return ack({ ok: true, already: true });
    if (b.pending.has(uid)) return ack({ ok: true, pending: true });
    me = await q.get(`SELECT * FROM users WHERE id=?`, uid);
    b.pending.set(uid, { username: me.username, avatar: me.avatar || '', targetHostId });
    const payload = { roomId, user: { id: uid, username: me.username, avatar: me.avatar || '', badge: badgeOf(me) } };
    io.to('user_' + targetHostId).emit('bcast:watch_request', payload);
    ack({ ok: true, pending: true });
  });

  // إلغاء طلب المشاهدة قبل رد المذيع المطلوب
  socket.on('bcast:watch_cancel', (roomId) => {
    roomId = +roomId;
    const b = roomBroadcast[roomId];
    if (!b) return;
    const req = b.pending.get(uid);
    if (!req) return;
    b.pending.delete(uid);
    io.to('user_' + req.targetHostId).emit('bcast:watch_cancelled', { roomId, userId: uid });
  });

  // رد المذيع المطلوب تحديداً على طلب مشاهدته: قبول أو رفض. أي مذيع آخر لا يملك صلاحية الرد على طلب لم يُوجَّه إليه.
  socket.on('bcast:watch_response', (roomId, targetUserId, accept) => {
    roomId = +roomId; targetUserId = +targetUserId;
    const b = roomBroadcast[roomId];
    if (!b) return;
    const req = b.pending.get(targetUserId);
    if (!req || req.targetHostId !== uid) return; // فقط المذيع الذي طُلبت مشاهدته تحديداً يملك حق الرد
    b.pending.delete(targetUserId);
    if (accept) b.viewers.add(targetUserId);
    const hostInfo = b.hosts.get(uid);
    io.to('user_' + targetUserId).emit('bcast:watch_response', { roomId, accept: !!accept, hosts: accept && hostInfo ? [hostInfo] : [] });
  });

  // مشاهد يغادر البث (فيديو) دون مغادرة الغرفة نفسها
  socket.on('bcast:leave', (roomId) => {
    roomId = +roomId;
    const b = roomBroadcast[roomId];
    if (!b) return;
    const wasConnected = b.viewers.delete(uid) || b.pending.delete(uid);
    if (wasConnected) for (const hostId of b.hosts.keys()) io.to('user_' + hostId).emit('bcast:viewer_left', { roomId, userId: uid });
  });

  // ترحيل إشارات WebRTC (offer/answer/ice candidate) بين المذيعين مع بعضهم (mesh) وبين كل مذيع والمشاهدين/المستمعين المقبولين
  socket.on('bcast:signal', (roomId, targetUserId, data) => {
    roomId = +roomId; targetUserId = +targetUserId;
    const b = roomBroadcast[roomId];
    if (!b) return;
    const iAmHost = b.hosts.has(uid);
    const targetIsHost = b.hosts.has(targetUserId);
    const valid = iAmHost
      ? (targetUserId !== uid && (targetIsHost || b.viewers.has(targetUserId)))
      : (targetIsHost && b.viewers.has(uid));
    if (!valid) return;
    io.to('user_' + targetUserId).emit('bcast:signal', { roomId, fromUserId: uid, data });
  });

  // رسالة عامة
  socket.on('msg', async ({ roomId, text, reply, color, media }) => {
    roomId = +roomId;
    if (!socket.data.joinedRooms.has(roomId)) return socket.emit('err', 'يجب دخول الغرفة قبل الكتابة');
    me = await q.get(`SELECT * FROM users WHERE id=?`, uid);
    if (me.muted) return socket.emit('err', 'أنت مكتوم ولا يمكنك الكتابة');
    const hiddenAdmin = socket.data.hiddenRooms.has(roomId) && (me.rank === 'superadmin' || me.rank === 'admin' || me.rank === 'supermaster');
    text = String(text || '').slice(0, 500).trim();
    const mediaType = media && ['image', 'audio'].includes(media.type) ? media.type : '';
    const requestedMediaPath = String((media && media.path) || '').slice(0, 180);
    const mediaExt = path.extname(requestedMediaPath).toLowerCase();
    const validMediaPath = /^\/uploads\/chat\/[a-zA-Z0-9_.-]+$/.test(requestedMediaPath);
    const matchingMediaType = (mediaType === 'image' && CHAT_IMAGE_EXTENSIONS.has(mediaExt))
      || (mediaType === 'audio' && CHAT_AUDIO_EXTENSIONS.has(mediaExt));
    const mediaFileExists = validMediaPath && fs.existsSync(path.join(__dirname, 'public/uploads/chat', path.basename(requestedMediaPath)));
    const mediaDuration = mediaType === 'audio' ? Math.max(0, Math.min(300, +(media && media.duration) || 0)) : 0;
    const cleanMedia = mediaFileExists && matchingMediaType ? { type: mediaType, path: requestedMediaPath, duration: mediaDuration } : null;
    if (!text && !cleanMedia) return;
    if (text && !await canUseMembershipFeature(uid, 'public_message_allowed_memberships'))
      return socket.emit('err', 'عضويتك غير مسموح لها بإرسال الرسائل في العام');
    if (cleanMedia && cleanMedia.type === 'image' && !await canUseMembershipFeature(uid, 'public_image_allowed_memberships'))
      return socket.emit('err', 'عضويتك غير مسموح لها بإرسال الصور في العام');
    if (cleanMedia && cleanMedia.type === 'audio' && !await canUseMembershipFeature(uid, 'voice_allowed_memberships'))
      return socket.emit('err', 'عضويتك غير مسموح لها بإرسال المقاطع الصوتية');
    // فلترة الكلمات (لا تطبق على رابط الإيموجي المصور)
    if (text && !text.startsWith('em::') && BANNED_WORDS_CACHE.length > 0) {
      for (const w of BANNED_WORDS_CACHE) {
        if (text.includes(w)) text = text.split(w).join('**');
      }
    }
    const isGlobalStaff = ['admin', 'superadmin', 'supermaster'].includes(me.rank);
    const isRoomAdminHere = !isGlobalStaff && (await q.get(`SELECT id FROM room_admins WHERE room_id=? AND user_id=?`, roomId, uid));

    let effectiveRank = isGlobalStaff ? me.rank : (isRoomAdminHere ? 'roomadmin' : (me.rank === 'roomadmin' ? 'user' : me.rank));
    let effectiveBadge = isGlobalStaff ? badgeOf(me) : (isRoomAdminHere ? 'roomadmin.png' : badgeOf({ ...me, rank: effectiveRank }));

    const freshPub = { ...pubUser(me), rank: effectiveRank, badge: effectiveBadge };   // صورة وبيانات حديثة من قاعدة البيانات (ليس لقطة الدخول)
    onlineUsers[uid] = freshPub;
    const rp = reply && reply.name ? { name: String(reply.name).slice(0, 40), text: String(reply.text || '').slice(0, 90) } : null;   // الرد على الرسالة
    const col = /^#[0-9a-fA-F]{6}$/.test(String(color || '')) ? String(color) : null;   // لون الخط من قائمة الألوان
    const messageUser = hiddenAdmin ? { ...freshPub, hidden_admin: 1 } : freshPub;
    const extra = JSON.stringify({ badge: effectiveBadge, gender: me.gender, rank: effectiveRank, membership: me.membership, avatar: me.avatar || '', registered: me.registered, muted: me.muted ? 1 : 0, reply: rp, color: col, media: cleanMedia, verified: VERIFIED_SET.has(me.username) ? 1 : 0, hidden_admin: hiddenAdmin ? 1 : 0 });
    const ins = await q.run(`INSERT INTO messages (room_id,user_id,username,text,type,extra) VALUES (?,?,?,?,'msg',?)`, roomId, uid, me.username, text, extra);
    const msg = {
      id: ins.lastID, room_id: roomId, text, type: 'msg', hidden_admin: hiddenAdmin ? 1 : 0,
      created_at: Math.floor(Date.now() / 1000),
      user: messageUser, reply: rp, color: col, media: cleanMedia
    };
    io.to('room_' + roomId).emit('msg', msg);
    if (text) maybeReplyWithRoomBot(roomId, text, me, text, rp).catch(() => { });
  });

  // رسالة خاصة
  socket.on('private', async ({ toId, text, media }) => {
    toId = +toId;
    text = String(text || '').slice(0, 500).trim();
    const mediaType = media && ['image', 'audio'].includes(media.type) ? media.type : '';
    const requestedMediaPath = String((media && media.path) || '').slice(0, 180);
    const mediaExt = path.extname(requestedMediaPath).toLowerCase();
    const validMediaPath = /^\/uploads\/chat\/[a-zA-Z0-9_.-]+$/.test(requestedMediaPath);
    const matchingMediaType = (mediaType === 'image' && CHAT_IMAGE_EXTENSIONS.has(mediaExt))
      || (mediaType === 'audio' && CHAT_AUDIO_EXTENSIONS.has(mediaExt));
    const mediaFileExists = validMediaPath && fs.existsSync(path.join(__dirname, 'public/uploads/chat', path.basename(requestedMediaPath)));
    const mediaDuration = mediaType === 'audio' ? Math.max(0, Math.min(300, +(media && media.duration) || 0)) : 0;
    const cleanMedia = mediaFileExists && matchingMediaType ? { type: mediaType, path: requestedMediaPath, duration: mediaDuration } : null;

    if (!text && !cleanMedia) return;
    me = await q.get(`SELECT * FROM users WHERE id=?`, uid);
    if (!await canUseMembershipFeature(uid, 'private_message_allowed_memberships'))
      return socket.emit('err', 'عضويتك غير مسموح لها بإرسال الرسائل الخاصة');
    const recipient = await q.get(`SELECT id FROM users WHERE id=?`, +toId);
    if (!recipient) return socket.emit('err', 'المستخدم غير موجود');
    if (await usersIgnoreEachOther(uid, +toId))
      return socket.emit('err', 'لا يمكن تبادل الرسائل الخاصة بسبب التجاهل بين الحسابين');

    let savedText = text;
    if (cleanMedia) {
      if (cleanMedia.type === 'image') {
        savedText = `media::image::${cleanMedia.path}`;
      } else if (cleanMedia.type === 'audio') {
        savedText = `media::audio::${cleanMedia.path}::${cleanMedia.duration}`;
      }
    }

    const ins = await q.run(`INSERT INTO private_messages (from_id,to_id,from_name,text) VALUES (?,?,?,?)`, uid, toId, me.username, savedText);
    const payload = {
      id: ins.lastID, from_id: uid, to_id: +toId, from_name: me.username,
      from_registered: me.registered ? 1 : 0, text: savedText, media: cleanMedia, created_at: Math.floor(Date.now() / 1000)
    };
    io.to('user_' + toId).emit('private', payload);
    socket.emit('private', payload);
  });

  // ===== مكالمات صوتية خاصة (1-to-1 WebRTC) =====
  socket.on('call:request', async ({ toId }) => {
    toId = +toId;
    if (!toId || toId === uid) return socket.emit('call:rejected', { fromId: toId, reason: 'invalid' });
    if (!await canUseMembershipFeature(uid, 'private_call_allowed_memberships')) {
      return socket.emit('call:rejected', { fromId: toId, reason: 'not_allowed', error: 'عضويتك غير مسموح لها بإجراء المكالمات الخاصة' });
    }
    const target = await q.get(`SELECT id, username, avatar, registered, membership, rank FROM users WHERE id=?`, toId);
    if (!target) return socket.emit('call:rejected', { fromId: toId, reason: 'not_found' });
    if (await usersIgnoreEachOther(uid, toId)) {
      return socket.emit('call:rejected', { fromId: toId, reason: 'ignored' });
    }
    const targetSockets = userSockets[toId] || [];
    if (targetSockets.length === 0) {
      await recordPrivateCallLog(uid, toId, '📞 مكالمة صوتية فائتة');
      return socket.emit('call:rejected', { fromId: toId, reason: 'offline' });
    }
    if (activePrivateCalls.has(toId)) {
      await recordPrivateCallLog(toId, uid, '📞 تم رفض المكالمة (المستخدم مشغول)');
      return socket.emit('call:rejected', { fromId: toId, reason: 'busy' });
    }

    me = await q.get(`SELECT * FROM users WHERE id=?`, uid);
    const isStaff = ['admin', 'superadmin', 'supermaster', 'roomadmin'].includes(me.rank);
    const isFreeTrial = !isStaff && !me.free_call_used;
    const settings = await getSettings();
    const callCost = Math.max(1, parseInt(settings.call_cost) || 2);

    // إذا استنفذ المكالمة المجانية الأولى وليس من الإدارة، يشترط وجود الذهب المطلوب
    if (!isStaff && !isFreeTrial && (+me.balance || 0) < callCost) {
      return socket.emit('call:rejected', {
        fromId: toId,
        reason: 'insufficient_balance',
        error: `رصيدك غير كافٍ. تكلفة المكالمة ${callCost} ذهب، يرجى شحن الرصيد ⚠️`
      });
    }

    activePrivateCalls.set(uid, { targetId: toId, callerId: uid, state: 'calling', requestedAt: Date.now(), isFreeTrial, callCost });
    activePrivateCalls.set(toId, { targetId: uid, callerId: uid, state: 'calling', requestedAt: Date.now(), isFreeTrial, callCost });

    io.to('user_' + toId).emit('call:incoming', {
      from: { id: uid, username: me.username, avatar: me.avatar || '' }
    });
    socket.emit('call:ringing', { toId, isFreeTrial, callCost });
  });

  socket.on('call:accept', async ({ toId }) => {
    toId = +toId;
    if (!toId) return;
    const callInfo = activePrivateCalls.get(uid);
    const now = Date.now();
    if (callInfo && callInfo.targetId === toId) {
      const isFree = !!callInfo.isFreeTrial;
      callInfo.state = 'connected';
      callInfo.connectedAt = now;
      const targetCallInfo = activePrivateCalls.get(toId);
      if (targetCallInfo) {
        targetCallInfo.state = 'connected';
        targetCallInfo.connectedAt = now;
      }

      // إذا كانت المكالمة المجانية الأولى: تسجيل استهلاكها للمتصل
      if (isFree) {
        await q.run(`UPDATE users SET free_call_used=1 WHERE id=?`, callInfo.callerId);
        if (onlineUsers[callInfo.callerId]) {
          onlineUsers[callInfo.callerId].free_call_used = 1;
        }
        io.to('user_' + callInfo.callerId).emit('call:trial_used', { free_call_used: 1 });
        io.to('user_' + callInfo.callerId).emit('notify', {
          text: 'بدأت مكالمتك المجانية التجريبية الأولى (المدة: دقيقة واحدة) 🎁',
          icon: 'phone_fill'
        });
      } else {
        // مكالمة مدفوعة مفتوحة المدة: خصم رسوم المكالمة من المتصل
        const callerUser = await q.get(`SELECT rank, balance FROM users WHERE id=?`, callInfo.callerId);
        const isStaff = callerUser && ['admin', 'superadmin', 'supermaster', 'roomadmin'].includes(callerUser.rank);
        const callCost = callInfo.callCost || 2;
        if (!isStaff && callerUser && (+callerUser.balance || 0) >= callCost) {
          await q.run(`UPDATE users SET balance=balance-? WHERE id=?`, callCost, callInfo.callerId);
          const newBal = callerUser.balance - callCost;
          if (onlineUsers[callInfo.callerId]) {
            onlineUsers[callInfo.callerId].balance = newBal;
          }
          io.to('user_' + callInfo.callerId).emit('call:gold_deducted', {
            balance: newBal,
            amount: callCost,
            isCallFee: true
          });
          const notif = await createUserNotification(callInfo.callerId, `تم خصم ${callCost} ذهب رسوم مكالمة مفتوحة المدة (الرصيد: ${newBal}) 🪙`, 'creditcard_fill');
          io.to('user_' + callInfo.callerId).emit('notify', { ...notif, balance: newBal });
        }
      }
    }
    me = await q.get(`SELECT id, username, avatar FROM users WHERE id=?`, uid);
    io.to('user_' + toId).emit('call:accepted', {
      from: { id: uid, username: me.username, avatar: me.avatar || '' }
    });
    await recordPrivateCallLog(toId, uid, '📞 تم بدء مكالمة صوتية');
  });

  socket.on('call:reject', async ({ toId, reason }) => {
    toId = +toId;
    activePrivateCalls.delete(uid);
    if (toId) {
      activePrivateCalls.delete(toId);
      const rejectText = reason === 'busy' ? '📞 تم رفض المكالمة (المستخدم مشغول)' : '📞 تم رفض المكالمة';
      await recordPrivateCallLog(uid, toId, rejectText);
      io.to('user_' + toId).emit('call:rejected', { fromId: uid, reason: reason || 'declined' });
    }
  });

  socket.on('call:cancel', async ({ toId }) => {
    toId = +toId;
    activePrivateCalls.delete(uid);
    if (toId) {
      activePrivateCalls.delete(toId);
      await recordPrivateCallLog(uid, toId, '📞 مكالمة صوتية فائتة');
      io.to('user_' + toId).emit('call:cancelled', { fromId: uid });
    }
  });

  socket.on('call:signal', ({ toId, data }) => {
    toId = +toId;
    if (!toId || !data) return;
    io.to('user_' + toId).emit('call:signal', { fromId: uid, data });
  });

  socket.on('call:end', async ({ toId, reason }) => {
    toId = +toId;
    const callInfo = activePrivateCalls.get(uid);
    activePrivateCalls.delete(uid);
    if (toId) {
      activePrivateCalls.delete(toId);
      if (callInfo && callInfo.connectedAt) {
        const sec = Math.max(1, Math.round((Date.now() - callInfo.connectedAt) / 1000));
        const mins = String(Math.floor(sec / 60)).padStart(2, '0');
        const secs = String(sec % 60).padStart(2, '0');
        await recordPrivateCallLog(uid, toId, `📞 مكالمة صوتية منتهية • ${mins}:${secs}`);
      } else {
        await recordPrivateCallLog(uid, toId, '📞 مكالمة صوتية فائتة');
      }
      io.to('user_' + toId).emit('call:ended', { fromId: uid, reason: reason || 'ended' });
    }
  });

  // تحديث الحالة
  socket.on('status', (st) => {
    if (onlineUsers[uid]) { onlineUsers[uid].status = st; }
    Object.keys(roomUsers).forEach(rid => { if (roomUsers[rid].has(uid)) emitRoomUsers(rid); });
  });

  socket.on('disconnect', async () => {
    const activeCall = activePrivateCalls.get(uid);
    if (activeCall && (!userSockets[uid] || userSockets[uid].length <= 1)) {
      const targetId = activeCall.targetId;
      activePrivateCalls.delete(uid);
      activePrivateCalls.delete(targetId);
      if (activeCall.connectedAt) {
        const sec = Math.max(1, Math.round((Date.now() - activeCall.connectedAt) / 1000));
        const mins = String(Math.floor(sec / 60)).padStart(2, '0');
        const secs = String(sec % 60).padStart(2, '0');
        await recordPrivateCallLog(uid, targetId, `📞 انقطعت المكالمة • ${mins}:${secs}`);
      } else {
        await recordPrivateCallLog(uid, targetId, '📞 مكالمة صوتية فائتة');
      }
      io.to('user_' + targetId).emit('call:ended', { fromId: uid, reason: 'disconnected' });
    }
    const joinedRooms = [...(socket.data.joinedRooms || [])];
    const hiddenRooms = new Set(socket.data.hiddenRooms || []);
    userSockets[uid] = (userSockets[uid] || []).filter(s => s !== socket.id);
    if (!isUserActiveInChat(uid)) {
      invalidateAdminTokens(uid);
      io.to('admin_panel_' + uid).emit('admin_session_terminated', { reason: 'chat_disconnected' });
    }
    for (const roomId of joinedRooms) {
      // انقطاع الاتصال ينهي بث هذا المستخدم فوراً إن كان مذيعاً، أو يزيله من قائمة مشاهدي/مستمعي بث الغير.
      if (!userStillHasVisibleSocketInRoom(uid, roomId)) cleanupBroadcastForUser(roomId, uid);
      // خروج الجلسة المخفية لا يظهر كرسالة نظام ولا يغيّر قائمة المتصلين.
      if (!hiddenRooms.has(+roomId) && !userStillHasVisibleSocketInRoom(uid, roomId)) {
        cancelPendingRoomLeave(uid, roomId);
        const key = roomLeaveKey(uid, roomId);
        const timer = setTimeout(() => {
          if (PENDING_ROOM_LEAVES.get(key) !== timer) return;
          PENDING_ROOM_LEAVES.delete(key);
          if (userStillHasVisibleSocketInRoom(uid, roomId)) return;
          if (roomUsers[roomId]) roomUsers[roomId].delete(uid);
          emitRoomSystemEvent(roomId, 'leave', `${me.username} خرج من الغرفة`);
          emitRoomUsers(roomId);
          emitRoomCounts();
        }, ROOM_RECONNECT_GRACE_MS);
        PENDING_ROOM_LEAVES.set(key, timer);
      }
    }
    if (userSockets[uid].length === 0) delete onlineUsers[uid];
  });
});

async function emitRoomUsers(roomId) {
  roomId = +roomId;
  const set = roomUsers[roomId] || new Set();
  const list = [];
  const roomAdmins = await q.all(`SELECT user_id FROM room_admins WHERE room_id=?`, roomId);
  const roomAdminIds = new Set(roomAdmins.map(ra => +ra.user_id));

  for (const id of set) {
    const u = await q.get(`SELECT * FROM users WHERE id=?`, id);
    if (u) {
      const isGlobalStaff = ['admin', 'superadmin', 'supermaster'].includes(u.rank);
      const isRoomAdminHere = !isGlobalStaff && roomAdminIds.has(+u.id);

      const p = pubUser(u);
      p.status = (onlineUsers[id] || {}).status || u.status;

      if (isRoomAdminHere) {
        p.rank = 'roomadmin';
        p.badge = 'roomadmin.png';
      } else if (!isGlobalStaff) {
        p.rank = u.rank === 'roomadmin' ? 'user' : u.rank;
        p.badge = badgeOf({ ...u, rank: p.rank });
      }

      list.push(p);
    }
  }
  io.to('room_' + roomId).emit('roomUsers', { roomId: +roomId, users: list, count: list.length });
}
async function emitRoomCounts() {
  const counts = {};
  Object.entries(roomUsers).forEach(([rid, set]) => counts[rid] = set.size);
  io.emit('roomCounts', counts);
}

// =====================================================
//  محرك رسائل الروبوت المجدولة (نص + لون + حجم + توقيت)
//  تسلسلي: رسالة واحدة بالدور من الروبوتات، والفاصل الزمني
//  هو الفاصل الفعلي بين كل رسالة والتي تليها (وليس مؤقّت مستقل لكل روبوت)
// =====================================================
let BOT_TIMER = null;
let BOT_INDEX = 0;
async function reloadBots() {
  if (BOT_TIMER) clearTimeout(BOT_TIMER);
  BOT_TIMER = null;
  BOT_INDEX = 0;
  try {
    const s = await getSettings();
    if (s.enable_bots === '0') return;   // الروبوت متوقف من اعدادات النظام
    const bots = await q.all(`SELECT * FROM bots WHERE active=1`);
    if (!bots.length) return;
    console.log(`    ★ الروبوت: ${bots.length} رسالة مجدولة (تسلسلي)`);
    scheduleNextBot(bots);
  } catch (e) { }
}
function scheduleNextBot(bots) {
  if (!bots || !bots.length) return;
  const b = bots[BOT_INDEX % bots.length];
  BOT_INDEX++;
  const ms = Math.max(1, +b.interval_min || 5) * 1000;
  BOT_TIMER = setTimeout(async () => {
    await sendBotMsg(b).catch(() => { });
    scheduleNextBot(bots);
  }, ms);
}
async function sendBotMsg(b) {
  const roomIds = b.room_id ? [b.room_id] : Object.keys(roomUsers);   // 0 = كل الغرف
  for (const rid of roomIds) {
    if (!roomUsers[rid] || roomUsers[rid].size === 0) continue;   // لا يرسل لغرفة فارغة
    const room = await q.get(`SELECT status FROM rooms WHERE id=?`, rid);
    if (!room || room.status !== 'open') continue;                // ولا للغرف المغلقة
    io.to('room_' + rid).emit('msg', {
      id: Date.now(), room_id: +rid, username: 'روبوت',
      text: b.text, type: 'bot', color: b.color || '#d946a6', size: b.size || 16,
      created_at: Math.floor(Date.now() / 1000)
    });
  }
}
reloadBots();

(async () => {
  await syncRoomBots(false).catch(() => { });
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`★ سيرفر الدردشة يعمل على ${SERVER_PROTOCOL}://0.0.0.0:${PORT}`);
    console.log(`★ لوحة التحكم: ${SERVER_PROTOCOL}://localhost:${PORT}/admin.html  (ax / 123456)`);
    if (HTTPS_ENABLED) console.log(`★ HTTPS مفعّل باستخدام ${path.basename(HTTPS_CERT_PATH)} و ${path.basename(HTTPS_KEY_PATH)}`);
  });
})();
