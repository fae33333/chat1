try { require('dotenv').config(); } catch (e) { /* dotenv غير مثبت: نتجاهل */ }
// كثير من الاستضافات لا تملك مساراً IPv6 يعمل: نفضّل IPv4 كي لا تنتهي مهلة الاتصال بيوتيوب/جوجل
try { require('dns').setDefaultResultOrder('ipv4first'); } catch (e) {}
try { require('net').setDefaultAutoSelectFamilyAttemptTimeout(500); } catch (e) {}
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
const { db, run, get, all, initDB } = require('./database');

const app = express();
const server = http.createServer(app);

// Initialize HTTPS Server on Port 2083 with cert.pem and key.pem
const certPath = path.join(__dirname, 'cert.pem');
const keyPath = path.join(__dirname, 'key.pem');
let httpsServer = null;

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  try {
    const sslOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
    httpsServer = https.createServer(sslOptions, app);
    console.log('✅ SSL certificates (cert.pem & key.pem) loaded successfully for HTTPS.');
  } catch (err) {
    console.error('⚠️ Error initializing HTTPS with cert.pem and key.pem:', err.message);
  }
}

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Attach Socket.IO to HTTPS server as well so WebSockets work over port 2083
if (httpsServer) {
  io.attach(httpsServer);
}

const PORT = process.env.PORT || 3000;
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || 'dummy-google-client-id');

// Setup Multer for media uploads (Voice notes & photos)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || (file.mimetype.includes('audio') ? '.webm' : '.png');
    cb(null, `${Date.now()}-${uuidv4().slice(0, 8)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB limit
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// أي إضافة/تعديل/حذف من لوحة الإدارة يُبثّ فوراً لكل المتصلين ليتحدث التطبيق مباشرة بدون إعادة تحميل
const ADMIN_LIVE_SKIP = /^(login|logout|enter-as-user|change-credentials|smtp|youtube-key|paypal|settings\/paypal)/;
let adminLiveTimers = new Map();
app.use('/api/admin', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  res.on('finish', () => {
    try {
      if (res.statusCode >= 400) return;
      const rel = String(req.path || '').replace(/^\/+/, '');
      if (!rel || ADMIN_LIVE_SKIP.test(rel)) return;
      const parts = rel.split('/');
      const area = parts[0] === 'settings' ? `settings/${parts[1] || ''}` : parts[0];
      clearTimeout(adminLiveTimers.get(area));
      adminLiveTimers.set(area, setTimeout(() => {
        adminLiveTimers.delete(area);
        if (typeof io !== 'undefined') io.emit('admin_content_updated', { area, at: Date.now() });
      }, 150));
    } catch (e) {}
  });
  next();
});

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// تحديد دولة المستخدم تلقائياً (مرة واحدة) من الـ IP عند أول طلب له، إن لم تكن محددة
const _countryChecked = new Set();
app.use((req, res, next) => {
  const uid = req.headers['x-user-id'];
  if (uid && !_countryChecked.has(uid)) {
    _countryChecked.add(uid);
    try {
      const geo = getCountryFromIp(getClientIp(req));
      const code = SUPPORTED_COUNTRIES.some(c => c.code === geo.country_code && !c.isGlobal) ? geo.country_code : 'JO';
      run(`UPDATE users SET country_code = ? WHERE id = ? AND (country_code IS NULL OR country_code = '')`, [code, uid]).catch(() => {});
    } catch (e) {}
  }
  next();
});

// In-memory active presence & room states
const onlineUsers = new Map(); // socketId -> userId
const userSockets = new Map(); // userId -> Set(socketIds)
const activeRoomStates = new Map(); // roomId -> { pkState, activeAudience: Set, speakers: Set, cohostRequests: Map }

// أول 5 متواجدين في الغرفة (مع إطاراتهم) — تُرسل للّوبي مع كل تغيير ليتحدّث كرت الغرفة مباشرة
function buildAudiencePreview(roomId) {
  const st = activeRoomStates.get(roomId);
  if (!st || !st.activeAudience) return [];
  return Array.from(st.activeAudience.values()).slice(0, 5).map(u => ({
    id: u.id, avatar: u.avatar || '', frame: u.avatar_frame || ''
  }));
}
const roomMusicState = new Map(); // roomId -> Map(userId -> آخر room_music_started نشط) — كل شخص مستقل
const pkIntervals = new Map(); // roomId -> intervalId
const recentRoomWelcomes = new Map(); // `${roomId}:${userId}` -> آخر وقت ترحيب
setInterval(() => { const cutoff = Date.now() - 10 * 60 * 1000; for (const [k, t] of recentRoomWelcomes) if (t < cutoff) recentRoomWelcomes.delete(k); }, 5 * 60 * 1000);
const adminSessions = new Map(); // token -> { username, role, loginTime }

async function verifyAdminToken(req) {
  const token = req.headers['x-admin-token'] || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  if (!token) return null;
  if (adminSessions.has(token)) {
    const s = adminSessions.get(token);
    // Only owner, super_master, and super_admin are allowed in Admin Control Panel
    if (['owner', 'super_master', 'super_admin'].includes(s.role) || !s.role || s.role === 'admin_master') {
      return s;
    }
  }
  // Check if token belongs to an authorized user (owner, super_master, or super_admin ONLY)
  if (token.startsWith('token-')) {
    const parts = token.split('-');
    const userId = parts.slice(1, parts.length - 1).join('-');
    const user = await get('SELECT id, name, role FROM users WHERE id = ?', [userId]);
    if (user && ['owner', 'super_master', 'super_admin'].includes(user.role)) {
      return { username: user.name, role: user.role, userId: user.id };
    }
  }
  return null;
}

const SOULCHILL_PK_PENALTIES = [
  "🎤 غناء مقطع غنائي حماسي بصوت عالي بدون موسيقى أمام الجمهور!",
  "💪 عمل 15 تمرين ضغط (Push-ups) لايف أمام الكاميرا فوراً!",
  "🥤 شرب كوب ماء كامل دفعة واحدة خلال 5 ثوانٍ فقط!",
  "🦁 تقليد زئير الأسد القوي وصوت النمر 3 مرات متتالية!",
  "😂 تقليد ضحكة شريرة أو شخصية كرتونية مضحكة لمدة 30 ثانية!",
  "🕺 رقصة فكتوري مضحكة وطريفة لمدة 20 ثانية أمام الجميع!",
  "👑 مدح الفائز بـ 5 صفات ملوكية والاعتراف بقوته أمام المتابعين!"
];

// Gift definitions
const GIFTS = [
  // تبويب «المتداول»
  { id: 'rose', name: 'وردة الجوري', name_en: 'Red Rose', icon: '🌹', cost: 10, currency: 'coins', charm: 10, tab: 'popular' },
  { id: 'icecream', name: 'آيس كريم مثلج', name_en: 'Chill Ice Cream', icon: '🍦', cost: 50, currency: 'coins', charm: 50, tab: 'popular' },
  { id: 'heart', name: 'قلب مشع', name_en: 'Magic Heart', icon: '💖', cost: 100, currency: 'coins', charm: 100, tab: 'popular' },
  { id: 'magic_wand', name: 'عصا سحرية', name_en: 'Magic Wand', icon: '🪄', cost: 250, currency: 'coins', charm: 250, tab: 'popular' },
  { id: 'diamond_ring', name: 'خاتم ألماس', name_en: 'Diamond Ring', icon: '💍', cost: 500, currency: 'coins', charm: 500, tab: 'popular' },
  { id: 'chocolate', name: 'شوكولاتة', name_en: 'Chocolate', icon: '🍫', cost: 20, currency: 'coins', charm: 20, tab: 'popular' },
  { id: 'genie', name: 'علاء الدين', name_en: 'Aladdin', icon: '🧞', cost: 300, currency: 'coins', charm: 300, tab: 'popular' },
  // تبويب «الحظ»
  { id: 'lucky_clover', name: 'حظ سعيد', name_en: 'Good Luck', icon: '🍀', cost: 20, currency: 'coins', charm: 20, tab: 'luck' },
  { id: 'lucky_box', name: 'هدية قيمة', name_en: 'Lucky Box', icon: '🎁', cost: 200, currency: 'coins', charm: 200, tab: 'luck' },
  { id: 'lucky_ball', name: 'لولو الحظ', name_en: 'Lucky Ball', icon: '🔮', cost: 100, currency: 'coins', charm: 100, tab: 'luck' },
  { id: 'jackpot', name: 'JACKPOT', name_en: 'Jackpot', icon: '🎰', cost: 777, currency: 'coins', charm: 777, tab: 'luck' },
  // تبويب «الأنشطة»
  { id: 'love_arrow', name: 'سهم الحب', name_en: 'Love Arrow', icon: '💘', cost: 150, currency: 'coins', charm: 150, tab: 'events' },
  { id: 'love_key', name: 'مفتاح ماسي', name_en: 'Diamond Key', icon: '🗝️', cost: 300, currency: 'coins', charm: 300, tab: 'events' },
  { id: 'pulse_heart', name: 'نبض القلب', name_en: 'Heartbeat', icon: '💓', cost: 120, currency: 'coins', charm: 120, tab: 'events' },
  { id: 'love_garden', name: 'حديقة حب', name_en: 'Love Garden', icon: '💞', cost: 400, currency: 'coins', charm: 400, tab: 'events' },
  // تبويب «الامبراطورية» (فاخرة بالألماس)
  { id: 'sports_car', name: 'سيارة سوبر سبورت', name_en: 'Super Sports Car', icon: '🏎️', cost: 1000, currency: 'diamonds', charm: 2000, luxury: true, tab: 'empire' },
  { id: 'rocket', name: 'صاروخ المجرة', name_en: 'Galaxy Rocket', icon: '🚀', cost: 2500, currency: 'diamonds', charm: 5000, luxury: true, tab: 'empire' },
  { id: 'crown', name: 'تاج الملك الإمبراطوري', name_en: 'Imperial Crown', icon: '👑', cost: 5000, currency: 'diamonds', charm: 10000, luxury: true, tab: 'empire' },
  { id: 'castle', name: 'قصر الأحلام', name_en: 'Dream Palace', icon: '🏰', cost: 10000, currency: 'diamonds', charm: 25000, luxury: true, tab: 'empire' },
  // تبويب «المشاهير»
  { id: 'star', name: 'نجمة المشاهير', name_en: 'Star', icon: '🌟', cost: 200, currency: 'diamonds', charm: 400, tab: 'celebs' },
  { id: 'golden_mic', name: 'ميكروفون ذهبي', name_en: 'Golden Mic', icon: '🎤', cost: 400, currency: 'diamonds', charm: 800, tab: 'celebs' },
  { id: 'clapper', name: 'كلاكيت', name_en: 'Clapper', icon: '🎬', cost: 600, currency: 'diamonds', charm: 1200, tab: 'celebs' }
];

// ---- كتالوج الهدايا في قاعدة البيانات (يُزرع مرة واحدة من القائمة أعلاه ثم تُدار من الإدارة) ----
const GIFT_TAB_IDS = ['popular', 'luck', 'events', 'empire', 'celebs'];

function giftRowToObj(r) {
  return {
    id: r.id, name: r.name, name_en: r.name_en || '', icon: r.icon || '🎁', image_url: r.image_url || '',
    cost: r.cost, currency: r.currency, charm: r.charm || r.cost, luxury: !!r.luxury, tab: r.tab || 'popular',
    burst_enabled: !!r.burst_enabled,
    burst_count: Math.min(60, Math.max(1, parseInt(r.burst_count, 10) || 20)),
    banner_enabled: !!r.banner_enabled
  };
}

async function seedGiftsCatalog() {
  try {
    const row = await get('SELECT COUNT(*) AS n FROM gifts_catalog');
    if (row && row.n > 0) return;
    let i = 0;
    for (const g of GIFTS) {
      await run(`INSERT OR IGNORE INTO gifts_catalog (id, name, name_en, icon, image_url, cost, currency, charm, luxury, tab, sort_order, is_active)
                 VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, 1)`,
        [g.id, g.name, g.name_en || '', g.icon, g.cost, g.currency, g.charm || g.cost, g.luxury ? 1 : 0, g.tab || 'popular', i++]);
    }
    console.log('Seeded gifts catalog:', GIFTS.length);
  } catch (e) { console.error('seed gifts error:', e.message); }
}

async function getActiveGifts() {
  try {
    const rows = await all('SELECT * FROM gifts_catalog WHERE is_active = 1 ORDER BY sort_order ASC, rowid ASC');
    return rows.map(giftRowToObj);
  } catch (e) { return GIFTS; }
}

async function getGiftById(id) {
  if (!id) return null;
  try {
    const r = await get('SELECT * FROM gifts_catalog WHERE id = ? AND is_active = 1', [id]);
    return r ? giftRowToObj(r) : null;
  } catch (e) { return GIFTS.find(g => g.id === id) || null; }
}

// ==========================================
// API ROUTES
// ==========================================

// ==========================================
// تسجيل الدخول: Gmail + رمز تحقق ثم اسم مستعار وكلمة مرور
// ==========================================
const crypto = require('crypto');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// الاسم المستعار: 2–30 رمزاً، يسمح بالإيموجي والرموز، ويمنع محارف التحكم و < > & "
function isValidNickname(n) {
  const len = [...n].length;
  return len >= 2 && len <= 30 && n.trim().length > 0 && !/[\p{C}<>&"]/u.test(n);
}
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const TICKET_TTL_MS = 15 * 60 * 1000;

const otpSendLog = new Map();   // ip -> [timestamps] (حد الإرسال لكل IP)
const loginFailures = new Map(); // `${ip}|${nickname}` -> { count, until }

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve({ salt, hash: key.toString('hex') }));
  });
}

async function checkPassword(password, salt, hashHex) {
  const { hash } = await hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(hashHex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cleanNickname(v) {
  return String(v || '').replace(/\s+/g, ' ').trim();
}

async function generateUserId() {
  for (let i = 0; i < 20; i++) {
    const id = `sc-user-${crypto.randomInt(10000000, 100000000)}`;
    if (!(await get('SELECT id FROM users WHERE id = ?', [id]))) return id;
  }
  return `sc-user-${Date.now()}`;
}

async function issueSession(user, nickname) {
  return { success: true, user, nickname: nickname || user.name, token: `token-${user.id}-${Date.now()}` };
}


// بعد إثبات ملكية البريد (رمز Gmail أو حساب Google): يُمنح تذكرة لإكمال الاسم المستعار والعمر وكلمة المرور
async function signupTicketFor(cleanEmail) {
  const existing = await get('SELECT id, name, is_banned FROM users WHERE email = ?', [cleanEmail]);
  if (existing && existing.is_banned) {
    return { status: 403, body: { error: 'هذا الحساب محظور من قبل الإدارة 🚫' } };
  }
  const cred = existing ? await get('SELECT nickname FROM user_credentials WHERE user_id = ?', [existing.id]) : null;
  if (cred) {
    return { status: 409, body: { code: 'email_registered', error: 'هذا البريد مسجّل مسبقاً. ادخل بالاسم المستعار وكلمة المرور' } };
  }
  const ticket = crypto.randomBytes(24).toString('hex');
  await run('DELETE FROM auth_tickets WHERE expires_at < ?', [Date.now()]);
  await run('INSERT INTO auth_tickets (id, email, expires_at) VALUES (?, ?, ?)', [ticket, cleanEmail, Date.now() + TICKET_TTL_MS]);
  return {
    status: 200,
    body: {
      success: true,
      ticket,
      email: cleanEmail,
      // new: بريد جديد | legacy: حساب قديم بلا كلمة مرور
      account_status: existing ? 'legacy' : 'new',
      nickname: existing ? existing.name : ''
    }
  };
}
async function grantSignupTicket(res, cleanEmail) {
  const r = await signupTicketFor(cleanEmail);
  return res.status(r.status).json(r.body);
}

// الحد الأدنى للعمر عند التسجيل (عدّله هنا إن لزم)
const MIN_SIGNUP_AGE = 13;
const MAX_SIGNUP_AGE = 99;
function parseSignupAge(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= MIN_SIGNUP_AGE && n <= MAX_SIGNUP_AGE ? n : null;
}

// 1) إرسال رمز التحقق إلى الجيميل
app.post('/api/auth/send-gmail-otp', async (req, res) => {
  try {
    const cleanEmail = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (!EMAIL_RE.test(cleanEmail) || cleanEmail.length > 254) {
      return res.status(400).json({ error: 'يرجى إدخال عنوان Gmail صحيح' });
    }

    // البريد لا يتكرر: إن كان مسجّلاً بالفعل باسم مستعار وكلمة مرور فلا نرسل رمزاً، يدخل بالاسم وكلمة المرور
    const prior = await get('SELECT u.id, u.is_banned, c.user_id AS has_cred FROM users u LEFT JOIN user_credentials c ON c.user_id = u.id WHERE LOWER(u.email) = ?', [cleanEmail]);
    if (prior && prior.is_banned) {
      return res.status(403).json({ error: 'هذا الحساب محظور من قبل الإدارة 🚫' });
    }
    if (prior && prior.has_cred) {
      return res.status(409).json({ code: 'email_registered', error: 'هذا البريد مسجّل مسبقاً. ادخل بالاسم المستعار وكلمة المرور' });
    }

    // حد الإرسال: 10 طلبات في الساعة لكل IP
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const recent = (otpSendLog.get(ip) || []).filter(t => now - t < 3600 * 1000);
    if (recent.length >= 10) {
      return res.status(429).json({ error: 'محاولات كثيرة، حاول مرة أخرى بعد قليل' });
    }

    // فاصل 60 ثانية بين كل رمزين لنفس البريد
    const prev = await get('SELECT last_sent FROM email_verifications WHERE email = ?', [cleanEmail]);
    if (prev && now - Number(prev.last_sent || 0) < OTP_RESEND_MS) {
      const wait = Math.ceil((OTP_RESEND_MS - (now - Number(prev.last_sent))) / 1000);
      return res.status(429).json({ error: `انتظر ${wait} ثانية قبل طلب رمز جديد`, retryAfter: wait });
    }

    const smtp = await get('SELECT * FROM smtp_settings WHERE id = 1');
    if (!smtp || !smtp.is_enabled || !smtp.user || !smtp.pass) {
      return res.status(503).json({ error: 'خدمة إرسال البريد غير مفعّلة. اضبط إعدادات SMTP من لوحة الإدارة أو ملف .env' });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    await run(`
      INSERT OR REPLACE INTO email_verifications (email, code, expires_at, attempts, last_sent)
      VALUES (?, ?, ?, 0, ?)
    `, [cleanEmail, code, now + OTP_TTL_MS, now]);

    try {
      const transporter = nodemailer.createTransport({
        host: smtp.host || 'smtp.gmail.com',
        port: parseInt(smtp.port) || 587,
        secure: parseInt(smtp.port) === 465,
        auth: { user: smtp.user, pass: smtp.pass }
      });
      const html = (smtp.html_template || '<p>رمز التحقق: <b>{{code}}</b></p>')
        .replace(/\{\{code\}\}/g, code)
        .replace(/\{\{email\}\}/g, cleanEmail)
        .replace(/\{\{app_name\}\}/g, 'SoulChill');
      const subject = (smtp.subject_template || 'رمز التحقق الخاص بك لتطبيق SoulChill 🪐').replace(/\{\{code\}\}/g, code);
      await transporter.sendMail({ from: smtp.from_email || `SoulChill<${smtp.user}>`, to: cleanEmail, subject, html });
    } catch (mailErr) {
      await run('DELETE FROM email_verifications WHERE email = ?', [cleanEmail]);
      console.warn('❌ [SMTP ERROR] تعذر إرسال رمز التحقق:', mailErr.message);
      return res.status(502).json({ error: 'تعذر إرسال الرسالة إلى بريدك. تأكد من العنوان أو من إعدادات SMTP' });
    }

    recent.push(now);
    otpSendLog.set(ip, recent);
    res.json({ success: true, message: `تم إرسال رمز التحقق إلى ${cleanEmail}`, resendAfter: OTP_RESEND_MS / 1000 });
  } catch (err) {
    console.error('Error sending OTP:', err);
    res.status(500).json({ error: 'فشل إرسال رمز التحقق' });
  }
});

// 2) التحقق من الرمز → تذكرة لإكمال الاسم المستعار وكلمة المرور
app.post('/api/auth/verify-gmail-otp', async (req, res) => {
  try {
    const cleanEmail = String((req.body && req.body.email) || '').trim().toLowerCase();
    const cleanCode = String((req.body && req.body.code) || '').trim();
    if (!cleanEmail || !cleanCode) {
      return res.status(400).json({ error: 'البريد الإلكتروني ورمز التحقق مطلوبان' });
    }

    const record = await get('SELECT * FROM email_verifications WHERE email = ?', [cleanEmail]);
    if (!record || Date.now() > Number(record.expires_at)) {
      if (record) await run('DELETE FROM email_verifications WHERE email = ?', [cleanEmail]);
      return res.status(400).json({ error: 'انتهت صلاحية الرمز، اطلب رمزاً جديداً' });
    }
    if (Number(record.attempts || 0) >= OTP_MAX_ATTEMPTS) {
      await run('DELETE FROM email_verifications WHERE email = ?', [cleanEmail]);
      return res.status(429).json({ error: 'تجاوزت عدد المحاولات، اطلب رمزاً جديداً' });
    }

    const a = Buffer.from(String(record.code));
    const b = Buffer.from(cleanCode);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) {
      await run('UPDATE email_verifications SET attempts = attempts + 1 WHERE email = ?', [cleanEmail]);
      const left = OTP_MAX_ATTEMPTS - (Number(record.attempts || 0) + 1);
      return res.status(400).json({ error: left > 0 ? `رمز التحقق غير صحيح (تبقّى ${left} محاولات)` : 'رمز التحقق غير صحيح، اطلب رمزاً جديداً' });
    }
    await run('DELETE FROM email_verifications WHERE email = ?', [cleanEmail]);
    await grantSignupTicket(res, cleanEmail);
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'فشل التحقق' });
  }
});

// 3) إنشاء الاسم المستعار وكلمة المرور (أو تعيين كلمة مرور جديدة) ثم الدخول
app.post('/api/auth/complete-signup', async (req, res) => {
  try {
    const { ticket } = req.body || {};
    const password = typeof (req.body || {}).password === 'string' ? req.body.password : '';
    const t = ticket ? await get('SELECT * FROM auth_tickets WHERE id = ?', [String(ticket)]) : null;
    if (!t || Date.now() > Number(t.expires_at)) {
      if (t) await run('DELETE FROM auth_tickets WHERE id = ?', [t.id]);
      return res.status(400).json({ error: 'انتهت جلسة التحقق، أعد إدخال بريدك واطلب رمزاً جديداً' });
    }
    const email = t.email;
    const existing = await get('SELECT * FROM users WHERE email = ?', [email]);
    if (existing && existing.is_banned) {
      return res.status(403).json({ error: 'هذا الحساب محظور من قبل الإدارة 🚫' });
    }
    const cred = existing ? await get('SELECT * FROM user_credentials WHERE user_id = ?', [existing.id]) : null;

    if (password && (password.length < 6 || password.length > 64)) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن تكون بين 6 و 64 حرفاً' });
    }

    // البريد مسجّل بالفعل باسم مستعار: لا يُسمح بإعادة استخدامه للتسجيل أو الدخول، فقط بالاسم وكلمة المرور
    if (existing && cred) {
      await run('DELETE FROM auth_tickets WHERE id = ?', [t.id]);
      return res.status(409).json({ code: 'email_registered', error: 'هذا البريد مسجّل مسبقاً. ادخل بالاسم المستعار وكلمة المرور' });
    }

    // حساب جديد أو قديم بلا كلمة مرور: الاسم وكلمة المرور إلزاميان
    const nickname = cleanNickname(req.body.nickname);
    if (!isValidNickname(nickname)) {
      return res.status(400).json({ error: 'الاسم المستعار من 2 إلى 30 حرفاً، بدون الرموز < > & "' });
    }
    if (!password) {
      return res.status(400).json({ error: 'كلمة المرور مطلوبة (6 أحرف على الأقل)' });
    }
    const age = parseSignupAge(req.body.age);
    if (age === null) {
      return res.status(400).json({ error: `اختر عمرك (من ${MIN_SIGNUP_AGE} إلى ${MAX_SIGNUP_AGE} سنة)` });
    }
    const selfId = existing ? existing.id : '';
    const taken = await get(
      `SELECT user_id AS id FROM user_credentials WHERE LOWER(nickname) = LOWER(?) AND user_id != ?
       UNION SELECT id FROM users WHERE LOWER(name) = LOWER(?) AND id != ?`,
      [nickname, selfId, nickname, selfId]
    );
    if (taken) {
      return res.status(409).json({ error: 'هذا الاسم المستعار مستخدم، اختر اسماً آخر' });
    }

    const { salt, hash } = await hashPassword(password);
    let user = existing;
    if (!user) {
      const newId = await generateUserId();
      const planets = ['كوكب الرومانسي الحالم 🌌', 'كوكب المغامر الشغوف 🚀', 'كوكب الفنان الملهم 🎨', 'كوكب الفيلسوف الحكيم 🔮', 'كوكب النسمة الهادئة 🍃'];
      await run(`
        INSERT INTO users (id, google_id, email, name, avatar, bio, age, soul_planet, soul_score, soul_tags, coins, diamonds, level, wealth_level, charm_level)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        newId, `google-${email}`, email, nickname,
        `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encodeURIComponent(nickname)}`,
        'عضو موثق عبر Gmail في SoulChill 🪐✨',
        age,
        planets[crypto.randomInt(0, planets.length)],
        88 + crypto.randomInt(0, 11),
        'بثوث,طرب,شات,ألعاب',
        2500, 600, 1, 1, 1
      ]);
      user = await get('SELECT * FROM users WHERE id = ?', [newId]);
    } else {
      await run('UPDATE users SET name = ?, age = ? WHERE id = ?', [nickname, age, existing.id]);
    }

    try {
      await run('INSERT INTO user_credentials (user_id, nickname, password_hash, password_salt) VALUES (?, ?, ?, ?)', [user.id, nickname, hash, salt]);
    } catch (credErr) {
      // فشل حفظ بيانات الدخول (مثل اسم مأخوذ بالتزامن): لا نترك حساباً يتيماً يحجز البريد
      if (!existing) { try { await run('DELETE FROM users WHERE id = ?', [user.id]); } catch (e) {} }
      throw credErr;
    }
    await run('DELETE FROM auth_tickets WHERE id = ?', [t.id]);
    user = await get('SELECT * FROM users WHERE id = ?', [user.id]);
    res.json(await issueSession(user, nickname));
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'هذا الاسم المستعار مستخدم، اختر اسماً آخر' });
    }
    console.error('Complete signup error:', err);
    res.status(500).json({ error: 'فشل إنشاء الحساب' });
  }
});

// 4) الدخول من أي جهاز بالاسم المستعار وكلمة المرور
app.post('/api/auth/login-nickname', async (req, res) => {
  try {
    const nickname = cleanNickname(req.body && req.body.nickname);
    const password = typeof (req.body || {}).password === 'string' ? req.body.password : '';
    if (!nickname || !password) {
      return res.status(400).json({ error: 'أدخل الاسم المستعار وكلمة المرور' });
    }

    const key = `${req.ip || 'unknown'}|${nickname.toLowerCase()}`;
    const fail = loginFailures.get(key);
    if (fail && fail.until > Date.now()) {
      return res.status(429).json({ error: 'محاولات خاطئة كثيرة، حاول بعد بضع دقائق' });
    }

    const cred = await get('SELECT * FROM user_credentials WHERE nickname = ?', [nickname]);
    const ok = cred
      ? await checkPassword(password, cred.password_salt, cred.password_hash)
      : (await hashPassword(password, '00000000000000000000000000000000'), false); // تقريب زمن الرد
    if (!ok) {
      const nowTs = Date.now();
      // نافذة 10 دقائق لعدّ المحاولات الخاطئة؛ بعد 8 محاولات يُقفل الدخول 10 دقائق
      const f = fail && nowTs - fail.first < 10 * 60 * 1000 ? fail : { count: 0, first: nowTs, until: 0 };
      f.count += 1;
      if (f.count >= 8) { f.until = nowTs + 10 * 60 * 1000; }
      loginFailures.set(key, f);
      return res.status(401).json({ error: 'الاسم المستعار أو كلمة المرور غير صحيحة' });
    }
    loginFailures.delete(key);

    const user = await get('SELECT * FROM users WHERE id = ?', [cred.user_id]);
    if (!user) return res.status(401).json({ error: 'الاسم المستعار أو كلمة المرور غير صحيحة' });
    if (user.is_banned) return res.status(403).json({ error: 'هذا الحساب محظور من قبل الإدارة 🚫' });
    res.json(await issueSession(user, cred.nickname));
  } catch (err) {
    console.error('Nickname login error:', err);
    res.status(500).json({ error: 'فشل تسجيل الدخول' });
  }
});

// 5) التسجيل عبر حساب Google: نتحقق من توقيع الـID Token لدى Google (وأنه صادر لتطبيقنا والبريد موثّق)
//    ثم نمنح التذكرة نفسها لإكمال الاسم المستعار والعمر وكلمة المرور.
app.get('/api/auth/google-config', (req, res) => {
  res.json({
    enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    clientId: process.env.GOOGLE_CLIENT_ID || ''
  });
});

// ---- تدفق «اختيار حساب» الكامل من Google (إعادة توجيه OAuth) ----
const googleOAuthStates = new Map(); // state -> انتهاء الصلاحية (يكفي لعملية قصيرة العمر)
function googleRedirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  return `${proto}://${req.get('host')}/api/auth/google/callback`;
}
function googleOAuthClient(req) {
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, googleRedirectUri(req));
}

app.get('/api/auth/google/start', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.redirect('/#google_error=not_configured');
  }
  const now = Date.now();
  for (const [k, exp] of googleOAuthStates) if (exp < now) googleOAuthStates.delete(k);
  const state = crypto.randomBytes(24).toString('hex');
  googleOAuthStates.set(state, now + 10 * 60 * 1000);
  const url = googleOAuthClient(req).generateAuthUrl({
    scope: ['openid', 'email', 'profile'],
    state,
    prompt: 'select_account', // يعرض دائماً شاشة «اختيار حساب»
    access_type: 'online'
  });
  res.redirect(url);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const back = (frag) => res.redirect('/#' + frag);
  try {
    const { code, state, error } = req.query || {};
    const exp = state ? googleOAuthStates.get(String(state)) : null;
    if (state) googleOAuthStates.delete(String(state)); // استخدام واحد فقط
    if (error) return back('google_error=cancelled');
    if (!exp || exp < Date.now() || !code) return back('google_error=expired');

    const client = googleOAuthClient(req);
    const { tokens } = await client.getToken(String(code));
    const loginTicket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = loginTicket.getPayload() || {};
    const cleanEmail = String(payload.email || '').trim().toLowerCase();
    if (!payload.email_verified || !EMAIL_RE.test(cleanEmail)) return back('google_error=unverified');

    const r = await signupTicketFor(cleanEmail);
    if (r.status === 200) {
      // نمرّر التذكرة في الـfragment (#) كي لا تصل إلى سجلات الخوادم
      const b = r.body;
      return back(`google_ticket=${encodeURIComponent(b.ticket)}&gs=${b.account_status}&gn=${encodeURIComponent(b.nickname || '')}`);
    }
    if (r.body.code === 'email_registered') return back('google_error=email_registered');
    return back('google_error=banned');
  } catch (err) {
    console.error('Google callback error:', err && err.message);
    return back('google_error=failed');
  }
});

app.post(['/api/auth/google', '/api/auth/google-token'], async (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(503).json({ error: 'الدخول عبر Google غير مفعّل على الخادم (GOOGLE_CLIENT_ID)' });
    }
    const credential = String((req.body && (req.body.credential || req.body.idToken)) || '');
    if (!credential || credential.length > 4096) {
      return res.status(400).json({ error: 'بيانات حساب Google غير صالحة' });
    }
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch (e) {
      return res.status(401).json({ error: 'تعذّر التحقق من حساب Google، حاول مجدداً' });
    }
    const cleanEmail = String((payload && payload.email) || '').trim().toLowerCase();
    if (!payload || !payload.email_verified || !EMAIL_RE.test(cleanEmail)) {
      return res.status(401).json({ error: 'بريد Google غير موثّق' });
    }
    await grantSignupTicket(res, cleanEmail);
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(500).json({ error: 'فشل التسجيل عبر Google' });
  }
});

// 2. Get Current User Profile
app.get('/api/users/me', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.query.userId || req.query.id;
    if (!userId || userId === 'null' || userId === 'undefined') {
      return res.status(401).json({ error: 'User ID missing', clearAuth: true });
    }

    let user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      console.log(`Auto-healing user in database for ID: ${userId}`);
      await run(`
        INSERT OR IGNORE INTO users (id, name, email, avatar, bio, soul_planet, soul_score, soul_tags, coins, diamonds, level, wealth_level, charm_level, avatar_frame, role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 5000, 1000, 5, 3, 4, 'vip-crown', 'user')
      `, [
        userId,
        'مستخدم سول ' + (userId.length > 4 ? userId.slice(-4) : userId),
        `${userId}@gmail.com`,
        'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=300&q=80',
        'مرحباً بكم في حسابي على SoulChill ✨',
        'كوكب الرومانسي الحالم 🌌',
        92,
        'موسيقى,سوالف,رواق'
      ]);
      user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found', clearAuth: true });
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ===== رسالة الإدارة الثابتة التي تظهر لكل من يدخل أي غرفة (يضبطها الأدمن) =====
app.get('/api/settings/room-system-message', async (req, res) => {
  try {
    const row = await get(`SELECT value FROM app_settings WHERE key = 'room_system_message'`);
    res.json({ success: true, message: row ? (row.value || '') : '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/settings/room-system-message', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const row = await get(`SELECT value FROM app_settings WHERE key = 'room_system_message'`);
    res.json({ success: true, message: row ? (row.value || '') : '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/settings/room-system-message', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const message = String(req.body?.message ?? '').trim().slice(0, 1000);
    await run(`INSERT INTO app_settings (key, value) VALUES ('room_system_message', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [message]);
    res.json({ success: true, message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== إعدادات المحفظة والمكافأة اليومية (تضبطها الإدارة) =====
const WALLET_DEFAULTS = {
  daily_bonus_enabled: '1',
  daily_bonus_coins: '500',
  daily_bonus_diamonds: '50',
  daily_bonus_text: '',
  user_recharge_enabled: '0'
};
async function getWalletSettings() {
  const rows = await all(`SELECT key, value FROM app_settings WHERE key IN (${Object.keys(WALLET_DEFAULTS).map(() => '?').join(',')})`, Object.keys(WALLET_DEFAULTS));
  const m = { ...WALLET_DEFAULTS };
  rows.forEach(r => { m[r.key] = r.value; });
  const num = (v, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 ? n : d; };
  return {
    daily_bonus_enabled: m.daily_bonus_enabled === '1',
    daily_bonus_coins: num(m.daily_bonus_coins, 500),
    daily_bonus_diamonds: num(m.daily_bonus_diamonds, 50),
    daily_bonus_text: String(m.daily_bonus_text || ''),
    user_recharge_enabled: m.user_recharge_enabled === '1'
  };
}
app.get('/api/settings/wallet', async (req, res) => {
  try {
    res.json({ success: true, settings: await getWalletSettings() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/admin/settings/wallet', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    res.json({ success: true, settings: await getWalletSettings() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/admin/settings/wallet', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const b = req.body || {};
    const clampInt = (v) => String(Math.min(1000000, Math.max(0, Math.floor(Number(v)) || 0)));
    const entries = {
      daily_bonus_enabled: b.daily_bonus_enabled ? '1' : '0',
      daily_bonus_coins: clampInt(b.daily_bonus_coins),
      daily_bonus_diamonds: clampInt(b.daily_bonus_diamonds),
      daily_bonus_text: String(b.daily_bonus_text ?? '').trim().slice(0, 200),
      user_recharge_enabled: b.user_recharge_enabled ? '1' : '0'
    };
    for (const [k, v] of Object.entries(entries)) {
      await run(`INSERT INTO app_settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, v]);
    }
    res.json({ success: true, settings: await getWalletSettings() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2b. Get User Profile by ID
// قواعد رفع المنشورات: تظهر مرة واحدة فقط لكل حساب (محفوظة في قاعدة البيانات)
app.get('/api/moment-rules/status', async (req, res) => {
  try {
    const uid = req.headers['x-user-id'];
    if (!uid) return res.json({ seen: false });
    const u = await get('SELECT moment_rules_seen FROM users WHERE id = ?', [uid]);
    res.json({ seen: !!(u && u.moment_rules_seen) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/moment-rules/seen', async (req, res) => {
  try {
    const uid = req.headers['x-user-id'];
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    await run('UPDATE users SET moment_rules_seen = 1 WHERE id = ?', [uid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const user = await get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    // VIP المنتهي يظهر VIP0 دائماً + بطاقات العرض (الثروة / الرواج / VIP)
    user.vip_level = require('./member-levels').activeVipLevel(user);
    user.cards = require('./member-levels').buildCards(user);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Update User Profile
// صور خلفية الملف الشخصي: حتى 6 صور، والصورة الأولى هي صورة الغلاف
app.put('/api/users/covers', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!Array.isArray(req.body.images)) return res.status(400).json({ error: 'قائمة الصور غير صالحة' });
    const clean = req.body.images
      .filter(u => typeof u === 'string' && (u.startsWith('/uploads/') || /^https:\/\//i.test(u)))
      .map(u => u.slice(0, 500))
      .slice(0, 6);
    const exists = await get('SELECT id FROM users WHERE id = ?', [userId]);
    if (!exists) return res.status(404).json({ error: 'User not found' });
    await run('UPDATE users SET cover_images = ? WHERE id = ?', [JSON.stringify(clean), userId]);
    const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    res.json({ success: true, images: clean, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/profile', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { bio, gender, age, avatar, avatar_frame, chat_frame, soul_planet, soul_tags } = req.body;
    // الاسم لا يتكرر: يُرفض أي اسم يستخدمه حساب آخر (حتى باختلاف حالة الأحرف)
    let name = req.body.name;
    let nameChanged = false;
    if (typeof name === 'string' && name.trim()) {
      name = name.replace(/\s+/g, ' ').trim();
      const cur = await get('SELECT name FROM users WHERE id = ?', [userId]);
      if (cur && cur.name.toLowerCase() !== name.toLowerCase()) {
        if (!isValidNickname(name)) return res.status(400).json({ error: 'الاسم من 2 إلى 30 حرفاً، بدون الرموز < > & "' });
        const clash = await get(
          `SELECT user_id AS id FROM user_credentials WHERE nickname = ? AND user_id != ?
           UNION SELECT id FROM users WHERE LOWER(name) = LOWER(?) AND id != ?`,
          [name, userId, name, userId]
        );
        if (clash) return res.status(409).json({ error: 'هذا الاسم مستخدم من قبل، اختر اسماً آخر' });
        nameChanged = true;
      } else if (cur) {
        name = cur.name; // نفس الاسم الحالي: لا تغيير
      }
    } else {
      name = undefined;
    }
    const country_code = SUPPORTED_COUNTRIES.some(c => c.code === req.body.country_code && !c.isGlobal) ? req.body.country_code : undefined;
    let entry_effect = req.body.entry_effect;
    // لا يُسمح بتفعيل قالب دخول إلا لمن يملكه
    if (entry_effect && !(await getOwnedEntryTemplate(userId, entry_effect))) entry_effect = undefined;
    // لا يُسمح بتفعيل إطار مرفوع من الإدارة إلا لمن اشتراه
    let pfFrame = avatar_frame;
    if (pfFrame && String(pfFrame).startsWith('cf-') && !(await getOwnedAvatarFrame(userId, pfFrame))) pfFrame = undefined;

    await run(`
      UPDATE users SET
        name = COALESCE(?, name),
        bio = COALESCE(?, bio),
        gender = COALESCE(?, gender),
        age = COALESCE(?, age),
        avatar = COALESCE(?, avatar),
        avatar_frame = COALESCE(?, avatar_frame),
        chat_frame = COALESCE(?, chat_frame),
        entry_effect = COALESCE(?, entry_effect),
        soul_planet = COALESCE(?, soul_planet),
        soul_tags = COALESCE(?, soul_tags),
        country_code = COALESCE(?, country_code)
      WHERE id = ?
    `, [name, bio, gender, age, avatar, pfFrame, chat_frame, entry_effect, soul_planet, soul_tags, country_code, userId]);
    pushUserAccessories(userId);

    if (nameChanged) {
      // اسم الدخول يتبع الاسم الظاهر ليبقى واحداً
      await run('UPDATE user_credentials SET nickname = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?', [name, userId]);
    }
    const updatedUser = await get('SELECT * FROM users WHERE id = ?', [userId]);
    res.json({ success: true, user: updatedUser });
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) return res.status(409).json({ error: 'هذا الاسم مستخدم من قبل، اختر اسماً آخر' });
    res.status(500).json({ error: err.message });
  }
});

// 3a. Equip User Accessories (Chat Bubble Frame, Entry Effect, Avatar Frame)
// بثّ تغيير الإكسسوارات (إطار الصورة/الرسالة/قالب الدخول) فوراً لكل من في نفس الغرفة بدون إعادة تحميل
async function pushUserAccessories(userId) {
  try {
    const u = await get('SELECT id, avatar, avatar_frame, chat_frame, entry_effect, room_card FROM users WHERE id = ?', [userId]);
    if (!u) return;
    for (const [roomId, st] of activeRoomStates.entries()) {
      const a = st && st.activeAudience && st.activeAudience.get(userId);
      if (!a) continue;
      a.avatar = u.avatar; a.avatar_frame = u.avatar_frame; a.chat_frame = u.chat_frame; a.entry_effect = u.entry_effect;
      io.to(`room:${roomId}`).emit('user_accessories_updated', {
        userId, avatar: u.avatar, avatar_frame: u.avatar_frame, chat_frame: u.chat_frame, entry_effect: u.entry_effect, room_card: u.room_card
      });
    }
  } catch (e) { console.error('pushUserAccessories error:', e); }
}

app.post('/api/users/accessories', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.body?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { chat_frame, avatar_frame } = req.body;
    let entry_effect = req.body.entry_effect;
    // لا يُسمح بتفعيل قالب دخول إلا لمن يملكه
    if (entry_effect && !(await getOwnedEntryTemplate(userId, entry_effect))) {
      return res.status(403).json({ error: 'لا تملك قالب الدخول هذا، اشترِه أولاً بالكرستالات' });
    }

    if (avatar_frame && String(avatar_frame).startsWith('cf-') && !(await getOwnedAvatarFrame(userId, avatar_frame))) {
      return res.status(403).json({ error: 'لا تملك هذا الإطار، اشتره أولاً بالكرستالات' });
    }

    await run(`
      UPDATE users SET
        chat_frame = COALESCE(?, chat_frame),
        entry_effect = COALESCE(?, entry_effect),
        avatar_frame = COALESCE(?, avatar_frame)
      WHERE id = ?
    `, [chat_frame, entry_effect, avatar_frame, userId]);
    pushUserAccessories(userId);

    const updatedUser = await get('SELECT * FROM users WHERE id = ?', [userId]);
    res.json({ success: true, user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== مدد الصلاحية + شراء عناصر المخزن =====================
const DURATION_OPTIONS = [0, 7, 14, 30]; // 0 = دائم
function parseDuration(v, fallback) {
  const n = parseInt(v, 10);
  return DURATION_OPTIONS.includes(n) ? n : (fallback || 0);
}
// شراء/تجديد عنصر من المخزن: يخصم الكرستالات ثم يمنح العنصر (مع تاريخ انتهاء إن وُجدت مدة)
async function buyInventoryItem(userId, type, item, label) {
  const price = Math.max(0, parseInt(item.price, 10) || 0);
  const days = parseDuration(item.duration_days, 0);
  const existing = await get(
    `SELECT id, (expires_at IS NULL OR expires_at > datetime('now')) AS active FROM user_inventory WHERE user_id = ? AND item_type = ? AND item_id = ?`,
    [userId, type, item.id]);
  if (existing && existing.active) return { status: 400, error: `تملك ${label} بالفعل` };
  const paid = await run('UPDATE users SET diamonds = diamonds - ? WHERE id = ? AND diamonds >= ?', [price, userId, price]);
  if (!paid.changes) return { status: 400, error: `رصيدك من الكرستالات غير كافٍ (السعر ${price} 💎)` };
  const expr = days > 0 ? `datetime('now', '+${days} days')` : 'NULL';
  try {
    if (existing) {
      await run(`UPDATE user_inventory SET expires_at = ${expr}, item_name = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?`, [item.name, existing.id]);
    } else {
      await run(`INSERT INTO user_inventory (id, user_id, item_type, item_id, item_name, expires_at) VALUES (?, ?, ?, ?, ?, ${expr})`,
        [uuidv4(), userId, type, item.id, item.name]);
    }
  } catch (e) {
    await run('UPDATE users SET diamonds = diamonds + ? WHERE id = ?', [price, userId]);
    return { status: 400, error: `تملك ${label} بالفعل` };
  }
  return { ok: true };
}
// إزالة العناصر المنتهية: تُفكّ من الحساب إن كانت مفعّلة ثم تُحذف من المخزن
let _lastPurge = 0;
async function purgeExpiredInventory(force) {
  const now = Date.now();
  if (!force && now - _lastPurge < 30000) return;
  _lastPurge = now;
  try {
    const rows = await all(`SELECT id, user_id, item_type, item_id FROM user_inventory WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')`);
    let cardsChanged = false;
    for (const r of rows) {
      if (r.item_type === 'entry_effect') await run(`UPDATE users SET entry_effect = '' WHERE id = ? AND entry_effect = ?`, [r.user_id, r.item_id]);
      else if (r.item_type === 'avatar_frame') {
        await run('UPDATE users SET avatar_frame = ? WHERE id = ? AND avatar_frame = ?', [DEFAULT_AVATAR_FRAME, r.user_id, r.item_id]);
      }
      else if (r.item_type === 'room_card') { const ch = await run(`UPDATE users SET room_card = '' WHERE id = ? AND room_card = ?`, [r.user_id, r.item_id]); if (ch.changes) cardsChanged = true; }
      await run('DELETE FROM user_inventory WHERE id = ?', [r.id]);
    }
    if (cardsChanged) io.emit('rooms_refresh', {});
  } catch (e) { console.error('purge expired inventory error:', e.message); }
}
setInterval(() => purgeExpiredInventory(true), 60 * 1000);
setTimeout(() => purgeExpiredInventory(true), 5000);

// ===================== قوالب الدخول (تُشترى بالكرستالات) =====================
// يرجع القالب فقط إذا كان المستخدم يملكه (وإلا null)
async function getOwnedEntryTemplate(userId, templateId) {
  if (!userId || !templateId) return null;
  const row = await get(`
    SELECT t.id, t.name, t.image_url
    FROM entry_templates t
    JOIN user_inventory i ON i.item_id = t.id AND i.user_id = ? AND i.item_type = 'entry_effect' AND (i.expires_at IS NULL OR i.expires_at > datetime('now'))
    WHERE t.id = ?
  `, [userId, templateId]);
  return row || null;
}

function safeDeleteEntryImage(imageUrl) {
  try {
    if (!imageUrl || !imageUrl.startsWith('/uploads/entry-')) return;
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    const full = path.join(__dirname, 'public', imageUrl);
    if (path.dirname(full) === uploadsDir && fs.existsSync(full)) fs.unlinkSync(full);
  } catch (e) { console.error('delete entry image error:', e.message); }
}

const ENTRY_IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
// قوالب الدخول تقبل أيضاً مقاطع الفيديو (MP4 / WEBM / MOV) بالإضافة إلى الصور وGIF
const ENTRY_MEDIA_EXT = Object.assign({}, ENTRY_IMAGE_EXT, { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mp4' });
const entryImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => cb(null, `entry-${Date.now()}-${uuidv4().slice(0, 8)}${ENTRY_MEDIA_EXT[file.mimetype] || '.png'}`)
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ENTRY_MEDIA_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('يُسمح فقط بصور PNG/JPG/GIF/WEBP أو فيديو MP4/WEBM'));
  }
});

// التحقق من صلاحية الإدارة قبل استقبال الملف، ثم رفع الصورة
async function adminEntryImageUpload(req, res, next) {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  entryImageUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'حجم الملف أكبر من 25MB' : err.message });
    next();
  });
}

// قائمة القوالب للمستخدم (المتاحة للبيع + ما يملكه)
app.get('/api/entry-templates', async (req, res) => {
  try {
    await purgeExpiredInventory();
    const userId = req.headers['x-user-id'] || '';
    const rows = await all(`
      SELECT t.id, t.name, t.image_url, t.price, t.is_active, t.duration_days,
             CASE WHEN i.id IS NULL THEN 0 ELSE 1 END AS owned, i.created_at AS owned_at, i.expires_at AS expires_at
      FROM entry_templates t
      LEFT JOIN user_inventory i ON i.item_id = t.id AND i.user_id = ? AND i.item_type = 'entry_effect' AND (i.expires_at IS NULL OR i.expires_at > datetime('now'))
      WHERE t.is_active = 1 OR i.id IS NOT NULL
      ORDER BY t.created_at DESC, t.rowid DESC
    `, [userId]);
    const u = userId ? await get('SELECT entry_effect FROM users WHERE id = ?', [userId]) : null;
    res.json({
      templates: rows.map(r => ({ id: r.id, name: r.name, image_url: r.image_url, price: r.price, duration_days: r.duration_days || 0, owned: !!r.owned, owned_at: r.owned_at || null, expires_at: r.expires_at || null })),
      equipped: (u && u.entry_effect) || ''
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// مؤثرات الدخول التي اشتراها مستخدم معيّن (عامة: تظهر في ملفه الشخصي لأي زائر)
app.get('/api/users/:id/entry-effects', async (req, res) => {
  try {
    await purgeExpiredInventory();
    const id = req.params.id;
    const rows = await all(`
      SELECT t.id, t.name, t.image_url
      FROM user_inventory i
      JOIN entry_templates t ON t.id = i.item_id
      WHERE i.user_id = ? AND i.item_type = 'entry_effect' AND (i.expires_at IS NULL OR i.expires_at > datetime('now'))
      ORDER BY i.created_at DESC
    `, [id]);
    const u = await get('SELECT entry_effect FROM users WHERE id = ?', [id]);
    res.json({ effects: rows, equipped: (u && u.entry_effect) || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// شراء قالب دخول بالكرستالات (الألماس)
app.post('/api/entry-templates/:id/buy', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'سجّل الدخول أولاً' });
  try {
    const tpl = await get('SELECT * FROM entry_templates WHERE id = ? AND is_active = 1', [req.params.id]);
    if (!tpl) return res.status(404).json({ error: 'هذا القالب غير متاح للشراء' });
    const user = await get('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const bought = await buyInventoryItem(userId, 'entry_effect', tpl, 'هذا القالب');
    if (!bought.ok) return res.status(bought.status).json({ error: bought.error });

    const updatedUser = await get('SELECT * FROM users WHERE id = ?', [userId]);
    res.json({ success: true, user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// تفعيل قالب دخول يملكه المستخدم (أو إلغاء التفعيل بإرسال templateId فارغ)
app.post('/api/entry-templates/equip', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'سجّل الدخول أولاً' });
  try {
    const templateId = req.body && req.body.templateId ? String(req.body.templateId) : '';
    if (templateId && !(await getOwnedEntryTemplate(userId, templateId))) {
      return res.status(403).json({ error: 'لا تملك قالب الدخول هذا، اشترِه أولاً بالكرستالات' });
    }
    await run('UPDATE users SET entry_effect = ? WHERE id = ?', [templateId, userId]);
    pushUserAccessories(userId);
    const updatedUser = await get('SELECT * FROM users WHERE id = ?', [userId]);
    res.json({ success: true, user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- إدارة القوالب من لوحة الإدارة ----
app.get('/api/admin/entry-templates', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const rows = await all(`
      SELECT t.*, (SELECT COUNT(*) FROM user_inventory i WHERE i.item_type = 'entry_effect' AND i.item_id = t.id) AS owners_count
      FROM entry_templates t ORDER BY t.created_at DESC, t.rowid DESC
    `);
    res.json({ templates: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/entry-templates', adminEntryImageUpload, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const price = parseInt(req.body.price, 10);
    if (!name) { if (req.file) safeDeleteEntryImage(`/uploads/${req.file.filename}`); return res.status(400).json({ error: 'يرجى كتابة اسم القالب' }); }
    if (!Number.isFinite(price) || price < 0) { if (req.file) safeDeleteEntryImage(`/uploads/${req.file.filename}`); return res.status(400).json({ error: 'يرجى إدخال سعر صحيح بالكرستالات' }); }
    if (!req.file) return res.status(400).json({ error: 'يرجى اختيار صورة أو فيديو للقالب' });

    const id = `entry-${uuidv4().slice(0, 8)}`;
    await run('INSERT INTO entry_templates (id, name, image_url, price, duration_days, is_active) VALUES (?, ?, ?, ?, ?, 1)',
      [id, name, `/uploads/${req.file.filename}`, price, parseDuration(req.body.duration_days, 0)]);
    io.emit('charge_agents_updated', { at: Date.now() });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/entry-templates/:id', adminEntryImageUpload, async (req, res) => {
  try {
    const tpl = await get('SELECT * FROM entry_templates WHERE id = ?', [req.params.id]);
    if (!tpl) { if (req.file) safeDeleteEntryImage(`/uploads/${req.file.filename}`); return res.status(404).json({ error: 'القالب غير موجود' }); }

    const name = req.body.name !== undefined ? String(req.body.name).trim() : tpl.name;
    const price = req.body.price !== undefined ? parseInt(req.body.price, 10) : tpl.price;
    const isActive = req.body.is_active !== undefined ? (String(req.body.is_active) === '1' || req.body.is_active === 'true' ? 1 : 0) : tpl.is_active;
    if (!name || !Number.isFinite(price) || price < 0) {
      if (req.file) safeDeleteEntryImage(`/uploads/${req.file.filename}`);
      return res.status(400).json({ error: 'يرجى التأكد من الاسم والسعر' });
    }

    let imageUrl = tpl.image_url;
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
      safeDeleteEntryImage(tpl.image_url);
    }
    await run('UPDATE entry_templates SET name = ?, price = ?, is_active = ?, image_url = ?, duration_days = ? WHERE id = ?',
      [name, price, isActive, imageUrl, req.body.duration_days !== undefined ? parseDuration(req.body.duration_days, 0) : (tpl.duration_days || 0), tpl.id]);
    await run(`UPDATE user_inventory SET item_name = ? WHERE item_type = 'entry_effect' AND item_id = ?`, [name, tpl.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/entry-templates/:id', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const tpl = await get('SELECT * FROM entry_templates WHERE id = ?', [req.params.id]);
    if (!tpl) return res.status(404).json({ error: 'القالب غير موجود' });
    await run(`DELETE FROM user_inventory WHERE item_type = 'entry_effect' AND item_id = ?`, [tpl.id]);
    await run(`UPDATE users SET entry_effect = '' WHERE entry_effect = ?`, [tpl.id]);
    await run('DELETE FROM entry_templates WHERE id = ?', [tpl.id]);
    safeDeleteEntryImage(tpl.image_url);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== إطارات الأفاتار (تُرفع من الإدارة وتُشترى بالكرستالات) =====================
const DEFAULT_AVATAR_FRAME = 'cosmic_ring';

async function getOwnedAvatarFrame(userId, frameId) {
  if (!userId || !frameId) return null;
  const row = await get(`
    SELECT f.id, f.name, f.image_url, f.scale
    FROM avatar_frames f
    JOIN user_inventory i ON i.item_id = f.id AND i.user_id = ? AND i.item_type = 'avatar_frame' AND (i.expires_at IS NULL OR i.expires_at > datetime('now'))
    WHERE f.id = ?
  `, [userId, frameId]);
  return row || null;
}

function safeDeleteFrameImage(imageUrl) {
  try {
    if (!imageUrl || !imageUrl.startsWith('/uploads/frame-')) return;
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    const full = path.join(__dirname, 'public', imageUrl);
    if (path.dirname(full) === uploadsDir && fs.existsSync(full)) fs.unlinkSync(full);
  } catch (e) { console.error('delete frame image error:', e.message); }
}

const frameImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => cb(null, `frame-${Date.now()}-${uuidv4().slice(0, 8)}${ENTRY_IMAGE_EXT[file.mimetype] || '.png'}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ENTRY_IMAGE_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('يُسمح فقط بصور PNG أو GIF أو WEBP أو JPG'));
  }
});

async function adminFrameImageUpload(req, res, next) {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  frameImageUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'حجم الصورة أكبر من 5MB' : err.message });
    next();
  });
}

function parseFrameScale(v, fallback) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(2, Math.max(1, n));
}

// قائمة الإطارات: يحتاجها الجميع لرسم إطارات الآخرين، والمالك فقط يرى owned
app.get('/api/avatar-frames', async (req, res) => {
  try {
    await purgeExpiredInventory();
    const userId = req.headers['x-user-id'] || '';
    const rows = await all(`
      SELECT f.id, f.name, f.image_url, f.price, f.scale, f.is_active, f.duration_days,
             CASE WHEN i.id IS NULL THEN 0 ELSE 1 END AS owned, i.created_at AS owned_at, i.expires_at AS expires_at
      FROM avatar_frames f
      LEFT JOIN user_inventory i ON i.item_id = f.id AND i.user_id = ? AND i.item_type = 'avatar_frame' AND (i.expires_at IS NULL OR i.expires_at > datetime('now'))
      ORDER BY f.created_at DESC, f.rowid DESC
    `, [userId]);
    const u = userId ? await get('SELECT avatar_frame FROM users WHERE id = ?', [userId]) : null;
    res.json({
      frames: rows.map(r => ({
        id: r.id, name: r.name, image_url: r.image_url, price: r.price, scale: r.scale,
        is_active: !!r.is_active, duration_days: r.duration_days || 0, owned: !!r.owned, owned_at: r.owned_at || null, expires_at: r.expires_at || null
      })),
      equipped: (u && u.avatar_frame) || ''
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/avatar-frames/:id/buy', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'سجّل الدخول أولاً' });
  try {
    const frame = await get('SELECT * FROM avatar_frames WHERE id = ? AND is_active = 1', [req.params.id]);
    if (!frame) return res.status(404).json({ error: 'هذا الإطار غير متاح للشراء' });
    const user = await get('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const bought = await buyInventoryItem(userId, 'avatar_frame', frame, 'هذا الإطار');
    if (!bought.ok) return res.status(bought.status).json({ error: bought.error });

    const updatedUser = await get('SELECT * FROM users WHERE id = ?', [userId]);
    res.json({ success: true, user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- إدارة الإطارات من لوحة الإدارة ----
app.get('/api/admin/avatar-frames', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const rows = await all(`
      SELECT f.*, (SELECT COUNT(*) FROM user_inventory i WHERE i.item_type = 'avatar_frame' AND i.item_id = f.id) AS owners_count
      FROM avatar_frames f ORDER BY f.created_at DESC, f.rowid DESC
    `);
    res.json({ frames: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/avatar-frames', adminFrameImageUpload, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const price = parseInt(req.body.price, 10);
    const scale = parseFrameScale(req.body.scale, 1.3);
    const drop = () => { if (req.file) safeDeleteFrameImage(`/uploads/${req.file.filename}`); };
    if (!name) { drop(); return res.status(400).json({ error: 'يرجى كتابة اسم الإطار' }); }
    if (!Number.isFinite(price) || price < 0) { drop(); return res.status(400).json({ error: 'يرجى إدخال سعر صحيح بالكرستالات' }); }
    if (!req.file) return res.status(400).json({ error: 'يرجى اختيار صورة الإطار' });

    const id = `cf-${uuidv4().slice(0, 8)}`;
    await run('INSERT INTO avatar_frames (id, name, image_url, price, scale, duration_days, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
      [id, name, `/uploads/${req.file.filename}`, price, scale, parseDuration(req.body.duration_days, 0)]);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/avatar-frames/:id', adminFrameImageUpload, async (req, res) => {
  try {
    const frame = await get('SELECT * FROM avatar_frames WHERE id = ?', [req.params.id]);
    const drop = () => { if (req.file) safeDeleteFrameImage(`/uploads/${req.file.filename}`); };
    if (!frame) { drop(); return res.status(404).json({ error: 'الإطار غير موجود' }); }

    const name = req.body.name !== undefined ? String(req.body.name).trim() : frame.name;
    const price = req.body.price !== undefined ? parseInt(req.body.price, 10) : frame.price;
    const scale = req.body.scale !== undefined ? parseFrameScale(req.body.scale, frame.scale) : frame.scale;
    const isActive = req.body.is_active !== undefined ? (String(req.body.is_active) === '1' || req.body.is_active === 'true' ? 1 : 0) : frame.is_active;
    if (!name || !Number.isFinite(price) || price < 0) { drop(); return res.status(400).json({ error: 'يرجى التأكد من الاسم والسعر' }); }

    let imageUrl = frame.image_url;
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
      safeDeleteFrameImage(frame.image_url);
    }
    await run('UPDATE avatar_frames SET name = ?, price = ?, scale = ?, is_active = ?, image_url = ?, duration_days = ? WHERE id = ?',
      [name, price, scale, isActive, imageUrl, req.body.duration_days !== undefined ? parseDuration(req.body.duration_days, 0) : (frame.duration_days || 0), frame.id]);
    await run(`UPDATE user_inventory SET item_name = ? WHERE item_type = 'avatar_frame' AND item_id = ?`, [name, frame.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/avatar-frames/:id', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const frame = await get('SELECT * FROM avatar_frames WHERE id = ?', [req.params.id]);
    if (!frame) return res.status(404).json({ error: 'الإطار غير موجود' });
    await run(`DELETE FROM user_inventory WHERE item_type = 'avatar_frame' AND item_id = ?`, [frame.id]);
    await run('UPDATE users SET avatar_frame = ? WHERE avatar_frame = ?', [DEFAULT_AVATAR_FRAME, frame.id]);
    await run('DELETE FROM avatar_frames WHERE id = ?', [frame.id]);
    safeDeleteFrameImage(frame.image_url);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== بطاقات الغرف (شكل غرفة المستخدم من الخارج في قائمة الغرف) =====================
async function getOwnedRoomCard(userId, cardId) {
  if (!userId || !cardId) return null;
  const row = await get(`
    SELECT c.id, c.name, c.image_url
    FROM room_cards c
    JOIN user_inventory i ON i.item_id = c.id AND i.user_id = ? AND i.item_type = 'room_card' AND (i.expires_at IS NULL OR i.expires_at > datetime('now'))
    WHERE c.id = ?
  `, [userId, cardId]);
  return row || null;
}

function safeDeleteRoomCardImage(imageUrl) {
  try {
    if (!imageUrl || !imageUrl.startsWith('/uploads/roomcard-')) return;
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    const full = path.join(__dirname, 'public', imageUrl);
    if (path.dirname(full) === uploadsDir && fs.existsSync(full)) fs.unlinkSync(full);
  } catch (e) { console.error('delete room card image error:', e.message); }
}

const roomCardImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => cb(null, `roomcard-${Date.now()}-${uuidv4().slice(0, 8)}${ENTRY_IMAGE_EXT[file.mimetype] || '.png'}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ENTRY_IMAGE_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('يُسمح فقط بصور PNG أو JPG أو GIF أو WEBP'));
  }
});

async function adminRoomCardImageUpload(req, res, next) {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  roomCardImageUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'حجم الصورة أكبر من 5MB' : err.message });
    next();
  });
}

// قائمة البطاقات للمستخدم (المتاحة للبيع + ما يملكه) مع البطاقة المفعّلة
app.get('/api/room-cards', async (req, res) => {
  try {
    await purgeExpiredInventory();
    const userId = req.headers['x-user-id'] || '';
    const rows = await all(`
      SELECT c.id, c.name, c.image_url, c.price, c.is_active, c.duration_days,
             CASE WHEN i.id IS NULL THEN 0 ELSE 1 END AS owned, i.created_at AS owned_at, i.expires_at AS expires_at
      FROM room_cards c
      LEFT JOIN user_inventory i ON i.item_id = c.id AND i.user_id = ? AND i.item_type = 'room_card' AND (i.expires_at IS NULL OR i.expires_at > datetime('now'))
      WHERE c.is_active = 1 OR i.id IS NOT NULL
      ORDER BY c.created_at DESC, c.rowid DESC
    `, [userId]);
    const u = userId ? await get('SELECT room_card FROM users WHERE id = ?', [userId]) : null;
    res.json({
      cards: rows.map(r => ({ id: r.id, name: r.name, image_url: r.image_url, price: r.price, duration_days: r.duration_days || 0, owned: !!r.owned, owned_at: r.owned_at || null, expires_at: r.expires_at || null })),
      equipped: (u && u.room_card) || ''
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/room-cards/:id/buy', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'سجّل الدخول أولاً' });
  try {
    const card = await get('SELECT * FROM room_cards WHERE id = ? AND is_active = 1', [req.params.id]);
    if (!card) return res.status(404).json({ error: 'هذه البطاقة غير متاحة للشراء' });
    const user = await get('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const bought = await buyInventoryItem(userId, 'room_card', card, 'هذه البطاقة');
    if (!bought.ok) return res.status(bought.status).json({ error: bought.error });

    const updatedUser = await get('SELECT * FROM users WHERE id = ?', [userId]);
    res.json({ success: true, user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// تفعيل بطاقة يملكها المستخدم على غرفته (أو إلغاء التفعيل بإرسال cardId فارغ)
app.post('/api/room-cards/equip', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'سجّل الدخول أولاً' });
  try {
    const cardId = req.body && req.body.cardId ? String(req.body.cardId) : '';
    if (cardId && !(await getOwnedRoomCard(userId, cardId))) {
      return res.status(403).json({ error: 'لا تملك بطاقة الغرفة هذه، اشترِها أولاً بالكرستالات' });
    }
    await run('UPDATE users SET room_card = ? WHERE id = ?', [cardId, userId]);
    io.emit('rooms_refresh', { host_id: userId });
    pushUserAccessories(userId);
    const updatedUser = await get('SELECT * FROM users WHERE id = ?', [userId]);
    res.json({ success: true, user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- إدارة بطاقات الغرف من لوحة الإدارة ----
app.get('/api/admin/room-cards', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const rows = await all(`
      SELECT c.*, (SELECT COUNT(*) FROM user_inventory i WHERE i.item_type = 'room_card' AND i.item_id = c.id) AS owners_count
      FROM room_cards c ORDER BY c.created_at DESC, c.rowid DESC
    `);
    res.json({ cards: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/room-cards', adminRoomCardImageUpload, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const price = parseInt(req.body.price, 10);
    const drop = () => { if (req.file) safeDeleteRoomCardImage(`/uploads/${req.file.filename}`); };
    if (!name) { drop(); return res.status(400).json({ error: 'يرجى كتابة اسم البطاقة' }); }
    if (!Number.isFinite(price) || price < 0) { drop(); return res.status(400).json({ error: 'يرجى إدخال سعر صحيح بالكرستالات' }); }
    if (!req.file) return res.status(400).json({ error: 'يرجى اختيار صورة البطاقة' });

    const id = `rc-${uuidv4().slice(0, 8)}`;
    await run('INSERT INTO room_cards (id, name, image_url, price, duration_days, is_active) VALUES (?, ?, ?, ?, ?, 1)',
      [id, name, `/uploads/${req.file.filename}`, price, parseDuration(req.body.duration_days, 0)]);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/room-cards/:id', adminRoomCardImageUpload, async (req, res) => {
  try {
    const card = await get('SELECT * FROM room_cards WHERE id = ?', [req.params.id]);
    const drop = () => { if (req.file) safeDeleteRoomCardImage(`/uploads/${req.file.filename}`); };
    if (!card) { drop(); return res.status(404).json({ error: 'البطاقة غير موجودة' }); }

    const name = req.body.name !== undefined ? String(req.body.name).trim() : card.name;
    const price = req.body.price !== undefined ? parseInt(req.body.price, 10) : card.price;
    const isActive = req.body.is_active !== undefined ? (String(req.body.is_active) === '1' || req.body.is_active === 'true' ? 1 : 0) : card.is_active;
    if (!name || !Number.isFinite(price) || price < 0) { drop(); return res.status(400).json({ error: 'يرجى التأكد من الاسم والسعر' }); }

    let imageUrl = card.image_url;
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
      safeDeleteRoomCardImage(card.image_url);
    }
    await run('UPDATE room_cards SET name = ?, price = ?, is_active = ?, image_url = ?, duration_days = ? WHERE id = ?',
      [name, price, isActive, imageUrl, req.body.duration_days !== undefined ? parseDuration(req.body.duration_days, 0) : (card.duration_days || 0), card.id]);
    await run(`UPDATE user_inventory SET item_name = ? WHERE item_type = 'room_card' AND item_id = ?`, [name, card.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/room-cards/:id', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const card = await get('SELECT * FROM room_cards WHERE id = ?', [req.params.id]);
    if (!card) return res.status(404).json({ error: 'البطاقة غير موجودة' });
    await run(`DELETE FROM user_inventory WHERE item_type = 'room_card' AND item_id = ?`, [card.id]);
    await run(`UPDATE users SET room_card = '' WHERE room_card = ?`, [card.id]);
    await run('DELETE FROM room_cards WHERE id = ?', [card.id]);
    safeDeleteRoomCardImage(card.image_url);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== إدارة الهدايا من لوحة الإدارة =====================
function safeDeleteGiftImage(imageUrl) {
  try {
    if (!imageUrl || !imageUrl.startsWith('/uploads/gift-')) return;
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    const full = path.join(__dirname, 'public', imageUrl);
    if (path.dirname(full) === uploadsDir && fs.existsSync(full)) fs.unlinkSync(full);
  } catch (e) { console.error('delete gift image error:', e.message); }
}

const giftImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => cb(null, `gift-${Date.now()}-${uuidv4().slice(0, 8)}${ENTRY_IMAGE_EXT[file.mimetype] || '.png'}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ENTRY_IMAGE_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('يُسمح فقط بصور PNG أو JPG أو GIF أو WEBP'));
  }
});

async function adminGiftImageUpload(req, res, next) {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  giftImageUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'حجم الصورة أكبر من 5MB' : err.message });
    next();
  });
}

const adminFlag = (v) => (String(v) === '1' || String(v) === 'true') ? 1 : 0;
const adminBurstCount = (v, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(60, Math.max(1, n)) : def;
};

app.get('/api/admin/gifts', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const rows = await all(`
      SELECT g.*, (SELECT COUNT(*) FROM gifts_history h WHERE h.gift_id = g.id) AS sent_count
      FROM gifts_catalog g ORDER BY g.sort_order ASC, g.rowid ASC
    `);
    res.json({ gifts: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/gifts', adminGiftImageUpload, async (req, res) => {
  try {
    const drop = () => {
      if (req.file) safeDeleteGiftImage(`/uploads/${req.file.filename}`);
    };
    const name = String(req.body.name || '').trim();
    const cost = parseInt(req.body.cost, 10);
    const currency = req.body.currency === 'diamonds' ? 'diamonds' : 'coins';
    const tab = GIFT_TAB_IDS.includes(req.body.tab) ? req.body.tab : 'popular';
    const icon = String(req.body.icon || '').trim().slice(0, 8) || '🎁';
    const luxury = String(req.body.luxury) === '1' || req.body.luxury === 'true' ? 1 : 0;
    if (!name) { drop(); return res.status(400).json({ error: 'يرجى كتابة اسم الهدية' }); }
    if (!Number.isFinite(cost) || cost < 0) { drop(); return res.status(400).json({ error: 'يرجى إدخال سعر صحيح' }); }
    if (!req.file && !String(req.body.icon || '').trim()) { drop(); return res.status(400).json({ error: 'ارفع صورة للهدية أو اكتب إيموجي' }); }

    const maxRow = await get('SELECT COALESCE(MAX(sort_order), 0) AS m FROM gifts_catalog');
    const id = `cg-${uuidv4().slice(0, 8)}`;
    await run(`INSERT INTO gifts_catalog (id, name, name_en, icon, image_url, cost, currency, charm, luxury, tab, sort_order, is_active,
                                          burst_enabled, burst_count, burst_image_url, banner_enabled)
               VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [id, name, icon, req.file ? `/uploads/${req.file.filename}` : '', cost, currency, cost, luxury, tab, (maxRow ? maxRow.m : 0) + 1,
       adminFlag(req.body.burst_enabled), adminBurstCount(req.body.burst_count, 20),
       '', adminFlag(req.body.banner_enabled)]);
    io.emit('gifts_catalog_updated', { at: Date.now() });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/gifts/:id', adminGiftImageUpload, async (req, res) => {
  try {
    const g = await get('SELECT * FROM gifts_catalog WHERE id = ?', [req.params.id]);
    const drop = () => {
      if (req.file) safeDeleteGiftImage(`/uploads/${req.file.filename}`);
    };
    if (!g) { drop(); return res.status(404).json({ error: 'الهدية غير موجودة' }); }

    const name = req.body.name !== undefined ? String(req.body.name).trim() : g.name;
    const cost = req.body.cost !== undefined ? parseInt(req.body.cost, 10) : g.cost;
    const currency = req.body.currency !== undefined ? (req.body.currency === 'diamonds' ? 'diamonds' : 'coins') : g.currency;
    const tab = req.body.tab !== undefined ? (GIFT_TAB_IDS.includes(req.body.tab) ? req.body.tab : g.tab) : g.tab;
    const icon = req.body.icon !== undefined ? (String(req.body.icon).trim().slice(0, 8) || '🎁') : g.icon;
    const luxury = req.body.luxury !== undefined ? (String(req.body.luxury) === '1' || req.body.luxury === 'true' ? 1 : 0) : g.luxury;
    const isActive = req.body.is_active !== undefined ? (String(req.body.is_active) === '1' || req.body.is_active === 'true' ? 1 : 0) : g.is_active;
    if (!name || !Number.isFinite(cost) || cost < 0) { drop(); return res.status(400).json({ error: 'يرجى التأكد من الاسم والسعر' }); }

    let imageUrl = g.image_url || '';
    if (req.file) {
      // نبقي الصورة القديمة إن كانت مستخدمة في خزائن هدايا المستخدمين
      const used = imageUrl ? await get('SELECT COUNT(*) AS n FROM gifts_history WHERE gift_icon = ?', [imageUrl]) : null;
      if (!used || !used.n) safeDeleteGiftImage(imageUrl);
      imageUrl = `/uploads/${req.file.filename}`;
    }
    const burstEnabled = req.body.burst_enabled !== undefined ? adminFlag(req.body.burst_enabled) : (g.burst_enabled ? 1 : 0);
    const burstCount = req.body.burst_count !== undefined ? adminBurstCount(req.body.burst_count, g.burst_count || 20) : (g.burst_count || 20);
    const bannerEnabled = req.body.banner_enabled !== undefined ? adminFlag(req.body.banner_enabled) : (g.banner_enabled ? 1 : 0);
    const burstImageUrl = '';
    await run(`UPDATE gifts_catalog SET name = ?, icon = ?, image_url = ?, cost = ?, currency = ?, charm = ?, luxury = ?, tab = ?, is_active = ?,
                      burst_enabled = ?, burst_count = ?, burst_image_url = ?, banner_enabled = ? WHERE id = ?`,
      [name, icon, imageUrl, cost, currency, cost, luxury, tab, isActive, burstEnabled, burstCount, burstImageUrl, bannerEnabled, g.id]);
    io.emit('gifts_catalog_updated', { at: Date.now() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/gifts/:id', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const g = await get('SELECT * FROM gifts_catalog WHERE id = ?', [req.params.id]);
    if (!g) return res.status(404).json({ error: 'الهدية غير موجودة' });
    await run('DELETE FROM gifts_catalog WHERE id = ?', [g.id]);
    if (g.image_url) {
      const used = await get('SELECT COUNT(*) AS n FROM gifts_history WHERE gift_icon = ?', [g.image_url]);
      if (!used || !used.n) safeDeleteGiftImage(g.image_url);
    }
    io.emit('gifts_catalog_updated', { at: Date.now() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== إيموجي الغرفة (تُرفع من الإدارة) =====================
function safeDeleteEmojiImage(imageUrl) {
  try {
    if (!imageUrl || !imageUrl.startsWith('/uploads/emoji-')) return;
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    const full = path.join(__dirname, 'public', imageUrl);
    if (path.dirname(full) === uploadsDir && fs.existsSync(full)) fs.unlinkSync(full);
  } catch (e) { console.error('delete emoji image error:', e.message); }
}

const emojiImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => cb(null, `emoji-${Date.now()}-${uuidv4().slice(0, 8)}${ENTRY_IMAGE_EXT[file.mimetype] || '.png'}`)
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ENTRY_IMAGE_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('يُسمح فقط بصور PNG أو JPG أو GIF أو WEBP'));
  }
});

async function adminEmojiImageUpload(req, res, next) {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  emojiImageUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'حجم الصورة أكبر من 3MB' : err.message });
    next();
  });
}

// رفع عدّة صور دفعة واحدة (الحقل: images) — مع دعم الحقل القديم image
async function adminEmojiImagesUpload(req, res, next) {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  emojiImageUpload.fields([{ name: 'images', maxCount: 100 }, { name: 'image', maxCount: 1 }])(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'حجم إحدى الصور أكبر من 3MB' : (err.code === 'LIMIT_UNEXPECTED_FILE' ? 'الحد الأقصى 100 صورة في الدفعة' : err.message) });
    next();
  });
}

// القائمة التي تظهر للمستخدمين داخل الغرفة
app.get('/api/room-emojis', async (req, res) => {
  try {
    const rows = await all('SELECT id, name, image_url FROM room_emojis WHERE is_active = 1 ORDER BY sort_order ASC, rowid ASC');
    res.json({ emojis: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/room-emojis', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const rows = await all('SELECT * FROM room_emojis ORDER BY sort_order ASC, rowid ASC');
    res.json({ emojis: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/room-emojis', adminEmojiImagesUpload, async (req, res) => {
  try {
    const files = [].concat((req.files && req.files.images) || [], (req.files && req.files.image) || []);
    if (!files.length) return res.status(400).json({ error: 'يرجى اختيار صورة الإيموجي' });
    const maxRow = await get('SELECT COALESCE(MAX(sort_order), 0) AS m FROM room_emojis');
    let order = maxRow ? maxRow.m : 0;
    const ids = [];
    for (const f of files) {
      const id = `em-${uuidv4().slice(0, 8)}`;
      order += 1;
      await run('INSERT INTO room_emojis (id, name, image_url, sort_order, is_active) VALUES (?, ?, ?, ?, 1)',
        [id, '', `/uploads/${f.filename}`, order]);
      ids.push(id);
    }
    res.json({ success: true, id: ids[0], ids, count: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/room-emojis/:id', adminEmojiImageUpload, async (req, res) => {
  try {
    const em = await get('SELECT * FROM room_emojis WHERE id = ?', [req.params.id]);
    const drop = () => { if (req.file) safeDeleteEmojiImage(`/uploads/${req.file.filename}`); };
    if (!em) { drop(); return res.status(404).json({ error: 'الإيموجي غير موجود' }); }
    const isActive = req.body.is_active !== undefined ? (String(req.body.is_active) === '1' || req.body.is_active === 'true' ? 1 : 0) : em.is_active;
    let imageUrl = em.image_url;
    if (req.file) {
      // الرسائل القديمة في الدردشة قد تشير للصورة القديمة، لذلك لا نحذفها إن كانت مستخدمة
      const used = await get(`SELECT COUNT(*) AS n FROM messages WHERE message_type = 'emoji' AND content = ?`, [imageUrl]);
      if (!used || !used.n) safeDeleteEmojiImage(imageUrl);
      imageUrl = `/uploads/${req.file.filename}`;
    }
    await run('UPDATE room_emojis SET image_url = ?, is_active = ? WHERE id = ?', [imageUrl, isActive, em.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/room-emojis/:id', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const em = await get('SELECT * FROM room_emojis WHERE id = ?', [req.params.id]);
    if (!em) return res.status(404).json({ error: 'الإيموجي غير موجود' });
    await run('DELETE FROM room_emojis WHERE id = ?', [em.id]);
    const used = await get(`SELECT COUNT(*) AS n FROM messages WHERE message_type = 'emoji' AND content = ?`, [em.image_url]);
    if (!used || !used.n) safeDeleteEmojiImage(em.image_url);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3b. Upload and Update User Avatar
app.post('/api/users/avatar', upload.single('avatar'), async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.body.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized: User ID required' });

    let avatarUrl = null;
    if (req.file) {
      avatarUrl = `/uploads/${req.file.filename}`;
    } else if (req.body.avatar_url) {
      avatarUrl = req.body.avatar_url;
    } else {
      return res.status(400).json({ error: 'لم يتم تحديد أي صورة شخصية' });
    }

    await run('UPDATE users SET avatar = ? WHERE id = ?', [avatarUrl, userId]);
    const updatedUser = await get('SELECT * FROM users WHERE id = ?', [userId]);

    // Broadcast avatar update to all online clients and room occupants
    io.emit('user_avatar_changed', { userId, avatar: avatarUrl });

    res.json({
      success: true,
      avatar: avatarUrl,
      user: updatedUser,
      message: 'تم تحديث صورتك الشخصية بنجاح! 📸✨'
    });
  } catch (err) {
    console.error('Avatar update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Daily Check-in (+500 coins)
app.post('/api/users/checkin', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // المكافأة كل 24 ساعة من وقت الاستلام (وليس بتغيّر اليوم)
    const wallet = await getWalletSettings();
    if (!wallet.daily_bonus_enabled) {
      return res.json({ success: false, message: 'المكافأة اليومية متوقفة حالياً من الإدارة' });
    }
    const DAY_MS = 24 * 60 * 60 * 1000;
    const lastClaim = user.last_checkin ? Date.parse(user.last_checkin) : NaN;
    if (Number.isFinite(lastClaim) && Date.now() - lastClaim < DAY_MS) {
      const hoursLeft = Math.ceil((DAY_MS - (Date.now() - lastClaim)) / (60 * 60 * 1000));
      return res.json({ success: false, message: `لقد استلمت مكافأتك بالفعل! عُد بعد ${hoursLeft} ساعة للحصول على مكافأة جديدة 🎁` });
    }
    const today = new Date().toISOString(); // وقت الاستلام الدقيق

    // دورة حضور من 7 أيام: تبدأ من أول استلام، وتُعاد بعد انتهائها
    const CYCLE_MS = 7 * DAY_MS;
    const cycleStartMs = user.checkin_cycle_start ? Date.parse(user.checkin_cycle_start) : NaN;
    let streak = parseInt(user.checkin_streak, 10) || 0;
    let cycleStart = user.checkin_cycle_start;
    if (!Number.isFinite(cycleStartMs) || Date.now() >= cycleStartMs + CYCLE_MS || streak >= 7) {
      streak = 0;
      cycleStart = today;
    }
    streak += 1;

    // اليوم السابع بمكافأة مضاعفة + مكافآت تراكمية (الألماس) عند اليوم 5 و7
    const CUMULATIVE = { 5: 10, 7: 20 };
    const mult = streak === 7 ? 2 : 1;
    const bonusCoins = wallet.daily_bonus_coins * mult;
    const bonusDiamonds = wallet.daily_bonus_diamonds * mult + (CUMULATIVE[streak] || 0);

    await run(`
      UPDATE users SET
        coins = coins + ?,
        diamonds = diamonds + ?,
        last_checkin = ?,
        checkin_streak = ?,
        checkin_cycle_start = ?
      WHERE id = ?
    `, [bonusCoins, bonusDiamonds, today, streak, cycleStart, userId]);

    const updatedUser = await get('SELECT * FROM users WHERE id = ?', [userId]);
    res.json({
      success: true,
      message: `مبروك! حصلت على ${bonusCoins} عملة سول و ${bonusDiamonds} ألماسة! 💎🪙`,
      user: updatedUser
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Soul Test Submission
app.post('/api/users/soul-test', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { answers } = req.body; // array of answers
    const planetTypes = [
      { name: 'كوكب الرومانسي الحالم 🌌', score: 96, tags: 'شعر,موسيقى,هدوء,عاطفة' },
      { name: 'كوكب المغامر الشغوف 🚀', score: 92, tags: 'سفر,استكشاف,طاقة,حماس' },
      { name: 'كوكب الفيلسوف الحكيم 🔮', score: 94, tags: 'تأمل,قراءة,فلك,عمق' },
      { name: 'كوكب الفنان الملهم 🎨', score: 89, tags: 'رسم,إبداع,جمال,تصميم' },
      { name: 'كوكب المحارب الرقمي ⚡', score: 91, tags: 'ألعاب,تحدي,ستريم,سرعة' }
    ];

    const chosen = planetTypes[Math.floor(Math.random() * planetTypes.length)];

    await run(`
      UPDATE users SET
        soul_planet = ?,
        soul_score = ?,
        soul_tags = ?
      WHERE id = ?
    `, [chosen.name, chosen.score, chosen.tags, userId]);

    const updatedUser = await get('SELECT * FROM users WHERE id = ?', [userId]);
    res.json({
      success: true,
      planet: chosen.name,
      score: chosen.score,
      tags: chosen.tags,
      user: updatedUser
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// حالة التوافق الصوتي (المحاولات المتبقية من 3 كل 24 ساعة)
app.get('/api/voice-match/status', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const used = await getVoiceMatchUsageCount(userId);
    const row = await get(`SELECT MAX(created_at) AS last_used FROM voice_match_usage WHERE user_id = ?`, [userId]);
    res.json({
      limit: VOICE_MATCH_LIMIT,
      used,
      remaining: Math.max(0, VOICE_MATCH_LIMIT - used),
      last_used: row ? row.last_used : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Recharge / Top-up simulated
app.post(['/api/users/recharge', '/api/wallet/recharge'], async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const wallet = await getWalletSettings();
    if (!wallet.user_recharge_enabled) {
      return res.status(403).json({ success: false, message: 'الشحن يتم عن طريق الإدارة فقط' });
    }

    const { amountCoins, amountDiamonds, coins, diamonds } = req.body;
    const addCoins = Number(amountCoins ?? coins ?? 0);
    const addDiamonds = Number(amountDiamonds ?? diamonds ?? 0);
    await run(`
      UPDATE users SET
        coins = coins + ?,
        diamonds = diamonds + ?
      WHERE id = ?
    `, [addCoins, addDiamonds, userId]);

    const updated = await get('SELECT * FROM users WHERE id = ?', [userId]);
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// بوابة دفع PayPal الحقيقية (Orders v2) — الدفع بالبطاقة (Visa/Master/Amex) بدون حساب PayPal للمشتري
// - مفاتيح PayPal تضعها الإدارة من لوحة التحكم (تبويب المحفظة) وتُحفظ في app_settings
// - الأسعار والكميات تُحدَّد في الخادم فقط (لا يُصدَّق أي سعر قادم من المتصفح)
// - الرصيد يُشحن بعد أن يؤكد الخادم نفسه مع PayPal أن العملية COMPLETED وأن المبلغ والعملة مطابقان، ومرة واحدة فقط لكل طلب
// ==========================================
const DEFAULT_CRYSTAL_PACKS = [
  { id: 'p1', crystals: 504,   base: 84,   bonus: 420,   price: '0.99' },
  { id: 'p2', crystals: 2561,  base: 461,  bonus: 2100,  price: '4.99' },
  { id: 'p3', crystals: 5162,  base: 962,  bonus: 4200,  price: '9.99' },
  { id: 'p4', crystals: 15526, base: 2926, bonus: 12600, price: '29.99' },
  { id: 'p5', crystals: 25910, base: 4310, bonus: 21600, price: '49.99' }
];
// الباقات تُدار من لوحة الإدارة (تُحفظ في app_settings) وتتحدث عند المستخدمين مباشرة
async function getCrystalPacks() {
  try {
    const row = await get(`SELECT value FROM app_settings WHERE key = 'crystal_packs'`);
    if (row && row.value) {
      const arr = JSON.parse(row.value);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch (e) {}
  return DEFAULT_CRYSTAL_PACKS;
}
function cleanPacks(input) {
  const arr = Array.isArray(input) ? input.slice(0, 12) : [];
  const out = [];
  for (const p of arr) {
    const base = Math.floor(Number(p.base)), bonus = Math.floor(Number(p.bonus || 0));
    const price = Number(p.price);
    if (!(base > 0) || !(bonus >= 0) || !(price > 0) || price > 100000) continue;
    out.push({ id: 'p' + (out.length + 1), crystals: base + bonus, base, bonus, price: price.toFixed(2) });
  }
  return out;
}
app.get('/api/wallet/packs', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, packs: await getCrystalPacks() });
});
app.get('/api/admin/crystal-packs', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  res.json({ success: true, packs: await getCrystalPacks() });
});
app.post('/api/admin/crystal-packs', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const packs = cleanPacks((req.body || {}).packs);
    if (!packs.length) return res.status(400).json({ success: false, message: 'أضف باقة واحدة صحيحة على الأقل' });
    await run(`INSERT INTO app_settings (key, value) VALUES ('crystal_packs', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [JSON.stringify(packs)]);
    io.emit('wallet_packs_updated', { at: Date.now() });
    res.json({ success: true, packs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
const PAYPAL_KEYS = ['paypal_enabled', 'paypal_mode', 'paypal_client_id', 'paypal_client_secret', 'paypal_currency'];

async function getPaypalSettings() {
  const rows = await all(`SELECT key, value FROM app_settings WHERE key IN (${PAYPAL_KEYS.map(() => '?').join(',')})`, PAYPAL_KEYS);
  const m = {};
  rows.forEach(r => { m[r.key] = r.value; });
  return {
    enabled: m.paypal_enabled !== '0', // مفعّلة افتراضياً بمجرد حفظ المفاتيح، وتتعطل فقط إذا أُلغي التفعيل صراحةً
    mode: m.paypal_mode === 'live' ? 'live' : 'sandbox',
    clientId: String(m.paypal_client_id || '').trim(),
    clientSecret: String(m.paypal_client_secret || '').trim(),
    currency: /^[A-Z]{3}$/.test(m.paypal_currency || '') ? m.paypal_currency : 'USD'
  };
}
function paypalReady(cfg) { return !!(cfg.enabled && cfg.clientId && cfg.clientSecret); }
function paypalBase(cfg) { return cfg.mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'; }

let paypalTokenCache = { key: '', token: '', exp: 0 };
async function paypalAccessToken(cfg) {
  const key = `${cfg.mode}:${cfg.clientId}:${cfg.clientSecret.slice(-6)}`;
  if (paypalTokenCache.key === key && paypalTokenCache.exp > Date.now() + 30000) return paypalTokenCache.token;
  const r = await fetch(`${paypalBase(cfg)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(20000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const e = new Error(j.error_description || 'فشل التوثيق مع PayPal، تحقق من Client ID و Secret ومن وضع (Sandbox/Live)');
    e.paypal = j; throw e;
  }
  paypalTokenCache = { key, token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 300) * 1000 };
  return j.access_token;
}
async function paypalApi(cfg, path, method, body, requestId) {
  const token = await paypalAccessToken(cfg);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (requestId) headers['PayPal-Request-Id'] = requestId;
  const r = await fetch(`${paypalBase(cfg)}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000)
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: j };
}

// إعدادات عامة يحتاجها المتصفح لعرض أزرار الدفع (لا تتضمن السر أبداً)
// بيانات الفوترة الحقيقية للمستخدم (الرمز البريدي والهاتف) لتعبئتها مسبقاً في نموذج الدفع
app.get('/api/paypal/billing', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ success: false });
  const u = await get('SELECT billing_postal, billing_phone FROM users WHERE id = ?', [userId]);
  if (!u) return res.status(404).json({ success: false });
  res.json({ success: true, postal: u.billing_postal || '', phone: u.billing_phone || '' });
});
app.post('/api/paypal/billing', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ success: false });
  const postal = String((req.body || {}).postal || '').trim().replace(/[^\w\s-]/g, '').slice(0, 20);
  const phone = String((req.body || {}).phone || '').replace(/\D/g, '').slice(0, 14);
  await run('UPDATE users SET billing_postal = ?, billing_phone = ? WHERE id = ?', [postal, phone, userId]);
  res.json({ success: true });
});

app.get('/api/paypal/config', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const cfg = await getPaypalSettings();
    res.json({
      success: true,
      enabled: paypalReady(cfg),
      reason: paypalReady(cfg) ? null : (!cfg.enabled ? 'disabled' : 'missing_keys'),
      clientId: paypalReady(cfg) ? cfg.clientId : '',
      mode: cfg.mode,
      currency: cfg.currency,
      packs: await getCrystalPacks()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// إنشاء طلب دفع (السعر من الخادم حسب الباقة)
app.post('/api/paypal/create-order', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const user = await get('SELECT id, name, email, country_code, billing_postal, billing_phone FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    const cfg = await getPaypalSettings();
    if (!paypalReady(cfg)) return res.status(503).json({ success: false, message: 'بوابة الدفع غير مفعلة حالياً' });
    const pack = (await getCrystalPacks()).find(p => p.id === String((req.body || {}).packId));
    if (!pack) return res.status(400).json({ success: false, message: 'باقة غير صالحة' });

    // flow=card_fields: نموذج البطاقة المدمج → نطلب 3D Secure عند الحاجة فقط (SCA_WHEN_REQUIRED)
    const isCardFields = String((req.body || {}).flow) === 'card_fields';
    const orderBody = {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: pack.id,
        custom_id: String(userId).slice(0, 120),
        description: `SoulChill ${pack.crystals} crystals`,
        amount: { currency_code: cfg.currency, value: pack.price }
      }]
    };
    if (isCardFields) {
      orderBody.payment_source = { card: { attributes: { verification: { method: 'SCA_WHEN_REQUIRED' } } } };
    } else {
      orderBody.application_context = { brand_name: 'SoulChill', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' };
      // تعبئة مسبقة لنموذج PayPal: الاسم والبريد من حساب المستخدم، والدولة من موقعه (ترويسة CDN ثم لغة المتصفح)
      const hdrCountry = String(req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || req.headers['x-appengine-country'] || req.headers['cloudfront-viewer-country'] || '').toUpperCase();
      const hintCountry = String((req.body || {}).country || '').toUpperCase();
      const country = [String(user.country_code || '').toUpperCase(), hdrCountry, hintCountry].find(c => /^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'T1');
      const parts = String(user.name || '').replace(/[^\p{L}\s'.-]/gu, ' ').trim().split(/\s+/).filter(Boolean);
      const payer = {};
      if (parts.length) payer.name = { given_name: parts[0].slice(0, 100), surname: (parts.slice(1).join(' ') || parts[0]).slice(0, 100) };
      if (user.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) payer.email_address = user.email;
      if (country) {
        payer.address = { country_code: country };
        if (user.billing_postal) payer.address.postal_code = String(user.billing_postal).slice(0, 20);
      }
      const phoneDigits = String(user.billing_phone || '').replace(/\D/g, '');
      if (phoneDigits.length >= 6 && phoneDigits.length <= 14) payer.phone = { phone_number: { national_number: phoneDigits } };
      if (Object.keys(payer).length) orderBody.payer = payer;
    }
    let r = await paypalApi(cfg, '/v2/checkout/orders', 'POST', orderBody, `soulchill-${uuidv4()}`);
    // إن رفضت PayPal بيانات التعبئة المسبقة نعيد المحاولة بدونها حتى لا يتعطل الدفع
    if ((!r.ok || !r.data.id) && orderBody.payer && !JSON.stringify(r.data).includes('PAYEE_ACCOUNT_RESTRICTED')) {
      delete orderBody.payer;
      r = await paypalApi(cfg, '/v2/checkout/orders', 'POST', orderBody, `soulchill-${uuidv4()}`);
    }
    if (!r.ok || !r.data.id) {
      console.error('PayPal create-order failed:', JSON.stringify(r.data));
      // حساب التاجر مقيَّد لدى PayPal: رسالة مفهومة للمستخدم، والتفاصيل في سجل الخادم
      if (JSON.stringify(r.data).includes('PAYEE_ACCOUNT_RESTRICTED')) {
        return res.status(503).json({ success: false, code: 'MERCHANT_RESTRICTED', message: 'الدفع بالبطاقة غير متاح مؤقتاً. يمكنك المحاولة لاحقاً أو الشحن عبر الدردشة.' });
      }
      return res.status(502).json({ success: false, message: 'تعذر إنشاء طلب الدفع، حاول مرة أخرى.' });
    }
    await run(`INSERT INTO paypal_orders (order_id, user_id, pack_id, amount, currency, crystals, status) VALUES (?, ?, ?, ?, ?, ?, 'CREATED')`,
      [r.data.id, userId, pack.id, pack.price, cfg.currency, pack.crystals]);
    res.json({ success: true, orderId: r.data.id });
  } catch (err) {
    console.error('paypal create-order error:', err);
    res.status(500).json({ success: false, message: 'خطأ في بوابة الدفع' });
  }
});

// تأكيد الدفع وشحن الكريستال (مرة واحدة فقط لكل طلب)
app.post('/api/paypal/capture-order', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const orderId = String((req.body || {}).orderId || '');
    const row = orderId ? await get('SELECT * FROM paypal_orders WHERE order_id = ? AND user_id = ?', [orderId, userId]) : null;
    if (!row) return res.status(404).json({ success: false, message: 'طلب الدفع غير موجود' });

    const respondUser = async (extra = {}) => {
      const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
      res.json({ success: true, user, crystals: row.crystals, ...extra });
    };
    if (row.status === 'COMPLETED') return respondUser({ already: true });

    const cfg = await getPaypalSettings();
    if (!paypalReady(cfg)) return res.status(503).json({ success: false, message: 'بوابة الدفع غير مفعلة حالياً' });

    let r = await paypalApi(cfg, `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, 'POST', null, `soulchill-cap-${orderId}`);
    const alreadyCaptured = !r.ok && JSON.stringify(r.data).includes('ORDER_ALREADY_CAPTURED');
    if (alreadyCaptured) r = await paypalApi(cfg, `/v2/checkout/orders/${encodeURIComponent(orderId)}`, 'GET');
    if (!r.ok) {
      console.error('PayPal capture failed:', JSON.stringify(r.data));
      const declined = JSON.stringify(r.data).includes('INSTRUMENT_DECLINED');
      return res.status(402).json({ success: false, declined, message: declined ? 'تم رفض البطاقة، جرّب بطاقة أخرى' : 'تعذر إتمام الدفع' });
    }

    const pu = (r.data.purchase_units || [])[0] || {};
    const cap = ((pu.payments || {}).captures || [])[0] || {};
    const payerEmail = (r.data.payer && r.data.payer.email_address) || null;
    if (cap.status !== 'COMPLETED') {
      await run(`UPDATE paypal_orders SET status = ? WHERE order_id = ? AND status != 'COMPLETED'`, [String(cap.status || r.data.status || 'PENDING'), orderId]);
      return res.status(202).json({ success: false, pending: true, message: 'عملية الدفع قيد المراجعة لدى PayPal، سيُضاف الرصيد عند اكتمالها' });
    }
    // مطابقة المبلغ والعملة والمستخدم مع ما سجّله الخادم عند إنشاء الطلب
    const amt = cap.amount || {};
    // مع الدفع بنموذج البطاقة يضع PayPal custom_id داخل captures[0] وليس purchase_units[0]؛ والطلب مرتبط أصلاً بالمستخدم في قاعدة بياناتنا
    const capCustom = String(pu.custom_id || cap.custom_id || '');
    if (String(amt.value) !== String(row.amount) || amt.currency_code !== row.currency || (capCustom && capCustom !== String(userId))) {
      console.error('PayPal capture mismatch', { orderId, amt, expected: row.amount, custom: pu.custom_id });
      await run(`UPDATE paypal_orders SET status = 'MISMATCH' WHERE order_id = ?`, [orderId]);
      return res.status(409).json({ success: false, message: 'عدم تطابق في بيانات الدفع، تواصل مع الإدارة' });
    }

    // الشحن مرة واحدة: يفوز أول طلب يغيّر الحالة إلى COMPLETED
    const upd = await run(`UPDATE paypal_orders SET status = 'COMPLETED', capture_id = ?, payer_email = ?, completed_at = CURRENT_TIMESTAMP WHERE order_id = ? AND status != 'COMPLETED'`,
      [cap.id || null, payerEmail, orderId]);
    if (upd.changes === 1) {
      await run('UPDATE users SET diamonds = diamonds + ? WHERE id = ?', [row.crystals, userId]);
    }
    return respondUser({ already: upd.changes !== 1 });
  } catch (err) {
    console.error('paypal capture-order error:', err);
    res.status(500).json({ success: false, message: 'خطأ في بوابة الدفع' });
  }
});

// ===== إعدادات PayPal من لوحة الإدارة =====
app.get('/api/admin/settings/paypal', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const cfg = await getPaypalSettings();
    res.json({ success: true, settings: {
      enabled: cfg.enabled, mode: cfg.mode, client_id: cfg.clientId, currency: cfg.currency,
      client_secret_set: !!cfg.clientSecret, // السر لا يُرسل للمتصفح أبداً
      ready: paypalReady(cfg)
    }});
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/admin/settings/paypal', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const b = req.body || {};
    const entries = {
      paypal_enabled: b.enabled ? '1' : '0',
      paypal_mode: b.mode === 'live' ? 'live' : 'sandbox',
      paypal_client_id: String(b.client_id || '').trim().slice(0, 200),
      paypal_currency: /^[A-Z]{3}$/.test(String(b.currency || '').toUpperCase()) ? String(b.currency).toUpperCase() : 'USD'
    };
    const secret = String(b.client_secret || '').trim();
    if (secret) entries.paypal_client_secret = secret.slice(0, 300); // فارغ = إبقاء السر الحالي
    for (const [k, v] of Object.entries(entries)) {
      await run(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, v]);
    }
    paypalTokenCache = { key: '', token: '', exp: 0 };
    const cfg = await getPaypalSettings();
    if (cfg.enabled && !(cfg.clientId && cfg.clientSecret)) {
      return res.json({ success: true, warning: 'تم الحفظ لكن البوابة لن تعمل قبل إدخال Client ID و Secret' });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// اختبار الاتصال بـ PayPal بالمفاتيح المحفوظة
app.post('/api/admin/paypal/test', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const cfg = await getPaypalSettings();
    if (!cfg.clientId || !cfg.clientSecret) return res.json({ success: false, message: 'أدخل Client ID و Secret أولاً' });
    paypalTokenCache = { key: '', token: '', exp: 0 };
    await paypalAccessToken(cfg);
    res.json({ success: true, message: `نجح الاتصال بـ PayPal (${cfg.mode === 'live' ? 'Live' : 'Sandbox'}) ✅` + (cfg.enabled ? ' — البوابة مفعّلة' : ' — لكن البوابة معطّلة: فعّل الخيار واحفظ') });
  } catch (err) { res.json({ success: false, message: err.message }); }
});
// آخر عمليات الدفع
app.get('/api/admin/paypal/orders', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const rows = await all(`SELECT o.order_id, o.user_id, u.name AS user_name, o.crystals, o.amount, o.currency, o.status, o.payer_email, o.created_at, o.completed_at
      FROM paypal_orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 50`);
    res.json({ success: true, orders: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// تسوية طلب دُفع فعلاً لدى PayPal ولم يُشحن رصيده (مثلاً حالة MISMATCH): يتحقق من PayPal ثم يشحن مرة واحدة فقط
app.post('/api/admin/paypal/reconcile', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const orderId = String((req.body || {}).orderId || '');
    const row = orderId ? await get('SELECT * FROM paypal_orders WHERE order_id = ?', [orderId]) : null;
    if (!row) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    if (row.status === 'COMPLETED') return res.json({ success: true, already: true, message: 'الطلب مشحون مسبقاً' });
    const cfg = await getPaypalSettings();
    const r = await paypalApi(cfg, `/v2/checkout/orders/${encodeURIComponent(orderId)}`, 'GET');
    if (!r.ok) return res.status(502).json({ success: false, message: 'تعذر جلب الطلب من PayPal' });
    const pu = (r.data.purchase_units || [])[0] || {};
    const cap = ((pu.payments || {}).captures || [])[0] || {};
    const amt = cap.amount || {};
    if (cap.status !== 'COMPLETED') return res.status(409).json({ success: false, message: 'الدفع غير مكتمل لدى PayPal: ' + (cap.status || r.data.status) });
    if (String(amt.value) !== String(row.amount) || amt.currency_code !== row.currency) return res.status(409).json({ success: false, message: 'المبلغ لا يطابق الطلب' });
    const upd = await run(`UPDATE paypal_orders SET status = 'COMPLETED', capture_id = ?, completed_at = CURRENT_TIMESTAMP WHERE order_id = ? AND status != 'COMPLETED'`, [cap.id || null, orderId]);
    if (upd.changes === 1) await run('UPDATE users SET diamonds = diamonds + ? WHERE id = ?', [row.crystals, row.user_id]);
    res.json({ success: true, credited: upd.changes === 1, crystals: row.crystals, user_id: row.user_id });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// تبديل الكريستال (الألماس) إلى عملات الألعاب — 1 كريستال = 100 عملة
app.post('/api/wallet/exchange', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const d = Math.floor(Number(req.body && req.body.diamonds));
    if (!Number.isFinite(d) || d <= 0 || d > 1000000) {
      return res.status(400).json({ success: false, message: 'كمية غير صالحة' });
    }
    const u = await get('SELECT diamonds FROM users WHERE id = ?', [userId]);
    if (!u) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    if (u.diamonds < d) return res.status(400).json({ success: false, message: 'رصيد الكريستال غير كافٍ' });
    await run('UPDATE users SET diamonds = diamonds - ?, coins = coins + ? WHERE id = ? AND diamonds >= ?', [d, d * 100, userId, d]);
    const updated = await get('SELECT * FROM users WHERE id = ?', [userId]);
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== وكلاء الشحن (تعيّنهم الإدارة) =====
const AGENT_METHODS = ['visa','mastercard','amex','stcpay','zaincash','orange','vodafone','cliq','westernunion','usdt','bank','cash'];
function parseAgentRow(a) {
  let methods = [];
  try { methods = JSON.parse(a.methods || '[]'); } catch (e) {}
  return {
    id: a.id, user_id: a.user_id, display_name: a.display_name || '',
    methods: methods.filter(m => AGENT_METHODS.includes(m)),
    countries: String(a.countries || '').split(',').map(c => c.trim().toUpperCase()).filter(Boolean),
    sort_order: a.sort_order || 0, is_active: a.is_active ? 1 : 0
  };
}
function cleanAgentBody(b) {
  b = b || {};
  const methods = (Array.isArray(b.methods) ? b.methods : []).filter(m => AGENT_METHODS.includes(m));
  const countries = (Array.isArray(b.countries) ? b.countries : String(b.countries || '').split(','))
    .map(c => String(c).trim().toUpperCase()).filter(c => /^[A-Z]{2}$/.test(c));
  return {
    display_name: String(b.display_name || '').trim().slice(0, 40),
    methods: JSON.stringify(methods),
    countries: Array.from(new Set(countries)).join(','),
    sort_order: Math.max(0, Math.min(9999, Math.floor(Number(b.sort_order)) || 0)),
    is_active: b.is_active === 0 || b.is_active === false ? 0 : 1
  };
}

// للمستخدمين: الوكلاء المتاحون لمنطقتهم (المتصلون أولاً)
app.get('/api/wallet/charge-agents', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const cc = String(req.query.country || '').toUpperCase();
    const rows = await all(
      `SELECT a.*, u.name, u.avatar, u.avatar_frame
       FROM charge_agents a JOIN users u ON u.id = a.user_id
       WHERE a.is_active = 1 AND COALESCE(u.is_banned, 0) = 0
       ORDER BY a.sort_order ASC, a.created_at ASC`
    );
    const agents = rows.map(r => {
      const p = parseAgentRow(r);
      return {
        id: r.user_id, name: p.display_name || r.name, avatar: r.avatar || '', avatar_frame: r.avatar_frame || '',
        methods: p.methods, countries: p.countries, sort_order: p.sort_order,
        online: !!(userSockets.get(r.user_id) && userSockets.get(r.user_id).size)
      };
    }).filter(a => !cc || !a.countries.length || a.countries.includes(cc));
    agents.sort((x, y) => (y.online - x.online) || (x.sort_order - y.sort_order));
    res.json({ success: true, agents });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/charge-agents', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const rows = await all(
      `SELECT a.*, u.name, u.email, u.avatar, u.coins, u.diamonds
       FROM charge_agents a JOIN users u ON u.id = a.user_id
       ORDER BY a.sort_order ASC, a.created_at ASC`
    );
    res.json({ success: true, methods: AGENT_METHODS, agents: rows.map(r => ({
      ...parseAgentRow(r), name: r.name, email: r.email, avatar: r.avatar, coins: r.coins, diamonds: r.diamonds,
      online: !!(userSockets.get(r.user_id) && userSockets.get(r.user_id).size)
    })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/charge-agents', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const userId = String((req.body || {}).user_id || '');
    const user = await get('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    const dup = await get('SELECT id FROM charge_agents WHERE user_id = ?', [userId]);
    if (dup) return res.status(409).json({ success: false, message: 'هذا المستخدم معيّن كوكيل شحن مسبقاً' });
    const c = cleanAgentBody(req.body);
    const id = 'agent-' + uuidv4().slice(0, 8);
    await run(
      `INSERT INTO charge_agents (id, user_id, display_name, methods, countries, sort_order, is_active) VALUES (?,?,?,?,?,?,?)`,
      [id, userId, c.display_name, c.methods, c.countries, c.sort_order, c.is_active]
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/charge-agents/:id', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const c = cleanAgentBody(req.body);
    const r = await run(
      `UPDATE charge_agents SET display_name = ?, methods = ?, countries = ?, sort_order = ?, is_active = ? WHERE id = ?`,
      [c.display_name, c.methods, c.countries, c.sort_order, c.is_active, req.params.id]
    );
    io.emit('charge_agents_updated', { at: Date.now() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/charge-agents/:id', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    await run('DELETE FROM charge_agents WHERE id = ?', [req.params.id]);
    io.emit('charge_agents_updated', { at: Date.now() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== الشحن عن طريق الدردشة =====
const CHAT_RECHARGE_ROLES = ['owner', 'super_master', 'super_admin'];

// حساب وكيل الشحن (أول مالك/مدير أعلى) ليتواصل معه المستخدم في الدردشة
app.get('/api/wallet/agent', async (req, res) => {
  try {
    const row = await get(
      `SELECT id, name, avatar, avatar_frame, role FROM users
       WHERE role IN ('owner','super_master','super_admin')
       ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'super_master' THEN 1 ELSE 2 END
       LIMIT 1`
    );
    if (!row) return res.status(404).json({ success: false, message: 'لا يوجد وكيل شحن متاح حالياً' });
    res.json({ success: true, agent: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// شحن رصيد مستخدم من داخل نافذة الدردشة (للإدارة فقط) — يضيف على الرصيد الحالي
app.post('/api/wallet/chat-credit', async (req, res) => {
  try {
    const staffId = req.headers['x-user-id'];
    if (!staffId) return res.status(401).json({ error: 'Unauthorized' });
    const staff = await get('SELECT id, name, role FROM users WHERE id = ?', [staffId]);
    if (!staff || !CHAT_RECHARGE_ROLES.includes(staff.role)) {
      return res.status(403).json({ success: false, message: 'الشحن من الدردشة متاح للإدارة فقط' });
    }

    const { target_id } = req.body;
    const coins = Math.floor(Number(req.body.coins || 0));
    const diamonds = Math.floor(Number(req.body.diamonds || 0));
    if (!target_id || target_id === staffId) {
      return res.status(400).json({ success: false, message: 'مستخدم غير صالح' });
    }
    if (!Number.isFinite(coins) || !Number.isFinite(diamonds) || coins < 0 || diamonds < 0 || (coins === 0 && diamonds === 0)) {
      return res.status(400).json({ success: false, message: 'أدخل كمية عملات أو ألماس صحيحة' });
    }
    if (coins > 1000000000 || diamonds > 1000000000) {
      return res.status(400).json({ success: false, message: 'الكمية كبيرة جداً' });
    }
    const target = await get('SELECT id, name FROM users WHERE id = ?', [target_id]);
    if (!target) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });

    await run('UPDATE users SET coins = coins + ?, diamonds = diamonds + ? WHERE id = ?', [coins, diamonds, target_id]);
    const updated = await get('SELECT id, name, coins, diamonds, level FROM users WHERE id = ?', [target_id]);

    // رسالة تأكيد داخل نفس المحادثة
    const parts = [];
    if (coins) parts.push(`${coins.toLocaleString('en-US')} 🪙 عملة`);
    if (diamonds) parts.push(`${diamonds.toLocaleString('en-US')} 💎 ألماس`);
    const msgId = `msg-${Date.now().toString()}-${uuidv4().slice(0, 4)}`;
    await run(
      `INSERT INTO messages (id, sender_id, receiver_id, message_type, content, metadata) VALUES (?, ?, ?, 'text', ?, ?)`,
      [msgId, staffId, target_id, `✅ تم شحن رصيدك: +${parts.join(' و +')}`, JSON.stringify({ kind: 'recharge', coins, diamonds })]
    );
    const createdMsg = await get(
      `SELECT m.*, u.name as sender_name, u.avatar as sender_avatar FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?`,
      [msgId]
    );

    const sockets = userSockets.get(target_id);
    if (sockets) {
      for (const sId of sockets) {
        io.to(sId).emit('private_message', createdMsg);
        io.to(sId).emit('balance_updated', { coins: updated.coins, diamonds: updated.diamonds, level: updated.level, added: { coins, diamonds } });
      }
    }

    res.json({ success: true, user: updated, message: createdMsg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// عدد كل الحسابات المسجلة فعلياً في الموقع (للعدّاد في صفحة الكوكب)
app.get('/api/stats/registered-count', async (req, res) => {
  try {
    const row = await get('SELECT COUNT(*) AS c FROM users');
    res.json({ count: row ? (row.c || 0) : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Get All Users (for Soul Planet Radar)
app.get('/api/users', async (req, res) => {
  try {
    const users = await all('SELECT id, name, avatar, bio, gender, country_code, soul_planet, soul_score, soul_tags, level, wealth_level, charm_level, avatar_frame, role FROM users LIMIT 50');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const SUPPORTED_COUNTRIES = [
  { code: 'GLOBAL', name: 'عالمي', flag: '🌍', isGlobal: true },
  { code: 'JO', name: 'الأردن', flag: '🇯🇴', defaultCity: 'إربد / عمان' },
  { code: 'SA', name: 'السعودية', flag: '🇸🇦', defaultCity: 'الرياض' },
  { code: 'EG', name: 'مصر', flag: '🇪🇬', defaultCity: 'القاهرة' },
  { code: 'AE', name: 'الإمارات', flag: '🇦🇪', defaultCity: 'دبي' },
  { code: 'IQ', name: 'العراق', flag: '🇮🇶', defaultCity: 'بغداد' },
  { code: 'KW', name: 'الكويت', flag: '🇰🇼', defaultCity: 'الكويت' },
  { code: 'MA', name: 'المغرب', flag: '🇲🇦', defaultCity: 'الدار البيضاء' },
  { code: 'DZ', name: 'الجزائر', flag: '🇩🇿', defaultCity: 'الجزائر' },
  { code: 'QA', name: 'قطر', flag: '🇶🇦', defaultCity: 'الدوحة' },
  { code: 'OM', name: 'عُمان', flag: '🇴🇲', defaultCity: 'مسقط' },
  { code: 'BH', name: 'البحرين', flag: '🇧🇭', defaultCity: 'المنامة' },
  { code: 'LB', name: 'لبنان', flag: '🇱🇧', defaultCity: 'بيروت' },
  { code: 'SY', name: 'سوريا', flag: '🇸🇾', defaultCity: 'دمشق' },
  { code: 'YE', name: 'اليمن', flag: '🇾🇪', defaultCity: 'صنعاء' },
  { code: 'TN', name: 'تونس', flag: '🇹🇳', defaultCity: 'تونس' },
  { code: 'PS', name: 'فلسطين', flag: '🇵🇸', defaultCity: 'القدس' }
];

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket.remoteAddress || req.ip || '127.0.0.1';
}

function getCountryFromIp(ip) {
  // If local or private sandbox network, map to user's real country (Jordan 🇯🇴 - JO)
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.') || ip.startsWith('169.254.')) {
    return {
      ip: ip || '127.0.0.1',
      country_code: 'JO',
      country_name: 'الأردن',
      country_flag: '🇯🇴',
      city: 'إربد',
      isLocal: true
    };
  }

  // Known sample IP blocks for Arab countries
  if (ip.startsWith('94.249.') || ip.startsWith('212.35.') || ip.startsWith('212.118.')) {
    return { ip, country_code: 'JO', country_name: 'الأردن', country_flag: '🇯🇴', city: 'عمان', isLocal: false };
  }
  if (ip.startsWith('178.80.') || ip.startsWith('82.167.') || ip.startsWith('212.11.')) {
    return { ip, country_code: 'SA', country_name: 'السعودية', country_flag: '🇸🇦', city: 'الرياض', isLocal: false };
  }
  if (ip.startsWith('197.38.') || ip.startsWith('156.192.') || ip.startsWith('41.232.')) {
    return { ip, country_code: 'EG', country_name: 'مصر', country_flag: '🇪🇬', city: 'القاهرة', isLocal: false };
  }
  if (ip.startsWith('94.200.') || ip.startsWith('194.170.')) {
    return { ip, country_code: 'AE', country_name: 'الإمارات', country_flag: '🇦🇪', city: 'دبي', isLocal: false };
  }
  if (ip.startsWith('149.255.') || ip.startsWith('37.236.')) {
    return { ip, country_code: 'IQ', country_name: 'العراق', country_flag: '🇮🇶', city: 'بغداد', isLocal: false };
  }
  if (ip.startsWith('196.12.') || ip.startsWith('105.154.')) {
    return { ip, country_code: 'MA', country_name: 'المغرب', country_flag: '🇲🇦', city: 'الدار البيضاء', isLocal: false };
  }
  if (ip.startsWith('62.215.') || ip.startsWith('83.96.')) {
    return { ip, country_code: 'KW', country_name: 'الكويت', country_flag: '🇰🇼', city: 'الكويت', isLocal: false };
  }

  // Fallback to Jordan (JO)
  return {
    ip,
    country_code: 'JO',
    country_name: 'الأردن',
    country_flag: '🇯🇴',
    city: 'إربد',
    isLocal: false
  };
}

// 7b. Get Client IP & Detected Country
app.get('/api/geo/my-country', (req, res) => {
  const ip = getClientIp(req);
  const geo = getCountryFromIp(ip);
  res.json({
    success: true,
    ...geo
  });
});

// 7c. Get Supported Countries List & Active Room Counts
app.get('/api/geo/countries', async (req, res) => {
  try {
    const counts = await all(`
      SELECT country_code, COUNT(*) as room_count
      FROM rooms
      GROUP BY country_code
    `);
    const countMap = {};
    counts.forEach(c => { countMap[c.country_code] = c.room_count; });
    const totalRooms = counts.reduce((acc, c) => acc + c.room_count, 0);

    const list = SUPPORTED_COUNTRIES.map(item => ({
      ...item,
      room_count: item.code === 'GLOBAL' ? totalRooms : (countMap[item.code] || 0)
    }));

    res.json({ success: true, countries: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Voice & Video Rooms List (with IP / Country Filtering)
app.get('/api/rooms', async (req, res) => {
  try {
    const countryFilter = req.query.country;
    let query = `
      SELECT r.*, u.name as host_name, u.avatar as host_avatar, u.avatar_frame as host_frame,
             rc.image_url as host_room_card
      FROM rooms r
      JOIN users u ON r.host_id = u.id
      LEFT JOIN room_cards rc ON rc.id = u.room_card AND rc.is_active = 1
    `;
    const params = [];

    if (countryFilter && countryFilter !== 'all' && countryFilter !== 'GLOBAL') {
      query += ` WHERE r.country_code = ? `;
      params.push(countryFilter);
    }

    query += ` ORDER BY r.created_at DESC `;

    const rooms = await all(query, params);

    // Attach active occupants count & seat previews
    for (const r of rooms) {
      const seats = await all(`
        SELECT s.seat_index, s.is_muted, s.is_locked, u.id as user_id, u.name, u.avatar
        FROM room_seats s
        LEFT JOIN users u ON s.user_id = u.id
        WHERE s.room_id = ?
        ORDER BY s.seat_index ASC
      `, [r.id]);

      r.seats = seats;
      r.active_speakers = seats.filter(s => s.user_id !== null).length;
      const roomState = activeRoomStates.get(r.id);
      r.audience_count = roomState ? roomState.activeAudience.size : 0;
      r.total_occupants = r.audience_count;
      // أول 5 من المتواجدين الآن في الغرفة (مع إطاراتهم) لعرضهم في بطاقة الغرفة
      r.audience_preview = roomState
        ? Array.from(roomState.activeAudience.values()).slice(0, 5).map(u => ({
            id: u.id, avatar: u.avatar || '', frame: u.avatar_frame || ''
          }))
        : [];
    }

    // الأكثر زواراً أولاً (sort ثابت: الأحدث أولاً عند التساوي)
    rooms.sort((a, b) => (b.audience_count || 0) - (a.audience_count || 0));

    res.json(rooms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Create New Voice Room or Live Video Broadcast (Automatic IP & Country Detection)
app.post('/api/rooms', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.body.creator_id;
    if (!userId || userId === 'null' || userId === 'undefined') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Ensure the host user exists in the database to guarantee joins and foreign keys
    let hostUser = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!hostUser) {
      console.log(`Creating missing host user ${userId} in SQLite`);
      await run(`
        INSERT OR IGNORE INTO users (id, name, email, avatar, bio, soul_planet, soul_score, soul_tags, coins, diamonds, level, wealth_level, charm_level, avatar_frame, role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 5000, 1000, 5, 3, 4, 'vip-crown', 'user')
      `, [
        userId,
        'المضيف ' + (userId.length > 4 ? userId.slice(-4) : userId),
        `${userId}@gmail.com`,
        'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=300&q=80',
        'مرحباً بكم في غرفتي على SoulChill ✨',
        'كوكب الرومانسي الحالم 🌌',
        92,
        'موسيقى,سوالف'
      ]);
      hostUser = await get('SELECT * FROM users WHERE id = ?', [userId]);
    }

    // Single Active Room Rule: A user cannot create a second room until they delete their existing room
    const existingRoom = await get('SELECT * FROM rooms WHERE host_id = ?', [userId]);
    if (existingRoom) {
      return res.status(400).json({
        success: false,
        hasActiveRoom: true,
        error: `لديك غرفة نشطة بالفعل بعنوان "${existingRoom.title}". وفقاً لنظام SoulChill، يجب حذف غرفتك السابقة قبل إنشاء غرفة جديدة.`,
        existingRoom
      });
    }

    const { title, category, room_type, theme, announcement, cover_image, country_code } = req.body;
    if (!title) return res.status(400).json({ error: 'Room title is required' });

    const clientIp = getClientIp(req);
    const geo = getCountryFromIp(clientIp);

    // Check if user specified a country or fallback to IP detected country
    let countryItem = SUPPORTED_COUNTRIES.find(c => c.code === country_code) || geo;
    const finalCountryCode = countryItem.code || geo.country_code || 'JO';
    const finalCountryName = countryItem.name || geo.country_name || 'الأردن';
    const finalCountryFlag = countryItem.flag || geo.country_flag || '🇯🇴';

    const roomId = `room-${Date.now().toString().slice(-6)}`;
    const finalRoomType = 'voice';
    const defaultCover = cover_image || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80';

    await run(`
      INSERT INTO rooms (id, title, category, room_type, cover_image, likes_count, host_id, country_code, country_name, country_flag, creator_ip, theme, announcement)
      VALUES (?, ?, ?, 'voice', ?, 0, ?, ?, ?, ?, ?, ?, ?)
    `, [roomId, title, category || 'chill', defaultCover, userId, finalCountryCode, finalCountryName, finalCountryFlag, clientIp, theme || 'cosmic_purple', announcement || 'أهلاً بكم في رومنا الصوتي 🌟']);

    // Setup 8 seats + seat 0 for host (seat 0 starts EMPTY so host is not forced directly onto mic)
    await run(`INSERT INTO room_seats (room_id, seat_index, user_id, is_muted, is_locked) VALUES (?, 0, NULL, 0, 0)`, [roomId]);
    for (let i = 1; i <= 8; i++) {
      await run(`INSERT INTO room_seats (room_id, seat_index, user_id, is_muted, is_locked) VALUES (?, ?, NULL, 0, 0)`, [roomId, i]);
    }

    let created = await get(`
      SELECT r.*, u.name as host_name, u.avatar as host_avatar, u.avatar_frame as host_frame
      FROM rooms r
      LEFT JOIN users u ON r.host_id = u.id
      WHERE r.id = ?
    `, [roomId]);

    if (!created) {
      created = await get('SELECT * FROM rooms WHERE id = ?', [roomId]);
    }

    if (created) {
      created.host_id = created.host_id || userId;
      created.host_name = created.host_name || (hostUser ? hostUser.name : 'المضيف');
      created.host_avatar = created.host_avatar || (hostUser ? hostUser.avatar : defaultCover);
      created.host_frame = created.host_frame || (hostUser ? hostUser.avatar_frame : '');
      created.audience_count = 1;
    }

    // Broadcast room creation to ALL clients in real time so the rooms grid updates immediately without page refresh
    io.emit('room_created', { room: created });

    res.json({ success: true, room: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9b. Delete Room by ID (Host or Owner) - Updates lobby instantly
app.delete('/api/rooms/:id', async (req, res) => {
  try {
    const roomId = req.params.id;
    const userId = req.headers['x-user-id'] || req.body.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const room = await get('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    const isStaff = user && ['owner', 'super_master', 'super_admin', 'admin', 'moderator'].includes(user.role);
    const isAuthorized = room.host_id === userId || isStaff;
    if (!isAuthorized) {
      return res.status(403).json({ error: 'ليس لديك صلاحية حذف هذه الغرفة' });
    }

    // Clean up room records in SQLite
    await run('DELETE FROM room_seats WHERE room_id = ?', [roomId]);
    await run('DELETE FROM messages WHERE room_id = ?', [roomId]);
    await run('DELETE FROM rooms WHERE id = ?', [roomId]);

    // Notify all participants in this room to leave
    io.to(`room:${roomId}`).emit('room_closed_by_host', {
      roomId,
      adminName: user ? user.name : 'المضيف'
    });

    // Broadcast room deletion globally to update all rooms grids instantly without reload
    io.emit('room_deleted', { roomId });

    res.json({ success: true, message: 'تم حذف الغرفة بنجاح', roomId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9b. Get Favorite Rooms ("المفضلة")
app.get(['/api/rooms/favorites', '/api/favorite-rooms'], async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.query.user_id;
    if (!userId) return res.json({ favoriteRoomIds: [] });

    const rows = await all('SELECT room_id FROM favorite_rooms WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    res.json({
      favoriteRoomIds: rows.map(r => r.room_id)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Get Specific Room Details & Seats
app.get('/api/rooms/:id', async (req, res) => {
  try {
    const roomId = req.params.id;
    const room = await get(`
      SELECT r.*, u.name as host_name, u.avatar as host_avatar, u.avatar_frame as host_frame, u.level as host_level
      FROM rooms r
      LEFT JOIN users u ON r.host_id = u.id
      WHERE r.id = ?
    `, [roomId]);

    if (!room) return res.status(404).json({ error: 'Room not found' });

    const seats = await all(`
      SELECT s.seat_index, s.is_muted, s.is_locked, u.id as user_id, u.name, u.avatar, u.avatar_frame, u.level, u.charm_level
      FROM room_seats s
      LEFT JOIN users u ON s.user_id = u.id
      WHERE s.room_id = ?
      ORDER BY s.seat_index ASC
    `, [roomId]);

    room.seats = seats;
    res.json(room);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Room Chat Messages
app.get('/api/rooms/:id/messages', async (req, res) => {
  try {
    const roomId = req.params.id;
    const messages = await all(`
      SELECT m.*, u.name as sender_name, u.avatar as sender_avatar, u.level as sender_level, u.wealth_level as sender_wealth_level, u.charm_level as sender_charm_level, u.avatar_frame as sender_frame, u.chat_frame as sender_chat_frame, u.role as sender_role
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.room_id = ?
      ORDER BY m.created_at ASC
      LIMIT 100
    `, [roomId]);

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. Direct Messages Conversations List
app.get(['/api/messages/conversations', '/api/conversations'], async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.json([]);

    // Find distinct conversation partners
    const conversations = await all(`
      SELECT DISTINCT 
        CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as other_id
      FROM messages
      WHERE (sender_id = ? OR receiver_id = ?) AND room_id IS NULL
    `, [userId, userId, userId]);

    const result = [];
    for (const c of conversations) {
      if (!c.other_id) continue;
      const otherUser = await get('SELECT id, name, avatar, soul_planet, avatar_frame FROM users WHERE id = ?', [c.other_id]);
      if (!otherUser) continue;

      const lastMsg = await get(`
        SELECT content, message_type, media_url, created_at, sender_id
        FROM messages
        WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
          AND room_id IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `, [userId, c.other_id, c.other_id, userId]);

      result.push({
        user: otherUser,
        lastMessage: lastMsg || null,
        last_message: lastMsg || null,
        unreadCount: 0
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. Direct Chat History with Specific User
app.get('/api/messages/history/:otherId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const otherId = req.params.otherId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const messages = await all(`
      SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
        AND m.room_id IS NULL
      ORDER BY m.created_at ASC
      LIMIT 100
    `, [userId, otherId, otherId, userId]);

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// المتابعة المتبادلة: شرط تفعيل المكالمات وإرسال الصور والتسجيل الصوتي
async function areMutualFollowers(a, b) {
  if (!a || !b || a === b) return false;
  const f1 = await get('SELECT 1 AS x FROM follows WHERE follower_id = ? AND following_id = ?', [a, b]);
  if (!f1) return false;
  const f2 = await get('SELECT 1 AS x FROM follows WHERE follower_id = ? AND following_id = ?', [b, a]);
  return !!f2;
}
const MUTUAL_FOLLOW_MSG = 'المكالمات والصور والرسائل الصوتية تُفعَّل فقط عندما تتابعان بعضكما';

// 14. Send Direct Message
app.post('/api/messages', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { receiver_id, message_type, content, media_url, metadata } = req.body;

    // الصور والرسائل الصوتية (وأي وسائط) تتطلب متابعة متبادلة بين الطرفين
    if (['image', 'voice'].includes(message_type) || (media_url && message_type !== 'gift')) {
      if (!(await areMutualFollowers(userId, receiver_id))) {
        return res.status(403).json({ success: false, code: 'MUTUAL_FOLLOW_REQUIRED', error: MUTUAL_FOLLOW_MSG });
      }
    }
    const msgId = `msg-${Date.now().toString()}-${uuidv4().slice(0, 4)}`;

    await run(`
      INSERT INTO messages (id, sender_id, receiver_id, message_type, content, media_url, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [msgId, userId, receiver_id, message_type || 'text', content, media_url, metadata ? JSON.stringify(metadata) : null]);

    const createdMsg = await get(`
      SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.id = ?
    `, [msgId]);

    // Send via socket to receiver if online
    const receiverSockets = userSockets.get(receiver_id);
    if (receiverSockets) {
      for (const sockId of receiverSockets) {
        io.to(sockId).emit('private_message', createdMsg);
      }
    }

    res.json(createdMsg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. File / Voice Note Upload
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({
      success: true,
      url: fileUrl,
      filename: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Personal music repository: uploaded files and online audio links are persisted per user.
function musicFilePath(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return null;
  const uploadsDir = path.join(__dirname, 'public', 'uploads');
  const full = path.resolve(__dirname, 'public', url.replace(/^\//, ''));
  return path.dirname(full) === uploadsDir ? full : null;
}

async function requireMusicUser(req, res) {
  const userId = String(req.headers['x-user-id'] || '').trim();
  if (!userId) { res.status(401).json({ error: 'يجب تسجيل الدخول أولاً' }); return null; }
  const user = await get('SELECT id FROM users WHERE id = ?', [userId]);
  if (!user) { res.status(401).json({ error: 'المستخدم غير موجود' }); return null; }
  return user.id;
}

app.get('/api/music-library', async (req, res) => {
  try {
    const userId = await requireMusicUser(req, res); if (!userId) return;
    const tracks = await all(`
      SELECT id, title, source, url, file_name, artist, thumbnail, yt_id, audio_status, created_at
      FROM user_music_tracks WHERE user_id = ? ORDER BY created_at DESC
    `, [userId]);
    res.json({ success: true, tracks });
  } catch (err) {
    res.status(500).json({ error: 'تعذر تحميل مكتبة الموسيقى' });
  }
});

// حفظ أغنية من يوتيوب في مكتبة المستخدم (رفع الملفات من الجهاز أُلغي)
app.post('/api/music-library', async (req, res) => {
  try {
    const userId = await requireMusicUser(req, res); if (!userId) return;
    const body = req.body || {};
    const ytId = String(body.youtube_id || '').trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(ytId)) {
      return res.status(400).json({ error: 'أضف الأغاني عن طريق البحث في يوتيوب' });
    }
    const dup = await get('SELECT id, title, source, url, file_name, artist, thumbnail, yt_id, audio_status FROM user_music_tracks WHERE user_id = ? AND yt_id = ?', [userId, ytId]);
    if (dup) return res.json({ success: true, track: dup, duplicate: true });
    const count = await get('SELECT COUNT(*) AS n FROM user_music_tracks WHERE user_id = ?', [userId]);
    if (count && count.n >= 300) return res.status(400).json({ error: 'وصلت للحد الأقصى من الأغاني (300)، احذف بعضها أولاً' });

    const title = String(body.title || 'موسيقى').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 100) || 'موسيقى';
    const artist = String(body.artist || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80);
    const thumbnail = /^https:\/\/i\.ytimg\.com\//.test(String(body.thumbnail || '')) ? String(body.thumbnail).slice(0, 300) : `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`;
    const id = uuidv4();
    // إن كان الصوت محمّلاً مسبقاً (حفظه مستخدم آخر) نستعمله فوراً؛ وإلا نبدأ التحميل في الخلفية
    const ready = ytMp3.existing(ytId);
    let source, url, fileName, status;
    if (ready) { source = 'device'; url = ready.url; fileName = path.basename(ready.file); status = 'ready'; }
    else { source = 'youtube'; url = `https://www.youtube.com/watch?v=${ytId}`; fileName = null; status = 'processing'; }
    await run(`INSERT INTO user_music_tracks (id, user_id, title, source, url, file_name, artist, thumbnail, yt_id, audio_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, title, source, url, fileName, artist, thumbnail, ytId, status]);
    res.json({ success: true, track: { id, title, source, url, file_name: fileName, artist, thumbnail, yt_id: ytId, audio_status: status } });
    if (status === 'processing') startYtAudioJob(ytId);   // بعد الرد: لا ننتظر التحميل
  } catch (e) {
    console.error('music-library save error:', e);
    res.status(500).json({ error: 'تعذر حفظ الأغنية في مكتبتك' });
  }
});

// إعادة محاولة التحويل إلى MP3 بعد فشل التنزيل (مثلاً بعد إضافة cookies أو بروكسي).
app.post('/api/music-library/:id/retry', async (req, res) => {
  try {
    const userId = await requireMusicUser(req, res); if (!userId) return;
    const track = await get(`SELECT id, title, source, url, file_name, artist, thumbnail, yt_id, audio_status
      FROM user_music_tracks WHERE id = ? AND user_id = ?`, [req.params.id, userId]);
    if (!track) return res.status(404).json({ error: 'الأغنية غير موجودة' });
    if (!track.yt_id || track.source !== 'youtube') return res.status(400).json({ error: 'إعادة المحاولة متاحة لأغاني يوتيوب التي لم تكتمل معالجتها فقط' });
    if (track.audio_status === 'processing') return res.json({ success: true, track });

    const ready = ytMp3.existing(track.yt_id);
    if (ready) {
      track.source = 'device'; track.url = ready.url; track.file_name = path.basename(ready.file); track.audio_status = 'ready';
      await run(`UPDATE user_music_tracks SET source = 'device', url = ?, file_name = ?, audio_status = 'ready' WHERE yt_id = ? AND audio_status != 'ready'`,
        [ready.url, track.file_name, track.yt_id]);
      return res.json({ success: true, track });
    }

    track.source = 'youtube'; track.url = `https://www.youtube.com/watch?v=${track.yt_id}`; track.file_name = null; track.audio_status = 'processing';
    await run(`UPDATE user_music_tracks SET source = 'youtube', url = ?, file_name = NULL, audio_status = 'processing' WHERE id = ? AND user_id = ?`,
      [track.url, track.id, userId]);
    res.json({ success: true, track });
    startYtAudioJob(track.yt_id);
  } catch (e) {
    console.error('music-library retry error:', e);
    if (!res.headersSent) res.status(500).json({ error: 'تعذر بدء إعادة معالجة الأغنية' });
  }
});

app.delete('/api/music-library/:id', async (req, res) => {
  try {
    const userId = await requireMusicUser(req, res); if (!userId) return;
    const track = await get('SELECT id, url FROM user_music_tracks WHERE id = ? AND user_id = ?', [req.params.id, userId]);
    if (!track) return res.status(404).json({ error: 'النغمة غير موجودة' });
    await run('DELETE FROM user_music_tracks WHERE id = ? AND user_id = ?', [req.params.id, userId]);
    const filePath = musicFilePath(track.url);
    if (filePath && fs.existsSync(filePath)) {
      // ملفات يوتيوب مشتركة بين المستخدمين: لا نحذفها ما دام مستخدم آخر يحتفظ بها
      const still = await get('SELECT id FROM user_music_tracks WHERE url = ? LIMIT 1', [track.url]);
      if (!still) { try { fs.unlinkSync(filePath); } catch (e) {} }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'تعذر حذف النغمة' });
  }
});

// 16. Moments Feed List
app.get('/api/moments', async (req, res) => {
  try {
    const currentUserId = req.headers['x-user-id'];
    const friendsOnly = req.query.scope === 'friends';
    if (friendsOnly && !currentUserId) return res.json([]);
    const moments = await all(`
      SELECT m.*, u.name as user_name, u.avatar as user_avatar, u.soul_planet, u.avatar_frame
      FROM moments m
      JOIN users u ON m.user_id = u.id
      ${friendsOnly ? 'WHERE m.user_id = ? OR m.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)' : ''}
      ORDER BY m.created_at DESC
      LIMIT 50
    `, friendsOnly ? [currentUserId, currentUserId] : []);

    // Fetch comments and check if current user liked
    for (const m of moments) {
      m.comments = await all(`
        SELECT c.*, u.name as user_name, u.avatar as user_avatar
        FROM moment_comments c
        JOIN users u ON c.user_id = u.id
        WHERE c.moment_id = ?
        ORDER BY c.created_at ASC
      `, [m.id]);

      if (currentUserId) {
        const liked = await get('SELECT 1 FROM moment_likes WHERE moment_id = ? AND user_id = ?', [m.id, currentUserId]);
        m.is_liked = !!liked;
      } else {
        m.is_liked = false;
      }
    }

    res.json(moments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 17-yt. البحث في يوتيوب — يعمل بمفتاح YouTube Data API v3 إن وُجد، وإلا عبر بديل Innertube بدون مفتاح
const ytSearchCache = new Map(); // key -> { t, data }
const ytSearchHits = new Map();  // userId -> [timestamps]
const YT_CACHE_MS = 10 * 60 * 1000;

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)));
}

async function getYoutubeApiKey() {
  if (process.env.YOUTUBE_API_KEY) return process.env.YOUTUBE_API_KEY;
  try {
    const row = await get(`SELECT value FROM app_settings WHERE key = 'youtube_api_key'`);
    if (row && row.value) return row.value;
  } catch (e) {}
  return null;
}

// ---- بحث يوتيوب بدون مفتاح: عدة طرق تعمل بالتوازي ويُعاد أول نتيجة ناجحة ----
function ytParseVideoRenderers(root, limit = 12) {
  const found = [];
  const seen = new Set();
  const walk = (node) => {
    if (found.length >= limit || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const x of node) walk(x); return; }
    const vr = node.videoRenderer;
    if (vr && vr.videoId && !seen.has(vr.videoId)) {
      seen.add(vr.videoId);
      found.push({
        id: vr.videoId,
        title: decodeHtmlEntities(vr.title?.runs?.map(x => x.text).join('') || vr.title?.simpleText || ''),
        channel: decodeHtmlEntities(vr.ownerText?.runs?.map(x => x.text).join('') || vr.shortBylineText?.runs?.map(x => x.text).join('') || ''),
        thumbnail: `https://i.ytimg.com/vi/${vr.videoId}/mqdefault.jpg`,
        published_at: vr.publishedTimeText?.simpleText || ''
      });
    }
    for (const k of Object.keys(node)) { if (k !== 'videoRenderer') walk(node[k]); }
  };
  walk(root);
  return found;
}

const YT_COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'ar,en-US;q=0.8,en;q=0.6',
  // تجاوز صفحة الموافقة (consent) التي تظهر لبعض الدول وتمنع النتائج
  'Cookie': 'SOCS=CAI; CONSENT=YES+1'
};

async function ytSearchInnertube(q, clientName, clientVersion, timeoutMs) {
  const r = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...YT_COMMON_HEADERS, 'Origin': 'https://www.youtube.com' },
    body: JSON.stringify({ context: { client: { clientName, clientVersion, hl: 'ar', gl: 'SA' } }, query: q }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!r.ok) throw new Error(`innertube ${clientName} status ${r.status}`);
  const items = ytParseVideoRenderers(await r.json());
  if (!items.length) throw new Error(`innertube ${clientName}: no results`);
  return { items, nextPageToken: null };
}

async function ytSearchHtml(q, timeoutMs) {
  const r = await fetch('https://www.youtube.com/results?hl=ar&search_query=' + encodeURIComponent(q), {
    headers: { ...YT_COMMON_HEADERS, 'Accept': 'text/html' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!r.ok) throw new Error('html status ' + r.status);
  const html = await r.text();
  const m = html.match(/var ytInitialData\s*=\s*(\{.+?\});<\/script>/s);
  if (!m) throw new Error('html: ytInitialData not found');
  const items = ytParseVideoRenderers(JSON.parse(m[1]));
  if (!items.length) throw new Error('html: no results');
  return { items, nextPageToken: null };
}

function ytSearchViaYtDlp(q, timeoutMs) {
  return new Promise((resolve, reject) => {
    const bin = findYtDlp();
    if (!bin) return reject(new Error('yt-dlp not installed'));
    const { execFile } = require('child_process');
    const args = ['--flat-playlist', '-J', '--no-warnings', ...ytDlpAuthArgs(), 'ytsearch12:' + q];
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err) return reject(new Error('yt-dlp search: ' + String(err.message).slice(0, 120)));
      try {
        const j = JSON.parse(out);
        const items = (j.entries || []).filter(e => e && e.id).slice(0, 12).map(e => ({
          id: e.id, title: e.title || '', channel: e.channel || e.uploader || '',
          thumbnail: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`, published_at: ''
        }));
        if (!items.length) return reject(new Error('yt-dlp search: no results'));
        resolve({ items, nextPageToken: null });
      } catch (e) { reject(new Error('yt-dlp search: bad json')); }
    });
  });
}

// نسخ Invidious/Piped العامة كملاذ أخير (قد تتغير؛ يمكن تحديدها عبر YT_INVIDIOUS_INSTANCES مفصولة بفواصل)
async function ytSearchViaInvidious(q, timeoutMs) {
  const hosts = (process.env.YT_INVIDIOUS_INSTANCES || 'https://yewtu.be,https://inv.nadeko.net,https://invidious.nerdvpn.de')
    .split(',').map(x => x.trim()).filter(Boolean);
  const attempts = hosts.map(async (h) => {
    const r = await fetch(`${h}/api/v1/search?type=video&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': YT_COMMON_HEADERS['User-Agent'] } });
    if (!r.ok) throw new Error(`invidious ${h} status ${r.status}`);
    const j = await r.json();
    const items = (Array.isArray(j) ? j : []).filter(v => v.type === 'video' && v.videoId).slice(0, 12).map(v => ({
      id: v.videoId, title: v.title || '', channel: v.author || '',
      thumbnail: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`, published_at: v.publishedText || ''
    }));
    if (!items.length) throw new Error(`invidious ${h}: no results`);
    return { items, nextPageToken: null };
  });
  return Promise.any(attempts);
}

async function searchYoutubeViaInnertube(q, musicOnly) {
  const T = 8000;
  const strategies = [
    ['innertube-web', () => ytSearchInnertube(q, 'WEB', '2.20250101.00.00', T)],
    ['innertube-mweb', () => ytSearchInnertube(q, 'MWEB', '2.20250101.00.00', T)],
    ['html', () => ytSearchHtml(q, T)],
    ['yt-dlp', () => ytSearchViaYtDlp(q, 15000)],
    ['invidious', () => ytSearchViaInvidious(q, T)]
  ];
  const errors = [];
  const attempts = strategies.map(([name, fn]) => fn().then((r) => { r.source = name; return r; }, (e) => {
    errors.push(`${name}: ${e && e.message ? e.message : e}`);
    throw e;
  }));
  try {
    return await Promise.any(attempts);
  } catch (e) {
    // اطبع سبب فشل كل طريقة ليعرف المدير هل المشكلة شبكة محظورة أم حجب يوتيوب لعنوان الخادم
    console.error('YouTube search: all strategies failed ->', errors.join(' | '));
    throw new Error('all strategies failed');
  }
}

app.get('/api/youtube/search', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId || !(await get('SELECT id FROM users WHERE id = ?', [userId]))) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    let apiKey = await getYoutubeApiKey();
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q.length < 2) return res.status(400).json({ success: false, error: 'اكتب كلمة بحث من حرفين على الأقل' });
    const pageToken = /^[A-Za-z0-9_-]{1,100}$/.test(String(req.query.pageToken || '')) ? String(req.query.pageToken) : '';

    // حد معقول للطلبات لحماية حصة المفتاح: 15 بحثاً في الدقيقة لكل مستخدم
    const now = Date.now();
    const hits = (ytSearchHits.get(userId) || []).filter(t => now - t < 60000);
    if (hits.length >= 15) return res.status(429).json({ success: false, error: 'عدد كبير من عمليات البحث، انتظر قليلاً ثم أعد المحاولة' });
    hits.push(now);
    ytSearchHits.set(userId, hits);

    const musicOnly = String(req.query.music || '') === '1';
    const cacheKey = `${q.toLowerCase()}|${pageToken}|${musicOnly ? 'm' : ''}|${apiKey ? 'key' : 'free'}`;
    const cached = ytSearchCache.get(cacheKey);
    if (cached && now - cached.t < YT_CACHE_MS) return res.json({ success: true, ...cached.data });

    let data = null;
    let usedFallback = false;

    if (apiKey) {
      // جرّب Official API أولاً
      try {
        const url = new URL('https://www.googleapis.com/youtube/v3/search');
        url.searchParams.set('part', 'snippet');
        url.searchParams.set('type', 'video');
        url.searchParams.set('maxResults', '12');
        url.searchParams.set('safeSearch', 'strict');
        url.searchParams.set('videoEmbeddable', 'true');
        url.searchParams.set('q', q);
        if (musicOnly) url.searchParams.set('videoCategoryId', '10');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        url.searchParams.set('key', apiKey);

        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          data = {
            items: (j.items || []).filter(it => it.id && it.id.videoId).map(it => ({
              id: it.id.videoId,
              title: decodeHtmlEntities(it.snippet.title),
              channel: decodeHtmlEntities(it.snippet.channelTitle),
              thumbnail: (it.snippet.thumbnails && ((it.snippet.thumbnails.medium || it.snippet.thumbnails.default) || {}).url) || '',
              published_at: it.snippet.publishedAt
            })),
            nextPageToken: j.nextPageToken || null
          };
        } else {
          const reason = j && j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason;
          console.error('YouTube search error:', r.status, reason || (j.error && j.error.message));
          if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
            // الحصة انتهت — تحوّل تلقائياً إلى البديل المجاني
            console.log('Quota exceeded, switching to fallback');
          } else if (r.status === 400 || r.status === 403) {
            // مفتاح غير صالح — جرّب البديل بدل إظهار خطأ للعميل
            console.log('API key invalid, trying fallback');
          } else {
            return res.status(502).json({ success: false, error: 'تعذر البحث في يوتيوب حالياً' });
          }
          // سننتقل إلى Fallback أدناه
        }
      } catch (err) {
        console.error('Official API fetch failed, trying fallback:', err.message);
      }
    }

    if (!data) {
      // جرّب البديل المجاني
      try {
        const fb = await searchYoutubeViaInnertube(q, musicOnly);
        data = fb;
        usedFallback = true;
      } catch (err) {
        console.error('Fallback search failed:', err.message);
        if (apiKey) {
          // كان لدينا مفتاح لكنه فشل والبديل فشل أيضاً
          return res.status(502).json({ success: false, error: 'تعذر البحث في يوتيوب حالياً، حاول مرة أخرى' });
        } else {
          // بدون مفتاح والبديل فشل (مثلاً الشبكة محظورة في البيئة المحلية) — أعد رسالة واضحة مع السماح باللصق المباشر
          return res.status(503).json({ success: false, code: 'NO_KEY', fallback_direct: true, error: 'تعذر الاتصال بخدمة البحث حالياً. يمكنك لصق رابط يوتيوب مباشرة، أو على مدير الخادم إضافة YOUTUBE_API_KEY لتفعيل البحث.' });
        }
      }
    }

    if (!data.items.length) {
      // لا نتائج — لا نعتبره خطأ
    }
    if (ytSearchCache.size > 200) ytSearchCache.delete(ytSearchCache.keys().next().value);
    ytSearchCache.set(cacheKey, { t: now, data });
    res.json({ success: true, items: data.items, nextPageToken: data.nextPageToken || null, via: usedFallback ? 'fallback' : 'api', source: data.source || 'api' });
  } catch (err) {
    console.error('youtube search outer error:', err);
    res.status(500).json({ success: false, error: 'تعذر البحث في يوتيوب حالياً' });
  }
});

// إعداد مفتاح يوتيوب من لوحة الإدارة (يُحفظ في app_settings ويُستخدم فوراً بدون إعادة تشغيل)

// ── تشغيل يوتيوب كمقطع صوتي مخفي (للموسيقى في الغرف) — يعيد رابط صوت مباشر عبر Innertube ──
// استخراج رابط الصوت: 1) yt-dlp إن كان مثبتاً (الأكثر موثوقية)  2) عدة عملاء Innertube بترويسات مطابقة
let _ytdlpBin; // undefined=لم يُفحص، null=غير موجود
const YTDLP_LOCAL = path.join(__dirname, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
// كوكيز يوتيوب تلقائياً: ضع ملف cookies.txt (صيغة Netscape) في مجلد المشروع فيُستعمل دون أي إعداد آخر
if (!process.env.YTDLP_COOKIES) {
  for (const c of [path.join(__dirname, 'cookies.txt'), path.join(__dirname, 'bin', 'cookies.txt')]) {
    if (fs.existsSync(c)) { process.env.YTDLP_COOKIES = c; console.log('🍪 yt-dlp cookies:', c); break; }
  }
}
function findYtDlp() {
  if (_ytdlpBin !== undefined) return _ytdlpBin;
  const { spawnSync } = require('child_process');
  for (const bin of [process.env.YTDLP_PATH, YTDLP_LOCAL, 'yt-dlp', 'yt-dlp.exe'].filter(Boolean)) {
    try { const r = spawnSync(bin, ['--version'], { timeout: 5000 }); if (r.status === 0) { _ytdlpBin = bin; return bin; } } catch (e) {}
  }
  _ytdlpBin = null; return null;
}
// تحميل yt-dlp تلقائياً (مرة واحدة) إلى ./bin إذا لم يكن مثبتاً — يعمل على Windows/Linux/macOS
let _ytdlpInstalling = null;
function ensureYtDlp() {
  if (findYtDlp()) return Promise.resolve(true);
  if (_ytdlpInstalling) return _ytdlpInstalling;
  const file = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : (process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux');
  _ytdlpInstalling = (async () => {
    try {
      console.log('yt-dlp غير موجود — جارٍ تحميله تلقائياً…');
      const r = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest/download/' + file, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 1e6) throw new Error('ملف غير صالح');
      fs.mkdirSync(path.dirname(YTDLP_LOCAL), { recursive: true });
      fs.writeFileSync(YTDLP_LOCAL, buf, { mode: 0o755 });
      _ytdlpBin = undefined;
      const ok = !!findYtDlp();
      console.log(ok ? 'yt-dlp جاهز: ' + YTDLP_LOCAL : 'yt-dlp: فشل التشغيل بعد التحميل');
      return ok;
    } catch (e) {
      console.error('yt-dlp auto-install failed:', e.message, '— حمّله يدوياً من github.com/yt-dlp/yt-dlp/releases وضعه في مجلد bin');
      return false;
    } finally { _ytdlpInstalling = null; }
  })();
  return _ytdlpInstalling;
}
setTimeout(() => { ensureYtDlp(); }, 1500);

function ytDlpAuthArgs() {
  const args = [];
  if (process.env.YTDLP_PROXY) args.push('--proxy', process.env.YTDLP_PROXY);
  if (process.env.YTDLP_COOKIES) args.push('--cookies', process.env.YTDLP_COOKIES);
  else if (process.env.YTDLP_COOKIES_FROM_BROWSER) args.push('--cookies-from-browser', process.env.YTDLP_COOKIES_FROM_BROWSER);
  return args;
}
function ytDlpAudioUrl(videoId) {
  return new Promise((resolve, reject) => {
    const bin = findYtDlp(); if (!bin) return reject(new Error('yt-dlp not installed'));
    const { execFile } = require('child_process');
    // هذا المسار للتشغيل المباشر فقط. مرّر له إعدادات البروكسي/الكوكيز نفسها المستخدمة في التنزيل.
    const args = ['-f', 'bestaudio[ext=m4a]/bestaudio', '-g', '--no-playlist', '--no-warnings', '--js-runtimes', 'node',
      ...ytDlpAuthArgs(), 'https://www.youtube.com/watch?v=' + videoId];
    execFile(bin, args, { timeout: 25000, maxBuffer: 2 * 1024 * 1024 }, (err, out, stderr) => {
      const url = String(out || '').trim().split('\n')[0];
      if (err || !/^https?:\/\//.test(url)) {
        const detail = String(stderr || (err && err.message) || 'no url').replace(/\s+/g, ' ').slice(0, 240);
        return reject(new Error('yt-dlp: ' + detail));
      }
      resolve({ url, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', duration: 0, title: '' });
    });
  });
}
const YT_CLIENTS = [
  { ua: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    client: { clientName: 'ANDROID_VR', clientVersion: '1.60.19', deviceMake: 'Oculus', deviceModel: 'Quest 3', osName: 'Android', osVersion: '12L', androidSdkVersion: 32, hl: 'en', gl: 'US' } },
  { ua: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)',
    client: { clientName: 'IOS', clientVersion: '19.45.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.1.0.22B83', hl: 'en', gl: 'US' } },
  { ua: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version', embed: true, id: '85',
    client: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', hl: 'en', gl: 'US' } },
  { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', embed: true, id: '56',
    client: { clientName: 'WEB_EMBEDDED_PLAYER', clientVersion: '1.20250101.01.00', hl: 'en', gl: 'US' } },
  { ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
    client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, osName: 'Android', osVersion: '14', hl: 'en', gl: 'US' } }
];
async function innertubeCandidates(videoId) {
  const errs = [], out = [];
  for (const c of YT_CLIENTS) {
    const name = c.client.clientName;
    try {
      const ids = { IOS: '5', ANDROID_VR: '28', ANDROID: '3' };
      const body = { context: { client: c.client }, videoId, contentCheckOk: true, racyCheckOk: true };
      if (c.embed) body.context.thirdParty = { embedUrl: 'https://www.youtube.com/watch?v=' + videoId };
      const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': c.ua, 'X-YouTube-Client-Name': c.id || ids[name] || '3', 'X-YouTube-Client-Version': c.client.clientVersion, 'Origin': 'https://www.youtube.com' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(9000)
      });
      if (!r.ok) { errs.push(name + ' HTTP ' + r.status); continue; }
      const j = await r.json();
      const sd = j.streamingData;
      if (!sd) { errs.push(name + ': ' + (j.playabilityStatus?.reason || j.playabilityStatus?.status || 'no streamingData')); continue; }
      const audios = [...(sd.adaptiveFormats || []), ...(sd.formats || [])].filter(f => (f.mimeType || '').startsWith('audio/') && f.url);
      if (!audios.length) { errs.push(name + ': no direct url (needs signature)'); continue; }
      audios.sort((x, y) => ((y.mimeType.includes('mp4') ? 1e7 : 0) + (y.bitrate || 0)) - ((x.mimeType.includes('mp4') ? 1e7 : 0) + (x.bitrate || 0)));
      out.push({ url: audios[0].url, ua: c.ua, client: name, size: Number(audios[0].contentLength || 0), bitrate: Number(audios[0].averageBitrate || audios[0].bitrate || 0), durationMs: Number(audios[0].approxDurationMs || (Number(j.videoDetails?.lengthSeconds || 0) * 1000)), duration: Number(j.videoDetails?.lengthSeconds || 0), title: j.videoDetails?.title || '' });
    } catch (e) { errs.push(name + ': ' + (e.cause?.code || e.message)); }
  }
  out.errors = errs;
  return out;
}
async function innertubeAudioUrl(videoId) {
  const c = await innertubeCandidates(videoId);
  if (!c.length) throw new Error(c.errors.join(' || '));
  return c[0];
}
async function getYoutubeAudioUrl(videoId) {
  const errs = [];
  if (findYtDlp()) { try { return await ytDlpAudioUrl(videoId); } catch (e) { errs.push(e.message); } }
  try { return await innertubeAudioUrl(videoId); } catch (e) { errs.push(e.message); }
  const err = new Error(errs.join(' | ')); throw err;
}

app.get('/api/youtube/audio/:videoId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId || !(await get('SELECT id FROM users WHERE id = ?', [userId]))) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const videoId = String(req.params.videoId || '').trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return res.status(400).json({ success: false, error: 'معرّف فيديو غير صالح' });
    // حماية بسيطة من الإغراق
    const now = Date.now();
    const hits = (ytSearchHits.get(userId) || []).filter(t => now - t < 60000);
    if (hits.length >= 20) return res.status(429).json({ success: false, error: 'عدد كبير من الطلبات' });
    hits.push(now);
    ytSearchHits.set(userId, hits);

    const data = await getYoutubeAudioUrl(videoId);
    res.json({ success: true, ...data });
  } catch (err) {
    // هذا المسار خاص بجلب رابط تشغيل مباشر؛ حفظ MP3 يعمل في /api/music-library بشكل منفصل.
    console.error('youtube audio playback error:', err.message);
    res.status(502).json({ success: false, error: 'تعذر جلب رابط الصوت المباشر؛ قد يحجب يوتيوب خادم الموقع.' });
  }
});

// ── بروكسي صوت يوتيوب (نفس النطاق) ──
// يجعل الصوت من نفس أصل الموقع فيستطيع المتصفح التقاطه عبر WebAudio ودمجه في ميكرفون المقعد
// (الرابط المباشر من googlevideo لا يدعم CORS فكان يفشل ويسقط إلى مشغّل iframe الذي لا يمكن بثّه).
const ytAudioUrlCache = new Map(); // videoId -> { url, ua, total, mime, exp }
const YT_CHUNK = 4 * 1024 * 1024;
function ytChunkFetch(cand, from, to) {
  const u = new URL(cand.url); if (!cand.noOrigin) u.searchParams.set('range', from + '-' + to);
  const hdr = { 'User-Agent': cand.ua || 'Mozilla/5.0', 'Range': 'bytes=' + from + '-' + to };
  if (!cand.noOrigin) { hdr['Origin'] = 'https://www.youtube.com'; hdr['Referer'] = 'https://www.youtube.com/'; }
  return fetch(u.toString(), { headers: hdr, signal: AbortSignal.timeout(20000) });
}
// يفحص كل رابط مرشّح: بداية الملف + منتصفه (روابط بعض العملاء تُقبل في البداية ثم تعطي 403 لاحقاً بدون PO token)
// ويعيد قائمة بكل الروابط الصالحة بالترتيب، ليجرّب المحمّل التالي منها إذا رُفض الأول أثناء التحميل.
async function resolveYtStream(videoId) {
  const cands = [];
  if (findYtDlp()) { try { cands.push(await ytDlpAudioUrl(videoId)); } catch (e) { cands.errors = [e.message]; } }
  let it = [];
  try { it = await innertubeCandidates(videoId); } catch (e) {}
  cands.push(...it);
  try { cands.push(...await pipedCandidates(videoId)); } catch (e) {}
  const errs = [...(cands.errors || []), ...(it.errors || [])];
  const good = [];
  for (const c of cands) {
    const nm = c.client || 'yt-dlp';
    try {
      const r = await ytChunkFetch(c, 0, 1023);
      if (!(r.status === 200 || r.status === 206)) { errs.push(nm + ' download HTTP ' + r.status); try { await r.arrayBuffer(); } catch (e) {} continue; }
      const cr = r.headers.get('content-range') || '';
      const total = Number(new URL(c.url).searchParams.get('clen') || 0) || c.size || Number(cr.split('/')[1] || 0) || 0;
      const mime = r.headers.get('content-type') || 'audio/mp4';
      try { await r.arrayBuffer(); } catch (e) {}
      const expected = c.bitrate && c.durationMs ? (c.bitrate * c.durationMs) / 8000 : 0;
      if (!(total > 0)) { errs.push(nm + ': unknown size'); continue; }
      if (expected && total < expected * 0.3) { errs.push(nm + ': size too small (' + total + ' vs ~' + Math.round(expected) + ')'); continue; }
      // فحص عميق: دفعة بعد أول ~3MB وأخرى قرب النهاية
      let deepOk = true;
      for (const off of [Math.min(3 * 1024 * 1024, total - 1025), total - 1025]) {
        if (off <= 1024) continue;
        const d = await ytChunkFetch(c, off, off + 1023);
        try { await d.arrayBuffer(); } catch (e) {}
        if ([401, 403, 410].includes(d.status)) { errs.push(nm + ' deep-probe HTTP ' + d.status + ' @' + off); deepOk = false; break; }
      }
      if (!deepOk) continue;
      good.push({ url: c.url, ua: c.ua, total, mime, client: nm });
    } catch (e) { errs.push(nm + ' download: ' + (e.cause?.code || e.message)); }
  }
  if (!good.length) throw new Error(errs.join(' || ') || 'no candidates');
  return good;
}
// ملاذ أخير: yt-dlp يحمّل الملف بنفسه إلى مجلد الكاش
// بدون كوكيز: نجرّب عدة عملاء يوتيوب (بعضها لا يطلب تسجيل دخول)، ويدعم بروكسي اختياري YTDLP_PROXY
const YTDLP_CLIENT_SETS = [
  'youtube:player_client=tv_simply,tv_embedded',
  'youtube:player_client=web_embedded,mweb',
  'youtube:player_client=android_vr',
  'youtube:player_client=web_safari,tv',
  ''
];
async function ytDlpDownloadFile(videoId, cacheDir) {
  await ensureYtDlp();
  const bin = findYtDlp(); if (!bin) throw new Error('yt-dlp not installed');
  const { execFile } = require('child_process');
  const base = path.join(cacheDir, videoId);
  const errs = [];
  for (const ex of YTDLP_CLIENT_SETS) {
    const args = ['-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio', '--no-playlist', '--no-warnings', '--no-part', '--js-runtimes', 'node',
      ...ytDlpAuthArgs(), '-o', base + '.%(ext)s'];
    if (ex) args.push('--extractor-args', ex);
    args.push('https://www.youtube.com/watch?v=' + videoId);
    const found = await new Promise((resolve) => {
      execFile(bin, args, { timeout: 60000 }, (err, so, se) => {
        for (const e2 of ['m4a', 'webm']) { const f = base + '.' + e2; try { if (fs.statSync(f).size > 0) return resolve(f); } catch (e) {} }
        errs.push((ex || 'default') + ': ' + String(se || (err && err.message) || 'no file').trim().slice(-120));
        resolve(null);
      });
    });
    if (found) return found;
  }
  throw new Error(errs.join(' | ').slice(0, 500));
}

// بدائل Piped: خوادم عامة تجلب الصوت من يوتيوب بدلاً منا (لا كوكيز ولا IP خادمك). يمكن تعديل القائمة عبر PIPED_INSTANCES
const PIPED_INSTANCES = (process.env.PIPED_INSTANCES || 'https://pipedapi.kavin.rocks,https://pipedapi.adminforge.de,https://api.piped.private.coffee,https://pipedapi.leptons.xyz').split(',').map(x => x.trim().replace(/\/$/, '')).filter(Boolean);
async function pipedCandidates(videoId) {
  const out = [];
  for (const base of PIPED_INSTANCES) {
    try {
      const r = await fetch(base + '/streams/' + videoId, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const j = await r.json();
      const audios = (j.audioStreams || []).filter(a => a.url && !a.videoOnly);
      if (!audios.length) continue;
      audios.sort((x, y) => ((/mp4/.test(y.mimeType || '') ? 1e7 : 0) + (y.bitrate || 0)) - ((/mp4/.test(x.mimeType || '') ? 1e7 : 0) + (x.bitrate || 0)));
      for (const a of audios.slice(0, 2)) {
        out.push({ url: a.url, ua: 'Mozilla/5.0', client: 'piped', size: Number(a.contentLength || 0), bitrate: 0, durationMs: 0, noOrigin: true });
      }
      if (out.length) break;
    } catch (e) { /* جرّب المثيل التالي */ }
  }
  return out;
}

const ytDiskStream = require('./yt-stream').createYtStream({
  resolve: resolveYtStream,
  fetchChunk: ytChunkFetch,
  fallbackDownload: ytDlpDownloadFile,
  cacheDir: path.join(__dirname, 'cache', 'yt')
});

// حفظ أغنية يوتيوب كملف MP3 صغير (أقل جودة = أسرع تحميل) ثم تشغيلها كمقطع صوتي عادي
const ytMp3 = require('./yt-mp3-saver').createYtMp3Saver({
  ensureYtDlp, findYtDlp,
  outDir: path.join(__dirname, 'public', 'uploads'),
  clientSets: YTDLP_CLIENT_SETS,
  // بديل عند فشل yt-dlp: عملاء Innertube (قد تعمل من خوادم لا تقبل yt-dlp)
  altSource: (id) => ytDiskStream.ensure(id, false, { skipFallback: true })
});
function startYtAudioJob(ytId) {
  ytMp3.queue(ytId).then(async (r) => {
    await run(`UPDATE user_music_tracks SET source = 'device', url = ?, file_name = ?, audio_status = 'ready' WHERE yt_id = ? AND audio_status = 'processing'`,
      [r.url, path.basename(r.file), ytId]);
    console.log('🎵 yt audio ready:', ytId, r.format);
  }).catch(async (e) => {
    console.error('yt audio job failed:', ytId, e.message);
    try { await run(`UPDATE user_music_tracks SET audio_status = 'failed' WHERE yt_id = ? AND audio_status = 'processing'`, [ytId]); } catch (x) {}
  });
}
app.get('/api/youtube/stream/:videoId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.query.uid;
    if (!userId || !(await get('SELECT id FROM users WHERE id = ?', [userId]))) return res.status(401).end();
    const videoId = String(req.params.videoId || '').trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return res.status(400).end();
    await ytDiskStream.handle(req, res, videoId, { fresh: req.query.fresh === '1' });
  } catch (err) {
    console.error('youtube stream route error:', err.message);
    if (!res.headersSent) res.status(502).json({ success: false, error: String(err.message || 'فشل جلب الصوت').slice(0, 300) });
  }
});

app.get('/api/admin/youtube-key', async (req, res) => {

  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const key = await getYoutubeApiKey();
    res.json({ success: true, has_key: !!key, preview: key ? (key.slice(0, 6) + '...' + key.slice(-4)) : '' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/admin/youtube-key', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const key = String(req.body.key || '').trim();
    if (key && !/^AIza[0-9A-Za-z_\-]{30,}$/.test(key)) return res.status(400).json({ error: 'مفتاح YouTube غير صالح (يجب أن يبدأ بـ AIza…)' });
    if (key) {
      await run(`INSERT INTO app_settings (key, value) VALUES ('youtube_api_key', ?)\n        ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key]);
      ytSearchCache.clear();
    } else {
      await run(`DELETE FROM app_settings WHERE key = 'youtube_api_key'`);
      ytSearchCache.clear();
    }
    res.json({ success: true, has_key: !!key });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// 17a. رفع وسائط المنشورات (صورة أو فيديو)
const MOMENT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MOMENT_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const momentMediaUpload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB للفيديو
  fileFilter: (req, file, cb) => {
    if (MOMENT_IMAGE_TYPES.includes(file.mimetype) || MOMENT_VIDEO_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(new Error('نوع الملف غير مدعوم. المسموح: صور (JPG/PNG/WEBP/GIF) أو فيديو (MP4/WEBM/MOV)'));
  }
});
app.post('/api/moments/upload', (req, res) => {
  momentMediaUpload.single('file')(req, res, async (err) => {
    try {
      const userId = req.headers['x-user-id'];
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? 'حجم الملف كبير جداً (الحد الأقصى 50MB للفيديو و8MB للصورة)' : err.message;
        return res.status(400).json({ success: false, error: msg });
      }
      if (!userId || !(await get('SELECT id FROM users WHERE id = ?', [userId]))) {
        if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      if (!req.file) return res.status(400).json({ success: false, error: 'لم يتم اختيار ملف' });
      const isVideo = MOMENT_VIDEO_TYPES.includes(req.file.mimetype);
      if (!isVideo && req.file.size > 8 * 1024 * 1024) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
        return res.status(400).json({ success: false, error: 'حجم الصورة كبير (الحد الأقصى 8MB)' });
      }
      res.json({ success: true, url: `/uploads/${req.file.filename}`, kind: isVideo ? 'video' : 'image' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
});

function extractYouTubeId(input) {
  if (!input) return null;
  const str = String(input).trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(str)) return str;
  let u;
  try { u = new URL(/^https?:\/\//i.test(str) ? str : 'https://' + str); } catch (e) { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
      if (m) id = m[1];
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

// 17. Create Moment (نص + صورة / صورة فقط / فيديو / يوتيوب)
app.post('/api/moments', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { image_url, audio_url, tag, youtube_url } = req.body;
    let { media_type, video_url } = req.body;
    const content = (req.body.content || '').toString().trim();
    const okImage = (u) => typeof u === 'string' && (u.startsWith('/uploads/') || /^https:\/\//i.test(u));

    let imageUrl = null;
    let videoUrl = null;
    if (!media_type) {
      // توافق مع الواجهة القديمة: نص + صورة اختيارية
      if (!content) return res.status(400).json({ error: 'Content is required' });
      media_type = image_url ? 'text_image' : 'text';
      imageUrl = image_url || null;
    } else if (media_type === 'text_image') {
      if (!content) return res.status(400).json({ error: 'اكتب نص المنشور' });
      if (!okImage(image_url)) return res.status(400).json({ error: 'اختر صورة للمنشور' });
      imageUrl = image_url;
    } else if (media_type === 'image') {
      if (!okImage(image_url)) return res.status(400).json({ error: 'اختر صورة للمنشور' });
      imageUrl = image_url;
    } else if (media_type === 'video') {
      if (typeof video_url !== 'string' || !video_url.startsWith('/uploads/')) {
        return res.status(400).json({ error: 'ارفع مقطع فيديو أولاً' });
      }
      videoUrl = video_url;
    } else if (media_type === 'youtube') {
      const ytId = extractYouTubeId(youtube_url || video_url);
      if (!ytId) return res.status(400).json({ error: 'رابط يوتيوب غير صالح' });
      videoUrl = ytId;
    } else if (media_type === 'text') {
      if (!content) return res.status(400).json({ error: 'اكتب نص المنشور' });
    } else {
      return res.status(400).json({ error: 'نوع المنشور غير معروف' });
    }

    const momentId = `moment-${Date.now()}`;
    await run(`
      INSERT INTO moments (id, user_id, content, image_url, audio_url, tag, likes_count, media_type, video_url)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `, [momentId, userId, content, imageUrl, audio_url || null, tag || 'chill', media_type, videoUrl]);

    const newMoment = await get(`
      SELECT m.*, u.name as user_name, u.avatar as user_avatar, u.soul_planet, u.avatar_frame
      FROM moments m
      JOIN users u ON m.user_id = u.id
      WHERE m.id = ?
    `, [momentId]);

    newMoment.comments = [];
    newMoment.is_liked = false;

    // Broadcast new moment to everyone
    io.emit('new_moment', newMoment);

    res.json({ success: true, moment: newMoment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 18. Like/Unlike Moment
app.post('/api/moments/:id/like', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const momentId = req.params.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const existing = await get('SELECT 1 FROM moment_likes WHERE moment_id = ? AND user_id = ?', [momentId, userId]);

    if (existing) {
      await run('DELETE FROM moment_likes WHERE moment_id = ? AND user_id = ?', [momentId, userId]);
      await run('UPDATE moments SET likes_count = MAX(0, likes_count - 1) WHERE id = ?', [momentId]);
      res.json({ success: true, liked: false });
    } else {
      await run('INSERT INTO moment_likes (moment_id, user_id) VALUES (?, ?)', [momentId, userId]);
      await run('UPDATE moments SET likes_count = likes_count + 1 WHERE id = ?', [momentId]);
      res.json({ success: true, liked: true });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 19. Add Comment to Moment
app.post('/api/moments/:id/comments', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const momentId = req.params.id;
    const { content } = req.body;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!content) return res.status(400).json({ error: 'Content required' });

    const cmtId = `cmt-${Date.now()}`;
    await run(`
      INSERT INTO moment_comments (id, moment_id, user_id, content)
      VALUES (?, ?, ?, ?)
    `, [cmtId, momentId, userId, content]);

    const comment = await get(`
      SELECT c.*, u.name as user_name, u.avatar as user_avatar
      FROM moment_comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `, [cmtId]);

    io.emit('new_moment_comment', { momentId, comment });

    res.json({ success: true, comment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 19b. Delete Moment (المشرفون فقط: المالك، سوبر ماستر، سوبر أدمن، أدمن، مشرف)
app.delete('/api/moments/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // الصلاحية تُقرأ من قاعدة البيانات وليس من الطلب
    const user = await get('SELECT id, role FROM users WHERE id = ?', [userId]);
    const canModerate = user && ['owner', 'super_master', 'super_admin', 'admin', 'moderator'].includes(user.role);
    if (!canModerate) return res.status(403).json({ error: 'حذف المنشورات متاح للمشرفين فقط' });

    const momentId = req.params.id;
    const moment = await get('SELECT * FROM moments WHERE id = ?', [momentId]);
    if (!moment) return res.status(404).json({ error: 'المنشور غير موجود أو تم حذفه' });

    await run('DELETE FROM moment_comments WHERE moment_id = ?', [momentId]);
    await run('DELETE FROM moment_likes WHERE moment_id = ?', [momentId]);
    await run('DELETE FROM moments WHERE id = ?', [momentId]);

    // حذف صورة المنشور من السيرفر إن كانت مرفوعة محلياً داخل uploads
    try {
      if (moment.image_url && moment.image_url.startsWith('/uploads/')) {
        const uploadsDir = path.join(__dirname, 'public', 'uploads');
        const full = path.join(__dirname, 'public', moment.image_url);
        if (path.dirname(full) === uploadsDir && fs.existsSync(full)) fs.unlinkSync(full);
      }
    } catch (e) { console.error('delete moment image error:', e.message); }
    try {
      if (moment.media_type === 'video' && moment.video_url && moment.video_url.startsWith('/uploads/')) {
        const uploadsDir = path.join(__dirname, 'public', 'uploads');
        const full = path.join(__dirname, 'public', moment.video_url);
        if (path.dirname(full) === uploadsDir && fs.existsSync(full)) fs.unlinkSync(full);
      }
    } catch (e) { console.error('delete moment video error:', e.message); }

    io.emit('moment_deleted', { momentId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 20. Gift List Catalogue
app.get('/api/gifts', async (req, res) => {
  res.json(await getActiveGifts());
});

// ═══════════════════════════════════════════════════════════════
//  نظام نشاط الأعضاء: النقاط / المستويات / بطاقات العرض / VIP
//  1) نشاط العضو: إرسال هدايا — استلام هدايا — شراء VIP
//  2) تسجيل النقاط والعملات والهدايا ومدة الاشتراك في قاعدة البيانات
//  3) حساب المستوى من النقاط (member-levels.js)
//  4) بطاقات العرض: الثروة Lv.3 — الرواج Lv.4 — VIP0
// ═══════════════════════════════════════════════════════════════
const memberLevels = require('./member-levels');

async function getPointSettings() {
  const rows = await all(`SELECT key, value FROM app_settings WHERE key IN ('coins_per_point','diamonds_per_point')`);
  const m = { coins_per_point: 10, diamonds_per_point: 1 };
  rows.forEach(r => { const n = Math.floor(Number(r.value)); if (Number.isFinite(n) && n >= 1) m[r.key] = n; });
  return m;
}

// إضافة نقاط (ثروة/رواج) ثم إعادة حساب المستوى وتخزينه في الأعمدة القديمة حتى يعمل باقي التطبيق كما هو
async function addMemberPoints(userId, kind, points) {
  points = Math.max(0, Math.floor(Number(points)) || 0);
  if (!userId || !points) return;
  const col = kind === 'wealth' ? 'wealth_points' : 'popularity_points';
  const lvCol = kind === 'wealth' ? 'wealth_level' : 'charm_level';
  await run(`UPDATE users SET ${col} = COALESCE(${col}, 0) + ? WHERE id = ?`, [points, userId]);
  const u = await get(`SELECT ${col} AS pts, ${lvCol} AS lvl FROM users WHERE id = ?`, [userId]);
  if (!u) return;
  const computed = memberLevels.levelFromPoints(u.pts).level;
  // الحسابات الخاصة (مالك = 99 مثلاً) لا نخفض مستواها
  if ((Number(u.lvl) || 0) <= memberLevels.MAX_LEVEL && Number(u.lvl) !== computed) {
    await run(`UPDATE users SET ${lvCol} = ? WHERE id = ?`, [computed, userId]);
  }
}

async function logMemberActivity(a) {
  await run(`
    INSERT INTO member_activity (id, user_id, type, other_user_id, ref_id, ref_name, quantity, amount, currency, points, points_kind, room_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [`act-${Date.now()}-${uuidv4().slice(0, 6)}`, a.user_id, a.type, a.other_user_id || null, a.ref_id != null ? String(a.ref_id) : null,
      a.ref_name || null, a.quantity || 1, a.amount || 0, a.currency || 'coins', a.points || 0, a.points_kind || null, a.room_id || null]);
}

// يرسل للعضو مباشرة بطاقاته الجديدة (الثروة/الرواج/VIP) ليتحدث العرض فوراً
async function notifyMemberStats(userId) {
  try {
    const set = userSockets.get(userId);
    if (!set || !set.size) return;
    const u = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!u) return;
    const payload = {
      wealth_level: u.wealth_level, charm_level: u.charm_level,
      wealth_points: u.wealth_points || 0, popularity_points: u.popularity_points || 0,
      vip_level: memberLevels.activeVipLevel(u), vip_until: u.vip_until || null,
      coins: u.coins, diamonds: u.diamonds, cards: memberLevels.buildCards(u)
    };
    for (const sId of set) io.to(sId).emit('member_stats_updated', payload);
  } catch (e) { console.error('notifyMemberStats error:', e.message); }
}

// إنهاء اشتراكات VIP المنتهية (تُصفَّر تلقائياً ليظهر VIP0)
async function expireVipSubscriptions() {
  try {
    const expired = await all(`SELECT id FROM users WHERE COALESCE(vip_level, 0) > 0 AND (vip_until IS NULL OR vip_until <= ?)`, [new Date().toISOString()]);
    for (const u of expired) {
      await run('UPDATE users SET vip_level = 0 WHERE id = ?', [u.id]);
      notifyMemberStats(u.id);
    }
  } catch (e) { console.error('expireVipSubscriptions error:', e.message); }
}
setTimeout(expireVipSubscriptions, 15000).unref();
setInterval(expireVipSubscriptions, 60 * 60 * 1000).unref();

// بطاقات العضو: الثروة / الرواج / VIP
app.get('/api/users/:id/member-card', async (req, res) => {
  try {
    const u = await get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, cards: memberLevels.buildCards(u) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// باقات VIP المتاحة للشراء
app.get('/api/vip/plans', async (req, res) => {
  try {
    const plans = await all('SELECT level, name, price_diamonds, duration_days FROM vip_plans WHERE is_active = 1 ORDER BY level ASC');
    const uid = req.headers['x-user-id'];
    const u = uid ? await get('SELECT vip_level, vip_until, diamonds FROM users WHERE id = ?', [uid]) : null;
    res.json({
      success: true, plans,
      current: u ? { level: memberLevels.activeVipLevel(u), until: u.vip_until || null, days_left: memberLevels.vipDaysLeft(u) } : null,
      diamonds: u ? u.diamonds : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// شراء VIP بالألماس
app.post('/api/vip/buy', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const level = Math.floor(Number(req.body && req.body.level));
    const plan = await get('SELECT * FROM vip_plans WHERE level = ? AND is_active = 1', [level]);
    if (!plan) return res.status(400).json({ error: 'باقة VIP غير متاحة' });

    const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const active = memberLevels.activeVipLevel(user);
    if (active > plan.level) {
      return res.status(400).json({ error: `لديك VIP${active} فعّال بالفعل، يمكنك تجديده أو الترقية لمستوى أعلى 👑` });
    }

    // خصم ذرّي: لا يمر إلا إذا الرصيد كافٍ
    const paid = await run('UPDATE users SET diamonds = diamonds - ? WHERE id = ? AND diamonds >= ?', [plan.price_diamonds, userId, plan.price_diamonds]);
    if (!paid.changes) return res.status(400).json({ error: 'عفواً، رصيد الألماس غير كافٍ! اشحن ألماساتك أولاً 💎' });

    const now = Date.now();
    const startedAt = active === plan.level ? user.vip_until : new Date(now).toISOString();
    const expiresAt = memberLevels.computeVipExpiry(user, plan.level, plan.duration_days, now);
    await run('UPDATE users SET vip_level = ?, vip_until = ? WHERE id = ?', [plan.level, expiresAt, userId]);
    await run(`
      INSERT INTO vip_subscriptions (id, user_id, level, duration_days, price_diamonds, source, started_at, expires_at)
      VALUES (?, ?, ?, ?, ?, 'purchase', ?, ?)
    `, [`vip-${now}-${uuidv4().slice(0, 6)}`, userId, plan.level, plan.duration_days, plan.price_diamonds, startedAt, expiresAt]);

    // الإنفاق على VIP يرفع نقاط الثروة
    const settings = await getPointSettings();
    const pts = memberLevels.pointsForAmount(plan.price_diamonds, 'diamonds', settings);
    await addMemberPoints(userId, 'wealth', pts);
    await logMemberActivity({
      user_id: userId, type: 'vip_purchase', ref_id: plan.level, ref_name: plan.name,
      amount: plan.price_diamonds, currency: 'diamonds', points: pts, points_kind: 'wealth'
    });

    const fresh = await get('SELECT * FROM users WHERE id = ?', [userId]);
    const set = userSockets.get(userId);
    if (set) for (const sId of set) io.to(sId).emit('balance_updated', { coins: fresh.coins, diamonds: fresh.diamonds, level: fresh.level });
    notifyMemberStats(userId);

    res.json({
      success: true,
      vip: { level: plan.level, until: expiresAt, days_left: memberLevels.vipDaysLeft(fresh) },
      diamonds: fresh.diamonds,
      cards: memberLevels.buildCards(fresh)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ───── لوحة الإدارة: نشاط الأعضاء والمستويات وVIP ─────
app.get('/api/admin/vip-plans', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    res.json({ success: true, plans: await all('SELECT * FROM vip_plans ORDER BY level ASC') });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/vip-plans/:level', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const level = Math.floor(Number(req.params.level));
    if (!(level >= 1 && level <= 99)) return res.status(400).json({ error: 'مستوى VIP غير صالح (1 - 99)' });
    const b = req.body || {};
    const name = String(b.name || `VIP ${level}`).trim().slice(0, 40) || `VIP ${level}`;
    const price = Math.max(0, Math.min(100000000, Math.floor(Number(b.price_diamonds)) || 0));
    const days = Math.max(1, Math.min(3650, Math.floor(Number(b.duration_days)) || 30));
    const active = b.is_active === false || b.is_active === 0 || b.is_active === '0' ? 0 : 1;
    await run(`
      INSERT INTO vip_plans (level, name, price_diamonds, duration_days, is_active) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(level) DO UPDATE SET name = excluded.name, price_diamonds = excluded.price_diamonds,
        duration_days = excluded.duration_days, is_active = excluded.is_active
    `, [level, name, price, days, active]);
    res.json({ success: true, plan: await get('SELECT * FROM vip_plans WHERE level = ?', [level]) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// منح أو سحب VIP يدوياً (level = 0 يعني سحب الاشتراك)
app.post('/api/admin/users/:id/vip', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const { id } = req.params;
    const user = await get('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const level = Math.max(0, Math.min(99, Math.floor(Number(req.body && req.body.level)) || 0));
    if (level === 0) {
      await run('UPDATE users SET vip_level = 0, vip_until = NULL WHERE id = ?', [id]);
    } else {
      const days = Math.max(1, Math.min(3650, Math.floor(Number(req.body && req.body.days)) || 30));
      const now = Date.now();
      const active = memberLevels.activeVipLevel(user);
      const startedAt = active === level ? user.vip_until : new Date(now).toISOString();
      const expiresAt = memberLevels.computeVipExpiry(user, level, days, now);
      await run('UPDATE users SET vip_level = ?, vip_until = ? WHERE id = ?', [level, expiresAt, id]);
      await run(`
        INSERT INTO vip_subscriptions (id, user_id, level, duration_days, price_diamonds, source, started_at, expires_at)
        VALUES (?, ?, ?, ?, 0, 'admin', ?, ?)
      `, [`vip-${now}-${uuidv4().slice(0, 6)}`, id, level, days, startedAt, expiresAt]);
      await logMemberActivity({ user_id: id, type: 'vip_grant', ref_id: level, ref_name: `VIP ${level}`, quantity: days });
    }
    notifyMemberStats(id);
    const fresh = await get('SELECT * FROM users WHERE id = ?', [id]);
    res.json({ success: true, vip: { level: memberLevels.activeVipLevel(fresh), until: fresh.vip_until || null, days_left: memberLevels.vipDaysLeft(fresh) } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// سجل النشاط (هدايا مرسلة/مستلمة، شراء VIP)
app.get('/api/admin/member-activity', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const type = String(req.query.type || 'all');
    const q = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(500, Math.floor(Number(req.query.limit)) || 100));
    let sql = `
      SELECT a.*, u.name AS user_name, u.avatar AS user_avatar, o.name AS other_name
      FROM member_activity a
      LEFT JOIN users u ON u.id = a.user_id
      LEFT JOIN users o ON o.id = a.other_user_id
      WHERE 1=1`;
    const params = [];
    if (type !== 'all') { sql += ' AND a.type = ?'; params.push(type); }
    if (q) { sql += ' AND (u.name LIKE ? OR a.user_id LIKE ? OR o.name LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    sql += ' ORDER BY a.created_at DESC, a.rowid DESC LIMIT ?';
    params.push(limit);
    res.json({ success: true, activity: await all(sql, params) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ملخص الأعضاء: النقاط والمستويات وVIP وعدد الهدايا
app.get('/api/admin/members-levels', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const q = String(req.query.q || '').trim();
    let sql = `
      SELECT u.id, u.name, u.avatar, u.coins, u.diamonds, u.wealth_points, u.wealth_level, u.popularity_points, u.charm_level,
             u.vip_level, u.vip_until,
             (SELECT COUNT(*) FROM member_activity a WHERE a.user_id = u.id AND a.type = 'gift_sent') AS gifts_sent,
             (SELECT COUNT(*) FROM member_activity a WHERE a.user_id = u.id AND a.type = 'gift_received') AS gifts_received
      FROM users u WHERE 1=1`;
    const params = [];
    if (q) { sql += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.id LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    sql += ' ORDER BY COALESCE(u.wealth_points, 0) + COALESCE(u.popularity_points, 0) DESC LIMIT 100';
    const rows = await all(sql, params);
    const now = Date.now();
    const members = rows.map(r => ({
      ...r,
      vip_active_level: memberLevels.activeVipLevel(r, now),
      vip_days_left: memberLevels.vipDaysLeft(r, now)
    }));
    const tot = await get(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE COALESCE(vip_level, 0) > 0 AND vip_until > ?) AS vip_members,
        (SELECT COUNT(*) FROM member_activity WHERE type = 'gift_sent') AS gifts_sent,
        (SELECT COUNT(*) FROM member_activity WHERE type = 'vip_purchase') AS vip_purchases,
        (SELECT COALESCE(SUM(amount), 0) FROM member_activity WHERE type = 'vip_purchase') AS vip_revenue
    `, [new Date(now).toISOString()]);
    res.json({ success: true, members, totals: tot });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/settings/points', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try { res.json({ success: true, settings: await getPointSettings() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/settings/points', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const clamp = (v, d) => String(Math.min(1000000, Math.max(1, Math.floor(Number(v)) || d)));
    const b = req.body || {};
    await run(`INSERT INTO app_settings (key, value) VALUES ('coins_per_point', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [clamp(b.coins_per_point, 10)]);
    await run(`INSERT INTO app_settings (key, value) VALUES ('diamonds_per_point', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [clamp(b.diamonds_per_point, 1)]);
    res.json({ success: true, settings: await getPointSettings() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 21. Send Gift (in Room or Direct)
app.post('/api/gifts/send', async (req, res) => {
  try {
    const senderId = req.headers['x-user-id'];
    if (!senderId) return res.status(401).json({ error: 'Unauthorized' });

    const { receiver_id, room_id, gift_id } = req.body;
    if (!receiver_id) {
      return res.status(400).json({ error: 'يرجى تحديد الشخص المستلم للهدية أولاً! 👤🎁' });
    }

    const gift = await getGiftById(gift_id);
    if (!gift) return res.status(400).json({ error: 'Invalid gift' });

    const sender = await get('SELECT * FROM users WHERE id = ?', [senderId]);
    if (!sender) return res.status(404).json({ error: 'Sender not found' });

    // Check balance
    if (gift.currency === 'coins') {
      if (sender.coins < gift.cost) {
        return res.status(400).json({ error: 'عفواً، رصيد العملات غير كافٍ! اشحن الآن أو احصل على مكافأتك اليومية 🪙' });
      }
      await run('UPDATE users SET coins = coins - ? WHERE id = ?', [gift.cost, senderId]);
    } else {
      if (sender.diamonds < gift.cost) {
        return res.status(400).json({ error: 'عفواً، رصيد الألماس غير كافٍ! اشحن ألماساتك لإرسال هدايا فاخرة 💎' });
      }
      await run('UPDATE users SET diamonds = diamonds - ? WHERE id = ?', [gift.cost, senderId]);
    }

    // مكافأة المستلم بالعملات (الرواج يُحسب بالنقاط بعد تسجيل الهدية)
    if (receiver_id) {
      await run('UPDATE users SET coins = coins + ? WHERE id = ?', [Math.floor(gift.cost * 0.4), receiver_id]);
    }

    // Record gift history (Saved in receiver's gifts wall)
    const historyId = `gift-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await run(`
      INSERT INTO gifts_history (id, sender_id, receiver_id, room_id, gift_id, gift_name, gift_icon, cost, currency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [historyId, senderId, receiver_id, room_id, gift.id, gift.name, gift.image_url || gift.icon, gift.cost, gift.currency]);

    // تسجيل النشاط والنقاط: المُرسل ← ثروة، المستلم ← رواج (لا رواج عند إهداء النفس)
    try {
      const ptSettings = await getPointSettings();
      const pts = memberLevels.pointsForAmount(gift.cost, gift.currency, ptSettings);
      await addMemberPoints(senderId, 'wealth', pts);
      await logMemberActivity({ user_id: senderId, type: 'gift_sent', other_user_id: receiver_id, ref_id: gift.id, ref_name: gift.name,
        amount: gift.cost, currency: gift.currency, points: pts, points_kind: 'wealth', room_id });
      if (receiver_id !== senderId) {
        await addMemberPoints(receiver_id, 'popularity', pts);
        await logMemberActivity({ user_id: receiver_id, type: 'gift_received', other_user_id: senderId, ref_id: gift.id, ref_name: gift.name,
          amount: gift.cost, currency: gift.currency, points: pts, points_kind: 'popularity', room_id });
        notifyMemberStats(receiver_id);
      }
      notifyMemberStats(senderId);
    } catch (e) { console.error('member activity error:', e.message); }

    const updatedSender = await get('SELECT * FROM users WHERE id = ?', [senderId]);
    const receiver = receiver_id ? await get('SELECT id, name, avatar, charm_level FROM users WHERE id = ?', [receiver_id]) : null;

    const giftEventPayload = {
      gift,
      sender: { id: sender.id, name: sender.name, avatar: sender.avatar },
      receiver,
      room_id,
      timestamp: Date.now()
    };

    // Notify all clients so receiver's gifts wall updates in real time
    io.emit('user_gift_received', giftEventPayload);

    // هدية من داخل المحادثة الخاصة (بدون غرفة): تُسجَّل كرسالة خاصة بين الطرفين فقط ولا تظهر في أي غرفة
    let dmMessage = null;
    if (!room_id) {
      try {
        const iconTxt = (gift.icon && !/^(\/|https?:)/i.test(String(gift.icon))) ? ` ${gift.icon}` : '';
        const dmText = `أرسل هدية ${gift.name}${iconTxt}`;
        const dmId = `msg-${Date.now().toString()}-${uuidv4().slice(0, 4)}`;
        await run(`
          INSERT INTO messages (id, sender_id, receiver_id, message_type, content, metadata)
          VALUES (?, ?, ?, 'gift', ?, ?)
        `, [dmId, senderId, receiver_id, dmText, JSON.stringify(gift)]);
        dmMessage = await get(`
          SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
          FROM messages m JOIN users u ON m.sender_id = u.id
          WHERE m.id = ?
        `, [dmId]);
        const rSockets = userSockets.get(receiver_id);
        if (rSockets && dmMessage) for (const sockId of rSockets) io.to(sockId).emit('private_message', dmMessage);
      } catch (e) { console.error('DM gift message error:', e.message); }
    }

    // Broadcast in room
    if (room_id) {
      io.to(`room:${room_id}`).emit('room_gift_sent', giftEventPayload);

      // إشعار عام لكل المتصلين (في أي غرفة) للهدايا التي فعّلت لها الإدارة خيار «إشعار عام»
      // يُنشأ من السيرفر فقط بعد خصم الرصيد، والنقر عليه يُدخل المستخدم إلى هذه الغرفة
      if (gift.banner_enabled) {
        try {
          const roomRow = await get('SELECT id, title FROM rooms WHERE id = ?', [room_id]);
          io.emit('global_gift_banner', {
            id: `gb-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            room_id,
            room_title: roomRow ? roomRow.title : '',
            gift,
            sender: { id: sender.id, name: sender.name, avatar: sender.avatar },
            receiver: receiver ? { id: receiver.id, name: receiver.name } : null,
            timestamp: Date.now()
          });
        } catch (e) { console.error('global gift banner error:', e.message); }
      }

      // Check if room has an active PK Battle: gifts directly increase the score and determine the winner!
      const roomState = activeRoomStates.get(room_id);
      if (roomState && roomState.pkState && roomState.pkState.active) {
        const isChallenger = receiver_id && (receiver_id === roomState.pkState.challenger?.id);
        const team = isChallenger ? 'challenger' : 'host';
        const points = gift.cost;

        if (team === 'host') {
          roomState.pkState.hostScore += points;
        } else {
          roomState.pkState.challengerScore += points;
        }

        io.to(`room:${room_id}`).emit('pk_score_updated', {
          hostScore: roomState.pkState.hostScore,
          challengerScore: roomState.pkState.challengerScore,
          user: { id: sender.id, name: sender.name, avatar: sender.avatar },
          team,
          points,
          gift
        });
      }

      // Also record message in room chat
      const msgId = `msg-${Date.now()}`;
      const giftNotice = `أرسل ${gift.name} ${gift.icon} إلى ${receiver ? receiver.name : 'الجميع'}`;
      await run(`
        INSERT INTO messages (id, sender_id, room_id, message_type, content, metadata)
        VALUES (?, ?, ?, 'gift', ?, ?)
      `, [msgId, senderId, room_id, giftNotice, JSON.stringify(gift)]);

      io.to(`room:${room_id}`).emit('room_message', {
        id: msgId,
        sender_id: sender.id,
        sender_name: sender.name,
        sender_avatar: sender.avatar,
        sender_frame: sender.avatar_frame,
        sender_level: sender.level,
        message_type: 'gift',
        content: giftNotice,
        metadata: gift,
        created_at: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      gift,
      sender: updatedSender,
      receiver,
      message: dmMessage
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 21a. كيس الحظ (Lucky Bag) — يُرسل بالكرستالات (الألماس) ويُلتقط من أعضاء الغرفة
// ==========================================
const luckyBags = new Map(); // bagId -> bag
const LUCKY_BAG_AMOUNTS = [500, 2000, 5000];
const LUCKY_BAG_SHARES = 10;
const LUCKY_BAG_LIFETIME_MS = 10 * 60 * 1000;

function publicLuckyBag(b) {
  return {
    id: b.id, room_id: b.roomId, sender: b.sender, total: b.total,
    shares: b.shares, sharesLeft: b.sharesLeft, open_at: b.openAt,
    expires_at: b.expiresAt, claims: b.claims
  };
}

app.post('/api/lucky-bag/send', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { room_id } = req.body || {};
    const amount = parseInt(req.body?.amount, 10);
    const delayMs = req.body?.delay === 120 ? 120000 : 0;
    if (!room_id) return res.status(400).json({ error: 'يجب أن تكون داخل غرفة لإرسال كيس الحظ' });
    if (!LUCKY_BAG_AMOUNTS.includes(amount)) return res.status(400).json({ error: 'عدد الكريستال غير صالح' });

    const sender = await get('SELECT id, name, avatar FROM users WHERE id = ?', [userId]);
    if (!sender) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const paid = await run('UPDATE users SET diamonds = diamonds - ? WHERE id = ? AND diamonds >= ?', [amount, userId, amount]);
    if (!paid.changes) return res.status(400).json({ error: 'عفواً، رصيد الكريستال غير كافٍ! اشحن ألماساتك أولاً 💎' });
    try {
      const pts = memberLevels.pointsForAmount(amount, 'diamonds', await getPointSettings());
      await addMemberPoints(userId, 'wealth', pts);
      await logMemberActivity({ user_id: userId, type: 'lucky_bag', ref_name: 'كيس الحظ', amount, currency: 'diamonds', points: pts, points_kind: 'wealth', room_id });
      notifyMemberStats(userId);
    } catch (e) { console.error('lucky bag points error:', e.message); }

    const now = Date.now();
    const bag = {
      id: `bag-${now}-${Math.floor(Math.random() * 1e4)}`,
      roomId: room_id, sender, total: amount, remaining: amount,
      shares: LUCKY_BAG_SHARES, sharesLeft: LUCKY_BAG_SHARES,
      openAt: now + delayMs, expiresAt: now + delayMs + LUCKY_BAG_LIFETIME_MS,
      claims: [], claimedBy: new Set()
    };
    luckyBags.set(bag.id, bag);

    setTimeout(async () => {
      const b = luckyBags.get(bag.id);
      if (!b) return;
      luckyBags.delete(bag.id);
      if (b.remaining > 0) {
        try { await run('UPDATE users SET diamonds = diamonds + ? WHERE id = ?', [b.remaining, b.sender.id]); } catch (e) {}
      }
      io.to(`room:${b.roomId}`).emit('lucky_bag_expired', { bagId: b.id, refunded: b.remaining });
    }, delayMs + LUCKY_BAG_LIFETIME_MS);

    io.to(`room:${room_id}`).emit('lucky_bag_created', publicLuckyBag(bag));
    const updated = await get('SELECT * FROM users WHERE id = ?', [userId]);
    res.json({ success: true, bag: publicLuckyBag(bag), user: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/lucky-bag/room/:roomId', (req, res) => {
  const list = [];
  luckyBags.forEach(b => { if (b.roomId === req.params.roomId && b.sharesLeft > 0) list.push(publicLuckyBag(b)); });
  res.json(list);
});

app.post('/api/lucky-bag/:id/claim', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const bag = luckyBags.get(req.params.id);
    if (!bag || bag.sharesLeft <= 0) return res.status(404).json({ error: 'انتهى كيس الحظ، حظاً أوفر المرة القادمة 🍀' });
    if (Date.now() < bag.openAt) return res.status(400).json({ error: 'لم يحن وقت فتح الكيس بعد ⏳' });
    if (bag.sender.id === userId) return res.status(400).json({ error: 'لا يمكنك التقاط كيس الحظ الذي أرسلته' });
    if (bag.claimedBy.has(userId)) return res.status(400).json({ error: 'التقطت حصتك من هذا الكيس بالفعل' });

    // توزيع عشوائي عادل: الحصة الأخيرة تأخذ ما تبقى
    let share;
    if (bag.sharesLeft === 1) share = bag.remaining;
    else {
      const avg = bag.remaining / bag.sharesLeft;
      share = Math.max(1, Math.min(bag.remaining - (bag.sharesLeft - 1), Math.floor(Math.random() * avg * 2) + 1));
    }
    bag.remaining -= share;
    bag.sharesLeft -= 1;
    bag.claimedBy.add(userId);

    await run('UPDATE users SET diamonds = diamonds + ? WHERE id = ?', [share, userId]);
    const user = await get('SELECT id, name, avatar FROM users WHERE id = ?', [userId]);
    bag.claims.push({ user, amount: share });

    io.to(`room:${bag.roomId}`).emit('lucky_bag_claimed', { bagId: bag.id, user, amount: share, sharesLeft: bag.sharesLeft });
    if (bag.sharesLeft <= 0) luckyBags.delete(bag.id);

    const updated = await get('SELECT * FROM users WHERE id = ?', [userId]);
    res.json({ success: true, amount: share, user: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 21b. Get User's Received Gifts ("هداياه")
app.get('/api/users/:id/gifts', async (req, res) => {
  try {
    const userId = req.params.id;
    const summary = await all(`
      SELECT gift_id, gift_name, gift_icon, cost, currency, COUNT(*) as count, MAX(created_at) as last_received_at
      FROM gifts_history
      WHERE receiver_id = ?
      GROUP BY gift_id
      ORDER BY count DESC, cost DESC
    `, [userId]);

    const recent = await all(`
      SELECT gh.*, u.name as sender_name, u.avatar as sender_avatar
      FROM gifts_history gh
      LEFT JOIN users u ON gh.sender_id = u.id
      WHERE gh.receiver_id = ?
      ORDER BY gh.created_at DESC
      LIMIT 30
    `, [userId]);

    // المرسلون لكل هدية مع الكمية التي أرسلها كل واحد
    const senderRows = await all(`
      SELECT gh.gift_id, gh.sender_id, COUNT(*) as qty, MAX(gh.created_at) as last_at,
             u.name as sender_name, u.avatar as sender_avatar
      FROM gifts_history gh
      LEFT JOIN users u ON gh.sender_id = u.id
      WHERE gh.receiver_id = ?
      GROUP BY gh.gift_id, gh.sender_id
      ORDER BY qty DESC, last_at DESC
    `, [userId]);
    const sendersByGift = {};
    senderRows.forEach(r => {
      (sendersByGift[r.gift_id] = sendersByGift[r.gift_id] || []).push({
        sender_id: r.sender_id,
        sender_name: r.sender_name || 'مستخدم محذوف',
        sender_avatar: r.sender_avatar || '',
        qty: r.qty,
        last_at: r.last_at
      });
    });
    summary.forEach(g => { g.senders = sendersByGift[g.gift_id] || []; });

    const totalCount = summary.reduce((acc, g) => acc + (g.count || 0), 0);
    const totalValue = summary.reduce((acc, g) => acc + ((g.cost || 0) * (g.count || 0)), 0);

    res.json({
      summary,
      recent,
      totalCount,
      totalValue
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 21c. Toggle Favorite Rooms ("المفضلة")
app.post('/api/rooms/:id/favorite', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.body?.user_id;
    const roomId = req.params.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const existing = await get('SELECT * FROM favorite_rooms WHERE user_id = ? AND room_id = ?', [userId, roomId]);
    let favorited = false;
    if (existing) {
      await run('DELETE FROM favorite_rooms WHERE user_id = ? AND room_id = ?', [userId, roomId]);
      favorited = false;
    } else {
      await run('INSERT INTO favorite_rooms (user_id, room_id) VALUES (?, ?)', [userId, roomId]);
      favorited = true;
    }

    const rows = await all('SELECT room_id FROM favorite_rooms WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    const fanRow = await get('SELECT COUNT(*) AS c FROM favorite_rooms WHERE room_id = ?', [roomId]);
    if (favorited) {
      try {
        const favRoom = await get('SELECT id, title, host_id FROM rooms WHERE id = ?', [roomId]);
        const favUser = await get('SELECT name, avatar FROM users WHERE id = ?', [userId]);
        if (favRoom && favUser) {
          io.to(`room:${roomId}`).emit('room_message', {
            id: `sys-fav-${Date.now()}`,
            sender_id: 'system',
            sender_name: '❤️ المفضلة',
            sender_avatar: favUser.avatar,
            sender_level: 1,
            message_type: 'system',
            content: `${favUser.name} أضاف الغرفة إلى المفضلة ❤️`,
            created_at: new Date().toISOString()
          });
          const hostSockets = userSockets.get(favRoom.host_id);
          if (hostSockets) hostSockets.forEach(sid => io.to(sid).emit('room_favorited', {
            roomId, roomTitle: favRoom.title, userName: favUser.name, userAvatar: favUser.avatar, fanCount: fanRow.c
          }));
        }
      } catch (e) { console.error('favorite notify error:', e); }
    }
    res.json({
      success: true,
      favorited,
      fan_count: fanRow.c,
      favoriteRoomIds: rows.map(r => r.room_id)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// نظام المتابعة (Follow) + الإشعارات
// ==========================================
function emitToUser(userId, event, payload) {
  const set = userSockets.get(userId);
  if (set) set.forEach(sid => io.to(sid).emit(event, payload));
}

async function followCounts(userId) {
  const a = await get('SELECT COUNT(*) AS c FROM follows WHERE following_id = ?', [userId]);
  const b = await get('SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?', [userId]);
  return { followers_count: a.c, following_count: b.c };
}

// متابعة مستخدم
app.post('/api/users/:id/follow', async (req, res) => {
  try {
    const viewerId = req.headers['x-user-id'];
    const targetId = req.params.id;
    if (!viewerId) return res.status(401).json({ error: 'Unauthorized' });
    if (viewerId === targetId) return res.status(400).json({ error: 'لا يمكنك متابعة نفسك' });
    const viewer = await get('SELECT id, name, avatar FROM users WHERE id = ?', [viewerId]);
    const target = await get('SELECT id FROM users WHERE id = ?', [targetId]);
    if (!viewer || !target) return res.status(404).json({ error: 'User not found' });

    const exists = await get('SELECT 1 AS x FROM follows WHERE follower_id = ? AND following_id = ?', [viewerId, targetId]);
    if (!exists) {
      await run('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)', [viewerId, targetId]);
      const notifId = `notif-${uuidv4()}`;
      const createdAt = new Date().toISOString();
      await run(
        'INSERT INTO notifications (id, user_id, type, actor_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [notifId, targetId, 'follow', viewerId, 'قام بمتابعتك', createdAt]
      );
      const followsBack = await get('SELECT 1 AS x FROM follows WHERE follower_id = ? AND following_id = ?', [targetId, viewerId]);
      emitToUser(targetId, 'new_notification', {
        id: notifId, type: 'follow', content: 'قام بمتابعتك', created_at: createdAt, is_read: 0,
        actor_id: viewer.id, actor_name: viewer.name, actor_avatar: viewer.avatar,
        is_following_actor: !!followsBack
      });
      emitToUser(targetId, 'follow_stats_changed', { userId: targetId });
    }
    const counts = await followCounts(targetId);
    res.json({ success: true, is_following: true, ...counts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// إلغاء المتابعة
app.delete('/api/users/:id/follow', async (req, res) => {
  try {
    const viewerId = req.headers['x-user-id'];
    const targetId = req.params.id;
    if (!viewerId) return res.status(401).json({ error: 'Unauthorized' });
    await run('DELETE FROM follows WHERE follower_id = ? AND following_id = ?', [viewerId, targetId]);
    // نزيل إشعار المتابعة القديم حتى لا يتكرر عند إعادة المتابعة
    await run("DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = 'follow'", [targetId, viewerId]);
    emitToUser(targetId, 'follow_stats_changed', { userId: targetId });
    const counts = await followCounts(targetId);
    res.json({ success: true, is_following: false, ...counts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// إبلاغ عن مستخدم (من نافذة الملف الشخصي داخل الغرفة)
app.post('/api/users/:id/report', async (req, res) => {
  try {
    const viewerId = req.headers['x-user-id'];
    const targetId = req.params.id;
    if (!viewerId) return res.status(401).json({ error: 'Unauthorized' });
    if (viewerId === targetId) return res.status(400).json({ error: 'لا يمكنك الإبلاغ عن نفسك' });
    const reason = String((req.body && req.body.reason) || '').slice(0, 300);
    const roomId = String((req.body && req.body.room_id) || '').slice(0, 100) || null;
    await run('INSERT INTO user_reports (reporter_id, reported_id, room_id, reason) VALUES (?, ?, ?, ?)', [viewerId, targetId, roomId, reason]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// إضافة إلى قائمة الحظر (ويلغي المتابعة بين الطرفين)
app.post('/api/users/:id/block', async (req, res) => {
  try {
    const viewerId = req.headers['x-user-id'];
    const targetId = req.params.id;
    if (!viewerId) return res.status(401).json({ error: 'Unauthorized' });
    if (viewerId === targetId) return res.status(400).json({ error: 'لا يمكنك حظر نفسك' });
    await run('INSERT OR IGNORE INTO user_blocks (user_id, blocked_id) VALUES (?, ?)', [viewerId, targetId]);
    await run('DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)', [viewerId, targetId, targetId, viewerId]);
    emitToUser(targetId, 'follow_stats_changed', { userId: targetId });
    emitToUser(viewerId, 'follow_stats_changed', { userId: viewerId });
    res.json({ success: true, blocked: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// حذف شخص من متابعيّ (يتوقف عن متابعتي)
app.delete('/api/users/:id/follower', async (req, res) => {
  try {
    const viewerId = req.headers['x-user-id'];
    const followerId = req.params.id;
    if (!viewerId) return res.status(401).json({ error: 'Unauthorized' });
    await run('DELETE FROM follows WHERE follower_id = ? AND following_id = ?', [followerId, viewerId]);
    emitToUser(viewerId, 'follow_stats_changed', { userId: viewerId });
    emitToUser(followerId, 'follow_stats_changed', { userId: followerId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// إحصائيات المتابعة لأي ملف شخصي (متاحة لأي زائر)
app.get('/api/users/:id/follow-stats', async (req, res) => {
  try {
    const viewerId = req.headers['x-user-id'] || '';
    const targetId = req.params.id;
    const counts = await followCounts(targetId);
    const f1 = viewerId ? await get('SELECT 1 AS x FROM follows WHERE follower_id = ? AND following_id = ?', [viewerId, targetId]) : null;
    const f2 = viewerId ? await get('SELECT 1 AS x FROM follows WHERE follower_id = ? AND following_id = ?', [targetId, viewerId]) : null;
    res.json({ ...counts, is_following: !!f1, follows_me: !!f2 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// قائمة المتابِعين / من يتابعهم — عامة: يراها أي زائر وليس صاحب الحساب فقط
async function listFollowRelations(req, res, mode) {
  try {
    const viewerId = req.headers['x-user-id'] || '';
    const targetId = req.params.id;
    const joinCol = mode === 'followers' ? 'f.follower_id' : 'f.following_id';
    const whereCol = mode === 'followers' ? 'f.following_id' : 'f.follower_id';
    const rows = await all(`
      SELECT u.id, u.name, u.avatar, u.avatar_frame, u.level, u.soul_planet, u.bio, u.gender, u.age,
             f.created_at AS followed_at,
             CASE WHEN vf.follower_id IS NULL THEN 0 ELSE 1 END AS is_following
      FROM follows f
      JOIN users u ON u.id = ${joinCol}
      LEFT JOIN follows vf ON vf.follower_id = ? AND vf.following_id = u.id
      WHERE ${whereCol} = ?
      ORDER BY f.created_at DESC
      LIMIT 500
    `, [viewerId, targetId]);
    res.json({ users: rows.map(r => ({ ...r, is_following: !!r.is_following, is_me: r.id === viewerId })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
app.get('/api/users/:id/followers', (req, res) => listFollowRelations(req, res, 'followers'));
app.get('/api/users/:id/following', (req, res) => listFollowRelations(req, res, 'following'));

// الأصدقاء = متابعة متبادلة
app.get('/api/users/:id/friends', async (req, res) => {
  try {
    const viewerId = req.headers['x-user-id'] || '';
    const targetId = req.params.id;
    const rows = await all(`
      SELECT u.id, u.name, u.avatar, u.avatar_frame, u.level, u.wealth_level, u.charm_level, u.vip_level, u.vip_until, u.gender, u.age, u.country_code,
             CASE WHEN vf.follower_id IS NULL THEN 0 ELSE 1 END AS is_following
      FROM follows a
      JOIN follows b ON b.follower_id = a.following_id AND b.following_id = a.follower_id
      JOIN users u ON u.id = a.following_id
      LEFT JOIN follows vf ON vf.follower_id = ? AND vf.following_id = u.id
      WHERE a.follower_id = ?
      ORDER BY a.created_at DESC
      LIMIT 500
    `, [viewerId, targetId]);
    res.json({ users: rows.map(r => ({ ...r, is_following: !!r.is_following, is_me: r.id === viewerId })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// تسجيل زيارة لملف شخصي (يتجاهل زيارة الشخص لصفحته)
app.post('/api/users/:id/visit', async (req, res) => {
  try {
    const visitorId = req.headers['x-user-id'];
    const ownerId = req.params.id;
    if (!visitorId || visitorId === ownerId) return res.json({ success: true, skipped: true });
    const owner = await get('SELECT id FROM users WHERE id = ?', [ownerId]);
    const visitor = await get('SELECT id FROM users WHERE id = ?', [visitorId]);
    if (!owner || !visitor) return res.json({ success: true, skipped: true });
    await run(`INSERT INTO profile_visits (visitor_id, owner_id) VALUES (?, ?)
      ON CONFLICT(visitor_id, owner_id) DO UPDATE SET visits = visits + 1, last_visited = CURRENT_TIMESTAMP`, [visitorId, ownerId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// أرقام صفحة «أنت»: الأصدقاء / أتابع / المتابعون / الزوار
app.get('/api/users/:id/profile-stats', async (req, res) => {
  try {
    const id = req.params.id;
    const counts = await followCounts(id);
    const fr = await get(`SELECT COUNT(*) AS c FROM follows a JOIN follows b ON b.follower_id = a.following_id AND b.following_id = a.follower_id WHERE a.follower_id = ?`, [id]);
    const vs = await get('SELECT COUNT(*) AS c FROM profile_visits WHERE owner_id = ?', [id]);
    let postsCount = 0;
    try { const pc = await get('SELECT COUNT(*) AS c FROM moments WHERE user_id = ?', [id]); postsCount = pc ? pc.c : 0; } catch (e) {}
    res.json({ ...counts, friends_count: fr.c, visitors_count: vs.c, posts_count: postsCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// زائرين صفحتي / زياراتي (لصاحب الحساب فقط)
async function listProfileVisits(req, res, mode) {
  try {
    const viewerId = req.headers['x-user-id'] || '';
    const targetId = req.params.id;
    if (!viewerId || viewerId !== targetId) return res.status(403).json({ error: 'غير مسموح' });
    const joinCol = mode === 'visitors' ? 'p.visitor_id' : 'p.owner_id';
    const whereCol = mode === 'visitors' ? 'p.owner_id' : 'p.visitor_id';
    const rows = await all(`
      SELECT u.id, u.name, u.avatar, u.avatar_frame, u.level, u.wealth_level, u.charm_level, u.vip_level, u.vip_until, u.gender, u.age, u.country_code,
             p.last_visited, p.visits,
             CASE WHEN vf.follower_id IS NULL THEN 0 ELSE 1 END AS is_following
      FROM profile_visits p
      JOIN users u ON u.id = ${joinCol}
      LEFT JOIN follows vf ON vf.follower_id = ? AND vf.following_id = u.id
      WHERE ${whereCol} = ?
      ORDER BY p.last_visited DESC
      LIMIT 200
    `, [viewerId, targetId]);
    const users = [];
    for (const r of rows) {
      let post_images = [];
      try {
        const ms = await all(`SELECT image_url FROM moments WHERE user_id = ? AND image_url IS NOT NULL AND image_url != '' ORDER BY created_at DESC LIMIT 2`, [r.id]);
        post_images = ms.map(m => m.image_url);
      } catch (e) { /* بدون صور */ }
      users.push({ ...r, is_following: !!r.is_following, is_online: !!(userSockets.get(r.id) && userSockets.get(r.id).size > 0), post_images });
    }
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
app.get('/api/users/:id/visitors', (req, res) => listProfileVisits(req, res, 'visitors'));
app.get('/api/users/:id/visits', (req, res) => listProfileVisits(req, res, 'visits'));

// الإشعارات
app.get('/api/notifications', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const rows = await all(`
      SELECT n.id, n.type, n.content, n.is_read, n.created_at, n.actor_id,
             u.name AS actor_name, u.avatar AS actor_avatar, u.avatar_frame AS actor_frame,
             CASE WHEN f.follower_id IS NULL THEN 0 ELSE 1 END AS is_following_actor
      FROM notifications n
      LEFT JOIN users u ON u.id = n.actor_id
      LEFT JOIN follows f ON f.follower_id = n.user_id AND f.following_id = n.actor_id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT 60
    `, [userId]);
    const unread = await get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0', [userId]);
    res.json({
      unread: unread.c,
      notifications: rows.map(r => ({ ...r, is_following_actor: !!r.is_following_actor }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications/read', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    await run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [userId]);
    res.json({ success: true, unread: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// مركز اهتماماتي (المفضلة / تم الانضمام / ما سبق / إدارتي) + المتابَعون في الغرف الآن
// ==========================================
function shapeInterestRooms(rows) {
  return rows.map(r => {
    const st = activeRoomStates.get(r.id);
    return {
      id: r.id, title: r.title, category: r.category, is_locked: r.is_locked ? 1 : 0,
      cover_image: r.cover_image || null, country_code: r.country_code, country_flag: r.country_flag,
      host_id: r.host_id, host_name: r.host_name, host_avatar: r.host_avatar, host_frame: r.host_frame,
      audience_count: st ? st.activeAudience.size : 0,
      at: r.at || null
    };
  });
}

// المتابَعون الموجودون في غرف الآن
async function getFollowedInRooms(userId) {
  const followingRows = await all('SELECT following_id FROM follows WHERE follower_id = ?', [userId]);
  const following = new Set(followingRows.map(r => r.following_id));
  if (!following.size) return { following, list: [] };
  const seen = new Map();
  for (const [roomId, st] of activeRoomStates.entries()) {
    for (const [uid, u] of st.activeAudience.entries()) {
      if (following.has(uid) && !seen.has(uid)) seen.set(uid, { user: u, roomId });
    }
  }
  const list = [];
  for (const [uid, v] of seen.entries()) {
    const room = await get('SELECT id, title, category FROM rooms WHERE id = ?', [v.roomId]);
    if (!room) continue;
    const st = activeRoomStates.get(v.roomId);
    list.push({
      id: uid, name: v.user.name, avatar: v.user.avatar, avatar_frame: v.user.avatar_frame || null,
      room_id: room.id, room_title: room.title, room_category: room.category,
      room_audience: st ? st.activeAudience.size : 0
    });
  }
  list.sort((a, b) => b.room_audience - a.room_audience);
  return { following, list };
}

// المتابَعون الموجودون الآن في غرف (لشريط الأشخاص فوق قائمة الغرف)
app.get('/api/following/in-rooms', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.json({ users: [] });
    const { list } = await getFollowedInRooms(userId);
    res.json({ users: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ملخص خفيف للفقاعة في تبويب الحفلة
app.get('/api/interests/summary', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.json({ count: 0, first: null });
    const { list } = await getFollowedInRooms(userId);
    res.json({ count: list.length, first: list[0] ? { name: list[0].name, avatar: list[0].avatar } : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/interests', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const base = `SELECT r.*, u.name AS host_name, u.avatar AS host_avatar, u.avatar_frame AS host_frame`;

    const favorites = shapeInterestRooms(await all(`${base}, f.created_at AS at FROM favorite_rooms f JOIN rooms r ON r.id = f.room_id JOIN users u ON u.id = r.host_id WHERE f.user_id = ? ORDER BY f.created_at DESC`, [userId]));
    const joined = shapeInterestRooms(await all(`${base}, m.last_joined AS at FROM room_members m JOIN rooms r ON r.id = m.room_id JOIN users u ON u.id = r.host_id WHERE m.user_id = ? ORDER BY m.last_joined DESC`, [userId]));
    const history = shapeInterestRooms(await all(`${base}, v.last_visited AS at FROM room_visits v JOIN rooms r ON r.id = v.room_id JOIN users u ON u.id = r.host_id WHERE v.user_id = ? ORDER BY v.last_visited DESC LIMIT 50`, [userId]));
    const managed = shapeInterestRooms(await all(`${base}, r.created_at AS at FROM rooms r JOIN users u ON u.id = r.host_id WHERE r.host_id = ? OR r.co_host_id = ? OR r.id IN (SELECT room_id FROM room_moderators WHERE user_id = ?) ORDER BY r.created_at DESC`, [userId, userId, userId]));

    const { following, list: followedInRooms } = await getFollowedInRooms(userId);

    // اقتراح 3 أشخاص متوافقين: الأكثر اشتراكاً في الاهتمامات، والمتواجدون في الغرف أولاً
    const me = await get('SELECT soul_tags FROM users WHERE id = ?', [userId]);
    const myTags = new Set(String((me && me.soul_tags) || '').split(',').map(t => t.trim()).filter(Boolean));
    const inRoom = new Map();
    for (const [roomId, st] of activeRoomStates.entries()) {
      for (const uid of st.activeAudience.keys()) if (!inRoom.has(uid)) inRoom.set(uid, roomId);
    }
    const others = await all('SELECT id, name, avatar, avatar_frame, soul_tags, country_code FROM users WHERE id != ? LIMIT 300', [userId]);
    const scored = others.filter(u => !following.has(u.id)).map(u => {
      const tags = String(u.soul_tags || '').split(',').map(t => t.trim()).filter(Boolean);
      const shared = tags.filter(t => myTags.has(t)).length;
      const roomId = inRoom.get(u.id) || null;
      const st = roomId ? activeRoomStates.get(roomId) : null;
      return { id: u.id, name: u.name, avatar: u.avatar, avatar_frame: u.avatar_frame, country_code: u.country_code,
        room_id: roomId, room_audience: st ? st.activeAudience.size : 0, score: shared * 10 + (roomId ? 5 : 0) };
    }).sort((a, b) => b.score - a.score).slice(0, 3);

    res.json({
      counts: { favorites: favorites.length, joined: joined.length, history: history.length, managed: managed.length },
      favorites, joined, history, managed,
      followed_in_rooms: followedInRooms,
      recommended: scored
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// إلغاء الانضمام لغرفة (زر "إلغاء" في تبويب تم الانضمام)
app.post('/api/rooms/:id/unjoin', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    await run('DELETE FROM room_members WHERE room_id = ? AND user_id = ?', [req.params.id, userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ADMIN CONTROL PANEL ROUTES & API
// ==========================================

// ==========================================
// أشخاص الغرفة: الأونلاين / الأعضاء / المشرفون / المطرودون / المكتومون / المعجبون
// ==========================================
async function canManageRoom(room, user) {
  if (!room || !user) return false;
  if (room.host_id === user.id) return true;
  if (['owner', 'super_master', 'super_admin', 'admin', 'moderator'].includes(user.role)) return true;
  const m = await get('SELECT 1 AS x FROM room_moderators WHERE room_id = ? AND user_id = ?', [room.id, user.id]);
  return !!m;
}
function isRoomOwnerLevel(room, user) {
  return !!(room && user && (room.host_id === user.id || ['owner', 'super_master', 'super_admin'].includes(user.role)));
}

app.get('/api/rooms/:id/people', async (req, res) => {
  try {
    const roomId = req.params.id;
    const room = await get('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (!room) return res.status(404).json({ error: 'الغرفة غير موجودة' });
    const uid = req.headers['x-user-id'];
    const viewer = uid ? await get('SELECT id, role FROM users WHERE id = ?', [uid]) : null;
    const manager = await canManageRoom(room, viewer);
    const ownerLevel = isRoomOwnerLevel(room, viewer);
    const cols = 'u.id, u.name, u.avatar, u.avatar_frame, u.level, u.wealth_level, u.role';
    const members = await all(`SELECT ${cols}, m.last_joined, m.visits FROM room_members m JOIN users u ON u.id = m.user_id WHERE m.room_id = ? ORDER BY m.last_joined DESC LIMIT 1000`, [roomId]);
    const total = await get('SELECT COUNT(*) AS c FROM room_members WHERE room_id = ?', [roomId]);
    const moderators = await all(`SELECT ${cols} FROM room_moderators d JOIN users u ON u.id = d.user_id WHERE d.room_id = ?`, [roomId]);
    const st = activeRoomStates.get(roomId);
    const online = st ? Array.from(st.activeAudience.values()) : [];
    const onlineIds = new Set(online.map(o => o.id));
    const left = members.filter(m => !onlineIds.has(m.id)); // دخلوا الغرفة ثم غادروها
    const out = { host_id: room.host_id, total_members: total.c, members, moderators, online, left, total_left: left.length, can_manage: manager, is_owner: ownerLevel };
    if (manager) {
      out.bans = await all(`SELECT ${cols} FROM room_restrictions r JOIN users u ON u.id = r.user_id WHERE r.room_id = ? AND r.type = 'ban'`, [roomId]);
      out.mutes = await all(`SELECT ${cols} FROM room_restrictions r JOIN users u ON u.id = r.user_id WHERE r.room_id = ? AND r.type = 'mute'`, [roomId]);
    }
    if (ownerLevel) {
      out.fans = await all(`SELECT ${cols}, f.created_at AS saved_at FROM favorite_rooms f JOIN users u ON u.id = f.user_id WHERE f.room_id = ? ORDER BY f.created_at DESC`, [roomId]);
      out.fan_count = out.fans.length;
    }
    res.json(out);
  } catch (err) {
    console.error('people error:', err);
    res.status(500).json({ error: 'تعذر تحميل القائمة' });
  }
});

// حالة شخص داخل الغرفة + صلاحية من يشاهده (لبطاقة المستخدم داخل الغرفة)
app.get('/api/rooms/:id/relation/:userId', async (req, res) => {
  try {
    const roomId = req.params.id;
    const room = await get('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (!room) return res.status(404).json({ error: 'الغرفة غير موجودة' });
    const uid = req.headers['x-user-id'];
    const viewer = uid ? await get('SELECT id, role FROM users WHERE id = ?', [uid]) : null;
    const target = req.params.userId;
    const q = async (sql) => !!(await get(sql, [roomId, target]));
    res.json({
      viewer_can_manage: await canManageRoom(room, viewer),
      viewer_is_owner: isRoomOwnerLevel(room, viewer),
      is_host: room.host_id === target,
      is_member: await q('SELECT 1 AS x FROM room_members WHERE room_id = ? AND user_id = ?'),
      is_moderator: await q('SELECT 1 AS x FROM room_moderators WHERE room_id = ? AND user_id = ?'),
      is_banned: await q("SELECT 1 AS x FROM room_restrictions WHERE room_id = ? AND user_id = ? AND type = 'ban'"),
      is_muted: await q("SELECT 1 AS x FROM room_restrictions WHERE room_id = ? AND user_id = ? AND type = 'mute'")
    });
  } catch (err) {
    res.status(500).json({ error: 'تعذر تحميل الحالة' });
  }
});

// دعوة عضو (إضافته لأعضاء الغرفة) / طرد عضو (إزالة عضويته)
app.post('/api/rooms/:id/members', async (req, res) => {
  try {
    const roomId = req.params.id;
    const room = await get('SELECT * FROM rooms WHERE id = ?', [roomId]);
    const viewer = req.headers['x-user-id'] ? await get('SELECT id, name, role FROM users WHERE id = ?', [req.headers['x-user-id']]) : null;
    if (!room || !(await canManageRoom(room, viewer))) return res.status(403).json({ error: 'ليس لديك صلاحية' });
    const { user_id, add } = req.body;
    const target = await get('SELECT id, name FROM users WHERE id = ?', [user_id]);
    if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (add) {
      await run(`INSERT INTO room_members (room_id, user_id) VALUES (?, ?)
        ON CONFLICT(room_id, user_id) DO NOTHING`, [roomId, user_id]);
    } else {
      await run('DELETE FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, user_id]);
    }
    res.json({ success: true, is_member: !!add });
  } catch (err) {
    res.status(500).json({ error: 'تعذر تحديث الأعضاء' });
  }
});

app.post('/api/rooms/:id/moderators', async (req, res) => {
  try {
    const roomId = req.params.id;
    const room = await get('SELECT * FROM rooms WHERE id = ?', [roomId]);
    const viewer = req.headers['x-user-id'] ? await get('SELECT id, name, role FROM users WHERE id = ?', [req.headers['x-user-id']]) : null;
    if (!room || !isRoomOwnerLevel(room, viewer)) return res.status(403).json({ error: 'فقط صاحب الغرفة يمكنه تعيين المشرفين' });
    const { user_id, add } = req.body;
    const target = await get('SELECT id, name FROM users WHERE id = ?', [user_id]);
    if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (add) await run('INSERT OR IGNORE INTO room_moderators (room_id, user_id) VALUES (?, ?)', [roomId, user_id]);
    else await run('DELETE FROM room_moderators WHERE room_id = ? AND user_id = ?', [roomId, user_id]);
    io.to(`room:${roomId}`).emit('room_message', {
      id: `sys-mod-${Date.now()}`, sender_id: 'system', sender_name: '🛡️ إدارة الغرفة', sender_avatar: viewer.avatar,
      sender_level: 99, message_type: 'system',
      content: add ? `تم تعيين ${target.name} مشرفاً في الغرفة 🛡️` : `تمت إزالة ${target.name} من المشرفين`,
      created_at: new Date().toISOString()
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'تعذر تحديث المشرفين' });
  }
});

app.post('/api/rooms/:id/restrictions/remove', async (req, res) => {
  try {
    const roomId = req.params.id;
    const room = await get('SELECT * FROM rooms WHERE id = ?', [roomId]);
    const viewer = req.headers['x-user-id'] ? await get('SELECT id, name, role FROM users WHERE id = ?', [req.headers['x-user-id']]) : null;
    if (!room || !(await canManageRoom(room, viewer))) return res.status(403).json({ error: 'ليس لديك صلاحية' });
    const { user_id, type } = req.body;
    if (!['ban', 'mute'].includes(type)) return res.status(400).json({ error: 'نوع غير صحيح' });
    await run('DELETE FROM room_restrictions WHERE room_id = ? AND user_id = ? AND type = ?', [roomId, user_id, type]);
    const st = activeRoomStates.get(roomId);
    if (st) (type === 'ban' ? st.bannedUsers : st.mutedChatUsers).delete(user_id);
    if (type === 'mute') {
      const t = await get('SELECT name FROM users WHERE id = ?', [user_id]);
      io.to(`room:${roomId}`).emit('user_chat_mute_changed', { roomId, targetUserId: user_id, targetUserName: t ? t.name : 'مستخدم', isMuted: false, adminName: viewer.name });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'تعذر فك القيد' });
  }
});

// Serve Admin Dashboard HTML
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 1. Admin Login (Username & Password)
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
    }

    // A. Check in admin_credentials table
    const cred = await get('SELECT * FROM admin_credentials WHERE username = ? AND password = ?', [username, password]);
    if (cred) {
      if (cred.role === 'admin') {
        return res.status(403).json({
          error: 'صلاحية دخول لوحة الإدارة مخصصة فقط للسوبر ادمن والسوبر ماستر والمالك! رتبة الأدمن تمتلك صلاحيات الإشراف داخل الغرف الصوتية فقط.'
        });
      }
      const token = `adm_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
      const role = cred.role || 'owner';
      adminSessions.set(token, { username: cred.username, role, loginTime: Date.now() });
      return res.json({
        success: true,
        token,
        admin: { username: cred.username, role }
      });
    }

    // Check if user has role 'admin' (strictly blocked from control panel)
    const adminRoleUser = await get("SELECT * FROM users WHERE (email = ? OR name = ? OR id = ?) AND role = 'admin'", [username, username, username]);
    if (adminRoleUser) {
      return res.status(403).json({
        error: 'صلاحية دخول لوحة الإدارة مخصصة فقط للسوبر ادمن والسوبر ماستر والمالك! رتبة الأدمن تمتلك صلاحيات الإشراف داخل الغرف الصوتية فقط.'
      });
    }

    // B. Check in users table for owner, super_master, or super_admin accounts ONLY
    const user = await get("SELECT * FROM users WHERE (email = ? OR name = ? OR id = ? OR (role = 'owner' AND ? IN ('owner', 'owner@gmail.com'))) AND (role IN ('owner', 'super_master', 'super_admin'))", [username, username, username, username]);
    if (user && (password === 'admin123456' || password === 'admin' || password === 'owner123' || password === 'owner123456' || password === 'owner')) {
      const token = `adm_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
      adminSessions.set(token, { username: user.name, role: user.role, userId: user.id, loginTime: Date.now() });
      return res.json({
        success: true,
        token,
        admin: { username: user.name, role: user.role, userId: user.id }
      });
    }

    return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة!' });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// دخول التطبيق بحساب السوبر الذي سجّل به الأدمن في لوحة الإدارة (لفتح الغرف مباشرة)
app.post('/api/admin/enter-as-user', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    let user = null;
    if (session.userId) {
      user = await get('SELECT * FROM users WHERE id = ?', [session.userId]);
    }
    if (!user && session.username) {
      user = await get(
        "SELECT * FROM users WHERE (name = ? OR email = ?) AND role IN ('owner','super_master','super_admin') LIMIT 1",
        [session.username, session.username]
      );
    }
    if (!user) {
      // حساب لوحة الإدارة غير مرتبط بمستخدم: نختار حساب الرتبة نفسها، ثم الأعلى رتبة
      const order = ['owner', 'super_master', 'super_admin'];
      const roles = session.role && order.includes(session.role)
        ? [session.role, ...order.filter(r => r !== session.role)]
        : order;
      for (const r of roles) {
        user = await get('SELECT * FROM users WHERE role = ? ORDER BY created_at ASC LIMIT 1', [r]);
        if (user) break;
      }
    }
    if (!user) return res.status(404).json({ error: 'لا يوجد حساب سوبر مرتبط بحساب الإدارة' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Check Admin Session
app.get('/api/admin/check-session', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) {
    return res.status(401).json({ error: 'جلسة الإدارة غير صالحة أو انتهت مدتها' });
  }
  res.json({ success: true, admin: session });
});

// 3. Admin Logout
app.post('/api/admin/logout', (req, res) => {
  const token = req.headers['x-admin-token'] || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  if (token && adminSessions.has(token)) {
    adminSessions.delete(token);
  }
  res.json({ success: true });
});

// 4. Admin Overview & Platform Statistics
app.get('/api/admin/stats', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });

  try {
    const totalUsersRow = await get('SELECT COUNT(*) as count FROM users');
    const totalRoomsRow = await get('SELECT COUNT(*) as count FROM rooms');
    const totalModsRow = await get("SELECT COUNT(*) as count FROM users WHERE role = 'moderator'");
    const totalCoinsRow = await get('SELECT SUM(coins) as total_coins, SUM(diamonds) as total_diamonds FROM users');
    const totalGiftsRow = await get('SELECT COUNT(*) as count, SUM(cost) as total_value FROM gifts_history');

    // Build real live rooms list with real occupant numbers
    const allRooms = await all(`
      SELECT r.*, u.name as host_name, u.avatar as host_avatar
      FROM rooms r
      JOIN users u ON r.host_id = u.id
      ORDER BY r.created_at DESC
    `);

    const liveRooms = [];
    for (const r of allRooms) {
      const roomState = activeRoomStates.get(r.id);
      const realOccupants = roomState ? roomState.activeAudience.size : 0;
      liveRooms.push({
        id: r.id,
        title: r.title,
        room_type: r.room_type,
        category: r.category,
        host_name: r.host_name,
        host_avatar: r.host_avatar,
        country_code: r.country_code,
        country_name: r.country_name,
        country_flag: r.country_flag,
        occupants_count: realOccupants,
        created_at: r.created_at
      });
    }

    res.json({
      success: true,
      stats: {
        totalUsers: totalUsersRow ? totalUsersRow.count : 0,
        totalRooms: totalRoomsRow ? totalRoomsRow.count : 0,
        onlineUsers: userSockets.size || onlineUsers.size,
        totalModerators: totalModsRow ? totalModsRow.count : 0,
        totalCoins: totalCoinsRow ? (totalCoinsRow.total_coins || 0) : 0,
        totalDiamonds: totalCoinsRow ? (totalCoinsRow.total_diamonds || 0) : 0,
        totalGiftsSent: totalGiftsRow ? (totalGiftsRow.count || 0) : 0,
        totalGiftsValue: totalGiftsRow ? (totalGiftsRow.total_value || 0) : 0,
        liveRooms
      }
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Admin Users List with Search & Filter
app.get('/api/admin/users', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });

  try {
    const q = req.query.q ? req.query.q.trim() : '';
    const role = req.query.role;
    let query = 'SELECT id, name, email, avatar, bio, gender, age, soul_planet, role, coins, diamonds, level, is_banned, created_at FROM users WHERE 1=1';
    const params = [];

    if (q) {
      query += ' AND (name LIKE ? OR email LIKE ? OR id LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (role && role !== 'all') {
      if (role === 'staff') {
        query += ' AND role IN ("super_master", "super_admin", "admin", "moderator")';
      } else {
        query += ' AND role = ?';
        params.push(role);
      }
    }

    query += ' ORDER BY created_at DESC';
    const users = await all(query, params);

    const list = users.map(u => ({
      ...u,
      is_online: userSockets.has(u.id) && userSockets.get(u.id).size > 0
    }));

    res.json({ success: true, users: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Appoint or Change User Role (Roles: 'super_master', 'super_admin', 'admin', 'user', 'owner')
app.post('/api/admin/users/:id/role', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });

  try {
    const { id } = req.params;
    const { role } = req.body; // 'super_master', 'super_admin', 'admin', 'user', 'owner', 'moderator'
    const allowed = ['super_master', 'super_admin', 'admin', 'moderator', 'owner', 'user'];
    if (!allowed.includes(role)) {
      return res.status(400).json({ error: 'الرتبة المحددة غير صحيحة' });
    }

    await run('UPDATE users SET role = ? WHERE id = ?', [role, id]);
    const updatedUser = await get('SELECT id, name, role, email, avatar FROM users WHERE id = ?', [id]);
    if (!updatedUser) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const roleTitles = {
      super_master: 'سوبر ماستر 💎',
      super_admin: 'سوبر ادمن ⚡',
      admin: 'ادمن للدردشة 🛡️',
      moderator: 'مشرف عام 🛡️',
      owner: 'مالك المنصة 👑',
      user: 'عضو عادي'
    };

    // Send real-time socket event to the user
    const userSocketSet = userSockets.get(id);
    if (userSocketSet && userSocketSet.size > 0) {
      for (const sId of userSocketSet) {
        io.to(sId).emit('user_role_updated', {
          role,
          roleTitle: roleTitles[role] || role,
          message: ['super_master', 'super_admin', 'admin', 'moderator', 'owner'].includes(role)
            ? `تهانينا! تم تعيينك برتبة [${roleTitles[role] || role}] على منصة SoulChill! 🪐✨`
            : 'تم تعديل رتبتك إلى عضو عادي.'
        });
      }
    }

    // Broadcast announcement if promoted to staff
    if (['super_master', 'super_admin', 'admin', 'moderator'].includes(role)) {
      io.emit('room_message', {
        id: `sys-mod-${Date.now()}`,
        sender_id: 'system',
        sender_name: '🛡️ الإدارة العليا',
        sender_avatar: updatedUser.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=300&q=80',
        sender_level: 99,
        message_type: 'system',
        content: `🎉 نبارك للعضو [${updatedUser.name}] تعيينه [${roleTitles[role] || role}] على المنصة! 🛡️✨`,
        created_at: new Date().toISOString()
      });
    }

    res.json({ success: true, user: updatedUser, roleTitle: roleTitles[role] || role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Update User Balance & Level
app.post('/api/admin/users/:id/balance', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });

  try {
    const { id } = req.params;
    const { coins, diamonds, level } = req.body;
    await run(`
      UPDATE users 
      SET coins = COALESCE(?, coins),
          diamonds = COALESCE(?, diamonds),
          level = COALESCE(?, level)
      WHERE id = ?
    `, [coins, diamonds, level, id]);

    const updatedUser = await get('SELECT id, name, coins, diamonds, level FROM users WHERE id = ?', [id]);
    if (!updatedUser) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const userSocketSet = userSockets.get(id);
    if (userSocketSet) {
      for (const sId of userSocketSet) {
        io.to(sId).emit('balance_updated', {
          coins: updatedUser.coins,
          diamonds: updatedUser.diamonds,
          level: updatedUser.level
        });
      }
    }

    res.json({ success: true, user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7b. إضافة رصيد (يُجمع على الرصيد الحالي) — تعبئة الأرصدة من الإدارة
app.post('/api/admin/users/:id/add-balance', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const { id } = req.params;
    const coins = Math.floor(Number((req.body || {}).coins || 0));
    const diamonds = Math.floor(Number((req.body || {}).diamonds || 0));
    if (!Number.isFinite(coins) || !Number.isFinite(diamonds) || coins < 0 || diamonds < 0 || (coins === 0 && diamonds === 0)) {
      return res.status(400).json({ success: false, message: 'أدخل كمية صحيحة (أكبر من صفر)' });
    }
    if (coins > 1000000000 || diamonds > 1000000000) {
      return res.status(400).json({ success: false, message: 'الكمية كبيرة جداً' });
    }
    const exists = await get('SELECT id FROM users WHERE id = ?', [id]);
    if (!exists) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    await run('UPDATE users SET coins = coins + ?, diamonds = diamonds + ? WHERE id = ?', [coins, diamonds, id]);
    const updated = await get('SELECT id, name, coins, diamonds, level FROM users WHERE id = ?', [id]);
    const set = userSockets.get(id);
    if (set) {
      for (const sId of set) {
        io.to(sId).emit('balance_updated', {
          coins: updated.coins, diamonds: updated.diamonds, level: updated.level,
          added: { coins, diamonds }
        });
      }
    }
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Ban or Unban User
app.post('/api/admin/users/:id/ban', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });

  try {
    const { id } = req.params;
    const { is_banned } = req.body;
    await run('UPDATE users SET is_banned = ? WHERE id = ?', [is_banned ? 1 : 0, id]);

    if (is_banned) {
      // Disconnect all active sockets for this user immediately
      const userSocketSet = userSockets.get(id);
      if (userSocketSet) {
        for (const sId of userSocketSet) {
          const s = io.sockets.sockets.get(sId);
          if (s) {
            s.emit('account_banned_notice', { message: 'لقد تم حظر حسابك من قبل إدارة التطبيق! 🚫' });
            s.disconnect(true);
          }
        }
      }
    }

    res.json({ success: true, is_banned: !!is_banned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Delete User
app.delete('/api/admin/users/:id', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });

  try {
    const { id } = req.params;
    const u = await get('SELECT role FROM users WHERE id = ?', [id]);
    if (u && u.role === 'owner') {
      return res.status(403).json({ error: 'لا يمكن حذف حساب مالك التطبيق!' });
    }

    await run('DELETE FROM room_seats WHERE user_id = ?', [id]);
    const userRooms = await all('SELECT id FROM rooms WHERE host_id = ?', [id]);
    for (const r of userRooms) {
      await run('DELETE FROM room_seats WHERE room_id = ?', [r.id]);
      await run('DELETE FROM rooms WHERE id = ?', [r.id]);
      io.to(`room:${r.id}`).emit('room_closed_by_host', { roomId: r.id, adminName: 'إدارة المنصة' });
      io.emit('room_deleted', { roomId: r.id });
    }
    await run('DELETE FROM users WHERE id = ?', [id]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Admin Rooms List with Real Occupants Count
app.get('/api/admin/rooms', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });

  try {
    const rooms = await all(`
      SELECT r.*, u.name as host_name, u.avatar as host_avatar, u.email as host_email
      FROM rooms r
      JOIN users u ON r.host_id = u.id
      ORDER BY r.created_at DESC
    `);

    for (const r of rooms) {
      const roomState = activeRoomStates.get(r.id);
      r.occupants_count = roomState ? roomState.activeAudience.size : 0;
      const seats = await all('SELECT seat_index, user_id FROM room_seats WHERE room_id = ? AND user_id IS NOT NULL', [r.id]);
      r.occupied_seats = seats.length;
    }

    res.json({ success: true, rooms });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Admin Force Close / Delete Room
app.delete('/api/admin/rooms/:id', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });

  try {
    const { id } = req.params;
    await run('DELETE FROM room_seats WHERE room_id = ?', [id]);
    await run('DELETE FROM rooms WHERE id = ?', [id]);

    io.to(`room:${id}`).emit('room_closed_by_host', { roomId: id, adminName: 'إدارة المنصة العليا' });
    io.emit('room_deleted', { roomId: id });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. Broadcast Global Announcement Banner to All Users & Rooms
app.post('/api/admin/broadcast', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });

  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'نص الإعلان فارغ' });
    }

    io.emit('global_announcement', {
      message: message.trim(),
      sender: '👑 إدارة SoulChill العليا'
    });
    io.emit('global_system_broadcast', {
      title: 'إعلان من إدارة SoulChill',
      message: message.trim(),
      sender: '👑 إدارة SoulChill العليا'
    });
    io.emit('global_announcement_broadcast', {
      message: message.trim()
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. Change Admin Credentials (Username and Password)
app.post('/api/admin/change-credentials', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });

  try {
    const { username, password } = req.body;
    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: 'يجب أن تتكون كلمة المرور من 6 أحرف أو أرقام على الأقل' });
    }

    const exists = await get('SELECT id FROM admin_credentials LIMIT 1');
    if (exists) {
      await run('UPDATE admin_credentials SET username = ?, password = ? WHERE id = ?', [username, password, exists.id]);
    } else {
      await run('INSERT INTO admin_credentials (username, password, role) VALUES (?, ?, "admin")', [username, password]);
    }

    res.json({ success: true, message: 'تم تحديث بيانات الدخول بنجاح!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. Admin Create Room directly from Dashboard (Voice Room)
// ===================== إعدادات الغرفة (مطابقة لقائمة التحكم في الفيديو) =====================
const ROOM_SEAT_OPTIONS = [3, 5, 9, 15];
const SEAT_15_PRICE = 49990;      // كريستال لفتح 15 مقعد
const SEAT_9_MEMBERS_NEEDED = 10; // أعضاء الغرفة المطلوبون لفتح 9 مقاعد
const ROOM_STAFF_ROLES = ['owner', 'super_master', 'super_admin', 'admin', 'moderator'];
const jparse = (t, d) => { try { return t ? JSON.parse(t) : d; } catch (e) { return d; } };

async function requireRoomManager(req, res) {
  const room = await get('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
  if (!room) { res.status(404).json({ error: 'الغرفة غير موجودة' }); return null; }
  const uid = req.headers['x-user-id'];
  const user = uid ? await get('SELECT * FROM users WHERE id = ?', [uid]) : null;
  if (!user || !(await canManageRoom(room, user))) { res.status(403).json({ error: 'غير مصرح لك بتعديل الغرفة' }); return null; }
  return { room, user };
}
async function ensureSeatRows(roomId, upTo) {
  const room = await get('SELECT seat_settings FROM rooms WHERE id = ?', [roomId]);
  const globalMute = !!jparse(room && room.seat_settings, {}).global_mute;
  for (let i = 0; i <= upTo; i++) {
    const isMuted = i > 0 && globalMute ? 1 : 0;
    await run('INSERT OR IGNORE INTO room_seats (room_id, seat_index, user_id, is_muted, is_locked) VALUES (?, ?, NULL, ?, 0)', [roomId, i, isMuted]);
  }
}
function publicRoomSettings(room) {
  return {
    roomId: room.id, title: room.title, category: room.category, announcement: room.announcement,
    cover_image: room.cover_image, bg_image: room.bg_image || '',
    chat_settings: jparse(room.chat_settings, {}), seat_settings: jparse(room.seat_settings, {}),
    seat_count: room.seat_count, max_seats: room.max_seats, seat_unlocks: jparse(room.seat_unlocks, {})
  };
}

// حالة خيارات المقاعد (3 / 5 / 9 / 15) وما إذا كانت مفتوحة
app.get('/api/rooms/:id/seat-options', async (req, res) => {
  try {
    const room = await get('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
    if (!room) return res.status(404).json({ error: 'الغرفة غير موجودة' });
    const members = (await get('SELECT COUNT(*) AS c FROM room_members WHERE room_id = ?', [room.id])).c;
    const unlocks = jparse(room.seat_unlocks, {});
    res.json({
      current: (room.seat_count || 8) + 1, members,   // الرقم الكلي يشمل مقعد المضيف
      options: [
        { count: 3, locked: false },
        { count: 5, locked: false },
        { count: 9, locked: !(unlocks['9'] || members >= SEAT_9_MEMBERS_NEEDED), need_members: SEAT_9_MEMBERS_NEEDED, members },
        { count: 15, locked: !unlocks['15'], price: SEAT_15_PRICE }
      ]
    });
  } catch (err) { res.status(500).json({ error: 'تعذر تحميل خيارات المقاعد' }); }
});

// تحديد عدد المقاعد النشطة (صاحب الغرفة أو الإدارة)
app.put('/api/rooms/:id/seat-count', async (req, res) => {
  try {
    const ctx = await requireRoomManager(req, res); if (!ctx) return;
    const { room, user } = ctx; const roomId = room.id;
    const count = parseInt(req.body.count, 10);
    const staff = ROOM_STAFF_ROLES.includes(user.role);
    if (!ROOM_SEAT_OPTIONS.includes(count) && !(staff && count >= 2 && count <= 16)) {
      return res.status(400).json({ error: 'اختر 3 أو 5 أو 9 أو 15 مقعداً' });
    }
    const unlocks = jparse(room.seat_unlocks, {});
    if (count === 9 && !staff && !unlocks['9']) {
      const members = (await get('SELECT COUNT(*) AS c FROM room_members WHERE room_id = ?', [roomId])).c;
      if (members < SEAT_9_MEMBERS_NEEDED) return res.status(403).json({ error: `يلزم ${SEAT_9_MEMBERS_NEEDED} من أعضاء الغرفة لفتح 9 مقاعد` });
      unlocks['9'] = true;
    }
    if (count === 15 && !staff && !unlocks['15']) {
      const bal = user.diamonds || 0;
      if (bal < SEAT_15_PRICE) return res.status(402).json({ error: `فتح 15 مقعداً يكلف ${SEAT_15_PRICE} كريستال` });
      await run('UPDATE users SET diamonds = diamonds - ? WHERE id = ?', [SEAT_15_PRICE, user.id]);
      unlocks['15'] = true;
    }
    // الرقم المختار (3/5/9/15) يشمل مقعد المضيف؛ مقاعد الضيوف = الرقم - 1
    const guests = count - 1;
    await ensureSeatRows(roomId, 15);
    const vacated = await all('SELECT seat_index, is_muted FROM room_seats WHERE room_id = ? AND seat_index > ? AND user_id IS NOT NULL', [roomId, guests]);
    const seatMuteSetting = jparse(room.seat_settings, {});
    const preserveMute = !!seatMuteSetting.global_mute;
    await run('UPDATE room_seats SET user_id = NULL WHERE room_id = ? AND seat_index > ?', [roomId, guests]);
    if (preserveMute) {
      await run('UPDATE room_seats SET is_muted = 1 WHERE room_id = ? AND seat_index > ?', [roomId, guests]);
    }
    await run('UPDATE rooms SET seat_count = ?, max_seats = 15, seat_unlocks = ? WHERE id = ?', [guests, JSON.stringify(unlocks), roomId]);
    io.to(`room:${roomId}`).emit('room_seat_count_changed', { roomId, seatCount: guests, maxSeats: 15 });
    vacated.forEach(v => io.to(`room:${roomId}`).emit('seat_updated', { seatIndex: v.seat_index, user: null, isMuted: preserveMute || !!v.is_muted }));
    res.json({ success: true, total_seats: count, seat_count: guests, max_seats: 15 });
  } catch (err) {
    console.error('seat-count error:', err);
    res.status(500).json({ error: 'تعذر تحديث عدد المقاعد' });
  }
});

// «صورة الغرفة»: الاسم + التصنيف + الإعلان الشامل + صورة الغرفة
app.put('/api/rooms/:id/profile', async (req, res) => {
  try {
    const ctx = await requireRoomManager(req, res); if (!ctx) return;
    const { room } = ctx;
    const title = String(req.body.title != null ? req.body.title : room.title).trim().slice(0, 40) || room.title;
    const category = String(req.body.category || room.category).slice(0, 30);
    const announcement = String(req.body.announcement != null ? req.body.announcement : (room.announcement || '')).slice(0, 100);
    const cover = req.body.cover_image ? String(req.body.cover_image).slice(0, 500) : room.cover_image;
    await run('UPDATE rooms SET title = ?, category = ?, announcement = ?, cover_image = ? WHERE id = ?', [title, category, announcement, cover, room.id]);
    const updated = await get('SELECT * FROM rooms WHERE id = ?', [room.id]);
    io.to(`room:${room.id}`).emit('room_settings_changed', publicRoomSettings(updated));
    // تحديث فوري لقائمة الغرف عند كل المتصلين (الصورة/الاسم/التصنيف)
    io.emit('room_meta_updated', { id: room.id, title: updated.title, category: updated.category, announcement: updated.announcement, cover_image: updated.cover_image });
    res.json({ success: true, room: publicRoomSettings(updated) });
  } catch (err) { console.error('room profile error:', err); res.status(500).json({ error: 'تعذر حفظ بيانات الغرفة' }); }
});

// رفع صورة الغرفة / خلفية مخصصة من الجهاز
app.post('/api/rooms/:id/image', upload.single('image'), async (req, res) => {
  try {
    const ctx = await requireRoomManager(req, res); if (!ctx) return;
    if (!req.file) return res.status(400).json({ error: 'لم يتم اختيار صورة' });
    if (!/^image\//.test(req.file.mimetype || '')) return res.status(400).json({ error: 'الملف ليس صورة' });
    res.json({ success: true, url: `/uploads/${req.file.filename}` });
  } catch (err) { res.status(500).json({ error: 'تعذر رفع الصورة' }); }
});

// ===== خلفيات الغرف الجاهزة (تُدار من الإدارة وتُباع بالكرستالات؛ السعر 0 = مجانية) =====
function safeDeleteRoomBgImage(imageUrl) {
  try {
    if (!imageUrl || !imageUrl.startsWith('/uploads/rbg-')) return;
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    const full = path.join(__dirname, 'public', imageUrl);
    if (path.dirname(full) === uploadsDir && fs.existsSync(full)) fs.unlinkSync(full);
  } catch (e) { console.error('delete room bg image error:', e.message); }
}
const roomBgUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => cb(null, `rbg-${Date.now()}-${uuidv4().slice(0, 8)}${ENTRY_IMAGE_EXT[file.mimetype] || '.jpg'}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ENTRY_IMAGE_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('يُسمح فقط بصور PNG أو JPG أو GIF أو WEBP'));
  }
});
async function adminRoomBgUpload(req, res, next) {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  roomBgUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'حجم الصورة أكبر من 10MB' : err.message });
    next();
  });
}

// قائمة الخلفيات للمستخدم: مع owned (مجانية أو مشتراة)
app.get('/api/room-backgrounds', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || '';
    const rows = await all(`
      SELECT b.id, b.name, b.image_url, b.price,
             CASE WHEN b.price <= 0 OR i.id IS NOT NULL THEN 1 ELSE 0 END AS owned
      FROM room_backgrounds b
      LEFT JOIN user_inventory i ON i.item_id = b.id AND i.user_id = ? AND i.item_type = 'room_bg'
      WHERE b.is_active = 1
      ORDER BY b.price ASC, b.created_at DESC, b.rowid DESC
    `, [userId]);
    res.json({ backgrounds: rows.map(r => ({ id: r.id, name: r.name, image_url: r.image_url, price: r.price, owned: !!r.owned })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/room-backgrounds/:id/buy', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'سجّل الدخول أولاً' });
  try {
    const bg = await get('SELECT * FROM room_backgrounds WHERE id = ? AND is_active = 1', [req.params.id]);
    if (!bg) return res.status(404).json({ error: 'هذه الخلفية غير متاحة' });
    if (!(await get('SELECT id FROM users WHERE id = ?', [userId]))) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if ((parseInt(bg.price, 10) || 0) > 0) {
      const bought = await buyInventoryItem(userId, 'room_bg', { id: bg.id, name: bg.name, price: bg.price, duration_days: 0 }, 'هذه الخلفية');
      if (!bought.ok) return res.status(bought.status).json({ error: bought.error });
    }
    const updatedUser = await get('SELECT * FROM users WHERE id = ?', [userId]);
    res.json({ success: true, user: updatedUser });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- إدارة خلفيات الغرف من لوحة الإدارة ----
app.get('/api/admin/room-backgrounds', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const rows = await all(`
      SELECT b.*, (SELECT COUNT(*) FROM user_inventory i WHERE i.item_type = 'room_bg' AND i.item_id = b.id) AS owners_count
      FROM room_backgrounds b ORDER BY b.created_at DESC, b.rowid DESC
    `);
    res.json({ backgrounds: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/admin/room-backgrounds', adminRoomBgUpload, async (req, res) => {
  const drop = () => { if (req.file) safeDeleteRoomBgImage(`/uploads/${req.file.filename}`); };
  try {
    const name = String(req.body.name || '').trim();
    const price = parseInt(req.body.price, 10);
    if (!name) { drop(); return res.status(400).json({ error: 'يرجى كتابة اسم الخلفية' }); }
    if (!Number.isFinite(price) || price < 0) { drop(); return res.status(400).json({ error: 'يرجى إدخال سعر صحيح (0 = مجانية)' }); }
    if (!req.file) return res.status(400).json({ error: 'يرجى اختيار صورة الخلفية' });
    const id = `rbg-${uuidv4().slice(0, 8)}`;
    await run('INSERT INTO room_backgrounds (id, name, image_url, price, is_active) VALUES (?, ?, ?, ?, 1)', [id, name, `/uploads/${req.file.filename}`, price]);
    res.json({ success: true, id });
  } catch (err) { drop(); res.status(500).json({ error: err.message }); }
});
app.put('/api/admin/room-backgrounds/:id', adminRoomBgUpload, async (req, res) => {
  const drop = () => { if (req.file) safeDeleteRoomBgImage(`/uploads/${req.file.filename}`); };
  try {
    const bg = await get('SELECT * FROM room_backgrounds WHERE id = ?', [req.params.id]);
    if (!bg) { drop(); return res.status(404).json({ error: 'الخلفية غير موجودة' }); }
    const name = req.body.name !== undefined ? String(req.body.name).trim() : bg.name;
    const price = req.body.price !== undefined ? parseInt(req.body.price, 10) : bg.price;
    const isActive = req.body.is_active !== undefined ? (String(req.body.is_active) === '1' || req.body.is_active === 'true' ? 1 : 0) : bg.is_active;
    if (!name || !Number.isFinite(price) || price < 0) { drop(); return res.status(400).json({ error: 'يرجى التأكد من الاسم والسعر' }); }
    let imageUrl = bg.image_url;
    if (req.file) { imageUrl = `/uploads/${req.file.filename}`; safeDeleteRoomBgImage(bg.image_url); }
    await run('UPDATE room_backgrounds SET name = ?, price = ?, is_active = ?, image_url = ? WHERE id = ?', [name, price, isActive, imageUrl, bg.id]);
    if (imageUrl !== bg.image_url) await run('UPDATE rooms SET bg_image = ? WHERE bg_image = ?', [imageUrl, bg.image_url]);
    await run(`UPDATE user_inventory SET item_name = ? WHERE item_type = 'room_bg' AND item_id = ?`, [name, bg.id]);
    res.json({ success: true });
  } catch (err) { drop(); res.status(500).json({ error: err.message }); }
});
app.delete('/api/admin/room-backgrounds/:id', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  try {
    const bg = await get('SELECT * FROM room_backgrounds WHERE id = ?', [req.params.id]);
    if (!bg) return res.status(404).json({ error: 'الخلفية غير موجودة' });
    await run(`DELETE FROM user_inventory WHERE item_type = 'room_bg' AND item_id = ?`, [bg.id]);
    await run(`UPDATE rooms SET bg_image = '' WHERE bg_image = ?`, [bg.image_url]);
    await run('DELETE FROM room_backgrounds WHERE id = ?', [bg.id]);
    safeDeleteRoomBgImage(bg.image_url);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// «الخلفية» — خلفيات جاهزة فقط (لا رفع من صاحب الغرفة)
const BUILTIN_BG_RE = /^(grad:[a-z0-9_-]+|anim:[a-z0-9_-]+|\/img\/bg\/bg-\d+\.jpg|\/royal_eagle\.gif)$/i;
app.put('/api/rooms/:id/background', async (req, res) => {
  try {
    const ctx = await requireRoomManager(req, res); if (!ctx) return;
    const { room, user } = ctx;
    const bg = String(req.body.bg_image || '').slice(0, 600);
    if (bg && bg !== (room.bg_image || '') && !BUILTIN_BG_RE.test(bg)) {
      const adminBg = await get('SELECT * FROM room_backgrounds WHERE image_url = ? AND is_active = 1', [bg]);
      if (!adminBg) return res.status(400).json({ error: 'يمكن اختيار الخلفيات الجاهزة فقط' });
      if ((parseInt(adminBg.price, 10) || 0) > 0) {
        const owned = await get(`SELECT id FROM user_inventory WHERE user_id = ? AND item_type = 'room_bg' AND item_id = ?`, [user.id, adminBg.id]);
        if (!owned) return res.status(402).json({ error: `هذه الخلفية مدفوعة (${adminBg.price} 💎) — اشترِها أولاً` });
      }
    }
    await run('UPDATE rooms SET bg_image = ? WHERE id = ?', [bg, room.id]);
    const updated = await get('SELECT * FROM rooms WHERE id = ?', [room.id]);
    io.to(`room:${room.id}`).emit('room_settings_changed', Object.assign(publicRoomSettings(updated), { toast: 'تم تغيير الخلفية', by: user.name }));
    res.json({ success: true, bg_image: bg });
  } catch (err) { res.status(500).json({ error: 'تعذر تغيير الخلفية' }); }
});

// «منطقة الدردشة» / «إدارة الشات»
app.put('/api/rooms/:id/chat-settings', async (req, res) => {
  try {
    const ctx = await requireRoomManager(req, res); if (!ctx) return;
    const { room } = ctx;
    const keys = ['hide_system', 'hide_all', 'images_members_only', 'auto_welcome', 'close_emoji'];
    const cur = jparse(room.chat_settings, {});
    keys.forEach(k => { if (typeof req.body[k] === 'boolean') cur[k] = req.body[k]; });
    await run('UPDATE rooms SET chat_settings = ? WHERE id = ?', [JSON.stringify(cur), room.id]);
    const updated = await get('SELECT * FROM rooms WHERE id = ?', [room.id]);
    io.to(`room:${room.id}`).emit('room_settings_changed', publicRoomSettings(updated));
    res.json({ success: true, chat_settings: cur });
  } catch (err) { res.status(500).json({ error: 'تعذر حفظ إعدادات الشات' }); }
});

// «مقعد» → إعدادات المقاعد (من يستطيع الصعود / عرض النجوم / موسيقى الآخرين)
app.put('/api/rooms/:id/seat-settings', async (req, res) => {
  try {
    const ctx = await requireRoomManager(req, res); if (!ctx) return;
    const { room } = ctx;
    const cur = jparse(room.seat_settings, {});
    if (['all', 'members'].includes(req.body.who)) cur.who = req.body.who;
    if (['classic', 'neon', 'gold'].includes(req.body.theme)) cur.theme = req.body.theme;
    ['show_stars', 'allow_music'].forEach(k => { if (typeof req.body[k] === 'boolean') cur[k] = req.body[k]; });
    await run('UPDATE rooms SET seat_settings = ? WHERE id = ?', [JSON.stringify(cur), room.id]);
    const updated = await get('SELECT * FROM rooms WHERE id = ?', [room.id]);
    io.to(`room:${room.id}`).emit('room_settings_changed', publicRoomSettings(updated));
    res.json({ success: true, seat_settings: cur });
  } catch (err) { res.status(500).json({ error: 'تعذر حفظ إعدادات المقاعد' }); }
});

app.post('/api/admin/rooms', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });

  try {
    const { title, category, country_code, announcement, host_id, cover_image } = req.body;
    const maxSeats = Math.min(8, Math.max(1, parseInt(req.body.max_seats, 10) || 8));
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'عنوان الغرفة مطلوب' });
    }

    let finalHostId = host_id;
    if (!finalHostId) {
      const owner = await get("SELECT id FROM users WHERE role = 'owner' LIMIT 1");
      finalHostId = owner ? owner.id : 'sc-owner-001';
    }

    let host = await get('SELECT * FROM users WHERE id = ?', [finalHostId]);
    if (!host) {
      const anyUser = await get('SELECT * FROM users LIMIT 1');
      host = anyUser;
      finalHostId = host ? host.id : 'sc-owner-001';
    }

    const roomId = `room-${Date.now().toString().slice(-6)}`;
    const countryItem = SUPPORTED_COUNTRIES.find(c => c.code === country_code) || { code: 'JO', name: 'الأردن', flag: '🇯🇴' };

    await run(`
      INSERT INTO rooms (id, title, category, room_type, cover_image, likes_count, host_id, country_code, country_name, country_flag, theme, announcement)
      VALUES (?, ?, ?, 'voice', ?, 0, ?, ?, ?, ?, 'cosmic_purple', ?)
    `, [
      roomId,
      title.trim(),
      category || 'chill',
      cover_image || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80',
      finalHostId,
      countryItem.code,
      countryItem.name,
      countryItem.flag,
      announcement || 'غرفة صوتية رسمية من إدارة التطبيق 🌟'
    ]);

    // Setup seat 0 + 8 stage seats
    await run(`INSERT INTO room_seats (room_id, seat_index, user_id, is_muted, is_locked) VALUES (?, 0, NULL, 0, 0)`, [roomId]);
    for (let i = 1; i <= 8; i++) {
      await run(`INSERT INTO room_seats (room_id, seat_index, user_id, is_muted, is_locked) VALUES (?, ?, NULL, 0, 0)`, [roomId, i]);
    }

    await run('UPDATE rooms SET max_seats = ?, seat_count = ? WHERE id = ?', [maxSeats, maxSeats, roomId]);

    let newRoom = await get(`
      SELECT r.*, u.name as host_name, u.avatar as host_avatar, u.avatar_frame as host_frame, u.level as host_level
      FROM rooms r
      LEFT JOIN users u ON r.host_id = u.id
      WHERE r.id = ?
    `, [roomId]);

    newRoom.seats = await all('SELECT * FROM room_seats WHERE room_id = ? ORDER BY seat_index ASC', [roomId]);
    newRoom.audience_count = 0;

    io.emit('room_created', { room: newRoom });

    res.json({ success: true, room: newRoom });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. Get All Generated Moderator Accounts
app.get('/api/admin/moderators', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });

  try {
    const moderators = await all(`
      SELECT m.*, u.name as user_name, u.avatar as user_avatar, u.is_banned
      FROM moderator_accounts m
      LEFT JOIN users u ON m.user_id = u.id
      ORDER BY m.created_at DESC
    `);
    res.json({ success: true, moderators });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 16. Generate New Moderator Account (Username & Password to give to anyone)
app.post('/api/admin/moderators/generate', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });

  try {
    let { username, password, display_name, notes } = req.body;

    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    if (!username || !username.trim()) {
      username = `mod_${randomSuffix}`;
    } else {
      username = username.trim().toLowerCase().replace(/\s+/g, '_');
    }

    if (!password || !password.trim()) {
      password = `Mod@${Math.floor(100000 + Math.random() * 900000)}`;
    } else {
      password = password.trim();
    }

    if (!display_name || !display_name.trim()) {
      display_name = `مشرف عام | ${username}`;
    } else {
      display_name = display_name.trim();
    }

    // Check if username already exists in moderator_accounts
    const existing = await get('SELECT id FROM moderator_accounts WHERE username = ?', [username]);
    if (existing) {
      return res.status(400).json({ error: 'اسم المستخدم هذا مستخدم بالفعل، يرجى اختيار اسم آخر' });
    }

    const modAccountId = `mod-acc-${Date.now()}`;
    const userId = `sc-mod-${randomSuffix}`;
    const modEmail = `${username}@soulchill.mod`;

    // Create user in users table with role 'moderator'
    await run(`
      INSERT INTO users (id, name, email, role, avatar, avatar_frame, level, coins, diamonds, soul_planet, bio)
      VALUES (?, ?, ?, 'moderator', ?, 'galaxy', 50, 50000, 5000, 'كوكب القيادة والإشراف 🛡️', 'مشرف عام معتمد على دردشة SoulChill')
    `, [
      userId,
      display_name,
      modEmail,
      `/avatars/avatar-${Math.floor(1 + Math.random() * 6)}.png`
    ]);

    // Insert into moderator_accounts
    await run(`
      INSERT INTO moderator_accounts (id, username, password, display_name, user_id, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [modAccountId, username, password, display_name, userId, notes || '']);

    const createdMod = await get('SELECT * FROM moderator_accounts WHERE id = ?', [modAccountId]);

    // Broadcast announcement about new moderator appointment
    io.emit('room_message', {
      id: `sys-mod-${Date.now()}`,
      sender_id: 'system',
      sender_name: '🛡️ الإدارة العليا',
      sender_avatar: '/avatars/avatar-1.png',
      sender_level: 99,
      message_type: 'system',
      content: `🎉 تم اعتماد حساب إشرافي جديد [${display_name}] كمشرف عام على الدردشة بالكامل! 🛡️✨`,
      created_at: new Date().toISOString()
    });

    res.json({
      success: true,
      moderator: createdMod,
      message: 'تم توليد حساب المشرف وبيانات الدخول بنجاح!'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 17. Delete Moderator Account
app.delete('/api/admin/moderators/:id', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });

  try {
    const { id } = req.params;
    const mod = await get('SELECT * FROM moderator_accounts WHERE id = ?', [id]);
    if (!mod) {
      return res.status(404).json({ error: 'حساب المشرف غير موجود' });
    }

    // Downgrade user role
    await run("UPDATE users SET role = 'user' WHERE id = ?", [mod.user_id]);
    await run('DELETE FROM moderator_accounts WHERE id = ?', [id]);

    res.json({ success: true, message: 'تم حذف حساب المشرف وإلغاء صلاحياته بنجاح' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 18. Get SMTP Settings
app.get('/api/admin/smtp', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });

  try {
    const smtp = await get('SELECT * FROM smtp_settings WHERE id = 1');
    res.json({ success: true, smtp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 19. Update SMTP Settings
app.post('/api/admin/smtp', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });

  try {
    const { host, port, user, pass, from_email, subject_template, html_template, is_enabled } = req.body;
    await run(`
      UPDATE smtp_settings SET
        host = COALESCE(?, host),
        port = COALESCE(?, port),
        user = COALESCE(?, user),
        pass = COALESCE(?, pass),
        from_email = COALESCE(?, from_email),
        subject_template = COALESCE(?, subject_template),
        html_template = COALESCE(?, html_template),
        is_enabled = COALESCE(?, is_enabled),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `, [host, port ? parseInt(port) : null, user, pass, from_email, subject_template, html_template, is_enabled !== undefined ? (is_enabled ? 1 : 0) : null]);

    const updated = await get('SELECT * FROM smtp_settings WHERE id = 1');
    res.json({ success: true, smtp: updated, message: 'تم حفظ وتحديث إعدادات SMTP بنجاح!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 20. Test SMTP Email Sending
app.post('/api/admin/smtp/test', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });

  try {
    const { target_email } = req.body;
    if (!target_email || !target_email.includes('@')) {
      return res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صحيح لإرسال التجربة' });
    }

    const smtp = await get('SELECT * FROM smtp_settings WHERE id = 1');
    if (!smtp) return res.status(400).json({ error: 'إعدادات SMTP غير موجودة' });

    const transporter = nodemailer.createTransport({
      host: smtp.host || 'smtp.gmail.com',
      port: parseInt(smtp.port) || 587,
      secure: parseInt(smtp.port) === 465,
      auth: {
        user: smtp.user,
        pass: smtp.pass
      }
    });

    const testCode = '884920';
    let htmlContent = (smtp.html_template || '')
      .replace(/\{\{code\}\}/g, testCode)
      .replace(/\{\{email\}\}/g, target_email)
      .replace(/\{\{app_name\}\}/g, 'SoulChill');

    const subject = `[تجربة إرسال SMTP ناجحة] ` + (smtp.subject_template || 'رمز التحقق SoulChill');

    await transporter.sendMail({
      from: smtp.from_email || `chat<${smtp.user}>`,
      to: target_email,
      subject: subject,
      html: htmlContent
    });

    res.json({
      success: true,
      message: `تم إرسال بريد التجربة بنجاح إلى ${target_email} عبر خادم ${smtp.host}!`
    });
  } catch (err) {
    console.error('SMTP test error:', err);
    res.status(500).json({ error: 'فشل إرسال البريد عبر SMTP: ' + err.message });
  }
});

// 18. Moderator Login with Username & Password (for chat app or direct login)
app.post('/api/auth/moderator-login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
    }

    const cleanUser = username.trim().toLowerCase();
    const cleanPass = password.trim();

    // Check in moderator_accounts
    const modAcc = await get('SELECT * FROM moderator_accounts WHERE LOWER(username) = ? AND password = ?', [cleanUser, cleanPass]);
    if (!modAcc) {
      // Also check admin_credentials for super admin
      const adminAcc = await get('SELECT * FROM admin_credentials WHERE LOWER(username) = ? AND password = ?', [cleanUser, cleanPass]);
      if (adminAcc) {
        const owner = await get("SELECT * FROM users WHERE role = 'owner' LIMIT 1");
        const token = `mod-token-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return res.json({
          success: true,
          token,
          user: owner,
          isSuperAdmin: true,
          message: 'تم تسجيل الدخول بصلاحيات الإدارة العليا!'
        });
      }
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    let user = await get('SELECT * FROM users WHERE id = ?', [modAcc.user_id]);
    if (!user) {
      user = await get('SELECT * FROM users WHERE email = ?', [`${cleanUser}@soulchill.mod`]);
    }

    if (user && user.is_banned) {
      return res.status(403).json({ error: 'تم حظر هذا الحساب من قبل الإدارة' });
    }

    // Ensure role is moderator
    if (user && user.role !== 'moderator') {
      await run("UPDATE users SET role = 'moderator' WHERE id = ?", [user.id]);
      user.role = 'moderator';
    }

    const token = `mod-token-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    res.json({
      success: true,
      token,
      user,
      moderator: {
        username: modAcc.username,
        display_name: modAcc.display_name
      },
      message: `مرحباً بك يا مشرفنا العزيز ${modAcc.display_name}! 🛡️`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// SOCKET.IO REALTIME EVENTS
// ==========================================

// سجل المكالمات الصوتية الخاصة الجارية
const dmCalls = new Map(); // callId -> { callId, callerId, calleeId, callerSocket, calleeSocket, answered }
function endDmCall(callId, reason) {
  const c = dmCalls.get(callId);
  if (!c) return;
  dmCalls.delete(callId);
  const payload = { callId, reason };
  io.to(c.callerSocket).emit('dm_call_ended', payload);
  if (c.calleeSocket) io.to(c.calleeSocket).emit('dm_call_ended', payload);
  else emitToUser(c.calleeId, 'dm_call_ended', payload);
}

// ==========================================
// نظام التوافق الصوتي الحقيقي (مكالمة صوتية مجهولة بين شخصين حقيقيين)
// - 3 محاولات فقط لكل حساب خلال 24 ساعة
// - المطابقة بين شخصين حقيقيين متصلين: نفس التوافق (نفس الكوكب/الاهتمامات) أو نسبة توافق ≥ 70%
// - اتصال صوتي حقيقي (WebRTC) لمدة 5 دقائق فقط، بلا حدود عند كشف الهوية المتبادل
// ==========================================
const VOICE_MATCH_LIMIT = 3; // محاولات لكل 24 ساعة
const VOICE_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;
const VOICE_MATCH_DURATION_MS = parseInt(process.env.VOICE_MATCH_DURATION_MS, 10) || 5 * 60 * 1000; // 5 دقائق (افتراضياً)
const VOICE_MATCH_QUEUE_TIMEOUT_MS = 90 * 1000; // مهلة الانتظار في طابور البحث
const VOICE_MATCH_MIN_COMPAT = 60; // حد التوافق الأدنى للمطابقة (60% فأكثر)
const VOICE_MATCH_REQUEST_TTL_MS = 30 * 1000; // مدة صلاحية طلب الاتصال المرسل للمتوافقين المتصلين
const VOICE_MATCH_MAX_INVITES = 30; // أقصى عدد متوافقين يصلهم الطلب دفعة واحدة
const voiceMatchQueue = []; // [{ userId, socketId, user, enqueuedAt, timeout }] — مشترك بين جميع السوكيتات
const activeVoiceMatchSessions = new Map(); // sessionId -> { id, userA, userB, startedAt, duration, isUnlimited, timer }

function parseSoulTags(tags) {
  return new Set(String(tags || '').split(',').map(t => t.trim()).filter(Boolean));
}

// نسبة التوافق الحقيقية بين شخصين (0-100): اهتمامات مشتركة 70% + نفس الكوكب 20% + نفس البلد 10%
function computeSoulCompatibility(a, b) {
  const tagsA = parseSoulTags(a && a.soul_tags);
  const tagsB = parseSoulTags(b && b.soul_tags);
  let shared = 0;
  tagsA.forEach(t => { if (tagsB.has(t)) shared++; });
  const union = new Set([...tagsA, ...tagsB]).size || 1;
  let score = Math.round((shared / union) * 70);
  if (a && b && a.soul_planet && b.soul_planet && a.soul_planet === b.soul_planet) score += 20;
  if (a && b && a.country_code && b.country_code && a.country_code === b.country_code) score += 10;
  return Math.min(100, score);
}

// قاعدة المطابقة: نسبة التوافق الحقيقية 60% فأكثر بين شخصين مختلفين
function isVoiceMatchCompatible(a, b) {
  if (!a || !b || !a.id || !b.id || a.id === b.id) return false;
  return computeSoulCompatibility(a, b) >= VOICE_MATCH_MIN_COMPAT;
}

// هل المستخدم داخل مكالمة توافق صوتي نشطة؟
function isUserInActiveVoiceMatch(userId) {
  for (const s of activeVoiceMatchSessions.values()) {
    if (s.userA.id === userId || s.userB.id === userId) return true;
  }
  return false;
}

// إنشاء مكالمة توافق صوتي حقيقية بين: waiting (الطرف الذي أرسل الطلب/ينتظر) و accepter (الطرف القابل)
async function createVoiceMatchSession(waiting, accepterUser, accepterSocketId) {
  const partnerUser = waiting.user;
  const compatibility = computeSoulCompatibility(accepterUser, partnerUser);
  const sessionId = `vmatch-${Date.now()}-${uuidv4().slice(0, 6)}`;
  const sessionData = {
    id: sessionId,
    userA: { id: partnerUser.id, socketId: waiting.socketId, user: partnerUser, revealed: false }, // A = صاحب الطلب (offerer)
    userB: { id: accepterUser.id, socketId: accepterSocketId, user: accepterUser, revealed: false }, // B = القابل (answerer)
    startedAt: Date.now(),
    duration: VOICE_MATCH_DURATION_MS / 1000,
    isUnlimited: false,
    timer: null
  };
  sessionData.timer = setTimeout(() => {
    const s = activeVoiceMatchSessions.get(sessionId);
    if (s && !s.isUnlimited) endVoiceMatchSession(sessionId, 'time_up');
  }, VOICE_MATCH_DURATION_MS);
  activeVoiceMatchSessions.set(sessionId, sessionData);

  await recordVoiceMatchUsage(accepterUser.id, sessionId);
  await recordVoiceMatchUsage(partnerUser.id, sessionId);

  const usedA = await getVoiceMatchUsageCount(partnerUser.id);
  const usedB = await getVoiceMatchUsageCount(accepterUser.id);
  const maskedPartner = {
    id: partnerUser.id,
    maskedName: `روح متوافقة #${String(partnerUser.id).slice(-4)}`,
    maskedAvatar: '/avatars/masked-avatar.png',
    soul_planet: partnerUser.soul_planet || 'كوكب السول 🪐',
    compatibility,
    level: partnerUser.level || 5
  };
  const maskedSelf = {
    id: accepterUser.id,
    maskedName: `روح غامضة #${String(accepterUser.id).slice(-4)}`,
    maskedAvatar: '/avatars/masked-avatar.png',
    soul_planet: accepterUser.soul_planet || 'كوكب السول 🪐',
    compatibility,
    level: accepterUser.level || 5
  };
  io.to(accepterSocketId).emit('voice_match_connected', {
    sessionId, isAnonymous: true, duration: VOICE_MATCH_DURATION_MS / 1000, compatibility,
    role: 'answerer', remaining: Math.max(0, VOICE_MATCH_LIMIT - usedB),
    partner: maskedPartner, selfMasked: maskedSelf
  });
  io.to(waiting.socketId).emit('voice_match_connected', {
    sessionId, isAnonymous: true, duration: VOICE_MATCH_DURATION_MS / 1000, compatibility,
    role: 'offerer', remaining: Math.max(0, VOICE_MATCH_LIMIT - usedA),
    partner: maskedSelf, selfMasked: maskedPartner
  });
  return sessionData;
}

// إرسال طلب اتصال صوتي لكل المتصلين الآن ونسبة توافقهم مع صاحب الطلب 60% فأكثر
async function sendVoiceMatchRequests(entry) {
  const requester = entry.user;
  const onlineIds = [...userSockets.keys()].filter(id =>
    id !== entry.userId && userSockets.get(id) && userSockets.get(id).size > 0 && !isUserInActiveVoiceMatch(id)
  );
  if (!onlineIds.length) return 0;
  const placeholders = onlineIds.map(() => '?').join(',');
  const candidates = await all(`SELECT * FROM users WHERE id IN (${placeholders})`, onlineIds);
  const scored = candidates
    .filter(u => isVoiceMatchCompatible(requester, u))
    .map(u => ({ u, score: computeSoulCompatibility(requester, u) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, VOICE_MATCH_MAX_INVITES);
  entry.invitedUserIds = [];
  for (const { u, score } of scored) {
    if ((await getVoiceMatchUsageCount(u.id)) >= VOICE_MATCH_LIMIT) continue;
    entry.invitedUserIds.push(u.id);
    for (const sid of userSockets.get(u.id)) {
      io.to(sid).emit('voice_match_request', {
        requestId: entry.requestId,
        fromUserId: entry.userId,
        compatibility: score,
        soul_planet: requester.soul_planet || null,
        ttl: VOICE_MATCH_REQUEST_TTL_MS / 1000
      });
    }
  }
  return entry.invitedUserIds.length;
}

// إلغاء الطلب عند المدعوين (انتهاء/إلغاء/قبول من شخص آخر)
function cancelVoiceMatchRequests(entry, reason) {
  if (!entry || !entry.invitedUserIds) return;
  for (const uid of entry.invitedUserIds) {
    const set = userSockets.get(uid);
    if (!set) continue;
    for (const sid of set) io.to(sid).emit('voice_match_request_cancelled', { requestId: entry.requestId, reason });
  }
  entry.invitedUserIds = [];
}

// عدد محاولات التوافق الصوتي خلال آخر 24 ساعة
async function getVoiceMatchUsageCount(userId) {
  try {
    const row = await get(`SELECT COUNT(*) AS c FROM voice_match_usage WHERE user_id = ? AND created_at > datetime('now', '-24 hours')`, [userId]);
    return row ? (row.c || 0) : 0;
  } catch (e) {
    return 0;
  }
}

async function recordVoiceMatchUsage(userId, sessionId) {
  try {
    await run(`INSERT INTO voice_match_usage (user_id, session_id) VALUES (?, ?)`, [userId, sessionId]);
  } catch (e) { console.error('voice_match_usage insert error:', e); }
}

// إنهاء جلسة التوافق الصوتي وإشعار الطرفين
function endVoiceMatchSession(sessionId, reason) {
  const s = activeVoiceMatchSessions.get(sessionId);
  if (!s) return;
  activeVoiceMatchSessions.delete(sessionId);
  if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  const payload = { sessionId, reason };
  if (s.userA && s.userA.socketId) io.to(s.userA.socketId).emit('voice_match_ended', payload);
  if (s.userB && s.userB.socketId) io.to(s.userB.socketId).emit('voice_match_ended', payload);
}

// إزالة مستخدم من طابور الانتظار (حسب السوكيت أو User ID)
function removeFromVoiceMatchQueue(socketId, userId) {
  const idx = voiceMatchQueue.findIndex(q => q.socketId === socketId || (userId && q.userId === userId));
  if (idx === -1) return null;
  const [q] = voiceMatchQueue.splice(idx, 1);
  if (q.timeout) clearTimeout(q.timeout);
  cancelVoiceMatchRequests(q, 'cancelled');
  return q;
}

// تنظيف طابور الانتظار من الإدخالات الميتة (سوكيت منقطع)
function pruneVoiceMatchQueue() {
  for (let i = voiceMatchQueue.length - 1; i >= 0; i--) {
    const q = voiceMatchQueue[i];
    const alive = io.sockets.sockets.has(q.socketId) && userSockets.has(q.userId) && userSockets.get(q.userId).has(q.socketId);
    if (!alive) {
      if (q.timeout) clearTimeout(q.timeout);
      cancelVoiceMatchRequests(q, 'cancelled');
      voiceMatchQueue.splice(i, 1);
    }
  }
}

io.on('connection', (socket) => {
  let currentUserId = null;
  let currentRoomId = null;

  // 1. User Online Registration
  socket.on('user_connect', (userId) => {
    if (!userId) return;
    currentUserId = userId;
    onlineUsers.set(socket.id, userId);

    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(socket.id);

    // Broadcast online status
    io.emit('user_status_change', { userId, status: 'online' });
  });

  // 2. Joining a Voice Room
  socket.on('join_room', async ({ roomId, user }) => {
    if (!roomId) return;
    currentRoomId = roomId;
    socket.join(`room:${roomId}`);

    if (user && user.id) {
      currentUserId = user.id;
      onlineUsers.set(socket.id, user.id);
      if (!userSockets.has(user.id)) {
        userSockets.set(user.id, new Set());
      }
      userSockets.get(user.id).add(socket.id);
    }

    if (!activeRoomStates.has(roomId)) {
      activeRoomStates.set(roomId, {
        pkState: null,
        activeAudience: new Map(),
        speakers: new Set(),
        mutedChatUsers: new Set(),
        bannedUsers: new Set(),
        allSeatsMuted: false
      });
    }

    const roomState = activeRoomStates.get(roomId);
    if (roomState.allSeatsMuted === false) {
      try {
        const roomMuteRow = await get('SELECT seat_settings FROM rooms WHERE id = ?', [roomId]);
        const muteSettings = jparse(roomMuteRow && roomMuteRow.seat_settings, {});
        if (typeof muteSettings.global_mute === 'boolean') roomState.allSeatsMuted = muteSettings.global_mute;
        else {
          const guestSeats = await all('SELECT is_muted FROM room_seats WHERE room_id = ? AND seat_index > 0', [roomId]);
          roomState.allSeatsMuted = guestSeats.length > 0 && guestSeats.every(seat => !!seat.is_muted);
        }
      } catch (e) {}
    }

    // تحميل المطرودين والمكتومين المحفوظين
    try {
      const restr = await all('SELECT user_id, type FROM room_restrictions WHERE room_id = ?', [roomId]);
      restr.forEach(r => (r.type === 'ban' ? roomState.bannedUsers : roomState.mutedChatUsers).add(r.user_id));
    } catch (e) { console.error('load restrictions error:', e); }

    // Check if user is banned from this room
    if (user && user.id && roomState.bannedUsers.has(user.id)) {
      return socket.emit('room_kicked_notice', { message: 'لقد تم طردك من هذه الغرفة بواسطة إدارة الروم!' });
    }

    // الدخول إلى الغرفة لا يصعّد أحداً إلى المقعد أبداً (حتى المالك/الأدمن/المضيف):
    // أي مقعد عالق باسمه من جلسة سابقة يُحرَّر، والصعود يتم فقط بنقرة منه على المقعد.
    if (user && user.id) {
      try {
        const staleSeats = await all('SELECT seat_index, is_muted FROM room_seats WHERE room_id = ? AND user_id = ?', [roomId, user.id]);
        for (const st of staleSeats) {
          await run('UPDATE room_seats SET user_id = NULL, is_muted = ? WHERE room_id = ? AND seat_index = ?', [st.is_muted ? 1 : 0, roomId, st.seat_index]);
          io.to(`room:${roomId}`).emit('seat_updated', { seatIndex: st.seat_index, user: null, isMuted: !!st.is_muted });
        }
        roomState.speakers.delete(user.id);
      } catch (e) { console.error('stale seat cleanup on join error:', e); }
    }

    // حفظ كل من يدخل الغرفة في قائمة الأعضاء
    if (user && user.id) {
      try {
        await run(`INSERT INTO room_members (room_id, user_id) VALUES (?, ?)
          ON CONFLICT(room_id, user_id) DO UPDATE SET last_joined = CURRENT_TIMESTAMP, visits = visits + 1`, [roomId, user.id]);
      } catch (e) { console.error('save member error:', e); }
      try {
        await run(`INSERT INTO room_visits (user_id, room_id) VALUES (?, ?)
          ON CONFLICT(user_id, room_id) DO UPDATE SET last_visited = CURRENT_TIMESTAMP`, [user.id, roomId]);
      } catch (e) { console.error('save visit error:', e); }
    }

    let joinedUserObj = user;
    if (user && user.id) {
      const dbUser = await get('SELECT id, name, avatar, avatar_frame, chat_frame, entry_effect, level, wealth_level, charm_level, soul_planet, bio, role FROM users WHERE id = ?', [user.id]) || user;
      joinedUserObj = dbUser;
      roomState.activeAudience.set(user.id, dbUser);
    }

    const audienceList = Array.from(roomState.activeAudience.values());
    const isChatMuted = user && user.id ? roomState.mutedChatUsers.has(user.id) : false;

    // Notify room occupants
    io.to(`room:${roomId}`).emit('user_joined_room', {
      user: joinedUserObj,
      audienceCount: audienceList.length,
      audience: audienceList
    });

    // تأثير الدخول يظهر فقط لمن يملك قالب دخول مفعّلاً
    if (joinedUserObj && joinedUserObj.id && joinedUserObj.entry_effect) {
      try {
        const tpl = await getOwnedEntryTemplate(joinedUserObj.id, joinedUserObj.entry_effect);
        if (tpl) {
          io.to(`room:${roomId}`).emit('room_entry_effect', {
            user: joinedUserObj,
            effectId: tpl.id,
            imageUrl: tpl.image_url
          });
        }
      } catch (e) { console.error('entry effect error:', e); }
    }


    // ترحيب تلقائي باسم صاحب الغرفة: "أهلاً، @اسم_الداخل" (مرة كل دقيقة لكل شخص في كل غرفة لمنع التكرار عند إعادة الاتصال)
    if (joinedUserObj && joinedUserObj.id) {
      try {
        const welcomeKey = `${roomId}:${joinedUserObj.id}`;
        const lastWelcome = recentRoomWelcomes.get(welcomeKey) || 0;
        if (Date.now() - lastWelcome > 60 * 1000) {
          recentRoomWelcomes.set(welcomeKey, Date.now());
          const roomRow = await get('SELECT host_id FROM rooms WHERE id = ?', [roomId]);
          if (roomRow && roomRow.host_id && roomRow.host_id !== joinedUserObj.id) {
            const host = await get('SELECT * FROM users WHERE id = ?', [roomRow.host_id]);
            if (host) {
              const mention = joinedUserObj.name || 'ضيف';
              setTimeout(() => {
                io.to(`room:${roomId}`).emit('room_message', {
                  id: `welcome-${Date.now()}-${joinedUserObj.id}`,
                  sender_id: host.id,
                  sender_name: host.name,
                  sender_avatar: host.avatar,
                  sender_frame: host.avatar_frame,
                  sender_chat_frame: host.chat_frame || '',
                  sender_level: host.level,
                  sender_wealth_level: host.wealth_level || 3,
                  sender_charm_level: host.charm_level || 4,
                  sender_role: host.role,
                  message_type: 'text',
                  auto_welcome: true,
                  welcome_mention: mention,
                  content: `أهلاً، @${mention}`,
                  created_at: new Date().toISOString()
                });
              }, 700);
            }
          }
        }
      } catch (e) { console.error('auto welcome error:', e); }
    }

    // Notify lobby of accurate real occupants count
    io.emit('room_occupants_updated', {
      roomId,
      count: audienceList.length,
      preview: buildAudiencePreview(roomId)
    });

    // Send initial room presence & full audience array to this user
    socket.emit('room_presence_sync', {
      audienceCount: audienceList.length,
      audience: audienceList,
      pkState: roomState.pkState,
      isChatMuted,
      mutedChatUsers: Array.from(roomState.mutedChatUsers)
    });
  });

  // 3. Leaving Voice Room
  socket.on('leave_room', async ({ roomId, userId }) => {
    if (!roomId) return;
    socket.leave(`room:${roomId}`);
    if (activeRoomStates.has(roomId)) {
      const roomState = activeRoomStates.get(roomId);
      if (userId) {
        roomState.activeAudience.delete(userId);
        roomState.speakers.delete(userId);
      }
      const audienceList = Array.from(roomState.activeAudience.values());
      socket.to(`room:${roomId}`).emit('user_left_room', {
        userId,
        audienceCount: audienceList.length,
        audience: audienceList
      });

      // Notify lobby of accurate real occupants count
      io.emit('room_occupants_updated', {
        roomId,
        count: audienceList.length,
        preview: buildAudiencePreview(roomId)
      });
    }

    if (userId) {
      try {
        const seats = await all('SELECT seat_index, is_muted FROM room_seats WHERE room_id = ? AND user_id = ?', [roomId, userId]);
        if (seats && seats.length > 0) {
          for (const s of seats) {
            await run('UPDATE room_seats SET user_id = NULL, is_muted = ? WHERE room_id = ? AND seat_index = ?', [s.is_muted ? 1 : 0, roomId, s.seat_index]);
            io.to(`room:${roomId}`).emit('seat_updated', {
              seatIndex: s.seat_index,
              user: null,
              isMuted: !!s.is_muted
            });
          }
        }
      } catch (e) {
        console.error('Leave room seat cleanup error:', e);
      }
    }
  });

  // 4. Room Chat Message
  socket.on('send_room_message', async ({ roomId, userId, content }) => {
    if (!roomId || !userId || !content) return;

    // Check if user is muted from writing in public chat
    const roomState = activeRoomStates.get(roomId);
    if (roomState && roomState.mutedChatUsers && roomState.mutedChatUsers.has(userId)) {
      return socket.emit('chat_error', {
        message: 'تم كتمك من الكتابة في الدردشة العامة من قِبل إدارة الغرفة 🔇'
      });
    }

    try {
      const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
      if (!user) return;

      const msgId = `msg-${Date.now()}`;
      await run(`
        INSERT INTO messages (id, sender_id, room_id, message_type, content)
        VALUES (?, ?, ?, 'text', ?)
      `, [msgId, userId, roomId, content]);

      const payload = {
        id: msgId,
        sender_id: user.id,
        sender_name: user.name,
        sender_avatar: user.avatar,
        sender_frame: user.avatar_frame,
        sender_chat_frame: user.chat_frame || '',
        sender_level: user.level,
        sender_wealth_level: user.wealth_level || 3,
        sender_charm_level: user.charm_level || 4,
        sender_role: user.role,
        message_type: 'text',
        content,
        created_at: new Date().toISOString()
      };

      io.to(`room:${roomId}`).emit('room_message', payload);
    } catch (err) {
      console.error('Room message error:', err);
    }
  });

  // إرسال إيموجي (مرفوع من الإدارة): فوق المقعد إن كان المرسل على مقعد، وإلا في الدردشة العامة
  socket.on('send_room_emoji', async ({ roomId, userId, emojiId }) => {
    if (!roomId || !userId || !emojiId) return;
    try {
      const roomState = activeRoomStates.get(roomId);
      if (roomState && roomState.mutedChatUsers && roomState.mutedChatUsers.has(userId)) {
        return socket.emit('chat_error', { message: 'تم كتمك من الكتابة في الدردشة العامة من قِبل إدارة الغرفة 🔇' });
      }
      const em = await get('SELECT id, name, image_url FROM room_emojis WHERE id = ? AND is_active = 1', [emojiId]);
      if (!em) return;
      const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
      if (!user) return;

      // على المقعد: يظهر فوق المقعد فقط. خارج المقعد: يظهر في الدردشة العامة فقط.
      // (نتحقق من المقعد من قاعدة البيانات لا من العميل)
      const seat = await get('SELECT seat_index FROM room_seats WHERE room_id = ? AND user_id = ?', [roomId, userId]);
      if (seat) {
        io.to(`room:${roomId}`).emit('seat_emoji_broadcast', {
          roomId,
          seatIndex: seat.seat_index,
          emojiId: em.id,
          emojiSvg: `<img src="${em.image_url}" alt="" style="width:100%;height:100%;object-fit:contain;" />`,
          emojiName: em.name,
          user: { id: user.id, name: user.name }
        });
        return;
      }

      const msgId = `msg-${Date.now()}`;
      await run(`INSERT INTO messages (id, sender_id, room_id, message_type, content) VALUES (?, ?, ?, 'emoji', ?)`,
        [msgId, userId, roomId, em.image_url]);

      io.to(`room:${roomId}`).emit('room_message', {
        id: msgId,
        sender_id: user.id,
        sender_name: user.name,
        sender_avatar: user.avatar,
        sender_frame: user.avatar_frame,
        sender_chat_frame: user.chat_frame || '',
        sender_level: user.level,
        sender_wealth_level: user.wealth_level || 3,
        sender_charm_level: user.charm_level || 4,
        sender_role: user.role,
        message_type: 'emoji',
        content: em.image_url,
        created_at: new Date().toISOString()
      });
    } catch (err) {
      console.error('Room emoji error:', err);
    }
  });

  // 4b. Trigger Room Entry Effect (from Accessories Menu)
  socket.on('trigger_entry_effect', async ({ roomId, user, effectId }) => {
    if (!roomId || !effectId) return;
    try {
      const uid = onlineUsers.get(socket.id) || (user && user.id);
      const tpl = await getOwnedEntryTemplate(uid, effectId);
      if (!tpl) return; // لا يُعرض إلا قالب يملكه المستخدم فعلاً
      io.to(`room:${roomId}`).emit('room_entry_effect', {
        user,
        effectId: tpl.id,
        imageUrl: tpl.image_url
      });
    } catch (e) { console.error('trigger entry effect error:', e); }
  });

  // 5. Take Seat (Up to stage)
  socket.on('take_seat', async ({ roomId, seatIndex, userId }) => {
    if (!roomId || seatIndex === undefined || !userId) return;

    try {
      // Check if target seat is seat 0 (the Host Throne)
      if (seatIndex === 0) {
        const room = await get('SELECT host_id FROM rooms WHERE id = ?', [roomId]);
        const userObj = await get('SELECT role FROM users WHERE id = ?', [userId]);
        const isOwner = userObj && userObj.role === 'owner';
        if (room && room.host_id !== userId && !isOwner) {
          return socket.emit('seat_error', { message: 'هذا المقعد مخصص لصاحب الغرفة (المضيف) فقط 👑' });
        }
      }

      // Check if target seat is locked
      const roomRow = await get('SELECT seat_count FROM rooms WHERE id = ?', [roomId]);
      if (roomRow && seatIndex > (roomRow.seat_count || 8)) {
        return socket.emit('seat_error', { message: 'هذا المقعد غير متاح في هذه الغرفة!' });
      }
      {
        const sRow = await get('SELECT seat_settings, host_id FROM rooms WHERE id = ?', [roomId]);
        const ss = jparse(sRow && sRow.seat_settings, {});
        if (ss.who === 'members' && sRow && sRow.host_id !== userId) {
          const mem = await get('SELECT 1 AS x FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, userId]);
          const mod = await get('SELECT 1 AS x FROM room_moderators WHERE room_id = ? AND user_id = ?', [roomId, userId]);
          const u2 = await get('SELECT role FROM users WHERE id = ?', [userId]);
          if (!mem && !mod && !(u2 && ROOM_STAFF_ROLES.includes(u2.role))) {
            return socket.emit('seat_error', { message: 'الصعود إلى المايك متاح لأعضاء الغرفة فقط' });
          }
        }
      }
      const targetSeat = await get('SELECT * FROM room_seats WHERE room_id = ? AND seat_index = ?', [roomId, seatIndex]);
      if (targetSeat && targetSeat.is_locked) {
        return socket.emit('seat_error', { message: 'هذا المقعد مقفل حالياً!' });
      }
      if (targetSeat && targetSeat.user_id && targetSeat.user_id !== userId) {
        return socket.emit('seat_error', { message: 'هذا الكرسي محجوز حالياً!' });
      }

      // Check if user is currently occupying ANY OTHER seat in this room
      const prevSeats = await all('SELECT seat_index, is_muted FROM room_seats WHERE room_id = ? AND user_id = ? AND seat_index != ?', [roomId, userId, seatIndex]);
      if (prevSeats && prevSeats.length > 0) {
        for (const prev of prevSeats) {
          await run('UPDATE room_seats SET user_id = ?, is_muted = ? WHERE room_id = ? AND seat_index = ?', [null, prev.is_muted ? 1 : 0, roomId, prev.seat_index]);
          io.to(`room:${roomId}`).emit('seat_updated', {
            seatIndex: prev.seat_index,
            user: null,
            isMuted: !!prev.is_muted
          });
        }
      }

      // Assign requested seat while preserving the admin mute policy of that seat.
      const seatMutePolicy = targetSeat && targetSeat.is_muted ? 1 : 0;
      await run('UPDATE room_seats SET user_id = ?, is_muted = ? WHERE room_id = ? AND seat_index = ?', [userId, seatMutePolicy, roomId, seatIndex]);

      const user = await get('SELECT id, name, avatar, avatar_frame, level, charm_level FROM users WHERE id = ?', [userId]);

      io.to(`room:${roomId}`).emit('seat_updated', {
        seatIndex,
        user,
        isMuted: !!seatMutePolicy
      });
    } catch (err) {
      console.error('Take seat error:', err);
    }
  });

  // 6. Leave Seat (Down from stage)
  socket.on('leave_seat', async ({ roomId, seatIndex, userId }) => {
    if (!roomId) return;
    try {
      let seatsToLeave = [];
      if (userId) {
        seatsToLeave = await all('SELECT seat_index, is_muted FROM room_seats WHERE room_id = ? AND user_id = ?', [roomId, userId]);
      }
      if ((!seatsToLeave || seatsToLeave.length === 0) && seatIndex !== undefined) {
        const existingSeat = await get('SELECT is_muted FROM room_seats WHERE room_id = ? AND seat_index = ?', [roomId, seatIndex]);
        seatsToLeave = [{ seat_index: seatIndex, is_muted: existingSeat && existingSeat.is_muted ? 1 : 0 }];
      }

      for (const s of (seatsToLeave || [])) {
        await run('UPDATE room_seats SET user_id = NULL, is_muted = ? WHERE room_id = ? AND seat_index = ?', [s.is_muted ? 1 : 0, roomId, s.seat_index]);
        io.to(`room:${roomId}`).emit('seat_updated', {
          seatIndex: s.seat_index,
          user: null,
          isMuted: !!s.is_muted
        });
      }
      if (userId) {
        io.to(`room:${roomId}`).emit('webrtc_stream_ended', {
          roomId,
          streamType: 'voice_seat',
          userId
        });
      }
    } catch (err) {
      console.error('Leave seat error:', err);
    }
  });

  // Seat Emoji / Animated Sticker Reaction (Over Mic Seat Avatar)
  socket.on('seat_emoji_reaction', async ({ roomId, seatIndex, emojiId, emojiSvg, emojiName, user }) => {
    if (!roomId || seatIndex === undefined || seatIndex === null) return;
    io.to(`room:${roomId}`).emit('seat_emoji_broadcast', {
      roomId,
      seatIndex,
      emojiId,
      emojiSvg,
      emojiName,
      user
    });
  });

  // 7. Toggle Mute
  socket.on('toggle_mute', async ({ roomId, seatIndex, isMuted }) => {
    if (!roomId || seatIndex === undefined) return;
    try {
      const seat = await get('SELECT user_id, is_muted FROM room_seats WHERE room_id = ? AND seat_index = ?', [roomId, seatIndex]);
      const roomState = activeRoomStates.get(roomId);
      if (!isMuted && roomState && roomState.allSeatsMuted && seat && seat.is_muted) {
        return socket.emit('seat_error', { message: 'هذا المقعد مكتوم من الإدارة، ولا يمكن فك الكتم إلا بواسطة الأدمن 🔇' });
      }
      const targetUserId = seat ? seat.user_id : null;
      await run('UPDATE room_seats SET is_muted = ? WHERE room_id = ? AND seat_index = ?', [isMuted ? 1 : 0, roomId, seatIndex]);
      io.to(`room:${roomId}`).emit('seat_mute_changed', {
        roomId,
        seatIndex,
        userId: targetUserId,
        isMuted: !!isMuted
      });
    } catch (err) {
      console.error('Mute toggle error:', err);
    }
  });

  // 8. Speaking / Sound Wave Indicator
  socket.on('mic_speaking', ({ roomId, userId, isSpeaking, volume }) => {
    if (!roomId || !userId) return;
    // Broadcast to room so avatars pulse with sound waves
    socket.to(`room:${roomId}`).emit('user_speaking_status', {
      userId,
      isSpeaking,
      volume: volume || 0.5
    });
  });

  // 9. Soundboard Effects (Claps, Laughter, Cheers, etc.)
  socket.on('play_sound_effect', ({ roomId, effect, soundName, senderName }) => {
    if (!roomId) return;
    io.to(`room:${roomId}`).emit('sound_effect_played', {
      effect,
      soundName,
      senderName
    });
  });

  // 9b. Music played from a microphone seat. The audio itself is sent through
  // the existing WebRTC voice stream; this event only synchronizes the small
  // now-playing indicator for the other participants.
  socket.on('room_music_started', ({ roomId, userId, seatIndex, title, trackId, cover }) => {
    if (!roomId || !userId || seatIndex === undefined || seatIndex === null) return;
    if (currentRoomId !== roomId) return;
    const payload = { roomId, userId, seatIndex, title: title || 'موسيقى', trackId: trackId || '', cover: cover || '' };
    if (!roomMusicState.has(roomId)) roomMusicState.set(roomId, new Map());
    roomMusicState.get(roomId).set(String(userId), payload);   // نحفظ حالة كل شخص ليعرفها كل من يدخل الغرفة لاحقاً
    io.to(`room:${roomId}`).emit('room_music_started', payload);
  });

  socket.on('room_music_stopped', ({ roomId, userId, seatIndex }) => {
    if (!roomId || !userId || currentRoomId !== roomId) return;
    const mm = roomMusicState.get(roomId);
    if (mm) { mm.delete(String(userId)); if (!mm.size) roomMusicState.delete(roomId); }
    io.to(`room:${roomId}`).emit('room_music_stopped', { roomId, userId, seatIndex });
  });

  // زائر جديد يسأل: هل هناك موسيقى تعمل الآن؟ — نرسل الحالة له وحده (إن كان صاحبها ما زال على المقعد)
  socket.on('room_music_sync_request', async ({ roomId }) => {
    try {
      if (!roomId || currentRoomId !== roomId) return;
      const mm = roomMusicState.get(roomId);
      if (!mm || !mm.size) return;
      for (const [uid, cur] of Array.from(mm.entries())) {
        const seat = await get('SELECT user_id FROM room_seats WHERE room_id = ? AND seat_index = ?', [roomId, cur.seatIndex]);
        if (!seat || String(seat.user_id) !== String(cur.userId)) { mm.delete(uid); continue; }
        socket.emit('room_music_started', cur);
      }
      if (!mm.size) roomMusicState.delete(roomId);
    } catch (e) {}
  });

  // 9c. مزامنة تشغيل أغنية يوتيوب: صاحب المقعد يبثّ حالة المشغّل، والبقية يشغّلون نفس المقطع عندهم
  socket.on('room_yt_state', async (d) => {
    try {
      if (!d || !d.roomId || currentRoomId !== d.roomId) return;
      const uid = onlineUsers.get(socket.id);
      if (!uid) return;
      const state = ['play', 'pause', 'stop'].includes(d.state) ? d.state : null;
      if (!state) return;
      const seat = await get('SELECT seat_index, is_muted FROM room_seats WHERE room_id = ? AND user_id = ?', [d.roomId, uid]);
      if (!seat || seat.is_muted) return;
      const videoId = String(d.videoId || '');
      if (state !== 'stop' && !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return;
      // الوضع العادي: المستمعون يسمعون عبر ميكرفون المقعد (WebRTC) فلا حاجة للمزامنة.
      // الوضع الاحتياطي (fallback): عند فشل جلب الصوت عبر الخادم يشغّل صاحب المقعد مشغّل يوتيوب مخفياً
      // ويُبثّ حالته ليشغّل المستمعون نفس المقطع (صوتاً فقط) ويتزامنوا معه.
      if (!d.fallback) return;
      socket.to(`room:${d.roomId}`).emit('room_yt_state', {
        fallback: true,
        roomId: d.roomId, userId: uid, seatIndex: seat.seat_index, state, videoId,
        title: String(d.title || '').slice(0, 100), time: Math.max(0, Number(d.time) || 0), sentAt: Date.now()
      });
    } catch (e) { /* مزامنة اختيارية */ }
  });

  // 10. Room Games: Roll Dice 🎲
  socket.on('roll_dice', ({ roomId, user }) => {
    if (!roomId) return;
    const diceValue = Math.floor(Math.random() * 6) + 1;
    io.to(`room:${roomId}`).emit('dice_rolled', {
      user,
      value: diceValue,
      timestamp: Date.now()
    });
  });

  // 11. Room Games: Lucky Wheel 🎡
  socket.on('spin_wheel', ({ roomId, user }) => {
    if (!roomId) return;
    const prizes = [
      { label: '50 🪙 عملة', value: 50 },
      { label: '100 🪙 عملة', value: 100 },
      { label: 'تحدي غناء 🎤', value: 'dare' },
      { label: '10 💎 ألماسة', value: 10 },
      { label: 'ضحكة شريرة 😂', value: 'fun' },
      { label: '500 🪙 جاكبوت!', value: 500 }
    ];
    const prize = prizes[Math.floor(Math.random() * prizes.length)];
    io.to(`room:${roomId}`).emit('wheel_spun', {
      user,
      prize,
      timestamp: Date.now()
    });
  });

  // 12. Room Games: PK Battle Mode 🔥
  function startPkForRoom(roomId, hostUser, challengerUser, duration = 120) {
    if (pkIntervals.has(roomId)) {
      clearInterval(pkIntervals.get(roomId));
      pkIntervals.delete(roomId);
    }

    if (!activeRoomStates.has(roomId)) {
      activeRoomStates.set(roomId, {
        pkState: null,
        activeAudience: new Map(),
        speakers: new Set(),
        mutedChatUsers: new Set(),
        bannedUsers: new Set(),
        cohostRequests: new Map()
      });
    }

    const roomState = activeRoomStates.get(roomId);
    const pkState = {
      active: true,
      host: hostUser || { name: 'المضيف', avatar: '/avatars/avatar-1.png' },
      challenger: challengerUser || { name: 'المنافس', avatar: '/avatars/avatar-2.png' },
      hostScore: 100,
      challengerScore: 100,
      timeLeft: duration,
      startedAt: Date.now()
    };
    roomState.pkState = pkState;

    io.to(`room:${roomId}`).emit('pk_started', pkState);

    const intervalId = setInterval(() => {
      if (!roomState.pkState || !roomState.pkState.active) {
        clearInterval(intervalId);
        pkIntervals.delete(roomId);
        return;
      }

      roomState.pkState.timeLeft--;
      io.to(`room:${roomId}`).emit('pk_timer_tick', {
        timeLeft: roomState.pkState.timeLeft,
        hostScore: roomState.pkState.hostScore,
        challengerScore: roomState.pkState.challengerScore
      });

      if (roomState.pkState.timeLeft <= 0) {
        clearInterval(intervalId);
        pkIntervals.delete(roomId);
        roomState.pkState.active = false;

        let winner = 'draw';
        let loser = 'none';
        if (roomState.pkState.hostScore > roomState.pkState.challengerScore) {
          winner = 'host';
          loser = 'challenger';
        } else if (roomState.pkState.challengerScore > roomState.pkState.hostScore) {
          winner = 'challenger';
          loser = 'host';
        }

        const penalty = SOULCHILL_PK_PENALTIES[Math.floor(Math.random() * SOULCHILL_PK_PENALTIES.length)];

        io.to(`room:${roomId}`).emit('pk_ended', {
          winner,
          loser,
          hostScore: roomState.pkState.hostScore,
          challengerScore: roomState.pkState.challengerScore,
          host: roomState.pkState.host,
          challenger: roomState.pkState.challenger,
          penalty
        });
      }
    }, 1000);

    pkIntervals.set(roomId, intervalId);
  }

  socket.on('start_pk', ({ roomId, hostUser, challengerUser, duration = 120 }) => {
    if (!roomId) return;
    startPkForRoom(roomId, hostUser, challengerUser, duration);
  });

  socket.on('end_pk', ({ roomId }) => {
    if (!roomId) return;
    if (pkIntervals.has(roomId)) {
      clearInterval(pkIntervals.get(roomId));
      pkIntervals.delete(roomId);
    }
    const roomState = activeRoomStates.get(roomId);
    if (roomState && roomState.pkState && roomState.pkState.active) {
      roomState.pkState.active = false;
      let winner = 'draw';
      let loser = 'none';
      if (roomState.pkState.hostScore > roomState.pkState.challengerScore) {
        winner = 'host';
        loser = 'challenger';
      } else if (roomState.pkState.challengerScore > roomState.pkState.hostScore) {
        winner = 'challenger';
        loser = 'host';
      }
      const penalty = SOULCHILL_PK_PENALTIES[Math.floor(Math.random() * SOULCHILL_PK_PENALTIES.length)];
      io.to(`room:${roomId}`).emit('pk_ended', {
        winner,
        loser,
        hostScore: roomState.pkState.hostScore,
        challengerScore: roomState.pkState.challengerScore,
        host: roomState.pkState.host,
        challenger: roomState.pkState.challenger,
        penalty,
        endedByHost: true
      });
    } else {
      io.to(`room:${roomId}`).emit('pk_ended_manually');
    }
  });

  socket.on('pk_support', ({ roomId, team, points = 50, user }) => {
    if (!roomId) return;
    const roomState = activeRoomStates.get(roomId);
    if (!roomState || !roomState.pkState) return;

    if (team === 'host') {
      roomState.pkState.hostScore += points;
    } else {
      roomState.pkState.challengerScore += points;
    }

    io.to(`room:${roomId}`).emit('pk_score_updated', {
      hostScore: roomState.pkState.hostScore,
      challengerScore: roomState.pkState.challengerScore,
      user,
      team,
      points
    });
  });

  // 13. Live Video Stream Events
  socket.on('stream_video_toggle', ({ roomId, userId, isVideoOn }) => {
    if (!roomId) return;
    io.to(`room:${roomId}`).emit('host_video_state_changed', { userId, isVideoOn });
  });

  socket.on('stream_like', async ({ roomId, userId }) => {
    if (!roomId) return;
    try {
      await run('UPDATE rooms SET likes_count = likes_count + 1 WHERE id = ?', [roomId]);
      io.to(`room:${roomId}`).emit('stream_like_burst', {
        userId,
        timestamp: Date.now()
      });
    } catch (err) {}
  });

  socket.on('stream_bullet_chat', ({ roomId, user, text }) => {
    if (!roomId || !text) return;
    io.to(`room:${roomId}`).emit('stream_bullet_message', {
      user,
      text,
      timestamp: Date.now()
    });
  });

  // 14. Admin Moderation Privileges (Room Host & Supreme Owner)
  socket.on('admin_mute_seat', async ({ roomId, seatIndex, adminId, isMuted }) => {
    if (!roomId || seatIndex === undefined) return;
    try {
      const room = await get('SELECT * FROM rooms WHERE id = ?', [roomId]);
      const admin = await get('SELECT * FROM users WHERE id = ?', [adminId]);
      if (!room || !admin || !(await canManageRoom(room, admin))) return;

      const seat = await get('SELECT user_id FROM room_seats WHERE room_id = ? AND seat_index = ?', [roomId, seatIndex]);
      const targetUserId = seat ? seat.user_id : null;

      await run('UPDATE room_seats SET is_muted = ? WHERE room_id = ? AND seat_index = ?', [isMuted ? 1 : 0, roomId, seatIndex]);
      
      const payload = {
        roomId,
        seatIndex,
        userId: targetUserId,
        isMuted: !!isMuted,
        adminName: admin.name
      };

      io.to(`room:${roomId}`).emit('seat_mute_changed', payload);
      if (targetUserId) {
        io.to(`room:${roomId}`).emit('user_force_muted', payload);
      }
    } catch (e) {
      console.error('admin_mute_seat error:', e);
    }
  });

  socket.on('admin_kick_seat', async ({ roomId, seatIndex, adminId }) => {
    if (!roomId || seatIndex === undefined) return;
    try {
      const room = await get('SELECT * FROM rooms WHERE id = ?', [roomId]);
      const admin = await get('SELECT * FROM users WHERE id = ?', [adminId]);
      if (!room || !admin || !(await canManageRoom(room, admin))) return;

      const seat = await get('SELECT user_id, is_muted FROM room_seats WHERE room_id = ? AND seat_index = ?', [roomId, seatIndex]);
      const kickedUserId = seat ? seat.user_id : null;
      const keepMuted = !!(seat && seat.is_muted);

      await run('UPDATE room_seats SET user_id = NULL, is_muted = ? WHERE room_id = ? AND seat_index = ?', [keepMuted ? 1 : 0, roomId, seatIndex]);
      io.to(`room:${roomId}`).emit('seat_updated', { seatIndex, user: null, isMuted: keepMuted });
      if (kickedUserId) {
        io.to(`room:${roomId}`).emit('user_kicked_from_seat', { seatIndex, userId: kickedUserId, adminName: admin.name });
        io.to(`room:${roomId}`).emit('webrtc_stream_ended', {
          roomId,
          streamType: 'voice_seat',
          userId: kickedUserId
        });
      }
    } catch (e) {
      console.error('admin_kick_seat error:', e);
    }
  });

  socket.on('admin_lock_seat', async ({ roomId, seatIndex, adminId, isLocked }) => {
    if (!roomId || seatIndex === undefined) return;
    try {
      const room = await get('SELECT * FROM rooms WHERE id = ?', [roomId]);
      const admin = await get('SELECT * FROM users WHERE id = ?', [adminId]);
      if (!room || !admin || !(await canManageRoom(room, admin))) return;

      let vacatedUserId = null;
      if (isLocked) {
        const seat = await get('SELECT user_id, is_muted FROM room_seats WHERE room_id = ? AND seat_index = ?', [roomId, seatIndex]);
        if (seat && seat.user_id) {
          vacatedUserId = seat.user_id;
          const keepMuted = !!(seat.is_muted || activeRoomStates.get(roomId)?.allSeatsMuted);
          await run('UPDATE room_seats SET user_id = NULL, is_muted = ? WHERE room_id = ? AND seat_index = ?', [keepMuted ? 1 : 0, roomId, seatIndex]);
          io.to(`room:${roomId}`).emit('seat_updated', { seatIndex, user: null, isMuted: keepMuted });
          io.to(`room:${roomId}`).emit('user_kicked_from_seat', { seatIndex, userId: vacatedUserId, adminName: admin.name, reason: 'lock_seat' });
          io.to(`room:${roomId}`).emit('webrtc_stream_ended', {
            roomId,
            streamType: 'voice_seat',
            userId: vacatedUserId
          });
        }
      }

      await run('UPDATE room_seats SET is_locked = ? WHERE room_id = ? AND seat_index = ?', [isLocked ? 1 : 0, roomId, seatIndex]);
      io.to(`room:${roomId}`).emit('seat_lock_changed', { seatIndex, isLocked: !!isLocked, vacatedUserId });
    } catch (e) {
      console.error('admin_lock_seat error:', e);
    }
  });

  // Admin Lock or Unlock ALL Seats
  // كتم صوت الكل / إلغاء كتم الكل (قائمة المقعد في الفيديو)
  socket.on('admin_mute_all_seats', async ({ roomId, adminId, isMuted }) => {
    if (!roomId || !adminId) return;
    try {
      const room = await get('SELECT * FROM rooms WHERE id = ?', [roomId]);
      const admin = await get('SELECT * FROM users WHERE id = ?', [adminId]);
      if (!room || !admin || !(await canManageRoom(room, admin))) return;
      const roomState = activeRoomStates.get(roomId);
      if (roomState) roomState.allSeatsMuted = !!isMuted;
      const seatSettings = jparse(room.seat_settings, {});
      seatSettings.global_mute = !!isMuted;
      await run('UPDATE rooms SET seat_settings = ? WHERE id = ?', [JSON.stringify(seatSettings), roomId]);
      const seats = await all('SELECT seat_index, user_id FROM room_seats WHERE room_id = ? AND seat_index > 0', [roomId]);
      for (const st of seats) {
        await run('UPDATE room_seats SET is_muted = ? WHERE room_id = ? AND seat_index = ?', [isMuted ? 1 : 0, roomId, st.seat_index]);
        const payload = { roomId, seatIndex: st.seat_index, userId: st.user_id, isMuted: !!isMuted, adminName: admin.name };
        io.to(`room:${roomId}`).emit('seat_mute_changed', payload);
        io.to(`room:${roomId}`).emit('user_force_muted', payload);
      }
      io.to(`room:${roomId}`).emit('all_seats_mute_changed', { roomId, isMuted: !!isMuted, adminName: admin.name });
    } catch (e) { console.error('admin_mute_all_seats error:', e); }
  });
  socket.on('admin_lock_all_seats', async ({ roomId, adminId, isLocked }) => {
    if (!roomId || !adminId) return;
    try {
      const room = await get('SELECT * FROM rooms WHERE id = ?', [roomId]);
      const admin = await get('SELECT * FROM users WHERE id = ?', [adminId]);
      if (!room || !admin || !(await canManageRoom(room, admin))) return;

      // Lock or unlock seats 1 to 8 in DB
      await run('UPDATE room_seats SET is_locked = ? WHERE room_id = ? AND seat_index > 0', [isLocked ? 1 : 0, roomId]);

      // If locking, also vacate all users off guest seats 1-8 and force stop their streams
      const vacatedUserIds = [];
      if (isLocked) {
        const occupied = await all('SELECT seat_index, user_id FROM room_seats WHERE room_id = ? AND seat_index > 0 AND user_id IS NOT NULL', [roomId]);
        for (const s of occupied) {
          vacatedUserIds.push(s.user_id);
          await run('UPDATE room_seats SET user_id = NULL, is_muted = 1 WHERE room_id = ? AND seat_index = ?', [roomId, s.seat_index]);
          io.to(`room:${roomId}`).emit('seat_updated', {
            seatIndex: s.seat_index,
            user: null,
            isMuted: true
          });
          io.to(`room:${roomId}`).emit('user_kicked_from_seat', {
            seatIndex: s.seat_index,
            userId: s.user_id,
            adminName: admin.name,
            reason: 'lock_all_seats'
          });
          io.to(`room:${roomId}`).emit('webrtc_stream_ended', {
            roomId,
            streamType: 'voice_seat',
            userId: s.user_id
          });
        }
      }

      io.to(`room:${roomId}`).emit('all_seats_lock_changed', {
        roomId,
        isLocked: !!isLocked,
        adminName: admin.name,
        vacatedUserIds
      });

      if (vacatedUserIds.length > 0) {
        io.to(`room:${roomId}`).emit('webrtc_speakers_force_stopped', {
          roomId,
          userIds: vacatedUserIds
        });
      }

      // System message in chat
      io.to(`room:${roomId}`).emit('room_message', {
        id: `sys-${Date.now()}`,
        sender_id: 'system',
        sender_name: '🛡️ إدارة الغرفة',
        sender_avatar: admin.avatar,
        sender_level: 99,
        message_type: 'system',
        content: isLocked 
          ? `قام مدير الغرفة [${admin.name}] بقفل جميع مقاعد المايك 🔒` 
          : `قام مدير الغرفة [${admin.name}] بفتح جميع مقاعد المايك للجمهور 🔓`,
        created_at: new Date().toISOString()
      });
    } catch (e) {
      console.error('admin_lock_all_seats error:', e);
    }
  });

  // Admin Kick User from Room
  socket.on('admin_kick_user_from_room', async ({ roomId, targetUserId, adminId }) => {
    if (!roomId || !targetUserId || !adminId) return;
    try {
      const room = await get('SELECT * FROM rooms WHERE id = ?', [roomId]);
      const admin = await get('SELECT * FROM users WHERE id = ?', [adminId]);
      if (!room || !admin || !(await canManageRoom(room, admin))) {
        return socket.emit('error_message', { message: 'ليس لديك صلاحيات إدارة هذه الغرفة!' });
      }

      const targetUser = await get('SELECT * FROM users WHERE id = ?', [targetUserId]);
      await run("INSERT OR IGNORE INTO room_restrictions (room_id, user_id, type) VALUES (?, ?, 'ban')", [roomId, targetUserId]);
      const roomState = activeRoomStates.get(roomId);
      if (roomState) {
        roomState.bannedUsers.add(targetUserId);
        roomState.activeAudience.delete(targetUserId);
        roomState.speakers.delete(targetUserId);
      }

      // Vacate their seat if on stage
      const seats = await all('SELECT seat_index, is_muted FROM room_seats WHERE room_id = ? AND user_id = ?', [roomId, targetUserId]);
      for (const s of seats) {
        await run('UPDATE room_seats SET user_id = NULL, is_muted = ? WHERE room_id = ? AND seat_index = ?', [s.is_muted ? 1 : 0, roomId, s.seat_index]);
        io.to(`room:${roomId}`).emit('seat_updated', {
          seatIndex: s.seat_index,
          user: null,
          isMuted: !!s.is_muted
        });
        io.to(`room:${roomId}`).emit('user_kicked_from_seat', {
          seatIndex: s.seat_index,
          userId: targetUserId,
          adminName: admin.name,
          reason: 'kick_room'
        });
        io.to(`room:${roomId}`).emit('webrtc_stream_ended', {
          roomId,
          streamType: 'voice_seat',
          userId: targetUserId
        });
      }

      const audienceList = roomState ? Array.from(roomState.activeAudience.values()) : [];
      io.to(`room:${roomId}`).emit('user_kicked_from_room', {
        roomId,
        targetUserId,
        targetUserName: targetUser ? targetUser.name : 'مستخدم',
        adminName: admin.name,
        audienceCount: audienceList.length,
        audience: audienceList
      });

      // Update lobby occupants count
      io.emit('room_occupants_updated', {
        roomId,
        count: audienceList.length,
        preview: buildAudiencePreview(roomId)
      });

      // System notice in chat
      io.to(`room:${roomId}`).emit('room_message', {
        id: `sys-${Date.now()}`,
        sender_id: 'system',
        sender_name: '🛡️ إدارة الغرفة',
        sender_avatar: admin.avatar,
        sender_level: 99,
        message_type: 'system',
        content: `قام مدير الغرفة [${admin.name}] بطرد [${targetUser ? targetUser.name : 'المستخدم'}] من الغرفة 🚪🚫`,
        created_at: new Date().toISOString()
      });
    } catch (e) {
      console.error('admin_kick_user_from_room error:', e);
    }
  });

  // Admin Mute User from Writing in Public Chat
  socket.on('admin_mute_user_chat', async ({ roomId, targetUserId, adminId, isMuted }) => {
    if (!roomId || !targetUserId || !adminId) return;
    try {
      const room = await get('SELECT * FROM rooms WHERE id = ?', [roomId]);
      const admin = await get('SELECT * FROM users WHERE id = ?', [adminId]);
      if (!room || !admin || !(await canManageRoom(room, admin))) {
        return socket.emit('error_message', { message: 'ليس لديك صلاحيات إدارة هذه الغرفة!' });
      }

      if (isMuted) {
        await run("INSERT OR IGNORE INTO room_restrictions (room_id, user_id, type) VALUES (?, ?, 'mute')", [roomId, targetUserId]);
      } else {
        await run("DELETE FROM room_restrictions WHERE room_id = ? AND user_id = ? AND type = 'mute'", [roomId, targetUserId]);
      }
      const roomState = activeRoomStates.get(roomId);
      if (roomState) {
        if (isMuted) {
          roomState.mutedChatUsers.add(targetUserId);
        } else {
          roomState.mutedChatUsers.delete(targetUserId);
        }
      }

      const targetUser = await get('SELECT * FROM users WHERE id = ?', [targetUserId]);

      io.to(`room:${roomId}`).emit('user_chat_mute_changed', {
        roomId,
        targetUserId,
        targetUserName: targetUser ? targetUser.name : 'مستخدم',
        isMuted: !!isMuted,
        adminName: admin.name
      });

      // System notice in chat
      io.to(`room:${roomId}`).emit('room_message', {
        id: `sys-${Date.now()}`,
        sender_id: 'system',
        sender_name: '🛡️ إدارة الغرفة',
        sender_avatar: admin.avatar,
        sender_level: 99,
        message_type: 'system',
        content: isMuted 
          ? `قام مدير الغرفة بكتم [${targetUser ? targetUser.name : 'المستخدم'}] من الكتابة العامة 🔇` 
          : `قام مدير الغرفة بإلغاء كتم الكتابة عن [${targetUser ? targetUser.name : 'المستخدم'}] 🔊`,
        created_at: new Date().toISOString()
      });
    } catch (e) {
      console.error('admin_mute_user_chat error:', e);
    }
  });

  socket.on('close_room', async ({ roomId, adminId }) => {
    if (!roomId) return;
    try {
      const room = await get('SELECT * FROM rooms WHERE id = ?', [roomId]);
      const admin = await get('SELECT * FROM users WHERE id = ?', [adminId]);
      if (!room || !admin || !(await canManageRoom(room, admin))) return;

      // Clean up room records in SQLite
      await run('DELETE FROM room_seats WHERE room_id = ?', [roomId]);
      await run('DELETE FROM messages WHERE room_id = ?', [roomId]);
      await run('DELETE FROM rooms WHERE id = ?', [roomId]);

      io.to(`room:${roomId}`).emit('room_closed_by_host', { roomId, adminName: admin.name });
      io.emit('room_deleted', { roomId });
    } catch (e) {
      console.error('close_room error:', e);
    }
  });

  // ============================================
  // 15b. المكالمات الصوتية الخاصة (تتطلب متابعة متبادلة)
  // ============================================
  socket.on('dm_call_invite', async ({ toUserId }) => {
    try {
      const callerId = currentUserId;
      if (!callerId || !toUserId || callerId === toUserId) return;
      if (!(await areMutualFollowers(callerId, toUserId))) {
        return socket.emit('dm_call_denied', { code: 'MUTUAL_FOLLOW_REQUIRED', message: MUTUAL_FOLLOW_MSG });
      }
      for (const c of dmCalls.values()) {
        if ([c.callerId, c.calleeId].includes(callerId) || [c.callerId, c.calleeId].includes(toUserId)) {
          return socket.emit('dm_call_denied', { code: 'BUSY', message: 'أحد الطرفين في مكالمة أخرى حالياً' });
        }
      }
      const targets = userSockets.get(toUserId);
      if (!targets || targets.size === 0) {
        return socket.emit('dm_call_denied', { code: 'OFFLINE', message: 'المستخدم غير متصل حالياً' });
      }
      const caller = await get('SELECT id, name, avatar FROM users WHERE id = ?', [callerId]);
      if (!caller) return;
      const callId = `call-${Date.now()}-${uuidv4().slice(0, 6)}`;
      dmCalls.set(callId, { callId, callerId, calleeId: toUserId, callerSocket: socket.id, calleeSocket: null, answered: false });
      socket.emit('dm_call_ringing', { callId });
      for (const sId of targets) io.to(sId).emit('dm_call_incoming', { callId, from: caller });
      // مهلة الرد 40 ثانية
      setTimeout(() => {
        const c = dmCalls.get(callId);
        if (c && !c.answered) endDmCall(callId, 'no_answer');
      }, 40000);
    } catch (e) { console.error('dm_call_invite error:', e); }
  });

  socket.on('dm_call_accept', ({ callId }) => {
    const c = dmCalls.get(callId);
    if (!c || c.calleeId !== currentUserId || c.answered) return;
    c.answered = true;
    c.calleeSocket = socket.id;
    io.to(c.callerSocket).emit('dm_call_accepted', { callId, calleeSocketId: socket.id });
    // أوقف الرنين على بقية أجهزة المستلم
    const targets = userSockets.get(c.calleeId);
    if (targets) for (const sId of targets) if (sId !== socket.id) io.to(sId).emit('dm_call_ended', { callId, reason: 'answered_elsewhere' });
  });

  socket.on('dm_call_reject', ({ callId }) => {
    const c = dmCalls.get(callId);
    if (!c || c.calleeId !== currentUserId) return;
    endDmCall(callId, 'rejected');
  });

  socket.on('dm_call_end', ({ callId }) => {
    const c = dmCalls.get(callId);
    if (!c || ![c.callerId, c.calleeId].includes(currentUserId)) return;
    endDmCall(callId, 'ended');
  });

  socket.on('dm_call_signal', ({ callId, data }) => {
    const c = dmCalls.get(callId);
    if (!c || !c.answered) return;
    let target = null;
    if (socket.id === c.callerSocket) target = c.calleeSocket;
    else if (socket.id === c.calleeSocket) target = c.callerSocket;
    if (target) io.to(target).emit('dm_call_signal', { callId, data });
  });

  socket.on('disconnect', () => {
    for (const c of Array.from(dmCalls.values())) {
      if (c.callerSocket === socket.id || c.calleeSocket === socket.id) endDmCall(c.callId, 'disconnected');
    }
    // تنظيف التوافق الصوتي: إزالة من طابور الانتظار + إنهاء أي جلسة نشطة لهذا السوكيت
    removeFromVoiceMatchQueue(socket.id);
    for (const s of Array.from(activeVoiceMatchSessions.values())) {
      if (s.userA.socketId === socket.id || s.userB.socketId === socket.id) {
        endVoiceMatchSession(s.id, 'disconnected');
      }
    }
  });

  // ============================================
  // 16. REAL WEBRTC AUDIO & VIDEO STREAMING SIGNALING
  // ============================================
  socket.on('webrtc_signal_offer', ({ targetSocketId, offer, streamType, user, roomId }) => {
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc_signal_offer', {
        senderSocketId: socket.id,
        offer,
        streamType, // 'video_broadcast', 'cohost_video', or 'voice_seat'
        user,
        roomId
      });
    }
  });

  socket.on('webrtc_signal_answer', ({ targetSocketId, answer, streamType, role }) => {
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc_signal_answer', {
        senderSocketId: socket.id,
        answer,
        streamType,
        role
      });
    }
  });

  socket.on('webrtc_signal_ice_candidate', ({ targetSocketId, candidate, streamType, role }) => {
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc_signal_ice_candidate', {
        senderSocketId: socket.id,
        candidate,
        streamType,
        role
      });
    }
  });

  socket.on('webrtc_request_stream', ({ roomId, userId }) => {
    if (!roomId) return;
    socket.to(`room:${roomId}`).emit('webrtc_stream_requested', {
      viewerSocketId: socket.id,
      userId
    });
  });

  socket.on('webrtc_broadcaster_ready', ({ roomId, userId, mediaType }) => {
    if (!roomId) return;
    socket.to(`room:${roomId}`).emit('webrtc_broadcaster_ready', {
      broadcasterSocketId: socket.id,
      userId,
      mediaType
    });
  });

  socket.on('webrtc_stream_ended', ({ roomId, streamType, userId }) => {
    if (roomId) {
      socket.to(`room:${roomId}`).emit('webrtc_stream_ended', {
        senderSocketId: socket.id,
        streamType,
        userId
      });
    }
  });

  // 15. Live 2-Person Co-Host Video Broadcast & Split-Screen
  // 1) Viewer requests to join live stream with the host
  socket.on('request_cohost_join', async ({ roomId, requester }) => {
    if (!roomId || !requester) return;
    if (!activeRoomStates.has(roomId)) {
      activeRoomStates.set(roomId, {
        pkState: null,
        activeAudience: new Map(),
        speakers: new Set(),
        mutedChatUsers: new Set(),
        bannedUsers: new Set(),
        cohostRequests: new Map()
      });
    }
    const roomState = activeRoomStates.get(roomId);
    if (!roomState.cohostRequests) roomState.cohostRequests = new Map();
    roomState.cohostRequests.set(requester.id, requester);

    // Find host of this room
    const room = await get('SELECT host_id FROM rooms WHERE id = ?', [roomId]);
    const hostId = room ? room.host_id : null;
    let sentToHost = false;
    if (hostId && userSockets.has(hostId)) {
      for (const sockId of userSockets.get(hostId)) {
        io.to(sockId).emit('cohost_request_received', {
          roomId,
          requester,
          requestsCount: roomState.cohostRequests.size,
          requests: Array.from(roomState.cohostRequests.values())
        });
        sentToHost = true;
      }
    }
    if (!sentToHost) {
      // Broadcast to room so any connected host in the room receives it
      socket.to(`room:${roomId}`).emit('cohost_request_received', {
        roomId,
        requester,
        requestsCount: roomState.cohostRequests.size,
        requests: Array.from(roomState.cohostRequests.values())
      });
    }
    // Also notify room about updated requests count
    io.to(`room:${roomId}`).emit('cohost_requests_updated', {
      count: roomState.cohostRequests.size,
      requests: Array.from(roomState.cohostRequests.values())
    });
  });

  // 2) Host accepts cohost request (or invites directly)
  socket.on('accept_cohost_request', async ({ roomId, cohostUser }) => {
    if (!roomId || !cohostUser) return;
    try {
      await run('UPDATE rooms SET co_host_id = ? WHERE id = ?', [cohostUser.id, roomId]);
      const room = await get('SELECT * FROM rooms WHERE id = ?', [roomId]);
      const hostUser = await get('SELECT id, name, avatar, avatar_frame FROM users WHERE id = ?', [room ? room.host_id : '']);

      const roomState = activeRoomStates.get(roomId);
      if (roomState && roomState.cohostRequests) {
        roomState.cohostRequests.delete(cohostUser.id);
      }

      // Notify the cohostUser specifically
      const cohostSockets = userSockets.get(cohostUser.id);
      if (cohostSockets) {
        for (const sId of cohostSockets) {
          io.to(sId).emit('cohost_request_accepted', { roomId, hostUser });
        }
      }

      // Broadcast to all viewers in room that cohost joined (without auto-starting PK)
      io.to(`room:${roomId}`).emit('cohost_joined_stream', {
        cohostUser,
        hostUser
      });
    } catch (e) {
      console.error('accept_cohost_request error:', e);
    }
  });

  // 3) Host rejects cohost request
  socket.on('reject_cohost_request', ({ roomId, targetUserId }) => {
    if (!roomId || !targetUserId) return;
    const roomState = activeRoomStates.get(roomId);
    if (roomState && roomState.cohostRequests) {
      roomState.cohostRequests.delete(targetUserId);
    }
    const targetSockets = userSockets.get(targetUserId);
    if (targetSockets) {
      for (const sId of targetSockets) {
        io.to(sId).emit('cohost_request_rejected', { roomId });
      }
    }
    if (roomState && roomState.cohostRequests) {
      io.to(`room:${roomId}`).emit('cohost_requests_updated', {
        count: roomState.cohostRequests.size,
        requests: Array.from(roomState.cohostRequests.values())
      });
    }
  });

  // 4) Host requests list of pending cohost requests
  socket.on('get_cohost_requests', ({ roomId }) => {
    if (!roomId) return;
    const roomState = activeRoomStates.get(roomId);
    const requests = roomState && roomState.cohostRequests ? Array.from(roomState.cohostRequests.values()) : [];
    socket.emit('cohost_requests_updated', {
      count: requests.length,
      requests
    });
  });

  // 5) Two-Party Mutual PK Battle Request & Agreement
  socket.on('request_pk_battle', async ({ roomId, fromUser }) => {
    if (!roomId || !fromUser) return;
    try {
      const room = await get('SELECT host_id, co_host_id FROM rooms WHERE id = ?', [roomId]);
      if (!room || !room.co_host_id) return;

      const targetUserId = fromUser.id === room.host_id ? room.co_host_id : room.host_id;
      const targetSockets = userSockets.get(targetUserId);
      if (targetSockets) {
        for (const sId of targetSockets) {
          io.to(sId).emit('pk_battle_challenge_received', {
            roomId,
            challenger: fromUser
          });
        }
      }
    } catch (e) {}
  });

  socket.on('accept_pk_battle', async ({ roomId }) => {
    if (!roomId) return;
    try {
      const room = await get('SELECT * FROM rooms WHERE id = ?', [roomId]);
      if (!room || !room.co_host_id) return;

      const hostUser = await get('SELECT id, name, avatar, avatar_frame FROM users WHERE id = ?', [room.host_id]);
      const cohostUser = await get('SELECT id, name, avatar, avatar_frame FROM users WHERE id = ?', [room.co_host_id]);

      startPkForRoom(roomId, hostUser, cohostUser, 120);
    } catch (e) {}
  });

  socket.on('reject_pk_battle', async ({ roomId, fromUserId }) => {
    if (!fromUserId) return;
    const targetSockets = userSockets.get(fromUserId);
    if (targetSockets) {
      for (const sId of targetSockets) {
        io.to(sId).emit('pk_battle_challenge_rejected');
      }
    }
  });

  // دعوة مستخدم للصعود إلى المايك (قائمة المقعد ← ادعيه)
  socket.on('invite_to_seat', async ({ roomId, targetUserId, seatIndex, adminId }) => {
    if (!roomId || !targetUserId || !adminId) return;
    try {
      const room = await get('SELECT * FROM rooms WHERE id = ?', [roomId]);
      const admin = await get('SELECT * FROM users WHERE id = ?', [adminId]);
      if (!room || !admin || !(await canManageRoom(room, admin))) return;
      const targets = userSockets.get(targetUserId);
      if (!targets) return;
      for (const sockId of targets) {
        io.to(sockId).emit('seat_invite', { roomId, seatIndex, fromName: admin.name, fromId: admin.id, roomTitle: room.title });
      }
    } catch (e) { console.error('invite_to_seat error:', e); }
  });

  socket.on('invite_cohost', ({ roomId, targetUserId, hostUser }) => {
    if (!roomId || !targetUserId) return;
    const targetSockets = userSockets.get(targetUserId);
    if (targetSockets) {
      for (const sockId of targetSockets) {
        io.to(sockId).emit('cohost_invitation_received', { roomId, hostUser });
      }
    }
  });

  socket.on('accept_cohost', async ({ roomId, cohostUser }) => {
    if (!roomId || !cohostUser) return;
    try {
      await run('UPDATE rooms SET co_host_id = ? WHERE id = ?', [cohostUser.id, roomId]);
      const room = await get('SELECT * FROM rooms WHERE id = ?', [roomId]);
      const hostUser = await get('SELECT id, name, avatar, avatar_frame FROM users WHERE id = ?', [room ? room.host_id : '']);
      io.to(`room:${roomId}`).emit('cohost_joined_stream', { cohostUser, hostUser });
    } catch (e) {}
  });

  // 6) Co-host steps down / leaves live stage on their own
  socket.on('cohost_leave_stage', async ({ roomId, userId }) => {
    if (!roomId) return;
    if (pkIntervals.has(roomId)) {
      clearInterval(pkIntervals.get(roomId));
      pkIntervals.delete(roomId);
    }
    const roomState = activeRoomStates.get(roomId);
    if (roomState && roomState.pkState) {
      roomState.pkState.active = false;
    }
    try {
      await run('UPDATE rooms SET co_host_id = NULL WHERE id = ?', [roomId]);
      io.to(`room:${roomId}`).emit('cohost_left_stream', { userId });
    } catch (e) {}
  });

  socket.on('end_cohost', async ({ roomId }) => {
    if (!roomId) return;
    if (pkIntervals.has(roomId)) {
      clearInterval(pkIntervals.get(roomId));
      pkIntervals.delete(roomId);
    }
    const roomState = activeRoomStates.get(roomId);
    if (roomState && roomState.pkState) {
      roomState.pkState.active = false;
    }
    try {
      await run('UPDATE rooms SET co_host_id = NULL WHERE id = ?', [roomId]);
      io.to(`room:${roomId}`).emit('cohost_left_stream');
    } catch (e) {}
  });

  // ============================================
  // 16. التوافق الصوتي الحقيقي (مكالمة صوتية مجهولة WebRTC بين شخصين حقيقيين)
  // ============================================

  socket.on('start_voice_match', async ({ userId }) => {
    if (!userId) return;

    try {
      // بيانات المستخدم تُقرأ دائماً من قاعدة البيانات (لا يُؤخذ tags/planet من العميل)
      const currentUser = await get('SELECT * FROM users WHERE id = ?', [userId]);
      if (!currentUser) return;

      removeFromVoiceMatchQueue(socket.id, userId);
      pruneVoiceMatchQueue();

      if (isUserInActiveVoiceMatch(userId)) {
        return socket.emit('voice_match_error', { code: 'BUSY', message: 'أنت في مكالمة توافق صوتي حالياً 🎙️' });
      }

      // حد أقصى: 3 محاولات فقط لكل حساب خلال 24 ساعة
      const used = await getVoiceMatchUsageCount(userId);
      if (used >= VOICE_MATCH_LIMIT) {
        return socket.emit('voice_match_error', {
          code: 'LIMIT_REACHED',
          remaining: 0,
          message: `لقد استنفدت محاولاتك الـ ${VOICE_MATCH_LIMIT} للتوافق الصوتي خلال 24 ساعة. عد غداً 🌌`
        });
      }

      // 1) شريك ينتظر في الطابور ونسبة توافقه 60% فأكثر → مكالمة فورية
      let bestIdx = -1;
      let bestScore = -1;
      for (let i = 0; i < voiceMatchQueue.length; i++) {
        const q = voiceMatchQueue[i];
        if (q.userId === userId || q.socketId === socket.id) continue;
        if (!isVoiceMatchCompatible(currentUser, q.user)) continue;
        const partnerUsed = await getVoiceMatchUsageCount(q.userId);
        if (partnerUsed >= VOICE_MATCH_LIMIT) continue;
        const score = computeSoulCompatibility(currentUser, q.user);
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }

      if (bestIdx !== -1) {
        const waiting = voiceMatchQueue.splice(bestIdx, 1)[0];
        if (waiting.timeout) clearTimeout(waiting.timeout);
        cancelVoiceMatchRequests(waiting, 'taken');
        await createVoiceMatchSession(waiting, currentUser, socket.id);
        return;
      }

      // 2) لا أحد ينتظر → نرسل «طلب اتصال» لكل المتصلين الآن المتوافقين 60%+ وننتظر أول من يقبل
      const entry = {
        userId, socketId: socket.id, user: currentUser, enqueuedAt: Date.now(), timeout: null,
        requestId: `vmreq-${Date.now()}-${uuidv4().slice(0, 6)}`, invitedUserIds: []
      };
      entry.timeout = setTimeout(() => {
        removeFromVoiceMatchQueue(socket.id, userId);
        socket.emit('voice_match_error', { code: 'NO_MATCH', message: 'لم نجد روحاً متوافقة (60% فأكثر) متصلة الآن... حاول مرة أخرى لاحقاً 🪐' });
      }, VOICE_MATCH_QUEUE_TIMEOUT_MS);
      voiceMatchQueue.push(entry);
      const invited = await sendVoiceMatchRequests(entry);
      socket.emit('voice_match_searching', { remaining: Math.max(0, VOICE_MATCH_LIMIT - used), invited });
    } catch (err) {
      console.error('Voice match error:', err);
      socket.emit('voice_match_error', { code: 'ERROR', message: 'حدث خطأ أثناء البحث عن شريك متوافق' });
    }
  });

  // قبول طلب اتصال صوتي أُرسل لي: أول قابل يربح المكالمة
  socket.on('accept_voice_match_request', async ({ requestId, userId }) => {
    try {
      if (!requestId || !userId) return;
      // الهوية تُتحقق من السوكيت المسجّل لا من العميل فقط
      const set = userSockets.get(userId);
      if (!set || !set.has(socket.id)) return;
      const idx = voiceMatchQueue.findIndex(q => q.requestId === requestId);
      if (idx === -1) {
        return socket.emit('voice_match_request_cancelled', { requestId, reason: 'gone' });
      }
      const waiting = voiceMatchQueue[idx];
      if (waiting.userId === userId || !(waiting.invitedUserIds || []).includes(userId)) return;
      if (isUserInActiveVoiceMatch(userId) || isUserInActiveVoiceMatch(waiting.userId)) {
        return socket.emit('voice_match_request_cancelled', { requestId, reason: 'busy' });
      }
      const accepter = await get('SELECT * FROM users WHERE id = ?', [userId]);
      if (!accepter || !isVoiceMatchCompatible(waiting.user, accepter)) return;
      if ((await getVoiceMatchUsageCount(userId)) >= VOICE_MATCH_LIMIT) {
        return socket.emit('voice_match_error', { code: 'LIMIT_REACHED', message: `لقد استنفدت محاولاتك الـ ${VOICE_MATCH_LIMIT} للتوافق الصوتي خلال 24 ساعة 🌌` });
      }
      // تأكد أن الطلب ما زال قائماً (قد يقبله شخص آخر أثناء الانتظار)
      const idx2 = voiceMatchQueue.findIndex(q => q.requestId === requestId);
      if (idx2 === -1) return socket.emit('voice_match_request_cancelled', { requestId, reason: 'gone' });
      voiceMatchQueue.splice(idx2, 1);
      if (waiting.timeout) clearTimeout(waiting.timeout);
      cancelVoiceMatchRequests(waiting, 'taken'); // بقية المدعوين يُغلق عندهم الطلب
      await createVoiceMatchSession(waiting, accepter, socket.id);
    } catch (err) {
      console.error('accept_voice_match_request error:', err);
    }
  });

  socket.on('reveal_voice_match_identity', async ({ sessionId, userId }) => {
    if (!sessionId || !userId) return;
    const session = activeVoiceMatchSessions.get(sessionId);
    if (!session) return;

    if (session.userA.id === userId) {
      session.userA.revealed = true;
    } else if (session.userB.id === userId) {
      session.userB.revealed = true;
    } else {
      return;
    }

    // إذا كشف الطرفان هويتيهما → المكالمة تصبح بلا حدود (إلغاء عدّاد 5 دقائق)
    if (session.userA.revealed && session.userB.revealed) {
      session.isUnlimited = true;
      if (session.timer) { clearTimeout(session.timer); session.timer = null; }
      if (session.userA.socketId) {
        io.to(session.userA.socketId).emit('voice_match_both_revealed', {
          sessionId,
          realPartner: session.userB.user,
          realSelf: session.userA.user,
          isUnlimited: true
        });
      }
      if (session.userB.socketId) {
        io.to(session.userB.socketId).emit('voice_match_both_revealed', {
          sessionId,
          realPartner: session.userA.user,
          realSelf: session.userB.user,
          isUnlimited: true
        });
      }
    } else {
      // طرف واحد كشف هويته → إشعار الطرف الآخر
      const otherSockId = session.userA.id === userId ? session.userB.socketId : session.userA.socketId;
      if (otherSockId) {
        io.to(otherSockId).emit('partner_revealed_identity', { sessionId });
      }
    }
  });

  socket.on('voice_match_reaction', ({ sessionId, emoji, senderName }) => {
    if (!sessionId) return;
    const session = activeVoiceMatchSessions.get(sessionId);
    if (!session) return;
    if (session.userA.socketId) io.to(session.userA.socketId).emit('voice_match_reaction_burst', { emoji, senderName });
    if (session.userB.socketId) io.to(session.userB.socketId).emit('voice_match_reaction_burst', { emoji, senderName });
  });

  socket.on('voice_match_speaking', ({ sessionId, userId, isSpeaking }) => {
    if (!sessionId) return;
    const session = activeVoiceMatchSessions.get(sessionId);
    if (!session) return;
    const otherSockId = session.userA.id === userId ? session.userB.socketId : session.userA.socketId;
    if (otherSockId) {
      io.to(otherSockId).emit('partner_speaking_status', { isSpeaking });
    }
  });

  // إرسال إشارات WebRTC (صوت فقط) بين طرفي الجلسة — اتصال صوتي حقيقي بين شخصين
  socket.on('voice_match_signal', ({ sessionId, data }) => {
    if (!sessionId || !data) return;
    const session = activeVoiceMatchSessions.get(sessionId);
    if (!session) return;
    let target = null;
    if (socket.id === session.userA.socketId) target = session.userB.socketId;
    else if (socket.id === session.userB.socketId) target = session.userA.socketId;
    if (target) io.to(target).emit('voice_match_signal', { sessionId, data });
  });

  socket.on('end_voice_match', ({ sessionId } = {}) => {
    if (!sessionId) {
      // إلغاء البحث: إزالة المستخدم من طابور الانتظار
      removeFromVoiceMatchQueue(socket.id);
      return;
    }
    const session = activeVoiceMatchSessions.get(sessionId);
    if (!session) return;
    if (socket.id !== session.userA.socketId && socket.id !== session.userB.socketId) return;
    endVoiceMatchSession(sessionId, 'ended');
  });

  // 17. Supreme Owner Global Broadcast to All Rooms
  socket.on('global_owner_announcement', ({ ownerId, message }) => {
    if (!message) return;
    io.emit('global_announcement_broadcast', { message });
  });

  // 17. User Sign-Out / Disconnect Event
  socket.on('user_disconnect', async () => {
    if (currentUserId) {
      const sockSet = userSockets.get(currentUserId);
      if (sockSet) {
        sockSet.delete(socket.id);
        if (sockSet.size === 0) {
          userSockets.delete(currentUserId);
          io.emit('user_status_change', { userId: currentUserId, status: 'offline' });
        }
      }
      try {
        const heldSeats = await all('SELECT room_id, seat_index, is_muted FROM room_seats WHERE user_id = ?', [currentUserId]);
        if (heldSeats && heldSeats.length > 0) {
          for (const s of heldSeats) {
            await run('UPDATE room_seats SET user_id = NULL, is_muted = ? WHERE room_id = ? AND seat_index = ?', [s.is_muted ? 1 : 0, s.room_id, s.seat_index]);
            { const mm = roomMusicState.get(s.room_id); if (mm && mm.has(String(currentUserId))) { mm.delete(String(currentUserId)); if (!mm.size) roomMusicState.delete(s.room_id); io.to(`room:${s.room_id}`).emit('room_music_stopped', { roomId: s.room_id, userId: currentUserId, seatIndex: s.seat_index }); } }
            io.to(`room:${s.room_id}`).emit('seat_updated', {
              seatIndex: s.seat_index,
              user: null,
              isMuted: !!s.is_muted
            });
          }
        }
      } catch (e) {}

      // Remove from audience strip across rooms
      for (const [rId, rState] of activeRoomStates.entries()) {
        if (rState.activeAudience && rState.activeAudience.has(currentUserId)) {
          rState.activeAudience.delete(currentUserId);
          rState.speakers.delete(currentUserId);
          const audienceList = Array.from(rState.activeAudience.values());
          io.to(`room:${rId}`).emit('user_left_room', {
            userId: currentUserId,
            audienceCount: audienceList.length,
            audience: audienceList
          });
          // تحديث عدد الزوار لدى الجميع (القائمة، مركز الاهتمامات، المقترحين...)
          io.emit('room_occupants_updated', { roomId: rId, count: audienceList.length, preview: buildAudiencePreview(rId) });
        }
      }

      currentUserId = null;
    }
  });

  // User avatar changed broadcast
  socket.on('user_avatar_changed', ({ userId, avatar }) => {
    if (!userId || !avatar) return;
    io.emit('user_avatar_changed', { userId, avatar });
  });

  // 18. Socket Disconnect
  socket.on('disconnect', async () => {
    if (currentUserId) {
      const sockSet = userSockets.get(currentUserId);
      if (sockSet) {
        sockSet.delete(socket.id);
        if (sockSet.size === 0) {
          userSockets.delete(currentUserId);
          io.emit('user_status_change', { userId: currentUserId, status: 'offline' });
        }
      }
      try {
        const heldSeats = await all('SELECT room_id, seat_index, is_muted FROM room_seats WHERE user_id = ?', [currentUserId]);
        if (heldSeats && heldSeats.length > 0) {
          for (const s of heldSeats) {
            await run('UPDATE room_seats SET user_id = NULL, is_muted = ? WHERE room_id = ? AND seat_index = ?', [s.is_muted ? 1 : 0, s.room_id, s.seat_index]);
            io.to(`room:${s.room_id}`).emit('seat_updated', {
              seatIndex: s.seat_index,
              user: null,
              isMuted: !!s.is_muted
            });
          }
        }
      } catch (e) {}

      // Remove from audience strip across rooms
      for (const [rId, rState] of activeRoomStates.entries()) {
        if (rState.activeAudience && rState.activeAudience.has(currentUserId)) {
          rState.activeAudience.delete(currentUserId);
          rState.speakers.delete(currentUserId);
          const audienceList = Array.from(rState.activeAudience.values());
          io.to(`room:${rId}`).emit('user_left_room', {
            userId: currentUserId,
            audienceCount: audienceList.length,
            audience: audienceList
          });
          // تحديث عدد الزوار لدى الجميع (القائمة، مركز الاهتمامات، المقترحين...)
          io.emit('room_occupants_updated', { roomId: rId, count: audienceList.length, preview: buildAudiencePreview(rId) });
        }
      }
    }
    onlineUsers.delete(socket.id);
  });
});

// Fallback to SPA index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server & Initialize Database
const HTTPS_PORT = process.env.HTTPS_PORT || 2083;

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`===============================================`);
  console.log(`✨ SoulChill HTTP Server running on http://0.0.0.0:${PORT}`);
  console.log(`🪐 SQLite Database: soulchill.sqlite`);
  console.log(`===============================================`);
  await initDB();
  await seedGiftsCatalog();
  // لا يوجد أي متصل عند بدء الخادم: نحرّر كل المقاعد العالقة حتى لا يُصعَّد أحد تلقائياً عند الدخول
  try { await run('UPDATE room_seats SET user_id = NULL WHERE user_id IS NOT NULL'); } catch (e) { console.error('stale seats cleanup error:', e); }
  // أغانٍ يوتيوب كانت قيد التحميل عند إيقاف الخادم: نعيد تشغيل مهامها
  try {
    // المحاولات الفاشلة سابقاً تُعاد (مثلاً بعد إضافة cookies.txt)
    await run(`UPDATE user_music_tracks SET audio_status = 'processing' WHERE audio_status = 'failed' AND source = 'youtube' AND yt_id != ''`);
    const pend = await all(`SELECT DISTINCT yt_id FROM user_music_tracks WHERE audio_status = 'processing' AND yt_id != ''`);
    pend.forEach(r => startYtAudioJob(r.yt_id));
  } catch (e) { console.error('yt audio resume error:', e); }
});

if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`===============================================`);
    console.log(`🔒 SoulChill Secure HTTPS Server running on https://0.0.0.0:${HTTPS_PORT}`);
    console.log(`📜 Loaded SSL Certificate: cert.pem & key.pem`);
    console.log(`===============================================`);
  });
} else {
  console.warn('⚠️ cert.pem or key.pem not found; HTTPS on port 2083 was not started.');
}
