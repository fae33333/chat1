/* =====================================================
   سمات الجلد والألوان — مشتركة بين الدردشة ولوحة الإدارة
   ✅ وضع الجلد: كل الألوان + ثيمات جميلة جاهزة
===================================================== */
(function () {
  // قائمة الألوان الكاملة (130 لونًا) — تُستخدم في منتقي
  // لون خط الرسائل وفي اختيار «لون الجلد» من لوحة الإدارة.
  const COLORS = [
    '#e57373','#ef5350','#f44336','#e53935','#d32f2f','#c62828','#800c03','#ba68c8','#ab47bc','#9c27b0','#8e24aa','#7b1fa2','#6a1b9a','#4a148c',
    '#f8a8b7','#fc93ac','#f57a9b','#ff6991','#f74877','#fa3468','#fa224a','#7986cb','#5c6bc0','#3f51b5','#3949ab','#303f9f','#283593','#1a237e',
    '#4fc3f7','#29b6f6','#03a9f4','#039be5','#0288d1','#0277bd','#01579b','#4db6ac','#26a69a','#009688','#00897b','#00796b','#00695c','#004d40',
    '#aed581','#9ccc65','#8bc34a','#7cb342','#689f38','#558b2f','#33691e','#fff176','#ffee58','#ffeb3b','#fdd835','#fbc02d','#f9a825','#f57f17',
    '#ffb74d','#ffa726','#ff9800','#fb8c00','#f57c00','#ef6c00','#e65100','#ac5022','#9a461c','#8c3f18','#7b3714','#632c11','#4b220d','#38190a',
    '#000000','#131313','#3d3c3c','#4d4b4b','#5b5757','#6c6a6a','#7a7777','#333333','#666666','#ff0000','#0000ff','#6600ff','#336666','#9900ff',
    '#000066','#336600','#ff0066','#663333','#cc6600','#ff6600','#996600','#0066cc','#009966','#ffcc00','#666600','#339900','#ff3366','#993366',
    '#6666ff','#ff9900','#999900','#003399','#9966ff','#cc3399','#ff0099','#663366','#198139','#ff3333','#800080','#6699ff','#666699','#993300',
    '#000033','#669933','#cc99ff','#ff00cc','#cc3366','#339933','#ff66ff','#800000','#663300','#ff00ff','#ff9966','#330099','#cc9900','#993333',
    '#660000','#00cc33','#ff6699','#ff3478'
  ];

  // الثيمات الجاهزة (اسم → [اللون الأساسي، اللون الثانوي، الاسم العربي])
  const THEMES = {
    default:   { primary: '#9c1e46', secondary: '#c22e5e', label: 'عنابي (افتراضي)' },
    blue:      { primary: '#1d4ed8', secondary: '#3b82f6', label: 'أزرق ملكي' },
    green:     { primary: '#15803d', secondary: '#22c55e', label: 'أخضر زمردي' },
    purple:    { primary: '#7c3aed', secondary: '#a855f7', label: 'بنفسجي أنيق' },
    black:     { primary: '#111827', secondary: '#4b5563', label: 'أسود ليلي' },
    orange:    { primary: '#ea580c', secondary: '#fb923c', label: 'برتقالي جذاب' },
    pink:      { primary: '#db2777', secondary: '#f472b6', label: 'وردي فخم' },
    teal:      { primary: '#0d9488', secondary: '#2dd4bf', label: 'تركواز بحري' },
    midnight:  { primary: '#312e81', secondary: '#6d28d9', label: 'منتصف الليل' },
    royalgold: { primary: '#b45309', secondary: '#f59e0b', label: 'ذهبي ملكي' },
    crimson:   { primary: '#b91c1c', secondary: '#ef4444', label: 'قرمزي ناري' },
    sunset:    { primary: '#ea580c', secondary: '#db2777', label: 'غروب الشمس' },
    ocean:     { primary: '#0369a1', secondary: '#06b6d4', label: 'محيط عميق' },
    aurora:    { primary: '#065f46', secondary: '#10b981', label: 'شفق أخضر' },
    grape:     { primary: '#6d28d9', secondary: '#c026d3', label: 'عنبة' },
    sky:       { primary: '#0284c7', secondary: '#38bdf8', label: 'سماء صافية' },
    rosegold:  { primary: '#be185d', secondary: '#fb7185', label: 'وردي ذهبي' },
    emerald:   { primary: '#047857', secondary: '#34d399', label: 'زمردي' }
  };

  function hexToRgb(hex) {
    hex = String(hex || '').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(hex, 16);
    if (isNaN(n)) return { r: 156, g: 30, b: 70 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHex(r, g, b) {
    function c(v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); }
    return '#' + c(r) + c(g) + c(b);
  }
  // مزج لون مع لون آخر بنسبة `ratio` تجاه `other`
  function mix(hex, other, ratio) {
    var a = hexToRgb(hex), b = hexToRgb(other);
    return rgbToHex(a.r * (1 - ratio) + b.r * ratio, a.g * (1 - ratio) + b.g * ratio, a.b * (1 - ratio) + b.b * ratio);
  }
  function rgba(hex, alpha) {
    var c = hexToRgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + alpha + ')';
  }

  // يحسب متغيرات CSS للجلد انطلاقًا من لون (#ffffff) أو اسم ثيم جاهز.
  function computeSkinVars(sel) {
    var primary, secondary;
    if (THEMES[sel]) {
      primary = THEMES[sel].primary;
      secondary = THEMES[sel].secondary;
    } else {
      primary = /^#[0-9a-f]{6}$/i.test(sel) ? sel : '#9c1e46';
      secondary = mix(primary, '#ffffff', 0.22);
    }
    return {
      '--main': primary,
      '--main2': secondary,
      '--skin-primary': primary,
      '--skin-secondary': secondary,
      '--skin-glow': rgba(primary, 0.35),
      '--skin-bg-light': mix(primary, '#ffffff', 0.9),
      '--skin-border': mix(primary, '#ffffff', 0.72),
      '--skin-btn': 'linear-gradient(135deg, ' + primary + ', ' + secondary + ')'
    };
  }

  // هل القيمة لون HEX صريح؟
  function isHexColor(v) { return /^#[0-9a-f]{6}$/i.test(v || ''); }

  window.SKIN_THEMES = THEMES;
  window.SKIN_COLOR_PALETTE = COLORS;
  window.SkinLib = {
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    mix: mix,
    rgba: rgba,
    computeSkinVars: computeSkinVars,
    isHexColor: isHexColor,
    COLORS: COLORS,
    THEMES: THEMES
  };
})();
