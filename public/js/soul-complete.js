/* SoulChill complete layer: shop, VIP, lucky box, avatar, events, roles */
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  let SHOP = null;
  let SHOP_TAB = 'coins';

  function needAuth() {
    if (typeof ME !== 'undefined' && ME) return true;
    if (typeof openLogin === 'function') openLogin();
    return false;
  }

  function toast(msg, ok) {
    if (typeof window.toast === 'function') window.toast(msg, ok !== false);
  }

  async function loadShop() {
    if (typeof api !== 'function') return null;
    SHOP = await api('/api/soul/shop');
    return SHOP;
  }

  function paintShopHead() {
    if (!SHOP) return;
    const b = $('#soulShopBal'); if (b) b.textContent = SHOP.balance || 0;
    const lv = $('#soulShopLv'); if (lv) lv.textContent = SHOP.level || 1;
    const cr = $('#soulShopCredit'); if (cr) cr.textContent = SHOP.credit || 100;
    if (typeof ME !== 'undefined' && ME) ME.balance = SHOP.balance;
    if (typeof soulPaintCoins === 'function') soulPaintCoins();
    const mb = $('#menuBal'); if (mb) mb.textContent = SHOP.balance || 0;
  }

  function payMethodsHtml() {
    return `<div class="soul-pay-row">
      <button type="button" class="soul-pay on" data-pay="paypal">PayPal</button>
      <button type="button" class="soul-pay on" data-pay="card">بطاقة / Stripe</button>
      <button type="button" class="soul-pay dim" data-pay="gp">Google Play</button>
      <button type="button" class="soul-pay dim" data-pay="ap">Apple</button>
    </div>
    <p class="soul-pay-note">على الويب: PayPal أو البطاقة. متاجر Google/Apple تظهر في تطبيق الجوال.</p>`;
  }

  function renderShop() {
    const pane = $('#soulShopPane');
    if (!pane || !SHOP) return;
    paintShopHead();
    $$('#soulShopTabs button').forEach(b => b.classList.toggle('active', b.dataset.stab === SHOP_TAB));
    if (SHOP_TAB === 'coins') {
      const pkgs = SHOP.packages || [];
      pane.innerHTML = payMethodsHtml() + (pkgs.length ? pkgs.map(p => `<button type="button" class="soul-pkg" data-pkg="${p.id}">
        <b>${p.gold} 🪙</b><small>${p.name || ''}</small><em>${p.currency || '$'}${p.price}</em>
      </button>`).join('') : '<div class="soul-empty">لا توجد باقات — افتح شراء الرصيد</div>') +
        '<button type="button" class="soul-primary" id="soulShopOpenBuy">فتح بوابة الدفع</button>';
      $$('#soulShopPane .soul-pkg, #soulShopOpenBuy').forEach(b => b.onclick = () => {
        if (typeof closeOv === 'function') closeOv('soulShopOv');
        if (typeof openBuy === 'function') openBuy();
      });
      $$('#soulShopPane .soul-pay.dim').forEach(b => b.onclick = () => toast('متاح في تطبيق الجوال — استخدم PayPal أو البطاقة هنا', false));
      $$('#soulShopPane .soul-pay.on').forEach(b => b.onclick = () => {
        if (typeof closeOv === 'function') closeOv('soulShopOv');
        if (typeof openBuy === 'function') openBuy();
      });
    } else if (SHOP_TAB === 'vip') {
      pane.innerHTML = `<div class="soul-vip-grid">
        <button type="button" data-plan="plus"><b>PLUS</b><small>إطار واسم مميز</small><em>10 🪙 / شهر</em></button>
        <button type="button" data-plan="premium"><b>PREMIUM</b><small>هدايا ودخول أوضح</small><em>20 🪙 / شهر</em></button>
        <button type="button" data-plan="vip"><b>VIP / SVIP</b><small>شارة · إطار · إخفاء اختياري</small><em>30 🪙 / شهر</em></button>
        <button type="button" data-plan="pass"><b>Soul Pass</b><small>توهج مقعد 30 يوماً</small><em>500 🪙</em></button>
      </div>`;
      $$('#soulShopPane [data-plan]').forEach(b => {
        b.onclick = async () => {
          const plan = b.dataset.plan;
          try {
            if (plan === 'pass') {
              const d = await api('/api/soul/premium', 'POST', {});
              if (typeof ME !== 'undefined' && ME && d.balance != null) ME.balance = d.balance;
              toast('تم تفعيل Soul Pass ✨');
            } else {
              await api('/api/upgrade', 'POST', { target_id: ME.id, plan, months: 1 });
              toast('تم تفعيل ' + plan.toUpperCase());
            }
            await loadShop();
            renderShop();
          } catch (e) {
            toast((e && e.error) || 'تعذر الاشتراك', false);
          }
        };
      });
    } else if (SHOP_TAB === 'lucky') {
      pane.innerHTML = `<div class="soul-lucky-hero">
        <div class="soul-lucky-box big">🎁</div>
        <p>افتح صندوق الحظ مقابل <b>80 🪙</b><br>ذهب، إكسسوارات، أو Soul Pass ليوم</p>
        <button class="soul-primary" type="button" id="soulShopLucky">افتح الآن</button>
      </div>`;
      const go = $('#soulShopLucky');
      if (go) go.onclick = openLucky;
    } else {
      const items = SHOP.items || [];
      const look = SHOP.look || {};
      pane.innerHTML = `<div class="soul-look-preview" id="soulLookPrev">${lookPreview(look)}</div>
        <div class="soul-look-grid">${items.map(it => `<button type="button" class="soul-look-item${it.owned ? ' owned' : ''}${look[it.kind] === it.id ? ' on' : ''}" data-id="${it.id}" data-kind="${it.kind}" data-owned="${it.owned ? 1 : 0}" data-cost="${it.cost}">
          <span>${it.emoji}</span><b>${it.name}</b><small>${it.owned ? ' equip' : it.cost + ' 🪙'}</small>
        </button>`).join('')}</div>`;
      $$('#soulShopPane .soul-look-item').forEach(btn => {
        btn.onclick = () => onLookItem(btn);
      });
    }
  }

  function lookPreview(look) {
    const items = (SHOP && SHOP.items) || [];
    const pick = k => {
      const id = look && look[k];
      const it = items.find(x => x.id === id);
      return it ? it.emoji : '';
    };
    return `<div class="soul-look-ava">${pick('acc') || '🙂'}<i>${pick('hair')}</i><b>${pick('cloth')}</b></div>`;
  }

  async function onLookItem(btn) {
    const id = btn.dataset.id;
    const owned = btn.dataset.owned === '1';
    try {
      if (!owned) {
        const d = await api('/api/soul/look/buy', 'POST', { item_id: id });
        if (d.balance != null && typeof ME !== 'undefined' && ME) ME.balance = d.balance;
        toast('تم شراء العنصر');
      }
      const kind = btn.dataset.kind;
      const look = Object.assign({}, (SHOP && SHOP.look) || {});
      look[kind] = id;
      await api('/api/soul/look/wear', 'POST', look);
      await loadShop();
      renderShop();
    } catch (e) {
      toast((e && e.error) || 'تعذر العنصر', false);
    }
  }

  async function openShop(tab) {
    if (!needAuth()) return;
    SHOP_TAB = tab || 'coins';
    if (typeof openOv === 'function') openOv('soulShopOv');
    try {
      await loadShop();
      renderShop();
    } catch (e) {
      const pane = $('#soulShopPane');
      if (pane) pane.innerHTML = '<div class="soul-empty">تعذر تحميل المتجر</div>';
    }
  }

  async function openLucky() {
    if (!needAuth()) return;
    if (typeof openOv === 'function') openOv('soulLuckyOv');
    const title = $('#soulLuckyTitle');
    const sub = $('#soulLuckySub');
    const box = $('#soulLuckyBox');
    if (title) title.textContent = 'صندوق الحظ';
    if (sub) sub.textContent = '80 🪙 لكل فتحة';
    if (box) { box.textContent = '🎁'; box.classList.remove('win'); }
  }

  async function spinLucky() {
    const box = $('#soulLuckyBox');
    const title = $('#soulLuckyTitle');
    const sub = $('#soulLuckySub');
    if (box) box.classList.add('spin');
    try {
      const d = await api('/api/soul/lucky', 'POST', {});
      if (box) {
        box.classList.remove('spin');
        box.classList.add('win');
        box.textContent = d.prize && d.prize.kind === 'gold' ? '🪙' : (d.prize && d.prize.kind === 'pass' ? '✦' : '🎧');
      }
      if (title) title.textContent = (d.prize && d.prize.label) || 'جائزة';
      if (sub) sub.textContent = d.prize && d.prize.kind === 'gold' ? ('+' + d.prize.value + ' ذهب') : 'أُضيفت إلى حسابك';
      if (typeof ME !== 'undefined' && ME && d.balance != null) ME.balance = d.balance;
      if (typeof soulPaintCoins === 'function') soulPaintCoins();
      toast('ربحت: ' + ((d.prize && d.prize.label) || 'جائزة'));
      SHOP = null;
    } catch (e) {
      if (box) box.classList.remove('spin');
      toast((e && e.error) || 'تعذر الفتح', false);
    }
  }

  async function openEvents() {
    if (!needAuth()) return;
    if (typeof openOv === 'function') openOv('soulEventsOv');
    const box = $('#soulEventsList');
    if (!box) return;
    box.innerHTML = 'جارٍ التحميل...';
    try {
      const d = await api('/api/soul/events/all');
      const feat = (d.featured || []).map(ev => `<div class="soul-row"><span class="ava" style="display:flex;align-items:center;justify-content:center;font-size:22px;background:#3b0764">${ev.emoji || '✦'}</span><div class="info"><b>${ev.title}</b><small>${ev.desc || ''}</small></div></div>`);
      const extra = (d.events || []).map(ev => `<div class="soul-row"><span class="ava" style="display:flex;align-items:center;justify-content:center;font-size:22px;background:#3b0764">${ev.emoji || '✦'}</span><div class="info"><b>${ev.title}</b><small>${ev.body || ''}</small></div></div>`);
      box.innerHTML = (feat.concat(extra).join('')) || '<div class="soul-empty">لا فعاليات حالياً</div>';
    } catch (e) {
      box.innerHTML = '<div class="soul-empty">تعذر التحميل</div>';
    }
  }

  function wireSocialLogin() {
    $$('#soulSocialRow .soul-soc').forEach(b => {
      b.onclick = () => {
        const k = b.dataset.soc;
        if (k === 'phone') {
          toast('أضف رقمك من الملف لاحقاً — الدخول يتم ببريد Gmail مع رمز OTP');
          const em = $('#rEmail') || $('#lUser');
          if (typeof openOv === 'function') openOv('regOv');
          return;
        }
        toast('التسجيل بحساب Gmail فقط (رمز تحقق على البريد)');
        const btn = $('#soulGmailBtn');
        if (btn) btn.click();
      };
    });
  }

  function wire() {
    $$('#soulShopTabs button').forEach(b => {
      b.onclick = () => { SHOP_TAB = b.dataset.stab; renderShop(); };
    });
    const luckyGo = $('#soulLuckyGo');
    if (luckyGo) luckyGo.onclick = spinLucky;
    const shopBtn = $('#soulShopBtn');
    if (shopBtn) shopBtn.onclick = () => openShop('coins');
    const mnShop = $('#mnSoulShop');
    if (mnShop) mnShop.onclick = () => { if (typeof closeOv === 'function') closeOv('menuOv'); openShop('coins'); };
    const mnAv = $('#mnSoulAvatar');
    if (mnAv) mnAv.onclick = () => { if (typeof closeOv === 'function') closeOv('menuOv'); openShop('look'); };
    const mnEv = $('#mnSoulEvents');
    if (mnEv) mnEv.onclick = () => { if (typeof closeOv === 'function') closeOv('menuOv'); openEvents(); };
    const mnPass = $('#mnSoulPass');
    if (mnPass) {
      const prev = mnPass.onclick;
      mnPass.onclick = () => { if (typeof closeOv === 'function') closeOv('menuOv'); openShop('vip'); };
      if (false && prev) prev();
    }
    $$('#soulSeatPicks [data-seats]').forEach(b => {
      b.onclick = () => {
        $$('#soulSeatPicks [data-seats]').forEach(x => x.classList.toggle('active', x === b));
      };
    });
    wireSocialLogin();
    const makeMod = $('#usMakeMod');
    if (makeMod) makeMod.onclick = async () => {
      if (typeof CUR_ROOM === 'undefined' || !CUR_ROOM || typeof CUR_TARGET === 'undefined' || !CUR_TARGET) return;
      try {
        await api('/api/rooms/' + CUR_ROOM.id + '/mod', 'POST', { user_id: CUR_TARGET.id });
        if (typeof closeOv === 'function') closeOv('userSheet');
        toast(CUR_TARGET.username + ' أصبح مشرفاً');
      } catch (e) {
        toast((e && e.error) || 'تعذر التعيين', false);
      }
    };

    if (typeof soulCloseNav === 'function') { /* overlays closed via data-close */ }

    if (typeof soulSubmitRoom === 'function') { }
    const createGo = $('#soulCreateGo');
    if (createGo) {
      const orig = createGo.onclick;
      createGo.onclick = function () {
        window.SOUL_SEAT_COUNT = +((document.querySelector('#soulSeatPicks button.active') || {}).dataset || {}).seats || 8;
        if (orig) return orig.apply(this, arguments);
      };
    }
  }

  window.soulOpenShop = openShop;
  window.soulOpenEvents = openEvents;
  window.soulSeatPicked = function () {
    const b = document.querySelector('#soulSeatPicks button.active');
    return b ? +b.dataset.seats : 8;
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
