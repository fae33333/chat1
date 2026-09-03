// اختبار سلسلة صوت الطرف الآخر: تشغيل مضمون + تكبير 1.6x عند جاهزية السياق
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/public/js/app.js', 'utf8');

const startMark = 'let REMOTE_AUDIO_CTX = null';
const endMark = '\n// ===== جودة الفيديو التكيفية';
const i = src.indexOf(startMark);
const j = src.indexOf(endMark);
if (i < 0 || j < 0) { console.error('✖ لم يتم العثور على كتلة الصوت'); process.exit(1); }
const block = src.slice(i, j);

let pass = 0, fail = 0;
function ok(c, label) { if (c) { pass++; console.log('  ✔ ' + label); } else { fail++; console.log('  ✖ ' + label); } }

function makeEnv(opts = {}) {
  const env = { closed: 0 };
  class AC {
    constructor() {
      env.ctx = this;
      this.state = opts.suspended ? 'suspended' : 'running';
      this.closed = false;
      this.defersResume = !!opts.defersResume;
    }
    createMediaStreamDestination() { return { stream: { tag: 'boosted-stream' } }; }
    createMediaStreamSource() { return { connected: 0, disconnected: false, connect() { this.connected++; }, disconnect() { this.disconnected = true; } }; }
    createGain() { return { gain: { value: 0 }, connected: 0, disconnected: false, connect() { this.connected++; }, disconnect() { this.disconnected = true; } }; }
    resume() {
      if (this.defersResume) {
        setTimeout(() => { this.state = 'running'; }, 3);
      } else {
        this.state = 'running';
      }
      return Promise.resolve();
    }
    close() { this.closed = true; env.closed++; }
  }
  const el = { srcObject: null, volume: 0.65, played: 0, play() { this.played++; return Promise.resolve(); } };
  const listeners = [];
  const docMock = { addEventListener: (t, fn, o) => listeners.push({ t, fn }) };
  return { AC, el, env, docMock, listeners };
}

function makeRunner(env, pm) {
  return new Function('PM_CALL', '$', 'window', 'AudioContext', 'webkitAudioContext', 'document',
    block + '\n;return { setup: setupRemoteAudioChain, level: setRemoteAudioLevel, teardown: teardownRemoteAudioChain, ensure: ensureRemoteAudioCtx, upgrade: tryUpgradeRemoteAudioBoost, BOOST: REMOTE_AUDIO_BOOST, _state: () => ({ boosted: REMOTE_AUDIO_BOOSTED, raw: REMOTE_AUDIO_RAW, ctx: REMOTE_AUDIO_CTX, gain: REMOTE_AUDIO_GAIN, source: REMOTE_AUDIO_SOURCE }) };'
  )(pm, id => (id === '#pmRemoteAudio' ? env.el : null), { AudioContext: env.AC }, env.AC, env.AC, env.docMock);
}

(async () => {
console.log('— 1) السياق جاهز (running) → سلسلة التكبير فورية');
let env = makeEnv({});
let pm = { speakerOn: false, callType: 'video' };
let api = makeRunner(env, pm);
const rawStream = { tag: 'raw' };
api.setup(rawStream);
ok(env.el.srcObject && env.el.srcObject.tag === 'boosted-stream', 'العنصر يعرض تيار السلسلة المعزَّز');
const st1 = api._state();
ok(st1.gain && st1.gain.gain.value === 1.6, 'مضاعف الكسب 1.6 مطبق');
ok(st1.source && st1.source.connected >= 1 && st1.gain.connected >= 1, 'الاتصالات صحيحة (مصدر→كسب→مخرج)');
ok(env.el.volume === 1.0, 'حجم العنصر كامل');
ok(st1.boosted === true, 'حالة التكبير فعّالة');

console.log('— 2) السياق معلق (سياسات التشغيل التلقائي) → صوت مباشر مضمون ثم ترقية عند الجاهزية');
env = makeEnv({ suspended: true, defersResume: true });
pm = { speakerOn: false, callType: 'video' };
api = makeRunner(env, pm);
api.setup(rawStream);
ok(env.el.srcObject === rawStream, 'يُشغَّل التيار الخام مباشرة (الصوت مضمون)');
ok(env.el.volume === 0.9, 'حجم السماعة الداخلية 0.9');
ok(api._state().boosted === false, 'لم يُفعَّل التكبير بعد (السياق معلق)');
ok(env.el.played >= 1, 'تم تشغيل الصوت');
// محاكاة اكتمال الـ resume بعد لمسة المستخدم
await new Promise(r => setTimeout(r, 10));
api.upgrade();
ok(api._state().boosted === true, 'بعد جاهزية السياق: الترقية لسلسلة التكبير');
ok(env.el.srcObject && env.el.srcObject.tag === 'boosted-stream', 'العنصر انتقل للتيار المعزَّز');
ok(api._state().gain.gain.value === 1.6, 'الكسب 1.6');
// السبيكر
pm.speakerOn = true;
api.level();
ok(env.el.volume === 1.0, 'السبيكر: حجم كامل مع التكبير');

console.log('— 3) بدون WebAudio إطلاقاً → صوت مباشر');
env = makeEnv({});
pm = { speakerOn: false, callType: 'video' };
const rawNoCtx = { tag: 'raw2' };
const api3 = new Function('PM_CALL', '$', 'window', 'AudioContext', 'webkitAudioContext', 'document',
  block + '\n;return { setup: setupRemoteAudioChain, level: setRemoteAudioLevel, teardown: teardownRemoteAudioChain, _state: () => ({ boosted: REMOTE_AUDIO_BOOSTED }) };'
)(pm, id => (id === '#pmRemoteAudio' ? env.el : null), {}, undefined, undefined, env.docMock);
api3.setup(rawNoCtx);
ok(env.el.srcObject === rawNoCtx, 'العنصر يعرض التيار الخام');
ok(env.el.volume === 0.9, 'حجم 0.9');
pm.speakerOn = true;
api3.level();
ok(env.el.volume === 1.0, 'السبيكر 1.0');

console.log('— 4) التفكيك عند إنهاء المكالمة');
env = makeEnv({});
pm = { speakerOn: false, callType: 'video' };
api = makeRunner(env, pm);
api.setup(rawStream);
api.teardown();
ok(env.env.closed === 1, 'أُغلق السياق الصوتي');
ok(api._state().boosted === false && api._state().raw === null, 'تصفير حالة الصوت');
// مكالمة جديدة بعد التفكيك تعمل من جديد
api.setup(rawStream);
ok(api._state().boosted === true, 'مكالمة جديدة: التكبير عاد للعمل');

console.log('— 5) مستمع اللمسات العالمية مسجل (ترقية عند أول نقرة)');
ok(env.listeners.some(l => l.t === 'pointerdown'), 'مسجل pointerdown على document');

console.log('— 6) مكالمة صوتية: الحجم المباشر كما كان (0.65 داخلية / 1.0 سبيكر)');
env = makeEnv({});
pm = { speakerOn: false, callType: 'audio' };
api = makeRunner(env, pm);
api.level();
ok(env.el.volume === 0.65, 'السماعة الداخلية 0.65 (كالحالة الأصلية)');
pm.speakerOn = true;
api.level();
ok(env.el.volume === 1.0, 'السبيكر 1.0');
ok(api._state().boosted === false, 'لا سلسلة تكبير لمكالمة صوتية');

console.log(`\nالنتيجة: ${pass} نجح / ${fail} فشل`);
process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
