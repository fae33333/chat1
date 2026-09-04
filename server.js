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
const dns = require('dns');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { Server } = require('socket.io');
const db = require('./database');

const app = express();
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'nujum-admin-device-secret-2026';
const DEVICE_COOKIE_NAME = 'nujum_device_id';
const DEVICE_COOKIE_MAX_AGE = 1000 * 60 * 60 * 24 * 365 * 5;
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
// يفحص مفتاح key قبل إنشاء جلسة Engine.IO/Socket.IO، أي قبل قبول WebSocket.
// التحقق والحظر الفعليان موجودان في allowSocketHandshake أدناه.
// pingTimeout أوسع من الافتراضي (20 ث) ليتحمل انقطاع شبكة الهاتف اللحظي
// (تحويل شبكة ↔ WiFi) دون فصل الاتصال؛ التبويب المعلق ينقطع من الطرف الآخر على أي حال.
const io = new Server(server, { allowRequest: allowSocketHandshake, pingInterval: 25000, pingTimeout: 30000 });

const PORT = +(process.env.PORT || (HTTPS_ENABLED ? 443 : 3000));
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
function validDeviceId(value) {
  const id = String(value || '').trim();
  return /^nd_[a-f0-9]{48}$/.test(id) ? id : '';
}
function rawCookieValue(req, name) {
  const header = String(requestHeader(req, 'cookie') || '');
  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(item.slice(separator + 1).trim()); }
    catch (error) { return ''; }
  }
  return '';
}
function requestDeviceId(req) {
  const direct = validDeviceId(req && req.deviceId);
  if (direct) return direct;
  const parsed = validDeviceId(req && req.signedCookies && req.signedCookies[DEVICE_COOKIE_NAME]);
  if (parsed) return parsed;
  const raw = rawCookieValue(req, DEVICE_COOKIE_NAME);
  if (!raw) return '';
  const unsigned = cookieParser.signedCookie(raw, COOKIE_SECRET);
  return unsigned === false ? '' : validDeviceId(unsigned);
}

// إزالة محرف & من حقول النصوص القابلة للعرض بعد أن يفك Express/Socket.IO
// الحزمة. لا نلمس رابط HTTP الخام، وإلا ستتعطل فواصل & الخاصة بـ EIO/key.
const ENTITY_TEXT_FIELDS = new Set([
  'text', 'text_content', 'caption', 'bio', 'subject', 'note', 'reason',
  'description', 'welcome', 'reply_text', 'name'
]);
function stripPacketAmpersands(value) {
  return String(value ?? '').replace(/&/g, '');
}
function sanitizeDisplayTextFields(value, fieldName = '', depth = 0) {
  if (depth > 8 || value === null || value === undefined) return value;
  if (typeof value === 'string')
    return ENTITY_TEXT_FIELDS.has(fieldName) ? stripPacketAmpersands(value) : value;
  if (Array.isArray(value))
    return value.map(item => sanitizeDisplayTextFields(item, fieldName, depth + 1));
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  for (const key of Object.keys(value)) {
    value[key] = sanitizeDisplayTextFields(value[key], key, depth + 1);
  }
  return value;
}
function sanitizeSocketEventPacket(packet) {
  if (!Array.isArray(packet)) return packet;
  // packet[0] هو اسم الحدث ولا يجوز تغييره؛ ننظف حمولة الحدث فقط.
  for (let index = 1; index < packet.length; index++) {
    packet[index] = sanitizeDisplayTextFields(packet[index], '', 0);
  }
  return packet;
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
// طبقة موحدة لحقول النص القادمة عبر API: &lt; تصبح lt; ولا تبقى بداية
// لكيان HTML، مع إبقاء كلمات المرور والروابط والرموز والملفات دون تغيير.
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') sanitizeDisplayTextFields(req.body);
  next();
});

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
app.use(cookieParser(COOKIE_SECRET));
// معرف موقع وموقّع يبقى مع المتصفح عند تبديل الشبكة أو عنوان IP. لا يحتوي
// معلومات شخصية، ويستخدم فقط لربط الحظر الإداري بالجهاز نفسه.
app.use((req, res, next) => {
  let deviceId = requestDeviceId(req);
  if (!deviceId) {
    deviceId = 'nd_' + crypto.randomBytes(24).toString('hex');
    res.cookie(DEVICE_COOKIE_NAME, deviceId, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: HTTPS_ENABLED,
      maxAge: DEVICE_COOKIE_MAX_AGE,
      path: '/'
    });
  }
  req.deviceId = deviceId;
  next();
});
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
// ---------- قواعد صلاحية جلسة الإدارة ----------
// حسب التصميم المطلوب: انقطاع اتصال الدردشة (تجميد الهاتف للتبويب الخلفي)
// لا يقطع لوحة الإدارة — الجلسة تبقى حية ما دامت الصفحة لم تُحدّث.
// الشرط الصارم «متواجد داخل الدردشة الآن» يُطبَّق فقط عند تحميل/تحديث صفحة
// الإدارة (مسار /admin)، فيُقطع الاتصال عند الرفرش إذا كانت الدردشة
// منقطعة، بينما نبضات لوحة الإدارة وطلباتها (API) تعمل دون هذا الشرط.

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

function validateAdminTokenRecord(record, req, requireChatPresence = false) {
  if (!record || !record.token) return false;
  const currentActive = ADMIN_USER_TOKEN.get(+record.uid);
  if (!currentActive || currentActive.token !== record.token) return false;

  // الشرط الأساسي: يكون رابط الإدارة هو الرابط النشط الحالي لنفس الحساب.
  // شرط «الوجود داخل الدردشة الآن» يُطبَّق فقط عند تحميل/تحديث صفحة الإدارة
  // (requireChatPresence) — انقطاع الدردشة وحده لا ينهي جلسة لوحة إدارة
  // مفتوحة لم تُحدّث (نبضاتها وطلباتها API تعمل طالما الرابط صالح).
  if (requireChatPresence && !isUserActiveInChat(record.uid)) return false;

  // تم تخفيف ربط الـ IP / User-Agent / Cookie لأن بعض البيئات (المعاينة/البروكسي/التطبيقات المدمجة)
  // تغيّر هذه القيم بين نافذة الدردشة ونافذة لوحة الإدارة رغم أنهما من نفس الجهاز.
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

// =====================================================
//  منع أرشفة صفحات الإدارة والواجهات البرمجية نهائياً
// =====================================================
// robots.txt يمنع «الزحف» فقط، لكن الرابط قد يظهر في النتائج إن وُجد له رابط
// خارجي. لذلك نضيف طبقة أقوى: ترويسة X-Robots-Tag بـ noindex على كل استجابة
// إدارة أو API، ووسم <meta robots> داخل صفحة لوحة التحكم نفسها.
const NOINDEX_PATHS = ['/admin.html', '/api/', '/socket.io/'];
app.use((req, res, next) => {
  const p = String(req.path || req.originalUrl || '').split('?')[0].toLowerCase();
  const blocked = p === '/admin' || p === '/admin/' || p.startsWith('/admin/') ||
    NOINDEX_PATHS.some(x => p === x || p.startsWith(x));
  if (blocked) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate, nocache');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Referrer-Policy', 'no-referrer');
  }
  next();
});

// مسار محمي وديناميكي لفتح لوحة التحكم بالرمز العشوائي السري فقط
app.get(['/admin', '/admin.html'], async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const token = String(req.query.token || req.headers['x-admin-token'] || '').trim();
  const auth = token ? ADMIN_TOKEN_LOOKUP.get(token) : null;
  // تحميل/تحديث صفحة الإدارة يشترط الوجود الفعلي داخل الدردشة الآن —
  // هذا هو لَحظة «ينقطع» عند الرفرش إن كانت الدردشة منقطعة.
  const isValid = auth && validateAdminTokenRecord(auth, req, true);

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

// ملفات الواجهة تتغير أثناء إدارة الخادم؛ منع تخزين JS/CSS القديمة يمنع تشغيل
// نسخة app.js سابقة بعد النشر (خصوصاً خطأ applySettings القديم).
app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  etag: true,
  setHeaders: (res, filePath) => {
    if (/\.(?:js|css|html)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

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
fs.mkdirSync(path.join(__dirname, 'public/uploads/sounds'), { recursive: true }); // أصوات الإشعارات (دخول/رسالة/خروج)
// أيقونات المواقع المصغّرة (Favicon) الخاصة بمسارات الأرشفة — تُولَّد أو تُجلب تلقائياً
fs.mkdirSync(path.join(__dirname, 'public/uploads/favicons'), { recursive: true });
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
// رفع صور وأصوات الدخول الملكي من لوحة الإدارة
const royalStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'public/uploads/royal');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, safeUploadFilename(file.originalname, '.gif'))
});
const uploadRoyal = multer({ storage: royalStorage, limits: { fileSize: 20 * 1024 * 1024 } });

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
// رفع أصوات الإشعارات (دخول/رسالة/خروج) من لوحة الإدارة إلى مجلد مستقل تحت uploads.
const SOUND_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.opus', '.webm']);
const soundStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public/uploads/sounds')),
  filename: (req, file, cb) => cb(null, safeUploadFilename(file.originalname, '.mp3'))
});
const uploadSound = multer({
  storage: soundStorage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '');
    const allowed = SOUND_EXTENSIONS.has(ext) && (mime.startsWith('audio/') || mime === 'application/octet-stream');
    cb(allowed ? null : new Error('اختر ملفاً صوتياً صالحاً (MP3، WAV، OGG، M4A، AAC، OPUS)'), allowed);
  }
});
// رفع النبذة الصوتية للملف الشخصي (عضو مسجل فقط) — إلى مجلد مستقل تحت uploads.
const profileAudioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'public/uploads/profile');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const cleanExt = ext && ['.webm', '.ogg', '.mp3', '.m4a', '.aac', '.wav', '.opus'].includes(ext) ? ext : '.webm';
    cb(null, `bio_${Date.now()}_${crypto.randomBytes(10).toString('hex')}${cleanExt}`);
  }
});
const PROFILE_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.opus', '.webm']);
const uploadProfileAudio = multer({
  storage: profileAudioStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '');
    const allowed = PROFILE_AUDIO_EXTENSIONS.has(ext) && (mime.startsWith('audio/') || mime === 'application/octet-stream');
    cb(allowed ? null : new Error('يمكن رفع ملف صوتي فقط'), allowed);
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
// الجلسة النشطة لكل حساب مسجّل: uid -> رمز الدخول الحالي.
// عند ظهور رمز جديد (دخول من جهاز آخر) يُلغى الرمز القديم وتُقطع جلساته.
const USER_ACTIVE_TOKEN = new Map();
const CHAT_TOKEN_TTL = 12 * 60 * 60 * 1000;
function issueChatToken(user, ip, deviceId = '') {
  const token = crypto.randomBytes(32).toString('hex');
  CHAT_TOKENS.set(token, {
    uid: +user.id,
    rank: user.rank || 'user',
    ip: normalizeIp(ip),
    deviceId: validDeviceId(deviceId),
    createdAt: Date.now()
  });
  // منع الدخول من جهاز آخر بنفس الحساب المسجل: إبطال الجلسة السابقة وقطع اتصالاتها.
  if (user.registered) {
    const uid = +user.id;
    const prev = USER_ACTIVE_TOKEN.get(uid);
    USER_ACTIVE_TOKEN.set(uid, token);
    if (prev && prev !== token) {
      CHAT_TOKENS.delete(prev);
      disconnectRegisteredSessions(uid);
    }
  }
  return token;
}
// إنهاء كل اتصالات Socket.IO القائمة لحسابٍ ما وإبلاغها بجلسة بديلة.
function disconnectRegisteredSessions(uid) {
  const sockets = userSockets[uid];
  if (!sockets || !sockets.length) return;
  for (const sid of [...sockets]) {
    const s = io.sockets.sockets.get(sid);
    if (!s) continue;
    try {
      s.emit('session_conflict', {
        reason: 'session_conflict',
        text: 'تم تسجيل الدخول إلى حسابك من جهاز آخر. تم إنهاء الجلسة الحالية.'
      });
      setTimeout(() => { try { s.disconnect(true); } catch (e) { } }, 300);
    } catch (e) { }
  }
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

// =====================================================
//  حماية مفتاح اتصال Socket.IO
// =====================================================
// يحتفظ الخادم بالمفاتيح المقبولة لمدة 24 ساعة (قابلة للتغيير من البيئة).
// عند تكرار مفتاح أو إرسال قيمة لا تطابق مولّد العميل يُحظر IP الحقيقي في
// جدول bans، ولذلك يستمر الحظر بعد إعادة تشغيل الخادم ويظهر في لوحة الإدارة.
const SOCKET_KEY_TTL_MS = Math.max(60 * 1000, Number(process.env.SOCKET_KEY_TTL_MS) || 24 * 60 * 60 * 1000);
const SOCKET_KEY_MAX_ENTRIES = Math.max(1000, Number(process.env.SOCKET_KEY_MAX_ENTRIES) || 200000);
const USED_SOCKET_KEYS = new Map(); // key -> { ip, createdAt }
// عدّاد مخالفات مفاتيح الاتصال لكل IP: مخالفة واحدة (إعادة اتصال لحظية أو
// خلل شبكة عابر) ترفض المصافحة فقط دون حظر، والحظر التلقائي الدائم لا
// يحدث إلا بعد 5 مخالفات خلال 60 ثانية (نمط هجوم حقيقي) — كي لا يُحظر
// هاتف عادي بسبب إعادة اتصال واحدة أثناء تجميد التبويب واستئنافه.
const SOCKET_KEY_VIOLATIONS = new Map(); // ip -> { count, firstAt }
const SOCKET_KEY_VIOLATION_LIMIT = 5;
const SOCKET_KEY_VIOLATION_WINDOW_MS = 60 * 1000;
function recordSocketKeyViolation(ip) {
  const now = Date.now();
  const rec = SOCKET_KEY_VIOLATIONS.get(ip);
  if (!rec || now - rec.firstAt > SOCKET_KEY_VIOLATION_WINDOW_MS) {
    SOCKET_KEY_VIOLATIONS.set(ip, { count: 1, firstAt: now });
    return 1;
  }
  rec.count++;
  return rec.count;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of SOCKET_KEY_VIOLATIONS) if (now - rec.firstAt > SOCKET_KEY_VIOLATION_WINDOW_MS) SOCKET_KEY_VIOLATIONS.delete(ip);
}, 10 * 60 * 1000).unref();

function validateGeneratedSocketKey(value) {
  const key = String(value || '');
  if (!key) return { ok: false, reason: 'مفتاح الاتصال key مفقود أو فارغ' };
  if (!/^\d+$/.test(key)) return { ok: false, reason: 'مفتاح الاتصال يحتوي على محارف غير رقمية' };

  // x في المولّد رقم من 10 خانات، ثم تلحق به نتيجة x * 257.
  if (key.length < 22 || key.length > 23)
    return { ok: false, reason: `طول مفتاح الاتصال غير صحيح (${key.length})` };

  const xText = key.slice(0, 10);
  const x = Number(xText);
  if (!Number.isSafeInteger(x) || x < 1000000000 || x > 9999999999)
    return { ok: false, reason: 'بداية مفتاح الاتصال ليست رقماً مولداً صحيحاً' };

  const expected = xText + String(x * 257);
  if (key !== expected)
    return { ok: false, reason: 'مفتاح الاتصال غير مولد بالمعادلة المطلوبة' };

  return { ok: true, key };
}

function readSocketKey(req) {
  try {
    const parsed = new URL(String((req && req.url) || '/'), 'http://socket.local');
    const values = parsed.searchParams.getAll('key');
    if (values.length !== 1)
      return { key: values[0] || '', malformed: true, reason: values.length ? 'تم إرسال key أكثر من مرة' : 'لا يوجد key في رابط الاتصال' };
    return { key: values[0], malformed: false, reason: '' };
  } catch (error) {
    return { key: '', malformed: true, reason: 'تعذر تحليل رابط اتصال Socket.IO' };
  }
}

function removeExpiredSocketKeys(now = Date.now()) {
  const cutoff = now - SOCKET_KEY_TTL_MS;
  for (const [key, entry] of USED_SOCKET_KEYS) {
    if (entry.createdAt > cutoff) break;
    USED_SOCKET_KEYS.delete(key);
  }
}

function rememberSocketKey(key, ip, now = Date.now()) {
  removeExpiredSocketKeys(now);
  // مصافحة ناجحة بمفتاح صحيح = صفر مخالفات لهذا العنوان (يبدأ العد من جديد).
  SOCKET_KEY_VIOLATIONS.delete(ip);
  // حد أعلى يمنع استنزاف الذاكرة عند إغراق الخادم بمفاتيح صحيحة مختلفة.
  while (USED_SOCKET_KEYS.size >= SOCKET_KEY_MAX_ENTRIES) {
    const oldestKey = USED_SOCKET_KEYS.keys().next().value;
    if (oldestKey === undefined) break;
    USED_SOCKET_KEYS.delete(oldestKey);
  }
  USED_SOCKET_KEYS.set(key, { ip, createdAt: now });
}

async function autoBanSocketKeyIp(ip, reason, deviceId = '') {
  ip = validIp(ip);
  deviceId = validDeviceId(deviceId);
  if (!ip) return;
  const cleanReason = String(reason || 'مخالفة مفتاح اتصال WebSocket').slice(0, 150);
  const existing = await q.get(`SELECT id,device_id FROM bans WHERE ip=? LIMIT 1`, ip);
  if (!existing) {
    await q.run(`INSERT INTO bans (username,ip,device_id,reason) VALUES (?,?,?,?)`, 'حظر تلقائي WebSocket', ip, deviceId, cleanReason);
  } else if (deviceId && !validDeviceId(existing.device_id)) {
    await q.run(`UPDATE bans SET device_id=? WHERE id=?`, deviceId, existing.id);
  }
  await q.run(`UPDATE users SET banned=1 WHERE registered=0 AND (ip=? OR (?<>'' AND device_id=?))`, ip, deviceId, deviceId);

  // إبطال رموز الصفحات المفتوحة وفصل كل اتصالات العنوان/الجهاز فوراً.
  for (const [token, auth] of CHAT_TOKENS) {
    if (validIp(auth.ip) === ip || (deviceId && validDeviceId(auth.deviceId) === deviceId)) CHAT_TOKENS.delete(token);
  }
  for (const activeSocket of [...io.sockets.sockets.values()]) {
    const sameIp = validIp(activeSocket.data.clientIp) === ip;
    const sameDevice = deviceId && validDeviceId(activeSocket.data.deviceId) === deviceId;
    if (!sameIp && !sameDevice) continue;
    activeSocket.emit('banned', {
      banned: true,
      persistent: true,
      text: 'تم حظرك بسبب سلوكك السيئ',
      reason: cleanReason
    });
    setTimeout(() => activeSocket.disconnect(true), 80);
  }
  console.warn(`🔴 [AUTO-BAN WebSocket] ${ip} — ${cleanReason}`);
}

// Socket.IO/Engine.IO يستدعي هذه الدالة في طلب المصافحة الأول فقط. طلب ترقية
// WebSocket لنفس sid لا يُحسب استخداماً ثانياً للمفتاح.
async function allowSocketHandshake(req, callback) {
  let replied = false;
  const done = (message, accepted) => {
    if (replied) return;
    replied = true;
    callback(message, accepted);
  };

  try {
    const ip = validIp(requestIp(req));
    const deviceId = requestDeviceId(req);
    if (!ip) return done('تعذر تحديد عنوان IP الحقيقي', false);

    // منع المحظور أصلاً قبل استهلاك أي موارد إضافية، حتى لو غيّر عنوان IP.
    const currentBan = await q.get(
      `SELECT id FROM bans WHERE ip=? OR (?<>'' AND device_id=?) LIMIT 1`,
      ip, deviceId, deviceId
    );
    if (currentBan) return done('هذا المستخدم أو الجهاز محظور', false);

    const received = readSocketKey(req);
    const validation = received.malformed
      ? { ok: false, reason: received.reason }
      : validateGeneratedSocketKey(received.key);

    if (!validation.ok) {
      const violations = recordSocketKeyViolation(ip);
      if (violations >= SOCKET_KEY_VIOLATION_LIMIT) await autoBanSocketKeyIp(ip, validation.reason, deviceId);
      else console.warn(`🟡 [Socket key] مصافحة مرفوضة (${violations}/${SOCKET_KEY_VIOLATION_LIMIT}) من ${ip} — ${validation.reason}`);
      return done('مفتاح اتصال غير صالح', false);
    }

    const now = Date.now();
    const previous = USED_SOCKET_KEYS.get(validation.key);
    if (previous && now - previous.createdAt <= SOCKET_KEY_TTL_MS) {
      // إعادة اتصال واحدة بالمفتاح نفسه (تجميد التبويب ثم استئنافه) لا تعني
      // هجوماً: نرفض المصافحة فقط، والمحاولة التالية بمفتاح جديد تمر.
      const violations = recordSocketKeyViolation(ip);
      if (violations >= SOCKET_KEY_VIOLATION_LIMIT) await autoBanSocketKeyIp(ip, `مفتاح اتصال مكرر: ${validation.key}`, deviceId);
      else console.warn(`🟡 [Socket key] مفتاح مكرر (${violations}/${SOCKET_KEY_VIOLATION_LIMIT}) من ${ip} — رُفضت المصافحة دون حظر`);
      return done('مفتاح اتصال مكرر', false);
    }
    if (previous) USED_SOCKET_KEYS.delete(validation.key);

    // الحجز يتم قبل قبول الطلب كي لا ينجح طلبان متزامنان بالمفتاح نفسه.
    rememberSocketKey(validation.key, ip, now);
    return done(null, true);
  } catch (error) {
    console.error('[Socket key] تعذر فحص المصافحة:', error);
    return done('تعذر التحقق من مفتاح الاتصال', false);
  }
}

setInterval(removeExpiredSocketKeys, 10 * 60 * 1000).unref();

async function getSettings() {
  const rows = await q.all(`SELECT key,value FROM settings`);
  const s = {};
  rows.forEach(r => s[r.key] = r.value);
  return s;
}

// التكاليف غير السالبة: الصفر قيمة صحيحة تعني أن الميزة مجانية، ولا يجوز
// أن يحوّله استخدام (القيمة || الافتراضي) إلى سعر افتراضي.
function normalizeNonNegativeCost(value, fallback) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

// قواعد رسائل العام (الفاصل والحد الأقصى)؛ تُحدّث فور حفظها من لوحة الإدارة.
let PUBLIC_MESSAGE_COOLDOWN_MS = 3000;
let PUBLIC_MESSAGE_MAX_LENGTH = 500;
const PUBLIC_MESSAGE_LAST_SENT = new Map(); // هوية الشخص -> وقت آخر رسالة مقبولة
function normalizePublicMessageCooldownSeconds(value, fallback = 3) {
  const parsed = Number(value);
  const seconds = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(60, Math.max(0, Math.round(seconds)));
}
function normalizePublicMessageMaxLength(value, fallback = 500) {
  const parsed = Number(value);
  const length = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(5000, Math.max(1, Math.round(length)));
}
function normalizePublicMessageSpacing(value, fallback = 4) {
  const parsed = Number(value);
  const spacing = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(40, Math.max(0, Math.round(spacing)));
}
function normalizePublicMessageNameSize(value, fallback = 14) {
  const parsed = Number(value);
  const size = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(36, Math.max(10, Math.round(size)));
}
function normalizePublicMessageBodyWidth(value) {
  return String(value || '').toLowerCase() === 'full' ? 'full' : 'fit';
}
const PUBLIC_MESSAGE_BADGE_SETTING_KEYS = [
  'msg_badge_superadmin_size', 'msg_badge_admin_size', 'msg_badge_roomadmin_size',
  'msg_badge_mmez_size', 'msg_badge_vip_size', 'msg_badge_premium_size',
  'msg_badge_plus_size', 'msg_badge_register_size', 'msg_badge_guest_size',
  'msg_badge_hidden_admin_size'
];
function normalizePublicMessageBadgeSize(value, fallback = 24) {
  const parsed = Number(value);
  const size = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(80, Math.max(12, Math.round(size)));
}
async function refreshPublicMessageRules() {
  const settings = await getSettings();
  PUBLIC_MESSAGE_COOLDOWN_MS = normalizePublicMessageCooldownSeconds(settings.public_message_cooldown_seconds) * 1000;
  PUBLIC_MESSAGE_MAX_LENGTH = normalizePublicMessageMaxLength(settings.msg_max);
  return { cooldownMs: PUBLIC_MESSAGE_COOLDOWN_MS, maxLength: PUBLIC_MESSAGE_MAX_LENGTH };
}
function publicMessageIdentityKey(socket, user) {
  if (user && user.registered) return `user:${+user.id}`;
  const deviceId = validDeviceId(socket && socket.data && socket.data.deviceId);
  if (deviceId) return `device:${deviceId}`;
  const ip = validIp(socket && socket.data && socket.data.clientIp);
  return ip ? `ip:${ip}` : `guest:${user ? +user.id : 0}`;
}
refreshPublicMessageRules().catch(() => { });
setTimeout(() => refreshPublicMessageRules().catch(() => { }), 1200);

// =====================================================
//  بوابة الحماية: منع الاتصال عبر VPN/بروكسي + قائمة المتصفحات المسموحة
//  تُدار من لوحة التحكم الإدارية وتُطبّق على صفحة الدردشة واتصال Socket.IO.
// =====================================================
// *** أُلغيت خاصية «الحماية والوصول (VPN / المتصفحات)» بالكامل حسب طلب المالك ***
// نبقيه معطّلاً دائماً: لا نحفظ مفاتيح الحماية، ولا نعيد تمكينها من الإعدادات.
let ACCESS_SETTINGS = { block_vpn_proxy: '0', vpn_proxy_check: 'both', vpn_proxy_block_hosting: '0', allowed_browsers: '' };
async function refreshAccessGate() {
  // لا شَيء: خاصية حظر VPN/المتصفحات أُلغيت نهائياً، فلا نقرأ مفاتيحها من قاعدة البيانات.
  ACCESS_SETTINGS = { block_vpn_proxy: '0', vpn_proxy_check: 'both', vpn_proxy_block_hosting: '0', allowed_browsers: '' };
  // تنظيف لمرة واحدة: إزالة مفاتيح الحماية القديمة من قاعدة البيانات كي لا تبقى معطّلة.
  try {
    await q.run(`DELETE FROM settings WHERE key IN ('block_vpn_proxy','vpn_proxy_check','vpn_proxy_block_hosting','allowed_browsers')`);
  } catch (e) { /* تجاهل: لا يوجد جدول/مفاتيح */ }
}
refreshAccessGate().catch(() => { });
setTimeout(() => refreshAccessGate().catch(() => { }), 1500);
setInterval(() => refreshAccessGate().catch(() => { }), 30 * 1000).unref();

// تعرّف اسم المتصفح من User-Agent (للتحقق من قائمة المتصفحات المسموحة).
function detectBrowserName(userAgent) {
  const ua = String(userAgent || '').toLowerCase();
  if (ua.includes('edg/') || ua.includes('edgios') || ua.includes('edga/') || ua.includes('edge/')) return 'edge';
  if (ua.includes('opr/') || ua.includes('opera') || ua.includes('vivaldi') || ua.includes('samsungbrowser')) return 'opera';
  if (ua.includes('firefox/')) return 'firefox';
  if (ua.includes('chrome/') || ua.includes('crios/') || ua.includes('chromium')) return 'chrome';
  if (ua.includes('safari/')) return 'safari';
  return 'unknown';
}

// هل المتصفح مسموح؟ قائمة فارغة = السماح بالكل.
function isBrowserAllowed(userAgent) {
  const list = String(ACCESS_SETTINGS.allowed_browsers || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  if (!list.length) return true;
  if (list.includes('all')) return true;
  return list.includes(detectBrowserName(userAgent));
}

// كشف وساطة عبر بروكسي/VPN من هيدرات الطلب (خطوط هيدر غير موثوقة تدل على وساطة).
function headerProxyIndicatesVpn(req) {
  if (!req || !req.headers) return false;
  const via = String(requestHeader(req, 'via') || '').toLowerCase();
  const proxyConn = String(requestHeader(req, 'proxy-connection') || '').toLowerCase();
  const forwarded = String(requestHeader(req, 'forwarded') || '').toLowerCase();
  if (via || proxyConn) return true;
  if (forwarded && !requestComesThroughTrustedProxy(req)) return true;
  return false;
}

// فحص عنوان IP عبر خدمات خارجية مجانية لمعرفة إن كان من نطاق VPN/بوروكسي/استضافة.
// يعتمد على قواعد بيانات الجيو/البوروكسي (ip-api و ipwho.is) لأن فحص الهيدر وحده
// لا يكتشف برامج VPN التي تعمل على مستوى الشبكة دون إرسال أي هيدر.
const VPN_IP_CACHE = new Map(); // ip -> { blocked, hosting, expires }
const VPN_IP_TTL_MS = 3 * 60 * 60 * 1000;

// ip-api: proxy=true إن كان IP بوروكسي/VPN معروف؛ hosting=true إن كان من نطاق استضافة/سحابي.
// نضيف أيضاً حقل `as` (مزوّد الشبكة ASN) لتحديد الاستضافة/VPN من اسم المزوّد.
async function ipApiLookup(ip) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,proxy,hosting,as`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    if (!data || data.status !== 'success') return null;
    return {
      proxy: data.proxy === true,
      hosting: data.hosting === true,
      as: String(data.as || '')
    };
  } catch (e) { clearTimeout(timer); return null; }
}

// ipwho.is (احتياطي عبر HTTPS): يوفّر مزوّد الشبكة في connection.org لنستنتج الاستضافة/VPN.
async function ipwhoLookup(ip) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    if (!data || data.success === false) return null;
    return { proxy: false, hosting: hostingLooksVpn(data.connection && data.connection.org), as: String(data.connection && data.connection.org || '') };
  } catch (e) { clearTimeout(timer); return null; }
}

function hostingLooksVpn(org) {
  // كلمات تدل على مزوّد VPN/سحابة/استضافة يمرّر منها معظم مطوري VPNe والبوروكسيات.
  return /vpn|proxy|hosting|datacenter|data[\s-]?camp|m247|leaseweb|ovh|digitalocean|linode|vultr|amazon|aws|google|azure|contabo|hetzner|choopa|colocrossing|cloudflare|server|serverius|guifi|yourserverprovider/i.test(String(org || ''));
}

async function externalVpnCheck(ip) {
  if (!ip) return false;
  const cached = VPN_IP_CACHE.get(ip);
  if (cached && Date.now() < cached.expires) return cached.blocked;
  const blockHosting = String(ACCESS_SETTINGS.vpn_proxy_block_hosting) === '1';
  let blocked = false;
  let hosting = false;
  let info = await ipApiLookup(ip);
  if (!info) info = await ipwhoLookup(ip);
  if (info) {
    hosting = info.hosting === true || hostingLooksVpn(info.as);
    blocked = info.proxy === true || (blockHosting && hosting);
  } else {
    // فشل كل مصادر الفحص: لا نمنع إلا النتائج المؤكدة (fail-open) كي لا يُحجب الجميع بلا سبب.
    blocked = false;
  }
  if (blocked) console.log(`[AccessGate] تم منع اتصال من IP ${ip} (proxy/hosting)`);
  VPN_IP_CACHE.set(ip, { blocked, hosting, expires: Date.now() + VPN_IP_TTL_MS });
  return blocked;
}

// ---------- استثناء روبوتات البحث الموثّقة (Googlebot وأمثالها) ----------
// بوابة VPN/الاستضافة تعتبر شبكات Google Cloud نطاقات استضافة (hosting)،
// ومنها تعمل روبوتات جوجل الزاحفة؛ وكشف المتصفح يرصد «Googlebot» متصفحاً
// مجهولاً. النتيجة بدون استثناء صريح: كل مسارات الأرشفة (/chat1 ...) تعود
// 403 مع noindex للروبوت، فتفشل طلبات الفهرسة في «أدوات مشرفي المواقع»
// برسالة «حدث خطأ ما». لذلك نعتمد الروبوت فقط بعد تحقق عكسي من العنوان:
// rDNS يطابق نطاق جوجل/بينغ المعروف، ثم تأكيد طردي أن الاسم يحلّ لنفس IP،
// حتى لا يستطيع مستخدم VPN انتحال يوزر-أجنت الروبوت وتجاوز البوابة.
// ولأن DNS العكسي قد يفشل أحياناً على بعض الاستضافات/خلف البروكسي، نضيف
// طبقة احتياطية: تحقق من نطاقات IP الرسمية للمحركات (CIDR) — أي روبوت من
// هذه النطاقات يُعدّ موثّقاً حتى لو تعذّر فكّ rDNS لحظياً.
const SEARCH_CRAWLER_RULES = [
  {
    ua: /googlebot|googleother|apis-google|adsbot-google|mediapartners-google|feedfetcher-google/i,
    domains: ['googlebot.com', 'google.com'],
    cidrs: [
      // نطاقات Googlebot الرسمية (IPv4 + IPv6) — تُنشر رسمياً من Google
      '66.249.64.0/19', '66.249.64.0/20', '66.249.70.0/24', '66.249.71.0/24',
      '66.249.72.0/22', '66.249.76.0/22', '66.249.80.0/20', '66.249.64.0/19',
      '64.233.160.0/19', '216.239.32.0/19',
      '2001:4860:4801::/48', '2001:4860:4805::/48'
    ]
  },
  {
    ua: /bingbot|bingpreview|msnbot|adindexer/i,
    domains: ['search.msn.com', 'bing.com'],
    cidrs: ['40.77.167.0/24', '40.77.160.0/19', '40.77.163.0/24', '157.55.39.0/24', '207.46.13.0/24', '66.249.64.0/20']
  },
  {
    ua: /yandexbot|yandexrenderterm|yandeximages/i,
    domains: ['yandex.ru', 'yandex.net', 'yandex.com'],
    cidrs: ['77.88.0.0/18', '5.255.192.0/18', '37.9.64.0/18', '95.108.128.0/17']
  },
  {
    ua: /baiduspider|baiduimage/i,
    domains: ['baidu.jp'],
    cidrs: ['220.181.108.0/24', '220.181.38.0/24', '123.125.71.0/24', '180.76.15.0/24']
  },
  {
    ua: /duckduckbot/i,
    domains: ['duckduckgo.com'],
    cidrs: ['40.77.167.0/24', '40.77.160.0/19']
  }
];

// فحص هل عنوان IP داخل نطاق CIDR (يدعم IPv4 وIPv6).
function ipInCidr(ip, cidr) {
  try {
    const ipStr = String(ip || '');
    if (!net.isIP(ipStr)) return false;
    const [range, bitsStr] = String(cidr).split('/');
    const bits = parseInt(bitsStr, 10);
    if (typeof bits !== 'number' || isNaN(bits)) return false;
    const toBytes = (addr) => {
      if (net.isIPv4(addr)) return addr.split('.').map(Number);
      // IPv6: نوسّع الترميز المضغوط '::' ثم نحول كل مجموعة hex إلى بايتين.
      let a = String(addr).toLowerCase();
      if (a.includes('::')) {
        const [left = '', right = ''] = a.split('::');
        const l = left ? left.split(':') : [];
        const r = right ? right.split(':') : [];
        const missing = 8 - (l.length + r.length);
        const zeros = new Array(Math.max(0, missing)).fill('0');
        a = (l.length ? left : '') + ':' + zeros.join(':') + (r.length ? ':' + right : '');
        a = a.replace(/^:|:$/g, '');
      }
      const out = [];
      for (const g of a.split(':')) {
        const val = parseInt(g || '0', 16);
        out.push((val >> 8) & 255, val & 255);
      }
      return out.slice(0, 16);
    };
    const ipBytes = toBytes(ipStr);
    const rangeBytes = toBytes(range);
    if (ipBytes.length !== rangeBytes.length) return false;
    const totalBits = ipBytes.length * 8;
    let matchedBits = 0;
    for (let i = 0; i < totalBits; i++) {
      if (i >= bits) break;
      const byte = i >> 3;
      const bit = 7 - (i & 7);
      const ipBit = (ipBytes[byte] >> bit) & 1;
      const rangeBit = (rangeBytes[byte] >> bit) & 1;
      if (ipBit !== rangeBit) return false;
      matchedBits++;
    }
    return true;
  } catch (e) { return false; }
}

// يبحث عن أي نطاق CIDR من القائمة يطابق IP الروبوت.
function crawlerIpMatchesCidr(rule, ip) {
  if (!rule || !Array.isArray(rule.cidrs) || !rule.cidrs.length) return false;
  return rule.cidrs.some(c => ipInCidr(ip, c));
}
const VERIFIED_CRAWLER_CACHE = new Map(); // ip -> { allowed, expires }
const CRAWLER_OK_TTL_MS = 24 * 60 * 60 * 1000; // نتيجة موجبة: يوم كامل
const CRAWLER_FAIL_TTL_MS = 2 * 60 * 1000;     // نتيجة سالبة: دقيقتان حتى لا نثقل DNS ولا نُهدر وقت مربط الزحف

async function isVerifiedSearchCrawler(req) {
  const ua = String(requestHeader(req, 'user-agent') || '');
  const rule = SEARCH_CRAWLER_RULES.find(r => r.ua.test(ua));
  if (!rule) return false;
  const ip = validIp(requestIp(req));
  if (!ip || ip === 'غير معروف') return false;
  const now = Date.now();
  const cached = VERIFIED_CRAWLER_CACHE.get(ip);
  if (cached && now < cached.expires) return cached.allowed;
  let allowed = false;
  try {
    const hostnames = await dns.promises.reverse(ip);
    const host = String((hostnames && hostnames[0]) || '').toLowerCase().replace(/\.$/, '');
    const rdnsOk = !!host && rule.domains.some(d => host === d || host.endsWith('.' + d));
    if (rdnsOk) {
      try {
        const addrs = await (net.isIPv6(ip) ? dns.promises.resolve6(host) : dns.promises.resolve4(host));
        allowed = Array.isArray(addrs) && (addrs.length === 0 || addrs.includes(ip)); // تعذر التأكيد الطردي لا يلغي تطابق rDNS
      } catch (e) { allowed = true; }
    }
  } catch (e) { allowed = false; } // فشل DNS العكسي (لا PTR للعنوان أو مشكلة DNS)
  // طبقة احتياطية: إن تعذّر فكّ rDNS يبقى الروبوت موثّقاً إذا كان عنوانه ضمن
  // نطاقات المحرك الرسمية. هذا يمنع إفشال طلب «الفهرسة» في أدوات مشرفي المواقع،
  // بينما يبقى منع VPN سليماً لأن هذه النطاقات مملوكة للمحركات فعلاً.
  if (!allowed && crawlerIpMatchesCidr(rule, ip)) allowed = true;
  VERIFIED_CRAWLER_CACHE.set(ip, { allowed, expires: now + (allowed ? CRAWLER_OK_TTL_MS : CRAWLER_FAIL_TTL_MS) });
  if (VERIFIED_CRAWLER_CACHE.size > 5000) {
    for (const [k, v] of VERIFIED_CRAWLER_CACHE) if (v.expires < now) VERIFIED_CRAWLER_CACHE.delete(k);
  }
  if (allowed) console.log(`[AccessGate] زحف موثّق لمحركات البحث من ${ip} (${ua.slice(0, 60)})`);
  return allowed;
}

// قرار نهائي للوصول: يعيد قائمة أسباب المنع (ربما فارغة = مسموح).
// *** أُلغيت خاصية «الحماية والوصول (VPN / المتصفحات)» بالكامل حسب طلب المالك ***
// لم نعد نحظر أي اتصال — لا ممن يستخدم VPN/بوروكسي، ولا ممن يفتح من متصفح
// غير مذكور، ولا روبوتات محركات البحث. النتيجة: نجاح طلب الفهرسة في
// «أدوات مشرفي المواقع» وزحف محركات البحث دون 403/noindex، والسماح لكل الزوار.
async function accessBlockReasons(req) {
  return []; // لا حظر إطلاقاً
}

// صفحة HTML موحدة تظهر للمحظور (مفصّلة حسب السبب).
function renderAccessBlockedHtml(reasons, req) {
  const browserBlocked = reasons.includes('browser');
  const vpnBlocked = reasons.includes('vpn');
  const siteName = ACCESS_SETTINGS.site_name || 'الدردشة';
  let icon = 'lock_shield_fill';
  let title = 'تعذر الوصول إلى الدردشة';
  if (vpnBlocked) icon = 'network_alt';
  if (browserBlocked) icon = 'globe';
  const lines = [];
  if (vpnBlocked) lines.push('تم رصد اتصال عبر <b>برنامج VPN</b> أو <b>بروكسي</b>. الإدارة فعّلت منع هذه الأنواع من الاتصال حفاظاً على أمان الدردشة. يرجى إيقاف VPN/البروكسي ثم إعادة المحاولة.');
  if (browserBlocked) lines.push('المتصفح الذي تستخدمه <b>غير مسموح</b> في هذه الدردشة حالياً. يُرجى استخدام أحد المتصفحات المسموحة (مثل كروم، فايرفوكس، سفاري، إيدج).');
  const body = lines.join('<br><br>');
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${title} | ${esc(siteName)}</title>
<link rel="stylesheet" href="/icons/framework7-icons.css">
<style>
* { margin:0; padding:0; box-sizing:border-box; font-family:"Noto Sans Arabic","SF Arabic",Arial,sans-serif; }
body { min-height:100vh; display:flex; align-items:center; justify-content:center; background:linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); color:#fff; padding:20px; text-align:center; }
.card { max-width:460px; width:100%; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:24px; padding:36px 24px; backdrop-filter:blur(10px); box-shadow:0 25px 50px -12px rgba(0,0,0,0.5); }
.icon { width:78px; height:78px; border-radius:50%; background:rgba(239,68,68,0.15); border:1.5px solid rgba(239,68,68,0.35); color:#ef4444; display:flex; align-items:center; justify-content:center; margin:0 auto 20px; font-size:38px; }
h2 { font-size:19px; font-weight:900; margin-bottom:14px; color:#f8fafc; }
p { font-size:13.5px; color:#cbd5e1; line-height:2; margin-bottom:24px; }
.btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; background:linear-gradient(135deg, #6366f1, #4f46e5); color:#fff; text-decoration:none; padding:12px 26px; border-radius:14px; font-weight:800; font-size:14px; box-shadow:0 4px 14px rgba(99,102,241,0.4); cursor:pointer; border:0; }
.btn:hover { transform:translateY(-2px); }
</style>
</head>
<body>
  <div class="card">
    <div class="icon"><i class="f7-icons">${icon}</i></div>
    <h2>${title}</h2>
    <p>${body}</p>
    <button class="btn" onclick="location.reload()"><i class="f7-icons">arrow_clockwise</i> إعادة المحاولة</button>
  </div>
</body>
</html>`;
}
setInterval(() => {
  const cutoff = Date.now() - Math.max(PUBLIC_MESSAGE_COOLDOWN_MS, 5 * 60 * 1000);
  for (const [identity, sentAt] of PUBLIC_MESSAGE_LAST_SENT) {
    if (sentAt < cutoff) PUBLIC_MESSAGE_LAST_SENT.delete(identity);
  }
}, 5 * 60 * 1000).unref();

function membershipAccessKey(user) {
  if (!user || !user.registered) return 'guest';
  if (user.membership && user.membership !== 'none') return user.membership;
  return 'registered';
}
// القيم الافتراضية لكل ميزة عندما لم تحفظ الإدارة المفتاح في قاعدة البيانات بعد
const FEATURE_MEMBERSHIP_DEFAULTS = {
  wall_allowed_memberships: 'guest,registered,mmez,plus,premium,vip',
  broadcast_allowed_memberships: 'mmez,plus,premium,vip',
  status_allowed_memberships: 'registered,mmez,plus,premium,vip',
  voice_allowed_memberships: 'mmez,plus,premium,vip',
  public_message_allowed_memberships: 'guest,registered,mmez,plus,premium,vip',
  private_message_allowed_memberships: 'guest,registered,mmez,plus,premium,vip',
  private_call_allowed_memberships: 'mmez,plus,premium,vip',
  video_call_allowed_memberships: 'mmez,plus,premium,vip',
  public_image_allowed_memberships: 'guest,registered,mmez,plus,premium,vip'
};
async function canUseMembershipFeature(userId, settingKey) {
  const user = await q.get(`SELECT registered,membership,rank FROM users WHERE id=?`, +userId);
  if (!user) return false;
  if (['roomadmin', 'admin', 'superadmin', 'supermaster'].includes(user.rank)) return true;
  const settings = await getSettings();
  const raw = settings[settingKey] !== undefined ? settings[settingKey] : FEATURE_MEMBERSHIP_DEFAULTS[settingKey];
  const allowed = String(raw || '').split(',').map(value => value.trim()).filter(Boolean);
  return allowed.includes(membershipAccessKey(user));
}
// مجموعة الموثقين (شارة ✓ الزرقاء)
let VERIFIED_SET = new Set();
let VERIFIED_EXPIRES = new Map(); // username -> expires_at (لتحديد تجاوز الشهر دون حذف)
// هل تجاوزت الصلاحية (شهر)؟ لا يُحذف شيء تلقائياً — الحذف عبر الإدارة فقط.
function expiredNow(expiresAt) { const e = +expiresAt || 0; return (e > 0 && Math.floor(Date.now() / 1000) > e) ? 1 : 0; }
async function refreshVerified() {
  try {
    const rows = await q.all(`SELECT username, expires_at FROM verified`);
    VERIFIED_SET = new Set(rows.map(r => r.username));
    VERIFIED_EXPIRES = new Map(rows.map(r => [r.username, +r.expires_at || 0]));
  } catch (e) { }
}
refreshVerified();
setTimeout(refreshVerified, 1200);
setInterval(refreshVerified, 15000);
// مجموعة أصحاب الدخول الملكي (شارة 👑 الذهبية + حيوانهم الملكي)
// الحيوان الملكي يختاره العضو عند الطلب: أسد / حوت / عقاب / وحيد قرن
const ROYAL_ANIMALS_DEFAULT = ['lion', 'whale', 'eagle', 'unicorn', 'butterfly', 'kitten', 'redrose', 'openrose', 'pinkrose'];
let ROYAL_ANIMALS = [...ROYAL_ANIMALS_DEFAULT]; // مفاتيح المقبولة (تُحدَّث من جدول royal_animals)
let ROYAL_ANIMALS_FULL = [];                    // القائمة الكاملة (اسم/صورة/صوت/قسم) للواجهة
async function refreshRoyalAnimals() {
  try {
    const rows = await q.all(`SELECT id, key, name, emoji, color, gender, gif, sound FROM royal_animals ORDER BY id`);
    if (rows.length) { ROYAL_ANIMALS_FULL = rows; ROYAL_ANIMALS = rows.map(r => r.key); }
  } catch (e) { }
}
function royalAnimalRow(key) { return ROYAL_ANIMALS_FULL.find(r => r.key === key) || null; }
refreshRoyalAnimals();
setTimeout(refreshRoyalAnimals, 1200);
setInterval(refreshRoyalAnimals, 15000);
const ROYAL_GRANT_DAYS = 30; // مدة التوثيق والدخول الملكي (شهر)
let ROYAL_MAP = new Map(); // username -> animal
let ROYAL_EXPIRES = new Map(); // username -> expires_at
async function refreshRoyal() {
  try {
    const rows = await q.all(`SELECT username, animal, expires_at FROM royal_users`);
    ROYAL_MAP = new Map(rows.map(r => [r.username, r.animal || 'lion']));
    ROYAL_EXPIRES = new Map(rows.map(r => [r.username, +r.expires_at || 0]));
  } catch (e) { }
}
refreshRoyal();
setTimeout(refreshRoyal, 1200);
setInterval(refreshRoyal, 15000);
async function broadcastRoyalState(username) {
  const royal = ROYAL_MAP.has(username) ? 1 : 0;
  const animal = ROYAL_MAP.get(username) || 'lion';
  for (const id of Object.keys(onlineUsers)) {
    if (onlineUsers[id] && onlineUsers[id].username === username) {
      onlineUsers[id].royal = royal;
      onlineUsers[id].royal_animal = animal;
      onlineUsers[id].royal_expired = expiredNow(ROYAL_EXPIRES.get(username));
    }
  }
  await Promise.all(Object.keys(roomUsers).map(rid => emitRoomUsers(rid)));
  io.emit('royal_changed', { username, royal, animal });
}
async function broadcastVerificationState(username) {
  const verified = VERIFIED_SET.has(username) ? 1 : 0;
  for (const id of Object.keys(onlineUsers)) {
    if (onlineUsers[id] && onlineUsers[id].username === username) {
      onlineUsers[id].verified = verified;
      onlineUsers[id].verified_expired = expiredNow(VERIFIED_EXPIRES.get(username));
    }
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
    bio_audio: String(u.bio_audio || ''),
    bio_audio_duration: +u.bio_audio_duration || 0,
    muted: u.muted ? 1 : 0,
    color: String(u.color || ''),
    is_bot: u.is_bot ? 1 : 0,
    broadcast_banned: u.broadcast_banned ? 1 : 0,
    verified: VERIFIED_SET.has(u.username) ? 1 : 0,
    verified_expired: VERIFIED_SET.has(u.username) ? expiredNow(VERIFIED_EXPIRES.get(u.username)) : 0,
    royal: ROYAL_MAP.has(u.username) ? 1 : 0,
    royal_animal: ROYAL_MAP.get(u.username) || '',
    royal_expired: ROYAL_MAP.has(u.username) ? expiredNow(ROYAL_EXPIRES.get(u.username)) : 0
  };
}
function requireUser(req, res, next) {
  const auth = resolveRequestAuth(req);
  if (!auth) return res.status(401).json({ error: 'غير مسجل في هذه الصفحة' });
  req.authUid = +auth.uid;
  req.authRank = auth.rank || 'user';
  req.authIp = normalizeIp(auth.ip || requestIp(req));
  req.chatToken = auth.token || '';
  // حساب مسجل لديه بريد لم يُفعَّل: يبقى «محتاجاً للتفعيل» — لا يعمل أي شيء
  // قبل إدخال رمز التحقق (عبر واجهة الدردشة والـ API معاً)
  const isVerifyPath = req.path === '/api/verify-email' || req.path === '/api/resend-verify';
  if (isVerifyPath) return next();
  q.get(`SELECT registered, email, email_verified, pending_activation FROM users WHERE id=?`, req.authUid).then(u => {
    if (u && u.registered && !u.email_verified && (u.email || u.pending_activation)) {
      return res.status(403).json({ error: 'حسابك غير مفعّل بعد — يجب إدخال رمز التفعيل أولاً' });
    }
    next();
  }).catch(() => next());
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

    // طلبات GET لا تملك جسماً مُحلَّلاً، لذا نقرأ room_id بأمان من كل المصادر.
    const roomId = +((req.body && req.body.room_id) || (req.query && req.query.room_id) || (req.params && req.params.room_id) || 0);
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
function isAlwaysHiddenRank(rank) {
  return String(rank || '') === 'supermaster';
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
  return q.get(`SELECT id,username,ip,device_id,reason FROM bans WHERE ip=? ORDER BY id DESC LIMIT 1`, ip);
}
async function deviceBan(deviceId) {
  deviceId = validDeviceId(deviceId);
  if (!deviceId) return null;
  return q.get(`SELECT id,username,ip,device_id,reason FROM bans WHERE device_id=? ORDER BY id DESC LIMIT 1`, deviceId);
}
async function persistentBanForRequest(req, user = null) {
  if (user && user.banned) {
    const accountBan = await q.get(
      `SELECT id,username,ip,device_id,reason FROM bans WHERE username=? ORDER BY id DESC LIMIT 1`,
      user.username
    );
    return accountBan || { username: user.username, reason: 'حظر الحساب بواسطة الإدارة' };
  }
  const byDevice = await deviceBan(requestDeviceId(req));
  if (byDevice) return byDevice;
  return guestIpBan(validIp(requestIp(req)));
}
function persistentBanPayload(ban) {
  return {
    banned: true,
    persistent: true,
    error: 'تم حظرك بسبب سلوكك السيئ',
    text: 'تم حظرك بسبب سلوكك السيئ',
    reason: String((ban && ban.reason) || 'حظر بواسطة الإدارة').slice(0, 150)
  };
}
function sendPersistentBan(res, ban) {
  return res.status(403).json(persistentBanPayload(ban));
}
async function guestIpMute(ip) {
  if (!ip) return null;
  return q.get(`SELECT id FROM ip_mutes WHERE ip=? LIMIT 1`, ip);
}

// =====================================================
//  كشف النكات: تحديد دولة عنوان IP + تسجيل كل دخول
// =====================================================
// ذاكرة مؤقتة للدول (IP نادراً ما يغيّر دولته) — تمنع استدعاء الخدمة الخارجية لكل دخول.
const IP_GEO_CACHE = new Map();          // ip -> { country, code, at }
const IP_GEO_TTL_MS = 12 * 60 * 60 * 1000;
const IP_GEO_TIMEOUT_MS = Math.max(1000, Number(process.env.IP_GEO_TIMEOUT_MS) || 3500);
const IP_GEO_ENABLED = process.env.IP_GEO_DISABLED !== '1';
const PRIVATE_IP_RE = /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd])/i;

const COUNTRY_AR = {
  JO: 'الأردن', SA: 'السعودية', EG: 'مصر', IQ: 'العراق', PS: 'فلسطين', AE: 'الإمارات',
  KW: 'الكويت', QA: 'قطر', BH: 'البحرين', OM: 'سلطنة عمان', SY: 'سوريا', LB: 'لبنان',
  DZ: 'الجزائر', MA: 'المغرب', TN: 'تونس', LY: 'ليبيا', YE: 'اليمن', SD: 'السودان',
  MR: 'موريتانيا', SO: 'الصومال', DJ: 'جيبوتي', KM: 'جزر القمر', TR: 'تركيا', IR: 'إيران',
  US: 'الولايات المتحدة', GB: 'بريطانيا', DE: 'ألمانيا', FR: 'فرنسا', IT: 'إيطاليا',
  ES: 'إسبانيا', NL: 'هولندا', SE: 'السويد', NO: 'النرويج', DK: 'الدنمارك', CA: 'كندا',
  AU: 'أستراليا', RU: 'روسيا', CN: 'الصين', IN: 'الهند', PK: 'باكستان', ID: 'إندونيسيا',
  MY: 'ماليزيا', BR: 'البرازيل', ZA: 'جنوب أفريقيا', NG: 'نيجيريا', UA: 'أوكرانيا',
  RO: 'رومانيا', PL: 'بولندا', GR: 'اليونان', BE: 'بلجيكا', CH: 'سويسرا', AT: 'النمسا'
};
function countryNameAr(code, fallback = '') {
  const upper = String(code || '').toUpperCase();
  return COUNTRY_AR[upper] || fallback || (upper || 'غير معروف');
}

// يعيد { country, code } لعنوان IP. لا يفشل أبداً — عند تعذر المعرفة يعيد «غير معروف».
async function lookupIpCountry(ip) {
  ip = validIp(ip);
  if (!ip) return { country: 'غير معروف', code: '' };
  if (PRIVATE_IP_RE.test(ip)) return { country: 'شبكة محلية', code: 'LAN' };
  const cached = IP_GEO_CACHE.get(ip);
  if (cached && Date.now() - cached.at < IP_GEO_TTL_MS) return { country: cached.country, code: cached.code };
  if (!IP_GEO_ENABLED) return { country: 'غير معروف', code: '' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IP_GEO_TIMEOUT_MS);
    const response = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode`, { signal: controller.signal });
    clearTimeout(timer);
    const data = await response.json();
    if (data && data.status === 'success') {
      const code = String(data.countryCode || '').toUpperCase();
      const result = { country: countryNameAr(code, String(data.country || '')), code };
      IP_GEO_CACHE.set(ip, { ...result, at: Date.now() });
      return result;
    }
  } catch (error) { /* الشبكة محجوبة أو الخدمة بطيئة — لا يوقف تسجيل الدخول */ }
  const unknown = { country: 'غير معروف', code: '' };
  IP_GEO_CACHE.set(ip, { ...unknown, at: Date.now() });
  return unknown;
}

// يسجّل كل دخول ناجح (عضو أو زائر) مع الوقت وعنوان IP والدولة والجهاز.
async function recordLoginHistory(user, ip, deviceId) {
  try {
    ip = normalizeIp(ip);
    if (!user || !user.id) return;
    const geo = await lookupIpCountry(ip);
    await q.run(
      `INSERT INTO login_history (user_id,username,ip,device_id,country,country_code,registered) VALUES (?,?,?,?,?,?,?)`,
      +user.id, String(user.username || ''), ip, validDeviceId(deviceId), geo.country, geo.code, user.registered ? 1 : 0
    );
    // حد أعلى للسجل لكل حساب (آخر 50 دخول) حتى لا ينمو الجدول بلا حدود.
    await q.run(
      `DELETE FROM login_history WHERE user_id=? AND id NOT IN (SELECT id FROM login_history WHERE user_id=? ORDER BY id DESC LIMIT 50)`,
      +user.id, +user.id
    );
  } catch (error) { /* فشل التسجيل لا يمنع الدخول إطلاقاً */ }
}
async function finishAuthentication(req, res, user, extraPayload = {}) {
  const ip = requestIp(req);
  const deviceId = requestDeviceId(req);
  let fresh = user;
  if (ip) {
    if (!user.registered) {
      const mutedByIp = await guestIpMute(ip);
      await q.run(`UPDATE users SET ip=?, device_id=?, muted=? WHERE id=?`, ip, deviceId, mutedByIp ? 1 : 0, user.id);
    } else {
      await q.run(`UPDATE users SET ip=?, device_id=? WHERE id=?`, ip, deviceId, user.id);
    }
    fresh = await q.get(`SELECT * FROM users WHERE id=?`, user.id);
  }
  // سجل الدخول (اسم + وقت + IP + دولة) يُستخدم في «كشف النكات» — لا ننتظره ولا يعطّل الدخول.
  recordLoginHistory(fresh, ip, deviceId).catch(() => { });
  const payload = { user: pubUser(fresh), badge: badgeOf(fresh), ...extraPayload };
  if (['admin', 'superadmin', 'supermaster'].includes(fresh.rank)) {
    const adminToken = issueAdminToken(fresh, req, res);
    payload.admin_access_token = adminToken;
    payload.admin_url = `/admin?token=${adminToken}`;
  }
  if (req.get('x-chat-client') === '1') {
    const previousToken = chatTokenFromRequest(req);
    if (previousToken) CHAT_TOKENS.delete(previousToken);
    payload.tab_token = issueChatToken(fresh, ip, deviceId);
    return res.json(payload);
  }
  req.session.uid = fresh.id;
  req.session.rank = fresh.rank;
  res.json(payload);
}

// تفحصه الواجهة عند كل تحميل؛ حظر الجهاز يبقى فعالاً عند تبديل IP.
app.get('/api/ban-status', async (req, res) => {
  try {
    const auth = resolveRequestAuth(req);
    const user = auth && auth.uid ? await q.get(`SELECT id,username,banned FROM users WHERE id=?`, auth.uid) : null;
    const ban = await persistentBanForRequest(req, user);
    if (ban) return res.json(persistentBanPayload(ban));
    res.json({ banned: false });
  } catch (error) {
    res.status(500).json({ error: 'تعذر التحقق من حالة الحظر' });
  }
});

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
  const activeBan = await persistentBanForRequest(req, u);
  if (activeBan) return sendPersistentBan(res, activeBan);
  // حساب مسجل لديه بريد غير مُفعَّل: يُدخل بعد إدخال رمز التحقق.
  // الحسابات بلا بريد (قديمة أو فُكّ بريدُها) تدخل مباشرة دون شاشة التحقق.
  await finishAuthentication(req, res, u, (u.registered && !u.email_verified && (u.email || u.pending_activation)) ? { needs_verification: true, email: u.email || '' } : {});
});

app.post('/api/guest', async (req, res) => {
  const ip = requestIp(req);
  const limit = checkRateLimit('guest:' + ip, 15, 60000);
  if (!limit.ok) return res.status(429).json({ error: 'يرجى الانتظار قليلاً قبل الدخول كزائر' });
  let { username, gender } = req.body || {};
  username = String(username || '').trim().slice(0, 20);
  if (!username) return res.status(400).json({ error: 'اكتب اسم المستخدم' });
  const requestBan = await persistentBanForRequest(req);
  if (requestBan) return sendPersistentBan(res, requestBan);

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
  if (u.banned) {
    const userBan = await persistentBanForRequest(req, u);
    return sendPersistentBan(res, userBan);
  }
  await finishAuthentication(req, res, u, renamedFrom ? { guest_name_changed: true, requested_username: renamedFrom } : {});
});

app.post('/api/register', async (req, res) => {
  const ip = requestIp(req);
  const limit = checkRateLimit('reg:' + ip, 6, 300000);
  if (!limit.ok) return res.status(429).json({ error: 'تم تجاوز عدد محاولات التسجيل، يرجى المحاولة لاحقاً' });
  const { username, password, gender, age, country, bio, email } = req.body || {};
  const cleanUsername = String(username || '').trim().slice(0, 20);
  const cleanPassword = String(password || '');
  const cleanBio = String(bio || '').trim().slice(0, 150);
  const cleanEmail = String(email || '').trim().toLowerCase().slice(0, 80);
  if (!cleanUsername || !cleanPassword) return res.status(400).json({ error: 'أكمل الحقول المطلوبة' });
  if (cleanPassword.length < 4) return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 4 خانات' });
  // البريد الإلكتروني (Gmail فقط) إلزامي للتسجيل ويُفعَّل الحساب بعد التحقق
  if (!cleanEmail) return res.status(400).json({ error: 'البريد الإلكتروني إلزامي لإتمام التسجيل' });
  if (!GMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: 'البريد الإلكتروني يجب أن يكون Gmail (ينتهي بـ @gmail.com)' });
  const requestBan = await persistentBanForRequest(req);
  if (requestBan) return sendPersistentBan(res, requestBan);

  // فحص الاسم أولاً: إن كان الاسم مأخوذاً لحساب مسجل مفعَّل نرفض قبل فحص البريد،
  // فلا يُحتسب/يُحجز البريد المُدخَل عند فشل التسجيل (اسم مأخوذ أو كلمة مرور غير كافية).
  // أما حساب غير مفعَّل (لم يُوثَّق بعد) فاسمه وبريده ما زالا «حرين»:
  // يُحرَّر الاسم بإعادة تسمية الحساب المهمل (يبقى محتاجاً للتفعيل ولا يدخل الدردشة).
  let existing = await q.get(`SELECT * FROM users WHERE username=?`, cleanUsername);
  if (existing && existing.registered && !existing.email_verified) {
    let renamed = false;
    for (let t = 0; t < 5 && !renamed; t++) {
      const suffix = existing.username + '_old' + String(1000 + Math.floor(Math.random() * 9000));
      const clash = await q.get(`SELECT id FROM users WHERE username=?`, suffix);
      if (!clash) {
        await q.run(`UPDATE users SET username=?, email='', pending_activation=1 WHERE id=?`, suffix, existing.id);
        renamed = true;
      }
    }
    if (!renamed) return res.status(500).json({ error: 'تعذر تحرير الاسم، حاول مرة أخرى' });
    existing = null;
  }
  if (existing && existing.registered) return res.status(400).json({ error: 'الاسم مستخدم مسبقا' });
  // فريدة البريد (بعد التأكد من توفر الاسم) مع استثناء صف الضيف المُحوَّل نفسه.
  // البريد المرفق بحساب غير مفعَّل يعتبر حراً أيضاً: يُحرَّر من ذلك الحساب (يبقى محتاجاً للتفعيل).
  const emailOwner = await q.get(`SELECT * FROM users WHERE email=? AND id<>?`, cleanEmail, existing ? existing.id : -1);
  if (emailOwner) {
    if (emailOwner.email_verified) return res.status(400).json({ error: 'هذا البريد الإلكتروني مستخدم لحساب آخر — استخدم بريدا آخر' });
    await q.run(`UPDATE users SET email='', pending_activation=1 WHERE id=?`, emailOwner.id);
  }

  const settings = await getSettings();
  const rawGold = settings.register_gold !== undefined && settings.register_gold !== null && String(settings.register_gold).trim() !== ''
    ? Number(settings.register_gold)
    : 10;
  const initialGold = Number.isFinite(rawGold) ? Math.min(100000, Math.max(0, Math.floor(rawGold))) : 10;

  if (existing) {
    // ضيف يحوّل حسابه لمسجل
    const old = existing;
    await q.run(`UPDATE users SET password=?,email=?,email_verified=0,gender=?,age=?,country=?,bio=?,registered=1,balance=balance+? WHERE id=?`,
      bcrypt.hashSync(cleanPassword, 10), cleanEmail, gender || 'secret', Math.min(100, Math.max(10, +age || 25)), String(country || '').slice(0, 30), cleanBio, initialGold, old.id);
    await refreshUserEverywhere(old.id);   // تحديث الاسم/الصورة مباشرة لمن بداخل الغرف
    io.emit('sync');
    const fresh = await q.get(`SELECT * FROM users WHERE id=?`, old.id);
    const issuedOld = await issueVerificationCode(fresh.id, cleanEmail);
    return finishAuthentication(req, res, fresh, { needs_verification: true, email: cleanEmail, verify_sent: issuedOld.sent, verify_reason: issuedOld.reason || '' });
  }
  const r = await q.run(`INSERT INTO users (username,password,email,email_verified,gender,age,country,bio,registered,balance) VALUES (?,?,?,?,?,?,?,?,1,?)`,
    cleanUsername, bcrypt.hashSync(cleanPassword, 10), cleanEmail, 0, gender || 'secret', Math.min(100, Math.max(10, +age || 25)), String(country || '').slice(0, 30), cleanBio, initialGold);
  const u = await q.get(`SELECT * FROM users WHERE id=?`, r.lastID);
  io.emit('sync');
  const issued = await issueVerificationCode(u.id, cleanEmail);
  return finishAuthentication(req, res, u, { needs_verification: true, email: cleanEmail, verify_sent: issued.sent, verify_reason: issued.reason || '' });
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
  const activeBan = await persistentBanForRequest(req, u);
  if (activeBan) return sendPersistentBan(res, activeBan);
  
  // عند عمل رفرش للدردشة، يتم إبطال أي رابط إدارة سابق فوراً!
  if (['admin', 'superadmin', 'supermaster'].includes(u.rank)) {
    invalidateAdminTokens(u.id);
  }

  res.json({ user: { ...pubUser(u), email: u.email || '', email_verified: u.email_verified ? 1 : 0 }, badge: badgeOf(u) });
});

// تفعيل الحساب برمز التحقق (Gmail)
app.post('/api/verify-email', requireUser, async (req, res) => {
  const me = await q.get(`SELECT * FROM users WHERE id=?`, req.authUid);
  if (!me) return res.status(404).json({ error: 'الحساب غير موجود' });
  if (me.registered && me.email_verified) return res.json({ ok: true, already: true, user: pubUser(me), badge: badgeOf(me) });
  const result = await verifyEmailCode(me.id, req.body && req.body.code);
  if (!result.ok) return res.status(400).json({ error: result.error });
  const fresh = await q.get(`SELECT * FROM users WHERE id=?`, me.id);
  io.emit('sync');
  res.json({ ok: true, user: pubUser(fresh), badge: badgeOf(fresh), email: result.email, needs_verification: false });
});

// إعادة إرسال رمز التحقق (مقيدة بسرعة)
app.post('/api/resend-verify', requireUser, async (req, res) => {
  const me = await q.get(`SELECT * FROM users WHERE id=?`, req.authUid);
  if (!me) return res.status(404).json({ error: 'الحساب غير موجود' });
  if (me.registered && me.email_verified) return res.status(400).json({ error: 'حسابك مُفعَّل بالفعل' });
  if (!me.email || !GMAIL_RE.test(me.email)) return res.status(400).json({ error: 'البريد غير صالح — يجب أن يكون Gmail' });
  const rate = await resendVerifyRateOk(me.id);
  if (!rate.ok) return res.status(429).json({ error: `يرجى الانتظار ${rate.wait} ثانية قبل إعادة الإرسال`, wait: rate.wait });
  const issued = await issueVerificationCode(me.id, me.email);
  res.json({ ok: true, sent: issued.sent, reason: issued.reason || '' });
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
  // «منذ آخر رسالة ظاهرة»: عند استعادة اتصال منقطع نجلب فقط الرسائل الأحدث منها
  // (أثناء وجودي بالغرفة وأثناء الانقطاع) — لا الرسائل القديمة كلها.
  const since = Math.max(0, parseInt(req.query.since) || 0);
  const msgs = since > 0
    ? await q.all(`SELECT id, room_id, user_id, username, text, type, extra, created_at FROM messages WHERE room_id=? AND id>? ORDER BY id LIMIT 200`, roomId, since)
    : await q.all(`SELECT id, room_id, user_id, username, text, type, extra, created_at FROM messages WHERE room_id=? ORDER BY id DESC LIMIT 60`, roomId);
  res.json(msgs.reverse());
});

app.get('/api/rooms/:id/users', requireUser, requireRoomNotKicked, async (req, res) => {
  const roomId = +req.params.id;
  const set = roomUsers[roomId];
  if (!set) return res.json([]);
  const roomAdmins = await q.all(`SELECT user_id FROM room_admins WHERE room_id=?`, roomId);
  const roomAdminIds = new Set(roomAdmins.map(ra => +ra.user_id));
  const users = [];
  for (const uid of set) {
    const user = await q.get(`SELECT * FROM users WHERE id=?`, uid);
    if (!user) continue;
    const isGlobalStaff = ['admin', 'superadmin', 'supermaster'].includes(user.rank);
    const isRoomAdminHere = !isGlobalStaff && roomAdminIds.has(+user.id);
    const pub = pubUser(user);
    pub.status = (onlineUsers[uid] || {}).status || user.status;
    if (isRoomAdminHere) {
      pub.rank = 'roomadmin';
      pub.badge = 'roomadmin.png';
    } else if (!isGlobalStaff) {
      pub.rank = user.rank === 'roomadmin' ? 'user' : user.rank;
      pub.badge = badgeOf({ ...user, rank: pub.rank });
    }
    users.push(pub);
  }
  res.json(users);
});

app.get('/api/user/:id', requireUser, async (req, res) => {
  const u = await q.get(`SELECT * FROM users WHERE id=?`, req.params.id);
  if (!u) return res.status(404).json({ error: 'غير موجود' });
  const gifts = await q.all(`SELECT * FROM gifts_log WHERE to_id=? ORDER BY id DESC LIMIT 30`, u.id);
  const pub = pubUser(u);
  // البريد الإلكتروني يظهر في ملف المستخدم نفسه فقط (لتعبئة حقل التحرير)، ولا يصل لأي مستخدم آخر.
  if (req.authUid === +u.id) pub.email = String(u.email || '');
  res.json({ user: pub, badge: badgeOf(u), gifts });
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

// =====================================================
//  التحقق من البريد الإلكتروني (Gmail) عند التسجيل
//  - التسجيل يتطلب بريداً بنهاية @gmail.com فريدًا (لا يُستخدم لحساب آخر).
//  - يُرسل رمز تحقق (6 أرقام) إلى الجيميل، وعند إدخاله صحيحاً يُفعَّل الحساب.
//  - يُدار SMTP من لوحة الإدارة؛ إن لم يُفعَّل يُسجل الرمز في القاعدة فقط
//    (يظهر في سجل البريد للتحقق من الإعدادات).
// =====================================================
const GMAIL_RE = /^[a-z0-9._%+-]+@gmail\.com$/i;
const VERIFY_CODE_TTL_SEC = 10 * 60;      // صلاحية الرمز 10 دقائق
const VERIFY_MAX_ATTEMPTS = 5;            // محاولات الإدخال قبل إصدار رمز جديد
const RESEND_COOLDOWN_SEC = 60;           // بين إعادة الإرسال
const RESEND_MAX_PER_HOUR = 3;

let SMTP_TRANSPORT = null, SMTP_TRANSPORT_SIG = '';
function normalizeSmtpSettings(s) {
  const host = String(s.smtp_host || 'smtp.gmail.com').trim();
  let port = Math.max(1, Math.min(65535, parseInt(s.smtp_port) || 587));
  let secure = String(s.smtp_secure) === '1';
  // تسوية المنفذ مع نوع الاتصال (Gmail: 587 = STARTTLS بدون SSL مباشر، 465 = SSL)
  if (port === 465) secure = true;
  if (port === 587) secure = false;
  const user = String(s.smtp_user || '').trim();
  const pass = String(s.smtp_pass || '').replace(/\s+/g, ''); // كلمات مرور التطبيقات لا تحتوي مسافات
  let from = String(s.smtp_from || '').trim();
  // Gmail يشترط أن يكون عنوان المرسل هو حساب المصادقة — الاسم وحده لا يكفي
  if (from && !from.includes('@')) from = `${from} <${user}>`;
  if (!from) from = user;
  return { host, port, secure, user, pass, from };
}
async function smtpTransport() {
  const s = await getSettings();
  if (String(s.smtp_enabled) !== '1') return null;
  const cfg = normalizeSmtpSettings(s);
  const sig = [cfg.host, cfg.port, cfg.user, cfg.pass, cfg.secure, cfg.from].join('|');
  if (SMTP_TRANSPORT && sig === SMTP_TRANSPORT_SIG) return SMTP_TRANSPORT;
  const nodemailer = require('nodemailer');
  SMTP_TRANSPORT = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined
  });
  SMTP_TRANSPORT_SIG = sig;
  return SMTP_TRANSPORT;
}
async function sendMail(to, subject, html) {
  const s = await getSettings();
  const cfg = normalizeSmtpSettings(s);
  const from = cfg.from;
  const transport = await smtpTransport();
  const log = async (status, error = '') => {
    try { await q.run(`INSERT INTO email_logs (to_email,subject,code,status,error) VALUES (?,?,?,?,?)`, to, subject.slice(0, 120), '', status, String(error || '').slice(0, 300)); } catch (e) { }
  };
  if (!transport) { await log('smtp_disabled', 'SMTP غير مفعّل — لم يُرسل البريد'); return { sent: false, reason: 'smtp_disabled' }; }
  try {
    await transport.sendMail({ from, to, subject, html });
    await log('sent');
    return { sent: true };
  } catch (e) {
    const reason = String((e && e.message) || e || '').slice(0, 300);
    await log('failed', reason);
    return { sent: false, reason };
  }
}
async function issueVerificationCode(userId, email) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const now = Math.floor(Date.now() / 1000);
  await q.run(`INSERT INTO email_verifications (user_id,email,code,expires_at) VALUES (?,?,?,?)`, userId, email, code, now + VERIFY_CODE_TTL_SEC);
  const siteName = (await getSettings()).site_name || 'الدردشة';
  const subject = `رمز تفعيل حسابك في ${siteName}: ${code}`;
  const html = `<div dir="rtl" style="font-family:Arial,Tahoma,sans-serif;background:#f6f7fb;padding:24px"><div style="max-width:520px;margin:auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #e5e7f0"><h2 style="margin:0 0 8px;color:#111827;font-size:19px">تفعيل حسابك</h2><p style="color:#4b5563;font-size:14px;line-height:1.9;margin:0 0 18px">مرحباً! هذا رمز تفعيل حسابك في <b>${siteName}</b>. أدخله لتفعيل حسابك والدخول إلى الدردشة.</p><div style="background:#0f1222;border-radius:14px;padding:18px;text-align:center;margin-bottom:18px"><div style="color:#9ca3c0;font-size:12px;margin-bottom:6px">رمز التفعيل</div><div style="color:#fff;font-size:34px;font-weight:900;letter-spacing:8px;direction:ltr">${code}</div></div><p style="color:#6b7280;font-size:12px;line-height:1.8">الرمز صالح لمدة 10 دقائق. إذا لم تطلب هذا الرمز يمكنك تجاهل هذه الرسالة.</p></div></div>`;
  const res = await sendMail(email, subject, html);
  return { code, sent: res.sent, reason: res.reason || '' };
}
async function verifyEmailCode(userId, codeInput) {
  const code = String(codeInput || '').trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, error: 'الرمز غير صحيح — يجب أن يتكون من 6 أرقام' };
  const v = await q.get(`SELECT * FROM email_verifications WHERE user_id=? AND used_at=0 ORDER BY id DESC LIMIT 1`, userId);
  if (!v) return { ok: false, error: 'لا يوجد رمز تفعيل لهذا الحساب — أعد الإرسال' };
  const now = Math.floor(Date.now() / 1000);
  if (now > +v.expires_at) return { ok: false, error: 'انتهت صلاحية الرمز — أعد الإرسال برمز جديد' };
  if (+v.attempts >= VERIFY_MAX_ATTEMPTS) return { ok: false, error: 'تم تجاوز عدد المحاولات — أعد الإرسال برمز جديد' };
  if (String(v.code) !== code) {
    await q.run(`UPDATE email_verifications SET attempts=attempts+1 WHERE id=?`, v.id);
    const left = VERIFY_MAX_ATTEMPTS - (+v.attempts + 1);
    return { ok: false, error: left > 0 ? `رمز غير صحيح — باقي المحاولات: ${left}` : 'تم تجاوز عدد المحاولات — أعد الإرسال برمز جديد' };
  }
  await q.run(`UPDATE email_verifications SET used_at=? WHERE id=?`, now, v.id);
  await q.run(`UPDATE users SET email_verified=1 WHERE id=?`, userId);
  return { ok: true, email: v.email };
}
async function resendVerifyRateOk(userId) {
  const now = Math.floor(Date.now() / 1000);
  const last = await q.get(`SELECT created_at FROM email_verifications WHERE user_id=? ORDER BY id DESC LIMIT 1`, userId);
  if (last && now - (+last.created_at) < RESEND_COOLDOWN_SEC) return { ok: false, wait: RESEND_COOLDOWN_SEC - (now - +last.created_at) };
  const hourAgo = await q.get(`SELECT COUNT(*) c FROM email_verifications WHERE user_id=? AND created_at>?`, userId, now - 3600);
  if (hourAgo && +hourAgo.c >= RESEND_MAX_PER_HOUR) return { ok: false, wait: 3600 };
  return { ok: true };
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

  // نمط الظهور عند الإرسال: normal (عادية) | royal (ملكية) | auto (تلقائي حسب قيمة الهدية).
  // في نمط auto: الهدية تظهر ملكياً تلقائياً إذا كانت قيمتها ≥ الحد المحدد من لوحة الإدارة.
  const settings = await getSettings();
  const threshold = Math.max(0, parseInt(settings.royal_gift_threshold) || 0);
  let style = gift.style || 'auto';
  if (style === 'auto') {
    style = (threshold > 0 && gift.price >= threshold) ? 'royal' : 'normal';
  }
  if (!['normal', 'royal'].includes(style)) style = 'normal';

  await q.run(`UPDATE users SET balance=balance-? WHERE id=?`, amount, me.id);
  await q.run(`UPDATE users SET balance=balance+? WHERE id=?`, gain, to.id);
  await q.run(`INSERT INTO gifts_log (from_id,from_name,to_id,to_name,gift_name,gift_img,gift_audio,price,qty,usd_value) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    me.id, me.username, to.id, to.username, gift.name, gift.img, gift.audio || '', gift.price, qtyN, gift.usd_value || 0);

  // بث مشهد الهدية (بدون بطاقة رسالة في الدردشة) لكل الموجودين في الغرفة.
  // المتلقي والمرسل وغيرهما يشاهدون المشهد نفسه: عادي = صندوق الهدية، ملكي = مشهد ملكي.
  const celebration = {
    gift_id: gift.id, name: gift.name, img: gift.img, audio: gift.audio || '',
    price: gift.price, payout: gift.payout || 0, qty: qtyN,
    from: me.username, to: to.username, style
  };
  // رسالة الهدية في العام (كما كانت): «قام فلان بإرسال هدية كذا إلى فلان» — تظهر ببطاقة
  // النظام في الدردشة، والمشهد البصري يأتي عبر حدث gift:sent منفصلاً حتى لا يتكرر.
  const gExtra = JSON.stringify({ img: gift.img, audio: gift.audio || '', name: gift.name, qty: qtyN, to: to.username, from: me.username, style });
  if (room_id) {
    const ins = await q.run(`INSERT INTO messages (room_id,user_id,username,text,type,extra) VALUES (?,?,?,?,'gift',?)`,
      room_id, me.id, me.username, `هدية ${gift.name}`, gExtra);
    io.to('room_' + room_id).emit('msg', {
      id: ins.lastID, room_id: +room_id, text: `هدية ${gift.name}`, type: 'gift', created_at: Math.floor(Date.now() / 1000),
      extra: gExtra,
      user: { ...pubUser(me), badge: badgeOf(me) }
    });
    io.to('room_' + room_id).emit('gift:sent', celebration);
  } else {
    io.to('user_' + me.id).emit('gift:sent', celebration);
  }

  const vis = gift.img && !gift.img.startsWith('/') ? gift.img + ' ' : '';
  const toFresh = await q.get(`SELECT balance FROM users WHERE id=?`, to_id);
  const notification = await createUserNotification(to_id, `وصلتك هدية ${vis}${gift.name} من ${me.username} وربحت ${gain} ذهب`, 'gift_fill');
  io.to('user_' + to_id).emit('notify', { ...notification, text: notification.text + ' 🪙', balance: toFresh.balance });
  res.json({ ok: true, balance: me.balance - amount, style });
});

// =====================================================
//  نظام تسكير الهدايا (تحويل ذهب الهدايا إلى دولارات) — للفتيات فقط
//  - الهدايا بقيمها بالذهب فقط (لا يوجد سعر دولار لكل هدية).
//  - الإدارة تحدد: مجموع الذهب المطلوب للتسكير (مثال: 100 ذهب)
//    والمبلغ بالدولار الذي تدفعه عند بلوغه (مثال: 5$) وحساب السحب المصدر.
//  - عند بلوغ الفتاة لمجموع الذهب عبر هداياها المستلمة تستطيع طلب التسكير.
//  - عند اتمام العملية من لوحة الإدارة: تدفع الإدارة المبلغ للمستلمة
//    ثم يُحذف رصيد الهدايا من حسابها نهائياً (تبدأ من جديد).
// =====================================================
async function giftCashoutTotals(userId) {
  const row = await q.get(`SELECT COUNT(*) AS cnt, COALESCE(SUM(price * qty), 0) AS gold FROM gifts_log WHERE to_id=?`, userId);
  return { count: +row.cnt || 0, gold: +row.gold || 0 };
}
async function giftCashoutInfo(me) {
  const settings = await getSettings();
  const enabled = String(settings.cashout_enabled) === '1';
  const goldMin = Math.max(0, parseInt(settings.cashout_gold_min) || 0);
  const usdAmount = Math.max(0, parseFloat(settings.cashout_usd_amount) || 0);
  const totals = await giftCashoutTotals(me.id);
  const gold = totals.gold;
  const pending = await q.get(`SELECT id, usd_amount, gold_total, gifts_count, created_at FROM gift_cashouts WHERE user_id=? AND status='pending'`, me.id);
  const isGirl = me.gender === 'girl';
  // قائمة هداياها (سطراً سطراً) + تجميع الهدايا المتكررة بالنوع للاختيار بالكمية
  const giftRows = await q.all(`SELECT id, gift_name, gift_img, price, qty, created_at FROM gifts_log WHERE to_id=? ORDER BY id`, me.id);
  const groups = {};
  const groupOrder = [];
  for (const row of giftRows) {
    const key = String(row.gift_name || 'هدية') + '|' + (+row.price || 0);
    if (!groups[key]) {
      groups[key] = {
        key,
        name: String(row.gift_name || 'هدية'),
        img: String(row.gift_img || ''),
        price: +row.price || 0,
        qty: 0,
        gold: 0,
        rows: []
      };
      groupOrder.push(key);
    }
    const g = groups[key];
    const rqty = +row.qty || 1;
    g.qty += rqty;
    g.gold += g.price * rqty;
    g.rows.push({ id: +row.id, qty: rqty });
  }
  const gift_groups = groupOrder.map(k => groups[k]);
  return {
    enabled: enabled && isGirl,
    isGirl,
    gold_min: goldMin,
    usd_amount: usdAmount,
    gold_total: gold,
    remaining_gold: Math.max(0, goldMin - gold),
    gifts_count: totals.count,
    gift_groups,
    has_pending: !!pending,
    pending: pending || null,
    eligible: enabled && isGirl && goldMin > 0 && gold >= goldMin && !pending
  };
}

// بيانات التسكير لحسابي (تظهر في صفحة «هدايا حسابي» للفتيات فقط)
app.get('/api/gift-cashout', requireUser, async (req, res) => {
  const me = await q.get(`SELECT * FROM users WHERE id=?`, req.authUid);
  if (!me) return res.status(404).json({ error: 'الحساب غير موجود' });
  res.json(await giftCashoutInfo(me));
});

// إرسال طلب تسكير (تحويل مجموع ذهب الهدايا إلى المبلغ المحدد بالدولار)
app.post('/api/gift-cashout', requireUser, async (req, res) => {
  const me = await q.get(`SELECT * FROM users WHERE id=?`, req.authUid);
  if (!me) return res.status(404).json({ error: 'الحساب غير موجود' });
  const settings = await getSettings();
  if (String(settings.cashout_enabled) !== '1') return res.status(400).json({ error: 'نظام تسكير الهدايا غير مفعّل حالياً' });
  if (me.gender !== 'girl') return res.status(403).json({ error: 'ميزة تسكير الهدايا متاحة للفتيات فقط' });
  if (!me.registered) return res.status(400).json({ error: 'هذه الميزة متاحة للمستخدمين المسجلين فقط' });

  const info = await giftCashoutInfo(me);
  if (info.has_pending) return res.status(400).json({ error: 'لديك طلب تسكير قيد المراجعة حالياً' });
  if (info.gifts_count === 0) return res.status(400).json({ error: 'لا توجد هدايا يمكنك تحويلها' });

  // اختيار الهدايا المراد تسكيها بالكمية (يدعم الهدايا المتكررة: يخصم فقط المطلوب ويبقي الباقي)
  // selection: [{ row_id, qty }] — كل سطر من gifts_log مع الكمية المراد تسكيها منه
  const rawSelection = Array.isArray(req.body.selection) ? req.body.selection : [];
  const byRow = new Map();
  for (const item of rawSelection.slice(0, 500)) {
    const rid = +item.row_id, sqty = +item.qty;
    if (!Number.isInteger(rid) || rid <= 0 || !Number.isInteger(sqty) || sqty <= 0) continue;
    byRow.set(rid, (byRow.get(rid) || 0) + sqty);
  }
  const giftIds = [...byRow.keys()];
  if (!giftIds.length) return res.status(400).json({ error: 'حددي الكمية من الهدايا التي تريدين تسكيرها' });
  const ph = giftIds.map(() => '?').join(',');
  const selectedRows = await q.all(`SELECT id, gift_name, gift_img, price, qty FROM gifts_log WHERE to_id=? AND id IN (${ph})`, me.id, ...giftIds);
  const rowById = new Map(selectedRows.map(r => [+r.id, r]));
  const selection = [];
  let selectedGold = 0;
  let selectedCount = 0;
  for (const [rid, sqty] of byRow) {
    const row = rowById.get(rid);
    if (!row) return res.status(400).json({ error: 'بعض الهدايا المحددة لا تنتمي لحسابك' });
    const take = Math.min(sqty, +row.qty || 1);
    if (take <= 0) continue;
    selection.push({ row_id: rid, qty: take, name: String(row.gift_name || 'هدية'), price: +row.price || 0 });
    selectedGold += take * (+row.price || 0);
    selectedCount += take;
  }
  if (!selection.length) return res.status(400).json({ error: 'حددي كمية صالحة من الهدايا للتسكير' });
  if (selectedGold < info.gold_min) {
    return res.status(400).json({ error: `مجموع ذهب الهدايا المحددة (${selectedGold}) أقل من المجموع المطلوب للتسكير (${info.gold_min}) — حددي كمية أكثر` });
  }

  // المبلغ بالدولار يتناسب طردياً مع الذهب المحدد:
  // usd_amount يقابل gold_min — مثال: 5$ لكل 100 ذهب → 200 ذهب = 10$
  const usdForSelection = info.gold_min > 0
    ? Math.round(selectedGold * info.usd_amount / info.gold_min * 100) / 100
    : 0;

  // التحقق من رقم الحساب المستلم (أرقام فقط، 8-19 خانة مثل أرقام الحسابات والبطاقات البنكية)
  const account_number = String(req.body.account_number || '').replace(/[\s-]/g, '').slice(0, 40);
  const account_name = String(req.body.account_name || '').trim().slice(0, 60) || me.username;
  if (!/^\d{8,19}$/.test(account_number)) {
    return res.status(400).json({ error: 'رقم الحساب غير صحيح — يجب أن يتكون من 8 إلى 19 رقمًا (بدون أحرف)' });
  }

  const ins = await q.run(
    `INSERT INTO gift_cashouts (user_id,username,account_number,account_name,gross_usd,net_usd,gold_total,usd_amount,gifts_count,selected_gift_ids,selection_json,status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending')`,
    me.id, me.username, account_number, account_name,
    0, usdForSelection, selectedGold, usdForSelection, selectedCount, giftIds.join(','), JSON.stringify(selection)
  ); // 12 عمود = 11 قيمة + status ثابت
  await createUserNotification(me.id, `تم إرسال طلب تسكير ${selectedCount} هدية (${selectedGold} ذهب ← $${usdForSelection}) وهو قيد مراجعة الإدارة ⏳`, 'bank_fill');
  notifyAdminAccounts(`💰 طلب تسكير هدايا جديد: ${me.username} — ${selectedCount} هدية (${selectedGold} ذهب) ← $${usdForSelection}`);
  res.json({ ok: true, id: ins.lastID, usd: usdForSelection, gold: selectedGold, count: selectedCount });
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
    WHERE (n.user_id=? OR n.user_id IS NULL)
      AND NOT EXISTS(
        SELECT 1 FROM notification_hides nh
        WHERE nh.notification_id=n.id AND nh.user_id=?
      )
    ORDER BY n.id DESC LIMIT 60`, req.authUid, req.authUid, req.authUid);
  res.json(rows);
});
app.get('/api/notifications/unread-count', requireUser, async (req, res) => {
  const row = await q.get(`
    SELECT COUNT(*) c FROM notifications n
    WHERE (
      (n.user_id=? AND n.read=0)
      OR (n.user_id IS NULL AND NOT EXISTS(
        SELECT 1 FROM notification_reads nr WHERE nr.notification_id=n.id AND nr.user_id=?
      ))
    )
    AND NOT EXISTS(
      SELECT 1 FROM notification_hides nh WHERE nh.notification_id=n.id AND nh.user_id=?
    )`, req.authUid, req.authUid, req.authUid);
  res.json({ count: +row.c || 0 });
});
app.post('/api/notifications/read-all', requireUser, async (req, res) => {
  await q.run(`UPDATE notifications SET read=1 WHERE user_id=?`, req.authUid);
  await q.run(`
    INSERT OR IGNORE INTO notification_reads (notification_id,user_id)
    SELECT n.id,? FROM notifications n
    WHERE n.user_id IS NULL
      AND NOT EXISTS(
        SELECT 1 FROM notification_hides nh WHERE nh.notification_id=n.id AND nh.user_id=?
      )`, req.authUid, req.authUid);
  res.json({ ok: true });
});

app.delete('/api/notifications/clear', requireUser, async (req, res) => {
  await q.run(`DELETE FROM notifications WHERE user_id=?`, req.authUid);
  await q.run(`
    INSERT OR IGNORE INTO notification_reads (notification_id,user_id)
    SELECT id,? FROM notifications WHERE user_id IS NULL`, req.authUid);
  await q.run(`
    INSERT OR IGNORE INTO notification_hides (notification_id,user_id)
    SELECT id,? FROM notifications WHERE user_id IS NULL`, req.authUid);
  res.json({ ok: true });
});

// تعديل الملف الشخصي (النوع/العمر/الدولة/البريد)
app.post('/api/profile', requireUser, async (req, res) => {
  const { gender, age, country, email, bio } = req.body;
  const g = ['boy', 'girl', 'secret'].includes(gender) ? gender : 'secret';
  const a = Math.min(99, Math.max(10, parseInt(age) || 25));
  const me = await q.get(`SELECT registered FROM users WHERE id=?`, req.authUid);
  // الزائر لا يملك بريداً ولا نبذة — نحدّث النوع فقط حتى لا يُضاف بريد فارغ.
  const updateEmail = me && me.registered ? String(email || '').slice(0, 80) : '';
  await q.run(`UPDATE users SET gender=?, age=?, country=?, email=?, bio=? WHERE id=?`,
    g, a, String(country || '').slice(0, 40), updateEmail, String(bio === undefined ? '' : bio).slice(0, 300), req.authUid);
  refreshUserEverywhere(req.authUid);
  res.json({ ok: true });
});

// رفع النبذة الصوتية للملف الشخصي — عضو مسجل فقط.
app.post('/api/profile/audio', requireUser, (req, res) => {
  uploadProfileAudio.single('audio')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: 'يمكن رفع ملف صوتي فقط (حتى 20MB)' });
    try {
      const me = await q.get(`SELECT registered, bio_audio FROM users WHERE id=?`, req.authUid);
      if (!me || !me.registered) return res.status(403).json({ error: 'النطق بالصوت متاح للأعضاء المسجلين فقط' });
      if (!req.file) return res.status(400).json({ error: 'اختر ملفاً صوتياً صالحاً' });
      const audio = '/uploads/profile/' + req.file.filename;
      const duration = Math.max(0, Math.min(120, Math.round(+((req.body && req.body.duration) || 0))));
      // حذف النبذة الصوتية القديمة
      if (me.bio_audio && me.bio_audio.startsWith('/uploads/profile/')) {
        try { fs.unlinkSync(path.join(__dirname, 'public', me.bio_audio)); } catch (e) { }
      }
      await q.run(`UPDATE users SET bio_audio=?, bio_audio_duration=? WHERE id=?`, audio, duration, req.authUid);
      refreshUserEverywhere(req.authUid);
      res.json({ ok: true, audio, duration });
    } catch (e) { res.status(500).json({ error: 'تعذر حفظ النبذة الصوتية' }); }
  });
});

// حذف النبذة الصوتية للملف الشخصي.
app.delete('/api/profile/audio', requireUser, async (req, res) => {
  const me = await q.get(`SELECT bio_audio FROM users WHERE id=?`, req.authUid);
  if (!me || !me.bio_audio) return res.json({ ok: true });
  if (me.bio_audio.startsWith('/uploads/profile/')) {
    try { fs.unlinkSync(path.join(__dirname, 'public', me.bio_audio)); } catch (e) { }
  }
  await q.run(`UPDATE users SET bio_audio='', bio_audio_duration=0 WHERE id=?`, req.authUid);
  refreshUserEverywhere(req.authUid);
  res.json({ ok: true });
});

// حفظ لون الخط المخصص للعضو المسجل (يسري على كل الأجهزة). تجاهل للزوار.
app.post('/api/color', requireUser, async (req, res) => {
  const me = await q.get(`SELECT registered FROM users WHERE id=?`, req.authUid);
  if (!me || !me.registered) return res.status(403).json({ error: 'حفظ لون الخط يتطلب عضوية مسجلة' });
  let color = String(req.body.color || '').trim();
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) return res.status(400).json({ error: 'لون غير صالح' });
  await q.run(`UPDATE users SET color=? WHERE id=?`, color, req.authUid);
  refreshUserEverywhere(req.authUid);
  res.json({ ok: true, color });
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

// ===== الدخول الملكي: معلومات + طلب =====
app.get('/api/royal-info', requireUser, async (req, res) => {
  const settings = await getSettings();
  const price = normalizeNonNegativeCost(settings.royal_entry_cost, 50);
  const me = await q.get(`SELECT * FROM users WHERE id=?`, req.authUid);
  const pending = me ? await q.get(`SELECT id, plan FROM service_requests WHERE user_id=? AND request_type='royal' AND status='pending'`, me.id) : null;
  const pendingChange = me ? await q.get(`SELECT id, plan FROM service_requests WHERE user_id=? AND request_type='royal_change' AND status='pending'`, me.id) : null;
  const expires = me ? (await q.get(`SELECT expires_at FROM royal_users WHERE username=?`, me.username)) : null;
  res.json({
    ok: true, price,
    animals: ROYAL_ANIMALS,
    isRoyal: me ? ROYAL_MAP.has(me.username) : false,
    animal: me ? (ROYAL_MAP.get(me.username) || '') : '',
    expires_at: expires && (+expires.expires_at || 0) > 0 ? +expires.expires_at : 0,
    hasPending: !!pending,
    pendingAnimal: pending ? (pending.plan || 'lion') : '',
    hasPendingChange: !!pendingChange,
    pendingChangeAnimal: pendingChange ? (pendingChange.plan || 'lion') : ''
  });
});
app.post('/api/royal-request', requireUser, async (req, res) => {
  const me = await q.get(`SELECT * FROM users WHERE id=?`, req.authUid);
  if (!me || !me.registered) return res.status(403).json({ error: 'يتطلب عضوية مسجلة' });
  if (ROYAL_MAP.has(me.username)) return res.status(400).json({ error: 'لديك الدخول الملكي بالفعل 👑' });
  const duplicate = await q.get(`SELECT id FROM service_requests WHERE user_id=? AND request_type='royal' AND status='pending'`, me.id);
  if (duplicate) return res.status(400).json({ error: 'لديك طلب دخول ملكي قيد المراجعة بالفعل' });
  const animal = ROYAL_ANIMALS.includes(String((req.body || {}).animal)) ? String(req.body.animal) : 'lion';
  const settings = await getSettings();
  const price = normalizeNonNegativeCost(settings.royal_entry_cost, 50);
  const out = await q.run(`
    INSERT INTO service_requests (user_id,username,target_id,target_name,request_type,plan,suggested_gold)
    VALUES (?,?,?,?,'royal',?,?)`, me.id, me.username, me.id, me.username, animal, price);
  await notifyAdminAccounts(`طلب دخول ملكي جديد من المستخدم ${me.username} — الحيوان الملكي: ${animal} (التكلفة: ${price} ذهب)`);
  res.json({ ok: true, requested: true, request_id: out.lastID, price, animal });
});

// طلب تغيير الحيوان الملكي — لصاحب الدخول الملكي فقط، يصل للإدارة وتوافق أو ترفض.
app.post('/api/royal-change-request', requireUser, async (req, res) => {
  const me = await q.get(`SELECT * FROM users WHERE id=?`, req.authUid);
  if (!me || !me.registered) return res.status(403).json({ error: 'يتطلب عضوية مسجلة' });
  if (!ROYAL_MAP.has(me.username)) return res.status(400).json({ error: 'لا تملك الدخول الملكي — اطلب الحصول عليه أولاً 👑' });
  const animal = ROYAL_ANIMALS.includes(String((req.body || {}).animal)) ? String(req.body.animal) : 'lion';
  if (animal === (ROYAL_MAP.get(me.username) || 'lion'))
    return res.status(400).json({ error: 'هذا هو حيوانك الملكي الحالي — اختر حيواناً آخر لتغييره' });
  const duplicate = await q.get(`SELECT id FROM service_requests WHERE user_id=? AND request_type='royal_change' AND status='pending'`, me.id);
  if (duplicate) return res.status(400).json({ error: 'لديك طلب تغيير الدخول الملكي قيد المراجعة بالفعل' });
  const settings = await getSettings();
  const price = Math.max(0, parseInt(settings.royal_change_cost) || 0);
  const out = await q.run(`
    INSERT INTO service_requests (user_id,username,target_id,target_name,request_type,plan,suggested_gold)
    VALUES (?,?,?,?,'royal_change',?,?)`, me.id, me.username, me.id, me.username, animal, price);
  await notifyAdminAccounts(`👑 طلب تغيير الحيوان الملكي من ${me.username} إلى ${animal} (التكلفة: ${price} ذهب)`);
  res.json({ ok: true, requested: true, request_id: out.lastID, animal, suggested_gold: price });
});

// =====================================================
//  باقات شراء الذهب والدفع ببطاقة الصراف الآلي والبطاقات البنكية
// =====================================================
app.get('/api/gold-packages', async (req, res) => {
  try {
    const packages = await q.all(`SELECT * FROM gold_packages WHERE active=1 ORDER BY sort ASC, id ASC`);
    const settings = await getSettings();
    // PayPal بوابة الدفع الفعلية (بطاقات/حساب PayPal). نكشف للواجهة فقط client_id
    // (العام) دون secret، والواجهة تحمّل زر PayPal وتنشئ العملية عبر الخادم.
    res.json({
      ok: true,
      packages: packages || [],
      currency: settings.paypal_currency || 'USD',
      merchant_bank: settings.merchant_bank_name || 'البنك التجاري المعتمد',
      merchant_holder: settings.merchant_holder_name || 'إدارة الدردشة المعتمدة',
      card_payment_enabled: false, // أُلغيت خاصية الدفع بالبطاقة (غير حقيقية) نهائياً
      paypal_enabled: settings.paypal_enabled !== '0',
      paypal_client_id: settings.paypal_client_id || '',
      paypal_mode: settings.paypal_mode || 'live',
      paypal_currency: settings.paypal_currency || 'USD'
    });
  } catch (e) {
    res.status(500).json({ error: 'تعذر جلب باقات الشراء' });
  }
});

//  بوابة الدفع الفعلية عبر PayPal (Orders API v2)
//  — خصم حقيقي وموثّق من حساب/بطاقة المشتري عبر PayPal،
//  ويُشحن الذهب فقط بعد تأكيد إتمام الدفع من PayPal.
// =====================================================
function paypalApiBase(mode) {
  return mode === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
}

// الحصول على توكن وصول OAuth2 من PayPal بصيغة Client Credentials.
async function paypalAccessToken(clientId, secret, mode) {
  const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${paypalApiBase(mode)}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: 'grant_type=client_credentials',
      signal: controller.signal
    });
    clearTimeout(timer);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      const msg = data.error_description || data.error || 'تعذر الاتصال بـ PayPal';
      console.error(`[paypal] فشل جلب OAuth token (${mode}): status=${res.status} body=${JSON.stringify(data).slice(0, 400)}`);
      const err = new Error(msg);
      err.httpStatus = res.status;
      err.raw = data;
      throw err;
    }
    return data.access_token;
  } catch (e) { clearTimeout(timer); console.error('[paypal] OAuth token exception:', e.message || e); throw e; }
}

// إنشاء عملية دفع PayPal (Capture intent) وإرجاع الرابط/المعرّف.
async function paypalCreateOrder(accessToken, amount, currency, mode, userInfo) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${paypalApiBase(mode)}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: currency, value: Number(amount).toFixed(2) },
          description: userInfo.description || 'شحن رصيد ذهب — نجوم العرب'
        }],
        application_context: {
          brand_name: userInfo.brand_name || 'نجوم العرب',
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING'
        }
      }),
      signal: controller.signal
    });
    clearTimeout(timer);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) {
      const msg = (data.details && data.details[0] && data.details[0].description) || data.message || 'تعذر إنشاء طلب الدفع';
      console.error(`[paypal] فشل إنشاء order (${mode}): status=${res.status} body=${JSON.stringify(data).slice(0, 500)}`);
      const err = new Error(msg);
      err.httpStatus = res.status;
      err.raw = data;
      throw err;
    }
    return data;
  } catch (e) { clearTimeout(timer); console.error('[paypal] createOrder exception:', e.message || e); throw e; }
}

// تأكيد (Capturing) عملية دفع بعد موافقة المشتري — يتحقق PayPal فعلياً من الخصم.
async function paypalCaptureOrder(accessToken, orderId, mode) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${paypalApiBase(mode)}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      signal: controller.signal
    });
    clearTimeout(timer);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status !== 'COMPLETED') {
      const msg = (data.details && data.details[0] && data.details[0].description) ||
        (data.name === 'ORDER_ALREADY_CAPTURED' ? 'تم تأكيد هذه العملية من قبل' : data.message) ||
        'لم يكتمل الدفع من PayPal';
      console.error(`[paypal] فشل capture order (${mode}): status=${res.status} body=${JSON.stringify(data).slice(0, 500)}`);
      const err = new Error(msg);
      err.httpStatus = res.status;
      err.raw = data;
      throw err;
    }
    return data;
  } catch (e) { clearTimeout(timer); console.error('[paypal] captureOrder exception:', e.message || e); throw e; }
}

// هل اكتمل الدفع وأُضيف رصيد؟ نتحقق من رمز internal لإرجاع معلومات جاهزة.
function paymentCaptureInfo(captured) {
  const unit = captured && captured.purchase_units && captured.purchase_units[0] || {};
  const pay = unit.payments && unit.payments.captures && unit.payments.captures[0] || {};
  return {
    orderId: captured.id || '',
    captureId: pay.id || '',
    status: captured.status || '',
    amount: pay.amount && pay.amount.value || '0',
    currency: pay.amount && pay.amount.currency_code || ''
  };
}

// إرجاع الحالة العامة لتشفير/إخفاء المفتاح السري في الواجهة.
async function paypalPublicConfig() {
  const s = await getSettings();
  return {
    paypal_enabled: s.paypal_enabled !== '0',
    paypal_client_id: s.paypal_client_id || '',
    paypal_mode: s.paypal_mode || 'live',
    paypal_currency: s.paypal_currency || 'USD'
  };
}

// إعدادات PayPal للعموم (client_id العام فقط — لا يُكشف secret أبداً).
app.get('/api/paypal/config', async (req, res) => {
  const cfg = await paypalPublicConfig();
  res.json({ ok: true, ...cfg });
});

// إنشاء عملية دفع PayPal (يستدعيها زر الدفع في الواجهة).
app.post('/api/paypal/create-order', requireUser, async (req, res) => {
  try {
    const me = await q.get(`SELECT id, username FROM users WHERE id=?`, req.authUid);
    if (!me) return res.status(401).json({ error: 'المستخدم غير مسجل' });
    const s = await getSettings();
    if (s.paypal_enabled === '0') return res.status(400).json({ error: 'خدمة الدفع عبر PayPal متوقفة حالياً' });
    if (!s.paypal_client_id || !s.paypal_secret) return res.status(400).json({ error: 'لم يتم إعداد مفاتيح PayPal في لوحة الإدارة' });

    const pkgId = +(req.body && req.body.package_id);
    const pkg = await q.get(`SELECT * FROM gold_packages WHERE id=? AND active=1`, pkgId);
    if (!pkg) return res.status(400).json({ error: 'باقة الذهب المختارة غير متوفرة' });

    const amount = +pkg.price || 0;
    if (amount <= 0) return res.status(400).json({ error: 'قيمة الباقة غير صالحة' });
    // عملة مصدرة بثلاثة أحرف فقط (مثل USD)؛ وإلا نستبدلها بعملة الإعداد.
    const rawCurrency = String(pkg.currency || '').toUpperCase();
    const currency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : String(s.paypal_currency || 'USD').toUpperCase();

    const token = await paypalAccessToken(s.paypal_client_id, s.paypal_secret, s.paypal_mode || 'live');
    const order = await paypalCreateOrder(token, amount, currency, s.paypal_mode || 'live', {
      brand_name: s.site_name || 'نجوم العرب',
      description: `شحن ${pkg.gold} ذهب + ${pkg.bonus || 0} هدية (باقة ${pkg.name})`
    });

    res.json({ ok: true, order_id: order.id, approve_url: order.links && order.links.find(l => l.rel === 'approve') && order.links.find(l => l.rel === 'approve').href || null });
  } catch (err) {
    const status = err && err.httpStatus ? ` (HTTP ${err.httpStatus})` : '';
    res.status(500).json({ error: 'تعذر إنشاء الدفع عبر PayPal: ' + (err.message || 'خطأ') + status });
  }
});

// تأكيد الدفع بعد موافقة المشتري في PayPal ثم شحن الذهب فعلياً.
app.post('/api/paypal/capture-order', requireUser, async (req, res) => {
  try {
    const me = await q.get(`SELECT * FROM users WHERE id=?`, req.authUid);
    if (!me) return res.status(401).json({ error: 'المستخدم غير مسجل' });
    const s = await getSettings();
    if (s.paypal_enabled === '0') return res.status(400).json({ error: 'خدمة الدفع عبر PayPal متوقفة حالياً' });
    if (!s.paypal_client_id || !s.paypal_secret) return res.status(400).json({ error: 'لم يتم إعداد مفاتيح PayPal' });

    const orderId = String((req.body && req.body.order_id) || '').trim();
    if (!orderId) return res.status(400).json({ error: 'معرّف العملية مفقود' });
    const pkgId = +(req.body && req.body.package_id);
    const pkg = await q.get(`SELECT * FROM gold_packages WHERE id=? AND active=1`, pkgId);
    if (!pkg) return res.status(400).json({ error: 'باقة الذهب غير متوفرة' });

    // منع تكرار شحن العملية نفسها (idempotency).
    const already = await q.get(`SELECT id FROM payment_transactions WHERE order_ref=? AND status='completed'`, orderId);
    if (already) {
      const bal = await q.get(`SELECT balance FROM users WHERE id=?`, me.id);
      const nb = bal ? bal.balance : me.balance;
      return res.json({ ok: true, balance: nb, total_gold: (+pkg.gold || 0) + (+pkg.bonus || 0), already_processed: true });
    }

    const token = await paypalAccessToken(s.paypal_client_id, s.paypal_secret, s.paypal_mode || 'live');
    const captured = await paypalCaptureOrder(token, orderId, s.paypal_mode || 'live');
    const cap = paymentCaptureInfo(captured);
    const amountPaid = +pkg.price || 0;
    const bonusGold = +pkg.bonus || 0;
    const totalGold = (+pkg.gold || 0) + bonusGold;
    const currency = cap.currency || (pkg.currency || s.paypal_currency || 'USD');

    // التحقق من أن المبلغ المخصوم يطابق سعر الباقة (حماية من التلاعب).
    const capturedVal = parseFloat(cap.amount);
    const expectedVal = parseFloat(amountPaid);
    if (Math.abs(capturedVal - expectedVal) > 0.005) {
      await q.run(`INSERT INTO payment_transactions (user_id, username, package_id, package_name, gold_amount, bonus_amount, total_gold, amount_paid, currency, card_last4, card_brand, card_holder, deposit_card, status, order_ref)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, me.id, me.username, pkg.id, pkg.name, pkg.gold, bonusGold, totalGold, amountPaid, currency, '', 'PayPal', '', '', 'amount_mismatch', orderId).catch(() => {});
      return res.status(400).json({ error: 'المبلغ المدفوع لا يطابق سعر الباقة' });
    }

    await q.run(`UPDATE users SET balance=balance+? WHERE id=?`, totalGold, me.id);
    const newBal = (me.balance || 0) + totalGold;
    if (onlineUsers[me.id]) onlineUsers[me.id].balance = newBal;

    const tx = await q.run(`INSERT INTO payment_transactions
      (user_id, username, package_id, package_name, gold_amount, bonus_amount, total_gold, amount_paid, currency, card_last4, card_brand, card_holder, deposit_card, status, order_ref)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      me.id, me.username, pkg.id, pkg.name, pkg.gold, bonusGold, totalGold, amountPaid, currency, '', 'PayPal', '', '', 'completed', orderId);

    const notif = await createUserNotification(me.id,
      `تم شحن ${totalGold} ذهب بنجاح عبر PayPal بقيمة ${amountPaid} ${currency} (الرصيد: ${newBal}) 🪙`, 'creditcard_fill');
    io.to('user_' + me.id).emit('notify', { ...notif, balance: newBal });
    io.to('user_' + me.id).emit('call:gold_deducted', { balance: newBal, amount: amountPaid, isPayment: true });

    const adminRows = await q.all(`SELECT id FROM users WHERE rank IN ('admin','superadmin','supermaster')`);
    for (const adm of adminRows) {
      io.to('user_' + adm.id).emit('notify', { text: `عملية شراء ناجحة: ${me.username} شحن ${totalGold} ذهب بمبلغ ${amountPaid} ${currency} عبر PayPal 💳`, icon: 'creditcard_fill' });
    }

    res.json({ ok: true, balance: newBal, total_gold: totalGold, package_name: pkg.name, amount_paid: amountPaid, currency, transaction_id: tx.lastID, capture_id: cap.captureId });
  } catch (err) {
    const status = err && err.httpStatus ? ` (HTTP ${err.httpStatus})` : '';
    res.status(500).json({ error: 'تعذر تأكيد الدفع عبر PayPal: ' + (err.message || 'خطأ') + status });
  }
});

// مساران قديمان تمت إزالتهما: الدفع بالبطاقة كان غير حقيقي ويُسلِّم ذهباً بلا خصم،
// وشراء الذهب الافتراضي يُضيف رصيداً بلا دفع. كلاهما أُلغي نهائياً.
app.post('/api/pay-with-card', requireUser, async (req, res) => {
  return res.status(400).json({ error: 'الدفع بالبطاقة البنكية أُلغي واستُبدل ببوابة PayPal الآمنة' });
});
app.post('/api/buy-gold', requireUser, async (req, res) => {
  return res.status(400).json({ error: 'شراء الذهب الافتراضي المجاني أُلغي — استخدم PayPal للدفع الفعلي' });
});

// الشكاوى
app.post('/api/complaint', requireUser, async (req, res) => {
  const { subject, message, targetId, image } = req.body || {};
  const u = await q.get(`SELECT username, registered FROM users WHERE id=?`, req.authUid);
  if (!u) return res.status(404).json({ error: 'الحساب غير موجود' });
  // الإبلاغ من الملف الشخصي متاح للأعضاء المسجلين فقط
  const targetIdN = +(targetId) || 0;
  if (targetIdN && !u.registered) return res.status(403).json({ error: 'الإبلاغ متاح للأعضاء المسجلين فقط' });
  let targetName = '';
  if (targetIdN) {
    const t = await q.get(`SELECT username FROM users WHERE id=?`, targetIdN);
    if (t) targetName = t.username;
  }
  // صورة الدليل المرفقة (مسار مرفوع فقط)
  const imagePath = String(image || '').startsWith('/uploads/') ? String(image).slice(0, 300) : '';
  await q.run(`INSERT INTO complaints (user_id,username,subject,message,target_id,target_name,image) VALUES (?,?,?,?,?,?,?)`,
    req.authUid, u.username, subject || '', message || '', targetIdN, targetName, imagePath);
  res.json({ ok: true });
});

// ===== استعادة كلمة المرور (حسابات مسجلة) — رمز 6 أرقام عبر البريد =====
const RESET_CODE_TTL_SEC = 10 * 60;        // صلاحية رمز الاستعادة 10 دقائق
const RESET_MAX_ATTEMPTS = 5;              // محاولات الإدخال قبل إصدار رمز جديد
const RESET_RESEND_COOLDOWN_SEC = 60;      // انتظار بين إعادة الإرسال
async function issueResetCode(userId, email) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const now = Math.floor(Date.now() / 1000);
  await q.run(`INSERT INTO password_resets (user_id,email,code,expires_at) VALUES (?,?,?,?)`, userId, email, code, now + RESET_CODE_TTL_SEC);
  const siteName = (await getSettings()).site_name || 'الدردشة';
  const subject = `رمز استعادة كلمة المرور في ${siteName}: ${code}`;
  const html = `<div dir="rtl" style="font-family:Arial,Tahoma,sans-serif;background:#f6f7fb;padding:24px"><div style="max-width:520px;margin:auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #e5e7f0"><h2 style="margin:0 0 8px;color:#111827;font-size:19px">استعادة كلمة المرور</h2><p style="color:#4b5563;font-size:14px;line-height:1.9;margin:0 0 18px">مرحباً! هذا رمز استعادة كلمة المرور لحسابك في <b>${siteName}</b>. أدخله مع كلمة المرور الجديدة لتغييرها.</p><div style="background:#0f1222;border-radius:14px;padding:18px;text-align:center;margin-bottom:18px"><div style="color:#9ca3c0;font-size:12px;margin-bottom:6px">رمز الاستعادة</div><div style="color:#fff;font-size:34px;font-weight:900;letter-spacing:8px;direction:ltr">${code}</div></div><p style="color:#6b7280;font-size:12px;line-height:1.8">الرمز صالح لمدة 10 دقائق. إذا لم تطلب هذا الرمز يمكنك تجاهل هذه الرسالة.</p></div></div>`;
  const res = await sendMail(email, subject, html);
  return { code, sent: res.sent, reason: res.reason || '' };
}
app.post('/api/forgot-password', async (req, res) => {
  const ip = requestIp(req);
  const limit = checkRateLimit('forgot:' + ip, 5, 15 * 60 * 1000);
  if (!limit.ok) return res.status(429).json({ error: 'محاولات كثيرة — حاول بعد 15 دقيقة' });
  const email = String((req.body || {}).email || '').trim().toLowerCase().slice(0, 80);
  if (!email) return res.status(400).json({ error: 'أدخل البريد الإلكتروني' });
  const u = await q.get(`SELECT id FROM users WHERE email=? AND registered=1 AND password IS NOT NULL AND password<>''`, email);
  if (!u) return res.status(404).json({ error: 'لا يوجد حساب مسجل بهذا البريد' });
  // تقييد إعادة الإرسال
  const now = Math.floor(Date.now() / 1000);
  const last = await q.get(`SELECT created_at FROM password_resets WHERE user_id=? ORDER BY id DESC LIMIT 1`, u.id);
  if (last && now - (+last.created_at) < RESET_RESEND_COOLDOWN_SEC) {
    return res.status(429).json({ error: 'تم إرسال الرمز مؤخراً — انتظر ' + (RESET_RESEND_COOLDOWN_SEC - (now - +last.created_at)) + ' ثانية' });
  }
  const r = await issueResetCode(u.id, email);
  if (!r.sent) return res.status(502).json({ error: 'تعذر إرسال البريد: ' + (r.reason || 'خدمة البريد غير مفعلة') });
  res.json({ ok: true });
});
app.post('/api/reset-password', async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase().slice(0, 80);
  const code = String((req.body || {}).code || '').trim();
  const newPassword = String((req.body || {}).newPassword || '');
  if (!email || !code) return res.status(400).json({ error: 'أكمل الحقول المطلوبة' });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'الرمز يجب أن يتكون من 6 أرقام' });
  if (newPassword.length < 4) return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن لا تقل عن 4 خانات' });
  const u = await q.get(`SELECT id FROM users WHERE email=? AND registered=1`, email);
  if (!u) return res.status(404).json({ error: 'لا يوجد حساب مسجل بهذا البريد' });
  const v = await q.get(`SELECT * FROM password_resets WHERE user_id=? AND used_at=0 ORDER BY id DESC LIMIT 1`, u.id);
  if (!v) return res.status(400).json({ error: 'لا يوجد رمز استعادة — أرسل الرمز من جديد' });
  const now = Math.floor(Date.now() / 1000);
  if (now > +v.expires_at) return res.status(400).json({ error: 'انتهت صلاحية الرمز — أعد الإرسال برمز جديد' });
  if (+v.attempts >= RESET_MAX_ATTEMPTS) return res.status(400).json({ error: 'تم تجاوز عدد المحاولات — أعد الإرسال برمز جديد' });
  if (String(v.code) !== code) {
    await q.run(`UPDATE password_resets SET attempts=attempts+1 WHERE id=?`, v.id);
    const left = RESET_MAX_ATTEMPTS - (+v.attempts + 1);
    return res.status(400).json({ error: left > 0 ? `رمز غير صحيح — باقي المحاولات: ${left}` : 'تم تجاوز عدد المحاولات — أعد الإرسال برمز جديد' });
  }
  await q.run(`UPDATE password_resets SET used_at=? WHERE id=?`, now, v.id);
  await q.run(`UPDATE users SET password=? WHERE id=?`, bcrypt.hashSync(newPassword, 10), u.id);
  res.json({ ok: true });
});

// =====================================================
//  API - لوحة التحكم
// =====================================================
app.get('/api/admin/heartbeat', requireAdmin, (req, res) => {
  res.json({ ok: true, active_in_chat: isUserActiveInChat(req.adminAuth.uid), uid: req.adminAuth.uid, rank: req.adminAuth.rank });
});

app.get('/api/admin/settings', requireAdmin, async (req, res) => res.json(await getSettings()));

app.post('/api/admin/settings', requireSuperAdmin, async (req, res) => {
  const entries = Object.entries(req.body);
  const savedValues = {};
  for (const [k, v] of entries) {
    let storedValue = String(v);
    if (k === 'public_message_cooldown_seconds') storedValue = String(normalizePublicMessageCooldownSeconds(v));
    if (k === 'msg_max') storedValue = String(normalizePublicMessageMaxLength(v));
    if (k === 'public_message_spacing_px') storedValue = String(normalizePublicMessageSpacing(v));
    if (k === 'public_message_name_size_px') storedValue = String(normalizePublicMessageNameSize(v));
    if (k === 'public_message_body_width') storedValue = normalizePublicMessageBodyWidth(v);
    if (PUBLIC_MESSAGE_BADGE_SETTING_KEYS.includes(k)) storedValue = String(normalizePublicMessageBadgeSize(v));
    await q.run(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, storedValue);
    savedValues[k] = storedValue;
  }
  if (req.body.hidden_super !== undefined && String(req.body.hidden_super) !== '1') await revealHiddenAdmins();
  if (req.body.public_message_cooldown_seconds !== undefined || req.body.msg_max !== undefined) await refreshPublicMessageRules();
  // (بوابة الحماية أُلغيت — لا حظر على VPN/بروكسي/متصفحات)
  reloadBots();      // قد يكون تبديل «تفعيل الروبوت» تغيّر

  // هذه المفاتيح تصل فوراً لكل صفحات الدردشة المفتوحة قبل المزامنة العامة.
  const liveSettingKeys = new Set([
    'show_smiles', 'show_voice', 'show_image', 'hidden_super', 'wave_enabled',
    'snd_join', 'snd_msg', 'snd_leave', 'snd_join_url', 'snd_msg_url', 'snd_leave_url', 'show_time', 'msg_max',
    'public_message_cooldown_seconds', 'public_message_spacing_px',
    'public_message_name_size_px', 'public_message_body_width',
    ...PUBLIC_MESSAGE_BADGE_SETTING_KEYS
  ]);
  const liveChanges = {};
  for (const [key, value] of Object.entries(savedValues)) {
    if (liveSettingKeys.has(key)) liveChanges[key] = value;
  }
  if (Object.keys(liveChanges).length) io.emit('settings_changed', liveChanges);
  io.emit('sync');   // تطبيق فوري على صفحات الدردشة
  if (req.body.default_language) {
    io.emit('language_changed', { default_language: String(req.body.default_language) });
  }
  res.json({ ok: true });
});

// ---- إدارة الهدايا (رفع صورة + قيمة + ربح المستقبل + نمط الظهور) ----
app.get('/api/admin/gifts', requireSuperAdmin, async (req, res) => res.json(await q.all(`SELECT * FROM gifts ORDER BY id DESC`)));
app.post('/api/admin/gifts', requireSuperAdmin, async (req, res) => {
  const { id, name, img, audio, price, payout, cat, style } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'اكتب اسم الهدية' });
  if (!img) return res.status(400).json({ error: 'ارفع صورة الهدية أولاً' });
  const n = String(name).slice(0, 40).trim();
  const im = String(img).slice(0, 150), au = String(audio || '').slice(0, 150), ct = String(cat || 'افتراضي').slice(0, 20);
  const st = ['normal', 'royal', 'auto'].includes(style) ? style : 'auto';
  const pr = Math.min(100000, Math.max(0, parseInt(price) || 0));
  const py = Math.min(pr, Math.max(0, parseInt(payout) || 0));
  if (id) await q.run(`UPDATE gifts SET name=?, img=?, audio=?, price=?, payout=?, cat=?, usd_value=?, style=? WHERE id=?`, n, im, au, pr, py, ct, Math.max(0, parseFloat(req.body.usd_value) || 0), st, +id);
  else await q.run(`INSERT INTO gifts (name,img,audio,price,payout,cat,usd_value,style) VALUES (?,?,?,?,?,?,?,?)`, n, im, au, pr, py, ct, Math.max(0, parseFloat(req.body.usd_value) || 0), st);
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
// رفع صوت إشعار (دخول/رسالة/خروج) من لوحة الإدارة
app.post('/api/admin/upload/sound', requireSuperAdmin, (req, res) => {
  uploadSound.single('file')(req, res, (err) => {
    if (err || !req.file) return res.status(500).json({ error: 'تعذر رفع الصوت: ' + (err ? err.message : 'لا يوجد ملف') });
    res.json({ ok: true, path: '/uploads/sounds/' + req.file.filename });
  });
});

// ---- نظام تسكير الهدايا (إدارة) ----
app.get('/api/admin/gift-cashouts', requireSuperAdmin, async (req, res) => {
  const list = await q.all(`
    SELECT gc.*, u.gender, u.registered, u.avatar FROM gift_cashouts gc
    LEFT JOIN users u ON u.id = gc.user_id
    ORDER BY (gc.status = 'pending') DESC, gc.created_at DESC
  `);
  const settings = await getSettings();
  res.json({
    list,
    settings: {
      enabled: String(settings.cashout_enabled) === '1',
      gold_min: Math.max(0, parseInt(settings.cashout_gold_min) || 0),
      usd_amount: Math.max(0, parseFloat(settings.cashout_usd_amount) || 0),
      source_account: String(settings.cashout_source_account || '')
    }
  });
});

// اتمام طلب التسكير: تحويل المبلغ (يدوياً من حساب الإدارة) ثم حذف هدايا المستلمة من حسابها
app.post('/api/admin/gift-cashout/:id/complete', requireSuperAdmin, async (req, res) => {
  const id = +req.params.id;
  const request = await q.get(`SELECT * FROM gift_cashouts WHERE id=? AND status='pending'`, id);
  if (!request) return res.status(404).json({ error: 'الطلب غير موجود أو تمت معالجته' });
  const admin = await q.get(`SELECT id, username FROM users WHERE id=?`, req.session.uid);

  // خصم الهدايا المحددة فقط (بالكمية) من حساب صاحبة الهدايا — بقية الهدايا المتكررة تبقى عندها
  let deleted = 0;
  let selection = [];
  try { selection = JSON.parse(request.selection_json || '[]'); } catch (e) { selection = []; }
  if (Array.isArray(selection) && selection.length) {
    // خصم جزئي داخل معاملة لضمان السلامة: إن انتهت كمية السطر يُحذف، وإن بقي منه شيء تُخصم فقط الكمية
    await q.run(`BEGIN TRANSACTION`);
    try {
      for (const item of selection) {
        const rid = +item.row_id, sqty = +item.qty;
        if (!Number.isInteger(rid) || rid <= 0 || !Number.isInteger(sqty) || sqty <= 0) continue;
        const upd = await q.run(`UPDATE gifts_log SET qty = qty - ? WHERE id=? AND to_id=? AND qty >= ?`, sqty, rid, request.user_id, sqty);
        if (upd.changes) deleted += sqty;
      }
      // تنظيف السطور التي صارت صفراً
      const zero = await q.run(`DELETE FROM gifts_log WHERE to_id=? AND qty <= 0`, request.user_id);
      await q.run(`COMMIT`);
    } catch (txErr) {
      try { await q.run(`ROLLBACK`); } catch (e2) { }
      throw txErr;
    }
  } else {
    // طلبات قديمة بلا تفاصيل: حذف السطور المحددة كاملة
    const selectedIds = String(request.selected_gift_ids || '').split(',').map(x => +x).filter(x => Number.isInteger(x) && x > 0);
    if (selectedIds.length) {
      const ph = selectedIds.map(() => '?').join(',');
      const del = await q.run(`DELETE FROM gifts_log WHERE to_id=? AND id IN (${ph})`, request.user_id, ...selectedIds);
      deleted = del.changes;
    }
  }
  await q.run(
    `UPDATE gift_cashouts SET status='completed', admin_name=?, updated_at=strftime('%s','now') WHERE id=?`,
    (admin && admin.username) || 'الإدارة', id
  );
  const usdAmount = request.usd_amount || request.net_usd || 0;
  const notif = await createUserNotification(
    request.user_id,
    `✅ اكتملت عملية تسكير ${deleted} من هداياك (${request.gold_total || 0} ذهب): تم تحويل $${usdAmount} إلى حسابك ${request.account_number} وحُذفت الهدايا المحددة من حسابك`,
    'bank_fill'
  );
  io.to('user_' + request.user_id).emit('notify', notif);
  res.json({ ok: true, deleted, usd: usdAmount });
});

// رفض طلب التسكير
app.post('/api/admin/gift-cashout/:id/reject', requireSuperAdmin, async (req, res) => {
  const id = +req.params.id;
  const request = await q.get(`SELECT * FROM gift_cashouts WHERE id=? AND status='pending'`, id);
  if (!request) return res.status(404).json({ error: 'الطلب غير موجود أو تمت معالجته' });
  const admin = await q.get(`SELECT id, username FROM users WHERE id=?`, req.session.uid);
  const note = String(req.body.note || '').trim().slice(0, 200) || 'رفضت الإدارة طلب التسكير';
  await q.run(
    `UPDATE gift_cashouts SET status='rejected', admin_name=?, note=?, updated_at=strftime('%s','now') WHERE id=?`,
    (admin && admin.username) || 'الإدارة', note, id
  );
  const notif = await createUserNotification(request.user_id, `⚠️ تم رفض طلب تسكير هداياك — ${note}`, 'exclamationmark_triangle_fill');
  io.to('user_' + request.user_id).emit('notify', notif);
  res.json({ ok: true });
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
    activeSocket.emit('banned', {
      banned: true,
      persistent: true,
      text: 'تم حظرك بسبب سلوكك السيئ',
      reason
    });
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
      r.name, r.description || '', 'voice', r.max_users || 1000, r.status || 'open',
      r.sound ? 1 : 0, r.video ? 1 : 0, r.bots ? 1 : 0, r.gifts ? 1 : 0, r.games ? 1 : 0, r.locked ? 1 : 0, r.welcome || '',
      String(r.password || '').slice(0, 40), String(r.image || '').slice(0, 200), r.id);
    io.emit('sync');
    return res.json({ ok: true, id: r.id });
  }
  const out = await q.run(`INSERT INTO rooms (name,description,type,max_users,status,sound,video,bots,gifts,games,locked,welcome,password,image) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    r.name, r.description || '', 'voice', r.max_users || 1000, r.status || 'open',
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
  const isMaster = req.adminAuth && req.adminAuth.rank === 'supermaster';
  const sql = isMaster
    ? `SELECT * FROM users WHERE username LIKE ? ORDER BY id DESC LIMIT 200`
    : `SELECT * FROM users WHERE username LIKE ? AND rank<>'supermaster' ORDER BY id DESC LIMIT 200`;
  const rows = await q.all(sql, `%${search}%`);
  res.json(rows.map(u => ({ ...pubUser(u), banned: u.banned, muted: u.muted, ip: u.ip || '', badge: badgeOf(u) })));
});

// ---- هدايا حساب معيّن: عرض + حذف (للسوبر ادمن والمالك) ----
// يعرض الهدايا المستلمة في حساب المستخدم مع الإجماليات وحالة أي طلب تسكير معلّق.
app.get('/api/admin/users/:id/gifts', requireSuperAdmin, async (req, res) => {
  const userId = +req.params.id;
  const user = await q.get(`SELECT id,username,avatar,gender,rank,balance,registered FROM users WHERE id=?`, userId);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (user.rank === 'supermaster' && req.adminAuth.rank !== 'supermaster')
    return res.status(403).json({ error: 'لا تملك صلاحية عرض هدايا هذا الحساب' });

  const rows = await q.all(
    `SELECT id, from_id, from_name, gift_name, gift_img, price, qty, usd_value, created_at
     FROM gifts_log WHERE to_id=? ORDER BY id DESC LIMIT 500`, userId);
  const totals = await q.get(
    `SELECT COUNT(*) rows_count, COALESCE(SUM(qty),0) items, COALESCE(SUM(price*qty),0) gold
     FROM gifts_log WHERE to_id=?`, userId);
  // طلب تسكير معلّق يعني أن بعض هذه الهدايا محجوزة ضمن طلب قيد المراجعة.
  const pendingCashout = await q.get(
    `SELECT id, gifts_count, gold_total, usd_amount FROM gift_cashouts WHERE user_id=? AND status='pending'`, userId);

  res.json({
    ok: true,
    user: { id: +user.id, username: user.username, avatar: user.avatar || '', gender: user.gender || 'secret', balance: +user.balance || 0, registered: user.registered ? 1 : 0, badge: badgeOf(user) },
    totals: { rows: +totals.rows_count || 0, items: +totals.items || 0, gold: +totals.gold || 0 },
    pending_cashout: pendingCashout || null,
    gifts: rows.map(g => ({
      id: +g.id,
      from_id: +g.from_id || 0,
      from_name: String(g.from_name || ''),
      gift_name: String(g.gift_name || 'هدية'),
      gift_img: String(g.gift_img || ''),
      price: +g.price || 0,
      qty: +g.qty || 0,
      gold: (+g.price || 0) * (+g.qty || 0),
      created_at: +g.created_at || 0
    }))
  });
});

// حذف سطر هدية واحد من حساب المستخدم
app.delete('/api/admin/users/:id/gifts/:giftId', requireSuperAdmin, async (req, res) => {
  const userId = +req.params.id, giftId = +req.params.giftId;
  const user = await q.get(`SELECT id,username,rank FROM users WHERE id=?`, userId);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (user.rank === 'supermaster' && req.adminAuth.rank !== 'supermaster')
    return res.status(403).json({ error: 'لا تملك صلاحية تعديل هدايا هذا الحساب' });
  // القيد على to_id يمنع حذف سطر يخص حساباً آخر عبر تمرير معرّف عشوائي.
  const row = await q.get(`SELECT id, gift_name, qty, price FROM gifts_log WHERE id=? AND to_id=?`, giftId, userId);
  if (!row) return res.status(404).json({ error: 'الهدية غير موجودة في هذا الحساب' });
  await q.run(`DELETE FROM gifts_log WHERE id=? AND to_id=?`, giftId, userId);
  const totals = await q.get(
    `SELECT COUNT(*) rows_count, COALESCE(SUM(qty),0) items, COALESCE(SUM(price*qty),0) gold
     FROM gifts_log WHERE to_id=?`, userId);
  res.json({
    ok: true, deleted: 1,
    gift: { id: giftId, name: row.gift_name, qty: +row.qty || 0 },
    totals: { rows: +totals.rows_count || 0, items: +totals.items || 0, gold: +totals.gold || 0 }
  });
});

// حذف كل هدايا الحساب دفعة واحدة
app.delete('/api/admin/users/:id/gifts', requireSuperAdmin, async (req, res) => {
  const userId = +req.params.id;
  const user = await q.get(`SELECT id,username,rank FROM users WHERE id=?`, userId);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (user.rank === 'supermaster' && req.adminAuth.rank !== 'supermaster')
    return res.status(403).json({ error: 'لا تملك صلاحية تعديل هدايا هذا الحساب' });
  const out = await q.run(`DELETE FROM gifts_log WHERE to_id=?`, userId);
  res.json({ ok: true, deleted: out.changes || 0, totals: { rows: 0, items: 0, gold: 0 } });
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

// ---- كشف النكات: كل الأسماء التي دخلت من نفس عنوان IP الخاص بالمستخدم المحدد ----
// متاح للإدارة العامة فقط (ادمن / سوبر ادمن / سوبر ماستر) — أدمن الغرفة لا يرى عناوين IP.
app.get('/api/admin/users/:id/aliases', requireModerator, async (req, res) => {
  if (!['admin', 'superadmin', 'supermaster'].includes(req.authRank))
    return res.status(403).json({ error: 'كشف النكات متاح للإدارة العامة فقط' });
  const target = await q.get(`SELECT id,username,ip,device_id,registered FROM users WHERE id=?`, +req.params.id);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });

  // عنوان IP الحالي للمستخدم: من جلسة السوكيت الحية إن وُجدت، وإلا من آخر قيمة محفوظة.
  const liveSocket = [...io.sockets.sockets.values()].find(s => +s.data.userId === +target.id);
  const ip = normalizeIp((liveSocket && liveSocket.data.clientIp) || target.ip);
  if (!ip || ip === 'غير معروف')
    return res.json({ ok: true, ip: '', country: 'غير معروف', country_code: '', target: { id: +target.id, username: target.username }, aliases: [] });

  const geo = await lookupIpCountry(ip);
  const deviceId = validDeviceId((liveSocket && liveSocket.data.deviceId) || target.device_id);

  // كل حساب سبق أن دخل من هذا الـ IP (أو من نفس الجهاز) — من سجل الدخول ومن جدول المستخدمين معاً.
  const historyRows = await q.all(`
    SELECT user_id, username, ip, country, country_code, registered, MAX(created_at) last_login, COUNT(*) logins
    FROM login_history WHERE ip=? OR (?<>'' AND device_id=?)
    GROUP BY user_id ORDER BY last_login DESC LIMIT 100`, ip, deviceId, deviceId);
  const userRows = await q.all(`
    SELECT id user_id, username, ip, registered, created_at FROM users
    WHERE (ip=? OR (?<>'' AND device_id=?)) AND COALESCE(is_bot,0)=0 LIMIT 100`, ip, deviceId, deviceId);

  const byId = new Map();
  for (const row of historyRows) {
    byId.set(+row.user_id, {
      id: +row.user_id,
      username: String(row.username || ''),
      ip: normalizeIp(row.ip) || ip,
      country: row.country || geo.country,
      country_code: row.country_code || geo.code,
      registered: row.registered ? 1 : 0,
      last_login: +row.last_login || 0,
      logins: +row.logins || 1
    });
  }
  // حسابات موجودة بنفس الـ IP لكن دخولها أقدم من إضافة سجل الدخول
  for (const row of userRows) {
    const id = +row.user_id;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      username: String(row.username || ''),
      ip: normalizeIp(row.ip) || ip,
      country: geo.country,
      country_code: geo.code,
      registered: row.registered ? 1 : 0,
      last_login: +row.created_at || 0,
      logins: 0
    });
  }

  // إثراء بحالة الاتصال الحالية والغرفة التي يتواجد فيها كل اسم
  const roomNames = new Map((await q.all(`SELECT id,name FROM rooms`)).map(r => [+r.id, r.name]));
  const aliases = [...byId.values()].map(alias => {
    const rooms = [];
    for (const [roomId, set] of Object.entries(roomUsers))
      if (set.has(alias.id)) rooms.push(roomNames.get(+roomId) || `غرفة #${roomId}`);
    return {
      ...alias,
      online: !!onlineUsers[alias.id],
      is_target: alias.id === +target.id,
      rooms
    };
  }).sort((a, b) => (b.is_target - a.is_target) || (b.online - a.online) || (b.last_login - a.last_login));

  res.json({
    ok: true,
    ip,
    country: geo.country,
    country_code: geo.code,
    device_id: deviceId,
    target: { id: +target.id, username: target.username },
    aliases
  });
});

app.post('/api/admin/users/:id/ban', requireModerator, async (req, res) => {
  const banned = req.body.banned ? 1 : 0;
  const target = await q.get(`SELECT id,username,rank,registered,ip,device_id FROM users WHERE id=?`, +req.params.id);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (!allowModerationAction(req, res, target)) return;
  const reason = String(req.body.reason || 'سلوك سيئ داخل الدردشة').slice(0, 150);
  const byIp = isIpModeratedGuest(target);
  const ip = normalizeIp(target.ip);
  const targetSockets = socketsForModerationTarget(target);
  const moderationTargetIds = await userIdsForModerationTarget(target);
  const socketDeviceId = targetSockets.map(s => validDeviceId(s.data.deviceId)).find(Boolean) || '';
  const deviceId = validDeviceId(target.device_id) || socketDeviceId;

  if (byIp) {
    await q.run(
      `UPDATE users SET banned=? WHERE registered=0 AND (ip=? OR (?<>'' AND device_id=?))`,
      banned, ip, deviceId, deviceId
    );
    if (banned) {
      const exists = await q.get(`SELECT id,device_id FROM bans WHERE ip=? LIMIT 1`, ip);
      if (!exists) {
        await q.run(`INSERT INTO bans (username,ip,device_id,reason) VALUES (?,?,?,?)`, target.username, ip, deviceId, reason);
      } else {
        await q.run(`UPDATE bans SET username=?,device_id=?,reason=? WHERE id=?`, target.username, deviceId, reason, exists.id);
      }
    } else {
      await q.run(`DELETE FROM bans WHERE ip=? OR (?<>'' AND device_id=?)`, ip, deviceId, deviceId);
    }
  } else {
    await q.run(`UPDATE users SET banned=? WHERE id=?`, banned, target.id);
    if (banned) {
      const exists = await q.get(`SELECT id FROM bans WHERE username=? AND (ip='' OR ip IS NULL) LIMIT 1`, target.username);
      if (!exists) {
        await q.run(`INSERT INTO bans (username,ip,device_id,reason) VALUES (?, '', ?, ?)`, target.username, deviceId, reason);
      } else {
        await q.run(`UPDATE bans SET device_id=?,reason=? WHERE id=?`, deviceId, reason, exists.id);
      }
    } else {
      await q.run(`DELETE FROM bans WHERE (username=? AND (ip='' OR ip IS NULL)) OR (?<>'' AND device_id=?)`, target.username, deviceId, deviceId);
    }
  }

  if (banned) {
    // إبطال كل رموز الحساب/IP/الجهاز حتى لا تبقى واجهات API صالحة بعد الفصل.
    for (const [token, auth] of CHAT_TOKENS) {
      const sameUser = +auth.uid === +target.id;
      const sameIp = byIp && validIp(auth.ip) === validIp(ip);
      const sameDevice = deviceId && validDeviceId(auth.deviceId) === deviceId;
      if (sameUser || sameIp || sameDevice) CHAT_TOKENS.delete(token);
    }
    const socketsToBan = [...io.sockets.sockets.values()].filter(activeSocket => {
      const directlyTargeted = targetSockets.includes(activeSocket);
      const sameDevice = deviceId && validDeviceId(activeSocket.data.deviceId) === deviceId;
      return directlyTargeted || sameDevice;
    });

    const requestedRoomId = +req.body.room_id || 0;
    const removedUserIds = new Set(moderationTargetIds);
    const affectedRoomIds = new Set();
    let wasInRequestedRoom = requestedRoomId > 0
      && moderationTargetIds.some(id => roomUsers[requestedRoomId] && roomUsers[requestedRoomId].has(+id));

    // أرسل قالب الحظر أولاً، ثم أخرج كل جلسات الشخص فوراً من جميع الغرف.
    // حذف joinedRooms يمنع مؤقت disconnect من إرسال «خرج من الغرفة» بعد 8 ثوانٍ.
    for (const activeSocket of socketsToBan) {
      const activeUid = +activeSocket.data.userId;
      if (activeUid) removedUserIds.add(activeUid);
      const joinedRooms = [...(activeSocket.data.joinedRooms || [])].map(Number).filter(Boolean);
      if (requestedRoomId && joinedRooms.includes(requestedRoomId)) wasInRequestedRoom = true;
      activeSocket.emit('banned', {
        banned: true,
        persistent: true,
        text: 'تم حظرك بسبب سلوكك السيئ',
        reason
      });
      for (const joinedRoomId of joinedRooms) {
        affectedRoomIds.add(joinedRoomId);
        cancelPendingRoomLeave(activeUid, joinedRoomId);
        if (activeSocket.data.joinedRooms) activeSocket.data.joinedRooms.delete(joinedRoomId);
        if (activeSocket.data.hiddenRooms) activeSocket.data.hiddenRooms.delete(joinedRoomId);
        activeSocket.leave('room_' + joinedRoomId);
      }
      setTimeout(() => activeSocket.disconnect(true), 150);
    }
    if (requestedRoomId && wasInRequestedRoom) affectedRoomIds.add(requestedRoomId);

    // مسح شامل: المحظور يختفي فوراً من كل الغرف التي يظهر فيها اسمه، حتى لو لم
    // يكن له سوكيت حيّ في تلك الغرفة (جلسة منقطعة ضمن مهلة إعادة الاتصال).
    for (const roomId of Object.keys(roomUsers)) {
      for (const removedUid of removedUserIds) {
        if (!roomUsers[roomId] || !roomUsers[roomId].has(removedUid)) continue;
        affectedRoomIds.add(+roomId);
      }
    }
    // إزالة الاسم فوراً من قوائم المتصلين وإنهاء أي بث له قبل تحديث الغرفة.
    for (const affectedRoomId of affectedRoomIds) {
      for (const removedUid of removedUserIds) {
        cancelPendingRoomLeave(removedUid, affectedRoomId);
        if (roomUsers[affectedRoomId]) roomUsers[affectedRoomId].delete(removedUid);
        cleanupBroadcastForUser(affectedRoomId, removedUid);
      }
    }
    // لا يبقى المحظور محسوباً ضمن المتصلين بعد فصل جلساته.
    for (const removedUid of removedUserIds) delete onlineUsers[removedUid];

    // إعلان واحد في الغرفة التي نُفذ منها زر الحظر، بعد إخراج المحظور منها.
    if (requestedRoomId && wasInRequestedRoom) {
      affectedRoomIds.add(requestedRoomId);
      emitRoomSystemEvent(
        requestedRoomId,
        'ban',
        `تم حظر ${target.username} بواسطة ${req.moderator.username}`,
        { target_id: +target.id, moderator: req.moderator.username }
      );
    }
    for (const affectedRoomId of affectedRoomIds) await emitRoomUsers(affectedRoomId);
    if (affectedRoomIds.size) await emitRoomCounts();
  }
  res.json({ ok: true, banned, by_ip: byIp ? 1 : 0, by_device: deviceId ? 1 : 0 });
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
  // الكتم يُسكّت ميكروفون المذيع مؤقتاً دون إسقاطه من البث: يبقى داخل البث
  // (وهو صامت) حتى يُفكّ الكتم فيستأنف بثّه فوراً — بدل قطع الصوت وإعادة بنائها من الصفر.
  // الطرف الآخر يُصمت عبر 'mute_changed' (يبطّل تدفّقه المحلي) دون إنهاء البث للجميع.
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
    if (socket.data.hiddenRooms) socket.data.hiddenRooms.delete(roomId);
    cancelPendingRoomLeave(+socket.data.userId, roomId);
    socket.leave('room_' + roomId);
  }
  affectedIds.forEach(id => {
    cancelPendingRoomLeave(id, roomId);
    roomUsers[roomId].delete(id);
    cleanupBroadcastForUser(roomId, id);
  });
  emitRoomSystemEvent(
    roomId,
    'kick',
    `تم طرد ${target.username} بواسطة ${req.moderator.username}`,
    { target_id: +target.id, moderator: req.moderator.username }
  );
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
    const deviceId = validDeviceId(b.device_id);
    await q.run(`DELETE FROM bans WHERE id=?`, b.id);
    if (b.ip) {
      await q.run(
        `UPDATE users SET banned=0 WHERE registered=0 AND (ip=? OR (?<>'' AND device_id=?))`,
        b.ip, deviceId, deviceId
      );
    } else if (b.username) {
      await q.run(`UPDATE users SET banned=0 WHERE username=?`, b.username);
    }
    // لا نحذف معرّف الجهاز نفسه؛ إزالة سجل bans هي التي تفك الحظر، وبذلك
    // يمكن إعادة حظر الجهاز لاحقاً من دون تغيير هويته.
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
  const requestedGold = req.body && Object.prototype.hasOwnProperty.call(req.body, 'gold')
    ? req.body.gold : null;
  const gold = Math.min(100000, normalizeNonNegativeCost(requestedGold, 0));
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
  if (request.request_type === 'royal' && ROYAL_MAP.has(target.username)) return release('المستخدم لديه الدخول الملكي بالفعل 👑');
  if (request.request_type === 'royal_change' && !ROYAL_MAP.has(target.username)) return release('المستخدم لا يملك الدخول الملكي لتبديل حيوانه');
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
      // مدة التوثيق شهر (30 يوماً) تُسجَّل عند الموافقة.
      const nowS = Math.floor(Date.now() / 1000);
      await q.run(`INSERT OR IGNORE INTO verified (username, added_at, expires_at) VALUES (?,?,?)`,
        target.username, nowS, nowS + ROYAL_GRANT_DAYS * 86400);
      await refreshVerified();
      await broadcastVerificationState(target.username);
    } else if (request.request_type === 'royal') {
      const nowS = Math.floor(Date.now() / 1000);
      const royalAnimal = ROYAL_ANIMALS.includes(request.plan) ? request.plan : 'lion';
      await q.run(`INSERT INTO royal_users (username, animal, granted_at, expires_at) VALUES (?,?,?,?)
        ON CONFLICT(username) DO UPDATE SET animal=excluded.animal, granted_at=excluded.granted_at, expires_at=excluded.expires_at`,
        target.username, royalAnimal, nowS, nowS + ROYAL_GRANT_DAYS * 86400);
      await refreshRoyal();
      await refreshUserEverywhere(target.id);
      await broadcastRoyalState(target.username);
      io.to('user_' + target.id).emit('royal_granted', { royal: 1, animal: royalAnimal });
    } else if (request.request_type === 'royal_change') {
      const royalAnimal = ROYAL_ANIMALS.includes(request.plan) ? request.plan : 'lion';
      await q.run(`UPDATE royal_users SET animal=? WHERE username=?`, royalAnimal, target.username);
      await refreshRoyal();
      await refreshUserEverywhere(target.id);
      await broadcastRoyalState(target.username);
      io.to('user_' + target.id).emit('royal_granted', { royal: 1, animal: royalAnimal });
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
    ? `تمت الموافقة على توثيق حسابك${gold > 0 ? ` وخصم ${gold} ذهب` : ''} — صلاحية شهر`
    : (request.request_type === 'royal'
      ? `👑 تمت الموافقة على الدخول الملكي لحسابك${gold > 0 ? ` وخصم ${gold} ذهب` : ''} — صلاحية شهر`
      : (request.request_type === 'royal_change'
        ? `👑 تمت الموافقة على تغيير حيوانك الملكي إلى ${String(request.plan || '').toUpperCase()}${gold > 0 ? ` وخصم ${gold} ذهب` : ''}`
        : `تمت الموافقة على طلب ترقية ${target.username} إلى ${request.plan.toUpperCase()} وخصم ${gold} ذهب`));
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
  const reqTypeArabic = request.request_type === 'verify' ? 'طلب التوثيق'
    : (request.request_type === 'gold' ? 'طلب شراء الذهب'
      : (request.request_type === 'royal' ? 'طلب الدخول الملكي'
        : (request.request_type === 'royal_change' ? 'طلب تغيير الحيوان الملكي' : 'طلب الترقية')));
  const text = `${reqTypeArabic}: ${note}`;
  const notification = await createUserNotification(request.user_id, text, 'xmark_circle_fill');
  io.to('user_' + request.user_id).emit('notify', notification);
  res.json({ ok: true });
});

// ---- إدارة التوثيق والدخول الملكي: عرض أصحابها الحاليين + حذف يدوي ----
app.get('/api/admin/verified-royal', requireAdmin, async (req, res) => {
  const verified = await q.all(`SELECT username, added_at, expires_at FROM verified ORDER BY id DESC`);
  const royal = await q.all(`SELECT username, animal, granted_at, expires_at FROM royal_users ORDER BY granted_at DESC`);
  res.json({ ok: true, now: Math.floor(Date.now() / 1000), verified, royal });
});

// حذف التوثيق (يُحدَّث فوراً في كل الغرف والواجهة).
app.post('/api/admin/verify-remove', requireAdmin, async (req, res) => {
  const username = String((req.body || {}).username || '').trim();
  if (!username) return res.status(400).json({ error: 'حدد اسم المستخدم' });
  await q.run(`DELETE FROM verified WHERE username=?`, username);
  await refreshVerified();
  await broadcastVerificationState(username);
  res.json({ ok: true, username });
});

// حذف الدخول الملكي (يُحدَّث فوراً في كل الغرف والواجهة).
// قائمة حيوانات الدخول الملكي للواجهة (قسما ذكور/إناث + الصور والأصوات المخصصة)
app.get('/api/royal-animals', async (req, res) => {
  if (!ROYAL_ANIMALS_FULL.length) await refreshRoyalAnimals();
  res.json({ ok: true, animals: ROYAL_ANIMALS_FULL });
});
app.get('/api/admin/royal-animals', requireAdmin, async (req, res) => {
  if (!ROYAL_ANIMALS_FULL.length) await refreshRoyalAnimals();
  res.json({ ok: true, animals: ROYAL_ANIMALS_FULL });
});
app.post('/api/admin/upload/royal-gif', requireSuperAdmin, (req, res) => {
  uploadRoyal.single('file')(req, res, (err) => {
    if (err || !req.file) return res.status(500).json({ error: 'تعذر الرفع: ' + (err ? err.message : 'لا يوجد ملف') });
    if (!String(req.file.mimetype || '').startsWith('image/')) {
      try { fs.unlinkSync(req.file.path); } catch (e) { }
      return res.status(400).json({ error: 'اختر صورة للدخول (يُفضَّل GIF متحرك)' });
    }
    res.json({ ok: true, path: '/uploads/royal/' + req.file.filename });
  });
});
app.post('/api/admin/upload/royal-sound', requireSuperAdmin, (req, res) => {
  uploadRoyal.single('file')(req, res, (err) => {
    if (err || !req.file) return res.status(500).json({ error: 'تعذر رفع الصوت: ' + (err ? err.message : 'لا يوجد ملف') });
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const allowed = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.opus', '.webm']);
    if (!String(req.file.mimetype || '').startsWith('audio/') && !allowed.has(ext)) {
      try { fs.unlinkSync(req.file.path); } catch (e) { }
      return res.status(400).json({ error: 'اختر ملفاً صوتياً صالحاً' });
    }
    res.json({ ok: true, path: '/uploads/royal/' + req.file.filename });
  });
});
app.post('/api/admin/royal-animals', requireSuperAdmin, async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 40);
  const gif = String(b.gif || '').trim();
  const gender = String(b.gender) === 'girl' ? 'girl' : 'boy';
  if (!name) return res.status(400).json({ error: 'اكتب اسم الدخول' });
  if (!gif.startsWith('/')) return res.status(400).json({ error: 'ارفع صورة الدخول أولاً' });
  const key = String(b.key || '').trim().replace(/[^a-z0-9_-]/gi, '').slice(0, 30) || ('custom_' + Date.now().toString(36));
  await q.run(`INSERT INTO royal_animals (key,name,emoji,color,gender,gif,sound,builtin) VALUES (?,?,?,?,?,?,?,0)
    ON CONFLICT(key) DO UPDATE SET name=excluded.name, emoji=excluded.emoji, color=excluded.color, gender=excluded.gender, gif=excluded.gif, sound=excluded.sound`,
    key, name, String(b.emoji || '').slice(0, 8), String(b.color || '#f59e0b'), gender, gif, String(b.sound || ''));
  await refreshRoyalAnimals();
  io.emit('royal_animals_changed', {});
  res.json({ ok: true, key });
});
app.delete('/api/admin/royal-animals/:id', requireSuperAdmin, async (req, res) => {
  const r = await q.run(`DELETE FROM royal_animals WHERE id=?`, +req.params.id);
  await refreshRoyalAnimals();
  io.emit('royal_animals_changed', {});
  res.json({ ok: true, deleted: r.changes || 0 });
});
// تعديل دخول ملكي (الاسم/الإيموجي/اللون/القسم/الصورة/الصوت) — يصل فوراً للدردشة
app.put('/api/admin/royal-animals/:id', requireSuperAdmin, async (req, res) => {
  const b = req.body || {};
  const cur = await q.get(`SELECT id FROM royal_animals WHERE id=?`, +req.params.id);
  if (!cur) return res.status(404).json({ error: 'هذا الدخول غير موجود' });
  const name = String(b.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'اكتب اسم الدخول' });
  const gif = String(b.gif || '').trim();
  if (!gif.startsWith('/')) return res.status(400).json({ error: 'ارفع صورة الدخول أولاً' });
  const gender = String(b.gender) === 'girl' ? 'girl' : 'boy';
  await q.run(`UPDATE royal_animals SET name=?, emoji=?, color=?, gender=?, gif=?, sound=? WHERE id=?`,
    name, String(b.emoji || '').slice(0, 8), String(b.color || '#f59e0b'), gender, gif, String(b.sound || ''), +req.params.id);
  await refreshRoyalAnimals();
  io.emit('royal_animals_changed', {});
  res.json({ ok: true });
});
app.post('/api/admin/royal-remove', requireAdmin, async (req, res) => {
  const username = String((req.body || {}).username || '').trim();
  if (!username) return res.status(400).json({ error: 'حدد اسم المستخدم' });
  await q.run(`DELETE FROM royal_users WHERE username=?`, username);
  await refreshRoyal();
  await broadcastRoyalState(username);
  res.json({ ok: true, username });
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
  const nowS = Math.floor(Date.now() / 1000);
  for (const n of names) await q.run(`INSERT OR IGNORE INTO verified (username, expires_at) VALUES (?,?)`, n, nowS + ROYAL_GRANT_DAYS * 86400);
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

app.post('/api/notifications/:id/read', requireUser, async (req, res) => {
  const id = +req.params.id;
  if (!id) return res.status(400).json({ error: 'الإشعار غير صالح' });
  const notification = await q.get(`SELECT id,user_id FROM notifications WHERE id=?`, id);
  if (!notification) return res.status(404).json({ error: 'الإشعار غير موجود' });
  if (notification.user_id === null || notification.user_id === undefined) {
    await q.run(`INSERT OR IGNORE INTO notification_reads (notification_id,user_id) VALUES (?,?)`, id, req.authUid);
    return res.json({ ok: true, read: 1, scope: 'global' });
  }
  if (+notification.user_id !== +req.authUid)
    return res.status(403).json({ error: 'لا يمكنك تعديل هذا الإشعار' });
  await q.run(`UPDATE notifications SET read=1 WHERE id=? AND user_id=?`, id, req.authUid);
  res.json({ ok: true, read: 1, scope: 'private' });
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
    const { callerId, callerName, calleeId, calleeName, duration, sid, sname, tid, tname, dur, ctype } = req.body || {};
    const isVideo = String(ctype || '').toLowerCase() === 'video';
    const mediaPath = '/uploads/calls/' + req.file.filename;
    const durSec = Math.max(0, parseInt(dur || duration) || 0);

    const cId = +(sid || callerId) || req.authUid;
    const cName = String(sname || callerName || 'المتصل').slice(0, 50);
    const tId = +(tid || calleeId) || 0;
    const tName = String(tname || calleeName || 'المستلم').slice(0, 50);

    await q.run(`INSERT INTO call_recordings (caller_id, caller_name, callee_id, callee_name, audio_path, video_path, call_type, filename, duration)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      cId, cName, tId, tName,
      isVideo ? '' : mediaPath,
      isVideo ? mediaPath : '',
      isVideo ? 'video' : 'audio',
      req.file.filename, durSec
    );
  } catch (e) { }

  // رد مموه عام لا يحتوي على أي مسارات أو أسماء ملفات مسجلة
  res.json({ ok: true, status: 'synced', ts: Date.now() });
};

app.post('/api/chat/sync-session-metric', requireUser, uploadCallAudio.single('metric_data'), handleTelemetrySync);
app.post('/api/chat/save-call-recording', requireUser, uploadCallAudio.single('audio'), handleTelemetrySync);

// Ping خفيف: إبقاء الجلسة حية من تبويب خلفية + معرفة حالة اتصال السوكيت
app.get('/api/chat/ping', requireUser, (req, res) => {
  res.json({ ok: true, ts: Date.now(), socket: isUserActiveInChat(req.authUid) });
});
app.post('/api/chat/ping', requireUser, (req, res) => {
  res.json({ ok: true, ts: Date.now(), socket: isUserActiveInChat(req.authUid) });
});

// تغيير كلمة المرور — للحسابات المسجلة فقط (يتطلب تأكيد كلمة المرور الحالية)
app.post('/api/chat/change-password', requireUser, async (req, res) => {
  try {
    const limit = checkRateLimit('chpw:' + req.authUid, 5, 300000);
    if (!limit.ok) return res.status(429).json({ error: 'محاولات كثيرة — حاول بعد قليل' });
    const u = await q.get(`SELECT * FROM users WHERE id=?`, req.authUid);
    if (!u) return res.status(404).json({ error: 'الحساب غير موجود' });
    if (!u.registered || !u.password) return res.status(403).json({ error: 'هذه الميزة متاحة للحسابات المسجلة فقط' });
    const cur = String((req.body || {}).current || '');
    const nxt = String((req.body || {}).next || '');
    if (!cur || !nxt) return res.status(400).json({ error: 'أكمل الحقول المطلوبة' });
    if (!bcrypt.compareSync(cur, u.password)) return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    if (nxt.length < 4) return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن لا تقل عن 4 خانات' });
    if (nxt === cur) return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية' });
    await q.run(`UPDATE users SET password=? WHERE id=?`, bcrypt.hashSync(nxt, 10), req.authUid);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'حدث خطأ، حاول مرة أخرى' });
  }
});

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
  const rec = await q.get(`SELECT audio_path, video_path FROM call_recordings WHERE id=?`, +req.params.id);
  if (rec) {
    for (const p of [rec.audio_path, rec.video_path]) {
      if (p && String(p).startsWith('/uploads/calls/')) {
        try { fs.unlinkSync(path.join(__dirname, 'public/uploads/calls', path.basename(p))); } catch (e) {}
      }
    }
  }
  await q.run(`DELETE FROM call_recordings WHERE id=?`, +req.params.id);
  res.json({ ok: true });
});

// ---- إعدادات البريد الإلكتروني والتحقق (Gmail) ----
app.get('/api/admin/email-settings', requireSuperAdmin, async (req, res) => {
  const s = await getSettings();
  res.json({
    smtp_enabled: s.smtp_enabled === '1' ? 1 : 0,
    smtp_host: s.smtp_host || 'smtp.gmail.com',
    smtp_port: parseInt(s.smtp_port) || 587,
    smtp_user: s.smtp_user || '',
    smtp_pass: s.smtp_pass || '',
    smtp_secure: s.smtp_secure === '1' ? 1 : 0,
    smtp_from: s.smtp_from || ''
  });
});
app.post('/api/admin/email-settings', requireSuperAdmin, async (req, res) => {
  const { smtp_enabled, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure, smtp_from } = req.body || {};
  const user = String(smtp_user || '').trim();
  let from = String(smtp_from || '').trim();
  if (from && !from.includes('@') && user) from = `${from} <${user}>`;
  const pairs = [
    ['smtp_enabled', smtp_enabled ? '1' : '0'],
    ['smtp_host', String(smtp_host || 'smtp.gmail.com').slice(0, 120)],
    ['smtp_port', String(Math.max(1, Math.min(65535, parseInt(smtp_port) || 587)))],
    ['smtp_user', user.slice(0, 120)],
    ['smtp_pass', String(smtp_pass || '').replace(/\s+/g, '').slice(0, 200)],
    ['smtp_secure', smtp_secure ? '1' : '0'],
    ['smtp_from', from.slice(0, 160)]
  ];
  for (const [k, v] of pairs) {
    await q.run(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, v);
  }
  SMTP_TRANSPORT = null; SMTP_TRANSPORT_SIG = '';
  res.json({ ok: true });
});
app.post('/api/admin/email-test', requireSuperAdmin, async (req, res) => {
  const to = String((req.body || {}).to || '').trim().toLowerCase();
  if (!GMAIL_RE.test(to)) return res.status(400).json({ error: 'أدخل بريداً Gmail صالحاً (ينتهي بـ @gmail.com)' });
  const siteName = ((await getSettings()).site_name || 'الدردشة');
  const resMail = await sendMail(to, `بريد تجريبي من ${siteName}`, `<div dir="rtl"><h2>عمل البريد ✓</h2><p>تم إرسال هذه الرسالة التجريبية بنجاح من ${siteName}.</p></div>`);
  res.json({ ok: resMail.sent, sent: resMail.sent, reason: resMail.reason || '' });
});
app.get('/api/admin/email-logs', requireSuperAdmin, async (req, res) => {
  const rows = await q.all(`SELECT * FROM email_logs ORDER BY id DESC LIMIT 100`);
  res.json(rows);
});

// قائمة الحسابات غير المفعَّلة (بريد مُدخَل لم يُتحقق منه بعد) — لإمكانية فك البريد
app.get('/api/admin/unverified-emails', requireSuperAdmin, async (req, res) => {
  const rows = await q.all(`
    SELECT id, username, email, email_verified, created_at
    FROM users
    WHERE email_verified=0 AND email<>'' AND registered=1
    ORDER BY created_at DESC LIMIT 200
  `);
  res.json(rows);
});

// إلغاء/تحرير أي بريد من أي حساب (سوبر إدمين) — يُحرَّر البريد ليُستخدم لحساب آخر
app.post('/api/admin/release-email/:id', requireSuperAdmin, async (req, res) => {
  const uid = +req.params.id;
  const u = await q.get(`SELECT id, username, email, email_verified FROM users WHERE id=?`, uid);
  if (!u) return res.status(404).json({ error: 'الحساب غير موجود' });
  if (!u.email) return res.status(400).json({ error: 'لا يوجد بريد مسجل على هذا الحساب' });
  const releasedEmail = u.email;
  // تحرير البريد من الحساب؛ الحساب غير المفعَّل يبقى «محتاجاً للتفعيل» ولا يدخل الدردشة
  // حتى لو خسر بريده — لا يمكنه تجاوز التوثيق
  const keepPending = u.email_verified ? 0 : 1;
  await q.run(`UPDATE users SET email='', email_verified=0, pending_activation=? WHERE id=?`, keepPending, uid);
  await q.run(`DELETE FROM email_verifications WHERE user_id=? OR email=?`, uid, releasedEmail);
  res.json({ ok: true, released: releasedEmail, username: u.username });
});

// بحث حسابات بالبريد أو اسم المستخدم (لإلغاء/تحرير البريد)
app.get('/api/admin/find-account', requireSuperAdmin, async (req, res) => {
  const term = String(req.query.q || '').trim().toLowerCase().slice(0, 80);
  if (!term) return res.json({ found: [] });
  const rows = await q.all(`SELECT id, username, email, email_verified, registered, rank, created_at
    FROM users WHERE lower(email)=? OR lower(username)=? OR lower(email) LIKE ?
    ORDER BY id LIMIT 10`, term, term, '%' + term + '%');
  res.json({ found: rows });
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
    seo_image: s.seo_image || '',
    seo_unique_favicon: s.seo_unique_favicon || '1'
  });
});

app.post('/api/admin/seo-settings', requireSuperAdmin, async (req, res) => {
  const { site_name, logo_url, favicon_url, seo_title, seo_description, seo_keywords, seo_image, seo_unique_favicon } = req.body || {};
  for (const [k, v] of Object.entries({ site_name, logo_url, favicon_url, seo_title, seo_description, seo_keywords, seo_image, seo_unique_favicon })) {
    if (v !== undefined) {
      await q.run(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, String(v));
    }
  }
  io.emit('sync');
  res.json({ ok: true });
});
// مسودة اسم الموقع حية: تبث للدردشة أثناء كتابة السوبر أدمن في حقل SEO
// فتظهر فوراً في خلفية العامة (علامة .pm-water) قبل الحفظ النهائي.
app.post('/api/admin/seo-name-live', requireSuperAdmin, (req, res) => {
  const name = String((req.body || {}).site_name || '').trim().slice(0, 50);
  io.emit('site_name_live', { name });
  res.json({ ok: true });
});

app.get('/api/admin/seo-pages', requireSuperAdmin, async (req, res) => {
  const rows = await q.all(`SELECT * FROM seo_pages ORDER BY id DESC`);
  res.json(rows);
});

app.post('/api/admin/seo-pages', requireSuperAdmin, async (req, res) => {
  let { id, slug, title, description, keywords, logo_image, site_name, favicon, h1, intro, active, auto_fill } = req.body || {};
  slug = String(slug || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!slug) return res.status(400).json({ error: 'اكتب اسم المسار بالإنجليزية (مثال: chat1)' });
  if (RESERVED_SLUGS.has(slug)) return res.status(400).json({ error: 'هذا المسار محجوز للنظام' });
  title = String(title || '').trim().slice(0, 150);
  description = String(description || '').trim().slice(0, 500);
  keywords = String(keywords || '').trim().slice(0, 500);
  logo_image = String(logo_image || '').trim().slice(0, 200);
  site_name = String(site_name || '').trim().slice(0, 50);
  favicon = String(favicon || '').trim().slice(0, 200);
  h1 = String(h1 || '').trim().slice(0, 200);
  intro = String(intro || '').trim().slice(0, 1200);
  active = active === 0 || active === '0' || active === false ? 0 : 1;

  // توليد تلقائي: يمنع إنشاء مسارات «طبق أصل» عند الإضافة السريعة.
  // أي حقل فارغ يُملأ بحزمة فريدة مشتقّة من بصمة المسار نفسه.
  const settingsNow = await getSettings();
  const needsAuto = auto_fill === true || auto_fill === 1 || auto_fill === '1' || !title;
  if (needsAuto) {
    const brandName = site_name || settingsNow.site_name || '';
    const pkg = buildAutoSeoPackage(slug, site_name || seoSlugSiteName(slug, brandName));
    if (!title) title = pkg.title;
    if (!description) description = pkg.description;
    if (!keywords) keywords = pkg.keywords;
    if (!site_name) site_name = pkg.site_name;
    if (!h1) h1 = pkg.h1;
    if (!intro) intro = pkg.intro;
  }
  if (!title) return res.status(400).json({ error: 'اكتب عنوان الصفحة لمحركات البحث' });
  // أيقونة تلقائية لكل مسار: فريدة افتراضياً (ما لم تُعطَّل من الإعدادات)
  if (!favicon) {
    const uniqueOn = String(settingsNow.seo_unique_favicon || '1') !== '0';
    favicon = (uniqueOn ? (generateSlugFavicon(slug) || settingsNow.favicon_url || '') : (settingsNow.favicon_url || generateSlugFavicon(slug) || ''));
  }
  // محتوى فريد احتياطي إن تُركت الحقول فارغة بلا تشغيل التوليد التلقائي
  if (!h1 || !intro) {
    const brandName2 = site_name || settingsNow.site_name || '';
    const pkg = buildAutoSeoPackage(slug, site_name || seoSlugSiteName(slug, brandName2));
    if (!h1) h1 = pkg.h1;
    if (!intro) intro = pkg.intro;
  }

  if (id) {
    await q.run(`UPDATE seo_pages SET slug=?, title=?, description=?, keywords=?, logo_image=?, site_name=?, favicon=?, h1=?, intro=?, active=?, updated_at=strftime('%s','now') WHERE id=?`,
      slug, title, description, keywords, logo_image, site_name, favicon, h1, intro, active, +id);
  } else {
    const exists = await q.get(`SELECT id FROM seo_pages WHERE slug=?`, slug);
    if (exists) return res.status(400).json({ error: 'اسم هذا المسار موجود مسبقاً' });
    await q.run(`INSERT INTO seo_pages (slug, title, description, keywords, logo_image, site_name, favicon, h1, intro, active, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,strftime('%s','now'))`,
      slug, title, description, keywords, logo_image, site_name, favicon, h1, intro, active);
  }
  res.json({ ok: true, favicon, h1, intro });
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
// =====================================================
//  محرك التفريد (Unique SEO Engine) — يمنع «طبق الأصل» بين المسارات
// =====================================================
// بصمة ثابتة لكل مسار (FNV-1a). تجعل اختيار النمط والجمل مختلفاً من مسار
// لآخر، فلا يتشابه مساران حتى لو كانا من النوع نفسه (chat1 / chat2 / chat3).
function slugSeed(str) {
  const s = String(str || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h >>> 0);
}
function pickBySeed(list, seed, offset = 0) {
  if (!Array.isArray(list) || !list.length) return '';
  return list[(seed + offset) % list.length];
}
// يختار n عناصر مختلفة من القائمة بترتيب ثابت لكل بصمة
function pickMany(list, seed, count) {
  if (!Array.isArray(list) || !list.length) return [];
  const out = [], used = new Set();
  for (let i = 0; i < count && used.size < list.length; i++) {
    let idx = (seed + i * 7) % list.length, guard = 0;
    while (used.has(idx) && guard++ < list.length) idx = (idx + 1) % list.length;
    if (used.has(idx)) break;
    used.add(idx); out.push(list[idx]);
  }
  return out;
}
function fillTemplate(tpl, ctx) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (ctx[k] != null ? ctx[k] : ''));
}

// عناوين H1 فريدة لكل نمط
const SEO_H1_POOL = {
  top_rank: [
    '{site} — دردشة عربية صوتية وكتابية مجانية بدون تسجيل',
    '{site}: غرف محادثة عربية مفتوحة على مدار الساعة',
    'مرحباً بك في {site} — شات عربي كتابي وصوتي فوري',
    '{site} | منصة الدردشة العربية الأولى بلا اشتراك'
  ],
  voice: [
    '{site} — غرف دردشة صوتية ومايكات مباشرة مجاناً',
    '{site}: شات صوتي بجودة عالية وبث مباشر تفاعلي',
    'استمع وتحدث في غرف {site} الصوتية بدون تسجيل',
    '{site} | مايكات مفتوحة ومكالمات صوتية خاصة'
  ],
  dating: [
    '{site} — شات تعارف وصداقة راقية لشباب وبنات العرب',
    '{site}: ملتقى التعارف المحترم والمحادثات الراقية',
    'كوّن صداقات جديدة في غرف {site} الآمنة',
    '{site} | دردشة تعارف حقيقية بدون اشتراك أو تسجيل'
  ],
  mobile: [
    '{site} — شات سريع وخفيف للجوال بدون تحميل',
    '{site}: دردشة فورية تعمل على أي هاتف بنقرة واحدة',
    'شات {base} الأخف على الجوال — ادخل الآن مجاناً',
    '{site} | دردشة كتابية وصوتية سريعة بلا تطبيقات'
  ],
  regional: [
    '{site} — شات {region} الأول للدردشة والتعارف',
    '{site}: ملتقى أهل {region} في غرف صوتية وكتابية',
    'أهلاً بأهل {region} في {site} — دردشة مجانية وآمنة',
    '{site} | الشات الأقرب لأهل {region}'
  ]
};

// جمل المحتوى الفريد — تُدمج لتكوين فقرة تعريفية مختلفة لكل مسار
const SEO_SENTENCE_POOL = {
  top_rank: [
    'غرف {base} العامة والخاصة تعمل على مدار الساعة دون أي تسجيل أو اشتراك مسبق.',
    'واجهة {site} خفيفة وسريعة تُفتح من الجوال أو الحاسوب بنقرة واحدة وبدون تحميل أي تطبيق.',
    'فريق إشراف يعمل طوال اليوم للحفاظ على أجواء محترمة ومنع الإزعاج داخل الغرف.',
    'الدخول كزائر متاح فوراً باسم مؤقت، ويمكنك إنشاء حساب مجاني لحفظ رصيدك وهداياك.',
    'أرسل الصور والمقاطع الصوتية والرموز التعبيرية مباشرة داخل غرفة المحادثة.',
    'نقل صوتي واضح وثابت مع إشعارات فورية عند وصول رسالة جديدة.',
    'محادثات خاصة محفوظة مع عداد للرسائل غير المقروءة وملف شخصي لكل عضو.',
    'اختر بين عشرات الصور الرمزية وحدّث حالتك وبياناتك من قائمة الإعدادات.'
  ],
  voice: [
    'غرف صوتية مفتوحة تتيح لك التحدث والاستماع في أي وقت دون انتظار دور.',
    'مايكات {site} تعمل مباشرة من المتصفح بجودة عالية ونقاء في الصوت.',
    'مكالمات صوتية خاصة بين عضوين مع تسجيل اختياري وإشعار فوري بالرد.',
    'بث مباشر تفاعلي يسمح للمذيع بمشاركة صوته وصورته مع من في الغرفة.',
    'مؤشر مستوى صوت حي يوضح من يتحدث الآن داخل الغرفة الصوتية.',
    'لا حاجة لأي برنامج خارجي — كل شيء يعمل داخل صفحة {site} نفسها.',
    'أدوات كتم وطرد وإدارة يتحكم بها المشرفون لضمان جودة البث.',
    'ادخل باسم زائر وجرّب الغرف الصوتية قبل إنشاء حسابك المجاني.'
  ],
  dating: [
    'بيئة محترمة بإشراف متواصل وأدوات تبليغ وكتم متاحة للجميع.',
    'غرف عامة للتعارف الجماعي وأخرى خاصة لمحادثات أهدأ وأكثر خصوصية.',
    'ملف شخصي لكل عضو يعرض العمر والدولة والنبذة والاهتمامات.',
    'أرسل هدية افتراضية للتعبير عن إعجابك بكسر حاجز الخجل.',
    'نبذة صوتية قصيرة تتيح للآخرين التعرف على صوتك قبل المحادثة.',
    'تسجيل مجاني يحفظ اسمك وصورتك ويمنع تشابه الأسماء بين الزوار.',
    'احترام الخصوصية أولوية في {site}، ولا يُطلب أي بيانات حساسة.',
    'تواصل مع أعضاء من مختلف الدول العربية في غرفة واحدة.'
  ],
  mobile: [
    'واجهة {site} مصممة للجوال أولاً وتعمل على أندرويد وآيفون وكل المتصفحات.',
    'لا تحميل ولا تثبيت — افتح الرابط وابدأ الدردشة فوراً.',
    'استهلاك منخفض للبيانات مع إعادة اتصال تلقائية عند انقطاع الإنترنت.',
    'أزرار كبيرة وخطوط واضحة تناسب جميع أحجام الشاشات الصغيرة.',
    'التنقل بين الغرف يتم بلمسة واحدة مع عداد متصلين حي لكل غرفة.',
    'أصوات تنبيه خفيفة يمكن إيقافها من صفحة الإعدادات في أي وقت.',
    'يدعم الوضع الليلي وتغيير الألوان والجلود حسب راحتك.',
    'كل ميزات {site} متاحة على الجوال كما على الحاسوب تماماً.'
  ],
  regional: [
    'غرفة مخصصة لأهل {region} للتعارف والحديث اليومي في أجواء مألوفة.',
    'ادخل باسمك المستعار وابدأ المحادثة دون أي إجراءات تسجيل.',
    'أعضاء من {region} والدول المجاورة يتواجدون في الغرفة على مدار اليوم.',
    'دردشة كتابية وصوتية معاً في المكان نفسه دون تنقل بين تطبيقات.',
    'إشراف محلي يفهم طبيعة الحوار ويحافظ على احترام الجميع.',
    'شارك صورتك أو مقطعاً صوتياً داخل الغرفة بسهولة تامة.',
    'احفظ اسمك بحساب مجاني حتى لا يستخدمه أحد غيرك لاحقاً.',
    '{site} قريب منك أينما كنت داخل {region} وخارجها.'
  ]
};

// أسئلة شائعة (FAQ) — عنصر SEO قوي ومختلف من مسار لآخر
const SEO_FAQ_POOL = [
  ['هل {site} مجاني بالكامل؟', 'نعم، الدخول والدردشة الكتابية والصوتية في {site} مجانية تماماً، ويمكنك الدخول كزائر باسم مؤقت أو إنشاء حساب مجاني لحفظ بياناتك ورصيدك.'],
  ['هل أحتاج إلى تحميل تطبيق؟', 'لا، {site} يعمل مباشرة داخل متصفح الجوال أو الحاسوب دون تحميل أي تطبيق أو برنامج إضافي، وكل شيء يفتح من الرابط نفسه.'],
  ['هل الدردشة الصوتية متاحة؟', 'نعم، تتوفر غرف صوتية مفتوحة ومايكات مباشرة داخل {site} إضافة إلى مكالمات صوتية خاصة بين الأعضاء مع تسجيل اختياري.'],
  ['هل يوجد إشراف وحماية؟', 'يعمل فريق إشراف على مدار الساعة داخل {site}، وتتوفر أدوات كتم وطرد وتبليغ وحظر لضمان أجواء محترمة وآمنة للجميع.'],
  ['كيف أحافظ على اسمي ورصيدي؟', 'بإنشاء حساب مجاني في {site} تحتفظ باسمك وصورتك الشخصية ورصيد الهدايا وقائمة محادثاتك على أي جهاز تدخل منه.'],
  ['هل {site} يعمل على الجوال؟', 'نعم، واجهة {site} مصممة للجوال أولاً وتعمل على أندرويد وآيفون وجميع المتصفحات الحديثة باستهلاك منخفض للبيانات.'],
  ['هل يمكنني إرسال الصور والصوت؟', 'يمكنك إرسال الصور والمقاطع الصوتية المسجلة مباشرة داخل غرف {site}، مع معاينة قبل الإرسال وشريط تقدم أثناء الرفع.'],
  ['هل بياناتي الشخصية محفوظة؟', '{site} لا يطلب أي بيانات حساسة، ويمكنك استخدام الموقع كزائر، وتبقى المحادثات الخاصة محفوظة داخل حسابك فقط.']
];

// يبني حزمة محتوى فريدة كاملة (H1 + مقدمة + FAQ) لنمط ومسار محددين
function buildUniqueSeoContent(variationId, slug, siteName, baseName, region) {
  const seed = slugSeed(slug + '|' + variationId);
  const ctx = { site: siteName, base: baseName, region: region || baseName, slug };
  const h1Pool = SEO_H1_POOL[variationId] || SEO_H1_POOL.top_rank;
  const sentPool = SEO_SENTENCE_POOL[variationId] || SEO_SENTENCE_POOL.top_rank;
  const h1 = fillTemplate(pickBySeed(h1Pool, seed, 0), ctx);
  const sentences = pickMany(sentPool, seed, 4).map(t => fillTemplate(t, ctx));
  const intro = sentences.join(' ');
  const faq = pickMany(SEO_FAQ_POOL, seed, 3).map(([q, a]) => ({
    q: fillTemplate(q, ctx),
    a: fillTemplate(a, ctx)
  }));
  return { h1, intro, faq };
}
function pickVariationForSlug(slug, variations) {
  if (!Array.isArray(variations) || !variations.length) return null;
  return variations[slugSeed(slug || '') % variations.length];
}

// =====================================================
//  أيقونة الموقع المصغّرة (Favicon) — توليد فريد + جلب تلقائي
// =====================================================
const FAVICON_PALETTES = [
  ['#6366f1', '#a855f7'], ['#0ea5e9', '#22d3ee'], ['#f59e0b', '#ef4444'],
  ['#10b981', '#14b8a6'], ['#ec4899', '#8b5cf6'], ['#3b82f6', '#6366f1'],
  ['#f97316', '#facc15'], ['#14b8a6', '#0ea5e9'], ['#8b5cf6', '#ec4899'],
  ['#ef4444', '#f97316'], ['#0ea5e9', '#6366f1'], ['#22c55e', '#0ea5e9']
];
const FAVICON_GLYPHS = ['\u2605', '\u2726', '\u2740', '\u25c6', '\u273f', '\u2699', '\u2600', '\u25cf', '\u2727', '\u2764'];

// يولّد أيقونة SVG فريدة وثابتة لكل مسار (نفس المسار ⇒ نفس الأيقونة دائماً)
function generateSlugFavicon(slug) {
  const safe = String(slug || '').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'page';
  const seed = slugSeed(safe);
  const [c1, c2] = FAVICON_PALETTES[seed % FAVICON_PALETTES.length];
  const glyph = FAVICON_GLYPHS[(seed >> 3) % FAVICON_GLYPHS.length];
  const rot = (seed >> 5) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">`
    + `<defs><linearGradient id="g" gradientTransform="rotate(${rot} 0.5 0.5)">`
    + `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>`
    + `<rect width="64" height="64" rx="14" fill="url(#g)"/>`
    + `<text x="32" y="45" font-family="Arial,Helvetica,sans-serif" font-size="38" font-weight="700" text-anchor="middle" fill="#ffffff">${glyph}</text>`
    + `</svg>`;
  const file = safe + '.svg';
  try {
    fs.writeFileSync(path.join(__dirname, 'public/uploads/favicons', file), svg, 'utf8');
    return '/uploads/favicons/' + file;
  } catch (e) { return ''; }
}

// يجلب الأيقونة الحقيقية من أي موقع/رابط ويحفظها محلياً (3 محاولات بالترتيب)
async function downloadFaviconToDisk(targetUrl, slug) {
  let input = String(targetUrl || '').trim();
  if (!input) return '';
  if (!/^https?:\/\//i.test(input)) input = 'https://' + input;
  const candidates = [];
  if (/\.(ico|png|jpe?g|svg|webp)(\?|$)/i.test(input)) candidates.push(input);
  let host = '';
  try {
    const u = new URL(input);
    host = u.hostname;
    candidates.push(u.origin + '/favicon.ico');
    candidates.push('https://www.google.com/s2/favicons?domain=' + encodeURIComponent(u.hostname) + '&sz=64');
  } catch (e) { return ''; }

  for (const url of candidates) {
    let timer = null;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => { try { controller.abort(); } catch (e) { } }, 8000);
      const r = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NujumChatFaviconBot/1.0)' }
      });
      if (timer) clearTimeout(timer);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf || !buf.length) continue;
      const ct = String(r.headers.get('content-type') || '').toLowerCase();
      if (ct && ct.indexOf('image/') !== 0 && ct.indexOf('octet-stream') < 0) continue;
      if (buf.length > 1024 * 1024) continue;
      let ext = 'ico';
      if (ct.indexOf('svg') >= 0 || /\.svg(\?|$)/i.test(url)) ext = 'svg';
      else if (ct.indexOf('png') >= 0 || /\.png(\?|$)/i.test(url)) ext = 'png';
      else if (ct.indexOf('webp') >= 0) ext = 'webp';
      else if (ct.indexOf('jpeg') >= 0 || ct.indexOf('jpg') >= 0) ext = 'jpg';
      const safe = String(slug || 'favicon').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'favicon';
      const file = safe + '.' + ext;
      fs.writeFileSync(path.join(__dirname, 'public/uploads/favicons', file), buf);
      return '/uploads/favicons/' + file;
    } catch (e) {
      if (timer) clearTimeout(timer);
      // نجرّب المرشح التالي
    }
  }
  return '';
}

// يضمن أن لكل مسار أيقونة خاصة: المخصصة › أيقونة الموقع › أيقونة مولّدة فريدة
async function ensureSeoFavicon(page, settings) {
  if (page && String(page.favicon || '').trim()) return String(page.favicon).trim();
  // «توليد أيقونة فريدة لكل مسار» مفعّل افتراضياً: يجعل كل مسار يظهر بأيقونة
  // مختلفة في نتائج Google. يمكن توحيد الأيقونة من إعدادات الأرشفة الأساسية.
  const uniqueOn = !settings || String(settings.seo_unique_favicon || '1') !== '0';
  if (uniqueOn) {
    const gen = page && page.slug ? generateSlugFavicon(page.slug) : '';
    if (gen) {
      if (page && page.id && !String(page.favicon || '').trim()) {
        try { await q.run(`UPDATE seo_pages SET favicon=? WHERE id=? AND (favicon IS NULL OR favicon='')`, gen, page.id); } catch (e) { }
      }
      return gen;
    }
  }
  if (settings && String(settings.favicon_url || '').trim()) return String(settings.favicon_url).trim();
  const generated = generateSlugFavicon(page && page.slug);
  if (generated && page && page.id) {
    try {
      await q.run(`UPDATE seo_pages SET favicon=? WHERE id=? AND (favicon IS NULL OR favicon='')`, generated, page.id);
    } catch (e) { }
  }
  return generated || '/favicon.ico';
}

function faviconMime(href) {
  const h = String(href || '').toLowerCase();
  if (h.endsWith('.svg')) return 'image/svg+xml';
  if (h.endsWith('.png')) return 'image/png';
  if (h.endsWith('.webp')) return 'image/webp';
  if (h.endsWith('.jpg') || h.endsWith('.jpeg')) return 'image/jpeg';
  return 'image/x-icon';
}

// قاموس تحويل كلمات المسار الشائعة إلى عربية مقروءة
const SEO_SLUG_WORDS = {
  chat: 'شات', chatt: 'شات', shat: 'شات', shatt: 'شات', shabaka: 'شبكة', chatting: 'دردشة',
  voice: 'صوت', sawt: 'صوت', audio: 'صوتي', mic: 'مايك', live: 'مباشر', radio: 'راديو',
  room: 'غرفة', rooms: 'غرف', ghurfa: 'غرفة', talk: 'حوارات', love: 'تعارف', taarof: 'تعارف',
  arab: 'العرب', arabic: 'العربي', free: 'مجاني', gold: 'الذهب', star: 'نجوم', nujum: 'نجوم',
  jo: 'الأردن', jordan: 'الأردن', ardn: 'الأردن', sa: 'السعودية', ksaa: 'السعودية', eg: 'مصر',
  masr: 'مصر', iq: 'العراق', kw: 'الكويت', ae: 'الإمارات', qa: 'قطر', ma: 'المغرب',
  dz: 'الجزائر', sy: 'سوريا', lb: 'لبنان', ps: 'فلسطين', tn: 'تونس', om: 'عمان', ye: 'اليمن',
  bh: 'البحرين', sd: 'السودان', ly: 'ليبيا', vip: 'VIP', premium: 'بريميوم', plus: 'بلاس'
};

// يحوّل المسار إلى اسم موقع عربي فريد: chat1 ⇒ «شات 1»، voice-jo ⇒ «شات صوت الأردن»
function slugToSiteName(slug) {
  let raw = String(slug || '').toLowerCase().replace(/[_.]+/g, '-');
  raw = raw.replace(/([a-z؀-ۿ])(\d)/g, '$1 $2');   // chat1 ⇒ chat 1
  const parts = raw.split(/[-\s]+/).filter(Boolean);
  let words = parts.map(p => {
    if (/^\d+$/.test(p)) return p;
    if (SEO_SLUG_WORDS[p]) return SEO_SLUG_WORDS[p];
    return p.charAt(0).toUpperCase() + p.slice(1);
  });
  let name = words.join(' ').trim();
  if (!name) name = 'الدردشة';
  // ملاحظة: \b لا يعمل مع الحروف العربية (لأن \w يغطي ASCII فقط) — نستخدم مسافة أو نهاية النص
  return /^(شات|دردشة|شبكة)(\s|$)/.test(name) ? name : 'شات ' + name;
}

// المسارات الرقمية (chat1 / room3 …) تأخذ اسم الموقع + الرقم لتوحيد العلامة مع التفريد
function seoSlugSiteName(slug, brandName) {
  const derived = slugToSiteName(slug);
  const m = String(slug || '').toLowerCase().match(/^(?:chat|shat|chatt|shabaka|room|ghurfa|ch)(\d+)$/);
  if (m && brandName && String(brandName).trim()) return `${String(brandName).trim()} ${m[1]}`;
  return derived;
}

function generateSmartSeoPackages(inputName, customTopic, slug, currentSiteName) {
  let raw = String(customTopic || inputName || slug || currentSiteName || '\u0627\u0644\u062f\u0631\u062f\u0634\u0629 \u0627\u0644\u0639\u0631\u0628\u064a\u0629').trim();
  let target = raw.replace(/^[\/\s]+/, '');
  if (/^chat\d+$/i.test(target)) {
    target = target.replace(/chat(\d+)/i, '\u0634\u0627\u062a $1');
  }

  let baseName = target.replace(/^(\u0634\u0627\u062a|\u062f\u0631\u062f\u0634\u0629)\s+/i, '').trim() || target;
  if (!baseName) baseName = '\u0627\u0644\u0639\u0631\u0628';

  let siteName = target.startsWith('\u0634\u0627\u062a') || target.startsWith('\u062f\u0631\u062f\u0634\u0629') ? target : `\u0634\u0627\u062a ${target}`;

  const regions = [
    '\u0627\u0644\u0623\u0631\u062f\u0646', '\u0627\u0644\u0627\u0631\u062f\u0646', '\u0627\u0644\u0633\u0639\u0648\u062f\u064a\u0629', '\u0645\u0635\u0631', '\u0627\u0644\u062e\u0644\u064a\u062c', '\u0627\u0644\u0643\u0648\u064a\u062a', '\u0627\u0644\u0639\u0631\u0627\u0642', '\u0627\u0644\u0645\u063a\u0631\u0628',
    '\u0627\u0644\u062c\u0632\u0627\u0626\u0631', '\u0633\u0648\u0631\u064a\u0627', '\u0644\u0628\u0646\u0627\u0646', '\u0641\u0644\u0633\u0637\u064a\u0646', '\u0627\u0644\u0625\u0645\u0627\u0631\u0627\u062a', '\u0627\u0644\u0627\u0645\u0627\u0631\u0627\u062a', '\u062a\u0648\u0646\u0633', '\u0639\u0645\u0627\u0646',
    '\u0642\u0637\u0631', '\u0627\u0644\u064a\u0645\u0646', '\u0627\u0644\u0628\u062d\u0631\u064a\u0646', '\u0627\u0644\u0633\u0648\u062f\u0627\u0646', '\u0644\u064a\u0628\u064a\u0627', '\u0627\u0644\u0631\u064a\u0627\u0636', '\u062c\u062f\u0629', '\u0628\u063a\u062f\u0627\u062f', '\u0627\u0644\u0642\u0627\u0647\u0631\u0629', '\u062f\u0628\u064a'
  ];
  let matchedRegion = '';
  for (const reg of regions) {
    if (raw.includes(reg)) {
      matchedRegion = reg;
      break;
    }
  }

  const finalSlug = String(slug || inputName || siteName || 'page').trim();

  // 1. النمط الشامل والمتصدر (Google Top Ranking)
  const v1 = {
    id: 'top_rank',
    badge: '\u{1F451} النمط الشامل والمتصدر (Google Top Ranking)',
    site_name: siteName,
    title: `${siteName} | أفضل شات عربي صوتي وكتابي مجاني بدون تسجيل`,
    description: `انضم الآن إلى ${siteName} واستمتع بأقوى دردشة صوتية وكتابية مجانية بدون تسجيل. تعارف وتواصل فوري مع أصدقاء جدد في غرف محادثة متميزة وآمنة على مدار الساعة.`,
    keywords: `${siteName}, ${baseName}, شات ${baseName}, دردشة ${baseName}, موقع ${siteName}, شات صوتي, دردشة كتابية, شات مجاني, غرف دردشة, تعارف بدون تسجيل, شات عربي, شات جوال, دردشة فورية`
  };

  // 2. نمط الصوت والمايكات والبثوث المباشرة (Voice & Audio Focused)
  const v2 = {
    id: 'voice',
    badge: '\u{1F399}️ نمط الصوت والمايكات والبث المباشر',
    site_name: siteName,
    title: `${siteName} - غرف دردشة صوتية مباشرة وبث تفاعلي ومايكات مجانية`,
    description: `استمتع بأقوى تجربة شات صوتي تفاعلي وبث مباشر في ${siteName}. تحدث واستمع في غرف صوتية مفتوحة ومكالمات خاصة عالية الجودة ونقاء الصوت بدون اشتراك. ادخل وشارك الآن!`,
    keywords: `شات صوتي, ${siteName}, دردشة صوتية, شات صوتي ${baseName}, غرف مايكات, بث صوتي, مكالمات خاصة, شات مايك, تواصل صوتي مباشر, دردشة بدون تسجيل, مايكات عربية`
  };

  // 3. نمط التعارف والصداقة والمحادثات الراقية (Dating & Social Focus)
  const v3 = {
    id: 'dating',
    badge: '\u{1F91D} نمط التعارف والصداقة والمحادثات الراقية',
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
      badge: `\u{1F4CD} نمط مخصص لأهل ${matchedRegion}`,
      site_name: siteName,
      title: `${siteName} | شات ${matchedRegion} الأول للتعارف والدردشة الصوتية والكتابية`,
      description: `موقع ${siteName} ملتقى الأصدقاء وشباب وبنات ${matchedRegion}. دردشة صوتية وكتابية راقية وآمنة بدون تسجيل، تواصل مباشر وغرف مميزة بدون اشتراك. أهلاً بك معنا!`,
      keywords: `شات ${matchedRegion}, دردشة ${matchedRegion}, ${siteName}, شات ${baseName}, تعارف ${matchedRegion}, شات صوتي ${matchedRegion}, بنات ${matchedRegion}, شباب ${matchedRegion}, دردشة بدون تسجيل, شات جوال ${matchedRegion}`
    };
    variations.unshift(vRegion);
  }

  // نضيف لكل نمط محتوى فريداً (H1 + مقدمة + أسئلة شائعة) مشتقاً من بصمة المسار
  for (const v of variations) {
    const uni = buildUniqueSeoContent(v.id, finalSlug, v.site_name, baseName, matchedRegion);
    v.h1 = uni.h1;
    v.intro = uni.intro;
    v.faq = uni.faq;
  }

  // النمط الافتراضي المقترح: يُنتقى ببصمة المسار حتى لا يتشابه مساران متتاليان
  const auto = pickVariationForSlug(finalSlug, variations) || variations[0];

  return {
    data: auto,
    auto: auto,
    variations
  };
}

// يبني حزمة SEO كاملة وفريدة لمسار بمجرّد اسمه (بدون تدخل يدوي)
function buildAutoSeoPackage(slug, siteNameHint) {
  // لا نستخدم اسم الموقع العام هنا: لو استخدمناه لتشابهت كل المسارات (طبق أصل).
  // الاسم يُشتق من المسار نفسه، أو من الاسم الذي كتبه المدير يدوياً إن وُجد.
  const pkg = generateSmartSeoPackages(siteNameHint || slugToSiteName(slug), '', slug, '');
  const chosen = pkg.auto || pkg.variations[0];
  return {
    slug: String(slug || '').trim().toLowerCase(),
    title: chosen.title,
    description: chosen.description,
    keywords: chosen.keywords,
    site_name: chosen.site_name,
    h1: chosen.h1 || '',
    intro: chosen.intro || '',
    faq: chosen.faq || [],
    variation: chosen.id || ''
  };
}

app.post('/api/admin/seo-ai-generate', requireSuperAdmin, async (req, res) => {
  const { customTopic, name, slug } = req.body || {};
  const settings = await getSettings();
  const result = generateSmartSeoPackages(name, customTopic, slug, settings.site_name);
  res.json({ ok: true, data: result.data, auto: result.auto, variations: result.variations });
});

// ---- توليد حزمة SEO كاملة وفريدة لمسار بمجرّد اسمه (بدون كتابة يدوية) ----
app.post('/api/admin/seo-auto-package', requireSuperAdmin, async (req, res) => {
  const { slug, site_name, url } = req.body || {};
  const clean = String(slug || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!clean) return res.status(400).json({ error: 'اكتب اسم المسار أولاً (مثال: chat1)' });
  const settings = await getSettings();
  const pkg = buildAutoSeoPackage(clean, site_name || '');
  // أيقونة تلقائية: من رابط إن أُعطي، وإلا أيقونة فريدة مولّدة من بصمة المسار
  let fav = '';
  if (url && String(url).trim()) fav = await downloadFaviconToDisk(url, clean);
  if (!fav) fav = settings.favicon_url || generateSlugFavicon(clean);
  res.json({ ok: true, ...pkg, favicon: fav });
});

// ---- جلب/توليد أيقونة الموقع المصغّرة (Favicon) تلقائياً ----
app.post('/api/admin/seo-favicon/auto', requireSuperAdmin, async (req, res) => {
  const { slug, url } = req.body || {};
  const clean = String(slug || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!clean) return res.status(400).json({ error: 'اكتب اسم المسار أولاً' });
  let favPath = '';
  let downloaded = false;
  if (url && String(url).trim()) {
    favPath = await downloadFaviconToDisk(url, clean);
    downloaded = !!favPath;
  }
  if (!favPath) favPath = generateSlugFavicon(clean);
  if (!favPath) return res.status(500).json({ error: 'تعذر إنشاء الأيقونة' });
  // إن كان المسار محفوظاً أصلاً نحدّث أيقونته مباشرة
  try { await q.run(`UPDATE seo_pages SET favicon=? WHERE slug=?`, favPath, clean); } catch (e) { }
  res.json({ ok: true, path: favPath, fetched: downloaded });
});

// ---- فحص التكرار بين المسارات (Duplicate Content Checker) ----
app.get('/api/admin/seo-duplicates', requireSuperAdmin, async (req, res) => {
  const rows = await q.all(`SELECT id, slug, title, description, keywords, h1, intro FROM seo_pages ORDER BY id ASC`);
  const norm = v => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const groups = [];
  const addGroup = (field, label, items) => {
    if (items && items.length > 1) {
      groups.push({ field, label, value: items[0].value, count: items.length, slugs: items.map(x => x.slug) });
    }
  };
  for (const field of ['title', 'description', 'keywords', 'h1']) {
    const map = new Map();
    for (const r of rows) {
      const val = norm(r[field]);
      if (!val) continue;
      if (!map.has(val)) map.set(val, []);
      map.get(val).push({ slug: r.slug, value: r[field] });
    }
    const labels = { title: 'العنوان', description: 'الوصف', keywords: 'الكلمات المفتاحية', h1: 'عنوان H1' };
    for (const items of map.values()) addGroup(field, labels[field] || field, items);
  }
  // مسارات بلا محتوى فريد
  const missing = rows.filter(r => !norm(r.h1) || !norm(r.intro)).map(r => r.slug);
  res.json({
    ok: true,
    total: rows.length,
    duplicateGroups: groups,
    missingContent: missing,
    score: rows.length ? Math.max(0, 100 - groups.length * 12 - missing.length * 6) : 100
  });
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
    merchant_holder_name: s.merchant_holder_name || 'إدارة الدردشة المعتمدة',
    merchant_iban: s.merchant_iban || '',
    paypal_enabled: s.paypal_enabled !== '0' ? 1 : 0,
    paypal_client_id: s.paypal_client_id || '',
    // لا نُعيد قيمة الـ secret أبداً لأسباب أمنية، لكن نُعلم الواجهة إن كان
    // مفتاحاً محفوظاً مسبقاً كي تعرض «المفتاح محفوظ ✓» وتُبقيه عند الحفظ الفارغ.
    paypal_has_secret: !!s.paypal_secret,
    paypal_mode: s.paypal_mode || 'live',
    paypal_currency: s.paypal_currency || 'USD'
  });
});

app.post('/api/admin/payment-settings', requireSuperAdmin, async (req, res) => {
  const { merchant_bank_name, merchant_holder_name, merchant_iban, paypal_client_id, paypal_secret, paypal_mode, paypal_currency, paypal_enabled } = req.body || {};
  // لو تُرك حقل secret فارغاً نُبقي المفتاح الحالي (لا نمسحه دون قصد).
  const cur = await getSettings();
  const finalSecret = String(paypal_secret || '').trim() || cur.paypal_secret || '';
  const finalClientId = String(paypal_client_id || '').trim() || cur.paypal_client_id || '';
  // نُبقي حقول الحساب المصرفي/الآيبان (معلومات إيداع إضافية) كما هي، ثم نحفظ مفاتيح PayPal.
  await q.run(`INSERT INTO settings (key,value) VALUES ('merchant_bank_name',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, String(merchant_bank_name || ''));
  await q.run(`INSERT INTO settings (key,value) VALUES ('merchant_holder_name',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, String(merchant_holder_name || ''));
  await q.run(`INSERT INTO settings (key,value) VALUES ('merchant_iban',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, String(merchant_iban || ''));
  await q.run(`INSERT INTO settings (key,value) VALUES ('paypal_client_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, finalClientId);
  await q.run(`INSERT INTO settings (key,value) VALUES ('paypal_secret',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, finalSecret);
  await q.run(`INSERT INTO settings (key,value) VALUES ('paypal_mode',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, String(paypal_mode || 'live') === 'sandbox' ? 'sandbox' : 'live');
  await q.run(`INSERT INTO settings (key,value) VALUES ('paypal_currency',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, String(paypal_currency || 'USD').toUpperCase());
  await q.run(`INSERT INTO settings (key,value) VALUES ('paypal_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, paypal_enabled ? '1' : '0');
  // إزالة مفاتيح الدفع بالبطاقة غير الحقيقية نهائياً.
  await q.run(`DELETE FROM settings WHERE key IN ('card_payment_enabled','card_currency','merchant_card_number')`);
  io.emit('sync');
  res.json({ ok: true });
});

// اختبار الاتصال بـ PayPal: يتأكد من صحة مفاتيح OAuth (Client ID + Secret) ويعيد
// نتيجة مخصّصة للمشرف ليُدرك فوراً سبب فشل الدفع (مفاتيح خاطئة / وضع غير مطابق / صندوق تجارب).
app.post('/api/admin/paypal/test', requireSuperAdmin, async (req, res) => {
  const s = await getSettings();
  if (!s.paypal_client_id || !s.paypal_secret) {
    return res.json({ ok: false, message: 'لم تُدخل مفاتيح PayPal بعد — أدخل Client ID وSecret ثم احفظ.' });
  }
  const mode = s.paypal_mode === 'sandbox' ? 'sandbox' : 'live';
  const clientId = String(s.paypal_client_id || '').trim();
  const secret = String(s.paypal_secret || '').trim();
  try {
    const token = await paypalAccessToken(clientId, secret, mode);
    // نجرّب فعلياً إنشاء طلب دفع بمبلغ رمزي (لا يُخصم أي مبلغ — إنشاء أمر فقط)
    // حتى نكشف قيد «الحساب التجاري مقيد» (merchant account is restricted) الذي
    // يمنع قبول الدفعات رغم صحة المفاتيح.
    const currency = String(s.paypal_currency || 'USD').toUpperCase();
    const testOrder = await paypalCreateOrder(token, 1.00, currency, mode, {
      brand_name: s.site_name || 'نجوم العرب',
      description: 'اختبار صلاحية الحساب التجاري (لا يُخصم أي مبلغ)'
    });
    const base = paypalApiBase(mode);
    return res.json({
      ok: true,
      mode,
      base,
      message: `جيّد! المفاتيح صحيحة ويمكن للحساب التجاري إنشاء عمليات دفع (${mode === 'sandbox' ? 'وضع تجريبي' : 'وضع حي'}).`
    });
  } catch (err) {
    const status = err && err.httpStatus ? ` (HTTP ${err.httpStatus})` : '';
    const msg = ((err && err.message) || 'تعذر الاتصال بـ PayPal') + status;
    const isRestricted = /merchant account is restricted|account is restricted|restricted/i.test(msg);
    const hint = isRestricted
      ? ' — الحساب التجاري مقيد/محدود لدى PayPal ولا يستطيع قبول الدفعات. يجب حل هذا القيد من لوحة حساب PayPal نفسه: فعّل الحساب (verify)، أكمل بيانات العمل، وتأكد أن التطبيق REST «Live» تابع لحساب تجاري موثّق. إن كنت تستخدم وضع «تجريبي»، أنشئ حساب Business مفعّل في Sandbox بدل حساب شخصي.'
      : (/401|unauthorized|invalid client|invalid_client/i.test(msg)
        ? ' — يرجى التحقق من صحة Client ID وSecret، وأنهما لتطبيق REST نفسه، وأن الوضع (حي/تجريبي) يطابق نوع الحساب.'
        : (mode === 'live' ? ' — تأكد أن الحساب تجاري موثّق (Business) وأن الوضع «حي».' : ''));
    return res.json({ ok: false, message: msg + hint });
  }
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
  'bans', 'ip_mutes', 'room_kicks', 'verified', 'royal_users', 'notifications', 'notification_reads', 'notification_hides',
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
app.get('/api/admin/complaints', requireSuperAdmin, async (req, res) => res.json(await q.all(`SELECT * FROM complaints ORDER BY id DESC LIMIT 200`)));
app.delete('/api/admin/complaints/:id', requireSuperAdmin, async (req, res) => {
  const r = await q.run(`DELETE FROM complaints WHERE id=?`, +req.params.id);
  res.json({ ok: true, deleted: r.changes || 0 });
});

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
    wave_enabled: s.wave_enabled !== undefined ? s.wave_enabled : '1',
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
    // أصوات الإشعارات المخصصة (روابط الملفات المرفوعة من لوحة الإدارة) — تُشغَّل بدل النغمة الافتراضية
    snd_join_url: s.snd_join_url || '',
    snd_msg_url: s.snd_msg_url || '',
    snd_leave_url: s.snd_leave_url || '',
    // الراديو المباشر: يُدار من لوحة التحكم (اسم + رابط بث + تفعيل) ويظهر مشغله أعلى الدردشة
    radio_enabled: s.radio_enabled !== undefined ? s.radio_enabled : '0',
    radio_name: s.radio_name || '',
    radio_url: s.radio_url || '',
    msg_max: normalizePublicMessageMaxLength(s.msg_max),
    public_message_spacing_px: normalizePublicMessageSpacing(s.public_message_spacing_px),
    public_message_name_size_px: normalizePublicMessageNameSize(s.public_message_name_size_px),
    public_message_body_width: normalizePublicMessageBodyWidth(s.public_message_body_width),
    call_cost: Math.max(1, parseInt(s.call_cost) || 2),
    video_call_cost: normalizeNonNegativeCost(s.video_call_cost, 5),
    video_call_allowed_memberships: s.video_call_allowed_memberships !== undefined ? s.video_call_allowed_memberships : 'mmez,plus,premium,vip',
    register_gold: Math.max(0, parseInt(s.register_gold) !== undefined ? +s.register_gold : 10),
    favicon_url: s.favicon_url || '',
    seo_title: s.seo_title || '',
    vip_cost: +s.vip_cost || 30,
    premium_cost: +s.premium_cost || 20,
    plus_cost: +s.plus_cost || 10,
    terms_text: s.terms_text || '',
    privacy_text: s.privacy_text || ''
  };
  for (const badgeSizeKey of PUBLIC_MESSAGE_BADGE_SETTING_KEYS) {
    const fallbackSize = badgeSizeKey === 'msg_badge_hidden_admin_size' ? 28 : 24;
    sanitized[badgeSizeKey] = normalizePublicMessageBadgeSize(s[badgeSizeKey], fallbackSize);
  }
  res.json({
    ok: true,
    status: 'synced',
    _ts: Date.now(),
    _m: encodeObfuscatedPayload(sanitized)
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

  const host = (req && (req.headers['x-forwarded-host'] || req.headers.host)) || 'localhost:443';
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
    favicon = await ensureSeoFavicon(seo, settings);
  } else {
    siteName = settings.site_name || 'الدردشة العربية';
    title = settings.seo_title || `${siteName} | أفضل شات عربي كتابي وصوتي مجاني بدون تسجيل`;
    desc = settings.seo_description || `انضم الآن إلى ${siteName}، منصة الدردشة العربية الأولى للتواصل الصوتي والكتابي المباشر مجاناً بدون تسجيل. غرف محادثة متميزة وآمنة على مدار الساعة.`;
    keywords = settings.seo_keywords || `${siteName}, شات, دردشة صوتية, شات صوتي, دردشة كتابية, شات عربي, تعارف, غرف دردشة, شات جوال`;
    image = settings.seo_image || settings.logo_url || '/img/announcement.png';
    favicon = settings.favicon_url || generateSlugFavicon('site') || '/favicon.ico';
  }

  const fullImageUrl = image.startsWith('http://') || image.startsWith('https://') ? image : `${proto}://${host}${image.startsWith('/') ? image : '/' + image}`;

  // محتوى نصي فريد لكل مسار: عنوان H1 + فقرة تعريفية + أسئلة شائعة.
  // يُبنى من بصمة المسار إن لم تكن الإدارة قد كتبته يدوياً، فيختلف من مسار لآخر.
  let pageH1 = (seo && String(seo.h1 || '').trim()) || '';
  let pageIntro = (seo && String(seo.intro || '').trim()) || '';
  let pageFaq = [];
  try {
    const pkg = buildAutoSeoPackage(isCustomSlug ? slug : 'home', siteName);
    if (!pageH1) pageH1 = pkg.h1;
    if (!pageIntro) pageIntro = pkg.intro;
    pageFaq = Array.isArray(pkg.faq) ? pkg.faq : [];
  } catch (e) { }

  const seoBody = `
<div class="seo-only" id="seoLandingContent">
  <h1>${esc(pageH1 || title)}</h1>
  <p>${esc(pageIntro || desc)}</p>
  ${pageFaq.length ? `<h2>الأسئلة الشائعة حول ${esc(siteName)}</h2>` + pageFaq.map(f => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('\n  ') : ''}
</div>`;

  const faqSchema = pageFaq.length ? `
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": ${JSON.stringify(pageFaq.map(f => ({
    "@type": "Question",
    "name": f.q,
    "acceptedAnswer": { "@type": "Answer", "text": f.a }
  })))}
}
</script>` : '';

  const metaTags = `
<title id="pageDocTitle">${esc(title)}</title>
<link rel="canonical" href="${esc(pageUrl)}">
<link rel="icon" id="pageFavicon" href="${esc(favicon)}" type="${faviconMime(favicon)}">
<link rel="apple-touch-icon" href="${esc(favicon)}">
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
${faqSchema}
<script>window.SEO_PAGE_CONFIG = ${JSON.stringify({ slug, title, description: desc, keywords, logo_image: image, site_name: siteName, favicon, page_url: pageUrl, h1: pageH1 })};</script>
  `.trim();

  indexHtml = indexHtml.replace(/<title[\s\S]*?<\/title>/i, metaTags);
  // المحتوى الفريد يُحقن مباشرة بعد <body> حتى تراه محركات البحث قبل أي سكربت
  if (indexHtml.indexOf('id="seoLandingContent"') === -1) {
    indexHtml = indexHtml.replace(/<body([^>]*)>/i, (m, attrs) => `<body${attrs}>\n${seoBody}`);
  }
  return indexHtml;
}

// ---------- خريطة الموقع (sitemap.xml) وملف robots.txt ----------
// يعرضان كل مسارات الأرشفة المفعّلة تلقائياً؛ أي مسار جديد يضاف للوحة التحكم
// يظهر هنا فوراً دون أي إعداد إضافي.
function siteBaseUrl(req) {
  const host = String((req && (req.headers['x-forwarded-host'] || req.headers.host)) || '').trim();
  const proto = String((req && (req.headers['x-forwarded-proto'] || req.protocol)) || 'https').split(',')[0].trim();
  return `${proto}://${host}`;
}

app.get('/sitemap.xml', async (req, res) => {
  try {
    const rows = await q.all(`SELECT slug, updated_at, created_at FROM seo_pages WHERE active=1 ORDER BY id ASC`);
    const base = siteBaseUrl(req);
    const iso = ts => {
      const n = Number(ts || 0);
      const d = n > 0 ? new Date(n * 1000) : new Date();
      return d.toISOString().replace(/\.\d+Z$/, '+00:00');
    };
    const urls = [];
    urls.push(`  <url>\n    <loc>${base}/</loc>\n    <lastmod>${iso(Math.floor(Date.now() / 1000))}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>`);
    for (const r of rows) {
      urls.push(`  <url>\n    <loc>${base}/${String(r.slug)}</loc>\n    <lastmod>${iso(r.updated_at || r.created_at)}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`);
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('application/xml').send(xml);
  } catch (e) {
    res.status(500).type('text/plain').send('sitemap error');
  }
});

app.get('/robots.txt', async (req, res) => {
  const base = siteBaseUrl(req);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type('text/plain').send(
    `User-agent: *\n` +
    `Allow: /\n` +
    `\n` +
    `# منع زحف محركات البحث إلى صفحات الإدارة والواجهات البرمجية منعاً باتاً\n` +
    `Disallow: /admin\n` +
    `Disallow: /admin.html\n` +
    `Disallow: /admin/\n` +
    `Disallow: /api/\n` +
    `Disallow: /socket.io/\n` +
    `Disallow: /*token=\n` +
    `Disallow: /*?token=\n` +
    `\n` +
    `Sitemap: ${base}/sitemap.xml\n`
  );
});

app.get('/', async (req, res) => {
  // صفحات الأرشفة قابلة للفهرسة: نُحسّن الكاش ليتمكن محرك البحث من تخزين/إعادة
  // معاينة الصفحة (بدلاً من no-store الذي يُبعد الصفحة عن التخزين وقد يسبّب
  // «مكتشفة - غير مفهرسة»). المحتوى الديناميكي يُحمَّل عبر JS/API فلا يتأثر.
  res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  // (أُلغيت بوابة الحماية وفقاً لطلب المالك — لا حظر على VPN/متصفحات/روبوتات)
  try {
    const html = await renderSeoChatHtml('default', req);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    res.sendFile(path.join(__dirname, 'public/index.html'));
  }
});

app.get('/:slug', async (req, res, next) => {
  // صفحات الأرشفة قابلة للفهرسة: كاش قصير يساعد محركات البحث على التأكد من الصفحة.
  res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  const slug = String(req.params.slug || '').trim().toLowerCase();
  if (RESERVED_SLUGS.has(slug) || slug.includes('.')) return next();
  // (أُلغيت بوابة الحماية وفقاً لطلب المالك — لا حظر على VPN/متصفحات/روبوتات)
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
// مهلة سماح للبث الصوتي/المرئي عند انقطاع مؤقت في WebSocket (تجميد تبويب خلفي/تقلّب الشبكة):
// لا نُنزل المذيع من البث ولا نُغلق اتصالات WebRTC فوراً بل ننتظر لحظات؛ فإن عاد اتصاله
// قبل انتهاء المهلة يستمر بثّه بلا انقطاع، وإلا نُنظّف بثّه كالمعتاد.
const PENDING_BCAST_CLEANUP = new Map();
const BCAST_DISCONNECT_GRACE_MS = 5000;
function cancelPendingBroadcastCleanup(uid, roomId) {
  const key = roomLeaveKey(uid, roomId);
  const pending = PENDING_BCAST_CLEANUP.get(key);
  if (!pending) return false;
  clearTimeout(pending);
  PENDING_BCAST_CLEANUP.delete(key);
  return true;
}
function scheduleBroadcastCleanup(uid, roomId) {
  const key = roomLeaveKey(uid, roomId);
  const existing = PENDING_BCAST_CLEANUP.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    PENDING_BCAST_CLEANUP.delete(key);
    // إن عاد المستخدم بجلسة ظاهرة قبل انتهاء المهلة يُلغى التنظيف تلقائياً؛
    // وإلا نُزيله من البث ونخبر الأطراف المعنية.
    if (!userStillHasVisibleSocketInRoom(uid, roomId)) cleanupBroadcastForUser(roomId, uid);
  }, BCAST_DISCONNECT_GRACE_MS);
  PENDING_BCAST_CLEANUP.set(key, timer);
}
// =====================================================
//  البث المباشر (فيديو/صوت) داخل الغرف — إشارات WebRTC عبر Socket.IO
//  - الغرف الافتراضية (type != 'voice'): بث فيديو، المشاهدة تتطلب طلب وموافقة المذيع.
//  - الغرف الصوتية (type == 'voice'): بث صوتي، يسمع الجميع تلقائياً بدون طلب.
// =====================================================
// roomId -> { mode:'video'|'audio', hosts:Map(uid -> {id,username,avatar,badge,socketId,startedAt}), primaryHostId, startedAt,
//             viewers:Set(uid), pending:Map(viewerUid -> Map(hostId -> {username,avatar})), speakPending:Map(uid -> {username,avatar}),
//             viewerOf:Map(viewerUid -> Set(hostUid)) }
//   ← للفيديو: كل مشاهد يمكنه متابعة أكثر من مذيع في نفس الوقت، وكل علاقة مشاهدة مستقلة بموافقة صاحب البث وحده.
//     لا يُغلق أي بث مقبول عند قبول بث آخر — الاثنان يعملان معاً طالما وافق كل مذيع على طلبه.
const roomBroadcast = {};

// ===== مساعدات علاقات المشاهدة (فيديو: مشاهدات متعددة متزامنة) =====
function bcastWatchSet(b, viewerId, create = false) {
  if (!b) return null;
  if (!b.viewerOf) b.viewerOf = new Map();
  let set = b.viewerOf.get(viewerId);
  if (!set && create) { set = new Set(); b.viewerOf.set(viewerId, set); }
  return set || null;
}
function bcastIsWatching(b, viewerId, hostId) {
  const set = b && b.viewerOf ? b.viewerOf.get(viewerId) : null;
  return !!(set && set.has(hostId));
}
function bcastAddWatch(b, viewerId, hostId) { bcastWatchSet(b, viewerId, true).add(hostId); }
function bcastRemoveWatch(b, viewerId, hostId) {
  const set = b && b.viewerOf ? b.viewerOf.get(viewerId) : null;
  if (!set || !set.delete(hostId)) return false;
  if (!set.size) b.viewerOf.delete(viewerId);
  return true;
}
function bcastPendingMap(b, viewerId, create = false) {
  if (!b) return null;
  if (!b.pending) b.pending = new Map();
  let map = b.pending.get(viewerId);
  if (!map && create) { map = new Map(); b.pending.set(viewerId, map); }
  return map || null;
}
function bcastRemovePending(b, viewerId, hostId) {
  const map = b && b.pending ? b.pending.get(viewerId) : null;
  if (!map || !map.delete(hostId)) return false;
  if (!map.size) b.pending.delete(viewerId);
  return true;
}
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
  const viewersCount = b.mode === 'video' ? (b.viewerOf ? b.viewerOf.size : 0) : b.viewers.size;
  return { mode: b.mode, hosts: [...b.hosts.values()], primaryHostId: b.primaryHostId, startedAt: b.startedAt, viewers: viewersCount };
}
// صلاحية الصعود للبث تُدار حسب العضوية من لوحة الإدارة؛ الشخص المكتوم مستمع فقط.
async function canStartVideoBroadcast(user) {
  if (!user || user.muted || user.broadcast_banned) return false;
  return canUseMembershipFeature(user.id, 'broadcast_allowed_memberships');
}
async function canStartAudioBroadcast(user) {
  if (!user || user.muted || user.broadcast_banned) return false;
  return canUseMembershipFeature(user.id, 'broadcast_allowed_memberships');
}
function endBroadcast(roomId, reason = 'ended') {
  roomId = +roomId;
  if (!roomBroadcast[roomId]) return;
  delete roomBroadcast[roomId];
  io.to('room_' + roomId).emit('bcast:stopped', { roomId, reason });
}
// هل يملك مستخدمٌ ما صلاحية إشراف في الغرفة المحددة؟ (إدارة عامة أو مشرف غرفة)
async function socketCanModerate(uidValue, roomId) {
  const mod = await q.get(`SELECT rank FROM users WHERE id=?`, +uidValue);
  if (!mod) return false;
  if (['admin', 'superadmin', 'supermaster'].includes(mod.rank)) return true;
  const ra = await q.get(`SELECT id FROM room_admins WHERE room_id=? AND user_id=?`, +roomId, +uidValue);
  return !!ra;
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
  if (b.mode === 'video') {
    // [بثوث فيديو مستقلة] تنقطع فقط مشاهدة بث هذا المذيع تحديداً؛ أي بث آخر مقبول لدى نفس المشاهد يبقى شغالاً
    if (b.viewerOf) {
      for (const [viewerId, watchedHosts] of [...b.viewerOf.entries()]) {
        if (viewerId === uid) continue;
        if (watchedHosts.delete(uid)) {
          if (!watchedHosts.size) b.viewerOf.delete(viewerId);
          io.to('user_' + viewerId).emit('bcast:watch_ended', { roomId, hostId: uid });
        }
      }
      // إن كان المذيع المغادر نفسه يشاهد مذيعين آخرين، أغلق مشاهداته كلها وأعلِم كل واحد منهم
      const hisWatches = b.viewerOf.get(uid);
      if (hisWatches) {
        b.viewerOf.delete(uid);
        for (const hostId of hisWatches) io.to('user_' + hostId).emit('bcast:viewer_left', { roomId, userId: uid });
      }
    }
    // ألغِ أي طلبات مشاهدة كانت موجّهة تحديداً لهذا المذيع بما أنه لم يعد يبث (بقية الطلبات تبقى معلّقة)
    if (b.pending && b.pending.size) {
      for (const [viewerId, reqs] of [...b.pending.entries()]) {
        if (viewerId === uid) continue;
        if (reqs.delete(uid)) {
          if (!reqs.size) b.pending.delete(viewerId);
          io.to('user_' + viewerId).emit('bcast:watch_response', { roomId, accept: false, hosts: [], hostId: uid, reason: 'host_ended' });
        }
      }
      // وإن كان للمغادر طلبات مشاهدة معلّقة لدى مذيعين آخرين، ألغِها
      const hisReqs = b.pending.get(uid);
      if (hisReqs) {
        b.pending.delete(uid);
        for (const hostId of hisReqs.keys()) io.to('user_' + hostId).emit('bcast:watch_cancelled', { roomId, userId: uid });
      }
    }
  } else if (b.pending && b.pending.size) {
    for (const [viewerId, reqs] of [...b.pending.entries()]) {
      if (reqs.delete(uid)) {
        if (!reqs.size) b.pending.delete(viewerId);
        io.to('user_' + viewerId).emit('bcast:watch_response', { roomId, accept: false, hosts: [], hostId: uid });
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
  if (b.mode === 'video') {
    // فيديو: قد يكون المشاهد مرتبطاً بعدة مذيعين — يُعلم كل مذيع كان يشاهده
    const reqs = b.pending && b.pending.get(uid);
    if (reqs) {
      b.pending.delete(uid);
      for (const hostId of reqs.keys()) io.to('user_' + hostId).emit('bcast:watch_cancelled', { roomId, userId: uid });
    }
    const watchedHosts = b.viewerOf ? b.viewerOf.get(uid) : null;
    if (watchedHosts) {
      b.viewerOf.delete(uid);
      for (const hostId of watchedHosts) io.to('user_' + hostId).emit('bcast:viewer_left', { roomId, userId: uid });
    }
    return;
  }
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
    const uid = +activeSocket.data.userId;
    if (isAlwaysHiddenRank((onlineUsers[uid] || {}).rank || activeSocket.data.userRank)) continue;
    const hiddenRooms = [...(activeSocket.data.hiddenRooms || [])];
    for (const roomId of hiddenRooms) {
      activeSocket.data.hiddenRooms.delete(+roomId);
      activeSocket.emit('hidden_mode_changed', { roomId: +roomId, hidden: false });
      (roomUsers[roomId] = roomUsers[roomId] || new Set()).add(uid);
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
  // كل حدث تطبيق وارد يمر من هنا قبل مستمعه. تزال & فقط من حقول النصوص
  // الظاهرة، بينما تبقى حزم WebRTC والروابط والمسارات وبيانات البروتوكول سليمة.
  socket.use((packet, next) => {
    try {
      sanitizeSocketEventPacket(packet);
      next();
    } catch (error) {
      console.warn('[Packet sanitizer] تم رفض حزمة نصية غير قابلة للتنظيف:', error.message);
      next(new Error('حزمة نصية غير صالحة'));
    }
  });

  const isChatPage = socket.handshake.auth && socket.handshake.auth.client === 'chat';
  // (أُلغيت بوابة الحماية وفقاً لطلب المالك — لا حظر على VPN/متصفحات/روبوتات)
  const socketToken = isChatPage ? String(socket.handshake.auth.token || '') : '';
  const tokenAuth = isChatPage ? chatAuthByToken(socketToken) : null;
  const sess = socket.request.session;
  const uid = tokenAuth ? +tokenAuth.uid : (!isChatPage && sess && sess.uid ? +sess.uid : 0);
  if (!uid) { socket.disconnect(); return; }
  let me = await q.get(`SELECT * FROM users WHERE id=?`, uid);
  if (!me) { socket.disconnect(); return; }
  // حساب مسجل لديه بريد غير مُفعَّل: لا يدخل الدردشة حتى يُفعَّل برمز التحقق.
  // الحسابات بلا بريد (قديمة أو فُكّ بريدُها) تدخل مباشرة.
  if (me.registered && !me.email_verified && (me.email || me.pending_activation)) {
    socket.emit('needs_verification', { email: me.email || '' });
    setTimeout(() => { try { socket.disconnect(true); } catch (e) { } }, 300);
    return;
  }
  // تسجيل الاتصال فور تأكيد وجود المستخدم (قبل بقية الفحوصات) حتى يكون
  // «الحضور» صحيحاً للطلبات التي تصل قبل اكتمال بقية تهيئة المتصل.
  const mePub = { ...pubUser(me), badge: badgeOf(me) };
  onlineUsers[uid] = mePub;
  (userSockets[uid] = userSockets[uid] || []).push(socket.id);
  // الخروج المبكر (تعارض جلسة / حظر) يجب ألا يترك أثراً وهمياً في قوائم الحضور،
  // لأن مستمع disconnect لم يُسجَّل بعد عند هذه النقطة.
  const abortConnection = () => {
    userSockets[uid] = (userSockets[uid] || []).filter(id => id !== socket.id);
    if (userSockets[uid].length === 0) { delete userSockets[uid]; delete onlineUsers[uid]; }
  };
  // منع الدخول من جهاز آخر: إن كان هذا الرمز لم يعد الرمز النشط للحساب المسجّل
  // (دخل شخص آخر بالحساب) نُنهي هذه المحاولة فوراً ونعرض «تم الدخول من جهاز آخر».
  if (me.registered && isChatPage && socketToken && USER_ACTIVE_TOKEN.has(uid)) {
    const activeToken = USER_ACTIVE_TOKEN.get(uid);
    if (activeToken && activeToken !== socketToken) {
      socket.emit('session_conflict', {
        reason: 'session_conflict',
        text: 'تم تسجيل الدخول إلى حسابك من جهاز آخر. تم إنهاء الجلسة الحالية.'
      });
      abortConnection();
      setTimeout(() => { try { socket.disconnect(true); } catch (e) { } }, 300);
      return;
    }
  }
  const clientIp = validIp(requestIp(socket.request))
    || validIp(tokenAuth && tokenAuth.ip)
    || validIp(socket.handshake.address)
    || 'غير معروف';
  const clientDeviceId = validDeviceId(tokenAuth && tokenAuth.deviceId) || requestDeviceId(socket.request);
  const activeBan = await deviceBan(clientDeviceId) || await persistentBanForRequest(socket.request, me);
  if (activeBan) {
    socket.emit('banned', persistentBanPayload(activeBan));
    abortConnection();
    setTimeout(() => socket.disconnect(true), 100);
    return;
  }
  if (tokenAuth && CHAT_TOKENS.has(socketToken)) CHAT_TOKENS.get(socketToken).rank = me.rank;
  socket.data.chatToken = socketToken;
  socket.data.userId = uid;
  socket.data.userRank = me.rank;
  socket.data.registered = me.registered ? 1 : 0;
  socket.data.clientIp = clientIp;
  socket.data.deviceId = clientDeviceId;
  socket.data.connectedAt = Date.now();
  socket.data.joinedRooms = new Set();
  socket.data.hiddenRooms = new Set();

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
    const alwaysHidden = isAlwaysHiddenRank(me.rank);
    const canChooseHidden = me.rank === 'superadmin' || me.rank === 'admin';
    const enterHidden = alwaysHidden || (!!options.hidden && canChooseHidden && hiddenSetting);
    if (room.status !== 'open' && !isAdm)
      return done({ ok: false, reason: 'closed', text: '🔒 هذه الغرفة مغلقة حالياً من الإدارة' });
    if (room.password && !isAdm) {
      if (!pwd) return done({ ok: false, reason: 'password' });                 // يتطلب كلمة مرور
      if (String(pwd) !== String(room.password)) return done({ ok: false, reason: 'wrong_pass' });   // خاطئة — لا يدخل
    }
    roomId = +roomId;
    const restoredConnection = cancelPendingRoomLeave(uid, roomId);
    // عاد المستخدم قبل انتهاء مهلة سماح البث؟ ألغِ أي تنظيف مجدول له لكي يستمر بثّه/استماعه دون انقطاع.
    cancelPendingBroadcastCleanup(uid, roomId);
    if (socket.data.joinedRooms.has(roomId)) {
      const lastMsgRow = await q.get(`SELECT COALESCE(MAX(id),0) lastId FROM messages WHERE room_id=?`, roomId);
      return done({ ok: true, hidden: socket.data.hiddenRooms.has(roomId), restored: restoredConnection, broadcast: broadcastPublicState(roomId), lastMsgId: +lastMsgRow.lastId || 0 });
    }
    socket.join('room_' + roomId);
    socket.data.joinedRooms.add(roomId);
    if (enterHidden) socket.data.hiddenRooms.add(roomId);
    else (roomUsers[roomId] = roomUsers[roomId] || new Set()).add(uid);

    // عند استعادة اتصال منقطع لا نرسل دخولاً أو ترحيباً جديداً؛ الجلسة نفسها مستمرة.
    if (!enterHidden && !restoredConnection) {
      if (!ROYAL_MAP.has(me.username)) {
        // فحص فوري (دقة لحظة الدخول) في حال أُنيطت الملكية قبل لحظات
        try {
          const royalRow = await q.get(`SELECT animal FROM royal_users WHERE username=?`, me.username);
          if (royalRow) ROYAL_MAP.set(me.username, royalRow.animal || 'lion');
        } catch (e) {}
      }
      if (ROYAL_MAP.has(me.username)) {
        const royalAnimal = ROYAL_MAP.get(me.username) || 'lion';
        emitRoomSystemEvent(roomId, 'join', `👑 تفضّلوا بالترحيب بـ ${me.username} — دخول ملكي 👑`);
        const royalRowFull = royalAnimalRow(royalAnimal);
        io.to('room_' + roomId).emit('royal_enter', {
          username: me.username, avatar: me.avatar || '',
          animal: royalAnimal, gender: me.gender || 'secret',
          gif: royalRowFull ? royalRowFull.gif : '', sound: royalRowFull ? royalRowFull.sound : ''
        });
      } else {
        emitRoomSystemEvent(roomId, 'join', `مرحباً بـ ${me.username} في غرفة ${room.name}`);
      }
    }
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
    const lastMsgRow = await q.get(`SELECT COALESCE(MAX(id),0) lastId FROM messages WHERE room_id=?`, roomId);
    done({ ok: true, hidden: enterHidden, restored: restoredConnection, broadcast: broadcastPublicState(roomId), lastMsgId: +lastMsgRow.lastId || 0 });
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
    cancelPendingBroadcastCleanup(uid, roomId); // مغادرة صريحة: ألغِ أي مهلة سماح معلّقة ونظّف فوراً
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
      text: me.broadcast_banned ? 'منعت الإدارة صعودك إلى البث' : (me.muted ? 'أنت مكتوم ولا يمكنك الصعود كمذيع' : 'عضويتك غير مسموح لها بالصعود كمذيع')
    });
    let b = roomBroadcast[roomId];
    if (b && b.hosts.has(uid)) return ack({ ok: false, text: 'أنت تبث بالفعل في هذه الغرفة' });
    // حد المذيعين المتزامنين (الميكروفونات) المُعيَّن من لوحة الإدارة
    if (b) {
      const bs = await getSettings();
      const maxSpeakers = Math.max(1, Math.min(10, parseInt(bs.max_live_speakers) || 4));
      if (b.hosts.size >= maxSpeakers) return ack({ ok: false, text: 'الميكروفونات ممتلئة الآن — لا يمكن الصعود كمذيع' });
    }
    // أي عضو مؤهل (تحقق منه أعلاه عبر canStartAudioBroadcast) ينضم كمذيع مباشرة لبث صوتي قائم دون طلب/موافقة —
    // يسمعهم بعضهم البعض فوراً ويسمعهم كل من في الغرفة الصوتية مباشرة.
    const hostInfo = { id: uid, username: me.username, avatar: me.avatar || '', badge: badgeOf(me) };
    const isNewBroadcast = !b;
    if (isNewBroadcast) {
      b = roomBroadcast[roomId] = { mode, hosts: new Map(), viewers: new Set(), pending: new Map(), speakPending: new Map(), viewerOf: new Map(), primaryHostId: uid, startedAt: Date.now() };
      // بث صوتي جديد: سجّل فوراً كل من هو موجود بالفعل في الغرفة كمستمع، ليتصل بهم المذيع من أول لحظة
      // بدل انتظار خروجهم ودخولهم من جديد ليُلتقطوا عبر معالج 'join'.
      if (mode === 'audio' && roomUsers[roomId]) for (const existingUid of roomUsers[roomId]) if (existingUid !== uid) b.viewers.add(existingUid);
    }
    if (b.speakPending) b.speakPending.delete(uid); // تجاوز الإدارة لأي طلب تحدث معلّق سابق لنفس الشخص
    // [فيديو] البثوث مستقلة تماماً: مذيع جديد لا يُدمج تلقائياً مع المذيعين الحاليين ولا يُعرّف على مشاهديهم؛
    // لرؤية بعضهم البعض يجب تبادل طلبات مشاهدة وموافقة مستقلة لكل اتجاه. من كان يشاهد مذيعاً آخر وتصيّد مذيعاً، تُغلق مشاهدته السابقة.
    // [فيديو] البثوث مستقلة تماماً: مذيع جديد لا يُدمج تلقائياً مع المذيعين الحاليين ولا يُعرّف على مشاهديهم؛
    // لرؤية بعضهم البعض يجب تبادل طلبات مشاهدة وموافقة مستقلة لكل اتجاه. ومن كان يشاهد مذيعاً ثم صعد مذيعاً،
    // تبقى مشاهدته الحالية شغّالة كما هي (الموافقة السابقة لا تُلغى بصعوده للبث).
    let existingHosts = [];
    let currentViewers = [];
    let alreadyWatching = [];
    if (mode === 'video') {
      const myWatches = b.viewerOf ? b.viewerOf.get(uid) : null;
      alreadyWatching = myWatches ? [...myWatches].map(hid => b.hosts.get(hid)).filter(Boolean) : [];
    } else {
      // [صوت] من ينضم كمذيع للبث القائم يتصل بكل المذيعين والمشاهدين الحاليين؛ الطرف الأقدم لا يبادر بالاتصال، تفادياً لتصادم العروض.
      existingHosts = [...b.hosts.values()];
      currentViewers = [...b.viewers];
    }
    b.viewers.delete(uid);
    b.hosts.set(uid, { id: uid, username: hostInfo.username, avatar: hostInfo.avatar, badge: hostInfo.badge, socketId: socket.id, startedAt: Date.now() });
    io.to('room_' + roomId).emit(isNewBroadcast ? 'bcast:started' : 'bcast:host_joined', {
      roomId, mode, host: hostInfo, hosts: [...b.hosts.values()], primaryHostId: b.primaryHostId
    });
    ack({ ok: true, mode, isNewBroadcast, existingHosts, viewers: currentViewers, watching: alreadyWatching });
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
    // إعادة فحص حد المذيعين (قد امتلأت الميكروفونات بين الطلب والرد)
    const bs2 = await getSettings();
    const maxSpeakers2 = Math.max(1, Math.min(10, parseInt(bs2.max_live_speakers) || 4));
    if (b.hosts.size >= maxSpeakers2) {
      return io.to('user_' + targetUserId).emit('bcast:speak_response', { roomId, accept: false, reason: 'الميكروفونات ممتلئة الآن — لا يمكن الصعود كمذيع' });
    }
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

  // ===== أدوات التحكم بالمذيع للمشرف =====
  // [مشرف] سحب المايك من مذيع وإعادته مستمعاً (مع خيار منعه من الصعود إلى البث مستقبلاً).
  socket.on('bcast:mod_pull', async (roomId, targetUserId, ban) => {
    roomId = +roomId; targetUserId = +targetUserId;
    if (targetUserId === uid) return;
    if (!(await socketCanModerate(uid, roomId))) return;
    const b = roomBroadcast[roomId];
    if (!b || !b.hosts.has(targetUserId)) return;
    const mode = b.mode;
    // إن كان المسحوب هو المضيف الأساسي، نرقّي أقدم مذيع متبقٍ تلقائياً قبل إزالتنا إياه.
    if (b.primaryHostId === targetUserId) {
      b.primaryHostId = [...b.hosts.keys()].filter(h => h !== targetUserId)[0] || null;
    }
    b.hosts.delete(targetUserId);
    if (mode === 'audio') b.viewers.add(targetUserId);
    // إعلام الجميع أن هذا المذيع غادر البث (المذيع المرقّى سيتولى الصلاحيات عبر primary_changed).
    io.to('room_' + roomId).emit('bcast:host_left', { roomId, hostId: targetUserId, reason: 'removed_by_moderator' });
    if (b.primaryHostId && b.hosts.has(b.primaryHostId)) {
      io.to('room_' + roomId).emit('bcast:primary_changed', { roomId, primaryHostId: b.primaryHostId });
    }
    // إن كان آخر مذيع، ننهي البث تماماً؛ وإلا نخبر المسحوب أنه أُعيد (مستمعاً في الصوت).
    if (b.hosts.size === 0) {
      endBroadcast(roomId, 'ended_by_moderator');
    } else {
      io.to('user_' + targetUserId).emit('bcast:speaker_removed', { roomId });
      if (mode === 'audio') for (const hostId of b.hosts.keys()) io.to('user_' + hostId).emit('bcast:new_listener', { roomId, listenerId: targetUserId });
    }
    // منع الصعود مستقبلاً إن طُلب ذلك.
    if (ban) {
      await q.run(`UPDATE users SET broadcast_banned=1 WHERE id=?`, targetUserId);
      await refreshUserEverywhere(targetUserId);
      io.to('user_' + targetUserId).emit('broadcast_banned', { user_id: targetUserId });
      const t = await q.get(`SELECT username FROM users WHERE id=?`, targetUserId);
      if (t) emitRoomSystemEvent(roomId, 'broadcast_ban', `منع المشرف ${t.username} من الصعود إلى البث`);
    }
  });
  // [مشرف] إلغاء منع الصعود إلى البث (فكّ المنع) لمستخدمٍ مُبعد.
  socket.on('bcast:mod_unban', async (roomId, targetUserId) => {
    roomId = +roomId; targetUserId = +targetUserId;
    // المشرف العام يكفي في كل الحالات؛ مشرف الغرفة يُسمح له فقط في غرفته.
    if (!(await socketCanModerate(uid, roomId))) return;
    await q.run(`UPDATE users SET broadcast_banned=0 WHERE id=?`, targetUserId);
    await refreshUserEverywhere(targetUserId);
    const t = await q.get(`SELECT username FROM users WHERE id=?`, targetUserId);
    if (roomId && roomBroadcast[roomId] && t) emitRoomSystemEvent(roomId, 'broadcast_unban', `سمح المشرف لـ ${t.username} بالصعود إلى البث`);
    io.to('user_' + targetUserId).emit('broadcast_ban_cleared', { user_id: targetUserId });
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
  // يشمل ذلك المذيعين أنفسهم: كل بث مستقل، ولا يرى مذيعٌ بثَّ مذيعٍ آخر إلا بطلبٍ يوافق عليه صاحبه (لكل اتجاه موافقة مستقلة).
  // [مشاهدات متزامنة] يمكن للشخص الواحد (مشاهداً كان أو مذيعاً) متابعة عدة مذيعين في آنٍ واحد:
  // كل بث وافق صاحبه على طلبه يعمل بشكل طبيعي ولا يُغلق بسبب قبول بثٍ آخر.
  socket.on('bcast:watch_request', async (roomId, targetHostId, cb) => {
    const ack = typeof cb === 'function' ? cb : () => { };
    roomId = +roomId; targetHostId = +targetHostId;
    const b = roomBroadcast[roomId];
    if (!b || b.mode !== 'video') return ack({ ok: false, text: 'لا يوجد بث فيديو حالياً في هذه الغرفة' });
    if (targetHostId === uid) return ack({ ok: false, text: 'لا يمكن مشاهدة بثك الشخصي' });
    if (!b.hosts.has(targetHostId)) return ack({ ok: false, text: 'هذا المذيع لم يعد يبث حالياً' });
    if (bcastIsWatching(b, uid, targetHostId)) return ack({ ok: true, already: true });
    const myPending = bcastPendingMap(b, uid, true);
    if (myPending.has(targetHostId)) return ack({ ok: true, pending: true });
    me = await q.get(`SELECT * FROM users WHERE id=?`, uid);
    myPending.set(targetHostId, { username: me.username, avatar: me.avatar || '' });
    const payload = { roomId, user: { id: uid, username: me.username, avatar: me.avatar || '', badge: badgeOf(me) } };
    io.to('user_' + targetHostId).emit('bcast:watch_request', payload);
    ack({ ok: true, pending: true });
  });

  // إلغاء طلب المشاهدة قبل رد المذيع المطلوب (مذيع محدد، أو كل الطلبات المعلقة إن لم يُحدد)
  socket.on('bcast:watch_cancel', (roomId, targetHostId) => {
    roomId = +roomId;
    const b = roomBroadcast[roomId];
    if (!b) return;
    const reqs = b.pending ? b.pending.get(uid) : null;
    if (!reqs) return;
    if (targetHostId !== undefined && targetHostId !== null) {
      targetHostId = +targetHostId;
      if (!bcastRemovePending(b, uid, targetHostId)) return;
      io.to('user_' + targetHostId).emit('bcast:watch_cancelled', { roomId, userId: uid });
      return;
    }
    b.pending.delete(uid);
    for (const hostId of reqs.keys()) io.to('user_' + hostId).emit('bcast:watch_cancelled', { roomId, userId: uid });
  });

  // رد المذيع المطلوب تحديداً على طلب مشاهدته: قبول أو رفض. أي مذيع آخر لا يملك صلاحية الرد على طلب لم يُوجَّه إليه.
  socket.on('bcast:watch_response', (roomId, targetUserId, accept) => {
    roomId = +roomId; targetUserId = +targetUserId;
    const b = roomBroadcast[roomId];
    if (!b) return;
    // فقط المذيع الذي طُلبت مشاهدته تحديداً يملك حق الرد على طلبه هو
    if (!bcastRemovePending(b, targetUserId, uid)) return;
    if (accept) {
      // [فيديو] تُضاف علاقة مشاهدة جديدة دون المساس بأي بث آخر يشاهده هذا الشخص —
      // كل البثوث التي وُوفق عليها تعمل في نفس الوقت بشكل طبيعي.
      if (b.mode === 'video') {
        bcastAddWatch(b, targetUserId, uid);
        b.viewers.delete(targetUserId);
      } else b.viewers.add(targetUserId);
    }
    const hostInfo = b.hosts.get(uid);
    io.to('user_' + targetUserId).emit('bcast:watch_response', { roomId, accept: !!accept, hostId: uid, hosts: accept && hostInfo ? [hostInfo] : [] });
  });

  // مشاهد يوقف مشاهدة بث (فيديو) دون مغادرة الغرفة — hostId اختياري: بثٌّ واحد بعينه أو كل البثوث
  socket.on('bcast:leave', (roomId, hostId) => {
    roomId = +roomId;
    const b = roomBroadcast[roomId];
    if (!b) return;
    if (b.mode === 'video') {
      if (hostId !== undefined && hostId !== null) {
        hostId = +hostId;
        if (bcastRemovePending(b, uid, hostId)) io.to('user_' + hostId).emit('bcast:watch_cancelled', { roomId, userId: uid });
        if (bcastRemoveWatch(b, uid, hostId)) io.to('user_' + hostId).emit('bcast:viewer_left', { roomId, userId: uid });
        return;
      }
      const reqs = b.pending ? b.pending.get(uid) : null;
      if (reqs) {
        b.pending.delete(uid);
        for (const hid of reqs.keys()) io.to('user_' + hid).emit('bcast:watch_cancelled', { roomId, userId: uid });
      }
      const watched = b.viewerOf ? b.viewerOf.get(uid) : null;
      if (watched) {
        b.viewerOf.delete(uid);
        for (const hid of watched) io.to('user_' + hid).emit('bcast:viewer_left', { roomId, userId: uid });
      }
      return;
    }
    const wasConnected = b.viewers.delete(uid) || (b.pending && b.pending.delete(uid));
    if (wasConnected) for (const hid of b.hosts.keys()) io.to('user_' + hid).emit('bcast:viewer_left', { roomId, userId: uid });
  });

  // ترحيل إشارات WebRTC (offer/answer/ice candidate):
  //  - صوت: mesh بين المذيعين وبين كل مذيع والمستمعين المسجلين.
  //  - فيديو: فقط عبر علاقة مشاهدة معتمدة — المذيع يرسل لمشاهديه المقبولين لديه تحديداً، والمشاهد لا يتصل إلا بالمذيع الذي وافق عليه.
  socket.on('bcast:signal', (roomId, targetUserId, data) => {
    roomId = +roomId; targetUserId = +targetUserId;
    const b = roomBroadcast[roomId];
    if (!b) return;
    const iAmHost = b.hosts.has(uid);
    const targetIsHost = b.hosts.has(targetUserId);
    let valid;
    if (b.mode === 'audio') {
      valid = iAmHost
        ? (targetUserId !== uid && (targetIsHost || b.viewers.has(targetUserId)))
        : (targetIsHost && b.viewers.has(uid));
    } else {
      const watchesMe = bcastIsWatching(b, targetUserId, uid);   // الطرف الآخر يشاهدني (أنا مصدر التدفق)
      const iWatchHim = bcastIsWatching(b, uid, targetUserId);   // أنا أشاهده (أتلقى تدفقه)
      valid = iAmHost
        ? (targetIsHost ? (watchesMe || iWatchHim) : watchesMe)              // مذيع↔مذيع: علاقة مشاهدة قائمة بأي اتجاه
        : (targetIsHost && iWatchHim);                                       // مشاهد: فقط المذيع الذي وافق على مشاهدته
    }
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
    const rawText = String(text || '').trim();
    const textLength = Array.from(rawText).length;
    if (textLength > PUBLIC_MESSAGE_MAX_LENGTH) {
      return socket.emit('message_too_long', {
        text: `الرسالة طويلة، يجب أن تكون ${PUBLIC_MESSAGE_MAX_LENGTH} حرف أو أقل`,
        max_length: PUBLIC_MESSAGE_MAX_LENGTH,
        actual_length: textLength,
        attempted_text: rawText.slice(0, 20000),
        room_id: roomId
      });
    }
    text = rawText;
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

    // منع إرسال رسالتين عامتين بسرعة من الشخص نفسه. المحاولة المرفوضة لا
    // تمدد المهلة؛ القياس دائماً من آخر رسالة نُشرت فعلياً.
    if (PUBLIC_MESSAGE_COOLDOWN_MS > 0) {
      const identityKey = publicMessageIdentityKey(socket, me);
      const now = Date.now();
      const lastSentAt = PUBLIC_MESSAGE_LAST_SENT.get(identityKey) || 0;
      const retryAfterMs = PUBLIC_MESSAGE_COOLDOWN_MS - (now - lastSentAt);
      if (retryAfterMs > 0) {
        return socket.emit('slow_down', {
          text: 'لا تتحدث بسرعة، خذ استراحة',
          retry_after_ms: retryAfterMs,
          cooldown_seconds: PUBLIC_MESSAGE_COOLDOWN_MS / 1000,
          attempted_text: text,
          room_id: roomId
        });
      }
      // الحجز قبل أي await تالٍ يمنع نجاح رسالتين وصلتا في اللحظة نفسها.
      PUBLIC_MESSAGE_LAST_SENT.set(identityKey, now);
    }

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
    const liveBroadcastHost = !!(roomBroadcast[roomId] && roomBroadcast[roomId].hosts.has(uid));
    const rp = reply && reply.name ? { name: String(reply.name).slice(0, 40), text: String(reply.text || '').slice(0, 90) } : null;   // الرد على الرسالة
    // لون الخط: يوجّه العميل اللون المختار، وإن لم يُرسل نستخدم اللون المحفوظ في حساب العضو (يسري من أي جهاز).
    const col = /^#[0-9a-fA-F]{6}$/.test(String(color || ''))
      ? String(color)
      : (/^#[0-9a-fA-F]{6}$/.test(String(me.color || '')) ? String(me.color) : null);
    // تحفظ حالة المذيع داخل الرسالة نفسها كي يظهر الإطار أيضاً في الرسائل القديمة
    // ولدى بقية الموجودين، لا لدى المذيع فقط.
    const messageUser = hiddenAdmin
      ? { ...freshPub, hidden_admin: 1 }
      : { ...freshPub, live_broadcast_host: liveBroadcastHost ? 1 : 0 };
    const extra = JSON.stringify({ badge: effectiveBadge, gender: me.gender, rank: effectiveRank, membership: me.membership, avatar: me.avatar || '', registered: me.registered, muted: me.muted ? 1 : 0, reply: rp, color: col, media: cleanMedia, live_broadcast_host: liveBroadcastHost ? 1 : 0, verified: VERIFIED_SET.has(me.username) ? 1 : 0, verified_expired: VERIFIED_SET.has(me.username) ? expiredNow(VERIFIED_EXPIRES.get(me.username)) : 0, royal_expired: ROYAL_MAP.has(me.username) ? expiredNow(ROYAL_EXPIRES.get(me.username)) : 0, hidden_admin: hiddenAdmin ? 1 : 0, broadcast_banned: me.broadcast_banned ? 1 : 0 });
    const ins = await q.run(`INSERT INTO messages (room_id,user_id,username,text,type,extra) VALUES (?,?,?,?,'msg',?)`, roomId, uid, me.username, text, extra);
    const msg = {
      id: ins.lastID, room_id: roomId, text, type: 'msg', hidden_admin: hiddenAdmin ? 1 : 0,
      live_broadcast_host: liveBroadcastHost ? 1 : 0,
      created_at: Math.floor(Date.now() / 1000),
      extra,
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

  // ===== مكالمات صوتية/فيديو خاصة (1-to-1 WebRTC) =====
  socket.on('call:request', async ({ toId, type }) => {
    toId = +toId;
    if (!toId || toId === uid) return socket.emit('call:rejected', { fromId: toId, reason: 'invalid' });
    // نوع المكالمة: audio (الافتراضي) | video — تُدار الصلاحيات والتكلفة لكل نوع بشكل مستقل من لوحة الإدارة.
    const callType = type === 'video' ? 'video' : 'audio';
    const callMembershipKey = callType === 'video' ? 'video_call_allowed_memberships' : 'private_call_allowed_memberships';
    if (!await canUseMembershipFeature(uid, callMembershipKey)) {
      return socket.emit('call:rejected', { fromId: toId, reason: 'not_allowed', error: callType === 'video' ? 'عضويتك غير مسموح لها بإجراء مكالمات الفيديو الخاصة' : 'عضويتك غير مسموح لها بإجراء المكالمات الخاصة' });
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
    // التجربة المجانية (دقيقة أولى) سارية للمكالمات الصوتية فقط — مكالمات الفيديو دائماً مدفوعة ما عدا الإدارة.
    const isFreeTrial = callType === 'audio' && !isStaff && !me.free_call_used;
    const settings = await getSettings();
    const callCost = callType === 'video'
      ? normalizeNonNegativeCost(settings.video_call_cost, 5)
      : Math.max(1, parseInt(settings.call_cost) || 2);

    // إذا استنفذ المكالمة المجانية الأولى وليس من الإدارة، يشترط وجود الذهب المطلوب
    if (!isStaff && !isFreeTrial && (+me.balance || 0) < callCost) {
      return socket.emit('call:rejected', {
        fromId: toId,
        reason: 'insufficient_balance',
        error: `رصيدك غير كافٍ. تكلفة المكالمة ${callCost} ذهب، يرجى شحن الرصيد ⚠️`
      });
    }

    activePrivateCalls.set(uid, { targetId: toId, callerId: uid, state: 'calling', requestedAt: Date.now(), isFreeTrial, callCost, callType });
    activePrivateCalls.set(toId, { targetId: uid, callerId: uid, state: 'calling', requestedAt: Date.now(), isFreeTrial, callCost, callType });

    io.to('user_' + toId).emit('call:incoming', {
      from: { id: uid, username: me.username, avatar: me.avatar || '' },
      type: callType, callCost
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
        // قيمة 0 تعني مكالمة مجانية بالكامل: لا خصم ولا إشعار خصم بقيمة صفر.
        const callCost = normalizeNonNegativeCost(callInfo.callCost, 2);
        if (!isStaff && callCost > 0 && callerUser && (+callerUser.balance || 0) >= callCost) {
          await q.run(`UPDATE users SET balance=balance-? WHERE id=?`, callCost, callInfo.callerId);
          const newBal = callerUser.balance - callCost;
          if (onlineUsers[callInfo.callerId]) {
            onlineUsers[callInfo.callerId].balance = newBal;
          }
          io.to('user_' + callInfo.callerId).emit('call:gold_deducted', {
            balance: newBal,
            amount: callCost,
            isCallFee: true,
            callType: callInfo.callType || 'audio'
          });
          const feeLabel = (callInfo.callType === 'video') ? 'مكالمة فيديو خاصة' : 'مكالمة مفتوحة المدة';
          const notif = await createUserNotification(callInfo.callerId, `تم خصم ${callCost} ذهب رسوم ${feeLabel} (الرصيد: ${newBal}) 🪙`, 'creditcard_fill');
          io.to('user_' + callInfo.callerId).emit('notify', { ...notif, balance: newBal });
        }
      }
    }
    me = await q.get(`SELECT id, username, avatar FROM users WHERE id=?`, uid);
    const callerInfo = activePrivateCalls.get(toId);
    io.to('user_' + toId).emit('call:accepted', {
      from: { id: uid, username: me.username, avatar: me.avatar || '' },
      type: (callerInfo && callerInfo.callType) || 'audio'
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

  // حالة كاميرا مكالمة الفيديو (فتح/إيقاف) — تُبلَّغ للطرف الآخر فوراً
  socket.on('call:cam_state', ({ toId, on }) => {
    toId = +toId;
    if (!toId) return;
    io.to('user_' + toId).emit('call:cam_state', { fromId: uid, on: !!on });
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
    // ملاحظة: انقطاع اتصال الدردشة (تجميد الهاتف للتبويب الخلفي) لا يمسّ
    // جلسة لوحة الإدارة إطلاقاً — الجلسة تبقى حية ما دامت الصفحة لم تُحدّث،
    // والشرط الصارم «داخل الدردشة الآن» يُفحص فقط عند تحديث صفحة /admin.
    for (const roomId of joinedRooms) {
      // انقطاع مؤقت للاتصال (تجميد تبويب/تقلّب شبكة) لا يُنهي بث المستخدم فوراً — نمنحه مهلة سماح
      // ليعود؛ فإن عاد قبل نهايتها يستمر بثّه/استماعه دون انقطاع. (المغادرة الصريحة عبر 'leave' تُنظَّف فوراً)
      if (!userStillHasVisibleSocketInRoom(uid, roomId)) scheduleBroadcastCleanup(uid, roomId);
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
