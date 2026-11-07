/* =====================================================================
 * f7-icons.js — يستبدل الإيموجي بأيقونات Framework7 (class="f7-icons")
 * - يعمل على كل نص يظهر في الصفحة (حتى المحتوى الديناميكي) عبر MutationObserver
 * - يتحقق أن اسم الأيقونة موجود فعلاً في الخط، وإلا يُبقي الإيموجي الأصلي
 * - لا يلمس: رسائل الدردشة، لوحات الإيموجي، الهدايا (محتوى وليس أيقونات)
 * ===================================================================== */
(function () {
  'use strict';

  // [emoji] : ['اسم أو أكثر مفصولة بـ | (الأول الصالح يُستخدم)', 'لون اختياري']
  const MAP = {
    '✨': ['sparkles', 'spark'], '🌟': ['star_fill', 'gold'], '⭐': ['star_fill', 'gold'], '💫': ['sparkles', 'spark'], '🌠': ['sparkles', 'spark'],
    '🎁': ['gift_fill'], '🎙': ['mic_fill'], '🎤': ['mic_fill'], '✕': ['xmark'], '✖': ['xmark'], '✗': ['xmark'],
    '❌': ['xmark_circle_fill', 'red'], '💎': ['suit_diamond_fill', 'cyan'], '💠': ['suit_diamond_fill', 'cyan'],
    '👑': ['star_circle_fill|rosette', 'gold'], '🏆': ['rosette|star_circle_fill', 'gold'], '🏅': ['rosette|star_circle_fill', 'gold'],
    '🪐': ['moon_stars_fill|globe'], '🌌': ['moon_stars_fill|sparkles'], '🔇': ['speaker_slash_fill'], '🔊': ['speaker_2_fill'],
    '🔒': ['lock_fill'], '🔓': ['lock_open_fill'], '🗝': ['lock_open_fill'],
    '✅': ['checkmark_circle_fill', 'green'], '✓': ['checkmark_alt|checkmark'], '✔': ['checkmark_alt|checkmark'],
    '💬': ['chat_bubble_2_fill'], '🔥': ['flame_fill', 'orange'], '🚪': ['square_arrow_right|arrow_right_square_fill|arrow_right'],
    '🪙': ['money_dollar_circle_fill', 'gold'], '💰': ['money_dollar_circle_fill', 'gold'], '⚡': ['bolt_fill', 'spark'],
    '🎉': ['sparkles', 'spark'], '🎊': ['sparkles', 'spark'], '🎈': ['sparkles'], '🎪': ['sparkles'], '🎡': ['sparkles'],
    '🚀': ['rocket_fill|paperplane_fill'], '⚔': ['bolt_horizontal_fill|flame_fill'], '👤': ['person_fill'], '👥': ['person_2_fill'],
    '⏳': ['hourglass'], '🔮': ['sparkles', 'purple'], '➕': ['plus'], '🔴': ['circle_fill', 'red'], '🔵': ['circle_fill', 'blue'], '🟢': ['circle_fill', 'green'],
    '📢': ['speaker_3_fill|bell_fill'], '📣': ['speaker_3_fill|bell_fill'], '🛡': ['shield_fill'], '▶': ['play_fill'], '⏸': ['pause_fill'], '⏭': ['forward_end_fill|forward_fill'],
    '🚫': ['nosign|xmark_circle', 'red'], '⛔': ['nosign|xmark_circle', 'red'], '🛑': ['stop_fill|xmark_octagon_fill', 'red'],
    '🪑': ['person_crop_square_fill|person_fill'], '🖼': ['photo_fill'], '🔔': ['bell_fill'], '👋': ['hand_raised_fill'], '✋': ['hand_raised_fill'],
    '🎵': ['music_note'], '🎶': ['music_note_2'], '🎧': ['headphones'], '🥁': ['music_note_2'], '💡': ['lightbulb_fill', 'spark'],
    '⚠': ['exclamationmark_triangle_fill', 'amber'], '🎲': ['cube_fill|gamecontroller_fill'], '🎮': ['gamecontroller_fill'],
    '📹': ['videocam_fill'], '🎬': ['film_fill|videocam_fill'], '🎞': ['film|videocam'],
    '❤': ['heart_fill', 'heart'], '🤍': ['heart_fill'], '💜': ['heart_fill', 'purple'], '💖': ['heart_fill', 'pink'], '💙': ['heart_fill', 'blue'],
    '💕': ['heart_fill', 'pink'], '💗': ['heart_fill', 'pink'], '💘': ['heart_fill', 'pink'], '💝': ['heart_fill', 'pink'], '💞': ['heart_fill', 'pink'], '💓': ['heart_fill', 'pink'],
    '🖤': ['heart_fill'], '🧡': ['heart_fill', 'orange'], '💛': ['heart_fill', 'gold'], '💚': ['heart_fill', 'green'], '❣': ['heart_fill', 'heart'], '♥': ['heart_fill', 'heart'], '💔': ['heart_slash_fill|heart'],
    '🗑': ['trash_fill'], '🧹': ['trash'], '←': ['arrow_left'], '↩': ['arrow_uturn_left'], '⇄': ['arrow_right_arrow_left|arrow_2_squarepath'],
    '💳': ['creditcard_fill'], '🌍': ['globe'], '🌐': ['globe'], '🔄': ['arrow_clockwise'], '📨': ['envelope_fill'], '✉': ['envelope_fill'], '💌': ['envelope_fill'],
    '🎨': ['paintbrush_fill|paintbrush'], '🏠': ['house_fill'], '🏰': ['house_fill'], '🏪': ['bag_fill'], '🧰': ['bag_fill'],
    '📷': ['camera_fill'], '📸': ['camera_fill'], '🔍': ['search'], '✎': ['pencil'], '✏': ['pencil'], '✍': ['pencil'],
    '🪪': ['person_crop_rectangle_fill|doc_text_fill'], '⛶': ['arrow_up_left_arrow_down_right'], '🌙': ['moon_fill'], '☀': ['sun_max_fill'],
    '🍃': ['leaf_fill', 'green'], '🍀': ['leaf_fill', 'green'], '🌴': ['leaf_fill', 'green'], '📁': ['folder_fill'], '📥': ['tray_arrow_down_fill|arrow_down_circle_fill'], '💾': ['tray_arrow_down_fill|arrow_down_circle_fill'],
    '🖥': ['desktopcomputer'], '💻': ['device_laptop|desktopcomputer'], '📱': ['device_phone_portrait'], '📡': ['antenna_radiowaves_left_right'],
    '🔋': ['battery_100'], '📅': ['calendar'], '📞': ['phone_fill'], '♾': ['infinite'], '💧': ['drop_fill', 'cyan'], '📍': ['location_fill'],
    '👁': ['eye_fill'], '🕵': ['eye_fill'], '🎯': ['scope'], '🏷': ['tag_fill'], '💺': ['person_fill'], '📌': ['pin_fill'], '📦': ['cube_box_fill|bag_fill'],
    '❓': ['question_circle_fill'], '🚩': ['flag_fill', 'red'], '➤': ['paperplane_fill'], '➔': ['arrow_right'], '👏': ['hand_thumbsup_fill'], '🎭': ['smiley_fill'], '🌹': ['leaf_fill'], '🌸': ['leaf_fill'], '🌺': ['leaf_fill'], '❀': ['leaf_fill']
  };

  // عناصر لا نستبدل داخلها (محتوى مستخدمين / لوحات إيموجي / كتالوج الهدايا)
  const EXCLUDE = [
    'script', 'style', 'textarea', 'input', 'select', 'option', 'title', 'noscript', 'svg', 'canvas', '.f7-icons',
    '.room-chat-text', '.room-chat-input', '.room-chat-emoji-img', '.room-chat-card-inner .room-chat-text',
    '.dm-emoji-panel', '.dm-emoji-btn', '.seat-emojis-grid', '.seat-emoji-item-card', '.seat-emojis-picker-drawer',
    '.gift-img', '.gift-shelf-icon', '.gift-details-icon', '.gift-banner-icon', '.gift-3d-icon', '.user-gift-wall-icon',
    '[data-no-f7]', '[contenteditable="true"]'
  ].join(',');

  const KEYS = Object.keys(MAP).sort((a, b) => b.length - a.length);
  const RE = new RegExp('(' + KEYS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\uFE0F?', 'g');

  const resolved = {}; // emoji -> {name,color} أو null إن لم يوجد اسم صالح
  const nameOk = {};   // اسم أيقونة -> صالح أم لا (كاش)
  let ready = false;
  let probeEl = null;

  function widthOf(name, probe) {
    probe.textContent = name;
    return probe.getBoundingClientRect().width;
  }

  function isValidName(n) {
    if (nameOk[n] === undefined) nameOk[n] = widthOf(n, probeEl) < 20 * 1.45; // ligature صالحة = رمز واحد
    return nameOk[n];
  }

  function pickName(cands) {
    for (const n of cands.split('|')) if (isValidName(n.trim())) return n.trim();
    return null;
  }

  function resolveAll() {
    probeEl = document.createElement('span');
    probeEl.className = 'f7-icons';
    probeEl.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;font-size:20px;white-space:nowrap;';
    document.body.appendChild(probeEl);
    KEYS.forEach(k => {
      const [cands, color] = MAP[k];
      const found = pickName(cands);
      resolved[k] = found ? { name: found, color: color || '' } : null;
    });
  }

  // الأيقونات الثابتة المكتوبة يدوياً: <i class="f7-icons">name_a|name_b</i> → أول اسم صالح
  function fixStatic(root) {
    const els = root.nodeType === 1 ? root.querySelectorAll('i.f7-icons:not([data-emo]):not([data-f7ok])') : [];
    els.forEach(el => {
      const txt = (el.textContent || '').trim();
      if (!txt) return;
      const found = pickName(txt);
      el.setAttribute('data-f7ok', '1');
      if (found && found !== txt) el.textContent = found;
    });
    if (root.nodeType === 1 && root.matches && root.matches('i.f7-icons:not([data-emo]):not([data-f7ok])')) {
      const found = pickName((root.textContent || '').trim());
      root.setAttribute('data-f7ok', '1');
      if (found) root.textContent = found;
    }
  }

  function makeIcon(emoji, solo) {
    const info = resolved[emoji];
    const i = document.createElement('i');
    i.className = 'f7-icons f7-emo' + (solo ? ' f7-solo' : '');
    i.setAttribute('data-emo', emoji);
    if (info.color) i.setAttribute('data-c', info.color);
    i.setAttribute('aria-hidden', 'true');
    i.textContent = info.name;
    return i;
  }

  function processTextNode(node) {
    const text = node.nodeValue;
    if (!text || !RE.test(text)) { RE.lastIndex = 0; return; }
    RE.lastIndex = 0;
    const parent = node.parentElement;
    if (!parent || parent.closest(EXCLUDE)) return;
    const frag = document.createDocumentFragment();
    const solo = text.replace(RE, '').trim() === '' && parent.childNodes.length === 1;
    let last = 0, changed = false, m;
    while ((m = RE.exec(text))) {
      const base = m[1];
      if (!resolved[base]) continue;
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      frag.appendChild(makeIcon(base, solo));
      last = m.index + m[0].length;
      changed = true;
    }
    RE.lastIndex = 0;
    if (!changed) return;
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }

  function scan(root) {
    if (!ready || !root) return;
    if (root.nodeType === 3) { processTextNode(root); return; }
    if (root.nodeType !== 1) return;
    fixStatic(root);
    if (root.closest(EXCLUDE)) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)
    });
    const list = [];
    while (w.nextNode()) list.push(w.currentNode);
    list.forEach(processTextNode);
  }

  let queued = new Set(), timer = 0;
  function flush() {
    timer = 0;
    const items = Array.from(queued); queued = new Set();
    items.forEach(n => { if (n.isConnected) scan(n); });
  }

  function start() {
    resolveAll();
    ready = true;
    scan(document.body);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'childList') m.addedNodes.forEach(n => queued.add(n));
        else if (m.type === 'characterData') queued.add(m.target);
      }
      if (!timer) timer = requestAnimationFrame(flush);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function init() {
    // لا نستبدل شيئاً إلا بعد التأكد أن خط الأيقونات تحمّل فعلاً (وإلا تبقى الإيموجي)
    if (!document.fonts || !document.fonts.load) return;
    document.fonts.load('20px "Framework7 Icons"', 'search').then((faces) => {
      if (faces && faces.length) start();
    }).catch(() => {});
  }

  window.F7Icons = { rescan: () => scan(document.body), map: MAP };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
