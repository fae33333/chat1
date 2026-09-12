// تفعيل تعمية مسارات API وأجسام الاستجابات على الواجهة:
//   1) أي طلب إلى /api/... يُرسل تلقائياً إلى /s/<رمز مشفّر> بحيث لا يظهر اسم
//      المسار الحقيقي في الشبكة أو أدوات المطور.
//   2) أي جسم استجابة قادم من مسار مُعمّى يصل مشفّراً ({"_nv":"..."} بدلاً من
//      {ok:true, admin_token:"..."}) ويُفك هنا قبل وصوله إلى كود التطبيق،
//      فيعمل r.json() و xhr.responseText كأن شيئاً لم يتغير.
(function () {
  var config = window.__API_CLOAK__;
  if (!config || !window.NujumCloak || window.__API_CLOAK_READY__) return;
  window.__API_CLOAK_READY__ = true;

  function cloakUrl(rawUrl) {
    try {
      var url = String(rawUrl == null ? '' : rawUrl);
      var absolute = /^https?:\/\//i.test(url);
      var origin = '';
      var pathAndQuery = url;
      if (absolute) {
        var parsed = new URL(url);
        if (parsed.origin !== location.origin) return rawUrl;
        origin = parsed.origin;
        pathAndQuery = parsed.pathname + parsed.search;
      }
      if (pathAndQuery.indexOf('/api/') !== 0) return rawUrl;
      var queryAt = pathAndQuery.indexOf('?');
      var pathOnly = queryAt === -1 ? pathAndQuery : pathAndQuery.slice(0, queryAt);
      var query = queryAt === -1 ? '' : pathAndQuery.slice(queryAt);
      var token = window.NujumCloak.encodeCloakedPath(config.key, pathOnly);
      return origin + config.prefix + token + query;
    } catch (e) { return rawUrl; }
  }
  window.cloakApiUrl = cloakUrl;

  function wasCloaked(rawUrl, cloakedUrl) {
    try {
      return typeof cloakedUrl === 'string' && cloakedUrl !== String(rawUrl)
        && cloakedUrl.indexOf(config.prefix) !== -1;
    } catch (e) { return false; }
  }

  // يعيد { isJson, text } إن كان الجسم غلافاً مشفّراً، و null إن لم يكن كذلك.
  function uncloakText(text) {
    if (!text || typeof text !== 'string' || text.charAt(0) !== '{') return null;
    try { return window.NujumCloak.uncloakBodyEnvelope(config.key, text); }
    catch (e) { return null; }
  }

  // ---------- fetch ----------
  var originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function (input, init) {
      var cloaked = false;
      try {
        if (typeof input === 'string') {
          var next1 = cloakUrl(input);
          cloaked = wasCloaked(input, next1);
          input = next1;
        } else if (input && input.url) {
          var next2 = cloakUrl(input.url);
          cloaked = wasCloaked(input.url, next2);
          input = new Request(next2, input);
        }
      } catch (e) { }
      var promise = originalFetch.call(this, input, init);
      if (!cloaked) return promise;
      return promise.then(function (res) {
        if (!res || res.status === 204 || res.status === 304) return res;
        return res.clone().text().then(function (raw) {
          var dec = uncloakText(raw);
          if (!dec) return res; // ليست استجابة مُعمّاة — تمرير كما هي
          var headers = new Headers();
          try {
            res.headers.forEach(function (value, name) {
              if (name.toLowerCase() !== 'content-length' && name.toLowerCase() !== 'content-type') headers.set(name, value);
            });
          } catch (e) { }
          headers.set('Content-Type', dec.isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8');
          return new Response(dec.text, { status: res.status, statusText: res.statusText, headers: headers });
        }, function () { return res; }).catch(function () { return res; });
      });
    };
  }

  // ---------- XMLHttpRequest ----------
  var xhrProto = (typeof XMLHttpRequest !== 'undefined') ? XMLHttpRequest.prototype : null;
  var originalOpen = xhrProto && xhrProto.open;
  if (originalOpen) xhrProto.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    var nextUrl = cloakUrl(url);
    this.__nujumCloaked = wasCloaked(url, nextUrl);
    args[1] = nextUrl;
    return originalOpen.apply(this, args);
  };

  function xhrDecoded(raw) {
    if (raw == null) return null;
    return uncloakText(typeof raw === 'string' ? raw : JSON.stringify(raw));
  }

  var responseTextDesc = xhrProto && Object.getOwnPropertyDescriptor(xhrProto, 'responseText');
  if (responseTextDesc && responseTextDesc.get) {
    Object.defineProperty(xhrProto, 'responseText', {
      configurable: true,
      enumerable: responseTextDesc.enumerable,
      get: function () {
        var raw = responseTextDesc.get.call(this);
        if (this.__nujumCloaked && this.readyState === 4) {
          var dec = xhrDecoded(raw);
          if (dec) return dec.text;
        }
        return raw;
      }
    });
  }

  var responseDesc = xhrProto && Object.getOwnPropertyDescriptor(xhrProto, 'response');
  if (responseDesc && responseDesc.get) {
    Object.defineProperty(xhrProto, 'response', {
      configurable: true,
      enumerable: responseDesc.enumerable,
      get: function () {
        var raw = responseDesc.get.call(this);
        if (!this.__nujumCloaked || this.readyState !== 4 || raw === null || raw === undefined) return raw;
        try {
          if (this.responseType === '' || this.responseType === 'text') {
            var dec1 = xhrDecoded(raw);
            return dec1 ? dec1.text : raw;
          }
          if (this.responseType === 'json') {
            var dec2 = xhrDecoded(raw);
            if (!dec2) return raw;
            return dec2.isJson ? JSON.parse(dec2.text) : dec2.text;
          }
        } catch (e) { }
        return raw;
      }
    });
  }

  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    var originalBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) { return originalBeacon(cloakUrl(url), data); };
  }

  // =====================================================
  //  توقيع حزم WebSocket
  // =====================================================
  // أي حدث صادر عن الواجهة يُلحق به ظرف توقيع {$$sk} يغطي اسم الحدث وكل
  // وسائطه، وأي حدث وارد من غير توقيع صالح صادر عن الخادم لا يصل إلى أي
  // مستمع في التطبيق — فلا تُقبل حزمة أُضيف إليها شيء أو لم تمر عبر الخادم.
  var SOCKET_RESERVED = { connect: 1, connect_error: 1, disconnect: 1, disconnecting: 1, error: 1, newListener: 1, removeListener: 1 };
  window.__SOCKET_SIGN_DROP__ = 0;

  function signOutgoingArgs(ev, args) {
    var ack = null;
    if (args.length && typeof args[args.length - 1] === 'function') ack = args.pop();
    args.push(window.NujumCloak.signPacketEnvelope(config.key, ev, args));
    if (ack) args.push(ack);
    return args;
  }
  // يعيد الوسائط بدون ظرف التوقيع إن كانت موقعة بصحة، و null إن لم تكن كذلك.
  // ملاحظة: الخادم عند طلب ack يُرفق دالة الرد كآخر وسيطة — تُفصل وتُعاد إلى
  // مكانها بعد التحقق حتى يبقى تسلسل الوسائط متطابقاً مع المعتاد.
  function stripVerifiedIncoming(ev, rawArgs) {
    if (!rawArgs || !rawArgs.length) return null;
    var args = rawArgs.slice();
    var ack = null;
    if (args.length && typeof args[args.length - 1] === 'function') ack = args.pop();
    var extracted = window.NujumCloak.extractPacketSignature(args);
    if (!extracted) return null;
    if (!window.NujumCloak.verifyPacketSignature(config.key, ev, extracted.args, extracted.signature)) return null;
    var payload = extracted.args;
    if (ack) payload.push(ack);
    return payload;
  }
  function dropSignedWarning(ev) {
    window.__SOCKET_SIGN_DROP__++;
    try { console.warn('🛑 [Socket sign] حزمة واردة مرفوضة (لا توقيع صالحاً أو معدّلة):', ev); } catch (e) { }
  }

  function patchClientSocket(socket) {
    if (!socket || socket.__nujumSignPatched) return socket;
    try { socket.__nujumSignPatched = true; } catch (e) { return socket; }

    // الصادر: توقيع كل حدث (مع الحفاظ على وسيطة ack الأخيرة في مكانها)
    var originalEmit = socket.emit;
    socket.emit = function (ev) {
      var args = Array.prototype.slice.call(arguments, 1);
      try {
        if (typeof ev === 'string' && ev && !SOCKET_RESERVED[ev]) args = signOutgoingArgs(ev, args);
      } catch (e) { }
      return originalEmit.apply(this, [ev].concat(args));
    };

    // الوارد: فحص التوقيع وإزالة الظرف قبل أن يرى أي مستمع الحمولة
    var originalOn = socket.on;
    socket.on = function (ev, listener) {
      if (typeof ev !== 'string' || !ev || SOCKET_RESERVED[ev] || typeof listener !== 'function')
        return originalOn.call(this, ev, listener);
      var wrapped = function () {
        var raw = Array.prototype.slice.call(arguments);
        var payload = stripVerifiedIncoming(ev, raw);
        if (payload === null) return dropSignedWarning(ev);
        return listener.apply(this, payload);
      };
      wrapped.__nujumOrig = listener;
      return originalOn.call(this, ev, wrapped);
    };
    // ملاحظة: once() في مكتبة socket.io-client تستدعي on داخلياً ← تُغطى تلقائياً.

    var originalOff = socket.off || socket.removeListener;
    if (originalOff) {
      var offWrapped = function (ev, listener) {
        if (typeof listener === 'function') {
          try {
            var candidates = (this.listeners ? this.listeners(ev) : []) || [];
            for (var i = 0; i < candidates.length; i++)
              if (candidates[i] && candidates[i].__nujumOrig === listener) return originalOff.call(this, ev, candidates[i]);
          } catch (e) { }
        }
        return originalOff.call(this, ev, listener);
      };
      try {
        if (socket.off) socket.off = offWrapped;
        if (socket.removeListener) socket.removeListener = offWrapped;
      } catch (e) { }
    }

    ['onAny', 'prependAny'].forEach(function (method) {
      var orig = socket[method];
      if (typeof orig !== 'function') return;
      socket[method] = function (listener) {
        if (typeof listener !== 'function') return orig.call(this, listener);
        var wrapped = function () {
          var raw = Array.prototype.slice.call(arguments);
          var ev = raw[0];
          var payload = stripVerifiedIncoming(ev, raw.slice(1));
          if (payload === null) return dropSignedWarning(ev);
          raw.length = 1;
          for (var i = 0; i < payload.length; i++) raw.push(payload[i]);
          return listener.apply(this, raw);
        };
        wrapped.__nujumOrig = listener;
        return orig.call(this, wrapped);
      };
    });

    return socket;
  }

  function wrapIoFactory(factory) {
    if (!factory || factory.__nujumSignWrapped) return factory;
    function wrappedIo() {
      var socket = factory.apply(this, arguments);
      try { patchClientSocket(socket); } catch (e) { }
      return socket;
    }
    try {
      Object.keys(factory).forEach(function (k) { wrappedIo[k] = factory[k]; });
    } catch (e) { }
    wrappedIo.__nujumSignWrapped = true;
    wrappedIo.wrapped = factory;
    return wrappedIo;
  }

  // window.io يُعرَّف لاحقاً (سكربت socket.io أسفل الصفحة يصل بعد هذا الملف) —
  // نعترض تعيينه بخاصية getter/setter حتى نغلّف المصنع قبل أن يستخدمه app.js.
  try {
    if (window.io) {
      window.io = wrapIoFactory(window.io);
    } else {
      var capturedIo;
      Object.defineProperty(window, 'io', {
        configurable: true,
        enumerable: true,
        get: function () { return capturedIo; },
        set: function (value) { capturedIo = wrapIoFactory(value); }
      });
    }
  } catch (e) { }
})();
