# 🎙️ LiveKit على دومينك الخاص — `wss://live.chat-arab.me:8443`

هذا الدليل يستبدل **LiveKit Cloud** بخادم LiveKit مُستضاف على خادمك، على نفس نطاقك
بمنفذ **8443**، وبعدها يربطه بلوحة إدارة SoulChill ليصبح هو مسار البث الصوتي والمرئي
(الميكروفونات والكاميرات والبث المشترك والمكالمات والتوافق الصوتي).

## ماذا ستحتاج

| المطلوب | التفاصيل |
|---|---|
| سجل DNS | `A` : `live` ← IP خادمك (يُنتج `live.chat-arab.me`) |
| منافذ مفتوحة (جدار ناري + Security Group) | **TCP 8443** (إشارة WSS) · **UDP 50000-60000** (الوسائط — بلاها لا صوت ولا صورة) · **TCP 7881** (احتياط لمن يحجب UDP) · **TCP 80/443** (إصدار الشهادة) |
| بيئة تشغيل | Docker + إضافة `docker compose` · nginx **أو** Caddy |
| شهادة TLS | لنطاق `live.chat-arab.me` (إجبارية — الصفحة HTTPS فلا يُقبل `ws://`) |

##1) الشهادة (TLS)

```bash
# مع nginx (الأساس):
certbot --nginx -d live.chat-arab.me

# أو مع Caddy: يحصل عليها تلقائياً عند أول تشغيل — لا يحتاج certbot
```

##2) وِلّد مفاتيح API واحفظها

1. الإدارة ← تبويب **🎙️ LiveKit** ← زر **🎲 توليد** ← **💾 حفظ وتفعيل فوري**.
2. من نافذة **Generated API key** انسخ: **API key** و **API secret** (تظهر مرة واحدة فقط!).
3. ضعهما في `livekit.yaml` داخل:
   ```yaml
   keys:
     APIxxxxxxxx: THE_SECRET_YOU_COPIED
   ```
   (نفس الحرفين تمامًا — أي اختلاف ⇦ خطأ401/UNAUTHORIZED).

##3) شغّل LiveKit

```bash
cd deploy/livekit
docker compose up -d
docker compose logs -f     # توقّع سطراً: "starting LiveKit server" بلا أخطاء
```

بدون Docker:
```bash
livekit-server --config deploy/livekit/livekit.yaml
```

##4) بوابة WSS (اختر واحداً)

**① nginx** — انسخ `nginx.conf` إلى `/etc/nginx/conf.d/live.chat-arab.me.conf` ثم:
```bash
nginx -t && systemctl reload nginx
```

**② Caddy** — انسخ محتوى `Caddyfile` إلى `/etc/caddy/Caddyfile` ثم `systemctl reload caddy`.

النتيجة في الحالتين: `wss://live.chat-arab.me:8443` ← (proxy) ← `127.0.0.1:7880`.

##5) اربطه بتطبيق SoulChill

1. الإدارة ← تبويب **🎙️ LiveKit**.
2. **Websocket URL**: `wss://live.chat-arab.me:8443`
3. المفاتيح محفوظة من الخطوة2 (اترك **API secret** فارغاً — يحتفظ بالمحفوظ).
4. **💾 حفظ وتفعيل فوري** — ينضم كل من في الغرف لحظة الحفظ بلا إعادة تشغيل.

##6) التحقق

```bash
curl -vk https://live.chat-arab.me:8443/     # يُصلح الشهادة ويتصل بالـ proxy
```
ثم افتح غرفة في التطبيق: لا أخطاء في Console، يُسمع الصوت ويظهر بثّ الكاميرا.

## استبدال LiveKit Cloud

إن كنت تستخدم حالياً `wss://xxxx.livekit.cloud`: لا شيء في الكود يتغيّر —
غيّر **Websocket URL** فقط إلى `wss://live.chat-arab.me:8443` واستخدم مفاتيح
خادمك الجديد (مفاتيح السحابة لا تعمل مع خادمك العكسي).

## استكشاف الأخطاء

| العَرَض | السبب الأرجح | الحل |
|---|---|---|
|401 / UNAUTHORIZED عند الانضمام | مفتاح `livekit.yaml` ≠ لوحة الإدارة | طابق `keys:` حرفياً ثم `docker compose restart livekit` |
| الاتصال ينجح ولا صوت/صورة | منفذ الوسائط مغلق | افتح **UDP 50000-60000** في الجدار الناري ومجموعة أمان السحابة |
| فشل الشهادة في المتصفح | الشهادة تخص `chat-arab.me` فقط | أعد إصدارها تشمل `live.chat-arab.me` (SAN/wildcard) |
| `ws://` مرفوض من الصفحة | خلط محتوى (صفحة HTTPS) | استخدم دائماً `wss://` |
| تأخّر أول اتصال طويل | `use_external_ip` يفحص IP | تأكد أن IP العام صحيح أو حدّده بـ `node_ip` |

## ملاحظات تشغيلية

- `port: 7880` لا يُفتح للإنترنت (مرتبط على `127.0.0.1` في compose) — الدخول عبر الـ proxy فقط.
- النسخة مثبّتة: `livekit/livekit-server:v1.13.10` (أحدث إصدار مستقر وقت كتابة الدليل).
- تحديث: `docker compose pull && docker compose up -d`.
