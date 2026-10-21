// إشعار «دخل فلان الغرفة»: يظهر لكل من في الغرفة (ولمن دخل)،
// يتحرك من اليمين إلى اليسار خلال ثانيتين، يثبت على اليسار 3 ثوانٍ، ثم يختفي.
// إن كان للمستخدم فقاعة مفعّلة من المتجر تصبح خلفية الإشعار.
(function () {
  const SHOW_MS = 5000;      // مدة الظهور (مطابقة لمدة الأنيميشن في CSS)
  const DEDUPE_MS = 8000;    // منع التكرار عند إعادة اتصال نفس المستخدم
  const LANES = [0, -58, 58]; // مسارات رأسية حتى لا تتراكب الإشعارات المتزامنة
  const laneBusyUntil = LANES.map(() => 0);
  const recent = new Map();

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let host = null;
  function getHost() {
    if (host && document.body.contains(host)) return host;
    host = document.createElement('div');
    host.id = 'join-banner-host';
    document.body.appendChild(host);
    return host;
  }

  function pickLane() {
    const now = Date.now();
    let idx = laneBusyUntil.findIndex((t) => t <= now);
    if (idx < 0) idx = laneBusyUntil.indexOf(Math.min.apply(null, laneBusyUntil));
    laneBusyUntil[idx] = now + SHOW_MS; // المسار مشغول طوال بقاء الإشعار
    return LANES[idx];
  }

  function push(user) {
    if (!user) return;
    const key = user.id != null ? String(user.id) : String(user.name || '');
    const now = Date.now();
    if (recent.has(key) && now - recent.get(key) < DEDUPE_MS) return;
    recent.set(key, now);
    if (recent.size > 200) { recent.forEach((t, k) => { if (now - t > DEDUPE_MS) recent.delete(k); }); }

    const wealth = user.wealth_level || (user.role === 'owner' ? 99 : 1);
    const el = document.createElement('div');
    el.className = 'jb-banner';
    el.style.top = pickLane() + 'px';
    const bubble = user.chat_bubble;
    const bubbleIsHtml = !!(bubble && /^\/uploads\//.test(String(bubble)) && window.SCHtml && window.SCHtml.isHtml(bubble));
    if (bubble && /^\/uploads\//.test(String(bubble)) && !bubbleIsHtml) {
      el.classList.add('has-bubble');
      el.style.setProperty('--jb-bubble', `url("${encodeURI(String(bubble))}")`);
    }
    el.innerHTML = `
      <span class="jb-shine"></span>
      <span class="jb-verb">دخل</span>
      <span class="jb-name">${esc(user.name || 'ضيف')}</span>
      <span class="jb-lv">Lv.${esc(wealth)}</span>
      <span class="jb-verb">الغرفة</span>
    `;
    // فقاعة HTML: طبقة iframe معزولة خلف نص الإشعار
    if (bubbleIsHtml) { el.classList.add('has-bubble-html'); window.SCHtml.attach(el, String(bubble)); }
    getHost().appendChild(el);
    el.addEventListener('animationend', () => el.remove());
    setTimeout(() => { if (el.parentNode) el.remove(); }, SHOW_MS + 300); // احتياط
  }

  window.joinBanner = { push };
})();
