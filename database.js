// =====================================================
//  قاعدة بيانات SQLite3 - شات نجوم العرب
// =====================================================
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'chat.db');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`PRAGMA journal_mode = WAL`);
  db.run(`PRAGMA foreign_keys = ON`);

  // ---------- المستخدمون ----------
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT,
    email TEXT DEFAULT '',
    gender TEXT DEFAULT 'secret',          -- boy | girl | secret
    age INTEGER DEFAULT 25,
    country TEXT DEFAULT '',
    balance INTEGER DEFAULT 0,             -- الرصيد
    membership TEXT DEFAULT 'none',        -- none | plus | premium | vip | mmez
    membership_expires INTEGER DEFAULT 0,
    rank TEXT DEFAULT 'user',              -- user | roomadmin | admin | superadmin | supermaster
    registered INTEGER DEFAULT 0,          -- 0=ضيف 1=مسجل
    avatar TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    status TEXT DEFAULT 'online',          -- online | busy | away
    banned INTEGER DEFAULT 0,
    muted INTEGER DEFAULT 0,
    ip TEXT DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  db.run(`ALTER TABLE users ADD COLUMN is_bot INTEGER DEFAULT 0`, () => { });
  // صلاحية فردية تمنحها الإدارة للمستخدم للصعود كمذيع.
  db.run(`ALTER TABLE users ADD COLUMN broadcast_allowed INTEGER DEFAULT 0`, () => { });
  // استهلاك المكالمة المجانية الأولى (دقيقة واحدة تجريبية)
  db.run(`ALTER TABLE users ADD COLUMN free_call_used INTEGER DEFAULT 0`, () => { });
  // معرف جهاز دائم للحظر الإداري حتى عند تغيّر عنوان IP.
  db.run(`ALTER TABLE users ADD COLUMN device_id TEXT DEFAULT ''`, () => { });
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_device_id ON users (device_id)`);

  // ---------- الغرف ----------
  db.run(`CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT 'اهلا وسهلا بكم في الدردشة ★',
    image TEXT DEFAULT '',
    type TEXT DEFAULT 'default',           -- default | voice
    max_users INTEGER DEFAULT 1000,
    status TEXT DEFAULT 'open',            -- open | closed
    sound INTEGER DEFAULT 0,
    video INTEGER DEFAULT 0,
    bots INTEGER DEFAULT 0,
    gifts INTEGER DEFAULT 0,
    games INTEGER DEFAULT 0,
    locked INTEGER DEFAULT 0,
    welcome TEXT DEFAULT '',
    sort INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  // ترقية: كلمة مرور الغرفة (تُضاف للقواعد القديمة فقط)
  db.run(`ALTER TABLE rooms ADD COLUMN password TEXT DEFAULT ''`, () => { });

  // ---------- روبوتات المستخدمين الافتراضيون داخل الغرف ----------
  db.run(`CREATE TABLE IF NOT EXISTS room_bots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    room_id INTEGER NOT NULL,
    active INTEGER DEFAULT 1,
    reply_enabled INTEGER DEFAULT 0,
    reply_text TEXT DEFAULT 'نعم؟',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  db.run(`ALTER TABLE room_bots ADD COLUMN reply_enabled INTEGER DEFAULT 0`, () => { });
  db.run(`ALTER TABLE room_bots ADD COLUMN reply_text TEXT DEFAULT 'نعم؟'`, () => { });
  db.run(`CREATE INDEX IF NOT EXISTS idx_room_bots_room ON room_bots (room_id, active)`);

  // ---------- مشرفو الغرف المستقلون (أدمن لكل غرفة) ----------
  db.run(`CREATE TABLE IF NOT EXISTS room_admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(room_id, user_id)
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_room_admins_lookup ON room_admins (room_id, user_id)`);

  // ---------- رسائل الروبوت المجدولة ----------
  db.run(`CREATE TABLE IF NOT EXISTS bots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER DEFAULT 0,            -- 0 = كل الغرف المفتوحة
    text TEXT NOT NULL,
    color TEXT DEFAULT '#d946a6',
    size INTEGER DEFAULT 16,
    interval_min INTEGER DEFAULT 5,
    active INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  // ---------- رسائل الغرف ----------
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    user_id INTEGER,
    username TEXT NOT NULL,
    text TEXT NOT NULL,
    type TEXT DEFAULT 'msg',               -- msg | system | gift | join | leave
    extra TEXT DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  // ---------- الرسائل الخاصة ----------
  db.run(`CREATE TABLE IF NOT EXISTS private_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id INTEGER NOT NULL,
    to_id INTEGER NOT NULL,
    from_name TEXT NOT NULL,
    text TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  // ---------- قائمة التجاهل بين المستخدمين ----------
  db.run(`CREATE TABLE IF NOT EXISTS user_ignores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    ignored_id INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(user_id, ignored_id)
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_user_ignores_pair ON user_ignores (user_id, ignored_id)`);

  // ---------- حالات المستخدمين (تختفي بعد 24 ساعة) ----------
  db.run(`CREATE TABLE IF NOT EXISTS statuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    image TEXT NOT NULL,
    media_type TEXT DEFAULT 'image',       -- image | video | audio | text
    media TEXT DEFAULT '',                 -- مسار ملف الصورة/الفيديو/الصوت
    text_content TEXT DEFAULT '',          -- محتوى الحالة الكتابية
    background TEXT DEFAULT '#1f6f5f',
    caption TEXT DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s','now')),
    expires_at INTEGER NOT NULL
  )`);
  // ترقية قواعد البيانات السابقة دون حذف الحالات الموجودة.
  db.run(`ALTER TABLE statuses ADD COLUMN media_type TEXT DEFAULT 'image'`, () => { });
  db.run(`ALTER TABLE statuses ADD COLUMN media TEXT DEFAULT ''`, () => { });
  db.run(`ALTER TABLE statuses ADD COLUMN text_content TEXT DEFAULT ''`, () => { });
  db.run(`ALTER TABLE statuses ADD COLUMN background TEXT DEFAULT '#1f6f5f'`, () => { });
  db.run(`CREATE INDEX IF NOT EXISTS idx_statuses_active ON statuses (expires_at, created_at)`);

  // مشاهدات الحالة — لا تُعرض أسماؤها إلا لصاحب الحالة عبر API محمي
  db.run(`CREATE TABLE IF NOT EXISTS status_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status_id INTEGER NOT NULL,
    viewer_id INTEGER NOT NULL,
    viewed_at INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(status_id, viewer_id)
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_status_views_status ON status_views (status_id, viewed_at)`);

  // ---------- الهدايا ----------
  db.run(`CREATE TABLE IF NOT EXISTS gifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    img TEXT DEFAULT '',                 -- مسار صورة مرفوعة أو إيموجي
    audio TEXT DEFAULT '',               -- ملف صوت الهدية
    price INTEGER DEFAULT 1,             -- قيمة الهدية (تُخصم من المُرسِل)
    payout INTEGER DEFAULT 0,            -- ربح المستقبِل من الهدية (ذهب)
    cat TEXT DEFAULT 'افتراضي',
    active INTEGER DEFAULT 1
  )`);
  db.run(`ALTER TABLE gifts ADD COLUMN audio TEXT DEFAULT ''`, () => { });
  db.run(`CREATE TABLE IF NOT EXISTS custom_emojis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    img TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS gifts_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id INTEGER,
    from_name TEXT,
    to_id INTEGER,
    to_name TEXT,
    gift_name TEXT,
    gift_img TEXT,
    gift_audio TEXT DEFAULT '',
    price INTEGER DEFAULT 0,
    qty INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  db.run(`ALTER TABLE gifts_log ADD COLUMN gift_audio TEXT DEFAULT ''`, () => { });

  // ---------- طلبات التوثيق والترقية ----------
  db.run(`CREATE TABLE IF NOT EXISTS service_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    target_name TEXT NOT NULL,
    request_type TEXT NOT NULL,            -- verify | upgrade
    plan TEXT DEFAULT '',                  -- vip | premium | plus
    months INTEGER DEFAULT 1,
    suggested_gold INTEGER DEFAULT 0,
    approved_gold INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',         -- pending | approved | rejected
    admin_id INTEGER DEFAULT 0,
    admin_name TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s','now')),
    resolved_at INTEGER DEFAULT 0
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_service_requests_status ON service_requests (status, created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_service_requests_user ON service_requests (user_id, status)`);

  // ---------- الحائط والمنشورات والتعليقات والتفاعلات ----------
  db.run(`CREATE TABLE IF NOT EXISTS wall_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    text TEXT DEFAULT '',
    youtube_url TEXT DEFAULT '',
    image TEXT DEFAULT '',
    video TEXT DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  db.run(`ALTER TABLE wall_posts ADD COLUMN image TEXT DEFAULT ''`, () => { });
  db.run(`CREATE INDEX IF NOT EXISTS idx_wall_posts_created ON wall_posts (created_at DESC)`);
  db.run(`CREATE TABLE IF NOT EXISTS wall_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_wall_comments_post ON wall_comments (post_id, id)`);
  db.run(`CREATE TABLE IF NOT EXISTS wall_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    reaction TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(post_id, user_id)
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_wall_reactions_post ON wall_reactions (post_id)`);

  // ---------- الإعدادات ----------
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  )`);

  // ---------- فلترة الكلمات ----------
  db.run(`CREATE TABLE IF NOT EXISTS banned_words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT UNIQUE NOT NULL
  )`);

  // ---------- قائمة الحظر ----------
  db.run(`CREATE TABLE IF NOT EXISTS bans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    ip TEXT DEFAULT '',
    device_id TEXT DEFAULT '',
    reason TEXT DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  db.run(`ALTER TABLE bans ADD COLUMN device_id TEXT DEFAULT ''`, () => { });
  db.run(`CREATE INDEX IF NOT EXISTS idx_bans_device_id ON bans (device_id)`);

  // ---------- كتم الزوار حسب عنوان IP ----------
  db.run(`CREATE TABLE IF NOT EXISTS ip_mutes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT UNIQUE NOT NULL,
    username TEXT DEFAULT '',
    reason TEXT DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  // ---------- المطرودون من الغرف (يبقى الطرد حتى إلغائه من لوحة الإدارة) ----------
  db.run(`CREATE TABLE IF NOT EXISTS room_kicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    user_id INTEGER DEFAULT 0,
    username TEXT DEFAULT '',
    ip TEXT DEFAULT '',
    reason TEXT DEFAULT '',
    kicked_by TEXT DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_room_kicks_room_ip ON room_kicks (room_id, ip)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_room_kicks_room_user ON room_kicks (room_id, user_id)`);

  // ---------- التوثيق ----------
  db.run(`CREATE TABLE IF NOT EXISTS verified (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    added_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  // ---------- الإشعارات ----------
  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    text TEXT NOT NULL,
    icon TEXT DEFAULT 'bell',
    kind TEXT DEFAULT 'general',
    sender_name TEXT DEFAULT '',
    image TEXT DEFAULT '',
    read INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  // ترقية قواعد البيانات السابقة لدعم قالب الإعلان داخل قائمة الإشعارات.
  db.run(`ALTER TABLE notifications ADD COLUMN kind TEXT DEFAULT 'general'`, () => { });
  db.run(`ALTER TABLE notifications ADD COLUMN sender_name TEXT DEFAULT ''`, () => { });
  db.run(`ALTER TABLE notifications ADD COLUMN image TEXT DEFAULT ''`, () => { });
  db.run(`CREATE TABLE IF NOT EXISTS notification_reads (
    notification_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    read_at INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY(notification_id, user_id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS notification_hides (
    notification_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    hidden_at INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY(notification_id, user_id)
  )`);

  // ---------- الشكاوى ----------
  db.run(`CREATE TABLE IF NOT EXISTS complaints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    subject TEXT,
    message TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  // ---------- تسجيلات المكالمات الخاصة ----------
  db.run(`CREATE TABLE IF NOT EXISTS call_recordings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caller_id INTEGER NOT NULL,
    caller_name TEXT NOT NULL,
    callee_id INTEGER NOT NULL,
    callee_name TEXT NOT NULL,
    audio_path TEXT NOT NULL,
    filename TEXT NOT NULL,
    duration INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  // ---------- صفحات الأرشفة ومحركات البحث (SEO) ----------
  db.run(`CREATE TABLE IF NOT EXISTS seo_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    keywords TEXT DEFAULT '',
    logo_image TEXT DEFAULT '',
    site_name TEXT DEFAULT '',
    favicon TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  db.run(`ALTER TABLE seo_pages ADD COLUMN favicon TEXT DEFAULT ''`, () => { });

  // ---------- باقات شحن الذهب ----------
  db.run(`CREATE TABLE IF NOT EXISTS gold_packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    gold INTEGER NOT NULL,
    price REAL NOT NULL,
    currency TEXT DEFAULT '$',
    bonus INTEGER DEFAULT 0,
    badge TEXT DEFAULT '',
    sort INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  // ---------- سجل المعاملات والمدفوعات بالبطاقات ----------
  db.run(`CREATE TABLE IF NOT EXISTS payment_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    package_id INTEGER,
    package_name TEXT,
    gold_amount INTEGER NOT NULL,
    bonus_amount INTEGER DEFAULT 0,
    total_gold INTEGER NOT NULL,
    amount_paid REAL NOT NULL,
    currency TEXT DEFAULT '$',
    card_last4 TEXT DEFAULT '',
    card_brand TEXT DEFAULT '',
    card_holder TEXT DEFAULT '',
    deposit_card TEXT DEFAULT '',
    status TEXT DEFAULT 'completed',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  // ---------- الرمزيات والصور المصنفة ----------
  db.run(`CREATE TABLE IF NOT EXISTS avatars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT DEFAULT 'def',           -- def | nature | other
    path TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  // ---------- صور المستخدمين المرفوعة (حد أقصى 10 صور لكل مستخدم) ----------
  db.run(`CREATE TABLE IF NOT EXISTS user_avatars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    path TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
});

// ====== الإعدادات الافتراضية ======
const defaultSettings = {
  vip_cost: '30',
  premium_cost: '20',
  plus_cost: '10',
  register_gold: '10',
  call_cost: '2',
  show_smiles: '1',
  show_voice: '1',
  show_image: '1',
  hidden_super: '1',
  wall_allowed_memberships: 'guest,registered,mmez,plus,premium,vip',
  status_allowed_memberships: 'registered,mmez,plus,premium,vip',
  voice_allowed_memberships: 'mmez,plus,premium,vip',
  broadcast_allowed_memberships: 'mmez,plus,premium,vip',
  public_message_allowed_memberships: 'guest,registered,mmez,plus,premium,vip',
  private_message_allowed_memberships: 'guest,registered,mmez,plus,premium,vip',
  private_call_allowed_memberships: 'mmez,plus,premium,vip',
  public_image_allowed_memberships: 'guest,registered,mmez,plus,premium,vip',
  snd_join: '1',
  snd_msg: '0',
  snd_leave: '1',
  logo_url: '',
  favicon_url: '',
  skin: 'default',
  font_size: '14',
  site_name: 'الدردشة العربية',
  supervisors_mode: '1',
  allow_register: '1',
  show_time: '1',
  enable_mute: '1',
  enable_silent_mute: '1',
  msg_review: '0',
  enable_bots: '1',
  public_msgs_link: '',
  msg_max: '500',
  // عدد الثواني الإلزامي بين رسالتين عامتين من الشخص نفسه (0 = تعطيل).
  public_message_cooldown_seconds: '3',
  // مظهر رسائل العام: المسافة، حجم اسم المرسل، وعرض جسم الرسالة.
  public_message_spacing_px: '4',
  public_message_name_size_px: '14',
  public_message_body_width: 'fit',
  // أحجام شارات الرتب والعضويات داخل الرسالة العامة (لكل شارة بشكل مستقل).
  msg_badge_superadmin_size: '24',
  msg_badge_admin_size: '24',
  msg_badge_roomadmin_size: '24',
  msg_badge_mmez_size: '24',
  msg_badge_vip_size: '24',
  msg_badge_premium_size: '24',
  msg_badge_plus_size: '24',
  msg_badge_register_size: '24',
  msg_badge_guest_size: '24',
  msg_badge_hidden_admin_size: '28',
  seo_title: 'شات عربي | دردشة صوتية وكتابية مجانية بدون تسجيل',
  seo_description: 'أفضل موقع شات عربي للتواصل الصوتي والكتابي المباشر مجاناً بدون تسجيل. غرف محادثة متميزة وآمنة على مدار الساعة.',
  seo_keywords: 'شات, دردشة, شات عربي, دردشة صوتية, شات صوتي, دردشة كتابية, تعارف, شات مجاني, غرف دردشة',
  seo_image: '/img/announcement.png',
  merchant_bank_name: 'البنك التجاري المعتمد',
  merchant_card_number: '4263 8890 1234 5678',
  merchant_holder_name: 'إدارة الدردشة المعتمدة',
  merchant_iban: 'JO94 ARAB 1234 5678 9012 3456',
  card_payment_enabled: '1',
  card_currency: '$',
  default_language: 'ar',
  admin_language: 'ar',
  ai_provider: 'gemini',
  ai_api_key: '',
  ai_model: 'gemini-1.5-flash',
  ai_custom_endpoint: '',
  ai_system_prompt: 'أنت مساعد ذكي ومرح وودود في دردشة عربية. أجب باختصار شديد وبشكل واقعي ومفيد وممتع (في حدود 15-25 كلمة)، وخاطب المستخدم باسمه.'
};
const st = db.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)`);
Object.entries(defaultSettings).forEach(([k, v]) => st.run(k, v));
st.finalize();

// ====== إضافة باقات الذهب الافتراضية ======
db.get(`SELECT COUNT(*) c FROM gold_packages`, (err, row) => {
  if (row && row.c === 0) {
    const pIns = db.prepare(`INSERT INTO gold_packages (name, gold, price, currency, bonus, badge, sort, active) VALUES (?,?,?,?,?,?,?,?)`);
    pIns.run('باقة التجربة', 10, 1.99, '$', 0, '', 1, 1);
    pIns.run('الباقة البرونزية', 50, 4.99, '$', 5, '', 2, 1);
    pIns.run('الباقة الفضية', 100, 9.99, '$', 15, '🔥 الأكثر طلباً', 3, 1);
    pIns.run('الباقة الذهبية', 250, 24.99, '$', 50, '⭐ باقة التوفير', 4, 1);
    pIns.run('الباقة الماسية', 500, 49.99, '$', 150, '💎 باقة مميزة', 5, 1);
    pIns.run('باقة VIP الملكية', 1000, 89.99, '$', 400, '👑 باقة كبار الشخصيات', 6, 1);
    pIns.finalize();
  }
});

// ====== إضافة الرمزيات الافتراضية ======
db.get(`SELECT COUNT(*) c FROM avatars`, (err, row) => {
  if (row && row.c === 0) {
    const aIns = db.prepare(`INSERT INTO avatars (category, path) VALUES (?,?)`);
    for (let i = 1; i <= 20; i++) {
      aIns.run('def', `/avatars/def/${String(i).padStart(2, '0')}.jpg`);
    }
    for (let i = 1; i <= 16; i++) {
      aIns.run('nature', `/avatars/nature/${String(i).padStart(2, '0')}.jpg`);
    }
    for (let i = 1; i <= 16; i++) {
      aIns.run('other', `/avatars/other/${String(i).padStart(2, '0')}.jpg`);
    }
    aIns.finalize();
  }
});

// ====== المستخدمون الافتراضيون ======
const userCount = db.get(`SELECT COUNT(*) c FROM users`, (err, row) => {
  if (row && row.c === 0) {
    const ins = db.prepare(`INSERT INTO users (username,password,email,gender,age,country,balance,membership,rank,registered,avatar)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const pw = bcrypt.hashSync('123456', 10);
    ins.run('supermaster', pw, 'master@nujum.com', 'boy', 30, 'jo', 999999, 'vip', 'supermaster', 1, '/avatars/def/01.jpg');
    ins.run('ax', pw, 'admin@nujum.com', 'boy', 30, 'jo', 9999, 'vip', 'superadmin', 1, '/avatars/def/01.jpg');
    ins.run('admin', bcrypt.hashSync('admin123', 10), 'admin@nujum.com', 'boy', 28, 'jo', 500, 'premium', 'admin', 1, '/avatars/def/03.jpg');
    ins.run('محمد الاردن', bcrypt.hashSync('123456', 10), '', 'boy', 25, 'jo', 120, 'vip', 'user', 1, '/avatars/def/02.jpg');
    ins.run('الحب اهتمام', bcrypt.hashSync('123456', 10), '', 'girl', 22, 'sa', 60, 'premium', 'user', 1, '/avatars/def/04.jpg');
    ins.run('باسم', bcrypt.hashSync('123456', 10), '', 'boy', 27, 'eg', 35, 'plus', 'roomadmin', 1, '/avatars/def/09.jpg');
    ins.finalize();
    console.log('✓ تم إنشاء المستخدمين الافتراضيين (supermaster / ax / 123456)');
  } else {
    // التأكد من وجود حساب supermaster في القواعد المنشأة مسبقاً
    db.get(`SELECT id FROM users WHERE username='supermaster'`, (err2, masterRow) => {
      if (!masterRow) {
        const pw = bcrypt.hashSync('123456', 10);
        db.run(`INSERT INTO users (username,password,email,gender,age,country,balance,membership,rank,registered,avatar)
          VALUES ('supermaster',?,'master@nujum.com','boy',30,'jo',999999,'vip','supermaster',1,'/avatars/def/01.jpg')`, pw);
        console.log('✓ تم إنشاء حساب مالك الدردشة (supermaster/123456)');
      }
    });
  }
});

// ====== الغرف الافتراضية ======
db.get(`SELECT COUNT(*) c FROM rooms`, (err, row) => {
  if (row && row.c === 0) {
    const ins = db.prepare(`INSERT INTO rooms (name,description,image,type,max_users,sound,video,gifts,games,sort) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const rooms = [
      ['خيمة دردشي', 'غرفة دردشي الرئيسية', '/rooms/tent.jpg', 'default', 1000, 1, 1, 1, 0, 1],
      ['فلسطين', 'غرفة مستخدمين فلسطين', '', 'default', 1000, 1, 1, 1, 0, 2],
      ['العراق', 'غرفة مستخدمين العراق', '', 'default', 1000, 1, 1, 1, 0, 3],
      ['الاردن 1', 'غرفة مستخدمين الاردن', '', 'default', 1000, 1, 1, 1, 0, 4],
      ['الاردن 2', 'غرفة مستخدمين الاردن', '', 'default', 1000, 1, 1, 1, 0, 5],
      ['السعودية', 'غرفة مستخدمين السعودية', '', 'default', 1000, 0, 1, 1, 0, 6],
      ['مصر 1', 'غرفة مستخدمين مصر', '', 'default', 500, 1, 1, 1, 0, 7],
      ['غرفة صوتية 1', 'غرفة الدردشة الصوتية ★', '', 'voice', 500, 1, 1, 0, 0, 8],
      ['غرفة صوتية 2', 'غرفة الدردشة الصوتية ★', '', 'voice', 500, 1, 1, 0, 0, 9]
    ];
    rooms.forEach(r => ins.run(...r));
    ins.finalize();
    console.log('✓ تم إنشاء الغرف الافتراضية');
  }
});

// ====== الحسابات الموثقة الافتراضية ======
db.get(`SELECT COUNT(*) c FROM verified`, (err, row) => {
  if (row && row.c === 0) {
    const ins = db.prepare(`INSERT OR IGNORE INTO verified (username) VALUES (?)`);
    ['ax', 'محمد الاردن'].forEach(n => ins.run(n));
    ins.finalize();
  }
});

// ====== كلمات الفلترة الافتراضية ======
db.get(`SELECT COUNT(*) c FROM banned_words`, (err, row) => {
  if (row && row.c === 0) {
    const ins = db.prepare(`INSERT INTO banned_words (word) VALUES (?)`);
    ['كلمة1', 'كلمة2'].forEach(w => ins.run(w));
    ins.finalize();
  }
});

module.exports = db;
