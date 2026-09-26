/* SoulChill world layer: match, Soul Test, games, events, live, premium */
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const INTERESTS = ['موسيقى', 'غناء', 'ألعاب', 'دردشة', 'صداقة', 'PK', 'سفر', 'أفلام', 'أنمي', 'رياضة'];
  const TRUTH = [
    'ما أغنية تشغلها وأنت وحدك؟',
    'ما أكثر غرفة أحببتها هنا؟',
    'لو كنت كوكباً، ماذا سيكون اسمك؟',
    'ما آخر هدية أسعدتك؟',
    'صِف مزاجك الآن بكلمة واحدة.'
  ];
  const DARE = [
    'غنِّ مقطعاً قصيراً على المايك',
    'أرسل هدية رمزية لشخص عشوائي',
    'غيّر حالتك إلى مشغول لدقيقة',
    'عرّف بنفسك بصوت سينمائي',
    'اختر شخصاً وادعه إلى مقعدك'
  ];
  let MATCHING = false;
  let TEST_ANSWERS = [];
  let TEST_STEP = 0;
  const QUESTIONS = [
    { q: 'ليلة مثالية؟', a: ['حفلة صاخبة', 'دردشة هادئة', 'بث ومشاهدة', 'لعب جماعي'] },
    { q: 'ماذا تبحث هنا؟', a: ['أصدقاء جدد', 'حب لطيف', 'ترفيه سريع', 'مجتمع ثابت'] },
    { q: 'أسلوبك في الغرفة؟', a: ['أتكلم كثيراً', 'أستمع ثم أدخل', 'أقدّم هدايا', 'أقود الحفلة'] },
    { q: 'الموسيقى أقرب إلى؟', a: ['بوب طاقي', 'لوفي هادئ', 'راب', 'أغاني عربية'] },
    { q: 'إذا بدأ PK؟', a: ['أتحمّس وأشجّع', 'أفضّل الدردشة', 'أنضم للتحدي', 'أراقب فقط'] },
    { q: 'كوكبك الداخلي؟', a: ['دافئ', 'ناري', 'حالم', 'قائد'] }
  ];

  function needAuth() {
    if (typeof ME !== 'undefined' && ME) return true;
    if (typeof openLogin === 'function') openLogin();
    return false;
  }

  function paintEventBanner() {
    const box = $('#soulEventBanner');
    if (!box || typeof api !== 'function') return;
    api('/api/soul/events').then(d => {
      const ev = d && d.featured;
      if (!ev) { box.hidden = true; return; }
      box.hidden = false;
      box.innerHTML = `<span style="font-size:22px">${ev.emoji || '✦'}</span><div><b>${ev.title}</b><small>${ev.desc}</small></div>`;
      box.onclick = () => {
        if (ev.id === 'soul-wave') openSoulTest();
        else if (ev.id === 'pk-night') {
          if (typeof ROOM_CAT !== 'undefined') { }
          const pk = document.querySelector('#soulRoomCats [data-rcat="pk"]');
          if (pk) pk.click();
        } else if (typeof openBuy === 'function') openBuy();
      };
    }).catch(() => { box.hidden = true; });
  }

  function paintMePlanet() {
    const card = $('#menuUserCard');
    if (!card || typeof api !== 'function' || typeof ME === 'undefined' || !ME) return;
    api('/api/soul/me').then(d => {
      let el = $('#soulMePlanet');
      if (!el) {
        el = document.createElement('div');
        el.id = 'soulMePlanet';
        el.className = 'soul-me-planet';
        const stats = document.querySelector('.soul-me-stats');
        if (stats) stats.after(el);
        else card.after(el);
      }
      const p = d && d.planet;
      el.textContent = p ? (p.emoji + ' كوكبك: ' + p.name + ' — ' + p.tag) : '✦ لم تختبر روحك بعد — ابدأ اختبار الروح';
      el.onclick = openSoulTest;
      if (typeof ME !== 'undefined' && ME) {
        ME.soul_planet = d.planet_id || '';
        ME.soul_premium = d.premium ? 1 : 0;
      }
      if (!d.planet_id && ME.registered) maybeOnboard();
    }).catch(() => { });
  }

  function maybeOnboard() {
    if (sessionStorage.getItem('soulOnboarded')) return;
    const ov = $('#soulOnboardOv');
    if (!ov || typeof openOv !== 'function') return;
    const chips = $('#soulInterestChips');
    if (chips && !chips.children.length) {
      chips.innerHTML = INTERESTS.map(x => `<button type="button" data-int="${x}">${x}</button>`).join('');
      $$('#soulInterestChips button').forEach(b => {
        b.onclick = () => b.classList.toggle('on');
      });
    }
    openOv('soulOnboardOv');
  }

  async function saveInterests(skip) {
    const picked = skip ? [] : $$('#soulInterestChips button.on').map(b => b.dataset.int);
    try {
      if (picked.length) await api('/api/soul/profile', 'POST', { interests: picked });
    } catch (e) { }
    sessionStorage.setItem('soulOnboarded', '1');
    if (typeof closeOv === 'function') closeOv('soulOnboardOv');
    if (!skip) openSoulTest();
  }

  function openSoulTest() {
    if (!needAuth()) return;
    TEST_ANSWERS = [];
    TEST_STEP = 0;
    if (typeof openOv === 'function') openOv('soulTestOv');
    renderTest();
  }

  function renderTest() {
    const box = $('#soulTestBody');
    if (!box) return;
    if (TEST_STEP >= QUESTIONS.length) {
      api('/api/soul/test', 'POST', { answers: TEST_ANSWERS }).then(d => {
        const p = d && d.planet;
        box.innerHTML = `<div class="soul-planet-card">
          <div class="emoji">${(p && p.emoji) || '✦'}</div>
          <h3>${(p && p.name) || 'كوكبك'}</h3>
          <p>${(p && p.tag) || ''}</p>
          <button class="soul-primary" type="button" id="soulTestDone">انطلاق إلى الحفلة</button>
        </div>`;
        const done = $('#soulTestDone');
        if (done) done.onclick = () => { closeOv('soulTestOv'); paintMePlanet(); };
        if (typeof ME !== 'undefined' && ME && p) ME.soul_planet = p.id;
      }).catch(() => {
        box.innerHTML = '<div class="soul-empty">تعذر حفظ النتيجة</div>';
      });
      return;
    }
    const item = QUESTIONS[TEST_STEP];
    box.innerHTML = `<div class="soul-q"><b>${TEST_STEP + 1}. ${item.q}</b>${item.a.map((t, i) => `<button type="button" data-a="${i}">${t}</button>`).join('')}</div>`;
    $$('#soulTestBody [data-a]').forEach(b => {
      b.onclick = () => {
        TEST_ANSWERS.push(+b.dataset.a);
        TEST_STEP += 1;
        renderTest();
      };
    });
  }

  async function startMatch() {
    if (!needAuth()) return;
    if (typeof ME !== 'undefined' && ME && !ME.registered) {
      if (typeof openOv === 'function') openOv('needRegOv');
      return;
    }
    MATCHING = true;
    if (typeof openOv === 'function') openOv('soulMatchOv');
    const title = $('#soulMatchTitle');
    if (title) title.textContent = 'جارٍ البحث عن روح قريبة...';
    try {
      const d = await api('/api/soul/match', 'POST', {});
      if (d && d.waiting) {
        setTimeout(() => {
          if (!MATCHING) return;
          api('/api/soul/match/cancel', 'POST', {}).catch(() => { });
          MATCHING = false;
          if (title) title.textContent = 'لا يوجد أحد الآن — جرّب الاكتشاف';
          setTimeout(() => { closeOv('soulMatchOv'); if (typeof soulOpenDiscover === 'function') soulOpenDiscover(); }, 900);
        }, 18000);
      } else if (d && d.roomId) joinMatch(d);
    } catch (e) {
      MATCHING = false;
      closeOv('soulMatchOv');
      if (typeof toast === 'function') toast((e && e.error) || 'تعذر التطابق', false);
    }
  }

  function joinMatch(d) {
    MATCHING = false;
    closeOv('soulMatchOv');
    if (typeof toast === 'function') toast('تم العثور على روح ✨');
    if (typeof loadRooms === 'function') loadRooms().then(() => {
      if (typeof enterRoom === 'function') enterRoom(d.roomId);
    }).catch(() => {
      if (typeof enterRoom === 'function') enterRoom(d.roomId);
    });
  }

  function cancelMatch() {
    MATCHING = false;
    api('/api/soul/match/cancel', 'POST', {}).catch(() => { });
    closeOv('soulMatchOv');
  }

  function openGames() {
    if (!CUR_ROOM) return;
    openOv('soulGameOv');
    const out = $('#soulGameOut');
    if (out) out.textContent = 'اختر لعبة جماعية للغرفة';
  }

  function playGame(kind) {
    if (!CUR_ROOM || typeof SOCKET === 'undefined' || !SOCKET) return;
    const users = (typeof ROOM_USERS !== 'undefined' ? ROOM_USERS : []).slice();
    let payload = { kind };
    if (kind === 'dice') payload.value = 1 + Math.floor(Math.random() * 6);
    if (kind === 'ludo') payload.value = 1 + Math.floor(Math.random() * 6);
    if (kind === 'bottle') {
      if (!users.length) return toast('لا يوجد أحد في الغرفة', false);
      payload.target = users[Math.floor(Math.random() * users.length)];
    }
    if (kind === 'card') {
      const dare = Math.random() > 0.5;
      payload.prompt = (dare ? 'تحدّي: ' : 'حقيقة: ') + (dare ? DARE : TRUTH)[Math.floor(Math.random() * 5)];
    }
    SOCKET.emit('soul:game', CUR_ROOM.id, payload);
  }

  function showGame(d) {
    const out = $('#soulGameOut');
    const name = (d.user && d.user.username) || 'شخص';
    let text = '';
    if (d.kind === 'dice' || d.kind === 'ludo') text = `${name} رمى النرد: ${d.value}`;
    else if (d.kind === 'bottle') text = `القنينة توقفت عند ${(d.target && d.target.username) || 'شخص'} 🍾`;
    else if (d.kind === 'card') text = `${name}: ${d.prompt}`;
    if (out) out.textContent = text;
    if (typeof toast === 'function' && text) toast(text);
  }

  async function openInvite() {
    if (!needAuth() || !CUR_ROOM) return;
    openOv('soulInviteOv');
    const box = $('#soulInviteList');
    if (!box) return;
    box.innerHTML = 'جارٍ التحميل...';
    try {
      const d = await api('/api/friends');
      const list = (d.friends || []).concat(d.following || []);
      const seen = new Set();
      const uniq = list.filter(u => { if (seen.has(+u.id)) return false; seen.add(+u.id); return true; });
      box.innerHTML = uniq.length ? uniq.map(u => `<button class="soul-row" data-id="${u.id}" type="button" style="width:100%;background:transparent;border:0;color:#fff">
        <span class="ava"><img src="${u.avatar ? (u.avatar.startsWith('/') ? u.avatar : '/avatars/' + u.avatar) : '/avatars/default.png'}" alt=""></span>
        <div class="info"><b>${u.username}</b><small>دعوة إلى الغرفة</small></div>
      </button>`).join('') : '<div class="soul-empty">تابع أشخاصاً لتدعوهم</div>';
      $$('#soulInviteList [data-id]').forEach(btn => {
        btn.onclick = async () => {
          try {
            await api('/api/soul/invite', 'POST', { user_id: +btn.dataset.id, room_id: CUR_ROOM.id });
            if (typeof toast === 'function') toast('تم إرسال الدعوة');
            closeOv('soulInviteOv');
          } catch (e) {
            if (typeof toast === 'function') toast((e && e.error) || 'تعذر الدعوة', false);
          }
        };
      });
    } catch (e) {
      box.innerHTML = '<div class="soul-empty">تعذر تحميل الأصدقاء</div>';
    }
  }

  async function openPass() {
    if (!needAuth()) return;
    openOv('soulPassOv');
    const st = $('#soulPassStatus');
    try {
      const d = await api('/api/soul/me');
      if (st) st.innerHTML = d.premium
        ? ('أنت مشترك حتى ' + new Date(d.premium_until * 1000).toLocaleDateString('ar'))
        : 'لست مشتركاً بعد — 500 🪙 / 30 يوماً';
      const buy = $('#soulPassBuy');
      if (buy) buy.style.display = d.premium ? 'none' : '';
    } catch (e) { }
  }

  function bindSocket(s) {
    if (!s || s._soulWorld) return;
    s._soulWorld = true;
    s.on('soul:match', d => { if (d && d.roomId) joinMatch(d); });
    s.on('soul:game', showGame);
    s.on('soul:invite', d => {
      if (!d) return;
      if (typeof toast === 'function') toast((d.from && d.from.username ? d.from.username : 'شخص') + ' دعاك إلى ' + (d.name || 'حفلة') + ' — افتح الإشعارات للدخول');
    });
  }

  function wire() {
    $$('#soulModePicks [data-mode]').forEach(b => {
      b.onclick = () => {
        $$('#soulModePicks [data-mode]').forEach(x => x.classList.toggle('active', x === b));
      };
    });
    const liveGo = $('#soulLiveGo');
    if (liveGo) liveGo.onclick = () => {
      if (typeof soulHandleMic === 'function') soulHandleMic();
      else if (typeof bcastStart === 'function') bcastStart('video');
    };
    const vm = $('#soulVoiceMatch');
    if (vm) vm.onclick = startMatch;
    const test = $('#mnSoulTest');
    if (test) test.onclick = () => { closeOv('menuOv'); openSoulTest(); };
    const fr = $('#mnSoulFriends');
    if (fr) fr.onclick = () => { closeOv('menuOv'); if (typeof soulOpenFriends === 'function') soulOpenFriends('friends'); };
    const pass = $('#mnSoulPass');
    if (pass) pass.onclick = () => { closeOv('menuOv'); openPass(); };
    const passBuy = $('#soulPassBuy');
    if (passBuy) passBuy.onclick = async () => {
      try {
        const d = await api('/api/soul/premium', 'POST', {});
        if (typeof ME !== 'undefined' && ME) ME.balance = d.balance;
        if (typeof toast === 'function') toast('تم تفعيل Soul Pass ✨');
        if (typeof soulPaintCoins === 'function') soulPaintCoins();
        openPass();
      } catch (e) {
        if (typeof toast === 'function') toast((e && e.error) || 'تعذر الاشتراك', false);
      }
    };
    const games = $('#dropSoulGames');
    if (games) games.onclick = () => {
      const bg = $('#roomDropBg'); const drop = $('#roomDrop');
      if (drop) drop.classList.remove('open');
      if (bg) bg.style.display = 'none';
      openGames();
    };
    const inv = $('#dropSoulInvite');
    if (inv) inv.onclick = () => {
      const bg = $('#roomDropBg'); const drop = $('#roomDrop');
      if (drop) drop.classList.remove('open');
      if (bg) bg.style.display = 'none';
      openInvite();
    };
    $$('#soulGameOv [data-game]').forEach(b => { b.onclick = () => playGame(b.dataset.game); });
    const mc = $('#soulMatchCancel');
    if (mc) mc.onclick = cancelMatch;
    const og = $('#soulOnboardGo');
    if (og) og.onclick = () => saveInterests(false);
    const os = $('#soulOnboardSkip');
    if (os) os.onclick = () => saveInterests(true);

    if (typeof onLoggedIn === 'function') {
      const _ol = onLoggedIn;
      onLoggedIn = function () {
        _ol.apply(this, arguments);
        paintMePlanet();
        paintEventBanner();
      };
    }
    if (typeof connectSocket === 'function') {
      const _cs = connectSocket;
      connectSocket = function () {
        _cs.apply(this, arguments);
        setTimeout(() => bindSocket(typeof SOCKET !== 'undefined' ? SOCKET : null), 40);
      };
    }
    if (typeof SOCKET !== 'undefined') bindSocket(SOCKET);
    paintEventBanner();
    if (typeof ME !== 'undefined' && ME) paintMePlanet();
    paintMomentsLive();
    if (typeof openPrivateList === 'function') {
      const _opl = openPrivateList;
      openPrivateList = function () {
        _opl.apply(this, arguments);
        paintFollowInParty();
      };
    }
    if (typeof openWall === 'function') {
      const _ow = openWall;
      openWall = function () {
        const r = _ow.apply(this, arguments);
        paintMomentsLive();
        return r;
      };
    }
  }

  function paintMomentsLive() {
    const el = $('#soulMomentsLiveCount');
    if (!el) return;
    let n = 0;
    if (typeof ROOM_COUNTS !== 'undefined' && ROOM_COUNTS) {
      Object.values(ROOM_COUNTS).forEach(v => { n += +v || 0; });
    }
    el.textContent = n || 0;
  }

  async function paintFollowInParty() {
    const row = $('#soulMsgFollowRow');
    if (!row || typeof api !== 'function') return;
    try {
      const d = await api('/api/friends');
      const list = (d.following || []).slice(0, 8);
      row.innerHTML = list.length ? list.map(u => `<button type="button" data-id="${u.id}">
        <img src="${u.avatar ? (u.avatar.startsWith('/') ? u.avatar : '/avatars/' + u.avatar) : '/avatars/default.png'}" alt="">
        <small>${u.username}</small>
      </button>`).join('') : '<small style="color:#9b87b5;padding:8px">تابع أرواحاً لتراهم هنا</small>';
      $$('#soulMsgFollowRow [data-id]').forEach(b => {
        b.onclick = () => {
          const u = list.find(x => +x.id === +b.dataset.id);
          if (u && typeof openPrivateWith === 'function') openPrivateWith(u);
        };
      });
    } catch (e) { }
  }

  window.soulOpenTest = openSoulTest;
  window.soulStartMatch = startMatch;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
