/* الإشعارات (Web Push): VAPID لتأمين الإرسال، SQLite لتخزين اشتراكات الأجهزة، وNode.js للمعالجة والإرسال.
   الاستقبال في public/sw.js، والتثبيت (PWA) عبر public/manifest.webmanifest. */
'use strict';
const crypto = require('crypto');

let webpush = null;
let webpushError = '';
function loadWebPush() {
  if (webpush) return webpush;
  try { webpush = require('web-push'); webpushError = ''; } catch (e) { webpush = null; webpushError = String((e && e.message) || e).split('\n')[0].slice(0, 200); }
  return webpush;
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function generateVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

function cleanText(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max); }
function cleanUrl(v) {
  const u = cleanText(v, 500);
  if (!u) return '/';
  if (u.startsWith('/') && !u.startsWith('//')) return u;
  if (/^https?:\/\//i.test(u)) return u;
  return '/';
}

module.exports = function registerPush(app, { run, get, all, verifyAdminToken, isOnline }) {
  const upsert = (k, v) => run(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, String(v)]);
  const getSet = async (k, d = '') => { const r = await get('SELECT value FROM app_settings WHERE key = ?', [k]); return r && r.value != null ? r.value : d; };

  let ready = null;
  function init() {
    if (ready) return ready;
    ready = (async () => {
      await run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT DEFAULT '',
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_ok_at DATETIME,
        fail_count INTEGER DEFAULT 0
      )`);
      await run(`CREATE INDEX IF NOT EXISTS idx_push_sub_user ON push_subscriptions(user_id)`);
      await run(`CREATE TABLE IF NOT EXISTS push_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT, body TEXT, url TEXT, target TEXT,
        sent INTEGER DEFAULT 0, failed INTEGER DEFAULT 0, removed INTEGER DEFAULT 0,
        admin TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      let pub = await getSet('push_vapid_public'), priv = await getSet('push_vapid_private');
      // مفاتيح ثابتة من متغيرات البيئة (موصى بها): لا تتغير مهما أُعيد نشر الخادم أو حُذفت القاعدة
      const envPub = (process.env.VAPID_PUBLIC_KEY || '').trim(), envPriv = (process.env.VAPID_PRIVATE_KEY || '').trim();
      if (envPub && envPriv) {
        if (envPub !== pub || envPriv !== priv) { await upsert('push_vapid_public', envPub); await upsert('push_vapid_private', envPriv); }
        pub = envPub; priv = envPriv;
      }
      if (!pub || !priv) {
        const k = generateVapidKeys();
        pub = k.publicKey; priv = k.privateKey;
        await upsert('push_vapid_public', pub);
        await upsert('push_vapid_private', priv);
      }
      const s = await getSet('push_subject');
      if (!s) await upsert('push_subject', 'mailto:admin@soulchill.app');
      if (!(await get(`SELECT 1 AS x FROM app_settings WHERE key = 'push_enabled'`))) await upsert('push_enabled', '1');
      // إشعارات الأحداث: كلها مفعّلة افتراضياً، وتُغلق/تُفتح من لوحة الإدارة
      for (const k of ['push_evt_follow', 'push_evt_message', 'push_evt_room_invite', 'push_only_offline']) {
        if (!(await get('SELECT 1 AS x FROM app_settings WHERE key = ?', [k]))) await upsert(k, '1');
      }
    })().catch((e) => { ready = null; throw e; });
    return ready;
  }

  async function config() {
    await init();
    return {
      enabled: (await getSet('push_enabled', '1')) === '1',
      subject: await getSet('push_subject', 'mailto:admin@soulchill.app'),
      publicKey: await getSet('push_vapid_public'),
      privateKey: await getSet('push_vapid_private'),
      events: {
        follow: (await getSet('push_evt_follow', '1')) === '1',
        message: (await getSet('push_evt_message', '1')) === '1',
        room_invite: (await getSet('push_evt_room_invite', '1')) === '1'
      },
      onlyOffline: (await getSet('push_only_offline', '1')) === '1'
    };
  }

  function buildPayload(b) {
    return JSON.stringify({
      title: cleanText(b.title, 80) || 'SoulChill',
      body: cleanText(b.body, 300),
      url: cleanUrl(b.url),
      icon: cleanText(b.icon, 500) || '/img/icon-192.png',
      image: cleanText(b.image, 500) || undefined,
      tag: cleanText(b.tag, 60) || undefined
    });
  }

  async function deliver(rows, payload, cfg, ttl) {
    const wp = loadWebPush();
    if (!wp) { const e = new Error('تعذر تحميل web-push' + (webpushError ? ' (' + webpushError + ')' : '') + '. نفّذ: npm install web-push ثم أعد تشغيل السيرفر'); e.code = 'NO_WEBPUSH'; throw e; }
    wp.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    let sent = 0, failed = 0, removed = 0;
    const errors = [];
    for (let i = 0; i < rows.length; i += 40) {
      await Promise.all(rows.slice(i, i + 40).map(async (r) => {
        try {
          await wp.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payload, { TTL: ttl, urgency: 'normal' });
          sent++;
          await run('UPDATE push_subscriptions SET last_ok_at = CURRENT_TIMESTAMP, fail_count = 0 WHERE id = ?', [r.id]);
        } catch (err) {
          const vapidMismatch = err && (err.statusCode === 403 || err.statusCode === 401) && /vapid|credentials|authorization/i.test(String(err.body || err.message || ''));
          if (err && (err.statusCode === 404 || err.statusCode === 410 || vapidMismatch)) {
            removed++;
            await run('DELETE FROM push_subscriptions WHERE id = ?', [r.id]);
          } else {
            failed++;
            const host = (() => { try { return new URL(r.endpoint).host; } catch (e) { return ''; } })();
            const why = [err && err.statusCode ? 'HTTP ' + err.statusCode : '', err && err.body ? String(err.body).slice(0, 160) : '', err && err.message && !err.body ? String(err.message).slice(0, 160) : ''].filter(Boolean).join(' — ');
            if (errors.length < 5) errors.push((host ? host + ': ' : '') + why);
            console.error('push failed:', host, why);
            await run('UPDATE push_subscriptions SET fail_count = COALESCE(fail_count,0) + 1 WHERE id = ?', [r.id]);
          }
        }
      }));
    }
    return { sent, failed, removed, errors };
  }

  // يُستعمل من بقية السيرفر لاحقاً (رسالة خاصة، دعوة غرفة…): sendPushToUser(userId, { title, body, url })
  async function sendPushToUser(userId, data) {
    const cfg = await config();
    if (!cfg.enabled || !userId) return { sent: 0, failed: 0, removed: 0 };
    const rows = await all('SELECT * FROM push_subscriptions WHERE user_id = ?', [String(userId)]);
    if (!rows.length) return { sent: 0, failed: 0, removed: 0 };
    return deliver(rows, buildPayload(data || {}), cfg, 3600);
  }
  app.locals.sendPushToUser = sendPushToUser;

  // إشعار حدث (متابعة / رسالة خاصة / دعوة غرفة): يحترم مفتاح الحدث من لوحة الإدارة،
  // ويُرسل فقط إذا كان المستلم خارج التطبيق (إلا إن أُلغي هذا الشرط من الإدارة)
  const evtLast = new Map();
  async function sendPushEvent(type, userId, data) {
    try {
      if (!userId || !['follow', 'message', 'room_invite'].includes(type)) return null;
      const cfg = await config();
      if (!cfg.enabled || !cfg.events[type]) return null;
      if (cfg.onlyOffline && typeof isOnline === 'function' && isOnline(String(userId))) return null;
      // منع الإغراق: نفس النوع/المستلم/المصدر مرة كل 4 ثوانٍ
      const key = type + '|' + userId + '|' + ((data && data.tag) || '');
      const now = Date.now();
      if (now - (evtLast.get(key) || 0) < 4000) return null;
      evtLast.set(key, now);
      if (evtLast.size > 5000) { for (const [k, t] of evtLast) if (now - t > 60000) evtLast.delete(k); }
      return await sendPushToUser(userId, data || {});
    } catch (e) { console.error('push event failed:', e.message); return null; }
  }
  app.locals.sendPushEvent = sendPushEvent;

  const adminOnly = async (req, res) => {
    const s = await verifyAdminToken(req);
    if (!s) { res.status(401).json({ error: 'غير مصرح بالدخول' }); return null; }
    return s;
  };

  // ===== واجهة المستخدم =====
  app.get('/api/push/public-key', async (req, res) => {
    try { const c = await config(); res.json({ success: true, enabled: c.enabled, publicKey: c.publicKey }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/push/subscribe', async (req, res) => {
    try {
      const c = await config();
      if (!c.enabled) return res.status(403).json({ error: 'الإشعارات متوقفة' });
      const sub = (req.body && req.body.subscription) || {};
      const endpoint = String(sub.endpoint || '');
      const keys = sub.keys || {};
      if (!/^https:\/\//i.test(endpoint) || endpoint.length > 1000 || !keys.p256dh || !keys.auth) return res.status(400).json({ error: 'اشتراك غير صالح' });
      const uid = cleanText(req.headers['x-user-id'] || (req.body && req.body.userId) || '', 80);
      const ua = cleanText(req.headers['user-agent'], 250);
      await run(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, fail_count = 0`,
        [uid, endpoint, String(keys.p256dh), String(keys.auth), ua]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/push/unsubscribe', async (req, res) => {
    try {
      await init();
      const endpoint = String((req.body && req.body.endpoint) || '');
      if (endpoint) await run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ===== لوحة الإدارة =====
  app.get('/api/admin/push/status', async (req, res) => {
    if (!(await adminOnly(req, res))) return;
    try {
      const c = await config();
      const total = (await get('SELECT COUNT(*) AS n FROM push_subscriptions')).n;
      const users = (await get(`SELECT COUNT(DISTINCT user_id) AS n FROM push_subscriptions WHERE user_id != ''`)).n;
      const week = (await get(`SELECT COUNT(*) AS n FROM push_subscriptions WHERE created_at >= datetime('now','-7 day')`)).n;
      const log = await all('SELECT * FROM push_log ORDER BY id DESC LIMIT 20');
      res.json({ success: true, enabled: c.enabled, events: c.events, onlyOffline: c.onlyOffline, subject: c.subject, publicKey: c.publicKey, webPushInstalled: !!loadWebPush(), webPushError: webpushError, total, users, week, log });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/admin/push/settings', async (req, res) => {
    if (!(await adminOnly(req, res))) return;
    try {
      await init();
      const b = req.body || {};
      if (b.enabled !== undefined) await upsert('push_enabled', (b.enabled === true || b.enabled === 1 || b.enabled === '1') ? '1' : '0');
      if (b.events && typeof b.events === 'object') {
        for (const t of ['follow', 'message', 'room_invite']) {
          if (b.events[t] !== undefined) await upsert('push_evt_' + t, (b.events[t] === true || b.events[t] === 1 || b.events[t] === '1') ? '1' : '0');
        }
      }
      if (b.onlyOffline !== undefined) await upsert('push_only_offline', (b.onlyOffline === true || b.onlyOffline === 1 || b.onlyOffline === '1') ? '1' : '0');
      if (b.subject !== undefined) {
        const s = cleanText(b.subject, 200);
        if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/i.test(s)) return res.status(400).json({ error: 'الموضوع يجب أن يكون mailto:بريد أو رابط https' });
        await upsert('push_subject', s);
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/admin/push/regenerate-keys', async (req, res) => {
    if (!(await adminOnly(req, res))) return;
    try {
      await init();
      const k = generateVapidKeys();
      await upsert('push_vapid_public', k.publicKey);
      await upsert('push_vapid_private', k.privateKey);
      // الاشتراكات القديمة مرتبطة بالمفتاح القديم ولا تعمل بعده
      const del = await run('DELETE FROM push_subscriptions');
      res.json({ success: true, publicKey: k.publicKey, cleared: (del && del.changes) || 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/admin/push/subscriptions', async (req, res) => {
    if (!(await adminOnly(req, res))) return;
    try {
      await init();
      const q = cleanText(req.query.q, 80);
      const rows = await all(`SELECT s.id, s.user_id, s.user_agent, s.created_at, s.last_ok_at, s.fail_count, u.name AS user_name
        FROM push_subscriptions s LEFT JOIN users u ON u.id = s.user_id
        WHERE (? = '' OR s.user_id LIKE ? OR u.name LIKE ?) ORDER BY s.id DESC LIMIT 200`, [q, `%${q}%`, `%${q}%`]);
      res.json({ success: true, subscriptions: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/admin/push/subscriptions/:id', async (req, res) => {
    if (!(await adminOnly(req, res))) return;
    try { await init(); await run('DELETE FROM push_subscriptions WHERE id = ?', [req.params.id]); res.json({ success: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/admin/push/send', async (req, res) => {
    const session = await adminOnly(req, res);
    if (!session) return;
    try {
      const cfg = await config();
      if (!cfg.enabled) return res.status(400).json({ error: 'الإشعارات متوقفة من الإعدادات' });
      const b = req.body || {};
      if (!cleanText(b.title, 80) || !cleanText(b.body, 300)) return res.status(400).json({ error: 'العنوان والنص مطلوبان' });
      let rows, target;
      if (b.target === 'users') {
        const ids = [...new Set(String(b.userIds || '').split(/[\s,،]+/).map(x => cleanText(x, 80)).filter(Boolean))].slice(0, 200);
        if (!ids.length) return res.status(400).json({ error: 'اكتب معرّف مستخدم واحداً على الأقل' });
        rows = await all(`SELECT * FROM push_subscriptions WHERE user_id IN (${ids.map(() => '?').join(',')})`, ids);
        target = 'users:' + ids.length;
      } else if (b.target === 'subscription') {
        rows = await all('SELECT * FROM push_subscriptions WHERE id = ?', [b.subscriptionId]);
        target = 'device';
      } else {
        rows = await all('SELECT * FROM push_subscriptions');
        target = 'all';
      }
      if (!rows.length) return res.status(400).json({ error: 'لا توجد أجهزة مشتركة لهذا الاستهداف' });
      const ttl = Math.min(86400 * 7, Math.max(60, parseInt(b.ttlSeconds, 10) || 86400));
      const out = await deliver(rows, buildPayload(b), cfg, ttl);
      await run('INSERT INTO push_log (title, body, url, target, sent, failed, removed, admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [cleanText(b.title, 80), cleanText(b.body, 300), cleanUrl(b.url), target, out.sent, out.failed, out.removed, cleanText(session.username || '', 60)]);
      res.json({ success: true, ...out, total: rows.length });
    } catch (e) {
      res.status(e.code === 'NO_WEBPUSH' ? 501 : 500).json({ error: e.message });
    }
  });

  init().catch((e) => console.error('push init failed:', e.message));
};
module.exports.generateVapidKeys = generateVapidKeys;
