const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'soulchill.sqlite');
const db = new sqlite3.Database(DB_PATH);

// Helper for db promises
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function initDB() {
  console.log('Initializing SQLite Database for SoulChill...');

  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      google_id TEXT UNIQUE,
      email TEXT UNIQUE,
      name TEXT NOT NULL,
      avatar TEXT,
      bio TEXT,
      gender TEXT DEFAULT 'other',
      age INTEGER DEFAULT 22,
      soul_planet TEXT DEFAULT 'كوكب الرومانسي الحالم',
      soul_score INTEGER DEFAULT 88,
      soul_tags TEXT DEFAULT 'موسيقى,هدوء,سفر,أفلام',
      role TEXT DEFAULT 'user',
      coins INTEGER DEFAULT 1200,
      diamonds INTEGER DEFAULT 350,
      level INTEGER DEFAULT 5,
      wealth_level INTEGER DEFAULT 3,
      charm_level INTEGER DEFAULT 4,
      avatar_frame TEXT DEFAULT 'cosmic_ring',
      last_checkin TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT DEFAULT 'chill',
      room_type TEXT DEFAULT 'voice',
      cover_image TEXT,
      likes_count INTEGER DEFAULT 0,
      host_id TEXT NOT NULL,
      co_host_id TEXT,
      is_pk_active INTEGER DEFAULT 0,
      country_code TEXT DEFAULT 'JO',
      country_name TEXT DEFAULT 'الأردن',
      country_flag TEXT DEFAULT '🇯🇴',
      creator_ip TEXT DEFAULT '127.0.0.1',
      theme TEXT DEFAULT 'cosmic_purple',
      announcement TEXT,
      bg_music TEXT,
      is_locked INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (host_id) REFERENCES users(id)
    )
  `);

  // Migrations for rooms country & IP
  try { await run(`ALTER TABLE rooms ADD COLUMN country_code TEXT DEFAULT 'JO'`); } catch (e) {}
  try { await run(`ALTER TABLE rooms ADD COLUMN country_name TEXT DEFAULT 'الأردن'`); } catch (e) {}
  try { await run(`ALTER TABLE rooms ADD COLUMN country_flag TEXT DEFAULT '🇯🇴'`); } catch (e) {}
  try { await run(`ALTER TABLE rooms ADD COLUMN creator_ip TEXT DEFAULT '127.0.0.1'`); } catch (e) {}

  // Update existing rooms if needed
  try {
    await run(`UPDATE rooms SET country_code = 'JO', country_name = 'الأردن', country_flag = '🇯🇴' WHERE id = 'room-soul-1'`);
    await run(`UPDATE rooms SET country_code = 'SA', country_name = 'السعودية', country_flag = '🇸🇦' WHERE id = 'room-soul-2'`);
    await run(`UPDATE rooms SET country_code = 'EG', country_name = 'مصر', country_flag = '🇪🇬' WHERE id = 'room-soul-3'`);
    await run(`UPDATE rooms SET country_code = 'AE', country_name = 'الإمارات', country_flag = '🇦🇪' WHERE id = 'room-soul-4'`);
    await run(`UPDATE rooms SET country_code = 'JO', country_name = 'الأردن', country_flag = '🇯🇴' WHERE country_code IS NULL OR country_code = ''`);
  } catch (e) {}

  await run(`
    CREATE TABLE IF NOT EXISTS email_verifications (
      email TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS room_seats (
      room_id TEXT NOT NULL,
      seat_index INTEGER NOT NULL,
      user_id TEXT,
      is_muted INTEGER DEFAULT 0,
      is_locked INTEGER DEFAULT 0,
      PRIMARY KEY (room_id, seat_index)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      receiver_id TEXT,
      room_id TEXT,
      message_type TEXT DEFAULT 'text',
      content TEXT,
      media_url TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS moments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      image_url TEXT,
      audio_url TEXT,
      tag TEXT DEFAULT 'chill',
      likes_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS moment_likes (
      moment_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (moment_id, user_id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS moment_comments (
      id TEXT PRIMARY KEY,
      moment_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (moment_id) REFERENCES moments(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS gifts_history (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      receiver_id TEXT,
      room_id TEXT,
      gift_id TEXT NOT NULL,
      gift_name TEXT NOT NULL,
      gift_icon TEXT NOT NULL,
      cost INTEGER NOT NULL,
      currency TEXT DEFAULT 'coins',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS user_inventory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      is_active INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS admin_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS moderator_accounts (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT NOT NULL,
      user_id TEXT NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // SMTP Settings Table
  await run(`
    CREATE TABLE IF NOT EXISTS smtp_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      host TEXT NOT NULL DEFAULT 'smtp.gmail.com',
      port INTEGER NOT NULL DEFAULT 587,
      user TEXT NOT NULL DEFAULT 'chatadman@gmail.com',
      pass TEXT NOT NULL DEFAULT 'vaemviqqwzjbmvks',
      from_email TEXT NOT NULL DEFAULT 'chat<chatadman@gmail.com>',
      subject_template TEXT NOT NULL DEFAULT 'رمز التحقق الخاص بك لتطبيق SoulChill 🪐',
      html_template TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const defaultHtmlTemplate = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0b0c1b; margin: 0; padding: 20px; color: #ffffff; direction: rtl; text-align: right; }
    .email-container { max-width: 520px; margin: 0 auto; background: #15172e; border: 1px solid #2d325a; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    .email-header { background: linear-gradient(135deg, #7c3aed, #ec4899); padding: 30px 20px; text-align: center; }
    .email-header h1 { margin: 0; font-size: 26px; color: #ffffff; letter-spacing: 1px; }
    .email-body { padding: 30px 25px; text-align: center; }
    .greeting { font-size: 18px; font-weight: 700; color: #ffffff; margin-bottom: 12px; }
    .desc { font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 25px; }
    .code-box { background: rgba(124, 58, 237, 0.15); border: 2px dashed #a855f7; border-radius: 12px; padding: 18px; margin: 20px 0; display: inline-block; width: 85%; }
    .otp-code { font-size: 36px; font-weight: 900; letter-spacing: 8px; color: #fbbf24; font-family: monospace; }
    .expiry { font-size: 12px; color: #cbd5e1; margin-top: 8px; }
    .security-notice { font-size: 12px; color: #64748b; margin-top: 25px; border-top: 1px solid #222649; padding-top: 15px; }
    .email-footer { background: #0f1023; padding: 15px; text-align: center; font-size: 11px; color: #475569; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1>🪐 SoulChill</h1>
      <p style="margin: 5px 0 0; color: #f1f5f9; font-size: 13px;">عالم الغرف الصوتية واكتشاف الأرواح</p>
    </div>
    <div class="email-body">
      <div class="greeting">مرحباً بك في مجتمع SoulChill! ✨</div>
      <div class="desc">
        لقد طلبت تسجيل الدخول أو توثيق حساب Gmail الخاص بك: <br>
        <strong style="color: #38bdf8;">{{email}}</strong>
      </div>
      <div class="code-box">
        <div style="font-size: 13px; color: #e2e8f0; margin-bottom: 6px;">رمز التحقق السري (OTP):</div>
        <div class="otp-code">{{code}}</div>
        <div class="expiry">صلاحية هذا الرمز هي 10 دقائق فقط ⏱️</div>
      </div>
      <div class="security-notice">
        ⚠️ تنبيه أمني: لا تشارك هذا الرمز مع أي شخص، فريق إدارة SoulChill لن يطلب منك هذا الرمز أبداً.
      </div>
    </div>
    <div class="email-footer">
      جميع الحقوق محفوظة © SoulChill 🪐 منصة الغرف الصوتية المباشرة
    </div>
  </div>
</body>
</html>`;

  const existingSmtp = await get('SELECT * FROM smtp_settings WHERE id = 1');
  if (!existingSmtp) {
    await run(`
      INSERT INTO smtp_settings (id, host, port, user, pass, from_email, subject_template, html_template, is_enabled)
      VALUES (1, 'smtp.gmail.com', 587, 'chatadman@gmail.com', 'vaemviqqwzjbmvks', 'chat<chatadman@gmail.com>', 'رمز التحقق الخاص بك لتطبيق SoulChill 🪐', ?, 1)
    `, [defaultHtmlTemplate]);
    console.log('✅ Default SMTP settings initialized with chatadman@gmail.com');
  } else {
    // Ensure credentials match user specified settings
    await run(`
      UPDATE smtp_settings SET
        host = 'smtp.gmail.com',
        port = 587,
        user = 'chatadman@gmail.com',
        pass = 'vaemviqqwzjbmvks',
        from_email = 'chat<chatadman@gmail.com>'
      WHERE id = 1
    `);
  }

  // Ensure is_banned column exists on users
  try { await run(`ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0`); } catch (e) {}

  // Seed default admin credentials if not set
  const adminRow = await get('SELECT * FROM admin_credentials WHERE username = "owner"');
  if (!adminRow) {
    await run(`
      INSERT OR IGNORE INTO admin_credentials (username, password, role)
      VALUES (?, ?, 'owner')
    `, ['owner', 'admin123456']);
    await run(`
      INSERT OR IGNORE INTO admin_credentials (username, password, role)
      VALUES (?, ?, 'super_admin')
    `, ['admin', 'admin123456']);
    console.log('✅ Default Owner/Admin credentials initialized: username="owner" or "admin", password="admin123456"');
  }

  // Check if seed data exists
  const userCount = await get('SELECT COUNT(*) as count FROM users');
  if (userCount.count === 0) {
    console.log('Seeding initial SoulChill data...');
    await seedInitialData();
  } else {
    console.log(`Database already has ${userCount.count} users.`);
  }
}

async function seedInitialData() {
  const seedUsers = [
    {
      id: 'sc-owner-001',
      google_id: 'google-owner-001',
      email: 'owner@gmail.com',
      name: '👑 الإمبراطور | مالك التطبيق',
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=300&q=80',
      bio: 'صاحب ومشرف تطبيق SoulChill الرسمي 🪐 كامل الصلاحيات لجميع الرومات والبثوث 👑✨',
      gender: 'male',
      age: 28,
      soul_planet: 'كوكب الإمبراطور الفلكي 👑🪐',
      soul_score: 99,
      soul_tags: 'إدارة,تطوير,مالك_الموقع,VIP',
      role: 'owner',
      coins: 999999,
      diamonds: 999999,
      level: 999,
      wealth_level: 99,
      charm_level: 99,
      avatar_frame: 'imperial_owner'
    },
    {
      id: 'sc-user-1001',
      google_id: 'google-layla-1001',
      email: 'layla.soul@gmail.com',
      name: 'ليلى | Soul Queen 👑',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80',
      bio: 'عاشقة الموسيقى الكلاسيكية والسماء المرصعة بالنجوم ✨ مرحباً بكم في كوكبي 🪐',
      gender: 'female',
      age: 23,
      soul_planet: 'كوكب الرومانسي الحالم 🌌',
      soul_score: 95,
      soul_tags: 'موسيقى,رومانسية,شعر,نجوم',
      coins: 4500,
      diamonds: 1850,
      level: 12,
      wealth_level: 6,
      charm_level: 9,
      avatar_frame: 'galaxy_halo'
    },
    {
      id: 'sc-user-1002',
      google_id: 'google-tariq-1002',
      email: 'tariq.adventurer@gmail.com',
      name: 'طارق الدوسري 🎸',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80',
      bio: 'عازف جيتار، مستكشف، وأحب السوالف الرايقة والضحك 🎶🚀',
      gender: 'male',
      age: 26,
      soul_planet: 'كوكب المغامر الشغوف 🚀',
      soul_score: 91,
      soul_tags: 'جيتار,سفر,ألعاب,ضحك',
      coins: 8200,
      diamonds: 3200,
      level: 18,
      wealth_level: 9,
      charm_level: 7,
      avatar_frame: 'cyber_neon'
    },
    {
      id: 'sc-user-1003',
      google_id: 'google-nour-1003',
      email: 'nour.designer@gmail.com',
      name: 'نور القمر 🌙',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80',
      bio: 'فنانة تشكيلية ومهندسة ديكور، أبحث عن أرواح تشبهني في عالم السول 🎨💜',
      gender: 'female',
      age: 24,
      soul_planet: 'كوكب الفنان الملهم 🎨',
      soul_score: 88,
      soul_tags: 'رسم,فنون,قهوة,هدوء',
      coins: 3100,
      diamonds: 940,
      level: 8,
      wealth_level: 4,
      charm_level: 8,
      avatar_frame: 'royal_gold'
    },
    {
      id: 'sc-user-1004',
      google_id: 'google-faisal-1004',
      email: 'faisal.gamer@gmail.com',
      name: 'فيصل King 👑',
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80',
      bio: 'ستريمر وبثوث يومية، لا تفوتكم تحديات الروم والـ PK الحماسية! 🔥',
      gender: 'male',
      age: 25,
      soul_planet: 'كوكب المحارب الرقمي ⚡',
      soul_score: 84,
      soul_tags: 'ألعاب,تحديات,بثوث,حماس',
      coins: 15400,
      diamonds: 6200,
      level: 24,
      wealth_level: 12,
      charm_level: 10,
      avatar_frame: 'fire_dragon'
    },
    {
      id: 'sc-user-1005',
      google_id: 'google-sarah-1005',
      email: 'sarah.psych@gmail.com',
      name: 'سارة الحكيمة 🔮',
      avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=300&q=80',
      bio: 'استمع للجميع، أحلل لغات الجسد والأبراج وعلم الفلك 🌌 تعال وافتح قلبك',
      gender: 'female',
      age: 27,
      soul_planet: 'كوكب الفيلسوف الحكيم 🔮',
      soul_score: 93,
      soul_tags: 'فلسفة,كتب,أبراج,علم نفس',
      coins: 5200,
      diamonds: 1400,
      level: 10,
      wealth_level: 5,
      charm_level: 9,
      avatar_frame: 'angel_wings'
    },
    {
      id: 'sc-user-1006',
      google_id: 'google-omar-1006',
      email: 'omar.chill@gmail.com',
      name: 'عمر Chill Guy ☕',
      avatar: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=300&q=80',
      bio: 'رواق بدون قيود، قهوة ليلية وموسيقى لو-فاي هادئة 🎧',
      gender: 'male',
      age: 22,
      soul_planet: 'كوكب النسمة الهادئة 🍃',
      soul_score: 87,
      soul_tags: 'لوفاي,قهوة,مسلسلات,سكون',
      coins: 2900,
      diamonds: 450,
      level: 6,
      wealth_level: 3,
      charm_level: 6,
      avatar_frame: 'cosmic_ring'
    }
  ];

  for (const u of seedUsers) {
    await run(`
      INSERT INTO users (id, google_id, email, name, avatar, bio, gender, age, soul_planet, soul_score, soul_tags, coins, diamonds, level, wealth_level, charm_level, avatar_frame)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [u.id, u.google_id, u.email, u.name, u.avatar, u.bio, u.gender, u.age, u.soul_planet, u.soul_score, u.soul_tags, u.coins, u.diamonds, u.level, u.wealth_level, u.charm_level, u.avatar_frame]);
  }

  // Seed Rooms
  const seedRooms = [
    {
      id: 'room-soul-1',
      title: 'جلسة طرب ووناسة ليلية 🎶💜',
      category: 'music',
      room_type: 'voice',
      cover_image: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80',
      likes_count: 320,
      host_id: 'sc-user-1001',
      country_code: 'JO',
      country_name: 'الأردن',
      country_flag: '🇯🇴',
      creator_ip: '94.249.0.1',
      theme: 'cosmic_purple',
      announcement: 'أهلاً بكم في جلسة الطرب والكلام الطيب! احترام الجميع هو عنواننا 🌟'
    },
    {
      id: 'room-soul-2',
      title: 'بث لايف مباشر: تحديات جيمنج وسوالف بالفيديو 🎥🔥',
      category: 'gaming',
      room_type: 'video',
      cover_image: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=600&q=80',
      likes_count: 1450,
      host_id: 'sc-user-1004',
      country_code: 'SA',
      country_name: 'السعودية',
      country_flag: '🇸🇦',
      creator_ip: '178.80.0.1',
      theme: 'cyber_neon',
      announcement: 'بث مباشر بالفيديو! لا تفوتكم أقوى تحديات الـ PK والهدايا الملكية 🚀'
    },
    {
      id: 'room-soul-3',
      title: 'رواق وقهوة وسماع لوفاي هادئ ☕🌙',
      category: 'chill',
      room_type: 'voice',
      cover_image: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80',
      likes_count: 510,
      host_id: 'sc-user-1006',
      country_code: 'EG',
      country_name: 'مصر',
      country_flag: '🇪🇬',
      creator_ip: '197.38.0.1',
      theme: 'romantic_sunset',
      announcement: 'مساحة هادئة بعد يوم طويل.. تفضل خذ لك كرسي واسمع الموسيقى 🎧'
    },
    {
      id: 'room-soul-4',
      title: 'لايف كاميرا: قراءة الأبراج وتوافق كواكب الأرواح 🔮✨',
      category: 'dating',
      room_type: 'video',
      cover_image: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=600&q=80',
      likes_count: 890,
      host_id: 'sc-user-1005',
      country_code: 'AE',
      country_name: 'الإمارات',
      country_flag: '🇦🇪',
      creator_ip: '94.200.0.1',
      theme: 'royal_gold',
      announcement: 'تعال في البث المباشر واطلب معرفة توافق كوكبك وشريك روحك الفلكي 🌌'
    },
    {
      id: 'room-soul-5',
      title: 'سهرة أهل النشامى وسوالف الشمال والجنوب 🇯🇴☕',
      category: 'chat',
      room_type: 'voice',
      cover_image: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=600&q=80',
      likes_count: 730,
      host_id: 'sc-user-1002',
      country_code: 'JO',
      country_name: 'الأردن',
      country_flag: '🇯🇴',
      creator_ip: '94.249.25.10',
      theme: 'cosmic_purple',
      announcement: 'أهلاً وسهلاً بالجميع، سوالف وضحك وأجواء رايقة 🌟'
    },
    {
      id: 'room-soul-6',
      title: 'سهرة حبايبنا في العراق ووناسة بغدادية 🇮🇶🎶',
      category: 'music',
      room_type: 'voice',
      cover_image: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=600&q=80',
      likes_count: 640,
      host_id: 'sc-user-1003',
      country_code: 'IQ',
      country_name: 'العراق',
      country_flag: '🇮🇶',
      creator_ip: '149.255.0.1',
      theme: 'cyber_neon',
      announcement: 'كل الهلا بيكم حبايبنا، طرب وشعر وسوالف حلوة 🇮🇶✨'
    },
    {
      id: 'room-soul-7',
      title: 'قعدة شباب وبنات المغرب العربي ديما نشاط 🇲🇦🌟',
      category: 'chat',
      room_type: 'voice',
      cover_image: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?auto=format&fit=crop&w=600&q=80',
      likes_count: 480,
      host_id: 'sc-user-1004',
      country_code: 'MA',
      country_name: 'المغرب',
      country_flag: '🇲🇦',
      creator_ip: '196.12.0.1',
      theme: 'romantic_sunset',
      announcement: 'مرحباً بالجميع ديما مغرب وأحلى جمعة مع الأصدقاء 🇲🇦'
    },
    {
      id: 'room-soul-8',
      title: 'ملتقى الأرواح العالمي لكافة الأصدقاء 🌍🪐',
      category: 'chill',
      room_type: 'voice',
      cover_image: 'https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=600&q=80',
      likes_count: 1200,
      host_id: 'sc-owner-001',
      country_code: 'GLOBAL',
      country_name: 'عالمي',
      country_flag: '🌍',
      creator_ip: '8.8.8.8',
      theme: 'royal_gold',
      announcement: 'غرفة الإمبراطور العالمية لكل كواكب الأرواح من شتى بقاع الأرض 🪐👑'
    }
  ];

  for (const r of seedRooms) {
    await run(`
      INSERT OR REPLACE INTO rooms (id, title, category, room_type, cover_image, likes_count, host_id, country_code, country_name, country_flag, creator_ip, theme, announcement)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [r.id, r.title, r.category, r.room_type || 'voice', r.cover_image, r.likes_count || 100, r.host_id, r.country_code || 'JO', r.country_name || 'الأردن', r.country_flag || '🇯🇴', r.creator_ip || '127.0.0.1', r.theme, r.announcement]);

    // Setup 8 seats for each room
    // Seat 0 is the host
    await run(`
      INSERT OR REPLACE INTO room_seats (room_id, seat_index, user_id, is_muted, is_locked)
      VALUES (?, 0, ?, 0, 0)
    `, [r.id, r.host_id]);

    // Some seats occupied by seed friends
    for (let i = 1; i <= 8; i++) {
      let occupant = null;
      if (r.id === 'room-soul-1') {
        if (i === 1) occupant = 'sc-user-1002';
        if (i === 2) occupant = 'sc-user-1003';
      } else if (r.id === 'room-soul-2') {
        if (i === 1) occupant = 'sc-user-1001';
        if (i === 2) occupant = 'sc-user-1005';
        if (i === 3) occupant = 'sc-user-1002';
      }
      await run(`
        INSERT OR IGNORE INTO room_seats (room_id, seat_index, user_id, is_muted, is_locked)
        VALUES (?, ?, ?, 0, 0)
      `, [r.id, i, occupant]);
    }
  }

  // Seed Moments
  const seedMoments = [
    {
      id: 'moment-1',
      user_id: 'sc-user-1001',
      content: 'السماء الليلة مليئة بالنجوم، والموسيقى الهادئة تأخذ الروح إلى أبعاد بعيدة 🌌✨ ما هي أغنيتكم المفضلة في مثل هذا الوقت؟',
      image_url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80',
      tag: 'chill',
      likes_count: 34
    },
    {
      id: 'moment-2',
      user_id: 'sc-user-1002',
      content: 'عزفنا اليوم لحن جديد مع الأصدقاء في روم SoulChill.. طاقة المكان خيالية! شكراً لكل اللي طلعوا معي على المايك 🎸🔥',
      image_url: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80',
      tag: 'music',
      likes_count: 58
    },
    {
      id: 'moment-3',
      user_id: 'sc-user-1003',
      content: 'لوحة جديدة رسمتها اليوم مستوحاة من ألوان كواكب السول شل البنفسجية والوردية 🎨 كيف رأيكم بالتدرجات؟',
      image_url: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=600&q=80',
      tag: 'art',
      likes_count: 42
    }
  ];

  for (const m of seedMoments) {
    await run(`
      INSERT INTO moments (id, user_id, content, image_url, tag, likes_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [m.id, m.user_id, m.content, m.image_url, m.tag, m.likes_count]);

    // Seed comments
    await run(`
      INSERT INTO moment_comments (id, moment_id, user_id, content)
      VALUES (?, ?, ?, ?)
    `, [`cmt-${m.id}-1`, m.id, 'sc-user-1002', 'أبدعتِ يا ليلى، ذوقك راقي جداً 🎶👏']);
  }

  // Seed Direct Messages between users
  const seedMessages = [
    {
      id: 'msg-seed-1',
      sender_id: 'sc-user-1002',
      receiver_id: 'sc-user-1001',
      message_type: 'text',
      content: 'مرحباً ليلى! جلسة البارحة كانت رائعة جداً 🌟 صوتك في الروم كان رهيب'
    },
    {
      id: 'msg-seed-2',
      sender_id: 'sc-user-1001',
      receiver_id: 'sc-user-1002',
      message_type: 'text',
      content: 'أهلاً طارق! يسعد قلبك يا رب، عزفك على الجيتار أضاف بهجة خرافية للروم 🎸✨'
    }
  ];

  for (const msg of seedMessages) {
    await run(`
      INSERT INTO messages (id, sender_id, receiver_id, message_type, content)
      VALUES (?, ?, ?, ?, ?)
    `, [msg.id, msg.sender_id, msg.receiver_id, msg.message_type, msg.content]);
  }

  console.log('Seed data successfully inserted!');
}

module.exports = {
  db,
  run,
  get,
  all,
  initDB
};
