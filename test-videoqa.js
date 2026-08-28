// اختبار محرك جودة الفيديو التكيفية (أخف: 180p بداية، 360p كحد أقصى + فحص ضغط الجهاز)
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/public/js/app.js', 'utf8');

const startMark = 'const VIDEO_QUALITY_LEVELS = [';
const endMark = '\n// ===== تفاعل شاشة مكالمة الفيديو =====';
const i = src.indexOf(startMark);
const j = src.indexOf(endMark);
if (i < 0 || j < 0) { console.error('✖ لم يتم العثور على كتلة محرك الجودة'); process.exit(1); }
const block = src.slice(i, j);

let pass = 0, fail = 0;
function ok(c, label) { if (c) { pass++; console.log('  ✔ ' + label); } else { fail++; console.log('  ✖ ' + label); } }

// mocks
const applied = [];
const badge = { style: { display: '' }, textContent: '' };
const $ = id => (id === '#pmVideoQuality' ? badge : null);
let timerId = 0;
const setIntervalMock = (fn, ms) => { VIDEO_QA.fn = fn; return ++timerId; };
const clearIntervalMock = () => { VIDEO_QA.fn = null; };
const VIDEO_QA = { fn: null };

const pm = {
  callType: 'video',
  localStream: { getVideoTracks: () => [{ applyConstraints: c => { applied.push(c); return Promise.resolve(); } }] },
  pc: null, qa: null, qaLevel: null
};

const API = new Function('PM_CALL', '$', 'setInterval', 'clearInterval',
  block + '\n;return { start: startVideoQualityMonitor, stop: stopVideoQualityMonitor, tick: videoQualityTick, LEVELS: VIDEO_QUALITY_LEVELS, START: VIDEO_QA_START };'
)(pm, $, setIntervalMock, clearIntervalMock);

function stats(targetBps, framesDropped, packetsLost, jitter, outFps) {
  return {
    forEach: cb => {
      cb({ type: 'candidate-pair', state: 'succeeded', nominated: true, targetBitrate: targetBps });
      cb({ type: 'inbound-rtp', kind: 'video', framesDropped, packetsLost, jitter });
      if (outFps !== undefined) cb({ type: 'outbound-rtp', kind: 'video', framesPerSecond: outFps });
    }
  };
}
const setStats = (t, d, l, j, f) => { pm.pc = { getStats: async () => stats(t, d, l, j, f) }; };

(async () => {
  console.log('— 0) جدول المستويات: الأخف 180p بداية، 360p كحد أقصى');
  ok(API.LEVELS.length === 3, 'ثلاثة مستويات');
  ok(API.LEVELS[0].w === 320 && API.LEVELS[0].h === 180, 'المستوى 0 = 180p');
  ok(API.LEVELS[2].w === 640 && API.LEVELS[2].h === 360, 'الحد الأقصى 360p');
  ok(API.START === 0, 'يبدأ بالأخف (180p)');

  console.log('— 1) بدء المراقبة → تطبيق 180p مباشرة');
  setStats(2000000, 0, 0, 0.01, 30);
  API.start();
  ok(pm.qaLevel === 0, 'المستوى الحالي 0 (180p)');
  ok(applied.length === 1 && applied[0].width.ideal === 320 && applied[0].height.ideal === 180, 'طُبّقت 320x180');

  console.log('— 2) شبكة قوية + الجهاز يمشي 180p بسلاسة → صعود تدريجي إلى 360p');
  setStats(2000000, 0, 0, 0.01, 15);
  await API.tick(); // الفترة 2
  ok(pm.qaLevel === 0, 'لم تصعد بعد');
  await API.tick(); await API.tick(); // الفترة 3
  ok(pm.qaLevel === 1, 'صعدت إلى 270p');
  ok(applied[applied.length - 1].width.ideal === 480, 'طُبّقت 480x270');
  setStats(2000000, 0, 0, 0.01, 20);
  await API.tick(); await API.tick(); await API.tick();
  ok(pm.qaLevel === 2, 'صعدت إلى الحد الأقصى 360p');
  ok(applied[applied.length - 1].width.ideal === 640 && applied[applied.length - 1].height.ideal === 360, 'طُبّقت 640x360');

  console.log('— 3) الهاتف يثقل (إطارات التشفير 8 من 20) → تخفيض فوري');
  setStats(2000000, 0, 0, 0.01, 8);
  await API.tick();
  ok(pm.qaLevel === 1, 'تخفيض فوري إلى 270p رغم قوة الشبكة');
  setStats(2000000, 0, 0, 0.01, 10);
  await API.tick();
  ok(pm.qaLevel === 0, 'يتكرر التخفيض عند استمرار الثقل');

  console.log('— 4) هبوط الشبكة (200kbps) → المستوى الاقتصادي');
  setStats(200000, 0, 0, 0.01, 15);
  await API.tick();
  ok(pm.qaLevel === 0, 'الشبكة الضعيفة → 180p');

  console.log('— 5) هبوط حاد (100kbps + إطارات مهدورة) → لا نزول تحت الاقتصاد');
  pm.qa.level = 1; pm.qaLevel = 1; pm.qa.lastDropped = 0; pm.qa.lastLost = 0;
  setStats(100000, 12, 0, 0.01, 20);
  await API.tick();
  ok(pm.qaLevel === 0, 'يبقى في المستوى الأدنى');

  console.log(`\nالنتيجة: ${pass} نجح / ${fail} فشل`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
