// حفظ الجلسة على نفس الجهاز: يجعل sessionStorage يُخزَّن في localStorage
// حتى يبقى تسجيل الدخول (Gmail أو غيره) بعد إغلاق المتصفح وإعادة فتحه.
// جهاز/متصفح آخر له تخزين منفصل، فيطلب منه تسجيل الدخول من جديد.
(function () {
  'use strict';
  try {
    var ls = window.localStorage;
    ls.setItem('__sc_t', '1'); ls.removeItem('__sc_t');
    var real = window.sessionStorage;
    var PREFIXES = ['soulchill', 'pf_', 'ppco_', 'rv_'];
    var mine = function (k) { return PREFIXES.some(function (p) { return k && k.indexOf(p) === 0; }); };

    // ترحيل مرة واحدة: ما كان محفوظاً في الجلسة الحالية ينتقل للتخزين الدائم
    try {
      for (var i = 0; i < real.length; i++) {
        var k = real.key(i);
        if (mine(k) && ls.getItem(k) === null) ls.setItem(k, real.getItem(k));
      }
    } catch (e) {}

    var shim = {
      getItem: function (k) { return ls.getItem(k); },
      setItem: function (k, v) { ls.setItem(k, String(v)); },
      removeItem: function (k) { ls.removeItem(k); },
      key: function (i) { return ls.key(i); },
      clear: function () {
        for (var j = ls.length - 1; j >= 0; j--) {
          var kk = ls.key(j);
          if (mine(kk)) ls.removeItem(kk);
        }
      }
    };
    Object.defineProperty(shim, 'length', { get: function () { return ls.length; } });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: function () { return shim; } });
  } catch (e) { /* إن فشل، يبقى sessionStorage الأصلي */ }
})();
