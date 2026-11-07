// تخزين بيانات الجلسة/الجهاز في ملف JSON على الخادم (data/device-store.json)
// بدل localStorage. كل جهاز/متصفح يُعرَّف بكوكي HttpOnly عشوائي (sc_device)،
// وبياناته (key → value نصّي) تُحفظ تحت معرّفه في الملف.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.DEVICE_STORE_FILE || path.join(__dirname, 'data', 'device-store.json');
const COOKIE = 'sc_device';
const MAX_AGE_S = 60 * 60 * 24 * 365;          // سنة
const MAX_BYTES_PER_DEVICE = 2 * 1024 * 1024;  // 2MB لكل جهاز
const MAX_KEY_LEN = 128;

let store = {};
try { store = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (e) { store = {}; }

let timer = null;
function flush() {
  timer = null;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store));
    fs.renameSync(tmp, FILE);                   // كتابة ذرّية
  } catch (e) { console.error('device-store: فشل الحفظ', e.message); }
}
function scheduleFlush() { if (!timer) timer = setTimeout(flush, 300); }
process.on('exit', () => { if (timer) flush(); });
['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => { if (timer) flush(); process.exit(0); }));

function readCookie(req, name) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function deviceId(req, res) {
  let id = readCookie(req, COOKIE);
  if (!id || !/^[a-f0-9]{48}$/.test(id)) {
    id = crypto.randomBytes(24).toString('hex');
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader('Set-Cookie',
      `${COOKIE}=${id}; Path=/; Max-Age=${MAX_AGE_S}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
  }
  return id;
}

function size(obj) { return Buffer.byteLength(JSON.stringify(obj)); }

function mount(app, express) {
  const json = express.json({ limit: '3mb' });
  app.get('/api/device-store', (req, res) => {
    const id = deviceId(req, res);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: store[id] || {} });
  });
  // body: { set: {k:v}, remove: [k], clear: true }
  const write = (req, res) => {
    const id = deviceId(req, res);
    const b = req.body || {};
    const cur = Object.assign({}, store[id] || {});
    if (b.clear) for (const k of Object.keys(cur)) delete cur[k];
    (Array.isArray(b.remove) ? b.remove : []).forEach(k => { delete cur[String(k)]; });
    if (b.set && typeof b.set === 'object') {
      for (const [k, v] of Object.entries(b.set)) {
        if (k.length > MAX_KEY_LEN || typeof v !== 'string') continue;
        cur[k] = v;
      }
    }
    if (size(cur) > MAX_BYTES_PER_DEVICE) return res.status(413).json({ error: 'too large' });
    if (Object.keys(cur).length) store[id] = cur; else delete store[id];
    scheduleFlush();
    res.json({ ok: true });
  };
  app.put('/api/device-store', json, write);
  app.post('/api/device-store', json, write); // لـ sendBeacon عند إغلاق الصفحة
}

module.exports = { mount };
