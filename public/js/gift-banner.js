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
// كبسولة داكنة شبه شفافة: صورة المرسل + اسمه + «إرسال إلى ...» + عدّاد X، تنبثق من اليمين.
// تبقى ثابتة تحت اسم الغرفة بقليل، ومن يرسل بعده تظهر كبسولته أسفل السابقة (تتراص عمودياً).
(function () {
  const SHOW_MS = 3200;
  const MAX_STACK = 4; // أقصى عدد كبسولات ظاهرة معاً
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const items = []; // { slot, el, key, timer, gone }
  let stack = null;

  function getStack() {
    if (stack && document.body.contains(stack)) return stack;
    stack = document.createElement('div');
    stack.id = 'gift-room-banner-stack';
    document.body.appendChild(stack);
    return stack;
  }

  // تحت ترويسة الغرفة (اسم الغرفة) بقليل، وتحت إشعار الهدية الفاخرة إن كان ظاهراً
  function place() {
    const st = getStack();
    const header = document.querySelector('#live-voice-room-modal .live-room-header, #live-video-broadcast-modal .live-room-header');
    const hr = header && header.getBoundingClientRect();
    let top = hr && hr.height > 0 && hr.bottom > 0 ? hr.bottom + 10 : 70;
    const lux = document.querySelector('#gift-global-banner-host .ggb-banner.show');
    const lr = lux && lux.getBoundingClientRect();
    if (lr && lr.height > 0) top = Math.max(top, lr.bottom + 8);
    st.style.top = Math.round(top) + 'px';
  }

  function remove(item) {
    if (!item || item.gone) return;
    item.gone = true;
    clearTimeout(item.timer);
    const i = items.indexOf(item);
    if (i >= 0) items.splice(i, 1);
    item.el.classList.remove('show');
    item.el.classList.add('hide');
    // بعد اختفاء الكبسولة تنزلق التي تحتها إلى مكانها
    setTimeout(() => {
      item.slot.classList.add('collapse');
      setTimeout(() => item.slot.remove(), 280);
    }, 260);
  }

  window.giftRoomBanner = {
    push(p) {
      if (!p || !p.gift) return;
      const iconSrc = p.gift.image_url || p.gift.icon;
      const isImg = typeof iconSrc === 'string' && (/^\/uploads\//.test(iconSrc) || /^https?:\/\//.test(iconSrc));
      const giftIcon = isImg ? `<img src="${esc(iconSrc)}" alt="">` : `<span>${esc(iconSrc || '🎁')}</span>`;
      const combo = Math.max(1, parseInt(p.combo, 10) || 1);
      const key = [p.sender && p.sender.id, p.receiver && p.receiver.id, p.gift.id].join('|');
      place();
      // نفس المرسل/المستلم/الهدية: نحدّث العدّاد في الكبسولة نفسها بدل إنشاء كبسولة جديدة
      const same = items.find((it) => it.key === key && !it.gone);
      if (same) {
        const cnt = same.el.querySelector('.grb-combo');
        if (cnt) { cnt.textContent = `X${combo}`; cnt.classList.remove('bump'); void cnt.offsetWidth; cnt.classList.add('bump'); }
        clearTimeout(same.timer);
        same.timer = setTimeout(() => remove(same), SHOW_MS);
        return;
      }
      // لا نتجاوز الحد الأقصى: الأقدم تُزال لتفسح المجال للأحدث (تظهر أسفلها)
      while (items.length >= MAX_STACK) remove(items[0]);
      const recvName = p.receiver && p.receiver.name ? esc(p.receiver.name) : 'الجميع';
      const slot = document.createElement('div');
      slot.className = 'grb-slot';
      const el = document.createElement('div');
      el.className = 'grb-banner';
      el.dataset.key = key;
      el.innerHTML = `
        <span class="grb-combo">X${combo}</span>
        <div class="grb-gift">${giftIcon}</div>
        <div class="grb-text">
          <div class="grb-name">${esc(p.sender && p.sender.name)}</div>
          <div class="grb-desc">إرسال إلى ${recvName} ...</div>
        </div>
        <img class="grb-avatar" src="${esc((p.sender && p.sender.avatar) || '/avatars/avatar-1.png')}" alt="" onerror="this.onerror=null;this.src='/avatars/avatar-1.png'">`;
      slot.appendChild(el);
      getStack().appendChild(slot); // الأحدث تحت الأقدم
      const item = { slot, el, key, timer: null, gone: false };
      items.push(item);
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
      item.timer = setTimeout(() => remove(item), SHOW_MS);
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
