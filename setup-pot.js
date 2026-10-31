/* تثبيت إضافة bgutil (توكن PO) بجانب yt-dlp:  node setup-pot.js
   تنزّل الإضافة إلى bin/yt-dlp-plugins/ — ثم شغّل خادم التوكن (Docker أو Node) كما في CHANGES_POT.md */
'use strict';
const fs = require('fs');
const path = require('path');
(async () => {
  const dir = path.join(__dirname, 'bin', 'yt-dlp-plugins');
  fs.mkdirSync(dir, { recursive: true });
  const url = 'https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/latest/download/bgutil-ytdlp-pot-provider.zip';
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error('تعذر التنزيل: HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000 || buf.slice(0, 2).toString() !== 'PK') throw new Error('الملف المنزَّل ليس zip صالحاً');
  const out = path.join(dir, 'bgutil-ytdlp-pot-provider.zip');
  fs.writeFileSync(out, buf);
  console.log('✅ تم تثبيت الإضافة:', out, '(' + Math.round(buf.length / 1024) + ' KB)');
  console.log('الخطوة التالية: شغّل خادم التوكن (راجع CHANGES_POT.md) ثم أعد تشغيل السيرفر.');
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
