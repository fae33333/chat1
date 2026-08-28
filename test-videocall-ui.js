// اختبار منطق تفاعل شاشة مكالمة الفيديو (نقر/سحب/تبديل) بدون متصفح
// يستخرج الدوال الجديدة من app.js ويحاكي عناصر DOM أساسية
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/public/js/app.js', 'utf8');

const startMark = 'function updateVideoCallLayout() {';
const endMark = '\nasync function handlePrivateCallSignal(';
const i = src.indexOf(startMark);
const j = src.indexOf(endMark);
if (i < 0 || j < 0) { console.error('✖ لم يتم العثور على كتلة الكود الجديدة في app.js'); process.exit(1); }
const block = src.slice(i, j);

// ---------- DOM mock ----------
function makeClasses(init) {
  const set = new Set(init || []);
  return {
    contains: c => set.has(c),
    add: c => set.add(c),
    remove: c => set.delete(c),
    toggle: (c, force) => {
      const want = force === undefined ? !set.has(c) : !!force;
      want ? set.add(c) : set.delete(c);
      return want;
    }
  };
}

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✔ ' + label); }
  else { fail++; console.log('  ✖ ' + label); }
}

// الشاشة الكبيرة (390x844) — نسبة هاتف عمودي
const stage = {
  classList: makeClasses(),
  clientWidth: 390, clientHeight: 844,
  offsetWidth: 390, offsetHeight: 844,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 })
};
const overlayClasses = makeClasses(['open']);
const overlay = {
  classList: overlayClasses,
  querySelector: sel => {
    if (sel === '.pmvc-stage') return stage;
    if (sel === '.pmvc-video-pip') return [remoteEl, localEl].find(v => v.classList.contains('pmvc-video-pip')) || null;
    return null;
  }
};

function makeVideo(id, cls, x0, y0) {
  const listeners = {};
  const classes = makeClasses(cls);
  const el = {
    id,
    parentElement: stage,
    offsetWidth: 170, offsetHeight: 227,
    _x0: x0, _y0: y0,
    classList: classes,
    style: {},
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    setPointerCapture: () => {},
    get offsetLeft() { return (el.style.left && el.style.left !== 'auto') ? parseFloat(el.style.left) : el._x0; },
    get offsetTop() { return (el.style.top && el.style.top !== 'auto') ? parseFloat(el.style.top) : el._y0; },
    getBoundingClientRect: () => ({
      left: el.offsetLeft, top: el.offsetTop,
      width: el.offsetWidth, height: el.offsetHeight
    }),
    fire: (t, ev) => (listeners[t] || []).forEach(fn => fn(ev))
  };
  return el;
}

// الافتراضي: الطرف الآخر كبير وكاميرتك مصغرة
const remoteEl = makeVideo('pmVideoRemote', ['pmvc-video-main'], 0, 0);
const localEl = makeVideo('pmVideoLocal', ['pmvc-video-pip'], 14, 92);

const btnStub = () => ({ onclick: null });
const camBtn = btnStub(), muteBtn = btnStub(), endBtn = btnStub(), minBtn = btnStub();
const $ = id => ({
  '#pmVideoCallOv': overlay, '#pmVideoLocal': localEl, '#pmVideoRemote': remoteEl,
  '#pmVideoCamBtn': camBtn, '#pmVideoMuteBtn': muteBtn, '#pmVideoEndBtn': endBtn, '#pmVideoMinBtn': minBtn
}[id] || null);

const PM_CALL = {
  callType: 'video', peerName: 'نجم تجريبي',
  localEnlarged: false, controlsHidden: false, pipPos: null, camOff: false
};

const noops = {
  toggleVideoCallCam() {},
  togglePrivateCallMute() {},
  endPrivateCall() {},
  minimizePrivateCall() {}
};

const run = new Function('PM_CALL', '$', 'toggleVideoCallCam', 'togglePrivateCallMute', 'endPrivateCall', 'minimizePrivateCall', block);
run(PM_CALL, $, noops.toggleVideoCallCam, noops.togglePrivateCallMute, noops.endPrivateCall, noops.minimizePrivateCall);

const tap = (el, x, y) => {
  el.fire('pointerdown', { button: 0, clientX: x, clientY: y, pointerId: 1 });
  el.fire('pointerup', { button: 0, clientX: x, clientY: y, pointerId: 1 });
};
const drag = (el, x0, y0, x1, y1) => {
  el.fire('pointerdown', { button: 0, clientX: x0, clientY: y0, pointerId: 1 });
  el.fire('pointermove', { button: 0, clientX: x1, clientY: y1, pointerId: 1, preventDefault() {} });
  el.fire('pointerup', { button: 0, clientX: x1, clientY: y1, pointerId: 1 });
};

console.log('— 1) نقر على الصورة الكبيرة → إخفاء الأزرار');
tap(remoteEl, 200, 400);
ok(PM_CALL.controlsHidden === true, 'controlsHidden = true');
ok(overlayClasses.contains('pmvc-ui-hidden'), 'الطبقة تحمل pmvc-ui-hidden');
tap(remoteEl, 200, 400);
ok(PM_CALL.controlsHidden === false, 'نقر ثانية → إظهار الأزرار');
ok(!overlayClasses.contains('pmvc-ui-hidden'), 'إزالة pmvc-ui-hidden');

console.log('— 2) نقر على المصغرة → التبديل (صوري تصبح الكبيرة)');
tap(localEl, 60, 150);
ok(PM_CALL.localEnlarged === true, 'localEnlarged = true');
ok(localEl.classList.contains('pmvc-video-main') && !localEl.classList.contains('pmvc-video-pip'), 'صورتك الآن هي الكبيرة');
ok(remoteEl.classList.contains('pmvc-video-pip') && !remoteEl.classList.contains('pmvc-video-main'), 'الطرف الآخر أصبح المصغر');

console.log('— 3) سحب المصغر (الطرف الآخر) → تحريك + حفظ الموضع النسبي');
// المصغر في الموضع الافتراضي (0,0 في المحاكاة) → السحب 80/160 = (80,160)
drag(remoteEl, 100, 150, 180, 310);
ok(remoteEl.style.insetInlineEnd === 'auto', 'أُزيل موضع CSS الافتراضي');
ok(remoteEl.style.left === '80px', 'left = 80px (0+80)');
ok(remoteEl.style.top === '160px', 'top = 160px (0+160)');
ok(PM_CALL.pipPos && Math.abs(PM_CALL.pipPos.fx - 80 / 390) < 0.01, 'pipPos.fx محفوظ');
ok(PM_CALL.pipPos && Math.abs(PM_CALL.pipPos.fy - 160 / 844) < 0.01, 'pipPos.fy محفوظ');
ok(PM_CALL.pipPos && Math.abs(PM_CALL.pipPos.fw - 170 / 390) < 0.01, 'pipPos.fw محفوظ');

console.log('— 4) سحب خارج الشاشة → حصر داخل الحدود');
drag(remoteEl, 200, 300, 5000, 5000);
ok(remoteEl.style.left === (390 - 170) + 'px', 'left محصور عند الحد الأقصى');
ok(remoteEl.style.top === (844 - 227) + 'px', 'top محصور عند الحد الأقصى');

console.log('— 5) نقر المصغر مرة أخرى → عودة التبديل مع احتفاظ المصغر الجديد بمكانه');
tap(remoteEl, 100, 100);
ok(PM_CALL.localEnlarged === false, 'localEnlarged = false');
ok(localEl.classList.contains('pmvc-video-pip'), 'صورتك عادت المصغرة');
ok(localEl.style.left === '220px' && localEl.style.top === '617px', 'المصغر الجديد ورث الموضع المخصص');
ok(remoteEl.style.left === '' && remoteEl.style.top === '', 'العنصر المكبّر خالٍ من مواضع مخصصة');

console.log('— 6) سحب فوق الصورة الكبيرة لا يحرّكها (ثابتة)');
const beforeL = remoteEl.style.left, beforeT = remoteEl.style.top;
drag(remoteEl, 100, 100, 300, 300);
ok(remoteEl.style.left === beforeL && remoteEl.style.top === beforeT, 'موضع الصورة الكبيرة لم يتغير');
ok(PM_CALL.controlsHidden === true, 'نقر/حركة على الكبيرة = تبديل إخفاء الأزرار');

console.log(`\nالنتيجة: ${pass} نجح / ${fail} فشل`);
process.exit(fail ? 1 : 0);
