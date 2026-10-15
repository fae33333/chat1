/* ============================================================
   SoulChill — تذبذبات زرقاء حول صورة صاحب المقعد
   تتحرك حسب مستوى الصوت الحقيقي (الكلام + الأغنية) لحظة بلحظة:
   - صوتي أنا: من تحليل الميكروفون + تحليل الأغنية التي أشغّلها
   - صوت الآخرين: من تحليل البث القادم عبر WebRTC (يتضمن موسيقاهم)
   - احتياطي: إشارة "يتحدث" القادمة من السيرفر إن تعذر التحليل
   ============================================================ */
(function () {
  'use strict';

  var sources = new Map();   // key -> { uid, kind, an, buf, active, cleanup }
  var users = new Map();     // uid -> { level, hist, speaking, raw, n, rings }
  var resolver = null;
  var ac = null;
  var timer = 0;

  function getCtx() {
    if (!ac) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      try { ac = new C(); } catch (e) { return null; }
    }
    if (ac.state === 'suspended') ac.resume().catch(function () {});
    return ac;
  }

  ['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, function () {
      if (ac && ac.state === 'suspended') ac.resume().catch(function () {});
    }, { passive: true });
  });

  function keyOf(uid, kind) { return String(uid) + '|' + kind; }

  function removeSource(key) {
    var s = sources.get(key);
    if (!s) return;
    try { if (s.cleanup) s.cleanup(); } catch (e) {}
    sources.delete(key);
  }

  function addSource(uid, kind, an, active, cleanup) {
    var key = keyOf(uid, kind);
    removeSource(key);
    sources.set(key, {
      uid: String(uid), kind: kind, an: an, active: active || null, cleanup: cleanup || null,
      buf: new Uint8Array(an.fftSize)
    });
    start();
  }

  // محلّل جاهز (ميكروفوني / الأغنية التي أشغّلها)
  function watchAnalyser(uid, analyser, kind, active) {
    if (!uid || !analyser) return;
    addSource(uid, kind || 'an', analyser, active, null);
  }

  // بث صوتي كامل (صوت الآخرين عبر WebRTC)
  function watchStream(uid, stream, kind) {
    if (!uid || !stream) return;
    try {
      if (!stream.getAudioTracks || !stream.getAudioTracks().length) return;
      var c = getCtx();
      if (!c) return;
      var src = c.createMediaStreamSource(stream);
      var an = c.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0.4;
      src.connect(an); // لا نوصله بالمخرج حتى لا يتكرر الصوت
      addSource(uid, kind || 'stream', an, null, function () {
        try { src.disconnect(); } catch (e) {}
      });
    } catch (e) { /* تجاهل: يعمل الاحتياطي */ }
  }

  function unwatch(uid, kind) { removeSource(keyOf(uid, kind)); }

  function unwatchUser(uid) {
    var prefix = String(uid) + '|';
    Array.from(sources.keys()).forEach(function (k) { if (k.indexOf(prefix) === 0) removeSource(k); });
  }

  function unwatchKind(kind) {
    Array.from(sources.entries()).forEach(function (e) { if (e[1].kind === kind) removeSource(e[0]); });
  }

  // احتياطي: إشارة تحدّث من السيرفر
  function setRemoteStatus(uid, isSpeaking) {
    if (!uid) return;
    var u = ensureUser(String(uid));
    u.speaking = !!isSpeaking;
    start();
  }

  // حالة «تشغيل أغنية» لصاحب المقعد: تضمن ظهور التذبذبات عند الجميع حتى لو تعذر تحليل الصوت
  function setMusicStatus(uid, isPlaying) {
    if (!uid) return;
    var u = ensureUser(String(uid));
    u.music = !!isPlaying;
    start();
  }

  function setResolver(fn) { resolver = fn; }

  function ensureUser(uid) {
    var u = users.get(uid);
    if (!u) {
      u = { level: 0, hist: [], speaking: false, raw: 0, n: 0, rings: null };
      users.set(uid, u);
    }
    return u;
  }

  function measure(s) {
    try {
      s.an.getByteTimeDomainData(s.buf);
    } catch (e) { return 0; }
    var sum = 0, n = s.buf.length;
    for (var i = 0; i < n; i++) {
      var v = (s.buf[i] - 128) / 128;
      sum += v * v;
    }
    var rms = Math.sqrt(sum / n);
    var x = (rms - 0.012) * 5.5;
    if (x <= 0) return 0;
    return Math.min(1, Math.pow(x, 0.75));
  }

  function ensureRings(el) {
    var root = null;
    for (var i = 0; i < el.children.length; i++) {
      if (el.children[i].classList && el.children[i].classList.contains('vr-rings')) { root = el.children[i]; break; }
    }
    if (!root) {
      root = document.createElement('div');
      root.className = 'vr-rings';
      for (var k = 0; k < 3; k++) root.appendChild(document.createElement('span'));
      el.appendChild(root);
    }
    return root;
  }

  function paint(uid, u) {
    var el = resolver ? resolver(uid) : null;
    if (!el) return;
    var root = ensureRings(el);
    var peak = 0;
    for (var h = 0; h < u.hist.length; h++) if (u.hist[h] > peak) peak = u.hist[h];
    if (peak < 0.03) { if (root.classList.contains('on')) root.classList.remove('on'); return; }
    if (!root.classList.contains('on')) root.classList.add('on');
    var kids = root.children;
    for (var i = 0; i < 3; i++) {
      // كل حلقة تتبع مستوى الصوت بتأخير بسيط فتبدو كموجة تنتشر للخارج
      var L = u.hist[Math.min(u.hist.length - 1, i * 5)] || 0;
      var base = 1.16 + i * 0.1;
      var amp = 0.14 + i * 0.09;
      var scale = base + amp * L;
      var op = Math.min(1, L * 1.8) * (0.95 - i * 0.22);
      var node = kids[i];
      node.style.transform = 'scale(' + scale.toFixed(3) + ')';
      node.style.opacity = op.toFixed(3);
    }
  }

  function tick() {
    timer = 0;
    var now = performance.now();

    users.forEach(function (u) { u.raw = 0; u.n = 0; });
    sources.forEach(function (s) {
      var lv = 0;
      if (!s.active || s.active()) lv = measure(s);
      var u = ensureUser(s.uid);
      if (lv > u.raw) u.raw = lv;
      u.n++;
    });

    users.forEach(function (u, uid) {
      var target = u.raw;
      if (!u.n && u.speaking) target = 0.35 + 0.2 * Math.sin(now / 130) + 0.1 * Math.sin(now / 53);
      else if (u.music && u.raw < 0.12) target = Math.max(u.raw, 0.3 + 0.16 * Math.sin(now / 170) + 0.08 * Math.sin(now / 61));
      u.level += (target > u.level ? 0.65 : 0.14) * (target - u.level);
      if (u.level < 0.002) u.level = 0;
      u.hist.unshift(u.level);
      if (u.hist.length > 24) u.hist.length = 24;
      paint(uid, u);
      if (!u.n && !u.speaking && !u.music && u.level === 0 && u.hist.every(function (v) { return v === 0; })) users.delete(uid);
    });

    if (sources.size || users.size) schedule();
  }

  function schedule() {
    if (timer) return;
    if (document.hidden) { timer = setTimeout(tick, 400); return; }
    timer = requestAnimationFrame(tick);
  }

  function start() { schedule(); }

  function reset() {
    Array.from(sources.keys()).forEach(removeSource);
    users.clear();
  }

  window.voiceRings = {
    setResolver: setResolver,
    watchAnalyser: watchAnalyser,
    watchStream: watchStream,
    unwatch: unwatch,
    unwatchUser: unwatchUser,
    unwatchKind: unwatchKind,
    setRemoteStatus: setRemoteStatus,
    setMusicStatus: setMusicStatus,
    reset: reset
  };
})();
