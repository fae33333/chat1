// اختبار مؤشر «يتحدث الآن»: تحليل مستوى الصوت + إظهار/إخفاء التوهج حول صورة المتكلم
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/public/js/app.js', 'utf8');

const startMark = 'let BCAST_LEVEL_CTX = null;';
const endMark = '\nfunction bcastResetState() {';
const i = src.indexOf(startMark);
const j = src.indexOf(endMark);
if (i < 0 || j < 0) { console.error('✖ لم يتم العثور على كتلة مؤشر المتحدث'); process.exit(1); }
const block = src.slice(i, j);

let pass = 0, fail = 0;
function ok(c, label) { if (c) { pass++; console.log('  ✔ ' + label); } else { fail++; console.log('  ✖ ' + label); } }

// ===== mocks =====
let AMP = 0; // سعة الإشارة الحالية (0 = صمت)
function makeAC() {
  return {
    state: 'running',
    resume() { this.state = 'running'; return Promise.resolve(); },
    createMediaStreamSource() { return { connected: 0, connect() { this.connected++; }, disconnect() { this.disconnected = true; } }; },
    createAnalyser() {
      return {
        fftSize: 256, smoothingTimeConstant: 0,
        getByteTimeDomainData(buf) {
          for (let k = 0; k < buf.length; k++) {
            buf[k] = AMP > 0 ? 128 + Math.round(AMP * 128 * Math.sin(k / 3)) : 128;
          }
        }
      };
    }
  };
}
const MediaStreamMock = function (tracks) { this.tracks = tracks; };
MediaStreamMock.prototype.getAudioTracks = function () { return this.tracks; };

let rafCb = null;
const rafMock = cb => { rafCb = cb; return 1; };
const cafMock = () => { rafCb = null; };

function makeEl(id, cls, data) {
  const classes = new Set(cls);
  return {
    id, dataset: data,
    classList: {
      toggle: (n, on) => { on ? classes.add(n) : classes.delete(n); },
      contains: n => classes.has(n),
      add: n => classes.add(n),
      remove: n => classes.delete(n)
    }
  };
}
const chip1 = makeEl('chip1', ['lb-host-chip'], { hid: '1' });
const row2 = makeEl('row2', ['bcast-speaker-row'], { uid: '2' });
const tile3 = makeEl('bcastTile_3', [], {});
const reqCard2 = makeEl('req2', ['bcast-req-card'], { uid: '2' }); // عنصر مختلف يحمل data-uid — لا يجب أن يُعلَّم
const ALL = [chip1, row2, tile3, reqCard2];
const docMock = {
  querySelectorAll(sel) {
    return ALL.filter(el => {
      if (sel.includes('.lb-host-chip[data-hid="') && el.classList.contains('lb-host-chip')) {
        const m = sel.match(/data-hid="(\d+)"/); return m && el.dataset.hid === m[1];
      }
      if (sel.includes('.bcast-speaker-row[data-uid="') && el.classList.contains('bcast-speaker-row')) {
        const m = sel.match(/data-uid="(\d+)"/); return m && el.dataset.uid === m[1];
      }
      if (sel.includes('#bcastTile_') && el.classList.contains('lb-host-chip') === false && el.id.startsWith('bcastTile_')) {
        const m = sel.match(/#bcastTile_(\d+)/); return m && el.id === 'bcastTile_' + m[1];
      }
      return false;
    });
  }
};

const api = (() => {
  let ac = null;
  const windowMock = { get AudioContext() { return function () { ac = ac || makeAC(); return ac; }; } };
  return new Function('window', 'MediaStream', 'requestAnimationFrame', 'cancelAnimationFrame', 'document',
    block + '\n;return { levels: BCAST_LEVELS, attach: bcastLevelAttach, detach: bcastLevelDetach, detachAll: bcastLevelDetachAll, tick: bcastLevelTick };'
  )(windowMock, MediaStreamMock, rafMock, cafMock, docMock);
})();
const stream = (id) => new MediaStreamMock([{ tag: 'track-' + id }]);
let now = 0;
function tick() { now += 60; api.tick(now); }

console.log('— 1) ربط تحليل صوت مذيع (1)');
api.attach(1, stream(1));
ok(api.levels.size === 1, 'أُنشئ محلل واحد');
api.attach(1, stream(1));
ok(api.levels.size === 1, 'لا يكرر المحلل لنفس المذيع');
api.attach(2, null);
ok(api.levels.size === 1, 'لا تحليل بدون تدفق');

console.log('— 2) كلام (إشارة عالية) → التوهج يظهر حول الصورة');
AMP = 0.25;
tick(); tick();
ok(api.levels.get(1).speaking === true, 'حالة «يتحدث» نشطة');
ok(chip1.classList.contains('is-speaking'), 'شريحة المذيع 1 مضاءة');

console.log('— 3) صمت → التوهج يختفي تدريجياً');
AMP = 0;
for (let k = 0; k < 8 && api.levels.get(1).speaking; k++) tick();
ok(api.levels.get(1).speaking === false, 'حالة «يتحدث» انطفأت');
ok(!chip1.classList.contains('is-speaking'), 'الشريحة لم تعد مضاءة');

console.log('— 4) مذيعان يتحدثان معاً → كل واحد مضيء على حدة');
api.attach(2, stream(2));
api.attach(3, stream(3));
AMP = 0.2;
tick(); tick();
ok(chip1.classList.contains('is-speaking') && row2.classList.contains('is-speaking') && tile3.classList.contains('is-speaking'), 'الشريحة والصف والبلاطة مضاءة');
ok(!reqCard2.classList.contains('is-speaking'), 'بطاقة الطلب (data-uid نفسها) لم تُلمس');
AMP = 0;
for (let k = 0; k < 10; k++) tick();

console.log('— 5) إعادة بناء الشرائح تمسح الصفات → يعاد التطبيق تلقائياً');
api.attach(1, stream(1));
AMP = 0.2;
tick(); tick();
ok(chip1.classList.contains('is-speaking'), 'المؤشر مضاء');
chip1.classList.toggle('is-speaking', false); // محاكاة إعادة بناء innerHTML
for (let k = 0; k < 20; k++) tick(); // ~1.2 ثانية
ok(chip1.classList.contains('is-speaking'), 'يعاد التطبيق خلال ثانية (تحدث مستمر بلا حواف)');

console.log('— 6) مفارقة المذيع + تفكيك الكل');
api.detach(1);
ok(!chip1.classList.contains('is-speaking'), 'فُك المذيع 1 وأُطفئ مؤشره');
api.detachAll();
ok(api.levels.size === 0, 'تفكيك كل المحللين');

console.log(`\nالنتيجة: ${pass} نجح / ${fail} فشل`);
process.exit(fail ? 1 : 0);
