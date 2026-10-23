/* شراء VIP: نافذة الباقات (تُفتح بالضغط على بطاقة VIP في ملفك الشخصي) */
(function () {
  'use strict';

  function me() {
    try { return JSON.parse(sessionStorage.getItem('soulchill_user') || 'null'); } catch (e) { return null; }
  }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function toast(msg) {
    const old = document.querySelector('.soul-toast'); if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'soul-toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' }); } catch (e) { return ''; }
  }

  async function open() {
    const user = me();
    if (!user) return toast('سجّل الدخول أولاً');
    if (document.getElementById('vip-sheet')) return;

    const wrap = document.createElement('div');
    wrap.id = 'vip-sheet';
    wrap.className = 'vip-backdrop';
    wrap.innerHTML = `
      <div class="vip-sheet" role="dialog" aria-label="اشتراك VIP">
        <div class="vip-head">
          <button type="button" class="vip-close" data-close aria-label="إغلاق">✕</button>
          <h3>👑 اشتراك VIP</h3>
        </div>
        <div class="vip-status" id="vip-status">جاري التحميل...</div>
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
        ? `<b>VIP${cur.level}</b> فعّال حتى ${esc(fmtDate(cur.until))} · متبقي ${cur.days_left} يوم`
        : '<b>VIP0</b> — لا يوجد اشتراك فعّال';
      st.innerHTML += `<span class="vip-bal">💎 ${Number(data.diamonds || 0).toLocaleString('en-US')}</span>`;
      wrap.querySelector('#vip-plans').innerHTML = (data.plans || []).map(p => {
        const lower = cur.level > p.level;
        const label = cur.level === p.level ? 'تجديد' : (cur.level > 0 ? 'ترقية' : 'اشترِ');
        return `<div class="vip-plan${cur.level === p.level ? ' on' : ''}">
          ${window.SoulBadges ? window.SoulBadges.html('vip', p.level, { compact: true }) : ''}<div class="vip-plan-info"><b>${esc(p.name)}</b><small>${p.duration_days} يوم</small></div>
          <button type="button" class="vip-buy" data-level="${p.level}" ${lower ? 'disabled' : ''}>${lower ? 'أقل من اشتراكك' : `${label} · 💎 ${Number(p.price_diamonds).toLocaleString('en-US')}`}</button>
        </div>`;
      }).join('') || '<p class="vip-empty">لا توجد باقات متاحة حالياً</p>';
    };
    const load = async () => {
      try {
        const r = await fetch('/api/vip/plans', { headers });
        paint(await r.json());
      } catch (e) { wrap.querySelector('#vip-status').textContent = 'تعذر تحميل الباقات'; }
    };

    wrap.querySelector('#vip-plans').addEventListener('click', async (e) => {
      const btn = e.target.closest('.vip-buy');
      if (!btn || btn.disabled) return;
      const level = Number(btn.dataset.level);
      if (window.uiConfirm && !(await window.uiConfirm(`تأكيد شراء VIP${level}؟`, { okText: 'شراء' }))) return;
      btn.disabled = true;
      try {
        const r = await fetch('/api/vip/buy', { method: 'POST', headers, body: JSON.stringify({ level }) });
        const d = await r.json();
        if (!r.ok) { toast(d.error || 'تعذر إتمام الشراء'); }
        else { toast(`🎉 تم تفعيل VIP${d.vip.level}`); }
      } catch (err) { toast('تعذر الاتصال بالخادم'); }
      load();
    });
    load();
  }

  window.SoulVip = { open };
})();

/* نافذة مستويات الثروة / الرواج ومكافآت كل مستوى */
(function () {
  'use strict';
  function me() { try { return JSON.parse(sessionStorage.getItem('soulchill_user') || 'null'); } catch (e) { return null; } }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function toast(msg) {
    const old = document.querySelector('.soul-toast'); if (old) old.remove();
    const t = document.createElement('div'); t.className = 'soul-toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
  }
  const NAMES = { wealth: 'الثروة', charm: 'الرواج', general: 'المستوى' };

  async function open(kind) {
    const user = me();
    if (!user) return toast('سجّل الدخول أولاً');
    if (document.getElementById('lvr-sheet')) return;
    kind = (kind === 'charm' || kind === 'general') ? kind : 'wealth';
    const headers = { 'x-user-id': user.id, 'Content-Type': 'application/json' };

    const wrap = document.createElement('div');
    wrap.id = 'lvr-sheet';
    wrap.className = 'vip-backdrop';
    wrap.innerHTML = `
      <div class="vip-sheet lvr-sheet" role="dialog" aria-label="مستويات ومكافآت">
        <div class="vip-head">
          <button type="button" class="vip-close" data-close aria-label="إغلاق">✕</button>
          <h3>🏆 مستويات وهدايا</h3>
        </div>
        <div class="lvr-tabs">
          <button type="button" data-kind="wealth">الثروة</button>
          <button type="button" data-kind="charm">الرواج</button>
          <button type="button" data-kind="general">المستوى</button>
        </div>
        <div class="vip-status" id="lvr-status">جاري التحميل...</div>
        <div class="lvr-bar"><i id="lvr-bar-fill"></i></div>
        <div class="lvr-tiers" id="lvr-tiers"></div>
        <div class="lvr-rules" id="lvr-rules" hidden></div>
        <button type="button" class="vip-buy lvr-claim" id="lvr-claim" hidden>استلم المكافآت المتاحة 🎁</button>
        <div class="vip-plans" id="lvr-list"></div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('[data-close]')) wrap.remove();
      const tab = e.target.closest('.lvr-tabs button');
      if (tab) { kind = tab.dataset.kind; load(); }
    });

    async function load() {
      wrap.querySelectorAll('.lvr-tabs button').forEach(b => b.classList.toggle('on', b.dataset.kind === kind));
      try {
        const r = await fetch('/api/level-rewards?kind=' + kind, { headers });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'خطأ');
        paint(d);
      } catch (e) { wrap.querySelector('#lvr-status').textContent = 'تعذر تحميل المستويات'; }
    }

    function paint(d) {
      const claimed = new Set(d.claimed || []);
      const st = wrap.querySelector('#lvr-status');
      st.innerHTML = `<span><b>${NAMES[kind]} Lv.${d.level}</b> · ${Number(d.points).toLocaleString('en-US')} نقطة</span>` +
        `<span class="vip-bal">${d.next ? 'المتبقي للمستوى التالي: ' + Number(d.remaining).toLocaleString('en-US') : 'أعلى مستوى'}</span>`;
      wrap.querySelector('#lvr-bar-fill').style.width = (d.progress || 0) + '%';
      const SB = window.SoulBadges;
      if (SB) {
        const cur = SB.tier(kind, d.level).key;
        wrap.querySelector('#lvr-tiers').innerHTML = SB.tiers(kind).map(t =>
          `<div class="lvr-tier${t.key === cur ? ' on' : ''}">${SB.iconOnly(kind, t.from)}<b>${esc(t.name)}</b><small>Lv.${t.from}–${t.to}</small></div>`).join('');
      }
      const rules = wrap.querySelector('#lvr-rules');
      if (kind === 'wealth') {
        rules.hidden = false;
        rules.innerHTML = '🛡️ <b>ثروة 21+</b>: كتم الكتابة وطرد الأعضاء الأقل ثروة داخل الغرف.<br>👑 <b>ثروة 26+</b>: حصانة كاملة من الكتم والطرد، وأضواء الذيل لرسائلك.';
      } else { rules.hidden = true; }
      const pending = (d.rewards || []).some(r => r.level <= d.level && !claimed.has(r.level) && (r.diamonds || r.item_id));
      wrap.querySelector('#lvr-claim').hidden = !pending;
      wrap.querySelector('#lvr-list').innerHTML = (d.rewards || []).map(r => {
        const reached = r.level <= d.level;
        const got = claimed.has(r.level);
        const gift = [r.diamonds ? `💎 ${Number(r.diamonds).toLocaleString('en-US')}` : '', r.item_id ? ('🖼️ عنصر حصري' + (r.item_days ? ` (${r.item_days} أيام)` : '')) : ''].filter(Boolean).join(' + ');
        const state = !reached ? '🔒' : (got || !gift ? '✅' : '🎁');
        const sbHtml = window.SoulBadges ? window.SoulBadges.html(kind, r.level, { compact: true }) : '';
        return `<div class="vip-plan lvr-row${reached ? ' on' : ''}">
          ${sbHtml}
          <div class="vip-plan-info"><b>Lv.${r.level}${r.tier_name ? ' · ' + esc(r.tier_name) : ''}</b>
            ${gift ? `<small>${gift}</small>` : ''}
            ${r.perks ? `<small class="lvr-perks">${esc(r.perks)}</small>` : ''}</div>
          <span class="lvr-state">${state}</span>
        </div>`;
      }).join('') || '<p class="vip-empty">لا توجد مكافآت</p>';
    }

    wrap.querySelector('#lvr-claim').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const r = await fetch('/api/level-rewards/claim', { method: 'POST', headers });
        const d = await r.json();
        if (!r.ok) toast(d.error || 'تعذر الاستلام');
        else if (!d.granted.length) toast('لا توجد مكافآت جديدة');
        else toast(`🎉 تم استلام ${d.granted.length} مكافأة`);
      } catch (err) { toast('تعذر الاتصال بالخادم'); }
      e.target.disabled = false;
      load();
    });
    load();
  }
  window.SoulLevels = { open };
})();

/* نافذة المكافآت: تظهر فور الارتقاء بمستوى (ثروة / رواج / عام) وتعرض ما تم منحه وتفعيله */
(function () {
  'use strict';
  const NAMES = { wealth: 'الثروة', charm: 'الرواج', general: 'المستوى' };
  const ICONS = { entry_effect: '🚀', avatar_frame: '🖼️', room_card: '🏠', store_item: '🛍️' };
  const TYPE_NAMES = { entry_effect: 'قالب دخول', avatar_frame: 'إطار أفاتار', room_card: 'بطاقة غرفة', store_item: 'عنصر متجر' };
  const queue = [];
  let showing = false;
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const isImg = (u) => /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(String(u || ''));

  function next() {
    if (showing || !queue.length) return;
    showing = true;
    const rewards = queue.shift();
    // أعلى مستوى وصل إليه في كل نوع
    const top = {};
    rewards.forEach(r => { if (!top[r.kind] || r.level > top[r.kind]) top[r.kind] = r.level; });
    const SB = window.SoulBadges;
    const heads = Object.keys(top).map(k =>
      `<div class="lvu-head">${SB ? SB.html(k, top[k]) : ''}<span>${NAMES[k] || k} → Lv.${top[k]}</span></div>`).join('');
    const totalDia = rewards.reduce((a, r) => a + (Number(r.diamonds) || 0), 0);

    const cards = rewards.map(r => {
      const parts = [];
      if (r.diamonds) parts.push(`<div class="lvu-gift"><span class="lvu-ic">💎</span><div><b>+${Number(r.diamonds).toLocaleString('en-US')} ألماس</b><small>أُضيفت إلى رصيدك</small></div></div>`);
      if (r.item_name) {
        const thumb = isImg(r.item_image) ? `<img src="${esc(r.item_image)}" alt="" onerror="this.replaceWith(document.createTextNode('${ICONS[r.item_type] || '🎁'}'))" />` : (ICONS[r.item_type] || '🎁');
        const dur = r.item_days ? `لمدة ${r.item_days} ${r.item_days === 1 ? 'يوم' : 'أيام'}` : 'دائم';
        parts.push(`<div class="lvu-gift item"><span class="lvu-ic lvu-thumb">${thumb}</span><div><b>${esc(r.item_name)}</b><small>${TYPE_NAMES[r.item_type] || 'عنصر'} · ${dur}${r.item_equipped ? ' · <em>تم تفعيله ✅</em>' : ''}</small></div></div>`);
      }
      if (r.perks) parts.push(`<div class="lvu-perks">✨ ${esc(r.perks)}</div>`);
      if (!parts.length) return '';
      return `<div class="lvu-card"><div class="lvu-lv">${NAMES[r.kind] || ''} Lv.${r.level}${r.tier_name ? ' · ' + esc(r.tier_name) : ''}</div>${parts.join('')}</div>`;
    }).join('');

    const wrap = document.createElement('div');
    wrap.className = 'vip-backdrop lvu-backdrop';
    wrap.innerHTML = `
      <div class="lvu-modal" role="dialog" aria-label="مكافآت الارتقاء">
        <div class="lvu-confetti" aria-hidden="true">${'<i></i>'.repeat(14)}</div>
        <h3>🎉 مبروك الارتقاء!</h3>
        ${heads}
        ${totalDia ? `<div class="lvu-total">إجمالي الألماس: 💎 ${totalDia.toLocaleString('en-US')}</div>` : ''}
        <div class="lvu-list">${cards || '<p class="vip-empty">ارتقيت إلى مستوى جديد!</p>'}</div>
        <button type="button" class="vip-buy lvu-ok">رائع!</button>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => { wrap.remove(); showing = false; next(); };
    wrap.querySelector('.lvu-ok').addEventListener('click', close);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  }

  function show(rewards) {
    if (!Array.isArray(rewards) || !rewards.length) return;
    queue.push(rewards);
    next();
  }
  window.SoulLevels = Object.assign(window.SoulLevels || {}, { showRewards: show });
})();
