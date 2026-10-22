// حفظ الجلسة على نفس الجهاز بدون localStorage:
// تُحفظ بيانات sessionStorage (تسجيل الدخول وغيره) في ملف JSON على الخادم
// (data/device-store.json) مربوطة بكوكي الجهاز، وتعود بعد إغلاق المتصفح وإعادة فتحه.
// جهاز/متصفح آخر له كوكي مختلف، فيطلب منه تسجيل الدخول من جديد.
(function () {
  'use strict';
  var PREFIXES = ['soulchill', 'pf_', 'ppco_', 'rv_'];
  var mine = function (k) { return PREFIXES.some(function (p) { return k && k.indexOf(p) === 0; }); };
  var URL = '/api/device-store';
  var real = window.sessionStorage;
  var data = {};
  var pendingSet = {}, pendingRemove = {}, pendingClear = false, timer = null;

  // 1) تحميل البيانات من الخادم (متزامن مرة واحدة قبل بقية السكربتات)
  try {
    var x = new XMLHttpRequest();
    x.open('GET', URL, false);
    x.send();
    if (x.status === 200) data = (JSON.parse(x.responseText) || {}).data || {};
  } catch (e) {}

  // 2) ترحيل مرة واحدة: ما كان في localStorage القديم / الجلسة الحالية ينتقل لملف JSON
  try {
    var ls = window.localStorage, migrated = false, i, k;
    for (i = ls.length - 1; i >= 0; i--) {
      k = ls.key(i);
      if (mine(k)) {
        if (!(k in data)) { data[k] = ls.getItem(k); pendingSet[k] = data[k]; migrated = true; }
        ls.removeItem(k);
      }
    }
    for (i = 0; i < real.length; i++) {
      k = real.key(i);
      if (mine(k) && !(k in data)) { data[k] = real.getItem(k); pendingSet[k] = data[k]; migrated = true; }
    }
    if (migrated) schedule();
  } catch (e) {}

  function body() {
    var b = { set: pendingSet, remove: Object.keys(pendingRemove), clear: pendingClear };
    pendingSet = {}; pendingRemove = {}; pendingClear = false;
    return JSON.stringify(b);
  }
  function hasPending() { return pendingClear || Object.keys(pendingSet).length || Object.keys(pendingRemove).length; }
  function flush(unloading) {
    timer = null;
    if (!hasPending()) return;
    var b = body();
    try {
      if (unloading && navigator.sendBeacon &&
          navigator.sendBeacon(URL, new Blob([b], { type: 'application/json' }))) return;
      fetch(URL, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: b, keepalive: true })
        .catch(function () {});
    } catch (e) {}
  }
  function schedule() { if (!timer) timer = setTimeout(flush, 150); }
  window.addEventListener('pagehide', function () { flush(true); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(true); });

  var shim = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) {
      k = String(k); v = String(v);
      data[k] = v; pendingSet[k] = v; delete pendingRemove[k]; schedule();
    },
    removeItem: function (k) {
      k = String(k);
      delete data[k]; delete pendingSet[k]; pendingRemove[k] = 1; schedule();
    },
    key: function (n) { return Object.keys(data)[n] || null; },
    clear: function () { data = {}; pendingSet = {}; pendingRemove = {}; pendingClear = true; schedule(); }
  };
  Object.defineProperty(shim, 'length', { get: function () { return Object.keys(data).length; } });
  Object.defineProperty(window, 'sessionStorage', { configurable: true, get: function () { return shim; } });
})();
