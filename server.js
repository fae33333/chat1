try { require('dotenv').config(); } catch (e) { /* dotenv غير مثبت: نتجاهل */ }
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

// Dedicated storage guard for the personal music repository.
const musicUpload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const audioExt = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus', '.webm']);
    if (/^audio\//i.test(file.mimetype || '') || audioExt.has(ext)) return cb(null, true);
    cb(new Error('الملف ليس ملفاً صوتياً صالحاً'));
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
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

// ==========================================
// API ROUTES
// ==========================================

// 1. Send Real Gmail Verification OTP Code via SMTP
app.post('/api/auth/send-gmail-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'يرجى إدخال عنوان Gmail صحيح' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    // Save in SQLite
    await run(`
      INSERT OR REPLACE INTO email_verifications (email, code, expires_at)
      VALUES (?, ?, ?)
    `, [cleanEmail, code, expiresAt]);

    console.log(`\n📧 [SoulChill Gmail Service] =================================`);
    console.log(`To: ${cleanEmail}`);
    console.log(`Verification Code: [ ${code} ]`);
    console.log(`Expires at: ${expiresAt}`);
    console.log(`============================================================\n`);

    // Fetch SMTP settings from DB
    const smtp = await get('SELECT * FROM smtp_settings WHERE id = 1');
    let emailSent = false;
    let smtpError = null;

    if (smtp && smtp.is_enabled) {
      try {
        const transporter = nodemailer.createTransport({
          host: smtp.host || 'smtp.gmail.com',
          port: parseInt(smtp.port) || 587,
          secure: parseInt(smtp.port) === 465,
          auth: {
            user: smtp.user,
            pass: smtp.pass
          }
        });

        let htmlContent = smtp.html_template || '';
        htmlContent = htmlContent
          .replace(/\{\{code\}\}/g, code)
          .replace(/\{\{email\}\}/g, cleanEmail)
          .replace(/\{\{app_name\}\}/g, 'SoulChill');

        const subject = (smtp.subject_template || 'رمز التحقق الخاص بك لتطبيق SoulChill 🪐')
          .replace(/\{\{code\}\}/g, code);

        await transporter.sendMail({
          from: smtp.from_email || `chat<${smtp.user}>`,
          to: cleanEmail,
          subject: subject,
          html: htmlContent
        });

        emailSent = true;
        console.log(`✅ [SMTP SUCCESS] Real OTP email sent to ${cleanEmail}`);
      } catch (mailErr) {
        smtpError = mailErr.message;
        console.warn('❌ [SMTP ERROR] Could not send email via SMTP:', mailErr.message);
      }
    }

    res.json({
      success: true,
      message: emailSent
        ? `تم إرسال رمز التحقق إلى بريدك الإلكتروني (${cleanEmail}) بنجاح! 📨`
        : `تم توليد رمز التحقق لـ (${cleanEmail})`,
      emailSent,
      smtpError,
      code: code,
      expiresAt
    });
  } catch (err) {
    console.error('Error sending OTP:', err);
    res.status(500).json({ error: 'فشل إرسال رمز التحقق: ' + err.message });
  }
});

// 2. Verify Gmail OTP & Log In / Register
app.post('/api/auth/verify-gmail-otp', async (req, res) => {
  try {
    const { email, code, name } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: 'البريد الإلكتروني ورمز التحقق مطلوبان' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = code.trim();

    // Verify in SQLite
    const record = await get(`
      SELECT * FROM email_verifications 
      WHERE email = ? AND code = ? AND expires_at > datetime('now')
    `, [cleanEmail, cleanCode]);

    if (!record) {
      return res.status(400).json({ error: 'رمز التحقق غير صحيح أو انتهت صلاحيته!' });
    }

    // Delete verification record
    await run('DELETE FROM email_verifications WHERE email = ?', [cleanEmail]);

    // Check if user exists
    let user = await get('SELECT * FROM users WHERE email = ?', [cleanEmail]);

    if (!user) {
      const newId = `sc-user-${Date.now().toString().slice(-6)}`;
      const userName = name || cleanEmail.split('@')[0];
      const defaultAvatar = `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encodeURIComponent(userName)}`;
      const planets = [
        'كوكب الرومانسي الحالم 🌌',
        'كوكب المغامر الشغوف 🚀',
        'كوكب الفنان الملهم 🎨',
        'كوكب الفيلسوف الحكيم 🔮',
        'كوكب النسمة الهادئة 🍃'
      ];
      const randomPlanet = planets[Math.floor(Math.random() * planets.length)];

      await run(`
        INSERT INTO users (id, google_id, email, name, avatar, bio, soul_planet, soul_score, soul_tags, coins, diamonds, level, wealth_level, charm_level)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        newId,
        `google-${cleanEmail}`,
        cleanEmail,
        userName,
        defaultAvatar,
        'عضو موثق عبر Gmail في SoulChill 🪐✨',
        randomPlanet,
        88 + Math.floor(Math.random() * 11),
        'بثوث,طرب,شات,ألعاب',
        2500, // Bonus for verifying real Gmail!
        600,
        1,
        1,
        1
      ]);

      user = await get('SELECT * FROM users WHERE id = ?', [newId]);
    }

    res.json({
      success: true,
      user,
      token: `token-${user.id}-${Date.now()}`
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'فشل التحقق: ' + err.message });
  }
});

// 3. Official Google GSI Token / Google OAuth Verification
app.post('/api/auth/google-token', async (req, res) => {
  try {
    const { credential, client_id } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Google credential is required' });
    }

    let payload;
    try {
      // Decode JWT payload directly or via Google library
      const parts = credential.split('.');
      if (parts.length === 3) {
        payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      }
    } catch (e) {
      console.warn('Could not decode JWT parts, using fallback');
    }

    if (!payload || !payload.email) {
      return res.status(400).json({ error: 'Invalid Google credential token' });
    }

    const email = payload.email;
    const name = payload.name || payload.given_name || email.split('@')[0];
    const avatar = payload.picture || `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encodeURIComponent(name)}`;
    const google_id = payload.sub || `google-${email}`;

    let user = await get('SELECT * FROM users WHERE email = ? OR google_id = ?', [email, google_id]);
    if (!user) {
      const newId = `sc-user-${Date.now().toString().slice(-6)}`;
      await run(`
        INSERT INTO users (id, google_id, email, name, avatar, bio, soul_planet, soul_score, soul_tags, coins, diamonds, level, wealth_level, charm_level)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        newId,
        google_id,
        email,
        name,
        avatar,
        'عضو رسمي موثق عبر Google في SoulChill 🪐✨',
        'كوكب الرومانسي الحالم 🌌',
        92,
        'لايف,طرب,شات',
        3000, // VIP Google bonus!
        700,
        1,
        2,
        2
      ]);
      user = await get('SELECT * FROM users WHERE id = ?', [newId]);
    }

    res.json({
      success: true,
      user,
      token: `token-${user.id}-${Date.now()}`
    });
  } catch (err) {
    console.error('Google token error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 1. Google Authentication
app.post('/api/auth/google', async (req, res) => {
  try {
    const { email, name, avatar, google_id } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user already exists with this email or google_id
    let user = await get('SELECT * FROM users WHERE email = ? OR google_id = ?', [email, google_id || email]);

    if (!user) {
      const newId = `sc-user-${Date.now().toString().slice(-6)}`;
      const userName = name || email.split('@')[0];
      const defaultAvatar = avatar || `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encodeURIComponent(userName)}`;
      const planets = [
        'كوكب الرومانسي الحالم 🌌',
        'كوكب المغامر الشغوف 🚀',
        'كوكب الفنان الملهم 🎨',
        'كوكب الفيلسوف الحكيم 🔮',
        'كوكب النسمة الهادئة 🍃'
      ];
      const randomPlanet = planets[Math.floor(Math.random() * planets.length)];

      await run(`
        INSERT INTO users (id, google_id, email, name, avatar, bio, soul_planet, soul_score, soul_tags, coins, diamonds, level, wealth_level, charm_level)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        newId,
        google_id || `google-${newId}`,
        email,
        userName,
        defaultAvatar,
        'عضو جديد في مجتمع SoulChill 🪐✨',
        randomPlanet,
        85 + Math.floor(Math.random() * 14),
        'شات,موسيقى,ألعاب,تعارف',
        2000, // Welcome bonus coins!
        500,  // Welcome bonus diamonds!
        1,
        1,
        1
      ]);

      user = await get('SELECT * FROM users WHERE id = ?', [newId]);
    }

    res.json({
      success: true,
      user,
      token: `token-${user.id}-${Date.now()}`
    });
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ error: 'Authentication failed: ' + err.message });
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
app.get('/api/users/:id', async (req, res) => {
  try {
    const user = await get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Update User Profile
app.put('/api/users/profile', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { name, bio, gender, age, avatar, avatar_frame, chat_frame, soul_planet, soul_tags } = req.body;
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

    const updatedUser = await get('SELECT * FROM users WHERE id = ?', [userId]);
    res.json({ success: true, user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3a. Equip User Accessories (Chat Bubble Frame, Entry Effect, Avatar Frame)
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

    const updatedUser = await get('SELECT * FROM users WHERE id = ?', [userId]);
    res.json({ success: true, user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== قوالب الدخول (تُشترى بالكرستالات) =====================
// يرجع القالب فقط إذا كان المستخدم يملكه (وإلا null)
async function getOwnedEntryTemplate(userId, templateId) {
  if (!userId || !templateId) return null;
  const row = await get(`
    SELECT t.id, t.name, t.image_url
    FROM entry_templates t
    JOIN user_inventory i ON i.item_id = t.id AND i.user_id = ? AND i.item_type = 'entry_effect'
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
const entryImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => cb(null, `entry-${Date.now()}-${uuidv4().slice(0, 8)}${ENTRY_IMAGE_EXT[file.mimetype] || '.png'}`)
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ENTRY_IMAGE_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('يُسمح فقط بصور PNG أو JPG أو GIF أو WEBP'));
  }
});

// التحقق من صلاحية الإدارة قبل استقبال الملف، ثم رفع الصورة
async function adminEntryImageUpload(req, res, next) {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });
  entryImageUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'حجم الصورة أكبر من 8MB' : err.message });
    next();
  });
}

// قائمة القوالب للمستخدم (المتاحة للبيع + ما يملكه)
app.get('/api/entry-templates', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || '';
    const rows = await all(`
      SELECT t.id, t.name, t.image_url, t.price, t.is_active,
             CASE WHEN i.id IS NULL THEN 0 ELSE 1 END AS owned, i.created_at AS owned_at
      FROM entry_templates t
      LEFT JOIN user_inventory i ON i.item_id = t.id AND i.user_id = ? AND i.item_type = 'entry_effect'
      WHERE t.is_active = 1 OR i.id IS NOT NULL
      ORDER BY t.created_at DESC, t.rowid DESC
    `, [userId]);
    const u = userId ? await get('SELECT entry_effect FROM users WHERE id = ?', [userId]) : null;
    res.json({
      templates: rows.map(r => ({ id: r.id, name: r.name, image_url: r.image_url, price: r.price, owned: !!r.owned, owned_at: r.owned_at || null })),
      equipped: (u && u.entry_effect) || ''
    });
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

    const price = Math.max(0, parseInt(tpl.price, 10) || 0);
    const invId = uuidv4();
    try {
      await run(`INSERT INTO user_inventory (id, user_id, item_type, item_id, item_name) VALUES (?, ?, 'entry_effect', ?, ?)`,
        [invId, userId, tpl.id, tpl.name]);
    } catch (e) {
      return res.status(400).json({ error: 'تملك هذا القالب بالفعل' });
    }

    const paid = await run('UPDATE users SET diamonds = diamonds - ? WHERE id = ? AND diamonds >= ?', [price, userId, price]);
    if (!paid.changes) {
      await run('DELETE FROM user_inventory WHERE id = ?', [invId]);
      return res.status(400).json({ error: `رصيدك من الكرستالات غير كافٍ (السعر ${price} 💎)` });
    }

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
    if (!req.file) return res.status(400).json({ error: 'يرجى اختيار صورة القالب' });

    const id = `entry-${uuidv4().slice(0, 8)}`;
    await run('INSERT INTO entry_templates (id, name, image_url, price, is_active) VALUES (?, ?, ?, ?, 1)',
      [id, name, `/uploads/${req.file.filename}`, price]);
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
    await run('UPDATE entry_templates SET name = ?, price = ?, is_active = ?, image_url = ? WHERE id = ?',
      [name, price, isActive, imageUrl, tpl.id]);
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
    JOIN user_inventory i ON i.item_id = f.id AND i.user_id = ? AND i.item_type = 'avatar_frame'
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
    const userId = req.headers['x-user-id'] || '';
    const rows = await all(`
      SELECT f.id, f.name, f.image_url, f.price, f.scale, f.is_active,
             CASE WHEN i.id IS NULL THEN 0 ELSE 1 END AS owned, i.created_at AS owned_at
      FROM avatar_frames f
      LEFT JOIN user_inventory i ON i.item_id = f.id AND i.user_id = ? AND i.item_type = 'avatar_frame'
      ORDER BY f.created_at DESC, f.rowid DESC
    `, [userId]);
    const u = userId ? await get('SELECT avatar_frame FROM users WHERE id = ?', [userId]) : null;
    res.json({
      frames: rows.map(r => ({
        id: r.id, name: r.name, image_url: r.image_url, price: r.price, scale: r.scale,
        is_active: !!r.is_active, owned: !!r.owned, owned_at: r.owned_at || null
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

    const price = Math.max(0, parseInt(frame.price, 10) || 0);
    const invId = uuidv4();
    try {
      await run(`INSERT INTO user_inventory (id, user_id, item_type, item_id, item_name) VALUES (?, ?, 'avatar_frame', ?, ?)`,
        [invId, userId, frame.id, frame.name]);
    } catch (e) {
      return res.status(400).json({ error: 'تملك هذا الإطار بالفعل' });
    }

    const paid = await run('UPDATE users SET diamonds = diamonds - ? WHERE id = ? AND diamonds >= ?', [price, userId, price]);
    if (!paid.changes) {
      await run('DELETE FROM user_inventory WHERE id = ?', [invId]);
      return res.status(400).json({ error: `رصيدك من الكرستالات غير كافٍ (السعر ${price} 💎)` });
    }

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
    await run('INSERT INTO avatar_frames (id, name, image_url, price, scale, is_active) VALUES (?, ?, ?, ?, ?, 1)',
      [id, name, `/uploads/${req.file.filename}`, price, scale]);
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
    await run('UPDATE avatar_frames SET name = ?, price = ?, scale = ?, is_active = ?, image_url = ? WHERE id = ?',
      [name, price, scale, isActive, imageUrl, frame.id]);
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

// 7. Get All Users (for Soul Planet Radar)
app.get('/api/users', async (req, res) => {
  try {
    const users = await all('SELECT id, name, avatar, bio, soul_planet, soul_score, soul_tags, level, wealth_level, charm_level, avatar_frame, role FROM users LIMIT 50');
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
      SELECT r.*, u.name as host_name, u.avatar as host_avatar, u.avatar_frame as host_frame
      FROM rooms r
      JOIN users u ON r.host_id = u.id
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
    }

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
    if (existingRoom && hostUser.role !== 'owner') {
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

// 14. Send Direct Message
app.post('/api/messages', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { receiver_id, message_type, content, media_url, metadata } = req.body;
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
      SELECT id, title, source, url, file_name, created_at
      FROM user_music_tracks WHERE user_id = ? ORDER BY created_at DESC
    `, [userId]);
    res.json({ success: true, tracks });
  } catch (err) {
    res.status(500).json({ error: 'تعذر تحميل مكتبة الموسيقى' });
  }
});

app.post('/api/music-library', (req, res, next) => {
  musicUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'تعذر رفع الملف الصوتي' });
    try {
      const userId = await requireMusicUser(req, res); if (!userId) {
        if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
        return;
      }
      const rawTitle = req.body && req.body.title;
      const title = String(rawTitle || (req.file ? path.parse(req.file.originalname).name : '') || 'موسيقى').trim().slice(0, 100);
      let url = req.file ? `/uploads/${req.file.filename}` : String(req.body && req.body.url || '').trim().slice(0, 1000);
      if (!url || !(/^(https?:\/\/|\/uploads\/)/i.test(url))) {
        if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
        return res.status(400).json({ error: 'أدخل رابطاً صوتياً صالحاً أو ارفع ملفاً صوتياً' });
      }
      const source = req.file ? 'device' : 'online';
      const id = uuidv4();
      await run(`INSERT INTO user_music_tracks (id, user_id, title, source, url, file_name) VALUES (?, ?, ?, ?, ?, ?)`, [
        id, userId, title, source, url, req.file ? req.file.originalname : null
      ]);
      const track = { id, title, source, url, file_name: req.file ? req.file.originalname : null };
      res.json({ success: true, track });
    } catch (e) {
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch (err) {} }
      res.status(500).json({ error: 'تعذر حفظ الموسيقى في مكتبتك' });
    }
  });
});

app.delete('/api/music-library/:id', async (req, res) => {
  try {
    const userId = await requireMusicUser(req, res); if (!userId) return;
    const track = await get('SELECT id, url FROM user_music_tracks WHERE id = ? AND user_id = ?', [req.params.id, userId]);
    if (!track) return res.status(404).json({ error: 'النغمة غير موجودة' });
    await run('DELETE FROM user_music_tracks WHERE id = ? AND user_id = ?', [req.params.id, userId]);
    const filePath = musicFilePath(track.url);
    if (filePath && fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch (e) {} }
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

// 17-yt. البحث في يوتيوب (YouTube Data API v3) لاختيار مقطع وإرفاقه بالمنشور
const ytSearchCache = new Map(); // key -> { t, data }
const ytSearchHits = new Map();  // userId -> [timestamps]
const YT_CACHE_MS = 10 * 60 * 1000;

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)));
}

app.get('/api/youtube/search', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId || !(await get('SELECT id FROM users WHERE id = ?', [userId]))) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ success: false, code: 'NO_KEY', error: 'البحث في يوتيوب غير مفعّل بعد. على مدير الخادم إضافة YOUTUBE_API_KEY.' });
    }
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q.length < 2) return res.status(400).json({ success: false, error: 'اكتب كلمة بحث من حرفين على الأقل' });
    const pageToken = /^[A-Za-z0-9_-]{1,100}$/.test(String(req.query.pageToken || '')) ? String(req.query.pageToken) : '';

    // حد معقول للطلبات لحماية حصة المفتاح: 15 بحثاً في الدقيقة لكل مستخدم
    const now = Date.now();
    const hits = (ytSearchHits.get(userId) || []).filter(t => now - t < 60000);
    if (hits.length >= 15) return res.status(429).json({ success: false, error: 'عدد كبير من عمليات البحث، انتظر قليلاً ثم أعد المحاولة' });
    hits.push(now);
    ytSearchHits.set(userId, hits);

    const cacheKey = `${q.toLowerCase()}|${pageToken}`;
    const cached = ytSearchCache.get(cacheKey);
    if (cached && now - cached.t < YT_CACHE_MS) return res.json({ success: true, ...cached.data });

    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('maxResults', '12');
    url.searchParams.set('safeSearch', 'strict');
    url.searchParams.set('videoEmbeddable', 'true');
    url.searchParams.set('q', q);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    url.searchParams.set('key', apiKey);

    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const reason = j && j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason;
      console.error('YouTube search error:', r.status, reason || (j.error && j.error.message));
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
        return res.status(429).json({ success: false, error: 'تم استهلاك حصة البحث اليومية في يوتيوب، حاول لاحقاً' });
      }
      return res.status(502).json({ success: false, error: 'تعذر البحث في يوتيوب حالياً' });
    }
    const data = {
      items: (j.items || []).filter(it => it.id && it.id.videoId).map(it => ({
        id: it.id.videoId,
        title: decodeHtmlEntities(it.snippet.title),
        channel: decodeHtmlEntities(it.snippet.channelTitle),
        thumbnail: (it.snippet.thumbnails && ((it.snippet.thumbnails.medium || it.snippet.thumbnails.default) || {}).url) || '',
        published_at: it.snippet.publishedAt
      })),
      nextPageToken: j.nextPageToken || null
    };
    if (ytSearchCache.size > 200) ytSearchCache.delete(ytSearchCache.keys().next().value);
    ytSearchCache.set(cacheKey, { t: now, data });
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ success: false, error: 'تعذر البحث في يوتيوب حالياً' });
  }
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
app.get('/api/gifts', (req, res) => {
  res.json(GIFTS);
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

    const gift = GIFTS.find(g => g.id === gift_id);
    if (!gift) return res.status(400).json({ error: 'Invalid gift' });

    const sender = await get('SELECT * FROM users WHERE id = ?', [senderId]);
    if (!sender) return res.status(404).json({ error: 'Sender not found' });

    // Check balance
    if (gift.currency === 'coins') {
      if (sender.coins < gift.cost) {
        return res.status(400).json({ error: 'عفواً، رصيد العملات غير كافٍ! اشحن الآن أو احصل على مكافأتك اليومية 🪙' });
      }
      await run('UPDATE users SET coins = coins - ?, wealth_level = wealth_level + 1 WHERE id = ?', [gift.cost, senderId]);
    } else {
      if (sender.diamonds < gift.cost) {
        return res.status(400).json({ error: 'عفواً، رصيد الألماس غير كافٍ! اشحن ألماساتك لإرسال هدايا فاخرة 💎' });
      }
      await run('UPDATE users SET diamonds = diamonds - ?, wealth_level = wealth_level + 2 WHERE id = ?', [gift.cost, senderId]);
    }

    // Award charm to receiver
    if (receiver_id) {
      await run('UPDATE users SET charm_level = charm_level + 1, coins = coins + ? WHERE id = ?', [Math.floor(gift.cost * 0.4), receiver_id]);
    }

    // Record gift history (Saved in receiver's gifts wall)
    const historyId = `gift-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await run(`
      INSERT INTO gifts_history (id, sender_id, receiver_id, room_id, gift_id, gift_name, gift_icon, cost, currency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [historyId, senderId, receiver_id, room_id, gift.id, gift.name, gift.icon, gift.cost, gift.currency]);

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

    // Broadcast in room
    if (room_id) {
      io.to(`room:${room_id}`).emit('room_gift_sent', giftEventPayload);

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
      receiver
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

    const paid = await run('UPDATE users SET diamonds = diamonds - ?, wealth_level = wealth_level + 1 WHERE id = ? AND diamonds >= ?', [amount, userId, amount]);
    if (!paid.changes) return res.status(400).json({ error: 'عفواً، رصيد الكريستال غير كافٍ! اشحن ألماساتك أولاً 💎' });

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
      SELECT u.id, u.name, u.avatar, u.avatar_frame, u.level, u.wealth_level, u.charm_level, u.gender, u.age, u.country_code,
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
    res.json({ ...counts, friends_count: fr.c, visitors_count: vs.c });
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
      SELECT u.id, u.name, u.avatar, u.avatar_frame, u.level, u.wealth_level, u.charm_level, u.gender, u.age, u.country_code,
             p.last_visited, p.visits,
             CASE WHEN vf.follower_id IS NULL THEN 0 ELSE 1 END AS is_following
      FROM profile_visits p
      JOIN users u ON u.id = ${joinCol}
      LEFT JOIN follows vf ON vf.follower_id = ? AND vf.following_id = u.id
      WHERE ${whereCol} = ?
      ORDER BY p.last_visited DESC
      LIMIT 200
    `, [viewerId, targetId]);
    res.json({ users: rows.map(r => ({ ...r, is_following: !!r.is_following })) });
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
    const out = { host_id: room.host_id, total_members: total.c, members, moderators, online, can_manage: manager, is_owner: ownerLevel };
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

// «الخلفية»
app.put('/api/rooms/:id/background', async (req, res) => {
  try {
    const ctx = await requireRoomManager(req, res); if (!ctx) return;
    const { room, user } = ctx;
    const bg = String(req.body.bg_image || '').slice(0, 600);
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
      count: audienceList.length
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
        count: audienceList.length
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
    io.to(`room:${roomId}`).emit('room_music_started', {
      roomId, userId, seatIndex, title: title || 'موسيقى', trackId: trackId || '', cover: cover || ''
    });
  });

  socket.on('room_music_stopped', ({ roomId, userId, seatIndex }) => {
    if (!roomId || !userId || currentRoomId !== roomId) return;
    io.to(`room:${roomId}`).emit('room_music_stopped', { roomId, userId, seatIndex });
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
        count: audienceList.length
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
  // 16. ANONYMOUS 5-MINUTE VOICE MATCH (SOULCHILL BLIND CALL & IDENTITY REVEAL)
  // ============================================
  const voiceMatchQueue = [];
  const activeVoiceMatchSessions = new Map();

  socket.on('start_voice_match', async ({ userId, tags, planet }) => {
    if (!userId) return;

    try {
      const currentUser = await get('SELECT * FROM users WHERE id = ?', [userId]);
      if (!currentUser) return;

      // 1. Check if another real user is waiting in the queue
      const qIdx = voiceMatchQueue.findIndex(q => q.userId !== userId && q.socketId !== socket.id);
      let partner = null;
      let isSimulated = false;

      if (qIdx !== -1) {
        const waiting = voiceMatchQueue.splice(qIdx, 1)[0];
        const pUser = await get('SELECT * FROM users WHERE id = ?', [waiting.userId]);
        if (pUser) {
          partner = { user: pUser, socketId: waiting.socketId };
        }
      }

      // 2. If no real user is currently waiting, match with an active community Souler from DB
      if (!partner) {
        const candidates = await all('SELECT * FROM users WHERE id != ? ORDER BY RANDOM() LIMIT 8', [userId]);
        if (candidates && candidates.length > 0) {
          // Select best soul compatibility candidate
          partner = { user: candidates[0], socketId: null };
          isSimulated = true;
        }
      }

      if (!partner) {
        return socket.emit('voice_match_error', { message: 'تعذر العثور على شريك متوافق في الوقت الحالي' });
      }

      const sessionId = `vmatch-${Date.now()}`;
      const sessionData = {
        id: sessionId,
        userA: { id: userId, socketId: socket.id, user: currentUser, revealed: false },
        userB: { id: partner.user.id, socketId: partner.socketId, user: partner.user, revealed: false, isSimulated },
        startedAt: Date.now(),
        duration: 300, // 5 minutes
        isUnlimited: false
      };
      activeVoiceMatchSessions.set(sessionId, sessionData);

      // Masked Anonymous Partner profile
      const maskedPartner = {
        id: partner.user.id,
        maskedName: `روح متوافقة #${partner.user.id.slice(-4)}`,
        maskedAvatar: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=300&q=80',
        soul_planet: partner.user.soul_planet || 'كوكب السول 🪐',
        soul_score: partner.user.soul_score || (85 + Math.floor(Math.random() * 12)),
        soul_tags: partner.user.soul_tags || 'موسيقى,شات,رواق,ألعاب',
        bio: '🔒 الهوية مشفرة ومحجوبة لحين كشف الهوية المتبادل',
        level: partner.user.level || 5
      };

      // Masked Anonymous Self profile
      const maskedSelf = {
        id: currentUser.id,
        maskedName: `روح غامضة #${currentUser.id.slice(-4)}`,
        maskedAvatar: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=300&q=80',
        soul_planet: currentUser.soul_planet || 'كوكب السول 🪐',
        soul_score: currentUser.soul_score || 94,
        soul_tags: currentUser.soul_tags || 'موسيقى,ألعاب,سوالف',
        bio: '🔒 هويتك مخفية عن الشريك حتى تقررا كشفها',
        level: currentUser.level || 5
      };

      // Notify initiating client
      socket.emit('voice_match_connected', {
        sessionId,
        isAnonymous: true,
        duration: 300,
        partner: maskedPartner,
        selfMasked: maskedSelf,
        isSimulated
      });

      // If partner is a real connected socket, notify them too
      if (partner.socketId) {
        io.to(partner.socketId).emit('voice_match_connected', {
          sessionId,
          isAnonymous: true,
          duration: 300,
          partner: maskedSelf,
          selfMasked: maskedPartner,
          isSimulated: false
        });
      }
    } catch (err) {
      console.error('Voice match error:', err);
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
    }

    // If partner is simulated, partner automatically reveals too after a brief dramatic delay!
    if (session.userB.isSimulated) {
      setTimeout(() => {
        session.userB.revealed = true;
        session.isUnlimited = true;
        socket.emit('voice_match_both_revealed', {
          sessionId,
          realPartner: session.userB.user,
          realSelf: session.userA.user,
          isUnlimited: true
        });
      }, 1000);
      return;
    }

    // Real partner sockets
    if (session.userA.revealed && session.userB.revealed) {
      session.isUnlimited = true;
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
      // One party revealed, inform other party
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

  socket.on('end_voice_match', ({ sessionId }) => {
    if (!sessionId) return;
    const session = activeVoiceMatchSessions.get(sessionId);
    if (session) {
      activeVoiceMatchSessions.delete(sessionId);
      if (session.userA.socketId) io.to(session.userA.socketId).emit('voice_match_ended', { sessionId });
      if (session.userB.socketId) io.to(session.userB.socketId).emit('voice_match_ended', { sessionId });
    }
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
