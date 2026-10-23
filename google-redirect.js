// ============================================================
// محرك عناوين العودة (redirect_uri) لتسجيل الدخول عبر Google
// يعالج الخطأ الشائع: 400 redirect_uri_mismatch
//
// القاعدة الذهبية عند Google: العنوان المُرسل في طلب OAuth
// يجب أن يطابق أحد العناوين المسجّلة في
// Google Console ← Credentials ← Authorized redirect URIs
// **حرفياً وبوحدة الحروف** (بروتوكول + نطاق + منفذ + مسار).
//
// لذلك:
//  1) نطبّع كل عنوان مُهيّأ (نحذف مسافات وشرطة مائلة نهائية،
//     ونوحّد الحالة عبر URL) لتجنّب فروق الطرفاء المؤسفة.
//  2) ندعم **عدة عناوين معاً** (Google يسمح بقائمة عناوين لكل تطبيق)
//     فيختار التطبيق العنوان المطابق لعنوان الزيارة الحالية،
//     فتعمل الروابط المحلية http://IP:3000 والموقع الرسمي معاً.
//  3) عند غياب أي إعداد نشتق العنوان من الطلب الحالي
//     (مع دعم البروكسي: x-forwarded-proto / x-forwarded-host).
//  4) العنوان الذي بدأ به الرحلة يُحفظ مع الـ state ويُعاد استخدامه
//     حرفياً عند تبادل الرمز — فلا يحدث خلل بين الخطوتين.
// ============================================================
'use strict';

const CALLBACK_PATH = '/api/auth/google/callback';

// تطبيع عنوان عودة واحد → '' إذا لم يكن صالحاً
function normalizeRedirectUri(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  let url;
  try { url = new URL(s); } catch (e) { return ''; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  if (url.username || url.password || url.search || url.hash) return '';
  const pathname = url.pathname.replace(/\/+$/, ''); // إزالة الشرطة المائلة النهائية
  if (pathname !== CALLBACK_PATH) return '';
  // url.origin يوحّد حالة النطاق ويلغي المنافذ الافتراضية (:443 / :80)
  return url.origin + CALLBACK_PATH;
}

// قراءة قائمة عناوين من نص (يُفصل بسطر جديد أو فاصلة أو فاصلة منقوطة)
// ويتخطى غير الصالح مع إزالة التكرار مع الحفاظ على الترتيب
function parseRedirectList(raw) {
  const out = [];
  const seen = new Set();
  for (const part of String(raw == null ? '' : raw).split(/[\r\n,;]+/)) {
    const u = normalizeRedirectUri(part);
    if (u && !seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}

// المنظور العام للموقع كما يراه المتصفح (يدعم البروكسي/баланс الحمل)
function requestOrigin(req) {
  const headers = (req && req.headers) || {};
  const first = (v) => String(v == null ? '' : v).split(',')[0].trim().toLowerCase();

  let proto = first(headers['x-forwarded-proto']);
  if (proto !== 'http' && proto !== 'https') {
    proto = String((req && req.protocol) || '').toLowerCase();
    if (proto !== 'http' && proto !== 'https') proto = req && req.secure ? 'https' : 'http';
  }

  const host = first(headers['x-forwarded-host'] || headers['x-forwarded-server'] || headers.host);
  // رفض أي مضيف يحتوي مسافات أو مسارات (حقن ترويسات غير متوقعة)
  if (!host || /[\s/\\@]/.test(host)) return '';
  return `${proto}://${host}`;
}

// العنوان المشتق من الطلب الحالي
function derivedRedirectUri(req) {
  const origin = requestOrigin(req);
  return origin ? origin + CALLBACK_PATH : '';
}

// اختيار العنوان الذي سيُرسل إلى Google الآن:
//  1) عنوان مُهيّأ يطابق عنوان الزيارة الحالية تماماً → (نفس الموقع، الأفضل)
//  2) أي عنوان مُهيّأ من لوحة الإدارة / .env (عادةً هو المسجّل في Console)
//  3) اشتقاق من الطلب الحالي عند عدم وجود أي إعداد
function pickRedirectUri(req, cfg) {
  const list = Array.isArray(cfg && cfg.redirectUris)
    ? cfg.redirectUris.map(normalizeRedirectUri).filter(Boolean)
    : [];
  const derived = derivedRedirectUri(req);
  if (derived && list.indexOf(derived) !== -1) return derived;
  if (list.length) return list[0];
  return derived;
}

module.exports = {
  CALLBACK_PATH,
  normalizeRedirectUri,
  parseRedirectList,
  requestOrigin,
  derivedRedirectUri,
  pickRedirectUri
};
