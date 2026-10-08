// SoulChill Master Application Controller
(function() {
  'use strict';

  // Global State
  const state = {
    currentUser: null,
    token: null,
    currentTab: 'planet',
    socket: null,
    activeRoom: null,
    currentChatPartner: null,
    radarInstance: null,
    allUsers: [],
    rooms: [],
    moments: [],
    conversations: [],
    gifts: [],
    // Audio & Mic state
    localStream: null,
    audioContext: null,
    analyser: null,
    micLevelInterval: null,
    isMuted: false,
    userSeatIndex: null,
    // Voice note recording
    mediaRecorder: null,
    recordedAudioChunks: [],
    isRecordingVoiceNote: false,
    recordingTimerInterval: null,
    recordingSeconds: 0,
    // Language & Mode
    lang: 'ar',
    isFullScreen: false,
    // Room Audience & Moderation state
    activeRoomAudience: [],
    activeRoomMutedChatUsers: new Set(),
    isChatMuted: false,
    // Country / IP geolocation
    myGeo: null,
    countriesList: [],
    selectedCountry: 'all',
    selectedCategory: 'all',
    unreadMessagesCount: 0,
    unreadNotifCount: 0,
    favoriteRoomIds: [],
    // YouTube global persistent player (يبقى يعمل عند التنقل وتصغيره بالنقر على الشاشة مثل مقاطع الصوت)
    globalYt: null
  };

  // ====================== مشغّل يوتيوب العائم الثابت ======================
  // عنصر الصوت المخفي للمنشورات (مثل مقاطع الصوت)
  let gypAudioEl = null;
  function ensureGypAudio() {
    if (gypAudioEl && gypAudioEl.isConnected) return gypAudioEl;
    gypAudioEl = document.createElement('audio');
    gypAudioEl.id = 'gyp-audio';
    gypAudioEl.crossOrigin = 'anonymous';
    gypAudioEl.preload = 'auto';
    gypAudioEl.style.display = 'none';
    document.body.appendChild(gypAudioEl);
    return gypAudioEl;
  }

  function ensureGlobalYtDom() {
    let wrap = document.getElementById('global-yt-player');
    if (wrap) return wrap;
    wrap = document.createElement('div');
    wrap.id = 'global-yt-player';
    wrap.className = 'gyp gyp-audio'; // افتراضي مخفي (مثل مقاطع الصوت) — لا يظهر قالب فيديو
    wrap.innerHTML = `
      <div class="gyp-card" id="gyp-card">
        <div class="gyp-video-wrap" aria-hidden="true" style="display:none">
          <div id="gyp-iframe-host"></div>
          <button type="button" class="gyp-btn gyp-close" id="gyp-close" aria-label="إغلاق">✕</button>
          <button type="button" class="gyp-btn gyp-min" id="gyp-min" aria-label="تصغير">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 14l8 8 8-8"/><path d="M12 22V10"/><path d="M4 10h16"/></svg>
          </button>
        </div>
        <div class="gyp-audio-head">
          <span class="gyp-badge"><svg viewBox="0 0 24 24" width="12" height="12"><rect width="24" height="24" rx="6" fill="#FF0000"/><path fill="#fff" d="M10 8.5l5 3.5-5 3.5z"/></svg> YouTube</span>
          <button type="button" class="gyp-btn gyp-close" id="gyp-close2" aria-label="إغلاق">✕</button>
        </div>
        <div class="gyp-info">
          <b class="gyp-title" id="gyp-title"></b>
          <small class="gyp-channel" id="gyp-channel"></small>
        </div>
        <div class="gyp-ctl">
          <button type="button" class="gyp-ctl-btn" id="gyp-playpause" title="إيقاف/تشغيل">⏸ إيقاف</button>
          <button type="button" class="gyp-ctl-btn" id="gyp-expand" title="تكبير">⛶</button>
          <button type="button" class="gyp-ctl-btn danger" id="gyp-stop" title="إيقاف">■ إغلاق</button>
        </div>
      </div>
      <button type="button" class="gyp-mini" id="gyp-mini" aria-label="إظهار المشغّل">
        <span class="gyp-mini-thumb"><img id="gyp-mini-img" src="" alt="" /></span>
        <span class="gyp-mini-txt"><b id="gyp-mini-title"></b><small>▶ يوتيوب يعمل</small></span>
        <span class="gyp-mini-act">⛶</span>
      </button>
    `;
    document.body.appendChild(wrap);
    wrap.querySelector('#gyp-close').onclick = () => closeGlobalYt();
    const c2 = wrap.querySelector('#gyp-close2');
    if (c2) c2.onclick = () => closeGlobalYt();
    wrap.querySelector('#gyp-stop').onclick = () => closeGlobalYt();
    const pp = wrap.querySelector('#gyp-playpause');
    if (pp) pp.onclick = (e) => { e.stopPropagation(); toggleGlobalYtPause(); };
    wrap.querySelector('#gyp-min').onclick = (e) => { e.stopPropagation(); minimizeGlobalYt(); };
    wrap.querySelector('#gyp-expand').onclick = (e) => { e.stopPropagation(); expandGlobalYt(); };
    wrap.querySelector('#gyp-mini').onclick = (e) => { e.stopPropagation(); expandGlobalYt(); };
    // النقر على البطاقة نفسها لا يصغّر، النقر خارجها يصغّر
    wrap.querySelector('#gyp-card').addEventListener('click', (e) => e.stopPropagation());
    return wrap;
  }

  function renderGlobalYt() {
    const wrap = document.getElementById('global-yt-player');
    const s = state.globalYt;
    if (!s || !s.videoId) {
      if (wrap) { wrap.classList.remove('on','min'); const host = wrap.querySelector('#gyp-iframe-host'); if(host) host.innerHTML=''; }
      const a = document.getElementById('gyp-audio');
      if (a) { try { a.pause(); a.removeAttribute('src'); a.load(); } catch(e){} }
      return;
    }
    ensureGlobalYtDom();
    const w = document.getElementById('global-yt-player');
    w.classList.add('on');
    w.classList.toggle('min', !!s.minimized);
    const titleEl = document.getElementById('gyp-title');
    const chEl = document.getElementById('gyp-channel');
    const miniTitle = document.getElementById('gyp-mini-title');
    const miniImg = document.getElementById('gyp-mini-img');
    if (titleEl) titleEl.textContent = s.title || 'مقطع يوتيوب';
    if (chEl) chEl.textContent = s.channel || '';
    if (miniTitle) miniTitle.textContent = s.title || 'يوتيوب';
    if (miniImg) miniImg.src = 'https://i.ytimg.com/vi/' + s.videoId + '/mqdefault.jpg';
    const pp = document.getElementById('gyp-playpause');
    if (pp) pp.textContent = s.paused ? '▶ تشغيل' : '⏸ إيقاف';
    // قالب الفيديو يبقى مخفياً — نستخدم صوت مخفي فقط
    const host = document.getElementById('gyp-iframe-host');
    if (host && !s.useAudio && !host.querySelector('iframe')) {
      host.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(s.videoId) + '?autoplay=1&rel=0&modestbranding=1&playsinline=1" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" style="width:1px;height:1px;position:absolute;left:-9999px;top:-9999px;opacity:0;pointer-events:none;"></iframe>';
    }
  }

  function toggleGlobalYtPause() {
    const a = document.getElementById('gyp-audio');
    if (!a || !a.src) return;
    if (a.paused) { a.play().catch(()=>{}); state.globalYt.paused = false; }
    else { a.pause(); state.globalYt.paused = true; }
    renderGlobalYt();
  }

  async function playGlobalYt(videoId, title, channel) {
    if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return;
    // إذا كان نفس المقطع ويعمل، فقط افتحه
    if (state.globalYt && state.globalYt.videoId === videoId) {
      state.globalYt.minimized = false;
      state.globalYt.title = title || state.globalYt.title;
      state.globalYt.channel = channel || state.globalYt.channel;
      const a = document.getElementById('gyp-audio');
      if (a && a.src && a.paused) { try { await a.play(); state.globalYt.paused = false; } catch(e){} }
      renderGlobalYt();
      return;
    }
    state.globalYt = { videoId, title: title || 'مقطع يوتيوب', channel: channel || '', minimized: true, paused: false, useAudio: true };
    // يبقى مخفياً مثل مقاطع الصوت — يصغّر تلقائياً ولا يظهر قالب فيديو
    const host = document.getElementById('gyp-iframe-host');
    if (host) host.innerHTML = '';
    ensureGlobalYtDom();
    renderGlobalYt();
    // حاول تشغيل صوت مخفي عبر خادمنا (Innertube) ثم احتياطي iframe مخفي
    const audio = ensureGypAudio();
    try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch(e){}
    try {
      const r = await fetch('/api/youtube/audio/' + encodeURIComponent(videoId), { headers: { 'x-user-id': (state.currentUser && state.currentUser.id) || '' } });
      const j = await r.json().catch(()=>null);
      if (r.ok && j && j.success && j.url) {
        audio.src = j.url;
        audio.onended = () => { closeGlobalYt(); };
        audio.onpause = () => { if (state.globalYt) { state.globalYt.paused = true; renderGlobalYt(); } };
        audio.onplay = () => { if (state.globalYt) { state.globalYt.paused = false; renderGlobalYt(); } };
        try { await audio.play(); state.globalYt.paused = false; } catch(e) { state.globalYt.paused = true; }
        renderGlobalYt();
        return;
      }
    } catch(e){}
    // احتياطي: iframe مخفي 1×1 (صوت فقط)
    state.globalYt.useAudio = false;
    renderGlobalYt();
  }

  function closeGlobalYt() {
    state.globalYt = null;
    const host = document.getElementById('gyp-iframe-host');
    if (host) host.innerHTML = '';
    const a = document.getElementById('gyp-audio');
    if (a) { try { a.pause(); a.removeAttribute('src'); a.load(); } catch(e){} }
    const w = document.getElementById('global-yt-player');
    if (w) w.classList.remove('on','min');
  }

  function minimizeGlobalYt() {
    if (!state.globalYt || !state.globalYt.videoId || state.globalYt.minimized) return;
    state.globalYt.minimized = true;
    renderGlobalYt();
  }

  function expandGlobalYt() {
    if (!state.globalYt || !state.globalYt.videoId || !state.globalYt.minimized) return;
    state.globalYt.minimized = false;
    renderGlobalYt();
  }

  // النقر على الشاشة يصغّر المشغّل الموسّع (مثل مقاطع الصوت تماماً)
  document.addEventListener('click', (e) => {
    const s = state.globalYt;
    if (!s || !s.videoId || s.minimized) return;
    // لا يصغّر إذا النقر داخل المشغّل نفسه أو داخل نافذة إنشاء منشور أو لوحة تحكم
    if (e.target.closest('#global-yt-player') || e.target.closest('#create-moment-modal') || e.target.closest('.soul-modal-content')) return;
    // يصغّر عند النقر على محتوى التطبيق
    if (e.target.closest('#app-main-content') || e.target.closest('.app-container') || e.target.closest('.app-viewport')) {
      minimizeGlobalYt();
    }
  });

  // عند التنقل بين التبويبات لا نغلق المشغّل — يبقى ثابتاً


  function isPlatformStaff(user) {
    if (!user || !user.role) return false;
    return ['owner', 'super_master', 'super_admin', 'admin', 'moderator'].includes(user.role);
  }

  function canAccessAdminPanel(user) {
    if (!user || !user.role) return false;
    return ['owner', 'super_master', 'super_admin'].includes(user.role);
  }

  // Translations dictionary
  const i18n = {
    ar: {
      appName: 'سول شل',
      appSub: 'عالم الأرواح والدردشة',
      tabPlanet: 'كوكب الروح',
      tabRooms: 'غرف صوتية',
      tabChat: 'الرسائل',
      tabMoments: 'لحظات',
      tabProfile: 'حسابي',
      dailyBonus: 'مكافأة يومية',
      claim: 'استلام',
      createRoom: 'إنشاء غرفة صوتية',
      emptySeat: 'صعود للميك',
      leaveSeat: 'نزول',
      muteMic: 'كتم المايك',
      unmuteMic: 'تحدث الآن',
      sendGift: 'إرسال هدية',
      sayHi: 'إلقاء التحية 👋',
      startChat: 'مراسلة خاصة 💬',
      rollDice: 'رمي النرد 🎲',
      luckyWheel: 'عجلة الحظ 🎡',
      pkBattle: 'تحدي PK 🔥',
      like: 'إعجاب',
      comment: 'تعليق',
      share: 'مشاركة'
    },
    en: {
      appName: 'SoulChill',
      appSub: 'Soul Party & Chill Voice',
      tabPlanet: 'Soul Planet',
      tabRooms: 'Voice Rooms',
      tabChat: 'Messages',
      tabMoments: 'Moments',
      tabProfile: 'Profile',
      dailyBonus: 'Daily Check-in',
      claim: 'Claim',
      createRoom: 'Create Room',
      emptySeat: 'Take Seat',
      leaveSeat: 'Leave Seat',
      muteMic: 'Mute',
      unmuteMic: 'Speak Now',
      sendGift: 'Send Gift',
      sayHi: 'Say Hi 👋',
      startChat: 'Private Chat 💬',
      rollDice: 'Roll Dice 🎲',
      luckyWheel: 'Lucky Wheel 🎡',
      pkBattle: 'PK Battle 🔥',
      like: 'Like',
      comment: 'Comment',
      share: 'Share'
    }
  };

  // Initialize App on DOM Ready
  document.addEventListener('DOMContentLoaded', async () => {
    initSocket();
    await fetchGeoLocation();
    await loadGiftsCatalogue();
    await loadWalletSettings();
    const deepLinkRoomId = new URLSearchParams(location.search).get('room');
    const enteredAsAdmin = await tryAdminDeepLinkLogin();
    if (!enteredAsAdmin) await checkStoredAuth();
    setupEventListeners();
    if (deepLinkRoomId) {
      history.replaceState(null, '', location.pathname);
      if (state.currentUser) openVoiceRoom(deepLinkRoomId);
      else state.pendingRoomId = deepLinkRoomId; // يُفتح بعد تسجيل الدخول
    }
  });

  // فتح غرفة من لوحة الإدارة: الدخول مباشرة بحساب السوبر الذي سجّل به الأدمن
  async function tryAdminDeepLinkLogin() {
    const params = new URLSearchParams(location.search);
    if (!params.get('room') || params.get('as') !== 'admin') return false;
    const adminToken = localStorage.getItem('soulchill_admin_token');
    if (!adminToken) return false;
    try {
      const res = await fetch('/api/admin/enter-as-user', {
        method: 'POST',
        headers: { 'x-admin-token': adminToken }
      });
      const d = await res.json();
      if (!d.success || !d.user) return false;
      state.currentUser = d.user;
      state.token = localStorage.getItem('soulchill_token') || 'device-persistent-token';
      localStorage.setItem('soulchill_user', JSON.stringify(d.user));
      localStorage.setItem('soulchill_user_id', d.user.id);
      localStorage.setItem('soulchill_token', state.token);
      onUserAuthenticated();
      return true;
    } catch (e) {
      console.warn('Admin deep-link login failed:', e);
      return false;
    }
  }

  // إعدادات المحفظة والمكافأة اليومية (تضبطها الإدارة)
  async function loadWalletSettings() {
    try {
      const res = await fetch('/api/settings/wallet');
      const d = await res.json();
      if (d && d.success) state.walletSettings = d.settings;
    } catch (e) {}
    applyWalletSettingsUI();
  }
  function applyWalletSettingsUI() {
    const w = state.walletSettings || { daily_bonus_enabled: true, daily_bonus_coins: 500, daily_bonus_text: '' };
    const strip = document.getElementById('main-daily-banner-strip');
    if (strip) strip.classList.toggle('daily-disabled', !w.daily_bonus_enabled);
    const txt = document.getElementById('daily-bonus-text');
    if (txt) {
      if (w.daily_bonus_text) txt.textContent = w.daily_bonus_text;
      else txt.innerHTML = `سجل حضورك اليومي واحصل على <strong>+${Number(w.daily_bonus_coins || 0).toLocaleString('en-US')} عملة مجاناً!</strong>`;
    }
  }

  // مقعد المستلم داخل الغرفة (مقعد المضيف 0 أو أحد مقاعد المايك)
  function findGiftSeatElByUserId(userId) {
    if (!userId || !state.activeRoom) return null;
    const seat = (state.activeRoom.seats || []).find(s => s.user_id === userId);
    if (!seat) return null;
    if (seat.seat_index === 0) return document.querySelector('#host-seat-0 .host-avatar-box') || document.getElementById('host-seat-0');
    return document.querySelector(`#stage-seat-${seat.seat_index} .seat-avatar-container`) || document.getElementById(`stage-seat-${seat.seat_index}`);
  }
  function findGiftReceiverSeatEl(receiver) { return receiver ? findGiftSeatElByUserId(receiver.id) : null; }
  function findGiftSenderSeatEl(sender) { return sender ? findGiftSeatElByUserId(sender.id) : null; }

  async function fetchGeoLocation() {
    try {
      const [geoRes, countRes] = await Promise.all([
        fetch('/api/geo/my-country').then(r => r.json()),
        fetch('/api/geo/countries').then(r => r.json())
      ]);
      if (geoRes && geoRes.success) {
        state.myGeo = geoRes;
      }
      if (countRes && countRes.success) {
        state.countriesList = countRes.countries;
      }
    } catch (e) {
      console.warn('Geo fetch fallback:', e);
      state.myGeo = { country_code: 'JO', country_name: 'الأردن', country_flag: '🇯🇴', city: 'إربد', ip: '127.0.0.1' };
    }
  }

  // 1. Socket.IO Setup
  function initSocket() {
    state.socket = io();

    state.socket.on('connect', () => {
      console.log('Connected to SoulChill Realtime Server:', state.socket.id);
      if (state.currentUser) {
        state.socket.emit('user_connect', state.currentUser.id);
      }
    });

    // Room events
    state.socket.on('room_message', (msg) => {
      if (!state.currentUser) return;
      appendRoomChatMessage(msg);
    });

    state.socket.on('seat_emoji_broadcast', ({ roomId, seatIndex, emojiId, emojiSvg, emojiName, user }) => {
      if (state.activeRoom && state.activeRoom.id === roomId) {
        displaySeatEmojiReaction(seatIndex, emojiSvg, emojiName);
      }
    });

    state.socket.on('user_role_updated', ({ role, roleTitle, message }) => {
      if (state.currentUser) {
        state.currentUser.role = role;
        localStorage.setItem('soulchill_user', JSON.stringify(state.currentUser));
        updateHeaderUI();
        if (state.currentTab === 'profile') {
          renderProfileTab(document.getElementById('app-main-content'));
        }
        showToast(message || `تم تحديث رتبتك إلى: ${roleTitle || role}! ✨`, 'info');
      }
    });

    state.socket.on('room_presence_sync', ({ audienceCount, audience, pkState, isChatMuted, mutedChatUsers }) => {
      if (mutedChatUsers) state.activeRoomMutedChatUsers = new Set(mutedChatUsers);
      if (audience) renderRoomAudienceStrip(audience);
      const count = audienceCount !== undefined ? audienceCount : (audience ? audience.length : null);
      if (count !== null) {
        const liveAudience = document.getElementById('live-audience-counter');
        if (liveAudience) liveAudience.innerText = count.toString();
        const streamCounter = document.getElementById('stream-viewers-count');
        if (streamCounter) streamCounter.innerText = count.toString();
      }
      if (isChatMuted !== undefined) {
        state.isChatMuted = !!isChatMuted;
        updateRoomChatInputState();
      }
      if (pkState && pkState.active) showPKBattleUI(pkState);
    });

    state.socket.on('user_joined_room', ({ user, audienceCount, audience }) => {
      scheduleFollowingBubbleRefresh();
      if (audience) renderRoomAudienceStrip(audience);
      const count = audienceCount !== undefined ? audienceCount : (audience ? audience.length : null);
      if (count !== null) {
        const liveAudience = document.getElementById('live-audience-counter');
        if (liveAudience) liveAudience.innerText = count.toString();
        const streamCounter = document.getElementById('stream-viewers-count');
        if (streamCounter) streamCounter.innerText = count.toString();
      }
      if (user && user.id !== state.currentUser?.id) {
        showToast(`دخل [${user.name}] إلى الغرفة رحبوا به! 🌟`);
      }
    });

    state.socket.on('user_left_room', ({ userId, audienceCount, audience }) => {
      if (audience) renderRoomAudienceStrip(audience);
      const count = audienceCount !== undefined ? audienceCount : (audience ? audience.length : null);
      if (count !== null) {
        const liveAudience = document.getElementById('live-audience-counter');
        if (liveAudience) liveAudience.innerText = count.toString();
        const streamCounter = document.getElementById('stream-viewers-count');
        if (streamCounter) streamCounter.innerText = count.toString();
      }
    });

    state.socket.on('user_kicked_from_room', ({ roomId, targetUserId, targetUserName, adminName, audienceCount, audience }) => {
      if (state.currentUser && state.currentUser.id === targetUserId) {
        leaveActiveVoiceRoom();
        showNiceNotice({ type: 'danger', icon: '🚪', title: 'تم طردك من الغرفة', message: `قام مدير الغرفة [${adminName}] بطردك من هذه الغرفة` });
        return;
      }
      if (audience) renderRoomAudienceStrip(audience);
      if (audienceCount !== undefined) {
        const liveAudience = document.getElementById('live-audience-counter');
        if (liveAudience) liveAudience.innerText = audienceCount.toString();
        const streamCounter = document.getElementById('stream-viewers-count');
        if (streamCounter) streamCounter.innerText = audienceCount.toString();
      }
      showToast(`قام مدير الغرفة بطرد [${targetUserName}] 🚪`);
    });

    // تحديث الرصيد فورياً عند الشحن من الإدارة (عبر الدردشة أو لوحة التحكم)
    state.socket.on('balance_updated', (b) => {
      if (!b || !state.currentUser) return;
      state.currentUser.coins = b.coins;
      state.currentUser.diamonds = b.diamonds;
      if (b.level != null) state.currentUser.level = b.level;
      try { localStorage.setItem('soulchill_user', JSON.stringify(state.currentUser)); } catch (e) {}
      updateHeaderUI();
      if (b.added && (b.added.coins || b.added.diamonds)) {
        if (window.soundManager && window.soundManager.playCheer) window.soundManager.playCheer();
        showToast('💳 تم شحن رصيدك من الإدارة!');
      }
      if (state.currentTab === 'profile') {
        const area = document.getElementById('app-main-content');
        if (area) renderProfileTab(area);
      }
    });
    // إشعار فوري عند متابعة أحدهم لك
    state.socket.on('new_notification', (n) => {
      if (!n) return;
      setNotifBadge((state.unreadNotifCount || 0) + 1);
      if (n.type === 'follow') showToast(`👤 ${n.actor_name} قام بمتابعتك`);
      const panel = document.getElementById('notifications-panel');
      if (panel && panel._render) panel._render();
    });
    // تحديث عدّادات المتابعين في الملف المفتوح لصاحب الحساب
    state.socket.on('follow_stats_changed', async ({ userId }) => {
      window.dispatchEvent(new CustomEvent('soul:follow-changed', { detail: { userId } }));
      const slot = document.getElementById('my-profile-follow-slot');
      if (slot && slot._applyFollowStats && state.currentUser && state.currentUser.id === userId) {
        slot._applyFollowStats(await fetchFollowStats(userId));
      }
    });

    state.socket.on('room_favorited', ({ roomTitle, userName, fanCount }) => {
      showToast(`❤️ ${userName} أضاف غرفتك "${roomTitle}" إلى المفضلة — عدد المعجبين: ${fanCount}`);
    });

    state.socket.on('room_kicked_notice', ({ message }) => {
      leaveActiveVoiceRoom();
      showNiceNotice({ type: 'danger', icon: '🚫', title: 'لا يمكنك دخول الغرفة', message: (message || 'لقد تم طردك من هذه الغرفة بواسطة الإدارة!').replace(/[🚫🚪]/g, '').trim() });
    });

    state.socket.on('user_chat_mute_changed', ({ targetUserId, targetUserName, isMuted, adminName }) => {
      if (isMuted) {
        state.activeRoomMutedChatUsers.add(targetUserId);
      } else {
        state.activeRoomMutedChatUsers.delete(targetUserId);
      }

      if (state.currentUser && state.currentUser.id === targetUserId) {
        state.isChatMuted = isMuted;
        updateRoomChatInputState();
        showToast(isMuted 
          ? `قام مدير الغرفة (${adminName}) بكتمك من الكتابة في الدردشة العامة! 🔇` 
          : `قام مدير الغرفة (${adminName}) بإلغاء كتم الكتابة عنك! يمكنك المشاركة الآن 🔊`);
      }

      if (state.activeRoomAudience) {
        renderRoomAudienceStrip(state.activeRoomAudience);
      }
    });

    state.socket.on('all_seats_lock_changed', ({ roomId, isLocked, adminName, vacatedUserIds }) => {
      // If seats 1-8 are locked, everyone on seats 1 to 8 must step down immediately and stop audio
      if (isLocked && state.userSeatIndex !== null && state.userSeatIndex > 0) {
        state.userSeatIndex = null;
        state.isMuted = true;
        stopLocalMicCapture();
        if (window.soulRtc) {
          window.soulRtc.stopBroadcastingVoice();
        }
        updateMicButtonUI();
        showToast(`🔒 قام المشرف (${adminName || 'المضيف'}) بقفل جميع المقاعد وإغلاق المايكات.`);
      }

      // Immediately remove and silence all remote audio for vacated users
      if (vacatedUserIds && Array.isArray(vacatedUserIds) && window.soulRtc) {
        vacatedUserIds.forEach(vUserId => {
          window.soulRtc.removeRemoteUserAudio(vUserId);
        });
      }

      if (state.activeRoom && state.activeRoom.seats) {
        state.activeRoom.seats.forEach(s => {
          if (s.seat_index > 0) {
            s.is_locked = isLocked ? 1 : 0;
            if (isLocked && s.user_id !== state.activeRoom.host_id) {
              s.user_id = null;
            }
          }
        });
      }

      for (let i = 1; i <= 8; i++) {
        const seatEl = document.getElementById(`stage-seat-${i}`);
        if (!seatEl) continue;
        if (isLocked) {
          seatEl.classList.remove('occupied');
          seatEl.classList.add('locked');
          seatEl.innerHTML = `
            <div class="seat-avatar-container">
              <span class="seat-empty-plus">🔒</span>
              <div class="seat-number-badge">${i}</div>
            </div>
            <div class="seat-user-name">مقعد مقفل</div>
          `;
        } else {
          seatEl.classList.remove('locked');
          const seat = (state.activeRoom.seats || []).find(s => s.seat_index === i);
          if (!seat || !seat.user_id) {
            seatEl.classList.remove('occupied');
            seatEl.innerHTML = `
              <div class="seat-avatar-container">
                <span class="seat-empty-plus">+</span>
                <div class="seat-number-badge">${i}</div>
              </div>
              <div class="seat-user-name">مقعد فارغ</div>
            `;
          }
        }
      }

      showToast(isLocked 
        ? `قام مدير الغرفة (${adminName || 'المضيف'}) بقفل جميع مقاعد المايك وإغلاق الصوت 🔒` 
        : `قام مدير الغرفة (${adminName || 'المضيف'}) بفتح جميع مقاعد المايك للجمهور 🔓`);
    });

    state.socket.on('chat_error', ({ message }) => {
      showToast(message);
    });

    state.socket.on('seat_updated', ({ seatIndex, user, isMuted }) => {
      updateRoomSeatUI(seatIndex, user, isMuted);
      if (state.activeRoomAudience) renderRoomAudienceStrip(state.activeRoomAudience);
    });

    state.socket.on('seat_mute_changed', ({ seatIndex, userId, isMuted, adminName }) => {
      if (state.activeRoom && state.activeRoom.seats) {
        const seat = state.activeRoom.seats.find(item => item.seat_index === seatIndex);
        if (seat) seat.is_muted = isMuted ? 1 : 0;
      }
      updateSeatMuteUI(seatIndex, isMuted);

      const isMe = (state.currentUser && userId && state.currentUser.id === userId) || (state.userSeatIndex === seatIndex);
      if (isMe) {
        state.isMuted = !!isMuted;
        if (window.soulRtc) {
          window.soulRtc.setVoiceMuted(!!isMuted);
        }
        if (isMuted) {
          broadcastSpeakingStatus(false, 0);
        } else if (state.userSeatIndex === seatIndex && state.activeRoom) {
          // بعد فك كتم المقعد من الإدارة يبدأ مسار الميكروفون فعلياً.
          if (!window.soulRtc || !window.soulRtc.isBroadcastingVoice) {
            startLocalMicCapture();
            if (window.soulRtc) window.soulRtc.startBroadcastingVoice(state.activeRoom.id);
          } else {
            window.soulRtc.setVoiceMuted(false);
          }
        }
        updateMicButtonUI();
        if (adminName) {
          showToast(isMuted 
            ? `🔇 قام مدير الغرفة (${adminName}) بكتم المايك الخاص بك!` 
            : `🎙️ قام مدير الغرفة (${adminName}) بفك الكتم عن المايك الخاص بك!`);
        }
      } else if (userId) {
        // Other participants in room: silence or unmute this user's audio element
        if (window.soulRtc) {
          window.soulRtc.silenceRemoteUser(userId, !!isMuted);
        }
      }
    });

    state.socket.on('user_force_muted', ({ seatIndex, userId, isMuted, adminName }) => {
      const isMe = state.currentUser && state.currentUser.id === userId;
      if (isMe) {
        state.isMuted = !!isMuted;
        if (window.soulRtc) {
          window.soulRtc.setVoiceMuted(!!isMuted);
        }
        if (isMuted) {
          broadcastSpeakingStatus(false, 0);
        } else if (state.userSeatIndex === seatIndex && state.activeRoom) {
          if (!window.soulRtc || !window.soulRtc.isBroadcastingVoice) {
            startLocalMicCapture();
            if (window.soulRtc) window.soulRtc.startBroadcastingVoice(state.activeRoom.id);
          } else {
            window.soulRtc.setVoiceMuted(false);
          }
        }
        updateMicButtonUI();
        showToast(isMuted 
          ? `🔇 تم كتم المايكروفون الخاص بك من قبل الإدارة (${adminName || 'المشرف'})` 
          : `🎙️ تم فك كتم المايك الخاص بك من قبل الإدارة (${adminName || 'المشرف'})`);
      } else if (userId) {
        if (window.soulRtc) {
          window.soulRtc.silenceRemoteUser(userId, !!isMuted);
        }
      }
    });

    state.socket.on('user_speaking_status', ({ userId, isSpeaking }) => {
      toggleSpeakerSoundWaveUI(userId, isSpeaking);
      initVoiceRings();
      if (window.voiceRings) window.voiceRings.setRemoteStatus(userId, isSpeaking);
    });

    state.socket.on('room_gift_sent', (payload) => {
      if (window.giftEffectsEngine) {
        window.giftEffectsEngine.showGiftAnimation(payload.gift, payload.sender, payload.receiver);
        // فرقعة الهدية وإرسالها إلى المقعد الذي يجلس عليه المستلم
        const seatEl = findGiftReceiverSeatEl(payload.receiver);
        if (seatEl) window.giftEffectsEngine.sendGiftToSeat(payload.gift, payload.sender, payload.receiver, seatEl, findGiftSenderSeatEl(payload.sender));
      }
      if (payload && payload.receiver && state.currentUser && payload.receiver.id === state.currentUser.id && state.activeRoom && state.activeRoom.id === payload.room_id) {
        showToast(`🎁 أرسل لك ${payload.sender?.name || 'صديق'} هدية ${payload.gift.name} ${payload.gift.icon}`);
      }
      if (payload && payload.receiver && payload.receiver.id) {
        const openGiftsBoxes = document.querySelectorAll(`.user-received-gifts-box[data-user-id="${payload.receiver.id}"]`);
        openGiftsBoxes.forEach(box => {
          loadAndRenderUserGiftsSection(payload.receiver.id, box, state.currentUser && state.currentUser.id === payload.receiver.id);
        });
      }
    });

    state.socket.on('user_gift_received', (payload) => {
      if (!payload || !payload.receiver) return;
      if (state.currentUser && payload.receiver.id === state.currentUser.id) {
        fetchCurrentUserProfile();
        if (!state.activeRoom || state.activeRoom.id !== payload.room_id) {
          showToast(`🎁 وصلتك هدية "${payload.gift.name}" ${payload.gift.icon} من ${payload.sender?.name || 'صديق'} وتم حفظها في هداياك! ✨`);
        }
      }
      const openGiftsBoxes = document.querySelectorAll(`.user-received-gifts-box[data-user-id="${payload.receiver.id}"]`);
      openGiftsBoxes.forEach(box => {
        loadAndRenderUserGiftsSection(payload.receiver.id, box, state.currentUser && state.currentUser.id === payload.receiver.id);
      });
    });

    state.socket.on('room_entry_effect', ({ user, effectId, imageUrl }) => {
      showRoomEntryEffectBanner(user, effectId, imageUrl);
    });

    state.socket.on('dice_rolled', ({ user, value }) => {
      showDiceRollOverlay(user, value);
    });

    state.socket.on('wheel_spun', ({ user, prize }) => {
      showToast(`🎡 أدار ${user.name} عجلة الحظ وفاز بـ ${prize.label}!`);
    });

    state.socket.on('sound_effect_played', ({ effect, soundName, senderName }) => {
      if (window.soundManager) {
        if (effect === 'applause') window.soundManager.playApplause();
        if (effect === 'cheer') window.soundManager.playCheer();
        if (effect === 'laughter') window.soundManager.playLaughter();
        if (effect === 'drumroll') window.soundManager.playDrumroll();
      }
      showToast(`🎵 ${senderName} شغل صوت: ${soundName}`);
    });

    state.socket.on('pk_started', (pkState) => {
      showPKBattleUI(pkState);
    });

    state.socket.on('pk_timer_tick', ({ timeLeft, hostScore, challengerScore }) => {
      updatePKTimerUI(timeLeft, hostScore, challengerScore);
    });

    state.socket.on('pk_score_updated', ({ hostScore, challengerScore, user, team, points }) => {
      updatePKScoreUI(hostScore, challengerScore, user, team, points);
    });

    state.socket.on('pk_ended', (data) => {
      handlePkRoundEnded(data);
    });

    state.socket.on('pk_ended_manually', () => {
      handlePkRoundEnded(null);
      showToast('تم إنهاء جولة الـ PK من قبل المضيف 🛑');
    });

    // Admin & Moderation Events
    state.socket.on('room_seat_count_changed', ({ roomId, seatCount, maxSeats }) => {
      if (!state.activeRoom || state.activeRoom.id !== roomId) return;
      state.activeRoom.seat_count = seatCount;
      if (maxSeats) state.activeRoom.max_seats = maxSeats;
      for (let i = 1; i <= 15; i++) {
        const el = document.getElementById(`stage-seat-${i}`);
        if (el) el.style.display = i > seatCount ? 'none' : '';
      }
      if (state.userSeatIndex && state.userSeatIndex > seatCount) state.userSeatIndex = null;
    });

    state.socket.on('seat_lock_changed', ({ seatIndex, isLocked, vacatedUserId }) => {
      const seatEl = document.getElementById(`stage-seat-${seatIndex}`);
      if (seatEl) {
        seatEl.classList.toggle('locked', isLocked);
        if (isLocked) {
          seatEl.classList.remove('occupied');
          seatEl.querySelector('.seat-avatar-container').innerHTML = `
            <span class="seat-empty-plus">🔒</span>
            <div class="seat-number-badge">${seatIndex}</div>
          `;
          seatEl.querySelector('.seat-user-name').innerText = 'مقعد مقفل';
        } else {
          seatEl.querySelector('.seat-avatar-container').innerHTML = `
            <span class="seat-empty-plus">+</span>
            <div class="seat-number-badge">${seatIndex}</div>
          `;
          seatEl.querySelector('.seat-user-name').innerText = 'مقعد فارغ';
        }
      }

      if (isLocked) {
        // If current user is on this seat -> Step down immediately and cut hardware audio
        if (state.userSeatIndex === seatIndex) {
          state.userSeatIndex = null;
          state.isMuted = true;
          stopLocalMicCapture();
          if (window.soulRtc) {
            window.soulRtc.stopBroadcastingVoice();
          }
          updateMicButtonUI();
          showToast('🔒 تم قفل مقعدك من قِبل إدارة الغرفة وتم إنزالك للجمهور وإغلاق المايك فوراً.');
        }

        // Clear from active room seats in memory
        if (state.activeRoom && state.activeRoom.seats) {
          const s = state.activeRoom.seats.find(st => st.seat_index === seatIndex);
          if (s) {
            s.is_locked = 1;
            s.user_id = null;
          }
        }

        // Remove remote audio for this user immediately on all clients
        if (vacatedUserId && window.soulRtc) {
          window.soulRtc.removeRemoteUserAudio(vacatedUserId);
        }
      } else {
        if (state.activeRoom && state.activeRoom.seats) {
          const s = state.activeRoom.seats.find(st => st.seat_index === seatIndex);
          if (s) s.is_locked = 0;
        }
      }
    });

    state.socket.on('user_kicked_from_seat', ({ seatIndex, userId, adminName }) => {
      if (state.currentUser && state.currentUser.id === userId) {
        state.userSeatIndex = null;
        state.isMuted = true;
        stopLocalMicCapture();
        if (window.soulRtc) {
          window.soulRtc.stopBroadcastingVoice();
        }
        updateMicButtonUI();
        showToast(`قام مدير الروم (${adminName || 'المضيف'}) بإنزالك من مقعد المايك 🪑`);
      } else if (userId) {
        if (window.soulRtc) {
          window.soulRtc.removeRemoteUserAudio(userId);
        }
      }
    });

    state.socket.on('room_closed_by_host', ({ roomId, adminName }) => {
      if (state.activeRoom && state.activeRoom.id === roomId) {
        leaveActiveVoiceRoom();
        showToast(`أغلق المضيف (${adminName || 'المدير'}) هذه الغرفة 🚪`);
      }
    });

    // 2-Person Co-Host Video Broadcast Events
    state.socket.on('cohost_invitation_received', async ({ roomId, hostUser }) => {
      const accept = await uiConfirm(`المضيف ${hostUser.name} يدعوك للانضمام إلى بث فيديو مشترك ثنائي (Co-Host Live PK)! هل تقبل الدعوة؟`, { icon: '🎉', title: 'دعوة بث مشترك', okText: 'قبول', cancelText: 'رفض' });
      if (accept) {
        state.socket.emit('accept_cohost', {
          roomId,
          cohostUser: state.currentUser
        });
        showToast('تم قبول الدعوة! جارِ تفعيل كاميرتك للانضمام للبث المشترك 📹');
        if (window.triggerCohostSplitView) {
          window.triggerCohostSplitView(state.currentUser);
        }
      }
    });

    state.socket.on('cohost_joined_stream', ({ cohostUser }) => {
      if (window.triggerCohostSplitView) {
        window.triggerCohostSplitView(cohostUser);
      }
    });

    state.socket.on('cohost_left_stream', ({ userId } = {}) => {
      if (window.soulRtc && state.currentUser && userId === state.currentUser.id) {
        window.soulRtc.stopBroadcastingCohost();
      }
      if (window.revertCohostSplitView) {
        window.revertCohostSplitView();
      }
    });

    // Two-Party Mutual PK Battle Challenge Events
    state.socket.on('pk_battle_challenge_received', ({ roomId, challenger }) => {
      if (window.showIncomingPkChallengeModal) {
        window.showIncomingPkChallengeModal(roomId, challenger);
      }
    });

    state.socket.on('pk_battle_challenge_rejected', () => {
      showToast('اعتذر الطرف الآخر عن قبول جولة الـ PK حالياً ✋');
    });

    // Co-host Viewer Request & Host Decision Events
    state.socket.on('cohost_request_received', ({ roomId, requester, requestsCount, requests }) => {
      if (window.handleIncomingCohostRequest) {
        window.handleIncomingCohostRequest(requester, requestsCount, requests);
      }
    });

    state.socket.on('cohost_requests_updated', ({ count, requests }) => {
      if (window.handleCohostRequestsUpdated) {
        window.handleCohostRequestsUpdated(count, requests);
      }
    });

    state.socket.on('cohost_request_accepted', ({ roomId, hostUser }) => {
      showToast(`🎉 وافق المضيف ${hostUser?.name || ''} على طلب صعودك! جارِ تقسيم الشاشة وتفعيل الكاميرا... 📹✨`);
      const btnText = document.getElementById('stream-request-btn-text');
      if (btnText) btnText.innerText = 'على الهواء 🔴';
    });

    state.socket.on('cohost_request_rejected', () => {
      showToast('اعتذر صاحب البث عن قبول طلب الصعود حالياً ✋');
      const btnText = document.getElementById('stream-request-btn-text');
      if (btnText) btnText.innerText = 'طلب صعود (PK)';
    });

    // Supreme Owner Global Announcement
    state.socket.on('global_announcement_broadcast', ({ message }) => {
      showGlobalAnnouncementBanner(message);
    });

    // Voice Match & Blind 5-Min Call Events (SoulChill Planet)
    state.socket.on('voice_match_connected', (data) => {
      openVoiceMatchScreen(data);
    });

    state.socket.on('partner_revealed_identity', () => {
      showToast('🌟 الشريك قام بكشف هويته لك! انقر على "كشف هويتي" لتتحول المكالمة إلى بلا حدود!');
      const revealBtn = document.getElementById('btn-reveal-voice-match-identity');
      if (revealBtn && !revealBtn.classList.contains('revealed')) {
        revealBtn.innerHTML = '<span>🌟 الشريك كشف هويته! اكشف هويتك الآن ➔</span>';
        revealBtn.style.animation = 'buttonPulseGlow 0.8s infinite';
      }
    });

    state.socket.on('voice_match_both_revealed', (payload) => {
      handleVoiceMatchMutualReveal(payload);
    });

    state.socket.on('partner_speaking_status', ({ isSpeaking }) => {
      const partnerCircle = document.getElementById('vmatch-partner-avatar-circle');
      if (partnerCircle) {
        partnerCircle.classList.toggle('speaking', isSpeaking);
      }
    });

    state.socket.on('voice_match_reaction_burst', ({ emoji }) => {
      triggerVoiceMatchReactionBurst(emoji);
    });

    state.socket.on('voice_match_ended', () => {
      closeVoiceMatchScreen(true);
    });

    state.socket.on('voice_match_error', ({ message }) => {
      const radar = document.getElementById('voice-match-radar-modal');
      if (radar) radar.remove();
      showToast(message || 'تعذر التوافق الصوتي حالياً');
    });

    // Realtime Global Rooms Grid Updates (No Refresh Needed!)
    state.socket.on('room_created', ({ room }) => {
      if (!room) return;
      const idx = state.rooms.findIndex(r => r.id === room.id);
      if (idx === -1) {
        state.rooms.unshift(room);
      } else {
        state.rooms[idx] = room;
      }
      if (state.currentTab === 'rooms') {
        applyRoomsFilters();
      }
      showToast(`🎉 تم إنشاء بث/غرفة جديدة: "${room.title}"!`);
    });

    state.socket.on('room_deleted', ({ roomId }) => {
      state.rooms = state.rooms.filter(r => r.id !== roomId);
      if (state.currentTab === 'rooms') {
        applyRoomsFilters();
      }
      if (state.activeRoom && state.activeRoom.id === roomId) {
        leaveActiveVoiceRoom();
        const streamModal = document.getElementById('live-video-broadcast-modal');
        if (streamModal) streamModal.remove();
        showToast('تم إغلاق وحذف هذه الغرفة بواسطة المضيف 🚪');
      }
    });

    // تغيير صورة/اسم/تصنيف غرفة: يظهر فوراً في قائمة الغرف عند الجميع
    state.socket.on('room_meta_updated', (m) => {
      if (!m || !m.id) return;
      const r = state.rooms.find(x => x.id === m.id);
      if (!r) return;
      Object.assign(r, { title: m.title, category: m.category, announcement: m.announcement, cover_image: m.cover_image });
      if (state.currentTab === 'rooms' && document.getElementById('rooms-grid-list')) applyRoomsFilters();
    });
    // تفعيل بطاقة غرفة: نعيد جلب القائمة لتظهر البطاقة الجديدة
    let roomsRefreshTimer = null;
    state.socket.on('rooms_refresh', () => {
      clearTimeout(roomsRefreshTimer);
      roomsRefreshTimer = setTimeout(() => {
        if (state.currentTab === 'rooms' && document.getElementById('rooms-grid-list')) loadRoomsList();
      }, 250);
    });

    state.socket.on('room_updated', ({ room }) => {
      if (!room) return;
      const idx = state.rooms.findIndex(r => r.id === room.id);
      if (idx !== -1) {
        state.rooms[idx] = room;
        if (state.currentTab === 'rooms') {
          applyRoomsFilters();
        }
      }
    });

    // Realtime Accurate Occupant Counts Sync (Lobby & In-Room)
    state.socket.on('room_occupants_updated', ({ roomId, count }) => {
      scheduleFollowingBubbleRefresh();
      const room = state.rooms.find(r => r.id === roomId);
      if (room) room.audience_count = count;
      document.querySelectorAll(`.room-card-audience-count[data-room-id="${roomId}"]`).forEach(el => {
        el.innerText = count.toString();
      });
      // عند عرض دولة محددة نعيد الترتيب فوراً (الأكثر زائرين أولاً)
      if (room && state.currentTab === 'rooms' && state.selectedCountry && state.selectedCountry !== 'all') {
        applyRoomsFilters();
      }
      if (state.activeRoom && state.activeRoom.id === roomId) {
        state.activeRoom.audience_count = count;
        const liveAudience = document.getElementById('live-audience-counter');
        if (liveAudience) liveAudience.innerText = count.toString();
        const streamCounter = document.getElementById('stream-viewers-count');
        if (streamCounter) streamCounter.innerText = count.toString();
      }
    });

    // Global Admin & Moderator Role Sync
    state.socket.on('user_role_updated', ({ role, message }) => {
      if (state.currentUser) {
        state.currentUser.role = role;
        showToast(message || `تم تحديث رتبتك الإدارية إلى: ${role === 'moderator' ? 'مشرف عام 🛡️' : role}`);
        updateHeaderUI();
      }
    });

    // Banned Notice from Admin Control Panel
    state.socket.on('account_banned_notice', ({ message }) => {
      showNiceNotice({ type: 'danger', icon: '⛔', title: 'تم حظر حسابك', message: (message || 'لقد تم حظر حسابك من قبل إدارة التطبيق!').replace(/🚫/g, '').trim(), duration: 9000 });
      handleSignOut();
    });

    // Global Broadcast Broadcast from Admin Panel
    state.socket.on('global_system_broadcast', ({ title, message, sender }) => {
      showGlobalAnnouncementBanner(`📢 [${sender || 'إدارة التطبيق'}]: ${title} - ${message}`);
    });

    // Initialize WebRTC Real Audio/Video Engine
    if (window.soulRtc) {
      window.soulRtc.init(state.socket, state.currentUser);
    }

    // Private Direct Messages
    state.socket.on('private_message', (msg) => {
      if (!state.currentUser) return;
      handleIncomingPrivateMessage(msg);
    });

    // Moments Realtime
    state.socket.on('new_moment', (moment) => {
      state.moments.unshift(moment);
      if (state.currentTab === 'moments') {
        renderMomentsFeed();
      }
    });

    state.socket.on('moment_deleted', ({ momentId }) => {
      state.moments = (state.moments || []).filter(m => m.id !== momentId);
      if (state.currentTab === 'moments') {
        renderMomentsFeed();
      }
    });

    state.socket.on('new_moment_comment', ({ momentId, comment }) => {
      const moment = state.moments.find(m => m.id === momentId);
      if (moment) {
        if (!moment.comments) moment.comments = [];
        moment.comments.push(comment);
        if (state.currentTab === 'moments') {
          renderMomentsFeed();
        }
      }
    });

    // Realtime User Avatar Changed Across All Clients
    state.socket.on('user_avatar_changed', ({ userId, avatar }) => {
      if (state.currentUser && state.currentUser.id === userId) {
        state.currentUser.avatar = avatar;
        localStorage.setItem('soulchill_user', JSON.stringify(state.currentUser));
        updateHeaderUI();
        const profileImg = document.getElementById('profile-page-avatar');
        if (profileImg) profileImg.src = avatar;
      }
      if (state.activeRoomSeats) {
        state.activeRoomSeats.forEach(s => {
          if (s.user && s.user.id === userId) {
            s.user.avatar = avatar;
          }
        });
        renderRoomSeatsGrid(state.activeRoomSeats);
      }
    });
  }

  // 2. Auth State & Google Sign-In
  function requireAuth() {
    if (!state.currentUser || !state.currentUser.id) {
      showGoogleLoginModal();
      showToast('يرجى تسجيل الدخول بحساب Google أو Gmail أولاً ✨');
      return false;
    }
    return true;
  }

  async function checkStoredAuth() {
    const savedUser = localStorage.getItem('soulchill_user');
    const savedToken = localStorage.getItem('soulchill_token') || localStorage.getItem('soulchill_auth_token') || 'device-persistent-token';
    const savedUserId = localStorage.getItem('soulchill_user_id');

    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        if (parsed && parsed.id && parsed.id !== 'undefined' && parsed.id !== 'null') {
          state.currentUser = parsed;
          state.token = savedToken;
          localStorage.setItem('soulchill_user_id', parsed.id);
          localStorage.setItem('soulchill_token', savedToken);
          onUserAuthenticated();
          return;
        }
      } catch (e) {
        console.warn('Could not parse cached user:', e);
      }
    } else if (savedUserId && savedUserId !== 'undefined' && savedUserId !== 'null') {
      try {
        const res = await fetch('/api/users/me', {
          headers: { 'x-user-id': savedUserId }
        });
        if (res.ok) {
          const u = await res.json();
          if (u && u.id) {
            state.currentUser = u;
            state.token = savedToken;
            localStorage.setItem('soulchill_user', JSON.stringify(u));
            localStorage.setItem('soulchill_token', savedToken);
            onUserAuthenticated();
            return;
          }
        }
      } catch (e) {
        console.warn('Could not fetch user by ID:', e);
      }
    }

    // User is NOT logged in (e.g. first visit or logged out):
    state.currentUser = null;
    state.token = null;
    updateHeaderUI();
    switchTab('planet');

    // Display the professional Gmail / Google Login modal immediately
    setTimeout(() => {
      showGoogleLoginModal();
    }, 350);
  }

  function onUserAuthenticated() {
    // Hide auth modal if open
    hideModal('google-auth-modal');

    // Save account in registered device accounts list
    if (state.currentUser && state.currentUser.email) {
      saveDeviceAccount(state.currentUser);
    }

    // Register with Socket
    if (state.socket && state.currentUser) {
      state.socket.emit('user_connect', state.currentUser.id);
    }

    // Update Top Header UI
    updateHeaderUI();

    // Refresh User Profile from DB to ensure freshest stats
    fetchCurrentUserProfile();

    // Load User's Favorite Rooms
    loadFavoriteRooms();

    // Switch to Planet Tab
    switchTab(state.currentTab || 'planet');

    if (state.pendingRoomId) {
      const rid = state.pendingRoomId;
      state.pendingRoomId = null;
      setTimeout(() => openVoiceRoom(rid), 300);
    }

    if (state.currentUser && state.currentUser.name) {
      showToast(`مرحباً بك يا ${state.currentUser.name} في عالم SoulChill! 🪐✨`);
    }
  }

  async function fetchCurrentUserProfile() {
    if (!state.currentUser || !state.currentUser.id) return;
    try {
      const res = await fetch('/api/users/me', {
        headers: { 'x-user-id': state.currentUser.id }
      });
      if (res.ok) {
        state.currentUser = await res.json();
        localStorage.setItem('soulchill_user', JSON.stringify(state.currentUser));
        localStorage.setItem('soulchill_user_id', state.currentUser.id);
        updateHeaderUI();
      }
      // Never wipe localStorage on network latency to guarantee device persistence
    } catch (err) {
      console.warn('Silent profile sync error:', err);
    }
  }

  // Favorite Rooms Helpers ("المفضلة")
  async function loadFavoriteRooms() {
    try {
      const raw = localStorage.getItem('soulchill_favorite_rooms');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          state.favoriteRoomIds = parsed;
        }
      }
    } catch (e) {}

    if (!state.currentUser || !state.currentUser.id) return;
    try {
      const res = await fetch('/api/rooms/favorites', {
        headers: { 'x-user-id': state.currentUser.id }
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.favoriteRoomIds)) {
          const merged = Array.from(new Set([...state.favoriteRoomIds, ...data.favoriteRoomIds]));
          state.favoriteRoomIds = merged;
          localStorage.setItem('soulchill_favorite_rooms', JSON.stringify(merged));
        }
      }
    } catch (err) {
      console.warn('Silent favorite rooms sync error:', err);
    }
  }

  function isRoomFavorited(roomId) {
    if (!roomId) return false;
    if (!Array.isArray(state.favoriteRoomIds)) state.favoriteRoomIds = [];
    return state.favoriteRoomIds.includes(roomId);
  }

  async function toggleFavoriteRoom(roomId, btnEl) {
    if (!roomId) return;
    if (!Array.isArray(state.favoriteRoomIds)) state.favoriteRoomIds = [];

    const currentlyFav = state.favoriteRoomIds.includes(roomId);
    let nowFav = !currentlyFav;

    if (nowFav) {
      state.favoriteRoomIds.push(roomId);
    } else {
      state.favoriteRoomIds = state.favoriteRoomIds.filter(id => id !== roomId);
    }
    localStorage.setItem('soulchill_favorite_rooms', JSON.stringify(state.favoriteRoomIds));

    // Update UI button immediately
    const updateBtnVisual = (el, favState) => {
      if (!el) return;
      el.classList.toggle('favorited', favState);
      el.title = favState ? 'إزالة الغرفة من المفضلة' : 'إضافة الغرفة إلى المفضلة';
      const iconEl = el.querySelector('.fav-heart-icon') || el;
      iconEl.innerText = favState ? '❤️' : '🤍';
    };

    updateBtnVisual(btnEl, nowFav);
    document.querySelectorAll(`.room-fav-heart-btn[data-room-id="${roomId}"], .room-card-fav-btn[data-room-id="${roomId}"]`).forEach(el => {
      updateBtnVisual(el, nowFav);
    });

    showToast(nowFav ? '❤️ تمت إضافة الغرفة إلى المفضلة!' : '🤍 تمت إزالة الغرفة من المفضلة');

    if (state.currentUser && state.currentUser.id) {
      try {
        const res = await fetch(`/api/rooms/${roomId}/favorite`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': state.currentUser.id
          },
          body: JSON.stringify({ user_id: state.currentUser.id })
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.favoriteRoomIds)) {
            state.favoriteRoomIds = data.favoriteRoomIds;
            localStorage.setItem('soulchill_favorite_rooms', JSON.stringify(data.favoriteRoomIds));
          }
        }
      } catch (e) {}
    }

    if (state.currentTab === 'rooms' && state.selectedCategory === 'favorites') {
      applyRoomsFilters();
    }
  }

  // User Received Gifts Wall Renderer ("هداياه")
  async function loadAndRenderUserGiftsSection(userId, containerEl, isSelf = false) {
    if (!userId || !containerEl) return;
    try {
      const res = await fetch(`/api/users/${userId}/gifts`);
      if (!res.ok) throw new Error('Failed to load user gifts');
      const data = await res.json();
      const summary = Array.isArray(data.summary) ? data.summary : [];
      const totalCount = data.totalCount || 0;

      if (summary.length === 0) {
        containerEl.innerHTML = `
          <div class="user-gifts-wall-header">
            <span>🎁 ${isSelf ? 'خزانة هداياي (الهدايا المستلمة)' : 'هداياه المستلمة (خزانة الهدايا)'}</span>
            <span class="user-gifts-count-badge">0 هدية</span>
          </div>
          <div class="user-gifts-empty-state">
            ${isSelf ? 'لم تستلم هدايا بعد.. شارك في الغرف الصوتية واستقبل الهدايا الفاخرة! ✨' : 'لم يستلم هدايا بعد.. كن أول من يهديه الآن! 🎁✨'}
          </div>
        `;
        return;
      }

      containerEl.innerHTML = `
        <div class="user-gifts-wall-header">
          <span>🎁 ${isSelf ? 'خزانة هداياي (الهدايا المستلمة)' : 'هداياه المستلمة (خزانة الهدايا)'}</span>
          <span class="user-gifts-count-badge">${totalCount} هدية</span>
        </div>
        <div class="user-gifts-wall-grid">
          ${summary.map((g, gi) => `
            <div class="user-gift-wall-item" data-gift-idx="${gi}" style="cursor:pointer;" title="${g.gift_name} (العدد: ${g.count})">
              <span class="user-gift-wall-qty">×${g.count}</span>
              <div class="user-gift-wall-icon">${giftIconHtml(g.gift_icon)}</div>
              <div class="user-gift-wall-name">${g.gift_name}</div>
            </div>
          `).join('')}
        </div>
      `;
      containerEl.querySelectorAll('.user-gift-wall-item').forEach(el => {
        el.onclick = () => showGiftDetailsModal(summary[Number(el.dataset.giftIdx)]);
      });
    } catch (err) {
      containerEl.innerHTML = '';
    }
  }

  // نافذة تفاصيل الهدية: الهدية + من أرسلها + الكمية
  function showGiftDetailsModal(g) {
    if (!g) return;
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const old = document.getElementById('gift-details-modal');
    if (old) old.remove();

    const senders = Array.isArray(g.senders) ? g.senders : [];
    const sendersHtml = senders.length ? senders.map(s => `
      <div class="gift-sender-row">
        <img class="gift-sender-avatar" src="${esc(s.sender_avatar || 'avatars/avatar-1.png')}" onerror="this.src='avatars/avatar-1.png'" />
        <div class="gift-sender-name">${esc(s.sender_name)}</div>
        <div class="gift-sender-qty">×${s.qty}</div>
      </div>
    `).join('') : '<div class="user-gifts-empty-state">لا توجد بيانات عن المرسلين</div>';

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'gift-details-modal';
    modal.innerHTML = `
      <div class="soul-modal-content gift-details-box">
        <div class="gift-details-head">
          <div class="gift-details-icon">${giftIconHtml(g.gift_icon)}</div>
          <div class="gift-details-title">${esc(g.gift_name)}</div>
          <div class="gift-details-total">الكمية المستلمة: <b>×${g.count}</b></div>
        </div>
        <div class="gift-details-label">🎁 المرسلون</div>
        <div class="gift-senders-list">${sendersHtml}</div>
        <button type="button" class="soul-submit-btn" id="gift-details-close" style="width:100%;margin-top:12px;padding:10px;">إغلاق</button>
      </div>
    `;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('#gift-details-close').onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
  }

  // شريط المكافأة اليومية: يظهر مرة كل 24 ساعة فقط، ويختفي بعد الاستلام حتى تنتهي الـ24 ساعة
  let dailyBannerTimerId = null;
  function updateDailyBannerVisibility() {
    const strip = document.getElementById('main-daily-banner-strip');
    if (!strip) return;
    if (dailyBannerTimerId) { clearTimeout(dailyBannerTimerId); dailyBannerTimerId = null; }

    const DAY_MS = 24 * 60 * 60 * 1000;
    const last = state.currentUser && state.currentUser.last_checkin ? Date.parse(state.currentUser.last_checkin) : NaN;
    const remaining = Number.isFinite(last) ? DAY_MS - (Date.now() - last) : 0;

    if (remaining > 0) {
      strip.classList.add('daily-claimed');
      // يعود الشريط تلقائياً عند انتهاء الـ24 ساعة إن بقي التطبيق مفتوحاً
      dailyBannerTimerId = setTimeout(updateDailyBannerVisibility, Math.min(remaining + 1000, 2147483000));
    } else {
      strip.classList.remove('daily-claimed');
    }
  }

  function updateHeaderUI() {
    updateDailyBannerVisibility();
    const nid = state.currentUser ? state.currentUser.id : null;
    if (nid !== _notifUserId) { _notifUserId = nid; refreshNotifBadge(); }
    const coinsEl = document.getElementById('header-coins-val');
    const diamondsEl = document.getElementById('header-diamonds-val');
    const avatarEl = document.getElementById('header-user-avatar');
    const adminLinkBtn = document.getElementById('header-admin-link-btn');

    if (adminLinkBtn) {
      adminLinkBtn.style.display = (state.currentUser && canAccessAdminPanel(state.currentUser)) ? 'flex' : 'none';
    }

    if (!state.currentUser) {
      if (coinsEl) coinsEl.innerText = '0';
      if (diamondsEl) diamondsEl.innerText = '0';
      if (avatarEl) {
        avatarEl.src = 'https://api.dicebear.com/7.x/bottts-neutral/svg?seed=GuestSoul';
        avatarEl.className = 'header-user-avatar';
        avatarEl.title = 'تسجيل الدخول عبر Google / Gmail';
      }
      return;
    }

    if (coinsEl) coinsEl.innerText = state.currentUser.coins.toLocaleString();
    if (diamondsEl) diamondsEl.innerText = state.currentUser.diamonds.toLocaleString();
    if (avatarEl) {
      avatarEl.src = state.currentUser.avatar;
      avatarEl.className = `header-user-avatar ${state.currentUser.avatar_frame ? 'avatar-frame-' + state.currentUser.avatar_frame : ''}`;
      avatarEl.title = state.currentUser.name;
    }
  }

  // 3. Tab Navigation
  let planetSphereAnimFrame = null;
  let planetCounterInterval = null;

  function switchTab(tabName) {
    state.currentTab = tabName;

    const appContainer = document.getElementById('main-app-container');
    if (appContainer) {
      appContainer.classList.toggle('tab-planet-active', tabName === 'planet');
      appContainer.classList.toggle('tab-rooms-active', tabName === 'rooms');
      appContainer.classList.toggle('tab-moments-active', tabName === 'moments');
      appContainer.classList.toggle('tab-chat-active', tabName === 'chat');
      appContainer.classList.toggle('tab-profile-active', tabName === 'profile');
    }

    if (tabName !== 'rooms') {
      const fb = document.getElementById('following-bubble');
      if (fb) fb.remove();
      const ic = document.getElementById('interests-center');
      if (ic && tabName !== 'rooms') ic.remove();
    }

    if (tabName !== 'planet') {
      if (planetSphereAnimFrame) {
        cancelAnimationFrame(planetSphereAnimFrame);
        planetSphereAnimFrame = null;
      }
      if (planetCounterInterval) {
        clearInterval(planetCounterInterval);
        planetCounterInterval = null;
      }
    }

    if (tabName === 'chat') {
      state.unreadMessagesCount = 0;
      const navBadge = document.getElementById('nav-chat-unread-badge');
      if (navBadge) {
        navBadge.innerText = '0';
        navBadge.style.display = 'none';
      }
    }

    // Update active nav button
    document.querySelectorAll('.nav-tab-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    const contentArea = document.getElementById('app-main-content');
    if (!contentArea) return;

    if (tabName === 'planet') {
      renderPlanetTab(contentArea);
    } else if (tabName === 'rooms') {
      renderRoomsTab(contentArea);
    } else if (tabName === 'chat') {
      renderChatTab(contentArea);
    } else if (tabName === 'moments') {
      renderMomentsTab(contentArea);
    } else if (tabName === 'profile') {
      renderProfileTab(contentArea);
    }
  }

  // ============================================
  // TAB 1: SOUL PLANET (SOULCHILL 3D SPHERE & VOICE MATCH)
  // ============================================
  let activeVoiceMatchSession = null;
  let voiceMatchTimerInterval = null;
  let voiceMatchSecondsLeft = 300; // 5 minutes
  let isVoiceMatchMuted = false;
  let isVoiceMatchSpeakerOn = true;
  let voiceMatchMicStream = null;
  let voiceMatchAudioContext = null;
  let voiceMatchAnalyser = null;
  let voiceMatchSimInterval = null;

  function toArabicNumerals(num) {
    const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    return String(num).replace(/[0-9]/g, d => arabicDigits[parseInt(d, 10)]);
  }

  function getOrnateSphereFrameSvg(frameStyle) {
    switch (frameStyle) {
      case 'gold_wings':
        return `<svg viewBox="0 0 100 100" class="sphere-ornate-frame-svg">
          <defs>
            <linearGradient id="gwGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#fef08a"/>
              <stop offset="50%" stop-color="#f59e0b"/>
              <stop offset="100%" stop-color="#b45309"/>
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="38" fill="none" stroke="url(#gwGrad)" stroke-width="3.5"/>
          <path d="M12 52 C4 40, 6 24, 20 18 C14 28, 16 40, 22 48 Z" fill="url(#gwGrad)"/>
          <path d="M88 52 C96 40, 94 24, 80 18 C86 28, 84 40, 78 48 Z" fill="url(#gwGrad)"/>
          <path d="M36 14 L43 22 L50 9 L57 22 L64 14 L60 25 L40 25 Z" fill="url(#gwGrad)"/>
          <circle cx="50" cy="11" r="2.5" fill="#ef4444"/>
          <path d="M26 80 Q50 92 74 80" fill="none" stroke="url(#gwGrad)" stroke-width="3" stroke-linecap="round"/>
        </svg>`;
      case 'silver_crystal':
        return `<svg viewBox="0 0 100 100" class="sphere-ornate-frame-svg">
          <defs>
            <linearGradient id="scGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#ffffff"/>
              <stop offset="50%" stop-color="#93c5fd"/>
              <stop offset="100%" stop-color="#3b82f6"/>
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="38" fill="none" stroke="url(#scGrad)" stroke-width="3.2"/>
          <path d="M10 48 C4 34, 12 20, 24 16 C18 28, 16 38, 20 48 Z" fill="url(#scGrad)"/>
          <path d="M90 48 C96 34, 88 20, 76 16 C82 28, 84 38, 80 48 Z" fill="url(#scGrad)"/>
          <polygon points="50,7 55,18 45,18" fill="#e0f2fe"/>
          <polygon points="38,12 44,20 35,21" fill="#93c5fd"/>
          <polygon points="62,12 65,21 56,20" fill="#93c5fd"/>
          <path d="M24 76 Q50 90 76 76" fill="none" stroke="#e0f2fe" stroke-width="3" stroke-linecap="round"/>
        </svg>`;
      case 'purple_floral':
        return `<svg viewBox="0 0 100 100" class="sphere-ornate-frame-svg">
          <defs>
            <linearGradient id="pfGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#f5d0fe"/>
              <stop offset="50%" stop-color="#d946ef"/>
              <stop offset="100%" stop-color="#7e22ce"/>
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="38" fill="none" stroke="url(#pfGrad)" stroke-width="3.5"/>
          <circle cx="20" cy="24" r="5" fill="#f472b6"/>
          <circle cx="80" cy="24" r="5" fill="#f472b6"/>
          <circle cx="50" cy="11" r="5.5" fill="#e879f9"/>
          <circle cx="13" cy="50" r="4" fill="#c084fc"/>
          <circle cx="87" cy="50" r="4" fill="#c084fc"/>
          <path d="M25 80 Q50 92 75 80" fill="none" stroke="url(#pfGrad)" stroke-width="3.5" stroke-linecap="round"/>
        </svg>`;
      case 'emerald_leaf':
        return `<svg viewBox="0 0 100 100" class="sphere-ornate-frame-svg">
          <defs>
            <linearGradient id="elGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#bbf7d0"/>
              <stop offset="50%" stop-color="#4ade80"/>
              <stop offset="100%" stop-color="#15803d"/>
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="38" fill="none" stroke="url(#elGrad)" stroke-width="3.4"/>
          <path d="M12 56 C8 36, 16 20, 30 14 C20 26, 18 42, 20 54 Z" fill="url(#elGrad)"/>
          <path d="M88 56 C92 36, 84 20, 70 14 C80 26, 82 42, 80 54 Z" fill="url(#elGrad)"/>
          <circle cx="50" cy="11" r="4" fill="#fef08a"/>
          <circle cx="36" cy="14" r="3" fill="#f9a8d4"/>
          <circle cx="64" cy="14" r="3" fill="#f9a8d4"/>
        </svg>`;
      default:
        return `<svg viewBox="0 0 100 100" class="sphere-ornate-frame-svg">
          <defs>
            <linearGradient id="rgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#fde68a"/>
              <stop offset="50%" stop-color="#fb923c"/>
              <stop offset="100%" stop-color="#e11d48"/>
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="38" fill="none" stroke="url(#rgGrad)" stroke-width="3.5"/>
          <path d="M34 15 L43 22 L50 10 L57 22 L66 15 L62 25 L38 25 Z" fill="url(#rgGrad)"/>
          <path d="M14 44 C8 32, 14 20, 24 18 C18 28, 18 38, 22 44 Z" fill="url(#rgGrad)"/>
          <path d="M86 44 C92 32, 86 20, 76 18 C82 28, 82 38, 78 44 Z" fill="url(#rgGrad)"/>
        </svg>`;
    }
  }

  async function renderPlanetTab(container) {
    if (planetSphereAnimFrame) {
      cancelAnimationFrame(planetSphereAnimFrame);
      planetSphereAnimFrame = null;
    }
    if (planetCounterInterval) {
      clearInterval(planetCounterInterval);
      planetCounterInterval = null;
    }

    container.innerHTML = `
      <div class="planet-soulchill-screen">
        <!-- Top Header Bar matching SoulChill GIF -->
        <div class="planet-top-bar">
          <!-- Right Side: SoulChill Logo + المؤدي Pill -->
          <div class="planet-top-brand-group">
            <span class="planet-brand-logo-text">SoulChill</span>
            <button class="soul-performer-pill" id="open-soul-test-btn" title="اختبار الروح">
              <span class="soul-performer-orb">
                <svg viewBox="0 0 28 28" width="18" height="18">
                  <defs>
                    <radialGradient id="perfOrbGrad" cx="35%" cy="30%" r="70%">
                      <stop offset="0%" stop-color="#f3e8ff" />
                      <stop offset="50%" stop-color="#c084fc" />
                      <stop offset="100%" stop-color="#581c87" />
                    </radialGradient>
                  </defs>
                  <polygon points="14,2 23,8 25,18 18,26 9,26 3,18 5,8" fill="url(#perfOrbGrad)" stroke="#e9d5ff" stroke-width="0.8"/>
                  <polyline points="5,8 14,13 23,8" fill="none" stroke="#f3e8ff" stroke-width="0.8" opacity="0.7"/>
                  <polyline points="14,13 14,26" fill="none" stroke="#f3e8ff" stroke-width="0.8" opacity="0.7"/>
                </svg>
              </span>
              <span class="soul-performer-text">المؤدي</span>
            </button>
          </div>

          <!-- Left Side: Golden Calendar Check-in & Purple Filter Sliders -->
          <div class="planet-top-actions">
            <button class="notif-bell-btn planet-bell" type="button" title="الإشعارات">🔔<span class="notif-bell-badge" style="display:none;">0</span></button>
            <button class="planet-golden-calendar-btn" id="planet-daily-checkin-btn" title="مكافأة الحضور اليومي">
              <svg viewBox="0 0 32 32" width="24" height="24">
                <defs>
                  <linearGradient id="calGoldGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#fef08a" />
                    <stop offset="50%" stop-color="#facc15" />
                    <stop offset="100%" stop-color="#ca8a04" />
                  </linearGradient>
                </defs>
                <rect x="4" y="6" width="24" height="22" rx="5" fill="url(#calGoldGrad)" stroke="#fef9c3" stroke-width="1"/>
                <rect x="6" y="12" width="20" height="14" rx="3" fill="#fffbeb"/>
                <rect x="9" y="3" width="3" height="5" rx="1.5" fill="#fef08a"/>
                <rect x="20" y="3" width="3" height="5" rx="1.5" fill="#fef08a"/>
                <path d="M12 19.5l2.8 2.8 5.5-5.6" fill="none" stroke="#d97706" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>

            <button class="planet-sliders-filter-btn" id="planet-filter-toggle-btn" title="تصفية الأرواح">
              <svg viewBox="0 0 28 28" width="22" height="22">
                <line x1="4" y1="9" x2="24" y2="9" stroke="#c4b5fd" stroke-width="2.4" stroke-linecap="round"/>
                <circle cx="17" cy="9" r="3.6" fill="#e9d5ff" stroke="#7c3aed" stroke-width="1.5"/>
                <line x1="4" y1="19" x2="24" y2="19" stroke="#c4b5fd" stroke-width="2.4" stroke-linecap="round"/>
                <circle cx="11" cy="19" r="3.6" fill="#e9d5ff" stroke="#7c3aed" stroke-width="1.5"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- 3D Rotating Spherical Souls Galaxy Cluster -->
        <div class="soulers-galaxy-cluster" id="soulers-galaxy-cluster">
          <div class="planet-starfield-layer" id="planet-starfield-layer"></div>
          <div class="soulers-3d-sphere-stage" id="soulers-3d-sphere-stage"></div>
        </div>

        <!-- Online Souls Counter (Exact match to GIF: عدد المستخدمين الاونلاين 540413) -->
        <div class="online-soulers-counter">
          <span class="counter-wing right-wing"></span>
          <span class="online-counter-label">عدد المستخدمين الاونلاين</span>
          <strong id="online-soulers-counter-num">540413</strong>
          <span class="counter-wing left-wing"></span>
        </div>

        <!-- First Top-Up / Recharge Rewards Banner (مكافآت الشحنة الاولى <) -->
        <div class="first-recharge-banner" id="planet-one-time-offer-btn">
          <div class="first-recharge-text-side">
            <span class="first-recharge-title">مكافآت الشحنة الاولى</span>
            <span class="first-recharge-chevron">‹</span>
          </div>

          <!-- 3D Purple Gift Box with White Ribbon Bow on the Left -->
          <div class="first-recharge-gift-illustration">
            <svg viewBox="0 0 120 96" width="96" height="78">
              <defs>
                <linearGradient id="boxFrontGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#c084fc" />
                  <stop offset="100%" stop-color="#7e22ce" />
                </linearGradient>
                <linearGradient id="boxSideGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#9333ea" />
                  <stop offset="100%" stop-color="#581c87" />
                </linearGradient>
                <linearGradient id="boxLidGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#e9d5ff" />
                  <stop offset="100%" stop-color="#a855f7" />
                </linearGradient>
                <linearGradient id="ribbonWhiteGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#ffffff" />
                  <stop offset="60%" stop-color="#f3e8ff" />
                  <stop offset="100%" stop-color="#d8b4fe" />
                </linearGradient>
              </defs>
              <!-- Sparkles -->
              <circle cx="18" cy="22" r="2" fill="#fff" opacity="0.8"/>
              <circle cx="104" cy="18" r="1.8" fill="#f5d0fe" opacity="0.7"/>
              <circle cx="96" cy="68" r="1.5" fill="#fff" opacity="0.6"/>
              <g transform="rotate(-8 60 54)">
                <!-- Gift Box Base 3D -->
                <polygon points="24,44 64,52 64,90 24,80" fill="url(#boxSideGrad)" />
                <polygon points="64,52 100,42 100,78 64,90" fill="url(#boxFrontGrad)" />
                <!-- White Vertical Ribbons on Box Body -->
                <polygon points="40,47 48,49 48,86 40,84" fill="url(#ribbonWhiteGrad)" />
                <polygon points="79,48 87,45 87,82 79,85" fill="url(#ribbonWhiteGrad)" />
                <!-- Gift Box Lid 3D -->
                <polygon points="20,34 64,43 64,54 20,44" fill="url(#boxFrontGrad)" />
                <polygon points="64,43 104,32 104,43 64,54" fill="url(#boxLidGrad)" />
                <polygon points="20,34 60,24 104,32 64,43" fill="#d8b4fe" />
                <!-- White Ribbon on Lid -->
                <polygon points="38,38 47,40 47,50 38,48" fill="#ffffff" />
                <polygon points="80,38 89,36 89,47 80,49" fill="#ffffff" />
                <!-- Big 3D White Silk Bow on Top -->
                <path d="M62,33 C46,12 28,18 38,32 C44,36 54,35 62,33 Z" fill="url(#ribbonWhiteGrad)" stroke="#f3e8ff" stroke-width="1"/>
                <path d="M62,33 C78,10 96,18 86,31 C80,35 70,35 62,33 Z" fill="url(#ribbonWhiteGrad)" stroke="#f3e8ff" stroke-width="1"/>
                <path d="M56,33 L46,45 L54,46 L62,35 Z" fill="#f3e8ff"/>
                <path d="M66,33 L76,44 L68,46 L62,35 Z" fill="#ffffff"/>
                <ellipse cx="62" cy="32" rx="6" ry="4.5" fill="#ffffff" />
              </g>
            </svg>
          </div>
        </div>

        <!-- 2x2 Feature Cards Grid matching GIF -->
        <div class="planet-2x2-cards-grid">
          <!-- Card 1 (Top-Right in RTL): مكالمة صوتية -->
          <div class="planet-feature-card" id="planet-card-voice-match">
            <div class="planet-card-top-pill speed-pill">
              <span>بطاقة التسريع جاهزة للاستخدام</span>
              <span class="pill-bolt">⚡</span>
            </div>
            <div class="planet-card-header">
              <div class="planet-card-title">مكالمة صوتية</div>
              <div class="planet-card-sub">انضم لقائمة المكالمات</div>
            </div>
            <div class="planet-card-footer">
              <button type="button" class="planet-card-start-btn">
                <span>إبدأ</span>
                <span class="start-arrow">◂</span>
              </button>
              <div class="planet-card-3d-icon">
                <!-- 3D Glowing Cyan/Blue Ringed Planet -->
                <svg viewBox="0 0 80 70" width="66" height="58">
                  <defs>
                    <radialGradient id="cyanPlanetGrad" cx="35%" cy="30%" r="70%">
                      <stop offset="0%" stop-color="#a7f3d0" />
                      <stop offset="38%" stop-color="#38bdf8" />
                      <stop offset="75%" stop-color="#2563eb" />
                      <stop offset="100%" stop-color="#1e1b4b" />
                    </radialGradient>
                    <linearGradient id="cyanRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#cbd5e1" stop-opacity="0.85" />
                      <stop offset="50%" stop-color="#38bdf8" stop-opacity="0.35" />
                      <stop offset="100%" stop-color="#94a3b8" stop-opacity="0.8" />
                    </linearGradient>
                  </defs>
                  <ellipse cx="40" cy="36" rx="35" ry="11" fill="none" stroke="url(#cyanRingGrad)" stroke-width="5" transform="rotate(-18 40 36)" opacity="0.75" />
                  <circle cx="40" cy="35" r="20" fill="url(#cyanPlanetGrad)" />
                  <path d="M23 30 Q40 24 57 31" fill="none" stroke="#bae6fd" stroke-width="2" opacity="0.45" />
                  <path d="M21 39 Q40 33 59 40" fill="none" stroke="#7dd3fc" stroke-width="1.6" opacity="0.35" />
                  <path d="M8 46 A35 11 0 0 0 72 26" fill="none" stroke="url(#cyanRingGrad)" stroke-width="4.5" transform="rotate(-18 40 36)" />
                </svg>
              </div>
            </div>
          </div>

          <!-- Card 2 (Top-Left in RTL): رفيق الروح -->
          <div class="planet-feature-card" id="planet-card-soul-match">
            <div class="planet-card-header">
              <div class="planet-card-title">رفيق الروح</div>
              <div class="planet-card-sub">تحدث مع من يفهمك</div>
            </div>
            <div class="planet-card-footer">
              <span class="planet-card-remaining">تبقى 2</span>
              <div class="planet-card-3d-icon">
                <!-- 3D Glowing Pink/Magenta Heart Padlock & Silver Key -->
                <svg viewBox="0 0 84 70" width="68" height="58">
                  <defs>
                    <radialGradient id="heartLockGrad" cx="35%" cy="30%" r="70%">
                      <stop offset="0%" stop-color="#f5d0fe" />
                      <stop offset="45%" stop-color="#e879f9" />
                      <stop offset="80%" stop-color="#a21caf" />
                      <stop offset="100%" stop-color="#581c87" />
                    </radialGradient>
                    <linearGradient id="silverShackleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#ffffff" />
                      <stop offset="50%" stop-color="#e2e8f0" />
                      <stop offset="100%" stop-color="#94a3b8" />
                    </linearGradient>
                  </defs>
                  <g transform="rotate(-12 36 38)">
                    <!-- Padlock Shackle -->
                    <path d="M25 28 V19 A9 9 0 0 1 43 19 V28" fill="none" stroke="url(#silverShackleGrad)" stroke-width="4.2" stroke-linecap="round" />
                    <!-- 3D Heart Body -->
                    <path d="M34 56 C34 56 14 44 14 30 C14 22 21 18 28 22 C31 24 33 26 34 28 C35 26 37 24 40 22 C47 18 54 22 54 30 C54 44 34 56 34 56 Z" fill="url(#heartLockGrad)" stroke="#f5d0fe" stroke-width="0.8" />
                    <!-- Keyhole -->
                    <circle cx="34" cy="36" r="2.8" fill="#3b0764" />
                    <path d="M33 38 L32 44 L36 44 L35 38 Z" fill="#3b0764" />
                  </g>
                  <!-- Silver Key on the Right -->
                  <g transform="translate(44, 30) rotate(-18)">
                    <line x1="0" y1="8" x2="18" y2="8" stroke="url(#silverShackleGrad)" stroke-width="3.2" stroke-linecap="round" />
                    <line x1="3" y1="8" x2="3" y2="13" stroke="url(#silverShackleGrad)" stroke-width="2.5" stroke-linecap="round" />
                    <line x1="8" y1="8" x2="8" y2="12" stroke="url(#silverShackleGrad)" stroke-width="2.5" stroke-linecap="round" />
                    <circle cx="22" cy="8" r="5.5" fill="none" stroke="url(#silverShackleGrad)" stroke-width="3.2" />
                  </g>
                </svg>
              </div>
            </div>
          </div>

          <!-- Card 3 (Bottom-Right in RTL): الأحداث -->
          <div class="planet-feature-card" id="planet-card-events">
            <div class="planet-card-top-pill blue-pill">
              <span>مكافآت وتحديات يومية</span>
              <span class="pill-bolt">🔥</span>
            </div>
            <div class="planet-card-header">
              <div class="planet-card-title">الأحداث</div>
              <div class="planet-card-sub">شارك واربح جوائز قيمة</div>
            </div>
            <div class="planet-card-footer">
              <button type="button" class="planet-card-start-btn">
                <span>إبدأ</span>
                <span class="start-arrow">◂</span>
              </button>
              <div class="planet-card-3d-icon">
                <svg viewBox="0 0 80 70" width="62" height="54">
                  <defs>
                    <radialGradient id="goldStarGrad" cx="35%" cy="30%" r="70%">
                      <stop offset="0%" stop-color="#fef9c3" />
                      <stop offset="50%" stop-color="#facc15" />
                      <stop offset="100%" stop-color="#b45309" />
                    </radialGradient>
                  </defs>
                  <circle cx="38" cy="36" r="19" fill="#312e81" stroke="#818cf8" stroke-width="1.5" />
                  <polygon points="38,17 43,29 56,30 46,39 49,51 38,44 27,51 30,39 20,30 33,29" fill="url(#goldStarGrad)" />
                </svg>
              </div>
            </div>
          </div>

          <!-- Card 4 (Bottom-Left in RTL): غرف الدردشة -->
          <div class="planet-feature-card" id="planet-card-party">
            <div class="planet-card-header">
              <div class="planet-card-title">غرف الدردشة</div>
              <div class="planet-card-sub">تحدث واستمتع مع الأصدقاء</div>
            </div>
            <div class="planet-card-footer">
              <button type="button" class="planet-card-start-btn">
                <span>إبدأ</span>
                <span class="start-arrow">◂</span>
              </button>
              <div class="planet-card-3d-icon">
                <svg viewBox="0 0 80 70" width="62" height="54">
                  <defs>
                    <linearGradient id="micPartyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#f472b6" />
                      <stop offset="50%" stop-color="#a855f7" />
                      <stop offset="100%" stop-color="#6366f1" />
                    </linearGradient>
                  </defs>
                  <rect x="29" y="14" width="18" height="26" rx="9" fill="url(#micPartyGrad)" />
                  <path d="M23 30 A15 15 0 0 0 53 30" fill="none" stroke="#e9d5ff" stroke-width="3" stroke-linecap="round" />
                  <line x1="38" y1="45" x2="38" y2="54" stroke="#e9d5ff" stroke-width="3" stroke-linecap="round" />
                  <line x1="29" y1="54" x2="47" y2="54" stroke="#e9d5ff" stroke-width="3" stroke-linecap="round" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Initialize Starfield in the Galaxy Cluster
    initPlanetStarfield();

    // Load users and populate 3D rotating sphere
    try {
      const res = await fetch('/api/users');
      state.allUsers = await res.json();
      populateSoulGalaxyCluster();
    } catch (err) {
      console.error('Error fetching users for galaxy:', err);
      populateSoulGalaxyCluster();
    }

    // Dynamic Online Soulers counter fluctuation around 540413
    const counterEl = container.querySelector('#online-soulers-counter-num');
    if (counterEl) {
      let count = 540413;
      planetCounterInterval = setInterval(() => {
        const el = document.getElementById('online-soulers-counter-num');
        if (!el) return;
        count += Math.floor(Math.random() * 5) - 2;
        el.innerText = String(count);
      }, 3500);
    }

    // Wire Card Clicks
    const voiceMatchCard = container.querySelector('#planet-card-voice-match');
    if (voiceMatchCard) {
      voiceMatchCard.onclick = () => startVoiceMatchSession('voice');
    }

    const soulMatchCard = container.querySelector('#planet-card-soul-match');
    if (soulMatchCard) {
      soulMatchCard.onclick = () => startVoiceMatchSession('soul');
    }

    const partyCard = container.querySelector('#planet-card-party');
    if (partyCard) {
      partyCard.onclick = () => switchTab('rooms');
    }

    const eventsCard = container.querySelector('#planet-card-events');
    if (eventsCard) {
      eventsCard.onclick = () => showPlanetEventsModal();
    }

    const soulTestBtn = container.querySelector('#open-soul-test-btn');
    if (soulTestBtn) {
      soulTestBtn.onclick = () => showSoulTestModal();
    }

    const offerBanner = container.querySelector('#planet-one-time-offer-btn');
    if (offerBanner) {
      offerBanner.onclick = () => showOneTimeOfferModal();
    }

    const dailyCheckinBtn = container.querySelector('#planet-daily-checkin-btn');
    if (dailyCheckinBtn) {
      dailyCheckinBtn.onclick = () => handleDailyCheckIn();
    }

    const filterBtn = container.querySelector('#planet-filter-toggle-btn');
    if (filterBtn) {
      let filterMode = 0; // 0: all, 1: high match, 2: same planet
      const modes = ['جميع الأرواح 🪐', 'توافق عالي +٨٢٪ 🔥', 'نفس كوكبي 🌌'];
      filterBtn.onclick = () => {
        filterMode = (filterMode + 1) % modes.length;
        showToast(`فلترة المجرة: ${modes[filterMode]}`);
        populateSoulGalaxyCluster(true, filterMode);
      };
    }
  }

  function initPlanetStarfield() {
    const starLayer = document.getElementById('planet-starfield-layer');
    if (!starLayer) return;
    starLayer.innerHTML = '';
    for (let i = 0; i < 42; i++) {
      const star = document.createElement('span');
      star.className = 'planet-bg-star';
      const size = (Math.random() * 2.2 + 1).toFixed(1);
      star.style.width = `${size}px`;
      star.style.height = `${size}px`;
      star.style.left = `${(Math.random() * 96 + 2).toFixed(1)}%`;
      star.style.top = `${(Math.random() * 94 + 3).toFixed(1)}%`;
      star.style.animationDelay = `${(Math.random() * 4).toFixed(2)}s`;
      star.style.animationDuration = `${(Math.random() * 2.5 + 2).toFixed(2)}s`;
      starLayer.appendChild(star);
    }
  }

  // Populate 3D Rotating Sphere of Soul Avatars matching GIF
  function populateSoulGalaxyCluster(reshuffle = false, filterMode = 0) {
    const stage = document.getElementById('soulers-3d-sphere-stage');
    if (!stage) return;

    if (planetSphereAnimFrame) {
      cancelAnimationFrame(planetSphereAnimFrame);
      planetSphereAnimFrame = null;
    }

    // Authentic SoulChill users matching the names, frames, and percentages in the GIF
    const mockSoulers = [
      { id: 'souler-1', name: '🇯🇴 كـينـدا', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80', sphere_frame: 'gold_wings', avatar_frame: 'royal_gold', soul_planet: 'كوكب الرومانسي الحالم 🌌', bio: 'أحب الموسيقى والضحك واللقاءات الرايقة', matchRate: 84 },
      { id: 'souler-2', name: 'مـوناليزا...', avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=300&q=80', sphere_frame: 'gold_wings', avatar_frame: 'fire_dragon', soul_planet: 'كوكب الفنان الملهم 🎨', bio: 'الجمال في التفاصيل الصغيرة ✨', matchRate: 83 },
      { id: 'souler-3', name: 'ملك', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80', sphere_frame: 'gold_wings', avatar_frame: 'royal_gold', soul_planet: 'كوكب الرومانسي الحالم 🌌', bio: 'أهلاً بالجميع في كوكبي الملكي 👑', matchRate: 80 },
      { id: 'souler-4', name: 'حنان S...', avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=300&q=80', sphere_frame: 'gold_wings', avatar_frame: 'royal_gold', soul_planet: 'كوكب الفيلسوف الحكيم 🔮', bio: 'هدوء الليل والقهوة ☕', matchRate: 83 },
      { id: 'souler-5', name: 'SaMo...', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80', sphere_frame: 'silver_crystal', avatar_frame: 'cyber_neon', soul_planet: 'كوكب المغامر الشجاع 🚀', bio: 'عشاق السفر والمغامرات', matchRate: 83 },
      { id: 'souler-6', name: 'مشاكس...', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80', sphere_frame: 'silver_crystal', avatar_frame: 'cyber_neon', soul_planet: 'كوكب المرح والبهجة 🎈', bio: 'سوالف ووناسة ٢٤ ساعة 🔥', matchRate: 80 },
      { id: 'souler-7', name: 'ANG7...', avatar: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=300&q=80', sphere_frame: 'purple_floral', avatar_frame: 'galaxy_halo', soul_planet: 'كوكب الرومانسي الحالم 🌌', bio: 'موسيقى وسهر مع الأصدقاء 🎶', matchRate: 80 },
      { id: 'souler-8', name: 'الجوهر...', avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=300&q=80', sphere_frame: 'purple_floral', avatar_frame: 'galaxy_halo', soul_planet: 'كوكب الفيلسوف الحكيم 🔮', bio: 'الكلمة الطيبة جواز سفر للقلوب', matchRate: 83 },
      { id: 'souler-9', name: 'لانا (٠٠٠)', avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=300&q=80', sphere_frame: 'purple_floral', avatar_frame: 'angel_wings', soul_planet: 'كوكب الرومانسي الحالم 🌌', bio: 'أحب الهدوء والنجوم 🌙', matchRate: 83 },
      { id: 'souler-10', name: 'ريـتاج', avatar: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=300&q=80', sphere_frame: 'emerald_leaf', avatar_frame: 'angel_wings', soul_planet: 'كوكب النسمة الهادئة 🍃', bio: 'صباحات جميلة وروح صافية 🌸', matchRate: 83 },
      { id: 'souler-11', name: 'نـور ❀', avatar: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=300&q=80', sphere_frame: 'gold_wings', avatar_frame: 'royal_gold', soul_planet: 'كوكب الفنان الملهم 🎨', bio: 'عاشقة الفن والموسيقى 🎨', matchRate: 81 },
      { id: 'souler-12', name: '✨ Sok...', avatar: 'https://images.unsplash.com/photo-1534308983496-4fabb1a015ee?auto=format&fit=crop&w=300&q=80', sphere_frame: 'rose_crown', avatar_frame: 'fire_dragon', soul_planet: 'كوكب المغامر الشجاع 🚀', bio: 'طاقة إيجابية وأجواء حماسية', matchRate: 83 },
      { id: 'souler-13', name: 'هاجر...', avatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=300&q=80', sphere_frame: 'purple_floral', avatar_frame: 'galaxy_halo', soul_planet: 'كوكب الرومانسي الحالم 🌌', bio: 'أهلاً بالجميع في عالمي 💜', matchRate: 80 },
      { id: 'souler-14', name: '💎 وكـ K', avatar: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=300&q=80', sphere_frame: 'gold_wings', avatar_frame: 'royal_gold', soul_planet: 'كوكب الإمبراطور الفلكي 👑', bio: 'الفخامة عنواننا 👑', matchRate: 79 },
      { id: 'souler-15', name: '..The', avatar: 'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?auto=format&fit=crop&w=300&q=80', sphere_frame: 'silver_crystal', avatar_frame: 'cyber_neon', soul_planet: 'كوكب الفيلسوف الحكيم 🔮', bio: 'سوالف رايقة وموسيقى هادئة', matchRate: 82 },
      { id: 'souler-16', name: '🎀 سما', avatar: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=300&q=80', sphere_frame: 'purple_floral', avatar_frame: 'angel_wings', soul_planet: 'كوكب الرومانسي الحالم 🌌', bio: 'الحياة أجمل مع الأصدقاء', matchRate: 80 },
      { id: 'souler-17', name: 'لوليتا 🖤', avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=300&q=80', sphere_frame: 'gold_wings', avatar_frame: 'royal_gold', soul_planet: 'كوكب الرومانسي الحالم 🌌', bio: 'سهر وطرب وأجواء فخمة', matchRate: 84 },
      { id: 'souler-18', name: 'دهـ🌺ـب', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=300&q=80', sphere_frame: 'silver_crystal', avatar_frame: 'cyber_neon', soul_planet: 'كوكب النسمة الهادئة 🍃', bio: 'قلوب صافية وأرواح متآلفة', matchRate: 83 },
      { id: 'souler-19', name: 'سـارة 🔮', avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=300&q=80', sphere_frame: 'emerald_leaf', avatar_frame: 'angel_wings', soul_planet: 'كوكب الفيلسوف الحكيم 🔮', bio: 'أبراج وفلك وسوالف السول', matchRate: 82 },
      { id: 'souler-20', name: 'طـارق 🎸', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80', sphere_frame: 'silver_crystal', avatar_frame: 'cyber_neon', soul_planet: 'كوكب المغامر الشجاع 🚀', bio: 'عزف جيتار وغناء مباشر', matchRate: 84 }
    ];

    let allSouls = [...mockSoulers];
    if (state.allUsers && state.allUsers.length > 0) {
      const frameChoices = ['gold_wings', 'silver_crystal', 'purple_floral', 'emerald_leaf', 'rose_crown'];
      state.allUsers.forEach((u, idx) => {
        if (state.currentUser && u.id === state.currentUser.id) return;
        if (!allSouls.find(s => s.id === u.id) && allSouls.length < 24) {
          allSouls.push({
            id: u.id,
            name: u.name.length > 10 ? u.name.slice(0, 9) + '...' : u.name,
            avatar: u.avatar || '/avatars/avatar-1.png',
            sphere_frame: frameChoices[idx % frameChoices.length],
            avatar_frame: u.avatar_frame || 'royal_gold',
            soul_planet: u.soul_planet || 'كوكب الروح 🌌',
            bio: u.bio || 'روح رائعة في SoulChill',
            matchRate: 79 + (idx % 6)
          });
        }
      });
    }

    if (filterMode === 1) {
      allSouls = allSouls.filter(s => s.matchRate >= 82);
    } else if (filterMode === 2 && state.currentUser) {
      const filtered = allSouls.filter(s => s.soul_planet === state.currentUser.soul_planet);
      if (filtered.length >= 8) allSouls = filtered;
    }

    if (allSouls.length < 44) {
      const base = [...allSouls];
      let k = 0;
      while (allSouls.length < 44) {
        const b = base[k % base.length];
        allSouls.push({ ...b, id: `${b.id}-d${k}`, matchRate: 78 + ((k * 3) % 8) });
        k++;
      }
    }

    stage.innerHTML = '';

    const count = allSouls.length;
    const sphereNodes = [];
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    for (let i = 0; i < count; i++) {
      const souler = allSouls[i];
      // Fibonacci sphere 3D unit coordinates (-1..1)
      const y = 1 - (i / (count - 1)) * 2;
      const radiusAtY = Math.sqrt(1 - y * y);
      const theta = goldenAngle * i + (reshuffle ? Math.random() * 0.8 : 0);
      const x = Math.cos(theta) * radiusAtY;
      const z = Math.sin(theta) * radiusAtY;

      const itemEl = document.createElement('div');
      itemEl.className = 'souler-sphere-node';

      const arabicPercent = `${toArabicNumerals(souler.matchRate)}٪`;
      const ornateFrameSvg = getOrnateSphereFrameSvg(souler.sphere_frame);

      itemEl.innerHTML = `
        <div class="souler-sphere-avatar-wrap">
          <img src="${souler.avatar}" class="souler-sphere-img" onerror="this.onerror=null; this.src='/avatars/avatar-1.png';" />
          ${ornateFrameSvg}
        </div>
        <div class="souler-sphere-name">${souler.name}</div>
        <div class="souler-sphere-match-pill">${arabicPercent}</div>
      `;

      itemEl.onclick = (e) => {
        e.stopPropagation();
        if (window.soundManager) window.soundManager.playClick();
        openSoulProfileCard(souler, souler.matchRate);
      };

      stage.appendChild(itemEl);
      sphereNodes.push({ el: itemEl, x, y, z, nameEl: itemEl.querySelector('.souler-sphere-name'), pillEl: itemEl.querySelector('.souler-sphere-match-pill'), shown: null, seed: i * 1.7 });
    }

    // 3D Rotation State & Interactive Dragging
    let rotY = 0;
    let rotX = 0.22;
    const rotZ = -0.3; // ميل المحور ليظهر الدوران بشكل قطري مثل الفيديو
    let velY = -0.0032; // Smooth continuous rotation matching GIF
    let velX = 0;
    let isDragging = false;
    let lastClientX = 0;
    let lastClientY = 0;

    const onPointerDown = (e) => {
      isDragging = true;
      lastClientX = e.touches ? e.touches[0].clientX : e.clientX;
      lastClientY = e.touches ? e.touches[0].clientY : e.clientY;
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = clientX - lastClientX;
      const dy = clientY - lastClientY;
      lastClientX = clientX;
      lastClientY = clientY;
      rotY += dx * 0.007;
      rotX = Math.max(-0.5, Math.min(0.5, rotX - dy * 0.005));
      velY = dx * 0.0012 || -0.0032;
    };

    const onPointerUp = () => {
      isDragging = false;
      if (Math.abs(velY) < 0.003) velY = -0.0032;
    };

    stage.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    stage.addEventListener('touchstart', onPointerDown, { passive: true });
    stage.addEventListener('touchmove', onPointerMove, { passive: true });
    stage.addEventListener('touchend', onPointerUp, { passive: true });

    const renderSphereFrame = () => {
      if (!document.getElementById('soulers-3d-sphere-stage')) return;

      if (!isDragging) {
        rotY += velY;
        velY += (-0.0032 - velY) * 0.03;
      }

      const rect = stage.getBoundingClientRect();
      const rxRadius = (rect.width || 360) * 0.52;
      const ryRadius = (rect.height || 380) * 0.44;
      const cosZ = Math.cos(rotZ);
      const sinZ = Math.sin(rotZ);
      const tNow = performance.now() * 0.0011;

      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);

      for (let i = 0; i < sphereNodes.length; i++) {
        const n = sphereNodes[i];
        // Rotate around Y
        const x1 = n.x * cosY - n.z * sinY;
        const z1 = n.z * cosY + n.x * sinY;
        // Rotate around X
        const y2 = n.y * cosX - z1 * sinX;
        const z2 = z1 * cosX + n.y * sinX;

        // العمق: 0 (الخلف) إلى 1 (الأمام)
        const depth = (z2 + 1) / 2;
        const scale = (0.26 + Math.pow(depth, 1.25) * 0.9).toFixed(3);
        const opacity = (0.07 + Math.pow(depth, 2) * 0.93).toFixed(3);
        const zIdx = Math.round(depth * 100);

        // ميل المحور + حركة طفو خفيفة لكل صورة
        const xr = x1 * cosZ - y2 * sinZ;
        const yr = x1 * sinZ + y2 * cosZ;
        const px = (xr * rxRadius + Math.sin(tNow + n.seed) * 3).toFixed(1);
        const py = (yr * ryRadius + Math.cos(tNow * 0.9 + n.seed) * 3).toFixed(1);

        n.el.style.transform = `translate3d(calc(-50% + ${px}px), calc(-50% + ${py}px), 0) scale(${scale})`;
        n.el.style.opacity = opacity;
        n.el.style.zIndex = zIdx;
        n.el.style.filter = depth < 0.4 ? `blur(${((0.4 - depth) * 3.5).toFixed(1)}px)` : '';

        // الاسم والشارة تظهر للصور الأمامية فقط
        const showText = depth > 0.55;
        if (n.shown !== showText) {
          n.shown = showText;
          if (n.nameEl) n.nameEl.style.opacity = showText ? '1' : '0';
          if (n.pillEl) n.pillEl.style.opacity = showText ? '1' : '0';
        }
      }

      planetSphereAnimFrame = requestAnimationFrame(renderSphereFrame);
    };

    renderSphereFrame();

    // تصغير الكوكب وتلاشيه أثناء تمرير الصفحة للأسفل
    const scroller = document.getElementById('app-main-content');
    const cluster = document.getElementById('soulers-galaxy-cluster');
    if (window._planetScrollHandler && window._planetScrollTarget) {
      window._planetScrollTarget.removeEventListener('scroll', window._planetScrollHandler);
    }
    if (scroller && cluster) {
      const onScroll = () => {
        const p = Math.max(0, Math.min(1, scroller.scrollTop / 260));
        cluster.style.transformOrigin = '50% 0%';
        cluster.style.transform = `translateY(${(p * 70).toFixed(1)}px) scale(${(1 - p * 0.6).toFixed(3)})`;
        cluster.style.opacity = (1 - p * 1.05).toFixed(3);
      };
      scroller.addEventListener('scroll', onScroll, { passive: true });
      window._planetScrollHandler = onScroll;
      window._planetScrollTarget = scroller;
      onScroll();
    }
  }

  // Common Profile Card Modal
  // ============================================
  // نظام المتابعة + الإشعارات
  // ============================================
  const fEsc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const followHeaders = () => ({ 'x-user-id': state.currentUser ? state.currentUser.id : '' });

  async function fetchFollowStats(userId) {
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(userId)}/follow-stats`, { headers: followHeaders() });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  async function setFollow(userId, follow) {
    if (!state.currentUser) { showGoogleLoginModal(); return null; }
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(userId)}/follow`, {
        method: follow ? 'POST' : 'DELETE',
        headers: followHeaders()
      });
      const data = await res.json();
      if (!res.ok || !data.success) { showToast(data.error || 'تعذر تنفيذ العملية'); return null; }
      return data;
    } catch (e) { showToast('تعذر الاتصال بالسيرفر'); return null; }
  }

  function followBtnLabel(isFollowing, followsMe) {
    if (isFollowing) return '✓ تتابعه';
    return followsMe ? '➕ متابعة بالمثل' : '➕ متابعة';
  }

  // شريط المتابعة داخل أي ملف شخصي: عدّاد المتابعين + أتابع + زر المتابعة (لغير صاحب الحساب)
  async function mountFollowBar(slot, user) {
    if (!slot || !user || !user.id) return;
    const isSelf = !!(state.currentUser && state.currentUser.id === user.id);
    slot.innerHTML = `
      <div class="follow-bar">
        <button type="button" class="follow-count-btn" data-tab="followers"><b class="fc-followers">0</b><span>المتابعون</span></button>
        <button type="button" class="follow-count-btn" data-tab="following"><b class="fc-following">0</b><span>أتابع</span></button>
        ${isSelf ? '' : '<button type="button" class="follow-action-btn" data-following="0">➕ متابعة</button>'}
      </div>`;
    const apply = (st) => {
      if (!st || !slot.isConnected) return;
      slot.querySelector('.fc-followers').innerText = String(st.followers_count || 0);
      slot.querySelector('.fc-following').innerText = String(st.following_count || 0);
      const btn = slot.querySelector('.follow-action-btn');
      if (btn) {
        btn.dataset.following = st.is_following ? '1' : '0';
        btn.dataset.followsMe = st.follows_me ? '1' : '0';
        btn.classList.toggle('following', !!st.is_following);
        btn.innerText = followBtnLabel(st.is_following, st.follows_me);
      }
    };
    slot.querySelectorAll('.follow-count-btn').forEach(b => {
      b.onclick = () => openFollowListModal(user.id, b.dataset.tab, user.name);
    });
    const btn = slot.querySelector('.follow-action-btn');
    if (btn) {
      btn.onclick = async () => {
        const nowFollowing = btn.dataset.following === '1';
        btn.disabled = true;
        const data = await setFollow(user.id, !nowFollowing);
        btn.disabled = false;
        if (data) {
          apply(await fetchFollowStats(user.id));
          showToast(data.is_following ? `تمت متابعة ${user.name} ✅` : `تم إلغاء متابعة ${user.name}`);
        }
      };
    }
    slot._applyFollowStats = apply;
    apply(await fetchFollowStats(user.id));
  }

  // قائمة المتابعين / أتابع: عامة لأي زائر
  async function openFollowListModal(userId, initialTab, ownerName) {
    const old = document.getElementById('follow-list-panel');
    if (old) old.remove();
    const panel = document.createElement('div');
    panel.id = 'follow-list-panel';
    panel.className = 'audience-list-modal';
    panel.style.zIndex = '400';
    panel.innerHTML = '<div class="audience-list-sheet"><div class="audience-list-head"><span>جارٍ التحميل...</span><button type="button" class="audience-list-close">✕</button></div></div>';
    document.body.appendChild(panel);
    panel.onclick = (e) => { if (e.target === panel || e.target.closest('.audience-list-close')) panel.remove(); };

    let activeTab = initialTab === 'following' ? 'following' : 'followers';
    const cache = {};
    const load = async (tab, force) => {
      if (cache[tab] && !force) return cache[tab];
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(userId)}/${tab}`, { headers: followHeaders() });
        if (!res.ok) return null;
        cache[tab] = (await res.json()).users || [];
        return cache[tab];
      } catch (e) { return null; }
    };

    const render = async (force) => {
      const [fl, fg, list] = await Promise.all([load('followers', force), load('following', force), load(activeTab, force)]);
      if (!panel.isConnected) return;
      if (!list) { panel.querySelector('.audience-list-head span').innerText = 'تعذر التحميل'; return; }
      const tabs = [
        { id: 'followers', label: `المتابعون (${(fl || []).length})` },
        { id: 'following', label: `أتابع (${(fg || []).length})` }
      ];
      panel.innerHTML = `
        <div class="audience-list-sheet rp-sheet">
          <div class="audience-list-head"><span>${fEsc(ownerName || 'الملف الشخصي')}</span><button type="button" class="audience-list-close">✕</button></div>
          <div class="rp-tabs">${tabs.map(t => `<button type="button" class="rp-tab ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}</div>
          <div class="audience-list-body">
            ${list.length ? list.map(u => `
              <div class="rp-row" data-user-id="${fEsc(u.id)}">
                <img class="rp-avatar ${u.avatar_frame ? 'avatar-frame-' + fEsc(u.avatar_frame) : ''}" src="${fEsc(u.avatar)}" onerror="this.src='/avatars/avatar-1.png'" />
                <div class="rp-info"><div class="rp-name">${fEsc(u.name)}</div><div class="rp-badges"><span class="rp-badge rp-lv">Lv.${u.level || 1}</span></div></div>
                ${u.is_me ? '' : `<button type="button" class="rp-act follow-row-btn ${u.is_following ? 'is-following' : ''}" data-uid="${fEsc(u.id)}">${u.is_following ? '✓ تتابعه' : '➕ متابعة'}</button>`}
              </div>`).join('') : `<div class="audience-empty-hint">${activeTab === 'followers' ? 'لا يوجد متابعون بعد' : 'لا يتابع أحداً بعد'}</div>`}
          </div>
        </div>`;
      panel.querySelectorAll('.rp-tab').forEach(b => { b.onclick = () => { activeTab = b.dataset.tab; render(false); }; });
      panel.querySelectorAll('.rp-row').forEach(row => {
        const u = list.find(x => x.id === row.dataset.userId);
        row.onclick = (e) => {
          if (e.target.closest('.rp-act')) return;
          if (u) { panel.remove(); openSoulProfileCard(u); }
        };
        const btn = row.querySelector('.follow-row-btn');
        if (btn) btn.onclick = async () => {
          const was = btn.classList.contains('is-following');
          btn.disabled = true;
          const data = await setFollow(btn.dataset.uid, !was);
          btn.disabled = false;
          if (data) {
            btn.classList.toggle('is-following', data.is_following);
            btn.innerText = data.is_following ? '✓ تتابعه' : '➕ متابعة';
            [cache.followers, cache.following].forEach(arr => (arr || []).forEach(x => { if (x.id === btn.dataset.uid) x.is_following = data.is_following; }));
          }
        };
      });
    };
    await render(true);
  }

  // ---------- الإشعارات ----------
  let _notifUserId = null;
  function setNotifBadge(n) {
    state.unreadNotifCount = n;
    document.querySelectorAll('.notif-bell-badge').forEach(el => {
      el.innerText = n > 99 ? '99+' : String(n);
      el.style.display = n > 0 ? 'flex' : 'none';
    });
  }
  async function refreshNotifBadge() {
    if (!state.currentUser) { setNotifBadge(0); return; }
    try {
      const res = await fetch('/api/notifications', { headers: followHeaders() });
      if (!res.ok) return;
      const d = await res.json();
      setNotifBadge(d.unread || 0);
    } catch (e) {}
  }
  function notifTimeText(iso) {
    try {
      const d = new Date(iso);
      const diff = Math.max(0, Date.now() - d.getTime());
      const m = Math.floor(diff / 60000);
      if (m < 1) return 'الآن';
      if (m < 60) return `منذ ${m} د`;
      const h = Math.floor(m / 60);
      if (h < 24) return `منذ ${h} س`;
      return `منذ ${Math.floor(h / 24)} يوم`;
    } catch (e) { return ''; }
  }
  function notifRowHtml(n) {
    const isFollow = n.type === 'follow';
    return `
      <div class="rp-row notif-row ${n.is_read ? '' : 'unread'}" data-actor-id="${fEsc(n.actor_id)}">
        <img class="rp-avatar ${n.actor_frame ? 'avatar-frame-' + fEsc(n.actor_frame) : ''}" src="${fEsc(n.actor_avatar || '/avatars/avatar-1.png')}" onerror="this.src='/avatars/avatar-1.png'" />
        <div class="rp-info">
          <div class="rp-name">${fEsc(n.actor_name || 'مستخدم')}</div>
          <div class="notif-text">${isFollow ? '👤 قام بمتابعتك' : fEsc(n.content || '')} <span class="notif-time">• ${notifTimeText(n.created_at)}</span></div>
        </div>
        ${isFollow ? `<button type="button" class="rp-act notif-follow-btn ${n.is_following_actor ? 'is-following' : ''}" data-uid="${fEsc(n.actor_id)}">${n.is_following_actor ? '✓ تتابعه' : '➕ متابعة'}</button>` : ''}
      </div>`;
  }
  async function openNotificationsSheet() {
    if (!state.currentUser) { showGoogleLoginModal(); return; }
    const old = document.getElementById('notifications-panel');
    if (old) old.remove();
    const panel = document.createElement('div');
    panel.id = 'notifications-panel';
    panel.className = 'audience-list-modal';
    panel.style.zIndex = '400';
    panel.innerHTML = '<div class="audience-list-sheet"><div class="audience-list-head"><span>🔔 الإشعارات</span><button type="button" class="audience-list-close">✕</button></div><div class="audience-list-body"><div class="audience-empty-hint">جارٍ التحميل...</div></div></div>';
    document.body.appendChild(panel);
    panel.onclick = (e) => { if (e.target === panel || e.target.closest('.audience-list-close')) panel.remove(); };

    const render = async () => {
      let d = null;
      try {
        const res = await fetch('/api/notifications', { headers: followHeaders() });
        if (res.ok) d = await res.json();
      } catch (e) {}
      if (!panel.isConnected) return;
      if (!d) { panel.querySelector('.audience-list-body').innerHTML = '<div class="audience-empty-hint">تعذر التحميل</div>'; return; }
      const list = d.notifications || [];
      panel.innerHTML = `
        <div class="audience-list-sheet rp-sheet">
          <div class="audience-list-head"><span>🔔 الإشعارات</span><button type="button" class="audience-list-close">✕</button></div>
          <div class="audience-list-body">
            ${list.length ? list.map(notifRowHtml).join('') : '<div class="audience-empty-hint">لا توجد إشعارات بعد</div>'}
          </div>
        </div>`;
      panel._lastList = list;
      panel.querySelectorAll('.notif-row').forEach(row => {
        const n = list.find(x => x.actor_id === row.dataset.actorId);
        row.onclick = (e) => {
          if (e.target.closest('.rp-act')) return;
          if (n) {
            panel.remove();
            openSoulProfileCard({ id: n.actor_id, name: n.actor_name, avatar: n.actor_avatar, avatar_frame: n.actor_frame });
          }
        };
        const btn = row.querySelector('.notif-follow-btn');
        if (btn) btn.onclick = async () => {
          const was = btn.classList.contains('is-following');
          btn.disabled = true;
          const data = await setFollow(btn.dataset.uid, !was);
          btn.disabled = false;
          if (data) {
            btn.classList.toggle('is-following', data.is_following);
            btn.innerText = data.is_following ? '✓ تتابعه' : '➕ متابعة';
          }
        };
      });
      // تعليم الإشعارات كمقروءة بعد العرض
      if (d.unread > 0) {
        try { await fetch('/api/notifications/read', { method: 'POST', headers: followHeaders() }); } catch (e) {}
        setNotifBadge(0);
      }
    };
    panel._render = render;
    await render();
  }

  // ============================================
  // فقاعة "ممن تتابع يقومون بالدردشة" + مركز اهتماماتي
  // ============================================
  const IC_CATS = {
    music: { label: 'موسيقى', icon: '🎵' },
    chat: { label: 'دردشة', icon: '💬' },
    chill: { label: 'هدوء', icon: '☕' },
    gaming: { label: 'ألعاب', icon: '🎮' },
    dating: { label: 'أبراج', icon: '🔮' }
  };
  const icCat = (c) => IC_CATS[c] || { label: 'دردشة', icon: '💬' };

  // شريط المتابَعين المتواجدين في غرف: النقر يدخلك الغرفة التي هم فيها
  async function loadFollowedStrip() {
    const strip = document.getElementById('rooms-followed-strip');
    if (!strip) return;
    if (!state.currentUser) { strip.style.display = 'none'; strip.innerHTML = ''; return; }
    let users = [];
    try {
      const res = await fetch('/api/following/in-rooms', { headers: followHeaders() });
      if (res.ok) users = (await res.json()).users || [];
    } catch (e) {}
    const cur = document.getElementById('rooms-followed-strip');
    if (!cur) return;
    if (!users.length) { cur.style.display = 'none'; cur.innerHTML = ''; return; }
    cur.style.display = '';
    cur.innerHTML = users.map(u => `
      <button type="button" class="rfs-item" data-room-id="${fEsc(u.room_id)}" title="${fEsc(u.name)} — ${fEsc(u.room_title || '')}">
        <span class="rfs-ring"><img src="${fEsc(u.avatar || '/avatars/avatar-1.png')}" onerror="this.src='/avatars/avatar-1.png'" alt="" /></span>
        <span class="rfs-badge"><b>${u.room_audience || 0}</b><i>${icCat(u.room_category).icon}</i></span>
        <span class="rfs-name">${fEsc(u.name)}</span>
      </button>`).join('');
    cur.querySelectorAll('.rfs-item').forEach(b => {
      b.onclick = () => openVoiceRoom(b.dataset.roomId);
    });
  }

  async function refreshFollowingBubble() {
    const container = document.getElementById('main-app-container');
    const bubbleOld = document.getElementById('following-bubble');
    const onRoomsList = !!document.getElementById('rooms-grid-list');
    if (!container || !onRoomsList || state.currentTab !== 'rooms' || !state.currentUser || state.activeRoom || document.getElementById('interests-center')) {
      if (bubbleOld) bubbleOld.remove();
      return;
    }
    loadFollowedStrip();
    let d = null;
    try {
      const res = await fetch('/api/interests/summary', { headers: followHeaders() });
      if (res.ok) d = await res.json();
    } catch (e) {}
    const stillValid = !!document.getElementById('rooms-grid-list') && state.currentTab === 'rooms' && !state.activeRoom && !document.getElementById('interests-center');
    let bubble = document.getElementById('following-bubble');
    if (!d || !d.count || !stillValid) { if (bubble) bubble.remove(); return; }
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.id = 'following-bubble';
      bubble.className = 'following-bubble';
      bubble.onclick = () => openInterestsCenter('favorites');
      container.appendChild(bubble);
    }
    bubble.innerHTML = `
      <img class="fb-avatar" src="${fEsc((d.first && d.first.avatar) || '/avatars/avatar-1.png')}" onerror="this.src='/avatars/avatar-1.png'" />
      <div class="fb-text"><b>${d.count}</b> ممن تتابع<br>يقومون بالدردشة!</div>`;
  }
  let _fbDebounce = null;
  function scheduleFollowingBubbleRefresh() {
    clearTimeout(_fbDebounce);
    _fbDebounce = setTimeout(refreshFollowingBubble, 600);
  }
  setInterval(() => { if (state.currentTab === 'rooms') refreshFollowingBubble(); }, 12000);

  function icEmptyHtml(text) {
    return `
      <div class="ic-empty">
        <svg viewBox="0 0 160 110" width="150" height="104" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="40" cy="26" r="9"/>
          <path d="M40 8v5M40 39v5M22 26h5M53 26h5M27 13l3 3M50 36l3 3M53 13l-3 3M27 39l3-3"/>
          <path d="M6 92c22-28 46-30 70-8 18 16 40 12 78-6"/>
          <path d="M6 100h148"/>
          <path d="M84 86c2-14 8-22 16-24 5-1 6-8 12-10 5-1 8 3 6 7l-5 4c-1 8 0 16 3 24"/>
          <path d="M94 74c-6 4-8 10-6 18M104 78c0 6 2 10 4 14"/>
        </svg>
        <div class="ic-empty-text">${fEsc(text)}</div>
      </div>`;
  }

  function icRoomRowHtml(r, tab) {
    const c = icCat(r.category);
    const img = r.cover_image || r.host_avatar || '/avatars/avatar-1.png';
    let action = '';
    if (tab === 'favorites') action = `<button type="button" class="ic-heart-btn" data-act="unfav" title="إزالة من المفضلة">❤</button>`;
    else if (tab === 'joined') action = `<button type="button" class="ic-cancel-btn" data-act="unjoin">إلغاء</button>`;
    return `
      <div class="ic-room-row" data-room-id="${fEsc(r.id)}">
        <img class="ic-room-avatar ${r.host_frame ? 'avatar-frame-' + fEsc(r.host_frame) : ''}" src="${fEsc(img)}" onerror="this.src='/avatars/avatar-1.png'" />
        <div class="ic-room-main">
          <div class="ic-room-title">${fEsc(r.title)}</div>
          <div class="ic-room-sub">${fEsc(r.host_name || '')}</div>
          <div class="ic-room-chips">
            ${r.is_locked ? '<span class="ic-chip ic-chip-lock">🔒</span>' : ''}
            <span class="ic-chip">👤 ${r.audience_count || 0}</span>
            <span class="ic-chip">${c.icon} ${c.label}</span>
            <span class="ic-flag">${flagImg(r.country_code, r.country_flag)}</span>
          </div>
        </div>
        ${action}
      </div>`;
  }

  async function openInterestsCenter(initialTab) {
    const container = document.getElementById('main-app-container');
    if (!container) return;
    if (!state.currentUser) { showGoogleLoginModal(); return; }
    const old = document.getElementById('interests-center');
    if (old) old.remove();
    const bub = document.getElementById('following-bubble');
    if (bub) bub.remove();

    const page = document.createElement('div');
    page.id = 'interests-center';
    page.className = 'interests-center';
    page.innerHTML = `
      <div class="ic-header">
        <button type="button" class="ic-back" id="ic-back-btn" aria-label="رجوع">›</button>
        <div class="ic-title">مركز اهتماماتي</div>
      </div>
      <div class="ic-body"><div class="ic-loading">جارٍ التحميل...</div></div>`;
    container.appendChild(page);
    page.querySelector('#ic-back-btn').onclick = () => { page.remove(); refreshFollowingBubble(); };

    let activeTab = ['favorites', 'joined', 'history', 'managed'].includes(initialTab) ? initialTab : 'favorites';
    let data = null;

    const render = () => {
      if (!page.isConnected || !data) return;
      const tabs = [
        { id: 'favorites', label: 'المفضلة', n: data.counts.favorites },
        { id: 'joined', label: 'تم الانضمام', n: data.counts.joined },
        { id: 'history', label: 'ما سبق', n: data.counts.history },
        { id: 'managed', label: 'إدارتي', n: data.counts.managed }
      ];
      const list = data[activeTab] || [];
      let bodyHtml = '';

      if (activeTab === 'favorites') {
        const fir = data.followed_in_rooms || [];
        if (fir.length) {
          bodyHtml += `
            <div class="ic-section-label">أشخاص ممن تتابع بالغرف الآن</div>
            <div class="ic-story-strip">
              ${fir.map(u => `
                <div class="ic-story" data-room-id="${fEsc(u.room_id)}">
                  <div class="ic-story-ring"><img src="${fEsc(u.avatar || '/avatars/avatar-1.png')}" onerror="this.src='/avatars/avatar-1.png'" /></div>
                  <span class="ic-story-badge">${u.room_audience || 0} ${icCat(u.room_category).icon}</span>
                  <div class="ic-story-name">${fEsc(u.name)}</div>
                </div>`).join('')}
            </div>`;
        }
        const rec = data.recommended || [];
        if (rec.length) {
          bodyHtml += `
            <div class="ic-reco-card">
              <div class="ic-reco-title">نرجح لك <b>${rec.length}</b> أشخاص متوافقين معك</div>
              <div class="ic-reco-row">
                ${rec.map(u => `
                  <div class="ic-reco-user" data-uid="${fEsc(u.id)}" data-room-id="${fEsc(u.room_id || '')}">
                    <div class="ic-reco-avatar">
                      <img src="${fEsc(u.avatar || '/avatars/avatar-1.png')}" onerror="this.src='/avatars/avatar-1.png'" />
                      ${u.country_code ? `<span class="ic-reco-flag">${flagImg(u.country_code)}</span>` : ''}
                    </div>
                    <span class="ic-reco-badge">ıllı ${u.room_audience || 0} 👤</span>
                    <div class="ic-story-name">${fEsc(u.name)}</div>
                  </div>`).join('')}
              </div>
              <button type="button" class="ic-reco-more" id="ic-reco-more">تعرف على المزيد ‹</button>
            </div>`;
        }
      }

      bodyHtml += list.length
        ? `<div class="ic-room-list">${list.map(r => icRoomRowHtml(r, activeTab)).join('')}</div>`
        : (activeTab === 'favorites' && ((data.followed_in_rooms || []).length || (data.recommended || []).length)
            ? ''
            : icEmptyHtml(activeTab === 'managed' ? 'لا تملك صلاحيات إدارة لأي غرفة حالياً' : (activeTab === 'favorites' ? 'لا توجد غرف في المفضلة بعد' : 'لا توجد غرف هنا بعد')));

      page.querySelector('.ic-body').innerHTML = `
        <div class="ic-tabs">
          ${tabs.map(t => `<button type="button" class="ic-tab ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}">${t.label} ${t.n}</button>`).join('')}
        </div>
        ${bodyHtml}`;

      page.querySelectorAll('.ic-tab').forEach(b => { b.onclick = () => { activeTab = b.dataset.tab; render(); }; });

      const enterRoom = (rid) => { if (!rid) return; page.remove(); openVoiceRoom(rid); };
      page.querySelectorAll('.ic-story').forEach(el => { el.onclick = () => enterRoom(el.dataset.roomId); });
      page.querySelectorAll('.ic-reco-user').forEach(el => {
        el.onclick = () => {
          if (el.dataset.roomId) return enterRoom(el.dataset.roomId);
          const u = (data.recommended || []).find(x => x.id === el.dataset.uid);
          if (u) openSoulProfileCard(u);
        };
      });
      const more = page.querySelector('#ic-reco-more');
      if (more) more.onclick = () => { page.remove(); switchTab('planet'); };

      page.querySelectorAll('.ic-room-row').forEach(row => {
        const rid = row.dataset.roomId;
        row.onclick = (e) => { if (e.target.closest('button')) return; enterRoom(rid); };
        const act = row.querySelector('[data-act]');
        if (!act) return;
        act.onclick = async () => {
          act.disabled = true;
          try {
            if (act.dataset.act === 'unfav') {
              await toggleFavoriteRoom(rid, null);
            } else if (act.dataset.act === 'unjoin') {
              await fetch(`/api/rooms/${encodeURIComponent(rid)}/unjoin`, { method: 'POST', headers: followHeaders() });
              showToast('تم إلغاء الانضمام للغرفة');
            }
          } catch (e) {}
          await load();
        };
      });
    };

    const load = async () => {
      try {
        const res = await fetch('/api/interests', { headers: followHeaders() });
        if (!res.ok) throw new Error('load failed');
        data = await res.json();
        render();
      } catch (e) {
        if (page.isConnected) page.querySelector('.ic-body').innerHTML = '<div class="ic-loading">تعذر التحميل</div>';
      }
    };
    await load();
  }

  // ============================================================
  // نافذة بطاقة المستخدم داخل الغرفة (عند النقر على اسم أي شخص) — مطابقة للفيديو
  // ============================================================
  const RUS_ICONS = {
    bell: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 22a2.2 2.2 0 0 0 2.2-2.2h-4.4A2.2 2.2 0 0 0 12 22zm6.6-6.4V11c0-3.2-1.7-5.8-4.6-6.5V3.8a2 2 0 0 0-4 0v.7C7.1 5.2 5.4 7.8 5.4 11v4.6L3.5 17.5v1h17v-1l-1.9-1.9z"/></svg>',
    gift: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M7.5 8a2.5 2.5 0 1 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 1 1 0 5"/></svg>',
    follow: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-7 7-7s7 3 7 7M19 8v6M16 11h6"/></svg>',
    warn: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2 1 21h22L12 2zm1 15h-2v-2h2v2zm0-4h-2V9h2v4z"/></svg>',
    xcircle: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.7 12.3-1.4 1.4L12 13.4l-3.3 3.3-1.4-1.4L10.6 12 7.3 8.7l1.4-1.4L12 10.6l3.3-3.3 1.4 1.4L13.4 12l3.3 3.3z"/></svg>',
    minus: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm5 11H7v-2h10v2z"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    gem: '<svg viewBox="0 0 24 24" width="26" height="26"><defs><linearGradient id="rusGem" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9b6ff"/><stop offset="1" stop-color="#8b3df2"/></linearGradient></defs><path d="M12 2 21 8v8l-9 6-9-6V8z" fill="url(#rusGem)" stroke="#f3d6ff" stroke-width="1"/><path d="M12 7l4 3v4l-4 3-4-3v-4z" fill="#fff" opacity=".35"/></svg>',
    tri: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 5 21 19H3z" fill="#c084fc"/></svg>',
    shield: '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z" fill="#8fa3bd" stroke="#dbe7f7" stroke-width="1"/><path d="M12 7l1.6 3.2 3.4.5-2.5 2.4.6 3.4-3.1-1.6-3.1 1.6.6-3.4L7 10.7l3.4-.5z" fill="#fff"/></svg>'
  };

  function rusMedals(level) {
    const lv = Number(level) || 1;
    const tiers = [['beginner', 1], ['star', 10], ['golden', 20], ['diamond', 30], ['pro', 40], ['king', 50]];
    return tiers.filter(t => lv >= t[1]).map(t => t[0]);
  }
  function rusVipTier(wealth) { return Math.max(0, Math.floor((Number(wealth) || 0) / 15)); }
  // أيقونة الهدية: صورة مرفوعة من الإدارة أو إيموجي
  function giftIconHtml(icon, imageUrl) {
    const v = String(imageUrl || icon || '🎁');
    if (/^\/uploads\//.test(v) || /^https?:\/\//.test(v)) return `<img class="gift-img" src="${fEsc(v)}" alt="" onerror="this.replaceWith(document.createTextNode('🎁'))" />`;
    return fEsc(v);
  }

  function rusIconHtml(icon) {
    const s = String(icon || '🎁');
    if (/^(https?:)?\//.test(s) || /\.(png|gif|webp|svg|jpe?g)(\?|$)/i.test(s)) return `<img src="${fEsc(s)}" alt="" onerror="this.replaceWith(document.createTextNode('🎁'))" />`;
    return `<span class="rus-emoji">${fEsc(s)}</span>`;
  }

  function closeRoomUserSheet() {
    const el = document.getElementById('room-user-sheet');
    if (!el) return;
    el.classList.add('closing');
    setTimeout(() => el.remove(), 180);
  }

  function openRoomUserSheet(user) {
    if (!user || !user.id) return;
    const prev = document.getElementById('room-user-sheet');
    if (prev) prev.remove();
    const me = state.currentUser;
    const isSelf = !!(me && me.id === user.id);
    const roomId = state.activeRoom ? state.activeRoom.id : null;

    const wrap = document.createElement('div');
    wrap.id = 'room-user-sheet';
    wrap.className = 'rus-backdrop';
    wrap.innerHTML = `
      <div class="rus-sheet" role="dialog" aria-label="بطاقة المستخدم">
        <div class="rus-scroll">
          <div class="rus-top">
            <div class="rus-top-r"><span class="rus-trophy">+100 🏆</span></div>
            <div class="rus-top-l">
              <button type="button" class="rus-ic" data-act="menu" aria-label="المزيد">${RUS_ICONS.bell}</button>
              <button type="button" class="rus-ic" data-act="mention" aria-label="منشن">@</button>
            </div>
          </div>
          <div class="rus-hero">
            <div class="rus-avatar"><img class="${user.avatar_frame ? 'avatar-frame-' + fEsc(user.avatar_frame) : ''}" src="${fEsc(user.avatar || '/avatars/avatar-1.png')}" onerror="this.src='/avatars/avatar-1.png'" alt="" /></div>
            <div class="rus-name" data-f="name">${fEsc(user.name || 'عضو')}</div>
            <div class="rus-uid"><span data-f="uid">UID · ${fEsc(String(user.id).replace(/^sc-user-/, ''))}</span><span class="rus-sep" data-f="days"></span></div>
            <div class="rus-badges" data-f="badges"></div>
          </div>
          <div class="rus-cards">
            <div class="rus-card c1"><span class="rus-card-ic">${RUS_ICONS.gem}</span><div><b data-f="wealth">Lv.${fEsc(user.wealth_level || 1)}</b><small>الثروة</small></div></div>
            <div class="rus-card c2"><span class="rus-card-ic">${RUS_ICONS.tri}</span><div><b data-f="charm">Lv.${fEsc(user.charm_level || 1)}</b><small>رائج</small></div></div>
            <div class="rus-card c3"><span class="rus-card-ic">${RUS_ICONS.shield}</span><div><b data-f="vip">VIP${rusVipTier(user.wealth_level)}</b><small>طبقة النبلاء</small></div></div>
          </div>
          <button type="button" class="rus-row" data-act="medals"><span class="rus-chev">${RUS_ICONS.chev}</span><span class="rus-row-icons" data-f="medal-icons"></span><span class="rus-row-label" data-f="medal-label">حائط الميداليات · 0</span></button>
          <button type="button" class="rus-row" data-act="gifts"><span class="rus-chev">${RUS_ICONS.chev}</span><span class="rus-row-icons" data-f="gift-icons"></span><span class="rus-row-label" data-f="gift-label">معرض الهدايا · 0 إضاءة</span></button>
          <button type="button" class="rus-row plain" data-act="empire"><span class="rus-chev">${RUS_ICONS.chev}</span><span class="rus-row-sub">لم تنضم إلى الامبراطورية</span><span class="rus-row-label">إمبراطورية</span></button>
          <button type="button" class="rus-row plain" data-act="relation"><span class="rus-chev">${RUS_ICONS.chev}</span><span class="rus-row-label">علاقة</span></button>
        </div>
        ${isSelf ? '' : `
        <div class="rus-actions">
          <button type="button" class="rus-btn follow" data-act="follow"><span class="rus-btn-ic">${RUS_ICONS.follow}</span><span data-f="follow-label">متابعة</span></button>
          <button type="button" class="rus-btn gift" data-act="gift"><span class="rus-btn-ic">${RUS_ICONS.gift}</span><span>إرسال هدية</span></button>
        </div>`}
      </div>`;
    document.body.appendChild(wrap);

    const $ = (sel) => wrap.querySelector(sel);
    const sheetState = { following: false, user };

    // إغلاق بالنقر خارج النافذة
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeRoomUserSheet(); });

    // قائمة الإبلاغ / حذف المتابعين / الحظر
    const openMenu = () => {
      const m = document.createElement('div');
      m.className = 'rus-menu-backdrop';
      m.innerHTML = `
        <div class="rus-menu">
          <button type="button" data-m="report"><span>إبلاغ</span>${RUS_ICONS.warn}</button>
          <button type="button" data-m="unfollower"><span>حذف المتابعين</span>${RUS_ICONS.xcircle}</button>
          <button type="button" class="danger" data-m="block"><span>إضافة إلى قائمة الحظر</span>${RUS_ICONS.minus}</button>
          <button type="button" class="cancel" data-m="cancel">إلغاء</button>
        </div>`;
      wrap.appendChild(m);
      const close = () => m.remove();
      m.addEventListener('click', async (e) => {
        if (e.target === m) return close();
        const b = e.target.closest('button[data-m]');
        if (!b) return;
        const act = b.dataset.m;
        close();
        if (act === 'cancel') return;
        if (isSelf) return showToast('لا يمكنك تنفيذ ذلك على نفسك');
        try {
          if (act === 'report') {
            if (!(await window.uiConfirm('هل تريد الإبلاغ عن هذا المستخدم؟', { danger: true, okText: 'إبلاغ' }))) return;
            const r = await fetch(`/api/users/${encodeURIComponent(user.id)}/report`, { method: 'POST', headers: { ...followHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ room_id: roomId, reason: 'إبلاغ من داخل الغرفة' }) });
            showToast(r.ok ? 'تم إرسال البلاغ، شكراً لك' : 'تعذر إرسال البلاغ');
          } else if (act === 'unfollower') {
            if (!(await window.uiConfirm('حذف هذا المستخدم من متابعيك؟', { danger: true, okText: 'حذف' }))) return;
            const r = await fetch(`/api/users/${encodeURIComponent(user.id)}/follower`, { method: 'DELETE', headers: followHeaders() });
            showToast(r.ok ? 'تم الحذف من متابعيك' : 'تعذر تنفيذ الطلب');
          } else if (act === 'block') {
            if (!(await window.uiConfirm('إضافة هذا المستخدم إلى قائمة الحظر؟', { danger: true, okText: 'حظر' }))) return;
            const r = await fetch(`/api/users/${encodeURIComponent(user.id)}/block`, { method: 'POST', headers: followHeaders() });
            if (r.ok) { showToast('تمت الإضافة إلى قائمة الحظر'); sheetState.following = false; closeRoomUserSheet(); }
            else showToast('تعذر تنفيذ الطلب');
          }
        } catch (err) { showToast('تعذر الاتصال بالخادم'); }
      });
    };

    wrap.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || !wrap.contains(b)) return;
      const act = b.dataset.act;
      if (act === 'menu') return openMenu();
      if (act === 'mention') {
        const inputEl = document.getElementById('room-chat-text-input');
        if (inputEl && !inputEl.disabled) { inputEl.value = `${inputEl.value}@${String(user.name || '').split(' ')[0]} `; inputEl.focus(); }
        return closeRoomUserSheet();
      }
      if (act === 'gift') {
        closeRoomUserSheet();
        return openGiftStoreModal(user.id, roomId, user);
      }
      if (act === 'follow') {
        if (!requireAuth()) return;
        const was = sheetState.following;
        try {
          const r = await fetch(`/api/users/${encodeURIComponent(user.id)}/follow`, { method: was ? 'DELETE' : 'POST', headers: followHeaders() });
          if (!r.ok) throw new Error('x');
          sheetState.following = !was;
          const lbl = $('[data-f="follow-label"]'); if (lbl) lbl.textContent = sheetState.following ? 'تمت المتابعة' : 'متابعة';
          b.classList.toggle('on', sheetState.following);
        } catch (err) { showToast('تعذر تنفيذ المتابعة'); }
        return;
      }
      if (act === 'relation') { closeRoomUserSheet(); if (typeof pfOpenRelations === 'function') pfOpenRelations('followers', user.id); return; }
      if (act === 'medals') { closeRoomUserSheet(); if (typeof pfOpenMedals === 'function') pfOpenMedals(); return; }
      if (act === 'gifts' || act === 'empire') { showToast('ليس متاحاً بعد'); }
    });

    // تعبئة البيانات الحية
    const enc = encodeURIComponent(user.id);
    const j = (url) => fetch(url, { headers: followHeaders() }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([j(`/api/users/${enc}`), j(`/api/users/${enc}/gifts`), j(`/api/users/${enc}/profile-stats`), j(`/api/users/${enc}/follow-stats`)]).then(([u, g, ps, fs]) => {
      if (!document.body.contains(wrap)) return;
      const full = Object.assign({}, user, u || {});
      sheetState.user = full;
      const set = (sel, html) => { const n = $(sel); if (n) n.innerHTML = html; };
      set('[data-f="name"]', fEsc(full.name || 'عضو'));
      set('[data-f="wealth"]', `Lv.${fEsc(full.wealth_level || 1)}`);
      set('[data-f="charm"]', `Lv.${fEsc(full.charm_level || 1)}`);
      set('[data-f="vip"]', `VIP${rusVipTier(full.wealth_level)}`);
      const av = $('.rus-avatar img');
      if (av && full.avatar_frame) av.className = 'avatar-frame-' + full.avatar_frame;
      const days = accountDayNumber(full.created_at);
      const posts = ps && ps.posts_count != null ? ps.posts_count : 0;
      set('[data-f="days"]', `${toArabicNumerals(days || 1)} يوم | ${toArabicNumerals(posts)} منشور`);

      // الشارات: الرتبة + العمر/الجنس + العلم
      const rb = ({
        owner: ['👑 المالك الأعلى', 'linear-gradient(90deg,#f59e0b,#ef4444)'],
        super_master: ['💎 سوبر ماستر', 'linear-gradient(90deg,#a855f7,#6366f1)'],
        super_admin: ['⚡ سوبر ادمن', 'linear-gradient(90deg,#f59e0b,#ef4444)'],
        admin: ['🛡️ ادمن الدردشة', 'linear-gradient(90deg,#3b82f6,#06b6d4)'],
        moderator: ['🛡️ ادمن الدردشة', 'linear-gradient(90deg,#3b82f6,#06b6d4)']
      })[full.role];
      const gKey = full.gender === 'female' ? 'female' : (full.gender === 'male' ? 'male' : 'other');
      const sym = gKey === 'female' ? '♀' : (gKey === 'male' ? '♂' : '⚧');
      const code = full.country_code || 'JO';
      set('[data-f="badges"]',
        (rb ? `<span class="rus-badge role" style="background:${rb[1]}">${rb[0]}</span>` : '') +
        (full.age ? `<span class="rus-badge age ${gKey}">${sym} ${fEsc(full.age)}</span>` : '') +
        `<span class="rus-badge flag">${flagImg(code)}</span>`);

      // الميداليات (حسب المستوى)
      const medals = rusMedals(full.level);
      set('[data-f="medal-label"]', `حائط الميداليات · ${toArabicNumerals(medals.length)}`);
      set('[data-f="medal-icons"]', medals.slice(-3).reverse().map(m => `<img src="/img/pf/medal_${m}.png" alt="" />`).join(''));

      // معرض الهدايا
      const summary = (g && g.summary) || [];
      const total = (g && g.totalCount) || summary.reduce((a, x) => a + (Number(x.count) || 0), 0);
      set('[data-f="gift-label"]', `معرض الهدايا · ${toArabicNumerals(total)} إضاءة`);
      set('[data-f="gift-icons"]', summary.slice(0, 3).map(x => rusIconHtml(x.gift_icon)).join(''));

      // حالة المتابعة
      if (fs && !isSelf) {
        sheetState.following = !!fs.is_following;
        const lbl = $('[data-f="follow-label"]'); if (lbl) lbl.textContent = sheetState.following ? 'تمت المتابعة' : 'متابعة';
        const fb = $('[data-act="follow"]'); if (fb) fb.classList.toggle('on', sheetState.following);
      }
    });
  }

  function showUserProfileCard(user) {
    if (!user) return;
    // داخل الغرفة: نفس نافذة البطاقة السفلية المطابقة للفيديو
    if (state.activeRoom && user.id && document.getElementById('live-voice-room-modal')) {
      openRoomUserSheet(user);
      return;
    }
    openSoulProfileCard(user, user.matchRate || 95);
  }

  // Direct Private Chat Helper
  function startPrivateChatWithUser(user) {
    if (!user) return;
    openDirectChatWithUser(user);
  }

  // Wallet Modal Opener Helper
  function openWalletModal() {
    showTopUpModal();
  }

  // Room PK Battle Opener Helper
  function startRoomPkBattle(room) {
    if (!state.currentUser) return;
    const targetRoom = room || state.activeRoom;
    if (!targetRoom) return;

    // Find a challenger from occupied seats (seat 1..8)
    const occupiedSeats = (targetRoom.seats || []).filter(s => s.seat_index > 0 && s.user_id);
    const challenger = occupiedSeats.length > 0 ? {
      id: occupiedSeats[0].user_id,
      name: occupiedSeats[0].name,
      avatar: occupiedSeats[0].avatar
    } : {
      id: 'challenger-1',
      name: 'المنافس الأزرق ⚔️',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80'
    };

    const host = {
      id: targetRoom.host_id || state.currentUser.id,
      name: targetRoom.host_name || state.currentUser.name,
      avatar: targetRoom.host_avatar || state.currentUser.avatar
    };

    state.socket.emit('start_pk', {
      roomId: targetRoom.id,
      hostUser: host,
      challengerUser: challenger,
      duration: 60
    });
    showToast('⚔️ جارِ إطلاق تحدي الـ PK في الغرفة!');
  }


  // صف (العمر/الجنس + علم الدولة) يظهر في أي ملف شخصي
  function profileMetaRowHtml(user) {
    const g = user.gender === 'female' ? 'female' : (user.gender === 'male' ? 'male' : 'other');
    const sym = g === 'female' ? '♀' : (g === 'male' ? '♂' : '⚧');
    const agePill = user.age ? `<span class="profile-age-pill ${g}">${sym} ${user.age}</span>` : '';
    const flag = user.country_code ? flagImg(user.country_code) : '';
    return `<div class="profile-meta-row" data-meta-user="${user.id}">${agePill}<span class="profile-country-flag" title="">${flag}</span>${accountDaysPillHtml(user.created_at)}</div>`;
  }
  // عدد أيام الحساب: يوم إنشاء الحساب = اليوم 1، ثم 2، 3 ...
  function accountDayNumber(createdAt) {
    if (!createdAt) return 0;
    let str = String(createdAt);
    // SQLite يخزن UTC بصيغة "YYYY-MM-DD HH:MM:SS" بدون منطقة زمنية
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)) str = str.replace(' ', 'T') + 'Z';
    const d = new Date(str);
    if (isNaN(d.getTime())) return 0;
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    return Math.max(1, Math.round((startOf(new Date()) - startOf(d)) / 86400000) + 1);
  }
  function accountDaysPillHtml(createdAt) {
    const n = accountDayNumber(createdAt);
    return n ? `<span class="profile-days-pill" title="عدد أيام الحساب">📅 اليوم ${n}</span>` : '';
  }
  // إن لم تكن الدولة معروفة في كائن المستخدم نجلبها من السيرفر ثم نعرض العلم
  async function hydrateProfileCountry(root, user) {
    const slot = root && root.querySelector('.profile-country-flag');
    if (!slot) return;
    const flagFilled = !!slot.innerHTML.trim();
    const daysFilled = !!slot.parentElement.querySelector('.profile-days-pill');
    if (flagFilled && daysFilled) return;
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(user.id)}`);
      if (!res.ok) return;
      const u = await res.json();
      const code = u.country_code || 'JO';
      const info = (state.countriesList || []).find(c => c.code === code);
      if (!flagFilled) {
        slot.innerHTML = flagImg(code);
        if (info) slot.title = info.name;
      }
      if (u.created_at && !daysFilled) {
        slot.parentElement.insertAdjacentHTML('beforeend', accountDaysPillHtml(u.created_at));
      }
      if (!user.age && u.age) {
        const row = slot.parentElement;
        const g = u.gender === 'female' ? 'female' : (u.gender === 'male' ? 'male' : 'other');
        row.insertAdjacentHTML('afterbegin', `<span class="profile-age-pill ${g}">${g === 'female' ? '♀' : (g === 'male' ? '♂' : '⚧')} ${u.age}</span>`);
      }
    } catch (e) {}
  }

  // Soul Profile Card Modal (when clicking any soul)
  function openSoulProfileCard(user, matchRate = 95) {
    if (user && user.id && state.currentUser && state.currentUser.id !== user.id) {
      fetch(`/api/users/${encodeURIComponent(user.id)}/visit`, { method: 'POST', headers: followHeaders() }).catch(() => {});
    }
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'soul-user-card-modal';

    const tagsHtml = (user.soul_tags || 'موسيقى,هدوء,سوالف')
      .split(',')
      .map(t => `<span class="cat-pill" style="padding: 2px 8px; font-size: 10px;">#${t.trim()}</span>`)
      .join(' ');

    modal.innerHTML = `
      <div class="soul-modal-content">
        <button class="soul-modal-close-btn" id="close-card-btn">✕</button>

        <div style="display: flex; flex-direction: column; align-items: center; text-align: center;">
          <div class="profile-big-avatar-box">
            <img src="${user.avatar}" class="${user.avatar_frame ? 'avatar-frame-' + user.avatar_frame : ''}" onerror="this.src='/avatars/avatar-1.png'" />
          </div>

          <div style="font-size: 16px; font-weight: 800; color: #fff; margin-bottom: 2px;">${user.name}</div>
          ${profileMetaRowHtml(user)}
          <div class="profile-planet-pill">${user.soul_planet || 'كوكب الرومانسي الحالم 🌌'}</div>
          <div class="follow-bar-slot" id="soul-card-follow-slot"></div>

          <!-- Compatibility Bar -->
          <div style="width: 100%; background: rgba(0,0,0,0.3); border-radius: 12px; padding: 10px; margin: 10px 0; border: 1px solid var(--border-glass);">
            <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; margin-bottom: 6px;">
              <span style="color: #fbbf24;">نسبة توافق الروح:</span>
              <span style="color: #ec4899;">${matchRate}% Soul Match ✨</span>
            </div>
            <div style="height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden;">
              <div style="height: 100%; width: ${matchRate}%; background: var(--secondary-gradient); border-radius: 4px;"></div>
            </div>
          </div>

          <div style="font-size: 12px; color: #cbd5e1; margin-bottom: 12px; line-height: 1.4;">
            "${user.bio || 'أحب الحياة والموسيقى الهادئة واللقاءات الرايقة'}"
          </div>

          <div style="display: flex; gap: 4px; flex-wrap: wrap; justify-content: center; margin-bottom: 12px;">
            ${tagsHtml}
          </div>

          <!-- User's Received Gifts Wall ("هداياه") -->
          <div class="user-received-gifts-box" data-user-id="${user.id}" id="soul-card-gifts-box">
            <div style="font-size: 11px; color: var(--text-muted); padding: 6px;">جارِ تحميل الهدايا... 🎁</div>
          </div>

          <!-- Action Buttons -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; margin-bottom: 8px;">
            <button class="wallet-btn secondary" id="card-say-hi-btn">
              👋 إلقاء التحية
            </button>
            <button class="wallet-btn primary" id="card-start-chat-btn">
              💬 مراسلة خاصة
            </button>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%;">
            <button class="wallet-btn" style="background: linear-gradient(135deg, #8b5cf6, #ec4899); color: #fff;" id="card-voice-match-btn">
              🎙️ توافق صوتي (Voice)
            </button>
            <button class="wallet-btn" style="background: var(--secondary-gradient); color: #fff;" id="card-send-gift-btn">
              🎁 إرسال هدية
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    hydrateProfileCountry(modal, user);
    mountFollowBar(modal.querySelector('#soul-card-follow-slot'), user);

    const cardGiftsBox = modal.querySelector('#soul-card-gifts-box');
    if (cardGiftsBox && user.id) {
      loadAndRenderUserGiftsSection(user.id, cardGiftsBox, !!(state.currentUser && state.currentUser.id === user.id));
    }

    modal.querySelector('#close-card-btn').onclick = () => modal.remove();

    // Say Hi
    modal.querySelector('#card-say-hi-btn').onclick = async () => {
      if (window.soundManager) window.soundManager.playGiftSound(false);
      showToast(`ألقيت التحية على ${user.name}! 👋✨`);
      await sendPrivateMessage(user.id, 'text', 'مرحباً! أعجبني كوكبيك وتوافق أرواحنا في SoulChill 👋💫');
      modal.remove();
    };

    // Start Chat
    modal.querySelector('#card-start-chat-btn').onclick = () => {
      modal.remove();
      openDirectChatWithUser(user);
    };

    // Send Gift
    modal.querySelector('#card-send-gift-btn').onclick = () => {
      modal.remove();
      openGiftStoreModal(user.id, state.activeRoom ? state.activeRoom.id : null, user);
    };

    // Voice Match direct with this user
    modal.querySelector('#card-voice-match-btn').onclick = () => {
      modal.remove();
      startVoiceMatchSession('voice');
    };
  }

  // ============================================
  // SOULCHILL 5-MINUTE ANONYMOUS VOICE MATCH SYSTEM
  // ============================================
  function startVoiceMatchSession(type = 'voice') {
    if (!requireAuth()) return;

    // Remove existing radar modal if any
    const existing = document.getElementById('voice-match-radar-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'voice-match-radar-modal';
    modal.innerHTML = `
      <div class="soul-modal-content" style="max-width: 360px; text-align: center; padding: 30px 20px;">
        <!-- Pulsing Cosmic Radar Orbit -->
        <div style="position: relative; width: 140px; height: 140px; margin: 0 auto 16px;">
          <div style="position: absolute; inset: 0; border-radius: 50%; border: 2px dashed rgba(168,85,247,0.5); animation: rotateOrbit 10s linear infinite;"></div>
          <div style="position: absolute; inset: -15px; border-radius: 50%; border: 1.5px solid rgba(236,72,153,0.4); animation: speakingRipple 2s infinite;"></div>
          <div style="position: absolute; inset: 20px; border-radius: 50%; background: radial-gradient(circle, #8b5cf6 0%, #3b0764 100%); display: flex; align-items: center; justify-content: center; box-shadow: 0 0 35px rgba(139,92,246,0.7);">
            <span style="font-size: 46px; animation: floatSubtle 2.5s infinite;">${type === 'voice' ? '🎙️' : '🪐'}</span>
          </div>
        </div>

        <div style="font-size: 18px; font-weight: 800; color: #fff; margin-bottom: 6px;">
          ${type === 'voice' ? '🎙️ رادار التوافق الصوتي (Voice Match)' : '🪐 توافق الروح المباشر (Soul Match)'}
        </div>
        <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.5;">
          جارِ البحث في المجرة عن روح متوافقة تشاركك نفس الاهتمامات لمكالمة صوتية مجهولة مدتها 5 دقائق... 🌌
        </p>

        <div style="display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; margin-bottom: 22px;">
          <span class="cat-pill active" style="font-size: 10px; padding: 2px 8px;">#موسيقى</span>
          <span class="cat-pill active" style="font-size: 10px; padding: 2px 8px;">#سوالف</span>
          <span class="cat-pill active" style="font-size: 10px; padding: 2px 8px;">#شات_مجهول</span>
          <span class="cat-pill active" style="font-size: 10px; padding: 2px 8px;">#رواق</span>
        </div>

        <button class="vmatch-end-btn" id="btn-cancel-voice-radar" style="padding: 8px 24px; font-size: 13px;">إلغاء البحث</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#btn-cancel-voice-radar').onclick = () => {
      modal.remove();
      state.socket.emit('end_voice_match', {});
    };

    // Emit search event to server
    setTimeout(() => {
      if (document.getElementById('voice-match-radar-modal')) {
        state.socket.emit('start_voice_match', {
          userId: state.currentUser.id,
          tags: state.currentUser.soul_tags,
          planet: state.currentUser.soul_planet
        });
      }
    }, 1000);
  }

  // Open Fullscreen Masked Call Screen
  function openVoiceMatchScreen(data) {
    // Remove radar search modal
    const radar = document.getElementById('voice-match-radar-modal');
    if (radar) radar.remove();

    // Close any prior voice match screen
    closeVoiceMatchScreen(false);

    activeVoiceMatchSession = data;
    voiceMatchSecondsLeft = data.duration || 300;
    isVoiceMatchMuted = false;
    isVoiceMatchSpeakerOn = true;

    const modal = document.createElement('div');
    modal.className = 'voice-match-fullscreen-modal';
    modal.id = 'voice-match-active-modal';

    modal.innerHTML = `
      <!-- Top Bar: Header, Timer & End -->
      <div class="vmatch-header-bar">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 22px;">🪐</span>
          <div>
            <div style="font-size: 14px; font-weight: 800; color: #fff;">مكالمة التوافق الصوتي المجهولة</div>
            <div style="font-size: 10px; color: #c084fc;">SoulChill Blind Voice Call</div>
          </div>
        </div>

        <div class="vmatch-timer-badge" id="vmatch-timer-display">
          ⏳ 05:00
        </div>

        <button class="vmatch-end-btn" id="btn-end-voice-match">🛑 إنهاء المكالمة</button>
      </div>

      <!-- Center Voice Call Stage -->
      <div class="vmatch-stage-container">
        <div class="vmatch-duo-avatars-row">
          <!-- User Masked Avatar -->
          <div class="vmatch-user-card">
            <div class="vmatch-avatar-circle" id="vmatch-self-avatar-circle">
              <img src="/avatars/masked-avatar.png" id="vmatch-self-avatar-img" onerror="this.src='/avatars/avatar-1.png'" />
              <div class="vmatch-mask-icon-tag" id="vmatch-self-mask-tag">🎭</div>
            </div>
            <div class="vmatch-name-tag" id="vmatch-self-name-label">أنت (هويتك مخفية)</div>
            <div class="vmatch-planet-tag">${state.currentUser?.soul_planet || 'كوكب الروح 🌌'}</div>
          </div>

          <!-- Compatibility Heart & Waves -->
          <div class="vmatch-compatibility-heart">
            <div class="heart-pulse-icon">💖</div>
            <div class="heart-score-val">${data.partner?.soul_score || 94}% توافق الروح</div>
            <div class="vmatch-audio-waves" id="vmatch-audio-waves">
              <div class="vmatch-wave-bar" style="height: 12px;"></div>
              <div class="vmatch-wave-bar" style="height: 18px;"></div>
              <div class="vmatch-wave-bar" style="height: 10px;"></div>
              <div class="vmatch-wave-bar" style="height: 22px;"></div>
              <div class="vmatch-wave-bar" style="height: 14px;"></div>
            </div>
          </div>

          <!-- Partner Masked Avatar -->
          <div class="vmatch-user-card">
            <div class="vmatch-avatar-circle" id="vmatch-partner-avatar-circle">
              <img src="${data.partner?.maskedAvatar || '/avatars/masked-avatar.png'}" id="vmatch-partner-avatar-img" onerror="this.src='/avatars/avatar-2.png'" />
              <div class="vmatch-mask-icon-tag" id="vmatch-partner-mask-tag">🎭</div>
            </div>
            <div class="vmatch-name-tag" id="vmatch-partner-name-label">${data.partner?.maskedName || 'روح متوافقة 🔮'}</div>
            <div class="vmatch-planet-tag" id="vmatch-partner-planet-label">${data.partner?.soul_planet || 'كوكب الحالم 🪐'}</div>
          </div>
        </div>

        <!-- Mutual Reveal Action Box -->
        <div class="vmatch-reveal-box" id="vmatch-reveal-box">
          <button class="btn-reveal-identity" id="btn-reveal-voice-match-identity">
            <span>🎭 كشف هويتي للشريك (Reveal Identity)</span>
          </button>
          <p class="vmatch-reveal-hint" id="vmatch-reveal-hint">
            💡 المكالمة المجهولة مدتها 5 دقائق! اضغط على زر كشف الهوية، وعند موافقة الطرفين تُكشف الحسابات وتتحول المكالمة إلى <strong>مفتوحة بلا حدود (Unlimited) للأبد!</strong> 🎉
          </p>
        </div>

        <!-- Icebreaker banner container -->
        <div id="vmatch-icebreaker-card" style="display: none; background: rgba(0,0,0,0.55); border: 1px dashed rgba(251,191,36,0.6); border-radius: 14px; padding: 10px 16px; max-width: 380px; font-size: 12px; color: #fde047; margin-top: 12px; line-height: 1.5; box-shadow: 0 4px 15px rgba(0,0,0,0.4);">
        </div>
      </div>

      <!-- Bottom Voice Call Controls -->
      <div class="vmatch-bottom-controls">
        <button class="vmatch-tool-btn active" id="vmatch-mic-btn" title="تفعيل/كتم المايك">🎙️</button>
        <button class="vmatch-tool-btn" id="vmatch-speaker-btn" title="مكبر الصوت">🔊</button>
        <button class="vmatch-tool-btn" id="vmatch-icebreaker-btn" title="سؤال لكسر الجليد">💡</button>
        <button class="vmatch-tool-btn" id="vmatch-reaction-btn" title="إرسال تفاعل سريع">❤️</button>
        <button class="vmatch-tool-btn" id="vmatch-next-match-btn" title="الشريك التالي">⏭️</button>
      </div>
    `;

    document.body.appendChild(modal);

    // Start 5-Minute Timer
    voiceMatchTimerInterval = setInterval(() => {
      if (activeVoiceMatchSession && activeVoiceMatchSession.isUnlimited) return; // Freeze timer if mutual reveal

      voiceMatchSecondsLeft--;
      const mins = Math.floor(Math.max(0, voiceMatchSecondsLeft) / 60);
      const secs = Math.max(0, voiceMatchSecondsLeft) % 60;
      const timeStr = `⏳ ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

      const timerEl = document.getElementById('vmatch-timer-display');
      if (timerEl) {
        timerEl.innerText = timeStr;
        if (voiceMatchSecondsLeft <= 30) {
          timerEl.style.borderColor = '#ef4444';
          timerEl.style.color = '#ef4444';
        }
      }

      if (voiceMatchSecondsLeft <= 0) {
        clearInterval(voiceMatchTimerInterval);
        closeVoiceMatchScreen(true);
        showToast('انتهت الـ 5 دقائق للمكالمة المجهولة دون كشف متبادل! يمكنك بدء توافق صوتي جديد أو كشف الهوية في المرة القادمة 🪐');
      }
    }, 1000);

    // Setup Local Microphone & Speech Wave Visualization
    setupVoiceMatchAudioCapture();

    // Setup Simulated Partner Speech Animation
    startPartnerVoiceWaveSimulation();

    // Wire End Call Button
    modal.querySelector('#btn-end-voice-match').onclick = async () => {
      const confirmEnd = await uiConfirm('هل أنت متأكد من إنهاء مكالمة التوافق الصوتي الحالية؟', { icon: '📞', danger: true, okText: 'إنهاء المكالمة' });
      if (confirmEnd) {
        state.socket.emit('end_voice_match', { sessionId: data.sessionId });
        closeVoiceMatchScreen(true);
      }
    };

    // Wire Mutual Identity Reveal Button
    const revealBtn = modal.querySelector('#btn-reveal-voice-match-identity');
    revealBtn.onclick = () => {
      if (revealBtn.classList.contains('revealed')) return;

      revealBtn.classList.add('revealed');
      revealBtn.innerHTML = `<span>⏳ قمت بكشف هويتك! بانتظار موافقة الطرف الآخر...</span>`;

      state.socket.emit('reveal_voice_match_identity', {
        sessionId: data.sessionId,
        userId: state.currentUser.id
      });
      showToast('🌟 قمت بكشف هويتك! بمجرد موافقة الشريك ستتحول المكالمة إلى بلا حدود!');
    };

    // Wire Mic Toggle
    const micBtn = modal.querySelector('#vmatch-mic-btn');
    micBtn.onclick = () => {
      isVoiceMatchMuted = !isVoiceMatchMuted;
      micBtn.classList.toggle('active', !isVoiceMatchMuted);
      micBtn.classList.toggle('muted', isVoiceMatchMuted);
      micBtn.innerText = isVoiceMatchMuted ? '🔇' : '🎙️';
      if (voiceMatchMicStream) {
        voiceMatchMicStream.getAudioTracks().forEach(track => {
          track.enabled = !isVoiceMatchMuted;
        });
      }
      showToast(isVoiceMatchMuted ? 'تم كتم الميكروفون' : 'تم تفعيل الميكروفون 🎙️');
    };

    // Wire Speaker Toggle
    const spkBtn = modal.querySelector('#vmatch-speaker-btn');
    spkBtn.onclick = () => {
      isVoiceMatchSpeakerOn = !isVoiceMatchSpeakerOn;
      spkBtn.classList.toggle('active', isVoiceMatchSpeakerOn);
      showToast(isVoiceMatchSpeakerOn ? 'مكبر الصوت مفعّل 🔊' : 'سماعة الهاتف 📱');
    };

    // Wire Icebreaker Questions Button
    const iceBtn = modal.querySelector('#vmatch-icebreaker-btn');
    const iceCard = modal.querySelector('#vmatch-icebreaker-card');
    const icebreakers = [
      '💡 سؤال لكسر الجليد: لو فزت بمليون دولار غداً، ما أول شيء ستشتريه؟ 💰',
      '💡 سؤال لكسر الجليد: ما هي الأغنية التي لا تمل من تكرارها مؤخراً؟ 🎶',
      '💡 سؤال لكسر الجليد: لو كنت تستطيع السفر عبر الزمن، إلى أي عصر ستذهب؟ 🚀',
      '💡 سؤال لكسر الجليد: ما هو أكثر موقف مضحك أو غريب حدث معك هذا العام؟ 😂',
      '💡 سؤال لكسر الجليد: ما هو مشروبك المفضل في أوقات الرواق والهدوء؟ ☕'
    ];
    let iceIndex = 0;
    iceBtn.onclick = () => {
      iceCard.style.display = 'block';
      iceCard.innerText = icebreakers[iceIndex % icebreakers.length];
      iceIndex++;
      triggerVoiceMatchReactionBurst('💡');
    };

    // Wire Reactions
    const reactBtn = modal.querySelector('#vmatch-reaction-btn');
    const emojis = ['❤️', '👏', '😂', '🔥', '🌹'];
    let emojiIdx = 0;
    reactBtn.onclick = () => {
      const em = emojis[emojiIdx % emojis.length];
      emojiIdx++;
      triggerVoiceMatchReactionBurst(em);
      state.socket.emit('voice_match_reaction', {
        sessionId: data.sessionId,
        emoji: em
      });
    };

    // Wire Next Match
    const nextBtn = modal.querySelector('#vmatch-next-match-btn');
    nextBtn.onclick = () => {
      state.socket.emit('end_voice_match', { sessionId: data.sessionId });
      closeVoiceMatchScreen(false);
      startVoiceMatchSession('voice');
    };
  }

  // Handle Mutual Reveal: Transitions call into UNLIMITED & Reveals full profile
  function handleVoiceMatchMutualReveal(payload) {
    if (!activeVoiceMatchSession) return;
    activeVoiceMatchSession.isUnlimited = true;

    // Stop countdown timer
    if (voiceMatchTimerInterval) {
      clearInterval(voiceMatchTimerInterval);
    }

    // Update timer badge to Unlimited
    const timerEl = document.getElementById('vmatch-timer-display');
    if (timerEl) {
      timerEl.innerText = '♾️ مكالمة بلا حدود (صداقة مؤكدة 🎉)';
      timerEl.className = 'vmatch-timer-badge unlimited';
    }

    // Play celebration sound
    if (window.soundManager && typeof window.soundManager.playLevelUp === 'function') {
      window.soundManager.playLevelUp();
    } else if (window.soundManager && typeof window.soundManager.playCheer === 'function') {
      window.soundManager.playCheer();
    }

    // Reveal Partner Profile
    if (payload.realPartner) {
      const partnerImg = document.getElementById('vmatch-partner-avatar-img');
      if (partnerImg) {
        partnerImg.src = payload.realPartner.avatar || '/avatars/avatar-2.png';
        if (payload.realPartner.avatar_frame) {
          partnerImg.className = `avatar-frame-${payload.realPartner.avatar_frame}`;
        }
      }

      const partnerName = document.getElementById('vmatch-partner-name-label');
      if (partnerName) {
        partnerName.innerText = payload.realPartner.name;
      }

      const partnerMask = document.getElementById('vmatch-partner-mask-tag');
      if (partnerMask) {
        partnerMask.innerText = '👑';
      }

      const partnerPlanet = document.getElementById('vmatch-partner-planet-label');
      if (partnerPlanet) {
        partnerPlanet.innerText = payload.realPartner.soul_planet || 'كوكب الروح 🌌';
      }
    }

    // Reveal Self Profile
    if (payload.realSelf || state.currentUser) {
      const self = payload.realSelf || state.currentUser;
      const selfImg = document.getElementById('vmatch-self-avatar-img');
      if (selfImg) {
        selfImg.src = self.avatar;
        if (self.avatar_frame) {
          selfImg.className = `avatar-frame-${self.avatar_frame}`;
        }
      }

      const selfName = document.getElementById('vmatch-self-name-label');
      if (selfName) {
        selfName.innerText = self.name;
      }

      const selfMask = document.getElementById('vmatch-self-mask-tag');
      if (selfMask) {
        selfMask.innerText = '🌟';
      }
    }

    // Replace Reveal Box with Celebration Banner and Action Buttons
    const revealBox = document.getElementById('vmatch-reveal-box');
    if (revealBox) {
      revealBox.innerHTML = `
        <div class="vmatch-success-banner">
          🎉 مبروك! كشف كلاكما الهوية بنجاح! أصبحت المكالمة الآن <strong>مستمرة بلا حدود زمنية ومفتوحة للأبد</strong>، مرحباً بالصداقة الجديدة! ✨
        </div>
        <div style="display: flex; gap: 8px; justify-content: center; margin-top: 12px;">
          <button class="wallet-btn primary" id="btn-vmatch-friend-add" style="padding: 10px 18px; font-size: 13px;">
            ➕ متابعة وصداقة
          </button>
          <button class="wallet-btn" id="btn-vmatch-send-gift-live" style="background: linear-gradient(135deg, #ec4899, #8b5cf6); color: #fff; padding: 10px 18px; font-size: 13px;">
            🎁 إرسال هدية للمتحدث
          </button>
        </div>
      `;

      revealBox.querySelector('#btn-vmatch-friend-add').onclick = () => {
        showToast(`🎉 تم إرسال طلب الصداقة بنجاح إلى ${payload.realPartner.name}!`);
      };

      revealBox.querySelector('#btn-vmatch-send-gift-live').onclick = () => {
        openGiftStoreModal(payload.realPartner.id, null, payload.realPartner);
      };
    }

    // Trigger celebration emojis
    for (let i = 0; i < 6; i++) {
      setTimeout(() => triggerVoiceMatchReactionBurst('🎉'), i * 200);
      setTimeout(() => triggerVoiceMatchReactionBurst('💖'), i * 300);
    }
  }

  // Setup Web Audio Capture for Local Voice Waves
  async function setupVoiceMatchAudioCapture() {
    try {
      voiceMatchMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        voiceMatchAudioContext = new AudioCtx();
        const source = voiceMatchAudioContext.createMediaStreamSource(voiceMatchMicStream);
        voiceMatchAnalyser = voiceMatchAudioContext.createAnalyser();
        voiceMatchAnalyser.fftSize = 64;
        source.connect(voiceMatchAnalyser);

        const dataArray = new Uint8Array(voiceMatchAnalyser.frequencyBinCount);

        const updateWaveAnimation = () => {
          if (!activeVoiceMatchSession || !document.getElementById('voice-match-active-modal')) return;
          voiceMatchAnalyser.getByteFrequencyData(dataArray);

          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = sum / dataArray.length;

          const waveBars = document.querySelectorAll('#vmatch-audio-waves .vmatch-wave-bar');
          waveBars.forEach((bar, idx) => {
            const h = Math.max(4, Math.min(26, (dataArray[idx * 2] || 10) / 8));
            bar.style.height = `${h}px`;
          });

          const selfCircle = document.getElementById('vmatch-self-avatar-circle');
          if (selfCircle) {
            const isSpeaking = avg > 25 && !isVoiceMatchMuted;
            selfCircle.classList.toggle('speaking', isSpeaking);
          }

          requestAnimationFrame(updateWaveAnimation);
        };
        updateWaveAnimation();
      }
    } catch (err) {
      console.log('Voice match audio capture initialized in simulation mode:', err.message);
    }
  }

  // Partner Voice Simulation for natural call dynamics
  function startPartnerVoiceWaveSimulation() {
    let partnerSpeaking = false;
    voiceMatchSimInterval = setInterval(() => {
      if (!activeVoiceMatchSession || !document.getElementById('voice-match-active-modal')) return;
      partnerSpeaking = Math.random() > 0.45;
      const partnerCircle = document.getElementById('vmatch-partner-avatar-circle');
      if (partnerCircle) {
        partnerCircle.classList.toggle('speaking', partnerSpeaking);
      }
    }, 2500);
  }

  // Reaction Emoji Float-Up Burst Animation
  function triggerVoiceMatchReactionBurst(emoji) {
    const modal = document.getElementById('voice-match-active-modal') || document.body;
    const emEl = document.createElement('div');
    emEl.className = 'vmatch-floating-emoji';
    emEl.innerText = emoji;
    emEl.style.left = `${35 + Math.random() * 30}%`;
    modal.appendChild(emEl);

    setTimeout(() => emEl.remove(), 2100);
  }

  // Close Voice Match Call Screen and clean up
  function closeVoiceMatchScreen(notify = false) {
    if (voiceMatchTimerInterval) {
      clearInterval(voiceMatchTimerInterval);
      voiceMatchTimerInterval = null;
    }
    if (voiceMatchSimInterval) {
      clearInterval(voiceMatchSimInterval);
      voiceMatchSimInterval = null;
    }
    if (voiceMatchMicStream) {
      voiceMatchMicStream.getTracks().forEach(t => t.stop());
      voiceMatchMicStream = null;
    }
    if (voiceMatchAudioContext) {
      voiceMatchAudioContext.close().catch(() => {});
      voiceMatchAudioContext = null;
    }

    const modal = document.getElementById('voice-match-active-modal');
    if (modal) modal.remove();

    activeVoiceMatchSession = null;
    if (notify) {
      showToast('تمت مغادرة مكالمة التوافق الصوتي 🪐');
    }
  }

  // Planet Tab Events Modal (Matching Events Card)
  function showPlanetEventsModal() {
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'planet-events-modal';
    modal.innerHTML = `
      <div class="soul-modal-content" style="max-width: 400px; text-align: center; padding: 24px;">
        <button class="soul-modal-close-btn" id="close-events-btn">✕</button>
        <div style="font-size: 36px; margin-bottom: 8px;">🎈🎪</div>
        <div style="font-size: 18px; font-weight: 800; color: #fff; margin-bottom: 4px;">فعاليات ومهرجانات كوكب SoulChill</div>
        <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px;">شارك في بطولات الغرف والصوت واكسب جوائز ضخمة!</div>

        <div style="display: flex; flex-direction: column; gap: 10px; text-align: right; margin-bottom: 16px;">
          <div style="background: rgba(255,255,255,0.06); border: 1px solid var(--border-glass); border-radius: 14px; padding: 12px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-size: 13px; font-weight: 800; color: #fbbf24;">🎙️ مسابقة بلبل السول (Soul Voice)</div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">جوائز تصل إلى 100,000 كوينز + إطار ذهبي</div>
            </div>
            <button class="wallet-btn primary" style="padding: 6px 12px; font-size: 11px;">انضمام</button>
          </div>

          <div style="background: rgba(255,255,255,0.06); border: 1px solid var(--border-glass); border-radius: 14px; padding: 12px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-size: 13px; font-weight: 800; color: #ec4899;">💖 كرنفال التوافق والهدايا (Soul Match Fiesta)</div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">تضاعف نقاط التوافق 2X عند كشف الهوية</div>
            </div>
            <button class="wallet-btn primary" style="padding: 6px 12px; font-size: 11px;">مشاركة</button>
          </div>
        </div>

        <button class="wallet-btn secondary" id="close-events-btn-bottom" style="width: 100%;">إغلاق</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#close-events-btn').onclick = () => modal.remove();
    modal.querySelector('#close-events-btn-bottom').onclick = () => modal.remove();
  }

  // First Recharge Rewards Modal (مكافآت الشحنة الاولى)
  function showOneTimeOfferModal() {
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'one-time-offer-modal';
    modal.innerHTML = `
      <div class="soul-modal-content" style="max-width: 360px; text-align: center; padding: 24px;">
        <button class="soul-modal-close-btn" id="close-offer-btn">✕</button>
        <div style="font-size: 44px; margin-bottom: 8px;">🎁✨</div>
        <div style="font-size: 18px; font-weight: 900; color: #fff; margin-bottom: 4px;">مكافآت الشحنة الاولى</div>
        <div style="font-size: 12px; color: #fde047; font-weight: 700; margin-bottom: 16px;">خصم 70% + 5,000 كوينز إضافية وإطار ملكي فاخر مجاناً!</div>

        <div style="background: rgba(0,0,0,0.4); border: 1.5px dashed #fbbf24; border-radius: 16px; padding: 14px; margin-bottom: 16px;">
          <div style="font-size: 24px; font-weight: 900; color: #fff;">10,000 🪙 + إطار VIP</div>
          <div style="font-size: 13px; color: #10b981; font-weight: 800; margin-top: 4px;">استلم هدايا الشحنة الأولى فوراً</div>
        </div>

        <button class="wallet-btn primary" id="claim-offer-btn" style="width: 100%; padding: 12px; font-size: 14px; font-weight: 800;">
          ⚡ استلام وشحن العرض الآن
        </button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#close-offer-btn').onclick = () => modal.remove();
    modal.querySelector('#claim-offer-btn').onclick = () => {
      modal.remove();
      openWalletModal();
    };
  }

  // Soul Test Quiz Modal

  // ===== أعلام الدول: صور SVG من /flags (الإيموجي لا يظهر على ويندوز) =====
  function flagCodeFromEmoji(e) {
    if (!e) return '';
    const cps = Array.from(e).map(ch => ch.codePointAt(0));
    if (cps.length === 2 && cps.every(c => c >= 0x1F1E6 && c <= 0x1F1FF)) {
      return String.fromCharCode(cps[0] - 0x1F1E6 + 65, cps[1] - 0x1F1E6 + 65);
    }
    return e === '🌍' ? 'GLOBAL' : '';
  }
  function flagImg(code, emoji) {
    const c = String(code || flagCodeFromEmoji(emoji) || '').toUpperCase();
    if (!/^[A-Z]{2,6}$/.test(c)) return emoji || '🌍';
    return `<img class="flag-img" src="/flags/${c}.svg" alt="${c}" loading="lazy" draggable="false" onerror="this.replaceWith(document.createTextNode('${(emoji || '🌍').replace(/'/g, '')}'))">`;
  }

  function showSoulTestModal() {
    const questions = [
      {
        q: 'كيف تحب قضاء أمسيتك المثالية؟',
        options: [
          { text: 'سماع موسيقى هادئة وتأمل النجوم 🌌', type: 'dreamer' },
          { text: 'طلعة ومغامرة وسوالف مع الأصدقاء 🚀', type: 'adventurer' },
          { text: 'جلسة رواق مع كتاب وفنجان قهوة 🔮', type: 'philosopher' },
          { text: 'تحديات ألعاب وبثوث حماسية ⚡', type: 'gamer' }
        ]
      },
      {
        q: 'ما هو العنصر الفلكي الأكثر تعبيراً عن شخصيتك؟',
        options: [
          { text: 'الماء: عميق ورومانسي وشفاف 💧', type: 'dreamer' },
          { text: 'النار: شغوف ومليء بالحماس والطاقة 🔥', type: 'adventurer' },
          { text: 'الهواء: حر ومفكر ومحب للحرية 🌬️', type: 'philosopher' },
          { text: 'الأرض: متزن وفنان ومبدع 🎨', type: 'artist' }
        ]
      },
      {
        q: 'ما الذي يجذبك أولاً في الأشخاص الآخرين؟',
        options: [
          { text: 'دفء الروح ونبرة الصوت الهادئة 🎶', type: 'dreamer' },
          { text: 'حس الفكاهة والضحك العفوي 😂', type: 'adventurer' },
          { text: 'الذكاء والحديث العميق الفلسفي 🧠', type: 'philosopher' },
          { text: 'الإيجابية والحماس المشترك ⚡', type: 'gamer' }
        ]
      }
    ];

    let currentQ = 0;
    const answers = [];

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'soul-test-modal';

    function renderQuestion() {
      const q = questions[currentQ];
      modal.innerHTML = `
        <div class="soul-modal-content">
          <button class="soul-modal-close-btn" id="close-test-btn">✕</button>
          <div class="modal-header-title">اختبار توافق الروح 🪐 (سؤال ${currentQ + 1} من ${questions.length})</div>

          <div style="font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 16px; text-align: center;">
            ${q.q}
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${q.options.map((opt, i) => `
              <button class="google-account-option soul-quiz-opt" data-idx="${i}" style="border-radius: var(--radius-full); padding: 10px 14px; font-size: 13px;">
                ${opt.text}
              </button>
            `).join('')}
          </div>
        </div>
      `;

      modal.querySelector('#close-test-btn').onclick = () => modal.remove();

      modal.querySelectorAll('.soul-quiz-opt').forEach(btn => {
        btn.onclick = async () => {
          if (window.soundManager) window.soundManager.playClick();
          const chosenOpt = q.options[parseInt(btn.dataset.idx)];
          answers.push(chosenOpt);

          currentQ++;
          if (currentQ < questions.length) {
            renderQuestion();
          } else {
            // Finished!
            modal.innerHTML = `
              <div class="soul-modal-content" style="text-align: center;">
                <div style="font-size: 40px; margin-bottom: 10px;">🔮</div>
                <div class="modal-header-title">جارِ تحليل ذبذبات روحك الفلكية...</div>
                <div style="font-size: 12px; color: var(--text-secondary);">نحسب توافق كوكبك في مجرة SoulChill</div>
              </div>
            `;

            try {
              const res = await fetch('/api/users/soul-test', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-user-id': state.currentUser.id
                },
                body: JSON.stringify({ answers })
              });
              const data = await res.json();
              if (data.success) {
                state.currentUser = data.user;
                localStorage.setItem('soulchill_user', JSON.stringify(data.user));
                if (window.soundManager) window.soundManager.playCheer();

                modal.innerHTML = `
                  <div class="soul-modal-content" style="text-align: center;">
                    <div style="font-size: 50px; margin-bottom: 10px;">🪐</div>
                    <div class="modal-header-title">تهانينا! اكتمل اختبار الروح ✨</div>
                    <div class="profile-planet-pill" style="font-size: 14px; margin: 10px auto;">${data.planet}</div>
                    <div style="font-size: 13px; color: #fbbf24; font-weight: 700; margin-bottom: 14px;">
                      مستوى توافق الروح: ${data.score}% 🔥
                    </div>
                    <button class="soul-submit-btn" id="finish-test-btn" style="width: 100%;">
                      دخول المجرة الآن 🚀
                    </button>
                  </div>
                `;
                modal.querySelector('#finish-test-btn').onclick = () => {
                  modal.remove();
                  switchTab('planet');
                };
              }
            } catch (err) {
              console.error('Soul test error:', err);
              modal.remove();
            }
          }
        };
      });
    }

    renderQuestion();
    document.body.appendChild(modal);
  }

  // ============================================
  // TAB 2: VOICE PARTY ROOMS & COUNTRY CLASSIFICATION
  // ============================================
  async function renderRoomsTab(container) {
    if (!state.myGeo) {
      await fetchGeoLocation();
    }

    const myCountryCode = state.myGeo?.country_code || 'JO';
    const myCountryName = state.myGeo?.country_name || 'الأردن';
    const myCountryFlag = state.myGeo?.country_flag || '🇯🇴';
    const countries = state.countriesList || [];

    // بيانات دولة عرض (علم + اسم) من الرمز
    const getCountryInfo = (code) => {
      if (code === myCountryCode) return { flag: flagImg(code, myCountryFlag), name: myCountryName };
      const found = countries.find(c => c.code === code);
      return found ? { flag: flagImg(found.code, found.flag), name: found.name } : { flag: flagImg('GLOBAL', '🌍'), name: code };
    };
    const tabCountry = getCountryInfo(state.selectedCountry && state.selectedCountry !== 'all' ? state.selectedCountry : myCountryCode);

    // شريط الدول: يظهر عند النقر على دولة المستخدم في شريط التصنيفات (دولته أولاً ثم بقية الدول)
    const countryBarHtml = `
      <div class="rooms-country-bar ${state.selectedCountry && state.selectedCountry !== 'all' ? 'open' : ''}" id="rooms-country-bar">
        <button class="country-pill ${state.selectedCountry === myCountryCode ? 'active' : ''}" data-country="${myCountryCode}">
          <span class="pill-flag">${flagImg(myCountryCode, myCountryFlag)}</span>
          <span>${myCountryName}</span>
        </button>
        ${countries.filter(c => c.code !== 'GLOBAL' && c.code !== myCountryCode).map(c => `
          <button class="country-pill ${state.selectedCountry === c.code ? 'active' : ''}" data-country="${c.code}">
            <span class="pill-flag">${flagImg(c.code, c.flag)}</span>
            <span>${c.name}</span>
          </button>
        `).join('')}
      </div>
    `;

    container.innerHTML = `
      <div class="rooms-view-container">
        <!-- شريط البحث (يُفتح من أيقونة البحث في الشريط العلوي) -->
        <div class="rooms-search-row" id="rooms-search-row" style="display:none;">
          <input type="search" id="rooms-search-input" class="rooms-search-input" placeholder="ابحث عن غرفة أو مضيف..." autocomplete="off" />
        </div>
        <!-- Room Categories Bar (Voice Rooms Only) + دولة المستخدم كآخر تبويب -->
        <div class="rooms-cat-wrap">
        <div class="rooms-category-bar">
          <button class="cat-pill" data-cat="all">🌟 الكل</button>
          <button class="cat-pill" data-cat="favorites">❤️ المفضلة</button>
          <button class="cat-pill" data-cat="music">🎶 طرب وموسيقى</button>
          <button class="cat-pill" data-cat="chat">💬 سوالف وجمعة</button>
          <button class="cat-pill" data-cat="chill">☕ هدوء ورواق</button>
          <button class="cat-pill" data-cat="gaming">🎮 مسابقات وألعاب</button>
          <button class="cat-pill" data-cat="dating">🔮 كواكب وأبراج</button>
          <button class="cat-pill country-tab-pill" id="country-tab-btn">
            <span class="country-tab-label">${tabCountry.flag} <span>${tabCountry.name}</span></span>
            <span class="country-tab-caret">⌄</span>
          </button>
        </div>
        <button type="button" class="rooms-view-toggle" id="rooms-view-toggle" aria-label="تبديل عرض الغرف"></button>
        </div>

        <!-- Regional Country Filter Bar (يظهر عند النقر على دولتك) -->
        ${countryBarHtml}

        <!-- المتابَعون الموجودون الآن في غرف -->
        <div class="rooms-followed-strip" id="rooms-followed-strip" style="display:none;"></div>

        <!-- Rooms Grid -->
        <div class="rooms-grid" id="rooms-grid-list">
          <div style="grid-column: 1/-1; text-align: center; padding: 20px; color: var(--text-muted);">
            جارِ تحميل الغرف الصوتية...
          </div>
        </div>
      </div>
    `;

    // زر تبديل عرض الغرف: مستطيلات (بإطار صاحب الغرفة) ⇄ مربعات بصورة الغرفة (غرفتان في كل سطر)
    const viewToggleBtn = container.querySelector('#rooms-view-toggle');
    const paintViewToggle = () => {
      if (!viewToggleBtn) return;
      viewToggleBtn.innerHTML = getRoomsViewMode() === 'grid' ? ROOMS_ICON_LIST : ROOMS_ICON_GRID;
    };
    if (viewToggleBtn) {
      paintViewToggle();
      viewToggleBtn.onclick = () => {
        setRoomsViewMode(getRoomsViewMode() === 'grid' ? 'list' : 'grid');
        paintViewToggle();
        applyRoomsFilters();
      };
    }

    // Load rooms
    await loadRoomsList();
    refreshFollowingBubble();
    loadFollowedStrip();

    // أزرار الشريط العلوي الثابت لتبويب «حفلة»
    state.roomSearch = '';
    const searchRow = container.querySelector('#rooms-search-row');
    const searchInput = container.querySelector('#rooms-search-input');
    const topCreateBtn = document.getElementById('rooms-top-create-btn');
    const topInterestsBtn = document.getElementById('rooms-top-interests-btn');
    const topSearchBtn = document.getElementById('rooms-top-search-btn');
    if (topCreateBtn) topCreateBtn.onclick = () => showCreateRoomModal();
    if (topInterestsBtn) topInterestsBtn.onclick = () => openInterestsCenter('favorites');
    if (topSearchBtn) topSearchBtn.onclick = () => {
      const open = searchRow.style.display === 'none';
      searchRow.style.display = open ? 'block' : 'none';
      topSearchBtn.classList.toggle('active', open);
      if (open) { searchInput.focus(); }
      else { searchInput.value = ''; state.roomSearch = ''; applyRoomsFilters(); }
    };
    searchInput.oninput = () => {
      state.roomSearch = searchInput.value.trim().toLowerCase();
      applyRoomsFilters();
    };

    const countryBarEl = container.querySelector('#rooms-country-bar');
    const countryTabBtn = container.querySelector('#country-tab-btn');

    // مزامنة الحالة الظاهرة: تبويب واحد فقط نشط (تصنيف أو دولة)
    const syncRoomsNavUI = () => {
      const countryActive = !!state.selectedCountry && state.selectedCountry !== 'all';
      const info = getCountryInfo(countryActive ? state.selectedCountry : myCountryCode);
      countryTabBtn.querySelector('.country-tab-label').innerHTML = `${info.flag} <span>${info.name}</span>`;
      countryTabBtn.classList.toggle('active', countryActive);
      container.querySelectorAll('.cat-pill[data-cat]').forEach(b => {
        b.classList.toggle('active', !countryActive && b.dataset.cat === state.selectedCategory);
      });
      container.querySelectorAll('.country-pill').forEach(b => {
        b.classList.toggle('active', b.dataset.country === state.selectedCountry);
      });
    };
    syncRoomsNavUI();

    // النقر على دولة المستخدم: يفتح شريط الدول ويعرض غرف دولته (والنقر مجدداً يطوي الشريط)
    countryTabBtn.onclick = () => {
      if (!state.selectedCountry || state.selectedCountry === 'all') {
        state.selectedCountry = myCountryCode;
        countryBarEl.classList.add('open');
      } else {
        countryBarEl.classList.toggle('open');
      }
      syncRoomsNavUI();
      applyRoomsFilters();
    };

    // اختيار دولة من الشريط
    container.querySelectorAll('.country-pill').forEach(btn => {
      btn.onclick = () => {
        state.selectedCountry = btn.dataset.country;
        syncRoomsNavUI();
        applyRoomsFilters();
      };
    });

    // اختيار تصنيف: يلغي فلتر الدولة ويطوي شريط الدول
    container.querySelectorAll('.cat-pill[data-cat]').forEach(btn => {
      btn.onclick = () => {
        state.selectedCategory = btn.dataset.cat;
        state.selectedCountry = 'all';
        countryBarEl.classList.remove('open');
        syncRoomsNavUI();
        applyRoomsFilters();
      };
    });
  }

  function getActiveCountryLabel() {
    if (!state.selectedCountry || state.selectedCountry === 'all') {
      return 'جميع الدول (عالمي 🌍)';
    }
    const found = (state.countriesList || []).find(c => c.code === state.selectedCountry);
    if (found) return `${found.flag} ${found.name}`;
    if (state.myGeo && state.selectedCountry === state.myGeo.country_code) {
      return `${state.myGeo.country_flag} ${state.myGeo.country_name} (دولتي)`;
    }
    return state.selectedCountry;
  }

  function applyRoomsFilters() {
    let filtered = state.rooms;

    const countryActive = !!state.selectedCountry && state.selectedCountry !== 'all';

    if (countryActive) {
      // اختيار دولة: كل غرف هذه الدولة بجميع الأصناف، والأكثر زائرين في الأعلى
      filtered = filtered
        .filter(r => r.country_code === state.selectedCountry)
        .slice()
        .sort((a, b) => (b.audience_count || 0) - (a.audience_count || 0));
    } else if (state.selectedCategory === 'favorites') {
      filtered = filtered.filter(r => isRoomFavorited(r.id));
    } else if (state.selectedCategory && state.selectedCategory !== 'all') {
      filtered = filtered.filter(r => r.category === state.selectedCategory);
    }

    if (state.roomSearch) {
      const q = state.roomSearch;
      filtered = filtered.filter(r =>
        String(r.title || '').toLowerCase().includes(q) ||
        String(r.host_name || '').toLowerCase().includes(q) ||
        String(r.id || '').toLowerCase().includes(q)
      );
    }

    renderRoomsGrid(filtered);
  }

  async function loadRoomsList() {
    try {
      await loadFavoriteRooms();
      const res = await fetch('/api/rooms');
      state.rooms = await res.json();
      applyRoomsFilters();
    } catch (err) {
      console.error('Error fetching rooms:', err);
    }
  }

  const ROOMS_ICON_GRID = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><circle cx="6" cy="6" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="12" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>';
  const ROOMS_ICON_LIST = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  function getRoomsViewMode() {
    if (!state.roomsView) {
      let v = 'list';
      try { v = localStorage.getItem('soulchill_rooms_view') === 'grid' ? 'grid' : 'list'; } catch (e) {}
      state.roomsView = v;
    }
    return state.roomsView;
  }
  function setRoomsViewMode(mode) {
    state.roomsView = mode === 'grid' ? 'grid' : 'list';
    try { localStorage.setItem('soulchill_rooms_view', state.roomsView); } catch (e) {}
  }
  const cssUrl = (u) => encodeURI(String(u || '')).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/"/g, '%22');

  function renderRoomsGrid(rooms) {
    const grid = document.getElementById('rooms-grid-list');
    if (!grid) return;
    const squareMode = getRoomsViewMode() === 'grid';
    grid.classList.toggle('view-grid', squareMode);

    if (rooms.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 30px; color: var(--text-muted);">
          ${(state.selectedCountry && state.selectedCountry !== 'all')
            ? 'لا توجد غرف صوتية في هذه الدولة حالياً.. كن أول من ينشئ غرفة! 🎙️🌟'
            : state.selectedCategory === 'favorites' 
            ? 'لا توجد غرف مضافة إلى المفضلة حالياً.. اضغط على ❤️ بجانب اسم أي غرفة لإضافتها للمفضلة!' 
            : 'لا توجد غرف صوتية نشطة في هذا القسم حالياً.. كن أول من ينشئ غرفة صوتية! 🎙️🌟'}
        </div>
      `;
      return;
    }

    grid.innerHTML = rooms.map(room => {
      const countryBadgeHtml = `<span class="room-country-badge" title="${room.country_name || ''}">${flagImg(room.country_code, room.country_flag || '🇯🇴')}</span>`;
      const isFav = isRoomFavorited(room.id);

      // Voice Party Room Card (All rooms are voice rooms)
      const speakersHtml = (room.seats || [])
        .filter(s => s.user_id && s.avatar)
        .slice(0, 4)
        .map(s => `<img src="${s.avatar}" class="speaker-mini-avatar" />`)
        .join('');

      const cat = icCat(room.category);
      if (squareMode) {
        // عرض المربعات: صورة الغرفة تملأ البطاقة، والمعلومات أسفلها
        const cover = cssUrl(room.cover_image || room.host_avatar || '/avatars/avatar-1.png');
        return `
        <div class="room-card room-card-sq" data-room-id="${room.id}" data-room-type="voice" style="--rc-cover:url('${cover}')">
          <div class="rcs-info">
            <div class="rcs-title" title="${room.title}">${room.title}</div>
            <div class="rcs-meta">
              <span class="room-card-audience"><span class="rc-bars"><i></i><i></i><i></i></span><span class="room-card-audience-count" data-room-id="${room.id}">${room.audience_count !== undefined ? room.audience_count : 0}</span></span>
              <span class="room-card-tag"><i>${cat.icon}</i>${getCategoryLabel(room.category).replace(/_/g, ' ')}</span>
              ${countryBadgeHtml}
            </div>
          </div>
        </div>`;
      }
      const cardImg = room.host_room_card ? encodeURI(String(room.host_room_card)).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/"/g, '%22') : '';
      return `
        <div class="room-card ${cardImg ? 'has-card' : ''}" data-room-id="${room.id}" data-room-type="voice" ${cardImg ? `style="--rc-img:url('${cardImg}')"` : ''}>
          <img src="${room.host_avatar}" class="room-host-avatar ${room.host_frame ? 'avatar-frame-' + room.host_frame : ''}" onerror="this.src='/avatars/avatar-1.png'" />
          <div class="room-card-info">
            <div class="room-card-title-row">
              <div class="room-card-title" title="${room.title}">${room.title}</div>
            </div>
            <div class="room-card-chips">
              <span class="room-card-tag"><i>${cat.icon}</i>${getCategoryLabel(room.category).replace(/_/g, ' ')}</span>
              ${countryBadgeHtml}
            </div>
            <div class="room-card-speakers-preview">
              <div class="room-card-audience"><span class="rc-bars"><i></i><i></i><i></i></span><span class="room-card-audience-count" data-room-id="${room.id}">${room.audience_count !== undefined ? room.audience_count : 0}</span></div>
              <div class="room-card-minis">${speakersHtml}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.room-card-fav-btn').forEach(favBtn => {
      favBtn.onclick = (e) => {
        e.stopPropagation();
        toggleFavoriteRoom(favBtn.dataset.roomId, favBtn);
      };
    });

    grid.querySelectorAll('.room-card').forEach(card => {
      card.onclick = () => {
        const roomId = card.dataset.roomId;
        openVoiceRoom(roomId);
      };
    });
  }

  function getCategoryLabel(cat) {
    const map = {
      music: 'طرب_وموسيقى',
      chat: 'سوالف_وجمعة',
      chill: 'هدوء_ورواق',
      dating: 'توافق_وأبراج',
      gaming: 'ألعاب_وتحديات'
    };
    return map[cat] || 'روم_عام';
  }

  // Delete Room by ID Helper (Host & Owner)
  async function deleteRoomById(roomId) {
    if (!state.currentUser) return false;
    const confirmDel = await uiConfirm('هل أنت متأكد من حذف هذه الغرفة نهائياً؟ سيتم طرد جميع الحضور وإزالتها من القائمة.', { icon: '🗑️', title: 'حذف الغرفة', danger: true, okText: 'حذف' });
    if (!confirmDel) return false;

    try {
      const res = await fetch(`/api/rooms/${roomId}`, {
        method: 'DELETE',
        headers: {
          'x-user-id': state.currentUser.id
        }
      });
      const data = await res.json();
      if (data.success) {
        showToast('تم حذف الغرفة نهائياً وإزالتها من القائمة 🗑️');
        state.rooms = state.rooms.filter(r => r.id !== roomId);
        applyRoomsFilters();
        return true;
      } else {
        showToast(data.error || 'فشل حذف الغرفة');
        return false;
      }
    } catch (err) {
      console.error('Error deleting room:', err);
      showToast('حدث خطأ أثناء محاولة حذف الغرفة');
      return false;
    }
  }

  // Notice modal when member tries to create more than one room
  function showExistingRoomNoticeModal(existingRoom) {
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'existing-room-notice-modal';

    modal.innerHTML = `
      <div class="soul-modal-content" style="max-width: 380px; text-align: center; padding: 24px;">
        <button class="soul-modal-close-btn" id="close-exist-notice-btn">✕</button>
        <div style="font-size: 42px; margin-bottom: 10px;">⚠️🚪</div>
        <div style="font-size: 17px; font-weight: 800; color: #fff; margin-bottom: 6px;">
          لديك غرفة نشطة بالفعل!
        </div>
        <div style="font-size: 13px; color: #fbbf24; font-weight: 700; margin-bottom: 12px;">
          "${existingRoom.title}"
        </div>
        <p style="font-size: 12px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 20px;">
          وفقاً لقوانين تطبيق <strong>SoulChill</strong>، يحق لكل عضو إنشاء غرفة أو بث مباشر واحد فقط في نفس الوقت.
          لإنشاء غرفة جديدة، يجب عليك أولاً <strong>حذف أو إغلاق غرفتك الحالية</strong>.
        </p>

        <div style="display: flex; flex-direction: column; gap: 8px;">
          <button class="wallet-btn primary" id="btn-goto-existing-room" style="padding: 11px; font-size: 13px;">
            🚪 الدخول إلى غرفتي الحالية
          </button>
          <button class="wallet-btn danger" id="btn-delete-and-recreate" style="background: rgba(239,68,68,0.25); border: 1px solid #ef4444; color: #fca5a5; padding: 11px; font-size: 13px;">
            🗑️ حذف الغرفة الحالية وإنشاء غرفة جديدة
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-exist-notice-btn').onclick = () => modal.remove();

    modal.querySelector('#btn-goto-existing-room').onclick = () => {
      modal.remove();
      openVoiceRoom(existingRoom.id);
    };

    modal.querySelector('#btn-delete-and-recreate').onclick = async () => {
      const ok = await deleteRoomById(existingRoom.id);
      if (ok) {
        modal.remove();
        showCreateRoomModal();
      }
    };
  }

  // Create Voice Room Modal (Voice Only)
  async function showCreateRoomModal() {
    if (!requireAuth()) return;

    // قاعدة الغرفة الواحدة: من لديه غرفة لا يرى نموذج الإنشاء، بل يدخل غرفته مباشرة
    // ولا يمكنه إنشاء غرفة أخرى قبل حذف غرفته الحالية (نتحقق من القائمة الحديثة لا المخزنة)
    let allRooms = Array.isArray(state.rooms) ? state.rooms : [];
    try {
      const fresh = await fetch('/api/rooms', { cache: 'no-store' });
      if (fresh.ok) { const list = await fresh.json(); if (Array.isArray(list)) { allRooms = list; state.rooms = list; } }
    } catch (e) { /* نكمل بالقائمة المحفوظة */ }
    const existing = allRooms.find(r => r.host_id === state.currentUser?.id);
    if (existing) {
      showToast('لديك غرفة بالفعل 🚪 احذفها أولاً لتتمكن من إنشاء غرفة جديدة');
      openVoiceRoom(existing.id);
      return;
    }

    const selectedRoomType = 'voice';
    const presetCovers = [
      'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=600&q=80'
    ];
    let selectedCover = presetCovers[0];

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'create-room-modal';
    modal.innerHTML = `
      <div class="soul-modal-content" style="max-width: 420px;">
        <button class="soul-modal-close-btn" id="close-create-room-btn">✕</button>
        <div class="modal-header-title">🎙️ إنشاء غرفة صوتية جديدة (SoulChill Voice Room)</div>

        <div class="custom-google-login-form" style="margin-top: 6px; padding-top: 0; border: none;">
          <div class="form-group-soul">
            <label>عنوان الغرفة الصوتية</label>
            <input type="text" id="new-room-title" class="form-input-soul" placeholder="مثال: سهرة طرب ووناسة وسوالف ليلية 🎙️✨" />
          </div>

          <div class="form-group-soul">
            <label>تصنيف الروم الصوتي</label>
            <select id="new-room-category" class="form-input-soul" style="background: rgba(255,255,255,0.08); color: #fff;">
              <option value="chill">☕ هدوء ورواق ودردشة</option>
              <option value="music">🎶 طرب وغناء وعزف</option>
              <option value="chat">💬 سوالف وجمعة وضحك</option>
              <option value="gaming">🎮 ألعاب ومسابقات صوتية</option>
              <option value="dating">🔮 تحليل شخصيات وتوافق كواكب</option>
            </select>
          </div>

          <!-- IP Detected Country Classification -->
          <div class="form-group-soul">
            <label>دولة الغرفة (تم التحديد تلقائياً عبر عنوان الـ IP الخاص بك)</label>
            <div class="ip-detected-pill" style="margin-bottom: 6px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>🌐 عنوان الـ IP المكتشف: <strong style="color: #fbbf24;">${state.myGeo?.ip || '127.0.0.1'}</strong></span>
                <span style="background: rgba(16,185,129,0.2); color: #10b981; padding: 2px 6px; border-radius: 4px; font-size: 10px;">✓ IP نشط</span>
              </div>
              <div style="margin-top: 4px;">📍 الدولة المحددة: <strong style="color: #fff;">${flagImg(state.myGeo?.country_code || 'JO', state.myGeo?.country_flag || '🇯🇴')} ${state.myGeo?.country_name || 'الأردن'} (${state.myGeo?.city || 'إربد'})</strong></div>
            </div>
            <select id="new-room-country" class="form-input-soul" style="background: rgba(255,255,255,0.08); color: #fff;">
              ${(state.countriesList || []).map(c => `
                <option value="${c.code}" ${(state.myGeo && state.myGeo.country_code === c.code) || (!state.myGeo && c.code === 'JO') ? 'selected' : ''}>
                  ${c.flag} ${c.name} ${c.isGlobal ? '(لجميع الدول)' : ''}
                </option>
              `).join('')}
            </select>
          </div>

          <div class="form-group-soul" id="cover-select-group">
            <label>صورة غلاف الغرفة الصوتية</label>
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
              <input type="file" id="room-custom-cover-input" accept="image/*" style="display: none;" />
              <button type="button" class="wallet-btn secondary" id="btn-trigger-room-upload" style="padding: 7px 12px; font-size: 11px;">
                📁 رفع صورة من جهازك
              </button>
              <span id="room-cover-upload-feedback" style="font-size: 11px; color: #10b981; display: none;">✅ تم الرفع!</span>
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">أو اختر من الأغلفة الجاهزة:</div>
            <div style="display: flex; gap: 6px; margin-top: 4px;">
              ${presetCovers.map((img, i) => `
                <img src="${img}" class="create-cover-thumb ${i === 0 ? 'selected' : ''}" data-url="${img}" style="width: 58px; height: 48px; border-radius: 8px; object-fit: cover; cursor: pointer; border: 2px solid ${i === 0 ? 'var(--primary)' : 'transparent'};" />
              `).join('')}
            </div>
          </div>

          <div class="form-group-soul">
            <label>رسالة الترحيب / الإعلان</label>
            <input type="text" id="new-room-announcement" class="form-input-soul" placeholder="أهلاً بكل من دخل الروم، شرفتونا! 🌟" />
          </div>

          <button class="soul-submit-btn" id="submit-create-room-btn" style="margin-top: 10px; padding: 12px; font-size: 14px;">
            إطلاق الغرفة الصوتية للجمهور الآن 🎙️🚀
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-create-room-btn').onclick = () => modal.remove();

    const submitBtn = modal.querySelector('#submit-create-room-btn');

    // Device File Upload Handler
    const triggerUploadBtn = modal.querySelector('#btn-trigger-room-upload');
    const fileInput = modal.querySelector('#room-custom-cover-input');
    const uploadFeedback = modal.querySelector('#room-cover-upload-feedback');

    triggerUploadBtn.onclick = () => fileInput.click();

    fileInput.onchange = async () => {
      if (!fileInput.files || !fileInput.files[0]) return;
      const file = fileInput.files[0];
      const formData = new FormData();
      formData.append('file', file);

      uploadFeedback.style.display = 'inline';
      uploadFeedback.style.color = '#fbbf24';
      uploadFeedback.innerText = 'جارِ رفع صورتك... ⏳';

      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (data.success && data.url) {
          selectedCover = data.url;
          uploadFeedback.style.color = '#10b981';
          uploadFeedback.innerText = '✅ تم رفع صورتك كغلاف!';
          modal.querySelectorAll('.create-cover-thumb').forEach(t => t.style.borderColor = 'transparent');
          showToast('تم رفع صورة غلاف الغرفة من جهازك بنجاح! 📸');
        } else {
          uploadFeedback.style.color = '#f43f5e';
          uploadFeedback.innerText = '❌ فشل الرفع';
        }
      } catch (err) {
        console.error('Upload error:', err);
        uploadFeedback.style.color = '#f43f5e';
        uploadFeedback.innerText = '❌ خطأ بالرفع';
      }
    };

    // Preset Cover picker
    modal.querySelectorAll('.create-cover-thumb').forEach(thumb => {
      thumb.onclick = () => {
        modal.querySelectorAll('.create-cover-thumb').forEach(t => t.style.borderColor = 'transparent');
        thumb.style.borderColor = 'var(--primary)';
        selectedCover = thumb.dataset.url;
        uploadFeedback.style.display = 'none';
      };
    });

    submitBtn.onclick = async () => {
      if (!requireAuth()) return;
      const title = modal.querySelector('#new-room-title').value.trim();
      const category = modal.querySelector('#new-room-category').value;
      const announcement = modal.querySelector('#new-room-announcement').value.trim();
      const country_code = modal.querySelector('#new-room-country')?.value || state.myGeo?.country_code || 'JO';

      if (!title) {
        showToast('يرجى كتابة عنوان للغرفة أو البث!');
        return;
      }

      try {
        const res = await fetch('/api/rooms', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': state.currentUser?.id || ''
          },
          body: JSON.stringify({
            title,
            category,
            country_code,
            room_type: selectedRoomType,
            cover_image: selectedCover,
            announcement,
            creator_id: state.currentUser?.id || ''
          })
        });
        const data = await res.json();
        if (data.hasActiveRoom && data.existingRoom) {
          modal.remove();
          showExistingRoomNoticeModal(data.existingRoom);
          return;
        }

        const roomData = data.room || (data.id ? data : null);
        if (data.success && roomData) {
          modal.remove();
          showToast(`تم إنشاء ${selectedRoomType === 'video' ? 'البث المباشر' : 'الغرفة الصوتية'} بنجاح! 🚀✨`);

          if (selectedRoomType === 'video') {
            openLiveVideoStream(roomData);
          } else {
            openVoiceRoom(roomData.id);
          }
        } else {
          showToast(data.error || 'فشل إنشاء الغرفة، يرجى المحاولة ثانية');
        }
      } catch (err) {
        console.error('Error creating room:', err);
        showToast('حدث خطأ أثناء إنشاء الغرفة');
      }
    };
  }

  // ============================================
  // LIVE VIDEO BROADCAST / STREAMING (بث مباشر فيديو)
  // ============================================
  let activeVideoStream = null;
  let isVideoEnabled = true;
  let isAudioEnabled = true;
  let isBeautifyOn = false;

  async function openLiveVideoStream(room) {
    if (!room) {
      console.error('openLiveVideoStream: room parameter is null or undefined');
      showToast('تعذر فتح البث المباشر: بيانات الغرفة غير متوفرة');
      return;
    }

    // If room is just an ID string, fetch full details from API
    if (typeof room === 'string') {
      try {
        const res = await fetch(`/api/rooms/${room}`);
        const data = await res.json();
        room = data.room || data;
      } catch (e) {
        console.error('Failed to fetch room details', e);
      }
    }

    if (!room || !room.id) {
      showToast('تعذر فتح البث المباشر');
      return;
    }

    // Safely populate any missing host properties
    room.host_id = room.host_id || (state.currentUser ? state.currentUser.id : '');
    room.host_name = room.host_name || (state.currentUser ? state.currentUser.name : 'المضيف');
    room.host_avatar = room.host_avatar || (state.currentUser ? state.currentUser.avatar : '/avatars/avatar-1.png');
    room.host_frame = room.host_frame || (state.currentUser ? state.currentUser.avatar_frame : '');
    room.title = room.title || 'بث مباشر';

    state.activeRoom = room;
    const isHost = Boolean(state.currentUser && state.currentUser.id === room.host_id);

    // Join socket room
    state.socket.emit('join_room', { roomId: room.id, user: state.currentUser });

    let existing = document.getElementById('live-video-broadcast-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'live-stream-modal';
    modal.id = 'live-video-broadcast-modal';

    modal.innerHTML = `
      <div class="live-stream-container">
        <!-- Co-Host PK Battle Header Bar -->
        <div class="pk-battle-bar" id="stream-cohost-pk-bar" style="display: none; position: absolute; top: 68px; left: 16px; right: 16px; z-index: 30; border-radius: 12px; backdrop-filter: blur(8px); background: rgba(15, 10, 30, 0.88); border: 1.5px solid rgba(255, 255, 255, 0.15); padding: 8px 14px;">
          <div class="pk-header">
            <span class="pk-team-host">🔴 <span id="stream-cohost-host-name">${room.host_name || 'المضيف'}</span>: <span id="stream-cohost-host-score" style="font-size: 16px; font-weight: 900;">100</span></span>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="pk-timer" id="stream-pk-timer" style="background: rgba(0,0,0,0.6); padding: 3px 10px; border-radius: 999px; border: 1px solid #fbbf24; color: #fbbf24; font-size: 13px; font-weight: 800;">⚔️ 02:00</span>
              ${isHost ? `<button class="pk-end-btn-fast" id="stream-bar-end-pk-btn" title="إنهاء الجولة فوراً">🛑 إنهاء الجولة</button>` : ''}
            </div>
            <span class="pk-team-challenger">🔵 <span id="stream-cohost-name-label">الشريك</span>: <span id="stream-cohost-guest-score" style="font-size: 16px; font-weight: 900;">100</span></span>
          </div>
          <div class="pk-progress-track" style="height: 12px; border-radius: 999px;">
            <div class="pk-progress-fill-host" id="stream-cohost-pk-fill" style="width: 50%;"></div>
          </div>
          <div class="pk-boost-btns" style="display: flex; justify-content: space-between; margin-top: 6px; align-items: center;">
            <button class="pk-boost-btn red" id="stream-pk-boost-host" style="cursor: pointer; padding: 4px 12px; font-size: 11px;">❤️ دعم المضيف (+50)</button>
            <span style="font-size: 10px; color: #fbbf24; font-weight: 700;">🎁 الهدايا تزيد نقاط الفوز مباشرة!</span>
            <button class="pk-boost-btn blue" id="stream-pk-boost-challenger" style="cursor: pointer; padding: 4px 12px; font-size: 11px;">💙 دعم المنافس (+50)</button>
          </div>
        </div>

        <!-- Video Viewport / Streamer Stage -->
        <div class="video-viewport-wrapper" id="stream-video-viewport">
          <video id="stream-host-video" autoplay playsinline ${isHost ? 'muted' : ''} style="display: none;"></video>

          <!-- 2-Person Video Split Screen Container -->
          <div class="video-split-container" id="stream-split-screen-box" style="display: none;">
            <div class="video-split-half left-streamer" id="stream-split-half-host" title="انقر لإرسال هدية للمضيف">
              <video id="stream-split-host-video" autoplay playsinline ${isHost ? 'muted' : ''}></video>
              <div class="cohost-name-tag">👑 المضيف: <span id="split-tag-host-name">${room.host_name || 'المضيف'}</span></div>
              <button class="split-direct-gift-chip host-gift" id="btn-split-gift-host" type="button">
                🎁 إرسال هدية للمضيف
              </button>
            </div>
            <div class="video-split-half right-streamer" id="stream-split-half-cohost" title="انقر لإرسال هدية للشريك">
              <video id="stream-split-guest-video" autoplay playsinline></video>
              <div class="cohost-name-tag" id="stream-split-guest-name">⚔️ الشريك المشترك</div>
              <button class="split-direct-gift-chip cohost-gift" id="btn-split-gift-cohost" type="button">
                🎁 إرسال هدية للشريك
              </button>
            </div>
          </div>
          
          <div class="video-fallback-streamer" id="stream-fallback-container">
            <div class="streamer-avatar-live-pulse">
              <img src="${room.host_avatar || (state.currentUser ? state.currentUser.avatar : '')}" class="${room.host_frame ? 'avatar-frame-' + room.host_frame : ''}" />
            </div>
            <div style="font-size: 16px; font-weight: 800; color: #fff; margin-bottom: 4px;">${room.host_name || room.title}</div>
            <div style="font-size: 11px; color: #c084fc;">📡 استوديو البث المباشر • SoulChill Live</div>
          </div>

          <!-- Flying Bullet Chat Layer (Danmaku) -->
          <div class="bullet-chat-container" id="stream-bullet-layer"></div>

          <!-- Floating Hearts Layer -->
          <div class="stream-hearts-container" id="stream-hearts-layer"></div>

          <!-- Floating Quick Flip / Mirror Button -->
          <button class="stream-flip-toggle-badge" id="stream-quick-flip-btn" title="تعديل اتجاه وانعكاس الكاميرا (قلب الفيديو)">
            <span>🔄</span> <span>قلب الكاميرا</span>
          </button>
        </div>

        <!-- Top Stream HUD -->
        <div class="stream-top-hud">
          <div class="streamer-profile-badge">
            <img src="${room.host_avatar || state.currentUser.avatar}" class="streamer-badge-avatar" />
            <div class="streamer-badge-info">
              <span class="streamer-badge-name">${room.host_name || room.title}</span>
              <span class="streamer-badge-likes">❤️ <span id="stream-likes-count">${room.likes_count || 120}</span> إعجاب</span>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="stream-live-pill">
              <span>●</span> LIVE مباشر
            </div>
            <div style="background: rgba(0,0,0,0.5); padding: 3px 8px; border-radius: 9999px; font-size: 11px; color: #fff;">
              👥 <span id="stream-viewers-count">${room.audience_count !== undefined ? room.audience_count : 1}</span>
            </div>
            ${(isHost || isPlatformStaff(state.currentUser)) ? `
              <button class="close-room-btn danger" id="stream-delete-btn" style="background: rgba(239,68,68,0.25); border: 1px solid #ef4444; color: #fca5a5; padding: 4px 10px; font-size: 11px; cursor: pointer;">🗑️ ${isHost ? 'حذف البث' : 'إغلاق البث (إدارة)'}</button>
            ` : ''}
            <button class="close-room-btn" id="leave-stream-btn" style="padding: 4px 10px; font-size: 11px;">🚪 خروج</button>
          </div>
        </div>

        <!-- Stream Chat Messages Preview (Bottom Left) -->
        <div class="stream-chat-preview-box" id="stream-chat-preview-box">
          <div class="stream-chat-msg-row">
            <span style="color: #fbbf24;">📢 نظام البث:</span> مرحباً بكم في البث المباشر! اضغط على الشاشة لإرسال القلوب ❤️
          </div>
          ${room.announcement ? `
            <div class="stream-chat-msg-row">
              <span style="color: #c084fc;">إعلان المذيع:</span> ${room.announcement}
            </div>
          ` : ''}
        </div>

        <!-- Bottom Stream Controls HUD -->
        <div class="stream-bottom-hud">
          <div class="room-chat-input-wrapper" style="background: rgba(0,0,0,0.55); border-color: rgba(255,255,255,0.2);">
            <input type="text" class="room-chat-input" id="stream-bullet-input" placeholder="أرسل تعليقاً طائراً على الشاشة..." />
            <button class="room-chat-send-btn" id="stream-send-bullet-btn">➤</button>
          </div>

          ${isHost ? `
            <!-- Host Controls -->
            <button class="room-tool-btn" id="stream-toggle-cam-btn" title="تشغيل / إيقاف الكاميرا">📹</button>
            <button class="room-tool-btn" id="stream-flip-cam-btn" title="تعديل اتجاه وانعكاس الكاميرا (قلب الفيديو)">🔄</button>
            <button class="room-tool-btn" id="stream-toggle-mic-btn" title="كتم / تشغيل المايك">🎙️</button>
            <button class="room-tool-btn" id="stream-cohost-requests-btn" style="position: relative; background: rgba(245,158,11,0.25); border: 1.5px solid #fbbf24; color: #fbbf24; font-size: 11px; padding: 6px 10px; gap: 4px;" title="طلبات الصعود للبث المشترك">
              <span>📥 طلبات الصعود</span>
              <span id="stream-cohost-req-badge" style="display: none; position: absolute; top: -6px; right: -6px; background: #ef4444; color: #fff; font-size: 10px; font-weight: 800; width: 18px; height: 18px; border-radius: 50%; align-items: center; justify-content: center;">0</span>
            </button>
            <button class="room-tool-btn" id="stream-invite-cohost-btn" title="دعوة لبث مشترك ثنائي (PK / Co-Host)">👥 دعوة</button>
            <button class="room-tool-btn" id="stream-start-pk-btn" style="display: none; background: rgba(239,68,68,0.25); border: 1.5px solid #ef4444; color: #fca5a5; font-size: 11px; padding: 6px 10px;" title="بدء جولة تحدي PK بالاتفاق">⚔️ بدء جولة PK</button>
            <button class="room-tool-btn danger" id="stream-end-pk-round-btn" style="display: none; background: rgba(239,68,68,0.35); border: 1.5px solid #ef4444; color: #fca5a5; font-size: 11px; padding: 6px 12px; gap: 4px;" title="إنهاء جولة الـ PK فوراً">🛑 إنهاء جولة PK</button>
            <button class="room-tool-btn danger" id="stream-end-cohost-btn" style="display: none; background: rgba(244,63,94,0.3); border-color: #f43f5e;" title="إنزال الشريك المشترك">❌ إنزال الشريك</button>
            <button class="room-tool-btn" id="stream-beautify-btn" title="فلتر الإضاءة والجمال">✨</button>
            <button class="room-tool-btn" id="stream-screenshare-btn" title="مشاركة الشاشة">🖥️</button>
          ` : `
            <!-- Viewer Controls -->
            <button class="room-tool-btn" id="stream-tap-heart-btn" style="background: var(--secondary-gradient); border-color: transparent;" title="إرسال قلب">❤️</button>
            <button class="room-tool-btn" id="stream-request-cohost-btn" style="background: rgba(168,85,247,0.3); border: 1.5px solid #c084fc; color: #fff; font-size: 11px; padding: 6px 12px; gap: 4px;" title="طلب الصعود في بث ثنائي وتقسيم الشاشة للتحدي">
              <span>✋</span>
              <span id="stream-request-btn-text">طلب صعود (PK)</span>
            </button>
            <!-- Co-host dynamic controls when on stage -->
            <button class="room-tool-btn" id="stream-cohost-flip-cam-btn" style="display: none;" title="تعديل اتجاه وانعكاس الكاميرا (قلب الفيديو)">🔄</button>
            <button class="room-tool-btn" id="stream-cohost-request-pk-btn" style="display: none; background: rgba(245,158,11,0.25); border: 1.5px solid #fbbf24; color: #fbbf24; font-size: 11px; padding: 6px 10px; gap: 4px;" title="طلب بدء جولة PK مع المضيف">⚔️ بدء جولة PK</button>
            <button class="room-tool-btn danger" id="stream-cohost-stepdown-btn" style="display: none; background: rgba(239,68,68,0.25); border: 1.5px solid #ef4444; color: #fca5a5; font-size: 11px; padding: 6px 12px; gap: 4px;" title="النزول من البث المشترك والعودة كمشاهد">🚪 النزول من البث</button>
          `}

          <!-- Virtual Gifts Button -->
          <button class="room-tool-btn gift-btn" id="stream-open-gifts-btn" title="إرسال هدية فاخرة للمذيع أو المنافس">🎁</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const videoEl = modal.querySelector('#stream-host-video');
    const fallbackEl = modal.querySelector('#stream-fallback-container');

    // Real WebRTC Audio & Video Streaming
    if (isHost) {
      if (window.soulRtc) {
        window.soulRtc.startBroadcastingVideo(room.id, videoEl).then(stream => {
          activeVideoStream = stream;
          videoEl.style.display = 'block';
          fallbackEl.style.display = 'none';
          showToast('📹 تم تشغيل الكاميرا وتدفق الفيديو والصوت عبر WebRTC!');
        }).catch(err => {
          console.warn('WebRTC broadcast failed:', err);
        });
      }
    } else {
      if (window.soulRtc) {
        window.soulRtc.requestRoomStream(room.id);
        showToast('📡 جارِ استقبال تدفق البث المباشر والصوت عبر WebRTC...');
      }
    }

    // Leave stream event
    modal.querySelector('#leave-stream-btn').onclick = () => {
      if (window.soulRtc) window.soulRtc.leaveCurrentRoom();
      if (activeVideoStream) {
        activeVideoStream.getTracks().forEach(t => t.stop());
        activeVideoStream = null;
      }
      state.socket.emit('leave_room', {
        roomId: room.id,
        userId: state.currentUser ? state.currentUser.id : null
      });
      state.activeRoom = null;
      modal.remove();
    };

    const deleteStreamBtn = modal.querySelector('#stream-delete-btn');
    if (deleteStreamBtn) {
      deleteStreamBtn.onclick = async () => {
        const ok = await deleteRoomById(room.id);
        if (ok) {
          if (window.soulRtc) window.soulRtc.leaveCurrentRoom();
          if (activeVideoStream) {
            activeVideoStream.getTracks().forEach(t => t.stop());
            activeVideoStream = null;
          }
          state.activeRoom = null;
          modal.remove();
        }
      };
    }

    // Tap to like on video stage
    const viewport = modal.querySelector('#stream-video-viewport');
    viewport.onclick = (e) => {
      // Don't trigger if clicked on controls
      if (e.target.closest('.stream-top-hud') || e.target.closest('.stream-bottom-hud')) return;
      triggerHeartAnimation();
      const uid = state.currentUser ? state.currentUser.id : 'guest-' + Date.now();
      state.socket.emit('stream_like', { roomId: room.id, userId: uid });
    };

    const heartBtn = modal.querySelector('#stream-tap-heart-btn');
    if (heartBtn) {
      heartBtn.onclick = () => {
        triggerHeartAnimation();
        const uid = state.currentUser ? state.currentUser.id : 'guest-' + Date.now();
        state.socket.emit('stream_like', { roomId: room.id, userId: uid });
      };
    }

    // Host controls
    if (isHost) {
      // Toggle Cam
      const camBtn = modal.querySelector('#stream-toggle-cam-btn');
      camBtn.onclick = () => {
        isVideoEnabled = !isVideoEnabled;
        if (activeVideoStream) {
          activeVideoStream.getVideoTracks().forEach(t => t.enabled = isVideoEnabled);
        }
        camBtn.style.opacity = isVideoEnabled ? '1' : '0.5';
        showToast(isVideoEnabled ? 'تم تشغيل الكاميرا 📹' : 'تم إيقاف الكاميرا 🚫');
      };

      // Toggle Mic
      const micBtn = modal.querySelector('#stream-toggle-mic-btn');
      micBtn.onclick = () => {
        isAudioEnabled = !isAudioEnabled;
        if (activeVideoStream) {
          activeVideoStream.getAudioTracks().forEach(t => t.enabled = isAudioEnabled);
        }
        micBtn.style.opacity = isAudioEnabled ? '1' : '0.5';
        showToast(isAudioEnabled ? 'تم تفعيل المايكروفون 🎙️' : 'تم كتم المايكروفون 🔇');
      };

      // Beautify Filter
      const beautyBtn = modal.querySelector('#stream-beautify-btn');
      beautyBtn.onclick = () => {
        isBeautifyOn = !isBeautifyOn;
        videoEl.classList.toggle('beautify-filter-active', isBeautifyOn);
        beautyBtn.style.background = isBeautifyOn ? 'var(--secondary)' : '';
        showToast(isBeautifyOn ? 'تم تفعيل فلتر التجميل والإضاءة ✨' : 'تم إيقاف فلتر التجميل');
      };

      // Screen Share
      const shareBtn = modal.querySelector('#stream-screenshare-btn');
      shareBtn.onclick = async () => {
        try {
          if (navigator.mediaDevices.getDisplayMedia) {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            videoEl.srcObject = screenStream;
            videoEl.style.display = 'block';
            fallbackEl.style.display = 'none';
            showToast('🖥️ جارِ مشاركة شاشتك في البث المباشر!');
            screenStream.getVideoTracks()[0].onended = () => {
              if (activeVideoStream) videoEl.srcObject = activeVideoStream;
            };
          }
        } catch (e) {
          showToast('تم إلغاء مشاركة الشاشة');
        }
      };

      // Flip / Mirror Camera orientation
      const flipBtn = modal.querySelector('#stream-flip-cam-btn');
      const quickFlipBtn = modal.querySelector('#stream-quick-flip-btn');
      const handleFlip = () => {
        if (window.soulRtc) {
          const isMirrored = window.soulRtc.toggleCameraMirroring();
          showToast(isMirrored ? '🔄 تم ضبط اتجاه الكاميرا على وضع المرآة (معكوس)' : '🔄 تم ضبط اتجاه الكاميرا على الوضع الطبيعي (غير معكوس)');
        }
      };
      if (flipBtn) flipBtn.onclick = handleFlip;
      if (quickFlipBtn) quickFlipBtn.onclick = handleFlip;

      // Invite Co-Host for 2-Person Live Broadcast & PK
      const inviteCohostBtn = modal.querySelector('#stream-invite-cohost-btn');
      const endCohostBtn = modal.querySelector('#stream-end-cohost-btn');
      const startPkBtn = modal.querySelector('#stream-start-pk-btn');
      const cohostReqsBtn = modal.querySelector('#stream-cohost-requests-btn');

      if (inviteCohostBtn) {
        inviteCohostBtn.onclick = () => {
          showCohostInviteModal(room);
        };
      }

      if (cohostReqsBtn) {
        cohostReqsBtn.onclick = () => {
          showCohostRequestsModal(room);
        };
      }

      if (startPkBtn) {
        startPkBtn.onclick = () => {
          if (!state.activeCohostUser) {
            showToast('يجب أن يصعد شريك معك في البث أولاً لبدء التحدي!');
            return;
          }
          state.socket.emit('request_pk_battle', {
            roomId: room.id,
            fromUser: state.currentUser
          });
          showToast(`📨 تم إرسال طلب تحدي جولة PK إلى ${state.activeCohostUser.name}! بانتظار الموافقة...`);
        };
      }

      // Host PK round manual termination button
      const endPkRoundBtn = modal.querySelector('#stream-end-pk-round-btn');
      if (endPkRoundBtn) {
        endPkRoundBtn.onclick = () => {
          state.socket.emit('end_pk', { roomId: room.id });
          showToast('🛑 جارِ إنهاء جولة الـ PK واحتساب النتيجة...');
        };
      }

      const barEndPkBtn = modal.querySelector('#stream-bar-end-pk-btn');
      if (barEndPkBtn) {
        barEndPkBtn.onclick = () => {
          state.socket.emit('end_pk', { roomId: room.id });
          showToast('🛑 جارِ إنهاء جولة الـ PK واحتساب النتيجة...');
        };
      }

      if (endCohostBtn) {
        endCohostBtn.onclick = () => {
          state.socket.emit('end_cohost', { roomId: room.id });
          disableSplitScreenMode();
          endCohostBtn.style.display = 'none';
          showToast('تم إنهاء البث المشترك والعودة للبث الفردي');
        };
      }
    } else {
      // Viewer & Co-host Controls
      const reqCohostBtn = modal.querySelector('#stream-request-cohost-btn');
      if (reqCohostBtn) {
        reqCohostBtn.onclick = () => {
          if (!requireAuth()) return;
          state.socket.emit('request_cohost_join', {
            roomId: room.id,
            requester: state.currentUser
          });
          const btnText = document.getElementById('stream-request-btn-text');
          if (btnText) btnText.innerText = 'بانتظار القبول ⏳';
          showToast('تم إرسال طلب الصعود إلى صاحب البث! بانتظار الموافقة وتقسيم الشاشة للتحدي 🚀');
        };
      }

      const cohostFlipBtn = modal.querySelector('#stream-cohost-flip-cam-btn');
      if (cohostFlipBtn) cohostFlipBtn.onclick = handleFlip;

      const cohostPkBtn = modal.querySelector('#stream-cohost-request-pk-btn');
      if (cohostPkBtn) {
        cohostPkBtn.onclick = () => {
          if (!requireAuth()) return;
          state.socket.emit('request_pk_battle', {
            roomId: room.id,
            fromUser: state.currentUser
          });
          showToast(`📨 تم إرسال طلب تحدي جولة PK إلى المضيف (${room.host_name})! بانتظار موافقته...`);
        };
      }

      const cohostStepdownBtn = modal.querySelector('#stream-cohost-stepdown-btn');
      if (cohostStepdownBtn) {
        cohostStepdownBtn.onclick = async () => {
          if (await uiConfirm('هل ترغب في النزول من البث المشترك والعودة كمشاهد؟', { icon: '🚪', okText: 'نزول' })) {
            if (window.soulRtc) window.soulRtc.stopBroadcastingCohost();
            state.socket.emit('cohost_leave_stage', {
              roomId: room.id,
              userId: state.currentUser ? state.currentUser.id : null
            });
            showToast('🚪 قمت بالنزول من البث المشترك');
          }
        };
      }
    }

    // Direct click on streamer halves to open gift modal
    const halfHost = modal.querySelector('#stream-split-half-host');
    const halfCohost = modal.querySelector('#stream-split-half-cohost');
    const giftDirectHostBtn = modal.querySelector('#btn-split-gift-host');
    const giftDirectCohostBtn = modal.querySelector('#btn-split-gift-cohost');

    const handleGiftHost = (e) => {
      if (e) e.stopPropagation();
      openGiftStoreModal(room.host_id, room.id, {
        id: room.host_id,
        name: room.host_name,
        avatar: room.host_avatar
      });
    };

    const handleGiftCohost = (e) => {
      if (e) e.stopPropagation();
      if (state.activeCohostUser) {
        openGiftStoreModal(state.activeCohostUser.id, room.id, state.activeCohostUser);
      } else {
        showToast('لا يوجد شريك في البث حالياً');
      }
    };

    if (halfHost) halfHost.onclick = handleGiftHost;
    if (giftDirectHostBtn) giftDirectHostBtn.onclick = handleGiftHost;
    if (halfCohost) halfCohost.onclick = handleGiftCohost;
    if (giftDirectCohostBtn) giftDirectCohostBtn.onclick = handleGiftCohost;

    // PK Boost Buttons
    const boostHostBtn = modal.querySelector('#stream-pk-boost-host');
    const boostChallengerBtn = modal.querySelector('#stream-pk-boost-challenger');

    if (boostHostBtn) {
      boostHostBtn.onclick = () => {
        state.socket.emit('pk_support', {
          roomId: room.id,
          team: 'host',
          points: 50,
          user: state.currentUser || { name: 'داعم' }
        });
      };
    }

    if (boostChallengerBtn) {
      boostChallengerBtn.onclick = () => {
        state.socket.emit('pk_support', {
          roomId: room.id,
          team: 'challenger',
          points: 50,
          user: state.currentUser || { name: 'داعم' }
        });
      };
    }

    // Co-host Requests State & Functions
    let pendingCohostRequests = [];

    function updateReqBadge() {
      const badge = document.getElementById('stream-cohost-req-badge');
      if (!badge) return;
      if (pendingCohostRequests.length > 0) {
        badge.style.display = 'flex';
        badge.innerText = pendingCohostRequests.length;
      } else {
        badge.style.display = 'none';
      }
    }

    function showIncomingCohostBanner(requester) {
      if (!isHost) return;
      const existing = document.getElementById(`cohost-banner-${requester.id}`);
      if (existing) existing.remove();

      const banner = document.createElement('div');
      banner.className = 'cohost-req-banner';
      banner.id = `cohost-banner-${requester.id}`;

      banner.innerHTML = `
        <img src="${requester.avatar}" class="req-banner-avatar" />
        <div class="req-banner-info">
          <span style="font-weight: 800; color: #fbbf24; font-size: 12px;">${requester.name}</span>
          <span style="font-size: 11px; color: #fff;">يطلب الصعود معك في البث وتقسيم الشاشة للتحدي!</span>
        </div>
        <div class="req-banner-btns">
          <button class="req-accept-btn" id="btn-banner-accept-${requester.id}">✅ قبول</button>
          <button class="req-reject-btn" id="btn-banner-reject-${requester.id}">❌ رفض</button>
        </div>
      `;

      modal.appendChild(banner);

      if (window.soundManager) {
        window.soundManager.playCheer();
      }

      banner.querySelector(`#btn-banner-accept-${requester.id}`).onclick = () => {
        state.socket.emit('accept_cohost_request', {
          roomId: room.id,
          cohostUser: requester
        });
        pendingCohostRequests = pendingCohostRequests.filter(r => r.id !== requester.id);
        updateReqBadge();
        banner.remove();
        showToast(`وافقت على صعود ${requester.name}! جارِ تقسيم الشاشة وبدء التحدي 🚀`);
      };

      banner.querySelector(`#btn-banner-reject-${requester.id}`).onclick = () => {
        state.socket.emit('reject_cohost_request', {
          roomId: room.id,
          targetUserId: requester.id
        });
        pendingCohostRequests = pendingCohostRequests.filter(r => r.id !== requester.id);
        updateReqBadge();
        banner.remove();
      };

      setTimeout(() => {
        if (banner.parentElement) banner.remove();
      }, 15000);
    }

    function showCohostRequestsModal(currentRoom) {
      const reqModal = document.createElement('div');
      reqModal.className = 'soul-modal-backdrop';
      reqModal.id = 'cohost-requests-modal';

      reqModal.innerHTML = `
        <div class="soul-modal-content" style="max-width: 400px;">
          <button class="soul-modal-close-btn" id="close-cohost-reqs-btn">✕</button>
          <div class="modal-header-title">📥 طلبات الصعود للبث المشترك (PK)</div>
          <p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 12px; text-align: center;">
            المشاهدون الذين يطلبون الصعود معك وتقسيم الشاشة لبدء التحدي
          </p>

          <div style="display: flex; flex-direction: column; gap: 8px; max-height: 280px; overflow-y: auto;" id="cohost-reqs-list">
            ${pendingCohostRequests.length === 0 ? `
              <div style="text-align: center; color: var(--text-muted); padding: 25px 10px; font-size: 12px;">
                لا توجد طلبات صعود معلقة حالياً.<br>يمكن للمشاهدين طلب الصعود بالضغط على زر "✋ طلب صعود (PK)".
              </div>
            ` : pendingCohostRequests.map(u => `
              <div class="google-account-option" style="padding: 10px 12px; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <img src="${u.avatar}" style="width: 38px; height: 38px; border-radius: 50%; object-fit: cover; border: 1.5px solid var(--border-glow);" />
                  <div>
                    <div style="font-size: 13px; font-weight: 800; color: #fff;">${u.name}</div>
                    <div style="font-size: 10px; color: #fbbf24;">مستوى ${u.level || 1} • راغب بالتحدي</div>
                  </div>
                </div>
                <div style="display: flex; gap: 6px;">
                  <button class="req-accept-btn fast-accept-req" data-user-id="${u.id}">✅ قبول</button>
                  <button class="req-reject-btn fast-reject-req" data-user-id="${u.id}">❌ رفض</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;

      document.body.appendChild(reqModal);

      reqModal.querySelector('#close-cohost-reqs-btn').onclick = () => reqModal.remove();

      reqModal.querySelectorAll('.fast-accept-req').forEach(btn => {
        btn.onclick = () => {
          const u = pendingCohostRequests.find(r => r.id === btn.dataset.userId);
          if (u) {
            state.socket.emit('accept_cohost_request', {
              roomId: currentRoom.id,
              cohostUser: u
            });
            pendingCohostRequests = pendingCohostRequests.filter(r => r.id !== u.id);
            updateReqBadge();
            reqModal.remove();
            showToast(`تمت الموافقة على صعود ${u.name}! جارِ تقسيم الشاشة وبدء التحدي... 📹🔥`);
          }
        };
      });

      reqModal.querySelectorAll('.fast-reject-req').forEach(btn => {
        btn.onclick = () => {
          const uId = btn.dataset.userId;
          state.socket.emit('reject_cohost_request', {
            roomId: currentRoom.id,
            targetUserId: uId
          });
          pendingCohostRequests = pendingCohostRequests.filter(r => r.id !== uId);
          updateReqBadge();
          btn.closest('.google-account-option').remove();
          showToast('تم رفض الطلب');
        };
      });
    }

    window.handleIncomingCohostRequest = (requester, requestsCount, requests) => {
      if (requests && Array.isArray(requests)) {
        pendingCohostRequests = requests;
      } else if (!pendingCohostRequests.some(r => r.id === requester.id)) {
        pendingCohostRequests.push(requester);
      }
      updateReqBadge();
      showIncomingCohostBanner(requester);
    };

    window.handleCohostRequestsUpdated = (count, requests) => {
      if (requests && Array.isArray(requests)) {
        pendingCohostRequests = requests;
      }
      updateReqBadge();
    };

    window.showIncomingPkChallengeModal = (roomId, challenger) => {
      let existing = document.getElementById('pk-challenge-received-modal');
      if (existing) existing.remove();

      const challengeModal = document.createElement('div');
      challengeModal.className = 'soul-modal-backdrop animate-fade-in';
      challengeModal.id = 'pk-challenge-received-modal';
      challengeModal.style.zIndex = '99999';

      challengeModal.innerHTML = `
        <div class="soul-modal-content" style="max-width: 380px; text-align: center; border: 2px solid #fbbf24; box-shadow: 0 0 35px rgba(251, 191, 36, 0.5); border-radius: 20px;">
          <div style="font-size: 46px; margin-bottom: 6px; animation: buttonPulseGlow 1.5s infinite;">⚔️🔥</div>
          <div style="font-size: 18px; font-weight: 900; color: #fbbf24; margin-bottom: 8px;">طلب تحدي جولة PK!</div>
          <div style="display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 12px; background: rgba(0,0,0,0.3); padding: 8px 12px; border-radius: 12px;">
            <img src="${challenger.avatar || '/avatars/avatar-1.png'}" style="width: 44px; height: 44px; border-radius: 50%; border: 2px solid #fbbf24; object-fit: cover;" />
            <div style="text-align: right;">
              <div style="font-size: 14px; font-weight: 800; color: #fff;">${challenger.name}</div>
              <div style="font-size: 11px; color: #fbbf24;">يرغب ببدء منافسة PK معك!</div>
            </div>
          </div>
          <p style="font-size: 12px; color: #e2e8f0; margin-bottom: 16px; line-height: 1.6;">
            جولة حماسية مدتها دقيقتان! تعتمد على دعم وهدايا الجمهور لتحديد الفائز مع عقاب للخاسر. هل تقبل التحدي؟
          </p>
          <div style="display: flex; gap: 10px;">
            <button class="wallet-btn primary" id="btn-accept-pk-challenge-now" style="flex: 1; padding: 10px; font-size: 13px; font-weight: 800;">
              🔥 قبول التحدي
            </button>
            <button class="wallet-btn secondary" id="btn-reject-pk-challenge-now" style="flex: 1; padding: 10px; font-size: 13px;">
              ❌ رفض
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(challengeModal);

      challengeModal.querySelector('#btn-accept-pk-challenge-now').onclick = () => {
        state.socket.emit('accept_pk_battle', { roomId });
        challengeModal.remove();
        showToast('🎉 تم قبول التحدي! جولة الـ PK تنطلق الآن...');
      };

      challengeModal.querySelector('#btn-reject-pk-challenge-now').onclick = () => {
        state.socket.emit('reject_pk_battle', { roomId, fromUserId: challenger.id });
        challengeModal.remove();
        showToast('تم رفض التحدي');
      };

      setTimeout(() => {
        if (challengeModal.parentElement) challengeModal.remove();
      }, 25000);
    };

    // Co-host Split Screen Helpers
    function enableSplitScreenMode(cohostUser) {
      state.activeCohostUser = cohostUser;
      const splitBox = document.getElementById('stream-split-screen-box');
      const pkBar = document.getElementById('stream-cohost-pk-bar');
      const fallback = document.getElementById('stream-fallback-container');
      const singleVideo = document.getElementById('stream-host-video');
      const guestName = document.getElementById('stream-split-guest-name');
      const guestVideo = document.getElementById('stream-split-guest-video');
      const hostSplitVideo = document.getElementById('stream-split-host-video');
      const endBtn = document.getElementById('stream-end-cohost-btn');
      const startPkBtn = document.getElementById('stream-start-pk-btn');
      const guestLabel = document.getElementById('stream-cohost-name-label');
      const splitTagHost = document.getElementById('split-tag-host-name');
      const btnDirectCohost = document.getElementById('btn-split-gift-cohost');
      const btnDirectHost = document.getElementById('btn-split-gift-host');
      const endPkBtn = document.getElementById('stream-end-pk-round-btn');
      const barEndPkBtn = document.getElementById('stream-bar-end-pk-btn');

      if (!splitBox) return;

      // 50/50 Split view becomes visible, single video hides
      splitBox.style.display = 'flex';
      // PK round does NOT start automatically! Wait for mutual agreement challenge
      if (pkBar) pkBar.style.display = 'none';
      if (fallback) fallback.style.display = 'none';
      if (singleVideo) singleVideo.style.display = 'none';
      if (endPkBtn) endPkBtn.style.display = 'none';
      if (barEndPkBtn) barEndPkBtn.style.display = 'none';

      if (guestName) guestName.innerText = `⚔️ ${cohostUser.name}`;
      if (guestLabel) guestLabel.innerText = cohostUser.name;
      if (splitTagHost) splitTagHost.innerText = room.host_name || 'المضيف';
      if (btnDirectCohost) btnDirectCohost.innerHTML = `🎁 إرسال هدية لـ <strong>${cohostUser.name}</strong>`;
      if (btnDirectHost) btnDirectHost.innerHTML = `🎁 إرسال هدية لـ <strong>${room.host_name || 'المضيف'}</strong>`;

      if (isHost) {
        if (endBtn) endBtn.style.display = 'inline-flex';
        if (startPkBtn) startPkBtn.style.display = 'inline-flex';
      }

      // Connect host video into left half (works for host, co-host, and viewers alike!)
      if (hostSplitVideo) {
        let streamToUse = null;
        if (isHost && activeVideoStream) {
          streamToUse = activeVideoStream;
        } else if (window.soulRtc && window.soulRtc.remoteHostStream) {
          streamToUse = window.soulRtc.remoteHostStream;
        } else if (singleVideo && singleVideo.srcObject) {
          streamToUse = singleVideo.srcObject;
        } else if (window.soulRtc && window.soulRtc.localStream) {
          streamToUse = window.soulRtc.localStream;
        }

        if (streamToUse) {
          hostSplitVideo.srcObject = streamToUse;
          hostSplitVideo.style.display = 'block';
          hostSplitVideo.play().catch(e => console.log('hostSplitVideo play caught:', e));
        } else if (!isHost && window.soulRtc) {
          window.soulRtc.requestRoomStream(room.id);
        }
      }

      // If current user is the cohost, start camera for right half and show cohost controls
      if (state.currentUser && state.currentUser.id === cohostUser.id) {
        const cohostStepdown = document.getElementById('stream-cohost-stepdown-btn');
        if (cohostStepdown) cohostStepdown.style.display = 'inline-flex';
        const cohostPkBtn = document.getElementById('stream-cohost-request-pk-btn');
        if (cohostPkBtn) cohostPkBtn.style.display = 'inline-flex';
        const cohostFlipBtn = document.getElementById('stream-cohost-flip-cam-btn');
        if (cohostFlipBtn) cohostFlipBtn.style.display = 'inline-flex';
        const reqCohostBtn = document.getElementById('stream-request-cohost-btn');
        if (reqCohostBtn) reqCohostBtn.style.display = 'none';

        if (window.soulRtc) {
          window.soulRtc.startBroadcastingCohost(room.id, guestVideo).then(stream => {
            showToast('📹 أنت الآن على الهواء مباشرة بجانب المضيف في الشاشة المقسمة!');
            // Request host stream to ensure bidirectional video feed
            window.soulRtc.requestRoomStream(room.id);
          });
        }
      } else {
        if (guestVideo) {
          let guestStream = null;
          if (window.soulRtc && window.soulRtc.remoteCohostStream) {
            guestStream = window.soulRtc.remoteCohostStream;
          }
          if (guestStream) {
            guestVideo.srcObject = guestStream;
            guestVideo.style.display = 'block';
            guestVideo.play().catch(e => console.log('guestVideo play caught:', e));
          } else if (!guestVideo.srcObject) {
            guestVideo.poster = cohostUser.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80';
          }
        }
      }

      if (window.soulRtc) {
        window.soulRtc.applyCameraMirroring();
      }

      showToast(`✨ انضم ${cohostUser.name} للبث المشترك! الشاشة أصبحت مقسمة، يمكنك النقر لإرسال الهدايا أو بدء تحدي PK بالاتفاق.`);
    }

    function disableSplitScreenMode() {
      state.activeCohostUser = null;
      const splitBox = document.getElementById('stream-split-screen-box');
      const pkBar = document.getElementById('stream-cohost-pk-bar');
      const singleVideo = document.getElementById('stream-host-video');
      const fallback = document.getElementById('stream-fallback-container');
      const hostSplitVideo = document.getElementById('stream-split-host-video');
      const guestVideo = document.getElementById('stream-split-guest-video');
      const endBtn = document.getElementById('stream-end-cohost-btn');
      const startPkBtn = document.getElementById('stream-start-pk-btn');
      const endPkBtn = document.getElementById('stream-end-pk-round-btn');
      const barEndPkBtn = document.getElementById('stream-bar-end-pk-btn');
      const stepdownBtn = document.getElementById('stream-cohost-stepdown-btn');
      const cohostPkBtn = document.getElementById('stream-cohost-request-pk-btn');
      const cohostFlipBtn = document.getElementById('stream-cohost-flip-cam-btn');
      const reqCohostBtn = document.getElementById('stream-request-cohost-btn');

      if (hostSplitVideo) hostSplitVideo.srcObject = null;
      if (guestVideo) guestVideo.srcObject = null;

      if (splitBox) splitBox.style.display = 'none';
      if (pkBar) pkBar.style.display = 'none';
      if (endBtn) endBtn.style.display = 'none';
      if (startPkBtn) startPkBtn.style.display = 'none';
      if (endPkBtn) endPkBtn.style.display = 'none';
      if (barEndPkBtn) barEndPkBtn.style.display = 'none';
      if (stepdownBtn) stepdownBtn.style.display = 'none';
      if (cohostPkBtn) cohostPkBtn.style.display = 'none';
      if (cohostFlipBtn) cohostFlipBtn.style.display = 'none';

      if (reqCohostBtn) {
        reqCohostBtn.style.display = 'inline-flex';
        const btnText = document.getElementById('stream-request-btn-text');
        if (btnText) btnText.innerText = 'طلب صعود (PK)';
      }

      // Return screen to single full-screen mode for the host
      if (singleVideo) {
        let streamToRestore = null;
        if (isHost && activeVideoStream) {
          streamToRestore = activeVideoStream;
        } else if (window.soulRtc && window.soulRtc.remoteHostStream) {
          streamToRestore = window.soulRtc.remoteHostStream;
        } else if (singleVideo.srcObject) {
          streamToRestore = singleVideo.srcObject;
        }

        if (streamToRestore) {
          singleVideo.srcObject = streamToRestore;
          singleVideo.style.display = 'block';
          if (fallback) fallback.style.display = 'none';
          singleVideo.play().catch(() => {});
        } else if (fallback) {
          fallback.style.display = 'flex';
        }
      }

      if (window.soulRtc) {
        window.soulRtc.applyCameraMirroring();
      }
    }

    window.triggerCohostSplitView = enableSplitScreenMode;
    window.revertCohostSplitView = disableSplitScreenMode;

    function showCohostInviteModal(currentRoom) {
      const candidates = (state.allUsers || []).filter(u => !state.currentUser || u.id !== state.currentUser.id);
      const modal = document.createElement('div');
      modal.className = 'soul-modal-backdrop';
      modal.innerHTML = `
        <div class="soul-modal-content" style="max-width: 380px;">
          <button class="soul-modal-close-btn" id="close-cohost-modal-btn">✕</button>
          <div class="modal-header-title">👥 دعوة لبث مشترك ثنائي (Co-Host Live PK)</div>
          <p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 12px; text-align: center;">
            اختر صديقاً أو مذيعاً للانضمام معك في شاشة مقسومة نصفين ومنافسة PK حماسية
          </p>

          <div style="display: flex; flex-direction: column; gap: 8px; max-height: 280px; overflow-y: auto;">
            ${candidates.map(u => `
              <div class="google-account-option fast-cohost-user" data-user-id="${u.id}" data-user-name="${u.name}" style="padding: 8px 12px; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <img src="${u.avatar}" class="google-account-avatar" />
                  <div>
                    <div style="font-size: 13px; font-weight: 700; color: #fff;">${u.name}</div>
                    <div style="font-size: 10px; color: var(--text-muted);">${u.soul_planet || 'عضو مميز'}</div>
                  </div>
                </div>
                <button class="wallet-btn primary" style="padding: 4px 10px; font-size: 11px;">دعوة ⚔️</button>
              </div>
            `).join('')}
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      modal.querySelector('#close-cohost-modal-btn').onclick = () => modal.remove();

      modal.querySelectorAll('.fast-cohost-user').forEach(btn => {
        btn.onclick = () => {
          const targetUserId = btn.dataset.userId;
          const targetUserName = btn.dataset.userName;
          const targetObj = candidates.find(c => c.id === targetUserId);

          state.socket.emit('invite_cohost', {
            roomId: currentRoom.id,
            targetUserId,
            hostUser: state.currentUser
          });

          // Instant preview for testing if other user is not a separate window
          state.socket.emit('accept_cohost', {
            roomId: currentRoom.id,
            cohostUser: targetObj || { id: targetUserId, name: targetUserName, avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80' }
          });

          modal.remove();
          showToast(`تم إرسال دعوة البث المشترك لـ ${targetUserName}! 👥🔥`);
        };
      });
    }

    // Bullet Chat & Comments
    const bulletInput = modal.querySelector('#stream-bullet-input');
    const sendBulletBtn = modal.querySelector('#stream-send-bullet-btn');

    const handleSendBullet = () => {
      const text = bulletInput.value.trim();
      if (!text) return;
      bulletInput.value = '';

      state.socket.emit('stream_bullet_chat', {
        roomId: room.id,
        user: state.currentUser,
        text
      });
      // Also send as standard room chat
      state.socket.emit('send_room_message', {
        roomId: room.id,
        userId: state.currentUser.id,
        content: text
      });
    };

    sendBulletBtn.onclick = handleSendBullet;
    bulletInput.onkeypress = (e) => {
      if (e.key === 'Enter') handleSendBullet();
    };

    // Open gifts modal
    modal.querySelector('#stream-open-gifts-btn').onclick = () => {
      openGiftStoreModal(room.host_id, room.id, { name: room.host_name, avatar: room.host_avatar });
    };

    // Socket listeners for this live stream
    state.socket.on('stream_like_burst', () => {
      triggerHeartAnimation();
      const likesEl = document.getElementById('stream-likes-count');
      if (likesEl) {
        let count = parseInt(likesEl.innerText) || 0;
        likesEl.innerText = count + 1;
      }
    });

    state.socket.on('stream_bullet_message', ({ user, text }) => {
      addBulletCommentToScreen(user, text);
      addChatMessageToStreamPreview(user, text);
    });
  }

  function triggerHeartAnimation() {
    const layer = document.getElementById('stream-hearts-layer');
    if (!layer) return;

    const hearts = ['❤️', '💖', '💜', '💙', '✨', '🔥', '🌟'];
    const heart = document.createElement('div');
    heart.className = 'floating-tap-heart';
    heart.innerText = hearts[Math.floor(Math.random() * hearts.length)];
    heart.style.right = `${Math.random() * 60 + 10}px`;

    layer.appendChild(heart);
    setTimeout(() => heart.remove(), 2200);
  }

  function addBulletCommentToScreen(user, text) {
    const layer = document.getElementById('stream-bullet-layer');
    if (!layer) return;

    const bullet = document.createElement('div');
    bullet.className = 'bullet-comment-item';
    bullet.style.top = `${Math.random() * 120}px`;
    bullet.innerHTML = `
      <img src="${user.avatar}" style="width: 20px; height: 20px; border-radius: 9999px;" />
      <span style="color: #fbbf24;">${user.name}:</span>
      <span>${text}</span>
    `;

    layer.appendChild(bullet);
    setTimeout(() => bullet.remove(), 6200);
  }

  function addChatMessageToStreamPreview(user, text) {
    const box = document.getElementById('stream-chat-preview-box');
    if (!box) return;

    const row = document.createElement('div');
    row.className = 'stream-chat-msg-row';
    row.innerHTML = `<span class="stream-chat-user">${user.name}:</span> ${text}`;
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  }

  // ============================================
  // LIVE VOICE PARTY ROOM SCREEN (FULL EXPERIENCE)
  // ============================================
  // شاشة "جارٍ الاتصال، يرجى الانتظار" عند الدخول للغرفة (كما في الفيديو)
  function showRoomConnectingScreen(onCancel) {
    const old = document.getElementById('room-connecting-screen');
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = 'room-connecting-screen';
    el.className = 'room-connecting-screen';
    el.innerHTML = `
      <button type="button" class="room-connecting-exit" aria-label="خروج">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/></svg>
      </button>
      <div class="room-connecting-center">
        <svg class="room-connecting-logo" viewBox="0 0 64 64" width="64" height="64" fill="none">
          <defs><linearGradient id="rcGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9d5ff"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs>
          <path d="M8 36c4-14 18-22 36-20 6 .6 10 4 12 8-8-2-14 0-18 4 8-2 14 1 16 6-6-2-12-1-18 3-8 6-18 6-28-1z" fill="url(#rcGrad)"/>
          <circle cx="40" cy="26" r="2.4" fill="#4c1d95"/>
        </svg>
        <div class="room-connecting-text">جارٍ الاتصال، يرجى الانتظار</div>
      </div>
    `;
    el.querySelector('.room-connecting-exit').onclick = () => { if (onCancel) onCancel(); };
    document.body.appendChild(el);
    return el;
  }

  function hideRoomConnectingScreen() {
    const el = document.getElementById('room-connecting-screen');
    if (!el) return;
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 350);
  }

  async function openVoiceRoom(roomId) {
    if (!state.currentUser) {
      showGoogleLoginModal();
      showToast('يجب تسجيل الدخول بحساب Gmail أولاً للدخول إلى الغرفة ورؤية الدردشة! 🔒');
      return;
    }
    let cancelled = false;
    showRoomConnectingScreen(() => { cancelled = true; hideRoomConnectingScreen(); });
    const startedAt = Date.now();
    try {
      const res = await fetch(`/api/rooms/${roomId}`);
      if (!res.ok) {
        hideRoomConnectingScreen();
        showToast('تعذر العثور على الغرفة!');
        return;
      }
      const room = await res.json();

      // إبقاء شاشة الاتصال ظاهرة لمدة قصيرة لتجربة دخول سلسة
      const elapsed = Date.now() - startedAt;
      if (elapsed < 1500) await new Promise(r => setTimeout(r, 1500 - elapsed));
      if (cancelled) return;

      state.activeRoom = room;

      // الدخول لا يصعّد أحداً إلى المقعد (حتى المالك/السوبر أدمن/الأدمن): نتجاهل أي مقعد عالق باسمي
      // ونُفرغه محلياً، والخادم يحرّره عند join_room. الصعود يكون فقط بالنقر على مقعد.
      (room.seats || []).forEach(s => { if (state.currentUser && s.user_id === state.currentUser.id) { s.user_id = null; s.name = null; s.avatar = null; s.avatar_frame = null; } });

      // Determine if current user is already in a seat
      const userSeat = (room.seats || []).find(s => state.currentUser && s.user_id === state.currentUser.id);
      state.userSeatIndex = userSeat ? userSeat.seat_index : null;
      state.isMuted = userSeat ? !!userSeat.is_muted : false;

      // Render Live Room Modal first so chat stream and entry effect slot are ready in DOM
      renderLiveRoomModal(room);

      // Fetch Chat Messages first so the entry effect integrates directly at the bottom of the chat stream
      await loadRoomChatMessages(roomId);

      // إخفاء شاشة الاتصال ثم بدء تأثير الدخول
      hideRoomConnectingScreen();

      // Join socket room (broadcasts entry effect to all room participants)
      state.socket.emit('join_room', { roomId, user: state.currentUser });

      // WebRTC real audio stream
      if (window.soulRtc) {
        window.soulRtc.requestRoomStream(roomId);
        if (userSeat && !userSeat.is_muted) {
          window.soulRtc.startBroadcastingVoice(roomId);
        }
      }
    } catch (err) {
      hideRoomConnectingScreen();
      console.error('Error opening room:', err);
    }
  }

  // ============================================
  // SOULCHILL MIC SEAT ANIMATED STICKERS CATALOG
  // ============================================
  const SOULCHILL_MIC_STICKERS = [
    {
      id: 'shy_pointing',
      name: 'خجول وكيوت 👉👈',
      svg: `<svg viewBox="0 0 100 100" class="seat-sticker-svg" style="width: 100%; height: 100%;">
        <defs>
          <radialGradient id="shyGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#fff" stop-opacity="0.95" />
            <stop offset="60%" stop-color="#fed7aa" stop-opacity="0.8" />
            <stop offset="100%" stop-color="#f97316" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="faceGrad" cx="40%" cy="35%" r="60%">
            <stop offset="0%" stop-color="#fff7ed" />
            <stop offset="65%" stop-color="#ffedd5" />
            <stop offset="100%" stop-color="#fed7aa" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill="url(#shyGlow)" opacity="0.65" />
        <path d="M 38 18 L 44 25 L 50 14 L 56 25 L 62 18 L 59 29 L 41 29 Z" fill="#fbbf24" stroke="#d97706" stroke-width="1.5" />
        <circle cx="50" cy="14" r="2.5" fill="#ef4444" />
        <circle cx="50" cy="52" r="33" fill="url(#faceGrad)" stroke="#ea580c" stroke-width="2.8" />
        <ellipse cx="31" cy="56" rx="5.5" ry="4" fill="#f43f5e" opacity="0.7" />
        <ellipse cx="69" cy="56" rx="5.5" ry="4" fill="#f43f5e" opacity="0.7" />
        <path d="M 32 46 Q 39 41 46 46" stroke="#b91c1c" stroke-width="3.5" stroke-linecap="round" fill="none" />
        <path d="M 54 46 Q 61 41 68 46" stroke="#b91c1c" stroke-width="3.5" stroke-linecap="round" fill="none" />
        <path d="M 47 58 Q 50 60 53 58" stroke="#ea580c" stroke-width="2.5" stroke-linecap="round" fill="none" />
        <g transform="translate(25, 57)">
          <circle cx="8" cy="10" r="7" fill="#fed7aa" stroke="#ea580c" stroke-width="2.2" />
          <path d="M 13 8 L 24 8 Q 25.5 8 25.5 9.5 Q 25.5 11 24 11 L 13 11" fill="#fed7aa" stroke="#ea580c" stroke-width="2.2" />
        </g>
        <g transform="translate(51, 57)">
          <circle cx="16" cy="10" r="7" fill="#fed7aa" stroke="#ea580c" stroke-width="2.2" />
          <path d="M 11 8 L 0 8 Q -1.5 8 -1.5 9.5 Q -1.5 11 0 11 L 11 11" fill="#fed7aa" stroke="#ea580c" stroke-width="2.2" />
        </g>
      </svg>`
    },
    {
      id: 'king_crown',
      name: 'فخم وملكي 👑',
      svg: `<svg viewBox="0 0 100 100" style="width:100%;height:100%;">
        <defs>
          <radialGradient id="kgGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#fef08a" />
            <stop offset="100%" stop-color="#eab308" stop-opacity="0" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill="url(#kgGlow)" opacity="0.6" />
        <circle cx="50" cy="52" r="32" fill="#fef08a" stroke="#ca8a04" stroke-width="2.5" />
        <path d="M 28 20 L 36 32 L 50 14 L 64 32 L 72 20 L 68 38 L 32 38 Z" fill="#f59e0b" stroke="#b45309" stroke-width="2" />
        <circle cx="50" cy="14" r="3" fill="#ef4444" />
        <circle cx="28" cy="20" r="2.5" fill="#3b82f6" />
        <circle cx="72" cy="20" r="2.5" fill="#10b981" />
        <circle cx="39" cy="48" r="3.5" fill="#1e293b" />
        <circle cx="61" cy="48" r="3.5" fill="#1e293b" />
        <path d="M 38 62 Q 50 72 62 62" stroke="#b45309" stroke-width="3.5" stroke-linecap="round" fill="none" />
        <ellipse cx="31" cy="55" rx="4" ry="2.5" fill="#f43f5e" opacity="0.6" />
        <ellipse cx="69" cy="55" rx="4" ry="2.5" fill="#f43f5e" opacity="0.6" />
      </svg>`
    },
    {
      id: 'laugh_tears',
      name: 'ضحك هستيري 😂',
      svg: `<svg viewBox="0 0 100 100" style="width:100%;height:100%;">
        <circle cx="50" cy="50" r="34" fill="#fbbf24" stroke="#d97706" stroke-width="2.5" />
        <path d="M 30 42 Q 38 34 46 44" stroke="#78350f" stroke-width="3.5" stroke-linecap="round" fill="none" />
        <path d="M 54 44 Q 62 34 70 42" stroke="#78350f" stroke-width="3.5" stroke-linecap="round" fill="none" />
        <path d="M 34 54 Q 50 74 66 54 Z" fill="#991b1b" stroke="#78350f" stroke-width="2" />
        <path d="M 40 67 Q 50 72 60 67" fill="#f43f5e" />
        <path d="M 23 44 C 20 44 18 50 21 54 C 24 57 28 53 27 48 Z" fill="#38bdf8" />
        <path d="M 77 44 C 80 44 82 50 79 54 C 76 57 72 53 73 48 Z" fill="#38bdf8" />
      </svg>`
    },
    {
      id: 'heart_love',
      name: 'غرقان حب 😍',
      svg: `<svg viewBox="0 0 100 100" style="width:100%;height:100%;">
        <circle cx="50" cy="50" r="34" fill="#fde047" stroke="#ca8a04" stroke-width="2.5" />
        <path d="M 38 34 C 33 26 24 30 25 38 C 26 46 38 52 38 52 C 38 52 50 46 51 38 C 52 30 43 26 38 34 Z" fill="#ef4444" transform="scale(0.7) translate(14, 18)" />
        <path d="M 38 34 C 33 26 24 30 25 38 C 26 46 38 52 38 52 C 38 52 50 46 51 38 C 52 30 43 26 38 34 Z" fill="#ef4444" transform="scale(0.7) translate(48, 18)" />
        <path d="M 36 60 Q 50 72 64 60" stroke="#b45309" stroke-width="3.5" stroke-linecap="round" fill="none" />
        <ellipse cx="28" cy="58" rx="4" ry="2.5" fill="#f43f5e" opacity="0.6" />
        <ellipse cx="72" cy="58" rx="4" ry="2.5" fill="#f43f5e" opacity="0.6" />
      </svg>`
    },
    {
      id: 'cool_vip',
      name: 'روقان وفخامة 😎',
      svg: `<svg viewBox="0 0 100 100" style="width:100%;height:100%;">
        <circle cx="50" cy="50" r="34" fill="#fbbf24" stroke="#d97706" stroke-width="2.5" />
        <path d="M 24 40 L 47 40 C 48 48 42 54 34 54 C 26 54 22 48 24 40 Z" fill="#0f172a" stroke="#000" stroke-width="2" />
        <path d="M 53 40 L 76 40 C 78 48 74 54 66 54 C 58 54 52 48 53 40 Z" fill="#0f172a" stroke="#000" stroke-width="2" />
        <line x1="47" y1="42" x2="53" y2="42" stroke="#0f172a" stroke-width="3" />
        <path d="M 38 64 Q 50 72 62 64" stroke="#92400e" stroke-width="3.5" stroke-linecap="round" fill="none" />
      </svg>`
    },
    {
      id: 'fire_hype',
      name: 'حريقة وحماس 🔥',
      svg: `<svg viewBox="0 0 100 100" style="width:100%;height:100%;">
        <path d="M 50 14 C 58 28 68 34 68 48 C 68 62 58 74 50 82 C 42 74 32 62 32 48 C 32 38 40 26 50 14 Z" fill="#f97316" stroke="#c2410c" stroke-width="2.5" />
        <path d="M 50 34 C 55 42 60 48 60 56 C 60 64 55 70 50 74 C 45 70 40 64 40 56 C 40 48 45 42 50 34 Z" fill="#fde047" />
        <circle cx="45" cy="54" r="3" fill="#000" />
        <circle cx="55" cy="54" r="3" fill="#000" />
        <path d="M 46 62 Q 50 65 54 62" stroke="#000" stroke-width="2" stroke-linecap="round" fill="none" />
      </svg>`
    },
    {
      id: 'party_popper',
      name: 'احتفال وبارتي 🥳',
      svg: `<svg viewBox="0 0 100 100" style="width:100%;height:100%;">
        <circle cx="50" cy="52" r="32" fill="#fbbf24" stroke="#d97706" stroke-width="2.5" />
        <path d="M 32 32 L 50 10 L 62 30 Z" fill="#8b5cf6" stroke="#6d28d9" stroke-width="2" />
        <circle cx="50" cy="10" r="3.5" fill="#f43f5e" />
        <path d="M 50 60 L 76 66 L 74 72 L 48 64 Z" fill="#ec4899" stroke="#be185d" stroke-width="1.5" />
        <circle cx="38" cy="48" r="3.5" fill="#1e293b" />
        <circle cx="58" cy="46" r="3.5" fill="#1e293b" />
        <ellipse cx="32" cy="56" rx="4" ry="2.5" fill="#f43f5e" opacity="0.6" />
      </svg>`
    },
    {
      id: 'spooky_ghost',
      name: 'مقلب وشبح 👻',
      svg: `<svg viewBox="0 0 100 100" style="width:100%;height:100%;">
        <path d="M 50 20 C 34 20 28 32 28 48 C 28 62 26 76 34 76 C 40 76 44 68 50 76 C 56 68 60 76 66 76 C 74 76 72 62 72 48 C 72 32 66 20 50 20 Z" fill="#f8fafc" stroke="#94a3b8" stroke-width="2.5" />
        <ellipse cx="42" cy="44" rx="4" ry="5" fill="#0f172a" />
        <ellipse cx="58" cy="44" rx="4" ry="5" fill="#0f172a" />
        <ellipse cx="50" cy="56" rx="5" ry="7" fill="#0f172a" />
        <path d="M 48 59 Q 50 67 52 59" fill="#f43f5e" />
      </svg>`
    }
  ];

  function displaySeatEmojiReaction(seatIndex, svgHtml, name) {
    let seatContainer = null;
    if (seatIndex === 0) {
      seatContainer = document.querySelector('#host-seat-0 .host-avatar-box');
    } else {
      seatContainer = document.querySelector(`#stage-seat-${seatIndex} .seat-avatar-container`);
    }
    if (!seatContainer) return;

    // إزالة أي إيموجي سابق على نفس المقعد (وإلغاء مؤقّته)
    const oldOverlay = seatContainer.querySelector('.seat-animated-sticker-overlay');
    if (oldOverlay) oldOverlay.remove();
    if (seatContainer._emojiTimer) clearTimeout(seatContainer._emojiTimer);

    const overlay = document.createElement('div');
    overlay.className = 'seat-animated-sticker-overlay';
    overlay.innerHTML = svgHtml;

    // الإيموجي يظهر فوق صورة المستخدم دون إخفائها
    seatContainer.appendChild(overlay);

    if (window.soundManager) window.soundManager.playCheer();

    // إزالة بعد 6 ثوانٍ
    seatContainer._emojiTimer = setTimeout(() => {
      if (overlay && overlay.parentNode) overlay.remove();
      seatContainer._emojiTimer = null;
    }, 6000);
  }

  function updateRoomMicEmojiButtonState() {
    const btn = document.getElementById('room-chat-emoji-toggle-btn');
    const drawer = document.getElementById('seat-emojis-picker-drawer');
    const isSittingOnMic = state.userSeatIndex !== null && state.userSeatIndex !== undefined;

    if (btn) {
      btn.style.display = 'flex';
    }
    // القائمة متاحة للجميع (ليست مقتصرة على من هم على المقعد)
  }

  // قائمة الإيموجي: الصور المرفوعة من لوحة الإدارة
  async function renderSeatEmojisGrid(container, room) {
    if (!container) return;
    container.innerHTML = '<div class="seat-emojis-empty">جارٍ التحميل…</div>';
    let list = [];
    try {
      const res = await fetch('/api/room-emojis', { cache: 'no-store' });
      const data = await res.json();
      list = Array.isArray(data.emojis) ? data.emojis : [];
    } catch (e) {
      container.innerHTML = '<div class="seat-emojis-empty">تعذر تحميل الإيموجي، حاول مرة أخرى</div>';
      return;
    }
    if (!list.length) {
      container.innerHTML = '<div class="seat-emojis-empty">لا توجد إيموجي حالياً 😶</div>';
      return;
    }
    container.innerHTML = list.map(em => `
      <div class="seat-emoji-item-card" data-emoji-id="${fEsc(em.id)}">
        <div class="seat-sticker-preview"><img src="${fEsc(em.image_url)}" alt="" loading="lazy" draggable="false" onerror="this.style.visibility='hidden'" /></div>
      </div>
    `).join('');

    container.querySelectorAll('.seat-emoji-item-card').forEach(card => {
      card.onclick = () => {
        if (!state.socket || !state.currentUser) return;
        // السيرفر يتحقق إن كان المرسل على مقعد فيعرضه فوقه، وإلا يظهر في الدردشة فقط
        state.socket.emit('send_room_emoji', {
          roomId: room.id,
          userId: state.currentUser.id,
          emojiId: card.dataset.emojiId
        });
        const drawer = document.getElementById('seat-emojis-picker-drawer');
        if (drawer) drawer.style.display = 'none';
      };
    });
  }

  function renderLiveRoomModal(room) {
    if (!room || !room.id) {
      console.error('renderLiveRoomModal called with invalid room:', room);
      showToast('تعذر تحميل بيانات الغرفة الصوتية');
      return;
    }

    room.host_id = room.host_id || (state.currentUser ? state.currentUser.id : '');
    room.host_name = room.host_name || (state.currentUser ? state.currentUser.name : 'المضيف');
    room.host_avatar = room.host_avatar || (state.currentUser ? state.currentUser.avatar : '/avatars/avatar-1.png');
    room.host_frame = room.host_frame || '';

    let existing = document.getElementById('live-voice-room-modal');
    if (existing) existing.remove();

    const isRoomAdmin = state.currentUser && (
      room.host_id === state.currentUser.id || 
      isPlatformStaff(state.currentUser)
    );
    const mySeat = (room.seats || []).find(s => state.currentUser && s.user_id === state.currentUser.id);
    state.userSeatIndex = mySeat ? mySeat.seat_index : null;
    state.isMuted = mySeat ? !!mySeat.is_muted : false;

    const hostSeat = (room.seats || []).find(s => s.seat_index === 0);
    const isHostSeatOccupied = Boolean(hostSeat && hostSeat.user_id);
    const hostOccupant = isHostSeatOccupied ? hostSeat : null;

    const modal = document.createElement('div');
    modal.className = 'live-room-modal';
    modal.id = 'live-voice-room-modal';

    let headerRoleBadge = '';
    if (state.currentUser) {
      if (state.currentUser.role === 'owner') headerRoleBadge = '<span style="background: #ec4899; color: #fff; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 999px; margin-right: 6px;">👑 مالك التطبيق</span>';
      else if (state.currentUser.role === 'super_master') headerRoleBadge = '<span style="background: #a855f7; color: #fff; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 999px; margin-right: 6px;">💎 سوبر ماستر</span>';
      else if (state.currentUser.role === 'super_admin') headerRoleBadge = '<span style="background: #f59e0b; color: #fff; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 999px; margin-right: 6px;">⚡ سوبر ادمن</span>';
      else if (state.currentUser.role === 'admin' || state.currentUser.role === 'moderator') headerRoleBadge = '<span style="background: #3b82f6; color: #fff; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 999px; margin-right: 6px;">🛡️ ادمن الدردشة</span>';
      else if (room.host_id === state.currentUser.id) headerRoleBadge = '<span style="background: #fbbf24; color: #000; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 999px; margin-right: 6px;">👑 مدير الغرفة</span>';
    }

    // 8 Seats HTML (indices 1 to 8)
    const seatsHtml = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(idx => {
      const seat = (room.seats || []).find(s => s.seat_index === idx);
      const isOccupied = seat && seat.user_id;
      const isLocked = seat && seat.is_locked;
      return `
        <div class="stage-seat ${isOccupied ? 'occupied' : ''} ${isLocked ? 'locked' : ''}" id="stage-seat-${idx}" data-seat-idx="${idx}" style="${idx > (room.seat_count || 8) ? 'display:none;' : ''}">
          <div class="seat-avatar-container">
            ${isOccupied 
              ? `<img src="${seat.avatar}" class="${seat.avatar_frame ? 'avatar-frame-' + seat.avatar_frame : ''}" />` 
              : (isLocked ? `<span class="seat-empty-plus">🔒</span>` : `<span class="seat-empty-plus">+</span>`)
            }
            <div class="seat-number-badge">${idx}</div>
            <div class="seat-mic-status ${seat && seat.is_muted ? 'muted' : 'unmuted'}" style="display: ${seat && seat.is_muted ? 'flex' : 'none'};">🔇</div>
          </div>
          <div class="seat-user-name">${isOccupied ? seat.name : (isLocked ? 'مقعد مقفل' : 'مقعد فارغ')}</div>
        </div>
      `;
    }).join('');

    modal.innerHTML = `
      <div class="live-room-container">
        <!-- Room Header -->
        <div class="live-room-header">
          <img src="${room.cover_image || room.host_avatar || (room.host_id === state.currentUser?.id ? state.currentUser.avatar : '')}" class="live-room-host-avatar ${room.host_frame ? 'avatar-frame-' + room.host_frame : ''}" id="live-room-host-avatar" title="${room.host_name || 'المضيف'}" onerror="this.src='/avatars/avatar-1.png'" />
          <div class="live-room-title-box">
            <div class="live-room-name">
              <span class="live-room-mic-icon">🎙️</span>
              <span class="live-room-title-text" title="${room.title}">${room.title}</span>
              <button type="button" class="room-fav-heart-btn ${isRoomFavorited(room.id) ? 'favorited' : ''}" id="room-fav-toggle-btn" data-room-id="${room.id}" title="${isRoomFavorited(room.id) ? 'إزالة الغرفة من المفضلة' : 'إضافة الغرفة إلى المفضلة'}">
                <span class="fav-heart-icon">${isRoomFavorited(room.id) ? '❤️' : '🤍'}</span>
              </button>
              ${headerRoleBadge}
            </div>
            <div class="live-room-id-tag">ID: ${room.id} • 👥 <span id="live-audience-counter">${room.audience_count !== undefined ? room.audience_count : 1}</span> مستمع</div>
          </div>
          <div class="live-room-actions"></div>
        </div>

        ${isRoomAdmin ? `
          <!-- Host & Admin Toolbar (Sleek organized single-row bar) -->
          <div class="host-admin-toolbar">
            <div class="host-toolbar-badge">
              <span>👑</span>
              <span>الإدارة</span>
            </div>
            <div class="host-toolbar-actions">
              <button class="host-tool-mini-btn" id="btn-admin-edit-announcement" title="تعديل الإعلان">📢 الإعلان</button>
              <button class="host-tool-mini-btn" id="btn-admin-seat-count" title="عدد المقاعد">🪑 المقاعد</button>
            <button class="host-tool-mini-btn lock" id="btn-admin-lock-all-seats" title="قفل جميع المقاعد">🔒 قفل المقاعد</button>
              <button class="host-tool-mini-btn unlock" id="btn-admin-unlock-all-seats" title="فتح جميع المقاعد">🔓 فتح المقاعد</button>
              <button class="host-tool-mini-btn danger" id="btn-admin-close-room" title="إغلاق الغرفة">🛑 إغلاق</button>
            </div>
          </div>
        ` : ''}

        <!-- PK Battle Bar (Host Red vs Challenger Blue) -->
        <div class="pk-battle-bar" id="room-pk-battle-bar">
          <div class="pk-header">
            <span class="pk-team-host">🔴 المضيف: <span id="pk-host-score">100</span></span>
            <span class="pk-timer" id="pk-countdown-timer">00:45</span>
            <span class="pk-team-challenger">🔵 المنافس: <span id="pk-challenger-score">100</span></span>
          </div>
          <div class="pk-progress-track">
            <div class="pk-progress-fill-host" id="pk-progress-fill"></div>
          </div>
          <div class="pk-boost-btns">
            <button class="pk-boost-btn red" id="pk-boost-host-btn">❤️ دعم المضيف (+50)</button>
            <button class="pk-boost-btn blue" id="pk-boost-challenger-btn">💙 دعم المنافس (+50)</button>
          </div>
        </div>

        <!-- Stage: Host & 8 Seats -->
        <div class="room-stage-section">
          <!-- Host Central Seat (Index 0) -->
          <div class="host-seat-wrapper ${isHostSeatOccupied ? 'occupied' : 'empty'}" id="host-seat-0" data-seat-idx="0" style="cursor: pointer;">
            <div class="host-crown-badge">👑</div>
            <div class="host-avatar-box ${isHostSeatOccupied ? '' : 'empty-host-seat'}" style="${isHostSeatOccupied ? '' : 'border: 2px dashed rgba(251, 191, 36, 0.6); background: rgba(251, 191, 36, 0.08); display: flex; align-items: center; justify-content: center;'}">
              ${isHostSeatOccupied 
                ? `<img src="${hostOccupant.avatar || room.host_avatar}" class="${hostOccupant.avatar_frame ? 'avatar-frame-' + hostOccupant.avatar_frame : ''}" />
                   <div class="seat-mic-status ${hostOccupant.is_muted ? 'muted' : 'unmuted'}" id="host-mic-badge" style="display: ${hostOccupant.is_muted ? 'flex' : 'none'}; position: absolute; bottom: -4px; right: -4px; width: 22px; height: 22px; font-size: 11px;">🔇</div>` 
                : `<span class="seat-empty-plus" style="font-size: 26px; color: #fbbf24; font-weight: 800;">+</span>
                   <div class="seat-mic-status ${hostSeat && hostSeat.is_muted ? 'muted' : 'unmuted'}" id="host-mic-badge" style="display: ${hostSeat && hostSeat.is_muted ? 'flex' : 'none'}; position: absolute; bottom: -4px; right: -4px; width: 22px; height: 22px; font-size: 11px;">🔇</div>`
              }
            </div>
            <div class="host-name-label" style="${isHostSeatOccupied ? '' : 'color: #fbbf24;'}">
              ${isHostSeatOccupied ? (hostOccupant.name || room.host_name) : 'مقعد المضيف (فارغ)'}
            </div>
          </div>

          <!-- 8 Seats Grid -->
          <div class="guest-seats-grid">
            ${seatsHtml}
          </div>
        </div>

        <!-- Compact SoulChill Visitors / Audience Strip under the seats -->
        <div class="room-audience-strip-container">
          <div class="room-audience-scroll-track" id="room-audience-list">
            <!-- Dynamic visitor avatars rendered here -->
          </div>
          <div class="audience-strip-badge-pill" title="المتواجدون في الغرفة">
            <span class="audience-person-icon">👤</span>
            <span class="audience-count-pill" id="room-audience-badge">0</span>
          </div>
          <button type="button" class="room-people-btn" id="room-people-btn" title="كل من دخل الغرفة">
            <span class="room-people-icon">👤</span>
            <b id="room-people-total">0</b>
          </button>
        </div>

        <!-- Entry Effect Banner Container -->
        <div class="room-entry-effect-slot" id="room-entry-effect-slot"></div>

        <!-- Live Chat Messages Stream (Swipe Right to Hide, Swipe Left to Restore) -->
        <div class="room-chat-stream" id="room-chat-messages-container" title="اسحب لليمين لإخفاء الرسائل، واسحب لليسار لإظهارها">
          <div class="room-admin-system-notice" id="room-admin-system-notice" style="display: none;"></div>
          ${room.announcement ? `
            <div class="room-chat-bubble system-notice">
              📢 إعلان المضيف: ${room.announcement}
            </div>
          ` : ''}
        </div>

        <!-- Floating Restore Chat Hint when Public Chat is Swiped Hidden -->
        <button type="button" class="room-chat-restore-pill" id="room-chat-restore-pill" style="display: none;">
          <span>💬 اسحب لليسار أو اضغط لإظهار العام</span>
        </button>

        <!-- Room Bottom Controls Bar (Exact SoulChill Layout matching image-1.png & image-2.png) -->
        <div class="room-bottom-controls">
          <!-- Rightmost in RTL: Pill Input ("مرحبًا" + Smiley Icon on Left inside pill) -->
          <div class="room-chat-input-wrapper">
            <input type="text" class="room-chat-input" id="room-chat-text-input" placeholder="مرحبًا" />
            <button type="button" class="room-chat-send-btn" id="room-send-chat-btn" title="إرسال">➤</button>
            <button type="button" class="room-chat-emoji-btn" id="room-chat-emoji-toggle-btn" title="سمايلات وتفاعلات">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                <circle cx="12" cy="12" r="9.5" stroke="#ffffff" stroke-width="1.8"/>
                <circle cx="9" cy="10" r="1.3" fill="#ffffff"/>
                <circle cx="15" cy="10" r="1.3" fill="#ffffff"/>
                <path d="M8.5 14.2C9.4 15.8 10.6 16.5 12 16.5C13.4 16.5 14.6 15.8 15.5 14.2" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
            </button>
          </div>

          <!-- 1. Royal Treasure / Privilege Box Button -->
          <button type="button" class="room-tool-btn chest-btn" id="room-open-chest-btn" title="صندوق المكافآت والامتيازات">
            <span class="chest-3d-icon">👑💎</span>
          </button>

          <!-- 2. Accessories Button (Exact image-2.png: 3 horizontal lines short-long-short) -->
          <button type="button" class="room-tool-btn accessories-btn" id="room-accessories-btn" title="إكسسوارات (إطارات الرسالة وقوالب الدخول)">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
              <path d="M8 7.5H16M5 12H19M8 16.5H16" stroke="#ffffff" stroke-width="2.3" stroke-linecap="round"/>
            </svg>
          </button>

          <!-- 4. In-Room Private Messages Button (Speech Bubble with 2 lines) -->
          <button type="button" class="room-tool-btn inroom-msg-btn" id="room-inroom-messages-btn" title="الرسائل والمحادثات الخاصة 💬" style="position: relative;">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
              <path d="M6 5H18C19.6569 5 21 6.34315 21 8V14C21 15.6569 19.6569 17 18 17H14L12 19.5L10 17H6C4.34315 17 3 15.6569 3 14V8C3 6.34315 4.34315 5 6 5Z" stroke="#e9d5ff" stroke-width="1.9" stroke-linejoin="round"/>
              <path d="M8.5 9.5H15.5M8.5 13H13.5" stroke="#e9d5ff" stroke-width="1.9" stroke-linecap="round"/>
            </svg>
            <span class="inroom-unread-dot" id="inroom-unread-dot" style="display: none; position: absolute; top: 2px; right: 2px; width: 9px; height: 9px; background: #ef4444; border-radius: 50%; border: 1.5px solid #000;"></span>
          </button>

          <!-- 5. Virtual Gift Box Button -->
          <button type="button" class="room-tool-btn gift-btn" id="room-open-gifts-btn" title="إرسال هدية فاخرة">
            <span class="gift-3d-icon">🎁</span>
          </button>

          <!-- 6. Mic Toggle Button (Strictly shown only when sitting on a seat) -->
          <button type="button" class="room-tool-btn mic-btn ${state.userSeatIndex !== null && state.userSeatIndex !== undefined && !state.isMuted ? 'active' : ''}" id="room-mic-toggle-btn" title="المايكروفون" style="display: ${state.userSeatIndex !== null && state.userSeatIndex !== undefined ? 'flex' : 'none'};">
            ${state.userSeatIndex !== null && state.userSeatIndex !== undefined && !state.isMuted ? '🎙️' : '🔇'}
          </button>
        </div>

        <!-- Mic Seat Emojis / Animated Stickers Picker Drawer -->
        <div class="seat-emojis-picker-drawer" id="seat-emojis-picker-drawer" style="display: none;">
          <div class="seat-emojis-header">
            <span>😄 الإيموجي</span>
            <button type="button" id="close-seat-emojis-btn" style="background: none; border: none; color: #fff; font-size: 16px; cursor: pointer;">✕</button>
          </div>
          <div class="seat-emojis-grid" id="seat-emojis-grid"></div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Initial check of mic & emoji button visibility based on whether user is on mic
    updateMicButtonUI();

    // إشعار الوحدات الإضافية (room-pro.js) بأن الغرفة جاهزة في الـ DOM
    document.dispatchEvent(new CustomEvent('soul:room-opened', { detail: { room, modal } }));

    // Event: Favorite Room Heart Button inside live-room-title-box
    const favToggleBtn = modal.querySelector('#room-fav-toggle-btn');
    if (favToggleBtn) {
      favToggleBtn.onclick = (e) => {
        e.stopPropagation();
        toggleFavoriteRoom(room.id, favToggleBtn);
      };
    }

    // Event: In-Room Private Messages Button (Located at Bottom Controls next to gifts)
    const inroomMsgBtn = modal.querySelector('#room-inroom-messages-btn');
    if (inroomMsgBtn) {
      inroomMsgBtn.onclick = () => {
        const dot = document.getElementById('inroom-unread-dot');
        if (dot) dot.style.display = 'none';
        openInRoomMessagesDrawer();
      };
    }

    // Event: Treasure / Privilege Box Button
    const chestBtn = modal.querySelector('#room-open-chest-btn');
    if (chestBtn) {
      chestBtn.onclick = () => {
        showOneTimeOfferModal();
      };
    }

    // Event: Accessories Button (image-2.png -> Opens Message Frames & Entry Effects)
    const accessoriesBtn = modal.querySelector('#room-accessories-btn');
    if (accessoriesBtn) {
      accessoriesBtn.onclick = () => {
        openRoomAccessoriesModal(room);
      };
    }

    // رسالة الإدارة الثابتة (تُجلب من إعدادات الأدمن وتظهر في كل الغرف)
    (async () => {
      const noticeEl = modal.querySelector('#room-admin-system-notice');
      if (!noticeEl) return;
      try {
        const r = await fetch('/api/settings/room-system-message');
        const d = await r.json();
        const text = (d && d.message ? String(d.message) : '').trim();
        if (text) {
          noticeEl.textContent = text;
          noticeEl.style.display = 'block';
        }
      } catch (e) { /* لا نعرض شيئاً إن تعذّر الجلب */ }
    })();

    // النقر على صورة المضيف في الأعلى يفتح ملفه الشخصي
    const hostAvatarEl = modal.querySelector('#live-room-host-avatar');
    if (hostAvatarEl && room.host_id) {
      hostAvatarEl.style.cursor = 'pointer';
      hostAvatarEl.onclick = () => showUserProfileCard({ id: room.host_id, name: room.host_name || 'المضيف', avatar: room.host_avatar || hostAvatarEl.src });
    }

    // Event: تحديد عدد المقاعد (للمضيف/الإدارة)
    const seatCountBtn = modal.querySelector('#btn-admin-seat-count');
    if (seatCountBtn) {
      seatCountBtn.onclick = async () => {
        const max = room.max_seats || 8;
        const seatAnswer = await uiPrompt(`اختر عدد المقاعد في الغرفة (من 1 إلى ${max})`, { icon: '🪑', title: 'عدد المقاعد', type: 'number', min: 1, max, value: room.seat_count || max, okText: 'حفظ' });
        if (seatAnswer === null) return;
        const v = parseInt(seatAnswer, 10);
        try {
          const r = await fetch(`/api/rooms/${room.id}/seat-count`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'x-user-id': state.currentUser.id },
            body: JSON.stringify({ count: v })
          });
          const d = await r.json();
          showToast(d.success ? `تم ضبط عدد المقاعد على ${v} 🪑` : (d.error || 'تعذر تحديث المقاعد'));
        } catch (e) { showToast('تعذر تحديث المقاعد'); }
      };
    }

    // Event: Mic Emoji Stickers Toggle & Selection
    const emojiToggleBtn = modal.querySelector('#room-chat-emoji-toggle-btn');
    const emojisDrawer = modal.querySelector('#seat-emojis-picker-drawer');
    const closeEmojisBtn = modal.querySelector('#close-seat-emojis-btn');
    const emojisGrid = modal.querySelector('#seat-emojis-grid');

    if (closeEmojisBtn && emojisDrawer) {
      closeEmojisBtn.onclick = () => {
        emojisDrawer.style.display = 'none';
      };
    }

    if (emojiToggleBtn && emojisDrawer) {
      emojiToggleBtn.onclick = (e) => {
        e.stopPropagation();
        const isHidden = emojisDrawer.style.display === 'none' || !emojisDrawer.style.display;
        if (isHidden) {
          renderSeatEmojisGrid(emojisGrid, room);
          emojisDrawer.style.display = 'block';
        } else {
          emojisDrawer.style.display = 'none';
        }
      };
    }

    // Setup Swipe Right to Hide Public Chat & Swipe Left to Restore
    setupRoomChatSwipeToggle(modal);

    // Event: Host & Admin Control Actions
    const editAnnounceBtn = modal.querySelector('#btn-admin-edit-announcement');
    if (editAnnounceBtn) {
      editAnnounceBtn.onclick = async () => {
        const newAnn = await uiPrompt('اكتب رسالة الإعلان الجديدة للروم', { icon: '📢', title: 'إعلان الروم', type: 'textarea', value: room.announcement || '', okText: 'نشر' });
        if (newAnn !== null) {
          state.socket.emit('send_room_message', {
            roomId: room.id,
            userId: state.currentUser.id,
            content: `📢 [إعلان المضيف]: ${newAnn}`
          });
          showToast('تم تحديث إعلان الروم! 📢');
        }
      };
    }

    const lockAllSeatsBtn = modal.querySelector('#btn-admin-lock-all-seats');
    if (lockAllSeatsBtn) {
      lockAllSeatsBtn.onclick = async () => {
        if (await uiConfirm('هل ترغب بقفل جميع مقاعد المايك ومنع صعود الجمهور؟', { icon: '🔒', okText: 'قفل الكل' })) {
          state.socket.emit('admin_lock_all_seats', {
            roomId: room.id,
            adminId: state.currentUser.id,
            isLocked: true
          });
        }
      };
    }

    const unlockAllSeatsBtn = modal.querySelector('#btn-admin-unlock-all-seats');
    if (unlockAllSeatsBtn) {
      unlockAllSeatsBtn.onclick = () => {
        state.socket.emit('admin_lock_all_seats', {
          roomId: room.id,
          adminId: state.currentUser.id,
          isLocked: false
        });
      };
    }

    const closeRoomBtn = modal.querySelector('#btn-admin-close-room');
    if (closeRoomBtn) {
      closeRoomBtn.onclick = async () => {
        const ok = await deleteRoomById(room.id);
        if (ok) {
          if (window.soulRtc) window.soulRtc.leaveCurrentRoom();
          leaveActiveVoiceRoom();
        }
      };
    }

    // Host Seat 0 Click
    const hostSeatEl = modal.querySelector('#host-seat-0');
    if (hostSeatEl) {
      hostSeatEl.onclick = () => {
        handleSeatClick(0);
      };
    }

    // Event: Seat Clicks (Take Seat, Leave Seat, Mute, Host Moderation)
    modal.querySelectorAll('.stage-seat').forEach(seatEl => {
      seatEl.onclick = () => {
        const seatIdx = parseInt(seatEl.dataset.seatIdx);
        handleSeatClick(seatIdx);
      };
    });

    // Event: Mic Toggle button
    const micBtn = modal.querySelector('#room-mic-toggle-btn');
    micBtn.onclick = () => {
      toggleUserMic();
    };

    // Event: Open Gifts Store
    modal.querySelector('#room-open-gifts-btn').onclick = () => {
      openGiftStoreModal(null, room.id, null);
    };

    // Event: Send Chat Message
    const chatInput = modal.querySelector('#room-chat-text-input');
    const sendBtn = modal.querySelector('#room-send-chat-btn');

    const handleSend = () => {
      const text = chatInput.value.trim();
      if (!text) return;
      state.socket.emit('send_room_message', {
        roomId: room.id,
        userId: state.currentUser.id,
        content: text
      });
      chatInput.value = '';
    };

    sendBtn.onclick = handleSend;
    chatInput.onkeypress = (e) => {
      if (e.key === 'Enter') handleSend();
    };

    // PK Boost buttons
    modal.querySelector('#pk-boost-host-btn').onclick = () => {
      state.socket.emit('pk_support', { roomId: room.id, team: 'host', points: 50, user: state.currentUser });
    };
    modal.querySelector('#pk-boost-challenger-btn').onclick = () => {
      state.socket.emit('pk_support', { roomId: room.id, team: 'challenger', points: 50, user: state.currentUser });
    };

    // Render initial audience strip and chat input state
    renderRoomAudienceStrip(state.activeRoomAudience || []);
    updateRoomChatInputState();
  }

  // Swipe Right on #room-chat-messages-container to Hide Public Chat, Swipe Left to Restore
  function setupRoomChatSwipeToggle(modal) {
    const chatContainer = modal.querySelector('#room-chat-messages-container');
    const restorePill = modal.querySelector('#room-chat-restore-pill');
    const roomContainer = modal.querySelector('.live-room-container');
    if (!chatContainer || !roomContainer) return;

    let startX = null;
    let startY = null;

    const setChatHidden = (hidden) => {
      chatContainer.classList.toggle('chat-stream-hidden-right', hidden);
      if (restorePill) {
        restorePill.style.display = hidden ? 'inline-flex' : 'none';
      }
      showToast(hidden ? 'تم إخفاء رسائل العام 👈 اسحب لليسار لإرجاعها' : 'تم إرجاع رسائل الدردشة العامة 💬');
    };

    if (restorePill) {
      restorePill.onclick = () => setChatHidden(false);
    }

    const handleGestureEnd = (endX, endY) => {
      if (startX === null || startY === null) return;
      const dx = endX - startX;
      const dy = endY - startY;
      startX = null;
      startY = null;

      // Require clear horizontal swipe (at least 45px and mostly horizontal)
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        const isCurrentlyHidden = chatContainer.classList.contains('chat-stream-hidden-right');
        if (dx > 0 && !isCurrentlyHidden) {
          // Swiped Right -> Hide public chat messages
          setChatHidden(true);
        } else if (dx < 0 && isCurrentlyHidden) {
          // Swiped Left -> Restore public chat messages
          setChatHidden(false);
        }
      }
    };

    roomContainer.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      // Ignore swipes inside horizontal scroll tracks
      if (e.target.closest('#room-audience-list, .host-toolbar-actions')) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });

    roomContainer.addEventListener('touchend', (e) => {
      if (!e.changedTouches || e.changedTouches.length === 0) return;
      handleGestureEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    }, { passive: true });

    roomContainer.addEventListener('mousedown', (e) => {
      if (e.target.closest('button, input, #room-audience-list, .host-toolbar-actions')) return;
      startX = e.clientX;
      startY = e.clientY;
    });

    roomContainer.addEventListener('mouseup', (e) => {
      handleGestureEnd(e.clientX, e.clientY);
    });
  }

  // Room Accessories Modal (Opened by clicking the 3-lines button image-2.png)
  // Displays: 1. إطارات الرسالة (Message Frames for .room-chat-bubble)  2. تأثيرات الدخول (Entry Effects)
  const ROOM_CHAT_BUBBLE_FRAMES = [
    { id: '', name: 'الإطار الكلاسيكي (بنفسجي سول)', icon: '💜', desc: 'إطار الرسائل الافتراضي الأنيق', previewClass: '' },
    { id: 'royal_gold', name: 'إطار الإمبراطور الذهبي', icon: '👑', desc: 'إطار ملكي ذهبي متوهج للرسائل', previewClass: 'chat-frame-royal_gold' },
    { id: 'cyber_neon', name: 'إطار النيون السماوي', icon: '⚡', desc: 'إطار نيون مضيء بتدرج أزرق وبنفسجي', previewClass: 'chat-frame-cyber_neon' },
    { id: 'fire_dragon', name: 'إطار لهب التنين', icon: '🔥', desc: 'إطار ناري متوهج يلفت الأنظار في العام', previewClass: 'chat-frame-fire_dragon' },
    { id: 'emerald_vip', name: 'إطار الزمرد الملكي VIP', icon: '🟢', desc: 'إطار زمردي فاخر لأصحاب الثروة العالية', previewClass: 'chat-frame-emerald_vip' },
    { id: 'rose_romance', name: 'إطار الياقوت الوردي', icon: '🌸', desc: 'إطار رومانسي ناعم متألق', previewClass: 'chat-frame-rose_romance' }
  ];

  function openRoomAccessoriesModal(room) {
    if (!requireAuth()) return;
    const existing = document.getElementById('room-accessories-modal');
    if (existing) existing.remove();

    let activeAccTab = 'chat_frames'; // 'chat_frames' | 'entry_effects'

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'room-accessories-modal';

    const renderAccContent = () => {
      const bodyEl = modal.querySelector('#accessories-tab-body');
      if (!bodyEl) return;

      if (activeAccTab === 'chat_frames') {
        const selectedFrame = (state.currentUser && state.currentUser.chat_frame) || localStorage.getItem('soulchill_chat_frame') || '';
        bodyEl.innerHTML = `
          <div style="font-size: 11px; color: #cbd5e1; margin-bottom: 10px; text-align: center;">
            اختر إطار رسالتك ليظهر لجميع المتواجدين في الدردشة العامة داخل الغرفة 💬✨
          </div>
          <div class="accessories-grid">
            ${ROOM_CHAT_BUBBLE_FRAMES.map(f => {
              const isEquipped = selectedFrame === f.id;
              return `
                <div class="accessory-card-item ${isEquipped ? 'equipped' : ''}" data-chat-frame-id="${f.id}">
                  <div class="acc-preview-bubble ${f.previewClass}">
                    <span style="font-size: 16px;">${f.icon}</span>
                    <span style="font-size: 10px; font-weight: 700; color: #fff;">أهلاً بكم ✨</span>
                  </div>
                  <div class="acc-item-title">${f.name}</div>
                  <div class="acc-item-desc">${f.desc}</div>
                  <button type="button" class="acc-equip-btn ${isEquipped ? 'active' : ''}">
                    ${isEquipped ? '✅ مفعل الآن' : 'تفعيل الإطار'}
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        `;

        bodyEl.querySelectorAll('.accessory-card-item').forEach(card => {
          card.onclick = async () => {
            const frameId = card.dataset.chatFrameId;
            localStorage.setItem('soulchill_chat_frame', frameId);
            if (state.currentUser) {
              state.currentUser.chat_frame = frameId;
              localStorage.setItem('soulchill_user', JSON.stringify(state.currentUser));
              try {
                await fetch('/api/users/accessories', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-user-id': state.currentUser.id
                  },
                  body: JSON.stringify({ chat_frame: frameId })
                });
              } catch (e) {}
            }
            const frameObj = ROOM_CHAT_BUBBLE_FRAMES.find(x => x.id === frameId);
            showToast(`💬 تم تفعيل "${frameObj ? frameObj.name : 'إطار الرسالة'}" لرسائلك في الغرفة! ✨`);
            renderAccContent();
          };
        });
      } else if (activeAccTab === 'avatar_frames') {
        renderAvatarFramesTab(bodyEl);
      } else if (activeAccTab === 'room_cards') {
        renderRoomCardsTab(bodyEl);
      } else {
        renderEntryTemplatesTab(bodyEl);
      }
    };

    // ===== إطارات الصورة: شراء بالكرستالات ثم تفعيل (يستخدم /api/avatar-frames) =====
    const renderAvatarFramesTab = async (bodyEl) => {
      const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      bodyEl.innerHTML = '<div style="text-align:center; color:#cbd5e1; font-size:12px; padding:24px 0;">جارٍ تحميل الإطارات…</div>';
      let data;
      try {
        const res = await fetch('/api/avatar-frames', { headers: { 'x-user-id': state.currentUser.id } });
        data = await res.json();
        if (!res.ok) throw new Error(data.error || 'error');
      } catch (e) {
        bodyEl.innerHTML = '<div style="text-align:center; color:#fca5a5; font-size:12px; padding:24px 0;">تعذر تحميل الإطارات، حاول مرة أخرى</div>';
        return;
      }
      const frames = (data.frames || []).filter(f => f.is_active || f.owned);
      if (!frames.length) {
        bodyEl.innerHTML = '<div class="acc-empty-pro">لا يوجد بيانات حالياً</div>';
        return;
      }
      bodyEl.innerHTML = '<div class="acc-frames-grid-pro">' + frames.map(f => {
        const eq = data.equipped === f.id;
        return `<div class="acc-frame-card-pro ${eq ? 'equipped' : ''}" data-frame-id="${esc(f.id)}" data-owned="${f.owned ? 1 : 0}" data-price="${f.price || 0}">
          ${eq ? '<span class="acc-check-pro">✓</span>' : ''}
          <div class="acc-frame-thumb-pro"><img src="${esc(state.currentUser.avatar || '/avatars/avatar-1.png')}" /><img class="acc-frame-overlay" src="${esc(f.image_url)}" /></div>
          <div class="acc-item-title">${esc(f.name)}</div>
          <button type="button" class="acc-equip-btn ${eq ? 'active' : ''}">${eq ? '✅ مفعل الآن' : (f.owned ? 'تفعيل' : (f.price > 0 ? 'شراء ' + Number(f.price).toLocaleString() + ' 💎' : 'مجاني'))}</button>
        </div>`;
      }).join('') + '</div>';

      const syncUser = (u) => {
        if (!u) return;
        state.currentUser = Object.assign(state.currentUser || {}, u);
        localStorage.setItem('soulchill_user', JSON.stringify(state.currentUser));
        updateHeaderUI();
      };
      bodyEl.querySelectorAll('.acc-frame-card-pro').forEach(card => {
        const btn = card.querySelector('.acc-equip-btn');
        btn.onclick = async () => {
          const id = card.dataset.frameId;
          btn.disabled = true;
          try {
            if (card.dataset.owned !== '1') {
              const r = await fetch('/api/avatar-frames/' + encodeURIComponent(id) + '/buy', { method: 'POST', headers: { 'x-user-id': state.currentUser.id } });
              const out = await r.json();
              if (!r.ok || !out.success) { showToast(out.error || 'تعذر شراء الإطار'); btn.disabled = false; return; }
              syncUser(out.user);
            }
            const r2 = await fetch('/api/users/accessories', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': state.currentUser.id }, body: JSON.stringify({ avatar_frame: id }) });
            const out2 = await r2.json();
            if (!r2.ok || !out2.success) { showToast(out2.error || 'تعذر تفعيل الإطار'); btn.disabled = false; return; }
            syncUser(out2.user);
            showToast('🖼️ تم تفعيل إطار الصورة ✨');
            renderAvatarFramesTab(bodyEl);
          } catch (e) { showToast('تعذر الاتصال بالخادم'); btn.disabled = false; }
        };
      });
    };

    // ===== بطاقات الغرف: شراء بالكرستالات ثم تفعيل، فتتغير بطاقة غرفتك في قائمة الغرف =====
    const renderRoomCardsTab = async (bodyEl) => {
      const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      bodyEl.innerHTML = '<div style="text-align:center; color:#cbd5e1; font-size:12px; padding:24px 0;">جارٍ تحميل بطاقات الغرف…</div>';
      let data;
      try {
        const res = await fetch('/api/room-cards', { headers: { 'x-user-id': state.currentUser.id } });
        data = await res.json();
        if (!res.ok) throw new Error(data.error || 'error');
      } catch (e) {
        bodyEl.innerHTML = '<div style="text-align:center; color:#fca5a5; font-size:12px; padding:24px 0;">تعذر تحميل بطاقات الغرف، حاول مرة أخرى</div>';
        return;
      }
      const cards = data.cards || [];
      if (!cards.length) {
        bodyEl.innerHTML = '<div class="acc-empty-pro">لا توجد بطاقات غرف متاحة حالياً</div>';
        return;
      }
      const balance = (state.currentUser && state.currentUser.diamonds) || 0;
      bodyEl.innerHTML = `
        <div style="font-size: 11px; color: #cbd5e1; margin-bottom: 10px; text-align: center; line-height:1.7;">
          البطاقة المفعّلة تغيّر شكل غرفتك من الخارج بين الغرف 🏠✨<br>
          رصيدك: <strong style="color:#38bdf8;">${Number(balance).toLocaleString()} 💎</strong>
        </div>
        <div class="acc-roomcards-grid">
          ${cards.map(c => {
            const eq = c.owned && data.equipped === c.id;
            const priceLabel = c.price > 0 ? Number(c.price).toLocaleString() + ' 💎' : 'مجاني';
            return `<div class="acc-roomcard-item ${eq ? 'equipped' : ''}" data-card-id="${esc(c.id)}" data-owned="${c.owned ? 1 : 0}">
              ${eq ? '<span class="acc-check-pro">✓</span>' : ''}
              <div class="acc-roomcard-preview" style="background-image:url('${esc(encodeURI(c.image_url))}')">
                <span class="acc-roomcard-title">${esc(c.name)}</span>
              </div>
              <button type="button" class="acc-equip-btn ${eq ? 'active' : ''}">${eq ? '✅ مفعّلة (إلغاء)' : (c.owned ? 'تفعيل' : 'شراء ' + priceLabel)}</button>
            </div>`;
          }).join('')}
        </div>`;

      const syncUser = (u) => {
        if (!u) return;
        state.currentUser = Object.assign(state.currentUser || {}, u);
        localStorage.setItem('soulchill_user', JSON.stringify(state.currentUser));
        updateHeaderUI();
      };
      bodyEl.querySelectorAll('.acc-roomcard-item').forEach(item => {
        const btn = item.querySelector('.acc-equip-btn');
        btn.onclick = async () => {
          const id = item.dataset.cardId;
          const c = cards.find(x => x.id === id);
          btn.disabled = true;
          try {
            if (item.dataset.owned !== '1') {
              const ok = await window.uiConfirm(`شراء «${c.name}» مقابل ${Number(c.price).toLocaleString()} كريستالة؟`, { title: 'تأكيد الشراء', okText: 'شراء' });
              if (!ok) { btn.disabled = false; return; }
              const r = await fetch('/api/room-cards/' + encodeURIComponent(id) + '/buy', { method: 'POST', headers: { 'x-user-id': state.currentUser.id } });
              const out = await r.json();
              if (!r.ok || !out.success) { showToast(out.error || 'تعذر شراء البطاقة'); btn.disabled = false; return; }
              syncUser(out.user);
            }
            const turnOff = data.equipped === id;
            const r2 = await fetch('/api/room-cards/equip', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': state.currentUser.id }, body: JSON.stringify({ cardId: turnOff ? '' : id }) });
            const out2 = await r2.json();
            if (!r2.ok || !out2.success) { showToast(out2.error || 'تعذر تفعيل البطاقة'); btn.disabled = false; return; }
            syncUser(out2.user);
            showToast(turnOff ? 'تم إلغاء تفعيل بطاقة الغرفة' : '🏠 تم تفعيل بطاقة الغرفة، ستظهر غرفتك بشكلها الجديد ✨');
            try { loadRoomsList(); } catch (e) {}
            renderRoomCardsTab(bodyEl);
          } catch (e) { showToast('تعذر الاتصال بالخادم'); btn.disabled = false; }
        };
      });
    };

    // ===== قوالب الدخول: لا دخول لأحد إلا بقالب يملكه (شراء بالكرستالات) =====
    const renderEntryTemplatesTab = async (bodyEl) => {
      const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      bodyEl.innerHTML = `<div style="text-align:center; color:#cbd5e1; font-size:12px; padding:24px 0;">جارٍ تحميل قوالب الدخول…</div>`;

      let data;
      try {
        const res = await fetch('/api/entry-templates', { headers: { 'x-user-id': state.currentUser.id } });
        data = await res.json();
        if (!res.ok) throw new Error(data.error || 'error');
      } catch (e) {
        bodyEl.innerHTML = `<div style="text-align:center; color:#fca5a5; font-size:12px; padding:24px 0;">تعذر تحميل قوالب الدخول، حاول مرة أخرى</div>`;
        return;
      }

      const templates = data.templates || [];
      const equippedId = data.equipped || '';
      const balance = (state.currentUser && state.currentUser.diamonds) || 0;

      if (!templates.length) {
        bodyEl.innerHTML = `
          <div style="text-align:center; color:#cbd5e1; font-size:12px; padding:24px 8px; line-height:1.8;">
            لا توجد قوالب دخول متاحة حالياً 🦅<br>سيتم إضافتها قريباً من الإدارة
          </div>`;
        return;
      }

      bodyEl.innerHTML = `
        <div style="font-size: 11px; color: #cbd5e1; margin-bottom: 10px; text-align: center; line-height:1.7;">
          الدخول المتحرك لا يظهر إلا لمن يملك قالب دخول. اشترِ قالبك بالكرستالات ثم فعّله 🦅<br>
          رصيدك: <strong style="color:#38bdf8;">${balance.toLocaleString()} 💎</strong>
        </div>
        <div class="accessories-grid">
          ${templates.map(t => {
            const isEquipped = t.owned && equippedId === t.id;
            const priceLabel = t.price > 0 ? `${t.price.toLocaleString()} 💎` : 'مجاني';
            return `
              <div class="accessory-card-item entry-tpl-card ${isEquipped ? 'equipped' : ''}" data-tpl-id="${esc(t.id)}">
                <div class="acc-entry-badge">${t.owned ? 'تملكه ✅' : priceLabel}</div>
                <div class="acc-gif-preview-card">
                  <img src="${esc(t.image_url)}" alt="${esc(t.name)}" class="acc-gif-preview-img" />
                </div>
                <div class="acc-item-title">${esc(t.name)}</div>
                <div class="entry-tpl-actions">
                  <button type="button" class="acc-equip-btn entry-tpl-preview-btn">👁️ معاينة</button>
                  ${t.owned
                    ? `<button type="button" class="acc-equip-btn entry-tpl-main-btn ${isEquipped ? 'active' : ''}" data-act="${isEquipped ? 'unequip' : 'equip'}">${isEquipped ? '✅ مفعّل (إلغاء)' : 'تفعيل'}</button>`
                    : `<button type="button" class="acc-equip-btn entry-tpl-main-btn entry-tpl-buy-btn" data-act="buy">شراء ${priceLabel}</button>`}
                </div>
              </div>`;
          }).join('')}
        </div>
      `;

      const updateUserFromServer = (user) => {
        if (!user) return;
        state.currentUser = Object.assign(state.currentUser || {}, user);
        localStorage.setItem('soulchill_user', JSON.stringify(state.currentUser));
        updateHeaderUI();
      };

      bodyEl.querySelectorAll('.entry-tpl-card').forEach(card => {
        const tplId = card.dataset.tplId;
        const tpl = templates.find(x => x.id === tplId);
        const mainBtn = card.querySelector('.entry-tpl-main-btn');
        const previewBtn = card.querySelector('.entry-tpl-preview-btn');

        previewBtn.onclick = (ev) => {
          ev.stopPropagation();
          showRoomEntryEffectBanner(state.currentUser, tpl.id, tpl.image_url, { preview: true });
          modal.remove();
        };

        let confirmTimer = null;
        mainBtn.onclick = async (ev) => {
          ev.stopPropagation();
          const act = mainBtn.dataset.act;

          if (act === 'buy') {
            // ضغطة أولى: تأكيد. ضغطة ثانية: شراء فعلي
            if (!mainBtn.classList.contains('confirming')) {
              mainBtn.classList.add('confirming');
              mainBtn.textContent = `تأكيد الشراء؟ ${tpl.price.toLocaleString()} 💎`;
              confirmTimer = setTimeout(() => {
                mainBtn.classList.remove('confirming');
                mainBtn.textContent = `شراء ${tpl.price > 0 ? tpl.price.toLocaleString() + ' 💎' : 'مجاني'}`;
              }, 4000);
              return;
            }
            clearTimeout(confirmTimer);
            mainBtn.disabled = true;
            try {
              const res = await fetch(`/api/entry-templates/${encodeURIComponent(tpl.id)}/buy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-user-id': state.currentUser.id }
              });
              const out = await res.json();
              if (!res.ok || !out.success) {
                showNiceNotice({ type: 'danger', icon: '💎', title: 'تعذر شراء القالب', message: out.error || 'حدث خطأ، حاول مرة أخرى' });
                mainBtn.disabled = false;
                mainBtn.classList.remove('confirming');
                mainBtn.textContent = `شراء ${tpl.price > 0 ? tpl.price.toLocaleString() + ' 💎' : 'مجاني'}`;
                return;
              }
              updateUserFromServer(out.user);
              showNiceNotice({ type: 'info', icon: '🦅', title: 'تم شراء القالب', message: `أصبح قالب "${tpl.name}" ملكك، فعّله ليظهر عند دخولك الغرفة` });
              renderEntryTemplatesTab(bodyEl);
            } catch (e) {
              showNiceNotice({ type: 'danger', icon: '💎', title: 'تعذر شراء القالب', message: 'تعذر الاتصال بالخادم' });
              mainBtn.disabled = false;
            }
            return;
          }

          // تفعيل / إلغاء تفعيل
          mainBtn.disabled = true;
          try {
            const res = await fetch('/api/entry-templates/equip', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-user-id': state.currentUser.id },
              body: JSON.stringify({ templateId: act === 'equip' ? tpl.id : '' })
            });
            const out = await res.json();
            if (!res.ok || !out.success) {
              showNiceNotice({ type: 'danger', icon: '🚫', title: 'تعذر تفعيل القالب', message: out.error || 'حدث خطأ، حاول مرة أخرى' });
              mainBtn.disabled = false;
              return;
            }
            updateUserFromServer(out.user);
            showToast(act === 'equip' ? 'تم تفعيل قالب الدخول ✨ سيظهر عند دخولك الغرفة' : 'تم إلغاء تفعيل قالب الدخول');
            renderEntryTemplatesTab(bodyEl);
          } catch (e) {
            showNiceNotice({ type: 'danger', icon: '🚫', title: 'تعذر تفعيل القالب', message: 'تعذر الاتصال بالخادم' });
            mainBtn.disabled = false;
          }
        };
      });
    };

    modal.innerHTML = `
      <div class="soul-modal-content accessories-modal-box" style="max-width: 420px;">
        <button class="soul-modal-close-btn" id="close-accessories-modal-btn">✕</button>
        <div class="modal-header-title">
          ✨ إكسسوارات الغرفة الملكية
        </div>

        <div class="accessories-tabs-bar">
          <button type="button" class="acc-tab-btn active" id="tab-btn-chat-frames">
            💬 إطارات الرسالة
          </button>
          <button type="button" class="acc-tab-btn" id="tab-btn-entry-effects">
            🦅 قوالب الدخول
          </button>
          <button type="button" class="acc-tab-btn" id="tab-btn-avatar-frames">
            🖼️ إطارات الصورة
          </button>
          <button type="button" class="acc-tab-btn" id="tab-btn-room-cards">
            🏠 بطاقات الغرف
          </button>
        </div>

        <div id="accessories-tab-body" style="margin-top: 10px;"></div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-accessories-modal-btn').onclick = () => modal.remove();

    const accTabs = {
      chat_frames: modal.querySelector('#tab-btn-chat-frames'),
      entry_effects: modal.querySelector('#tab-btn-entry-effects'),
      avatar_frames: modal.querySelector('#tab-btn-avatar-frames'),
      room_cards: modal.querySelector('#tab-btn-room-cards')
    };
    Object.keys(accTabs).forEach(key => {
      accTabs[key].onclick = () => {
        activeAccTab = key;
        Object.values(accTabs).forEach(b => b.classList.remove('active'));
        accTabs[key].classList.add('active');
        renderAccContent();
      };
    });

    renderAccContent();
  }

  let entryEffectTimeoutId = null;

  function showRoomEntryEffectBanner(user, effectId, imageUrl, opts = {}) {
    const slot = document.getElementById('room-entry-effect-slot');
    const chatStream = document.getElementById('room-chat-messages-container');
    // لا يظهر أي دخول بدون قالب (صورة) يملكه المستخدم
    if (!slot || !user || !imageUrl) return;

    if (entryEffectTimeoutId) {
      clearTimeout(entryEffectTimeoutId);
      entryEffectTimeoutId = null;
    }

    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const userName = esc(user.name || 'عضو ملكي');
    const wealthLevel = user.wealth_level || (user.role === 'owner' ? 99 : 11);

    // إزالة أي تأثير سابق
    const oldLayer = document.getElementById('soulchill-seamless-room-entry-layer');
    if (oldLayer) oldLayer.remove();
    slot.innerHTML = '';

    // 1. تأثير الدخول: طبقة بعرض الشاشة تغطي الجزء السفلي من الغرفة (تحت المقاعد) مع تلاشٍ ناعم من الأعلى
    const roomContainer = slot.closest('.live-room-container') || document.body;
    const layer = document.createElement('div');
    layer.id = 'soulchill-seamless-room-entry-layer';
    layer.className = 'soulchill-seamless-room-entry-layer entry-bottom';
    layer.innerHTML = `<img src="${esc(imageUrl)}" alt="" class="seamless-room-entry-gif" />`;
    roomContainer.appendChild(layer);

    // 2. سطر الدخول في الدردشة (لا يُضاف في المعاينة)
    if (chatStream && !opts.preview) {
      const welcomeEl = document.createElement('div');
      welcomeEl.className = 'room-entry-welcome-line';
      welcomeEl.textContent = `أهلاً @${user.name || 'عضو'}`;
      chatStream.appendChild(welcomeEl);

      const arrivedEl = document.createElement('div');
      arrivedEl.className = 'room-entry-arrived-line';
      arrivedEl.innerHTML = `
        <span class="room-entry-arrived-name"><span class="room-entry-arrived-lv">Lv.${wealthLevel}</span>${userName}</span>
        <span class="room-entry-arrived-verb">وصل</span>
      `;
      chatStream.appendChild(arrivedEl);
      chatStream.scrollTop = chatStream.scrollHeight;
    }

    // 3. التلاشي بعد انتهاء التأثير
    entryEffectTimeoutId = setTimeout(() => {
      layer.classList.add('fade-out');
      setTimeout(() => { if (layer.parentElement) layer.remove(); }, 650);
    }, 4800);
  }

  async function loadRoomChatMessages(roomId) {
    if (!state.currentUser) return;
    try {
      const res = await fetch(`/api/rooms/${roomId}/messages`);
      const messages = await res.json();
      messages.forEach(msg => appendRoomChatMessage(msg));
    } catch (err) {
      console.error('Error fetching room messages:', err);
    }
  }

  function appendRoomChatMessage(msg) {
    if (!state.currentUser) return;
    const stream = document.getElementById('room-chat-messages-container');
    if (!stream) return;

    const el = document.createElement('div');

    // Determine equipped chat bubble frame
    let chatFrame = msg.sender_chat_frame || '';
    if (!chatFrame && state.currentUser && msg.sender_id === state.currentUser.id) {
      chatFrame = state.currentUser.chat_frame || localStorage.getItem('soulchill_chat_frame') || '';
    }
    const frameClass = chatFrame ? `chat-frame-${chatFrame}` : '';

    el.className = `room-chat-bubble ${msg.message_type === 'gift' ? 'gift-notice' : ''} ${frameClass}`.trim();

    // Calculate Wealth Level (الثروة) and User Level (الليفيل) matching image-3.png
    const isSelf = state.currentUser && msg.sender_id === state.currentUser.id;
    const wealthLevel = msg.sender_wealth_level || (isSelf ? state.currentUser.wealth_level : null) || (msg.sender_role === 'owner' ? 99 : 11);
    const userLevel = msg.sender_level || (isSelf ? state.currentUser.level : null) || 7;

    // Wealth badge color tier based on wealth_level
    let wealthTierClass = 'wealth-tier-green';
    if (wealthLevel >= 50) wealthTierClass = 'wealth-tier-imperial';
    else if (wealthLevel >= 25) wealthTierClass = 'wealth-tier-gold';
    else if (wealthLevel >= 15) wealthTierClass = 'wealth-tier-cyan';

    // Level badge color tier based on level
    let levelTierClass = 'level-tier-purple';
    if (userLevel >= 50) levelTierClass = 'level-tier-royal';
    else if (userLevel >= 20) levelTierClass = 'level-tier-magenta';

    // Format @mentions in warm gold like image-3.png ("أهلاً، @mratab")
    let safeContent;
    if (msg.auto_welcome && msg.welcome_mention) {
      // ترحيب تلقائي من صاحب الغرفة: نهرّب الاسم كاملاً ونظلّله كمنشن واحد
      const escHtml = (t) => String(t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
      safeContent = `أهلاً، <span class="chat-mention-highlight">@${escHtml(msg.welcome_mention)}</span>`;
    } else {
      safeContent = String(msg.content || '').replace(/(@[\w\u0600-\u06FF._-]+)/g, '<span class="chat-mention-highlight">$1</span>');
    }
    if (msg.message_type === 'emoji') {
      const eu = String(msg.content || '');
      safeContent = /^\/uploads\//.test(eu) ? `<img class="room-chat-emoji-img" src="${fEsc(eu)}" alt="" draggable="false" onerror="this.replaceWith(document.createTextNode('😊'))" />` : '😊';
    }

    // مطابق لفيديو الغرفة: الصورة + الاسم + الليفل بجانب الاسم فقط، ثم نص الرسالة.
    el.innerHTML = `
      <div class="room-chat-card-inner">
        <div class="room-chat-header-row">
          <img src="${msg.sender_avatar}" class="room-chat-avatar ${msg.sender_frame ? 'avatar-frame-' + msg.sender_frame : ''}" onerror="this.src='/avatars/avatar-1.png'" />
          <span class="room-chat-sender-name">${msg.sender_name || 'عضو'}</span>
          <span class="room-chat-level-pill ${levelTierClass}">
            <span class="level-emblem"></span>
            <span>Lv.${userLevel}</span>
          </span>
        </div>
        <div class="room-chat-text">${safeContent}</div>
      </div>
    `;

    // النقر على اسم المرسل (أي شخص في الغرفة) يفتح بطاقته السفلية كما في الفيديو
    const nameEl = el.querySelector('.room-chat-sender-name');
    if (nameEl && msg.sender_id) {
      nameEl.style.cursor = 'pointer';
      nameEl.onclick = (ev) => {
        ev.stopPropagation();
        openRoomUserSheet({
          id: msg.sender_id,
          name: msg.sender_name,
          avatar: msg.sender_avatar,
          avatar_frame: msg.sender_frame,
          level: msg.sender_level,
          wealth_level: msg.sender_wealth_level,
          charm_level: msg.sender_charm_level,
          role: msg.sender_role
        });
      };
    }

    // Clicking sender avatar mentions @username in input
    const avatarEl = el.querySelector('.room-chat-avatar');
    if (avatarEl && msg.sender_name) {
      avatarEl.style.cursor = 'pointer';
      avatarEl.onclick = () => {
        const inputEl = document.getElementById('room-chat-text-input');
        if (inputEl && !inputEl.disabled) {
          inputEl.value = `أهلاً، @${msg.sender_name.split(' ')[0]} `;
          inputEl.focus();
        }
      };
    }

    stream.appendChild(el);
    stream.scrollTop = stream.scrollHeight;
  }

  // Handle Stage Seat Click
  async function handleSeatClick(seatIndex) {
    if (!requireAuth()) return;
    if (!state.activeRoom) return;

    const currentRoom = state.activeRoom;
    const isRoomAdmin = state.currentUser && (currentRoom.host_id === state.currentUser.id || isPlatformStaff(state.currentUser));
    const seat = (currentRoom.seats || []).find(s => s.seat_index === seatIndex);
    const isOccupied = seat && seat.user_id;

    // Special handling for Seat 0 (Host Central Throne)
    if (seatIndex === 0) {
      if (state.userSeatIndex === 0) {
        // Current user is occupying seat 0 -> Show menu with mic mute/unmute and step down option!
        showOwnSeatMenu(0);
        return;
      }
      if (isOccupied) {
        if (isRoomAdmin) {
          showAdminSeatModerationModal(0, seat);
        } else {
          showUserProfileCard({
            id: seat.user_id,
            name: seat.name,
            avatar: seat.avatar,
            avatar_frame: seat.avatar_frame,
            level: seat.level || 10,
            wealth_level: 5,
            charm_level: 6,
            soul_planet: 'كوكب صاحب الروم 👑'
          });
        }
        return;
      }
      // Seat 0 is EMPTY: only room host / owner can sit on seat 0
      if (isRoomAdmin) {
        takeSeatAction(0);
        showToast('صعدت إلى مقعد المضيف على المايك! 👑🎙️');
      } else {
        showToast('هذا المقعد مخصص لصاحب الغرفة (المضيف) فقط 👑');
      }
      return;
    }

    // Case 1: Current user clicks their own seat -> Show personal mic / leave seat controls
    if (state.userSeatIndex === seatIndex) {
      showOwnSeatMenu(seatIndex);
      return;
    }

    // Case 2: Seat is occupied by another user
    if (isOccupied) {
      if (isRoomAdmin) {
        showAdminSeatModerationModal(seatIndex, seat);
      } else {
        showUserProfileCard({
          id: seat.user_id,
          name: seat.name,
          avatar: seat.avatar,
          avatar_frame: seat.avatar_frame,
          level: seat.level || 6,
          wealth_level: 4,
          charm_level: seat.charm_level || 5,
          soul_planet: 'كوكب السول 🌟'
        });
      }
      return;
    }

    // Case 3: Empty Seat that is locked
    if (seat && seat.is_locked) {
      if (isRoomAdmin) {
        const unlock = await uiConfirm(`المقعد رقم ${seatIndex} مقفل حالياً. هل ترغب بفتحه للجمهور؟`, { icon: '🔓', okText: 'فتح المقعد' });
        if (unlock) {
          state.socket.emit('admin_lock_seat', {
            roomId: currentRoom.id,
            seatIndex,
            adminId: state.currentUser.id,
            isLocked: false
          });
          seat.is_locked = 0;
          updateRoomSeatUI(seatIndex, null, false);
          showToast(`تم فتح المقعد رقم ${seatIndex} للجميع! 🔓`);
        }
      } else {
        showToast('هذا المقعد مقفل من قِبل إدارة الروم 🔒');
      }
      return;
    }

    // Case 4: User is ALREADY in another seat (e.g. seat 1) and clicks an empty seat (e.g. seat 2)
    // Moving to new seat automatically vacates their previous seat (only ONE seat per user)
    if (state.userSeatIndex !== null && state.userSeatIndex !== seatIndex) {
      if (state.userSeatIndex === 0) {
        // Host sitting on central throne (seat 0)
        if (isRoomAdmin) {
          showEmptySeatAdminModal(seatIndex);
          return;
        }
      }
      const prevSeat = state.userSeatIndex;
      takeSeatAction(seatIndex);
      showToast(`انتقلت من المقعد #${prevSeat} إلى المقعد #${seatIndex} 🎙️`);
      return;
    }

    // Case 5: If admin clicks empty seat, offer to take or lock
    if (isRoomAdmin) {
      showEmptySeatAdminModal(seatIndex);
      return;
    }

    // Case 6: Regular user takes empty seat
    takeSeatAction(seatIndex);
  }

  function takeSeatAction(seatIndex) {
    if (!state.activeRoom || !state.currentUser) return;
    const targetSeat = (state.activeRoom.seats || []).find(seat => seat.seat_index === seatIndex);
    const adminMuted = !!(targetSeat && targetSeat.is_muted);
    state.socket.emit('take_seat', {
      roomId: state.activeRoom.id,
      seatIndex,
      userId: state.currentUser.id
    });
    state.userSeatIndex = seatIndex;
    state.isMuted = adminMuted;
    if (adminMuted) {
      stopLocalMicCapture();
      if (window.soulRtc) window.soulRtc.stopBroadcastingVoice();
    } else {
      startLocalMicCapture();
      if (window.soulRtc && state.activeRoom) {
        window.soulRtc.startBroadcastingVoice(state.activeRoom.id);
        window.soulRtc.setVoiceMuted(false);
      }
    }
    updateMicButtonUI();
    showToast(adminMuted
      ? `صعدت إلى المقعد رقم ${seatIndex}، لكن المقعد مكتوم من الإدارة 🔇`
      : `صعدت إلى المقعد رقم ${seatIndex} على المايك! 🎙️`);
  }

  function showOwnSeatMenu(seatIndex) {
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.innerHTML = `
      <div class="seat-admin-modal-box">
        <div style="font-size: 15px; font-weight: 800; color: #fff; margin-bottom: 12px;">🎙️ إدارة مقعدك الحالي (#${seatIndex})</div>
        <button class="seat-admin-action-btn" id="btn-toggle-own-mic">
          <span>${state.isMuted ? '🎙️ إلغاء كتم المايك وتحدث' : '🔇 كتم صوت المايك'}</span>
        </button>
        <button class="seat-admin-action-btn danger" id="btn-leave-own-seat">
          <span>🪑 النزول من مقعد المايك إلى الجمهور</span>
        </button>
        <button class="seat-admin-action-btn" id="btn-close-own-menu" style="background: transparent; border: none; color: var(--text-muted); justify-content: center;">إلغاء</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#btn-toggle-own-mic').onclick = () => {
      toggleUserMic();
      modal.remove();
    };
    modal.querySelector('#btn-leave-own-seat').onclick = () => {
      state.socket.emit('leave_seat', {
        roomId: state.activeRoom.id,
        seatIndex,
        userId: state.currentUser.id
      });
      state.userSeatIndex = null;
      state.isMuted = true;
      stopLocalMicCapture();
      if (window.soulRtc) {
        window.soulRtc.stopBroadcastingVoice();
      }
      updateMicButtonUI();
      modal.remove();
      showToast('نزلت من مقعد المايك إلى الجمهور 👥');
    };
    modal.querySelector('#btn-close-own-menu').onclick = () => modal.remove();
  }

  function showAdminSeatModerationModal(seatIndex, seat) {
    const isMuted = !!seat.is_muted;
    const isChatMuted = state.activeRoomMutedChatUsers && state.activeRoomMutedChatUsers.has(seat.user_id);
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.innerHTML = `
      <div class="seat-admin-modal-box">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px; text-align: right;">
          <img src="${seat.avatar}" style="width: 44px; height: 44px; border-radius: 50%; border: 2px solid var(--primary);" />
          <div>
            <div style="font-size: 14px; font-weight: 800; color: #fff;">${seat.name}</div>
            <div style="font-size: 11px; color: #fbbf24;">مقعد المايك #${seatIndex}</div>
          </div>
        </div>

        <button class="seat-admin-action-btn" id="admin-mute-seat-btn">
          <span>${isMuted ? '🎙️ إلغاء كتم مايك هذا العضو' : '🔇 كتم مايك هذا العضو إجبارياً'}</span>
        </button>
        <button class="seat-admin-action-btn" id="admin-toggle-chat-mute-seat-btn" style="background: rgba(245,158,11,0.18); border: 1px solid rgba(245,158,11,0.4); color: #fbbf24;">
          <span>${isChatMuted ? '🔊 إلغاء كتم العضو من الكتابة' : '🔇 كتم العضو من الكتابة ع العام'}</span>
        </button>
        <button class="seat-admin-action-btn danger" id="admin-kick-seat-btn">
          <span>🪑 إنزال العضو من المايك إلى الجمهور</span>
        </button>
        <button class="seat-admin-action-btn danger" id="admin-lock-occupied-seat-btn" style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.5); color: #fca5a5;">
          <span>🔒 إنزال العضو وقفل هذا المقعد</span>
        </button>
        <button class="seat-admin-action-btn danger" id="admin-kick-room-seat-btn">
          <span>🚪 طرد العضو من الغرفة نهائياً</span>
        </button>
        <button class="seat-admin-action-btn" id="admin-gift-seat-btn">
          <span>🎁 إرسال هدية فاخرة لهذا المقعد</span>
        </button>
        <button class="seat-admin-action-btn" id="admin-profile-seat-btn">
          <span>👤 عرض البروفايل الكامل والبيو</span>
        </button>
        <button class="seat-admin-action-btn" id="admin-cancel-btn" style="background: transparent; border: none; color: var(--text-muted); justify-content: center;">إغلاق</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#admin-mute-seat-btn').onclick = () => {
      const willMute = !isMuted;
      state.socket.emit('admin_mute_seat', {
        roomId: state.activeRoom.id,
        seatIndex,
        adminId: state.currentUser.id,
        isMuted: willMute
      });
      seat.is_muted = willMute ? 1 : 0;
      updateSeatMuteUI(seatIndex, willMute);
      if (seat.user_id && window.soulRtc) {
        window.soulRtc.silenceRemoteUser(seat.user_id, willMute);
      }
      showToast(willMute ? `تم كتم صوت المايك للمقعد ${seatIndex}! 🔇` : `تم فتح صوت المايك للمقعد ${seatIndex}! 🎙️`);
      modal.remove();
    };

    modal.querySelector('#admin-toggle-chat-mute-seat-btn').onclick = () => {
      const willMute = !isChatMuted;
      state.socket.emit('admin_mute_user_chat', {
        roomId: state.activeRoom.id,
        targetUserId: seat.user_id,
        adminId: state.currentUser.id,
        isMuted: willMute
      });
      if (willMute) {
        state.activeRoomMutedChatUsers.add(seat.user_id);
        showToast(`تم كتم ${seat.name} من الكتابة ع العام! 🔇`);
      } else {
        state.activeRoomMutedChatUsers.delete(seat.user_id);
        showToast(`تم إلغاء كتم الكتابة عن ${seat.name}! 🔊`);
      }
      renderRoomAudienceStrip(state.activeRoomAudience);
      modal.remove();
    };

    modal.querySelector('#admin-kick-seat-btn').onclick = () => {
      const kickedUserId = seat.user_id;
      state.socket.emit('admin_kick_seat', {
        roomId: state.activeRoom.id,
        seatIndex,
        adminId: state.currentUser.id
      });
      seat.user_id = null;
      updateRoomSeatUI(seatIndex, null, false);
      if (kickedUserId && window.soulRtc) {
        window.soulRtc.removeRemoteUserAudio(kickedUserId);
      }
      showToast(`تم إنزال العضو من المقعد رقم ${seatIndex} بنجاح! 🪑`);
      modal.remove();
    };

    modal.querySelector('#admin-lock-occupied-seat-btn').onclick = () => {
      const kickedUserId = seat.user_id;
      state.socket.emit('admin_lock_seat', {
        roomId: state.activeRoom.id,
        seatIndex,
        adminId: state.currentUser.id,
        isLocked: true
      });
      seat.user_id = null;
      seat.is_locked = 1;
      updateRoomSeatUI(seatIndex, null, false);
      if (kickedUserId && window.soulRtc) {
        window.soulRtc.removeRemoteUserAudio(kickedUserId);
      }
      showToast(`تم إنزال العضو وقفل المقعد رقم ${seatIndex} بنجاح! 🔒`);
      modal.remove();
    };

    modal.querySelector('#admin-kick-room-seat-btn').onclick = async () => {
      if (await uiConfirm(`هل أنت متأكد من طرد [${seat.name}] من الغرفة نهائياً؟`, { icon: '🚪', danger: true, okText: 'طرد' })) {
        state.socket.emit('admin_kick_user_from_room', {
          roomId: state.activeRoom.id,
          targetUserId: seat.user_id,
          adminId: state.currentUser.id
        });
        modal.remove();
      }
    };

    modal.querySelector('#admin-gift-seat-btn').onclick = () => {
      modal.remove();
      openGiftStoreModal(seat.user_id, state.activeRoom.id, { name: seat.name });
    };

    modal.querySelector('#admin-profile-seat-btn').onclick = () => {
      modal.remove();
      showUserProfileCard({
        id: seat.user_id,
        name: seat.name,
        avatar: seat.avatar,
        avatar_frame: seat.avatar_frame,
        level: 6,
        wealth_level: 4,
        charm_level: 5,
        soul_planet: 'كوكب السول 🌟'
      });
    };

    modal.querySelector('#admin-cancel-btn').onclick = () => modal.remove();
  }

  function showEmptySeatAdminModal(seatIndex) {
    const seat = (state.activeRoom?.seats || []).find(s => s.seat_index === seatIndex);
    const isLocked = seat ? !!seat.is_locked : false;
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.innerHTML = `
      <div class="seat-admin-modal-box">
        <div style="font-size: 15px; font-weight: 800; color: #fff; margin-bottom: 12px;">🪑 إدارة المقعد رقم #${seatIndex}</div>
        <button class="seat-admin-action-btn" id="btn-admin-take-seat">
          <span>🎙️ الصعود إلى هذا المقعد وتفعيل المايك</span>
        </button>
        <button class="seat-admin-action-btn" id="btn-admin-lock-this-seat">
          <span>${isLocked ? '🔓 فتح المقعد للجمهور' : '🔒 قفل المقعد (منع أي شخص من الصعود)'}</span>
        </button>
        <button class="seat-admin-action-btn" id="btn-close-empty-menu" style="background: transparent; border: none; color: var(--text-muted); justify-content: center;">إلغاء</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#btn-admin-take-seat').onclick = () => {
      modal.remove();
      takeSeatAction(seatIndex);
    };

    modal.querySelector('#btn-admin-lock-this-seat').onclick = () => {
      const newLockState = !isLocked;
      state.socket.emit('admin_lock_seat', {
        roomId: state.activeRoom.id,
        seatIndex,
        adminId: state.currentUser.id,
        isLocked: newLockState
      });
      if (seat) seat.is_locked = newLockState ? 1 : 0;
      updateRoomSeatUI(seatIndex, null, false);
      showToast(newLockState ? `تم قفل المقعد رقم ${seatIndex} بنجاح! 🔒` : `تم فتح المقعد رقم ${seatIndex} للجمهور! 🔓`);
      modal.remove();
    };

    modal.querySelector('#btn-close-empty-menu').onclick = () => modal.remove();
  }

  function updateRoomSeatUI(seatIndex, user, isMuted) {
    // 1. Sync state.activeRoom.seats in memory
    let prevUserId = null;
    if (state.activeRoom) {
      if (!state.activeRoom.seats) state.activeRoom.seats = [];
      let seatObj = state.activeRoom.seats.find(s => s.seat_index === seatIndex);
      if (seatObj) {
        prevUserId = seatObj.user_id;
        seatObj.user_id = user ? user.id : null;
        seatObj.name = user ? user.name : null;
        seatObj.avatar = user ? user.avatar : null;
        seatObj.avatar_frame = user ? user.avatar_frame : null;
        seatObj.is_muted = isMuted ? 1 : 0;
      } else {
        state.activeRoom.seats.push({
          seat_index: seatIndex,
          user_id: user ? user.id : null,
          name: user ? user.name : null,
          avatar: user ? user.avatar : null,
          avatar_frame: user ? user.avatar_frame : null,
          is_muted: isMuted ? 1 : 0,
          is_locked: 0
        });
      }
    }

    // 2. Track whether this affected current user's seat status
    if (state.currentUser) {
      if (user && user.id === state.currentUser.id) {
        state.userSeatIndex = seatIndex;
        updateMicButtonUI();
      } else if (!user && state.userSeatIndex === seatIndex) {
        // Current user was removed or vacated this seat
        state.userSeatIndex = null;
        state.isMuted = true;
        stopLocalMicCapture();
        if (window.soulRtc) {
          window.soulRtc.stopBroadcastingVoice();
        }
        updateMicButtonUI();
      }
    }

    // If another user was vacated, clean up their remote audio on this client
    if (!user && prevUserId && (!state.currentUser || prevUserId !== state.currentUser.id)) {
      if (window.soulRtc) {
        window.soulRtc.removeRemoteUserAudio(prevUserId);
      }
    }

    // 3. Update the DOM
    if (seatIndex === 0) {
      const hostEl = document.getElementById('host-seat-0');
      if (hostEl) {
        if (user) {
          hostEl.classList.add('occupied');
          hostEl.classList.remove('empty');
          hostEl.innerHTML = `
            <div class="host-crown-badge">👑</div>
            <div class="host-avatar-box">
              <img src="${user.avatar}" class="${user.avatar_frame ? 'avatar-frame-' + user.avatar_frame : ''}" />
              <div class="seat-mic-status ${isMuted ? 'muted' : 'unmuted'}" id="host-mic-badge" style="display: ${isMuted ? 'flex' : 'none'}; position: absolute; bottom: -4px; right: -4px; width: 22px; height: 22px; font-size: 11px;">🔇</div>
            </div>
            <div class="host-name-label">${user.name}</div>
          `;
        } else {
          hostEl.classList.remove('occupied');
          hostEl.classList.add('empty');
          hostEl.innerHTML = `
            <div class="host-crown-badge">👑</div>
            <div class="host-avatar-box empty-host-seat" style="border: 2px dashed rgba(251, 191, 36, 0.6); background: rgba(251, 191, 36, 0.08); display: flex; align-items: center; justify-content: center;">
              <span class="seat-empty-plus" style="font-size: 26px; color: #fbbf24; font-weight: 800;">+</span>
              <div class="seat-mic-status ${isMuted ? 'muted' : 'unmuted'}" id="host-mic-badge" style="display: ${isMuted ? 'flex' : 'none'}; position: absolute; bottom: -4px; right: -4px; width: 22px; height: 22px; font-size: 11px;">🔇</div>
            </div>
            <div class="host-name-label" style="color: #fbbf24;">مقعد المضيف (فارغ)</div>
          `;
        }
      }
      return;
    }

    const seatEl = document.getElementById(`stage-seat-${seatIndex}`);
    if (!seatEl) return;

    if (user) {
      seatEl.classList.add('occupied');
      seatEl.classList.remove('locked');
      seatEl.innerHTML = `
        <div class="seat-avatar-container">
          <img src="${user.avatar}" class="${user.avatar_frame ? 'avatar-frame-' + user.avatar_frame : ''}" />
          <div class="seat-number-badge">${seatIndex}</div>
          <div class="seat-mic-status ${isMuted ? 'muted' : 'unmuted'}" style="display: ${isMuted ? 'flex' : 'none'};">🔇</div>
        </div>
        <div class="seat-user-name">${user.name}</div>
      `;
    } else {
      seatEl.classList.remove('occupied');
      const isLocked = state.activeRoom && (state.activeRoom.seats || []).find(s => s.seat_index === seatIndex)?.is_locked;
      seatEl.classList.toggle('locked', !!isLocked);
      seatEl.innerHTML = `
        <div class="seat-avatar-container">
          <span class="seat-empty-plus">${isLocked ? '🔒' : '+'}</span>
          <div class="seat-number-badge">${seatIndex}</div>
          <div class="seat-mic-status ${isMuted ? 'muted' : 'unmuted'}" style="display: ${isMuted ? 'flex' : 'none'};">🔇</div>
        </div>
        <div class="seat-user-name">${isLocked ? 'مقعد مقفل' : 'مقعد فارغ'}</div>
      `;
    }
  }

  function updateSeatMuteUI(seatIndex, isMuted) {
    if (seatIndex === 0) {
      const hostBadge = document.getElementById('host-mic-badge');
      if (hostBadge) {
        hostBadge.className = `seat-mic-status ${isMuted ? 'muted' : 'unmuted'}`;
        hostBadge.style.display = isMuted ? 'flex' : 'none';
        hostBadge.innerText = '🔇';
      }
      return;
    }
    const seatEl = document.getElementById(`stage-seat-${seatIndex}`);
    if (!seatEl) return;
    const micStatus = seatEl.querySelector('.seat-mic-status');
    if (micStatus) {
      micStatus.className = `seat-mic-status ${isMuted ? 'muted' : 'unmuted'}`;
      micStatus.style.display = isMuted ? 'flex' : 'none';
      micStatus.innerText = '🔇';
    }
  }

  // ربط تذبذبات الصوت (voice-rings.js) بمقعد كل مستخدم
  function voiceRingSeatEl(userId) {
    if (!state.activeRoom) return null;
    const uid = String(userId);
    const seat = (state.activeRoom.seats || []).find(s => s.user_id && String(s.user_id) === uid);
    let idx = seat ? seat.seat_index : null;
    if ((idx === null || idx === undefined) && state.currentUser && String(state.currentUser.id) === uid && state.userSeatIndex !== null && state.userSeatIndex !== undefined) {
      idx = state.userSeatIndex;
    }
    if (idx === null || idx === undefined) return null;
    return idx === 0
      ? document.querySelector('#host-seat-0 .host-avatar-box')
      : document.querySelector(`#stage-seat-${idx} .seat-avatar-container`);
  }
  function initVoiceRings() {
    if (window.voiceRings) window.voiceRings.setResolver(voiceRingSeatEl);
  }

  function toggleSpeakerSoundWaveUI(userId, isSpeaking) {
    // If speaking, add .speaking class to their seat
    if (!state.activeRoom) return;

    // Check host seat 0
    const hostSeat = (state.activeRoom.seats || []).find(s => s.seat_index === 0);
    const hostEl = document.getElementById('host-seat-0');
    if (hostEl && hostSeat && hostSeat.user_id === userId) {
      hostEl.classList.toggle('speaking', isSpeaking);
    }

    // Check 8 guest seats
    (state.activeRoom.seats || []).forEach(seat => {
      if (seat.seat_index !== 0 && seat.user_id === userId) {
        const seatEl = document.getElementById(`stage-seat-${seat.seat_index}`);
        if (seatEl) {
          seatEl.classList.toggle('speaking', isSpeaking);
        }
      }
    });
  }

  // Real Microphone Capture & Sound Wave Analyser
  async function startLocalMicCapture() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn('getUserMedia not supported in this browser context');
        return;
      }

      state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      state.audioContext = new AudioCtx();
      const source = state.audioContext.createMediaStreamSource(state.localStream);
      state.analyser = state.audioContext.createAnalyser();
      state.analyser.fftSize = 512;
      state.analyser.smoothingTimeConstant = 0.4;
      source.connect(state.analyser);
      initVoiceRings();
      if (window.voiceRings && state.currentUser) {
        // تذبذبات حول صورتي حسب مستوى صوتي (تتوقف عند الكتم)
        window.voiceRings.watchAnalyser(String(state.currentUser.id), state.analyser, 'mic', () => !state.isMuted);
      }

      const bufferLength = state.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      let wasSpeaking = false;
      state.micLevelInterval = setInterval(() => {
        if (state.isMuted || !state.analyser) {
          if (wasSpeaking) {
            wasSpeaking = false;
            broadcastSpeakingStatus(false, 0);
          }
          return;
        }

        state.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const isSpeaking = avg > 20; // threshold

        if (isSpeaking !== wasSpeaking) {
          wasSpeaking = isSpeaking;
          broadcastSpeakingStatus(isSpeaking, avg / 255);
        }
      }, 150);
    } catch (err) {
      console.log('Mic permission not granted or available, running in virtual mic mode:', err.message);
    }
  }

  function broadcastSpeakingStatus(isSpeaking, volume) {
    if (!state.activeRoom || !state.currentUser) return;
    state.socket.emit('mic_speaking', {
      roomId: state.activeRoom.id,
      userId: state.currentUser.id,
      isSpeaking,
      volume
    });
    toggleSpeakerSoundWaveUI(state.currentUser.id, isSpeaking);
  }

  function stopLocalMicCapture() {
    if (window.voiceRings && state.currentUser) window.voiceRings.unwatch(String(state.currentUser.id), 'mic');
    if (state.micLevelInterval) {
      clearInterval(state.micLevelInterval);
      state.micLevelInterval = null;
    }
    if (state.localStream) {
      state.localStream.getTracks().forEach(t => {
        try {
          t.enabled = false;
          t.stop();
        } catch (e) {}
      });
      state.localStream = null;
    }
    if (state.audioContext) {
      try { state.audioContext.close(); } catch (e) {}
      state.audioContext = null;
      state.analyser = null;
    }
    broadcastSpeakingStatus(false, 0);
  }

  function toggleUserMic() {
    if (state.userSeatIndex === null) {
      showToast('يجب أن تصعد إلى مقعد المايك أولاً للتحدث! 🎙️');
      return;
    }

    const currentSeat = (state.activeRoom?.seats || []).find(s => s.seat_index === state.userSeatIndex);
    const isRoomAdmin = state.currentUser && state.activeRoom && (state.activeRoom.host_id === state.currentUser.id || isPlatformStaff(state.currentUser));
    if (state.isMuted && currentSeat && currentSeat.is_muted && !isRoomAdmin) {
      showToast('⚠️ لقد تم كتم المايك الخاص بك من قِبل إدارة الروم، لا يمكنك التحدث!');
      return;
    }

    state.isMuted = !state.isMuted;
    if (!state.isMuted) {
      startLocalMicCapture();
      if (window.soulRtc && state.activeRoom) {
        if (!window.soulRtc.isBroadcastingVoice) {
          window.soulRtc.startBroadcastingVoice(state.activeRoom.id);
        }
        window.soulRtc.setVoiceMuted(false);
      }
    } else {
      stopLocalMicCapture();
      if (window.soulRtc) {
        window.soulRtc.setVoiceMuted(true);
      }
    }

    state.socket.emit('toggle_mute', {
      roomId: state.activeRoom.id,
      seatIndex: state.userSeatIndex,
      isMuted: state.isMuted
    });
    updateMicButtonUI();

    if (state.userSeatIndex !== null && state.userSeatIndex !== undefined) {
      updateSeatMuteUI(state.userSeatIndex, state.isMuted);
    }

    showToast(state.isMuted ? 'تم كتم المايكروفون 🔇' : 'المايكروفون مفعل الآن والصوت يتدفق لجميع الحضور عبر WebRTC 🎙️✨');
  }

  function updateMicButtonUI() {
    const btn = document.getElementById('room-mic-toggle-btn');
    const isSittingOnMic = state.userSeatIndex !== null && state.userSeatIndex !== undefined;
    if (btn) {
      btn.style.display = isSittingOnMic ? 'flex' : 'none';
      const active = isSittingOnMic && !state.isMuted;
      btn.className = `room-tool-btn mic-btn ${active ? 'active' : ''}`;
      btn.innerText = active ? '🎙️' : '🔇';
    }
    updateRoomMicEmojiButtonState();
  }

  function leaveActiveVoiceRoom() {
    if (window.soulRtc) {
      window.soulRtc.leaveCurrentRoom();
    }
    if (state.activeRoom) {
      if (state.userSeatIndex !== null && state.currentUser) {
        state.socket.emit('leave_seat', {
          roomId: state.activeRoom.id,
          seatIndex: state.userSeatIndex,
          userId: state.currentUser.id
        });
      }
      state.socket.emit('leave_room', {
        roomId: state.activeRoom.id,
        userId: state.currentUser ? state.currentUser.id : null
      });
    }
    stopLocalMicCapture();
    state.activeRoom = null;
    state.userSeatIndex = null;
    state.isMuted = true;
    state.activeRoomAudience = [];
    state.activeRoomMutedChatUsers = new Set();
    state.isChatMuted = false;
    const modal = document.getElementById('live-voice-room-modal');
    if (modal) modal.remove();
  }

  // Audience & Public Chat Moderation Helpers
  function updateRoomChatInputState() {
    const chatInput = document.getElementById('room-chat-text-input');
    const sendBtn = document.getElementById('room-send-chat-btn');
    if (!chatInput) return;

    if (state.isChatMuted) {
      chatInput.disabled = true;
      chatInput.placeholder = 'تم كتمك من الكتابة في الدردشة العامة من قِبل إدارة الغرفة 🔇';
      if (sendBtn) sendBtn.disabled = true;
    } else {
      chatInput.disabled = false;
      chatInput.placeholder = 'اكتب رسالة في الروم...';
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  function renderRoomAudienceStrip(audience) {
    state.activeRoomAudience = audience || [];
    const container = document.getElementById('room-audience-list');
    const badge = document.getElementById('room-audience-badge');
    const headerCounter = document.getElementById('live-audience-counter');

    const seatedIds = new Set((state.activeRoom?.seats || []).filter(seat => seat.user_id).map(seat => seat.user_id));
    const visitors = state.activeRoomAudience.filter(visitor => !seatedIds.has(visitor.id));
    const totalCount = state.activeRoomAudience.length;
    if (badge) badge.innerText = String(visitors.length);
    if (headerCounter) headerCounter.innerText = totalCount > 0 ? totalCount.toString() : '1';

    const pillEl = document.querySelector('.audience-strip-badge-pill');
    if (pillEl) { pillEl.style.cursor = 'pointer'; pillEl.onclick = () => openRoomPeoplePanel('online'); }
    const peopleBtn = document.getElementById('room-people-btn');
    if (peopleBtn) peopleBtn.onclick = () => openRoomPeoplePanel('members');
    refreshRoomPeopleTotal();

    if (!container) return;

    if (!visitors.length) {
      container.innerHTML = `
        <div class="audience-empty-hint">لا يوجد زوار حالياً 🌟</div>
      `;
      return;
    }

    const hostId = state.activeRoom ? state.activeRoom.host_id : null;

    container.innerHTML = visitors.slice(0, 7).map(v => {
      const isHost = v.id === hostId || v.role === 'owner';
      const isChatMuted = state.activeRoomMutedChatUsers && state.activeRoomMutedChatUsers.has(v.id);
      return `
        <div class="audience-strip-item ${isHost ? 'is-host' : ''}" data-user-id="${v.id}" title="${v.name} (Lv.${v.level || 1})">
          <div class="audience-strip-avatar-box">
            <img src="${v.avatar}" class="${v.avatar_frame ? 'avatar-frame-' + v.avatar_frame : ''}" onerror="this.src='/avatars/avatar-1.png'" />
            ${isHost ? '<span class="audience-host-badge">👑</span>' : ''}
            ${isChatMuted ? '<span class="audience-muted-dot">🔇</span>' : ''}
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.audience-strip-item').forEach(item => {
      item.onclick = () => {
        const uId = item.dataset.userId;
        const visitor = state.activeRoomAudience.find(u => u.id === uId);
        if (visitor) {
          showAudienceMemberModal(visitor);
        }
      };
    });
  }

  // ============================================
  // لوحة أشخاص الغرفة: أونلاين / الأعضاء / المشرفين (+ المطرودون / المكتومون / المعجبون للإدارة)
  // ============================================
  const _rpEsc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let _rpTotalTimer = null;

  async function fetchRoomPeople() {
    const room = state.activeRoom;
    if (!room) return null;
    try {
      const res = await fetch(`/api/rooms/${room.id}/people`, { headers: { 'x-user-id': state.currentUser ? state.currentUser.id : '' } });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  function refreshRoomPeopleTotal() {
    clearTimeout(_rpTotalTimer);
    _rpTotalTimer = setTimeout(async () => {
      const d = await fetchRoomPeople();
      const el = document.getElementById('room-people-total');
      if (d && el) el.innerText = String(d.total_members);
    }, 1200);
  }

  function rpRowHtml(u, data, tab) {
    const isHost = u.id === data.host_id;
    const isMod = (data.moderators || []).some(m => m.id === u.id);
    const badges = [
      isHost ? '<span class="rp-badge rp-owner">OWNER</span>' : '',
      isMod ? '<span class="rp-badge rp-mod">مشرف</span>' : '',
      !isHost && !isMod ? '<span class="rp-badge rp-member">MEMBER</span>' : '',
      (u.wealth_level || 0) > 0 ? `<span class="rp-badge rp-vip">VIP ${u.wealth_level}</span>` : '',
      `<span class="rp-badge rp-lv">Lv.${u.level || 1}</span>`
    ].join('');
    let action = '';
    if (tab === 'bans') action = `<button class="rp-act" data-act="unban">فك الطرد</button>`;
    else if (tab === 'mutes') action = `<button class="rp-act" data-act="unmute">فك الكتم</button>`;
    else if (tab === 'mods' && data.is_owner) action = `<button class="rp-act danger" data-act="remove-mod">إزالة</button>`;
    else if ((tab === 'online' || tab === 'members') && data.is_owner && !isHost && !isMod) action = `<button class="rp-act" data-act="add-mod">＋ مشرف</button>`;
    else if (tab === 'fans' && u.saved_at) action = `<small class="rp-note">❤️ حفظ الغرفة</small>`;
    return `
      <div class="rp-row" data-user-id="${_rpEsc(u.id)}">
        <img class="rp-avatar ${u.avatar_frame ? 'avatar-frame-' + _rpEsc(u.avatar_frame) : ''}" src="${_rpEsc(u.avatar)}" onerror="this.src='/avatars/avatar-1.png'" />
        <div class="rp-info"><div class="rp-name">${_rpEsc(u.name)}</div><div class="rp-badges">${badges}</div></div>
        ${action}
      </div>`;
  }

  async function openRoomPeoplePanel(initialTab) {
    const old = document.getElementById('room-people-panel');
    if (old) old.remove();
    const panel = document.createElement('div');
    panel.id = 'room-people-panel';
    panel.className = 'audience-list-modal';
    panel.innerHTML = '<div class="audience-list-sheet"><div class="audience-list-head"><span>جارٍ التحميل...</span><button type="button" class="audience-list-close">✕</button></div></div>';
    document.body.appendChild(panel);
    panel.onclick = (e) => { if (e.target === panel || e.target.closest('.audience-list-close')) panel.remove(); };

    let activeTab = initialTab || 'online';
    const render = async (reload) => {
      const data = reload || !panel._data ? await fetchRoomPeople() : panel._data;
      if (!data) { panel.querySelector('.audience-list-head span').innerText = 'تعذر التحميل'; return; }
      panel._data = data;
      const totalEl = document.getElementById('room-people-total');
      if (totalEl) totalEl.innerText = String(data.total_members);

      const tabs = [
        { id: 'online', label: 'أونلاين', list: data.online },
        { id: 'members', label: 'الأعضاء', list: data.members },
        { id: 'mods', label: 'المشرفين', list: data.moderators }
      ];
      if (data.can_manage) {
        tabs.push({ id: 'bans', label: 'المطرودون', list: data.bans || [] });
        tabs.push({ id: 'mutes', label: 'المكتومون', list: data.mutes || [] });
      }
      if (data.is_owner) tabs.push({ id: 'fans', label: `المعجبون (${data.fan_count || 0})`, list: data.fans || [] });
      if (!tabs.some(t => t.id === activeTab)) activeTab = 'online';
      const cur = tabs.find(t => t.id === activeTab);

      panel.innerHTML = `
        <div class="audience-list-sheet rp-sheet">
          <div class="audience-list-head"><span>أشخاص الغرفة</span><button type="button" class="audience-list-close">✕</button></div>
          <div class="rp-tabs">${tabs.map(t => `<button type="button" class="rp-tab ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}</div>
          <div class="audience-list-body">
            ${cur.list.length ? cur.list.map(u => rpRowHtml(u, data, cur.id)).join('') : '<div class="audience-empty-hint">لا يوجد أحد هنا حالياً</div>'}
          </div>
        </div>`;
      panel.querySelectorAll('.rp-tab').forEach(btn => { btn.onclick = () => { activeTab = btn.dataset.tab; render(false); }; });
      panel.querySelectorAll('.rp-row').forEach(row => {
        const uid = row.dataset.userId;
        const u = cur.list.find(x => x.id === uid);
        row.onclick = (e) => {
          if (e.target.closest('.rp-act')) return;
          if (u && (cur.id === 'online' || cur.id === 'members')) { panel.remove(); showAudienceMemberModal(u); }
        };
        const act = row.querySelector('.rp-act');
        if (act) act.onclick = async () => {
          const room = state.activeRoom;
          const hdr = { 'Content-Type': 'application/json', 'x-user-id': state.currentUser.id };
          const kind = act.dataset.act;
          try {
            let r;
            if (kind === 'unban' || kind === 'unmute') {
              r = await fetch(`/api/rooms/${room.id}/restrictions/remove`, { method: 'POST', headers: hdr, body: JSON.stringify({ user_id: uid, type: kind === 'unban' ? 'ban' : 'mute' }) });
            } else {
              r = await fetch(`/api/rooms/${room.id}/moderators`, { method: 'POST', headers: hdr, body: JSON.stringify({ user_id: uid, add: kind === 'add-mod' }) });
            }
            const d = await r.json();
            showToast(d.success ? 'تم ✅' : (d.error || 'تعذر التنفيذ'));
            if (d.success) render(true);
          } catch (err) { showToast('تعذر التنفيذ'); }
        };
      });
    };
    await render(true);
  }

  function showAudienceMemberModal(visitor) {
    if (!visitor) return;
    const isRoomAdmin = state.currentUser && (state.activeRoom?.host_id === state.currentUser.id || isPlatformStaff(state.currentUser));
    // غير الإدارة: نفس بطاقة الاسم السفلية (الإدارة تبقى لها نافذة الإشراف)
    if (!isRoomAdmin && document.getElementById('live-voice-room-modal')) { openRoomUserSheet(visitor); return; }
    const isTargetSelf = state.currentUser && state.currentUser.id === visitor.id;
    const isTargetHost = state.activeRoom && state.activeRoom.host_id === visitor.id;
    const isTargetChatMuted = state.activeRoomMutedChatUsers && state.activeRoomMutedChatUsers.has(visitor.id);

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.innerHTML = `
      <div class="seat-admin-modal-box" style="max-width: 340px; text-align: center;">
        <div style="position: relative; width: 72px; height: 72px; margin: 0 auto 10px;">
          <img src="${visitor.avatar}" class="${visitor.avatar_frame ? 'avatar-frame-' + visitor.avatar_frame : ''}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" />
          ${isTargetHost ? '<span style="position: absolute; top: -8px; right: -4px; font-size: 20px;">👑</span>' : ''}
        </div>
        <div style="font-size: 16px; font-weight: 800; color: #fff; margin-bottom: 2px;">${visitor.name}</div>
        <div style="font-size: 11px; color: #fbbf24; margin-bottom: 6px;">${visitor.soul_planet || 'كوكب السول 🪐'} • Lv.${visitor.level || 1}</div>
        <p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 10px; line-height: 1.4;">${visitor.bio || 'مستمع متفاعل في غرفة السول 🎧'}</p>
        <div class="follow-bar-slot" id="audience-visitor-follow-slot"></div>

        <!-- Visitor's Received Gifts Wall ("هداياه") -->
        <div class="user-received-gifts-box" data-user-id="${visitor.id}" id="audience-visitor-gifts-box">
          <div style="font-size: 10px; color: var(--text-muted); padding: 4px;">جارِ تحميل الهدايا... 🎁</div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
          ${!isTargetSelf ? `
            <button class="seat-admin-action-btn" id="btn-audience-send-gift" style="background: linear-gradient(135deg, rgba(236,72,153,0.2), rgba(139,92,246,0.2)); border: 1px solid rgba(236,72,153,0.4);">
              <span>🎁 إرسال هدية فاخرة لهذا الزائر</span>
            </button>
            <button class="seat-admin-action-btn" id="btn-audience-private-chat">
              <span>💬 بدء محادثة خاصة (شات)</span>
            </button>
          ` : ''}

          ${isRoomAdmin && !isTargetSelf && !isTargetHost ? `
            <!-- Room Creator / Admin Powers -->
            <button class="seat-admin-action-btn" id="btn-audience-toggle-chat-mute" style="background: rgba(245,158,11,0.18); border: 1px solid rgba(245,158,11,0.4); color: #fbbf24;">
              <span>${isTargetChatMuted ? '🔊 إلغاء كتم الزائر من الكتابة العامة' : '🔇 كتم الزائر من الكتابة ع العام'}</span>
            </button>
            <button class="seat-admin-action-btn danger" id="btn-audience-kick-room">
              <span>🚪 طرد الزائر من الغرفة نهائياً</span>
            </button>
          ` : ''}

          <button class="seat-admin-action-btn" id="btn-close-audience-modal" style="background: transparent; border: none; color: var(--text-muted); justify-content: center; margin-top: 4px;">إغلاق</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    mountFollowBar(modal.querySelector('#audience-visitor-follow-slot'), visitor);
    const visitorGiftsBox = modal.querySelector('#audience-visitor-gifts-box');
    if (visitorGiftsBox && visitor.id) {
      loadAndRenderUserGiftsSection(visitor.id, visitorGiftsBox, isTargetSelf);
    }

    modal.querySelector('#btn-close-audience-modal').onclick = () => modal.remove();

    if (!isTargetSelf) {
      modal.querySelector('#btn-audience-send-gift').onclick = () => {
        modal.remove();
        openGiftStoreModal(visitor.id, state.activeRoom.id, visitor);
      };
      modal.querySelector('#btn-audience-private-chat').onclick = () => {
        modal.remove();
        leaveActiveVoiceRoom();
        startPrivateChatWithUser(visitor);
      };
    }

    if (isRoomAdmin && !isTargetSelf && !isTargetHost) {
      // Toggle Chat Mute
      modal.querySelector('#btn-audience-toggle-chat-mute').onclick = () => {
        const willMute = !isTargetChatMuted;
        state.socket.emit('admin_mute_user_chat', {
          roomId: state.activeRoom.id,
          targetUserId: visitor.id,
          adminId: state.currentUser.id,
          isMuted: willMute
        });
        if (willMute) {
          state.activeRoomMutedChatUsers.add(visitor.id);
          showToast(`تم كتم ${visitor.name} من الكتابة ع العام! 🔇`);
        } else {
          state.activeRoomMutedChatUsers.delete(visitor.id);
          showToast(`تم إلغاء كتم الكتابة عن ${visitor.name}! 🔊`);
        }
        renderRoomAudienceStrip(state.activeRoomAudience);
        modal.remove();
      };

      // Kick from room
      modal.querySelector('#btn-audience-kick-room').onclick = async () => {
        if (await uiConfirm(`هل أنت متأكد من طرد الزائر [${visitor.name}] من الغرفة نهائياً؟`, { icon: '🚪', danger: true, okText: 'طرد' })) {
          state.socket.emit('admin_kick_user_from_room', {
            roomId: state.activeRoom.id,
            targetUserId: visitor.id,
            adminId: state.currentUser.id
          });
          modal.remove();
        }
      };
    }
  }

  // Room Games Modal: Dice, Wheel, PK Battle
  function showRoomGamesSelectorModal(room) {
    if (!requireAuth()) return;
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'room-games-modal';
    modal.innerHTML = `
      <div class="soul-modal-content">
        <button class="soul-modal-close-btn" id="close-games-btn">✕</button>
        <div class="modal-header-title">🎲 ألعاب ومسابقات الروم الحماسية</div>

        <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px;">
          <!-- Game 1: Lucky Dice -->
          <button class="google-account-option" id="btn-roll-dice" style="padding: 12px;">
            <div style="font-size: 28px;">🎲</div>
            <div>
              <div style="font-size: 13px; font-weight: 700; color: #fff;">رمي النرد التفاعلي (Lucky Dice)</div>
              <div style="font-size: 11px; color: var(--text-secondary);">ارمي النرد بحركة 3D لجميع أعضاء الروم</div>
            </div>
          </button>

          <!-- Game 2: Lucky Wheel -->
          <button class="google-account-option" id="btn-spin-wheel" style="padding: 12px;">
            <div style="font-size: 28px;">🎡</div>
            <div>
              <div style="font-size: 13px; font-weight: 700; color: #fff;">عجلة الحظ والجوائز (Spin Wheel)</div>
              <div style="font-size: 11px; color: var(--text-secondary);">جوائز وتحديات فورية ومكافآت كوينز</div>
            </div>
          </button>

          <!-- Game 3: PK Battle -->
          <button class="google-account-option" id="btn-start-pk" style="padding: 12px;">
            <div style="font-size: 28px;">🔥</div>
            <div>
              <div style="font-size: 13px; font-weight: 700; color: #fff;">تحدي الـ PK الناري (PK Battle)</div>
              <div style="font-size: 11px; color: var(--text-secondary);">معركة دعم نارية بين المضيف والمنافسين</div>
            </div>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-games-btn').onclick = () => modal.remove();

    // Roll Dice
    modal.querySelector('#btn-roll-dice').onclick = () => {
      modal.remove();
      state.socket.emit('roll_dice', { roomId: room.id, user: state.currentUser });
    };

    // Spin Wheel
    modal.querySelector('#btn-spin-wheel').onclick = () => {
      modal.remove();
      state.socket.emit('spin_wheel', { roomId: room.id, user: state.currentUser });
    };

    // Start PK
    modal.querySelector('#btn-start-pk').onclick = () => {
      modal.remove();
      state.socket.emit('start_pk', {
        roomId: room.id,
        hostUser: { name: room.host_name, id: room.host_id },
        challengerUser: { name: state.currentUser.name, id: state.currentUser.id },
        duration: 60
      });
    };
  }

  // 3D Dice Roll Animation Display
  function showDiceRollOverlay(user, value) {
    if (window.soundManager) window.soundManager.playDiceSound();

    const diceIcons = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    const diceIcon = diceIcons[value - 1] || '🎲';

    const overlay = document.createElement('div');
    overlay.className = 'soul-modal-backdrop';
    overlay.style.zIndex = '350';
    overlay.innerHTML = `
      <div class="soul-modal-content" style="text-align: center; max-width: 300px;">
        <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 10px;">
          رمى <strong>${user.name}</strong> النرد 🎲
        </div>
        <div class="dice-animation-container">
          <div class="dice-cube">${diceIcon}</div>
          <div class="dice-result-text">الرقم: ${value} ⭐</div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    setTimeout(() => {
      overlay.remove();
    }, 2800);
  }

  // PK Battle UI
  function showPKBattleUI(pkState) {
    // 1. Voice room PK bar
    const bar = document.getElementById('room-pk-battle-bar');
    if (bar) {
      bar.classList.add('active');
      const hostScoreEl = document.getElementById('pk-host-score');
      const challengerScoreEl = document.getElementById('pk-challenger-score');
      if (hostScoreEl) hostScoreEl.innerText = pkState.hostScore;
      if (challengerScoreEl) challengerScoreEl.innerText = pkState.challengerScore;
    }

    // 2. Live video stream PK bar
    const streamPkBar = document.getElementById('stream-cohost-pk-bar');
    if (streamPkBar) {
      streamPkBar.style.display = 'block';
      const hostScoreEl = document.getElementById('stream-cohost-host-score');
      const guestScoreEl = document.getElementById('stream-cohost-guest-score');
      if (hostScoreEl) hostScoreEl.innerText = pkState.hostScore;
      if (guestScoreEl) guestScoreEl.innerText = pkState.challengerScore;
      const hostLabel = document.getElementById('stream-cohost-host-name');
      const guestLabel = document.getElementById('stream-cohost-name-label');
      if (hostLabel && pkState.host) hostLabel.innerText = pkState.host.name;
      if (guestLabel && pkState.challenger) guestLabel.innerText = pkState.challenger.name;
    }

    // Hide challenge start buttons during active battle
    const startPkBtn = document.getElementById('stream-start-pk-btn');
    if (startPkBtn) startPkBtn.style.display = 'none';
    const cohostPkBtn = document.getElementById('stream-cohost-request-pk-btn');
    if (cohostPkBtn) cohostPkBtn.style.display = 'none';

    // Show host PK round termination buttons
    const isRoomHost = state.currentUser && state.activeRoom && (state.currentUser.id === state.activeRoom.host_id || state.currentUser.role === 'owner');
    const endPkRoundBtn = document.getElementById('stream-end-pk-round-btn');
    if (endPkRoundBtn && isRoomHost) endPkRoundBtn.style.display = 'inline-flex';
    const barEndPkBtn = document.getElementById('stream-bar-end-pk-btn');
    if (barEndPkBtn && isRoomHost) barEndPkBtn.style.display = 'inline-block';

    if (window.soundManager) {
      window.soundManager.playPkStart();
    }
    showToast('🔥 انطلق تحدي الـ PK الحماسي بالاتفاق! الهدايا تحدد الفائز الآن!');
  }

  function updatePKTimerUI(timeLeft, hostScore, challengerScore) {
    const min = Math.floor(timeLeft / 60);
    const sec = timeLeft % 60;
    const timeStr = `0${min}:${sec < 10 ? '0' : ''}${sec}`;

    const timerEl = document.getElementById('pk-countdown-timer');
    if (timerEl) timerEl.innerText = timeStr;

    const streamTimerEl = document.getElementById('stream-pk-timer');
    if (streamTimerEl) streamTimerEl.innerText = `⚔️ ${timeStr}`;
  }

  function updatePKScoreUI(hostScore, challengerScore, user, team, points) {
    // 1. Voice room elements
    const hostScoreEl = document.getElementById('pk-host-score');
    const challengerScoreEl = document.getElementById('pk-challenger-score');
    const fillEl = document.getElementById('pk-progress-fill');

    if (hostScoreEl) hostScoreEl.innerText = hostScore;
    if (challengerScoreEl) challengerScoreEl.innerText = challengerScore;

    const total = hostScore + challengerScore;
    const hostPercent = total > 0 ? (hostScore / total) * 100 : 50;
    if (fillEl) fillEl.style.width = `${hostPercent}%`;

    // 2. Stream split PK elements
    const streamHostScore = document.getElementById('stream-cohost-host-score');
    const streamGuestScore = document.getElementById('stream-cohost-guest-score');
    const streamFill = document.getElementById('stream-cohost-pk-fill');

    if (streamHostScore) streamHostScore.innerText = hostScore;
    if (streamGuestScore) streamGuestScore.innerText = challengerScore;
    if (streamFill) streamFill.style.width = `${hostPercent}%`;

    const teamTitle = team === 'host' ? 'المضيف' : 'المنافس';
    showToast(`⚡ ${user.name} دعم ${teamTitle} بـ +${points} نقطة في التحدي! 🎁🔥`);
  }

  function handlePkRoundEnded(data) {
    const streamPkBar = document.getElementById('stream-cohost-pk-bar');
    if (streamPkBar) streamPkBar.style.display = 'none';

    const roomPkBar = document.getElementById('room-pk-battle-bar');
    if (roomPkBar) roomPkBar.classList.remove('active');

    const endPkRoundBtn = document.getElementById('stream-end-pk-round-btn');
    if (endPkRoundBtn) endPkRoundBtn.style.display = 'none';

    const barEndPkBtn = document.getElementById('stream-bar-end-pk-btn');
    if (barEndPkBtn) barEndPkBtn.style.display = 'none';

    // Restore PK challenge buttons if co-host is still on split screen
    if (state.activeCohostUser) {
      const isHost = state.currentUser && state.activeRoom && (state.currentUser.id === state.activeRoom.host_id || state.currentUser.role === 'owner');
      const startPkBtn = document.getElementById('stream-start-pk-btn');
      if (startPkBtn && isHost) startPkBtn.style.display = 'inline-flex';

      const cohostPkBtn = document.getElementById('stream-cohost-request-pk-btn');
      if (cohostPkBtn && state.currentUser && state.currentUser.id === state.activeCohostUser.id) {
        cohostPkBtn.style.display = 'inline-flex';
      }
    }

    if (data) {
      showPkWinnerCelebrationModal(data);
    }
  }

  function showPkWinnerCelebrationModal(data) {
    if (window.soundManager) {
      window.soundManager.playVictory();
    }

    let winnerName = '';
    let isDraw = data.winner === 'draw';

    if (data.winner === 'host') {
      winnerName = data.host?.name || 'المضيف';
    } else if (data.winner === 'challenger') {
      winnerName = data.challenger?.name || 'المنافس';
    }

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop animate-fade-in';
    modal.id = 'pk-winner-celebration-modal';
    modal.style.zIndex = '9999';

    modal.innerHTML = `
      <div class="soul-modal-content" style="max-width: 440px; text-align: center; padding: 26px 20px; background: linear-gradient(135deg, #1f1035, #120924); border: 2px solid #fbbf24; box-shadow: 0 0 35px rgba(251, 191, 36, 0.45); border-radius: 20px;">
        <button class="soul-modal-close-btn" id="close-pk-winner-btn">✕</button>

        <div style="font-size: 56px; margin-bottom: 4px; animation: pkTrophyPulse 1.2s infinite ease-in-out;">
          ${isDraw ? '🤝' : '🏆'}
        </div>

        <div style="font-size: 22px; font-weight: 900; color: #fbbf24; margin-bottom: 6px; text-shadow: 0 0 12px rgba(251,191,36,0.6);">
          ${isDraw ? 'تعادل حماسي أسطوري!' : `👑 فوز ساحق لـ ${winnerName}! 👑`}
        </div>

        <div style="font-size: 13px; color: #fff; margin-bottom: 16px;">
          انتهت جولة التحدي (PK Battle) عبر دعم وهدايا الجمهور!
        </div>

        <!-- Scores Breakdown -->
        <div style="display: flex; justify-content: center; align-items: center; gap: 16px; margin-bottom: 18px; background: rgba(0,0,0,0.4); padding: 12px; border-radius: 14px;">
          <div style="flex: 1; text-align: center;">
            <div style="font-size: 12px; color: #f87171; font-weight: 800; margin-bottom: 2px;">🔴 ${data.host?.name || 'المضيف'}</div>
            <div style="font-size: 22px; font-weight: 900; color: #fff;">${data.hostScore}</div>
            <div style="font-size: 10px; color: var(--text-muted);">نقطة هدية</div>
          </div>
          <div style="font-size: 18px; font-weight: 900; color: #fbbf24;">VS</div>
          <div style="flex: 1; text-align: center;">
            <div style="font-size: 12px; color: #60a5fa; font-weight: 800; margin-bottom: 2px;">🔵 ${data.challenger?.name || 'المنافس'}</div>
            <div style="font-size: 22px; font-weight: 900; color: #fff;">${data.challengerScore}</div>
            <div style="font-size: 10px; color: var(--text-muted);">نقطة هدية</div>
          </div>
        </div>

        <!-- Loser Penalty / Dare -->
        ${!isDraw ? `
          <div style="background: rgba(239, 68, 68, 0.15); border: 1.5px dashed #ef4444; border-radius: 14px; padding: 12px; margin-bottom: 20px; text-align: right;">
            <div style="font-size: 12px; font-weight: 800; color: #fca5a5; margin-bottom: 4px;">
              🎭 عقاب الخاسر (${data.loser === 'host' ? data.host?.name : data.challenger?.name}):
            </div>
            <div style="font-size: 13px; font-weight: 700; color: #fff; line-height: 1.5;">
              ${data.penalty || 'تنفيذ عقاب التحدي أمام الجمهور!'}
            </div>
          </div>
        ` : ''}

        <div style="display: flex; gap: 10px; justify-content: center;">
          ${(state.currentUser && state.activeRoom && (state.currentUser.id === state.activeRoom.host_id || state.currentUser.role === 'owner')) ? `
            <button class="wallet-btn primary" id="btn-pk-rematch" style="flex: 1; padding: 10px; font-size: 13px;">
              ⚔️ طلب جولة إعادة (Rematch)
            </button>
          ` : ''}
          <button class="wallet-btn secondary" id="btn-pk-close-overlay" style="flex: 1; padding: 10px; font-size: 13px;">
            إغلاق
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-pk-winner-btn').onclick = () => modal.remove();
    modal.querySelector('#btn-pk-close-overlay').onclick = () => modal.remove();

    const rematchBtn = modal.querySelector('#btn-pk-rematch');
    if (rematchBtn) {
      rematchBtn.onclick = () => {
        modal.remove();
        state.socket.emit('request_pk_battle', {
          roomId: state.activeRoom.id,
          fromUser: state.currentUser
        });
        showToast('📨 تم إرسال طلب جولة إعادة (Rematch) إلى الطرف الآخر! بانتظار موافقته...');
      };
    }
  }

  // ============================================
  // TAB 3: DIRECT MESSAGES & VOICE NOTES
  // ============================================
  async function renderChatTab(container) {
    if (!state.currentUser) {
      container.innerHTML = `
        <div class="chat-tab-container" style="text-align: center; padding: 60px 16px;">
          <div style="font-size: 54px; margin-bottom: 14px;">🔒</div>
          <div style="font-size: 18px; font-weight: 800; color: #fff; margin-bottom: 8px;">الدردشة مقفلة للزوار</div>
          <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 24px; line-height: 1.6; max-width: 360px; margin-left: auto; margin-right: auto;">
            يجب تسجيل الدخول وتوثيق حسابك عبر بريد Gmail لتتمكن من رؤية المحادثات الخاصة ومراسلة الأصدقاء والغرف الصوتية.
          </p>
          <button class="google-official-primary-btn" id="btn-chat-guest-login" style="max-width: 290px; margin: 0 auto; box-shadow: 0 4px 20px rgba(66, 133, 244, 0.4);">
            <svg class="google-g-icon" viewBox="0 0 24 24" style="width: 20px; height: 20px;">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span>دخول بجيميل لفتح الدردشة 🚀</span>
          </button>
        </div>
      `;
      const btn = container.querySelector('#btn-chat-guest-login');
      if (btn) btn.onclick = () => showGoogleLoginModal();
      return;
    }

    state.msgsFilter = 'all';
    state.msgsQuery = '';

    container.innerHTML = `
      <div class="msgs-screen">
        <div class="msgs-head">
          <h1 class="msgs-title">رسائل</h1>
          <div class="msgs-head-actions">
            <button type="button" class="msgs-ic-btn" id="msgs-friends-btn" aria-label="الأصدقاء">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><circle cx="8" cy="7.5" r="3.2"/><circle cx="17" cy="8.5" r="2.6"/><path d="M2.5 19c0-3.3 2.6-5.6 5.5-5.6s5.5 2.3 5.5 5.6a1 1 0 01-1 1H3.5a1 1 0 01-1-1zM14.6 14.3c.7-.3 1.4-.4 2.2-.4 2.4 0 4.7 1.8 4.7 4.6a1 1 0 01-1 1h-4.3c0-2-.6-3.8-1.6-5.2z"/></svg>
            </button>
            <button type="button" class="msgs-ic-btn" id="msgs-search-btn" aria-label="بحث">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>
            </button>
          </div>
        </div>

        <div class="msgs-search-wrap" id="msgs-search-wrap" style="display:none;">
          <input type="text" id="msgs-search-input" class="msgs-search-input" placeholder="ابحث في المحادثات" />
        </div>

        <div class="msgs-pills" id="msgs-pills">
          <button type="button" class="msgs-pill active" data-f="all">الكل</button>
          <button type="button" class="msgs-pill" data-f="friends">الأصدقاء</button>
          <button type="button" class="msgs-pill" data-f="official">الرسمي</button>
        </div>

        <div class="msgs-live-label" id="msgs-live-label" style="display:none;">أشخاص ممن تتابع بالغرف الآن</div>
        <div class="msgs-live" id="msgs-live" style="display:none;"></div>

        <div class="msgs-list" id="conversations-list-container">
          <div class="msgs-more">جارِ التحميل...</div>
        </div>
      </div>
    `;

    container.querySelector('#msgs-friends-btn').onclick = () => openFriendsScreen('friends');
    container.querySelector('#msgs-search-btn').onclick = () => {
      const wrap = container.querySelector('#msgs-search-wrap');
      const input = container.querySelector('#msgs-search-input');
      const show = wrap.style.display === 'none';
      wrap.style.display = show ? 'block' : 'none';
      if (show) { input.focus(); } else { input.value = ''; state.msgsQuery = ''; renderConversationsList(state.conversations || []); }
    };
    container.querySelector('#msgs-search-input').oninput = (e) => {
      state.msgsQuery = e.target.value.trim().toLowerCase();
      renderConversationsList(state.conversations || []);
    };
    container.querySelectorAll('.msgs-pill').forEach(p => {
      p.onclick = () => {
        state.msgsFilter = p.dataset.f;
        container.querySelectorAll('.msgs-pill').forEach(x => x.classList.toggle('active', x === p));
        renderConversationsList(state.conversations || []);
      };
    });

    await loadConversationsList();
  }

  const MSGS_AR = (n) => Number(n || 0).toLocaleString('ar-EG');

  function msgsFmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const hm = d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: false });
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((startOf(new Date()) - startOf(d)) / 86400000);
    if (days <= 0) return hm;
    if (days === 1) return 'أمس ' + hm;
    if (days === 2) return 'أول أمس ' + hm;
    return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'numeric' });
  }

  async function loadConversationsList() {
    if (!state.currentUser) return;
    const uid = state.currentUser.id;
    const getJson = async (url) => {
      try {
        const res = await fetch(url, { headers: followHeaders() });
        return res.ok ? await res.json() : null;
      } catch (err) { return null; }
    };
    try {
      const [convs, notifs, fg, fl, rooms] = await Promise.all([
        getJson('/api/messages/conversations'),
        getJson('/api/notifications'),
        getJson(`/api/users/${encodeURIComponent(uid)}/following`),
        getJson(`/api/users/${encodeURIComponent(uid)}/followers`),
        getJson('/api/rooms')
      ]);
      state.conversations = Array.isArray(convs) ? convs : [];
      const following = (fg && fg.users) || [];
      const followers = (fl && fl.users) || [];
      const followingIds = new Set(following.map(u => u.id));
      const friendIds = new Set(followers.filter(u => followingIds.has(u.id)).map(u => u.id));

      // من تتابعهم ويتواجدون الآن على مقاعد الغرف
      const live = [];
      const seen = new Set();
      (Array.isArray(rooms) ? rooms : []).forEach(r => (r.seats || []).forEach(s => {
        if (s.user_id && followingIds.has(s.user_id) && !seen.has(s.user_id)) {
          seen.add(s.user_id);
          live.push({ id: s.user_id, name: s.name, avatar: s.avatar, room_id: r.id, count: r.total_occupants || r.active_speakers || 1 });
        }
      }));

      state.msgsData = {
        notifs: (notifs && notifs.notifications) || [],
        friendIds, followingIds, live
      };
      renderMsgsLive();
      renderConversationsList(state.conversations);
    } catch (err) {
      console.error('Error fetching conversations:', err);
    }
  }

  function renderMsgsLive() {
    const box = document.getElementById('msgs-live');
    const lbl = document.getElementById('msgs-live-label');
    if (!box || !lbl) return;
    const live = (state.msgsData && state.msgsData.live) || [];
    if (!live.length) { box.style.display = 'none'; lbl.style.display = 'none'; return; }
    lbl.style.display = 'block';
    box.style.display = 'flex';
    box.innerHTML = live.map(u => `
      <div class="msgs-story" data-room-id="${fEsc(u.room_id)}">
        <div class="msgs-story-ring"><img src="${fEsc(u.avatar)}" onerror="this.src='/avatars/avatar-1.png'" /></div>
        <span class="msgs-story-badge">🎙 ${MSGS_AR(u.count)}</span>
        <span class="msgs-story-name">${fEsc(u.name)}</span>
      </div>`).join('');
    box.querySelectorAll('.msgs-story').forEach(el => {
      el.onclick = () => openVoiceRoom(el.dataset.roomId);
    });
  }

  function msgsRowHtml(o) {
    const av = o.icon
      ? `<div class="msgs-av msgs-av-icon" style="background:${o.bg}">${o.icon}</div>`
      : `<div class="msgs-av"><img src="${fEsc(o.avatar)}" class="${o.frame ? 'avatar-frame-' + fEsc(o.frame) : ''}" onerror="this.src='/avatars/avatar-1.png'" />${o.online ? '<span class="msgs-online"></span>' : ''}</div>`;
    return `
      <div class="msgs-row" data-kind="${o.kind}" data-user-id="${fEsc(o.userId || '')}">
        ${av}
        <div class="msgs-mid">
          <div class="msgs-name"><span class="msgs-name-t">${fEsc(o.name)}</span>${o.tag ? `<span class="msgs-tag ${o.tagCls || ''}">${fEsc(o.tag)}</span>` : ''}</div>
          <div class="msgs-sub">${fEsc(o.sub)}</div>
        </div>
        <div class="msgs-time">${fEsc(o.time || '')}</div>
      </div>`;
  }

  function renderConversationsList(list) {
    const container = document.getElementById('conversations-list-container');
    if (!container) return;
    const data = state.msgsData || { notifs: [], friendIds: new Set(), live: [] };
    const filter = state.msgsFilter || 'all';
    const query = state.msgsQuery || '';
    const liveIds = new Set((data.live || []).map(u => u.id));
    const rows = [];

    // 1) تنبيه: آخر إشعار
    const lastNotif = (data.notifs || [])[0];
    if (lastNotif && (filter === 'all' || filter === 'official')) {
      rows.push({
        kind: 'notif', name: 'تنبيه', icon: '🔔', bg: 'rgba(236,72,153,0.22)',
        sub: lastNotif.content || (lastNotif.actor_name ? `${lastNotif.actor_name} قام بمتابعتك` : 'لديك إشعار جديد'),
        time: msgsFmtTime(lastNotif.created_at)
      });
    }

    // 2) المحادثات الخاصة (الأحدث أولاً)
    const sorted = [...list].sort((a, b) => {
      const ta = a.lastMessage ? new Date(a.lastMessage.created_at).getTime() : 0;
      const tb = b.lastMessage ? new Date(b.lastMessage.created_at).getTime() : 0;
      return tb - ta;
    });
    if (filter !== 'official') {
      sorted.forEach(item => {
        const isFriend = data.friendIds && data.friendIds.has(item.user.id);
        if (filter === 'friends' && !isFriend) return;
        const lm = item.lastMessage;
        rows.push({
          kind: 'chat', userId: item.user.id,
          name: item.user.name, avatar: item.user.avatar, frame: item.user.avatar_frame,
          online: liveIds.has(item.user.id),
          tag: isFriend ? 'توأم روح' : '',
          sub: lm ? (lm.message_type === 'voice' ? '🎙️ رسالة صوتية' : (lm.content || '')) : 'بدء محادثة جديدة',
          time: lm ? msgsFmtTime(lm.created_at) : ''
        });
      });
    }

    // 3) الرسائل الرسمية
    if (filter === 'all' || filter === 'official') {
      rows.push({
        kind: 'official', name: 'SoulChill Official', icon: '💜', bg: 'linear-gradient(135deg,#a855f7,#6366f1)',
        tag: 'الرسمي', tagCls: 'msgs-tag-official',
        sub: '[إشعار] مرحباً بك في SoulChill! اربط طريقة تسجيل دخول إضافية لحماية حسابك.',
        time: ''
      });
      rows.push({
        kind: 'later', name: 'يرجى الدردشة لاحقا', icon: '🤍', bg: 'linear-gradient(135deg,#8b5cf6,#6d28d9)',
        sub: 'هناك أصدقاء جدد ينتظرون الدردشة معك', time: ''
      });
    }

    const visible = query ? rows.filter(r => (r.name || '').toLowerCase().includes(query) || String(r.userId || '').toLowerCase().includes(query)) : rows;
    container.innerHTML = visible.map(msgsRowHtml).join('') + '<div class="msgs-more">لا يوجد المزيد</div>';

    container.querySelectorAll('.msgs-row').forEach(row => {
      row.onclick = () => {
        const kind = row.dataset.kind;
        if (kind === 'notif') { openNotificationsSheet(); return; }
        if (kind === 'later') { switchTab('planet'); return; }
        if (kind === 'official') { showToast('💜 رسالة رسمية من فريق SoulChill'); return; }
        const userId = row.dataset.userId;
        let partner = (state.allUsers || []).find(u => u.id === userId);
        if (!partner) {
          const conv = (state.conversations || []).find(c => c.user && c.user.id === userId);
          partner = conv ? conv.user : { id: userId, name: 'مستخدم SoulChill', avatar: '/avatars/avatar-1.png' };
        }
        openDirectChatWithUser(partner);
      };
    });
  }

  // شاشة الأصدقاء / متابعة / المتابعين (زر 👥 أعلى صفحة الرسائل)
  async function openFriendsScreen(initialTab) {
    if (!state.currentUser) { showGoogleLoginModal(); return; }
    const old = document.getElementById('friends-screen');
    if (old) old.remove();
    const host = document.getElementById('main-app-container') || document.body;
    const el = document.createElement('div');
    el.id = 'friends-screen';
    el.className = 'fs-screen';
    el.innerHTML = '<div class="msgs-more" style="margin-top:80px;">جارِ التحميل...</div>';
    host.appendChild(el);

    const uid = state.currentUser.id;
    let tab = initialTab || 'friends';
    let query = '';
    let following = [];
    let followers = [];

    const fetchList = async (mode) => {
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(uid)}/${mode}`, { headers: followHeaders() });
        return res.ok ? ((await res.json()).users || []) : [];
      } catch (e) { return []; }
    };
    [following, followers] = await Promise.all([fetchList('following'), fetchList('followers')]);
    if (!el.isConnected) return;

    const titles = { friends: 'الأصدقاء', following: 'متابعة', followers: 'المتابعين' };
    const compute = () => {
      const fIds = new Set(following.map(u => u.id));
      return { fIds, friends: followers.filter(u => fIds.has(u.id)), following, followers };
    };

    const drawList = () => {
      const L = compute();
      const base = L[tab];
      const rows = base.filter(u => !query || (u.name || '').toLowerCase().includes(query) || String(u.id).toLowerCase().includes(query));
      el.querySelector('.fs-title').innerText = `${titles[tab]} ${MSGS_AR(base.length)}`;
      const body = el.querySelector('.fs-body');
      body.innerHTML = rows.length ? rows.map(u => `
        <div class="fs-row" data-uid="${fEsc(u.id)}">
          <img class="fs-av ${u.avatar_frame ? 'avatar-frame-' + fEsc(u.avatar_frame) : ''}" src="${fEsc(u.avatar)}" onerror="this.src='/avatars/avatar-1.png'" />
          <span class="fs-name">${fEsc(u.name)}</span>
          <button type="button" class="fs-btn ${L.fIds.has(u.id) ? '' : 'fs-btn-follow'}" data-uid="${fEsc(u.id)}">${L.fIds.has(u.id) ? 'إلغاء المتابعة' : 'متابعة'}</button>
        </div>`).join('') : '<div class="msgs-more">لا يوجد المزيد</div>';

      body.querySelectorAll('.fs-row').forEach(row => {
        row.onclick = (e) => {
          if (e.target.closest('.fs-btn')) return;
          const u = base.find(x => x.id === row.dataset.uid);
          if (u) openSoulProfileCard({ id: u.id, name: u.name, avatar: u.avatar, avatar_frame: u.avatar_frame });
        };
      });
      body.querySelectorAll('.fs-btn').forEach(btn => {
        btn.onclick = async () => {
          const id = btn.dataset.uid;
          const isFollowing = compute().fIds.has(id);
          btn.disabled = true;
          const data = await setFollow(id, !isFollowing);
          btn.disabled = false;
          if (!data) return;
          if (isFollowing) {
            following = following.filter(u => u.id !== id);
          } else {
            const u = followers.find(x => x.id === id);
            if (u) following = [u, ...following];
          }
          drawList();
        };
      });
    };

    const drawShell = () => {
      el.innerHTML = `
        <div class="fs-head">
          <button type="button" class="fs-back" id="fs-back" aria-label="رجوع">›</button>
          <span class="fs-title"></span>
          <span class="fs-edit">${tab === 'following' ? '✎' : ''}</span>
        </div>
        <div class="fs-tabs">
          ${['friends', 'following', 'followers'].map(t => `<button type="button" class="fs-tab ${t === tab ? 'active' : ''}" data-t="${t}">${titles[t]}</button>`).join('')}
        </div>
        <div class="fs-search"><input type="text" id="fs-search-input" placeholder="ابحث عن اسم أو ID" value="${fEsc(query)}" /><span>🔍</span></div>
        <div class="fs-body"></div>`;
      el.querySelector('#fs-back').onclick = () => { el.remove(); loadConversationsList(); };
      el.querySelectorAll('.fs-tab').forEach(b => {
        b.onclick = () => { tab = b.dataset.t; query = ''; drawShell(); };
      });
      el.querySelector('#fs-search-input').oninput = (e) => { query = e.target.value.trim().toLowerCase(); drawList(); };
      drawList();
    };
    drawShell();
  }

  // 1-on-1 Direct Chat Window
  async function openDirectChatWithUser(partner) {
    if (!requireAuth()) return;
    state.currentChatPartner = partner;

    // Reset unread count when opening conversation
    state.unreadMessagesCount = 0;
    const navBadge = document.getElementById('nav-chat-unread-badge');
    if (navBadge) {
      navBadge.innerText = '0';
      navBadge.style.display = 'none';
    }
    const inroomDot = document.getElementById('inroom-unread-dot');
    if (inroomDot) inroomDot.style.display = 'none';

    let existing = document.getElementById('direct-chat-window-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'direct-chat-modal';
    modal.id = 'direct-chat-window-modal';
    modal.style.zIndex = '1250';

    const legacyShellHtml = `
      <div class="direct-chat-container">
        ${state.activeRoom ? `
          <div style="background: rgba(139, 92, 246, 0.22); border-bottom: 1px solid rgba(139, 92, 246, 0.4); padding: 6px 14px; font-size: 11px; color: #c084fc; display: flex; align-items: center; justify-content: space-between;">
            <span>🎙️ أنت متصل حالياً بالغرفة الصوتية [${state.activeRoom.title}]</span>
            <span style="color: #10b981; font-weight: 700;">● صوت الروم مستمر بدون انقطاع</span>
          </div>
        ` : ''}

        <!-- Header -->
        <div class="direct-chat-header">
          <div class="direct-chat-partner">
            <button class="header-action-btn" id="close-chat-window-btn" style="width: 28px; height: 28px;">✕</button>
            <img src="${partner.avatar}" class="direct-chat-partner-avatar ${partner.avatar_frame ? 'avatar-frame-' + partner.avatar_frame : ''}" />
            <div class="direct-chat-partner-info">
              <span class="direct-chat-partner-name">${partner.name}</span>
              <span class="direct-chat-partner-planet">${partner.soul_planet || 'كوكب الروح 🪐'}</span>
            </div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            ${['owner', 'super_master', 'super_admin'].includes(state.currentUser && state.currentUser.role) && partner.id !== state.currentUser.id ? '<button class="header-action-btn" id="chat-admin-credit-btn" title="شحن رصيد هذا المستخدم">💳</button>' : ''}
            <button class="header-action-btn" id="chat-send-gift-btn" title="إرسال هدية خاصة">🎁</button>
          </div>
        </div>

        <!-- Messages Stream -->
        <div class="direct-messages-stream" id="direct-chat-stream-box">
          <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 11px;">
            🔒 محادثة خاصة مشفرة. كل ما يقال هنا بين الروحين فقط.
          </div>
        </div>

        <!-- Recording Indicator Strip -->
        <div class="recording-indicator-strip" id="voice-recording-strip">
          <span style="font-size: 16px;">🔴</span>
          <span>جارِ تسجيل الرسالة الصوتية... <strong id="voice-recording-timer">00:00</strong></span>
          <button style="background: none; border: none; color: #fff; cursor: pointer; margin-right: auto;" id="cancel-voice-record-btn">إلغاء ✕</button>
        </div>

        <!-- Chat Input Bar -->
        <div class="direct-chat-input-bar">
          <button class="voice-record-btn" id="mic-record-voice-btn" title="تسجيل رسالة صوتية (اضغط للبدء)">🎙️</button>
          <div class="room-chat-input-wrapper">
            <input type="text" class="room-chat-input" id="direct-msg-input" placeholder="اكتب رسالتك لـ ${partner.name.split(' ')[0]}..." />
            <button class="room-chat-send-btn" id="direct-send-btn">➤</button>
          </div>
        </div>
      </div>
    `;


    modal.innerHTML = (window.SoulDM && window.SoulDM.shellHtml)
      ? window.SoulDM.shellHtml(partner, { activeRoom: state.activeRoom, isStaff: ['owner', 'super_master', 'super_admin'].includes(state.currentUser && state.currentUser.role) && partner.id !== state.currentUser.id })
      : legacyShellHtml;

    document.body.appendChild(modal);

    modal.querySelector('#close-chat-window-btn').onclick = () => {
      modal.remove();
      state.currentChatPartner = null;
    };

    modal.querySelector('#chat-send-gift-btn').onclick = () => {
      openGiftStoreModal(partner.id, null, partner);
    };
    const adminCreditBtn = modal.querySelector('#chat-admin-credit-btn');
    if (adminCreditBtn) adminCreditBtn.onclick = () => showAdminChatCreditModal(partner);

    // Load History
    await loadDirectChatHistory(partner.id);

    // Send Text
    const input = modal.querySelector('#direct-msg-input');
    const sendBtn = modal.querySelector('#direct-send-btn');

    const handleSend = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      await sendPrivateMessage(partner.id, 'text', text);
    };

    sendBtn.onclick = handleSend;
    input.onkeypress = (e) => {
      if (e.key === 'Enter') handleSend();
    };

    // Voice Note Recording Toggle
    const recordBtn = modal.querySelector('#mic-record-voice-btn');
    recordBtn.onclick = () => {
      toggleVoiceNoteRecording();
    };

    const cancelRecordBtn = modal.querySelector('#cancel-voice-record-btn');
    cancelRecordBtn.onclick = () => {
      cancelVoiceNoteRecording();
    };

    // الشكل الجديد للرسائل الخاصة: شريط الأدوات، قفل المتابعة المتبادلة، المكالمات، الإيموجي…
    if (window.SoulDM && window.SoulDM.mount) window.SoulDM.mount(modal, partner);
  }

  async function loadDirectChatHistory(otherUserId) {
    try {
      const res = await fetch(`/api/messages/history/${otherUserId}`, {
        headers: { 'x-user-id': state.currentUser.id }
      });
      const messages = await res.json();
      const stream = document.getElementById('direct-chat-stream-box');
      if (!stream) return;

      messages.forEach(msg => {
        appendDirectChatMessageUI(msg);
      });
    } catch (err) {
      console.error('Error fetching chat history:', err);
    }
  }

  function appendDirectChatMessageUI(msg) {
    const stream = document.getElementById('direct-chat-stream-box');
    if (!stream) return;

    const isSent = msg.sender_id === state.currentUser.id;
    const row = document.createElement('div');
    row.className = `msg-row ${isSent ? 'sent' : 'received'}`;

    let bodyHtml = '';
    if (msg.message_type === 'image' && msg.media_url) {
      bodyHtml = `<img class="dm-msg-image" src="${fEsc(msg.media_url)}" alt="صورة" loading="lazy" />`;
    } else if (msg.message_type === 'voice') {
      bodyHtml = `
        <div class="voice-note-player" data-audio-url="${msg.media_url}">
          <button class="voice-play-btn">▶</button>
          <div class="voice-waveform-preview">
            <div class="waveform-bar" style="height: 14px;"></div>
            <div class="waveform-bar" style="height: 18px;"></div>
            <div class="waveform-bar" style="height: 10px;"></div>
            <div class="waveform-bar" style="height: 16px;"></div>
            <div class="waveform-bar" style="height: 12px;"></div>
          </div>
          <span class="voice-duration">00:04</span>
        </div>
      `;
    } else if (msg.message_type === 'gift') {
      bodyHtml = `<div style="font-weight: 700; color: #fbbf24;">🎁 ${msg.content}</div>`;
    } else {
      bodyHtml = `<div>${fEsc(msg.content)}</div>`;
    }

    const partnerAvatar = !isSent ? (msg.sender_avatar || (state.currentChatPartner && state.currentChatPartner.avatar) || '') : '';
    row.innerHTML = `
      ${!isSent && partnerAvatar ? `<img class="dm-msg-avatar" src="${fEsc(partnerAvatar)}" alt="" />` : ''}
      <div class="msg-bubble${msg.message_type === 'image' ? ' has-image' : ''}">
        ${bodyHtml}
      </div>
    `;
    const imgEl = row.querySelector('.dm-msg-image');
    if (imgEl) imgEl.onclick = () => { if (window.SoulDM && window.SoulDM.viewImage) window.SoulDM.viewImage(imgEl.src); };

    stream.appendChild(row);
    stream.scrollTop = stream.scrollHeight;

    // Attach voice player event if voice note
    const playBtn = row.querySelector('.voice-play-btn');
    if (playBtn) {
      playBtn.onclick = () => {
        const audioUrl = row.querySelector('.voice-note-player').dataset.audioUrl;
        if (audioUrl) {
          const audio = new Audio(audioUrl);
          audio.play();
          playBtn.innerText = '⏸';
          audio.onended = () => { playBtn.innerText = '▶'; };
        } else {
          // Play simulated note chime
          if (window.soundManager) window.soundManager.playGiftSound(false);
          showToast('🎵 تم تشغيل المقطع الصوتي');
        }
      };
    }
  }

  async function sendPrivateMessage(receiverId, messageType, content, mediaUrl = null) {
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': state.currentUser.id
        },
        body: JSON.stringify({
          receiver_id: receiverId,
          message_type: messageType,
          content,
          media_url: mediaUrl
        })
      });

      const msg = await res.json();
      if (!res.ok) {
        if (msg && msg.code === 'MUTUAL_FOLLOW_REQUIRED') {
          showToast('🔒 ' + (msg.error || 'يلزم أن تتابعا بعضكما'));
          window.dispatchEvent(new CustomEvent('soul:follow-changed'));
        } else {
          showToast((msg && msg.error) || 'تعذر إرسال الرسالة');
        }
        return null;
      }
      appendDirectChatMessageUI(msg);
      if (window.soundManager) window.soundManager.playClick();
      return msg;
    } catch (err) {
      console.error('Error sending message:', err);
      return null;
    }
  }

  function handleIncomingPrivateMessage(msg) {
    if (state.currentChatPartner && msg.sender_id === state.currentChatPartner.id) {
      appendDirectChatMessageUI(msg);
      if (window.soundManager) window.soundManager.playGiftSound(false);
      return;
    }

    if (window.soundManager) window.soundManager.playGiftSound(false);

    // Update unread count and show badge ONLY when message actually exists
    state.unreadMessagesCount = (state.unreadMessagesCount || 0) + 1;
    const navBadge = document.getElementById('nav-chat-unread-badge');
    if (navBadge) {
      navBadge.innerText = state.unreadMessagesCount.toString();
      navBadge.style.display = 'inline-flex';
    }

    // If inside voice room, highlight unread dot on messages button
    const dot = document.getElementById('inroom-unread-dot');
    if (dot) dot.style.display = 'block';

    // Show floating reply banner that lets user reply directly without leaving room
    showIncomingMessagePopup(msg);
  }

  function showIncomingMessagePopup(msg) {
    const existing = document.getElementById(`pm-popup-${msg.sender_id}`);
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.className = 'incoming-pm-popup-banner';
    banner.id = `pm-popup-${msg.sender_id}`;
    banner.style.cssText = `
      position: fixed;
      top: 16px;
      left: 16px;
      right: 16px;
      max-width: 420px;
      margin: 0 auto;
      background: rgba(15, 10, 30, 0.95);
      backdrop-filter: blur(12px);
      border: 1.5px solid #8b5cf6;
      border-radius: 14px;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 10px 30px rgba(139, 92, 246, 0.4);
      z-index: 1300;
      animation: slideDownIn 0.3s ease;
      cursor: pointer;
    `;

    banner.innerHTML = `
      <img src="${msg.sender_avatar || '/avatars/avatar-1.png'}" style="width: 42px; height: 42px; border-radius: 50%; border: 1.5px solid #fbbf24; object-fit: cover;" />
      <div style="flex: 1; min-width: 0; text-align: right;">
        <div style="font-size: 13px; font-weight: 800; color: #fbbf24;">💬 رسالة خاصة جديدة من ${msg.sender_name}</div>
        <div style="font-size: 11px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">${msg.content}</div>
      </div>
      <button style="background: var(--primary-gradient); border: none; color: #fff; padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 800; cursor: pointer; white-space: nowrap;" id="btn-reply-pm-${msg.sender_id}">رد 💬</button>
      <button style="background: none; border: none; color: var(--text-muted); font-size: 14px; cursor: pointer; padding: 4px;" id="btn-close-pm-${msg.sender_id}">✕</button>
    `;

    document.body.appendChild(banner);

    banner.querySelector(`#btn-reply-pm-${msg.sender_id}`).onclick = (e) => {
      e.stopPropagation();
      banner.remove();
      openDirectChatWithUser({
        id: msg.sender_id,
        name: msg.sender_name,
        avatar: msg.sender_avatar
      });
    };

    banner.querySelector(`#btn-close-pm-${msg.sender_id}`).onclick = (e) => {
      e.stopPropagation();
      banner.remove();
    };

    banner.onclick = () => {
      banner.remove();
      openDirectChatWithUser({
        id: msg.sender_id,
        name: msg.sender_name,
        avatar: msg.sender_avatar
      });
    };

    setTimeout(() => {
      if (banner.parentNode) {
        banner.style.opacity = '0';
        banner.style.transform = 'translateY(-15px)';
        banner.style.transition = 'all 0.3s ease';
        setTimeout(() => banner.remove(), 300);
      }
    }, 7000);
  }

  // Open In-Room Messages Drawer (Allows browsing conversations & replying without exiting voice room)
  async function openInRoomMessagesDrawer() {
    let existing = document.getElementById('in-room-messages-drawer-modal');
    if (existing) {
      existing.remove();
      return;
    }

    const drawer = document.createElement('div');
    drawer.className = 'soul-modal-backdrop';
    drawer.id = 'in-room-messages-drawer-modal';
    drawer.style.zIndex = '1150';

    drawer.innerHTML = `
      <div class="seat-admin-modal-box" style="max-width: 440px; max-height: 85vh; display: flex; flex-direction: column; padding: 16px; text-align: right;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px;">
          <div style="font-size: 15px; font-weight: 800; color: #fff;">💬 الرسائل الخاصة (وأنت داخل الغرفة)</div>
          <button style="background: none; border: none; color: #fff; font-size: 18px; cursor: pointer;" id="close-inroom-drawer-btn">✕</button>
        </div>

        <div style="font-size: 11px; color: #c084fc; background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 8px; padding: 8px; margin-bottom: 12px;">
          🎧 أنت متصل بالغرفة الصوتية حالياً.. يمكنك الرد والدردشة مع الأصدقاء هنا بحرية دون مغادرة الروم إطلاقاً!
        </div>

        <div id="inroom-conversations-list" style="overflow-y: auto; flex: 1; min-height: 200px; display: flex; flex-direction: column; gap: 8px;">
          <div style="text-align: center; color: var(--text-muted); padding: 20px;">جارِ تحميل المحادثات...</div>
        </div>
      </div>
    `;

    document.body.appendChild(drawer);

    drawer.querySelector('#close-inroom-drawer-btn').onclick = () => drawer.remove();
    drawer.onclick = (e) => {
      if (e.target === drawer) drawer.remove();
    };

    // Load conversations
    try {
      const res = await fetch('/api/messages/conversations', {
        headers: { 'x-user-id': state.currentUser?.id || '' }
      });
      const data = await res.json();
      const convs = Array.isArray(data) ? data : [];
      state.conversations = convs;

      const listContainer = drawer.querySelector('#inroom-conversations-list');
      if (!convs || convs.length === 0) {
        listContainer.innerHTML = `
          <div style="text-align: center; color: var(--text-muted); padding: 24px; font-size: 12px;">
            لا توجد محادثات سابقة بعد. يمكنك بدء محادثة مع أي متواجد في الغرفة عبر النقر على صورته! 🌟
          </div>
        `;
        return;
      }

      listContainer.innerHTML = convs.map(c => {
        const lastMsg = c.lastMessage || c.last_message;
        return `
        <div class="inroom-conv-item" data-user-id="${c.user.id}" style="display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 10px; background: rgba(255,255,255,0.04); cursor: pointer; transition: background 0.2s;">
          <img src="${c.user.avatar}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 1.5px solid var(--primary);" onerror="this.src='/avatars/avatar-1.png'" />
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 13px; font-weight: 700; color: #fff;">${c.user.name}</span>
              <span style="font-size: 10px; color: var(--text-muted);">${formatTime(lastMsg ? lastMsg.created_at : '')}</span>
            </div>
            <div style="font-size: 11px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${lastMsg ? (lastMsg.message_type === 'voice' ? '🎙️ رسالة صوتية' : lastMsg.content) : 'رسالة جديدة'}
            </div>
          </div>
          <button class="inroom-reply-fast-btn" style="background: var(--primary); border: none; color: #fff; padding: 5px 12px; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer;">رد 💬</button>
        </div>
      `;
      }).join('');

      listContainer.querySelectorAll('.inroom-conv-item').forEach(item => {
        item.onclick = () => {
          const uId = item.dataset.userId;
          const conv = state.conversations.find(c => c.user && c.user.id === uId);
          if (conv) {
            drawer.remove();
            openDirectChatWithUser(conv.user);
          }
        };
      });
    } catch (e) {
      console.error('Error loading in-room conversations:', e);
    }
  }

  // Voice Note MediaRecorder implementation
  async function toggleVoiceNoteRecording() {
    if (state.isRecordingVoiceNote) {
      stopAndSendVoiceNote();
    } else {
      startVoiceNoteRecording();
    }
  }

  async function startVoiceNoteRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.mediaRecorder = new MediaRecorder(stream);
      state.recordedAudioChunks = [];

      state.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) state.recordedAudioChunks.push(e.data);
      };

      state.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(state.recordedAudioChunks, { type: 'audio/webm' });
        await uploadAndSendVoiceBlob(audioBlob);
        stream.getTracks().forEach(t => t.stop());
      };

      state.mediaRecorder.start();
      state.isRecordingVoiceNote = true;
      state.recordingSeconds = 0;

      // Update UI
      const recordBtn = document.getElementById('mic-record-voice-btn');
      const strip = document.getElementById('voice-recording-strip');
      const timer = document.getElementById('voice-recording-timer');

      if (recordBtn) recordBtn.classList.add('recording');
      if (strip) strip.classList.add('active');

      state.recordingTimerInterval = setInterval(() => {
        state.recordingSeconds++;
        if (timer) {
          const s = state.recordingSeconds;
          timer.innerText = `00:${s < 10 ? '0' : ''}${s}`;
        }
      }, 1000);

      showToast('🔴 بدأ التسجيل الصوتي.. تحدث الآن ثم اضغط مرة أخرى للإرسال');
    } catch (err) {
      console.warn('Voice recording error or permission denied:', err);
      // Fallback simulated voice note
      sendSimulatedVoiceNote();
    }
  }

  function stopAndSendVoiceNote() {
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      state.mediaRecorder.stop();
    }
    finishRecordingUI();
  }

  function cancelVoiceNoteRecording() {
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      state.mediaRecorder.ondataavailable = null;
      state.mediaRecorder.stop();
    }
    finishRecordingUI();
    showToast('تم إلغاء التسجيل الصوتي');
  }

  function finishRecordingUI() {
    state.isRecordingVoiceNote = false;
    if (state.recordingTimerInterval) {
      clearInterval(state.recordingTimerInterval);
      state.recordingTimerInterval = null;
    }
    const recordBtn = document.getElementById('mic-record-voice-btn');
    const strip = document.getElementById('voice-recording-strip');
    if (recordBtn) recordBtn.classList.remove('recording');
    if (strip) strip.classList.remove('active');
  }

  async function uploadAndSendVoiceBlob(blob) {
    if (!state.currentChatPartner) return;

    const formData = new FormData();
    formData.append('file', blob, 'voice-note.webm');

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success && data.url) {
        await sendPrivateMessage(state.currentChatPartner.id, 'voice', 'رسالة صوتية 🎙️', data.url);
        showToast('تم إرسال الرسالة الصوتية بنجاح! 🎙️✨');
      }
    } catch (err) {
      console.error('Error uploading voice note:', err);
      sendSimulatedVoiceNote();
    }
  }

  async function sendSimulatedVoiceNote() {
    if (!state.currentChatPartner) return;
    finishRecordingUI();
    await sendPrivateMessage(state.currentChatPartner.id, 'voice', 'رسالة صوتية (مباشرة) 🎙️', null);
    showToast('تم إرسال الرسالة الصوتية بنجاح! 🎙️✨');
  }

  // ============================================
  // TAB 4: MOMENTS SOCIAL FEED
  // ============================================
  async function renderMomentsTab(container) {
    container.innerHTML = `
      <div class="moments-tab-container">
        <!-- Moments Feed List -->
        <div id="moments-feed-list">
          <div style="text-align: center; padding: 30px; color: var(--text-muted);">
            جارِ تحميل منشورات مجتمع الروح...
          </div>
        </div>
      </div>
    `;

    state.momentsScope = state.momentsScope || 'all';
    const syncTabs = () => {
      document.querySelectorAll('.mtb-tab').forEach(t => t.classList.toggle('active', t.dataset.scope === state.momentsScope));
    };
    syncTabs();
    document.querySelectorAll('.mtb-tab').forEach(t => {
      t.onclick = () => {
        if (t.dataset.scope === 'friends' && !requireAuth()) return;
        state.momentsScope = t.dataset.scope;
        syncTabs();
        loadMomentsList();
      };
    });

    const addBtn = document.getElementById('moments-top-add-btn');
    if (addBtn) addBtn.onclick = () => {
      if (!requireAuth()) return;
      showMomentRulesDialog(() => showCreateMomentModal());
    };

    await loadMomentsList();
  }

  // نافذة «قواعد رفع المنشورات»: زر العدّ التنازلي 3 ثم 2 ثم 1 ثم «حسناً»
  function showMomentRulesDialog(onAccept) {
    const old = document.getElementById('moment-rules-modal');
    if (old) old.remove();
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'moment-rules-modal';
    modal.innerHTML = `
      <div class="moment-rules-box">
        <div class="moment-rules-title">قواعد رفع المنشورات</div>
        <div class="moment-rules-text">
          عند رفع المنشورات، يرجى الالتزام بالقواعد والتأكد من أن محتوى المنشور متحضر وودود.<br>
          لا يُسمح بأي لغة مسيئة، إعلانات، سلوكيات إباحية أو أي سلوك غير حضاري آخر، يرجى الإبلاغ عن أي مضايقة على الفور.<br>
          قد يتم حظر حسابك إذا خالفت القواعد.
        </div>
        <button type="button" class="moment-rules-btn" id="moment-rules-ok" disabled>3</button>
      </div>`;
    document.body.appendChild(modal);
    const btn = modal.querySelector('#moment-rules-ok');
    let left = 3;
    const timer = setInterval(() => {
      left--;
      if (!modal.isConnected) { clearInterval(timer); return; }
      if (left > 0) { btn.textContent = String(left); }
      else {
        clearInterval(timer);
        btn.textContent = 'حسناً';
        btn.disabled = false;
        btn.classList.add('ready');
      }
    }, 1000);
    modal.onclick = (e) => { if (e.target === modal) { clearInterval(timer); modal.remove(); } };
    btn.onclick = () => {
      if (btn.disabled) return;
      modal.remove();
      if (typeof onAccept === 'function') onAccept();
    };
  }

  async function loadMomentsList() {
    try {
      const scope = state.momentsScope === 'friends' ? '?scope=friends' : '';
      const res = await fetch('/api/moments' + scope, {
        headers: { 'x-user-id': state.currentUser ? state.currentUser.id : '' }
      });
      state.moments = await res.json();
      renderMomentsFeed();
    } catch (err) {
      console.error('Error fetching moments:', err);
    }
  }

  function renderMomentsFeed() {
    const listEl = document.getElementById('moments-feed-list');
    if (!listEl) return;

    if (state.moments.length === 0) {
      listEl.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          ${state.momentsScope === 'friends' ? 'لا توجد منشورات من الأصدقاء بعد.. تابع أشخاصاً لتظهر منشوراتهم هنا 🌟' : 'كن أول من يشارك لحظة في مجتمع SoulChill! 🌟'}
        </div>
      `;
      return;
    }

    listEl.innerHTML = state.moments.map(m => {
      const commentsHtml = (m.comments || []).map(c => `
        <div class="comment-item">
          <span class="comment-author">${c.user_name}:</span>
          <span>${c.content}</span>
        </div>
      `).join('');

      return `
        <div class="moment-card" data-moment-id="${m.id}">
          <div class="moment-card-header">
            <img src="${m.user_avatar}" class="moment-user-avatar ${m.avatar_frame ? 'avatar-frame-' + m.avatar_frame : ''}" />
            <div class="moment-user-info">
              <div class="moment-user-name">${m.user_name}</div>
              <div class="moment-user-planet">${m.soul_planet || 'كوكب الروح 🌌'} • ${formatTime(m.created_at)}</div>
            </div>
            ${isPlatformStaff(state.currentUser) ? `<button type="button" class="moment-delete-btn" data-moment-id="${m.id}" title="حذف المنشور (للمشرفين)">🗑️ حذف</button>` : ''}
          </div>

          ${m.content ? `<div class="moment-content-text">${fEsc(m.content)}</div>` : ''}

          ${m.media_type === 'youtube' && m.video_url ? `
            <div class="moment-yt-box moment-yt-clickable" data-yt-id="${fEsc(m.video_url)}" data-yt-title="${fEsc((m.content||'مقطع يوتيوب').slice(0,60))}" role="button" tabindex="0" aria-label="تشغيل يوتيوب">
              <img src="https://i.ytimg.com/vi/${fEsc(m.video_url)}/hqdefault.jpg" alt="" loading="lazy" onerror="this.style.display='none'" />
              <span class="moment-yt-play"><svg viewBox="0 0 24 24" width="52" height="52"><rect width="24" height="24" rx="12" fill="#FF0000"/><path fill="#fff" d="M10 8.5l6 3.5-6 3.5z"/></svg></span>
              <span class="moment-yt-badge-sm"><svg viewBox="0 0 24 24" width="12" height="12"><rect width="24" height="24" rx="6" fill="#FF0000"/><path fill="#fff" d="M10 8.5l5 3.5-5 3.5z"/></svg> YouTube</span>
              ${state.globalYt && state.globalYt.videoId === m.video_url ? '<span class="moment-yt-now">▶ يعمل الآن</span>' : ''}
            </div>
          ` : (m.media_type === 'video' && m.video_url ? `
            <div class="moment-video-box">
              <video src="${fEsc(m.video_url)}" controls playsinline preload="metadata"></video>
            </div>
          ` : (m.image_url ? `
            <div class="moment-image-box">
              <img src="${fEsc(m.image_url)}" loading="lazy" />
            </div>
          ` : ''))}

          <div class="moment-actions-bar">
            <button class="moment-action-btn like-moment-btn ${m.is_liked ? 'liked' : ''}" data-moment-id="${m.id}">
              <span>${m.is_liked ? '❤️' : '🤍'}</span>
              <span class="likes-counter">${m.likes_count || 0}</span>
            </button>
            <button class="moment-action-btn" style="cursor: default;">
              <span>💬</span>
              <span>${(m.comments || []).length} تعليقات</span>
            </button>
          </div>

          <!-- Comments Section -->
          <div class="moment-comments-section">
            <div class="comments-list-box">${commentsHtml}</div>
            <div class="add-comment-row">
              <input type="text" class="add-comment-input" placeholder="اكتب تعليقاً لطيفاً..." />
              <button class="add-comment-btn" data-moment-id="${m.id}">إرسال</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // تشغيل يوتيوب في المشغّل العائم الثابت (يبقى عند التنقل)
    listEl.querySelectorAll('.moment-yt-clickable').forEach(el => {
      const go = () => {
        const vid = el.dataset.ytId;
        const ttl = el.dataset.ytTitle || 'مقطع يوتيوب';
        if (!vid) return;
        playGlobalYt(vid, ttl, el.closest('.moment-card')?.querySelector('.moment-user-name')?.textContent || '');
      };
      el.onclick = go;
      el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });

    // حذف منشور غير لائق (للمشرفين فقط)
    listEl.querySelectorAll('.moment-delete-btn').forEach(btn => {
      btn.onclick = async () => {
        const momentId = btn.dataset.momentId;
        if (!(await uiConfirm('هل أنت متأكد من حذف هذا المنشور نهائياً؟ سيُحذف مع جميع تعليقاته.', { icon: '🗑️', danger: true, okText: 'حذف' }))) return;
        btn.disabled = true;
        try {
          const res = await fetch(`/api/moments/${encodeURIComponent(momentId)}`, {
            method: 'DELETE',
            headers: { 'x-user-id': state.currentUser.id }
          });
          const data = await res.json();
          if (data.success) {
            state.moments = (state.moments || []).filter(m => m.id !== momentId);
            renderMomentsFeed();
            showToast('تم حذف المنشور 🗑️');
          } else {
            btn.disabled = false;
            showNiceNotice({ type: 'danger', icon: '🚫', title: 'تعذر حذف المنشور', message: data.error || 'حدث خطأ، حاول مرة أخرى' });
          }
        } catch (err) {
          btn.disabled = false;
          showNiceNotice({ type: 'danger', icon: '🚫', title: 'تعذر حذف المنشور', message: 'تعذر الاتصال بالخادم' });
        }
      };
    });

    // Attach like events
    listEl.querySelectorAll('.like-moment-btn').forEach(btn => {
      btn.onclick = async () => {
        const momentId = btn.dataset.momentId;
        try {
          const res = await fetch(`/api/moments/${momentId}/like`, {
            method: 'POST',
            headers: { 'x-user-id': state.currentUser.id }
          });
          const data = await res.json();
          if (data.success) {
            btn.classList.toggle('liked', data.liked);
            const counter = btn.querySelector('.likes-counter');
            let count = parseInt(counter.innerText) || 0;
            counter.innerText = data.liked ? count + 1 : Math.max(0, count - 1);
            btn.querySelector('span').innerText = data.liked ? '❤️' : '🤍';
            if (data.liked && window.soundManager) {
              window.soundManager.playGiftSound(false);
            }
          }
        } catch (err) {
          console.error('Error liking moment:', err);
        }
      };
    });

    // Attach comment events
    listEl.querySelectorAll('.add-comment-btn').forEach(btn => {
      btn.onclick = async () => {
        const momentId = btn.dataset.momentId;
        const row = btn.parentElement;
        const input = row.querySelector('.add-comment-input');
        const text = input.value.trim();
        if (!text) return;

        try {
          const res = await fetch(`/api/moments/${momentId}/comments`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': state.currentUser.id
            },
            body: JSON.stringify({ content: text })
          });
          const data = await res.json();
          if (data.success) {
            input.value = '';
            showToast('تمت إضافة تعليقك! 💬');
          }
        } catch (err) {
          console.error('Error commenting:', err);
        }
      };
    });
  }

  // Create Moment Modal — اختيار نوع المنشور أولاً ثم نموذج مخصص لكل نوع
  async function uploadMomentFile(file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/moments/upload', {
      method: 'POST',
      headers: { 'x-user-id': state.currentUser.id },
      body: fd
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر رفع الملف');
    return data.url;
  }

  function showCreateMomentModal() {
    if (!requireAuth()) return;
    const presetImages = [
      'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=80'
    ];
    const old = document.getElementById('create-moment-modal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'create-moment-modal';
    document.body.appendChild(modal);

    const YT_ICON = '<span class="mc-yt-badge"><svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#FF0000"/><path fill="#fff" d="M10 15.5l6-3.5-6-3.5v7z"/></svg></span>';
    const TYPES = [
      { id: 'text_image', icon: '✍️', title: 'كتابة مع صورة', sub: 'نص مع صورة مرفقة' },
      { id: 'image', icon: '🖼️', title: 'صورة فقط', sub: 'بدون نص' },
      { id: 'video', icon: '🎬', title: 'مقطع فيديو', sub: 'ارفع فيديو من جهازك' },
      { id: 'youtube', icon: YT_ICON, title: 'يوتيوب', sub: 'ابحث واختر مقطعاً' }
    ];

    const close = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) close(); };

    const showChooser = () => {
      modal.innerHTML = `
        <div class="soul-modal-content">
          <button class="soul-modal-close-btn" id="mc-close">✕</button>
          <div class="modal-header-title">✨ ماذا تريد أن تنشر؟</div>
          <div class="mc-type-grid">
            ${TYPES.map(t => `
              <button type="button" class="mc-type-card" data-type="${t.id}">
                <span class="mc-type-icon">${t.icon}</span>
                <span class="mc-type-title">${t.title}</span>
                <span class="mc-type-sub">${t.sub}</span>
              </button>`).join('')}
          </div>
        </div>`;
      modal.querySelector('#mc-close').onclick = close;
      modal.querySelectorAll('.mc-type-card').forEach(c => { c.onclick = () => showForm(c.dataset.type); });
    };

    const showForm = (type) => {
      const meta = TYPES.find(t => t.id === type);
      const needsText = type === 'text_image';
      const captionOptional = type === 'image' || type === 'video' || type === 'youtube';
      let selectedImage = null;   // رابط جاهز أو مرفوع
      let uploadedVideo = null;   // مسار الفيديو المرفوع
      let busy = false;

      let body = '';
      if (needsText || captionOptional) {
        body += `
          <div class="form-group-soul">
            <label>${needsText ? 'ماذا يخطر في بالك؟' : 'تعليق (اختياري)'}</label>
            <textarea id="mc-text" class="form-input-soul" style="min-height:${needsText ? 80 : 56}px;resize:none;" placeholder="${needsText ? 'شارك كلمات ملهمة، أغنية أعجبتك، أو مشاعرك الليلة 🌌' : 'أضف وصفاً قصيراً…'}"></textarea>
          </div>`;
      }
      if (type === 'text_image') {
        body += `
          <div class="form-group-soul">
            <label>اختر صورة أو ارفع صورتك</label>
            <div class="mc-preset-row">
              ${presetImages.map(img => `<img src="${img}" class="moment-preset-thumb" data-url="${img}" />`).join('')}
              <button type="button" class="mc-upload-tile" id="mc-pick">＋<br><small>رفع</small></button>
            </div>
          </div>`;
      }
      if (type === 'image') {
        body += `
          <div class="form-group-soul">
            <button type="button" class="mc-drop" id="mc-pick">🖼️ اضغط لاختيار صورة</button>
          </div>`;
      }
      if (type === 'video') {
        body += `
          <div class="form-group-soul">
            <button type="button" class="mc-drop" id="mc-pick">🎬 اضغط لاختيار مقطع فيديو<br><small>MP4 / WEBM / MOV حتى 50MB</small></button>
          </div>`;
      }
      if (type === 'youtube') {
        body += `
          <div class="form-group-soul">
            <label style="display:flex;align-items:center;gap:6px;"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:#FF0000;"><svg viewBox="0 0 24 24" width="14" height="14"><path fill="#fff" d="M10 8.5l5 3.5-5 3.5z"/></svg></span> ابحث عن مقطع في يوتيوب</label>
            <div class="mc-yt-search">
              <input type="search" id="mc-yt-q" class="form-input-soul" placeholder="مثال: أغنية هادئة، قرآن، رياضة…" autocomplete="off" />
              <button type="button" class="mc-yt-go" id="mc-yt-go" aria-label="بحث">🔍</button>
            </div>
            <div class="mc-yt-results" id="mc-yt-results"></div>
            <div class="mc-yt-direct">
              <div class="mc-yt-or"><span>أو</span></div>
              <label style="font-size:12px;color:var(--text-secondary);margin:6px 0 4px;display:block;">الصق رابط يوتيوب مباشرة (يعمل بدون بحث)</label>
              <div class="mc-yt-search">
                <input type="url" id="mc-yt-url" class="form-input-soul" placeholder="https://www.youtube.com/watch?v=... أو https://youtu.be/..." autocomplete="off" dir="ltr" />
                <button type="button" class="mc-yt-go" id="mc-yt-url-go" aria-label="معاينة" style="background:#FF0000;">▶</button>
              </div>
              <div class="mc-prog" style="font-size:11px;">يدعم: youtube.com/watch, youtu.be, shorts, embed</div>
            </div>
          </div>`;
      }
      body += `<div class="mc-preview" id="mc-preview"></div>`;

      modal.innerHTML = `
        <div class="soul-modal-content">
          <button class="soul-modal-close-btn" id="mc-close">✕</button>
          <div class="mc-form-head"><button type="button" class="mc-back" id="mc-back" aria-label="رجوع">›</button><span class="modal-header-title" style="margin:0;">${meta.icon} ${meta.title}</span></div>
          <div class="custom-google-login-form">
            ${body}
            <button class="soul-submit-btn" id="mc-submit" style="margin-top:10px;">نشر الآن 🚀</button>
          </div>
        </div>
        <input type="file" id="mc-file" style="display:none;" accept="${type === 'video' ? 'video/mp4,video/webm,video/quicktime' : 'image/jpeg,image/png,image/webp,image/gif'}" />`;

      modal.querySelector('#mc-close').onclick = close;
      modal.querySelector('#mc-back').onclick = showChooser;
      const preview = modal.querySelector('#mc-preview');
      const submit = modal.querySelector('#mc-submit');
      const fileInput = modal.querySelector('#mc-file');

      const setPreview = (html) => { preview.innerHTML = html; };

      if (type === 'text_image') {
        selectedImage = presetImages[0];
        const thumbs = modal.querySelectorAll('.moment-preset-thumb');
        const mark = (url) => thumbs.forEach(t => t.classList.toggle('selected', t.dataset.url === url));
        mark(selectedImage);
        thumbs.forEach(t => { t.onclick = () => { selectedImage = t.dataset.url; mark(selectedImage); setPreview(''); }; });
      }

      const pick = modal.querySelector('#mc-pick');
      if (pick) pick.onclick = () => fileInput.click();

      fileInput.onchange = async () => {
        const file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        const isVideoType = type === 'video';
        if (isVideoType && file.size > 50 * 1024 * 1024) { showToast('حجم الفيديو أكبر من 50MB'); return; }
        if (!isVideoType && file.size > 8 * 1024 * 1024) { showToast('حجم الصورة أكبر من 8MB'); return; }
        const localUrl = URL.createObjectURL(file);
        setPreview(isVideoType
          ? `<video src="${localUrl}" controls playsinline preload="metadata"></video><div class="mc-prog">جارِ الرفع…</div>`
          : `<img src="${localUrl}" /><div class="mc-prog">جارِ الرفع…</div>`);
        submit.disabled = true;
        try {
          const url = await uploadMomentFile(file);
          if (isVideoType) uploadedVideo = url; else selectedImage = url;
          const prog = preview.querySelector('.mc-prog');
          if (prog) prog.textContent = '✅ تم الرفع';
          modal.querySelectorAll('.moment-preset-thumb').forEach(t => t.classList.remove('selected'));
        } catch (err) {
          setPreview('');
          if (isVideoType) uploadedVideo = null; else if (type === 'image') selectedImage = null;
          showToast(err.message || 'تعذر رفع الملف');
        }
        submit.disabled = false;
      };

      let ytSelected = null;
      const extractYtIdLocal = (input) => {
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
      };
      if (type === 'youtube') {
        const qInput = modal.querySelector('#mc-yt-q');
        const goBtn = modal.querySelector('#mc-yt-go');
        const resultsBox = modal.querySelector('#mc-yt-results');
        const urlInput = modal.querySelector('#mc-yt-url');
        const urlGoBtn = modal.querySelector('#mc-yt-url-go');
        let lastQuery = '';
        let nextToken = null;
        let loading = false;

        const showSelected = () => {
          if (!ytSelected) { setPreview(''); return; }
          setPreview(`
            <div class="moment-yt-box"><iframe src="https://www.youtube-nocookie.com/embed/${fEsc(ytSelected.id)}" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe></div>
            <div class="mc-prog">✅ المقطع المختار: ${fEsc(ytSelected.title)}</div>`);
        };

        const applyDirectUrl = () => {
          const raw = urlInput ? urlInput.value.trim() : '';
          if (!raw) { showToast('الصق رابط يوتيوب أولاً'); return; }
          const id = extractYtIdLocal(raw);
          if (!id) { showToast('رابط يوتيوب غير صالح'); return; }
          ytSelected = { id, title: 'مقطع يوتيوب مباشر' };
          showSelected();
          showToast('✅ تم اختيار المقطع');
        };
        if (urlGoBtn) urlGoBtn.onclick = applyDirectUrl;
        if (urlInput) urlInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); applyDirectUrl(); } };

        const rowHtml = (v) => `
          <button type="button" class="mc-yt-item ${ytSelected && ytSelected.id === v.id ? 'selected' : ''}" data-id="${fEsc(v.id)}" data-title="${fEsc(v.title)}">
            <img src="${fEsc(v.thumbnail)}" alt="" loading="lazy" />
            <span class="mc-yt-meta"><span class="mc-yt-title">${fEsc(v.title)}</span><span class="mc-yt-channel">${fEsc(v.channel)}</span></span>
            <span class="mc-yt-play"><svg viewBox="0 0 24 24" width="18" height="18" fill="#FF0000"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14l6-4-6-4v8z"/></svg></span>
          </button>`;

        const bindRows = () => {
          resultsBox.querySelectorAll('.mc-yt-item').forEach(el => {
            el.onclick = () => {
              ytSelected = { id: el.dataset.id, title: el.dataset.title };
              resultsBox.querySelectorAll('.mc-yt-item').forEach(x => x.classList.toggle('selected', x === el));
              showSelected();
            };
          });
        };

        const friendlyError = (msg) => {
          if (!msg) return 'تعذر البحث';
          if (/Failed to fetch/i.test(msg) || /NetworkError/i.test(msg)) return 'تعذر الاتصال بالخادم — تأكد من اتصالك ثم أعد المحاولة';
          return msg;
        };

        const search = async (append) => {
          if (loading) return;
          const q = append ? lastQuery : qInput.value.trim();
          if (q.length < 2) { showToast('اكتب كلمة بحث من حرفين على الأقل'); return; }
          loading = true;
          goBtn.disabled = true;
          if (!append) {
            lastQuery = q; nextToken = null;
            resultsBox.innerHTML = '<div class="mc-prog"><span class="mc-spinner"></span> جارِ البحث في يوتيوب…</div>';
          } else {
            const more = resultsBox.querySelector('.mc-yt-more');
            if (more) more.textContent = 'جارِ التحميل…';
          }
          try {
            const params = new URLSearchParams({ q });
            if (append && nextToken) params.set('pageToken', nextToken);
            const res = await fetch('/api/youtube/search?' + params.toString(), { headers: { 'x-user-id': state.currentUser.id } });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
              const msg = friendlyError(data.error || 'تعذر البحث');
              // لو الخدمة غير مفعّلة، اعرض زر لصق الرابط بدلاً من إظهار خطأ فقط
              if (data.code === 'NO_KEY' || /YOUTUBE_API_KEY/.test(msg)) {
                throw new Error(msg + ' — يمكنك لصق الرابط مباشرة في الحقل أدناه');
              }
              throw new Error(msg);
            }
            nextToken = data.nextPageToken || null;
            const more = resultsBox.querySelector('.mc-yt-more');
            if (more) more.remove();
            if (!append) resultsBox.innerHTML = '';
            if (!data.items.length && !append) {
              resultsBox.innerHTML = '<div class="mc-prog">لا توجد نتائج، جرّب كلمات أخرى أو الصق رابطاً مباشراً</div>';
            } else {
              resultsBox.insertAdjacentHTML('beforeend', data.items.map(rowHtml).join(''));
              if (nextToken) resultsBox.insertAdjacentHTML('beforeend', '<button type="button" class="mc-yt-more">تحميل المزيد</button>');
              bindRows();
              const moreBtn = resultsBox.querySelector('.mc-yt-more');
              if (moreBtn) moreBtn.onclick = () => search(true);
            }
          } catch (err) {
            const msg = friendlyError(err.message || 'تعذر البحث');
            if (!append) resultsBox.innerHTML = `<div class="mc-prog yt-error"><span style="color:#f87171;">⚠️ ${fEsc(msg)}</span><br><small style="color:var(--text-secondary)">يمكنك لصق رابط يوتيوب مباشرة في الحقل أدناه</small></div>`;
            else showToast(msg);
            const more = resultsBox.querySelector('.mc-yt-more');
            if (more) more.textContent = 'تحميل المزيد';
          }
          loading = false;
          goBtn.disabled = false;
        };

        goBtn.onclick = () => search(false);
        qInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); search(false); } };
        setTimeout(() => qInput.focus(), 50);
      }

      submit.onclick = async () => {
        if (busy) return;
        const text = (modal.querySelector('#mc-text') || { value: '' }).value.trim();
        const payload = { media_type: type, content: text, tag: 'chill' };

        if (type === 'text_image') {
          if (!text) { showToast('اكتب نص المنشور أولاً'); return; }
          if (!selectedImage) { showToast('اختر صورة'); return; }
          payload.image_url = selectedImage;
        } else if (type === 'image') {
          if (!selectedImage) { showToast('اختر صورة أولاً'); return; }
          payload.image_url = selectedImage;
        } else if (type === 'video') {
          if (!uploadedVideo) { showToast('اختر مقطع فيديو أولاً'); return; }
          payload.video_url = uploadedVideo;
        } else if (type === 'youtube') {
          if (!ytSelected) { showToast('ابحث واختر مقطعاً أو الصق رابط يوتيوب مباشرة'); return; }
          payload.youtube_url = ytSelected.id;
        }

        busy = true; submit.disabled = true;
        try {
          const res = await fetch('/api/moments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-user-id': state.currentUser.id },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (data.success) {
            close();
            showToast('تم نشر لحظتك بنجاح! ✨');
          } else {
            showToast(data.error || 'تعذر النشر');
          }
        } catch (err) {
          console.error('Error creating moment:', err);
          showToast('تعذر الاتصال بالسيرفر');
        }
        busy = false; submit.disabled = false;
      };
    };

    showChooser();
  }

  // ============================================
  // TAB 5: PROFILE — صفحة «أنت» مطابقة للفيديو
  // ============================================
  const PF_CHEV_R = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
  const PF_CHEV_L = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';
  const PF_SEARCH = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>';
  const PF_EDIT = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21h7M14.5 5.5l4 4L9 19l-5 1 1-5z"/><path d="M16 21h4"/></svg>';
  const PF_GEAR = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  const PF_TRI = '<svg viewBox="0 0 10 10" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"><path d="M5 1.6L9 8.4H1z"/></svg>';
  const PF_HEART = (on) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20.5s-8-5-8-10.7A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 2.8c0 5.7-8 10.7-8 10.7z"/></svg>`;

  // أيقونات ملوّنة (ملء بتدرّج) — مرجع التدرّجات في pfSprite()
  const PF_ICONS = {
    gem:    ['pfgB', '<path d="M6.5 3h11L22 9l-10 12L2 9z"/><path d="M2 9h20M9 3L7 9l5 12 5-12-2-6" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="1"/>'],
    lion:   ['pfgG', '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5" fill="#1a1020" fill-opacity=".55"/><circle cx="10" cy="11" r="1" fill="#ffe08a"/><circle cx="14" cy="11" r="1" fill="#ffe08a"/>'],
    crown:  ['pfgT', '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>'],
    empire: ['pfgV', '<path d="M12 2.5l9 6.5v12H3V9z"/><path d="M8.5 21v-6h7v6" fill="#1a1020" fill-opacity=".35"/>'],
    medal:  ['pfgW', '<path d="M12 2l8.5 5v10L12 22l-8.5-5V7z"/><path d="M12 8v8M8 12h8" stroke="#1a1020" stroke-width="2" fill="none" stroke-linecap="round"/>'],
    heart:  ['pfgP', '<path d="M12 21s-8-5.2-8-11a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.8-8 11-8 11z"/>'],
    store:  ['pfgB', '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 10.5h18" stroke="#1a1020" stroke-opacity=".35" stroke-width="2"/>'],
    note:   ['pfgV', '<path d="M5 3h14v12l-6 6H5z"/><path d="M13 21v-6h6" fill="#1a1020" fill-opacity=".3"/>'],
    home:   ['pfgV', '<path d="M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z"/>'],
    shirt:  ['pfgV', '<path d="M8 3l4 2 4-2 5 4-3 4-2-1v11H8V10l-2 1-3-4z"/>'],
    star:   ['pfgV', '<path d="M12 2l3 5.2 6 .1-3 5.2 3 5.2-6 .1L12 23l-3-5.2-6-.1 3-5.2-3-5.2 6-.1z"/>'],
    wallet: ['pfgV', '<path d="M4 6h13l3 3v10H4z"/><path d="M4 6l11-3 2 3" fill="#cdb6ff"/><circle cx="16" cy="14" r="1.5" fill="#1a1020"/>'],
    dot:    ['pfgW', '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="3.2" fill="#0a0a0f"/>'],
    cstar:  ['pfgW', '<circle cx="12" cy="12" r="9.5"/><path d="M12 6.5l1.7 3.5 3.8.5-2.8 2.6.7 3.8-3.4-1.9-3.4 1.9.7-3.8-2.8-2.6 3.8-.5z" fill="#0a0a0f"/>'],
    clock:  ['pfgW', '<circle cx="12" cy="12" r="9.5"/><path d="M12 7v5.5l3.5 2" stroke="#0a0a0f" stroke-width="2" fill="none" stroke-linecap="round"/>'],
    mail:   ['pfgW', '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M3 7l9 6.5L21 7" stroke="#0a0a0f" stroke-width="2" fill="none"/>'],
    people: ['pfgW', '<circle cx="8" cy="8" r="3.2"/><circle cx="16.5" cy="9" r="2.6"/><path d="M2 20c0-3.5 2.7-6 6-6s6 2.5 6 6zM14.5 20c.2-2.6 1.8-4.6 4.2-4.6 2 0 3.3 1.5 3.3 4.6z"/>'],
    help:   ['pfgW', '<circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.5a2.8 2.8 0 1 1 4.2 2.4c-.9.6-1.5 1.1-1.5 2.2" stroke="#0a0a0f" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="12" cy="17" r="1.2" fill="#0a0a0f"/>'],
    shield: ['pfgG', '<path d="M12 2.5l8 3v6c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10v-6z"/>'],
    crystal:['pfgV', '<path d="M12 2l6 6-2 13H8L6 8z"/><path d="M6 8h12M12 2v19" stroke="rgba(255,255,255,.35)" stroke-width="1" fill="none"/>']
  };
  function pfIc(name) {
    const d = PF_ICONS[name];
    if (!d) return '';
    return `<svg viewBox="0 0 24 24" fill="url(#${d[0]})">${d[1]}</svg>`;
  }
  function pfSprite() {
    if (document.getElementById('pf-svg-sprite')) return;
    const d = document.createElement('div');
    d.id = 'pf-svg-sprite';
    d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    const g = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
    d.innerHTML = `<svg width="0" height="0" aria-hidden="true"><defs>
      ${g('pfgV', '#d3b0ff', '#6d3bd6')}${g('pfgB', '#9cc2ff', '#3b5bdb')}${g('pfgG', '#ffe38f', '#d9901a')}
      ${g('pfgP', '#ff9bd0', '#c2307f')}${g('pfgT', '#9af3e4', '#2b9db0')}${g('pfgW', '#ffffff', '#a7adc2')}
    </defs></svg>`;
    document.body.appendChild(d);
  }

  const pfSoon = () => showToast('هذه الميزة قريباً ✨');
  const pfHdr = () => ({ 'Content-Type': 'application/json', 'x-user-id': state.currentUser ? state.currentUser.id : '' });

  function pfCountryName(code) {
    if (!code) return '';
    try { return new Intl.DisplayNames(['ar'], { type: 'region' }).of(String(code).toUpperCase()) || ''; } catch (e) { return ''; }
  }
  function pfDaysSince(createdAt) {
    if (!createdAt) return 1;
    const t = new Date(String(createdAt).includes('T') ? createdAt : String(createdAt).replace(' ', 'T') + 'Z').getTime();
    if (!Number.isFinite(t)) return 1;
    return Math.max(1, Math.floor((Date.now() - t) / 86400000));
  }
  function pfFrameCls(u) { return u && u.avatar_frame ? 'avatar-frame-' + fEsc(u.avatar_frame) : ''; }
  function pfAvatarSrc(u) { return fEsc((u && u.avatar) || '/avatars/avatar-1.png'); }
  function pfGenderPill(u) {
    const g = u.gender === 'female' ? 'female' : (u.gender === 'male' ? 'male' : '');
    if (!g || !u.age) return '';
    return `<span class="pf-pill ${g}">${g === 'female' ? '♀' : '♂'} ${fEsc(u.age)}</span>`;
  }
  function pfBadges(u) {
    return `<div class="pf-pills"><span class="pf-pill lv">${PF_TRI} Lv.${fEsc(u.level || 1)}</span><span class="pf-pill wealth">Lv.${fEsc(u.wealth_level || 1)}</span>${pfGenderPill(u)}</div>`;
  }
  async function pfFetchStats(id) {
    try {
      const r = await fetch(`/api/users/${encodeURIComponent(id)}/profile-stats`, { headers: followHeaders() });
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  }

  // صفحة كاملة تنزلق فوق التطبيق (بدون شريط التبويبات السفلي كما في الفيديو)
  function pfPage({ id, title = '', actionHtml = '', cls = '', body = '', titleAlign = '' }) {
    const host = document.getElementById('main-app-container') || document.body;
    const old = document.getElementById(id);
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = id;
    el.className = `pf-page ${cls}`;
    el.innerHTML = `
      <div class="pf-page-head">
        <button type="button" class="pf-back" aria-label="رجوع">${PF_CHEV_R}</button>
        <div class="pf-page-title" ${titleAlign ? `style="text-align:${titleAlign}"` : ''}>${title}</div>
        <div class="pf-page-action">${actionHtml}</div>
      </div>
      <div class="pf-page-body">${body}</div>`;
    host.appendChild(el);
    el.querySelector('.pf-back').onclick = () => el.remove();
    return el;
  }

  function renderProfileTab(container) {
    const user = state.currentUser;
    if (!user) {
      container.innerHTML = `
        <div class="profile-tab-container" style="text-align: center; padding: 40px 16px;">
          <div style="font-size: 54px; margin-bottom: 12px;">🪐</div>
          <div style="font-size: 18px; font-weight: 800; color: #fff; margin-bottom: 8px;">مرحباً بك في SoulChill</div>
          <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 20px; line-height: 1.5;">
            سجّل الدخول بحساب الجيميل أو Google للوصول إلى محفظتك، ألماساتك، وإطارات الأفاتار الملكية
          </p>
          <button class="soul-submit-btn" id="profile-unauth-login-btn" style="width: 100%; max-width: 300px; padding: 12px; font-size: 14px;">
            تسجيل الدخول عبر Google / Gmail 🚀
          </button>
        </div>
      `;
      const loginBtn = container.querySelector('#profile-unauth-login-btn');
      if (loginBtn) loginBtn.onclick = () => showGoogleLoginModal();
      return;
    }
    pfSprite();

    const roleBadges = {
      owner: ['👑 المالك الأعلى', 'linear-gradient(90deg,#f59e0b,#ef4444)'],
      super_master: ['💎 سوبر ماستر', 'linear-gradient(90deg,#a855f7,#6366f1)'],
      super_admin: ['⚡ سوبر ادمن', 'linear-gradient(90deg,#f59e0b,#ef4444)'],
      admin: ['🛡️ ادمن الدردشة', 'linear-gradient(90deg,#3b82f6,#06b6d4)'],
      moderator: ['🛡️ ادمن الدردشة', 'linear-gradient(90deg,#3b82f6,#06b6d4)']
    };
    const rb = roleBadges[user.role];
    const roleHtml = rb ? `<span class="pf-pill" style="background:${rb[1]};margin-inline-start:6px;vertical-align:middle">${rb[0]}</span>` : '';
    const item = (act, icon, label, extra = '') => `<button type="button" class="pf-item ${extra}" data-pf="${act}"><span class="ic">${PF_ICONS[icon] ? pfIc(icon) : icon}</span><span>${label}</span></button>`;
    const emojiItem = (act, emoji, label) => `<button type="button" class="pf-item" data-pf="${act}"><span class="ic emoji">${emoji}</span><span>${label}</span></button>`;
    const row = (act, icon, label, tail = '', cls = '') => `
      <button type="button" class="pf-menu-row ${cls}" data-pf="${act}">
        <span class="ic">${PF_ICONS[icon] ? pfIc(icon) : icon}</span>
        <span class="tx">${label}</span>${tail}<span class="chev">${PF_CHEV_L}</span>
      </button>`;

    container.innerHTML = `
      <div class="pf-me">
        <div class="pf-me-top">
          <div class="pf-me-title">أنت</div>
          <button type="button" class="pf-gear" data-pf="settings" aria-label="الإعدادات">${PF_GEAR}<i class="pf-dot"></i></button>
        </div>

        <div class="pf-me-id" data-pf="profile">
          <div class="pf-avatar-wrap"><img id="profile-page-avatar" class="${pfFrameCls(user)}" src="${pfAvatarSrc(user)}" onerror="this.src='/avatars/avatar-1.png'" alt="" /></div>
          <div class="pf-me-idtext">
            <div class="pf-me-name">${fEsc(user.name)}${roleHtml}</div>
            <div class="pf-me-uid">UID:${fEsc(user.id)}</div>
            <div class="pf-pills"><span class="pf-pill lv">${PF_TRI} Lv.${fEsc(user.level || 1)}</span><span class="pf-pill wealth">Lv.${fEsc(user.wealth_level || 1)}</span></div>
          </div>
          <span class="pf-me-chev">${PF_CHEV_L}</span>
        </div>

        <div class="pf-stats">
          <button type="button" class="pf-stat" data-pf="friends"><b data-pf-n="friends">0</b><span>الأصدقاء</span></button>
          <button type="button" class="pf-stat" data-pf="following"><b data-pf-n="following">0</b><span>يتابع</span></button>
          <button type="button" class="pf-stat" data-pf="followers"><b data-pf-n="followers">0</b><span>المتابعين</span></button>
          <button type="button" class="pf-stat" data-pf="visitors"><b data-pf-n="visitors">0</b><span>الزوار</span></button>
        </div>

        <div class="pf-wallet-bar" data-pf="wallet">
          <div class="l"><span style="width:26px;height:26px;display:grid;place-items:center">${pfIc('wallet')}</span><span>المحفظة</span></div>
          <div class="r"><span style="width:18px;height:18px;display:grid;place-items:center">${pfIc('crystal')}</span><span id="profile-diamonds-val">${Number(user.diamonds || 0).toLocaleString('en-US')}</span><span style="opacity:.7">${PF_CHEV_L}</span></div>
        </div>

        <div class="pf-card">
          <div class="pf-empire" data-pf="empire">
            <div class="av">🏰</div>
            <div class="tx"><b>الامبراطورية</b><small>انضم إلى إمبراطورية وتكون صداقات</small></div>
            <button type="button" class="pf-join" data-pf="empire">انضمام</button>
          </div>
          <div class="pf-grid">
            ${item('level', 'gem', 'المستوى')}
            ${item('svip', 'lion', 'SVIP', 'big')}
            ${item('aristocracy', 'crown', 'طبقة النبلاء')}
            ${item('empire', 'empire', 'الامبراطورية')}
            ${item('store', 'store', 'المتجر')}
            ${emojiItem('games', '🍕', 'مركز الألعاب')}
            ${item('partners', 'heart', 'شركائي')}
            ${item('medals', 'medal', 'ميدالية')}
          </div>
        </div>

        <div class="pf-card">
          <div class="pf-grid">
            ${item('tasks', 'note', 'المهام')}
            ${item('rooms', 'home', 'غرفتي')}
            ${item('accessories', 'shirt', 'الاكسسوارات')}
            ${item('moments', 'star', 'المنشورات')}
          </div>
        </div>

        <div class="pf-menu">
          ${row('prayer', '🕌', 'الصلاة')}
          ${row('points', 'dot', 'بنك النقاط')}
          ${row('celebs', 'cstar', 'قاعة المشاهير')}
          ${row('calls', 'clock', 'سجل المكالمات الصوتية')}
          ${row('invites', 'mail', 'مركز الدعوات', '<span class="tail">🎁</span>')}
          ${row('activation', 'people', 'مركز التفعيل')}
          ${row('faq', 'help', 'الأسئلة الشائعة والاقتراحات')}
          ${canAccessAdminPanel(user) ? row('admin', 'shield', 'لوحة إدارة الدردشة', '', 'gold') : ''}
        </div>
      </div>`;

    const actions = {
      settings: () => pfOpenSettings(),
      profile: () => pfOpenProfilePage(user),
      level: () => pfOpenLevel(user),
      svip: () => pfOpenSvip(),
      aristocracy: () => pfOpenVip(),
      empire: () => pfOpenEmpire(),
      friends: () => pfOpenRelations('friends', user.id),
      following: () => pfOpenRelations('following', user.id),
      followers: () => pfOpenRelations('followers', user.id),
      visitors: () => pfOpenVisitors('visitors'),
      wallet: () => pfOpenWallet('crystal'),
      store: () => pfOpenStore(),
      games: () => pfOpenGames(),
      partners: () => pfOpenPartners(),
      medals: () => pfOpenMedals(),
      accessories: () => pfOpenAccessories(),
      tasks: () => pfOpenTasks(),
      rooms: () => pfOpenMyRoom(),
      moments: () => pfOpenProfilePage(state.currentUser, 'posts'),
      admin: () => window.open('/admin', '_blank')
    };
    container.querySelectorAll('[data-pf]').forEach(el => {
      el.onclick = (e) => {
        e.stopPropagation();
        (actions[el.dataset.pf] || pfSoon)();
      };
    });

    pfFetchStats(user.id).then(st => {
      if (!st || !container.isConnected) return;
      const set = (k, v) => { const n = container.querySelector(`[data-pf-n="${k}"]`); if (n) n.textContent = String(v || 0); };
      set('friends', st.friends_count);
      set('following', st.following_count);
      set('followers', st.followers_count);
      set('visitors', st.visitors_count);
    });
  }

  // ---------- الأصدقاء / متابعة / المتابعين ----------
  async function pfOpenRelations(initial, ownerId) {
    if (!requireAuth()) return;
    ownerId = ownerId || state.currentUser.id;
    const tabs = [['friends', 'الأصدقاء'], ['following', 'متابعة'], ['followers', 'المتابعين']];
    let active = tabs.some(t => t[0] === initial) ? initial : 'friends';
    const el = pfPage({
      id: 'pf-rel-page',
      body: `<div class="pf-tabs"></div>
             <div class="pf-search">${PF_SEARCH}<input type="text" placeholder="ابحث عن اسم أو ID" /></div>
             <div class="pf-list"></div>`
    });
    const cache = {};
    const input = el.querySelector('.pf-search input');
    const listEl = el.querySelector('.pf-list');
    const load = async (t) => {
      if (cache[t]) return cache[t];
      try {
        const r = await fetch(`/api/users/${encodeURIComponent(ownerId)}/${t}`, { headers: followHeaders() });
        cache[t] = r.ok ? ((await r.json()).users || []) : [];
      } catch (e) { cache[t] = []; }
      return cache[t];
    };
    const render = async () => {
      const list = await load(active);
      if (!el.isConnected) return;
      const label = tabs.find(t => t[0] === active)[1];
      el.querySelector('.pf-page-title').textContent = `${label} ${toArabicNumerals(list.length)}`;
      el.querySelector('.pf-page-action').innerHTML = active === 'friends' ? '' : `<button type="button" class="pf-ico-btn" data-soon>${PF_EDIT}</button>`;
      const soonBtn = el.querySelector('[data-soon]');
      if (soonBtn) soonBtn.onclick = pfSoon;
      el.querySelector('.pf-tabs').innerHTML = tabs.map(t => `<button type="button" class="pf-tab ${t[0] === active ? 'active' : ''}" data-t="${t[0]}">${t[1]}</button>`).join('');
      el.querySelectorAll('.pf-tab').forEach(b => { b.onclick = () => { active = b.dataset.t; input.value = ''; render(); }; });
      const q = (input.value || '').trim().toLowerCase();
      const rows = list.filter(u => !q || String(u.name || '').toLowerCase().includes(q) || String(u.id).toLowerCase().includes(q));
      listEl.innerHTML = rows.length ? rows.map(u => `
        <div class="pf-urow" data-uid="${fEsc(u.id)}">
          <div class="pf-uav"><img class="${pfFrameCls(u)}" src="${pfAvatarSrc(u)}" onerror="this.src='/avatars/avatar-1.png'" alt="" /></div>
          <div class="pf-uinfo"><div class="pf-uname">${fEsc(u.name)}</div></div>
          ${u.is_me ? '' : `<button type="button" class="pf-btn ${u.is_following ? 'ghost' : 'fill'}" data-follow="${fEsc(u.id)}">${u.is_following ? 'إلغاء المتابعة' : 'متابعة'}</button>`}
        </div>`).join('') : '<div class="pf-empty">لا يوجد أحد هنا بعد</div>';
    };
    input.oninput = () => render();
    listEl.onclick = async (e) => {
      const fb = e.target.closest('[data-follow]');
      if (fb) {
        e.stopPropagation();
        const id = fb.dataset.follow;
        const cur = (cache[active] || []).find(x => x.id === id);
        fb.disabled = true;
        const d = await setFollow(id, !(cur && cur.is_following));
        fb.disabled = false;
        if (d) {
          Object.keys(cache).forEach(k => (cache[k] || []).forEach(x => { if (x.id === id) x.is_following = d.is_following; }));
          render();
        }
        return;
      }
      const rowEl = e.target.closest('.pf-urow');
      if (rowEl) {
        const u = (cache[active] || []).find(x => x.id === rowEl.dataset.uid);
        if (u) pfOpenProfilePage(u);
      }
    };
    render();
  }

  // ---------- زائرين صفحتي / زياراتي ----------
  async function pfOpenVisitors(initial) {
    if (!requireAuth()) return;
    const me = state.currentUser;
    const tabs = [['visitors', 'زائرين صفحتي'], ['visits', 'زياراتي']];
    let active = initial === 'visits' ? 'visits' : 'visitors';
    const el = pfPage({ id: 'pf-vis-page', titleAlign: 'right', body: '<div class="pf-list"></div>' });
    const cache = {};
    const listEl = el.querySelector('.pf-list');
    const load = async (t) => {
      if (cache[t]) return cache[t];
      try {
        const r = await fetch(`/api/users/${encodeURIComponent(me.id)}/${t}`, { headers: followHeaders() });
        cache[t] = r.ok ? ((await r.json()).users || []) : [];
      } catch (e) { cache[t] = []; }
      return cache[t];
    };
    const render = async () => {
      const list = await load(active);
      if (!el.isConnected) return;
      el.querySelector('.pf-page-title').innerHTML = `<div class="pf-head-tabs">${tabs.map(t => `<button type="button" class="pf-tab ${t[0] === active ? 'active' : ''}" data-t="${t[0]}">${t[1]}</button>`).join('')}</div>`;
      el.querySelectorAll('.pf-tab').forEach(b => { b.onclick = () => { active = b.dataset.t; render(); }; });
      listEl.innerHTML = list.length ? list.map(u => {
        const cn = pfCountryName(u.country_code);
        return `
        <div class="pf-urow" data-uid="${fEsc(u.id)}">
          <div class="pf-uav"><img class="${pfFrameCls(u)}" src="${pfAvatarSrc(u)}" onerror="this.src='/avatars/avatar-1.png'" alt="" /></div>
          <div class="pf-uinfo">
            <div class="pf-uname">${fEsc(u.name)}</div>
            ${pfBadges(u)}
            ${cn ? `<div class="pf-ufrom">من ${fEsc(cn)}</div>` : ''}
          </div>
          <button type="button" class="pf-heart ${u.is_following ? 'on' : ''}" data-follow="${fEsc(u.id)}" aria-label="متابعة">${PF_HEART(u.is_following)}</button>
        </div>`;
      }).join('') : `<div class="pf-empty">${active === 'visitors' ? 'لا يوجد زوار لصفحتك بعد' : 'لم تزر أي صفحة بعد'}</div>`;
    };
    listEl.onclick = async (e) => {
      const fb = e.target.closest('[data-follow]');
      if (fb) {
        e.stopPropagation();
        const id = fb.dataset.follow;
        const cur = (cache[active] || []).find(x => x.id === id);
        fb.disabled = true;
        const d = await setFollow(id, !(cur && cur.is_following));
        fb.disabled = false;
        if (d) {
          Object.keys(cache).forEach(k => (cache[k] || []).forEach(x => { if (x.id === id) x.is_following = d.is_following; }));
          render();
        }
        return;
      }
      const rowEl = e.target.closest('.pf-urow');
      if (rowEl) {
        const u = (cache[active] || []).find(x => x.id === rowEl.dataset.uid);
        if (u) pfOpenProfilePage(u);
      }
    };
    render();
  }

  // ---------- المحفظة ----------
  function pfOpenWallet(initialTab) {
    if (!requireAuth()) return;
    const tabs = [['crystal', 'الكريستال'], ['gold', 'الذهب'], ['games', 'عملة الالعاب']];
    let active = tabs.some(t => t[0] === initialTab) ? initialTab : 'crystal';
    const icoGift = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M3 9h18v4H3zM4.5 14h15v7h-15zM12 9v12" stroke="#0b0a12" stroke-width="1.5"/><path d="M12 9C9 9 7.5 7.5 8 6s2.5-1 4 3c1.5-4 3.5-4.5 4-3s-1 3-4 3z"/></svg>';
    const icoLog = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M8.5 8h7M8.5 12h7" stroke="#0b0a12" stroke-width="1.6"/></svg>';
    const icoQ = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><circle cx="12" cy="12" r="10"/><path d="M9.3 9.6a2.8 2.8 0 1 1 4.2 2.4c-.9.6-1.5 1.1-1.5 2.2" stroke="#0b0a12" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.2" fill="#0b0a12"/></svg>';
    const el = pfPage({
      id: 'pf-wallet-page', cls: 'pf-wallet', title: 'المحفظة',
      actionHtml: `<button type="button" class="pf-ico-btn" data-soon>${icoGift}</button><button type="button" class="pf-ico-btn" data-soon>${icoLog}</button><button type="button" class="pf-ico-btn" data-soon>${icoQ}</button>`,
      body: '<div class="pf-tabs"></div><div class="pf-wbody"></div>'
    });
    el.querySelectorAll('[data-soon]').forEach(b => b.onclick = pfSoon);
    const bodyEl = el.querySelector('.pf-wbody');
    const fmt = (n) => Number(n || 0).toLocaleString('en-US');
    const crystalPacks = [
      [504, '84+420', 'USD0.99'], [2561, '461+2100', 'USD4.99'], [5162, '962+4200', 'USD9.99'],
      [15526, '2926+12600', 'USD29.99'], [25910, '4310+21600', 'USD49.99']
    ];
    const xchg = [420, 840, 1260, 10000];
    const gem = `<span style="width:20px;height:20px;display:inline-grid;place-items:center">${pfIc('crystal')}</span>`;

    const render = () => {
      const u = state.currentUser;
      el.querySelector('.pf-tabs').innerHTML = tabs.map(t => `<button type="button" class="pf-tab ${t[0] === active ? 'active' : ''}" data-t="${t[0]}">${t[1]}</button>`).join('');
      el.querySelectorAll('.pf-tab').forEach(b => { b.onclick = () => { active = b.dataset.t; render(); }; });
      if (active === 'crystal') {
        const cn = pfCountryName(u.country_code) || 'عالمي';
        bodyEl.innerHTML = `
          <div class="pf-wcard crystal"><div class="lb">كريستالاتي</div><div class="num">${fmt(u.diamonds)}</div><div class="sub">سجل الشحن ‹</div><div class="deco">💎</div></div>
          <div class="pf-promo"><span class="new">NEW</span><div><b>مكافآت الشحنة الأولى</b><span>احصل على 5 حزم شحن</span></div><div class="gift">🎁</div></div>
          <div class="pf-sec-row"><span>طرق الشحن</span><span class="pf-chip">${fEsc(cn)} 🌐</span></div>
          <div class="pf-coupon"><span>0 كوبونات جاهزة للاستخدام</span><small>لم يتم إستخدامها</small></div>
          <div class="pf-pay"><span class="off">off 20%</span><h4>Visa/Master/Amex Cards</h4>
            ${crystalPacks.map(p => `
              <div class="pf-pack">
                ${gem}
                <div class="amt"><b>${p[0]}</b><small>${p[1].split('+')[0]}+${p[1].split('+')[1]} كريستالات مجانية</small></div>
                <button type="button" class="px" data-pack>${p[2]}</button>
              </div>`).join('')}
          </div>
          <div class="pf-agree"><span class="ck">✓</span><span>يرجى القراءة والموافقة على اتفاقية الخدمة و اتفاقية الشراء قبل الشحن</span></div>`;
        bodyEl.querySelectorAll('[data-pack]').forEach(b => b.onclick = () => showTopUpModal());
      } else if (active === 'gold') {
        const gold = Number(u.gold || 0);
        bodyEl.innerHTML = `
          <div class="pf-wcard gold"><div class="lb">ذهبي</div><div class="num">${fmt(gold)}</div><div class="sub">USD ${(gold / 100).toFixed(2)}</div><div class="deco">🪙</div></div>
          <div class="pf-info-list">
            <b>ما هو الذهب؟</b>
            1. الذهب هدية تُستلم من الأصدقاء عند إرسالهم هدايا لك داخل الغرف.<br>
            2. يمكنك تحويل الذهب إلى كريستال.<br>
            3. يمكن تحويل الذهب إلى رصيد حقيقي حسب الشروط المحددة.
          </div>
          <button type="button" class="pf-bigbtn" id="pf-gold-exchange">استبدال بالكريستال</button>`;
        bodyEl.querySelector('#pf-gold-exchange').onclick = () => showToast(gold > 0 ? 'سيتم تفعيل الاستبدال قريباً ✨' : 'لا يوجد ذهب كافٍ للاستبدال');
      } else {
        bodyEl.innerHTML = `
          <div class="pf-wcard games"><div class="lb">عملات الالعاب الخاصة بي</div><div class="num">${fmt(u.coins)}</div><div class="deco">🪙</div></div>
          <div class="pf-sec-row"><span>استبدال</span></div>
          ${xchg.map(c => `
            <div class="pf-xrow">
              <div class="v"><span style="font-size:20px">🪙</span>${fmt(c * 100)}</div>
              <button type="button" class="px" data-xchg="${c}">${gem}${fmt(c)}</button>
            </div>`).join('')}
          <div class="pf-info-list">
            <b>كيف استعمل عملة الألعاب؟</b>
            1. تجربة غرفة الألعاب.<br>
            2. يمكنك شراء الاكسسوارات بعملة الألعاب.
            <b>كيف احصل على عملة الألعاب؟</b>
            1. يمكن للمستخدمين الذين يهدونك إهداء هدايا الحصول على عملات مجانية.<br>
            2. يمكنك استبدال الكريستالات بعملة الألعاب.<br>
            3. يمكنك كسب عملة الألعاب بالفوز في غرفة الألعاب.
          </div>`;
        bodyEl.querySelectorAll('[data-xchg]').forEach(b => {
          b.onclick = async () => {
            const cost = Number(b.dataset.xchg);
            if (Number(state.currentUser.diamonds || 0) < cost) { showToast('رصيد الكريستال غير كافٍ'); return; }
            b.disabled = true;
            try {
              const r = await fetch('/api/wallet/exchange', { method: 'POST', headers: pfHdr(), body: JSON.stringify({ diamonds: cost }) });
              const d = await r.json();
              if (d.success) {
                state.currentUser = d.user;
                localStorage.setItem('soulchill_user', JSON.stringify(d.user));
                updateHeaderUI();
                showToast(`تم استبدال ${fmt(cost)} كريستال بـ ${fmt(cost * 100)} عملة ✅`);
                render();
              } else showToast(d.message || 'تعذر الاستبدال');
            } catch (e) { showToast('تعذر الاتصال بالسيرفر'); }
            b.disabled = false;
          };
        });
      }
    };
    render();
  }

  // ---------- غرفتي: إن كان لدى المستخدم غرفة يدخلها مباشرة، وإلا يظهر إشعار ----------
  let pfMyRoomBusy = false;
  async function pfOpenMyRoom() {
    if (!requireAuth()) return;
    if (pfMyRoomBusy) return;
    pfMyRoomBusy = true;
    try {
      let rooms = null;
      try {
        const res = await fetch('/api/rooms', { cache: 'no-store' });
        if (res.ok) rooms = await res.json();
      } catch (e) { /* نكمل بالقائمة المحفوظة */ }
      if (!Array.isArray(rooms)) rooms = Array.isArray(state.rooms) ? state.rooms : null;
      if (!rooms) { showToast('تعذر الاتصال بالخادم، حاول مرة أخرى'); return; }
      const mine = rooms.find(r => r.host_id === state.currentUser.id);
      if (mine) {
        await openVoiceRoom(mine.id);
      } else {
        showNiceNotice({ type: 'info', icon: '🚪', title: 'غرفتي', message: 'لا يوجد لديك غرفة بعد' });
      }
    } finally {
      pfMyRoomBusy = false;
    }
  }

  // ---------- صفحة الملف الشخصي (التفاصيل) ----------
  async function pfOpenProfilePage(u0, initialTab) {
    if (!u0 || !u0.id) return;
    pfSprite();
    const me = state.currentUser;
    const isSelf = !!(me && me.id === u0.id);
    let u = isSelf ? me : u0;
    if (!isSelf && (!u.created_at || u.gender === undefined)) {
      try {
        const r = await fetch(`/api/users/${encodeURIComponent(u0.id)}`);
        if (r.ok) u = { ...u0, ...(await r.json()) };
      } catch (e) { /* نكمل بالبيانات المتاحة */ }
    }
    if (!isSelf && me) fetch(`/api/users/${encodeURIComponent(u.id)}/visit`, { method: 'POST', headers: followHeaders() }).catch(() => {});

    const pctFields = [u.avatar, u.bio, u.age, u.country_code, u.gender && u.gender !== 'other' ? u.gender : '', u.soul_tags];
    const pct = Math.round(pctFields.filter(Boolean).length / pctFields.length * 100);
    const days = pfDaysSince(u.created_at);
    const flag = flagImg(u.country_code, '🌍');
    const el = pfPage({
      id: 'pf-prof-page', cls: 'pf-prof',
      actionHtml: `${isSelf ? `<span class="pf-topchip">${pct}% ✎</span>` : ''}<span class="pf-topchip" data-soon>CP ♥</span>`,
      body: `
        <div class="pf-prof-av"><img class="${pfFrameCls(u)}" src="${pfAvatarSrc(u)}" onerror="this.src='/avatars/avatar-1.png'" alt="" /></div>
        <div class="pf-prof-name">${isSelf ? '<i>✎</i>' : ''}${fEsc(u.name)}</div>
        <div class="pf-prof-meta"><span class="pf-flag">${flag}</span>${pfGenderPill(u)}<span>${days} يوم</span><span class="uid">UID · ${fEsc(u.id)}</span></div>
        <div class="pf-pills"><span class="pf-pill lv">${PF_TRI} Lv.${fEsc(u.level || 1)}</span><span class="pf-pill wealth">Lv.${fEsc(u.wealth_level || 1)}</span></div>
        <button type="button" class="pf-honor" data-soon>عرض الألقاب الشرفية</button>
        <div class="pf-prof-actions">
          ${isSelf ? '<button type="button" class="pf-sq" data-edit aria-label="تعديل">+</button>' : '<button type="button" class="pf-btn fill" data-follow-main>➕ متابعة</button>'}
          <button type="button" class="pf-voice" data-soon>+ بطاقة الصوت</button>
        </div>
        <div class="pf-prof-body">
          <div class="pf-prof-stats">
            <button type="button" class="pf-stat" data-rel="friends"><b data-n="friends">0</b><span>الأصدقاء</span></button>
            <button type="button" class="pf-stat" data-rel="following"><b data-n="following">0</b><span>يتابع</span></button>
            <button type="button" class="pf-stat" data-rel="followers"><b data-n="followers">0</b><span>المتابعين</span></button>
          </div>
          <div class="pf-tabs"></div>
          <div class="pf-tab-content"></div>
        </div>`
    });
    // مؤثر الدخول المفعّل يظهر لحظة فتح صفحتي (كما في الفيديو)
    if (isSelf && u.entry_effect) {
      fetch('/api/entry-templates', { headers: { 'x-user-id': u.id } }).then(r => r.ok ? r.json() : null).then(d => {
        const tpl = d && (d.templates || []).find(t => t.id === u.entry_effect);
        if (!tpl || !tpl.image_url || !el.isConnected) return;
        const fx = document.createElement('div');
        fx.className = 'pf-prof-fx';
        fx.innerHTML = `<img src="${fEsc(tpl.image_url)}" alt="" />`;
        el.appendChild(fx);
        setTimeout(() => fx.classList.add('out'), 3200);
        setTimeout(() => fx.remove(), 3800);
      }).catch(() => {});
    }
    el.querySelectorAll('[data-soon]').forEach(b => b.onclick = pfSoon);
    const bodyScroll = el.querySelector('.pf-page-body');
    const titleEl = el.querySelector('.pf-page-title');
    bodyScroll.addEventListener('scroll', () => { titleEl.textContent = bodyScroll.scrollTop > 140 ? u.name : ''; });
    const editBtn = el.querySelector('[data-edit]');
    if (editBtn) editBtn.onclick = () => showEditProfileModal();
    el.querySelectorAll('[data-rel]').forEach(b => b.onclick = () => pfOpenRelations(b.dataset.rel, u.id));

    const st = { gifts: null, posts: null, stats: null };
    let activeTab = ['profile', 'rel', 'posts'].includes(initialTab) ? initialTab : 'profile';
    const tabsDef = () => [['profile', 'الملف الشخصي'], ['rel', 'علاقة'], ['posts', `المنشورات${st.posts ? ' · ' + st.posts.length : ''}`]];
    const tabContent = el.querySelector('.pf-tab-content');

    const renderTab = () => {
      el.querySelector('.pf-tabs').innerHTML = tabsDef().map(t => `<button type="button" class="pf-tab ${t[0] === activeTab ? 'active' : ''}" data-t="${t[0]}">${t[1]}</button>`).join('');
      el.querySelectorAll('.pf-tabs .pf-tab').forEach(b => { b.onclick = () => { activeTab = b.dataset.t; renderTab(); }; });
      if (activeTab === 'profile') {
        const gifts = (st.gifts && st.gifts.summary) || [];
        const totalGifts = (st.gifts && st.gifts.totalCount) || 0;
        tabContent.innerHTML = `
          <div class="pf-sect">
            <h5>التوقيع الشخصي</h5>
            <p class="${u.bio ? '' : 'soft'}">${u.bio ? fEsc(u.bio) : 'المستخدم لم يترك أي شيء'}</p>
            <div class="pf-chips">
              ${u.soul_planet ? `<span class="pf-chip">${fEsc(u.soul_planet)}</span>` : ''}
              ${isSelf ? '<button type="button" class="pf-chip" data-crown>+ اضبط التاج</button>' : ''}
            </div>
            <h5>مستواي</h5>
            <div class="pf-levels">
              <div class="pf-lvcard g"><b>Lv.${fEsc(u.wealth_level || 1)}</b><small>الثروة</small></div>
              <div class="pf-lvcard p"><b>Lv.${fEsc(u.charm_level || 1)}</b><small>الكاريزما</small></div>
              <div class="pf-lvcard d"><b>Lv.${fEsc(u.level || 1)}</b><small>المستوى</small></div>
            </div>
            <div class="pf-sechead"><h5>الامبراطورية</h5><div class="pf-subrow" data-soon><span>${isSelf ? 'لم تنضم إلى الامبراطورية' : 'لم ينضم إلى الامبراطورية'}</span>${PF_CHEV_L}</div></div>
            <div class="pf-sechead"><h5>ميداليات</h5><div class="pf-subrow" data-soon><span>ليس متاحا بعد</span>${PF_CHEV_L}</div></div>
            <div class="pf-hscroll">
              ${['ملك اللعبة', 'اللاعب المحترف', 'اللاعب الماسي'].map(n => `<div class="pf-medal"><div class="m">🏆</div>${n}</div>`).join('')}
            </div>
            <div class="pf-sechead"><h5>معرض الهدايا</h5><div class="pf-subrow"><span>${isSelf ? 'ربحت' : 'ربح'} ${toArabicNumerals(totalGifts)}</span>${PF_CHEV_L}</div></div>
            ${gifts.length ? `<div class="pf-hscroll">${gifts.map(g => `<div class="pf-gift"><div class="gi">${giftIconHtml(g.gift_icon)}</div><div>${fEsc(g.gift_name)}</div><small>×${fEsc(g.count)}</small></div>`).join('')}</div>`
                           : '<p class="soft">لا توجد هدايا بعد</p>'}
            ${u.entry_effect ? `<h5>مؤثرات دخول</h5><div class="pf-hscroll"><div class="pf-gift"><div class="gi">✨</div><div>${fEsc(u.entry_effect)}</div></div></div>` : ''}
          </div>`;
        const crown = tabContent.querySelector('[data-crown]');
        if (crown) crown.onclick = () => pfOpenStore();
        tabContent.querySelectorAll('[data-soon]').forEach(b => b.onclick = pfSoon);
      } else if (activeTab === 'rel') {
        const s = st.stats || {};
        tabContent.innerHTML = `
          <div class="pf-sect">
            <div class="pf-rel-row" data-rel2="friends">الأصدقاء<span>${toArabicNumerals(s.friends_count || 0)} ${PF_CHEV_L}</span></div>
            <div class="pf-rel-row" data-rel2="following">متابعة<span>${toArabicNumerals(s.following_count || 0)} ${PF_CHEV_L}</span></div>
            <div class="pf-rel-row" data-rel2="followers">المتابعين<span>${toArabicNumerals(s.followers_count || 0)} ${PF_CHEV_L}</span></div>
          </div>`;
        tabContent.querySelectorAll('[data-rel2]').forEach(b => b.onclick = () => pfOpenRelations(b.dataset.rel2, u.id));
      } else {
        if (!st.posts) { tabContent.innerHTML = '<div class="pf-empty">جارٍ التحميل…</div>'; return; }
        tabContent.innerHTML = `<div class="pf-sect">${st.posts.length ? st.posts.map(m => `
          <div class="pf-post2">
            <div class="pf-post2-date">${fEsc(String(m.created_at || '').slice(0, 16).replace('T', ' '))}</div>
            <div class="pf-post2-txt">${fEsc(m.content)}</div>
            ${m.image_url ? `<img src="${fEsc(m.image_url)}" alt="" loading="lazy" onerror="this.remove()" />` : ''}
            <div class="pf-post2-act">
              <span class="more">⋮</span>
              <span class="n"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>0</span>
              <span class="n"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 01-11.5 7.2L3 21l1.8-6A8 8 0 1121 12z" stroke-linejoin="round"/></svg>${(m.comments || []).length}</span>
              <span class="n"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-8-5.2-8-11a4.6 4.6 0 018-3 4.6 4.6 0 018 3c0 5.8-8 11-8 11z" stroke-linejoin="round"/></svg>${m.likes_count || 0}</span>
            </div>
          </div>`).join('')
          : '<div class="pf-empty">لا توجد منشورات بعد</div>'}</div>`;
      }
    };
    renderTab();

    // زر المتابعة للزوار
    const fBtn = el.querySelector('[data-follow-main]');
    if (fBtn) {
      fBtn.onclick = async () => {
        const now = fBtn.dataset.following === '1';
        fBtn.disabled = true;
        const d = await setFollow(u.id, !now);
        fBtn.disabled = false;
        if (d) {
          fBtn.dataset.following = d.is_following ? '1' : '0';
          fBtn.textContent = d.is_following ? '✓ تتابعه' : '➕ متابعة';
          fBtn.className = `pf-btn ${d.is_following ? 'ghost' : 'fill'}`;
        }
      };
      fetchFollowStats(u.id).then(s => {
        if (!s || !fBtn.isConnected) return;
        fBtn.dataset.following = s.is_following ? '1' : '0';
        fBtn.textContent = followBtnLabel(s.is_following, s.follows_me);
        fBtn.className = `pf-btn ${s.is_following ? 'ghost' : 'fill'}`;
      });
    }

    // بيانات غير متزامنة
    pfFetchStats(u.id).then(s => {
      if (!s || !el.isConnected) return;
      st.stats = s;
      ['friends', 'following', 'followers'].forEach(k => { const n = el.querySelector(`[data-n="${k}"]`); if (n) n.textContent = String(s[k + '_count'] || 0); });
      if (activeTab === 'rel') renderTab();
    });
    fetch(`/api/users/${encodeURIComponent(u.id)}/gifts`).then(r => r.ok ? r.json() : null).then(d => {
      if (!el.isConnected) return;
      st.gifts = d || { summary: [], totalCount: 0 };
      if (activeTab === 'profile') renderTab();
    }).catch(() => { st.gifts = { summary: [], totalCount: 0 }; });
    fetch('/api/moments', { headers: followHeaders() }).then(r => r.ok ? r.json() : []).then(list => {
      if (!el.isConnected) return;
      st.posts = (Array.isArray(list) ? list : []).filter(m => m.user_id === u.id);
      renderTab();
    }).catch(() => { st.posts = []; renderTab(); });
  }

  // ---------- الإعدادات (الترس) ----------
  function pfOpenSettings() {
    const user = state.currentUser;
    if (!user) return;
    pfSprite();
    const row = (id, icon, label, cls = '') => `
      <button type="button" class="pf-menu-row ${cls}" id="${id}">
        <span class="ic">${icon}</span><span class="tx">${label}</span><span class="chev">${PF_CHEV_L}</span>
      </button>`;
    const el = pfPage({
      id: 'pf-settings-page', title: 'الإعدادات',
      body: `
        ${user.role === 'owner' ? `
          <div class="pf-owner-box">
            <h4>👑 لوحة تحكم مالك التطبيق (Super Admin)</h4>
            <p>بصفتك مالك الموقع، لديك صلاحية الإدارة والتحكم في كل الرومات، وبث إعلانات عامة لجميع المستخدمين.</p>
            <div class="btns">
              <button type="button" class="pf-btn fill" id="pf-owner-broadcast" style="padding:11px">📢 إرسال إعلان عام للجميع</button>
              <button type="button" class="pf-btn ghost" id="pf-owner-boost" style="padding:11px;color:#fbbf24;border-color:#fbbf24">⚡ شحن إمبراطوري (+100k)</button>
            </div>
          </div>` : ''}
        <div class="pf-settings-group">
          ${row('pf-set-avatar', '🖼️', 'تغيير صورتي الشخصية')}
          ${row('pf-set-edit', '✏️', 'تعديل الملف الشخصي والبيو')}
          ${row('pf-set-checkin', '🎁', 'مكافأة الحضور اليومي')}
          ${row('pf-set-soul', '🪐', 'إعادة اختبار كوكب الروح')}
        </div>
        <div class="pf-settings-group">
          ${row('pf-set-switch', '🔄', 'تبديل الحساب أو الدخول بحساب آخر')}
          ${row('pf-set-logout', '🚪', 'تسجيل الخروج من الحساب الحالي', 'gold')}
        </div>`
    });
    const on = (id, fn) => { const b = el.querySelector('#' + id); if (b) b.onclick = fn; };
    on('pf-set-avatar', () => showChangeAvatarModal());
    on('pf-set-edit', () => showEditProfileModal());
    on('pf-set-checkin', () => handleDailyCheckIn());
    on('pf-set-soul', () => showSoulTestModal());
    on('pf-set-switch', () => showGoogleLoginModal());
    on('pf-set-logout', () => { el.remove(); handleSignOut(); });
    on('pf-owner-broadcast', async () => {
      const msg = await uiPrompt('اكتب رسالة الإعلان العام ليتم بثها فوراً على كل شاشات الرومات والبثوث', { icon: '📢', title: 'إعلان عام', type: 'textarea', okText: 'بث الآن' });
      if (msg && msg.trim()) {
        state.socket.emit('global_owner_announcement', { ownerId: user.id, message: msg.trim() });
        showToast('تم إرسال الإعلان العام لجميع الرومات! 📢⚡');
      }
    });
    on('pf-owner-boost', async () => {
      try {
        const res = await fetch('/api/wallet/recharge', { method: 'POST', headers: pfHdr(), body: JSON.stringify({ coins: 100000, diamonds: 50000 }) });
        const data = await res.json();
        if (data.success) {
          state.currentUser = data.user;
          localStorage.setItem('soulchill_user', JSON.stringify(data.user));
          updateHeaderUI();
          const area = document.getElementById('app-main-content');
          if (area && state.currentTab === 'profile') renderProfileTab(area);
          showToast('تم شحن 100,000 عملة و 50,000 ألماسة للمالك! 💎👑');
        }
      } catch (e) {}
    });
  }

  // ======================================================================
  // الاكسسوارات (الصف الثالث) — بنفس تصميم الفيديو: تبويبات أفقية + بطاقات بتاريخ
  // ======================================================================
  // إطارات الإدارة (للمتجر والاكسسوارات): تُجلب مع حالة الملكية ثم تُحدَّث في محرك الرسم
  async function pfLoadCustomFrames() {
    try {
      const r = await fetch('/api/avatar-frames', { headers: state.currentUser ? { 'x-user-id': state.currentUser.id } : {} });
      const d = await r.json();
      if (window.SCFrames) window.SCFrames.reload();
      return { frames: d.frames || [] };
    } catch (e) { return { frames: [] }; }
  }

  const PF_AC_TABS = [
    ['badge', 'شارة'], ['frames', 'إطارات'], ['entry', 'مؤثرات الدخول'], ['relation', 'إكسسوار العلاقة'],
    ['family', 'محكمة الأسرة'], ['mic', 'مقاعد المايك'], ['bubble', 'فقاعة الدردشة'], ['highlight', 'تعليق بارز'],
    ['idcard', 'بطاقة التعريف'], ['rooms', 'بطاقات الغرف']
  ];
  const PF_AC_CLOCK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 5v5.2l3.6 2.1-.8 1.4L11 13V7h2z"/></svg>';
  const PF_AC_CHECK = '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="11" fill="#fff"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#111" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const PF_AC_EMPTY = '<svg viewBox="0 0 200 130" width="200" height="130" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="60" cy="34" r="12"/><path d="M60 8v8M60 52v8M34 34h8M78 34h8M42 16l6 6M72 46l6 6M78 16l-6 6M42 52l6-6"/><path d="M10 112h180"/><path d="M40 112c14-18 30-30 52-30 10 0 14-8 14-16 0-8 4-12 10-12 4 0 6 4 6 8l-4 10c-2 6 0 10 8 14l22 26"/><path d="M92 82c6 10 6 20 0 30M128 84v28M146 100v12"/></svg>';

  async function loadRoomCardsMine() {
    try {
      const r = await fetch('/api/room-cards', { headers: { 'x-user-id': state.currentUser.id } });
      const d = await r.json();
      return { cards: (d.cards || []).filter(c => c.owned), equipped: d.equipped || '' };
    } catch (e) { return { cards: [], equipped: '' }; }
  }

  function pfOpenAccessories(initialTab) {
    if (!requireAuth()) return;
    pfSprite();
    let active = PF_AC_TABS.some(t => t[0] === initialTab) ? initialTab : 'badge';
    let entry = null; // { templates, equipped }
    const el = pfPage({
      id: 'pf-acc-page', cls: 'pf-ac', title: 'الاكسسوارات',
      actionHtml: '<button type="button" class="pf-ico-btn pf-ac-help" aria-label="مساعدة"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.2 9.3a2.9 2.9 0 115 1.9c-.8.8-2.1 1.3-2.1 2.8M12 17.2h.01" stroke-linecap="round" stroke-linejoin="round"/></svg></button>',
      body: '<div class="pf-ac-tabs"></div><div class="pf-ac-grid"></div>'
    });
    el.querySelector('.pf-ac-help').onclick = () => showNiceNotice({ type: 'info', icon: '👕', title: 'الاكسسوارات', message: 'هنا كل ما تملكه من اكسسوارات. اضغط على أي عنصر لتفعيله، واضغط عليه مرة أخرى لإلغاء تفعيله.' });
    const tabsEl = el.querySelector('.pf-ac-tabs');
    const grid = el.querySelector('.pf-ac-grid');
    const day = (s) => String(s || '').slice(0, 10);
    const saveUser = (u) => {
      if (!u) return;
      state.currentUser = u;
      try { localStorage.setItem('soulchill_user', JSON.stringify(u)); } catch (e) {}
      try { updateHeaderUI(); } catch (e) {}
    };
    const card = ({ media, name, date, on, attr }) => `
      <div class="pf-ac-card ${on ? 'on' : ''}" ${attr || ''}>
        ${on ? `<span class="pf-ac-check">${PF_AC_CHECK}</span>` : ''}
        <div class="pf-ac-media">${media || ''}</div>
        <div class="pf-ac-name">${fEsc(name || '')}</div>
        <div class="pf-ac-date"><b>${fEsc(date || '')}</b>${PF_AC_CLOCK}</div>
      </div>`;
    const empty = () => `<div class="pf-ac-empty">${PF_AC_EMPTY}<span>لا يوجد بيانات حالياً</span></div>`;

    async function loadEntry() {
      if (entry) return entry;
      try {
        const r = await fetch('/api/entry-templates', { headers: { 'x-user-id': state.currentUser.id } });
        const d = await r.json();
        entry = { templates: (d.templates || []).filter(t => t.owned), equipped: d.equipped || '' };
      } catch (e) { entry = { templates: [], equipped: '' }; }
      return entry;
    }

    async function paint() {
      tabsEl.innerHTML = PF_AC_TABS.map(t => `<button type="button" class="pf-ac-tab ${t[0] === active ? 'active' : ''}" data-t="${t[0]}">${t[1]}</button>`).join('');
      tabsEl.querySelectorAll('.pf-ac-tab').forEach(b => { b.onclick = () => { active = b.dataset.t; paint(); }; });
      const act = tabsEl.querySelector('.pf-ac-tab.active');
      if (act) act.scrollIntoView({ inline: 'center', block: 'nearest' });

      if (active === 'frames') {
        const cur = state.currentUser.avatar_frame || '';
        grid.innerHTML = '<div class="pf-ac-empty"><span>جارٍ التحميل…</span></div>';
        const cf = await pfLoadCustomFrames();
        if (!el.isConnected || active !== 'frames') return;
        const mine = cf.frames.filter(f => f.owned);
        const mk = (f, isCustom) => card({
          media: `<img class="avatar-frame-${fEsc(f.id)} pf-ac-av" src="${pfAvatarSrc(state.currentUser)}" onerror="this.src='/avatars/avatar-1.png'" alt="" />`,
          name: f.name, date: isCustom ? (day(f.owned_at) || 'دائم') : 'دائم', on: cur === f.id, attr: `data-frame="${fEsc(f.id)}"`
        }).replace('class="pf-ac-media"', 'class="pf-ac-media has-frame"');
        grid.innerHTML = mine.map(f => mk(f, true)).join('') + PF_FRAME_LIST.map(f => mk(f, false)).join('');
        grid.querySelectorAll('[data-frame]').forEach(c => {
          c.onclick = async () => {
            const id = c.dataset.frame;
            await equipAvatarFrame(cur === id && id.startsWith('cf-') ? 'cosmic_ring' : id);
            if (el.isConnected) paint();
          };
        });
      } else if (active === 'entry') {
        grid.innerHTML = '<div class="pf-ac-empty"><span>جارٍ التحميل…</span></div>';
        const e = await loadEntry();
        if (!el.isConnected || active !== 'entry') return;
        if (!e.templates.length) { grid.innerHTML = empty(); return; }
        grid.innerHTML = e.templates.map(t => card({
          media: `<img src="${fEsc(t.image_url)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />`,
          name: t.name, date: day(t.owned_at) || 'دائم', on: e.equipped === t.id, attr: `data-tpl="${fEsc(t.id)}"`
        })).join('');
        grid.querySelectorAll('[data-tpl]').forEach(c => {
          c.onclick = async () => {
            const id = entry.equipped === c.dataset.tpl ? '' : c.dataset.tpl;
            try {
              const r = await fetch('/api/entry-templates/equip', { method: 'POST', headers: pfHdr(), body: JSON.stringify({ templateId: id }) });
              const d = await r.json();
              if (!r.ok || !d.success) { showToast(d.error || 'تعذّر التفعيل'); return; }
              saveUser(d.user);
              entry.equipped = id;
              showToast(id ? 'تم تفعيل مؤثر الدخول ✨' : 'تم إلغاء التفعيل');
              if (el.isConnected && active === 'entry') paint();
            } catch (err) { showToast('حدث خطأ، حاول مرة أخرى'); }
          };
        });
      } else if (active === 'bubble') {
        const curFrame = state.currentUser.chat_frame || '';
        grid.innerHTML = ROOM_CHAT_BUBBLE_FRAMES.map(f => card({
          media: `<div class="acc-preview-bubble ${f.previewClass}"><span>${f.icon}</span><span style="font-size:10px;font-weight:700;color:#fff;">أهلاً ✨</span></div>`,
          name: f.name, date: 'دائم', on: curFrame === f.id, attr: `data-bframe="${fEsc(f.id)}"`
        })).join('');
        grid.querySelectorAll('[data-bframe]').forEach(c => {
          c.onclick = async () => {
            const id = c.dataset.bframe;
            try {
              const r = await fetch('/api/users/accessories', { method: 'POST', headers: pfHdr(), body: JSON.stringify({ chat_frame: id }) });
              const d = await r.json();
              if (!r.ok || !d.success) { showToast(d.error || 'تعذّر التفعيل'); return; }
              try { localStorage.setItem('soulchill_chat_frame', id); } catch (e) {}
              saveUser(d.user);
              showToast('تم تفعيل إطار الرسالة 💬');
              if (el.isConnected && active === 'bubble') paint();
            } catch (err) { showToast('حدث خطأ، حاول مرة أخرى'); }
          };
        });
      } else if (active === 'rooms') {
        grid.innerHTML = '<div class="pf-ac-empty"><span>جارٍ التحميل…</span></div>';
        const rc = await loadRoomCardsMine();
        if (!el.isConnected || active !== 'rooms') return;
        if (!rc.cards.length) { grid.innerHTML = empty(); return; }
        grid.innerHTML = rc.cards.map(c => card({
          media: `<div class="pf-ac-roomcard" style="background-image:url('${fEsc(encodeURI(c.image_url))}')"></div>`,
          name: c.name, date: day(c.owned_at) || 'دائم', on: rc.equipped === c.id, attr: `data-rcard="${fEsc(c.id)}"`
        })).join('');
        grid.querySelectorAll('[data-rcard]').forEach(c => {
          c.onclick = async () => {
            const id = rc.equipped === c.dataset.rcard ? '' : c.dataset.rcard;
            try {
              const r = await fetch('/api/room-cards/equip', { method: 'POST', headers: pfHdr(), body: JSON.stringify({ cardId: id }) });
              const d = await r.json();
              if (!r.ok || !d.success) { showToast(d.error || 'تعذّر التفعيل'); return; }
              saveUser(d.user);
              rc.equipped = id;
              showToast(id ? 'تم تفعيل بطاقة الغرفة ✨' : 'تم إلغاء التفعيل');
              try { loadRoomsList(); } catch (e) {}
              if (el.isConnected && active === 'rooms') paint();
            } catch (err) { showToast('حدث خطأ، حاول مرة أخرى'); }
          };
        });
      } else {
        grid.innerHTML = empty();
      }
    }
    paint();
  }

  // ======================================================================
  // الصف الثاني من الملف الشخصي: المتجر · مركز الألعاب · شركائي · ميدالية
  // (صفحات بنفس تصميم الفيديو)
  // ======================================================================
  const PF_IMG = '/img/pf/';
  const PF_SHIRT = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 3l4 2 4-2 5 4-3 4-2-1v11H8V10l-2 1-3-4z"/></svg>';
  const pfGem = (s = 14) => `<span class="pf-gem" style="width:${s}px;height:${s}px">${pfIc('crystal')}</span>`;
  const pfBalance = () => pfFmt((state.currentUser && state.currentUser.diamonds) || 0);

  // ---------- 1) المتجر ----------
  const PF_ST_TABS = [
    ['frames', 'إطارات'], ['entry', 'مؤثرات الدخول'], ['rooms', 'بطاقات الغرف'], ['family', 'محكمة الأسرة'],
    ['relation', 'إكسسوار العلاقة'], ['mic', 'مقاعد المايك'], ['badges', 'شارات'], ['bubble', 'فقاعة الدردشة'], ['idcard', 'بطاقة التعريف']
  ];
  const PF_FRAME_LIST = [
    { id: 'imperial_owner', name: 'عرش الإمبراطور' }, { id: 'galaxy_halo', name: 'هالة المجرة' },
    { id: 'cyber_neon', name: 'سايبر نيون' }, { id: 'royal_gold', name: 'التاج الملكي' },
    { id: 'fire_dragon', name: 'تنين اللهب' }, { id: 'angel_wings', name: 'أجنحة الملاك' },
    { id: 'cosmic_ring', name: 'خاتم السول' }
  ];
  // عناصر العرض كما في الفيديو (الترتيب من اليمين لليسار)
  const PF_ST_STATIC = {
    rooms: [['Majestic rose', 2000, 7, 'NEW'], ['Royalty', 2000, 7, 'NEW'], ['عين حورس', 2000, 7], ['Sword of Power', 2000, 7]],
    idcard: [['Majestic rose', 2500, 7, 'NEW'], ['Royalty', 2500, 7, 'NEW'], ['Golden Lion', 2000, 7], ['روليكس', 3000, 7]],
    badges: [
      { cp: 'red', name: '', love: true }, { cp: 'pink', name: '', love: true },
      { chip: 'شحن', name: 'Taillight', price: 440000, days: 999 }, { chip: 'Gold', name: 'Taillight', price: 900, days: 3 }
    ]
  };
  const PF_ENTRY_FALLBACK = [
    { name: 'السيارة الذهبية', price: 20000, image_url: PF_IMG + 'fx_car.png', badge: 'جديدة' },
    { name: 'الأميرة العربية', price: 15000, image_url: PF_IMG + 'fx_princess.png', badge: 'جديدة' },
    { name: 'مؤثر دخول', price: 12000, image_url: PF_IMG + 'fx_knight.png' },
    { name: 'private plane', price: 38000, image_url: PF_IMG + 'fx_plane.png' }
  ];

  function pfStCard({ badge, media = '', name = '', price, days, sub = '', cls = '', attr = '' }) {
    return `
      <div class="pf-st-card ${cls}" ${attr}>
        ${badge ? `<span class="pf-st-badge ${badge === 'NEW' ? 'new' : ''}">${badge}</span>` : ''}
        <div class="pf-st-media">${media}</div>
        <div class="pf-st-name">${name}</div>
        ${price != null ? `<div class="pf-st-price">${pfGem(14)}<b>${pfFmt(price)}</b><small>· ${days} يوم</small></div>` : sub}
      </div>`;
  }

  function pfOpenStore(initialTab) {
    if (!requireAuth()) return;
    pfSprite();
    let active = PF_ST_TABS.some(t => t[0] === initialTab) ? initialTab : 'frames';
    let entry = null; // { templates, equipped }
    const el = pfPage({
      id: 'pf-store-page', cls: 'pf-st', title: 'المتجر',
      actionHtml: `<button type="button" class="pf-ico-btn" id="pf-st-shirt" aria-label="اكسسواراتي">${PF_SHIRT}</button>`,
      body: `
        <div class="pf-st-banners">
          <button type="button" class="pf-st-ban orange" data-ban="numbers"><span class="t">متجر الأرقام<br>المميزة</span><i>🏆</i></button>
          <button type="button" class="pf-st-ban blue" data-ban="games"><span class="t">متجر الألعاب</span><i>🎮</i></button>
        </div>
        <div class="pf-st-tabs"></div>
        <div class="pf-st-grid"></div>`
    });
    const bar = document.createElement('div');
    bar.className = 'pf-st-bar';
    bar.innerHTML = `<button type="button" class="pf-st-charge">اذهب للشحن ${PF_CHEV_L}</button><div class="pf-st-bal">${pfGem(16)}<b id="pf-st-bal-val">${pfBalance()}</b></div>`;
    el.appendChild(bar);

    el.querySelector('#pf-st-shirt').onclick = () => pfOpenAccessories();
    el.querySelector('.pf-st-charge').onclick = () => pfOpenWallet('crystal');
    el.querySelector('[data-ban="games"]').onclick = () => pfOpenGames();
    el.querySelector('[data-ban="numbers"]').onclick = pfSoon;

    const tabsEl = el.querySelector('.pf-st-tabs');
    const grid = el.querySelector('.pf-st-grid');
    const skeleton = n => Array.from({ length: n }, () => '<div class="pf-st-card skel"></div>').join('');
    const refreshBal = () => { const b = el.querySelector('#pf-st-bal-val'); if (b) b.textContent = pfBalance(); };
    const saveUser = (u) => {
      if (!u) return;
      state.currentUser = u;
      try { localStorage.setItem('soulchill_user', JSON.stringify(u)); } catch (e) {}
      try { updateHeaderUI(); } catch (e) {}
      refreshBal();
    };

    async function loadEntry() {
      if (entry) return entry;
      try {
        const r = await fetch('/api/entry-templates', { headers: { 'x-user-id': state.currentUser.id } });
        const d = await r.json();
        entry = { templates: d.templates || [], equipped: d.equipped || '' };
      } catch (e) { entry = { templates: [], equipped: '' }; }
      return entry;
    }

    async function entryAction(tpl) {
      try {
        if (!tpl.owned) {
          const ok = await window.uiConfirm(`شراء «${tpl.name}» مقابل ${pfFmt(tpl.price)} كريستالة؟`, { title: 'تأكيد الشراء', okText: 'شراء' });
          if (!ok) return;
          const r = await fetch(`/api/entry-templates/${encodeURIComponent(tpl.id)}/buy`, { method: 'POST', headers: pfHdr(), body: '{}' });
          const d = await r.json();
          if (!r.ok || !d.success) { showToast(d.error || 'تعذّر الشراء'); return; }
          saveUser(d.user);
          tpl.owned = true;
          showToast('تم الشراء بنجاح ✨');
        } else {
          const id = entry.equipped === tpl.id ? '' : tpl.id;
          const r = await fetch('/api/entry-templates/equip', { method: 'POST', headers: pfHdr(), body: JSON.stringify({ templateId: id }) });
          const d = await r.json();
          if (!r.ok || !d.success) { showToast(d.error || 'تعذّر التفعيل'); return; }
          saveUser(d.user);
          entry.equipped = id;
          showToast(id ? 'تم تفعيل مؤثر الدخول ✨' : 'تم إلغاء التفعيل');
        }
      } catch (e) { showToast('حدث خطأ، حاول مرة أخرى'); }
      if (el.isConnected) paint();
    }

    async function paint() {
      tabsEl.innerHTML = PF_ST_TABS.map(t => `<button type="button" class="pf-st-tab ${t[0] === active ? 'active' : ''}" data-t="${t[0]}">${t[1]}</button>`).join('');
      tabsEl.querySelectorAll('.pf-st-tab').forEach(b => {
        b.onclick = () => { active = b.dataset.t; paint(); const s = tabsEl.querySelector('.active'); if (s) s.scrollIntoView({ inline: 'center', block: 'nearest' }); };
      });
      const u = state.currentUser;
      const myAv = pfAvatarSrc(u);
      grid.scrollTop = 0; el.querySelector('.pf-page-body').scrollTop = 0;
      const tab = active;

      if (tab === 'frames') {
        grid.innerHTML = skeleton(4);
        const cf = await pfLoadCustomFrames();
        if (!el.isConnected || active !== 'frames') return;
        const customCards = cf.frames.filter(f => f.is_active || f.owned).map((f, i) => {
          const on = u.avatar_frame === f.id;
          return pfStCard({
            badge: i < 2 && !f.owned ? 'جديدة' : '', name: fEsc(f.name), cls: 'frame', attr: `data-cframe="${fEsc(f.id)}"`,
            media: `<div class="pf-st-av"><img class="avatar-frame-${fEsc(f.id)}" src="${myAv}" onerror="this.src='/avatars/avatar-1.png'" alt="" /></div>`,
            sub: f.owned
              ? `<div class="pf-st-state ${on ? 'on' : ''}">${on ? 'مفعّل الآن' : 'تفعيل'}</div>`
              : `<div class="pf-st-price">${pfGem(14)}<b>${pfFmt(Number(f.price) || 0)}</b></div>`
          });
        }).join('');
        const builtinCards = PF_FRAME_LIST.map(f => {
          const on = u.avatar_frame === f.id;
          return pfStCard({
            name: f.name, cls: 'frame', attr: `data-frame="${f.id}"`,
            media: `<div class="pf-st-av"><img class="avatar-frame-${f.id}" src="${myAv}" onerror="this.src='/avatars/avatar-1.png'" alt="" /></div>`,
            sub: `<div class="pf-st-state ${on ? 'on' : ''}">${on ? 'مفعّل الآن' : 'تفعيل'}</div>`
          });
        }).join('');
        grid.innerHTML = customCards + builtinCards;
        grid.querySelectorAll('[data-frame]').forEach(c => {
          c.onclick = async () => { await equipAvatarFrame(c.dataset.frame); if (el.isConnected) paint(); };
        });
        grid.querySelectorAll('[data-cframe]').forEach(c => {
          c.onclick = async () => {
            const f = cf.frames.find(x => x.id === c.dataset.cframe);
            if (!f) return;
            try {
              if (!f.owned) {
                const ok = await window.uiConfirm(`شراء «${f.name}» مقابل ${pfFmt(f.price)} كريستالة؟`, { title: 'تأكيد الشراء', okText: 'شراء' });
                if (!ok) return;
                const r = await fetch(`/api/avatar-frames/${encodeURIComponent(f.id)}/buy`, { method: 'POST', headers: pfHdr(), body: '{}' });
                const d = await r.json();
                if (!r.ok || !d.success) { showToast(d.error || 'تعذّر الشراء'); return; }
                saveUser(d.user);
                showToast('تم الشراء بنجاح ✨');
              } else {
                await equipAvatarFrame(u.avatar_frame === f.id ? 'cosmic_ring' : f.id);
              }
            } catch (e) { showToast('حدث خطأ، حاول مرة أخرى'); }
            if (el.isConnected) paint();
          };
        });
        return;
      }

      if (tab === 'entry') {
        grid.innerHTML = skeleton(4);
        const e = await loadEntry();
        if (!el.isConnected || active !== 'entry') return;
        if (!e.templates.length) {
          grid.innerHTML = PF_ENTRY_FALLBACK.map(t => pfStCard({
            badge: t.badge, name: t.name, price: t.price, days: 7, attr: 'data-soon',
            media: `<img src="${t.image_url}" alt="" /><span class="pf-st-play">▶</span>`
          })).join('');
          grid.querySelectorAll('[data-soon]').forEach(c => c.onclick = pfSoon);
          return;
        }
        grid.innerHTML = e.templates.map((t, i) => {
          const eq = e.equipped === t.id;
          return pfStCard({
            badge: i < 2 && !t.owned ? 'جديدة' : '', name: fEsc(t.name), attr: `data-tpl="${fEsc(t.id)}"`,
            media: `<img src="${fEsc(t.image_url || '')}" alt="" onerror="this.style.visibility='hidden'" /><span class="pf-st-play">▶</span>`,
            price: t.owned ? null : (Number(t.price) || 0), days: 7,
            sub: t.owned ? `<div class="pf-st-state ${eq ? 'on' : ''}">${eq ? 'مفعّل الآن' : 'تفعيل'}</div>` : ''
          });
        }).join('');
        grid.querySelectorAll('[data-tpl]').forEach(c => {
          c.onclick = () => { const t = e.templates.find(x => x.id === c.dataset.tpl); if (t) entryAction(t); };
        });
        return;
      }

      if (tab === 'rooms') {
        grid.innerHTML = skeleton(4);
        let rc = { cards: [], equipped: '' };
        try {
          const r = await fetch('/api/room-cards', { headers: { 'x-user-id': state.currentUser.id } });
          const d = await r.json();
          rc = { cards: d.cards || [], equipped: d.equipped || '' };
        } catch (e) {}
        if (!el.isConnected || active !== 'rooms') return;
        if (rc.cards.length) {
          grid.innerHTML = rc.cards.map((c, i) => {
            const eq = rc.equipped === c.id;
            return pfStCard({
              badge: i < 2 && !c.owned ? 'NEW' : '', name: fEsc(c.name), attr: `data-rcard="${fEsc(c.id)}"`,
              media: `<div class="pf-st-roomcard" style="background-image:url('${fEsc(encodeURI(c.image_url))}')"></div>`,
              price: c.owned ? null : (Number(c.price) || 0), days: 7,
              sub: c.owned ? `<div class="pf-st-state ${eq ? 'on' : ''}">${eq ? 'مفعّلة الآن' : 'تفعيل'}</div>` : ''
            });
          }).join('');
          grid.querySelectorAll('[data-rcard]').forEach(c => {
            c.onclick = async () => {
              const card = rc.cards.find(x => x.id === c.dataset.rcard);
              if (!card) return;
              try {
                if (!card.owned) {
                  const ok = await window.uiConfirm(`شراء «${card.name}» مقابل ${pfFmt(card.price)} كريستالة؟`, { title: 'تأكيد الشراء', okText: 'شراء' });
                  if (!ok) return;
                  const r = await fetch(`/api/room-cards/${encodeURIComponent(card.id)}/buy`, { method: 'POST', headers: pfHdr(), body: '{}' });
                  const d = await r.json();
                  if (!r.ok || !d.success) { showToast(d.error || 'تعذّر الشراء'); return; }
                  saveUser(d.user);
                  showToast('تم الشراء بنجاح ✨');
                } else {
                  const id = rc.equipped === card.id ? '' : card.id;
                  const r = await fetch('/api/room-cards/equip', { method: 'POST', headers: pfHdr(), body: JSON.stringify({ cardId: id }) });
                  const d = await r.json();
                  if (!r.ok || !d.success) { showToast(d.error || 'تعذّر التفعيل'); return; }
                  saveUser(d.user);
                  try { loadRoomsList(); } catch (e) {}
                  showToast(id ? 'تم تفعيل بطاقة الغرفة ✨' : 'تم إلغاء التفعيل');
                }
              } catch (e) { showToast('حدث خطأ، حاول مرة أخرى'); }
              if (el.isConnected) paint();
            };
          });
          return;
        }
      }

      if (tab === 'rooms' || tab === 'idcard') {
        grid.innerHTML = PF_ST_STATIC[tab].map(([n, p, d, b]) => pfStCard({ badge: b, name: n, price: p, days: d, attr: 'data-soon' })).join('');
      } else if (tab === 'badges') {
        grid.innerHTML = PF_ST_STATIC.badges.map(b => b.cp
          ? pfStCard({
              media: `<div class="pf-st-cp ${b.cp}">CP</div>`, name: '<span class="pf-st-dim">خاص بعصافير الحب</span>',
              sub: `<div class="pf-st-love">خاص بعصافير الحب ${PF_CHEV_L}</div>`, attr: 'data-soon'
            })
          : pfStCard({ media: `<span class="pf-st-chip">${b.chip}</span>`, name: b.name, price: b.price, days: b.days, attr: 'data-soon' })
        ).join('');
      } else if (tab === 'mic') {
        grid.innerHTML = [0, 1, 2].map(() => pfStCard({
          media: `<img class="pf-st-micav" src="${myAv}" onerror="this.src='/avatars/avatar-1.png'" alt="" />`,
          name: '<span class="pf-st-dim">خاص بعصافير الحب</span>',
          sub: `<div class="pf-st-love">خاص بعصافير الحب ${PF_CHEV_L}</div>`, attr: 'data-soon'
        })).join('');
      } else {
        grid.innerHTML = skeleton(6); // family / relation / bubble: بطاقات تحميل كما في الفيديو
      }
      grid.querySelectorAll('[data-soon]').forEach(c => c.onclick = pfSoon);
    }
    paint();
  }

  // ---------- 2) مركز الألعاب ----------
  function pfOpenGames() {
    if (!requireAuth()) return;
    pfSprite();
    const u = state.currentUser;
    const games = [
      ['uefa', 'UEFA'], ['yumyum', 'YUMYUM', ''], ['jewels', 'JEWELS', 'رائج'],
      ['12diamonds', '12 Diamonds'], ['starburst', 'Starburst Galaxy', 'جديد'], ['bookofra', 'Book of Ra'],
      ['frenzylion', 'Frenzy Lion'], ['oceanhunter', 'Ocean Hunter'], ['fruitbattle', 'Fruit Battle']
    ];
    const fns = [
      ['المركز', '<svg viewBox="0 0 24 24" fill="url(#pfgG)"><path d="M7 3h10v5a5 5 0 0 1-10 0z"/><path d="M7 5H3c0 4 2 6 4.5 6M17 5h4c0 4-2 6-4.5 6" fill="none" stroke="#f3c04a" stroke-width="1.6"/><path d="M10.5 13h3v3h2.5v3h-8v-3h2.5z"/></svg>'],
      ['تصريح العبور', '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="6" fill="url(#pfgB)"/><circle cx="12" cy="9" r="3" fill="#f3c04a"/><path d="M8 14l-2 7 6-3 6 3-2-7" fill="url(#pfgB)"/></svg>'],
      ['المتجر', '<svg viewBox="0 0 24 24" fill="url(#pfgG)"><path d="M12 2l2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6z"/></svg>'],
      ['بطاقة', '<svg viewBox="0 0 24 24" fill="url(#pfgG)"><path d="M3 15l4-9h14l-4 9z"/><path d="M3 15h14v4H3z" opacity=".75"/></svg>'],
      ['استكشاف', '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" fill="none" stroke="url(#pfgG)" stroke-width="2"/><path d="M15.5 8.5l-2 5-5 2 2-5z" fill="url(#pfgG)"/></svg>']
    ];
    const el = pfPage({
      id: 'pf-games-page', cls: 'pf-gm',
      body: `
        <div class="pf-gm-top">
          <img class="pf-gm-av" src="${pfAvatarSrc(u)}" onerror="this.src='/avatars/avatar-1.png'" alt="" />
          <div class="pf-gm-bal"><span class="coin">+</span><b>${pfBalance()}</b>${pfGem(18)}</div>
          <div class="pf-gm-lv"><b>Lv.0</b><i></i></div>
          <button type="button" class="pf-gm-x" aria-label="إغلاق">✕</button>
        </div>
        <div class="pf-gm-ticker"><span><b class="g">BOOK of RA</b> فاز بـ 451,050 من الكريستال <b>1503.5x</b></span>${PF_CHEV_L}</div>
        <div class="pf-gm-fns">${fns.map(f => `<button type="button" class="pf-gm-fn"><span>${f[1]}</span><small>${f[0]}</small></button>`).join('')}</div>
        <div class="pf-gm-grid">${games.map(g => `
          <button type="button" class="pf-gm-tile" aria-label="${g[1]}"><img src="${PF_IMG}game_${g[0]}.png" alt="${g[1]}" /></button>`).join('')}
        </div>`
    });
    el.querySelector('.pf-gm-x').onclick = () => el.remove();
    el.querySelectorAll('.pf-gm-fn, .pf-gm-tile, .pf-gm-ticker').forEach(b => b.onclick = pfSoon);
  }

  // ---------- 3) شركائي: عصفور حبي ----------
  async function pfOpenPartners() {
    if (!requireAuth()) return;
    pfSprite();
    const me = state.currentUser;
    const desc = 'بعد حصولك على عصفور الحب، ستتاح لك الفرصة لتكون على قائمة العصافير، وستحصل على مزايا حصرية من عصافير الحب، مثل إطار عصافير الحب، ووسمة الحب بالغرفة، وإدارة عصافير الحب، وما إلى ذلك.';
    const rule = 'عندما تصل نبضات القلب بينكما إلى 5000، يمكنك شراء الخاتم وإهدائه إلى الطرف الآخر لتصبحون عصافير حب. أرسل هدايا الحب لتزيد من نبضات القلب';
    const heartSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="#ff3d7f"><path d="M12 21s-8-5.2-8-11a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.8-8 11-8 11z"/></svg>';
    const el = pfPage({
      id: 'pf-lovebird-page', cls: 'pf-lb',
      actionHtml: `<button type="button" class="pf-ico-btn" data-soon aria-label="مساعدة"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M9.5 9.4a2.6 2.6 0 1 1 3.9 2.2c-.9.5-1.4 1-1.4 2"/><circle cx="12" cy="17" r=".6" fill="currentColor"/></svg></button><button type="button" class="pf-ico-btn" data-soon aria-label="الترتيب"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="11" width="5" height="9"/><rect x="9.5" y="4" width="5" height="16"/><rect x="16" y="8" width="5" height="12"/></svg></button>`,
      body: `
        <h2 class="pf-lb-title">عصفور حبي</h2>
        <p class="pf-lb-desc">${desc}</p>
        <div class="pf-lb-pair">
          <div class="pf-lb-who"><div class="pf-lb-av"><img src="${pfAvatarSrc(me)}" onerror="this.src='/avatars/avatar-1.png'" alt="" /></div><b>${fEsc(me.name)}</b></div>
          <div class="pf-lb-heart"><svg viewBox="0 0 24 24" width="46" height="46"><path d="M12 21s-8-5.2-8-11a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.8-8 11-8 11z" fill="#ff4f86"/></svg></div>
          <div class="pf-lb-who"><div class="pf-lb-av empty"><svg viewBox="0 0 24 24" width="38" height="38" fill="#ffb6d2"><circle cx="12" cy="8" r="4.2"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z"/></svg></div><b>CP</b></div>
        </div>
        <div class="pf-lb-card">
          <div class="pf-lb-ct"><span>ترشيح</span></div>
          <p>${rule}</p>
          <button type="button" class="pf-lb-more">المزيد: كيفية الحصول على عصفور الحب؟</button>
          <div class="pf-lb-list"><div class="pf-lb-load">...</div></div>
        </div>`
    });
    el.querySelectorAll('[data-soon]').forEach(b => b.onclick = pfSoon);
    el.querySelector('.pf-lb-more').onclick = () => window.uiAlert(rule, { title: 'كيفية الحصول على عصفور الحب؟' });

    let list = [];
    try {
      const r = await fetch('/api/users');
      const all = r.ok ? await r.json() : [];
      list = (Array.isArray(all) ? all : []).filter(x => x && x.id !== me.id).slice(0, 20);
    } catch (e) { list = []; }
    if (!el.isConnected) return;
    const listEl = el.querySelector('.pf-lb-list');
    listEl.innerHTML = list.length ? list.map(x => `
      <div class="pf-lb-row" data-uid="${fEsc(x.id)}">
        <img class="pf-lb-uav" src="${pfAvatarSrc(x)}" onerror="this.src='/avatars/avatar-1.png'" alt="" />
        <div class="pf-lb-uinfo"><b>${fEsc(x.name)}</b><span>${heartSvg} 0</span></div>
        <button type="button" class="pf-lb-hi" data-hi="${fEsc(x.id)}">إرسال تحية</button>
      </div>`).join('') : '<div class="pf-lb-load">لا يوجد مرشحون حالياً</div>';
    listEl.onclick = async (e) => {
      const hi = e.target.closest('[data-hi]');
      if (hi) {
        e.stopPropagation();
        if (hi.disabled) return;
        hi.disabled = true;
        try {
          const r = await fetch('/api/messages', { method: 'POST', headers: pfHdr(), body: JSON.stringify({ receiver_id: hi.dataset.hi, message_type: 'text', content: '👋 مرحباً! أرسلت لك تحية من عصفور حبي 💕' }) });
          if (!r.ok) throw new Error('fail');
          hi.textContent = 'تم الإرسال ✓';
          showToast('تم إرسال التحية 💕');
        } catch (err) { hi.disabled = false; showToast('تعذّر إرسال التحية'); }
        return;
      }
      const row = e.target.closest('.pf-lb-row');
      if (row) { const x = list.find(v => v.id === row.dataset.uid); if (x) pfOpenProfilePage(x); }
    };
  }

  // ---------- 4) ميدالية: الإنجازات ----------
  function pfOpenMedals() {
    if (!requireAuth()) return;
    const game = [['beginner', 'اللاعب المبتدئ'], ['star', 'اللاعب النجم'], ['golden', 'اللاعب الذهبي'], ['diamond', 'اللاعب الماسي'], ['pro', 'اللاعب المحترف'], ['king', 'ملك اللعبة']];
    const gift = [['g_beginner', 'جامع مبتدئ'], ['g_talented', 'جامع موهوب'], ['g_pro', 'جامع محترف'], ['g_expert', 'جامع خبير'], ['g_museum', 'رئيس متحف هدايا']];
    const tile = ([img, name], cls) => `<button type="button" class="pf-md-card ${cls}"><img src="${PF_IMG}${cls === 'gift' ? img : 'medal_' + img}.png" alt="" /><span>${name}</span></button>`;
    const el = pfPage({
      id: 'pf-medals-page', cls: 'pf-md', title: 'الإنجازات',
      body: `
        <h6 class="pf-md-sec">الميداليات الساحرة المستديرة</h6>
        <div class="pf-md-grid">${game.map(m => tile(m, 'game')).join('')}</div>
        <h6 class="pf-md-sec">ميداليات الهدايا</h6>
        <div class="pf-md-grid">${gift.map(m => tile(m, 'gift')).join('')}</div>`
    });
    el.querySelectorAll('.pf-md-card').forEach(b => b.onclick = pfSoon);
  }

  // ======================================================================
  // الصف الأول من الملف الشخصي: المستوى · SVIP · طبقة النبلاء · الامبراطورية
  // (صفحات كاملة بنفس تصميم الفيديو)
  // ======================================================================
  const PF_Q = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M9.5 9.4a2.6 2.6 0 1 1 3.9 2.2c-.9.5-1.4 1-1.4 2"/><circle cx="12" cy="16.9" r=".9" fill="currentColor"/></svg>';
  const PF_LOG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v13l-3 3H5z"/><path d="M8.5 9h7M8.5 13h4"/></svg>';
  const pfFmt = (n) => Number(n || 0).toLocaleString('en-US');

  function pfSprite2() {
    if (document.getElementById('pf-svg-sprite2')) return;
    const d = document.createElement('div');
    d.id = 'pf-svg-sprite2';
    d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    const g = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
    d.innerHTML = `<svg width="0" height="0" aria-hidden="true"><defs>
      ${g('pfLTa', '#ffffff', '#c9b6ff')}${g('pfLTb', '#b57bff', '#5b21d6')}${g('pfGrn', '#c4f25a', '#3f8f12')}
      ${g('pfGoldG', '#fff1a8', '#c8921f')}${g('pfSil', '#ffffff', '#8c93b8')}${g('pfNavy', '#3a4290', '#0f1330')}
      <symbol id="pf-tri" viewBox="0 0 100 100"><path d="M50 8L94 84Q97 91 88 91H12Q3 91 6 84z" fill="url(#pfLTa)"/><path d="M50 32L75 76H25z" fill="url(#pfLTb)" stroke="url(#pfLTb)" stroke-width="6" stroke-linejoin="round"/></symbol>
      <symbol id="pf-medal" viewBox="0 0 120 120"><g fill="url(#pfGrn)"><path d="M60 3c9 8 13 17 0 27C47 20 51 11 60 3z"/><path d="M16 30c13 0 22 4 26 18-15 4-26-2-26-18z"/><path d="M104 30c0 16-11 22-26 18 4-14 13-18 26-18z"/></g><circle cx="60" cy="68" r="46" fill="url(#pfGrn)"/><circle cx="60" cy="68" r="36" fill="#2f6a0c"/><circle cx="60" cy="68" r="31" fill="#4d9a17"/><path d="M60 46l21 19-21 31-21-31z" fill="url(#pfGoldG)"/><path d="M39 65h42M60 46l-8 19 8 31 8-31z" stroke="#fff" stroke-opacity=".5" fill="none"/></symbol>
      <symbol id="pf-emblem" viewBox="0 0 240 200"><defs><path id="pfWing" d="M118 84C82 52 32 50 4 62c30 4 48 14 62 30-18-2-36 0-52 10 30 2 52 8 70 22-14 0-28 4-40 12 32 2 58-2 74-16z"/></defs><use href="#pfWing" fill="url(#pfSil)" stroke="url(#pfGoldG)" stroke-width="3"/><use href="#pfWing" fill="url(#pfSil)" stroke="url(#pfGoldG)" stroke-width="3" transform="translate(240 0) scale(-1 1)"/><path d="M120 30l40 26v54c0 30-18 50-40 66-22-16-40-36-40-66V56z" fill="url(#pfGoldG)" stroke="#fff3c4" stroke-width="2"/><path d="M120 48l28 18v42c0 22-12 38-28 50-16-12-28-28-28-50V66z" fill="#7a4d08" fill-opacity=".45"/><path d="M104 30l8-16 8 10 8-10 8 16z" fill="url(#pfGoldG)"/><path d="M120 70l12 20-12 36-12-36z" fill="#fff6c8"/></symbol>
      <symbol id="pf-crownshield" viewBox="0 0 120 130"><path d="M60 4l48 20v46c0 28-22 46-48 56C34 116 12 98 12 70V24z" fill="url(#pfNavy)" stroke="url(#pfSil)" stroke-width="4"/><path d="M30 66l6-28 14 14 10-20 10 20 14-14 6 28z" fill="url(#pfSil)"/><rect x="32" y="68" width="56" height="8" rx="3" fill="url(#pfSil)"/><circle cx="60" cy="46" r="3" fill="#e0457b"/></symbol>
    </defs></svg>`;
    document.body.appendChild(d);
  }
  const pfTriSvg = (cls = '', s = 40) => `<svg class="${cls}" viewBox="0 0 100 100" width="${s}" height="${s}"><use href="#pf-tri"/></svg>`;

  // منحنى الخبرة (نقاط مرجعية من الفيديو ثم استكمال للمستويات الأعلى)
  const PF_KEYS = [[1, 0], [2, 70], [5, 2160], [6, 4200], [10, 46200], [11, 67200], [15, 193200], [20, 700000], [25, 2000000], [30, 5000000]];
  function pfLvThr(n) {
    n = Math.max(1, Math.min(30, n));
    for (let i = 1; i < PF_KEYS.length; i++) {
      const [a, va] = PF_KEYS[i - 1], [b, vb] = PF_KEYS[i];
      if (n <= b) { const t = (n - a) / (b - a); return Math.round(va <= 0 ? vb * t : va * Math.pow(vb / va, t)); }
    }
    return 0;
  }

  // ---------- 1) المستوى ----------
  function pfOpenLevel(user) {
    if (!requireAuth()) return;
    pfSprite(); pfSprite2();
    user = user || state.currentUser;
    let active = 'wealth';
    const el = pfPage({ id: 'pf-level-page', cls: 'pf-lv', titleAlign: 'right', title: '<div class="pf-head-tabs"></div>', body: '<div class="pf-lv-body"></div>' });
    const perks = [
      ['🏅', 'شارة المستوى', 1], ['🎙️', 'الصدارة في طابور المايك', 1], ['📷', 'تثبيت صورة البروفايل', 1],
      ['✨', 'إشعار دخول رائع', 11], ['💬', 'فقاعة دردشة مبهرة', 21], ['🪪', 'تصميم البطاقة', 31],
      ['👥', 'زيادة عدد المتابعين', 35], ['🪑', 'تأثيرات المقعد', 40], ['🏠', 'بطاقة الغرفة', 50]
    ];
    const info = [
      ['فوائد المستوى العالي', 'المستويات العالية تعطيك الجاذبية والاهتمام'],
      ['طريقة تطوير المستوى', 'إذا استلمت هدية بقيمة 1 كريستالة، فستحصل على نقطة خبرة واحدة. كلما زاد تفاعلك، زادت سرعة رفع المستوى'],
      ['شارة المستوى', 'سيتم عرض شارة المستوى على كل من غرفتك وبطاقة التعريف وقائمة الترحيب. فكلما ارتفع المستوى، حصلت على شارة أفخم']
    ];
    const tiers = [[1, 5], [6, 10], [11, 15], [16, 20], [21, 25], [26, 30]];
    const paint = () => {
      const wealth = active === 'wealth';
      el.classList.toggle('pop', !wealth);
      el.querySelector('.pf-head-tabs').innerHTML =
        `<button type="button" class="pf-tab ${wealth ? 'active' : ''}" data-t="wealth">مستوى الثروة</button><button type="button" class="pf-tab ${!wealth ? 'active' : ''}" data-t="pop">مستوى الشعبية</button>`;
      el.querySelectorAll('.pf-head-tabs .pf-tab').forEach(b => b.onclick = () => { active = b.dataset.t; paint(); });
      const lv = Math.max(1, Math.min(30, Number(wealth ? user.wealth_level : user.level) || 1));
      const base = pfLvThr(lv), nxt = pfLvThr(lv + 1);
      const exp = Number(wealth ? user.wealth_exp : user.level_exp) || base;
      const need = lv >= 30 ? 0 : Math.max(0, nxt - exp);
      const pct = lv >= 30 ? 100 : Math.max(4, Math.min(100, ((exp - base) / Math.max(1, nxt - base)) * 100));
      const av = `<img class="pf-lv-av" src="${pfAvatarSrc(user)}" onerror="this.src='/avatars/avatar-1.png'" alt="" />`;
      let html;
      if (wealth) {
        const open = perks.filter(p => lv >= p[2]).length;
        html = `
          <div class="pf-lv-hero">
            <svg class="pf-lv-badge" viewBox="0 0 120 120"><use href="#pf-medal"/></svg>
            <div class="pf-lv-info">
              <div class="pf-lv-cur">${av}<div><small>المستوى الحالي</small><b>Lv.${lv}</b></div></div>
              <div class="pf-lv-need">${lv >= 30 ? 'وصلت لأعلى مستوى' : `للمستوى التالي ينقصك <b>${pfFmt(need)}</b> خبرة`}</div>
              <div class="pf-lv-bar gold"><i style="width:${pct}%"></i></div>
              <button type="button" class="pf-lv-how" id="pf-lv-how">كيفية الترقية</button>
            </div>
          </div>
          <div class="pf-lv-sec"><i></i><span>مميزات المستوى <b>${open}/30</b></span><i></i></div>
          <div class="pf-perk-grid">${perks.map(p => {
            const on = lv >= p[2];
            return `<div class="pf-perk ${on ? '' : 'lock'}">${on ? '' : '<u>🔒</u>'}<span class="pf-gold-ic">${p[0]}</span><b>${p[1]}</b><small>${on ? 'لمدى الحياة' : `يُمنح عند Lv.${p[2]}`}</small></div>`;
          }).join('')}</div>`;
      } else {
        html = `
          <div class="pf-lv-hero pop">
            ${pfTriSvg('pf-lv-badge tri', 150)}
            <div class="pf-lv-info">
              <div class="pf-lv-cur">${av}<div><small>المستوى الحالي</small><b>Lv.${lv}</b></div></div>
              <div class="pf-lv-ends"><span>Lv.${lv}</span><span>Lv.${Math.min(30, lv + 1)}</span></div>
              <div class="pf-lv-bar"><i style="width:${pct}%"></i></div>
              <div class="pf-lv-exp"><b>Exp</b> ${pfFmt(exp)}</div>
              <div class="pf-lv-nextexp">الخبرة للمستوى التالي: ${pfFmt(nxt)}</div>
            </div>
          </div>
          <div class="pf-lv-text">${info.map(i => `<h4>${i[0]}</h4><p>${i[1]}</p>`).join('')}</div>
          <div class="pf-lv-table">${tiers.map(([a, b], i) => `
            <div class="r">${pfTriSvg('tri t' + i, 46)}<div><small>المستوى</small><b dir="ltr">LV.${a}-LV.${b}</b></div><div><small>الخبرة</small><b dir="ltr">${a === 1 ? '01' : pfFmt(pfLvThr(a)).replace(/,/g, '')}-${pfFmt(pfLvThr(b)).replace(/,/g, '')}</b></div></div>`).join('')}</div>`;
      }
      el.querySelector('.pf-lv-body').innerHTML = html;
      const how = el.querySelector('#pf-lv-how');
      if (how) how.onclick = () => showToast('ارفع مستواك بإرسال الهدايا في الغرف 🎁');
    };
    paint();
  }

  // ---------- 2) SVIP ----------
  function pfOpenSvip() {
    if (!requireAuth()) return;
    pfSprite(); pfSprite2();
    let sel = 10;
    const req = [99000, 500000, 1500000, 4000000, 9000000, 18000000, 35000000, 60000000, 80000000, 94998488];
    const vis = [3, 4, 5, 6, 8, 10, 12, 13, 15, 16];
    const grd = [5, 8, 10, 12, 14, 17, 19, 21, 23, 25];
    const times = [1, 1, 2, 2, 2, 3, 3, 3, 4, 4];
    const visNames = [['🏅', 'ميدالية خاصة'], ['🖼️', 'إطار خاص'], ['✨', 'مؤثر دخول'], ['💌', 'رسالة الدخول'], ['🪪', 'بطاقة تعريف خاصة'], ['💬', 'فقاعة دردشة'], ['🔊', 'موجة صوتية'], ['👑', 'شارة SVIP']];
    const gridNames = [['😀', 'رموز تعبيرية'], ['🙈', 'إخفاء مستوى الثروة'], ['🎙️', 'أولوية الصعود على المايك'], ['🧹', 'مسح الدردشة'], ['🎧', 'خدمة العملاء الخاصة'], ['🎯', 'مركز الأنشطة'], ['🌌', 'خلفية غرفة متحركة'], ['🖼️', 'صورة شخصية متحركة'], ['✉️', 'رسائل طائرة'], ['🛡️', 'حماية من الطرد'], ['🏷️', 'شارة حصرية'], ['✏️', 'تغيير الاسم'], ['💺', 'مقعد مميز'], ['🎁', 'هدايا حصرية'], ['🎨', 'لون اسم مميز'], ['🕵️', 'دخول سري'], ['📌', 'تثبيت الرسائل'], ['🆘', 'أولوية الدعم'], ['↩️', 'استرجاع الهدايا'], ['🔔', 'تنبيهات خاصة'], ['🎞️', 'إطار متحرك'], ['🌠', 'تأثير المقعد'], ['🗝️', 'غرف مغلقة'], ['📣', 'إعلان الدخول'], ['💎', 'مكافأة أسبوعية']];
    const el = pfPage({
      id: 'pf-svip-page', cls: 'pf-svip', title: 'مستويات الـSVIP',
      actionHtml: `<button type="button" class="pf-ico-btn" data-soon>${PF_Q}</button><button type="button" class="pf-ico-btn" data-soon>${PF_LOG}</button>`,
      body: '<div class="pf-svip-body"></div><div class="pf-svip-bar"></div>'
    });
    el.querySelectorAll('[data-soon]').forEach(b => b.onclick = pfSoon);
    const paint = () => {
      const i = sel - 1;
      const tier = sel >= 7 ? 'gold' : (sel >= 4 ? 'silver' : 'bronze');
      const weekly = Math.round((630000 * Math.pow(sel / 10, 1.6)) / 1000) * 1000;
      const body = el.querySelector('.pf-svip-body');
      body.innerHTML = `
        <div class="pf-svip-tabs">${Array.from({ length: 10 }, (_, k) => 10 - k).map(n => `<button type="button" class="${n === sel ? 'on' : ''}" data-n="${n}">SVIP ${n}</button>`).join('')}</div>
        <div class="pf-svip-stage ${tier}">
          <svg viewBox="0 0 240 200"><use href="#pf-emblem"/></svg>
          <div class="pf-svip-lock">🔒 غير مفعّل</div>
          <p>احصل على قيمة ${req[i]} لفتح مستوى SVIP ${sel}</p>
        </div>
        <div class="pf-svip-panel">
          <div class="pf-svip-h"><span>المزايا الظاهرة <b>${vis[i]}/${vis[i]}</b></span></div>
          <div class="pf-svip-row">${visNames.slice(0, Math.min(8, vis[i])).map(v => `<div class="c"><span class="pf-gold-ic">${v[0]}</span><b>${v[1]}</b></div>`).join('')}</div>
          <div class="pf-svip-h"><span>المكافآت</span></div>
          <div class="pf-reward"><span class="chest">🎁</span><div><b>مكافآت الكريستال الأسبوعية ${pfFmt(weekly).replace(/,/g, '')} <i class="g">${pfIc('crystal')}</i></b><small>اشحن لتصبح SVIP${sel} لتتمكن من الاستلام ${times[i]} مرات</small></div></div>
          <div class="pf-reward"><span class="chest">📦</span><div><b>صندوق مهام الأسبوع</b><small>اشحن لتصبح SVIP${sel} لتتمكن من الاستلام</small></div></div>
          <div class="pf-svip-h"><span>المزايا <b>${grd[i]}/${grd[i]}</b></span></div>
          <div class="pf-svip-grid">${gridNames.slice(0, grd[i]).map(v => `<div class="c"><span class="pf-gold-ic">${v[0]}</span><b>${v[1]}</b></div>`).join('')}</div>
        </div>`;
      body.querySelectorAll('.pf-svip-tabs button').forEach(b => b.onclick = () => { sel = +b.dataset.n; paint(); body.scrollTop = 0; });
      const on = body.querySelector('.pf-svip-tabs .on'); if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'center', block: 'nearest' });
      el.querySelector('.pf-svip-bar').innerHTML = `<button type="button" class="pf-gold-btn" id="pf-svip-up">الارتقاء إلى المستوى الأعلى</button><div class="pf-svip-cnt"><small>الامتيازات</small><b>${vis[i] + grd[i]}/${vis[i] + grd[i]}</b></div>`;
      el.querySelector('#pf-svip-up').onclick = () => pfOpenWallet('crystal');
      let x0 = null; const st = body.querySelector('.pf-svip-stage');
      st.ontouchstart = e => { x0 = e.touches[0].clientX; };
      st.ontouchend = e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 40) { sel = Math.max(1, Math.min(10, sel + (dx > 0 ? -1 : 1))); paint(); } };
    };
    paint();
  }

  // ---------- 3) طبقة النبلاء (VIP) ----------
  function pfOpenVip() {
    if (!requireAuth()) return;
    pfSprite(); pfSprite2();
    let sel = 3;
    const price = [9990, 39990, 99990, 199990, 399990, 699990, 999990];
    const total = [9, 14, 23, 28, 33, 38, 43];
    const feats = [
      ['🖼️', 'إطار فاخر', 'إطار مميز على صورتك الشخصية', 1], ['👑', 'شعار النبلاء', 'ذكرهم بأنك من طبقة النبلاء', 1],
      ['🪪', 'مؤثر بطاقة التعريف', 'سيعطي بطاقة تعريفك جاذبية أكثر', 4], ['♞', 'السر الملكي', 'ادخل الغرف بمركبتك الخاصة', 5],
      ['💠', 'بطاقة تعريف خاصة', 'قم بتغيير خلفية بطاقة التعريف', 2], ['🎙️', 'الموجة الصوتية', 'موجة صوتية مميزة تظهر عند الكلام', 2],
      ['💬', 'فقاعة الدردشة', 'لن يفهم أحد رسائلك', 3]
    ];
    const el = pfPage({
      id: 'pf-vip-page', cls: 'pf-vip', titleAlign: 'center', title: '<div class="pf-vip-tabs"></div>',
      actionHtml: `<button type="button" class="pf-ico-btn" data-soon>${PF_Q}</button>`,
      body: '<div class="pf-vip-body"></div><div class="pf-vip-bar"></div>'
    });
    el.querySelector('[data-soon]').onclick = pfSoon;
    const paint = () => {
      const tabs = [sel - 1, sel, sel + 1].filter(n => n >= 1 && n <= 7);
      el.querySelector('.pf-vip-tabs').innerHTML = tabs.map(n => `<button type="button" class="${n === sel ? 'on' : ''}" data-n="${n}">${n === sel ? '<i>✦</i>' : ''}VIP ${n}</button>`).join('');
      el.querySelectorAll('.pf-vip-tabs button').forEach(b => b.onclick = () => { sel = +b.dataset.n; paint(); });
      el.querySelector('.pf-vip-body').innerHTML = `
        <div class="pf-vip-card t${sel}">
          <div><div class="pf-vip-name">${pfIc('crown')}<b>VIP ${sel}</b></div><small>🔒 غير مفعّل</small></div>
          <svg viewBox="0 0 120 130"><use href="#pf-crownshield"/></svg>
        </div>
        <div class="pf-vip-cnt"><i></i>امتيازات حصرية <b>${[5, 9, 13, 19, 25, 31, 38][sel - 1]}/${total[sel - 1]}</b></div>
        <div class="pf-vip-list"><h4>اظهر حالتك</h4>${feats.map(f => {
          const ok = sel >= f[3];
          return `<div class="f ${ok ? '' : 'lock'}"><span class="ic">${f[0]}</span><div><b>${f[1]}</b><small>${f[2]}</small></div><em>${ok ? '✔' : '🔒'}</em></div>`;
        }).join('')}</div>`;
      el.querySelector('.pf-vip-bar').innerHTML = `<button type="button" class="pf-gold-btn" id="pf-vip-buy">شراء</button><div class="pf-vip-price"><span class="g">${pfIc('crystal')}</span>${price[sel - 1]} / 30 يوم</div>`;
      el.querySelector('#pf-vip-buy').onclick = () => {
        const d = Number((state.currentUser || {}).diamonds) || 0;
        if (d < price[sel - 1]) { showToast('رصيد الكريستال غير كافٍ'); pfOpenWallet('crystal'); } else pfSoon();
      };
    };
    paint();
  }

  // ---------- 4) الامبراطورية ----------
  const PF_EMPIRES = [
    { id: 'E1001', name: 'إمبراطورية النجوم', n: 149, cap: 150, p1: 52, p2: 50, d: 'في زحام هذا العالم، الأصدقاء هم النجوم', e: '🌟', c: '#6b2cd1' },
    { id: 'E1002', name: 'فرسان الليل', n: 105, cap: 150, d: 'لا يغريني مدح ولا يسقطني النقد', e: '🦅', c: '#b8860b' },
    { id: 'E1003', name: 'الجدعان', n: 5, cap: 100, d: 'عامل الناس كما تحب أن تعامل', e: '🛡️', c: '#1f6f8b' },
    { id: 'E1004', name: 'واحة الأصدقاء', n: 139, cap: 150, d: 'أهلاً بالجميع في إمبراطوريتنا', e: '🌴', c: '#2e8b57' },
    { id: 'E1005', name: 'نادين', n: 56, cap: 100, d: 'أهلاً بجميع', e: '💫', c: '#a23b72' },
    { id: 'E1006', name: 'نسيم الروح', n: 54, cap: 150, p1: 69, p2: 44, d: 'سلام ومحبة', e: '🔥', c: '#c2410c' },
    { id: 'E1007', name: 'الصقور', n: 28, cap: 100, d: 'هنا تجتمع الهمم', e: '🦅', c: '#4338ca' }
  ];
  function pfOpenEmpire() {
    if (!requireAuth()) return;
    pfSprite(); pfSprite2();
    let active = 'nom';
    const joined = new Set(JSON.parse(sessionStorage.getItem('pf_empires') || '[]'));
    const el = pfPage({
      id: 'pf-empire-page', cls: 'pf-emp', titleAlign: 'right', title: '<div class="pf-head-tabs"></div>',
      actionHtml: `<button type="button" class="pf-ico-btn" data-soon>${PF_Q}</button>`,
      body: '<div class="pf-emp-body"></div><div class="pf-emp-bar"><button type="button" class="pf-emp-quick">انضم الآن بسرعة ⚡</button><button type="button" class="pf-emp-new">إنشاء 🏠</button></div>'
    });
    el.querySelector('[data-soon]').onclick = pfSoon;
    const join = (e) => {
      if (joined.has(e.id)) { showToast('أنت منضم لهذه الإمبراطورية'); return; }
      if (e.n >= e.cap) { showToast('الإمبراطورية ممتلئة'); return; }
      joined.add(e.id); e.n++; sessionStorage.setItem('pf_empires', JSON.stringify([...joined]));
      showToast(`تم الانضمام إلى ${e.name} 🎉`); paint();
    };
    el.querySelector('.pf-emp-quick').onclick = () => { const e = PF_EMPIRES.find(x => x.n < x.cap && !joined.has(x.id)); e ? join(e) : showToast('لا توجد إمبراطورية متاحة الآن'); };
    el.querySelector('.pf-emp-new').onclick = pfSoon;
    const paint = () => {
      el.querySelector('.pf-head-tabs').innerHTML = `<button type="button" class="pf-tab ${active === 'nom' ? 'active' : ''}" data-t="nom">ترشيحات</button><button type="button" class="pf-tab ${active === 'pow' ? 'active' : ''}" data-t="pow">جدول القوة</button>`;
      el.querySelectorAll('.pf-head-tabs .pf-tab').forEach(b => b.onclick = () => { active = b.dataset.t; paint(); });
      const body = el.querySelector('.pf-emp-body');
      if (active === 'nom') {
        body.innerHTML = `<div class="pf-search">${PF_SEARCH}<input type="text" placeholder="ابحث عن اسم العائلة أو الـID" /></div><div class="pf-emp-h">الامبراطوريات الاقوى</div><div class="pf-emp-list"></div>`;
        const input = body.querySelector('input'), list = body.querySelector('.pf-emp-list');
        const draw = () => {
          const q = input.value.trim().toLowerCase();
          const rows = PF_EMPIRES.filter(e => !q || e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q));
          list.innerHTML = rows.length ? rows.map(e => `
            <div class="pf-emp-card">
              <button type="button" class="pf-emp-join ${joined.has(e.id) ? 'on' : ''}" data-id="${e.id}">${joined.has(e.id) ? 'منضم' : 'انضم'}</button>
              <div class="tx"><div class="nm"><b>${fEsc(e.name)}</b><span class="bd">${pfTriSvg('', 18)}</span></div>
                <div class="pills"><span class="pl">👤 ${e.n}/${e.cap}</span>${e.p2 ? `<span class="pl">${e.p2}%</span>` : ''}${e.p1 ? `<span class="pl dim">${e.p1}%</span>` : ''}</div>
                <small>${fEsc(e.d)}</small></div>
              <div class="av" style="background:linear-gradient(135deg,${e.c},#0b0b12)">${e.e}</div>
            </div>`).join('') : '<div class="pf-empty">لا توجد نتائج</div>';
          list.querySelectorAll('.pf-emp-join').forEach(b => b.onclick = () => join(PF_EMPIRES.find(x => x.id === b.dataset.id)));
        };
        input.oninput = draw; draw();
      } else {
        const ranked = [...PF_EMPIRES].sort((a, b) => (b.n * 1000 + b.cap) - (a.n * 1000 + a.cap));
        body.innerHTML = `<div class="pf-emp-h">ترتيب القوة</div><div class="pf-emp-list">${ranked.map((e, k) => `
          <div class="pf-emp-card"><span class="pf-rank r${k + 1}">${k + 1}</span><div class="tx"><div class="nm"><b>${fEsc(e.name)}</b></div><small>القوة ${pfFmt(e.n * 1250)} · الأعضاء ${e.n}/${e.cap}</small></div><div class="av" style="background:linear-gradient(135deg,${e.c},#0b0b12)">${e.e}</div></div>`).join('')}</div>`;
      }
    };
    paint();
  }

  // ---------- المهام (مهام الحضور) — بنفس تصميم الفيديو ----------
  const PF_TK_DAY_MS = 24 * 60 * 60 * 1000;
  const PF_TK_CUM = { 5: 10, 7: 20 }; // مكافآت تراكمية (ألماس) — نفس القيم في الخادم
  const PF_TK_ORN = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2l2.2 6.3L21 9l-5 4.2L17.5 20 12 16.4 6.5 20 8 13.2 3 9l6.8-.7z"/></svg>';
  const PF_TK_FEATHER = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20 3c-7 0-13 4-14 11l-2 7 1 .5 3-4c6 0 11-4 12-14.5zM9 13c3-1 6-3 8-6-1 4-4 7-8 8z"/></svg>';

  // حالة الحضور من بيانات المستخدم: اليوم الحالي في الدورة + هل الاستلام متاح + بداية الدورة
  function pfCheckinState(u) {
    const now = Date.now();
    const cs = u && u.checkin_cycle_start ? Date.parse(u.checkin_cycle_start) : NaN;
    const alive = Number.isFinite(cs) && now < cs + 7 * PF_TK_DAY_MS;
    const last = u && u.last_checkin ? Date.parse(u.last_checkin) : NaN;
    const canClaim = !Number.isFinite(last) || now - last >= PF_TK_DAY_MS;
    let streak = alive ? Math.min(7, parseInt(u.checkin_streak, 10) || 0) : 0;
    let cycleAlive = alive;
    // بعد إتمام اليوم السابع يبدأ الاستلام التالي دورة جديدة من اليوم الأول
    if (streak >= 7 && canClaim) { streak = 0; cycleAlive = false; }
    return {
      streak, canClaim,
      endsAt: cycleAlive ? cs + 7 * PF_TK_DAY_MS : null,
      hoursLeft: Number.isFinite(last) ? Math.max(1, Math.ceil((PF_TK_DAY_MS - (now - last)) / 3600000)) : 0
    };
  }

  function pfOpenTasks() {
    if (!requireAuth()) return;
    const el = pfPage({
      id: 'pf-tasks-page', cls: 'pf-tk', title: '',
      body: `
        <div class="pf-tk-plate">
          <div class="pf-tk-title"><i>${PF_TK_FEATHER}</i>مهام الحضور<i class="r">${PF_TK_FEATHER}</i></div>
          <div class="pf-tk-timer"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2" stroke-linecap="round"/></svg><span class="pf-tk-time">--</span></div>
        </div>
        <div class="pf-tk-box">
          <div class="pf-tk-h">${PF_TK_ORN}<span>تسجيل الحضور</span>${PF_TK_ORN}</div>
          <div class="pf-tk-sub">قم بتسجيل الدخول كل يوم لتحصل على مكافآت نادرة</div>
          <div class="pf-tk-days"></div>
        </div>
        <div class="pf-tk-box">
          <div class="pf-tk-h"><button type="button" class="pf-tk-help" aria-label="مساعدة">?</button>${PF_TK_ORN}<span>المكافآت التراكمية</span>${PF_TK_ORN}</div>
          <div class="pf-tk-line"></div>
        </div>`
    });
    el.querySelector('.pf-tk-help').onclick = () => showNiceNotice({ type: 'info', icon: '🎁', title: 'المكافآت التراكمية', message: 'سجّل حضورك لعدة أيام لتحصل على ألماسات إضافية: +10 عند اليوم الخامس و +20 عند اليوم السابع.' });

    const daysEl = el.querySelector('.pf-tk-days');
    const lineEl = el.querySelector('.pf-tk-line');
    const timeEl = el.querySelector('.pf-tk-time');
    const pad = (n) => String(n).padStart(2, '0');
    let busy = false;

    const tick = () => {
      if (!el.isConnected) { clearInterval(timer); return; }
      const st = pfCheckinState(state.currentUser);
      const left = Math.max(0, (st.endsAt || (Date.now() + 7 * PF_TK_DAY_MS)) - Date.now());
      const d = Math.floor(left / PF_TK_DAY_MS), h = Math.floor(left % PF_TK_DAY_MS / 3600000), m = Math.floor(left % 3600000 / 60000);
      timeEl.textContent = `${pad(d)} Days ${pad(h)} h ${pad(m)} m`;
    };
    const timer = setInterval(tick, 30000);

    const paint = () => {
      const u = state.currentUser;
      const st = pfCheckinState(u);
      const coins = Number((window.__walletBonus && window.__walletBonus.coins) || 500);
      const dia = Number((window.__walletBonus && window.__walletBonus.diamonds) || 50);
      const cells = [1, 2, 3, 4, 5, 6, 7].map(n => {
        const claimed = n <= st.streak;
        const isNext = n === st.streak + 1 && st.canClaim;
        const mult = n === 7 ? 2 : 1;
        const rewardIcon = n === 7 ? '🎁' : (n % 2 ? '🪙' : '💎');
        const amount = n === 7 ? `🪙${(coins * mult).toLocaleString('en-US')}` : (n % 2 ? `${(coins).toLocaleString('en-US')}` : `${dia.toLocaleString('en-US')}`);
        return `
          <button type="button" class="pf-tk-day d${n} ${claimed ? 'done' : ''} ${isNext ? 'next' : ''}" data-n="${n}">
            <span class="dn">اليوم الـ ${toArabicNumerals(n)}</span>
            <span class="di">${claimed ? '<svg viewBox="0 0 24 24" width="38" height="38"><circle cx="12" cy="12" r="10.5" fill="none" stroke="#f3c969" stroke-width="1.6"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#f3c969" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : rewardIcon}</span>
            ${isNext ? '<span class="pf-tk-now">نشيط</span>' : ''}
            <span class="dx">×${amount}</span>
          </button>`;
      }).join('');
      daysEl.innerHTML = cells;

      const pos = (n) => ((n - 1) / 6) * 100; // من اليمين (اليوم 1) إلى اليسار (اليوم 7)
      const fill = st.streak <= 1 ? 0 : pos(st.streak);
      lineEl.innerHTML = `
        <div class="bar"><i style="width:${fill}%"></i></div>
        ${[1, 2, 3, 4, 5, 6, 7].map(n => `<span class="dot ${n <= st.streak ? 'on' : ''}" style="right:${pos(n)}%"></span>`).join('')}
        ${[5, 7].map(n => `<span class="chip ${n <= st.streak ? 'on' : ''}" style="right:${pos(n)}%">💎 ${PF_TK_CUM[n]}</span>`).join('')}
        <span class="lbl" style="right:0">Day 1</span><span class="lbl" style="right:${pos(5)}%">Day 5</span><span class="lbl" style="right:${pos(7)}%">Day 7</span>`;
      tick();
    };

    daysEl.onclick = async (e) => {
      const b = e.target.closest('.pf-tk-day');
      if (!b || busy) return;
      const st = pfCheckinState(state.currentUser);
      if (!b.classList.contains('next')) {
        if (b.classList.contains('done')) { showToast('استلمت مكافأة هذا اليوم بالفعل ✅'); }
        else if (!st.canClaim) { showToast(`لقد استلمت مكافأتك بالفعل! عُد بعد ${st.hoursLeft} ساعة للحصول على مكافأة جديدة 🎁`); }
        else { showToast('سجّل حضورك بالترتيب، لم يحن موعد هذا اليوم بعد'); }
        return;
      }
      busy = true;
      await handleDailyCheckIn();
      busy = false;
      if (el.isConnected) paint();
    };

    paint();
    // مبلغ المكافأة الفعلي من إعدادات الإدارة
    fetch('/api/settings/wallet').then(r => r.ok ? r.json() : null).then(d => {
      if (!d || !d.settings || !el.isConnected) return;
      window.__walletBonus = { coins: d.settings.daily_bonus_coins, diamonds: d.settings.daily_bonus_diamonds };
      paint();
    }).catch(() => {});
  }

  function renderFramesStoreHtml(currentFrame) {
    const frames = [
      { id: 'imperial_owner', name: 'عرش الإمبراطور', icon: '👑✨' },
      { id: 'galaxy_halo', name: 'هالة المجرة', icon: '🌌' },
      { id: 'cyber_neon', name: 'سايبر نيون', icon: '⚡' },
      { id: 'royal_gold', name: 'التاج الملكي', icon: '👑' },
      { id: 'fire_dragon', name: 'تنين اللهب', icon: '🔥' },
      { id: 'angel_wings', name: 'أجنحة الملاك', icon: '🪽' },
      { id: 'cosmic_ring', name: 'خاتم السول', icon: '🪐' }
    ];

    return frames.map(f => {
      const isEquipped = currentFrame === f.id;
      return `
        <div class="frame-shelf-item ${isEquipped ? 'equipped' : ''}" data-frame-id="${f.id}">
          <div style="font-size: 24px; margin-bottom: 4px;">${f.icon}</div>
          <div class="frame-shelf-name">${f.name}</div>
          <div class="frame-shelf-status">${isEquipped ? 'مفعل الآن' : 'تفعيل'}</div>
        </div>
      `;
    }).join('');
  }

  async function equipAvatarFrame(frameId) {
    if (!requireAuth()) return;
    try {
      const res = await fetch('/api/users/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': state.currentUser.id
        },
        body: JSON.stringify({ avatar_frame: frameId })
      });
      const data = await res.json();
      if (data.success) {
        state.currentUser = data.user;
        localStorage.setItem('soulchill_user', JSON.stringify(data.user));
        updateHeaderUI();
        if (state.currentTab === 'profile') {
          renderProfileTab(document.getElementById('app-main-content'));
        }
        if (window.soundManager) window.soundManager.playGiftSound(false);
        showToast('تم تفعيل إطار الأفاتار بنجاح! 👑✨');
      }
    } catch (err) {
      console.error('Error equipping frame:', err);
    }
  }

  // Daily Check-in Claim
  async function handleDailyCheckIn() {
    if (!requireAuth()) return false;
    try {
      const res = await fetch('/api/users/checkin', {
        method: 'POST',
        headers: { 'x-user-id': state.currentUser.id }
      });
      const data = await res.json();
      if (data.success) {
        state.currentUser = data.user;
        localStorage.setItem('soulchill_user', JSON.stringify(data.user));
        updateHeaderUI();
        if (window.soundManager) window.soundManager.playCheer();
        showToast(data.message);
        if (state.currentTab === 'profile') {
          renderProfileTab(document.getElementById('app-main-content'));
        }
        return true;
      }
      showToast(data.message);
    } catch (err) {
      console.error('Checkin error:', err);
    }
    return false;
  }

  // ============================================
  // الشحن عن طريق الدردشة: المستخدم يطلب، والإدارة تشحن من نفس المحادثة
  // ============================================
  async function showChatRechargeModal() {
    const old = document.getElementById('chat-recharge-modal');
    if (old) old.remove();
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'chat-recharge-modal';
    modal.innerHTML = `
      <div class="soul-modal-content">
        <button class="soul-modal-close-btn" id="cr-close">✕</button>
        <div class="modal-header-title">💳 شحن الرصيد عبر الدردشة</div>
        <p style="font-size:12px;color:var(--text-secondary);line-height:1.7;margin:10px 0 14px;">
          اختر ما تريد شحنه وسيصل طلبك في محادثة مباشرة إلى وكيل الشحن، وبعد التأكيد يضاف الرصيد إلى حسابك فوراً.
        </p>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <button class="google-account-option" data-c="1500" data-d="0" style="justify-content:space-between;"><span>🪙 1,500 عملة</span><span style="color:#fbbf24;font-weight:800;">اطلب</span></button>
          <button class="google-account-option" data-c="0" data-d="1000" style="justify-content:space-between;"><span>💎 1,000 ألماسة</span><span style="color:#38bdf8;font-weight:800;">اطلب</span></button>
          <button class="google-account-option" data-c="10000" data-d="5000" style="justify-content:space-between;"><span>👑 10,000 🪙 + 5,000 💎</span><span style="color:#fbbf24;font-weight:800;">اطلب</span></button>
          <button class="google-account-option" data-c="0" data-d="0" style="justify-content:space-between;"><span>✍️ كمية أخرى</span><span style="color:#a78bfa;font-weight:800;">تحدث مع الوكيل</span></button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#cr-close').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    modal.querySelectorAll('.google-account-option').forEach(btn => {
      btn.onclick = async () => {
        const coins = Number(btn.dataset.c), diamonds = Number(btn.dataset.d);
        btn.disabled = true;
        let agent = null;
        try {
          const res = await fetch('/api/wallet/agent');
          const data = await res.json();
          if (data.success) agent = data.agent;
          else showToast(data.message || 'لا يوجد وكيل شحن متاح حالياً');
        } catch (e) { showToast('تعذر الاتصال بالسيرفر'); }
        btn.disabled = false;
        if (!agent) return;
        if (agent.id === state.currentUser.id) { showToast('أنت وكيل الشحن بنفسك 😄'); return; }

        if (coins || diamonds) {
          const parts = [];
          if (coins) parts.push(`${coins.toLocaleString('en-US')} عملة`);
          if (diamonds) parts.push(`${diamonds.toLocaleString('en-US')} ألماس`);
          try {
            await fetch('/api/messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-user-id': state.currentUser.id },
              body: JSON.stringify({
                receiver_id: agent.id, message_type: 'text',
                content: `💳 طلب شحن: ${parts.join(' + ')}\nمعرّفي: ${state.currentUser.id}`,
                metadata: { kind: 'recharge_request', coins, diamonds }
              })
            });
          } catch (e) { /* يفتح المحادثة حتى لو فشل إرسال الطلب التلقائي */ }
        }
        modal.remove();
        openDirectChatWithUser(agent);
      };
    });
  }

  // نافذة شحن مستخدم من داخل الدردشة (للإدارة)
  function showAdminChatCreditModal(partner) {
    const old = document.getElementById('admin-chat-credit-modal');
    if (old) old.remove();
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'admin-chat-credit-modal';
    modal.style.zIndex = '1400';
    modal.innerHTML = `
      <div class="soul-modal-content">
        <button class="soul-modal-close-btn" id="acc-close">✕</button>
        <div class="modal-header-title">💳 شحن رصيد ${fEsc(partner.name)}</div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:14px;">
          <label style="font-size:12px;color:var(--text-secondary);">🪙 عملات تُضاف
            <input type="number" id="acc-coins" min="0" value="0" style="width:100%;margin-top:4px;padding:9px 12px;border-radius:10px;border:1px solid var(--border-glass);background:rgba(255,255,255,.06);color:#fff;" /></label>
          <label style="font-size:12px;color:var(--text-secondary);">💎 ألماس يُضاف
            <input type="number" id="acc-diamonds" min="0" value="0" style="width:100%;margin-top:4px;padding:9px 12px;border-radius:10px;border:1px solid var(--border-glass);background:rgba(255,255,255,.06);color:#fff;" /></label>
          <button class="google-official-primary-btn" id="acc-submit" style="justify-content:center;">تأكيد الشحن ✅</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#acc-close').onclick = () => modal.remove();
    modal.querySelector('#acc-submit').onclick = async (e) => {
      const coins = Math.floor(Number(modal.querySelector('#acc-coins').value || 0));
      const diamonds = Math.floor(Number(modal.querySelector('#acc-diamonds').value || 0));
      if (!(coins > 0 || diamonds > 0)) { showToast('أدخل كمية صحيحة'); return; }
      e.target.disabled = true;
      try {
        const res = await fetch('/api/wallet/chat-credit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-id': state.currentUser.id },
          body: JSON.stringify({ target_id: partner.id, coins, diamonds })
        });
        const data = await res.json();
        if (data.success) {
          showToast(`✅ تم شحن ${partner.name}`);
          modal.remove();
          if (typeof loadDirectChatHistory === 'function' && state.currentChatPartner && state.currentChatPartner.id === partner.id) {
            await loadDirectChatHistory(partner.id);
          }
        } else {
          showToast(data.message || 'تعذر تنفيذ الشحن');
          e.target.disabled = false;
        }
      } catch (err) { showToast('تعذر الاتصال بالسيرفر'); e.target.disabled = false; }
    };
  }

  // Top-up Simulated Modal
  function showTopUpModal() {
    if (!requireAuth()) return;
    if (state.walletSettings && !state.walletSettings.user_recharge_enabled) {
      showChatRechargeModal();
      return;
    }
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'topup-modal';
    modal.innerHTML = `
      <div class="soul-modal-content">
        <button class="soul-modal-close-btn" id="close-topup-btn">✕</button>
        <div class="modal-header-title">⚡ شحن محفظة SoulChill الفاخرة</div>

        <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 14px;">
          <button class="google-account-option" id="topup-opt-1" style="justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 24px;">🪙</span>
              <div>
                <div style="font-weight: 700; color: #fff;">باقة 1,500 عملة سول</div>
                <div style="font-size: 11px; color: var(--text-secondary);">مناسبة للهدايا اليومية والشات</div>
              </div>
            </div>
            <span style="color: #fbbf24; font-weight: 800;">مجاناً للتجربة ✨</span>
          </button>

          <button class="google-account-option" id="topup-opt-2" style="justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 24px;">💎</span>
              <div>
                <div style="font-weight: 700; color: #fff;">باقة 1,000 ألماسة ملكية</div>
                <div style="font-size: 11px; color: var(--text-secondary);">لإرسال السيارات الفارهة والصواريخ</div>
              </div>
            </div>
            <span style="color: #38bdf8; font-weight: 800;">مجاناً للتجربة ✨</span>
          </button>

          <button class="google-account-option" id="topup-opt-3" style="justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 24px;">👑</span>
              <div>
                <div style="font-weight: 700; color: #fff;">الباقة الإمبراطورية (5,000 💎 + 10,000 🪙)</div>
                <div style="font-size: 11px; color: var(--text-secondary);">تمنحك لقب الداعم الأكبر في الرومات</div>
              </div>
            </div>
            <span style="color: #fbbf24; font-weight: 800;">VIP مجاناً ✨</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-topup-btn').onclick = () => modal.remove();

    const doRecharge = async (coins, diamonds) => {
      try {
        const res = await fetch('/api/users/recharge', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': state.currentUser.id
          },
          body: JSON.stringify({ amountCoins: coins, amountDiamonds: diamonds })
        });
        const data = await res.json();
        if (data.success) {
          state.currentUser = data.user;
          localStorage.setItem('soulchill_user', JSON.stringify(data.user));
          updateHeaderUI();
          if (window.soundManager) window.soundManager.playCheer();
          showToast(`تم شحن ${coins} عملة و ${diamonds} ألماسة بنجاح! 💎🪙`);
          modal.remove();
          if (state.currentTab === 'profile') {
            renderProfileTab(document.getElementById('app-main-content'));
          }
        } else if (data.message) {
          showToast(data.message);
        }
      } catch (err) {
        console.error('Recharge error:', err);
      }
    };

    modal.querySelector('#topup-opt-1').onclick = () => doRecharge(1500, 0);
    modal.querySelector('#topup-opt-2').onclick = () => doRecharge(0, 1000);
    modal.querySelector('#topup-opt-3').onclick = () => doRecharge(10000, 5000);
  }

  // Edit Profile Modal
  function showEditProfileModal() {
    if (!requireAuth()) return;
    const user = state.currentUser;
    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'edit-profile-modal';
    modal.innerHTML = `
      <div class="soul-modal-content">
        <button class="soul-modal-close-btn" id="close-edit-profile-btn">✕</button>
        <div class="modal-header-title">✏️ تعديل الملف الشخصي</div>

        <!-- Quick Avatar Change Row in Profile Editor -->
        <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.06); padding: 10px 14px; border-radius: 12px; margin-top: 10px; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <img src="${user.avatar}" class="google-account-avatar ${user.avatar_frame ? 'avatar-frame-' + user.avatar_frame : ''}" id="edit-profile-avatar-thumb" />
            <div>
              <div style="font-size: 13px; font-weight: 700; color: #fff;">الصورة الشخصية</div>
              <div style="font-size: 11px; color: var(--text-secondary);">رفع من جهازك أو اختيار أفاتار</div>
            </div>
          </div>
          <button type="button" class="wallet-btn secondary" id="btn-edit-avatar-from-edit-modal" style="padding: 5px 12px; font-size: 12px;">
            <span>📷</span> تغيير الصورة
          </button>
        </div>

        <div class="custom-google-login-form">
          <div class="form-group-soul">
            <label>الاسم المستعار</label>
            <input type="text" id="edit-profile-name" class="form-input-soul" value="${user.name}" />
          </div>

          <div class="form-group-soul">
            <label>النبذة الشخصية (Bio)</label>
            <input type="text" id="edit-profile-bio" class="form-input-soul" value="${user.bio || ''}" />
          </div>

          <div class="form-group-soul">
            <label>العمر</label>
            <input type="number" id="edit-profile-age" class="form-input-soul" value="${user.age || 22}" />
          </div>

          <div class="form-group-soul">
            <label>الدولة</label>
            <select id="edit-profile-country" class="form-input-soul" style="background: rgba(255,255,255,0.08); color: #fff;">
              ${(state.countriesList || []).filter(c => !c.isGlobal).map(c => `
                <option value="${c.code}" ${(user.country_code || state.myGeo?.country_code || 'JO') === c.code ? 'selected' : ''}>${c.name}</option>
              `).join('')}
            </select>
          </div>

          <div class="form-group-soul">
            <label>اهتمامات الروح (Soul Tags مفصولة بفواصل)</label>
            <input type="text" id="edit-profile-tags" class="form-input-soul" value="${user.soul_tags || 'موسيقى,هدوء,سفر'}" />
          </div>

          <button class="soul-submit-btn" id="save-profile-btn" style="margin-top: 10px;">
            حفظ التعديلات 💾
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-edit-profile-btn').onclick = () => modal.remove();

    const changeAvatarBtn = modal.querySelector('#btn-edit-avatar-from-edit-modal');
    if (changeAvatarBtn) {
      changeAvatarBtn.onclick = () => {
        showChangeAvatarModal();
      };
    }

    modal.querySelector('#save-profile-btn').onclick = async () => {
      const name = modal.querySelector('#edit-profile-name').value.trim();
      const bio = modal.querySelector('#edit-profile-bio').value.trim();
      const age = parseInt(modal.querySelector('#edit-profile-age').value) || 22;
      const soul_tags = modal.querySelector('#edit-profile-tags').value.trim();
      const country_code = modal.querySelector('#edit-profile-country')?.value;

      try {
        const res = await fetch('/api/users/profile', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': state.currentUser.id
          },
          body: JSON.stringify({ name, bio, age, soul_tags, country_code })
        });
        const data = await res.json();
        if (data.success) {
          state.currentUser = data.user;
          localStorage.setItem('soulchill_user', JSON.stringify(data.user));
          updateHeaderUI();
          showToast('تم حفظ الملف الشخصي بنجاح! ✨');
          modal.remove();
          if (state.currentTab === 'profile') {
            renderProfileTab(document.getElementById('app-main-content'));
          }
        } else {
          showToast(data.error || 'تعذر حفظ الملف الشخصي');
        }
      } catch (err) {
        console.error('Error updating profile:', err);
      }
    };
  }

  // Sign out & Account Switching
  function handleSignOut() {
    // Clear stored active session credentials
    localStorage.removeItem('soulchill_user');
    localStorage.removeItem('soulchill_token');
    localStorage.removeItem('soulchill_user_id');
    localStorage.removeItem('soulchill_device_persistent');
    localStorage.removeItem('soulchill_auth_email');

    // Notify backend socket session
    if (state.socket) {
      state.socket.emit('user_disconnect');
    }

    // Leave any open voice room or modal
    leaveActiveVoiceRoom();
    hideModal('google-auth-modal');
    hideModal('user-edit-profile-modal');
    hideModal('gift-store-modal');

    state.currentUser = null;
    state.token = null;
    state.userSeatIndex = null;

    updateHeaderUI();
    switchTab('planet');

    showToast('تم تسجيل الخروج بنجاح. يرجى اختيار حسابك المسجل أو الدخول بجيميل جديد 🌟');

    setTimeout(() => {
      showGoogleLoginModal();
    }, 250);
  }

  // ============================================
  // LUXURY GIFTS STORE MODAL
  // ============================================
  async function loadGiftsCatalogue() {
    try {
      const res = await fetch('/api/gifts');
      state.gifts = await res.json();
    } catch (err) {
      console.error('Error loading gifts:', err);
    }
  }

  const GIFT_TABS = [
    { id: 'popular', label: 'المتداول' },
    { id: 'luck', label: 'الحظ' },
    { id: 'events', label: 'الأنشطة' },
    { id: 'empire', label: 'الإمبراطورية' },
    { id: 'celebs', label: 'المشاهير' }
  ];

  function openGiftStoreModal(receiverId = null, roomId = null, targetUser = null) {
    if (!requireAuth()) return;
    let selectedGift = state.gifts.find(g => (g.tab || 'popular') === 'popular') || state.gifts[0] || null;
    let currentReceiverId = receiverId || (targetUser && targetUser.id ? targetUser.id : null);
    let currentTargetUser = targetUser || null;

    // Build list of available recipients in the room (Host + Mic Seats + Audience + Users)
    const recipientsMap = new Map();
    const addRecipientCandidate = (u, roleTag) => {
      if (!u || !u.id) return;
      if (!recipientsMap.has(u.id)) {
        recipientsMap.set(u.id, {
          id: u.id,
          name: u.name || 'عضو الغرفة',
          avatar: u.avatar || '/avatars/avatar-1.png',
          roleTag: roleTag || '👤 عضو'
        });
      }
    };

    if (currentTargetUser && currentReceiverId) {
      addRecipientCandidate({ id: currentReceiverId, name: currentTargetUser.name, avatar: currentTargetUser.avatar }, '🎁 المستلم');
    }

    if (state.activeRoom) {
      if (state.activeRoom.host_id) {
        addRecipientCandidate({
          id: state.activeRoom.host_id,
          name: state.activeRoom.host_name || 'مضيف الغرفة',
          avatar: state.activeRoom.host_avatar || '/avatars/avatar-1.png'
        }, '👑 المضيف');
      }
      (state.activeRoom.seats || []).forEach(s => {
        if (s && s.user_id) {
          addRecipientCandidate({
            id: s.user_id,
            name: s.name,
            avatar: s.avatar
          }, s.seat_index === 0 ? '👑 المضيف' : `🎙️ مايك #${s.seat_index}`);
        }
      });
      (state.activeRoomAudience || []).forEach(v => {
        if (v && v.id) {
          const isHost = state.activeRoom && v.id === state.activeRoom.host_id;
          addRecipientCandidate({
            id: v.id,
            name: v.name,
            avatar: v.avatar
          }, isHost ? '👑 المضيف' : '👤 مستمع');
        }
      });
    }

    // Also include online users if list is small or outside a room
    (state.allUsers || []).forEach(u => {
      if (u && u.id && (!state.currentUser || u.id !== state.currentUser.id)) {
        if (recipientsMap.size < 12) {
          addRecipientCandidate(u, '🪐 صديق');
        }
      }
    });

    // Put other users before current user
    const allRecipients = Array.from(recipientsMap.values()).sort((a, b) => {
      const aIsSelf = state.currentUser && a.id === state.currentUser.id ? 1 : 0;
      const bIsSelf = state.currentUser && b.id === state.currentUser.id ? 1 : 0;
      return aIsSelf - bIsSelf;
    });

    if (currentReceiverId && !currentTargetUser) {
      currentTargetUser = recipientsMap.get(currentReceiverId) || null;
    }

    // Check if we are in a live video broadcast with an active co-host (PK)
    const hasCohostPk = state.activeRoom && state.activeRoom.room_type === 'video' && state.activeCohostUser;
    let selectedTargetTeam = 'host';
    if (hasCohostPk) {
      if (receiverId && state.activeCohostUser && receiverId === state.activeCohostUser.id) {
        selectedTargetTeam = 'challenger';
        currentReceiverId = state.activeCohostUser.id;
        currentTargetUser = { name: state.activeCohostUser.name, id: state.activeCohostUser.id, avatar: state.activeCohostUser.avatar };
      } else {
        selectedTargetTeam = 'host';
        currentReceiverId = state.activeRoom.host_id;
        currentTargetUser = { name: state.activeRoom.host_name, id: state.activeRoom.host_id, avatar: state.activeRoom.host_avatar };
      }
    }

    const existingModal = document.getElementById('gift-store-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'gift-store-modal';

    modal.innerHTML = `
      <div class="soul-modal-content gift-sheet-pro" style="max-width: 420px;">
        <button class="soul-modal-close-btn" id="close-gifts-modal-btn">✕</button>
        <div class="gift-banner-pro"><span>نشاط برج الميزان</span></div>
        <div class="modal-header-title">
          🎁 متجر الهدايا الفاخرة
          <div style="font-size: 11px; color: var(--text-secondary); font-weight: 600;" id="gift-modal-target-desc">
            ${currentTargetUser ? `الإهداء إلى: 🎁 ${currentTargetUser.name}` : 'يرجى تحديد الشخص المستلم للهدية من القائمة أدناه 👇'}
          </div>
        </div>

        ${hasCohostPk ? `
          <div style="background: rgba(0,0,0,0.35); border-radius: 12px; padding: 8px 10px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.12);">
            <div style="font-size: 11px; font-weight: 800; color: #fbbf24; text-align: center; margin-bottom: 6px;">
              🎁 اختر من تريد إهداءه ودعمه في البث المباشر (تزيد نقاطه في التحدي):
            </div>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="wallet-btn ${selectedTargetTeam === 'host' ? 'primary' : 'secondary'}" id="gift-target-host-btn" style="flex: 1; padding: 7px 4px; font-size: 11px;">
                🔴 المضيف: ${state.activeRoom.host_name || 'المضيف'}
              </button>
              <button type="button" class="wallet-btn ${selectedTargetTeam === 'challenger' ? 'primary' : 'secondary'}" id="gift-target-challenger-btn" style="flex: 1; padding: 7px 4px; font-size: 11px;">
                🔵 الشريك: ${state.activeCohostUser.name}
              </button>
            </div>
          </div>
        ` : `
          <!-- Recipient Person Selector (تحديد الشخص المستلم للهدية) -->
          <div class="gift-recipient-selector-box" id="gift-recipient-selector-box">
            <div class="gift-recipient-header">
              <span>👤 حدد الشخص المستلم للهدية:</span>
              <span class="gift-selected-person-pill ${currentTargetUser ? 'has-target' : ''}" id="gift-selected-person-pill">
                ${currentTargetUser ? `✅ ${currentTargetUser.name}` : '⚠️ لم يتم التحديد'}
              </span>
            </div>
            <div class="gift-recipients-track" id="gift-recipients-track">
              ${allRecipients.map(p => `
                <div class="gift-recipient-chip ${currentReceiverId === p.id ? 'selected' : ''}" data-user-id="${p.id}" data-user-name="${p.name}" data-user-avatar="${p.avatar}">
                  <div class="gift-recipient-avatar-wrap">
                    <img src="${p.avatar}" onerror="this.src='/avatars/avatar-1.png'" />
                    <span class="gift-recipient-check">✓</span>
                  </div>
                  <div class="gift-recipient-info">
                    <div class="gift-recipient-name">${p.name}</div>
                    <div class="gift-recipient-role">${p.roleTag}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `}

        <div class="gift-tabs-bar" id="gift-tabs-bar">
          ${GIFT_TABS.map((t, i) => `<button type="button" class="gift-tab-btn ${i === 0 ? 'active' : ''}" data-gift-tab="${t.id}">${t.label}</button>`).join('')}
        </div>
        <div class="gift-shelf-grid" id="gift-shelf-grid"></div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08);">
          <div style="font-size: 12px; color: var(--text-secondary);">
            رصيدك: <strong style="color: #fbbf24;">${state.currentUser.coins} 🪙</strong> | <strong style="color: #38bdf8;">${state.currentUser.diamonds} 💎</strong>
          </div>
          <button class="soul-submit-btn" id="send-gift-action-btn" style="padding: 6px 16px; font-size: 12px;">
            ${currentTargetUser ? `إرسال إلى ${currentTargetUser.name} 🎁` : 'إرسال الهدية 🎁'}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-gifts-modal-btn').onclick = () => modal.remove();

    const descEl = modal.querySelector('#gift-modal-target-desc');
    const selectedPillEl = modal.querySelector('#gift-selected-person-pill');
    const sendBtnEl = modal.querySelector('#send-gift-action-btn');
    const selectorBoxEl = modal.querySelector('#gift-recipient-selector-box');

    // Recipient Chip Clicks
    modal.querySelectorAll('.gift-recipient-chip').forEach(chip => {
      chip.onclick = () => {
        modal.querySelectorAll('.gift-recipient-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        currentReceiverId = chip.dataset.userId;
        currentTargetUser = {
          id: chip.dataset.userId,
          name: chip.dataset.userName,
          avatar: chip.dataset.userAvatar
        };
        if (selectorBoxEl) selectorBoxEl.classList.remove('shake-warning');
        if (descEl) descEl.innerText = `الإهداء إلى: 🎁 ${currentTargetUser.name} (تُحفظ في هداياه)`;
        if (selectedPillEl) {
          selectedPillEl.innerText = `✅ ${currentTargetUser.name}`;
          selectedPillEl.classList.add('has-target');
        }
        if (sendBtnEl) {
          sendBtnEl.innerText = `إرسال إلى ${currentTargetUser.name} 🎁`;
        }
      };
    });

    if (hasCohostPk) {
      const targetHostBtn = modal.querySelector('#gift-target-host-btn');
      const targetChallengerBtn = modal.querySelector('#gift-target-challenger-btn');

      targetHostBtn.onclick = () => {
        selectedTargetTeam = 'host';
        targetHostBtn.className = 'wallet-btn primary';
        targetChallengerBtn.className = 'wallet-btn secondary';
        currentReceiverId = state.activeRoom.host_id;
        currentTargetUser = { name: state.activeRoom.host_name, id: state.activeRoom.host_id };
        if (descEl) descEl.innerText = `الدعم مخصص لـ: 🔴 ${state.activeRoom.host_name}`;
      };

      targetChallengerBtn.onclick = () => {
        selectedTargetTeam = 'challenger';
        targetChallengerBtn.className = 'wallet-btn primary';
        targetHostBtn.className = 'wallet-btn secondary';
        currentReceiverId = state.activeCohostUser.id;
        currentTargetUser = { name: state.activeCohostUser.name, id: state.activeCohostUser.id };
        if (descEl) descEl.innerText = `الدعم مخصص لـ: 🔵 ${state.activeCohostUser.name}`;
      };
    }

    const shelfEl = modal.querySelector('#gift-shelf-grid');
    const renderShelf = (tabId) => {
      const list = state.gifts.filter(g => (g.tab || 'popular') === tabId);
      if (!list.length) {
        shelfEl.innerHTML = '<div class="gift-shelf-empty">لا توجد هدايا في هذا القسم حالياً</div>';
        selectedGift = null;
        return;
      }
      if (!selectedGift || !list.some(g => g.id === selectedGift.id)) selectedGift = list[0];
      shelfEl.innerHTML = list.map(g => `
        <div class="gift-shelf-item ${selectedGift && selectedGift.id === g.id ? 'selected' : ''}" data-gift-id="${g.id}">
          <div class="gift-shelf-icon">${giftIconHtml(g.icon, g.image_url)}</div>
          <div class="gift-shelf-name">${g.name}</div>
          <div class="gift-shelf-price">${g.cost} ${g.currency === 'coins' ? '🪙' : '💎'}</div>
        </div>
      `).join('');
      shelfEl.querySelectorAll('.gift-shelf-item').forEach(item => {
        item.onclick = () => {
          shelfEl.querySelectorAll('.gift-shelf-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
          selectedGift = state.gifts.find(g => g.id === item.dataset.giftId);
        };
      });
    };
    modal.querySelectorAll('.gift-tab-btn').forEach(btn => {
      btn.onclick = () => {
        modal.querySelectorAll('.gift-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderShelf(btn.dataset.giftTab);
      };
    });
    renderShelf('popular');

    modal.querySelector('#send-gift-action-btn').onclick = async () => {
      if (!selectedGift) return;

      if (!currentReceiverId) {
        if (selectorBoxEl) {
          selectorBoxEl.classList.remove('shake-warning');
          void selectorBoxEl.offsetWidth;
          selectorBoxEl.classList.add('shake-warning');
        }
        showToast('⚠️ يرجى تحديد الشخص المستلم للهدية أولاً من القائمة أعلاه! 👤🎁');
        return;
      }

      try {
        const res = await fetch('/api/gifts/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': state.currentUser.id
          },
          body: JSON.stringify({
            receiver_id: currentReceiverId,
            room_id: roomId || (state.activeRoom ? state.activeRoom.id : null),
            gift_id: selectedGift.id
          })
        });

        const data = await res.json();
        if (data.success) {
          state.currentUser = data.sender;
          localStorage.setItem('soulchill_user', JSON.stringify(data.sender));
          updateHeaderUI();

          const finalReceiver = data.receiver || currentTargetUser;

          // Trigger local animation
          if (window.giftEffectsEngine) {
            window.giftEffectsEngine.showGiftAnimation(selectedGift, state.currentUser, finalReceiver);
          }

          // Refresh receiver's gift wall if visible
          if (currentReceiverId) {
            document.querySelectorAll(`.user-received-gifts-box[data-user-id="${currentReceiverId}"]`).forEach(box => {
              loadAndRenderUserGiftsSection(currentReceiverId, box, state.currentUser && state.currentUser.id === currentReceiverId);
            });
          }

          modal.remove();
          showToast(`🎁 أرسلت ${selectedGift.name} ${selectedGift.icon} إلى ${finalReceiver?.name || 'المستلم'} وتم حفظها في هداياه! ✨`);
        } else {
          showToast(data.error || 'فشل إرسال الهدية');
        }
      } catch (err) {
        console.error('Error sending gift:', err);
      }
    };
  }

  // Helpers to persist and retrieve registered accounts on this device
  function getSavedDeviceAccounts() {
    try {
      const raw = localStorage.getItem('soulchill_saved_device_accounts');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(a => a && a.email && a.email.includes('@'));
      }
      return [];
    } catch (e) {
      return [];
    }
  }

  function saveDeviceAccount(user) {
    if (!user || !user.email) return;
    try {
      let accounts = getSavedDeviceAccounts();
      // Remove any existing entry for this email (case-insensitive)
      accounts = accounts.filter(a => a.email.toLowerCase() !== user.email.toLowerCase());
      // Prepend current account to the top
      accounts.unshift({
        id: user.id,
        email: user.email,
        name: user.name || user.email.split('@')[0],
        avatar: user.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(user.name || user.email)}`,
        last_login: Date.now()
      });
      // Keep up to 6 registered accounts on this device
      if (accounts.length > 6) accounts = accounts.slice(0, 6);
      localStorage.setItem('soulchill_saved_device_accounts', JSON.stringify(accounts));
    } catch (e) {
      console.warn('Error saving device account:', e);
    }
  }

  // ============================================
  // تسجيل الدخول: Gmail + رمز تحقق ← اسم مستعار + كلمة مرور
  // وعلى جهاز آخر: اسم مستعار + كلمة مرور فقط
  // ============================================
  function persistLogin(data) {
    state.currentUser = data.user;
    state.token = data.token;
    localStorage.setItem('soulchill_user_id', data.user.id);
    localStorage.setItem('soulchill_user', JSON.stringify(data.user));
    localStorage.setItem('soulchill_token', data.token);
    localStorage.setItem('soulchill_device_persistent', 'true');
    if (data.user.email) localStorage.setItem('soulchill_auth_email', data.user.email);
    try {
      const nick = data.nickname || data.user.name;
      if (nick) localStorage.setItem('soulchill_last_nickname', nick);
    } catch (e) {}
  }

  function showGoogleLoginModal(startMode) {
    let existing = document.getElementById('google-auth-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'google-auth-modal';

    const lastNick = (() => { try { return localStorage.getItem('soulchill_last_nickname') || ''; } catch (e) { return ''; } })();
    const googleG = `<svg class="google-g-icon" viewBox="0 0 24 24" style="width: 22px; height: 22px;">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
    </svg>`;
    const linkBtn = 'background: none; border: none; color: #94a3b8; font-size: 12px; cursor: pointer; text-decoration: underline;';
    const titleStyle = 'font-size: 16px; font-weight: 700; color: #fff; text-align: center; margin-bottom: 4px;';
    const subStyle = 'font-size: 12px; color: var(--text-secondary); text-align: center; margin-bottom: 18px; line-height: 1.5;';

    modal.innerHTML = `
      <div class="soul-modal-content google-auth-card" style="max-width: 420px; position: relative;">
        <button class="soul-modal-close-btn" id="close-google-auth-btn" title="إغلاق">✕</button>

        <div class="google-auth-logo-row" style="margin-bottom: 8px;">
          <div class="brand-logo-icon" style="width: 40px; height: 40px; font-size: 22px;">🪐</div>
          <span style="font-size: 20px; font-weight: 800; color: #fff;">SoulChill</span>
        </div>

        <!-- الشاشة 1: البريد -->
        <div id="auth-step-email">
          <div style="${titleStyle}">تسجيل الدخول</div>
          <p style="${subStyle}">أدخل بريد Gmail وسنرسل لك رمز تحقق من 6 أرقام</p>
          <div class="form-group-soul" style="margin-bottom: 14px;">
            <label>بريد Gmail:</label>
            <input type="email" id="auth-email-input" class="form-input-soul" placeholder="username@gmail.com" autocomplete="email" inputmode="email" dir="ltr" />
          </div>
          <button class="google-official-primary-btn" id="btn-request-gmail-otp" style="margin-bottom: 14px;">
            ${googleG}<span>إرسال رمز التحقق إلى الجيميل 📨</span>
          </button>
          <div style="text-align: center; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.08);">
            <button type="button" id="btn-go-nickname-login" style="${linkBtn}">لدي حساب؟ الدخول بالاسم المستعار وكلمة المرور</button>
          </div>
        </div>

        <!-- الشاشة 2: رمز التحقق -->
        <div id="auth-step-code" style="display: none; text-align: center;">
          <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 12px; padding: 12px; margin-bottom: 14px;">
            <div style="font-size: 14px; font-weight: 700; color: #10b981;">✅ تم إرسال رمز التحقق</div>
            <div style="font-size: 12px; color: #cbd5e1; margin-top: 4px;">تفقد بريدك (وصندوق الرسائل غير المرغوبة): <strong id="auth-target-email" style="color: #fbbf24;" dir="ltr"></strong></div>
          </div>
          <div class="form-group-soul" style="text-align: center;">
            <label style="text-align: center;">أدخل الرمز المكوّن من 6 أرقام:</label>
            <input type="text" id="auth-code-input" class="form-input-soul" maxlength="6" inputmode="numeric" autocomplete="one-time-code" style="text-align: center; font-size: 24px; font-weight: 900; letter-spacing: 8px; color: #fbbf24; background: rgba(0,0,0,0.4);" placeholder="------" />
          </div>
          <button class="soul-submit-btn" id="btn-verify-gmail-otp" style="width: 100%; margin-top: 10px; padding: 13px; font-size: 14px;">تأكيد الرمز ✅</button>
          <div style="display: flex; justify-content: space-between; margin-top: 14px;">
            <button type="button" id="btn-back-to-email" style="${linkBtn}">‹ تغيير البريد</button>
            <button type="button" id="btn-resend-otp" style="${linkBtn}" disabled>إعادة إرسال الرمز</button>
          </div>
        </div>

        <!-- الشاشة 3: الاسم المستعار وكلمة المرور -->
        <div id="auth-step-setup" style="display: none;">
          <div style="${titleStyle}" id="auth-setup-title">أنشئ حسابك</div>
          <p style="${subStyle}" id="auth-setup-sub">تم التحقق من بريدك. اختر اسماً مستعاراً وكلمة مرور لتدخل بهما من أي جهاز</p>
          <div class="form-group-soul" style="margin-bottom: 10px;">
            <label>الاسم المستعار:</label>
            <input type="text" id="auth-setup-nick" class="form-input-soul" maxlength="30" placeholder="الاسم الذي سيظهر في الغرف" autocomplete="username" />
          </div>
          <div class="form-group-soul" style="margin-bottom: 14px;">
            <label id="auth-setup-pass-label">كلمة المرور (6 أحرف على الأقل):</label>
            <input type="password" id="auth-setup-pass" class="form-input-soul" maxlength="64" autocomplete="new-password" dir="ltr" />
          </div>
          <button class="soul-submit-btn" id="btn-complete-signup" style="width: 100%; padding: 13px; font-size: 14px;">دخول 🪐</button>
        </div>

        <!-- الشاشة 4: الدخول بالاسم المستعار (جهاز آخر) -->
        <div id="auth-step-nickname" style="display: none;">
          <div style="${titleStyle}">الدخول بالاسم المستعار</div>
          <p style="${subStyle}">أدخل الاسم المستعار وكلمة المرور اللذين أنشأتهما عند التسجيل</p>
          <div class="form-group-soul" style="margin-bottom: 10px;">
            <label>الاسم المستعار:</label>
            <input type="text" id="auth-login-nick" class="form-input-soul" maxlength="30" autocomplete="username" />
          </div>
          <div class="form-group-soul" style="margin-bottom: 14px;">
            <label>كلمة المرور:</label>
            <input type="password" id="auth-login-pass" class="form-input-soul" maxlength="64" autocomplete="current-password" dir="ltr" />
          </div>
          <button class="soul-submit-btn" id="btn-login-nickname" style="width: 100%; padding: 13px; font-size: 14px;">دخول 🪐</button>
          <div style="text-align: center; margin-top: 14px;">
            <button type="button" id="btn-go-email-login" style="${linkBtn}">حساب جديد أو نسيت كلمة المرور؟ ادخل عبر الجيميل</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const $ = (id) => modal.querySelector('#' + id);
    const steps = { email: $('auth-step-email'), code: $('auth-step-code'), setup: $('auth-step-setup'), nickname: $('auth-step-nickname') };
    const show = (name) => { Object.keys(steps).forEach(k => { steps[k].style.display = k === name ? 'block' : 'none'; }); };
    const setBtn = (btn, busy, label) => { btn.disabled = busy; btn.textContent = label; };

    $('close-google-auth-btn').onclick = () => modal.remove();

    let email = '';
    let ticket = '';
    let accountStatus = 'new';
    let resendTimer = null;

    const emailInput = $('auth-email-input');
    const codeInput = $('auth-code-input');
    const btnRequest = $('btn-request-gmail-otp');
    const btnVerify = $('btn-verify-gmail-otp');
    const btnResend = $('btn-resend-otp');
    const btnComplete = $('btn-complete-signup');
    const btnLogin = $('btn-login-nickname');
    const REQUEST_LABEL = 'إرسال رمز التحقق إلى الجيميل 📨';

    function startResendCountdown(seconds) {
      clearInterval(resendTimer);
      let left = seconds;
      const tick = () => {
        if (left <= 0) { clearInterval(resendTimer); btnResend.disabled = false; btnResend.textContent = 'إعادة إرسال الرمز'; return; }
        btnResend.disabled = true;
        btnResend.textContent = `إعادة الإرسال بعد ${left} ث`;
        left -= 1;
      };
      tick();
      resendTimer = setInterval(tick, 1000);
    }

    async function postJSON(url, body) {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      let data = {};
      try { data = await res.json(); } catch (e) {}
      return { ok: res.ok, status: res.status, data };
    }

    async function sendCode(isResend) {
      const val = emailInput.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val)) {
        showToast('يرجى إدخال عنوان Gmail صحيح!');
        emailInput.focus();
        return;
      }
      email = val;
      setBtn(btnRequest, true, 'جارِ إرسال الرمز... ⏳');
      if (isResend) btnResend.disabled = true;
      try {
        const { ok, data } = await postJSON('/api/auth/send-gmail-otp', { email });
        if (ok && data.success) {
          $('auth-target-email').textContent = email;
          codeInput.value = '';
          show('code');
          codeInput.focus();
          startResendCountdown(data.resendAfter || 60);
          showToast(`تم إرسال رمز التحقق إلى ${email} 📨`, 'success');
        } else {
          showToast(data.error || 'فشل إرسال رمز التحقق');
          if (data.retryAfter && steps.code.style.display === 'block') startResendCountdown(data.retryAfter);
        }
      } catch (err) {
        console.error('Error requesting OTP:', err);
        showToast('حدث خطأ أثناء الاتصال بالخادم');
      }
      setBtn(btnRequest, false, REQUEST_LABEL);
    }

    btnRequest.onclick = () => sendCode(false);
    emailInput.onkeydown = (e) => { if (e.key === 'Enter') btnRequest.click(); };
    btnResend.onclick = () => sendCode(true);
    $('btn-back-to-email').onclick = () => { clearInterval(resendTimer); show('email'); emailInput.focus(); };

    // التحقق من الرمز
    btnVerify.onclick = async () => {
      const code = codeInput.value.trim();
      if (!/^\d{6}$/.test(code)) {
        showToast('يرجى كتابة رمز التحقق المكوّن من 6 أرقام!');
        codeInput.focus();
        return;
      }
      setBtn(btnVerify, true, 'جارِ التحقق... ⏳');
      try {
        const { ok, data } = await postJSON('/api/auth/verify-gmail-otp', { email, code });
        if (ok && data.success) {
          ticket = data.ticket;
          accountStatus = data.account_status;
          const nickInput = $('auth-setup-nick');
          const passInput = $('auth-setup-pass');
          passInput.value = '';
          if (accountStatus === 'existing') {
            $('auth-setup-title').textContent = 'أهلاً بعودتك 👋';
            $('auth-setup-sub').textContent = 'هذا البريد مسجّل باسم مستعار بالفعل. يمكنك الدخول مباشرة أو تعيين كلمة مرور جديدة';
            nickInput.value = data.nickname || '';
            nickInput.readOnly = true;
            $('auth-setup-pass-label').textContent = 'كلمة مرور جديدة (اختياري):';
            btnComplete.textContent = 'دخول 🪐';
          } else {
            $('auth-setup-title').textContent = accountStatus === 'legacy' ? 'أكمل حسابك' : 'أنشئ حسابك';
            $('auth-setup-sub').textContent = 'تم التحقق من بريدك. اختر اسماً مستعاراً وكلمة مرور لتدخل بهما من أي جهاز';
            nickInput.value = data.nickname || '';
            nickInput.readOnly = false;
            $('auth-setup-pass-label').textContent = 'كلمة المرور (6 أحرف على الأقل):';
            btnComplete.textContent = 'دخول 🪐';
          }
          clearInterval(resendTimer);
          show('setup');
          (accountStatus === 'existing' ? passInput : nickInput).focus();
        } else {
          showToast(data.error || 'رمز التحقق غير صحيح أو انتهت صلاحيته');
        }
      } catch (err) {
        console.error('Verify OTP error:', err);
        showToast('حدث خطأ في التحقق من الرمز');
      }
      setBtn(btnVerify, false, 'تأكيد الرمز ✅');
    };
    codeInput.onkeydown = (e) => { if (e.key === 'Enter') btnVerify.click(); };
    codeInput.oninput = () => { codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6); };

    // إنشاء الاسم المستعار وكلمة المرور
    btnComplete.onclick = async () => {
      const nickname = $('auth-setup-nick').value.replace(/\s+/g, ' ').trim();
      const password = $('auth-setup-pass').value;
      if (accountStatus !== 'existing') {
        if (nickname.length < 2) { showToast('اكتب اسماً مستعاراً (حرفان على الأقل)'); $('auth-setup-nick').focus(); return; }
        if (password.length < 6) { showToast('كلمة المرور يجب ألا تقل عن 6 أحرف'); $('auth-setup-pass').focus(); return; }
      } else if (password && password.length < 6) {
        showToast('كلمة المرور يجب ألا تقل عن 6 أحرف');
        return;
      }
      setBtn(btnComplete, true, 'جارِ الدخول... ⏳');
      try {
        const { ok, data } = await postJSON('/api/auth/complete-signup', { ticket, nickname, password });
        if (ok && data.success && data.user) {
          persistLogin(data);
          if (window.soundManager) window.soundManager.playCheer();
          showToast('مرحباً بك في SoulChill 🪐✨');
          onUserAuthenticated();
          return;
        }
        showToast(data.error || 'تعذر إكمال التسجيل');
      } catch (err) {
        console.error('Complete signup error:', err);
        showToast('حدث خطأ أثناء الاتصال بالخادم');
      }
      setBtn(btnComplete, false, 'دخول 🪐');
    };
    $('auth-setup-pass').onkeydown = (e) => { if (e.key === 'Enter') btnComplete.click(); };

    // الدخول بالاسم المستعار (جهاز آخر)
    btnLogin.onclick = async () => {
      const nickname = $('auth-login-nick').value.replace(/\s+/g, ' ').trim();
      const password = $('auth-login-pass').value;
      if (!nickname || !password) { showToast('أدخل الاسم المستعار وكلمة المرور'); return; }
      setBtn(btnLogin, true, 'جارِ الدخول... ⏳');
      try {
        const { ok, data } = await postJSON('/api/auth/login-nickname', { nickname, password });
        if (ok && data.success && data.user) {
          persistLogin(data);
          if (window.soundManager) window.soundManager.playCheer();
          showToast(`أهلاً ${data.user.name} 🪐✨`);
          onUserAuthenticated();
          return;
        }
        showToast(data.error || 'الاسم المستعار أو كلمة المرور غير صحيحة');
      } catch (err) {
        console.error('Nickname login error:', err);
        showToast('حدث خطأ أثناء الاتصال بالخادم');
      }
      setBtn(btnLogin, false, 'دخول 🪐');
    };
    $('auth-login-pass').onkeydown = (e) => { if (e.key === 'Enter') btnLogin.click(); };

    $('btn-go-nickname-login').onclick = () => { show('nickname'); $('auth-login-nick').focus(); };
    $('btn-go-email-login').onclick = () => { show('email'); emailInput.focus(); };

    $('auth-login-nick').value = lastNick;
    if (startMode === 'nickname' || (lastNick && startMode !== 'email')) {
      show('nickname');
      (lastNick ? $('auth-login-pass') : $('auth-login-nick')).focus();
    } else {
      show('email');
    }
  }

  // ============================================
  // CHANGE PROFILE AVATAR MODAL
  // ============================================
  function showChangeAvatarModal() {
    if (!requireAuth()) return;
    const user = state.currentUser;

    let existing = document.getElementById('avatar-changer-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'soul-modal-backdrop';
    modal.id = 'avatar-changer-modal';

    const avatarPresets = [
      'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=300&q=80',
      'https://api.dicebear.com/7.x/adventurer/svg?seed=Felix',
      'https://api.dicebear.com/7.x/adventurer/svg?seed=Aneka',
      'https://api.dicebear.com/7.x/adventurer/svg?seed=Shadow',
      'https://api.dicebear.com/7.x/micah/svg?seed=Princess'
    ];

    let selectedFile = null;
    let selectedAvatarUrl = user.avatar;

    modal.innerHTML = `
      <div class="soul-modal-content" style="max-width: 440px;">
        <button class="soul-modal-close-btn" id="close-avatar-changer-btn">✕</button>
        <div class="modal-header-title">📷 تغيير الصورة الشخصية</div>

        <!-- Current / Live Preview -->
        <div style="text-align: center; margin-bottom: 14px;">
          <img id="avatar-changer-preview-img" src="${user.avatar}" class="avatar-preview-large-circle ${user.avatar_frame ? 'avatar-frame-' + user.avatar_frame : ''}" />
          <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">معاينة صورتك الشخصية</div>
        </div>

        <!-- 1. Upload from Device / Camera -->
        <div class="avatar-upload-dropzone" id="avatar-dropzone-btn">
          <input type="file" id="avatar-device-file-input" accept="image/*" style="display: none;" />
          <div style="font-size: 32px; margin-bottom: 6px;">📁</div>
          <div style="font-size: 13px; font-weight: 700; color: #fff;">رفع صورة من جهازك أو الكاميرا</div>
          <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">اضغط هنا لاختيار أي صورة من هاتفك أو التقاط صورة</div>
        </div>

        <!-- 2. Avatar Presets Grid -->
        <div style="font-size: 12px; font-weight: 700; color: #fff; margin-bottom: 8px;">أو اختر أفاتار من المعرض الفاخر:</div>
        <div class="avatar-presets-grid">
          ${avatarPresets.map(url => `
            <div class="avatar-preset-item ${url === user.avatar ? 'selected' : ''}" data-url="${url}">
              <img src="${url}" />
            </div>
          `).join('')}
        </div>

        <!-- 3. Custom Image URL -->
        <div class="form-group-soul" style="margin-bottom: 14px;">
          <label>أو ضع رابط صورة مخصص (URL):</label>
          <input type="text" id="avatar-custom-url-field" class="form-input-soul" placeholder="https://..." value="${user.avatar.startsWith('http') ? user.avatar : ''}" />
        </div>

        <!-- Action Button -->
        <button class="soul-submit-btn" id="btn-confirm-avatar-save" style="width: 100%; padding: 12px; font-size: 14px;">
          حفظ وتطبيق الصورة الشخصية فوراً ✅
        </button>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-avatar-changer-btn').onclick = () => modal.remove();

    // Trigger File Input on Dropzone Click
    const fileInput = modal.querySelector('#avatar-device-file-input');
    const dropzone = modal.querySelector('#avatar-dropzone-btn');
    const previewImg = modal.querySelector('#avatar-changer-preview-img');

    dropzone.onclick = () => fileInput.click();

    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        selectedFile = file;
        const reader = new FileReader();
        reader.onload = (re) => {
          previewImg.src = re.target.result;
          selectedAvatarUrl = re.target.result;
          modal.querySelectorAll('.avatar-preset-item').forEach(i => i.classList.remove('selected'));
        };
        reader.readAsDataURL(file);
      }
    };

    // Preset Selection
    modal.querySelectorAll('.avatar-preset-item').forEach(item => {
      item.onclick = () => {
        modal.querySelectorAll('.avatar-preset-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        selectedFile = null;
        selectedAvatarUrl = item.dataset.url;
        previewImg.src = selectedAvatarUrl;
        const urlField = modal.querySelector('#avatar-custom-url-field');
        if (urlField) urlField.value = selectedAvatarUrl;
      };
    });

    // Custom URL Input
    const customUrlField = modal.querySelector('#avatar-custom-url-field');
    customUrlField.oninput = () => {
      const val = customUrlField.value.trim();
      if (val && val.startsWith('http')) {
        selectedFile = null;
        selectedAvatarUrl = val;
        previewImg.src = val;
        modal.querySelectorAll('.avatar-preset-item').forEach(i => i.classList.remove('selected'));
      }
    };

    // Save Button
    const saveBtn = modal.querySelector('#btn-confirm-avatar-save');
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      saveBtn.innerText = 'جارِ حفظ وتحديث الصورة... ⏳';

      try {
        let finalAvatarUrl = selectedAvatarUrl;

        if (selectedFile) {
          const formData = new FormData();
          formData.append('avatar', selectedFile);

          const uploadRes = await fetch('/api/users/avatar', {
            method: 'POST',
            headers: { 'x-user-id': user.id },
            body: formData
          });
          const uploadData = await uploadRes.json();
          if (uploadData.success && uploadData.user) {
            state.currentUser = uploadData.user;
            finalAvatarUrl = uploadData.avatar;
          } else {
            throw new Error(uploadData.error || 'فشل رفع الصورة');
          }
        } else {
          const updateRes = await fetch('/api/users/avatar', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': user.id
            },
            body: JSON.stringify({ avatar_url: finalAvatarUrl })
          });
          const updateData = await updateRes.json();
          if (updateData.success && updateData.user) {
            state.currentUser = updateData.user;
            finalAvatarUrl = updateData.avatar;
          } else {
            throw new Error(updateData.error || 'فشل تحديث الصورة');
          }
        }

        // Save persistent user in localStorage
        localStorage.setItem('soulchill_user', JSON.stringify(state.currentUser));
        localStorage.setItem('soulchill_user_id', state.currentUser.id);

        // Update DOM elements everywhere
        updateHeaderUI();
        const profileAvatar = document.getElementById('profile-page-avatar');
        if (profileAvatar) profileAvatar.src = finalAvatarUrl;

        // If in a room and seated, update seat and notify room
        if (state.activeRoomSeats) {
          state.activeRoomSeats.forEach(s => {
            if (s.user && s.user.id === user.id) {
              s.user.avatar = finalAvatarUrl;
            }
          });
          renderRoomSeatsGrid(state.activeRoomSeats);
        }

        if (state.socket) {
          state.socket.emit('user_avatar_changed', { userId: user.id, avatar: finalAvatarUrl });
        }

        modal.remove();
        showToast('تم تحديث صورتك الشخصية بنجاح! 📸✨');

        if (state.currentTab === 'profile') {
          renderProfileTab(document.getElementById('app-main-content'));
        }
      } catch (err) {
        console.error('Avatar save error:', err);
        showToast(err.message || 'حدث خطأ أثناء تحديث الصورة الشخصية');
        saveBtn.disabled = false;
        saveBtn.innerText = 'حفظ وتطبيق الصورة الشخصية فوراً ✅';
      }
    };
  }

  // ============================================
  // EVENT LISTENERS & SETUP
  // ============================================
  function setupEventListeners() {
    // Bottom Nav Tabs
    document.querySelectorAll('.nav-tab-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = btn.dataset.tab;
        if (window.soundManager) window.soundManager.playClick();
        switchTab(tab);
      });
    });

    // Top Header currency clicks (opens top-up)
    const coinsBadge = document.getElementById('header-coins-badge');
    const diamondsBadge = document.getElementById('header-diamonds-badge');
    if (coinsBadge) coinsBadge.onclick = () => showTopUpModal();
    if (diamondsBadge) diamondsBadge.onclick = () => showTopUpModal();

    // Daily bonus top button
    const dailyBonusBtn = document.getElementById('header-daily-checkin-btn');
    if (dailyBonusBtn) dailyBonusBtn.onclick = () => handleDailyCheckIn();

    // Mode Switcher (Mobile App Frame vs Fullscreen)
    const modeBtn = document.getElementById('header-mode-toggle-btn');
    if (modeBtn) {
      modeBtn.onclick = () => {
        state.isFullScreen = !state.isFullScreen;
        const container = document.getElementById('main-app-container');
        if (container) {
          container.classList.toggle('fullscreen-mode', state.isFullScreen);
        }
        modeBtn.innerText = state.isFullScreen ? '📱' : '💻';
        showToast(state.isFullScreen ? 'نمط الشاشة الكاملة 💻' : 'نمط تطبيق الهاتف 📱');
      };
    }

    // Language Toggle (العربية / English)
    const langBtn = document.getElementById('header-lang-toggle-btn');
    if (langBtn) {
      langBtn.onclick = () => {
        state.lang = state.lang === 'ar' ? 'en' : 'ar';
        document.body.classList.toggle('ltr', state.lang === 'en');
        langBtn.innerText = state.lang === 'ar' ? 'EN' : 'عربي';
        showToast(state.lang === 'ar' ? 'تم تحويل اللغة إلى العربية' : 'Language switched to English');
      };
    }

    // User Avatar in Header
    const headerAvatar = document.getElementById('header-user-avatar-btn');
    if (headerAvatar) {
      headerAvatar.onclick = () => {
        if (!state.currentUser) {
          showGoogleLoginModal();
        } else {
          switchTab('profile');
        }
      };
    }
  }

  // Helper: Toast message
  // إشعار جميل بدل alert (بطاقة تنزل من الأعلى مع أيقونة وزر إغلاق وشريط وقت)
  function showNiceNotice({ type = 'info', icon = '🔔', title = '', message = '', duration = 5500 } = {}) {
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let host = document.getElementById('nice-notice-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'nice-notice-host';
      host.className = 'nice-notice-host';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = `nice-notice nice-notice-${type}`;
    el.style.setProperty('--nn-duration', `${duration}ms`);
    el.innerHTML = `
      <div class="nice-notice-icon">${icon}</div>
      <div class="nice-notice-body">
        ${title ? `<div class="nice-notice-title">${esc(title)}</div>` : ''}
        <div class="nice-notice-msg">${esc(message)}</div>
      </div>
      <button type="button" class="nice-notice-close" aria-label="إغلاق">✕</button>
      <span class="nice-notice-bar"></span>`;
    host.appendChild(el);
    const close = () => {
      if (!el.parentElement) return;
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 320);
    };
    el.querySelector('.nice-notice-close').onclick = close;
    setTimeout(close, duration);
  }

  function showToast(msg) {
    let oldToast = document.querySelector('.soul-toast');
    if (oldToast) oldToast.remove();

    const toast = document.createElement('div');
    toast.className = 'soul-toast';
    toast.innerText = msg;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  function showGlobalAnnouncementBanner(msg) {
    const existing = document.querySelector('.global-announcement-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.className = 'global-announcement-banner';
    banner.innerHTML = `
      <span style="font-size: 16px;">👑</span>
      <div>
        <div style="font-size: 11px; color: #fef08a;">إعلان رسمي من إدارة التطبيق العليا:</div>
        <div>${msg}</div>
      </div>
    `;
    document.body.appendChild(banner);
    if (window.soundManager) window.soundManager.playCheer();
    setTimeout(() => {
      banner.style.opacity = '0';
      banner.style.transition = 'opacity 0.5s ease';
      setTimeout(() => banner.remove(), 500);
    }, 8000);
  }

  function hideModal(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  function formatTime(isoString) {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('.notif-bell-btn')) openNotificationsSheet();
  });

  window.SoulChillApp = {
    state,
    switchTab,
    showToast,
    openVoiceRoom,
    // واجهات إضافية تستخدمها js/room-pro.js (مركز الترفيه، كيس الحظ، الشحن اليومي…)
    openGiftStoreModal,
    openRoomAccessoriesModal,
    openWalletModal,
    leaveActiveVoiceRoom,
    requireAuth,
    updateHeaderUI,
    loadGiftsCatalogue,
    startRoomPkBattle,
    isPlatformStaff,
    // واجهات إضافية تستخدمها js/room-video.js (قائمة التحكم ومقاعد الغرفة)
    handleSeatClick,
    takeSeatAction,
    toggleUserMic,
    updateMicButtonUI,
    showUserProfileCard,
    openRoomUserSheet,
    openRoomPeoplePanel,
    openInRoomMessagesDrawer,
    uiConfirm,
    // واجهات إضافية يستخدمها js/dm-new.js (الرسائل الخاصة الجديدة)
    fetchFollowStats,
    setFollow,
    followHeaders,
    sendPrivateMessage,
    toggleVoiceNoteRecording,
    appendDirectChatMessageUI
  };

})();
