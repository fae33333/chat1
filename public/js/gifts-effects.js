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

    // 2. Display Top Gift Notification Banner
    this.showGiftBanner(gift, sender, receiver);

    // 3. Trigger specific visual animation
    if (gift.id === 'sports_car') {
      this.animateSportsCar(sender);
    } else if (gift.id === 'rocket') {
      this.animateRocket(sender);
    } else if (gift.id === 'crown') {
      this.animateCrown(receiver || sender);
    } else if (gift.id === 'castle') {
      this.animateCastle(sender, receiver);
    } else {
      this.animateSparkles(gift.icon);
    }
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
        <div class="gift-banner-icon">${gift.icon}</div>
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
      particle.innerText = icon;
      
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
  // إرسال الهدية إلى مقعد المستلم: أيقونات تطير نحو المقعد ثم فرقعة وتوهّج ورسالة فوق المقعد
  sendGiftToSeat(gift, sender, receiver, seatEl, senderSeatEl) {
    if (!this.container) this.init();
    const target = seatEl.getBoundingClientRect();
    if (!target.width) return;
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
      icon.textContent = gift.icon;
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
      this.burstAt(tx, ty, gift.icon, gift.luxury ? 18 : 12);
      this.glowSeat(seatEl);
      this.seatLabel(tx, target.top, gift, sender);
    }, FLY_MS + (COUNT - 1) * 90 - 120);
  }

  // فرقعة الأيقونات في كل الاتجاهات من نقطة معيّنة
  burstAt(x, y, icon, n = 12) {
    for (let i = 0; i < n; i++) {
      const p = document.createElement('div');
      p.className = 'gift-pop-particle';
      p.textContent = icon;
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
    label.textContent = `${gift.icon} هدية من ${name}`;
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
