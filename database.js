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
    rank TEXT DEFAULT 'user',              -- user | roomadmin | admin | superadmin
    registered INTEGER DEFAULT 0,          -- 0=ضيف 1=مسجل
    avatar TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    status TEXT DEFAULT 'online',          -- online | busy | away
    banned INTEGER DEFAULT 0,
    muted INTEGER DEFAULT 0,
    ip TEXT DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  // ---------- الغرف ----------
  db.run(`CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT 'اهلا وسهلا بكم في شات نجوم العرب ★',
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

  // ---------- الهدايا ----------
  db.run(`CREATE TABLE IF NOT EXISTS gifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    img TEXT DEFAULT '',                 -- مسار صورة مرفوعة أو إيموجي
    price INTEGER DEFAULT 1,             -- قيمة الهدية (تُخصم من المُرسِل)
    payout INTEGER DEFAULT 0,            -- ربح المستقبِل من الهدية (ذهب)
    cat TEXT DEFAULT 'افتراضي',
    active INTEGER DEFAULT 1
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS stickers (
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
    price INTEGER DEFAULT 0,
    qty INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

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
    reason TEXT DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

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
    read INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
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
});

// ====== الإعدادات الافتراضية ======
const defaultSettings = {
  vip_cost: '30',
  premium_cost: '20',
  plus_cost: '10',
  show_smiles: '1',
  show_voice: '1',
  show_image: '1',
  hidden_super: '1',
  snd_join: '1',
  snd_msg: '0',
  snd_leave: '1',
  logo_url: '',
  skin: 'default',
  font_size: '14',
  site_name: 'نجوم العرب',
  supervisors_mode: '1',
  allow_register: '1',
  show_time: '1',
  enable_mute: '1',
  enable_silent_mute: '1',
  msg_review: '0',
  enable_bots: '1',
  public_msgs_link: '',
  msg_max: '500'
};
const st = db.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)`);
Object.entries(defaultSettings).forEach(([k, v]) => st.run(k, v));
st.finalize();

// ====== المستخدمون الافتراضيون ======
const userCount = db.get(`SELECT COUNT(*) c FROM users`, (err, row) => {
  if (row && row.c === 0) {
    const ins = db.prepare(`INSERT INTO users (username,password,email,gender,age,country,balance,membership,rank,registered,avatar)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const pw = bcrypt.hashSync('123456', 10);
    ins.run('ax', pw, 'admin@nujum.com', 'boy', 30, 'jo', 9999, 'vip', 'superadmin', 1, '/avatars/def/01.jpg');
    ins.run('admin', bcrypt.hashSync('admin123', 10), 'admin@nujum.com', 'boy', 28, 'jo', 500, 'premium', 'admin', 1, '/avatars/def/03.jpg');
    ins.run('محمد الاردن', bcrypt.hashSync('123456', 10), '', 'boy', 25, 'jo', 120, 'vip', 'user', 1, '/avatars/def/02.jpg');
    ins.run('الحب اهتمام', bcrypt.hashSync('123456', 10), '', 'girl', 22, 'sa', 60, 'premium', 'user', 1, '/avatars/def/04.jpg');
    ins.run('باسم', bcrypt.hashSync('123456', 10), '', 'boy', 27, 'eg', 35, 'plus', 'roomadmin', 1, '/avatars/def/09.jpg');
    ins.finalize();
    console.log('✓ تم إنشاء المستخدمين الافتراضيين (ax/123456)');
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
