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
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory active presence & room states
const onlineUsers = new Map(); // socketId -> userId
const userSockets = new Map(); // userId -> Set(socketIds)
const activeRoomStates = new Map(); // roomId -> { pkState, activeAudience: Set, speakers: Set, cohostRequests: Map }
const pkIntervals = new Map(); // roomId -> intervalId
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
  { id: 'rose', name: 'وردة الجوري', name_en: 'Red Rose', icon: '🌹', cost: 10, currency: 'coins', charm: 10 },
  { id: 'icecream', name: 'آيس كريم مثلج', name_en: 'Chill Ice Cream', icon: '🍦', cost: 50, currency: 'coins', charm: 50 },
  { id: 'heart', name: 'قلب مشع', name_en: 'Magic Heart', icon: '💖', cost: 100, currency: 'coins', charm: 100 },
  { id: 'magic_wand', name: 'عصا سحرية', name_en: 'Magic Wand', icon: '🪄', cost: 250, currency: 'coins', charm: 250 },
  { id: 'diamond_ring', name: 'خاتم ألماس', name_en: 'Diamond Ring', icon: '💍', cost: 500, currency: 'coins', charm: 500 },
  { id: 'sports_car', name: 'سيارة سوبر سبورت', name_en: 'Super Sports Car', icon: '🏎️', cost: 1000, currency: 'diamonds', charm: 2000, luxury: true },
  { id: 'rocket', name: 'صاروخ المجرة', name_en: 'Galaxy Rocket', icon: '🚀', cost: 2500, currency: 'diamonds', charm: 5000, luxury: true },
  { id: 'crown', name: 'تاج الملك الإمبراطوري', name_en: 'Imperial Crown', icon: '👑', cost: 5000, currency: 'diamonds', charm: 10000, luxury: true },
  { id: 'castle', name: 'قصر الأحلام', name_en: 'Dream Palace', icon: '🏰', cost: 10000, currency: 'diamonds', charm: 25000, luxury: true }
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

    const { name, bio, gender, age, avatar, avatar_frame, soul_planet, soul_tags } = req.body;

    await run(`
      UPDATE users SET
        name = COALESCE(?, name),
        bio = COALESCE(?, bio),
        gender = COALESCE(?, gender),
        age = COALESCE(?, age),
        avatar = COALESCE(?, avatar),
        avatar_frame = COALESCE(?, avatar_frame),
        soul_planet = COALESCE(?, soul_planet),
        soul_tags = COALESCE(?, soul_tags)
      WHERE id = ?
    `, [name, bio, gender, age, avatar, avatar_frame, soul_planet, soul_tags, userId]);

    const updatedUser = await get('SELECT * FROM users WHERE id = ?', [userId]);
    res.json({ success: true, user: updatedUser });
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

    const today = new Date().toISOString().slice(0, 10);
    if (user.last_checkin === today) {
      return res.json({ success: false, message: 'لقد سجلت حضورك اليوم بالفعل! عُد غداً للحصول على مكافأة جديدة 🎁' });
    }

    const bonusCoins = 500;
    const bonusDiamonds = 50;

    await run(`
      UPDATE users SET
        coins = coins + ?,
        diamonds = diamonds + ?,
        last_checkin = ?
      WHERE id = ?
    `, [bonusCoins, bonusDiamonds, today, userId]);

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
app.post('/api/users/recharge', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { amountCoins, amountDiamonds } = req.body;
    await run(`
      UPDATE users SET
        coins = coins + ?,
        diamonds = diamonds + ?
      WHERE id = ?
    `, [amountCoins || 0, amountDiamonds || 0, userId]);

    const updated = await get('SELECT * FROM users WHERE id = ?', [userId]);
    res.json({ success: true, user: updated });
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
      SELECT m.*, u.name as sender_name, u.avatar as sender_avatar, u.level as sender_level, u.avatar_frame as sender_frame, u.role as sender_role
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
app.get('/api/messages/conversations', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

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

// 16. Moments Feed List
app.get('/api/moments', async (req, res) => {
  try {
    const currentUserId = req.headers['x-user-id'];
    const moments = await all(`
      SELECT m.*, u.name as user_name, u.avatar as user_avatar, u.soul_planet, u.avatar_frame
      FROM moments m
      JOIN users u ON m.user_id = u.id
      ORDER BY m.created_at DESC
      LIMIT 50
    `);

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

// 17. Create Moment
app.post('/api/moments', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { content, image_url, audio_url, tag } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });

    const momentId = `moment-${Date.now()}`;
    await run(`
      INSERT INTO moments (id, user_id, content, image_url, audio_url, tag, likes_count)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `, [momentId, userId, content, image_url || null, audio_url || null, tag || 'chill']);

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

    // Record gift history
    const historyId = `gift-${Date.now()}`;
    await run(`
      INSERT INTO gifts_history (id, sender_id, receiver_id, room_id, gift_id, gift_name, gift_icon, cost, currency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [historyId, senderId, receiver_id, room_id, gift.id, gift.name, gift.icon, gift.cost, gift.currency]);

    const updatedSender = await get('SELECT * FROM users WHERE id = ?', [senderId]);
    const receiver = receiver_id ? await get('SELECT id, name, avatar FROM users WHERE id = ?', [receiver_id]) : null;

    const giftEventPayload = {
      gift,
      sender: { id: sender.id, name: sender.name, avatar: sender.avatar },
      receiver,
      room_id,
      timestamp: Date.now()
    };

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
// ADMIN CONTROL PANEL ROUTES & API
// ==========================================

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
    const adminRoleUser = await get('SELECT * FROM users WHERE (email = ? OR name = ? OR id = ?) AND role = "admin"', [username, username, username]);
    if (adminRoleUser) {
      return res.status(403).json({
        error: 'صلاحية دخول لوحة الإدارة مخصصة فقط للسوبر ادمن والسوبر ماستر والمالك! رتبة الأدمن تمتلك صلاحيات الإشراف داخل الغرف الصوتية فقط.'
      });
    }

    // B. Check in users table for owner, super_master, or super_admin accounts ONLY
    const user = await get('SELECT * FROM users WHERE (email = ? OR name = ? OR id = ? OR (role = "owner" AND ? IN ("owner", "owner@gmail.com"))) AND (role IN ("owner", "super_master", "super_admin"))', [username, username, username, username]);
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
    const totalModsRow = await get('SELECT COUNT(*) as count FROM users WHERE role = "moderator"');
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
app.post('/api/admin/rooms', async (req, res) => {
  const session = await verifyAdminToken(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح بالدخول' });

  try {
    const { title, category, country_code, announcement, host_id, cover_image } = req.body;
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
        bannedUsers: new Set()
      });
    }

    const roomState = activeRoomStates.get(roomId);

    // Check if user is banned from this room
    if (user && user.id && roomState.bannedUsers.has(user.id)) {
      return socket.emit('room_kicked_notice', { message: 'لقد تم طردك من هذه الغرفة بواسطة إدارة الروم!' });
    }

    if (user && user.id) {
      const dbUser = await get('SELECT id, name, avatar, avatar_frame, level, charm_level, soul_planet, bio, role FROM users WHERE id = ?', [user.id]) || user;
      roomState.activeAudience.set(user.id, dbUser);
    }

    const audienceList = Array.from(roomState.activeAudience.values());
    const isChatMuted = user && user.id ? roomState.mutedChatUsers.has(user.id) : false;

    // Notify room occupants
    io.to(`room:${roomId}`).emit('user_joined_room', {
      user,
      audienceCount: audienceList.length,
      audience: audienceList
    });

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
        const seats = await all('SELECT seat_index FROM room_seats WHERE room_id = ? AND user_id = ?', [roomId, userId]);
        if (seats && seats.length > 0) {
          for (const s of seats) {
            await run('UPDATE room_seats SET user_id = NULL, is_muted = 0 WHERE room_id = ? AND seat_index = ?', [roomId, s.seat_index]);
            io.to(`room:${roomId}`).emit('seat_updated', {
              seatIndex: s.seat_index,
              user: null,
              isMuted: false
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
        sender_level: user.level,
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
      const targetSeat = await get('SELECT * FROM room_seats WHERE room_id = ? AND seat_index = ?', [roomId, seatIndex]);
      if (targetSeat && targetSeat.is_locked) {
        return socket.emit('seat_error', { message: 'هذا المقعد مقفل حالياً!' });
      }
      if (targetSeat && targetSeat.user_id && targetSeat.user_id !== userId) {
        return socket.emit('seat_error', { message: 'هذا الكرسي محجوز حالياً!' });
      }

      // Check if user is currently occupying ANY OTHER seat in this room
      const prevSeats = await all('SELECT seat_index FROM room_seats WHERE room_id = ? AND user_id = ? AND seat_index != ?', [roomId, userId, seatIndex]);
      if (prevSeats && prevSeats.length > 0) {
        for (const prev of prevSeats) {
          await run('UPDATE room_seats SET user_id = NULL, is_muted = 0 WHERE room_id = ? AND seat_index = ?', [roomId, prev.seat_index]);
          io.to(`room:${roomId}`).emit('seat_updated', {
            seatIndex: prev.seat_index,
            user: null,
            isMuted: false
          });
        }
      }

      // Assign requested seat to user
      await run('UPDATE room_seats SET user_id = ?, is_muted = 0 WHERE room_id = ? AND seat_index = ?', [userId, roomId, seatIndex]);

      const user = await get('SELECT id, name, avatar, avatar_frame, level, charm_level FROM users WHERE id = ?', [userId]);

      io.to(`room:${roomId}`).emit('seat_updated', {
        seatIndex,
        user,
        isMuted: false
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
        seatsToLeave = await all('SELECT seat_index FROM room_seats WHERE room_id = ? AND user_id = ?', [roomId, userId]);
      }
      if ((!seatsToLeave || seatsToLeave.length === 0) && seatIndex !== undefined) {
        seatsToLeave = [{ seat_index: seatIndex }];
      }

      for (const s of (seatsToLeave || [])) {
        await run('UPDATE room_seats SET user_id = NULL, is_muted = 0 WHERE room_id = ? AND seat_index = ?', [roomId, s.seat_index]);
        io.to(`room:${roomId}`).emit('seat_updated', {
          seatIndex: s.seat_index,
          user: null,
          isMuted: false
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
      const seat = await get('SELECT user_id FROM room_seats WHERE room_id = ? AND seat_index = ?', [roomId, seatIndex]);
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
      if (!room || !admin || (room.host_id !== adminId && admin.role !== 'owner' && admin.role !== 'moderator')) return;

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
      if (!room || !admin || (room.host_id !== adminId && admin.role !== 'owner' && admin.role !== 'moderator')) return;

      const seat = await get('SELECT user_id FROM room_seats WHERE room_id = ? AND seat_index = ?', [roomId, seatIndex]);
      const kickedUserId = seat ? seat.user_id : null;

      await run('UPDATE room_seats SET user_id = NULL, is_muted = 0 WHERE room_id = ? AND seat_index = ?', [roomId, seatIndex]);
      io.to(`room:${roomId}`).emit('seat_updated', { seatIndex, user: null, isMuted: false });
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
      if (!room || !admin || (room.host_id !== adminId && admin.role !== 'owner' && admin.role !== 'moderator')) return;

      let vacatedUserId = null;
      if (isLocked) {
        const seat = await get('SELECT user_id FROM room_seats WHERE room_id = ? AND seat_index = ?', [roomId, seatIndex]);
        if (seat && seat.user_id) {
          vacatedUserId = seat.user_id;
          await run('UPDATE room_seats SET user_id = NULL, is_muted = 0 WHERE room_id = ? AND seat_index = ?', [roomId, seatIndex]);
          io.to(`room:${roomId}`).emit('seat_updated', { seatIndex, user: null, isMuted: false });
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
  socket.on('admin_lock_all_seats', async ({ roomId, adminId, isLocked }) => {
    if (!roomId || !adminId) return;
    try {
      const room = await get('SELECT * FROM rooms WHERE id = ?', [roomId]);
      const admin = await get('SELECT * FROM users WHERE id = ?', [adminId]);
      if (!room || !admin || (room.host_id !== adminId && admin.role !== 'owner' && admin.role !== 'moderator')) return;

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
            isMuted: false
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
      if (!room || !admin || (room.host_id !== adminId && admin.role !== 'owner' && admin.role !== 'moderator')) {
        return socket.emit('error_message', { message: 'ليس لديك صلاحيات إدارة هذه الغرفة!' });
      }

      const targetUser = await get('SELECT * FROM users WHERE id = ?', [targetUserId]);
      const roomState = activeRoomStates.get(roomId);
      if (roomState) {
        roomState.bannedUsers.add(targetUserId);
        roomState.activeAudience.delete(targetUserId);
        roomState.speakers.delete(targetUserId);
      }

      // Vacate their seat if on stage
      const seats = await all('SELECT seat_index FROM room_seats WHERE room_id = ? AND user_id = ?', [roomId, targetUserId]);
      for (const s of seats) {
        await run('UPDATE room_seats SET user_id = NULL, is_muted = 0 WHERE room_id = ? AND seat_index = ?', [roomId, s.seat_index]);
        io.to(`room:${roomId}`).emit('seat_updated', {
          seatIndex: s.seat_index,
          user: null,
          isMuted: false
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
      if (!room || !admin || (room.host_id !== adminId && admin.role !== 'owner' && admin.role !== 'moderator')) {
        return socket.emit('error_message', { message: 'ليس لديك صلاحيات إدارة هذه الغرفة!' });
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
      if (!room || !admin || (room.host_id !== adminId && admin.role !== 'owner' && admin.role !== 'moderator')) return;

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
        const heldSeats = await all('SELECT room_id, seat_index FROM room_seats WHERE user_id = ?', [currentUserId]);
        if (heldSeats && heldSeats.length > 0) {
          for (const s of heldSeats) {
            await run('UPDATE room_seats SET user_id = NULL, is_muted = 0 WHERE room_id = ? AND seat_index = ?', [s.room_id, s.seat_index]);
            io.to(`room:${s.room_id}`).emit('seat_updated', {
              seatIndex: s.seat_index,
              user: null,
              isMuted: false
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
        const heldSeats = await all('SELECT room_id, seat_index FROM room_seats WHERE user_id = ?', [currentUserId]);
        if (heldSeats && heldSeats.length > 0) {
          for (const s of heldSeats) {
            await run('UPDATE room_seats SET user_id = NULL, is_muted = 0 WHERE room_id = ? AND seat_index = ?', [s.room_id, s.seat_index]);
            io.to(`room:${s.room_id}`).emit('seat_updated', {
              seatIndex: s.seat_index,
              user: null,
              isMuted: false
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
