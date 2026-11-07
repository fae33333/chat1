/* كل الأصناف: شاشة إدارة موحّدة لمتجر الإكسسوارات والغرف والهدايا والإيموجي.
   تعتمد على دوال لوحة الإدارة الموجودة في admin.html (state, escHtml, المعاينة، الحوارات). */
(function () {
  'use strict';

  const CAT_DEFS = [
    { id: 'entry', group: 'store', label: 'مؤثرات الدخول', icon: '🦅', endpoint: '/api/admin/entry-templates', itemKind: 'entry', price: true, duration: true, image: 'media', poster: true },
    { id: 'frames', group: 'store', label: 'إطارات الأفاتار', icon: '🖼️', endpoint: '/api/admin/avatar-frames', itemKind: 'frame', price: true, duration: true, image: 'asset', scale: true },
    { id: 'rooms', group: 'store', label: 'بطاقات الغرف', icon: '🏠', endpoint: '/api/admin/room-cards', itemKind: 'card', price: true, duration: true, image: 'asset', cover: true },
    { id: 'idcard', group: 'store', label: 'بطاقات الصوت', icon: '🪪', endpoint: '/api/admin/store-items', itemKind: 'store', storeCat: 'idcard', price: true, duration: true, image: 'asset', badge: true, sort: true },
    { id: 'bubble', group: 'store', label: 'فقاعات الدخول', icon: '💬', endpoint: '/api/admin/store-items', itemKind: 'store', storeCat: 'bubble', price: true, permanent: true, image: 'asset', badge: true, sort: true },
    { id: 'chatbubble', group: 'store', label: 'فقاعات الدردشة', icon: '💭', endpoint: '/api/admin/store-items', itemKind: 'store', storeCat: 'chatbubble', price: true, permanent: true, image: 'asset', badge: true, sort: true },
    { id: 'mic', group: 'store', label: 'مقاعد المايك', icon: '🎙️', endpoint: '/api/admin/store-items', itemKind: 'store', storeCat: 'mic', price: true, permanent: true, image: 'asset', badge: true, sort: true },
    { id: 'bgs', group: 'room', label: 'خلفيات الغرف', icon: '🌄', endpoint: '/api/admin/room-backgrounds', itemKind: 'bg', price: true, image: 'asset', cover: true },
    { id: 'gifts', group: 'gifts', label: 'الهدايا', icon: '🎁', endpoint: '/api/admin/gifts', itemKind: 'gift', price: true, image: 'gift', gift: true },
    { id: 'emojis', group: 'room', label: 'الإيموجي', icon: '😄', endpoint: '/api/admin/room-emojis', itemKind: 'emoji', image: 'emoji', nameless: true }
  ];
  const CAT_GROUPS = [
    { id: 'store', title: 'المتجر والإكسسوارات' },
    { id: 'room', title: 'الغرفة' },
    { id: 'gifts', title: 'الهدايا' }
  ];
  const DEFAULT_PRICE = { entry: 100, frames: 100, rooms: 2000, idcard: 1000, bubble: 1000, chatbubble: 1000, mic: 1000, bgs: 0, gifts: 100, emojis: 0 };
  const ACCEPT = {
    media: 'image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,text/html,.mp4,.webm,.html,.htm',
    asset: 'image/png,image/jpeg,image/gif,image/webp,text/html,.html,.htm',
    gift: 'image/png,image/jpeg,image/gif,image/webp',
    emoji: 'image/png,image/jpeg,image/gif,image/webp',
    frame: 'image/png,image/webp,image/gif',
    effect: 'image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,text/html,.html,.htm'
  };
  const HINTS = {
    media: 'PNG / JPG / GIF / WEBP / MP4 / WEBM حتى 25MB، أو HTML حتى 15MB',
    asset: 'PNG / JPG / GIF / WEBP حتى 25MB، أو HTML حتى 15MB',
    gift: 'PNG / JPG / GIF / WEBP حتى 25MB. بدون صورة اكتب إيموجي بديلاً.',
    emoji: 'PNG / JPG / GIF / WEBP حتى 25MB — يمكن اختيار عدة صور دفعة واحدة'
  };

  const catalogState = {
    items: [],
    filter: 'all',
    q: '',
    status: 'all',
    warnings: [],
    loading: false,
    queued: false,
    editing: null,
    bound: false,
    autoName: '',
    pickUrls: []
  };

  const $ = (id) => document.getElementById(id);
  function setVal(id, value) {
    const el = $(id);
    if (!el) return;
    const v = value == null ? '' : String(value);
    try { el.value = v; } catch (e) {
      const opt = el.querySelector && el.querySelector(`option[value="${v.replace(/"/g, '')}"]`);
      if (opt) opt.selected = true;
    }
  }
  const catalogDef = (id) => CAT_DEFS.find(d => d.id === id) || null;
  const onFlag = (v) => v === 1 || v === true || v === '1' || v === 'true';
  const adminToken = () => {
    try { if (typeof state !== 'undefined' && state && state.token) return state.token; } catch (e) {}
    try { return sessionStorage.getItem('soulchill_admin_token') || ''; } catch (e) { return ''; }
  };
  const authHeaders = () => ({ 'x-admin-token': adminToken() });

  function normalize(def, row) {
    const gift = def.itemKind === 'gift';
    const name = String(row.name || '').trim();
    return {
      id: String(row.id),
      defId: def.id,
      kind: def.itemKind,
      name: name || (def.itemKind === 'emoji' ? 'إيموجي' : 'بدون اسم'),
      image: row.image_url || '',
      poster: row.poster_url || '',
      price: gift ? Number(row.cost || 0) : Number(row.price || 0),
      currency: row.currency || (gift ? 'coins' : 'diamonds'),
      duration: Number(row.duration_days || 0),
      scale: row.scale == null ? 1.3 : Number(row.scale),
      badge: row.badge || '',
      sort: Number(row.sort_order || 0),
      active: row.is_active === undefined ? true : onFlag(row.is_active),
      owners: Number(row.owners_count || 0),
      sent: Number(row.sent_count || 0),
      icon: row.icon || '',
      giftTab: (row.luxury || row.tab === 'luxury') ? 'luxury' : 'normal',
      burst: onFlag(row.burst_enabled),
      burstCount: Number(row.burst_count || 20),
      banner: onFlag(row.banner_enabled),
      frameUrl: row.banner_frame_url || '',
      effectUrl: row.effect_url || ''
    };
  }

  function catalogFind(defId, id) {
    return catalogState.items.find(it => it.defId === defId && it.id === id) || null;
  }

  function catalogVisible(item) {
    if (catalogState.filter !== 'all' && item.defId !== catalogState.filter) return false;
    if (catalogState.status === 'on' && !item.active) return false;
    if (catalogState.status === 'off' && item.active) return false;
    const q = catalogState.q.trim().toLowerCase();
    if (!q) return true;
    return [item.name, item.badge, item.icon, item.id].some(v => String(v || '').toLowerCase().includes(q));
  }

  function priceText(item) {
    const def = catalogDef(item.defId);
    if (!def || !def.price) return '';
    const n = Number(item.price || 0).toLocaleString('en-US');
    if (item.kind === 'gift') return n + (item.currency === 'coins' ? ' 🪙' : ' 💎');
    return item.price ? n + ' 💎' : 'مجاني';
  }
  function durationText(item) {
    const def = catalogDef(item.defId);
    if (!def || (!def.duration && !def.permanent)) return '';
    if (def.permanent || !item.duration) return 'دائم';
    return item.duration + ' يوم';
  }

  function thumbInner(item) {
    if (!item.image) return `<span class="cat-fallback">${escHtml(item.icon || '—')}</span>`;
    if (isHtmlUrl(item.image)) return '<span class="cat-fallback cat-code">&lt;/&gt;</span>';
    if (isVideoUrl(item.image)) {
      if (item.poster) return `<img src="${escHtml(item.poster)}" alt="" loading="lazy" />`;
      return `<video src="${escHtml(item.image)}#t=0.5" muted playsinline preload="metadata"></video>`;
    }
    if (item.poster && /\.(gif|webp)(\?|#|$)/i.test(item.image)) return `<img src="${escHtml(item.poster)}" alt="" loading="lazy" />`;
    return `<img src="${escHtml(item.image)}" alt="" loading="lazy" />`;
  }

  function tagsHtml(item) {
    const tags = [];
    if (item.badge) tags.push(item.badge);
    if (item.kind === 'gift' && item.giftTab === 'luxury') tags.push('فاخرة');
    if (item.kind === 'gift' && item.burst) tags.push('تطاير');
    if (item.kind === 'gift' && (item.banner || item.giftTab === 'luxury')) tags.push('إعلان');
    if (item.kind === 'gift' && item.effectUrl) tags.push('مؤثر');
    if (!tags.length) return '';
    return `<div class="cat-tags">${tags.map(t => `<span>${escHtml(t)}</span>`).join('')}</div>`;
  }

  function cardHtml(item) {
    const def = catalogDef(item.defId);
    const current = catalogState.editing && catalogState.editing.id === item.id && catalogState.editing.defId === item.defId;
    const extra = item.kind === 'gift'
      ? (item.sent ? `أُرسلت ${Number(item.sent).toLocaleString('en-US')}` : '')
      : (item.kind === 'emoji' ? '' : (item.owners ? `يملكه ${Number(item.owners).toLocaleString('en-US')}` : ''));
    const meta = [priceText(item), durationText(item), extra].filter(Boolean).map(escHtml).join(' · ');
    const kind = item.image ? (isHtmlUrl(item.image) ? 'html' : (isVideoUrl(item.image) ? 'video' : 'image')) : '';
    const preview = item.image ? ` data-act="preview" data-url="${escHtml(item.image)}" data-kind="${kind}"` : '';
    return `<article class="cat-card${item.active ? '' : ' is-off'}${current ? ' is-current' : ''}${def && def.cover ? ' cover' : ''}" data-def="${escHtml(item.defId)}" data-id="${escHtml(item.id)}">
      <div class="cat-row-main">
        <span class="cat-row-mark" aria-hidden="true">${def ? def.icon : ''}</span>
        <div class="cat-thumb"${preview}>${thumbInner(item)}</div>
        <div class="cat-row-copy">
          <div class="cat-name-row">
            <div class="cat-name" title="${escHtml(item.name)}">${escHtml(item.name)}</div>
            <span class="cat-flag${item.active ? '' : ' off'}">${item.active ? 'ظاهر' : 'مخفي'}</span>
          </div>
          ${tagsHtml(item)}
          ${meta ? `<div class="cat-meta">${meta}</div>` : ''}
        </div>
      </div>
      <div class="cat-actions">
        <button type="button" class="btn-action gold" data-act="edit" aria-label="تعديل"><span class="cat-act-ico" aria-hidden="true">✏️</span><span class="cat-act-txt">تعديل</span></button>
        <button type="button" class="btn-action" data-act="toggle" aria-label="${item.active ? 'إخفاء' : 'إظهار'}"><span class="cat-act-ico" aria-hidden="true">${item.active ? '🙈' : '👁️'}</span><span class="cat-act-txt">${item.active ? 'إخفاء' : 'إظهار'}</span></button>
        <button type="button" class="btn-action danger" data-act="delete" aria-label="حذف"><span class="cat-act-ico" aria-hidden="true">🗑️</span><span class="cat-act-txt">حذف</span></button>
      </div>
    </article>`;
  }

  function renderChips() {
    const el = $('cat-chips');
    if (!el) return;
    const left = el.scrollLeft;
    const counts = {};
    catalogState.items.forEach(it => { counts[it.defId] = (counts[it.defId] || 0) + 1; });
    const chips = [{ id: 'all', label: 'الكل', icon: '✦' }].concat(CAT_DEFS);
    el.innerHTML = chips.map(c => {
      const n = c.id === 'all' ? catalogState.items.length : (counts[c.id] || 0);
      const on = catalogState.filter === c.id;
      return `<button type="button" class="cat-chip${on ? ' is-on' : ''}" role="tab" aria-selected="${on ? 'true' : 'false'}" data-act="filter" data-def="${c.id}"><span>${c.icon}</span>${escHtml(c.label)}<b>${n}</b></button>`;
    }).join('');
    el.scrollLeft = left;
    document.querySelectorAll('#cat-legend-list [data-def]').forEach(b => {
      b.classList.toggle('is-on', b.dataset.def === catalogState.filter);
    });
    const badge = $('cat-nav-count');
    if (badge) badge.textContent = catalogState.items.length ? String(catalogState.items.length) : '';
  }

  function renderSummary() {
    const el = $('cat-summary');
    if (!el) return;
    const all = catalogState.items;
    const on = all.filter(i => i.active).length;
    const shown = all.filter(catalogVisible).length;
    let text = `${all.length.toLocaleString('ar-EG')} عنصراً · ${on.toLocaleString('ar-EG')} ظاهر · ${(all.length - on).toLocaleString('ar-EG')} مخفي`;
    if (catalogState.q || catalogState.status !== 'all' || catalogState.filter !== 'all') text += ` · المعروض ${shown.toLocaleString('ar-EG')}`;
    if (catalogState.warnings.length) text += ` · تعذر تحميل: ${catalogState.warnings.join('، ')}`;
    el.textContent = text;
  }

  function renderBoard() {
    const board = $('cat-board');
    if (!board) return;
    if (catalogState.loading && !catalogState.items.length) return;
    const filtering = !!(catalogState.q.trim() || catalogState.status !== 'all');
    const groups = catalogState.filter === 'all'
      ? CAT_GROUPS
      : [{ id: 'one', title: '', ids: [catalogState.filter] }];
    let html = '';
    let any = false;
    groups.forEach(group => {
      const defs = group.id === 'one'
        ? [catalogDef(group.ids[0])].filter(Boolean)
        : CAT_DEFS.filter(d => d.group === group.id);
      const sections = defs.map(def => ({ def, items: catalogState.items.filter(it => it.defId === def.id && catalogVisible(it)) }))
        .filter(s => catalogState.filter !== 'all' || !filtering || s.items.length);
      if (!sections.length) return;
      any = true;
      if (group.title && catalogState.filter === 'all') html += `<div class="cat-group-title">${escHtml(group.title)}</div>`;
      sections.forEach(s => {
        html += `<section class="cat-section" id="cat-sec-${s.def.id}">
          <div class="cat-section-head">
            <div class="cat-section-title"><span>${s.def.icon}</span> ${escHtml(s.def.label)} <b>${s.items.length}</b></div>
            <button type="button" class="btn-action gold" data-act="add" data-def="${s.def.id}">إضافة</button>
          </div>
          ${s.items.length ? `<div class="cat-grid">${s.items.map(cardHtml).join('')}</div>` : `<div class="cat-empty">${filtering ? 'لا توجد عناصر مطابقة في هذا القسم.' : 'لا توجد عناصر في هذا القسم بعد.'}</div>`}
        </section>`;
      });
    });
    if (!any) {
      html = `<div class="cat-empty">${catalogState.q ? 'لا توجد نتائج مطابقة للبحث.' : 'لا توجد عناصر بعد.'}<div style="margin-top:10px"><button type="button" class="btn-action gold" data-act="add">إضافة عنصر</button></div></div>`;
    }
    if (catalogState.warnings.length && !catalogState.items.length) {
      html = `<div class="cat-warn">تعذر تحميل: ${escHtml(catalogState.warnings.join('، '))}</div>` + html;
    }
    board.innerHTML = html;
  }

  function catalogSkeleton() {
    return `<div class="cat-grid">${Array.from({ length: 8 }, () => '<div class="cat-card cat-skel"></div>').join('')}</div>`;
  }

  async function loadCatalog() {
    if (!$('tab-catalog')) return;
    if (catalogState.loading) { catalogState.queued = true; return; }
    if (window.__catalogFilter) {
      catalogState.filter = window.__catalogFilter;
      window.__catalogFilter = '';
    }
    catalogState.loading = true;
    const board = $('cat-board');
    if (board && !catalogState.items.length) board.innerHTML = catalogSkeleton();
    if ($('cat-summary') && !catalogState.items.length) $('cat-summary').textContent = 'جارٍ تحميل الأصناف…';
    const specs = [
      { label: 'مؤثرات الدخول', url: '/api/admin/entry-templates', key: 'templates', defId: 'entry' },
      { label: 'الإطارات', url: '/api/admin/avatar-frames', key: 'frames', defId: 'frames' },
      { label: 'بطاقات الغرف', url: '/api/admin/room-cards', key: 'cards', defId: 'rooms' },
      { label: 'عناصر المتجر', url: '/api/admin/store-items', key: 'items', store: true },
      { label: 'الخلفيات', url: '/api/admin/room-backgrounds', key: 'backgrounds', defId: 'bgs' },
      { label: 'الهدايا', url: '/api/admin/gifts', key: 'gifts', defId: 'gifts' },
      { label: 'الإيموجي', url: '/api/admin/room-emojis', key: 'emojis', defId: 'emojis' }
    ];
    try {
      const results = await Promise.all(specs.map(async (spec) => {
        try {
          const res = await fetch(spec.url, { headers: authHeaders() });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || spec.label);
          return { spec, data };
        } catch (e) {
          return { spec, error: e.message || spec.label };
        }
      }));
      const failed = results.filter(r => r.error).map(r => r.spec.label);
      catalogState.failedAll = failed.length === specs.length;
      if (catalogState.failedAll && catalogState.items.length) {
        showAdminNotice('تعذر تحديث الأصناف');
      } else if (catalogState.failedAll) {
        catalogState.warnings = failed;
        if (board) board.innerHTML = `<div class="cat-warn">تعذر تحميل الأصناف. <button type="button" class="btn-action" data-act="retry">إعادة المحاولة</button></div>`;
      } else {
        const items = [];
        results.forEach(r => {
          if (r.error) return;
          const rows = (r.data && r.data[r.spec.key]) || [];
          if (r.spec.store) {
            rows.forEach(row => {
              const def = CAT_DEFS.find(d => d.storeCat && d.storeCat === row.category);
              if (def) items.push(normalize(def, row));
            });
          } else {
            const def = catalogDef(r.spec.defId);
            rows.forEach(row => items.push(normalize(def, row)));
          }
        });
        catalogState.items = items;
        catalogState.warnings = failed;
      }
    } catch (e) {
      showAdminNotice(e.message || 'تعذر تحميل الأصناف');
    } finally {
      catalogState.loading = false;
      renderChips();
      renderSummary();
      if (!catalogState.failedAll) renderBoard();
      if (catalogState.queued) { catalogState.queued = false; loadCatalog(); }
    }
  }

  function showField(id, on) {
    const el = $(id);
    if (el) el.hidden = !on;
  }

  function ensureDuration(days) {
    const sel = $('cat-duration');
    const v = String(Number(days || 0));
    if (![...sel.options].some(o => o.value === v)) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v === '0' ? 'دائم' : (v + ' يوم');
      sel.appendChild(opt);
    }
    setVal('cat-duration', v);
  }

  function fillKindOptions(item) {
    const sel = $('cat-kind');
    const list = !item ? CAT_DEFS : (item.kind === 'store' ? CAT_DEFS.filter(d => d.itemKind === 'store') : CAT_DEFS.filter(d => d.id === item.defId));
    sel.innerHTML = list.map(d => `<option value="${d.id}">${escHtml(d.label)}</option>`).join('');
  }

  function applyKindDefaults() {
    const def = catalogDef($('cat-kind').value);
    if (!def) return;
    setVal('cat-price', DEFAULT_PRICE[def.id] ?? 0);
    setVal('cat-duration', '0');
    setVal('cat-scale', '1.3');
    setVal('cat-sort', '0');
    setVal('cat-currency', 'coins');
    setVal('cat-gift-tab', 'normal');
    $('cat-burst').checked = false;
    $('cat-burst-count').value = '20';
    $('cat-banner').checked = false;
  }

  function applyKindVisibility() {
    const def = catalogDef($('cat-kind').value);
    if (!def) return;
    const editing = !!catalogState.editing;
    showField('cat-field-name', !def.nameless);
    showField('cat-field-price', !!def.price);
    showField('cat-field-currency', def.itemKind === 'gift');
    showField('cat-field-duration', !!def.duration && !def.permanent);
    showField('cat-field-gift-tab', def.itemKind === 'gift');
    showField('cat-field-scale', !!def.scale);
    showField('cat-field-badge', !!def.badge);
    showField('cat-field-sort', !!def.sort);
    showField('cat-field-icon', def.itemKind === 'gift');
    showField('cat-field-poster', !!def.poster);
    showField('cat-field-gift-fx', def.itemKind === 'gift');
    showField('cat-permanent-note', !!def.permanent);
    const img = $('cat-image');
    img.multiple = def.itemKind === 'emoji' && !editing;
    img.accept = ACCEPT[def.image] || ACCEPT.asset;
    $('cat-name').maxLength = def.itemKind === 'gift' ? 40 : 60;
    $('cat-price-label').textContent = def.itemKind === 'gift' ? 'السعر' : 'السعر بالكرستالات 💎 (0 = مجاني)';
    const labels = {
      media: editing ? 'استبدال الملف (اختياري)' : 'صورة أو فيديو أو HTML',
      asset: editing ? 'استبدال الملف (اختياري)' : 'صورة أو ملف HTML',
      gift: editing ? 'استبدال صورة الهدية (اختياري)' : 'صورة الهدية',
      emoji: editing ? 'استبدال الصورة (اختياري)' : 'صور الإيموجي'
    };
    $('cat-image-label').textContent = labels[def.image] || 'الملف';
    $('cat-file-hint').textContent = HINTS[def.image] || '';
    const original = catalogState.editing ? catalogDef(catalogState.editing.defId) : null;
    $('cat-kind').disabled = !!(original && original.itemKind !== 'store');
  }

  function fillFromItem(item) {
    setVal('cat-name', item.kind === 'emoji' && item.name === 'إيموجي' ? '' : item.name);
    setVal('cat-price', item.price);
    ensureDuration(item.duration);
    setVal('cat-scale', item.scale || 1.3);
    setVal('cat-badge', item.badge || '');
    setVal('cat-sort', item.sort || 0);
    setVal('cat-icon', item.icon || '');
    setVal('cat-currency', item.currency === 'diamonds' ? 'diamonds' : 'coins');
    setVal('cat-gift-tab', item.giftTab === 'luxury' ? 'luxury' : 'normal');
    $('cat-burst').checked = !!item.burst;
    setVal('cat-burst-count', item.burstCount || 20);
    $('cat-banner').checked = !!item.banner;
    $('cat-remove-frame').checked = false;
    $('cat-remove-effect').checked = false;
    const fw = $('cat-frame-current');
    fw.hidden = !item.frameUrl;
    fw.style.display = item.frameUrl ? 'block' : 'none';
    if (item.frameUrl) fw.src = item.frameUrl;
    const ew = $('cat-effect-current');
    ew.hidden = !item.effectUrl;
    ew.textContent = item.effectUrl ? ('المؤثر الحالي: ' + item.effectUrl.split('/').pop()) : '';
    $('cat-remove-frame-wrap').hidden = !item.frameUrl;
    $('cat-remove-effect-wrap').hidden = !item.effectUrl;
  }

  function showCatalogCurrentMedia(item) {
    if (typeof resetEntryPreview === 'function') resetEntryPreview('cat-preview');
    if (!item || !item.image) return;
    if (item.kind === 'entry') {
      if (isHtmlUrl(item.image)) {
        if (item.poster) showMediaInPreview('cat-preview', item.poster, false);
        setEntryPlayBtn('cat-preview', item.image, 'معاينة HTML', 'html');
      } else if (isVideoUrl(item.image) && item.poster) {
        showMediaInPreview('cat-preview', item.poster, false);
        setEntryPlayBtn('cat-preview', item.image);
      } else if (item.poster && /\.(gif|webp)(\?|#|$)/i.test(item.image)) {
        showMediaInPreview('cat-preview', item.poster, false);
        setEntryPlayBtn('cat-preview', item.image, '▶ معاينة المتحركة', 'image');
      } else {
        showMediaInPreview('cat-preview', item.image, isVideoUrl(item.image));
      }
      return;
    }
    if (typeof showAssetCurrent === 'function') showAssetCurrent('cat-preview', item.image);
  }

  function syncEditorLock() {
    const editor = $('catalog-editor');
    const studio = document.querySelector('.cat-studio');
    document.body.classList.remove('cat-editor-lock');
    document.body.classList.toggle('cat-editing', !!(editor && !editor.hidden));
    if (studio) {
      studio.classList.remove('is-editing');
      studio.style.paddingInlineEnd = '';
    }
    if (!editor) return;
    editor.style.left = editor.style.right = editor.style.width = editor.style.top = editor.style.bottom = '';
    editor.style.insetInlineStart = editor.style.insetInlineEnd = '';
  }

  function openCatalogEditor(item, preset) {
    const editor = $('catalog-editor');
    if (!editor) return;
    try { $('cat-editor-form').reset(); } catch (e) {}
    $('cat-emoji-picks').innerHTML = '';
    ['cat-frame', 'cat-effect', 'cat-image', 'cat-poster'].forEach(id => { try { $(id).value = ''; } catch (e) {} });
    if (typeof resetEntryPreview === 'function') resetEntryPreview('cat-preview');
    catalogState.editing = item ? { id: item.id, defId: item.defId } : null;
    catalogState.autoName = '';
    fillKindOptions(item);
    const want = item ? item.defId : (preset && preset !== 'all' ? preset : (catalogState.filter !== 'all' ? catalogState.filter : 'entry'));
    setVal('cat-kind', want || 'entry');
    if (item) fillFromItem(item);
    else applyKindDefaults();
    applyKindVisibility();
    if (item) showCatalogCurrentMedia(item);
    $('cat-editor-kicker').textContent = item ? 'تعديل' : 'عنصر جديد';
    $('cat-editor-title').textContent = item ? item.name : ('إضافة إلى ' + ((catalogDef($('cat-kind').value) || {}).label || 'الأصناف'));
    $('cat-save-btn').textContent = item ? 'حفظ التعديلات' : 'إضافة الآن';
    editor.hidden = false;
    syncEditorLock();
    document.querySelectorAll('#cat-board .cat-card').forEach(el => {
      el.classList.toggle('is-current', !!(item && el.dataset.id === item.id && el.dataset.def === item.defId));
    });
    try { editor.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
    const focusEl = $(item && item.kind === 'emoji' ? 'cat-image' : 'cat-name');
    setTimeout(() => { try { focusEl.focus({ preventScroll: true }); } catch (e) { try { focusEl.focus(); } catch (err) {} } }, 60);
  }

  function closeCatalogEditor() {
    const editor = $('catalog-editor');
    if (editor) editor.hidden = true;
    const studio = document.querySelector('.cat-studio');
    if (studio) studio.classList.remove('is-editing');
    catalogState.editing = null;
    document.body.classList.remove('cat-editor-lock');
    document.body.classList.remove('cat-editing');
    document.querySelectorAll('.cat-card.is-current').forEach(el => el.classList.remove('is-current'));
  }

  function assertFile(file, mode) {
    if (!file) return;
    const html = typeof isHtmlFile === 'function' && isHtmlFile(file);
    const video = /^video\//.test(file.type || '') || /\.(mp4|webm|mov|m4v)$/i.test(file.name || '');
    const allowHtml = mode === 'media' || mode === 'asset' || mode === 'effect';
    const allowVideo = mode === 'media' || mode === 'effect';
    if (html) {
      if (!allowHtml) throw new Error('هذا القسم لا يقبل ملفات HTML');
      if (file.size > 15 * 1024 * 1024) throw new Error('حجم ملف HTML أكبر من 15MB');
      return;
    }
    if (video && !allowVideo) throw new Error('هذا القسم لا يقبل الفيديو');
    if (file.size > 25 * 1024 * 1024) throw new Error('حجم الملف أكبر من 25MB');
  }

  async function apiForm(url, method, fd) {
    const res = await fetch(url, { method, headers: authHeaders(), body: fd });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('انتهت جلسة الإدارة، سجّل الدخول من جديد');
    if (!res.ok || data.success === false) throw new Error(data.error || 'تعذر الحفظ');
    return data;
  }

  async function appendEntryPoster(fd, file) {
    const posterInput = $('cat-poster');
    const animated = !!file && typeof isAnimatedImageFile === 'function' && isAnimatedImageFile(file);
    if (file && (/^video\//.test(file.type || '') || animated)) {
      const custom = posterInput.files && posterInput.files[0];
      if (!custom && typeof entryPosterBlobs !== 'undefined' && !entryPosterBlobs['cat-preview']) {
        const blob = animated ? await captureImagePoster(file) : await captureVideoPoster(file);
        if (blob) entryPosterBlobs['cat-preview'] = blob;
      }
    }
    const item = catalogState.editing ? catalogFind(catalogState.editing.defId, catalogState.editing.id) : null;
    const needs = file
      ? (/^video\//.test(file.type || '') || animated || (typeof isHtmlFile === 'function' && isHtmlFile(file)))
      : (item && (isVideoUrl(item.image) || isHtmlUrl(item.image)));
    if (needs && typeof entryPosterForUpload === 'function') {
      const pp = entryPosterForUpload('cat-preview', 'cat-poster');
      if (pp) fd.append('poster', pp.blob, pp.name);
    }
  }

  async function uploadEmojis(files) {
    let done = 0;
    let failed = 0;
    let lastError = '';
    for (let i = 0; i < files.length; i += 8) {
      const part = files.slice(i, i + 8);
      part.forEach(f => assertFile(f, 'emoji'));
      const fd = new FormData();
      part.forEach(f => fd.append('images', f));
      try {
        const data = await apiForm('/api/admin/room-emojis', 'POST', fd);
        done += data.count || part.length;
      } catch (e) {
        failed += part.length;
        lastError = e.message || '';
      }
    }
    if (failed) showAdminNotice(`تعذر رفع ${failed} صورة. ${lastError}`);
    if (!done) throw new Error(lastError || 'تعذر رفع الصور');
    showToast(`تمت إضافة ${done} إيموجي`, 'success');
  }

  async function saveCatalogItem(def) {
    const editing = catalogState.editing;
    const name = $('cat-name').value.trim();
    const price = parseInt($('cat-price').value, 10);
    const fileInput = $('cat-image');
    const files = Array.from(fileInput.files || []);
    const file = files[0] || null;
    if (!def.nameless && !name) throw new Error('يرجى كتابة الاسم');
    if (name.length > (def.itemKind === 'gift' ? 40 : 60)) throw new Error('الاسم أطول من المسموح');
    if (def.price && (!Number.isFinite(price) || price < 0)) throw new Error('يرجى إدخال سعر صحيح');
    if (!editing && def.itemKind === 'emoji' && !files.length) throw new Error('يرجى اختيار صورة واحدة على الأقل');
    if (!editing && def.itemKind !== 'gift' && def.itemKind !== 'emoji' && !file) throw new Error('يرجى اختيار ملف');
    if (!editing && def.itemKind === 'gift' && !file && !$('cat-icon').value.trim()) throw new Error('ارفع صورة للهدية أو اكتب إيموجي');
    if (def.itemKind === 'emoji' && !editing) {
      if (files.length > 100) throw new Error('الحد الأقصى 100 صورة في الدفعة');
      await uploadEmojis(files);
      return;
    }
    files.forEach(f => assertFile(f, def.image));
    if (def.scale) {
      const scale = parseFloat($('cat-scale').value);
      if (!Number.isFinite(scale) || scale < 1 || scale > 2) throw new Error('حجم الإطار يجب أن يكون بين 1 و 2');
    }
    const fd = new FormData();
    if (def.itemKind === 'gift') {
      const tab = $('cat-gift-tab').value === 'luxury' ? 'luxury' : 'normal';
      const burstCount = Math.min(60, Math.max(1, parseInt($('cat-burst-count').value, 10) || 20));
      fd.append('name', name);
      fd.append('cost', String(price));
      fd.append('currency', $('cat-currency').value === 'diamonds' ? 'diamonds' : 'coins');
      fd.append('tab', tab);
      fd.append('icon', $('cat-icon').value.trim());
      fd.append('luxury', tab === 'luxury' ? '1' : '0');
      fd.append('burst_enabled', $('cat-burst').checked ? '1' : '0');
      fd.append('burst_count', String(burstCount));
      fd.append('banner_enabled', $('cat-banner').checked ? '1' : '0');
      if (file) fd.append('image', file);
      const frame = $('cat-frame').files[0];
      const effect = $('cat-effect').files[0];
      if (frame) { assertFile(frame, 'frame'); fd.append('frame', frame); }
      if (effect) { assertFile(effect, 'effect'); fd.append('effect', effect); }
      if ($('cat-remove-frame').checked) fd.append('remove_frame', '1');
      if ($('cat-remove-effect').checked) fd.append('remove_effect', '1');
    } else if (def.itemKind === 'emoji') {
      if (file) fd.append('image', file);
    } else {
      fd.append('name', name);
      fd.append('price', String(price));
      if (def.duration && !def.permanent) fd.append('duration_days', $('cat-duration').value || '0');
      else if (def.itemKind === 'store') fd.append('duration_days', '0');
      if (def.itemKind === 'store') {
        fd.append('category', def.storeCat);
        fd.append('badge', $('cat-badge').value.trim().slice(0, 20));
        fd.append('sort_order', $('cat-sort').value || '0');
      }
      if (def.scale) fd.append('scale', $('cat-scale').value || '1.3');
      if (file) fd.append('image', file);
      if (def.poster) await appendEntryPoster(fd, file);
    }
    const url = editing ? `${def.endpoint}/${encodeURIComponent(editing.id)}` : def.endpoint;
    await apiForm(url, editing ? 'PUT' : 'POST', fd);
    showToast(editing ? 'تم حفظ التعديلات' : 'تمت الإضافة', 'success');
  }

  function submitCatalogEditor(e) {
    e.preventDefault();
    const def = catalogDef($('cat-kind').value);
    if (!def) return;
    const btn = $('cat-save-btn');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'جارٍ الحفظ…';
    saveCatalogItem(def).then(() => {
      closeCatalogEditor();
      return loadCatalog();
    }).catch(err => {
      showAdminNotice(err.message || 'تعذر الحفظ');
    }).finally(() => {
      btn.disabled = false;
      btn.textContent = old;
    });
  }

  function deleteMessage(item) {
    const n = item.owners;
    if (item.kind === 'emoji') return 'هل تريد حذف هذا الإيموجي نهائياً؟';
    if (item.kind === 'gift') return 'هل تريد حذف هذه الهدية نهائياً؟ الهدايا التي أُرسلت سابقاً تبقى في خزائن المستخدمين.';
    if (item.kind === 'bg' && n > 0) return `هذه الخلفية اشتراها ${n} مستخدم. الحذف يسحبها منهم وتعود الغرف التي تستخدمها للخلفية الافتراضية. للإيقاف فقط استخدم «إخفاء». حذف نهائي؟`;
    if (n > 0) return `هذا العنصر يملكه ${n} مستخدم. الحذف يسحبه منهم دون استرجاع الكرستالات. للإيقاف مع بقائه لدى من اشتراه استخدم «إخفاء». حذف نهائي؟`;
    return 'هل تريد حذف هذا العنصر نهائياً؟';
  }

  async function toggleCatalogItem(item) {
    const def = catalogDef(item.defId);
    const fd = new FormData();
    fd.append('is_active', item.active ? '0' : '1');
    await apiForm(`${def.endpoint}/${encodeURIComponent(item.id)}`, 'PUT', fd);
    showToast(item.active ? 'تم إخفاء العنصر' : 'العنصر ظاهر الآن', 'info');
    await loadCatalog();
  }

  async function deleteCatalogItem(item) {
    const ok = await uiConfirm(deleteMessage(item), { icon: '🗑️', danger: true, okText: 'حذف' });
    if (!ok) return;
    const def = catalogDef(item.defId);
    const res = await fetch(`${def.endpoint}/${encodeURIComponent(item.id)}`, { method: 'DELETE', headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('انتهت جلسة الإدارة، سجّل الدخول من جديد');
    if (!res.ok || data.success === false) throw new Error(data.error || 'تعذر الحذف');
    if (catalogState.editing && catalogState.editing.id === item.id) closeCatalogEditor();
    showToast('تم الحذف', 'info');
    await loadCatalog();
  }

  // اسم العنصر من اسم الملف: بدون الامتداد، والشرطات/الشرطات السفلية تتحول لمسافات
  function nameFromFile(file) {
    let n = String((file && file.name) || '').replace(/\.[^.\/\\]+$/, '');
    n = n.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return n;
  }
  function autoFillNameFromFile(def, file) {
    if (!def || def.nameless || !file) return;
    const nameEl = $('cat-name');
    if (!nameEl) return;
    const cur = nameEl.value.trim();
    // لا نغيّر اسماً كتبه المشرف يدوياً أو اسم عنصر موجود قيد التعديل
    if (catalogState.editing) return;
    if (cur && cur !== catalogState.autoName) return;
    const n = nameFromFile(file).slice(0, nameEl.maxLength > 0 ? nameEl.maxLength : 60);
    if (!n) return;
    nameEl.value = n;
    catalogState.autoName = n;
  }

  function onCatalogFilePick() {
    const input = $('cat-image');
    const def = catalogDef($('cat-kind').value);
    if (input.files && input.files[0] && !(def && def.itemKind === 'emoji')) autoFillNameFromFile(def, input.files[0]);
    const grid = $('cat-emoji-picks');
    catalogState.pickUrls.forEach(u => URL.revokeObjectURL(u));
    catalogState.pickUrls = [];
    grid.innerHTML = '';
    if (!def) return;
    if (def.itemKind === 'emoji' && input.multiple) {
      const files = Array.from(input.files || []);
      $('cat-file-hint').textContent = files.length ? (`تم تحديد ${files.length} صورة`) : (HINTS.emoji);
      catalogState.pickUrls = files.slice(0, 40).map(f => URL.createObjectURL(f));
      catalogState.pickUrls.forEach(src => {
        const im = document.createElement('img');
        im.src = src;
        im.alt = '';
        grid.appendChild(im);
      });
      return;
    }
    try {
      if (def.itemKind === 'entry' && typeof previewEntryTplFile === 'function') previewEntryTplFile(input, 'cat-preview');
      else if (typeof previewAssetFile === 'function') previewAssetFile(input, 'cat-preview');
    } catch (e) {}
  }

  function onCatalogClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el || !e.currentTarget.contains(el) || el.closest('#catalog-editor')) return;
    const act = el.dataset.act;
    if (act === 'filter') {
      catalogState.filter = el.dataset.def || 'all';
      renderChips();
      renderBoard();
      renderSummary();
      const sec = catalogState.filter !== 'all' ? document.getElementById('cat-sec-' + catalogState.filter) : null;
      if (sec) { try { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (err) {} }
      return;
    }
    if (act === 'add') { openCatalogEditor(null, el.dataset.def || ''); return; }
    if (act === 'refresh' || act === 'retry') { loadCatalog(); return; }
    const card = el.closest('.cat-card');
    if (!card) return;
    const item = catalogFind(card.dataset.def, card.dataset.id);
    if (!item) return;
    if (act === 'preview') {
      const url = el.dataset.url || item.image;
      if (url && typeof openMediaOverlay === 'function') openMediaOverlay(url, el.dataset.kind || (isHtmlUrl(url) ? 'html' : ''));
      return;
    }
    if (act === 'edit') openCatalogEditor(item);
    else if (act === 'toggle') toggleCatalogItem(item).catch(err => showAdminNotice(err.message));
    else if (act === 'delete') deleteCatalogItem(item).catch(err => showAdminNotice(err.message));
  }

  function initCatalog() {
    if (catalogState.bound || !$('tab-catalog')) return;
    catalogState.bound = true;
    $('tab-catalog').addEventListener('click', onCatalogClick);
    $('cat-search').addEventListener('input', (e) => {
      catalogState.q = e.target.value.trim();
      renderBoard();
      renderSummary();
    });
    $('cat-status').addEventListener('change', (e) => {
      catalogState.status = e.target.value;
      renderBoard();
      renderSummary();
    });
    $('cat-kind').addEventListener('change', () => {
      if (!catalogState.editing) {
        applyKindDefaults();
        try { $('cat-image').value = ''; } catch (e) {}
        $('cat-emoji-picks').innerHTML = '';
        if (typeof resetEntryPreview === 'function') resetEntryPreview('cat-preview');
        $('cat-editor-title').textContent = 'إضافة إلى ' + ((catalogDef($('cat-kind').value) || {}).label || 'الأصناف');
      }
      applyKindVisibility();
    });
    $('cat-image').addEventListener('change', onCatalogFilePick);
    const editor = $('catalog-editor');
    if (editor && editor.parentElement === document.body) {
      const host = document.querySelector('.cat-studio');
      const board = $('cat-board');
      if (host && board) host.insertBefore(editor, board);
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const editor = $('catalog-editor');
        if (editor && !editor.hidden) closeCatalogEditor();
      }
    });
    window.addEventListener('resize', syncEditorLock);
  }

  window.loadCatalog = loadCatalog;
  window.openCatalogEditor = openCatalogEditor;
  window.closeCatalogEditor = closeCatalogEditor;
  window.submitCatalogEditor = submitCatalogEditor;
  window.catalogDefsForTest = CAT_DEFS;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCatalog);
  else initCatalog();
})();
