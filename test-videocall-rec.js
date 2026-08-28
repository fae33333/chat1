// اختبار منطق تركيب التسجيل (canvas) لمكالمات الفيديو:
// أبعاد مطابقة للشاشة + الكبير كاملاً (contain) + المصغر بموضع الشاشة + الحالات الخاصة
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/public/js/app.js', 'utf8');

const startMark = 'function startCallRecording(localStream, remoteStream, callType) {';
const endMark = '\nasync function uploadCallRecording(';
const i = src.indexOf(startMark);
const j = src.indexOf(endMark);
if (i < 0 || j < 0) { console.error('✖ لم يتم العثور على startCallRecording'); process.exit(1); }
const block = src.slice(i, j);

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✔ ' + label); }
  else { fail++; console.log('  ✖ ' + label); }
}
const approx = (a, b, e = 1) => Math.abs(a - b) <= e;

// ---------- mocks ----------
const ops = [];
const ctx = new Proxy({}, {
  get(t, k) {
    if (k === 'canvas') return null;
    return (...a) => { ops.push([String(k), ...a]); };
  },
  set(t, k, v) { t[k] = v; return true; }
});
const canvas = {
  width: 0, height: 0,
  getContext: () => ctx,
  captureStream: () => ({ getVideoTracks: () => [] })
};
const madeVideos = [];
const mkVideo = (vw) => {
  const v = {
    videoWidth: vw, videoHeight: vw ? Math.round(vw * 9 / 16) : 0,
    muted: true, playsInline: true, autoplay: true,
    style: { cssText: '' }, srcObject: null,
    play: () => Promise.resolve(), pause: () => {}, remove: () => {}
  };
  madeVideos.push(v);
  return v;
};
const stageRect = { left: 0, top: 0, width: 390, height: 844 };
let pipRect = { left: 14, top: 92, width: 124.8, height: 166.4 };
const stage = { getBoundingClientRect: () => stageRect };
const pipEl = { getBoundingClientRect: () => pipRect };
const overlayOpen = { value: true };
const overlay = {
  classList: { contains: c => c === 'open' && overlayOpen.value },
  querySelector: sel => sel === '.pmvc-stage' ? stage : (sel === '.pmvc-video-pip' ? pipEl : null)
};

const $ = id => (id === '#pmVideoCallOv' ? overlay : null);
const documentMock = {
  createElement: tag => tag === 'canvas' ? canvas : mkVideo(1280),
  body: { appendChild() {} }
};
class MediaStreamMock { constructor(tracks) { this._t = tracks; } getAudioTracks() { return []; } }
class MediaRecorderMock {
  constructor(stream, opts) { this.stream = stream; this.opts = opts; this.state = 'inactive'; this.ondataavailable = null; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; }
  static isTypeSupported() { return true; }
}
class AudioContextMock {
  createMediaStreamDestination() { return { stream: { getAudioTracks: () => [{}] } }; }
  createMediaStreamSource() { return { connect() {} }; }
  close() {}
}

let rafCb = null, rafId = 0, clockMs = 0;
const perfMock = { now: () => clockMs };
function rafMock(cb) { rafCb = cb; return ++rafId; }
function cafMock() { rafCb = null; }
function runFrames(n) { for (let k = 0; k < n; k++) { clockMs += 50; const cb = rafCb; rafCb = null; if (cb) cb(); } }

function setup(PM_CALL) {
  ops.length = 0;
  madeVideos.length = 0;
  canvas.width = 0; canvas.height = 0;
  rafCb = null;
  const CALL_RECORDER_box = { v: null };
  const chunks = [];
  // نحقن CALL_RECORDER / CALL_RECORDED_CHUNKS عبر إعادة توجيه:
  const wrapped = block.replace(/CALL_RECORDER = \{/, 'CALL_RECORDER_box.v = {').replace(/CALL_RECORDED_CHUNKS = \[\]/, 'chunks.length = 0').replace(/CALL_RECORDED_CHUNKS\.push/, 'chunks.push');
  const fn2 = new Function(
    'PM_CALL', '$', 'document', 'window', 'MediaStream', 'MediaRecorder', 'requestAnimationFrame', 'cancelAnimationFrame',
    'CALL_RECORDER_box', 'chunks', 'localStream', 'remoteStream', 'callType', 'performance',
    wrapped + '\nstartCallRecording(localStream, remoteStream, callType);'
  );
  const localStream = { getAudioTracks: () => [{}] };
  const remoteStream = { getAudioTracks: () => [{}] };
  fn2(
    PM_CALL, $, documentMock,
    { AudioContext: AudioContextMock, webkitAudioContext: AudioContextMock },
    MediaStreamMock, MediaRecorderMock, rafMock, cafMock,
    CALL_RECORDER_box, chunks, localStream, remoteStream, 'video', perfMock
  );
  return { box: CALL_RECORDER_box, chunks, localV: madeVideos[1], remoteV: madeVideos[0] };
}

const basePM = () => ({
  callType: 'video', peerName: 'نجم تجريبي',
  localEnlarged: false, controlsHidden: false, pipPos: null, camOff: false
});

console.log('— 1) أبعاد القماش = نسبة الشاشة (أطول ضلع 540)');
let r = setup(basePM());
ok(r.box.v !== null, 'بدأ التسجيل بنجاح');
ok(canvas.width === Math.round(390 * 540 / 844), 'width = 250 (390 مقاد)');
ok(canvas.height === 540, 'height = 540');
ok(r.box.v.recorder.opts.mimeType === 'video/webm;codecs=vp8,opus', 'mime فيديو');

console.log('— 2) إطار أول: الكبير كاملاً (contain) + المصغر بموضع الشاشة');
runFrames(1);
const cw = canvas.width, ch = canvas.height;
const mains = ops.filter(o => o[0] === 'drawImage');
ok(mains.length >= 1, 'رسم الكبير');
let m = mains[0];
ok(m[1] === r.remoteV, 'الكبير = الطرف الآخر');
// contain: s = min(333/1280, 720/720) = 0.26 → w=333, h≈185.4 — الإطار كامل بلا قص
ok(approx(m[4], 1280 * (cw / 1280)), 'عرض الكبير ممتد لملء العرض');
ok(approx(m[5], 720 * (cw / 1280), 1), 'ارتفاع الكبير بنسبته الأصلية (بدون قص)');
ok(approx(m[2], 0, 1) && approx(m[3], (ch - m[5]) / 2, 1), 'الكبير متمركز مع هامش أسود');
// المصغر: موضع الشاشة (14,92) مقاداً بأبعاد القماش
const px = (14 / 390) * cw, py = (92 / 844) * ch, pw = (124.8 / 390) * cw, ph = (166.4 / 844) * ch;
const s2 = Math.max(pw / 1280, ph / 720);
const w2 = 1280 * s2, h2 = 720 * s2;
const scIdx2 = ops.findIndex(o => o[0] === 'scale' && o[1] === -1);
ok(scIdx2 > 0, 'المصغر معكوس أفقياً (مرآة)');
const tr2 = scIdx2 > 0 ? ops[scIdx2 - 1] : null;
const pipDraw = mains[1];
ok(!!pipDraw && pipDraw[1] === r.localV, 'رسم المصغر = صورتك');
ok(approx(pipDraw[2], (pw - w2) / 2) && approx(pipDraw[3], (ph - h2) / 2), 'المصغر داخل صندوقه (cover)');
ok(tr2 && tr2[0] === 'translate' && approx(tr2[1], px + pw) && approx(tr2[2], py), 'المصغر في موضع الشاشة الفعلي');
ok(ops.some(o => o[0] === 'stroke'), 'إطار المصغر مرسوم');

console.log('— 3) الكاميرا مطفأة في المصغر → نص توضيحي');
ops.length = 0;
let pm3 = basePM(); pm3.camOff = true;
r = setup(pm3);
runFrames(1);
ok(ops.some(o => o[0] === 'fillText' && String(o[1]).includes('كاميرا مطفأة')), 'نص «كاميرا مطفأة»');

console.log('— 4) صورك الكبيرة (تبديل) → الرسم معكوس كاملاً');
ops.length = 0;
let pm4 = basePM(); pm4.localEnlarged = true;
r = setup(pm4);
runFrames(1);
const mains4 = ops.filter(o => o[0] === 'drawImage');
ok(mains4.length >= 1 && mains4[0][1] === r.localV, 'الكبير = صورتك');
const scIdx4 = ops.findIndex(o => o[0] === 'scale' && o[1] === -1);
const t4 = scIdx4 > 0 ? ops[scIdx4 - 1] : null;
ok(t4 && t4[0] === 'translate', 'عكس أفقي للصورة الكبيرة');
ok(approx(t4[1], mains4[0][2] + mains4[0][4]), 'نقطة العكس على حافة الإطار');

console.log('— 5) لم يصل الفيديو بعد → الاسم بدل «...»');
ops.length = 0;
r = setup(basePM());
r.remoteV.videoWidth = 0; r.remoteV.videoHeight = 0;
runFrames(1);
ok(ops.some(o => o[0] === 'fillText' && o[1] === 'نجم تجريبي'), 'اسم الطرف الظاهر');

console.log('— 6) الشاشة مصغّرة (overlay مغلقة) → الموضع المحفوظ pipPos');
ops.length = 0;
let pm6 = basePM();
pm6.pipPos = { fx: 0.5, fy: 0.5, fw: 0.3, fh: 0.4 };
overlayOpen.value = false;
r = setup(pm6);
runFrames(1);
const scIdx6 = ops.findIndex(o => o[0] === 'scale' && o[1] === -1);
const tr6 = scIdx6 > 0 ? ops[scIdx6 - 1] : null;
ok(tr6 && tr6[0] === 'translate', 'رسم المصغر أثناء التصغير');
ok(tr6 && approx(tr6[1], 0.5 * cw + 0.3 * cw, 1) && approx(tr6[2], 0.5 * ch, 1), 'المصغر بالموضع المحفوظ');
overlayOpen.value = true;

console.log(`\nالنتيجة: ${pass} نجح / ${fail} فشل`);
process.exit(fail ? 1 : 0);
