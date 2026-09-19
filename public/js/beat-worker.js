// =====================================================
//  عامل النبض (Heartbeat Worker)
// =====================================================
// المتصفحات تخنق setInterval داخل الصفحة عند وضعها في الخلفية (مرة/دقيقة أو
// أقل)، لكن مؤقّت Web Worker يبقى قريباً من دقته. لذلك يعيش المؤقّت هنا
// ويرسل إشارة للصفحة، والصفحة هي من ترسل الحزمة الموقّعة عبر السوكيت.
let timer = null;

self.onmessage = (e) => {
  const data = e.data || {};
  if (data.cmd === 'start') {
    const every = Math.max(5000, +data.every || 15000);
    if (timer) clearInterval(timer);
    timer = setInterval(() => self.postMessage({ beat: true, at: Date.now() }), every);
  } else if (data.cmd === 'stop') {
    if (timer) clearInterval(timer);
    timer = null;
  }
};
