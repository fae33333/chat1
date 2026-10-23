// أيقونة الهدية: صورة مرفوعة من الإدارة (image_url) أو إيموجي احتياطي
function giftIsImg(v) { return typeof v === 'string' && (/^\/uploads\//.test(v) || /^https?:\/\//.test(v)); }
function giftFillIcon(el, v) {
  if (giftIsImg(v)) {
    const img = document.createElement('img');
    img.src = v; img.alt = ''; img.className = 'gift-img';
    img.onerror = () => { img.replaceWith(document.createTextNode('🎁')); };
    el.textContent = '';
    el.appendChild(img);
  } else {
    el.textContent = v || '🎁';
  }
}
// Luxury Gift Special Animations Engine for SoulChill
class GiftEffectsEngine {
  constructor() {
    this.container = null;
    this.init();
  }

  init() {
    let el = document.getElementById('gift-effects-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gift-effects-overlay';
      el.className = 'gift-effects-overlay pointer-events-none';
      document.body.appendChild(el);
    }
    this.container = el;
  }

  showGiftAnimation(gift, sender, receiver) {
    if (!this.container) this.init();

    // 1. Play sound effect
    if (window.soundManager) {
      window.soundManager.playGiftSound(gift.luxury);
    }

    // 2. لا يوجد أي إشعار هنا: الهدية تُعرض كفرقعة/تأثير فقط.
    //    الإشعار الوحيد هو الإشعار العام (gift-banner.js) للهدايا التي فعّلته الإدارة.

    // التأثيرات البصرية: هدية عادية ← showSmallGiftAtSeat ، هدية فاخرة ← showLuxuryFullscreen
  }

  showGiftBanner(gift, sender, receiver) {
    const banner = document.createElement('div');
    banner.className = 'gift-banner-popup';
    banner.innerHTML = `
      <div class="gift-banner-content">
        <img src="${sender.avatar}" class="gift-banner-avatar" />
        <div class="gift-banner-text">
          <div class="gift-banner-sender">${sender.name}</div>
          <div class="gift-banner-desc">أهدى <strong>${gift.name}</strong> إلى ${receiver ? receiver.name : 'الروم'}</div>
        </div>
        <div class="gift-banner-icon">${giftIsImg(gift.image_url) ? `<img class="gift-img" src="${gift.image_url}" alt="" />` : gift.icon}</div>
      </div>
    `;
    this.container.appendChild(banner);

    setTimeout(() => {
      banner.classList.add('fade-out');
      setTimeout(() => banner.remove(), 600);
    }, 4000);
  }

  // Animation: Sports Car zooms across the screen
  animateSportsCar(sender) {
    const carContainer = document.createElement('div');
    carContainer.className = 'car-animation-scene';
    carContainer.innerHTML = `
      <div class="speed-lines"></div>
      <div class="luxury-car">
        <div class="car-body">🏎️</div>
        <div class="car-neon-glow"></div>
        <div class="car-badge">${sender.name}</div>
      </div>
    `;
    this.container.appendChild(carContainer);

    setTimeout(() => carContainer.remove(), 3500);
  }

  // Animation: Rocket launches into space
  animateRocket(sender) {
    const rocketContainer = document.createElement('div');
    rocketContainer.className = 'rocket-animation-scene';
    rocketContainer.innerHTML = `
      <div class="cosmic-trail"></div>
      <div class="luxury-rocket">
        <div class="rocket-body">🚀</div>
        <div class="rocket-exhaust">🔥</div>
        <div class="rocket-badge">إلى الفضاء مع ${sender.name}!</div>
      </div>
    `;
    this.container.appendChild(rocketContainer);

    setTimeout(() => rocketContainer.remove(), 3500);
  }

  // Animation: Golden Imperial Crown descends
  animateCrown(targetUser) {
    const crownContainer = document.createElement('div');
    crownContainer.className = 'crown-animation-scene';
    crownContainer.innerHTML = `
      <div class="crown-rays"></div>
      <div class="luxury-crown">
        <div class="crown-icon">👑</div>
        <div class="crown-title">تاج الملك الإمبراطوري</div>
        <div class="crown-sub">تتويج ${targetUser.name} ملك الروم! ✨</div>
      </div>
    `;
    this.container.appendChild(crownContainer);

    setTimeout(() => crownContainer.remove(), 4000);
  }

  // Animation: Dream Palace
  animateCastle(sender, receiver) {
    const castleContainer = document.createElement('div');
    castleContainer.className = 'castle-animation-scene';
    castleContainer.innerHTML = `
      <div class="castle-glow"></div>
      <div class="luxury-castle">
        <div class="castle-icon">🏰</div>
        <div class="castle-title">قصر الأحلام الملكي ✨</div>
        <div class="castle-sub">من ${sender.name} بكل فخامة 💖</div>
      </div>
    `;
    this.container.appendChild(castleContainer);

    setTimeout(() => castleContainer.remove(), 4200);
  }

  // Animation: General sparkles / flowers / hearts shower
  animateSparkles(icon) {
    const burst = document.createElement('div');
    burst.className = 'sparkle-burst-container';

    for (let i = 0; i < 20; i++) {
      const particle = document.createElement('div');
      particle.className = 'floating-gift-particle';
      giftFillIcon(particle, icon);
      
      const left = Math.random() * 80 + 10;
      const delay = Math.random() * 0.5;
      const duration = Math.random() * 1.5 + 1.5;
      const scale = Math.random() * 0.8 + 0.8;

      particle.style.left = `${left}%`;
      particle.style.animationDelay = `${delay}s`;
      particle.style.animationDuration = `${duration}s`;
      particle.style.fontSize = `${scale * 28}px`;

      burst.appendChild(particle);
    }

    this.container.appendChild(burst);
    setTimeout(() => burst.remove(), 3000);
  }

  // ===== هدية عادية: أيقونة الهدية تنزل من مقعد المستلم إلى بطاقة الهدية في شات الغرفة =====
  // from: {x, y} نقطة البداية (مركز مقعد المستلم) ؛ targetEl: عنصر الأيقونة داخل بطاقة الشات
  flyGiftToChat(gift, from, targetEl, onDone) {
    if (!this.container) this.init();
    const done = () => { try { onDone && onDone(); } catch (e) {} };
    if (!targetEl || !targetEl.getBoundingClientRect) { done(); return; }
    const t = targetEl.getBoundingClientRect();
    if (!t.width) { done(); return; }
    const sx = (from && from.x) || window.innerWidth / 2;
    const sy = (from && from.y) || window.innerHeight * 0.3;
    const ex = t.left + t.width / 2;
    const ey = t.top + t.height / 2;
    const midX = sx + (ex - sx) * 0.35;
    const midY = sy + Math.min(120, Math.max(60, (ey - sy) * 0.25));
    const el = document.createElement('div');
    el.className = 'gift-fly-icon';
    giftFillIcon(el, gift.image_url || gift.icon);
    el.style.left = '0px';
    el.style.top = '0px';
    this.container.appendChild(el);
    const tr = (x, y, sc) => `translate(${x - 24}px, ${y - 24}px) scale(${sc})`;
    const anim = el.animate([
      { transform: tr(sx, sy, 0.4), opacity: 0 },
      { transform: tr(sx, sy, 1.25), opacity: 1, offset: 0.2 },
      { transform: tr(midX, midY, 1.3), opacity: 1, offset: 0.5 },
      { transform: tr(ex, ey, 0.5), opacity: 1 }
    ], { duration: 1500, easing: 'ease-in-out', fill: 'forwards' });
    anim.onfinish = () => { el.remove(); done(); };
  }

  // ===== هدية عادية: أيقونة صغيرة فوق مقعد المستلم + عدد (X1) لمدة ~2.5 ثانية =====
  showSmallGiftAtSeat(gift, sender, receiver, seatEl, count) {
    if (!this.container) this.init();
    if (window.soundManager) { try { window.soundManager.playGiftSound(false); } catch (e) {} }
    const r = seatEl ? seatEl.getBoundingClientRect() : null;
    const has = !!(r && r.width);
    const x = has ? r.left + r.width / 2 : window.innerWidth / 2;
    const top = has ? r.top : window.innerHeight * 0.3;
    const el = document.createElement('div');
    el.className = 'gift-seat-small';
    const ic = document.createElement('span');
    ic.className = 'gss-icon';
    giftFillIcon(ic, gift.image_url || gift.icon);
    const n = document.createElement('span');
    n.className = 'gss-count';
    n.textContent = `${Math.max(1, parseInt(count, 10) || 1)}X`;
    el.appendChild(ic); el.appendChild(n);
    el.style.left = `${x}px`;
    el.style.top = `${top}px`;
    this.container.appendChild(el);
    if (has) this.glowSeat(seatEl);
    const anim = el.animate([
      { transform: 'translate(-50%, 0) scale(.3)', opacity: 0 },
      { transform: 'translate(-50%, -100%) scale(1.25)', opacity: 1, offset: 0.18 },
      { transform: 'translate(-50%, -106%) scale(1)', opacity: 1, offset: 0.8 },
      { transform: 'translate(-50%, -130%) scale(.9)', opacity: 0 }
    ], { duration: 2600, easing: 'ease-out', fill: 'forwards' });
    anim.onfinish = () => el.remove();
  }

  // ===== هدية فاخرة: أنيميشن بملء الشاشة 5–8 ثوانٍ، يحجب الغرفة والكتابة حتى ينتهي =====
  // الهدايا الفاخرة المتتالية تُعرض بالدور حتى لا تتراكم فوق بعضها
  showLuxuryFullscreen(gift, sender, receiver) {
    this._luxQueue = this._luxQueue || [];
    if (this._luxQueue.length >= 4) this._luxQueue.shift();
    this._luxQueue.push({ gift, sender, receiver });
    if (!this._luxBusy) this._playNextLux();
  }

  _playNextLux() {
    const item = this._luxQueue && this._luxQueue.shift();
    if (!item) { this._luxBusy = false; return; }
    this._luxBusy = true;
    const { gift, sender, receiver } = item;
    if (!this.container) this.init();
    if (window.soundManager) { try { window.soundManager.playGiftSound(true); } catch (e) {} }

    const DURATION = 6500; // ضمن 5–8 ثوانٍ
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const recvName = receiver && receiver.name ? receiver.name : 'الجميع';
    const src = gift.image_url || gift.icon;
    const isVid = typeof src === 'string' && /\.(mp4|webm)(\?|$)/i.test(src);
    const media = isVid
      ? `<video class="lux-fs-media" src="${esc(src)}" autoplay muted playsinline></video>`
      : (giftIsImg(src) ? `<img class="lux-fs-media" src="${esc(src)}" alt="">` : `<div class="lux-fs-media lux-fs-emoji">${esc(src || '🎁')}</div>`);

    const ov = document.createElement('div');
    ov.className = 'lux-fs-overlay';
    ov.innerHTML = `
      <div class="lux-fs-rays"></div>
      <div class="lux-fs-trail"></div>
      <div class="lux-fs-stage">${media}</div>
      <div class="lux-fs-caption">
        <div class="lux-fs-crown">👑</div>
        <div class="lux-fs-line">الملك ${esc(sender && sender.name)} يغمر ${esc(recvName)} بـ ${esc(gift.name)}!</div>
      </div>`;
    document.body.appendChild(ov);
    document.body.classList.add('lux-gift-active');
    requestAnimationFrame(() => ov.classList.add('on'));

    setTimeout(() => {
      ov.classList.remove('on');
      ov.classList.add('off');
      setTimeout(() => {
        ov.remove();
        document.body.classList.remove('lux-gift-active');
        this._luxBusy = false;
        this._playNextLux();
      }, 450);
    }, DURATION);
  }

  // إرسال الهدية إلى مقعد المستلم: أيقونات تطير نحو المقعد ثم فرقعة وتوهّج ورسالة فوق المقعد
  sendGiftToSeat(gift, sender, receiver, seatEl, senderSeatEl) {
    if (!this.container) this.init();
    // إن لم يكن المستلم على مقعد مايك: نوجّه التأثير إلى منتصف الشاشة العلوي
    let target = seatEl ? seatEl.getBoundingClientRect() : null;
    const hasSeat = !!(target && target.width);
    if (!hasSeat) target = { left: window.innerWidth / 2, top: window.innerHeight * 0.35, width: 0, height: 0 };
    const tx = target.left + target.width / 2;
    const ty = target.top + target.height / 2;

    let sx = window.innerWidth / 2;
    let sy = window.innerHeight - 70;
    if (senderSeatEl) {
      const sr = senderSeatEl.getBoundingClientRect();
      if (sr.width) { sx = sr.left + sr.width / 2; sy = sr.top + sr.height / 2; }
    }

    const FLY_MS = 700;
    const COUNT = gift.luxury ? 3 : 6;
    for (let i = 0; i < COUNT; i++) {
      const icon = document.createElement('div');
      icon.className = 'gift-fly-icon';
      giftFillIcon(icon, gift.image_url || gift.icon);
      icon.style.left = `${sx}px`;
      icon.style.top = `${sy}px`;
      this.container.appendChild(icon);
      const dx = tx - sx + (Math.random() - 0.5) * 24;
      const dy = ty - sy + (Math.random() - 0.5) * 24;
      const delay = i * 90;
      const anim = icon.animate([
        { transform: 'translate(-50%, -50%) scale(0.6)', opacity: 0 },
        { transform: 'translate(-50%, -50%) scale(1.3)', opacity: 1, offset: 0.2 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1)`, opacity: 1 }
      ], { duration: FLY_MS, delay, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
      anim.onfinish = () => icon.remove();
    }

    // عند الوصول: فرقعة + توهّج + رسالة على المقعد
    setTimeout(() => {
      this.burstAt(tx, ty, gift.image_url || gift.icon, gift.luxury ? 18 : 12);
      if (hasSeat) this.glowSeat(seatEl);
      this.seatLabel(tx, target.top, gift, sender);
    }, FLY_MS + (COUNT - 1) * 90 - 120);
  }

  // سرب صور الهدية: عدد كبير (يحدده الأدمن) ينطلق من المرسل نحو المستلم بتأخير عشوائي
  // gift.burst_enabled / gift.burst_count تأتي من كتالوج الهدايا (لوحة الإدارة)
  burstGiftImages(gift, sender, receiver, seatEl, senderSeatEl) {
    if (!gift) return; // التناثر لكل الهدايا (لم يعد مرتبطاً بخيار الإدارة)
    if (!this.container) this.init();
    const img = gift.image_url || gift.icon; // نفس صورة الهدية فقط
    const count = Math.min(60, Math.max(1, parseInt(gift.burst_count, 10) || 20));

    let sx = window.innerWidth / 2, sy = window.innerHeight - 70;
    if (senderSeatEl) {
      const sr = senderSeatEl.getBoundingClientRect();
      if (sr.width) { sx = sr.left + sr.width / 2; sy = sr.top + sr.height / 2; }
    }
    let tx = window.innerWidth / 2, ty = window.innerHeight * 0.35;
    let hasSeat = false;
    if (seatEl) {
      const tr = seatEl.getBoundingClientRect();
      if (tr.width) { tx = tr.left + tr.width / 2; ty = tr.top + tr.height / 2; hasSeat = true; }
    }

    const FLY_MS = 900, MAX_DELAY = 600;
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'gift-burst-img';
      giftFillIcon(el, img);
      const size = 26 + Math.random() * 26;
      el.style.width = el.style.height = `${size}px`;
      el.style.fontSize = `${size * 0.9}px`;
      el.style.left = `${sx}px`;
      el.style.top = `${sy}px`;
      this.container.appendChild(el);

      const delay = Math.random() * MAX_DELAY;
      const midX = (sx + tx) / 2 + (Math.random() - 0.5) * 140;
      const midY = Math.min(sy, ty) - 40 - Math.random() * 90;
      const endX = tx + (Math.random() - 0.5) * 36;
      const endY = ty + (Math.random() - 0.5) * 36;
      const rot = (Math.random() - 0.5) * 80;
      const anim = el.animate([
        { transform: 'translate(-50%, -50%) scale(0.3) rotate(0deg)', opacity: 0, left: `${sx}px`, top: `${sy}px` },
        { transform: `translate(-50%, -50%) scale(1.25) rotate(${rot / 2}deg)`, opacity: 1, left: `${midX}px`, top: `${midY}px`, offset: 0.45 },
        { transform: `translate(-50%, -50%) scale(0.9) rotate(${rot}deg)`, opacity: 1, left: `${endX}px`, top: `${endY}px`, offset: 0.85 },
        { transform: `translate(-50%, -50%) scale(1.6) rotate(${rot}deg)`, opacity: 0, left: `${endX}px`, top: `${endY}px` }
      ], { duration: FLY_MS, delay, easing: 'ease-in-out', fill: 'both' });
      anim.onfinish = () => el.remove();
    }
    if (hasSeat) setTimeout(() => this.glowSeat(seatEl), FLY_MS * 0.8);
  }

  // فرقعة الأيقونات في كل الاتجاهات من نقطة معيّنة
  burstAt(x, y, icon, n = 12) {
    for (let i = 0; i < n; i++) {
      const p = document.createElement('div');
      p.className = 'gift-pop-particle';
      giftFillIcon(p, icon);
      p.style.left = `${x}px`;
      p.style.top = `${y}px`;
      p.style.fontSize = `${14 + Math.random() * 14}px`;
      this.container.appendChild(p);
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const dist = 50 + Math.random() * 60;
      const anim = p.animate([
        { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) scale(1.1) rotate(${Math.random() * 360}deg)`, opacity: 0 }
      ], { duration: 900 + Math.random() * 300, easing: 'ease-out', fill: 'forwards' });
      anim.onfinish = () => p.remove();
    }
  }

  glowSeat(seatEl) {
    seatEl.classList.add('gift-seat-glow');
    setTimeout(() => seatEl.classList.remove('gift-seat-glow'), 1600);
  }

  // رسالة صغيرة فوق المقعد: «🌹 هدية من فلان»
  seatLabel(x, top, gift, sender) {
    const label = document.createElement('div');
    label.className = 'gift-seat-label';
    const name = (sender && sender.name) ? String(sender.name).slice(0, 14) : 'صديق';
    giftFillIcon(label, gift.image_url || gift.icon);
    label.appendChild(document.createTextNode(` هدية من ${name}`));
    label.style.left = `${x}px`;
    label.style.top = `${top}px`;
    this.container.appendChild(label);
    const anim = label.animate([
      { transform: 'translate(-50%, 0)', opacity: 0 },
      { transform: 'translate(-50%, -14px)', opacity: 1, offset: 0.2 },
      { transform: 'translate(-50%, -34px)', opacity: 1, offset: 0.8 },
      { transform: 'translate(-50%, -44px)', opacity: 0 }
    ], { duration: 2600, easing: 'ease-out', fill: 'forwards' });
    anim.onfinish = () => label.remove();
  }
}

window.giftEffectsEngine = new GiftEffectsEngine();
