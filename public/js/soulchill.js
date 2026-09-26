/* SoulChill shell — navigation, Gmail gate, seats, discover, friends, PK */
(function () {
  const SEAT_COUNT = 8;
  function soulSeatCount() {
    if (typeof CUR_ROOM !== 'undefined' && CUR_ROOM && CUR_ROOM.party_mode === 'partner') return 2;
    const n = +(CUR_ROOM && CUR_ROOM.seat_count);
    if (n === 12) return 12;
    return SEAT_COUNT;
  }
  const GMAIL_RE = /^[a-z0-9._%+-]+@gmail\.com$/i;
  let ROOM_CAT = 'hot';
  let PK_STATE = null;
  let PK_TIMER = null;
  let FOLLOW_SET = new Set();
  let OWNER_SEAT_TIMER = null;
  let SOCIAL = { followers: 0, following: 0, xp: 0, level: 1, public_id: '' };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function gmailSvg() {
    return '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.5-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.4-11.3-8.1l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.2-3.5 5.8-6.5 7.3l6.2 5.2C37.9 38.2 44 34 44 24c0-1.3-.1-2.5-.4-3.5z"/></svg>';
  }

  function avaUrl(u) {
    const a = u && (u.avatar || u.img);
    if (!a) return '/avatars/default.png';
    if (typeof avatarHtml === 'function') {
      const html = avatarHtml(a, '', typeof frameOf === 'function' ? frameOf(u) : '');
      const m = html && html.match(/src="([^"]+)"/);
      if (m) return m[1];
    }
    return a.startsWith('/') || a.startsWith('http') ? a : '/avatars/default.png';
  }

  function needAuth() {
    if (typeof ME !== 'undefined' && ME) return true;
    if (typeof openLogin === 'function') openLogin();
    return false;
  }

  function soulCloseNav(except) {
    ['privOv', 'notifOv', 'wallOv', 'menuOv', 'myGiftsOv', 'blocksOv', 'discoverOv', 'friendsOv', 'createRoomOv', 'pkPickOv', 'soulTestOv', 'soulMatchOv', 'soulGameOv', 'soulOnboardOv', 'soulPassOv', 'soulInviteOv', 'soulShopOv', 'soulEventsOv', 'soulLuckyOv'].forEach(id => {
      if (id !== except && typeof closeOv === 'function') closeOv(id);
    });
  }

  function soulSetNavActive(nav) {
    $$('.bn-item').forEach(b => b.classList.toggle('active', b.dataset.nav === nav));
  }

  function soulShowHomeNav(show) {
    const nav = document.querySelector('.bottomnav');
    if (nav) nav.classList.toggle('show', !!show);
  }

  function matchPercent(a, b) {
    const n = (Math.abs(+a || 1) * 17 + Math.abs(+b || 2) * 31) % 41;
    return 59 + n;
  }

  function soulPaintCoins() {
    const el = $('#soulCoinsVal');
    if (el && typeof ME !== 'undefined' && ME) el.textContent = ME.balance || 0;
  }

  async function soulLoadSocial() {
    if (typeof ME === 'undefined' || !ME || typeof api !== 'function') return;
    try {
      const d = await api('/api/me/social');
      SOCIAL = d || SOCIAL;
      FOLLOW_SET = new Set((d && d.following_ids) || []);
      const lvl = $('#soulMeLevel'); if (lvl) lvl.textContent = d.level || 1;
      const sid = $('#soulMeId'); if (sid) sid.textContent = d.public_id || '-';
      const fol = $('#soulMeFollowers'); if (fol) fol.textContent = d.followers || 0;
      const fing = $('#soulMeFollowing'); if (fing) fing.textContent = d.following || 0;
      const xp = $('#soulMeXp'); if (xp) xp.textContent = d.xp || 0;
      soulPaintCoins();
    } catch (e) { }
  }

  function soulRoomCover(r) {
    const img = r && r.image;
    if (img && img !== '/img/room.png') return img;
    return '/img/covers/c' + ((((+r.id) || 0) % 6) + 1) + '.jpg';
  }
  function soulFaceSrc(u) {
    if (!u) return '/avatars/default.png';
    return avaUrl(u);
  }
  function soulRoomCardHtml(r) {
    const online = (typeof ROOM_COUNTS !== 'undefined' && ROOM_COUNTS[r.id]) || r.online || 0;
    const live = online > 0;
    const isPk = !!(r.pk || (PK_STATE && (PK_STATE.room_a === r.id || PK_STATE.room_b === r.id)));
    const cover = typeof esc === 'function' ? esc(soulRoomCover(r)) : soulRoomCover(r);
    const name = typeof esc === 'function' ? esc(r.name) : r.name;
    const faces = (r.faces || []).slice(0, 3);
    const faceHtml = faces.map((u, i) => `<span class="face f${i}" style="background-image:url('${soulFaceSrc(u)}')"></span>`).join('');
    return `<article class="soul-room-card" data-id="${r.id}">
      <div class="soul-room-cover" style="background-image:url('${cover}')">
        ${live ? '<span class="soul-live">مباشر</span>' : ''}
        ${isPk || r.party_mode === 'pk' ? '<span class="soul-pk-tag">PK</span>' : ''}
        <div class="soul-room-faces">${faceHtml}</div>
        <div class="soul-room-online">${online}</div>
      </div>
      <div class="soul-room-meta"><b class="room-name">${name}</b></div>
    </article>`;
  }

  function soulFilterRooms() {
    const q1 = (($('#roomSearch') && $('#roomSearch').value) || '').trim();
    let list = (typeof ROOMS !== 'undefined' ? ROOMS : []).filter(r => {
      const n = String(r.name || '').trim();
      const d = String(r.description || '');
      if (!n || n.length < 2) return false;
      if (n.includes('تطابق') || d.includes('تطابق')) return false;
      if (!q1) return true;
      return n.includes(q1);
    });
    if (ROOM_CAT === 'voice') list = list.filter(r => r.type === 'voice');
    if (ROOM_CAT === 'live') list = list.filter(r => r.type === 'live' || r.party_mode === 'live');
    if (ROOM_CAT === 'partner') list = list.filter(r => r.party_mode === 'partner');
    if (ROOM_CAT === 'disco') list = list.filter(r => r.party_mode === 'disco');
    if (ROOM_CAT === 'pk') list = list.filter(r => r.pk || r.party_mode === 'pk' || (PK_STATE && (PK_STATE.room_a === r.id || PK_STATE.room_b === r.id)));
    if (ROOM_CAT === 'hot') list = list.slice().sort((a, b) => ((ROOM_COUNTS && ROOM_COUNTS[b.id]) || 0) - ((ROOM_COUNTS && ROOM_COUNTS[a.id]) || 0));
    return list;
  }

  function soulRenderRooms() {
    const box = $('#roomsList');
    if (!box) return;
    const list = soulFilterRooms();
    box.innerHTML = list.length ? list.map(soulRoomCardHtml).join('') : '<div class="soul-empty">لا توجد غرف هنا بعد — أنشئ حفلتك الأولى 🎤</div>';
    $$('#roomsList .soul-room-card').forEach(row => {
      row.onclick = () => { if (typeof enterRoom === 'function') enterRoom(+row.dataset.id); };
    });
    if (typeof renderRoomsPanel === 'function') {
      try { renderRoomsPanel(); } catch (e) { }
    }
  }

  function soulIsRoomOwner() {
    return !!(typeof ME !== 'undefined' && ME && typeof CUR_ROOM !== 'undefined' && CUR_ROOM && +CUR_ROOM.owner_id === +ME.id);
  }
  function soulCanHostMic() {
    if (soulIsRoomOwner()) return true;
    return typeof canModerateRank === 'function' && canModerateRank();
  }
  function soulMicsLocked() {
    return !!(typeof CUR_ROOM !== 'undefined' && CUR_ROOM && +CUR_ROOM.mic_locked);
  }
  function soulIsOnMic() {
    return !!(typeof BCAST !== 'undefined' && BCAST && BCAST.isHost && CUR_ROOM && BCAST.roomId === CUR_ROOM.id);
  }
  function soulPaintMicBtn() {
    const btn = $('#soulDockMic');
    if (!btn) return;
    btn.classList.toggle('is-on', soulIsOnMic() && !(typeof AUDIO_BCAST_HOST_MUTED !== 'undefined' && AUDIO_BCAST_HOST_MUTED));
    btn.classList.toggle('is-muted', soulIsOnMic() && !!(typeof AUDIO_BCAST_HOST_MUTED !== 'undefined' && AUDIO_BCAST_HOST_MUTED));
    btn.classList.toggle('is-pending', !!(typeof SPEAK_REQUEST_PENDING !== 'undefined' && SPEAK_REQUEST_PENDING));
    btn.title = soulIsOnMic() ? (AUDIO_BCAST_HOST_MUTED ? 'إلغاء كتم المايك' : 'كتم المايك') : (soulCanHostMic() ? 'أخذ المقعد' : 'طلب مقعد من المضيف');
    const go = $('#soulLiveGo');
    if (go && CUR_ROOM && CUR_ROOM.type === 'live') go.style.display = (soulCanHostMic() && !soulIsOnMic()) ? '' : 'none';
  }
  function soulHandleMic() {
    if (typeof ME === 'undefined' || !ME) { if (typeof openLogin === 'function') openLogin(); return; }
    if (!CUR_ROOM || (CUR_ROOM.type !== 'voice' && CUR_ROOM.type !== 'live')) return;
    if (CUR_ROOM.type === 'live' && !soulCanHostMic() && !soulIsOnMic()) {
      if (typeof ROOM_BCAST !== 'undefined' && ROOM_BCAST[CUR_ROOM.id] && typeof openOv === 'function') openOv('bcastOv');
      else if (typeof toast === 'function') toast('انتظر المضيف ليبدأ البث المباشر', false);
      return;
    }
    if (soulIsOnMic()) {
      if (ME.muted) { if (typeof toast === 'function') toast('تم كتمك من المضيف — لا يمكنك فتح المايك', false); return; }
      if (typeof AUDIO_BCAST_HOST_MUTED === 'undefined' || !BCAST.localStream) return;
      AUDIO_BCAST_HOST_MUTED = !AUDIO_BCAST_HOST_MUTED;
      BCAST.localStream.getAudioTracks().forEach(t => { t.enabled = !AUDIO_BCAST_HOST_MUTED; });
      if (typeof bcastUpdateHostMuteButton === 'function') bcastUpdateHostMuteButton();
      soulPaintMicBtn();
      if (typeof toast === 'function') toast(AUDIO_BCAST_HOST_MUTED ? 'المايك مكتوم' : 'المايك مفتوح');
      return;
    }
    if (soulMicsLocked() && !soulCanHostMic()) {
      if (typeof toast === 'function') toast('المايكات مغلقة من مضيف الغرفة', false);
      return;
    }
    if (typeof bcastStart === 'function') bcastStart(CUR_ROOM.type === 'live' ? 'video' : 'audio');
  }
  function soulRequestSeat() {
    if (!CUR_ROOM || typeof SOCKET === 'undefined' || !SOCKET) return;
    if (typeof SPEAK_REQUEST_PENDING !== 'undefined' && SPEAK_REQUEST_PENDING) {
      if (typeof toast === 'function') toast('طلبك قيد الانتظار عند المضيف');
      return;
    }
    const state = typeof ROOM_BCAST !== 'undefined' ? ROOM_BCAST[CUR_ROOM.id] : null;
    if (!state) {
      if (typeof toast === 'function') toast('انتظر المضيف ليبدأ الحفلة ثم اطلب مقعداً', false);
      return;
    }
    SOCKET.emit('bcast:speak_request', CUR_ROOM.id, (res) => {
      if (!res || !res.ok) {
        if (typeof toast === 'function') toast((res && res.text) || 'تعذر طلب المقعد', false);
        return;
      }
      if (typeof SPEAK_REQUEST_PENDING !== 'undefined') SPEAK_REQUEST_PENDING = true;
      if (typeof toast === 'function') toast('تم إرسال طلب المقعد إلى مضيف الغرفة 🎤');
      soulPaintMicBtn();
      soulRenderSeats();
    });
  }
  window.soulHandleMic = soulHandleMic;

  async function soulToggleMicLock() {
    if (!CUR_ROOM || !soulCanHostMic()) return;
    const next = soulMicsLocked() ? 0 : 1;
    try {
      const r = await api('/api/rooms/' + CUR_ROOM.id + '/mic-lock', 'POST', { locked: next });
      CUR_ROOM.mic_locked = r.mic_locked;
      const lockBtn = $('#dropLockMics');
      if (lockBtn) lockBtn.innerHTML = (soulMicsLocked() ? 'فتح المايكات' : 'إغلاق المايكات') + ' <i class="f7-icons">' + (soulMicsLocked() ? 'mic_fill' : 'mic_slash_fill') + '</i>';
      if (typeof toast === 'function') toast(soulMicsLocked() ? 'أُغلقت المايكات — الجمهور لا يصعد' : 'فُتحت المايكات');
      soulRenderSeats();
    } catch (e) {
      if (typeof toast === 'function') toast(e.message || 'تعذر تغيير قفل المايكات', false);
    }
  }

  function soulShowSpeakAsk(user) {
    if (!user || !soulCanHostMic()) return;
    const box = $('#soulSpeakInbox');
    if (!box) return;
    if (box.querySelector('[data-uid="' + user.id + '"]')) return;
    box.hidden = false;
    const row = document.createElement('div');
    row.className = 'soul-ask';
    row.dataset.uid = user.id;
    const ava = user.avatar ? `<img src="${avaUrl(user)}" alt="">` : '<span class="soul-ico">🎤</span>';
    row.innerHTML = `${ava}<span>${typeof esc === 'function' ? esc(user.username) : user.username} يطلب مقعداً</span>
      <span class="ask-btns"><button type="button" class="no">رفض</button><button type="button" class="ok">قبول</button></span>`;
    row.querySelector('.ok').onclick = () => {
      row.remove();
      if (!box.children.length) box.hidden = true;
      if (typeof SOCKET !== 'undefined' && SOCKET) SOCKET.emit('bcast:speak_response', CUR_ROOM.id, user.id, true);
    };
    row.querySelector('.no').onclick = () => {
      row.remove();
      if (!box.children.length) box.hidden = true;
      if (typeof SOCKET !== 'undefined' && SOCKET) SOCKET.emit('bcast:speak_response', CUR_ROOM.id, user.id, false);
    };
    box.appendChild(row);
  }

  function soulPrepareRoom() {
    const chat = $('#chatScreen');
    const isLive = !!(typeof CUR_ROOM !== 'undefined' && CUR_ROOM && CUR_ROOM.type === 'live');
    const voice = !!(typeof CUR_ROOM !== 'undefined' && CUR_ROOM && (CUR_ROOM.type === 'voice' || isLive));
    if (chat) {
      chat.classList.toggle('soul-voice', voice && !isLive);
      chat.classList.toggle('soul-live', isLive);
      chat.classList.toggle('soul-disco', !!(CUR_ROOM && CUR_ROOM.party_mode === 'disco'));
    }
    const stage = $('#soulStage');
    const dock = $('#soulDock');
    if (stage) stage.hidden = !voice;
    if (dock) dock.hidden = !voice;
    const seats = $('#soulSeats');
    if (seats) seats.style.display = isLive ? 'none' : '';
    const liveStage = $('#soulLiveStage');
    if (liveStage) {
      liveStage.hidden = !isLive;
      const go = $('#soulLiveGo');
      if (go) go.style.display = (isLive && soulCanHostMic() && !soulIsOnMic()) ? '' : 'none';
    }
    const banner = $('#soulRoomBanner');
    if (banner) banner.hidden = true;
    if (chat && CUR_ROOM) {
      const cover = (CUR_ROOM.image && CUR_ROOM.image !== '/img/room.png') ? CUR_ROOM.image : '/img/soul-room-bg.jpg';
      chat.style.backgroundImage = `linear-gradient(180deg, rgba(8,3,16,.22) 0%, rgba(8,3,16,.45) 42%, rgba(8,3,16,.88) 100%), url('${cover}')`;
      chat.style.backgroundSize = 'cover';
      chat.style.backgroundPosition = 'center top';
    }
    const flash = $('#topcmm-123flashchat');
    if (flash) flash.style.display = 'none';
    const up = $('#usersPanel');
    if (voice && up) up.classList.remove('open');
    const lockBtn = $('#dropLockMics');
    if (lockBtn) {
      lockBtn.style.display = soulCanHostMic() ? '' : 'none';
      lockBtn.innerHTML = (soulMicsLocked() ? 'فتح المايكات' : 'إغلاق المايكات') + ' <i class="f7-icons">' + (soulMicsLocked() ? 'mic_fill' : 'mic_slash_fill') + '</i>';
    }
    soulRenderSeats();
    soulFetchPk();
    soulPaintMicBtn();
    if (voice && !isLive && soulIsRoomOwner() && !soulIsOnMic()) {
      if (OWNER_SEAT_TIMER) clearTimeout(OWNER_SEAT_TIMER);
      OWNER_SEAT_TIMER = setTimeout(() => {
        OWNER_SEAT_TIMER = null;
        if (CUR_ROOM && soulIsRoomOwner() && !soulIsOnMic() && typeof bcastStart === 'function') bcastStart('audio');
      }, 500);
    }
  }

  function soulResetRoomUi() {
    const chat = $('#chatScreen');
    if (chat) {
      chat.classList.remove('soul-voice', 'soul-live', 'soul-disco');
      chat.style.backgroundImage = '';
    }
    const stage = $('#soulStage'); if (stage) stage.hidden = true;
    const dock = $('#soulDock'); if (dock) dock.hidden = true;
    PK_STATE = null;
    const bar = $('#soulPkBar'); if (bar) bar.hidden = true;
    if (PK_TIMER) { clearInterval(PK_TIMER); PK_TIMER = null; }
    const inbox = $('#soulSpeakInbox'); if (inbox) { inbox.hidden = true; inbox.innerHTML = ''; }
    const aud = $('#soulAudience'); if (aud) aud.textContent = '';
  }

  function soulRenderSeats() {
    const box = $('#soulSeats');
    if (!box) return;
    const voice = !!(typeof CUR_ROOM !== 'undefined' && CUR_ROOM && CUR_ROOM.type === 'voice');
    if (!voice) { box.innerHTML = ''; return; }
    const hosts = (typeof liveBroadcastHostIds === 'function') ? liveBroadcastHostIds() : new Set();
    const users = (typeof ROOM_USERS !== 'undefined' ? ROOM_USERS : []).slice();
    const speakers = users.filter(u => hosts.has(+u.id));
    if (soulIsOnMic() && ME && !speakers.some(u => +u.id === +ME.id)) {
      speakers.unshift(ME);
    }
    const seats = [];
    for (let i = 0; i < soulSeatCount(); i++) seats.push(speakers[i] || null);
    const locked = soulMicsLocked();
    const pending = !!(typeof SPEAK_REQUEST_PENDING !== 'undefined' && SPEAK_REQUEST_PENDING);
    box.classList.toggle('seats-12', soulSeatCount() === 12);
    box.classList.toggle('seats-2', soulSeatCount() === 2);
    box.innerHTML = seats.map((u, i) => {
      if (!u) {
        return `<button type="button" class="soul-seat empty${locked ? ' locked' : ''}${pending && i === speakers.length ? ' pending' : ''}" data-empty="1">
          <span class="soul-seat-ava">${locked ? '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M17 8h-1V6a4 4 0 1 0-8 0v2H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-7-2a2 2 0 1 1 4 0v2h-4V6z"/></svg>' : '+'}</span>
          <small>${locked ? 'مغلق' : (pending && i === speakers.length ? 'بانتظار الموافقة' : 'مقعد')}</small>
        </button>`;
      }
      const isOwner = CUR_ROOM && +CUR_ROOM.owner_id === +u.id;
      const isMod = !isOwner && (u.rank === 'roomadmin' || u.badge === 'roomadmin.png');
      const role = isOwner ? 'مضيف' : (isMod ? 'مشرف' : 'مايك');
      const name = typeof esc === 'function' ? esc(u.username) : u.username;
      const lvl = u.level || 1;
      return `<button type="button" class="soul-seat host" data-uid="${u.id}">
        <span class="soul-seat-ava">${u.avatar ? `<img src="${avaUrl(u)}" alt="">` : '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg>'}${isOwner ? '<span class="soul-crown">♛</span>' : ''}<em class="lv">${lvl}</em></span>
        <small>${name}</small>
        <em class="soul-role">${role}</em>
      </button>`;
    }).join('');
    const speakerIds = new Set(speakers.map(u => +u.id));
    const audience = users.filter(u => !speakerIds.has(+u.id));
    let audBox = $('#soulAudience');
    if (!audBox) {
      audBox = document.createElement('div');
      audBox.id = 'soulAudience';
      box.after(audBox);
    }
    audBox.className = 'soul-audience';
    const extra = Math.max(0, audience.length - 12);
    audBox.innerHTML = audience.slice(0, 12).map(u =>
      `<button type="button" class="soul-aud-face" data-uid="${u.id}" style="background-image:url('${avaUrl(u)}')" title="${typeof esc === 'function' ? esc(u.username) : (u.username || '')}"></button>`
    ).join('') + (extra ? `<span class="soul-aud-more">+${extra}</span>` : '');
    $$('#soulAudience .soul-aud-face').forEach(btn => {
      btn.onclick = () => { if (typeof openUserSheet === 'function') openUserSheet(+btn.dataset.uid, null, btn); };
    });
    $$('#soulSeats .soul-seat').forEach(btn => {
      btn.onclick = () => {
        if (btn.dataset.empty) { if (!soulIsOnMic()) soulHandleMic(); return; }
        if (typeof ME !== 'undefined' && ME && +btn.dataset.uid === +ME.id && soulIsOnMic()) {
          soulHandleMic();
          return;
        }
        if (typeof openUserSheet === 'function') openUserSheet(+btn.dataset.uid, null, btn);
      };
    });
    soulPaintMicBtn();
  }

  function soulPkSecondsLeft(pk) {
    const end = +((pk && pk.ends_at) || 0);
    return Math.max(0, end - Math.floor(Date.now() / 1000));
  }

  function soulPaintPk(pk) {
    const bar = $('#soulPkBar');
    if (!bar) return;
    if (!pk || pk.status !== 'live') {
      bar.hidden = true;
      PK_STATE = pk && pk.status === 'live' ? pk : null;
      return;
    }
    PK_STATE = pk;
    bar.hidden = false;
    const left = soulPkSecondsLeft(pk);
    const mm = String(Math.floor(left / 60)).padStart(2, '0');
    const ss = String(left % 60).padStart(2, '0');
    const aName = pk.room_a_name || ('غرفة ' + pk.room_a);
    const bName = pk.room_b_name || ('غرفة ' + pk.room_b);
    bar.innerHTML = `<div class="pk-side"><small>${aName}</small><b>${pk.score_a || 0}</b></div>
      <div class="pk-vs">VS<br>${mm}:${ss}</div>
      <div class="pk-side" style="text-align:left"><small>${bName}</small><b>${pk.score_b || 0}</b></div>`;
    if (PK_TIMER) clearInterval(PK_TIMER);
    PK_TIMER = setInterval(() => {
      if (!PK_STATE) { clearInterval(PK_TIMER); PK_TIMER = null; return; }
      soulPaintPk(PK_STATE);
      if (soulPkSecondsLeft(PK_STATE) <= 0) { clearInterval(PK_TIMER); PK_TIMER = null; }
    }, 1000);
  }

  async function soulFetchPk() {
    if (!CUR_ROOM || typeof api !== 'function') return;
    try {
      const d = await api('/api/pk/current?room_id=' + CUR_ROOM.id);
      soulPaintPk(d && d.pk);
    } catch (e) { }
  }

  function soulBindSocket(s) {
    if (!s || s._soulPk) return;
    s._soulPk = true;
    s.on('pk:update', d => soulPaintPk(d));
    s.on('pk:start', d => { soulPaintPk(d); if (typeof toast === 'function') toast('بدأت جولة PK ⚡'); });
    s.on('pk:end', d => {
      soulPaintPk(null);
      const win = d && d.winner_room;
      if (typeof toast === 'function') toast(win ? ('انتهت الجولة — فازت غرفة ' + win + ' 🏆') : 'انتهت جولة PK بالتعادل');
    });
    s.on('follow:notify', () => soulLoadSocial());
    s.on('bcast:speak_request', ({ user }) => soulShowSpeakAsk(user));
    s.on('room:mic_lock', (d) => {
      if (!CUR_ROOM || !d || +d.roomId !== +CUR_ROOM.id) return;
      CUR_ROOM.mic_locked = d.mic_locked;
      soulPrepareRoom();
    });
    s.on('bcast:speak_response', () => { soulPaintMicBtn(); soulRenderSeats(); });
    s.on('bcast:started', () => { soulPaintMicBtn(); soulRenderSeats(); });
    s.on('bcast:ended', () => { soulPaintMicBtn(); soulRenderSeats(); });
    s.on('bcast:host_joined', () => { soulPaintMicBtn(); soulRenderSeats(); });
    s.on('bcast:host_left', () => { soulPaintMicBtn(); soulRenderSeats(); });
  }

  async function soulToggleFollow(uid, btn) {
    if (!needAuth()) return;
    try {
      const d = await api('/api/follow', 'POST', { user_id: uid });
      if (d && d.following) FOLLOW_SET.add(+uid); else FOLLOW_SET.delete(+uid);
      if (btn) {
        btn.classList.toggle('on', !!d.following);
        btn.textContent = d.following ? 'تتابع' : 'متابعة';
      }
      if (typeof toast === 'function') toast(d.following ? 'تمت المتابعة' : 'ألغيت المتابعة');
      soulLoadSocial();
    } catch (e) {
      if (typeof toast === 'function') toast((e && e.error) || 'تعذر المتابعة', false);
    }
  }

  async function soulOpenDiscover() {
    if (!needAuth()) return;
    soulCloseNav('discoverOv');
    openOv('discoverOv');
    soulSetNavActive('discover');
    soulRenderDiscover('people');
  }

  async function soulRenderDiscover(tab) {
    $$('#discoverOv .soul-tabs button').forEach(b => b.classList.toggle('active', b.dataset.dtab === tab));
    const people = $('#soulPeople');
    const rank = $('#soulRank');
    const momentsBtn = $('#soulOpenMoments');
    if (tab === 'moments') {
      closeOv('discoverOv');
      if (typeof openWall === 'function') openWall();
      return;
    }
    if (people) people.style.display = tab === 'people' ? '' : 'none';
    if (rank) rank.style.display = tab === 'rank' ? '' : 'none';
    if (tab === 'people') {
      try {
        const d = await api('/api/discover');
        const list = (d && d.users) || [];
        const count = $('#soulOnlineSouls');
        if (count) count.textContent = list.length + ' روح متصلة';
        const nEl = $('#soulOnlineN');
        if (nEl) nEl.textContent = list.length;
        people.innerHTML = list.length ? list.slice(0, 18).map((u, i) => {
          const name = typeof esc === 'function' ? esc(u.username) : u.username;
          const pct = u.match || matchPercent(ME && ME.id, u.id);
          const size = 54 + ((i * 13) % 28);
          const left = 4 + ((i * 37) % 78);
          const top = 4 + ((i * 53) % 68);
          return `<button type="button" class="soul-orbit" data-id="${u.id}" style="width:${size}px;height:${size}px;left:${left}%;top:${top}%">
            <img src="${avaUrl(u)}" alt="">
            <em>${pct}%</em>
            <small>${name}</small>
          </button>`;
        }).join('') : '<div class="soul-empty">لا يوجد أشخاص للعرض الآن</div>';
        $$('#soulPeople .soul-orbit').forEach(el => {
          el.onclick = () => { if (typeof openProfile === 'function') openProfile(+el.dataset.id); };
        });
      } catch (e) {
        people.innerHTML = '<div class="soul-empty" style="grid-column:1/-1">تعذر تحميل الاكتشاف</div>';
      }
    } else if (tab === 'rank') {
      try {
        const d = await api('/api/leaderboard?kind=senders');
        const list = (d && d.rows) || [];
        rank.innerHTML = list.length ? list.map((u, i) => `<div class="soul-row">
          <span class="pos">${i + 1}</span>
          <span class="ava"><img src="${avaUrl(u)}" alt=""></span>
          <div class="info"><b>${typeof esc === 'function' ? esc(u.username) : u.username}</b><small>${u.gold || 0} 🪙 مرسلة</small></div>
        </div>`).join('') : '<div class="soul-empty">لا يوجد ترتيب بعد</div>';
      } catch (e) {
        rank.innerHTML = '<div class="soul-empty">تعذر تحميل الترتيب</div>';
      }
    }
  }

  async function soulOpenFriends(tab) {
    if (!needAuth()) return;
    soulCloseNav('friendsOv');
    openOv('friendsOv');
    soulSetNavActive('friends');
    soulRenderFriends(tab || 'followers');
  }

  async function soulRenderFriends(tab) {
    $$('#friendsOv .soul-tabs button').forEach(b => b.classList.toggle('active', b.dataset.ftab === tab));
    const box = $('#soulFriendsList');
    if (!box) return;
    try {
      const d = await api('/api/friends');
      const list = (d && d[tab]) || [];
      FOLLOW_SET = new Set((d.following || []).map(u => +u.id));
      box.innerHTML = list.length ? list.map(u => {
        const on = FOLLOW_SET.has(+u.id);
        const name = typeof esc === 'function' ? esc(u.username) : u.username;
        return `<div class="soul-row" data-id="${u.id}">
          <span class="ava"><img src="${avaUrl(u)}" alt=""></span>
          <div class="info"><b>${name}</b><small>Lv.${u.level || 1} · ID ${u.public_id || '-'}</small></div>
          <button class="soul-follow${on ? ' on' : ''}" data-follow="${u.id}">${on ? 'تتابع' : 'متابعة'}</button>
        </div>`;
      }).join('') : '<div class="soul-empty">لا يوجد أحد في هذه القائمة بعد</div>';
      $$('#soulFriendsList .soul-row').forEach(el => {
        el.onclick = (e) => {
          if (e.target.closest('[data-follow]')) return;
          if (typeof openProfile === 'function') openProfile(+el.dataset.id);
        };
      });
      $$('#soulFriendsList [data-follow]').forEach(btn => {
        btn.onclick = (e) => { e.stopPropagation(); soulToggleFollow(+btn.dataset.follow, btn).then(() => soulRenderFriends(tab)); };
      });
    } catch (e) {
      box.innerHTML = '<div class="soul-empty">تعذر تحميل القائمة</div>';
    }
  }

  let ROOM_COVER_PATH = '';
  async function soulCreateRoom() {
    if (!needAuth()) return;
    if (typeof ME !== 'undefined' && ME && !ME.registered) {
      if (typeof openOv === 'function') openOv('needRegOv');
      return;
    }
    ROOM_COVER_PATH = '';
    const preview = $('#soulCoverPreview');
    if (preview) { preview.style.backgroundImage = ''; preview.textContent = 'إضافة صورة الغرفة'; }
    const err = $('#soulRoomErr'); if (err) err.textContent = '';
    openOv('createRoomOv');
    const box = $('#soulOwnRoom');
    if (box) {
      box.hidden = true;
      try {
        const d = await api('/api/rooms/mine');
        if (d && d.room) {
          box.hidden = false;
          box.innerHTML = `لديك غرفة <b>${typeof esc === 'function' ? esc(d.room.name) : d.room.name}</b> — احذفها لإنشاء غرفة جديدة
            <button type="button" id="soulDeleteMine">حذف الغرفة الحالية</button>`;
          const del = $('#soulDeleteMine');
          if (del) del.onclick = async () => {
            if (!confirm('حذف غرفتك الحالية؟')) return;
            try {
              await api('/api/rooms/' + d.room.id + '/delete', 'POST', {});
              box.hidden = true;
              if (typeof toast === 'function') toast('تم حذف الغرفة');
              if (typeof loadRooms === 'function') loadRooms();
            } catch (e) {
              if (typeof toast === 'function') toast((e && e.error) || 'تعذر الحذف', false);
            }
          };
        }
      } catch (e) { }
    }
  }

  async function soulSubmitRoom() {
    const name = ($('#soulRoomName') && $('#soulRoomName').value || '').trim();
    const description = ($('#soulRoomDesc') && $('#soulRoomDesc').value || '').trim();
    const password = ($('#soulRoomPass') && $('#soulRoomPass').value || '').trim();
    const err = $('#soulRoomErr');
    if (!name) { if (err) err.textContent = 'اكتب اسم الغرفة'; return; }
    if (name.includes('تطابق') || description.includes('تطابق')) {
      if (err) err.textContent = 'التطابق الصوتي مكالمة وليس غرفة';
      return;
    }
    try {
      const modeBtn = document.querySelector('#soulModePicks button.active');
      const party_mode = (modeBtn && modeBtn.dataset.mode) || 'chat';
      const seat_count = (typeof soulSeatPicked === 'function') ? soulSeatPicked() : 8;
      const d = await api('/api/rooms/create', 'POST', { name, description, password, party_mode, type: party_mode === 'live' ? 'live' : 'voice', image: ROOM_COVER_PATH, seat_count: party_mode === 'partner' ? 2 : seat_count });
      closeOv('createRoomOv');
      if (typeof toast === 'function') toast('تم إنشاء الغرفة 🎤');
      if (typeof loadRooms === 'function') await loadRooms();
      else soulRenderRooms();
      if (d && d.id && typeof enterRoom === 'function') enterRoom(d.id);
    } catch (e) {
      if (err) err.textContent = (e && e.error) || 'تعذر إنشاء الغرفة';
    }
  }

  async function soulOpenPkPicker() {
    if (!needAuth() || !CUR_ROOM) return;
    const box = $('#soulPkRooms');
    openOv('pkPickOv');
    const list = (typeof ROOMS !== 'undefined' ? ROOMS : []).filter(r => r.id !== CUR_ROOM.id && r.type === 'voice');
    if (!box) return;
    box.innerHTML = list.length ? list.map(r => `<button class="soul-row" data-id="${r.id}" type="button" style="width:100%;background:transparent;border:0;color:#fff">
      <span class="ava"><img src="${r.image || '/img/room.png'}" alt=""></span>
      <div class="info"><b>${typeof esc === 'function' ? esc(r.name) : r.name}</b><small>تحدّي هذه الغرفة</small></div>
    </button>`).join('') : '<div class="soul-empty">لا توجد غرف أخرى للتحدي</div>';
    $$('#soulPkRooms [data-id]').forEach(btn => {
      btn.onclick = async () => {
        try {
          const d = await api('/api/pk/start', 'POST', { room_id: CUR_ROOM.id, opponent_room_id: +btn.dataset.id });
          closeOv('pkPickOv');
          soulPaintPk(d && d.pk);
          if (typeof toast === 'function') toast('بدأت جولة PK ⚡');
        } catch (e) {
          if (typeof toast === 'function') toast((e && e.error) || 'تعذر بدء PK', false);
        }
      };
    });
  }

  function soulPaintMe() {
    soulPaintCoins();
    soulLoadSocial();
    const idl = $('#soulMeId');
    if (idl && typeof ME !== 'undefined' && ME) idl.textContent = ME.public_id || SOCIAL.public_id || '-';
  }

  function soulAfterBoot() {
    document.body.classList.add('soul-app');
    if (typeof ME === 'undefined' || !ME) {
      if (typeof showLoginTab === 'function') showLoginTab('member');
      if (typeof openLogin === 'function') openLogin();
      soulShowHomeNav(false);
    } else {
      soulShowHomeNav(true);
      soulPaintMe();
      soulRenderRooms();
    }
    const brand = $('#soulLoginBrand');
    if (brand) brand.textContent = 'SoulChill';
    document.title = 'SoulChill';
  }

  function wire() {
    document.body.classList.add('soul-app');

    const gBtn = $('#soulGmailBtn');
    if (gBtn && !gBtn.querySelector('svg')) gBtn.insertAdjacentHTML('afterbegin', gmailSvg());
    if (gBtn) gBtn.onclick = () => {
      if (typeof showLoginTab === 'function') showLoginTab('member');
      const u = $('#lUser'); if (u) u.focus();
    };
    const guestT = $('#soulGuestToggle');
    if (guestT) guestT.onclick = () => { if (typeof showLoginTab === 'function') showLoginTab('guest'); };

    const lUser = $('#lUser');
    if (lUser) {
      lUser.placeholder = 'بريد Gmail أو اسم المستخدم';
      lUser.setAttribute('inputmode', 'email');
    }

    $$('#soulRoomCats [data-rcat]').forEach(b => {
      b.onclick = () => {
        ROOM_CAT = b.dataset.rcat;
        $$('#soulRoomCats [data-rcat]').forEach(x => x.classList.toggle('active', x === b));
        soulRenderRooms();
      };
    });

    const coins = $('#soulCoinsBtn');
    if (coins) coins.onclick = () => {
      if (!needAuth()) return;
      if (typeof openBuy === 'function') openBuy();
    };
    const shop = $('#soulShopBtn');
    if (shop) shop.onclick = () => {
      if (!needAuth()) return;
      if (typeof soulOpenShop === 'function') soulOpenShop('coins');
      else if (typeof openBuy === 'function') openBuy();
    };
    const bell = $('#soulBellBtn');
    if (bell) bell.onclick = () => {
      if (!needAuth()) return;
      soulCloseNav('notifOv');
      if (typeof openNotifs === 'function') openNotifs();
    };
    const fab = $('#soulCreateRoomBtn');
    if (fab) fab.onclick = soulCreateRoom;
    const make = $('#soulCreateGo');
    if (make) make.onclick = soulSubmitRoom;
    const imgInp = $('#soulRoomImg');
    if (imgInp) imgInp.onchange = async () => {
      const f = imgInp.files && imgInp.files[0];
      if (!f) return;
      const fd = new FormData();
      fd.append('file', f);
      try {
        const d = await api('/api/rooms/cover', 'POST', fd, true);
        ROOM_COVER_PATH = d.path || '';
        const preview = $('#soulCoverPreview');
        if (preview) {
          preview.textContent = '';
          preview.style.backgroundImage = 'url(' + ROOM_COVER_PATH + ')';
        }
      } catch (e) {
        if (typeof toast === 'function') toast((e && e.error) || 'تعذر رفع الصورة', false);
      }
    };

    $$('#discoverOv .soul-tabs button').forEach(b => b.onclick = () => soulRenderDiscover(b.dataset.dtab));
    $$('#friendsOv .soul-tabs button').forEach(b => b.onclick = () => soulRenderFriends(b.dataset.ftab));

    const dockGift = $('#soulDockGift');
    if (dockGift) dockGift.onclick = () => {
      if (!needAuth()) return;
      const hosts = (typeof liveBroadcastHostIds === 'function') ? liveBroadcastHostIds() : new Set();
      const first = (ROOM_USERS || []).find(u => hosts.has(+u.id) && (!ME || u.id !== ME.id))
        || (ROOM_USERS || []).find(u => !ME || u.id !== ME.id);
      if (first && typeof openGifts === 'function') openGifts(first);
      else if (typeof toast === 'function') toast('اختر شخصاً لإرسال الهدية', false);
    };
    const dockMenu = $('#soulDockMenu');
    if (dockMenu) dockMenu.onclick = () => {
      const bar = $('#inputBar');
      if (bar) {
        bar.classList.toggle('soul-composer-open');
        const i = $('#msgInput');
        if (bar.classList.contains('soul-composer-open') && i) i.focus();
      }
    };
    const dockGames = $('#soulDockGames');
    if (dockGames) dockGames.onclick = () => {
      if (typeof openOv === 'function') openOv('soulGameOv');
    };
    const dockMic = $('#soulDockMic');
    if (dockMic) dockMic.onclick = soulHandleMic;
    const dockMore = $('#soulDockMore');
    if (dockMore) dockMore.onclick = () => { const b = $('#btnRoomMore'); if (b) b.click(); };
    const dockSpeaker = $('#soulDockSpeaker');
    if (dockSpeaker) dockSpeaker.onclick = () => { const b = $('#liveBarMute'); if (b) b.click(); };
    const dockHello = $('#soulDockHello');
    if (dockHello) dockHello.onclick = () => {
      const i = $('#msgInput');
      if (!i || typeof sendMsg !== 'function') return;
      i.value = 'مرحبا 👋';
      sendMsg();
    };
    const dockChat = $('#soulDockChat');
    if (dockChat) dockChat.onclick = () => { const i = $('#msgInput'); if (i) i.focus(); };
    const lockBtn = $('#dropLockMics');
    if (lockBtn) lockBtn.onclick = soulToggleMicLock;
    const folStat = $('#soulMeFollowers');
    if (folStat && folStat.parentElement) folStat.parentElement.onclick = () => soulOpenFriends('followers');

    const momFlag = $('#soulMomentsFlag');
    if (momFlag) momFlag.onclick = () => {
      if (typeof soulOpenEvents === 'function') soulOpenEvents();
      else if (typeof openOv === 'function') openOv('soulEventsOv');
    };

    const pkWatch = $('#soulPkWatch');
    if (pkWatch) pkWatch.onclick = () => {
      closeOv('discoverOv');
      ROOM_CAT = 'pk';
      $$('#soulRoomCats [data-rcat]').forEach(x => x.classList.toggle('active', x.dataset.rcat === 'pk'));
      if (typeof showScreen === 'function') showScreen('rooms');
      soulRenderRooms();
    };

    const pkBtn = $('#dropStartPk');
    if (pkBtn) pkBtn.onclick = () => {
      const bg = $('#roomDropBg'); const drop = $('#roomDrop');
      if (drop) drop.classList.remove('open');
      if (bg) bg.style.display = 'none';
      soulOpenPkPicker();
    };

    const usFollow = $('#usFollow');
    if (usFollow) usFollow.onclick = () => {
      if (typeof CUR_TARGET === 'undefined' || !CUR_TARGET) return;
      soulToggleFollow(CUR_TARGET.id, usFollow);
    };

    $$('.bn-item').forEach(b => {
      b.onclick = () => {
        const nav = b.dataset.nav;
        if (nav === 'rooms') {
          soulCloseNav(null);
          if (typeof CUR_ROOM !== 'undefined' && CUR_ROOM && typeof showScreen === 'function') {
            /* زر الغرف من داخل الغرفة = العودة للقائمة */
          }
          if (typeof leaveRoom !== 'function' || !CUR_ROOM) {
            if (typeof showScreen === 'function') showScreen('rooms');
          } else {
            if (typeof showScreen === 'function') showScreen('rooms');
          }
          soulSetNavActive('rooms');
          soulShowHomeNav(true);
        } else if (nav === 'discover') soulOpenDiscover();
        else if (nav === 'wall') {
          if (!needAuth()) return;
          soulCloseNav('wallOv');
          if (typeof openWall === 'function') openWall();
          soulSetNavActive('wall');
        }
        else if (nav === 'friends') soulOpenFriends('followers');
        else if (nav === 'private') {
          if (!needAuth()) return;
          soulCloseNav('privOv');
          if (typeof PRIV_UNREAD !== 'undefined') PRIV_UNREAD = 0;
          if (typeof updatePrivBadge === 'function') updatePrivBadge();
          if (typeof openPrivateList === 'function') openPrivateList();
          soulSetNavActive('private');
        } else if (nav === 'menu') {
          if (!needAuth()) return;
          soulCloseNav('menuOv');
          if (typeof openMenu === 'function') openMenu();
          soulSetNavActive('menu');
          soulPaintMe();
        }
      };
    });

    renderRooms = soulRenderRooms;
    window.renderRooms = soulRenderRooms;
    const rs = $('#roomSearch');
    if (rs) rs.oninput = soulRenderRooms;

    if (typeof renderUsers === 'function') {
      const _ru = renderUsers;
      renderUsers = function () { _ru(); soulRenderSeats(); };
    }
    if (typeof bcastRenderBar === 'function') {
      const _br = bcastRenderBar;
      bcastRenderBar = function () { _br(); soulRenderSeats(); soulPaintMicBtn(); };
    }
    if (typeof bcastApplySpeaking === 'function') {
      const _sp = bcastApplySpeaking;
      bcastApplySpeaking = function () {
        _sp();
        if (typeof BCAST_LEVELS !== 'undefined' && BCAST_LEVELS.forEach) {
          BCAST_LEVELS.forEach((e, hostId) => {
            const seat = document.querySelector('.soul-seat[data-uid="' + hostId + '"]');
            if (seat) seat.classList.toggle('is-speaking', !!e.speaking);
          });
        }
      };
    }
    if (typeof closeNavPages === 'function') {
      const _cnp = closeNavPages;
      closeNavPages = function (except) {
        _cnp(except);
        ['discoverOv', 'friendsOv', 'createRoomOv', 'pkPickOv'].forEach(id => {
          if (id !== except && typeof closeOv === 'function') closeOv(id);
        });
      };
    }
    if (typeof showScreen === 'function') {
      const _ss = showScreen;
      showScreen = function (name) {
        _ss(name);
        const inChat = name === 'chat';
        soulShowHomeNav(!inChat);
        document.body.classList.toggle('soul-in-room', inChat);
        if (inChat) soulPrepareRoom();
        else soulResetRoomUi();
        if (!inChat) soulSetNavActive(name === 'rooms' ? 'rooms' : name);
      };
    }
    if (typeof refreshNav === 'function') {
      refreshNav = function () {
        const navPages = { menuOv: 'menu', notifOv: 'notifs', privOv: 'private', wallOv: 'wall', discoverOv: 'discover', friendsOv: 'friends' };
        let openNav = null;
        for (const id in navPages) {
          const el = document.getElementById(id);
          if (el && el.classList.contains('open')) openNav = navPages[id];
        }
        const inChat = $('#chatScreen') && $('#chatScreen').classList.contains('active');
        soulShowHomeNav(!inChat);
        soulSetNavActive(openNav || 'rooms');
      };
    }
    if (typeof onLoggedIn === 'function') {
      const _ol = onLoggedIn;
      onLoggedIn = function () {
        _ol();
        const bm = $('#bnMenu');
        if (bm && typeof ME !== 'undefined' && ME && typeof avatarHtml === 'function') {
          bm.innerHTML = `<span class="bn-ava" id="bnMenuIcon">${avatarHtml(ME.avatar, '', typeof frameOf === 'function' ? frameOf(ME) : '')}</span><span>أنا</span>`;
        }
        soulPaintMe();
        soulShowHomeNav(true);
        if (typeof closeOv === 'function') closeOv('loginOv');
      };
    }
    if (typeof openLogin === 'function') {
      const _og = openLogin;
      openLogin = function () {
        if (typeof showLoginTab === 'function') showLoginTab('member');
        _og();
      };
    }
    if (typeof openMenu === 'function') {
      const _om = openMenu;
      openMenu = function () { _om(); soulPaintMe(); };
    }
    if (typeof openUserSheet === 'function') {
      const _ous = openUserSheet;
      openUserSheet = function (uid, msg, anchor) {
        _ous(uid, msg, anchor);
        const btn = $('#usFollow');
        const lab = $('#usFollowLabel');
        if (btn && lab) {
          const on = FOLLOW_SET.has(+uid);
          lab.textContent = on ? 'إلغاء المتابعة' : 'متابعة';
          btn.style.display = (typeof ME !== 'undefined' && ME && +uid === +ME.id) ? 'none' : '';
        }
      };
    }
    if (typeof connectSocket === 'function') {
      const _cs = connectSocket;
      connectSocket = function () {
        _cs.apply(this, arguments);
        setTimeout(() => soulBindSocket(typeof SOCKET !== 'undefined' ? SOCKET : null), 30);
      };
    }
    if (typeof SOCKET !== 'undefined') soulBindSocket(SOCKET);
    if (typeof SHEET_SCALE_OVS !== 'undefined' && Array.isArray(SHEET_SCALE_OVS)) {
      const i = SHEET_SCALE_OVS.indexOf('loginOv');
      if (i >= 0) SHEET_SCALE_OVS.splice(i, 1);
    }

    const doLogin = $('#doLogin');
    if (doLogin) {
      const prev = doLogin.onclick;
      doLogin.addEventListener('click', () => {
        const v = ($('#lUser') && $('#lUser').value || '').trim();
        if (v.includes('@') && !GMAIL_RE.test(v)) {
          const err = $('#loginErr');
          if (err) err.textContent = 'استخدم حساب Gmail ينتهي بـ @gmail.com';
        }
      }, true);
    }
  }

  window.soulAfterBoot = soulAfterBoot;
  window.soulRenderRooms = soulRenderRooms;
  window.soulRenderSeats = soulRenderSeats;
  window.soulToggleFollow = soulToggleFollow;
  window.soulOpenDiscover = soulOpenDiscover;
  window.soulOpenFriends = soulOpenFriends;
  window.soulPaintCoins = soulPaintCoins;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
