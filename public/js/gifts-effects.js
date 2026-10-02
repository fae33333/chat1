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
}

window.giftEffectsEngine = new GiftEffectsEngine();
