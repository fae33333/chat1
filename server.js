// =====================================================
//  سيرفر شات نجوم العرب - Node.js + SQLite3 + Socket.IO
// =====================================================
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const multer = require('multer');
const { Server } = require('socket.io');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const sessionMw = session({
  secret: 'nujum-chat-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 }
});
app.use(sessionMw);
io.use((socket, next) => sessionMw(socket.request, {}, next));

// ---------- رفع الملفات ----------
fs.mkdirSync(path.join(__dirname, 'public/uploads'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public/uploads/gifts'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public/uploads/stickers'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public/uploads/rooms'), { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public/uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });
// رفع الهدايا/الملصقات من لوحة الإدارة (مجلدات فرعية)
const storageMedia = multer.diskStorage({
  destination: (req, file, cb) => {
    const sub = req.path.includes('sticker') ? 'stickers' : (req.path.includes('room') ? 'rooms' : 'gifts');
    cb(null, path.join(__dirname, 'public/uploads', sub));
  },
  filename: (req, file, cb) => cb(null, Date.now() + '_' + Math.random().toString(36).slice(2, 8) + path.extname(file.originalname).toLowerCase())
});
const uploadMedia = multer({ storage: storageMedia, limits: { fileSize: 8 * 1024 * 1024 } });

// ====== أدوات مساعدة ======
const q = {
  get: (sql, ...p) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r))),
  all: (sql, ...p) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r))),
  run: (sql, ...p) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }))
};

async function getSettings() {
  const rows = await q.all(`SELECT key,value FROM settings`);
  const s = {};
  rows.forEach(r => s[r.key] = r.value);
  return s;
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
function pubUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, gender: u.gender, age: u.age, country: u.country,
    balance: u.balance, membership: u.membership, rank: u.rank, registered: u.registered,
    avatar: u.avatar, status: u.status, email: u.email || '', bio: u.bio || '',
    muted: u.muted ? 1 : 0,
    verified: VERIFIED_SET.has(u.username) ? 1 : 0
  };
}
function requireUser(req, res, next) {
  if (!req.session.uid) return res.status(401).json({ error: 'غير مسجل' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.uid || !['admin', 'superadmin'].includes(req.session.rank))
    return res.status(403).json({ error: 'ممنوع' });
  next();
}
function requireSuper(req, res, next) {
  if (!req.session.uid || req.session.rank !== 'superadmin')
    return res.status(403).json({ error: 'ممنوع - سوبر ادمين فقط' });
  next();
}

// أيقونة الشارة حسب الرتبة/العضوية
function badgeOf(u) {
  const rankBadges = { superadmin: 'superadmin.png', admin: 'admin.png', roomadmin: 'roomadmin.png' };
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
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const u = await q.get(`SELECT * FROM users WHERE username=?`, username);
  if (!u || !u.password || !bcrypt.compareSync(password, u.password))
    return res.status(400).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  if (u.banned) return res.status(403).json({ error: 'هذا الحساب محظور' });
  req.session.uid = u.id;
  req.session.rank = u.rank;
  res.json({ user: pubUser(u), badge: badgeOf(u) });
});

app.post('/api/guest', async (req, res) => {
  let { username, gender } = req.body;
  username = (username || '').trim().slice(0, 20);
  if (!username) return res.status(400).json({ error: 'اكتب اسم المستخدم' });
  let u = await q.get(`SELECT * FROM users WHERE username=?`, username);
  if (u && u.registered) return res.status(400).json({ error: 'هذا الاسم مسجل، قم بتسجيل الدخول' });
  if (!u) {
    const r = await q.run(`INSERT INTO users (username,gender,registered,membership,rank) VALUES (?,?,0,'none','user')`, username, gender || 'secret');
    u = await q.get(`SELECT * FROM users WHERE id=?`, r.lastID);
  }
  req.session.uid = u.id;
  req.session.rank = u.rank;
  res.json({ user: pubUser(u), badge: badgeOf(u) });
});

app.post('/api/register', async (req, res) => {
  const { username, password, gender, age, country } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'أكمل الحقول المطلوبة' });
  const ex = await q.get(`SELECT id FROM users WHERE username=?`, username);
  if (ex) {
    // ضيف يحوّل حسابه لمسجل
    const old = await q.get(`SELECT * FROM users WHERE username=?`, username);
    if (old.registered) return res.status(400).json({ error: 'الاسم مستخدم مسبقا' });
    await q.run(`UPDATE users SET password=?,gender=?,age=?,country=?,registered=1 WHERE id=?`,
      bcrypt.hashSync(password, 10), gender || 'secret', age || 25, country || '', old.id);
    req.session.uid = old.id; req.session.rank = old.rank;
    await refreshUserEverywhere(old.id);   // تحديث الاسم/الصورة مباشرة لمن بداخل الغرف
    io.emit('sync');
    return res.json({ user: pubUser(await q.get(`SELECT * FROM users WHERE id=?`, old.id)), badge: badgeOf(old) });
  }
  const r = await q.run(`INSERT INTO users (username,password,gender,age,country,registered,balance) VALUES (?,?,?,?,?,1,10)`,
    username, bcrypt.hashSync(password, 10), gender || 'secret', age || 25, country || '');
  const u = await q.get(`SELECT * FROM users WHERE id=?`, r.lastID);
  req.session.uid = u.id; req.session.rank = u.rank;
  io.emit('sync');
  res.json({ user: pubUser(u), badge: badgeOf(u) });
});

app.get('/api/me', async (req, res) => {
  if (!req.session.uid) return res.json({ user: null });
  const u = await q.get(`SELECT * FROM users WHERE id=?`, req.session.uid);
  if (!u) return res.json({ user: null });
  req.session.rank = u.rank;
  res.json({ user: pubUser(u), badge: badgeOf(u) });
});

app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

// =====================================================
//  API - الشات (غرف، مستخدمون، هدايا، ترقية...)
// =====================================================
app.get('/api/rooms', async (req, res) => {
  const rooms = await q.all(`SELECT * FROM rooms ORDER BY sort,id`);
  const counts = {};
  Object.entries(roomUsers).forEach(([rid, set]) => counts[rid] = set.size);
  // لا نرسل كلمة المرور أبداً للزوار — فقط علامة locked
  res.json(rooms.map(r => ({ ...r, online: counts[r.id] || 0, locked: r.password ? 1 : 0, password: undefined })));
});

app.get('/api/rooms/:id', async (req, res) => {
  const room = await q.get(`SELECT * FROM rooms WHERE id=?`, req.params.id);
  if (!room) return res.status(404).json({ error: 'الغرفة غير موجودة' });
  res.json({ ...room, locked: room.password ? 1 : 0, password: undefined });
});

app.get('/api/rooms/:id/messages', requireUser, async (req, res) => {
  const msgs = await q.all(`SELECT * FROM messages WHERE room_id=? ORDER BY id DESC LIMIT 60`, req.params.id);
  res.json(msgs.reverse());
});

app.get('/api/rooms/:id/users', requireUser, async (req, res) => {
  const set = roomUsers[req.params.id];
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

// الرسائل الخاصة
app.get('/api/private', requireUser, async (req, res) => {
  const uid = req.session.uid;
  const rows = await q.all(`
    SELECT p.*, u.username other_name, u.avatar other_avatar, u.gender other_gender, u.membership other_mem, u.rank other_rank, u.id other_id
    FROM private_messages p JOIN users u ON (u.id = CASE WHEN p.from_id=? THEN p.to_id ELSE p.from_id END)
    WHERE p.from_id=? OR p.to_id=? ORDER BY p.id DESC`, uid, uid, uid);
  const seen = {};
  const convs = [];
  for (const r of rows) {
    const oid = r.from_id === uid ? r.to_id : r.from_id;
    if (seen[oid]) continue;
    seen[oid] = 1;
    convs.push({ id: oid, username: r.other_name, avatar: r.other_avatar, gender: r.other_gender, membership: r.other_mem, rank: r.other_rank, last: r.text, at: r.created_at });
  }
  res.json(convs);
});

app.get('/api/private/:uid', requireUser, async (req, res) => {
  const uid = req.session.uid, other = req.params.uid;
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
app.get('/api/stickers', async (req, res) => res.json(await q.all(`SELECT * FROM stickers ORDER BY id DESC`)));

app.post('/api/gifts/send', requireUser, async (req, res) => {
  const { to_id, gift_id, qty, room_id } = req.body;
  const gift = await q.get(`SELECT * FROM gifts WHERE id=? AND active=1`, +gift_id);
  if (!gift) return res.status(400).json({ error: 'هدية غير صالحة' });
  const qtyN = Math.min(99, Math.max(1, parseInt(qty) || 1));
  const amount = gift.price * qtyN;                 // يُخصم من مُرسِل الهدية
  const gain = (gift.payout || 0) * qtyN;           // يَربحه مستقبِل الهدية
  const me = await q.get(`SELECT * FROM users WHERE id=?`, req.session.uid);
  if (me.balance < amount) return res.status(400).json({ error: 'رصيدك غير كافي', need: amount });
  const to = await q.get(`SELECT * FROM users WHERE id=?`, to_id);
  if (!to) return res.status(404).json({ error: 'المستخدم غير موجود' });
  await q.run(`UPDATE users SET balance=balance-? WHERE id=?`, amount, me.id);
  await q.run(`UPDATE users SET balance=balance+? WHERE id=?`, gain, to.id);
  await q.run(`INSERT INTO gifts_log (from_id,from_name,to_id,to_name,gift_name,gift_img,price,qty) VALUES (?,?,?,?,?,?,?,?)`,
    me.id, me.username, to.id, to.username, gift.name, gift.img, gift.price, qtyN);
  // بث رسالة الهدية داخل الغرفة
  const gExtra = JSON.stringify({ img: gift.img, name: gift.name, qty: qtyN, to: to.username, from: me.username });
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
  io.to('user_' + to_id).emit('notify', { icon: 'gift_fill', text: `وصلتك هدية ${vis}${gift.name} من ${me.username} وربحت ${gain} ذهب 🪙`, balance: toFresh.balance });
  await q.run(`INSERT INTO notifications (user_id,text,icon) VALUES (?,?,?)`, to_id, `وصلتك هدية ${vis}${gift.name} من ${me.username} وربحت ${gain} ذهب`, 'gift_fill');
  res.json({ ok: true, balance: me.balance - amount });
});

// ترقية العضوية بالرصيد
app.post('/api/upgrade', requireUser, async (req, res) => {
  const { target_id, plan, months } = req.body;
  const s = await getSettings();
  const costs = { vip: +s.vip_cost, premium: +s.premium_cost, plus: +s.plus_cost };
  if (!costs[plan]) return res.status(400).json({ error: 'خطة غير صالحة' });
  const total = costs[plan] * (months || 1);
  const me = await q.get(`SELECT * FROM users WHERE id=?`, req.session.uid);
  if (me.balance < total) return res.status(400).json({ error: 'رصيدك غير كافي' });
  const target = await q.get(`SELECT * FROM users WHERE id=?`, target_id || me.id);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  await q.run(`UPDATE users SET balance=balance-? WHERE id=?`, total, me.id);
  await q.run(`UPDATE users SET membership=?, membership_expires=? WHERE id=?`,
    plan, Date.now() + (months || 1) * 30 * 86400000, target.id);
  // إشعار للمُرقَّى
  io.to('user_' + target.id).emit('notify', { icon: 'crown_fill', text: `👑 تمت ترقية عضويتك إلى ${plan.toUpperCase()} لمدة ${months || 1} شهر` });
  io.to('user_' + target.id).emit('membership_changed', { plan });
  await q.run(`INSERT INTO notifications (user_id,text,icon) VALUES (?,?,?)`, target.id, `تمت ترقيتك إلى عضوية ${plan.toUpperCase()} 👑`, 'crown_fill');
  res.json({ ok: true, balance: me.balance - total, membership: plan });
});

// تغيير الحالة / الصورة
app.post('/api/status', requireUser, async (req, res) => {
  const { status } = req.body;
  if (!['online', 'busy', 'away'].includes(status)) return res.status(400).json({ error: 'حالة غير صالحة' });
  await q.run(`UPDATE users SET status=? WHERE id=?`, status, req.session.uid);
  res.json({ ok: true });
});

app.post('/api/avatar', requireUser, (req, res) => {
  upload.single('avatar')(req, res, async (err) => {
    if (err) return res.status(500).json({ error: 'تعذر رفع الصورة: ' + err.message });
    try {
      let avatar = (req.body && req.body.avatar) || '';
      if (req.file) avatar = '/uploads/' + req.file.filename;
      if (!avatar) return res.status(400).json({ error: 'لا توجد صورة' });
      if (avatar && !/^[\/a-zA-Z0-9_\-.]+$/.test(avatar)) return res.status(400).json({ error: 'رابط غير صالح' });
      await q.run(`UPDATE users SET avatar=? WHERE id=?`, avatar, req.session.uid);
      refreshUserEverywhere(req.session.uid);
      res.json({ ok: true, avatar });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

// الإشعارات
app.get('/api/notifications', requireUser, async (req, res) => {
  res.json(await q.all(`SELECT * FROM notifications WHERE user_id=? OR user_id IS NULL ORDER BY id DESC LIMIT 60`, req.session.uid));
});

// تعديل الملف الشخصي (النوع/العمر/الدولة/البريد)
app.post('/api/profile', requireUser, async (req, res) => {
  const { gender, age, country, email, bio } = req.body;
  const g = ['boy', 'girl', 'secret'].includes(gender) ? gender : 'secret';
  const a = Math.min(99, Math.max(10, parseInt(age) || 25));
  await q.run(`UPDATE users SET gender=?, age=?, country=?, email=?, bio=? WHERE id=?`,
    g, a, String(country || '').slice(0, 40), String(email || '').slice(0, 80), String(bio === undefined ? '' : bio).slice(0, 300), req.session.uid);
  refreshUserEverywhere(req.session.uid);
  res.json({ ok: true });
});
// إعادة بث بيانات العضو للغرف المتواجد فيها (صورة/جنس/عضوية جديدة)
async function refreshUserEverywhere(uid) {
  const fresh = await q.get('SELECT * FROM users WHERE id=?', uid);
  if (fresh && onlineUsers[uid]) onlineUsers[uid] = { ...pubUser(fresh), badge: badgeOf(fresh) };   // تحديث لقطة المتصل
  Object.keys(roomUsers).forEach(rid => { if (roomUsers[rid].has(uid)) emitRoomUsers(rid); });
}

// طلب توثيق الحساب (10 ذهب افتراضي)
app.post('/api/verify-request', requireUser, async (req, res) => {
  const me = await q.get(`SELECT * FROM users WHERE id=?`, req.session.uid);
  if (!me || !me.registered) return res.status(403).json({ error: 'يتطلب عضوية مسجلة' });
  if (VERIFIED_SET.has(me.username)) return res.status(400).json({ error: 'حسابك موثق بالفعل ✓' });
  if (me.balance < 10) return res.status(400).json({ error: 'رصيدك غير كافي - تحتاج الى 10 ذهب' });
  const dup = await q.get(`SELECT id FROM complaints WHERE user_id=? AND subject=?`, me.id, 'طلب توثيق حساب');
  if (dup) return res.status(400).json({ error: 'لديك طلب توثيق قيد المراجعة بالفعل' });
  await q.run(`UPDATE users SET balance=balance-10 WHERE id=?`, me.id);
  await q.run(`INSERT INTO complaints (user_id,username,subject,message) VALUES (?,?,?,?)`,
    me.id, me.username, 'طلب توثيق حساب', `طلب توثيق الحساب ${me.username} (تم خصم 10 ذهب)`);
  res.json({ ok: true, balance: me.balance - 10 });
});

// شراء الذهب الافتراضي (دفع تجريبي)
app.post('/api/buy-gold', requireUser, async (req, res) => {
  const me = await q.get(`SELECT * FROM users WHERE id=?`, req.session.uid);
  if (!me || !me.registered) return res.status(403).json({ error: 'يتطلب عضوية مسجلة' });
  const gold = Math.min(10000, Math.max(0, parseInt(req.body.gold) || 0));
  if (!gold) return res.status(400).json({ error: 'كمية غير صالحة' });
  await q.run(`UPDATE users SET balance=balance+? WHERE id=?`, gold, me.id);
  await q.run(`INSERT INTO notifications (user_id,text,icon) VALUES (?,?,?)`, me.id, `تمت إضافة ${gold} ذهب افتراضي الى رصيدك`, 'creditcard_fill');
  res.json({ ok: true, balance: me.balance + gold });
});

// الشكاوى
app.post('/api/complaint', requireUser, async (req, res) => {
  const { subject, message } = req.body;
  const u = await q.get(`SELECT username FROM users WHERE id=?`, req.session.uid);
  await q.run(`INSERT INTO complaints (user_id,username,subject,message) VALUES (?,?,?,?)`,
    req.session.uid, u.username, subject || '', message || '');
  res.json({ ok: true });
});

// =====================================================
//  API - لوحة التحكم
// =====================================================
app.get('/api/admin/settings', requireAdmin, async (req, res) => res.json(await getSettings()));

app.post('/api/admin/settings', requireAdmin, async (req, res) => {
  const entries = Object.entries(req.body);
  for (const [k, v] of entries) await q.run(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, String(v));
  reloadBots();      // قد يكون تبديل «تفعيل الروبوت» تغيّر
  io.emit('sync');   // تطبيق فوري على صفحات الدردشة
  res.json({ ok: true });
});

// ---- إدارة الهدايا (رفع صورة + قيمة + ربح المستقبل) ----
app.get('/api/admin/gifts', requireAdmin, async (req, res) => res.json(await q.all(`SELECT * FROM gifts ORDER BY id DESC`)));
app.post('/api/admin/gifts', requireAdmin, async (req, res) => {
  const { id, name, img, price, payout, cat } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'اكتب اسم الهدية' });
  if (!img) return res.status(400).json({ error: 'ارفع صورة الهدية أولاً' });
  const n = String(name).slice(0, 40).trim(), im = String(img).slice(0, 150), ct = String(cat || 'افتراضي').slice(0, 20);
  const pr = Math.min(100000, Math.max(0, parseInt(price) || 0));
  const py = Math.min(pr, Math.max(0, parseInt(payout) || 0));
  if (id) await q.run(`UPDATE gifts SET name=?, img=?, price=?, payout=?, cat=? WHERE id=?`, n, im, pr, py, ct, +id);
  else await q.run(`INSERT INTO gifts (name,img,price,payout,cat) VALUES (?,?,?,?,?)`, n, im, pr, py, ct);
  io.emit('sync');
  res.json({ ok: true });
});
app.post('/api/admin/gifts/:id/del', requireAdmin, async (req, res) => {
  await q.run(`DELETE FROM gifts WHERE id=?`, +req.params.id);
  io.emit('sync');
  res.json({ ok: true });
});
app.post('/api/admin/upload/gift', requireAdmin, (req, res) => {
  uploadMedia.single('file')(req, res, (err) => {
    if (err || !req.file) return res.status(500).json({ error: 'تعذر الرفع: ' + (err ? err.message : 'لا يوجد ملف') });
    res.json({ ok: true, path: '/uploads/gifts/' + req.file.filename });
  });
});

// ---- رفع الملصقات ----
app.get('/api/admin/stickers', requireAdmin, async (req, res) => res.json(await q.all(`SELECT * FROM stickers ORDER BY id DESC`)));
app.post('/api/admin/stickers', requireAdmin, async (req, res) => {
  const { img } = req.body || {};
  if (!img) return res.status(400).json({ error: 'لا توجد صورة' });
  await q.run(`INSERT INTO stickers (img) VALUES (?)`, String(img).slice(0, 150));
  io.emit('sync');
  res.json({ ok: true });
});
app.post('/api/admin/stickers/:id/del', requireAdmin, async (req, res) => {
  await q.run(`DELETE FROM stickers WHERE id=?`, +req.params.id);
  io.emit('sync');
  res.json({ ok: true });
});
app.post('/api/admin/upload/sticker', requireAdmin, (req, res) => {
  uploadMedia.single('file')(req, res, (err) => {
    if (err || !req.file) return res.status(500).json({ error: 'تعذر الرفع: ' + (err ? err.message : 'لا يوجد ملف') });
    res.json({ ok: true, path: '/uploads/stickers/' + req.file.filename });
  });
});
// صورة الغرفة
app.post('/api/admin/upload/room', requireAdmin, (req, res) => {
  uploadMedia.single('file')(req, res, (err) => {
    if (err || !req.file) return res.status(500).json({ error: 'تعذر الرفع: ' + (err ? err.message : 'لا يوجد ملف') });
    res.json({ ok: true, path: '/uploads/rooms/' + req.file.filename });
  });
});

// ---- رسائل الروبوت المجدولة ----
app.get('/api/admin/bots', requireAdmin, async (req, res) => {
  const bots = await q.all(`SELECT b.*, COALESCE(r.name,'كل الغرف') room_name FROM bots b LEFT JOIN rooms r ON r.id=b.room_id ORDER BY b.id DESC`);
  res.json(bots);
});
app.post('/api/admin/bots', requireAdmin, async (req, res) => {
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
app.post('/api/admin/bots/:id/del', requireAdmin, async (req, res) => {
  await q.run(`DELETE FROM bots WHERE id=?`, +req.params.id);
  reloadBots();
  io.emit('sync');
  res.json({ ok: true });
});

// إحصائيات
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  const users = await q.get(`SELECT COUNT(*) c FROM users WHERE registered=1`);
  const guests = await q.get(`SELECT COUNT(*) c FROM users WHERE registered=0`);
  const rooms = await q.get(`SELECT COUNT(*) c FROM rooms`);
  const msgs = await q.get(`SELECT COUNT(*) c FROM messages`);
  const bans = await q.get(`SELECT COUNT(*) c FROM bans`);
  res.json({ users: users.c, guests: guests.c, rooms: rooms.c, messages: msgs.c, bans: bans.c, online: Object.keys(onlineUsers).length });
});

// ---- الغرف ----
app.get('/api/admin/rooms', requireAdmin, async (req, res) => {
  const rooms = await q.all(`SELECT * FROM rooms ORDER BY sort,id`);
  res.json(rooms);
});
app.post('/api/admin/rooms', requireAdmin, async (req, res) => {
  const r = req.body;
  if (r.id) {
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
app.delete('/api/admin/rooms/:id', requireAdmin, async (req, res) => {
  await q.run(`DELETE FROM rooms WHERE id=?`, req.params.id);
  await q.run(`DELETE FROM messages WHERE room_id=?`, req.params.id);
  io.emit('sync');
  res.json({ ok: true });
});

// ---- المستخدمون ----
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const search = req.query.q || '';
  const rows = await q.all(`SELECT * FROM users WHERE username LIKE ? ORDER BY id DESC LIMIT 200`, `%${search}%`);
  res.json(rows.map(u => ({ ...pubUser(u), banned: u.banned, muted: u.muted, badge: badgeOf(u) })));
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const r = req.body;
  if (!r.username) return res.status(400).json({ error: 'اسم المستخدم مطلوب' });
  const ex = await q.get(`SELECT id FROM users WHERE username=?`, r.username);
  if (r.id) {
    let sql = `UPDATE users SET username=?,email=?,gender=?,age=?,country=?,balance=?,membership=?,rank=?,registered=?`;
    const p = [r.username, r.email || '', r.gender || 'secret', r.age || 25, r.country || '', r.balance || 0, r.membership || 'none', r.rank || 'user', r.registered ? 1 : 1];
    if (r.password) { sql += `,password=?`; p.push(bcrypt.hashSync(r.password, 10)); }
    sql += ` WHERE id=?`; p.push(r.id);
    await q.run(sql, ...p);
    await refreshUserEverywhere(+r.id);   // تحديث مباشر داخل الغرف
    io.emit('sync');
    return res.json({ ok: true });
  }
  if (ex) return res.status(400).json({ error: 'اسم المستخدم موجود مسبقا' });
  if (!r.password) return res.status(400).json({ error: 'كلمة المرور مطلوبة' });
  const out = await q.run(`INSERT INTO users (username,password,email,gender,age,country,balance,membership,rank,registered) VALUES (?,?,?,?,?,?,?,?,?,1)`,
    r.username, bcrypt.hashSync(r.password, 10), r.email || '', r.gender || 'secret', r.age || 25, r.country || '',
    r.balance || 0, r.membership || 'none', r.rank || 'user');
  res.json({ ok: true, id: out.lastID });
});

app.delete('/api/admin/users/:id', requireSuper, async (req, res) => {
  await q.run(`DELETE FROM users WHERE id=? AND rank!='superadmin'`, req.params.id);
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/ban', requireAdmin, async (req, res) => {
  await q.run(`UPDATE users SET banned=? WHERE id=?`, req.body.banned ? 1 : 0, req.params.id);
  const u = await q.get(`SELECT username FROM users WHERE id=?`, req.params.id);
  if (req.body.banned) await q.run(`INSERT OR IGNORE INTO bans (username,reason) VALUES (?,?)`, u.username, req.body.reason || '');
  else await q.run(`DELETE FROM bans WHERE username=?`, u.username);
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/mute', requireAdmin, async (req, res) => {
  const uid = +req.params.id;
  const muted = req.body.muted ? 1 : 0;
  const target = await q.get(`SELECT id,username FROM users WHERE id=?`, uid);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (uid === +req.session.uid) return res.status(400).json({ error: 'لا يمكنك كتم نفسك' });

  await q.run(`UPDATE users SET muted=? WHERE id=?`, muted, uid);
  await refreshUserEverywhere(uid);
  io.to('user_' + uid).emit('mute_changed', { muted });
  res.json({ ok: true, muted });
});

// طرد المستخدم من الغرفة الحالية مع إبقاء حسابه واتصاله بالموقع فعالين.
app.post('/api/admin/users/:id/kick', requireAdmin, async (req, res) => {
  const uid = +req.params.id;
  const roomId = +req.body.room_id;
  if (!roomId) return res.status(400).json({ error: 'الغرفة غير محددة' });
  if (uid === +req.session.uid) return res.status(400).json({ error: 'لا يمكنك طرد نفسك' });

  const target = await q.get(`SELECT id,username FROM users WHERE id=?`, uid);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (!roomUsers[roomId] || !roomUsers[roomId].has(uid))
    return res.status(400).json({ error: 'المستخدم لم يعد موجوداً في الغرفة' });

  io.to('user_' + uid).emit('kicked', { roomId, text: 'تم طردك من الغرفة بواسطة الإدارة' });
  for (const socketId of (userSockets[uid] || [])) {
    const targetSocket = io.sockets.sockets.get(socketId);
    if (targetSocket) targetSocket.leave('room_' + roomId);
  }
  roomUsers[roomId].delete(uid);
  await emitRoomUsers(roomId);
  await emitRoomCounts();
  res.json({ ok: true });
});

// ---- الحسابات الإدارية ----
app.get('/api/admin/admins', requireAdmin, async (req, res) => {
  const rows = await q.all(`SELECT * FROM users WHERE rank IN ('admin','superadmin','roomadmin') ORDER BY id`);
  res.json(rows.map(u => ({ ...pubUser(u), badge: badgeOf(u) })));
});

// ---- قائمة الحظر ----
app.get('/api/admin/bans', requireAdmin, async (req, res) => res.json(await q.all(`SELECT * FROM bans ORDER BY id DESC`)));
app.delete('/api/admin/bans/:id', requireAdmin, async (req, res) => {
  const b = await q.get(`SELECT * FROM bans WHERE id=?`, req.params.id);
  if (b) {
    await q.run(`DELETE FROM bans WHERE id=?`, req.params.id);
    await q.run(`UPDATE users SET banned=0 WHERE username=?`, b.username);
  }
  res.json({ ok: true });
});

// ---- فلترة الكلمات ----
app.get('/api/admin/words', requireAdmin, async (req, res) => res.json(await q.all(`SELECT * FROM banned_words ORDER BY id DESC`)));
app.post('/api/admin/words', requireAdmin, async (req, res) => {
  const { id, word } = req.body;
  if (!word || !word.trim()) return res.status(400).json({ error: 'اكتب الكلمة' });
  if (id) await q.run(`UPDATE banned_words SET word=? WHERE id=?`, word.trim(), id);
  else await q.run(`INSERT OR IGNORE INTO banned_words (word) VALUES (?)`, word.trim());
  io.emit('sync');
  res.json({ ok: true });
});
app.delete('/api/admin/words/:id', requireAdmin, async (req, res) => {
  await q.run(`DELETE FROM banned_words WHERE id=?`, req.params.id);
  io.emit('sync');
  res.json({ ok: true });
});

// ---- التوثيق ----
app.get('/api/admin/verified', requireAdmin, async (req, res) => res.json(await q.all(`SELECT * FROM verified ORDER BY id DESC`)));
app.post('/api/admin/verified', requireAdmin, async (req, res) => {
  const names = String(req.body.names || '').split('|').map(s => s.trim()).filter(Boolean);
  for (const n of names) await q.run(`INSERT OR IGNORE INTO verified (username) VALUES (?)`, n);
  await refreshVerified();
  io.emit('sync');
  res.json({ ok: true });
});
app.delete('/api/admin/verified/:id', requireAdmin, async (req, res) => {
  await q.run(`DELETE FROM verified WHERE id=?`, req.params.id);
  await refreshVerified();
  io.emit('sync');
  res.json({ ok: true });
});

// ---- إرسال إعلان للجميع ----
app.post('/api/admin/broadcast', requireAdmin, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'اكتب نص الإعلان' });
  const msg = { type: 'announce', text: text.trim(), at: Date.now() };
  io.emit('announce', msg);
  for (const rid of Object.keys(roomUsers)) {
    await q.run(`INSERT INTO messages (room_id,user_id,username,text,type) VALUES (?,0,'رسالة النظام',?,'announce')`, rid, text.trim());
  }
  res.json({ ok: true });
});

// ---- الشعار ----
app.post('/api/admin/logo', requireAdmin, upload.single('logo'), async (req, res) => {
  let url = req.body.logo_url || '';
  if (req.file) url = '/uploads/' + req.file.filename;
  await q.run(`INSERT INTO settings (key,value) VALUES ('logo_url',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, url);
  res.json({ ok: true, logo_url: url });
});

// ---- الشكاوى ----
app.get('/api/admin/complaints', requireAdmin, async (req, res) => res.json(await q.all(`SELECT * FROM complaints ORDER BY id DESC LIMIT 100`)));

// إعدادات عامة للواجهة (بدون حماية)
app.get('/api/public-settings', async (req, res) => {
  const s = await getSettings();
  res.json({
    site_name: s.site_name, logo_url: s.logo_url, skin: s.skin, font_size: s.font_size,
    show_smiles: s.show_smiles, show_voice: s.show_voice, show_image: s.show_image, show_time: s.show_time,
    snd_join: s.snd_join, snd_msg: s.snd_msg, snd_leave: s.snd_leave,
    msg_max: +s.msg_max || 500,
    vip_cost: +s.vip_cost, premium_cost: +s.premium_cost, plus_cost: +s.plus_cost
  });
});

// ---- معلومات الترخيص ----
app.get('/api/admin/license', requireAdmin, async (req, res) => {
  const u = await q.get(`SELECT username,rank FROM users WHERE id=?`, req.session.uid);
  res.json({
    app: 'شات نجوم العرب - Nujum Chat',
    license: 'v1.0-20260812 (شات نجوم العرب كامل)',
    email: 'admin@nujum-chat.com',
    host: req.headers.host,
    user: u.username,
    rank: u.rank,
    version: '1.0'
  });
});

// =====================================================
//  Socket.IO - الدردشة الفورية
// =====================================================
const onlineUsers = {};   // uid -> pubUser(+badge)
const userSockets = {};   // uid -> [socketId]
const roomUsers = {};     // roomId -> Set(uid)

io.on('connection', async (socket) => {
  const sess = socket.request.session;
  if (!sess || !sess.uid) { socket.disconnect(); return; }
  const uid = sess.uid;
  let me = await q.get(`SELECT * FROM users WHERE id=?`, uid);
  if (!me) { socket.disconnect(); return; }

  const mePub = { ...pubUser(me), badge: badgeOf(me) };
  onlineUsers[uid] = mePub;
  (userSockets[uid] = userSockets[uid] || []).push(socket.id);
  socket.join('user_' + uid);

  // دخول غرفة (مع فحص الإغلاق وكلمة المرور) — الرد عبر ack حتى يعرف العميل السبب
  socket.on('join', async (roomId, pwd, cb) => {
    const ack = (typeof cb === 'function') ? cb : (typeof pwd === 'function' ? pwd : null);
    if (typeof pwd === 'function') pwd = '';
    const done = (o) => { if (ack) ack(o); };
    const room = await q.get(`SELECT * FROM rooms WHERE id=?`, roomId);
    if (!room) return done({ ok: false, reason: 'missing', text: 'الغرفة غير موجودة' });
    const isAdm = me.rank === 'superadmin' || me.rank === 'admin';
    if (room.status !== 'open' && !isAdm)
      return done({ ok: false, reason: 'closed', text: '🔒 هذه الغرفة مغلقة حالياً من الإدارة' });
    if (room.password && !isAdm) {
      if (!pwd) return done({ ok: false, reason: 'password' });                 // يتطلب كلمة مرور
      if (String(pwd) !== String(room.password)) return done({ ok: false, reason: 'wrong_pass' });   // خاطئة — لا يدخل
    }
    socket.join('room_' + roomId);
    (roomUsers[roomId] = roomUsers[roomId] || new Set()).add(uid);
    const text = `مرحبا بـ ${me.username} في غرفة ${room.name}`;
    // تنبيه الدخول يُبث عبر الويب سوكيت مباشرة فقط — دون حفظه في سجل الدردشة
    io.to('room_' + roomId).emit('msg', { id: Date.now(), room_id: +roomId, username: 'رسالة النظام', text, type: 'join', created_at: Math.floor(Date.now() / 1000) });
    emitRoomUsers(roomId);
    emitRoomCounts();
    done({ ok: true });
  });

  // مغادرة غرفة
  socket.on('leave', async (roomId) => {
    socket.leave('room_' + roomId);
    if (roomUsers[roomId]) { roomUsers[roomId].delete(uid); }
    emitRoomUsers(roomId);
    emitRoomCounts();
  });

  // رسالة عامة
  socket.on('msg', async ({ roomId, text, reply, color }) => {
    me = await q.get(`SELECT * FROM users WHERE id=?`, uid);
    if (me.muted) return socket.emit('err', 'أنت مكتوم ولا يمكنك الكتابة');
    text = String(text || '').slice(0, 500).trim();
    if (!text) return;
    // فلترة الكلمات (لا تطبق على روابط الملصقات)
    if (!text.startsWith('st::')) {
      const words = await q.all(`SELECT word FROM banned_words`);
      for (const w of words) if (text.includes(w.word)) text = text.split(w.word).join('**');
    }
    const freshPub = { ...pubUser(me), badge: badgeOf(me) };   // صورة وبيانات حديثة من قاعدة البيانات (ليس لقطة الدخول)
    onlineUsers[uid] = freshPub;
    const rp = reply && reply.name ? { name: String(reply.name).slice(0, 40), text: String(reply.text || '').slice(0, 90) } : null;   // الرد على الرسالة
    const col = /^#[0-9a-fA-F]{6}$/.test(String(color || '')) ? String(color) : null;   // لون الخط من قائمة الألوان
    const extra = JSON.stringify({ badge: freshPub.badge, gender: me.gender, rank: me.rank, membership: me.membership, avatar: me.avatar || '', registered: me.registered, muted: me.muted ? 1 : 0, reply: rp, color: col, verified: VERIFIED_SET.has(me.username) ? 1 : 0 });
    const ins = await q.run(`INSERT INTO messages (room_id,user_id,username,text,type,extra) VALUES (?,?,?,?,'msg',?)`, roomId, uid, me.username, text, extra);
    const msg = {
      id: ins.lastID, room_id: +roomId, text, type: 'msg',
      created_at: Math.floor(Date.now() / 1000),
      user: freshPub, reply: rp, color: col
    };
    io.to('room_' + roomId).emit('msg', msg);
  });

  // رسالة خاصة
  socket.on('private', async ({ toId, text }) => {
    text = String(text || '').slice(0, 500).trim();
    if (!text) return;
    const ins = await q.run(`INSERT INTO private_messages (from_id,to_id,from_name,text) VALUES (?,?,?,?)`, uid, toId, me.username, text);
    const payload = { id: ins.lastID, from_id: uid, to_id: +toId, from_name: me.username, text, created_at: Math.floor(Date.now() / 1000) };
    io.to('user_' + toId).emit('private', payload);
    socket.emit('private', payload);
  });

  // تحديث الحالة
  socket.on('status', (st) => {
    if (onlineUsers[uid]) { onlineUsers[uid].status = st; }
    Object.keys(roomUsers).forEach(rid => { if (roomUsers[rid].has(uid)) emitRoomUsers(rid); });
  });

  socket.on('disconnect', () => {
    userSockets[uid] = (userSockets[uid] || []).filter(s => s !== socket.id);
    if (userSockets[uid].length === 0) {
      delete onlineUsers[uid];
      Object.keys(roomUsers).forEach(rid => {
        if (roomUsers[rid].has(uid)) { roomUsers[rid].delete(uid); emitRoomUsers(rid); emitRoomCounts(); }
      });
    }
  });
});

async function emitRoomUsers(roomId) {
  const set = roomUsers[roomId] || new Set();
  const list = [];
  for (const id of set) {
    const u = await q.get(`SELECT * FROM users WHERE id=?`, id);
    if (u) { const p = pubUser(u); p.status = (onlineUsers[id] || {}).status || u.status; list.push(p); }
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`★ شات نجوم العرب يعمل على http://0.0.0.0:${PORT}`);
  console.log(`★ لوحة التحكم: http://localhost:${PORT}/admin.html  (ax / 123456)`);
});
