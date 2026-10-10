// إشعار الهدايا القيّمة (يظهر لكل المتصلين في أي صفحة/غرفة، والنقر عليه يدخل إلى غرفة المرسل)
// يستقبل حدث 'global_gift_banner' من السيرفر، ويعرض الإشعارات في طابور واحداً تلو الآخر.
(function () {
  const SHOW_MS = 5000;     // مدة بقاء الإشعار
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
        <div class="ggb-title">${senderName}</div>
        <div class="ggb-desc">أرسل ${esc(g.name)} إلى ${recvName} <b>${fmt(g.cost)} ${cur}</b></div>
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
    setTimeout(() => hide(el, false), SHOW_MS);
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
