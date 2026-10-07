# تعديلات الغرفة والتحكم (مطابقة لفيديو تحكم ادمن الغرفة)

ملفات جديدة:
- public/css/room-video.css
- public/js/room-video.js

ملفات معدلة:
- server.js  : نقاط API جديدة (seat-options, seat-count, profile, background, image, chat-settings, seat-settings)،
               أحداث socket: admin_mute_all_seats, invite_to_seat، وخيار الصعود للأعضاء فقط.
- database.js: أعمدة rooms: bg_image, chat_settings, seat_settings, seat_unlocks
- public/js/app.js   : دعم حتى 15 مقعد + تعريض دوال إضافية في SoulChillApp
- public/index.html  : ربط الملفين الجديدين

التشغيل: npm install ثم node server.js
ملاحظة: خيارات المقاعد 3/5/9/15 تشمل مقعد المضيف. 9 تحتاج 10 أعضاء، و15 تكلف 49990 كريستال (من الفيديو).
