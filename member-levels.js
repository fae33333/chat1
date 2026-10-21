'use strict';
/**
 * نظام مستويات الأعضاء (الثروة / الرواج / VIP)
 * وحدة نقية بدون اعتماد على قاعدة البيانات حتى يسهل اختبارها.
 *
 *  - الثروة  (wealth)     : تزيد بحسب ما ينفقه العضو (إرسال هدايا، شراء VIP)
 *  - الرواج  (popularity) : تزيد بحسب قيمة الهدايا التي يستلمها العضو
 *  - VIP                  : اشتراك مدفوع له مدة، وينتهي تلقائياً بانتهاء المدة
 */

const MAX_LEVEL = 30;

// منحنى الخبرة — مطابق تماماً لـ PF_KEYS في public/js/app.js
const LEVEL_KEYS = [[1, 0], [2, 70], [5, 2160], [6, 4200], [10, 46200], [11, 67200], [15, 193200], [20, 700000], [25, 2000000], [30, 5000000]];

// عدد النقاط اللازم للوصول إلى مستوى n
function levelThreshold(n) {
  n = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(n)) || 1));
  if (n === 1) return 0;
  for (let i = 1; i < LEVEL_KEYS.length; i++) {
    const [a, va] = LEVEL_KEYS[i - 1];
    const [b, vb] = LEVEL_KEYS[i];
    if (n <= b) {
      const t = (n - a) / (b - a);
      return Math.round(va <= 0 ? vb * t : va * Math.pow(vb / va, t));
    }
  }
  return LEVEL_KEYS[LEVEL_KEYS.length - 1][1];
}

// تحويل النقاط إلى مستوى (1..30) مع تفاصيل التقدم نحو المستوى التالي
function levelFromPoints(points) {
  const p = Math.max(0, Math.floor(Number(points)) || 0);
  let level = 1;
  while (level < MAX_LEVEL && p >= levelThreshold(level + 1)) level++;
  const current = levelThreshold(level);
  const next = level >= MAX_LEVEL ? null : levelThreshold(level + 1);
  const progress = next === null ? 100 : Math.min(100, Math.round(((p - current) / Math.max(1, next - current)) * 100));
  return { level, points: p, current, next, remaining: next === null ? 0 : Math.max(0, next - p), progress };
}

// تحويل مبلغ (عملات أو ألماس) إلى نقاط
//  - الألماس: نقطة لكل ألماسة (افتراضياً)
//  - العملات: نقطة لكل 10 عملات (افتراضياً)
function pointsForAmount(amount, currency, settings) {
  const s = settings || {};
  const a = Math.max(0, Math.floor(Number(amount)) || 0);
  const per = currency === 'coins'
    ? Math.max(1, Number(s.coins_per_point) || 10)
    : Math.max(1, Number(s.diamonds_per_point) || 1);
  return Math.floor(a / per);
}

// مستوى الـVIP الفعّال الآن: يرجع 0 إذا انتهى الاشتراك
function activeVipLevel(user, now) {
  if (!user) return 0;
  const lvl = Math.max(0, Math.floor(Number(user.vip_level)) || 0);
  if (!lvl || !user.vip_until) return 0;
  const until = new Date(user.vip_until).getTime();
  const t = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.now());
  return Number.isFinite(until) && until > t ? lvl : 0;
}

// الأيام المتبقية في الاشتراك (تقريباً لأعلى)
function vipDaysLeft(user, now) {
  if (!activeVipLevel(user, now)) return 0;
  const t = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.now());
  return Math.max(0, Math.ceil((new Date(user.vip_until).getTime() - t) / 86400000));
}

// حساب تاريخ نهاية الاشتراك الجديد:
//  - نفس المستوى ومازال فعّالاً  → يُمدَّد من نهاية الاشتراك الحالي
//  - غير ذلك                     → يبدأ من الآن
function computeVipExpiry(user, level, days, now) {
  const t = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.now());
  const d = Math.max(1, Math.floor(Number(days)) || 30);
  const sameActive = activeVipLevel(user, t) === level;
  const base = sameActive ? new Date(user.vip_until).getTime() : t;
  return new Date(base + d * 86400000).toISOString();
}

// بطاقات العرض: الثروة Lv.3 — الرواج Lv.4 — VIP0
function buildCards(user, now) {
  const wealth = levelFromPoints(user && user.wealth_points);
  const pop = levelFromPoints(user && user.popularity_points);
  // الحسابات الخاصة (مثل المالك) قد يكون مستواها المخزن أعلى من 30
  const wl = Math.max(Number(user && user.wealth_level) || 0, 0);
  const cl = Math.max(Number(user && user.charm_level) || 0, 0);
  const vip = activeVipLevel(user, now);
  return {
    wealth: { ...wealth, level: wl > MAX_LEVEL ? wl : wealth.level, label: 'الثروة', text: `Lv.${wl > MAX_LEVEL ? wl : wealth.level}` },
    popularity: { ...pop, level: cl > MAX_LEVEL ? cl : pop.level, label: 'الرواج', text: `Lv.${cl > MAX_LEVEL ? cl : pop.level}` },
    vip: {
      level: vip, active: vip > 0, until: vip ? user.vip_until : null,
      days_left: vipDaysLeft(user, now), label: 'VIP', text: `VIP${vip}`
    }
  };
}

module.exports = {
  MAX_LEVEL, LEVEL_KEYS, levelThreshold, levelFromPoints, pointsForAmount,
  activeVipLevel, vipDaysLeft, computeVipExpiry, buildCards
};
