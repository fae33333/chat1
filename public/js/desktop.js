/* ============================================================
   نسخة الكمبيوتر (الديسكتوب) — منطق الواجهة
   - لوحة جانبية مثبتة داخل الغرفة مع تبويبين: قائمة الغرف / مستخدمين
   - بطاقة المستخدم (الصورة والاسم والرصيد) أعلى اللوحة
   - ويدجت الراديو أسفل اللوحة (تشغيل/إيقاف + مستوى الصوت)
   - أزرار الخاص/الإشعارات في الهيدر (بديل شريط التنقل السفلي)
   لا يغيّر شيئاً على الجوال — كل التأثيرات مشروطة بعرض الشاشة 1024px+
   ============================================================ */
(() => {
  'use strict';

  const mq = (typeof window.matchMedia === 'function')
    ? window.matchMedia('(min-width: 1024px)')
    : { matches: false, addEventListener() { }, removeEventListener() { }, addListener() { } };
  const $ = (s, r) => (r || document).querySelector(s);

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  // الوصول الآمن لمتغيرات app.js العامة (تجنّب أي تعارض)
  function g(fn) { try { return fn(); } catch (_) { return null; } }

  /* ارتفاع هيدر الدردشة كمتغير CSS حتى تلتصق اللوحة أسفله بدقة */
  function syncHeadH() {
    const top = $('#chatScreen .c-top');
    if (top) document.documentElement.style.setProperty('--dsk-head-h', top.offsetHeight + 'px');
  }
  window.addEventListener('resize', syncHeadH);

  /* ---------- عناصر اللوحة الجانبية ---------- */
  const usersPanel = $('#usersPanel');
  let dskProfile = null, dskRoomsBody = null, dskRadio = null;
  let tabBtns = {};

  function buildSide() {
    if (!usersPanel || $('#dskProfile')) return;

    dskProfile = el(`
      <div class="dsk-profile dsk-only" id="dskProfile" title="ملفي">
        <span class="dsk-profile-ava" id="dskProfileAva"><i class="f7-icons">person_fill</i></span>
        <div class="dsk-profile-info">
          <b id="dskProfileName">زائر</b>
          <span class="dsk-profile-coins" id="dskProfileCoins"><i></i><em id="dskProfileBal">0</em></span>
        </div>
        <button class="dsk-profile-menu" id="dskProfileMenu" type="button" title="القائمة"><i class="f7-icons">line_horizontal_3</i></button>
      </div>`);

    const tabs = el(`
      <div class="dsk-tabs dsk-only" id="dskTabs">
        <button type="button" data-tab="rooms" id="dskTabRooms"><i class="f7-icons">house_fill</i><span>قائمة الغرف</span></button>
        <button type="button" data-tab="users" id="dskTabUsers" class="active"><i class="f7-icons">person_2_fill</i><span>مستخدمين</span></button>
      </div>`);

    const head = $('.sp-head', usersPanel);
    usersPanel.insertBefore(tabs, head);
    usersPanel.insertBefore(dskProfile, tabs);

    dskRoomsBody = el('<div class="sp-body dsk-rooms-body dsk-only" id="dskRoomsList"></div>');
    usersPanel.appendChild(dskRoomsBody);

    dskRadio = el(`
      <div class="dsk-radio dsk-only" id="dskRadio" hidden>
        <div class="dsk-radio-info"><b id="dskRadioName">راديو نجوم العرب</b><span>بث مباشر حصري</span></div>
        <button class="dsk-radio-toggle" id="dskRadioBtn" type="button" title="تشغيل/إيقاف الراديو"><i class="f7-icons" id="dskRadioIcon">play_fill</i></button>
        <div class="dsk-radio-vol">
          <i class="f7-icons">speaker_fill</i>
          <input type="range" id="dskRadioVol" min="0" max="100" value="90" title="مستوى الصوت">
          <i class="f7-icons">speaker_2_fill</i>
        </div>
      </div>`);
    usersPanel.appendChild(dskRadio);

    tabBtns = { rooms: $('#dskTabRooms', tabs), users: $('#dskTabUsers', tabs) };
    tabBtns.rooms.onclick = () => setTab('rooms');
    tabBtns.users.onclick = () => setTab('users');

    $('#dskProfileMenu').onclick = (e) => {
      e.stopPropagation();
      toggleDskMenu();
    };
    dskProfile.onclick = (e) => {
      if (e.target.closest('#dskProfileMenu')) return;
      const me = g(() => ME);
      if (!me || !me.username) g(() => openLogin());
    };

    // الراديو: نفس منطق كبسولة الراديو في الهيدر
    $('#dskRadioBtn').onclick = () => g(() => radioToggle());
    const vol = $('#dskRadioVol'), audio = $('#radioAudio');
    if (vol && audio) {
      vol.oninput = () => { try { audio.volume = vol.value / 100; } catch (_) {} };
      audio.addEventListener('play', () => { try { audio.volume = vol.value / 100; } catch (_) {} });
    }
    if (audio) {
      const setIcon = (playing) => {
        const i = $('#dskRadioIcon');
        if (i) i.textContent = playing ? 'stop_fill' : 'play_fill';
        const btn = $('#dskRadioBtn');
        if (btn) btn.title = playing ? 'إيقاف الراديو' : 'تشغيل الراديو';
      };
      audio.addEventListener('playing', () => setIcon(true));
      audio.addEventListener('pause', () => setIcon(false));
      audio.addEventListener('error', () => setIcon(false));
    }
  }

  function setTab(tab) {
    if (!usersPanel) return;
    usersPanel.classList.toggle('dsk-tab-rooms', tab === 'rooms');
    Object.keys(tabBtns).forEach(k => tabBtns[k] && tabBtns[k].classList.toggle('active', k === tab));
    if (tab === 'rooms') renderDskRooms();
  }

  /* ---------- قائمة الغرف داخل تبويب اللوحة ---------- */
  function renderDskRooms() {
    if (!dskRoomsBody) return;
    let list = [];
    g(() => {
      const q = (($('#userSearch') || {}).value || '').trim();
      list = ROOMS.filter(r => !q || r.name.includes(q));
    });
    g(() => {
      dskRoomsBody.innerHTML = list.length
        ? list.map(r => roomMiniHtml(r)).join('')
        : '<div class="pv-empty" style="padding:50px 10px"><div>لا توجد غرف هنا</div></div>';
      dskRoomsBody.querySelectorAll('.room-mini').forEach(row => {
        row.onclick = () => {
          g(() => {
            const id = +row.dataset.id;
            if (CUR_ROOM && id === CUR_ROOM.id) { toast('أنت متواجد في هذه الغرفة حالياً 📍'); return; }
            attemptRoomSwitch(id);
          });
        };
      });
    });
  }

  /* ---------- مزامنة بطاقة المستخدم والراديو ---------- */
  function syncProfile() {
    if (!dskProfile) return;
    const me = g(() => ME);
    const logged = !!(me && me.username);
    const ava = $('#dskProfileAva'), nameEl = $('#dskProfileName'),
      coins = $('#dskProfileCoins'), bal = $('#dskProfileBal');
    if (!ava || !nameEl || !coins || !bal) return;
    if (logged) {
      g(() => { ava.innerHTML = avatarHtml(me.avatar); });
      nameEl.textContent = me.username;
      coins.style.display = '';
      bal.textContent = (me.balance === undefined || me.balance === null) ? '0' : me.balance;
      dskProfile.title = 'ملفي: ' + me.username;
    } else {
      ava.innerHTML = '<i class="f7-icons">person_fill</i>';
      nameEl.textContent = 'تسجيل الدخول';
      coins.style.display = 'none';
      dskProfile.title = 'اضغط لتسجيل الدخول';
    }
    // أدوات هيدر الغرف تظهر للمسجلين فقط (مثل الصورة المرفقة)
    const tools = $('#dskHeadTools');
    if (tools) tools.classList.toggle('logged-out', !logged);
  }
  function syncRadio() {
    if (!dskRadio) return;
    const cfg = g(() => radioCfg());
    const show = !!(cfg && cfg.enabled && cfg.url);
    dskRadio.hidden = !show;
    if (show && cfg.name) {
      const n = $('#dskRadioName');
      if (n) n.textContent = cfg.name;
    }
  }

  /* ---------- اعتراض فتح/إغلاق اللوحات: على الديسكتوب اللوحة مثبتة دائماً ---------- */
  function wrapPanelFns() {
    g(() => {
      const origUsers = setUsersPanel;
      setUsersPanel = function (open) {
        if (mq.matches) { setTab('users'); return; }
        return origUsers(open);
      };
    });
    g(() => {
      const origRooms = setRoomsPanel;
      setRoomsPanel = function (open) {
        if (mq.matches) { if (open) setTab('rooms'); return; }
        return origRooms(open);
      };
    });
  }

  /* ---------- إعادة تصيير قائمة غرف التبويب عند تحديث الغرف ---------- */
  function hookRenders() {
    g(() => {
      const orig = renderRooms;
      renderRooms = function () {
        const out = orig.apply(this, arguments);
        if (usersPanel && usersPanel.classList.contains('dsk-tab-rooms')) renderDskRooms();
        return out;
      };
    });
  }

  /* ---------- أزرار الهيدر ---------- */
  function buildHeads() {
    // هيدر الدردشة: الخاص + الحائط + الإشعارات (بديل شريط التنقل السفلي المخفي)
    const ctb = $('#chatScreen .c-top-btns');
    if (ctb && !$('#dskNavPrivate')) {
      const bp = el('<button class="cbtn dsk-only dsk-nav-btn" id="dskNavPrivate" type="button" title="الرسائل الخاصة"><i class="f7-icons">bubble_left_fill</i></button>');
      const bw = el('<button class="cbtn dsk-only dsk-nav-btn" id="dskNavWall" type="button" title="الحائط"><i class="f7-icons">doc_text_fill</i></button>');
      const bn = el('<button class="cbtn dsk-only dsk-nav-btn" id="dskNavNotifs" type="button" title="الإشعارات"><i class="f7-icons">bell_fill</i></button>');
      const first = ctb.firstChild;
      ctb.insertBefore(bn, first);
      ctb.insertBefore(bw, bn);
      ctb.insertBefore(bp, bw);
      bp.onclick = () => { const b = $('.bn-item[data-nav="private"]'); if (b) b.click(); };
      bw.onclick = () => { const b = $('.bn-item[data-nav="wall"]'); if (b) b.click(); };
      bn.onclick = () => { const b = $('.bn-item[data-nav="notifs"]'); if (b) b.click(); };
    }

    // هيدر شاشة الغرف: أدوات للمسجلين
    const rh = $('#roomsScreen .r-head');
    if (rh && !$('#dskHeadTools')) {
      const tools = el(`
        <div class="r-head-tools dsk-only" id="dskHeadTools">
          <button type="button" data-act="private" title="الرسائل الخاصة"><i class="f7-icons">bubble_left_fill</i></button>
          <button type="button" data-act="notifs" title="الإشعارات"><i class="f7-icons">bell_fill</i></button>
          <button type="button" data-act="wall" title="الحائط"><i class="f7-icons">doc_text_fill</i></button>
          <button type="button" data-act="menu" title="القائمة"><i class="f7-icons">square_grid2x2_fill</i></button>
        </div>`);
      const enter = $('#headEnterBtn');
      if (enter) rh.insertBefore(tools, enter); else rh.appendChild(tools);
      tools.querySelectorAll('button').forEach(b => {
        b.onclick = () => {
          const me = g(() => ME);
          if (!me || !me.username) { g(() => openLogin()); return; }
          const t = $('.bn-item[data-nav="' + b.dataset.act + '"]');
          if (t) t.click();
        };
      });
    }
  }

  /* ---------- القائمة الرئيسية المنسدلة (زر الهامبرغر في بطاقة المستخدم) ---------- */
  function dskMenuItem(ic, label) {
    return el(`<button class="dsk-menu-item" type="button"><span class="dmi-ic ${ic.cls}"><i class="f7-icons">${ic.icon}</i></span><span>${label}</span><i class="f7-icons dmi-chev">chevron_left</i></button>`);
  }
  function buildDskMenu() {
    if ($('#dskMenuDrop')) return;
    const veil = el('<div class="dsk-drop-veil" id="dskMenuVeil"></div>');
    const drop = el('<div class="dsk-menu-drop" id="dskMenuDrop"></div>');
    const g1 = el('<div class="dsk-menu-group"></div>');
    const g2 = el('<div class="dsk-menu-group"></div>');
    const g3 = el('<div class="dsk-menu-group"></div>');
    const mk = (parent, ic, label, fn) => {
      const b = dskMenuItem(ic, label);
      b.onclick = () => { closeDskMenu(); fn(); };
      parent.appendChild(b);
      return b;
    };
    mk(g1, { icon: 'person_crop_circle', cls: 'maroon' }, 'حسابي', () => g(() => $('#mnAccount').click()));
    mk(g1, { icon: 'chart_bar_fill', cls: 'gold' }, 'ترقية حسابي', () => g(() => $('#mnUpgrade').click()));
    mk(g2, { icon: 'photo_on_rectangle', cls: 'purple' }, 'تغيير الصورة', () => g(() => $('#mnAvatar').click()));
    mk(g2, { icon: 'slash_circle_fill', cls: 'red' }, 'قوائم الحظر', () => g(() => $('#mnBlocks').click()));
    mk(g2, { icon: 'gear_alt_fill', cls: 'blue' }, 'الاعدادات', () => g(() => $('#mnSettings').click()));
    mk(g2, { icon: 'arrow_down_to_line', cls: 'orange' }, 'تطبيق نجوم العرب', () => window.open('https://play.google.com/store/apps/details?id=www.arabjostars.com', '_blank'));
    mk(g3, { icon: 'gift_fill', cls: 'pink' }, 'هدايا حسابي', () => g(() => $('#mnMyGifts').click()));
    mk(g3, { icon: 'power', cls: 'gray' }, 'تسجيل الخروج', () => g(() => $('#mnLogout').click()));
    drop.appendChild(g1); drop.appendChild(g2); drop.appendChild(g3);
    usersPanel.appendChild(veil);
    usersPanel.appendChild(drop);
    veil.onclick = closeDskMenu;
  }
  function placeDskMenu() {
    const drop = $('#dskMenuDrop'), veil = $('#dskMenuVeil');
    if (!drop || !dskProfile) return;
    const top = dskProfile.offsetTop + dskProfile.offsetHeight + 8;
    drop.style.top = top + 'px';
    veil.style.top = top + 'px';
    const radio = $('#dskRadio');
    drop.style.bottom = (radio && !radio.hidden) ? (radio.offsetHeight + 26) + 'px' : '14px';
  }
  function openDskMenu() {
    const me = g(() => ME);
    if (!me || !me.username) { g(() => openLogin()); return; }
    buildDskMenu();
    placeDskMenu();
    $('#dskMenuDrop').classList.add('open');
    $('#dskMenuVeil').classList.add('open');
  }
  function closeDskMenu() {
    const d = $('#dskMenuDrop'), v = $('#dskMenuVeil');
    if (d) d.classList.remove('open');
    if (v) v.classList.remove('open');
  }
  function toggleDskMenu() {
    const d = $('#dskMenuDrop');
    (d && d.classList.contains('open')) ? closeDskMenu() : openDskMenu();
  }

  /* ---------- قائمة الحالة السريعة تحت زر النقاط (⋮) على الديسكتوب ---------- */
  function buildQuickExtras() {
    const sheet = $('#quickOv .sheet');
    if (!sheet || $('#dskQuickLogout')) return;
    const b = el('<button class="us-opt st dsk-only" id="dskQuickLogout" type="button"><i class="f7-icons">power</i> الخروج <i class="f7-icons">chevron_right</i></button>');
    b.onclick = () => { g(() => closeOv('quickOv')); g(() => $('#mnLogout').click()); };
    sheet.appendChild(b);
  }
  function overrideRoomMore() {
    const more = $('#btnRoomMore');
    if (!more) return;
    more.onclick = (e) => {
      e.stopPropagation();
      if (mq.matches) {
        buildQuickExtras();
        g(() => { closeRoomDrop(); openOv('quickOv'); });
        return;
      }
      g(() => { $('#roomDropBg').style.display = 'block'; $('#roomDrop').classList.toggle('open'); });
    };
  }

  /* ---------- إغلاق لوحات الخاص/الإشعارات بالنقر على الخلفية (الديسكتوب) ---------- */
  function hookFloatingPanels() {
    ['privOv', 'notifOv'].forEach(id => {
      const o = $('#' + id);
      if (o) o.addEventListener('click', (e) => { if (mq.matches && e.target === o) g(() => closeOv(id)); });
    });
  }

  /* ---------- عند التبديل بين الجوال والديسكتوب ---------- */
  function onMq() {
    if (!mq.matches && usersPanel) {
      usersPanel.classList.remove('dsk-tab-rooms', 'open');
      closeDskMenu();
      Object.keys(tabBtns).forEach(k => tabBtns[k] && tabBtns[k].classList.remove('active'));
      if (tabBtns.users) tabBtns.users.classList.add('active');
    }
    syncHeadH();
  }

  function init() {
    buildSide();
    buildHeads();
    wrapPanelFns();
    hookRenders();
    overrideRoomMore();
    hookFloatingPanels();
    syncHeadH();
    syncProfile();
    syncRadio();
    setInterval(() => { syncProfile(); syncRadio(); syncHeadH(); }, 1500);
    const us = $('#userSearch');
    if (us) us.addEventListener('input', () => {
      if (usersPanel && usersPanel.classList.contains('dsk-tab-rooms')) renderDskRooms();
    });
    if (mq.addEventListener) mq.addEventListener('change', onMq);
    else if (mq.addListener) mq.addListener(onMq);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
