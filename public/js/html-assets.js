/* ============================================================
   دعم عناصر الإدارة بصيغة HTML (إطارات، بطاقات، خلفيات، فقاعات، مقاعد...)
   كل ملف HTML يُعرض داخل iframe معزول (sandbox="allow-scripts" بدون allow-same-origin)
   فلا يصل لكوكيز/تخزين الموقع ولا يتحكم بالصفحة الأم، ولا يستقبل نقرات (pointer-events:none).
   ============================================================ */
(function () {
  'use strict';
  var HTML_RE = /\.html?(\?|#|$)/i;

  function isHtml(u) { return HTML_RE.test(String(u || '')); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  // نص iframe جاهز للإدراج داخل قوالب HTML النصية
  function iframeTag(url, cls, style) {
    return '<iframe src="' + esc(url) + '" class="' + esc(cls || 'sc-html-thumb') + '" sandbox="allow-scripts" scrolling="no" allowtransparency="true" loading="lazy" referrerpolicy="no-referrer" tabindex="-1" aria-hidden="true"' + (style ? ' style="' + esc(style) + '"' : '') + '></iframe>';
  }

  // مصغّر داخل قوائم المتجر/الإدارة (يملأ الحاوية)
  function thumb(url) { return iframeTag(url, 'sc-html-thumb'); }

  function makeLayer(url) {
    var f = document.createElement('iframe');
    f.className = 'sc-html-layer';
    f.src = url;
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('scrolling', 'no');
    f.setAttribute('allowtransparency', 'true');
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('tabindex', '-1');
    f.setAttribute('aria-hidden', 'true');
    return f;
  }

  // يضع الـ HTML كطبقة خلف محتوى العنصر (فقاعة، بطاقة، خلفية...)
  function attach(host, url) {
    if (!host || !isHtml(url)) return null;
    detach(host);
    try { if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch (e) {}
    host.classList.add('sc-has-html-layer');
    var layer = makeLayer(url);
    host.insertBefore(layer, host.firstChild);
    return layer;
  }

  function detach(host) {
    if (!host) return;
    var old = host.querySelectorAll(':scope > .sc-html-layer');
    for (var i = 0; i < old.length; i++) old[i].remove();
    host.classList.remove('sc-has-html-layer');
  }

  window.SCHtml = { isHtml: isHtml, iframeTag: iframeTag, thumb: thumb, attach: attach, detach: detach, makeLayer: makeLayer };
})();
