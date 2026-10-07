// SoulChill — Room Video: الغرفة + التحكم مطابقان لفيديو "تحكم ادمن الغرفة"
// يعتمد على window.SoulChillApp وعلى حدث soul:room-opened (يُطلق من app.js بعد بناء الغرفة)
(function () {
  'use strict';

  const App = () => window.SoulChillApp;
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const jp = (v, d) => { if (v && typeof v === 'object') return v; try { return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const svg = (inner, fill) => `<svg viewBox="0 0 24 24"${fill ? ' fill="currentColor"' : ''}>${inner}</svg>`;

  // ====== الأيقونات ======
  const IC = {
    doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
    chat: '<path d="M5 5h14a2 2 0 012 2v8a2 2 0 01-2 2h-6l-4 3v-3H5a2 2 0 01-2-2V7a2 2 0 012-2z"/><path d="M8 10h8M8 13h5"/>',
    music: '<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2.5"/><circle cx="17" cy="16" r="2.5"/>',
    seat: '<rect x="4" y="12" width="16" height="6" rx="2"/><path d="M6 12V8a2 2 0 012-2h8a2 2 0 012 2v4M7 18v2M17 18v2"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
    micOff: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3M4 4l16 16"/>',
    spk: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11"/>',
    spkOff: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>',
    unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 017.5-2"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    shrink: '<path d="M20 4l-6 6M14 5v5h5M4 20l6-6M10 19v-5H5"/>',
    power: '<path d="M12 3v9"/><path d="M6.5 6.5a8 8 0 1011 0"/>',
    invite: '<path d="M12 16V5M7 10l5-5 5 5"/><path d="M5 20h14"/>',
    groupOff: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M17 8l4 4M21 8l-4 4"/>',
    group: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M17 6a3 3 0 010 5M19 20c0-2.5-1.2-4.5-3-5.4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
    share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 11l7.6-4M8.2 13l7.6 4"/>',
    dots: '<circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/>',
    menu: '<path d="M5 8h14M5 12h14M5 16h14"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
    clap: '<path d="M7 11l4-7 2 1-2 4 5 1-3 8H8z"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'
  };
  const ico = (k, fill) => svg(IC[k], fill);

  // ====== الخلفيات ======
  const BG_DEFAULT = 'radial-gradient(ellipse at 50% 18%, #4a2a86 0%, #1d1038 48%, #0a0614 100%)';
  const READY_BG = [
    { id: 'royal', name: 'القصر الملكي', css: BG_DEFAULT },
    { id: 'aurora', name: 'الشفق القطبي', css: 'linear-gradient(160deg,#04110f 0%,#0b3d3a 35%,#1d6b5a 55%,#2a2a6e 80%,#0a0818 100%)' },
    { id: 'sunset', name: 'غروب', css: 'linear-gradient(180deg,#2b0f3f 0%,#7a1f4d 40%,#e2552e 75%,#f7a23a 100%)' },
    { id: 'ocean', name: 'المحيط', css: 'linear-gradient(180deg,#02122b 0%,#06407a 55%,#0a7ab5 100%)' },
    { id: 'city', name: 'ليل المدينة', css: 'linear-gradient(180deg,#0a0a1f 0%,#1b1b4d 60%,#3a1c71 100%)' },
    { id: 'rose', name: 'وردي', css: 'linear-gradient(180deg,#3a0a2e 0%,#8a1f62 55%,#e0508f 100%)' },
    { id: 'emerald', name: 'زمردي', css: 'linear-gradient(180deg,#02150f 0%,#0b5a3f 60%,#18a273 100%)' },
    { id: 'gold', name: 'ذهبي', css: 'linear-gradient(180deg,#1a1205 0%,#6a4a10 55%,#e2b34a 100%)' },
    { id: 'ice', name: 'جليدي', css: 'linear-gradient(180deg,#071425 0%,#1d5a8a 55%,#a9dcf5 100%)' },
    { id: 'ember', name: 'جمر', css: 'linear-gradient(180deg,#140404 0%,#7a1408 55%,#f06a1e 100%)' },
    { id: 'violet', name: 'بنفسجي', css: 'linear-gradient(180deg,#0e0526 0%,#4a1fa8 60%,#9a6bff 100%)' },
    { id: 'mono', name: 'داكن', css: 'linear-gradient(180deg,#0c0c10 0%,#1a1a22 100%)' }
  ];
  const ANIM_BG = [
    { id: 'aurora', name: 'شفق متحرك' }, { id: 'nebula', name: 'سديم' },
    { id: 'stars', name: 'نجوم' }, { id: 'waves', name: 'أمواج' }
  ];
  const CATS = [['friendship', 'صداقة'], ['music', 'موسيقى'], ['quran', 'القرآن الكريم'], ['fun', 'نادي المرح'], ['game', 'لعبة'], ['chat', 'دردشة'], ['chill', 'روقان']];

  const TIPS = [
    'غرفتك أعلى الشاشة، ادعُهم للدخول إلى المايك 🎤 وابدأ الدردشة معهم في مختلف الموضوعات.',
    'يمكنك مشاهدة تقييم كل غرفة من خلال الضغط على بطاقة الغرفة، مع كل مرة تقوم بالدخول لايف في الغرفة وتستلم هدايا وترسل هدايا للآخرين، سيزيد تقييم غرفتك.',
    'حاول أن توجّه زوار غرفتك لحفظ غرفتك ومتابعتها، ستكون غرفتك موجودة ضمن الغرف المفضلة 💗 لديهم، وبذلك لن يفوتهم الدخول إلى غرفتك عندما تكون لايف!',
    'كونك صاحب الغرفة، تذكّر دائمًا أن تجعل بيئة الدردشة في الغرفة سليمة. أنت تستطيع «تصميت» 🤐 أو «طرد» أي شخص يخالف قواعد الأدب والذوق في المنصة.'
  ];

  let ctx = null;
  let sockHandlers = [];
  let bodyObs = null;
  let audioObs = null;

  const st = () => App().state;
  const me = () => st().currentUser;
  const roomId = () => ctx.room.id;
  const toastGlobal = (m) => App().showToast(m);

  async function api(method, url, body, isForm) {
    const opt = { method, headers: { 'x-user-id': me().id } };
    if (body !== undefined && !isForm) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    if (isForm) opt.body = body;
    const r = await fetch(url, opt);
    let d = {};
    try { d = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(d.error || 'تعذر تنفيذ الطلب');
    return d;
  }

  // ====== بدء الغرفة ======
  document.addEventListener('soul:room-opened', (e) => {
    const { room, modal } = e.detail || {};
    if (!room || !modal) return;
    const container = modal.querySelector('.live-room-container');
    if (!container) return;
    try { setup(room, modal, container); } catch (err) { console.error('room-video setup:', err); }
  });

  function isAdminUser(room) {
    const u = me();
    return !!(u && (room.host_id === u.id || App().isPlatformStaff(u)));
  }

  function setup(room, modal, container) {
    cleanup();
    ctx = { room, modal, container, layer: null, bg: null, admin: isAdminUser(room), chat: jp(room.chat_settings, {}), seatS: jp(room.seat_settings, {}),
            mutedSeats: new Set(), allMuted: false, allLocked: false, audioMuted: false, bgPicked: loadMyBgs() };
    (room.seats || []).forEach(s => { if (s.seat_index > 0 && s.is_muted && !s.user_id) ctx.mutedSeats.add(s.seat_index); });

    // الخلفية + الطبقة
    const bg = document.createElement('div'); bg.className = 'rv-bg'; container.prepend(bg); ctx.bg = bg;
    applyBg(room.bg_image);
    const layer = document.createElement('div'); layer.className = 'rv-layer';
    layer.addEventListener('click', (ev) => { if (ev.target === layer) closeLayer(); });
    container.appendChild(layer); ctx.layer = layer;

    buildTopButtons();
    buildBottomBar();
    buildGameStack();
    addTips();
    layoutSeats();
    applyChatSettings();
    applySeatSettings();
    computeLockState();
    interceptSeatClicks();
    bindSockets();

    // مراقبة إغلاق الغرفة لتنظيف الموارد
    bodyObs = new MutationObserver(() => { if (ctx && !document.body.contains(ctx.modal)) cleanup(); });
    bodyObs.observe(document.body, { childList: true });
  }

  function cleanup() {
    if (!ctx && !sockHandlers.length) return;
    const sock = App() && st().socket;
    if (sock) sockHandlers.forEach(([ev, fn]) => sock.off(ev, fn));
    sockHandlers = [];
    if (bodyObs) { bodyObs.disconnect(); bodyObs = null; }
    if (audioObs) { audioObs.disconnect(); audioObs = null; }
    document.querySelectorAll('.rv-mini').forEach(n => n.remove());
    if (ctx && ctx.audioMuted) document.querySelectorAll('audio').forEach(a => { a.muted = false; });
    ctx = null;
  }

  // ====== الخلفية ======
  function applyBg(val) {
    const bg = ctx.bg; if (!bg) return;
    bg.className = 'rv-bg'; bg.style.background = ''; bg.style.backgroundImage = '';
    val = val || '';
    if (!val) { bg.style.background = BG_DEFAULT; return; }
    if (val.startsWith('grad:')) {
      const p = READY_BG.find(x => x.id === val.slice(5)); bg.style.background = p ? p.css : BG_DEFAULT;
    } else if (val.startsWith('anim:')) {
      bg.classList.add('rv-anim-' + val.slice(5).replace(/[^a-z]/g, ''));
    } else {
      bg.style.backgroundImage = `url("${val.replace(/"/g, '%22')}")`;
    }
    ctx.room.bg_image = val;
  }
  function loadMyBgs() { try { return JSON.parse(localStorage.getItem('rv_my_bgs') || '[]'); } catch (e) { return []; } }
  function saveMyBgs(a) { try { localStorage.setItem('rv_my_bgs', JSON.stringify(a.slice(0, 18))); } catch (e) {} }

  // ====== الشريط العلوي / السفلي / الألعاب ======
  function buildTopButtons() {
    const actions = ctx.modal.querySelector('.live-room-actions');
    const leave = ctx.modal.querySelector('#leave-room-btn');
    if (!actions) return;
    const mk = (html, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'rv-top-btn'; b.title = title; b.innerHTML = html; b.onclick = fn; return b; };
    actions.insertBefore(mk(ico('dots', true), 'إعدادات الغرفة', openControl), leave);
    actions.insertBefore(mk(ico('share'), 'مشاركة الغرفة', shareRoom), leave);
    if (leave) { leave.title = 'خروج'; }
  }
  async function shareRoom() {
    const url = location.origin + '/?room=' + encodeURIComponent(roomId());
    try {
      if (navigator.share) { await navigator.share({ title: ctx.room.title, text: 'انضم إلى غرفتي في SoulChill 🎙️', url }); return; }
      await navigator.clipboard.writeText(url); toast('تم نسخ رابط الغرفة');
    } catch (e) { /* أُلغيت المشاركة */ }
  }

  function buildBottomBar() {
    const bar = ctx.modal.querySelector('.room-bottom-controls'); if (!bar) return;
    if (!bar.querySelector('.rv-pk-btn')) {
      const pk = document.createElement('button'); pk.type = 'button'; pk.className = 'rv-pk-btn'; pk.title = 'تحدي PK';
      pk.innerHTML = 'p<span>K</span>';
      pk.onclick = () => {
        if (ctx.admin) { try { App().startRoomPkBattle(ctx.room); } catch (e) { toast('تعذر بدء التحدي'); } }
        else toast('تحدي الـ PK متاح لمضيف الغرفة والإدارة فقط');
      };
      bar.appendChild(pk);
    }
    if (!bar.querySelector('.rv-menu-btn')) {
      const m = document.createElement('button'); m.type = 'button'; m.className = 'room-tool-btn rv-menu-btn'; m.title = 'القائمة';
      m.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round">${IC.menu}</svg>`;
      m.onclick = openControl;
      bar.appendChild(m);
    }
    // تحويل أيقونات الرسائل/الألعاب إلى خطوط بيضاء (كما في الفيديو)
    const gift = bar.querySelector('#room-open-gifts-btn');
    if (gift) gift.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#ff4fa3" stroke-width="1.9" stroke-linejoin="round"><rect x="3" y="9" width="18" height="11" rx="2"/><path d="M3 13h18M12 9v11M12 9c-2-4-6-3-5 0 .6 1.8 3.3 1.2 5 0zM12 9c2-4 6-3 5 0-.6 1.8-3.3 1.2-5 0z"/></svg>`;
  }

  function buildGameStack() {
    const stack = ctx.container.querySelector('.rp-float-stack'); if (!stack) return;
    const defs = [['bag', '/img/pf/game_jewels.png'], ['daily', '/img/pf/game_uefa.png'], ['empire', '/img/pf/game_bookofra.png']];
    defs.forEach(([act, img]) => {
      const orig = stack.querySelector(`.rp-float[data-act="${act}"]`);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'rv-game'; b.dataset.act = act;
      b.innerHTML = `<img src="${img}" alt="" onerror="this.style.display='none'">` + (act === 'bag' ? '<b class="rp-badge" style="display:none">0</b>' : '');
      b.onclick = () => { if (orig) orig.click(); };
      stack.appendChild(b);
      if (act === 'bag') {
        const ob = stack.querySelector('#rp-bag-badge'), nb = b.querySelector('.rp-badge');
        if (ob && nb) new MutationObserver(() => { nb.textContent = ob.textContent; nb.style.display = ob.style.display; })
          .observe(ob, { childList: true, characterData: true, subtree: true, attributes: true });
      }
    });
  }

  function addTips() {
    if (!ctx.admin) return;
    const stream = ctx.modal.querySelector('#room-chat-messages-container'); if (!stream) return;
    TIPS.forEach(t => { const d = document.createElement('div'); d.className = 'room-chat-bubble rv-tip'; d.textContent = t; stream.appendChild(d); });
  }

  // ====== المقاعد ======
  function layoutSeats() {
    const grid = ctx.modal.querySelector('.guest-seats-grid'); if (!grid) return;
    const guests = ctx.room.seat_count || 8;
    grid.style.setProperty('--rv-cols', guests <= 2 ? guests : (guests <= 8 ? 4 : 5));
    for (let i = 1; i <= 15; i++) {
      const el = ctx.modal.querySelector(`#stage-seat-${i}`);
      if (el) el.style.display = i > guests ? 'none' : '';
    }
  }
  function computeLockState() {
    const n = ctx.room.seat_count || 8; let all = n > 0;
    for (let i = 1; i <= n; i++) { const el = ctx.modal.querySelector(`#stage-seat-${i}`); if (!el || !el.classList.contains('locked')) { all = false; break; } }
    ctx.allLocked = all;
  }
  function seatEl(idx) { return idx === 0 ? ctx.modal.querySelector('#host-seat-0') : ctx.modal.querySelector(`#stage-seat-${idx}`); }

  function interceptSeatClicks() {
    ctx.container.addEventListener('click', (ev) => {
      if (!ctx.admin) return;
      const el = ev.target.closest('.stage-seat, .host-seat-wrapper');
      if (!el || !ctx.container.contains(el)) return;
      if (el.classList.contains('occupied')) return; // المقاعد المشغولة تبقى بقائمة الإدارة الحالية
      const idx = parseInt(el.dataset.seatIdx, 10); if (isNaN(idx)) return;
      ev.stopImmediatePropagation(); ev.preventDefault();
      openSeatActions(idx);
    }, true);
  }

  // ====== الطبقة ======
  function closeLayer() { if (ctx && ctx.layer) { ctx.layer.classList.remove('on'); ctx.layer.innerHTML = ''; } }
  function showLayer(html) { const l = ctx.layer; l.innerHTML = html; l.classList.add('on'); return l; }
  function toast(msg) {
    if (!ctx) return toastGlobal(msg);
    const old = ctx.container.querySelector('.rv-toast'); if (old) old.remove();
    const t = document.createElement('div'); t.className = 'rv-toast'; t.textContent = msg; ctx.container.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }
  const wire = (root, sel, fn) => root.querySelectorAll(sel).forEach(n => n.addEventListener('click', (e) => fn(n, e)));

  // ====== قائمة التحكم (10 أيقونات) ======
  function onSeat() { const i = st().userSeatIndex; return i !== null && i !== undefined; }
  function openControl() {
    if (!App().requireAuth()) return;
    const u = me(); const room = ctx.room;
    const seated = onSeat(); const muted = !!st().isMuted;
    const item = (id, label, icon) => `<button type="button" class="rv-ctl" data-id="${id}"><i>${ico(icon)}</i><span>${label}</span></button>`;
    const row1 = ctx.admin ? [
      item('profile', 'صورة الغرفة', 'doc'), item('bg', 'الخلفية', 'image'), item('chat', 'منطقة الدردشة', 'chat'),
      item('sound', 'تأثيرات صوتية وموسيقى', 'music'), item('seats', 'مقعد', 'seat')
    ] : [item('sound', 'تأثيرات صوتية وموسيقى', 'music')];
    const row2 = [
      item('mic', !seated ? 'الميكروفون' : (muted ? 'تشغيل المايك' : 'كتم المايك'), (seated && muted) ? 'micOff' : 'mic'),
      item('silence', ctx.audioMuted ? 'إلغاء الصمت' : 'صمت', ctx.audioMuted ? 'spkOff' : 'spk')
    ];
    if (ctx.admin) row2.push(item('lockall', ctx.allLocked ? 'مقفل' : 'فتح', ctx.allLocked ? 'lock' : 'unlock'));
    row2.push(item('minimize', 'تصغير', 'shrink'), item('exit', 'خروج', 'power'));
    const l = showLayer(`
      <div class="rv-top-panel">
        <button type="button" class="rv-x" aria-label="إغلاق">✕</button>
        <div class="rv-tp-head"><b>${esc(room.title)}</b><small>RID:${esc(String(room.id).replace(/\D/g, '').slice(-8) || room.id)}</small></div>
        ${ctx.admin ? '<div class="rv-tp-sub">إعدادات الغرفة</div>' : ''}
        <div class="rv-grid5">${row1.join('')}</div>
        <div class="rv-grid5" style="margin-top:14px">${row2.join('')}</div>
      </div>`);
    l.querySelector('.rv-x').onclick = closeLayer;
    wire(l, '.rv-ctl', (n) => controlAction(n.dataset.id));
  }

  function controlAction(id) {
    switch (id) {
      case 'profile': return openRoomProfile();
      case 'bg': return openBackground();
      case 'chat': return openChatManage();
      case 'sound': return openSound();
      case 'seats': return openSeats();
      case 'mic': closeLayer(); return toggleMic();
      case 'silence': closeLayer(); return toggleSilence();
      case 'lockall': return toggleLockAll();
      case 'minimize': closeLayer(); return minimize();
      case 'exit': closeLayer(); return exitRoom();
    }
  }

  async function toggleMic() {
    if (!onSeat()) {
      const room = ctx.room; const isHost = room.host_id === me().id;
      let idx = null;
      if (isHost) idx = 0;
      else { for (let i = 1; i <= (room.seat_count || 8); i++) { const el = seatEl(i); if (el && !el.classList.contains('occupied') && !el.classList.contains('locked')) { idx = i; break; } } }
      if (idx === null) return toast('لا يوجد مقعد متاح الآن');
      App().takeSeatAction(idx);
    } else {
      App().toggleUserMic();
    }
  }

  function toggleSilence() {
    ctx.audioMuted = !ctx.audioMuted;
    const apply = () => document.querySelectorAll('audio').forEach(a => { a.muted = ctx.audioMuted; });
    apply();
    if (audioObs) { audioObs.disconnect(); audioObs = null; }
    if (ctx.audioMuted) { audioObs = new MutationObserver(apply); audioObs.observe(document.body, { childList: true }); }
    toast(ctx.audioMuted ? 'تم كتم صوت الغرفة لديك' : 'تم إلغاء الصمت');
  }

  async function toggleLockAll() {
    const next = !ctx.allLocked;
    if (next && !(await window.uiConfirm('هل ترغب بقفل جميع مقاعد المايك ومنع صعود الجمهور؟', { icon: '🔒', okText: 'قفل الكل' }))) return;
    st().socket.emit('admin_lock_all_seats', { roomId: roomId(), adminId: me().id, isLocked: next });
    ctx.allLocked = next; closeLayer(); toast(next ? 'تم قفل جميع المقاعد' : 'تم فتح جميع المقاعد');
  }

  function minimize() {
    const modal = ctx.modal; modal.classList.add('rv-minimized');
    const b = document.createElement('button'); b.type = 'button'; b.className = 'rv-mini';
    b.innerHTML = `<img src="${esc(ctx.room.host_avatar || '/avatars/avatar-1.png')}" alt="" onerror="this.src='/avatars/avatar-1.png'"><span>${esc(ctx.room.title)}</span>`;
    b.onclick = () => { modal.classList.remove('rv-minimized'); b.remove(); };
    document.body.appendChild(b);
  }

  async function exitRoom() {
    if (await window.uiConfirm('هل تريد مغادرة الغرفة؟', { icon: '🚪', okText: 'خروج' })) App().leaveActiveVoiceRoom();
  }

  // ====== صورة الغرفة ======
  function openRoomProfile() {
    const room = ctx.room; let cover = room.cover_image || room.host_avatar || '/avatars/avatar-1.png';
    let cat = room.category || 'chill'; const origTitle = room.title;
    const l = showLayer(`
      <div class="rv-full">
        <button type="button" class="rv-x" style="top:14px">✕</button>
        <div class="rv-full-title">صورة الغرفة</div>
        <div class="rv-lbl">صورة الغرفة</div>
        <div class="rv-avatar-pick" id="rv-cover-pick"><img src="${esc(cover)}" alt="" onerror="this.src='/avatars/avatar-1.png'"><em>📷</em></div>
        <input type="file" id="rv-cover-file" accept="image/*" hidden>
        <div class="rv-lbl">اسم الغرفة</div>
        <div class="rv-field"><button type="button" id="rv-title-reset" title="استعادة">⟳</button><input id="rv-title" maxlength="40" value="${esc(room.title)}"></div>
        <div class="rv-lbl">محتوى الغرفة</div>
        <div class="rv-chips" id="rv-cats">${CATS.map(c => `<button type="button" class="rv-chip ${c[0] === cat ? 'sel' : ''}" data-c="${c[0]}">${c[1]}</button>`).join('')}</div>
        <div class="rv-lbl">إعلان شامل</div>
        <div class="rv-ta"><textarea id="rv-ann" maxlength="100">${esc(room.announcement || '')}</textarea><small><span id="rv-ann-n">0</span>/100</small></div>
        <div class="rv-save-bar"><button type="button" class="rv-primary" id="rv-save">حفظ</button></div>
      </div>`);
    const q = (s) => l.querySelector(s);
    q('.rv-x').onclick = closeLayer;
    const ann = q('#rv-ann'), n = q('#rv-ann-n'); const upd = () => { n.textContent = ann.value.length; }; ann.oninput = upd; upd();
    q('#rv-title-reset').onclick = () => { q('#rv-title').value = origTitle; };
    wire(l, '.rv-chip', (b) => { cat = b.dataset.c; l.querySelectorAll('.rv-chip').forEach(x => x.classList.toggle('sel', x === b)); });
    q('#rv-cover-pick').onclick = () => q('#rv-cover-file').click();
    q('#rv-cover-file').onchange = async (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      try { const fd = new FormData(); fd.append('image', f); const d = await api('POST', `/api/rooms/${roomId()}/image`, fd, true); cover = d.url; q('#rv-cover-pick img').src = cover; }
      catch (err) { toast(err.message); }
    };
    q('#rv-save').onclick = async () => {
      const btn = q('#rv-save'); btn.disabled = true;
      try {
        const d = await api('PUT', `/api/rooms/${roomId()}/profile`, { title: q('#rv-title').value, category: cat, announcement: ann.value, cover_image: cover });
        applyRoomMeta(d.room); closeLayer(); toast('تم حفظ بيانات الغرفة');
      } catch (err) { toast(err.message); btn.disabled = false; }
    };
  }
  function applyRoomMeta(s) {
    if (!s || !ctx) return;
    Object.assign(ctx.room, { title: s.title, category: s.category, announcement: s.announcement, cover_image: s.cover_image });
    const t = ctx.modal.querySelector('.live-room-title-text'); if (t) { t.textContent = s.title; t.title = s.title; }
  }

  // ====== الخلفية ======
  function openBackground() {
    let tab = 'ready'; let sel = ctx.room.bg_image || ''; const cur = sel;
    const l = showLayer('<div class="rv-full" style="padding-top:0"></div>');
    const root = l.querySelector('.rv-full');
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.hidden = true; root.appendChild(input);
    const holder = document.createElement('div'); root.appendChild(holder);
    const thumb = (val, css, name, cls) => `<button type="button" class="rv-bg-item ${cls || ''} ${val === sel ? 'sel' : ''}" data-v="${esc(val)}" style="${css}"><span>${esc(name || '')}</span></button>`;
    function paint() {
      const tabs = [['ready', 'خلفية جاهزة'], ['picked', 'خلفية مختارة'], ['anim', 'خلفية متحركة']];
      let items = '';
      if (tab === 'ready') items = READY_BG.map(b => thumb('grad:' + b.id, `background:${b.css}`, b.name)).join('');
      else if (tab === 'anim') items = ANIM_BG.map(b => `<button type="button" class="rv-bg-item ${('anim:' + b.id) === sel ? 'sel' : ''}" data-v="anim:${b.id}"><div class="rv-bg rv-anim-${b.id}" style="position:absolute;inset:0"></div><span>${b.name}</span></button>`).join('');
      else {
        const mine = ['/royal_eagle.gif'].concat(ctx.bgPicked);
        items = mine.map(u => thumb(u, `background-image:url('${u.replace(/'/g, '%27')}')`, '')).join('') + '<button type="button" class="rv-bg-item add" data-add="1">+</button>';
      }
      holder.innerHTML = `
        <div class="rv-bg-head"><button type="button" class="rv-pill" id="rv-bg-save" ${sel === cur ? 'disabled' : ''}>حفظ</button><h4>الخلفية</h4><button type="button" class="rv-x" style="position:static">✕</button></div>
        <div class="rv-bg-tabs">${tabs.map(t => `<b class="${t[0] === tab ? 'sel' : ''}" data-t="${t[0]}">${t[1]}</b>`).join('')}</div>
        <div class="rv-bg-grid">${items}</div>
        <div class="rv-bg-bottom"><button type="button" class="rv-primary" id="rv-bg-browse">تصفح</button></div>`;
      holder.querySelector('.rv-x').onclick = closeLayer;
      wire(holder, '.rv-bg-tabs b', (b) => { tab = b.dataset.t; paint(); });
      wire(holder, '.rv-bg-item', (b) => { if (b.dataset.add) return input.click(); sel = b.dataset.v; paint(); });
      holder.querySelector('#rv-bg-browse').onclick = () => input.click();
      holder.querySelector('#rv-bg-save').onclick = async () => {
        try { await api('PUT', `/api/rooms/${roomId()}/background`, { bg_image: sel }); applyBg(sel); closeLayer(); toast('تم تغيير الخلفية'); }
        catch (err) { toast(err.message); }
      };
    }
    input.onchange = async (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      try {
        const fd = new FormData(); fd.append('image', f);
        const d = await api('POST', `/api/rooms/${roomId()}/image`, fd, true);
        ctx.bgPicked.unshift(d.url); saveMyBgs(ctx.bgPicked); sel = d.url; tab = 'picked'; paint();
      } catch (err) { toast(err.message); }
    };
    paint();
  }

  // ====== إدارة الشات ======
  function chatSettingsRows() {
    return [
      ['hide_system', 'إخفاء رسائل السيستم'],
      ['hide_all', 'إخفاء جميع الرسائل'],
      ['images_members_only', 'تفعيل خاصية إرسال الصور في الشات (للأشخاص المنضمين فقط)'],
      ['auto_welcome', 'تفعيل الترحيب التلقائي في الغرفة'],
      ['close_emoji', 'إغلاق رسائل الإيموجي في منطقة الدردشة']
    ];
  }
  function openChatManage() {
    const rows = chatSettingsRows();
    const l = showLayer(`
      <div class="rv-sheet">
        <button type="button" class="rv-x" style="top:12px">✕</button>
        <div class="rv-sheet-title">إدارة الشات</div>
        ${rows.map(r => `<div class="rv-row"><span>${r[1]}</span><button type="button" class="rv-switch ${ctx.chat[r[0]] ? 'on' : ''}" data-k="${r[0]}" aria-label="${r[1]}"></button></div>`).join('')}
      </div>`);
    l.querySelector('.rv-x').onclick = closeLayer;
    wire(l, '.rv-switch', async (b) => {
      const k = b.dataset.k; const v = !ctx.chat[k];
      ctx.chat[k] = v; b.classList.toggle('on', v); applyChatSettings();
      try { await api('PUT', `/api/rooms/${roomId()}/chat-settings`, { [k]: v }); }
      catch (err) { ctx.chat[k] = !v; b.classList.toggle('on', !v); applyChatSettings(); toast(err.message); }
    });
  }
  function applyChatSettings() {
    const m = ctx.modal, c = ctx.chat || {};
    m.classList.toggle('rv-hide-sys', !!c.hide_system);
    m.classList.toggle('rv-hide-all', !!c.hide_all);
    m.classList.toggle('rv-hide-emoji', !!c.close_emoji);
  }

  // ====== تأثيرات صوتية وموسيقى ======
  function openSound() {
    const canMusic = ctx.admin || ctx.seatS.allow_music !== false;
    const fx = [['applause', 'تصفيق', 'تصفيق 👏'], ['cheer', 'هتاف وزغاريد', 'هتاف وزغاريد 🎉'], ['laughter', 'ضحك', 'ضحك 😂'], ['drumroll', 'طبول', 'قرع طبول 🥁']];
    const l = showLayer(`
      <div class="rv-sheet">
        <button type="button" class="rv-x" style="top:12px">✕</button>
        <div class="rv-sheet-title">تأثيرات صوتية وموسيقى</div>
        <div class="rv-grid5" style="grid-template-columns:repeat(4,1fr)">
          ${fx.map(f => `<button type="button" class="rv-ctl" data-fx="${f[0]}" data-n="${f[2]}"><i>${ico('clap')}</i><span>${f[1]}</span></button>`).join('')}
          <button type="button" class="rv-ctl" data-music="1"><i>${ico('music')}</i><span>موسيقى لوفاي</span></button>
        </div>
      </div>`);
    l.querySelector('.rv-x').onclick = closeLayer;
    wire(l, '[data-fx]', (b) => {
      st().socket.emit('play_sound_effect', { roomId: roomId(), effect: b.dataset.fx, soundName: b.dataset.n, senderName: me().name });
    });
    wire(l, '[data-music]', () => {
      if (!canMusic) return toast('تشغيل الموسيقى متاح للإدارة فقط في هذه الغرفة');
      if (window.soundManager) window.soundManager.toggleChillMusic(() => toast('تم تشغيل موسيقى لوفاي الهادئة'), () => toast('تم إيقاف الموسيقى'));
    });
  }

  // ====== عدد المقاعد ======
  function dots(n) {
    const rows = { 3: [1, 2], 5: [2, 3], 9: [3, 3, 3], 15: [5, 5, 5] }[n] || [n];
    let out = ''; const w = 24, h = 24, rh = h / (rows.length + 1);
    rows.forEach((cnt, r) => { for (let i = 0; i < cnt; i++) out += `<circle cx="${(w / (cnt + 1)) * (i + 1)}" cy="${rh * (r + 1)}" r="1.5" fill="#fff" stroke="none"/>`; });
    return `<svg viewBox="0 0 24 24">${out}</svg>`;
  }
  async function openSeats(tab) {
    tab = tab || 'count';
    let data;
    try { data = await api('GET', `/api/rooms/${roomId()}/seat-options`); } catch (err) { return toast(err.message); }
    let sel = data.current; const cur = data.current; let theme = ctx.seatS.theme || 'classic';
    const l = showLayer('<div class="rv-sheet" style="padding-top:16px"></div>');
    const sh = l.querySelector('.rv-sheet');
    function paint() {
      let body = '';
      if (tab === 'count') {
        body = '<div class="rv-seat-opts">' + data.options.map(o => {
          const sub = o.count === 9 && o.locked ? `<small>تم فتح ${Math.min(o.members, o.need_members)} من ${o.need_members} من أعضاء الغرفة</small>`
            : (o.count === 15 && o.locked ? `<small>فتح ${o.price} كريستالة</small>` : '');
          const lk = o.locked ? `<span class="rv-lk">${ico('lock')}</span>` : '';
          return `<button type="button" class="rv-seat-opt ${sel === o.count ? 'sel' : ''}" data-n="${o.count}">${dots(o.count)}<div>${o.count} مقاعد${lk}</div>${sub}</button>`;
        }).join('') + '</div>';
      } else {
        body = `<div class="rv-themes">${[['classic', 'كلاسيكي'], ['neon', 'نيون'], ['gold', 'ذهبي']].map(t => `<button type="button" class="rv-theme ${theme === t[0] ? 'sel' : ''}" data-t="${t[0]}"><u></u>${t[1]}</button>`).join('')}</div>`;
      }
      sh.innerHTML = `
        <button type="button" class="rv-back" id="rv-seat-gear" title="إعدادات المقاعد">${ico('gear').replace('<svg', '<svg width="20" height="20" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"')}</button>
        <button type="button" class="rv-x" style="top:12px">✕</button>
        <div class="rv-tabs"><b class="${tab === 'topic' ? 'sel' : ''}" data-tab="topic">الموضوع</b><b class="${tab === 'count' ? 'sel' : ''}" data-tab="count">عدد المقاعد</b></div>
        ${body}
        <button type="button" class="rv-primary" id="rv-seat-save">حفظ</button>`;
      sh.querySelector('.rv-x').onclick = closeLayer;
      sh.querySelector('#rv-seat-gear').onclick = openSeatSettings;
      wire(sh, '.rv-tabs b', (b) => { tab = b.dataset.tab; paint(); });
      wire(sh, '.rv-seat-opt', (b) => { sel = parseInt(b.dataset.n, 10); paint(); });
      wire(sh, '.rv-theme', (b) => { theme = b.dataset.t; paint(); });
      sh.querySelector('#rv-seat-save').onclick = async () => {
        try {
          if (tab === 'topic') {
            await api('PUT', `/api/rooms/${roomId()}/seat-settings`, { theme });
            ctx.seatS.theme = theme; applySeatSettings(); closeLayer(); return toast('تم حفظ الموضوع');
          }
          if (sel === cur) return closeLayer();
          const opt = data.options.find(o => o.count === sel);
          if (opt && opt.locked && sel === 9) return toast(`يلزم ${opt.need_members} من أعضاء الغرفة لفتح 9 مقاعد`);
          if (opt && opt.locked && sel === 15 && !(await window.uiConfirm(`فتح 15 مقعدًا يكلف ${opt.price} كريستال. هل تريد المتابعة؟`, { icon: '💎', okText: 'فتح' }))) return;
          await api('PUT', `/api/rooms/${roomId()}/seat-count`, { count: sel });
          closeLayer(); toast('تم تحديث عدد المقاعد');
        } catch (err) { toast(err.message); }
      };
    }
    paint();
  }

  function openSeatSettings() {
    let who = ctx.seatS.who || 'all'; let stars = !!ctx.seatS.show_stars; let music = ctx.seatS.allow_music !== false;
    const l = showLayer('<div class="rv-sheet"></div>'); const sh = l.querySelector('.rv-sheet');
    function paint() {
      sh.innerHTML = `
        <button type="button" class="rv-x" style="top:12px">✕</button>
        <div class="rv-sheet-title">إعدادات المقاعد</div>
        <div class="rv-seg"><button type="button" data-w="members" class="${who === 'members' ? 'sel' : ''}">الأعضاء فقط</button><button type="button" data-w="all" class="${who === 'all' ? 'sel' : ''}">الجميع</button></div>
        <div class="rv-row"><span>عرض النجوم على المقاعد</span><button type="button" class="rv-switch ${stars ? 'on' : ''}" data-s="stars"></button></div>
        <div class="rv-row"><span>السماح للآخرين بتشغيل الموسيقى</span><button type="button" class="rv-switch ${music ? 'on' : ''}" data-s="music"></button></div>
        <button type="button" class="rv-primary" id="rv-ss-save">حفظ</button>`;
      sh.querySelector('.rv-x').onclick = closeLayer;
      wire(sh, '.rv-seg button', (b) => { who = b.dataset.w; paint(); });
      wire(sh, '.rv-switch', (b) => { if (b.dataset.s === 'stars') stars = !stars; else music = !music; paint(); });
      sh.querySelector('#rv-ss-save').onclick = async () => {
        try {
          await api('PUT', `/api/rooms/${roomId()}/seat-settings`, { who, show_stars: stars, allow_music: music });
          Object.assign(ctx.seatS, { who, show_stars: stars, allow_music: music }); applySeatSettings(); closeLayer(); toast('تم حفظ إعدادات المقاعد');
        } catch (err) { toast(err.message); }
      };
    }
    paint();
  }
  function applySeatSettings() {
    const m = ctx.modal, s = ctx.seatS || {};
    m.classList.toggle('rv-stars-on', !!s.show_stars);
    m.classList.remove('rv-theme-neon', 'rv-theme-gold');
    if (s.theme === 'neon' || s.theme === 'gold') m.classList.add('rv-theme-' + s.theme);
  }

  // ====== قائمة المقعد (استخدام المايك / ادعيه / كتم / غلق / كتم الكل) ======
  function openSeatActions(idx) {
    const el = seatEl(idx); const locked = !!(el && el.classList.contains('locked'));
    const muted = ctx.mutedSeats.has(idx);
    const isHost = ctx.room.host_id === me().id; const isOwner = me().role === 'owner';
    const canTake = !locked && (idx !== 0 || isHost || isOwner);
    const it = (id, label, icon, dis) => `<button type="button" class="rv-ctl ${dis ? 'dis' : ''}" data-a="${id}"><i>${ico(icon)}</i><span>${label}</span></button>`;
    let cells = it('take', 'استخدام المايك', 'mic', !canTake) + it('invite', 'ادعيه', 'invite', locked);
    if (idx > 0) {
      cells += it('mute', muted ? 'إلغاء كتم الصوت' : 'كتم الصوت', muted ? 'spkOff' : 'micOff');
      cells += it('lock', locked ? 'فتح المقعد' : 'غلق المقعد', locked ? 'unlock' : 'lock');
      cells += it('muteall', ctx.allMuted ? 'إلغاء كتم الكل' : 'كتم صوت الكل', ctx.allMuted ? 'group' : 'groupOff');
    }
    const l = showLayer(`<div class="rv-sheet rv-actions"><div class="rv-act-grid">${cells}</div></div>`);
    wire(l, '.rv-ctl', (b) => {
      const a = b.dataset.a; const sock = st().socket;
      if (a === 'take') { closeLayer(); App().takeSeatAction(idx); }
      else if (a === 'invite') openInvite(idx);
      else if (a === 'mute') {
        sock.emit('admin_mute_seat', { roomId: roomId(), seatIndex: idx, adminId: me().id, isMuted: !muted });
        if (muted) ctx.mutedSeats.delete(idx); else ctx.mutedSeats.add(idx); closeLayer();
      } else if (a === 'lock') {
        sock.emit('admin_lock_seat', { roomId: roomId(), seatIndex: idx, adminId: me().id, isLocked: !locked }); closeLayer();
        setTimeout(computeLockState, 400);
      } else if (a === 'muteall') {
        ctx.allMuted = !ctx.allMuted; sock.emit('admin_mute_all_seats', { roomId: roomId(), adminId: me().id, isMuted: ctx.allMuted }); closeLayer();
        toast(ctx.allMuted ? 'تم كتم صوت الجميع' : 'تم إلغاء كتم الجميع');
      }
    });
  }

  async function openInvite(seatIdx) {
    const l = showLayer(`
      <div class="rv-invite">
        <button type="button" class="rv-x" style="top:16px">✕</button>
        <h4>المستخدمون الذين يمكنك دعوتهم</h4>
        <div class="rv-search">${ico('search').replace('<svg', '<svg width="16" height="16" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"')}<input id="rv-q" placeholder="ابحث عن اسم أو ID"></div>
        <div class="rv-ulist" id="rv-ul"><div class="rv-empty">جارٍ التحميل…</div></div>
      </div>`);
    l.querySelector('.rv-x').onclick = closeLayer;
    let users = [];
    try {
      const d = await api('GET', `/api/rooms/${roomId()}/people`);
      users = (d.online || []);
    } catch (e) { users = st().activeRoomAudience || []; }
    const seatedIds = new Set((ctx.room.seats || []).filter(s => s.user_id).map(s => s.user_id));
    users = users.filter(u => u && u.id && u.id !== me().id && !seatedIds.has(u.id));
    const list = l.querySelector('#rv-ul'); const q = l.querySelector('#rv-q');
    function paint() {
      const k = q.value.trim().toLowerCase();
      const f = users.filter(u => !k || String(u.name || '').toLowerCase().includes(k) || String(u.id).toLowerCase().includes(k));
      if (!f.length) {
        list.innerHTML = `<div class="rv-empty"><svg viewBox="0 0 120 70" fill="none" stroke="#fff" stroke-width="2"><circle cx="30" cy="18" r="8"/><path d="M4 62c14-20 30-26 52-14l18-12c10 8 26 14 42 26"/></svg>لا يوجد محتوى</div>`; return;
      }
      list.innerHTML = f.map(u => `<div class="rv-user"><img src="${esc(u.avatar || '/avatars/avatar-1.png')}" alt="" onerror="this.src='/avatars/avatar-1.png'"><div>${esc(u.name || 'مستخدم')}<small>ID: ${esc(String(u.id).slice(-8))}</small></div><button type="button" data-id="${esc(u.id)}">دعوة</button></div>`).join('');
      wire(list, 'button[data-id]', (b) => {
        st().socket.emit('invite_to_seat', { roomId: roomId(), targetUserId: b.dataset.id, seatIndex: seatIdx === 0 ? 1 : seatIdx, adminId: me().id });
        b.disabled = true; b.textContent = 'تم الإرسال';
      });
    }
    q.oninput = paint; paint();
  }

  // ====== أحداث الـ socket ======
  function on(ev, fn) { st().socket.on(ev, fn); sockHandlers.push([ev, fn]); }
  function bindSockets() {
    if (!st().socket) return;
    on('room_settings_changed', (s) => {
      if (!ctx || s.roomId !== roomId()) return;
      applyRoomMeta(s);
      ctx.chat = s.chat_settings || {}; ctx.seatS = s.seat_settings || {};
      if (s.bg_image !== undefined && s.bg_image !== (ctx.room.bg_image || '')) applyBg(s.bg_image);
      applyChatSettings(); applySeatSettings();
      if (s.toast && s.by !== me().name) toast(s.toast);
    });
    on('room_seat_count_changed', (d) => {
      if (!ctx || d.roomId !== roomId()) return;
      ctx.room.seat_count = d.seatCount; layoutSeats(); computeLockState();
    });
    on('all_seats_lock_changed', (d) => { if (ctx && d.roomId === roomId()) ctx.allLocked = !!d.isLocked; });
    on('all_seats_mute_changed', (d) => { if (ctx && d.roomId === roomId()) ctx.allMuted = !!d.isMuted; });
    on('seat_mute_changed', (d) => {
      if (!ctx || d.roomId !== roomId()) return;
      if (d.isMuted && !d.userId) ctx.mutedSeats.add(d.seatIndex); else if (!d.isMuted) ctx.mutedSeats.delete(d.seatIndex);
    });
    on('seat_invite', async (d) => {
      if (!ctx || d.roomId !== roomId()) return;
      if (await window.uiConfirm(`${d.fromName} يدعوك للصعود إلى المايك 🎙️`, { icon: '🎙️', okText: 'صعود' })) App().takeSeatAction(d.seatIndex);
    });
    on('user_joined_room', (d) => {
      if (!ctx || !ctx.chat.auto_welcome || ctx.room.host_id !== me().id) return;
      const u = d && d.user; if (!u || u.id === me().id) return;
      st().socket.emit('send_room_message', { roomId: roomId(), userId: me().id, content: `أهلاً وسهلاً بـ ${u.name} في الغرفة 🌹` });
    });
  }
})();
