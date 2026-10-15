# عناصر المتجر المُدارة من الإدارة

تبويبات المتجر التي كانت ثابتة (بطاقة التعريف، شارات، فقاعة الدردشة، مقاعد المايك، إكسسوار العلاقة، محكمة الأسرة)
أصبحت تُضاف وتُعدَّل وتُحفظ من لوحة الإدارة ← «🛍️ عناصر المتجر».

- الجدول الجديد: `store_items` (يُنشأ تلقائياً)، وعمود `users.store_equipped` للعنصر المفعّل في كل قسم.
- المسارات: `GET /api/store-items`، `POST /api/store-items/:id/buy`، `POST /api/store-items/equip`،
  و`/api/admin/store-items` (GET/POST/PUT/DELETE).
- التحديث فوري للمستخدمين عبر الحدث `admin_content_updated` (area = `store-items`).
- إن لم يوجد أي عنصر في قسم، يبقى العرض القديم (بطاقة التعريف/شارات/مقاعد المايك) أو رسالة «لا توجد عناصر».

الملفات المعدّلة: `database.js` · `server.js` · `public/admin.html` · `public/js/app.js`
