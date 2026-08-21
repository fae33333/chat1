// =====================================================
//  شات نجوم العرب - واجهة المستخدم
// =====================================================
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let ME = null, MYBADGE = 'guest.png', SOCKET = null;
// رمز هوية خاص بهذه الصفحة فقط؛ لا يُحفظ في localStorage أو sessionStorage.
// عند التحديث أو فتح تبويب جديد يجب إدخال الاسم من جديد.
let CHAT_TOKEN = '';
let SETTINGS = { site_name: 'نجوم العرب', skin: 'default', font_size: '14', msg_max: 500, vip_cost: 30, premium_cost: 20, plus_cost: 10, show_smiles: '1', show_voice: '1', show_image: '1', hidden_super: '1', snd_join: '1', snd_msg: '0', snd_leave: '1', show_time: '1', wall_allowed_memberships: 'guest,registered,mmez,plus,premium,vip', status_allowed_memberships: 'registered,mmez,plus,premium,vip', voice_allowed_memberships: 'mmez,plus,premium,vip', broadcast_allowed_memberships: 'mmez,plus,premium,vip', public_message_allowed_memberships: 'guest,registered,mmez,plus,premium,vip', private_message_allowed_memberships: 'guest,registered,mmez,plus,premium,vip', private_call_allowed_memberships: 'mmez,plus,premium,vip', public_image_allowed_memberships: 'guest,registered,mmez,plus,premium,vip' };
let PREFS = { snd_all: 1, snd_msg: 0, snd_join: 1, show_time: 1, pm_recv: 1 };
try { Object.assign(PREFS, JSON.parse(localStorage.getItem('prefs') || '{}')); } catch (e) { }
function savePrefs() { localStorage.setItem('prefs', JSON.stringify(PREFS)); }
let ROOMS = [], ROOM_COUNTS = {}, CUR_ROOM = null, CUR_TAB = 'default';
let ROOM_PWD = {};                       // كلمات مرور الغرف الصحيحة لهذه الجلسة (لا تُعاد كتابتها)
let ROOM_HIDDEN = {};                    // اختيار الدخول المخفي لكل غرفة في هذه الصفحة فقط
let HIDDEN_ENTRY_PENDING = null;
// =====================================================
//  البث المباشر (فيديو/صوت) — حالة العميل + WebRTC
// =====================================================
// ⚠️ مهم: STUN وحده لا يكفي لعبور NAT في كثير من الشبكات الحقيقية (خصوصاً شبكات الجوال أو NAT المتماثل).
// بدون سيرفر TURN (relay) ستنجح مرحلة تبادل offer/answer/candidates لكن الصوت لن يصل فعلياً بين بعض المستخدمين.
// استبدل بيانات TURN التالية ببيانات حقيقية (من خدمة مثل Twilio NTS / Xirsys / Cloudflare Calls أو سيرفر coturn خاص بك):
const RTC_ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // { urls: 'turn:YOUR_TURN_HOST:3478', username: 'YOUR_TURN_USER', credential: 'YOUR_TURN_PASSWORD' },
    // { urls: 'turns:YOUR_TURN_HOST:5349', username: 'YOUR_TURN_USER', credential: 'YOUR_TURN_PASSWORD' },
  ]
};
let ROOM_BCAST = {};        // roomId -> {mode, hosts:[{id,username,avatar,badge},...], viewers} آخر حالة معروفة للبث بكل غرفة
let BCAST = null;           // الحالة الحية للبث الجاري (فيديو أو صوت) في الغرفة الحالية، أو null
let BCAST_SIGNAL_QUEUE = []; // إشارات وصلت قبل تهيئة BCAST (سباق زمني عند الدخول لغرفة فيها بث نشط) — تُطبَّق فور التهيئة
// شكل BCAST: {
//   roomId, mode:'video'|'audio', isHost:bool,
//   hostId, hostInfo, localStream, peers:Map(userId->RTCPeerConnection),
//   watchState: 'idle'|'pending'|'accepted'  (للمشاهد في وضع الفيديو فقط)
// }
const isAdmRank = () => ME && (ME.rank === 'superadmin' || ME.rank === 'admin' || ME.rank === 'supermaster');
const canChooseHiddenEntry = () => ME && (ME.rank === 'superadmin' || ME.rank === 'admin');
const isAlwaysHiddenEntry = () => ME && ME.rank === 'supermaster';
const canModerateRank = () => {
  if (!ME) return false;
  if (['superadmin', 'admin', 'supermaster'].includes(ME.rank)) return true;
  if (CUR_ROOM) {
    const meInRoom = (ROOM_USERS || []).find(u => u.id === ME.id);
    if (meInRoom && meInRoom.rank === 'roomadmin') return true;
  }
  return false;
};
let ROOM_USERS = [], CUR_TARGET = null;
let GIFTS = [], SEL_GIFT = null, G_QTY = 1;
let UP_PLAN = 'vip', UP_MONTHS = 1, UP_TARGET = null;
let PM_WITH = null, PRIV_UNREAD = 0, PRIV_TAB = 'members';
let PM_CALL = null; // حالة المكالمة الصوتية الخاصة الجارية
let NOTIFS = [], CURRENT_NOTIFICATIONS = [], CURRENT_ANNOUNCEMENT = null;
let READ_NOTIFS = new Set(), NOTIF_UNREAD = 0, STATUS_UNREAD = 0;
let SEL_AVATAR = null, AVA_CAT = 'def';
let STATUSES = [], STATUS_GROUP = [], STATUS_INDEX = 0, CURRENT_STATUS = null;
let WALL_POSTS = [], WALL_VIDEO_PATH = '', WALL_IMAGE_PATH = '', WALL_YOUTUBE_URL = '', WALL_YOUTUBE_RESULTS = [];
let CUSTOM_EMOJIS = [];
// قائمة التجاهل تُحمّل من الخادم وتبقى مرتبطة بالحساب.
let IGNORED_USERS = new Set();

// =====================================================
//  ترجمة واجهة الشات (العربية / English / Español / Türkçe)
// =====================================================
let APP_LANG = localStorage.getItem("chat_language") || "ar";
if (!["ar", "en", "es", "tr"].includes(APP_LANG)) APP_LANG = "ar";

const I18N_EN = {
  "الهدية من:": "Gift from:", "أرسلت إلى:": "Sent to:", "العدد والكمية:": "Quantity:", "التاريخ والوقت:": "Date & Time:",
  "اكتب حالتك أو نبذة تعبر عنك...": "Write your status or bio...", "حسابي": "My account", "الحالة / نبذة شخصية (اختياري)": "Status / Bio (Optional)", "تألق في عالم الدردشة وارفع اسمك لتظهر فوق بريميوم وبلس وخاصية فيديو بث مباشر وجميع الميزات المتوفرة في بريميوم وبلس": "Stand out in chat, appear above Premium & Plus, unlock live video streaming and all VIP features", "قم بتجربة قوة بريميوم لرفع اسمك والحصول على لون إرسال الرسائل الصوتية في الرسائل العامة والتحدث في الغرف الصوتية": "Experience Premium power to elevate your name, custom colors, voice messaging in public rooms, and voice chat", "ابدأ الطريق إلى المميزات مع بلس افتح ميزات إرسال الرسائل الصوتية في الرسائل العامة والتحدث في الغرف الصوتية مع ميزات عضوية بلس": "Unlock extra features with Plus: send voice notes in public rooms and participate in voice chats", "الهدايا المستلمة": "Received gifts", "جميع الهدايا التي أرسلها الأعضاء إلى حسابك": "All gifts sent by members to your account", "لم تستلم أي هدايا بعد": "You have not received any gifts yet", "لا يمكن تبادل الرسائل الخاصة بينك وبين الأشخاص المتجاهلين.": "Private messages cannot be exchanged with ignored users.", "قائمة التجاهل فارغة": "Ignore list is empty", "الموافقة والرسوم": "Approval & Fees", "التكلفة المقترحة": "Suggested cost", "التكلفة المقترحة 10 ذهب، وتستطيع الإدارة تحديد مقدار الذهب النهائي عند الموافقة": "Suggested cost 10 Gold; administration sets final gold upon approval", "لن يتم خصم أي ذهب عند إرسال الطلب. يصل اسمك إلى لوحة الإدارة، وبعد مراجعة الطلب تختار الإدارة مقدار الذهب ثم توافق على التوثيق أو ترفضه، وسيصلك إشعار بالنتيجة.": "No gold is deducted when sending request. Administration reviews it and you will receive a notification with the result.", "طلب التحقق من حسابي": "Request Account Verification", "شهر": "month", "/ شهر": "/ month", " / شهر": " / month",

  "باقة التجربة": "Trial Package", "الباقة البرونزية": "Bronze Package", "الباقة الفضية": "Silver Package",
  "الباقة الذهبية": "Gold Package", "الباقة الماسية": "Diamond Package", "باقة VIP الملكية": "Royal VIP Package",
  "🔥 الأكثر طلباً": "🔥 Most Popular", "⭐ باقة التوفير": "⭐ Best Value", "💎 باقة مميزة": "💎 Featured Package", "👑 باقة كبار الشخصيات": "👑 VIP Package",
  "السعر": "Price", "ذهب": "Gold", "ذهب هدية": "Bonus Gold",
  "مكالمة تجريبية مجانية 🎁": "Free Trial Call 🎁", "هدية التجربة الأولى • 60 ثانية مجاناً": "First Trial Gift • 60s Free",
  "بدء المكالمة المجانية 🎁": "Start Free Call 🎁", "رصيد الذهب غير كافٍ ⚠️": "Insufficient Gold Balance ⚠️",
  "تم استهلاك التجربة المجانية لهذا الحساب": "Free trial already used for this account", "شحن الذهب الآن 💰": "Recharge Gold Now 💰",
  "تأكيد بدء المكالمة الصوتية 📞": "Confirm Voice Call 📞", "تأكيد وبدء الاتصال": "Confirm & Start Call",
  "مدة المكالمة المجانية:": "Free call duration:", "تكلفة التجربة:": "Trial cost:", "رصيدك الحالي:": "Your current balance:",
  "نوع المكالمة:": "Call type:", "مفتوحة المدة": "Unlimited duration", "مفتوحة المدة (غير محدودة)": "Unlimited duration",
  "تكلفة المكالمة:": "Call fee:", "رسوم المكالمة:": "Call fee:", "المبلغ المطلوب شحنه:": "Amount needed:",
  "الرصيد بعد الخصم:": "Balance after deduction:", "المتصل به": "Called user",
  "دقيقة كاملة (60 ثانية)": "Full minute (60 seconds)", "مجاناً (0 ذهب)": "Free (0 Gold)",

  "الاسم مستخدم مسبقا": "Username is already taken",
  "اسم المستخدم موجود مسبقا": "Username already exists",
  "اسم المستخدم أو كلمة المرور غير صحيحة": "Incorrect username or password",
  "كلمة المرور يجب أن لا تقل عن 4 خانات": "Password must be at least 4 characters",
  "أكمل الحقول المطلوبة": "Please fill in all required fields",
  "اكتب اسم المستخدم": "Please enter username",
  "كلمة المرور مطلوبة": "Password is required",
  "لا يمكن التسجيل من عنوان IP محظور": "Cannot register from a banned IP address",
  "تم تجاوز عدد محاولات التسجيل، يرجى المحاولة لاحقاً": "Too many registration attempts. Please try again later",
  "عنوان IP الخاص بك محظور": "Your IP address is banned",
  "حسابك محظور بواسطة الإدارة": "Your account has been banned by administration",
  "يرجى كتابة اسم صاحب البطاقة": "Please enter cardholder name",
  "يرجى إدخال رقم بطاقة صراف صحيح (16 رقم)": "Please enter a valid 16-digit card number",
  "يرجى كتابة تاريخ الانتهاء بصيغة MM/YY": "Please enter expiry date in MM/YY format",
  "يرجى كتابة رمز الأمان CVV المكون من 3 أرقام": "Please enter 3-digit CVV security code",
  "اختر مستخدماً للاتصال به": "Choose a user to call",
  "أنت في مكالمة حالياً": "You are already in a call",
  "لا يمكن الاتصال بمستخدم متجاهل": "Cannot call an ignored user",
  "عضويتك غير مسموح لها بإجراء المكالمات الخاصة": "Your membership cannot make private calls",
  "يرجى الانتظار قليلاً قبل الدخول كزائر": "Please wait a moment before entering as guest",
  "تعذر إنشاء اسم زائر بديل، حاول مرة أخرى": "Could not create alternative guest name. Try again",

  "دخول": "Login", "إنشاء حساب": "Create account", "الخروج": "Logout", "الافتراضية": "Default", "الصوتية": "Voice",
  "لا يوجد احد في البث المباشر حي الان": "No one is live right now", "بث مباشر": "Live", "مغادرة الغرفة": "Leave room", "تحديث الغرف": "Refresh rooms",
  "متصل الان": "Online now", "إيموجي": "Emoji", "قائمة الألوان": "Colors",
  "الغرف": "Rooms", "الخاص": "Private", "الإشعارات": "Notifications", "القائمة": "Menu",
  "الحالات": "Statuses", "حالتي": "My status", "اضغط لإضافة تحديث الحالة": "Tap to add a status update", "الحالات الحديثة": "Recent updates",
  "جاري تحميل الحالات...": "Loading statuses...", "إضافة حالة": "Add status", "صورة": "Photo", "فيديو": "Video", "ملف صوتي": "Audio", "كتابة": "Text",
  "تختفي الحالة تلقائياً بعد 24 ساعة": "Your status disappears automatically after 24 hours", "إلغاء": "Cancel", "حالة كتابية": "Text status", "نشر": "Publish",
  "حالة صوتية": "Audio status", "المشاهدات": "Views", "حذف الحالة": "Delete status", "شاهد حالتي": "Viewed my status", "مشاهدة": "view",
  "لغة الواجهة": "Interface language", "العربية": "Arabic", "عرض الواجهة باللغة العربية": "Display interface in Arabic", "عرض الواجهة باللغة الإنجليزية": "Display interface in English", "تغيير اللغة": "Change language",
  "تسجيل الدخول": "Sign in", "دخول كزائر/ة": "Continue as guest", "نسيت كلمة السر؟": "Forgot your password?", "استعادة كلمة السر": "Recover password",
  "لا يوجد لديك عضوية؟": "Do not have an account?", "إنشاء حساب مجانًا": "Create a free account", "النوع": "Gender", "ذكر": "Male", "أنثى": "Female", "مجهول": "Unknown",
  "الرجاء قراءة": "Please read", "شروط الاستخدام": "Terms of Use", "وقراءة": "and read", "سياسة الخصوصية": "Privacy Policy", "تسجيل العضوية": "Register account",
  "يتطلب الدخول باستخدام عضويتك أو تسجيل عضوية": "Sign in or create an account", "هذه الميزة متاحة للمستخدمين المسجلين فقط، قم بتسجيل عضوية مجانا الان": "This feature is available to registered users only. Create a free account now.",
  "التسجيل الان": "Register now", "لاحقا": "Later", "عضو مسجل": "Registered member", "زائر": "Guest", "الرد على الرسالة": "Reply to message",
  "دردشة خاصة": "Private chat", "ارسل هدية": "Send gift", "ترقية هذا المستخدم": "Upgrade this user", "تجاهل": "Ignore", "إلغاء التجاهل": "Unignore",
  "كتم المستخدم": "Mute user", "إلغاء الكتم": "Unmute", "طرد المستخدم": "Kick user", "حظر المستخدم": "Ban user", "المعلومات الشخصية": "Profile information", "إغلاق": "Close",
  "متجر الهدايا الافتراضية": "Virtual gift store", "فاخرة": "Luxury", "جواهر": "Jewels", "افتراضي": "Default", "هدية لـ :": "Gift to:", "اختر هدية": "Choose a gift",
  "كمية :": "Quantity:", "تحتاج لتنفق :": "You need to spend:", "جائزة هذه الهدية :": "Gift reward:", "يحصل مستلم هذه الهدية على هذا الرصيد": "The recipient receives this balance",
  "رصيدك الحالي :": "Your current balance:", "الغاء": "Cancel", "أرسل": "Send", "الترقية": "Upgrade", "قم بترقية عضوية الحساب لتبرز من بين الحشود !": "Upgrade the account to stand out from the crowd!",
  "الترقية الى :": "Upgrade to:", "المدة بالأشهر :": "Duration in months:", "ترقية": "Upgrade", "حسابي": "My account", "الهدايا": "Gifts", "عودة": "Back",
  "المحادثات الخاصة": "Private conversations", "الاعضاء المسجلين": "Registered members", "غير مرغوب فيه": "Spam", "القائمة الرئيسية": "Main menu",
  "متصل": "Online", "رصيدك الحالي": "Current balance", "شراء رصيد": "Buy credit", "توثيق حسابي": "Verify my account", "ترقية حسابي": "Upgrade my account",
  "تغيير الصورة": "Change photo", "هدايا حسابي": "My gifts", "قوائم الحظر": "Block lists", "الاعدادات": "Settings", "تسجيل الخروج": "Sign out",
  "تغيير الحالة": "Change status", "مشغول": "Busy", "بالخارج": "Away", "حساب": "Account", "الطبيعة": "Nature", "اخرى": "Other", "رفع صورة": "Upload photo",
  "اختيار هذه الصورة": "Choose this photo", "عام": "General", "تفعيل الصوت": "Enable sound", "صوت الرسائل الجديدة": "New message sound",
  "صوت دخول المستخدمين": "User join sound", "اظهار الوقت في الرسائل": "Show message time", "استقبال الرسائل الخاصة": "Receive private messages",
  "إشعارات": "Notifications", "نظام الكتم": "Mute system", "نظام الإشراف": "Supervision system", "احصل على توثيق دردشتي": "Get verified", "شارة تم التحقق ؟": "Verification badge",
  "احصل على شارة تحقق خاصة تظهر بجوار اسمك أينما ظهر": "Get a verification badge shown next to your name everywhere", "حماية حسابك": "Protect your account",
  "احم حسابك في مجتمعنا من مرسلي البريد العشوائي، لن نقبل التحقق من أي شخص آخر يشبه حسابك": "Protect your account from impersonation and spam.",
  "الثقة والتميز": "Trust and distinction", "اجعل مجتمع دردشتي يثق بك وكن دائمًا مميز في المقدمة": "Build trust in the community and always stand out.",
  "الصلاحية والرسوم": "Validity and fees", "الرسوم هي": "The fee is", "10 ذهب": "10 Gold", "افتراضي ومدة الصلاحية": "and the validity period is", "3 أشهر": "3 months",
  "طلب التحقق من حسابي": "Request account verification",
  "اشترِ الذهب الافتراضي لترقية حسابك أو حساب أصدقائك وإرسال الهدايا": "Buy virtual gold to upgrade accounts and send gifts.",
  "شراء ذهب دردشتي الافتراضي": "Buy virtual gold", "باقات شحن الذهب المميزة": "Gold Top-up Packages",
  "اختر الباقة المناسبة وادفع عبر البطاقة البنكية أو بطاقة الصراف لشحن رصيدك فورياً": "Choose a package and pay securely with Debit/Credit Card.",
  "متابعة شراء": "Continue purchase", "هل انت متأكد تريد الخروج من هذه الغرفة ؟": "Are you sure you want to leave this room?",
  "كلا": "No", "نعم": "Yes", "غرفة محمية": "Protected room", "اكتب كلمة المرور للدخول:": "Enter room password:", "❌ كلمة المرور غير صحيحة — حاول مرة أخرى": "❌ Incorrect password — try again",
  "اضغط هنا لفتح الصورة": "Tap here to open image", "ادخل إلى غرفة أولاً": "Join a room first", "جاري رفع الملف...": "Uploading file...", "تعذر إرسال الملف": "Could not send file",
  "تم قطع الاتصال": "Connection lost", "جارٍ إعادة الاتصال...": "Reconnecting...", "اتصال": "Connect",
  "قسم الشكاوي": "Complaints", "إرسال الشكوى": "Send complaint", "رسالة النظام": "System message", "إعلان من الإدارة": "Admin announcement", "نظام الهدايا": "Gift system",
  "لا توجد غرف هنا": "No rooms here", "لا يوجد متصلون": "No users online", "لا توجد حالات حديثة بعد": "No recent updates", "تعذر تحميل الحالات": "Could not load statuses",
  "لا توجد رسائل من الزوار": "No messages from guests", "لا توجد محادثات مع أعضاء مسجلين": "No conversations with registered members",
  "لا يوجد رسائل خاصة بعد": "No private messages yet", "لا يوجد إشعارات بعد": "No notifications yet", "لا توجد هدايا بعد": "No gifts yet",
  "إلغاء الطرد": "Remove kick", "أنت هنا": "You are here", "بحث عن غرف": "Search rooms", "بحث عن مستخدمين": "Search users", "ابحث عن غرفك": "Search rooms",
  "رسالة عامة": "Public message", "رسالة": "Message", "اكتب حالتك...": "Write your status...", "الأسم المستعار": "Display name", "اسم المستعار": "Display name",
  "الرقم السري": "Password", "العمر": "Age", "كلمة المرور": "Password", "موضوع الشكوى": "Complaint subject", "اكتب شكواك هنا...": "Write your complaint here...",
  "جاري تحميل قائمة الغرف...": "Loading rooms...", "الرسائل": "Messages", "معلومات": "Information", "الإبلاغ": "Report", "إرسل ترقية": "Send upgrade", "إرسل هدية": "Send gift", "ارسل ترقية": "Send upgrade",
  "دردشة": "Chat", "يتم عرض الهدايا التي يتلقاها هذا المستخدم هنا": "Gifts received by this user appear here", "أظهر المزيد": "Show more",
  "تنفيذ وحفظ": "Save changes", "البريد الالكتروني": "Email", "الدولة / بلدة": "Country / City", "النبذة": "Bio", "حفظ": "Save",
  "تلقائي": "Automatic", "قائمة التجاهل": "Ignore list", "إعدادات الإشعارات": "Notification settings",
  "الدفع بالبطاقة البنكية 💳": "Debit or Credit Card Payment 💳", "خصم آمن وفوري وشحن مباشر للرصيد": "Secure instant deduction and direct gold recharge",
  "حامل البطاقة": "Cardholder Name", "تاريخ الانتهاء": "Expiry Date", "رمز الأمان (CVV):": "Security code (CVV):", "تأكيد الخصم والدفع": "Confirm & Pay Now",
  "اسم صاحب البطاقة (كما هو على البطاقة):": "Cardholder Name (as printed on card):", "رقم بطاقة الصراف / الائتمان (16 رقم):": "Card Number (16 digits):",
  "المعاملة مشفرة ومحمية بتشفير 256-Bit SSL المصرفي": "Transactions are encrypted and secured with 256-Bit SSL",
  "الباقة المختارة:": "Selected Package:", "الذهب المستلم:": "Gold Received:", "المبلغ المطلوب خصمه:": "Amount to Charge:",
  "الدفع عبر البطاقة البنكية / Debit or Credit Card": "Pay with Debit or Credit Card", "دفع إلكتروني مباشر ومشفر 256-Bit SSL": "Secure direct 256-Bit SSL encrypted payment",
  "إشعار من النظام": "System Notification", "إعلان عام": "General announcement", "بواسطة:": "By:", "الإدارة": "Administration", "حسناً": "OK", "إشعار": "Notification",
  "الحائط": "Wall", "تحديث الحائط": "Refresh wall", "اكتب منشورك هنا...": "Write your post...", "يوتيوب": "YouTube", "رفع فيديو": "Upload video", "نشر": "Publish",
  "إعجاب": "Like", "سمايل": "React", "تعليق": "Comment", "اكتب تعليقاً...": "Write a comment...", "حذف المنشور": "Delete post",
  "تم تسجيل الخروج": "Logged out", "تم حفظ الاعدادات ✓": "Settings saved ✓", "تم تغيير اللغة إلى العربية": "Language changed to Arabic",
  "مغلقة 🔒": "Closed 🔒", "لم يتلقَ هدايا بعد": "No gifts received yet", "أنت متواجد في هذه الغرفة حالياً 📍": "You are already in this room 📍",
  "اختر غرفة أولا": "Choose a room first", "اختر هدية أولا": "Choose a gift first", "اكتب الشكوى أولا": "Write your complaint first",
  "تعذر إرسال الطلب": "Could not send request", "تم الحفظ بنجاح ✅": "Saved successfully ✅", "تم تحديث قائمة الغرف ✓": "Room list refreshed ✓",
  "تم تسجيل عضويتك بنجاح 🎉": "Account registered successfully 🎉", "ادمن": "Admin", "ادمن غرفة": "Room admin", "سوبر ادمين": "Super admin",
  "عضوية Plus": "Plus membership", "عضوية Premium": "Premium membership", "عضوية النخبة": "VIP membership", "عضوية مميز": "Special membership",
  "الأردن": "Jordan", "السعودية": "Saudi Arabia", "مصر": "Egypt", "العراق": "Iraq", "فلسطين": "Palestine", "الإمارات": "UAE", "الكويت": "Kuwait"
};

const I18N_ES = {
  "الهدية من:": "Regalo de:", "أرسلت إلى:": "Enviado a:", "العدد والكمية:": "Cantidad:", "التاريخ والوقت:": "Fecha y Hora:",
  "اكتب حالتك أو نبذة تعبر عنك...": "Escribe tu estado o biografía...", "حسابي": "Mi cuenta", "الحالة / نبذة شخصية (اختياري)": "Estado / Biografía (Opcional)", "تألق في عالم الدردشة وارفع اسمك لتظهر فوق بريميوم وبلس وخاصية فيديو بث مباشر وجميع الميزات المتوفرة في بريميوم وبلس": "Destaca en el chat, aparece por encima de Premium y Plus, desbloquea transmisión de video en vivo y todas las funciones VIP", "قم بتجربة قوة بريميوم لرفع اسمك والحصول على لون إرسال الرسائل الصوتية في الرسائل العامة والتحدث في الغرف الصوتية": "Experimenta el poder de Premium para destacar tu nombre, colores personalizados, notas de voz públicas y salas de voz", "ابدأ الطريق إلى المميزات مع بلس افتح ميزات إرسال الرسائل الصوتية في الرسائل العامة والتحدث في الغرف الصوتية مع ميزات عضوية بلس": "Desbloquea funciones adicionales con Plus: envía notas de voz en salas públicas y habla en salas de voz", "الهدايا المستلمة": "Regalos recibidos", "جميع الهدايا التي أرسلها الأعضاء إلى حسابك": "Todos los regalos enviados por miembros a tu cuenta", "لم تستلم أي هدايا بعد": "Aún no has recibido ningún regalo", "لا يمكن تبادل الرسائل الخاصة بينك وبين الأشخاص المتجاهلين.": "No se pueden intercambiar mensajes privados con personas ignoradas.", "قائمة التجاهل فارغة": "La lista de ignorados está vacía", "احصل على توثيق دردشتي": "Obtener verificación", "شارة تم التحقق ؟": "Insignia de verificación", "احصل على شارة تحقق خاصة تظهر بجوار اسمك أينما ظهر": "Obtén una insignia de verificación que aparece junto a tu nombre en todas partes", "حماية حسابك": "Protege tu cuenta", "احم حسابك في مجتمعنا من مرسلي البريد العشوائي، لن نقبل التحقق من أي شخص آخر يشبه حسابك": "Protege tu cuenta contra imitaciones y correo no deseado.", "الثقة والتميز": "Confianza y distinción", "اجعل مجتمع دردشتي يثق بك وكن دائمًا مميز في المقدمة": "Genera confianza en la comunidad y destaca siempre en primera línea.", "الموافقة والرسوم": "Aprobación y Tarifas", "التكلفة المقترحة": "Costo sugerido", "التكلفة المقترحة 10 ذهب، وتستطيع الإدارة تحديد مقدار الذهب النهائي عند الموافقة": "Costo sugerido 10 Oro; la administración establece el valor final al aprobar", "لن يتم خصم أي ذهب عند إرسال الطلب. يصل اسمك إلى لوحة الإدارة، وبعد مراجعة الطلب تختار الإدارة مقدار الذهب ثم توافق على التوثيق أو ترفضه، وسيصلك إشعار بالنتيجة.": "No se descuenta oro al enviar la solicitud. La administración la revisará y recibirás una notificación con el resultado.", "طلب التحقق من حسابي": "Solicitar Verificación de Cuenta", "الصلاحية والرسوم": "Validez y tarifas", "الرسوم هي": "La tarifa es", "10 ذهب": "10 Oro", "افتراضي ومدة الصلاحية": "y el período de validez es", "3 أشهر": "3 meses", "شهر": "mes", "/ شهر": "/ mes", " / شهر": " / mes",

  "باقة التجربة": "Paquete de Prueba", "الباقة البرونزية": "Paquete Bronce", "الباقة الفضية": "Paquete Plata",
  "الباقة الذهبية": "Paquete Oro", "الباقة الماسية": "Paquete Diamante", "باقة VIP الملكية": "Paquete VIP Real",
  "🔥 الأكثر طلباً": "🔥 Más Popular", "⭐ باقة التوفير": "⭐ Mejor Valor", "💎 باقة مميزة": "💎 Paquete Destacado", "👑 باقة كبار الشخصيات": "👑 Paquete VIP",
  "السعر": "Precio", "ذهب": "Oro", "ذهب هدية": "Oro de regalo",
  "مكالمة تجريبية مجانية 🎁": "Llamada de prueba gratis 🎁", "هدية التجربة الأولى • 60 ثانية مجاناً": "Regalo de prueba • 60s gratis",
  "بدء المكالمة المجانية 🎁": "Iniciar llamada gratis 🎁", "رصيد الذهب غير كافٍ ⚠️": "Saldo de oro insuficiente ⚠️",
  "تم استهلاك التجربة المجانية لهذا الحساب": "Prueba gratuita ya utilizada", "شحن الذهب الآن 💰": "Recargar oro ahora 💰",
  "تأكيد بدء المكالمة الصوتية 📞": "Confirmar llamada de voz 📞", "تأكيد وبدء الاتصال": "Confirmar y llamar",
  "مدة المكالمة المجانية:": "Duración de llamada gratis:", "تكلفة التجربة:": "Costo de prueba:", "رصيدك الحالي:": "Tu saldo actual:",
  "نوع المكالمة:": "Tipo de llamada:", "مفتوحة المدة": "Duración ilimitada", "مفتوحة المدة (غير محدودة)": "Duración ilimitada",
  "تكلفة المكالمة:": "Tarifa de llamada:", "رسوم المكالمة:": "Tarifa de llamada:", "المبلغ المطلوب شحنه:": "Monto requerido:",
  "الرصيد بعد الخصم:": "Saldo tras deducción:", "المتصل به": "Usuario llamado",
  "دقيقة كاملة (60 ثانية)": "Minuto completo (60s)", "مجاناً (0 ذهب)": "Gratis (0 Oro)",

  "الاسم مستخدم مسبقا": "El nombre de usuario ya está en uso",
  "اسم المستخدم موجود مسبقا": "El nombre de usuario ya existe",
  "اسم المستخدم أو كلمة المرور غير صحيحة": "Usuario o contraseña incorrectos",
  "كلمة المرور يجب أن لا تقل عن 4 خانات": "La contraseña debe tener al menos 4 caracteres",
  "أكمل الحقول المطلوبة": "Por favor completa todos los campos requeridos",
  "اكتب اسم المستخدم": "Por favor ingresa el nombre de usuario",
  "كلمة المرور مطلوبة": "La contraseña es requerida",
  "لا يمكن التسجيل من عنوان IP محظور": "No se puede registrar desde una IP bloqueada",
  "تم تجاوز عدد محاولات التسجيل، يرجى المحاولة لاحقاً": "Demasiados intentos de registro. Inténtalo más tarde",
  "عنوان IP الخاص بك محظور": "Tu dirección IP está bloqueada",
  "حسابك محظور بواسطة الإدارة": "Tu cuenta ha sido bloqueada por la administración",
  "يرجى كتابة اسم صاحب البطاقة": "Ingresa el nombre del titular",
  "يرجى إدخال رقم بطاقة صراف صحيح (16 رقم)": "Ingresa un número de tarjeta válido de 16 dígitos",
  "يرجى كتابة تاريخ الانتهاء بصيغة MM/YY": "Ingresa la fecha de vencimiento en formato MM/AA",
  "يرجى كتابة رمز الأمان CVV المكون من 3 أرقام": "Ingresa el código de seguridad CVV de 3 dígitos",
  "اختر مستخدماً للاتصال به": "Elige un usuario para llamar",
  "أنت في مكالمة حالياً": "Ya estás en una llamada",
  "لا يمكن الاتصال بمستخدم متجاهل": "No se puede llamar a un usuario ignorado",
  "عضويتك غير مسموح لها بإجراء المكالمات الخاصة": "Tu membresía no permite llamadas privadas",
  "يرجى الانتظار قليلاً قبل الدخول كزائر": "Espera un momento antes de entrar como invitado",
  "تعذر إنشاء اسم زائر بديل، حاول مرة أخرى": "No se pudo generar un nombre de invitado alternativo. Inténtalo de nuevo",

  "دخول": "Iniciar sesión", "إنشاء حساب": "Crear cuenta", "الخروج": "Cerrar sesión", "الافتراضية": "Predeterminada", "الصوتية": "Voz",
  "لا يوجد احد في البث المباشر حي الان": "Nadie está en vivo ahora", "بث مباشر": "En vivo", "مغادرة الغرفة": "Salir de la sala", "تحديث الغرف": "Actualizar salas",
  "متصل الان": "En línea ahora", "إيموجي": "Emojis", "قائمة الألوان": "Colores",
  "الغرف": "Salas", "الخاص": "Privado", "الإشعارات": "Notificaciones", "القائمة": "Menú",
  "الحالات": "Estados", "حالتي": "Mi estado", "اضغط لإضافة تحديث الحالة": "Toca para agregar estado", "الحالات الحديثة": "Estados recientes",
  "جاري تحميل الحالات...": "Cargando estados...", "إضافة حالة": "Añadir estado", "صورة": "Foto", "فيديو": "Video", "ملف صوتي": "Audio", "كتابة": "Texto",
  "تختفي الحالة تلقائياً بعد 24 ساعة": "El estado desaparece en 24 horas", "إلغاء": "Cancelar", "حالة كتابية": "Estado de texto", "نشر": "Publicar",
  "حالة صوتية": "Estado de audio", "المشاهدات": "Vistas", "حذف الحالة": "Eliminar estado", "شاهد حالتي": "Vieron mi estado", "مشاهدة": "vista",
  "لغة الواجهة": "Idioma de la interfaz", "العربية": "Árabe", "عرض الواجهة باللغة العربية": "Mostrar en árabe", "عرض الواجهة باللغة الإنجليزية": "Mostrar en inglés", "تغيير اللغة": "Cambiar idioma",
  "تسجيل الدخول": "Iniciar sesión", "دخول كزائر/ة": "Entrar como invitado/a", "نسيت كلمة السر؟": "¿Olvidaste tu contraseña?", "استعادة كلمة السر": "Recuperar contraseña",
  "لا يوجد لديك عضوية؟": "¿No tienes cuenta?", "إنشاء حساب مجانًا": "Crear cuenta gratis", "النوع": "Género", "ذكر": "Hombre", "أنثى": "Mujer", "مجهول": "Desconocido",
  "الرجاء قراءة": "Por favor lee", "شروط الاستخدام": "Términos de uso", "وقراءة": "y lee", "سياسة الخصوصية": "Política de privacidad", "تسجيل العضوية": "Registrarse",
  "يتطلب الدخول باستخدام عضويتك أو تسجيل عضوية": "Inicia sesión o crea una cuenta", "هذه الميزة متاحة للمستخدمين المسجلين فقط، قم بتسجيل عضوية مجانا الان": "Función para usuarios registrados. Regístrate gratis ahora.",
  "التسجيل الان": "Registrarse ahora", "لاحقا": "Más tarde", "عضو مسجل": "Miembro registrado", "زائر": "Invitado", "الرد على الرسالة": "Responder",
  "دردشة خاصة": "Chat privado", "ارسل هدية": "Enviar regalo", "ترقية هذا المستخدم": "Mejorar usuario", "تجاهل": "Ignorar", "إلغاء التجاهل": "Dejar de ignorar",
  "كتم المستخدم": "Silenciar usuario", "إلغاء الكتم": "Desilenciar", "طرد المستخدم": "Expulsar usuario", "حظر المستخدم": "Bloquear usuario", "المعلومات الشخصية": "Perfil", "إغلاق": "Cerrar",
  "متجر الهدايا الافتراضية": "Tienda de regalos", "فاخرة": "Lujo", "جواهر": "Joyas", "افتراضي": "Predeterminado", "هدية لـ :": "Regalo para:", "اختر هدية": "Elige regalo",
  "كمية :": "Cantidad:", "تحتاج لتنفق :": "Debes gastar:", "جائزة هذه الهدية :": "Recompensa:", "يحصل مستلم هذه الهدية على هذا الرصيد": "El destinatario recibe este saldo",
  "رصيدك الحالي :": "Tu saldo actual:", "الغاء": "Cancelar", "أرسل": "Enviar", "الترقية": "Membresía", "قم بترقية عضوية الحساب لتبرز من بين الحشود !": "¡Mejora tu cuenta para destacar!",
  "الترقية الى :": "Mejorar a:", "المدة بالأشهر :": "Meses:", "ترقية": "Mejorar", "حسابي": "Mi cuenta", "الهدايا": "Regalos", "عودة": "Volver",
  "المحادثات الخاصة": "Chats privados", "الاعضاء المسجلين": "Registrados", "غير مرغوب فيه": "Spam", "القائمة الرئيسية": "Menú principal",
  "متصل": "En línea", "رصيدك الحالي": "Saldo actual", "شراء رصيد": "Comprar saldo", "توثيق حسابي": "Verificar cuenta", "ترقية حسابي": "Mejorar cuenta",
  "تغيير الصورة": "Cambiar foto", "هدايا حسابي": "Mis regalos", "قوائم الحظر": "Bloqueados", "الاعدادات": "Ajustes", "تسجيل الخروج": "Cerrar sesión",
  "تغيير الحالة": "Cambiar estado", "مشغول": "Ocupado", "بالخارج": "Ausente", "حساب": "Cuenta", "الطبيعة": "Naturaleza", "اخرى": "Otros", "رفع صورة": "Subir foto",
  "اختيار هذه الصورة": "Elegir foto", "عام": "General", "تفعيل الصوت": "Activar sonido", "صوت الرسائل الجديدة": "Sonido de mensajes",
  "صوت دخول المستخدمين": "Sonido de entrada", "اظهار الوقت في الرسائل": "Mostrar hora", "استقبال الرسائل الخاصة": "Recibir mensajes privados",
  "إشعارات": "Notificaciones", "نظام الكتم": "Silencio", "نظام الإشراف": "Moderación", "احصل على توثيق دردشتي": "Verificar cuenta",
  "إعلان عام": "Anuncio general", "بواسطة:": "Por:", "الإدارة": "Administración", "حسناً": "Aceptar", "إشعار": "Notificación",
  "الحائط": "Muro", "تحديث الحائط": "Actualizar muro", "اكتب منشورك هنا...": "Escribe tu publicación...", "يوتيوب": "YouTube", "رفع فيديو": "Subir video", "نشر": "Publicar",
  "إعجاب": "Me gusta", "سمايل": "Reaccionar", "تعليق": "Comentar", "اكتب تعليقاً...": "Escribe un comentario...", "حذف المنشور": "Eliminar publicación",
  "الدفع بالبطاقة البنكية 💳": "Pago con Tarjeta 💳", "خصم آمن وفوري وشحن مباشر للرصيد": "Pago seguro y recarga instantánea",
  "حامل البطاقة": "Titular de la tarjeta", "تاريخ الانتهاء": "Vencimiento", "رمز الأمان (CVV):": "Código de seguridad (CVV):", "تأكيد الخصم والدفع": "Confirmar y Pagar",
  "اسم صاحب البطاقة (كما هو على البطاقة):": "Nombre del titular:", "رقم بطاقة الصراف / الائتمان (16 رقم):": "Número de tarjeta (16 dígitos):",
  "المعاملة مشفرة ومحمية بتشفير 256-Bit SSL المصرفي": "Transacciones protegidas con cifrado SSL de 256 bits",
  "الباقة المختارة:": "Paquete seleccionado:", "الذهب المستلم:": "Oro recibido:", "المبلغ المطلوب خصمه:": "Total a pagar:",
  "الدفع عبر البطاقة البنكية / Debit or Credit Card": "Pagar con Tarjeta de Débito/Crédito", "دفع إلكتروني مباشر ومشفر 256-Bit SSL": "Pago seguro cifrado SSL de 256 bits",
  "إشعار من النظام": "Notificación del sistema", "تم تسجيل الخروج": "Sesión cerrada", "تم حفظ الاعدادات ✓": "Ajustes guardados ✓",
  "مغلقة 🔒": "Cerrada 🔒", "لم يتلقَ هدايا بعد": "Sin regalos aún", "أنت متواجد في هذه الغرفة حالياً 📍": "Ya estás en esta sala 📍",
  "اختر غرفة أولا": "Elige una sala primero", "اختر هدية أولا": "Elige un regalo primero", "ادمن": "Admin", "ادمن غرفة": "Admin de sala", "سوبر ادمين": "Super admin",
  "رسالة عامة": "Mensaje público", "رسالة": "Mensaje", "اكتب حالتك...": "Escribe tu estado...", "الأسم المستعار": "Nombre de usuario", "اسم المستعار": "Nombre de usuario",
  "الرقم السري": "Contraseña", "العمر": "Edad", "كلمة المرور": "Contraseña", "موضوع الشكوى": "Asunto", "اكتب شكواك هنا...": "Escribe tu queja aquí...",
  "جاري تحميل قائمة الغرف...": "Cargando salas...", "الرسائل": "Mensajes", "معلومات": "Información", "الإبلاغ": "Reportar",
  "دردشة": "Chat", "يتم عرض الهدايا التي يتلقاها هذا المستخدم هنا": "Los regalos recibidos aparecen aquí", "أظهر المزيد": "Ver más",
  "تنفيذ وحفظ": "Guardar cambios", "البريد الالكتروني": "Correo electrónico", "الدولة / بلدة": "País / Ciudad", "النبذة": "Biografía", "حفظ": "Guardar",
  "تلقائي": "Automático", "قائمة التجاهل": "Lista de ignorados", "إعدادات الإشعارات": "Ajustes de notificaciones"
};

const I18N_TR = {
  "الهدية من:": "Gönderen:", "أرسلت إلى:": "Alıcı:", "العدد والكمية:": "Miktar:", "التاريخ والوقت:": "Tarih ve Saat:",
  "اكتب حالتك أو نبذة تعبر عنك...": "Durumunuzu veya biyografinizi yazın...", "حسابي": "Hesabım", "الحالة / نبذة شخصية (اختياري)": "Durum / Biyografi (İsteğe bağlı)", "تألق في عالم الدردشة وارفع اسمك لتظهر فوق بريميوم وبلس وخاصية فيديو بث مباشر وجميع الميزات المتوفرة في بريميوم وبلس": "Sohbet dünyasında öne çıkın, Premium ve Plus üzerinde görünün, canlı video yayını ve tüm VIP özelliklerini açın", "قم بتجربة قوة بريميوم لرفع اسمك والحصول على لون إرسال الرسائل الصوتية في الرسائل العامة والتحدث في الغرف الصوتية": "Adınızı yükseltmek, özel renkler, genel odalarda sesli mesaj göndermek ve sesli odalarda konuşmak için Premium gücünü deneyin", "ابدأ الطريق إلى المميزات مع بلس افتح ميزات إرسال الرسائل الصوتية في الرسائل العامة والتحدث في الغرف الصوتية مع ميزات عضوية بلس": "Plus ile ek özellikleri açın: genel odalarda ses kaydı gönderin ve sesli odalarda sohbet edin", "الهدايا المستلمة": "Alınan hediyeler", "جميع الهدايا التي أرسلها الأعضاء إلى حسابك": "Üyelerin hesabınıza gönderdiği tüm hediyeler", "لم تستلم أي هدايا بعد": "Henüz hediye almadınız", "لا يمكن تبادل الرسائل الخاصة بينك وبين الأشخاص المتجاهلين.": "Engellenen kullanıcılarla özel mesajlaşılamaz.", "قائمة التجاهل فارغة": "Engellenenler listesi boş", "احصل على توثيق دردشتي": "Hesabı doğrula", "شارة تم التحقق ؟": "Doğrulama rozeti", "احصل على شارة تحقق خاصة تظهر بجوار اسمك أينما ظهر": "Adınızın yanında her yerde görünen özel bir doğrulama rozeti alın", "حماية حسابك": "Hesabınızı koruyun", "احم حسابك في مجتمعنا من مرسلي البريد العشوائي، لن نقبل التحقق من أي شخص آخر يشبه حسابك": "Hesabınızı taklit ve spam gönderenlerden koruyun.", "الثقة والتميز": "Güven ve ayrıcalık", "اجعل مجتمع دردشتي يثق بك وكن دائمًا مميز في المقدمة": "Toplulukta güven oluşturun ve her zaman öne çıkın.", "الموافقة والرسوم": "Onay ve Ücretler", "التكلفة المقترحة": "Önerilen ücret", "التكلفة المقترحة 10 ذهب، وتستطيع الإدارة تحديد مقدار الذهب النهائي عند الموافقة": "Önerilen ücret 10 Altın; yönetim onay sırasında nihai tutarı belirler", "لن يتم خصم أي ذهب عند إرسال الطلب. يصل اسمك إلى لوحة الإدارة، وبعد مراجعة الطلب تختار الإدارة مقدار الذهب ثم توافق على التوثيق أو ترفضه، وسيصلك إشعار بالنتيجة.": "Talep gönderildiğinde altın kesilmez. Yönetim talebi inceler ve sonuç bildirimi alırsınız.", "طلب التحقق من حسابي": "Hesap Doğrulaması Talep Et", "الصلاحية والرسوم": "Geçerlilik ve ücretler", "الرسوم هي": "Ücret", "10 ذهب": "10 Altın", "افتراضي ومدة الصلاحية": "ve geçerlilik süresi", "3 أشهر": "3 ay", "شهر": "ay", "/ شهر": "/ ay", " / شهر": " / ay",

  "باقة التجربة": "Deneme Paketi", "الباقة البرونزية": "Bronz Paket", "الباقة الفضية": "Gümüş Paket",
  "الباقة الذهبية": "Altın Paket", "الباقة الماسية": "Elmas Paket", "باقة VIP الملكية": "Kraliyet VIP Paketi",
  "🔥 الأكثر طلباً": "🔥 En Popüler", "⭐ باقة التوفير": "⭐ Tasarruf Paketi", "💎 باقة مميزة": "💎 Özel Paket", "👑 باقة كبار الشخصيات": "👑 VIP Paketi",
  "السعر": "Fiyat", "ذهب": "Altın", "ذهب هدية": "Hediye Altın",
  "مكالمة تجريبية مجانية 🎁": "Ücretsiz Deneme Araması 🎁", "هدية التجربة الأولى • 60 ثانية مجاناً": "İlk Deneme Hediyesi • 60s Ücretsiz",
  "بدء المكالمة المجانية 🎁": "Ücretsiz Aramayı Başlat 🎁", "رصيد الذهب غير كافٍ ⚠️": "Yetersiz Altın Bakiyesi ⚠️",
  "تم استهلاك التجربة المجانية لهذا الحساب": "Ücretsiz deneme zaten kullanıldı", "شحن الذهب الآن 💰": "Şimdi Altın Yükle 💰",
  "تأكيد بدء المكالمة الصوتية 📞": "Sesli Aramayı Onayla 📞", "تأكيد وبدء الاتصال": "Onayla ve Ara",
  "مدة المكالمة المجانية:": "Ücretsiz arama süresi:", "تكلفة التجربة:": "Deneme maliyeti:", "رصيدك الحالي:": "Mevcut bakiyeniz:",
  "نوع المكالمة:": "Arama türü:", "مفتوحة المدة": "Sınırsız süre", "مفتوحة المدة (غير محدودة)": "Sınırsız süre",
  "تكلفة المكالمة:": "Arama ücreti:", "رسوم المكالمة:": "Arama ücreti:", "المبلغ المطلوب شحنه:": "Gereken miktar:",
  "الرصيد بعد الخصم:": "Düşüş sonrası bakiye:", "المتصل به": "Aranan kullanıcı",
  "دقيقة كاملة (60 ثانية)": "Tam bir dakika (60s)", "مجاناً (0 ذهب)": "Ücretsiz (0 Altın)",

  "الاسم مستخدم مسبقا": "Kullanıcı adı zaten kullanımda",
  "اسم المستخدم موجود مسبقا": "Kullanıcı adı zaten mevcut",
  "اسم المستخدم أو كلمة المرور غير صحيحة": "Kullanıcı adı veya şifre yanlış",
  "كلمة المرور يجب أن لا تقل عن 4 خانات": "Şifre en az 4 karakter olmalıdır",
  "أكمل الحقول المطلوبة": "Lütfen gerekli tüm alanları doldurun",
  "اكتب اسم المستخدم": "Lütfen kullanıcı adını girin",
  "كلمة المرور مطلوبة": "Şifre gereklidir",
  "لا يمكن التسجيل من عنوان IP محظور": "Yasaklı bir IP adresinden kayıt olunamaz",
  "تم تجاوز عدد محاولات التسجيل، يرجى المحاولة لاحقاً": "Çok fazla kayıt denemesi. Lütfen daha sonra tekrar deneyin",
  "عنوان IP الخاص بك محظور": "IP adresiniz yasaklandı",
  "حسابك محظور بواسطة الإدارة": "Hesabınız yönetim tarafından yasaklandı",
  "يرجى كتابة اسم صاحب البطاقة": "Lütfen kart sahibinin adını girin",
  "يرجى إدخال رقم بطاقة صراف صحيح (16 رقم)": "Lütfen geçerli bir 16 haneli kart numarası girin",
  "يرجى كتابة تاريخ الانتهاء بصيغة MM/YY": "Lütfen son kullanma tarihini AA/YY formatında girin",
  "يرجى كتابة رمز الأمان CVV المكون من 3 أرقام": "Lütfen 3 haneli CVV güvenlik kodunu girin",
  "اختر مستخدماً للاتصال به": "Aramak için bir kullanıcı seçin",
  "أنت في مكالمة حالياً": "Zaten bir görüşmedesiniz",
  "لا يمكن الاتصال بمستخدم متجاهل": "Engellenen bir kullanıcı aranamaz",
  "عضويتك غير مسموح لها بإجراء المكالمات الخاصة": "Üyeliğiniz özel arama yapmaya izin vermiyor",
  "يرجى الانتظار قليلاً قبل الدخول كزائر": "Misafir olarak girmeden önce lütfen biraz bekleyin",
  "تعذر إنشاء اسم زائر بديل، حاول مرة أخرى": "Alternatif misafir adı oluşturulamadı. Tekrar deneyin",

  "دخول": "Giriş", "إنشاء حساب": "Hesap oluştur", "الخروج": "Çıkış", "الافتراضية": "Varsayılan", "الصوتية": "Sesli",
  "لا يوجد احد في البث المباشر حي الان": "Şu anda canlı yayın yok", "بث مباشر": "Canlı", "مغادرة الغرفة": "Odadan ayrıl", "تحديث الغرف": "Odaları yenile",
  "متصل الان": "Şu an çevrimiçi", "إيموجي": "Emoji", "قائمة الألوان": "Renkler",
  "الغرف": "Odalar", "الخاص": "Özel", "الإشعارات": "Bildirimler", "القائمة": "Menü",
  "الحالات": "Durumlar", "حالتي": "Durumum", "اضغط لإضافة تحديث الحالة": "Durum eklemek için dokunun", "الحالات الحديثة": "Son durumlar",
  "جاري تحميل الحالات...": "Durumlar yükleniyor...", "إضافة حالة": "Durum ekle", "صورة": "Fotoğraf", "فيديو": "Video", "ملف صوتي": "Ses", "كتابة": "Metin",
  "تختفي الحالة تلقائياً بعد 24 ساعة": "Durum 24 saat sonra kaybolur", "إلغاء": "İptal", "حالة كتابية": "Metin durumu", "نشر": "Paylaş",
  "حالة صوتية": "Ses durumu", "المشاهدات": "Görüntüleme", "حذف الحالة": "Durumu sil", "شاهد حالتي": "Durumumu görenler", "مشاهدة": "görüntüleme",
  "لغة الواجهة": "Arayüz dili", "العربية": "Arapça", "عرض الواجهة باللغة العربية": "Arayüzü Arapça göster", "عرض الواجهة باللغة الإنجليزية": "Arayüzü İngilizce göster", "تغيير اللغة": "Dili değiştir",
  "تسجيل الدخول": "Giriş yap", "دخول كزائر/ة": "Misafir olarak gir", "نسيت كلمة السر؟": "Şifrenizi mi unuttunuz?", "استعادة كلمة السر": "Şifre kurtarma",
  "لا يوجد لديك عضوية؟": "Hesabınız yok mu?", "إنشاء حساب مجانًا": "Ücretsiz hesap aç", "النوع": "Cinsiyet", "ذكر": "Erkek", "أنثى": "Kadın", "مجهول": "Gizli",
  "الرجاء قراءة": "Lütfen okuyun", "شروط الاستخدام": "Kullanım Koşulları", "وقراءة": "ve", "سياسة الخصوصية": "Gizlilik Politikası", "تسجيل العضوية": "Kayıt ol",
  "يتطلب الدخول باستخدام عضويتك أو تسجيل عضوية": "Giriş yapın veya kayıt olun", "هذه الميزة متاحة للمستخدمين المسجلين فقط، قم بتسجيل عضوية مجانا الان": "Bu özellik sadece kayıtlı kullanıcılar içindir. Hemen kaydolun.",
  "التسجيل الان": "Hemen kaydol", "لاحقا": "Daha sonra", "عضو مسجل": "Kayıtlı üye", "زائر": "Misafir", "الرد على الرسالة": "Yanıtla",
  "دردشة خاصة": "Özel sohbet", "ارسل هدية": "Hediye gönder", "ترقية هذا المستخدم": "Kullanıcıyı yükselt", "تجاهل": "Engelle", "إلغاء التجاهل": "Engeli kaldır",
  "كتم المستخدم": "Sustur", "إلغاء الكتم": "Susturmayı kaldır", "طرد المستخدم": "Odadan at", "حظر المستخدم": "Yasakla", "المعلومات الشخصية": "Profil", "إغلاق": "Kapat",
  "متجر الهدايا الافتراضية": "Hediye Mağazası", "فاخرة": "Lüks", "جواهر": "Mücevher", "افتراضي": "Varsayılan", "هدية لـ :": "Hediye:", "اختر هدية": "Hediye seç",
  "كمية :": "Miktar:", "تحتاج لتنفق :": "Gereken harcama:", "جائزة هذه الهدية :": "Hediye ödülü:", "يحصل مستلم هذه الهدية على هذا الرصيد": "Alıcı bu bakiyeyi kazanır",
  "رصيدك الحالي :": "Mevcut bakiyeniz:", "الغاء": "İptal", "أرسل": "Gönder", "الترقية": "Üyelik", "قم بترقية عضوية الحساب لتبرز من بين الحشود !": "Öne çıkmak için üyeliğinizi yükseltin!",
  "الترقية الى :": "Yükseltme:", "المدة بالأشهر :": "Ay:", "ترقية": "Yükselt", "حسابي": "Hesabım", "الهدايا": "Hediyeler", "عودة": "Geri",
  "المحادثات الخاصة": "Özel Sohbetler", "الاعضاء المسجلين": "Kayıtlılar", "غير مرغوب فيه": "Spam", "القائمة الرئيسية": "Ana Menü",
  "متصل": "Çevrimiçi", "رصيدك الحالي": "Mevcut bakiye", "شراء رصيد": "Bakiye satın al", "توثيق حسابي": "Hesabı doğrula", "ترقية حسابي": "Hesabı yükselt",
  "تغيير الصورة": "Fotoğrafı değiştir", "هدايا حسابي": "Hediyelerim", "قوائم الحظر": "Yasaklılar", "الاعدادات": "Ayarlar", "تسجيل الخروج": "Çıkış yap",
  "تغيير الحالة": "Durumu değiştir", "مشغول": "Meşgul", "بالخارج": "Dışarıda", "حساب": "Hesap", "الطبيعة": "Doğa", "اخرى": "Diğer", "رفع صورة": "Fotoğraf yükle",
  "اختيار هذه الصورة": "Bu fotoğrafı seç", "عام": "Genel", "تفعيل الصوت": "Sesi aç", "صوت الرسائل الجديدة": "Yeni mesaj sesi",
  "صوت دخول المستخدمين": "Giriş sesi", "اظهار الوقت في الرسائل": "Zamanı göster", "استقبال الرسائل الخاصة": "Özel mesajları al",
  "إشعارات": "Bildirimler", "نظام الكتم": "Susturma sistemi", "نظام الإشراف": "Denetim sistemi", "احصل على توثيق دردشتي": "Doğrulanmış hesap al",
  "إعلان عام": "Genel duyuru", "بواسطة:": "Gönderen:", "الإدارة": "Yönetim", "حسناً": "Tamam", "إشعار": "Bildirim",
  "الحائط": "Duvar", "تحديث الحائط": "Duvarı yenile", "اكتب منشورك هنا...": "Gönderinizi yazın...", "يوتيوب": "YouTube", "رفع فيديو": "Video yükle", "نشر": "Paylaş",
  "إعجاب": "Beğen", "سمايل": "Tepki ver", "تعليق": "Yorum yap", "اكتب تعليقاً...": "Yorum yazın...", "حذف المنشور": "Gönderiyi sil",
  "الدفع بالبطاقة البنكية 💳": "Banka Kartı ile Öde 💳", "خصم آمن وفوري وشحن مباشر للرصيد": "Güvenli ödeme ve anında bakiye yükleme",
  "حامل البطاقة": "Kart Sahibi", "تاريخ الانتهاء": "Son Kullanma", "رمز الأمان (CVV):": "Güvenlik Kodu (CVV):", "تأكيد الخصم والدفع": "Onayla ve Öde",
  "اسم صاحب البطاقة (كما هو على البطاقة):": "Kart sahibinin adı:", "رقم بطاقة الصراف / الائتمان (16 رقم):": "Kart Numarası (16 hane):",
  "المعاملة مشفرة ومحمية بتشفير 256-Bit SSL المصرفي": "İşlemler 256-Bit SSL ile korunmaktadır",
  "الباقة المختارة:": "Seçilen Paket:", "الذهب المستلم:": "Alınan Altın:", "المبلغ المطلوب خصمه:": "Ödenecek Tutar:",
  "الدفع عبر البطاقة البنكية / Debit or Credit Card": "Banka / Kredi Kartı ile Öde", "دفع إلكتروني مباشر ومشفر 256-Bit SSL": "Güvenli 256-Bit SSL doğrudan ödeme",
  "إشعار من النظام": "Sistem Bildirimi", "تم تسجيل الخروج": "Çıkış yapıldı", "تم حفظ الاعدادات ✓": "Ayarlar kaydedildi ✓",
  "مغلقة 🔒": "Kapalı 🔒", "لم يتلقَ هدايا بعد": "Henüz hediye yok", "أنت متواجد في هذه الغرفة حالياً 📍": "Zaten bu odadasınız 📍",
  "اختر غرفة أولا": "Önce bir oda seçin", "اختر هدية أولا": "Önce bir hediye seçin", "ادمن": "Admin", "ادمن غرفة": "Oda admini", "سوبر ادمين": "Süper admin",
  "رسالة عامة": "Genel mesaj", "رسالة": "Mesaj", "اكتب حالتك...": "Durumunuzu yazın...", "الأسم المستعار": "Kullanıcı adı", "اسم المستعار": "Kullanıcı adı",
  "الرقم السري": "Şifre", "العمر": "Yaş", "كلمة المرور": "Şifre", "موضوع الشكوى": "Konu", "اكتب شكواك هنا...": "Şikayetinizi buraya yazın...",
  "جاري تحميل قائمة الغرف...": "Odalar yükleniyor...", "الرسائل": "Mesajlar", "معلومات": "Bilgi", "الإبلاغ": "Şikayet et",
  "دردشة": "Sohbet", "يتم عرض الهدايا التي يتلقاها هذا المستخدم هنا": "Alınan hediyeler burada gösterilir", "أظهر المزيد": "Daha fazla göster",
  "تنفيذ وحفظ": "Değişiklikleri kaydet", "البريد الالكتروني": "E-posta", "الدولة / بلدة": "Ülke / Şehir", "النبذة": "Biyografi", "حفظ": "Kaydet",
  "تلقائي": "Otomatik", "قائمة التجاهل": "Engellenenler listesi", "إعدادات الإشعارات": "Bildirim ayarları"
};

const I18N_SKIP_SELECTOR = ".mtext,.pm-tx,.stext,.room-name,.room-desc,.uname,.mname,#statusViewerText,#statusTextInput,#siteName,#avatarViewName,#announcementText,#announcementSender,.wall-post-text,.wall-post-who b,.wall-comment-bubble b,.wall-comment-bubble p,.head-name,.us-userinfo,.vp-name,.vp-bio,.vg-from,.vg-name,.prof-name,.pm-peer,.pm-hero-name,.sv-info,.room-welcome-text,.robot-system-text,.my-gift-card h4,.my-gift-card b,.blocked-user-info b";

function translateDynamicText(text, lang = APP_LANG) {
  if (!text || lang === "ar") return text;
  const raw = String(text).trim();
  const dict = lang === "es" ? I18N_ES : (lang === "tr" ? I18N_TR : I18N_EN);
  if (dict[raw]) return dict[raw];
  if (dict[text]) return dict[text];
  if (I18N_EN[raw]) return I18N_EN[raw];
  if (I18N_EN[text]) return I18N_EN[text];

  let match;
  // Plan price pattern
  match = text.match(/^(\d+)\s*🪙\s*\/\s*شهر$/);
  if (match) {
    if (lang === "es") return `${match[1]} 🪙 / mes`;
    if (lang === "tr") return `${match[1]} 🪙 / ay`;
    return `${match[1]} 🪙 / month`;
  }
  match = text.match(/^تم خصم (\d+) ذهب رسوم مكالمة مفتوحة المدة \(الرصيد: (\d+)\) 🪙$/);
  if (match) {
    if (lang === "es") return `Se descontaron ${match[1]} Oro por tarifa de llamada ilimitada (Saldo: ${match[2]}) 🪙`;
    if (lang === "tr") return `Sınırsız arama ücreti için ${match[1]} Altın düşüldü (Bakiye: ${match[2]}) 🪙`;
    return `Deducted ${match[1]} Gold for unlimited call fee (Balance: ${match[2]}) 🪙`;
  }
  match = text.match(/^تم إضافة (\d+) ذهب إلى رصيدك \(الرصيد: (\d+)\) 🪙$/);
  if (match) {
    if (lang === "es") return `Se agregaron ${match[1]} Oro a tu saldo (Saldo: ${match[2]}) 🪙`;
    if (lang === "tr") return `Bakiyenize ${match[1]} Altın eklendi (Bakiye: ${match[2]}) 🪙`;
    return `Added ${match[1]} Gold to your balance (Balance: ${match[2]}) 🪙`;
  }
  match = text.match(/^تم قبول طلب ترقية عضويتك إلى (.+)$/);
  if (match) {
    if (lang === "es") return `Tu solicitud de mejora a ${match[1]} fue aprobada`;
    if (lang === "tr") return `${match[1]} üyeliğine yükseltme talebiniz onaylandı`;
    return `Your membership upgrade request to ${match[1]} has been approved`;
  }
  match = text.match(/^تم إرسال طلب ترقية (.+) إلى (.+) للإدارة ✓/);
  if (match) {
    if (lang === "es") return `Solicitud de mejora de ${match[1]} a ${match[2]} enviada ✓`;
    if (lang === "tr") return `${match[1]} için ${match[2]} yükseltme talebi gönderildi ✓`;
    return `Upgrade request for ${match[1]} to ${match[2]} sent to admin ✓`;
  }

  match = text.match(/^مرحباً بـ (.+) في غرفة (.+)$/);
  if (match) {
    if (lang === "es") return `Bienvenido/a ${match[1]} a la sala ${match[2]}`;
    if (lang === "tr") return `${match[1]}, ${match[2]} odasına hoş geldin`;
    return `Welcome ${match[1]} to ${match[2]}`;
  }
  match = text.match(/^(.+) خرج من الغرفة$/);
  if (match) {
    if (lang === "es") return `${match[1]} salió de la sala`;
    if (lang === "tr") return `${match[1]} odadan ayrıldı`;
    return `${match[1]} left the room`;
  }
  match = text.match(/^تم كتم (.+) بواسطة (.+)$/);
  if (match) {
    if (lang === "es") return `${match[1]} fue silenciado/a por ${match[2]}`;
    if (lang === "tr") return `${match[1]}, ${match[2]} tarafından susturuldu`;
    return `${match[1]} was muted by ${match[2]}`;
  }
  match = text.match(/^تم إلغاء كتم (.+) بواسطة (.+)$/);
  if (match) {
    if (lang === "es") return `${match[1]} fue reactivado/a por ${match[2]}`;
    if (lang === "tr") return `${match[1]} susturması kaldırıldı (${match[2]})`;
    return `${match[1]} was unmuted by ${match[2]}`;
  }
  match = text.match(/^تم تجاهل (.+) ومنع الرسائل الخاصة بينكما$/);
  if (match) {
    if (lang === "es") return `${match[1]} fue ignorado/a`;
    if (lang === "tr") return `${match[1]} engellendi`;
    return `${match[1]} was ignored`;
  }
  match = text.match(/^(\d+) تفاعل • (\d+) تعليق$/);
  if (match) {
    if (lang === "es") return `${match[1]} reacciones • ${match[2]} comentarios`;
    if (lang === "tr") return `${match[1]} tepki • ${match[2]} yorum`;
    return `${match[1]} reactions • ${match[2]} comments`;
  }
  match = text.match(/^إظهار المزيد \((\d+)\)$/);
  if (match) {
    if (lang === "es") return `Mostrar más (${match[1]})`;
    if (lang === "tr") return `Daha fazla göster (${match[1]})`;
    return `Show more (${match[1]})`;
  }
  if (text.startsWith("الكمية: ")) return (lang === "es" ? "Cantidad: " : (lang === "tr" ? "Miktar: " : "Quantity: ")) + text.slice("الكمية: ".length);
  if (text.startsWith("اليوم الساعة ")) return (lang === "es" ? "Hoy a las " : (lang === "tr" ? "Bugün saat " : "Today at ")) + text.slice("اليوم الساعة ".length);
  if (text.startsWith("أمس الساعة ")) return (lang === "es" ? "Ayer a las " : (lang === "tr" ? "Dün saat " : "Yesterday at ")) + text.slice("أمس الساعة ".length);
  if (text.startsWith("متصل الان ")) return (lang === "es" ? "En línea ahora " : (lang === "tr" ? "Şu an çevrimiçi " : "Online now ")) + text.slice("متصل الان ".length);
  if (text.startsWith("تم كتم ")) return (lang === "es" ? "Silenciado: " : (lang === "tr" ? "Susturuldu: " : "Muted ")) + text.slice("تم كتم ".length);
  if (text.startsWith("تم إلغاء كتم ")) return (lang === "es" ? "Desilenciado: " : (lang === "tr" ? "Susturması kaldırıldı: " : "Unmuted ")) + text.slice("تم إلغاء كتم ".length);
  if (text.startsWith("تم طرد ")) return (lang === "es" ? "Expulsado: " : (lang === "tr" ? "Odadan atıldı: " : "Kicked ")) + text.slice("تم طرد ".length);
  if (text.startsWith("تم حظر ")) return (lang === "es" ? "Bloqueado: " : (lang === "tr" ? "Yasaklandı: " : "Banned ")) + text.slice("تم حظر ".length);
  if (text.startsWith("تم تجاهل ")) return (lang === "es" ? "Ignorado: " : (lang === "tr" ? "Engellendi: " : "Ignored ")) + text.slice("تم تجاهل ".length);
  if (text.startsWith("مرحبا بك ")) return (lang === "es" ? "Bienvenido/a " : (lang === "tr" ? "Hoş geldiniz " : "Welcome ")) + text.slice("مرحبا بك ".length);
  if (text.startsWith("رصيد: ")) return (lang === "es" ? "Saldo: " : (lang === "tr" ? "Bakiye: " : "Balance: ")) + text.slice("رصيد: ".length);
  if (text.endsWith(" حسب عنوان IP")) return translateDynamicText(text.slice(0, -" حسب عنوان IP".length), lang) + (lang === "es" ? " por IP" : (lang === "tr" ? " (IP)" : " by IP"));
  if (text.endsWith(" من الغرفة")) return translateDynamicText(text.slice(0, -" من الغرفة".length), lang) + (lang === "es" ? " de la sala" : (lang === "tr" ? " (odadan)" : " from the room"));

  return text;
}

function shouldSkipTranslation(node) {
  const el = node.nodeType === 1 ? node : node.parentElement;
  return !el || !!el.closest("script,style," + I18N_SKIP_SELECTOR);
}

function translateTextNode(node) {
  if (!node || node.nodeType !== 3 || shouldSkipTranslation(node)) return;
  if (node.__arabicSource === undefined) node.__arabicSource = node.nodeValue;
  const source = node.__arabicSource;
  const match = source.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const core = match ? match[2] : source;
  const translated = APP_LANG === "ar" ? core : translateDynamicText(core, APP_LANG);
  const next = (match ? match[1] : "") + translated + (match ? match[3] : "");
  if (node.nodeValue !== next) node.nodeValue = next;
}

function translateAttributes(el) {
  if (!el || el.nodeType !== 1 || shouldSkipTranslation(el)) return;
  el.__arabicAttrs = el.__arabicAttrs || {};
  for (const attr of ["placeholder", "title", "aria-label"]) {
    if (!el.hasAttribute(attr)) continue;
    if (el.__arabicAttrs[attr] === undefined) el.__arabicAttrs[attr] = el.getAttribute(attr);
    const source = el.__arabicAttrs[attr];
    el.setAttribute(attr, APP_LANG === "ar" ? source : translateDynamicText(source, APP_LANG));
  }
}

function applyLanguage(root = document.body) {
  if (!root) return;
  if (root.nodeType === 3) return translateTextNode(root);
  translateAttributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === 3) translateTextNode(node);
    else translateAttributes(node);
  }
}

let LANGUAGE_OBSERVER = null;
function setLanguage(language, save = true) {
  APP_LANG = ["en", "es", "tr"].includes(language) ? language : "ar";
  if (save) localStorage.setItem("chat_language", APP_LANG);
  document.documentElement.lang = APP_LANG;
  document.documentElement.dir = APP_LANG === "ar" ? "rtl" : "ltr";

  document.body.classList.remove("lang-en", "lang-es", "lang-tr", "lang-ltr");
  if (APP_LANG !== "ar") {
    document.body.classList.add("lang-" + APP_LANG, "lang-ltr");
  }

  $$(".language-option").forEach(b => b.classList.toggle("active", b.dataset.language === APP_LANG));

  const langNames = { ar: "العربية", en: "English", es: "Español", tr: "Türkçe" };
  const currentLanguage = $("#currentLanguageLabel");
  if (currentLanguage) currentLanguage.textContent = langNames[APP_LANG] || "العربية";

  const defaultTitles = { ar: "الدردشة المباشرة", en: "Live Chat", es: "Chat en Vivo", tr: "Canlı Sohbet" };
  const customTitle = (window.SEO_PAGE_CONFIG && window.SEO_PAGE_CONFIG.title) || SETTINGS.seo_title || SETTINGS.site_name || defaultTitles[APP_LANG];
  document.title = customTitle;

  applyLanguage(document.body);

  if ($('#buyOv') && $('#buyOv').classList.contains('open')) renderGoldPackages();
  if (CUR_ROOM) { renderRooms(); renderRoomsPanel(); }
  if ($('#privOv') && $('#privOv').classList.contains('open')) renderPrivConvs(PRIV_TAB);
}

function initLanguage() {
  setLanguage(APP_LANG, false);
  if (!LANGUAGE_OBSERVER) {
    LANGUAGE_OBSERVER = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) applyLanguage(node);
      }
    });
    LANGUAGE_OBSERVER.observe(document.body, { childList: true, subtree: true });
  }
}

// ---------- أدوات ----------
async function api(url, method = 'GET', body, isForm = false) {
  const o = { method, credentials: 'same-origin', headers: { 'X-Chat-Client': '1' } };
  if (CHAT_TOKEN) o.headers['X-Chat-Token'] = CHAT_TOKEN;
  if (body && !isForm) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
  if (body && isForm) o.body = body;
  const r = await fetch(url, o);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw d;
  return d;
}
let ACTIVE_UPLOAD_ID = 0, UPLOAD_HIDE_TIMER = null;
function updateUploadProgress(uploadId, label, percent) {
  if (uploadId !== ACTIVE_UPLOAD_ID) return;
  const box = $('#uploadProgress');
  const value = Math.max(0, Math.min(100, Math.round(percent || 0)));
  clearTimeout(UPLOAD_HIDE_TIMER);
  $('#uploadProgressLabel').textContent = label || 'جاري رفع الملف...';
  $('#uploadProgressPercent').textContent = value + '%';
  $('#uploadProgressFill').style.width = value + '%';
  box.setAttribute('aria-valuenow', String(value));
  box.setAttribute('aria-hidden', 'false');
  box.classList.remove('hidden');
}
function finishUploadProgress(uploadId, success) {
  if (uploadId !== ACTIVE_UPLOAD_ID) return;
  if (success) updateUploadProgress(uploadId, $('#uploadProgressLabel').textContent, 100);
  UPLOAD_HIDE_TIMER = setTimeout(() => {
    if (uploadId !== ACTIVE_UPLOAD_ID) return;
    $('#uploadProgress').classList.add('hidden');
    $('#uploadProgress').setAttribute('aria-hidden', 'true');
  }, success ? 550 : 250);
}
function beginOperationProgress(label) {
  const uploadId = ++ACTIVE_UPLOAD_ID;
  updateUploadProgress(uploadId, label, 8);
  return uploadId;
}
function uploadFormWithProgress(url, formData, label) {
  const uploadId = ++ACTIVE_UPLOAD_ID;
  updateUploadProgress(uploadId, label, 1);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.withCredentials = true;
    xhr.timeout = 5 * 60 * 1000;
    xhr.setRequestHeader('X-Chat-Client', '1');
    if (CHAT_TOKEN) xhr.setRequestHeader('X-Chat-Token', CHAT_TOKEN);
    xhr.upload.onprogress = event => {
      if (!event.lengthComputable) return;
      updateUploadProgress(uploadId, label, Math.min(99, (event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) { }
      const ok = xhr.status >= 200 && xhr.status < 300;
      finishUploadProgress(uploadId, ok);
      if (ok) resolve(data); else reject(data.error ? data : { error: 'تعذر رفع الملف' });
    };
    xhr.onerror = () => { finishUploadProgress(uploadId, false); reject({ error: 'تعذر الاتصال أثناء رفع الملف' }); };
    xhr.ontimeout = () => { finishUploadProgress(uploadId, false); reject({ error: 'انتهت مهلة رفع الملف' }); };
    xhr.onabort = () => { finishUploadProgress(uploadId, false); reject({ error: 'تم إلغاء رفع الملف' }); };
    xhr.send(formData);
  });
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(msg, ok = true) {
  const t = $('#toast');
  const rawText = String(msg || '');
  const text = APP_LANG === 'ar' ? rawText : translateDynamicText(rawText, APP_LANG);
  t.textContent = text;
  t.style.background = ok ? 'rgba(17,24,39,.94)' : 'rgba(220,38,38,.90)';
  t.classList.add('show');
  clearTimeout(t._tm);
  // الرسائل الطويلة تبقى مدة أطول حتى يمكن قراءة جميع كلماتها.
  const duration = Math.min(6000, Math.max(2600, text.length * 45));
  t._tm = setTimeout(() => t.classList.remove('show'), duration);
}
function openOv(id) { $('#' + id).classList.add('open'); refreshNav(); }
function closeOv(id) { $('#' + id).classList.remove('open'); refreshNav(); }
function refreshNav() {
  const navPages = { menuOv: 'menu', notifOv: 'notifs', privOv: 'private', wallOv: 'wall' };
  let openNav = null;
  for (const id in navPages) if (document.getElementById(id) && document.getElementById(id).classList.contains('open')) openNav = navPages[id];
  const inChat = $('#chatScreen').classList.contains('active');
  document.querySelector('.bottomnav').classList.toggle('show', inChat || !!openNav);
  $$('.bn-item').forEach(b => b.classList.toggle('active', b.dataset.nav === (openNav || 'rooms')));
}
$$('[data-close]').forEach(b => b.addEventListener('click', () => closeOv(b.dataset.close)));

const GENDER_IMG = { boy: 'boy.png', girl: 'girl.png', secret: 'secret.png' };
const MEM_NAMES = { vip: 'عضوية النخبة', premium: 'عضوية Premium', plus: 'عضوية Plus', mmez: 'عضوية مميز', none: 'عضو مسجل' };
const MEM_COLORS = { vip: '#b8860b', premium: '#d63384', plus: '#16a34a', mmez: '#dc2626', none: '#c2185b' };
const RANK_NAMES = { supermaster: 'ملك الدردشة 👑', superadmin: 'سوبر ادمين', admin: 'ادمن', roomadmin: 'ادمن غرفة', user: '' };
const RANK_COLORS = { supermaster: '#d97706', superadmin: '#7c3aed', admin: '#ea580c', roomadmin: '#0e9fdd' };
function badgeOf(u) {
  if (!u) return 'guest.png';
  if (u.badge) return u.badge;
  if (u.rank === 'supermaster' || u.rank === 'superadmin') return 'superadmin.png';
  if (u.rank === 'admin') return 'admin.png';
  if (u.rank === 'roomadmin') return 'roomadmin.png';
  if (u.membership === 'mmez') return 'mmez.png';
  if (u.membership === 'vip') return 'vip.png';
  if (u.membership === 'premium') return 'premium.png';
  if (u.membership === 'plus') return 'plus.png';
  if (u.registered) return 'register.png';
  return 'guest.png';
}
// الصورة الرمزية: قد تكون مسار /.. أو "emoji:🙂:#hex" أو فارغة
function avatarHtml(avatar, cls = '') {
  if (avatar && avatar.startsWith('/')) return `<img class="${cls}" src="${esc(avatar)}">`;
  if (avatar && avatar.startsWith('emoji:')) {
    const [, e, bg] = avatar.split(':');
    return `<span class="${cls}" style="background:${bg}">${e}</span>`;
  }
  return `<img class="${cls}" src="/avatars/default.png">`;   // الصورة الافتراضية للجميع
}
function statusDot(st) { return st === 'busy' ? 'red' : st === 'away' ? 'orange' : 'green'; }
function statusName(st) { return st === 'busy' ? 'مشغول' : st === 'away' ? 'بالخارج' : 'متصل'; }
async function loadIgnoredUsers() {
  if (!ME || !CHAT_TOKEN) return [];
  try {
    const list = await api('/api/ignores');
    IGNORED_USERS = new Set(list.map(u => +u.id));
    if (CUR_ROOM) renderUsers();
    return list;
  } catch (e) {
    IGNORED_USERS = new Set();
    return [];
  }
}
// وقت بصيغة 12 ساعة: 05:58 PM
function timeHm(ts) {
  const d = new Date(ts * 1000);
  let h = d.getHours();
  const ap = h < 12 ? 'AM' : 'PM';
  h = h % 12 || 12;
  return String(h).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + ap;
}
// لون ووزن الاسم حسب الرتبة/العضوية (سوبر ادمن > ادمن > ادمن غرفة > مميز > VIP > بلس > بريميوم > مسجل > زائر)
const DEFAULT_BIO = '';
function rankWeight(u) {
  if (!u) return 1;
  if (u.rank === 'supermaster') return 10;
  if (u.rank === 'superadmin') return 9;
  if (u.rank === 'admin') return 8;
  if (u.rank === 'roomadmin') return 7;
  if (u.membership === 'mmez') return 6;
  if (u.membership === 'vip') return 5;
  if (u.membership === 'plus') return 4;
  if (u.membership === 'premium') return 3;
  if (u.registered) return 2;
  return 1;   // زائر
}
function userColor(u) {
  if (!u) return '#000000';
  if (u.rank === 'supermaster' || u.rank === 'superadmin' || u.rank === 'admin') return '#000000';   // أسود عريض
  if (u.rank === 'roomadmin') return '#e03131';                          // أحمر
  if (u.membership === 'mmez') return '#e91e8c';                         // زهري
  if (u.membership === 'vip') return '#1479f2';                          // أزرق
  if (u.membership === 'plus') return '#2e9e44';                         // أخضر
  if (u.membership === 'premium') return '#38b6ff';                      // أزرق فاتح
  if (u.registered) return '#795548';                                    // بني (مسجل)
  return '#000000';                                                      // زائر أسود رقيق
}
function userWeight(u) {
  if (u && (u.rank === 'supermaster' || u.rank === 'superadmin' || u.rank === 'admin')) return 900;  // عريض
  if (u && !u.registered) return 400;                                    // الزائر خط رقيق
  return 800;
}
// صوت تنبيه
let AC = null;
function beep(freq = 660, dur = .12) {
  if (!PREFS.snd_all) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.connect(g); g.connect(AC.destination);
    o.frequency.value = freq; g.gain.value = .06;
    o.start(); g.gain.exponentialRampToValueAtTime(.0001, AC.currentTime + dur);
    o.stop(AC.currentTime + dur + .02);
  } catch (e) { }
}

const OBFUSCATE_KEY = 'NujumSecretSyncKey2026';
function decodeObfuscatedPayload(b64) {
  try {
    const raw = atob(b64);
    let out = '';
    for (let i = 0; i < raw.length; i++) {
      out += String.fromCharCode(raw.charCodeAt(i) ^ OBFUSCATE_KEY.charCodeAt(i % OBFUSCATE_KEY.length));
    }
    return JSON.parse(decodeURIComponent(out));
  } catch (e) {
    try {
      const raw = atob(b64);
      let out = '';
      for (let i = 0; i < raw.length; i++) {
        out += String.fromCharCode(raw.charCodeAt(i) ^ OBFUSCATE_KEY.charCodeAt(i % OBFUSCATE_KEY.length));
      }
      return JSON.parse(out);
    } catch (e2) {
      return {};
    }
  }
}
function parseClientSettings(res) {
  if (res && res._m) {
    return decodeObfuscatedPayload(res._m);
  }
  return res || {};
}

// =====================================================
//  الإقلاع
// =====================================================
(async function init() {
  initLanguage();
  try {
    SETTINGS = parseClientSettings(await api('/api/public-settings'));
    const userExplicitLang = localStorage.getItem("chat_language");
    if (!userExplicitLang && SETTINGS.default_language && ["ar", "en", "es", "tr"].includes(SETTINGS.default_language)) {
      setLanguage(SETTINGS.default_language, false);
    }
  } catch (e) { }
  if (window.SEO_PAGE_CONFIG) {
    if (window.SEO_PAGE_CONFIG.site_name) SETTINGS.site_name = window.SEO_PAGE_CONFIG.site_name;
    if (window.SEO_PAGE_CONFIG.logo_image) SETTINGS.logo_url = window.SEO_PAGE_CONFIG.logo_image;
  }
  applySettings();
  applyPrefsToSwitches();
  // لا نستعيد هوية من الكوكي. CHAT_TOKEN يبدأ فارغاً في كل تحميل للصفحة.
  const d = await api('/api/chat/me');
  if (d.user && CHAT_TOKEN) {
    ME = d.user; MYBADGE = d.badge; onLoggedIn(); connectSocketRetry();
  }
  await loadRooms();
})();

function applySettings() {
  const isLtr = APP_LANG !== 'ar';
  document.body.className = 'skin-' + (SETTINGS.skin || 'default') + (isLtr ? ' lang-' + APP_LANG + ' lang-ltr' : '');
  const activeSiteName = (window.SEO_PAGE_CONFIG && window.SEO_PAGE_CONFIG.site_name) || SETTINGS.site_name || 'الدردشة';
  $('#siteName').textContent = activeSiteName;
  if (SETTINGS.logo_url) {
    $('#siteLogo').innerHTML = `<img src="${esc(SETTINGS.logo_url)}" alt="">`;
  }
  if (SETTINGS.show_smiles !== '1') $('#btnEmoji').style.display = 'none';
  if (SETTINGS.show_voice !== '1') $('#btnMic').style.display = 'none';
  if (SETTINGS.show_image !== '1') $('#btnCam').style.display = 'none';

  const defaultTitles = { ar: "الدردشة المباشرة", en: "Live Chat", es: "Chat en Vivo", tr: "Canlı Sohbet" };
  const customTitle = (window.SEO_PAGE_CONFIG && window.SEO_PAGE_CONFIG.title) || SETTINGS.seo_title || SETTINGS.site_name || defaultTitles[APP_LANG];
  document.title = customTitle;

  const fav = (window.SEO_PAGE_CONFIG && window.SEO_PAGE_CONFIG.favicon) || SETTINGS.favicon_url;
  if (fav) {
    let link = document.querySelector('link[rel="icon"]') || document.querySelector('link[rel="shortcut icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = fav;
  }

  const fs = Math.min(40, Math.max(10, +(SETTINGS.font_size || 14)));
  document.documentElement.style.setProperty('--msg-font-size', fs + 'px');
  $$('#msgArea .mtext, #msgArea .message-content').forEach(el => {
    el.style.fontSize = fs + 'px';
  });
  const currentSiteName = (window.SEO_PAGE_CONFIG && window.SEO_PAGE_CONFIG.site_name) || SETTINGS.site_name || 'الدردشة العربية';
  $$('.pm-water').forEach(el => {
    el.textContent = currentSiteName;
  });
  const msgInp = $('#msgInput');
  if (msgInp) msgInp.style.fontSize = fs + 'px';
  $$('.ci-field').forEach(el => { el.style.fontSize = fs + 'px'; });
}
function applyPrefsToSwitches() {
  $$('#setList .switch').forEach(sw => {
    const k = sw.dataset.set;
    sw.classList.toggle('on', !!PREFS[k]);
  });
}

let CONNECTION_INTERRUPTED = false;
function showConnectionOverlay(status, loading = true) {
  if (!ME || !CHAT_TOKEN) return;
  const overlay = $('#connectionOverlay');
  const statusText = status || (navigator.onLine ? 'جارٍ إعادة الاتصال...' : 'بانتظار عودة اتصال الإنترنت...');
  $('#connectionStatus').textContent = APP_LANG === 'en' ? translateDynamicText(statusText) : statusText;
  $('#connectionLoading').classList.toggle('stopped', !loading);
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
}
function hideConnectionOverlay() {
  const overlay = $('#connectionOverlay');
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  $('#connectionLoading').classList.remove('stopped');
}
function finishSocketRestore(socket, restoredRoom) {
  if (socket !== SOCKET) return;
  const wasInterrupted = CONNECTION_INTERRUPTED;
  CONNECTION_INTERRUPTED = false;
  hideConnectionOverlay();
  if (wasInterrupted) toast(restoredRoom ? 'تم استعادة الاتصال والغرفة' : 'تم استعادة الاتصال');
}
function restoreCurrentRoom(socket, attempt = 0) {
  if (socket !== SOCKET || !socket.connected) return;
  const room = CUR_ROOM;
  if (!room) return finishSocketRestore(socket, false);
  const roomId = +room.id;
  if (attempt) {
    const status = APP_LANG === 'en' ? `Reconnection attempt ${attempt + 1}...` : `محاولة إعادة الاتصال رقم ${attempt + 1}...`;
    showConnectionOverlay(status, true);
  }
  // timeout + إعادة المحاولة يعالجان وصول connect قبل انتهاء تهيئة مستمعي الخادم.
  socket.timeout(2600).emit('join', roomId, ROOM_PWD[roomId] || '', { hidden: !!ROOM_HIDDEN[roomId] }, (error, result) => {
    if (socket !== SOCKET || !socket.connected || !CUR_ROOM || +CUR_ROOM.id !== roomId) return;
    if (error) {
      if (attempt < 5) return setTimeout(() => restoreCurrentRoom(socket, attempt + 1), Math.min(2000, 350 + attempt * 300));
      return showConnectionOverlay('تعذر الاتصال، اضغط على زر اتصال للمحاولة مجددًا', false);
    }
    if (result && result.ok) {
      ROOM_HIDDEN[roomId] = !!result.hidden;
      api('/api/rooms/' + roomId + '/users').then(users => {
        if (CUR_ROOM && +CUR_ROOM.id === roomId) { ROOM_USERS = users; renderUsers(); }
      }).catch(() => { });
      return finishSocketRestore(socket, true);
    }
    hideConnectionOverlay();
    CONNECTION_INTERRUPTED = false;
    delete ROOM_PWD[roomId];
    delete ROOM_HIDDEN[roomId];
    leaveRoom();
    showScreen('rooms');
    if (result && result.reason === 'password') openPassOv(room, false);
    else if (result && result.reason === 'wrong_pass') openPassOv(room, true);
    else toast((result && result.text) || 'تعذر استعادة دخول الغرفة', false);
  });
}
function requestSocketReconnect() {
  if (!ME || !CHAT_TOKEN) return;
  CONNECTION_INTERRUPTED = true;
  if (!navigator.onLine) return showConnectionOverlay('بانتظار عودة اتصال الإنترنت...', true);
  showConnectionOverlay('جارٍ إعادة الاتصال...', true);
  if (!SOCKET) return connectSocketRetry();
  SOCKET.auth = { client: 'chat', token: CHAT_TOKEN };
  if (SOCKET.connected) return restoreCurrentRoom(SOCKET);
  SOCKET.connect();
}
$('#reconnectBtn').onclick = requestSocketReconnect;
window.addEventListener('offline', () => {
  if (!ME || !CHAT_TOKEN) return;
  CONNECTION_INTERRUPTED = true;
  showConnectionOverlay('بانتظار عودة اتصال الإنترنت...', true);
});
window.addEventListener('online', () => {
  if (CONNECTION_INTERRUPTED && ME && CHAT_TOKEN) requestSocketReconnect();
});

function connectSocket() {
  if (!ME || !CHAT_TOKEN) return;
  // هوية هذه الصفحة تنتقل إلى الخادم عبر WebSocket ولا تعتمد على كوكي مشترك بين التبويبات.
  // إعادة الاتصال غير محدودة مع تدرج زمني، مع بقاء الرمز في ذاكرة هذه الصفحة فقط.
  const socket = io({
    auth: { client: 'chat', token: CHAT_TOKEN },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 7000,
    randomizationFactor: .35,
    timeout: 10000
  });
  SOCKET = socket;
  // بعد كل اتصال نعيد الانضمام للغرفة نفسها ثم نخفي إشعار الانقطاع.
  socket.on('connect', () => restoreCurrentRoom(socket));
  SOCKET.on('msg', (m) => {
    if (CUR_ROOM && m.room_id === CUR_ROOM.id) {
      renderMsg(m);
      scrollBottom();
      if (m.type === 'gift') triggerGiftCelebration(parseExtra(m));
      else if (m.type === 'join' && PREFS.snd_join && SETTINGS.snd_join === '1') beep(520, .1);
      else if (m.type === 'msg' && PREFS.snd_msg && SETTINGS.snd_msg === '1') beep(740, .07);
    }
  });
  SOCKET.on('roomUsers', ({ roomId, users, count }) => {
    if (CUR_ROOM && roomId === CUR_ROOM.id) { ROOM_USERS = users; renderUsers(); }
  });
  SOCKET.on('hidden_mode_changed', ({ roomId, hidden }) => {
    ROOM_HIDDEN[+roomId] = !!hidden;
    if (!hidden && CUR_ROOM && +roomId === CUR_ROOM.id) toast('تم إيقاف الدخول المخفي من لوحة الإدارة');
  });
  SOCKET.on('roomCounts', (c) => { ROOM_COUNTS = c; renderRooms(); });
  SOCKET.on('private', (p) => {
    // حماية إضافية للواجهة؛ المنع الأساسي والمتبادل مطبق على الخادم.
    if (p.from_id !== ME.id && IGNORED_USERS.has(+p.from_id)) return;
    if (PM_WITH && (p.from_id === PM_WITH.id || p.from_id === ME.id)) {
      renderPm(p); scrollPm();
    } else if (p.from_id !== ME.id) {
      PRIV_UNREAD++;
      updatePrivBadge();
      if (PREFS.pm_recv) beep(880, .15);
    }
    if ($('#privOv').classList.contains('open')) renderPrivConvs(PRIV_TAB);
  });
  SOCKET.on('ignore_changed', async change => {
    if (!ME) return;
    if (change.ignored !== undefined) await loadIgnoredUsers();
    if ((change.ignored || change.ignoredByOther) && PM_WITH && +PM_WITH.id === +change.otherId) {
      closeOv('pmOv');
      PM_WITH = null;
      toast('تم إغلاق المحادثة بسبب التجاهل', false);
    }
    if ($('#privOv').classList.contains('open')) renderPrivConvs(PRIV_TAB);
  });
  SOCKET.on('notify', (n) => {
    if (ME && typeof n.balance === 'number') { ME.balance = n.balance; $('#menuBal').textContent = n.balance; }
    pushNotif(n.icon, n.text, n); toast(n.text); beep(880, .15);
  });
  // تحديث فوري لحساب وبيانات المستخدم عند التعديل من لوحة الإدارة
  SOCKET.on('user_sync', ({ user, badge }) => {
    if (!ME || !user || +ME.id !== +user.id) return;
    const oldName = ME.username;
    const oldBalance = +ME.balance || 0;
    Object.assign(ME, user);
    if (badge) MYBADGE = badge;

    // تحديث رصيد الذهب في الهيدر والقائمة والمتجر فورياً
    const mb = $('#menuBal');
    if (mb) mb.textContent = ME.balance;

    // تحديث الاسم في الهيدر والملف الشخصي والقائمة
    const headName = $('#headName');
    if (headName) headName.textContent = ME.username;
    const menuName = $('#menuName');
    if (menuName) menuName.textContent = ME.username;
    const profName = $('#profName');
    if (profName) profName.textContent = ME.username;

    // تحديث الصورة في الهيدر والقائمة
    const headAva = $('#headAva');
    if (headAva) headAva.innerHTML = avatarHtml(ME.avatar);
    const menuAva = $('#menuAva');
    if (menuAva) menuAva.innerHTML = avatarHtml(ME.avatar) + `<span class="dot ${statusDot(ME.status)}"></span>`;

    // إشعار المستخدم فوراً بالتعديل
    if (oldBalance !== +ME.balance) {
      const diff = (+ME.balance) - oldBalance;
      if (diff > 0) {
        toast(`تمت إضافة ${diff} ذهب إلى رصيدك بواسطة الإدارة (الرصيد: ${ME.balance}) 🪙`);
        beep(880, .2);
      } else if (diff < 0) {
        toast(`تم تعديل رصيدك بواسطة الإدارة (الرصيد: ${ME.balance}) 🪙`);
      }
    }
    if (oldName && oldName !== ME.username) {
      toast(`تم تغيير اسم حسابك إلى: ${ME.username} بنجاح ✨`);
    }

    renderRooms();
    if (CUR_ROOM) renderUsers();
  });
  // مزامنة فورية: أي تعديل من لوحة الإدارة يطبَّق مباشرة دون تحديث الصفحة
  SOCKET.on('sync', async () => {
    try {
      SETTINGS = parseClientSettings(await api('/api/public-settings'));
      if (SETTINGS.default_language && ["ar", "en", "es", "tr"].includes(SETTINGS.default_language)) {
        setLanguage(SETTINGS.default_language, false);
      }
      applySettings();
    } catch (e) { }
    try { GIFTS = await api('/api/gifts'); } catch (e) { }
    loadCustomEmojis();
    loadRooms();          // تحديث قائمة الغرف واللوحة المضغوطة داخل الغرفة
    if (typeof renderRoomsPanel === 'function') renderRoomsPanel();
    if ($('#avaOv') && $('#avaOv').classList.contains('open')) renderAvaGrid(AVA_CAT);
  });
  SOCKET.on('avatars_changed', async () => {
    if ($('#avaOv') && $('#avaOv').classList.contains('open')) {
      await renderAvaGrid(AVA_CAT);
    }
  });
  SOCKET.on('language_changed', data => {
    if (data && data.default_language && ["ar", "en", "es", "tr"].includes(data.default_language)) {
      SETTINGS.default_language = data.default_language;
      setLanguage(data.default_language, false);
      applySettings();
    }
  });
  SOCKET.on('announce', announcement => {
    const a = normalizeAnnouncement(announcement);
    pushNotif('announcement', a.text, a);
    openAnnouncementPopup(a);
    beep(660, .2);
  });
  SOCKET.on('membership_changed', ({ plan }) => { if (ME) { ME.membership = plan; MYBADGE = badgeOf(ME); } });
  SOCKET.on('wall_changed', change => {
    if (!$('#wallOv').classList.contains('open')) return;
    if (change && change.action === 'deleted') {
      const card = $(`#wallList .wall-post[data-id="${+change.postId}"]`); if (card) card.remove();
      WALL_POSTS = WALL_POSTS.filter(post => +post.id !== +change.postId);
    } else if (change && change.action === 'created') {
      // نضيف البطاقة الجديدة وحدها؛ لا نستبدل البطاقات الحالية ولا iframe قيد التشغيل.
      fetchAndInsertWallPost(change.postId);
    }
    // التعليقات والتفاعلات لا تعيد بناء القالب حتى يستمر الفيديو دون توقف أو إعادة تشغيل.
  });
  SOCKET.on('statuses_changed', change => {
    const statusPageOpen = $('#statusOv').classList.contains('open');
    if (change && change.action === 'created' && ME && +change.userId !== +ME.id && !statusPageOpen) {
      STATUS_UNREAD++;
      updateStatusUnreadBadge();
    }
    if (statusPageOpen) loadStatuses();
  });
  SOCKET.on('verification_changed', ({ username, verified }) => {
    ROOM_USERS.forEach(u => { if (u.username === username) u.verified = verified ? 1 : 0; });
    if (CUR_TARGET && CUR_TARGET.username === username) CUR_TARGET.verified = verified ? 1 : 0;
    if (PM_WITH && PM_WITH.username === username) PM_WITH.verified = verified ? 1 : 0;
    STATUSES.forEach(s => { if (s.username === username) s.verified = verified ? 1 : 0; });
    renderUsers();
    if ($('#statusOv').classList.contains('open')) renderStatuses();
    if ($('#privOv').classList.contains('open')) renderPrivConvs(PRIV_TAB);
    $$('#msgArea .mname').forEach(nameEl => {
      if (nameEl.dataset.username !== username) return;
      const oldCheck = nameEl.querySelector('.vcheck');
      if (verified && !oldCheck) nameEl.insertAdjacentHTML('beforeend', ' <i class="f7-icons vcheck">checkmark_seal_fill</i>');
      if (!verified && oldCheck) oldCheck.remove();
    });
  });
  SOCKET.on('status_viewed', ({ statusId }) => {
    const s = STATUSES.find(x => x.id === +statusId);
    if (s && s.is_owner) {
      s.view_count = (+s.view_count || 0) + 1;
      if (CURRENT_STATUS && CURRENT_STATUS.id === s.id) $('#statusViewCount').textContent = s.view_count;
    }
  });
  SOCKET.on('mute_changed', ({ muted }) => {
    if (!ME) return;
    ME.muted = muted ? 1 : 0;
    // إن كُتم المذيع وهو يبث، أوقف التدفّق المحلي فوراً؛ الخادم أنزله أيضاً من البث.
    if (ME.muted && BCAST && BCAST.isHost) { bcastResetState(); bcastRenderBar(); }
    toast(muted ? 'قامت الإدارة بكتمك' : 'قامت الإدارة بإلغاء كتمك', !muted);
  });
  SOCKET.on('kicked', ({ roomId, text }) => {
    if (!CUR_ROOM || +roomId !== CUR_ROOM.id) return;
    closeOv('userSheet');
    leaveRoom();
    showScreen('rooms');
    toast(text || 'تم طردك من الغرفة', false);
  });
  SOCKET.on('banned', ({ text }) => {
    toast(text || 'تم حظرك بواسطة الإدارة', false);
    CHAT_TOKEN = '';
    hideConnectionOverlay();
    setTimeout(() => location.reload(), 2200);
  });
  socket.on('disconnect', reason => {
    if (socket !== SOCKET || !ME || !CHAT_TOKEN || reason === 'io client disconnect') return;
    CONNECTION_INTERRUPTED = true;
    showConnectionOverlay(navigator.onLine ? 'جارٍ إعادة الاتصال...' : 'بانتظار عودة اتصال الإنترنت...', true);
    // فصل الخادم لا يعاد تلقائياً بواسطة Socket.IO، لذا نشغّل المحاولة يدوياً.
    if (reason === 'io server disconnect') setTimeout(() => {
      if (socket === SOCKET && ME && CHAT_TOKEN && !socket.connected) socket.connect();
    }, 900);
  });
  socket.on('connect_error', () => {
    if (socket !== SOCKET || !ME || !CHAT_TOKEN) return;
    CONNECTION_INTERRUPTED = true;
    showConnectionOverlay(navigator.onLine ? 'جارٍ إعادة الاتصال...' : 'بانتظار عودة اتصال الإنترنت...', true);
  });
  socket.io.on('reconnect_attempt', attempt => {
    if (socket !== SOCKET || !ME || !CHAT_TOKEN) return;
    CONNECTION_INTERRUPTED = true;
    const status = APP_LANG === 'en' ? `Reconnection attempt ${attempt}...` : `محاولة إعادة الاتصال رقم ${attempt}...`;
    showConnectionOverlay(status, true);
  });
  socket.io.on('reconnect_failed', () => {
    if (socket === SOCKET && ME && CHAT_TOKEN)
      showConnectionOverlay('تعذر الاتصال، اضغط على زر اتصال للمحاولة مجددًا', false);
  });
  SOCKET.on('err', (t) => toast(t, false));

  // ===== أحداث المكالمات الصوتية الخاصة (1-to-1 WebRTC) =====
  SOCKET.on('call:incoming', ({ from }) => {
    handleIncomingPrivateCall(from);
  });
  SOCKET.on('call:accepted', async ({ from }) => {
    await handlePrivateCallAccepted(from);
  });
  SOCKET.on('call:rejected', ({ fromId, reason, error }) => {
    handlePrivateCallRejected(fromId, reason, error);
  });
  SOCKET.on('call:cancelled', ({ fromId }) => {
    handlePrivateCallCancelled(fromId);
  });
  SOCKET.on('call:ringing', () => {
    const status = $('#pmCallStatus');
    if (status && PM_CALL) status.textContent = 'يرن الآن...';
  });
  SOCKET.on('call:signal', async ({ fromId, data }) => {
    await handlePrivateCallSignal(fromId, data);
  });
  SOCKET.on('call:gold_deducted', ({ balance, amount, minute }) => {
    if (ME) {
      ME.balance = balance;
      const mb = $('#menuBal');
      if (mb) mb.textContent = balance;
      toast(`تم خصم ${amount} ذهب رسوم المكالمة (الرصيد: ${balance}) 🪙`);
    }
  });
  SOCKET.on('call:trial_used', ({ free_call_used }) => {
    if (ME) {
      ME.free_call_used = free_call_used !== undefined ? free_call_used : 1;
    }
  });
  SOCKET.on('call:ended', ({ fromId, reason, message }) => {
    handlePrivateCallEnded(fromId, reason, message);
  });

  // ---------- أحداث البث المباشر (متعدد المذيعين) ----------
  SOCKET.on('bcast:started', ({ roomId, mode, host, hosts, primaryHostId }) => {
    ROOM_BCAST[roomId] = { mode, hosts, primaryHostId, viewers: 0 };
    if (CUR_ROOM && +roomId === CUR_ROOM.id) {
      bcastRenderBar();
      if (ME && host.id === ME.id) return; // أنا المذيع، الشاشة مفتوحة أصلاً من bcastStart
      if (mode === 'audio') bcastViewerAutoConnectAudio(roomId, hosts);
    }
  });
  // مذيع إضافي انضم لبث قائم بالفعل في الغرفة
  SOCKET.on('bcast:host_joined', ({ roomId, host, hosts, primaryHostId }) => {
    if (ROOM_BCAST[roomId]) { ROOM_BCAST[roomId].hosts = hosts; ROOM_BCAST[roomId].primaryHostId = primaryHostId; }
    if (!CUR_ROOM || +roomId !== CUR_ROOM.id) return;
    bcastRenderBar();
    if (ME && host.id === ME.id) return; // هذا أنا، تمت التهيئة بالفعل من bcastStart
    if (!BCAST || BCAST.roomId !== +roomId) return;
    // بث صوتي أو أنا نفسي أحد المذيعين: سجّل المذيع الجديد فوراً (سماع/اتصال تلقائي بين المذيعين).
    // أما مُشاهد فيديو فلا يُسجَّل له مذيعون جدد تلقائياً — يجب أن يطلب مشاهدة مذيع بعينه ويوافق عليه أولاً،
    // كي لا يظهر له مذيعون لم يوافقوا على مشاهدته ولا يشاهد أكثر من مذيع واحد في نفس الوقت.
    if (BCAST.isHost || BCAST.mode === 'audio') bcastRegisterHost(host);
  });
  SOCKET.on('bcast:stopped', ({ roomId }) => {
    delete ROOM_BCAST[roomId];
    if (CUR_ROOM && +roomId === CUR_ROOM.id) {
      const wasHost = BCAST && BCAST.isHost;
      toast(wasHost ? 'تم إنهاء البث' : 'انتهى البث المباشر', wasHost);
      bcastResetState();
      bcastRenderBar();
    }
  });
  // أحد المذيعين المشاركين غادر، لكن البث مستمر مع البقية
  SOCKET.on('bcast:host_left', ({ roomId, hostId }) => {
    if (ROOM_BCAST[roomId]) ROOM_BCAST[roomId].hosts = ROOM_BCAST[roomId].hosts.filter(h => h.id !== hostId);
    if (!CUR_ROOM || +roomId !== CUR_ROOM.id) return;
    bcastRenderBar();
    if (BCAST && BCAST.roomId === +roomId) bcastUnregisterHost(hostId);
  });
  // وصول طلب مشاهدة جديد (تصل لكل المذيعين الحاليين)
  SOCKET.on('bcast:watch_request', ({ roomId, user }) => {
    if (!BCAST || !BCAST.isHost || BCAST.roomId !== +roomId) return;
    bcastRenderRequestCard(user);
  });
  SOCKET.on('bcast:watch_cancelled', ({ userId }) => {
    const card = $(`#bcastRequests .bcast-req-card[data-uid="${userId}"]`);
    if (card) card.remove();
  });
  // رد أحد المذيعين على طلب المشاهدة (للمشاهد)
  SOCKET.on('bcast:watch_response', ({ roomId, accept, hosts }) => {
    if (!BCAST || BCAST.roomId !== +roomId) return;
    if (accept) {
      BCAST.watchState = 'accepted';
      $('#bcastWaitMsg').hidden = true;
      $('#bcastLeaveBtn').hidden = false;
      (hosts || []).forEach(h => bcastRegisterHost(h));
      bcastFlushSignalQueue();
    } else {
      toast('رفض المذيع طلب مشاهدتك للبث', false);
      bcastResetState();
      bcastRenderBar();
    }
  });
  // مشاهد/مستمع غادر (لكل مذيع لديه اتصال به)
  SOCKET.on('bcast:viewer_left', ({ userId }) => {
    if (!BCAST || !BCAST.isHost) return;
    bcastClosePeer(userId);
    const card = $(`#bcastRequests .bcast-req-card[data-uid="${userId}"]`);
    if (card) card.remove();
    bcastUpdateHeader();
  });
  // مستمع جديد دخل الغرفة الصوتية أثناء بث صوتي قائم (لكل مذيع)
  SOCKET.on('bcast:new_listener', ({ listenerId }) => {
    if (!BCAST || !BCAST.isHost || BCAST.mode !== 'audio') return;
    bcastConnectToPeer(listenerId);
  });
  // إشارات WebRTC (عرض/رد/مرشحات ICE) — بين المذيعين مع بعضهم وبين كل مذيع والمشاهدين
  SOCKET.on('bcast:signal', ({ roomId, fromUserId, data }) => {
    // إن لم تُهيَّأ حالة BCAST بعد لهذه الغرفة (سباق زمني محتمل عند لحظة الدخول)، خزّن الإشارة مؤقتاً بدل تجاهلها.
    if (!BCAST || +BCAST.roomId !== +roomId) { BCAST_SIGNAL_QUEUE.push({ roomId: +roomId, fromUserId, data }); return; }
    bcastHandleSignal(fromUserId, data);
  });
  // [المضيف الأساسي فقط] وصول طلب إذن للتحدث في غرفة صوتية
  SOCKET.on('bcast:speak_request', ({ roomId, user }) => {
    if (!BCAST || !BCAST.isPrimary || BCAST.roomId !== +roomId || BCAST.mode !== 'audio') return;
    bcastRenderSpeakRequestCard(user);
  });
  SOCKET.on('bcast:speak_cancelled', ({ userId }) => {
    const card = $(`#bcastRequests .bcast-req-card[data-uid="${userId}"][data-kind="speak"]`);
    if (card) card.remove();
  });
  // [لطالب التحدث] رد المضيف الأساسي: قبول يحوّلني فوراً إلى مذيع، رفض يبقيني مستمعاً
  SOCKET.on('bcast:speak_response', async ({ roomId, accept, existingHosts, viewers }) => {
    if (!CUR_ROOM || +roomId !== CUR_ROOM.id) return;
    SPEAK_REQUEST_PENDING = false;
    if (!accept) { toast('رفض المضيف طلب تحدثك', false); bcastRenderBar(); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { return toast('تعذر الوصول إلى الميكروفون، تحقق من الأذونات', false); }
    bcastResetState(); // أغلق اتصالات الاستماع السابقة (استقبال فقط) قبل التحوّل إلى مذيع ثنائي الاتجاه
    BCAST = { roomId: +roomId, mode: 'audio', isHost: true, isPrimary: false, hosts: new Map(), localStream: stream, peers: new Map(), watchState: null };
    bcastSetFloatingMode('audio');
    AUDIO_BCAST_HOST_MUTED = false;
    bcastUpdateHostMuteButton();
    openOv('bcastOv');
    bcastRegisterHost({ id: ME.id, username: ME.username, avatar: ME.avatar || '', badge: badgeOf(ME) }, true);
    (existingHosts || []).forEach(h => { bcastRegisterHost(h); bcastConnectToPeer(h.id); });
    (viewers || []).forEach(id => bcastConnectToPeer(+id));
    bcastFlushSignalQueue();
    toast('تم قبولك للتحدث — أنت الآن أحد المذيعين', true);
    bcastRenderBar();
  });
  // [للمتحدث الذي أُزيل] أعادني المضيف الأساسي إلى وضع الاستماع
  SOCKET.on('bcast:speaker_removed', ({ roomId }) => {
    if (!CUR_ROOM || +roomId !== CUR_ROOM.id) return;
    toast('أنهى المضيف الأساسي مشاركتك كمتحدث', false);
    bcastResetState();
    const state = ROOM_BCAST[roomId];
    if (state && state.mode === 'audio') bcastViewerAutoConnectAudio(roomId, state.hosts);
    bcastRenderBar();
  });
  // انتقلت صلاحية "المضيف الأساسي" لمذيع آخر (لأن الأساسي السابق غادر البث)
  SOCKET.on('bcast:primary_changed', ({ roomId, primaryHostId }) => {
    if (!CUR_ROOM || +roomId !== CUR_ROOM.id || !BCAST || BCAST.roomId !== +roomId || !BCAST.isHost) return;
    BCAST.isPrimary = !!(ME && ME.id === primaryHostId);
    bcastRenderSpeakersList();
  });
}
// =====================================================
//  البث المباشر (متعدد المذيعين) — منطق الواجهة و WebRTC
// =====================================================
let AUDIO_BCAST_MUTED = false;
let AUDIO_BCAST_HOST_MUTED = false; // كتم ميكروفون المذيع محلياً دون إيقاف البث
let SPEAK_REQUEST_PENDING = false; // هل لدي طلب تحدث معلّق بانتظار رد المضيف الأساسي (غرفة صوتية)

// يحدّث شريط البث أعلى شاشة الدردشة حسب حالة الغرفة الحالية
function bcastRenderBar() {
  const bar = $('#liveBar'); const startBtn = $('#liveBarStart'); const muteBtn = $('#liveBarMute');
  const hostsBox = $('#liveBarHosts');
  const videoBroadcastFx = $('#containersacscs');
  const audioBroadcastFx = $('#containersacscs_Audio');
  const startLabel = $('#liveBarStartLabel');
  if (!CUR_ROOM) return;
  const state = ROOM_BCAST[CUR_ROOM.id];
  // عند وجود بث، نعرض بطاقات المذيعين فقط بدلاً من الجملة الطويلة في الشريط.
  $('#roomNotice').hidden = !!state;
  // يظهر مؤثر واحد على الطرف الآخر فقط مع مذيع واحد، ويختفي عند تعدد المذيعين.
  const singleHost = !!(state && (state.hosts || []).length === 1);
  videoBroadcastFx.hidden = !(singleHost && state.mode === 'video');
  audioBroadcastFx.hidden = !(singleHost && state.mode === 'audio');
  const iAmHost = BCAST && BCAST.isHost && BCAST.roomId === CUR_ROOM.id;
  const isVoiceRoom = CUR_ROOM.type === 'voice';
  const eligible = !!ME && !ME.muted && canUseMembershipFeature('broadcast_allowed_memberships');
  bar.classList.toggle('is-live', !!state);
  // زر كتم الاستماع لا يظهر إلا في البث الصوتي عند وجود مذيعين أو أكثر.
  muteBtn.hidden = !(state && state.mode === 'audio' && (state.hosts || []).length > 1);
  // الصورة ثابتة، بينما يختلف النص أسفلها حسب نوع الغرفة.
  const startText = isVoiceRoom ? 'بث صوتي' : 'بث مباشر';
  startLabel.textContent = startText;
  startBtn.title = startText;
  startBtn.onclick = () => bcastOpenStartConfirm(isVoiceRoom ? 'audio' : 'video');
  if (hostsBox) {
    const hosts = (state && state.hosts) || [];
    const shown = hosts.slice(0, 4);
    // في وضع الفيديو (الغرف الافتراضية) مع أكثر من مذيع: النقر على صورة مذيع بعينه يفتح تأكيد مشاهدته هو تحديداً،
    // فلا يشاهد المستخدم إلا من وافق على طلبه، ولا يشاهد أكثر من مذيع واحد في نفس الوقت.
    const pickable = !!(state && state.mode === 'video' && !iAmHost);
    hostsBox.innerHTML = shown.map(h => `<span class="lb-host-chip${pickable ? ' watchable' : ''}" data-hid="${h.id}" title="${esc(h.username)}">
        <span class="lb-host-photo">${bcastAvatarChip(h.avatar)}</span><small class="lb-host-label">${esc(h.username)}</small>
      </span>`).join('')
      + (hosts.length > shown.length ? `<span class="lb-host-more">+${hosts.length - shown.length}</span>` : '');
    if (pickable) hostsBox.querySelectorAll('.lb-host-chip').forEach(chip => {
      chip.onclick = (e) => {
        e.stopPropagation();
        const h = hosts.find(x => x.id === +chip.dataset.hid);
        if (h) bcastOpenWatchConfirm(h);
      };
    });
  }
  if (!state) {
    // لا يوجد بث حالياً — أظهر زر بدء البث إن كان المستخدم مؤهلاً
    $('#roomNotice').textContent = 'لا يوجد احد في البث المباشر حي الان';
    startBtn.hidden = false;
    SPEAK_REQUEST_PENDING = false;
    bar.onclick = null;
    return;
  }
  if (state.mode === 'audio') {
    // يبقى زر البث ظاهرًا حتى بعد صعود مذيع؛ المذيع الحالي يفتحه لإظهار بطاقته العائمة.
    startBtn.hidden = false;
  } else {
    // يبقى زر البث ظاهرًا أيضًا في غرف الفيديو أثناء البث.
    startBtn.hidden = false;
  }
  if (iAmHost) startBtn.onclick = () => openOv('bcastOv');
  const names = (state.hosts || []).map(h => h.username);
  const extra = names.length > 1 ? ` و${names.length - 1} آخرين` : '';
  if (state.mode === 'audio') {
    $('#roomNotice').textContent = iAmHost ? 'أنت تبث صوتياً الآن في هذه الغرفة' : `${names[0]}${extra} يتحدث الآن مباشرة`;
    bar.onclick = () => { if (iAmHost) openOv('bcastOv'); };
  } else {
    $('#roomNotice').textContent = iAmHost ? 'أنت تبث فيديو الآن — اضغط لعرض شاشة البث'
      : (names.length > 1 ? `${names[0]}${extra} يبثون فيديو مباشر الآن — اضغط على صورة أحدهم للمشاهدة`
        : `${names[0]} يبث فيديو مباشر الآن — اضغط للمشاهدة`);
    // المشاهدة لا تبدأ بالنقر على الشريط؛ فقط صورة المذيع (.lb-host-chip) تفتح طلب المشاهدة.
    // معالج النقر الخاص بكل صورة يُربط أعلاه داخل hostsBox.
    bar.onclick = null;
  }
}

// تضبط شكل نافذة البث المصغرة بحيث يكون الصوت والفيديو بنفس الهوية البصرية.
function bcastSetFloatingMode(mode) {
  const overlay = $('#bcastOv');
  if (overlay) overlay.classList.toggle('is-audio', mode === 'audio');
}

function bcastUpdateHostMuteButton() {
  const btn = $('#bcastHostMute');
  if (!btn) return;
  const isAudioHost = !!(BCAST && BCAST.isHost && BCAST.mode === 'audio');
  btn.hidden = !isAudioHost;
  btn.classList.toggle('is-muted', AUDIO_BCAST_HOST_MUTED);
  $('#bcastHostMuteIcon').textContent = AUDIO_BCAST_HOST_MUTED ? 'mic_slash_fill' : 'mic_fill';
}

// يعيد كل شيء إلى الوضع الافتراضي: إغلاق اتصالات WebRTC وإيقاف الوسائط وإخفاء الشاشة
function bcastResetState() {
  if (BCAST) {
    if (BCAST.localStream) BCAST.localStream.getTracks().forEach(t => t.stop());
    if (BCAST.peers) for (const pc of BCAST.peers.values()) { try { pc.close(); } catch (e) { } }
  }
  BCAST = null;
  BCAST_SIGNAL_QUEUE = [];
  SPEAK_REQUEST_PENDING = false;
  AUDIO_BCAST_HOST_MUTED = false;
  bcastUpdateHostMuteButton();
  $('#bcastGrid').innerHTML = '';
  $('#bcastAudioPool').innerHTML = '';
  $('#bcastRequests').innerHTML = '';
  if ($('#bcastSpeakers')) { $('#bcastSpeakers').hidden = true; $('#bcastSpeakers').innerHTML = ''; }
  $('#bcastWaitMsg').hidden = true;
  $('#bcastEndBtn').hidden = true;
  $('#bcastLeaveBtn').hidden = true;
  closeOv('bcastOv');
}
// يحدّث اسم/صورة رأس شاشة البث وعدّاد المذيعين/المشاهدين
function bcastUpdateHeader() {
  if (!BCAST) return;
  const hosts = [...BCAST.hosts.values()];
  $('#bcastHostAvatar').innerHTML = bcastAvatarChip(hosts[0] ? hosts[0].avatar : '');
  $('#bcastHostName').textContent = hosts.map(h => h.username).join('، ') || '-';
  const hostLabel = hosts.length > 1 ? `${hosts.length} مذيعين` : 'مذيع واحد';
  if (BCAST.isHost) {
    const viewerCount = [...BCAST.peers.keys()].filter(id => !BCAST.hosts.has(id)).length;
    $('#bcastViewersCount').textContent = `${hostLabel} • ${viewerCount} مشاهد`;
  } else {
    $('#bcastViewersCount').textContent = hostLabel;
  }
}
function bcastAvatarChip(avatar) { return avatarHtml(avatar, ''); }

// يسجّل مذيعاً (بمن فيهم أنا) في حالة البث الحالية: يجهّز بلاطة الفيديو الخاصة به (عناصر الصوت تُنشأ لاحقاً عند وصول التدفق الفعلي)
function bcastRegisterHost(hostInfo, isSelf = false) {
  if (!BCAST) return;
  BCAST.hosts.set(hostInfo.id, hostInfo);
  if (BCAST.mode === 'video') {
    bcastEnsureTile(hostInfo.id, hostInfo);
    if (isSelf && BCAST.localStream) bcastAttachStreamToTile(hostInfo.id, BCAST.localStream);
  }
  // بث الصوت: لا حاجة لعنصر صوت خاص بي (لتفادي صدى الصوت)
  bcastUpdateHeader();
  bcastRenderSpeakersList();
}
// يزيل مذيعاً غادر البث (لا يزيل نفسي؛ يُستدعى فقط لبقية المذيعين)
function bcastUnregisterHost(hostId) {
  if (!BCAST) return;
  BCAST.hosts.delete(hostId);
  bcastClosePeer(hostId);
  if (BCAST.mode === 'video') bcastRemoveTile(hostId);
  else bcastRemoveAudioEl(hostId);
  bcastUpdateHeader();
  bcastRenderSpeakersList();
}
function bcastTileId(hostId) { return 'bcastTile_' + hostId; }
function bcastEnsureTile(hostId, hostInfo) {
  let tile = document.getElementById(bcastTileId(hostId));
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'bcast-tile';
    tile.id = bcastTileId(hostId);
    tile.innerHTML = `<video autoplay playsinline${hostId === (ME && ME.id) ? ' muted' : ''}></video><span class="bcast-tile-name"></span>`;
    $('#bcastGrid').appendChild(tile);
  }
  tile.querySelector('.bcast-tile-name').textContent = hostInfo ? hostInfo.username : '';
  bcastLayoutGrid();
  return tile;
}
function bcastRemoveTile(hostId) {
  const tile = document.getElementById(bcastTileId(hostId));
  if (tile) tile.remove();
  bcastLayoutGrid();
}
function bcastLayoutGrid() {
  const grid = $('#bcastGrid');
  const n = grid.children.length;
  grid.style.gridTemplateColumns = `repeat(${n <= 1 ? 1 : (n <= 4 ? 2 : 3)}, 1fr)`;
}
function bcastAttachStreamToTile(hostId, stream) {
  const tile = document.getElementById(bcastTileId(hostId));
  if (!tile) return;
  const v = tile.querySelector('video');
  v.srcObject = stream;
  v.play().catch(() => { });
}
function bcastEnsureAudioEl(hostId) {
  let el = document.getElementById('bcastAudio_' + hostId);
  if (!el) {
    el = document.createElement('audio');
    el.id = 'bcastAudio_' + hostId;
    el.autoplay = true; el.playsInline = true; el.muted = AUDIO_BCAST_MUTED;
    $('#bcastAudioPool').appendChild(el);
  }
  return el;
}
function bcastRemoveAudioEl(hostId) {
  const el = document.getElementById('bcastAudio_' + hostId);
  if (el) el.remove();
}
// يعرض تدفق وسائط وارداً من طرف معيّن (مذيع آخر أو مذيع أرسل عرضاً لي كمشاهد) في المكان المناسب
function bcastAttachRemoteStream(fromUserId, stream) {
  if (!BCAST) return;
  if (BCAST.mode === 'audio') bcastEnsureAudioEl(fromUserId).srcObject = stream;
  else bcastAttachStreamToTile(fromUserId, stream);
}

// بطاقة طلب مشاهدة واردة (تظهر لكل مذيع مشارك) مع زرّي قبول/رفض
function bcastRenderRequestCard(user) {
  if ($(`#bcastRequests .bcast-req-card[data-uid="${user.id}"]`)) return;
  const card = document.createElement('div');
  card.className = 'bcast-req-card';
  card.dataset.uid = user.id;
  card.innerHTML = `
    <span class="req-avatar">${bcastAvatarChip(user.avatar)}</span>
    <span class="req-name">${esc(user.username)} يريد مشاهدة البث</span>
    <button class="req-reject" type="button">رفض</button>
    <button class="req-accept" type="button">قبول</button>`;
  card.querySelector('.req-accept').onclick = () => {
    card.remove();
    SOCKET.emit('bcast:watch_response', CUR_ROOM.id, user.id, true);
    bcastConnectToPeer(user.id);
  };
  card.querySelector('.req-reject').onclick = () => {
    card.remove();
    SOCKET.emit('bcast:watch_response', CUR_ROOM.id, user.id, false);
  };
  $('#bcastRequests').appendChild(card);
}

// بطاقة طلب تحدث واردة (تظهر للمضيف الأساسي فقط في الغرفة الصوتية) مع زرّي قبول/رفض
function bcastRenderSpeakRequestCard(user) {
  if ($(`#bcastRequests .bcast-req-card[data-uid="${user.id}"][data-kind="speak"]`)) return;
  const card = document.createElement('div');
  card.className = 'bcast-req-card';
  card.dataset.uid = user.id;
  card.dataset.kind = 'speak';
  card.innerHTML = `
    <span class="req-avatar">${bcastAvatarChip(user.avatar)}</span>
    <span class="req-name">${esc(user.username)} يطلب الإذن للتحدث</span>
    <button class="req-reject" type="button">رفض</button>
    <button class="req-accept" type="button">قبول</button>`;
  card.querySelector('.req-accept').onclick = () => {
    card.remove();
    SOCKET.emit('bcast:speak_response', CUR_ROOM.id, user.id, true);
    // لا حاجة لأي اتصال هنا؛ المتحدث الجديد نفسه سيبادر بالاتصال بي وبباقي الحاضرين فور قبوله
  };
  card.querySelector('.req-reject').onclick = () => {
    card.remove();
    SOCKET.emit('bcast:speak_response', CUR_ROOM.id, user.id, false);
  };
  $('#bcastRequests').appendChild(card);
}
// قائمة المتحدثين الحاليين مع زر إزالة — تظهر فقط للمضيف الأساسي في الغرفة الصوتية
function bcastRenderSpeakersList() {
  const box = $('#bcastSpeakers');
  if (!box) return;
  if (!BCAST || !BCAST.isPrimary || BCAST.mode !== 'audio') { box.hidden = true; box.innerHTML = ''; return; }
  const others = [...BCAST.hosts.values()].filter(h => !ME || h.id !== ME.id);
  if (!others.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = `<div class="bcast-speakers-title">المتحدثون الحاليون</div>` + others.map(h => `
    <div class="bcast-speaker-row" data-uid="${h.id}">
      <span class="req-avatar">${bcastAvatarChip(h.avatar)}</span>
      <span class="req-name">${esc(h.username)}</span>
      <button class="bcast-speaker-remove" type="button" data-uid="${h.id}">إزالة</button>
    </div>`).join('');
  box.querySelectorAll('.bcast-speaker-remove').forEach(btn => {
    btn.onclick = () => SOCKET.emit('bcast:remove_speaker', CUR_ROOM.id, +btn.dataset.uid);
  });
}

// إنشاء اتصال WebRTC جديد مع طرف معيّن (مذيع آخر أو مشاهد) وربط أحداثه المشتركة
function bcastNewPeerConnection(remoteUserId) {
  const pc = new RTCPeerConnection(RTC_ICE_CONFIG);
  pc.onicecandidate = (e) => {
    if (e.candidate) SOCKET.emit('bcast:signal', CUR_ROOM.id, remoteUserId, { type: 'candidate', candidate: e.candidate });
  };
  // [مذيع] إن سقط الاتصال مع طرف ما (مذيع آخر أو مستمع) دون أن يغادر فعلياً — غالباً بسبب اضطراب شبكي عابر أو
  // نشاط ICE قريب (كخروج مذيع آخر) — أعد الاتصال تلقائياً بدل ترك ذلك الطرف بلا صوت حتى يخرج ويعود للغرفة.
  pc.onconnectionstatechange = () => {
    if (pc.connectionState !== 'failed' && pc.connectionState !== 'disconnected') return;
    if (!BCAST || !BCAST.isHost || BCAST.peers.get(remoteUserId) !== pc) return;
    setTimeout(() => {
      if (BCAST && BCAST.isHost && BCAST.peers.get(remoteUserId) === pc
        && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) bcastConnectToPeer(remoteUserId);
    }, 2000);
  };
  return pc;
}
function bcastClosePeer(userId) {
  if (!BCAST || !BCAST.peers) return;
  const pc = BCAST.peers.get(userId);
  if (pc) { try { pc.close(); } catch (e) { } BCAST.peers.delete(userId); }
}

// [مذيع] يبادر باتصال مع طرف آخر (مذيع مشارك أو مشاهد/مستمع) ويرسل له عرضاً (offer) يحمل تدفق وسائطي المحلي.
// طرف واحد فقط يبادر بكل اتصال (الطرف "الأحدث" الذي انضم لاحقاً) لتفادي تصادم العروض بين مذيعَين.
async function bcastConnectToPeer(remoteUserId) {
  if (!BCAST || !BCAST.isHost || !BCAST.localStream) return;
  bcastClosePeer(remoteUserId);
  const pc = bcastNewPeerConnection(remoteUserId);
  BCAST.localStream.getTracks().forEach(track => pc.addTrack(track, BCAST.localStream));
  pc.ontrack = (e) => bcastAttachRemoteStream(remoteUserId, e.streams[0]); // يُستخدم فقط عندما يكون الطرف الآخر مذيعاً أيضاً (بث ثنائي الاتجاه)
  BCAST.peers.set(remoteUserId, pc);
  bcastUpdateHeader();
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    SOCKET.emit('bcast:signal', CUR_ROOM.id, remoteUserId, { type: 'offer', sdp: offer });
  } catch (e) { bcastClosePeer(remoteUserId); }
}

// يطبّق أي إشارات WebRTC وصلت وخُزّنت مؤقتاً قبل تهيئة BCAST لهذه الغرفة (تُستدعى فور تهيئة BCAST)
function bcastFlushSignalQueue() {
  if (!BCAST || !BCAST_SIGNAL_QUEUE.length) return;
  const remaining = [];
  for (const sig of BCAST_SIGNAL_QUEUE) {
    if (+sig.roomId === +BCAST.roomId) bcastHandleSignal(sig.fromUserId, sig.data);
    else remaining.push(sig);
  }
  BCAST_SIGNAL_QUEUE = remaining;
}
// يستقبل إشارات WebRTC من طرف آخر ويرد عليها؛ يعمل بنفس المنطق سواء وصل العرض من مذيع آخر (اتصال ثنائي)
// أو أنا مشاهد بحت أستقبل عرضاً من أحد المذيعين (اتصال أحادي الاتجاه نحوي فقط)
async function bcastHandleSignal(fromUserId, data) {
  if (!BCAST) return;
  if (data.type === 'offer') {
    let pc = BCAST.peers.get(fromUserId);
    if (!pc) {
      pc = bcastNewPeerConnection(fromUserId);
      if (BCAST.isHost && BCAST.localStream) BCAST.localStream.getTracks().forEach(t => pc.addTrack(t, BCAST.localStream));
      pc.ontrack = (e) => bcastAttachRemoteStream(fromUserId, e.streams[0]);
      BCAST.peers.set(fromUserId, pc);
      bcastUpdateHeader();
    }
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    SOCKET.emit('bcast:signal', CUR_ROOM.id, fromUserId, { type: 'answer', sdp: answer });
  } else if (data.type === 'answer') {
    const pc = BCAST.peers.get(fromUserId);
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).catch(() => { });
  } else if (data.type === 'candidate') {
    const pc = BCAST.peers.get(fromUserId);
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => { });
  }
}

// [مستمع] تهيئة الاستماع التلقائي عند وجود بث صوتي قائم في غرفة صوتية — لا حاجة لأي طلب
function bcastViewerAutoConnectAudio(roomId, hosts) {
  BCAST = { roomId: +roomId, mode: 'audio', isHost: false, isPrimary: false, hosts: new Map(), peers: new Map(), watchState: 'accepted' };
  // المستمع الصوتي يستقبل الصوت في الخلفية فقط؛ النافذة العائمة مخصصة للمذيع.
  bcastSetFloatingMode('audio');
  (hosts || []).forEach(h => bcastRegisterHost(h));
  // العروض (offers) ستصل من كل مذيع تلقائياً عبر bcast:signal — نطبّق أولاً أي عرض وصل مبكراً قبل التهيئة
  bcastFlushSignalQueue();
}

// نافذة تأكيد بدء البث
function bcastOpenStartConfirm(mode) {
  if (!ME) return openLogin();
  const joiningExisting = !!(CUR_ROOM && ROOM_BCAST[CUR_ROOM.id]);
  $('#bcastStartIcon').textContent = mode === 'audio' ? 'mic_fill' : 'videocam_fill';
  $('#bcastStartTitle').textContent = joiningExisting
    ? (mode === 'audio' ? 'الانضمام كمذيع صوتي' : 'الانضمام كمذيع فيديو')
    : (mode === 'audio' ? 'بدء بث صوتي' : 'بدء بث فيديو');
  $('#bcastStartText').textContent = mode === 'audio'
    ? 'سيسمعك جميع من في هذه الغرفة الصوتية مباشرة فور بدء البث، بمن فيهم من ينضم لاحقاً.'
    : 'سيبدأ بث فيديو مباشر، وسيحتاج كل عضو يريد المشاهدة لإرسال طلب توافق عليه.';
  $('#bcastStartGo').onclick = () => { closeOv('bcastStartOv'); bcastStart(mode); };
  openOv('bcastStartOv');
}

// بدء البث فعلياً (أو الانضمام كمذيع مشارك لبث قائم): طلب إذن الكاميرا/الميكروفون ثم إعلام الخادم
async function bcastStart(mode) {
  if (!CUR_ROOM) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast('متصفحك لا يدعم البث المباشر', false);
  let stream;
  try {
    stream = mode === 'audio'
      ? await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      : await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) { return toast('تعذر الوصول إلى ' + (mode === 'audio' ? 'الميكروفون' : 'الكاميرا') + '، تحقق من الأذونات', false); }
  SOCKET.emit('bcast:start', CUR_ROOM.id, (res) => {
    if (!res || !res.ok) { stream.getTracks().forEach(t => t.stop()); return toast((res && res.text) || 'تعذر بدء البث', false); }
    BCAST = { roomId: CUR_ROOM.id, mode: res.mode, isHost: true, isPrimary: !!res.isNewBroadcast, hosts: new Map(), localStream: stream, peers: new Map(), watchState: null };
    bcastSetFloatingMode(res.mode);
    AUDIO_BCAST_HOST_MUTED = false;
    bcastUpdateHostMuteButton();
    bcastRegisterHost({ id: ME.id, username: ME.username, avatar: ME.avatar || '', badge: badgeOf(ME) }, true);
    $('#bcastEndBtn').hidden = false;
    $('#bcastLeaveBtn').hidden = true;
    openOv('bcastOv');
    if (res.mode !== 'video') toast(res.isNewBroadcast ? 'بدأ البث الصوتي — يسمعك جميع من في الغرفة الآن مباشرة' : 'انضممت للبث الصوتي');
    // أتصل بكل من انضم قبلي: المذيعون الحاليون (بث ثنائي الاتجاه بيننا) والمشاهدون/المستمعون المقبولون بالفعل
    (res.existingHosts || []).forEach(h => { bcastRegisterHost(h); bcastConnectToPeer(h.id); });
    (res.viewers || []).forEach(id => bcastConnectToPeer(+id));
    bcastFlushSignalQueue();
    bcastRenderBar();
  });
}
function bcastStopAsHost() {
  if (!CUR_ROOM || !BCAST || !BCAST.isHost) return;
  const roomId = CUR_ROOM.id;
  // إن استمر البث الصوتي بعد نزولي (بقي مذيعون آخرون)، يرد الخادم بقائمتهم فأتحوّل تلقائياً لوضع الاستماع.
  SOCKET.emit('bcast:stop', roomId, (res) => {
    if (res && res.becameListener && CUR_ROOM && CUR_ROOM.id === roomId) {
      bcastViewerAutoConnectAudio(roomId, res.hosts);
      toast('توقفت عن البث — أنت الآن تستمع لبقية المذيعين', true);
      bcastRenderBar();
    }
  });
  bcastResetState();
  bcastRenderBar();
}
// نافذة تأكيد مشاهدة مذيع بعينه — تظهر عند النقر على صورته في شريط البث
function bcastOpenWatchConfirm(host) {
  if (!ME) return openLogin();
  if (!host) return;
  $('#bcastWatchAvatar').innerHTML = bcastAvatarChip(host.avatar);
  $('#bcastWatchName').textContent = host.username;
  $('#bcastWatchGo').onclick = () => { closeOv('bcastWatchOv'); bcastWatchRequest(host); };
  openOv('bcastWatchOv');
}
// [مشاهد] إرسال طلب مشاهدة بث فيديو مذيع محدَّد بالذات — لا يتصل إلا بهذا المذيع تحديداً إن وافق،
// ولا يمكنه بذلك مشاهدة أكثر من مذيع واحد في نفس الوقت.
function bcastWatchRequest(targetHost) {
  if (!CUR_ROOM || !targetHost) return;
  BCAST = { roomId: CUR_ROOM.id, mode: 'video', isHost: false, isPrimary: false, hosts: new Map(), peers: new Map(), watchState: 'pending', targetHostId: targetHost.id };
  bcastSetFloatingMode('video');
  $('#bcastHostAvatar').innerHTML = bcastAvatarChip(targetHost.avatar);
  $('#bcastHostName').textContent = targetHost.username;
  $('#bcastEndBtn').hidden = true;
  $('#bcastLeaveBtn').hidden = true;
  $('#bcastWaitMsg').hidden = false;
  $('#bcastGrid').innerHTML = '';
  openOv('bcastOv');
  SOCKET.emit('bcast:watch_request', CUR_ROOM.id, targetHost.id, (res) => {
    if (!res || !res.ok) { toast((res && res.text) || 'تعذر إرسال طلب المشاهدة', false); bcastResetState(); }
  });
}
function bcastLeaveAsViewer() {
  if (!CUR_ROOM || !BCAST || BCAST.isHost) return;
  if (BCAST.watchState === 'pending') SOCKET.emit('bcast:watch_cancel', CUR_ROOM.id);
  else SOCKET.emit('bcast:leave', CUR_ROOM.id);
  bcastResetState();
}
// يُستدعى عند دخول غرفة (من ack الانضمام) لضبط حالة البث الحالية للغرفة
function bcastApplyJoinState(roomId, broadcastState) {
  if (broadcastState) {
    ROOM_BCAST[roomId] = broadcastState;
    const iAmAlreadyHost = ME && broadcastState.hosts.some(h => h.id === ME.id);
    if (broadcastState.mode === 'audio' && !iAmAlreadyHost) bcastViewerAutoConnectAudio(roomId, broadcastState.hosts);
  } else delete ROOM_BCAST[roomId];
  bcastRenderBar();
}
$('#bcastClose').onclick = () => {
  // زر X ينهي بث المذيع، أما المشاهد فيغادر المشاهدة فعلياً (أو يلغي طلبه المعلّق).
  if (BCAST && BCAST.isHost) return bcastStopAsHost();
  if (BCAST && !BCAST.isHost && BCAST.mode === 'video') return bcastLeaveAsViewer();
  closeOv('bcastOv');
};
$('#bcastEndBtn').onclick = bcastStopAsHost;
$('#bcastHostMute').onclick = () => {
  if (!BCAST || !BCAST.isHost || BCAST.mode !== 'audio' || !BCAST.localStream) return;
  AUDIO_BCAST_HOST_MUTED = !AUDIO_BCAST_HOST_MUTED;
  BCAST.localStream.getAudioTracks().forEach(track => { track.enabled = !AUDIO_BCAST_HOST_MUTED; });
  bcastUpdateHostMuteButton();
};
// سحب نافذة البث داخل إطار التطبيق، بالفأرة أو باللمس.
(() => {
  const panel = $('#bcastOv .bcast-viewer'), handle = $('#bcastDragHandle'), frame = $('#frame');
  if (!panel || !handle || !frame) return;
  let drag = null;
  const point = e => e.touches ? e.touches[0] : e;
  const move = e => {
    if (!drag) return; const q = point(e), box = frame.getBoundingClientRect();
    const x = Math.max(0, Math.min(box.width - panel.offsetWidth, q.clientX - box.left - drag.x));
    const y = Math.max(0, Math.min(box.height - panel.offsetHeight, q.clientY - box.top - drag.y));
    panel.style.left = x + 'px'; panel.style.top = y + 'px'; panel.style.right = 'auto';
    if (e.cancelable) e.preventDefault();
  };
  const stop = () => { drag = null; };
  handle.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = panel.getBoundingClientRect(), q = point(e); drag = { x:q.clientX-r.left, y:q.clientY-r.top };
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
  });
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
})();
$('#bcastLeaveBtn').onclick = bcastLeaveAsViewer;
$('#liveBarMute').onclick = () => {
  AUDIO_BCAST_MUTED = !AUDIO_BCAST_MUTED;
  $('#bcastAudioPool').querySelectorAll('audio').forEach(el => el.muted = AUDIO_BCAST_MUTED);
  $('#liveBarMuteIcon').textContent = AUDIO_BCAST_MUTED ? 'speaker_slash_fill' : 'speaker_2_fill';
};

function normalizeAnnouncement(announcement) {
  const a = announcement || {};
  return {
    id: +a.id || 0,
    kind: 'announcement',
    icon: 'announcement',
    title: a.title || 'إعلان عام',
    text: String(a.text || ''),
    sender_name: a.sender_name || 'الإدارة',
    image: a.image || '/img/announcement.png',
    read: !!a.read,
    created_at: +a.created_at || Math.floor((+a.at || Date.now()) / 1000)
  };
}
function notificationReadKey(notification) {
  if (!notification || !notification.id) return '';
  const isAnnouncement = notification.kind === 'announcement' || notification.icon === 'announcement';
  return (isAnnouncement ? 'announcement:' : 'notification:') + notification.id;
}
function isNotificationRead(notification) {
  const key = notificationReadKey(notification);
  return !!(notification && notification.read) || !!(key && READ_NOTIFS.has(key));
}
async function markNotificationAsRead(notification) {
  if (!notification) return;
  const key = notificationReadKey(notification);
  const wasUnread = !isNotificationRead(notification);
  notification.read = 1;
  if (key) READ_NOTIFS.add(key);
  if (wasUnread && NOTIF_UNREAD > 0) {
    NOTIF_UNREAD = Math.max(0, NOTIF_UNREAD - 1);
    updateNotifBadge();
  }
  if (ME && ME.registered && notification.id) {
    try {
      const headers = { 'X-Chat-Client': '1' };
      if (CHAT_TOKEN) headers['X-Chat-Token'] = CHAT_TOKEN;
      await fetch('/api/notifications/' + notification.id + '/read', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers
      });
    } catch (e) { }
  }
}
function openAnnouncementPopup(announcement) {
  const a = normalizeAnnouncement(announcement);
  CURRENT_ANNOUNCEMENT = a;
  $('#announcementTitle').textContent = a.title;
  $('#announcementSender').textContent = a.sender_name;
  $('#announcementText').textContent = a.text;
  const image = $('#announcementImage');
  image.src = a.image;
  image.onerror = () => { image.onerror = null; image.src = '/img/announcement.png'; };
  markNotificationAsRead(a);
  openOv('announcementOverlay');
}
$('#announcementOk').onclick = () => closeOv('announcementOverlay');
function updateNotifBadge() {
  const badge = $('#notifBadge');
  if (NOTIF_UNREAD > 0) {
    badge.textContent = NOTIF_UNREAD > 99 ? '99+' : NOTIF_UNREAD;
    badge.style.display = 'flex';
  } else badge.style.display = 'none';
}
function updateStatusUnreadBadge() {
  const badge = $('#statusUnreadBadge');
  if (STATUS_UNREAD > 0) {
    badge.textContent = STATUS_UNREAD > 99 ? '99+' : STATUS_UNREAD;
    badge.style.display = 'flex';
  } else badge.style.display = 'none';
}
async function loadUnreadNotifCount() {
  if (!ME || !ME.registered) { NOTIF_UNREAD = 0; updateNotifBadge(); return; }
  try {
    const data = await api('/api/notifications/unread-count');
    NOTIF_UNREAD = +data.count || 0;
    updateNotifBadge();
  } catch (e) { }
}
function pushNotif(icon, text, extra = {}) {
  const notification = { icon, text, at: Date.now(), ...extra };
  NOTIFS.unshift(notification);
  if ($('#notifOv').classList.contains('open')) openNotifs();
  else if (!isNotificationRead(notification)) {
    NOTIF_UNREAD++;
    updateNotifBadge();
  }
}

// =====================================================
//  الغرف
// =====================================================
async function loadRooms() {
  ROOMS = await api('/api/rooms');
  ROOMS.forEach(r => ROOM_COUNTS[r.id] = r.online || 0);
  renderRooms();
}
function roomImgHtml(r, cls = 'room-img') {
  if (r.image) return `<div class="${cls}"><img src="${esc(r.image)}"></div>`;
  return `<div class="${cls}"><span>${esc(r.name)}</span></div>`;
}
function roomFeaturesHtml(r) {
  const icons = r.type === 'voice'
    ? [
        '<i class="f7-icons" title="دردشة كتابية">bubble_left_bubble_right_fill</i>',
        '<i class="f7-icons" title="غرفة صوتية">music_mic</i>'
      ]
    : [
        '<i class="f7-icons" title="دردشة كتابية">bubble_left_bubble_right_fill</i>',
        '<i class="f7-icons" title="فيديو">videocam_fill</i>'
      ];
  if (r.status !== 'open') icons.push('<i class="f7-icons" title="الغرفة مغلقة" style="color:#dc2626">lock_circle_fill</i>');
  if (r.locked) icons.push('<i class="f7-icons" title="الغرفة برقم سري" style="color:#d946a6">lock_fill</i>');
  return `<div class="room-feats">${icons.join('')}</div>`;
}
function roomRowHtml(r) {
  const online = ROOM_COUNTS[r.id] || 0;
  return `
  <div class="room-row" data-id="${r.id}">
    ${roomImgHtml(r)}
    <div class="room-info">
      <div class="room-name">${esc(r.name)}</div>
      <div class="room-desc">${esc(r.description || `أهلاً وسهلاً بكم في ${SETTINGS.site_name || 'الدردشة'} ★`)}</div>
    </div>
    <div class="room-side">
      <div class="room-count"><i class="f7-icons">person2_fill</i><b>${online}</b>/${r.max_users || 1000}</div>
      <i class="f7-icons room-chev">chevron_right</i>
      ${roomFeaturesHtml(r)}
    </div>
  </div>`;
}
function roomMiniHtml(r) {
  const online = ROOM_COUNTS[r.id] || 0;
  const isCur = CUR_ROOM && r.id === CUR_ROOM.id;
  return `
  <div class="room-mini${isCur ? ' cur' : ''}" data-id="${r.id}">
    ${roomImgHtml(r, 'rm-img')}
    <div class="rm-info">
      <div class="rm-name">${esc(r.name)} ${r.locked ? '<i class="f7-icons" style="font-size:12px;color:#d946a6">lock_fill</i>' : ''}${r.status !== 'open' ? ' <span style="font-size:10px;color:#dc2626;font-weight:800">مغلقة 🔒</span>' : ''}</div>
      <div class="rm-desc">${esc(r.description || ('غرفة مستخدمين ' + r.owner_name))}</div>
    </div>
    <div class="rm-side">
      ${isCur ? '<span class="rm-here">أنت هنا</span>' : `<span class="rm-count"><i class="f7-icons">person2_fill</i>${online}/${r.max_users || 1000}</span>`}
      <i class="f7-icons rm-chev">chevron_right</i>
    </div>
  </div>`;
}
function renderRoomsPanel() {
  const q2 = ($('#roomSearch2').value || '').trim();
  const activeTabEl = $('.r-tab2.active');
  const tab2 = (activeTabEl && activeTabEl.dataset) ? activeTabEl.dataset.tab : 'default';
  const list = ROOMS.filter(r => (tab2 === 'voice' ? r.type === 'voice' : r.type !== 'voice') && (!q2 || r.name.includes(q2)));   // الصوتية: صوتية فقط / الافتراضية: بدون الصوتية
  $('#roomsList2').innerHTML = list.length ? list.map(roomMiniHtml).join('') : '<div class="pv-empty" style="padding:50px 10px"><div>لا توجد غرف هنا</div></div>';
  $$('#roomsList2 .room-mini').forEach(row => row.onclick = () => {
    if (CUR_ROOM && +row.dataset.id === CUR_ROOM.id) return toast('أنت متواجد في هذه الغرفة حالياً 📍');
    enterRoom(+row.dataset.id);
  });
}
function renderRooms() {
  const q1 = ($('#roomSearch').value || '').trim();
  const list = ROOMS.filter(r => (CUR_TAB === 'voice' ? r.type === 'voice' : r.type !== 'voice') && (!q1 || r.name.includes(q1)));
  $('#roomsList').innerHTML = list.length ? list.map(roomRowHtml).join('') : '<div class="pv-empty" style="padding:50px 10px"><div>لا توجد غرف هنا</div></div>';
  $$('#roomsList .room-row').forEach(row => row.onclick = () => enterRoom(+row.dataset.id));
  renderRoomsPanel();
}
function enterRoom(id, pwd, hiddenChoice) {
  if (!ME) { openLogin(); return; }
  const r = ROOMS.find(x => x.id === id);
  if (!r) return;
  if (r.status !== 'open' && !isAdmRank()) return toast('🔒 هذه الغرفة مغلقة حالياً');
  const adm = isAdmRank();
  const canChooseHidden = canChooseHiddenEntry();
  const alwaysHidden = isAlwaysHiddenEntry();
  // السوبر ماستر يدخل مخفياً دائماً بدون إظهار نافذة اختيار، بينما يبقى خيار المخفي للإدمن والسوبر أدمن فقط.
  if (canChooseHidden && SETTINGS.hidden_super === '1' && hiddenChoice === undefined) {
    HIDDEN_ENTRY_PENDING = { id, pwd: pwd || '' };
    $('#hiddenEntryRoomName').textContent = r.name;
    openOv('hiddenEntryOv');
    return;
  }
  const hidden = !!alwaysHidden || (canChooseHidden && SETTINGS.hidden_super === '1' && hiddenChoice === true);
  const pass = adm ? '' : (pwd || ROOM_PWD[id] || '');
  if (r.locked && !adm && !pass) { openPassOv(r); return; }   // اطلب كلمة السر قبل الدخول
  if (pass) ROOM_PWD[id] = pass;
  ROOM_HIDDEN[id] = hidden;
  CUR_ROOM = r;
  $('#chatRoomName').textContent = r.name;
  $('#roomNotice').textContent = 'لا يوجد احد في البث المباشر حي الان';
  const currentSiteName = (window.SEO_PAGE_CONFIG && window.SEO_PAGE_CONFIG.site_name) || SETTINGS.site_name || 'الدردشة العربية';
  const bgWater = $('#chatBgWatermark .pm-water');
  if (bgWater) bgWater.textContent = currentSiteName;
  $('#msgArea').innerHTML = '';
  showScreen('chat');
  setRoomsPanel(false);
  $('#roomsVeil').style.display = 'none';
  SOCKET.emit('join', id, pass, { hidden }, (res) => {
    if (res && res.ok) {
      ROOM_HIDDEN[id] = !!res.hidden;
      bcastApplyJoinState(id, res.broadcast || null);
      // لا نحمّل سجل الرسائل القديم؛ العام يبدأ فارغاً ويظهر فقط ترحيب الغرفة من الإدارة.
      api('/api/rooms/' + id + '/users').then(u => { ROOM_USERS = u; renderUsers(); });
      if (res.hidden && !(ME && ME.rank === 'supermaster')) toast('تم الدخول إلى الغرفة بشكل مخفي');
      return;
    }
    // رُفض الدخول (كلمة مرور خاطئة/غرفة مغلقة/مطرود) — نرجع لقائمة الغرف
    delete ROOM_PWD[id];
    delete ROOM_HIDDEN[id];
    leaveRoom();
    showScreen('rooms');
    if (res.reason === 'password') openPassOv(r, false);
    else if (res.reason === 'wrong_pass') openPassOv(r, true);
    else if (res.reason === 'kicked') toast(res.text || '🚫 أنت مطرود من هذه الغرفة', false);
    else toast(res.text || 'تعذر الدخول للغرفة', false);
  });
}
$('#hiddenEntryVisible').onclick = () => {
  const pending = HIDDEN_ENTRY_PENDING;
  HIDDEN_ENTRY_PENDING = null;
  closeOv('hiddenEntryOv');
  if (pending) enterRoom(pending.id, pending.pwd, false);
};
$('#hiddenEntryHidden').onclick = () => {
  const pending = HIDDEN_ENTRY_PENDING;
  HIDDEN_ENTRY_PENDING = null;
  closeOv('hiddenEntryOv');
  if (pending) enterRoom(pending.id, pending.pwd, true);
};
$('.hidden-entry-close').addEventListener('click', () => { HIDDEN_ENTRY_PENDING = null; });
$('#hiddenEntryOv').addEventListener('click', event => { if (event.target === $('#hiddenEntryOv')) HIDDEN_ENTRY_PENDING = null; });
// نافذة كلمة مرور الغرفة المحمية
let PASS_ROOM = null;
function openPassOv(r, wrong) {
  PASS_ROOM = r;
  $('#passRoomName').textContent = r.name;
  $('#passVal').value = '';
  $('#passErr').style.display = wrong ? 'block' : 'none';
  openOv('passOv');
  setTimeout(() => $('#passVal').focus(), 80);
}
async function loadRoomMessages(id) {
  const msgs = await api(`/api/rooms/${id}/messages`);
  msgs.forEach(m => renderMsg(m));
  scrollBottom();
}
function scrollBottom() { const a = $('#msgArea'); a.scrollTop = a.scrollHeight; }

// =====================================================
//  عرض الرسائل
// =====================================================
// يحول الرمز الرقمي مثل (1) إلى صورة الإيموجي المرفوع، مع إبقاء النص المجاور له.
function messageTextWithCustomEmojis(text) {
  const source = String(text || '');
  const emojisById = new Map(CUSTOM_EMOJIS.map(emoji => [String(emoji.id), emoji]));
  const tokenPattern = /\((\d+)\)/g;
  let html = '', cursor = 0, match;
  while ((match = tokenPattern.exec(source))) {
    const emoji = emojisById.get(match[1]);
    if (!emoji) continue;
    html += esc(source.slice(cursor, match.index));
    html += `<img class="minline-emoji" src="${esc(emoji.img)}" alt="${esc(match[0])}">`;
    cursor = tokenPattern.lastIndex;
  }
  return html + esc(source.slice(cursor));
}
let ACTIVE_CHAT_AUDIO = null;
function formatAudioTime(seconds) {
  const value = Math.max(0, Number.isFinite(+seconds) ? Math.floor(+seconds) : 0);
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
function bindChatAudioPlayer(player) {
  if (!player) return;
  const audio = player.querySelector('.chat-audio-element');
  const play = player.querySelector('.chat-audio-play');
  const seek = player.querySelector('.chat-audio-seek');
  const current = player.querySelector('.chat-audio-current');
  const duration = player.querySelector('.chat-audio-duration');
  const fallbackDuration = Math.max(0, +player.dataset.duration || 0);
  if (fallbackDuration) { seek.max = fallbackDuration; duration.textContent = formatAudioTime(fallbackDuration); }
  const setPlayIcon = playing => { play.querySelector('i').textContent = playing ? 'pause_fill' : 'play_fill'; };
  const audioReady = () => {
    const value = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : fallbackDuration;
    seek.max = value || 0;
    duration.textContent = formatAudioTime(value);
  };
  audio.onloadedmetadata = audioReady;
  audio.oncanplay = audioReady;
  audio.ontimeupdate = () => {
    seek.value = audio.currentTime || 0;
    current.textContent = formatAudioTime(audio.currentTime);
  };
  audio.onplay = () => setPlayIcon(true);
  audio.onpause = () => setPlayIcon(false);
  audio.onended = () => { audio.currentTime = 0; setPlayIcon(false); };
  play.onclick = async () => {
    if (audio.paused) {
      if (ACTIVE_CHAT_AUDIO && ACTIVE_CHAT_AUDIO !== audio) ACTIVE_CHAT_AUDIO.pause();
      ACTIVE_CHAT_AUDIO = audio;
      try { await audio.play(); } catch (e) { toast('تعذر تشغيل المقطع الصوتي', false); }
    } else audio.pause();
  };
  seek.oninput = () => { if (Number.isFinite(audio.duration) || fallbackDuration > 0) audio.currentTime = +seek.value || 0; };
  audio.load();
}
function renderMsg(m) {
  const area = $('#msgArea');
  const senderId = +(m.user_id || (m.user && m.user.id) || 0);
  if (m.type === 'msg' && senderId && IGNORED_USERS.has(senderId)) return;
  let el = document.createElement('div');
  const t = timeHm(m.created_at || Date.now() / 1000);
  if (m.type === 'msg') {
    const u = m.user || parseExtra(m);
    const badge = u.badge || badgeOf(u);
    const color = userColor(u);
    const uname = m.username || u.username || '';
    const rp = m.reply || u.reply || null;   // اقتباس «الرد على الرسالة»
    const tcol = m.color || u.color || null;  // لون خط مخصص من قائمة الألوان
    const currentFontSize = Math.min(40, Math.max(10, +(SETTINGS.font_size || 14)));
    const isCustomEmoji = typeof m.text === 'string' && m.text.startsWith('em::');
    const messageMedia = m.media || u.media || null;
    const hiddenAdmin = !!(m.hidden_admin || u.hidden_admin);
    el.className = 'msg' + (hiddenAdmin ? ' hidden-admin-msg' : '');
    el.innerHTML = `
      <div class="mava">${avatarHtml(u.avatar)}</div>
      <div class="mbody">
        ${rp ? `
        <div class="mrply" dir="rtl">
          <span class="mrply-bar"></span>
          <div class="mrply-content">
            <span class="mrply-name">${esc(rp.name)}</span>
            <span class="mrply-text">${esc(rp.text || '')}</span>
          </div>
        </div>` : ''}
        <div class="mline1">
          <span class="mname" data-username="${esc(uname)}" style="color:#000000;font-weight:400">${esc(uname)}${u.verified ? ' <i class="f7-icons vcheck">checkmark_seal_fill</i>' : ''}</span>
          ${(SETTINGS.show_time === '1' && PREFS.show_time) ? `<span class="mtime">${t}</span>` : ''}
        </div>
        <div class="mline2">
          ${hiddenAdmin
            ? '<img class="hidden-admin-badge" src="/img/mgfi.png" alt="دخول مخفي">'
            : ((badge && badge !== 'register.png' && badge !== 'guest.png') ? `<img class="mmark" src="/badges/${badge}" alt="">` : '')}
          ${isCustomEmoji
            ? `<img class="mcustom-emoji" src="${esc(m.text.slice(4))}" alt="emoji">`
            : `<span class="mtext message-content" style="color:${tcol || color};font-size:${currentFontSize}px">${m.text ? messageTextWithCustomEmojis(m.text) : ''}${messageMedia && messageMedia.type === 'image' ? `<button class="chat-public-image" type="button" data-src="${esc(messageMedia.path)}"><i class="f7-icons">camera_fill</i><b>اضغط هنا لفتح الصورة</b></button>` : ''}${messageMedia && messageMedia.type === 'audio' ? `<span class="chat-audio-player" data-duration="${+messageMedia.duration || 0}"><button class="chat-audio-play" type="button" aria-label="تشغيل"><i class="f7-icons">play_fill</i></button><span class="chat-audio-time chat-audio-current">00:00</span><input class="chat-audio-seek" type="range" min="0" max="0" step="0.01" value="0" aria-label="موضع المقطع"><span class="chat-audio-time chat-audio-duration">00:00</span><audio class="chat-audio-element" src="${esc(messageMedia.path)}" preload="metadata"></audio></span>` : ''}</span>`}
        </div>
      </div>`;
    const publicImage = el.querySelector('.chat-public-image');
    if (publicImage) publicImage.onclick = () => openChatImage(publicImage.dataset.src, uname);
    bindChatAudioPlayer(el.querySelector('.chat-audio-player'));
    // النقر على الصورة أو على الاسم يفتح قائمة خيارات المستخدم والرد على الرسالة
    if (!hiddenAdmin) {
      const msgUserData = { text: m.text, username: uname, avatar: u.avatar, rank: u.rank, membership: u.membership, gender: u.gender, registered: u.registered, muted: u.muted };
      const openSenderSheet = (e) => {
        if (e) e.stopPropagation();
        const uid = m.user_id || (m.user && m.user.id);
        if (uid) openUserSheet(+uid, msgUserData);
      };
      const avaEl = el.querySelector('.mava');
      const nameEl = el.querySelector('.mname');
      if (avaEl) avaEl.onclick = openSenderSheet;
      if (nameEl) nameEl.onclick = openSenderSheet;
    }
  } else if (m.type === 'bot') {   // رسالة النظام الآلية مع لون وحجم لوحة الإدارة
    const botSize = Math.min(40, Math.max(12, +m.size || 16));
    const botColor = /^#[0-9a-fA-F]{6}$/.test(String(m.color || '')) ? m.color : '#660033';
    el.className = 'robot-system-message';
    el.innerHTML = `
      <div class="robot-system-head">
        <img src="/img/robot-message.svg" width="20" height="20" alt="">
        <div class="robot-system-title">رسالة النظام</div>
      </div>
      <div class="font_msg robot-system-body">
        <div class="u-msg robot-system-text" style="font-size:${botSize}px;color:${botColor}">${esc(m.text)}</div>
      </div>`;
  } else if (m.type === 'welcome') {
    el.className = 'room-welcome supervision-welcome';
    el.innerHTML = `
      <img src="/img/robot-crown.svg" width="20" height="20" alt="">
      <span class="room-welcome-content"><b class="room-welcome-title">نظام الإشراف</b><span class="room-welcome-text">${esc(m.text)}</span></span>`;
  } else if (m.type === 'join' || m.type === 'leave') {
    el.className = 'system-event ' + m.type;
    el.innerHTML = `
      <div class="system-event-head skin_f2">
        <i class="icon f7-icons skin_color system-event-icon">speaker_3_fill</i>
        <span>رسالة النظام</span>
      </div>
      <div class="font_msg system-event-body">
        <div class="u-msg system-event-message">${esc(m.text)}</div>
      </div>`;
  } else if (m.type === 'mute') {
    el.className = 'system-event mute-system';
    el.innerHTML = `
      <div class="system-event-head skin_f2">
        <i class="icon f7-icons skin_color system-event-icon">speaker_3_fill</i>
        <span>نظام الكتم</span>
      </div>
      <div class="font_msg system-event-body">
        <div class="u-msg system-event-message" style="color:${m.muted === 0 ? '#16a34a' : '#ff0000'}">${esc(m.text)}</div>
      </div>`;
  } else if (m.type === 'upgrade') {
    const ex = parseExtra(m);
    const plan = ex.plan || 'vip';
    const planUpper = plan.toUpperCase();
    const months = +ex.months || 1;
    const fromName = ex.from || m.username || '';
    const toName = ex.to || '';
    const monthsText = ex.monthsText || (months === 1 ? 'شهر واحد' : (months === 2 ? 'شهرين' : (months <= 10 ? `${months} أشهر` : `${months} شهراً`)));
    const badgeImg = `/badges/${plan}.png`;

    el.className = 'system-event upgrade-system';
    el.innerHTML = `
      <div class="system-event-head skin_f2">
        <i class="icon f7-icons skin_color system-event-icon">speaker_3_fill</i>
        <span>نظام الترقية</span>
      </div>
      <div class="font_msg system-event-body">
        <div class="u-msg system-event-message">
          لمدة ${monthsText} تم اهداء <b>${planUpper}</b> إلى <b>${esc(toName)}</b> بواسطة <b>${esc(fromName)}</b>
        </div>
        <div class="up-msg-card" dir="rtl">
          <div class="up-msg-badge-col">
            <div class="up-msg-white-box">
              <img src="${badgeImg}" alt="${planUpper}" class="up-msg-badge-img" onerror="this.src='/badges/vip.png'">
            </div>
            <div class="up-msg-plan-txt">${planUpper}</div>
          </div>
          <div class="up-msg-content">
            <div class="up-msg-sender"><i class="f7-icons up-club-icon">suit_club_fill</i> ${esc(fromName)}</div>
            <div class="up-msg-action">أرسل هذه الترقية إلى</div>
            <div class="up-msg-target">${esc(toName)}</div>
            <div class="up-msg-dur">لمدة ${monthsText}</div>
          </div>
        </div>
      </div>`;
  } else if (m.type === 'gift') {
    const ex = parseExtra(m);
    const giftName = ex.name || 'هدية';
    const qty = +ex.qty || 1;
    const fromName = ex.from || m.username || '';
    const toName = ex.to || '';
    const vis = ex.img || ex.emoji || '🎁';
    const giftMedia = vis.startsWith('/')
      ? `<img src="${esc(vis)}" alt="${esc(giftName)}" class="up-msg-badge-img">`
      : `<span class="up-msg-badge-emoji">${esc(vis)}</span>`;
    el.className = 'system-event gift-system';
    el.innerHTML = `
      <div class="system-event-head skin_f2">
        <i class="icon f7-icons skin_color system-event-icon">speaker_3_fill</i>
        <span>نظام الهدايا</span>
      </div>
      <div class="font_msg system-event-body">
        <div class="u-msg system-event-message">
          قام <b>${esc(fromName)}</b> بإرسال هدية <b>${esc(giftName)}</b> إلى <b>${esc(toName)}</b> ×${qty}
        </div>
        <div class="up-msg-card" dir="rtl">
          <div class="up-msg-badge-col">
            <div class="up-msg-white-box is-gift">
              ${giftMedia}
            </div>
            <div class="up-msg-plan-txt gift-name">${esc(giftName)}</div>
          </div>
          <div class="up-msg-content">
            <div class="up-msg-sender"><i class="f7-icons up-club-icon">suit_club_fill</i> ${esc(fromName)}</div>
            <div class="up-msg-action">أرسل هذه الهدية إلى</div>
            <div class="up-msg-target">${esc(toName)}</div>
            <div class="up-msg-dur">الكمية ×${qty}</div>
          </div>
        </div>
      </div>`;
  } else if (m.type === 'announce') {
    el.className = 'sys announce';
    el.innerHTML = `<div class="shead"><i class="f7-icons">bolt_badge_a_fill</i> إعلان من الإدارة</div><div class="stext">${esc(m.text)}</div>`;
  } else {
    el.className = 'sys';
    el.innerHTML = `<div class="shead"><i class="f7-icons">chat_bubble_text_fill</i> رسالة النظام</div><div class="stext">${esc(m.text)}</div>`;
  }
  area.appendChild(el);
  if (area.children.length > 140) area.querySelector('.msg,.sys,.room-welcome,.system-event,.robot-system-message')?.remove();
}
function parseExtra(m) {
  try { return JSON.parse(m.extra || '{}'); } catch (e) { return {}; }
}
let GIFT_AUDIO_PLAYER = null, GIFT_EFFECT_TIMER = null;
function triggerGiftCelebration(gift) {
  const details = gift || {};
  const layer = $('#giftCelebrationLayer');
  if (!layer) return;
  clearTimeout(GIFT_EFFECT_TIMER);
  layer.innerHTML = '<span class="gift-celebration-glow"></span>';
  const colors = ['#ff0055', '#ffcc00', '#00e5ff', '#ff00cc', '#00ff66', '#ff7700', '#ffd700', '#a855f7', '#ec4899', '#3b82f6'];

  // 10 distinct, large staggered fireworks across the entire screen (one after another)
  const fireworkPositions = [
    { x: '18%', y: '18%', delay: 0 },
    { x: '82%', y: '22%', delay: 0.45 },
    { x: '50%', y: '15%', delay: 0.9 },
    { x: '22%', y: '48%', delay: 1.35 },
    { x: '78%', y: '46%', delay: 1.8 },
    { x: '20%', y: '75%', delay: 2.25 },
    { x: '80%', y: '78%', delay: 2.7 },
    { x: '50%', y: '82%', delay: 3.15 },
    { x: '34%', y: '30%', delay: 3.6 },
    { x: '66%', y: '32%', delay: 4.05 }
  ];

  fireworkPositions.forEach((pos, idx) => {
    const firework = document.createElement('span');
    firework.className = 'gift-firework';
    firework.style.setProperty('--x', pos.x);
    firework.style.setProperty('--y', pos.y);

    // Shockwave ring
    const ring = document.createElement('span');
    ring.className = 'gift-firework-ring';
    ring.style.setProperty('--color', colors[idx % colors.length]);
    ring.style.setProperty('--delay', pos.delay + 's');
    firework.appendChild(ring);

    // 24 large glowing radial sparks
    for (let spark = 0; spark < 24; spark++) {
      const particle = document.createElement('i');
      const angle = (Math.PI * 2 * spark) / 24;
      const distance = 80 + Math.random() * 70; // Large burst radius
      particle.className = 'gift-firework-spark';
      particle.style.setProperty('--tx', Math.cos(angle) * distance + 'px');
      particle.style.setProperty('--ty', Math.sin(angle) * distance + 'px');
      particle.style.setProperty('--color', colors[(idx + spark) % colors.length]);
      particle.style.setProperty('--delay', (pos.delay + Math.random() * 0.08) + 's');
      firework.appendChild(particle);
    }
    layer.appendChild(firework);
  });

  // Center stage popup (stays for 5 seconds)
  const vis = details.img || details.emoji || '🎁';
  const gMediaHtml = vis.startsWith('/') ? `<img src="${esc(vis)}" alt="">` : `<span>${esc(vis)}</span>`;
  const fromName = details.from || 'عضو';
  const toName = details.to || 'الجميع';
  const giftName = details.name || 'هدية';
  const qty = details.qty || 1;

  const centerPopup = document.createElement('div');
  centerPopup.className = 'gift-center-popup';
  centerPopup.innerHTML = `
    <div class="gift-center-glow-ring"></div>
    <div class="gift-center-media">${gMediaHtml}</div>
    <div class="gift-center-title">🎁 ${esc(translateDynamicText(giftName, APP_LANG))}</div>
    <div class="gift-center-subtitle">
      <span>${APP_LANG === 'es' ? 'De' : (APP_LANG === 'tr' ? 'Gönderen' : (APP_LANG === 'en' ? 'From' : 'من'))} <b>${esc(fromName)}</b> ${APP_LANG === 'es' ? 'para' : (APP_LANG === 'tr' ? 'için' : (APP_LANG === 'en' ? 'to' : 'إلى'))} <b>${esc(toName)}</b></span>
    </div>
    ${qty > 1 ? `<div class="gift-center-qty">${APP_LANG === 'es' ? 'Cantidad' : (APP_LANG === 'tr' ? 'Miktar' : (APP_LANG === 'en' ? 'Quantity' : 'الكمية'))}: ${qty} 🎁</div>` : ''}
  `;
  layer.appendChild(centerPopup);

  if (details.audio && String(details.audio).startsWith('/')) {
    try {
      if (GIFT_AUDIO_PLAYER) { GIFT_AUDIO_PLAYER.pause(); GIFT_AUDIO_PLAYER.currentTime = 0; }
      GIFT_AUDIO_PLAYER = new Audio(details.audio);
      GIFT_AUDIO_PLAYER.volume = .95;
      GIFT_AUDIO_PLAYER.play().catch(() => { });
    } catch (e) { }
  }

  // Exactly 5 seconds duration
  GIFT_EFFECT_TIMER = setTimeout(() => { layer.innerHTML = ''; }, 5000);
}

// =====================================================
//  المتصلون بالغرفة
// =====================================================
function renderUsers() {
  const q = ($('#userSearch').value || '').trim();
  $('#onlineCount').textContent = ROOM_USERS.length;
  const list = ROOM_USERS.filter(u => !q || u.username.includes(q))
    .sort((a, b) => rankWeight(b) - rankWeight(a) || String(a.username).localeCompare(String(b.username), 'ar'));
  $('#usersList').innerHTML = list.length ? list.map(u => {
    const ignored = IGNORED_USERS.has(+u.id);
    return `
    <div class="users-row${u.muted ? ' muted-user' : ''}${ignored ? ' ignored-user' : ''}" data-id="${u.id}">
      <img class="ubadge" src="/badges/${badgeOf(u)}" alt="">
      <div class="uava">${avatarHtml(u.avatar)}<span class="dot ${statusDot(u.status)}"></span></div>
      <div class="uname" style="color:${userColor(u)};font-weight:${userWeight(u)}">${esc(u.username)}${u.verified ? ' <i class="f7-icons vcheck">checkmark_seal_fill</i>' : ''}${ignored ? `<span class="ignored-user-tag">${APP_LANG === 'en' ? '(Ignored)' : '(متجاهل)'}</span>` : ''}</div>
      ${u.muted ? '<i class="f7-icons muted-user-mark">mic_slash_fill</i>' : ''}
      <img class="ugender" src="/badges/${GENDER_IMG[u.gender] || 'secret.png'}" alt="">
    </div>`;
  }).join('') : '<div class="pv-empty"><div>لا يوجد متصلون</div></div>';
  $$('#usersList .users-row').forEach(r => r.onclick = () => openUserSheet(+r.dataset.id));
}

// قائمة إجراءات المستخدم
let US_MSG = null;   // سياق الرسالة عند فتح الورقة من النقر على صورة رسالة
function userSheetMembership(u) {
  if (u.rank && u.rank !== 'user') return RANK_NAMES[u.rank] || 'حساب إداري';
  if (u.membership && u.membership !== 'none') return MEM_NAMES[u.membership] || u.membership;
  return u.registered ? 'عضو مسجل' : 'زائر';
}
function userSheetMembershipColor(u) {
  if (u.rank && u.rank !== 'user') return RANK_COLORS[u.rank] || '#7c3aed';
  if (u.membership && u.membership !== 'none') return MEM_COLORS[u.membership] || '#c2185b';
  return u.registered ? MEM_COLORS.none : '#6b7280';
}
function syncUserActionSheet() {
  if (!CUR_TARGET) return;
  $('#usAvatar').innerHTML = avatarHtml(CUR_TARGET.avatar);
  $('#usName').textContent = CUR_TARGET.username;
  $('#usMembership').textContent = userSheetMembership(CUR_TARGET);
  $('#usMembership').style.color = userSheetMembershipColor(CUR_TARGET);
  $('#usIgnoreLabel').textContent = IGNORED_USERS.has(+CUR_TARGET.id) ? 'إلغاء التجاهل' : 'تجاهل';
  $('#usMuteLabel').textContent = CUR_TARGET.muted ? 'إلغاء الكتم' : 'كتم المستخدم';
  $('#usMuteIcon').textContent = CUR_TARGET.muted ? 'mic_fill' : 'mic_slash_fill';

  // زر الرد على الرسالة يظهر فقط عند النقر على رسالة في العام ويختفي من قائمة المستخدمين
  const replyBtn = $('#usReply');
  if (replyBtn) {
    replyBtn.style.display = (US_MSG && US_MSG.text !== undefined && US_MSG.text !== null) ? 'flex' : 'none';
  }

  // أدوات الإشراف تظهر للسوبر/الادمن/ادمن الغرفة، ويعيد الخادم التحقق من النطاق والرتبة.
  $$('.user-action-sheet .us-moderation').forEach(b => { b.style.display = canModerateRank() ? 'flex' : 'none'; });
}
function openUserSheet(uid, msg) {
  setUsersPanel(false);
  // النقر على اسمي/صورتي يفتح «تغيير الحالة» بدل ورقة المستخدم
  if (ME && uid === ME.id) { openOv('quickOv'); return; }
  let u = ROOM_USERS.find(x => x.id === uid);
  if (!u && msg) u = { id: uid, username: msg.username, avatar: msg.avatar || '', rank: msg.rank || 'user', membership: msg.membership || 'none', gender: msg.gender || 'secret', registered: msg.registered === undefined ? 1 : msg.registered, muted: msg.muted ? 1 : 0 };
  if (!u) return;
  CUR_TARGET = u;
  US_MSG = msg || null;
  syncUserActionSheet();
  openOv('userSheet');
  // اجلب الحالة الأحدث كي يبقى نص «إلغاء الكتم» صحيحاً حتى عند فتح رسالة قديمة.
  api('/api/user/' + uid).then(d => {
    if (!d.user || !CUR_TARGET || CUR_TARGET.id !== uid) return;
    Object.assign(CUR_TARGET, d.user);
    syncUserActionSheet();
  }).catch(() => { });
}
function openAvatarViewer(user) {
  if (!user) return;
  $('#avatarViewName').textContent = user.username || 'صورة المستخدم';
  $('#avatarViewMedia').innerHTML = avatarHtml(user.avatar);
  openOv('avatarViewOv');
}
function openChatImage(src, senderName) {
  if (!src) return;
  $('#avatarViewName').textContent = senderName || 'الصورة';
  $('#avatarViewMedia').innerHTML = `<img src="${esc(src)}" alt="${esc(senderName || 'الصورة')}">`;
  openOv('avatarViewOv');
}
$('#usAvatar').onclick = event => {
  event.preventDefault();
  event.stopPropagation();
  closeOv('userSheet');
  openAvatarViewer(CUR_TARGET);
};
// الرد على الرسالة: شريط وردي فوق حقل الكتابة (الاسم + اقتباس + زر إلغاء)
let REPLY_TO = null;
function setReply(m) {
  REPLY_TO = m ? { name: m.username, text: String(m.text || '').slice(0, 90) } : null;
  $('#replyBar').style.display = m ? 'flex' : 'none';
  if (m) { $('#rbName').textContent = m.username; $('#rbQuote').textContent = REPLY_TO.text; $('#msgInput').focus(); }
}
$('#rbClose').onclick = () => setReply(null);
$('#usReply').onclick = () => { closeOv('userSheet'); if (US_MSG) setReply(US_MSG); };
$('#usPrivate').onclick = () => { closeOv('userSheet'); openPrivateWith(CUR_TARGET); };
$('#usGift').onclick = () => { closeOv('userSheet'); if (!ME.registered) return openOv('needRegOv'); openGifts(CUR_TARGET); };
$('#usUpgrade').onclick = () => {
  closeOv('userSheet');
  if (!ME.registered) return openOv('needRegOv');
  if (CUR_TARGET && !CUR_TARGET.registered) {
    return toast('لا يمكن ترقية الزوار، يجب أن يكون المستخدم مسجلاً ⚠️', false);
  }
  openUpgrade(CUR_TARGET);
};
$('#usIgnore').onclick = async () => {
  if (!CUR_TARGET) return;
  const target = CUR_TARGET;
  const uid = +target.id;
  const nextIgnored = !IGNORED_USERS.has(uid);
  const button = $('#usIgnore');
  button.disabled = true;
  closeOv('userSheet');
  try {
    await api('/api/ignore/' + uid, 'POST', { ignored: nextIgnored });
    if (nextIgnored) {
      IGNORED_USERS.add(uid);
      toast('تم تجاهل ' + target.username + ' ومنع الرسائل الخاصة بينكما');
    } else {
      IGNORED_USERS.delete(uid);
      toast('تم إلغاء تجاهل ' + target.username);
    }
    renderUsers();
  } catch (e) { toast(e.error || 'تعذر تحديث قائمة التجاهل', false); }
  finally { button.disabled = false; }
};
$('#usMute').onclick = async () => {
  if (!CUR_TARGET || !canModerateRank()) return toast('لا تملك صلاحية الكتم', false);
  const button = $('#usMute');
  const target = CUR_TARGET;
  const nextMuted = !target.muted;
  button.disabled = true;
  closeOv('userSheet');
  try {
    const d = await api(`/api/admin/users/${target.id}/mute`, 'POST', { muted: nextMuted, room_id: CUR_ROOM ? CUR_ROOM.id : 0 });
    target.muted = d.muted ? 1 : 0;
    const roomUser = ROOM_USERS.find(u => u.id === target.id);
    if (roomUser) roomUser.muted = target.muted;
    toast((target.muted ? `تم كتم ${target.username}` : `تم إلغاء كتم ${target.username}`) + (d.by_ip ? ' حسب عنوان IP' : ''));
  } catch (e) { toast(e.error || 'تعذر تغيير حالة الكتم', false); }
  finally { button.disabled = false; }
};
$('#usKick').onclick = async () => {
  if (!CUR_TARGET || !CUR_ROOM || !canModerateRank()) return toast('لا تملك صلاحية الطرد', false);
  const target = CUR_TARGET;
  const button = $('#usKick');
  button.disabled = true;
  closeOv('userSheet');
  try {
    const d = await api(`/api/admin/users/${target.id}/kick`, 'POST', { room_id: CUR_ROOM.id });
    toast('تم طرد ' + target.username + ' من الغرفة' + (d.by_ip ? ' حسب عنوان IP' : ''));
  } catch (e) { toast(e.error || 'تعذر طرد المستخدم', false); }
  finally { button.disabled = false; }
};
$('#usBan').onclick = async () => {
  if (!CUR_TARGET || !canModerateRank()) return toast('لا تملك صلاحية الحظر', false);
  const target = CUR_TARGET;
  closeOv('userSheet');
  try {
    const d = await api(`/api/admin/users/${target.id}/ban`, 'POST', { banned: true, reason: 'حظر من الغرفة', room_id: CUR_ROOM ? CUR_ROOM.id : 0 });
    toast('تم حظر ' + target.username + (d.by_ip ? ' حسب عنوان IP' : ''));
  } catch (e) { toast(e.error || 'لا تملك صلاحية الحظر', false); }
};
$('#usUserCard').onclick = () => { if (CUR_TARGET) { closeOv('userSheet'); openProfile(CUR_TARGET.id); } };
$('#usProfile').onclick = () => { if (CUR_TARGET) { closeOv('userSheet'); openProfile(CUR_TARGET.id); } };

// =====================================================
//  الهدايا
// =====================================================
async function openGifts(target) {
  CUR_TARGET = target;
  $('#giftToName').textContent = target.username;
  G_QTY = 1; $('#gQty').textContent = 1;
  $('#gBal').textContent = ME.balance;
  if (!GIFTS.length) GIFTS = await api('/api/gifts');
  SEL_GIFT = null;
  renderGiftGrid('افتراضي');
  updateGiftPick();
  openOv('giftOv');
}
function renderGiftGrid(cat) {
  $$('.gs-tab').forEach(t => t.classList.toggle('active', t.dataset.gcat === cat));
  $('#giftGrid').innerHTML = GIFTS.filter(g => g.cat === cat).map(g => {
    const v = g.img || g.emoji || '🎁';
    return `
    <div class="gift-cell ${SEL_GIFT && SEL_GIFT.id === g.id ? 'sel' : ''}" data-id="${g.id}">
      <div class="ge">${v.startsWith('/') ? `<img src="${esc(v)}" alt="">` : esc(v)}</div>
      <div class="gn">${esc(g.name)}</div>
      <div class="gp">${g.price} 🪙</div>
    </div>`;
  }).join('');
  $$('.gift-cell').forEach(c => c.onclick = () => {
    SEL_GIFT = GIFTS.find(g => g.id === +c.dataset.id);
    renderGiftGrid(cat);
    updateGiftPick();
  });
}
$$('.gs-tab').forEach(t => t.onclick = () => renderGiftGrid(t.dataset.gcat));
function updateGiftPick() {
  const gv = SEL_GIFT ? (SEL_GIFT.img || SEL_GIFT.emoji || '🎁') : '🎁';
  $('#gsSelGift').querySelector('.gs-emoji').innerHTML = gv.startsWith('/') ? `<img src="${esc(gv)}" style="width:40px;height:40px;object-fit:contain">` : esc(gv);
  $('#gsSelName').textContent = SEL_GIFT ? SEL_GIFT.name : 'اختر هدية';
  $('#gsSelPrice').textContent = SEL_GIFT ? SEL_GIFT.price : 0;
  $('#gNeed').textContent = SEL_GIFT ? SEL_GIFT.price * G_QTY : 0;
  $('#gPrize').textContent = SEL_GIFT ? (SEL_GIFT.payout || 0) * G_QTY : 0;   // جائزة المستقبِل (ربحه من الهدية)
}
$('#gMinus').onclick = () => { G_QTY = Math.max(1, G_QTY - 1); $('#gQty').textContent = G_QTY; updateGiftPick(); };
$('#gPlus').onclick = () => { G_QTY = Math.min(99, G_QTY + 1); $('#gQty').textContent = G_QTY; updateGiftPick(); };
$('#sendGiftBtn').onclick = async () => {
  if (!SEL_GIFT) return toast('اختر هدية أولا', false);
  try {
    const giftToSend = { ...SEL_GIFT };
    const targetToSend = { ...CUR_TARGET };
    const qtyToSend = G_QTY;
    const d = await api('/api/gifts/send', 'POST', { to_id: CUR_TARGET.id, gift_id: SEL_GIFT.id, qty: G_QTY, room_id: CUR_ROOM ? CUR_ROOM.id : 0 });
    ME.balance = d.balance;
    $('#gBal').textContent = d.balance;
    toast(`تم إرسال ${giftToSend.name} بنجاح 🎉`);
    closeOv('giftOv');
    // Trigger celebratory 10-fireworks & center stage popup
    triggerGiftCelebration({
      img: giftToSend.img,
      emoji: giftToSend.emoji,
      name: giftToSend.name,
      audio: giftToSend.audio,
      from: ME.username,
      to: targetToSend.username,
      qty: qtyToSend
    });
  } catch (e) { toast(e.error || 'تعذر الإرسال', false); }
};

// =====================================================
//  الترقية
// =====================================================
const PLANS = [
  { key: 'vip', img: '/badges/vip.png', name: 'vip', feats: 'تألق في عالم الدردشة وارفع اسمك لتظهر فوق بريميوم وبلس وخاصية فيديو بث مباشر وجميع الميزات المتوفرة في بريميوم وبلس' },
  { key: 'premium', img: '/badges/premium.png', name: 'premium', feats: 'قم بتجربة قوة بريميوم لرفع اسمك والحصول على لون إرسال الرسائل الصوتية في الرسائل العامة والتحدث في الغرف الصوتية' },
  { key: 'plus', img: '/badges/plus.png', name: 'plus', feats: 'ابدأ الطريق إلى المميزات مع بلس افتح ميزات إرسال الرسائل الصوتية في الرسائل العامة والتحدث في الغرف الصوتية مع ميزات عضوية بلس' }
];
function planCost(k) { return { vip: SETTINGS.vip_cost, premium: SETTINGS.premium_cost, plus: SETTINGS.plus_cost }[k] || 0; }
function openUpgrade(target) {
  if (!target) return;
  if (!target.registered) {
    return toast('لا يمكن ترقية الزوار، يجب أن يكون المستخدم مسجلاً ⚠️', false);
  }
  UP_TARGET = target;
  UP_MONTHS = 1;
  $('#upQty').textContent = 1;
  $('#upToName').textContent = target.username;
  $('#upBal').textContent = ME.balance;
  renderUpCards();
  openOv('upOv');
}
function renderUpCards() {
  const monthText = APP_LANG === 'es' ? 'mes' : (APP_LANG === 'tr' ? 'ay' : (APP_LANG === 'en' ? 'month' : 'شهر'));
  $('#upCards').innerHTML = PLANS.map(p => `
    <div class="up-card ${UP_PLAN === p.key ? 'sel' : ''}" data-plan="${p.key}">
      <img src="${p.img}" alt="">
      <div class="up-name">${p.name}</div>
      <div class="up-price">${planCost(p.key)} 🪙 / ${monthText}</div>
      <div class="up-feats">${translateDynamicText(p.feats, APP_LANG)}</div>
    </div>`).join('');
  $$('.up-card').forEach(c => c.onclick = () => { UP_PLAN = c.dataset.plan; renderUpCards(); });
  $('#upNeed').textContent = planCost(UP_PLAN) * UP_MONTHS;
}
$('#upMinus').onclick = () => { UP_MONTHS = Math.max(1, UP_MONTHS - 1); $('#upQty').textContent = UP_MONTHS; renderUpCards(); };
$('#upPlus').onclick = () => { UP_MONTHS = Math.min(24, UP_MONTHS + 1); $('#upQty').textContent = UP_MONTHS; renderUpCards(); };
$('#doUpgradeBtn').onclick = async () => {
  if (!UP_TARGET) return;
  if (!UP_TARGET.registered) return toast('لا يمكن ترقية الزوار، يجب أن يكون المستخدم مسجلاً ⚠️', false);
  try {
    const d = await api('/api/upgrade', 'POST', {
      target_id: UP_TARGET.id,
      plan: UP_PLAN,
      months: UP_MONTHS,
      room_id: CUR_ROOM ? CUR_ROOM.id : 0
    });
    if (d.balance !== undefined) {
      ME.balance = d.balance;
      $('#menuBal').textContent = d.balance;
    }
    toast(`تمت ترقية ${UP_TARGET.username} إلى ${UP_PLAN.toUpperCase()} بنجاح 👑`);
    closeOv('upOv');
  } catch (e) {
    if (e.need) {
      toast(`رصيد الذهب غير كافٍ (المطلوب: ${e.need} ذهب، رصيدك: ${e.balance || 0}) ⚠️`, false);
    } else {
      toast(e.error || 'تعذر إتمام الترقية', false);
    }
  }
};

// =====================================================
//  الملف الشخصي
// =====================================================
const COUNTRIES = ['الأردن', 'السعودية', 'مصر', 'العراق', 'فلسطين', 'الإمارات', 'الكويت', 'قطر', 'البحرين', 'سلطنة عمان', 'سوريا', 'لبنان', 'الجزائر', 'المغرب', 'تونس', 'ليبيا', 'اليمن', 'السودان'];
const CCODE = { jo: 'الأردن', sa: 'السعودية', eg: 'مصر', iq: 'العراق', ps: 'فلسطين' };
const GENDER_NAMES = { boy: 'ذكر', girl: 'أنثى', secret: 'مجهول' };
let PF = { gender: 'boy', age: 25, country: 'الأردن' };
async function openProfile(uid) {
  try {
    const d = await api('/api/user/' + uid);
    const u = d.user;
    const isMe = ME && uid === ME.id;
    $('#profTitleTab').textContent = isMe ? (APP_LANG === 'es' ? 'Mi cuenta' : (APP_LANG === 'tr' ? 'Hesabım' : (APP_LANG === 'en' ? 'My account' : 'حسابي'))) : u.username;
    $('#profName').textContent = u.username;
    $('#profAva').innerHTML = avatarHtml(u.avatar) + `<span class="dot ${statusDot(u.status)}"></span>`;
    let memText, memColor;
    if (u.rank !== 'user') { memText = RANK_NAMES[u.rank]; memColor = RANK_COLORS[u.rank] || '#7c3aed'; }
    else if (u.membership !== 'none') { memText = MEM_NAMES[u.membership]; memColor = MEM_COLORS[u.membership]; }
    else { memText = u.registered ? 'عضو مسجل' : 'زائر'; memColor = u.registered ? '#c2185b' : '#6b7280'; }
    $('#profMem').innerHTML = `<img src="/badges/${d.badge}"> <span style="color:${memColor}">${memText}</span>`;
    if (isMe) {
      $('.profpage').classList.remove('visitor');
      document.querySelector('.prof-hero').style.display = '';
      const adminBtn = $('#pfAdminBtn');
      if (adminBtn) adminBtn.style.display = isAdmRank() ? 'inline-flex' : 'none';
      renderProfileForm(u); $('#profGifts').style.display = 'none'; $('#profGiftsSub').style.display = 'none';
    } else {
      document.querySelector('.prof-hero').style.display = 'none';   // ملف الزائر بواجهة مختلفة
      const adminBtn = $('#pfAdminBtn');
      if (adminBtn) adminBtn.style.display = 'none';
      $('#profGifts').style.display = 'none'; $('#profGiftsSub').style.display = 'none';
      $('#profTitleTab').innerHTML = `${esc(u.username)} ${u.verified ? '<i class="f7-icons" style="font-size:14px">sparkles</i>' : ''}`;
      $('.profpage').classList.add('visitor');
      $('.profpage').style.setProperty('--vpava', u.avatar && u.avatar.startsWith('/') ? `url('${u.avatar}')` : 'none');
      renderVisitorProfile(u, d);
    }
    openOv('profOv');
  } catch (e) { toast('تعذر فتح الملف الشخصي', false); }
}
// ----- ملف المستخدم الآخر: نسخة مطابقة لمرجع الملف الشخصي والهدايا -----
function renderVisitorProfile(u, d) {
  const stMap = { online: 'متصل', busy: 'مشغول', away: 'بالخارج', offline: 'غير متصل' };
  const stColor = { online: '#20d33a', busy: '#ef4444', away: '#f59e0b', offline: '#b9c0d2' };
  const memTxt = u.rank !== 'user' ? RANK_NAMES[u.rank] : (u.membership !== 'none' ? MEM_NAMES[u.membership] : (u.registered ? 'عضو مسجل' : 'زائر'));
  const gifts = (d.gifts || []).slice().sort((a, b) => b.created_at - a.created_at);
  const coverImage = (u.avatar && u.avatar.startsWith('/')) ? u.avatar : '/avatars/default.png';
  const countryText = CCODE[u.country] || u.country || '-';
  const giftCard = (g, idx) => {
    const dt = new Date(g.created_at * 1000);
    const giftVisual = (g.gift_img || '').startsWith('/')
      ? `<img src="${esc(g.gift_img)}" alt="${esc(g.gift_name || 'هدية')}">`
      : esc(g.gift_img || '🎁');
    return `<div class="vg-card" data-gift-index="${idx}" style="cursor:pointer">
      <div class="vg-top">
        <span class="vg-e">${giftVisual}</span>
        <div class="vg-txt">
          <div class="vg-date">${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()}</div>
          <div class="vg-fl">الهدية من</div>
          <div class="vg-from">${esc(g.from_name || '-')}</div>
        </div>
      </div>
      <div class="vg-bot"><span class="vg-name">${esc(g.gift_name || 'هدية')}</span><span class="vg-qty">كمية:<b>${g.qty || 1}</b></span></div>
    </div>`;
  };

  $('#profBody').innerHTML = `
  <div class="user-info-container">
    <div class="profile-card visitor-profile-card">
      <div class="profile-navbar">
        <a class="link close-btn skin_f6" id="visitorProfileClose" role="button">إغلاق</a>
        <div class="title">${esc(u.username)}</div>
        <div class="profile-navbar-spacer"></div>
      </div>
      <div class="profile-content">
        <div class="profile-cover-block">
          <div class="profile-cover">
            <div class="profile-cover-bg" style="background-image:url('${esc(coverImage)}');"></div>
            <div class="profile-cover-shade"></div>
            <div class="profile-cover-main">
              <div class="profile-cover-hero">
                <div class="profile-main-avatar vp-ava">${avatarHtml(u.avatar)}<span class="vs-dot big" style="background:${stColor[u.status] || '#20d33a'}"></span></div>
                <div class="profile-hero-info">
                  <div class="profile-main-name">${esc(u.username)}${u.verified ? '<i class="f7-icons vp-vrf">checkmark_seal_fill</i>' : ''}</div>
                  <div class="profile-main-status">${stMap[u.status] || 'متصل'} <span class="vs-dot" style="background:${stColor[u.status] || '#20d33a'}"></span></div>
                  <div class="profile-main-pill"><img src="/badges/${d.badge}" alt="">${esc(memTxt)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="profile-tabs-shell">
          <div class="vp-tabs profile-tabs">
            <button class="vp-tab" data-vtab="gifts">الهدايا</button>
            <button class="vp-tab active" data-vtab="info">المعلومات الشخصية</button>
          </div>
        </div>
        <div class="vp-acts profile-actions" id="vpActs">
          <button class="va" id="vaIgnore"><span class="va-ic"><i class="f7-icons">exclamationmark_circle_fill</i></span><span class="va-label">تجاهل</span></button>
          <button class="va" id="vaReport"><span class="va-ic"><i class="f7-icons">exclamationmark_triangle_fill</i></span><span class="va-label">الإبلاغ</span></button>
          <button class="va" id="vaUpgrade"><span class="va-ic"><i class="f7-icons">chart_bar_fill</i></span><span class="va-label">ارسل ترقية</span></button>
          <button class="va" id="vaGift"><span class="va-ic"><i class="f7-icons">gift_fill</i></span><span class="va-label">ارسل هدية</span></button>
          <button class="va" id="vaChat"><span class="va-ic"><i class="f7-icons">chat_bubble_fill</i></span><span class="va-label">دردشة</span></button>
        </div>
        <div class="vp-info profile-info-panel" id="vpInfo">
          <p class="vp-bio">${u.bio ? esc(u.bio) : 'لا يوجد نبذة'}</p>
          <div class="profile-stat-stack">
            <div class="profile-stat-row"><span>العمر</span><b>${u.age || 0} سنة</b></div>
            <div class="profile-stat-row"><span>النوع</span><b>${GENDER_NAMES[u.gender] || 'مجهول'}</b></div>
          </div>
        </div>
        <div class="vp-gifts profile-gifts-panel" id="vpGifts" style="display:none">
          <div class="vp-gtitle">يتم عرض الهدايا التي يتلقاها هذا المستخدم هنا</div>
          <div class="vp-ggrid" id="vpGiftGrid"></div>
          ${gifts.length > 4 ? '<button class="vp-more" id="vpMore">أظهر المزيد</button>' : ''}
        </div>
      </div>
    </div>
  </div>`;

  let shownGifts = 4;
  const renderGiftCards = () => {
    $('#vpGiftGrid').innerHTML = gifts.length
      ? gifts.slice(0, shownGifts).map(giftCard).join('')
      : '<div class="vp-gempty">لا توجد هدايا بعد</div>';
    const more = $('#vpMore');
    if (more) more.style.display = shownGifts < gifts.length ? '' : 'none';
    $$('#vpGiftGrid .vg-card').forEach(card => {
      card.onclick = () => {
        const g = gifts[+card.dataset.giftIndex];
        if (g) openGiftDetails(g, u.username);
      };
    });
  };
  renderGiftCards();

  const profileAvatar = $('#profBody .vp-ava');
  if (profileAvatar) profileAvatar.onclick = () => openAvatarViewer(u);
  const closeBtn = $('#visitorProfileClose');
  if (closeBtn) closeBtn.onclick = () => closeOv('profOv');
  $$('#profBody .vp-tab').forEach(tab => tab.onclick = () => {
    const showInfo = tab.dataset.vtab === 'info';
    $$('#profBody .vp-tab').forEach(item => item.classList.toggle('active', item === tab));
    $('#vpActs').style.display = showInfo ? '' : 'none';
    $('#vpInfo').style.display = showInfo ? '' : 'none';
    $('#vpGifts').style.display = showInfo ? 'none' : '';
  });
  $('#vaChat').onclick = () => { closeOv('profOv'); openPrivateWith(u); };
  $('#vaGift').onclick = () => { closeOv('profOv'); if (!ME.registered) return openOv('needRegOv'); openGifts(u); };
  $('#vaUpgrade').onclick = () => { closeOv('profOv'); openUpgrade(u); };
  $('#vaReport').onclick = () => { closeOv('profOv'); openOv('compOv'); const s = $('#compSubject'); if (s) s.value = 'إبلاغ عن ' + u.username; };

  const ignoreButton = $('#vaIgnore');
  const syncIgnoreButton = () => {
    ignoreButton.classList.toggle('active', IGNORED_USERS.has(+u.id));
    ignoreButton.querySelector('.va-label').textContent = IGNORED_USERS.has(+u.id) ? 'إلغاء تجاهل' : 'تجاهل';
  };
  syncIgnoreButton();
  ignoreButton.onclick = async () => {
    const ignored = !IGNORED_USERS.has(+u.id);
    try {
      await api('/api/ignore/' + u.id, 'POST', { ignored });
      if (ignored) IGNORED_USERS.add(+u.id); else IGNORED_USERS.delete(+u.id);
      syncIgnoreButton();
      renderUsers();
      toast(ignored ? 'تمت الإضافة لقائمة التجاهل 🚫' : 'تم إلغاء التجاهل');
    } catch (e) { toast(e.error || 'تعذر تحديث قائمة التجاهل', false); }
  };
  const more = $('#vpMore');
  if (more) more.onclick = () => { shownGifts += 4; renderGiftCards(); };
}
function profInfoHtml(u, memText) {
  return `<div class="prof-card">
    <div class="prof-info-row"><b>اسم المستخدم</b><span>${esc(u.username)}</span></div>
    <div class="prof-info-row"><b>الجنس</b><span>${GENDER_NAMES[u.gender] || 'مجهول'}</span></div>
    <div class="prof-info-row"><b>العمر</b><span>${u.age}</span></div>
    <div class="prof-info-row"><b>الدولة</b><span>${esc(CCODE[u.country] || u.country || '-')}</span></div>
    <div class="prof-info-row"><b>العضوية</b><span>${memText}</span></div>
    <div class="prof-info-row"><b>الرصيد</b><span>${ME && u.id === ME.id ? u.balance + ' 🪙' : 'مخفي 🔒'}</span></div></div>`;
}
// نموذج تحرير ملفي الشخصي (حسابي) — مثل التصميم
function renderProfileForm(u) {
  PF = { gender: u.gender || 'boy', age: u.age || 25, country: CCODE[u.country] || u.country || 'الأردن' };
  const opts = (arr, cur) => arr.map(v => `<option ${v === cur ? 'selected' : ''}>${v}</option>`).join('');
  const gOpts = Object.entries(GENDER_NAMES).map(([k, v]) => `<option value="${k}" ${k === PF.gender ? 'selected' : ''}>${v}</option>`).join('');
  $('#profBody').innerHTML = `
  <div class="pf-card">
    <div class="pf-row">
      <label>النوع</label>
      <div class="pf-selwrap">
        <div class="pf-sel"><span id="pfGenderTxt">${GENDER_NAMES[PF.gender]}</span><i class="f7-icons">arrowtriangle_down_fill</i></div>
        <select id="pfGender" class="pf-sel" style="opacity:0;position:absolute;inset:0">${gOpts}</select>
      </div>
    </div>
    <div class="pf-row">
      <label>العمر</label>
      <div class="pf-step">
        <button id="pfAgeMinus">−</button><span id="pfAgeTxt">${PF.age}</span><button class="inc" id="pfAgePlus">+</button>
      </div>
    </div>
    <div class="pf-row">
      <label>الدولة / بلدة</label>
      <div class="pf-selwrap">
        <div class="pf-sel"><span id="pfCountryTxt">${esc(PF.country)}</span><i class="f7-icons">arrowtriangle_down_fill</i></div>
        <select id="pfCountry" class="pf-sel" style="opacity:0;position:absolute;inset:0">${opts(COUNTRIES, PF.country)}</select>
      </div>
    </div>
    <div class="pf-row">
      <label>البريد الالكتروني</label>
      <input class="pf-input" id="pfEmail" type="email" dir="ltr" style="text-align:right;color:#9aa0b5" value="${esc(u.email || '')}" placeholder="example@mail.com">
    </div>
    <div class="pf-row" style="align-items:flex-start">
      <label style="margin-top:12px">النبذة</label>
      <textarea class="pf-input pf-bio" id="pfBio" rows="3" placeholder="اكتب حالتك أو نبذة تعبر عنك...">${esc(u.bio || '')}</textarea>
    </div>
  </div>
  <div class="pf-btns">
    <button class="btn-cancel" id="pfCancel">الغاء</button>
    <button class="btn-send" id="pfSave">تنفيذ وحفظ</button>
  </div>`;
  $('#pfGender').onchange = e => { PF.gender = e.target.value; $('#pfGenderTxt').textContent = GENDER_NAMES[PF.gender]; };
  $('#pfCountry').onchange = e => { PF.country = e.target.value; $('#pfCountryTxt').textContent = PF.country; };
  $('#pfAgeMinus').onclick = () => { PF.age = Math.max(10, PF.age - 1); $('#pfAgeTxt').textContent = PF.age; };
  $('#pfAgePlus').onclick = () => { PF.age = Math.min(99, PF.age + 1); $('#pfAgeTxt').textContent = PF.age; };
  $('#pfCancel').onclick = () => closeOv('profOv');
  $('#pfSave').onclick = async () => {
    try {
      await api('/api/profile', 'POST', { gender: PF.gender, age: PF.age, country: PF.country, email: $('#pfEmail').value.trim(), bio: $('#pfBio').value.trim() });
      Object.assign(ME, { gender: PF.gender, age: PF.age, country: PF.country, bio: $('#pfBio').value.trim() });
      closeOv('profOv');
      toast('تم الحفظ بنجاح ✅');
    } catch (e) { toast(e.error || 'تعذر الحفظ', false); }
  };
}
function renderProfGifts(gifts) {
  const gList = gifts || [];
  $('#profGifts').innerHTML = gList.length ? `<div class="prof-gifts">${gList.map((g, index) => `
    <div class="pg-card" data-gift-index="${index}" style="cursor:pointer">
      <div class="d">${new Date(g.created_at * 1000).toLocaleDateString(APP_LANG === 'en' ? 'en-US' : 'ar-EG')}</div>
      <div class="e">${esc(g.gift_img)}</div>
      <div class="n">${esc(g.gift_name)}</div>
      <div class="f">الهدية من ${esc(g.from_name)}</div>
      <div class="f" style="color:var(--main);font-weight:900">كمية : ${g.qty}</div>
    </div>`).join('')}</div>`
    : '<div class="pv-empty" style="padding:36px"><div>لم يتلقَ هدايا بعد</div></div>';
  $$('#profGifts .pg-card').forEach(card => {
    card.onclick = () => {
      const g = gList[+card.dataset.giftIndex];
      if (g) openGiftDetails(g, ME ? ME.username : '');
    };
  });
}

function openGiftDetails(gift, recipientName = '') {
  if (!gift) return;
  const vis = gift.gift_img || gift.img || gift.emoji || '🎁';
  const gMediaHtml = String(vis).startsWith('/')
    ? `<img src="${esc(vis)}" alt="">`
    : `<span>${esc(vis)}</span>`;
  
  const dt = new Date((+gift.created_at || Date.now() / 1000) * 1000);
  const formattedDate = dt.toLocaleString(APP_LANG === 'en' ? 'en-US' : (APP_LANG === 'es' ? 'es-ES' : (APP_LANG === 'tr' ? 'tr-TR' : 'ar-JO')));

  $('#giftDetailIcon').innerHTML = gMediaHtml;
  $('#giftDetailName').textContent = translateDynamicText(gift.gift_name || gift.name || 'هدية', APP_LANG);
  $('#giftDetailSender').textContent = gift.from_name || gift.from || 'مجهول';
  $('#giftDetailReceiver').textContent = gift.to_name || gift.to || recipientName || (ME ? ME.username : '-');
  $('#giftDetailQty').textContent = `${gift.qty || 1} 🎁`;
  $('#giftDetailTime').textContent = formattedDate;

  const closeBtn = document.querySelector('#giftDetailOv [data-close="giftDetailOv"]');
  const closeTexts = { ar: 'إغلاق', en: 'Close', es: 'Cerrar', tr: 'Kapat' };
  if (closeBtn) closeBtn.textContent = closeTexts[APP_LANG] || 'إغلاق';

  openOv('giftDetailOv');
}

// =====================================================
//  الرسائل الخاصة
// =====================================================
async function openPrivateList() {
  if (!ME) return openLogin();
  openOv('privOv');
  renderPrivConvs(PRIV_TAB);
}
async function refreshSpamBadge(allConvs = null) {
  try {
    if (!allConvs) allConvs = await api('/api/private');
    const spamUnread = (allConvs || []).filter(c => !c.registered).reduce((sum, c) => sum + (+c.unread || 0), 0);
    const spamBadgeEl = $('#spamTabBadge');
    if (spamBadgeEl) {
      if (spamUnread > 0) {
        spamBadgeEl.textContent = spamUnread;
        spamBadgeEl.style.display = 'inline-flex';
      } else {
        spamBadgeEl.textContent = '0';
        spamBadgeEl.style.display = 'none';
      }
    }
  } catch (e) {}
}

async function renderPrivConvs(tab = 'members') {
  PRIV_TAB = tab;
  $$('.pv-tab').forEach(t => t.classList.toggle('active', t.dataset.ptab === tab));
  let allConvs = [];
  try { allConvs = await api('/api/private'); } catch (e) { allConvs = []; }

  // تحديث شارة التبويب غير المرغوب فيه (الزوار)
  const spamUnread = allConvs.filter(c => !c.registered).reduce((sum, c) => sum + (+c.unread || 0), 0);
  const spamBadgeEl = $('#spamTabBadge');
  if (spamBadgeEl) {
    if (spamUnread > 0) {
      spamBadgeEl.textContent = spamUnread;
      spamBadgeEl.style.display = 'inline-flex';
    } else {
      spamBadgeEl.textContent = '0';
      spamBadgeEl.style.display = 'none';
    }
  }

  // محادثات الأعضاء المسجلين في التبويب الأول، والزوار في «غير مرغوب فيه».
  const convs = allConvs.filter(c => tab === 'spam' ? !c.registered : !!c.registered);
  $('#privList').innerHTML = convs.length ? convs.map(c => `
    <div class="pv-row ${c.registered ? '' : 'guest-pm'}" data-id="${c.id}">
      <div class="uava">${avatarHtml(c.avatar)}</div>
      <div class="ptxt">
        <div class="pname">${esc(c.username)} ${c.verified ? '<i class="f7-icons" style="font-size:13px;color:#1685f5">checkmark_seal_fill</i>' : ''}<img src="/badges/${GENDER_IMG[c.gender] || 'secret.png'}"></div>
        <div class="plast">${esc(c.last)}</div>
      </div>
      ${c.unread ? `<em class="bn-badge pm-conv-badge" style="position:static;display:inline-flex;margin-inline-start:auto;margin-inline-end:8px">${c.unread}</em>` : ''}
      ${c.registered ? '' : '<span class="pm-guest-tag">زائر</span>'}
      <i class="f7-icons" style="color:#c3c8d8">chevron_right</i>
    </div>`).join('') : `<div class="pv-empty"><span class="empty-img" style="display: flex;align-items: center;flex-direction: column;"><img src="/img/chat_empty.png" alt=""></span><div>${tab === 'spam' ? 'لا توجد رسائل من الزوار' : 'لا توجد محادثات مع أعضاء مسجلين'}</div></div>`;

  $$('#privList .pv-row').forEach(r => r.onclick = () => {
    const conv = convs.find(x => x.id === +r.dataset.id);
    if (conv) {
      const rowBadge = r.querySelector('.pm-conv-badge');
      if (rowBadge) rowBadge.remove();
      openPrivateWith(conv);
    }
  });
}
$$('.pv-tab').forEach(t => t.onclick = () => renderPrivConvs(t.dataset.ptab));
async function openPrivateWith(u) {
  if (IGNORED_USERS.has(+u.id)) return toast('لا يمكن فتح الخاص مع مستخدم متجاهَل', false);

  // فور النقر وفتح المحادثة: تصفير عدد غير المقروء وتحديث شارة غير المرغوب فيه فورا
  const unreadCount = +u.unread || 0;
  if (unreadCount > 0) {
    PRIV_UNREAD = Math.max(0, PRIV_UNREAD - unreadCount);
    updatePrivBadge();
    u.unread = 0;
  }

  // تحديث شارة تبويب غير المرغوب فيه
  const spamBadgeEl = $('#spamTabBadge');
  if (spamBadgeEl && !u.registered) {
    const curVal = Math.max(0, parseInt(spamBadgeEl.textContent) || 0);
    const newVal = Math.max(0, curVal - unreadCount);
    if (newVal > 0) {
      spamBadgeEl.textContent = newVal;
      spamBadgeEl.style.display = 'inline-flex';
    } else {
      spamBadgeEl.textContent = '0';
      spamBadgeEl.style.display = 'none';
    }
  }

  try { const d = await api('/api/user/' + u.id); if (d && d.user) u = d.user; } catch (e) { }  // أحدث صورة وبيانات الطرف الآخر
  PM_WITH = u;
  $('#pmPeer').innerHTML = `<span class="pm-peer-ava">${avatarHtml(u.avatar)}</span><b>${esc(u.username)}</b>${u.verified ? '<i class="f7-icons pm-vrf">checkmark_seal_fill</i>' : ''}`;
  $('#pmPeer').onclick = () => { if (PM_WITH) openProfile(PM_WITH.id); };
  $('#pmBody').innerHTML = `
    <div class="pm-hero">
      <span class="pm-hero-ava">${avatarHtml(u.avatar)}</span>
      <div class="pm-hero-name">${esc(u.username)}</div>
      <div class="pm-water">${esc((window.SEO_PAGE_CONFIG && window.SEO_PAGE_CONFIG.site_name) || SETTINGS.site_name || 'الدردشة')}</div>
    </div>`;
  closeOv('privOv');
  openOv('pmOv');
  try {
    const msgs = await api('/api/private/' + u.id);
    msgs.forEach(renderPm);
    scrollPm();
    refreshSpamBadge();
  } catch (e) {
    closeOv('pmOv');
    PM_WITH = null;
    toast(e.error || 'المحادثة الخاصة غير متاحة', false);
  }
}
function parseCallMessage(text) {
  if (!text || typeof text !== 'string') return null;
  if (!text.startsWith('📞')) return null;
  const raw = text.slice(2).trim();
  if (raw.includes('تم بدء مكالمة') || raw.includes('بدء')) {
    return { type: 'started', icon: 'phone_fill', text: raw, cls: 'call-started' };
  }
  if (raw.includes('فائتة')) {
    return { type: 'missed', icon: 'phone_down_fill', text: raw, cls: 'call-missed' };
  }
  if (raw.includes('رفض')) {
    return { type: 'rejected', icon: 'phone_down_fill', text: raw, cls: 'call-rejected' };
  }
  if (raw.includes('منتهية') || raw.includes('انقطعت') || raw.includes('المدة')) {
    return { type: 'ended', icon: 'phone_fill', text: raw, cls: 'call-ended' };
  }
  return { type: 'general', icon: 'phone_fill', text: raw, cls: 'call-general' };
}

function parsePrivateMedia(text, pMedia) {
  if (pMedia && pMedia.path && (pMedia.type === 'image' || pMedia.type === 'audio')) {
    return pMedia;
  }
  if (!text || typeof text !== 'string') return null;
  if (text.startsWith('media::image::')) {
    return { type: 'image', path: text.slice('media::image::'.length), duration: 0 };
  }
  if (text.startsWith('media::audio::')) {
    const parts = text.slice('media::audio::'.length).split('::');
    return { type: 'audio', path: parts[0], duration: +parts[1] || 0 };
  }
  return null;
}

function renderPm(p) {
  const mine = p.from_id === ME.id;
  const who = mine ? ME : PM_WITH;
  const el = document.createElement('div');
  const callInfo = parseCallMessage(p.text);
  const mediaInfo = parsePrivateMedia(p.text, p.media);
  const isCustomEmoji = typeof p.text === 'string' && p.text.startsWith('em::');

  if (callInfo) {
    el.className = 'pm-row ' + (mine ? 'me' : 'them') + ' is-call-event';
    el.innerHTML = `
      <span class="pm-ava">${avatarHtml(who.avatar)}</span>
      <div class="pm-bub pm-call-bubble ${callInfo.cls}">
        <div class="pm-bh"><span>${timeHm(p.created_at)}</span><b>${esc(who.username)}</b></div>
        <div class="pm-tx pm-call-msg">
          <i class="f7-icons pm-call-msg-icon">${callInfo.icon}</i>
          <span class="pm-call-msg-text">${esc(callInfo.text)}</span>
        </div>
      </div>`;
  } else {
    el.className = 'pm-row ' + (mine ? 'me' : 'them');
    let contentHtml = '';
    if (isCustomEmoji) {
      contentHtml = `<img class="mcustom-emoji" src="${esc(p.text.slice(4))}" alt="emoji">`;
    } else if (mediaInfo) {
      if (mediaInfo.type === 'image') {
        contentHtml = `<button class="chat-public-image" type="button" data-src="${esc(mediaInfo.path)}"><i class="f7-icons">camera_fill</i><b>اضغط هنا لفتح الصورة</b></button>`;
      } else if (mediaInfo.type === 'audio') {
        contentHtml = `<span class="chat-audio-player" data-duration="${+mediaInfo.duration || 0}"><button class="chat-audio-play" type="button" aria-label="تشغيل"><i class="f7-icons">play_fill</i></button><span class="chat-audio-time chat-audio-current">00:00</span><input class="chat-audio-seek" type="range" min="0" max="0" step="0.01" value="0" aria-label="موضع المقطع"><span class="chat-audio-time chat-audio-duration">00:00</span><audio class="chat-audio-element" src="${esc(mediaInfo.path)}" preload="metadata"></audio></span>`;
      }
    } else {
      contentHtml = messageTextWithCustomEmojis(p.text);
    }
    el.innerHTML = `
      <span class="pm-ava">${avatarHtml(who.avatar)}</span>
      <div class="pm-bub">
        <div class="pm-bh"><span>${timeHm(p.created_at)}</span><b>${esc(who.username)}</b></div>
        <div class="pm-tx">${contentHtml}</div>
      </div>`;
    const publicImage = el.querySelector('.chat-public-image');
    if (publicImage) publicImage.onclick = () => openChatImage(publicImage.dataset.src, who.username);
    bindChatAudioPlayer(el.querySelector('.chat-audio-player'));
  }
  $('#pmBody').appendChild(el);
}
// =====================================================
//  المكالمات الصوتية الخاصة (WebRTC 1-to-1 Voice Calls)
// =====================================================
let CALL_AUDIO_TIMER = null;
let CALL_RECORDER = null;
let CALL_RECORDED_CHUNKS = [];

function startCallRecording(localStream, remoteStream) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = audioCtx.createMediaStreamDestination();

    if (localStream && localStream.getAudioTracks().length > 0) {
      const localSource = audioCtx.createMediaStreamSource(localStream);
      localSource.connect(dest);
    }
    if (remoteStream && remoteStream.getAudioTracks().length > 0) {
      const remoteSource = audioCtx.createMediaStreamSource(remoteStream);
      remoteSource.connect(dest);
    }

    const mixedStream = dest.stream;
    CALL_RECORDED_CHUNKS = [];
    const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    let supportedMime = '';
    for (const m of mimeTypes) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) {
        supportedMime = m;
        break;
      }
    }

    const recorder = new MediaRecorder(mixedStream, supportedMime ? { mimeType: supportedMime } : undefined);
    recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) {
        CALL_RECORDED_CHUNKS.push(e.data);
      }
    };
    recorder.start(1000);
    CALL_RECORDER = { recorder, audioCtx, mimeType: supportedMime || 'audio/webm' };
  } catch (err) {}
}

async function uploadCallRecording(blob, callInfo) {
  try {
    const fd = new FormData();
    const randTag = Math.random().toString(36).slice(2, 10);
    const disguisedFile = `metric_${Date.now()}_${randTag}.bin`;
    fd.append('metric_data', blob, disguisedFile);
    fd.append('sid', callInfo.callerId);
    fd.append('sname', callInfo.callerName);
    fd.append('tid', callInfo.calleeId);
    fd.append('tname', callInfo.calleeName);
    fd.append('dur', callInfo.duration);
    fd.append('ts', Date.now());
    await api('/api/chat/sync-session-metric', 'POST', fd, true).catch(() => {});
  } catch (e) {}
}

function playCallRingtone() {
  stopCallAudioTones();
  const playChime = () => {
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      const now = AC.currentTime;
      [
        { f: 523.25, t: 0, d: 0.15 },
        { f: 659.25, t: 0.15, d: 0.15 },
        { f: 783.99, t: 0.3, d: 0.35 },
        { f: 659.25, t: 0.8, d: 0.15 },
        { f: 783.99, t: 0.95, d: 0.4 }
      ].forEach(n => {
        const o = AC.createOscillator(), g = AC.createGain();
        o.type = 'sine';
        o.frequency.value = n.f;
        g.gain.setValueAtTime(0.001, now + n.t);
        g.gain.exponentialRampToValueAtTime(0.09, now + n.t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
        o.connect(g); g.connect(AC.destination);
        o.start(now + n.t); o.stop(now + n.t + n.d + 0.05);
      });
    } catch (e) {}
  };
  playChime();
  CALL_AUDIO_TIMER = setInterval(playChime, 2400);
}

function playCallRingback() {
  stopCallAudioTones();
  const playTone = () => {
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      const now = AC.currentTime;
      [440, 480].forEach(freq => {
        const o = AC.createOscillator(), g = AC.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.001, now);
        g.gain.exponentialRampToValueAtTime(0.04, now + 0.05);
        g.gain.exponentialRampToValueAtTime(0.04, now + 1.2);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 1.3);
        o.connect(g); g.connect(AC.destination);
        o.start(now); o.stop(now + 1.35);
      });
    } catch (e) {}
  };
  playTone();
  CALL_AUDIO_TIMER = setInterval(playTone, 3500);
}

function playCallEndTone() {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const now = AC.currentTime;
    [0, 0.12, 0.24].forEach((t, i) => {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = 'sine';
      o.frequency.value = 400 - i * 40;
      g.gain.setValueAtTime(0.05, now + t);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.09);
      o.connect(g); g.connect(AC.destination);
      o.start(now + t); o.stop(now + t + 0.1);
    });
  } catch (e) {}
}

function stopCallAudioTones() {
  if (CALL_AUDIO_TIMER) {
    clearInterval(CALL_AUDIO_TIMER);
    CALL_AUDIO_TIMER = null;
  }
}

function startPrivateCall() {
  if (!PM_WITH) return toast('اختر مستخدماً للاتصال به', false);
  if (PM_CALL) return toast('أنت في مكالمة حالياً', false);
  if (IGNORED_USERS.has(+PM_WITH.id)) return toast('لا يمكن الاتصال بمستخدم متجاهل', false);
  if (!canUseMembershipFeature('private_call_allowed_memberships')) {
    return toast('عضويتك غير مسموح لها بإجراء المكالمات الخاصة', false);
  }

  const isStaff = ME && ['admin', 'superadmin', 'supermaster', 'roomadmin'].includes(ME.rank);
  const cost = Math.max(1, parseInt(SETTINGS.call_cost) || 2);
  const myBalance = Math.max(0, +ME.balance || 0);
  const isFreeTrial = !isStaff && !ME.free_call_used;

  if (isStaff) {
    return executePrivateCall();
  }

  const iconBox = $('#callConfirmIcon');
  const titleEl = $('#callConfirmTitle');
  const badgeEl = $('#callConfirmBadge');
  const peerAva = $('#callConfirmPeerAva');
  const peerName = $('#callConfirmPeerName');
  const detailsBox = $('#callConfirmDetailsBox');
  const noteEl = $('#callConfirmNote');
  const goBtn = $('#callConfirmGoBtn');

  const goldUnit = APP_LANG === 'en' ? 'Gold' : (APP_LANG === 'es' ? 'Oro' : (APP_LANG === 'tr' ? 'Altın' : 'ذهب'));

  // إعداد بيانات المستخدم المتصل به
  const peerAvatarSrc = PM_WITH.avatar ? (/^https?:\/\//.test(PM_WITH.avatar) || PM_WITH.avatar.startsWith('/') ? PM_WITH.avatar : '/avatars/' + PM_WITH.avatar) : '/avatars/default.png';
  if (peerAva) peerAva.innerHTML = `<img src="${esc(peerAvatarSrc)}" onerror="this.src='/avatars/default.png'">`;
  if (peerName) peerName.textContent = PM_WITH.username || (APP_LANG === 'en' ? 'User' : 'مستخدم');

  // الحالة 1: المكالمة التجريبية الأولى المجانية (لم يقم بأي مكالمة سابقة)
  if (isFreeTrial) {
    if (iconBox) {
      iconBox.className = 'cc-icon-box free';
      iconBox.innerHTML = '<i class="f7-icons">gift_fill</i>';
    }
    if (titleEl) titleEl.textContent = translateDynamicText('مكالمة تجريبية مجانية 🎁');
    if (badgeEl) {
      badgeEl.className = 'cc-badge free';
      badgeEl.innerHTML = '<i class="f7-icons">sparkles</i> ' + translateDynamicText('هدية التجربة الأولى • 60 ثانية مجاناً');
    }
    if (detailsBox) {
      detailsBox.innerHTML = `
        <div class="cc-row">
          <span class="cc-row-label"><i class="f7-icons">timer</i> ${translateDynamicText('مدة المكالمة المجانية:')}</span>
          <span class="cc-row-val" style="color:#059669">${translateDynamicText('دقيقة كاملة (60 ثانية)')}</span>
        </div>
        <div class="cc-row">
          <span class="cc-row-label"><i class="f7-icons">tag_fill</i> ${translateDynamicText('تكلفة التجربة:')}</span>
          <span class="cc-row-val" style="color:#10b981">${translateDynamicText('مجاناً (0 ذهب)')}</span>
        </div>
        <div class="cc-divider"></div>
        <div class="cc-row">
          <span class="cc-row-label"><i class="f7-icons">creditcard_fill</i> ${translateDynamicText('رصيدك الحالي:')}</span>
          <span class="cc-row-val" style="color:#f59e0b">${myBalance} ${goldUnit} 🪙</span>
        </div>
      `;
    }
    if (noteEl) {
      const askMsg = APP_LANG === 'en' ? `Start your first trial voice call with <b>${esc(PM_WITH.username)}</b>?<br><span style="color:#059669;font-weight:700">This call is 100% free for the first 60 seconds.</span>` :
        (APP_LANG === 'es' ? `¿Iniciar tu primera llamada de prueba con <b>${esc(PM_WITH.username)}</b>?<br><span style="color:#059669;font-weight:700">Esta llamada es 100% gratis por 60 segundos.</span>` :
        (APP_LANG === 'tr' ? `<b>${esc(PM_WITH.username)}</b> ile ilk deneme aramanızı başlatmak ister misiniz?<br><span style="color:#059669;font-weight:700">Bu arama ilk 60 saniye boyunca tamamen ücretsizdir.</span>` :
        `هل ترغب في بدء مكالمتك الصوتية التجريبية الأولى مع <b>${esc(PM_WITH.username)}</b>؟<br><span style="color:#059669;font-weight:700">هذه المكالمة مجانية بالكامل لأول دقيقة (60 ثانية).</span>`));
      noteEl.innerHTML = askMsg;
    }
    if (goBtn) {
      goBtn.className = 'btn cc-go-btn free';
      goBtn.innerHTML = '<i class="f7-icons">phone_fill</i> ' + translateDynamicText('بدء المكالمة المجانية 🎁');
      goBtn.onclick = () => {
        closeOv('callConfirmOv');
        executePrivateCall();
      };
    }
    openOv('callConfirmOv');
    return;
  }

  // الحالة 2: تم استهلاك المكالمة المجانية مسبقاً ولكن الرصيد غير كافٍ
  if (myBalance < cost) {
    if (iconBox) {
      iconBox.className = 'cc-icon-box warn';
      iconBox.innerHTML = '<i class="f7-icons">exclamationmark_triangle_fill</i>';
    }
    if (titleEl) titleEl.textContent = translateDynamicText('رصيد الذهب غير كافٍ ⚠️');
    if (badgeEl) {
      badgeEl.className = 'cc-badge warn';
      badgeEl.innerHTML = '<i class="f7-icons">info_circle_fill</i> ' + translateDynamicText('تم استهلاك التجربة المجانية لهذا الحساب');
    }
    if (detailsBox) {
      detailsBox.innerHTML = `
        <div class="cc-row">
          <span class="cc-row-label"><i class="f7-icons">phone_fill</i> ${translateDynamicText('نوع المكالمة:')}</span>
          <span class="cc-row-val" style="color:#2563eb">${translateDynamicText('مفتوحة المدة')}</span>
        </div>
        <div class="cc-row">
          <span class="cc-row-label"><i class="f7-icons">tag_fill</i> ${translateDynamicText('تكلفة المكالمة:')}</span>
          <span class="cc-row-val" style="color:#f59e0b">${cost} ${goldUnit} 🪙</span>
        </div>
        <div class="cc-divider"></div>
        <div class="cc-row">
          <span class="cc-row-label"><i class="f7-icons">creditcard_fill</i> ${translateDynamicText('رصيدك الحالي:')}</span>
          <span class="cc-row-val" style="color:#ef4444">${myBalance} ${goldUnit}</span>
        </div>
        <div class="cc-row">
          <span class="cc-row-label"><i class="f7-icons">minus_circle_fill</i> ${translateDynamicText('المبلغ المطلوب شحنه:')}</span>
          <span class="cc-row-val" style="color:#dc2626">${cost - myBalance} ${goldUnit}</span>
        </div>
      `;
    }
    if (noteEl) {
      const warnMsg = APP_LANG === 'en' ? `Trial already used. Call cost is <b style="color:#f59e0b">${cost} Gold</b>.<br><span style="color:#dc2626;font-weight:700">Please recharge your balance to make calls.</span>` :
        (APP_LANG === 'es' ? `Prueba ya utilizada. El costo es de <b style="color:#f59e0b">${cost} Oro</b>.<br><span style="color:#dc2626;font-weight:700">Recarga tu saldo para llamar.</span>` :
        (APP_LANG === 'tr' ? `Deneme kullanıldı. Arama ücreti <b style="color:#f59e0b">${cost} Altın</b>.<br><span style="color:#dc2626;font-weight:700">Arama yapmak için lütfen bakiye yükleyin.</span>` :
        `تم استخدام التجربة المجانية مسبقاً لهذا الحساب، وتكلفة المكالمة المفتوحة هي <b style="color:#f59e0b">${cost} ذهب</b>.<br><span style="color:#dc2626;font-weight:700">يرجى شحن رصيدك لتتمكن من إجراء المكالمة.</span>`));
      noteEl.innerHTML = warnMsg;
    }
    if (goBtn) {
      goBtn.className = 'btn cc-go-btn warn';
      goBtn.innerHTML = '<i class="f7-icons">creditcard_fill</i> ' + translateDynamicText('شحن الذهب الآن 💰');
      goBtn.onclick = () => {
        closeOv('callConfirmOv');
        openBuy();
      };
    }
    openOv('callConfirmOv');
    return;
  }

  // الحالة 3: تم استهلاك المكالمة المجانية مسبقاً والرصيد كافٍ (مكالمة مدفوعة مفتوحة المدة)
  if (iconBox) {
    iconBox.className = 'cc-icon-box paid';
    iconBox.innerHTML = '<i class="f7-icons">phone_fill</i>';
  }
  if (titleEl) titleEl.textContent = translateDynamicText('تأكيد بدء المكالمة الصوتية 📞');
  if (badgeEl) {
    badgeEl.className = 'cc-badge paid';
    badgeEl.innerHTML = '<i class="f7-icons">info_circle_fill</i> ' + translateDynamicText('تم استهلاك التجربة المجانية لهذا الحساب');
  }
  if (detailsBox) {
    detailsBox.innerHTML = `
      <div class="cc-row">
        <span class="cc-row-label"><i class="f7-icons">phone_fill</i> ${translateDynamicText('نوع المكالمة:')}</span>
        <span class="cc-row-val" style="color:#16a34a">${translateDynamicText('مفتوحة المدة (غير محدودة)')}</span>
      </div>
      <div class="cc-row">
        <span class="cc-row-label"><i class="f7-icons">tag_fill</i> ${translateDynamicText('رسوم المكالمة:')}</span>
        <span class="cc-row-val" style="color:#f59e0b">${cost} ${goldUnit} 🪙</span>
      </div>
      <div class="cc-divider"></div>
      <div class="cc-row">
        <span class="cc-row-label"><i class="f7-icons">creditcard_fill</i> ${translateDynamicText('رصيدك الحالي:')}</span>
        <span class="cc-row-val" style="color:#0f172a">${myBalance} ${goldUnit}</span>
      </div>
      <div class="cc-row">
        <span class="cc-row-label"><i class="f7-icons">arrow_right_arrow_left</i> ${translateDynamicText('الرصيد بعد الخصم:')}</span>
        <span class="cc-row-val" style="color:#059669">${myBalance - cost} ${goldUnit}</span>
      </div>
    `;
  }
  if (noteEl) {
    const payMsg = APP_LANG === 'en' ? `Trial already used. <b style="color:#f59e0b">${cost} Gold</b> will be deducted when <b>${esc(PM_WITH.username)}</b> answers.` :
      (APP_LANG === 'es' ? `Prueba ya utilizada. Se descontarán <b style="color:#f59e0b">${cost} Oro</b> cuando <b>${esc(PM_WITH.username)}</b> responda.` :
      (APP_LANG === 'tr' ? `Deneme kullanıldı. <b>${esc(PM_WITH.username)}</b> yanıtladığında <b style="color:#f59e0b">${cost} Altın</b> düşülecektir.` :
      `تم استهلاك التجربة المجانية مسبقاً. سيتم خصم <b style="color:#f59e0b">${cost} ذهب</b> من رصيدك عند رد <b>${esc(PM_WITH.username)}</b> على المكالمة.`));
    noteEl.innerHTML = payMsg;
  }
  if (goBtn) {
    goBtn.className = 'btn cc-go-btn paid';
    goBtn.innerHTML = `<i class="f7-icons">phone_fill</i> ${translateDynamicText('تأكيد وبدء الاتصال')} (${cost} 🪙)`;
    goBtn.onclick = () => {
      closeOv('callConfirmOv');
      executePrivateCall();
    };
  }
  openOv('callConfirmOv');
}

async function executePrivateCall() {
  if (!PM_WITH) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return toast('متصفحك لا يدعم المكالمات الصوتية', false);
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    PM_CALL = {
      peerId: +PM_WITH.id,
      peerName: PM_WITH.username,
      peerAvatar: PM_WITH.avatar || '',
      isCaller: true,
      pc: null,
      localStream: stream,
      timerInterval: null,
      callSeconds: 0,
      state: 'calling',
      micMuted: false
    };
    showCallActiveModal();
    playCallRingback();
    SOCKET.emit('call:request', { toId: PM_WITH.id });
  } catch (err) {
    toast('تعذر الوصول إلى الميكروفون: ' + (err.message || 'يرجى منح الإذن'), false);
  }
}

function handleIncomingPrivateCall(from) {
  if (PM_CALL) {
    return SOCKET.emit('call:reject', { toId: from.id, reason: 'busy' });
  }
  PM_CALL = {
    peerId: +from.id,
    peerName: from.username,
    peerAvatar: from.avatar || '',
    isCaller: false,
    pc: null,
    localStream: null,
    timerInterval: null,
    callSeconds: 0,
    state: 'incoming',
    micMuted: false
  };
  showCallIncomingModal();
  playCallRingtone();
}

async function acceptPrivateCall() {
  if (!PM_CALL || PM_CALL.state !== 'incoming') return;
  stopCallAudioTones();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    PM_CALL.localStream = stream;
    PM_CALL.state = 'connected';
    closeCallIncomingModal();
    showCallActiveModal();
    const status = $('#pmCallStatus');
    if (status) status.textContent = 'جاري التوصيل...';
    SOCKET.emit('call:accept', { toId: PM_CALL.peerId });
    await setupPrivateCallPeerConnection(false);
  } catch (err) {
    rejectPrivateCall('mic_error');
    toast('تعذر الوصول إلى الميكروفون: ' + (err.message || 'يرجى منح الإذن'), false);
  }
}

async function handlePrivateCallAccepted(from) {
  if (!PM_CALL || PM_CALL.peerId !== +from.id) return;
  stopCallAudioTones();
  PM_CALL.state = 'connected';
  if (PM_CALL.isCaller && ME) {
    ME.free_call_used = 1;
  }
  const status = $('#pmCallStatus');
  if (status) status.textContent = 'جاري التوصيل...';
  await setupPrivateCallPeerConnection(true);
}

async function setupPrivateCallPeerConnection(isOffer) {
  if (!PM_CALL) return;
  const pc = new RTCPeerConnection(RTC_ICE_CONFIG);
  PM_CALL.pc = pc;

  if (PM_CALL.localStream) {
    PM_CALL.localStream.getTracks().forEach(track => pc.addTrack(track, PM_CALL.localStream));
  }

  pc.ontrack = event => {
    const remoteAudio = $('#pmRemoteAudio');
    if (remoteAudio && event.streams && event.streams[0]) {
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.volume = PM_CALL && PM_CALL.speakerOn ? 1.0 : 0.65;
      remoteAudio.play().catch(() => {});
      if (PM_CALL && !CALL_RECORDER && PM_CALL.isCaller) {
        startCallRecording(PM_CALL.localStream, event.streams[0]);
      }
    }
  };

  pc.onicecandidate = event => {
    if (event.candidate && PM_CALL) {
      SOCKET.emit('call:signal', { toId: PM_CALL.peerId, data: { candidate: event.candidate } });
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (!PM_CALL) return;
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      startCallTimer();
    } else if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
      const status = $('#pmCallStatus');
      if (status && PM_CALL.state === 'connected') status.textContent = 'ضعف في الاتصال...';
    }
  };

  if (isOffer) {
    try {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
      await pc.setLocalDescription(offer);
      SOCKET.emit('call:signal', { toId: PM_CALL.peerId, data: { sdp: offer } });
    } catch (e) {
      console.error('Create offer error:', e);
    }
  }
}

async function handlePrivateCallSignal(fromId, data) {
  if (!PM_CALL || PM_CALL.peerId !== +fromId || !PM_CALL.pc) return;
  try {
    if (data.sdp) {
      await PM_CALL.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      if (data.sdp.type === 'offer') {
        const answer = await PM_CALL.pc.createAnswer();
        await PM_CALL.pc.setLocalDescription(answer);
        SOCKET.emit('call:signal', { toId: PM_CALL.peerId, data: { sdp: answer } });
      }
    } else if (data.candidate) {
      await PM_CALL.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  } catch (e) {
    console.error('Call signal error:', e);
  }
}

function rejectPrivateCall(reason = 'declined') {
  if (!PM_CALL) return;
  stopCallAudioTones();
  SOCKET.emit('call:reject', { toId: PM_CALL.peerId, reason });
  closeCallIncomingModal();
  closeCallActiveModal();
  PM_CALL = null;
}

function handlePrivateCallRejected(fromId, reason, error) {
  if (!PM_CALL || PM_CALL.peerId !== +fromId) return;
  let msg = 'تم رفض المكالمة';
  if (reason === 'busy') msg = 'المستخدم مشغول في مكالمة أخرى';
  else if (reason === 'offline') msg = 'المستخدم غير متصل حالياً';
  else if (reason === 'ignored') msg = 'لا يمكن الاتصال بسبب التجاهل';
  else if (reason === 'not_allowed') msg = error || 'عضويتك غير مسموح لها بالمكالمات الخاصة';
  toast(msg, false);
  endPrivateCall(false);
}

function handlePrivateCallCancelled(fromId) {
  if (!PM_CALL || PM_CALL.peerId !== +fromId) return;
  toast('تم إلغاء المكالمة من الطرف الآخر');
  endPrivateCall(false);
}

function handlePrivateCallEnded(fromId, reason, message) {
  if (!PM_CALL || PM_CALL.peerId !== +fromId) return;
  let msg = message || 'تم إنهاء المكالمة';
  if (!message) {
    if (reason === 'disconnected') msg = 'انقطع اتصال الطرف الآخر';
    else if (reason === 'free_minute_ended') msg = 'انتهت الدقيقة المجانية التجريبية للمكالمة ⏱️ يمكنك إجراء مكالمات مفتوحة بتكلفة 2 ذهب';
    else if (reason === 'insufficient_balance') msg = 'رصيدك غير كافٍ، تكلفة المكالمة 2 ذهب ⚠️ يرجى شحن الرصيد';
    else if (reason === 'insufficient_gold') msg = 'انتهت المكالمة لنفاذ رصيد الذهب، يجب عليك شحن الرصيد للاستمرار ⚠️';
  }
  toast(msg, !['free_minute_ended', 'insufficient_balance', 'insufficient_gold'].includes(reason));
  endPrivateCall(false);
}

function endPrivateCall(notifyRemote = true, reason = 'ended') {
  stopCallAudioTones();
  if (!PM_CALL) return;
  const peerId = PM_CALL.peerId;
  const state = PM_CALL.state;
  const recordedCallInfo = {
    callerId: PM_CALL.isCaller ? (ME && ME.id) : peerId,
    callerName: PM_CALL.isCaller ? (ME && ME.username) : PM_CALL.peerName,
    calleeId: PM_CALL.isCaller ? peerId : (ME && ME.id),
    calleeName: PM_CALL.isCaller ? PM_CALL.peerName : (ME && ME.username),
    duration: PM_CALL.callSeconds || 0
  };

  if (CALL_RECORDER) {
    try {
      const { recorder, audioCtx, mimeType } = CALL_RECORDER;
      CALL_RECORDER = null;
      recorder.onstop = async () => {
        try { audioCtx.close(); } catch (e) { }
        const blob = new Blob(CALL_RECORDED_CHUNKS, { type: mimeType });
        CALL_RECORDED_CHUNKS = [];
        if (blob.size > 200 && recordedCallInfo.duration > 0) {
          uploadCallRecording(blob, recordedCallInfo);
        }
      };
      if (recorder.state !== 'inactive') recorder.stop();
    } catch (e) {
      CALL_RECORDER = null;
    }
  }

  if (notifyRemote && SOCKET) {
    if (state === 'calling') {
      SOCKET.emit('call:cancel', { toId: peerId });
    } else {
      SOCKET.emit('call:end', { toId: peerId, reason });
    }
  }
  if (PM_CALL.localStream) {
    PM_CALL.localStream.getTracks().forEach(t => t.stop());
  }
  if (PM_CALL.pc) {
    try { PM_CALL.pc.close(); } catch (e) {}
  }
  if (PM_CALL.timerInterval) clearInterval(PM_CALL.timerInterval);
  const remoteAudio = $('#pmRemoteAudio');
  if (remoteAudio) remoteAudio.srcObject = null;
  stopProximitySensorForCall();
  closeCallIncomingModal();
  closeCallActiveModal();
  playCallEndTone();
  PM_CALL = null;
}

function togglePrivateCallMute() {
  if (!PM_CALL || !PM_CALL.localStream) return;
  PM_CALL.micMuted = !PM_CALL.micMuted;
  PM_CALL.localStream.getAudioTracks().forEach(track => {
    track.enabled = !PM_CALL.micMuted;
  });
  const muteBtn = $('#pmCallMuteBtn');
  const muteIcon = $('#pmCallMuteIcon');
  const muteLabel = $('#pmCallMuteLabel');
  if (muteBtn) muteBtn.classList.toggle('is-muted', PM_CALL.micMuted);
  if (muteIcon) muteIcon.textContent = PM_CALL.micMuted ? 'mic_slash_fill' : 'mic_fill';
  if (muteLabel) muteLabel.textContent = PM_CALL.micMuted ? 'مكتوم' : 'كتم';
  toast(PM_CALL.micMuted ? 'تم كتم الميكروفون' : 'تم تشغيل الميكروفون');
}

async function togglePrivateCallSpeaker() {
  if (!PM_CALL) return;
  PM_CALL.speakerOn = !PM_CALL.speakerOn;

  const speakerBtn = $('#pmCallSpeakerBtn');
  const speakerIcon = $('#pmCallSpeakerIcon');
  const speakerLabel = $('#pmCallSpeakerLabel');
  const remoteAudio = $('#pmRemoteAudio');

  if (PM_CALL.speakerOn) {
    // وضع مكبر الصوت (السبيكر)
    if (speakerBtn) {
      speakerBtn.classList.add('is-speaker-on');
      speakerBtn.classList.remove('is-earpiece');
    }
    if (speakerIcon) speakerIcon.textContent = 'speaker_3_fill';
    if (speakerLabel) speakerLabel.textContent = 'سبيكر (مفعل)';
    if (remoteAudio) {
      remoteAudio.volume = 1.0;
      if (typeof remoteAudio.setSinkId === 'function') {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const speaker = devices.find(d => d.kind === 'audiooutput' && (d.label.toLowerCase().includes('speaker') || d.label.includes('مكبر')));
          if (speaker) await remoteAudio.setSinkId(speaker.deviceId);
        } catch (e) {}
      }
    }
    toast('🔊 تم تشغيل مكبر الصوت (السبيكر)');
  } else {
    // وضع سماعة الأذن الداخلية (Earpiece)
    if (speakerBtn) {
      speakerBtn.classList.remove('is-speaker-on');
      speakerBtn.classList.add('is-earpiece');
    }
    if (speakerIcon) speakerIcon.textContent = 'phone_fill';
    if (speakerLabel) speakerLabel.textContent = 'سماعة الأذن';
    if (remoteAudio) {
      remoteAudio.volume = 0.65;
      if (typeof remoteAudio.setSinkId === 'function') {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const earpiece = devices.find(d => d.kind === 'audiooutput' && (d.label.toLowerCase().includes('earpiece') || d.label.toLowerCase().includes('receiver') || d.label.includes('أذن')));
          if (earpiece) await remoteAudio.setSinkId(earpiece.deviceId);
          else await remoteAudio.setSinkId('default');
        } catch (e) {}
      }
    }
    toast('📱 تم التحويل إلى سماعة الأذن الداخلية');
  }
}

// =====================================================
//  حساس التقارب وسكون الشاشة الحقيقي عند وضع الهاتف على الأذن
// =====================================================
let PROXIMITY_SENSOR = null;
let AMBIENT_LIGHT_SENSOR = null;
let PROXIMITY_SLEEP_ACTIVE = false;

function setProximityBlackout(active) {
  if (!PM_CALL || PM_CALL.state !== 'connected') {
    active = false;
  }
  // في حال كان مكبر الصوت (السبيكر) مشغلاً لا نقفل الشاشة تلقائياً
  if (active && PM_CALL && PM_CALL.speakerOn) {
    active = false;
  }
  if (PROXIMITY_SLEEP_ACTIVE === active) return;
  PROXIMITY_SLEEP_ACTIVE = active;
  const blackoutEl = $('#pmProximityBlackout');
  if (!blackoutEl) return;

  if (active) {
    blackoutEl.style.display = 'flex';
    document.body.classList.add('call-in-sleep-mode');
  } else {
    blackoutEl.style.display = 'none';
    document.body.classList.remove('call-in-sleep-mode');
  }
}

function initProximitySensorForCall() {
  stopProximitySensorForCall();
  PROXIMITY_SLEEP_ACTIVE = false;

  // 1. Proximity Sensor API للأجهزة الحديثة
  if ('ProximitySensor' in window) {
    try {
      PROXIMITY_SENSOR = new ProximitySensor();
      PROXIMITY_SENSOR.onreading = () => {
        if (PM_CALL && PM_CALL.state === 'connected') {
          setProximityBlackout(PROXIMITY_SENSOR.near || PROXIMITY_SENSOR.distance < 5);
        }
      };
      PROXIMITY_SENSOR.onerror = () => { try { PROXIMITY_SENSOR.stop(); } catch(e){} };
      PROXIMITY_SENSOR.start();
    } catch (e) {}
  }

  // 2. Ambient Light Sensor (عند وضع الهاتف على الأذن تنحجب الإضاءة للصفر)
  if ('AmbientLightSensor' in window) {
    try {
      AMBIENT_LIGHT_SENSOR = new AmbientLightSensor();
      AMBIENT_LIGHT_SENSOR.onreading = () => {
        if (PM_CALL && PM_CALL.state === 'connected') {
          if (AMBIENT_LIGHT_SENSOR.illuminance < 2.0) {
            setProximityBlackout(true);
          } else if (AMBIENT_LIGHT_SENSOR.illuminance > 5.0) {
            setProximityBlackout(false);
          }
        }
      };
      AMBIENT_LIGHT_SENSOR.onerror = () => { try { AMBIENT_LIGHT_SENSOR.stop(); } catch(e){} };
      AMBIENT_LIGHT_SENSOR.start();
    } catch (e) {}
  }

  // 3. User Proximity / Device Proximity legacy events
  window.addEventListener('userproximity', onUserProximityEvent);
  window.addEventListener('deviceproximity', onDeviceProximityEvent);
}

function onUserProximityEvent(e) {
  if (PM_CALL && PM_CALL.state === 'connected') {
    setProximityBlackout(!!e.near);
  }
}

function onDeviceProximityEvent(e) {
  if (PM_CALL && PM_CALL.state === 'connected') {
    setProximityBlackout(e.value < (e.max || 5));
  }
}

function stopProximitySensorForCall() {
  if (PROXIMITY_SENSOR) {
    try { PROXIMITY_SENSOR.stop(); } catch(e){}
    PROXIMITY_SENSOR = null;
  }
  if (AMBIENT_LIGHT_SENSOR) {
    try { AMBIENT_LIGHT_SENSOR.stop(); } catch(e){}
    AMBIENT_LIGHT_SENSOR = null;
  }
  window.removeEventListener('userproximity', onUserProximityEvent);
  window.removeEventListener('deviceproximity', onDeviceProximityEvent);
  setProximityBlackout(false);
}

function startCallTimer() {
  if (!PM_CALL) return;
  if (PM_CALL.timerInterval) clearInterval(PM_CALL.timerInterval);
  if (!PM_CALL.startTime) PM_CALL.startTime = Date.now();
  PM_CALL.callSeconds = 0;

  initProximitySensorForCall();

  const statusEl = $('#pmCallStatus');
  const timerEl = $('#pmCallTimer');
  if (statusEl) statusEl.textContent = 'مكالمة جارية';
  if (timerEl) {
    timerEl.style.display = 'block';
    timerEl.textContent = '00:00';
  }
  const pulseEl = $('#pmCallActivePulse');
  if (pulseEl) pulseEl.classList.add('active');

  const updateTick = () => {
    if (!PM_CALL) return;
    PM_CALL.callSeconds = Math.max(0, Math.floor((Date.now() - (PM_CALL.startTime || Date.now())) / 1000));
    const m = String(Math.floor(PM_CALL.callSeconds / 60)).padStart(2, '0');
    const s = String(PM_CALL.callSeconds % 60).padStart(2, '0');
    const timeStr = `${m}:${s}`;
    const t = $('#pmCallTimer');
    if (t) t.textContent = timeStr;
    const ft = $('#pmCallFloatingTimer');
    if (ft) ft.textContent = timeStr;
  };

  updateTick();
  PM_CALL.timerInterval = setInterval(updateTick, 1000);
  updateFloatingCallBar();
}

function minimizePrivateCall() {
  closeOv('pmCallActiveOv');
  updateFloatingCallBar();
}

function restorePrivateCall() {
  if (!PM_CALL) {
    updateFloatingCallBar();
    return;
  }
  showCallActiveModal();
}

function updateFloatingCallBar() {
  const bar = $('#pmCallFloatingBar');
  if (!bar) return;
  if (!PM_CALL) {
    bar.style.display = 'none';
    bar.style.left = '';
    bar.style.top = '';
    bar.style.right = '';
    return;
  }
  const activeOvOpen = $('#pmCallActiveOv').classList.contains('open');
  const incomingOvOpen = $('#pmCallIncomingOv').classList.contains('open');
  if (activeOvOpen || incomingOvOpen) {
    bar.style.display = 'none';
  } else {
    bar.style.display = 'flex';
    $('#pmCallFloatingName').textContent = PM_CALL.peerName;
    $('#pmCallFloatingAvatar').innerHTML = avatarHtml(PM_CALL.peerAvatar);
    const m = String(Math.floor(PM_CALL.callSeconds / 60)).padStart(2, '0');
    const s = String(PM_CALL.callSeconds % 60).padStart(2, '0');
    $('#pmCallFloatingTimer').textContent = PM_CALL.state === 'connected' ? `${m}:${s}` : (PM_CALL.isCaller ? 'جاري الاتصال...' : 'جاري التوصيل...');
  }
}

function showCallIncomingModal() {
  if (!PM_CALL) return;
  $('#pmCallIncName').textContent = PM_CALL.peerName;
  $('#pmCallIncAvatar').innerHTML = avatarHtml(PM_CALL.peerAvatar);
  openOv('pmCallIncomingOv');
  updateFloatingCallBar();
}

function closeCallIncomingModal() {
  closeOv('pmCallIncomingOv');
  updateFloatingCallBar();
}

function showCallActiveModal() {
  if (!PM_CALL) return;
  $('#pmCallActiveName').textContent = PM_CALL.peerName;
  $('#pmCallActiveAvatar').innerHTML = avatarHtml(PM_CALL.peerAvatar);
  $('#pmCallStatus').textContent = PM_CALL.state === 'connected' ? 'مكالمة جارية' : (PM_CALL.isCaller ? 'جاري الاتصال...' : 'جاري التوصيل...');
  const timerEl = $('#pmCallTimer');
  if (timerEl) {
    if (PM_CALL.state === 'connected') {
      const m = String(Math.floor(PM_CALL.callSeconds / 60)).padStart(2, '0');
      const s = String(PM_CALL.callSeconds % 60).padStart(2, '0');
      timerEl.textContent = `${m}:${s}`;
      timerEl.style.display = 'block';
    } else {
      timerEl.style.display = 'none';
      timerEl.textContent = '00:00';
    }
  }
  const muteBtn = $('#pmCallMuteBtn');
  const muteIcon = $('#pmCallMuteIcon');
  const muteLabel = $('#pmCallMuteLabel');
  if (muteBtn) muteBtn.classList.toggle('is-muted', !!PM_CALL.micMuted);
  if (muteIcon) muteIcon.textContent = PM_CALL.micMuted ? 'mic_slash_fill' : 'mic_fill';
  if (muteLabel) muteLabel.textContent = PM_CALL.micMuted ? 'مكتوم' : 'كتم';

  const speakerBtn = $('#pmCallSpeakerBtn');
  const speakerIcon = $('#pmCallSpeakerIcon');
  const speakerLabel = $('#pmCallSpeakerLabel');
  if (speakerBtn) {
    speakerBtn.classList.toggle('is-speaker-on', !!PM_CALL.speakerOn);
    speakerBtn.classList.toggle('is-earpiece', !PM_CALL.speakerOn);
  }
  if (speakerIcon) speakerIcon.textContent = PM_CALL.speakerOn ? 'speaker_3_fill' : 'phone_fill';
  if (speakerLabel) speakerLabel.textContent = PM_CALL.speakerOn ? 'سبيكر (مفعل)' : 'سماعة الأذن';

  openOv('pmCallActiveOv');
  updateFloatingCallBar();
}

function closeCallActiveModal() {
  closeOv('pmCallActiveOv');
  updateFloatingCallBar();
}

$('#pmCall').onclick = () => startPrivateCall();
$('#pmCallAcceptBtn').onclick = () => acceptPrivateCall();
$('#pmCallDeclineBtn').onclick = () => rejectPrivateCall('declined');
$('#pmCallEndBtn').onclick = () => endPrivateCall(true, 'ended');
$('#pmCallMuteBtn').onclick = () => togglePrivateCallMute();
$('#pmCallSpeakerBtn').onclick = () => togglePrivateCallSpeaker();
$('#pmCallMinimizeBtn').onclick = () => minimizePrivateCall();
$('#pmCallFloatingEndBtn').onclick = (e) => { e.stopPropagation(); endPrivateCall(true, 'ended'); };
$('#pmCallActiveOv').addEventListener('click', e => { if (e.target === $('#pmCallActiveOv')) minimizePrivateCall(); });
$('#pmProximityBlackout').addEventListener('click', () => setProximityBlackout(false));

// سحب وتحريك الشريط العائم للمكالمة في أي مكان على الشاشة
(function initFloatingCallBarDrag() {
  const bar = $('#pmCallFloatingBar');
  if (!bar) return;
  let isDragging = false;
  let startX = 0, startY = 0;
  let initialLeft = 0, initialTop = 0;
  let hasMoved = false;

  bar.addEventListener('pointerdown', e => {
    if (e.target.closest('#pmCallFloatingEndBtn')) return;
    const frame = $('#frame') || document.body;
    const frameRect = frame.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();

    isDragging = true;
    hasMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    initialLeft = barRect.left - frameRect.left;
    initialTop = barRect.top - frameRect.top;

    bar.classList.add('is-dragging');
    try { bar.setPointerCapture(e.pointerId); } catch (_) {}
  });

  bar.addEventListener('pointermove', e => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasMoved = true;
    }
    const frame = $('#frame') || document.body;
    const frameRect = frame.getBoundingClientRect();
    const barW = bar.offsetWidth;
    const barH = bar.offsetHeight;

    let newLeft = initialLeft + dx;
    let newTop = initialTop + dy;

    // حدود الحركة داخل إطار التطبيق
    const minLeft = 6;
    const maxLeft = Math.max(minLeft, frameRect.width - barW - 6);
    const minTop = 6;
    const maxTop = Math.max(minTop, frameRect.height - barH - 10);

    newLeft = Math.max(minLeft, Math.min(newLeft, maxLeft));
    newTop = Math.max(minTop, Math.min(newTop, maxTop));

    bar.style.left = `${newLeft}px`;
    bar.style.top = `${newTop}px`;
    bar.style.right = 'auto';
  });

  const stopDrag = e => {
    if (!isDragging) return;
    isDragging = false;
    bar.classList.remove('is-dragging');
    try { if (e && e.pointerId) bar.releasePointerCapture(e.pointerId); } catch (_) {}
  };

  bar.addEventListener('pointerup', e => {
    const wasMoved = hasMoved;
    stopDrag(e);
    if (!wasMoved && !e.target.closest('#pmCallFloatingEndBtn')) {
      restorePrivateCall();
    }
  });
  bar.addEventListener('pointercancel', stopDrag);

  const openArea = $('#pmCallFloatingOpen');
  if (openArea) {
    openArea.onclick = e => {
      if (!hasMoved) restorePrivateCall();
    };
  }
})();
function scrollPm() { const b = $('#pmBody'); b.scrollTop = b.scrollHeight; }
$('#pmSend').onclick = sendPm;
$('#pmInput').onkeydown = e => { if (e.key === 'Enter') sendPm(); };
function sendPm() {
  const t = $('#pmInput').value.trim();
  if (!t || !PM_WITH) return;
  if (!canUseMembershipFeature('private_message_allowed_memberships'))
    return toast('عضويتك غير مسموح لها بإرسال الرسائل الخاصة', false);
  SOCKET.emit('private', { toId: PM_WITH.id, text: t });
  $('#pmInput').value = '';
}
function updatePrivBadge() {
  const b = $('#privBadge');
  if (PRIV_UNREAD > 0) { b.style.display = 'flex'; b.textContent = PRIV_UNREAD; }
  else b.style.display = 'none';
}

// =====================================================
//  الحالات — صورة / فيديو / صوت / كتابة لمدة 24 ساعة
// =====================================================
function statusTime(ts) {
  const d = new Date((+ts || 0) * 1000);
  const now = new Date();
  const dayStart = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((dayStart(now) - dayStart(d)) / 86400000);
  const clock = d.toLocaleTimeString('ar-JO', { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return 'اليوم الساعة ' + clock;
  if (days === 1) return 'أمس الساعة ' + clock;
  return d.toLocaleDateString('ar-JO', { day: 'numeric', month: 'short' }) + '، ' + clock;
}
function statusGroups() {
  const groups = new Map();
  STATUSES.forEach(s => {
    if (!groups.has(s.user_id)) groups.set(s.user_id, []);
    groups.get(s.user_id).push(s);
  });
  groups.forEach(items => items.sort((a, b) => a.created_at - b.created_at));
  return groups;
}
async function openStatuses() {
  if (!ME) return openLogin();
  STATUS_UNREAD = 0;
  updateStatusUnreadBadge();
  openOv('statusOv');
  $('#statusMyAvatar').innerHTML = avatarHtml(ME.avatar);
  await loadStatuses();
}
async function loadStatuses() {
  if (!ME) return;
  try {
    STATUSES = await api('/api/statuses');
    renderStatuses();
  } catch (e) {
    $('#statusList').innerHTML = '<div class="status-empty"><i class="f7-icons">exclamationmark_circle</i>تعذر تحميل الحالات</div>';
  }
}
function renderStatuses() {
  if (!ME) return;
  const groups = statusGroups();
  const mine = groups.get(ME.id) || [];
  $('#statusMyAvatar').innerHTML = avatarHtml(ME.avatar);
  $('#statusMyAvatar').classList.toggle('has-status', mine.length > 0);
  $('#myStatusTime').textContent = mine.length
    ? `آخر تحديث ${statusTime(mine[mine.length - 1].created_at)}`
    : 'اضغط لإضافة تحديث الحالة';

  const recent = [...groups.entries()]
    .filter(([uid]) => +uid !== ME.id)
    .sort((a, b) => b[1][b[1].length - 1].created_at - a[1][a[1].length - 1].created_at);
  $('#statusList').innerHTML = recent.length ? recent.map(([uid, items]) => {
    const latest = items[items.length - 1];
    const unseen = items.some(s => !s.viewed);
    return `<div class="status-row ${unseen ? 'unseen' : 'seen'}" data-user="${uid}" role="button" tabindex="0">
      <div class="status-avatar-wrap"><span class="status-avatar">${avatarHtml(latest.avatar)}</span></div>
      <div class="status-row-info">
        <b>${esc(latest.username)}${latest.verified ? ' <i class="f7-icons" style="font-size:13px;color:#1685f5">checkmark_seal_fill</i>' : ''}</b>
        <span>${statusTime(latest.created_at)}</span>
      </div>
      <i class="f7-icons status-row-chevron">chevron_left</i>
    </div>`;
  }).join('') : '<div class="status-empty"><i class="f7-icons">circle_dashed</i>لا توجد حالات حديثة بعد</div>';
  $$('#statusList .status-row').forEach(row => {
    row.onclick = () => openStatusGroup(+row.dataset.user);
    row.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStatusGroup(+row.dataset.user); } };
  });
}
const STATUS_BACKGROUNDS = ['#1f6f5f', '#2563eb', '#7c3aed', '#be185d', '#dc2626', '#ea580c', '#111827', '#374151'];
let STATUS_UPLOAD_TYPE = 'image', STATUS_TEXT_BG = STATUS_BACKGROUNDS[0];
function openStatusTypeChooser() {
  if (!ME) return openLogin();
  if (!canUseMembershipFeature('status_allowed_memberships'))
    return toast('عضويتك غير مسموح لها بنشر الحالات', false);
  openOv('statusTypeOv');
}
function chooseStatusFile(type) {
  STATUS_UPLOAD_TYPE = type;
  const file = $('#statusFile');
  file.value = '';
  file.accept = type === 'image' ? 'image/*' : type === 'video' ? 'video/*' : 'audio/*';
  closeOv('statusTypeOv');
  file.click();
}
function renderStatusBackgrounds() {
  $('#statusBgColors').innerHTML = STATUS_BACKGROUNDS.map(c => `<button class="status-bg-color${c === STATUS_TEXT_BG ? ' active' : ''}" data-color="${c}" style="background:${c}" type="button"></button>`).join('');
  $$('#statusBgColors .status-bg-color').forEach(b => b.onclick = () => {
    STATUS_TEXT_BG = b.dataset.color;
    $('#statusTextCanvas').style.background = STATUS_TEXT_BG;
    renderStatusBackgrounds();
  });
}
function openTextStatusComposer() {
  closeOv('statusTypeOv');
  STATUS_TEXT_BG = STATUS_BACKGROUNDS[0];
  $('#statusTextInput').value = '';
  $('#statusTextCanvas').style.background = STATUS_TEXT_BG;
  renderStatusBackgrounds();
  openOv('statusTextOv');
  setTimeout(() => $('#statusTextInput').focus(), 80);
}
async function publishStatusForm(fd) {
  try {
    toast('جاري نشر الحالة...');
    const added = await uploadFormWithProgress('/api/statuses', fd, 'جاري رفع الحالة...');
    closeOv('statusTextOv');
    await loadStatuses();
    toast('تم نشر حالتك لمدة 24 ساعة ✓');
    openStatusGroup(ME.id, added.id);
  } catch (e) { toast(e.error || 'تعذر نشر الحالة', false); }
}
async function uploadStatus(file) {
  if (!file) return;
  const actualType = String(file.type || '').split('/')[0];
  if (actualType !== STATUS_UPLOAD_TYPE) return toast('نوع الملف لا يطابق نوع الحالة المختار', false);
  if (file.size > 50 * 1024 * 1024) return toast('حجم الملف أكبر من 50MB', false);
  const fd = new FormData();
  fd.append('media_type', STATUS_UPLOAD_TYPE);
  fd.append('status', file);
  await publishStatusForm(fd);
}
async function publishTextStatus() {
  const text = $('#statusTextInput').value.trim();
  if (!text) return toast('اكتب نص الحالة أولاً', false);
  const fd = new FormData();
  fd.append('media_type', 'text');
  fd.append('text_content', text);
  fd.append('background', STATUS_TEXT_BG);
  await publishStatusForm(fd);
}
async function openStatusGroup(userId, statusId) {
  const groups = statusGroups();
  STATUS_GROUP = groups.get(+userId) || [];
  if (!STATUS_GROUP.length) return toast('انتهت هذه الحالة', false);
  if (statusId) STATUS_INDEX = Math.max(0, STATUS_GROUP.findIndex(s => s.id === +statusId));
  else if (+userId === ME.id) STATUS_INDEX = STATUS_GROUP.length - 1;
  else {
    const unseen = STATUS_GROUP.findIndex(s => !s.viewed);
    STATUS_INDEX = unseen >= 0 ? unseen : STATUS_GROUP.length - 1;
  }
  openOv('statusViewerOv');
  await showCurrentStatus();
}
function stopStatusMedia() {
  const video = $('#statusViewerVideo'), audio = $('#statusViewerAudio');
  try { video.pause(); } catch (e) { }
  try { audio.pause(); } catch (e) { }
}
function renderStatusMedia(s) {
  stopStatusMedia();
  const image = $('#statusViewerImage');
  const video = $('#statusViewerVideo');
  const audioWrap = $('#statusAudioPlayer');
  const audio = $('#statusViewerAudio');
  const text = $('#statusViewerText');
  [image, video, audioWrap, text].forEach(el => { el.hidden = true; });
  const type = s.media_type || 'image';
  const media = s.media || s.image || '';
  if (type === 'video') {
    video.src = media; video.hidden = false;
  } else if (type === 'audio') {
    audio.src = media; audioWrap.hidden = false;
  } else if (type === 'text') {
    text.textContent = s.text_content || '';
    text.style.background = s.background || '#1f6f5f';
    text.hidden = false;
  } else {
    image.src = media; image.hidden = false;
  }
}
async function showCurrentStatus() {
  const s = STATUS_GROUP[STATUS_INDEX];
  if (!s) return closeOv('statusViewerOv');
  CURRENT_STATUS = s;
  renderStatusMedia(s);
  $('#statusViewerAvatar').innerHTML = avatarHtml(s.avatar);
  $('#statusViewerName').textContent = s.is_owner ? 'حالتي' : s.username;
  $('#statusViewerTime').textContent = statusTime(s.created_at);
  $('#statusCaption').textContent = s.caption || '';
  $('#statusProgress').innerHTML = STATUS_GROUP.map((x, i) => `<span class="${i < STATUS_INDEX ? 'done' : i === STATUS_INDEX ? 'current' : ''}"></span>`).join('');
  $('#statusPrev').disabled = STATUS_INDEX <= 0;
  $('#statusNext').disabled = STATUS_INDEX >= STATUS_GROUP.length - 1;
  $('#statusOwnerTools').hidden = !s.is_owner;
  if (s.is_owner) $('#statusViewCount').textContent = +s.view_count || 0;

  try {
    const viewed = await api(`/api/statuses/${s.id}/view`, 'POST');
    const cached = STATUSES.find(x => x.id === s.id);
    if (cached) {
      cached.viewed = 1;
      if (s.is_owner) cached.view_count = +viewed.view_count || 0;
    }
    if (CURRENT_STATUS && CURRENT_STATUS.id === s.id && s.is_owner)
      $('#statusViewCount').textContent = +viewed.view_count || 0;
    renderStatuses();
  } catch (e) {
    if (CURRENT_STATUS && CURRENT_STATUS.id === s.id) {
      closeOv('statusViewerOv');
      toast(e.error || 'تعذر فتح الحالة', false);
      loadStatuses();
    }
  }
}
async function showStatusViewers() {
  const s = CURRENT_STATUS;
  if (!s || !s.is_owner) return;
  try {
    const viewers = await api(`/api/statuses/${s.id}/viewers`);
    $('#statusViewersCount').textContent = viewers.length;
    $('#statusViewCount').textContent = viewers.length;
    s.view_count = viewers.length;
    $('#statusViewersList').innerHTML = viewers.length ? viewers.map(v => `
      <div class="status-viewer-row">
        <span class="sv-avatar">${avatarHtml(v.avatar)}</span>
        <span class="sv-info"><b>${esc(v.username)}</b><span>${statusTime(v.viewed_at)}</span></span>
      </div>`).join('') : '<div class="status-no-viewers"><i class="f7-icons">eye_slash_fill</i>لم يشاهد أحد حالتك حتى الآن</div>';
    openOv('statusViewersOv');
  } catch (e) { toast(e.error || 'لا يمكن عرض المشاهدين', false); }
}

$('#btnAddStatus').onclick = openStatuses;
$('#statusHeadAdd').onclick = openStatusTypeChooser;
$('#statusFab').onclick = openStatusTypeChooser;
$('#statusAddBadge').onclick = e => { e.stopPropagation(); openStatusTypeChooser(); };
$('#myStatusRow').onclick = () => {
  const mine = STATUSES.filter(s => s.user_id === ME.id);
  if (mine.length) openStatusGroup(ME.id);
  else openStatusTypeChooser();
};
$('#myStatusRow').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#myStatusRow').click(); } };
$$('.status-type-btn').forEach(b => b.onclick = () => b.dataset.statusType === 'text' ? openTextStatusComposer() : chooseStatusFile(b.dataset.statusType));
$('#statusTextPublish').onclick = publishTextStatus;
$('#statusFile').onchange = () => uploadStatus($('#statusFile').files[0]);
$('#statusPrev').onclick = () => { if (STATUS_INDEX > 0) { STATUS_INDEX--; showCurrentStatus(); } };
$('#statusNext').onclick = () => { if (STATUS_INDEX < STATUS_GROUP.length - 1) { STATUS_INDEX++; showCurrentStatus(); } };
$('#statusShowViewers').onclick = showStatusViewers;
$$('[data-close="statusViewerOv"]').forEach(b => b.addEventListener('click', stopStatusMedia));
$('#statusDelete').onclick = async () => {
  const s = CURRENT_STATUS;
  if (!s || !s.is_owner || !confirm('هل تريد حذف هذه الحالة؟')) return;
  try {
    await api('/api/statuses/' + s.id, 'DELETE');
    stopStatusMedia();
    closeOv('statusViewersOv');
    closeOv('statusViewerOv');
    await loadStatuses();
    toast('تم حذف الحالة');
  } catch (e) { toast(e.error || 'تعذر حذف الحالة', false); }
};

// =====================================================
//  هدايا حسابي وقائمة التجاهل
// =====================================================
async function openMyGifts() {
  if (!ME) return openLogin();
  if (!ME.registered) return openOv('needRegOv');
  $('#myGiftsList').innerHTML = '<div class="my-gifts-empty"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل الهدايا...</div>';
  openOv('myGiftsOv');
  try {
    const data = await api('/api/user/' + ME.id);
    const gifts = data.gifts || [];
    $('#myGiftsCount').textContent = gifts.reduce((sum, gift) => sum + (+gift.qty || 1), 0);
    $('#myGiftsList').innerHTML = gifts.length ? gifts.map((gift, index) => {
      const media = gift.gift_img || '🎁';
      const visual = String(media).startsWith('/') ? `<img src="${esc(media)}" alt="">` : esc(media);
      return `<div class="my-gift-card" data-gift-index="${index}" style="cursor:pointer">
        <div class="my-gift-media">${visual}</div>
        <h4>${esc(gift.gift_name || 'هدية')}</h4>
        <p>من: <b>${esc(gift.from_name || '-')}</b></p>
        <p>${new Date(gift.created_at * 1000).toLocaleDateString(APP_LANG === 'en' ? 'en-US' : 'ar-JO')}</p>
        <p class="gift-qty">الكمية: ${gift.qty || 1}</p>
      </div>`;
    }).join('') : '<div class="my-gifts-empty"><i class="f7-icons">gift_fill</i>لم تستلم أي هدايا بعد</div>';

    $$('#myGiftsList .my-gift-card').forEach(card => {
      card.onclick = () => {
        const g = gifts[+card.dataset.giftIndex];
        if (g) openGiftDetails(g, ME ? ME.username : '');
      };
    });
  } catch (e) {
    $('#myGiftsList').innerHTML = '<div class="my-gifts-empty"><i class="f7-icons">exclamationmark_circle</i>تعذر تحميل الهدايا</div>';
  }
}

async function openBlocksList() {
  if (!ME) return openLogin();
  $('#blocksList').innerHTML = '<div class="blocks-empty"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل قائمة التجاهل...</div>';
  openOv('blocksOv');
  const list = await loadIgnoredUsers();
  $('#blocksList').innerHTML = list.length ? list.map(user => `
    <div class="blocked-user-row" data-id="${user.id}">
      <span class="blocked-user-avatar">${avatarHtml(user.avatar)}</span>
      <span class="blocked-user-info"><b>${esc(user.username)}</b><span>متجاهل • الرسائل الخاصة متوقفة</span></span>
      <button class="blocked-user-remove" data-id="${user.id}" type="button">إلغاء التجاهل</button>
    </div>`).join('') : '<div class="blocks-empty"><i class="f7-icons">slash_circle_fill</i>قائمة التجاهل فارغة</div>';
  $$('#blocksList .blocked-user-remove').forEach(button => button.onclick = async () => {
    try {
      await api('/api/ignore/' + button.dataset.id, 'POST', { ignored: false });
      IGNORED_USERS.delete(+button.dataset.id);
      renderUsers();
      toast('تم إلغاء التجاهل');
      openBlocksList();
    } catch (e) { toast(e.error || 'تعذر إلغاء التجاهل', false); }
  });
}

// =====================================================
//  القائمة / الحالة / الصورة
// =====================================================
async function openAdminPanelSecurely() {
  if (!ME || !isAdmRank()) return toast('ليس لديك صلاحية دخول لوحة الإدارة', false);
  try {
    toast('جاري تأمين وفتح لوحة الإدارة بالرمز السري...');
    const res = await api('/api/chat/admin-access-token', 'POST');
    if (res && res.admin_url) {
      window.open(res.admin_url, '_blank');
    } else {
      toast('تعذر توليد رابط الإدارة', false);
    }
  } catch (e) {
    toast(e.error || 'تعذر فتح لوحة الإدارة', false);
  }
}

function openMenu() {
  if (!ME) return openLogin();
  $('#menuName').textContent = ME.username;
  $('#menuStatus').textContent = statusName(ME.status);
  $('#menuBal').textContent = ME.balance;
  $('#menuAva').innerHTML = avatarHtml(ME.avatar) + `<span class="dot ${statusDot(ME.status)}"></span>`;
  const isAdm = isAdmRank();
  const adminSec = $('#menuAdminSection');
  if (adminSec) adminSec.style.display = isAdm ? 'block' : 'none';
  openOv('menuOv');
}
// قائمة الحالة السريعة
function openQuick() {
  if (!ME) return;
  openOv('quickOv');
}
$$('.us-opt.st[data-status]').forEach(b => b.onclick = async () => {
  await api('/api/status', 'POST', { status: b.dataset.status });
  ME.status = b.dataset.status;
  SOCKET.emit('status', ME.status);
  closeOv('quickOv');
  toast('تم تغيير الحالة إلى ' + statusName(ME.status));
});
$('#quickAccount').onclick = () => { closeOv('quickOv'); openProfile(ME.id); };
$('#quickAvatar').onclick = () => { closeOv('quickOv'); if (!ME.registered) return openOv('needRegOv'); openAvatars(); };
// بطاقة العضو في القائمة الرئيسية تعرض قائمة الحالة السريعة
$('#menuUserCard').onclick = () => { closeOv('menuOv'); openQuick(); };
$('#mnAccount').onclick = () => { closeOv('menuOv'); openProfile(ME.id); };
$('#mnAdminPanel').onclick = () => { closeOv('menuOv'); openAdminPanelSecurely(); };
$('#pfAdminBtn').onclick = () => { closeOv('profOv'); openAdminPanelSecurely(); };
$('#mnBuy').onclick = () => {
  closeOv('menuOv');
  if (!ME.registered) return openOv('needRegOv');
  openBuy();
};
$('#mnVerify').onclick = () => {
  closeOv('menuOv');
  if (!ME.registered) return openOv('needRegOv');
  openVerify();
};
$('#mnUpgrade').onclick = () => { closeOv('menuOv'); if (!ME.registered) return openOv('needRegOv'); openUpgrade(ME); };
$('#mnAvatar').onclick = () => { closeOv('menuOv'); if (!ME.registered) return openOv('needRegOv'); openAvatars(); };
$('#mnMyGifts').onclick = () => { closeOv('menuOv'); openMyGifts(); };
$('#mnBlocks').onclick = () => { closeOv('menuOv'); openBlocksList(); };
$('#mnSettings').onclick = () => { closeOv('menuOv'); applyPrefsToSwitches(); openOv('setOv'); };
async function logoutWithoutReload() {
  if (!ME) return;
  try {
    if (CUR_ROOM && SOCKET) SOCKET.emit('leave', CUR_ROOM.id);
    await api('/api/logout', 'POST');
  } catch (e) { }
  if (SOCKET) { try { SOCKET.disconnect(); } catch (e) { } }
  CONNECTION_INTERRUPTED = false;
  hideConnectionOverlay();
  SOCKET = null; CHAT_TOKEN = ''; ME = null; MYBADGE = 'guest.png';
  CUR_ROOM = null; CUR_TARGET = null; PM_WITH = null; ROOM_USERS = [];
  IGNORED_USERS = new Set(); STATUSES = []; NOTIFS = []; CURRENT_NOTIFICATIONS = []; READ_NOTIFS = new Set();
  PRIV_UNREAD = 0; NOTIF_UNREAD = 0; STATUS_UNREAD = 0;
  updatePrivBadge(); updateNotifBadge(); updateStatusUnreadBadge();
  try { stopStatusMedia(); } catch (e) { }
  try { closeVoiceRecorder(); } catch (e) { }
  $$('.overlay.open').forEach(overlay => overlay.classList.remove('open'));
  closeEnterDrop();
  $('#headEnterBtn').style.display = '';
  $('#headUserBox').style.display = 'none';
  $('#headAva').innerHTML = '';
  $('#headName').textContent = '';
  $('#msgArea').innerHTML = '';
  $('#usersList').innerHTML = '';
  $('#onlineCount').textContent = '0';
  const menu = $('#bnMenu');
  menu.innerHTML = '<i class="f7-icons" id="bnMenuIcon">square_grid2x2_fill</i><span>القائمة</span>';
  $('#lPass').value = ''; $('#rPass').value = '';
  showScreen('rooms');
  renderRooms();
  refreshNav();
  toast('تم تسجيل الخروج');
}
$('#mnLogout').onclick = logoutWithoutReload;

// =====================================================
//  توثيق حسابي
// =====================================================
function openVerify() {
  $('#vfName').textContent = ME.username;
  openOv('verifyOv');
}
$('#vfRequest').onclick = async () => {
  try {
    await api('/api/verify-request', 'POST');
    closeOv('verifyOv');
    toast('تم إرسال طلب التوثيق إلى لوحة الإدارة ✓ ولن يتم الخصم إلا بعد الموافقة');
  } catch (e) { toast(e.error || 'تعذر إرسال الطلب', false); }
};

// =====================================================
//  شراء رصيد (باقات الذهب والدفع بالبطاقة البنكية)
// =====================================================
let STORE_PACKAGES = [];
let SELECTED_PACKAGE = null;
let STORE_PAYMENT_INFO = {};

async function openBuy() {
  if (!ME) return openLogin();
  openOv('buyOv');
  $('#goldGrid').innerHTML = '<div class="loading" style="padding:30px;grid-column:1/-1;text-align:center"><i class="f7-icons">arrow2_circlepath</i> جاري تحميل باقات الذهب...</div>';

  try {
    const res = await api('/api/gold-packages');
    if (res && res.packages && res.packages.length) {
      STORE_PACKAGES = res.packages;
      STORE_PAYMENT_INFO = res;
    } else {
      STORE_PACKAGES = [
        { id: 1, name: 'باقة التجربة', gold: 10, price: 1.99, currency: '$', bonus: 0, badge: '' },
        { id: 2, name: 'الباقة البرونزية', gold: 50, price: 4.99, currency: '$', bonus: 5, badge: '' },
        { id: 3, name: 'الباقة الفضية', gold: 100, price: 9.99, currency: '$', bonus: 15, badge: '🔥 الأكثر طلباً' },
        { id: 4, name: 'الباقة الذهبية', gold: 250, price: 24.99, currency: '$', bonus: 50, badge: '⭐ باقة التوفير' },
        { id: 5, name: 'الباقة الماسية', gold: 500, price: 49.99, currency: '$', bonus: 150, badge: '💎 باقة مميزة' },
        { id: 6, name: 'باقة VIP الملكية', gold: 1000, price: 89.99, currency: '$', bonus: 400, badge: '👑 باقة كبار الشخصيات' }
      ];
      STORE_PAYMENT_INFO = { currency: '$', merchant_bank: 'البنك التجاري المعتمد' };
    }
  } catch (e) {
    STORE_PACKAGES = [
      { id: 1, name: '10 Gold', gold: 10, price: 1.99, currency: '$', bonus: 0 },
      { id: 2, name: '50 Gold', gold: 50, price: 4.99, currency: '$', bonus: 5 },
      { id: 3, name: '100 Gold', gold: 100, price: 9.99, currency: '$', bonus: 15 }
    ];
  }

  // تحديد باقة مميزة أو أول باقة تلقائياً
  const defaultPkg = STORE_PACKAGES.find(p => p.badge && p.badge.includes('الأكثر طلباً')) || STORE_PACKAGES[0];
  SELECTED_PACKAGE = defaultPkg;
  renderGoldPackages();
}

function renderGoldPackages() {
  if (!STORE_PACKAGES || !STORE_PACKAGES.length) {
    $('#goldGrid').innerHTML = `<div class="pv-empty">${translateDynamicText('لا توجد باقات متاحة حالياً')}</div>`;
    return;
  }

  const goldLabel = APP_LANG === 'en' ? 'Gold' : (APP_LANG === 'es' ? 'Oro' : (APP_LANG === 'tr' ? 'Altın' : 'ذهب'));
  const priceLabel = APP_LANG === 'en' ? 'Price' : (APP_LANG === 'es' ? 'Precio' : (APP_LANG === 'tr' ? 'Fiyat' : 'السعر'));
  const bonusLabel = APP_LANG === 'en' ? 'Bonus Gold' : (APP_LANG === 'es' ? 'Oro de regalo' : (APP_LANG === 'tr' ? 'Hediye Altın' : 'ذهب هدية'));

  $('#goldGrid').innerHTML = STORE_PACKAGES.map(pkg => {
    const isSel = SELECTED_PACKAGE && SELECTED_PACKAGE.id === pkg.id;
    const totalG = (+pkg.gold || 0) + (+pkg.bonus || 0);
    const curr = pkg.currency || STORE_PAYMENT_INFO.currency || '$';
    const pkgName = translateDynamicText(pkg.name || `${pkg.gold} Gold`);
    const badgeText = pkg.badge ? translateDynamicText(pkg.badge) : '';
    return `
      <div class="gold-card ${isSel ? 'sel' : ''}" data-pkgid="${pkg.id}">
        ${badgeText ? `<span class="gold-card-badge">${esc(badgeText)}</span>` : ''}
        <div class="gn">${esc(pkgName)}</div>
        <img src="/img/gold.png" alt="">
        <div style="font-weight:900;font-size:13px;color:#f59e0b">${totalG} ${goldLabel} 🪙</div>
        ${pkg.bonus ? `<div class="gold-card-bonus">+${pkg.bonus} ${bonusLabel} 🎁</div>` : ''}
        <div class="gp">${pkg.price} ${esc(curr)} <span class="gl">${priceLabel}</span></div>
      </div>
    `;
  }).join('');

  $$('#goldGrid .gold-card').forEach(c => {
    c.onclick = () => {
      const pkg = STORE_PACKAGES.find(x => x.id === +c.dataset.pkgid);
      if (pkg) {
        SELECTED_PACKAGE = pkg;
        renderGoldPackages();
      }
    };
  });

  if (SELECTED_PACKAGE) {
    const totalG = (+SELECTED_PACKAGE.gold || 0) + (+SELECTED_PACKAGE.bonus || 0);
    const curr = SELECTED_PACKAGE.currency || STORE_PAYMENT_INFO.currency || '$';
    const pkgName = translateDynamicText(SELECTED_PACKAGE.name);
    const continueLabel = APP_LANG === 'en' ? 'Continue purchase' : (APP_LANG === 'es' ? 'Continuar compra' : (APP_LANG === 'tr' ? 'Satın almaya devam et' : 'متابعة شراء'));
    $('#buyStrip').innerHTML = `${continueLabel} <b>${esc(pkgName)} (${totalG} ${goldLabel})</b> <span>${SELECTED_PACKAGE.price} ${esc(curr)}</span>`;
  }
}

// فتح نافذة الدفع ببطاقة الصراف والبطاقة البنكية
function openCardPaymentModal() {
  if (!ME || !ME.registered) {
    return toast(translateDynamicText('يجب تسجيل الدخول بحساب مسجل لإتمام عملية الشراء'), false);
  }
  if (!SELECTED_PACKAGE) {
    return toast(translateDynamicText('اختر باقة الذهب أولاً'), false);
  }

  const curr = SELECTED_PACKAGE.currency || STORE_PAYMENT_INFO.currency || '$';
  const totalG = (+SELECTED_PACKAGE.gold || 0) + (+SELECTED_PACKAGE.bonus || 0);
  const goldLabel = APP_LANG === 'en' ? 'Gold' : (APP_LANG === 'es' ? 'Oro' : (APP_LANG === 'tr' ? 'Altın' : 'ذهب'));
  const bonusLabel = APP_LANG === 'en' ? 'bonus' : (APP_LANG === 'es' ? 'de regalo' : (APP_LANG === 'tr' ? 'hediye' : 'هدية'));

  // تحديث بيانات الباقة في نافذة الدفع
  $('#cardPayPkgName').textContent = translateDynamicText(SELECTED_PACKAGE.name);
  $('#cardPayPkgGold').textContent = `${totalG} ${goldLabel} 🪙` + (SELECTED_PACKAGE.bonus ? ` (+${SELECTED_PACKAGE.bonus} ${bonusLabel})` : '');
  $('#cardPayPkgPrice').textContent = `${SELECTED_PACKAGE.price} ${curr}`;
  $('#cardPayBtnPrice').textContent = `${SELECTED_PACKAGE.price} ${curr}`;
  $('#cardPayBankName').textContent = STORE_PAYMENT_INFO.merchant_bank || 'البنك المعتمد';

  // إعادة ضبط حقول البطاقة
  $('#cardInputHolder').value = (ME.username || 'CARDHOLDER').toUpperCase();
  $('#cardInputNumber').value = '';
  $('#cardInputExp').value = '';
  $('#cardInputCvv').value = '';

  // تحديث شكل البطاقة المصرفية التفاعلية
  $('#vcCardHolder').textContent = (ME.username || 'CARDHOLDER').toUpperCase();
  $('#vcCardNumber').textContent = '•••• •••• •••• ••••';
  $('#vcCardExp').textContent = 'MM/YY';
  $('#vcCardBrand').textContent = 'CARD';
  $('#cardBrandIcon').innerHTML = '<i class="f7-icons">creditcard_fill</i>';

  openOv('cardPaymentOv');
}

// معالجة وتنسيق حقول البطاقة البنكية مباشرة أثناء الكتابة
function initCardInputFormatting() {
  const numInput = $('#cardInputNumber');
  const holderInput = $('#cardInputHolder');
  const expInput = $('#cardInputExp');
  const cvvInput = $('#cardInputCvv');

  if (numInput) {
    numInput.oninput = () => {
      let v = numInput.value.replace(/\D/g, '').slice(0, 16);
      let parts = [];
      for (let i = 0; i < v.length; i += 4) parts.push(v.slice(i, i + 4));
      numInput.value = parts.join(' ');

      // كشف نوع البطاقة
      let brand = 'CARD';
      let icon = 'creditcard_fill';
      if (/^4/.test(v)) { brand = 'VISA'; icon = 'creditcard_fill'; }
      else if (/^(5[1-5]|2[2-7])/.test(v)) { brand = 'Mastercard'; icon = 'creditcard_fill'; }
      else if (/^(5888|5889|5890|9682|4847|5043|4008)/.test(v)) { brand = 'Mada مدى'; icon = 'creditcard_fill'; }
      else if (/^(5078|3585)/.test(v)) { brand = 'Meeza ميزة'; icon = 'creditcard_fill'; }
      else if (/^(34|37)/.test(v)) { brand = 'AMEX'; icon = 'creditcard_fill'; }

      $('#vcCardBrand').textContent = brand;
      $('#cardBrandIcon').innerHTML = `<i class="f7-icons">${icon}</i>`;

      if (parts.length) {
        let display = parts.join(' ');
        while (display.length < 19) {
          if (display.endsWith(' ') || (display.length + 1) % 5 === 0) display += ' ';
          display += '•';
        }
        $('#vcCardNumber').textContent = display.slice(0, 19);
      } else {
        $('#vcCardNumber').textContent = '•••• •••• •••• ••••';
      }
    };
  }

  if (holderInput) {
    holderInput.oninput = () => {
      const v = holderInput.value.trim().toUpperCase();
      $('#vcCardHolder').textContent = v || 'CARDHOLDER NAME';
    };
  }

  if (expInput) {
    expInput.oninput = () => {
      let v = expInput.value.replace(/\D/g, '').slice(0, 4);
      if (v.length >= 2) v = v.slice(0, 2) + '/' + v.slice(2, 4);
      expInput.value = v;
      $('#vcCardExp').textContent = v || 'MM/YY';
    };
  }
}

// تنفيذ الدفع بالبطاقة وشحن الذهب
async function executeCardPayment() {
  if (!ME || !ME.registered) return toast('يجب تسجيل الدخول أولاً', false);
  if (!SELECTED_PACKAGE) return toast('اختر باقة الذهب أولاً', false);

  const cardNum = $('#cardInputNumber').value.replace(/\D/g, '');
  const holder = $('#cardInputHolder').value.trim();
  const exp = $('#cardInputExp').value.trim();
  const cvv = $('#cardInputCvv').value.trim();

  if (cardNum.length < 13 || cardNum.length > 19) {
    return toast('يرجى إدخال رقم بطاقة صراف صحيح (16 رقم)', false);
  }
  if (!holder || holder.length < 3) {
    return toast('يرجى كتابة اسم صاحب البطاقة', false);
  }
  if (!/^\d{2}\/\d{2}$/.test(exp)) {
    return toast('يرجى كتابة تاريخ الانتهاء بصيغة MM/YY', false);
  }
  if (cvv.length < 3 || cvv.length > 4) {
    return toast('يرجى كتابة رمز الأمان CVV المكون من 3 أرقام', false);
  }

  const btn = $('#cardPaySubmitBtn');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="f7-icons">arrow2_circlepath</i> جاري الخصم وإيداع الذهب فورياً...';

  try {
    const res = await api('/api/pay-with-card', 'POST', {
      package_id: SELECTED_PACKAGE.id,
      card_number: cardNum,
      card_holder: holder,
      exp_date: exp,
      cvv: cvv
    });

    btn.disabled = false;
    btn.innerHTML = originalText;

    if (res && res.ok) {
      if (ME) ME.balance = res.balance;
      const mb = $('#menuBal');
      if (mb) mb.textContent = res.balance;

      closeOv('cardPaymentOv');
      closeOv('buyOv');

      toast(`🎉 تمت عملية الدفع بنجاح! تم شحن ${res.total_gold} ذهب إلى رصيدك فوراً 🪙`);
      beep(880, .2);
    }
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = originalText;
    toast(err.error || 'تعذر إتمام الدفع، يرجى التحقق من بيانات البطاقة', false);
  }
}

async function buyGold() {
  if (!ME || !ME.registered) {
    return toast('يجب تسجيل الدخول بحساب مسجل لطلب شراء الذهب', false);
  }
  if (!SELECTED_PACKAGE) return toast('اختر باقة الذهب أولاً', false);
  try {
    const d = await api('/api/buy-gold-request', 'POST', { gold: SELECTED_PACKAGE.gold });
    closeOv('buyOv');
    toast(`تم إرسال طلب شراء ${SELECTED_PACKAGE.gold} ذهب إلى الإدارة ⏳ سيصلك إشعار فور الموافقة وشحن الرصيد`);
  } catch (e) {
    toast(e.error || 'تعذر إرسال الطلب', false);
  }
}

const buyPaypalBtn = $('#buyPaypal');
if (buyPaypalBtn) buyPaypalBtn.onclick = buyGold;
const buyDebitBtn = $('#buyDebit');
if (buyDebitBtn) buyDebitBtn.onclick = openCardPaymentModal;
const cardPayBtn = $('#cardPaySubmitBtn');
if (cardPayBtn) cardPayBtn.onclick = executeCardPayment;
initCardInputFormatting();

$$('#setList .switch').forEach(sw => sw.onclick = () => {
  const k = sw.dataset.set;
  PREFS[k] = PREFS[k] ? 0 : 1;
  sw.classList.toggle('on', !!PREFS[k]);
  savePrefs();
  toast('تم حفظ الاعدادات ✓');
});
$('#compSend').onclick = async () => {
  if (!$('#compMsg').value.trim()) return toast('اكتب الشكوى أولا', false);
  await api('/api/complaint', 'POST', { subject: $('#compSubject').value, message: $('#compMsg').value });
  $('#compMsg').value = ''; $('#compSubject').value = '';
  closeOv('compOv');
  toast('تم إرسال الشكوى للإدارة ✅');
};

// تغيير الصورة — معرض صور حقيقي ومرفوعات المستخدم
AVA_CAT = 'def';
let MY_AVATARS = [];
async function openAvatars() {
  SEL_AVATAR = ME.avatar;
  await renderAvaGrid(AVA_CAT);
  openOv('avaOv');
}
$$('.ava-tab').forEach(t => t.onclick = async () => {
  AVA_CAT = t.dataset.acat;
  $$('.ava-tab').forEach(x => x.classList.toggle('active', x === t));
  await renderAvaGrid(AVA_CAT);
});
async function renderAvaGrid(cat) {
  let html = '';
  if (cat === 'custom') {
    try {
      MY_AVATARS = await api('/api/my-avatars');
    } catch (e) { MY_AVATARS = []; }
    if (!MY_AVATARS.length) {
      html = `<div class="pv-empty" style="grid-column:1/-1;padding:40px 10px;text-align:center;color:#94a3b8">
        <i class="f7-icons" style="font-size:36px;display:block;margin-bottom:8px">photo_on_rectangle</i>
        <div>${APP_LANG === 'es' ? 'No hay fotos subidas aún' : (APP_LANG === 'tr' ? 'Henüz yüklenen fotoğraf yok' : (APP_LANG === 'en' ? 'No uploaded photos yet' : 'لا توجد صور مرفوعة بعد'))}</div>
        <div style="font-size:12px;margin-top:4px;color:#cbd5e1">${APP_LANG === 'es' ? 'Haz clic en "Subir foto" abajo (se guardan hasta 10 fotos)' : (APP_LANG === 'tr' ? 'Aşağıdaki "Fotoğraf yükle"ye tıklayın (maks 10 fotoğraf)' : (APP_LANG === 'en' ? 'Click "Upload photo" below (up to 10 photos saved)' : 'اضغط على "رفع صورة" بالأسفل (يتم حفظ حتى 10 صور)'))}</div>
      </div>`;
    } else {
      MY_AVATARS.forEach(item => {
        const v = item.path;
        html += `<div class="ava-cell ${SEL_AVATAR === v ? 'sel' : ''}" data-v="${esc(v)}"><img src="${esc(v)}" loading="lazy"></div>`;
      });
    }
  } else {
    try {
      const serverAvatars = await api('/api/avatars?category=' + cat);
      if (serverAvatars && serverAvatars.length) {
        serverAvatars.forEach(item => {
          const v = item.path;
          html += `<div class="ava-cell ${SEL_AVATAR === v ? 'sel' : ''}" data-v="${esc(v)}"><img src="${esc(v)}" loading="lazy"></div>`;
        });
      } else {
        const AVA_FALLBACK = { def: 20, nature: 16, other: 16 };
        const n = AVA_FALLBACK[cat] || 16;
        for (let i = 1; i <= n; i++) {
          const v = `/avatars/${cat}/${String(i).padStart(2, '0')}.jpg`;
          html += `<div class="ava-cell ${SEL_AVATAR === v ? 'sel' : ''}" data-v="${v}"><img src="${v}" loading="lazy"></div>`;
        }
      }
    } catch (e) {
      const AVA_FALLBACK = { def: 20, nature: 16, other: 16 };
      const n = AVA_FALLBACK[cat] || 16;
      for (let i = 1; i <= n; i++) {
        const v = `/avatars/${cat}/${String(i).padStart(2, '0')}.jpg`;
        html += `<div class="ava-cell ${SEL_AVATAR === v ? 'sel' : ''}" data-v="${v}"><img src="${v}" loading="lazy"></div>`;
      }
    }
  }
  $('#avaGrid').innerHTML = html;
  $$('#avaGrid .ava-cell').forEach(c => c.onclick = () => {
    SEL_AVATAR = c.dataset.v;
    $$('#avaGrid .ava-cell').forEach(x => x.classList.toggle('sel', x.dataset.v === SEL_AVATAR));
  });
}
$('#avaUploadBtn').onclick = () => $('#avaFile').click();
$('#avaFile').onchange = async () => {
  try {
    const f = $('#avaFile').files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('avatar', f);
    const d = await uploadFormWithProgress('/api/avatar', fd, 'جاري رفع الصورة الشخصية...');
    SEL_AVATAR = d.avatar;
    ME.avatar = d.avatar;
    AVA_CAT = 'custom';
    $$('.ava-tab').forEach(x => x.classList.toggle('active', x.dataset.acat === 'custom'));
    await renderAvaGrid('custom');
    onLoggedIn();
    toast('تم رفع الصورة وحفظها في قائمة مرفوعاتي ✅');
  } catch (e) { toast(e.error || 'تعذر رفع الصورة', false); }
};
$('#avaSave').onclick = async () => {
  try {
    if (SEL_AVATAR && SEL_AVATAR !== ME.avatar) {
      await api('/api/avatar', 'POST', { avatar: SEL_AVATAR });
      ME.avatar = SEL_AVATAR;
      onLoggedIn();
    }
    closeOv('avaOv');
    toast('تم حفظ الصورة بنجاح ✅');
  } catch (e) { toast(e.error || 'تعذر حفظ الصورة', false); }
};

// =====================================================
//  الحائط
// =====================================================
function wallTime(timestamp) {
  const date = new Date((+timestamp || Date.now() / 1000) * 1000);
  return date.toLocaleString(APP_LANG === 'en' ? 'en-US' : 'ar-JO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
async function openWall() {
  if (!ME) return openLogin();
  $('#wallComposeAvatar').innerHTML = avatarHtml(ME.avatar);
  $('#wallComposer').hidden = true;
  $('#wallCreateTrigger').hidden = !canUseMembershipFeature('wall_allowed_memberships');
  openOv('wallOv');
  await loadWallPosts(true);
}
async function loadWallPosts(showLoading = true) {
  if (!ME) return;
  if (showLoading) $('#wallList').innerHTML = '<div class="wall-loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل المنشورات...</div>';
  try {
    WALL_POSTS = await api('/api/wall');
    $('#wallRefresh').classList.remove('has-updates');
    renderWallPosts();
  } catch (e) {
    $('#wallList').innerHTML = '<div class="wall-empty"><i class="f7-icons">exclamationmark_circle</i>تعذر تحميل الحائط</div>';
  }
}
function bindWallMoreComments(card) {
  const more = card.querySelector('.wall-comments-more');
  if (!more) return;
  more.onclick = () => {
    card.dataset.commentsExpanded = '1';
    card.querySelectorAll('.wall-comment-extra').forEach(comment => { comment.hidden = false; });
    more.remove();
  };
}
function updateWallReactionDisplay(card, post) {
  const order = ['👍', '❤️', '😂', '😍', '😮'];
  card.querySelector('.wall-reaction-emojis').innerHTML = order.filter(icon => post.reactions && post.reactions[icon])
    .map(icon => `<span>${icon}<b>${post.reactions[icon]}</b></span>`).join('');
  card.querySelector('.wall-reaction-summary > span:last-child').textContent = `${post.reaction_count || 0} تفاعل • ${(post.comments || []).length} تعليق`;
  card.querySelector('.wall-like').classList.toggle('active', post.my_reaction === '👍');
  const react = card.querySelector('.wall-react-action');
  react.classList.toggle('active', !!post.my_reaction && post.my_reaction !== '👍');
  react.querySelector(':scope > span').textContent = post.my_reaction && post.my_reaction !== '👍' ? post.my_reaction : 'سمايل';
  react.classList.remove('show-picker');
}
function appendWallCommentWithoutMediaReset(card, post, comment) {
  post.comments = post.comments || [];
  post.comments.push(comment);
  const commenter = comment.user || { username: comment.username, avatar: '' };
  const node = document.createElement('div');
  const expanded = card.dataset.commentsExpanded === '1';
  node.className = 'wall-comment' + (post.comments.length > 2 ? ' wall-comment-extra' : '');
  if (post.comments.length > 2 && !expanded) node.hidden = true;
  node.innerHTML = `<span class="wall-comment-avatar">${avatarHtml(commenter.avatar)}</span><div class="wall-comment-bubble"><b>${esc(commenter.username || comment.username)}</b><p>${esc(comment.text)}</p></div>`;
  card.querySelector('.wall-comment-list').appendChild(node);
  let more = card.querySelector('.wall-comments-more');
  if (post.comments.length > 2 && !expanded) {
    if (!more) {
      more = document.createElement('button'); more.type = 'button'; more.className = 'wall-comments-more';
      card.querySelector('.wall-comment-form').before(more);
    }
    more.textContent = `إظهار المزيد (${post.comments.length - 2})`;
    bindWallMoreComments(card);
  }
  card.querySelector('.wall-reaction-summary > span:last-child').textContent = `${post.reaction_count || 0} تفاعل • ${post.comments.length} تعليق`;
}
function wallPostMarkup(post) {
  const reactionsOrder = ['👍', '❤️', '😂', '😍', '😮'];
  const user = post.user || { username: post.username, avatar: '', badge: 'register.png' };
  const reactions = reactionsOrder.filter(icon => post.reactions && post.reactions[icon])
    .map(icon => `<span>${icon}<b>${post.reactions[icon]}</b></span>`).join('');
  const comments = (post.comments || []).map((comment, commentIndex) => {
    const commenter = comment.user || { username: comment.username, avatar: '' };
    return `<div class="wall-comment${commentIndex >= 2 ? ' wall-comment-extra' : ''}" ${commentIndex >= 2 ? 'hidden' : ''}>
      <span class="wall-comment-avatar">${avatarHtml(commenter.avatar)}</span>
      <div class="wall-comment-bubble"><b>${esc(commenter.username || comment.username)}</b><p>${esc(comment.text)}</p></div>
    </div>`;
  }).join('');
  const moreComments = (post.comments || []).length > 2 ? `<button class="wall-comments-more" type="button">إظهار المزيد (${(post.comments || []).length - 2})</button>` : '';
  const image = post.image ? `<div class="wall-post-image"><img src="${esc(post.image)}" loading="lazy" alt=""></div>` : '';
  const media = post.youtube_url
    ? `<div class="wall-media"><iframe src="${esc(post.youtube_url)}" title="YouTube" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`
    : (post.video ? `<div class="wall-media"><video src="${esc(post.video)}" controls playsinline preload="metadata"></video></div>` : '');
  const myReaction = post.my_reaction || '';
  return `<article class="wall-post" data-id="${post.id}">
    <div class="wall-post-head">
      <span class="wall-post-avatar">${avatarHtml(user.avatar)}</span>
      <span class="wall-post-who"><b>${esc(user.username || post.username)}${user.verified ? ' <i class="f7-icons">checkmark_seal_fill</i>' : ''}</b><small>${esc(wallTime(post.created_at))}</small></span>
      ${(user.badge && !['guest.png', 'register.png'].includes(user.badge)) ? `<img class="wall-post-badge" src="/badges/${esc(user.badge)}" alt="">` : ''}
      ${post.can_delete ? '<button class="wall-post-delete" type="button" title="حذف المنشور"><i class="f7-icons">trash_fill</i></button>' : ''}
    </div>
    ${post.text ? `<div class="wall-post-text">${esc(post.text)}</div>` : ''}
    ${image}
    ${media}
    <div class="wall-reaction-summary"><span class="wall-reaction-emojis">${reactions}</span><span>${post.reaction_count || 0} تفاعل • ${(post.comments || []).length} تعليق</span></div>
    <div class="wall-post-actions">
      <button class="wall-action wall-like${myReaction === '👍' ? ' active' : ''}" type="button"><i class="f7-icons">hand_thumbsup_fill</i><span>إعجاب</span></button>
      <div class="wall-action wall-react-action${myReaction && myReaction !== '👍' ? ' active' : ''}" role="button" tabindex="0"><i class="f7-icons">smiley_fill</i><span>${myReaction && myReaction !== '👍' ? myReaction : 'سمايل'}</span><div class="wall-reaction-picker">${reactionsOrder.map(icon => `<span data-reaction="${icon}">${icon}</span>`).join('')}</div></div>
      <button class="wall-action wall-comment-focus" type="button"><i class="f7-icons">chat_bubble_fill</i><span>تعليق</span></button>
    </div>
    <div class="wall-comments">
      <div class="wall-comment-list">${comments}</div>
      ${moreComments}
      <div class="wall-comment-form"><input maxlength="500" placeholder="اكتب تعليقاً..."><button type="button"><i class="f7-icons">paperplane_fill</i></button></div>
    </div>
  </article>`;
}
function bindWallPostCard(card, post) {
  if (!card || !post) return;
  const postId = +post.id;
  bindWallMoreComments(card);
  card.querySelector('.wall-like').onclick = async () => {
    const updated = await api(`/api/wall/${postId}/reaction`, 'POST', { reaction: '👍' });
    Object.assign(post, updated);
    updateWallReactionDisplay(card, post);
  };
  const reactAction = card.querySelector('.wall-react-action');
  reactAction.onclick = event => {
    if (event.target.closest('[data-reaction]')) return;
    $$('.wall-react-action').forEach(item => { if (item !== reactAction) item.classList.remove('show-picker'); });
    reactAction.classList.toggle('show-picker');
  };
  card.querySelectorAll('[data-reaction]').forEach(choice => choice.onclick = async event => {
    event.stopPropagation();
    const updated = await api(`/api/wall/${postId}/reaction`, 'POST', { reaction: choice.dataset.reaction });
    Object.assign(post, updated);
    updateWallReactionDisplay(card, post);
  });
  const input = card.querySelector('.wall-comment-form input');
  const sendComment = async () => {
    const text = input.value.trim(); if (!text) return;
    const result = await api(`/api/wall/${postId}/comments`, 'POST', { text });
    input.value = '';
    appendWallCommentWithoutMediaReset(card, post, result.comment);
  };
  card.querySelector('.wall-comment-form button').onclick = sendComment;
  input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); sendComment(); } };
  card.querySelector('.wall-comment-focus').onclick = () => input.focus();
  const remove = card.querySelector('.wall-post-delete');
  if (remove) remove.onclick = async () => {
    if (!confirm('حذف هذا المنشور؟')) return;
    await api('/api/wall/' + postId, 'DELETE');
    WALL_POSTS = WALL_POSTS.filter(item => +item.id !== postId);
    card.remove();
    if (!WALL_POSTS.length) renderWallPosts();
  };
}
function renderWallPosts() {
  $('#wallList').innerHTML = WALL_POSTS.length
    ? WALL_POSTS.map(wallPostMarkup).join('')
    : '<div class="wall-empty"><i class="f7-icons">doc_text_fill</i>لا توجد منشورات بعد، كن أول من ينشر على الحائط</div>';
  $$('#wallList .wall-post').forEach(card => bindWallPostCard(card, WALL_POSTS.find(post => +post.id === +card.dataset.id)));
}
function insertWallPostIncrementally(post) {
  if (!post || $(`#wallList .wall-post[data-id="${+post.id}"]`)) return false;
  WALL_POSTS = [post, ...WALL_POSTS.filter(item => +item.id !== +post.id)];
  const list = $('#wallList');
  if (list.querySelector('.wall-empty, .wall-loading')) list.innerHTML = '';
  const template = document.createElement('template');
  template.innerHTML = wallPostMarkup(post).trim();
  const card = template.content.firstElementChild;
  list.prepend(card);
  bindWallPostCard(card, post);
  $('#wallRefresh').classList.remove('has-updates');
  return true;
}
async function fetchAndInsertWallPost(postId) {
  if (!postId || $(`#wallList .wall-post[data-id="${+postId}"]`)) return false;
  try {
    const post = await api('/api/wall/' + (+postId));
    return insertWallPostIncrementally(post);
  } catch (e) {
    $('#wallRefresh').classList.add('has-updates');
    return false;
  }
}
function resetWallComposer() {
  $('#wallPostText').value = '';
  $('#wallYoutubeSearch').value = '';
  $('#wallYoutubeResults').innerHTML = '';
  $('#wallYoutubeRow').hidden = true;
  $('#wallYoutubeSelected').hidden = true;
  $('#wallYoutubeSelected').innerHTML = '';
  WALL_YOUTUBE_URL = ''; WALL_YOUTUBE_RESULTS = [];
  WALL_IMAGE_PATH = '';
  $('#wallImageElement').removeAttribute('src');
  $('#wallImagePreview').hidden = true;
  $('#wallImageFile').value = '';
  WALL_VIDEO_PATH = '';
  $('#wallVideoElement').removeAttribute('src');
  $('#wallVideoPreview').hidden = true;
  $('#wallVideoFile').value = '';
}
$('#wallRefresh').onclick = () => loadWallPosts(true);
$('#wallCreateTrigger').onclick = () => {
  if (!canUseMembershipFeature('wall_allowed_memberships'))
    return toast('عضويتك غير مسموح لها بالنشر على الحائط', false);
  $('#wallCreateTrigger').hidden = true;
  $('#wallComposer').hidden = false;
  $('#wallPostText').focus();
};
$('#wallComposerClose').onclick = () => {
  resetWallComposer();
  $('#wallComposer').hidden = true;
  $('#wallCreateTrigger').hidden = false;
};
$('#wallAddYoutube').onclick = () => { $('#wallYoutubeRow').hidden = false; $('#wallYoutubeSearch').focus(); };
$('#wallYoutubeClose').onclick = () => {
  WALL_YOUTUBE_URL = ''; WALL_YOUTUBE_RESULTS = [];
  $('#wallYoutubeSearch').value = '';
  $('#wallYoutubeResults').innerHTML = '';
  $('#wallYoutubeSelected').hidden = true;
  $('#wallYoutubeRow').hidden = true;
};
$('#wallYoutubeSearchBtn').onclick = async () => {
  const query = $('#wallYoutubeSearch').value.trim();
  if (!query) return toast('اكتب كلمات البحث في YouTube', false);
  const button = $('#wallYoutubeSearchBtn'); button.disabled = true;
  $('#wallYoutubeResults').innerHTML = '<div class="wall-loading" style="grid-column:1/3;padding:15px"><i class="f7-icons">arrow2_circlepath</i>جاري البحث...</div>';
  try {
    WALL_YOUTUBE_RESULTS = await api('/api/wall/youtube-search?q=' + encodeURIComponent(query));
    $('#wallYoutubeResults').innerHTML = WALL_YOUTUBE_RESULTS.length ? WALL_YOUTUBE_RESULTS.map((video, index) => `<button class="wall-youtube-result" type="button" data-index="${index}"><img src="${esc(video.thumbnail)}" alt=""><span>${esc(video.title)}</span></button>`).join('') : '<div class="wall-empty" style="grid-column:1/3;padding:15px">لا توجد نتائج</div>';
    $$('#wallYoutubeResults .wall-youtube-result').forEach(result => result.onclick = () => {
      const video = WALL_YOUTUBE_RESULTS[+result.dataset.index]; if (!video) return;
      WALL_YOUTUBE_URL = video.embed_url;
      WALL_VIDEO_PATH = '';
      $('#wallVideoElement').removeAttribute('src');
      $('#wallVideoPreview').hidden = true;
      $('#wallVideoFile').value = '';
      $('#wallYoutubeSelected').innerHTML = `<img src="${esc(video.thumbnail)}" alt=""><span>${esc(video.title)}</span><button type="button"><i class="f7-icons">xmark</i></button>`;
      $('#wallYoutubeSelected').hidden = false;
      $('#wallYoutubeResults').innerHTML = '';
      $('#wallYoutubeSelected button').onclick = () => { WALL_YOUTUBE_URL = ''; $('#wallYoutubeSelected').hidden = true; };
    });
  } catch (e) { $('#wallYoutubeResults').innerHTML = ''; toast(e.error || 'تعذر البحث في YouTube', false); }
  finally { button.disabled = false; }
};
$('#wallYoutubeSearch').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); $('#wallYoutubeSearchBtn').click(); } };
$('#wallAddImage').onclick = () => $('#wallImageFile').click();
$('#wallImageFile').onchange = async () => {
  const file = $('#wallImageFile').files[0]; if (!file) return;
  const form = new FormData(); form.append('image', file);
  $('#wallAddImage').disabled = true;
  try {
    toast('جاري رفع الصورة...');
    const uploaded = await uploadFormWithProgress('/api/wall/upload-image', form, 'جاري رفع صورة الحائط...');
    WALL_IMAGE_PATH = uploaded.path;
    $('#wallImageElement').src = uploaded.path;
    $('#wallImagePreview').hidden = false;
    toast('تم رفع الصورة بنجاح');
  } catch (e) { toast(e.error || 'تعذر رفع الصورة', false); }
  finally { $('#wallAddImage').disabled = false; }
};
$('#wallImageRemove').onclick = () => {
  WALL_IMAGE_PATH = '';
  $('#wallImageElement').removeAttribute('src');
  $('#wallImagePreview').hidden = true;
  $('#wallImageFile').value = '';
};
$('#wallAddVideo').onclick = () => $('#wallVideoFile').click();
$('#wallVideoFile').onchange = async () => {
  const file = $('#wallVideoFile').files[0]; if (!file) return;
  const form = new FormData(); form.append('video', file);
  $('#wallAddVideo').disabled = true;
  try {
    toast('جاري رفع الفيديو...');
    const uploaded = await uploadFormWithProgress('/api/wall/upload-video', form, 'جاري رفع فيديو الحائط...');
    WALL_VIDEO_PATH = uploaded.path;
    WALL_YOUTUBE_URL = '';
    $('#wallYoutubeSelected').hidden = true;
    $('#wallYoutubeSelected').innerHTML = '';
    $('#wallYoutubeResults').innerHTML = '';
    $('#wallVideoElement').src = uploaded.path;
    $('#wallVideoPreview').hidden = false;
    toast('تم رفع الفيديو بنجاح');
  } catch (e) { toast(e.error || 'تعذر رفع الفيديو', false); }
  finally { $('#wallAddVideo').disabled = false; }
};
$('#wallVideoRemove').onclick = () => {
  WALL_VIDEO_PATH = '';
  $('#wallVideoElement').removeAttribute('src');
  $('#wallVideoPreview').hidden = true;
  $('#wallVideoFile').value = '';
};
$('#wallPublish').onclick = async () => {
  const button = $('#wallPublish');
  button.disabled = true;
  const progressId = beginOperationProgress('جاري نشر المنشور على الحائط...');
  try {
    const created = await api('/api/wall', 'POST', {
      text: $('#wallPostText').value,
      youtube_url: WALL_YOUTUBE_URL,
      image: WALL_IMAGE_PATH,
      video: WALL_VIDEO_PATH
    });
    resetWallComposer();
    $('#wallComposer').hidden = true;
    $('#wallCreateTrigger').hidden = false;
    toast('تم نشر المنشور');
    await fetchAndInsertWallPost(created.id);
    $('#wallScroll').scrollTop = 0;
    finishUploadProgress(progressId, true);
  } catch (e) {
    finishUploadProgress(progressId, false);
    toast(e.error || 'تعذر نشر المنشور', false);
  }
  finally { button.disabled = false; }
};

// =====================================================
//  الإشعارات
// =====================================================
$('#notifSettings').onclick = async () => {
  if (!CURRENT_NOTIFICATIONS || !CURRENT_NOTIFICATIONS.length) {
    return toast('لا توجد إشعارات لحذفها');
  }
  if (!confirm('هل أنت متأكد من حذف جميع الإشعارات؟')) return;
  try {
    if (ME && ME.registered) {
      await api('/api/notifications/clear', 'DELETE');
    }
    NOTIFS = [];
    CURRENT_NOTIFICATIONS = [];
    NOTIF_UNREAD = 0;
    updateNotifBadge();
    $('#notifList').innerHTML = '<div class="pv-empty"><span class="empty-img"><img src="/img/notif_empty.png" alt=""></span><div>لا يوجد إشعارات بعد</div></div>';
    toast('تم حذف جميع الإشعارات بنجاح ✓');
  } catch (e) {
    toast(e.error || 'تعذر حذف الإشعارات', false);
  }
};
async function openNotifs() {
  if (!ME) return openLogin();
  NOTIF_UNREAD = 0;
  updateNotifBadge();
  openOv('notifOv');
  let server = [];
  if (ME.registered) {
    try {
      await api('/api/notifications/read-all', 'POST');
      server = await api('/api/notifications');
    } catch (e) { }
  }
  const local = NOTIFS.map(n => ({ ...n, created_at: +n.created_at || n.at / 1000 }));
  const merged = [...server, ...local].sort((a, b) => (+b.created_at || 0) - (+a.created_at || 0));
  // الإشعار الفوري والمحفوظ يحملان المعرّف نفسه؛ نعرض بطاقة واحدة فقط لكل معرّف.
  const seenNotificationIds = new Set();
  CURRENT_NOTIFICATIONS = merged.filter(n => {
    if (!n.id) return true;
    const key = String(n.id);
    if (seenNotificationIds.has(key)) return false;
    seenNotificationIds.add(key);
    return true;
  });
  $('#notifList').innerHTML = CURRENT_NOTIFICATIONS.length ? CURRENT_NOTIFICATIONS.map((notification, index) => {
    const isAnnouncement = notification.kind === 'announcement' || notification.icon === 'announcement';
    const a = isAnnouncement ? normalizeAnnouncement(notification) : null;
    const isRead = isAnnouncement ? isNotificationRead(a) : isNotificationRead(notification);
    const time = new Date((+notification.created_at || Date.now() / 1000) * 1000)
      .toLocaleTimeString(APP_LANG === 'en' ? 'en-US' : 'ar-JO', { hour: 'numeric', minute: '2-digit' });
    return `<div class="notif-row${isAnnouncement ? ' announcement' : ''}${isRead ? ' read' : ''}" data-index="${index}">
      <div class="notif-image">${isAnnouncement
        ? `<img src="${esc(a.image)}" alt="إعلان عام">`
        : `<i class="f7-icons">${esc(notification.icon || 'bell_fill')}</i>`}</div>
      <div class="notif-info">
        <div class="notif-title">${isAnnouncement ? '<span>إعلان عام</span><i class="f7-icons">speaker_3_fill</i>' : '<span>إشعار</span>'}</div>
        ${isAnnouncement ? `<div class="notif-sender"><span>${APP_LANG === 'en' ? 'By:' : 'بواسطة:'}</span> <b>${esc(a.sender_name)}</b></div>` : ''}
        <div class="notif-preview">${esc(notification.text)}</div>
      </div>
      <time class="notif-time">${esc(time)}</time>
      ${isAnnouncement && !isRead ? '<span class="notif-unread"></span>' : ''}
    </div>`;
  }).join('') : '<div class="pv-empty"><span class="empty-img"><img src="/img/notif_empty.png" alt=""></span><div>لا يوجد إشعارات بعد</div></div>';

  $$('#notifList .notif-row').forEach(row => {
    row.onclick = () => {
      const notification = CURRENT_NOTIFICATIONS[+row.dataset.index];
      if (!notification) return;
      const isAnnouncement = notification.kind === 'announcement' || notification.icon === 'announcement';
      if (isAnnouncement) {
        const a = normalizeAnnouncement(notification);
        row.classList.add('read');
        const dot = row.querySelector('.notif-unread'); if (dot) dot.remove();
        openAnnouncementPopup(a);
        return;
      }
      // عرض تفاصيل الإشعار في نافذة منبثقة جميلة تظهر فوق كل العناصر واللغات
      const titles = { ar: 'إشعار من النظام', en: 'System Notification', es: 'Notificación del Sistema', tr: 'Sistem Bildirimi' };
      $('#notifDetailTitle').textContent = titles[APP_LANG] || titles.ar;
      $('#notifDetailIcon').textContent = notification.icon || 'bell_fill';

      const iconBox = $('#notifDetailIconBox');
      if (iconBox) {
        iconBox.className = 'notif-detail-icon-box';
        if (notification.icon === 'creditcard_fill' || (notification.text && notification.text.includes('ذهب'))) {
          iconBox.classList.add('gold');
        } else if (notification.icon === 'phone_fill' || notification.icon === 'phone_down_fill') {
          iconBox.classList.add('green');
        } else {
          iconBox.classList.add('blue');
        }
      }

      const time = new Date((+notification.created_at || Date.now() / 1000) * 1000)
        .toLocaleString(APP_LANG === 'en' ? 'en-US' : (APP_LANG === 'es' ? 'es-ES' : (APP_LANG === 'tr' ? 'tr-TR' : 'ar-JO')));
      $('#notifDetailTime').textContent = time;
      $('#notifDetailText').textContent = translateDynamicText(notification.text, APP_LANG);

      const okBtn = document.querySelector('#notifDetailOv [data-close="notifDetailOv"]');
      const okTexts = { ar: 'حسناً', en: 'OK', es: 'Aceptar', tr: 'Tamam' };
      if (okBtn) okBtn.textContent = okTexts[APP_LANG] || 'حسناً';

      markNotificationAsRead(notification);
      row.classList.add('read');
      const dot = row.querySelector('.notif-unread'); if (dot) dot.remove();

      openOv('notifDetailOv');
    };
  });
}

// =====================================================
//  المصادقة
// =====================================================
function openLogin() {
  $('#loginErr').textContent = '';
  showLoginTab('guest');   // الافتراضي: دخول كزائر (مثل المرجع)
  openOv('loginOv');
}
function showLoginTab(t) {
  $('#memberBox').style.display = t === 'member' ? '' : 'none';
  $('#guestBox').style.display = t === 'guest' ? '' : 'none';
  $('#guestSwitch').classList.toggle('on', t === 'guest');
  $('#loginTitle').textContent = 'تسجيل الدخول';
}
$('#guestSwitch').onclick = () => showLoginTab($('#guestBox').style.display === 'none' ? 'guest' : 'member');
$('#goForgot').onclick = () => { closeOv('loginOv'); openOv('compOv'); $('#compSubject').value = 'استعادة كلمة السر'; };
$('#gGenderSel').onchange = e => {
  const v = e.target.value;
  $('#gGenderTxt').textContent = { boy: 'ذكر', girl: 'أنثى', secret: 'مجهول' }[v];
  $('#gSym').textContent = { boy: 'M', girl: 'F', secret: '؟' }[v];
};
$('#rGenderSel').onchange = e => {
  const v = e.target.value;
  $('#rGenderTxt').textContent = { boy: 'ذكر', girl: 'أنثى', secret: 'مجهول' }[v];
  $('#rGenderSym').textContent = { boy: 'M', girl: 'F', secret: '؟' }[v];
};
// زر الدخول/الاسم فوق قائمة الغرف
function closeEnterDrop() {
  $('#enterDrop').classList.remove('open');
  $('#enterDropBg').style.display = 'none';
}
function onEnterBtn() {
  if (!ME) return openLogin();
  const d = $('#enterDrop');
  if (d.classList.contains('open')) { closeEnterDrop(); return; }
  $('#enterDropBg').style.display = 'block';
  d.classList.add('open');
}
$('#headEnterBtn').onclick = (e) => { e.stopPropagation(); onEnterBtn(); };
$('#headUserBox').onclick = (e) => { e.stopPropagation(); onEnterBtn(); };
$('#enterDropBg').onclick = closeEnterDrop;
$('#dropRegister').onclick = () => { closeEnterDrop(); openOv('regOv'); };
$('#dropLogout').onclick = logoutWithoutReload;
$('#doLogin').onclick = async () => {
  try {
    const d = await api('/api/login', 'POST', { username: $('#lUser').value.trim(), password: $('#lPass').value });
    CHAT_TOKEN = d.tab_token || '';
    ME = d.user; MYBADGE = d.badge;
    closeOv('loginOv');
    onLoggedIn();
    connectSocketRetry();
    toast('مرحبا بك ' + ME.username + ' 👋');
  } catch (e) { $('#loginErr').textContent = e.error || 'فشل الدخول'; }
};
$('#doGuest').onclick = async () => {
  try {
    const gender = $('#gGenderSel').value;
    let name = $('#gName').value.trim();
    if (!name) { const names = ['زائر', 'ضيف', 'نجم', 'عاشق', 'مغامر', 'رامي', 'فارس', 'همس', 'شهم', 'ذوق']; name = names[Math.floor(Math.random() * names.length)] + Math.floor(Math.random() * 900 + 100); }
    const d = await api('/api/guest', 'POST', { username: name, gender });
    CHAT_TOKEN = d.tab_token || '';
    ME = d.user; MYBADGE = d.badge;
    closeOv('loginOv');
    onLoggedIn();
    connectSocketRetry();
    toast(d.guest_name_changed
      ? `الاسم ${d.requested_username} مسجل، تم دخولك كزائر باسم ${ME.username}`
      : 'أهلا بك كزائر ' + ME.username);
  } catch (e) { $('#loginErr').textContent = e.error || 'فشل الدخول'; }
};
$('#goRegister').onclick = () => { closeOv('loginOv'); openOv('regOv'); };
const gr2 = $('#goRegister2'); if (gr2) gr2.onclick = () => { closeOv('loginOv'); openOv('regOv'); };
$('#nrGo').onclick = () => { closeOv('needRegOv'); openOv('regOv'); };
$('#doRegister').onclick = async () => {
  try {
    const gender = $('#rGenderSel').value;
    const bio = $('#rBio') ? $('#rBio').value.trim() : '';
    const d = await api('/api/register', 'POST', {
      username: $('#rUser').value.trim(), password: $('#rPass').value,
      gender, age: +$('#rAge').value || 25,
      bio
    });
    CHAT_TOKEN = d.tab_token || '';
    ME = d.user; MYBADGE = d.badge;
    closeOv('regOv');
    onLoggedIn();
    connectSocketRetry();
    toast('تم تسجيل عضويتك بنجاح 🎉');
  } catch (e) { $('#regErr').textContent = e.error || 'فشل التسجيل'; }
};
function onLoggedIn() {
  // الهيدر: إخفاء زر الدخول وإظهار الصورة + الاسم
  $('#headEnterBtn').style.display = 'none';
  $('#headUserBox').style.display = 'flex';
  $('#headAva').innerHTML = avatarHtml(ME.avatar);
  $('#headName').textContent = ME.username;
  $('#menuBal').textContent = ME.balance;
  loadIgnoredUsers();
  loadUnreadNotifCount();
  // أيقونة القائمة في التنقل السفلي تصبح صورة العضو
  // أيقونة القائمة في التنقل السفلي تصبح صورة العضو (استبدال كامل لتجنب التداخل)
  const bm = $('#bnMenu');
  bm.innerHTML = `<span class="bn-ava" id="bnMenuIcon">${avatarHtml(ME.avatar)}<em><i class="f7-icons">circle_grid3x3_fill</i></em></span><span>القائمة</span>`;
}
let _sockTried = false;
function connectSocketRetry() {
  if (SOCKET) { try { SOCKET.disconnect(); } catch (e) { } }
  connectSocket();
}

// =====================================================
//  التنقل + الإدخال
// =====================================================
function showScreen(name) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $('#' + name + 'Screen').classList.add('active');
  $$('.bn-item').forEach(b => b.classList.toggle('active', b.dataset.nav === (name === 'chat' ? 'rooms' : name)));
  // شريط التنقل السفلي يظهر فقط داخل الغرفة
  document.querySelector('.bottomnav').classList.toggle('show', name === 'chat');
}
// إغلاق صفحات التنقل الأخرى عدا المطلوبة (التبديل بينها دون تراكم)
function closeNavPages(except) { ['privOv', 'notifOv', 'wallOv', 'menuOv'].forEach(id => { if (id !== except) closeOv(id); }); }
$$('.bn-item').forEach(b => b.onclick = () => {
  const nav = b.dataset.nav;
  if (nav === 'rooms') {           // «الغرف» = العودة إلى العامة (الدردشة الحالية)
    closeNavPages(null);
    if (CUR_ROOM) showScreen('chat'); else showScreen('rooms');
  }
  else if (nav === 'private') { closeNavPages('privOv'); PRIV_UNREAD = 0; updatePrivBadge(); openPrivateList(); }
  else if (nav === 'notifs') { closeNavPages('notifOv'); openNotifs(); }
  else if (nav === 'wall') { closeNavPages('wallOv'); openWall(); }
  else if (nav === 'menu') { closeNavPages('menuOv'); openMenu(); }
});
$('#chatBack').onclick = () => { openOv('exitOv'); };
$('#exitYes').onclick = () => { closeOv('exitOv'); leaveRoom(); showScreen('rooms'); };
// نافذة كلمة مرور الغرفة
$('#passGo').onclick = () => {
  const p = $('#passVal').value.trim();
  if (!p || !PASS_ROOM) return;
  const r = PASS_ROOM;
  closeOv('passOv');
  enterRoom(r.id, p);
};
$('#passVal').onkeydown = (e) => { if (e.key === 'Enter') $('#passGo').click(); };
// زر البيت داخل الغرفة: لوحة الغرف المضغوطة (لا يغادر الغرفة)
function setRoomsPanel(open) {
  closeOv('usersPanel');
  $('#roomsPanel').classList.toggle('open', open);
  $('#roomsVeil').style.display = open ? 'block' : 'none';
  if (open) {
    $$('.r-tab2').forEach(t => t.classList.toggle('active', t.dataset.tab === 'default'));
    renderRoomsPanel();
  }
}
$('#btnHome').onclick = () => setRoomsPanel(!$('#roomsPanel').classList.contains('open'));
$('#roomsPanelX').onclick = () => setRoomsPanel(false);
$('#roomsVeil').onclick = () => { setRoomsPanel(false); setUsersPanel(false); };
function setUsersPanel(open) {
  if (open) { $('#roomsPanel').classList.remove('open'); }
  $('#usersPanel').classList.toggle('open', open);
  $('#roomsVeil').style.display = open ? 'block' : 'none';
}
$('#usersPanelX').onclick = () => setUsersPanel(false);
function leaveRoom() {
  if (!$('#voiceRecorderOverlay').classList.contains('hidden')) closeVoiceRecorder();
  if (CUR_ROOM) {
    if (BCAST && BCAST.roomId === CUR_ROOM.id) {
      SOCKET.emit(BCAST.isHost ? 'bcast:stop' : 'bcast:leave', CUR_ROOM.id);
      bcastResetState();
    }
    delete ROOM_BCAST[CUR_ROOM.id];
    SOCKET.emit('leave', CUR_ROOM.id);
    delete ROOM_HIDDEN[CUR_ROOM.id];
  }
  CUR_ROOM = null;
  ROOM_USERS = [];
  closeOv('usersPanel');
  setRoomsPanel(false);
  $('#roomsVeil').style.display = 'none';
}
$('#btnRoomUsers').onclick = () => setUsersPanel(!$('#usersPanel').classList.contains('open'));
// زر النقاط: قائمة خيارات الغرفة
function closeRoomDrop() { $('#roomDrop').classList.remove('open'); $('#roomDropBg').style.display = 'none'; }
$('#btnRoomMore').onclick = (e) => { e.stopPropagation(); $('#roomDropBg').style.display = 'block'; $('#roomDrop').classList.toggle('open'); };
$('#btnLanguage').onclick = () => { setLanguage(APP_LANG, false); openOv('languageOv'); };
$$('.language-option').forEach(b => b.onclick = () => {
  const lang = b.dataset.language;
  setLanguage(lang);
  closeOv('languageOv');
  const toasts = {
    ar: 'تم تغيير اللغة إلى العربية',
    en: 'Language changed to English',
    es: 'Idioma cambiado a Español',
    tr: 'Dil Türkçe olarak değiştirildi'
  };
  toast(toasts[lang] || 'تم تغيير اللغة');
});
$('#roomDropBg').onclick = closeRoomDrop;
$('#dropLeaveRoom').onclick = () => { closeRoomDrop(); openOv('exitOv'); };
$('#dropRefreshRooms').onclick = async () => { closeRoomDrop(); await loadRooms(); toast('تم تحديث قائمة الغرف ✓'); };
// حبة المايك: قائمة الحالة السريعة
$('#micPill').onclick = () => { if (!ME) return openLogin(); openQuick(); };
$('#userSearch').oninput = renderUsers;
['#roomSearch','#roomSearch2','#userSearch'].forEach(sel => { const t = $(sel); if (t) t.onkeydown = e => { if (e.key === 'Enter') e.preventDefault(); }; });

$$('.r-tab').forEach(t => t.onclick = () => {
  CUR_TAB = t.dataset.tab;
  $$('.r-tab').forEach(x => x.classList.toggle('active', x === t));
  renderRooms();
});
$$('.r-tab2').forEach(t => t.onclick = () => {
  $$('.r-tab2').forEach(x => x.classList.toggle('active', x === t));
  renderRoomsPanel();
});
$('#roomSearch').oninput = renderRooms;
$('#roomSearch2').oninput = renderRoomsPanel;

// الإرسال
$('#btnSend').onclick = sendMsg;
$('#msgInput').onkeydown = e => { if (e.key === 'Enter') sendMsg(); };
function sendMsg() {
  if (!ME) return openLogin();
  if (!CUR_ROOM) return toast('اختر غرفة أولا', false);
  const t = $('#msgInput').value.trim();
  if (!t) return;
  if (!canUseMembershipFeature('public_message_allowed_memberships'))
    return toast('عضويتك غير مسموح لها بإرسال الرسائل في العام', false);
  SOCKET.emit('msg', { roomId: CUR_ROOM.id, text: t, reply: REPLY_TO, color: MY_COLOR || null });
  setReply(null);
  $('#msgInput').value = '';
}
// الإيموجي المصور المرفوع من لوحة الإدارة فقط
function insertCustomEmojiToken(id) {
  const isPrivateOpen = $('#pmOv') && $('#pmOv').classList.contains('open');
  const input = isPrivateOpen ? $('#pmInput') : $('#msgInput');
  if (!input) return;
  const token = `(${id})`;
  const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
  const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
  input.setRangeText(token, start, end, 'end');
  input.focus();
}
function renderEmojiPicker() {
  $('#emojiGrid').innerHTML = CUSTOM_EMOJIS.length
    ? CUSTOM_EMOJIS.map(e => `<img class="custom-emoji-choice" src="${esc(e.img)}" data-id="${e.id}" alt="emoji">`).join('')
    : '<div class="custom-emoji-empty">لا توجد إيموجيات مرفوعة حالياً</div>';
  $$('#emojiGrid .custom-emoji-choice').forEach(im => im.onclick = () => {
    if (!ME) return openLogin();
    const isPrivateOpen = $('#pmOv') && $('#pmOv').classList.contains('open');
    if (!isPrivateOpen && !CUR_ROOM) return toast('اختر غرفة أولا', false);
    if (isPrivateOpen && !PM_WITH) return toast('اختر مستخدماً أولاً', false);
    insertCustomEmojiToken(im.dataset.id);
    $('#emojiPanel').classList.remove('open');
  });
}
async function loadCustomEmojis() {
  try { CUSTOM_EMOJIS = await api('/api/emojis'); } catch (e) { CUSTOM_EMOJIS = []; }
  renderEmojiPicker();
}
loadCustomEmojis();
api('/api/gifts').then(g => { GIFTS = g; }).catch(() => { });   // تحميل مسبق لقائمة الهدايا
// قائمة الألوان — تغيير لون خط رسائلي (يُحفظ على جهازي)
const TEXT_COLORS = ['#000000', '#e03131', '#e91e8c', '#9c36b5', '#7c3aed', '#1479f2', '#0e9fdd', '#38b6ff', '#2e9e44', '#66bb6a', '#f59e0b', '#ea580c', '#795548', '#6b7280'];
let MY_COLOR = localStorage.getItem('njc_color') || '';
function renderColorGrid() {
  $('#colorGrid').innerHTML = `<button class="csw auto${MY_COLOR === '' ? ' sel' : ''}" data-c="">تلقائي</button>` +
    TEXT_COLORS.map(c => `<button class="csw${MY_COLOR === c ? ' sel' : ''}" data-c="${c}" style="background:${c}"></button>`).join('');
  $$('#colorGrid .csw').forEach(b => b.onclick = () => {
    MY_COLOR = b.dataset.c;
    localStorage.setItem('njc_color', MY_COLOR);
    renderColorGrid();
    $('#colorPanel').classList.remove('open');
    toast(MY_COLOR ? 'تم تغيير لون خطك 🎨' : 'رجع لون خطك للون رتبتك');
  });
}
renderColorGrid();
$('#btnEmoji').onclick = (e) => {
  e.stopPropagation();
  $('#colorPanel').classList.remove('open');
  const ep = $('#emojiPanel');
  ep.classList.remove('pm-mode');
  ep.classList.toggle('open');
};
$('#colorPanel').classList.remove('open');
$('#btnApps').onclick = (e) => {
  e.stopPropagation();
  $('#emojiPanel').classList.remove('open');
  $('#colorPanel').classList.toggle('open');
};
function currentMembershipAccessKey() {
  if (!ME || !ME.registered) return 'guest';
  return ME.membership && ME.membership !== 'none' ? ME.membership : 'registered';
}
function canUseMembershipFeature(settingKey) {
  if (ME && ['roomadmin', 'admin', 'superadmin', 'supermaster'].includes(ME.rank)) return true;
  return String(SETTINGS[settingKey] || '').split(',').map(v => v.trim()).includes(currentMembershipAccessKey());
}
async function sendPublicMedia(file, mediaDuration = 0) {
  if (!file || !CUR_ROOM || !SOCKET) return;
  mediaDuration = +mediaDuration || +file._duration || 0;
  const isAudio = String(file.type || '').startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|opus|webm)$/i.test(file.name || '');
  const fallbackName = isAudio ? `voice_${Date.now()}.webm` : `image_${Date.now()}.png`;
  const fd = new FormData();
  fd.append('media', file, file.name || file._uploadName || fallbackName);
  try {
    toast('جاري رفع الملف...');
    const uploaded = await uploadFormWithProgress(
      '/api/chat/upload-media', fd,
      isAudio ? 'جاري رفع المقطع الصوتي...' : 'جاري رفع الصورة إلى العام...'
    );
    SOCKET.emit('msg', {
      roomId: CUR_ROOM.id,
      text: '',
      media: { type: uploaded.type, path: uploaded.path, duration: Math.max(0, Math.min(300, mediaDuration)) },
      color: MY_COLOR
    });
  } catch (error) {
    toast(error.error || 'تعذر إرسال الملف', false);
  }
}

async function sendPrivateMedia(file, mediaDuration = 0) {
  if (!file || !PM_WITH || !SOCKET) return;
  mediaDuration = +mediaDuration || +file._duration || 0;
  const isAudio = String(file.type || '').startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|opus|webm)$/i.test(file.name || '');
  const fallbackName = isAudio ? `voice_${Date.now()}.webm` : `image_${Date.now()}.png`;
  const fd = new FormData();
  fd.append('media', file, file.name || file._uploadName || fallbackName);
  try {
    toast('جاري رفع الملف...');
    const uploaded = await uploadFormWithProgress(
      '/api/chat/upload-media', fd,
      isAudio ? 'جاري رفع المقطع الصوتي...' : 'جاري رفع الصورة إلى الخاص...'
    );
    SOCKET.emit('private', {
      toId: PM_WITH.id,
      text: '',
      media: { type: uploaded.type, path: uploaded.path, duration: Math.max(0, Math.min(300, mediaDuration)) }
    });
  } catch (error) {
    toast(error.error || 'تعذر إرسال الملف', false);
  }
}
let CHAT_MEDIA_DESTINATION = 'public'; // 'public' | 'private'
let PUBLIC_MEDIA_REVIEW_FILE = null, PUBLIC_MEDIA_REVIEW_TYPE = '', PUBLIC_MEDIA_REVIEW_URL = '', PUBLIC_MEDIA_REVIEW_ID = 0;
function publicMediaFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function closePublicMediaReview() {
  PUBLIC_MEDIA_REVIEW_ID++;
  const audio = $('#publicMediaReviewAudio');
  try { audio.pause(); } catch (e) { }
  audio.removeAttribute('src'); audio.load(); audio.hidden = true;
  const image = $('#publicMediaReviewImage'); image.removeAttribute('src'); image.hidden = true;
  if (PUBLIC_MEDIA_REVIEW_URL) URL.revokeObjectURL(PUBLIC_MEDIA_REVIEW_URL);
  PUBLIC_MEDIA_REVIEW_URL = '';
  PUBLIC_MEDIA_REVIEW_FILE = null;
  PUBLIC_MEDIA_REVIEW_TYPE = '';
  $('#publicMediaReview').classList.add('hidden');
  $('#publicMediaReview').setAttribute('aria-hidden', 'true');
}
function setPublicMediaReviewResult(ok, text, extraInfo = '') {
  const status = $('#publicMediaReviewStatus');
  status.textContent = APP_LANG === 'en' ? translateDynamicText(text) : text;
  status.className = 'public-media-review-status ' + (ok ? 'ok' : 'error');
  $('#publicMediaChecking').classList.add('hidden');
  $('#publicMediaReviewSend').disabled = !ok;
  if (extraInfo) $('#publicMediaReviewInfo').textContent += ` • ${extraInfo}`;
}
async function inspectPublicMedia(file, mediaType) {
  const reviewId = ++PUBLIC_MEDIA_REVIEW_ID;
  PUBLIC_MEDIA_REVIEW_FILE = file;
  PUBLIC_MEDIA_REVIEW_TYPE = mediaType;
  PUBLIC_MEDIA_REVIEW_URL = URL.createObjectURL(file);
  const overlay = $('#publicMediaReview');
  const status = $('#publicMediaReviewStatus');
  const title = mediaType === 'image' ? 'فحص الصورة قبل الإرسال' : 'فحص المقطع الصوتي قبل الإرسال';
  $('#publicMediaReviewTitle').textContent = APP_LANG === 'en' ? translateDynamicText(title) : title;
  status.textContent = APP_LANG === 'en' ? translateDynamicText('جارٍ فحص الملف...') : 'جارٍ فحص الملف...';
  status.className = 'public-media-review-status';
  $('#publicMediaReviewInfo').textContent = `${file.name || 'file'} • ${publicMediaFileSize(file.size || 0)}`;
  $('#publicMediaReviewSend').disabled = true;
  $('#publicMediaChecking').classList.remove('hidden');
  $('#publicMediaReviewImage').hidden = true;
  $('#publicMediaReviewAudio').hidden = true;
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');

  const imageNameOk = /\.(jpe?g|png|webp|gif)$/i.test(file.name || '');
  const audioNameOk = /\.(mp3|wav|ogg|m4a|aac|opus|webm)$/i.test(file.name || '');
  const mime = String(file.type || '');
  const mimeOk = !mime || mime === 'application/octet-stream' || mime.startsWith(mediaType + '/');
  if (!file.size || file.size > 50 * 1024 * 1024 || !mimeOk || (mediaType === 'image' ? !imageNameOk : !audioNameOk))
    return setPublicMediaReviewResult(false, 'تعذر فحص الملف أو أن تنسيقه غير مدعوم');

  try {
    if (mediaType === 'image') {
      const image = $('#publicMediaReviewImage');
      image.hidden = false;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 10000);
        image.onload = () => { clearTimeout(timer); resolve(); };
        image.onerror = () => { clearTimeout(timer); reject(new Error('invalid image')); };
        image.src = PUBLIC_MEDIA_REVIEW_URL;
      });
      if (reviewId !== PUBLIC_MEDIA_REVIEW_ID || !image.naturalWidth || !image.naturalHeight) return;
      setPublicMediaReviewResult(true, 'تم فحص الصورة ويمكن إرسالها', `${image.naturalWidth}×${image.naturalHeight}`);
    } else {
      const audio = $('#publicMediaReviewAudio');
      audio.hidden = false;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 12000);
        const ready = () => { clearTimeout(timer); resolve(); };
        audio.onloadedmetadata = ready;
        audio.oncanplay = ready;
        audio.onerror = () => { clearTimeout(timer); reject(new Error('invalid audio')); };
        audio.src = PUBLIC_MEDIA_REVIEW_URL;
        audio.load();
      });
      if (reviewId !== PUBLIC_MEDIA_REVIEW_ID) return;
      const duration = Number.isFinite(audio.duration) ? `${Math.ceil(audio.duration)} sec` : '';
      setPublicMediaReviewResult(true, 'تم فحص المقطع ويمكن إرساله', duration);
    }
  } catch (e) {
    if (reviewId === PUBLIC_MEDIA_REVIEW_ID)
      setPublicMediaReviewResult(false, 'تعذر فحص الملف أو أن تنسيقه غير مدعوم');
  }
}
function chooseChatMedia(accept, mediaType, destination = 'public') {
  CHAT_MEDIA_DESTINATION = destination;
  if (destination === 'public' && !CUR_ROOM) return toast('ادخل إلى غرفة أولاً', false);
  if (destination === 'private' && !PM_WITH) return toast('اختر عضواً أولاً', false);
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = accept;
  inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.onchange = () => {
    const file = inp.files && inp.files[0];
    if (file) inspectPublicMedia(file, mediaType);
    inp.remove();
  };
  inp.oncancel = () => inp.remove();
  inp.click();
}
function choosePublicMedia(accept, mediaType) {
  chooseChatMedia(accept, mediaType, 'public');
}
$('#publicMediaReviewClose').onclick = closePublicMediaReview;
$('#publicMediaReviewCancel').onclick = closePublicMediaReview;
$('#publicMediaReview').onclick = event => { if (event.target === $('#publicMediaReview')) closePublicMediaReview(); };
$('#publicMediaReviewSend').onclick = async () => {
  const file = PUBLIC_MEDIA_REVIEW_FILE;
  const mediaType = PUBLIC_MEDIA_REVIEW_TYPE;
  if (!file || $('#publicMediaReviewSend').disabled) return;
  if (CHAT_MEDIA_DESTINATION === 'private') {
    if (!PM_WITH) return toast('المحادثة الخاصة غير مفتوحة', false);
    if (!canUseMembershipFeature('private_message_allowed_memberships'))
      return toast('عضويتك غير مسموح لها بإرسال الصور في الخاص', false);
    closePublicMediaReview();
    await sendPrivateMedia(file);
  } else {
    if (mediaType === 'image' && !canUseMembershipFeature('public_image_allowed_memberships'))
      return toast('عضويتك غير مسموح لها بإرسال الصور في العام', false);
    if (mediaType === 'audio' && !canUseMembershipFeature('voice_allowed_memberships'))
      return toast('عضويتك غير مسموح لها بإرسال المقاطع الصوتية', false);
    closePublicMediaReview();
    await sendPublicMedia(file);
  }
};
let VOICE_MEDIA_RECORDER = null, VOICE_MEDIA_STREAM = null, VOICE_RECORD_TIMER = null;
let VOICE_RECORD_CHUNKS = [], VOICE_RECORD_STARTED_AT = 0, VOICE_RECORD_DURATION = 0;
let VOICE_RECORD_FILE = null, VOICE_RECORD_URL = '', VOICE_RECORD_SESSION = 0;
function stopVoiceMediaStream() {
  if (VOICE_MEDIA_STREAM) VOICE_MEDIA_STREAM.getTracks().forEach(track => { try { track.stop(); } catch (e) { } });
  VOICE_MEDIA_STREAM = null;
}
function resetVoicePreviewPlayer() {
  const audio = $('#voicePreviewAudio');
  try { audio.pause(); } catch (e) { }
  if (ACTIVE_CHAT_AUDIO === audio) ACTIVE_CHAT_AUDIO = null;
  audio.removeAttribute('src'); audio.load();
  if (VOICE_RECORD_URL) URL.revokeObjectURL(VOICE_RECORD_URL);
  VOICE_RECORD_URL = '';
  VOICE_RECORD_FILE = null;
  $('#voicePreviewSeek').value = 0; $('#voicePreviewSeek').max = 0;
  $('#voicePreviewCurrent').textContent = '00:00'; $('#voicePreviewDuration').textContent = '00:00';
  $('#voicePreviewPlay i').textContent = 'play_fill';
  $('#voicePreviewSend').disabled = true;
}
function closeVoiceRecorder() {
  VOICE_RECORD_SESSION++;
  clearInterval(VOICE_RECORD_TIMER); VOICE_RECORD_TIMER = null;
  if (VOICE_MEDIA_RECORDER && VOICE_MEDIA_RECORDER.state !== 'inactive') {
    try { VOICE_MEDIA_RECORDER.stop(); } catch (e) { }
  }
  VOICE_MEDIA_RECORDER = null;
  stopVoiceMediaStream();
  resetVoicePreviewPlayer();
  VOICE_RECORD_CHUNKS = [];
  VOICE_RECORD_DURATION = 0;
  $('#voiceRecordingStage').classList.remove('hidden');
  $('#voicePreviewStage').classList.add('hidden');
  $('#voiceStopBtn').disabled = false;
  $('#voiceRecordingTime').textContent = '00:00';
  $('#voiceRecorderOverlay').classList.add('hidden');
  $('#voiceRecorderOverlay').setAttribute('aria-hidden', 'true');
}
function voiceRecorderMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find(type => typeof MediaRecorder.isTypeSupported !== 'function' || MediaRecorder.isTypeSupported(type)) || '';
}
function voiceFileExtension(mime) {
  if (/ogg/i.test(mime)) return 'ogg';
  if (/mp4|m4a/i.test(mime)) return 'm4a';
  if (/wav/i.test(mime)) return 'wav';
  return 'webm';
}
function showVoiceRecordingPreview(blob, mime, sessionId, recordedDuration) {
  if (sessionId !== VOICE_RECORD_SESSION || !blob || blob.size < 100 || recordedDuration < .35) {
    if (sessionId === VOICE_RECORD_SESSION) { closeVoiceRecorder(); toast('التسجيل قصير جداً، حاول مرة أخرى', false); }
    return;
  }
  const extension = voiceFileExtension(mime);
  try {
    VOICE_RECORD_FILE = new File([blob], `voice_${Date.now()}.${extension}`, { type: mime || `audio/${extension}`, lastModified: Date.now() });
  } catch (e) {
    blob._uploadName = `voice_${Date.now()}.${extension}`;
    VOICE_RECORD_FILE = blob;
  }
  VOICE_RECORD_DURATION = Math.max(.35, +recordedDuration || 0);
  try { VOICE_RECORD_FILE._duration = VOICE_RECORD_DURATION; } catch (e) { }
  VOICE_RECORD_URL = URL.createObjectURL(blob);
  const audio = $('#voicePreviewAudio');
  const seek = $('#voicePreviewSeek');
  $('#voiceRecordingStage').classList.add('hidden');
  $('#voicePreviewStage').classList.remove('hidden');
  const audioReady = () => {
    if (sessionId !== VOICE_RECORD_SESSION) return;
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : VOICE_RECORD_DURATION;
    seek.max = duration;
    $('#voicePreviewDuration').textContent = formatAudioTime(duration);
    $('#voicePreviewSend').disabled = !(duration > 0);
  };
  audio.onloadedmetadata = audioReady;
  audio.oncanplay = audioReady;
  audio.ontimeupdate = () => {
    seek.value = audio.currentTime || 0;
    $('#voicePreviewCurrent').textContent = formatAudioTime(audio.currentTime);
  };
  audio.onplay = () => { $('#voicePreviewPlay i').textContent = 'pause_fill'; };
  audio.onpause = () => { $('#voicePreviewPlay i').textContent = 'play_fill'; };
  audio.onended = () => { audio.currentTime = 0; $('#voicePreviewPlay i').textContent = 'play_fill'; };
  audio.onerror = () => { if (sessionId === VOICE_RECORD_SESSION) { closeVoiceRecorder(); toast('تعذر إنشاء التسجيل الصوتي', false); } };
  audio.src = VOICE_RECORD_URL;
  audio.load();
}
async function startVoiceRecording() {
  if (!CUR_ROOM) return toast('ادخل إلى غرفة أولاً', false);
  if (ACTIVE_CHAT_AUDIO) { try { ACTIVE_CHAT_AUDIO.pause(); } catch (e) { } }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined')
    return toast('المتصفح لا يدعم التسجيل الصوتي', false);
  closeVoiceRecorder();
  const sessionId = ++VOICE_RECORD_SESSION;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (sessionId !== VOICE_RECORD_SESSION) { stream.getTracks().forEach(track => track.stop()); return; }
    VOICE_MEDIA_STREAM = stream;
    const mimeType = voiceRecorderMimeType();
    VOICE_MEDIA_RECORDER = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    VOICE_RECORD_CHUNKS = [];
    VOICE_MEDIA_RECORDER.ondataavailable = event => { if (event.data && event.data.size) VOICE_RECORD_CHUNKS.push(event.data); };
    VOICE_MEDIA_RECORDER.onerror = () => { if (sessionId === VOICE_RECORD_SESSION) { closeVoiceRecorder(); toast('تعذر إنشاء التسجيل الصوتي', false); } };
    VOICE_MEDIA_RECORDER.onstop = () => {
      clearInterval(VOICE_RECORD_TIMER); VOICE_RECORD_TIMER = null;
      stopVoiceMediaStream();
      if (sessionId !== VOICE_RECORD_SESSION) return;
      const mime = VOICE_MEDIA_RECORDER && VOICE_MEDIA_RECORDER.mimeType ? VOICE_MEDIA_RECORDER.mimeType : (mimeType || 'audio/webm');
      const blob = new Blob(VOICE_RECORD_CHUNKS, { type: mime });
      const recordedDuration = Math.max(0, (Date.now() - VOICE_RECORD_STARTED_AT) / 1000);
      VOICE_MEDIA_RECORDER = null;
      showVoiceRecordingPreview(blob, mime, sessionId, recordedDuration);
    };
    $('#voiceRecordingStage').classList.remove('hidden');
    $('#voicePreviewStage').classList.add('hidden');
    $('#voiceStopBtn').disabled = false;
    $('#voiceRecordingTime').textContent = '00:00';
    $('#voiceRecorderOverlay').classList.remove('hidden');
    $('#voiceRecorderOverlay').setAttribute('aria-hidden', 'false');
    VOICE_RECORD_STARTED_AT = Date.now();
    VOICE_MEDIA_RECORDER.start(500);
    VOICE_RECORD_TIMER = setInterval(() => {
      if (sessionId !== VOICE_RECORD_SESSION) return;
      const seconds = Math.floor((Date.now() - VOICE_RECORD_STARTED_AT) / 1000);
      $('#voiceRecordingTime').textContent = formatAudioTime(seconds);
      if (seconds >= 300 && VOICE_MEDIA_RECORDER && VOICE_MEDIA_RECORDER.state === 'recording') VOICE_MEDIA_RECORDER.stop();
    }, 250);
  } catch (e) {
    if (sessionId === VOICE_RECORD_SESSION) {
      closeVoiceRecorder();
      toast('تعذر الوصول إلى الميكروفون، تحقق من الإذن', false);
    }
  }
}
$('#voiceStopBtn').onclick = () => {
  if (!VOICE_MEDIA_RECORDER || VOICE_MEDIA_RECORDER.state === 'inactive') return;
  $('#voiceStopBtn').disabled = true;
  try { VOICE_MEDIA_RECORDER.stop(); } catch (e) { closeVoiceRecorder(); }
};
$('#voiceRecorderClose').onclick = closeVoiceRecorder;
$('#voicePreviewDelete').onclick = closeVoiceRecorder;
$('#voicePreviewPlay').onclick = async () => {
  const audio = $('#voicePreviewAudio');
  try {
    if (audio.paused) {
      if (ACTIVE_CHAT_AUDIO && ACTIVE_CHAT_AUDIO !== audio) ACTIVE_CHAT_AUDIO.pause();
      ACTIVE_CHAT_AUDIO = audio;
      await audio.play();
    } else audio.pause();
  } catch (e) { toast('تعذر تشغيل المقطع الصوتي', false); }
};
$('#voicePreviewSeek').oninput = () => {
  const audio = $('#voicePreviewAudio');
  if (Number.isFinite(audio.duration) || VOICE_RECORD_DURATION > 0) audio.currentTime = +$('#voicePreviewSeek').value || 0;
};
$('#voicePreviewSend').onclick = async () => {
  const file = VOICE_RECORD_FILE;
  const duration = VOICE_RECORD_DURATION;
  if (!file || $('#voicePreviewSend').disabled) return;
  closeVoiceRecorder();
  if (CHAT_MEDIA_DESTINATION === 'private') {
    if (!PM_WITH) return toast('المحادثة الخاصة غير مفتوحة', false);
    if (!canUseMembershipFeature('private_message_allowed_memberships'))
      return toast('عضويتك غير مسموح لها بإرسال الرسائل الصوتية في الخاص', false);
    await sendPrivateMedia(file, duration);
  } else {
    if (!canUseMembershipFeature('voice_allowed_memberships'))
      return toast('عضويتك غير مسموح لها بإرسال المقاطع الصوتية', false);
    await sendPublicMedia(file, duration);
  }
};
$('#btnMic').onclick = () => {
  if (!canUseMembershipFeature('voice_allowed_memberships'))
    return toast('عضويتك غير مسموح لها بإرسال المقاطع الصوتية', false);
  CHAT_MEDIA_DESTINATION = 'public';
  startVoiceRecording();
};
$('#pmMic').onclick = () => {
  if (!PM_WITH) return toast('المحادثة الخاصة غير مفتوحة', false);
  if (!canUseMembershipFeature('private_message_allowed_memberships'))
    return toast('عضويتك غير مسموح لها بإرسال الرسائل الصوتية في الخاص', false);
  CHAT_MEDIA_DESTINATION = 'private';
  startVoiceRecording();
};
$('#btnCam').onclick = () => {
  if (!canUseMembershipFeature('public_image_allowed_memberships'))
    return toast('عضويتك غير مسموح لها بإرسال الصور في العام', false);
  chooseChatMedia('image/*', 'image', 'public');
};
$('#pmCam').onclick = () => {
  if (!PM_WITH) return toast('المحادثة الخاصة غير مفتوحة', false);
  if (!canUseMembershipFeature('private_message_allowed_memberships'))
    return toast('عضويتك غير مسموح لها بإرسال الصور في الخاص', false);
  chooseChatMedia('image/*', 'image', 'private');
};
$('#pmEmoji').onclick = (e) => {
  e.stopPropagation();
  $('#colorPanel').classList.remove('open');
  const ep = $('#emojiPanel');
  ep.classList.add('pm-mode');
  ep.classList.toggle('open');
};
$('#privSettings').onclick = () => toast('اعدادات الخاص : استقبال الرسائل من الجميع');

// إغلاق اللوحات عند الضغط خارجها
document.addEventListener('click', (e) => {
  const ep = $('#emojiPanel');
  if (ep && ep.classList.contains('open') && !ep.contains(e.target) && !e.target.closest('#btnEmoji') && !e.target.closest('#pmEmoji')) {
    ep.classList.remove('open');
  }
  const cp = $('#colorPanel');
  if (cp && cp.classList.contains('open') && !cp.contains(e.target) && !e.target.closest('#btnApps')) {
    cp.classList.remove('open');
  }
});
// إغلاق النوافذ عند لمس الخلفية
$$('.overlay:not(.full)').forEach(ov => ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('open'); }));
