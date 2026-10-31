/* سلاسة الدردشة: تمرير مجمّع في إطار واحد، بدون قفز، وبدون إعادة حساب التخطيط مع كل رسالة */
(function () {
  'use strict';
  var NEAR = 200; // المسافة (px) من القاع التي نعتبر بعدها أن المستخدم "يقرأ الأرشيف"

  function init(stream) {
    if (stream.__sc) return stream.__sc;
    var st = { pinned: true, raf: 0 };
    stream.__sc = st;
    // نخزّن هل المستخدم عند القاع؛ نقرأه من حدث التمرير فقط (لا قراءة تخطيط عند إضافة كل رسالة)
    stream.addEventListener('scroll', function () {
      st.pinned = stream.scrollHeight - stream.scrollTop - stream.clientHeight < NEAR;
    }, { passive: true });
    // صورة/أيقونة اكتمل تحميلها بعد الإضافة وغيّرت الارتفاع: نعيد التثبيت على القاع بدل القفزة
    stream.addEventListener('load', function () { if (st.pinned) pin(stream, st); }, true);
    return st;
  }

  function pin(stream, st) {
    if (st.raf) return;
    st.raf = requestAnimationFrame(function () {
      st.raf = 0;
      if (stream.isConnected) stream.scrollTop = stream.scrollHeight;
    });
  }

  // stream: حاوية الرسائل، el: عنصر الرسالة
  // opts: force (رسالتي أنا: انزل دائماً)، max (أقصى عدد رسائل في الصفحة)، animate (حركة دخول خفيفة)
  function append(stream, el, opts) {
    opts = opts || {};
    var st = init(stream);
    if (opts.animate && el.classList) {
      el.classList.add('sc-new');
      var done = function () { el.classList.remove('sc-new'); };
      el.addEventListener('animationend', done, { once: true });
      setTimeout(done, 450);
    }
    stream.appendChild(el);
    if (opts.force) st.pinned = true;
    if (st.pinned) {
      if (opts.max) {
        var extra = stream.childElementCount - opts.max;
        while (extra-- > 0 && stream.firstElementChild && stream.firstElementChild !== el) stream.removeChild(stream.firstElementChild);
      }
      pin(stream, st);
    }
    return st.pinned;
  }

  window.SCSmooth = { append: append, pin: function (s) { pin(s, init(s)); } };
})();
