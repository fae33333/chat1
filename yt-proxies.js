// yt-proxies.js — قائمة بروكسيات يوتيوب تُدار من لوحة الإدارة (بدون إعادة تشغيل الخادم).
// تُحفظ في data/yt-proxies.json (مستثنى من git) بصلاحيات 600 لأنها قد تحمل اسم مستخدم وكلمة مرور.
// تُمرَّر إلى yt-dlp عبر --proxy، مع تدوير تلقائي (round-robin) وإيقاف مؤقت للبروكسي الفاشل/المحجوب.
// لا تُعاد كلمات المرور أبداً إلى الواجهة: describe() يعيد العنوان بدون بيانات الدخول.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ALLOWED_SCHEMES = ['http', 'https', 'socks4', 'socks4a', 'socks5', 'socks5h'];
const MAX_PROXIES = 500;

function envNum(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const BOT_COOLDOWN_MS = Math.max(10000, envNum('YT_PROXY_BOT_COOLDOWN_MS', 10 * 60 * 1000));
const NET_COOLDOWN_MS = Math.max(10000, envNum('YT_PROXY_NET_COOLDOWN_MS', 5 * 60 * 1000));
const FAILS_BEFORE_COOLDOWN = Math.max(1, envNum('YT_PROXY_MAX_FAILS', 3));

const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;
const IPV6_RE = /^\[[0-9a-f:.]+\]$/i;

function validHost(h) {
  return HOST_RE.test(h) || IPV6_RE.test(h);
}
function validPort(p) {
  return /^\d{1,5}$/.test(p) && Number(p) >= 1 && Number(p) <= 65535;
}
function enc(s) { return encodeURIComponent(String(s)); }
function dec(s) { try { return decodeURIComponent(String(s)); } catch (e) { return String(s); } }

/**
 * يحوّل سطراً واحداً إلى عنوان بروكسي موحّد scheme://[user:pass@]host:port
 * الصيغ المدعومة:
 *   scheme://user:pass@host:port   |  user:pass@host:port
 *   host:port                      |  host:port:user:pass
 * بدون scheme يُفترض http. يرمي Error برسالة عربية عند الخطأ.
 */
function parseProxyLine(raw) {
  let line = String(raw || '').trim();
  if (!line) throw new Error('سطر فارغ');
  if (/\s/.test(line)) throw new Error('يحتوي مسافات');
  let scheme = 'http';
  const sm = /^([a-z0-9]+):\/\/(.+)$/i.exec(line);
  if (sm) {
    scheme = sm[1].toLowerCase();
    line = sm[2];
    if (!ALLOWED_SCHEMES.includes(scheme)) throw new Error('نوع غير مدعوم (' + scheme + ') — المسموح: ' + ALLOWED_SCHEMES.join(' / '));
  }
  line = line.replace(/\/+$/, '');
  let user = '', pass = '', host = '', port = '';
  const at = line.lastIndexOf('@');
  if (at !== -1) {
    const cred = line.slice(0, at);
    const hp = line.slice(at + 1);
    const ci = cred.indexOf(':');
    user = dec(ci === -1 ? cred : cred.slice(0, ci));
    pass = ci === -1 ? '' : dec(cred.slice(ci + 1));
    const m = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(hp);
    if (!m) throw new Error('الصيغة غير مفهومة (المتوقع host:port)');
    host = m[1]; port = m[2];
  } else {
    const parts = line.split(':');
    if (parts.length === 2) { host = parts[0]; port = parts[1]; }
    else if (parts.length >= 4) {
      host = parts[0]; port = parts[1]; user = parts[2]; pass = parts.slice(3).join(':');
    } else if (/^\[[^\]]+\]:\d+$/.test(line)) {
      const i = line.lastIndexOf(':'); host = line.slice(0, i); port = line.slice(i + 1);
    } else throw new Error('الصيغة غير مفهومة (المتوقع host:port أو host:port:user:pass)');
  }
  if (!host || !validHost(host)) throw new Error('عنوان الخادم غير صالح');
  if (!validPort(port)) throw new Error('المنفذ غير صالح');
  const auth = user ? enc(user) + (pass ? ':' + enc(pass) : '') + '@' : '';
  return scheme + '://' + auth + host.toLowerCase() + ':' + Number(port);
}

/** يحلل نصاً متعدد الأسطر (أو مفصولاً بفواصل) ويعيد {valid:[url], invalid:[{line,reason}]} */
function parseProxyList(text) {
  const valid = [], invalid = [];
  const seen = new Set();
  const lines = String(text || '').split(/\r?\n|[;,]/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  for (const line of lines) {
    try {
      const url = parseProxyLine(line);
      if (seen.has(url)) continue;
      seen.add(url); valid.push(url);
    } catch (e) {
      // لا نُرجع السطر كاملاً حتى لا تظهر كلمة المرور في رسالة الخطأ
      invalid.push({ line: maskRaw(line), reason: e.message });
    }
  }
  return { valid, invalid };
}

function maskRaw(line) {
  return String(line).replace(/:\/\/[^@/]*@/, '://***@').replace(/^[^@/:]+:[^@/]*@/, '***@').slice(0, 80);
}

/** عنوان آمن للعرض: بدون اسم مستخدم/كلمة مرور */
function publicLabel(url) {
  try {
    const u = new URL(url);
    return u.protocol.replace(':', '') + '://' + u.host;
  } catch (e) { return '—'; }
}
function hasAuth(url) { return /^[a-z0-9]+:\/\/[^@/]+@/i.test(String(url)); }

function createProxyStore(root, opts = {}) {
  const now = opts.now || (() => Date.now());
  const dir = path.join(root, 'data');
  const file = path.join(dir, 'yt-proxies.json');
  let state = { enabled: false, fallbackDirect: false, proxies: [] };
  let cursor = 0;
  let saveTimer = null;

  function load() {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      state = {
        enabled: !!j.enabled,
        fallbackDirect: !!j.fallbackDirect,
        proxies: (Array.isArray(j.proxies) ? j.proxies : []).filter(p => p && typeof p.url === 'string').map(normalizeEntry)
      };
    } catch (e) { /* لا ملف بعد */ }
  }
  function normalizeEntry(p) {
    return {
      id: String(p.id || crypto.randomBytes(5).toString('hex')),
      url: p.url,
      enabled: p.enabled !== false,
      addedAt: Number(p.addedAt) || now(),
      ok: Number(p.ok) || 0,
      fail: Number(p.fail) || 0,
      streak: Number(p.streak) || 0,
      lastOk: Number(p.lastOk) || 0,
      lastError: String(p.lastError || '').slice(0, 200),
      lastErrorAt: Number(p.lastErrorAt) || 0,
      cooldownUntil: Number(p.cooldownUntil) || 0
    };
  }
  function saveNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.tmp' + process.pid;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 1), { mode: 0o600 });
      fs.renameSync(tmp, file);
      try { fs.chmodSync(file, 0o600); } catch (e) { /* Windows */ }
    } catch (e) { console.error('yt-proxies save failed:', e.message); }
  }
  function saveSoon() {
    if (saveTimer) return;
    saveTimer = setTimeout(saveNow, 1500);
    if (saveTimer.unref) saveTimer.unref();
  }
  load();

  const cooling = (p) => p.cooldownUntil > now();
  const find = (id) => state.proxies.find(p => p.id === id);
  const findByUrl = (url) => state.proxies.find(p => p.url === url);

  return {
    file,
    /** وضع البروكسي مفعّل ويوجد على الأقل بروكسي واحد مفعّل */
    isActive() { return state.enabled && state.proxies.some(p => p.enabled); },
    isEnabled() { return state.enabled; },
    allowDirect() { return !!state.fallbackDirect; },
    setMode({ enabled, fallbackDirect } = {}) {
      if (typeof enabled === 'boolean') state.enabled = enabled;
      if (typeof fallbackDirect === 'boolean') state.fallbackDirect = fallbackDirect;
      saveNow();
      return { enabled: state.enabled, fallbackDirect: state.fallbackDirect };
    },
    add(text) {
      const { valid, invalid } = parseProxyList(text);
      const added = []; let duplicates = 0; let overflow = 0;
      for (const url of valid) {
        if (findByUrl(url)) { duplicates++; continue; }
        if (state.proxies.length >= MAX_PROXIES) { overflow++; continue; }
        const e = normalizeEntry({ url });
        state.proxies.push(e); added.push(e.id);
      }
      if (added.length) saveNow();
      return { added: added.length, duplicates, overflow, invalid };
    },
    remove(id) {
      const i = state.proxies.findIndex(p => p.id === id);
      if (i === -1) return false;
      state.proxies.splice(i, 1); saveNow(); return true;
    },
    removeWhere(fn) {
      const before = state.proxies.length;
      state.proxies = state.proxies.filter(p => !fn(p));
      const n = before - state.proxies.length;
      if (n) saveNow();
      return n;
    },
    clear() { const n = state.proxies.length; state.proxies = []; saveNow(); return n; },
    setEnabled(id, enabled) {
      const p = find(id); if (!p) return false;
      p.enabled = !!enabled; if (enabled) { p.cooldownUntil = 0; p.streak = 0; }
      saveNow(); return true;
    },
    resetCooldowns() { for (const p of state.proxies) { p.cooldownUntil = 0; p.streak = 0; } saveNow(); },
    urlOf(id) { const p = find(id); return p ? p.url : ''; },
    allUrls() { return state.proxies.filter(p => p.enabled).map(p => p.url); },

    /**
     * البروكسيات المرشّحة للمحاولة الآن بترتيب التدوير: المفعّلة غير الموقوفة مؤقتاً أولاً.
     * إن كانت كلها موقوفة مؤقتاً نُرجع الأقرب انتهاءً (أفضل جهد) بدل قائمة فارغة.
     */
    candidates(max = 6) {
      const enabled = state.proxies.filter(p => p.enabled);
      if (!enabled.length) return [];
      const n = enabled.length;
      const start = cursor % n;
      const rotated = enabled.slice(start).concat(enabled.slice(0, start));
      let healthy = rotated.filter(p => !cooling(p));
      if (!healthy.length) healthy = [rotated.slice().sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0]];
      cursor = (cursor + 1) % n;
      return healthy.slice(0, Math.max(1, max)).map(p => p.url);
    },
    /** بروكسي واحد للاستخدام العام (بحث/تشغيل مباشر) — '' إن لم يكن الوضع فعّالاً */
    next() {
      if (!this.isActive()) return '';
      return this.candidates(1)[0] || '';
    },
    /** تسجيل نتيجة استخدام بروكسي: info = { bot, net, error } */
    report(url, ok, info = {}) {
      const p = findByUrl(url); if (!p) return;
      if (ok) {
        p.ok++; p.streak = 0; p.lastOk = now(); p.cooldownUntil = 0; p.lastError = '';
      } else {
        p.fail++; p.streak++;
        p.lastError = String(info.error || (info.bot ? 'يوتيوب يطلب التحقق (bot)' : info.net ? 'تعذر الاتصال بالبروكسي' : 'فشل')).replace(/\s+/g, ' ').slice(0, 200);
        p.lastErrorAt = now();
        if (info.bot) p.cooldownUntil = now() + BOT_COOLDOWN_MS;
        else if (p.streak >= FAILS_BEFORE_COOLDOWN) p.cooldownUntil = now() + NET_COOLDOWN_MS;
      }
      saveSoon();
    },
    /** وصف آمن للواجهة (بلا بيانات دخول) */
    describe() {
      return {
        enabled: state.enabled,
        fallbackDirect: state.fallbackDirect,
        active: this.isActive(),
        count: state.proxies.length,
        proxies: state.proxies.map(p => ({
          id: p.id,
          label: publicLabel(p.url),
          auth: hasAuth(p.url),
          enabled: p.enabled,
          cooling: cooling(p),
          cooldownLeft: cooling(p) ? Math.ceil((p.cooldownUntil - now()) / 1000) : 0,
          ok: p.ok, fail: p.fail,
          lastOk: p.lastOk, lastError: p.lastError, lastErrorAt: p.lastErrorAt,
          addedAt: p.addedAt
        }))
      };
    },
    flush: saveNow
  };
}

module.exports = { createProxyStore, parseProxyLine, parseProxyList, publicLabel, hasAuth, ALLOWED_SCHEMES };
