/* ═══════════════════════════════════════════════════════════════════════════
   SoulChill — النظام المتكامل للمستويات، السحر، رتب النبلاء، الغرف، والعائلات
   يوفر window.SoulVip (توافق كامل) و window.SoulLevels
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  const NOBLE_TITLES = {
    1: 'الفيكونت',
    2: 'الكونت',
    3: 'الماركيز',
    4: 'الدوق',
    5: 'الأمير',
    6: 'الملك',
    7: 'السلطان'
  };

  function appRef() { return window.SoulChillApp || null; }

  function me() {
    const a = appRef();
    if (a && a.state && a.state.currentUser) return a.state.currentUser;
    try { return JSON.parse(sessionStorage.getItem('soulchill_user') || 'null'); } catch (e) { return null; }
  }

  function syncMe(u) {
    if (!u) return;
    const a = appRef();
    if (a && a.state) {
      a.state.currentUser = Object.assign(a.state.currentUser || {}, u);
      try { sessionStorage.setItem('soulchill_user', JSON.stringify(a.state.currentUser)); } catch (e) {}
      try { if (a.updateHeaderUI) a.updateHeaderUI(); } catch (e) {}
    } else {
      try { sessionStorage.setItem('soulchill_user', JSON.stringify(u)); } catch (e) {}
    }
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
  function toast(msg) {
    const a = appRef();
    if (a && a.showToast) return a.showToast(msg);
    const old = document.querySelector('.soul-toast'); if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'soul-toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString('ar', { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return ''; }
  }

  // ───── دوال مساعدة للشارات وتلوين الأسماء والأرقام الرومانية ─────
  function romanForLevel(lv) {
    const n = Math.floor(Number(lv) || 1);
    if (n <= 50) return '';
    return ROMAN[Math.min(10, n - 50)] || 'X';
  }
  function wealthText(lv) {
    const r = romanForLevel(lv);
    return r ? `الملكي ${r}` : `Lv.${Math.max(1, Math.floor(Number(lv) || 1))}`;
  }
  function charmText(lv) {
    const r = romanForLevel(lv);
    return r ? `سحر ${r}` : `Lv.${Math.max(1, Math.floor(Number(lv) || 1))}`;
  }
  function wealthNameClass(lv) {
    const n = Math.max(1, Math.floor(Number(lv) || 1));
    if (n >= 51) return 'wealth-name-royal';
    if (n >= 31) return 'wealth-name-gold';
    if (n >= 21) return 'wealth-name-silver';
    if (n >= 11) return 'wealth-name-mid';
    return 'wealth-name-beginner';
  }
  function wealthBadgeHtml(lv) {
    const n = Math.max(1, Math.floor(Number(lv) || 1));
    const cls = n >= 51 ? 'wealth-royal' : (n >= 31 ? 'wealth-gold' : (n >= 11 ? 'wealth-mid' : 'wealth-beginner'));
    const ic = n >= 51 ? '👑' : (n >= 31 ? '🏆' : '💎');
    return `<span class="sc-inline-badge ${cls}">${ic} ${esc(wealthText(n))}</span>`;
  }
  function charmBadgeHtml(lv) {
    const n = Math.max(1, Math.floor(Number(lv) || 1));
    const cls = n >= 51 ? 'charm-tier-royal' : (n >= 31 ? 'charm-tier-magenta' : (n >= 16 ? 'charm-tier-purple' : 'charm-tier-pink'));
    const ic = n >= 51 ? '✨' : (n >= 31 ? '💖' : (n >= 16 ? '💜' : '🌸'));
    return `<span class="sc-inline-badge ${cls}">${ic} ${esc(charmText(n))}</span>`;
  }
  function nobleTitle(vipLv) {
    const n = Math.floor(Number(vipLv) || 0);
    return NOBLE_TITLES[n] || (n > 0 ? `VIP ${n}` : '');
  }
  function nobleBadgeHtml(vipLv) {
    const n = Math.floor(Number(vipLv) || 0);
    if (n <= 0) return '';
    return `<span class="sc-inline-badge noble-tag">👑 ${esc(nobleTitle(n))}</span>`;
  }

  function triggerScreenQuake(containerEl) {
    const target = containerEl || document.querySelector('.live-room-container') || document.getElementById('main-app-container');
    if (!target) return;
    target.classList.remove('royal-screen-quake');
    void target.offsetWidth;
    target.classList.add('royal-screen-quake');
    setTimeout(() => target.classList.remove('royal-screen-quake'), 1700);
  }

  function previewMedia(url, title) {
    const a = appRef();
    if (a && a.previewMedia) return a.previewMedia(url, title);
    const old = document.getElementById('slv-prev-modal');
    if (old) old.remove();
    const m = document.createElement('div');
    m.id = 'slv-prev-modal';
    m.className = 'vip-backdrop';
    m.style.alignItems = 'center';
    m.innerHTML = `<div class="vip-sheet" style="max-width:360px;text-align:center;border-radius:20px;">
      <div class="vip-head"><button type="button" class="vip-close" data-x>✕</button><h3>✨ ${esc(title || 'معاينة')}</h3></div>
      <img src="${esc(url)}" style="max-width:100%;max-height:240px;border-radius:14px;margin:8px auto;display:block;" alt="" />
      <p style="font-size:12px;color:rgba(255,255,255,.7);margin:8px 0 0">يظهر هذا التأثير تلقائياً للجميع لحظة دخولك أي غرفة صوتية</p>
    </div>`;
    m.onclick = () => m.remove();
    document.body.appendChild(m);
  }

  function makePage(id, title, bodyHtml) {
    const a = appRef();
    if (a && a.openSubPage) {
      const el = a.openSubPage({ id, title, body: `<div class="slv-wrap">${bodyHtml}</div>` });
      if (document.getElementById('live-voice-room-modal')) el.style.zIndex = '1260';
      return el;
    }
    const old = document.getElementById(id); if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.id = id;
    wrap.className = 'vip-backdrop';
    wrap.innerHTML = `<div class="vip-sheet" style="max-height:92vh"><div class="vip-head"><button class="vip-close" data-close>✕</button><h3>${esc(title)}</h3></div><div class="slv-wrap">${bodyHtml}</div></div>`;
    wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-close]')) wrap.remove(); });
    document.body.appendChild(wrap);
    return wrap;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1) نافذة رتب النبلاء السريعة (SoulVip.open) + الصفحة الكاملة (openAristocracyPage)
  // ═══════════════════════════════════════════════════════════════════════
  async function openVipQuickSheet() {
    const user = me();
    if (!user) return toast('سجّل الدخول أولاً');
    if (document.getElementById('vip-sheet')) return;

    const wrap = document.createElement('div');
    wrap.id = 'vip-sheet';
    wrap.className = 'vip-backdrop';
    wrap.innerHTML = `
      <div class="vip-sheet" role="dialog" aria-label="رتب النبلاء والأرستقراطية">
        <div class="vip-head">
          <button type="button" class="vip-close" data-close aria-label="إغلاق">✕</button>
          <h3>👑 رتب النبلاء والأرستقراطية</h3>
        </div>
        <div class="vip-status" id="vip-status">جاري التحميل...</div>
        <div id="vip-privacy-box"></div>
        <div class="vip-plans" id="vip-plans"></div>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });

    const headers = { 'x-user-id': user.id, 'Content-Type': 'application/json' };
    const paint = (data) => {
      const cur = data.current || { level: 0 };
      const st = wrap.querySelector('#vip-status');
      st.innerHTML = cur.level > 0
        ? `<div><b>${esc(cur.rank_title || ('VIP' + cur.level))}</b><br><small>فعّال حتى ${esc(fmtDate(cur.until))} · متبقي ${cur.days_left} يوم</small></div>`
        : '<div><b>بدون رتبة حالياً</b><br><small>تدرّج من الكونت (Viscount) حتى السلطان (Sultan)</small></div>';
      st.innerHTML += `<span class="vip-bal">💎 ${fmt(data.diamonds)}</span>`;

      const privBox = wrap.querySelector('#vip-privacy-box');
      if (cur.level > 0) {
        privBox.innerHTML = `
          <div class="slv-switch-row">
            <div><b>🛡️ منع تتبع المكان والزيارات</b><small>متاح من رتبة الماركيز (VIP 3) فأعلى</small></div>
            <button type="button" class="slv-btn ${cur.vip_anti_track ? '' : 'secondary'}" id="btn-toggle-antitrack">${cur.vip_anti_track ? 'مفعّل ✓' : 'تفعيل'}</button>
          </div>
          <div class="slv-switch-row">
            <div><b>🕵️ إخفاء وجودي في الغرف</b><small>دخول صامت بدون شريط دخول — من الدوق (VIP 4)+</small></div>
            <button type="button" class="slv-btn ${cur.vip_stealth ? '' : 'secondary'}" id="btn-toggle-stealth">${cur.vip_stealth ? 'مفعّل ✓' : 'تفعيل'}</button>
          </div>`;
        privBox.querySelector('#btn-toggle-antitrack').onclick = async () => {
          const r = await fetch('/api/vip/privacy', { method: 'POST', headers, body: JSON.stringify({ vip_anti_track: !cur.vip_anti_track }) });
          const d = await r.json();
          if (!r.ok) return toast(d.error || 'تعذر التحديث');
          toast(d.vip_anti_track ? '🛡️ تم تفعيل منع التتبع' : 'تم إيقاف منع التتبع');
          load();
        };
        privBox.querySelector('#btn-toggle-stealth').onclick = async () => {
          const r = await fetch('/api/vip/privacy', { method: 'POST', headers, body: JSON.stringify({ vip_stealth: !cur.vip_stealth }) });
          const d = await r.json();
          if (!r.ok) return toast(d.error || 'تعذر التحديث');
          toast(d.vip_stealth ? '🕵️ تم تفعيل إخفاء التواجد في الغرف' : 'تم إظهار تواجدك في الغرف');
          load();
        };
      } else {
        privBox.innerHTML = '';
      }

      wrap.querySelector('#vip-plans').innerHTML = (data.plans || []).map(p => {
        const lower = cur.level > p.level;
        const label = cur.level === p.level ? 'تجديد' : (cur.level > 0 ? 'ترقية' : 'تفعيل');
        const giftsTxt = (p.free_gifts || []).map(g => `${g.qty}× ${g.name}`).join(' + ');
        return `<div class="vip-plan${cur.level === p.level ? ' on' : ''}">
          <div class="vip-plan-top">
            <div class="vip-plan-info">
              <b>${esc(p.icon || '👑')} ${esc(p.name)}</b>
              <small>${p.duration_days} يوم · مكافأة فورية +${fmt(p.bonus_coins || 0)} 🪙${giftsTxt ? ` + ${esc(giftsTxt)}` : ''}</small>
            </div>
            <button type="button" class="vip-buy" data-level="${p.level}" ${lower ? 'disabled' : ''}>${lower ? 'أقل من رتبتك' : `${label} · 💎 ${fmt(p.price_diamonds)}`}</button>
          </div>
          <div class="vip-plan-perks">
            ${(p.perks || []).map(pk => `<span>✦ ${esc(pk)}</span>`).join('')}
            ${p.mount_url ? `<span style="cursor:pointer;color:#fde68a" data-prev="${esc(p.mount_url)}" data-prevname="${esc(p.mount_name)}">🐎 معاينة: ${esc(p.mount_name)} ▶</span>` : ''}
          </div>
        </div>`;
      }).join('') || '<p class="vip-empty">لا توجد باقات متاحة حالياً</p>';
    };

    const load = async () => {
      try {
        const r = await fetch('/api/vip/plans', { headers });
        paint(await r.json());
      } catch (e) { wrap.querySelector('#vip-status').textContent = 'تعذر تحميل رتب النبلاء'; }
    };

    wrap.querySelector('#vip-plans').addEventListener('click', async (e) => {
      const prev = e.target.closest('[data-prev]');
      if (prev) return previewMedia(prev.dataset.prev, prev.dataset.prevname);
      const btn = e.target.closest('.vip-buy');
      if (!btn || btn.disabled) return;
      const level = Number(btn.dataset.level);
      if (window.uiConfirm && !(await window.uiConfirm('تأكيد تفعيل رتبة النبلاء واستلام الهدايا والعملات الفورية؟', { okText: 'تفعيل الآن' }))) return;
      btn.disabled = true;
      try {
        const r = await fetch('/api/vip/buy', { method: 'POST', headers, body: JSON.stringify({ level }) });
        const d = await r.json();
        if (!r.ok) {
          toast(d.error || 'تعذر إتمام الشراء');
        } else {
          if (d.user) syncMe(d.user);
          toast(`👑 مبروك رتبة ${d.vip.rank_title}! استلمت +${fmt(d.vip.bonus_coins)} عملة وحزم هدايا مجانية 🎁`);
        }
      } catch (err) { toast('تعذر الاتصال بالخادم'); }
      load();
    });
    load();
  }

  // الصفحة الكاملة لطبقة النبلاء والأرستقراطية (تُفتح من الملف الشخصي)
  function openAristocracyPage() {
    openLevelCenter(null, 'noble');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2) مركز المستويات والمكافآت الشامل (الثراء · السحر · النبلاء · حقيبتي)
  // ═══════════════════════════════════════════════════════════════════════
  async function openLevelCenter(targetUser, initialTab) {
    const curUser = me();
    if (!curUser) return toast('سجّل الدخول أولاً');
    let tab = ['wealth', 'charm', 'noble', 'bag'].includes(initialTab) ? initialTab : 'wealth';
    const viewUserId = (targetUser && targetUser.id) ? targetUser.id : curUser.id;
    const isSelf = viewUserId === curUser.id;
    const headers = { 'x-user-id': curUser.id, 'Content-Type': 'application/json' };

    const el = makePage('pf-level-page', '🏅 نظام المستويات والرتب والهدايا', '<div id="slv-root">جاري التحميل...</div>');
    const root = el.querySelector('#slv-root');

    async function loadAndRender() {
      try {
        const [ovRes, vipRes] = await Promise.all([
          fetch('/api/levels/overview?user_id=' + encodeURIComponent(viewUserId), { headers: isSelf ? headers : {} }),
          fetch('/api/vip/plans', { headers })
        ]);
        const ov = await ovRes.json();
        const vipData = await vipRes.json();
        if (!el.isConnected) return;
        render(ov, vipData);
      } catch (e) {
        if (root) root.innerHTML = '<p style="text-align:center;opacity:.7">تعذر تحميل بيانات المستويات</p>';
      }
    }

    function render(ov, vipData) {
      const u = ov.user || curUser;
      const cards = ov.cards || { wealth: { level: 1 }, popularity: { level: 1 }, vip: { level: 0 } };
      const bagCount = (ov.free_gifts || []).reduce((s, g) => s + (Number(g.quantity) || 0), 0);
      const avSrc = u.avatar || '/avatars/avatar-1.png';
      const frameCls = u.avatar_frame ? `avatar-frame-${esc(u.avatar_frame)}` : '';

      let contentHtml = '';
      if (tab === 'wealth') {
        const w = cards.wealth;
        contentHtml = `
          <div class="slv-hero">
            <div class="slv-hero-row">
              <img class="slv-hero-av ${frameCls}" src="${esc(avSrc)}" onerror="this.src='/avatars/avatar-1.png'" alt="" />
              <div>
                <div class="slv-hero-title">${wealthBadgeHtml(w.level)} <span>${esc(w.tier && w.tier.name)}</span></div>
                <div class="slv-hero-sub">نقاط الثراء الحالية: <b>${fmt(w.points)}</b> ${u.xp_boost_active ? '· <span class="slv-tag ok">⚡ 2x XP مفعّل</span>' : ''}</div>
              </div>
            </div>
            <div class="slv-bar"><i style="width:${w.progress || 5}%"></i></div>
            <div class="slv-meta-row">
              <span>الحالي: ${esc(w.badge_text)}</span>
              <span>${w.next === null ? '👑 بلغت القمة الملكية القصوى!' : `يتبقى ${fmt(w.remaining)} نقطة للمستوى التالي`}</span>
            </div>
          </div>

          <div class="slv-sec-title"><span>🎁 هدايا ومكافآت مستويات الثراء</span><small>استلم العملات والبلورات والهدايا المجانية</small></div>
          <div class="slv-card-list">
            ${(ov.wealth.milestones || []).map(m => `
              <div class="slv-card ${m.unlocked ? 'unlocked' : ''}">
                <div class="slv-card-head">
                  <b>${m.level >= 51 ? '👑 ' + wealthText(m.level) : '💎 Lv.' + m.level} — ${esc(m.title)}</b>
                  <span class="slv-tag ${m.claimed ? 'ok' : (m.unlocked ? 'gold' : '')}">${m.claimed ? 'تم الاستلام ✓' : (m.unlocked ? 'جاهز للاستلام 🎁' : `يُفتح عند Lv.${m.level}`)}</span>
                </div>
                <div style="font-size:12px;color:#fde68a;margin-bottom:4px">
                  المكافأة: +${fmt(m.coins)} 🪙 ${m.diamonds ? `· +${fmt(m.diamonds)} 💎 ` : ''}· ${m.gift_qty}× ${esc(m.gift_name)}
                </div>
                <div style="font-size:11.5px;color:rgba(255,255,255,.78)">الميزة المفتوحة: ${esc(m.unlock)}</div>
                ${isSelf ? `<div class="slv-card-actions">
                  ${m.unlocked && !m.claimed ? `<button type="button" class="slv-btn" data-claim-track="wealth" data-claim-lv="${m.level}">🎁 استلام المكافأة والهدايا</button>` : ''}
                  ${m.unlocked && m.frame_id ? `<button type="button" class="slv-btn secondary" data-equip-frame="${esc(m.frame_id)}">${u.avatar_frame === m.frame_id ? '✓ الإطار مفعّل' : '🖼️ تفعيل الإطار'}</button>` : ''}
                </div>` : ''}
              </div>
            `).join('')}
          </div>

          <div class="slv-sec-title"><span>📜 مسارات ومزايا مستويات الثراء الكاملة</span></div>
          <div class="slv-card-list">
            ${(ov.wealth.tiers || []).map(t => {
              const on = w.level >= t.min;
              return `<div class="slv-card ${on ? 'unlocked' : ''}">
                <div class="slv-card-head">
                  <b>${esc(t.badge_icon)} ${esc(t.name)}</b>
                  <span class="slv-tag ${on ? 'ok' : ''}" dir="ltr">${esc(t.range_label)}</span>
                </div>
                <ul class="slv-perks-ul">${(t.perks || []).map(p => `<li>${esc(p)}</li>`).join('')}</ul>
                <div class="slv-card-actions">
                  ${isSelf && on && t.frame_id ? `<button type="button" class="slv-btn secondary" data-equip-frame="${esc(t.frame_id)}">${u.avatar_frame === t.frame_id ? '✓ الإطار مفعّل' : '🖼️ تفعيل ' + esc(t.frame_name)}</button>` : ''}
                  ${t.entry_effect_url ? `<button type="button" class="slv-btn secondary" data-prev="${esc(t.entry_effect_url)}" data-prevname="${esc(t.entry_effect_name)}">▶ معاينة: ${esc(t.entry_effect_name)}</button>` : ''}
                </div>
              </div>`;
            }).join('')}
          </div>`;
      } else if (tab === 'charm') {
        const c = cards.popularity;
        contentHtml = `
          <div class="slv-hero charm">
            <div class="slv-hero-row">
              <img class="slv-hero-av ${frameCls}" src="${esc(avSrc)}" onerror="this.src='/avatars/avatar-1.png'" alt="" />
              <div>
                <div class="slv-hero-title">${charmBadgeHtml(c.level)} <span>${esc(c.tier && c.tier.name)}</span></div>
                <div class="slv-hero-sub">نقاط الجاذبية من الهدايا المستلمة: <b>${fmt(c.points)}</b> · تعزيز الظهور: <b style="color:#f472b6">+${c.exposure_boost_pct}%</b></div>
              </div>
            </div>
            <div class="slv-bar"><i style="width:${c.progress || 5}%"></i></div>
            <div class="slv-meta-row">
              <span>الحالي: ${esc(c.badge_text)}</span>
              <span>${c.next === null ? '✨ بلغت قمة الجاذبية الملكية!' : `يتبقى ${fmt(c.remaining)} نقطة للمستوى التالي`}</span>
            </div>
          </div>

          <div class="slv-sec-title"><span>🎀 صناديق ومكافآت مستويات السحر / الجاذبية</span></div>
          <div class="slv-card-list">
            ${(ov.charm.milestones || []).map(m => `
              <div class="slv-card ${m.unlocked ? 'unlocked' : ''}">
                <div class="slv-card-head">
                  <b>${m.level >= 51 ? '✨ ' + charmText(m.level) : '🌸 Lv.' + m.level} — ${esc(m.title)}</b>
                  <span class="slv-tag ${m.claimed ? 'ok' : (m.unlocked ? 'gold' : '')}">${m.claimed ? 'تم الاستلام ✓' : (m.unlocked ? 'جاهز للاستلام 🎁' : `يُفتح عند Lv.${m.level}`)}</span>
                </div>
                <div style="font-size:12px;color:#fbcfe8;margin-bottom:4px">
                  المكافأة: +${fmt(m.coins)} 🪙 ${m.diamonds ? `· +${fmt(m.diamonds)} 💎 ` : ''}· ${m.gift_qty}× ${esc(m.gift_name)}
                </div>
                <div style="font-size:11.5px;color:rgba(255,255,255,.78)">الميزة المفتوحة: ${esc(m.unlock)}</div>
                ${isSelf && m.unlocked && !m.claimed ? `<div class="slv-card-actions">
                  <button type="button" class="slv-btn pink" data-claim-track="charm" data-claim-lv="${m.level}">🎁 استلام صندوق المكافأة</button>
                </div>` : ''}
              </div>
            `).join('')}
          </div>

          <div class="slv-sec-title"><span>💜 مراحل الجاذبية وتعزيز الظهور وهدايا الـ VIP</span></div>
          <div class="slv-card-list">
            ${(ov.charm.tiers || []).map(t => {
              const on = c.level >= t.min;
              return `<div class="slv-card ${on ? 'unlocked' : ''}">
                <div class="slv-card-head">
                  <b>${esc(t.badge_icon)} ${esc(t.name)}</b>
                  <span class="slv-tag ${on ? 'ok' : ''}" dir="ltr">${esc(t.range_label)}</span>
                </div>
                <ul class="slv-perks-ul">${(t.perks || []).map(p => `<li>${esc(p)}</li>`).join('')}</ul>
              </div>`;
            }).join('')}
          </div>`;
      } else if (tab === 'noble') {
        const cur = (vipData && vipData.current) || { level: 0 };
        contentHtml = `
          <div class="slv-hero noble">
            <div class="slv-hero-row">
              <img class="slv-hero-av ${frameCls}" src="${esc(avSrc)}" onerror="this.src='/avatars/avatar-1.png'" alt="" />
              <div>
                <div class="slv-hero-title">👑 ${cur.level > 0 ? esc(cur.rank_title) : 'طبقة النبلاء والأرستقراطية'}</div>
                <div class="slv-hero-sub">${cur.level > 0 ? `فعّالة لمدة ${cur.days_left} يوم متبقٍ · رصيدك: 💎 ${fmt(vipData.diamonds)}` : `تدرّج من الكونت (Viscount) حتى السلطان (Sultan) · رصيدك: 💎 ${fmt(vipData.diamonds)}`}</div>
              </div>
            </div>
            ${cur.level > 0 ? `
              <div class="slv-switch-row">
                <div><b>🛡️ منع تتبع المكان والزيارات</b><small>لا يظهر اسمك في زوار البروفايل (الماركيز+)</small></div>
                <button type="button" class="slv-btn ${cur.vip_anti_track ? '' : 'secondary'}" id="slv-noble-antitrack">${cur.vip_anti_track ? 'مفعّل ✓' : 'تفعيل'}</button>
              </div>
              <div class="slv-switch-row" style="margin-bottom:0">
                <div><b>🕵️ إخفاء وجودي في الغرف</b><small>دخول الغرف بصمت تام (الدوق+)</small></div>
                <button type="button" class="slv-btn ${cur.vip_stealth ? '' : 'secondary'}" id="slv-noble-stealth">${cur.vip_stealth ? 'مفعّل ✓' : 'تفعيل'}</button>
              </div>` : ''}
          </div>
          <div class="slv-sec-title"><span>🏰 الرتب الشهرية المتاحة (30 يوماً + هدايا فورية)</span></div>
          <div class="slv-card-list">
            ${((vipData && vipData.plans) || []).map(p => {
              const lower = cur.level > p.level;
              const label = cur.level === p.level ? 'تجديد الرتبة' : (cur.level > 0 ? 'ترقية الرتبة' : 'تفعيل الرتبة');
              const giftsTxt = (p.free_gifts || []).map(g => `${g.qty}× ${g.name}`).join(' + ');
              return `<div class="slv-card ${cur.level === p.level ? 'unlocked' : ''}">
                <div class="slv-card-head">
                  <b>${esc(p.icon || '👑')} ${esc(p.name)}</b>
                  <span class="slv-tag gold">💎 ${fmt(p.price_diamonds)} / ${p.duration_days} يوم</span>
                </div>
                <div style="font-size:12px;color:#fde68a;margin-bottom:4px">
                  🎁 فور التفعيل: +${fmt(p.bonus_coins || 0)} عملة هدايا ${giftsTxt ? `+ ${esc(giftsTxt)}` : ''}
                </div>
                <ul class="slv-perks-ul">${(p.perks || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
                <div class="slv-card-actions">
                  <button type="button" class="slv-btn" data-buy-noble="${p.level}" ${lower ? 'disabled' : ''}>${lower ? 'رتبتك الحالية أعلى' : `${label} · 💎 ${fmt(p.price_diamonds)}`}</button>
                  ${cur.level >= p.level && p.frame_id ? `<button type="button" class="slv-btn secondary" data-equip-frame="${esc(p.frame_id)}">${u.avatar_frame === p.frame_id ? '✓ الإطار مفعّل' : '🖼️ تفعيل إطار الرتبة'}</button>` : ''}
                  ${p.mount_url ? `<button type="button" class="slv-btn secondary" data-prev="${esc(p.mount_url)}" data-prevname="${esc(p.mount_name)}">🐎 ${esc(p.mount_name)} ▶</button>` : ''}
                </div>
              </div>`;
            }).join('')}
          </div>`;
      } else {
        const bag = ov.free_gifts || [];
        contentHtml = `
          <div class="slv-hero">
            <div class="slv-hero-title">🎒 حقيبة الهدايا المجانية (${bagCount})</div>
            <div class="slv-hero-sub">جميع الهدايا المجانية التي حصلت عليها من ترقية مستويات الثراء والجاذبية وتفعيل رتب النبلاء ومهام العائلة تظهر هنا وفي نافذة إرسال الهدايا لإهدائها مجاناً بدون خصم رصيد!</div>
          </div>
          ${bag.length ? `<div class="slv-bag-grid">${bag.map(g => `
            <div class="slv-bag-item">
              <div class="ic">${g.image_url ? `<img src="${esc(g.image_url)}" style="width:36px;height:36px;object-fit:contain" alt=""/>` : esc(g.icon || '🎁')}</div>
              <b>${esc(g.name)}</b>
              <small>متاح: ×${fmt(g.quantity)} مجاناً</small>
            </div>`).join('')}</div>`
          : '<p style="text-align:center;padding:24px 10px;opacity:.7">لا توجد هدايا مجانية في حقيبتك حالياً — استلم مكافآت مستواك من تبويب الثراء أو الجاذبية أعلاه! 🎁</p>'}`;
      }

      root.innerHTML = `
        <div class="slv-tabs">
          <button type="button" class="slv-tab ${tab === 'wealth' ? 'active' : ''}" data-t="wealth">💎 الثراء</button>
          <button type="button" class="slv-tab ${tab === 'charm' ? 'active' : ''}" data-t="charm">✨ الجاذبية</button>
          <button type="button" class="slv-tab ${tab === 'noble' ? 'active' : ''}" data-t="noble">👑 النبلاء</button>
          <button type="button" class="slv-tab ${tab === 'bag' ? 'active' : ''}" data-t="bag">🎒 حقيبتي (${bagCount})</button>
        </div>
        ${contentHtml}
      `;

      root.querySelectorAll('.slv-tab').forEach(b => {
        b.onclick = () => { tab = b.dataset.t; render(ov, vipData); };
      });
      root.querySelectorAll('[data-prev]').forEach(b => {
        b.onclick = () => previewMedia(b.dataset.prev, b.dataset.prevname);
      });
      root.querySelectorAll('[data-claim-lv]').forEach(b => {
        b.onclick = async () => {
          b.disabled = true;
          try {
            const r = await fetch('/api/levels/claim-reward', {
              method: 'POST', headers,
              body: JSON.stringify({ track: b.dataset.claimTrack, milestone: Number(b.dataset.claimLv) })
            });
            const d = await r.json();
            if (!r.ok) { toast(d.error || 'تعذر الاستلام'); b.disabled = false; return; }
            if (d.user) syncMe(d.user);
            toast(`🎉 استلمت مكافأة ${d.milestone.title} (+${fmt(d.milestone.coins)} 🪙 + ${d.milestone.gift_qty}× ${d.milestone.gift_name})!`);
            loadAndRender();
          } catch (err) { toast('تعذر الاتصال بالخادم'); b.disabled = false; }
        };
      });
      root.querySelectorAll('[data-equip-frame]').forEach(b => {
        b.onclick = async () => {
          b.disabled = true;
          try {
            const r = await fetch('/api/levels/equip-perk', { method: 'POST', headers, body: JSON.stringify({ frame_id: b.dataset.equipFrame }) });
            const d = await r.json();
            if (!r.ok) { toast(d.error || 'تعذر التفعيل'); b.disabled = false; return; }
            if (d.user) syncMe(d.user);
            toast('✨ تم تفعيل الإطار الملكي على حسابك!');
            loadAndRender();
          } catch (err) { toast('تعذر الاتصال بالخادم'); b.disabled = false; }
        };
      });
      root.querySelectorAll('[data-buy-noble]').forEach(b => {
        b.onclick = async () => {
          const level = Number(b.dataset.buyNoble);
          if (window.uiConfirm && !(await window.uiConfirm('تأكيد تفعيل رتبة النبلاء واستلام العملات وحزم الهدايا الفورية؟', { okText: 'تفعيل' }))) return;
          b.disabled = true;
          try {
            const r = await fetch('/api/vip/buy', { method: 'POST', headers, body: JSON.stringify({ level }) });
            const d = await r.json();
            if (!r.ok) { toast(d.error || 'تعذر التفعيل'); b.disabled = false; return; }
            if (d.user) syncMe(d.user);
            toast(`👑 تم تفعيل ${d.vip.rank_title}! استلمت +${fmt(d.vip.bonus_coins)} عملة وهدايا مجانية في حقيبتك 🎁`);
            loadAndRender();
          } catch (err) { toast('تعذر الاتصال بالخادم'); b.disabled = false; }
        };
      });
      const atBtn = root.querySelector('#slv-noble-antitrack');
      if (atBtn) atBtn.onclick = async () => {
        const cur = (vipData && vipData.current) || {};
        const r = await fetch('/api/vip/privacy', { method: 'POST', headers, body: JSON.stringify({ vip_anti_track: !cur.vip_anti_track }) });
        const d = await r.json();
        if (!r.ok) return toast(d.error || 'تعذر التحديث');
        toast(d.vip_anti_track ? '🛡️ تم تفعيل منع التتبع' : 'تم إيقاف منع التتبع');
        loadAndRender();
      };
      const stBtn = root.querySelector('#slv-noble-stealth');
      if (stBtn) stBtn.onclick = async () => {
        const cur = (vipData && vipData.current) || {};
        const r = await fetch('/api/vip/privacy', { method: 'POST', headers, body: JSON.stringify({ vip_stealth: !cur.vip_stealth }) });
        const d = await r.json();
        if (!r.ok) return toast(d.error || 'تعذر التحديث');
        toast(d.vip_stealth ? '🕵️ تم تفعيل إخفاء التواجد في الغرف' : 'تم إظهار تواجدك في الغرف');
        loadAndRender();
      };
    }

    loadAndRender();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3) نظام العائلات والإمبراطوريات ومستوياتها (Family Levels & Daily Rewards)
  // ═══════════════════════════════════════════════════════════════════════
  async function openFamilyPage() {
    const user = me();
    if (!user) return toast('سجّل الدخول أولاً');
    const headers = { 'x-user-id': user.id, 'Content-Type': 'application/json' };
    let tab = 'mine';
    let searchQ = '';

    const el = makePage('pf-empire-page', '🏰 نظام العائلات والإمبراطوريات', '<div id="slv-fam-root">جاري التحميل...</div>');
    const root = el.querySelector('#slv-fam-root');

    async function load() {
      try {
        const r = await fetch('/api/families?q=' + encodeURIComponent(searchQ), { headers });
        const d = await r.json();
        if (!el.isConnected) return;
        if (!d.my_membership && tab === 'mine') tab = 'list';
        paint(d);
      } catch (e) {
        if (root) root.innerHTML = '<p style="text-align:center;opacity:.7">تعذر تحميل العائلات</p>';
      }
    }

    function paint(data) {
      const fams = data.families || [];
      const mem = data.my_membership;
      const myFam = mem ? fams.find(f => f.id === mem.family_id) : null;

      let body = '';
      if (tab === 'mine' && myFam) {
        const li = myFam.level_info;
        body = `
          <div class="slv-hero family">
            <div class="slv-hero-row">
              <div style="width:56px;height:56px;border-radius:16px;display:grid;place-items:center;font-size:28px;background:linear-gradient(135deg,${esc(myFam.color)},#0f172a)">${esc(myFam.badge_emoji)}</div>
              <div>
                <div class="slv-hero-title"><span>${esc(myFam.name)}</span> <span class="slv-tag gold">Lv.${li.level}</span></div>
                <div class="slv-hero-sub">الأعضاء: <b>${myFam.member_count}/${li.member_capacity}</b> · مساهمتك: <b>${fmt(mem.contribution_xp)} XP</b></div>
              </div>
            </div>
            <div class="slv-bar"><i style="width:${li.progress}%"></i></div>
            <div class="slv-meta-row">
              <span>نقاط خبرة العائلة: ${fmt(li.xp)}</span>
              <span>${li.next === null ? 'أعلى مستوى عائلة!' : `يتبقى ${fmt(li.remaining)} XP لزيادة السعة والمكافآت`}</span>
            </div>
          </div>

          <div class="slv-card unlocked">
            <div class="slv-card-head">
              <b>🎁 مكافأة المهام اليومية لأعضاء العائلة</b>
              <span class="slv-tag ${mem.daily_claimed ? 'ok' : 'gold'}">${mem.daily_claimed ? 'استُلمت اليوم ✓' : 'متاحة الآن'}</span>
            </div>
            <p style="margin:4px 0 8px;font-size:12px;color:rgba(255,255,255,.82)">
              تشمل: كيس حظ العائلة (+${fmt(li.daily_coins)} 🪙 و +${fmt(li.daily_diamonds)} 💎) + حزمة خبرة فورية (+${fmt(li.daily_xp_pack)} XP) + <b>مضاعف خبرة 2x XP لمدة ساعة كاملة</b> + هديتان مجانيتان في حقيبتك!
            </p>
            <div class="slv-card-actions">
              <button type="button" class="slv-btn" id="btn-claim-fam-daily" ${mem.daily_claimed ? 'disabled' : ''}>${mem.daily_claimed ? 'تم الاستلام اليوم ✓' : '🎁 استلام كيس الحظ وحزمة 2x XP'}</button>
              <button type="button" class="slv-btn secondary" id="btn-leave-fam">مغادرة العائلة</button>
            </div>
          </div>

          <div class="slv-sec-title"><span>👥 أكثر أعضاء العائلة تفاعلاً</span></div>
          <div class="slv-card-list">
            ${(mem.members || []).map((m, idx) => `
              <div class="slv-card" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
                <div style="display:flex;align-items:center;gap:9px">
                  <b>#${idx + 1}</b>
                  <img src="${esc(m.avatar || '/avatars/avatar-1.png')}" style="width:36px;height:36px;border-radius:50%;object-fit:cover" onerror="this.src='/avatars/avatar-1.png'" alt="" />
                  <div><b style="font-size:13px">${esc(m.name)}</b><br><small style="opacity:.7">${m.role === 'leader' ? '👑 قائد العائلة' : 'عضو متفاعل'}</small></div>
                </div>
                <span class="slv-tag gold">${fmt(m.contribution_xp)} XP</span>
              </div>
            `).join('')}
          </div>`;
      } else if (tab === 'create') {
        body = `
          <div class="slv-card unlocked">
            <div class="slv-card-head"><b>🏠 تأسيس عائلة / إمبراطورية جديدة</b></div>
            <div class="slv-form">
              <input id="fam-new-name" maxlength="32" placeholder="اسم العائلة (مثال: ملوك السهر)" />
              <input id="fam-new-emoji" maxlength="4" value="🦅" placeholder="شعار العائلة (إيموجي)" />
              <input id="fam-new-slogan" maxlength="80" placeholder="شعار ترحيبي للأعضاء..." />
              <button type="button" class="slv-btn" id="btn-submit-new-fam">✨ إنشاء العائلة الآن</button>
            </div>
          </div>`;
      } else {
        body = `
          <div class="slv-form" style="margin-bottom:12px">
            <input id="fam-search-in" value="${esc(searchQ)}" placeholder="ابحث عن اسم العائلة أو الـ ID..." />
          </div>
          <div class="slv-card-list">
            ${fams.map(f => `
              <div class="slv-card ${f.is_member ? 'unlocked' : ''}">
                <div class="slv-card-head">
                  <div style="display:flex;align-items:center;gap:8px">
                    <span style="font-size:22px">${esc(f.badge_emoji)}</span>
                    <div><b>#${f.rank} ${esc(f.name)}</b><br><small style="opacity:.7">${esc(f.slogan || '')}</small></div>
                  </div>
                  <span class="slv-tag gold">Lv.${f.level} · 👤 ${f.member_count}/${f.capacity}</span>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
                  <small style="color:#bae6fd">🔥 القوة: ${fmt(f.power_score)} · مكافأة يومية +${fmt(f.level_info.daily_diamonds)} 💎</small>
                  ${f.is_member
                    ? '<span class="slv-tag ok">عائلتك ✓</span>'
                    : `<button type="button" class="slv-btn" data-join-fam="${esc(f.id)}">انضمام</button>`}
                </div>
              </div>
            `).join('') || '<p style="text-align:center;opacity:.65">لا توجد عائلات مطابقة</p>'}
          </div>`;
      }

      root.innerHTML = `
        <div class="slv-tabs">
          ${myFam ? `<button type="button" class="slv-tab ${tab === 'mine' ? 'active' : ''}" data-ft="mine">🏰 عائلتي</button>` : ''}
          <button type="button" class="slv-tab ${tab === 'list' ? 'active' : ''}" data-ft="list">🏆 ترتيب العائلات</button>
          ${!myFam ? `<button type="button" class="slv-tab ${tab === 'create' ? 'active' : ''}" data-ft="create">➕ إنشاء عائلة</button>` : ''}
        </div>
        ${body}`;

      root.querySelectorAll('[data-ft]').forEach(b => { b.onclick = () => { tab = b.dataset.ft; paint(data); }; });
      const sIn = root.querySelector('#fam-search-in');
      if (sIn) sIn.onchange = () => { searchQ = sIn.value.trim(); load(); };
      root.querySelectorAll('[data-join-fam]').forEach(b => {
        b.onclick = async () => {
          b.disabled = true;
          const r = await fetch(`/api/families/${encodeURIComponent(b.dataset.joinFam)}/join`, { method: 'POST', headers, body: '{}' });
          const d = await r.json();
          if (!r.ok) { toast(d.error || 'تعذر الانضمام'); b.disabled = false; return; }
          toast('🎉 انضممت للعائلة بنجاح!');
          tab = 'mine';
          load();
        };
      });
      const claimBtn = root.querySelector('#btn-claim-fam-daily');
      if (claimBtn && myFam) claimBtn.onclick = async () => {
        claimBtn.disabled = true;
        const r = await fetch(`/api/families/${encodeURIComponent(myFam.id)}/claim-daily`, { method: 'POST', headers, body: '{}' });
        const d = await r.json();
        if (!r.ok) { toast(d.error || 'تعذر الاستلام'); claimBtn.disabled = false; return; }
        if (d.user) syncMe(d.user);
        toast(`🎁 استلمت +${fmt(d.coins_awarded)} 🪙 و +${fmt(d.diamonds_awarded)} 💎 ومضاعف خبرة 2x XP لمدة ساعة!`);
        load();
      };
      const leaveBtn = root.querySelector('#btn-leave-fam');
      if (leaveBtn) leaveBtn.onclick = async () => {
        if (window.uiConfirm && !(await window.uiConfirm('هل تريد مغادرة عائلتك الحالية؟', { danger: true, okText: 'مغادرة' }))) return;
        const r = await fetch('/api/families/leave', { method: 'POST', headers, body: '{}' });
        const d = await r.json();
        if (!r.ok) return toast(d.error || 'تعذر المغادرة');
        toast('غادرت العائلة');
        tab = 'list';
        load();
      };
      const createBtn = root.querySelector('#btn-submit-new-fam');
      if (createBtn) createBtn.onclick = async () => {
        const name = (root.querySelector('#fam-new-name').value || '').trim();
        const badge_emoji = (root.querySelector('#fam-new-emoji').value || '🦅').trim();
        const slogan = (root.querySelector('#fam-new-slogan').value || '').trim();
        createBtn.disabled = true;
        const r = await fetch('/api/families', { method: 'POST', headers, body: JSON.stringify({ name, badge_emoji, slogan }) });
        const d = await r.json();
        if (!r.ok) { toast(d.error || 'تعذر الإنشاء'); createBtn.disabled = false; return; }
        toast('🏰 مبروك! تم تأسيس عائلتك بنجاح');
        tab = 'mine';
        load();
      };
    }

    load();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4) نافذة مستوى الغرفة وسعة المقاعد ومكافآت المهام اليومية (Lucky Bag + 2x XP)
  // ═══════════════════════════════════════════════════════════════════════
  async function openRoomLevelModal(roomId) {
    const user = me();
    if (!user || !roomId) return;
    const old = document.getElementById('room-lv-sheet'); if (old) old.remove();
    const headers = { 'x-user-id': user.id, 'Content-Type': 'application/json' };

    const wrap = document.createElement('div');
    wrap.id = 'room-lv-sheet';
    wrap.className = 'vip-backdrop';
    wrap.innerHTML = `<div class="vip-sheet"><div class="vip-head"><button class="vip-close" data-close>✕</button><h3>🏠 مستوى الغرفة ومهامها اليومية</h3></div><div id="rm-lv-body">جاري التحميل...</div></div>`;
    wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-close]')) wrap.remove(); });
    document.body.appendChild(wrap);

    const load = async () => {
      try {
        const r = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/level`, { headers });
        const d = await r.json();
        if (!wrap.isConnected) return;
        const li = d.level_info;
        wrap.querySelector('#rm-lv-body').innerHTML = `
          <div class="slv-hero family" style="margin-bottom:12px">
            <div class="slv-hero-title">🏠 ${esc(d.title)} <span class="slv-tag gold">Lv.${li.level}</span> ${d.xp_boost_active ? `<span class="slv-tag ok">⚡ ${li.xp_multiplier}x XP نشط</span>` : ''}</div>
            <div class="slv-hero-sub">🎙️ سعة الميكروفونات المفتوحة: <b>حتى ${li.max_mic_seats} مقعد</b> · 👥 استيعاب الأعضاء: <b>${fmt(d.members_count)}/${fmt(li.member_capacity)}</b></div>
            <div class="slv-hero-sub">🔥 تعزيز الظهور في الاستكشاف: <b style="color:#f472b6">+${d.exposure_boost_pct}%</b></div>
            <div class="slv-bar"><i style="width:${li.progress}%"></i></div>
            <div class="slv-meta-row">
              <span>خبرة الغرفة: ${fmt(li.xp)} XP</span>
              <span>${li.next === null ? 'أعلى مستوى غرفة!' : `متبقي ${fmt(li.remaining)} XP للمستوى التالي`}</span>
            </div>
          </div>
          <div class="slv-card unlocked">
            <div class="slv-card-head">
              <b>💰 مكافأة مهام الغرفة اليومية</b>
              <span class="slv-tag ${d.daily_reward_claimed ? 'ok' : 'gold'}">${d.daily_reward_claimed ? 'أُطلقت اليوم ✓' : 'جاهزة للإطلاق'}</span>
            </div>
            <p style="font-size:12px;color:rgba(255,255,255,.82);margin:4px 0 8px">
              عند تفعيلها من مضيف أو مشرف الغرفة: يُوزَّع فوراً <b>كيس حظ مجاني بقيمة ${fmt(li.daily_lucky_bag_crystals)} 💎</b> في الغرفة للأعضاء المتفاعلين، مع تفعيل <b>مضاعف خبرة ${li.xp_multiplier}x XP لمدة ساعة كاملة</b>!
            </p>
            <button type="button" class="slv-btn" id="btn-claim-room-daily" ${d.daily_reward_claimed ? 'disabled' : ''}>
              ${d.daily_reward_claimed ? 'تم توزيع كيس الحظ اليومي ✓' : `🎁 توزيع كيس حظ (${fmt(li.daily_lucky_bag_crystals)} 💎) + ${li.xp_multiplier}x XP`}
            </button>
          </div>
          <div class="slv-sec-title"><span>📈 جدول سعة المقاعد مع مستوى الغرفة</span></div>
          <div class="slv-card-list">
            <div class="slv-card ${li.level >= 1 ? 'unlocked' : ''}"><b>Lv.1 – Lv.2</b> · 5 مقاعد ميكروفون + سعة 50–75 عضواً</div>
            <div class="slv-card ${li.level >= 3 ? 'unlocked' : ''}"><b>Lv.3 – Lv.5</b> · فتح <b>9 مقاعد ميكروفون</b> مجاناً + كيس حظ أكبر</div>
            <div class="slv-card ${li.level >= 6 ? 'unlocked' : ''}"><b>Lv.6 – Lv.9</b> · فتح <b>12 مقعد ميكروفون</b> مجاناً + استيعاب حتى 250 عضواً</div>
            <div class="slv-card ${li.level >= 10 ? 'unlocked' : ''}"><b>Lv.10 – Lv.20</b> · فتح السعة القصوى <b>15 ميكروفون</b> مجاناً + مضاعف <b>2.5x XP</b>!</div>
          </div>`;
        const btn = wrap.querySelector('#btn-claim-room-daily');
        if (btn) btn.onclick = async () => {
          btn.disabled = true;
          const cr = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/claim-daily`, { method: 'POST', headers, body: '{}' });
          const cd = await cr.json();
          if (!cr.ok) { toast(cd.error || 'تعذر التفعيل'); btn.disabled = false; return; }
          toast('🎉 تم توزيع كيس حظ الغرفة وتفعيل مضاعف 2x XP لجميع المتواجدين!');
          wrap.remove();
        };
      } catch (e) {
        if (wrap.isConnected) wrap.querySelector('#rm-lv-body').textContent = 'تعذر تحميل بيانات الغرفة';
      }
    };
    load();
  }

  window.SoulVip = { open: openVipQuickSheet };
  window.SoulLevels = {
    openLevelCenter,
    openAristocracyPage,
    openFamilyPage,
    openRoomLevelModal,
    wealthText,
    charmText,
    wealthNameClass,
    wealthBadgeHtml,
    charmBadgeHtml,
    nobleTitle,
    nobleBadgeHtml,
    triggerScreenQuake,
    previewMedia
  };
})();
