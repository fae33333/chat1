/* =======================================================================
   🌟 محرك الثيمات والسمات المتطور (Nujum Super Theme & Skin Engine)
   ✅ دعم وضع الجلد الافتراضي الحر (كل الألوان 130+ لون + منتقي الألوان المباشر)
   ✅ مكتبة ثيمات احترافية متكاملة (16 ثيم فخم)
   ✅ تغيير فوري ومباشر للشات مع تأثيرات بصرية وانتقالات ناعمة
   ✅ تصدير وتحميل الثيمات (JSON / CSS) واستيرادها ومشاركتها
======================================================================= */
(function () {
  'use strict';

  // لوحة ألوان الجلد الموسعة (130+ لونًا متناسقًا وعالي الجودة)
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
    '#660000','#00cc33','#ff6699','#ff3478','#10b981','#06b6d4','#8b5cf6','#ec4899','#f43f5e','#14b8a6','#e11d48','#6366f1','#0284c7','#d97706'
  ];

  // مكتبة الثيمات الاحترافية المتقدمة مع خصائص بصرية دقيقة
  const THEMES = {
    default: {
      id: 'default',
      label: 'عنابي كلاسيك (الافتراضي)',
      desc: 'النمط العنابي الفاخر مع لمسات مخملية وأزرار متدرجة',
      badge: '✨ الافتراضي',
      mode: 'light',
      primary: '#9c1e46',
      secondary: '#c22e5e',
      accent: '#f43f5e',
      bg: '#f8f9fd',
      surface: '#ffffff',
      surfaceBorder: '#f0e6eb',
      cardBg: 'rgba(255, 255, 255, 0.95)',
      textMain: '#1e2337',
      textMuted: '#8b92a9',
      bubbleBg: '#ffffff',
      bubbleBorder: '#f3e8ee',
      bubbleText: '#1f2438',
      glow: 'rgba(156, 30, 70, 0.35)',
      btnGrad: 'linear-gradient(135deg, #9c1e46, #c22e5e)',
      headerGrad: 'linear-gradient(135deg, #ffffff, #fff7fa)',
      pattern: 'dots'
    },
    royalgold: {
      id: 'royalgold',
      label: 'الذهبي الملكي الأسود',
      desc: 'فخامة ملكية متكاملة بخلفية سوداء فاخرة ولمسات ذهب براق',
      badge: '👑 ملكي فاخر',
      mode: 'dark',
      primary: '#d97706',
      secondary: '#fbbf24',
      accent: '#fef08a',
      bg: '#0c0d12',
      surface: '#151722',
      surfaceBorder: 'rgba(217, 119, 6, 0.28)',
      cardBg: 'rgba(21, 23, 34, 0.9)',
      textMain: '#fef3c7',
      textMuted: '#9ca3af',
      bubbleBg: '#1b1d2b',
      bubbleBorder: 'rgba(245, 158, 11, 0.22)',
      bubbleText: '#f3f4f6',
      glow: 'rgba(245, 158, 11, 0.45)',
      btnGrad: 'linear-gradient(135deg, #b45309 0%, #f59e0b 50%, #d97706 100%)',
      headerGrad: 'linear-gradient(135deg, #13151f 0%, #1f2233 100%)',
      pattern: 'stars'
    },
    cyberpunk: {
      id: 'cyberpunk',
      label: 'نيون سايبربنك',
      desc: 'طابع مستقبلي مفعم بالنيون الأزرق السماوي والوردي المشع',
      badge: '⚡ نيون مشع',
      mode: 'dark',
      primary: '#06b6d4',
      secondary: '#ec4899',
      accent: '#22d3ee',
      bg: '#070913',
      surface: '#0e1326',
      surfaceBorder: 'rgba(6, 182, 212, 0.3)',
      cardBg: 'rgba(14, 19, 38, 0.85)',
      textMain: '#f0fdf4',
      textMuted: '#94a3b8',
      bubbleBg: '#131a33',
      bubbleBorder: 'rgba(6, 182, 212, 0.25)',
      bubbleText: '#f8fafc',
      glow: 'rgba(6, 182, 212, 0.5)',
      btnGrad: 'linear-gradient(135deg, #0891b2 0%, #d946ef 100%)',
      headerGrad: 'linear-gradient(135deg, #090e1f 0%, #141b36 100%)',
      pattern: 'grid'
    },
    emerald: {
      id: 'emerald',
      label: 'الزمرد الإمبراطوري',
      desc: 'أخضر زمردي كريستالي مريح للعين مع أطراف زجاجية فائقة',
      badge: '💎 زمردي',
      mode: 'dark',
      primary: '#059669',
      secondary: '#10b981',
      accent: '#34d399',
      bg: '#06130d',
      surface: '#0b2017',
      surfaceBorder: 'rgba(16, 185, 129, 0.25)',
      cardBg: 'rgba(11, 32, 23, 0.9)',
      textMain: '#ecfdf5',
      textMuted: '#94a3b8',
      bubbleBg: '#0f2c1f',
      bubbleBorder: 'rgba(52, 211, 153, 0.2)',
      bubbleText: '#f0fdf4',
      glow: 'rgba(16, 185, 129, 0.4)',
      btnGrad: 'linear-gradient(135deg, #047857 0%, #10b981 100%)',
      headerGrad: 'linear-gradient(135deg, #071710 0%, #0d271c 100%)',
      pattern: 'mesh'
    },
    midnight: {
      id: 'midnight',
      label: 'منتصف الليل البنفسجي',
      desc: 'سماء الليل الداكنة مع توهج أرجواني عميق ولمسات كوزميك',
      badge: '🌌 كوزميك',
      mode: 'dark',
      primary: '#6366f1',
      secondary: '#8b5cf6',
      accent: '#c084fc',
      bg: '#090a16',
      surface: '#12142b',
      surfaceBorder: 'rgba(99, 102, 241, 0.26)',
      cardBg: 'rgba(18, 20, 43, 0.9)',
      textMain: '#f5f3ff',
      textMuted: '#a5b4fc',
      bubbleBg: '#181b3a',
      bubbleBorder: 'rgba(139, 92, 246, 0.22)',
      bubbleText: '#ffffff',
      glow: 'rgba(99, 102, 241, 0.45)',
      btnGrad: 'linear-gradient(135deg, #4f46e5 0%, #9333ea 100%)',
      headerGrad: 'linear-gradient(135deg, #0d0f22 0%, #171b3b 100%)',
      pattern: 'stars'
    },
    ocean: {
      id: 'ocean',
      label: 'المحيط الفيروزي العميق',
      desc: 'أمواج البحر الزرقاء وألوان التيركواز الساحرة بانعكاسات مائية',
      badge: '🌊 مائي منعش',
      mode: 'dark',
      primary: '#0284c7',
      secondary: '#06b6d4',
      accent: '#38bdf8',
      bg: '#05101a',
      surface: '#0a1d2e',
      surfaceBorder: 'rgba(6, 182, 212, 0.25)',
      cardBg: 'rgba(10, 29, 46, 0.9)',
      textMain: '#f0f9ff',
      textMuted: '#93c5fd',
      bubbleBg: '#0e263c',
      bubbleBorder: 'rgba(56, 189, 248, 0.22)',
      bubbleText: '#ffffff',
      glow: 'rgba(2, 132, 199, 0.45)',
      btnGrad: 'linear-gradient(135deg, #0369a1 0%, #06b6d4 100%)',
      headerGrad: 'linear-gradient(135deg, #061320 0%, #0c2338 100%)',
      pattern: 'mesh'
    },
    sunset: {
      id: 'sunset',
      label: 'غروب الشمس المخملي',
      desc: 'تدرجات برتقالية ووردية دافئة تحاكي غروب الشمس الاستوائي',
      badge: '🌅 دافئ وجذاب',
      mode: 'dark',
      primary: '#ea580c',
      secondary: '#db2777',
      accent: '#fb923c',
      bg: '#120b0d',
      surface: '#221217',
      surfaceBorder: 'rgba(234, 88, 12, 0.25)',
      cardBg: 'rgba(34, 18, 23, 0.9)',
      textMain: '#fff1f2',
      textMuted: '#fda4af',
      bubbleBg: '#2d1820',
      bubbleBorder: 'rgba(219, 39, 119, 0.22)',
      bubbleText: '#ffffff',
      glow: 'rgba(234, 88, 12, 0.4)',
      btnGrad: 'linear-gradient(135deg, #ea580c 0%, #db2777 100%)',
      headerGrad: 'linear-gradient(135deg, #180d11 0%, #29141c 100%)',
      pattern: 'dots'
    },
    sapphire: {
      id: 'sapphire',
      label: 'الياقوت الأزرق الكهربائي',
      desc: 'أزرق ملكي متوهج عالي التباين وواضح بأسلوب التطبيقات الحديثة',
      badge: '⚡ أزرق ملكي',
      mode: 'dark',
      primary: '#2563eb',
      secondary: '#3b82f6',
      accent: '#60a5fa',
      bg: '#080e1e',
      surface: '#0f1c3a',
      surfaceBorder: 'rgba(37, 99, 235, 0.28)',
      cardBg: 'rgba(15, 28, 58, 0.9)',
      textMain: '#eff6ff',
      textMuted: '#93c5fd',
      bubbleBg: '#14254d',
      bubbleBorder: 'rgba(59, 130, 246, 0.24)',
      bubbleText: '#ffffff',
      glow: 'rgba(37, 99, 235, 0.45)',
      btnGrad: 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)',
      headerGrad: 'linear-gradient(135deg, #091226 0%, #122144 100%)',
      pattern: 'grid'
    },
    crimson: {
      id: 'crimson',
      label: 'القرمزي الناري الفاخر',
      desc: 'أحمر قرمزي عميق وجذاب مع تباين أسود نقي للشاشات الحديثة',
      badge: '🔥 قرمزي ناري',
      mode: 'dark',
      primary: '#dc2626',
      secondary: '#f43f5e',
      accent: '#fb7185',
      bg: '#100708',
      surface: '#200e10',
      surfaceBorder: 'rgba(220, 38, 38, 0.28)',
      cardBg: 'rgba(32, 14, 16, 0.9)',
      textMain: '#fff1f2',
      textMuted: '#fca5a5',
      bubbleBg: '#2b1316',
      bubbleBorder: 'rgba(244, 63, 94, 0.22)',
      bubbleText: '#ffffff',
      glow: 'rgba(220, 38, 38, 0.45)',
      btnGrad: 'linear-gradient(135deg, #b91c1c 0%, #ef4444 100%)',
      headerGrad: 'linear-gradient(135deg, #160a0b 0%, #281114 100%)',
      pattern: 'dots'
    },
    crystal: {
      id: 'crystal',
      label: 'الجليد الكريستالي الصافي (النهاري)',
      desc: 'ثيم نهاري كريستالي فائق النقاء مع زجاج بلوري ولمسات سماوية',
      badge: '❄️ نهاري ناصع',
      mode: 'light',
      primary: '#0284c7',
      secondary: '#38bdf8',
      accent: '#0369a1',
      bg: '#f0f6fc',
      surface: '#ffffff',
      surfaceBorder: '#dbeafe',
      cardBg: 'rgba(255, 255, 255, 0.92)',
      textMain: '#0f172a',
      textMuted: '#64748b',
      bubbleBg: '#ffffff',
      bubbleBorder: '#e0f2fe',
      bubbleText: '#0f172a',
      glow: 'rgba(2, 132, 199, 0.25)',
      btnGrad: 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)',
      headerGrad: 'linear-gradient(135deg, #ffffff 0%, #f0f9ff 100%)',
      pattern: 'dots'
    },
    aurora: {
      id: 'aurora',
      label: 'الشفق القطبي (أورورا)',
      desc: 'أنوار الشفق الشمالية بتدرجات أخضر نعناعي وتيركواز ساحر',
      badge: '🌌 أورورا خضراء',
      mode: 'dark',
      primary: '#0d9488',
      secondary: '#10b981',
      accent: '#2dd4bf',
      bg: '#041014',
      surface: '#092026',
      surfaceBorder: 'rgba(13, 148, 136, 0.26)',
      cardBg: 'rgba(9, 32, 38, 0.9)',
      textMain: '#f0fdfa',
      textMuted: '#99f6e4',
      bubbleBg: '#0e2b33',
      bubbleBorder: 'rgba(45, 212, 191, 0.22)',
      bubbleText: '#ffffff',
      glow: 'rgba(13, 148, 136, 0.45)',
      btnGrad: 'linear-gradient(135deg, #0f766e 0%, #10b981 100%)',
      headerGrad: 'linear-gradient(135deg, #06161b 0%, #0d2830 100%)',
      pattern: 'mesh'
    },
    obsidian: {
      id: 'obsidian',
      label: 'الأسود الفاحم المظلم (OLED)',
      desc: 'أسود مطلق موفر للبطارية مع لمسات فضية ورمادية حادة',
      badge: '🖤 أسود فاحم',
      mode: 'dark',
      primary: '#475569',
      secondary: '#94a3b8',
      accent: '#cbd5e1',
      bg: '#000000',
      surface: '#0f0f12',
      surfaceBorder: 'rgba(255, 255, 255, 0.1)',
      cardBg: 'rgba(15, 15, 18, 0.95)',
      textMain: '#f8fafc',
      textMuted: '#94a3b8',
      bubbleBg: '#141418',
      bubbleBorder: 'rgba(255, 255, 255, 0.08)',
      bubbleText: '#f8fafc',
      glow: 'rgba(255, 255, 255, 0.15)',
      btnGrad: 'linear-gradient(135deg, #1e293b 0%, #475569 100%)',
      headerGrad: 'linear-gradient(135deg, #050508 0%, #111116 100%)',
      pattern: 'grid'
    },
    mocha: {
      id: 'mocha',
      label: 'القهوة والكراميل الدافئ',
      desc: 'بني شوكولاتة وكراميل دافئ يوفر أجواء هادئة وفاخرة',
      badge: '☕ كراميل وموكا',
      mode: 'dark',
      primary: '#9a3412',
      secondary: '#d97706',
      accent: '#f59e0b',
      bg: '#140c09',
      surface: '#231510',
      surfaceBorder: 'rgba(217, 119, 6, 0.24)',
      cardBg: 'rgba(35, 21, 16, 0.9)',
      textMain: '#fef3c7',
      textMuted: '#d1d5db',
      bubbleBg: '#2e1c15',
      bubbleBorder: 'rgba(245, 158, 11, 0.2)',
      bubbleText: '#fffbeb',
      glow: 'rgba(217, 119, 6, 0.4)',
      btnGrad: 'linear-gradient(135deg, #7c2d12 0%, #d97706 100%)',
      headerGrad: 'linear-gradient(135deg, #190f0b 0%, #2c1a14 100%)',
      pattern: 'dots'
    },
    sakura: {
      id: 'sakura',
      label: 'زهر الكرز والوردي اللطيف',
      desc: 'درجات الوردي واللافندر الزاهية بتصميم أنيق ومبهج',
      badge: '🌸 زهر الكرز',
      mode: 'light',
      primary: '#db2777',
      secondary: '#f472b6',
      accent: '#fb7185',
      bg: '#fdf4f7',
      surface: '#ffffff',
      surfaceBorder: '#fce7f3',
      cardBg: 'rgba(255, 255, 255, 0.94)',
      textMain: '#371826',
      textMuted: '#9d677f',
      bubbleBg: '#ffffff',
      bubbleBorder: '#fbcfe8',
      bubbleText: '#3b172a',
      glow: 'rgba(219, 39, 119, 0.3)',
      btnGrad: 'linear-gradient(135deg, #db2777 0%, #f472b6 100%)',
      headerGrad: 'linear-gradient(135deg, #ffffff 0%, #fdf2f8 100%)',
      pattern: 'dots'
    },
    blue: {
      id: 'blue',
      label: 'أزرق كلاسيكي',
      primary: '#1d4ed8',
      secondary: '#3b82f6',
      badge: '🔷 أزرق',
      mode: 'light'
    },
    green: {
      id: 'green',
      label: 'أخضر طبيعي',
      primary: '#15803d',
      secondary: '#22c55e',
      badge: '🌿 طبيعي',
      mode: 'light'
    },
    purple: {
      id: 'purple',
      label: 'بنفسجي ملكي',
      primary: '#7c3aed',
      secondary: '#a855f7',
      badge: '💜 بنفسجي',
      mode: 'light'
    },
    pink: {
      id: 'pink',
      label: 'وردي فخم',
      primary: '#db2777',
      secondary: '#f472b6',
      badge: '💖 وردي',
      mode: 'light'
    },
    teal: {
      id: 'teal',
      label: 'تركواز بحري',
      primary: '#0d9488',
      secondary: '#2dd4bf',
      badge: '🌊 تركواز',
      mode: 'light'
    },
    orange: {
      id: 'orange',
      label: 'برتقالي متوهج',
      primary: '#ea580c',
      secondary: '#fb923c',
      badge: '🔥 برتقالي',
      mode: 'light'
    },
    black: {
      id: 'black',
      label: 'أسود كلاسيك',
      primary: '#111827',
      secondary: '#4b5563',
      badge: '🖤 أسود',
      mode: 'dark'
    }
  };

  function hexToRgb(hex) {
    hex = String(hex || '').replace('#', '').trim();
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16);
    if (isNaN(n) || hex.length !== 6) return { r: 156, g: 30, b: 70 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHex(r, g, b) {
    const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  }

  function mix(hexA, hexB, ratio) {
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    return rgbToHex(
      a.r * (1 - ratio) + b.r * ratio,
      a.g * (1 - ratio) + b.g * ratio,
      a.b * (1 - ratio) + b.g * ratio
    );
  }

  function rgba(hex, alpha) {
    const c = hexToRgb(hex);
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
  }

  function isHexColor(v) {
    return /^#[0-9a-f]{6}$/i.test(String(v || '').trim());
  }

  // حساب درجة السطوع لتحديد النمط الليلي/النهاري تلقائياً
  function getLuminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  // حساب جميع متغيرات CSS المستنبطة من لون الجلد الحر أو الثيم
  function computeSkinVars(sel, customOpts = {}) {
    let t = THEMES[sel];
    let primary, secondary, accent, mode, bg, surface, surfaceBorder, cardBg, textMain, textMuted, bubbleBg, bubbleBorder, bubbleText, glow, btnGrad, headerGrad, pattern;

    if (t && t.primary) {
      primary = t.primary;
      secondary = t.secondary || mix(primary, '#ffffff', 0.22);
      accent = t.accent || secondary;
      mode = t.mode || (getLuminance(primary) < 0.35 ? 'dark' : 'light');
      glow = t.glow || rgba(primary, 0.4);
      bg = t.bg || (mode === 'dark' ? '#0b0f19' : mix(primary, '#ffffff', 0.95));
      surface = t.surface || (mode === 'dark' ? '#141a29' : '#ffffff');
      surfaceBorder = t.surfaceBorder || (mode === 'dark' ? rgba(primary, 0.25) : mix(primary, '#ffffff', 0.8));
      cardBg = t.cardBg || (mode === 'dark' ? 'rgba(20, 26, 41, 0.9)' : 'rgba(255, 255, 255, 0.95)');
      textMain = t.textMain || (mode === 'dark' ? '#f8fafc' : '#1e2337');
      textMuted = t.textMuted || (mode === 'dark' ? '#94a3b8' : '#8b92a9');
      bubbleBg = t.bubbleBg || (mode === 'dark' ? '#182033' : '#ffffff');
      bubbleBorder = t.bubbleBorder || (mode === 'dark' ? rgba(primary, 0.2) : mix(primary, '#ffffff', 0.88));
      bubbleText = t.bubbleText || textMain;
      btnGrad = t.btnGrad || `linear-gradient(135deg, ${primary}, ${secondary})`;
      headerGrad = t.headerGrad || (mode === 'dark' ? `linear-gradient(135deg, #0d1220, #172036)` : `linear-gradient(135deg, #ffffff, ${mix(primary, '#ffffff', 0.94)})`);
      pattern = t.pattern || 'dots';
    } else {
      // وضع الجلد الحر عبر اللون المختار
      primary = isHexColor(sel) ? sel : '#9c1e46';
      const lum = getLuminance(primary);
      const isDark = lum < 0.45;
      mode = isDark ? 'dark' : 'light';
      secondary = mix(primary, isDark ? '#ffffff' : '#000000', 0.22);
      accent = mix(primary, '#38bdf8', 0.35);
      glow = rgba(primary, 0.42);
      bg = isDark ? mix(primary, '#080a10', 0.88) : mix(primary, '#ffffff', 0.95);
      surface = isDark ? mix(primary, '#121622', 0.75) : '#ffffff';
      surfaceBorder = isDark ? rgba(primary, 0.3) : mix(primary, '#ffffff', 0.78);
      cardBg = isDark ? rgba(primary, 0.15) : 'rgba(255, 255, 255, 0.94)';
      textMain = isDark ? '#f8fafc' : '#1e2337';
      textMuted = isDark ? '#94a3b8' : '#8b92a9';
      bubbleBg = isDark ? mix(primary, '#161c2c', 0.78) : '#ffffff';
      bubbleBorder = isDark ? rgba(primary, 0.24) : mix(primary, '#ffffff', 0.86);
      bubbleText = textMain;
      btnGrad = `linear-gradient(135deg, ${primary}, ${secondary})`;
      headerGrad = isDark ? `linear-gradient(135deg, ${mix(primary, '#0c0f18', 0.85)}, ${mix(primary, '#182033', 0.7)})` : `linear-gradient(135deg, #ffffff, ${mix(primary, '#ffffff', 0.92)})`;
      pattern = customOpts.pattern || 'dots';
    }

    // السماح بالتعديل اليدوي للخيارات
    if (customOpts.pattern) pattern = customOpts.pattern;
    if (customOpts.mode) mode = customOpts.mode;

    return {
      '--main': primary,
      '--main2': secondary,
      '--skin-primary': primary,
      '--skin-secondary': secondary,
      '--skin-accent': accent,
      '--skin-glow': glow,
      '--skin-glow-heavy': rgba(primary, 0.65),
      '--skin-bg': bg,
      '--skin-bg-light': mix(primary, '#ffffff', 0.9),
      '--skin-surface': surface,
      '--skin-surface-border': surfaceBorder,
      '--skin-card-bg': cardBg,
      '--skin-text-main': textMain,
      '--skin-text-muted': textMuted,
      '--skin-bubble-bg': bubbleBg,
      '--skin-bubble-border': bubbleBorder,
      '--skin-bubble-text': bubbleText,
      '--skin-border': surfaceBorder,
      '--skin-btn': btnGrad,
      '--skin-header-grad': headerGrad,
      '--skin-pattern': pattern,
      '--skin-mode': mode
    };
  }

  // =========================================================================
  //  نظام تصدير وتحميل الثيمات (Download / Export / Import Engine)
  // =========================================================================

  function getThemeData(sel) {
    if (THEMES[sel]) {
      const t = THEMES[sel];
      const vars = computeSkinVars(sel);
      return {
        id: t.id,
        name: t.label,
        type: 'curated_theme',
        description: t.desc || '',
        version: '2.0',
        exportedAt: new Date().toISOString(),
        primaryColor: t.primary,
        secondaryColor: t.secondary || '',
        mode: t.mode || 'light',
        variables: vars
      };
    } else {
      const color = isHexColor(sel) ? sel : '#9c1e46';
      const vars = computeSkinVars(color);
      return {
        id: 'custom-skin-' + color.replace('#', ''),
        name: 'جلد مخصص (' + color + ')',
        type: 'custom_skin',
        description: 'سمة مخصصة مولدة من لون الجلد ' + color,
        version: '2.0',
        exportedAt: new Date().toISOString(),
        primaryColor: color,
        secondaryColor: vars['--skin-secondary'],
        mode: vars['--skin-mode'],
        variables: vars
      };
    }
  }

  function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }

  function exportThemeJson(sel) {
    const data = getThemeData(sel);
    const jsonStr = JSON.stringify(data, null, 2);
    const safeName = (data.id || 'theme').replace(/[^a-z0-9_-]/gi, '_');
    downloadBlob(jsonStr, `nujum-theme-${safeName}.json`, 'application/json');
    return data;
  }

  function exportThemeCss(sel) {
    const data = getThemeData(sel);
    const vars = data.variables;
    let css = `/* =====================================================\n`;
    css += `   ثيم شات نجوم العرب: ${data.name}\n`;
    css += `   تاريخ التصدير: ${new Date().toLocaleDateString('ar-SA')}\n`;
    css += `   ===================================================== */\n\n`;
    css += `:root, body.theme-${data.id} {\n`;
    for (const [k, v] of Object.entries(vars)) {
      css += `  ${k}: ${v};\n`;
    }
    css += `}\n`;
    const safeName = (data.id || 'theme').replace(/[^a-z0-9_-]/gi, '_');
    downloadBlob(css, `nujum-theme-${safeName}.css`, 'text/css');
    return css;
  }

  function exportAllThemesBundle() {
    const bundle = {
      name: 'Nujum Chat Super Theme Pack',
      version: '2.0',
      exportedAt: new Date().toISOString(),
      themesCount: Object.keys(THEMES).length,
      paletteColors: COLORS,
      themes: THEMES
    };
    downloadBlob(JSON.stringify(bundle, null, 2), 'nujum-all-themes-pack.json', 'application/json');
  }

  function parseImportedTheme(jsonString) {
    try {
      const obj = JSON.parse(jsonString);
      if (!obj || typeof obj !== 'object') throw new Error('الملف ليس بتنسيق JSON صحيح');
      if (obj.primaryColor || (obj.variables && obj.variables['--main'])) {
        return {
          ok: true,
          theme: obj
        };
      }
      throw new Error('ملف الثيم يفتقد لبيانات الألوان الأساسية');
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // تصدير الكائن العام
  window.SKIN_THEMES = THEMES;
  window.SKIN_COLOR_PALETTE = COLORS;
  window.SkinLib = {
    hexToRgb,
    rgbToHex,
    mix,
    rgba,
    isHexColor,
    getLuminance,
    computeSkinVars,
    getThemeData,
    exportThemeJson,
    exportThemeCss,
    exportAllThemesBundle,
    parseImportedTheme,
    COLORS,
    THEMES
  };
})();
