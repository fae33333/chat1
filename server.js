// =====================================================
//  سيرفر شات نجوم العرب - Node.js + SQLite3 + Socket.IO
// =====================================================
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const multer = require('multer');
const { Server } = require('socket.io');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// الاعتماد على عنوان الزائر الذي يمرره البروكسي الموثوق (Nginx/Cloudflare/Arena).
// لا نثق إلا بوكلاء loopback والشبكات الخاصة حتى لا يستطيع العميل تزوير X-Forwarded-For مباشرة.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');
function normalizeIp(value) {
  let ip = String(value || '').split(',')[0].trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip.slice(0, 80);
}
function requestIp(req) {
  return normalizeIp(req.ip || (req.socket && req.socket.remoteAddress) || '');
}

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
fs.mkdirSync(path.join(__dirname, 'public/uploads/emojis'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public/uploads/rooms'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public/uploads/bots'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public/uploads/statuses'), { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public/uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });
// رفع الهدايا/الإيموجي من لوحة الإدارة (مجلدات فرعية)
const storageMedia = multer.diskStorage({
  destination: (req, file, cb) => {
    const sub = req.path.includes('emoji') ? 'emojis' : (req.path.includes('bot-avatar') ? 'bots' : (req.path.includes('room') ? 'rooms' : 'gifts'));
    cb(null, path.join(__dirname, 'public/uploads', sub));
  },
  filename: (req, file, cb) => cb(null, Date.now() + '_' + Math.random().toString(36).slice(2, 8) + path.extname(file.originalname).toLowerCase())
});
const uploadMedia = multer({ storage: storageMedia, limits: { fileSize: 8 * 1024 * 1024 } });

// رفع صور الحالات في مجلد مستقل، مع رفض أي ملف غير صوري.
const statusStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public/uploads/statuses')),
  filename: (req, file, cb) => cb(null, Date.now() + '_' + Math.random().toString(36).slice(2, 10) + path.extname(file.originalname).toLowerCase())
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
    id: u.id, username: u.username, gender: u.gender, age: u.age, country: u.country,
    balance: u.balance, membership: u.membership, rank: u.rank, registered: u.registered,
    avatar: u.avatar, status: u.status, email: u.email || '', bio: u.bio || '',
    muted: u.muted ? 1 : 0, is_bot: u.is_bot ? 1 : 0,
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
  if (!req.session.uid || !['admin', 'superadmin'].includes(req.session.rank))
    return res.status(403).json({ error: 'ممنوع' });
  next();
}
// صلاحيات الإشراف داخل الغرفة تشمل «ادمن غرفة»، مع قراءة الرتبة الحالية
// من قاعدة البيانات حتى لا تسبب الجلسة القديمة خطأ 403 بعد تغيير الصلاحية.
async function requireModerator(req, res, next) {
  const auth = resolveRequestAuth(req);
  if (!auth) return res.status(401).json({ error: 'غير مسجل في هذه الصفحة' });
  try {
    const moderator = await q.get(`SELECT id,username,rank FROM users WHERE id=?`, auth.uid);
    if (!moderator || !['roomadmin', 'admin', 'superadmin'].includes(moderator.rank))
      return res.status(403).json({ error: 'لا تملك صلاحية الإشراف' });
    req.authUid = +moderator.id;
    req.authRank = moderator.rank;
    if (auth.source === 'session') req.session.rank = moderator.rank;
    else if (auth.token && CHAT_TOKENS.has(auth.token)) CHAT_TOKENS.get(auth.token).rank = moderator.rank;
    req.moderator = moderator;
    next();
  } catch (e) { res.status(500).json({ error: 'تعذر التحقق من الصلاحية' }); }
}
const MOD_RANK_LEVEL = { user: 0, roomadmin: 1, admin: 2, superadmin: 3 };
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
  const { username, password } = req.body;
  const u = await q.get(`SELECT * FROM users WHERE username=?`, username);
  if (!u || !u.password || !bcrypt.compareSync(password, u.password))
    return res.status(400).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  const ipBan = await guestIpBan(requestIp(req));
  if (ipBan) return res.status(403).json({ error: 'عنوان IP الخاص بك محظور' + (ipBan.reason ? ': ' + ipBan.reason : '') });
  if (u.banned) return res.status(403).json({ error: 'هذا الحساب محظور' });
  await finishAuthentication(req, res, u);
});

app.post('/api/guest', async (req, res) => {
  let { username, gender } = req.body;
  username = (username || '').trim().slice(0, 20);
  if (!username) return res.status(400).json({ error: 'اكتب اسم المستخدم' });
  const ip = requestIp(req);
  const ipBan = await guestIpBan(ip);
  if (ipBan) return res.status(403).json({ error: 'عنوان IP الخاص بك محظور' + (ipBan.reason ? ': ' + ipBan.reason : '') });
  let u = await q.get(`SELECT * FROM users WHERE username=?`, username);
  let renamedFrom = '';
  // إذا كان الاسم محجوزاً لحساب مسجل ندخل الزائر تلقائياً بالاسم نفسه مع أربعة أرقام عشوائية.
  if (u && u.registered) {
    renamedFrom = username;
    const stem = username.slice(0, 16);
    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = stem + crypto.randomInt(1000, 10000);
      if (!await q.get(`SELECT id FROM users WHERE username=?`, candidate)) {
        username = candidate;
        u = null;
        break;
      }
    }
    if (u) return res.status(500).json({ error: 'تعذر إنشاء اسم زائر بديل، حاول مرة أخرى' });
  }
  if (!u) {
    const r = await q.run(`INSERT INTO users (username,gender,registered,membership,rank) VALUES (?,?,0,'none','user')`, username, gender || 'secret');
    u = await q.get(`SELECT * FROM users WHERE id=?`, r.lastID);
  }
  // حظر الزائر مرتبط بالـ IP الحالي لا بالاسم الذي قد يُعاد استخدامه من شبكة أخرى.
  if (u.banned) { await q.run(`UPDATE users SET banned=0 WHERE id=?`, u.id); u.banned = 0; }
  await finishAuthentication(req, res, u, renamedFrom ? { guest_name_changed: true, requested_username: renamedFrom } : {});
});

app.post('/api/register', async (req, res) => {
  const { username, password, gender, age, country } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'أكمل الحقول المطلوبة' });
  const ipBan = await guestIpBan(requestIp(req));
  if (ipBan) return res.status(403).json({ error: 'لا يمكن التسجيل من عنوان IP محظور' });
  const ex = await q.get(`SELECT id FROM users WHERE username=?`, username);
  if (ex) {
    // ضيف يحوّل حسابه لمسجل
    const old = await q.get(`SELECT * FROM users WHERE username=?`, username);
    if (old.registered) return res.status(400).json({ error: 'الاسم مستخدم مسبقا' });
    await q.run(`UPDATE users SET password=?,gender=?,age=?,country=?,registered=1 WHERE id=?`,
      bcrypt.hashSync(password, 10), gender || 'secret', age || 25, country || '', old.id);
    await refreshUserEverywhere(old.id);   // تحديث الاسم/الصورة مباشرة لمن بداخل الغرف
    io.emit('sync');
    const fresh = await q.get(`SELECT * FROM users WHERE id=?`, old.id);
    return finishAuthentication(req, res, fresh);
  }
  const r = await q.run(`INSERT INTO users (username,password,gender,age,country,registered,balance) VALUES (?,?,?,?,?,1,10)`,
    username, bcrypt.hashSync(password, 10), gender || 'secret', age || 25, country || '');
  const u = await q.get(`SELECT * FROM users WHERE id=?`, r.lastID);
  io.emit('sync');
  await finishAuthentication(req, res, u);
});

// لوحة الإدارة تستخدم جلسة الكوكي المعتادة.
app.get('/api/me', async (req, res) => {
  if (!req.session.uid) return res.json({ user: null });
  const u = await q.get(`SELECT * FROM users WHERE id=?`, req.session.uid);
  if (!u) return res.json({ user: null });
  req.session.rank = u.rank;
  res.json({ user: pubUser(u), badge: badgeOf(u) });
});

// صفحة الشات لا تستعيد أي اسم من الكوكي؛ يلزم رمز الصفحة الموجود في الذاكرة.
app.get('/api/chat/me', async (req, res) => {
  const auth = resolveRequestAuth(req);
  if (!auth || auth.source !== 'chat') return res.json({ user: null });
  const u = await q.get(`SELECT * FROM users WHERE id=?`, auth.uid);
  if (!u) return res.json({ user: null });
  res.json({ user: pubUser(u), badge: badgeOf(u) });
});

app.post('/api/logout', (req, res) => {
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

app.get('/api/rooms/:id/messages', requireUser, requireRoomNotKicked, async (req, res) => {
  const msgs = await q.all(`SELECT * FROM messages WHERE room_id=? ORDER BY id DESC LIMIT 60`, req.params.id);
  res.json(msgs.reverse());
});

app.get('/api/rooms/:id/users', requireUser, requireRoomNotKicked, async (req, res) => {
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
    convs.push({
      id: oid, username: r.other_name, avatar: r.other_avatar, gender: r.other_gender,
      membership: r.other_mem, rank: r.other_rank, registered: r.other_registered ? 1 : 0,
      verified: VERIFIED_SET.has(r.other_name) ? 1 : 0, last: r.text, at: r.created_at
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
  const admins = await q.all(`SELECT id FROM users WHERE rank IN ('admin','superadmin')`);
  for (const admin of admins) {
    const notification = await createUserNotification(admin.id, text, 'bell_badge_fill');
    io.to('user_' + admin.id).emit('notify', notification);
  }
  io.emit('service_request_created');
}

// طلب ترقية: لا يتم الخصم أو تطبيق العضوية إلا بعد موافقة الإدارة.
app.post('/api/upgrade', requireUser, async (req, res) => {
  const { target_id, plan } = req.body;
  const months = Math.min(24, Math.max(1, parseInt(req.body.months) || 1));
  const settings = await getSettings();
  const costs = { vip: +settings.vip_cost, premium: +settings.premium_cost, plus: +settings.plus_cost };
  if (!costs[plan]) return res.status(400).json({ error: 'خطة غير صالحة' });
  const me = await q.get(`SELECT * FROM users WHERE id=?`, req.authUid);
  if (!me || !me.registered) return res.status(403).json({ error: 'يتطلب عضوية مسجلة' });
  const target = await q.get(`SELECT * FROM users WHERE id=?`, +target_id || me.id);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  const duplicate = await q.get(`SELECT id FROM service_requests WHERE user_id=? AND target_id=? AND request_type='upgrade' AND status='pending'`, me.id, target.id);
  if (duplicate) return res.status(400).json({ error: 'يوجد طلب ترقية قيد المراجعة لهذا المستخدم بالفعل' });
  const suggestedGold = costs[plan] * months;
  const out = await q.run(`
    INSERT INTO service_requests (user_id,username,target_id,target_name,request_type,plan,months,suggested_gold)
    VALUES (?,?,?,?, 'upgrade',?,?,?)`,
    me.id, me.username, target.id, target.username, plan, months, suggestedGold);
  await notifyAdminAccounts(`طلب ترقية جديد من ${me.username}: ${target.username} إلى ${plan.toUpperCase()} لمدة ${months} شهر`);
  res.json({ ok: true, requested: true, request_id: out.lastID, suggested_gold: suggestedGold });
});

// تغيير الحالة / الصورة
app.post('/api/status', requireUser, async (req, res) => {
  const { status } = req.body;
  if (!['online', 'busy', 'away'].includes(status)) return res.status(400).json({ error: 'حالة غير صالحة' });
  await q.run(`UPDATE users SET status=? WHERE id=?`, status, req.authUid);
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
      await q.run(`UPDATE users SET avatar=? WHERE id=?`, avatar, req.authUid);
      refreshUserEverywhere(req.authUid);
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

app.post('/api/statuses', requireUser, (req, res) => {
  uploadStatus.single('status')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'حجم الملف أكبر من 50MB' : err.message });
    try {
      const me = await q.get(`SELECT id,registered FROM users WHERE id=?`, req.authUid);
      if (!me || !me.registered) {
        if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) { } }
        return res.status(403).json({ error: 'رفع الحالة متاح للأعضاء المسجلين فقط' });
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
// إعادة بث بيانات العضو للغرف المتواجد فيها (صورة/جنس/عضوية جديدة)
async function refreshUserEverywhere(uid) {
  const fresh = await q.get('SELECT * FROM users WHERE id=?', uid);
  if (fresh && onlineUsers[uid]) onlineUsers[uid] = { ...pubUser(fresh), badge: badgeOf(fresh) };   // تحديث لقطة المتصل
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

// شراء الذهب الافتراضي (دفع تجريبي)
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
app.get('/api/admin/settings', requireAdmin, async (req, res) => res.json(await getSettings()));

app.post('/api/admin/settings', requireAdmin, async (req, res) => {
  const entries = Object.entries(req.body);
  for (const [k, v] of entries) await q.run(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, String(v));
  if (req.body.hidden_super !== undefined && String(req.body.hidden_super) !== '1') await revealHiddenAdmins();
  reloadBots();      // قد يكون تبديل «تفعيل الروبوت» تغيّر
  io.emit('sync');   // تطبيق فوري على صفحات الدردشة
  res.json({ ok: true });
});

// ---- إدارة الهدايا (رفع صورة + قيمة + ربح المستقبل) ----
app.get('/api/admin/gifts', requireAdmin, async (req, res) => res.json(await q.all(`SELECT * FROM gifts ORDER BY id DESC`)));
app.post('/api/admin/gifts', requireAdmin, async (req, res) => {
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
app.post('/api/admin/gifts/:id/del', requireAdmin, async (req, res) => {
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
app.post('/api/admin/upload/gift', requireAdmin, (req, res) => {
  uploadMedia.single('file')(req, res, (err) => {
    if (err || !req.file) return res.status(500).json({ error: 'تعذر الرفع: ' + (err ? err.message : 'لا يوجد ملف') });
    if (!String(req.file.mimetype || '').startsWith('image/')) {
      try { fs.unlinkSync(req.file.path); } catch (e) { }
      return res.status(400).json({ error: 'ملف الهدية يجب أن يكون صورة' });
    }
    res.json({ ok: true, path: '/uploads/gifts/' + req.file.filename });
  });
});
app.post('/api/admin/upload/gift-audio', requireAdmin, (req, res) => {
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
app.get('/api/admin/emojis', requireAdmin, async (req, res) => res.json(await q.all(`SELECT * FROM custom_emojis ORDER BY id DESC`)));
app.post('/api/admin/emojis', requireAdmin, async (req, res) => {
  const { img } = req.body || {};
  if (!img) return res.status(400).json({ error: 'لا توجد صورة إيموجي' });
  await q.run(`INSERT INTO custom_emojis (img) VALUES (?)`, String(img).slice(0, 150));
  io.emit('sync');
  res.json({ ok: true });
});
app.post('/api/admin/emojis/:id/del', requireAdmin, async (req, res) => {
  const emoji = await q.get(`SELECT img FROM custom_emojis WHERE id=?`, +req.params.id);
  await q.run(`DELETE FROM custom_emojis WHERE id=?`, +req.params.id);
  if (emoji && String(emoji.img).startsWith('/uploads/emojis/')) {
    try { fs.unlinkSync(path.join(__dirname, 'public/uploads/emojis', path.basename(emoji.img))); } catch (e) { }
  }
  io.emit('sync');
  res.json({ ok: true });
});
app.post('/api/admin/upload/emoji', requireAdmin, (req, res) => {
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
app.post('/api/admin/upload/bot-avatar', requireAdmin, (req, res) => {
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
app.get('/api/admin/room-bots', requireAdmin, async (req, res) => {
  const rows = await q.all(`
    SELECT rb.id,rb.room_id,rb.active,rb.reply_enabled,rb.reply_text,rb.created_at,r.name room_name,
      u.id user_id,u.username,u.avatar,u.rank,u.membership,u.gender,
      EXISTS(SELECT 1 FROM verified v WHERE v.username=u.username) verified
    FROM room_bots rb JOIN users u ON u.id=rb.user_id
    LEFT JOIN rooms r ON r.id=rb.room_id ORDER BY rb.id DESC`);
  res.json(rows);
});
app.post('/api/admin/room-bots', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const id = +body.id || 0;
  const username = String(body.username || '').trim().slice(0, 20);
  const roomId = +body.room_id;
  const avatar = String(body.avatar || '').slice(0, 180);
  const rank = ['user', 'roomadmin', 'admin', 'superadmin'].includes(body.rank) ? body.rank : 'user';
  const membership = ['none', 'mmez', 'plus', 'premium', 'vip'].includes(body.membership) ? body.membership : 'none';
  const active = body.active === false || body.active === 0 ? 0 : 1;
  const replyEnabled = body.reply_enabled ? 1 : 0;
  const replyText = String(body.reply_text || 'نعم؟').trim().slice(0, 100) || 'نعم؟';
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
app.delete('/api/admin/room-bots/:id', requireAdmin, async (req, res) => {
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
  const users = await q.get(`SELECT COUNT(*) c FROM users WHERE registered=1 AND COALESCE(is_bot,0)=0`);
  const guests = await q.get(`SELECT COUNT(*) c FROM users WHERE registered=0`);
  const rooms = await q.get(`SELECT COUNT(*) c FROM rooms`);
  const msgs = await q.get(`SELECT COUNT(*) c FROM messages`);
  const bans = await q.get(`SELECT COUNT(*) c FROM bans`);
  res.json({ users: users.c, guests: guests.c, rooms: rooms.c, messages: msgs.c, bans: bans.c, online: Object.keys(onlineUsers).length });
});
app.get('/api/admin/monitor', requireAdmin, async (req, res) => {
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
  await q.run(`UPDATE room_bots SET active=0 WHERE room_id=?`, req.params.id);
  await q.run(`DELETE FROM rooms WHERE id=?`, req.params.id);
  await q.run(`DELETE FROM messages WHERE room_id=?`, req.params.id);
  await syncRoomBots();
  io.emit('sync');
  res.json({ ok: true });
});

// ---- المستخدمون ----
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const search = req.query.q || '';
  const rows = await q.all(`SELECT * FROM users WHERE username LIKE ? ORDER BY id DESC LIMIT 200`, `%${search}%`);
  res.json(rows.map(u => ({ ...pubUser(u), banned: u.banned, muted: u.muted, ip: u.ip || '', badge: badgeOf(u) })));
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
app.get('/api/admin/admins', requireAdmin, async (req, res) => {
  const rows = await q.all(`SELECT * FROM users WHERE rank IN ('admin','superadmin','roomadmin') ORDER BY id`);
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
app.get('/api/admin/service-requests', requireAdmin, async (req, res) => {
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

app.post('/api/admin/service-requests/:id/approve', requireAdmin, async (req, res) => {
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

app.post('/api/admin/service-requests/:id/reject', requireAdmin, async (req, res) => {
  const id = +req.params.id;
  const note = String(req.body.note || 'تم رفض الطلب من الإدارة').slice(0, 200);
  const admin = await q.get(`SELECT id,username FROM users WHERE id=?`, req.session.uid);
  const request = await q.get(`SELECT * FROM service_requests WHERE id=? AND status='pending'`, id);
  if (!request) return res.status(400).json({ error: 'تمت معالجة هذا الطلب مسبقاً' });
  await q.run(`UPDATE service_requests SET status='rejected',admin_id=?,admin_name=?,note=?,resolved_at=strftime('%s','now') WHERE id=? AND status='pending'`,
    admin.id, admin.username, note, id);
  const text = `${request.request_type === 'verify' ? 'طلب التوثيق' : 'طلب الترقية'}: ${note}`;
  const notification = await createUserNotification(request.user_id, text, 'xmark_circle_fill');
  io.to('user_' + request.user_id).emit('notify', notification);
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
    hidden_super: s.hidden_super,
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
const ROOM_BOT_REPLY_TIMES = new Map();
async function maybeReplyWithRoomBot(roomId, text, sender, originalText) {
  const bots = await q.all(`
    SELECT rb.id room_bot_id,rb.reply_text,u.* FROM room_bots rb
    JOIN users u ON u.id=rb.user_id
    WHERE rb.room_id=? AND rb.active=1 AND rb.reply_enabled=1 ORDER BY rb.id`, +roomId);
  const normalizedText = String(text || '').toLocaleLowerCase('ar');
  const bot = bots.find(item => normalizedText.includes(String(item.username || '').toLocaleLowerCase('ar')));
  if (!bot) return;
  const lastReply = ROOM_BOT_REPLY_TIMES.get(+bot.room_bot_id) || 0;
  if (Date.now() - lastReply < 2500) return;
  ROOM_BOT_REPLY_TIMES.set(+bot.room_bot_id, Date.now());
  setTimeout(async () => {
    const stillActive = await q.get(`SELECT id FROM room_bots WHERE id=? AND room_id=? AND active=1 AND reply_enabled=1`, bot.room_bot_id, +roomId);
    if (!stillActive) return;
    const replyText = String(bot.reply_text || 'نعم؟').replaceAll('{name}', sender.username).slice(0, 100);
    const reply = { name: sender.username, text: String(originalText || '').slice(0, 90) };
    const botPublic = { ...pubUser(bot), status: 'online', badge: badgeOf(bot) };
    const extra = JSON.stringify({
      badge: botPublic.badge, gender: bot.gender, rank: bot.rank, membership: bot.membership,
      avatar: bot.avatar || '', registered: 1, muted: 0, reply, verified: VERIFIED_SET.has(bot.username) ? 1 : 0, is_bot: 1
    });
    const inserted = await q.run(`INSERT INTO messages (room_id,user_id,username,text,type,extra) VALUES (?,?,?,?,'msg',?)`,
      +roomId, bot.id, bot.username, replyText, extra);
    io.to('room_' + roomId).emit('msg', {
      id: inserted.lastID, room_id: +roomId, text: replyText, type: 'msg',
      created_at: Math.floor(Date.now() / 1000), user: botPublic, reply
    });
  }, 550 + Math.floor(Math.random() * 450));
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
  const clientIp = normalizeIp((tokenAuth && tokenAuth.ip) || socket.handshake.address || '');
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
    const isAdm = me.rank === 'superadmin' || me.rank === 'admin';
    const hiddenSetting = (await getSettings()).hidden_super === '1';
    const enterHidden = !!options.hidden && isAdm && hiddenSetting;
    if (room.status !== 'open' && !isAdm)
      return done({ ok: false, reason: 'closed', text: '🔒 هذه الغرفة مغلقة حالياً من الإدارة' });
    if (room.password && !isAdm) {
      if (!pwd) return done({ ok: false, reason: 'password' });                 // يتطلب كلمة مرور
      if (String(pwd) !== String(room.password)) return done({ ok: false, reason: 'wrong_pass' });   // خاطئة — لا يدخل
    }
    roomId = +roomId;
    if (socket.data.joinedRooms.has(roomId))
      return done({ ok: true, hidden: socket.data.hiddenRooms.has(roomId) });
    socket.join('room_' + roomId);
    socket.data.joinedRooms.add(roomId);
    if (enterHidden) socket.data.hiddenRooms.add(roomId);
    else (roomUsers[roomId] = roomUsers[roomId] || new Set()).add(uid);

    // لا نعلن دخول الإدارة المخفية ولا نضيفها إلى قائمة مستخدمي الغرفة.
    if (!enterHidden) emitRoomSystemEvent(roomId, 'join', `مرحباً بـ ${me.username} في غرفة ${room.name}`);
    // ترحيب الإدارة الاختياري يظهر للداخل فقط بعد رسالة الدخول.
    const welcome = String(room.welcome || '').trim();
    if (welcome) socket.emit('msg', {
      id: Date.now(), room_id: +roomId, username: 'رسالة النظام',
      text: welcome, type: 'welcome', created_at: Math.floor(Date.now() / 1000)
    });
    emitRoomUsers(roomId);
    emitRoomCounts();
    done({ ok: true, hidden: enterHidden });
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
    emitRoomUsers(roomId);
    emitRoomCounts();
  });

  // رسالة عامة
  socket.on('msg', async ({ roomId, text, reply, color }) => {
    roomId = +roomId;
    if (!socket.data.joinedRooms.has(roomId)) return socket.emit('err', 'يجب دخول الغرفة قبل الكتابة');
    me = await q.get(`SELECT * FROM users WHERE id=?`, uid);
    if (me.muted) return socket.emit('err', 'أنت مكتوم ولا يمكنك الكتابة');
    const hiddenAdmin = socket.data.hiddenRooms.has(roomId) && (me.rank === 'superadmin' || me.rank === 'admin');
    text = String(text || '').slice(0, 500).trim();
    if (!text) return;
    // فلترة الكلمات (لا تطبق على رابط الإيموجي المصور)
    if (!text.startsWith('em::')) {
      const words = await q.all(`SELECT word FROM banned_words`);
      for (const w of words) if (text.includes(w.word)) text = text.split(w.word).join('**');
    }
    const freshPub = { ...pubUser(me), badge: badgeOf(me) };   // صورة وبيانات حديثة من قاعدة البيانات (ليس لقطة الدخول)
    onlineUsers[uid] = freshPub;
    const rp = reply && reply.name ? { name: String(reply.name).slice(0, 40), text: String(reply.text || '').slice(0, 90) } : null;   // الرد على الرسالة
    const col = /^#[0-9a-fA-F]{6}$/.test(String(color || '')) ? String(color) : null;   // لون الخط من قائمة الألوان
    const messageUser = hiddenAdmin ? { ...freshPub, hidden_admin: 1 } : freshPub;
    const extra = JSON.stringify({ badge: freshPub.badge, gender: me.gender, rank: me.rank, membership: me.membership, avatar: me.avatar || '', registered: me.registered, muted: me.muted ? 1 : 0, reply: rp, color: col, verified: VERIFIED_SET.has(me.username) ? 1 : 0, hidden_admin: hiddenAdmin ? 1 : 0 });
    const ins = await q.run(`INSERT INTO messages (room_id,user_id,username,text,type,extra) VALUES (?,?,?,?,'msg',?)`, roomId, uid, me.username, text, extra);
    const msg = {
      id: ins.lastID, room_id: roomId, text, type: 'msg', hidden_admin: hiddenAdmin ? 1 : 0,
      created_at: Math.floor(Date.now() / 1000),
      user: messageUser, reply: rp, color: col
    };
    io.to('room_' + roomId).emit('msg', msg);
    maybeReplyWithRoomBot(roomId, text, me, text).catch(() => { });
  });

  // رسالة خاصة
  socket.on('private', async ({ toId, text }) => {
    text = String(text || '').slice(0, 500).trim();
    if (!text) return;
    me = await q.get(`SELECT * FROM users WHERE id=?`, uid);
    const recipient = await q.get(`SELECT id FROM users WHERE id=?`, +toId);
    if (!recipient) return socket.emit('err', 'المستخدم غير موجود');
    if (await usersIgnoreEachOther(uid, +toId))
      return socket.emit('err', 'لا يمكن تبادل الرسائل الخاصة بسبب التجاهل بين الحسابين');
    const ins = await q.run(`INSERT INTO private_messages (from_id,to_id,from_name,text) VALUES (?,?,?,?)`, uid, toId, me.username, text);
    const payload = {
      id: ins.lastID, from_id: uid, to_id: +toId, from_name: me.username,
      from_registered: me.registered ? 1 : 0, text, created_at: Math.floor(Date.now() / 1000)
    };
    io.to('user_' + toId).emit('private', payload);
    socket.emit('private', payload);
  });

  // تحديث الحالة
  socket.on('status', (st) => {
    if (onlineUsers[uid]) { onlineUsers[uid].status = st; }
    Object.keys(roomUsers).forEach(rid => { if (roomUsers[rid].has(uid)) emitRoomUsers(rid); });
  });

  socket.on('disconnect', () => {
    const joinedRooms = [...(socket.data.joinedRooms || [])];
    const hiddenRooms = new Set(socket.data.hiddenRooms || []);
    userSockets[uid] = (userSockets[uid] || []).filter(s => s !== socket.id);
    for (const roomId of joinedRooms) {
      // خروج الجلسة المخفية لا يظهر كرسالة نظام ولا يغيّر قائمة المتصلين.
      if (!hiddenRooms.has(+roomId) && !userStillHasVisibleSocketInRoom(uid, roomId)) {
        if (roomUsers[roomId]) roomUsers[roomId].delete(uid);
        emitRoomSystemEvent(roomId, 'leave', `${me.username} خرج من الغرفة`);
        emitRoomUsers(roomId);
        emitRoomCounts();
      }
    }
    if (userSockets[uid].length === 0) delete onlineUsers[uid];
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

(async () => {
  await syncRoomBots(false).catch(() => { });
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`★ شات نجوم العرب يعمل على http://0.0.0.0:${PORT}`);
    console.log(`★ لوحة التحكم: http://localhost:${PORT}/admin.html  (ax / 123456)`);
  });
})();
