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
  const cfIcon = (k) => `<svg viewBox="0 0 24 24" class="rv-cf">${CF[k]}</svg>`;

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
  // 9 صور خلفية جاهزة (ضع الملفات في public/img/bg/bg-1.jpg ... bg-9.jpg) — تظهر أولاً، والألوان أسفلها
  const READY_BG_IMAGES = Array.from({ length: 9 }, (_, i) => ({ id: 'img' + (i + 1), url: `/img/bg/bg-${i + 1}.jpg` }));
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
            mutedSeats: new Set(), allMuted: false, allLocked: false, audioMuted: false, bgPicked: loadMyBgs(),
            music: { selectedId: null, current: null, audio: null, audioContext: null, mediaSource: null, destination: null, playing: false, minimized: false, ownerId: null, remote: null, seatIndex: null,
                     view: 'list', yt: { q: '', lastQ: '', items: [], next: null, busy: false, err: '' }, ytPlayer: null, ytBox: null, ytToken: null, ytHb: null, ytTick: null, ytRemote: null, ytRemoteMuted: false, sort: 'added', query: '', searchOpen: false, repeat: 'all', volume: 1, paused: false, gain: null, volTimer: null } };
    if (musicLibraryOwnerId !== me()?.id) musicLibrary.splice(0, musicLibrary.length);
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
    buildBottomBar();
    addTips();
    layoutSeats();
    applyChatSettings();
    applySeatSettings();
    computeLockState();
    interceptSeatClicks();
    bindSockets();
    armBackToMinimize();
    restoreKeptYt();
    restoreKeptAudio();

    // مراقبة إغلاق الغرفة لتنظيف الموارد
    bodyObs = new MutationObserver(() => { if (ctx && !document.body.contains(ctx.modal)) cleanup(); });
    bodyObs.observe(document.body, { childList: true });
  }

  // ===== مشغّل يوتيوب المستقل (يعيش خارج نافذة الغرفة) =====
  let keptYt = null; // { roomId, token, player, box, hb, tick, track, volume, userPaused }
  function activeRoomIs(rid) {
    try { const a = App() && st().activeRoom; return !!(a && rid && String(a.id) === String(rid)); } catch (e) { return false; }
  }
  function stashYtPlayer() {
    const m = ctx && ctx.music;
    if (!m || !m.ytPlayer || !m.ytToken || !m.current) return false;
    if (!activeRoomIs(ctx.room.id)) return false; // خروج فعلي ← يُوقف عبر المسار العادي
    keptYt = { roomId: ctx.room.id, token: m.ytToken, player: m.ytPlayer, box: m.ytBox, hb: m.ytHb, tick: m.ytTick, track: m.current,
               volume: m.volume, userPaused: !!m.userPaused, seatIndex: m.seatIndex };
    m.ytPlayer = null; m.ytBox = null; m.ytHb = null; m.ytTick = null; m.audio = null; m.ytToken = null;
    if (ctx.layer) { try { ctx.layer.classList.remove('on'); } catch (e) {} }
    return true;
  }
  function destroyKeptYt(notify) {
    const k = keptYt; if (!k) return;
    keptYt = null;
    clearInterval(k.hb); clearInterval(k.tick);
    try { k.player.destroy(); } catch (e) {}
    try { k.box && k.box.remove(); } catch (e) {}
    try {
      const sock = App() && st().socket, u = me();
      if (notify && sock && u) {
        sock.emit('room_yt_state', { roomId: k.roomId, fallback: true, state: 'stop', videoId: '', title: '', time: 0 });
        sock.emit('room_music_stopped', { roomId: k.roomId, userId: u.id, seatIndex: k.seatIndex, title: k.track.title || 'موسيقى', trackId: k.track.id || '', cover: '' });
      }
      if (u && window.voiceRings && window.voiceRings.setMusicStatus) window.voiceRings.setMusicStatus(String(u.id), false);
    } catch (e) {}
  }
  function restoreKeptYt() {
    const k = keptYt; if (!k || !ctx) return;
    if (!activeRoomIs(ctx.room.id) || String(ctx.room.id) !== String(k.roomId) || !onSeat()) { destroyKeptYt(true); return; }
    keptYt = null;
    const m = ctx.music;
    m.ytToken = k.token; m.ytPlayer = k.player; m.ytBox = k.box; m.ytHb = k.hb; m.ytTick = k.tick;
    m.current = k.track; m.selectedId = k.track.id; m.volume = k.volume == null ? 1 : k.volume;
    m.ownerId = me().id; m.seatIndex = st().userSeatIndex; m.userPaused = k.userPaused; m.minimized = true;
    m.audio = makeYtAdapter(k.player, m);
    m.playing = true; m.paused = !!m.audio.paused;
    setMusicRings(me().id, !m.paused, m.seatIndex);
    publishRoomMusic('room_music_started', k.track);
    renderMusicNowPlaying(); renderMusicSeatIndicator();
  }
  // حارس: إن لم يعد المستخدم في الغرفة (خروج فعلي) أوقف المشغّل المستقل
  setInterval(() => { if (keptYt && !activeRoomIs(keptYt.roomId)) destroyKeptYt(true); }, 2000);

  // ===== مشغّل الصوت (mp3 المحفوظ من يوتيوب أو ملف عادي) يبقى يعمل عند التنقل بين الصفحات =====
  // عنصر Audio + AudioContext لا يعتمدان على نافذة الغرفة، فنحتفظ بهما عند إعادة رسم/إغلاق النافذة ونعيد ربطهما عند العودة.
  let keptAudio = null; // { roomId, audio, audioContext, mediaSource, destination, gain, analyser, track, volume, userPaused, seatIndex, repeat }
  const audioIsLive = (audio) => (keptAudio ? keptAudio.audio === audio : !!(ctx && ctx.music && ctx.music.audio === audio));
  function stashAudioPlayer() {
    const m = ctx && ctx.music, u = me();
    if (!m || !u || !m.audio || m.ytPlayer || m.ytToken || !m.current || !m.playing || m.ownerId !== u.id) return false;
    if (!activeRoomIs(ctx.room.id)) return false; // خروج فعلي ← يُوقف عبر المسار العادي
    keptAudio = { roomId: ctx.room.id, audio: m.audio, audioContext: m.audioContext, mediaSource: m.mediaSource, destination: m.destination,
                  gain: m.gain, analyser: m.analyser, track: m.current, volume: m.volume, userPaused: !!m.userPaused, seatIndex: m.seatIndex, repeat: m.repeat };
    m.audio = null; m.audioContext = null; m.mediaSource = null; m.destination = null; m.gain = null; m.analyser = null;
    if (ctx.layer) { try { ctx.layer.classList.remove('on'); } catch (e) {} }
    return true;
  }
  function destroyKeptAudio(notify) {
    const k = keptAudio; if (!k) return;
    keptAudio = null;
    try { k.audio.onplay = k.audio.onpause = k.audio.onended = k.audio.ontimeupdate = k.audio.onerror = null; k.audio.pause(); k.audio.removeAttribute('src'); k.audio.load(); } catch (e) {}
    try { if (k.audioContext) k.audioContext.close(); } catch (e) {}
    try {
      if (window.voiceRings) window.voiceRings.unwatchKind('music');
      if (window.soulRtc && typeof window.soulRtc.clearVoiceMusicStream === 'function') window.soulRtc.clearVoiceMusicStream();
      const sock = App() && st().socket, u = me();
      if (notify && sock && u) sock.emit('room_music_stopped', { roomId: k.roomId, userId: u.id, seatIndex: k.seatIndex, title: k.track.title || 'موسيقى', trackId: k.track.id || '', cover: '' });
      if (u && window.voiceRings && window.voiceRings.setMusicStatus) window.voiceRings.setMusicStatus(String(u.id), false);
    } catch (e) {}
  }
  function restoreKeptAudio() {
    const k = keptAudio; if (!k || !ctx) return;
    if (!activeRoomIs(ctx.room.id) || String(ctx.room.id) !== String(k.roomId) || !onSeat()) { destroyKeptAudio(true); return; }
    keptAudio = null;
    const m = ctx.music;
    m.audio = k.audio; m.audioContext = k.audioContext; m.mediaSource = k.mediaSource; m.destination = k.destination; m.gain = k.gain; m.analyser = k.analyser;
    m.current = k.track; m.selectedId = k.track.id; m.volume = k.volume == null ? 1 : k.volume; m.repeat = k.repeat || m.repeat;
    m.ownerId = me().id; m.seatIndex = st().userSeatIndex; m.userPaused = k.userPaused; m.minimized = true;
    m.playing = true; m.paused = !!k.audio.paused;
    try {
      if (window.voiceRings && m.analyser) {
        window.voiceRings.unwatchKind('music');
        const a = k.audio;
        window.voiceRings.watchAnalyser(String(me().id), m.analyser, 'music', () => !!(audioIsLive(a) && !a.paused));
      }
    } catch (e) {}
    attachMusicToVoice();
    setMusicRings(me().id, !m.paused, m.seatIndex);
    publishRoomMusic('room_music_started', k.track);
    renderMusicNowPlaying(); renderMusicSeatIndicator();
    // انتهت الأغنية أثناء غياب النافذة ← ننتقل للتالية
    if (k.audio.ended && !k.audio.loop) autoNext();
  }
  // حارس: خروج فعلي من الغرفة ← أوقف الصوت؛ وإلا إن أوقفه المتصفح أثناء التنقل فاستأنفه
  setInterval(() => {
    if (!keptAudio) return;
    if (!activeRoomIs(keptAudio.roomId)) { destroyKeptAudio(true); return; }
    const k = keptAudio;
    try { if (k.audioContext && k.audioContext.state !== 'running') k.audioContext.resume().catch(() => {}); } catch (e) {}
    try { if (k.audio.paused && !k.userPaused && !k.audio.ended) k.audio.play().catch(() => {}); } catch (e) {}
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
    // مشغّل يوتيوب مستقل: إعادة رسم نافذة الغرفة/الانتقال بين الصفحات لا توقفه، يتوقف فقط بالخروج الفعلي من الغرفة
    if (ctx && !stashYtPlayer() && !stashAudioPlayer()) stopRoomMusic(false, true);
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
    if (!actions) return;
    const mk = (html, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'rv-top-btn'; b.title = title; b.innerHTML = html; b.onclick = fn; return b; };
    actions.appendChild(mk(ico('dots', true), 'إعدادات الغرفة', openControl));
  }

  function buildBottomBar() {
    const bar = ctx.modal.querySelector('.room-bottom-controls'); if (!bar) return;
    // القائمة السفلية مخصصة لأداتين فقط: الإكسسوارات والموسيقى.
    // أزيلت منها أزرار تحدي PK ومركز الترفيه نهائياً.
    if (!bar.querySelector('.rv-menu-btn')) {
      const m = document.createElement('button'); m.type = 'button'; m.className = 'room-tool-btn rv-menu-btn'; m.title = 'مركز الترفيه';
      m.setAttribute('aria-label', 'مركز الترفيه');
      m.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round">${IC.menu}</svg>`;
      m.onclick = openRoomTools;
      bar.appendChild(m);
    }
    // تحويل أيقونة الهدية إلى رسم أبيض/وردي خفيف كما في تصميم الغرفة.
    const gift = bar.querySelector('#room-open-gifts-btn');
    if (gift) gift.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#ff4fa3" stroke-width="1.9" stroke-linejoin="round"><rect x="3" y="9" width="18" height="11" rx="2"/><path d="M3 13h18M12 9v11M12 9c-2-4-6-3-5 0 .6 1.8 3.3 1.2 5 0zM12 9c2-4 6-3 5 0-.6 1.8-3.3 1.2-5 0z"/></svg>`;
  }

  // ====== مركز الترفيه (مطابق لفيديو «الصوت والأغاني») ======
  function openRoomTools() {
    if (!ctx) return;
    const l = showLayer(`
      <div class="rv-sheet rv-ent-sheet" role="dialog" aria-label="مركز الترفيه">
        <button type="button" class="rv-ent-x" aria-label="إغلاق"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button>
        <div class="rv-ent-title">مركز الترفيه</div>
        <div class="rv-ent-sec">مركز الألعاب</div>
        <div class="rv-ent-grid">
          <button type="button" class="rv-ent-item" data-room-tool="music"><i>🎷</i><span>موسيقى</span></button>
          <button type="button" class="rv-ent-item" data-room-tool="accessories"><i>🧰</i><span>إكسسوارات</span></button>
        </div>
      </div>`);
    l.querySelector('.rv-ent-x').onclick = closeLayer;
    wire(l, '[data-room-tool]', (button) => {
      if (button.dataset.roomTool === 'accessories') {
        closeLayer();
        App().openRoomAccessoriesModal(ctx.room);
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
  const mIcon = (k) => MI_FILL.has(k)
    ? `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">${MI[k]}</svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${MI[k]}</svg>`;
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
      startMusicAudioPoll();
    } catch (err) {
      console.error('music library load:', err);
    }
  }

  // بعد حفظ أغنية يوتيوب يحوّلها الخادم إلى mp3 صغير في الخلفية؛ نتابع حتى تصبح جاهزة ثم تُشغَّل كمقطع صوتي
  let musicPollTimer = null, musicPollCount = 0;
  const hasProcessingTracks = () => musicLibrary.some(t => t.audio_status === 'processing');
  function startMusicAudioPoll() {
    if (musicPollTimer || !hasProcessingTracks()) return;
    musicPollCount = 0;
    musicPollTimer = setInterval(async () => {
      musicPollCount++;
      if (!hasProcessingTracks() || musicPollCount > 180) { clearInterval(musicPollTimer); musicPollTimer = null; return; }
      const ownerId = me()?.id;
      if (!ownerId) return;
      try {
        const data = await api('GET', '/api/music-library');
        if (me()?.id !== ownerId) return;
        let changed = false;
        (data.tracks || []).forEach(nt => {
          const old = musicLibrary.find(t => t.id === nt.id);
          if (old && old.audio_status === 'processing' && nt.audio_status !== 'processing') {
            // لا نغيّر المقطع الذي يعمل الآن (يبقى على مشغّله الحالي)؛ التغيير يسري عند التشغيل التالي
            Object.assign(old, normalizeMusicTrack(nt)); changed = true;
          }
        });
        if (changed && ctx) paintMusicSheet();
      } catch (e) { /* نحاول مجدداً في الدورة التالية */ }
    }, 3000);
  }

  // ترتيب القائمة: حسب الإضافة (الأحدث أولاً) أو حسب الاسم
  function orderedTracks() {
    const arr = musicLibrary.slice();
    if (ctx && ctx.music.sort === 'name') arr.sort((a, b) => String(a.title).localeCompare(String(b.title), 'ar'));
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
      toast(data.track && data.track.audio_status === 'processing' ? 'تم الحفظ — جارٍ تجهيز MP3 منخفض الحجم 🎵' : 'تم حفظ الأغنية في قائمتك 🎵');
      startMusicAudioPoll();
    } catch (err) {
      toast(err.message);
    }
    if (ctx) paintMusicBody();
  }

  async function deleteMusicTrack(id) {
    if (!musicLibrary.some(t => t.id === id)) return;
    try { await api('DELETE', `/api/music-library/${encodeURIComponent(id)}`); } catch (err) { return toast(err.message); }
    const i = musicLibrary.findIndex(t => t.id === id);
    if (i >= 0) musicLibrary.splice(i, 1);
    if (!ctx) return;
    if (ctx.music.current && ctx.music.current.id === id) stopRoomMusic(true);
    if (ctx.music.selectedId === id) ctx.music.selectedId = null;
    paintMusicSheet();
  }

  async function retryYtAudio(id) {
    const track = musicLibrary.find(t => t.id === id);
    if (!track || track.audio_status !== 'failed') return;
    try {
      const data = await api('POST', `/api/music-library/${encodeURIComponent(id)}/retry`);
      if (data.track) Object.assign(track, normalizeMusicTrack(data.track));
      else track.audio_status = 'processing';
      toast('جارٍ إعادة تجهيز ملف MP3 منخفض الحجم…');
      startMusicAudioPoll();
      if (ctx) paintMusicSheet();
    } catch (err) { toast(err.message || 'تعذرت إعادة المحاولة'); }
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
      toast(data.track && data.track.audio_status === 'processing' ? 'تم الحفظ — جارٍ تجهيز MP3 منخفض الحجم 🎵' : 'تم حفظ الأغنية في قائمتك 🎵');
      startMusicAudioPoll();
      if (ctx) paintMusicSheet();
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
      ${musicLibrary.length ? '<button type="button" class="rv-ms-pill rv-ms-addpill" data-act="add">اضافة</button>' : ''}
    </div>${m.searchOpen ? searchRowHTML() : ''}`;
  }
  function searchRowHTML() {
    return `<div class="rv-ms-searchrow"><input type="text" id="rv-ms-q" placeholder="بحث" value="${esc(ctx.music.query)}" autocomplete="off"></div>`;
  }

  function musicRowHTML(track, idx) {
    const m = ctx.music;
    const cur = m.selectedId === track.id && m.playing && m.current && m.current.id === track.id;
    return `<div class="rv-ms-row ${cur ? 'on' : ''}" data-track-id="${esc(track.id)}">
      ${safeThumb(track.thumbnail) ? `<img class="rv-yt-thumb" src="${esc(safeThumb(track.thumbnail))}" alt="" loading="lazy">` : `<span class="rv-ms-idx">${idx + 1}</span>`}
      <span class="rv-ms-copy"><b>${esc(track.title)}</b><small>${esc(track.artist || UNKNOWN)}${track.audio_status === 'processing' ? ' · <em class="rv-ms-proc">جارٍ تجهيز MP3…</em>' : track.audio_status === 'failed' ? ' · <em class="rv-ms-failed">تعذر تجهيز MP3</em>' : ''}</small></span>
      <span class="rv-ms-state">${cur ? `<span class="rv-eq ${m.paused ? '' : 'live'}"><i></i><i></i><i></i></span>` : mIcon('play')}</span>
      ${track.audio_status === 'failed' && track.yt_id ? `<button type="button" class="rv-ms-retry" data-retry="${esc(track.id)}" aria-label="إعادة تجهيز MP3">إعادة</button>` : ''}
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
        html = `<div class="rv-ms-empty">${NOTES_ART}<span>ابحث عن أغنية في يوتيوب ثم اضغط + لحفظها<br><small style="font-size:11px;color:var(--text-secondary);">أو الصق رابط يوتيوب مباشرة في الحقل أدناه</small></span></div>`;
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
    const retry = t.closest('[data-retry]');
    if (retry) { ev.stopPropagation(); return retryYtAudio(retry.dataset.retry); }
    const del = t.closest('[data-del]');
    if (del) { ev.stopPropagation(); return deleteMusicTrack(del.dataset.del); }
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
        m.view = 'add'; m.query = ''; m.searchOpen = false; paintMusicSheet();
        const q = ctx.layer.querySelector('#rv-yt-q'); if (q) q.focus();
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
    if (!ctx) return;
    let card = ctx.container.querySelector('.rv-now-playing');
    if (!card) {
      card = document.createElement('div');
      card.className = 'rv-now-playing';
      ctx.container.appendChild(card);
      card.addEventListener('click', onMusicCardClick);
      card.addEventListener('input', (ev) => {
        if (!ev.target.classList.contains('rv-mp-range')) return;
        const a = ctx.music.audio, r = ev.target;
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
    if (!ctx || !ctx.music.audio) return;
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
    const a = ctx && ctx.music.audio;
    if (!a) return;
    if (a.paused) { ctx.music.userPaused = false; a.play().catch(() => toast('اضغط تشغيل مرة أخرى للسماح بتشغيل الصوت')); }
    else { ctx.music.userPaused = true; a.pause(); }
  }

  // انتقال تلقائي للأغنية التالية مع قاطع حلقة: إن تكرر الانتقال بسرعة (ملف لا يعمل) نوقف بدل الدوران
  function autoNext() {
    if (!ctx) return;
    const m = ctx.music, now = Date.now();
    m.autoTimes = (m.autoTimes || []).filter(t => now - t < 6000);
    m.autoTimes.push(now);
    if (m.autoTimes.length >= 3) { m.autoTimes = []; toast('توقف التشغيل: ملف الصوت غير صالح أو ناقص، جرّب أغنية أخرى'); stopRoomMusic(true); return; }
    playAdjacent(1);
  }

  function playAdjacent(dir) {
    if (!ctx) return;
    const list = orderedTracks();
    if (!list.length) return;
    const cur = list.findIndex(t => t.id === ctx.music.selectedId);
    let next = cur < 0 ? 0 : cur + dir;
    if (next >= list.length) next = 0;
    if (next < 0) next = list.length - 1;
    playRoomMusic(list[next].id);
  }

  // ----- شريط الصوت (Volume) -----
  function closeMusicVolume() {
    if (!ctx) return;
    clearTimeout(ctx.music.volTimer);
    const old = ctx.container.querySelector('.rv-vol-layer');
    if (old) old.remove();
  }
  function setMusicVolume(v) {
    const m = ctx.music;
    m.volume = v;
    if (m.gain) m.gain.gain.value = v;
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
    const active = ctx.music.playing && !ctx.music.paused && (ctx.music.current || ctx.music.remote);
    const seatIndex = ctx.music.seatIndex;
    if (!active || seatIndex === undefined || seatIndex === null) return;

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
  }

  function publishRoomMusic(eventName, item) {
    if (!ctx || !st().socket || !onSeat()) return;
    st().socket.emit(eventName, {
      roomId: roomId(), userId: me().id, seatIndex: st().userSeatIndex,
      title: item?.title || 'موسيقى', trackId: item?.id || '', cover: item?.cover || ''
    });
  }

  function attachMusicToVoice(attempt = 0) {
    if (!ctx?.music?.playing || !ctx.music.destination || !window.soulRtc || !onSeat()) return;
    if (typeof window.soulRtc.setVoiceMusicStream === 'function') {
      const attached = window.soulRtc.setVoiceMusicStream(ctx.music.destination.stream);
      // طلب الميكروفون/WebRTC غير متزامن؛ نعيد المحاولة بعد منحه الإذن.
      if (!attached && attempt < 20) setTimeout(() => attachMusicToVoice(attempt + 1), 250);
    }
  }

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
  // ويُدمج في ميكرفون المقعد، فيسمعه كل من في الغرفة عبر WebRTC دون ظهور يوتيوب لأحد.
  // false = تشغيل مشغّل يوتيوب مباشرة (سريع، بلا خادم). true = جلب الصوت عبر الخادم/yt-dlp (بطيء ويحتاج كوكيز)
  const YT_VIA_SERVER = false;
  async function playYoutubeTrack(track) {
    const m = ctx.music;
    const token = {};
    m.ytToken = token; m.current = track; m.selectedId = track.id; m.minimized = false;
    m.paused = true; m.playing = true; m.ownerId = me().id; m.seatIndex = st().userSeatIndex; m.userPaused = false;
    m.ytRetried = false; m.startedAt = Date.now();
    renderMusicNowPlaying(); paintMusicSheet();
    const alive = () => ctx && ctx.music.ytToken === token;
    // الوضع السريع (الافتراضي): مشغّل يوتيوب نفسه مخفي عند صاحب المقعد، يُتحكم به من واجهة الصوت،
    // ويُبثّ للغرفة فيشغّل الجميع نفس المقطع بتزامن، ويظهر عند الجميع كأنه صادر من المقعد.
    if (!YT_VIA_SERVER) {
      m.paused = false;
      const ok = await ytFallbackToIframe(track, token);
      if (!ok && alive()) { toast('تعذر تشغيل المقطع، تحقق من الاتصال أو جرّب مقطعاً آخر'); stopRoomMusic(true); }
      return;
    }
    const audio = new Audio();
    audio.src = '/api/youtube/stream/' + encodeURIComponent(track.yt_id) + '?uid=' + encodeURIComponent((st().currentUser && st().currentUser.id) || '');
    audio.preload = 'auto';
    audio.loop = m.repeat === 'one';
    m.audio = audio; m.ytPlayer = null; m.ytBox = null;
    m.paused = false;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      try {
        const audioContext = new AudioCtx();
        const source = audioContext.createMediaElementSource(audio);
        const destination = audioContext.createMediaStreamDestination();
        const gain = audioContext.createGain();
        gain.gain.value = m.volume == null ? 1 : m.volume;
        source.connect(gain);
        gain.connect(audioContext.destination);
        gain.connect(destination);
        m.audioContext = audioContext; m.mediaSource = source; m.destination = destination; m.gain = gain;
        try {
          const an = audioContext.createAnalyser();
          an.fftSize = 512; an.smoothingTimeConstant = 0.5;
          source.connect(an);
          m.analyser = an;
          if (window.voiceRings && me()) {
            window.voiceRings.watchAnalyser(String(me().id), an, 'music', () => !!(audioIsLive(audio) && !audio.paused));
          }
        } catch (e) {}
        audioContext.resume().catch(() => {});
      } catch (err) { console.warn('yt audio graph unavailable:', err); }
    }
    if (!m.gain) audio.volume = m.volume == null ? 1 : m.volume;
    audio.onplay = () => {
      if (!ctx || ctx.music.audio !== audio) return;
      ctx.music.playing = true; ctx.music.paused = false; ctx.music.userPaused = false;
      attachMusicToVoice();
      setMusicRings(me().id, true, ctx.music.seatIndex);
      publishRoomMusic('room_music_started', track);
      renderMusicNowPlaying(); renderMusicSeatIndicator(); paintMusicSheet();
      setupMediaSession(track);
    };
    audio.onpause = () => {
      if (!ctx || ctx.music.audio !== audio || audio.ended) return;
      // إيقاف تلقائي من المتصفح (مغادرة الصفحة/تبويب خلفي) ← نستأنف فوراً بدل إيقاف الصوت عن الغرفة
      if (!ctx.music.userPaused) { audio.play().catch(() => {}); return; }
      ctx.music.paused = true;
      setMusicRings(me().id, false);
      publishRoomMusic('room_music_stopped', track);
      renderMusicNowPlaying(); renderMusicSeatIndicator(); paintMusicSheet();
    };
    audio.onended = () => {
      if (!ctx || ctx.music.audio !== audio) return;
      // انتهاء مبكر جداً = ملف ناقص/تالف: نعيد التحميل من يوتيوب مرة واحدة ثم نتوقف (بدون حلقة)
      const early = Date.now() - (ctx.music.startedAt || 0) < 3000 && !audio.loop;
      if (early) {
        if (!ctx.music.ytRetried) {
          ctx.music.ytRetried = true;
          audio.src = '/api/youtube/stream/' + encodeURIComponent(track.yt_id) + '?fresh=1&uid=' + encodeURIComponent((st().currentUser && st().currentUser.id) || '');
          ctx.music.startedAt = Date.now();
          audio.load(); audio.play().catch(() => {});
          return;
        }
        ytFallbackToIframe(track, token).then(ok => {
          if (!ok && ctx && ctx.music.ytToken === token) { toast('ملف الصوت ناقص أو تالف، جرّب أغنية أخرى'); stopRoomMusic(true); }
        });
        return;
      }
      autoNext();
    };
    audio.ontimeupdate = updateMusicProgress;
    audio.onloadedmetadata = updateMusicProgress;
    audio.ondurationchange = updateMusicProgress;
    audio.onerror = async () => {
      if (!alive() || ctx.music.audio !== audio) return;
      let why = '';
      try { const r = await fetch(audio.src); if (!r.ok) { const j = await r.json().catch(() => null); why = (j && j.error) || ('HTTP ' + r.status); } } catch (e) { why = e.message; }
      console.error('YT stream failed:', why);
      // بدل إغلاق المشغّل: نجرّب المشغّل المخفي كبديل
      const ok = await ytFallbackToIframe(track, token);
      if (!ok && ctx && ctx.music.ytToken === token) { toast('تعذر تشغيل المقطع: ' + (why || 'خطأ غير معروف')); stopRoomMusic(true); }
    };
    m.ytTick = setInterval(updateMusicProgress, 500);
    try { await audio.play(); } catch (e) { toast('اضغط تشغيل مرة أخرى للسماح بتشغيل الصوت'); }
    renderMusicNowPlaying();
  }

  // — احتياطي: إذا فشل جلب الصوت عبر الخادم (حجب يوتيوب للخوادم مثلاً) لا نُغلق المشغّل،
  // بل نشغّل مشغّل يوتيوب المخفي عند صاحب المقعد ونبثّ حالته ليسمعه الجميع.
  async function ytFallbackToIframe(track, token) {
    const m = ctx && ctx.music;
    if (!m || m.ytToken !== token) return false;
    // إنهاء مسار الصوت القديم دون إغلاق الجلسة
    try { if (m.audio && m.audio.pause) { const a = m.audio; m.audio = null; a.onerror = a.onended = a.onpause = a.onplay = null; a.pause(); a.removeAttribute('src'); a.load(); } } catch (e) {}
    if (m.audioContext) { try { m.audioContext.close(); } catch (e) {} }
    m.audioContext = null; m.mediaSource = null; m.destination = null; m.gain = null; m.analyser = null;
    if (window.voiceRings) window.voiceRings.unwatchKind('music');
    if (window.soulRtc && typeof window.soulRtc.clearVoiceMusicStream === 'function') window.soulRtc.clearVoiceMusicStream();
    clearInterval(m.ytTick);
    let box;
    try {
      box = ytMakeBox('host', track.title);
      const S = (window.YT && window.YT.PlayerState) || { PLAYING: 1 };
      const player = await ytCreatePlayer(box, track.yt_id, 0, true, {
        onStateChange: (e) => {
          if (!ctx || ctx.music.ytToken !== token) return;
          const Y = window.YT.PlayerState;
          if (e.data === Y.PLAYING) {
            ctx.music.playing = true; ctx.music.paused = false;
            setMusicRings(me().id, true, ctx.music.seatIndex);
            publishRoomMusic('room_music_started', track);
            ytPublish('play', track);
            renderMusicNowPlaying(); renderMusicSeatIndicator(); paintMusicSheet();
          } else if (e.data === Y.PAUSED && !ctx.music.userPaused) {
            // إيقاف غير مقصود (انتقال صفحة/تصغير/المتصفح) ← نستأنف فوراً
            setTimeout(() => { try { if (ctx && ctx.music.ytToken === token && !ctx.music.userPaused) ctx.music.ytPlayer.playVideo(); } catch (e2) {} }, 250);
          } else if (e.data === Y.PAUSED && ctx.music.userPaused) {
            ctx.music.paused = true; setMusicRings(me().id, false);
            ytPublish('pause', track);
            renderMusicNowPlaying(); renderMusicSeatIndicator(); paintMusicSheet();
          } else if (e.data === Y.ENDED) { autoNext(); }
        },
        onError: () => { if (ctx && ctx.music.ytToken === token) { toast('هذا المقطع غير متاح للتشغيل، جرّب مقطعاً آخر'); stopRoomMusic(true); } }
      });
      if (!ctx || ctx.music.ytToken !== token) { try { player.destroy(); } catch (e) {} try { box.remove(); } catch (e) {} return false; }
      m.ytPlayer = player; m.ytBox = box;
      try { player.setVolume(Math.round((m.volume == null ? 1 : m.volume) * 100)); } catch (e) {}
      m.audio = makeYtAdapter(player, m);
      m.paused = false; m.playing = true; m.userPaused = false;
      try { player.playVideo(); } catch (e) {}
      m.ytHb = setInterval(() => { if (ctx && ctx.music.ytToken === token && ctx.music.audio && !ctx.music.audio.paused) ytPublish('play', track); }, 4000);
      m.ytTick = setInterval(updateMusicProgress, 500);
      renderMusicNowPlaying(); paintMusicSheet();
      return true;
    } catch (err) {
      console.warn('yt iframe fallback failed:', err);
      try { if (box) box.remove(); } catch (e) {}
      return false;
    }
  }

  // إبقاء الموسيقى تعمل عند الانتقال لصفحة/تبويب آخر أو قفل الشاشة
  function keepMusicAlive() {
    if (!ctx || !ctx.music || !ctx.music.playing || ctx.music.ownerId !== (me() && me().id)) return;
    const m = ctx.music;
    try { if (m.audioContext && m.audioContext.state !== 'running') m.audioContext.resume().catch(() => {}); } catch (e) {}
    try {
      const mix = window.soulRtc && window.soulRtc.voiceMixerContext;
      if (mix && mix.state !== 'running') mix.resume().catch(() => {});
    } catch (e) {}
    try { if (m.audio && m.audio.paused && !m.userPaused && !m.audio.ended) m.audio.play().catch(() => {}); } catch (e) {}
  }
  function setupMediaSession(track) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: (track && track.title) || 'موسيقى', artist: (ctx && ctx.room && ctx.room.title) || 'SoulChill', artwork: track && track.thumbnail ? [{ src: track.thumbnail }] : [] });
      navigator.mediaSession.playbackState = 'playing';
      navigator.mediaSession.setActionHandler('play', () => { if (ctx && ctx.music.audio) { ctx.music.userPaused = false; ctx.music.audio.play().catch(() => {}); } });
      navigator.mediaSession.setActionHandler('pause', () => { if (ctx && ctx.music.audio) { ctx.music.userPaused = true; ctx.music.audio.pause(); } });
      navigator.mediaSession.setActionHandler('nexttrack', () => playAdjacent(1));
      navigator.mediaSession.setActionHandler('previoustrack', () => playAdjacent(-1));
    } catch (e) {}
  }
  // عند مغادرة التبويب/العودة: محاولات استئناف متتالية لمشغّل يوتيوب (إن لم يوقفه المستخدم بنفسه)
  const resumeBurst = () => {
    keepMusicAlive();
    [200, 600, 1500, 3500].forEach(ms => setTimeout(keepMusicAlive, ms));
  };
  const onVisibility = () => resumeBurst();
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', onVisibility);
  window.addEventListener('focus', onVisibility);
  window.addEventListener('blur', () => setTimeout(keepMusicAlive, 300));
  setInterval(keepMusicAlive, 3000);

  // ----- المستمعون: تشغيل نفس المقطع عندهم ومتابعة صاحب المقعد -----
  function ytRemoteStop() {
    if (!ctx) return;
    const r = ctx.music.ytRemote;
    if (!r) return;
    clearInterval(r.watch);
    r.token = null;
    if (r.audio) { try { r.audio.pause(); r.audio.removeAttribute('src'); r.audio.load(); } catch(e){} }
    if (r.player) { try { r.player.destroy(); } catch (e) {} }
    if (r.box) { try { r.box.remove(); } catch (e) {} }
    ctx.music.ytRemote = null;
  }

  function ytRemoteSync(r, d) {
    const p = r.player; if (!p) return;
    const S = window.YT.PlayerState;
    const target = (Number(d.time) || 0) + (d.state === 'play' ? 0.4 : 0);
    let cur = 0, ps = -1;
    try { cur = p.getCurrentTime() || 0; ps = p.getPlayerState(); } catch (e) {}
    if (Math.abs(cur - target) > 2.5) { try { p.seekTo(target, true); } catch (e) {} }
    if (d.state === 'play') {
      if (ps !== S.PLAYING && ps !== S.BUFFERING) {
        try { p.playVideo(); } catch (e) {}
        setTimeout(() => {
          if (!r.token) return;
          let s2 = -1; try { s2 = p.getPlayerState(); } catch (e) {}
          if (s2 !== S.PLAYING && s2 !== S.BUFFERING) { r.box.querySelector('.rv-yt-tap').hidden = false; r.box.classList.remove('rv-yt-hidden'); }
        }, 2500);
      } else { r.box.querySelector('.rv-yt-tap').hidden = true; r.box.classList.add('rv-yt-hidden'); }
    } else if (d.state === 'pause') {
      try { p.pauseVideo(); } catch (e) {}
    }
  }

  async function ytRemoteApply(d) {
    // المستمعون يسمعون عبر ميكرفون المقعد، إلا في الوضع الاحتياطي (فشل بروكسي الصوت عند صاحب المقعد)
    if (!d || !d.fallback) return;
    if (!ctx) return;
    const m = ctx.music;
    if (m.ytPlayer || m.ytToken) return; // أنا أشغّل أغنيتي الخاصة
    if (d.state === 'stop') { if (m.ytRemote && m.ytRemote.userId === d.userId) ytRemoteStop(); return; }
    // المستخدمون في الغرفة يسمعون فقط عبر ميكرفون المقعد — لا حاجة لإظهار يوتيوب للمستمعين.
    // إذا كان المضيف يستخدم وضع الصوت المخفي (يبث عبر WebRTC) فإنه لا يرسل room_yt_state أصلاً،
    // ولن نصل هنا. هذا الفرع للاحتياطي فقط (عند فشل جلب الصوت عند المضيف).
    // نجعل الاستماع مخفياً أيضاً (صوت فقط بدون قالب) حتى لا يظهر يوتيوب للآخرين.
    // نحاول أولاً تشغيل صوت مخفي عبر /api/youtube/audio، ثم كاحتياطي YT مخفي 1×1.
    let r = m.ytRemote;
    if (r && (r.userId !== d.userId || r.videoId !== d.videoId)) { ytRemoteStop(); r = null; }
    if (r) { r.last = d; r.lastRecv = Date.now(); if (r.player) ytRemoteSync(r, d); if (r.audio) { try { if (d.state === 'play' && r.audio.paused) r.audio.play().catch(()=>{}); else if (d.state === 'pause') r.audio.pause(); } catch(e){} } return; }

    const token = {};
    // محاولة صوت مخفي للمستمع (بدون إظهار قالب)
    try {
      const rr = await fetch('/api/youtube/audio/' + encodeURIComponent(d.videoId), { headers: { 'x-user-id': (st().currentUser && st().currentUser.id) || '' } });
      const jj = await rr.json().catch(()=>null);
      if (rr.ok && jj && jj.success && jj.url) {
        const audio = new Audio();
        audio.crossOrigin = 'anonymous';
        audio.src = jj.url;
        audio.currentTime = Math.max(0, (Number(d.time)||0));
        if (m.ytRemoteMuted) audio.muted = true;
        r = { userId: d.userId, videoId: d.videoId, token, last: d, lastRecv: Date.now(), audio, box: null, player: null };
        m.ytRemote = r;
        audio.onended = () => ytRemoteStop();
        audio.onerror = () => ytRemoteStop();
        r.watch = setInterval(() => {
          if (!ctx || r.token !== token) return clearInterval(r.watch);
          if (Date.now() - r.lastRecv > 20000) ytRemoteStop();
        }, 5000);
        if (d.state === 'play') { try { await audio.play(); } catch(e) { /* يحتاج تفاعل */ } }
        return;
      }
    } catch (e) {}

    r = { userId: d.userId, videoId: d.videoId, token, last: d, lastRecv: Date.now(), player: null, box: ytMakeBox('remote', d.title) };
    m.ytRemote = r;
    const muteBtn = r.box.querySelector('.rv-yt-mute');
    muteBtn.onclick = () => {
      m.ytRemoteMuted = !m.ytRemoteMuted;
      try { if (r.audio) r.audio.muted = m.ytRemoteMuted; } catch(e){}
      try { if (m.ytRemoteMuted) r.player.mute(); else r.player.unMute(); } catch (e) {}
      muteBtn.textContent = m.ytRemoteMuted ? '🔇' : '🔊';
    };
    muteBtn.textContent = m.ytRemoteMuted ? '🔇' : '🔊';
    r.box.querySelector('.rv-yt-tap').onclick = () => {
      try { r.player.playVideo(); if (m.ytRemoteMuted) r.player.mute(); else r.player.unMute(); } catch (e) {}
      r.box.querySelector('.rv-yt-tap').hidden = true; r.box.classList.add('rv-yt-hidden');
    };
    try {
      const player = await ytCreatePlayer(r.box, d.videoId, (Number(d.time) || 0) + 0.4, d.state === 'play', {
        onError: () => { if (ctx && r.token === token) { ytRemoteStop(); } }
      });
      if (!ctx || r.token !== token) { try { player.destroy(); } catch (e) {} return; }
      r.player = player;
      if (m.ytRemoteMuted) { try { player.mute(); } catch (e) {} }
      ytRemoteSync(r, r.last);
      r.watch = setInterval(() => {
        if (!ctx || r.token !== token) return clearInterval(r.watch);
        if (r.last.state === 'play' && Date.now() - r.lastRecv > 20000) ytRemoteStop();
      }, 5000);
    } catch (err) {
      if (ctx && r.token === token) { ytRemoteStop(); }
    }
  }

  function playRoomMusic(trackId) {
    if (!ctx) return;
    const track = musicLibrary.find(item => item.id === trackId);
    if (!track) return;
    ctx.music.selectedId = track.id;
    if (!onSeat()) {
      paintMusicSheet();
      return toast('يجب الجلوس على مقعد المايك أولاً لتشغيل الموسيقى 🎙️');
    }
    if (st().isMuted) {
      paintMusicSheet();
      return toast('هذا المقعد مكتوم من الإدارة، لا يمكن تشغيل الموسيقى حتى يفك الأدمن الكتم 🔇');
    }
    stopRoomMusic(false, true);
    if (track.source === 'youtube' && track.yt_id) { playYoutubeTrack(track); return; }
    const m = ctx.music;
    const audio = new Audio();
    audio.crossOrigin = 'anonymous'; audio.src = track.url; audio.preload = 'auto'; audio.loop = m.repeat === 'one';
    m.audio = audio; m.current = track; m.minimized = false; m.paused = false; m.ownerId = me().id; m.seatIndex = st().userSeatIndex;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      try {
        const audioContext = new AudioCtx();
        const source = audioContext.createMediaElementSource(audio);
        const destination = audioContext.createMediaStreamDestination();
        // عقدة الصوت تتحكم بمستوى الموسيقى محلياً وفي البث إلى الغرفة معاً.
        const gain = audioContext.createGain();
        gain.gain.value = m.volume == null ? 1 : m.volume;
        source.connect(gain);
        gain.connect(audioContext.destination);
        gain.connect(destination);
        m.audioContext = audioContext; m.mediaSource = source; m.destination = destination; m.gain = gain;
        // تحليل الأغنية (قبل التحكم بالمستوى) لتتحرك التذبذبات الزرقاء حول صورتي حسب الإيقاع
        try {
          const an = audioContext.createAnalyser();
          an.fftSize = 512; an.smoothingTimeConstant = 0.5;
          source.connect(an);
          m.analyser = an;
          if (window.voiceRings && me()) {
            window.voiceRings.watchAnalyser(String(me().id), an, 'music', () => !!(audioIsLive(audio) && !audio.paused));
          }
        } catch (e) { /* التذبذب اختياري */ }
        audioContext.resume().catch(() => {});
      } catch (err) { console.warn('music audio graph unavailable:', err); }
    }
    if (!m.gain) audio.volume = m.volume == null ? 1 : m.volume;
    audio.onplay = () => {
      if (!ctx || ctx.music.audio !== audio) return;
      ctx.music.playing = true; ctx.music.paused = false; ctx.music.userPaused = false;
      attachMusicToVoice();
      setMusicRings(me().id, true, ctx.music.seatIndex);
      publishRoomMusic('room_music_started', track);
      renderMusicNowPlaying(); renderMusicSeatIndicator(); paintMusicSheet();
      setupMediaSession(track);
    };
    audio.onpause = () => {
      if (!ctx || ctx.music.audio !== audio || audio.ended) return;
      if (!ctx.music.userPaused) { audio.play().catch(() => {}); return; }
      ctx.music.paused = true;
      setMusicRings(me().id, false);
      publishRoomMusic('room_music_stopped', track);
      renderMusicNowPlaying(); renderMusicSeatIndicator(); paintMusicSheet();
    };
    audio.onended = () => { if (ctx && ctx.music.audio === audio) autoNext(); };
    audio.ontimeupdate = updateMusicProgress;
    audio.onloadedmetadata = updateMusicProgress;
    audio.ondurationchange = updateMusicProgress;
    audio.onerror = () => { if (ctx && ctx.music.audio === audio) toast('تعذر تشغيل هذه النغمة، تحقق من الملف أو الرابط'); };
    audio.play().catch(() => toast('اضغط تشغيل مرة أخرى للسماح بتشغيل الصوت'));
  }

  function stopRoomMusic(notify = true, silent = false) {
    if (!ctx?.music) return;
    const music = ctx.music;
    const wasPlaying = music.playing;
    ytRemoteStop();
    if (music.ytPlayer || music.ytBox) {
      if (notify && wasPlaying && !silent) ytPublish('stop', music.current);
      ytTeardownHost(music);
      music.audio = null;
    }
    if (music.ownerId) setMusicRings(music.ownerId, false);
    if (music.audio) {
      const a = music.audio; music.audio = null; music.userPaused = true;
      a.pause(); a.removeAttribute('src'); a.load();
    }
    if (music.audioContext) { try { music.audioContext.close(); } catch (e) {} }
    if (window.voiceRings) window.voiceRings.unwatchKind('music');
    music.analyser = null;
    if (window.soulRtc && typeof window.soulRtc.clearVoiceMusicStream === 'function') window.soulRtc.clearVoiceMusicStream();
    if (notify && wasPlaying && !silent) publishRoomMusic('room_music_stopped', music.current);
    closeMusicVolume();
    music.audio = null; music.audioContext = null; music.mediaSource = null; music.destination = null; music.gain = null; music.current = null; music.remote = null; music.playing = false; music.paused = false; music.minimized = false; music.ownerId = null; music.seatIndex = null;
    renderMusicNowPlaying(); renderMusicSeatIndicator();
    if (ctx.layer?.classList.contains('on')) paintMusicSheet();
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

  // ====== قائمة التحكم (10 أيقونات) ======
  function onSeat() { const i = st().userSeatIndex; return i !== null && i !== undefined; }
  function openControl() {
    if (!App().requireAuth()) return;
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
        <button type="button" class="rv-x" aria-label="إغلاق"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button>
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

    const SIZE = 58, MARGIN = 8;
    const b = document.createElement('div'); b.className = 'rv-mini'; b.setAttribute('role', 'button'); b.tabIndex = 0;
    b.setAttribute('aria-label', 'العودة إلى الغرفة: ' + (ctx.room.title || ''));
    b.innerHTML = `<img src="${esc(ctx.room.cover_image || ctx.room.host_avatar || '/avatars/avatar-1.png')}" alt="" draggable="false" onerror="this.src='/avatars/avatar-1.png'">
      <button type="button" class="rv-mini-x" aria-label="مغادرة الغرفة"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button>`;
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
      if (await window.uiConfirm('هل تريد مغادرة الغرفة؟', { icon: '🚪', okText: 'خروج' })) App().leaveActiveVoiceRoom();
    });
  }

  // الخروج المخصص: يغلق كل شيء (المايك، الصوت، الاتصال)
  async function exitRoom() {
    App().leaveActiveVoiceRoom();
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
    let tab = 'ready'; let sel = ctx.room.bg_image || ''; const cur = sel;
    let adminBgs = []; let loaded = false;
    const l = showLayer('<div class="rv-full" style="padding-top:0"></div>');
    const root = l.querySelector('.rv-full');
    const holder = document.createElement('div'); root.appendChild(holder);
    const thumb = (val, css, name, cls) => `<button type="button" class="rv-bg-item ${cls || ''} ${val === sel ? 'sel' : ''}" data-v="${esc(val)}" style="${css}"><span>${esc(name || '')}</span></button>`;
    const priceTag = (b) => (b.price > 0 && !b.owned) ? `<em class="rv-bg-price paid">💎 ${b.price}</em>` : `<em class="rv-bg-price">${b.price > 0 ? 'مملوكة' : 'مجانية'}</em>`;
    const findAdmin = (v) => adminBgs.find(b => b.image_url === v);
    function paint() {
      const tabs = [['ready', 'خلفية جاهزة'], ['anim', 'خلفية متحركة']];
      let items = '', gridHtml = '';
      if (tab === 'ready') {
        const adm = adminBgs.map(b => `<div class="rv-bg-cell"><button type="button" class="rv-bg-item ${b.image_url === sel ? 'sel' : ''}" data-v="${esc(b.image_url)}"><img src="${esc(b.image_url)}" alt="" loading="lazy"><span>${esc(b.name)}</span></button>${priceTag(b)}</div>`).join('');
        const imgs = READY_BG_IMAGES.map(b => `<div class="rv-bg-cell"><button type="button" class="rv-bg-item ${b.url === sel ? 'sel' : ''}" data-v="${esc(b.url)}"><img src="${esc(b.url)}" alt="" loading="lazy" onerror="this.closest('.rv-bg-cell').remove()"></button><em class="rv-bg-price">مجانية</em></div>`).join('');
        const cols = READY_BG.map(b => `<div class="rv-bg-cell">${thumb('grad:' + b.id, `background:${b.css}`, b.name)}<em class="rv-bg-price">مجانية</em></div>`).join('');
        gridHtml = (adm ? `<div class="rv-bg-grid">${adm}</div>` : (loaded ? '' : '<div class="rv-bg-sec">جارٍ التحميل…</div>'))
          + (imgs ? `<div class="rv-bg-grid">${imgs}</div>` : '')
          + `<div class="rv-bg-sec">الألوان</div><div class="rv-bg-grid">${cols}</div>`;
      }
      else items = ANIM_BG.map(b => `<div class="rv-bg-cell"><button type="button" class="rv-bg-item ${('anim:' + b.id) === sel ? 'sel' : ''}" data-v="anim:${b.id}"><div class="rv-bg rv-anim-${b.id}" style="position:absolute;inset:0"></div><span>${b.name}</span></button><em class="rv-bg-price">مجانية</em></div>`).join('');
      holder.innerHTML = `
        <div class="rv-bg-head"><button type="button" class="rv-pill" id="rv-bg-save" ${sel === cur ? 'disabled' : ''}>حفظ</button><h4>الخلفية</h4><button type="button" class="rv-x" style="position:static">✕</button></div>
        <div class="rv-bg-tabs">${tabs.map(t => `<b class="${t[0] === tab ? 'sel' : ''}" data-t="${t[0]}">${t[1]}</b>`).join('')}</div>
        ${gridHtml || `<div class="rv-bg-grid">${items}</div>`}`;
      holder.querySelector('.rv-x').onclick = closeLayer;
      wire(holder, '.rv-bg-tabs b', (b) => { tab = b.dataset.t; paint(); });
      wire(holder, '.rv-bg-item', (b) => { sel = b.dataset.v; paint(); });
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
          }
          await api('PUT', `/api/rooms/${roomId()}/background`, { bg_image: sel }); applyBg(sel); closeLayer(); toast('تم تغيير الخلفية');
        } catch (err) { toast(err.message); btn.disabled = false; }
      };
    }
    paint();
    api('GET', '/api/room-backgrounds').then(d => { adminBgs = (d && d.backgrounds) || []; }).catch(() => {}).finally(() => { loaded = true; if (holder.isConnected) paint(); });
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
      if (d.seatIndex === ctx.music.seatIndex && d.isMuted && ctx.music.playing) {
        if (ctx.music.ownerId === me().id) stopRoomMusic(true);
        else {
          ytRemoteStop();
          ctx.music.remote = null; ctx.music.ownerId = null; ctx.music.seatIndex = null; ctx.music.playing = false;
          renderMusicNowPlaying(); renderMusicSeatIndicator();
        }
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
      ctx.music.remote = { title: d.title || 'موسيقى', id: d.trackId || '' };
      ctx.music.ownerId = d.userId; ctx.music.seatIndex = d.seatIndex; ctx.music.playing = true;
      setMusicRings(d.userId, true, d.seatIndex);
      renderMusicNowPlaying(); renderMusicSeatIndicator();
    });
    on('room_music_stopped', (d) => {
      if (!ctx || d.roomId !== roomId() || d.userId === me().id || (ctx.music.ownerId && d.userId !== ctx.music.ownerId)) return;
      setMusicRings(d.userId, false);
      ctx.music.remote = null; ctx.music.ownerId = null; ctx.music.seatIndex = null; ctx.music.playing = false;
      renderMusicNowPlaying(); renderMusicSeatIndicator();
    });
    on('room_yt_state', (d) => {
      if (!ctx || d.roomId !== roomId() || d.userId === me().id) return;
      ytRemoteApply(d);
    });
    on('seat_updated', (d) => {
      if (!ctx || !ctx.music.playing) return;
      if (!d.user && d.seatIndex === ctx.music.seatIndex) {
        if (ctx.music.ownerId === me().id) stopRoomMusic(true);
        else { ytRemoteStop(); setMusicRings(ctx.music.ownerId, false); ctx.music.remote = null; ctx.music.playing = false; renderMusicNowPlaying(); renderMusicSeatIndicator(); }
      }
      renderMusicSeatIndicator();
    });
  }
})();
