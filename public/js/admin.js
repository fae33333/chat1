// =====================================================
//  لوحة التحكم - المنطق
// =====================================================
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
let ME = null;
let SETTINGS = {};
let ROOMS_CACHE = [];
let editingRoom = null, editingUser = null, editingWord = null;

// ---------- أدوات ----------
async function api(url, method = 'GET', body, isForm = false) {
  const opt = { method, credentials: 'same-origin' };
  if (body && !isForm) { opt.headers = { 'Content-Type': 'application/json' }; opt.body = JSON.stringify(body); }
  if (body && isForm) opt.body = body;
  const r = await fetch(url, opt);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw d;
  return d;
}
function toast(msg, ok = true) {
  const t = $('#toast');
  const text = String(msg || '');
  t.innerHTML = `<i class="f7-icons">${ok ? 'checkmark_circle_fill' : 'xmark_circle_fill'}</i><span></span>`;
  t.querySelector('span').textContent = text;
  t.className = 'toast show ' + (ok ? 'ok' : 'err');
  clearTimeout(t._tm);
  const duration = Math.min(6000, Math.max(2600, text.length * 45));
  t._tm = setTimeout(() => t.classList.remove('show'), duration);
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------- القائمة الجانبية ----------
const MENU = [
  { icon: 'money_dollar_circle_fill', color: '#fbbf24', label: 'رصيد العضويات', subs: [{ id: 'memberships', icon: 'money_dollar_circle_fill', label: 'رصيد العضويات' }] },
  { icon: 'gear_alt_fill', color: '#94a3b8', label: 'الاعدادات الاساسيه', subs: [
    { id: 'general', icon: 'wrench_fill', label: 'ضبط الاعدادات' },
    { id: 'msgSettings', icon: 'chat_bubble_fill', label: 'اعدادات الرسائل' },
    { id: 'logo', icon: 'paintbrush_fill', label: 'وضع الشعار' },
    { id: 'skin', icon: 'paintbrush_fill', label: 'وضع الجلد' },
    { id: 'fontsize', icon: 'textformat_size', label: 'تحديد حجم الخط' }]},
  { icon: 'house_fill', color: '#fb923c', label: 'اعدادات الغرف', subs: [
    { id: 'rooms', icon: 'list_bullet', label: 'قائمة الغرف' },
    { id: 'roomAdd', icon: 'plus_square_fill', label: 'اضافة غرفة' },
    { id: 'bots', icon: 'wand_stars', label: 'رسائل الروبوت' }]},
  { icon: 'desktopcomputer', color: '#38bdf8', label: 'اعدادات النظام', subs: [
    { id: 'system', icon: 'wrench_fill', label: 'اعدادات النظام الاساسي' }]},
  { icon: 'person2_fill', color: '#818cf8', label: 'ادارة المستخدمين', subs: [
    { id: 'userAdd', icon: 'plus_circle_fill', label: 'اضافه مستخدم' },
    { id: 'userEdit', icon: 'pencil_circle_fill', label: 'تحرير مستخدم' },
    { id: 'serviceRequests', icon: 'bell_badge_fill', label: 'طلبات التوثيق والترقية' },
    { id: 'admins', icon: 'rosette', label: 'الحسابات الادارية' },
    { id: 'kicks', icon: 'square_arrow_right_fill', label: 'قائمة المطرودين' },
    { id: 'bans', icon: 'slash_circle_fill', label: 'قائمة الحظر' }]},
  { icon: 'gear_alt_fill', color: '#94a3b8', label: 'نظام الادارة', subs: [
    { id: 'broadcast', icon: 'bolt_badge_a_fill', label: 'ارسال اعلان للجميع' },
    { id: 'words', icon: 'search', label: 'فلترة الكلمات' },
    { id: 'restart', icon: 'arrow_clockwise_circle_fill', label: 'استئناف الخادم' }]},
  { icon: 'gift_fill', color: '#f472b6', label: 'الهدايا والإيموجي', subs: [
    { id: 'gifts', icon: 'gift_fill', label: 'ادارة الهدايا' },
    { id: 'emojis', icon: 'smiley_fill', label: 'رفع الإيموجي' }]},
  { icon: 'shield_fill', color: '#60a5fa', label: 'توثيق', subs: [
    { id: 'verified', icon: 'checkmark_shield_fill', label: 'توثيق' }]},
  { icon: 'eye_fill', color: '#f472b6', label: 'رصد فريق', subs: [
    { id: 'monitor', icon: 'eye_fill', label: 'رصد فريق' }]},
  { icon: 'doc_text_fill', color: '#fdba74', label: 'معلومات الترخيص', subs: [
    { id: 'license', icon: 'doc_text_fill', label: 'معلومات الترخيص' }]}
];

function buildMenu() {
  const el = $('#sbMenu');
  el.innerHTML = '';
  MENU.forEach((m) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="sb-item">
        <i class="f7-icons mi" style="color:${m.color}">${m.icon}</i>
        <span>${m.label}</span>
        <i class="f7-icons chev">chevron_down</i>
      </div>
      <div class="sb-sub">
        ${m.subs.map(s => `<div class="sb-subitem" data-page="${s.id}"><i class="f7-icons mi">${s.icon}</i> ${s.label}</div>`).join('')}
      </div>`;
    const item = wrap.querySelector('.sb-item');
    const sub = wrap.querySelector('.sb-sub');
    item.onclick = () => {
      const wasOpen = sub.classList.contains('open');
      $$('.sb-sub').forEach(x => x.classList.remove('open'));
      $$('.sb-item').forEach(x => x.classList.remove('open'));
      if (!wasOpen) { sub.classList.add('open'); item.classList.add('open'); }
    };
    wrap.querySelectorAll('.sb-subitem').forEach(si => {
      si.onclick = () => {
        $$('.sb-subitem').forEach(x => x.classList.remove('active'));
        si.classList.add('active');
        loadPage(si.dataset.page);
      };
    });
    el.appendChild(wrap);
  });
}

// ---------- صف حقل إعداد (تبديل) ----------
const swRow = (icon, color, label, key) => `
  <div class="row">
    <span class="lbl"><i class="f7-icons mi" style="color:${color}">${icon}</i> ${label} :</span>
    <label class="switch"><input type="checkbox" data-key="${key}" ${SETTINGS[key] === '1' ? 'checked' : ''}><span class="tr"><span class="th"></span></span></label>
  </div>`;
const inpRow = (icon, color, label, key, type = 'number', suffix = 'رصيد') => `
  <div class="row">
    <span class="lbl"><i class="f7-icons mi" style="color:${color}">${icon}</i> ${label} :</span>
    <span style="display:flex;align-items:center;gap:10px">
      <input class="inp num" type="${type}" data-key="${key}" value="${esc(SETTINGS[key] ?? '')}">
      ${suffix ? `<span class="suffix">${suffix}</span>` : ''}
    </span>
  </div>`;

// =====================================================
//  الصفحات
// =====================================================
// ---- مساعدا قسمَي الهدايا والإيموجي ----
let ED_GIFT = null, ADMIN_GIFT_AUDIO = null;
async function renderAdminGifts() {
  const list = await api('/api/admin/gifts');
  $('#gAdminList').innerHTML = list.map(g => `
    <div style="display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #e7eaf5;border-radius:12px;padding:10px 14px">
      ${g.img && g.img.startsWith('/') ? `<img src="${esc(g.img)}" style="width:46px;height:46px;object-fit:contain;background:#f6f7fc;border-radius:10px;padding:4px">` : `<span style="font-size:32px;width:46px;text-align:center">${esc(g.img || '🎁')}</span>`}
      <div style="flex:1"><b style="font-size:13.5px;color:#2c3154">${esc(g.name)}</b>
        <div style="font-size:11.5px;color:#98a0b3;font-weight:700">القيمة: ${g.price} 🪙 ← يربح المستقبل: ${g.payout} 🪙 • ${esc(g.cat)}</div>
        <div style="font-size:10.5px;color:${g.audio ? '#16a34a' : '#9ca3af'};font-weight:700;margin-top:3px">${g.audio ? '🔊 صوت الهدية مرفق' : '🔇 بدون صوت'}</div></div>
      ${g.audio ? `<button class="btn btn-gray g-audio-play" data-src="${esc(g.audio)}" style="padding:7px 10px"><i class="f7-icons">play_fill</i> تجربة</button>` : ''}
      <button class="btn btn-gray g-edit" data-id="${g.id}" style="padding:7px 13px"><i class="f7-icons">pencil</i> تعديل</button>
      <button class="btn btn-red g-del" data-id="${g.id}" style="padding:7px 13px"><i class="f7-icons">trash</i> حذف</button>
    </div>`).join('') || '<div style="color:#9aa0b5;font-weight:800;text-align:center;padding:18px">لا توجد هدايا</div>';
  $$('.g-audio-play').forEach(button => button.onclick = async () => {
    try {
      if (ADMIN_GIFT_AUDIO) { ADMIN_GIFT_AUDIO.pause(); ADMIN_GIFT_AUDIO.currentTime = 0; }
      ADMIN_GIFT_AUDIO = new Audio(button.dataset.src);
      await ADMIN_GIFT_AUDIO.play();
    } catch (e) { toast('تعذر تشغيل صوت الهدية', false); }
  });
  $$('.g-edit').forEach(b => b.onclick = () => { ED_GIFT = list.find(x => x.id === +b.dataset.id); loadPage('gifts'); });
  $$('.g-del').forEach(b => b.onclick = async () => {
    if (!confirm('حذف هذه الهدية نهائياً؟')) return;
    await api('/api/admin/gifts/' + b.dataset.id + '/del', 'POST');
    toast('تم الحذف');
    renderAdminGifts();
  });
}
async function renderAdminBots() {
  const list = await api('/api/admin/bots');
  $('#botList').innerHTML = list.map(b => `
    <div style="display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #e7eaf5;border-radius:12px;padding:10px 14px">
      <div style="width:44px;height:44px;border-radius:12px;background:#fdf2fa;display:flex;align-items:center;justify-content:center;font-size:22px">🤖</div>
      <div style="flex:1;min-width:0">
        <b style="font-size:${Math.min(22, b.size)}px;color:${esc(b.color)};display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.text)}</b>
        <div style="font-size:11.5px;color:#98a0b3;font-weight:700;margin-top:3px">📍 ${esc(b.room_name || 'كل الغرف')} • كل ${b.interval_min} ثانية • حجم ${b.size} • ${b.active ? 'يعمل ✔' : 'متوقف'}</div>
      </div>
      <button class="btn btn-red bot-del" data-id="${b.id}" style="padding:7px 13px"><i class="f7-icons">trash</i> حذف</button>
    </div>`).join('') || '<div style="color:#9aa0b5;font-weight:800;text-align:center;padding:18px">لا توجد رسائل روبوت بعد</div>';
  $$('.bot-del').forEach(x => x.onclick = async () => {
    if (!confirm('حذف رسالة الروبوت هذه؟')) return;
    await api('/api/admin/bots/' + x.dataset.id + '/del', 'POST');
    toast('تم الحذف');
    renderAdminBots();
  });
}
async function renderAdminEmojis() {
  const list = await api('/api/admin/emojis');
  $('#emojiAdminGrid').innerHTML = list.map(e => `
    <div style="position:relative;background:#fff;border:1px solid #e7eaf5;border-radius:12px;padding:10px;display:flex;align-items:center;justify-content:center">
      <img src="${esc(e.img)}" style="width:48px;height:48px;object-fit:contain">
      <button class="emoji-del" data-id="${e.id}" style="position:absolute;top:4px;left:4px;border:0;background:#fee2e2;color:#dc2626;border-radius:8px;width:22px;height:22px;cursor:pointer;font-weight:900">×</button>
    </div>`).join('') || '<div style="color:#9aa0b5;font-weight:800;grid-column:1/-1;text-align:center">لا يوجد إيموجي مرفوع بعد</div>';
  $$('.emoji-del').forEach(b => b.onclick = async () => { await api('/api/admin/emojis/' + b.dataset.id + '/del', 'POST'); renderAdminEmojis(); });
}

const PAGES = {

  // ====== رصيد العضويات ======
  memberships: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#fbbf24">money_dollar_circle_fill</i> رصيد العضويات</div>
      <div style="background:#eef0ff;border:1px solid #c9d1ff;border-radius:12px;padding:8px 18px 12px;margin-bottom:22px">
        <div style="color:#4f46e5;font-weight:800;font-size:14.5px;padding:10px 0;border-bottom:1px dashed #c9d1ff;margin-bottom:8px;text-align:center">إعدادات رصيد شراء العضويات</div>
        <ul style="list-style:none">
          <li style="padding:6px 0;display:flex;align-items:center;gap:9px;color:#4b5563;font-size:14px"><span style="width:7px;height:7px;border-radius:50%;background:#6b7280"></span> VIP - الرصيد المطلوب لشراء عضوية VIP 👑</li>
          <li style="padding:6px 0;display:flex;align-items:center;gap:9px;color:#4b5563;font-size:14px"><span style="width:7px;height:7px;border-radius:50%;background:#6b7280"></span> Premium - الرصيد المطلوب لشراء عضوية Premium 💎</li>
          <li style="padding:6px 0;display:flex;align-items:center;gap:9px;color:#4b5563;font-size:14px"><span style="width:7px;height:7px;border-radius:50%;background:#6b7280"></span> Plus - الرصيد المطلوب لشراء عضوية Plus ⭐</li>
        </ul>
      </div>
      <div class="section" style="border:0;box-shadow:none;padding:0">
        <div class="section-title"><i class="f7-icons mi" style="color:#38bdf8">suit_diamond_fill</i> إعدادات رصيد العضويات</div>
        ${inpRow('rosette', '#f59e0b', 'VIP - الرصيد المطلوب', 'vip_cost')}
        ${inpRow('suit_diamond_fill', '#38bdf8', 'Premium - الرصيد المطلوب', 'premium_cost')}
        ${inpRow('star_fill', '#eab308', 'Plus - الرصيد المطلوب', 'plus_cost')}
        <div class="btn-row">
          <button class="btn btn-gray" id="resetMem"><i class="f7-icons">arrow_clockwise</i> استعادة الافتراضي</button>
          <button class="btn btn-green" id="saveMem"><i class="f7-icons">square_arrow_down_fill</i> حفظ رصيد العضويات</button>
        </div>
      </div>`,
    bind: () => {
      $('#saveMem').onclick = async () => {
        await saveKeys(['vip_cost', 'premium_cost', 'plus_cost']);
        toast('تم حفظ رصيد العضويات بنجاح');
      };
      $('#resetMem').onclick = async () => {
        SETTINGS = { ...SETTINGS, vip_cost: '30', premium_cost: '20', plus_cost: '10' };
        await saveKeys(['vip_cost', 'premium_cost', 'plus_cost']);
        loadPage('memberships');
        toast('تمت استعادة القيم الافتراضية (30 / 20 / 10)');
      };
    }
  },

  // ====== ضبط الاعدادات ======
  general: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#94a3b8">wrench_fill</i> ضبط الاعدادات</div>
      ${swRow('smiley_fill', '#fbbf24', 'عرض زر الاسمايلات', 'show_smiles')}
      ${swRow('mic_fill', '#f472b6', 'عرض زر تسجيل الصوت', 'show_voice')}
      ${swRow('photo_fill', '#4ade80', 'عرض زر ارسال صورة', 'show_image')}
      ${swRow('eye_slash_fill', '#c084fc', '(i1) دخول مخفي للسوبر', 'hidden_super')}
      <div class="section-title" style="margin-top:24px"><i class="f7-icons mi" style="color:#60a5fa">speaker2_fill</i> الإشعارات الصوتية</div>
      ${swRow('person_badge_plus_fill', '#60a5fa', 'صوت عند دخول المستخدم (b1)', 'snd_join')}
      ${swRow('paperplane_fill', '#94a3b8', 'صوت عند ارسال رسالة (b4)', 'snd_msg')}
      ${swRow('square_arrow_right_fill', '#fb923c', 'صوت عند خروج المستخدم (b5)', 'snd_leave')}
      <div class="btn-row" style="justify-content:flex-start">
        <button class="btn btn-purple" id="saveGen"><i class="f7-icons">square_arrow_down_fill</i> حفظ الاعدادات</button>
      </div>`,
    bind: () => { $('#saveGen').onclick = async () => { await saveSwitches(); toast('تم حفظ الاعدادات بنجاح'); }; }
  },

  // ====== اعدادات الرسائل ======
  msgSettings: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#94a3b8">chat_bubble_fill</i> اعدادات الرسائل</div>
      ${swRow('clock_fill', '#60a5fa', 'إظهار الوقت مع الرسالة (espumh)', 'show_time')}
      ${swRow('search', '#f472b6', 'تفعيل مراقبة الرسائل قبل نشرها (mrs eab)', 'msg_review')}
      ${inpRow('textformat_size', '#818cf8', 'الحد الأقصى لأحرف الرسالة', 'msg_max', 'number', 'حرف')}
      ${inpRow('link', '#4ade80', 'رابط الرسائل العامة (puurl)', 'public_msgs_link', 'text', '')}
      <div class="btn-row" style="justify-content:flex-start">
        <button class="btn btn-purple" id="saveMsg"><i class="f7-icons">square_arrow_down_fill</i> حفظ الاعدادات</button>
      </div>`,
    bind: () => { $('#saveMsg').onclick = async () => { await saveSwitches(); await saveKeys(['msg_max', 'public_msgs_link']); toast('تم حفظ اعدادات الرسائل'); }; }
  },

  // ====== وضع الشعار ======
  logo: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#c084fc">paintbrush_fill</i> وضع الشعار</div>
      <div style="background:#f2f5ff;border:1px solid #dfe5ff;border-radius:12px;padding:30px;text-align:center;margin-bottom:22px">
        ${SETTINGS.logo_url ? `<img src="${esc(SETTINGS.logo_url)}" style="max-width:260px;max-height:120px" onerror="this.outerHTML='<div style=&quot;color:#9ca3af&quot;>تعذر تحميل الشعار</div>'">` : `<div style="font-size:20px;font-weight:800;color:#4f46e5">★ شات نجوم العرب</div>`}
        <div style="color:#9ca3af;font-size:12px;margin-top:8px">الرابط : ${esc(SETTINGS.logo_url || 'الافتراضي')}</div>
      </div>
      <div class="section-title">رفع شعار جديد <i class="f7-icons mi" style="color:#818cf8">square_arrow_up_fill</i></div>
      <div class="drop" id="dropLogo">
        <i class="f7-icons folder">folder_fill</i>
        <div class="t1">انقر لاختيار صورة</div>
        <div class="t2">PNG, JPG, JPEG, GIF (حد أقصى 2MB)</div>
        <input type="file" id="logoFile" accept="image/*" style="display:none">
      </div>
      <div style="margin:12px 0"><input class="inp" id="logoUrl" placeholder="أو ضع رابط الشعار هنا https://..." value="${esc(SETTINGS.logo_url || '')}"></div>
      <div class="btn-row">
        <button class="btn btn-purple" id="saveLogo"><i class="f7-icons">square_arrow_down_fill</i> حفظ الشعار الجديد</button>
        <button class="btn btn-gray" id="resetLogo"><i class="f7-icons">arrow_clockwise</i> استعادة الشعار الافتراضي</button>
      </div>`,
    bind: () => {
      const drop = $('#dropLogo'), file = $('#logoFile');
      drop.onclick = () => file.click();
      drop.ondragover = e => { e.preventDefault(); drop.style.background = '#eef2ff'; };
      drop.ondragleave = () => drop.style.background = '';
      drop.ondrop = e => { e.preventDefault(); drop.style.background = ''; if (e.dataTransfer.files[0]) { file.files = e.dataTransfer.files; uploadLogo(); } };
      file.onchange = uploadLogo;
      async function uploadLogo() {
        if (!file.files[0]) return;
        const fd = new FormData();
        fd.append('logo', file.files[0]);
        fd.append('logo_url', $('#logoUrl').value);
        const d = await api('/api/admin/logo', 'POST', fd, true);
        SETTINGS.logo_url = d.logo_url;
        toast('تم رفع الشعار بنجاح');
        loadPage('logo');
      }
      $('#saveLogo').onclick = async () => {
        const fd = new FormData();
        fd.append('logo_url', $('#logoUrl').value);
        const d = await api('/api/admin/logo', 'POST', fd, true);
        SETTINGS.logo_url = d.logo_url;
        toast('تم حفظ الشعار');
        loadPage('logo');
      };
      $('#resetLogo').onclick = async () => {
        const fd = new FormData(); fd.append('logo_url', '');
        await api('/api/admin/logo', 'POST', fd, true);
        SETTINGS.logo_url = '';
        toast('تمت استعادة الشعار الافتراضي');
        loadPage('logo');
      };
    }
  },

  // ====== وضع الجلد ======
  // ====== إدارة الهدايا (رفع صورة + قيمة + ربح المستقبل) ======
  gifts: {
    build: () => {
      const ge = ED_GIFT || {};
      const vis = ge.img
        ? (ge.img.startsWith('/') ? `<img src="${esc(ge.img)}" style="width:54px;height:54px;object-fit:contain">` : `<span style="font-size:40px">${esc(ge.img)}</span>`)
        : '<span style="font-size:38px">🎁</span>';
      return `
      <div class="page-title"><i class="f7-icons mi" style="color:#f472b6">gift_fill</i> ادارة الهدايا</div>
      <div class="section-title">${ge.id ? 'تعديل هدية #' + ge.id : 'إضافة هدية جديدة'} <i class="f7-icons mi" style="color:#818cf8">square_arrow_up_fill</i></div>
      <div style="background:#fff;border:1px solid #e7eaf5;border-radius:14px;padding:16px;margin-bottom:22px">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">
          <div id="gPrev" style="width:70px;height:70px;border-radius:16px;background:#f6f7fc;display:flex;align-items:center;justify-content:center;border:1px dashed #d4d9ea">${vis}</div>
          <div style="flex:1">
            <button class="btn btn-gray" id="gUpBtn"><i class="f7-icons">square_arrow_up_fill</i> رفع صورة الهدية (PNG/GIF/WEBP)</button>
            <input type="file" id="gFile" accept="image/*" style="display:none">
            <div style="font-size:11px;color:#9aa0b5;margin-top:6px" id="gImgPath">${esc(ge.img || 'لم تُرفع صورة بعد')}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;padding:12px;border-radius:12px;background:#f8f5ff;border:1px solid #e9ddff">
          <div style="width:54px;height:54px;border-radius:50%;background:#7c3aed;color:#fff;display:flex;align-items:center;justify-content:center"><i class="f7-icons" style="font-size:25px">music_note_2</i></div>
          <div style="flex:1;min-width:0">
            <button class="btn btn-purple" id="gAudioUpBtn"><i class="f7-icons">waveform</i> رفع صوت الهدية</button>
            <input type="file" id="gAudioFile" accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/opus,audio/webm,.mp3,.wav,.ogg,.m4a,.aac,.opus,.webm" style="display:none">
            <div style="font-size:11px;color:#7b8495;margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" id="gAudioPath">${esc(ge.audio || 'لم يُرفع صوت بعد')}</div>
            <audio id="gAudioPreview" src="${esc(ge.audio || '')}" controls style="${ge.audio ? '' : 'display:none;'}width:100%;height:30px;margin-top:7px"></audio>
          </div>
        </div>
        <div class="inp-row"><label>اسم الهدية</label><input class="inp" id="gName" value="${esc(ge.name || '')}" placeholder="مثال: أسد"></div>
        <div class="inp-row"><label>قيمة الهدية بالذهب (تُخصم من مُرسِل الهدية)</label><input class="inp" id="gPrice" type="number" min="0" value="${ge.price ?? 10}"></div>
        <div class="inp-row"><label>كم يربح مستقبِل الهدية منها (ذهب) — مثال: قيمتها 10 يربح 4</label><input class="inp" id="gPayout" type="number" min="0" value="${ge.payout ?? 4}"></div>
        <div class="inp-row"><label>القسم</label><select class="inp" id="gCat">${['افتراضي', 'فاخرة', 'جواهر'].map(c => `<option ${ge.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="btn-row" style="justify-content:flex-start">
          <button class="btn btn-purple" id="gSave"><i class="f7-icons">square_arrow_down_fill</i> ${ge.id ? 'حفظ التعديلات' : 'إضافة الهدية'}</button>
          ${ge.id ? '<button class="btn btn-gray" id="gCancel">إلغاء التعديل</button>' : ''}
        </div>
      </div>
      <div class="section-title">الهدايا الحالية</div>
      <div id="gAdminList" style="display:grid;gap:8px"></div>`;
    },
    bind: async () => {
      await renderAdminGifts();
      $('#gUpBtn').onclick = () => $('#gFile').click();
      $('#gFile').onchange = async () => {
        if (!$('#gFile').files[0]) return;
        const fd = new FormData(); fd.append('file', $('#gFile').files[0]);
        const d = await api('/api/admin/upload/gift', 'POST', fd, true);
        $('#gImgPath').textContent = d.path;
        $('#gPrev').innerHTML = `<img src="${esc(d.path)}" style="width:54px;height:54px;object-fit:contain">`;
        toast('تم رفع الصورة');
      };
      $('#gAudioUpBtn').onclick = () => $('#gAudioFile').click();
      $('#gAudioFile').onchange = async () => {
        if (!$('#gAudioFile').files[0]) return;
        const fd = new FormData(); fd.append('file', $('#gAudioFile').files[0]);
        try {
          const d = await api('/api/admin/upload/gift-audio', 'POST', fd, true);
          $('#gAudioPath').textContent = d.path;
          $('#gAudioPreview').src = d.path;
          $('#gAudioPreview').style.display = '';
          toast('تم رفع صوت الهدية');
        } catch (e) { toast(e.error || 'تعذر رفع صوت الهدية', false); }
      };
      $('#gSave').onclick = async () => {
        try {
          const pathTxt = $('#gImgPath').textContent.trim();
          await api('/api/admin/gifts', 'POST', {
            id: ED_GIFT && ED_GIFT.id,
            name: $('#gName').value,
            img: pathTxt.startsWith('/') ? pathTxt : ((ED_GIFT && ED_GIFT.img) || ''),
            audio: $('#gAudioPath').textContent.trim().startsWith('/') ? $('#gAudioPath').textContent.trim() : ((ED_GIFT && ED_GIFT.audio) || ''),
            price: $('#gPrice').value, payout: $('#gPayout').value, cat: $('#gCat').value
          });
          ED_GIFT = null;
          toast('تم الحفظ — طُبِّق مباشرة على صفحات الدردشة ⚡');
          loadPage('gifts');
        } catch (e) { toast(e.error || 'تعذر الحفظ', false); }
      };
      const gc = $('#gCancel'); if (gc) gc.onclick = () => { ED_GIFT = null; loadPage('gifts'); };
    }
  },

  // ====== رفع الإيموجي ======
  emojis: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#fbbf24">smiley_fill</i> رفع الإيموجي</div>
      <div class="section-title">إضافة إيموجي مصور جديد <i class="f7-icons mi" style="color:#818cf8">square_arrow_up_fill</i></div>
      <div class="drop" id="emojiDrop">
        <i class="f7-icons folder">folder_fill</i>
        <div class="t1">انقر لاختيار صور الإيموجي</div>
        <div class="t2">يمكن اختيار عدة صور — PNG / GIF / WEBP — وتظهر فوراً مع الإيموجي في الدردشة بحجم صغير</div>
        <input type="file" id="emojiFiles" accept="image/png,image/gif,image/webp,image/jpeg" multiple style="display:none">
      </div>
      <div class="section-title">الإيموجي المرفوع حالياً</div>
      <div id="emojiAdminGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:10px"></div>`,
    bind: async () => {
      await renderAdminEmojis();
      const doFiles = async (files) => {
        for (const f of files) {
          const fd = new FormData(); fd.append('file', f);
          const up = await api('/api/admin/upload/emoji', 'POST', fd, true);
          await api('/api/admin/emojis', 'POST', { img: up.path });
        }
        toast('تم رفع الإيموجي وظهر فوراً لجميع المتصلين ⚡');
        renderAdminEmojis();
      };
      const dz = $('#emojiDrop');
      dz.onclick = () => $('#emojiFiles').click();
      dz.ondragover = e => { e.preventDefault(); dz.style.background = '#eef2ff'; };
      dz.ondragleave = () => dz.style.background = '';
      dz.ondrop = e => { e.preventDefault(); dz.style.background = ''; if (e.dataTransfer.files.length) doFiles([...e.dataTransfer.files]); };
      $('#emojiFiles').onchange = () => { if ($('#emojiFiles').files.length) doFiles([...$('#emojiFiles').files]); };
    }
  },

  skin: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#c084fc">paintbrush_fill</i> وضع الجلد</div>
      <div class="section-title">اختر لون جلد الشات</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap" id="skins">
        ${[['default', '#9c1f46', 'افتراضي (عنابي)'], ['blue', '#1d4ed8', 'أزرق'], ['green', '#15803d', 'أخضر'], ['purple', '#7c3aed', 'بنفسجي'], ['black', '#111827', 'أسود'], ['orange', '#ea580c', 'برتقالي']]
          .map(([k, c, n]) => `
          <div class="skin-box" data-skin="${k}" style="cursor:pointer;text-align:center">
            <div style="width:90px;height:90px;border-radius:16px;background:${c};border:${SETTINGS.skin === k ? '4px solid #4f46e5' : '3px solid #e5e7eb'};box-shadow:0 6px 16px ${c}55"></div>
            <div style="font-size:13px;font-weight:800;color:#374151;margin-top:7px">${n}</div>
          </div>`).join('')}
      </div>
      <div class="btn-row" style="justify-content:flex-start;margin-top:26px">
        <button class="btn btn-purple" id="saveSkin"><i class="f7-icons">square_arrow_down_fill</i> حفظ الجلد</button>
      </div>`,
    bind: () => {
      $$('.skin-box').forEach(b => b.onclick = () => { SETTINGS.skin = b.dataset.skin; loadPage('skin'); });
      $('#saveSkin').onclick = async () => { await saveKeys(['skin']); toast('تم حفظ الجلد'); };
    }
  },

  // ====== تحديد حجم الخط ======
  fontsize: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#94a3b8">textformat_size</i> تحديد حجم الخط</div>
      <div class="row">
        <span class="lbl"><i class="f7-icons mi" style="color:#818cf8">textformat_size</i> حجم خط الرسائل :</span>
        <span style="display:flex;align-items:center;gap:12px">
          <input type="range" min="12" max="22" value="${esc(SETTINGS.font_size || '14')}" id="fsRange" style="width:220px">
          <span class="chip" id="fsVal">${esc(SETTINGS.font_size || '14')}px</span>
        </span>
      </div>
      <div class="section" style="margin-top:18px">
        <div class="section-title">معاينة</div>
        <div id="fsPreview" style="font-size:${esc(SETTINGS.font_size || '14')}px;color:#1f2937">مرحبا بكم في شات نجوم العرب ★ هذه رسالة تجريبية لمعاينة حجم الخط</div>
      </div>
      <div class="btn-row" style="justify-content:flex-start">
        <button class="btn btn-purple" id="saveFs"><i class="f7-icons">square_arrow_down_fill</i> حفظ حجم الخط</button>
      </div>`,
    bind: () => {
      const r = $('#fsRange');
      r.oninput = () => { $('#fsVal').textContent = r.value + 'px'; $('#fsPreview').style.fontSize = r.value + 'px'; };
      $('#saveFs').onclick = async () => { SETTINGS.font_size = r.value; await saveKeys(['font_size']); toast('تم حفظ حجم الخط'); };
    }
  },

  // ====== قائمة الغرف ======
  rooms: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#fb923c">house_fill</i> اعدادات الغرف</div>
      <div class="section-title"><i class="f7-icons mi" style="color:#94a3b8">list_bullet</i> قائمة الغرف المتاحة</div>
      <div id="roomsList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل قائمة الغرف...</div></div>`,
    bind: async () => {
      const rooms = await api('/api/admin/rooms');
      ROOMS_CACHE = rooms;
      $('#roomsList').innerHTML = rooms.length ? rooms.map(r => `
        <div class="list-card">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="width:46px;height:46px;border-radius:10px;background:linear-gradient(135deg,#9c1f46,#d43d6e);display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;overflow:hidden">${r.image ? `<img src="${esc(r.image)}" style="width:100%;height:100%;object-fit:cover">` : '<i class="f7-icons">house_fill</i>'}</div>
            <div>
              <div style="font-weight:800;color:#111827">${esc(r.name)}</div>
              <div style="font-size:12.5px;color:#6b7280">${esc(r.description)}</div>
              <div style="display:flex;gap:7px;margin-top:5px;flex-wrap:wrap">
                <span class="chip">${r.type === 'voice' ? 'صوتية 🎙' : 'افتراضية 💬'}</span>
                <span class="chip">${r.max_users} مستخدم</span>
                <span class="chip" style="color:${r.status === 'open' ? '#059669' : '#dc2626'}">${r.status === 'open' ? '● مفتوحة' : '● مغلقة'}</span>
                ${r.password ? '<span class="chip" style="color:#d946a6">🔒 برقم سري</span>' : ''}
              </div>
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-yellow btn-sm" onclick="editRoom(${r.id})"><i class="f7-icons">pencil</i> تعديل</button>
            <button class="btn btn-red btn-sm" onclick="delRoom(${r.id})"><i class="f7-icons">trash_fill</i> حذف</button>
          </div>
        </div>`).join('') : '<div class="empty">لا توجد غرف بعد</div>';
    }
  },

  // ====== اضافة غرفة ======
  roomAdd: {
    build: () => {
      const r = editingRoom || {};
      return `
      <div class="page-title"><i class="f7-icons mi" style="color:#7c3aed">plus_square_fill</i> ${editingRoom ? 'تعديل غرفة' : 'اضافة غرفة جديدة'}</div>
      <div class="grid2">
        <div class="fgroup"><label><i class="f7-icons mi" style="color:#fb923c">house_fill</i> اسم الغرفة *</label>
          <input class="inp" id="rName" value="${esc(r.name || '')}" placeholder="اسم الغرفة"></div>
        <div class="fgroup"><label><i class="f7-icons mi" style="color:#4ade80">circle_grid_hex_fill</i> حالة الغرفة</label>
          <select class="inp" id="rStatus">
            <option value="open" ${(!r.status || r.status === 'open') ? 'selected' : ''}>🟢 مفتوحة (نشطة)</option>
            <option value="closed" ${r.status === 'closed' ? 'selected' : ''}>🔴 مغلقة</option>
          </select></div>
      </div>
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#60a5fa">text_alignleft</i> وصف الغرفة</label>
        <input class="inp" id="rDesc" value="${esc(r.description || 'اهلا وسهلا بكم في شات نجوم العرب ★')}"></div>
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#16a34a">chat_bubble_text_fill</i> رسالة الترحيب عند دخول الغرفة</label>
        <textarea class="inp" id="rWelcome" rows="3" maxlength="500" placeholder="اتركها فارغة ليبدأ العام بدون أي رسالة">${esc(r.welcome || '')}</textarea>
        <div style="font-size:11.5px;color:#9aa0b5;margin-top:5px">هذه الرسالة وحدها تظهر للعضو عند الدخول، ولا يتم تحميل سجل الرسائل القديم.</div></div>
      <div class="grid2">
        <div class="fgroup"><label><i class="f7-icons mi" style="color:#818cf8">person2_fill</i> الحد الأقصى للمستخدمين</label>
          <input class="inp" type="number" id="rMax" value="${r.max_users || 1000}"></div>
        <div class="fgroup"><label><i class="f7-icons mi" style="color:#f472b6">square_grid2x2_fill</i> نوع الغرفة</label>
          <select class="inp" id="rType">
            <option value="default" ${(!r.type || r.type === 'default') ? 'selected' : ''}>💬 افتراضية</option>
            <option value="voice" ${r.type === 'voice' ? 'selected' : ''}>🎙 صوتية</option>
          </select></div>
      </div>
      <div class="section-title"><i class="f7-icons mi" style="color:#94a3b8">gear_alt_fill</i> إعدادات إضافية</div>
      ${roomSel('mic_fill', '#c084fc', 'تمكين الصوت', 'rSound', r.sound)}
      ${roomSel('videocam_fill', '#60a5fa', 'تمكين الفيديو', 'rVideo', r.video)}
      ${roomSel('slider_horizontal3', '#f472b6', 'تفعيل الروبوت (eabrmp)', 'rBots', r.bots)}
      ${roomSel('gift_fill', '#fb923c', 'تفعيل الهدايا (eabvg)', 'rGifts', r.gifts)}
      ${roomSel('gamecontroller_fill', '#4ade80', 'تفعيل الألعاب (gm)', 'rGames', r.games)}
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#d946a6">lock_fill</i> كلمة المرور السرية (اتركها فارغة = بدون حماية)</label>
        <input class="inp" id="rPass" placeholder="اتركها فارغة بدون كلمة مرور" value="${esc(r.password || '')}"></div>
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#22c55e">photo_fill</i> صورة الغرفة</label>
        <div style="display:flex;align-items:center;gap:14px;background:#fff;border:1px solid #e7eaf5;border-radius:12px;padding:12px 14px">
          <div id="roomImgPrev" style="width:64px;height:64px;border-radius:14px;background:linear-gradient(135deg,#9c1f46,#d43d6e);display:flex;align-items:center;justify-content:center;color:#fff;font-size:26px;overflow:hidden;flex:0 0 auto">${r.image ? `<img src="${esc(r.image)}" style="width:100%;height:100%;object-fit:cover">` : '<i class="f7-icons">house_fill</i>'}</div>
          <div style="flex:1">
            <button type="button" class="btn btn-gray" id="roomImgBtn"><i class="f7-icons">square_arrow_up_fill</i> رفع صورة الغرفة</button>
            <input type="file" id="roomImgFile" accept="image/*" style="display:none">
            <div style="font-size:11px;color:#9aa0b5;margin-top:6px" id="roomImgPath">${esc(r.image || 'لم تُرفع صورة بعد (تظهر أول حرف من اسمها)')}</div>
          </div>
        </div></div>
      <div class="btn-row">
        <button class="btn btn-gray" onclick="clearRoomForm()"><i class="f7-icons">trash_fill</i> تفريغ الحقول</button>
        <button class="btn btn-green" id="saveRoomBtn"><i class="f7-icons">checkmark_circle_fill</i> ${editingRoom ? 'حفظ التعديلات' : 'اضافة غرفة'}</button>
      </div>`;
    },
    bind: () => {
      $('#roomImgBtn').onclick = () => $('#roomImgFile').click();
      $('#roomImgFile').onchange = async () => {
        if (!$('#roomImgFile').files[0]) return;
        const fd = new FormData(); fd.append('file', $('#roomImgFile').files[0]);
        const d = await api('/api/admin/upload/room', 'POST', fd, true);
        $('#roomImgPath').textContent = d.path;
        $('#roomImgPrev').innerHTML = `<img src="${esc(d.path)}" style="width:100%;height:100%;object-fit:cover">`;
        toast('تم رفع صورة الغرفة');
      };
      $('#saveRoomBtn').onclick = async () => {
        const imgPath = $('#roomImgPath').textContent.trim();
        const body = {
          name: $('#rName').value.trim(), description: $('#rDesc').value,
          welcome: $('#rWelcome').value.trim(),
          status: $('#rStatus').value, max_users: +$('#rMax').value || 1000, type: $('#rType').value,
          sound: $('#rSound').value === '1', video: $('#rVideo').value === '1', bots: $('#rBots').value === '1',
          gifts: $('#rGifts').value === '1', games: $('#rGames').value === '1',
          password: $('#rPass').value.trim(),
          image: imgPath.startsWith('/') ? imgPath : ((editingRoom && editingRoom.image) || '')
        };
        if (!body.name) return toast('اكتب اسم الغرفة', false);
        if (editingRoom) body.id = editingRoom.id;
        await api('/api/admin/rooms', 'POST', body);
        toast(editingRoom ? 'تم تعديل الغرفة' : 'تمت اضافة الغرفة بنجاح');
        editingRoom = null;
        loadPage('rooms');
      };
    }
  },

  // ====== رسائل الروبوت المجدولة ======
  bots: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#7c3aed">wand_stars</i> رسائل الروبوت المجدولة</div>
      <div class="section-title"><i class="f7-icons mi" style="color:#d946a6">plus_circle_fill</i> إضافة رسالة روبوت — تُرسل تلقائياً كل فترة</div>
      <div style="background:#fff;border:1px solid #e7eaf5;border-radius:14px;padding:16px;margin-bottom:22px">
        <div class="inp-row"><label>نص الرسالة</label><input class="inp" id="botText" placeholder="مثال: اهلاً وسهلاً بكم في شات نجوم العرب ★"></div>
        <div class="inp-row"><label>الغرفة</label><select class="inp" id="botRoom"><option value="0">🌐 كل الغرف</option></select></div>
        <div class="grid2">
          <div class="inp-row"><label>لون الخط</label><input id="botColor" type="color" value="#d946a6" style="height:44px;width:100%;border:1px solid #e7eaf5;border-radius:10px;padding:4px;background:#fff;cursor:pointer"></div>
          <div class="inp-row"><label>حجم الخط (12 - 40)</label><input class="inp" id="botSize" type="number" min="12" max="40" value="16"></div>
        </div>
        <div class="inp-row"><label>التوقيت — تُرسل كل كم ثانية</label><input class="inp num" id="botInterval" type="number" min="1" max="86400" value="5"></div>
        <div class="btn-row" style="justify-content:flex-start">
          <button class="btn btn-purple" id="botSave"><i class="f7-icons">plus_circle_fill</i> إضافة رسالة الروبوت</button>
        </div>
      </div>
      <div class="section-title"><i class="f7-icons mi" style="color:#94a3b8">timer_fill</i> رسائل الروبوت الحالية</div>
      <div id="botList" style="display:grid;gap:8px"></div>`,
    bind: async () => {
      try {
        const rooms = await api('/api/admin/rooms');
        $('#botRoom').innerHTML = '<option value="0">🌐 كل الغرف</option>' + rooms.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
      } catch (e) { }
      renderAdminBots();
      $('#botSave').onclick = async () => {
        try {
          await api('/api/admin/bots', 'POST', {
            text: $('#botText').value, room_id: +$('#botRoom').value || 0,
            color: $('#botColor').value, size: +$('#botSize').value || 16, interval_min: +$('#botInterval').value || 5
          });
          toast('تمت الإضافة — يعمل الروبوت فوراً ⚡');
          loadPage('bots');
        } catch (e) { toast(e.error || 'تعذر الحفظ', false); }
      };
    }
  },

  // ====== اعدادات النظام ======
  system: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#94a3b8">wrench_fill</i> اعدادات النظام الاساسي</div>
      ${swRow('rosette', '#fbbf24', 'وضع المشرفين (msip)', 'supervisors_mode')}
      ${swRow('keyboard', '#f472b6', 'تمكين المستخدم من التسجيل في الشات (eur)', 'allow_register')}
      ${swRow('clock_fill', '#60a5fa', 'إظهار الوقت مع الرسالة (espumh)', 'show_time')}
      ${swRow('mic_slash_fill', '#94a3b8', 'تفعيل الكتم (mt e)', 'enable_mute')}
      ${swRow('mic_slash_fill', '#f472b6', 'تفعيل الكتم الصامت (mt amt)', 'enable_silent_mute')}
      ${swRow('eye_fill', '#c084fc', 'تفعيل مراقبة الرسائل قبل نشرها (mrs eab)', 'msg_review')}
      ${swRow('wrench_fill', '#94a3b8', 'تفعيل إعدادات الروبوت (esprmh)', 'enable_bots')}
      <div class="section-title" style="margin-top:24px"><i class="f7-icons mi" style="color:#4ade80">chart_bar_fill</i> إعدادات متقدمة</div>
      ${inpRow('link', '#60a5fa', 'رابط الرسائل العامة (puurl)', 'public_msgs_link', 'text', '')}
      <div class="btn-row" style="justify-content:flex-start">
        <button class="btn btn-purple" id="saveSys"><i class="f7-icons">square_arrow_down_fill</i> حفظ الاعدادات</button>
      </div>`,
    bind: () => { $('#saveSys').onclick = async () => { await saveSwitches(); await saveKeys(['public_msgs_link']); toast('تم حفظ اعدادات النظام'); }; }
  },

  // ====== اضافة مستخدم ======
  userAdd: {
    build: () => userForm(null),
    bind: () => bindUserForm(null)
  },

  // ====== تحرير مستخدم ======
  userEdit: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#f59e0b">pencil_circle_fill</i> تحرير مستخدم</div>
      <div style="display:flex;gap:10px;margin-bottom:16px">
        <input class="inp" id="searchUser" placeholder="🔍 ابحث باسم المستخدم...">
        <button class="btn btn-purple btn-sm" id="searchBtn"><i class="f7-icons">search</i> بحث</button>
      </div>
      <div id="userEditArea"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل المستخدمين...</div></div>`,
    bind: async () => {
      const render = async (q = '') => {
        const users = await api('/api/admin/users?q=' + encodeURIComponent(q));
        $('#userEditArea').innerHTML = users.length ? users.slice(0, 30).map(u => `
          <div class="list-card">
            <div style="display:flex;align-items:center;gap:10px">
              ${u.avatar ? `<img class="avatar" src="${esc(u.avatar)}" style="width:36px;height:36px;border-radius:50%">` : `<span style="width:36px;height:36px;border-radius:50%;background:#312e81;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px"><i class="f7-icons">person_fill</i></span>`}
              <div>
                <div style="font-weight:800">${esc(u.username)}</div>
                <div style="display:flex;gap:6px;margin-top:4px;align-items:center">
                  <img src="/badges/${u.badge}" style="width:18px;height:18px">
                  <span class="chip">رصيد: ${u.balance}</span>
                  ${u.ip ? `<span class="chip" dir="ltr">IP: ${esc(u.ip)}</span>` : ''}
                  ${u.banned ? '<span class="chip" style="color:#dc2626">محظور</span>' : ''}
                  ${u.muted ? '<span class="chip" style="color:#d97706">مكتوم</span>' : ''}
                </div>
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
              <button class="btn btn-yellow btn-sm" onclick="editUser(${u.id})"><i class="f7-icons">pencil</i> تعديل</button>
              <button class="btn btn-gray btn-sm" onclick="muteUser(${u.id},${u.muted ? 0 : 1})"><i class="f7-icons">${u.muted ? 'mic_fill' : 'mic_slash_fill'}</i> ${u.muted ? 'إلغاء الكتم' : 'كتم'}</button>
              <button class="btn btn-red btn-sm" onclick="banUser(${u.id},${u.banned ? 0 : 1})"><i class="f7-icons">slash_circle_fill</i> ${u.banned ? 'فك الحظر' : 'حظر'}</button>
            </div>
          </div>`).join('') : '<div class="empty">لا يوجد مستخدمون مطابقون</div>';
      };
      await render();
      $('#searchBtn').onclick = () => render($('#searchUser').value);
      $('#searchUser').onkeydown = e => { if (e.key === 'Enter') render($('#searchUser').value); };
      window._renderUsers = render;
    }
  },

  // ====== طلبات التوثيق والترقية ======
  serviceRequests: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#6366f1">bell_badge_fill</i> طلبات التوثيق والترقية</div>
      <div class="info-box" style="background:#eef2ff;border-color:#c7d2fe;color:#3730a3;margin-bottom:16px">
        عند الموافقة اختر مقدار الذهب الذي سيُخصم من صاحب الطلب. لا يتم الخصم ولا تطبيق التوثيق أو العضوية قبل موافقتك.
      </div>
      <div style="display:flex;gap:8px;margin-bottom:16px" id="requestTabs">
        <button class="btn btn-purple req-tab" data-status="pending">قيد المراجعة</button>
        <button class="btn btn-gray req-tab" data-status="approved">تمت الموافقة</button>
        <button class="btn btn-gray req-tab" data-status="rejected">مرفوضة</button>
      </div>
      <div id="serviceRequestsList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل الطلبات...</div></div>`,
    bind: async () => {
      let currentStatus = 'pending';
      const render = async () => {
        const list = await api('/api/admin/service-requests?status=' + currentStatus);
        $$('.req-tab').forEach(b => {
          b.classList.toggle('btn-purple', b.dataset.status === currentStatus);
          b.classList.toggle('btn-gray', b.dataset.status !== currentStatus);
        });
        $('#serviceRequestsList').innerHTML = list.length ? list.map(r => {
          const isVerify = r.request_type === 'verify';
          const title = isVerify ? 'طلب توثيق الحساب' : `طلب ترقية إلى ${String(r.plan || '').toUpperCase()}`;
          const details = isVerify
            ? `المستخدم: ${esc(r.username)}`
            : `صاحب الطلب: ${esc(r.username)} • الحساب المستهدف: ${esc(r.target_name)} • المدة: ${r.months} شهر`;
          return `<div class="section" style="margin-bottom:12px;border-color:${isVerify ? '#bfdbfe' : '#ddd6fe'}">
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              <div style="width:44px;height:44px;border-radius:13px;background:${isVerify ? '#dbeafe' : '#ede9fe'};color:${isVerify ? '#2563eb' : '#7c3aed'};display:flex;align-items:center;justify-content:center;flex:none"><i class="f7-icons" style="font-size:23px">${isVerify ? 'checkmark_seal_fill' : 'crown_fill'}</i></div>
              <div style="flex:1;min-width:220px">
                <div style="font-weight:900;color:#1f2937">${title}</div>
                <div style="font-size:12.5px;color:#6b7280;margin-top:4px">${details}</div>
                <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:7px">
                  <span class="chip">الرصيد الحالي: ${r.current_balance ?? 0} ذهب</span>
                  <span class="chip">التكلفة المقترحة: ${r.suggested_gold || 0} ذهب</span>
                  <span class="chip">${new Date(r.created_at * 1000).toLocaleString('ar')}</span>
                </div>
              </div>
            </div>
            ${currentStatus === 'pending' ? `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid #edf0f5">
              <label style="font-size:13px;font-weight:800;color:#374151">الذهب المطلوب خصمه:</label>
              <input class="inp num request-gold" data-id="${r.id}" type="number" min="0" max="100000" value="${r.suggested_gold || 0}" style="width:120px">
              <button class="btn btn-green request-approve" data-id="${r.id}"><i class="f7-icons">checkmark_circle_fill</i> موافقة وتنفيذ</button>
              <button class="btn btn-red request-reject" data-id="${r.id}"><i class="f7-icons">xmark_circle_fill</i> رفض</button>
            </div>` : `<div style="margin-top:12px;padding-top:10px;border-top:1px solid #edf0f5;font-size:12.5px;color:${currentStatus === 'approved' ? '#059669' : '#dc2626'};font-weight:800">
              ${currentStatus === 'approved' ? `تمت الموافقة وخصم ${r.approved_gold || 0} ذهب` : `تم الرفض: ${esc(r.note || 'بدون سبب')}`} ${r.admin_name ? `• بواسطة ${esc(r.admin_name)}` : ''}
            </div>`}
          </div>`;
        }).join('') : '<div class="empty">لا توجد طلبات في هذه القائمة</div>';

        $$('.request-approve').forEach(b => b.onclick = async () => {
          const input = $(`.request-gold[data-id="${b.dataset.id}"]`);
          const gold = Math.max(0, parseInt(input.value) || 0);
          if (!confirm(`الموافقة وخصم ${gold} ذهب من المستخدم؟`)) return;
          try {
            await api('/api/admin/service-requests/' + b.dataset.id + '/approve', 'POST', { gold });
            toast('تمت الموافقة وتنفيذ الطلب وخصم الذهب');
            render();
          } catch (e) { toast(e.error || 'تعذرت الموافقة', false); }
        });
        $$('.request-reject').forEach(b => b.onclick = async () => {
          const note = prompt('اكتب سبب الرفض الذي سيصل للمستخدم:', 'تم رفض الطلب من الإدارة');
          if (note === null) return;
          try {
            await api('/api/admin/service-requests/' + b.dataset.id + '/reject', 'POST', { note });
            toast('تم رفض الطلب وإبلاغ المستخدم');
            render();
          } catch (e) { toast(e.error || 'تعذر رفض الطلب', false); }
        });
      };
      $$('.req-tab').forEach(b => b.onclick = () => { currentStatus = b.dataset.status; render(); });
      await render();
    }
  },

  // ====== الحسابات الادارية ======
  admins: {
    build: () => `
      <div class="page-title" style="margin-inline-start:auto"><span style="display:flex;align-items:center;gap:8px">الحسابات الإدارية <i class="f7-icons mi" style="color:#fbbf24">rosette</i></span></div>
      <div style="display:flex;justify-content:flex-start;margin-bottom:18px">
        <button class="btn btn-green btn-sm" onclick="addAdminAccount()"><i class="f7-icons">plus</i> إضافة حساب إداري</button>
      </div>
      <div id="adminsList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل الحسابات...</div></div>`,
    bind: async () => {
      const list = await api('/api/admin/admins');
      $('#adminsList').innerHTML = list.map(u => `
        <div class="list-card">
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm" style="background:#f3e8ff;color:#7c3aed" onclick="delAdmin(${u.id},'${esc(u.username)}')"><i class="f7-icons">trash_fill</i> حذف</button>
            <button class="btn btn-sm" style="background:#fef3c7;color:#92400e" onclick="editUser(${u.id})"><i class="f7-icons">pencil</i> تعديل</button>
          </div>
          <div class="u-cell">
            <div class="u-name">${esc(u.username)}
              <span class="avatar-i">${u.avatar ? `<img class="avatar" src="${esc(u.avatar)}" style="width:34px;height:34px;border-radius:50%">` : '<i class="f7-icons">person_fill</i>'}</span>
            </div>
            <span class="rank-pill"><span class="star">★</span> ${u.rank === 'superadmin' ? 'سوبر ادمين' : u.rank === 'admin' ? 'ادمن' : 'ادمن غرفة'}</span>
          </div>
        </div>`).join('') || '<div class="empty">لا توجد حسابات إدارية</div>';
    }
  },

  // ====== قائمة المطرودين من الغرف ======
  kicks: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#f97316">square_arrow_right_fill</i> قائمة المطرودين من الغرف</div>
      <div class="info-box" style="background:#fff7ed;border-color:#fed7aa;color:#9a3412;margin-bottom:16px">
        يبقى الطرد فعالاً ويمنع إعادة دخول الغرفة حتى تضغط «فك الطرد» من هذه الصفحة.
      </div>
      <div id="kicksList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل المطرودين...</div></div>`,
    bind: async () => {
      const list = await api('/api/admin/kicks');
      $('#kicksList').innerHTML = list.length ? list.map(k => `
        <div class="list-card word-card">
          <span class="word-name" style="display:flex;flex-direction:column;align-items:flex-start;gap:5px">
            <span><i class="f7-icons" style="color:#f97316">square_arrow_right_fill</i> ${esc(k.username || 'زائر')}</span>
            <span style="display:flex;gap:6px;flex-wrap:wrap">
              <span class="chip">الغرفة: ${esc(k.room_name)}</span>
              ${k.ip ? `<span class="chip" dir="ltr">IP: ${esc(k.ip)}</span>` : `<span class="chip">User ID: ${k.user_id}</span>`}
              <span class="chip">${esc(k.reason || 'بدون سبب')}</span>
            </span>
          </span>
          <button class="btn btn-green btn-sm" onclick="unkick(${k.id})"><i class="f7-icons">arrow_uturn_left</i> فك الطرد</button>
        </div>`).join('') : '<div class="empty">✅ قائمة المطرودين فارغة</div>';
    }
  },

  // ====== قائمة الحظر ======
  bans: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#dc2626">slash_circle_fill</i> قائمة الحظر</div>
      <div class="info-box" style="background:#fef2f2;border-color:#fecaca;color:#991b1b;margin-bottom:16px">
        حظر الزائر مرتبط بعنوان IP الحقيقي ويبقى فعالاً حتى إزالته من هنا.
      </div>
      <div id="bansList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري التحميل...</div></div>`,
    bind: async () => {
      const list = await api('/api/admin/bans');
      $('#bansList').innerHTML = list.length ? list.map(b => `
        <div class="list-card word-card">
          <span class="word-name" style="display:flex;flex-direction:column;align-items:flex-start;gap:5px">
            <span><i class="f7-icons">nosign</i> ${esc(b.username || 'زائر')}</span>
            <span style="display:flex;gap:6px;flex-wrap:wrap">
              ${b.ip ? `<span class="chip" dir="ltr">IP: ${esc(b.ip)}</span>` : '<span class="chip">حظر حساب</span>'}
              <span class="chip">${esc(b.reason || 'بدون سبب')}</span>
            </span>
          </span>
          <button class="btn btn-green btn-sm" onclick="unban(${b.id})"><i class="f7-icons">arrow_uturn_left</i> فك الحظر</button>
        </div>`).join('') : '<div class="empty">✅ قائمة الحظر فارغة</div>';
    }
  },

  // ====== ارسال اعلان ======
  broadcast: {
    build: () => `
      <div class="page-title" style="margin-inline-start:auto"><span style="display:flex;align-items:center;gap:8px">ارسال اعلان للجميع <i class="f7-icons mi" style="color:#ec4899">bolt_badge_a_fill</i></span></div>
      <div class="section">
        <textarea class="inp" id="bcText" rows="6" maxlength="500" placeholder="اكتب رسالة الاعلان هنا..." style="resize:vertical;font-size:15px"></textarea>
        <div class="counter" style="text-align:left"><span id="bcCount">0</span> / 500 حرف</div>
        <div class="btn-row">
          <button class="btn btn-purple" style="min-width:60%" id="bcSend"><i class="f7-icons">paperplane_fill</i> ارسال الاعلان</button>
        </div>
      </div>`,
    bind: () => {
      const t = $('#bcText');
      t.oninput = () => $('#bcCount').textContent = t.value.length;
      $('#bcSend').onclick = async () => {
        if (!t.value.trim()) return toast('اكتب نص الإعلان أولا', false);
        await api('/api/admin/broadcast', 'POST', { text: t.value });
        toast('تم إرسال الإعلان لجميع الغرف');
        t.value = ''; $('#bcCount').textContent = '0';
      };
    }
  },

  // ====== فلترة الكلمات ======
  words: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#94a3b8">search</i> فلترة الكلمات</div>
      <div class="info-box" style="display:flex;align-items:center;gap:14px;background:#fefce8;border-color:#fde68a">
        <button class="btn btn-yellow btn-sm" id="replBtn"><i class="f7-icons">lock_shield_fill</i> تعديل رمز الاستبدال</button>
        <span style="background:#ef4444;color:#fff;border-radius:50%;width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;font-weight:800">**</span>
        <span style="color:#713f12;font-weight:700">سيتم استبدال الكلمات الممنوعة بـ :</span>
      </div>
      <div class="section-title"><i class="f7-icons mi" style="color:#dc2626">nosign</i> قائمة الكلمات المغلقة</div>
      <div id="wordsList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري التحميل...</div></div>
      <div class="section-title" style="margin-top:22px"><i class="f7-icons mi" style="color:#7c3aed">plus_circle_fill</i> إضافة كلمة جديدة</div>
      <div style="display:flex;gap:10px">
        <input class="inp" id="newWord" placeholder="اكتب الكلمة الممنوعة هنا...">
        <button class="btn btn-green" id="addWordBtn"><i class="f7-icons">plus</i> اضافة كلمة</button>
      </div>`,
    bind: async () => {
      await renderWords();
      $('#addWordBtn').onclick = async () => {
        const w = $('#newWord').value.trim();
        if (!w) return toast('اكتب الكلمة أولا', false);
        if (editingWord) { await api('/api/admin/words', 'POST', { id: editingWord, word: w }); editingWord = null; toast('تم تعديل الكلمة'); }
        else { await api('/api/admin/words', 'POST', { word: w }); toast('تمت إضافة الكلمة'); }
        $('#newWord').value = '';
        await renderWords();
      };
      $('#replBtn').onclick = () => toast('رمز الاستبدال الحالي : **');
    }
  },

  // ====== استئناف الخادم ======
  restart: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#60a5fa">arrow_clockwise_circle_fill</i> استئناف الخادم</div>
      <div class="section" style="text-align:center;padding:50px 20px">
        <i class="f7-icons" style="font-size:60px;color:#6366f1">arrow_clockwise_circle_fill</i>
        <h3 style="margin:14px 0 6px;color:#1f2937">إعادة تشغيل خادم الشات</h3>
        <p style="color:#6b7280;font-size:13.5px">سيتم قطع الاتصال عن جميع المستخدمين لثوانٍ قليلة ثم يعود الخادم للعمل.</p>
        <div class="btn-row">
          <button class="btn btn-red" id="doRestart"><i class="f7-icons">power</i> استئناف الخادم الآن</button>
        </div>
        <div id="rsState" style="margin-top:20px"></div>
      </div>`,
    bind: () => {
      $('#doRestart').onclick = () => {
        $('#rsState').innerHTML = '<div class="loading" style="padding:10px"><i class="f7-icons">arrow2_circlepath</i>جاري استئناف الخادم...</div>';
        setTimeout(() => { $('#rsState').innerHTML = '<div style="color:#059669;font-weight:800">✅ تم استئناف الخادم بنجاح</div>'; }, 2500);
      };
    }
  },

  // ====== توثيق ======
  verified: {
    build: () => `
      <div class="page-title" style="margin-inline-start:auto"><span style="display:flex;align-items:center;gap:8px">التوثيق - الوصول المشترك <i class="f7-icons mi" style="color:#60a5fa">checkmark_shield_fill</i></span></div>
      <div class="section-title" style="justify-content:flex-end"><span style="display:flex;align-items:center;gap:8px">قائمة الوصول المشترك <i class="f7-icons" style="color:#60a5fa">person2_fill</i></span></div>
      <div id="verList" style="min-height:120px"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل البيانات...</div></div>
      <div class="section" style="background:#f2f5ff;border-color:#dfe5ff;margin-top:20px">
        <div class="section-title" style="justify-content:flex-end"><span style="display:flex;align-items:center;gap:8px">إضافة عضو جديد للتوثيق <i class="f7-icons" style="color:#7c3aed">plus_circle_fill</i></span></div>
        <div style="display:flex;gap:10px">
          <button class="btn btn-purple" id="addVer"><i class="f7-icons">plus</i> إضافة</button>
          <input class="inp" id="verNames" placeholder="أدخل اسم العضو (مثال: ahmed|mohamed|ali)" style="text-align:right">
        </div>
        <div style="color:#92400e;font-size:12.5px;margin-top:10px;display:flex;align-items:center;gap:6px">
          <i class="f7-icons" style="color:#f59e0b">lightbulb_fill</i> يمكنك إضافة عدة أسماء باستخدام | بين كل اسم
        </div>
      </div>`,
    bind: async () => {
      await renderVerified();
      $('#addVer').onclick = async () => {
        const names = $('#verNames').value.trim();
        if (!names) return toast('اكتب اسم العضو', false);
        await api('/api/admin/verified', 'POST', { names });
        $('#verNames').value = '';
        toast('تمت الإضافة للتوثيق');
        await renderVerified();
      };
    }
  },

  // ====== رصد فريق ======
  monitor: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#f472b6">eye_fill</i> رصد فريق</div>
      <div id="statsArea"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري التحميل...</div></div>`,
    bind: async () => {
      const s = await api('/api/admin/stats');
      const card = (icon, color, label, val) => `
        <div class="section" style="text-align:center;padding:24px 10px">
          <i class="f7-icons" style="font-size:34px;color:${color}">${icon}</i>
          <div style="font-size:26px;font-weight:800;color:#1f2937;margin-top:8px">${val}</div>
          <div style="color:#6b7280;font-size:13px;font-weight:700">${label}</div>
        </div>`;
      $('#statsArea').innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
          ${card('person2_fill', '#6366f1', 'الأعضاء المسجلون', s.users)}
          ${card('person_fill', '#f59e0b', 'الزوار', s.guests)}
          ${card('antenna_radiowaves_left_right', '#059669', 'متصل الآن', s.online)}
          ${card('house_fill', '#ec4899', 'عدد الغرف', s.rooms)}
          ${card('chat_bubble2_fill', '#38bdf8', 'مجموع الرسائل', s.messages)}
          ${card('slash_circle_fill', '#dc2626', 'المحظورون', s.bans)}
        </div>`;
    }
  },

  // ====== معلومات الترخيص ======
  license: {
    build: () => `
      <div class="page-title" style="margin-inline-start:auto"><span style="display:flex;align-items:center;gap:8px">معلومات الترخيص <i class="f7-icons mi" style="color:#fdba74">doc_text_fill</i></span></div>
      <div class="license-card" id="licCard">
        <div class="license-head">معلومات الترخيص - Nujum Chat <i class="f7-icons" style="color:#fde047">doc_text_fill</i></div>
        <div class="loading" style="color:#fff">جاري التحميل...</div>
      </div>`,
    bind: async () => {
      const l = await api('/api/admin/license');
      const item = (icon, title, val, ltr = false) => `
        <div class="license-item">
          <div class="lt"><i class="f7-icons" style="color:#8b5cf6;font-size:17px">${icon}</i> ${title}</div>
          <div class="lv" ${ltr ? 'dir="ltr" style="text-align:left"' : ''}>${esc(val)}</div>
        </div>`;
      $('#licCard').innerHTML = `
        <div class="license-head">معلومات الترخيص - Nujum Chat <i class="f7-icons" style="color:#fde047">doc_text_fill</i></div>
        <div class="license-grid">
          ${item('lock_shield_fill', 'رقم الترخيص', l.license, true)}
          ${item('globe', 'اسم النطاق / IP', l.host || 'localhost', true)}
          ${item('envelope_fill', 'البريد الإلكتروني', l.email, true)}
          ${item('wrench_fill', 'التعريفات', 'استخدام غير محدود')}
          ${item('person_fill', 'اسم المستخدم', l.user, true)}
          ${item('star_fill', '⭐ الصلاحية', l.rank, true)}
          ${item('square_stack3d_up_fill', 'الإصدار', l.version, true)}
          ${item('checkmark_seal_fill', 'الحالة', 'مرخص ✅')}
        </div>`;
    }
  }
};

const roomSel = (icon, color, label, id, val) => `
  <div class="row">
    <span class="lbl"><i class="f7-icons mi" style="color:${color}">${icon}</i> ${label} :</span>
    <select class="inp" id="${id}" style="width:180px">
      <option value="0" ${!val ? 'selected' : ''}>❌ معطل</option>
      <option value="1" ${val ? 'selected' : ''}>✅ مفعل</option>
    </select>
  </div>`;

// ---------- نموذج مستخدم (إضافة/تعديل) ----------
function userForm(u) {
  const isEdit = !!u;
  u = u || {};
  return `
    <div class="page-title"><i class="f7-icons mi" style="color:#7c3aed">${isEdit ? 'pencil_circle_fill' : 'plus_circle_fill'}</i> ${isEdit ? 'تحرير مستخدم : ' + esc(u.username) : 'إضافة مستخدم جديد'}</div>
    <div class="fgroup"><label><i class="f7-icons mi" style="color:#60a5fa">person_fill</i> اسم المستخدم (u) * :</label>
      <input class="inp" id="uName" value="${esc(u.username || '')}" placeholder="اسم المستخدم"></div>
    <div class="fgroup"><label><i class="f7-icons mi" style="color:#fbbf24">lock_fill</i> كلمة المرور (pwd) ${isEdit ? '(اتركها فارغة للإبقاء)' : '*'} :</label>
      <input class="inp" type="password" id="uPass" placeholder="••••••"></div>
    <div class="fgroup"><label><i class="f7-icons mi" style="color:#6366f1">envelope_fill</i> البريد الإلكتروني (e) :</label>
      <input class="inp" id="uEmail" value="${esc(u.email || '')}" placeholder="example@email.com"></div>
    <div class="grid2">
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#fbbf24">money_dollar_circle_fill</i> الرصيد (crdsamt) :</label>
        <input class="inp" type="number" id="uBalance" value="${u.balance ?? 80}"></div>
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#38bdf8">globe</i> الدولة (l) :</label>
        <input class="inp" id="uCountry" value="${esc(u.country || '')}" placeholder="مثل: jo, eg, sa"></div>
    </div>
    <div class="grid2">
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#f472b6">person2_fill</i> الجنس (g) :</label>
        <select class="inp" id="uGender">
          <option value="secret" ${(!u.gender || u.gender === 'secret') ? 'selected' : ''}>؟ مجهول</option>
          <option value="boy" ${u.gender === 'boy' ? 'selected' : ''}>👦 ذكر</option>
          <option value="girl" ${u.gender === 'girl' ? 'selected' : ''}>👧 أنثى</option>
        </select></div>
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#fdba74">gift_fill</i> العمر (bt) :</label>
        <input class="inp" type="number" id="uAge" value="${u.age || 25}"></div>
    </div>
    <div class="grid2">
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#fbbf24">rosette</i> العضوية :</label>
        <select class="inp" id="uMembership">
          <option value="none" ${(!u.membership || u.membership === 'none') ? 'selected' : ''}>بدون عضوية</option>
          <option value="mmez" ${u.membership === 'mmez' ? 'selected' : ''}>🔴 مميز</option>
          <option value="plus" ${u.membership === 'plus' ? 'selected' : ''}>⭐ Plus</option>
          <option value="premium" ${u.membership === 'premium' ? 'selected' : ''}>💎 Premium</option>
          <option value="vip" ${u.membership === 'vip' ? 'selected' : ''}>👑 VIP</option>
        </select></div>
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#8b5cf6">shield_fill</i> الصلاحية :</label>
        <select class="inp" id="uRank">
          <option value="user" ${(!u.rank || u.rank === 'user') ? 'selected' : ''}>عضو عادي</option>
          <option value="roomadmin" ${u.rank === 'roomadmin' ? 'selected' : ''}>ادمن غرفة</option>
          <option value="admin" ${u.rank === 'admin' ? 'selected' : ''}>ادمن</option>
          <option value="superadmin" ${u.rank === 'superadmin' ? 'selected' : ''}>سوبر ادمين</option>
        </select></div>
    </div>
    <div class="btn-row">
      <button class="btn btn-gray" onclick="resetUserForm()"><i class="f7-icons">trash_fill</i> تفريغ الحقول</button>
      <button class="btn btn-green" id="saveUserBtn"><i class="f7-icons">${isEdit ? 'checkmark_circle_fill' : 'plus'}</i> ${isEdit ? 'حفظ التعديلات' : 'إضافة مستخدم'}</button>
    </div>`;
}
function bindUserForm(u) {
  $('#saveUserBtn').onclick = async () => {
    const body = {
      username: $('#uName').value.trim(), password: $('#uPass').value,
      email: $('#uEmail').value.trim(), balance: +$('#uBalance').value || 0,
      country: $('#uCountry').value.trim(), gender: $('#uGender').value,
      age: +$('#uAge').value || 25, membership: $('#uMembership').value, rank: $('#uRank').value
    };
    if (u) body.id = u.id;
    try {
      await api('/api/admin/users', 'POST', body);
      toast(u ? 'تم تحديث المستخدم بنجاح' : 'تمت إضافة المستخدم بنجاح');
      editingUser = null;
      if (u) loadPage('userEdit'); else resetUserForm();
    } catch (e) { toast(e.error || 'حدث خطأ', false); }
  };
}
window.resetUserForm = () => { editingUser = null; loadPage('userAdd'); };
window.editUser = async (id) => {
  const users = await api('/api/admin/users');
  const u = users.find(x => x.id === id);
  if (!u) return;
  editingUser = u;
  $('#content').innerHTML = userForm(u);
  bindUserForm(u);
  window.scrollTo(0, 0);
};
window.banUser = async (id, b) => {
  await api(`/api/admin/users/${id}/ban`, 'POST', { banned: !!b, reason: 'حظر من لوحة التحكم' });
  toast(b ? 'تم حظر المستخدم' : 'تم فك الحظر');
  if (window._renderUsers) window._renderUsers($('#searchUser') ? $('#searchUser').value : '');
};
window.muteUser = async (id, m) => {
  await api(`/api/admin/users/${id}/mute`, 'POST', { muted: !!m });
  toast(m ? 'تم كتم المستخدم' : 'تم إلغاء كتم المستخدم');
  // أعد تحميل القائمة مباشرة حتى يتحول الزر بين «كتم» و«إلغاء الكتم» دون تحديث الصفحة.
  if (window._renderUsers) await window._renderUsers($('#searchUser') ? $('#searchUser').value : '');
};
window.unkick = async (id) => { await api('/api/admin/kicks/' + id, 'DELETE'); toast('تم فك الطرد ويمكن للمستخدم دخول الغرفة الآن'); loadPage('kicks'); };
window.unban = async (id) => { await api('/api/admin/bans/' + id, 'DELETE'); toast('تم فك الحظر عن الحساب / IP'); loadPage('bans'); };
window.delAdmin = async (id, name) => {
  if (!confirm(`حذف الحساب الإداري "${name}" ؟`)) return;
  await api('/api/admin/users/' + id, 'DELETE');
  toast('تم الحذف');
  loadPage('admins');
};
window.addAdminAccount = () => { editingUser = null; $('#content').innerHTML = userForm(null); bindUserForm(null); window.scrollTo(0, 0); toast('املأ البيانات واختر الصلاحية'); };
window.editRoom = (id) => { editingRoom = ROOMS_CACHE.find(r => r.id === id); loadPage('roomAdd'); };
window.delRoom = async (id) => {
  if (!confirm('حذف هذه الغرفة نهائيا؟')) return;
  await api('/api/admin/rooms/' + id, 'DELETE');
  toast('تم حذف الغرفة');
  loadPage('rooms');
};
window.clearRoomForm = () => { editingRoom = null; loadPage('roomAdd'); };
window.editWord = (id, w) => { editingWord = id; $('#newWord').value = w; $('#newWord').focus(); toast('عدّل الكلمة ثم اضغط اضافة'); };
window.delWord = async (id) => { await api('/api/admin/words/' + id, 'DELETE'); toast('تم حذف الكلمة'); await renderWords(); };
window.delVerified = async (id) => { await api('/api/admin/verified/' + id, 'DELETE'); toast('تم إزالة العضو من التوثيق'); await renderVerified(); };

async function renderWords() {
  const words = await api('/api/admin/words');
  $('#wordsList').innerHTML = words.length ? words.map(w => `
    <div class="list-card word-card">
      <span class="word-name"><i class="f7-icons">nosign</i> ${esc(w.word)}</span>
      <span style="display:flex;gap:8px">
        <button class="btn btn-yellow btn-sm" onclick="editWord(${w.id},'${esc(w.word).replace(/'/g, '')}')"><i class="f7-icons">pencil</i> تعديل</button>
        <button class="btn btn-red btn-sm" onclick="delWord(${w.id})"><i class="f7-icons">trash_fill</i> حذف</button>
      </span>
    </div>`).join('') : '<div class="empty">لا توجد كلمات ممنوعة</div>';
}
async function renderVerified() {
  const list = await api('/api/admin/verified');
  $('#verList').innerHTML = list.length ? list.map(v => `
    <div class="list-card">
      <span class="word-name"><i class="f7-icons" style="color:#059669">checkmark_shield_fill</i> ${esc(v.username)}</span>
      <button class="btn btn-red btn-sm" onclick="delVerified(${v.id})"><i class="f7-icons">trash_fill</i> حذف</button>
    </div>`).join('') : '<div class="empty">⏳ لا توجد أسماء موثقة بعد</div>';
}

// ---------- حفظ الإعدادات ----------
async function saveKeys(keys) {
  const body = {};
  keys.forEach(k => { body[k] = SETTINGS[k]; });
  await api('/api/admin/settings', 'POST', body);
}
async function saveSwitches() {
  const body = {};
  $$('.switch input[data-key]').forEach(i => { body[i.dataset.key] = i.checked ? '1' : '0'; SETTINGS[i.dataset.key] = body[i.dataset.key]; });
  $$('input[data-key]:not([type=checkbox])').forEach(i => { body[i.dataset.key] = i.value; SETTINGS[i.dataset.key] = i.value; });
  await api('/api/admin/settings', 'POST', body);
}

// ---------- تحميل صفحة ----------
async function loadPage(id) {
  editingWord = null;
  if (id !== 'roomAdd') editingRoom = null;
  const p = PAGES[id];
  if (!p) return;
  // حقول الأرقام تُحفظ عند الكتابة في SETTINGS المحلي
  $('#content').innerHTML = p.build();
  $$('#content input[data-key]').forEach(i => i.addEventListener('input', () => SETTINGS[i.dataset.key] = i.value));
  if (p.bind) await p.bind();
}

// ---------- تشغيل ----------
async function init() {
  const me = await api('/api/me');
  if (me.user && ['admin', 'superadmin'].includes(me.user.rank)) { enterPanel(me.user); return; }
  $('#loginScreen').style.display = 'flex';
}
function enterPanel(user) {
  ME = user;
  $('#loginScreen').style.display = 'none';
  $('#panel').style.display = 'flex';
  $('#sbUserName').textContent = user.username;
  $('#sbUserRank').textContent = user.rank;
  buildMenu();
  api('/api/admin/settings').then(s => {
    SETTINGS = s;
    loadPage('memberships');
    document.querySelector('.sb-sub').classList.add('open');
    document.querySelector('.sb-item').classList.add('open');
    document.querySelector('.sb-subitem').classList.add('active');
  });
}
$('#loginBtn').onclick = async () => {
  try {
    const d = await api('/api/login', 'POST', { username: $('#loginUser').value.trim(), password: $('#loginPass').value });
    if (!['admin', 'superadmin'].includes(d.user.rank)) { $('#loginErr').textContent = 'هذا الحساب ليس حساب إدارة'; return; }
    enterPanel(d.user);
  } catch (e) { $('#loginErr').textContent = e.error || 'فشل تسجيل الدخول'; }
};
$('#loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#loginBtn').click(); });
$('#logoutBtn').onclick = async () => { await api('/api/logout', 'POST'); location.reload(); };

init();
