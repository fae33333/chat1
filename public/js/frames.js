/* ============================================================
   SoulChill — إطارات الأفاتار المرفوعة من الإدارة
   أي عنصر يحمل الكلاس avatar-frame-cf-XXXX يُرسم فوقه إطار الصورة تلقائياً،
   فلا حاجة لتعديل الأماكن الكثيرة التي يُعرض فيها الأفاتار في app.js.
   ============================================================ */
(function () {
  'use strict';

  var CLS_RE = /(?:^|\s)avatar-frame-(cf-[\w-]+)/;
  var frames = {};          // id -> { image_url, scale }
  var rings = new Set();    // العناصر .sc-frame-ring الحالية
  var scheduled = false;
  var ready = null;

  function parseId(el) {
    var m = CLS_RE.exec(el.getAttribute('class') || '');
    return m ? m[1] : null;
  }

  // ===== ضبط تلقائي: نكتشف الفتحة الشفافة في منتصف الإطار ونطابقها مع الصورة تماماً =====
  var fitCache = new Map(); // url -> {cx, cy, hw, hh} | null (فشل) | undefined (قيد الحساب)

  function measureHole(url) {
    if (fitCache.has(url)) return;
    fitCache.set(url, undefined);
    var im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = function () {
      var res = null;
      try {
        var max = 256, k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
        var cw = Math.max(1, Math.round(im.naturalWidth * k)), ch = Math.max(1, Math.round(im.naturalHeight * k));
        var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        var cx2 = cv.getContext('2d', { willReadFrequently: true });
        cx2.drawImage(im, 0, 0, cw, ch);
        var data = cx2.getImageData(0, 0, cw, ch).data;
        var T = 40;
        var clear = function (x, y) { return data[(y * cw + x) * 4 + 3] < T; };
        // نقطة البداية: مركز الصورة، أو أقرب نقطة شفافة حوله
        var sx = -1, sy = -1, mx = Math.floor(cw / 2), my = Math.floor(ch / 2);
        var maxR = Math.floor(Math.min(cw, ch) * 0.2);
        for (var r = 0; r <= maxR && sx < 0; r++) {
          for (var dy = -r; dy <= r && sx < 0; dy++) {
            for (var dx = -r; dx <= r; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              var x = mx + dx, y = my + dy;
              if (x >= 0 && y >= 0 && x < cw && y < ch && clear(x, y)) { sx = x; sy = y; break; }
            }
          }
        }
        if (sx >= 0) {
          var seen = new Uint8Array(cw * ch), q = new Int32Array(cw * ch), qh = 0, qt = 0;
          q[qt++] = sy * cw + sx; seen[sy * cw + sx] = 1;
          var minX = sx, maxX = sx, minY = sy, maxY = sy, leaked = false;
          while (qh < qt) {
            var idx = q[qh++], px = idx % cw, py = (idx - px) / cw;
            if (px < minX) minX = px; if (px > maxX) maxX = px;
            if (py < minY) minY = py; if (py > maxY) maxY = py;
            if (px === 0 || py === 0 || px === cw - 1 || py === ch - 1) { leaked = true; break; }
            var nb = [idx - 1, idx + 1, idx - cw, idx + cw];
            for (var n = 0; n < 4; n++) {
              var ni = nb[n];
              if (ni < 0 || ni >= cw * ch || seen[ni]) continue;
              var nx = ni % cw;
              if ((n === 0 && nx === cw - 1) || (n === 1 && nx === 0)) continue;
              if (data[ni * 4 + 3] < T) { seen[ni] = 1; q[qt++] = ni; }
            }
          }
          var hw = (maxX - minX + 1) / cw, hh = (maxY - minY + 1) / ch;
          // الفتحة منطقية فقط إن كانت دائرة داخلية لا تتسرب للخارج
          if (!leaked && hw > 0.2 && hw < 0.95 && hh > 0.2 && hh < 0.95) {
            res = { cx: (minX + maxX + 1) / 2 / cw, cy: (minY + maxY + 1) / 2 / ch, hw: hw, hh: hh };
          }
        }
      } catch (e) { res = null; }
      fitCache.set(url, res);
      schedule();
    };
    im.onerror = function () { fitCache.set(url, null); };
    im.src = url;
  }

  function isHtmlUrl(u) { return /\.html?(\?|#|$)/i.test(String(u || '')); }

  // يرسم محتوى الحلقة: صورة (background) أو HTML داخل iframe معزول
  function paintRing(ring, url) {
    ring._src = url;
    if (isHtmlUrl(url)) {
      ring.style.backgroundImage = '';
      ring.innerHTML = (window.SCHtml ? window.SCHtml.iframeTag(url, '', '') : '');
    } else {
      ring.innerHTML = '';
      ring.style.backgroundImage = 'url("' + url + '")';
    }
  }

  function place(img, ring, skipResolve) {
    var w = img.offsetWidth, h = img.offsetHeight;
    if (!w || !h) { ring.style.display = 'none'; return; }
    var def = frames[ring._fid];
    var htmlFrame = !!(def && isHtmlUrl(def.image_url)); // إطار HTML: لا يوجد قياس تلقائي للفتحة
    var fit = (def && !htmlFrame) ? fitCache.get(def.image_url) : null;
    if (def && !htmlFrame && fit === undefined && !fitCache.has(def.image_url)) measureHole(def.image_url);
    ring.style.display = 'block';
    if (fit) {
      // الفتحة تساوي الصورة تماماً (مع تداخل بسيط 2% لإخفاء الحافة) والمركز على مركز الصورة
      var D = Math.min(w, h) * 0.98;
      ring.style.width = (D / fit.hw) + 'px';
      ring.style.height = (D / fit.hh) + 'px';
      ring.style.transform = 'translate(' + (-fit.cx * 100) + '%, ' + (-fit.cy * 100) + '%)';
    } else {
      var size = Math.max(w, h) * ((def && def.scale) || 1.3);
      ring.style.width = size + 'px';
      ring.style.height = size + 'px';
      ring.style.transform = '';
    }
    ring.style.left = (img.offsetLeft + w / 2) + 'px';
    ring.style.top = (img.offsetTop + h / 2) + 'px';
    if (!skipResolve) resolveOverlap(img, ring);
  }


  // ===== إبعاد الاسم (وأي عنصر مجاور) عن الإطار تلقائياً في كل الأماكن =====
  // الإطار أكبر من الصورة ويخرج عن حدودها، فيغطي الاسم/الشارات المجاورة.
  // نقيس مقدار خروج الإطار عن كل جهة، وإن كان هناك عنصر مجاور يتداخل معه
  // نزيد هامش الصورة (أو غلافها) في هذه الجهة بالمقدار اللازم فقط.
  var PAD = 4, MAXX = 80;
  var SIDES = ['Top', 'Bottom', 'Left', 'Right'];

  function restoreMargins(anchor) {
    if (!anchor || !anchor._scInline) return;
    SIDES.forEach(function (sd) { anchor.style['margin' + sd] = anchor._scInline[sd]; });
    anchor._scSig = null;
  }

  function pickAnchor(img) {
    var p = img.parentNode;
    if (p && p.nodeType === 1 && p !== document.body && p !== document.documentElement &&
        p.offsetWidth <= img.offsetWidth + 3 && p.offsetHeight <= img.offsetHeight + 3) return p;
    return img;
  }

  function collectObstacles(anchor) {
    var out = [], p = anchor.parentNode;
    function add(parent, skip) {
      if (!parent || parent.nodeType !== 1) return;
      for (var i = 0; i < parent.children.length; i++) {
        var c = parent.children[i];
        if (c === skip || c.classList.contains('sc-frame-ring')) continue;
        var cs = getComputedStyle(c);
        if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue;
        var r = c.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) out.push(r);
      }
    }
    add(p, anchor);
    if (p && p.parentNode && p.parentNode !== document.body) add(p.parentNode, p);
    return out;
  }

  function resolveOverlap(img, ring) {
    var anchor = pickAnchor(img);
    if (img._scAnchor && img._scAnchor !== anchor) restoreMargins(img._scAnchor);
    img._scAnchor = anchor; ring._anchor = anchor;
    if (!anchor._scInline) {
      anchor._scInline = { Top: anchor.style.marginTop, Bottom: anchor.style.marginBottom,
                           Left: anchor.style.marginLeft, Right: anchor.style.marginRight };
    }
    var ap = anchor.parentNode, app = ap && ap.parentNode;
    var sig = [ring._fid, img.offsetWidth, img.offsetHeight, ring.offsetWidth, ring.offsetHeight,
               ap ? ap.children.length : 0, app ? app.children.length : 0].join('|');
    if (anchor._scSig === sig) return;

    restoreMargins(anchor);                       // نقيس من الوضع الأصلي بلا هوامشنا
    var ir = img.getBoundingClientRect(), rr = ring.getBoundingClientRect();
    var over = { Top: Math.max(0, ir.top - rr.top), Bottom: Math.max(0, rr.bottom - ir.bottom),
                 Left: Math.max(0, ir.left - rr.left), Right: Math.max(0, rr.right - ir.right) };
    var extra = { Top: 0, Bottom: 0, Left: 0, Right: 0 };
    var hOv = function (o) { return o.right > rr.left && o.left < rr.right; };
    var vOv = function (o) { return o.bottom > rr.top && o.top < rr.bottom; };

    collectObstacles(anchor).forEach(function (o) {
      var gap, need;
      if (o.top >= ir.bottom - 2 && hOv(o)) {
        gap = o.top - ir.bottom; need = over.Bottom - gap + PAD; if (need > extra.Bottom) extra.Bottom = need;
      } else if (o.bottom <= ir.top + 2 && hOv(o)) {
        gap = ir.top - o.bottom; need = over.Top - gap + PAD; if (need > extra.Top) extra.Top = need;
      } else if (o.left >= ir.right - 2 && vOv(o)) {
        gap = o.left - ir.right; need = over.Right - gap + PAD; if (need > extra.Right) extra.Right = need;
      } else if (o.right <= ir.left + 2 && vOv(o)) {
        gap = ir.left - o.right; need = over.Left - gap + PAD; if (need > extra.Left) extra.Left = need;
      }
    });

    var changed = false, cs = getComputedStyle(anchor);
    SIDES.forEach(function (sd) {
      var e = Math.min(MAXX, Math.ceil(extra[sd]));
      if (e > 0) {
        var base = parseFloat(cs['margin' + sd]) || 0;
        anchor.style['margin' + sd] = (base + e) + 'px';
        changed = true;
      }
    });
    anchor._scSig = sig;
    if (changed) place(img, ring, true);          // الصورة تحركت: أعد مطابقة الإطار
  }

  function attach(img, fid) {
    var def = frames[fid];
    if (!def) return;
    var ring = img._scRing;
    if (ring && ring._fid === fid && ring.isConnected && ring.previousSibling === img) {
      if (ring._src !== def.image_url) paintRing(ring, def.image_url);
      place(img, ring);
      return;
    }
    if (ring) { restoreMargins(ring._anchor); ring.remove(); rings.delete(ring); }
    if (!img.parentNode) return;
    ring = document.createElement('i');
    ring.className = 'sc-frame-ring';
    ring._fid = fid;
    ring._img = img;
    paintRing(ring, def.image_url);
    img.parentNode.insertBefore(ring, img.nextSibling);
    img._scRing = ring;
    rings.add(ring);
    place(img, ring);
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { if (ring.isConnected) place(img, ring); });
      ro.observe(img);
      ring._ro = ro;
    }
  }

  function sweep() {
    rings.forEach(function (ring) {
      var img = ring._img;
      if (!img || !img.isConnected || parseId(img) !== ring._fid || !frames[ring._fid]) {
        if (ring._ro) ring._ro.disconnect();
        restoreMargins(ring._anchor);
        ring.remove();
        rings.delete(ring);
        if (img && img._scRing === ring) img._scRing = null;
      }
    });
  }

  function apply() {
    scheduled = false;
    if (!Object.keys(frames).length) return;
    sweep();
    var nodes = document.querySelectorAll('[class*="avatar-frame-cf-"]');
    for (var i = 0; i < nodes.length; i++) {
      var fid = parseId(nodes[i]);
      if (fid) attach(nodes[i], fid);
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || setTimeout)(apply);
  }

  function setFrames(list) {
    var next = {};
    (list || []).forEach(function (f) { if (f && f.id) next[f.id] = { image_url: f.image_url, scale: Number(f.scale) || 1.3 }; });
    frames = next;
    schedule();
  }

  function currentUserId() {
    try { var u = JSON.parse(sessionStorage.getItem('soulchill_user') || 'null'); return (u && u.id) || ''; } catch (e) { return ''; }
  }

  // تحميل قائمة الإطارات (مع owned للمستخدم الحالي)
  function reload() {
    var uid = currentUserId();
    ready = fetch('/api/avatar-frames', { headers: uid ? { 'x-user-id': uid } : {} })
      .then(function (r) { return r.ok ? r.json() : { frames: [] }; })
      .then(function (d) { setFrames(d.frames || []); return d; })
      .catch(function () { return { frames: [] }; });
    return ready;
  }

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['class']
  });
  window.addEventListener('resize', schedule);

  window.SCFrames = { reload: reload, frames: function () { return frames; }, refresh: schedule };
  reload();
})();
