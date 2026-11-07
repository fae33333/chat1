# الإشعارات (PWA + Web Push + VAPID)
- `push.js` (Node.js): مفاتيح VAPID تُولَّد تلقائياً وتُحفظ في `app_settings`، جداول SQLite: `push_subscriptions` و`push_log`.
- `public/sw.js` (Service Worker): استقبال الإشعارات وفتح الرابط عند النقر.
- `public/manifest.webmanifest` + أيقونات `public/img/icon-*.png`: تثبيت الموقع كتطبيق.
- `public/js/push-client.js`: الاشتراك من المتصفح، شريط تفعيل لمرة واحدة، `SoulPush.enable()/disable()/install()`.
- لوحة الإدارة ← «الإشعارات» ← «التحكم بالإشعارات» (`public/js/admin-push.js`).
- من كود السيرفر: `app.locals.sendPushToUser(userId, { title, body, url })`.
- مطلوب مرة واحدة: `npm install` (أضيفت الحزمة `web-push` إلى package.json). يلزم HTTPS (أو localhost).
