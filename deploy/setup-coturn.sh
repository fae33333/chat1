#!/usr/bin/env bash
# =====================================================
#  إعداد سيرفر TURN (coturn) على الـ VPS — لحل تقطّع مكالمات
#  الفيديو بين الهواتف عبر شبكات الجوال (NAT).
#  شغّل مرة واحدة:  bash deploy/setup-coturn.sh
#  ثم انسخ بيانات المستخدم إلى لوحة الإدارة (صلاحيات العضويات
#  ← سيرفر TURN) واحفظ.
# =====================================================
set -e

DOMAIN="${1:-chat-arab.me}"
TURN_USER="chat1"
# كلمة مرور قوية مولّدة عشوائياً
TURN_PASS="$(openssl rand -hex 16)"
TURN_PORT=3478

echo "★★★★★ 1) تثبيت coturn ★★★★★"
apt-get update -y
apt-get install -y coturn

# مفتاح ثابت للتوثيق (static auth) — يُستخدم لإصدار رموز مؤقتة إن رغبت لاحقاً
AUTH_SECRET="$(openssl rand -hex 16)"

echo "★★★★★ 2) كتابة الإعدادات ★★★★★"
cat > /etc/turnserver.conf <<EOF
# coturn — جسر مكالمات شات نجوم العرب
listening-port=${TURN_PORT}
min-port=49152
max-port=65535
no-tls
no-dtls
no-web-ticket
# المستخدم الثابت (يسهل الإدارة)
${TURN_USER}=${TURN_PASS}
listening-ip=0.0.0.0
relay-ip=0.0.0.0
external-ip=$(curl -4 -s ifconfig.me):49152-65535
total-quota=100
bandwidth=50M
no-cli
no-mcast-sweep
verbose
EOF

echo "★★★★★ 3) جدار الحماية (ufw إن وُجد) ★★★★★"
if command -v ufw >/dev/null 2>&1; then
  ufw allow ${TURN_PORT}/udp || true
  ufw allow ${TURN_PORT}/tcp || true
  ufw allow 49152:65535/udp || true
fi

echo "★★★★★ 4) التشغيل ★★★★★"
systemctl enable turnserver
systemctl restart turnserver
sleep 2
systemctl is-active turnserver && echo "✔ coturn يعمل"

cat <<EOF

★★★★★ جاهز — أدخل هذه البيانات في لوحة الإدارة (صلاحيات العضويات ← سيرفر TURN) ★★★★★

  العنوان:  ${DOMAIN}
  المنفذ:   ${TURN_PORT}
  المستخدم: ${TURN_USER}
  كلمة المرور: ${TURN_PASS}
  TLS:      غير مفعّل (turn عادي)

ملاحظات:
- إن كان الموقع خلف Let's Encrypt ويمكن فتح منفذ 5349/TCP، ففعّل TLS
  في coturn (turns) واختر «turns (TLS)» في لوحة الإدارة — أكثر أماناً.
- اختبر الاتصال من هاتفين على شبكتين مختلفتين بمكالمة فيديو.
- لإعادة توليد كلمة المرور: عدّل سطر «${TURN_USER}=...» في
  /etc/turnserver.conf ثم: systemctl restart turnserver
EOF
