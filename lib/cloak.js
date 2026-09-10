// =====================================================
//  تعمية مسارات الـ API (API Path Cloaking)
// =====================================================
// كل طلب من الواجهة إلى /api/... يُرسل فعلياً إلى مسار مُعمّى مثل:
//   /s/9f3a1c...   ← داخله المسار الحقيقي مشفّراً
// الخادم يفك التعمية ويعيد كتابة الطلب داخلياً قبل وصوله إلى مسارات Express،
// فلا يظهر أي مسار API مقروء في شريط العنوان أو أدوات المطور أو سجلات البروكسي.
// الخوارزمية متزامنة (RC4 + مفتاح جلسة + Nonce عشوائي لكل طلب) حتى تعمل داخل
// XMLHttpRequest.open المتزامن في المتصفح تماماً كما تعمل في الخادم.

function rc4(keyBytes, dataBytes) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + keyBytes[i % keyBytes.length]) & 255;
    const t = s[i]; s[i] = s[j]; s[j] = t;
  }
  // تجاهل أول 768 بايت من مجرى المفتاح (RC4-drop) لتقوية المخرجات
  let i2 = 0, j2 = 0;
  for (let k = 0; k < 768; k++) {
    i2 = (i2 + 1) & 255;
    j2 = (j2 + s[i2]) & 255;
    const t = s[i2]; s[i2] = s[j2]; s[j2] = t;
  }
  const out = new Uint8Array(dataBytes.length);
  for (let k = 0; k < dataBytes.length; k++) {
    i2 = (i2 + 1) & 255;
    j2 = (j2 + s[i2]) & 255;
    const t = s[i2]; s[i2] = s[j2]; s[j2] = t;
    out[k] = dataBytes[k] ^ s[(s[i2] + s[j2]) & 255];
  }
  return out;
}

function hexToBytes(hex) {
  const clean = String(hex || '').replace(/[^0-9a-f]/gi, '');
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}
function utf8ToBytes(text) {
  const encoded = unescape(encodeURIComponent(String(text)));
  const out = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i++) out[i] = encoded.charCodeAt(i) & 255;
  return out;
}
function bytesToUtf8(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  try { return decodeURIComponent(escape(binary)); } catch (e) { return binary; }
}
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function bytesToB64url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
    if (b1 === undefined) break;
    out += B64URL[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
    if (b2 === undefined) break;
    out += B64URL[b2 & 63];
  }
  return out;
}
function b64urlToBytes(text) {
  const clean = String(text || '').replace(/[^A-Za-z0-9\-_]/g, '');
  const out = [];
  let buffer = 0, bits = 0;
  for (let i = 0; i < clean.length; i++) {
    buffer = (buffer << 6) | B64URL.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buffer >> bits) & 255); }
  }
  return new Uint8Array(out);
}

// nonce عشوائي (8 بايت) لكل طلب: نفس المسار يعطي رمزاً مختلفاً في كل مرة.
function randomBytes(length) {
  const out = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(out);
  else for (let i = 0; i < length; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

function encodeCloakedPath(keyHex, plainPath) {
  const key = hexToBytes(keyHex);
  const nonce = randomBytes(8);
  const composed = new Uint8Array(key.length + nonce.length);
  composed.set(key, 0); composed.set(nonce, key.length);
  // ختم زمني يمنع إعادة استخدام رابط مُعمّى قديم لأجل غير مسمى
  const payload = utf8ToBytes(Date.now().toString(36) + '|' + plainPath);
  const cipher = rc4(composed, payload);
  const packed = new Uint8Array(nonce.length + cipher.length);
  packed.set(nonce, 0); packed.set(cipher, nonce.length);
  return bytesToB64url(packed);
}

function decodeCloakedPath(keyHex, token, maxAgeMs = 10 * 60 * 1000) {
  try {
    const key = hexToBytes(keyHex);
    const packed = b64urlToBytes(token);
    if (packed.length <= 8) return '';
    const nonce = packed.subarray(0, 8);
    const cipher = packed.subarray(8);
    const composed = new Uint8Array(key.length + nonce.length);
    composed.set(key, 0); composed.set(nonce, key.length);
    const plain = bytesToUtf8(rc4(composed, cipher));
    const cut = plain.indexOf('|');
    if (cut < 1) return '';
    const stamp = parseInt(plain.slice(0, cut), 36);
    const target = plain.slice(cut + 1);
    if (!target.startsWith('/api/')) return '';
    if (!Number.isFinite(stamp)) return '';
    if (maxAgeMs > 0 && Math.abs(Date.now() - stamp) > maxAgeMs) return '';
    return target;
  } catch (e) { return ''; }
}

// =====================================================
//  تعمية القيم (Value Cloaking)
// =====================================================
// تشفّر أي قيمة نصية (رمز أمان، رابط، جسم JSON كامل...) بنفس آلية المسارات:
// nonce عشوائي + RC4، فتظهر في أدوات المطوّر وفي مصدر الصفحة كرموز غير مقروءة
// وتُفك في الجهة الأخرى شفافياً.
function encodeCloakedValue(keyHex, plainText) {
  const key = hexToBytes(keyHex);
  const nonce = randomBytes(8);
  const composed = new Uint8Array(key.length + nonce.length);
  composed.set(key, 0); composed.set(nonce, key.length);
  const payload = utf8ToBytes(Date.now().toString(36) + '|' + String(plainText));
  const cipher = rc4(composed, payload);
  const packed = new Uint8Array(nonce.length + cipher.length);
  packed.set(nonce, 0); packed.set(cipher, nonce.length);
  return bytesToB64url(packed);
}

// maxAgeMs = 0 يعني بلا انتهاء (مناسب للقيم المضمّنة في الصفحات؛ صلاحية الرمز
// نفسه تُدار في الخادم لا في طبقة التعمية).
function decodeCloakedValue(keyHex, token, maxAgeMs = 0) {
  try {
    const key = hexToBytes(keyHex);
    const packed = b64urlToBytes(token);
    if (packed.length <= 8) return '';
    const nonce = packed.subarray(0, 8);
    const cipher = packed.subarray(8);
    const composed = new Uint8Array(key.length + nonce.length);
    composed.set(key, 0); composed.set(nonce, key.length);
    const plain = bytesToUtf8(rc4(composed, cipher));
    const cut = plain.indexOf('|');
    if (cut < 1) return '';
    const stamp = parseInt(plain.slice(0, cut), 36);
    if (!Number.isFinite(stamp)) return '';
    if (maxAgeMs > 0 && Math.abs(Date.now() - stamp) > maxAgeMs) return '';
    return plain.slice(cut + 1);
  } catch (e) { return ''; }
}

// =====================================================
//  تعمية جسم الاستجابة (Response Body Cloaking)
// =====================================================
// الخادم يرسل الجسم كغلاف JSON صغير: {"_nv":"<بيانات مشفّرة>"} بدلاً من
// {ok:true, admin_token:"..."}، والواجهة تفكّه قبل أن يراه أي كود تطبيقي.
// العلم [J]/[T] يحفظ نوع الجسم الأصلي حتى تعمل r.json() وresponseText بلا تغيير.
const BODY_ENVELOPE_KEY = '_nv';
const BODY_FLAG_JSON = '[J]';
const BODY_FLAG_TEXT = '[T]';

function cloakBodyEnvelope(keyHex, bodyText, isJson) {
  const flag = isJson ? BODY_FLAG_JSON : BODY_FLAG_TEXT;
  return JSON.stringify({ [BODY_ENVELOPE_KEY]: encodeCloakedValue(keyHex, flag + String(bodyText)) });
}

// يعيد { isJson, text } إن كان النص غلافاً مُعمّى، و null إن لم يكن كذلك
// (فتمُر الاستجابة كما هي دون أي لمس).
function uncloakBodyEnvelope(keyHex, bodyText) {
  try {
    const parsed = JSON.parse(String(bodyText));
    if (!parsed || typeof parsed !== 'object' || parsed === null) return null;
    const packed = parsed[BODY_ENVELOPE_KEY];
    if (typeof packed !== 'string' || !packed) return null;
    const plain = decodeCloakedValue(keyHex, packed);
    if (plain.length < 3) return null;
    const flag = plain.slice(0, 3);
    if (flag !== BODY_FLAG_JSON && flag !== BODY_FLAG_TEXT) return null;
    return { isJson: flag === BODY_FLAG_JSON, text: plain.slice(3) };
  } catch (e) { return null; }
}

const CLOAK_API = {
  rc4, hexToBytes, bytesToHex,
  encodeCloakedPath, decodeCloakedPath,
  encodeCloakedValue, decodeCloakedValue,
  cloakBodyEnvelope, uncloakBodyEnvelope
};
if (typeof module !== 'undefined' && module.exports) module.exports = CLOAK_API;
if (typeof window !== 'undefined') window.NujumCloak = CLOAK_API;
