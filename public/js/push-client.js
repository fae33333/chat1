/* عميل الإشعارات: تسجيل الـService Worker، الاشتراك بـVAPID، وزر تثبيت التطبيق */
(function () {
  'use strict';
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });

  function b64ToU8(s) {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
  const userId = () => {
    try { if (typeof window.getSoulUserId === 'function') { const id = window.getSoulUserId(); if (id) return id; } } catch (e) {}
    try { return sessionStorage.getItem('soulchill_user_id') || ''; } catch (e) { return ''; }
  };

  async function registerSW() {
    if (!('serviceWorker' in navigator)) return null;
    try { return await navigator.serviceWorker.register('/sw.js'); } catch (e) { return null; }
  }

  async function send(sub) {
    const r = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId() },
      body: JSON.stringify({ subscription: sub.toJSON() })
    });
    return r.ok;
  }

  async function enable() {
    if (!supported) throw new Error('المتصفح لا يدعم الإشعارات (على iPhone ثبّت التطبيق على الشاشة الرئيسية أولاً)');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('لم يتم السماح بالإشعارات');
    const reg = await registerSW();
    if (!reg) throw new Error('تعذر تشغيل Service Worker');
    await navigator.serviceWorker.ready;
    const k = await (await fetch('/api/push/public-key')).json();
    if (!k.enabled) throw new Error('الإشعارات متوقفة حالياً');
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      // مفتاح VAPID تغيّر؟ نعيد الاشتراك
      const cur = sub.options && sub.options.applicationServerKey;
      const want = b64ToU8(k.publicKey);
      if (cur && (cur.byteLength !== want.length || !new Uint8Array(cur).every((v, i) => v === want[i]))) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(k.publicKey) });
    if (!(await send(sub))) throw new Error('تعذر حفظ الاشتراك');
    return true;
  }

  async function disable() {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg && await reg.pushManager.getSubscription();
    if (!sub) return true;
    try { await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }); } catch (e) {}
    return sub.unsubscribe();
  }

  // هل الاشتراك الحالي مُنشأ بنفس مفتاح VAPID العام الذي يرسل به السيرفر؟
  function sameKey(sub, publicKey) {
    const cur = sub && sub.options && sub.options.applicationServerKey;
    if (!cur) return true; // بعض المتصفحات لا تكشف المفتاح: نفترض أنه صحيح
    const want = b64ToU8(publicKey);
    const a = new Uint8Array(cur);
    return a.length === want.length && a.every((v, i) => v === want[i]);
  }

  // بعد تسجيل الدخول: نربط الجهاز المشترك مسبقاً بالمستخدم الحالي
  async function sync() {
    if (!supported || Notification.permission !== 'granted' || !userId()) return;
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg && await reg.pushManager.getSubscription();
    if (!sub) { enable().catch(() => {}); return; }   // الإذن ممنوح مسبقاً: اشتراك صامت
    try {
      const k = await (await fetch('/api/push/public-key')).json();
      // اشتراك قديم بمفتاح VAPID مختلف => لا نرسله للسيرفر، نعيد الاشتراك بالمفتاح الجديد
      if (k && k.publicKey && !sameKey(sub, k.publicKey)) {
        await sub.unsubscribe();
        await enable();
        return;
      }
    } catch (e) {}
    send(sub).catch(() => {});
  }

  async function install() {
    if (!deferredInstall) return false;
    deferredInstall.prompt();
    const r = await deferredInstall.userChoice;
    deferredInstall = null;
    return r && r.outcome === 'accepted';
  }

  window.SoulPush = { supported, enable, disable, sync, install, canInstall: () => !!deferredInstall, permission: () => (supported ? Notification.permission : 'unsupported') };

  registerSW();
  let tries = 0, synced = '';
  const iv = setInterval(() => {
    const id = userId();
    if (id && id !== synced) { synced = id; sync(); maybeAsk(); }
    if (++tries > 600) clearInterval(iv);
  }, 3000);

  // تفعيل مباشر: أول لمسة بعد تسجيل الدخول تطلب إذن النظام فوراً (المتصفح يمنع الطلب بدون لمسة المستخدم)
  let armed = false;
  function maybeAsk() {
    if (!supported || armed || Notification.permission !== 'default') return;
    armed = true;
    const go = () => {
      document.removeEventListener('pointerdown', go, true);
      document.removeEventListener('keydown', go, true);
      enable().catch(() => {});
    };
    document.addEventListener('pointerdown', go, true);
    document.addEventListener('keydown', go, true);
  }
})();
