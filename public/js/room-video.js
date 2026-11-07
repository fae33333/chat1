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
  const IC_F7 = {
    doc: 'doc_text', image: 'photo', chat: 'chat_bubble_2', music: 'music_note_2', seat: 'person_crop_circle|person_fill',
    mic: 'mic_fill', micOff: 'mic_slash_fill', spk: 'speaker_2_fill', spkOff: 'speaker_slash_fill', unlock: 'lock_open', lock: 'lock_fill',
    shrink: 'arrow_down_right_and_arrow_up_left', power: 'power', invite: 'person_badge_plus', groupOff: 'person_2|person_fill', group: 'person_2_fill',
    gear: 'gear', share: 'square_arrow_up', dots: 'ellipsis', menu: 'list_bullet', play: 'play_fill', clap: 'hand_thumbsup_fill', search: 'search'
  };
  const ico = (k) => `<i class="f7-icons rv-f7">${IC_F7[k] || 'circle'}</i>`;

  // أيقونات لوحة التحكم (مملوءة بيضاء كما في فيديو «قالب الخروج»)
  const CF = {
    profile: '<path d="M6 3h8l5 5v13H6z"/><path class="k" d="M9 15h5M9 18h3"/>',
    bg: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle class="kf" cx="8.5" cy="9.5" r="1.7"/><path class="kf" d="M4.5 18l5-5.5 3.5 3.5 2.5-2.5 4 4.5z"/>',
    chat: '<path d="M4 4h16a1 1 0 011 1v11a1 1 0 01-1 1h-5.5L12 20.5 9.5 17H4a1 1 0 01-1-1V5a1 1 0 011-1z"/><circle class="kf" cx="8" cy="10.5" r="1.3"/><circle class="kf" cx="12" cy="10.5" r="1.3"/><circle class="kf" cx="16" cy="10.5" r="1.3"/>',
    sound: '<circle cx="7" cy="18" r="3.2"/><circle cx="17" cy="16" r="3.2"/><path class="s" d="M10 18V5.5l10-2.3V16"/>',
    seats: '<rect x="6" y="4" width="12" height="7.5" rx="2"/><path d="M3 12.8a2 2 0 014 0V15h10v-2.2a2 2 0 014 0V19a1 1 0 01-1 1H4a1 1 0 01-1-1z"/><path class="s" d="M6.5 20v1.5M17.5 20v1.5"/>',
    mic: '<path d="M14.6 3.4a4 4 0 015.7 5.7l-3.4 3.4-5.7-5.7z"/><path class="s" d="M11 10l-7 9.5L5.5 21l9-7.2"/>',
    micOff: '<path d="M14.6 3.4a4 4 0 015.7 5.7l-3.4 3.4-5.7-5.7z"/><path class="s" d="M11 10l-7 9.5L5.5 21l9-7.2M3 3l18 18"/>',
    silence: '<path d="M4 9.5v5h3.8L13 19V5L7.8 9.5z"/><path class="s" d="M16 9.2a4 4 0 010 5.6M18.4 6.6a7.6 7.6 0 010 10.8"/>',
    silenceOff: '<path d="M4 9.5v5h3.8L13 19V5L7.8 9.5z"/><path class="s" d="M16.5 9.5l4.5 5M21 9.5l-4.5 5"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path class="s" d="M8 11V8a4 4 0 017.6-1.7"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path class="s" d="M8 11V8a4 4 0 018 0v3"/>',
    minimize: '<path class="s" d="M14 10l6.5-6.5M15 3.5V10h6.5M10 14l-6.5 6.5M9 20.5V14H2.5"/>',
    exit: '<path class="s" d="M12 3v8.5"/><path class="s" d="M6.6 6.8a7.5 7.5 0 1010.8 0"/>'
  };
  const CF_F7 = {
    profile: 'person_fill', bg: 'photo', chat: 'chat_bubble_2', sound: 'speaker_2_fill', seats: 'rectangle_grid_2x2|person_2_fill',
    mic: 'mic_fill', micOff: 'mic_slash_fill', silence: 'speaker_slash_fill', silenceOff: 'speaker_2_fill', unlock: 'lock_open', lock: 'lock_fill',
    minimize: 'arrow_down_right_and_arrow_up_left', exit: 'arrow_right_square|square_arrow_right|power'
  };
  const cfIcon = (k) => `<i class="f7-icons rv-f7 rv-cf">${CF_F7[k] || 'circle'}</i>`;

  // ====== الخلفيات ======
  const BG_DEFAULT = 'radial-gradient(ellipse at 50% 18%, #4a2a86 0%, #1d1038 48%, #0a0614 100%)';
  const READY_BG = [
    { id: 'royal', name: 'افتراضي', css: BG_DEFAULT }
  ];
  // صور خلفية جاهزة مجانية (public/img/bg/bg-1.webp ... bg-15.webp)
  const READY_BG_NAMES = ['تاج الشفق','واحة المرصد','مملكة البلور','شلال الزمرد','عرش الأسد','ساكورا نيون','قصر القمر','مجلس السلطان','الجواد الأبيض','الفستان الأحمر','النرد الأحمر','نار الشاطئ','حورية القمر','الإطار الذهبي','شعار المملكة'];
  const READY_BG_IMAGES = READY_BG_NAMES.map((name, i) => ({ id: 'img' + (i + 1), name, url: `/img/bg/bg-${i + 1}.webp` }));
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

  // مكتبة الموسيقى شخصية ومحفوظة على الخادم؛ التشغيل يمر عبر مسار صوت المقعد
  // الحالي حتى يسمعها كل من في الغرفة عبر WebRTC.
  const musicLibrary = [];
  let musicLibraryOwnerId = null;

  // ===== مشغّل الموسيقى المستقل =====
  // حالة التشغيل (عنصر الصوت + AudioContext + بثّ المايك) تعيش هنا، خارج نافذة الغرفة تماماً،
  // فلا يوقفها تصغير الغرفة ولا إعادة رسمها ولا فتح أي قالب أو صفحة أخرى؛ تتوقف فقط بضغط زر الإيقاف
  // أو بالخروج الفعلي من الغرفة / النزول من المقعد (لأن البث يمر عبر مايك المقعد).
  const MP = {
    selectedId: null, current: null, audio: null, audioContext: null, mediaSource: null, destination: null, analyser: null, gain: null,
    playing: false, paused: false, minimized: false, userPaused: false, ownerId: null, seatIndex: null, roomId: null,
    ytToken: null, ytTick: null, ytPlayer: null, ytBox: null, ytHb: null, startedAt: 0, ytRetried: false, ytServerRetried: false,
    autoTimes: [], seatMoveTimer: null, repeat: 'all', volume: 1, sort: 'added', volTimer: null,
    view: 'list', query: '', searchOpen: false, yt: null
  };
  const newYtState = () => ({ q: '', lastQ: '', items: [], next: null, busy: false, err: '' });
  MP.yt = newYtState();
  const findTrack = (id) => musicLibrary.find(t => t.id === id);

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
    if (!u) return false;
    if (room.host_id === u.id || App().isPlatformStaff(u)) return true;
    return !!(App().isRoomManagerNow && App().isRoomManagerNow(room));
  }

  function setup(room, modal, container) {
    cleanup();
    ctx = { room, modal, container, layer: null, bg: null, admin: isAdminUser(room), chat: jp(room.chat_settings, {}), seatS: jp(room.seat_settings, {}),
            mutedSeats: new Set(), remoteMusic: new Map(), allMuted: false, allLocked: false, audioMuted: false, bgPicked: loadMyBgs(),
            music: MP };
    MP.view = 'list'; MP.query = ''; MP.searchOpen = false; MP.yt = newYtState(); clearTimeout(MP.volTimer);
    if (window.soulRtc && typeof window.soulRtc.setRemoteAudioMuted === 'function') window.soulRtc.setRemoteAudioMuted(false);
    if (musicLibraryOwnerId !== me()?.id) { musicLibrary.splice(0, musicLibrary.length); }
    loadMusicLibrary();
    (room.seats || []).forEach(s => { if (s.seat_index > 0 && s.is_muted && !s.user_id) ctx.mutedSeats.add(s.seat_index); });
    const guestSeats = (room.seats || []).filter(s => s.seat_index > 0 && s.seat_index <= (room.seat_count || 8));
    ctx.allMuted = guestSeats.length > 0 && guestSeats.every(s => !!s.is_muted);

    // الخلفية + الطبقة
    const bg = document.createElement('div'); bg.className = 'rv-bg'; container.prepend(bg); ctx.bg = bg;
    applyBg(room.bg_image);
    const layer = document.createElement('div'); layer.className = 'rv-layer';
    layer.addEventListener('click', (ev) => {
      if (ev.target !== layer) return;
      const wasMusic = layer.dataset.sheet === 'music';
      closeLayer();
      if (wasMusic) minimizeMusicPlayer();
    });
    container.appendChild(layer); ctx.layer = layer;
    renderMusicNowPlaying();
    container.addEventListener('click', (event) => {
      if (!ctx?.music?.playing || !ctx.music.current || ctx.music.minimized) return;
      if (event.target.closest('.rv-now-playing, .rv-music-mini, .rv-layer, .rv-vol-layer')) return;
      minimizeMusicPlayer();
    });

    buildTopButtons();
    bindRoomCardClick();
    buildBottomBar();
    addTips();
    layoutSeats();
    applyChatSettings();
    applySeatSettings();
    computeLockState();
    interceptSeatClicks();
    bindSockets();
    armBackToMinimize();
    resumeMusicUi();

    // مراقبة إغلاق الغرفة لتنظيف الموارد
    bodyObs = new MutationObserver(() => { if (ctx && !document.body.contains(ctx.modal)) cleanup(); });
    bodyObs.observe(document.body, { childList: true });
  }

  // ===== ربط الواجهة بالمشغّل المستقل =====
  function activeRoomIs(rid) {
    try { const a = App() && st().activeRoom; return !!(a && rid && String(a.id) === String(rid)); } catch (e) { return false; }
  }
  // عند فتح نافذة الغرفة (من جديد) والأغنية ما زالت تعمل: نعيد ربط الواجهة فقط، الصوت لم ينقطع أصلاً
  function resumeMusicUi() {
    const m = MP;
    if (!m.playing || !m.current) return;
    if (!activeRoomIs(m.roomId) || String(ctx.room.id) !== String(m.roomId) || !onSeat()) { stopRoomMusic(true); return; }
    m.seatIndex = st().userSeatIndex; m.minimized = true;
    setMusicRings(me().id, !m.paused, m.seatIndex);
    publishRoomMusic('room_music_started', m.current);
    attachMusicToVoice();
    renderMusicNowPlaying(); renderMusicSeatIndicator();
  }

  // ===== شريط تحكم عائم يظهر خارج نافذة الغرفة (الغرفة مصغّرة أو مغلقة) كي تتمكن من إيقاف الأغنية =====
  let gchip = null, gchipKey = '';
  function roomWindowVisible() {
    return !!(ctx && ctx.modal && document.body.contains(ctx.modal) && !ctx.modal.classList.contains('rv-minimized'));
  }
  function renderGlobalChip() {
    const show = !!(MP.playing && MP.current && !roomWindowVisible());
    if (!show) { if (gchip) { gchip.remove(); gchip = null; gchipKey = ''; } return; }
    const key = (MP.current.id || '') + '|' + (MP.paused ? 1 : 0);
    if (gchip && gchip.isConnected && key === gchipKey) return;
    gchipKey = key;
    if (!gchip || !gchip.isConnected) {
      gchip = document.createElement('div');
      gchip.className = 'rv-gchip';
      gchip.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-g]'); if (!b) return;
        ev.stopPropagation();
        if (b.dataset.g === 'stop') stopRoomMusic(true);
        else if (b.dataset.g === 'toggle') toggleMusicPause();
        else if (b.dataset.g === 'next') playAdjacent(1);
      });
      document.body.appendChild(gchip);
    }
    gchip.innerHTML = `<span class="rv-gchip-eq ${MP.paused ? '' : 'live'}"><i></i><i></i><i></i></span>
      <span class="rv-gchip-title">${esc(MP.current.title || 'موسيقى')}</span>
      <button type="button" data-g="toggle" aria-label="${MP.paused ? 'تشغيل' : 'إيقاف مؤقت'}">${mIcon(MP.paused ? 'play' : 'pause')}</button>
      <button type="button" data-g="next" aria-label="التالي">${mIcon('next')}</button>
      <button type="button" data-g="stop" aria-label="إيقاف الموسيقى">${mIcon('power')}</button>`;
  }

  // حارس المشغّل: يعمل دائماً ولا يعتمد على نافذة الغرفة
  //  - خروج فعلي من الغرفة أو نزول من المقعد (تأكيد بعد عدة نبضات لتفادي لحظة تبديل المقعد) ← إيقاف
  //  - غير ذلك: يمنع المتصفح من تعليق الصوت (تصغير/قفل/تبديل تطبيق) ويبقي دمج المايك حيّاً
  let guardOffRoom = 0, guardOffSeat = 0;
  setInterval(() => {
    try {
      const m = MP;
      if (!m.playing || !m.audio) { guardOffRoom = guardOffSeat = 0; renderGlobalChip(); return; }
      guardOffRoom = activeRoomIs(m.roomId) ? 0 : guardOffRoom + 1;
      guardOffSeat = onSeat() ? 0 : guardOffSeat + 1;
      if (guardOffRoom >= 2 || guardOffSeat >= 4) { guardOffRoom = guardOffSeat = 0; stopRoomMusic(true); return; }
      if (m.audioContext && m.audioContext.state !== 'running') m.audioContext.resume().catch(() => {});
      if (m.audio.paused && !m.userPaused && !m.audio.ended) m.audio.play().catch(() => {});
      if (window.soulRtc && window.soulRtc.ensureMixerAlive) window.soulRtc.ensureMixerAlive();
      renderGlobalChip();
    } catch (e) {}
  }, 1500);

  function cleanup() {
    if (!ctx && !sockHandlers.length) return;
    const sock = App() && st().socket;
    if (sock) sockHandlers.forEach(([ev, fn]) => sock.off(ev, fn));
    sockHandlers = [];
    if (bodyObs) { bodyObs.disconnect(); bodyObs = null; }
    if (audioObs) { audioObs.disconnect(); audioObs = null; }
    document.querySelectorAll('.rv-mini').forEach(n => n.remove());
    if (ctx && ctx.audioMuted) document.querySelectorAll('audio').forEach(a => { a.muted = false; });
    if (window.soulRtc && typeof window.soulRtc.setRemoteAudioMuted === 'function') window.soulRtc.setRemoteAudioMuted(false);
    // المشغّل مستقل: إغلاق/إعادة رسم نافذة الغرفة لا يوقفه. يتوقف فقط إن غادرتَ الغرفة فعلاً
    if (ctx) ytRemoteStop();
    const leaving = MP.playing && !activeRoomIs(MP.roomId);
    ctx = null;
    if (leaving) stopRoomMusic(true);
    renderGlobalChip();
  }

  // ====== الخلفية ======
  function applyBg(val, preview) {
    const bg = ctx.bg; if (!bg) return;
    val = val || '';
    // نفس الخلفية معروضة أصلاً: لا نعيد بناءها (يمنع أي وميض/إعادة تحميل)
    if (bg.dataset.cur === val && bg.querySelector(':scope > .rv-bg-img, :scope > .sc-html-layer')) {
      if (!preview) ctx.room.bg_image = val;
      return;
    }
    bg.dataset.cur = val;
    const tok = (bg._tok = (bg._tok || 0) + 1);
    const isHtmlBg = val && !val.startsWith('grad:') && !val.startsWith('anim:') && window.SCHtml && window.SCHtml.isHtml(val);
    const isImg = val && !val.startsWith('grad:') && !val.startsWith('anim:') && !isHtmlBg;
    bg.className = 'rv-bg';
    if (!bg.style.background || bg.style.background === 'none') bg.style.background = BG_DEFAULT;

    if (isHtmlBg) {
      // خلفية HTML: iframe معزول يملأ الخلفية
      bg.querySelectorAll(':scope > .rv-bg-img').forEach(n => n.remove());
      bg.style.background = BG_DEFAULT;
      window.SCHtml.attach(bg, val);
    } else {
      // كل الأنواع (صورة / لون / متحرك): طبقة جديدة فوق القديمة تظهر بتلاشي متقاطع
      const layer = document.createElement('div'); layer.className = 'rv-bg-img';
      if (isImg) {
        layer.style.backgroundImage = `url("${val.replace(/"/g, '%22')}")`;
        const tw = document.createElement('div'); tw.className = 'rv-bg-twinkle';
        layer.appendChild(tw);
      } else {
        layer.classList.add('rv-bg-flat');
        if (val.startsWith('anim:')) {
          const inner = document.createElement('div');
          inner.className = 'rv-anim-' + val.slice(5).replace(/[^a-z]/g, '');
          inner.style.cssText = 'position:absolute;inset:0';
          layer.appendChild(inner);
        } else {
          const p = val.startsWith('grad:') ? READY_BG.find(x => x.id === val.slice(5)) : null;
          layer.style.background = p ? p.css : BG_DEFAULT;
        }
      }
      bg.appendChild(layer); // فوق القديمة ليظهر التلاشي فعلاً
      const show = () => {
        if (bg._tok !== tok) { layer.remove(); return; } // نقرة أحدث ألغت هذه
        requestAnimationFrame(() => {
          layer.classList.add('in');
          setTimeout(() => {
            if (bg._tok !== tok) return;
            Array.from(bg.children).forEach(n => {
              if (n !== layer && (n.classList.contains('rv-bg-img') || n.classList.contains('sc-html-layer'))) n.remove();
            });
            if (window.SCHtml) window.SCHtml.detach(bg);
          }, 950);
        });
      };
      if (isImg) { const img = new Image(); img.onload = show; img.onerror = show; img.src = val; if (img.complete) { img.onload = null; show(); } }
      else show();
    }
    if (!preview) ctx.room.bg_image = val;
  }
  function loadMyBgs() { try { return JSON.parse(sessionStorage.getItem('rv_my_bgs') || '[]'); } catch (e) { return []; } }
  function saveMyBgs(a) { try { sessionStorage.setItem('rv_my_bgs', JSON.stringify(a.slice(0, 18))); } catch (e) {} }

  // ====== الشريط العلوي / السفلي / الألعاب ======
  function buildTopButtons() {
    const actions = ctx.modal.querySelector('.live-room-actions');
    if (!actions) return;
    const mk = (html, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'rv-top-btn'; b.title = title; b.innerHTML = html; b.onclick = fn; return b; };
    // صاحب الغرفة: زر خاص بجانب زر القائمة يفتح قالب الغرفة (الحذف + كلمة المرور)
    if (isRoomOwner(ctx.room)) {
      const ob = mk('<i class="f7-icons rv-f7">star_circle_fill</i>', 'قالب الغرفة (صاحب الغرفة)', openRoomCard);
      ob.classList.add('rv-owner-btn');
      actions.insertBefore(ob, actions.firstChild);
    }
    actions.appendChild(mk(ico('dots', true), 'إعدادات الغرفة', openControl));
  }

  function buildBottomBar() {
    const bar = ctx.modal.querySelector('.room-bottom-controls'); if (!bar) return;
    // القائمة السفلية مخصصة لأداتين فقط: الإكسسوارات والموسيقى.
    // أزيلت منها أزرار تحدي PK ومركز الترفيه نهائياً.
    if (!bar.querySelector('.rv-menu-btn')) {
      const m = document.createElement('button'); m.type = 'button'; m.className = 'room-tool-btn rv-menu-btn'; m.title = 'مركز الترفيه';
      m.setAttribute('aria-label', 'مركز الترفيه');
      m.innerHTML = `<i class="f7-icons rv-f7">list_bullet</i>`;
      m.onclick = openRoomTools;
      bar.appendChild(m);
    }
    // تحويل أيقونة الهدية إلى رسم أبيض/وردي خفيف كما في تصميم الغرفة.
    const gift = bar.querySelector('#room-open-gifts-btn');
    if (gift) gift.innerHTML = `<i class="f7-icons rv-f7" style="color:#ff4fa3">gift_fill</i>`;
  }

  // ====== مركز الترفيه (مطابق لفيديو «الصوت والأغاني») ======
  function openRoomTools() {
    if (!ctx) return;
    const l = showLayer(`
      <div class="rv-sheet rv-ent-sheet" role="dialog" aria-label="مركز الترفيه">
        <button type="button" class="rv-ent-x" aria-label="إغلاق"><i class="f7-icons rv-f7">xmark</i></button>
        <div class="rv-ent-title">مركز الترفيه</div>
        <div class="rv-ent-sec">مركز الألعاب</div>
        <div class="rv-ent-grid">
          <button type="button" class="rv-ent-item" data-room-tool="music"><i>🎷</i><span>موسيقى</span></button>
          <button type="button" class="rv-ent-item" data-room-tool="accessories"><i>🧰</i><span>إكسسوارات</span></button>
          <button type="button" class="rv-ent-item" data-room-tool="store"><i>🏪</i><span>المتجر</span></button>
        </div>
      </div>`);
    l.querySelector('.rv-ent-x').onclick = closeLayer;
    wire(l, '[data-room-tool]', (button) => {
      if (button.dataset.roomTool === 'accessories') {
        closeLayer();
        App().openRoomAccessoriesModal(ctx.room);
      } else if (button.dataset.roomTool === 'store') {
        closeLayer();
        App().openStore();
      } else {
        openMusicSheet();
      }
    });
  }

  // ====== الموسيقى: قائمة التشغيل + مشغّل + صوت (مطابقة لفيديو «الصوت والأغاني») ======
  const MI = {
    search: '<circle cx="11" cy="11" r="6.2"/><path d="M20 20l-4.4-4.4"/>',
    sort: '<path d="M8 20V5M4.5 8.5L8 5l3.5 3.5M16 4v15M12.5 15.5L16 19l3.5-3.5"/>',
    trash: '<path d="M5 7h14M9.5 7V4.8h5V7M7 7l.9 13h8.2L17 7M10.3 11v6M13.7 11v6"/>',
    play: '<path d="M7.5 5l11.5 7-11.5 7z"/>',
    plus: '<path d="M12 6v12M6 12h12"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    chev: '<path d="M9 5l7 7-7 7"/>',
    power: '<path d="M12 3v8.5"/><path d="M6.6 6.8a7.5 7.5 0 1010.8 0"/>',
    vol: '<path d="M4 9.5v5h3.8L13 19V5L7.8 9.5z"/><path d="M16.2 9.2a4 4 0 010 5.6"/>',
    shrink: '<path d="M14 10l6-6M15 4.5V10h5.5M10 14l-6 6M9 19.5V14H3.5"/>',
    list: '<path d="M4 7h16M4 12h11M4 17h7"/>',
    prev: '<path d="M6 5v14"/><path d="M19 5.2L9 12l10 6.8z"/>',
    next: '<path d="M18 5v14"/><path d="M5 5.2L15 12 5 18.8z"/>',
    pause: '<rect x="6.2" y="5" width="3.8" height="14" rx="1.3"/><rect x="14" y="5" width="3.8" height="14" rx="1.3"/>',
    repeat: '<path d="M17 3l3.2 3.2L17 9.4M4 11V9.5A3.3 3.3 0 017.3 6.2H20M7 21l-3.2-3.2L7 14.6M20 13v1.5a3.3 3.3 0 01-3.3 3.3H4"/>',
    scan: '<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="3.2"/><path d="M12 3.8v2.2"/>',
    volPlus: '<path d="M3 9.5v5h3.8L12 19V5L6.8 9.5z"/><path d="M15.5 12h5M18 9.5v5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
    volMinus: '<path d="M3 9.5v5h3.8L12 19V5L6.8 9.5z"/><path d="M15.5 12h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>'
  };
  const MI_FILL = new Set(['play', 'prev', 'next', 'pause', 'volPlus', 'volMinus']);
  const MI_F7 = {
    search: 'search', sort: 'arrow_up_arrow_down|list_bullet', trash: 'trash', play: 'play_fill', plus: 'plus', check: 'checkmark', chev: 'chevron_left',
    power: 'power', vol: 'speaker_2_fill', shrink: 'arrow_down_right_and_arrow_up_left', list: 'list_bullet', prev: 'backward_fill|backward_end_fill',
    next: 'forward_fill|forward_end_fill', pause: 'pause_fill', repeat: 'repeat', scan: 'viewfinder', volPlus: 'speaker_3_fill|speaker_2_fill', volMinus: 'speaker_1_fill|speaker_fill'
  };
  const mIcon = (k) => `<i class="f7-icons rv-f7">${MI_F7[k] || 'circle'}</i>`;
  const NOTES_ART = '<svg viewBox="0 0 120 100" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="22" cy="47" rx="7.5" ry="5.6" transform="rotate(-22 22 47)"/><path d="M28.5 44.5V19c0 0 9-1 9 7"/><circle cx="41" cy="25" r="3.6"/><ellipse cx="75" cy="35" rx="8.6" ry="6.2" transform="rotate(-22 75 35)"/><ellipse cx="97" cy="31" rx="8.6" ry="6.2" transform="rotate(-22 97 31)"/><path d="M82.5 32V11l22-4.5V28M82.5 17l22-4.5"/><circle cx="26" cy="77" r="9.5"/><ellipse cx="57" cy="78" rx="7.2" ry="5.4" transform="rotate(-22 57 78)"/><path d="M63 76V51"/><circle cx="91" cy="72" r="2.6"/></svg>';
  const fmtTime = (s) => { s = Math.max(0, Math.floor(s || 0)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const UNKNOWN = 'غير معروف';

  function normalizeMusicTrack(track) {
    return Object.assign({}, track, { fileName: track.fileName || track.file_name || '' });
  }

  async function loadMusicLibrary() {
    const user = me();
    if (!user || !user.id) return;
    const ownerId = user.id;
    try {
      const data = await api('GET', '/api/music-library');
      if (me()?.id !== ownerId) return;
      musicLibrary.splice(0, musicLibrary.length, ...(data.tracks || []).map(normalizeMusicTrack));
      musicLibraryOwnerId = ownerId;
      if (ctx) paintMusicSheet();
      scheduleMusicPoll();
    } catch (err) {
      console.error('music library load:', err);
      scheduleMusicPoll();
    }
  }

  // أثناء تحميل أغنية على الخادم نحدّث القائمة كل بضع ثوانٍ حتى تتحول الحالة إلى «جاهزة» أو «فشل»
  let musicPollTimer = null;
  const musicNeedsPoll = () => musicLibrary.some(t => t.audio_status === 'processing');
  function scheduleMusicPoll() {
    if (musicPollTimer || !musicNeedsPoll()) return;
    musicPollTimer = setTimeout(() => {
      musicPollTimer = null;
      if (!me() || !musicNeedsPoll()) return;
      loadMusicLibrary();
    }, 6000);
  }
  async function retryMusicTrack(id) {
    try {
      const data = await api('POST', `/api/music-library/${encodeURIComponent(id)}/retry`);
      const i = musicLibrary.findIndex(t => t.id === id);
      if (i >= 0 && data.track) musicLibrary[i] = normalizeMusicTrack(data.track);
      toast('جارٍ إعادة تحميل الأغنية…');
      if (ctx) paintMusicSheet();
      scheduleMusicPoll();
    } catch (err) { toast(err.message); }
  }
  // ترتيب القائمة: حسب الإضافة (الأحدث أولاً) أو حسب الاسم
  function orderedTracks() {
    const arr = musicLibrary.slice();
    if (MP.sort === 'name') arr.sort((a, b) => String(a.title).localeCompare(String(b.title), 'ar'));
    return arr;
  }
  function visibleTracks() {
    const q = ctx.music.query.trim().toLowerCase();
    const arr = orderedTracks();
    return q ? arr.filter(t => String(t.title).toLowerCase().includes(q)) : arr;
  }

  // ===== يوتيوب: البحث وحفظ الأغاني في القائمة =====
  const safeThumb = (u) => /^https:\/\/i\.ytimg\.com\//.test(String(u || '')) ? String(u) : '';

  function friendlyYtError(msg) {
    if (!msg) return 'تعذر البحث في يوتيوب';
    if (/Failed to fetch/i.test(msg) || /NetworkError/i.test(msg)) return 'تعذر الاتصال بالخادم — تأكد من اتصالك';
    if (/YOUTUBE_API_KEY/.test(msg)) return msg;
    return msg;
  }
  async function ytSearch(more) {
    if (!ctx) return;
    const y = ctx.music.yt;
    const q = String(more ? y.lastQ : y.q).trim();
    if (q.length < 2) return toast('اكتب اسم الأغنية أو الفنان');
    if (y.busy) return;
    y.busy = true; y.err = '';
    if (!more) { y.items = []; y.next = null; y.lastQ = q; }
    paintMusicBody();
    try {
      const qs = new URLSearchParams({ q, music: '1' });
      if (more && y.next) qs.set('pageToken', y.next);
      const d = await api('GET', '/api/youtube/search?' + qs.toString());
      y.items = y.items.concat(d.items || []);
      y.next = d.nextPageToken || null;
      if (!y.items.length) y.err = 'لا توجد نتائج — جرّب كلمات أخرى أو الصق رابط يوتيوب مباشرة';
    } catch (err) {
      y.err = friendlyYtError(err.message || 'تعذر البحث في يوتيوب');
    } finally {
      y.busy = false;
    }
    if (ctx) paintMusicBody();
  }

  async function saveYtTrack(videoId) {
    if (!ctx) return;
    const it = ctx.music.yt.items.find(x => x.id === videoId);
    if (!it) return;
    if (musicLibrary.some(t => t.yt_id === videoId)) return toast('الأغنية موجودة في قائمتك');
    try {
      const data = await api('POST', '/api/music-library', { youtube_id: it.id, title: it.title, artist: it.channel, thumbnail: it.thumbnail });
      if (data.track) musicLibrary.unshift(normalizeMusicTrack(data.track));
      musicLibraryOwnerId = me()?.id || musicLibraryOwnerId;
      toast(data.track && data.track.audio_status === 'processing' ? 'تمت الإضافة — جارٍ تحميل الأغنية وحفظها 🎵' : 'تمت إضافة الأغنية إلى قائمتك 🎵');
      scheduleMusicPoll();
    } catch (err) {
      toast(err.message);
    }
    if (ctx) paintMusicBody();
  }

  // ===== إضافة صوتيات من ملفات الهاتف: تُضغط في الجهاز ثم تُرفع إلى حسابك فتظهر على كل أجهزتك =====
  const MUSIC_UPLOAD_MAX_MB = 150;        // الحجم الأصلي المسموح اختياره (يُضغط قبل الرفع)
  const MUSIC_OPUS_KBPS = 32;             // جودة الضغط: mono Opus — غيّر الرقم (24 أصغر، 48 أوضح)
  let musicUploading = false;

  // <ogg-muxer>
  const OGG_CRC = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { let r = (i << 24) >>> 0; for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? (((r << 1) ^ 0x04c11db7) >>> 0) : ((r << 1) >>> 0); t[i] = r; }
    return t;
  })();
  function oggCrc(bytes) { let c = 0; for (let i = 0; i < bytes.length; i++) c = (((c << 8) >>> 0) ^ OGG_CRC[((c >>> 24) ^ bytes[i]) & 0xff]) >>> 0; return c >>> 0; }
  function oggPage(type, granule, serial, seq, packets) {
    const segs = [];
    for (const p of packets) { let n = p.length; while (n >= 255) { segs.push(255); n -= 255; } segs.push(n); }
    let body = 0; for (const p of packets) body += p.length;
    const out = new Uint8Array(27 + segs.length + body);
    const dv = new DataView(out.buffer);
    out.set([0x4f, 0x67, 0x67, 0x53, 0, type], 0);
    dv.setUint32(6, granule >>> 0, true); dv.setUint32(10, Math.floor(granule / 4294967296), true);
    dv.setUint32(14, serial, true); dv.setUint32(18, seq, true);
    out[26] = segs.length; out.set(segs, 27);
    let o = 27 + segs.length; for (const p of packets) { out.set(p, o); o += p.length; }
    dv.setUint32(22, oggCrc(out), true);
    return out;
  }
  // يحوّل حزم Opus الخام إلى ملف Ogg Opus: packets = [{data:Uint8Array, samples:Number(48kHz)}]
  function muxOggOpus(packets, channels, preSkip) {
    const serial = (Math.random() * 0xffffffff) >>> 0;
    const head = new Uint8Array(19); const hv = new DataView(head.buffer);
    head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0); head[8] = 1; head[9] = channels;
    hv.setUint16(10, preSkip, true); hv.setUint32(12, 48000, true); hv.setInt16(16, 0, true); head[18] = 0;
    const vendor = new TextEncoder().encode('soulchill');
    const tags = new Uint8Array(8 + 4 + vendor.length + 4); const tv = new DataView(tags.buffer);
    tags.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0); tv.setUint32(8, vendor.length, true); tags.set(vendor, 12); tv.setUint32(12 + vendor.length, 0, true);
    const parts = [oggPage(0x02, 0, serial, 0, [head]), oggPage(0, 0, serial, 1, [tags])];
    let seq = 2, gran = preSkip, batch = [], batchSegs = 0;
    const flush = (last) => { parts.push(oggPage(last ? 0x04 : 0, gran, serial, seq++, batch)); batch = []; batchSegs = 0; };
    for (let i = 0; i < packets.length; i++) {
      const p = packets[i], segs = Math.floor(p.data.length / 255) + 1;
      if (batch.length && (batchSegs + segs > 250)) flush(false);
      batch.push(p.data); batchSegs += segs; gran += p.samples;
      if (batch.length >= 50) flush(i === packets.length - 1);
    }
    if (batch.length) flush(true);
    else if (parts.length > 2) { /* آخر صفحة أُغلقت بلا علم النهاية: لا يضر */ }
    let total = 0; for (const x of parts) total += x.length;
    const res = new Uint8Array(total); let o = 0; for (const x of parts) { res.set(x, o); o += x.length; }
    return res;
  }
  // </ogg-muxer>

  // ضغط في المتصفح عبر WebCodecs (أسرع من زمن الأغنية بأضعاف): mono + Opus منخفض البت. يعيد null إن لم يُدعم أو لم ينقص الحجم.
  async function compressAudioFile(file, onProgress) {
    try {
      if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null;
      const probe = document.createElement('audio');
      if (!probe.canPlayType('audio/ogg; codecs="opus"')) return null;   // هذا الجهاز لن يستطيع تشغيل الناتج
      const cfg = { codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: MUSIC_OPUS_KBPS * 1000 };
      const sup = await AudioEncoder.isConfigSupported(cfg);
      if (!sup || !sup.supported) return null;

      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC({ sampleRate: 48000 });
      let buf;
      try { buf = await ac.decodeAudioData(await file.arrayBuffer()); } finally { try { ac.close(); } catch (e) {} }
      const len = buf.length, chs = buf.numberOfChannels;
      const mono = new Float32Array(len);
      for (let ch = 0; ch < chs; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) mono[i] += d[i] / chs; }
      buf = null;

      const packets = []; let preSkip = 312, encErr = null;
      const enc = new AudioEncoder({
        output: (chunk, meta) => {
          const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
          const desc = meta && meta.decoderConfig && meta.decoderConfig.description;
          if (desc && !packets.length) { try { const dv = new DataView(desc.buffer ? desc.buffer.slice(desc.byteOffset || 0, (desc.byteOffset || 0) + desc.byteLength) : desc); if (dv.byteLength >= 12) preSkip = dv.getUint16(10, true); } catch (e) {} }
          packets.push({ data, samples: chunk.duration ? Math.round(chunk.duration * 48 / 1000) : 960 });
        },
        error: (e) => { encErr = e; }
      });
      enc.configure(cfg);
      const STEP = 48000;   // ثانية واحدة لكل دفعة
      for (let off = 0; off < len && !encErr; off += STEP) {
        const n = Math.min(STEP, len - off);
        const ad = new AudioData({ format: 'f32', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 1, timestamp: Math.round(off / 48000 * 1e6), data: mono.subarray(off, off + n) });
        enc.encode(ad); ad.close();
        if (enc.encodeQueueSize > 20) await new Promise(r => setTimeout(r, 0));
        if (onProgress && (off / STEP) % 20 === 0) onProgress(Math.min(99, Math.round(off / len * 100)));
      }
      await enc.flush(); try { enc.close(); } catch (e) {}
      if (encErr || !packets.length) return null;
      const bytes = muxOggOpus(packets, 1, preSkip);
      if (bytes.length >= file.size * 0.9) return null;                 // لا فائدة من الضغط
      return new Blob([bytes], { type: 'audio/ogg' });
    } catch (e) { console.warn('audio compress skipped:', e); return null; }
  }

  // رفع مع نسبة التقدم (XHR)
  function xhrUpload(url, fd, onPct) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', url);
      x.setRequestHeader('x-user-id', me().id);
      x.upload.onprogress = (e) => { if (e.lengthComputable && onPct) onPct(Math.round(e.loaded / e.total * 100)); };
      x.onerror = () => reject(new Error('تعذر الاتصال بالخادم — تأكد من اتصالك'));
      x.onload = () => {
        let d = {}; try { d = JSON.parse(x.responseText); } catch (e) {}
        if (x.status >= 200 && x.status < 300) resolve(d); else reject(new Error(d.error || 'تعذر رفع الملف'));
      };
      x.send(fd);
    });
  }

  function pickDeviceAudio() {
    if (musicUploading) return toast('جارٍ رفع ملف… انتظر قليلاً');
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'audio/*';          // يعرض الهاتف الملفات الصوتية فقط
    inp.multiple = true;
    inp.style.display = 'none';
    inp.addEventListener('change', () => {
      const files = Array.from(inp.files || []);
      inp.remove();
      if (files.length) uploadDeviceAudio(files);
    });
    document.body.appendChild(inp);
    inp.click();
  }
  async function uploadDeviceAudio(files) {
    if (musicUploading) return;
    musicUploading = true;
    let ok = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const tag = files.length > 1 ? '(' + (i + 1) + '/' + files.length + ') ' : '';
        const isAudio = /^audio\//i.test(f.type) || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba|amr|3gp|wma|aif|aiff)$/i.test(f.name || '');
        if (!isAudio) { toast('«' + f.name + '» ليس ملفاً صوتياً'); continue; }
        if (f.size > MUSIC_UPLOAD_MAX_MB * 1024 * 1024) { toast('«' + f.name + '» أكبر من ' + MUSIC_UPLOAD_MAX_MB + 'MB'); continue; }
        const title = String(f.name || 'موسيقى').replace(/\.[^.]+$/, '');
        let lastPct = -10;
        toast('جارٍ ضغط ' + tag + title + ' …');
        const small = await compressAudioFile(f, (p) => { if (p - lastPct >= 25) { lastPct = p; toast('جارٍ ضغط ' + tag + title + ' ' + p + '%'); } });
        const fd = new FormData();
        fd.append('title', title);
        if (small) { fd.append('compressed', '1'); fd.append('audio', small, title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) + '.ogg'); }
        else fd.append('audio', f, f.name || 'audio.mp3');
        lastPct = -10;
        toast('جارٍ رفع ' + tag + title + (small ? ' (' + Math.max(1, Math.round(small.size / 1024)) + ' KB)' : '') + ' …');
        try {
          const data = await xhrUpload('/api/music-library/upload', fd, (p) => { if (p - lastPct >= 25) { lastPct = p; toast('جارٍ رفع ' + tag + title + ' ' + p + '%'); } });
          if (data.track) { musicLibrary.unshift(normalizeMusicTrack(data.track)); ok++; }
          musicLibraryOwnerId = me()?.id || musicLibraryOwnerId;
          if (ctx) paintMusicSheet();
        } catch (err) { toast(err.message); }
      }
      if (ok) toast(ok > 1 ? 'تمت إضافة ' + ok + ' أغاني 🎵' : 'تمت إضافة الأغنية إلى قائمتك 🎵');
    } finally {
      musicUploading = false;
      if (ctx) paintMusicSheet();
    }
  }

  async function deleteMusicTrack(id) {
    if (!musicLibrary.some(t => t.id === id)) return;
    // حذف فوري من الواجهة (تفاؤلي) حتى لا ينتظر المستخدم الخادم وهو مشغول بتجهيز MP3
    const i = musicLibrary.findIndex(t => t.id === id);
    const backup = i >= 0 ? musicLibrary[i] : null;
    if (i >= 0) musicLibrary.splice(i, 1);
    if (ctx) {
      if (ctx.music.current && ctx.music.current.id === id) stopRoomMusic(true);
      if (ctx.music.selectedId === id) ctx.music.selectedId = null;
      paintMusicSheet();
    }
    try { await api('DELETE', `/api/music-library/${encodeURIComponent(id)}`); }
    catch (err) {
      if (/غير موجودة/.test(err.message || '')) return; // محذوفة أصلاً على الخادم
      if (backup && !musicLibrary.some(t => t.id === id)) musicLibrary.splice(Math.min(i, musicLibrary.length), 0, backup);
      if (ctx) paintMusicSheet();
      toast(err.message);
    }
  }

  // ----- قائمة الموسيقى -----
  function extractYtIdLocal(input) {
    if (!input) return null;
    const s = String(input).trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    try {
      const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);
      const host = u.hostname.replace(/^www\.|^m\./, '');
      let id = null;
      if (host === 'youtu.be') id = u.pathname.split('/')[1];
      else if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
        if (u.pathname === '/watch') id = u.searchParams.get('v');
        else { const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/); if (m) id = m[1]; }
      }
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    } catch (e) { return null; }
  }
  async function saveYtDirect(url) {
    const id = extractYtIdLocal(url);
    if (!id) return toast('رابط يوتيوب غير صالح');
    if (musicLibrary.some(t => t.yt_id === id)) return toast('الأغنية موجودة في قائمتك');
    // جرّب جلب العنوان من البحث أولاً، وإلا استخدم الرابط كعنوان
    let title = 'موسيقى يوتيوب';
    let thumb = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
    let channel = '';
    try {
      // نحاول البحث عن العنوان عبر oEmbed إن توفر
      const o = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`).then(r=>r.json()).catch(()=>null);
      if (o && o.title) title = o.title;
      if (o && o.author_name) channel = o.author_name;
    } catch(e){}
    try {
      const data = await api('POST', '/api/music-library', { youtube_id: id, title, artist: channel, thumbnail: thumb });
      if (data.track) musicLibrary.unshift(normalizeMusicTrack(data.track));
      musicLibraryOwnerId = me()?.id || musicLibraryOwnerId;
      toast(data.track && data.track.audio_status === 'processing' ? 'تمت الإضافة — جارٍ تحميل الأغنية وحفظها 🎵' : 'تمت إضافة الأغنية إلى قائمتك 🎵');
      if (ctx) paintMusicSheet();
      scheduleMusicPoll();
    } catch (err) { toast(err.message); }
  }
  function musicHeadHTML() {
    const m = ctx.music;
    if (m.view === 'add') {
      return `<div class="rv-ms-head rv-ms-head-add">
        <button type="button" class="rv-ms-back" data-act="back" aria-label="رجوع">${mIcon('chev')}</button>
        <b class="rv-ms-title" style="display:flex;align-items:center;gap:6px;"><span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:6px;background:#FF0000;"><svg viewBox="0 0 24 24" width="12" height="12"><path fill="#fff" d="M10 8.5l5 3.5-5 3.5z"/></svg></span> يوتيوب</b>
        <span class="rv-ms-grow"></span>
      </div>
      <div class="rv-ms-searchrow rv-yt-row"><input type="text" id="rv-yt-q" placeholder="ابحث عن أغنية أو فنان" value="${esc(m.yt.q)}" autocomplete="off"><button type="button" class="rv-ms-pill rv-yt-go" data-act="yt-go">بحث</button></div>
      <div class="rv-ms-searchrow" style="margin-top:6px;"><input type="url" id="rv-yt-url" placeholder="أو الصق رابط يوتيوب مباشرة" dir="ltr" autocomplete="off"><button type="button" class="rv-ms-pill" data-act="yt-url-go" style="background:#FF0000;color:#fff;">＋</button></div>`;
    }
    return `<div class="rv-ms-head">
      <b class="rv-ms-title">قائمة الموسيقى</b>
      <span class="rv-ms-grow"></span>
      <button type="button" class="rv-ms-btn" data-act="search" aria-label="بحث">${mIcon('search')}</button>
      <button type="button" class="rv-ms-btn" data-act="sort" aria-label="ترتيب">${mIcon('sort')}</button>
      <button type="button" class="rv-ms-pill rv-ms-addpill" data-act="add">اضافة</button>
    </div>${m.searchOpen ? searchRowHTML() : ''}`;
  }
  function searchRowHTML() {
    return `<div class="rv-ms-searchrow"><input type="text" id="rv-ms-q" placeholder="بحث" value="${esc(ctx.music.query)}" autocomplete="off"></div>`;
  }

  function musicRowHTML(track, idx) {
    const m = ctx.music;
    const cur = m.selectedId === track.id && m.playing && m.current && m.current.id === track.id;
    // حالة التحميل على الخادم: جارٍ التحميل / فشل (مع سبب وزر إعادة) / جاهزة
    let statusLine = esc(track.artist || UNKNOWN), retryBtn = '';
    if (track.audio_status === 'processing') {
      statusLine = `<em class="rv-ms-proc">⏳ جارٍ التحميل على الخادم…</em>`;
    } else if (track.audio_status === 'failed') {
      statusLine = `<em class="rv-ms-failed">${esc(String(track.audio_error || 'تعذّر تحميل الأغنية').slice(0, 90))}</em>`;
      retryBtn = `<button type="button" class="rv-ms-retry" data-retry="${esc(track.id)}">إعادة</button>`;
    }
    return `<div class="rv-ms-row ${cur ? 'on' : ''}" data-track-id="${esc(track.id)}">
      ${safeThumb(track.thumbnail) ? `<img class="rv-yt-thumb" src="${esc(safeThumb(track.thumbnail))}" alt="" loading="lazy">` : `<span class="rv-ms-idx">${idx + 1}</span>`}
      <span class="rv-ms-copy"><b>${esc(track.title)}</b><small>${statusLine}</small></span>
      ${retryBtn}<span class="rv-ms-state">${cur ? `<span class="rv-eq ${m.paused ? '' : 'live'}"><i></i><i></i><i></i></span>` : mIcon('play')}</span>
      <button type="button" class="rv-ms-del" data-del="${esc(track.id)}" aria-label="حذف">${mIcon('trash')}</button>
    </div>`;
  }

  function paintMusicBody() {
    if (!ctx || !ctx.layer) return;
    const sheet = ctx.layer.querySelector('.rv-music-sheet');
    const body = sheet && sheet.querySelector('#rv-ms-body');
    const foot = sheet && sheet.querySelector('#rv-ms-foot');
    if (!body || !foot) return;
    const m = ctx.music;
    let html = '', cta = '';
    if (m.view === 'list') {
      const tracks = visibleTracks();
      if (!musicLibrary.length) {
        html = `<div class="rv-ms-empty">${NOTES_ART}<span>قائمة الموسيقى فارغة، اضف موسيقى اولا</span></div>`;
        cta = '<button type="button" class="rv-ms-cta" data-act="add">اضافة</button>';
      } else if (!tracks.length) {
        html = '<div class="rv-ms-empty"><span>لا توجد نتائج</span></div>';
      } else {
        html = tracks.map((t, i) => musicRowHTML(t, i)).join('');
      }
    } else {
      const y = m.yt;
      if (y.items.length) {
        html = y.items.map(it => {
          const saved = musicLibrary.some(t => t.yt_id === it.id);
          return `<div class="rv-ms-row rv-ms-row-add">
            ${safeThumb(it.thumbnail) ? `<img class="rv-yt-thumb" src="${esc(safeThumb(it.thumbnail))}" alt="" loading="lazy">` : ''}
            <span class="rv-ms-copy"><b>${esc(it.title)}</b><small>${esc(it.channel)}</small></span>
            <button type="button" class="rv-ms-plus ${saved ? 'done' : ''}" data-yid="${esc(it.id)}" aria-label="حفظ">${mIcon(saved ? 'check' : 'plus')}</button>
          </div>`;
        }).join('') + (y.next ? '<button type="button" class="rv-ms-pill rv-yt-more" data-act="yt-more">عرض المزيد</button>' : '');
        if (y.busy) html += '<div class="rv-yt-note">جارٍ البحث…</div>';
      } else if (y.busy) {
        html = '<div class="rv-ms-empty"><span>جارٍ البحث في يوتيوب…</span></div>';
      } else if (y.err) {
        html = `<div class="rv-ms-empty"><span style="color:#f87171;">⚠️ ${esc(y.err)}</span><br><small style="color:var(--text-secondary, #9aa);font-size:11px;">يمكنك لصق رابط يوتيوب في الحقل أعلاه مباشرة</small></div>`;
      } else {
        html = `<div class="rv-ms-empty">${NOTES_ART}<span>ابحث عن أغنية في يوتيوب ثم اضغط + لإضافتها<br><small style="font-size:11px;color:var(--text-secondary);">أو الصق رابط يوتيوب مباشرة في الحقل أدناه</small></span></div>`;
      }
    }
    body.innerHTML = html;
    foot.innerHTML = cta;
    foot.hidden = !cta;
  }

  function paintMusicSheet() {
    if (!ctx || !ctx.layer || !ctx.layer.classList.contains('on')) return;
    const sheet = ctx.layer.querySelector('.rv-music-sheet');
    const top = sheet && sheet.querySelector('#rv-ms-top');
    if (!top) return;
    top.innerHTML = musicHeadHTML();
    paintMusicBody();
  }

  function onMusicSheetClick(ev) {
    if (!ctx) return;
    const m = ctx.music, t = ev.target;
    const del = t.closest('[data-del]');
    if (del) { ev.stopPropagation(); return deleteMusicTrack(del.dataset.del); }
    const retry = t.closest('[data-retry]');
    if (retry) { ev.stopPropagation(); return retryMusicTrack(retry.dataset.retry); }
    const act = t.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'search') {
        m.searchOpen = !m.searchOpen; m.query = '';
        paintMusicSheet();
        const q = ctx.layer.querySelector('#rv-ms-q'); if (q) q.focus();
      } else if (a === 'sort') {
        m.sort = m.sort === 'name' ? 'added' : 'name';
        toast(m.sort === 'name' ? 'الترتيب حسب الاسم' : 'الترتيب حسب وقت الإضافة');
        paintMusicBody();
      } else if (a === 'add') {
        pickDeviceAudio();
      } else if (a === 'back') {
        m.view = 'list'; m.query = ''; m.searchOpen = false; paintMusicSheet();
      } else if (a === 'yt-go') {
        ytSearch(false);
      } else if (a === 'yt-more') {
        ytSearch(true);
      } else if (a === 'yt-url-go') {
        const inp = ctx.layer.querySelector('#rv-yt-url');
        if (inp && inp.value.trim()) saveYtDirect(inp.value.trim());
        else toast('الصق رابط يوتيوب أولاً');
      }
      return;
    }
    const plus = t.closest('.rv-ms-plus[data-yid]');
    if (plus) { if (!plus.classList.contains('done')) saveYtTrack(plus.dataset.yid); return; }
    const row = t.closest('.rv-ms-row[data-track-id]');
    if (row) {
      const id = row.dataset.trackId;
      if (m.playing && m.current && m.current.id === id) toggleMusicPause();
      else playRoomMusic(id);
    }
  }

  function openMusicSheet() {
    if (!ctx) return;
    const m = ctx.music;
    m.view = 'list'; m.query = ''; m.searchOpen = false;
    const l = showLayer(`
      <div class="rv-sheet rv-music-sheet" role="dialog" aria-label="قائمة الموسيقى">
        <div id="rv-ms-top"></div>
        <div class="rv-ms-body" id="rv-ms-body"></div>
        <div class="rv-ms-foot" id="rv-ms-foot" hidden></div>
      </div>`);
    l.dataset.sheet = 'music';
    const sheet = l.querySelector('.rv-music-sheet');
    sheet.addEventListener('click', onMusicSheetClick);
    sheet.addEventListener('input', (ev) => {
      if (ev.target.id === 'rv-ms-q') { ctx.music.query = ev.target.value; paintMusicBody(); }
      else if (ev.target.id === 'rv-yt-q') ctx.music.yt.q = ev.target.value;
    });
    sheet.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && ev.target.id === 'rv-yt-q') { ev.preventDefault(); ytSearch(false); }
      if (ev.key === 'Enter' && ev.target.id === 'rv-yt-url') { ev.preventDefault(); const v=ev.target.value.trim(); if(v) saveYtDirect(v); }
    });
    paintMusicSheet();
  }

  // ----- المشغّل العائم -----
  function renderMusicNowPlaying() {
    renderGlobalChip();
    if (!ctx) return;
    let card = ctx.container.querySelector('.rv-now-playing');
    if (!card) {
      card = document.createElement('div');
      card.className = 'rv-now-playing';
      ctx.container.appendChild(card);
      card.addEventListener('click', onMusicCardClick);
      card.addEventListener('input', (ev) => {
        if (!ev.target.classList.contains('rv-mp-range')) return;
        const a = MP.audio, r = ev.target;
        r.style.setProperty('--p', (r.value / 10) + '%');
        if (a && isFinite(a.duration) && a.duration > 0) a.currentTime = (r.value / 1000) * a.duration;
      });
    }
    let mini = ctx.container.querySelector('.rv-music-mini');
    if (!mini) {
      mini = document.createElement('button');
      mini.type = 'button';
      mini.className = 'rv-music-mini';
      ctx.container.appendChild(mini);
    }

    // هذا المشغل خاص بصاحب الموسيقى؛ الآخرون يرون التذبذب على المقعد فقط.
    const m = ctx.music;
    const active = m && m.playing && m.current;
    if (!active) {
      card.classList.remove('on'); card.innerHTML = '';
      mini.classList.remove('on'); mini.innerHTML = '';
      return;
    }

    const item = m.current;
    card.classList.toggle('on', !m.minimized);
    card.innerHTML = `
      <div class="rv-mp-top">
        <button type="button" class="rv-mp-ic" data-mp="power" aria-label="إيقاف">${mIcon('power')}</button>
        <button type="button" class="rv-mp-ic" data-mp="vol" aria-label="مستوى الصوت">${mIcon('vol')}</button>
        <div class="rv-mp-title"><b>${esc(item.title || 'موسيقى')}</b><small>${esc(item.artist || UNKNOWN)}</small></div>
        <button type="button" class="rv-mp-min" data-mp="min" aria-label="تصغير">${mIcon('shrink')}</button>
      </div>
      <input type="range" class="rv-mp-range" min="0" max="1000" step="1" value="0" aria-label="التقدم">
      <div class="rv-mp-times"><span class="rv-mp-dur">00:00</span><span class="rv-mp-cur">00:00</span></div>
      <div class="rv-mp-ctl">
        <button type="button" data-mp="list" aria-label="القائمة">${mIcon('list')}</button>
        <button type="button" data-mp="prev" aria-label="السابق">${mIcon('prev')}</button>
        <button type="button" class="rv-mp-play" data-mp="toggle" aria-label="${m.paused ? 'تشغيل' : 'إيقاف مؤقت'}">${mIcon(m.paused ? 'play' : 'pause')}</button>
        <button type="button" data-mp="next" aria-label="التالي">${mIcon('next')}</button>
        <button type="button" class="rv-mp-rep ${m.repeat === 'one' ? 'one' : ''}" data-mp="repeat" aria-label="تكرار">${mIcon('repeat')}${m.repeat === 'one' ? '<em>1</em>' : ''}</button>
      </div>`;
    updateMusicProgress();

    mini.classList.toggle('on', !!m.minimized);
    mini.innerHTML = `<span class="rv-mini-music-title">${esc(item.title || 'موسيقى')}</span><span class="rv-mini-music-pause">${mIcon(m.paused ? 'play' : 'pause')}</span>`;
    mini.title = 'إظهار مشغل الموسيقى';
    mini.onclick = (event) => {
      event.stopPropagation();
      ctx.music.minimized = false;
      renderMusicNowPlaying();
    };
  }

  function onMusicCardClick(ev) {
    if (!ctx) return;
    const b = ev.target.closest('[data-mp]');
    if (!b) return;
    ev.stopPropagation();
    const m = ctx.music, k = b.dataset.mp;
    if (k === 'power') stopRoomMusic(true);
    else if (k === 'vol') openMusicVolume();
    else if (k === 'min') minimizeMusicPlayer();
    else if (k === 'list') openMusicSheet();
    else if (k === 'prev') playAdjacent(-1);
    else if (k === 'next') playAdjacent(1);
    else if (k === 'toggle') toggleMusicPause();
    else if (k === 'repeat') {
      m.repeat = m.repeat === 'one' ? 'all' : 'one';
      if (m.audio) m.audio.loop = m.repeat === 'one';
      toast(m.repeat === 'one' ? 'تكرار النغمة الحالية' : 'تكرار القائمة');
      renderMusicNowPlaying();
    }
  }

  function updateMusicProgress() {
    if (!ctx || !MP.audio) return;
    const card = ctx.container.querySelector('.rv-now-playing');
    if (!card) return;
    const a = ctx.music.audio;
    const d = isFinite(a.duration) ? a.duration : 0;
    const cur = card.querySelector('.rv-mp-cur'), dur = card.querySelector('.rv-mp-dur'), r = card.querySelector('.rv-mp-range');
    if (cur) cur.textContent = fmtTime(a.currentTime);
    if (dur) dur.textContent = fmtTime(d);
    if (r && document.activeElement !== r) {
      const p = d ? Math.min(1, a.currentTime / d) : 0;
      r.value = Math.round(p * 1000);
      r.style.setProperty('--p', (p * 100) + '%');
    }
  }

  function minimizeMusicPlayer() {
    if (!ctx?.music?.current || !ctx.music.playing) return;
    ctx.music.minimized = true;
    renderMusicNowPlaying();
  }

  function toggleMusicPause() {
    const a = MP.audio;
    if (!a) return;
    if (a.paused) { MP.userPaused = false; a.play().catch(() => toast('اضغط تشغيل مرة أخرى للسماح بتشغيل الصوت')); }
    else { MP.userPaused = true; a.pause(); }
  }

  // انتقال تلقائي للأغنية التالية مع قاطع حلقة: إن تكرر الانتقال بسرعة (ملف لا يعمل) نوقف بدل الدوران
  function autoNext() {
    const m = MP, now = Date.now();
    m.autoTimes = (m.autoTimes || []).filter(t => now - t < 6000);
    m.autoTimes.push(now);
    if (m.autoTimes.length >= 3) { m.autoTimes = []; toast('توقف التشغيل: ملف الصوت غير صالح أو ناقص، جرّب أغنية أخرى'); stopRoomMusic(true); return; }
    playAdjacent(1);
  }

  function playAdjacent(dir) {
    const list = orderedTracks();
    if (!list.length) return;
    const cur = list.findIndex(t => t.id === MP.selectedId);
    let next = cur < 0 ? 0 : cur + dir;
    if (next >= list.length) next = 0;
    if (next < 0) next = list.length - 1;
    playRoomMusic(list[next].id);
  }

  // ----- Media Session: عناصر التحكم في إشعار النظام/شاشة القفل (اختياري، لا يجب أن يكسر التشغيل) -----
  function setupMediaSession(track) {
    try {
      if (!('mediaSession' in navigator)) return;
      const ms = navigator.mediaSession;
      const art = safeThumb(track && track.thumbnail);
      if (typeof MediaMetadata === 'function') {
        ms.metadata = new MediaMetadata({
          title: (track && track.title) || 'موسيقى',
          artist: (track && track.artist) || '',
          album: 'SoulChill',
          artwork: art ? [{ src: art, sizes: '480x360', type: 'image/jpeg' }] : []
        });
      }
      const set = (action, fn) => { try { ms.setActionHandler(action, fn); } catch (e) {} };
      set('play', () => { const a = MP.audio; if (a && a.paused) toggleMusicPause(); });
      set('pause', () => { const a = MP.audio; if (a && !a.paused) toggleMusicPause(); });
      set('previoustrack', () => playAdjacent(-1));
      set('nexttrack', () => playAdjacent(1));
      set('stop', () => stopRoomMusic(true));
    } catch (e) { /* ignore */ }
  }

  // ----- شريط الصوت (Volume) -----
  function closeMusicVolume() {
    clearTimeout(MP.volTimer);
    if (!ctx) return;
    const old = ctx.container.querySelector('.rv-vol-layer');
    if (old) old.remove();
  }
  function setMusicVolume(v) {
    const m = MP;
    m.volume = v;
    // يؤثر على استماعي أنا فقط؛ لا يغيّر ما يسمعه الموجودون في الغرفة.
    if (m.gain && m.audioContext) { try { m.gain.gain.setTargetAtTime(v, m.audioContext.currentTime, 0.015); } catch (e) { m.gain.gain.value = v; } }
    else if (m.gain) m.gain.gain.value = v;
    else if (m.audio) m.audio.volume = v;
  }
  function openMusicVolume() {
    if (!ctx) return;
    closeMusicVolume();
    const m = ctx.music;
    const el = document.createElement('div');
    el.className = 'rv-vol-layer';
    el.innerHTML = `<div class="rv-vol-panel">
      <div class="rv-vol-title">Volume</div>
      <div class="rv-vol-row">
        <span class="rv-vol-ic">${mIcon('volPlus')}</span>
        <input type="range" class="rv-vol-range" min="0" max="100" step="1" value="${Math.round((m.volume == null ? 1 : m.volume) * 100)}" aria-label="Volume">
        <span class="rv-vol-ic">${mIcon('volMinus')}</span>
      </div>
    </div>`;
    ctx.container.appendChild(el);
    const range = el.querySelector('.rv-vol-range');
    const arm = () => { clearTimeout(m.volTimer); m.volTimer = setTimeout(closeMusicVolume, 3200); };
    const paint = () => range.style.setProperty('--v', range.value + '%');
    paint(); arm();
    range.addEventListener('input', () => { paint(); setMusicVolume(range.value / 100); arm(); });
    el.addEventListener('click', (e) => { if (e.target === el) closeMusicVolume(); });
  }

  // تذبذبات الأغنية: تظهر حول صورة صاحب المقعد عند الجميع (المشغِّل والمستمعين)
  const ringSeat = new Map();
  function ringSeatResolver(uid) {
    const id = String(uid);
    const seat = ((st().activeRoom && st().activeRoom.seats) || []).find(x => x.user_id && String(x.user_id) === id);
    let idx = seat ? seat.seat_index : ringSeat.get(id);
    if ((idx === null || idx === undefined) && me() && String(me().id) === id) idx = st().userSeatIndex;
    if (idx === null || idx === undefined) return null;
    return idx === 0 ? document.querySelector('#host-seat-0 .host-avatar-box') : document.querySelector(`#stage-seat-${idx} .seat-avatar-container`);
  }
  function setMusicRings(uid, on, seatIndex) {
    if (!uid || !window.voiceRings) return;
    const id = String(uid);
    if (on && seatIndex !== undefined && seatIndex !== null) ringSeat.set(id, seatIndex);
    if (!on) ringSeat.delete(id);
    window.voiceRings.setResolver(ringSeatResolver);
    if (typeof window.voiceRings.setMusicStatus === 'function') window.voiceRings.setMusicStatus(id, on);
  }

  function renderMusicSeatIndicator() {
    if (!ctx || !ctx.music) return;
    ctx.modal.querySelectorAll('.rv-seat-music, .rv-music-speaking, .rv-music-avatar-speaking').forEach(node => {
      node.classList?.remove('rv-music-speaking', 'rv-music-avatar-speaking');
      if (node.matches?.('.rv-seat-music')) node.remove();
    });
    // كل مشغّل موسيقى مستقل: موسيقاي (إن كانت تعمل) + موسيقى كل شخص آخر على مقعده
    const seats = [];
    const m = ctx.music;
    if (m.playing && !m.paused && m.current) seats.push(m.seatIndex);
    ctx.remoteMusic.forEach(r => seats.push(r.seatIndex));
    seats.forEach(seatIndex => {
      if (seatIndex === undefined || seatIndex === null) return;
      const seatRoot = seatIndex === 0
        ? ctx.modal.querySelector('#host-seat-0')
        : ctx.modal.querySelector(`#stage-seat-${seatIndex}`);
      const seat = seatIndex === 0
        ? seatRoot?.querySelector('.host-avatar-box')
        : seatRoot?.querySelector('.seat-avatar-container');
      if (!seatRoot || !seat) return;
      // الموسيقى تستخدم نفس حلقات التذبذب الخاصة بالكلام، من دون شارة إضافية فوق الصورة.
      seatRoot.classList.add('rv-music-speaking');
      seat.classList.add('rv-music-avatar-speaking');
    });
  }

  // نقل الموسيقى مع صاحبها عند تغيير مقعده: تحديث المقعد، إعادة دمجها مع المايك، وإعلام الغرفة.
  function migrateMusicSeat() {
    if (!MP.playing || MP.ownerId !== me().id) return;
    const m = MP, uid = me().id;
    setMusicRings(uid, false);
    m.seatIndex = st().userSeatIndex;
    setMusicRings(uid, true, m.seatIndex);
    attachMusicToVoice();
    if (m.current) publishRoomMusic('room_music_started', m.current);
    renderMusicSeatIndicator();
  }

  function publishRoomMusic(eventName, item) {
    if (!MP.roomId || !st().socket || !onSeat()) return;
    st().socket.emit(eventName, {
      roomId: MP.roomId, userId: me().id, seatIndex: st().userSeatIndex,
      title: item?.title || 'موسيقى', trackId: item?.id || '', cover: item?.cover || ''
    });
  }

  // دمج الأغنية في مايك المقعد (LiveKit): من هنا يسمعها كل من في الغرفة
  async function attachMusicToVoice(attempt = 0) {
    const m = MP, a = m.audio;
    if (!m.playing || !m.destination || !window.soulRtc || !onSeat()) return false;
    const rtc = window.soulRtc;
    try {
      // قد يضغط المستخدم تشغيل فور الصعود وقبل اكتمال إذن المايك/اتصال
      // LiveKit. ننتظر النشر الحقيقي قبل السماح للأغنية بالخروج محلياً فقط.
      if (!rtc.isBroadcastingVoice && st().activeRoom) await rtc.startBroadcastingVoice(st().activeRoom.id);
      if (m.audio !== a || !m.playing || !onSeat()) return false;
      const attached = typeof rtc.setVoiceMusicStream === 'function' && rtc.setVoiceMusicStream(m.destination.stream);
      if (attached) {
        const published = typeof rtc.waitForVoiceAudioPublished === 'function'
          ? await rtc.waitForVoiceAudioPublished(rtc.localAudioStream)
          : !!(rtc.lkRoom && rtc.isBroadcastingVoice);
        if (published) return true;
      }
    } catch (e) { console.warn('music voice attach failed:', e); }
    // طلب الميكروفون/النشر غير متزامن؛ نعيد المحاولة لفترة قصيرة فقط، ثم
    // نوقف المشغّل بدلاً من ترك أغنية لا يسمعها إلا صاحبها.
    if (attempt < 40) {
      await new Promise(resolve => setTimeout(resolve, 250));
      if (m.audio !== a || !m.playing) return false;
      return attachMusicToVoice(attempt + 1);
    }
    return false;
  }

  // عند العودة للتطبيق (بعد قفل الشاشة/تبديل التطبيق) نوقظ الصوت ودمج المايك فوراً
  document.addEventListener('visibilitychange', () => {
    try {
      const m = MP;
      if (document.hidden || !m.playing) return;
      if (m.audioContext && m.audioContext.state !== 'running') m.audioContext.resume().catch(() => {});
      if (m.audio && m.audio.paused && !m.userPaused && !m.audio.ended) m.audio.play().catch(() => {});
      if (window.soulRtc && window.soulRtc.ensureMixerAlive) window.soulRtc.ensureMixerAlive();
    } catch (e) {}
  });

  // ===== تشغيل أغاني يوتيوب ومزامنتها مع الغرفة =====
  // المتصفح لا يسمح بالتقاط صوت مشغّل يوتيوب ودمجه في المايك، لذلك صاحب المقعد يشغّل الأغنية
  // ويبثّ حالتها (تشغيل/إيقاف/الوقت)، وكل مستمع في الغرفة يشغّل نفس المقطع عنده ويتزامن معه.
  let ytApiPromise = null;
  function loadYtApi() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (ytApiPromise) return ytApiPromise;
    ytApiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { try { if (prev) prev(); } catch (e) {} resolve(window.YT); };
      const sc = document.createElement('script');
      sc.src = 'https://www.youtube.com/iframe_api'; sc.async = true;
      sc.onerror = () => { ytApiPromise = null; reject(new Error('تعذر تحميل مشغّل يوتيوب، تحقق من الاتصال')); };
      document.head.appendChild(sc);
    });
    return ytApiPromise;
  }

  function ytMakeBox(kind, title) {
    const box = document.createElement('div');
    // مخفي تماماً مثل مقاطع الصوت — لا يظهر قالب يوتيوب، يسمع فقط عبر ميكرفون المقعد
    box.className = 'rv-yt-box rv-yt-' + kind + ' rv-yt-hidden';
    box.setAttribute('aria-hidden', 'true');
    box.innerHTML = '<div class="rv-yt-frame"></div><div class="rv-yt-cap"><span class="rv-yt-ttl"></span>' +
      (kind === 'remote' ? '<button type="button" class="rv-yt-mute" aria-label="كتم عندي">🔊</button>' : '') +
      '</div><button type="button" class="rv-yt-tap" hidden>اضغط للتشغيل ▶</button>';
    box.querySelector('.rv-yt-ttl').textContent = title || '';
    // يُلحق بالـ body (وليس بنافذة الغرفة) كي لا يتوقف المشغّل عند تصغير الغرفة أو الانتقال لصفحة أخرى
    document.body.appendChild(box);
    return box;
  }

  async function ytCreatePlayer(box, videoId, start, autoplay, handlers) {
    const YT = await loadYtApi();
    const holder = document.createElement('div');
    box.querySelector('.rv-yt-frame').appendChild(holder);
    return new Promise((resolve) => {
      const player = new YT.Player(holder, {
        width: 200, height: 200, videoId,
        playerVars: { autoplay: autoplay ? 1 : 0, controls: 0, disablekb: 1, playsinline: 1, rel: 0, modestbranding: 1, fs: 0, start: Math.max(0, Math.floor(start || 0)), origin: location.origin },
        events: { onReady: () => resolve(player), onStateChange: handlers.onStateChange || (() => {}), onError: handlers.onError || (() => {}) }
      });
    });
  }

  // واجهة تشبه عنصر <audio> كي تعمل أزرار المشغّل الحالية (إيقاف مؤقت/تقدّم/صوت/تكرار) دون تغيير
  function makeYtAdapter(player, music) {
    const S = () => (window.YT && window.YT.PlayerState) || { PLAYING: 1, BUFFERING: 3 };
    return {
      loop: false, ended: false,
      get paused() { try { const s = player.getPlayerState(); return !(s === S().PLAYING || s === S().BUFFERING); } catch (e) { return true; } },
      get currentTime() { try { return player.getCurrentTime() || 0; } catch (e) { return 0; } },
      set currentTime(v) { try { player.seekTo(v, true); } catch (e) {} },
      get duration() { try { return player.getDuration() || 0; } catch (e) { return 0; } },
      get volume() { return music.volume == null ? 1 : music.volume; },
      set volume(v) { try { player.setVolume(Math.round(Math.max(0, Math.min(1, v)) * 100)); } catch (e) {} },
      play() { try { player.playVideo(); } catch (e) {} return Promise.resolve(); },
      pause() { try { player.pauseVideo(); } catch (e) {} },
      removeAttribute() {}, load() {}
    };
  }

  function ytPublish(state, track) {
    if (!ctx || !st().socket || !onSeat()) return;
    let t = 0;
    try { if (ctx.music.ytPlayer) t = ctx.music.ytPlayer.getCurrentTime() || 0; } catch (e) {}
    st().socket.emit('room_yt_state', { roomId: roomId(), fallback: true, state, videoId: track ? track.yt_id : '', title: track ? track.title : '', time: t });
  }

  function ytTeardownHost(music) {
    clearInterval(music.ytHb); clearInterval(music.ytTick);
    music.ytHb = null; music.ytTick = null; music.ytToken = null;
    if (music.ytPlayer) { try { music.ytPlayer.destroy(); } catch (e) {} }
    if (music.ytBox) { try { music.ytBox.remove(); } catch (e) {} }
    music.ytPlayer = null; music.ytBox = null;
  }

  // — يوتيوب كمقطع صوتي مخفي: الصوت يمر عبر بروكسي الخادم (نفس النطاق) فيُلتقط بـ WebAudio
  // ويُدمج في ميكرفون المقعد، فيسمعه كل من في الغرفة عبر LiveKit دون ظهور يوتيوب لأحد.
  // لا نستخدم iframe كحل بديل، لأنه لا يمكن التقاط صوته ونشره جماعياً.
  const ytStreamUrl = (track, fresh) =>
    '/api/youtube/stream/' + encodeURIComponent(track.yt_id) + '?' + (fresh ? 'fresh=1&' : '') + 'uid=' + encodeURIComponent((st().currentUser && st().currentUser.id) || '');

  // تشغيل أغنية: يوتيوب ← يُبثّ صوتها من الخادم عند التشغيل فقط (بلا حفظ في قائمتك)، وغيرها من ملفات المكتبة القديمة ← من رابطها.
  // في الحالتين يمر الصوت عبر WebAudio إلى مايك المقعد فيسمعه كل من في الغرفة.
  async function startPlayback(track) {
    const m = MP;
    const isYt = track.source === 'youtube' && !!track.yt_id;
    const token = {};
    m.ytToken = token; m.current = track; m.selectedId = track.id; m.minimized = false;
    m.paused = false; m.playing = true; m.ownerId = me().id; m.seatIndex = st().userSeatIndex; m.userPaused = false;
    m.roomId = String(st().activeRoom ? st().activeRoom.id : (ctx ? ctx.room.id : ''));
    m.ytRetried = false; m.ytServerRetried = false; m.startedAt = Date.now();
    const audio = new Audio();
    if (!isYt) audio.crossOrigin = 'anonymous';
    audio.src = isYt ? ytStreamUrl(track, false) : track.url;
    audio.preload = 'auto';
    audio.loop = m.repeat === 'one';
    m.audio = audio; m.ytPlayer = null; m.ytBox = null;
    const live = () => MP.audio === audio && MP.ytToken === token;
    renderMusicNowPlaying(); paintMusicSheet();

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      try {
        const audioContext = new AudioCtx();
        const source = audioContext.createMediaElementSource(audio);
        const destination = audioContext.createMediaStreamDestination();
        // عقدة الصوت تتحكم بمستوى الموسيقى عندي أنا فقط
        const gain = audioContext.createGain();
        gain.gain.value = m.volume == null ? 1 : m.volume;
        source.connect(gain);
        gain.connect(audioContext.destination);
        // البث للغرفة يخرج من المصدر مباشرة بمستوى ثابت، فلا يتأثر بخفض صوتي المحلي.
        const sendGain = audioContext.createGain();
        sendGain.gain.value = 1;
        source.connect(sendGain);
        sendGain.connect(destination);
        m.audioContext = audioContext; m.mediaSource = source; m.destination = destination; m.gain = gain;
        try {
          const an = audioContext.createAnalyser();
          an.fftSize = 512; an.smoothingTimeConstant = 0.5;
          source.connect(an);
          m.analyser = an;
          if (window.voiceRings && me()) {
            window.voiceRings.watchAnalyser(String(me().id), an, 'music', () => !!(MP.audio === audio && !audio.paused));
          }
        } catch (e) { /* التذبذب اختياري */ }
        // إن علّق المتصفح السياق (تصغير/قفل) نوقظه فوراً دون انتظار الحارس
        audioContext.onstatechange = () => { if (live() && audioContext.state === 'suspended') audioContext.resume().catch(() => {}); };
        audioContext.resume().catch(() => {});
      } catch (err) { console.warn('music audio graph unavailable:', err); }
    }
    if (!m.gain) audio.volume = m.volume == null ? 1 : m.volume;

    audio.onplay = () => {
      if (!live()) return;
      MP.playing = true; MP.paused = false; MP.userPaused = false;
      attachMusicToVoice().then(ok => {
        if (!ok && live()) {
          toast('تعذر ربط الأغنية بصوت الغرفة؛ لم يتم تشغيلها محلياً فقط');
          stopRoomMusic(false, true);
        }
      });
      setMusicRings(me().id, true, MP.seatIndex);
      publishRoomMusic('room_music_started', track);
      renderMusicNowPlaying(); renderMusicSeatIndicator(); paintMusicSheet();
      setupMediaSession(track);
    };
    audio.onpause = () => {
      if (!live() || audio.ended) return;
      // إيقاف تلقائي من المتصفح (مغادرة الصفحة/تبويب خلفي/مقاطعة) ← نستأنف فوراً، لا يتوقف إلا بضغطك أنت
      if (!MP.userPaused) { audio.play().catch(() => {}); return; }
      MP.paused = true;
      setMusicRings(me().id, false);
      publishRoomMusic('room_music_stopped', track);
      renderMusicNowPlaying(); renderMusicSeatIndicator(); paintMusicSheet();
    };
    audio.onended = () => {
      if (!live()) return;
      // انتهاء مبكر جداً = ملف ناقص/تالف: نعيد الجلب من يوتيوب مرة واحدة ثم نتوقف (بدون حلقة)
      const early = isYt && Date.now() - (MP.startedAt || 0) < 3000 && !audio.loop;
      if (early) {
        if (!MP.ytRetried) {
          MP.ytRetried = true;
          audio.src = ytStreamUrl(track, true);
          MP.startedAt = Date.now();
          audio.load(); audio.play().catch(() => {});
          return;
        }
        toast('ملف الصوت ناقص أو تالف، جرّب أغنية أخرى');
        stopRoomMusic(true);
        return;
      }
      autoNext();
    };
    audio.ontimeupdate = updateMusicProgress;
    audio.onloadedmetadata = updateMusicProgress;
    audio.ondurationchange = updateMusicProgress;
    audio.onerror = async () => {
      if (!live()) return;
      if (!isYt) { toast('تعذر تشغيل هذه النغمة، تحقق من الملف أو الرابط'); stopRoomMusic(true); return; }
      let why = '';
      try { const r = await fetch(audio.src); if (!r.ok) { const j = await r.json().catch(() => null); why = (j && j.error) || ('HTTP ' + r.status); } } catch (e) { why = e.message; }
      console.error('YT stream failed:', why);
      // رابط منتهٍ/خطأ عابر: نصلحه في المكان نفسه فيبقى بثّ المايك حيّاً
      if (!MP.ytServerRetried) {
        MP.ytServerRetried = true;
        audio.src = ytStreamUrl(track, true);
        MP.startedAt = Date.now();
        try { audio.load(); await audio.play(); return; } catch (e) { why = e.message || why; }
      }
      if (live()) { toast('تعذر تشغيل المقطع: ' + (why || 'خطأ غير معروف')); stopRoomMusic(true); }
    };
    m.ytTick = setInterval(updateMusicProgress, 500);
    const outboundReady = await attachMusicToVoice();
    if (!live()) return;
    if (!outboundReady) {
      toast('تعذر تجهيز بث الأغنية إلى الغرفة؛ لم يتم تشغيلها محلياً فقط');
      stopRoomMusic(false, true);
      return;
    }
    try { await audio.play(); } catch (e) { toast('اضغط تشغيل مرة أخرى للسماح بتشغيل الصوت'); }
    renderMusicNowPlaying();
  }

  // — احتياطي: إذا فشل جلب الصوت عبر الخادم (حجب يوتيوب للخوادم مثلاً) لا نُغلق المشغّل،
  // بل نشغّل مشغّل يوتيوب المخفي عند صاحب المقعد ونبثّ حالته ليسمعه الجميع.
  // لا يوجد fallback محلي ليوتيوب: أي تشغيل يجب أن يمر عبر مسار الخادم
  // حتى يظل الصوت قابلاً للدمج والنشر إلى جميع أعضاء الغرفة.
  function ytRemoteStop(uid) {
    if (!ctx) return;
    const all = ctx.music.ytRemotes || {};
    const ids = uid === undefined || uid === null ? Object.keys(all) : [String(uid)];
    ids.forEach(id => {
      const r = all[id];
      if (!r) return;
      clearInterval(r.watch);
      try { r.audio?.pause(); r.audio?.removeAttribute('src'); r.audio?.load(); } catch (e) {}
      try { r.player?.destroy(); } catch (e) {}
      try { r.box?.remove(); } catch (e) {}
      delete all[id];
    });
  }
  // الأحداث القديمة الخاصة بتشغيل iframe لا تُشغّل شيئاً: تشغيل محلي فقط
  // يناقض ضمان وصول الأغنية عبر LiveKit.
  function ytRemoteApply() {}

  function playRoomMusic(trackId) {
    const track = findTrack(trackId);
    if (!track) return;
    MP.selectedId = track.id;
    if (!onSeat()) {
      paintMusicSheet();
      return toast('يجب الجلوس على مقعد المايك أولاً لتشغيل الموسيقى 🎙️');
    }
    // كتم المستخدم لنفسه يخص الميكروفون فقط؛ الموسيقى يجب أن تستمر
    // بالوصول إلى الغرفة.  نمنع التشغيل فقط عندما يكون الكتم مفروضاً من
    // الإدارة (admin_muted).
    const currentSeat = (st().activeRoom?.seats || []).find(s => s.seat_index === st().userSeatIndex);
    if (currentSeat && currentSeat.admin_muted) {
      paintMusicSheet();
      return toast('هذا المقعد مكتوم من الإدارة، لا يمكن تشغيل الموسيقى حتى يفك الأدمن الكتم 🔇');
    }
    stopRoomMusic(false, true);
    startPlayback(track);
  }

  function stopRoomMusic(notify = true, silent = false) {
    const music = MP;
    const wasPlaying = music.playing;
    const cur = music.current;
    clearInterval(music.ytTick); music.ytTick = null;
    clearTimeout(music.seatMoveTimer);
    if (music.ytPlayer || music.ytBox) { ytTeardownHost(music); music.audio = null; }
    if (music.ownerId) setMusicRings(music.ownerId, false);
    if (music.audio) {
      const a = music.audio; music.audio = null; music.userPaused = true;
      a.onplay = a.onpause = a.onended = a.onerror = a.ontimeupdate = a.onloadedmetadata = a.ondurationchange = null;
      try { a.pause(); a.removeAttribute('src'); a.load(); } catch (e) {}
    }
    if (music.audioContext) { try { music.audioContext.onstatechange = null; music.audioContext.close(); } catch (e) {} }
    if (window.voiceRings) window.voiceRings.unwatchKind('music');
    music.analyser = null;
    if (window.soulRtc && typeof window.soulRtc.clearVoiceMusicStream === 'function') window.soulRtc.clearVoiceMusicStream();
    if (notify && wasPlaying && !silent) publishRoomMusic('room_music_stopped', cur);
    closeMusicVolume();
    try { if ('mediaSession' in navigator) navigator.mediaSession.metadata = null; } catch (e) {}
    music.audio = null; music.audioContext = null; music.mediaSource = null; music.destination = null; music.gain = null; music.ytToken = null; music.ytServerRetried = false;
    music.current = null; music.playing = false; music.paused = false; music.minimized = false; music.ownerId = null; music.seatIndex = null; music.roomId = null;
    renderMusicNowPlaying(); renderMusicSeatIndicator();
    if (ctx && ctx.layer?.classList.contains('on')) paintMusicSheet();
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
  function closeLayer() { if (ctx && ctx.layer) { ctx.layer.classList.remove('on'); ctx.layer.innerHTML = ''; delete ctx.layer.dataset.sheet; } }
  function showLayer(html) { const l = ctx.layer; l.innerHTML = html; l.classList.add('on'); return l; }
  function toast(msg) {
    if (!ctx) return toastGlobal(msg);
    const old = ctx.container.querySelector('.rv-toast'); if (old) old.remove();
    const t = document.createElement('div'); t.className = 'rv-toast'; t.textContent = msg; ctx.container.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }
  const wire = (root, sel, fn) => root.querySelectorAll(sel).forEach(n => n.addEventListener('click', (e) => fn(n, e)));


  // ====== بطاقة الغرفة (عند الضغط على رأس الغرفة من الداخل) ======
  // الجميع يرون البطاقة؛ زر «حذف الغرفة» يظهر لصاحب الغرفة فقط.
  const ROOM_CAT_LABEL = { music: 'موسيقى', chat: 'سوالف', chill: 'هدوء', dating: 'توافق', gaming: 'ألعاب' };
  function isRoomOwner(room) { const u = me(); return !!(u && room && String(room.host_id) === String(u.id)); }

  function bindRoomCardClick() {
    const header = ctx.modal.querySelector('.live-room-header');
    if (!header || header.dataset.rvCard) return;
    header.dataset.rvCard = '1';
    header.style.cursor = 'pointer';
    header.addEventListener('click', (ev) => {
      if (ev.target.closest('.live-room-actions, .room-fav-heart-btn, button')) return;
      openRoomCard();
    });
  }

  function openRoomCard() {
    if (!ctx || !App().requireAuth()) return;
    const room = ctx.room; const owner = isRoomOwner(room);
    const rid = String(room.id).replace(/\D/g, '').slice(-8) || room.id;
    const cover = room.cover_image || room.host_avatar || '/avatars/avatar-1.png';
    const fav = App().isRoomFavorited ? App().isRoomFavorited(room.id) : false;
    const members = Number(room.audience_count || 0);
    const lv = Number(room.level || 1);
    const l = showLayer(`
      <div class="rv-room-card" dir="rtl">
        <div class="rv-rc-head">
          ${ctx.admin ? `<button type="button" class="rv-rc-gear" data-act="settings" aria-label="إعدادات الغرفة">${ico('gear')}</button>` : '<span></span>'}
          <div class="rv-rc-info">
            <b>${esc(room.title)}</b>
            <small>RID:${esc(rid)}</small>
            <span class="rv-rc-tag">${esc(ROOM_CAT_LABEL[room.category] || 'عام')}</span>
          </div>
          <img class="rv-rc-cover" src="${esc(cover)}" alt="" onerror="this.src='/avatars/avatar-1.png'">
        </div>
        <div class="rv-rc-stats">
          <button type="button" class="rv-rc-box" data-act="fav"><small>محفوظاتي</small><b><span id="rv-rc-heart">${fav ? '💜' : '🤍'}</span></b></button>
          <div class="rv-rc-box"><small>مستوى الغرفة</small><b>Lv.${lv}</b></div>
        </div>
        <button type="button" class="rv-rc-row" data-act="tasks">
          <span class="rv-rc-ico"><i class="f7-icons rv-f7">gift_fill</i></span>
          <span class="rv-rc-txt"><b>المهام اليومية</b><small>احصل على مكافآت إضافية</small></span>
          <i class="f7-icons rv-f7 rv-rc-arrow">chevron_left</i>
        </button>
        <button type="button" class="rv-rc-row" data-act="members">
          <span class="rv-rc-txt"><b>الأعضاء</b><small>${members}/100</small></span>
          <i class="f7-icons rv-f7 rv-rc-arrow">chevron_left</i>
        </button>
        ${owner ? `<div class="rv-rc-owner-row">
          <button type="button" class="rv-rc-delete" data-act="delete">🗑️ حذف الغرفة</button>
          <button type="button" class="rv-rc-pass" data-act="setpass">🔑 ${room.has_password ? 'تغيير كلمة المرور' : 'وضع كلمة مرور'}</button>
          ${room.has_password ? '<button type="button" class="rv-rc-pass rv-rc-pass-off" data-act="rmpass">🔓 إزالة كلمة المرور</button>' : ''}
        </div>` : ''}
      </div>`);
    l.dataset.sheet = 'roomcard';
    wire(l, '[data-act]', async (n) => {
      const a = n.dataset.act;
      if (a === 'settings') return openControl();
      if (a === 'fav') { const b = ctx.modal.querySelector('#room-fav-toggle-btn'); if (b) b.click(); setTimeout(() => { const h = l.querySelector('#rv-rc-heart'); if (h && App().isRoomFavorited) h.textContent = App().isRoomFavorited(room.id) ? '💜' : '🤍'; }, 350); return; }
      if (a === 'tasks') { closeLayer(); return App().openTasks ? App().openTasks() : toast('قريباً'); }
      if (a === 'members') { closeLayer(); return App().openRoomPeoplePanel ? App().openRoomPeoplePanel() : null; }
      if (a === 'setpass' || a === 'rmpass') {
        if (!isRoomOwner(room)) return; // كلمة المرور لصاحب الغرفة فقط
        if (a === 'rmpass') {
          try { await api('PUT', `/api/rooms/${roomId()}/password`, { password: '' }); ctx.room.has_password = false; toast('تمت إزالة كلمة مرور الغرفة'); closeLayer(); openRoomCard(); }
          catch (e) { toast(e.message || 'تعذر إزالة كلمة المرور'); }
          return;
        }
        const code = await window.uiPrompt('اكتب كلمة مرور الغرفة (4 أرقام)', { icon: '🔑', okText: 'حفظ', placeholder: '0000', inputmode: 'numeric', maxlength: 4 });
        if (code === null || code === undefined || code === false) return;
        const clean = String(code).trim();
        if (!/^\d{4}$/.test(clean)) return toast('كلمة المرور يجب أن تكون 4 أرقام بالضبط');
        try { await api('PUT', `/api/rooms/${roomId()}/password`, { password: clean }); ctx.room.has_password = true; toast('تم وضع كلمة مرور للغرفة 🔒'); closeLayer(); openRoomCard(); }
        catch (e) { toast(e.message || 'تعذر وضع كلمة المرور'); }
        return;
      }
      if (a === 'delete') {
        if (!isRoomOwner(room)) return; // حماية إضافية: الحذف لصاحب الغرفة فقط
        closeLayer();
        const ok = await App().deleteRoomById(room.id);
        if (ok) App().leaveActiveVoiceRoom();
      }
    });
  }

  // ====== قائمة التحكم (10 أيقونات) ======
  function onSeat() { const i = st().userSeatIndex; return i !== null && i !== undefined; }
  function openControl() {
    if (!App().requireAuth()) return;
    ctx.admin = isAdminUser(ctx.room);
    const u = me(); const room = ctx.room;
    const seated = onSeat(); const muted = !!st().isMuted;
    const item = (id, label, icon) => `<button type="button" class="rv-ctl" data-id="${id}"><i>${cfIcon(icon)}</i><span>${label}</span></button>`;
    const row1 = ctx.admin ? [
      item('profile', 'صورة الغرفة', 'profile'), item('bg', 'الخلفية', 'bg'), item('chat', 'منطقة الدردشة', 'chat'),
      item('sound', 'تأثيرات صوتية وموسيقى', 'sound'), item('seats', 'مقعد', 'seats')
    ] : [item('sound', 'تأثيرات صوتية وموسيقى', 'sound')];
    const row2 = [
      item('mic', !seated ? 'الميكروفون' : (muted ? 'تشغيل المايك' : 'كتم المايك'), (seated && muted) ? 'micOff' : 'mic'),
      item('silence', ctx.audioMuted ? 'إلغاء الصمت' : 'صمت', ctx.audioMuted ? 'silenceOff' : 'silence')
    ];
    if (ctx.admin) row2.push(item('lockall', ctx.allLocked ? 'مقفل' : 'فتح', ctx.allLocked ? 'lock' : 'unlock'));
    row2.push(item('minimize', 'تصغير', 'minimize'), item('exit', 'خروج', 'exit'));
    const l = showLayer(`
      <div class="rv-top-panel rv-exit-panel">
        <button type="button" class="rv-x" aria-label="إغلاق"><i class="f7-icons rv-f7">xmark</i></button>
        <div class="rv-tp-head"><b>${esc(room.title)}</b><small>RID:${esc(String(room.id).replace(/\D/g, '').slice(-8) || room.id)}</small></div>
        ${ctx.admin ? '<div class="rv-tp-sub">إعدادات الغرفة:</div>' : ''}
        <div class="rv-grid5">${row1.join('')}</div>
        <div class="rv-grid5 rv-grid-row2">${row2.join('')}</div>
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
    if (window.soulRtc && typeof window.soulRtc.setRemoteAudioMuted === 'function') {
      window.soulRtc.setRemoteAudioMuted(ctx.audioMuted);
    }
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

  // ====== التصغير: أيقونة عائمة قابلة للتحريك (الغرفة تبقى تعمل والصوت مستمر) ======
  let miniPos = null; // آخر موضع للأيقونة العائمة
  let backArmed = false;
  let returnToParty = false; // صار الدخول عبر الأيقونة العائمة: الخروج أو التصغير التالي يذهب إلى «حفلة»

  function armBackToMinimize() {
    // زر الرجوع (أو إيماءة الرجوع) يصغّر الغرفة بدل إغلاقها
    try { if (!(history.state && history.state.rvRoom)) history.pushState({ rvRoom: 1 }, ''); } catch (e) {}
    if (backArmed) return;
    backArmed = true;
    window.addEventListener('popstate', () => {
      if (!ctx || !document.body.contains(ctx.modal) || ctx.modal.classList.contains('rv-minimized')) return;
      if (ctx.layer && ctx.layer.classList.contains('on')) { closeLayer(); try { history.pushState({ rvRoom: 1 }, ''); } catch (e) {} return; }
      minimize(true);
    });
  }

  function minimize(fromBack) {
    if (!ctx || !document.body.contains(ctx.modal) || ctx.modal.classList.contains('rv-minimized')) return;
    const modal = ctx.modal;
    try { closeLayer(); } catch (e) {}
    modal.classList.add('rv-minimized');
    document.querySelectorAll('.rv-mini').forEach(n => n.remove());
    if (returnToParty) { returnToParty = false; try { App().goToPartyTab(); } catch (e) {} }

    const SIZE = 58, MARGIN = 8;
    const b = document.createElement('div'); b.className = 'rv-mini'; b.setAttribute('role', 'button'); b.tabIndex = 0;
    b.setAttribute('aria-label', 'العودة إلى الغرفة: ' + (ctx.room.title || ''));
    b.innerHTML = `<img src="${esc(ctx.room.cover_image || ctx.room.host_avatar || '/avatars/avatar-1.png')}" alt="" draggable="false" onerror="this.src='/avatars/avatar-1.png'">
      <button type="button" class="rv-mini-x" aria-label="مغادرة الغرفة"><i class="f7-icons rv-f7">xmark</i></button>`;
    document.body.appendChild(b);

    const clamp = (x, y) => ({
      x: Math.min(Math.max(MARGIN, x), window.innerWidth - SIZE - MARGIN),
      y: Math.min(Math.max(MARGIN + 36, y), window.innerHeight - SIZE - MARGIN)
    });
    const place = (x, y) => { const p = clamp(x, y); b.style.left = p.x + 'px'; b.style.top = p.y + 'px'; return p; };
    const start = miniPos || { x: window.innerWidth - SIZE - 10, y: 110 };
    miniPos = place(start.x, start.y);
    const onResize = () => { if (b.isConnected) miniPos = place(miniPos.x, miniPos.y); else window.removeEventListener('resize', onResize); };
    window.addEventListener('resize', onResize);

    const restore = () => {
      // العودة المباشرة للغرفة: إغلاق كل الصفحات المفتوحة فوقها (ملف شخصي، متجر، رسائل…)
      try { App().closeOverlaysAboveRoom(); } catch (e) {}
      returnToParty = true; // عند الخروج/التصغير القادم نذهب مباشرة إلى تبويب «حفلة»
      modal.classList.remove('rv-minimized'); b.remove();
      window.removeEventListener('resize', onResize);
      try { if (!(history.state && history.state.rvRoom)) history.pushState({ rvRoom: 1 }, ''); } catch (e) {}
    };

    // سحب / نقر
    let sx = 0, sy = 0, ox = 0, oy = 0, moved = false, pid = null;
    b.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.rv-mini-x')) return;
      pid = e.pointerId; moved = false; sx = e.clientX; sy = e.clientY;
      const r = b.getBoundingClientRect(); ox = r.left; oy = r.top;
      try { b.setPointerCapture(pid); } catch (err) {}
    });
    b.addEventListener('pointermove', (e) => {
      if (pid !== e.pointerId) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      if (!moved) { moved = true; b.classList.add('dragging'); }
      place(ox + dx, oy + dy);
    });
    const end = (e) => {
      if (pid !== e.pointerId) return;
      pid = null; b.classList.remove('dragging');
      try { b.releasePointerCapture(e.pointerId); } catch (err) {}
      if (!moved) { if (e.type === 'pointerup') restore(); return; }
      const r = b.getBoundingClientRect();
      const snapX = (r.left + SIZE / 2 < window.innerWidth / 2) ? MARGIN : window.innerWidth - SIZE - MARGIN; // التصاق بأقرب حافة
      miniPos = place(snapX, r.top);
    };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); restore(); } });
    b.querySelector('.rv-mini-x').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (await window.uiConfirm('هل تريد مغادرة الغرفة؟', { icon: '🚪', okText: 'خروج' })) { returnToParty = false; App().leaveActiveVoiceRoom(); }
    });
  }

  // الخروج المخصص: يغلق كل شيء (المايك، الصوت، الاتصال)
  async function exitRoom() {
    const toParty = returnToParty; returnToParty = false;
    App().leaveActiveVoiceRoom();
    if (toParty) { try { App().goToPartyTab(); } catch (e) {} }
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
        <div class="rv-lbl">🔒 كلمة مرور الغرفة (4 أرقام)</div>
        <div class="rv-field"><input id="rv-pass" inputmode="numeric" maxlength="4" autocomplete="off" dir="ltr" placeholder="${room.has_password ? 'الغرفة محمية — اكتب رمزاً جديداً لتغييره' : 'بدون كلمة مرور — اكتب 4 أرقام لحمايتها'}"><button type="button" id="rv-pass-clear" title="إلغاء كلمة المرور" style="${room.has_password ? '' : 'display:none'}">إلغاء</button></div>
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
    q('#rv-pass').oninput = (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); };
    q('#rv-pass-clear').onclick = async () => {
      try { await api('PUT', `/api/rooms/${roomId()}/password`, { password: '' }); ctx.room.has_password = false; q('#rv-pass').value = ''; q('#rv-pass').placeholder = 'بدون كلمة مرور — اكتب 4 أرقام لحمايتها'; q('#rv-pass-clear').style.display = 'none'; toast('تم إلغاء كلمة مرور الغرفة'); }
      catch (err) { toast(err.message); }
    };
    q('#rv-save').onclick = async () => {
      const btn = q('#rv-save'); btn.disabled = true;
      try {
        const newPass = q('#rv-pass').value.trim();
        if (newPass && !/^\d{4}$/.test(newPass)) { toast('كلمة المرور يجب أن تكون 4 أرقام بالضبط'); btn.disabled = false; return; }
        const d = await api('PUT', `/api/rooms/${roomId()}/profile`, { title: q('#rv-title').value, category: cat, announcement: ann.value, cover_image: cover });
        if (newPass) { await api('PUT', `/api/rooms/${roomId()}/password`, { password: newPass }); ctx.room.has_password = true; }
        applyRoomMeta(d.room); closeLayer(); toast('تم حفظ بيانات الغرفة');
      } catch (err) { toast(err.message); btn.disabled = false; }
    };
  }
  function applyRoomMeta(s) {
    if (!s || !ctx) return;
    Object.assign(ctx.room, { title: s.title, category: s.category, announcement: s.announcement, cover_image: s.cover_image });
    const headerImage = ctx.modal.querySelector('#live-room-host-avatar');
    if (headerImage && s.cover_image) {
      headerImage.src = s.cover_image;
      // الإطار لصورة الشخص فقط — صورة الغرفة بلا إطار
      Array.from(headerImage.classList).filter(k => k.indexOf('avatar-frame-') === 0).forEach(k => headerImage.classList.remove(k));
    }
    const t = ctx.modal.querySelector('.live-room-title-text'); if (t) { t.textContent = s.title; t.title = s.title; }
  }

  // ====== الخلفية ======
  // الخلفيات جاهزة من الإدارة فقط (لا رفع من صاحب الغرفة). السعر 0 = مجانية، وإلا يظهر سعرها تحتها ويُشترى مرة واحدة.
  function openBackground() {
    let tab = 'ready'; let sel = ctx.room.bg_image || ''; const cur = sel; let saved = false;
    let adminBgs = []; let loaded = false;
    const l = showLayer('<div class="rv-full" style="padding-top:0"></div>');
    const root = l.querySelector('.rv-full');
    const holder = document.createElement('div'); root.appendChild(holder);
    const thumb = (val, css, name, cls) => `<button type="button" class="rv-bg-item ${cls || ''} ${val === sel ? 'sel' : ''}" data-v="${esc(val)}" style="${css}"><span>${esc(name || '')}</span></button>`;
    const priceTag = (b) => (b.price > 0 && !b.owned) ? `<em class="rv-bg-price paid">💎 ${b.price}</em>` : `<em class="rv-bg-price">${b.price > 0 ? 'مملوكة' : 'مجانية'}</em>`;
    const findAdmin = (v) => adminBgs.find(b => b.image_url === v);
    const tabs = [['ready', 'خلفية جاهزة'], ['anim', 'خلفية متحركة']];
    const adminHtml = () => adminBgs.map(b => `<div class="rv-bg-cell"><button type="button" class="rv-bg-item ${b.image_url === sel ? 'sel' : ''}" data-v="${esc(b.image_url)}">${(window.SCHtml && window.SCHtml.isHtml(b.image_url)) ? window.SCHtml.thumb(b.image_url) : `<img src="${esc(b.image_url)}" alt="" loading="lazy">`}<span>${esc(b.name)}</span></button>${priceTag(b)}</div>`).join('');
    // تحديث حالة التحديد فقط (بدون إعادة بناء الشبكة → لا إعادة تحميل للصور)
    function syncSel() {
      holder.querySelectorAll('.rv-bg-item').forEach(b => b.classList.toggle('sel', b.dataset.v === sel));
      holder.querySelectorAll('.rv-bg-tabs b').forEach(b => b.classList.toggle('sel', b.dataset.t === tab));
      holder.querySelectorAll('.rv-bg-pane').forEach(p => { p.style.display = p.dataset.pane === tab ? '' : 'none'; });
      const sv = holder.querySelector('#rv-bg-save'); if (sv) sv.disabled = (sel === cur);
    }
    // تحديث قسم خلفيات الإدارة فقط
    function paintAdmin() {
      const box = holder.querySelector('.rv-bg-admin'); if (!box) return;
      const h = adminHtml();
      box.innerHTML = h ? `<div class="rv-bg-grid">${h}</div>` : (loaded ? '' : '<div class="rv-bg-sec">جارٍ التحميل…</div>');
      syncSel();
    }
    // بناء الهيكل مرة واحدة فقط
    function paint() {
      const imgs = READY_BG_IMAGES.map(b => `<div class="rv-bg-cell"><button type="button" class="rv-bg-item ${b.url === sel ? 'sel' : ''}" data-v="${esc(b.url)}"><img src="${esc(b.url)}" alt="" loading="lazy" decoding="async" onerror="this.closest('.rv-bg-cell').remove()"></button><em class="rv-bg-price">مجانية</em></div>`).join('');
      const cols = READY_BG.map(b => `<div class="rv-bg-cell">${thumb('grad:' + b.id, `background:${b.css}`, b.name)}<em class="rv-bg-price">مجانية</em></div>`).join('');
      const anim = ANIM_BG.map(b => `<div class="rv-bg-cell"><button type="button" class="rv-bg-item ${('anim:' + b.id) === sel ? 'sel' : ''}" data-v="anim:${b.id}"><div class="rv-bg rv-anim-${b.id}" style="position:absolute;inset:0"></div><span>${b.name}</span></button><em class="rv-bg-price">مجانية</em></div>`).join('');
      holder.innerHTML = `
        <div class="rv-bg-head"><button type="button" class="rv-pill" id="rv-bg-save" disabled>حفظ</button><h4>الخلفية</h4><button type="button" class="rv-x" style="position:static">✕</button></div>
        <div class="rv-bg-tabs">${tabs.map(t => `<b data-t="${t[0]}">${t[1]}</b>`).join('')}</div>
        <div class="rv-bg-pane" data-pane="ready">
          <div class="rv-bg-admin"></div>
          ${imgs ? `<div class="rv-bg-grid">${imgs}</div>` : ''}
          <div class="rv-bg-sec">الألوان</div><div class="rv-bg-grid">${cols}</div>
        </div>
        <div class="rv-bg-pane" data-pane="anim"><div class="rv-bg-grid">${anim}</div></div>`;
      holder.querySelector('.rv-x').onclick = closeLayer;
      // تفويض الأحداث: يعمل حتى لو تغيّر قسم الإدارة لاحقاً
      holder.addEventListener('click', (e) => {
        const t = e.target.closest('.rv-bg-tabs b');
        if (t && holder.contains(t)) { tab = t.dataset.t; syncSel(); return; }
        const it = e.target.closest('.rv-bg-item');
        if (it && holder.contains(it)) {
          if (sel === it.dataset.v) return;
          sel = it.dataset.v; try { applyBg(sel, true); } catch (err) {} syncSel();
        }
      });
      holder.querySelector('#rv-bg-save').onclick = async () => {
        const btn = holder.querySelector('#rv-bg-save'); btn.disabled = true;
        try {
          const ab = findAdmin(sel);
          if (ab && ab.price > 0 && !ab.owned) {
            const ok = await window.uiConfirm(`شراء خلفية «${ab.name}» مقابل ${ab.price} 💎 ؟`, { icon: '🖼️', okText: 'شراء وتطبيق' });
            if (!ok) { btn.disabled = false; return; }
            const r = await api('POST', `/api/room-backgrounds/${encodeURIComponent(ab.id)}/buy`, {});
            ab.owned = true;
            try { if (r && r.user && st().currentUser) st().currentUser.diamonds = r.user.diamonds; } catch (e) {}
            paintAdmin();
          }
          await api('PUT', `/api/rooms/${roomId()}/background`, { bg_image: sel }); saved = true; applyBg(sel); closeLayer(); toast('تم تغيير الخلفية');
        } catch (err) { toast(err.message); btn.disabled = false; }
      };
      paintAdmin();
    }
    paint();
    // إغلاق دون حفظ: رجوع للخلفية الأصلية
    try {
      const obsBg = new MutationObserver(() => { if (!holder.isConnected) { obsBg.disconnect(); if (!saved && ctx) { try { applyBg(cur); } catch (e) {} } } });
      obsBg.observe(ctx.layer, { childList: true });
    } catch (e) {}
    api('GET', '/api/room-backgrounds').then(d => { adminBgs = (d && d.backgrounds) || []; }).catch(() => {}).finally(() => { loaded = true; if (holder.isConnected) paintAdmin(); });
    const onBgLive = (ev) => {
      if (!holder.isConnected) { document.removeEventListener('soul:admin-updated', onBgLive); return; }
      if (ev.detail && ev.detail.area === 'room-backgrounds') {
        api('GET', '/api/room-backgrounds').then(d => { adminBgs = (d && d.backgrounds) || []; if (holder.isConnected) paintAdmin(); }).catch(() => {});
      }
    };
    document.addEventListener('soul:admin-updated', onBgLive);
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
        <button type="button" class="rv-back" id="rv-seat-gear" title="إعدادات المقاعد">${ico('gear')}</button>
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
        closeLayer();   // الحالة تتحدّث من حدث الخادم seat_mute_changed (قد يمنعه الخادم لعضو محميّ)
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
        <div class="rv-search">${ico('search')}<input id="rv-q" placeholder="ابحث عن اسم أو ID"></div>
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
    // الزائر الجديد يطلب حالة الموسيقى الحالية (يُعاد الطلب بعد رسم المقاعد)
    [300, 1500, 4000].forEach(ms => setTimeout(() => { if (ctx && st().socket) st().socket.emit('room_music_sync_request', { roomId: roomId() }); }, ms));
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
      if (d.isMuted) ctx.mutedSeats.add(d.seatIndex); else ctx.mutedSeats.delete(d.seatIndex);
      // كتم المستخدم لنفسه لا يوقف الموسيقى؛ الكتم الإداري فقط يوقف
      // الأغنية ويزيل حالتها من الغرفة.
      if (d.adminMuted && d.isMuted) {
        if (d.seatIndex === ctx.music.seatIndex && ctx.music.playing && ctx.music.ownerId === me().id) stopRoomMusic(true);
        ctx.remoteMusic.forEach((r, uid) => {
          if (r.seatIndex === d.seatIndex) { ctx.remoteMusic.delete(uid); setMusicRings(uid, false); ytRemoteStop(uid); }
        });
        renderMusicSeatIndicator();
      }
    });
    on('seat_invite', async (d) => {
      if (!ctx || d.roomId !== roomId()) return;
      if (await window.uiConfirm(`${d.fromName} يدعوك للصعود إلى المايك 🎙️`, { icon: '🎙️', okText: 'صعود' })) App().takeSeatAction(d.seatIndex);
    });
    on('user_joined_room', (d) => {
      if (!ctx) return;
      const u = d && d.user;
      if (ctx.room.host_id === me().id && u && u.id !== me().id && ctx.chat.auto_welcome) {
        st().socket.emit('send_room_message', { roomId: roomId(), userId: me().id, content: `أهلاً وسهلاً بـ ${u.name} في الغرفة 🌹` });
      }
      // صاحب المقعد (وليس المضيف فقط) يعيد إعلان الموسيقى للوافد الجديد ليظهر المؤشر والتذبذبات
      if (u && u.id !== me().id && ctx.music.playing && ctx.music.ownerId === me().id && ctx.music.current) {
        [800, 2500].forEach(ms => setTimeout(() => { if (ctx && ctx.music.playing && ctx.music.ownerId === me().id) publishRoomMusic('room_music_started', ctx.music.current); }, ms));
      }
    });
    on('room_music_started', (d) => {
      if (!ctx || d.roomId !== roomId() || d.userId === me().id) return;
      // موسيقى شخص آخر: تُسجَّل بشكل مستقل ولا تمس حالة موسيقاي أبداً
      ctx.remoteMusic.set(String(d.userId), { title: d.title || 'موسيقى', id: d.trackId || '', seatIndex: d.seatIndex });
      setMusicRings(d.userId, true, d.seatIndex);
      renderMusicSeatIndicator();
    });
    on('room_music_stopped', (d) => {
      if (!ctx || d.roomId !== roomId() || d.userId === me().id) return;
      // إيقاف موسيقى شخص آخر لا يؤثر على موسيقاي
      ctx.remoteMusic.delete(String(d.userId));
      setMusicRings(d.userId, false);
      ytRemoteStop(d.userId);
      renderMusicSeatIndicator();
    });
    on('room_yt_state', (d) => {
      if (!ctx || d.roomId !== roomId() || d.userId === me().id) return;
      ytRemoteApply(d);
    });
    on('seat_updated', (d) => {
      if (!ctx) return;
      if (!d.user) {
        // مقعد فرغ: أنظّف موسيقى من كان عليه (بعيداً)، ولا أمس موسيقاي إلا إن كان مقعدي
        ctx.remoteMusic.forEach((r, uid) => {
          if (r.seatIndex === d.seatIndex) { ctx.remoteMusic.delete(uid); setMusicRings(uid, false); ytRemoteStop(uid); }
        });
        if (ctx.music.playing && ctx.music.ownerId === me().id && d.seatIndex === ctx.music.seatIndex) {
          // تبديل المقعد يُفرغ المقعد القديم لحظياً؛ ننتظر قليلاً: إن بقيت جالساً ننقل الموسيقى معك بدل إيقافها.
          clearTimeout(ctx.music.seatMoveTimer);
          ctx.music.seatMoveTimer = setTimeout(() => {
            if (!ctx || ctx.music.ownerId !== me().id || !ctx.music.playing) return;
            if (onSeat()) migrateMusicSeat(); else stopRoomMusic(true);
          }, 450);
        }
      }
      renderMusicSeatIndicator();
    });
  }
})();
