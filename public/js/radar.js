// Interactive Soul Planet Galaxy Radar Canvas
class SoulPlanetRadar {
  constructor(canvasId, onSelectUser) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.onSelectUser = onSelectUser;
    this.users = [];
    this.stars = [];
    this.nodes = [];
    this.angleOffset = 0;
    this.isHovering = false;
    this.hoveredNode = null;
    this.animationFrame = null;
    this.filter = 'all';

    this.initCanvas();
    this.initStars();
    this.bindEvents();
    this.animate = this.animate.bind(this);
    this.animate();
  }

  initCanvas() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = rect.width || 380;
    this.height = Math.max(380, rect.height || 420);
    this.canvas.width = this.width * window.devicePixelRatio;
    this.canvas.height = this.height * window.devicePixelRatio;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    this.centerX = this.width / 2;
    this.centerY = this.height / 2;
  }

  initStars() {
    this.stars = [];
    for (let i = 0; i < 70; i++) {
      this.stars.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        radius: Math.random() * 1.5 + 0.5,
        alpha: Math.random() * 0.8 + 0.2,
        speed: Math.random() * 0.02 + 0.005
      });
    }
  }

  setUsers(users, currentUser) {
    this.currentUser = currentUser;
    this.users = users.filter(u => !currentUser || u.id !== currentUser.id);
    this.rebuildNodes();
  }

  setFilter(filter) {
    this.filter = filter;
    this.rebuildNodes();
  }

  rebuildNodes() {
    this.nodes = [];
    let list = [...this.users];

    if (this.filter === 'top_match') {
      list = list.sort((a, b) => b.soul_score - a.soul_score).slice(0, 5);
    } else if (this.filter === 'same_planet' && this.currentUser) {
      list = list.filter(u => u.soul_planet === this.currentUser.soul_planet);
      if (list.length === 0) list = [...this.users].slice(0, 4);
    }

    const orbits = [
      { radius: 65, speed: 0.006 },
      { radius: 110, speed: -0.004 },
      { radius: 155, speed: 0.003 }
    ];

    list.forEach((user, idx) => {
      const orbit = orbits[idx % orbits.length];
      const initialAngle = (idx * (Math.PI * 2 / list.length)) + (Math.random() * 0.5);
      
      // Calculate match rate based on soul score
      const matchRate = Math.min(99, Math.max(75, Math.floor(user.soul_score + (Math.random() * 6 - 3))));

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = user.avatar;

      this.nodes.push({
        user,
        orbitRadius: orbit.radius,
        speed: orbit.speed,
        angle: initialAngle,
        size: 24,
        matchRate,
        img,
        x: 0,
        y: 0
      });
    });
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      this.initCanvas();
      this.initStars();
    });

    const getPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    };

    this.canvas.addEventListener('mousemove', (e) => {
      const pos = getPos(e);
      this.checkHover(pos.x, pos.y);
    });

    this.canvas.addEventListener('click', (e) => {
      const pos = getPos(e);
      const clicked = this.getNodeAt(pos.x, pos.y);
      if (clicked) {
        if (window.soundManager) window.soundManager.playClick();
        if (this.onSelectUser) this.onSelectUser(clicked.user, clicked.matchRate);
      }
    });

    this.canvas.addEventListener('touchstart', (e) => {
      const pos = getPos(e);
      const clicked = this.getNodeAt(pos.x, pos.y);
      if (clicked) {
        e.preventDefault();
        if (window.soundManager) window.soundManager.playClick();
        if (this.onSelectUser) this.onSelectUser(clicked.user, clicked.matchRate);
      }
    }, { passive: false });
  }

  checkHover(x, y) {
    const node = this.getNodeAt(x, y);
    if (node) {
      this.canvas.style.cursor = 'pointer';
      this.hoveredNode = node;
    } else {
      this.canvas.style.cursor = 'default';
      this.hoveredNode = null;
    }
  }

  getNodeAt(x, y) {
    for (const node of this.nodes) {
      const dx = node.x - x;
      const dy = node.y - y;
      if (Math.sqrt(dx * dx + dy * dy) < node.size + 10) {
        return node;
      }
    }
    return null;
  }

  animate() {
    this.ctx.clearRect(0, 0, this.width, this.height);

    // 1. Draw Background Stars
    this.stars.forEach(star => {
      star.alpha += star.speed;
      if (star.alpha > 1 || star.alpha < 0.2) star.speed = -star.speed;
      this.ctx.fillStyle = `rgba(255, 255, 255, ${Math.abs(star.alpha)})`;
      this.ctx.beginPath();
      this.ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
      this.ctx.fill();
    });

    // 2. Draw Nebula Radial Glow
    const gradient = this.ctx.createRadialGradient(
      this.centerX, this.centerY, 10,
      this.centerX, this.centerY, 190
    );
    gradient.addColorStop(0, 'rgba(124, 58, 237, 0.28)');
    gradient.addColorStop(0.5, 'rgba(236, 72, 153, 0.12)');
    gradient.addColorStop(1, 'rgba(13, 11, 30, 0)');
    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(this.centerX, this.centerY, 190, 0, Math.PI * 2);
    this.ctx.fill();

    // 3. Draw Orbit Rings
    const orbits = [65, 110, 155];
    orbits.forEach((r, idx) => {
      this.ctx.strokeStyle = `rgba(139, 92, 246, ${0.18 - idx * 0.04})`;
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash([4, 6]);
      this.ctx.beginPath();
      this.ctx.arc(this.centerX, this.centerY, r, 0, Math.PI * 2);
      this.ctx.stroke();
    });
    this.ctx.setLineDash([]);

    // 4. Draw Center Planet (Current User's Soul)
    this.drawCenterPlanet();

    // 5. Update and Draw Orbiting Soul Nodes
    this.nodes.forEach(node => {
      node.angle += node.speed;
      node.x = this.centerX + Math.cos(node.angle) * node.orbitRadius;
      node.y = this.centerY + Math.sin(node.angle) * node.orbitRadius;

      this.drawSoulNode(node);
    });

    this.animationFrame = requestAnimationFrame(this.animate);
  }

  drawCenterPlanet() {
    const time = Date.now() * 0.002;
    const pulse = Math.sin(time) * 4;

    // Glowing core
    const coreGrad = this.ctx.createRadialGradient(
      this.centerX, this.centerY, 5,
      this.centerX, this.centerY, 36 + pulse
    );
    coreGrad.addColorStop(0, '#c084fc');
    coreGrad.addColorStop(0.6, '#9333ea');
    coreGrad.addColorStop(1, 'rgba(147, 51, 234, 0)');

    this.ctx.fillStyle = coreGrad;
    this.ctx.beginPath();
    this.ctx.arc(this.centerX, this.centerY, 36 + pulse, 0, Math.PI * 2);
    this.ctx.fill();

    // Center icon/avatar
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(this.centerX, this.centerY, 20, 0, Math.PI * 2);
    this.ctx.fillStyle = '#6d28d9';
    this.ctx.fill();
    this.ctx.strokeStyle = '#f472b6';
    this.ctx.lineWidth = 2.5;
    this.ctx.stroke();

    // Ring around center
    this.ctx.strokeStyle = 'rgba(244, 114, 182, 0.7)';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.ellipse(this.centerX, this.centerY, 28, 9, Math.PI / 4, 0, Math.PI * 2);
    this.ctx.stroke();

    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = 'bold 12px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('🪐', this.centerX, this.centerY);

    this.ctx.restore();
  }

  drawSoulNode(node) {
    const isHovered = this.hoveredNode === node;
    const size = isHovered ? node.size + 4 : node.size;

    // Outer glow
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(node.x, node.y, size + 5, 0, Math.PI * 2);
    this.ctx.fillStyle = isHovered ? 'rgba(236, 72, 153, 0.4)' : 'rgba(139, 92, 246, 0.25)';
    this.ctx.fill();

    // Avatar Circle
    this.ctx.beginPath();
    this.ctx.arc(node.x, node.y, size, 0, Math.PI * 2);
    this.ctx.clip();

    if (node.img && node.img.complete && node.img.naturalWidth > 0) {
      this.ctx.drawImage(node.img, node.x - size, node.y - size, size * 2, size * 2);
    } else {
      this.ctx.fillStyle = '#7c3aed';
      this.ctx.fillRect(node.x - size, node.y - size, size * 2, size * 2);
      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = '14px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(node.user.name.charAt(0), node.x, node.y);
    }
    this.ctx.restore();

    // Border ring
    this.ctx.beginPath();
    this.ctx.arc(node.x, node.y, size, 0, Math.PI * 2);
    this.ctx.strokeStyle = isHovered ? '#ec4899' : '#8b5cf6';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // Match Rate Pill
    const pillWidth = 54;
    const pillHeight = 16;
    const pillX = node.x - pillWidth / 2;
    const pillY = node.y + size + 4;

    this.ctx.fillStyle = 'rgba(20, 16, 45, 0.88)';
    this.ctx.strokeStyle = isHovered ? '#f43f5e' : 'rgba(139, 92, 246, 0.5)';
    this.ctx.lineWidth = 1;
    this.roundRect(this.ctx, pillX, pillY, pillWidth, pillHeight, 8, true, true);

    this.ctx.fillStyle = '#fbbf24';
    this.ctx.font = 'bold 9px Tajawal, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(`${node.matchRate}% توافق`, node.x, pillY + pillHeight / 2);

    // User name above
    this.ctx.fillStyle = '#f3f4f6';
    this.ctx.font = 'bold 10px Tajawal, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(node.user.name.split(' ')[0], node.x, node.y - size - 6);
  }

  roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  destroy() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
  }
}

window.SoulPlanetRadar = SoulPlanetRadar;
