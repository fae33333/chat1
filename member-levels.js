'use strict';
/**
 * النظام الشامل للمستويات والرتب والهدايا في SoulChill
 * وحدة نقية (Pure Module) مشتركة بين الخادم والاختبارات والواجهة:
 *
 *  1) مستويات الثراء (Wealth Levels 1..60 — تشمل المستويات الملكية I..X من 51 إلى 60)
 *  2) مستويات السحر / الجاذبية (Charm Levels 1..60 — شارات + تعزيز الظهور + هدايا VIP حصرية)
 *  3) نظام رتب النبلاء والأرستقراطية (Aristocracy Ranks 1..7: الكونت Viscount ← السلطان Sultan)
 *  4) نظام مستويات الغرف والعائلات (Room & Family Levels 1..20 — زيادة السعة + أكياس الحظ + مضاعف 2x XP)
 */

const MAX_LEVEL = 60;

// منحنى الخبرة: النقاط من 1 إلى 30 مطابقة تماماً للمنحنى الأصلي، وتمتد بسلاسة للمستويات المتقدمة (31..50) والملكية (51..60)
const LEVEL_KEYS = [
  [1, 0],
  [2, 70],
  [5, 2160],
  [6, 4200],
  [10, 46200],
  [11, 67200],
  [15, 193200],
  [20, 700000],
  [25, 2000000],
  [30, 5000000],
  [35, 9000000],
  [40, 16000000],
  [45, 26000000],
  [50, 40000000],
  [55, 62000000],
  [60, 90000000]
];

const ROMAN_NUMERALS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

function toRoman(n) {
  const idx = Math.max(1, Math.min(10, Math.floor(Number(n)) || 1));
  return ROMAN_NUMERALS[idx] || String(idx);
}

// تحويل رقم المستوى (1..60+) إلى نص عرض (مثال: Lv.24 أو الملكي IV لمستوى 54)
function royalIndexFromLevel(level) {
  const lv = Math.max(1, Math.floor(Number(level)) || 1);
  if (lv <= 50) return 0;
  return Math.min(10, lv - 50);
}

function formatWealthBadgeText(level) {
  const lv = Math.max(1, Math.floor(Number(level)) || 1);
  const r = royalIndexFromLevel(lv);
  return r > 0 ? `الملكي ${toRoman(r)}` : `Lv.${lv}`;
}

function formatCharmBadgeText(level) {
  const lv = Math.max(1, Math.floor(Number(level)) || 1);
  const r = royalIndexFromLevel(lv);
  return r > 0 ? `سحر ${toRoman(r)}` : `Lv.${lv}`;
}

// عدد النقاط اللازم للوصول إلى مستوى n (1..60)
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

// تحويل النقاط إلى مستوى (1..60) مع تفاصيل التقدم نحو المستوى التالي
function levelFromPoints(points) {
  const p = Math.max(0, Math.floor(Number(points)) || 0);
  let level = 1;
  while (level < MAX_LEVEL && p >= levelThreshold(level + 1)) level++;
  const current = levelThreshold(level);
  const next = level >= MAX_LEVEL ? null : levelThreshold(level + 1);
  const progress = next === null ? 100 : Math.min(100, Math.round(((p - current) / Math.max(1, next - current)) * 100));
  return {
    level,
    royal_rank: royalIndexFromLevel(level),
    roman: royalIndexFromLevel(level) ? toRoman(royalIndexFromLevel(level)) : null,
    points: p,
    current,
    next,
    remaining: next === null ? 0 : Math.max(0, next - p),
    progress
  };
}

// تحويل مبلغ (عملات أو ألماس/بلورات) إلى نقاط
function pointsForAmount(amount, currency, settings) {
  const s = settings || {};
  const a = Math.max(0, Math.floor(Number(amount)) || 0);
  const per = currency === 'coins'
    ? Math.max(1, Number(s.coins_per_point) || 10)
    : Math.max(1, Number(s.diamonds_per_point) || 1);
  return Math.floor(a / per);
}

// ═══════════════════════════════════════════════════════════════════════
// 1) نظام مستويات الثراء (Wealth Levels 1..60)
// ═══════════════════════════════════════════════════════════════════════
const WEALTH_TIERS = [
  {
    key: 'beginner',
    min: 1,
    max: 10,
    name: 'المستويات المبتدئة',
    range_label: 'Level 1 - 10',
    badge_icon: '💎',
    badge_class: 'wealth-tier-green',
    name_class: 'wealth-name-beginner',
    frame_id: '',
    frame_name: 'شارة المستوى المبتدئ',
    entry_effect_url: '',
    entry_effect_name: '',
    can_moderate_lower: false,
    has_tail_lights: false,
    has_immunity: false,
    perks: [
      'شارة مستوى خضراء أنيقة بجانب اسمك في غرف الدردشة',
      'تلوين خفيف مميز للاسم داخل رسائل الغرفة',
      'حزم هدايا ترحيبية مجانية عند الترقية'
    ]
  },
  {
    key: 'intermediate_bronze',
    min: 11,
    max: 20,
    name: 'المستويات المتوسطة · البرونزية',
    range_label: 'Level 11 - 20',
    badge_icon: '🥉',
    badge_class: 'wealth-tier-cyan',
    name_class: 'wealth-name-mid',
    frame_id: 'wealth_bronze',
    frame_name: 'إطار الثراء البرونزي',
    entry_effect_url: '/img/pf/fx_princess.png',
    entry_effect_name: 'تأثير دخول متوهج كلاسيكي',
    can_moderate_lower: false,
    has_tail_lights: false,
    has_immunity: false,
    perks: [
      'فتح إطار الحساب البرونزي (Bronze Avatar Frame)',
      'تأثير دخول بسيط وجذاب عند دخول أي غرفة دردشة',
      'تلوين سماوي-برونزي للاسم وحزم هدايا مجانية'
    ]
  },
  {
    key: 'intermediate_silver',
    min: 21,
    max: 30,
    name: 'المستويات المتوسطة · الفضية',
    range_label: 'Level 21 - 30',
    badge_icon: '🥈',
    badge_class: 'wealth-tier-cyan',
    name_class: 'wealth-name-silver',
    frame_id: 'wealth_silver',
    frame_name: 'إطار الثراء الفضي اللامع',
    entry_effect_url: '/img/pf/fx_knight.png',
    entry_effect_name: 'تأثير دخول الفارس الفضي',
    can_moderate_lower: false,
    has_tail_lights: false,
    has_immunity: false,
    perks: [
      'فتح إطار الحساب الفضي المصقول (Silver Avatar Frame)',
      'تأثير دخول فضي أنيق عند دخول الغرف الصوتية',
      'صندوق بلورات وهدايا مجانية'
    ]
  },
  {
    key: 'advanced_gold',
    min: 31,
    max: 40,
    name: 'المستويات المتقدمة · الذهبية',
    range_label: 'Level 31 - 40',
    badge_icon: '🏎️',
    badge_class: 'wealth-tier-gold',
    name_class: 'wealth-name-gold',
    frame_id: 'wealth_gold',
    frame_name: 'إطار الثراء الذهبي الملكي',
    entry_effect_url: '/img/pf/fx_car.png',
    entry_effect_name: 'دخول السيارة الرياضية الفاخرة',
    can_moderate_lower: true,
    has_tail_lights: false,
    has_immunity: false,
    perks: [
      'فتح إطار الحساب الذهبي الفاخر (Gold Avatar Frame)',
      'تأثير دخول فخم بسيارة رياضية تظهر عند دخولك الغرفة',
      'صلاحية كتم أو طرد المستخدمين ذوي المستويات الأقل في الغرف العامة'
    ]
  },
  {
    key: 'advanced_anim',
    min: 41,
    max: 50,
    name: 'المستويات المتقدمة · النخبة المتحركة',
    range_label: 'Level 41 - 50',
    badge_icon: '✈️',
    badge_class: 'wealth-tier-gold',
    name_class: 'wealth-name-gold',
    frame_id: 'wealth_gold_anim',
    frame_name: 'الإطار الذهبي المتحرك الناري',
    entry_effect_url: '/img/pf/fx_plane.png',
    entry_effect_name: 'دخول الطائرة الخاصة الفاخرة',
    can_moderate_lower: true,
    has_tail_lights: false,
    has_immunity: false,
    perks: [
      'إطار حساب ذهبي متحرك متوهج (Animated Gold Frame)',
      'تأثير دخول فخم بطائرة خاصة تحلّق فوق الغرفة',
      'صلاحية كتم أو طرد ذوي المستويات الأقل في الغرف العامة'
    ]
  },
  {
    key: 'royal_tycoon',
    min: 51,
    max: 999,
    name: 'مستويات الملوك والـ Tycoons (Royal I - X)',
    range_label: 'Level 51 - 60 (الملكي I - X)',
    badge_icon: '👑',
    badge_class: 'wealth-tier-imperial',
    name_class: 'wealth-name-royal',
    frame_id: 'wealth_royal_tycoon',
    frame_name: 'إطار العرش الملكي المرصّع',
    entry_effect_url: '/royal_eagle.gif',
    entry_effect_name: 'موكب النسر الملكي الملحمي (يهز شاشة الغرفة)',
    can_moderate_lower: true,
    has_tail_lights: true,
    has_immunity: true,
    perks: [
      'شارات ملكية مرصعة بالأرقام الرومانية (Royal I حتى Royal X)',
      'تأثير دخول ملحمي يقلب ويهز شاشة الغرفة بالكامل',
      'ميزة «أضواء الذيل» (Tail Lights) المتوهجة خلف رسائلك في الغرفة',
      'حصانة كاملة ضد الطرد أو الكتم من المستخدمين الآخرين ومشرفي الغرف'
    ]
  }
];

// مكافآت وهدايا المراحل لمستويات الثراء (تُستلم فعلياً من المستخدم!)
const WEALTH_MILESTONES = [
  { level: 1, title: 'بداية رحلة الثراء', coins: 200, diamonds: 0, gift_id: 'rose', gift_name: 'وردة الجوري 🌹', gift_qty: 2, unlock: 'شارة المستوى المبتدئ + تلوين الاسم' },
  { level: 5, title: 'متألق الغرف', coins: 500, diamonds: 15, gift_id: 'heart', gift_name: 'قلب مشع 💖', gift_qty: 2, unlock: 'بريق إضافي لشارة الثراء' },
  { level: 10, title: 'نجم المبتدئين', coins: 1000, diamonds: 40, gift_id: 'magic_wand', gift_name: 'عصا سحرية 🪄', gift_qty: 2, unlock: 'إتمام المرحلة المبتدئة كاملة' },
  { level: 11, title: 'الطبقة البرونزية', coins: 1500, diamonds: 60, gift_id: 'magic_wand', gift_name: 'عصا سحرية 🪄', gift_qty: 3, frame_id: 'wealth_bronze', unlock: 'إطار الحساب البرونزي + تأثير دخول بسيط' },
  { level: 21, title: 'الطبقة الفضية', coins: 3500, diamonds: 150, gift_id: 'diamond_ring', gift_name: 'خاتم ألماس 💍', gift_qty: 2, frame_id: 'wealth_silver', unlock: 'إطار الحساب الفضي + تأثير الفارس الفضي' },
  { level: 31, title: 'النخبة الذهبية', coins: 8000, diamonds: 350, gift_id: 'sports_car', gift_name: 'سيارة سوبر سبورت 🏎️', gift_qty: 1, frame_id: 'wealth_gold', entry_id: 'lvl_fx_car', unlock: 'إطار ذهبي + دخول السيارة الرياضية + صلاحية الكتم/الطرد في الغرف العامة' },
  { level: 41, title: 'النخبة المتحركة', coins: 18000, diamonds: 800, gift_id: 'rocket', gift_name: 'صاروخ المجرة 🚀', gift_qty: 1, frame_id: 'wealth_gold_anim', entry_id: 'lvl_fx_plane', unlock: 'إطار ذهبي متحرك + دخول الطائرة الفاخرة' },
  { level: 51, title: 'الملك Tycoon I', coins: 40000, diamonds: 2000, gift_id: 'crown', gift_name: 'تاج الملك الإمبراطوري 👑', gift_qty: 1, frame_id: 'wealth_royal_tycoon', entry_id: 'lvl_fx_royal', unlock: 'شارة الملكي I الرومانية + أضواء الذيل + حصانة كاملة + دخول يهز الغرفة' },
  { level: 55, title: 'الملك Tycoon V', coins: 75000, diamonds: 4000, gift_id: 'crown', gift_name: 'تاج الملك الإمبراطوري 👑', gift_qty: 2, unlock: 'شارة الملكي V المرصعة بالألماس' },
  { level: 60, title: 'الإمبراطور الملكي X', coins: 150000, diamonds: 10000, gift_id: 'castle', gift_name: 'قصر الأحلام 🏰', gift_qty: 2, unlock: 'القمة الأسطورية Royal X + قصر الأحلام' }
];

function wealthTierForLevel(level) {
  const lv = Math.max(1, Math.floor(Number(level)) || 1);
  return WEALTH_TIERS.find(t => lv >= t.min && lv <= t.max) || WEALTH_TIERS[0];
}

// ═══════════════════════════════════════════════════════════════════════
// 2) نظام مستويات السحر / الجاذبية (Charm Levels 1..60)
// ═══════════════════════════════════════════════════════════════════════
const CHARM_TIERS = [
  {
    key: 'charm_pink',
    min: 1,
    max: 15,
    name: 'سحر البدايات الوردي',
    range_label: 'Level 1 - 15',
    badge_icon: '🌸',
    badge_class: 'charm-tier-pink',
    exposure_pct: 20,
    vip_box_tier: 1,
    perks: [
      'شارة جاذبية وردية رقيقة تثبت حضورك',
      'تعزيز ظهور غرفتك في قائمة الاستكشاف بنسبة +20%',
      'فتح استلام هدايا السحر الترحيبية'
    ]
  },
  {
    key: 'charm_purple',
    min: 16,
    max: 30,
    name: 'السحر البنفسجي المتألق',
    range_label: 'Level 16 - 30',
    badge_icon: '💜',
    badge_class: 'charm-tier-purple',
    exposure_pct: 65,
    vip_box_tier: 2,
    perks: [
      'شارة جاذبية بنفسجية لامعة بجانب اسمك',
      'رفع أولوية ظهور غرفتك في الاستكشاف والمقترحات بنسبة +65%',
      'فتح استلام صناديق وهدايا VIP الساحرة ذات المؤثرات البصرية'
    ]
  },
  {
    key: 'charm_magenta',
    min: 31,
    max: 50,
    name: 'سحر النجوم الماسي',
    range_label: 'Level 31 - 50',
    badge_icon: '💖',
    badge_class: 'charm-tier-magenta',
    exposure_pct: 150,
    vip_box_tier: 3,
    perks: [
      'شارة جاذبية فوشيا متوهجة للنجمات والمضيفين الكبار',
      'تصدر قائمة المقترحات بتعزيز ظهور +150%',
      'فتح استلام تيجان ومواكب VIP الحصرية الضخمة'
    ]
  },
  {
    key: 'charm_royal',
    min: 51,
    max: 999,
    name: 'الأسطورة الساحرة الملكية (Charm I - X)',
    range_label: 'Level 51 - 60 (سحر I - X)',
    badge_icon: '✨',
    badge_class: 'charm-tier-royal',
    exposure_pct: 300,
    vip_box_tier: 4,
    perks: [
      'شارة السحر الملكي بالترقيم الروماني (سحر I حتى سحر X)',
      'أعلى أولوية تصدّر في صفحة الاستكشاف (+300% Exposure)',
      'فتح كافة صناديق وهدايا الـ VIP الأسطورية العملاقة'
    ]
  }
];

const CHARM_MILESTONES = [
  { level: 1, title: 'نجمة صاعدة', coins: 200, diamonds: 0, gift_id: 'rose', gift_name: 'وردة الجوري 🌹', gift_qty: 2, unlock: 'شارة الجاذبية الوردية + تعزيز ظهور أولي' },
  { level: 10, title: 'صندوق السحر الأول', coins: 1200, diamonds: 50, gift_id: 'star', gift_name: 'نجمة المشاهير 🌟', gift_qty: 1, unlock: 'فتح استلام هدية «صندوق الجاذبية الماسي VIP»' },
  { level: 16, title: 'السحر البنفسجي', coins: 2500, diamonds: 100, gift_id: 'golden_mic', gift_name: 'ميكروفون ذهبي 🎤', gift_qty: 1, unlock: 'شارة الجاذبية البنفسجية + ظهور +65% في الاستكشاف' },
  { level: 20, title: 'تاج السحر VIP', coins: 4500, diamonds: 200, gift_id: 'clapper', gift_name: 'كلاكيت 🎬', gift_qty: 1, unlock: 'فتح استلام هدية «تاج السحر البنفسجي VIP»' },
  { level: 31, title: 'سحر المشاهير', coins: 10000, diamonds: 500, gift_id: 'sports_car', gift_name: 'سيارة سوبر سبورت 🏎️', gift_qty: 1, unlock: 'شارة فوشيا متوهجة + ظهور +150% + «موكب المجرة الساحر VIP»' },
  { level: 51, title: 'أسطورة الجاذبية I', coins: 35000, diamonds: 1800, gift_id: 'crown', gift_name: 'تاج الملك الإمبراطوري 👑', gift_qty: 1, unlock: 'شارة سحر I الرومانية + تصدر الاستكشاف +300%' },
  { level: 60, title: 'ملكة السحر الأعلى X', coins: 120000, diamonds: 8000, gift_id: 'castle', gift_name: 'قصر الأحلام 🏰', gift_qty: 1, unlock: 'شارة سحر X الأبدية + أعلى فخامة في المنصة' }
];

function charmTierForLevel(level) {
  const lv = Math.max(1, Math.floor(Number(level)) || 1);
  return CHARM_TIERS.find(t => lv >= t.min && lv <= t.max) || CHARM_TIERS[0];
}

// نسبة تعزيز الظهور (Exposure %) في قائمة الاستكشاف حسب مستوى جاذبية المضيف
function charmExposureBoost(charmLevel) {
  const lv = Math.max(1, Math.floor(Number(charmLevel)) || 1);
  if (lv >= 51) return 220 + Math.min(10, lv - 50) * 8; // 228% .. 300%
  if (lv >= 31) return 115 + Math.round((lv - 30) * 4.2); // 119% .. 199%
  if (lv >= 16) return 50 + (lv - 15) * 4;               // 54% .. 110%
  return Math.max(10, lv * 3);                           // 10% .. 45%
}

// ═══════════════════════════════════════════════════════════════════════
// 3) نظام رتب النبلاء والأرستقراطية (Aristocracy System: Viscount → Sultan)
// ═══════════════════════════════════════════════════════════════════════
const NOBILITY_RANKS = [
  {
    level: 1,
    key: 'viscount',
    title_ar: 'الفيكونت',
    title_en: 'Viscount',
    full_name: 'الفيكونت (Viscount)',
    icon: '🎖️',
    color: '#38bdf8',
    default_price: 300,
    duration_days: 30,
    bonus_coins: 500,
    free_gifts: [{ gift_id: 'rose', name: 'وردة الجوري 🌹', qty: 3 }],
    mount_url: '/img/pf/fx_princess.png',
    mount_name: 'موكب الفيكونت اللامع',
    frame_id: 'noble_viscount',
    anti_track: false,
    stealth_entry: false,
    immunity: false,
    tail_lights: false,
    perks: ['شارة النبلاء «الفيكونت»', '+500 عملة هدايا فورية', '3 ورود مجانية في حقيبتك', 'موكب دخول الفيكونت']
  },
  {
    level: 2,
    key: 'count',
    title_ar: 'الكونت',
    title_en: 'Count',
    full_name: 'الكونت (Count)',
    icon: '🛡️',
    color: '#60a5fa',
    default_price: 800,
    duration_days: 30,
    bonus_coins: 1500,
    free_gifts: [{ gift_id: 'heart', name: 'قلب مشع 💖', qty: 5 }],
    mount_url: '/img/pf/fx_knight.png',
    mount_name: 'عربة الكونت الفضية',
    frame_id: 'noble_count',
    anti_track: false,
    stealth_entry: false,
    immunity: false,
    tail_lights: false,
    perks: ['شارة «الكونت» الفضية', '+1,500 عملة هدايا فورية', '5 قلوب مشعة مجانية', 'مركبة عربة الكونت + أولوية المايك']
  },
  {
    level: 3,
    key: 'marquis',
    title_ar: 'الماركيز',
    title_en: 'Marquis',
    full_name: 'الماركيز (Marquis)',
    icon: '⚔️',
    color: '#a855f7',
    default_price: 1500,
    duration_days: 30,
    bonus_coins: 3500,
    free_gifts: [{ gift_id: 'magic_wand', name: 'عصا سحرية 🪄', qty: 5 }],
    mount_url: '/img/pf/fx_knight.png',
    mount_name: 'فارس الماركيز المدرّع',
    frame_id: 'noble_marquis',
    anti_track: true,
    stealth_entry: false,
    immunity: false,
    tail_lights: false,
    perks: ['شارة «الماركيز» البنفسجية', '+3,500 عملة هدايا فورية', '5 عصي سحرية مجانية', 'مركبة الفارس المدرّع', '🛡️ منع تتبع مكانك وزياراتك']
  },
  {
    level: 4,
    key: 'duke',
    title_ar: 'الدوق',
    title_en: 'Duke',
    full_name: 'الدوق (Duke)',
    icon: '⚜️',
    color: '#ec4899',
    default_price: 3000,
    duration_days: 30,
    bonus_coins: 8000,
    free_gifts: [{ gift_id: 'diamond_ring', name: 'خاتم ألماس 💍', qty: 3 }],
    mount_url: '/img/pf/fx_car.png',
    mount_name: 'سيارة الدوق الرياضية الخارقة',
    frame_id: 'noble_duke',
    anti_track: true,
    stealth_entry: true,
    immunity: false,
    tail_lights: false,
    perks: ['شارة «الدوق» المرموقة', '+8,000 عملة هدايا فورية', '3 خواتم ألماس مجانية', 'مركبة سيارة الدوق الرياضية', '🕵️ إخفاء وجودك في الغرف + منع التتبع']
  },
  {
    level: 5,
    key: 'prince',
    title_ar: 'الأمير',
    title_en: 'Prince',
    full_name: 'الأمير (Prince)',
    icon: '💎',
    color: '#f59e0b',
    default_price: 6000,
    duration_days: 30,
    bonus_coins: 18000,
    free_gifts: [{ gift_id: 'sports_car', name: 'سيارة سوبر سبورت 🏎️', qty: 2 }],
    mount_url: '/img/pf/fx_plane.png',
    mount_name: 'طائرة الأمير الملكية',
    frame_id: 'noble_prince',
    anti_track: true,
    stealth_entry: true,
    immunity: true,
    tail_lights: false,
    perks: ['شارة «الأمير» الذهبية', '+18,000 عملة هدايا فورية', 'سيارتا سوبر سبورت مجاناً للتوزيع', 'طائرة الأمير الخاصة', '🛡️ حصانة ضد الطرد والكتم + إخفاء الوجود']
  },
  {
    level: 6,
    key: 'king',
    title_ar: 'الملك',
    title_en: 'King',
    full_name: 'الملك (King)',
    icon: '👑',
    color: '#ef4444',
    default_price: 12000,
    duration_days: 30,
    bonus_coins: 40000,
    free_gifts: [{ gift_id: 'crown', name: 'تاج الملك الإمبراطوري 👑', qty: 2 }],
    mount_url: '/royal_eagle.gif',
    mount_name: 'النسر الإمبراطوري الذهبي',
    frame_id: 'noble_king',
    anti_track: true,
    stealth_entry: true,
    immunity: true,
    tail_lights: true,
    perks: ['شارة «الملك» المتوهجة', '+40,000 عملة هدايا فورية', 'تاجان ملكيان مجاناً للتوزيع', 'مركبة النسر الإمبراطوري', 'أضواء ذيل للرسائل + حصانة وتخفٍّ كامل']
  },
  {
    level: 7,
    key: 'sultan',
    title_ar: 'السلطان',
    title_en: 'Sultan',
    full_name: 'السلطان (Sultan)',
    icon: '🕌👑',
    color: '#fbbf24',
    default_price: 25000,
    duration_days: 30,
    bonus_coins: 100000,
    free_gifts: [
      { gift_id: 'castle', name: 'قصر الأحلام 🏰', qty: 1 },
      { gift_id: 'rocket', name: 'صاروخ المجرة 🚀', qty: 3 }
    ],
    mount_url: '/royal_eagle.gif',
    mount_name: 'عرش السلطان الأسطوري الملحمي',
    frame_id: 'noble_sultan',
    anti_track: true,
    stealth_entry: true,
    immunity: true,
    tail_lights: true,
    perks: ['أعلى رتبة أرستقراطية: «السلطان»', '+100,000 عملة هدايا فورية', 'قصر الأحلام + 3 صواريخ مجاناً للتوزيع', 'عرش السلطان الذي يقلب شاشة الغرفة', 'حصانة سلطانية مطلقة + تخفٍّ ومنع تتبع شامل']
  }
];

function nobilityRankInfo(level) {
  const lv = Math.max(0, Math.floor(Number(level)) || 0);
  if (!lv) return null;
  return NOBILITY_RANKS.find(r => r.level === lv) || NOBILITY_RANKS[NOBILITY_RANKS.length - 1];
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

// حساب تاريخ نهاية الاشتراك الجديد
function computeVipExpiry(user, level, days, now) {
  const t = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.now());
  const d = Math.max(1, Math.floor(Number(days)) || 30);
  const sameActive = activeVipLevel(user, t) === level;
  const base = sameActive ? new Date(user.vip_until).getTime() : t;
  return new Date(base + d * 86400000).toISOString();
}

// هل يملك المستخدم ميزة أضواء الذيل للرسائل؟ (ثراء 51+ أو نبلاء رتبة 6+ أو المالك)
function hasMessageTailLights(user, now) {
  if (!user) return false;
  if (user.role === 'owner' || Number(user.wealth_level) >= 51) return true;
  const nr = nobilityRankInfo(activeVipLevel(user, now));
  return !!(nr && nr.tail_lights);
}

// هل يتمتع المستخدم بحصانة ضد الطرد والكتم من المستخدمين الآخرين؟
function hasModerationImmunity(user, now) {
  if (!user) return false;
  if (user.role === 'owner' || Number(user.wealth_level) >= 51) return true;
  const nr = nobilityRankInfo(activeVipLevel(user, now));
  return !!(nr && nr.immunity);
}

// هل يملك المستخدم صلاحية كتم/طرد مستخدم أقل منه في غرفة عامة بفضل مستوى الثراء المتقدم (31+)؟
function canWealthModerateTarget(actor, target, room, now) {
  if (!actor || !target || !room) return false;
  if (actor.id && target.id && actor.id === target.id) return false;
  // الغرف العامة فقط (غير المقفلة بكلمة مرور)
  if (room.has_password || (room.access_hash && String(room.access_hash).length > 0) || room.is_locked) return false;
  // لا تسري على مضيف الغرفة أو طاقم الإدارة أو المحصّنين ملكياً
  if (target.id && target.id === room.host_id) return false;
  if (['owner', 'super_master', 'super_admin', 'admin', 'moderator'].includes(target.role)) return false;
  if (hasModerationImmunity(target, now)) return false;
  const actorWealth = Number(actor.wealth_level) || 1;
  const targetWealth = Number(target.wealth_level) || 1;
  return actorWealth >= 31 && actorWealth > targetWealth;
}

// اختيار مركبة / مؤثر الدخول التلقائي حسب الرتبة أو مستوى الثراء إن لم يجهّز المستخدم قالباً مخصصاً
function resolveAutoEntranceEffect(user, now) {
  if (!user) return null;
  const vip = activeVipLevel(user, now);
  const wl = Number(user.wealth_level) || 1;
  if (wl >= 51 || vip >= 6 || user.role === 'owner') {
    const rank = nobilityRankInfo(vip);
    return {
      effectId: vip >= 7 ? 'noble_sultan' : 'royal_tycoon',
      imageUrl: '/royal_eagle.gif',
      label: vip >= 7 ? 'عرش السلطان الأسطوري' : (rank && vip >= 6 ? rank.mount_name : 'موكب الملك Tycoon'),
      screenQuake: true
    };
  }
  if (vip >= 1) {
    const rank = nobilityRankInfo(vip);
    if (rank && rank.mount_url) {
      return { effectId: `noble_${rank.key}`, imageUrl: rank.mount_url, label: rank.mount_name, screenQuake: false };
    }
  }
  const tier = wealthTierForLevel(wl);
  if (tier && tier.entry_effect_url) {
    return { effectId: `wealth_${tier.key}`, imageUrl: tier.entry_effect_url, label: tier.entry_effect_name, screenQuake: false };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// 4) نظام مستويات الغرف والعائلات (Room & Family Levels 1..20)
// ═══════════════════════════════════════════════════════════════════════
const MAX_GROUP_LEVEL = 20;

function groupLevelThreshold(level) {
  const n = Math.max(1, Math.min(MAX_GROUP_LEVEL, Math.floor(Number(level)) || 1));
  if (n === 1) return 0;
  // منحنى متدرج: Lv.2=200, Lv.3=600, Lv.5=2400, Lv.10=16200, Lv.20=144200
  return Math.round(200 * Math.pow(n - 1, 2.3));
}

function roomLevelFromXp(xp) {
  const p = Math.max(0, Math.floor(Number(xp)) || 0);
  let level = 1;
  while (level < MAX_GROUP_LEVEL && p >= groupLevelThreshold(level + 1)) level++;
  const current = groupLevelThreshold(level);
  const next = level >= MAX_GROUP_LEVEL ? null : groupLevelThreshold(level + 1);
  const progress = next === null ? 100 : Math.min(100, Math.round(((p - current) / Math.max(1, next - current)) * 100));
  const maxMicSeats = level >= 10 ? 15 : (level >= 6 ? 12 : (level >= 3 ? 9 : 5));
  const memberCapacity = 50 + (level - 1) * 25; // 50 .. 525 عضو
  const dailyLuckyBagCrystals = 80 + level * 20; // 100 .. 480 بلورة مجانية يومياً لأعضاء الغرفة
  const xpMultiplier = level >= 10 ? 2.5 : 2;
  return {
    level,
    xp: p,
    current,
    next,
    remaining: next === null ? 0 : Math.max(0, next - p),
    progress,
    max_mic_seats: maxMicSeats,
    member_capacity: memberCapacity,
    daily_lucky_bag_crystals: dailyLuckyBagCrystals,
    xp_multiplier: xpMultiplier
  };
}

function familyLevelFromXp(xp) {
  const p = Math.max(0, Math.floor(Number(xp)) || 0);
  let level = 1;
  while (level < MAX_GROUP_LEVEL && p >= groupLevelThreshold(level + 1)) level++;
  const current = groupLevelThreshold(level);
  const next = level >= MAX_GROUP_LEVEL ? null : groupLevelThreshold(level + 1);
  const progress = next === null ? 100 : Math.min(100, Math.round(((p - current) / Math.max(1, next - current)) * 100));
  const memberCapacity = 50 + (level - 1) * 25; // 50 .. 525 عضو
  const dailyCoins = 300 + level * 120;
  const dailyDiamonds = 15 + level * 8;
  const dailyXpPack = 50 + level * 30;
  return {
    level,
    xp: p,
    current,
    next,
    remaining: next === null ? 0 : Math.max(0, next - p),
    progress,
    member_capacity: memberCapacity,
    daily_coins: dailyCoins,
    daily_diamonds: dailyDiamonds,
    daily_xp_pack: dailyXpPack
  };
}

// نقاط ترتيب الغرفة في الاستكشاف: تجمع الحضور الحي + تعزيز الجاذبية للمضيف + مستوى الغرفة
function roomExposureScore(room) {
  const audience = Number(room && room.audience_count) || 0;
  const boostPct = charmExposureBoost(room && room.host_charm_level);
  const rLv = Math.max(1, Number(room && room.room_level) || 1);
  return Math.round(audience * 1000 + boostPct * 3 + rLv * 25);
}

// بطاقات العرض: الثروة — الرواج — النبلاء/VIP (متوافقة 100% مع الواجهة والاختبارات)
function buildCards(user, now) {
  const wealth = levelFromPoints(user && user.wealth_points);
  const pop = levelFromPoints(user && user.popularity_points);
  const wl = Math.max(Number(user && user.wealth_level) || 0, 0);
  const cl = Math.max(Number(user && user.charm_level) || 0, 0);
  const effWealth = wl > wealth.level ? wl : wealth.level;
  const effCharm = cl > pop.level ? cl : pop.level;
  const vip = activeVipLevel(user, now);
  const noble = nobilityRankInfo(vip);
  return {
    wealth: {
      ...wealth,
      level: effWealth,
      royal_rank: royalIndexFromLevel(effWealth),
      badge_text: formatWealthBadgeText(effWealth),
      tier: wealthTierForLevel(effWealth),
      label: 'الثروة',
      text: `Lv.${effWealth}`
    },
    popularity: {
      ...pop,
      level: effCharm,
      royal_rank: royalIndexFromLevel(effCharm),
      badge_text: formatCharmBadgeText(effCharm),
      exposure_boost_pct: charmExposureBoost(effCharm),
      tier: charmTierForLevel(effCharm),
      label: 'الرواج',
      text: `Lv.${effCharm}`
    },
    vip: {
      level: vip,
      active: vip > 0,
      until: vip ? user.vip_until : null,
      days_left: vipDaysLeft(user, now),
      rank_title: noble ? noble.title_ar : 'بدون رتبة',
      rank_en: noble ? noble.title_en : '',
      label: 'VIP',
      text: `VIP${vip}`
    }
  };
}

module.exports = {
  MAX_LEVEL,
  MAX_GROUP_LEVEL,
  LEVEL_KEYS,
  WEALTH_TIERS,
  WEALTH_MILESTONES,
  CHARM_TIERS,
  CHARM_MILESTONES,
  NOBILITY_RANKS,
  toRoman,
  royalIndexFromLevel,
  formatWealthBadgeText,
  formatCharmBadgeText,
  levelThreshold,
  levelFromPoints,
  pointsForAmount,
  wealthTierForLevel,
  charmTierForLevel,
  charmExposureBoost,
  nobilityRankInfo,
  activeVipLevel,
  vipDaysLeft,
  computeVipExpiry,
  hasMessageTailLights,
  hasModerationImmunity,
  canWealthModerateTarget,
  resolveAutoEntranceEffect,
  groupLevelThreshold,
  roomLevelFromXp,
  familyLevelFromXp,
  roomExposureScore,
  buildCards
};
