# توكن PO لتقليل حجب يوتيوب (بدون كوكيز)
1) تثبيت الإضافة بجانب yt-dlp:   `node setup-pot.js`   (تُحفظ في bin/yt-dlp-plugins/)
2) تشغيل خادم التوكن (اختر واحداً، المنفذ الافتراضي 4416):
   - Docker:  `docker run --name bgutil-provider -d --restart unless-stopped -p 4416:4416 brainicism/bgutil-ytdlp-pot-provider`
   - بدون Docker (يلزم Node و git):
       git clone --single-branch https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git
       cd bgutil-ytdlp-pot-provider/server && npm install && npx tsc && node build/main.js
3) أعد تشغيل سيرفر الموقع. إن كان خادم التوكن على عنوان آخر: `YTDLP_POT_BASEURL=http://127.0.0.1:4416` في .env
4) التحقق: لوحة الإدارة ← إعدادات يوتيوب ← التشخيص (حقل pot: plugin و server يجب أن يكونا true).
ملاحظة: التوكن لا يضمن تجاوز الحجب على عناوين الاستضافات؛ إن استمر الخطأ فالحل الأضمن بروكسي سكني (YTDLP_PROXY).
