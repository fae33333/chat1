'use strict';
/**
 * مزايا VIP (طبقة النبلاء) — مصدر الحقيقة الوحيد للسيرفر.
 *
 * كل ميزة تُفتح من مستوى معيّن وتبقى مفتوحة لما بعده (تراكمي):
 *   VIP1=7 · VIP2=9 · VIP3=13 · VIP4=15 · VIP5=17 · VIP6=23 (كل الميزات)
 * هذا الجدول مطابق لـ PF_VIP_GROUPS في الواجهة (public/js/app.js).
 *
 * وحدة نقية بدون اعتماد على قاعدة البيانات حتى يسهل اختبارها.
 */
const memberLevels = require('./member-levels');

const VIP_MAX = 6;

// [المفتاح, المجموعة, الاسم, أدنى مستوى VIP]
const VIP_PERKS = [
  // اظهر حالتك
  { key: 'frame',            group: 'status',   name: 'إطار فاخر',                  level: 1 },
  { key: 'noble_badge',      group: 'status',   name: 'شعار النبلاء',               level: 1 },
  { key: 'card_effect',      group: 'status',   name: 'مؤثر بطاقة التعريف',         level: 6 },
  { key: 'entry_vehicle',    group: 'status',   name: 'مركبة الدخول (النسر الملكي)', level: 4 },
  { key: 'custom_card',      group: 'status',   name: 'بطاقة تعريف خاصة',           level: 2 },
  { key: 'voice_wave',       group: 'status',   name: 'الموجة الصوتية',             level: 3 },
  { key: 'chat_bubble',      group: 'status',   name: 'فقاعة الدردشة',              level: 3 },
  // صلاحيات كبرى
  { key: 'kick_immunity',    group: 'power',    name: 'حصانة من الطرد',             level: 6 },
  { key: 'anti_tracking',    group: 'power',    name: 'منع التتبع',                 level: 6 },
  { key: 'report_priority',  group: 'power',    name: 'أولوية الإبلاغ',             level: 4 },
  { key: 'front_row',        group: 'power',    name: 'الصف الأمامي',               level: 1 },
  { key: 'mr_x_tables',      group: 'power',    name: 'Mr.X بالجداول',              level: 6 },
  { key: 'mr_x_rooms',       group: 'power',    name: 'Mr.X بالغرف',                level: 6 },
  // افتح المزيد من الميزات
  { key: 'noble_gifts',      group: 'features', name: 'هدايا النبلاء',              level: 1 },
  { key: 'change_avatar',    group: 'features', name: 'تغيير الصورة الشخصية',       level: 1 },
  { key: 'animated_avatar',  group: 'features', name: 'صورة شخصية متحركة',          level: 3 },
  { key: 'global_announce',  group: 'features', name: 'إطلاق إعلان عالمي',          level: 5 },
  { key: 'join_message',     group: 'features', name: 'رسالة الانضمام',             level: 1 },
  { key: 'vip_emojis',       group: 'features', name: 'رموز تعبيرية فاخرة',         level: 2 },
  // زيادة عدد المرات
  { key: 'super_likes',      group: 'limits',   name: 'زيادة الإعجابات الفائقة ×10', level: 3 },
  { key: 'match_priority',   group: 'limits',   name: 'أفضلية التوافق',             level: 6 },
  { key: 'voice_match',      group: 'limits',   name: 'التوافق الصوتي',             level: 5 },
  { key: 'daily_greetings',  group: 'limits',   name: 'محاولات التحيات اليومية (50)', level: 1 }
];

const PERK_BY_KEY = new Map(VIP_PERKS.map(p => [p.key, p]));
let overrides = {}; // تعديلات الإدارة: { key: level } — اختيارية

// ضبط تعديلات الإدارة (مفتاح → مستوى 1..VIP_MAX، أو 0/false لتعطيل الميزة تماماً)
function configure(map) {
  const next = {};
  if (map && typeof map === 'object') {
    for (const [k, v] of Object.entries(map)) {
      if (!PERK_BY_KEY.has(k)) continue;
      if (v === false || Number(v) === 0) { next[k] = Infinity; continue; }
      const n = Math.floor(Number(v));
      if (Number.isFinite(n) && n >= 1) next[k] = Math.min(VIP_MAX, n);
    }
  }
  overrides = next;
  return { ...overrides };
}

// أدنى مستوى VIP لميزة ما (Infinity إن عُطّلت أو كانت غير معروفة)
function perkLevel(key) {
  const p = PERK_BY_KEY.get(key);
  if (!p) return Infinity;
  return Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : p.level;
}

// مزايا مفتوحة لمستوى VIP معيّن (بدون النظر للاشتراك)
function perksForLevel(level) {
  const lv = Math.max(0, Math.floor(Number(level)) || 0);
  return VIP_PERKS.filter(p => lv >= perkLevel(p.key)).map(p => p.key);
}

// هل للعضو هذه الميزة الآن؟ — يعتمد على الاشتراك الفعّال (المنتهي = VIP0 = لا مزايا)
function hasPerk(user, key, now) {
  if (!user) return false;
  const lv = memberLevels.activeVipLevel(user, now);
  return lv > 0 && lv >= perkLevel(key);
}

// قائمة كاملة للواجهة: كل ميزة وهل هي مفتوحة لهذا العضو
function describe(user, now) {
  const lv = memberLevels.activeVipLevel(user, now);
  return VIP_PERKS.map(p => {
    const need = perkLevel(p.key);
    return { key: p.key, group: p.group, name: p.name, level: Number.isFinite(need) ? need : null, unlocked: lv > 0 && lv >= need };
  });
}

module.exports = { VIP_MAX, VIP_PERKS, configure, perkLevel, perksForLevel, hasPerk, describe };
