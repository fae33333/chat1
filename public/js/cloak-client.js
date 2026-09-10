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
  var originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
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

  var responseTextDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
  if (responseTextDesc && responseTextDesc.get) {
    Object.defineProperty(XMLHttpRequest.prototype, 'responseText', {
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

  var responseDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');
  if (responseDesc && responseDesc.get) {
    Object.defineProperty(XMLHttpRequest.prototype, 'response', {
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

  if (navigator.sendBeacon) {
    var originalBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) { return originalBeacon(cloakUrl(url), data); };
  }
})();
