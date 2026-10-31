/* رموز وشارات المستويات: الثروة / الرواج / VIP — SVG مرسوم لكل رتبة */
(function () {
  'use strict';

  // ── الرتب: from/to حدود المستوى، شكل الرمز، ولونا التدرج ──
  const TIERS = {
    wealth: [
      { key: 'starter',  name: 'مبتدئ',   from: 1,  to: 5,  shape: 'gem',    c1: '#86efac', c2: '#16a34a' },
      { key: 'bronze',   name: 'برونزي',  from: 6,  to: 10, shape: 'shield', c1: '#fdba74', c2: '#9a4a16' },
      { key: 'silver',   name: 'فضي',     from: 11, to: 15, shape: 'shieldstar', c1: '#f1f5f9', c2: '#8b9bb0' },
      { key: 'gold',     name: 'ذهبي',    from: 16, to: 20, shape: 'star',   c1: '#fde68a', c2: '#d97706' },
      { key: 'platinum', name: 'بلاتيني', from: 21, to: 25, shape: 'diamond', c1: '#a5f3fc', c2: '#6366f1' },
      { key: 'royal',    name: 'ملكي',    from: 26, to: 30, shape: 'crown',  c1: '#f5d0fe', c2: '#c026d3' }
    ],
    general: [
      { key: 'member',  name: 'عضو',   from: 1,  to: 10, shape: 'shield', c1: '#93c5fd', c2: '#2563eb' },
      { key: 'active',  name: 'نشيط',  from: 11, to: 20, shape: 'star',   c1: '#f0abfc', c2: '#a21caf' },
      { key: 'pro',     name: 'محترف', from: 21, to: 30, shape: 'crown',  c1: '#fdba74', c2: '#dc2626' }
    ],
    charm: [
      { key: 'rising',   name: 'صاعد',   from: 1,  to: 10, shape: 'heart', c1: '#fbcfe8', c2: '#ec4899' },
      { key: 'star',     name: 'نجم',    from: 11, to: 20, shape: 'star',  c1: '#ddd6fe', c2: '#7c3aed' },
      { key: 'legend',   name: 'أسطورة', from: 21, to: 30, shape: 'flame', c1: '#fde047', c2: '#ea580c' }
    ]
  };
  const VIP_COLORS = [null,
    ['#fcd34d', '#b45309'], ['#cbd5e1', '#64748b'], ['#fda4af', '#e11d48'], ['#c4b5fd', '#6d28d9'], ['#67e8f9', '#0e7490']];

  // ── مسارات الأشكال (viewBox 24×24) ──
  const SHAPES = {
    gem: '<path d="M12 2.5 20.5 9 12 21.5 3.5 9Z"/><path d="M3.5 9h17M8.5 9 12 2.5 15.5 9 12 21.5Z" class="sb-line"/>',
    shield: '<path d="M12 2.2 20 5v7c0 4.6-3.6 7.9-8 9.8C7.6 19.9 4 16.6 4 12V5Z"/><path d="M12 6v12" class="sb-line"/>',
    shieldstar: '<path d="M12 2.2 20 5v7c0 4.6-3.6 7.9-8 9.8C7.6 19.9 4 16.6 4 12V5Z"/><path d="m12 7.2 1.5 3.1 3.4.5-2.5 2.4.6 3.4-3-1.6-3 1.6.6-3.4-2.5-2.4 3.4-.5Z" class="sb-white"/>',
    star: '<path d="m12 2 3.1 6.4 7 1-5.1 4.9 1.2 7L12 18.1 5.8 21.3l1.2-7L1.9 9.4l7-1Z"/>',
    diamond: '<path d="M6.5 3h11L22 9.2 12 21.5 2 9.2Z"/><path d="M2 9.2h20M9 3l-2 6.2 5 12.3M15 3l2 6.2-5 12.3" class="sb-line"/><path d="M19.5 2v3M18 3.5h3" class="sb-spark"/>',
    crown: '<path d="m2.5 7.5 4.8 4.2L12 3.5l4.7 8.2 4.8-4.2-2 12H4.5Z"/><circle cx="12" cy="3.6" r="1.4" class="sb-white"/><circle cx="2.5" cy="7.3" r="1.2" class="sb-white"/><circle cx="21.5" cy="7.3" r="1.2" class="sb-white"/><path d="M5 16.5h14" class="sb-line"/>',
    heart: '<path d="M12 21.2C5 15.8 2.4 12 2.4 8.6a4.8 4.8 0 0 1 9.6-1.6 4.8 4.8 0 0 1 9.6 1.6c0 3.4-2.6 7.2-9.6 12.6Z"/>',
    flame: '<path d="M12.5 1.8c.6 4.2 5.7 6.2 5.7 12.2a6.2 6.2 0 0 1-12.4 0c0-3.2 1.9-4.7 3.1-6.5.4 1.7 1.2 2.3 1.9 2.1-.1-3 .2-5.1 1.7-7.8Z"/><path d="M12 21a3.2 3.2 0 0 1-3.2-3.2c0-1.7 1.3-2.4 2-3.5.5 1 1.1 1.2 1.6 1 0 .9.1 1.6 0 2.1.6-.2.9-.6 1.1-1.2.5.8.7 1.1.7 1.8A3.2 3.2 0 0 1 12 21Z" class="sb-white"/>'
  };

  const VIP_IMG_MAX = 6;
  function tierOf(kind, level) {
    const list = TIERS[kind] || TIERS.wealth;
    level = Math.max(1, Math.floor(Number(level)) || 1);
    return list.find(t => level >= t.from && level <= t.to) || list[list.length - 1];
  }

  // تدرجات الألوان تُحقن مرة واحدة في الصفحة
  function ensureDefs() {
    if (document.getElementById('sb-defs')) return;
    const grads = [];
    Object.keys(TIERS).forEach(k => TIERS[k].forEach(t => grads.push([`${k}-${t.key}`, t.c1, t.c2])));
    for (let i = 1; i < VIP_COLORS.length; i++) grads.push([`vip-${i}`, VIP_COLORS[i][0], VIP_COLORS[i][1]]);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'sb-defs';
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    svg.innerHTML = '<defs>' + grads.map(([id, a, b]) =>
      `<linearGradient id="sbg-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`).join('') + '</defs>';
    (document.body || document.documentElement).appendChild(svg);
  }
  if (document.body) ensureDefs(); else document.addEventListener('DOMContentLoaded', ensureDefs);

  function icon(gradId, shape) {
    return `<svg class="sb-ic" viewBox="0 0 24 24" aria-hidden="true" fill="url(#sbg-${gradId})" stroke="rgba(0,0,0,.35)" stroke-width=".8" stroke-linejoin="round">${SHAPES[shape] || SHAPES.gem}</svg>`;
  }

  // HTML الشارة: kind = wealth | charm | vip
  function html(kind, level, opts) {
    ensureDefs();
    opts = opts || {};
    level = Math.max(kind === 'vip' ? 0 : 1, Math.floor(Number(level)) || 0);
    if (kind === 'vip') {
      if (!level) return '';
      // شارة VIP: صورة متحركة لكل مستوى (1..6)، وما فوق 6 يأخذ شارة 6
      const n = Math.min(level, VIP_IMG_MAX);
      const px = Math.max(16, Math.floor(Number(opts.size)) || (opts.compact ? 24 : 30));
      return `<span class="sb-vipimg" title="VIP${level}"><img src="/img/vip/vip-${n}.webp" alt="VIP${level}" width="${px}" height="${px}" style="width:${px}px;height:${px}px" loading="lazy" onerror="this.parentNode.innerHTML='<b class=&quot;sb-vipfb&quot;>VIP${level}</b>'"></span>`;
    }
    const t = tierOf(kind, level);
    const label = kind === 'wealth' ? 'الثروة' : (kind === 'general' ? 'المستوى' : 'الرواج');
    return `<span class="sb-badge sb-${kind} sb-${kind}-${t.key}${opts.compact ? ' sb-compact' : ''}" title="${label} · ${t.name} · Lv.${level}">${icon(kind + '-' + t.key, t.shape)}<b>${opts.compact ? level : 'Lv.' + level}</b></span>`;
  }

  // الرمز وحده (لخانات الجدول وغيره)
  function iconOnly(kind, level) {
    ensureDefs();
    const t = tierOf(kind, level);
    return icon(kind + '-' + t.key, t.shape);
  }

  // صلاحيات الثروة (مطابقة لما يفرضه السيرفر)
  const MOD_LEVEL = 21, IMMUNE_LEVEL = 26;
  function canWealthModerate(me, target) {
    if (!me || !target) return false;
    const a = Number(me.wealth_level) || 1, t = Number(target.wealth_level) || 1;
    return a >= MOD_LEVEL && a > t && t < IMMUNE_LEVEL;
  }
  function isImmune(user) { return (Number(user && user.wealth_level) || 1) >= IMMUNE_LEVEL; }

  window.SoulBadges = {
    html, iconOnly, tier: tierOf, tiers: (k) => (TIERS[k] || TIERS.wealth).slice(),
    canWealthModerate, isImmune, MOD_LEVEL, IMMUNE_LEVEL
  };
})();
