/* شراء VIP: نافذة الباقات (تُفتح بالضغط على بطاقة VIP في ملفك الشخصي) */
(function () {
  'use strict';

  function me() {
    try { return JSON.parse(localStorage.getItem('soulchill_user') || 'null'); } catch (e) { return null; }
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
          <div class="vip-plan-info"><b>${esc(p.name)}</b><small>${p.duration_days} يوم</small></div>
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
