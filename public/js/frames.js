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

  function place(img, ring) {
    var w = img.offsetWidth, h = img.offsetHeight;
    if (!w || !h) { ring.style.display = 'none'; return; }
    var def = frames[ring._fid];
    var size = Math.max(w, h) * ((def && def.scale) || 1.3);
    ring.style.display = 'block';
    ring.style.width = size + 'px';
    ring.style.height = size + 'px';
    ring.style.left = (img.offsetLeft + w / 2) + 'px';
    ring.style.top = (img.offsetTop + h / 2) + 'px';
  }

  function attach(img, fid) {
    var def = frames[fid];
    if (!def) return;
    var ring = img._scRing;
    if (ring && ring._fid === fid && ring.isConnected && ring.previousSibling === img) {
      if (ring._src !== def.image_url) { ring.style.backgroundImage = 'url("' + def.image_url + '")'; ring._src = def.image_url; }
      place(img, ring);
      return;
    }
    if (ring) { ring.remove(); rings.delete(ring); }
    if (!img.parentNode) return;
    ring = document.createElement('i');
    ring.className = 'sc-frame-ring';
    ring._fid = fid;
    ring._img = img;
    ring._src = def.image_url;
    ring.style.backgroundImage = 'url("' + def.image_url + '")';
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
    try { var u = JSON.parse(localStorage.getItem('soulchill_user') || 'null'); return (u && u.id) || ''; } catch (e) { return ''; }
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
