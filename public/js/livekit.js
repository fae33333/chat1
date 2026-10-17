// =========================================================
// SoulChill × LiveKit bridge
// يحمّل مكتبة livekit-client (ESM) عند الطلب، يجلب رمز الانضمام
// من الخادم (/api/livekit/token)، ويفتح غرفة LiveKit جاهزة بالمعالجة.
// البث الصوتي والمرئي المباشر (الراديو والكاميرا والميكروفون) يمر كله
// عبر LiveKit — لا WebRTC P2P بعد الآن.
// الإعدادات تُدار من الخادم فقط (app_settings / متغيرات البيئة LIVEKIT_*)
// ولا تُحفظ أي شيء في متصفح المستخدم.
// =========================================================
(function () {
  // ---------------------------------------------------------
  // إخفاء الرمز الطويل: أي عنوان wss://host:port/... أو access_token=... يظهر في
  // الكونسول أو رسائل الأخطاء يُختزل إلى wss://host:port فقط.
  // ملاحظة: ما يعرضه المتصفح نفسه في تبويب Network/رسالة "WebSocket connection failed"
  // خارج سيطرة الجافاسكربت.
  // ---------------------------------------------------------
  const WS_URL_RE = /(wss?:\/\/[^\/\s'"?#]+)(?:[\/?#][^\s'")\]]*)?/gi;
  const TOKEN_RE = /([?&]|\b)(access_token|token|auth_token)=[^&\s'")\]]+/gi;
  function redactText(str) {
    if (typeof str !== 'string') return str;
    return str.replace(WS_URL_RE, '$1').replace(TOKEN_RE, '');
  }
  function redactArg(a) {
    if (typeof a === 'string') return redactText(a);
    if (a instanceof Error) {
      const m = redactText(String(a.message || ''));
      if (m !== a.message || /access_token|wss?:\/\//i.test(String(a.stack || ''))) {
        return (a.name || 'Error') + ': ' + m;
      }
    }
    return a;
  }
  if (!window.__scConsoleRedacted) {
    window.__scConsoleRedacted = true;
    ['log', 'info', 'warn', 'error', 'debug'].forEach(k => {
      const orig = console[k];
      if (typeof orig !== 'function') return;
      console[k] = function () {
        try { return orig.apply(console, Array.prototype.map.call(arguments, redactArg)); }
        catch (e) { return orig.apply(console, arguments); }
      };
    });
  }

  const LIB_URL = '/js/vendor/livekit-client.esm.js?v=20261015';
  let libPromise = null;
  let unconfiguredToasted = false;

  function appToast(msg) {
    try {
      const fn = (window.SoulChillApp && window.SoulChillApp.showToast) || window.showToast;
      if (typeof fn === 'function') fn(msg);
      else console.warn('[LiveKit]', msg);
    } catch (e) { console.warn('[LiveKit]', msg); }
  }

  // إشعار واحد فقط لكل صفحة إن لم يكن LiveKit مهيأً بعد (لا نكرر التوست)
  function toastUnconfiguredOnce() {
    if (unconfiguredToasted) return;
    unconfiguredToasted = true;
    appToast('بث LiveKit غير مهيّأ بعد — افتح لوحة الإدارة ← تبويب «البث» وأدخل رابط LiveKit ومفتاح API وسرّه لتفعيل الصوت والصورة المباشر (الراديو والكاميرا والميكروفون).');
  }

  function sanitizeRoom(name) {
    const s = String(name || '').replace(/[^A-Za-z0-9_\-.]/g, '').slice(0, 64);
    return s.length >= 3 ? s : null;
  }

  async function fetchToken(roomName, userId, canPublish) {
    // معرّف لحظي من حالة التطبيق: تسجيل الدخول قد يكتمل بعد تهيئة المحرك (كان سبب 401)
    const liveId = (window.SoulChillApp && window.SoulChillApp.state && window.SoulChillApp.state.currentUser && window.SoulChillApp.state.currentUser.id) || '';
    const uid = (userId !== undefined && userId !== null && String(userId) !== '') ? userId : liveId;
    const res = await fetch('/api/livekit/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': String(uid || '') },
      body: JSON.stringify({ room: roomName, canPublish: canPublish !== false })
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok || !data || !data.token || !data.url) {
      if (res.status === 503) {
        toastUnconfiguredOnce();
        const err = new Error('LIVEKIT_UNCONFIGURED');
        err.code = 'LIVEKIT_UNCONFIGURED';
        throw err;
      }
      const err = new Error((data && data.error) || 'تعذر الحصول على رمز الانضمام إلى LiveKit');
      err.code = 'LIVEKIT_TOKEN_FAILED';
      throw err;
    }
    return data;
  }

  window.scLivekit = {
    // يُرجع العنوان الظاهر فقط (بدون المسار والرمز) — مثال: wss://live.chat-arab.me:8443
    safeUrl(u) { return redactText(String(u || '')); },

    // تحميل مكتبة livekit-client ESM مرة واحدة فقط
    lib() {
      if (!libPromise) {
        libPromise = import(/* LiveKit ESM bundle */ LIB_URL).catch(err => {
          libPromise = null;
          console.error('LiveKit library load failed:', err);
          const e = new Error('تعذر تحميل مكتبة LiveKit');
          e.code = 'LIVEKIT_LIB_FAILED';
          throw e;
        });
      }
      return libPromise;
    },

    // هل الخادم أبلغ أن LiveKit مهيأ؟ (للاستعلام/UI — الاشتغال يمر عبر fetchToken)
    async isConfigured() {
      try {
        const res = await fetch('/api/livekit/config');
        const d = await res.json();
        return !!(d && d.configured);
      } catch (e) { return false; }
    },

    notifyUnavailable(err) {
      if (err && err.code === 'LIVEKIT_UNCONFIGURED') { toastUnconfiguredOnce(); return; }
      if (err && err.code === 'LIVEKIT_LIB_FAILED') { appToast('تعذر تحميل مكتبة LiveKit — تحقق من اتصال الشبكة ثم أعد تحميل الصفحة.'); return; }
      console.warn('[LiveKit]', err);
    },

    // فتح غرفة LiveKit: يجلب الرمز ثم يتصل ويربط معالجات الأحداث
    // handlers: onTrackSubscribed / onTrackUnsubscribed / onParticipantConnected /
    //           onParticipantDisconnected / onConnectionStateChanged /
    //           onDisconnected / onReconnected
    async joinRoom(roomName, handlers = {}, opts = {}) {
      const room = sanitizeRoom(roomName);
      if (!room) {
        const e = new Error('اسم غرفة LiveKit غير صالح');
        e.code = 'LIVEKIT_BAD_ROOM';
        throw e;
      }
      const lk = await this.lib();
      const Room = lk.Room;
      const RoomEvent = lk.RoomEvent;
      const tok = await fetchToken(room, opts.userId, opts.canPublish);

      const r = new Room();
      const wire = (ev, fn) => { if (ev && typeof fn === 'function') r.on(ev, fn); };
      wire(RoomEvent.TrackSubscribed, (t, p, pt) => handlers.onTrackSubscribed && handlers.onTrackSubscribed(t, p, pt));
      wire(RoomEvent.TrackUnsubscribed, (t, p, pt) => handlers.onTrackUnsubscribed && handlers.onTrackUnsubscribed(t, p, pt));
      wire(RoomEvent.ParticipantConnected, (p) => handlers.onParticipantConnected && handlers.onParticipantConnected(p));
      wire(RoomEvent.ParticipantDisconnected, (p) => handlers.onParticipantDisconnected && handlers.onParticipantDisconnected(p));
      wire(RoomEvent.ConnectionStateChanged, (s) => handlers.onConnectionStateChanged && handlers.onConnectionStateChanged(s));
      wire(RoomEvent.Disconnected, (reason) => handlers.onDisconnected && handlers.onDisconnected(reason));
      if (RoomEvent.Reconnected) wire(RoomEvent.Reconnected, () => handlers.onReconnected && handlers.onReconnected());
      // المتصفح منع/سمح بتشغيل الصوت التلقائي (autoplay) — يُعاد تشغيل العناصر المتوقفة عند السماح
      if (RoomEvent.AudioPlaybackStatusChanged) wire(RoomEvent.AudioPlaybackStatusChanged, (canPlay) => handlers.onAudioPlaybackChanged && handlers.onAudioPlaybackChanged(canPlay));

      try {
        await r.connect(tok.url, tok.token);
      } catch (err) {
        try { r.disconnect(); } catch (e) {}
        if (err && String(err.message || '').includes('UNAUTHORIZED')) {
          toastUnconfiguredOnce();
          const e2 = new Error('LIVEKIT_UNCONFIGURED');
          e2.code = 'LIVEKIT_UNCONFIGURED';
          throw e2;
        }
        console.error('LiveKit connect failed:', err);
        const e3 = new Error('تعذر الاتصال بغرفة LiveKit');
        e3.code = 'LIVEKIT_CONNECT_FAILED';
        throw e3;
      }
      return r;
    }
  };
})();
