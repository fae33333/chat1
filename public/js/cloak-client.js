// تفعيل تعمية مسارات API على الواجهة: أي طلب إلى /api/... يُرسل تلقائياً إلى
// /s/<رمز مشفّر> بحيث لا يظهر اسم المسار الحقيقي في الشبكة أو أدوات المطور.
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

  var originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function (input, init) {
      try {
        if (typeof input === 'string') input = cloakUrl(input);
        else if (input && input.url) input = new Request(cloakUrl(input.url), input);
      } catch (e) { }
      return originalFetch.call(this, input, init);
    };
  }

  var originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    args[1] = cloakUrl(url);
    return originalOpen.apply(this, args);
  };

  if (navigator.sendBeacon) {
    var originalBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) { return originalBeacon(cloakUrl(url), data); };
  }
})();
