/* ==========================================================================
   SoulChill UI — وحدة التحكم بالواجهة الجديدة
   تعمل فوق تطبيق الدردشة القائم: تقرأ نفس الجلسة والبيانات وتستدعي نفس دوال
   الغرف/الهدايا/الخاص الموجودة في app.js، وتضيف الشاشات الجديدة:
   الكوكب • حفلة • المنشورات • رسائل • أنت • وواجهة الغرفة الصوتية.
   ========================================================================== */
(function () {
  'use strict';
  if (window.SC && window.SC.__mounted) return;

  /* ------------------------------ أدوات عامة ------------------------------ */
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.from((r || document).querySelectorAll(s));
  const E = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = n => String(n).padStart(2, '0');
  const num = n => (+n || 0).toLocaleString('en-US');
  const nowSec = () => Math.floor(Date.now() / 1000);

  // الوصول الآمن لمتغيّرات app.js المُعلنة بـ let/const (ليست على window)
  const G = {
    get me() { return typeof ME !== 'undefined' ? ME : null; },
    get rooms() { return (typeof ROOMS !== 'undefined' && Array.isArray(ROOMS)) ? ROOMS : []; },
    get counts() { return typeof ROOM_COUNTS !== 'undefined' ? ROOM_COUNTS : {}; },
    get roomUsers() { return (typeof ROOM_USERS !== 'undefined' && Array.isArray(ROOM_USERS)) ? ROOM_USERS : []; },
    get curRoom() { return typeof CUR_ROOM !== 'undefined' ? CUR_ROOM : null; },
    get settings() { return typeof SETTINGS !== 'undefined' ? SETTINGS : {}; },
    get socket() { return typeof SOCKET !== 'undefined' ? SOCKET : null; },
    get notifUnread() { return typeof NOTIF_UNREAD !== 'undefined' ? (+NOTIF_UNREAD || 0) : 0; },
    get privUnread() { return typeof PRIV_UNREAD !== 'undefined' ? (+PRIV_UNREAD || 0) : 0; },
    get bcast() { return typeof BCAST !== 'undefined' ? BCAST : null; }
  };
  const fn = name => (typeof window[name] === 'function' ? window[name] : null);
  const call = (name, ...args) => { const f = fn(name); if (!f) { toastSafe('هذه الميزة غير متاحة الآن'); return null; } try { return f(...args); } catch (e) { console.warn('[SC]', name, e); return null; } };
  function toastSafe(msg, ok) {
    const f = fn('toast');
    if (f) { try { return f(msg, ok !== false); } catch (e) { } }
    console.log('[SC]', msg);
  }
  function siteName() {
    const seo = window.SEO_PAGE_CONFIG && window.SEO_PAGE_CONFIG.site_name;
    return seo || G.settings.site_name || 'SoulChill';
  }

  /* ------------------------------ نداءات الشبكة ------------------------------ */
  async function jget(url) {
    const h = { 'X-Chat-Client': '1' };
    if (typeof CHAT_TOKEN !== 'undefined' && CHAT_TOKEN) h['X-Chat-Token'] = CHAT_TOKEN;
    const r = await fetch(url, { credentials: 'same-origin', headers: h });
    if (!r.ok) { const err = new Error('http_' + r.status); err.status = r.status; throw err; }
    return r.json();
  }
  async function jpost(url, body, isForm) {
    const h = { 'X-Chat-Client': '1' };
    if (typeof CHAT_TOKEN !== 'undefined' && CHAT_TOKEN) h['X-Chat-Token'] = CHAT_TOKEN;
    if (!isForm) h['Content-Type'] = 'application/json';
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: h, body: isForm ? body : JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const err = new Error(d.error || ('http_' + r.status)); err.payload = d; err.status = r.status; throw err; }
    return d;
  }

  /* ------------------------------ المستويات والأدوار ------------------------------ */
  const LEVEL_BY_MEMBERSHIP = { none: 1, '': 1, registered: 2, mmez: 8, plus: 12, premium: 18, vip: 26 };
  const MEMBERSHIP_LABEL = { none: 'عضو', '': 'عضو', registered: 'مسجّل', mmez: 'مميز', plus: 'بلس', premium: 'بريميوم', vip: 'SVIP' };
  const LEVEL_BY_RANK = { roomadmin: 30, admin: 40, superadmin: 50, supermaster: 60 };
  function levelOf(u) {
    if (!u) return 1;
    if (LEVEL_BY_RANK[u.rank]) return LEVEL_BY_RANK[u.rank];
    const lv = LEVEL_BY_MEMBERSHIP[u.membership];
    if (lv) return u.registered === 0 ? Math.min(lv, 1) || 1 : lv;
    return u.registered ? 2 : 1;
  }
  function levelChip(u) { return `<span class="sc-lvl-chip">Lv.${levelOf(u)}</span>`; }
  function roleChips(u) {
    const out = [];
    if (!u) return '';
    if (u.verified) out.push('<span class="sc-role-chip-mini pink">الرسمي</span>');
    if (u.rank === 'roomadmin' || u.rank === 'admin' || u.rank === 'superadmin' || u.rank === 'supermaster') out.push('<span class="sc-role-chip-mini gold">مشرف</span>');
    else if (u.membership === 'vip') out.push('<span class="sc-role-chip-mini gold">SVIP</span>');
    else if (u.membership === 'mmez') out.push('<span class="sc-role-chip-mini pink">مميز</span>');
    else if (u.membership === 'premium') out.push('<span class="sc-role-chip-mini">بريميوم</span>');
    else if (u.registered) out.push('<span class="sc-role-chip-mini">نشيط</span>');
    else out.push('<span class="sc-role-chip-mini">زائر</span>');
    return out.join('');
  }
  const AVI = (u, cls) => {
    const av = u && u.avatar ? u.avatar : '';
    const frame = u && u.avatar_frame ? u.avatar_frame : '';
    const f = fn('avatarHtml');
    if (f) { try { return f(av, cls || '', frame); } catch (e) { } }
    return `<img class="${E(cls || '')}" src="${E(av || '/avatars/default.png')}" alt="">`;
  };
  const FRAME_RING = u => {
    const f = String((u && u.avatar_frame) || '');
    if (/gold|royal|diamond|platinum/i.test(f)) return 'gold';
    if (/pink|hearts|sunset|fire/i.test(f)) return 'pink';
    if (/blue|ice|aurora|galaxy/i.test(f)) return 'blue';
    return '';
  };

  /* ------------------------------ التواريخ ------------------------------ */
  function timeLabel(ts) {
    ts = +ts || 0;
    if (!ts) return '';
    const diff = nowSec() - ts;
    if (diff < 60) return 'الآن';
    if (diff < 3600) return 'قبل ' + Math.floor(diff / 60) + ' دقيقة';
    const d = new Date(ts * 1000);
    if (diff < 86400) return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    if (diff < 172800) return 'منذ يومين';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function fullDate(ts) {
    const d = new Date((+ts || 0) * 1000);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /* ------------------------------ الدول ------------------------------ */
  const COUNTRIES = [
    { k: 'الأردن', f: '🇯🇴', m: ['الأردن', 'اردن', 'الاردن'] },
    { k: 'لبنان', f: '🇱🇧', m: ['لبنان'] },
    { k: 'السعودية', f: '🇸🇦', m: ['السعودية', 'سعودي', 'الرياض', 'جدة'] },
    { k: 'المغرب', f: '🇲🇦', m: ['المغرب', 'مغربي'] },
    { k: 'أمريكا', f: '🇺🇸', m: ['أمريكا', 'امريكا'] },
    { k: 'فلسطين', f: '🇵🇸', m: ['فلسطين', 'فلسطيني', 'غزة', 'القدس'] },
    { k: 'سوريا', f: '🇸🇾', m: ['سوريا', 'سوري', 'حلب', 'دمشق'] },
    { k: 'العراق', f: '🇮🇶', m: ['العراق', 'عراقي', 'بغداد'] },
    { k: 'مصر', f: '🇪🇬', m: ['مصر', 'مصري', 'القاهرة'] },
    { k: 'الجزائر', f: '🇩🇿', m: ['الجزائر', 'جزائري'] },
    { k: 'تونس', f: '🇹🇳', m: ['تونس', 'تونسي'] },
    { k: 'اليمن', f: '🇾🇪', m: ['اليمن', 'يمني', 'صنعاء', 'عدن'] },
    { k: 'الكويت', f: '🇰🇼', m: ['الكويت', 'كويتي'] },
    { k: 'الإمارات', f: '🇦🇪', m: ['الإمارات', 'الامارات', 'دبي', 'أبو ظبي'] },
    { k: 'قطر', f: '🇶🇦', m: ['قطر', 'قطري'] },
    { k: 'عمان', f: '🇴🇲', m: ['عمان', 'مسقط'] },
    { k: 'البحرين', f: '🇧🇭', m: ['البحرين', 'بحريني'] },
    { k: 'ليبيا', f: '🇱🇾', m: ['ليبيا', 'ليبي'] },
    { k: 'السودان', f: '🇸🇩', m: ['السودان', 'سوداني'] }
  ];
  function countryOf(room) {
    const name = String((room && room.name) || '');
    for (const c of COUNTRIES) if (c.m.some(m => name.includes(m))) return c;
    return null;
  }
  function countryByName(name) { return COUNTRIES.find(c => c.k === name) || COUNTRIES[0]; }

  /* ------------------------------ الحالة ------------------------------ */
  const S = {
    mounted: false,
    tab: 'planet',
    boot: null,
    posts: [],
    postTab: 'posts',
    convs: [],
    msgFilter: 'all',
    msgQuery: '',
    cat: 'ترشيحات',
    country: 'الأردن',
    thumbs: {},
    following: (() => { try { return new Set(JSON.parse(localStorage.getItem('sc_follow_rooms') || '[]')); } catch (e) { return new Set(); } })(),
    win: null,
    tasks: null,
    roomsLoaded: false
  };
  window.SC = {
    build: 'sc8',
    get state() { return S; },
    go, refresh: loadAll, sheetOpen, sheetClose,
    refreshRoom() { if (G.curRoom) { renderSeats(); renderRoomSub(); renderRoomHead(); renderVisitors(); syncMicState(); } },
    openSelfSheet, leaveMic, toggleMyMute, appBcast
  };
  window.SC.__mounted = true;

  /* ==========================================================================
     الشريط السفلي
     ========================================================================== */
  const TABS = [
    { id: 'planet', label: 'الكوكب', icon: 'planet_fill' },
    { id: 'party', label: 'حفلة', icon: 'house_fill' },
    { id: 'posts', label: 'المنشورات', icon: 'doc_text_fill' },
    { id: 'msgs', label: 'رسائل', icon: 'bubble_left_fill' },
    { id: 'me', label: 'أنت', icon: 'person_fill' }
  ];
  function renderNav() {
    const nav = q('#scNav');
    if (!nav) return;
    nav.innerHTML = TABS.map(t => {
      if (t.id === 'me') {
        const me = G.me;
        const avatar = me ? AVI(me, 'sc-tab-ava') : '<i class="f7-icons">person_fill</i>';
        return `<button class="sc-tab" data-tab="me">${avatar}<span>${t.label}</span><em class="sc-tab-dot" id="scTabMeDot" style="display:none"></em></button>`;
      }
      const badge = t.id === 'msgs' ? '<em class="sc-tab-dot" id="scTabMsgDot" style="display:none"></em>' : '';
      return `<button class="sc-tab" data-tab="${t.id}"><i class="f7-icons">${t.icon}</i><span>${t.label}</span>${badge}</button>`;
    }).join('');
    qa('.sc-tab', nav).forEach(b => b.onclick = () => go(b.dataset.tab));
    syncNav();
  }
  function syncNav() {
    const nav = q('#scNav');
    if (!nav) return;
    qa('.sc-tab', nav).forEach(b => b.classList.toggle('on', !!S.tab && b.dataset.tab === S.tab));
    const msgDot = q('#scTabMsgDot');
    if (msgDot) msgDot.style.display = (G.me && G.privUnread > 0) ? '' : 'none';
    const meDot = q('#scTabMeDot');
    if (meDot) meDot.style.display = (G.me && G.notifUnread > 0) ? '' : 'none';
    const setDot = q('#scMeSettingsDot');
    if (setDot) setDot.style.display = (G.me && G.notifUnread > 0) ? '' : 'none';
  }

  const SCREEN_MAP = { planet: 'planetScreen', party: 'partyScreen', posts: 'postsScreen', msgs: 'msgsScreen', me: 'meScreen' };

  // تنشيط شاشة من شاشات الواجهة الجديدة (لا نستخدم showScreen هنا لأنها مخصّصة لشاشات app.js)
  function activateScreen(tab) {
    const el = q('#' + SCREEN_MAP[tab]);
    if (!el) return false;
    qa('.screen').forEach(s => s.classList.remove('active'));
    el.classList.add('active');
    return true;
  }

  function go(tab) {
    S.tab = tab;
    if (!activateScreen(tab)) return;
    unmountRoom();
    const nav = q('#scNav');
    if (nav) nav.classList.remove('sc-nav-hidden');
    renderTab(tab);
    const scroll = q('#' + SCREEN_MAP[tab] + ' .sc-scroll');
    if (scroll) scroll.scrollTop = 0;
  }

  function renderTab(tab) {
    if (tab === 'planet') renderPlanet();
    else if (tab === 'party') renderParty();
    else if (tab === 'posts') renderPosts();
    else if (tab === 'msgs') renderMsgs();
    else if (tab === 'me') renderMe();
    syncNav();
  }

  /* ==========================================================================
     شاشة الكوكب
     ========================================================================== */
  function renderPlanet() {
    const me = G.me;
    const role = q('#scPlanetRole');
    if (role) role.innerHTML = `<i class="f7-icons">planet_fill</i>${me ? (levelOf(me) >= 26 ? 'المؤدي' : 'عضو') : 'زائر'}`;
    const logo = q('#scPlanetLogo');
    if (logo) logo.textContent = siteName();

    // شارة الحضور اليومي
    const ci = q('#scCheckinBtn');
    if (ci) {
      const done = checkinDoneToday();
      ci.classList.toggle('sc-gold', !done);
      ci.innerHTML = `<i class="f7-icons">${done ? 'checkmark_circle_fill' : 'calendar_badge_clock_fill'}</i>`;
      ci.title = done ? 'تم تسجيل حضورك اليوم' : 'تسجيل الحضور اليومي';
    }

    renderOrbit();
    const online = q('#scPlanetOnline');
    if (online) {
      const count = S.boot && S.boot.online_total ? S.boot.online_total : totalOnline();
      online.innerHTML = `<span class="sc-live-dot"></span>عدد المستخدمين الأونلاين:&nbsp;<b>${num(count)}</b>`;
    }
    const usersBox = q('#scPlanetActiveUsers');
    if (usersBox) {
      const users = (S.boot && S.boot.planet_users) || [];
      usersBox.innerHTML = users.slice(0, 8).map(u => `
        <div class="sc-user-row" data-uid="${u.id}">
          ${AVI(u, '')}
          <div>
            <div class="sc-ur-name">${E(u.username)} ${u.verified ? '<i class="f7-icons" style="font-size:12px;color:#c084fc">checkmark_seal_fill</i>' : ''}</div>
            <div class="sc-ur-sub">${levelChip(u)}${u.room ? ' في ' + E(u.room) : (u.online ? ' متصل الآن' : '')}</div>
          </div>
          <button class="sc-ur-go">مكالمة</button>
        </div>`).join('') || '<div class="sc-empty-card">لا يوجد أعضاء متصلون الآن</div>';
      qa('.sc-user-row', usersBox).forEach(row => {
        const u = ((S.boot && S.boot.planet_users) || []).find(x => +x.id === +row.dataset.uid);
        if (!u) return;
        row.onclick = () => openUserActions(u);
      });
    }
  }

  function totalOnline() {
    const c = G.counts || {};
    let sum = 0;
    Object.keys(c).forEach(k => sum += (+c[k] || 0));
    return sum;
  }

  function renderOrbit() {
    const host = q('#scOrbit');
    if (!host) return;
    const users = ((S.boot && S.boot.planet_users) || []).slice(0, 14);
    if (!users.length) {
      host.innerHTML = '<div class="sc-empty-card" style="position:absolute;inset:auto 20% 20% 20%;padding:0">لا مستخدمين لعرضهم على الكوكب بعد</div>';
      return;
    }
    const rings = [
      { rad: 118, cls: '', count: Math.min(8, users.length) },
      { rad: 168, cls: 'sc-orbit-2', count: Math.max(0, Math.min(6, users.length - 8)) }
    ];
    let idx = 0;
    host.innerHTML = rings.map(r => {
      const items = [];
      for (let i = 0; i < r.count; i++) {
        const u = users[idx++];
        if (!u) break;
        const angle = Math.round((360 / r.count) * i);
        const depth = i % 3;
        const scale = depth === 0 ? 1 : (depth === 1 ? .86 : .74);
        const opacity = depth === 0 ? 1 : (depth === 1 ? .82 : .62);
        const blur = depth === 2 ? '0.6px' : '0';
        const ring = FRAME_RING(u) || (i % 3 === 1 ? '' : (i % 3 === 2 ? 'blue' : ''));
        const crown = (u.membership === 'vip' || u.membership === 'mmez' || u.rank === 'admin' || u.rank === 'superadmin')
          ? '<span class="sc-crown">👑</span>' : '';
        items.push(`
          <div class="sc-orbit-item" style="--a:${angle}deg;--rad:${r.rad}px;--s:${scale};--o:${opacity};--bl:${blur}">
            <div class="sc-orbit-user" data-uid="${u.id}">
              <div class="sc-orbit-ava ${ring}">
                ${crown}
                ${AVI(u, 'sc-orbit-img')}
                <span class="sc-orbit-num">${num(u.score || levelOf(u))}</span>
              </div>
              <div class="sc-orbit-name">${E(u.username)}</div>
            </div>
          </div>`);
      }
      return `<div class="sc-orbit ${r.cls}">${items.join('')}</div>`;
    }).join('');
    qa('#scOrbit .sc-orbit-user').forEach(el => el.onclick = () => {
      const u = users.find(x => +x.id === +el.dataset.uid);
      if (u) openUserActions(u);
    });
  }

  /* ==========================================================================
     شاشة حفلة (الغرف)
     ========================================================================== */
  const CATS = ['ترشيحات', 'الفيديو', 'PK', 'YouTube', 'لعبة', 'الأردن'];
  function renderParty() {
    const cats = q('#scPartyCats');
    if (cats) {
      cats.innerHTML = CATS.map(c => `<button class="sc-chip${S.cat === c ? ' on' : ''}" data-cat="${E(c)}">${E(c)}</button>`).join('')
        + `<button class="sc-chip${S.cat === '__all' ? ' on' : ''}" data-cat="__all"><i class="f7-icons" style="font-size:14px">square_grid2x2_fill</i></button>`;
      qa('.sc-chip', cats).forEach(b => b.onclick = () => { S.cat = b.dataset.cat; renderParty(); });
    }
    const strip = q('#scCountryStrip');
    if (strip) {
      strip.innerHTML = COUNTRIES.map(c => `<button class="sc-chip${S.country === c.k ? ' on' : ''}" data-country="${E(c.k)}"><span class="sc-flag">${c.f}</span>${E(c.k)}</button>`).join('')
        + `<button class="sc-chip" id="scMoreCountries"><i class="f7-icons" style="font-size:14px">chevron_left</i></button>`;
      qa('.sc-chip', strip).forEach(b => {
        if (b.id === 'scMoreCountries') return;
        b.onclick = () => { S.country = b.dataset.country; renderParty(); };
      });
      const more = q('#scMoreCountries', strip);
      if (more) more.onclick = () => sheetCountries();
    }
    renderRoomList();
  }

  function roomListFiltered() {
    let list = roomsForRender().slice();
    const counts = G.counts || {};
    list.forEach(r => { r._online = (+counts[r.id] || +r.online || 0); });
    if (S.country) {
      const c = countryByName(S.country);
      const byCountry = list.filter(r => { const cc = countryOf(r); return cc && cc.k === c.k; });
      if (byCountry.length) list = byCountry;
    }
    const cat = S.cat;
    if (cat === 'الفيديو') list = list.filter(r => /فيديو|بث|كام|video/i.test(r.name));
    else if (cat === 'PK') list = list.filter(r => /pk|تحدي|مواجه/i.test(r.name));
    else if (cat === 'YouTube') list = list.filter(r => /يوتيوب|youtube/i.test(r.name));
    else if (cat === 'لعبة') list = list.filter(r => /لعبة|ألعاب|جيمز|game/i.test(r.name));
    else if (cat === 'الأردن') list = list.filter(r => { const c = countryOf(r); return c && c.k === 'الأردن'; });
    list.sort((a, b) => (b._online - a._online) || (a.sort - b.sort));
    return list;
  }

  function renderRoomList() {
    const box = q('#scRoomList');
    if (!box) return;
    const list = roomListFiltered();
    if (!list.length) {
      box.innerHTML = '<div class="sc-empty-card">لا توجد غرف في هذا التصنيف الآن<br><small>جرّب تصنيفاً أو دولة أخرى</small></div>';
      return;
    }
    box.innerHTML = list.slice(0, 40).map((r, i) => roomCardHtml(r, i)).join('');
    qa('.sc-room-card', box).forEach(card => card.onclick = () => {
      const id = +card.dataset.id;
      if (G.curRoom && +G.curRoom.id === id) return toastSafe('أنت في هذه الغرفة الآن 📍');
      call('enterRoom', id);
    });
    loadRoomThumbs(list.slice(0, 8).map(r => r.id));
  }

  function roomCardHtml(r, i) {
    const c = countryOf(r);
    const hue = ['', 'sc-hue-pink', 'sc-hue-violet', 'sc-hue-blue'][i % 4];
    const img = r.image && r.image.startsWith('/') ? r.image : '';
    const thumbs = (S.thumbs[r.id] || []).slice(0, 4).map(t => `<img class="sc-thumb" src="${E(t.avatar || '/avatars/default.png')}" alt="">`).join('');
    const rank = i < 3 ? `<span class="sc-room-rank">${i === 0 ? '👑' : ''}${i + 1}</span>` : '';
    const type = 'دردشة صوتية';
    return `
    <div class="sc-room-card ${hue}${i < 3 ? ' sc-room-top' : ''}" data-id="${r.id}">
      ${img ? `<div class="sc-room-bg" style="background-image:url('${E(img)}')"></div>` : '<div class="sc-room-bg" style="background:linear-gradient(140deg,#4c1d95,#0f172a)"></div>'}
      <div class="sc-room-veil"></div>
      ${rank}
      <div class="sc-room-body">
        <div class="sc-room-face ${FRAME_RING({ avatar_frame: r.image ? 'gold' : '' }) || (i % 3 === 1 ? 'pink' : (i % 3 === 2 ? 'blue' : 'gold'))}">
          <img src="${E(img || '/img/room.png')}" alt="">
        </div>
        <div class="sc-room-info">
          <div class="sc-room-name">${E(r.name)}</div>
          <div class="sc-room-meta">
            ${c ? `<span class="sc-room-tag">${c.f} ${E(c.k)}</span>` : ''}
            <span class="sc-room-tag"><i class="f7-icons" style="font-size:11px">mic_fill</i>${type}</span>
            ${i < 3 ? '<span class="sc-room-tag pk">PK</span>' : ''}
            <span class="sc-room-tag hour"><i class="f7-icons" style="font-size:11px">clock_fill</i>${(i + 1) * 3 + 5}</span>
          </div>
          <div class="sc-room-meta">
            <span class="sc-room-tag" style="background:rgba(0,0,0,.45)"><i class="f7-icons" style="font-size:11px">headphones</i>${num(r._online || 0)}</span>
            ${r.locked ? '<span class="sc-room-tag"><i class="f7-icons" style="font-size:11px">lock_fill</i>محمية</span>' : ''}
          </div>
        </div>
        <div class="sc-room-thumbs">${thumbs}</div>
      </div>
    </div>`;
  }

  async function loadRoomThumbs(ids) {
    const todo = ids.filter(id => !S.thumbs[id]);
    for (const id of todo) {
      try {
        const users = await jget('/api/rooms/' + id + '/users');
        if (Array.isArray(users) && users.length) {
          S.thumbs[id] = users.slice(0, 4).map(u => ({ avatar: u.avatar }));
          const card = q(`.sc-room-card[data-id="${id}"] .sc-room-thumbs`);
          if (card) card.innerHTML = S.thumbs[id].map(t => `<img class="sc-thumb" src="${E(t.avatar || '/avatars/default.png')}" alt="">`).join('');
        } else S.thumbs[id] = [];
      } catch (e) { S.thumbs[id] = []; }
    }
  }

  /* ==========================================================================
     شاشة المنشورات
     ========================================================================== */
  function renderPosts() {
    const tabs = q('#scPostsTabs');
    if (tabs) {
      tabs.innerHTML = [['posts', 'المنشورات'], ['friends', 'الأصدقاء']]
        .map(([k, l]) => `<button class="${S.postTab === k ? 'on' : ''}" data-k="${k}">${l}</button>`).join('');
      qa('button', tabs).forEach(b => b.onclick = () => { S.postTab = b.dataset.k; renderPosts(); });
    }
    const box = q('#scPostsList');
    if (!box) return;
    if (!G.me) {
      box.innerHTML = `<div class="sc-card" style="padding:22px;text-align:center">
        <div style="font-size:34px;margin-bottom:8px">🔒</div>
        <div style="font-weight:800;margin-bottom:6px">سجّل الدخول لعرض المنشورات</div>
        <div style="font-size:12px;color:var(--sc-txt-3);margin-bottom:14px">المنشورات والتعليقات والهدايا تحتاج حساباً</div>
        <button class="sc-btn-primary" id="scPostsLogin">دخول</button>
      </div>`;
      const b = q('#scPostsLogin');
      if (b) b.onclick = () => call('openLogin');
      return;
    }
    if (!S.posts.length) {
      box.innerHTML = '<div class="sc-empty-card">لا توجد منشورات بعد — كن أول من ينشر ✨</div>';
      return;
    }
    let list = S.posts.slice();
    if (S.postTab === 'friends') {
      const friendIds = new Set(S.convs.map(c => +c.id));
      list = list.filter(p => friendIds.has(+p.user_id) || +p.user_id === +(G.me && G.me.id));
    }
    box.innerHTML = list.map(postHtml).join('');
    qa('.sc-post', box).forEach(el => bindPost(el));
  }

  function postHtml(p) {
    const u = p.user || { username: p.username, id: p.user_id, badge: '' };
    const official = !!(u.verified || ['admin', 'superadmin', 'supermaster'].includes(u.rank));
    const reactions = p.reactions || {};
    const likes = Object.values(reactions).reduce((a, b) => a + (+b || 0), 0);
    const myReaction = p.my_reaction || '';
    const comments = (p.comments || []).length;
    const media = p.image ? `<div class="sc-post-media"><img src="${E(p.image)}" alt="" loading="lazy"></div>`
      : (p.video ? `<div class="sc-post-media"><video src="${E(p.video)}" controls playsinline></video></div>` : '');
    const tag = /ترند/i.test(p.text || '') ? '<div class="sc-post-tags"><span class="sc-post-tag"># بـ الترند</span></div>' : '';
    return `
    <div class="sc-post${official ? ' sc-post-official' : ''}" data-id="${p.id}">
      <div class="sc-post-head">
        <div class="sc-post-ava ${official ? 'gold' : ''}">${AVI(u, '')}</div>
        <div class="sc-post-who">
          <b>${E(u.username || '')} ${official ? '<i class="f7-icons" style="font-size:12px;color:var(--sc-gold)">checkmark_seal_fill</i>' : ''}</b>
          <small>${E(fullDate(p.created_at))}${official ? ' • حساب رسمي' : ''}</small>
        </div>
        ${S.following.has(+p.user_id) || +p.user_id === +((G.me || {}).id || 0)
        ? '' : `<button class="sc-post-follow" data-follow="${p.user_id}">متابعة</button>`}
      </div>
      ${p.text ? `<div class="sc-post-text">${E(p.text)}</div>` : ''}
      ${tag}
      ${media}
      <div class="sc-post-actions">
        <button class="sc-act" data-act="comment"><i class="f7-icons">chat_bubble_fill</i>${num(comments)}</button>
        <button class="sc-act${myReaction === '❤️' ? ' on' : ''}" data-act="like"><i class="f7-icons">heart_fill</i>${num(likes)}</button>
        <button class="sc-act" data-act="hi"><i class="f7-icons">gift_fill</i>إرسال تحية</button>
        <button class="sc-act sc-act-more" data-act="more"><i class="f7-icons">ellipsis_vertical</i></button>
      </div>
    </div>`;
  }

  function bindPost(el) {
    const id = +el.dataset.id;
    const post = S.posts.find(p => +p.id === id);
    if (!post) return;
    const followBtn = q('[data-follow]', el);
    if (followBtn) followBtn.onclick = ev => {
      ev.stopPropagation();
      const uid = +followBtn.dataset.follow;
      S.following.add(uid);
      followBtn.classList.add('done');
      followBtn.textContent = 'تتابعه';
      jpost('/api/profile/' + uid + '/like', {}).catch(() => { });
      toastSafe('تتابع هذا الحساب الآن ✨');
    };
    qa('.sc-act', el).forEach(btn => btn.onclick = ev => {
      ev.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'like') likePost(post, btn);
      else if (act === 'comment') sheetComments(post);
      else if (act === 'hi') call('openGifts', { id: post.user_id, username: (post.user && post.user.username) || post.username, avatar: (post.user && post.user.avatar) || '' });
      else if (act === 'more') sheetPostMore(post);
    });
  }

  async function likePost(post, btn) {
    if (!G.me) return call('openLogin');
    try {
      const d = await jpost('/api/wall/' + post.id + '/reaction', { reaction: '❤️' });
      post.reactions = d.reactions || {};
      post.my_reaction = d.my_reaction || '';
      const count = Object.values(post.reactions).reduce((a, b) => a + (+b || 0), 0);
      const icon = q('i', btn);
      btn.classList.toggle('on', post.my_reaction === '❤️');
      btn.innerHTML = `<i class="f7-icons">heart_fill</i>${num(count)}`;
    } catch (e) { toastSafe(e.message || 'تعذر تنفيذ الإعجاب', false); }
  }

  function sheetComments(post) {
    const rows = (post.comments || []).map(c => `
      <div class="sc-user-row">
        ${AVI(c.user || { username: c.username }, '')}
        <div style="min-width:0">
          <div class="sc-ur-name">${E(c.username)}</div>
          <div class="sc-ur-sub" style="white-space:normal">${E(c.text)}</div>
        </div>
        <span class="sc-msg-time" style="margin-inline-start:auto">${E(timeLabel(c.created_at))}</span>
      </div>`).join('') || '<div class="sc-empty-card">لا تعليقات بعد</div>';
    sheetOpen(`<h3>التعليقات</h3><p class="sc-sheet-sub">${num((post.comments || []).length)} تعليق على منشور ${E((post.user && post.user.username) || post.username || '')}</p>
      <div style="max-height:44vh;overflow:auto">${rows}</div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <input class="sc-rb-input" id="scCommentInput" placeholder="اكتب تعليقاً...">
        <button class="sc-btn-primary" style="width:auto;padding:0 18px" id="scCommentSend">إرسال</button>
      </div>`);
    const send = q('#scCommentSend');
    if (send) send.onclick = async () => {
      const input = q('#scCommentInput');
      const text = (input && input.value || '').trim();
      if (!text) return;
      try {
        const d = await jpost('/api/wall/' + post.id + '/comments', { text });
        post.comments = post.comments || [];
        post.comments.push(d.comment || { id: Date.now(), username: (G.me || {}).username, text, created_at: nowSec(), user: G.me });
        sheetClose();
        renderPosts();
        toastSafe('تم إضافة تعليقك');
      } catch (e) { toastSafe(e.message || 'تعذر إرسال التعليق', false); }
    };
  }

  function sheetPostMore(post) {
    const mine = +post.user_id === +((G.me || {}).id || 0);
    sheetOpen(`<h3>خيارات المنشور</h3>
      <div class="sc-sheet-row" data-op="profile"><i class="f7-icons">person_fill</i><b>عرض الحساب</b><i class="f7-icons sc-chev">chevron_left</i></div>
      ${post.image ? `<div class="sc-sheet-row" data-op="image"><i class="f7-icons">photo_fill</i><b>عرض الصورة</b><i class="f7-icons sc-chev">chevron_left</i></div>` : ''}
      ${mine ? `<div class="sc-sheet-row" data-op="delete" style="color:#fca5a5"><i class="f7-icons">trash_fill</i><b>حذف المنشور</b><i class="f7-icons sc-chev">chevron_left</i></div>` : ''}
      <button class="sc-btn-ghost" data-op="close">إلغاء</button>`);
    qa('[data-op]').forEach(row => row.onclick = async () => {
      const op = row.dataset.op;
      sheetClose();
      if (op === 'profile') call('openProfile', post.user_id);
      else if (op === 'image') window.open(post.image, '_blank');
      else if (op === 'delete') {
        try { await fetch('/api/wall/' + post.id, { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Chat-Client': '1', 'X-Chat-Token': (typeof CHAT_TOKEN !== 'undefined' ? CHAT_TOKEN : '') } }); S.posts = S.posts.filter(p => +p.id !== +post.id); renderPosts(); toastSafe('تم حذف المنشور'); }
        catch (e) { toastSafe('تعذر حذف المنشور', false); }
      }
    });
  }

  function sheetNewPost() {
    if (!G.me) return call('openLogin');
    sheetOpen(`<h3>منشور جديد</h3>
      <p class="sc-sheet-sub">شارك لحظتك مع المجتمع — نص + صورة (اختياري)</p>
      <textarea id="scPostText" class="sc-rb-input" style="height:110px;padding:12px;border-radius:16px;width:100%;resize:none" placeholder="بم تفكر؟"></textarea>
      <div id="scPostPreview" style="margin-top:8px"></div>
      <label class="sc-sheet-row" style="cursor:pointer"><i class="f7-icons">photo_fill</i><b>إضافة صورة</b><i class="f7-icons sc-chev">chevron_left</i>
        <input type="file" id="scPostImage" accept="image/*" hidden></label>
      <button class="sc-btn-primary" id="scPostSend" style="margin-top:8px">نشر</button>`);
    let imagePath = '';
    const file = q('#scPostImage');
    if (file) file.onchange = async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const fd = new FormData();
      fd.append('image', f);
      try {
        const d = await jpost('/api/wall/upload-image', fd, true);
        imagePath = d.path || d.image || '';
        const prev = q('#scPostPreview');
        if (prev && imagePath) prev.innerHTML = `<img src="${E(imagePath)}" style="width:100%;border-radius:14px">`;
      } catch (e) { toastSafe('تعذر رفع الصورة', false); }
    };
    const send = q('#scPostSend');
    if (send) send.onclick = async () => {
      const text = (q('#scPostText').value || '').trim();
      if (!text && !imagePath) return toastSafe('اكتب شيئاً أولاً', false);
      try {
        await jpost('/api/wall', { text, image: imagePath });
        sheetClose();
        S.posts = await jget('/api/wall');
        S.postTab = 'posts';
        renderPosts();
        toastSafe('تم نشر منشورك 🎉');
      } catch (e) { toastSafe(e.message || 'تعذر النشر', false); }
    };
  }

  /* ==========================================================================
     شاشة الرسائل
     ========================================================================== */
  function renderMsgs() {
    const filters = q('#scMsgFilters');
    if (filters) {
      filters.innerHTML = [['all', 'الكل'], ['friends', 'الأصدقاء'], ['official', 'الرسمي']]
        .map(([k, l]) => `<button class="${S.msgFilter === k ? 'on' : ''}" data-k="${k}">${l}</button>`).join('');
      qa('button', filters).forEach(b => b.onclick = () => { S.msgFilter = b.dataset.k; renderMsgs(); });
    }
    const box = q('#scMsgsList');
    if (!box) return;
    if (!G.me) {
      box.innerHTML = `<div class="sc-card" style="padding:22px;text-align:center">
        <div style="font-size:34px;margin-bottom:8px">💬</div>
        <div style="font-weight:800;margin-bottom:6px">سجّل الدخول لعرض رسائلك</div>
        <button class="sc-btn-primary" id="scMsgsLogin">دخول</button></div>`;
      const b = q('#scMsgsLogin');
      if (b) b.onclick = () => call('openLogin');
      return;
    }
    const onlineIds = new Set(((S.boot && S.boot.online_ids) || []).map(Number));
    let list = S.convs.slice();
    if (S.msgFilter === 'official') list = list.filter(isOfficialConv);
    else if (S.msgFilter === 'friends') list = list.filter(c => !isOfficialConv(c) && c.registered);
    if (S.msgQuery) list = list.filter(c => String(c.username || '').includes(S.msgQuery));
    list.sort((a, b) => (+b.at || 0) - (+a.at || 0));

    const notif = S.boot && S.boot.last_notif;
    const notifRow = (notif && !S.msgQuery) ? `
      <div class="sc-msg-row" id="scNotifRow" style="background:rgba(239,68,68,.07)">
        <div class="sc-msg-ava"><div class="sc-ava-ring" style="background:linear-gradient(135deg,#ef4444,#b91c1c);display:flex;align-items:center;justify-content:center">
          <i class="f7-icons" style="color:#fff;font-size:22px">bell_fill</i></div></div>
        <div class="sc-msg-body">
          <div class="sc-msg-name">تنبيه</div>
          <div class="sc-msg-last">${E(notif.text || 'لديك إشعار جديد')}</div>
        </div>
        <div class="sc-msg-side"><span class="sc-msg-time">${E(timeLabel(notif.created_at))}</span><i class="f7-icons sc-badge-bell">bell_fill</i></div>
      </div>` : '';

    const rows = list.map(c => `
      <div class="sc-msg-row" data-uid="${c.id}">
        <div class="sc-msg-ava ${FRAME_RING(c) || (isOfficialConv(c) ? 'gold' : '')}">
          <div class="sc-ava-ring">${AVI(c, 'sc-msg-img')}</div>
          ${onlineIds.has(+c.id) ? '<span class="sc-msg-online"></span>' : ''}
        </div>
        <div class="sc-msg-body">
          <div class="sc-msg-name">${E(c.username)} ${isOfficialConv(c) ? '<span class="sc-badge-official">الرسمي</span>' : (c.verified ? '<i class="f7-icons" style="font-size:12px;color:#c084fc">checkmark_seal_fill</i>' : '')}</div>
          <div class="sc-msg-last">${E(c.last || '')}</div>
        </div>
        <div class="sc-msg-side">
          <span class="sc-msg-time">${E(timeLabel(c.at))}</span>
          ${+c.unread ? `<span class="sc-msg-unread">${+c.unread > 99 ? '99+' : +c.unread}</span>` : ''}
        </div>
      </div>`).join('');

    box.innerHTML = notifRow + (rows || '<div class="sc-empty-card">لا محادثات في هذا التصنيف</div>');
    const nr = q('#scNotifRow');
    if (nr) nr.onclick = () => call('openNotifs');
    qa('.sc-msg-row[data-uid]', box).forEach(row => row.onclick = () => {
      const c = list.find(x => +x.id === +row.dataset.uid);
      if (c) openConversation(c);
    });
  }

  function isOfficialConv(c) {
    return !!(c && (c.verified || (c.rank && c.rank !== 'user')));
  }
  function openConversation(c) {
    if (fn('openPrivateWith')) return call('openPrivateWith', {
      id: +c.id, username: c.username, avatar: c.avatar, gender: c.gender,
      membership: c.membership, rank: c.rank, registered: c.registered, unread: c.unread, verified: c.verified
    });
    call('openProfile', c.id);
  }

  /* ==========================================================================
     شاشة أنت
     ========================================================================== */
  function renderMe() {
    const box = q('#scMeBody');
    if (!box) return;
    const me = G.me;
    if (!me) {
      box.innerHTML = `<div class="sc-card" style="padding:24px;text-align:center;margin-top:10px">
        <div style="font-size:40px;margin-bottom:10px">👤</div>
        <div style="font-weight:800;font-size:16px;margin-bottom:6px">لم تسجّل الدخول بعد</div>
        <div style="font-size:12.5px;color:var(--sc-txt-3);line-height:1.8;margin-bottom:16px">أنشئ حسابك لتظهر على الكوكب وترسل الهدايا وتنشئ غرفتك</div>
        <button class="sc-btn-primary" id="scMeLogin">دخول / إنشاء حساب</button></div>`;
      const b = q('#scMeLogin');
      if (b) b.onclick = () => call('openLogin');
      return;
    }
    const st = (S.boot && S.boot.me) || {};
    const faces = ((S.boot && S.boot.planet_users) || []).slice(0, 4);
    const lvl = levelOf(me);
    box.innerHTML = `
      <div class="sc-id-card">
        <div class="sc-id-top">
          <div class="sc-id-ava">
            <div class="sc-id-ava-inner">${AVI(me, '')}</div>
            <div class="sc-id-wings"><span>🪽</span><span>👑</span></div>
          </div>
          <div class="sc-id-meta">
            <div class="sc-id-name">${E(me.username)}</div>
            <div class="sc-id-uid">UID: ${E(me.id)}</div>
            <div class="sc-id-badges">
              <span class="sc-coin">🪙 ${num(me.balance)}</span>
              <span class="sc-lvl tri">Lv.${Math.max(1, Math.round(lvl / 3))}</span>
              <span class="sc-lvl circ">Lv.${lvl}</span>
            </div>
          </div>
        </div>
        <div class="sc-stats">
          <div class="sc-stat" data-stat="friends"><b>${num(st.friends || 0)}</b><small>الأصدقاء</small></div>
          <div class="sc-stat" data-stat="following"><b>${num(st.following || 0)}</b><small>يتابع</small></div>
          <div class="sc-stat" data-stat="followers"><b>${num(st.followers || 0)}</b><small>المتابعين</small></div>
          <div class="sc-stat" data-stat="visitors"><b>${num(st.visitors || 0)}</b><small>الزوار</small></div>
        </div>
      </div>

      <div class="sc-wallet" id="scWallet">
        <span class="sc-jewel">💎</span>
        <div><b>${num(me.balance)}</b> <span>جوهرة في محفظتك</span></div>
        <i class="f7-icons sc-chev">chevron_left</i>
      </div>

      <div class="sc-empire">
        <div class="sc-empire-faces">${faces.map(u => `<img src="${E(u.avatar || '/avatars/default.png')}" alt="">`).join('') || '<img src="/avatars/default.png" alt="">'}</div>
        <div><b>بطاقة الإمبراطورية</b><small>انضم إلى إمبراطورية وتكوّن صداقات</small></div>
        <button id="scEmpireJoin">انضمام</button>
      </div>

      <div class="sc-section-title">خدماتي <small>كل ما تحتاجه في مكان واحد</small></div>
      <div class="sc-services" id="scServices1"></div>
      <div class="sc-services" id="scServices2" style="margin-top:10px"></div>

      <div class="sc-prayer" id="scPrayer">
        <span class="sc-prayer-ico">🕌</span>
        <div><b>قسم الصلاة</b><small id="scPrayerSub">مواقيت الصلاة اليوم</small></div>
        <i class="f7-icons sc-chev">chevron_left</i>
      </div>`;

    // الشبكة الأولى (8 خدمات)
    const s1 = q('#scServices1');
    const svc1 = [
      ['المستوى', '📈', () => call('openUpgrade', me), ''],
      ['SVIP', '👑', () => call('openBuy'), ''],
      ['طبقة النبلاء', '💠', () => call('openUpgrade', me), ''],
      ['الإمبراطورية', '🏰', () => sheetEmpire(), ''],
      ['المتجر', '🛒', () => call('openGifts', me), ''],
      ['مركز الألعاب', '🦁', () => sheetGames(), ''],
      ['شركائي', '🤝', () => sheetPartners(), ''],
      ['ميدالية', '🏅', () => call('openMyGifts'), '']
    ];
    if (s1) s1.innerHTML = svc1.map(([l, i], idx) => `<div class="sc-service" data-i="${idx}"><span class="sc-srv-ico">${i}</span><span class="sc-srv-lbl">${l}</span></div>`).join('');
    qa('#scServices1 .sc-service').forEach(el => el.onclick = () => svc1[+el.dataset.i][2]());

    // الشبكة الثانية (4 خدمات)
    const s2 = q('#scServices2');
    const svc2 = [
      ['المهام', '📋', () => sheetTasks(), 'مكافآت'],
      ['غرفتي', '🚪', () => (G.curRoom ? call('showScreen', 'chat') : go('party')), ''],
      ['الاكسسوارات', '🎀', () => call('openAvatars'), ''],
      ['المنشورات', '📝', () => go('posts'), '']
    ];
    if (s2) s2.innerHTML = svc2.map(([l, i, , tag], idx) => `<div class="sc-service" data-j="${idx}">${tag ? `<span class="sc-srv-tag">${tag}</span>` : ''}<span class="sc-srv-ico">${i}</span><span class="sc-srv-lbl">${l}</span></div>`).join('');
    qa('#scServices2 .sc-service').forEach(el => el.onclick = () => svc2[+el.dataset.j][2]());

    const wallet = q('#scWallet');
    if (wallet) wallet.onclick = () => call('openBuy');
    const join = q('#scEmpireJoin');
    if (join) join.onclick = () => sheetEmpire();
    const prayer = q('#scPrayer');
    if (prayer) prayer.onclick = () => sheetPrayer();
    qa('.sc-stat', box).forEach(el => el.onclick = () => sheetStat(el.dataset.stat, el, st));
  }

  function sheetStat(kind, anchor, st) {
    const titles = { friends: 'الأصدقاء', following: 'يتابع', followers: 'المتابعين', visitors: 'الزوار' };
    const users = ((S.boot && S.boot.planet_users) || []).slice(0, 10);
      const rows = users.map(u => `
      <div class="sc-user-row" data-uid="${u.id}">
        ${AVI(u, '')}
        <div><div class="sc-ur-name">${E(u.username)}</div><div class="sc-ur-sub">${levelChip(u)}</div></div>
        <button class="sc-ur-go">عرض</button>
      </div>`).join('');
    sheetOpen(`<h3>${titles[kind] || ''}</h3>
      <p class="sc-sheet-sub">${num((st && st[kind]) || 0)} ${titles[kind] || ''} — أبرز الأعضاء:</p>
      ${rows || '<div class="sc-empty-card">لا بيانات بعد</div>'}`);
    qa('.sc-user-row[data-uid]').forEach(row => row.onclick = () => { sheetClose(); call('openProfile', +row.dataset.uid); });
  }

  function sheetEmpire() {
    sheetOpen(`<h3>🏰 الإمبراطورية</h3>
      <p class="sc-sheet-sub">الإمبراطوريات مجتمعات يجتمع فيها الأعضاء لبناء الصداقات ودعم بعضهم في الجداول والمسابقات. اختر إمبراطورية للانضمام أو تواصل مع أعضائها.</p>
      <div id="scEmpireList"><div class="sc-loading"><span class="sc-spinner"></span>جارٍ التحميل…</div></div>`);
    const box = q('#scEmpireList');
    jget('/api/soulchill/bootstrap').then(d => {
      const users = (d && d.planet_users) || [];
      box.innerHTML = users.slice(0, 12).map(u => `
        <div class="sc-user-row" data-uid="${u.id}">
          ${AVI(u, '')}
          <div><div class="sc-ur-name">${E(u.username)}</div><div class="sc-ur-sub">${levelChip(u)} ${roleChips(u)}</div></div>
          <button class="sc-ur-go">انضمام</button>
        </div>`).join('') || '<div class="sc-empty-card">لا توجد إمبراطوريات بعد</div>';
      qa('.sc-user-row[data-uid]', box).forEach(row => row.onclick = () => {
        const u = users.find(x => +x.id === +row.dataset.uid);
        sheetClose();
        if (u) openUserActions(u);
      });
    }).catch(() => { box.innerHTML = '<div class="sc-empty-card">تعذر التحميل</div>'; });
  }

  function sheetGames() {
    sheetOpen(`<h3>🎮 مركز الألعاب</h3>
      <p class="sc-sheet-sub">ألعاب ودعم داخل الغرف الصوتية — اختر ما تريد:</p>
      <div class="sc-sheet-row" data-op="lucky"><i class="f7-icons">gift_fill</i><div><b>صندوق الحظ</b><br><small>جرّب حظك واربح جوائز</small></div><i class="f7-icons sc-chev">chevron_left</i></div>
      <div class="sc-sheet-row" data-op="uefa"><i class="f7-icons">sportscourt_fill</i><div><b>تحدي UEFA</b><br><small>توقّع نتائج المباريات مع المجتمع</small></div><i class="f7-icons sc-chev">chevron_left</i></div>
      <div class="sc-sheet-row" data-op="pk"><i class="f7-icons">flame_fill</i><div><b>تحديات PK</b><br><small>نافس الغرف الأخرى على الترتيب</small></div><i class="f7-icons sc-chev">chevron_left</i></div>`);
    qa('[data-op]').forEach(el => el.onclick = () => {
      const op = el.dataset.op;
      sheetClose();
      if (op === 'lucky') call('openGifts', G.me || undefined);
      else if (op === 'uefa') { S.postTab = 'posts'; go('posts'); }
      else if (op === 'pk') { S.cat = 'PK'; go('party'); }
    });
  }

  function sheetPartners() {
    const users = ((S.boot && S.boot.planet_users) || []).slice(0, 10);
    sheetOpen(`<h3>🤝 شركائي</h3>
      <p class="sc-sheet-sub">أعضاء تفاعلت معهم (هدايا، رسائل، أو متابعات) — ابدأ شراكة بدعمهم في الغرف.</p>
      ${users.map(u => `
        <div class="sc-user-row" data-uid="${u.id}">
          ${AVI(u, '')}
          <div><div class="sc-ur-name">${E(u.username)}</div><div class="sc-ur-sub">${levelChip(u)}</div></div>
          <button class="sc-ur-go">هدية</button>
        </div>`).join('') || '<div class="sc-empty-card">لا شركاء بعد</div>'}`);
    qa('.sc-user-row[data-uid]').forEach(row => row.onclick = () => {
      const u = users.find(x => +x.id === +row.dataset.uid);
      sheetClose();
      if (u) call('openGifts', u);
    });
  }

  function sheetTasks() {
    const tasks = [
      { k: 'checkin', icon: '📅', t: 'تسجيل الحضور اليومي', d: 'مكافأة ذهب يومية', done: checkinDoneToday(), go: doCheckin },
      { k: 'gift', icon: '🎁', t: 'أرسل هدية واحدة', d: 'ادعم صديقاً في الغرفة', done: !!readFlag('gift'), go: () => { sheetClose(); call('openGifts', G.me || undefined); } },
      { k: 'post', icon: '📝', t: 'انشر منشوراً', d: 'شارك لحظتك مع المجتمع', done: !!readFlag('post'), go: () => { sheetClose(); sheetNewPost(); } },
      { k: 'room', icon: '🎤', t: 'ادخل غرفة صوتية', d: 'استمع وتحدّث مع الأعضاء', done: !!G.curRoom, go: () => { sheetClose(); go('party'); } }
    ];
    sheetOpen(`<h3>📋 المهام اليومية</h3>
      <p class="sc-sheet-sub">أكمل المهام واحصل على مكافآت — ${tasks.filter(t => t.done).length}/${tasks.length} مكتملة</p>
      ${tasks.map((t, i) => `<div class="sc-sheet-row" data-i="${i}" style="${t.done ? 'opacity:.55' : ''}">
        <span style="font-size:19px">${t.icon}</span>
        <div><b>${t.t}</b><br><small>${t.d}</small></div>
        <span style="margin-inline-start:auto;font-size:11.5px;font-weight:800;color:${t.done ? '#34d399' : 'var(--sc-gold)'}">${t.done ? 'مكتملة ✓' : 'ابدأ'}</span>
      </div>`).join('')}`);
    qa('.sc-sheet-row[data-i]').forEach(el => el.onclick = () => tasks[+el.dataset.i].go());
  }

  /* ---- الصلاة ---- */
  const PRAYERS = [['Fajr', 'الفجر'], ['Dhuhr', 'الظهر'], ['Asr', 'العصر'], ['Maghrib', 'المغرب'], ['Isha', 'العشاء']];
  async function sheetPrayer() {
    sheetOpen(`<h3>🕌 قسم الصلاة</h3>
      <p class="sc-sheet-sub">مواقيت الصلاة — عمّان / إربد (الأردن)</p>
      <div id="scPrayerBody"><div class="sc-loading"><span class="sc-spinner"></span>جارٍ جلب المواقيت…</div></div>`);
    const box = q('#scPrayerBody');
    try {
      const r = await fetch('https://api.aladhan.com/v1/timingsByCity?city=Irbid&country=Jordan&method=4');
      const d = await r.json();
      const t = d.data && d.data.timings;
      if (!t) throw new Error('no data');
      box.innerHTML = PRAYERS.map(([k, ar]) => `
        <div class="sc-sheet-row" style="pointer-events:none">
          <span style="font-size:17px">🕋</span><b>${ar}</b>
          <span style="margin-inline-start:auto;color:var(--sc-gold);font-weight:800;direction:ltr">${E(String(t[k] || '').slice(0, 5))}</span>
        </div>`).join('') + `<div class="sc-msg-tip">المصدر: Aladhan API — التاريخ الهجري ${E((d.data.date && d.data.date.hijri && d.data.date.hijri.date) || '')}</div>`;
    } catch (e) {
      const box2 = q('#scPrayerBody');
      if (box2) box2.innerHTML = `<div class="sc-empty-card">تعذّر جلب المواقيت الآن — تحقق من الاتصال بالإنترنت</div>`;
    }
  }

  /* ---- الحضور اليومي ---- */
  function checkinKey() { return 'sc_checkin_' + ((G.me && G.me.id) || 'guest') + '_' + new Date().toDateString(); }
  function checkinDoneToday() { try { return localStorage.getItem(checkinKey()) === '1'; } catch (e) { return false; } }
  function readFlag(k) { try { return localStorage.getItem('sc_task_' + k + '_' + ((G.me && G.me.id) || 'guest') + '_' + new Date().toDateString()) === '1'; } catch (e) { return false; } }
  function writeFlag(k) { try { localStorage.setItem('sc_task_' + k + '_' + ((G.me && G.me.id) || 'guest') + '_' + new Date().toDateString(), '1'); } catch (e) { } }
  async function doCheckin() {
    if (!G.me) return call('openLogin');
    if (checkinDoneToday()) return toastSafe('سجّلت حضورك اليوم بالفعل ✅');
    try {
      const d = await jpost('/api/soulchill/checkin', {});
      try { localStorage.setItem(checkinKey(), '1'); } catch (e) { }
      if (G.me && typeof d.balance === 'number') G.me.balance = d.balance;
      toastSafe('🎉 تم تسجيل حضورك اليومي +' + (d.reward || 0) + ' ذهب');
      renderTab(S.tab);
    } catch (e) { toastSafe(e.message || 'تعذر تسجيل الحضور', false); }
  }

  /* ---- ورقة أعضاء / إجراءات ---- */
  function openUserActions(u) {
    if (!u) return;
    sheetOpen(`<h3>${E(u.username)}</h3>
      <p class="sc-sheet-sub">${levelChip(u)} ${roleChips(u)} ${u.room ? '— في ' + E(u.room) : ''}</p>
      <div style="display:flex;justify-content:center;margin:6px 0 14px"><div style="width:92px;height:92px;border-radius:50%;padding:3px;background:var(--sc-grad-purple)">${AVI(u, '')}</div></div>
      <button class="sc-btn-primary" id="scUaCall">📞 مكالمة صوتية</button>
      <div style="height:8px"></div>
      <div class="sc-sheet-row" data-op="msg"><i class="f7-icons">bubble_left_fill</i><b>محادثة خاصة</b><i class="f7-icons sc-chev">chevron_left</i></div>
      <div class="sc-sheet-row" data-op="gift"><i class="f7-icons">gift_fill</i><b>إرسال هدية</b><i class="f7-icons sc-chev">chevron_left</i></div>
      <div class="sc-sheet-row" data-op="profile"><i class="f7-icons">person_fill</i><b>الملف الشخصي</b><i class="f7-icons sc-chev">chevron_left</i></div>`);
    const startCall = () => { sheetClose(); call('openPrivateWith', u); setTimeout(() => call('executePrivateCall', 'audio'), 700); };
    const callBtn = q('#scUaCall');
    if (callBtn) callBtn.onclick = startCall;
    qa('[data-op]').forEach(el => el.onclick = () => {
      const op = el.dataset.op;
      sheetClose();
      if (op === 'msg') call('openPrivateWith', u);
      else if (op === 'gift') call('openGifts', u);
      else if (op === 'profile') call('openProfile', u.id);
    });
  }

  function sheetCountries() {
    sheetOpen(`<h3>اختر الدولة</h3><p class="sc-sheet-sub">تُعرض الغرف بحسب الدولة الظاهرة في اسم الغرفة</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
      ${COUNTRIES.map(c => `<button class="sc-chip${S.country === c.k ? ' on' : ''}" data-country="${E(c.k)}"><span class="sc-flag">${c.f}</span>${E(c.k)}</button>`).join('')}
      </div>`);
    qa('[data-country]').forEach(b => b.onclick = () => { S.country = b.dataset.country; sheetClose(); go('party'); });
  }
  function sheetUsers(title, sub, rows, onPick) {
    sheetOpen(`<h3>${E(title)}</h3><p class="sc-sheet-sub">${E(sub || '')}</p>${rows}`);
    qa('.sc-user-row[data-uid]').forEach(r => r.onclick = () => onPick(+r.dataset.uid));
  }

  /* ==========================================================================
     الورقة السفلية
     ========================================================================== */
  function sheetOpen(html) {
    let sheet = q('#scSheet');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.id = 'scSheet';
      sheet.className = 'sc-sheet';
      sheet.innerHTML = '<div class="sc-sheet-veil"></div><div class="sc-sheet-card" id="scSheetCard"></div>';
      document.body.appendChild(sheet);
      sheet.addEventListener('click', ev => { if (ev.target.classList.contains('sc-sheet-veil')) sheetClose(); });
    }
    const card = q('#scSheetCard');
    card.innerHTML = '<div class="sc-sheet-grip"></div>' + html;
    sheet.classList.add('open');
  }
  function sheetClose() {
    const sheet = q('#scSheet');
    if (sheet) sheet.classList.remove('open');
  }
  // ربط صفوف الورقة بالمعرّف data-op
  function sheetBindOps(map) {
    qa('#scSheetCard [data-op]').forEach(el => el.onclick = () => {
      const handler = map[el.dataset.op];
      if (!handler) return;
      sheetClose();
      handler();
    });
  }

  /* ==========================================================================
     داخل الغرفة الصوتية — مطابقة لتصميم SoulChill في الصور المرجعية
     ========================================================================== */
  const SC_SEAT_COUNT = 4;

  // خلفية مخصّصة للغرفة (صورة الغرفة تغطي الشاشة) أو خلفية بنفسجية افتراضية
  function applyRoomBackground() {
    const screen = q('#chatScreen');
    if (!screen) return;
    const room = G.curRoom || {};
    const img = room.image && room.image.startsWith('/') ? room.image : '';
    if (img) {
      screen.style.backgroundImage = `linear-gradient(180deg, rgba(8,6,16,.72), rgba(8,6,16,.88)), url('${img}')`;
      screen.style.backgroundColor = '#0a0714';
    } else {
      // نفس خلفية الغرفة البنفسجية في الصورة المرجعية
      screen.style.backgroundImage =
        'radial-gradient(circle at 50% 22%, rgba(168,85,247,.55) 0%, rgba(109,40,217,.45) 38%, rgba(46,16,101,.85) 72%, rgba(20,8,45,1) 100%),'
        + 'radial-gradient(circle at 12% 78%, rgba(217,70,239,.22), transparent 45%),'
        + 'radial-gradient(circle at 88% 62%, rgba(124,58,237,.28), transparent 45%)';
      screen.style.backgroundColor = '#2b1065';
    }
    screen.style.backgroundSize = 'cover';
    screen.style.backgroundPosition = 'center';
  }

  function mountRoom() {
    const screen = q('#chatScreen');
    if (!screen || !G.curRoom) return;
    document.body.classList.add('sc-room');
    if (S.roomTrackedId !== +G.curRoom.id) { S.roomTrackedId = +G.curRoom.id; S.seenRoomUsers = null; S.newVisitors = 0; }
    applyRoomBackground();

    if (!q('#scRoomHead')) {
      const head = document.createElement('div');
      head.id = 'scRoomHead';
      head.className = 'sc-room-head';
      screen.insertBefore(head, screen.firstChild);

      const sub = document.createElement('div');
      sub.id = 'scRoomSub';
      sub.className = 'sc-room-sub';
      head.insertAdjacentElement('afterend', sub);

      const seats = document.createElement('div');
      seats.id = 'scSeats';
      seats.className = 'sc-seats';
      sub.insertAdjacentElement('afterend', seats);

      const visitors = document.createElement('div');
      visitors.id = 'scVisitors';
      visitors.className = 'sc-visitors';
      seats.insertAdjacentElement('afterend', visitors);

      const floats = document.createElement('div');
      floats.id = 'scFloatCol';
      floats.className = 'sc-float-col';
      screen.appendChild(floats);

      const bar = document.createElement('div');
      bar.id = 'scRoomBar';
      bar.className = 'sc-room-bar';
      const inputBar = q('#inputBar', screen);
      if (inputBar) inputBar.insertAdjacentElement('beforebegin', bar); else screen.appendChild(bar);
      buildRoomBar(bar);
    }
    renderRoomHead();
    renderRoomSub();
    renderSeats();
    renderVisitors();
    renderFloats();
    syncMicState();
    ensurePlaceholder();
    if (!S.placeholderTimer) S.placeholderTimer = setInterval(ensurePlaceholder, 4000);
    // يخفي شريط الربح الأخضر بعد انتهاء مدته ويعيد شريط الغرفة العادي
    if (!S.winTimer) S.winTimer = setInterval(() => {
      if (!document.body.classList.contains('sc-room')) return;
      if (S.win && nowSec() - S.win.at >= 45) { S.win = null; renderRoomSub(); }
    }, 8000);
    // يبقي زر المايك/حالة الصعود متوافقاً مع نافذة البث الأصلية
    if (!S.micTimer) S.micTimer = setInterval(() => { if (document.body.classList.contains('sc-room')) syncMicState(); }, 2500);
  }

  function unmountRoom() {
    document.body.classList.remove('sc-room');
    const screen = q('#chatScreen');
    if (screen) { screen.style.backgroundImage = ''; screen.style.backgroundColor = ''; }
    if (S.placeholderTimer) { clearInterval(S.placeholderTimer); S.placeholderTimer = null; }
    if (S.winTimer) { clearInterval(S.winTimer); S.winTimer = null; }
    if (S.micTimer) { clearInterval(S.micTimer); S.micTimer = null; }
    document.body.classList.remove('on-mic');
  }

  // يتتبّع من انضم للغرفة بعد دخولنا — يظهر كرقم صغير بجانب شارة الزوار
  function trackNewVisitors() {
    const ids = new Set(G.roomUsers.map(u => +u.id));
    if (!S.seenRoomUsers) { S.seenRoomUsers = ids; S.newVisitors = 0; return; }
    let fresh = 0;
    ids.forEach(id => { if (!S.seenRoomUsers.has(id)) fresh++; });
    S.seenRoomUsers = ids;
    if (fresh) S.newVisitors = (S.newVisitors || 0) + fresh;
  }

  function roomTopSupporters() {
    return G.roomUsers.slice().sort((a, b) => levelOf(b) - levelOf(a)).slice(0, 3);
  }
  function roomRankNo() {
    const list = roomsForRender().slice().sort((a, b) => (+((G.counts || {})[b.id]) || +b.online || 0) - (+((G.counts || {})[a.id]) || +a.online || 0));
    const idx = list.findIndex(r => +r.id === +(G.curRoom || {}).id);
    return idx >= 0 ? idx + 1 : 1;
  }
  function roomOnline() {
    const room = G.curRoom || {};
    return +((G.counts || {})[room.id]) || G.roomUsers.length || +room.online || 0;
  }

  /* ---------- الشريط العلوي: أدوات + داعمون + بطاقة الغرفة ---------- */
  function renderRoomHead() {
    const head = q('#scRoomHead');
    if (!head) return;
    const room = G.curRoom || {};
    const sup = roomTopSupporters();
    const roomImg = room.image && room.image.startsWith('/') ? room.image : '';
    const rank = roomRankNo();
    head.innerHTML = `
      <div class="sc-room-card-mini">
        <img class="sc-rcm-ava" src="${E(roomImg || '/img/room.png')}" alt="">
        <div class="sc-rcm-info">
          <span class="sc-rcm-name">${E(room.name || '')}</span>
          <span class="sc-rcm-rid">RID:${E(room.id || '')}</span>
        </div>
        <span class="sc-rcm-rank"><i>👑</i>${rank}</span>
        <button class="sc-rcm-heart${S.following.has('room_' + room.id) ? ' on' : ''}" id="scRoomHeart" title="متابعة الغرفة"><i class="f7-icons">heart_fill</i></button>
      </div>
      <div class="sc-rh-sup-pill">
        ${sup.map((u, i) => `<span class="sc-rh-sup" data-uid="${u.id}" title="${E(u.username)}">${AVI(u, '')}<em>${i + 1}</em></span>`).join('')}
      </div>
      <button class="sc-rh-back" id="scRoomBack" title="رجوع"><i class="f7-icons">chevron_right</i></button>
      <div class="sc-rh-tools">
        <button class="sc-rh-ico" id="scRoomStatus" title="الحالات"><i class="f7-icons">square_pencil</i></button>
        <button class="sc-rh-ico" id="scRoomShare" title="مشاركة"><i class="f7-icons">arrowshape_turn_up_right_fill</i></button>
        <button class="sc-rh-ico" id="scRoomMore" title="قائمة"><i class="f7-icons">ellipsis_vertical</i></button>
      </div>`;
    const heart = q('#scRoomHeart');
    if (heart) heart.onclick = () => {
      const k = 'room_' + room.id;
      if (S.following.has(k)) { S.following.delete(k); heart.classList.remove('on'); toastSafe('أُلغيت متابعة الغرفة'); }
      else { S.following.add(k); heart.classList.add('on'); toastSafe('تتابع هذه الغرفة ❤️'); }
    };
    const more = q('#scRoomMore');
    if (more) more.onclick = () => call('openOv', 'menuOv');
    const back = q('#scRoomBack');
    if (back) back.onclick = () => {
      const b = q('#chatBack');
      if (b) b.click(); else if (fn('attemptLeaveRoom')) call('attemptLeaveRoom');
    };
    const share = q('#scRoomShare');
    if (share) share.onclick = shareRoom;
    const statusBtn = q('#scRoomStatus');
    if (statusBtn) statusBtn.onclick = () => { const b = q('#btnAddStatus'); if (b) b.click(); else call('openStatuses'); };
    qa('.sc-rh-sup', head).forEach(el => el.onclick = () => {
      const u = G.roomUsers.find(x => +x.id === +el.dataset.uid);
      if (u) call('openUserSheet', u.id);
    });
  }

  function shareRoom() {
    const room = G.curRoom || {};
    const url = location.origin + '/?room=' + room.id;
    const text = `انضم إليّ في غرفة ${room.name || ''} على ${siteName()}`;
    if (navigator.share) { navigator.share({ title: siteName(), text, url }).catch(() => { }); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toastSafe('تم نسخ رابط الغرفة 🔗')).catch(() => { });
    else toastSafe(url);
  }

  /* ---------- الصف الثاني: شارة المستوى + الشريط الذهبي / جدول الساعة ---------- */
  function renderRoomSub() {
    const box = q('#scRoomSub');
    if (!box) return;
    const me = G.me;
    const bal = me ? (+me.balance || 0) : 0;
    const prog = bal % 7000;
    const cost = +((G.settings || {}).call_cost || 0);
    const ranked = roomRankNo() <= 3;
    const win = S.win && (nowSec() - S.win.at < 45) ? S.win : null;
    let bar;
    if (win) {
      // شريط أخضر كما في الصورة: GO + شعار UEFA + اسم الرابح وصورته + نص الجائزة
      bar = `<div class="sc-win-bar" id="scWinBar">
        <button class="sc-go-btn sc-go-green" id="scGoBtn">GO</button>
        <span class="sc-uefa-badge"><span class="sc-fl-art">⚽</span><b>UEFA</b></span>
        <span class="sc-win-txt"><b>${E(win.name)}</b><small>${E(win.text)}</small></span>
        ${win.avatar ? `<img class="sc-win-ava" src="${E(win.avatar)}" alt="">` : ''}
      </div>`;
    } else if (ranked) {
      bar = `<div class="sc-hour-bar" id="scHourBar">
        <span class="sc-hb-txt"><b>جدول الساعة ${E(hourWindow())}</b><small>الجداول العامة +100 No.</small></span>
        <span class="sc-hb-icon">🕐</span>
        <i class="f7-icons sc-hb-chev">chevron_right</i>
      </div>`;
    } else {
      bar = `<div class="sc-gold-bar" id="scGoBar">
        <span class="sc-gb-txt"><b>${me ? E(me.username) : 'زائر'}</b><small>${me ? 'فعّل تصريح اللعبة الذهبي!' : 'سجّل الدخول لتفعيل التصريح'}${cost ? ' • ' + cost + ' ذهب' : ''}</small></span>
        ${me ? `<img class="sc-gb-ava" src="${E(me.avatar || '/avatars/default.png')}" alt="">` : ''}
        <span class="sc-pass"><i class="sc-pass-globe">🌐</i><b>Pass</b></span>
        <button class="sc-go-btn" id="scGoBtn">GO</button>
      </div>`;
    }
    box.innerHTML = `
      ${bar}
      <div class="sc-lvbox" id="scLvBox" title="مستواك وتقدمك">
        <div class="sc-lv-row"><span class="sc-lv-badge">LV${me ? levelOf(me) : 1}</span><span class="sc-egg" id="scEgg">🥚</span></div>
        <div class="sc-lv-num">${num(prog)}/7000</div>
      </div>`;
    const winBar = q('#scWinBar');
    if (winBar) winBar.onclick = () => sheetOpen(`<h3>⚽ تحدي UEFA</h3>
      <p class="sc-sheet-sub">${E(win.name)} ${E(win.text)} — تُعلَن نتائج فعالية UEFA في المنشورات الرسمية، وتستطيع المشاركة بالتوقعات وجمع المكافآت.</p>
      <button class="sc-btn-primary" id="scUefaOpen">عرض فعاليات UEFA</button>`);
    const uefaOpen = q('#scUefaOpen');
    if (uefaOpen) uefaOpen.onclick = () => { sheetClose(); S.postTab = 'posts'; go('posts'); };
    const hour = q('#scHourBar');
    if (hour) hour.onclick = () => sheetOpen(`<h3>🗓️ جدول الساعة</h3>
      <p class="sc-sheet-sub">تُحتسب نقاط الغرفة كل ساعة بحسب الهدايا والنشاط — الغرف المتصدرة تحصل على شارة الترتيب.</p>
      ${roomsForRender().slice().sort((a, b) => (+((G.counts || {})[b.id]) || 0) - (+((G.counts || {})[a.id]) || 0)).slice(0, 6)
        .map((r, i) => `<div class="sc-sheet-row" data-id="${r.id}"><span style="font-size:16px">${i === 0 ? '👑' : i + 1}</span><b>${E(r.name)}</b><span style="margin-inline-start:auto;font-size:11px;color:var(--sc-gold)">${num(+((G.counts || {})[r.id]) || 0)} 👥</span></div>`).join('')}`);
    qa('#scSheetCard [data-id]').forEach(row => row.onclick = () => {
      const id = +row.dataset.id;
      sheetClose();
      if (+id !== +((G.curRoom || {}).id)) call('enterRoom', id);
    });
    const go = q('#scGoBtn');
    if (go) go.onclick = () => call('openBuy');
    const egg = q('#scEgg');
    if (egg) egg.onclick = () => sheetOpen(`<h3>🥚 بيضة المستوى</h3>
      <p class="sc-sheet-sub">بيضة مستواك تفقس مع نشاطك اليومي. حالياً ${num(prog)}/7000 — اجمع الجواهر من الحضور اليومي والهدايا لتفقيسها.</p>
      <button class="sc-btn-primary" id="scEggCheckin">تسجيل الحضور اليومي</button>`);
    const ec = q('#scEggCheckin');
    if (ec) ec.onclick = () => { sheetClose(); doCheckin(); };
  }

  function hourWindow() {
    const h = new Date().getHours();
    return pad2(h) + ':00-' + pad2((h + 1) % 24) + ':00';
  }

  /* ---------- المقاعد: المضيف في الأعلى + صف المقاعد ---------- */
  function canSpeak() {
    const f = fn('canUseMembershipFeature');
    if (!f) return true;
    try { return !!f('voice_allowed_memberships'); } catch (e) { return true; }
  }

  // حالة البث الحيّة في app.js (BCAST في النطاق العام المشترك بين السكربتين)
  function appBcast() {
    let b = null;
    try { b = (typeof BCAST !== 'undefined') ? BCAST : null; } catch (e) { b = null; }
    if (b && G.curRoom && +b.roomId === +G.curRoom.id) return b;
    return null;
  }
  // من هو فعلياً على المايك الآن؟ نجمع كل المصادر الحقيقية حتى لا يغيب أي مذيع عن المقعد
  function micHosts() {
    const room = G.curRoom || {};
    const map = new Map();
    (G.roomUsers || []).forEach(u => { if (u && +u.live_broadcast_host) map.set(+u.id, u); });
    let rb = null;
    try { rb = (typeof ROOM_BCAST !== 'undefined' && ROOM_BCAST) ? ROOM_BCAST[+room.id] : null; } catch (e) { }
    if (rb && Array.isArray(rb.hosts)) rb.hosts.forEach(h => { if (h && h.id) map.set(+h.id, Object.assign({}, map.get(+h.id) || {}, h)); });
    const b = appBcast();
    if (b && b.hosts && typeof b.hosts.forEach === 'function') b.hosts.forEach((h, id) => map.set(+id, Object.assign({}, map.get(+id) || {}, h)));
    if (G.me && iAmOnMic()) {
      const mine = (G.roomUsers || []).find(u => +u.id === +G.me.id) || {};
      map.set(+G.me.id, Object.assign({}, mine, G.me, map.get(+G.me.id) || {}));
    }
    return [...map.values()].map(h => {
      const u = (G.roomUsers || []).find(x => +x.id === +h.id) || {};
      return {
        id: +h.id,
        username: h.username || u.username || '',
        avatar: h.avatar || u.avatar || '',
        avatar_frame: h.avatar_frame || u.avatar_frame || '',
        membership: h.membership || u.membership || '',
        rank: h.rank || u.rank || '',
        registered: (h.registered !== undefined) ? h.registered : u.registered,
        verified: h.verified || u.verified
      };
    });
  }

  // هل أنا على المايك الآن؟ (حالة البث الحيّة أو مذيعو الغرفة أو علم العضو)
  function iAmOnMic() {
    if (!G.me) return false;
    const room = G.curRoom || {};
    const b = appBcast();
    if (b && b.isHost && +b.roomId === +room.id) return true;
    let rb = null;
    try { rb = (typeof ROOM_BCAST !== 'undefined' && ROOM_BCAST) ? ROOM_BCAST[+room.id] : null; } catch (e) { }
    if (rb && Array.isArray(rb.hosts) && rb.hosts.some(h => +h.id === +G.me.id)) return true;
    const mine = (G.roomUsers || []).find(u => +u.id === +G.me.id);
    return !!(mine && +mine.live_broadcast_host);
  }

  // أقفال المقاعد (يحفظها مشرف الغرفة محلياً) — مقعد مقفل يظهر بأيقونة قفل ورقمه
  function locksKey() { return 'sc_locked_seats_' + ((G.curRoom || {}).id || 0); }
  function lockedSeats() { try { return JSON.parse(localStorage.getItem(locksKey()) || '[]'); } catch (e) { return []; } }
  function isSeatLocked(i) { return lockedSeats().includes(i + 1); }
  function toggleSeatLock(i) {
    const list = lockedSeats();
    const n = i + 1;
    const next = list.includes(n) ? list.filter(x => x !== n) : list.concat([n]);
    try { localStorage.setItem(locksKey(), JSON.stringify(next)); } catch (e) { }
  }
  function canManageSeats() {
    if (!G.me) return false;
    if (['roomadmin', 'admin', 'superadmin', 'supermaster'].includes(G.me.rank)) return true;
    const mine = G.roomUsers.find(u => +u.id === +G.me.id);
    return !!(mine && mine.rank === 'roomadmin');
  }

  // أرقام عربية-هندية لأرقام المقاعد كما في الصورة (رقم ١، رقم ٢ ...)
  const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  const arNum = n => String(n).split('').map(ch => AR_DIGITS[+ch] || ch).join('');

  // ورقة المكافأة الكبرى (من الأيقونة العائمة أو من شريط الكتابة)
  function openPrizeSheet() {
    const giftsToday = +(G.me && G.me.gifts_today) || 0;
    const target = 5;
    sheetOpen(`<h3>🏆 المكافأة الكبرى</h3>
      <p class="sc-sheet-sub">تقدمك اليوم: أرسلت ${num(giftsToday)} من ${num(target)} هدية — أكمل للوصول للمكافأة الكبرى</p>
      <div class="sc-prize-track"><i style="width:${Math.min(100, Math.round((giftsToday / target) * 100))}%"></i></div>
      <div style="height:14px"></div>
      <button class="sc-btn-primary" id="scPrizeGift">إرسال هدية الآن</button>`);
    const g = q('#scPrizeGift');
    if (g) g.onclick = () => { sheetClose(); call('openGifts', G.me || undefined); };
  }

  const CHAIR_SVG = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 11V8.5A2.5 2.5 0 0 1 8.5 6h7A2.5 2.5 0 0 1 18 8.5V11"/><path d="M4.5 11h15v3.5A2.5 2.5 0 0 1 17 17H7a2.5 2.5 0 0 1-2.5-2.5V11z"/><path d="M8 17v2M16 17v2"/></svg>';

  // ---------- حالة المقاعد ----------
  const HOST_RANKS = ['roomadmin', 'admin', 'superadmin', 'supermaster'];
  function roomOwner() {
    return (G.roomUsers || []).find(u => HOST_RANKS.includes(String(u.rank || ''))) || null;
  }
  // صف المذيعين: أنا أولاً ثم بقية المذيعين (مالك الغرفة له مقعده الخاص أعلى الصف)
  function micRowHosts() {
    const all = micHosts();
    const owner = roomOwner();
    const host = (owner && all.find(h => +h.id === +owner.id)) || null;
    const rest = all.filter(h => !host || +h.id !== +host.id);
    rest.sort((a, b) => {
      const am = G.me && +a.id === +G.me.id ? 1 : 0;
      const bm = G.me && +b.id === +G.me.id ? 1 : 0;
      if (am !== bm) return bm - am;
      return badgeLevelOf(b) - badgeLevelOf(a);
    });
    return rest;
  }
  function seatStates() {
    const seats = [];
    const occupants = micRowHosts().slice(0, SC_SEAT_COUNT);
    for (let i = 0; i < SC_SEAT_COUNT; i++) {
      const u = occupants[i] || null;
      if (u) seats.push({ u, idx: i });
      else if (!canSpeak() || isSeatLocked(i)) seats.push({ locked: true, idx: i });
      else seats.push({ empty: true, idx: i });
    }
    return seats;
  }

  function seatHtml(state) {
    const i = state.idx || 0;
    const numLabel = 'رقم ' + arNum(i + 1);
    if (state.u) {
      const u = state.u;
      const mine = G.me && +u.id === +G.me.id;
      return `<div class="sc-seat filled${mine ? ' mine' : ''}${mine && iAmOnMic() ? ' onmic' : ''}" data-uid="${u.id}" data-seat="${i + 1}">
        <div class="sc-seat-ava">${AVI(u, '')}<span class="sc-seat-star">0 ⭐</span></div>
        <div class="sc-seat-label">${E(u.username)}</div>
      </div>`;
    }
    if (state.locked) {
      return `<div class="sc-seat locked" data-seat="${i + 1}">
        <div class="sc-seat-ava"><i class="f7-icons">lock_fill</i></div>
        <div class="sc-seat-label">${numLabel}</div>
      </div>`;
    }
    return `<div class="sc-seat empty" data-seat="${i + 1}">
      <div class="sc-seat-ava"><span class="sc-sofa">${CHAIR_SVG}</span></div>
      <div class="sc-seat-label">${numLabel}</div>
    </div>`;
  }

  function renderSeats() {
    const box = q('#scSeats');
    if (!box) return;
    const all = micHosts();
    const owner = roomOwner();
    const host = (owner && all.find(h => +h.id === +owner.id)) || null;
    const follow = S.following.has('room_' + ((G.curRoom || {}).id || 0));
    const nobody = all.length === 0;
    let html = '';
    if (host) {
      const mine = G.me && +host.id === +G.me.id;
      html += `<div class="sc-host-seat${mine ? ' mine' : ''}${mine && iAmOnMic() ? ' onmic' : ''}" data-uid="${host.id}">
        <div class="sc-host-ava">${AVI(host, '')}<span class="sc-host-star">0 ⭐</span></div>
        <div class="sc-host-name">${E(host.username)}</div>
        <div class="sc-host-label">المضيف</div>
      </div>`;
    } else {
      // مقعد المضيف فارغ: أريكة + «المضيف» — وزر متابعة يظهر فقط إن لم يكن أحد على المايك
      html += `<div class="sc-host-seat empty" data-host-empty="1">
        <div class="sc-host-ava empty"><span class="sc-sofa">${CHAIR_SVG}</span></div>
        <div class="sc-host-label">المضيف</div>
        ${nobody ? `<button class="sc-host-follow${follow ? ' on' : ''}" id="scHostFollow">${follow ? '✓ متابعة' : '＋ متابعة'}</button>` : ''}
      </div>`;
    }
    html += '<div class="sc-seat-row">' + seatStates().map(seatHtml).join('') + '</div>';
    box.innerHTML = html;
    bindSeatEvents(box);
  }

  function bindSeatEvents(box) {
    qa('.sc-seat', box).forEach(el => {
      let pressTimer = null;
      const seatIdx = (+el.dataset.seat || 1) - 1;
      el.addEventListener('pointerdown', () => {
        if (!canManageSeats()) return;
        pressTimer = setTimeout(() => {
          pressTimer = null;
          toggleSeatLock(seatIdx);
          renderSeats();
          toastSafe(lockedSeats().includes(seatIdx + 1) ? 'تم قفل المقعد 🔒' : 'تم فتح المقعد 🔓');
        }, 600);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => el.addEventListener(ev, () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }));
      el.onclick = () => {
        if (el.classList.contains('locked')) {
          if (canManageSeats()) { toggleSeatLock(seatIdx); renderSeats(); return; }
          return toastSafe('هذا المقعد مقفل من إدارة الغرفة', false);
        }
        const uid = el.dataset.uid;
        if (uid && G.me && +uid === +G.me.id) return openSelfSheet();
        if (uid) {
          const u = (G.roomUsers || []).find(x => +x.id === +uid) || micHosts().find(x => +x.id === +uid);
          if (u) return call('openUserSheet', +uid);
          return openSelfSheet();
        }
        micToggle();
      };
    });
    const emptyHost = q('.sc-host-seat.empty', box);
    if (emptyHost) emptyHost.onclick = ev => { if (ev.target.closest('#scHostFollow')) return; micToggle(); };
    const hostSeat = q('.sc-host-seat', box);
    if (hostSeat && !hostSeat.classList.contains('empty')) hostSeat.onclick = () => {
      const uid = +hostSeat.dataset.uid;
      if (G.me && uid === +G.me.id) return openSelfSheet();
      call('openUserSheet', uid);
    };
    const followBtn = q('#scHostFollow', box);
    if (followBtn) followBtn.onclick = ev => { ev.stopPropagation(); toggleRoomFollow(); };
    syncMicState();
  }

  /* ---------- بطاقة ملفي الشخصي (تُفتح بالنقر على صورتي في المقعد) ---------- */
  function flagOf(name) {
    const key = String(name || '');
    const c = COUNTRIES.find(x => x.k === key || (x.m || []).includes(key));
    return c ? c.f : '🏳️';
  }
  function roleLabelOf(u) {
    if (!u) return 'عضو';
    if (u.membership && u.membership !== 'none') return MEMBERSHIP_LABEL[u.membership] || 'عضو مميز';
    if (u.rank === 'roomadmin') return 'مسؤول غرفة';
    if (u.rank === 'admin') return 'مشرف';
    if (u.rank === 'superadmin' || u.rank === 'supermaster') return 'إدارة';
    return u.registered ? 'نشيط' : 'زائر';
  }
  function badgeLevelOf(u) {
    const byRank = LV_BY_BADGE[u && u.rank];
    const byMem = LV_BY_BADGE[u && u.membership];
    return Math.max(byRank || 0, byMem || 0, 1);
  }
  async function openSelfSheet() {
    const me = G.me;
    if (!me || !me.id) return call('openLogin');
    sheetOpen('<h3 class="sc-self-loading">جارٍ تحميل ملفك…</h3>');
    let d = {};
    try { d = await jget('/api/user/' + me.id); } catch (e) { }
    const u = Object.assign({}, me, d.user || {});
    const days = +d.member_days || (u.created_at ? Math.max(0, Math.floor((nowSec() - +u.created_at) / 86400)) : 0);
    const gifts = Array.isArray(d.gifts) ? d.gifts : [];
    const medals = +d.likes || 0;
    const lvl = levelOf(u);
    const blvl = badgeLevelOf(u);
    const followers = +u.followers || 0;
    const following = +u.following || 0;
    const b = appBcast();
    const onMic = !!(b && b.isHost);
    const appBtn = q('#bcastHostMute');
    const muted = !!(appBtn && appBtn.classList.contains('is-muted'));
    sheetOpen(`
      <div class="sc-self-top">
        <div class="sc-self-ava-wrap">
          <span class="sc-self-coins">+${num(+u.balance || 0)} 🪙</span>
          <div class="sc-self-ava">${AVI(u, 'sc-self-avi')}</div>
          <span class="sc-self-followers">${num(followers)} متابع</span>
        </div>
        <div class="sc-self-name">${E(u.username || '')}</div>
        <div class="sc-self-meta">UID : ${E(u.id)} | ${num(following)} متابع | يوم ${arNum(days)}</div>
        <div class="sc-self-chips">
          <span class="sc-self-chip gold">${flagOf(u.country)} ${E(u.country || 'غير محدد')}</span>
          <span class="sc-self-chip">${E(roleLabelOf(u))}</span>
          ${u.verified ? '<span class="sc-self-chip">✔️ موثّق</span>' : ''}
        </div>
        <button class="sc-self-titles" id="scSelfTitles">عرض الألقاب الشرفية</button>
      </div>
      <div class="sc-self-levels">
        <div class="sc-lvl-card purple"><i>▲</i><b>Lv.${lvl}</b><span>الدرج</span></div>
        <div class="sc-lvl-card green"><i>🛡️</i><b>Lv.${blvl}</b><span>الدروع</span></div>
      </div>
      <div class="sc-self-rows">
        <button class="sc-self-row" id="scSelfMedals"><span>حائط الميداليات -</span><em>${num(medals)}</em><i class="f7-icons">chevron_left</i></button>
        <button class="sc-self-row" id="scSelfGifts"><span>معرض الهدايا -</span><em>${num(gifts.length)}</em><i class="f7-icons">chevron_left</i></button>
      </div>
      ${onMic
        ? `<button class="sc-self-mute${muted ? ' on' : ''}" id="scSelfMicBtn">${muted ? '🔇 إلغاء كتم الميكروفون' : '🎙️ كتم الميكروفون'}</button>
           <button class="sc-self-leave" id="scSelfLeave">⬇ النزول من الميكروفون</button>`
        : `<button class="sc-self-leave up" id="scSelfUp">⬆ الصعود إلى الميكروفون</button>`}
    `);
    const t = q('#scSelfTitles');
    if (t) t.onclick = () => openTitlesSheet(u, { days, medals, gifts: gifts.length, followers });
    const m = q('#scSelfMedals');
    if (m) m.onclick = () => openMedalsSheet(d, medals);
    const g = q('#scSelfGifts');
    if (g) g.onclick = () => openGiftsGallery(gifts);
    const up = q('#scSelfUp');
    if (up) up.onclick = () => { sheetClose(); micToggle(); refreshMicUI(600); };
    const mi = q('#scSelfMicBtn');
    if (mi) mi.onclick = () => toggleMyMute();
    const lv = q('#scSelfLeave');
    if (lv) lv.onclick = () => {
      sheetClose();
      leaveMic();
      toastSafe('نزلت من الميكروفون');
      refreshMicUI(400);
    };
  }

  // الألقاب الشرفية: كل ما يستحقه العضو من ألقاب حقيقية (رتبة/عضوية/توثيق/حضور)
  function openTitlesSheet(u, extra) {
    const titles = [];
    if (u.rank === 'roomadmin') titles.push(['🎧', 'مسؤول غرفة', 'يدير الغرفة ويقبل المايك']);
    if (u.rank === 'admin' || u.rank === 'superadmin' || u.rank === 'supermaster') titles.push(['🛡️', 'مشرف المنصة', 'صلاحيات إشراف كاملة']);
    if (u.membership === 'vip') titles.push(['💎', 'VIP', 'عضوية VIP بحزمة مزايا كاملة']);
    if (u.membership === 'mmez') titles.push(['⭐', 'مميز', 'عضوية مميزة']);
    if (u.membership === 'premium') titles.push(['👑', 'بريميوم', 'أعلى عضويات المستخدمين']);
    if (u.verified) titles.push(['✔️', 'موثّق', 'حساب موثّق من الإدارة']);
    if (u.avatar_frame) titles.push(['🖼️', 'إطار مميز', 'إطار صورة حصري']);
    if (+extra.days >= 7) titles.push(['📅', 'عضو قديم', `عضو منذ ${num(+extra.days)} يوم`]);
    if (+extra.followers >= 10) titles.push(['❤️', 'محبوب', `${num(+extra.followers)} متابع`]);
    if (!titles.length) titles.push(['🙂', 'عضو جديد', 'ابدأ نشاطك اليومي لتكسب الألقاب']);
    sheetOpen(`<h3>الألقاب الشرفية</h3>
      <p class="sc-sheet-sub">ألقابك الحالية داخل ${E(siteName())}</p>
      <div class="sc-title-list">${titles.map(t => `<div class="sc-title-row"><span class="sc-title-ico">${t[0]}</span><span class="sc-title-txt"><b>${E(t[1])}</b><small>${E(t[2])}</small></span></div>`).join('')}</div>
      <button class="sc-btn-primary" id="scTitlesBack">رجوع</button>`);
    const back = q('#scTitlesBack');
    if (back) back.onclick = () => openSelfSheet();
  }
  function openMedalsSheet(d, medals) {
    const likers = Array.isArray(d && d.likers) ? d.likers : [];
    sheetOpen(`<h3>حائط الميداليات</h3>
      <p class="sc-sheet-sub">${num(medals)} ميدالية — ميدالياتك تُهدى لك من أعضاء يعجبون بملفك ❤️</p>
      ${likers.length
        ? likers.map(l => `<div class="sc-sheet-row" data-uid="${l.user_id}"><img class="sc-sheet-ava" src="${E(l.avatar || '/avatars/default.png')}" alt=""><b>${E(l.username || '')}</b></div>`).join('')
        : '<div class="sc-sheet-empty">لا ميداليات بعد — تفاعل أكثر ليُعجب بك الأعضاء</div>'}
      <button class="sc-btn-primary" id="scTitlesBack">رجوع</button>`);
    qa('#scSheetCard [data-uid]').forEach(row => row.onclick = () => { sheetClose(); call('openUserSheet', +row.dataset.uid); });
    const back = q('#scTitlesBack');
    if (back) back.onclick = () => openSelfSheet();
  }
  function openGiftsGallery(gifts) {
    sheetOpen(`<h3>معرض الهدايا</h3>
      <p class="sc-sheet-sub">${num(gifts.length)} هدية وصلتك — كل هدية تزيد رصيدك وتلمع معرضك ✨</p>
      <div class="sc-gift-grid">${gifts.map(g => `<div class="sc-gift-card" title="${E(g.gift_name || '')}">
          ${g.gift_img ? `<img src="${E(g.gift_img)}" alt="">` : '<span class="sc-gift-emoji">🎁</span>'}
          <small>${num(+g.price || 0)}</small></div>`).join('')}</div>
      <button class="sc-btn-primary" id="scTitlesBack">رجوع</button>`);
    const back = q('#scTitlesBack');
    if (back) back.onclick = () => openSelfSheet();
  }

  // متابعة الغرفة (تُحفظ محلياً وتنعكس على القلب في بطاقة الغرفة)
  function toggleRoomFollow() {
    const room = G.curRoom || {};
    const k = 'room_' + room.id;
    if (S.following.has(k)) { S.following.delete(k); toastSafe('أُلغيت متابعة الغرفة'); }
    else { S.following.add(k); toastSafe('تتابع هذه الغرفة ❤️'); }
    try { localStorage.setItem('sc_follow_rooms', JSON.stringify([...S.following].filter(x => String(x).startsWith('room_')))); } catch (e) { }
    renderSeats(); renderRoomHead();
  }

  function micToggle() {
    if (!G.me) return call('openLogin');
    const bcast = appBcast();
    if (bcast && bcast.isHost) return leaveMic();
    const btn = q('#btnTalkLive');
    if (btn) { btn.click(); return; }
    if (fn('bcastOpenStartConfirm')) call('bcastOpenStartConfirm', 'audio');
    else toastSafe('البث الصوتي غير متاح الآن', false);
  }
  // زر المايك أسفل الشاشة + إخفاء نافذة البث العائمة عند الصعود للمايك
  function syncMicState() {
    const b = appBcast();
    const on = iAmOnMic();
    document.body.classList.toggle('on-mic', on);
    qa('.sc-seat.mine, .sc-host-seat.mine').forEach(el => el.classList.toggle('onmic', on));
    const appBtn = q('#bcastHostMute');
    const adminMuted = !!(G.me && G.me.muted);
    const muted = adminMuted || !!(appBtn && appBtn.classList.contains('is-muted'));
    // نافذة البث الأصلية: تُخفى تماماً عندما أكون أنا المذيع (الصوتي) داخل واجهة الغرفة الجديدة
    const ov = q('#bcastOv');
    if (ov) ov.classList.toggle('sc-hide-bcast', !!(b && b.isHost && b.mode === 'audio'));
    const btn = q('#scMicBtn');
    if (btn) {
      btn.hidden = !on;
      btn.classList.toggle('muted', muted);
      btn.innerHTML = `<i class="f7-icons">${muted ? 'mic_slash_fill' : 'mic_fill'}</i>`;
      btn.title = adminMuted ? 'تم كتمك إجبارياً من الإدارة' : (muted ? 'إلغاء كتم صوتي' : 'كتم صوتي');
    }
    const sheetMic = q('#scSelfMicBtn');
    if (sheetMic) {
      sheetMic.textContent = muted ? '🔇 إلغاء كتم الميكروفون' : '🎙️ كتم الميكروفون';
      sheetMic.classList.toggle('on', muted);
    }
  }

  // يعيد رسم المقاعد وزر المايك بعد أي تغيير في البث (مع متابعة قصيرة حتى تستقر حالة التطبيق)
  function refreshMicUI(delay) {
    const t0 = Date.now();
    const tick = () => {
      if (!document.body.classList.contains('sc-room')) return;
      renderSeats(); renderRoomSub(); renderVisitors(); syncMicState();
      if (appBcast() && Date.now() - t0 < 2500) setTimeout(tick, 400);
    };
    setTimeout(tick, delay || 250);
  }

  // النزول من الميكروفون (يعيد استخدام منطق التطبيق: يوقف بثي وأتحول لمستمع إن بقي مذيعون)
  function leaveMic() {
    if (fn('bcastStopAsHost')) return call('bcastStopAsHost');
    const close = q('#bcastClose');
    if (close) close.click();
  }
  function toggleMyMute() {
    const appBtn = q('#bcastHostMute');
    if (!appBtn) return toastSafe('كتم المايك غير متاح الآن', false);
    if (G.me && G.me.muted) return toastSafe('تم كتمك إجبارياً من الإدارة 🚫', false);
    appBtn.click();
    setTimeout(syncMicState, 120);
  }

  /* ---------- شارة الزوار + المنضمون الجدد ---------- */
  function renderVisitors() {
    const box = q('#scVisitors');
    if (!box) return;
    const total = roomOnline();
    const fresh = S.newVisitors || 0;
    box.innerHTML = `
      <button class="sc-vbox" id="scVisitorsBtn" title="قائمة الزوار">
        <i class="f7-icons">person_fill</i>
        <b>${num(total)}</b>
      </button>
      <span class="sc-vjoin" id="scVJoin" title="انضم الآن">${num(fresh)}</span>`;
    const btn = q('#scVisitorsBtn');
    if (btn) btn.onclick = () => sheetVisitors();
    const join = q('#scVJoin');
    if (join) join.onclick = () => sheetVisitors();
  }

  function sheetVisitors() {
    const users = G.roomUsers.slice();
    const me = G.me;
    const rows = users.map(u => `
      <div class="sc-user-row" data-uid="${u.id}">
        ${AVI(u, '')}
        <div>
          <div class="sc-ur-name">${E(u.username)}${me && +u.id === +me.id ? ' <small style="color:var(--sc-gold)">(أنت)</small>' : ''}</div>
          <div class="sc-ur-sub">${levelChip(u)} ${roleChips(u)}</div>
        </div>
        <button class="sc-ur-go">متابعة</button>
      </div>`).join('') || '<div class="sc-empty-card">لا زوار في الغرفة الآن</div>';
    sheetOpen(`<h3>👥 الزوار (${num(users.length)})</h3>
      <p class="sc-sheet-sub">كل من هو موجود في الغرفة الآن — انقر على أي عضو لفتح ملفه أو إرسال هدية.</p>
      <div style="max-height:46vh;overflow:auto">${rows}</div>
      <div style="height:10px"></div>
      <div style="display:flex;gap:8px">
        <button class="sc-btn-ghost" id="scRoomMinimize">تصغير الغرفة</button>
        <button class="sc-btn-ghost" id="scRoomExit" style="border-color:rgba(239,68,68,.5);color:#fca5a5">الخروج من الغرفة</button>
      </div>`);
    qa('.sc-user-row[data-uid]').forEach(r => r.onclick = () => {
      const u = users.find(x => +x.id === +r.dataset.uid);
      sheetClose();
      if (u) call('openUserSheet', u.id);
    });
    const min = q('#scRoomMinimize');
    if (min) min.onclick = () => {
      sheetClose();
      const b = q('#chatBack');
      if (b) b.click();
      toastSafe('تم تصغير الغرفة — أنت ما زلت متواجداً فيها');
    };
    const ex = q('#scRoomExit');
    if (ex) ex.onclick = () => {
      sheetClose();
      if (fn('attemptLeaveRoom')) call('attemptLeaveRoom');
      else { const b = q('#chatBack'); if (b) b.click(); }
    };
  }

  /* ---------- الأيقونات العائمة (يسار الشاشة) ---------- */
  function renderFloats() {
    const box = q('#scFloatCol');
    if (!box) return;
    const giftsToday = (S.boot && S.boot.me && S.boot.me.gifts_today) || 0;
    const target = Math.max(10, giftsToday + 5);
    const pct = Math.min(100, Math.round((giftsToday / target) * 100));
    box.innerHTML = `
      <button class="sc-float sc-float-uefa" data-op="uefa" title="فعالية UEFA"><span class="sc-fl-art">⚽</span><small>UEFA</small></button>
      <button class="sc-float sc-float-topup" data-op="topup" title="الشحن اليومي"><span class="sc-fl-art">💰</span><small>الشحن اليومي</small></button>
      <button class="sc-float sc-float-prize" data-op="prize" title="المكافأة الكبرى"><span class="sc-fl-art">🎁</span><small>المكافأة الكبرى</small>
        <span class="sc-float-prog"><i style="width:${pct}%"></i></span>
      </button>
      <button class="sc-float sc-float-coin" data-op="coin" title="الجواهر"><span class="sc-fl-art">🪙</span></button>`;
    qa('[data-op]', box).forEach(b => b.onclick = () => {
      const op = b.dataset.op;
      if (op === 'topup') return call('openBuy');
      if (op === 'coin') return doCheckin();
      if (op === 'uefa') {
        return sheetOpen(`<h3>⚽ تحدي UEFA</h3>
          <p class="sc-sheet-sub">فعالية كرة القدم — توقّع نتائج المباريات واحصل على جوائز. تُعلَن النتائج في المنشورات الرسمية.</p>
          <button class="sc-btn-primary" id="scUefaGo">عرض فعاليات UEFA</button>`);
      }
      return openPrizeSheet();
      sheetOpen(`<h3>🏆 المكافأة الكبرى</h3>
        <p class="sc-sheet-sub">تقدمك اليوم: أرسلت ${num(giftsToday)} من ${num(target)} هدية — أكمل للوصول للمكافأة الكبرى</p>
        <div class="sc-prize-track"><i style="width:${pct}%"></i></div>
        <div style="height:14px"></div>
        <button class="sc-btn-primary" id="scPrizeGift">إرسال هدية الآن</button>`);
      const g = q('#scPrizeGift');
      if (g) g.onclick = () => { sheetClose(); call('openGifts', G.me || undefined); };
      const u = q('#scUefaGo');
      if (u) u.onclick = () => { sheetClose(); S.postTab = 'posts'; go('posts'); };
    });
  }

  /* ---------- الشريط السفلي: أيقونات + حقل الكتابة ---------- */
  function buildRoomBar(bar) {
    const wrap = document.createElement('div');
    wrap.className = 'sc-input-wrap';
    bar.innerHTML = '';
    bar.appendChild(wrap);
    const icons = document.createElement('div');
    icons.className = 'sc-rb-icons';
    const giftsToday = +(G.me && G.me.gifts_today) || 0;
    const prizePct = Math.min(100, Math.round((giftsToday / 5) * 100));
    icons.innerHTML = `
      <button class="sc-rb-btn sc-mic-btn" id="scMicBtn" hidden title="كتم صوتي"><i class="f7-icons">mic_fill</i></button>
      <button class="sc-rb-btn" data-op="more" title="خيارات"><i class="f7-icons">line_horizontal_3_decrease</i></button>
      <button class="sc-rb-btn" data-op="games" title="ألعاب"><i class="f7-icons">gamecontroller_fill</i></button>
      <button class="sc-rb-btn" data-op="chat" title="دردشة نصية"><i class="f7-icons">chat_bubble_fill</i></button>
      <button class="sc-rb-btn sc-rb-prize" data-op="prize" title="المكافأة الكبرى"><i class="f7-icons">crown_fill</i><span class="sc-rb-prog"><i style="width:${prizePct}%"></i></span></button>
      <button class="sc-rb-btn sc-rb-lucky" data-op="lucky" title="صندوق الحظ"><i class="f7-icons">gift_fill</i></button>`;
    bar.appendChild(icons);

    // ننقل عناصر الإدخال الأصلية إلى الشريط الجديد حتى تبقى كل وظائفها (الإرسال، الإيموجي، الرد)
    // الترتيب: حقل الكتابة (يمين) ثم الإيموجي ثم زر الإرسال (يسار) كما في الصورة
    const input = q('#msgInput'), emoji = q('#btnEmoji'), send = q('#btnSend');
    [input, emoji, send].forEach(el => { if (el) wrap.appendChild(el); });
    if (send) { send.classList.add('sc-send-btn'); send.innerHTML = '<i class="f7-icons">arrow_up</i>'; }
    // زر الإرسال يظهر فقط عندما يوجد نص (الصورة تعرض حقلاً بلا زر إرسال)
    const syncSend = () => { if (send) send.classList.toggle('has-text', !!(input && input.value.trim())); };
    if (input) ['input', 'keyup', 'change'].forEach(ev => input.addEventListener(ev, syncSend));
    syncSend();
    ensurePlaceholder();

    qa('[data-op]', icons).forEach(b => b.onclick = () => {
      const op = b.dataset.op;
      if (op === 'gift') call('openGifts', G.me || undefined);
      else if (op === 'prize') openPrizeSheet();
      else if (op === 'chat') { if (input) input.focus(); }
      else if (op === 'games') sheetGames();
      else if (op === 'more') call('openOv', 'menuOv');
      else if (op === 'lucky') sheetOpen(`<h3>🎁 صندوق الحظ</h3>
        <p class="sc-sheet-sub">افتح صندوق الحظ واربح جواهر وهدايا — صندوق واحد كل فترة.</p>
        <button class="sc-btn-primary" id="scLuckyGo">فتح الصندوق</button>`);
    });
    const lucky = q('#scLuckyGo');
    if (lucky) lucky.onclick = () => { sheetClose(); call('openGifts', G.me || undefined); };
    const micBtn = q('#scMicBtn', icons);
    if (micBtn) micBtn.onclick = () => { toggleMyMute(); refreshMicUI(500); };
    syncMicState();
  }

  // النص التوضيحي لحقل الكتابة في الغرفة (كما في الصورة المرجعية)
  function ensurePlaceholder() {
    const input = q('#msgInput');
    if (input && input.getAttribute('placeholder') !== 'مرحبا') input.setAttribute('placeholder', 'مرحبا');
  }

  /* ---------- مستخدمو الغرفة (للقائمة القديمة) ---------- */
  function openRoomUsers() {
    sheetVisitors();
  }

  /* ---------- إعادة بناء الرسائل لتطابق الصورة ---------- */
  const LV_BY_BADGE = { guest: 1, register: 2, mmez: 8, plus: 12, premium: 18, vip: 26, roomadmin: 30, admin: 40, superadmin: 50 };

  function restructureMessages() {
    const area = q('#msgArea');
    if (!area) return;
    qa('.msg', area).forEach(el => {
      if (el.dataset.scBuilt) return;
      const ava = q('.mava', el);
      const body = q('.mbody', el);
      if (!ava || !body) return;                    // ليست رسالة مستخدم (نظام/بوت)
      const nameEl = q('.mname', body);
      const timeEl = q('.mtime', body);
      const badgeImg = q('.mmark', body);
      const line1 = q('.mline1', body);

      // الصف الأول: [الصورة] [الاسم] [الميدالية] [شارات المستوى] [الوقت]
      const top = document.createElement('div');
      top.className = 'sc-mtop';
      top.appendChild(ava);
      if (nameEl) top.appendChild(nameEl);
      if (badgeImg) top.appendChild(badgeImg);
      const chips = document.createElement('span');
      chips.className = 'sc-mchips';
      const kind = badgeImg ? String(badgeImg.dataset.badgeKind || '') : '';
      const lv = LV_BY_BADGE[kind] || (kind ? 2 : (el.dataset.uid ? 1 : 0));
      if (lv) {
        const chip = document.createElement('span');
        chip.className = 'sc-lv-chip' + (lv >= 26 ? ' high' : (lv >= 8 ? ' mid' : ''));
        chip.textContent = (lv >= 8 ? '▲ ' : '● ') + 'Lv.' + lv;
        chips.appendChild(chip);
      }
      if (kind) {
        const role = document.createElement('span');
        role.className = 'sc-role-chip-mini'
          + (/roomadmin|admin|vip|mmez/.test(kind) ? ' gold' : '')
          + (/register|plus|premium/.test(kind) ? ' green' : '');
        role.textContent = roleLabelFor(kind);
        chips.appendChild(role);
      }
      if (isActiveStatus(el.dataset.uid) && fn('statusRingClass')) { /* دائرة الحالة تُدار من التطبيق */ }
      top.appendChild(chips);
      if (timeEl) top.appendChild(timeEl);

      // نقل الرد المقتبس فوق الصف
      const rply = q('.mrply', body);
      if (rply) el.insertBefore(rply, el.firstChild);
      el.insertBefore(top, rply && rply.nextSibling ? rply.nextSibling : el.firstChild);
      if (line1 && line1.parentNode) line1.remove();

      // فقاعة ذهبية لأصحاب العضويات/الرتب
      if (/vip|mmez|premium|roomadmin|admin/.test(kind)) el.classList.add('sc-msg-gold');
      el.classList.add('sc-built');
      el.dataset.scBuilt = '1';
    });
    highlightMentions(area);
  }

  function roleLabelFor(kind) {
    return {
      vip: 'SVIP', mmez: 'مميز', premium: 'بريميوم', plus: 'بلس',
      roomadmin: 'مشرف', admin: 'مشرف', superadmin: 'إدارة',
      register: 'نشيط', guest: 'زائر'
    }[kind] || 'عضو';
  }

  function highlightMentions(root) {
    qa('.mtext', root).forEach(el => {
      if (el.dataset.scMention) return;
      el.dataset.scMention = '1';
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(node => {
        const value = node.nodeValue || '';
        if (value.indexOf('@') === -1) return;
        const re = /@[^\s@]+/g;
        let m, last = 0, changed = false;
        const frag = document.createDocumentFragment();
        while ((m = re.exec(value))) {
          changed = true;
          if (m.index > last) frag.appendChild(document.createTextNode(value.slice(last, m.index)));
          const span = document.createElement('span');
          span.className = 'sc-mention';
          span.textContent = m[0];
          frag.appendChild(span);
          last = m.index + m[0].length;
        }
        if (!changed) return;
        if (last < value.length) frag.appendChild(document.createTextNode(value.slice(last)));
        node.parentNode.replaceChild(frag, node);
      });
    });
  }

  // متوافق مع الاسم القديم
  function decorateMessages() { restructureMessages(); }


  /* ==========================================================================
     تحميل البيانات
     ========================================================================== */
  async function loadBootstrap() {
    try { S.boot = await jget('/api/soulchill/bootstrap'); }
    catch (e) { S.boot = S.boot || null; }
  }
  async function loadRooms() {
    try {
      const rooms = await jget('/api/rooms');
      if (Array.isArray(rooms) && rooms.length) S.rooms = rooms;
    } catch (e) { }
  }
  // نُفضّل قائمة app.js إن كانت محمّلة، وإلا قائمتنا المحمّلة من نفس المصدر
  function roomsForRender() {
    const fromApp = G.rooms;
    if (fromApp && fromApp.length) return fromApp;
    return S.rooms || [];
  }

  async function loadPosts() {
    if (!G.me) { S.posts = []; return; }
    try { S.posts = await jget('/api/wall'); } catch (e) { S.posts = []; }
  }
  async function loadConvs() {
    if (!G.me) { S.convs = []; return; }
    try { S.convs = await jget('/api/private'); } catch (e) { S.convs = []; }
  }
  async function loadNotifications() {
    // الإشعارات وشاراتها تُدار في app.js — نُحدّث فقط شارة تبويب «أنت»
    syncNav();
  }

  async function loadAll() {
    await Promise.all([loadBootstrap(), loadRooms()]);
    await Promise.all([loadPosts(), loadConvs()]);
    renderTab(S.tab);
    loadNotifications();
  }

  /* ==========================================================================
     التهيئة والخطّافات
     ========================================================================== */
  function hookShowScreen() {
    const orig = window.showScreen;
    if (typeof orig !== 'function' || orig.__scWrapped) return;
    const wrapped = function (name) {
      const res = orig.apply(this, arguments);
      try { onScreenChanged(name); } catch (e) { console.warn('[SC]', e); }
      return res;
    };
    wrapped.__scWrapped = true;
    window.showScreen = wrapped;
  }

  function onScreenChanged(name) {
    document.body.classList.add('sc-ui');
    if (name === 'chat') {
      const nav = q('#scNav');
      if (nav) nav.classList.add('sc-nav-hidden');
      mountRoom();
      setTimeout(() => { mountRoom(); decorateMessages(); }, 500);
    } else {
      unmountRoom();
      const nav = q('#scNav');
      if (nav) nav.classList.remove('sc-nav-hidden');
      // عند الخروج من الغرفة (أو أي شاشة قديمة) نعود إلى تبويب الواجهة الحالي
      if (name === 'rooms') {
        const activeSc = q('.sc-screen.active');
        if (!activeSc) {
          if (!activateScreen(S.tab || 'planet')) S.tab = 'planet';
          renderTab(S.tab);
        }
      }
    }
    syncNav();
  }

  function hookSocket() {
    const attach = () => {
      const s = G.socket;
      if (!s || s.__scHooked) return false;
      s.__scHooked = true;
      s.on('roomUsers', () => {
        if (!G.curRoom) return;
        trackNewVisitors();
        renderSeats(); renderRoomHead(); renderVisitors(); renderRoomSub();
      });
      s.on('msg', () => setTimeout(decorateMessages, 60));
      // أحداث البث: من صعد/نزل عن المايك تتحدّث معها المقاعد فوراً
      ['bcast:started', 'bcast:host_joined', 'bcast:host_left', 'bcast:stopped'].forEach(ev => {
        s.on(ev, () => setTimeout(() => {
          if (!G.curRoom) return;
          renderSeats(); renderRoomSub(); renderVisitors(); renderRoomHead();
        }, 250));
      });
      // هدية في الغرفة → شريط أخضر بإعلان الربح (كما في الصورة) لمدة 45 ثانية
      s.on('gift:sent', payload => {
        if (!payload || !payload.from) return;
        const crystals = (+payload.payout || 0) * (+payload.qty || 1);
        const text = crystals > 0
          ? `ربح ${num(crystals)} كريستال، ومكافأة ${num(+payload.price || 0)}x`
          : `أرسل ${payload.name || 'هدية'} ×${num(+payload.qty || 1)} 🎁`;
        const sender = G.roomUsers.find(u => u.username === payload.from);
        S.win = { name: payload.from, avatar: sender ? sender.avatar : '', text, at: nowSec() };
        if (document.body.classList.contains('sc-room')) renderRoomSub();
      });
      s.on('roomCounts', () => { if (S.tab === 'party') setTimeout(renderRoomList, 120); });
      s.on('private', () => { loadConvs().then(() => { if (S.tab === 'msgs') renderMsgs(); syncNav(); }); });
      s.on('notify', () => setTimeout(syncNav, 300));
      s.on('gift:sent', () => setTimeout(() => { writeFlag('gift'); }, 100));
      s.on('user_sync', () => { renderNav(); if (S.tab === 'me') renderMe(); });
      s.on('membership_changed', () => { if (S.tab === 'me') renderMe(); });
      s.on('wall_changed', () => { loadPosts().then(() => { if (S.tab === 'posts') renderPosts(); }); });
      return true;
    };
    if (!attach()) {
      let tries = 0;
      const t = setInterval(() => { if (attach() || ++tries > 40) clearInterval(t); }, 500);
    }
  }

  function hookLoginState() {
    let lastMe = G.me;
    setInterval(() => {
      const me = G.me;
      const changed = (!!me) !== (!!lastMe) || (me && lastMe && me.id !== lastMe.id);
      if (changed) {
        lastMe = me;
        renderNav();
        loadAll();
      } else if (me && lastMe && me.balance !== lastMe.balance) {
        lastMe = me;
        if (S.tab === 'me') renderMe();
      }
      syncNav();
    }, 2500);
  }

  function mount() {
    if (S.mounted) return;
    S.mounted = true;
    document.body.classList.add('sc-ui');
    renderNav();
    hookShowScreen();
    hookSocket();
    hookLoginState();

    // العناصر الثابتة في شاشة الكوكب
    const ci = q('#scCheckinBtn');
    if (ci) ci.onclick = doCheckin;
    const filter = q('#scPlanetFilter');
    if (filter) filter.onclick = () => {
      sheetOpen(`<h3>ضبط الكوكب</h3><p class="sc-sheet-sub">تحكم سريع بما يظهر لك</p>
      <div class="sc-sheet-row" data-op="party"><i class="f7-icons">house_fill</i><b>تصفح الغرف</b><i class="f7-icons sc-chev">chevron_left</i></div>
      <div class="sc-sheet-row" data-op="refresh"><i class="f7-icons">arrow_clockwise</i><b>تحديث الكوكب</b><i class="f7-icons sc-chev">chevron_left</i></div>
      <div class="sc-sheet-row" data-op="blocks"><i class="f7-icons">hand_raised_fill</i><b>قائمة التجاهل</b><i class="f7-icons sc-chev">chevron_left</i></div>`);
      sheetBindOps({
        party: () => go('party'),
        refresh: () => loadAll().then(() => toastSafe('تم التحديث ✅')),
        blocks: () => call('openBlocksList')
      });
    };

    const promo = q('#scPromoTopup');
    if (promo) promo.onclick = () => call('openBuy');
    const grid = q('#scFeatureGrid');
    if (grid) {
      const cards = [
        { k: 'call', ico: '📞', t: 'مكالمة صوتية', s: 'انضم لقائمة المكالمات', btn: 'ابدأ', tag: 'بطاقة التسريع جاهزة للاستخدام' },
        { k: 'soul', ico: '💞', t: 'رفيق الروح', s: 'تحدث مع من يفهمك', btn: '', left: 'يتبقى: 1' },
        { k: 'rooms', ico: '📣', t: 'غرف الدردشة', s: 'تفاعل صوتي جماعي', btn: 'ادخل' },
        { k: 'video', ico: '🎬', t: 'غرف الفيديو', s: 'شارك منشوراتك الرائعة', btn: '' }
      ];
      grid.innerHTML = cards.map(c => `
        <div class="sc-feature" data-k="${c.k}">
          <span class="sc-feat-ico">${c.ico}</span>
          <b>${c.t}</b>
          <small>${c.s}</small>
          ${c.btn ? `<button class="sc-feat-btn${c.k === 'rooms' ? ' sc-feat-btn-gold' : ''}">${c.btn}</button>` : ''}
          ${c.left ? `<span class="sc-feat-count">${c.left}</span>` : ''}
          ${c.tag ? `<span class="sc-feat-tag">${c.tag}</span>` : ''}
          <span class="sc-feat-glow"></span>
        </div>`).join('');
      qa('.sc-feature', grid).forEach(el => el.onclick = () => featureAction(el.dataset.k));
    }

    // شاشة الحفلة
    const createRoom = q('#scCreateRoom');
    if (createRoom) createRoom.onclick = () => {
      sheetOpen(`<h3>إنشاء غرفة</h3>
      <p class="sc-sheet-sub">أنشئ غرفتك الصوتية واختر لها اسماً وصورة، ثم أدِر المقاعد والزوار.</p>
      <div class="sc-sheet-row" data-op="myroom"><i class="f7-icons">house_fill</i><div><b>غرفتي</b><br><small>${G.curRoom ? 'أنت الآن في ' + E(G.curRoom.name) : 'لم تنشئ غرفة بعد'}</small></div><i class="f7-icons sc-chev">chevron_left</i></div>
      <div class="sc-sheet-row" data-op="browse"><i class="f7-icons">square_grid2x2_fill</i><b>تصفح كل الغرف</b><i class="f7-icons sc-chev">chevron_left</i></div>
      <div class="sc-msg-tip">إنشاء الغرف وصورها يتم من لوحة تحكم الموقع — تواصل مع الإدارة لإنشاء غرفتك.</div>`);
      sheetBindOps({
        myroom: () => { if (G.curRoom) { activateScreen('planet'); onScreenChanged('chat'); } else { S.cat = '__all'; go('party'); } },
        browse: () => { S.cat = '__all'; S.country = ''; go('party'); }
      });
    };
    const events = q('#scEventsBtn');
    if (events) events.onclick = () => {
      sheetOpen(`<h3>🎉 الفعاليات</h3>
      <p class="sc-sheet-sub">مسابقات ومكافآت رسمية — شارك واربح</p>
      <div class="sc-sheet-row" data-op="anniv"><i class="f7-icons">gift_fill</i><div><b>مسابقة الذكرى السنوية</b><br><small>اجمع بطاقات الذكرى واربح جوائز نقدية وكريستال</small></div><i class="f7-icons sc-chev">chevron_left</i></div>
      <div class="sc-sheet-row" data-op="uefa"><i class="f7-icons">sportscourt_fill</i><div><b>تحدي UEFA</b><br><small>فعالية كرة القدم</small></div><i class="f7-icons sc-chev">chevron_left</i></div>
      <div class="sc-sheet-row" data-op="topup"><i class="f7-icons">creditcard_fill</i><div><b>مكافآت الشحنة الأولى</b><br><small>مكافأة على أول عملية شحن</small></div><i class="f7-icons sc-chev">chevron_left</i></div>`);
      sheetBindOps({
        anniv: () => { S.postTab = 'posts'; go('posts'); },
        uefa: () => { S.cat = 'PK'; go('party'); },
        topup: () => call('openBuy')
      });
    };
    const searchBtn = q('#scRoomSearchBtn');
    if (searchBtn) searchBtn.onclick = () => {
      sheetOpen(`<h3>ابحث عن غرفة</h3><input class="sc-rb-input" id="scRoomQuery" style="width:100%;margin-bottom:10px" placeholder="اسم الغرفة..."><div id="scRoomResults"></div>`);
      const inp = q('#scRoomQuery');
      const run = () => {
        const v = (inp.value || '').trim();
        const list = roomsForRender().filter(r => !v || r.name.includes(v)).slice(0, 20);
        q('#scRoomResults').innerHTML = list.map(r => `<div class="sc-sheet-row" data-id="${r.id}"><i class="f7-icons">house_fill</i><b>${E(r.name)}</b><span style="margin-inline-start:auto;font-size:11px;color:var(--sc-txt-3)">${num((G.counts[r.id] || r.online || 0))} 👥</span></div>`).join('') || '<div class="sc-empty-card">لا نتائج</div>';
        qa('[data-id]').forEach(row => row.onclick = () => { sheetClose(); call('enterRoom', +row.dataset.id); });
      };
      inp.oninput = run; run();
      setTimeout(() => inp.focus(), 100);
    };

    // شاشة المنشورات
    const newPost = q('#scNewPost');
    if (newPost) newPost.onclick = sheetNewPost;
    const msgSearch = q('#scMsgSearchBtn');
    if (msgSearch) msgSearch.onclick = () => {
      sheetOpen(`<h3>بحث في الرسائل</h3><input class="sc-rb-input" id="scMsgQuery" style="width:100%" placeholder="اسم المستخدم...">`);
      const inp = q('#scMsgQuery');
      inp.value = S.msgQuery;
      inp.oninput = () => { S.msgQuery = inp.value.trim(); renderMsgs(); };
      setTimeout(() => inp.focus(), 100);
    };
    const contacts = q('#scContactsBtn');
    if (contacts) contacts.onclick = () => call('openPrivateList');
    const meSettings = q('#scMeSettings');
    if (meSettings) meSettings.onclick = () => call('openMenu');
    const meBack = q('#scMeBack');
    if (meBack) meBack.onclick = () => go('planet');

    // راقب رسائل الغرفة لإضافة شارات المستوى
    const area = q('#msgArea');
    if (area && window.MutationObserver) {
      new MutationObserver(() => decorateMessages()).observe(area, { childList: true });
    }

    // حالة الشاشة الافتراضية: الكوكب
    go('planet');
    loadAll();

    // تحديث دوري لعداد الأونلاين
    setInterval(() => {
      if (S.tab === 'planet') { loadBootstrap().then(() => renderPlanet()); }
    }, 60000);
  }

  function featureAction(k) {
    if (!G.me) return call('openLogin');
    if (k === 'call') {
      const users = ((S.boot && S.boot.planet_users) || []).slice(0, 12);
      sheetOpen(`<h3>📞 قائمة المكالمات</h3><p class="sc-sheet-sub">اختر عضواً لبدء مكالمة صوتية فورية — أو دع القائمة تختار لك</p>
        <button class="sc-btn-primary" id="scRandomCall">🎲 اتصال عشوائي</button><div style="height:12px"></div>
        ${users.map(u => `<div class="sc-user-row" data-uid="${u.id}">${AVI(u, '')}<div><div class="sc-ur-name">${E(u.username)}</div><div class="sc-ur-sub">${levelChip(u)}</div></div><button class="sc-ur-go">اتصال</button></div>`).join('') || '<div class="sc-empty-card">لا أعضاء متاحون الآن</div>'}`);
      const rc = q('#scRandomCall');
      if (rc) rc.onclick = () => { const u = users[Math.floor(Math.random() * users.length)]; if (u) { sheetClose(); call('openPrivateWith', u); setTimeout(() => call('executePrivateCall', 'audio'), 700); } };
      qa('.sc-user-row[data-uid]').forEach(row => row.onclick = () => {
        const u = users.find(x => +x.id === +row.dataset.uid);
        sheetClose();
        if (u) { call('openPrivateWith', u); setTimeout(() => call('executePrivateCall', 'audio'), 700); }
      });
      return;
    }
    if (k === 'soul') {
      const users = ((S.boot && S.boot.planet_users) || []).slice(0, 12);
      if (!users.length) return toastSafe('لا أعضاء متاحون للمطابقة الآن', false);
      const pick = users[Math.floor(Math.random() * users.length)];
      sheetOpen(`<h3>💞 رفيق الروح</h3>
        <p class="sc-sheet-sub">وجدنا لك توافقاً — ${num(Math.floor(Math.random() * 30) + 70)}% تشابه في الاهتمامات</p>
        <div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:8px 0 16px">
          <div style="width:104px;height:104px;border-radius:50%;padding:3px;background:var(--sc-grad-purple)">${AVI(pick, '')}</div>
          <b style="font-size:17px">${E(pick.username)}</b>
          <div>${levelChip(pick)} ${roleChips(pick)}</div>
        </div>
        <button class="sc-btn-primary" id="scSoulGo">ابدأ المحادثة</button>
        <div style="height:8px"></div>
        <button class="sc-btn-ghost" id="scSoulAgain">جرّب مطابقة أخرى</button>`);
      const g1 = q('#scSoulGo');
      if (g1) g1.onclick = () => { sheetClose(); call('openPrivateWith', pick); };
      const g2 = q('#scSoulAgain');
      if (g2) g2.onclick = () => { sheetClose(); featureAction('soul'); };
      return;
    }
    if (k === 'rooms') return go('party');
    if (k === 'video') {
      if (G.curRoom && fn('bcastOpenStartConfirm')) return call('bcastOpenStartConfirm', 'video');
      S.cat = 'الفيديو'; go('party');
    }
  }

  /* ------------------------------ تشغيل ------------------------------ */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(mount, 60));
  else setTimeout(mount, 60);
  // إن كانت الواجهة القديمة قد بدأت قبل تحميل سكربتنا، نضمن التهيئة بعد أول تحميل
  window.addEventListener('load', () => setTimeout(() => { if (!S.mounted) mount(); }, 120));
})();
