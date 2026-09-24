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

// =====================================================
//  توقيع حزم WebSocket (Packet Integrity Signing)
// =====================================================
// كل حدث في الاتجاهين (خادم→واجهة وواجهة→خادم) يُلحق به ظرف توقيع {$$sk}
// مشتق من MAC = SHA-256(مفتاح الجلسة + اسم الحدث + الختم الزمني + nonce +
// التمثيل القياسي للحمولة). أي حزمة أُضيف إليها حقل، أو عُدِّلت، أو لم تصدر
// عن الطرف الآخر الأصلي، لا ينجح تحققها فتُسقط قبل أي معالج.

// SHA-256 متزامن (يعمل في Node والمتصفح دون WebCrypto) — ثوابت قياسية.
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);
function sha256Bytes(message) {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const bitLen = message.length * 8;
  const paddedLen = (((message.length + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(paddedLen);
  buf.set(message, 0);
  buf[message.length] = 0x80;
  // طول الرسالة بالبت — 64 بت big-endian (الرسائل هنا دائماً أصغر من 2^53 بت)
  let hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
  for (let i = 0; i < 4; i++) buf[paddedLen - 8 + i] = (hi >>> ((3 - i) * 8)) & 255;
  for (let i = 0; i < 4; i++) buf[paddedLen - 4 + i] = (lo >>> ((3 - i) * 8)) & 255;
  const w = new Uint32Array(64);
  const rr = (v, n) => ((v >>> n) | (v << (32 - n))) >>> 0;
  for (let block = 0; block < paddedLen; block += 64) {
    for (let t = 0; t < 16; t++) {
      const o = block + t * 4;
      w[t] = ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t++) {
      const s0 = (rr(w[t - 15], 7) ^ rr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
      const s1 = (rr(w[t - 2], 17) ^ rr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const S1 = (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
      const S0 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H;
}
function sha256Hex(text) {
  const words = sha256Bytes(utf8ToBytes(String(text)));
  let out = '';
  for (let i = 0; i < 8; i++) out += words[i].toString(16).padStart(8, '0');
  return out;
}

// تمثيل قياسي للحمولة يطابق ما يعبر السلك فعلاً: المفاتيح مرتبة، undefined
// كما يعاملها JSON (حذف من الكائنات وnull في المصفوفات)، التواريخ ISO،
// والمرفقات الثنائية (Blob/Buffer/ArrayBuffer) تمثَّل ببصمة طولها فقط لأن
// محتواها يُرفق خارج حزمة JSON لكنه يبقى مقيَّداً ببصمة الطول من التغيير.
function isBinaryLike(v) {
  if (!v || typeof v !== 'object') return false;
  if (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer) return true;
  if (typeof ArrayBuffer !== 'undefined' && typeof ArrayBuffer.isView === 'function' && ArrayBuffer.isView(v)) return true;
  if (typeof Blob !== 'undefined' && v instanceof Blob) return true;
  if (typeof File !== 'undefined' && v instanceof File) return true;
  return false;
}
function normalizeForWire(v) {
  if (v === undefined || typeof v === 'function' || typeof v === 'symbol') return undefined;
  if (v === null) return null;
  const t = typeof v;
  if (t === 'number' || t === 'string' || t === 'boolean') return v;
  if (isBinaryLike(v)) return { '$$bin': (v.byteLength != null ? v.byteLength : (v.size != null ? v.size : 0)) >>> 0 };
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) {
    const arr = new Array(v.length);
    for (let i = 0; i < v.length; i++) {
      const item = normalizeForWire(v[i]);
      arr[i] = item === undefined ? null : item;
    }
    return arr;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) {
    try { return normalizeForWire(JSON.parse(JSON.stringify(v))); } catch (e) { return {}; }
  }
  const out = {};
  for (const k of Object.keys(v)) {
    const nv = normalizeForWire(v[k]);
    if (nv !== undefined) out[k] = nv;
  }
  return out;
}
function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const keys = Object.keys(v).sort();
    const out = {};
    for (const k of keys) out[k] = sortKeysDeep(v[k]);
    return out;
  }
  return v;
}
function canonicalJson(value) {
  try { return JSON.stringify(sortKeysDeep(normalizeForWire(value))); }
  catch (e) { return 'null'; }
}

const SK_FIELD = '$$sk';
const PACKET_SIGN_MAX_AGE_MS = 20 * 60 * 1000;
function packetMac(keyHex, event, stamp, nonce, canonicalPayload) {
  return sha256Hex(String(keyHex) + '::ws::' + String(event) + '\n' + stamp + '\n' + nonce + '\n' + canonicalPayload).slice(0, 40);
}
// يبني ظرف التوقيع الذي يُلحق كآخر وسيطة للحدث.
function signPacketEnvelope(keyHex, event, args) {
  const stamp = Date.now().toString(36);
  const nonce = bytesToHex(randomBytes(8));
  const mac = packetMac(keyHex, event, stamp, nonce, canonicalJson(args));
  return { [SK_FIELD]: stamp + '.' + nonce + '.' + mac };
}
// يفحص ظرف التوقيع مقابل (الحدث + الحمولة بدون عنصر التوقيع).
function verifyPacketSignature(keyHex, event, args, signature, maxAgeMs = PACKET_SIGN_MAX_AGE_MS) {
  try {
    const parts = String(signature || '').split('.');
    if (parts.length !== 3) return false;
    const stamp = parts[0], nonce = parts[1], mac = parts[2];
    if (!stamp || nonce.length !== 16 || mac.length !== 40) return false;
    const stampMs = parseInt(stamp, 36);
    if (!Number.isFinite(stampMs)) return false;
    if (maxAgeMs > 0 && Math.abs(Date.now() - stampMs) > maxAgeMs) return false;
    if (!/^[0-9a-f]+$/.test(nonce + mac)) return false;
    return packetMac(keyHex, event, stamp, nonce, canonicalJson(args)) === mac;
  } catch (e) { return false; }
}
// يستخرج التوقيع من آخر وسيطة إن وُجد: { signature, args } أو null إن لم يوقَّع.
function extractPacketSignature(args) {
  if (!Array.isArray(args) || !args.length) return null;
  const last = args[args.length - 1];
  if (!last || typeof last !== 'object' || Array.isArray(last)) return null;
  const sig = last[SK_FIELD];
  if (typeof sig !== 'string' || !sig) return null;
  if (Object.keys(last).length !== 1) return null; // كائن يحمل حقولاً أخرى = حمولة لا ظرف توقيع
  return { signature: sig, args: args.slice(0, args.length - 1) };
}

const CLOAK_API = {
  rc4, hexToBytes, bytesToHex,
  encodeCloakedPath, decodeCloakedPath,
  encodeCloakedValue, decodeCloakedValue,
  cloakBodyEnvelope, uncloakBodyEnvelope,
  sha256Hex, canonicalJson,
  signPacketEnvelope, verifyPacketSignature, extractPacketSignature,
  SK_FIELD, PACKET_SIGN_MAX_AGE_MS
};
if (typeof module !== 'undefined' && module.exports) module.exports = CLOAK_API;
if (typeof window !== 'undefined') window.NujumCloak = CLOAK_API;
