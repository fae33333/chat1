// إشعار الهدايا القيّمة (يظهر لكل المتصلين في أي صفحة/غرفة، والنقر عليه يدخل إلى غرفة المرسل)
// يستقبل حدث 'global_gift_banner' من السيرفر، ويعرض الإشعارات في طابور واحداً تلو الآخر.
(function () {
  const SHOW_MS = 5000;     // مدة بقاء الإشعار العادي
  const LUX_SHOW_MS = 7100; // مدة بقاء إشعار الهدية الفاخرة
  const GAP_MS = 350;       // فاصل بين إشعارين
  const MAX_QUEUE = 8;      // حد أقصى للطابور حتى لا يتراكم عند كثرة الهدايا

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isImg = (v) => typeof v === 'string' && (/^\/uploads\//.test(v) || /^https?:\/\//.test(v));
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');

  const queue = [];
  let showing = false;
  let host = null;

  function getHost() {
    if (host && document.body.contains(host)) return host;
    host = document.createElement('div');
    host.id = 'gift-global-banner-host';
    document.body.appendChild(host);
    return host;
  }

  // الإشعار يظهر تحت اسم الغرفة (ترويسة الغرفة) إن كان المستخدم داخل غرفة، وإلا أعلى الشاشة
  function placeHost(lux) {
    const h = getHost();
    const header = document.querySelector('#live-voice-room-modal .live-room-header, #live-video-broadcast-modal .live-room-header');
    const r = header && header.getBoundingClientRect();
    if (r && r.height > 0 && r.bottom > 0) {
      // الفخم أعلى بقليل (يلتصق بالترويسة) والعادي أنزل منه قليلاً
      h.style.top = Math.max(0, r.bottom + (lux ? -2 : 6)) + 'px';
    } else {
      h.style.top = 'calc(env(safe-area-inset-top, 0px) + 8px)';
    }
  }

  function goToRoom(roomId) {
    const A = window.SoulChillApp;
    if (!A || !roomId) return;
    const st = A.state;
    if (!st.currentUser) { A.showToast('سجّل الدخول أولاً للدخول إلى الغرفة 🔒'); return; }
    if (st.activeRoom && st.activeRoom.id === roomId) { A.showToast('أنت بالفعل في هذه الغرفة ✅'); return; }
    // إن كان المستخدم داخل غرفة أخرى نخرج منها أولاً ثم ندخل الغرفة الجديدة
    if (st.activeRoom) { try { A.leaveActiveVoiceRoom(); } catch (e) { console.error(e); } }
    A.openVoiceRoom(roomId);
  }

  function render(p) {
    const g = p.gift || {};
    const iconSrc = g.image_url || g.icon;
    const giftIcon = isImg(iconSrc) ? `<img src="${esc(iconSrc)}" alt="">` : `<span class="ggb-emoji">${esc(iconSrc || '🎁')}</span>`;
    const cur = g.currency === 'coins' ? '🪙' : '💎';
    const senderName = esc(p.sender && p.sender.name);
    const recvName = p.receiver && p.receiver.name ? esc(p.receiver.name) : 'الجميع';

    const el = document.createElement('div');
    const lux = !!g.luxury;
    el.className = 'ggb-banner' + (lux ? ' ggb-lux' : '');
    el.dataset.lux = lux ? '1' : '0';
    // إطار مخصص لكل هدية (يُرفع من الإدارة)؛ الفاخرة بلا إطار مخصص تستعمل الإطار الافتراضي من CSS
    if (g.banner_frame_url && /^\/uploads\/[\w.\-]+$/.test(g.banner_frame_url)) {
      el.classList.add('ggb-framed');
      el.style.setProperty('--ggb-frame', `url('${g.banner_frame_url}')`);
    }
    const titleHtml = lux ? `👑 الملك ${senderName}` : senderName;
    const descHtml = lux
      ? `يغمر ${recvName} بـ ${esc(g.name)}! <b>${fmt(g.cost)} ${cur}</b>`
      : `أرسل ${esc(g.name)} إلى ${recvName} <b>${fmt(g.cost)} ${cur}</b>`;
    const bolt = (cls, pts) => `<svg class="ggb-bolt ${cls}" viewBox="0 0 40 100" preserveAspectRatio="none"><polyline points="${pts}"/></svg>`;
    const bolts = lux ? `<div class="ggb-bolts">
        ${bolt('b1', '22,0 10,38 24,42 8,100')}
        ${bolt('b2', '18,0 30,34 16,40 32,100')}
        ${bolt('b3', '20,0 8,45 22,50 12,100')}
        ${bolt('b4', '16,0 28,40 14,46 30,100')}
      </div>` : '';
    el.innerHTML = `
      <div class="ggb-shine"></div>
      ${bolts}
      <button type="button" class="ggb-go">GO</button>
      <div class="ggb-icon">${giftIcon}</div>
      <div class="ggb-text">
        <div class="ggb-title">${titleHtml}</div>
        <div class="ggb-desc">${descHtml}</div>
      </div>
      <img class="ggb-avatar" src="${esc((p.sender && p.sender.avatar) || '/avatars/avatar-1.png')}" alt="">
    `;
    el.onclick = () => { goToRoom(p.room_id); hide(el, true); };
    return el;
  }

  let current = null;
  function hide(el, immediate) {
    if (!el || el.__hiding) return;
    el.__hiding = true;
    el.classList.remove('show');
    el.classList.add('hide');
    setTimeout(() => { el.remove(); if (current === el) { current = null; showing = false; setTimeout(next, GAP_MS); } }, immediate ? 200 : 380);
  }

  function next() {
    if (showing || !queue.length) return;
    showing = true;
    const el = render(queue.shift());
    current = el;
    placeHost(el.dataset.lux === '1');
    getHost().appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    setTimeout(() => hide(el, false), el.dataset.lux === '1' ? LUX_SHOW_MS : SHOW_MS);
  }

  window.giftGlobalBanner = {
    push(payload) {
      if (!payload || !payload.room_id) return;
      if (queue.length >= MAX_QUEUE) queue.shift();
      queue.push(payload);
      next();
    }
  };
})();

// ===== شريط الهدية العادية داخل الغرفة (كما في الفيديو) =====
// شريط داكن شبه شفاف بجانب مقعد المستلم: صورة المرسل + اسمه + «إرسال إلى ...»، يظهر ~3 ثوانٍ ثم يختفي
(function () {
  const SHOW_MS = 3200;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let current = null;
  let timer = null;

  function remove(el) {
    if (!el) return;
    el.classList.remove('show');
    el.classList.add('hide');
    setTimeout(() => { el.remove(); if (current === el) current = null; }, 320);
  }

  function place(el, seatEl) {
    const vw = window.innerWidth;
    const w = Math.min(270, Math.round(vw * 0.66));
    el.style.width = w + 'px';
    const sr = seatEl && seatEl.getBoundingClientRect ? seatEl.getBoundingClientRect() : null;
    if (sr && sr.width) {
      // حافة الشريط اليسرى عند مركز المقعد تقريباً، ومحاذاة رأسية مع مركز المقعد
      const left = Math.max(8, Math.min(vw - w - 8, sr.left + sr.width / 2 - 28));
      el.style.left = left + 'px';
      el.style.top = Math.max(4, sr.top + sr.height / 2 - 24) + 'px';
      return;
    }
    const header = document.querySelector('#live-voice-room-modal .live-room-header, #live-video-broadcast-modal .live-room-header');
    const hr = header && header.getBoundingClientRect();
    el.style.left = Math.round((vw - w) / 2) + 'px';
    el.style.top = ((hr && hr.height > 0 ? hr.bottom : 60) + 56) + 'px';
  }

  window.giftRoomBanner = {
    push(p) {
      if (!p || !p.gift) return;
      if (current) { clearTimeout(timer); current.remove(); current = null; }
      const recvName = p.receiver && p.receiver.name ? esc(p.receiver.name) : 'الجميع';
      const el = document.createElement('div');
      el.className = 'grb-banner';
      el.innerHTML = `
        <img class="grb-avatar" src="${esc((p.sender && p.sender.avatar) || '/avatars/avatar-1.png')}" alt="" onerror="this.onerror=null;this.src='/avatars/avatar-1.png'">
        <div class="grb-text">
          <div class="grb-name">${esc(p.sender && p.sender.name)}</div>
          <div class="grb-desc">إرسال إلى ${recvName} ...</div>
        </div>`;
      document.body.appendChild(el);
      place(el, p.seatEl);
      current = el;
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
      timer = setTimeout(() => remove(el), SHOW_MS);
    }
  };
})();

// ===== إشعار للمستلم: «فلان أرسل لك هدية» =====
(function () {
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isImg = (v) => typeof v === 'string' && (/^\/uploads\//.test(v) || /^https?:\/\//.test(v));
  const queue = []; let busy = false;
  function next() {
    if (busy || !queue.length) return;
    busy = true;
    const p = queue.shift(); const g = p.gift || {};
    const src = g.image_url || g.icon;
    const icon = isImg(src) ? `<img src="${esc(src)}" alt="">` : `<span>${esc(src || '🎁')}</span>`;
    const el = document.createElement('div');
    el.className = 'grn-notice';
    el.innerHTML = `<div class="grn-icon">${icon}</div>
      <div class="grn-text"><div class="grn-title">🎁 وصلتك هدية</div>
      <div class="grn-desc">${esc(p.sender && p.sender.name)} أرسل لك ${esc(g.name)} x ${Math.max(1, parseInt(p.count, 10) || 1)}</div></div>
      <img class="grn-avatar" src="${esc((p.sender && p.sender.avatar) || '/avatars/avatar-1.png')}" alt="" onerror="this.onerror=null;this.src='/avatars/avatar-1.png'">`;
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    if (window.soundManager) { try { window.soundManager.playGiftSound(false); } catch (e) {} }
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.remove(); busy = false; next(); }, 350);
    }, 4000);
  }
  window.giftReceivedNotice = { show(p) { if (!p || !p.gift) return; if (queue.length >= 5) queue.shift(); queue.push(p); next(); } };
})();
