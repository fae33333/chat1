// session-store.js — حفظ جلسات الدخول في ملف JSON على الخادم (data/sessions.json)
// =====================================================================
// بديل نظام localStorage في المتصفح: كل جلسة دخول (مستخدم أو إدارة) تُسجَّل هنا
// كسجل JSON، والمتصفح يحتفظ فقط بكوكيز httpOnly يشير إلى الجلسة.
// هكذا يبقى تسجيل الدخول محفوظاً بعد إغلاق المتصفح وإعادة فتحه، دون استخدام
// التخزين الدائم في المتصفح إطلاقاً (لا localStorage ولا sessionStorage للحفظ الدائم).
// الملف يقع في data/ (متجاهَل في .gitignore) مثل بقية بيانات الخادم الحساسة.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
// يمكن تجاوز مسار الملف للاختبارات عبر المتغير SESSIONS_JSON_PATH
const FILE_PATH = process.env.SESSIONS_JSON_PATH || path.join(DATA_DIR, 'sessions.json');
const KINDS = ['user', 'admin'];

function emptyStore() {
  return { user: {}, admin: {} };
}

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
    const store = emptyStore();
    for (const k of KINDS) {
      if (parsed && parsed[k] && typeof parsed[k] === 'object') store[k] = parsed[k];
    }
    return store;
  } catch (e) {
    // ملف غير موجود أو تالف: نبدأ من متجر فارغ
    return emptyStore();
  }
}

// حذف الجلسات المنتهية الصلاحية — يُستدعى مع كل قراءة/كتابة
function prune(store) {
  const now = Date.now();
  let changed = false;
  for (const k of KINDS) {
    for (const token of Object.keys(store[k])) {
      const rec = store[k][token];
      if (!rec || Number(rec.expiresAt || 0) <= now) {
        delete store[k][token];
        changed = true;
      }
    }
  }
  return changed;
}

// كتابة ذرّية: نكتب ملفاً مؤقتاً ثم نعيد تسميته حتى لا يتلف الملف عند انقطاع الكهرباء
function save(store) {
  try {
    fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
    const tmp = FILE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, FILE_PATH);
    return true;
  } catch (e) {
    console.warn('⚠️ تعذر حفظ الجلسات في sessions.json:', e.message);
    return false;
  }
}

/**
 * إنشاء جلسة جديدة وحفظها في ملف JSON.
 * @param {'user'|'admin'} kind نوع الجلسة
 * @param {object} data بيانات الجلسة (userId/nickname أو username/role ...)
 * @param {number} ttlMs مدة الصلاحية بالميلي ثانية
 * @returns {string} رمز الجلسة (token)
 */
function createSession(kind, data, ttlMs) {
  if (!KINDS.includes(kind)) throw new Error('نوع جلسة غير معروف: ' + kind);
  const store = load();
  prune(store);
  const token = (kind === 'admin' ? 'adm_' : 'usr_') + crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  const ttl = Math.max(60 * 1000, Number(ttlMs) || 0);
  store[kind][token] = Object.assign({}, data, {
    createdAt: now,
    expiresAt: now + ttl,
    ttlMs: ttl
  });

  // حد أقصى 10 جلسات لكل مستخدم (نُبقي الأحدث) حتى لا ينمو الملف بلا حدود
  if (kind === 'user' && data && data.userId) {
    const mine = Object.entries(store[kind])
      .filter(([, r]) => r && r.userId === data.userId)
      .sort((a, b) => Number(b[1].createdAt || 0) - Number(a[1].createdAt || 0));
    for (const [oldToken] of mine.slice(10)) delete store[kind][oldToken];
  }

  save(store);
  return token;
}

/**
 * قراءة جلسة: تُرجع السجل إذا كانت صالحة، وتجدّد الصلاحية تلقائياً
 * (تجديد منزلق: إذا تبقّى أقل من نصف المدة الأصلية).
 * @returns {object|null}
 */
function getSession(kind, token) {
  if (!KINDS.includes(kind) || !token || typeof token !== 'string') return null;
  const store = load();
  const changed = prune(store);
  const rec = store[kind][token];
  if (!rec || Number(rec.expiresAt || 0) <= Date.now()) {
    if (changed) save(store);
    return null;
  }
  // تجديد منزلق محدود الكتابة: نمدّد فقط عند اقتراب الانتهاء
  const ttl = Number(rec.ttlMs) || 0;
  if (ttl && Number(rec.expiresAt) - Date.now() < ttl / 2) {
    rec.expiresAt = Date.now() + ttl;
    save(store);
    return rec;
  }
  if (changed) save(store);
  return rec;
}

/**
 * حذف جلسة (تسجيل الخروج).
 */
function deleteSession(kind, token) {
  if (!KINDS.includes(kind) || !token) return false;
  const store = load();
  if (!store[kind][token]) return false;
  delete store[kind][token];
  save(store);
  return true;
}

/**
 * حذف كل جلسات مستخدم معين (مثلاً عند الحظر).
 */
function deleteUserSessions(userId) {
  if (!userId) return 0;
  const store = load();
  let n = 0;
  for (const [token, rec] of Object.entries(store.user)) {
    if (rec && rec.userId === userId) { delete store.user[token]; n++; }
  }
  if (n) save(store);
  return n;
}

module.exports = {
  createSession,
  getSession,
  deleteSession,
  deleteUserSessions,
  FILE_PATH
};
