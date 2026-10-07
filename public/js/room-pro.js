// SoulChill — Room Pro: مركز الترفيه، كيس الحظ، الشحن اليومي، الإمبراطورية، وشريط الهدايا
// يعتمد على window.SoulChillApp (الجسر المعرّف في app.js) وعلى حدث soul:room-opened
(function () {
  'use strict';

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const App = () => window.SoulChillApp;
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const hdr = () => ({ 'Content-Type': 'application/json', 'x-user-id': App().state.currentUser.id });

  let ctx = null; // { room, modal, container, layer, bags: Map }
  const bannerQueue = [];
  let bannerBusy = false;
  let tickTimer = null;

  function syncUser(u) {
    if (!u) return;
    const st = App().state;
    st.currentUser = Object.assign(st.currentUser || {}, u);
    try { localStorage.setItem('soulchill_user', JSON.stringify(st.currentUser)); } catch (e) {}
    App().updateHeaderUI();
  }
  const toast = (m) => App().showToast(m);

  // ============ بناء عناصر الغرفة ============
  document.addEventListener('soul:room-opened', (e) => {
    const { room, modal } = e.detail;
    const container = modal.querySelector('.live-room-container');
    if (!container) return;
    ctx = { room, modal, container, layer: null, bags: new Map() };
    injectRoomUi();
    bindSocket();
    loadActiveBags();
  });

  function injectRoomUi() {
    const { modal, container } = ctx;

    // تم تبسيط شريط الغرفة: الإكسسوارات والموسيقى موجودتان داخل قائمة الأدوات.

    // الأيقونات العائمة على الجانب (كيس الحظ / الشحن اليومي / الإمبراطورية)
    const stack = document.createElement('div');
    stack.className = 'rp-float-stack';
    stack.innerHTML = `
      <button type="button" class="rp-float rp-float-bag" data-act="bag"><span class="rp-float-ico">💰</span><span>كيس الحظ</span><b class="rp-badge" id="rp-bag-badge" style="display:none">0</b></button>
      <button type="button" class="rp-float rp-float-daily" data-act="daily"><span class="rp-float-ico">🎁</span><span>الشحن اليومي</span></button>
      <button type="button" class="rp-float rp-float-empire" data-act="empire"><span class="rp-float-ico">🏆</span><span>الإمبراطورية</span></button>`;
    stack.querySelectorAll('.rp-float').forEach(b => {
      b.onclick = () => ({ bag: openLuckyBag, daily: openDaily, empire: openEmpires }[b.dataset.act])();
    });
    container.appendChild(stack);

    // شريط الهدايا العلوي + طبقة اللوحات
    const banner = document.createElement('div');
    banner.className = 'rp-gift-banner';
    banner.id = 'rp-gift-banner';
    container.appendChild(banner);

    const layer = document.createElement('div');
    layer.className = 'rp-layer';
    layer.id = 'rp-layer';
    layer.onclick = (ev) => { if (ev.target === layer) closeSheet(); };
    container.appendChild(layer);
    ctx.layer = layer;
  }

  // ============ اللوحات السفلية ============
  function openSheet(title, bodyHtml, cls) {
    const layer = ctx.layer;
    layer.innerHTML = `
      <div class="rp-sheet ${cls || ''}" role="dialog" aria-label="${esc(title)}">
        <button type="button" class="rp-sheet-x" aria-label="إغلاق">✕</button>
        <div class="rp-sheet-title">${esc(title)}</div>
        <div class="rp-sheet-body">${bodyHtml}</div>
      </div>`;
    layer.classList.add('on');
    layer.querySelector('.rp-sheet-x').onclick = closeSheet;
    return layer.querySelector('.rp-sheet-body');
  }
  function closeSheet() {
    if (!ctx || !ctx.layer) return;
    clearInterval(tickTimer);
    ctx.layer.classList.remove('on');
    ctx.layer.innerHTML = '';
  }

  // ============ مركز الترفيه ============
  function openEntertainment() {
    if (!App().requireAuth()) return;
    const items = [
      ['gifts', '🎁', 'مركز الهدايا'],
      ['bag', '💰', 'كيس الحظ'],
      ['empire', '🏆', 'الإمبراطورية'],
      ['pk', '💗', 'مكان للتنافي'],
      ['store', '🏪', 'المتجر'],
      ['daily', '🚩', 'مركز النشاط'],
      ['acc', '🧰', 'الإكسسوارات']
    ];
    const body = openSheet('مركز الترفيه', `
      <div class="rp-sub">مركز الألعاب</div>
      <div class="rp-ent-grid">${items.map(i => `<button type="button" class="rp-ent-item" data-act="${i[0]}"><b>${i[1]}</b><span>${i[2]}</span></button>`).join('')}</div>`);
    body.querySelectorAll('.rp-ent-item').forEach(b => {
      b.onclick = () => {
        const act = b.dataset.act;
        const room = ctx.room;
        if (act === 'gifts') { closeSheet(); App().openGiftStoreModal(null, room.id, null); }
        else if (act === 'bag') openLuckyBag();
        else if (act === 'empire') openEmpires();
        else if (act === 'daily') openDaily();
        else if (act === 'acc') { closeSheet(); App().openRoomAccessoriesModal(room); }
        else if (act === 'store') { closeSheet(); App().openWalletModal(); }
        else if (act === 'pk') {
          const u = App().state.currentUser;
          if (u && (room.host_id === u.id || App().isPlatformStaff(u))) { closeSheet(); App().startRoomPkBattle(room); }
          else toast('⚔️ تحدي الـ PK متاح لمضيف الغرفة والإدارة فقط');
        }
      };
    });
  }

  // ============ كيس الحظ ============
  const BAG_OPTIONS = [{ v: 500, ico: '💎' }, { v: 2000, ico: '💠' }, { v: 5000, ico: '👑' }];

  function openLuckyBag() {
    if (!App().requireAuth()) return;
    let amount = 500, delay = 0;
    const user = App().state.currentUser;
    const body = openSheet('كيس الحظ', `
      <div class="rp-bag-list" id="rp-bag-list"></div>
      <div class="rp-label">عدد الكريستال:</div>
      <div class="rp-opt-row" id="rp-bag-amounts">${BAG_OPTIONS.map((o, i) => `<button type="button" class="rp-opt ${i === 0 ? 'sel' : ''}" data-v="${o.v}"><b>${o.ico}</b><span>${fmt(o.v)}</span></button>`).join('')}</div>
      <div class="rp-label">وقت الاستلام:</div>
      <div class="rp-opt-row two" id="rp-bag-delay">
        <button type="button" class="rp-opt rp-opt-txt" data-d="0">احصل الآن</button>
        <button type="button" class="rp-opt rp-opt-txt sel" data-d="120">استلم بعد دقيقتين</button>
      </div>
      <div class="rp-balance-row"><span>عدد الكريستال: <b id="rp-bag-balance">${fmt(user.diamonds)}</b> 💎</span><button type="button" class="rp-link" id="rp-bag-topup">شحن ›</button></div>
      <button type="button" class="rp-gold-btn" id="rp-bag-send">إرسال</button>`, 'rp-green');
    delay = 120;
    body.querySelectorAll('#rp-bag-amounts .rp-opt').forEach(b => b.onclick = () => {
      body.querySelectorAll('#rp-bag-amounts .rp-opt').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel'); amount = parseInt(b.dataset.v, 10);
    });
    body.querySelectorAll('#rp-bag-delay .rp-opt').forEach(b => b.onclick = () => {
      body.querySelectorAll('#rp-bag-delay .rp-opt').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel'); delay = parseInt(b.dataset.d, 10);
    });
    body.querySelector('#rp-bag-topup').onclick = () => { closeSheet(); App().openWalletModal(); };
    body.querySelector('#rp-bag-send').onclick = async (ev) => {
      const btn = ev.currentTarget; btn.disabled = true;
      try {
        const r = await fetch('/api/lucky-bag/send', { method: 'POST', headers: hdr(), body: JSON.stringify({ room_id: ctx.room.id, amount, delay }) });
        const out = await r.json();
        if (!r.ok || !out.success) { toast(out.error || 'تعذر إرسال كيس الحظ'); btn.disabled = false; return; }
        syncUser(out.user);
        toast('💰 تم إرسال كيس الحظ إلى الغرفة!');
        closeSheet();
      } catch (e) { toast('تعذر الاتصال بالخادم'); btn.disabled = false; }
    };
    renderBagList();
  }

  function renderBagList() {
    const el = document.getElementById('rp-bag-list');
    if (!el || !ctx) return;
    const bags = Array.from(ctx.bags.values()).filter(b => b.sharesLeft > 0);
    if (!bags.length) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = '<div class="rp-label">أكياس متاحة للالتقاط:</div>' + bags.map(b => {
      const wait = Math.max(0, Math.ceil((b.open_at - Date.now()) / 1000));
      return `<div class="rp-bag-row" data-id="${esc(b.id)}"><img src="${esc(b.sender.avatar || '/avatars/avatar-1.png')}" onerror="this.src='/avatars/avatar-1.png'"><div><b>${esc(b.sender.name)}</b><small>${fmt(b.total)} 💎 • باقي ${b.sharesLeft} حصص</small></div><button type="button" class="rp-claim" ${wait ? 'disabled' : ''}>${wait ? wait + 'ث' : 'التقط'}</button></div>`;
    }).join('');
    el.querySelectorAll('.rp-bag-row').forEach(row => {
      row.querySelector('.rp-claim').onclick = () => claimBag(row.dataset.id);
    });
    clearInterval(tickTimer);
    if (bags.some(b => b.open_at > Date.now())) tickTimer = setInterval(renderBagList, 1000);
  }

  async function claimBag(id) {
    try {
      const r = await fetch('/api/lucky-bag/' + encodeURIComponent(id) + '/claim', { method: 'POST', headers: hdr() });
      const out = await r.json();
      if (!r.ok || !out.success) { toast(out.error || 'تعذر الالتقاط'); return; }
      syncUser(out.user);
      toast('🎉 مبروك! التقطت ' + fmt(out.amount) + ' 💎 من كيس الحظ');
    } catch (e) { toast('تعذر الاتصال بالخادم'); }
  }

  function updateBagBadge() {
    const badge = document.getElementById('rp-bag-badge');
    if (!badge || !ctx) return;
    const n = Array.from(ctx.bags.values()).filter(b => b.sharesLeft > 0).length;
    badge.textContent = n; badge.style.display = n ? '' : 'none';
  }

  async function loadActiveBags() {
    try {
      const r = await fetch('/api/lucky-bag/room/' + encodeURIComponent(ctx.room.id));
      const list = await r.json();
      (list || []).forEach(b => ctx.bags.set(b.id, b));
      updateBagBadge();
    } catch (e) {}
  }

  // ============ الشحن اليومي (مبني على /api/users/checkin الحقيقي) ============
  async function openDaily() {
    if (!App().requireAuth()) return;
    let cfg = { daily_bonus_coins: 500, daily_bonus_diamonds: 50, daily_bonus_enabled: true };
    try { const r = await fetch('/api/settings/wallet'); const d = await r.json(); if (d && d.settings) cfg = d.settings; } catch (e) {}
    const body = openSheet('الشحن اليومي', '<div id="rp-daily"></div>', 'rp-green rp-daily-sheet');
    const DAY = 86400000;

    const draw = () => {
      const u = App().state.currentUser;
      const last = u.last_checkin ? Date.parse(u.last_checkin) : NaN;
      const cycleStart = u.checkin_cycle_start ? Date.parse(u.checkin_cycle_start) : NaN;
      let streak = parseInt(u.checkin_streak, 10) || 0;
      const waitMs = Number.isFinite(last) ? Math.max(0, last + DAY - Date.now()) : 0;
      const cycleExpired = !Number.isFinite(cycleStart) || Date.now() >= cycleStart + 7 * DAY;
      // الخادم يعيد الدورة بعد انتهائها أو بعد اليوم السابع عند الاستلام التالي
      if (cycleExpired || (streak >= 7 && waitMs === 0)) streak = 0;
      const canClaim = cfg.daily_bonus_enabled !== false && waitMs === 0;
      const cum = { 5: 10, 7: 20 };
      const cards = [1, 2, 3, 4, 5, 6, 7].map(n => {
        const mult = n === 7 ? 2 : 1;
        const coins = cfg.daily_bonus_coins * mult;
        const dia = cfg.daily_bonus_diamonds * mult + (cum[n] || 0);
        const st = n <= streak ? 'done' : (n === streak + 1 ? 'next' : '');
        return `<div class="rp-day ${st}"><em>اليوم ${n}</em><b>${n === 7 ? '👑' : (n % 2 ? '💎' : '🪙')}</b><span>🪙 ${fmt(coins)}</span><span>💎 ${fmt(dia)}</span>${st === 'done' ? '<i>✓</i>' : ''}</div>`;
      }).join('');
      const pct = Math.round((streak / 7) * 100);
      document.getElementById('rp-daily').innerHTML = `
        <div class="rp-days-grid">${cards}</div>
        <button type="button" class="rp-gold-btn" id="rp-claim-daily" ${canClaim ? '' : 'disabled'}>${canClaim ? 'اشحن واسحب' : 'استلمت مكافأة اليوم'}</button>
        <div class="rp-daily-foot"><div class="rp-progress"><i style="width:${pct}%"></i></div><span>${waitMs ? 'التالي بعد ' + new Date(waitMs).toISOString().substr(11, 8) : 'جاهز للاستلام الآن'} • ${streak}/7 أيام</span></div>`;
      const btn = document.getElementById('rp-claim-daily');
      if (btn) btn.onclick = async () => {
        btn.disabled = true;
        try {
          const r = await fetch('/api/users/checkin', { method: 'POST', headers: hdr() });
          const out = await r.json();
          if (out.success) { syncUser(out.user); toast(out.message); } else toast(out.message || out.error || 'تعذر الاستلام');
        } catch (e) { toast('تعذر الاتصال بالخادم'); }
        draw();
      };
    };
    draw();
    clearInterval(tickTimer);
    tickTimer = setInterval(() => { if (document.getElementById('rp-daily')) draw(); else clearInterval(tickTimer); }, 1000);
  }

  // ============ الإمبراطورية / ترشيحات ============
  async function openEmpires() {
    if (!App().requireAuth()) return;
    const body = openSheet('ترشيحات', '<div class="rp-loading">جارٍ التحميل…</div>', 'rp-empire');
    let rooms = [];
    try { const r = await fetch('/api/rooms'); rooms = await r.json(); } catch (e) {}
    rooms = (Array.isArray(rooms) ? rooms : []).filter(r => r.id !== ctx.room.id)
      .sort((a, b) => (b.audience_count || 0) - (a.audience_count || 0)).slice(0, 12);
    if (!rooms.length) { body.innerHTML = '<div class="rp-empty">لا يوجد بيانات حالياً</div>'; return; }
    body.innerHTML = '<div class="rp-sub">الإمبراطوريات الأقوى</div>' + rooms.map(r => `
      <div class="rp-emp-row">
        <button type="button" class="rp-join" data-id="${esc(r.id)}">انضم</button>
        <div class="rp-emp-info"><b>${esc(r.title)}</b><small>👥 ${fmt(r.audience_count || 0)} • المضيف: ${esc(r.host_name)}</small></div>
        <img src="${esc(r.host_avatar || '/avatars/avatar-1.png')}" onerror="this.src='/avatars/avatar-1.png'">
      </div>`).join('') + '<button type="button" class="rp-orange-btn" id="rp-join-top">⚡ انضم الان بسرعة</button>';
    const go = (id) => { closeSheet(); App().leaveActiveVoiceRoom(); setTimeout(() => App().openVoiceRoom(id), 350); };
    body.querySelectorAll('.rp-join').forEach(b => b.onclick = () => go(b.dataset.id));
    body.querySelector('#rp-join-top').onclick = () => go(rooms[0].id);
  }

  // ============ شريط الهدايا العلوي ============
  function pushBanner(item) { bannerQueue.push(item); if (!bannerBusy) nextBanner(); }
  function nextBanner() {
    const el = document.getElementById('rp-gift-banner');
    const item = bannerQueue.shift();
    if (!el || !item) { bannerBusy = false; return; }
    bannerBusy = true;
    el.className = 'rp-gift-banner show ' + (item.luxury ? 'lux' : '') + (item.onClick ? ' clickable' : '');
    el.innerHTML = `<img src="${esc(item.avatar || '/avatars/avatar-1.png')}" onerror="this.src='/avatars/avatar-1.png'"><div class="rp-gb-txt"><b>${esc(item.title)}</b><small>${esc(item.sub)}</small></div><span class="rp-gb-ico">${item.icon || ''}</span>`;
    el.onclick = item.onClick || null;
    setTimeout(() => { el.classList.remove('show'); setTimeout(nextBanner, 350); }, 4200);
  }

  // ============ أحداث الـ Socket ============
  function bindSocket() {
    const sock = App().state.socket;
    if (!sock || sock.__rpBound) return;
    sock.__rpBound = true;
    const inRoom = (id) => ctx && document.body.contains(ctx.modal) && ctx.room.id === id;

    sock.on('room_gift_sent', (p) => {
      if (!p || !inRoom(p.room_id)) return;
      pushBanner({
        avatar: p.sender && p.sender.avatar, luxury: !!(p.gift && p.gift.luxury), icon: p.gift && p.gift.icon,
        title: (p.sender ? p.sender.name : '') + ' أرسل ' + (p.gift ? p.gift.name : 'هدية'),
        sub: 'إلى ' + (p.receiver ? p.receiver.name : 'الجميع')
      });
    });
    sock.on('lucky_bag_created', (b) => {
      if (!b || !inRoom(b.room_id)) return;
      ctx.bags.set(b.id, b); updateBagBadge(); renderBagList();
      const mine = App().state.currentUser && b.sender.id === App().state.currentUser.id;
      pushBanner({
        avatar: b.sender.avatar, luxury: true, icon: '💰',
        title: b.sender.name + ' أرسل كيس حظ ' + fmt(b.total) + ' 💎',
        sub: mine ? 'يمكن للمتواجدين التقاطه' : 'اضغط للالتقاط!',
        onClick: mine ? null : () => claimBag(b.id)
      });
    });
    sock.on('lucky_bag_claimed', (c) => {
      if (!ctx) return;
      const b = ctx.bags.get(c.bagId);
      if (b) { b.sharesLeft = c.sharesLeft; if (b.sharesLeft <= 0) ctx.bags.delete(c.bagId); }
      updateBagBadge(); renderBagList();
      if (c.user) pushBanner({ avatar: c.user.avatar, icon: '🍀', title: c.user.name + ' التقط ' + fmt(c.amount) + ' 💎', sub: 'من كيس الحظ' });
    });
    sock.on('lucky_bag_expired', (c) => {
      if (!ctx) return;
      ctx.bags.delete(c.bagId); updateBagBadge(); renderBagList();
    });
  }
})();
