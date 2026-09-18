// =====================================================
//  شات نجوم العرب - واجهة المستخدم
// =====================================================
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let ME = null, MYBADGE = 'guest.png', SOCKET = null;
let PENDING_REPORT_TARGET = null; // المستخدم المُبلَّغ عنه في نافذة الشكوى (من الملف الشخصي)
let CONNECTION_INTERRUPTED = false;
// رمز هوية خاص بهذه الصفحة فقط؛ لا يُحفظ في localStorage أو sessionStorage.
// عند التحديث أو فتح تبويب جديد يجب إدخال الاسم من جديد.
let CHAT_TOKEN = '';
// علم الخروج البرمجي: إعادة تحميل تقررها المنصة نفسها (إعادة التحقق بعد فك
// الحظر، زر «العودة لتسجيل الدخول»، خروج DevTools الطارئ) — تتجاوز نافذة
// تأكيد المغادرة التي تظهر عند التحديث/الإغلاق.
let REFRESH_LEAVING = false;

// مفتاح جديد لكل مصافحة Engine.IO/Socket.IO. يجب أن يبقى مطابقاً للتحقق في
// server.js: أول 10 خانات هي x، وبقية القيمة هي x * 257.
var d = () => (
  (x => x + String(x * 257))(
    (Math.floor(Math.random() * 9000000000) + 1000000000)
  )
);
const ISSUED_SOCKET_HANDSHAKE_KEYS = new Set();
function nextSocketHandshakeKey() {
  let key = d();
  let x = Number(key.slice(0, 10));
  // ضمان ألا تحمل أي محاولة في عمر الصفحة رقماً سبق استعماله، حتى لو أعاد
  // Math.random القيمة ذاتها. عند التصادم ننتقل للرقم التالي مع بقاء الصيغة صحيحة.
  while (ISSUED_SOCKET_HANDSHAKE_KEYS.has(key)) {
    x = x >= 9999999999 ? 1000000000 : x + 1;
    key = String(x) + String(x * 257);
  }
  ISSUED_SOCKET_HANDSHAKE_KEYS.add(key);
  return key;
}
function refreshSocketHandshakeKey(socket) {
  const key = nextSocketHandshakeKey();
  // تعديل مباشر على كائن query نفسه (وليس استبداله): محرك Engine.IO يشارك
  // مرجع الكائن مع مدير Socket.IO، واستبدال الكائن كان يُبقي المحرك على
  // المفتاح القديم فيرسله مع كل إعادة اتصال — فيُعد «مفتاحاً مكرراً»
  // ويُحظر عنوان IP الهاتف تلقائياً.
  const mOpts = socket && socket.io && socket.io.opts;
  if (mOpts) {
    if (!mOpts.query || typeof mOpts.query !== 'object') mOpts.query = {};
    mOpts.query.key = key;
  }
  const eOpts = socket && socket.io && socket.io.engine && socket.io.engine.opts;
  if (eOpts) {
    if (!eOpts.query || typeof eOpts.query !== 'object') eOpts.query = {};
    eOpts.query.key = key;
  }
  return key;
}

let SETTINGS = { site_name: 'نجوم العرب', skin: 'default', font_size: '14', msg_max: 500, public_message_spacing_px: 4, public_message_name_size_px: 14, public_message_body_width: 'fit', msg_badge_superadmin_size: 24, msg_badge_admin_size: 24, msg_badge_roomadmin_size: 24, msg_badge_mmez_size: 24, msg_badge_vip_size: 24, msg_badge_premium_size: 24, msg_badge_plus_size: 24, msg_badge_register_size: 24, msg_badge_guest_size: 24, msg_badge_hidden_admin_size: 28, vip_cost: 30, premium_cost: 20, plus_cost: 10, show_smiles: '1', show_voice: '1', show_image: '1', hidden_super: '1', snd_join: '1', snd_msg: '0', snd_leave: '1', show_time: '1', wave_enabled: '1', wall_allowed_memberships: 'guest,registered,mmez,plus,premium,vip', status_allowed_memberships: 'registered,mmez,plus,premium,vip', voice_allowed_memberships: 'mmez,plus,premium,vip', broadcast_allowed_memberships: 'mmez,plus,premium,vip', public_message_allowed_memberships: 'guest,registered,mmez,plus,premium,vip', private_message_allowed_memberships: 'guest,registered,mmez,plus,premium,vip', private_call_allowed_memberships: 'mmez,plus,premium,vip', video_call_cost: 5, video_call_allowed_memberships: 'mmez,plus,premium,vip', public_image_allowed_memberships: 'guest,registered,mmez,plus,premium,vip' };
let PREFS = { snd_all: 1, snd_msg: 1, snd_join: 1, snd_leave: 1, show_time: 1, pm_recv: 1, dsk_ntf: 1 };
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
// سجلّ دائم بتدفّقات كل مذيع (hostId -> MediaStream) مستقلّ عن كائن BCAST المؤقت،
// حتى تعيد الواجهة ربط عنصر الصوت بالتدفّق إذا انقطع أو أُعيد بناء الحالة.
const BCAST_STREAMS = new Map();
let BCAST_AUDIO_WATCHDOG = null; // مؤقّت دوري يعيد تشغيل/ربط صوت المذيعين إذا توقّف بسبب تحديث الصفحة أو فتح قالب
// شكل BCAST: {
//   roomId, mode:'video'|'audio', isHost:bool,
//   hostId, hostInfo, localStream, peers:Map('dir:userId'->RTCPeerConnection),
//   watching:Set(hostId)        ← [فيديو] كل المذيعين الذين وافقوا على مشاهدتي لهم (يعملون كلهم معاً في نفس الوقت)
//   pendingTargets:Set(hostId)  ← طلبات مشاهدة أرسلتها وما زالت بانتظار رد أصحابها
// }
// ملاحظة مهمة: قبول بثٍ جديد لا يوقف أي بث آخر — كل بث وافق صاحبه على طلبه يستمر بشكل طبيعي،
// سواء كنت مذيعاً يبث بنفسه أو مشاهداً عادياً.
function bcastWatchingSet() { if (BCAST && !BCAST.watching) BCAST.watching = new Set(); return BCAST ? BCAST.watching : new Set(); }
function bcastPendingSet() { if (BCAST && !BCAST.pendingTargets) BCAST.pendingTargets = new Set(); return BCAST ? BCAST.pendingTargets : new Set(); }
function bcastIsWatchingHost(hostId) { return !!(BCAST && BCAST.watching && BCAST.watching.has(+hostId)); }
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
let SEL_AVATAR = null, AVA_CAT = 'def', SEL_FRAME = '';
let STATUSES = [], STATUS_GROUP = [], STATUS_INDEX = 0, CURRENT_STATUS = null;
// أصحاب الحالات النشطة: Map(user_id -> expires_at) لرسم الدائرة حول الصورة في
// قائمة المستخدمين والعام والخاص. تُحدَّث فور نشر/حذف أي حالة، وتُنظَّف ذاتياً
// عند انتهاء المدة (24 ساعة) فتختفي الدائرة بلا حاجة لتحديث الصفحة.
let STATUS_OWNERS = new Map();
let STATUS_OWNERS_TIMER = null;
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
  "إظهار أقل": "Show less", "التفاعلات": "Reactions", "الكل": "All", "عرض الملف الشخصي": "View profile", "جاري تحميل التفاعلات...": "Loading reactions...",
  "تعذر تحميل التفاعلات": "Could not load reactions", "لا توجد تفاعلات على هذا المنشور بعد": "No reactions on this post yet", "عرض من تفاعلوا مع المنشور": "See who reacted to this post",
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
  "🛡️ الحماية مفعّلة!": "🛡️ Protection is on!",
  "أنت الآن محمي من الرسائل غير المرغوب فيها. تم إيقاف الرسائل المزعجة من المستخدمين غير المرغوب بهم لتستمتع بتجربة أكثر راحة وهدوء داخل دردشتي.": "You are now protected from unwanted messages. Spam from unwanted users has been blocked so you can enjoy a calmer, more comfortable experience.",
  "لا يوجد رسائل خاصة بعد": "No private messages yet", "لا يوجد إشعارات بعد": "No notifications yet", "لا توجد هدايا بعد": "No gifts yet",
  "إلغاء الطرد": "Remove kick", "أنت هنا": "You are here", "بحث عن غرف": "Search rooms", "بحث عن مستخدمين": "Search users", "ابحث عن غرفك": "Search rooms",
  "رسالة عامة": "Public message", "رسالة": "Message", "اكتب حالتك...": "Write your status...", "الأسم المستعار": "Display name", "اسم المستعار": "Display name",
  "الرقم السري": "Password", "العمر": "Age", "كلمة المرور": "Password", "موضوع الشكوى": "Complaint subject", "اكتب شكواك هنا...": "Write your complaint here...",
  "جاري تحميل قائمة الغرف...": "Loading rooms...", "الرسائل": "Messages", "معلومات": "Information", "الإبلاغ": "Report", "إرسل ترقية": "Send upgrade", "إرسل هدية": "Send gift", "ارسل ترقية": "Send upgrade",
  "دردشة": "Chat", "يتم عرض الهدايا التي يتلقاها هذا المستخدم هنا": "Gifts received by this user appear here", "أظهر المزيد": "Show more",
  "تنفيذ وحفظ": "Save changes", "البريد الالكتروني": "Email", "الدولة / بلدة": "Country / City", "النبذة": "Bio", "حفظ": "Save",
  "تلقائي": "Automatic", "قائمة التجاهل": "Ignore list", "إعدادات الإشعارات": "Notification settings",
  "إشعارات سطح المكتب": "Desktop notifications",
  "تم تفعيل إشعارات سطح المكتب 🔔": "Desktop notifications enabled 🔔",
  "متصفحك لا يدعم إشعارات سطح المكتب": "Your browser does not support desktop notifications",
  "الإشعارات محظورة — اسمح بها من إعدادات المتصفح": "Notifications are blocked — allow them from your browser settings",
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
,
  "الدردشة العربية": "Live Chat",
  "بدء بث فيديو": "Start video broadcast",
  "سيبدأ بث فيديو مباشر في هذه الغرفة، ويمكن لأعضاء الغرفة طلب مشاهدته.": "A live video broadcast will start in this room, and room members can request to watch it.",
  "بدء البث": "Start broadcast",
  "سيصل طلب مشاهدة البث لهذا المذيع تحديداً، ولن تشاهد بثه إلا إن وافق عليه. وإن كنت تشاهد مذيعاً آخر أو تبث بنفسك، فكل شيء يستمر بشكل طبيعي — البثوث تعمل معاً في نفس الوقت.": "Your viewing request goes to that specific broadcaster; you'll only watch their stream if they approve. If you're watching another broadcaster or broadcasting yourself, everything continues normally — broadcasts work simultaneously.",
  "مشاهدة البث": "Watch broadcast",
  "0 مشاهد": "0 viewers",
  "مباشر": "Live",
  "بانتظار موافقة أحد المذيعين على مشاهدة البث…": "Waiting for one of the broadcasters to approve watching the broadcast…",
  "إنهاء البث": "End broadcast",
  "مغادرة المشاهدة": "Leave viewing",
  "ع": "F",
  "يُستخدم للتفعيل والمتابعة — يجب أن يكون Gmail (ينتهي بـ @gmail.com)": "Used for activation and follow-up — must be a Gmail address (ending in @gmail.com)",
  "تفعيل الحساب": "Activate account",
  "أرسلنا رمز تفعيل مكونًا من 6 أرقام إلى جيميلك:": "We sent a 6-digit activation code to your Gmail:",
  "إعادة إرسال الرمز": "Resend code",
  "تغيير البريد": "Change email",
  "لا يصلك الرمز؟ تحقق من مجلد الرسائل غير المرغوبة (Spam). الرمز صالح لمدة 10 دقائق.": "Didn't receive the code? Check the spam folder. The code is valid for 10 minutes.",
  "عرض الحالة": "View status",
  "كشف نكات": "Joke reveal",
  "كشف النكات": "Reveal the prank",
  "صورة المستخدم": "User photo",
  "التكلفة الإجمالية :": "Total cost:",
  "ترقية الحساب الآن": "Upgrade account now",
  "لوحة التحكم الإدارية": "Admin control panel",
  "مكالمة صوتية خاصة واردة...": "Incoming private voice call...",
  "رد": "Answer",
  "رفض": "Decline",
  "جاري الاتصال...": "Calling...",
  "سبيكر": "Speaker",
  "كتم": "Mute",
  "إنهاء": "End",
  "أغلق الكاميرا": "Turn camera off",
  "الجودة: -": "Quality: -",
  "الكاميرا": "Camera",
  "المكالمة بالسماعة جارية • انقر لإضاءة الشاشة": "Call is playing on speaker • tap to turn on screen",
  "بدء مكالمة صوتية": "Start voice call",
  "متابعة": "Continue",
  "هدية": "Gift",
  "الدخول الملكي 👑": "Royal Entry 👑",
  "مرفوعاتي": "My uploads",
  "الحساب": "Account",
  "تغيير كلمة المرور": "Change password",
  "لحسابك المسجل — أدخل كلمة المرور الحالية ثم الجديدة": "For your registered account — enter the current password then the new one",
  "منشور جديد": "New post",
  "بحث": "Search",
  "جاري تحميل المنشورات...": "Loading posts...",
  "عرض الوسائط": "View media",
  "جارٍ تجهيز الوسائط...": "Preparing media...",
  "تعذر تشغيل الفيديو داخل المتصفح": "Could not play the video in the browser",
  "قد يكون ترميز الملف غير مدعوم. يمكنك فتح الملف الأصلي من الزر بالأسفل.": "The file encoding may not be supported. You can open the original file from the button below.",
  "انقر تشغيل لبدء المشاهدة": "Click play to start watching",
  "فتح الملف الأصلي": "Open original file",
  "، وتستطيع الإدارة تحديد مقدار الذهب النهائي عند الموافقة": ", and administration sets the final gold amount upon approval",
  "شارة التاج الملكي": "Royal crown badge",
  "تاج ذهبي مميز يظهر بجوار اسمك أينما ظهر (الرسائل، المتصلين، الملف الشخصي)": "A distinctive golden crown appears next to your name wherever you appear (messages, contacts, profile)",
  "توهج ملكي عند دخول الغرف": "Royal glow when entering rooms",
  "عند دخولك أي غرفة يظهر توهج ملكي ذهبي احترافي مع التاج وإشعار الترحيب الملكي للجميع": "When you enter any room, a professional golden royal glow appears with the crown and a royal welcome notification for everyone",
  "تميز دائم": "Permanent distinction",
  "شارة ملكية لا تُزال — تميّزك في المقدمة دائماً": "A permanent royal badge — keeps you at the front always",
  "اختر حيوانك الملكي": "Choose your royal animal",
  "التكلفة": "Cost",
  "لن يتم خصم أي ذهب عند إرسال الطلب. يصل طلبك إلى لوحة الإدارة، وبعد المراجعة توافق الإدارة أو ترفضه، وسيصلك إشعار بالنتيجة.": "No gold is deducted when sending the request. Your request reaches the admin panel, and after review the admin approves or rejects it, and you'll get a notification with the result.",
  "طلب الدخول الملكي": "Request royal entry",
  "لديك الدخول الملكي": "You have royal entry",
  "تغيير الحيوان الملكي": "Change royal animal",
  "باقة الذهب": "Gold package",
  "100 ذهب 🪙": "100 Gold 🪙",
  "الإيداع على حساب الدردشة المعتمد:": "Deposit to the approved chat account:",
  "البنك التجاري": "Commercial Bank",
  "تاريخ الانتهاء:": "Expiry date:",
  "تأكيد الخصم والدفع (": "Confirm deduction and payment (",
  "طريقة دخول الغرفة": "Room entry method",
  "اختر طريقة دخولك إلى غرفة": "Choose how you enter a room",
  "دخول ظاهر": "Visible entry",
  "دخول مخفي": "Hidden entry",
  "بث مباشر نشط": "Active broadcast",
  "لا يمكنك مغادرة الغرفة وأنت تقوم بالبث المباشر.": "You cannot leave the room while broadcasting live.",
  "البقاء في الغرفة": "Stay in room",
  "إيقاف البث والخروج": "Stop broadcast and exit",
  "تحديث الصفحة": "Refresh page",
  "هل تريد مغادرة الدردشة؟": "Do you want to leave the chat?",
  "أنت متواجد في غرفة. يمكنك البقاء، أو الخروج وتحديث الصفحة وإعادة الدخول.": "You are in a room. You can stay, or exit and refresh the page to re-enter.",
  "البقاء": "Stay",
  "الخروج وتحديث الصفحة": "Exit and refresh page",
  "غرفة «": "Room «",
  "» محمية بكلمة مرور.": "» is password protected.",
  "إرفاق صورة (دليل) — اختياري": "Attach an image (evidence) — optional",
  "استعادة كلمة المرور": "Recover password",
  "أدخل بريدك المسجل وسنرسل لك رمز استعادة من 6 أرقام": "Enter your registered email and we'll send you a 6-digit recovery code",
  "إرسال الرمز": "Send code",
  "فحص الملف قبل الإرسال": "Check the file before sending",
  "جارٍ فحص الملف...": "Checking the file...",
  "إرسال إلى العام": "Send to public",
  "تسجيل مقطع صوتي": "Record audio",
  "جارٍ التسجيل...": "Recording...",
  "إيقاف ومعاينة": "Stop and preview",
  "معاينة المقطع قبل الإرسال": "Preview the clip before sending",
  "استمع إلى المقطع ثم أرسله أو احذفه": "Listen to the clip then send or delete it",
  "الرسالة طويلة": "Message is too long",
  "يجب أن تكون الرسالة": "The message must be",
  "حرف أو أقل": "characters or fewer",
  "عدد الأحرف المكتوبة": "Number of typed characters",
  "العودة لتعديل الرسالة": "Back to edit the message",
  "لا تتحدث بسرعة": "Don't type too fast",
  "خذ استراحة قصيرة قبل إرسال الرسالة التالية": "Take a short break before sending the next message",
  "ثانية": "second(s)",
  "تم إيقاف الوصول": "Access has been blocked",
  "تم حظرك بسبب سلوكك السيئ": "You have been banned for your bad behavior",
  "لن تتمكن من دخول الدردشة من هذا الحساب أو الجهاز حتى تقوم الإدارة بفك الحظر.": "You won't be able to enter the chat from this account or device until the administration lifts the ban.",
  "سبب الحظر": "Ban reason",
  "سلوك سيئ داخل الدردشة": "Bad behavior in the chat",
  "الحظر مرتبط بالحساب والجهاز ويستمر عند تغيير عنوان IP": "The ban is tied to the account and device and persists if you change your IP address",
  "إعادة التحقق بعد فك الحظر": "Re-check after the ban is lifted",
  "جلسة جديدة": "New session",
  "تم الدخول بحسابك من جهاز آخر": "Your account was signed in from another device",
  "تم تسجيل الدخول إلى حسابك من جهاز آخر. لضمان أمان حسابك، تم إنهاء هذه الجلسة تلقائياً.": "Your account was signed in from another device. To keep your account safe, this session was closed automatically.",
  "إذا لم تكن أنت من قام بالدخول، غيّر كلمة المرور وعُد للدخول مجدداً.": "If that wasn't you, change your password and sign in again.",
  "العودة لتسجيل الدخول": "Back to sign in",
  "جارٍ التحميل...": "Loading...",
  "أدخل اسم المستخدم وكلمة المرور": "Enter username and password",
  "أدخل البريد الإلكتروني": "Enter your email",
  "أدخل بريداً Gmail صالحاً (ينتهي بـ @gmail.com)": "Enter a valid Gmail (ending in @gmail.com)",
  "أكمل الحقول المطلوبة للباقة": "Fill in the required fields for the package",
  "اسم المستخدم مطلوب": "Username is required",
  "البريد الإلكتروني إلزامي لإتمام التسجيل": "Email is required to register",
  "البريد الإلكتروني يجب أن يكون Gmail (ينتهي بـ @gmail.com)": "Email must be a Gmail (ending in @gmail.com)",
  "البريد غير صالح — يجب أن يكون Gmail": "Invalid email — must be Gmail",
  "الرمز يجب أن يتكون من 6 أرقام": "The code must be 6 digits",
  "الرمز غير صحيح — يجب أن يتكون من 6 أرقام": "Incorrect code — must be 6 digits",
  "انتهت صلاحية الرمز — أعد الإرسال برمز جديد": "Code expired — resend a new one",
  "تم تجاوز عدد المحاولات — أعد الإرسال برمز جديد": "Too many attempts — resend with a new code",
  "حسابك غير مفعّل بعد — يجب إدخال رمز التفعيل أولاً": "Account not activated — enter the activation code first",
  "يجب دخول الغرفة أولاً": "Join a room first",
  "يجب دخول الغرفة قبل الكتابة": "Join a room before writing",
  "اختر غرفة صحيحة": "Choose a valid room",
  "الغرفة غير موجودة": "Room not found",
  "الغرفة غير محددة": "Room not specified",
  "غرفة محذوفة": "Room deleted",
  "🔒 هذه الغرفة مغلقة حالياً من الإدارة": "This room is currently closed by the administration",
  "أنت مطرود من هذه الغرفة": "You are kicked from this room",
  "🚫 أنت مطرود من هذه الغرفة": "You are kicked from this room",
  "تم طردك من هذه الغرفة بواسطة الإدارة": "You were kicked from this room by the administration",
  "المستخدم لم يعد موجوداً في الغرفة": "The user is no longer in the room",
  "لا يمكنك الإشراف على مستخدم بصلاحية مساوية أو أعلى": "You can't moderate a user with equal or higher permissions",
  "أنت مكتوم ولا يمكنك الكتابة": "You are muted and cannot write",
  "أنت مكتوم ولا يمكنك الصعود كمذيع": "You are muted and cannot broadcast",
  "كتم من الإدارة": "Muted by the administration",
  "طرد من الغرفة": "Kicked from room",
  "أنت أحد المذيعين بالفعل": "You are already a broadcaster",
  "أنت تبث بالفعل في هذه الغرفة": "You are already broadcasting in this room",
  "لا يوجد بث صوتي حالياً في هذه الغرفة": "No audio broadcast right now",
  "لا يوجد بث فيديو حالياً في هذه الغرفة": "No video broadcast right now",
  "هذا المذيع لم يعد يبث حالياً": "This broadcaster is no longer live",
  "لا يمكنك مشاهدة بثك الشخصي": "You can't watch your own broadcast",
  "الميكروفونات ممتلئة الآن — لا يمكن الصعود كمذيع": "The mics are full now — you can't go on as broadcaster",
  "عضويتك غير مسموح لها بالصعود كمذيع": "Your membership doesn't allow broadcasting",
  "رصيد الذهب غير كافٍ لإتمام الترقية": "Insufficient gold to complete the upgrade",
  "رصيدك غير كافي": "Insufficient balance",
  "رصيد المستخدم لم يعد كافياً": "User balance is no longer sufficient",
  "هدية غير صالحة": "Invalid gift",
  "الهدية غير موجودة في هذا الحساب": "The gift doesn't exist in this account",
  "بعض الهدايا المحددة لا تنتمي لحسابك": "Some selected gifts don't belong to your account",
  "كمية غير صالحة": "Invalid quantity",
  "لا توجد هدايا يمكنك تحويلها": "No gifts you can convert",
  "ميزة تسكير الهدايا متاحة للفتيات فقط": "Gift conversion is available for girls only",
  "نظام تسكير الهدايا غير مفعّل حالياً": "Gift conversion is disabled",
  "📞 تم بدء مكالمة صوتية": "Voice call started",
  "📞 تم رفض المكالمة": "Call declined",
  "📞 تم رفض المكالمة (المستخدم مشغول)": "Call declined (user busy)",
  "📞 مكالمة صوتية فائتة": "Missed voice call",
  "📞 مكالمة صوتية مجانية منتهية • 01:00": "Free voice call ended • 01:00",
  "مكالمة فيديو خاصة": "Private video call",
  "مكالمة مفتوحة المدة": "Open-ended call",
  "انتهت الدقيقة المجانية التجريبية للمكالمة ⏱️": "The free trial call minute is over ⏱️",
  "انتهت الدقيقة المجانية التجريبية للمكالمة ⏱️ يمكنك إجراء مكالمات مفتوحة بتكلفة 2 ذهب": "The free trial call minute is over ⏱️ — you can make open calls for 2 Gold",
  "بدأت مكالمتك المجانية التجريبية الأولى (المدة: دقيقة واحدة) 🎁": "Your first free trial call started (duration: 1 minute) 🎁",
  "طلب التوثيق": "Verification request",
  "طلب تغيير الحيوان الملكي": "Royal animal change request",
  "طلب شراء الذهب": "Gold purchase request",
  "طلب الترقية": "Upgrade request",
  "حسابك موثق بالفعل ✓": "Your account is already verified ✓",
  "الحساب موثق بالفعل": "Account already verified",
  "رفضت الإدارة طلب التسكير": "Administration rejected the conversion request",
  "تم رفض الطلب من الإدارة": "Request rejected by the administration",
  "تمت معالجة هذا الطلب مسبقاً": "This request was already processed",
  "الطلب غير موجود أو تمت معالجته": "Request not found or already processed",
  "المنشور غير موجود": "Post not found",
  "تعذر حفظ الحالة": "Could not save status",
  "الحالة غير موجودة": "Status not found",
  "انتهت هذه الحالة أو حُذفت": "This status expired or was deleted",
  "الحالة الكتابية لا تحتاج ملفاً": "A text status doesn't need a file",
  "مشاهدو الحالة متاحون لصاحبها فقط": "Status viewers are available to the owner only",
  "نوع الحالة غير صالح": "Invalid status type",
  "حالة غير صالحة": "Invalid status",
  "اختر ملف الحالة أولاً": "Choose a status file first",
  "فيديو YouTube المختار غير صالح": "Selected YouTube video is invalid",
  "اكتب التعليق": "Write the comment",
  "تفاعل غير صالح": "Invalid reaction",
  "الملف غير صالح": "Invalid file",
  "حجم الملف أكبر من 50MB": "File size exceeds 50MB",
  "تعذر فحص الصورة أو أن الملف تالف": "Image check failed or file corrupted",
  "فشل فحص المقطع الصوتي أو أن الملف تالف": "Audio check failed or corrupted",
  "حدث خطأ، حاول مرة أخرى": "An error occurred, try again",
  "خطأ غير معروف": "Unknown error",
  "خطأ في النظام": "System error",
  "رابط غير صالح": "Invalid link",
  "الإشعار غير موجود": "Notification not found",
  "تعذر الوصول إلى الدردشة": "Could not access the chat",
  "نبذة صوتية": "Voice bio",
  "لا توجد نبذة صوتية بعد": "No voice bio yet",
  "تسجيل": "Record",
  "رفع ملف": "Upload file",
  "إيقاف": "Stop",
  "تشغيل": "Play",
  "حذف": "Delete",
  "هل تريد حذف النبذة الصوتية؟": "Do you want to delete the voice bio?",
  "تم حذف النبذة الصوتية": "Voice bio deleted",
  "تم حفظ النبذة الصوتية ✅": "Voice bio saved ✅",
  "تعذر رفع النبذة الصوتية": "Could not upload the voice bio",
  "تعذر حفظ النبذة الصوتية": "Could not save the voice bio",
  "تعذر التسجيل الصوتي": "Could not record audio",
  "تعذر الوصول إلى الميكروفون، تحقق من الإذن": "Could not access the microphone, check your permission",

  "نجوم العرب": "Stars Arabs",
  "الكمية:": "The quantity:",
  "اليوم الساعة": "Today hour",
  "أمس الساعة": "Yesterday hour",
  "تم كتم": "Was mute",
  "تم إلغاء كتم": "Was cancel mute",
  "تم طرد": "Was kick",
  "تم حظر": "Was ban",
  "تم تجاهل": "Was ignore",
  "مرحبا بك": "Hello you",
  "رصيد:": "Balance:",
  "حسب عنوان IP": "By title IP",
  "من الغرفة": "From the room",
  "الدردشة المباشرة": "The chat the directly",
  "جارٍ إنشاء الحساب...": "Loading creating the account...",
  "جارٍ تسجيل الدخول...": "Loading registration the login...",
  "جارٍ الدخول كزائر...": "Loading the login as visitor...",
  "جارٍ تفعيل الحساب...": "Loading activation the account...",
  "جارٍ إرسال رمز جديد...": "Loading send code new...",
  "جارٍ إرسال رمز الاستعادة...": "Loading send code the recovery...",
  "جارٍ تحميل الغرفة...": "Loading loading the room...",
  "جارٍ فتح الغرفة...": "Loading open the room...",
  "جارٍ تحميل الحالات...": "Loading loading the statuses...",
  "جارٍ تحميل الإشعارات...": "Loading loading the notifications...",
  "جارٍ تحميل الدخول الملكي...": "Loading loading royal entrance...",
  "جارٍ تحميل باقات الذهب...": "Loading loading packages the gold...",
  "جارٍ تحميل الصور...": "Loading loading the photos...",
  "جارٍ تجهيز الحائط...": "Loading preparing the wall...",
  "جارٍ الاتصال بالدردشة...": "Loading the connection chat...",
  "جارٍ تنفيذ الطلب...": "Loading execute the request...",
  "تعذر رفع الملف": "Failed to upload the file",
  "تعذر الاتصال أثناء رفع الملف": "Failed to the connection during upload the file",
  "انتهت مهلة رفع الملف": "Ended timeout upload the file",
  "تم إلغاء رفع الملف": "Was cancel upload the file",
  "(رسالة خاصة) |": "(private message)|",
  "ميكروفون": "Microphone",
  "يستقبله الطرف الآخر كـ": "Receives it the party the last as",
  "أحادية الاتجاه: لا يصلني منه شيء (إن كان يبث وأريد مشاهدته فذلك اتصال": "One-way the direction: no reaches me from him thing(if was broadcasts and I want watching it that is connection",
  "⇐ أستقبله": "⇐ I receive it",
  "، و": "، و",
  "يبقى": "Remains",
  "📷 صورة": "📷 photo",
  "🎤 رسالة صوتية": "🎤 message voice",
  "مستخدم": "User",
  "الآن": "The now",
  "📩 رسالة جديدة": "📩 message new",
  "لديك إشعار جديد": "You have notification new",
  "الدردشة": "The chat",
  "غرفة مستخدمين": "Room users",
  "🔒 هذه الغرفة مغلقة حالياً": "🔒 this room is closed currently",
  "تم الدخول إلى الغرفة بشكل مخفي": "Was the login to the room in a hidden",
  "👤 هذه الغرفة للأعضاء المسجلين فقط": "👤 this the room members the registered only",
  "تعذر الدخول للغرفة": "Failed to the login room",
  "تعذر تشغيل المقطع الصوتي": "Failed to run the clip the audio",
  "نص رسالة الروبوت": "Text message the bot",
  "اللون": "The color",
  "حجم الخط": "Size the font",
  "اكتب نص رسالة الروبوت": "Type text message the bot",
  "تم تعديل رسالة الروبوت ✅": "Was edit message the bot ✅",
  "تعذر تعديل الرسالة": "Failed to edit the message",
  "موضع المقطع": "Position the clip",
  "شهر واحد": "Month one",
  "شهرين": "Two months",
  "شات الاردن": "Chat the Jordan",
  "عضو": "Member",
  "(متجاهل)": "(ignored)",
  "انتهت هذه الحالة": "Ended this the status",
  "تعذر فتح الحالة": "Failed to open the status",
  "حساب إداري": "Admin account",
  "الصورة": "The photo",
  "ومنع الرسائل الخاصة بينكما": "And block private messages between you two",
  "تم إلغاء تجاهل": "Was cancel ignore",
  "تعذر تحديث قائمة التجاهل": "Failed to update list the ignore",
  "لا تملك صلاحية سحب المايك": "You are not allowed to withdraw the mic",
  "تم سحب المايك من": "Was withdraw the mic from",
  "تعذر سحب المايك": "Failed to withdraw the mic",
  "لا تملك صلاحية سحب المايك مع المنع": "You are not allowed to withdraw the mic with the prevent",
  "ومنع صعوده للبث": "And block his joining broadcast",
  "تعذر تنفيذ الإجراء": "Failed to execute the action",
  "لا تملك صلاحية فك المنع": "You are not allowed to lift the prevent",
  "سمحت لـ": "Allowed to",
  "بالصعود إلى البث": "Joining to the broadcast",
  "لا تملك صلاحية الكتم": "You are not allowed to the mute",
  "تعذر تغيير حالة الكتم": "Failed to change status the mute",
  "لا تملك صلاحية الطرد": "You are not allowed to the kick",
  "تعذر طرد المستخدم": "Failed to kick the user",
  "لا تملك صلاحية الحظر": "You are not allowed to the ban",
  "على الحساب والجهاز": "On the account device",
  "غير معروف": "Not known",
  "متصل الآن": "Connected the now",
  "غير متصل": "Not connected",
  "،": "،",
  "كشف النكات متاح للإدارة العامة فقط": "Reveal the nicknames available administration the public only",
  "تعذر كشف النكات": "Failed to reveal the nicknames",
  "تعذر الإرسال": "Failed to the send",
  "تعذر إتمام الترقية": "Failed to completion the upgrade",
  "قطر": "Qatar",
  "البحرين": "The Bahrain",
  "سلطنة عمان": "Sultanate Oman",
  "سوريا": "Syria",
  "لبنان": "Lebanon",
  "الجزائر": "The Algeria",
  "المغرب": "The Morocco",
  "تونس": "Tunisia",
  "ليبيا": "Libya",
  "اليمن": "The Yemen",
  "السودان": "The Sudan",
  "تعذر فتح الملف الشخصي": "Failed to open the file the personal",
  "لا يوجد نبذة": "There are no bio",
  "إبلاغ عن": "Report about",
  "إلغاء تجاهل": "Cancel ignore",
  "تمت الإضافة لقائمة التجاهل 🚫": "Was the add to the list the ignore 🚫",
  "تم إلغاء التجاهل": "Was cancel the ignore",
  "مخفي 🔒": "Hidden 🔒",
  "تعذر الحذف": "Failed to deleted",
  "المتصفح لا يدعم التسجيل الصوتي": "The browser no supports the registration the audio",
  "تعذر الحفظ": "Failed to the save",
  "حذف المحادثة": "Delete the conversation",
  "تم حذف المحادثة ✅": "Was delete the conversation ✅",
  "تعذر حذف المحادثة": "Failed to delete the conversation",
  "لا يمكن فتح الخاص مع مستخدم متجاهَل": "Cannot open the private with user ignored",
  "المحادثة الخاصة غير متاحة": "The private chat not available",
  "تم بدء مكالمة": "Was start call",
  "بدء": "Start",
  "فائتة": "Missed",
  "منتهية": "Finished",
  "انقطعت": "Disconnected",
  "المدة": "The duration",
  "كاميرا مطفأة": "Camera off",
  "عضويتك غير مسموح لها بإجراء مكالمات الفيديو الخاصة": "Your membership not allowed it making calls the video the private",
  "تأكيد بدء مكالمة الفيديو 📹": "Confirm start call the video 📹",
  "فيديو (غير محدود)": "Video(not limited)",
  "متصفحك لا يدعم المكالمات الخاصة": "Your browser no supports the calls the private",
  "تعذر الوصول إلى الكاميرا/الميكروفون:": "Failed to the access to the camera/the microphone:",
  "يرجى منح الإذن": "Please grant the permission",
  "تعذر الوصول إلى الميكروفون:": "Failed to the access to the microphone:",
  "جاري التوصيل...": "The connecting...",
  "ضعف في الاتصال...": "Weak in the connection...",
  "مكالمة فيديو جارية": "Video call ongoing",
  "تم إيقاف الكاميرا": "Was stop the camera",
  "تم تشغيل الكاميرا": "Was run the camera",
  "الجودة: 360p (ثابتة)": "The quality: 360p(fixed)",
  "انقر لتصغير صورك • اسحبه للتحريك": "Click to shrink your photos• drag it move",
  "انقر لتكبير صورك • اسحبه للتحريك": "Click to zoom your photos• drag it move",
  "انقر لتكبير صوره • اسحبه للتحريك": "Click to zoom his photo• drag it move",
  "انقر لتصغير صوره": "Click to shrink his photo",
  "تم رفض المكالمة": "Was reject the call",
  "المستخدم مشغول في مكالمة أخرى": "The user busy in call other",
  "المستخدم غير متصل حالياً": "The user not connected currently",
  "لا يمكن الاتصال بسبب التجاهل": "Cannot the connection because of the ignore",
  "عضويتك غير مسموح لها بالمكالمات الخاصة": "Your membership not allowed it calls the private",
  "تم إلغاء المكالمة من الطرف الآخر": "Was cancel the call from the party the last",
  "تم إنهاء المكالمة": "Was end the call",
  "انقطع اتصال الطرف الآخر": "Disconnected connection the party the last",
  "مكتوم": "Muted",
  "تم كتم الميكروفون": "Was mute the microphone",
  "تم تشغيل الميكروفون": "Was run the microphone",
  "سبيكر (مفعل)": "Speaker(enabled)",
  "مكبر": "Amplified",
  "🔊 تم تشغيل مكبر الصوت (السبيكر)": "🔊 was run amplified the voice(the speaker)",
  "سماعة الأذن": "Earpiece the ear",
  "أذن": "Ear",
  "📱 تم التحويل إلى سماعة الأذن الداخلية": "📱 was the transfer to earpiece the ear the internal",
  "مكالمة جارية": "Call ongoing",
  "مكالمة فيديو خاصة واردة...": "Video call private incoming...",
  "عضويتك غير مسموح لها بإرسال الرسائل الخاصة": "Your membership not allowed it sending private messages",
  "عضويتك غير مسموح لها بنشر الحالات": "Your membership not allowed it publishing the statuses",
  "جاري نشر الحالة...": "Publish the status...",
  "جاري رفع الحالة...": "Upload the status...",
  "تم نشر حالتك لمدة 24 ساعة ✓": "Was publish your status for 24 hour ✓",
  "تعذر نشر الحالة": "Failed to publish the status",
  "نوع الملف لا يطابق نوع الحالة المختار": "Type the file no matches type the status the chosen",
  "اكتب نص الحالة أولاً": "Type text the status first",
  "لا يمكن عرض المشاهدين": "Cannot display the viewers",
  "تم حذف الحالة": "Was delete the status",
  "تعذر حذف الحالة": "Failed to delete the status",
  "حساب PayPal": "Account PayPal",
  "حساب بنكي": "Account bank",
  "تعذر التحويل الآلي": "Automatic transfer failed",
  "جارٍ التحويل تلقائيًا إلى حسابك 💸": "Transferring automatically to your account 💸",
  "قيد المراجعة من الإدارة": "Under review from the administration",
  "تم التحويل بنجاح": "Transfer completed successfully",
  "تم إرسال الدفعة (قد تكون قيد المعالجة)": "Was send the payment(may be under the processing)",
  "لم تستلمي هدايا بعد — استقبلي الهدايا أولاً": "Did not you receive gifts after — receive the gifts first",
  "— غير متاح حاليًا": "— not available currently",
  "بريد حساب PayPal الذي ستستلمين عليه المبلغ": "Email account PayPal the the you will receive it the amount",
  "رقم الحساب البنكي / رقم البطاقة (8-19 رقمًا)": "Number the account the bank / number the card(8-19 digits)",
  "اسم صاحب الحساب": "Name owner the account",
  "أدخلي بريدك الإلكتروني المرتبط بحساب PayPal بشكل صحيح": "Enter your email the electronic the linked to account PayPal in a correct",
  "رقم الحساب غير صحيح — يجب أن يتكون من 8 إلى 19 رقمًا": "Number the account not correct — must that consists from 8 to 19 digits",
  "حددي كمية الهدايا المراد تسكيرها أولاً": "Specify quantity the gifts the intended cashing them first",
  "تم إرسال طلب التسكير ✓ سيصلك إشعار فور اتمام التحويل": "Was send request the cashing out ✓ you will receive notification immediately completion the transfer",
  "تعذر إلغاء التجاهل": "Failed to cancel the ignore",
  "ليس لديك صلاحية دخول لوحة الإدارة": "Not you have permission login the admin panel",
  "جاري تأمين وفتح لوحة الإدارة بالرمز السري...": "Securing and open the admin panel code the secret...",
  "تعذر توليد رابط الإدارة": "Failed to generation link the administration",
  "تعذر فتح لوحة الإدارة": "Failed to open the admin panel",
  "تم تغيير الحالة إلى": "Was change the status to",
  "تم إرسال طلب التوثيق إلى لوحة الإدارة ✓ ولن يتم الخصم إلا بعد الموافقة": "Was send request the verification to the admin panel ✓ and will not is done the deduction except after the approval",
  "الأسد الملكي": "The lion the royal",
  "يدخل كالأسد الهادر — قوة ومهابة": "Enters lion the roaring — power and majesty",
  "الحوت الملكي": "The whale the royal",
  "يبحر في الغرفة بهدوء الملوك — عمق وهدوء": "Sails in the room calmly the kings — depth and calm",
  "العقاب الملكي": "The eagle the royal",
  "يحلّق فوق الجميع — حرية وقوة": "Soars above the all — freedom and power",
  "الوحيد قرن": "The unicorn horn",
  "يسطع قوس قزح أينما دخل — تميز فريد": "Shines rainbow rainbow wherever entered — distinction unique",
  "الفراشة الملكية": "The butterfly the ownership",
  "ترفرف بألوانها أينما دخلت — رقيّ وأنوثة": "Flutters with its colors wherever entered — elegance and femininity",
  "القطة الملكية": "The cat the ownership",
  "دخول لطيف يخطف القلوب — نعومة ودلال": "Login cute steals hearts the hearts — softness and charm",
  "الوردة الحمراء": "The rose the red",
  "تدخل كوردة حمراء فاخرة — جمال ملكي": "Enter as a rose red luxurious — beauty royal",
  "الوردة المتفتحة": "The rose the blooming",
  "تتفتّح الغرفة بجمالها — سحر وأنوثة": "Blooms the room with her beauty — charm and femininity",
  "الوردة الوردية": "The rose the pink",
  "وردة وردية ناعمة — دخول ملكي للبنات": "Rose pink soft — login royal girls",
  "دخول ملكي مميز — حضور يليق بك": "Login royal premium — presence befits you",
  "دخول ملكي": "Login royal",
  "✋ طلبك لتغيير الحيوان الملكي قيد المراجعة لدى الإدارة — سيصلك إشعار بنتيجة الموافقة.": "✋ your request to change royal animal under review at the administration — you will receive notification with the result the approval.",
  "تعذر إرسال طلب التغيير": "Failed to send request the change",
  "البنك التجاري المعتمد": "The bank the commercial the verified",
  "الأكثر طلباً": "The more requested",
  "لا توجد باقات متاحة حالياً": "There are no packages available currently",
  "يجب تسجيل الدخول بحساب مسجل لإتمام عملية الشراء": "Must registration the login to account registered to complete operation the purchase",
  "تعذر إنشاء العملية": "Failed to creating the operation",
  "الحساب التجاري مقيد لدى PayPal ولا يستطيع قبول الدفعات — يرجى حل القيد من حساب PayPal (تفعيل الحساب وإكمال بيانات العمل) أو استخدام وضع «تجريبي» بحساب Business مُفعّل.": "The account the commercial restricted at PayPal or nor can accept the payments — please resolve the under from account PayPal(activation the account and complete data the business) or use mode«demo» to account Business activated.",
  "حدث خطأ أثناء الدفع —": "Occurred error during the payment —",
  "لم تنجح العملية —": "Did not succeeds the operation —",
  "حاول مجدداً.": "Try again.",
  "ألغيت عملية الدفع — لم يُخصم أي مبلغ": "Canceled operation the payment — did not is deducted any amount",
  "جاري تحميل بوابة الدفع الآمن...": "Loading gateway the payment the safe...",
  "الملف يجب أن يكون صورة": "The file must that be photo",
  "حجم الصورة يجب ألا يتجاوز 8MB": "Size the photo must not exceeds 8MB",
  "تعذر رفع الصورة المرفقة": "Failed to upload the photo the attached",
  "تم إرسال الشكوى إلى الإدارة": "Was send the complaint to the administration",
  "تعذر إرسال الشكوى": "Failed to send the complaint",
  "لا توجد صور مرفوعة بعد": "There are no photos uploaded after",
  "اضغط على \"رفع صورة\" بالأسفل (يتم حفظ حتى 10 صور)": "Press on \"upload photo\" bottom(is done save until 10 photos)",
  "جاري رفع الصورة الشخصية...": "Upload the photo the personal...",
  "تم رفع الصورة وحفظها في قائمة مرفوعاتي ✅": "Was upload the photo and save it in list my uploads ✅",
  "تعذر رفع الصورة": "Failed to upload the photo",
  "تم حفظ الصورة بنجاح ✅": "Was save the photo successfully ✅",
  "تعذر حفظ الصورة": "Failed to save the photo",
  "فيديو YouTube": "Video YouTube",
  "اضغط للمشاهدة في العارض الكامل": "Press view in the viewer the full",
  "فيديو مرفوع": "Video uploaded",
  "اضغط لتشغيل الفيديو كاملاً": "Press to play the video fully",
  "اضغط لعرض الصورة كاملة": "Press to display the photo full",
  "يمكنك تكبير الصورة من المتصفح": "You can zoom the photo from the browser",
  "استخدم أزرار المشغل للتحكم بالصوت والمشاهدة": "Use buttons the player control voice view",
  "فتح في YouTube": "Open in YouTube",
  "فتح الصورة الأصلية": "Open the photo the original",
  "فتح الفيديو الأصلي": "Open the video the original",
  "عضويتك غير مسموح لها بالنشر على الحائط": "Your membership not allowed it publish on the wall",
  "اكتب كلمات البحث في YouTube": "Type words the search in YouTube",
  "تعذر البحث في YouTube": "Failed to the search in YouTube",
  "جاري رفع الصورة...": "Upload the photo...",
  "جاري رفع صورة الحائط...": "Upload photo the wall...",
  "تم رفع الصورة بنجاح": "Was upload the photo successfully",
  "جاري رفع الفيديو...": "Upload the video...",
  "جاري رفع فيديو الحائط...": "Upload video the wall...",
  "جاري تجهيز صورة معاينة الفيديو...": "Preparing photo preview the video...",
  "تم رفع الفيديو وتجهيز صورة المعاينة بنجاح": "Was upload the video and prepare photo the preview successfully",
  "تم رفع الفيديو بنجاح": "Was upload the video successfully",
  "تعذر رفع الفيديو": "Failed to upload the video",
  "جاري نشر المنشور على الحائط...": "Publish the post on the wall...",
  "تم نشر المنشور": "Was publish the post",
  "تعذر نشر المنشور": "Failed to publish the post",
  "لا توجد إشعارات لحذفها": "There are no notifications to delete them",
  "تم حذف جميع الإشعارات بنجاح ✓": "Was delete all the notifications successfully ✓",
  "تعذر حذف الإشعارات": "Failed to delete the notifications",
  "أدخل البريد الإلكتروني المسجل": "Enter the email address the registered",
  "📧 تم إرسال رمز الاستعادة إلى بريدك": "📧 was send code the recovery to your email",
  "تعذر إرسال الرمز": "Failed to send the code",
  "📧 أُعيد إرسال الرمز": "📧 resent send the code",
  "تعذر إعادة الإرسال": "Failed to re- the send",
  "إعادة الإرسال (": "Re- the send(",
  "ث)": "Sec)",
  "أدخل رمز الاستعادة المكون من 6 أرقام": "Enter code the recovery the composed of from 6 digits",
  "كلمة المرور الجديدة 4 خانات على الأقل": "The new password 4 characters on the less",
  "كلمتا المرور غير متطابقتين": "Passwords do not match",
  "✅ تم تغيير كلمة المرور — ادخل الآن بكلمة المرور الجديدة": "✅ was change password — enter the now withthe new password",
  "تعذر تغيير كلمة المرور": "Failed to change password",
  "؟": "؟",
  "فشل الدخول": "Failure the login",
  "ضيف": "Guest",
  "نجم": "Star",
  "عاشق": "Lover",
  "مغامر": "Adventurer",
  "همس": "Whisper",
  "شهم": "Brave",
  "ذوق": "Tasteful",
  "أهلا بك كزائر": "Welcome you as visitor",
  "⚠️ خدمة البريد (SMTP) غير مفعّلة من لوحة الإدارة — لم يُرسل الرمز بعد": "⚠️ the email service(SMTP) is not enabled from the admin panel — did not is sent the code after",
  "⚠️ تعذر إرسال البريد:": "⚠️ failed to send the email:",
  "جارٍ تجهيز قالب رمز التفعيل...": "Loading preparing template code the activation...",
  "أدخل رمز التفعيل المكوّن من 6 أرقام": "Enter code the activation the composed from 6 digits",
  "تم تفعيل حسابك بنجاح 🎉": "Was activation your account successfully 🎉",
  "تعذر التفعيل — تحقق من الرمز": "Failed to the activation — check from the code",
  "يرجى الانتظار قبل إعادة الإرسال": "Please the waiting before re- the send",
  "تم إرسال رمز جديد إلى جيميلك 📧": "Was send code new to your Gmail 📧",
  "⚠️ خدمة البريد غير مفعّلة — لم يُرسل الرمز": "⚠️ the email service is not enabled — did not is sent the code",
  "البريد يجب أن يكون Gmail (ينتهي بـ @gmail.com)": "The email must that be Gmail(ends with @gmail.com)",
  "فشل التسجيل": "Failure the registration",
  "إيقاف البث والمكالمة": "Stop the broadcast call",
  "إيقاف المكالمة": "Stop the call",
  "إيقاف البث": "Stop the broadcast",
  "إيقاف البث والمكالمة والمتابعة": "Stop the broadcast call continue",
  "لا يمكنك الانتقال إلى غرفة أخرى أثناء مكالمة جارية. يجب إغلاق المكالمة أولاً ثم يمكنك الدخول إلى الغرفة الأخرى.": "Cannotas the moving to room other during call ongoing. must close the call first then you can the login to the room the other.",
  "إيقاف المكالمة والمتابعة": "Stop the call continue",
  "لا يمكنك الانتقال إلى غرفة أخرى أثناء البث المباشر. يجب إغلاق البث أولاً ثم يمكنك الدخول إلى الغرفة الأخرى.": "Cannotas the moving to room other during live stream. must close the broadcast first then you can the login to the room the other.",
  "إيقاف البث والمتابعة": "Stop the broadcast continue",
  "— اضغط للتشغيل/الإيقاف": "— press run/the stop",
  "اضغط زر الراديو مرة أخرى للاستماع": "Press button the radio time other listen",
  "تم حذف «العام» لديك فقط — يبقى ظاهراً لبقية المستخدمين": "Was delete«the public» you have only — remains visible for rest the users",
  "تعذر حذف «العام»": "Failed to delete«the public»",
  "السوبر أدمن": "The super admin",
  "تم حذف «العام» من الغرفة بالكامل 🧹 بواسطة": "Was delete«the public» from the room full 🧹 by",
  "تعذر حذف «العام» للجميع": "Failed to delete«the public» all",
  "اكتب كلمة المرور الحالية": "Type password the current",
  "كلمة المرور الجديدة يجب أن لا تقل عن 4 خانات": "The new password must that no less than about 4 characters",
  "تم تغيير كلمة المرور بنجاح ✅": "Was change password successfully ✅",
  "تم تغيير اللغة": "Was change the language",
  "عضويتك غير مسموح لها بإرسال الرسائل في العام": "Your membership not allowed it sending the messages in the public",
  "اختر مستخدماً أولاً": "Choose as user first",
  "تم تغيير لون خطك 🎨": "Was change color your font 🎨",
  "رجع لون خطك للون رتبتك": "Reverted color your font color your rank",
  "جاري رفع المقطع الصوتي...": "Upload the clip the audio...",
  "جاري رفع الصورة إلى العام...": "Upload the photo to the public...",
  "جاري رفع الصورة إلى الخاص...": "Upload the photo to the private...",
  "فحص الصورة قبل الإرسال": "Check the photo before the send",
  "فحص المقطع الصوتي قبل الإرسال": "Check the clip the audio before the send",
  "تعذر فحص الملف أو أن تنسيقه غير مدعوم": "Failed to check the file or that its format not supported",
  "تم فحص الصورة ويمكن إرسالها": "Was check the photo and you can sending it",
  "تم فحص المقطع ويمكن إرساله": "Was check the clip and you can sending it",
  "اختر عضواً أولاً": "Choose a member first",
  "المحادثة الخاصة غير مفتوحة": "The private chat not open",
  "عضويتك غير مسموح لها بإرسال الصور في الخاص": "Your membership not allowed it sending the photos in the private",
  "عضويتك غير مسموح لها بإرسال الصور في العام": "Your membership not allowed it sending the photos in the public",
  "عضويتك غير مسموح لها بإرسال المقاطع الصوتية": "Your membership not allowed it sending the clips the voice",
  "تعذر إنشاء التسجيل الصوتي": "Failed to creating the registration the audio",
  "عضويتك غير مسموح لها بإرسال الرسائل الصوتية في الخاص": "Your membership not allowed it sending the messages the voice in the private",
  "اعدادات الخاص : استقبال الرسائل من الجميع": "Settings the private: receiving the messages from the all",
  "محاولة إعادة الاتصال رقم": "Attempt re- the connection number",
  "تمت إضافة": "Was add",
  "ذهب إلى رصيدك بواسطة الإدارة (الرصيد:": "Gold to your balance by the administration(the balance:",
  "تم تعديل رصيدك بواسطة الإدارة (الرصيد:": "Was edit your balance by the administration(the balance:",
  "تم تغيير اسم حسابك إلى:": "Was change name your account to:",
  "بنجاح ✨": "Successfully ✨",
  "تم حذف العام من قبل": "Was delete the public from before",
  "👑 مُنح لك الدخول الملكي بـ": "👑 granted for you royal entrance with",
  "! سيظهر توهجه عند دخولك الغرف": "! will appear its glow at your entry the rooms",
  "تم خصم": "Was deduction",
  "ذهب رسوم المكالمة (الرصيد:": "Gold fees the call(the balance:",
  "فتح الكاميرا 📷": "Open the camera 📷",
  "أغلق الكاميرا 📷": "Close the camera 📷",
  "وافق على مشاهدتك لبثه": "Approved on watching you to his stream",
  "آخرين": "Others",
  "يتحدث الآن مباشرة": "Is talking the now directly",
  "يبثون فيديو مباشر الآن — اضغط على صورة أحدهم للمشاهدة": "Are broadcasting video live the now — press on photo one of them view",
  "يبث فيديو مباشر الآن — اضغط على صورته للمشاهدة": "Broadcasts video live the now — press on his photo view",
  "مشاهد": "Viewers",
  "• تشاهد بث": "• watching broadcast",
  "• تشاهد": "• watching",
  "بثوث": "Broadcasts",
  "تشاهد": "Watching",
  "بثوث مباشرة": "Broadcasts directly",
  "(أنت)": "(you)",
  "يريد مشاهدة البث": "Wants view the broadcast",
  "قبول": "Accept",
  "يطلب الإذن للتحدث": "Requests the permission talk",
  "المتحدثون الحاليون": "The speakers the current",
  "تم إرسال طلب مشاهدة إلى": "Was send request view to",
  "— بانتظار موافقته…": "— awaiting his approval…",
  "— عند موافقته سيُعرض بثه بجانب البثوث الحالية": "— at his approval will be shown his stream beside the broadcasts the current",
  "نظام الطرد": "System the kick",
  "نظام الحظر": "System the ban",
  "أشهر": "Months",
  "شهراً": "Months",
  "نظام الترقية": "System the upgrade",
  "لمدة": "For",
  "تم اهداء": "Was gifting",
  "بواسطة": "By",
  "أرسل هذه الترقية إلى": "Send this the upgrade to",
  "قام": "Did",
  "بإرسال هدية": "Sending gift",
  "أرسل هذه الهدية إلى": "Send this the gift to",
  "الكمية ×": "The quantity ×",
  "👑 دخول ملكي •": "👑 login royal•",
  "👑 هدية ملكية •": "👑 gift ownership•",
  "عنوان IP:": "Title IP:",
  "الدولة:": "The country:",
  "عدد الأسماء من نفس الـ IP:": "Number of the names from same the IP:",
  "وقت الدخول:": "Time the login:",
  "تم إرسال": "Was send",
  "بنجاح 🎉": "Successfully 🎉",
  "تمت ترقية": "Was upgrade",
  "بنجاح 👑": "Successfully 👑",
  "رصيد الذهب غير كافٍ (المطلوب:": "Gold balance not sufficient(the required:",
  "الهدية من": "The gift from",
  "كمية:": "Quantity:",
  "سنة": "Year",
  "اسم المستخدم": "Username",
  "الجنس": "The gender",
  "الدولة": "The country",
  "العضوية": "The membership",
  "الرصيد": "The balance",
  "حذف المحادثة مع": "Delete the conversation with",
  "هل ترغب في بدء مكالمتك الصوتية التجريبية الأولى مع": "Do wish in start your call the voice the trial the first with",
  "هذه المكالمة مجانية بالكامل لأول دقيقة (60 ثانية).": "This the call free full for the first minute(60 second).",
  "يرجى شحن رصيدك لتتمكن من إجراء المكالمة.": "Please recharge your balance to be able from action the call.",
  "الميزة:": "The feature:",
  "مجانية بالكامل (0 ذهب)": "Free full(0 gold)",
  "سيتم خصم": "Will be deduction",
  "من رصيدك عند رد": "From your balance at reply",
  "على مكالمة الفيديو 📹": "On call the video 📹",
  "تم استهلاك التجربة المجانية مسبقاً. سيتم خصم": "Was used the trial the free previously. will be deduction",
  "على المكالمة.": "On the call.",
  "آخر تحديث": "Last update",
  "من:": "From:",
  "حالة التحويل": "Status the transfer",
  "(رقم الدفعة": "(number the payment",
  "تعذر الإرسال الآلي — لم تُحذف هداياك": "Failed to the send the automated — did not are deleted your gifts",
  "تسكير الهدايا": "Cashing out gifts",
  "هدايا محددة للتسكير": "Gifts specified cashing out",
  "ذهب الهدايا المحددة": "Gold the gifts the specified",
  "المبلغ الذي سيُحوَّل إلى حسابك": "The amount the the will be transferred to your account",
  "طريقة الاستلام": "Method the receiving",
  "مجموع ذهب هداياك": "Total gold your gifts",
  "🪙 والمتطلبات للتسكير": "🪙 requirements cashing out",
  "🪙 — ينقصك": "🪙 — you lack",
  "تسكير الهدايا إلى دولارات 💵": "Cashing out gifts to dollars 💵",
  "معدل التحويل:": "Rate the transfer:",
  "لكل": "Per",
  "— المبلغ يتناسب طردياً مع الكمية (يحدّده الإداري)": "— the amount is proportional proportionally with the quantity(determines it the admin)",
  "عدد الهدايا المستلمة": "Number of the gifts the received",
  "الحد الأدنى للتسكير": "The limit the minimum cashing out",
  "حددي كمية الهدايا التي تريدين تسكيرها": "Specify quantity the gifts which you want cashing them",
  "المحددة:": "The specified:",
  "هدية) / الحد الأدنى": "Gift) / the limit the minimum",
  "المتابعة لبيانات الحساب (": "The continue for data the account(",
  "بيانات حساب الاستلام": "Data account the receiving",
  "هدية محددة": "Gift specified",
  "💵 سيُحوَّل $": "💵 will be transferred $",
  "يُخصم": "Is deducted",
  "المحدد فقط": "The specified only",
  ") من حسابك وتبقى بقية الهدايا المتكررة كما هي.": ") from your account and remain rest the gifts the repeated as is.",
  "حساب باي بال (تحويل تلقائي من حساب الإدارة)": "Account Pay Pal(transfer auto from account the administration)",
  "حساب بنكي (تحويل يدوي من الإدارة — ليس فوريًا)": "Account bank(transfer manual from the administration — not instant)",
  "إرسال طلب التسكير ($": "Send request the cashing out($",
  "متجاهل • الرسائل الخاصة متوقفة": "Ignored• private messages stopped",
  "حسابك يحمل الدخول الملكي 👑 — الصلاحية حتى": "Your account carries royal entrance 👑 — the permission until",
  ". اختر حيواناً آخر ثم اضغط «تغيير الحيوان الملكي».": ". choose another animal last then press«change royal animal».",
  "تم إرسال طلبك للدخول الملكي بـ": "Was send your request login the royal with",
  "إلى لوحة الإدارة ✓ لن يتم الخصم إلا بعد الموافقة": "To the admin panel ✓ will not is done the deduction except after the approval",
  "تم إرسال طلب تغيير حيوانك الملكي إلى": "Was send request change your animal the royal to",
  "للإدارة ✓": "Administration ✓",
  "🎉 تمت عملية الدفع بنجاح! شحن": "🎉 was operation the payment successfully! recharge",
  "ذهب (": "Gold(",
  ") إلى رصيدك 🪙": ") to your balance 🪙",
  "الدفع الإلكتروني غير متاح حالياً — تواصل مع الإدارة": "The payment the electronic not available currently — contact with the administration",
  "بوابة الدفع لم تُفعّل بعد — يرجى التواصل مع الإدارة": "Gateway the payment did not is activated after — please the contact with the administration",
  "بلا إطلالة": "Without look",
  "صورة مرفقة بالمنشور": "Photo attached post",
  "اضغط هنا لفتح الصورة بالحجم الكامل": "Press here to open the photo size the full",
  "اضغط للمشاهدة داخل المشغل": "Press view inside the player",
  "مقطع فيديو": "Clip video",
  "اضغط لتشغيل الفيديو في المشغل": "Press to play the video in the player",
  "إظهار المزيد (": "Show the more(",
  "تفاعل •": "Interaction•",
  "الاسم": "The name",
  "جلسة أو رابط الإدارة": "Session or link the administration",
  "منتهي الصلاحية": "Expired the permission",
  "انتهت صلاحية جلسة الإدارة نظراً لتوليد رمز جديد في الدردشة": "Ended permission session the administration due to generate code new in the chat",
  "القيمة:": "The value:",
  "الغرفة:": "The room:",
  "🏠 الغرفة:": "🏠 the room:",
  "📅 تاريخ التعيين:": "📅 date the assignment:",
  "الرابط :": "The link:",
  "الترتيب:": "The order:",
  "تاريخ:": "Date:",
  "المستخدم:": "The user:",
  "تم حفظ وتطبيق إعدادات اللغة بنجاح": "Was save and apply settings the language successfully",
  "إعدادات الراديو": "Settings the radio",
  "البريد الإلكتروني والتحقق (Gmail)": "The email address check(Gmail)",
  "الشروط والخصوصية": "The terms privacy",
  "شكاوى المستخدمين": "Complaints the users",
  "هدايا حساب (بحث وحذف)": "Gifts account(search and delete)",
  "تسكير الهدايا (سحب الدولارات)": "Cashing out gifts(withdraw the dollars)",
  "تسجيلات المكالمات الصوتية": "Recordings the calls the voice",
  "تسجيل مكالمات الفيديو": "Registration calls the video",
  "صور وأصوات الدخول الملكي": "Photos and sounds royal entrance",
  "تتبع المستخدمين": "Tracking the users",
  "✓ صوت مخصص مرفوع": "✓ voice custom uploaded",
  "🔊 نغمة افتراضية": "🔊 tone default",
  "🔇 مكتوم (مفصول)": "🔇 muted(disconnected)",
  "سوبر أدمن / المالك": "Super admin / the owner",
  "عضوية VIP": "Membership VIP",
  "شارة الدخول المخفي": "Badge the login the hidden",
  "🔊 صوت الهدية مرفق": "🔊 voice the gift attached",
  "🔇 بدون صوت": "🔇 without voice",
  "👑 نمط ملكي": "👑 style royal",
  "🎁 نمط عادي": "🎁 style normal",
  "⚙️ تلقائي حسب القيمة": "⚙️ auto by the value",
  "تعذر تشغيل صوت الهدية": "Failed to run voice the gift",
  "تم الحذف": "Was deleted",
  "تعذر اتمام العملية": "Failed to completion the operation",
  "سبب الرفض (اختياري):": "Reason the reject(optional):",
  "تم رفض الطلب وإبلاغ المستلمة": "Was reject the request and report the received",
  "تعذر رفض الطلب": "Failed to reject the request",
  "لم يدخل غرفة بعد": "Did not enters room after",
  "دولة عنوان IP": "Country title IP",
  "حظر من صفحة الرصد": "Ban from page the monitoring",
  "تم حظر عنوان IP": "Was ban title IP",
  "وفصل جميع اتصالاتهم": "And disconnect all their connections",
  "تعذر حظر عنوان IP": "Failed to ban title IP",
  "داخل الموقع": "Inside the site",
  "بلا اسم": "Without name",
  "من أين دخل": "From where entered",
  "كلمة البحث": "Word the search",
  "الرابط / المسار": "The link / the path",
  "الوقت": "The time",
  "الاعدادات: كل التفاصيل + الحظر": "The settings: all the details + the ban",
  "سري": "Secret",
  "✅ عضو مسجل": "✅ member registered",
  "👤 زائر (غير مسجل)": "👤 visitor(not registered)",
  "🟢 متصل الآن": "🟢 connected the now",
  "⚪ غير متصل حالياً": "⚪ not connected currently",
  "الرابط القادم": "The link the coming",
  "المسار الذي دخل إليه": "The path the the entered to it",
  "عنوان IP": "Title IP",
  "الجهاز / المتصفح": "The device / the browser",
  "وقت الدخول": "Time the login",
  "دولة الحساب": "Country the account",
  "الرصيد (ذهب)": "The balance(gold)",
  "تاريخ إنشاء الحساب": "Date creating the account",
  "آخر دخول": "Last login",
  "إجمالي عمليات الدخول": "Total operations the login",
  "فك الحظر عن الحساب": "Lift the ban about the account",
  "🚫 حظر المستخدم (الحساب + الجهاز)": "🚫 ban the user(the account + the device)",
  "لأنه عضو مسجل فالأفضل «حظر المستخدم» — أما الزائر غير المسجل فيُحظر عبر IP وأجهزته.": "Because member registered best«ban the user» — as for the visitor not the registered is banned via IP and his device.",
  "حظر من صفحة تتبع المستخدمين": "Ban from page tracking the users",
  "تم حظر المستخدم وفصله فوراً 🚫": "Was ban the user and disconnect him immediately 🚫",
  "تم فك الحظر عن المستخدم": "Was lift the ban about the user",
  "تعذر تنفيذ الحظر": "Failed to execute the ban",
  "وفصل جميع اتصالاتهم 🚫": "And disconnect all their connections 🚫",
  "🟢 متواجد داخل الغرفة": "🟢 in the room",
  "⚪ متوقف وغير ظاهر": "⚪ stopped and other visible",
  "تم إيقاف الروبوت": "Was stop the bot",
  "تم إدخال الروبوت إلى الغرفة": "Was entry the bot to the room",
  "تم حذف الهدية من حساب المستخدم ✓": "Was delete the gift from account the user ✓",
  "تعذر حذف الهدية": "Failed to delete the gift",
  "تعذر حذف الهدايا": "Failed to delete the gifts",
  "تم رفع الإيموجي وظهر فوراً لجميع المتصلين ⚡": "Was upload the emoji and appeared immediately for all the online users ⚡",
  "اختيار ملفات الصور:": "Selection files the photos:",
  "اختيار ورفع الصور (يمكن تحديد عدة صور)": "Selection and upload the photos(can select several photos)",
  "إعلان": "Announcement",
  "تم رفع وحفظ الرمزيات بنجاح ✓": "Was upload and save the avatars successfully ✓",
  "تلقائي (عنابي)": "Auto(maroon)",
  "تم حفظ الجلد": "Was save the skin",
  "تم حفظ حجم الخط": "Was save size the font",
  "اسم الراديو (يظهر داخل الدردشة)": "Name the radio(appears inside the chat)",
  "تفعيل الراديو في الدردشة": "Activation the radio in the chat",
  "تم حفظ إعدادات الراديو — يتحدّث المشغل فوراً في الدردشة": "Was save settings the radio — is talking the player immediately in the chat",
  "تم إيقاف التجربة.": "Was stop the trial.",
  "✋ ضع رابط البث أولاً في الحقل أعلاه ثم اضغط تجربة.": "✋ put link the broadcast first in the field above then press trial.",
  "⏳ جاري الاتصال بالبث…": "⏳ loading the connection broadcast…",
  "✅ البث يعمل الآن — هذا بالضبط ما سيسمعه المستخدمون في الدردشة.": "✅ the broadcast works the now — this tune what will hear it the users in the chat.",
  "❌ تعذر تشغيل الرابط — تحقق أنه رابط بث مباشر صالح (mp3/aac).": "❌ failed to run the link — check that it link live stream valid(mp3/aac).",
  "❌ تعذر الوصول للرابط — تحقق من صحة رابط البث وأنه يعمل.": "❌ failed to the access link — check from correctness link the broadcast that it works.",
  "● مفتوحة": "● open",
  "● مغلقة": "● closed",
  "اسم الغرفة": "Name the room",
  "اتركها فارغة ليبدأ العام بدون أي رسالة": "Leave it empty to start the public without any message",
  "تمكين الصوت": "Enable the voice",
  "تمكين الفيديو": "Enable the video",
  "تفعيل الروبوت (eabrmp)": "Activation the bot(eabrmp)",
  "تفعيل الهدايا (eabvg)": "Activation the gifts(eabvg)",
  "تفعيل الألعاب (gm)": "Activation the games(gm)",
  "اتركها فارغة بدون كلمة مرور": "Leave it empty without word passing",
  "معاينة الغرفة": "Preview the room",
  "تم رفع صورة الغرفة": "Was upload photo the room",
  "اكتب اسم الغرفة": "Type name the room",
  "تم تعديل الغرفة": "Was edit the room",
  "تمت اضافة الغرفة بنجاح": "Was add the room successfully",
  "اكتب اسم المستخدم المسجل بدقة": "Type name the user the registered accurately",
  "صوتية": "Voice",
  "كتابية": "Text",
  "اختر الغرفة أولاً": "Choose the room first",
  "تعذر تعيين المشرف": "Failed to assignment the moderator",
  "مثال: أهلاً وسهلاً بكم في الدردشة ★": "Example: welcome welcome how many in the chat ★",
  "تمت الإضافة — يعمل الروبوت فوراً ⚡": "Was the add — works the bot immediately ⚡",
  "لم تُرفع صورة بعد": "No image uploaded yet",
  "مثال: رفيق_الدردشة": "Example: companion_the chat",
  "توليد الزائر وإدخاله": "Generation the visitor and deploy it",
  "اسم الزائر (اختياري)": "Name the visitor(optional)",
  "اتركه فارغاً لتوليد اسم عربي طبيعي تلقائياً": "Leave it empty to generate name Arabic natural automatically",
  "ستُختار صورة عشوائية من المكتبة تلقائياً": "A random image will be chosen from the library automatically",
  "تم رفع الصورة": "Was upload the photo",
  "تم توليد الروبوت وإدخاله ⚡": "Was generation the bot and deploy it ⚡",
  "تم حفظ التعديلات بنجاح ⚡": "Was save the changes successfully ⚡",
  "أدخل مفتاح الـ API الخاص بالمزود المختار هنا...": "Enter key the API the private provider the chosen here...",
  "مثال: gemini-1.5-flash أو llama-3.3-70b-versatile أو gpt-4o-mini": "Example: gemini-1.5-flash or llama-3.3-70b-versatile or gpt-4o-mini",
  "التوجيه العام لشخصية الذكاء الاصطناعي...": "The guidance the public for character the intelligence the artificial...",
  "اكتب سؤالك التجريبي هنا...": "Type your question the demo here...",
  "تم حفظ إعدادات العقل العصبي والذكاء الاصطناعي بنجاح ✅": "Was save settings the brain the neural intelligence the artificial successfully ✅",
  "تعذر حفظ الإعدادات": "Failed to save the settings",
  "اكتب سؤالاً تجريبياً أولاً": "Type a question as demo first",
  "جاري التفكير والتوليد عبر العقل العصبي للذكاء الاصطناعي... ⏳": "The thinking generation via the brain the neural intelligence the artificial... ⏳",
  "أحمد": "Ahmed",
  "البوت_الذكي": "The bot_the smart",
  "🤖 المزود:": "🤖 the provider:",
  "⚡ زمن الاستجابة:": "⚡ time the response:",
  "تم توليد الرد بنجاح ⚡": "Was generation the reply successfully ⚡",
  "خطأ في التوليد:": "Error in the generation:",
  "فشل الاتصال": "Failure the connection",
  "فشل التوليد": "Failure the generation",
  "تفعيل إرسال البريد (SMTP)": "Activation send the email(SMTP)",
  "خادم SMTP (host)": "Server SMTP(host)",
  "المنفذ (port) — 587 أو 465": "The endpoint(port) — 587 or 465",
  "بريد SMTP (user)": "Email SMTP(user)",
  "كلمة مرور SMTP / كلمة مرور تطبيق": "Word passing SMTP / word passing app",
  "اتصال آمن (SSL/TLS — اختره مع المنفذ 465)": "Connection safe(SSL/TLS — choose it with the endpoint 465)",
  "اسم/بريد المرسل (from)": "Name/email the sender(from)",
  "بريد Gmail لتجربة الإرسال (مثال: you@gmail.com)": "Email Gmail to try the send(example: you@gmail.com)",
  "you@gmail.com أو اسم المستخدم": "You@gmail.com or name the user",
  "تم حفظ إعدادات البريد ✓": "Was save settings the email ✓",
  "أدخل بريداً Gmail صالحاً للتجربة": "Enter email Gmail valid trial",
  "تم إرسال البريد التجريبي ✓": "Was send the email the demo ✓",
  "⚠️ SMTP غير مفعّل — فعّله أولاً": "⚠️ SMTP not active — activate it first",
  "تعذر الإرسال:": "Failed to the send:",
  "تم إلغاء البريد وتحريره ✓": "Was cancel the email and edit it ✓",
  "تعذر إلغاء البريد": "Failed to cancel the email",
  "أدخل بريداً أو اسم مستخدم": "Enter email or name user",
  "تعذر البحث": "Failed to the search",
  "وضع المشرفين (msip)": "Mode the moderators(msip)",
  "تمكين المستخدم من التسجيل في الشات (eur)": "Enable the user from the registration in the chat(eur)",
  "إظهار الوقت مع الرسالة (espumh)": "Show the time with the message(espumh)",
  "تفعيل الكتم (mt e)": "Activation the mute(mt e)",
  "تفعيل الكتم الصامت (mt amt)": "Activation the mute thesilent(mt amt)",
  "تفعيل مراقبة الرسائل قبل نشرها (mrs eab)": "Activation monitoring the messages before publish it(mrs eab)",
  "تفعيل إعدادات الروبوت (esprmh)": "Activation settings the bot(esprmh)",
  "رابط الرسائل العامة (puurl)": "Link the messages the public(puurl)",
  "تم حفظ اعدادات النظام": "Was save settings the system",
  "تم حفظ الشروط والخصوصية": "Was save the terms privacy",
  "🔍 ابحث باسم المستخدم...": "🔍 search with name the user...",
  "فك الحظر": "Lift the ban",
  "حظر": "Ban",
  "طلب توثيق الحساب": "Request verification the account",
  "👑 طلب دخول ملكي": "👑 request login royal",
  "👑 طلب تغيير الحيوان الملكي": "👑 request change royal animal",
  "الحيوان الملكي الجديد": "Royal animal the new",
  "الحيوان الملكي": "Royal animal",
  "الكمية المطلوبة": "The quantity the required",
  "الذهب المطلوب شحنه للمستخدم:": "The gold the required recharge it user:",
  "الذهب المطلوب خصمه:": "The gold the required deducting it:",
  "موافقة وشحن الذهب": "Approval and recharge the gold",
  "موافقة وتنفيذ": "Approval and execute",
  "بدون سبب": "Without reason",
  "تمت الموافقة وشحن الذهب للمستخدم": "Was the approval and recharge the gold user",
  "تمت الموافقة وتنفيذ الطلب وخصم الذهب": "Was the approval and execute the request and deduct the gold",
  "تعذرت الموافقة": "Failed to the approval",
  "اكتب سبب الرفض الذي سيصل للمستخدم:": "Type reason the reject the the will arrive user:",
  "تم رفض الطلب وإبلاغ المستخدم": "Was reject the request and report the user",
  "اكتب رسالة الاعلان هنا...": "Type message the announcement here...",
  "اكتب نص الإعلان أولا": "Type text the announcement first",
  "تم إرسال الإعلان لجميع الغرف": "Was send the announcement for all the rooms",
  "اكتب الكلمة الممنوعة هنا...": "Type the word the forbidden here...",
  "اكتب الكلمة أولا": "Type the word first",
  "تم تعديل الكلمة": "Was edit the word",
  "تمت إضافة الكلمة": "Was add the word",
  "رمز الاستبدال الحالي : **": "Code the replacement the current: **",
  "الاسم (مثال: الوردة الذهبية)": "The name(example: the rose the golden)",
  "إيموجي 🌹": "Emoji 🌹",
  "أدخل اسم العضو (مثال: ahmed|mohamed|ali)": "Enter name the member(example: ahmed|mohamed|ali)",
  "اكتب اسم العضو": "Type name the member",
  "تمت الإضافة للتوثيق": "Was the add verification",
  "ابحث باسم المستخدم أو IP أو كلمة البحث أو الدولة...": "Search with name the user or IP or word the search or the country...",
  "مثال: شات العرب أو شات الأردن": "Example: chat Arabs or chat the Jordan",
  "مثال: شات العرب - دردشة صوتية وكتابية مجانية": "Example: chat Arabs - chat voice and text free",
  "اكتب وصفاً جذاباً يظهر في نتائج بحث Google...": "Type description attractive appears in results search Google...",
  "شات, دردشة, شات عربي, تعارف, شات صوتي": "Chat, chat, chat Arabic, dating, chat audio",
  "رابط صورة الشعار (مثال: /img/announcement.png)": "Link photo the logo(example: /img/announcement.png)",
  "معاينة الشعار": "Preview the logo",
  "رابط الفافيكون (مثال: /uploads/favicon.png)": "Link the favicon(example: /uploads/favicon.png)",
  "معاينة الفافيكون": "Preview the favicon",
  "مثال: شات شات1": "Example: chat chat1",
  "مثال: شات 1 - أفضل شات كتابي وصوتي": "Example: chat 1 - best chat text and audio",
  "وصف مخصص يظهر في Google عند البحث عن هذا المسار...": "Description custom appears in Google at the search about this the path...",
  "شات1, chat1, شات عربي": "Chat1, chat1, chat Arabic",
  "مثال: /img/announcement.png": "Example: /img/announcement.png",
  "مثال: شات العرب — دردشة صوتية وكتابية مجانية": "Example: chat Arabs — chat voice and text free",
  "نص فريد يظهر داخل صفحة هذا المسار فقط — اتركه فارغاً للتوليد التلقائي...": "Text unique appears inside page this the path only — leave it empty generation the auto...",
  "اتركه فارغاً ليُولَّد تلقائياً": "Leave it empty to be generated automatically",
  "جاري رفع صورة الشعار للأرشفة...": "Upload photo the logo archiving...",
  "تم رفع صورة الشعار بنجاح ✓": "Was upload photo the logo successfully ✓",
  "جاري رفع أيقونة الفافيكون...": "Upload icon the favicon...",
  "تم رفع أيقونة الموقع بنجاح ✓": "Was upload icon the site successfully ✓",
  "تعذر رفع الأيقونة": "Failed to upload the icon",
  "جاري رفع صورة الشعار...": "Upload photo the logo...",
  "تم رفع أيقونة الفافيكون بنجاح ✓": "Was upload icon the favicon successfully ✓",
  "تم حفظ إعدادات الموقع والأرشفة الأساسية بنجاح ✓": "Was save settings the site archiving the basic successfully ✓",
  "⏸️ متوقف": "⏸️ stopped",
  "بدون وصف": "Without description",
  "تعديل مسار الأرشفة /": "Edit path the archiving /",
  "تم حذف المسار": "Was delete the path",
  "اكتب اسم المسار أولاً": "Type name the path first",
  "رفع صوت": "Upload voice",
  "إزالة": "Removal",
  "🪙 ← يربح المستقبل:": "🪙 ← earns the recipient:",
  "🪙 • التسكير: $": "🪙• the cashing out: $",
  "⛔ مرفوض": "⛔ rejected",
  "مبلغ التسكير الذي يُدفع": "Amount the cashing out the the is paid",
  "تعذر تحميل الطلبات": "Failed to loading the requests",
  "لا توجد اتصالات دردشة نشطة الآن": "There are no connections chat active the now",
  "اتصالات": "Connections",
  "لا توجد سجلات مطابقة": "There are no logs matching",
  "الإعدادات": "The settings",
  "الإعدادات — تفاصيل المستخدم": "The settings — details the user",
  "كل ما دخل به هذا الشخص + بيانات حسابه + أدوات الحظر": "All what entered in it this the person + data his account + tools the ban",
  "جاري تحميل التفاصيل...": "Loading the details...",
  "تعذر تحميل التفاصيل:": "Failed to loading the details:",
  "تفاصيل هذا الدخول": "Details this the login",
  "المصدر:": "The source:",
  "تفاصيل الحساب": "Details the account",
  "ملاحظة": "Note",
  "لا يوجد حساب مرتبط بهذا الدخول في قاعدة البيانات حالياً (حُذف أو أنه اسم زائر مؤقت لم يُنشأ له حساب).": "There are no account linked with this the login in database the data currently(was deleted or that it name visitor temporary did not is created for him account).",
  "يمكنك حظر عنوان IP أدناه لمنع عودته.": "You can ban title IP below to prevent his return.",
  "الحظر والإجراءات": "The ban actions",
  "الحظر يفصل المستخدم فوراً ويمنعه من العودة من نفس الحساب/IP/الجهاز حتى يتم فك الحظر من «قائمة الحظر».": "The ban disconnects the user immediately and prevents him from the return from same the account/IP/the device until is done lift the ban from«list the ban».",
  "👤 زائر عادي": "👤 regular visitor",
  "• كل": "• all",
  "ثانية • حجم": "Second• size",
  "حفظ الباقة": "Save the package",
  "قائمة باقات الذهب الحالية": "List packages the gold the current",
  "جاري تحميل الباقات...": "Loading the packages...",
  "أُنشئت بوابة الدفع عبر": "Created gateway the payment via",
  "مفاتيح PayPal (Rest API App)": "Keywords PayPal(Rest API App)",
  "اتركه فارغاً للإبقاء على المفتاح الحالي.": "Leave it empty keeping on the key the current.",
  "وضع التشغيل:": "Mode the run:",
  "وضع حي (Live) — مدفوعات حقيقية": "Mode neighborhood(Live) — payments real",
  "وضع تجريبي (Sandbox) — للاختبار": "Mode demo(Sandbox) — test",
  "USD (الدولار الأمريكي)": "USD(the dollar the American)",
  "EUR (اليورو)": "EUR(the euro)",
  "GBP (الجنيه الإسترليني)": "GBP(the pound the sterling)",
  "JOD (الدينار الأردني)": "JOD(the dinar the Jordanian)",
  "تفعيل الدفع عبر PayPal في المتجر": "Activation the payment via PayPal in the store",
  "حفظ إعدادات PayPal": "Save settings PayPal",
  "اختبار الاتصال بالبوابة": "Test the connection gateway",
  "بيانات الحساب المصرفي للإيداع (اختياري — للمراسلة)": "Data the account the banking deposit(optional — messaging)",
  "اسم البنك:": "Name the bank:",
  "اسم المستفيد:": "Name the beneficiary:",
  "رقم الآيبان (IBAN):": "Number the IBAN(IBAN):",
  "العمليات المؤكّدة من PayPal": "The operations the confirmed from PayPal",
  "جاري تحميل سجل العمليات...": "Loading record the operations...",
  "بوابة الدفع": "Gateway the payment",
  "مرجع العملية (PayPal)": "Reference the operation(PayPal)",
  "VIP - الرصيد المطلوب لشراء عضوية VIP 👑": "VIP - the balance the required to buy membership VIP 👑",
  "Premium - الرصيد المطلوب لشراء عضوية Premium 💎": "Premium - the balance the required to buy membership Premium 💎",
  "Plus - الرصيد المطلوب لشراء عضوية Plus ⭐": "Plus - the balance the required to buy membership Plus ⭐",
  "حفظ الإعدادات": "Save the settings",
  "⬆️ ارفع ملفاً صوتياً لتشغيله بدل النغمة الافتراضية. الحقل يدعم MP3 / WAV / OGG / M4A / AAC / OPUS حتى 12 ميجا.": "⬆️ upload a file voice to play it instead of the tone the default. the field supports MP3 / WAV / OGG / M4A / AAC / OPUS until 12 MB.",
  "حدد العضويات المسموح لها باستخدام كل ميزة. حسابات الإدارة ومشرفو الغرف مسموح لهم دائماً.": "Specify the memberships the allowed it using all feature. accounts the administration and moderators the rooms allowed for them always.",
  "✅ تم الحفظ والتطبيق الفوري — حد المذيعين الآن:": "✅ was the save app the instant — limit the broadcasters the now:",
  "مظهر رسائل العام": "Appearance messages the public",
  "عرض جسم الرسالة :": "Display body the message:",
  "حجم شارات الرتب والعضويات في العام": "Size badges the ranks memberships in the public",
  "توحيد جميع الشارات على 24px": "Unify all the badges on 24px",
  "رفع صورة الهدية (PNG/GIF/WEBP)": "Upload photo the gift(PNG/GIF/WEBP)",
  "رفع صوت الهدية": "Upload voice the gift",
  "اسم الهدية": "Name the gift",
  "قيمة الهدية بالذهب (تُخصم من مُرسِل الهدية)": "Value the gift gold(are deducted from sender the gift)",
  "كم يربح مستقبِل الهدية منها (ذهب) — مثال: قيمتها 10 يربح 4": "How much earns recipient the gift of them(gold) — example: its value 10 earns 4",
  "قيمة الهدية بالدولار (تسكير الهدايا — للفتيات)": "Value the gift dollar(cashing out gifts — girls)",
  "القسم": "The section",
  "نمط الظهور عند الإرسال": "Style the appearance at the send",
  "«تلقائي» يجعل الهدية تظهر بالمشهد الملكي تلقائياً إذا كانت قيمتها ≥ الحد المحدد أدناه": "«auto» makes the gift appear scene the royal automatically if was its value ≥ the limit the specified below",
  "الحد التلقائي للمشهد الملكي (ذهب)": "The limit the auto scene the royal(gold)",
  "الهدايا الحالية": "The gifts the current",
  "تسكير الهدايا (تحويل الهدايا إلى دولارات)": "Cashing out gifts(transfer the gifts to dollars)",
  "ميزة خاصة بالفتيات فقط: الهدايا بقيمها": "Feature private girls only: the gifts with their value",
  "بالذهب فقط": "Gold only",
  "(لا يوجد سعر دولار لكل هدية).": "(there are no price dollar per gift).",
  "تحدد الإدارة": "Determines the administration",
  "الحد الأدنى للذهب": "The limit the minimum gold",
  "مبلغ التسكير المقابل له": "Amount the cashing out the for for him",
  "(مثال: 5$) وحساب السحب المصدر.": "(example: 5$) and account the withdraw the source.",
  "المبلغ يتناسب طردياً مع الكمية المحددة:": "The amount is proportional proportionally with the quantity the specified:",
  "الهدايا التي تريد تسكيها": "The gifts which want cashing them",
  "(المحددة فقط تُحذف).": "(the specified only are deleted).",
  "تُحذف الهدايا المحددة فقط": "Are deleted the gifts the specified only",
  "وتبقى بقية هداياها.": "And remain rest her gifts.",
  "إعدادات التسكير": "Settings the cashing out",
  "حفظ إعدادات التسكير": "Save settings the cashing out",
  "طلبات التسكير": "Requests the cashing out",
  "جاري التحميل...": "The loading...",
  "ابحث عن الحساب ثم اختر": "Search about the account then choose",
  "عرض الهدايا": "Display the gifts",
  "لرؤية كل الهدايا المستلمة في حسابه.": "To see all the gifts the received in his account.",
  "الحذف يزيل الهدية من رصيد هداياه نهائياً ويؤثر على مجموع الذهب المتاح للتسكير.": "Deleted removes the gift from balance his gifts permanently and affects on total the gold the available cashing out.",
  "لا يُعاد أي ذهب إلى رصيد الحساب": "No is re- any gold to balance the account",
  "عند الحذف.": "At deleted.",
  "جاري تحميل المستخدمين...": "Loading the users...",
  "هدايا": "Gifts",
  "عدد سطور الهدايا": "Number of lines the gifts",
  "إجمالي القطع": "Total the cut",
  "مجموع الذهب": "Total the gold",
  "لا توجد هدايا في هذا الحساب": "There are no gifts in this the account",
  "لا توجد غرف بعد": "There are no rooms after",
  "اهلا وسهلا بكم في": "Welcome welcome how many in",
  "لا توجد غرف متاحة": "There are no rooms available",
  "لا توجد رسائل مسجلة بعد": "There are no messages recorded after",
  "مُرسَل": "Sent",
  "SMTP غير مفعّل": "SMTP not active",
  "فشل": "Failure",
  "لا يوجد حساب بهذا البريد أو الاسم": "There are no account with this the email or the name",
  "مفعَّل": "Enabled",
  "غير مفعَّل (محتاج للتفعيل)": "Not enabled(needing activation)",
  "لا يوجد مستخدمون مطابقون": "There are no users matching",
  "? 'طلب توثيق الحساب'": "? 'request verification the account'",
  ": (isRoyal ? '👑 طلب دخول ملكي'": ":(isRoyal? '👑 request login royal'",
  ": (isRoyalChange ? '👑 طلب تغيير الحيوان الملكي'": ":(isRoyalChange? '👑 request change royal animal'",
  "لا توجد حسابات إدارية": "There are no accounts administrative",
  "✅ قائمة المطرودين فارغة": "✅ list the kicked empty",
  "✅ قائمة الحظر فارغة": "✅ list the ban empty",
  "جاري استئناف الخادم...": "Resume the server...",
  "✅ تم استئناف الخادم بنجاح": "✅ was resume the server successfully",
  "لم يتم إضافة مسارات أرشفة مخصصة بعد (اضغط ➕ إضافة مسار لإنشاء مسار مثل /chat1)": "Did not is done add paths archiving dedicated after(press ➕ add path to create path like /chat1)",
  "🖼️ الشعار مرفق": "🖼️ the logo attached",
  "تم إنشاء غرفة SEO مخفية باسم «": "Was creating room SEO hidden with name«",
  "» 🤖 — مرئية لمحركات البحث فقط": "» 🤖 — visible for search engines the search only",
  "المحادثات الخاصة بين المستخدمين": "The chats the private between the users",
  "جاري تحميل المحادثات...": "Loading the chats...",
  "عرض المحادثة": "Display the conversation",
  "عودة للمحادثات": "Return chats",
  "محادثة:": "Conversation:",
  "مع": "With",
  "رسالة)": "Message)",
  "مسح الكل": "Clear the all",
  "لا توجد رسائل": "There are no messages",
  "تُحفظ تلقائياً تسجيلات المكالمات الخاصة — هذه الصفحة": "Are saved automatically recordings the calls the private — this the page",
  "خاصة بالسوبر ماستر (مالك الدردشة) فقط": "Private super master(owner the chat) only",
  "تسجيلات الفيديو": "Recordings the video",
  "موجودة في صفحة مستقلة: «تسجيل مكالمات الفيديو».": "Existing in page independent:«registration calls the video».",
  "قائمة المكالمات الصوتية المسجلة": "List the calls the voice the recorded",
  "جاري تحميل التسجيلات...": "Loading the recordings...",
  "🎙 صوت": "🎙 voice",
  "تحميل": "Loading",
  "أرشيف مكالمات الفيديو الخاصة — كل تسجيل يظهر فيه فيديو المتصل كاملاً وكاميرتك مصغّرة (بأسلوب سناب شات) مع الصوت.": "Archive calls the video the private — all registration appears in it video the connected fully and your camera miniature(in style snap chat) with the voice.",
  "هذه الصفحة": "This the page",
  "أرشيف مكالمات الفيديو": "Archive calls the video",
  "جاري تحميل تسجيلات الفيديو...": "Loading recordings the video...",
  "الشكاوى الواردة من الأعضاء المسجلين (زر «الإبلاغ» في الملف الشخصي) — تُعرض مع اسم المبلِّغ والمُبلَّغ عنه.": "The complaints the incoming from the members the registered(button«the report» in the file the personal) — are displayed with name the reporter reported about it.",
  "جاري تحميل الشكاوى...": "Loading the complaints...",
  "⚠️ المُبلَّغ عنه:": "⚠️ the reported about it:",
  "حذف الشكوى": "Delete the complaint",
  "كلمة المرور (pwd)": "Password(pwd)",
  "هل أنت متأكد من حذف المستخدم \"": "Are you sure you want to delete the user \"",
  "حذف الحساب الإداري \"": "Delete the account the admin \"",
  "(منتهي)": "(expired)",
  "انتهت جلسة لوحة الإدارة": "Ended session the admin panel",
  "تم إبطال رابط وجلسة الإدارة فوراً لأنك لست متواجداً في الدردشة أو قمت بعمل تحديث.": "Was invalidating link and session the administration immediately because you are not present in the chat or did doing update.",
  "يجب أن تكون متواجداً ومتصلاً داخل الدردشة في نفس الوقت لتشغيل لوحة الإدارة.": "Must that be present and connected inside the chat in same the time to play the admin panel.",
  "العودة إلى الدردشة": "The return to the chat",
  "فحص «طبق الأصل» بين المسارات": "Check«exact the original» between the paths",
  "مسار": "Path",
  "ينقصها محتوى فريد:": "Lacks content unique:",
  "تم الإصلاح الشامل ✓ — عناوين مُعاد توليدها:": "Was the fix the comprehensive ✓ — titles regenerated its generation:",
  "• غرف مخفية مُنشأة:": "• rooms hidden created:",
  "غرف SEO مخفية جديدة:": "Rooms SEO hidden new:",
  "أدخل اسم الدردشة أو الكلمة المستهدفة أعلاه واضغط \"توليد النماذج الآن\" لإنشاء باقات سيو قوية متوافقة مع Google.": "Enter name the chat or the word the targeted above and press \"generation the models the now\" to create packages SEO strong compatible with Google.",
  "جاري تحليل الكلمات وتوليد نماذج SEO متوافقة مع معايير Google...": "Analysis the words and generate models SEO compatible with criteria Google...",
  "كلمة مفتاحية": "Word keyword",
  "الكلمات الدلالية المتصدرة (Keywords & LSI):": "The words the semantic the top-ranking(Keywords & LSI):",
  "تطبيق هذا النموذج الآن ✨": "App this the model the now ✨",
  "🪙 الذهب:": "🪙 the gold:",
  "💵 السعر:": "💵 the price:",
  "حذف العام لدي فقط": "Delete the public I have only",
  "حذف العام للجميع": "Delete the public all",
  "تحدث": "Talk",
  "سحب المايك": "Withdraw the mic",
  "سحب مع منع صعود": "Withdraw with prevent joining",
  "فك من البث": "Lift from the broadcast",
  "مجوهرات": "Jewels",
  "أضف إطلالة": "Add look",
  "اختر صورة": "Choose photo",
  "او": "Or",
  "احصل على توثيق شاتنا": "Get on verification our chat",
  "اجعل مجتمع شاتنا يثق بك وكن دائمًا مميز في المقدمة": "Make community our chat trusts you and be always premium in the intro",
  "اختر الباقة المناسبة وادفع عبر PayPal أو بطاقة فيزا/ماستركارد/أمريكان إكسبريس لشحن رصيدك فورياً بعد تأكيد الدفع": "Choose the package the suitable and pay via PayPal or card Visa/Mastercard/American Express to recharge your balance instantly after confirm the payment",
  "دخول الى الغرفة المختارة": "Login to the room the selected",
  "لا": "No",
  "ارسل لك رسالة خاصة": "Send for you private message",
  "انتقل إلى قائمة الرسائل الخاصة لقراءتها": "Go to list private messages to read it",
  "إنهاء المكالمة": "End the call",
  "تشغيل الراديو": "Run the radio",
  "كتم/إلغاء كتم صوت المذيعين": "Mute/cancel mute voice the broadcasters",
  "حذف «العام» من شاشة أنت فقط — يظل ظاهراً لبقية المستخدمين": "Delete«the public» from screen you only — remains visible for rest the users",
  "حذف «العام» نهائياً من الغرفة لجميع المستخدمين": "Delete«the public» permanently from the room for all the users",
  "النزول لآخر الرسائل": "The scrolling to the last the messages",
  "عرض/إخفاء قائمة المتصلين": "Display/hide list the online users",
  "تغيير الصورة الشخصية": "Change the photo the personal",
  "تحدث — الصعود كمذيع": "Talk — the joining as broadcaster",
  "اسحب لتحريك نافذة البث": "Drag to move window the broadcast",
  "كتم/إلغاء كتم صوتي كمذيع": "Mute/cancel mute audio as broadcaster",
  "البريد الإلكتروني (Gmail)": "The email address(Gmail)",
  "مكالمة فيديو": "Video call",
  "مكالمة صوتية": "Call voice",
  "تصغير": "Shrink",
  "انقر للتبديل": "Click switch",
  "انقر لتكبير صورك": "Click to zoom your photos",
  "جودة الفيديو ثابتة على 360p": "Quality the video fixed on 360p",
  "كتم/إلغاء كتم الميكروفون": "Mute/cancel mute the microphone",
  "تشغيل/إيقاف الكاميرا": "Run/stop the camera",
  "كلمة المرور الحالية": "Password the current",
  "كلمة المرور الجديدة (4 خانات على الأقل)": "The new password(4 characters on the less)",
  "تأكيد كلمة المرور الجديدة": "Confirm the new password",
  "ابحث عن فيديو في YouTube": "Search about video in YouTube",
  "إزالة الصورة": "Removal the photo",
  "كلمة المرور الجديدة": "The new password",
  "نظام إدارة الدردشة المتكامل": "Complete Chat Management System",
  "🇸🇦 العربية": "🇸🇦 the Arabic",
  "لوحة التحكم": "The control panel",
  "الصلاحية :": "Role :",
  "مُوَلّد SEO والأرشفة بالذكاء الاصطناعي 🤖": "Generator SEO archiving intelligence the artificial 🤖",
  "توليد النماذج الآن": "Generation the models the now",
  "🌍 عربي عام": "🌍 Arabic public",
  "🎙️ صوتي ومايكات": "🎙️ audio and mics",
  "🤝 تعارف وصداقة": "🤝 dating and friendship",
  "⚡ جوال سريع": "⚡ mobile fast",
  "👑 خليجي راقي": "👑 Gulf classy",
  "اكتب اسم الدردشة أو المسار أو الكلمة هنا...": "Type name the chat or the path or the word here...",
  "مذيع مباشر": "Broadcaster live",
  "إيقاف مشاهدة هذا البث": "Stop view this the broadcast",
  "دردشة كتابية": "Chat text",
  "غرفة صوتية": "Room voice",
  "الغرفة مغلقة": "Room is closed",
  "الغرفة برقم سري": "The room password-protected",
  "للأعضاء المسجلين فقط": "Members the registered only",
  "مثال: الباقة الفضية أو باقة المبتدئين": "Example: the package silver or package beginners",
  "مثال: 100": "Example: 100",
  "مثال: 9.99": "Example: 9.99",
  "مثال: 15 (اتركه 0 إذا لم يوجد)": "Example: 15(leave it 0 if did not there is)",
  "مثال: 🔥 الأكثر طلباً أو ⭐ باقة التوفير": "Example: 🔥 the more requested or ⭐ package saving",
  "مثال: AQ7vH2...": "Example: AQ7vH2...",
  "مثال: EO9xK3...": "Example: EO9xK3...",
  "مثال: البنك الأهلي التجاري": "Example: the bank national the commercial",
  "مثال: إدارة الدردشة المعتمدة": "Example: administration the chat verified",
  "مثال: JO94 ARAB 1234 5678 9012 3456": "Example: JO94 ARAB 1234 5678 9012 3456",
  "مثال: أسد": "Example: lion",
  "🔍 بحث باسم أي طرف في المحادثة...": "🔍 search with name any party in the conversation...",
  "🔍 بحث باسم المتصل أو المستلم أو اسم الملف...": "🔍 search with name the connected or the recipient or name the file...",
  "🔍 بحث باسم المتصل أو المستلم...": "🔍 search with name the connected or the recipient...",
  "🔍 بحث باسم المبلِّغ أو المُبلَّغ عنه أو النص...": "🔍 search with name the reporter or the reported about it or the text...",
  "مثل: jo, eg, sa": "Like: jo, eg, sa"
,
  "اللغة": "Language",
  "الرئيسية": "Home",
  "االدردشة العربية": "The Arabic Chat",
  "الغرفة مغلقة حالياً": "This room is currently closed",
  "الغرفة للأعضاء المسجلين فقط": "This room is for registered members only",
  "عدد المذيعين المتزامن (الميكروفونات)": "Concurrent broadcasters (microphones)",
  "أقصى عدد مسموح بالبقاء على المايك في نفس الوقت داخل البث — عند امتلائها يُرفض صعود أي شخص جديد برسالة «الميكروفونات ممتلئة».": "Maximum number of people allowed on mic at the same time in the stream — when full, newcomers are rejected with a \"mics full\" message.",
  "درجة التفريد:": "Uniqueness score:",
  "لا يوجد أي تكرار بين المسارات": "No duplicates between paths",
  "درجة التفريد": "Uniqueness score",
  "إرسال": "Send",
  "الحالة التالية": "Next status",
  "الحالة السابقة": "Previous status",
  "تصغير المكالمة": "Minimize call",
  "تقليل الكمية": "Decrease quantity",
  "تقليل المدة": "Decrease duration",
  "رفض المكالمة": "Reject call",
  "زيادة الكمية": "Increase quantity",
  "زيادة المدة": "Increase duration",
  "قبول المكالمة": "Accept call",
  "كتم الميكروفون": "Mute microphone",
  "مكبر الصوت": "Speaker",
  "موضع المقطع الصوتي": "Audio clip position",
  "نافذة البث المباشر": "Live stream window",
  "هل تريد الانتقال إلى هذه الغرفة ؟": "Do you want to move to this room?",
  "من خيار نوع الحساب لتوليد زائر بلا أي شارة روبوت: اسم عربي طبيعي وصورة عشوائية إن تُركا فارغين، ويدخل الغرفة كأي زائر حقيقي. ويمكن تحديد": "from the Account Type option to generate a visitor with no bot badge: a natural Arabic name and a random photo         if both are left empty, and they join the room like any real visitor. You can also set ",
  "من خيار نوع الحساب لتوليد زائر بلا أي شارة روبوت: اسم عربي طبيعي وصورة عشوائية\n        إن تُركا فارغين، ويدخل الغرفة كأي زائر حقيقي. ويمكن تحديد": "from the Account Type option to generate a visitor with no bot badge: a natural Arabic name and a random photo         if both are left empty, and they join the room like any real visitor. You can also set ",
  "لكل حساب تولّده.": "for each account it generates.",
  "لم يُرفع صوت بعد": "No audio uploaded yet",
  "أعلى الدردشة مباشرة تحت الهيدر": "at the top of the chat, directly under the header",
  "فوراً لجميع المستخدمين، ويعمل على جميع الهواتف.": "instantly for all users, and works on all phones.",
  "اكتب أي سؤال تجريبي لتجربة توليد الرد من العقل العصبي للذكاء الاصطناعي مباشرة والتأكد من سرعة ودقة الإجابة.": "Type any test question to try generating a reply from the AI neural brain directly and check the speed and accuracy of the answer.",
  "يتحكم هذا القسم في العقل العصبي للذكاء الاصطناعي الذي تستخدمه روبوتات الدردشة عند مناداتها بالاسم للإجابة عن أي سؤال بشكل واقعي وذكي. يدعم النظام Google Gemini و Groq (Llama 3.3) و OpenAI و DeepSeek أو أي خادم عصبي مخصص (Ollama / LocalAI).": "This section controls the AI neural brain used by the chat bots when called by name to answer any question realistically and smartly. The system supports Google Gemini, Groq (Llama 3.3), OpenAI, DeepSeek or any custom neural server (Ollama / LocalAI).",
  "تهيئة مزود الذكاء الاصطناعي ومفتاح الـ API": "AI provider setup and API key",
  "⚡ Google Gemini (مجاني وسريع وذكي جداً - مُستحسن)": "⚡ Google Gemini (free, fast and very smart - recommended)",
  "🚀 Groq Cloud (Llama 3.3 70B - مجاني وفائق السرعة)": "🚀 Groq Cloud (Llama 3.3 70B - free and super fast)",
  "عند اختيار «للأعضاء المسجلين فقط» تُمنع حسابات الزوار من دخول الغرفة، وتظهر لهم رسالة تدعوهم لإنشاء حساب. الإدارة تدخل دائماً.": "When «registered members only» is selected, visitor accounts are prevented from entering the room, and they see a message inviting them to create an account. Admins always get in.",
  "و": "and",
  "طلب دخول ملكي": "Royal join request",
  "مكالمة وبث مباشر": "Call andlive stream",
  "مكالمة وبث مباشر نشط": "Call andlive stream active",
  "لا يمكنك الانتقال إلى غرفة أخرى أثناء وجود مكالمة وبث مباشر. يجب إغلاقهما أولاً ثم يمكنك الدخول إلى الغرفة الأخرى.": "Cannotas the moving to room other during presence call andlive stream. must close both first then you can the login to the room the other.",
  "التوثيق والدخول الملكي": "The verification androyal entrance",
  "دفع إلكتروني آمن ومشفر عبر PayPal — نقبل بطاقات فيزا/ماستركارد/أمريكان إكسبريس وPayPal وخيارات أخرى": "Payment electronic safe and encrypted via PayPal — accept cards Visa/Mastercard/American Express andPayPal and options other",
  "(بث mp3/aac مثل icecast أو shoutcast) ثم فعّل الراديو.": "(streaming mp3/aac such as icecast or shoutcast) then enable the radio.",
  "كلمة المرور السرية (اتركها فارغة = بدون حماية)": "Secret password (leave empty = no protection)",
  "تُستخدم لاحتساب قيمة التحويل إلى دولارات في نظام التسكير (مثال: 1.5 = $1.50)": "Used to calculate the conversion value to dollars in the cash-out system (example: 1.5 = $1.50)",
  "يسري على الهدايا بنمط «تلقائي» فقط. 0 = تعطيل التلقائي (كل الهدايا عادية)": "Applies to gifts in «auto» style only. 0 = disable auto (all gifts normal)"
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
  "إظهار أقل": "Mostrar menos", "التفاعلات": "Reacciones", "الكل": "Todos", "عرض الملف الشخصي": "Ver perfil", "جاري تحميل التفاعلات...": "Cargando reacciones...",
  "تعذر تحميل التفاعلات": "No se pudieron cargar las reacciones", "لا توجد تفاعلات على هذا المنشور بعد": "Aún no hay reacciones en esta publicación", "عرض من تفاعلوا مع المنشور": "Ver quién reaccionó",
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
,
  "الدردشة العربية": "Chat en Vivo",
  "بدء بث فيديو": "Iniciar transmisión de video",
  "سيبدأ بث فيديو مباشر في هذه الغرفة، ويمكن لأعضاء الغرفة طلب مشاهدته.": "Se iniciará una transmisión de video en vivo en esta sala y los miembros pueden solicitar verla.",
  "بدء البث": "Iniciar transmisión",
  "سيصل طلب مشاهدة البث لهذا المذيع تحديداً، ولن تشاهد بثه إلا إن وافق عليه. وإن كنت تشاهد مذيعاً آخر أو تبث بنفسك، فكل شيء يستمر بشكل طبيعي — البثوث تعمل معاً في نفس الوقت.": "Tu solicitud de ver esta transmisión llega a ese transmisor específico; solo verás su transmisión si aprueba. Si estás viendo a otro transmisor o transmitiendo, todo continúa con normalidad: las transmisiones funcionan a la vez.",
  "مشاهدة البث": "Ver transmisión",
  "0 مشاهد": "0 espectadores",
  "مباشر": "En vivo",
  "بانتظار موافقة أحد المذيعين على مشاهدة البث…": "Esperando a que uno de los transmisores apruebe ver la transmisión…",
  "إنهاء البث": "Finalizar transmisión",
  "مغادرة المشاهدة": "Salir de la vista",
  "ع": "F",
  "يُستخدم للتفعيل والمتابعة — يجب أن يكون Gmail (ينتهي بـ @gmail.com)": "Se usa para activación y seguimiento — debe ser un correo de Gmail (que termine en @gmail.com)",
  "تفعيل الحساب": "Activar cuenta",
  "أرسلنا رمز تفعيل مكونًا من 6 أرقام إلى جيميلك:": "Enviamos un código de activación de 6 dígitos a tu Gmail:",
  "إعادة إرسال الرمز": "Reenviar código",
  "تغيير البريد": "Cambiar correo",
  "لا يصلك الرمز؟ تحقق من مجلد الرسائل غير المرغوبة (Spam). الرمز صالح لمدة 10 دقائق.": "¿No recibiste el código? Revisa la carpeta de correo no deseado (Spam). El código es válido por 10 minutos.",
  "عرض الحالة": "Ver estado",
  "كشف نكات": "Revelar broma",
  "كشف النكات": "Revelar la broma",
  "صورة المستخدم": "Foto de usuario",
  "التكلفة الإجمالية :": "Costo total:",
  "ترقية الحساب الآن": "Mejorar cuenta ahora",
  "لوحة التحكم الإدارية": "Panel de control de administración",
  "مكالمة صوتية خاصة واردة...": "Llamada de voz privada entrante...",
  "رد": "Responder",
  "رفض": "Rechazar",
  "جاري الاتصال...": "Llamando...",
  "سبيكر": "Altavoz",
  "كتم": "Silenciar",
  "إنهاء": "Finalizar",
  "أغلق الكاميرا": "Apagar cámara",
  "الجودة: -": "Calidad: -",
  "الكاميرا": "Cámara",
  "المكالمة بالسماعة جارية • انقر لإضاءة الشاشة": "Llamada en altavoz • toca para encender la pantalla",
  "بدء مكالمة صوتية": "Iniciar llamada de voz",
  "متابعة": "Continuar",
  "هدية": "Regalo",
  "الدخول الملكي 👑": "Entrada Real 👑",
  "مرفوعاتي": "Mis subidas",
  "الحساب": "Cuenta",
  "تغيير كلمة المرور": "Cambiar contraseña",
  "لحسابك المسجل — أدخل كلمة المرور الحالية ثم الجديدة": "Para tu cuenta registrada — ingresa la contraseña actual y luego la nueva",
  "منشور جديد": "Nueva publicación",
  "بحث": "Buscar",
  "جاري تحميل المنشورات...": "Cargando publicaciones...",
  "عرض الوسائط": "Ver medios",
  "جارٍ تجهيز الوسائط...": "Preparando medios...",
  "تعذر تشغيل الفيديو داخل المتصفح": "No se pudo reproducir el video en el navegador",
  "قد يكون ترميز الملف غير مدعوم. يمكنك فتح الملف الأصلي من الزر بالأسفل.": "La codificación del archivo puede no ser compatible. Puedes abrir el archivo original desde el botón de abajo.",
  "انقر تشغيل لبدء المشاهدة": "Haz clic en reproducir para empezar a ver",
  "فتح الملف الأصلي": "Abrir archivo original",
  "، وتستطيع الإدارة تحديد مقدار الذهب النهائي عند الموافقة": ", y la administración establece el monto final de oro al aprobar",
  "شارة التاج الملكي": "Insignia de corona real",
  "تاج ذهبي مميز يظهر بجوار اسمك أينما ظهر (الرسائل، المتصلين، الملف الشخصي)": "Una corona dorada distintiva aparece junto a tu nombre dondequiera que aparezcas (mensajes, contactos, perfil)",
  "توهج ملكي عند دخول الغرف": "Resplandor real al entrar a las salas",
  "عند دخولك أي غرفة يظهر توهج ملكي ذهبي احترافي مع التاج وإشعار الترحيب الملكي للجميع": "Al entrar a cualquier sala aparece un resplandor real dorado profesional con la corona y una notificación de bienvenida real para todos",
  "تميز دائم": "Distinción permanente",
  "شارة ملكية لا تُزال — تميّزك في المقدمة دائماً": "Una insignia real permanente — te mantiene siempre al frente",
  "اختر حيوانك الملكي": "Elige tu animal real",
  "التكلفة": "Costo",
  "لن يتم خصم أي ذهب عند إرسال الطلب. يصل طلبك إلى لوحة الإدارة، وبعد المراجعة توافق الإدارة أو ترفضه، وسيصلك إشعار بالنتيجة.": "No se descuenta oro al enviar la solicitud. Tu solicitud llega al panel de administración y, tras la revisión, la administración aprueba o rechaza, y recibirás una notificación con el resultado.",
  "طلب الدخول الملكي": "Solicitar entrada real",
  "لديك الدخول الملكي": "Tienes entrada real",
  "تغيير الحيوان الملكي": "Cambiar animal real",
  "باقة الذهب": "Paquete de oro",
  "100 ذهب 🪙": "100 Oro 🪙",
  "الإيداع على حساب الدردشة المعتمد:": "Depósito a la cuenta de chat aprobada:",
  "البنك التجاري": "Banco Comercial",
  "تاريخ الانتهاء:": "Fecha de vencimiento:",
  "تأكيد الخصم والدفع (": "Confirmar descuento y pago (",
  "طريقة دخول الغرفة": "Modo de entrada a la sala",
  "اختر طريقة دخولك إلى غرفة": "Elige cómo entrar a una sala",
  "دخول ظاهر": "Entrada visible",
  "دخول مخفي": "Entrada oculta",
  "بث مباشر نشط": "Transmisión activa",
  "لا يمكنك مغادرة الغرفة وأنت تقوم بالبث المباشر.": "No puedes salir de la sala mientras transmites en vivo.",
  "البقاء في الغرفة": "Permanecer en la sala",
  "إيقاف البث والخروج": "Detener transmisión y salir",
  "تحديث الصفحة": "Actualizar página",
  "هل تريد مغادرة الدردشة؟": "¿Quieres salir del chat?",
  "أنت متواجد في غرفة. يمكنك البقاء، أو الخروج وتحديث الصفحة وإعادة الدخول.": "Estás en una sala. Puedes quedarte, o salir y actualizar la página para volver a entrar.",
  "البقاء": "Permanecer",
  "الخروج وتحديث الصفحة": "Salir y actualizar página",
  "غرفة «": "Sala «",
  "» محمية بكلمة مرور.": "» está protegida con contraseña.",
  "إرفاق صورة (دليل) — اختياري": "Adjuntar una imagen (evidencia) — opcional",
  "استعادة كلمة المرور": "Recuperar contraseña",
  "أدخل بريدك المسجل وسنرسل لك رمز استعادة من 6 أرقام": "Ingresa tu correo registrado y te enviaremos un código de recuperación de 6 dígitos",
  "إرسال الرمز": "Enviar código",
  "فحص الملف قبل الإرسال": "Revisar el archivo antes de enviar",
  "جارٍ فحص الملف...": "Revisando el archivo...",
  "إرسال إلى العام": "Enviar a público",
  "تسجيل مقطع صوتي": "Grabar audio",
  "جارٍ التسجيل...": "Grabando...",
  "إيقاف ومعاينة": "Detener y previsualizar",
  "معاينة المقطع قبل الإرسال": "Previsualizar el clip antes de enviar",
  "استمع إلى المقطع ثم أرسله أو احذفه": "Escucha el clip y luego envíalo o elimínalo",
  "الرسالة طويلة": "El mensaje es demasiado largo",
  "يجب أن تكون الرسالة": "El mensaje debe ser de",
  "حرف أو أقل": "caracteres o menos",
  "عدد الأحرف المكتوبة": "Número de caracteres escritos",
  "العودة لتعديل الرسالة": "Volver para editar el mensaje",
  "لا تتحدث بسرعة": "No escribas tan rápido",
  "خذ استراحة قصيرة قبل إرسال الرسالة التالية": "Toma un descanso corto antes de enviar el siguiente mensaje",
  "ثانية": "segundo(s)",
  "تم إيقاف الوصول": "Se ha bloqueado el acceso",
  "تم حظرك بسبب سلوكك السيئ": "Has sido bloqueado por tu mal comportamiento",
  "لن تتمكن من دخول الدردشة من هذا الحساب أو الجهاز حتى تقوم الإدارة بفك الحظر.": "No podrás entrar al chat desde esta cuenta o dispositivo hasta que la administración levante el bloqueo.",
  "سبب الحظر": "Motivo del bloqueo",
  "سلوك سيئ داخل الدردشة": "Mal comportamiento en el chat",
  "الحظر مرتبط بالحساب والجهاز ويستمر عند تغيير عنوان IP": "El bloqueo está vinculado a la cuenta y al dispositivo y persiste al cambiar la dirección IP",
  "إعادة التحقق بعد فك الحظر": "Verificar de nuevo tras levantar el bloqueo",
  "جلسة جديدة": "Nueva sesión",
  "تم الدخول بحسابك من جهاز آخر": "Se inició sesión en tu cuenta desde otro dispositivo",
  "تم تسجيل الدخول إلى حسابك من جهاز آخر. لضمان أمان حسابك، تم إنهاء هذه الجلسة تلقائياً.": "Se inició sesión en tu cuenta desde otro dispositivo. Para proteger tu cuenta, esta sesión se cerró automáticamente.",
  "إذا لم تكن أنت من قام بالدخول، غيّر كلمة المرور وعُد للدخول مجدداً.": "Si no fuiste tú, cambia tu contraseña e inicia sesión de nuevo.",
  "العودة لتسجيل الدخول": "Volver a iniciar sesión",
  "جارٍ التحميل...": "Cargando...",
  "أدخل اسم المستخدم وكلمة المرور": "Ingresa usuario y contraseña",
  "أدخل البريد الإلكتروني": "Ingresa tu correo",
  "أدخل بريداً Gmail صالحاً (ينتهي بـ @gmail.com)": "Ingresa un Gmail válido (que termine en @gmail.com)",
  "أكمل الحقول المطلوبة للباقة": "Completa los campos requeridos para el paquete",
  "اسم المستخدم مطلوب": "El nombre de usuario es obligatorio",
  "البريد الإلكتروني إلزامي لإتمام التسجيل": "El correo electrónico es obligatorio para registrar",
  "البريد الإلكتروني يجب أن يكون Gmail (ينتهي بـ @gmail.com)": "El correo debe ser Gmail (que termine en @gmail.com)",
  "البريد غير صالح — يجب أن يكون Gmail": "Correo inválido — debe ser Gmail",
  "الرمز يجب أن يتكون من 6 أرقام": "El código debe ser de 6 dígitos",
  "الرمز غير صحيح — يجب أن يتكون من 6 أرقام": "Código incorrecto — debe ser de 6 dígitos",
  "انتهت صلاحية الرمز — أعد الإرسال برمز جديد": "El código caducó — reenvía uno nuevo",
  "تم تجاوز عدد المحاولات — أعد الإرسال برمز جديد": "Demasiados intentos — reenvía con un código nuevo",
  "حسابك غير مفعّل بعد — يجب إدخال رمز التفعيل أولاً": "Cuenta no activada — ingresa primero el código de activación",
  "يجب دخول الغرفة أولاً": "Entra primero a una sala",
  "يجب دخول الغرفة قبل الكتابة": "Entra a una sala antes de escribir",
  "اختر غرفة صحيحة": "Elige una sala válida",
  "الغرفة غير موجودة": "Sala no encontrada",
  "الغرفة غير محددة": "Sala no especificada",
  "غرفة محذوفة": "Sala eliminada",
  "🔒 هذه الغرفة مغلقة حالياً من الإدارة": "Esta sala está cerrada por la administración",
  "أنت مطرود من هذه الغرفة": "Has sido expulsado de esta sala",
  "🚫 أنت مطرود من هذه الغرفة": "Has sido expulsado de esta sala",
  "تم طردك من هذه الغرفة بواسطة الإدارة": "Fuiste expulsado por la administración",
  "المستخدم لم يعد موجوداً في الغرفة": "El usuario ya no está en la sala",
  "لا يمكنك الإشراف على مستخدم بصلاحية مساوية أو أعلى": "No puedes moderar a un usuario con permisos iguales o superiores",
  "أنت مكتوم ولا يمكنك الكتابة": "Estás silenciado y no puedes escribir",
  "أنت مكتوم ولا يمكنك الصعود كمذيع": "Estás silenciado y no puedes transmitir",
  "كتم من الإدارة": "Silenciado por la administración",
  "طرد من الغرفة": "Expulsado de la sala",
  "أنت أحد المذيعين بالفعل": "Ya eres un transmisor",
  "أنت تبث بالفعل في هذه الغرفة": "Ya estás transmitiendo en esta sala",
  "لا يوجد بث صوتي حالياً في هذه الغرفة": "No hay transmisión de audio ahora",
  "لا يوجد بث فيديو حالياً في هذه الغرفة": "No hay transmisión de video ahora",
  "هذا المذيع لم يعد يبث حالياً": "Este transmisor ya no está en vivo",
  "لا يمكنك مشاهدة بثك الشخصي": "No puedes ver tu propia transmisión",
  "الميكروفونات ممتلئة الآن — لا يمكن الصعود كمذيع": "Los micrófonos están llenos — no puedes transmitir",
  "عضويتك غير مسموح لها بالصعود كمذيع": "Tu membresía no permite transmitir",
  "رصيد الذهب غير كافٍ لإتمام الترقية": "Oro insuficiente para completar la mejora",
  "رصيدك غير كافي": "Saldo insuficiente",
  "رصيد المستخدم لم يعد كافياً": "El saldo del usuario ya no es suficiente",
  "هدية غير صالحة": "Regalo no válido",
  "الهدية غير موجودة في هذا الحساب": "El regalo no existe en esta cuenta",
  "بعض الهدايا المحددة لا تنتمي لحسابك": "Algunos regalos no pertenecen a tu cuenta",
  "كمية غير صالحة": "Cantidad no válida",
  "لا توجد هدايا يمكنك تحويلها": "No hay regalos que puedas convertir",
  "ميزة تسكير الهدايا متاحة للفتيات فقط": "La conversión de regalos está disponible solo para chicas",
  "نظام تسكير الهدايا غير مفعّل حالياً": "La conversión de regalos está desactivada",
  "📞 تم بدء مكالمة صوتية": "Llamada de voz iniciada",
  "📞 تم رفض المكالمة": "Llamada rechazada",
  "📞 تم رفض المكالمة (المستخدم مشغول)": "Llamada rechazada (usuario ocupado)",
  "📞 مكالمة صوتية فائتة": "Llamada de voz perdida",
  "📞 مكالمة صوتية مجانية منتهية • 01:00": "Llamada de voz gratis finalizada • 01:00",
  "مكالمة فيديو خاصة": "Videollamada privada",
  "مكالمة مفتوحة المدة": "Llamada ilimitada",
  "انتهت الدقيقة المجانية التجريبية للمكالمة ⏱️": "Terminó el minuto de prueba gratis ⏱️",
  "انتهت الدقيقة المجانية التجريبية للمكالمة ⏱️ يمكنك إجراء مكالمات مفتوحة بتكلفة 2 ذهب": "Terminó el minuto de prueba ⏱️ — puedes hacer llamadas abiertas por 2 Oro",
  "بدأت مكالمتك المجانية التجريبية الأولى (المدة: دقيقة واحدة) 🎁": "Tu primera llamada de prueba gratis comenzó (duración: 1 minuto) 🎁",
  "طلب التوثيق": "Solicitud de verificación",
  "طلب تغيير الحيوان الملكي": "Solicitud de cambio de animal real",
  "طلب شراء الذهب": "Solicitud de compra de oro",
  "طلب الترقية": "Solicitud de mejora",
  "حسابك موثق بالفعل ✓": "Tu cuenta ya está verificada ✓",
  "الحساب موثق بالفعل": "Cuenta ya verificada",
  "رفضت الإدارة طلب التسكير": "La administración rechazó la solicitud de conversión",
  "تم رفض الطلب من الإدارة": "Solicitud rechazada por la administración",
  "تمت معالجة هذا الطلب مسبقاً": "Esta solicitud ya fue procesada",
  "الطلب غير موجود أو تمت معالجته": "Solicitud no encontrada o ya procesada",
  "المنشور غير موجود": "Publicación no encontrada",
  "تعذر حفظ الحالة": "No se pudo guardar el estado",
  "الحالة غير موجودة": "Estado no encontrado",
  "انتهت هذه الحالة أو حُذفت": "Este estado caducó o fue eliminado",
  "الحالة الكتابية لا تحتاج ملفاً": "Un estado de texto no necesita archivo",
  "مشاهدو الحالة متاحون لصاحبها فقط": "Los espectadores del estado solo están para el dueño",
  "نوع الحالة غير صالح": "Tipo de estado no válido",
  "حالة غير صالحة": "Estado no válido",
  "اختر ملف الحالة أولاً": "Elige primero un archivo de estado",
  "فيديو YouTube المختار غير صالح": "El video de YouTube seleccionado no es válido",
  "اكتب التعليق": "Escribe el comentario",
  "تفاعل غير صالح": "Reacción no válida",
  "الملف غير صالح": "Archivo no válido",
  "حجم الملف أكبر من 50MB": "El archivo supera los 50MB",
  "تعذر فحص الصورة أو أن الملف تالف": "Falló la revisión de la imagen o el archivo está dañado",
  "فشل فحص المقطع الصوتي أو أن الملف تالف": "Falló la revisión del audio o está dañado",
  "حدث خطأ، حاول مرة أخرى": "Ocurrió un error, inténtalo de nuevo",
  "خطأ غير معروف": "Error desconocido",
  "خطأ في النظام": "Error del sistema",
  "رابط غير صالح": "Enlace no válido",
  "الإشعار غير موجود": "Notificación no encontrada",
  "تعذر الوصول إلى الدردشة": "No se pudo acceder al chat",
  "اشترِ الذهب الافتراضي لترقية حسابك أو حساب أصدقائك وإرسال الهدايا": "Compra oro virtual para mejorar cuentas y enviar regalos",
  "باقات شحن الذهب المميزة": "Paquetes Premium de Recarga de Oro",
  "اختر الباقة المناسبة وادفع عبر البطاقة البنكية أو بطاقة الصراف لشحن رصيدك فورياً": "Elige el paquete adecuado y paga con tarjeta para recargar al instante",
  "متابعة شراء": "Continuar compra",
  "هل انت متأكد تريد الخروج من هذه الغرفة ؟": "¿Seguro que quieres salir de esta sala?",
  "كلا": "No",
  "نعم": "Sí",
  "غرفة محمية": "Sala protegida",
  "اكتب كلمة المرور للدخول:": "Escribe la contraseña para entrar:",
  "❌ كلمة المرور غير صحيحة — حاول مرة أخرى": "❌ Contraseña incorrecta — inténtalo de nuevo",
  "قسم الشكاوي": "Sección de quejas",
  "إرسال الشكوى": "Enviar queja",
  "جاري رفع الملف...": "Subiendo archivo...",
  "تم قطع الاتصال": "Conexión perdida",
  "جارٍ إعادة الاتصال...": "Reconectando...",
  "اتصال": "Conectar",
  "نبذة صوتية": "Biografía de voz",
  "لا توجد نبذة صوتية بعد": "Aún no hay biografía de voz",
  "تسجيل": "Grabar",
  "رفع ملف": "Subir archivo",
  "إيقاف": "Detener",
  "تشغيل": "Reproducir",
  "حذف": "Eliminar",
  "هل تريد حذف النبذة الصوتية؟": "¿Quieres eliminar la biografía de voz?",
  "تم حذف النبذة الصوتية": "Biografía de voz eliminada",
  "تم حفظ النبذة الصوتية ✅": "Biografía de voz guardada ✅",
  "تعذر رفع النبذة الصوتية": "No se pudo subir la biografía de voz",
  "تعذر حفظ النبذة الصوتية": "No se pudo guardar la biografía de voz",
  "تعذر التسجيل الصوتي": "No se pudo grabar el audio",
  "تعذر الوصول إلى الميكروفون، تحقق من الإذن": "No se pudo acceder al micrófono, revisa tu permiso",

  "نجوم العرب": "Estrellas árabes",
  "الكمية:": "La cantidad:",
  "اليوم الساعة": "Hoy hora",
  "أمس الساعة": "Ayer hora",
  "تم كتم": "Se silenciar",
  "تم إلغاء كتم": "Se cancelar silenciar",
  "تم طرد": "Se expulsar",
  "تم حظر": "Se bloqueo",
  "تم تجاهل": "Se ignorar",
  "مرحبا بك": "Hola ti",
  "رصيد:": "Saldo:",
  "حسب عنوان IP": "Según título IP",
  "من الغرفة": "De el sala",
  "الدردشة المباشرة": "El chat el directamente",
  "جارٍ إنشاء الحساب...": "Cargando crear el cuenta...",
  "جارٍ تسجيل الدخول...": "Cargando registro el inicio de sesión...",
  "جارٍ الدخول كزائر...": "Cargando el inicio de sesión como visitante...",
  "جارٍ تفعيل الحساب...": "Cargando activación el cuenta...",
  "جارٍ إرسال رمز جديد...": "Cargando enviar código nuevo...",
  "جارٍ إرسال رمز الاستعادة...": "Cargando enviar código el recuperación...",
  "جارٍ تحميل الغرفة...": "Cargando carga el sala...",
  "جارٍ فتح الغرفة...": "Cargando abrir el sala...",
  "جارٍ تحميل الحالات...": "Cargando carga el estados...",
  "جارٍ تحميل الإشعارات...": "Cargando carga el notificaciones...",
  "جارٍ تحميل الدخول الملكي...": "Cargando carga entrada real...",
  "جارٍ تحميل باقات الذهب...": "Cargando carga paquetes el oro...",
  "جارٍ تحميل الصور...": "Cargando carga el fotos...",
  "جارٍ تجهيز الحائط...": "Cargando preparar el muro...",
  "جارٍ الاتصال بالدردشة...": "Cargando el conexión chat...",
  "جارٍ تنفيذ الطلب...": "Cargando ejecutar el solicitud...",
  "تعذر رفع الملف": "No se pudo subir el archivo",
  "تعذر الاتصال أثناء رفع الملف": "No se pudo el conexión durante subir el archivo",
  "انتهت مهلة رفع الملف": "Terminó tiempo agotado subir el archivo",
  "تم إلغاء رفع الملف": "Se cancelar subir el archivo",
  "(رسالة خاصة) |": "(mensaje privado)|",
  "ميكروفون": "Micrófono",
  "يستقبله الطرف الآخر كـ": "Lo recibe el parte el último como",
  "أحادية الاتجاه: لا يصلني منه شيء (إن كان يبث وأريد مشاهدته فذلك اتصال": "Unidireccional el dirección: no me llega de él cosa(si era transmite y quiero verlo eso es conexión",
  "⇐ أستقبله": "⇐ lo recibo",
  "، و": "، و",
  "يبقى": "Permanece",
  "📷 صورة": "📷 foto",
  "🎤 رسالة صوتية": "🎤 mensaje de voz",
  "مستخدم": "Usuario",
  "الآن": "El ahora",
  "📩 رسالة جديدة": "📩 mensaje nueva",
  "لديك إشعار جديد": "Tienes notificación nuevo",
  "الدردشة": "El chat",
  "غرفة مستخدمين": "Sala usuarios",
  "🔒 هذه الغرفة مغلقة حالياً": "🔒 esta sala cerrada actualmente",
  "تم الدخول إلى الغرفة بشكل مخفي": "Se el inicio de sesión a el sala de manera oculto",
  "👤 هذه الغرفة للأعضاء المسجلين فقط": "👤 esta el sala miembros el registrados solo",
  "تعذر الدخول للغرفة": "No se pudo el inicio de sesión sala",
  "تعذر تشغيل المقطع الصوتي": "No se pudo ejecutar el clip el de audio",
  "نص رسالة الروبوت": "Texto mensaje el bot",
  "اللون": "El color",
  "حجم الخط": "Tamaño el fuente",
  "اكتب نص رسالة الروبوت": "Escribe texto mensaje el bot",
  "تم تعديل رسالة الروبوت ✅": "Se editar mensaje el bot ✅",
  "تعذر تعديل الرسالة": "No se pudo editar el mensaje",
  "موضع المقطع": "Posición el clip",
  "شهر واحد": "Mes uno",
  "شهرين": "Dos meses",
  "شات الاردن": "Chat el Jordania",
  "عضو": "Miembro",
  "(متجاهل)": "(ignorado)",
  "انتهت هذه الحالة": "Terminó esta el estado",
  "تعذر فتح الحالة": "No se pudo abrir el estado",
  "حساب إداري": "Cuenta administrativa",
  "الصورة": "El foto",
  "ومنع الرسائل الخاصة بينكما": "Y bloquear mensajes privados entre ustedes",
  "تم إلغاء تجاهل": "Se cancelar ignorar",
  "تعذر تحديث قائمة التجاهل": "No se pudo actualizar lista el ignorar",
  "لا تملك صلاحية سحب المايك": "No tienes permiso para retirar el micrófono",
  "تم سحب المايك من": "Se retirar el micrófono de",
  "تعذر سحب المايك": "No se pudo retirar el micrófono",
  "لا تملك صلاحية سحب المايك مع المنع": "No tienes permiso para retirar el micrófono con el prevenir",
  "ومنع صعوده للبث": "Y bloquear su subida transmisión",
  "تعذر تنفيذ الإجراء": "No se pudo ejecutar el acción",
  "لا تملك صلاحية فك المنع": "No tienes permiso para levantar el prevenir",
  "سمحت لـ": "Permitiste a",
  "بالصعود إلى البث": "Subir a el transmisión",
  "لا تملك صلاحية الكتم": "No tienes permiso para el silenciar",
  "تعذر تغيير حالة الكتم": "No se pudo cambio estado el silenciar",
  "لا تملك صلاحية الطرد": "No tienes permiso para el expulsar",
  "تعذر طرد المستخدم": "No se pudo expulsar el usuario",
  "لا تملك صلاحية الحظر": "No tienes permiso para el bloqueo",
  "على الحساب والجهاز": "En el cuenta dispositivo",
  "غير معروف": "No conocido",
  "متصل الآن": "Conectado el ahora",
  "غير متصل": "No conectado",
  "،": "،",
  "كشف النكات متاح للإدارة العامة فقط": "Revelar el apodos disponible administración el públicas solo",
  "تعذر كشف النكات": "No se pudo revelar el apodos",
  "تعذر الإرسال": "No se pudo el enviar",
  "تعذر إتمام الترقية": "No se pudo completar el mejora",
  "قطر": "Qatar",
  "البحرين": "El Baréin",
  "سلطنة عمان": "Sultanato Omán",
  "سوريا": "Siria",
  "لبنان": "Líbano",
  "الجزائر": "El Argelia",
  "المغرب": "El Marruecos",
  "تونس": "Túnez",
  "ليبيا": "Libia",
  "اليمن": "El Yemen",
  "السودان": "El Sudán",
  "تعذر فتح الملف الشخصي": "No se pudo abrir el archivo el personal",
  "لا يوجد نبذة": "No hay biografía",
  "إبلاغ عن": "Informar sobre",
  "إلغاء تجاهل": "Cancelar ignorar",
  "تمت الإضافة لقائمة التجاهل 🚫": "Se el añadir a la lista el ignorar 🚫",
  "تم إلغاء التجاهل": "Se cancelar el ignorar",
  "مخفي 🔒": "Oculto 🔒",
  "تعذر الحذف": "No se pudo eliminado",
  "المتصفح لا يدعم التسجيل الصوتي": "El navegador no soporta el registro el de audio",
  "تعذر الحفظ": "No se pudo el guardar",
  "حذف المحادثة": "Eliminar el conversación",
  "تم حذف المحادثة ✅": "Se eliminar el conversación ✅",
  "تعذر حذف المحادثة": "No se pudo eliminar el conversación",
  "لا يمكن فتح الخاص مع مستخدم متجاهَل": "No se puede abrir el privado con usuario ignorado",
  "المحادثة الخاصة غير متاحة": "El chat privado no disponible",
  "تم بدء مكالمة": "Se iniciar llamada",
  "بدء": "Iniciar",
  "فائتة": "Perdida",
  "منتهية": "Terminada",
  "انقطعت": "Se cortó",
  "المدة": "El duración",
  "كاميرا مطفأة": "Cámara apagada",
  "عضويتك غير مسموح لها بإجراء مكالمات الفيديو الخاصة": "Tu membresía no permitido ella realizar llamadas el vídeo el privado",
  "تأكيد بدء مكالمة الفيديو 📹": "Confirmar iniciar llamada el vídeo 📹",
  "فيديو (غير محدود)": "Vídeo(no limitado)",
  "متصفحك لا يدعم المكالمات الخاصة": "Tu navegador no soporta el llamadas el privado",
  "تعذر الوصول إلى الكاميرا/الميكروفون:": "No se pudo el acceso a la cámara/el micrófono:",
  "يرجى منح الإذن": "Por favor conceder el permiso",
  "تعذر الوصول إلى الميكروفون:": "No se pudo el acceso a el micrófono:",
  "جاري التوصيل...": "El conectando...",
  "ضعف في الاتصال...": "Débil en el conexión...",
  "مكالمة فيديو جارية": "Videollamada en curso",
  "تم إيقاف الكاميرا": "Se detener la cámara",
  "تم تشغيل الكاميرا": "Se ejecutar la cámara",
  "الجودة: 360p (ثابتة)": "El calidad: 360p(fija)",
  "انقر لتصغير صورك • اسحبه للتحريك": "Haz clic reducir tus fotos• arrástralo mover",
  "انقر لتكبير صورك • اسحبه للتحريك": "Haz clic ampliar tus fotos• arrástralo mover",
  "انقر لتكبير صوره • اسحبه للتحريك": "Haz clic ampliar su foto• arrástralo mover",
  "انقر لتصغير صوره": "Haz clic reducir su foto",
  "تم رفض المكالمة": "Se rechazar el llamada",
  "المستخدم مشغول في مكالمة أخرى": "El usuario ocupado en llamada otra",
  "المستخدم غير متصل حالياً": "El usuario no conectado actualmente",
  "لا يمكن الاتصال بسبب التجاهل": "No se puede el conexión debido a el ignorar",
  "عضويتك غير مسموح لها بالمكالمات الخاصة": "Tu membresía no permitido ella llamadas el privado",
  "تم إلغاء المكالمة من الطرف الآخر": "Se cancelar el llamada de el parte el último",
  "تم إنهاء المكالمة": "Se finalizar el llamada",
  "انقطع اتصال الطرف الآخر": "Se cortó conexión el parte el último",
  "مكتوم": "Silenciado",
  "تم كتم الميكروفون": "Se silenciar el micrófono",
  "تم تشغيل الميكروفون": "Se ejecutar el micrófono",
  "سبيكر (مفعل)": "Altavoz(activado)",
  "مكبر": "Amplificado",
  "🔊 تم تشغيل مكبر الصوت (السبيكر)": "🔊 se ejecutar amplificado el voz(el altavoz)",
  "سماعة الأذن": "Auricular el oído",
  "أذن": "Oído",
  "📱 تم التحويل إلى سماعة الأذن الداخلية": "📱 se el transferencia a auricular el oído el interna",
  "مكالمة جارية": "Llamada en curso",
  "مكالمة فيديو خاصة واردة...": "Videollamada privado entrante...",
  "عضويتك غير مسموح لها بإرسال الرسائل الخاصة": "Tu membresía no permitido ella enviar mensajes privados",
  "عضويتك غير مسموح لها بنشر الحالات": "Tu membresía no permitido ella publicar el estados",
  "جاري نشر الحالة...": "Publicar el estado...",
  "جاري رفع الحالة...": "Subir el estado...",
  "تم نشر حالتك لمدة 24 ساعة ✓": "Se publicar tu estado durante 24 hora ✓",
  "تعذر نشر الحالة": "No se pudo publicar el estado",
  "نوع الملف لا يطابق نوع الحالة المختار": "Tipo el archivo no coincide tipo el estado el elegido",
  "اكتب نص الحالة أولاً": "Escribe texto el estado primero",
  "لا يمكن عرض المشاهدين": "No se puede mostrar el espectadores",
  "تم حذف الحالة": "Se eliminar el estado",
  "تعذر حذف الحالة": "No se pudo eliminar el estado",
  "حساب PayPal": "Cuenta PayPal",
  "حساب بنكي": "Cuenta bancario",
  "تعذر التحويل الآلي": "Falló la transferencia automática",
  "جارٍ التحويل تلقائيًا إلى حسابك 💸": "Transfiriendo automáticamente a tu cuenta 💸",
  "قيد المراجعة من الإدارة": "En revisión de el administración",
  "تم التحويل بنجاح": "Transferencia completada",
  "تم إرسال الدفعة (قد تكون قيد المعالجة)": "Se enviar el pago(puede ser en el procesamiento)",
  "لم تستلمي هدايا بعد — استقبلي الهدايا أولاً": "No recibes regalos después de — recibe el regalos primero",
  "— غير متاح حاليًا": "— no disponible actualmente",
  "بريد حساب PayPal الذي ستستلمين عليه المبلغ": "Correo cuenta PayPal el el recibirás él el monto",
  "رقم الحساب البنكي / رقم البطاقة (8-19 رقمًا)": "Número el cuenta el bancario / número el tarjeta(8-19 dígitos)",
  "اسم صاحب الحساب": "Nombre titular el cuenta",
  "أدخلي بريدك الإلكتروني المرتبط بحساب PayPal بشكل صحيح": "Introduce tu correo el electrónico el vinculado a la cuenta PayPal de manera correcto",
  "رقم الحساب غير صحيح — يجب أن يتكون من 8 إلى 19 رقمًا": "Número el cuenta no correcto — debes que consiste de 8 a 19 dígitos",
  "حددي كمية الهدايا المراد تسكيرها أولاً": "Especifica cantidad el regalos el deseado convertirlas primero",
  "تم إرسال طلب التسكير ✓ سيصلك إشعار فور اتمام التحويل": "Se enviar solicitud el conversión ✓ recibirás notificación inmediatamente completar el transferencia",
  "تعذر إلغاء التجاهل": "No se pudo cancelar el ignorar",
  "ليس لديك صلاحية دخول لوحة الإدارة": "No tienes permiso inicio de sesión el panel de administración",
  "جاري تأمين وفتح لوحة الإدارة بالرمز السري...": "Asegurar y abrir el panel de administración código el secreto...",
  "تعذر توليد رابط الإدارة": "No se pudo generación enlace el administración",
  "تعذر فتح لوحة الإدارة": "No se pudo abrir el panel de administración",
  "تم تغيير الحالة إلى": "Se cambio el estado a",
  "تم إرسال طلب التوثيق إلى لوحة الإدارة ✓ ولن يتم الخصم إلا بعد الموافقة": "Se enviar solicitud el verificación a el panel de administración ✓ y no se realiza el descuento excepto después de el aprobación",
  "الأسد الملكي": "El león el real",
  "يدخل كالأسد الهادر — قوة ومهابة": "Entra león el rugiente — fuerza y majestad",
  "الحوت الملكي": "El ballena el real",
  "يبحر في الغرفة بهدوء الملوك — عمق وهدوء": "Navega en el sala con calma el reyes — profundidad y calma",
  "العقاب الملكي": "El águila el real",
  "يحلّق فوق الجميع — حرية وقوة": "Planea sobre el todos — libertad y fuerza",
  "الوحيد قرن": "El unicornio cuerno",
  "يسطع قوس قزح أينما دخل — تميز فريد": "Brilla arco iris dondequiera entró — distinción único",
  "الفراشة الملكية": "El mariposa el propiedad",
  "ترفرف بألوانها أينما دخلت — رقيّ وأنوثة": "Aletea con sus colores dondequiera entró — refinamiento y feminidad",
  "القطة الملكية": "El gato el propiedad",
  "دخول لطيف يخطف القلوب — نعومة ودلال": "Inicio de sesión tierno roba el corazones — suavidad y encanto",
  "الوردة الحمراء": "El rosa el roja",
  "تدخل كوردة حمراء فاخرة — جمال ملكي": "Entras como rosa roja lujosa — belleza real",
  "الوردة المتفتحة": "El rosa el floreciente",
  "تتفتّح الغرفة بجمالها — سحر وأنوثة": "Florece el sala con su belleza — encanto y feminidad",
  "الوردة الوردية": "El rosa el rosada",
  "وردة وردية ناعمة — دخول ملكي للبنات": "Rosa rosada suave — inicio de sesión real chicas",
  "دخول ملكي مميز — حضور يليق بك": "Inicio de sesión real premium — presencia le queda ti",
  "دخول ملكي": "Inicio de sesión real",
  "✋ طلبك لتغيير الحيوان الملكي قيد المراجعة لدى الإدارة — سيصلك إشعار بنتيجة الموافقة.": "✋ tu solicitud cambiar animal real en revisión en el administración — recibirás notificación con el resultado el aprobación.",
  "تعذر إرسال طلب التغيير": "No se pudo enviar solicitud el cambio",
  "البنك التجاري المعتمد": "El banco el comercial el verificado",
  "الأكثر طلباً": "El más solicitado",
  "لا توجد باقات متاحة حالياً": "No hay paquetes disponible actualmente",
  "يجب تسجيل الدخول بحساب مسجل لإتمام عملية الشراء": "Debes registro el inicio de sesión a la cuenta registrado completar operación el compra",
  "تعذر إنشاء العملية": "No se pudo crear el operación",
  "الحساب التجاري مقيد لدى PayPal ولا يستطيع قبول الدفعات — يرجى حل القيد من حساب PayPal (تفعيل الحساب وإكمال بيانات العمل) أو استخدام وضع «تجريبي» بحساب Business مُفعّل.": "El cuenta el comercial restringido en PayPal ni puede aceptar el pagos — por favor resolver el en de cuenta PayPal(activación el cuenta y completar datos el negocio) o uso modo«demo» a la cuenta Business activado.",
  "حدث خطأ أثناء الدفع —": "Ocurrió error durante el pago —",
  "لم تنجح العملية —": "No tiene éxito el operación —",
  "حاول مجدداً.": "Intenta de nuevo.",
  "ألغيت عملية الدفع — لم يُخصم أي مبلغ": "Cancelaste operación el pago — no se descuenta cualquier monto",
  "جاري تحميل بوابة الدفع الآمن...": "Carga pasarela el pago el seguro...",
  "الملف يجب أن يكون صورة": "El archivo debes que ser foto",
  "حجم الصورة يجب ألا يتجاوز 8MB": "Tamaño el foto debes no supere 8MB",
  "تعذر رفع الصورة المرفقة": "No se pudo subir el foto el adjunta",
  "تم إرسال الشكوى إلى الإدارة": "Se enviar el queja a el administración",
  "تعذر إرسال الشكوى": "No se pudo enviar el queja",
  "لا توجد صور مرفوعة بعد": "No hay fotos subida después de",
  "اضغط على \"رفع صورة\" بالأسفل (يتم حفظ حتى 10 صور)": "Pulsa en \"subir foto\" abajo(se realiza guardar hasta 10 fotos)",
  "جاري رفع الصورة الشخصية...": "Subir el foto el personal...",
  "تم رفع الصورة وحفظها في قائمة مرفوعاتي ✅": "Se subir el foto y guardarla en lista mis subidas ✅",
  "تعذر رفع الصورة": "No se pudo subir el foto",
  "تم حفظ الصورة بنجاح ✅": "Se guardar el foto con éxito ✅",
  "تعذر حفظ الصورة": "No se pudo guardar el foto",
  "فيديو YouTube": "Vídeo YouTube",
  "اضغط للمشاهدة في العارض الكامل": "Pulsa ver en el visor el completo",
  "فيديو مرفوع": "Vídeo subido",
  "اضغط لتشغيل الفيديو كاملاً": "Pulsa reproducir el vídeo completa",
  "اضغط لعرض الصورة كاملة": "Pulsa mostrar el foto completa",
  "يمكنك تكبير الصورة من المتصفح": "Puedes ampliar el foto de el navegador",
  "استخدم أزرار المشغل للتحكم بالصوت والمشاهدة": "Usa botones el reproductor control voz ver",
  "فتح في YouTube": "Abrir en YouTube",
  "فتح الصورة الأصلية": "Abrir el foto el original",
  "فتح الفيديو الأصلي": "Abrir el vídeo el original",
  "عضويتك غير مسموح لها بالنشر على الحائط": "Tu membresía no permitido ella publicar en el muro",
  "اكتب كلمات البحث في YouTube": "Escribe palabras el búsqueda en YouTube",
  "تعذر البحث في YouTube": "No se pudo el búsqueda en YouTube",
  "جاري رفع الصورة...": "Subir el foto...",
  "جاري رفع صورة الحائط...": "Subir foto el muro...",
  "تم رفع الصورة بنجاح": "Se subir el foto con éxito",
  "جاري رفع الفيديو...": "Subir el vídeo...",
  "جاري رفع فيديو الحائط...": "Subir vídeo el muro...",
  "جاري تجهيز صورة معاينة الفيديو...": "Preparar foto vista previa el vídeo...",
  "تم رفع الفيديو وتجهيز صورة المعاينة بنجاح": "Se subir el vídeo y preparar foto el vista previa con éxito",
  "تم رفع الفيديو بنجاح": "Se subir el vídeo con éxito",
  "تعذر رفع الفيديو": "No se pudo subir el vídeo",
  "جاري نشر المنشور على الحائط...": "Publicar el publicación en el muro...",
  "تم نشر المنشور": "Se publicar el publicación",
  "تعذر نشر المنشور": "No se pudo publicar el publicación",
  "لا توجد إشعارات لحذفها": "No hay notificaciones eliminarlas",
  "تم حذف جميع الإشعارات بنجاح ✓": "Se eliminar todos el notificaciones con éxito ✓",
  "تعذر حذف الإشعارات": "No se pudo eliminar el notificaciones",
  "أدخل البريد الإلكتروني المسجل": "Introduce el correo electrónico el registrado",
  "📧 تم إرسال رمز الاستعادة إلى بريدك": "📧 se enviar código el recuperación a tu correo",
  "تعذر إرسال الرمز": "No se pudo enviar el código",
  "📧 أُعيد إرسال الرمز": "📧 reenviado enviar el código",
  "تعذر إعادة الإرسال": "No se pudo re- el enviar",
  "إعادة الإرسال (": "Re- el enviar(",
  "ث)": "Seg)",
  "أدخل رمز الاستعادة المكون من 6 أرقام": "Introduce código el recuperación el compuesto de de 6 dígitos",
  "كلمة المرور الجديدة 4 خانات على الأقل": "La nueva contraseña 4 caracteres en el menos",
  "كلمتا المرور غير متطابقتين": "Las contraseñas no coinciden",
  "✅ تم تغيير كلمة المرور — ادخل الآن بكلمة المرور الجديدة": "✅ se cambio contraseña — entra el ahora conla nueva contraseña",
  "تعذر تغيير كلمة المرور": "No se pudo cambio contraseña",
  "؟": "؟",
  "فشل الدخول": "Fallo el inicio de sesión",
  "ضيف": "Invitado",
  "نجم": "Estrella",
  "عاشق": "Amor",
  "مغامر": "Aventurero",
  "همس": "Susurro",
  "شهم": "Valiente",
  "ذوق": "Elegante",
  "أهلا بك كزائر": "Bienvenido ti como visitante",
  "⚠️ خدمة البريد (SMTP) غير مفعّلة من لوحة الإدارة — لم يُرسل الرمز بعد": "⚠️ el servicio de correo(SMTP) no está activado desde el panel de administración — no se envía el código después de",
  "⚠️ تعذر إرسال البريد:": "⚠️ no se pudo enviar el correo:",
  "جارٍ تجهيز قالب رمز التفعيل...": "Cargando preparar plantilla código el activación...",
  "أدخل رمز التفعيل المكوّن من 6 أرقام": "Introduce código el activación el compuesto de 6 dígitos",
  "تم تفعيل حسابك بنجاح 🎉": "Se activación tu cuenta con éxito 🎉",
  "تعذر التفعيل — تحقق من الرمز": "No se pudo el activación — verifica de el código",
  "يرجى الانتظار قبل إعادة الإرسال": "Por favor el espera antes de re- el enviar",
  "تم إرسال رمز جديد إلى جيميلك 📧": "Se enviar código nuevo a tu Gmail 📧",
  "⚠️ خدمة البريد غير مفعّلة — لم يُرسل الرمز": "⚠️ el servicio de correo no está activado — no se envía el código",
  "البريد يجب أن يكون Gmail (ينتهي بـ @gmail.com)": "El correo debes que ser Gmail(termina con @gmail.com)",
  "فشل التسجيل": "Fallo el registro",
  "إيقاف البث والمكالمة": "Detener el transmisión llamada",
  "إيقاف المكالمة": "Detener el llamada",
  "إيقاف البث": "Detener el transmisión",
  "إيقاف البث والمكالمة والمتابعة": "Detener el transmisión llamada continuar",
  "لا يمكنك الانتقال إلى غرفة أخرى أثناء مكالمة جارية. يجب إغلاق المكالمة أولاً ثم يمكنك الدخول إلى الغرفة الأخرى.": "No se puedecomo el cambiar a sala otra durante llamada en curso. debes cerrar el llamada primero luego puedes el inicio de sesión a el sala el otra.",
  "إيقاف المكالمة والمتابعة": "Detener el llamada continuar",
  "لا يمكنك الانتقال إلى غرفة أخرى أثناء البث المباشر. يجب إغلاق البث أولاً ثم يمكنك الدخول إلى الغرفة الأخرى.": "No se puedecomo el cambiar a sala otra durante transmisión en vivo. debes cerrar el transmisión primero luego puedes el inicio de sesión a el sala el otra.",
  "إيقاف البث والمتابعة": "Detener el transmisión continuar",
  "— اضغط للتشغيل/الإيقاف": "— pulsa ejecutar/el detener",
  "اضغط زر الراديو مرة أخرى للاستماع": "Pulsa botón el radio vez otra escuchar",
  "تم حذف «العام» لديك فقط — يبقى ظاهراً لبقية المستخدمين": "Se eliminar«el público» tienes solo — permanece visible para el resto el usuarios",
  "تعذر حذف «العام»": "No se pudo eliminar«el público»",
  "السوبر أدمن": "El súper admin",
  "تم حذف «العام» من الغرفة بالكامل 🧹 بواسطة": "Se eliminar«el público» de el sala completo 🧹 por",
  "تعذر حذف «العام» للجميع": "No se pudo eliminar«el público» todos",
  "اكتب كلمة المرور الحالية": "Escribe contraseña el actual",
  "كلمة المرور الجديدة يجب أن لا تقل عن 4 خانات": "La nueva contraseña debes que no menos de sobre 4 caracteres",
  "تم تغيير كلمة المرور بنجاح ✅": "Se cambio contraseña con éxito ✅",
  "تم تغيير اللغة": "Se cambio el idioma",
  "عضويتك غير مسموح لها بإرسال الرسائل في العام": "Tu membresía no permitido ella enviar el mensajes en el público",
  "اختر مستخدماً أولاً": "Elige como usuario primero",
  "تم تغيير لون خطك 🎨": "Se cambio color tu fuente 🎨",
  "رجع لون خطك للون رتبتك": "Volvió color tu fuente color tu rango",
  "جاري رفع المقطع الصوتي...": "Subir el clip el de audio...",
  "جاري رفع الصورة إلى العام...": "Subir el foto a el público...",
  "جاري رفع الصورة إلى الخاص...": "Subir el foto a el privado...",
  "فحص الصورة قبل الإرسال": "Revisar el foto antes de el enviar",
  "فحص المقطع الصوتي قبل الإرسال": "Revisar el clip el de audio antes de el enviar",
  "تعذر فحص الملف أو أن تنسيقه غير مدعوم": "No se pudo revisar el archivo o que su formato no soportado",
  "تم فحص الصورة ويمكن إرسالها": "Se revisar el foto y se puede enviarla",
  "تم فحص المقطع ويمكن إرساله": "Se revisar el clip y se puede enviarlo",
  "اختر عضواً أولاً": "Elige un miembro primero",
  "المحادثة الخاصة غير مفتوحة": "El chat privado no abierta",
  "عضويتك غير مسموح لها بإرسال الصور في الخاص": "Tu membresía no permitido ella enviar el fotos en el privado",
  "عضويتك غير مسموح لها بإرسال الصور في العام": "Tu membresía no permitido ella enviar el fotos en el público",
  "عضويتك غير مسموح لها بإرسال المقاطع الصوتية": "Tu membresía no permitido ella enviar el clips el de voz",
  "تعذر إنشاء التسجيل الصوتي": "No se pudo crear el registro el de audio",
  "عضويتك غير مسموح لها بإرسال الرسائل الصوتية في الخاص": "Tu membresía no permitido ella enviar el mensajes el de voz en el privado",
  "اعدادات الخاص : استقبال الرسائل من الجميع": "Ajustes el privado: recepción el mensajes de el todos",
  "محاولة إعادة الاتصال رقم": "Intentar re- el conexión número",
  "تمت إضافة": "Se añadir",
  "ذهب إلى رصيدك بواسطة الإدارة (الرصيد:": "Oro a tu saldo por el administración(el saldo:",
  "تم تعديل رصيدك بواسطة الإدارة (الرصيد:": "Se editar tu saldo por el administración(el saldo:",
  "تم تغيير اسم حسابك إلى:": "Se cambio nombre tu cuenta a:",
  "بنجاح ✨": "Con éxito ✨",
  "تم حذف العام من قبل": "Se eliminar el público de antes de",
  "👑 مُنح لك الدخول الملكي بـ": "👑 concedido para ti entrada real con",
  "! سيظهر توهجه عند دخولك الغرف": "! aparecerá su brillo en tu entrada el salas",
  "تم خصم": "Se descuento",
  "ذهب رسوم المكالمة (الرصيد:": "Oro tarifas el llamada(el saldo:",
  "فتح الكاميرا 📷": "Abrir la cámara 📷",
  "أغلق الكاميرا 📷": "Cierra la cámara 📷",
  "وافق على مشاهدتك لبثه": "Aprobó en verte su transmisión",
  "آخرين": "Otros",
  "يتحدث الآن مباشرة": "Está hablando el ahora directamente",
  "يبثون فيديو مباشر الآن — اضغط على صورة أحدهم للمشاهدة": "Transmiten vídeo en vivo el ahora — pulsa en foto uno de ellos ver",
  "يبث فيديو مباشر الآن — اضغط على صورته للمشاهدة": "Transmite vídeo en vivo el ahora — pulsa en su fotoğraf ver",
  "مشاهد": "Espectadores",
  "• تشاهد بث": "• ves transmisión",
  "• تشاهد": "• ves",
  "بثوث": "Transmisiones",
  "تشاهد": "Ves",
  "بثوث مباشرة": "Transmisiones directamente",
  "(أنت)": "(tú)",
  "يريد مشاهدة البث": "Quiere ver el transmisión",
  "قبول": "Aceptar",
  "يطلب الإذن للتحدث": "Solicita el permiso habla",
  "المتحدثون الحاليون": "El hablantes el actuales",
  "تم إرسال طلب مشاهدة إلى": "Se enviar solicitud ver a",
  "— بانتظار موافقته…": "— esperando su aprobación…",
  "— عند موافقته سيُعرض بثه بجانب البثوث الحالية": "— en su aprobación se mostrará su transmisión junto a el transmisiones el actual",
  "نظام الطرد": "Sistema el expulsar",
  "نظام الحظر": "Sistema el bloqueo",
  "أشهر": "Meses",
  "شهراً": "Meses",
  "نظام الترقية": "Sistema el mejora",
  "لمدة": "Durante",
  "تم اهداء": "Se regalo",
  "بواسطة": "Por",
  "أرسل هذه الترقية إلى": "Envía esta el mejora a",
  "قام": "Hizo",
  "بإرسال هدية": "Enviar regalo",
  "أرسل هذه الهدية إلى": "Envía esta el regalo a",
  "الكمية ×": "La cantidad ×",
  "👑 دخول ملكي •": "👑 inicio de sesión real•",
  "👑 هدية ملكية •": "👑 regalo propiedad•",
  "عنوان IP:": "Título IP:",
  "الدولة:": "El país:",
  "عدد الأسماء من نفس الـ IP:": "Número de el nombres de mismo el IP:",
  "وقت الدخول:": "Hora el inicio de sesión:",
  "تم إرسال": "Se enviar",
  "بنجاح 🎉": "Con éxito 🎉",
  "تمت ترقية": "Se mejora",
  "بنجاح 👑": "Con éxito 👑",
  "رصيد الذهب غير كافٍ (المطلوب:": "Saldo de oro no suficiente(el requerido:",
  "الهدية من": "El regalo de",
  "كمية:": "Cantidad:",
  "سنة": "Año",
  "اسم المستخدم": "Nombre de usuario",
  "الجنس": "El género",
  "الدولة": "El país",
  "العضوية": "El membresía",
  "الرصيد": "El saldo",
  "حذف المحادثة مع": "Eliminar el conversación con",
  "هل ترغب في بدء مكالمتك الصوتية التجريبية الأولى مع": "¿ deseas en iniciar tu llamada el de voz el de prueba el primera con",
  "هذه المكالمة مجانية بالكامل لأول دقيقة (60 ثانية).": "Esta el llamada gratis completo para la primera minuto(60 segundo).",
  "يرجى شحن رصيدك لتتمكن من إجراء المكالمة.": "Por favor recarga tu saldo para poder de acción el llamada.",
  "الميزة:": "El ventaja:",
  "مجانية بالكامل (0 ذهب)": "Gratis completo(0 oro)",
  "سيتم خصم": "Se descuento",
  "من رصيدك عند رد": "De tu saldo en responder",
  "على مكالمة الفيديو 📹": "En llamada el vídeo 📹",
  "تم استهلاك التجربة المجانية مسبقاً. سيتم خصم": "Se consumido el prueba el gratis previamente. se descuento",
  "على المكالمة.": "En el llamada.",
  "آخر تحديث": "Último actualizar",
  "من:": "De:",
  "حالة التحويل": "Estado el transferencia",
  "(رقم الدفعة": "(número el pago",
  "تعذر الإرسال الآلي — لم تُحذف هداياك": "No se pudo el enviar el automático — no se eliminan tus regalos",
  "تسكير الهدايا": "Conversión de regalos",
  "هدايا محددة للتسكير": "Regalos especificada conversión",
  "ذهب الهدايا المحددة": "Oro el regalos el especificada",
  "المبلغ الذي سيُحوَّل إلى حسابك": "El monto el el se transferirá a tu cuenta",
  "طريقة الاستلام": "Método el recepción",
  "مجموع ذهب هداياك": "Total oro tus regalos",
  "🪙 والمتطلبات للتسكير": "🪙 requisitos conversión",
  "🪙 — ينقصك": "🪙 — te falta",
  "تسكير الهدايا إلى دولارات 💵": "Conversión de regalos a dólares 💵",
  "معدل التحويل:": "Tasa el transferencia:",
  "لكل": "Por",
  "— المبلغ يتناسب طردياً مع الكمية (يحدّده الإداري)": "— el monto es proporcional directamente con la cantidad(lo determina el administrativo)",
  "عدد الهدايا المستلمة": "Número de el regalos el recibida",
  "الحد الأدنى للتسكير": "El límite el mínimo conversión",
  "حددي كمية الهدايا التي تريدين تسكيرها": "Especifica cantidad el regalos que quieres convertirlas",
  "المحددة:": "El especificada:",
  "هدية) / الحد الأدنى": "Regalo) / el límite el mínimo",
  "المتابعة لبيانات الحساب (": "El continuar para datos el cuenta(",
  "بيانات حساب الاستلام": "Datos cuenta el recepción",
  "هدية محددة": "Regalo especificada",
  "💵 سيُحوَّل $": "💵 se transferirá $",
  "يُخصم": "Se descuenta",
  "المحدد فقط": "El especificado solo",
  ") من حسابك وتبقى بقية الهدايا المتكررة كما هي.": ") de tu cuenta y permanecen resto el regalos el repetidas como es.",
  "حساب باي بال (تحويل تلقائي من حساب الإدارة)": "Cuenta Pay Pal(transferencia automático de cuenta el administración)",
  "حساب بنكي (تحويل يدوي من الإدارة — ليس فوريًا)": "Cuenta bancario(transferencia manual de el administración — no instantáneo)",
  "إرسال طلب التسكير ($": "Enviar solicitud el conversión($",
  "متجاهل • الرسائل الخاصة متوقفة": "Ignorado• mensajes privados detenidas",
  "حسابك يحمل الدخول الملكي 👑 — الصلاحية حتى": "Tu cuenta lleva entrada real 👑 — el permiso hasta",
  ". اختر حيواناً آخر ثم اضغط «تغيير الحيوان الملكي».": ". elige otro animal último luego pulsa«cambio animal real».",
  "تم إرسال طلبك للدخول الملكي بـ": "Se enviar tu solicitud inicio de sesión el real con",
  "إلى لوحة الإدارة ✓ لن يتم الخصم إلا بعد الموافقة": "A el panel de administración ✓ no se realiza el descuento excepto después de el aprobación",
  "تم إرسال طلب تغيير حيوانك الملكي إلى": "Se enviar solicitud cambio tu animal el real a",
  "للإدارة ✓": "Administración ✓",
  "🎉 تمت عملية الدفع بنجاح! شحن": "🎉 se operación el pago con éxito! recarga",
  "ذهب (": "Oro(",
  ") إلى رصيدك 🪙": ") a tu saldo 🪙",
  "الدفع الإلكتروني غير متاح حالياً — تواصل مع الإدارة": "El pago el electrónico no disponible actualmente — contacta con el administración",
  "بوابة الدفع لم تُفعّل بعد — يرجى التواصل مع الإدارة": "Pasarela el pago no se activa después de — por favor el contacta con el administración",
  "بلا إطلالة": "Sin look",
  "صورة مرفقة بالمنشور": "Foto adjunta publicación",
  "اضغط هنا لفتح الصورة بالحجم الكامل": "Pulsa aquí abrir el foto tamaño el completo",
  "اضغط للمشاهدة داخل المشغل": "Pulsa ver dentro de el reproductor",
  "مقطع فيديو": "Clip vídeo",
  "اضغط لتشغيل الفيديو في المشغل": "Pulsa reproducir el vídeo en el reproductor",
  "إظهار المزيد (": "Mostrar el más(",
  "تفاعل •": "Interacción•",
  "الاسم": "El nombre",
  "جلسة أو رابط الإدارة": "Sesión o enlace el administración",
  "منتهي الصلاحية": "Expirado el permiso",
  "انتهت صلاحية جلسة الإدارة نظراً لتوليد رمز جديد في الدردشة": "Terminó permiso sesión el administración debido generar código nuevo en el chat",
  "القيمة:": "El valor:",
  "الغرفة:": "El sala:",
  "🏠 الغرفة:": "🏠 el sala:",
  "📅 تاريخ التعيين:": "📅 fecha el asignación:",
  "الرابط :": "El enlace:",
  "الترتيب:": "El orden:",
  "تاريخ:": "Fecha:",
  "المستخدم:": "El usuario:",
  "تم حفظ وتطبيق إعدادات اللغة بنجاح": "Se guardar y aplicar ajustes el idioma con éxito",
  "إعدادات الراديو": "Ajustes el radio",
  "البريد الإلكتروني والتحقق (Gmail)": "El correo electrónico verifica(Gmail)",
  "الشروط والخصوصية": "El términos privacidad",
  "شكاوى المستخدمين": "Quejas el usuarios",
  "هدايا حساب (بحث وحذف)": "Regalos cuenta(búsqueda y eliminar)",
  "تسكير الهدايا (سحب الدولارات)": "Conversión de regalos(retirar el dólares)",
  "تسجيلات المكالمات الصوتية": "Grabaciones el llamadas el de voz",
  "تسجيل مكالمات الفيديو": "Registro llamadas el vídeo",
  "صور وأصوات الدخول الملكي": "Fotos y sonidos entrada real",
  "تتبع المستخدمين": "Seguimiento el usuarios",
  "✓ صوت مخصص مرفوع": "✓ voz personalizado subido",
  "🔊 نغمة افتراضية": "🔊 tono predeterminada",
  "🔇 مكتوم (مفصول)": "🔇 silenciado(desconectado)",
  "سوبر أدمن / المالك": "Súper admin / el propietario",
  "عضوية مميز": "Membresía premium",
  "عضوية VIP": "Membresía VIP",
  "عضوية Premium": "Membresía Premium",
  "عضوية Plus": "Membresía Plus",
  "شارة الدخول المخفي": "Insignia el inicio de sesión el oculto",
  "🔊 صوت الهدية مرفق": "🔊 voz el regalo adjunto",
  "🔇 بدون صوت": "🔇 sin voz",
  "👑 نمط ملكي": "👑 estilo real",
  "🎁 نمط عادي": "🎁 estilo normal",
  "⚙️ تلقائي حسب القيمة": "⚙️ automático según el valor",
  "تعذر تشغيل صوت الهدية": "No se pudo ejecutar voz el regalo",
  "تم الحذف": "Se eliminado",
  "تعذر اتمام العملية": "No se pudo completar el operación",
  "سبب الرفض (اختياري):": "Razón el rechazar(opcional):",
  "تم رفض الطلب وإبلاغ المستلمة": "Se rechazar el solicitud y informar el recibida",
  "تعذر رفض الطلب": "No se pudo rechazar el solicitud",
  "لم يدخل غرفة بعد": "No entra sala después de",
  "دولة عنوان IP": "País título IP",
  "حظر من صفحة الرصد": "Bloqueo de página el monitoreo",
  "تم حظر عنوان IP": "Se bloqueo título IP",
  "وفصل جميع اتصالاتهم": "Y desconectar todos sus conexiones",
  "تعذر حظر عنوان IP": "No se pudo bloqueo título IP",
  "داخل الموقع": "Dentro de el sitio",
  "بلا اسم": "Sin nombre",
  "من أين دخل": "De dónde entró",
  "كلمة البحث": "Palabra el búsqueda",
  "الرابط / المسار": "El enlace / el ruta",
  "الوقت": "El hora",
  "الاعدادات: كل التفاصيل + الحظر": "El ajustes: todo el detalles + el bloqueo",
  "سري": "Secreto",
  "✅ عضو مسجل": "✅ miembro registrado",
  "👤 زائر (غير مسجل)": "👤 visitante(no registrado)",
  "🟢 متصل الآن": "🟢 conectado el ahora",
  "⚪ غير متصل حالياً": "⚪ no conectado actualmente",
  "الرابط القادم": "El enlace el entrante",
  "المسار الذي دخل إليه": "El ruta el el entró a él",
  "عنوان IP": "Título IP",
  "الجهاز / المتصفح": "El dispositivo / el navegador",
  "وقت الدخول": "Hora el inicio de sesión",
  "دولة الحساب": "País el cuenta",
  "الرصيد (ذهب)": "El saldo(oro)",
  "تاريخ إنشاء الحساب": "Fecha crear el cuenta",
  "آخر دخول": "Último inicio de sesión",
  "إجمالي عمليات الدخول": "Total operaciones el inicio de sesión",
  "فك الحظر عن الحساب": "Levantar el bloqueo sobre el cuenta",
  "🚫 حظر المستخدم (الحساب + الجهاز)": "🚫 bloqueo el usuario(el cuenta + el dispositivo)",
  "لأنه عضو مسجل فالأفضل «حظر المستخدم» — أما الزائر غير المسجل فيُحظر عبر IP وأجهزته.": "Porque miembro registrado mejor«bloqueo el usuario» — en cuanto el visitante no el registrado se bloquea vía IP y su dispositivo.",
  "حظر من صفحة تتبع المستخدمين": "Bloqueo de página seguimiento el usuarios",
  "تم حظر المستخدم وفصله فوراً 🚫": "Se bloqueo el usuario y desconectarlo inmediatamente 🚫",
  "تم فك الحظر عن المستخدم": "Se levantar el bloqueo sobre el usuario",
  "تعذر تنفيذ الحظر": "No se pudo ejecutar el bloqueo",
  "وفصل جميع اتصالاتهم 🚫": "Y desconectar todos sus conexiones 🚫",
  "🟢 متواجد داخل الغرفة": "🟢 en la sala",
  "⚪ متوقف وغير ظاهر": "⚪ detenido y otros visible",
  "تم إيقاف الروبوت": "Se detener el bot",
  "تم إدخال الروبوت إلى الغرفة": "Se entrada el bot a el sala",
  "تم حذف الهدية من حساب المستخدم ✓": "Se eliminar el regalo de cuenta el usuario ✓",
  "تعذر حذف الهدية": "No se pudo eliminar el regalo",
  "تعذر حذف الهدايا": "No se pudo eliminar el regalos",
  "تم رفع الإيموجي وظهر فوراً لجميع المتصلين ⚡": "Se subir el emoji y apareció inmediatamente para todos el conectados ⚡",
  "اختيار ملفات الصور:": "Selección archivos el fotos:",
  "اختيار ورفع الصور (يمكن تحديد عدة صور)": "Selección y subir el fotos(se puede seleccionar varios fotos)",
  "إعلان": "Anuncio",
  "تم رفع وحفظ الرمزيات بنجاح ✓": "Se subir y guardar el avatares con éxito ✓",
  "تلقائي (عنابي)": "Automático(granate)",
  "تم حفظ الجلد": "Se guardar el skin",
  "تم حفظ حجم الخط": "Se guardar tamaño el fuente",
  "اسم الراديو (يظهر داخل الدردشة)": "Nombre el radio(aparece dentro de el chat)",
  "تفعيل الراديو في الدردشة": "Activación el radio en el chat",
  "تم حفظ إعدادات الراديو — يتحدّث المشغل فوراً في الدردشة": "Se guardar ajustes el radio — está hablando el reproductor inmediatamente en el chat",
  "تم إيقاف التجربة.": "Se detener el prueba.",
  "✋ ضع رابط البث أولاً في الحقل أعلاه ثم اضغط تجربة.": "✋ pon enlace el transmisión primero en el campo arriba luego pulsa prueba.",
  "⏳ جاري الاتصال بالبث…": "⏳ cargando el conexión transmisión…",
  "✅ البث يعمل الآن — هذا بالضبط ما سيسمعه المستخدمون في الدردشة.": "✅ el transmisión funciona el ahora — este ajustar qué lo escuchará el usuarios en el chat.",
  "❌ تعذر تشغيل الرابط — تحقق أنه رابط بث مباشر صالح (mp3/aac).": "❌ no se pudo ejecutar el enlace — verifica que enlace transmisión en vivo válido(mp3/aac).",
  "❌ تعذر الوصول للرابط — تحقق من صحة رابط البث وأنه يعمل.": "❌ no se pudo el acceso enlace — verifica de corrección enlace el transmisión que funciona.",
  "● مفتوحة": "● abierta",
  "● مغلقة": "● cerrada",
  "اسم الغرفة": "Nombre el sala",
  "اتركها فارغة ليبدأ العام بدون أي رسالة": "Déjala vacía para empezar el público sin cualquier mensaje",
  "تمكين الصوت": "Habilitar el voz",
  "تمكين الفيديو": "Habilitar el vídeo",
  "تفعيل الروبوت (eabrmp)": "Activación el bot(eabrmp)",
  "تفعيل الهدايا (eabvg)": "Activación el regalos(eabvg)",
  "تفعيل الألعاب (gm)": "Activación el juegos(gm)",
  "اتركها فارغة بدون كلمة مرور": "Déjala vacía sin palabra paso",
  "معاينة الغرفة": "Vista previa el sala",
  "تم رفع صورة الغرفة": "Se subir foto el sala",
  "اكتب اسم الغرفة": "Escribe nombre el sala",
  "تم تعديل الغرفة": "Se editar el sala",
  "تمت اضافة الغرفة بنجاح": "Se añadir el sala con éxito",
  "اكتب اسم المستخدم المسجل بدقة": "Escribe nombre el usuario el registrado con precisión",
  "صوتية": "De voz",
  "كتابية": "De texto",
  "اختر الغرفة أولاً": "Elige el sala primero",
  "تعذر تعيين المشرف": "No se pudo asignación el moderador",
  "مثال: أهلاً وسهلاً بكم في الدردشة ★": "Ejemplo: bienvenido bienvenido cuántos en el chat ★",
  "تمت الإضافة — يعمل الروبوت فوراً ⚡": "Se el añadir — funciona el bot inmediatamente ⚡",
  "لم تُرفع صورة بعد": "Aún no se ha subido imagen",
  "مثال: رفيق_الدردشة": "Ejemplo: compañero_el chat",
  "توليد الزائر وإدخاله": "Generación el visitante y desplegarlo",
  "اسم الزائر (اختياري)": "Nombre el visitante(opcional)",
  "اتركه فارغاً لتوليد اسم عربي طبيعي تلقائياً": "Déjalo vacío generar nombre árabe natural automáticamente",
  "ستُختار صورة عشوائية من المكتبة تلقائياً": "Se elegirá una imagen aleatoria de la biblioteca",
  "تم رفع الصورة": "Se subir el foto",
  "تم توليد الروبوت وإدخاله ⚡": "Se generación el bot y desplegarlo ⚡",
  "تم حفظ التعديلات بنجاح ⚡": "Se guardar el cambios con éxito ⚡",
  "أدخل مفتاح الـ API الخاص بالمزود المختار هنا...": "Introduce clave el API el privado proveedor el elegido aquí...",
  "مثال: gemini-1.5-flash أو llama-3.3-70b-versatile أو gpt-4o-mini": "Ejemplo: gemini-1.5-flash o llama-3.3-70b-versatile o gpt-4o-mini",
  "التوجيه العام لشخصية الذكاء الاصطناعي...": "El orientación el público para el personaje el inteligencia el artificial...",
  "اكتب سؤالك التجريبي هنا...": "Escribe tu pregunta el demo aquí...",
  "تم حفظ إعدادات العقل العصبي والذكاء الاصطناعي بنجاح ✅": "Se guardar ajustes el cerebro el neuronal inteligencia el artificial con éxito ✅",
  "تعذر حفظ الإعدادات": "No se pudo guardar el ajustes",
  "اكتب سؤالاً تجريبياً أولاً": "Escribe una pregunta como demo primero",
  "جاري التفكير والتوليد عبر العقل العصبي للذكاء الاصطناعي... ⏳": "El pensando generación vía el cerebro el neuronal inteligencia el artificial... ⏳",
  "أحمد": "Ahmed",
  "البوت_الذكي": "El bot_el inteligente",
  "🤖 المزود:": "🤖 el proveedor:",
  "⚡ زمن الاستجابة:": "⚡ tiempo el respuesta:",
  "تم توليد الرد بنجاح ⚡": "Se generación el responder con éxito ⚡",
  "خطأ في التوليد:": "Error en el generación:",
  "فشل الاتصال": "Fallo el conexión",
  "فشل التوليد": "Fallo el generación",
  "تفعيل إرسال البريد (SMTP)": "Activación enviar el correo(SMTP)",
  "خادم SMTP (host)": "Servidor SMTP(host)",
  "المنفذ (port) — 587 أو 465": "El endpoint(port) — 587 o 465",
  "بريد SMTP (user)": "Correo SMTP(user)",
  "كلمة مرور SMTP / كلمة مرور تطبيق": "Palabra paso SMTP / palabra paso aplicación",
  "اتصال آمن (SSL/TLS — اختره مع المنفذ 465)": "Conexión seguro(SSL/TLS — elígelo con el endpoint 465)",
  "اسم/بريد المرسل (from)": "Nombre/correo el remitente(from)",
  "بريد Gmail لتجربة الإرسال (مثال: you@gmail.com)": "Correo Gmail probar el enviar(ejemplo: you@gmail.com)",
  "you@gmail.com أو اسم المستخدم": "You@gmail.com o nombre el usuario",
  "تم حفظ إعدادات البريد ✓": "Se guardar ajustes el correo ✓",
  "أدخل بريداً Gmail صالحاً للتجربة": "Introduce correo Gmail válido prueba",
  "تم إرسال البريد التجريبي ✓": "Se enviar el correo el demo ✓",
  "⚠️ SMTP غير مفعّل — فعّله أولاً": "⚠️ SMTP no activado — actívalo primero",
  "تعذر الإرسال:": "No se pudo el enviar:",
  "تم إلغاء البريد وتحريره ✓": "Se cancelar el correo y editarlo ✓",
  "تعذر إلغاء البريد": "No se pudo cancelar el correo",
  "أدخل بريداً أو اسم مستخدم": "Introduce correo o nombre usuario",
  "تعذر البحث": "No se pudo el búsqueda",
  "وضع المشرفين (msip)": "Modo el moderadores(msip)",
  "تمكين المستخدم من التسجيل في الشات (eur)": "Habilitar el usuario de el registro en el chat(eur)",
  "إظهار الوقت مع الرسالة (espumh)": "Mostrar el hora con el mensaje(espumh)",
  "تفعيل الكتم (mt e)": "Activación el silenciar(mt e)",
  "تفعيل الكتم الصامت (mt amt)": "Activación el silenciar elsilencioso(mt amt)",
  "تفعيل مراقبة الرسائل قبل نشرها (mrs eab)": "Activación monitoreo el mensajes antes de publicarla(mrs eab)",
  "تفعيل إعدادات الروبوت (esprmh)": "Activación ajustes el bot(esprmh)",
  "رابط الرسائل العامة (puurl)": "Enlace el mensajes el públicas(puurl)",
  "تم حفظ اعدادات النظام": "Se guardar ajustes el sistema",
  "تم حفظ الشروط والخصوصية": "Se guardar el términos privacidad",
  "🔍 ابحث باسم المستخدم...": "🔍 busca con nombre el usuario...",
  "فك الحظر": "Levantar el bloqueo",
  "حظر": "Bloqueo",
  "طلب توثيق الحساب": "Solicitud verificación el cuenta",
  "👑 طلب دخول ملكي": "👑 solicitud inicio de sesión real",
  "👑 طلب تغيير الحيوان الملكي": "👑 solicitud cambio animal real",
  "الحيوان الملكي الجديد": "Animal real el nuevo",
  "الحيوان الملكي": "Animal real",
  "الكمية المطلوبة": "La cantidad el requeridas",
  "الذهب المطلوب شحنه للمستخدم:": "El oro el requerido recargarlo usuario:",
  "الذهب المطلوب خصمه:": "El oro el requerido descontarlo:",
  "موافقة وشحن الذهب": "Aprobación y recargar el oro",
  "موافقة وتنفيذ": "Aprobación y ejecutar",
  "بدون سبب": "Sin razón",
  "تمت الموافقة وشحن الذهب للمستخدم": "Se el aprobación y recargar el oro usuario",
  "تمت الموافقة وتنفيذ الطلب وخصم الذهب": "Se el aprobación y ejecutar el solicitud y descontar el oro",
  "تعذرت الموافقة": "No se pudo el aprobación",
  "اكتب سبب الرفض الذي سيصل للمستخدم:": "Escribe razón el rechazar el el llegará usuario:",
  "تم رفض الطلب وإبلاغ المستخدم": "Se rechazar el solicitud y informar el usuario",
  "اكتب رسالة الاعلان هنا...": "Escribe mensaje el anuncio aquí...",
  "اكتب نص الإعلان أولا": "Escribe texto el anuncio primero",
  "تم إرسال الإعلان لجميع الغرف": "Se enviar el anuncio para todos el salas",
  "اكتب الكلمة الممنوعة هنا...": "Escribe el palabra el prohibidas aquí...",
  "اكتب الكلمة أولا": "Escribe el palabra primero",
  "تم تعديل الكلمة": "Se editar el palabra",
  "تمت إضافة الكلمة": "Se añadir el palabra",
  "رمز الاستبدال الحالي : **": "Código el reemplazo el actual: **",
  "الاسم (مثال: الوردة الذهبية)": "El nombre(ejemplo: el rosa el dorada)",
  "إيموجي 🌹": "Emoji 🌹",
  "أدخل اسم العضو (مثال: ahmed|mohamed|ali)": "Introduce nombre el miembro(ejemplo: ahmed|mohamed|ali)",
  "اكتب اسم العضو": "Escribe nombre el miembro",
  "تمت الإضافة للتوثيق": "Se el añadir verificación",
  "ابحث باسم المستخدم أو IP أو كلمة البحث أو الدولة...": "Busca con nombre el usuario o IP o palabra el búsqueda o el país...",
  "مثال: شات العرب أو شات الأردن": "Ejemplo: chat árabes o chat el Jordania",
  "مثال: شات العرب - دردشة صوتية وكتابية مجانية": "Ejemplo: chat árabes - chat de voz y de texto gratis",
  "اكتب وصفاً جذاباً يظهر في نتائج بحث Google...": "Escribe una descripción atractiva aparece en resultados búsqueda Google...",
  "شات, دردشة, شات عربي, تعارف, شات صوتي": "Chat, chat, chat árabe, conocer gente, chat de audio",
  "رابط صورة الشعار (مثال: /img/announcement.png)": "Enlace foto el logo(ejemplo: /img/announcement.png)",
  "معاينة الشعار": "Vista previa el logo",
  "رابط الفافيكون (مثال: /uploads/favicon.png)": "Enlace el favicon(ejemplo: /uploads/favicon.png)",
  "معاينة الفافيكون": "Vista previa el favicon",
  "مثال: شات شات1": "Ejemplo: chat chat1",
  "مثال: شات 1 - أفضل شات كتابي وصوتي": "Ejemplo: chat 1 - mejor chat de texto y de audio",
  "وصف مخصص يظهر في Google عند البحث عن هذا المسار...": "Descripción personalizado aparece en Google en el búsqueda sobre este el ruta...",
  "شات1, chat1, شات عربي": "Chat1, chat1, chat árabe",
  "مثال: /img/announcement.png": "Ejemplo: /img/announcement.png",
  "مثال: شات العرب — دردشة صوتية وكتابية مجانية": "Ejemplo: chat árabes — chat de voz y de texto gratis",
  "نص فريد يظهر داخل صفحة هذا المسار فقط — اتركه فارغاً للتوليد التلقائي...": "Texto único aparece dentro de página este el ruta solo — déjalo vacío generación el automático...",
  "اتركه فارغاً ليُولَّد تلقائياً": "Déjalo vacío para generarse automáticamente",
  "جاري رفع صورة الشعار للأرشفة...": "Subir foto el logo archivado...",
  "تم رفع صورة الشعار بنجاح ✓": "Se subir foto el logo con éxito ✓",
  "جاري رفع أيقونة الفافيكون...": "Subir icono el favicon...",
  "تم رفع أيقونة الموقع بنجاح ✓": "Se subir icono el sitio con éxito ✓",
  "تعذر رفع الأيقونة": "No se pudo subir el icono",
  "جاري رفع صورة الشعار...": "Subir foto el logo...",
  "تم رفع أيقونة الفافيكون بنجاح ✓": "Se subir icono el favicon con éxito ✓",
  "تم حفظ إعدادات الموقع والأرشفة الأساسية بنجاح ✓": "Se guardar ajustes el sitio archivado el básica con éxito ✓",
  "⏸️ متوقف": "⏸️ detenido",
  "بدون وصف": "Sin descripción",
  "تعديل مسار الأرشفة /": "Editar ruta el archivado /",
  "تم حذف المسار": "Se eliminar el ruta",
  "اكتب اسم المسار أولاً": "Escribe nombre el ruta primero",
  "رفع صوت": "Subir voz",
  "إزالة": "Eliminar",
  "🪙 ← يربح المستقبل:": "🪙 ← gana el receptor:",
  "🪙 • التسكير: $": "🪙• el conversión: $",
  "⛔ مرفوض": "⛔ rechazado",
  "مبلغ التسكير الذي يُدفع": "Monto el conversión el el se paga",
  "تعذر تحميل الطلبات": "No se pudo carga el solicitudes",
  "لا توجد اتصالات دردشة نشطة الآن": "No hay conexiones chat activas el ahora",
  "اتصالات": "Conexiones",
  "لا توجد سجلات مطابقة": "No hay registros coincidencia",
  "الإعدادات": "El ajustes",
  "الإعدادات — تفاصيل المستخدم": "El ajustes — detalles el usuario",
  "كل ما دخل به هذا الشخص + بيانات حسابه + أدوات الحظر": "Todo qué entró en él este el persona + datos su cuenta + herramientas el bloqueo",
  "جاري تحميل التفاصيل...": "Carga el detalles...",
  "تعذر تحميل التفاصيل:": "No se pudo carga el detalles:",
  "تفاصيل هذا الدخول": "Detalles este el inicio de sesión",
  "المصدر:": "El fuente:",
  "تفاصيل الحساب": "Detalles el cuenta",
  "ملاحظة": "Nota",
  "لا يوجد حساب مرتبط بهذا الدخول في قاعدة البيانات حالياً (حُذف أو أنه اسم زائر مؤقت لم يُنشأ له حساب).": "No hay cuenta vinculado con esto el inicio de sesión en base de datos el datos actualmente(fue eliminado o que nombre visitante temporal no se crea para él cuenta).",
  "يمكنك حظر عنوان IP أدناه لمنع عودته.": "Puedes bloqueo título IP abajo para evitar su regreso.",
  "الحظر والإجراءات": "El bloqueo acciones",
  "الحظر يفصل المستخدم فوراً ويمنعه من العودة من نفس الحساب/IP/الجهاز حتى يتم فك الحظر من «قائمة الحظر».": "El bloqueo desconecta el usuario inmediatamente y le impide de el volver de mismo el cuenta/IP/el dispositivo hasta se realiza levantar el bloqueo de«lista el bloqueo».",
  "👤 زائر عادي": "👤 visitante normal",
  "• كل": "• todo",
  "ثانية • حجم": "Segundo• tamaño",
  "حفظ الباقة": "Guardar el paquete",
  "قائمة باقات الذهب الحالية": "Lista paquetes el oro el actual",
  "جاري تحميل الباقات...": "Carga el paquetes...",
  "أُنشئت بوابة الدفع عبر": "Creada pasarela el pago vía",
  "مفاتيح PayPal (Rest API App)": "Palabras clave PayPal(Rest API App)",
  "اتركه فارغاً للإبقاء على المفتاح الحالي.": "Déjalo vacío mantener en el clave el actual.",
  "وضع التشغيل:": "Modo el ejecutar:",
  "وضع حي (Live) — مدفوعات حقيقية": "Modo barrio(Live) — pagos reales",
  "وضع تجريبي (Sandbox) — للاختبار": "Modo demo(Sandbox) — prueba",
  "USD (الدولار الأمريكي)": "USD(el dólar el americano)",
  "EUR (اليورو)": "EUR(el euro)",
  "GBP (الجنيه الإسترليني)": "GBP(el libra el esterlina)",
  "JOD (الدينار الأردني)": "JOD(el dinar el jordano)",
  "تفعيل الدفع عبر PayPal في المتجر": "Activación el pago vía PayPal en el tienda",
  "حفظ إعدادات PayPal": "Guardar ajustes PayPal",
  "اختبار الاتصال بالبوابة": "Prueba el conexión pasarela",
  "بيانات الحساب المصرفي للإيداع (اختياري — للمراسلة)": "Datos el cuenta el bancaria depósito(opcional — mensajería)",
  "اسم البنك:": "Nombre el banco:",
  "اسم المستفيد:": "Nombre el beneficiario:",
  "رقم الآيبان (IBAN):": "Número el IBAN(IBAN):",
  "العمليات المؤكّدة من PayPal": "El operaciones el confirmada de PayPal",
  "جاري تحميل سجل العمليات...": "Carga registro el operaciones...",
  "بوابة الدفع": "Pasarela el pago",
  "مرجع العملية (PayPal)": "Referencia el operación(PayPal)",
  "VIP - الرصيد المطلوب لشراء عضوية VIP 👑": "VIP - el saldo el requerido comprar membresía VIP 👑",
  "Premium - الرصيد المطلوب لشراء عضوية Premium 💎": "Premium - el saldo el requerido comprar membresía Premium 💎",
  "Plus - الرصيد المطلوب لشراء عضوية Plus ⭐": "Plus - el saldo el requerido comprar membresía Plus ⭐",
  "حفظ الإعدادات": "Guardar el ajustes",
  "⬆️ ارفع ملفاً صوتياً لتشغيله بدل النغمة الافتراضية. الحقل يدعم MP3 / WAV / OGG / M4A / AAC / OPUS حتى 12 ميجا.": "⬆️ sube un archivo de voz reproducirlo en lugar de el tono el predeterminada. el campo soporta MP3 / WAV / OGG / M4A / AAC / OPUS hasta 12 MB.",
  "حدد العضويات المسموح لها باستخدام كل ميزة. حسابات الإدارة ومشرفو الغرف مسموح لهم دائماً.": "Especifica el membresías el permitido ella usando todo ventaja. cuentas el administración y moderadores el salas permitido para ellos siempre.",
  "✅ تم الحفظ والتطبيق الفوري — حد المذيعين الآن:": "✅ se el guardar aplicación el instantáneo — límite el locutores el ahora:",
  "مظهر رسائل العام": "Apariencia mensajes el público",
  "عرض جسم الرسالة :": "Mostrar cuerpo el mensaje:",
  "حجم شارات الرتب والعضويات في العام": "Tamaño insignias el rangos membresías en el público",
  "توحيد جميع الشارات على 24px": "Unificar todos el insignias en 24px",
  "رفع صورة الهدية (PNG/GIF/WEBP)": "Subir foto el regalo(PNG/GIF/WEBP)",
  "رفع صوت الهدية": "Subir voz el regalo",
  "اسم الهدية": "Nombre el regalo",
  "قيمة الهدية بالذهب (تُخصم من مُرسِل الهدية)": "Valor el regalo oro(se descuentan de remitente el regalo)",
  "كم يربح مستقبِل الهدية منها (ذهب) — مثال: قيمتها 10 يربح 4": "Cuánto gana receptor el regalo de ellos(oro) — ejemplo: su valor 10 gana 4",
  "قيمة الهدية بالدولار (تسكير الهدايا — للفتيات)": "Valor el regalo dólar(conversión de regalos — chicas)",
  "القسم": "El sección",
  "نمط الظهور عند الإرسال": "Estilo el aparición en el enviar",
  "«تلقائي» يجعل الهدية تظهر بالمشهد الملكي تلقائياً إذا كانت قيمتها ≥ الحد المحدد أدناه": "«automático» hace el regalo aparecen escena el real automáticamente si estaba su valor ≥ el límite el especificado abajo",
  "الحد التلقائي للمشهد الملكي (ذهب)": "El límite el automático escena el real(oro)",
  "الهدايا الحالية": "El regalos el actual",
  "تسكير الهدايا (تحويل الهدايا إلى دولارات)": "Conversión de regalos(transferencia el regalos a dólares)",
  "ميزة خاصة بالفتيات فقط: الهدايا بقيمها": "Ventaja privado chicas solo: el regalos con su valor",
  "بالذهب فقط": "Oro solo",
  "(لا يوجد سعر دولار لكل هدية).": "(no hay precio dólar por regalo).",
  "تحدد الإدارة": "Determina el administración",
  "الحد الأدنى للذهب": "El límite el mínimo oro",
  "مبلغ التسكير المقابل له": "Monto el conversión el a cambio de para él",
  "(مثال: 5$) وحساب السحب المصدر.": "(ejemplo: 5$) y cuenta el retirar el fuente.",
  "المبلغ يتناسب طردياً مع الكمية المحددة:": "El monto es proporcional directamente con la cantidad el especificada:",
  "الهدايا التي تريد تسكيها": "El regalos que quieres convertirlas",
  "(المحددة فقط تُحذف).": "(el especificada solo se eliminan).",
  "تُحذف الهدايا المحددة فقط": "Se eliminan el regalos el especificada solo",
  "وتبقى بقية هداياها.": "Y permanecen resto sus regalos.",
  "إعدادات التسكير": "Ajustes el conversión",
  "حفظ إعدادات التسكير": "Guardar ajustes el conversión",
  "طلبات التسكير": "Solicitudes el conversión",
  "جاري التحميل...": "El carga...",
  "ابحث عن الحساب ثم اختر": "Busca sobre el cuenta luego elige",
  "عرض الهدايا": "Mostrar el regalos",
  "لرؤية كل الهدايا المستلمة في حسابه.": "Para ver todo el regalos el recibida en su cuenta.",
  "الحذف يزيل الهدية من رصيد هداياه نهائياً ويؤثر على مجموع الذهب المتاح للتسكير.": "Eliminado elimina el regalo de saldo sus regalos permanentemente y afecta en total el oro el disponible conversión.",
  "لا يُعاد أي ذهب إلى رصيد الحساب": "No se re- cualquier oro a saldo el cuenta",
  "عند الحذف.": "En eliminado.",
  "جاري تحميل المستخدمين...": "Carga el usuarios...",
  "هدايا": "Regalos",
  "عدد سطور الهدايا": "Número de líneas el regalos",
  "إجمالي القطع": "Total el cortar",
  "مجموع الذهب": "Total el oro",
  "لا توجد هدايا في هذا الحساب": "No hay regalos en este el cuenta",
  "لا توجد غرف بعد": "No hay salas después de",
  "اهلا وسهلا بكم في": "Bienvenido bienvenido cuántos en",
  "لا توجد غرف متاحة": "No hay salas disponible",
  "لا توجد رسائل مسجلة بعد": "No hay mensajes grabadas después de",
  "مُرسَل": "Enviado",
  "SMTP غير مفعّل": "SMTP no activado",
  "فشل": "Fallo",
  "لا يوجد حساب بهذا البريد أو الاسم": "No hay cuenta con esto el correo o el nombre",
  "مفعَّل": "Activado",
  "غير مفعَّل (محتاج للتفعيل)": "No activado(necesitado activación)",
  "لا يوجد مستخدمون مطابقون": "No hay usuarios coinciden",
  "? 'طلب توثيق الحساب'": "? 'solicitud verificación el cuenta'",
  ": (isRoyal ? '👑 طلب دخول ملكي'": ":(isRoyal? '👑 solicitud inicio de sesión real'",
  ": (isRoyalChange ? '👑 طلب تغيير الحيوان الملكي'": ":(isRoyalChange? '👑 solicitud cambio animal real'",
  "لا توجد حسابات إدارية": "No hay cuentas administrativa",
  "✅ قائمة المطرودين فارغة": "✅ lista el expulsados vacía",
  "✅ قائمة الحظر فارغة": "✅ lista el bloqueo vacía",
  "جاري استئناف الخادم...": "Reanudar el servidor...",
  "✅ تم استئناف الخادم بنجاح": "✅ se reanudar el servidor con éxito",
  "لم يتم إضافة مسارات أرشفة مخصصة بعد (اضغط ➕ إضافة مسار لإنشاء مسار مثل /chat1)": "No se realiza añadir rutas archivado dedicadas después de(pulsa ➕ añadir ruta crear ruta como /chat1)",
  "🖼️ الشعار مرفق": "🖼️ el logo adjunto",
  "تم إنشاء غرفة SEO مخفية باسم «": "Se crear sala SEO ocultas con nombre«",
  "» 🤖 — مرئية لمحركات البحث فقط": "» 🤖 — visibles para motores el búsqueda solo",
  "المحادثات الخاصة بين المستخدمين": "El chats el privado entre el usuarios",
  "جاري تحميل المحادثات...": "Carga el chats...",
  "عرض المحادثة": "Mostrar el conversación",
  "عودة للمحادثات": "Volver chats",
  "محادثة:": "Conversación:",
  "مع": "Con",
  "رسالة)": "Mensaje)",
  "مسح الكل": "Borrar el todo",
  "لا توجد رسائل": "No hay mensajes",
  "تُحفظ تلقائياً تسجيلات المكالمات الخاصة — هذه الصفحة": "Se guardan automáticamente grabaciones el llamadas el privado — esta el página",
  "خاصة بالسوبر ماستر (مالك الدردشة) فقط": "Privado súper máster(propietario el chat) solo",
  "تسجيلات الفيديو": "Grabaciones el vídeo",
  "موجودة في صفحة مستقلة: «تسجيل مكالمات الفيديو».": "Existentes en página independientes:«registro llamadas el vídeo».",
  "قائمة المكالمات الصوتية المسجلة": "Lista el llamadas el de voz el grabadas",
  "جاري تحميل التسجيلات...": "Carga el grabaciones...",
  "🎙 صوت": "🎙 voz",
  "تحميل": "Carga",
  "أرشيف مكالمات الفيديو الخاصة — كل تسجيل يظهر فيه فيديو المتصل كاملاً وكاميرتك مصغّرة (بأسلوب سناب شات) مع الصوت.": "Archivo llamadas el vídeo el privado — todo registro aparece en él vídeo el conectado completa y tu cámara en miniatura(al estilo snap chat) con el voz.",
  "هذه الصفحة": "Esta el página",
  "أرشيف مكالمات الفيديو": "Archivo llamadas el vídeo",
  "جاري تحميل تسجيلات الفيديو...": "Carga grabaciones el vídeo...",
  "الشكاوى الواردة من الأعضاء المسجلين (زر «الإبلاغ» في الملف الشخصي) — تُعرض مع اسم المبلِّغ والمُبلَّغ عنه.": "El quejas el entrante de el miembros el registrados(botón«el informar» en el archivo el personal) — se muestran con nombre el informante reportado sobre él.",
  "جاري تحميل الشكاوى...": "Carga el quejas...",
  "⚠️ المُبلَّغ عنه:": "⚠️ el reportado sobre él:",
  "حذف الشكوى": "Eliminar el queja",
  "كلمة المرور (pwd)": "Contraseña(pwd)",
  "هل أنت متأكد من حذف المستخدم \"": "¿seguro que quieres eliminar el usuario \"",
  "حذف الحساب الإداري \"": "Eliminar el cuenta el administrativo \"",
  "(منتهي)": "(expirado)",
  "انتهت جلسة لوحة الإدارة": "Terminó sesión el panel de administración",
  "تم إبطال رابط وجلسة الإدارة فوراً لأنك لست متواجداً في الدردشة أو قمت بعمل تحديث.": "Se invalidar enlace y sesión el administración inmediatamente porque no eres presente en el chat o hiciste hacer actualizar.",
  "يجب أن تكون متواجداً ومتصلاً داخل الدردشة في نفس الوقت لتشغيل لوحة الإدارة.": "Debes que ser presente y conectado dentro de el chat en mismo el hora reproducir el panel de administración.",
  "العودة إلى الدردشة": "El volver a el chat",
  "فحص «طبق الأصل» بين المسارات": "Revisar«exacto el original» entre el rutas",
  "مسار": "Ruta",
  "ينقصها محتوى فريد:": "Le falta contenido único:",
  "تم الإصلاح الشامل ✓ — عناوين مُعاد توليدها:": "Se el reparar el integral ✓ — títulos regenerado su generación:",
  "• غرف مخفية مُنشأة:": "• salas ocultas creada:",
  "غرف SEO مخفية جديدة:": "Salas SEO ocultas nueva:",
  "أدخل اسم الدردشة أو الكلمة المستهدفة أعلاه واضغط \"توليد النماذج الآن\" لإنشاء باقات سيو قوية متوافقة مع Google.": "Introduce nombre el chat o el palabra el objetivo arriba y pulsa \"generación el modelos el ahora\" crear paquetes SEO fuerte compatible con Google.",
  "جاري تحليل الكلمات وتوليد نماذج SEO متوافقة مع معايير Google...": "Análisis el palabras y generar modelos SEO compatible con criterios Google...",
  "كلمة مفتاحية": "Palabra clave",
  "الكلمات الدلالية المتصدرة (Keywords & LSI):": "El palabras el semántica el destacada(Keywords & LSI):",
  "تطبيق هذا النموذج الآن ✨": "Aplicación este el modelo el ahora ✨",
  "🪙 الذهب:": "🪙 el oro:",
  "💵 السعر:": "💵 el precio:",
  "حذف العام لدي فقط": "Eliminar el público tengo solo",
  "حذف العام للجميع": "Eliminar el público todos",
  "تحدث": "Habla",
  "سحب المايك": "Retirar el micrófono",
  "سحب مع منع صعود": "Retirar con prevenir subir",
  "فك من البث": "Levantar de el transmisión",
  "مجوهرات": "Joyas",
  "أضف إطلالة": "Añade look",
  "اختر صورة": "Elige foto",
  "او": "O",
  "إشعارات سطح المكتب": "Notificaciones escritorio el escritorio",
  "احصل على توثيق شاتنا": "Obtén en verificación nuestro chat",
  "اجعل مجتمع شاتنا يثق بك وكن دائمًا مميز في المقدمة": "Hazır comunidad nuestro chat confía ti y sé siempre premium en el introducción",
  "اختر الباقة المناسبة وادفع عبر PayPal أو بطاقة فيزا/ماستركارد/أمريكان إكسبريس لشحن رصيدك فورياً بعد تأكيد الدفع": "Elige el paquete el adecuada y paga vía PayPal o tarjeta Visa/Mastercard/American Express para recargar tu saldo al instante después de confirmar el pago",
  "دخول الى الغرفة المختارة": "Inicio de sesión a el sala el seleccionadas",
  "لا": "No",
  "ارسل لك رسالة خاصة": "Envía para ti mensaje privado",
  "انتقل إلى قائمة الرسائل الخاصة لقراءتها": "Ve a lista mensajes privados para leerla",
  "إنهاء المكالمة": "Finalizar el llamada",
  "ابحث عن غرفك": "Busca sobre tus salas",
  "تشغيل الراديو": "Ejecutar el radio",
  "كتم/إلغاء كتم صوت المذيعين": "Silenciar/cancelar silenciar voz el locutores",
  "حذف «العام» من شاشة أنت فقط — يظل ظاهراً لبقية المستخدمين": "Eliminar«el público» de pantalla tú solo — permanece visible para el resto el usuarios",
  "حذف «العام» نهائياً من الغرفة لجميع المستخدمين": "Eliminar«el público» permanentemente de el sala para todos el usuarios",
  "النزول لآخر الرسائل": "El bajar al último el mensajes",
  "بحث عن غرف": "Búsqueda sobre salas",
  "بحث عن مستخدمين": "Búsqueda sobre usuarios",
  "عرض/إخفاء قائمة المتصلين": "Mostrar/ocultar lista el conectados",
  "تغيير الصورة الشخصية": "Cambio el foto el personal",
  "تحدث — الصعود كمذيع": "Habla — el subir como locutor",
  "اسحب لتحريك نافذة البث": "Arrastra para mover ventana el transmisión",
  "كتم/إلغاء كتم صوتي كمذيع": "Silenciar/cancelar silenciar de audio como locutor",
  "البريد الإلكتروني (Gmail)": "El correo electrónico(Gmail)",
  "مكالمة فيديو": "Videollamada",
  "مكالمة صوتية": "Llamada de voz",
  "تصغير": "Reducir",
  "انقر للتبديل": "Haz clic cambiar",
  "انقر لتكبير صورك": "Haz clic ampliar tus fotos",
  "جودة الفيديو ثابتة على 360p": "Calidad el vídeo fija en 360p",
  "كتم/إلغاء كتم الميكروفون": "Silenciar/cancelar silenciar el micrófono",
  "تشغيل/إيقاف الكاميرا": "Ejecutar/detener la cámara",
  "كلمة المرور الحالية": "Contraseña el actual",
  "كلمة المرور الجديدة (4 خانات على الأقل)": "La nueva contraseña(4 caracteres en el menos)",
  "تأكيد كلمة المرور الجديدة": "Confirmar la nueva contraseña",
  "ابحث عن فيديو في YouTube": "Busca sobre vídeo en YouTube",
  "إزالة الصورة": "Eliminar el foto",
  "كلمة المرور الجديدة": "La nueva contraseña",
  "نظام إدارة الدردشة المتكامل": "Sistema Completo de Gestión de Chat",
  "🇸🇦 العربية": "🇸🇦 el árabe",
  "لوحة التحكم": "El panel de control",
  "الصلاحية :": "Rol :",
  "مُوَلّد SEO والأرشفة بالذكاء الاصطناعي 🤖": "Generador SEO archivado inteligencia el artificial 🤖",
  "توليد النماذج الآن": "Generación el modelos el ahora",
  "🌍 عربي عام": "🌍 árabe público",
  "🎙️ صوتي ومايكات": "🎙️ de audio y micrófonos",
  "🤝 تعارف وصداقة": "🤝 conocer gente y amistad",
  "⚡ جوال سريع": "⚡ móvil rápido",
  "👑 خليجي راقي": "👑 del Golfo elegante",
  "اكتب اسم الدردشة أو المسار أو الكلمة هنا...": "Escribe nombre el chat o el ruta o el palabra aquí...",
  "مذيع مباشر": "Locutor en vivo",
  "إيقاف مشاهدة هذا البث": "Detener ver este el transmisión",
  "دردشة كتابية": "Chat de texto",
  "غرفة صوتية": "Sala de voz",
  "الغرفة مغلقة": "Sala cerrada",
  "الغرفة برقم سري": "El sala con contraseña",
  "للأعضاء المسجلين فقط": "Miembros el registrados solo",
  "مثال: الباقة الفضية أو باقة المبتدئين": "Ejemplo: el paquete plateada o paquete principiantes",
  "مثال: 100": "Ejemplo: 100",
  "مثال: 9.99": "Ejemplo: 9.99",
  "مثال: 15 (اتركه 0 إذا لم يوجد)": "Ejemplo: 15(déjalo 0 si no hay)",
  "مثال: 🔥 الأكثر طلباً أو ⭐ باقة التوفير": "Ejemplo: 🔥 el más solicitado o ⭐ paquete ahorro",
  "مثال: AQ7vH2...": "Ejemplo: AQ7vH2...",
  "مثال: EO9xK3...": "Ejemplo: EO9xK3...",
  "مثال: البنك الأهلي التجاري": "Ejemplo: el banco nacional el comercial",
  "مثال: إدارة الدردشة المعتمدة": "Ejemplo: administración el chat verificado",
  "مثال: JO94 ARAB 1234 5678 9012 3456": "Ejemplo: JO94 ARAB 1234 5678 9012 3456",
  "مثال: أسد": "Ejemplo: león",
  "🔍 بحث باسم أي طرف في المحادثة...": "🔍 búsqueda con nombre cualquier parte en el conversación...",
  "🔍 بحث باسم المتصل أو المستلم أو اسم الملف...": "🔍 búsqueda con nombre el conectado o el destinatario o nombre el archivo...",
  "🔍 بحث باسم المتصل أو المستلم...": "🔍 búsqueda con nombre el conectado o el destinatario...",
  "🔍 بحث باسم المبلِّغ أو المُبلَّغ عنه أو النص...": "🔍 búsqueda con nombre el informante o el reportado sobre él o el texto...",
  "مثل: jo, eg, sa": "Como: jo, eg, sa"
,
  "اللغة": "Idioma",
  "الرئيسية": "Inicio",
  "االدردشة العربية": "El Chat Árabe",
  "الغرفة مغلقة حالياً": "Esta sala está cerrada actualmente",
  "الغرفة للأعضاء المسجلين فقط": "Esta sala es solo para miembros registrados",
  "عدد المذيعين المتزامن (الميكروفونات)": "Locutores simultáneos (micrófonos)",
  "أقصى عدد مسموح بالبقاء على المايك في نفس الوقت داخل البث — عند امتلائها يُرفض صعود أي شخص جديد برسالة «الميكروفونات ممتلئة».": "Número máximo de personas permitidas en el micrófono a la vez en la transmisión — al llenarse, se rechaza a los nuevos con un mensaje de \"micrófonos llenos\".",
  "درجة التفريد:": "Puntuación de unicidad:",
  "لا يوجد أي تكرار بين المسارات": "No hay duplicados entre rutas",
  "درجة التفريد": "Puntuación de unicidad",
  "إرسال": "Enviar",
  "الحالة التالية": "Estado siguiente",
  "الحالة السابقة": "Estado anterior",
  "تصغير المكالمة": "Minimizar llamada",
  "تقليل الكمية": "Reducir cantidad",
  "تقليل المدة": "Reducir duración",
  "رفض المكالمة": "Rechazar llamada",
  "زيادة الكمية": "Aumentar cantidad",
  "زيادة المدة": "Aumentar duración",
  "قبول المكالمة": "Aceptar llamada",
  "كتم الميكروفون": "Silenciar micrófono",
  "مكبر الصوت": "Altavoz",
  "موضع المقطع الصوتي": "Posición del clip",
  "نافذة البث المباشر": "Ventana de transmisión",
  "هل تريد الانتقال إلى هذه الغرفة ؟": "¿Quieres pasar a esta sala?",
  "من خيار نوع الحساب لتوليد زائر بلا أي شارة روبوت: اسم عربي طبيعي وصورة عشوائية إن تُركا فارغين، ويدخل الغرفة كأي زائر حقيقي. ويمكن تحديد": "de la opción Tipo de cuenta para generar un visitante sin insignia de bot: un nombre árabe natural y una foto aleatoria         si se dejan vacíos, y entra a la sala como cualquier visitante real. También puedes definir ",
  "من خيار نوع الحساب لتوليد زائر بلا أي شارة روبوت: اسم عربي طبيعي وصورة عشوائية\n        إن تُركا فارغين، ويدخل الغرفة كأي زائر حقيقي. ويمكن تحديد": "de la opción Tipo de cuenta para generar un visitante sin insignia de bot: un nombre árabe natural y una foto aleatoria         si se dejan vacíos, y entra a la sala como cualquier visitante real. También puedes definir ",
  "لكل حساب تولّده.": "para cada cuenta que genera.",
  "لم يُرفع صوت بعد": "Aún no se subió audio",
  "أعلى الدردشة مباشرة تحت الهيدر": "en la parte superior del chat, justo bajo el encabezado",
  "فوراً لجميع المستخدمين، ويعمل على جميع الهواتف.": "al instante para todos los usuarios, y funciona en todos los teléfonos.",
  "اكتب أي سؤال تجريبي لتجربة توليد الرد من العقل العصبي للذكاء الاصطناعي مباشرة والتأكد من سرعة ودقة الإجابة.": "Escribe cualquier pregunta de prueba para generar una respuesta del cerebro neuronal de IA directamente y comprobar la velocidad y precisión de la respuesta.",
  "يتحكم هذا القسم في العقل العصبي للذكاء الاصطناعي الذي تستخدمه روبوتات الدردشة عند مناداتها بالاسم للإجابة عن أي سؤال بشكل واقعي وذكي. يدعم النظام Google Gemini و Groq (Llama 3.3) و OpenAI و DeepSeek أو أي خادم عصبي مخصص (Ollama / LocalAI).": "Esta sección controla el cerebro neuronal de IA que usan los bots del chat cuando se les llama por nombre para responder cualquier pregunta de forma realista e inteligente. El sistema es compatible con Google Gemini, Groq (Llama 3.3), OpenAI, DeepSeek o cualquier servidor neuronal personalizado (Ollama / LocalAI).",
  "تهيئة مزود الذكاء الاصطناعي ومفتاح الـ API": "Configuración del proveedor de IA y clave de API",
  "⚡ Google Gemini (مجاني وسريع وذكي جداً - مُستحسن)": "⚡ Google Gemini (gratis, rápido y muy inteligente - recomendado)",
  "🚀 Groq Cloud (Llama 3.3 70B - مجاني وفائق السرعة)": "🚀 Groq Cloud (Llama 3.3 70B - gratis y súper rápido)",
  "عند اختيار «للأعضاء المسجلين فقط» تُمنع حسابات الزوار من دخول الغرفة، وتظهر لهم رسالة تدعوهم لإنشاء حساب. الإدارة تدخل دائماً.": "Cuando se selecciona «solo miembros registrados», las cuentas de visitantes no pueden entrar a la sala y ven un mensaje que las invita a crear una cuenta. La administración siempre entra.",
  "و": "y",
  "طلب دخول ملكي": "Solicitud de ingreso real",
  "مكالمة وبث مباشر": "Llamada ytransmisión en vivo",
  "مكالمة وبث مباشر نشط": "Llamada ytransmisión en vivo activo",
  "لا يمكنك الانتقال إلى غرفة أخرى أثناء وجود مكالمة وبث مباشر. يجب إغلاقهما أولاً ثم يمكنك الدخول إلى الغرفة الأخرى.": "No se puedecomo el cambiar a sala otra durante presencia llamada ytransmisión en vivo. debes cerrar ambos primero luego puedes el inicio de sesión a el sala el otra.",
  "التوثيق والدخول الملكي": "El verificación yentrada real",
  "دفع إلكتروني آمن ومشفر عبر PayPal — نقبل بطاقات فيزا/ماستركارد/أمريكان إكسبريس وPayPal وخيارات أخرى": "Pago electrónico seguro y cifrado vía PayPal — aceptamos tarjetas Visa/Mastercard/American Express yPayPal y opciones otra",
  "(بث mp3/aac مثل icecast أو shoutcast) ثم فعّل الراديو.": "(transmisión mp3/aac como icecast o shoutcast) luego activa la radio.",
  "كلمة المرور السرية (اتركها فارغة = بدون حماية)": "Contraseña secreta (déjala vacía = sin protección)",
  "تُستخدم لاحتساب قيمة التحويل إلى دولارات في نظام التسكير (مثال: 1.5 = $1.50)": "Se usa para calcular el valor de conversión a dólares en el sistema de retiro (ejemplo: 1.5 = $1.50)",
  "يسري على الهدايا بنمط «تلقائي» فقط. 0 = تعطيل التلقائي (كل الهدايا عادية)": "Aplica a los regalos en estilo «automático» solo. 0 = desactivar automático (todos los regalos normales)"
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
  "إظهار أقل": "Daha az göster", "التفاعلات": "Tepkiler", "الكل": "Tümü", "عرض الملف الشخصي": "Profili görüntüle", "جاري تحميل التفاعلات...": "Tepkiler yükleniyor...",
  "تعذر تحميل التفاعلات": "Tepkiler yüklenemedi", "لا توجد تفاعلات على هذا المنشور بعد": "Bu gönderide henüz tepki yok", "عرض من تفاعلوا مع المنشور": "Kimlerin tepki verdiğini gör",
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
,
  "الدردشة العربية": "Canlı Sohbet",
  "بدء بث فيديو": "Video yayınını başlat",
  "سيبدأ بث فيديو مباشر في هذه الغرفة، ويمكن لأعضاء الغرفة طلب مشاهدته.": "Bu odada canlı video yayını başlayacak; oda üyeleri izlemeyi talep edebilir.",
  "بدء البث": "Yayını başlat",
  "سيصل طلب مشاهدة البث لهذا المذيع تحديداً، ولن تشاهد بثه إلا إن وافق عليه. وإن كنت تشاهد مذيعاً آخر أو تبث بنفسك، فكل شيء يستمر بشكل طبيعي — البثوث تعمل معاً في نفس الوقت.": "İzleme isteğiniz bu yayıncıya gider; yalnızca onaylarsa yayınını izlersiniz. Başka bir yayıncıyı izliyorsanız veya kendiniz yayın yapıyorsanız her şey normal devam eder — yayınlar aynı anda çalışır.",
  "مشاهدة البث": "Yayını izle",
  "0 مشاهد": "0 izleyici",
  "مباشر": "Canlı",
  "بانتظار موافقة أحد المذيعين على مشاهدة البث…": "Bir yayıncının yayını izlemeyi onaylaması bekleniyor…",
  "إنهاء البث": "Yayını sonlandır",
  "مغادرة المشاهدة": "İzlemeyi bırak",
  "ع": "F",
  "يُستخدم للتفعيل والمتابعة — يجب أن يكون Gmail (ينتهي بـ @gmail.com)": "Aktivasyon ve takip için kullanılır — bir Gmail adresi olmalıdır (@gmail.com ile bitmeli)",
  "تفعيل الحساب": "Hesabı etkinleştir",
  "أرسلنا رمز تفعيل مكونًا من 6 أرقام إلى جيميلك:": "Gmail adresinize 6 haneli bir aktivasyon kodu gönderdik:",
  "إعادة إرسال الرمز": "Kodu yeniden gönder",
  "تغيير البريد": "E-postayı değiştir",
  "لا يصلك الرمز؟ تحقق من مجلد الرسائل غير المرغوبة (Spam). الرمز صالح لمدة 10 دقائق.": "Kod gelmedi mi? Gereksiz (Spam) klasörünü kontrol edin. Kod 10 dakika geçerlidir.",
  "عرض الحالة": "Durumu görüntüle",
  "كشف نكات": "Şakayı göster",
  "كشف النكات": "Şakayı göster",
  "صورة المستخدم": "Kullanıcı fotoğrafı",
  "التكلفة الإجمالية :": "Toplam maliyet:",
  "ترقية الحساب الآن": "Hesabı şimdi yükselt",
  "لوحة التحكم الإدارية": "Yönetim kontrol paneli",
  "مكالمة صوتية خاصة واردة...": "Gelen özel sesli arama...",
  "رد": "Yanıtla",
  "رفض": "Reddet",
  "جاري الاتصال...": "Aranıyor...",
  "سبيكر": "Hoparlör",
  "كتم": "Sustur",
  "إنهاء": "Bitir",
  "أغلق الكاميرا": "Kamerayı kapat",
  "الجودة: -": "Kalite: -",
  "الكاميرا": "Kamera",
  "المكالمة بالسماعة جارية • انقر لإضاءة الشاشة": "Aramalar hoparlörden çalıyor • ekranı açmak için dokunun",
  "بدء مكالمة صوتية": "Sesli arama başlat",
  "متابعة": "Devam et",
  "هدية": "Hediye",
  "الدخول الملكي 👑": "Kraliyet Girişi 👑",
  "مرفوعاتي": "Yüklemelerim",
  "الحساب": "Hesap",
  "تغيير كلمة المرور": "Şifre değiştir",
  "لحسابك المسجل — أدخل كلمة المرور الحالية ثم الجديدة": "Kayıtlı hesabınız için — mevcut şifreyi sonra yeniyi girin",
  "منشور جديد": "Yeni gönderi",
  "بحث": "Ara",
  "جاري تحميل المنشورات...": "Gönderiler yükleniyor...",
  "عرض الوسائط": "Medyayı görüntüle",
  "جارٍ تجهيز الوسائط...": "Medya hazırlanıyor...",
  "تعذر تشغيل الفيديو داخل المتصفح": "Video tarayıcıda oynatılamadı",
  "قد يكون ترميز الملف غير مدعوم. يمكنك فتح الملف الأصلي من الزر بالأسفل.": "Dosya kodlaması desteklenmiyor olabilir. Orijinal dosyayı alttaki düğmeden açabilirsiniz.",
  "انقر تشغيل لبدء المشاهدة": "İzlemeye başlamak için oynat'a tıklayın",
  "فتح الملف الأصلي": "Orijinal dosyayı aç",
  "، وتستطيع الإدارة تحديد مقدار الذهب النهائي عند الموافقة": ", ve yönetim onay sırasında nihai altın tutarını belirler",
  "شارة التاج الملكي": "Kraliyet tacı rozeti",
  "تاج ذهبي مميز يظهر بجوار اسمك أينما ظهر (الرسائل، المتصلين، الملف الشخصي)": "Adınızın yanında her yerde görünen altın bir taç (mesajlar, kişiler, profil)",
  "توهج ملكي عند دخول الغرف": "Odalara girerken kraliyet parıltısı",
  "عند دخولك أي غرفة يظهر توهج ملكي ذهبي احترافي مع التاج وإشعار الترحيب الملكي للجميع": "Herhangi bir odaya girdiğinizde taç ve herkes için kraliyet karşılama bildirimiyle profesyonel altın bir kraliyet parıltısı görünür",
  "تميز دائم": "Kalıcı ayrıcalık",
  "شارة ملكية لا تُزال — تميّزك في المقدمة دائماً": "Kalıcı bir kraliyet rozeti — seni her zaman önde tutar",
  "اختر حيوانك الملكي": "Kraliyet hayvanınızı seçin",
  "التكلفة": "Maliyet",
  "لن يتم خصم أي ذهب عند إرسال الطلب. يصل طلبك إلى لوحة الإدارة، وبعد المراجعة توافق الإدارة أو ترفضه، وسيصلك إشعار بالنتيجة.": "Talep gönderilirken altın kesilmez. Talebiniz yönetim paneline ulaşır ve inceleme sonrası yönetim onaylar veya reddeder; sonuçla ilgili bildirim alırsınız.",
  "طلب الدخول الملكي": "Kraliyet girişi talep et",
  "لديك الدخول الملكي": "Kraliyet girişine sahipsiniz",
  "تغيير الحيوان الملكي": "Kraliyet hayvanını değiştir",
  "باقة الذهب": "Altın paketi",
  "100 ذهب 🪙": "100 Altın 🪙",
  "الإيداع على حساب الدردشة المعتمد:": "Onaylı sohbet hesabına yatırma:",
  "البنك التجاري": "Ticari Banka",
  "تاريخ الانتهاء:": "Son kullanma tarihi:",
  "تأكيد الخصم والدفع (": "Kesinti ve ödemeyi onayla (",
  "طريقة دخول الغرفة": "Odaya giriş yöntemi",
  "اختر طريقة دخولك إلى غرفة": "Bir odaya nasıl gireceğinizi seçin",
  "دخول ظاهر": "Görünür giriş",
  "دخول مخفي": "Gizli giriş",
  "بث مباشر نشط": "Etkin yayın",
  "لا يمكنك مغادرة الغرفة وأنت تقوم بالبث المباشر.": "Canlı yayın yaparken odadan ayrılamazsınız.",
  "البقاء في الغرفة": "Odada kal",
  "إيقاف البث والخروج": "Yayını durdur ve çık",
  "تحديث الصفحة": "Sayfayı yenile",
  "هل تريد مغادرة الدردشة؟": "Sohbetten ayrılmak istiyor musunuz?",
  "أنت متواجد في غرفة. يمكنك البقاء، أو الخروج وتحديث الصفحة وإعادة الدخول.": "Bir odadasınız. Kalabilirsiniz veya çıkıp sayfayı yenileyerek tekrar girebilirsiniz.",
  "البقاء": "Kal",
  "الخروج وتحديث الصفحة": "Çık ve sayfayı yenile",
  "غرفة «": "Oda «",
  "» محمية بكلمة مرور.": "» şifre ile korunuyor.",
  "إرفاق صورة (دليل) — اختياري": "Görsel ekle (kanıt) — isteğe bağlı",
  "استعادة كلمة المرور": "Şifreyi kurtar",
  "أدخل بريدك المسجل وسنرسل لك رمز استعادة من 6 أرقام": "Kayıtlı e-postanızı girin, size 6 haneli bir kurtarma kodu gönderelim",
  "إرسال الرمز": "Kodu gönder",
  "فحص الملف قبل الإرسال": "Göndermeden önce dosyayı kontrol et",
  "جارٍ فحص الملف...": "Dosya kontrol ediliyor...",
  "إرسال إلى العام": "Genele gönder",
  "تسجيل مقطع صوتي": "Ses kaydet",
  "جارٍ التسجيل...": "Kaydediliyor...",
  "إيقاف ومعاينة": "Durdur ve önizle",
  "معاينة المقطع قبل الإرسال": "Göndermeden önce klibi önizle",
  "استمع إلى المقطع ثم أرسله أو احذفه": "Klibi dinleyin, sonra gönderin veya silin",
  "الرسالة طويلة": "Mesaj çok uzun",
  "يجب أن تكون الرسالة": "Mesaj şu kadar olmalı",
  "حرف أو أقل": "karakter veya daha az",
  "عدد الأحرف المكتوبة": "Yazılan karakter sayısı",
  "العودة لتعديل الرسالة": "Mesajı düzenlemek için geri dön",
  "لا تتحدث بسرعة": "Çok hızlı yazma",
  "خذ استراحة قصيرة قبل إرسال الرسالة التالية": "Bir sonraki mesajı göndermeden önce kısa bir mola ver",
  "ثانية": "saniye",
  "تم إيقاف الوصول": "Erişim engellendi",
  "تم حظرك بسبب سلوكك السيئ": "Kötü davranışınız nedeniyle yasaklandınız",
  "لن تتمكن من دخول الدردشة من هذا الحساب أو الجهاز حتى تقوم الإدارة بفك الحظر.": "Yönetim yasağı kaldırana kadar bu hesap veya cihazdan sohbete giremezsiniz.",
  "سبب الحظر": "Yasak nedeni",
  "سلوك سيئ داخل الدردشة": "Sohbette kötü davranış",
  "الحظر مرتبط بالحساب والجهاز ويستمر عند تغيير عنوان IP": "Yasak hesaba ve cihaza bağlıdır ve IP adresi değiştirilse de devam eder",
  "إعادة التحقق بعد فك الحظر": "Yasak kaldırıldıktan sonra yeniden kontrol et",
  "جلسة جديدة": "Yeni oturum",
  "تم الدخول بحسابك من جهاز آخر": "Hesabınıza başka bir cihazdan giriş yapıldı",
  "تم تسجيل الدخول إلى حسابك من جهاز آخر. لضمان أمان حسابك، تم إنهاء هذه الجلسة تلقائياً.": "Hesabınıza başka bir cihazdan giriş yapıldı. Hesabınızı korumak için bu oturum otomatik olarak sonlandırıldı.",
  "إذا لم تكن أنت من قام بالدخول، غيّر كلمة المرور وعُد للدخول مجدداً.": "Bu siz değilseniz, şifrenizi değiştirip tekrar giriş yapın.",
  "العودة لتسجيل الدخول": "Girişe geri dön",
  "جارٍ التحميل...": "Yükleniyor...",
  "أدخل اسم المستخدم وكلمة المرور": "Kullanıcı adı ve şifreyi girin",
  "أدخل البريد الإلكتروني": "E-postanızı girin",
  "أدخل بريداً Gmail صالحاً (ينتهي بـ @gmail.com)": "Geçerli bir Gmail girin (@gmail.com ile biten)",
  "أكمل الحقول المطلوبة للباقة": "Paket için gerekli alanları doldurun",
  "اسم المستخدم مطلوب": "Kullanıcı adı gereklidir",
  "البريد الإلكتروني إلزامي لإتمام التسجيل": "Kayıt için e-posta zorunludur",
  "البريد الإلكتروني يجب أن يكون Gmail (ينتهي بـ @gmail.com)": "E-posta bir Gmail olmalıdır (@gmail.com ile bitmeli)",
  "البريد غير صالح — يجب أن يكون Gmail": "Geçersiz e-posta — Gmail olmalı",
  "الرمز يجب أن يتكون من 6 أرقام": "Kod 6 hane olmalı",
  "الرمز غير صحيح — يجب أن يتكون من 6 أرقام": "Hatalı kod — 6 hane olmalı",
  "انتهت صلاحية الرمز — أعد الإرسال برمز جديد": "Kodun süresi doldu — yeniden gönderin",
  "تم تجاوز عدد المحاولات — أعد الإرسال برمز جديد": "Çok fazla deneme — yeni kodla yeniden gönder",
  "حسابك غير مفعّل بعد — يجب إدخال رمز التفعيل أولاً": "Hesap etkinleştirilmedi — önce aktivasyon kodunu girin",
  "يجب دخول الغرفة أولاً": "Önce bir odaya girin",
  "يجب دخول الغرفة قبل الكتابة": "Yazmadan önce bir odaya girin",
  "اختر غرفة صحيحة": "Geçerli bir oda seçin",
  "الغرفة غير موجودة": "Oda bulunamadı",
  "الغرفة غير محددة": "Oda belirtilmedi",
  "غرفة محذوفة": "Oda silindi",
  "🔒 هذه الغرفة مغلقة حالياً من الإدارة": "Bu oda yönetim tarafından kapatıldı",
  "أنت مطرود من هذه الغرفة": "Bu odadan atıldınız",
  "🚫 أنت مطرود من هذه الغرفة": "Bu odadan atıldınız",
  "تم طردك من هذه الغرفة بواسطة الإدارة": "Yönetim tarafından bu odadan atıldınız",
  "المستخدم لم يعد موجوداً في الغرفة": "Kullanıcı artık odada değil",
  "لا يمكنك الإشراف على مستخدم بصلاحية مساوية أو أعلى": "Eşit veya daha yüksek yetkiye sahip bir kullanıcıyı denetleyemezsiniz",
  "أنت مكتوم ولا يمكنك الكتابة": "Susturuldunuz ve yazamazsınız",
  "أنت مكتوم ولا يمكنك الصعود كمذيع": "Susturuldunuz ve yayın yapamazsınız",
  "كتم من الإدارة": "Yönetim tarafından susturuldu",
  "طرد من الغرفة": "Odadan atıldı",
  "أنت أحد المذيعين بالفعل": "Zaten bir yayıncısınız",
  "أنت تبث بالفعل في هذه الغرفة": "Bu odada zaten yayın yapıyorsunuz",
  "لا يوجد بث صوتي حالياً في هذه الغرفة": "Şu anda sesli yayın yok",
  "لا يوجد بث فيديو حالياً في هذه الغرفة": "Şu anda görüntülü yayın yok",
  "هذا المذيع لم يعد يبث حالياً": "Bu yayıncı artık canlı değil",
  "لا يمكنك مشاهدة بثك الشخصي": "Kendi yayınını izleyemezsin",
  "الميكروفونات ممتلئة الآن — لا يمكن الصعود كمذيع": "Mikrofonlar dolu — yayıncı olamazsınız",
  "عضويتك غير مسموح لها بالصعود كمذيع": "Üyeliğiniz yayın yapmaya izin vermiyor",
  "رصيد الذهب غير كافٍ لإتمام الترقية": "Yükseltmeyi tamamlamak için yetersiz altın",
  "رصيدك غير كافي": "Yetersiz bakiye",
  "رصيد المستخدم لم يعد كافياً": "Kullanıcı bakiyesi artık yeterli değil",
  "هدية غير صالحة": "Geçersiz hediye",
  "الهدية غير موجودة في هذا الحساب": "Hediye bu hesapta yok",
  "بعض الهدايا المحددة لا تنتمي لحسابك": "Seçilen bazı hediyeler hesabınıza ait değil",
  "كمية غير صالحة": "Geçersiz miktar",
  "لا توجد هدايا يمكنك تحويلها": "Dönüştürebileceğin hediye yok",
  "ميزة تسكير الهدايا متاحة للفتيات فقط": "Hediye dönüştürme sadece kızlar için",
  "نظام تسكير الهدايا غير مفعّل حالياً": "Hediye dönüştürme devre dışı",
  "📞 تم بدء مكالمة صوتية": "Sesli arama başladı",
  "📞 تم رفض المكالمة": "Arama reddedildi",
  "📞 تم رفض المكالمة (المستخدم مشغول)": "Arama reddedildi (kullanıcı meşgul)",
  "📞 مكالمة صوتية فائتة": "Kaçırılan sesli arama",
  "📞 مكالمة صوتية مجانية منتهية • 01:00": "Ücretsiz sesli arama sona erdi • 01:00",
  "مكالمة فيديو خاصة": "Özel görüntülü arama",
  "مكالمة مفتوحة المدة": "Sınırsız arama",
  "انتهت الدقيقة المجانية التجريبية للمكالمة ⏱️": "Ücretsiz deneme arama dakikası bitti ⏱️",
  "انتهت الدقيقة المجانية التجريبية للمكالمة ⏱️ يمكنك إجراء مكالمات مفتوحة بتكلفة 2 ذهب": "Ücretsiz deneme dakikası bitti ⏱️ — 2 Altın ile açık arama yapabilirsiniz",
  "بدأت مكالمتك المجانية التجريبية الأولى (المدة: دقيقة واحدة) 🎁": "İlk ücretsiz deneme aramanız başladı (süre: 1 dakika) 🎁",
  "طلب التوثيق": "Doğrulama talebi",
  "طلب تغيير الحيوان الملكي": "Kraliyet hayvanı değişikliği talebi",
  "طلب شراء الذهب": "Altın satın alma talebi",
  "طلب الترقية": "Yükseltme talebi",
  "حسابك موثق بالفعل ✓": "Hesabınız zaten doğrulandı ✓",
  "الحساب موثق بالفعل": "Hesap zaten doğrulanmış",
  "رفضت الإدارة طلب التسكير": "Yönetim dönüştürme talebini reddetti",
  "تم رفض الطلب من الإدارة": "Talep yönetim tarafından reddedildi",
  "تمت معالجة هذا الطلب مسبقاً": "Bu talep zaten işlendi",
  "الطلب غير موجود أو تمت معالجته": "Talep bulunamadı veya zaten işlendi",
  "المنشور غير موجود": "Gönderi bulunamadı",
  "تعذر حفظ الحالة": "Durum kaydedilemedi",
  "الحالة غير موجودة": "Durum bulunamadı",
  "انتهت هذه الحالة أو حُذفت": "Bu durumun süresi doldu veya silindi",
  "الحالة الكتابية لا تحتاج ملفاً": "Metin durumu dosya gerektirmez",
  "مشاهدو الحالة متاحون لصاحبها فقط": "Durum izleyicileri yalnızca sahibi içindir",
  "نوع الحالة غير صالح": "Geçersiz durum türü",
  "حالة غير صالحة": "Geçersiz durum",
  "اختر ملف الحالة أولاً": "Önce bir durum dosyası seçin",
  "فيديو YouTube المختار غير صالح": "Seçilen YouTube videosu geçersiz",
  "اكتب التعليق": "Yorumu yazın",
  "تفاعل غير صالح": "Geçersiz tepki",
  "الملف غير صالح": "Geçersiz dosya",
  "حجم الملف أكبر من 50MB": "Dosya boyutu 50MB'ı aşıyor",
  "تعذر فحص الصورة أو أن الملف تالف": "Görsel kontrolü başarısız veya dosya bozuk",
  "فشل فحص المقطع الصوتي أو أن الملف تالف": "Ses kontrolü başarısız veya bozuk",
  "حدث خطأ، حاول مرة أخرى": "Bir hata oluştu, tekrar deneyin",
  "خطأ غير معروف": "Bilinmeyen hata",
  "خطأ في النظام": "Sistem hatası",
  "رابط غير صالح": "Geçersiz bağlantı",
  "الإشعار غير موجود": "Bildirim bulunamadı",
  "تعذر الوصول إلى الدردشة": "Sohbete erişilemedi",
  "اشترِ الذهب الافتراضي لترقية حسابك أو حساب أصدقائك وإرسال الهدايا": "Sanal altın satın alın, hesap yükseltin ve hediye gönderin",
  "باقات شحن الذهب المميزة": "Özel Altın Yükleme Paketleri",
  "اختر الباقة المناسبة وادفع عبر البطاقة البنكية أو بطاقة الصراف لشحن رصيدك فورياً": "Uygun paketi seçin ve anında yüklemek için banka/kredi kartıyla ödeyin",
  "متابعة شراء": "Satın almaya devam et",
  "هل انت متأكد تريد الخروج من هذه الغرفة ؟": "Bu odadan ayrılmak istediğinize emin misiniz?",
  "كلا": "Hayır",
  "نعم": "Evet",
  "غرفة محمية": "Korumalı oda",
  "اكتب كلمة المرور للدخول:": "Oda şifresini girin:",
  "❌ كلمة المرور غير صحيحة — حاول مرة أخرى": "❌ Hatalı şifre — tekrar deneyin",
  "قسم الشكاوي": "Şikayet bölümü",
  "إرسال الشكوى": "Şikayet gönder",
  "جاري رفع الملف...": "Dosya yükleniyor...",
  "تم قطع الاتصال": "Bağlantı kesildi",
  "جارٍ إعادة الاتصال...": "Yeniden bağlanılıyor...",
  "اتصال": "Bağlan",
  "نبذة صوتية": "Sesli tanıtım",
  "لا توجد نبذة صوتية بعد": "Henüz sesli tanıtım yok",
  "تسجيل": "Kaydet",
  "رفع ملف": "Dosya yükle",
  "إيقاف": "Durdur",
  "تشغيل": "Oynat",
  "حذف": "Sil",
  "هل تريد حذف النبذة الصوتية؟": "Sesli tanıtımı silmek istiyor musunuz?",
  "تم حذف النبذة الصوتية": "Sesli tanıtım silindi",
  "تم حفظ النبذة الصوتية ✅": "Sesli tanıtım kaydedildi ✅",
  "تعذر رفع النبذة الصوتية": "Sesli tanıtım yüklenemedi",
  "تعذر حفظ النبذة الصوتية": "Sesli tanıtım kaydedilemedi",
  "تعذر التسجيل الصوتي": "Ses kaydedilemedi",
  "تعذر الوصول إلى الميكروفون، تحقق من الإذن": "Mikrofona erişilemedi, iznini kontrol et",

  "نجوم العرب": "Yıldızlar Arapların",
  "الكمية:": "Miktar:",
  "اليوم الساعة": "Bugün saat",
  "أمس الساعة": "Dün saat",
  "تم كتم": "Yapıldı susturma",
  "تم إلغاء كتم": "Yapıldı iptal susturma",
  "تم طرد": "Yapıldı atma",
  "تم حظر": "Yapıldı yasaklama",
  "تم تجاهل": "Yapıldı yok sayma",
  "مرحبا بك": "Merhaba size",
  "رصيد:": "Bakiye:",
  "حسب عنوان IP": "Göre başlık IP",
  "من الغرفة": "-den oda",
  "الدردشة المباشرة": "Sohbet doğrudan",
  "جارٍ إنشاء الحساب...": "Yükleniyor oluşturma hesap...",
  "جارٍ تسجيل الدخول...": "Yükleniyor kayıt giriş...",
  "جارٍ الدخول كزائر...": "Yükleniyor giriş ziyaretçi olarak...",
  "جارٍ تفعيل الحساب...": "Yükleniyor etkinleştirme hesap...",
  "جارٍ إرسال رمز جديد...": "Yükleniyor gönderme kod yeni...",
  "جارٍ إرسال رمز الاستعادة...": "Yükleniyor gönderme kod kurtarma...",
  "جارٍ تحميل الغرفة...": "Yükleniyor indirme oda...",
  "جارٍ فتح الغرفة...": "Yükleniyor açma oda...",
  "جارٍ تحميل الحالات...": "Yükleniyor indirme durumlar...",
  "جارٍ تحميل الإشعارات...": "Yükleniyor indirme bildirimler...",
  "جارٍ تحميل الدخول الملكي...": "Yükleniyor indirme kraliyet girişi...",
  "جارٍ تحميل باقات الذهب...": "Yükleniyor indirme paketler altın...",
  "جارٍ تحميل الصور...": "Yükleniyor indirme fotoğraflar...",
  "جارٍ تجهيز الحائط...": "Yükleniyor hazırlama duvar...",
  "جارٍ الاتصال بالدردشة...": "Yükleniyor bağlantı sohbet...",
  "جارٍ تنفيذ الطلب...": "Yükleniyor yürütme istek...",
  "تعذر رفع الملف": "Başarısız yükleme dosya",
  "تعذر الاتصال أثناء رفع الملف": "Başarısız bağlantı sırasında yükleme dosya",
  "انتهت مهلة رفع الملف": "Bitti zaman aşımı yükleme dosya",
  "تم إلغاء رفع الملف": "Yapıldı iptal yükleme dosya",
  "(رسالة خاصة) |": "(özel mesaj)|",
  "ميكروفون": "Mikrofon",
  "يستقبله الطرف الآخر كـ": "Alır taraf son olarak",
  "أحادية الاتجاه: لا يصلني منه شيء (إن كان يبث وأريد مشاهدته فذلك اتصال": "Tek yönlü yön: hayır bana ulaşır ondan şey(-se idi yayınlar ve istiyorum izlemek bu bağlantı",
  "⇐ أستقبله": "⇐ alırım",
  "، و": "، و",
  "يبقى": "Kalır",
  "📷 صورة": "📷 fotoğraf",
  "🎤 رسالة صوتية": "🎤 mesaj sesli",
  "مستخدم": "Kullanıcı",
  "الآن": "Şimdi",
  "📩 رسالة جديدة": "📩 mesaj yeni",
  "لديك إشعار جديد": "Sizde bildirim yeni",
  "الدردشة": "Sohbet",
  "غرفة مستخدمين": "Oda kullanıcılar",
  "🔒 هذه الغرفة مغلقة حالياً": "🔒 bu oda kapalı şu anda",
  "تم الدخول إلى الغرفة بشكل مخفي": "Yapıldı giriş -ye oda şekilde gizli",
  "👤 هذه الغرفة للأعضاء المسجلين فقط": "👤 bu oda üyeler kayıtlı sadece",
  "تعذر الدخول للغرفة": "Başarısız giriş oda",
  "تعذر تشغيل المقطع الصوتي": "Başarısız çalıştırma klip sesli",
  "نص رسالة الروبوت": "Metin mesaj bot",
  "اللون": "Renk",
  "حجم الخط": "Boyut yazı tipi",
  "اكتب نص رسالة الروبوت": "Yaz metin mesaj bot",
  "تم تعديل رسالة الروبوت ✅": "Yapıldı düzenleme mesaj bot ✅",
  "تعذر تعديل الرسالة": "Başarısız düzenleme mesaj",
  "موضع المقطع": "Konum klip",
  "شهر واحد": "Ay bir",
  "شهرين": "Iki ay",
  "شات الاردن": "Sohbet Ürdün",
  "عضو": "Üye",
  "(متجاهل)": "(yok sayılan)",
  "انتهت هذه الحالة": "Bitti bu durum",
  "تعذر فتح الحالة": "Başarısız açma durum",
  "حساب إداري": "Yönetici hesabı",
  "الصورة": "Fotoğraf",
  "ومنع الرسائل الخاصة بينكما": "Ve engelleme özel mesajlar aranızda",
  "تم إلغاء تجاهل": "Yapıldı iptal yok sayma",
  "تعذر تحديث قائمة التجاهل": "Başarısız güncelleme liste yok sayma",
  "لا تملك صلاحية سحب المايك": "Izniniz yok çekme mikrofon",
  "تم سحب المايك من": "Yapıldı çekme mikrofon -den",
  "تعذر سحب المايك": "Başarısız çekme mikrofon",
  "لا تملك صلاحية سحب المايك مع المنع": "Izniniz yok çekme mikrofon ile engelleme",
  "ومنع صعوده للبث": "Ve engelleme katılması yayın",
  "تعذر تنفيذ الإجراء": "Başarısız yürütme işlem",
  "لا تملك صلاحية فك المنع": "Izniniz yok kaldırma engelleme",
  "سمحت لـ": "Izin verdin -e",
  "بالصعود إلى البث": "Katılma -ye yayın",
  "لا تملك صلاحية الكتم": "Izniniz yok susturma",
  "تعذر تغيير حالة الكتم": "Başarısız değiştirme durum susturma",
  "لا تملك صلاحية الطرد": "Izniniz yok atma",
  "تعذر طرد المستخدم": "Başarısız atma kullanıcı",
  "لا تملك صلاحية الحظر": "Izniniz yok yasaklama",
  "على الحساب والجهاز": "-de hesap cihaz",
  "غير معروف": "Değil bilinen",
  "متصل الآن": "Bağlı şimdi",
  "غير متصل": "Değil bağlı",
  "،": "،",
  "كشف النكات متاح للإدارة العامة فقط": "Ifşa takma adlar mevcut yönetim genel sadece",
  "تعذر كشف النكات": "Başarısız ifşa takma adlar",
  "تعذر الإرسال": "Başarısız gönderme",
  "تعذر إتمام الترقية": "Başarısız tamamlama yükseltme",
  "قطر": "Katar",
  "البحرين": "Bahreyn",
  "سلطنة عمان": "Sultanlığı Umman",
  "سوريا": "Suriye",
  "لبنان": "Lübnan",
  "الجزائر": "Cezayir",
  "المغرب": "Fas",
  "تونس": "Tunus",
  "ليبيا": "Libya",
  "اليمن": "Yemen",
  "السودان": "Sudan",
  "تعذر فتح الملف الشخصي": "Başarısız açma dosya kişisel",
  "لا يوجد نبذة": "Yok hakkında",
  "إبلاغ عن": "Bildirme hakkında",
  "إلغاء تجاهل": "Iptal yok sayma",
  "تمت الإضافة لقائمة التجاهل 🚫": "Yapıldı ekleme listeye yok sayma 🚫",
  "تم إلغاء التجاهل": "Yapıldı iptal yok sayma",
  "مخفي 🔒": "Gizli 🔒",
  "تعذر الحذف": "Başarısız silindi",
  "المتصفح لا يدعم التسجيل الصوتي": "Tarayıcı hayır destekler kayıt sesli",
  "تعذر الحفظ": "Başarısız kaydet",
  "حذف المحادثة": "Silme sohbet",
  "تم حذف المحادثة ✅": "Yapıldı silme sohbet ✅",
  "تعذر حذف المحادثة": "Başarısız silme sohbet",
  "لا يمكن فتح الخاص مع مستخدم متجاهَل": "Olamaz açma özel ile kullanıcı yok sayılan",
  "المحادثة الخاصة غير متاحة": "Özel sohbet değil mevcut",
  "تم بدء مكالمة": "Yapıldı başlatma arama",
  "بدء": "Başlatma",
  "فائتة": "Cevapsız",
  "منتهية": "Bitmiş",
  "انقطعت": "Kesildi",
  "المدة": "Süre",
  "كاميرا مطفأة": "Kamera kapalı",
  "عضويتك غير مسموح لها بإجراء مكالمات الفيديو الخاصة": "Üyeliğiniz izinli değil ona yapmak aramalar video özel",
  "تأكيد بدء مكالمة الفيديو 📹": "Onay başlatma arama video 📹",
  "فيديو (غير محدود)": "Video(değil sınırlı)",
  "متصفحك لا يدعم المكالمات الخاصة": "Tarayıcınız hayır destekler aramalar özel",
  "تعذر الوصول إلى الكاميرا/الميكروفون:": "Başarısız erişim -ye kamera/mikrofon:",
  "يرجى منح الإذن": "Lütfen verme izin",
  "تعذر الوصول إلى الميكروفون:": "Başarısız erişim -ye mikrofon:",
  "جاري التوصيل...": "Bağlanıyor...",
  "ضعف في الاتصال...": "Zayıf -de bağlantı...",
  "مكالمة فيديو جارية": "Görüntülü arama devam eden",
  "تم إيقاف الكاميرا": "Yapıldı durdur kamera",
  "تم تشغيل الكاميرا": "Yapıldı çalıştırma kamera",
  "الجودة: 360p (ثابتة)": "Kalite: 360p(sabit)",
  "انقر لتصغير صورك • اسحبه للتحريك": "Tıklayın küçültmek fotoğraflarınız• sürükleyin taşıma",
  "انقر لتكبير صورك • اسحبه للتحريك": "Tıklayın büyütmek fotoğraflarınız• sürükleyin taşıma",
  "انقر لتكبير صوره • اسحبه للتحريك": "Tıklayın büyütmek fotoğrafı• sürükleyin taşıma",
  "انقر لتصغير صوره": "Tıklayın küçültmek fotoğrafı",
  "تم رفض المكالمة": "Yapıldı reddetme arama",
  "المستخدم مشغول في مكالمة أخرى": "Kullanıcı meşgul -de arama diğer",
  "المستخدم غير متصل حالياً": "Kullanıcı değil bağlı şu anda",
  "لا يمكن الاتصال بسبب التجاهل": "Olamaz bağlantı nedeniyle yok sayma",
  "عضويتك غير مسموح لها بالمكالمات الخاصة": "Üyeliğiniz izinli değil ona aramalar özel",
  "تم إلغاء المكالمة من الطرف الآخر": "Yapıldı iptal arama -den taraf son",
  "تم إنهاء المكالمة": "Yapıldı bitirme arama",
  "انقطع اتصال الطرف الآخر": "Kesildi bağlantı taraf son",
  "مكتوم": "Susturulmuş",
  "تم كتم الميكروفون": "Yapıldı susturma mikrofon",
  "تم تشغيل الميكروفون": "Yapıldı çalıştırma mikrofon",
  "سبيكر (مفعل)": "Hoparlör(etkin)",
  "مكبر": "Yükseltilmiş",
  "🔊 تم تشغيل مكبر الصوت (السبيكر)": "🔊 yapıldı çalıştırma yükseltilmiş ses(hoparlör)",
  "سماعة الأذن": "Kulaklık kulak",
  "أذن": "Kulak",
  "📱 تم التحويل إلى سماعة الأذن الداخلية": "📱 yapıldı transfer -ye kulaklık kulak dahili",
  "مكالمة جارية": "Arama devam eden",
  "مكالمة فيديو خاصة واردة...": "Görüntülü arama özel gelen...",
  "عضويتك غير مسموح لها بإرسال الرسائل الخاصة": "Üyeliğiniz izinli değil ona göndermeye özel mesajlar",
  "عضويتك غير مسموح لها بنشر الحالات": "Üyeliğiniz izinli değil ona yayınlamaya durumlar",
  "جاري نشر الحالة...": "Yayınlama durum...",
  "جاري رفع الحالة...": "Yükleme durum...",
  "تم نشر حالتك لمدة 24 ساعة ✓": "Yapıldı yayınlama durumunuz süre 24 saat ✓",
  "تعذر نشر الحالة": "Başarısız yayınlama durum",
  "نوع الملف لا يطابق نوع الحالة المختار": "Tür dosya hayır eşleşiyor tür durum seçilmiş",
  "اكتب نص الحالة أولاً": "Yaz metin durum önce",
  "لا يمكن عرض المشاهدين": "Olamaz gösterim izleyiciler",
  "تم حذف الحالة": "Yapıldı silme durum",
  "تعذر حذف الحالة": "Başarısız silme durum",
  "حساب PayPal": "Hesap PayPal",
  "حساب بنكي": "Hesap banka",
  "تعذر التحويل الآلي": "Otomatik transfer başarısız",
  "جارٍ التحويل تلقائيًا إلى حسابك 💸": "Otomatik aktarılıyor -ye hesabınız 💸",
  "قيد المراجعة من الإدارة": "Incelemede -den yönetim",
  "تم التحويل بنجاح": "Transfer başarıyla tamamlandı",
  "تم إرسال الدفعة (قد تكون قيد المعالجة)": "Yapıldı gönderme ödeme(-ebilir olmak altında işleme)",
  "لم تستلمي هدايا بعد — استقبلي الهدايا أولاً": "Değil alırsın hediyeler sonra — alın hediyeler önce",
  "— غير متاح حاليًا": "— değil mevcut şu anda",
  "بريد حساب PayPal الذي ستستلمين عليه المبلغ": "E-posta hesap PayPal - alacaksın ona miktar",
  "رقم الحساب البنكي / رقم البطاقة (8-19 رقمًا)": "Numara hesap banka / numara kart(8-19 rakam)",
  "اسم صاحب الحساب": "Isim sahibi hesap",
  "أدخلي بريدك الإلكتروني المرتبط بحساب PayPal بشكل صحيح": "Girin e-postanız elektronik bağlı hesaba PayPal şekilde doğru",
  "رقم الحساب غير صحيح — يجب أن يتكون من 8 إلى 19 رقمًا": "Numara hesap değil doğru — gerekir -dığı oluşur -den 8 -ye 19 rakam",
  "حددي كمية الهدايا المراد تسكيرها أولاً": "Belirleyin miktar hediyeler amaçlanan nakde önce",
  "تم إرسال طلب التسكير ✓ سيصلك إشعار فور اتمام التحويل": "Yapıldı gönderme istek nakde çevirme ✓ alacaksınız bildirim hemen tamamlama transfer",
  "تعذر إلغاء التجاهل": "Başarısız iptal yok sayma",
  "ليس لديك صلاحية دخول لوحة الإدارة": "Değil sizde yetki giriş yönetim paneli",
  "جاري تأمين وفتح لوحة الإدارة بالرمز السري...": "Güvence ve açma yönetim paneli kod gizli...",
  "تعذر توليد رابط الإدارة": "Başarısız oluşturma bağlantı yönetim",
  "تعذر فتح لوحة الإدارة": "Başarısız açma yönetim paneli",
  "تم تغيير الحالة إلى": "Yapıldı değiştirme durum -ye",
  "تم إرسال طلب التوثيق إلى لوحة الإدارة ✓ ولن يتم الخصم إلا بعد الموافقة": "Yapıldı gönderme istek doğrulama -ye yönetim paneli ✓ ve olmayacak yapılır kesinti hariç sonra onay",
  "الأسد الملكي": "Aslan kraliyet",
  "يدخل كالأسد الهادر — قوة ومهابة": "Girer aslan kükreyen — güç ve heybet",
  "الحوت الملكي": "Balina kraliyet",
  "يبحر في الغرفة بهدوء الملوك — عمق وهدوء": "Yüzer -de oda sakinçe krallar — derinlik ve sakinlik",
  "العقاب الملكي": "Kartal kraliyet",
  "يحلّق فوق الجميع — حرية وقوة": "Savar üzerinde tüm — özgürlük ve güç",
  "الوحيد قرن": "Tek boynuz boynuz",
  "يسطع قوس قزح أينما دخل — تميز فريد": "Parlar kuşak gökkuşağı nerede girdi — ayrıcalık benzersiz",
  "الفراشة الملكية": "Kelebek sahiplik",
  "ترفرف بألوانها أينما دخلت — رقيّ وأنوثة": "Kanat çırpar renkleriyle nerede girdi — zarafet ve kadınlık",
  "القطة الملكية": "Kedi sahiplik",
  "دخول لطيف يخطف القلوب — نعومة ودلال": "Giriş sevimli çalar kalpler — yumuşaklık ve şirinlik",
  "الوردة الحمراء": "Gül kırmızı",
  "تدخل كوردة حمراء فاخرة — جمال ملكي": "Girersin gül olarak kırmızı lüks — güzellik kraliyet",
  "الوردة المتفتحة": "Gül tomurcuk",
  "تتفتّح الغرفة بجمالها — سحر وأنوثة": "Açar oda güzelliğiyle — büyü ve kadınlık",
  "الوردة الوردية": "Gül pembe",
  "وردة وردية ناعمة — دخول ملكي للبنات": "Gül pembe yumuşak — giriş kraliyet kızlar",
  "دخول ملكي مميز — حضور يليق بك": "Giriş kraliyet premium — hediye Varlığı yakışır size",
  "دخول ملكي": "Giriş kraliyet",
  "✋ طلبك لتغيير الحيوان الملكي قيد المراجعة لدى الإدارة — سيصلك إشعار بنتيجة الموافقة.": "✋ isteğiniz değiştirmek kraliyet hayvanı incelemede -de yönetim — alacaksınız bildirim sonuçla onay.",
  "تعذر إرسال طلب التغيير": "Başarısız gönderme istek değiştirme",
  "البنك التجاري المعتمد": "Banka ticari onaylı",
  "الأكثر طلباً": "Daha istenen",
  "لا توجد باقات متاحة حالياً": "Yok paketler mevcut şu anda",
  "يجب تسجيل الدخول بحساب مسجل لإتمام عملية الشراء": "Gerekir kayıt giriş hesaba kayıtlı tamamlamak işlem satın alma",
  "تعذر إنشاء العملية": "Başarısız oluşturma işlem",
  "الحساب التجاري مقيد لدى PayPal ولا يستطيع قبول الدفعات — يرجى حل القيد من حساب PayPal (تفعيل الحساب وإكمال بيانات العمل) أو استخدام وضع «تجريبي» بحساب Business مُفعّل.": "Hesap ticari kısıtlı -de PayPal veya yapabilir kabul ödemeler — lütfen çözüm altında -den hesap PayPal(etkinleştirme hesap ve tamamlama veri iş) veya kullanım mod«demo» hesaba Business etkinleştirilmiş.",
  "حدث خطأ أثناء الدفع —": "Oldu hata sırasında ödeme —",
  "لم تنجح العملية —": "Değil başarılı işlem —",
  "حاول مجدداً.": "Deneyin tekrar.",
  "ألغيت عملية الدفع — لم يُخصم أي مبلغ": "Iptal edildi işlem ödeme — değil kesilir herhangi miktar",
  "جاري تحميل بوابة الدفع الآمن...": "Indirme geçit ödeme güvenli...",
  "الملف يجب أن يكون صورة": "Dosya gerekir -dığı olmak fotoğraf",
  "حجم الصورة يجب ألا يتجاوز 8MB": "Boyut fotoğraf gerekir -memesi aşmasın 8MB",
  "تعذر رفع الصورة المرفقة": "Başarısız yükleme fotoğraf ekli",
  "تم إرسال الشكوى إلى الإدارة": "Yapıldı gönderme şikayet -ye yönetim",
  "تعذر إرسال الشكوى": "Başarısız gönderme şikayet",
  "لا توجد صور مرفوعة بعد": "Yok fotoğraflar yüklenmiş sonra",
  "اضغط على \"رفع صورة\" بالأسفل (يتم حفظ حتى 10 صور)": "Basın -de \"yükleme fotoğraf\" alt(yapılır kaydet -e kadar 10 fotoğraflar)",
  "جاري رفع الصورة الشخصية...": "Yükleme fotoğraf kişisel...",
  "تم رفع الصورة وحفظها في قائمة مرفوعاتي ✅": "Yapıldı yükleme fotoğraf ve kaydetmek -de liste yüklemelerim ✅",
  "تعذر رفع الصورة": "Başarısız yükleme fotoğraf",
  "تم حفظ الصورة بنجاح ✅": "Yapıldı kaydet fotoğraf başarıyla ✅",
  "تعذر حفظ الصورة": "Başarısız kaydet fotoğraf",
  "فيديو YouTube": "Video YouTube",
  "اضغط للمشاهدة في العارض الكامل": "Basın izleme -de görüntüleyici tam",
  "فيديو مرفوع": "Video yüklenmiş",
  "اضغط لتشغيل الفيديو كاملاً": "Basın çalmak video tam",
  "اضغط لعرض الصورة كاملة": "Basın göstermek fotoğraf tam",
  "يمكنك تكبير الصورة من المتصفح": "Yapabilirsiniz büyütme fotoğraf -den tarayıcı",
  "استخدم أزرار المشغل للتحكم بالصوت والمشاهدة": "Kullanın düğmeler oynatıcı kontrol ses izleme",
  "فتح في YouTube": "Açma -de YouTube",
  "فتح الصورة الأصلية": "Açma fotoğraf orijinal",
  "فتح الفيديو الأصلي": "Açma video orijinal",
  "عضويتك غير مسموح لها بالنشر على الحائط": "Üyeliğiniz izinli değil ona yayınlama -de duvar",
  "اكتب كلمات البحث في YouTube": "Yaz kelimeler arama -de YouTube",
  "تعذر البحث في YouTube": "Başarısız arama -de YouTube",
  "جاري رفع الصورة...": "Yükleme fotoğraf...",
  "جاري رفع صورة الحائط...": "Yükleme fotoğraf duvar...",
  "تم رفع الصورة بنجاح": "Yapıldı yükleme fotoğraf başarıyla",
  "جاري رفع الفيديو...": "Yükleme video...",
  "جاري رفع فيديو الحائط...": "Yükleme video duvar...",
  "جاري تجهيز صورة معاينة الفيديو...": "Hazırlama fotoğraf önizleme video...",
  "تم رفع الفيديو وتجهيز صورة المعاينة بنجاح": "Yapıldı yükleme video ve hazırlama fotoğraf önizleme başarıyla",
  "تم رفع الفيديو بنجاح": "Yapıldı yükleme video başarıyla",
  "تعذر رفع الفيديو": "Başarısız yükleme video",
  "جاري نشر المنشور على الحائط...": "Yayınlama gönderi -de duvar...",
  "تم نشر المنشور": "Yapıldı yayınlama gönderi",
  "تعذر نشر المنشور": "Başarısız yayınlama gönderi",
  "لا توجد إشعارات لحذفها": "Yok bildirimler silmek",
  "تم حذف جميع الإشعارات بنجاح ✓": "Yapıldı silme tüm bildirimler başarıyla ✓",
  "تعذر حذف الإشعارات": "Başarısız silme bildirimler",
  "أدخل البريد الإلكتروني المسجل": "Girin e-posta adresi kayıtlı",
  "📧 تم إرسال رمز الاستعادة إلى بريدك": "📧 yapıldı gönderme kod kurtarma -ye e-postanız",
  "تعذر إرسال الرمز": "Başarısız gönderme kod",
  "📧 أُعيد إرسال الرمز": "📧 yeniden gönderme kod",
  "تعذر إعادة الإرسال": "Başarısız yeniden gönderme",
  "إعادة الإرسال (": "Yeniden gönderme(",
  "ث)": "Sn)",
  "أدخل رمز الاستعادة المكون من 6 أرقام": "Girin kod kurtarma oluşan -den 6 rakamlar",
  "كلمة المرور الجديدة 4 خانات على الأقل": "Yeni şifre 4 karakter -de az",
  "كلمتا المرور غير متطابقتين": "Şifreler eşleşmiyor",
  "✅ تم تغيير كلمة المرور — ادخل الآن بكلمة المرور الجديدة": "✅ yapıldı değiştirme şifre — gir şimdi ileyeni şifre",
  "تعذر تغيير كلمة المرور": "Başarısız değiştirme şifre",
  "؟": "؟",
  "فشل الدخول": "Başarısızlık giriş",
  "ضيف": "Misafir",
  "نجم": "Yıldız",
  "عاشق": "Aşık",
  "مغامر": "Maceracı",
  "همس": "Fısıltı",
  "شهم": "Yiğit",
  "ذوق": "Zarif",
  "أهلا بك كزائر": "Hoş geldiniz size ziyaretçi olarak",
  "⚠️ خدمة البريد (SMTP) غير مفعّلة من لوحة الإدارة — لم يُرسل الرمز بعد": "⚠️ e-posta servisi(SMTP) etkin değil yönetim panelinden — değil gönderilir kod sonra",
  "⚠️ تعذر إرسال البريد:": "⚠️ başarısız gönderme e-posta:",
  "جارٍ تجهيز قالب رمز التفعيل...": "Yükleniyor hazırlama şablon kod etkinleştirme...",
  "أدخل رمز التفعيل المكوّن من 6 أرقام": "Girin kod etkinleştirme oluşan -den 6 rakamlar",
  "تم تفعيل حسابك بنجاح 🎉": "Yapıldı etkinleştirme hesabınız başarıyla 🎉",
  "تعذر التفعيل — تحقق من الرمز": "Başarısız etkinleştirme — kontrol -den kod",
  "يرجى الانتظار قبل إعادة الإرسال": "Lütfen bekleme önce yeniden gönderme",
  "تم إرسال رمز جديد إلى جيميلك 📧": "Yapıldı gönderme kod yeni -ye Gmailiniz 📧",
  "⚠️ خدمة البريد غير مفعّلة — لم يُرسل الرمز": "⚠️ e-posta servisi etkin değil — değil gönderilir kod",
  "البريد يجب أن يكون Gmail (ينتهي بـ @gmail.com)": "E-posta gerekir -dığı olmak Gmail(biter ile @gmail.com)",
  "فشل التسجيل": "Başarısızlık kayıt",
  "إيقاف البث والمكالمة": "Durdur yayın arama",
  "إيقاف المكالمة": "Durdur arama",
  "إيقاف البث": "Durdur yayın",
  "إيقاف البث والمكالمة والمتابعة": "Durdur yayın arama devam",
  "لا يمكنك الانتقال إلى غرفة أخرى أثناء مكالمة جارية. يجب إغلاق المكالمة أولاً ثم يمكنك الدخول إلى الغرفة الأخرى.": "Olamazolarak geçiş -ye oda diğer sırasında arama devam eden. gerekir kapatma arama önce sonra yapabilirsiniz giriş -ye oda diğer.",
  "إيقاف المكالمة والمتابعة": "Durdur arama devam",
  "لا يمكنك الانتقال إلى غرفة أخرى أثناء البث المباشر. يجب إغلاق البث أولاً ثم يمكنك الدخول إلى الغرفة الأخرى.": "Olamazolarak geçiş -ye oda diğer sırasında canlı yayın. gerekir kapatma yayın önce sonra yapabilirsiniz giriş -ye oda diğer.",
  "إيقاف البث والمتابعة": "Durdur yayın devam",
  "— اضغط للتشغيل/الإيقاف": "— basın çalıştırma/durdur",
  "اضغط زر الراديو مرة أخرى للاستماع": "Basın düğme radyo kez diğer dinleme",
  "تم حذف «العام» لديك فقط — يبقى ظاهراً لبقية المستخدمين": "Yapıldı silme«genel» sizde sadece — kalır görünür kalanı için kullanıcılar",
  "تعذر حذف «العام»": "Başarısız silme«genel»",
  "السوبر أدمن": "Süper yönetici",
  "تم حذف «العام» من الغرفة بالكامل 🧹 بواسطة": "Yapıldı silme«genel» -den oda tam 🧹 tarafından",
  "تعذر حذف «العام» للجميع": "Başarısız silme«genel» tüm",
  "اكتب كلمة المرور الحالية": "Yaz şifre mevcut",
  "كلمة المرور الجديدة يجب أن لا تقل عن 4 خانات": "Yeni şifre gerekir -dığı hayır az hakkında 4 karakter",
  "تم تغيير كلمة المرور بنجاح ✅": "Yapıldı değiştirme şifre başarıyla ✅",
  "تم تغيير اللغة": "Yapıldı değiştirme dil",
  "عضويتك غير مسموح لها بإرسال الرسائل في العام": "Üyeliğiniz izinli değil ona göndermeye mesajlar -de genel",
  "اختر مستخدماً أولاً": "Seç kullanıcı olarak önce",
  "تم تغيير لون خطك 🎨": "Yapıldı değiştirme renk yazı tipiniz 🎨",
  "رجع لون خطك للون رتبتك": "Geri döndü renk yazı tipiniz renk rütbeniz",
  "جاري رفع المقطع الصوتي...": "Yükleme klip sesli...",
  "جاري رفع الصورة إلى العام...": "Yükleme fotoğraf -ye genel...",
  "جاري رفع الصورة إلى الخاص...": "Yükleme fotoğraf -ye özel...",
  "فحص الصورة قبل الإرسال": "Kontrol fotoğraf önce gönderme",
  "فحص المقطع الصوتي قبل الإرسال": "Kontrol klip sesli önce gönderme",
  "تعذر فحص الملف أو أن تنسيقه غير مدعوم": "Başarısız kontrol dosya veya -dığı biçimi değil destekleniyor",
  "تم فحص الصورة ويمكن إرسالها": "Yapıldı kontrol fotoğraf ve olabilir göndermek",
  "تم فحص المقطع ويمكن إرساله": "Yapıldı kontrol klip ve olabilir göndermek",
  "اختر عضواً أولاً": "Seç bir üye önce",
  "المحادثة الخاصة غير مفتوحة": "Özel sohbet değil açık",
  "عضويتك غير مسموح لها بإرسال الصور في الخاص": "Üyeliğiniz izinli değil ona göndermeye fotoğraflar -de özel",
  "عضويتك غير مسموح لها بإرسال الصور في العام": "Üyeliğiniz izinli değil ona göndermeye fotoğraflar -de genel",
  "عضويتك غير مسموح لها بإرسال المقاطع الصوتية": "Üyeliğiniz izinli değil ona göndermeye klipler sesli",
  "تعذر إنشاء التسجيل الصوتي": "Başarısız oluşturma kayıt sesli",
  "عضويتك غير مسموح لها بإرسال الرسائل الصوتية في الخاص": "Üyeliğiniz izinli değil ona göndermeye mesajlar sesli -de özel",
  "اعدادات الخاص : استقبال الرسائل من الجميع": "Ayarlar özel: alma mesajlar -den tüm",
  "محاولة إعادة الاتصال رقم": "Deneme yeniden bağlantı numara",
  "تمت إضافة": "Yapıldı ekleme",
  "ذهب إلى رصيدك بواسطة الإدارة (الرصيد:": "Altın -ye bakiyeniz tarafından yönetim(bakiye:",
  "تم تعديل رصيدك بواسطة الإدارة (الرصيد:": "Yapıldı düzenleme bakiyeniz tarafından yönetim(bakiye:",
  "تم تغيير اسم حسابك إلى:": "Yapıldı değiştirme isim hesabınız -ye:",
  "بنجاح ✨": "Başarıyla ✨",
  "تم حذف العام من قبل": "Yapıldı silme genel -den önce",
  "👑 مُنح لك الدخول الملكي بـ": "👑 verildi senin kraliyet girişi ile",
  "! سيظهر توهجه عند دخولك الغرف": "! görünecek parıltısı -de girişiniz odalar",
  "تم خصم": "Yapıldı kesinti",
  "ذهب رسوم المكالمة (الرصيد:": "Altın ücret arama(bakiye:",
  "فتح الكاميرا 📷": "Açma kamera 📷",
  "أغلق الكاميرا 📷": "Kapat kamera 📷",
  "وافق على مشاهدتك لبثه": "Onayladı -de seni izleme yayınına",
  "آخرين": "Başkaları",
  "يتحدث الآن مباشرة": "Konuşuyor şimdi doğrudan",
  "يبثون فيديو مباشر الآن — اضغط على صورة أحدهم للمشاهدة": "Yayın yapıyorlar video canlı şimdi — basın -de fotoğraf birinin izleme",
  "يبث فيديو مباشر الآن — اضغط على صورته للمشاهدة": "Yayınlar video canlı şimdi — basın -de fotoğrafına izleme",
  "مشاهد": "Izleyiciler",
  "• تشاهد بث": "• izliyorsun yayın",
  "• تشاهد": "• izliyorsun",
  "بثوث": "Yayınlar",
  "تشاهد": "Izliyorsun",
  "بثوث مباشرة": "Yayınlar doğrudan",
  "(أنت)": "(sen)",
  "يريد مشاهدة البث": "Istiyor izleme yayın",
  "قبول": "Kabul",
  "يطلب الإذن للتحدث": "Istiyor izin konuş",
  "المتحدثون الحاليون": "Konuşanlar mevcut",
  "تم إرسال طلب مشاهدة إلى": "Yapıldı gönderme istek izleme -ye",
  "— بانتظار موافقته…": "— bekliyor onayı…",
  "— عند موافقته سيُعرض بثه بجانب البثوث الحالية": "— -de onayı gösterilecek yayını yanında yayınlar mevcut",
  "نظام الطرد": "Sistem atma",
  "نظام الحظر": "Sistem yasaklama",
  "أشهر": "Ay",
  "شهراً": "Ay",
  "نظام الترقية": "Sistem yükseltme",
  "لمدة": "Süre",
  "تم اهداء": "Yapıldı hediye",
  "بواسطة": "Tarafından",
  "أرسل هذه الترقية إلى": "Gönder bu yükseltme -ye",
  "قام": "Yaptı",
  "بإرسال هدية": "Göndermeye hediye",
  "أرسل هذه الهدية إلى": "Gönder bu hediye -ye",
  "الكمية ×": "Miktar ×",
  "👑 دخول ملكي •": "👑 giriş kraliyet•",
  "👑 هدية ملكية •": "👑 hediye sahiplik•",
  "عنوان IP:": "Başlık IP:",
  "الدولة:": "Ülke:",
  "عدد الأسماء من نفس الـ IP:": "Sayı isimler -den aynı - IP:",
  "وقت الدخول:": "Zaman giriş:",
  "تم إرسال": "Yapıldı gönderme",
  "بنجاح 🎉": "Başarıyla 🎉",
  "تمت ترقية": "Yapıldı yükseltme",
  "بنجاح 👑": "Başarıyla 👑",
  "رصيد الذهب غير كافٍ (المطلوب:": "Altın bakiyesi değil yeterli(gerekli:",
  "الهدية من": "Hediye -den",
  "كمية:": "Miktar:",
  "سنة": "Yıl",
  "اسم المستخدم": "Kullanıcı adı",
  "الجنس": "Cinsiyet",
  "الدولة": "Ülke",
  "العضوية": "Üyelik",
  "الرصيد": "Bakiye",
  "حذف المحادثة مع": "Silme sohbet ile",
  "هل ترغب في بدء مكالمتك الصوتية التجريبية الأولى مع": "Mi isterseniz -de başlatma aramanız sesli deneme ilk ile",
  "هذه المكالمة مجانية بالكامل لأول دقيقة (60 ثانية).": "Bu arama ücretsiz tam ilk dakika(60 saniye).",
  "يرجى شحن رصيدك لتتمكن من إجراء المكالمة.": "Lütfen yükleme bakiyeniz yapabilmek -den işlem arama.",
  "الميزة:": "Özellik:",
  "مجانية بالكامل (0 ذهب)": "Ücretsiz tam(0 altın)",
  "سيتم خصم": "Yapılacak kesinti",
  "من رصيدك عند رد": "-den bakiyeniz -de yanıt",
  "على مكالمة الفيديو 📹": "-de arama video 📹",
  "تم استهلاك التجربة المجانية مسبقاً. سيتم خصم": "Yapıldı kullanılmış deneme ücretsiz önceden. yapılacak kesinti",
  "على المكالمة.": "-de arama.",
  "آخر تحديث": "Son güncelleme",
  "من:": "-den:",
  "حالة التحويل": "Durum transfer",
  "(رقم الدفعة": "(numara ödeme",
  "تعذر الإرسال الآلي — لم تُحذف هداياك": "Başarısız gönderme otomatik — değil silinir hediyeleriniz",
  "تسكير الهدايا": "Hediyeleri nakde çevirme",
  "هدايا محددة للتسكير": "Hediyeler belirli nakde çevirme",
  "ذهب الهدايا المحددة": "Altın hediyeler belirli",
  "المبلغ الذي سيُحوَّل إلى حسابك": "Miktar - transfer edilecek -ye hesabınız",
  "طريقة الاستلام": "Yöntem alma",
  "مجموع ذهب هداياك": "Toplam altın hediyeleriniz",
  "🪙 والمتطلبات للتسكير": "🪙 gereksinimler nakde çevirme",
  "🪙 — ينقصك": "🪙 — eksik",
  "تسكير الهدايا إلى دولارات 💵": "Hediyeleri nakde çevirme -ye dolar 💵",
  "معدل التحويل:": "Oran transfer:",
  "لكل": "Başına",
  "— المبلغ يتناسب طردياً مع الكمية (يحدّده الإداري)": "— miktar orantılı orantılı ile miktar(belirler yönetici)",
  "عدد الهدايا المستلمة": "Sayı hediyeler alınan",
  "الحد الأدنى للتسكير": "Sınır en az nakde çevirme",
  "حددي كمية الهدايا التي تريدين تسكيرها": "Belirleyin miktar hediyeler -diği istiyorsan nakde",
  "المحددة:": "Belirli:",
  "هدية) / الحد الأدنى": "Hediye) / sınır en az",
  "المتابعة لبيانات الحساب (": "Devam verileri hesap(",
  "بيانات حساب الاستلام": "Veri hesap alma",
  "هدية محددة": "Hediye belirli",
  "💵 سيُحوَّل $": "💵 transfer edilecek $",
  "يُخصم": "Kesilir",
  "المحدد فقط": "Belirli sadece",
  ") من حسابك وتبقى بقية الهدايا المتكررة كما هي.": ") -den hesabınız ve kalır kalan hediyeler tekrarlayan olarak dir.",
  "حساب باي بال (تحويل تلقائي من حساب الإدارة)": "Hesap Pay Pal(transfer otomatik -den hesap yönetim)",
  "حساب بنكي (تحويل يدوي من الإدارة — ليس فوريًا)": "Hesap banka(transfer manuel -den yönetim — değil anında)",
  "إرسال طلب التسكير ($": "Gönderme istek nakde çevirme($",
  "متجاهل • الرسائل الخاصة متوقفة": "Yok sayılan• özel mesajlar durdurulmuş",
  "حسابك يحمل الدخول الملكي 👑 — الصلاحية حتى": "Hesabınız taşır kraliyet girişi 👑 — yetki -e kadar",
  ". اختر حيواناً آخر ثم اضغط «تغيير الحيوان الملكي».": ". seç başka hayvan son sonra basın«değiştirme kraliyet hayvanı».",
  "تم إرسال طلبك للدخول الملكي بـ": "Yapıldı gönderme isteğiniz giriş kraliyet ile",
  "إلى لوحة الإدارة ✓ لن يتم الخصم إلا بعد الموافقة": "-ye yönetim paneli ✓ -mayacak yapılır kesinti hariç sonra onay",
  "تم إرسال طلب تغيير حيوانك الملكي إلى": "Yapıldı gönderme istek değiştirme hayvanınız kraliyet -ye",
  "للإدارة ✓": "Yönetim ✓",
  "🎉 تمت عملية الدفع بنجاح! شحن": "🎉 yapıldı işlem ödeme başarıyla! yükleme",
  "ذهب (": "Altın(",
  ") إلى رصيدك 🪙": ") -ye bakiyeniz 🪙",
  "الدفع الإلكتروني غير متاح حالياً — تواصل مع الإدارة": "Ödeme elektronik değil mevcut şu anda — iletişim ile yönetim",
  "بوابة الدفع لم تُفعّل بعد — يرجى التواصل مع الإدارة": "Geçit ödeme değil etkinleştirilir sonra — lütfen iletişim ile yönetim",
  "بلا إطلالة": "Olmadan görünüm",
  "صورة مرفقة بالمنشور": "Fotoğraf ekli gönderi",
  "اضغط هنا لفتح الصورة بالحجم الكامل": "Basın burada açmak fotoğraf boyut tam",
  "اضغط للمشاهدة داخل المشغل": "Basın izleme içinde oynatıcı",
  "مقطع فيديو": "Klip video",
  "اضغط لتشغيل الفيديو في المشغل": "Basın çalmak video -de oynatıcı",
  "إظهار المزيد (": "Gösterme daha(",
  "تفاعل •": "Etkileşim•",
  "الاسم": "Isim",
  "جلسة أو رابط الإدارة": "Oturum veya bağlantı yönetim",
  "منتهي الصلاحية": "Süresi bitmiş yetki",
  "انتهت صلاحية جلسة الإدارة نظراً لتوليد رمز جديد في الدردشة": "Bitti yetki oturum yönetim nedeniyle oluşturmak kod yeni -de sohbet",
  "القيمة:": "Değer:",
  "الغرفة:": "Oda:",
  "🏠 الغرفة:": "🏠 oda:",
  "📅 تاريخ التعيين:": "📅 tarih atama:",
  "الرابط :": "Bağlantı:",
  "الترتيب:": "Sıralama:",
  "تاريخ:": "Tarih:",
  "المستخدم:": "Kullanıcı:",
  "تم حفظ وتطبيق إعدادات اللغة بنجاح": "Yapıldı kaydet ve uygulama ayarlar dil başarıyla",
  "إعدادات الراديو": "Ayarlar radyo",
  "البريد الإلكتروني والتحقق (Gmail)": "E-posta adresi kontrol(Gmail)",
  "الشروط والخصوصية": "Şartlar gizlilik",
  "شكاوى المستخدمين": "Şikayetler kullanıcılar",
  "هدايا حساب (بحث وحذف)": "Hediyeler hesap(arama ve silme)",
  "تسكير الهدايا (سحب الدولارات)": "Hediyeleri nakde çevirme(çekme dolar)",
  "تسجيلات المكالمات الصوتية": "Kayıtlar aramalar sesli",
  "تسجيل مكالمات الفيديو": "Kayıt aramalar video",
  "صور وأصوات الدخول الملكي": "Fotoğraflar ve sesler kraliyet girişi",
  "تتبع المستخدمين": "Takip kullanıcılar",
  "✓ صوت مخصص مرفوع": "✓ ses özel yüklenmiş",
  "🔊 نغمة افتراضية": "🔊 melodi varsayılan",
  "🔇 مكتوم (مفصول)": "🔇 susturulmuş(ayrılmış)",
  "سوبر أدمن / المالك": "Süper yönetici / sahip",
  "عضوية مميز": "Üyelik premium",
  "عضوية VIP": "Üyelik VIP",
  "عضوية Premium": "Üyelik Premium",
  "عضوية Plus": "Üyelik Plus",
  "شارة الدخول المخفي": "Rozet giriş gizli",
  "🔊 صوت الهدية مرفق": "🔊 ses hediye ekli",
  "🔇 بدون صوت": "🔇 olmadan ses",
  "👑 نمط ملكي": "👑 stil kraliyet",
  "🎁 نمط عادي": "🎁 stil normal",
  "⚙️ تلقائي حسب القيمة": "⚙️ otomatik göre değer",
  "تعذر تشغيل صوت الهدية": "Başarısız çalıştırma ses hediye",
  "تم الحذف": "Yapıldı silindi",
  "تعذر اتمام العملية": "Başarısız tamamlama işlem",
  "سبب الرفض (اختياري):": "Neden reddetme(isteğe bağlı):",
  "تم رفض الطلب وإبلاغ المستلمة": "Yapıldı reddetme istek ve bildirme alınan",
  "تعذر رفض الطلب": "Başarısız reddetme istek",
  "لم يدخل غرفة بعد": "Değil girer oda sonra",
  "دولة عنوان IP": "Ülke başlık IP",
  "حظر من صفحة الرصد": "Yasaklama -den sayfa izleme",
  "تم حظر عنوان IP": "Yapıldı yasaklama başlık IP",
  "وفصل جميع اتصالاتهم": "Ve ayırma tüm bağlantıları",
  "تعذر حظر عنوان IP": "Başarısız yasaklama başlık IP",
  "داخل الموقع": "Içinde site",
  "بلا اسم": "Olmadan isim",
  "من أين دخل": "-den nerede girdi",
  "كلمة البحث": "Kelime arama",
  "الرابط / المسار": "Bağlantı / yol",
  "الوقت": "Zaman",
  "الاعدادات: كل التفاصيل + الحظر": "Ayarlar: her detaylar + yasaklama",
  "سري": "Gizli",
  "✅ عضو مسجل": "✅ üye kayıtlı",
  "👤 زائر (غير مسجل)": "👤 ziyaretçi(değil kayıtlı)",
  "🟢 متصل الآن": "🟢 bağlı şimdi",
  "⚪ غير متصل حالياً": "⚪ değil bağlı şu anda",
  "الرابط القادم": "Bağlantı gelen",
  "المسار الذي دخل إليه": "Yol - girdi -e",
  "عنوان IP": "Başlık IP",
  "الجهاز / المتصفح": "Cihaz / tarayıcı",
  "وقت الدخول": "Zaman giriş",
  "دولة الحساب": "Ülke hesap",
  "الرصيد (ذهب)": "Bakiye(altın)",
  "تاريخ إنشاء الحساب": "Tarih oluşturma hesap",
  "آخر دخول": "Son giriş",
  "إجمالي عمليات الدخول": "Toplam işlemler giriş",
  "فك الحظر عن الحساب": "Kaldırma yasaklama hakkında hesap",
  "🚫 حظر المستخدم (الحساب + الجهاز)": "🚫 yasaklama kullanıcı(hesap + cihaz)",
  "لأنه عضو مسجل فالأفضل «حظر المستخدم» — أما الزائر غير المسجل فيُحظر عبر IP وأجهزته.": "-dığı için üye kayıtlı en iyi«yasaklama kullanıcı» — -se ziyaretçi değil kayıtlı yasaklanır üzerinden IP ve cihazı.",
  "حظر من صفحة تتبع المستخدمين": "Yasaklama -den sayfa takip kullanıcılar",
  "تم حظر المستخدم وفصله فوراً 🚫": "Yapıldı yasaklama kullanıcı ve ayırmak hemen 🚫",
  "تم فك الحظر عن المستخدم": "Yapıldı kaldırma yasaklama hakkında kullanıcı",
  "تعذر تنفيذ الحظر": "Başarısız yürütme yasaklama",
  "وفصل جميع اتصالاتهم 🚫": "Ve ayırma tüm bağlantıları 🚫",
  "🟢 متواجد داخل الغرفة": "🟢 odada",
  "⚪ متوقف وغير ظاهر": "⚪ durdurulmuş ve diğer görünür",
  "تم إيقاف الروبوت": "Yapıldı durdur bot",
  "تم إدخال الروبوت إلى الغرفة": "Yapıldı giriş bot -ye oda",
  "تم حذف الهدية من حساب المستخدم ✓": "Yapıldı silme hediye -den hesap kullanıcı ✓",
  "تعذر حذف الهدية": "Başarısız silme hediye",
  "تعذر حذف الهدايا": "Başarısız silme hediyeler",
  "تم رفع الإيموجي وظهر فوراً لجميع المتصلين ⚡": "Yapıldı yükleme emoji ve göründü hemen herkes için bağlılar ⚡",
  "اختيار ملفات الصور:": "Seçim dosyalar fotoğraflar:",
  "اختيار ورفع الصور (يمكن تحديد عدة صور)": "Seçim ve yükleme fotoğraflar(olabilir seçim birkaç fotoğraflar)",
  "إعلان": "Duyuru",
  "تم رفع وحفظ الرمزيات بنجاح ✓": "Yapıldı yükleme ve kaydetme avatarlar başarıyla ✓",
  "تلقائي (عنابي)": "Otomatik(bordo)",
  "تم حفظ الجلد": "Yapıldı kaydet kaplama",
  "تم حفظ حجم الخط": "Yapıldı kaydet boyut yazı tipi",
  "اسم الراديو (يظهر داخل الدردشة)": "Isim radyo(görünür içinde sohbet)",
  "تفعيل الراديو في الدردشة": "Etkinleştirme radyo -de sohbet",
  "تم حفظ إعدادات الراديو — يتحدّث المشغل فوراً في الدردشة": "Yapıldı kaydet ayarlar radyo — konuşuyor oynatıcı hemen -de sohbet",
  "تم إيقاف التجربة.": "Yapıldı durdur deneme.",
  "✋ ضع رابط البث أولاً في الحقل أعلاه ثم اضغط تجربة.": "✋ koy bağlantı yayın önce -de alan yukarıda sonra basın deneme.",
  "⏳ جاري الاتصال بالبث…": "⏳ yükleniyor bağlantı yayın…",
  "✅ البث يعمل الآن — هذا بالضبط ما سيسمعه المستخدمون في الدردشة.": "✅ yayın çalışır şimdi — bu ayar ne duyacak kullanıcılar -de sohbet.",
  "❌ تعذر تشغيل الرابط — تحقق أنه رابط بث مباشر صالح (mp3/aac).": "❌ başarısız çalıştırma bağlantı — kontrol -dığı bağlantı canlı yayın geçerli(mp3/aac).",
  "❌ تعذر الوصول للرابط — تحقق من صحة رابط البث وأنه يعمل.": "❌ başarısız erişim bağlantı — kontrol -den doğruluk bağlantı yayın -dığını çalışır.",
  "● مفتوحة": "● açık",
  "● مغلقة": "● kapalı",
  "اسم الغرفة": "Isim oda",
  "اتركها فارغة ليبدأ العام بدون أي رسالة": "Bırakın boş başlaması genel olmadan herhangi mesaj",
  "تمكين الصوت": "Etkinleştirme ses",
  "تمكين الفيديو": "Etkinleştirme video",
  "تفعيل الروبوت (eabrmp)": "Etkinleştirme bot(eabrmp)",
  "تفعيل الهدايا (eabvg)": "Etkinleştirme hediyeler(eabvg)",
  "تفعيل الألعاب (gm)": "Etkinleştirme oyunlar(gm)",
  "اتركها فارغة بدون كلمة مرور": "Bırakın boş olmadan kelime geçiş",
  "معاينة الغرفة": "Önizleme oda",
  "تم رفع صورة الغرفة": "Yapıldı yükleme fotoğraf oda",
  "اكتب اسم الغرفة": "Yaz isim oda",
  "تم تعديل الغرفة": "Yapıldı düzenleme oda",
  "تمت اضافة الغرفة بنجاح": "Yapıldı ekleme oda başarıyla",
  "اكتب اسم المستخدم المسجل بدقة": "Yaz isim kullanıcı kayıtlı hassas",
  "صوتية": "Sesli",
  "كتابية": "Yazılı",
  "اختر الغرفة أولاً": "Seç oda önce",
  "تعذر تعيين المشرف": "Başarısız atama moderatör",
  "مثال: أهلاً وسهلاً بكم في الدردشة ★": "Örnek: hoş geldiniz hoş geldiniz kaç -de sohbet ★",
  "تمت الإضافة — يعمل الروبوت فوراً ⚡": "Yapıldı ekleme — çalışır bot hemen ⚡",
  "لم تُرفع صورة بعد": "Henüz resim yüklenmedi",
  "مثال: رفيق_الدردشة": "Örnek: arkadaş_sohbet",
  "توليد الزائر وإدخاله": "Oluşturma ziyaretçi ve sokma",
  "اسم الزائر (اختياري)": "Isim ziyaretçi(isteğe bağlı)",
  "اتركه فارغاً لتوليد اسم عربي طبيعي تلقائياً": "Bırakın boş oluşturmak isim Arapça doğal otomatik",
  "ستُختار صورة عشوائية من المكتبة تلقائياً": "Kütüphaneden rastgele bir resim seçilecek",
  "تم رفع الصورة": "Yapıldı yükleme fotoğraf",
  "تم توليد الروبوت وإدخاله ⚡": "Yapıldı oluşturma bot ve sokma ⚡",
  "تم حفظ التعديلات بنجاح ⚡": "Yapıldı kaydet değişiklikler başarıyla ⚡",
  "أدخل مفتاح الـ API الخاص بالمزود المختار هنا...": "Girin anahtar - API özel sağlayıcı seçilmiş burada...",
  "مثال: gemini-1.5-flash أو llama-3.3-70b-versatile أو gpt-4o-mini": "Örnek: gemini-1.5-flash veya llama-3.3-70b-versatile veya gpt-4o-mini",
  "التوجيه العام لشخصية الذكاء الاصطناعي...": "Yönlendirme genel kişilik zeka yapay...",
  "اكتب سؤالك التجريبي هنا...": "Yaz sorunuz demo burada...",
  "تم حفظ إعدادات العقل العصبي والذكاء الاصطناعي بنجاح ✅": "Yapıldı kaydet ayarlar beyin sinir zeka yapay başarıyla ✅",
  "تعذر حفظ الإعدادات": "Başarısız kaydet ayarlar",
  "اكتب سؤالاً تجريبياً أولاً": "Yaz bir soru demo olarak önce",
  "جاري التفكير والتوليد عبر العقل العصبي للذكاء الاصطناعي... ⏳": "Düşünüyor oluşturma üzerinden beyin sinir zeka yapay... ⏳",
  "أحمد": "Ahmed",
  "البوت_الذكي": "Bot_akıllı",
  "🤖 المزود:": "🤖 sağlayıcı:",
  "⚡ زمن الاستجابة:": "⚡ süre yanıt:",
  "تم توليد الرد بنجاح ⚡": "Yapıldı oluşturma yanıt başarıyla ⚡",
  "خطأ في التوليد:": "Hata -de oluşturma:",
  "فشل الاتصال": "Başarısızlık bağlantı",
  "فشل التوليد": "Başarısızlık oluşturma",
  "تفعيل إرسال البريد (SMTP)": "Etkinleştirme gönderme e-posta(SMTP)",
  "خادم SMTP (host)": "Sunucu SMTP(host)",
  "المنفذ (port) — 587 أو 465": "Uç nokta(port) — 587 veya 465",
  "بريد SMTP (user)": "E-posta SMTP(user)",
  "كلمة مرور SMTP / كلمة مرور تطبيق": "Kelime geçiş SMTP / kelime geçiş uygulama",
  "اتصال آمن (SSL/TLS — اختره مع المنفذ 465)": "Bağlantı güvenli(SSL/TLS — seçin ile uç nokta 465)",
  "اسم/بريد المرسل (from)": "Isim/e-posta gönderen(from)",
  "بريد Gmail لتجربة الإرسال (مثال: you@gmail.com)": "E-posta Gmail denemek gönderme(örnek: you@gmail.com)",
  "you@gmail.com أو اسم المستخدم": "You@gmail.com veya isim kullanıcı",
  "تم حفظ إعدادات البريد ✓": "Yapıldı kaydet ayarlar e-posta ✓",
  "أدخل بريداً Gmail صالحاً للتجربة": "Girin e-posta Gmail geçerli deneme",
  "تم إرسال البريد التجريبي ✓": "Yapıldı gönderme e-posta demo ✓",
  "⚠️ SMTP غير مفعّل — فعّله أولاً": "⚠️ SMTP değil etkin — etkinleştir önce",
  "تعذر الإرسال:": "Başarısız gönderme:",
  "تم إلغاء البريد وتحريره ✓": "Yapıldı iptal e-posta ve düzenleme ✓",
  "تعذر إلغاء البريد": "Başarısız iptal e-posta",
  "أدخل بريداً أو اسم مستخدم": "Girin e-posta veya isim kullanıcı",
  "تعذر البحث": "Başarısız arama",
  "وضع المشرفين (msip)": "Mod moderatörler(msip)",
  "تمكين المستخدم من التسجيل في الشات (eur)": "Etkinleştirme kullanıcı -den kayıt -de sohbet(eur)",
  "إظهار الوقت مع الرسالة (espumh)": "Gösterme zaman ile mesaj(espumh)",
  "تفعيل الكتم (mt e)": "Etkinleştirme susturma(mt e)",
  "تفعيل الكتم الصامت (mt amt)": "Etkinleştirme susturma -sessiz(mt amt)",
  "تفعيل مراقبة الرسائل قبل نشرها (mrs eab)": "Etkinleştirme izleme mesajlar önce yayınlamak(mrs eab)",
  "تفعيل إعدادات الروبوت (esprmh)": "Etkinleştirme ayarlar bot(esprmh)",
  "رابط الرسائل العامة (puurl)": "Bağlantı mesajlar genel(puurl)",
  "تم حفظ اعدادات النظام": "Yapıldı kaydet ayarlar sistem",
  "تم حفظ الشروط والخصوصية": "Yapıldı kaydet şartlar gizlilik",
  "🔍 ابحث باسم المستخدم...": "🔍 ara isimle kullanıcı...",
  "فك الحظر": "Kaldırma yasaklama",
  "حظر": "Yasaklama",
  "طلب توثيق الحساب": "Istek doğrulama hesap",
  "👑 طلب دخول ملكي": "👑 istek giriş kraliyet",
  "👑 طلب تغيير الحيوان الملكي": "👑 istek değiştirme kraliyet hayvanı",
  "الحيوان الملكي الجديد": "Kraliyet hayvanı yeni",
  "الحيوان الملكي": "Kraliyet hayvanı",
  "الكمية المطلوبة": "Miktar gerekli",
  "الذهب المطلوب شحنه للمستخدم:": "Altın gerekli yüklemek kullanıcı:",
  "الذهب المطلوب خصمه:": "Altın gerekli kesmek:",
  "موافقة وشحن الذهب": "Onay ve yükleme altın",
  "موافقة وتنفيذ": "Onay ve yürütme",
  "بدون سبب": "Olmadan neden",
  "تمت الموافقة وشحن الذهب للمستخدم": "Yapıldı onay ve yükleme altın kullanıcı",
  "تمت الموافقة وتنفيذ الطلب وخصم الذهب": "Yapıldı onay ve yürütme istek ve kesinti altın",
  "تعذرت الموافقة": "Başarısız onay",
  "اكتب سبب الرفض الذي سيصل للمستخدم:": "Yaz neden reddetme - gelecek kullanıcı:",
  "تم رفض الطلب وإبلاغ المستخدم": "Yapıldı reddetme istek ve bildirme kullanıcı",
  "اكتب رسالة الاعلان هنا...": "Yaz mesaj duyuru burada...",
  "اكتب نص الإعلان أولا": "Yaz metin duyuru önce",
  "تم إرسال الإعلان لجميع الغرف": "Yapıldı gönderme duyuru herkes için odalar",
  "اكتب الكلمة الممنوعة هنا...": "Yaz kelime yasak burada...",
  "اكتب الكلمة أولا": "Yaz kelime önce",
  "تم تعديل الكلمة": "Yapıldı düzenleme kelime",
  "تمت إضافة الكلمة": "Yapıldı ekleme kelime",
  "رمز الاستبدال الحالي : **": "Kod değiştirme mevcut: **",
  "الاسم (مثال: الوردة الذهبية)": "Isim(örnek: gül altın)",
  "إيموجي 🌹": "Emoji 🌹",
  "أدخل اسم العضو (مثال: ahmed|mohamed|ali)": "Girin isim üye(örnek: ahmed|mohamed|ali)",
  "اكتب اسم العضو": "Yaz isim üye",
  "تمت الإضافة للتوثيق": "Yapıldı ekleme doğrulama",
  "ابحث باسم المستخدم أو IP أو كلمة البحث أو الدولة...": "Ara isimle kullanıcı veya IP veya kelime arama veya ülke...",
  "مثال: شات العرب أو شات الأردن": "Örnek: sohbet Arapların veya sohbet Ürdün",
  "مثال: شات العرب - دردشة صوتية وكتابية مجانية": "Örnek: sohbet Arapların - sohbet sesli ve yazılı ücretsiz",
  "اكتب وصفاً جذاباً يظهر في نتائج بحث Google...": "Yaz açıklama çekici görünür -de sonuçlar arama Google...",
  "شات, دردشة, شات عربي, تعارف, شات صوتي": "Sohbet, sohbet, sohbet Arapça, tanışma, sohbet sesli",
  "رابط صورة الشعار (مثال: /img/announcement.png)": "Bağlantı fotoğraf logo(örnek: /img/announcement.png)",
  "معاينة الشعار": "Önizleme logo",
  "رابط الفافيكون (مثال: /uploads/favicon.png)": "Bağlantı favicon(örnek: /uploads/favicon.png)",
  "معاينة الفافيكون": "Önizleme favicon",
  "مثال: شات شات1": "Örnek: sohbet sohbet1",
  "مثال: شات 1 - أفضل شات كتابي وصوتي": "Örnek: sohbet 1 - en iyi sohbet yazılı ve sesli",
  "وصف مخصص يظهر في Google عند البحث عن هذا المسار...": "Açıklama özel görünür -de Google -de arama hakkında bu yol...",
  "شات1, chat1, شات عربي": "Sohbet1, chat1, sohbet Arapça",
  "مثال: /img/announcement.png": "Örnek: /img/announcement.png",
  "مثال: شات العرب — دردشة صوتية وكتابية مجانية": "Örnek: sohbet Arapların — sohbet sesli ve yazılı ücretsiz",
  "نص فريد يظهر داخل صفحة هذا المسار فقط — اتركه فارغاً للتوليد التلقائي...": "Metin benzersiz görünür içinde sayfa bu yol sadece — bırakın boş oluşturma otomatik...",
  "اتركه فارغاً ليُولَّد تلقائياً": "Bırakın boş oluşturulması otomatik",
  "جاري رفع صورة الشعار للأرشفة...": "Yükleme fotoğraf logo arşivleme...",
  "تم رفع صورة الشعار بنجاح ✓": "Yapıldı yükleme fotoğraf logo başarıyla ✓",
  "جاري رفع أيقونة الفافيكون...": "Yükleme simge favicon...",
  "تم رفع أيقونة الموقع بنجاح ✓": "Yapıldı yükleme simge site başarıyla ✓",
  "تعذر رفع الأيقونة": "Başarısız yükleme simge",
  "جاري رفع صورة الشعار...": "Yükleme fotoğraf logo...",
  "تم رفع أيقونة الفافيكون بنجاح ✓": "Yapıldı yükleme simge favicon başarıyla ✓",
  "تم حفظ إعدادات الموقع والأرشفة الأساسية بنجاح ✓": "Yapıldı kaydet ayarlar site arşivleme temel başarıyla ✓",
  "⏸️ متوقف": "⏸️ durdurulmuş",
  "بدون وصف": "Olmadan açıklama",
  "تعديل مسار الأرشفة /": "Düzenleme yol arşivleme /",
  "تم حذف المسار": "Yapıldı silme yol",
  "اكتب اسم المسار أولاً": "Yaz isim yol önce",
  "رفع صوت": "Yükleme ses",
  "إزالة": "Kaldırma",
  "🪙 ← يربح المستقبل:": "🪙 ← kazanır alıcı:",
  "🪙 • التسكير: $": "🪙• nakde çevirme: $",
  "⛔ مرفوض": "⛔ reddedilmiş",
  "مبلغ التسكير الذي يُدفع": "Miktar nakde çevirme - ödenir",
  "تعذر تحميل الطلبات": "Başarısız indirme istekler",
  "لا توجد اتصالات دردشة نشطة الآن": "Yok bağlantılar sohbet aktif şimdi",
  "اتصالات": "Bağlantılar",
  "لا توجد سجلات مطابقة": "Yok kayıtlar eşleşme",
  "الإعدادات": "Ayarlar",
  "الإعدادات — تفاصيل المستخدم": "Ayarlar — detaylar kullanıcı",
  "كل ما دخل به هذا الشخص + بيانات حسابه + أدوات الحظر": "Her ne girdi -de bu kişi + veri hesabı + araçlar yasaklama",
  "جاري تحميل التفاصيل...": "Indirme detaylar...",
  "تعذر تحميل التفاصيل:": "Başarısız indirme detaylar:",
  "تفاصيل هذا الدخول": "Detaylar bu giriş",
  "المصدر:": "Kaynak:",
  "تفاصيل الحساب": "Detaylar hesap",
  "ملاحظة": "Not",
  "لا يوجد حساب مرتبط بهذا الدخول في قاعدة البيانات حالياً (حُذف أو أنه اسم زائر مؤقت لم يُنشأ له حساب).": "Yok hesap bağlı bununla giriş -de veritabanı veri şu anda(silindi veya -dığı isim ziyaretçi geçici değil oluşturulur için hesap).",
  "يمكنك حظر عنوان IP أدناه لمنع عودته.": "Yapabilirsiniz yasaklama başlık IP aşağıda engellemek dönüşü.",
  "الحظر والإجراءات": "Yasaklama işlemler",
  "الحظر يفصل المستخدم فوراً ويمنعه من العودة من نفس الحساب/IP/الجهاز حتى يتم فك الحظر من «قائمة الحظر».": "Yasaklama ayırr kullanıcı hemen ve engeller -den dönüş -den aynı hesap/IP/cihaz -e kadar yapılır kaldırma yasaklama -den«liste yasaklama».",
  "👤 زائر عادي": "👤 normal ziyaretçi",
  "• كل": "• her",
  "ثانية • حجم": "Saniye• boyut",
  "حفظ الباقة": "Kaydet paket",
  "قائمة باقات الذهب الحالية": "Liste paketler altın mevcut",
  "جاري تحميل الباقات...": "Indirme paketler...",
  "أُنشئت بوابة الدفع عبر": "Oluşturuldu geçit ödeme üzerinden",
  "مفاتيح PayPal (Rest API App)": "Anahtar kelimeler PayPal(Rest API App)",
  "اتركه فارغاً للإبقاء على المفتاح الحالي.": "Bırakın boş tutma -de anahtar mevcut.",
  "وضع التشغيل:": "Mod çalıştırma:",
  "وضع حي (Live) — مدفوعات حقيقية": "Mod mahalle(Live) — ödemeler gerçek",
  "وضع تجريبي (Sandbox) — للاختبار": "Mod demo(Sandbox) — test",
  "USD (الدولار الأمريكي)": "USD(dolar Amerikan)",
  "EUR (اليورو)": "EUR(euro)",
  "GBP (الجنيه الإسترليني)": "GBP(sterlin sterlin)",
  "JOD (الدينار الأردني)": "JOD(dinar Ürdün)",
  "تفعيل الدفع عبر PayPal في المتجر": "Etkinleştirme ödeme üzerinden PayPal -de mağaza",
  "حفظ إعدادات PayPal": "Kaydet ayarlar PayPal",
  "اختبار الاتصال بالبوابة": "Test bağlantı geçit",
  "بيانات الحساب المصرفي للإيداع (اختياري — للمراسلة)": "Veri hesap banka yatırma(isteğe bağlı — mesajlaşma)",
  "اسم البنك:": "Isim banka:",
  "اسم المستفيد:": "Isim alıcı:",
  "رقم الآيبان (IBAN):": "Numara IBAN(IBAN):",
  "العمليات المؤكّدة من PayPal": "Işlemler onaylı -den PayPal",
  "جاري تحميل سجل العمليات...": "Indirme kayıt işlemler...",
  "بوابة الدفع": "Geçit ödeme",
  "مرجع العملية (PayPal)": "Referans işlem(PayPal)",
  "VIP - الرصيد المطلوب لشراء عضوية VIP 👑": "VIP - bakiye gerekli satın almak üyelik VIP 👑",
  "Premium - الرصيد المطلوب لشراء عضوية Premium 💎": "Premium - bakiye gerekli satın almak üyelik Premium 💎",
  "Plus - الرصيد المطلوب لشراء عضوية Plus ⭐": "Plus - bakiye gerekli satın almak üyelik Plus ⭐",
  "حفظ الإعدادات": "Kaydet ayarlar",
  "⬆️ ارفع ملفاً صوتياً لتشغيله بدل النغمة الافتراضية. الحقل يدعم MP3 / WAV / OGG / M4A / AAC / OPUS حتى 12 ميجا.": "⬆️ yükleyin bir dosya sesli çalmak yerine melodi varsayılan. alan destekler MP3 / WAV / OGG / M4A / AAC / OPUS -e kadar 12 MB.",
  "حدد العضويات المسموح لها باستخدام كل ميزة. حسابات الإدارة ومشرفو الغرف مسموح لهم دائماً.": "Belirleyin üyelikler izinli ona kullanarak her özellik. hesaplar yönetim ve moderatörler odalar izinli onlar her zaman.",
  "✅ تم الحفظ والتطبيق الفوري — حد المذيعين الآن:": "✅ yapıldı kaydet uygulama anlık — sınır yayıncılar şimdi:",
  "مظهر رسائل العام": "Görünüm mesajlar genel",
  "عرض جسم الرسالة :": "Gösterim gövde mesaj:",
  "حجم شارات الرتب والعضويات في العام": "Boyut rozetler rütbe üyelikler -de genel",
  "توحيد جميع الشارات على 24px": "Birleştirme tüm rozetler -de 24px",
  "رفع صورة الهدية (PNG/GIF/WEBP)": "Yükleme fotoğraf hediye(PNG/GIF/WEBP)",
  "رفع صوت الهدية": "Yükleme ses hediye",
  "اسم الهدية": "Isim hediye",
  "قيمة الهدية بالذهب (تُخصم من مُرسِل الهدية)": "Değer hediye altın(kesilir -den gönderen hediye)",
  "كم يربح مستقبِل الهدية منها (ذهب) — مثال: قيمتها 10 يربح 4": "Ne kadar kazanır alıcı hediye -den(altın) — örnek: değeri 10 kazanır 4",
  "قيمة الهدية بالدولار (تسكير الهدايا — للفتيات)": "Değer hediye dolar(hediyeleri nakde çevirme — kızlar)",
  "القسم": "Bölüm",
  "نمط الظهور عند الإرسال": "Stil görünme -de gönderme",
  "«تلقائي» يجعل الهدية تظهر بالمشهد الملكي تلقائياً إذا كانت قيمتها ≥ الحد المحدد أدناه": "«otomatik» yapar hediye görünür sahne kraliyet otomatik -se idi değeri ≥ sınır belirli aşağıda",
  "الحد التلقائي للمشهد الملكي (ذهب)": "Sınır otomatik sahne kraliyet(altın)",
  "الهدايا الحالية": "Hediyeler mevcut",
  "تسكير الهدايا (تحويل الهدايا إلى دولارات)": "Hediyeleri nakde çevirme(transfer hediyeler -ye dolar)",
  "ميزة خاصة بالفتيات فقط: الهدايا بقيمها": "Özellik özel kızlar sadece: hediyeler değerleriyle",
  "بالذهب فقط": "Altın sadece",
  "(لا يوجد سعر دولار لكل هدية).": "(yok fiyat dolar başına hediye).",
  "تحدد الإدارة": "Belirler yönetim",
  "الحد الأدنى للذهب": "Sınır en az altın",
  "مبلغ التسكير المقابل له": "Miktar nakde çevirme karşılığında için",
  "(مثال: 5$) وحساب السحب المصدر.": "(örnek: 5$) ve hesap çekme kaynak.",
  "المبلغ يتناسب طردياً مع الكمية المحددة:": "Miktar orantılı orantılı ile miktar belirli:",
  "الهدايا التي تريد تسكيها": "Hediyeler -diği istiyorsunuz nakdetmesi",
  "(المحددة فقط تُحذف).": "(belirli sadece silinir).",
  "تُحذف الهدايا المحددة فقط": "Silinir hediyeler belirli sadece",
  "وتبقى بقية هداياها.": "Ve kalır kalan hediyeleri.",
  "إعدادات التسكير": "Ayarlar nakde çevirme",
  "حفظ إعدادات التسكير": "Kaydet ayarlar nakde çevirme",
  "طلبات التسكير": "Istekler nakde çevirme",
  "جاري التحميل...": "Indirme...",
  "ابحث عن الحساب ثم اختر": "Ara hakkında hesap sonra seç",
  "عرض الهدايا": "Gösterim hediyeler",
  "لرؤية كل الهدايا المستلمة في حسابه.": "Görmek her hediyeler alınan -de hesabı.",
  "الحذف يزيل الهدية من رصيد هداياه نهائياً ويؤثر على مجموع الذهب المتاح للتسكير.": "Silindi kaldırır hediye -den bakiye hediyeleri kalıcı ve etkiler -de toplam altın mevcut nakde çevirme.",
  "لا يُعاد أي ذهب إلى رصيد الحساب": "Hayır yeniden herhangi altın -ye bakiye hesap",
  "عند الحذف.": "-de silindi.",
  "جاري تحميل المستخدمين...": "Indirme kullanıcılar...",
  "هدايا": "Hediyeler",
  "عدد سطور الهدايا": "Sayı satır hediyeler",
  "إجمالي القطع": "Toplam kesme",
  "مجموع الذهب": "Toplam altın",
  "لا توجد هدايا في هذا الحساب": "Yok hediyeler -de bu hesap",
  "لا توجد غرف بعد": "Yok odalar sonra",
  "اهلا وسهلا بكم في": "Hoş geldin hoş geldin kaç -de",
  "لا توجد غرف متاحة": "Yok odalar mevcut",
  "لا توجد رسائل مسجلة بعد": "Yok mesajlar kayıtlı sonra",
  "مُرسَل": "Gönderilmiş",
  "SMTP غير مفعّل": "SMTP değil etkin",
  "فشل": "Başarısızlık",
  "لا يوجد حساب بهذا البريد أو الاسم": "Yok hesap bununla e-posta veya isim",
  "مفعَّل": "Etkin",
  "غير مفعَّل (محتاج للتفعيل)": "Değil etkin(ihtiyaç etkinleştirme)",
  "لا يوجد مستخدمون مطابقون": "Yok kullanıcılar eşleşen",
  "? 'طلب توثيق الحساب'": "? 'istek doğrulama hesap'",
  ": (isRoyal ? '👑 طلب دخول ملكي'": ":(isRoyal? '👑 istek giriş kraliyet'",
  ": (isRoyalChange ? '👑 طلب تغيير الحيوان الملكي'": ":(isRoyalChange? '👑 istek değiştirme kraliyet hayvanı'",
  "لا توجد حسابات إدارية": "Yok hesaplar yönetimsel",
  "✅ قائمة المطرودين فارغة": "✅ liste atılan boş",
  "✅ قائمة الحظر فارغة": "✅ liste yasaklama boş",
  "جاري استئناف الخادم...": "Devam sunucu...",
  "✅ تم استئناف الخادم بنجاح": "✅ yapıldı devam sunucu başarıyla",
  "لم يتم إضافة مسارات أرشفة مخصصة بعد (اضغط ➕ إضافة مسار لإنشاء مسار مثل /chat1)": "Değil yapılır ekleme yollar arşivleme özel sonra(basın ➕ ekleme yol oluşturmak yol gibi /chat1)",
  "🖼️ الشعار مرفق": "🖼️ logo ekli",
  "تم إنشاء غرفة SEO مخفية باسم «": "Yapıldı oluşturma oda SEO gizli isimle«",
  "» 🤖 — مرئية لمحركات البحث فقط": "» 🤖 — görünür motorlar arama sadece",
  "المحادثات الخاصة بين المستخدمين": "Sohbetler özel arasında kullanıcılar",
  "جاري تحميل المحادثات...": "Indirme sohbetler...",
  "عرض المحادثة": "Gösterim sohbet",
  "عودة للمحادثات": "Dönüş sohbetler",
  "محادثة:": "Sohbet:",
  "مع": "Ile",
  "رسالة)": "Mesaj)",
  "مسح الكل": "Temizleme her",
  "لا توجد رسائل": "Yok mesajlar",
  "تُحفظ تلقائياً تسجيلات المكالمات الخاصة — هذه الصفحة": "Kaydedilir otomatik kayıtlar aramalar özel — bu sayfa",
  "خاصة بالسوبر ماستر (مالك الدردشة) فقط": "Özel süper usta(sahip sohbet) sadece",
  "تسجيلات الفيديو": "Kayıtlar video",
  "موجودة في صفحة مستقلة: «تسجيل مكالمات الفيديو».": "Mevcut -de sayfa bağımsız:«kayıt aramalar video».",
  "قائمة المكالمات الصوتية المسجلة": "Liste aramalar sesli kayıtlı",
  "جاري تحميل التسجيلات...": "Indirme kayıtlar...",
  "🎙 صوت": "🎙 ses",
  "تحميل": "Indirme",
  "أرشيف مكالمات الفيديو الخاصة — كل تسجيل يظهر فيه فيديو المتصل كاملاً وكاميرتك مصغّرة (بأسلوب سناب شات) مع الصوت.": "Arşiv aramalar video özel — her kayıt görünür -de video bağlı tam ve kameranız minyatür(tarzında snap sohbet) ile ses.",
  "هذه الصفحة": "Bu sayfa",
  "أرشيف مكالمات الفيديو": "Arşiv aramalar video",
  "جاري تحميل تسجيلات الفيديو...": "Indirme kayıtlar video...",
  "الشكاوى الواردة من الأعضاء المسجلين (زر «الإبلاغ» في الملف الشخصي) — تُعرض مع اسم المبلِّغ والمُبلَّغ عنه.": "Şikayetler gelen -den üyeler kayıtlı(düğme«bildirme» -de dosya kişisel) — görüntülenir ile isim bildiren bildirilmiş hakkında.",
  "جاري تحميل الشكاوى...": "Indirme şikayetler...",
  "⚠️ المُبلَّغ عنه:": "⚠️ bildirilmiş hakkında:",
  "حذف الشكوى": "Silme şikayet",
  "كلمة المرور (pwd)": "Şifre(pwd)",
  "هل أنت متأكد من حذف المستخدم \"": "Silmek istediğinizden emin misiniz kullanıcı \"",
  "حذف الحساب الإداري \"": "Silme hesap yönetici \"",
  "(منتهي)": "(süresi bitmiş)",
  "انتهت جلسة لوحة الإدارة": "Bitti oturum yönetim paneli",
  "تم إبطال رابط وجلسة الإدارة فوراً لأنك لست متواجداً في الدردشة أو قمت بعمل تحديث.": "Yapıldı iptal bağlantı ve oturum yönetim hemen -dığınız için değilsiniz bulunan -de sohbet veya yaptınız yapmaktan güncelleme.",
  "يجب أن تكون متواجداً ومتصلاً داخل الدردشة في نفس الوقت لتشغيل لوحة الإدارة.": "Gerekir -dığı olmak bulunan ve bağlı içinde sohbet -de aynı zaman çalmak yönetim paneli.",
  "العودة إلى الدردشة": "Dönüş -ye sohbet",
  "فحص «طبق الأصل» بين المسارات": "Kontrol«birebir orijinal» arasında yollar",
  "مسار": "Yol",
  "ينقصها محتوى فريد:": "Eksik içerik benzersiz:",
  "تم الإصلاح الشامل ✓ — عناوين مُعاد توليدها:": "Yapıldı onarma kapsamlı ✓ — başlıklar yeniden oluşturulması:",
  "• غرف مخفية مُنشأة:": "• odalar gizli oluşturulmuş:",
  "غرف SEO مخفية جديدة:": "Odalar SEO gizli yeni:",
  "أدخل اسم الدردشة أو الكلمة المستهدفة أعلاه واضغط \"توليد النماذج الآن\" لإنشاء باقات سيو قوية متوافقة مع Google.": "Girin isim sohbet veya kelime hedef yukarıda ve basın \"oluşturma modeller şimdi\" oluşturmak paketler SEO güçlü uyumlu ile Google.",
  "جاري تحليل الكلمات وتوليد نماذج SEO متوافقة مع معايير Google...": "Analiz kelimeler ve oluşturma modeller SEO uyumlu ile kriterler Google...",
  "كلمة مفتاحية": "Kelime anahtar",
  "الكلمات الدلالية المتصدرة (Keywords & LSI):": "Kelimeler anlam üst(Keywords & LSI):",
  "تطبيق هذا النموذج الآن ✨": "Uygulama bu model şimdi ✨",
  "🪙 الذهب:": "🪙 altın:",
  "💵 السعر:": "💵 fiyat:",
  "حذف العام لدي فقط": "Silme genel bende sadece",
  "حذف العام للجميع": "Silme genel tüm",
  "تحدث": "Konuş",
  "سحب المايك": "Çekme mikrofon",
  "سحب مع منع صعود": "Çekme ile engelleme katılma",
  "فك من البث": "Kaldırma -den yayın",
  "مجوهرات": "Mücevher",
  "أضف إطلالة": "Ekle görünüm",
  "اختر صورة": "Seç fotoğraf",
  "او": "Veya",
  "إشعارات سطح المكتب": "Bildirimler masaüstü masa",
  "احصل على توثيق شاتنا": "Al -de doğrulama sohbetimiz",
  "اجعل مجتمع شاتنا يثق بك وكن دائمًا مميز في المقدمة": "Yap topluluk sohbetimiz güvenir size ve ol her zaman premium -de giriş",
  "اختر الباقة المناسبة وادفع عبر PayPal أو بطاقة فيزا/ماستركارد/أمريكان إكسبريس لشحن رصيدك فورياً بعد تأكيد الدفع": "Seç paket uygun ve öde üzerinden PayPal veya kart Visa/Mastercard/American Express yüklemek bakiyeniz anında sonra onay ödeme",
  "دخول الى الغرفة المختارة": "Giriş -ye oda seçilmiş",
  "لا": "Hayır",
  "ارسل لك رسالة خاصة": "Gönder senin özel mesaj",
  "انتقل إلى قائمة الرسائل الخاصة لقراءتها": "Geç -ye liste özel mesajlar okumak",
  "إنهاء المكالمة": "Bitirme arama",
  "ابحث عن غرفك": "Ara hakkında odaların",
  "تشغيل الراديو": "Çalıştırma radyo",
  "كتم/إلغاء كتم صوت المذيعين": "Susturma/iptal susturma ses yayıncılar",
  "حذف «العام» من شاشة أنت فقط — يظل ظاهراً لبقية المستخدمين": "Silme«genel» -den ekran sen sadece — kalır görünür kalanı için kullanıcılar",
  "حذف «العام» نهائياً من الغرفة لجميع المستخدمين": "Silme«genel» kalıcı -den oda herkes için kullanıcılar",
  "النزول لآخر الرسائل": "Inme son mesajlar",
  "بحث عن غرف": "Arama hakkında odalar",
  "بحث عن مستخدمين": "Arama hakkında kullanıcılar",
  "عرض/إخفاء قائمة المتصلين": "Gösterim/gizleme liste bağlılar",
  "تغيير الصورة الشخصية": "Değiştirme fotoğraf kişisel",
  "تحدث — الصعود كمذيع": "Konuş — katılma yayıncı olarak",
  "اسحب لتحريك نافذة البث": "Sürükle taşımak pencere yayın",
  "كتم/إلغاء كتم صوتي كمذيع": "Susturma/iptal susturma sesli yayıncı olarak",
  "البريد الإلكتروني (Gmail)": "E-posta adresi(Gmail)",
  "مكالمة فيديو": "Görüntülü arama",
  "مكالمة صوتية": "Arama sesli",
  "تصغير": "Küçültme",
  "انقر للتبديل": "Tıklayın değiştirme",
  "انقر لتكبير صورك": "Tıklayın büyütmek fotoğraflarınız",
  "جودة الفيديو ثابتة على 360p": "Kalite video sabit -de 360p",
  "كتم/إلغاء كتم الميكروفون": "Susturma/iptal susturma mikrofon",
  "تشغيل/إيقاف الكاميرا": "Çalıştırma/durdur kamera",
  "كلمة المرور الحالية": "Şifre mevcut",
  "كلمة المرور الجديدة (4 خانات على الأقل)": "Yeni şifre(4 karakter -de az)",
  "تأكيد كلمة المرور الجديدة": "Onay yeni şifre",
  "ابحث عن فيديو في YouTube": "Ara hakkında video -de YouTube",
  "إزالة الصورة": "Kaldırma fotoğraf",
  "كلمة المرور الجديدة": "Yeni şifre",
  "نظام إدارة الدردشة المتكامل": "Kapsamlı Sohbet Yönetim Sistemi",
  "🇸🇦 العربية": "🇸🇦 Arapça",
  "لوحة التحكم": "Kontrol paneli",
  "الصلاحية :": "Yetki :",
  "مُوَلّد SEO والأرشفة بالذكاء الاصطناعي 🤖": "Üretici SEO arşivleme zeka yapay 🤖",
  "توليد النماذج الآن": "Oluşturma modeller şimdi",
  "🌍 عربي عام": "🌍 Arapça genel",
  "🎙️ صوتي ومايكات": "🎙️ sesli ve mikrofonlar",
  "🤝 تعارف وصداقة": "🤝 tanışma ve dostluk",
  "⚡ جوال سريع": "⚡ mobil hızlı",
  "👑 خليجي راقي": "👑 Körfez şık",
  "اكتب اسم الدردشة أو المسار أو الكلمة هنا...": "Yaz isim sohbet veya yol veya kelime burada...",
  "مذيع مباشر": "Yayıncı canlı",
  "إيقاف مشاهدة هذا البث": "Durdur izleme bu yayın",
  "دردشة كتابية": "Sohbet yazılı",
  "غرفة صوتية": "Oda sesli",
  "الغرفة مغلقة": "Oda kapalı",
  "الغرفة برقم سري": "Oda şifreli",
  "للأعضاء المسجلين فقط": "Üyeler kayıtlı sadece",
  "مثال: الباقة الفضية أو باقة المبتدئين": "Örnek: paket gümüş veya paket yeni başlayanlar",
  "مثال: 100": "Örnek: 100",
  "مثال: 9.99": "Örnek: 9.99",
  "مثال: 15 (اتركه 0 إذا لم يوجد)": "Örnek: 15(bırakın 0 -se değil var)",
  "مثال: 🔥 الأكثر طلباً أو ⭐ باقة التوفير": "Örnek: 🔥 daha istenen veya ⭐ paket tasarruf",
  "مثال: AQ7vH2...": "Örnek: AQ7vH2...",
  "مثال: EO9xK3...": "Örnek: EO9xK3...",
  "مثال: البنك الأهلي التجاري": "Örnek: banka milli ticari",
  "مثال: إدارة الدردشة المعتمدة": "Örnek: yönetim sohbet onaylı",
  "مثال: JO94 ARAB 1234 5678 9012 3456": "Örnek: JO94 ARAB 1234 5678 9012 3456",
  "مثال: أسد": "Örnek: aslan",
  "🔍 بحث باسم أي طرف في المحادثة...": "🔍 arama isimle herhangi taraf -de sohbet...",
  "🔍 بحث باسم المتصل أو المستلم أو اسم الملف...": "🔍 arama isimle bağlı veya alan veya isim dosya...",
  "🔍 بحث باسم المتصل أو المستلم...": "🔍 arama isimle bağlı veya alan...",
  "🔍 بحث باسم المبلِّغ أو المُبلَّغ عنه أو النص...": "🔍 arama isimle bildiren veya bildirilmiş hakkında veya metin...",
  "مثل: jo, eg, sa": "Gibi: jo, eg, sa"
,
  "اللغة": "Dil",
  "الرئيسية": "Ana sayfa",
  "االدردشة العربية": "Arap Sohbeti",
  "الغرفة مغلقة حالياً": "Bu oda şu anda kapalı",
  "الغرفة للأعضاء المسجلين فقط": "Bu oda sadece kayıtlı üyelere açık",
  "عدد المذيعين المتزامن (الميكروفونات)": "Eşzamanlı yayıncı (mikrofon)",
  "أقصى عدد مسموح بالبقاء على المايك في نفس الوقت داخل البث — عند امتلائها يُرفض صعود أي شخص جديد برسالة «الميكروفونات ممتلئة».": "Yayında aynı anda mikroonda kalmasına izin verilen en fazla kişi sayısı — dolduğunda yenilere \"mikrofonlar dolu\" mesajıyla izin verilmez.",
  "درجة التفريد:": "Benzersizlik puanı:",
  "لا يوجد أي تكرار بين المسارات": "Yollar arasında kopya yok",
  "درجة التفريد": "Benzersizlik puanı",
  "إرسال": "Gönder",
  "الحالة التالية": "Sonraki durum",
  "الحالة السابقة": "Önceki durum",
  "تصغير المكالمة": "Aramayı küçült",
  "تقليل الكمية": "Miktarı azalt",
  "تقليل المدة": "Süreyi azalt",
  "رفض المكالمة": "Aramayı reddet",
  "زيادة الكمية": "Miktarı artır",
  "زيادة المدة": "Süreyi artır",
  "قبول المكالمة": "Aramayı kabul et",
  "كتم الميكروفون": "Mikrofonu sustur",
  "مكبر الصوت": "Hoparlör",
  "موضع المقطع الصوتي": "Ses klibi konumu",
  "نافذة البث المباشر": "Canlı yayın penceresi",
  "هل تريد الانتقال إلى هذه الغرفة ؟": "Bu odaya geçmek istiyor musunuz?",
  "من خيار نوع الحساب لتوليد زائر بلا أي شارة روبوت: اسم عربي طبيعي وصورة عشوائية إن تُركا فارغين، ويدخل الغرفة كأي زائر حقيقي. ويمكن تحديد": "Hesap Türü seçeneğinden bot rozeti olmayan bir ziyaretçi oluşturmak için: doğal bir Arapça isim ve rastgele bir fotoğraf         ikisi de boş bırakılırsa ve odaya gerçek bir ziyaretçi gibi girer. Şunları da ayarlayabilirsin: ",
  "من خيار نوع الحساب لتوليد زائر بلا أي شارة روبوت: اسم عربي طبيعي وصورة عشوائية\n        إن تُركا فارغين، ويدخل الغرفة كأي زائر حقيقي. ويمكن تحديد": "Hesap Türü seçeneğinden bot rozeti olmayan bir ziyaretçi oluşturmak için: doğal bir Arapça isim ve rastgele bir fotoğraf         ikisi de boş bırakılırsa ve odaya gerçek bir ziyaretçi gibi girer. Şunları da ayarlayabilirsin: ",
  "لكل حساب تولّده.": "oluşturduğu her hesap için.",
  "لم يُرفع صوت بعد": "Henüz ses yüklenmedi",
  "أعلى الدردشة مباشرة تحت الهيدر": "sohbetin üstünde, başlığın hemen altında",
  "فوراً لجميع المستخدمين، ويعمل على جميع الهواتف.": "tüm kullanıcılar için anında ve tüm telefonlarda çalışır.",
  "اكتب أي سؤال تجريبي لتجربة توليد الرد من العقل العصبي للذكاء الاصطناعي مباشرة والتأكد من سرعة ودقة الإجابة.": "Yapay zekâ sinir beyninden doğrudan yanıt oluşturmayı denemek ve yanıtın hızını ve doğruluğunu kontrol etmek için herhangi bir test sorusu yazın.",
  "يتحكم هذا القسم في العقل العصبي للذكاء الاصطناعي الذي تستخدمه روبوتات الدردشة عند مناداتها بالاسم للإجابة عن أي سؤال بشكل واقعي وذكي. يدعم النظام Google Gemini و Groq (Llama 3.3) و OpenAI و DeepSeek أو أي خادم عصبي مخصص (Ollama / LocalAI).": "Bu bölüm, sohbet botlarının isimleriyle çağrıldıklarında herhangi bir soruyu gerçekçi ve akıllı bir şekilde yanıtlamak için kullandıkları yapay zekâ sinir beynini kontrol eder. Sistem; Google Gemini, Groq (Llama 3.3), OpenAI, DeepSeek veya özel bir sinir sunucusunu (Ollama / LocalAI) destekler.",
  "تهيئة مزود الذكاء الاصطناعي ومفتاح الـ API": "Yapay zekâ sağlayıcısı kurulumu ve API anahtarı",
  "⚡ Google Gemini (مجاني وسريع وذكي جداً - مُستحسن)": "⚡ Google Gemini (ücretsiz, hızlı ve çok akıllı - önerilir)",
  "🚀 Groq Cloud (Llama 3.3 70B - مجاني وفائق السرعة)": "🚀 Groq Cloud (Llama 3.3 70B - ücretsiz ve çok hızlı)",
  "عند اختيار «للأعضاء المسجلين فقط» تُمنع حسابات الزوار من دخول الغرفة، وتظهر لهم رسالة تدعوهم لإنشاء حساب. الإدارة تدخل دائماً.": "«Sadece kayıtlı üyeler» seçildiğinde ziyaretçi hesaplarının odaya girmesi engellenir ve onlara hesap oluşturmaya davet eden bir mesaj gösterilir. Yönetim her zaman girer.",
  "و": "ve",
  "طلب دخول ملكي": "Kraliyet katılma talebi",
  "مكالمة وبث مباشر": "Arama vecanlı yayın",
  "مكالمة وبث مباشر نشط": "Arama vecanlı yayın aktif",
  "لا يمكنك الانتقال إلى غرفة أخرى أثناء وجود مكالمة وبث مباشر. يجب إغلاقهما أولاً ثم يمكنك الدخول إلى الغرفة الأخرى.": "Olamazolarak geçiş -ye oda diğer sırasında bulunma arama vecanlı yayın. gerekir ikisini kapat önce sonra yapabilirsiniz giriş -ye oda diğer.",
  "التوثيق والدخول الملكي": "Doğrulama vekraliyet girişi",
  "دفع إلكتروني آمن ومشفر عبر PayPal — نقبل بطاقات فيزا/ماستركارد/أمريكان إكسبريس وPayPal وخيارات أخرى": "Ödeme elektronik güvenli ve şifreli üzerinden PayPal — kabul ederiz kartlar Visa/Mastercard/American Express vePayPal ve seçenekler diğer",
  "(بث mp3/aac مثل icecast أو shoutcast) ثم فعّل الراديو.": "(icecast veya shoutcast gibi mp3/aac yayını) sonra radyoyu etkinleştir.",
  "كلمة المرور السرية (اتركها فارغة = بدون حماية)": "Gizli şifre (boş bırak = koruma yok)",
  "تُستخدم لاحتساب قيمة التحويل إلى دولارات في نظام التسكير (مثال: 1.5 = $1.50)": "Nakit çıkış sisteminde dolar dönüşüm değerini hesaplamak için kullanılır (örnek: 1.5 = $1.50)",
  "يسري على الهدايا بنمط «تلقائي» فقط. 0 = تعطيل التلقائي (كل الهدايا عادية)": "Yalnızca «otomatik» tarzdaki hediyeler için geçerlidir. 0 = otomatik devre dışı (tüm hediyeler normal)"
};

const I18N_SKIP_SELECTOR = ".mtext,.pm-tx,.stext,.room-name,.room-desc,.uname,.mname,#statusViewerText,#statusTextInput,#siteName,#avatarViewName,#announcementText,#announcementSender,.wall-post-text,.wall-post-who b,.wall-comment-bubble b,.wall-comment-bubble p,#namePopoverName,.wall-reactor-row .wr-info b,.head-name,.us-userinfo,.vp-name,.vp-bio,.vg-from,.vg-name,.prof-name,.pm-peer,.pm-hero-name,.sv-info,.room-welcome-text,.robot-system-text,.my-gift-card h4,.my-gift-card b,.blocked-user-info b";

// ==== محرك الترجمة الاحتياطي: يترجم أي نص مركب كلمة/عبارة كلمة عندما لا يوجد تطابق حرفي ====
const I18N_FALLBACK = {"ستُختار صورة عشوائية من المكتبة تلقائياً":["a random image will be chosen from the library automatically","se elegirá una imagen aleatoria de la biblioteca","kütüphaneden rastgele bir resim seçilecek"],"يرد بالذكاء الاصطناعي عند مناداته بالاسم":["replies with AI when called by name","responde con IA al ser llamado","ismiyle çağrıldığında yapay zeka ile yanıt verir"],"ستختار صورة عشوائية من المكتبة تلقائيا":["a random image will be chosen from the library automatically","se elegirá una imagen aleatoria de la biblioteca","kütüphaneden rastgele bir resim seçilecek"],"يرد بالنص المحدد عند مناداته بالاسم":["replies with the set text when called by name","responde con el texto indicado al ser llamado","çağrıldığında belirlenen metinle yanıt verir"],"الرد المخصص عند مناداة اسم الروبوت":["custom reply when the bot name is mentioned","respuesta personalizada al mencionar el bot","bot adı anıldığında özel yanıt"],"لم يتم إنشاء روبوتات غرف بعد":["no room bots created yet","aún no se han creado bots de sala","henüz oda botu oluşturulmadı"],"لم يتم انشاء روبوتات غرف بعد":["no room bots created yet","aún no se han creado bots de sala","henüz oda botu oluşturulmadı"],"كلمتا المرور غير متطابقتين":["passwords do not match","las contraseñas no coinciden","şifreler eşleşmiyor"],"لم يتم إنشاء روبوتات بعد":["no bots created yet","aún no se han creado bots","henüz bot oluşturulmadı"],"لم يتم انشاء روبوتات بعد":["no bots created yet","aún no se han creado bots","henüz bot oluşturulmadı"],"عضويتك غير مسموح لها بـ":["your membership is not allowed to","tu membresía no puede","üyeliğinize izin verilmiyor"],"عضويتك غير مسموح لها ب":["your membership is not allowed to","tu membresía no puede","üyeliğinize izin verilmiyor"],"الغرفة التي يدخل إليها":["room to enter","sala a la que entra","gireceği oda"],"الغرفة التي يدخل اليها":["room to enter","sala a la que entra","gireceği oda"],"لا يتحدث ولا يرد أبداً":["never talks or replies","nunca habla ni responde","asla konuşmaz"],"لا يتحدث ولا يرد ابدا":["never talks or replies","nunca habla ni responde","asla konuşmaz"],"جارٍ التحويل تلقائيًا":["transferring automatically","transfiriendo automáticamente","otomatik aktarılıyor"],"تظهر أول حرف من اسمها":["shows the first letter of its name","muestra la primera letra de su nombre","adının ilk harfi görünür"],"تظهر اول حرف من اسمها":["shows the first letter of its name","muestra la primera letra de su nombre","adının ilk harfi görünür"],"جار التحويل تلقائيا":["transferring automatically","transfiriendo automáticamente","otomatik aktarılıyor"],"هل أنت متأكد من حذف":["are you sure you want to delete","¿seguro que quieres eliminar","silmek istediğinizden emin misiniz"],"هل انت متاكد من حذف":["are you sure you want to delete","¿seguro que quieres eliminar","silmek istediğinizden emin misiniz"],"كلمة المرور الجديدة":["the new password","la nueva contraseña","yeni şifre"],"تعذر التحويل الآلي":["automatic transfer failed","falló la transferencia automática","otomatik transfer başarısız"],"تعذر التحويل الالي":["automatic transfer failed","falló la transferencia automática","otomatik transfer başarısız"],"متواجد داخل الغرفة":["in the room","en la sala","odada"],"لم تُرفع صورة بعد":["no image uploaded yet","aún no se ha subido imagen","henüz resim yüklenmedi"],"البريد الإلكتروني":["the email address","el correo electrónico","e-posta adresi"],"البريد الالكتروني":["the email address","el correo electrónico","e-posta adresi"],"لم ترفع صورة بعد":["no image uploaded yet","aún no se ha subido imagen","henüz resim yüklenmedi"],"تم التحويل بنجاح":["transfer completed successfully","transferencia completada","transfer başarıyla tamamlandı"],"رفع صورة الروبوت":["upload bot avatar","subir avatar del bot","bot avatarı yükle"],"فشل تسجيل الدخول":["login failed","falló el inicio de sesión","giriş başarısız"],"على مدار الساعة":["around the clock","las 24 horas","7/24"],"المحادثة الخاصة":["the private chat","el chat privado","özel sohbet"],"الأسئلة الشائعة":["frequently asked questions","preguntas frecuentes","sıkça sorulan sorular"],"الاسئلة الشائعة":["frequently asked questions","preguntas frecuentes","sıkça sorulan sorular"],"من لوحة الإدارة":["from the admin panel","desde el panel de administración","yönetim panelinden"],"من لوحة الادارة":["from the admin panel","desde el panel de administración","yönetim panelinden"],"يرجى شحن الرصيد":["please recharge your balance","por favor recarga tu saldo","lütfen bakiyenizi yükleyin"],"حذف هذه الحالة":["delete this status","eliminar este estado","bu durumu silmek"],"لا تملك صلاحية":["you are not allowed to","no tienes permiso para","izniniz yok"],"الرسائل الخاصة":["private messages","mensajes privados","özel mesajlar"],"الحيوان الملكي":["royal animal","animal real","kraliyet hayvanı"],"رصيدك غير كافٍ":["your balance is insufficient","tu saldo es insuficiente","bakiyeniz yetersiz"],"متحدث برد مخصص":["custom reply talker","hablante con respuesta personalizada","özel yanıt veren"],"رصيدك غير كاف":["your balance is insufficient","tu saldo es insuficiente","bakiyeniz yetersiz"],"الحساب المسجل":["the registered account","la cuenta registrada","kayıtlı hesap"],"الدخول الملكي":["royal entrance","entrada real","kraliyet girişi"],"تسكير الهدايا":["cashing out gifts","conversión de regalos","hediyeleri nakde çevirme"],"الميكروفونات":["the microphones","los micrófonos","mikrofonlar"],"لوحة الإدارة":["the admin panel","el panel de administración","yönetim paneli"],"لوحة الادارة":["the admin panel","el panel de administración","yönetim paneli"],"غرفة الدردشة":["the chat room","la sala de chat","sohbet odası"],"البث المباشر":["live stream","transmisión en vivo","canlı yayın"],"قيد المراجعة":["under review","en revisión","incelemede"],"نوع الصلاحية":["role type","tipo de rol","rol türü"],"الغرفة مغلقة":["room is closed","sala cerrada","oda kapalı"],"فيديو يوتيوب":["YouTube video","vídeo de YouTube","YouTube videosu"],"انتهت الجلسة":["session expired","sesión expirada","oturum süresi doldu"],"مكالمة فيديو":["video call","videollamada","görüntülü arama"],"كلمة المرور":["password","contraseña","şifre"],"لوحة التحكم":["the control panel","el panel de control","kontrol paneli"],"غرف الدردشة":["chat rooms","salas de chat","sohbet odaları"],"هل تريد حذف":["do you want to delete","¿quieres eliminar","silmek istiyor musunuz"],"نوع العضوية":["membership type","tipo de membresía","üyelik türü"],"اسم الروبوت":["bot name","nombre del bot","bot adı"],"ملك الدردشة":["chat owner","dueño del chat","sohbet sahibi"],"غرفة محذوفة":["deleted room","sala eliminada","silinmiş oda"],"خدمة البريد":["the email service","el servicio de correo","e-posta servisi"],"ميكروفونات":["microphones","micrófonos","mikrofonlar"],"نجوم العرب":["Arab Stars","Estrellas de los Árabes","Arap Yıldızları"],"جارٍ إنشاء":["creating","creando","oluşturuluyor"],"جارٍ تسجيل":["registering","registrando","kayıt olunuyor"],"جارٍ إرسال":["sending","enviando","gönderiliyor"],"جارٍ تحميل":["loading","cargando","yükleniyor"],"رسالة خاصة":["private message","mensaje privado","özel mesaj"],"رصيد الذهب":["gold balance","saldo de oro","altın bakiyesi"],"نوع الحساب":["account type","tipo de cuenta","hesap türü"],"بدون عضوية":["no membership","sin membresía","üyeliksiz"],"غير مفعّلة":["is not enabled","no está activado","etkin değil"],"الميكروفون":["the microphone","el micrófono","mikrofon"],"جار انشاء":["creating","creando","oluşturuluyor"],"جار تسجيل":["registering","registrando","kayıt olunuyor"],"جار ارسال":["sending","enviando","gönderiliyor"],"جار تحميل":["loading","cargando","yükleniyor"],"غير مفعلة":["is not enabled","no está activado","etkin değil"],"اتصالاتهم":["their connections","sus conexiones","bağlantıları"],"ماستركارد":["Mastercard","Mastercard","Mastercard"],"متطابقتين":["do not match","no coinciden","eşleşmiyor"],"المبتدئين":["beginners","principiantes","yeni başlayanlar"],"shoutcast":["shoutcast","shoutcast","shoutcast"],"غير مسموح":["not allowed","no permitido","izinli değil"],"كلمة السر":["password","contraseña","şifre"],"زائر عادي":["regular visitor","visitante normal","normal ziyaretçi"],"متحدث ذكي":["smart talker","hablante inteligente","akıllı konuşan"],"حساب موثق":["verified account","cuenta verificada","onaylı hesap"],"أدمن غرفة":["room admin","admin de sala","oda yöneticisi"],"ادمن غرفة":["room admin","admin de sala","oda yöneticisi"],"سوبر أدمن":["super admin","súper admin","süper yönetici"],"سوبر ادمن":["super admin","súper admin","süper yönetici"],"المشاهدات":["views","vistas","izlenmeler"],"مستخدمين":["users","usuarios","kullanıcılar"],"تلقائياً":["automatically","automáticamente","otomatik"],"ميكروفون":["microphone","micrófono","mikrofon"],"إلكتروني":["electronic","electrónico","elektronik"],"الكتروني":["electronic","electrónico","elektronik"],"افتراضية":["default","predeterminada","varsayılan"],"تلقائيًا":["automatically","automáticamente","otomatik"],"مرفوعاتي":["my uploads","mis subidas","yüklemelerim"],"سيُحوَّل":["will be transferred","se transferirá","transfer edilecek"],"مستخدمون":["users","usuarios","kullanıcılar"],"باستخدام":["using","usando","kullanarak"],"متواجداً":["present","presente","bulunan"],"جارٍ فتح":["opening","abriendo","açılıyor"],"جارٍ رفع":["uploading","subiendo","yükleniyor"],"ستستلمين":["you will receive","recibirás","alacaksın"],"بألوانها":["with its colors","con sus colores","renkleriyle"],"بالوانها":["with its colors","con sus colores","renkleriyle"],"إيقافهما":["stop both","detener ambos","ikisini durdur"],"ايقافهما":["stop both","detener ambos","ikisini durdur"],"إغلاقهما":["close both","cerrar ambos","ikisini kapat"],"اغلاقهما":["close both","cerrar ambos","ikisini kapat"],"مستخدماً":["as user","como usuario","kullanıcı olarak"],"تجريبياً":["as demo","como demo","demo olarak"],"ليُولَّد":["to be generated","para generarse","oluşturulması"],"إسترليني":["sterling","esterlina","sterlin"],"استرليني":["sterling","esterlina","sterlin"],"امتلائها":["becoming full","llenarse","dolması"],"وكاميرتك":["and your camera","y tu cámara","ve kameranız"],"متجاهلين":["ignored","ignorados","yok sayılanlar"],"لقراءتها":["to read it","para leerla","okumak"],"المسجلون":["the registered","los registrados","kayıtlılar"],"بث مباشر":["live stream","transmisión en vivo","canlı yayın"],"بلا شارة":["without badge","sin insignia","rosetsiz"],"برقم سري":["password-protected","con contraseña","şifreli"],"الكاميرا":["the camera","la cámara","kamera"],"تلقائيا":["automatically","automáticamente","otomatik"],"متواجدا":["present","presente","bulunan"],"جار فتح":["opening","abriendo","açılıyor"],"جار رفع":["uploading","subiendo","yükleniyor"],"مستخدما":["as user","como usuario","kullanıcı olarak"],"تجريبيا":["as demo","como demo","demo olarak"],"يستقبله":["receives it","lo recibe","alır"],"أستقبله":["I receive it","lo recibo","alırım"],"استقبله":["I receive it","lo recibo","alırım"],"إعدادات":["settings","ajustes","ayarlar"],"اعدادات":["settings","ajustes","ayarlar"],"مكالمات":["calls","llamadas","aramalar"],"إشعارات":["notifications","notificaciones","bildirimler"],"اشعارات":["notifications","notificaciones","bildirimler"],"استعادة":["recovery","recuperación","kurtarma"],"نهائياً":["permanently","permanentemente","kalıcı"],"تسجيلات":["recordings","grabaciones","kayıtlar"],"اختياري":["optional","opcional","isteğe bağlı"],"اصطناعي":["artificial","artificial","yapay"],"فافيكون":["favicon","favicon","favicon"],"محادثات":["chats","chats","sohbetler"],"متوافقة":["compatible","compatible","uyumlu"],"استخدام":["use","uso","kullanım"],"دولارات":["dollars","dólares","dolar"],"افتراضي":["default","predeterminado","varsayılan"],"مستهدفة":["targeted","objetivo","hedef"],"مشاهدته":["watching it","verlo","izlemek"],"تسكيرها":["cashing them","convertirlas","nakde"],"استقبال":["receiving","recepción","alma"],"بانتظار":["awaiting","esperando","bekliyor"],"تجريبية":["trial","de prueba","deneme"],"وإدخاله":["and deploy it","y desplegarlo","ve sokma"],"وادخاله":["and deploy it","y desplegarlo","ve sokma"],"وكتابية":["and text","y de texto","ve yazılı"],"اتصالات":["connections","conexiones","bağlantılar"],"استراحة":["break","descanso","mola"],"استئناف":["resume","reanudar","devam"],"مُبلَّغ":["reported","reportado","bildirilmiş"],"مفتاحية":["keyword","clave","anahtar"],"أمريكان":["American","American","American"],"امريكان":["American","American","American"],"إكسبريس":["Express","Express","Express"],"اكسبريس":["Express","Express","Express"],"متجاهَل":["ignored","ignorado","yok sayılan"],"استمرار":["continuing","continuar","devam"],"مشاهدين":["viewers","espectadores","izleyiciler"],"استقبلي":["receive","recibe","alın"],"بجمالها":["with her beauty","con su belleza","güzelliğiyle"],"إرسالها":["sending it","enviarla","göndermek"],"ارسالها":["sending it","enviarla","göndermek"],"مشاهدتك":["watching you","verte","seni izleme"],"متحدثون":["speakers","hablantes","konuşanlar"],"موافقته":["his approval","su aprobación","onayı"],"مكالمتك":["your call","tu llamada","aramanız"],"استهلاك":["used","consumido","kullanılmış"],"متطلبات":["requirements","requisitos","gereksinimler"],"لبيانات":["for data","para datos","verileri"],"حيواناً":["another animal","otro animal","başka hayvan"],"وأجهزته":["and his device","y su dispositivo","ve cihazı"],"واجهزته":["and his device","y su dispositivo","ve cihazı"],"ستُختار":["will be chosen","se elegirá","seçilecek"],"عشوائية":["random","aleatoria","rastgele"],"تعديلات":["changes","cambios","değişiklikler"],"استجابة":["response","respuesta","yanıt"],"وتحريره":["and edit it","y editarlo","ve düzenleme"],"استبدال":["replacement","reemplazo","değiştirme"],"إجراءات":["actions","acciones","işlemler"],"اجراءات":["actions","acciones","işlemler"],"إماراتي":["Emirati","emiratí","BAE"],"اماراتي":["Emirati","emiratí","BAE"],"وستُخصم":["and will be deducted","y se descontarán","ve kesilecek"],"مدفوعات":["payments","pagos","ödemeler"],"لتشغيله":["to play it","reproducirlo","çalmak"],"مستقلاً":["independent","independiente","bağımsız"],"مستقبِل":["recipient","receptor","alıcı"],"هداياها":["her gifts","sus regalos","hediyeleri"],"مطابقون":["matching","coinciden","eşleşen"],"مطرودين":["kicked","expulsados","atılan"],"لمحركات":["for search engines","para motores","motorlar"],"ومتصلاً":["and connected","y conectado","ve bağlı"],"توليدها":["its generation","su generación","oluşturulması"],"مشاهدات":["views","vistas","izlenme"],"تحديداً":["specifically","específicamente","özellikle"],"يُستخدم":["is used","se usa","kullanılır"],"معلومات":["information","información","bilgi"],"مجوهرات":["jewels","joyas","mücevher"],"إجمالية":["total","total","toplam"],"اجمالية":["total","total","toplam"],"منشورات":["posts","publicaciones","gönderiler"],"تفاعلات":["interactions","interacciones","etkileşimler"],"مجتمعنا":["our community","nuestra comunidad","topluluğumuz"],"وتستطيع":["and you can","y puedes","ve yapabilirsin"],"احترافي":["professional","profesional","profesyonel"],"أصدقائك":["your friends","tus amigos","arkadaşların"],"اصدقائك":["your friends","tus amigos","arkadaşların"],"وPayPal":["and PayPal","y PayPal","ve PayPal"],"وخيارات":["and options","y opciones","ve seçenekler"],"ومعاينة":["and preview","y vista previa","ve önizleme"],"مُوَلّد":["generator","generador","üretici"],"ومايكات":["and mics","y micrófonos","ve mikrofonlar"],"تفاعلوا":["interact","interactúen","etkileşin"],"تعليقاً":["a comment","un comentario","bir yorum"],"التوفير":["saving","ahorro","tasarruf"],"أونلاين":["online","en línea","çevrimiçi"],"اونلاين":["online","en línea","çevrimiçi"],"icecast":["icecast","icecast","icecast"],"لا يوجد":["there are no","no hay","yok"],"لا توجد":["there are no","no hay","yok"],"لا يمكن":["cannot","no se puede","olamaz"],"بنجاح ✅":["successfully ✅","con éxito ✅","başarıyla ✅"],"بنجاح ✓":["successfully ✓","con éxito ✓","başarıyla ✓"],"نهائيا":["permanently","permanentemente","kalıcı"],"متجاهل":["ignored","ignorado","yok sayılan"],"حيوانا":["another animal","otro animal","başka hayvan"],"ستختار":["will be chosen","se elegirá","seçilecek"],"وستخصم":["and will be deducted","y se descontarán","ve kesilecek"],"مستقلا":["independent","independiente","bağımsız"],"مستقبل":["recipient","receptor","alıcı"],"ومتصلا":["and connected","y conectado","ve bağlı"],"تحديدا":["specifically","específicamente","özellikle"],"يستخدم":["is used","se usa","kullanılır"],"تعليقا":["a comment","un comentario","bir yorum"],"الساعة":["hour","hora","saat"],"أحادية":["one-way","unidireccional","tek yönlü"],"احادية":["one-way","unidireccional","tek yönlü"],"مكالمة":["call","llamada","arama"],"مستخدم":["user","usuario","kullanıcı"],"مشاهدة":["view","ver","izleme"],"موافقة":["approval","aprobación","onay"],"صلاحية":["permission","permiso","yetki"],"عضويتك":["your membership","tu membresía","üyeliğiniz"],"كاميرا":["camera","cámara","kamera"],"محادثة":["conversation","conversación","sohbet"],"مجانية":["free","gratis","ücretsiz"],"بإرسال":["sending","enviar","göndermeye"],"بارسال":["sending","enviar","göndermeye"],"معاينة":["preview","vista previa","önizleme"],"متابعة":["continue","continuar","devam"],"حالياً":["currently","actualmente","şu anda"],"بيانات":["data","datos","veri"],"مغادرة":["leave","salir de","ayrılma"],"تلقائي":["auto","automático","otomatik"],"تفاصيل":["details","detalles","detaylar"],"مراجعة":["review","revisión","inceleme"],"مجدداً":["again","de nuevo","tekrar"],"بواسطة":["by","por","tarafından"],"مستلمة":["received","recibida","alınan"],"مسجلين":["registered","registrados","kayıtlı"],"تجريبي":["demo","demo","demo"],"انتقال":["moving","cambiar","geçiş"],"فارغاً":["empty","vacío","boş"],"أيقونة":["icon","icono","simge"],"ايقونة":["icon","icono","simge"],"مذيعين":["broadcasters","locutores","yayıncılar"],"مباشرة":["directly","directamente","doğrudan"],"لتكبير":["to zoom","ampliar","büyütmek"],"حيوانك":["your animal","tu animal","hayvanınız"],"وسيصلك":["and you will receive","y recibirás","ve alacaksınız"],"محاولة":["attempt","intentar","deneme"],"لتشغيل":["to play","reproducir","çalmak"],"مفتوحة":["open","abierta","açık"],"خصوصية":["privacy","privacidad","gizlilik"],"عمليات":["operations","operaciones","işlemler"],"إيموجي":["emoji","emoji","emoji"],"ايموجي":["emoji","emoji","emoji"],"متصلين":["online users","conectados","bağlılar"],"إدارية":["administrative","administrativa","yönetimsel"],"ادارية":["administrative","administrativa","yönetimsel"],"لإنشاء":["to create","crear","oluşturmak"],"لانشاء":["to create","crear","oluşturmak"],"لتصغير":["to shrink","reducir","küçültmek"],"وأنوثة":["and femininity","y feminidad","ve kadınlık"],"وانوثة":["and femininity","y feminidad","ve kadınlık"],"كاملاً":["fully","completa","tam"],"مفعّلة":["enabled","activada","etkin"],"جيميلك":["your Gmail","tu Gmail","Gmailiniz"],"ظاهراً":["visible","visible","görünür"],"مسبقاً":["previously","previamente","önceden"],"هداياك":["your gifts","tus regalos","hediyeleriniz"],"استلام":["receiving","recepción","alma"],"يتناسب":["is proportional","es proporcional","orantılı"],"طردياً":["proportionally","directamente","orantılı"],"إطلالة":["look","look","görünüm"],"اطلالة":["look","look","görünüm"],"لتوليد":["to generate","generar","oluşturmak"],"وإبلاغ":["and report","y informar","ve bildirme"],"وابلاغ":["and report","y informar","ve bildirme"],"إجمالي":["total","total","toplam"],"اجمالي":["total","total","toplam"],"اختيار":["selection","selección","seçim"],"اتركها":["leave it","déjala","bırakın"],"كتابية":["text","de texto","yazılı"],"بريداً":["email","correo","e-posta"],"مقترحة":["suggested","sugerida","önerilen"],"وتنفيذ":["and execute","y ejecutar","ve yürütme"],"بطاقات":["cards","tarjetas","kartlar"],"مفاتيح":["keywords","palabras clave","anahtar kelimeler"],"اختبار":["test","prueba","test"],"عضويات":["memberships","membresías","üyelikler"],"حسابات":["accounts","cuentas","hesaplar"],"دائماً":["always","siempre","her zaman"],"قيمتها":["its value","su valor","değeri"],"مفعَّل":["enabled","activado","etkin"],"مسارات":["paths","rutas","yollar"],"عناوين":["titles","títulos","başlıklar"],"مستعار":["alias","alias","takma"],"الكمية":["the quantity","la cantidad","miktar"],"مسجلاً":["registered","registrado","kayıtlı"],"بينكما":["between you two","entre ustedes","aranızda"],"لقائمة":["to the list","a la lista","listeye"],"منتهية":["finished","terminada","bitmiş"],"انقطعت":["disconnected","se cortó","kesildi"],"بإجراء":["making","realizar","yapmak"],"باجراء":["making","realizar","yapmak"],"متصفحك":["your browser","tu navegador","tarayıcınız"],"داخلية":["internal","interna","dahili"],"معالجة":["processing","procesamiento","işleme"],"تستلمي":["you receive","recibes","alırsın"],"سيُرسل":["will be sent","se enviará","gönderilecek"],"حاليًا":["currently","actualmente","şu anda"],"ومهابة":["and majesty","y majestad","ve heybet"],"متفتحة":["blooming","floreciente","tomurcuk"],"تتفتّح":["blooms","florece","açar"],"لتغيير":["to change","cambiar","değiştirmek"],"بنتيجة":["with the result","con el resultado","sonuçla"],"لاحقاً":["later","más tarde","sonra"],"لإتمام":["to complete","completar","tamamlamak"],"لاتمام":["to complete","completar","tamamlamak"],"يستطيع":["can","puede","yapabilir"],"وإكمال":["and complete","y completar","ve tamamlama"],"واكمال":["and complete","y completar","ve tamamlama"],"مُفعّل":["activated","activado","etkinleştirilmiş"],"يتجاوز":["exceeds","supere","aşmasın"],"مرفوعة":["uploaded","subida","yüklenmiş"],"وحفظها":["and save it","y guardarla","ve kaydetmek"],"استخدم":["use","usa","kullanın"],"وتجهيز":["and prepare","y preparar","ve hazırlama"],"لحذفها":["to delete them","eliminarlas","silmek"],"انتظار":["waiting","espera","bekleme"],"استماع":["listen","escuchar","dinleme"],"تنسيقه":["its format","su formato","biçimi"],"إرساله":["sending it","enviarlo","göndermek"],"ارساله":["sending it","enviarlo","göndermek"],"حاليون":["current","actuales","mevcut"],"سيُعرض":["will be shown","se mostrará","gösterilecek"],"ستختفي":["will disappear","desaparecerá","kaybolacak"],"وتكلفة":["and costs","y cuesta","ve maliyeti"],"لتتمكن":["to be able","para poder","yapabilmek"],"يحدّده":["determines it","lo determina","belirler"],"تريدين":["you want","quieres","istiyorsan"],"متكررة":["repeated","repetidas","tekrarlayan"],"فوريًا":["instant","instantáneo","anında"],"متوقفة":["stopped","detenidas","durdurulmuş"],"تُفعّل":["is activated","se activa","etkinleştirilir"],"وتطبيق":["and apply","y aplicar","ve uygulama"],"وأصوات":["and sounds","y sonidos","ve sesler"],"واصوات":["and sounds","y sonidos","ve sesler"],"فيُحظر":["is banned","se bloquea","yasaklanır"],"محذوفة":["deleted","eliminada","silinmiş"],"متواجد":["present","presente","bulunan"],"رمزيات":["avatars","avatares","avatarlar"],"يتحدّث":["is talking","está hablando","konuşuyor"],"سيسمعه":["will hear it","lo escuchará","duyacak"],"وسهلاً":["welcome","bienvenido","hoş geldiniz"],"لشخصية":["for character","para el personaje","kişilik"],"واقترح":["and suggest","y sugiere","ve öner"],"سؤالاً":["a question","una pregunta","bir soru"],"لتجربة":["to try","probar","denemek"],"صالحاً":["valid","válido","geçerli"],"مشرفين":["moderators","moderadores","moderatörler"],"مراقبة":["monitoring","monitoreo","izleme"],"مطلوبة":["required","requeridas","gerekli"],"ممنوعة":["forbidden","prohibidas","yasak"],"جذاباً":["attractive","atractiva","çekici"],"أساسية":["basic","básica","temel"],"اساسية":["basic","básica","temel"],"مطابقة":["matching","coincidencia","eşleşme"],"ملاحظة":["note","nota","not"],"ويمنعه":["and prevents him","y le impide","ve engeller"],"أُنشئت":["created","creada","oluşturuldu"],"فعلياً":["actually","realmente","gerçekten"],"ويُشحن":["and is credited","y se acredita","ve yüklenir"],"حقيقية":["real","reales","gerçek"],"أمريكي":["American","americano","Amerikan"],"امريكي":["American","americano","Amerikan"],"مراسلة":["messaging","mensajería","mesajlaşma"],"مستفيد":["beneficiary","beneficiario","alıcı"],"مؤكّدة":["confirmed","confirmada","onaylı"],"صوتياً":["voice","de voz","sesli"],"ومشرفو":["and moderators","y moderadores","ve moderatörler"],"متزامن":["simultaneous","simultáneo","eşzamanlı"],"برسالة":["with a message","con un mensaje","bir mesajla"],"ممتلئة":["full","llena","dolu"],"رسالته":["his message","su mensaje","mesajı"],"ويُطبق":["and is applied","y se aplica","ve uygulanır"],"مُرسِل":["sender","remitente","gönderen"],"بقيمها":["with their value","con su valor","değerleriyle"],"تسكيها":["cashing them","convertirlas","nakdetmesi"],"يدوياً":["manually","manualmente","elle"],"حسابها":["her account","su cuenta","hesabına"],"هداياه":["his gifts","sus regalos","hediyeleri"],"مُرسَل":["sent","enviado","gönderilmiş"],"موجودة":["existing","existentes","mevcut"],"مستقلة":["independent","independientes","bağımsız"],"مصغّرة":["miniature","en miniatura","minyatür"],"بأسلوب":["in style","al estilo","tarzında"],"باسلوب":["in style","al estilo","tarzında"],"مبلِّغ":["reporter","informante","bildiren"],"ينقصها":["lacks","le falta","eksik"],"مُنشأة":["created","creada","oluşturulmuş"],"وتوليد":["and generate","y generar","ve oluşturma"],"معايير":["criteria","criterios","kriterler"],"دلالية":["semantic","semántica","anlam"],"متصدرة":["top-ranking","destacada","üst"],"لإضافة":["to add","añadir","eklemek"],"لاضافة":["to add","añadir","eklemek"],"لأعضاء":["for members","para miembros","üyeler"],"لاعضاء":["for members","para miembros","üyeler"],"مذيعاً":["a broadcaster","locutor","yayıncı"],"مجانًا":["free","gratis","ücretsiz"],"وقراءة":["and read","y leer","ve okuma"],"أرسلنا":["we sent","enviamos","gönderdik"],"ارسلنا":["we sent","enviamos","gönderdik"],"مكونًا":["composed of","compuesto de","oluşan"],"مرغوبة":["unwanted","no deseados","istenmeyen"],"بتسجيل":["registering","registrarte","kayıt"],"بترقية":["upgrading","mejorar","yükseltme"],"لإضاءة":["to light up","para iluminar","aydınlatmak"],"لاضاءة":["to light up","para iluminar","aydınlatmak"],"رئيسية":["main","principales","ana"],"أرسلها":["send it","envíala","gönder"],"ارسلها":["send it","envíala","gönder"],"لحسابك":["to your account","a tu cuenta","hesabınıza"],"يوتيوب":["YouTube","YouTube","YouTube"],"عشوائي":["random","aleatorio","rastgele"],"دائمًا":["always","siempre","her zaman"],"وإشعار":["and notify","y notificar","ve bildirim"],"واشعار":["and notify","y notificar","ve bildirim"],"تميّزك":["your distinction","te distinga","seni ayıran"],"لترقية":["to upgrade","para mejorar","yükseltmek"],"وإرسال":["and send","y enviar","ve gönderme"],"وارسال":["and send","y enviar","ve gönderme"],"مناسبة":["suitable","adecuada","uygun"],"فورياً":["instantly","al instante","anında"],"مختارة":["selected","seleccionadas","seçilmiş"],"وسنرسل":["and we will send","y enviaremos","ve göndereceğiz"],"مكتوبة":["written","escritos","yazılı"],"لتعديل":["to edit","para editar","düzenlemek"],"ويستمر":["and continues","y continúa","ve devam"],"بحسابك":["with your account","con tu cuenta","hesabınızla"],"لتسجيل":["to register","para registrarte","kayıt olmak"],"لتحريك":["to move","para mover","taşımak"],"منشورك":["your post","tu publicación","gönderin"],"متكامل":["complete","completo","tam"],"وكلمات":["and words","y palabras","ve kelimeler"],"محركات":["engines","motores","motorlar"],"وصداقة":["and friendship","y amistad","ve dostluk"],"الفضية":["silver","plateada","gümüş"],"الأهلي":["national","nacional","milli"],"الاهلي":["national","nacional","milli"],"التالي":["the next","el siguiente","sonraki"],"تستخدم":["uses","usa","kullanır"],"مسجلون":["registered","registrados","kayıtlı"],"مستحسن":["recommended","recomendado","önerilir"],"سيحول":["will be transferred","se transferirá","transfer edilecek"],"ليولد":["to be generated","para generarse","oluşturulması"],"حاليا":["currently","actualmente","şu anda"],"مجددا":["again","de nuevo","tekrar"],"فارغا":["empty","vacío","boş"],"كاملا":["fully","completa","tam"],"مفعلة":["enabled","activada","etkin"],"ظاهرا":["visible","visible","görünür"],"مسبقا":["previously","previamente","önceden"],"طرديا":["proportionally","directamente","orantılı"],"بريدا":["email","correo","e-posta"],"دائما":["always","siempre","her zaman"],"مسجلا":["registered","registrado","kayıtlı"],"سيرسل":["will be sent","se enviará","gönderilecek"],"تتفتح":["blooms","florece","açar"],"لاحقا":["later","más tarde","sonra"],"سيعرض":["will be shown","se mostrará","gösterilecek"],"يحدده":["determines it","lo determina","belirler"],"فوريا":["instant","instantáneo","anında"],"فيحظر":["is banned","se bloquea","yasaklanır"],"يتحدث":["is talking","está hablando","konuşuyor"],"وسهلا":["welcome","bienvenido","hoş geldiniz"],"سؤالا":["a question","una pregunta","bir soru"],"صالحا":["valid","válido","geçerli"],"جذابا":["attractive","atractiva","çekici"],"انشئت":["created","creada","oluşturuldu"],"فعليا":["actually","realmente","gerçekten"],"ويشحن":["and is credited","y se acredita","ve yüklenir"],"مؤكدة":["confirmed","confirmada","onaylı"],"صوتيا":["voice","de voz","sesli"],"ويطبق":["and is applied","y se aplica","ve uygulanır"],"يدويا":["manually","manualmente","elle"],"مصغرة":["miniature","en miniatura","minyatür"],"منشاة":["created","creada","oluşturulmuş"],"مذيعا":["a broadcaster","locutor","yayıncı"],"مجانا":["free","gratis","ücretsiz"],"مكونا":["composed of","compuesto de","oluşan"],"تميزك":["your distinction","te distinga","seni ayıran"],"العرب":["Arabs","árabes","Arapların"],"اليوم":["today","hoy","bugün"],"مرحبا":["hello","hola","merhaba"],"اتجاه":["direction","dirección","yön"],"يصلني":["reaches me","me llega","bana ulaşır"],"وأريد":["and I want","y quiero","ve istiyorum"],"واريد":["and I want","y quiero","ve istiyorum"],"الحذف":["deleted","eliminado","silindi"],"تعذرت":["failed to","no se pudo","başarısız"],"إرسال":["send","enviar","gönderme"],"ارسال":["send","enviar","gönderme"],"إدارة":["administration","administración","yönetim"],"ادارة":["administration","administración","yönetim"],"فيديو":["video","vídeo","video"],"هدايا":["gifts","regalos","hediyeler"],"دردشة":["chat","chat","sohbet"],"تحميل":["loading","carga","indirme"],"رسالة":["message","mensaje","mesaj"],"بنجاح":["successfully","con éxito","başarıyla"],"تفعيل":["activation","activación","etkinleştirme"],"تغيير":["change","cambio","değiştirme"],"رسائل":["messages","mensajes","mesajlar"],"تسجيل":["registration","registro","kayıt"],"تسكير":["cashing out","conversión","nakde çevirme"],"اتصال":["connection","conexión","bağlantı"],"إيقاف":["stop","detener","durdur"],"ايقاف":["stop","detener","durdur"],"يمكنك":["you can","puedes","yapabilirsiniz"],"مباشر":["live","en vivo","canlı"],"إلغاء":["cancel","cancelar","iptal"],"الغاء":["cancel","cancelar","iptal"],"حسابك":["your account","tu cuenta","hesabınız"],"عضوية":["membership","membresía","üyelik"],"صوتية":["voice","de voz","sesli"],"تشغيل":["run","ejecutar","çalıştırma"],"قائمة":["list","lista","liste"],"مسموح":["allowed","permitido","izinli"],"أولاً":["first","primero","önce"],"توليد":["generation","generación","oluşturma"],"جديدة":["new","nueva","yeni"],"رصيدك":["your balance","tu saldo","bakiyeniz"],"تحويل":["transfer","transferencia","transfer"],"تجاهل":["ignore","ignorar","yok sayma"],"ترقية":["upgrade","mejora","yükseltme"],"روبوت":["bot","bot","bot"],"محددة":["specified","especificada","belirli"],"عنوان":["title","título","başlık"],"إنشاء":["creating","crear","oluşturma"],"انشاء":["creating","crear","oluşturma"],"أثناء":["during","durante","sırasında"],"اثناء":["during","durante","sırasında"],"إضافة":["add","añadir","ekleme"],"اضافة":["add","añadir","ekleme"],"توثيق":["verification","verificación","doğrulama"],"عملية":["operation","operación","işlem"],"إعادة":["re-","re-","yeniden"],"اعادة":["re-","re-","yeniden"],"باقات":["packages","paquetes","paketler"],"إشعار":["notification","notificación","bildirim"],"اشعار":["notification","notificación","bildirim"],"حيوان":["animal","animal","hayvan"],"بوابة":["gateway","pasarela","geçit"],"تعديل":["edit","editar","düzenleme"],"تأكيد":["confirm","confirmar","onay"],"تاكيد":["confirm","confirmar","onay"],"إنهاء":["end","finalizar","bitirme"],"انهاء":["end","finalizar","bitirme"],"منشور":["post","publicación","gönderi"],"راديو":["radio","radio","radyo"],"حالية":["current","actual","mevcut"],"مطلوب":["required","requerido","gerekli"],"فوراً":["immediately","inmediatamente","hemen"],"عربية":["Arabic","árabe","Arapça"],"حالات":["statuses","estados","durumlar"],"انتهت":["ended","terminó","bitti"],"تحديث":["update","actualizar","güncelleme"],"متاحة":["available","disponible","mevcut"],"تكلفة":["cost","costo","maliyet"],"أينما":["wherever","dondequiera","nerede"],"اينما":["wherever","dondequiera","nerede"],"دخولك":["your entry","tu entrada","girişiniz"],"تشاهد":["watching","ves","izliyorsun"],"ثانية":["second","segundo","saniye"],"تجربة":["trial","prueba","deneme"],"أرشفة":["archiving","archivado","arşivleme"],"ارشفة":["archiving","archivado","arşivleme"],"نماذج":["models","modelos","modeller"],"حسابي":["my account","mi cuenta","hesabım"],"كزائر":["as visitor","como visitante","ziyaretçi olarak"],"تجهيز":["preparing","preparar","hazırlama"],"متصفح":["browser","navegador","tarayıcı"],"جارية":["ongoing","en curso","devam eden"],"ملكية":["ownership","propiedad","sahiplik"],"شخصية":["personal","personal","kişisel"],"أرقام":["digits","dígitos","rakamlar"],"ارقام":["digits","dígitos","rakamlar"],"حسناً":["OK","de acuerdo","tamam"],"لجميع":["for all","para todos","herkes için"],"تاريخ":["date","fecha","tarih"],"إعلان":["announcement","anuncio","duyuru"],"اعلان":["announcement","anuncio","duyuru"],"فارغة":["empty","vacía","boş"],"اتركه":["leave it","déjalo","bırakın"],"تطبيق":["app","aplicación","uygulama"],"تنفيذ":["execute","ejecutar","yürütme"],"أعضاء":["members","miembros","üyeler"],"اعضاء":["members","miembros","üyeler"],"إداري":["admin","administrativo","yönetici"],"اداري":["admin","administrativo","yönetici"],"اسحبه":["drag it","arrástralo","sürükleyin"],"تحريك":["move","mover","taşıma"],"سبيكر":["speaker","altavoz","hoparlör"],"سماعة":["earpiece","auricular","kulaklık"],"واردة":["incoming","entrante","gelen"],"بطاقة":["card","tarjeta","kart"],"بريدك":["your email","tu correo","e-postanız"],"مرتبط":["linked","vinculado","bağlı"],"بحساب":["to account","a la cuenta","hesaba"],"اتمام":["completion","completar","tamamlama"],"بجوار":["next to","junto a","yanında"],"نتيجة":["result","resultado","sonuç"],"كلمات":["words","palabras","kelimeler"],"متأكد":["sure","seguro","emin"],"متاكد":["sure","seguro","emin"],"خانات":["characters","caracteres","karakter"],"إغلاق":["close","cerrar","kapatma"],"اغلاق":["close","cerrar","kapatma"],"ويمكن":["and you can","y se puede","ve olabilir"],"تُحذف":["are deleted","se eliminan","silinir"],"طريقة":["method","método","yöntem"],"مجموع":["total","total","toplam"],"شكاوى":["complaints","quejas","şikayetler"],"أعلاه":["above","arriba","yukarıda"],"اعلاه":["above","arriba","yukarıda"],"تمكين":["enable","habilitar","etkinleştirme"],"دولار":["dollar","dólar","dolar"],"لشراء":["to buy","comprar","satın almak"],"بسرعة":["quickly","rápidamente","hızlıca"],"مخفية":["hidden","ocultas","gizli"],"مغلقة":["closed","cerrada","kapalı"],"إجراء":["action","acción","işlem"],"اجراء":["action","acción","işlem"],"معروف":["known","conocido","bilinen"],"إبلاغ":["report","informar","bildirme"],"ابلاغ":["report","informar","bildirme"],"ثابتة":["fixed","fija","sabit"],"مشغول":["busy","ocupado","meşgul"],"مكتوم":["muted","silenciado","susturulmuş"],"حالتك":["your status","tu estado","durumunuz"],"مختار":["chosen","elegido","seçilmiş"],"رقمًا":["digits","dígitos","rakam"],"سيصلك":["you will receive","recibirás","alacaksınız"],"حمراء":["red","roja","kırmızı"],"فاخرة":["luxurious","lujosa","lüks"],"وردية":["pink","rosada","pembe"],"تجاري":["commercial","comercial","ticari"],"يُشحن":["is credited","se acredita","yüklenir"],"يُخصم":["is deducted","se descuenta","kesilir"],"مرفقة":["attached","adjunta","ekli"],"مرفوع":["uploaded","subido","yüklenmiş"],"بكلمة":["with word","con la palabra","kelime ile"],"يُرسل":["is sent","se envía","gönderilir"],"ينتهي":["ends","termina","biter"],"لبقية":["for rest","para el resto","kalanı için"],"مدعوم":["supported","soportado","destekleniyor"],"مشاهد":["viewers","espectadores","izleyiciler"],"وتبقى":["and remain","y permanecen","ve kalır"],"تواصل":["contact","contacta","iletişim"],"إظهار":["show","mostrar","gösterme"],"اظهار":["show","mostrar","gösterme"],"منتهي":["expired","expirado","süresi bitmiş"],"تعيين":["assignment","asignación","atama"],"متوقف":["stopped","detenido","durdurulmuş"],"تحديد":["select","seleccionar","seçim"],"طبيعي":["natural","natural","doğal"],"مفتاح":["key","clave","anahtar"],"مفعّل":["active","activado","etkin"],"تعارف":["dating","conocer gente","tanışma"],"إزالة":["removal","eliminar","kaldırma"],"ازالة":["removal","eliminar","kaldırma"],"طلبات":["requests","solicitudes","istekler"],"حسابه":["his account","su cuenta","hesabı"],"قاعدة":["database","base de datos","veritabanı"],"أدناه":["below","abajo","aşağıda"],"ادناه":["below","abajo","aşağıda"],"دينار":["dinar","dinar","dinar"],"أردني":["Jordanian","jordano","Ürdün"],"اردني":["Jordanian","jordano","Ürdün"],"تتحدث":["are talking","hablan","konuşuyor"],"محتوى":["content","contenido","içerik"],"شارات":["badges","insignias","rozetler"],"كتابة":["text","texto","yazma"],"فتيات":["girls","chicas","kızlar"],"مسجلة":["recorded","grabadas","kayıtlı"],"أرشيف":["archive","archivo","arşiv"],"ارشيف":["archive","archivo","arşiv"],"واضغط":["and press","y pulsa","ve basın"],"حالتي":["my status","mi estado","durumum"],"واجهة":["interface","interfaz","arayüz"],"وسائط":["media","multimedia","medya"],"شاتنا":["our chat","nuestro chat","sohbetimiz"],"مقدمة":["intro","introducción","giriş"],"مقدار":["amount","cantidad","miktar"],"توافق":["approval","aprobación","onay"],"ترفضه":["rejects it","la rechaza","reddediyor"],"محمية":["protected","protegida","korunan"],"كمذيع":["as broadcaster","como locutor","yayıncı olarak"],"صعوده":["his joining","su subida","katılması"],"إتمام":["completion","completar","tamamlama"],"بحرين":["Bahrain","Baréin","Bahreyn"],"سلطنة":["Sultanate","Sultanato","Sultanlığı"],"سوريا":["Syria","Siria","Suriye"],"لبنان":["Lebanon","Líbano","Lübnan"],"جزائر":["Algeria","Argelia","Cezayir"],"ليبيا":["Libya","Libia","Libya"],"سودان":["Sudan","Sudán","Sudan"],"فائتة":["missed","perdida","cevapsız"],"مطفأة":["off","apagada","kapalı"],"مطفاة":["off","apagada","kapalı"],"محدود":["limited","limitado","sınırlı"],"توصيل":["connecting","conectando","bağlanıyor"],"انقطع":["disconnected","se cortó","kesildi"],"لنفاذ":["running out of","agotarse","bitmesi"],"يطابق":["matches","coincide","eşleşiyor"],"أدخلي":["enter","introduce","girin"],"ادخلي":["enter","introduce","girin"],"يتكون":["consists","consiste","oluşur"],"تأمين":["securing","asegurar","güvence"],"تامين":["securing","asegurar","güvence"],"بهدوء":["calmly","con calma","sakinçe"],"وهدوء":["and calm","y calma","ve sakinlik"],"يحلّق":["soars","planea","savar"],"فراشة":["butterfly","mariposa","kelebek"],"ترفرف":["flutters","aletea","kanat çırpar"],"نعومة":["softness","suavidad","yumuşaklık"],"ودلال":["and charm","y encanto","ve şirinlik"],"كوردة":["as a rose","como rosa","gül olarak"],"ناعمة":["soft","suave","yumuşak"],"معتمد":["verified","verificado","onaylı"],"طلباً":["requested","solicitado","istenen"],"دفعات":["payments","pagos","ödemeler"],"يكتمل":["completes","se completa","tamamlanır"],"ألغيت":["canceled","cancelaste","iptal edildi"],"الغيت":["canceled","cancelaste","iptal edildi"],"كاملة":["full","completa","tam"],"تكبير":["zoom","ampliar","büyütme"],"أزرار":["buttons","botones","düğmeler"],"ازرار":["buttons","botones","düğmeler"],"أصلية":["original","original","orijinal"],"اصلية":["original","original","orijinal"],"أُعيد":["resent","reenviado","yeniden"],"كلمتا":["both passwords","ambas contraseñas","her iki şifre"],"مغامر":["adventurer","aventurero","maceracı"],"مكوّن":["composed","compuesto","oluşan"],"رتبتك":["your rank","tu rango","rütbeniz"],"عضواً":["a member","un miembro","bir üye"],"مقاطع":["clips","clips","klipler"],"سيظهر":["will appear","aparecerá","görünecek"],"توهجه":["its glow","su brillo","parıltısı"],"آخرين":["others","otros","başkaları"],"اخرين":["others","otros","başkaları"],"يبثون":["are broadcasting","transmiten","yayın yapıyorlar"],"أحدهم":["one of them","uno de ellos","birinin"],"احدهم":["one of them","uno de ellos","birinin"],"صورته":["his photo","su fotoğraf","fotoğrafına"],"بجانب":["beside","junto a","yanında"],"شهراً":["months","meses","ay"],"اهداء":["gifting","regalo","hediye"],"أسماء":["names","nombres","isimler"],"اسماء":["names","nombres","isimler"],"دقيقة":["minute","minuto","dakika"],"ينقصك":["you lack","te falta","eksik"],"تفاعل":["interaction","interacción","etkileşim"],"نظراً":["due","debido","nedeniyle"],"ترتيب":["order","orden","sıralama"],"مفصول":["disconnected","desconectado","ayrılmış"],"وفصله":["and disconnect him","y desconectarlo","ve ayırmak"],"إدخال":["entry","entrada","giriş"],"ادخال":["entry","entrada","giriş"],"ملفات":["files","archivos","dosyalar"],"عنابي":["maroon","granate","bordo"],"ليبدأ":["to start","para empezar","başlaması"],"ليبدا":["to start","para empezar","başlaması"],"ألعاب":["games","juegos","oyunlar"],"العاب":["games","juegos","oyunlar"],"أهلاً":["welcome","bienvenido","hoş geldiniz"],"تُرفع":["are uploaded","se suben","yüklenir"],"مكتبة":["library","biblioteca","kütüphane"],"توجيه":["guidance","orientación","yönlendirme"],"عاصمة":["capital","capital","başkent"],"نصيحة":["advice","consejo","tavsiye"],"سؤالك":["your question","tu pregunta","sorunuz"],"تفكير":["thinking","pensando","düşünüyor"],"اختره":["choose it","elígelo","seçin"],"فعّله":["activate it","actívalo","etkinleştir"],"نشرها":["publish it","publicarla","yayınlamak"],"ذهبية":["golden","dorada","altın"],"وصفاً":["description","una descripción","açıklama"],"نتائج":["results","resultados","sonuçlar"],"كتابي":["text","de texto","yazılı"],"وصوتي":["and audio","y de audio","ve sesli"],"مرفوض":["rejected","rechazado","reddedilmiş"],"يُدفع":["is paid","se paga","ödenir"],"سجلات":["logs","registros","kayıtlar"],"أدوات":["tools","herramientas","araçlar"],"ادوات":["tools","herramientas","araçlar"],"يُنشأ":["is created","se crea","oluşturulur"],"عودته":["his return","su regreso","dönüşü"],"سعودي":["Saudi","saudí","Sudi"],"كبديل":["as replacement","como reemplazo","yedek olarak"],"حقيقي":["real","real","gerçek"],"مبالغ":["amounts","montos","tutarlar"],"مشتري":["buyer","comprador","alıcı"],"إبقاء":["keeping","mantener","tutma"],"ابقاء":["keeping","mantener","tutma"],"مصرفي":["banking","bancaria","banka"],"إيداع":["deposit","depósito","yatırma"],"ايداع":["deposit","depósito","yatırma"],"آيبان":["IBAN","IBAN","IBAN"],"ايبان":["IBAN","IBAN","IBAN"],"ملفاً":["a file","un archivo","bir dosya"],"يُرفض":["is rejected","se rechaza","reddedilir"],"عدداً":["a number","un número","bir sayı"],"تُنشر":["is published","se publica","yayınlanır"],"مسافة":["space","espacio","boşluk"],"مساحة":["space","espacio","alan"],"يجعله":["makes it","lo hace","yapar"],"حجماً":["size","tamaño","boyut"],"تتغير":["change","cambian","değişir"],"قديمة":["old","antiguas","eski"],"توحيد":["unify","unificar","birleştirme"],"تُخصم":["are deducted","se descuentan","kesilir"],"مقابل":["for","a cambio de","karşılığında"],"وحساب":["and account","y cuenta","ve hesap"],"لرؤية":["to see","para ver","görmek"],"ويؤثر":["and affects","y afecta","ve etkiler"],"يُعاد":["is re-","se re-","yeniden"],"محتاج":["needing","necesitado","ihtiyaç"],"مخصصة":["dedicated","dedicadas","özel"],"مرئية":["visible","visibles","görünür"],"تُحفظ":["are saved","se guardan","kaydedilir"],"ماستر":["master","máster","usta"],"تُعرض":["are displayed","se muestran","görüntülenir"],"إبطال":["invalidating","invalidar","iptal"],"ابطال":["invalidating","invalidar","iptal"],"وجلسة":["and session","y sesión","ve oturum"],"إصلاح":["fix","reparar","onarma"],"اصلاح":["fix","reparar","onarma"],"مُعاد":["regenerated","regenerado","yeniden"],"تحليل":["analysis","análisis","analiz"],"نموذج":["model","modelo","model"],"حديثة":["recent","recientes","son"],"تختفي":["disappear","desaparecen","kaybolur"],"سيبدأ":["will start","comenzará","başlayacak"],"سيبدا":["will start","comenzará","başlayacak"],"بنفسك":["yourself","tú mismo","kendiniz"],"يستمر":["continues","continúa","devam eder"],"مجهول":["unknown","anónimo","gizli"],"قراءة":["reading","leer","okuma"],"سياسة":["policy","política","politika"],"دقائق":["minutes","minutos","dakika"],"يتطلب":["requires","requiere","gerektirir"],"تحتاج":["need","necesitas","ihtiyacın"],"لتنفق":["to spend","gastar","harcamak"],"جائزة":["prize","premio","ödül"],"مستلم":["recipient","destinatario","alan"],"لتبرز":["to stand out","para destacar","öne çıkmak"],"مرغوب":["desired","deseado","istenilen"],"أرسلت":["I sent","envié","gönderdim"],"ارسلت":["I sent","envié","gönderdim"],"ألوان":["colors","colores","renkler"],"الوان":["colors","colores","renkler"],"قوائم":["lists","listas","listeler"],"تبادل":["exchange","intercambio","değişim"],"أشخاص":["people","personas","insanlar"],"اشخاص":["people","personas","insanlar"],"طبيعة":["nature","naturaleza","doğa"],"ترميز":["encoding","codificación","kodlama"],"حماية":["protection","protección","koruma"],"مرسلي":["senders of","remitentes","gönderen"],"مجتمع":["community","comunidad","topluluk"],"نهائي":["final","final","son"],"تختار":["choose","eliges","seçersin"],"ترحيب":["welcome","bienvenida","karşılama"],"تُزال":["are removed","se eliminan","kaldırılır"],"اشترِ":["buy","compra","satın al"],"مميزة":["special","especiales","özel"],"وادفع":["and pay","y paga","ve öde"],"ومشفر":["and encrypted","y cifrado","ve şifreli"],"صحيحة":["correct","correctas","doğru"],"شكاوي":["complaints","quejas","şikayetler"],"إرفاق":["attach","adjuntar","ekleme"],"ارفاق":["attach","adjuntar","ekleme"],"استمع":["listen","escucha","dinle"],"أرسله":["send it","envíalo","gönder"],"ارسله":["send it","envíalo","gönder"],"احذفه":["delete it","bórralo","sil"],"طويلة":["long","largos","uzun"],"قصيرة":["short","corta","kısa"],"تالية":["next","siguiente","sonraki"],"سلوكك":["your behavior","tu comportamiento","davranışınız"],"تتمكن":["be able","puedas","yapabilirsin"],"لضمان":["to ensure","garantizar","sağlamak"],"انتقل":["go","ve","geç"],"إخفاء":["hide","ocultar","gizleme"],"اخفاء":["hide","ocultar","gizleme"],"نافذة":["window","ventana","pencere"],"تصغير":["shrink","reducir","küçültme"],"تبديل":["switch","cambiar","değiştirme"],"موضوع":["subject","asunto","konu"],"شكواك":["your complaint","tu queja","şikayetiniz"],"أوصاف":["descriptions","descripciones","açıklamalar"],"اوصاف":["descriptions","descripciones","açıklamalar"],"بنسبة":["with","con","%"],"خليجي":["Gulf","del Golfo","Körfez"],"شهرين":["two months","dos meses","iki ay"],"عادية":["normal","normal","normal"],"تولده":["generates it","la genera","onu üretir"],"صندوق":["box","caja","kutu"],"مجاني":["free","gratis","ücretsiz"],"جواهر":["gems","gemas","cevherler"],"مبلغ":["reported","reportado","bildirilmiş"],"مولد":["generator","generador","üretici"],"مفعل":["enabled","activado","etkin"],"تفعل":["is activated","se activa","etkinleştirilir"],"مرسل":["sender","remitente","gönderen"],"اولا":["first","primero","önce"],"فورا":["immediately","inmediatamente","hemen"],"حسنا":["OK","de acuerdo","tamam"],"تحذف":["are deleted","se eliminan","silinir"],"رقما":["digits","dígitos","rakam"],"يشحن":["is credited","se acredita","yüklenir"],"يخصم":["is deducted","se descuenta","kesilir"],"يرسل":["is sent","se envía","gönderilir"],"يحلق":["soars","planea","savar"],"طلبا":["requested","solicitado","istenen"],"اعيد":["resent","reenviado","yeniden"],"مكون":["composed","compuesto","oluşan"],"عضوا":["a member","un miembro","bir üye"],"شهرا":["months","meses","ay"],"نظرا":["due","debido","nedeniyle"],"اهلا":["welcome","bienvenido","hoş geldiniz"],"ترفع":["are uploaded","se suben","yüklenir"],"فعله":["activate it","actívalo","etkinleştir"],"وصفا":["description","una descripción","açıklama"],"يدفع":["is paid","se paga","ödenir"],"ينشا":["is created","se crea","oluşturulur"],"ملفا":["a file","un archivo","bir dosya"],"يرفض":["is rejected","se rechaza","reddedilir"],"عددا":["a number","un número","bir sayı"],"تنشر":["is published","se publica","yayınlanır"],"حجما":["size","tamaño","boyut"],"تخصم":["are deducted","se descuentan","kesilir"],"يعاد":["is re-","se re-","yeniden"],"تحفظ":["are saved","se guardan","kaydedilir"],"تعرض":["are displayed","se muestran","görüntülenir"],"معاد":["regenerated","regenerado","yeniden"],"تزال":["are removed","se eliminan","kaldırılır"],"اشتر":["buy","compra","satın al"],"نجوم":["stars","estrellas","yıldızlar"],"مهلة":["timeout","tiempo agotado","zaman aşımı"],"فذلك":["that is","eso es","bu"],"موضع":["position","posición","konum"],"تعذر":["failed to","no se pudo","başarısız"],"دخول":["login","inicio de sesión","giriş"],"حساب":["account","cuenta","hesap"],"غرفة":["room","sala","oda"],"صورة":["photo","foto","fotoğraf"],"ملكي":["royal","real","kraliyet"],"جاري":["loading","cargando","yükleniyor"],"جارٍ":["loading","cargando","yükleniyor"],"كلمة":["word","palabra","kelime"],"هدية":["gift","regalo","hediye"],"مرور":["passing","paso","geçiş"],"اكتب":["type","escribe","yaz"],"خاصة":["private","privado","özel"],"حالة":["status","estado","durum"],"رصيد":["balance","saldo","bakiye"],"بريد":["email","correo","e-posta"],"مثال":["example","ejemplo","örnek"],"اضغط":["press","pulsa","basın"],"لوحة":["panel","panel","panel"],"رابط":["link","enlace","bağlantı"],"أدخل":["enter","introduce","girin"],"ادخل":["enter","introduce","girin"],"مسار":["path","ruta","yol"],"أخرى":["other","otra","diğer"],"اخرى":["other","otra","diğer"],"جميع":["all","todos","tüm"],"توجد":["exist","hay","var"],"مسجل":["registered","registrado","kayıtlı"],"تحقق":["check","verifica","kontrol"],"كمية":["quantity","cantidad","miktar"],"صوتي":["audio","de audio","sesli"],"اختر":["choose","elige","seç"],"مقطع":["clip","clip","klip"],"متصل":["connected","conectado","bağlı"],"داخل":["inside","dentro de","içinde"],"جهاز":["device","dispositivo","cihaz"],"يرجى":["please","por favor","lütfen"],"انقر":["click","haz clic","tıklayın"],"يظهر":["appears","aparece","görünür"],"خروج":["exit","salir","çıkış"],"جديد":["new","nuevo","yeni"],"يوجد":["there is","hay","var"],"كامل":["full","completo","tam"],"صفحة":["page","página","sayfa"],"حائط":["wall","muro","duvar"],"لديك":["you have","tienes","sizde"],"يمكن":["can","se puede","olabilir"],"تملك":["own","poseer","sahip"],"مايك":["mic","micrófono","mikrofon"],"نظام":["system","sistema","sistem"],"دولة":["country","país","ülke"],"شارة":["badge","insignia","rozet"],"زائر":["visitor","visitante","ziyaretçi"],"شعار":["logo","logo","logo"],"عودة":["return","volver","dönüş"],"ساعة":["hour","hora","saat"],"يكون":["be","ser","olmak"],"تريد":["want","quieres","istiyorsunuz"],"وردة":["rose","rosa","gül"],"حاول":["try","intenta","deneyin"],"شكوى":["complaint","queja","şikayet"],"بقاء":["staying","permanecer","kalma"],"جلسة":["session","sesión","oturum"],"قيمة":["value","valor","değer"],"بدون":["without","sin","olmadan"],"ابحث":["search","busca","ara"],"مخفي":["hidden","oculto","gizli"],"صعود":["joining","subir","katılma"],"نكات":["nicknames","apodos","takma adlar"],"متاح":["available","disponible","mevcut"],"وصول":["access","acceso","erişim"],"مميز":["premium","premium","premium"],"طلبك":["your request","tu solicitud","isteğiniz"],"اسمك":["your name","tu nombre","adınız"],"مشغل":["player","reproductor","oynatıcı"],"تحكم":["control","control","kontrol"],"بثوث":["broadcasts","transmisiones","yayınlar"],"ميزة":["feature","ventaja","özellik"],"باسم":["with name","con nombre","isimle"],"عربي":["Arabic","árabe","Arapça"],"ذكاء":["intelligence","inteligencia","zeka"],"حالي":["current","actual","mevcut"],"بشكل":["in a","de manera","şekilde"],"عامة":["public","públicas","genel"],"شخصي":["personal","personal","kişisel"],"نبذة":["bio","biografía","hakkında"],"يدعم":["supports","soporta","destekler"],"جودة":["quality","calidad","kalite"],"صورك":["your photos","tus fotos","fotoğraflarınız"],"لمدة":["for","durante","süre"],"بنكي":["bank","bancario","banka"],"تكون":["be","ser","olmak"],"تميز":["distinction","distinción","ayrıcalık"],"فريد":["unique","único","benzersiz"],"توهج":["glow","brillo","parıltı"],"ذهبي":["golden","dorado","altın"],"شراء":["purchase","compra","satın alma"],"أصلي":["original","original","orijinal"],"اصلي":["original","original","orijinal"],"وأنت":["while you","mientras tú","ve sen"],"وانت":["while you","mientras tú","ve sen"],"تقوم":["are doing","estás","yapıyorsun"],"سوبر":["super","súper","süper"],"تحدث":["talk","habla","konuş"],"أرسل":["send","envía","gönder"],"ارسل":["send","envía","gönder"],"أدنى":["minimum","mínimo","en az"],"ادنى":["minimum","mínimo","en az"],"شروط":["terms","términos","şartlar"],"موقع":["site","sitio","site"],"يعمل":["works","funciona","çalışır"],"أردن":["Jordan","Jordania","Ürdün"],"اردن":["Jordan","Jordania","Ürdün"],"خادم":["server","servidor","sunucu"],"يربح":["earns","gana","kazanır"],"تظهر":["appear","aparecen","görünür"],"بكسل":["pixels","píxeles","piksel"],"قوية":["strong","fuerte","güçlü"],"يبقى":["remains","permanece","kalır"],"ومنع":["and block","y bloquear","ve engelleme"],"صوره":["his photo","su foto","fotoğrafı"],"بسبب":["because of","debido a","nedeniyle"],"كافٍ":["sufficient","suficiente","yeterli"],"مكبر":["amplified","amplificado","yükseltilmiş"],"دفعة":["payment","pago","ödeme"],"عليه":["it","él","ona"],"صحيح":["correct","correcto","doğru"],"حددي":["specify","especifica","belirleyin"],"يدخل":["enters","entra","girer"],"عقاب":["eagle","águila","kartal"],"وحيد":["unicorn","unicornio","tek boynuz"],"بنات":["girls","chicas","kızlar"],"يحمل":["carries","lleva","taşır"],"قبول":["accept","aceptar","kabul"],"أسفل":["bottom","abajo","alt"],"اسفل":["bottom","abajo","alt"],"خدمة":["service","servicio","hizmet"],"وجود":["presence","presencia","bulunma"],"معاً":["together","juntos","birlikte"],"أدمن":["admin","admin","yönetici"],"ادمن":["admin","admin","yönetici"],"جداً":["very","muy","çok"],"رسوم":["fees","tarifas","ücret"],"أغلق":["close","cierra","kapat"],"اغلق":["close","cierra","kapat"],"وافق":["approved","aprobó","onayladı"],"أشهر":["months","meses","ay"],"اشهر":["months","meses","ay"],"لهذا":["for this","para esto","bunun için"],"سيتم":["will be","se","yapılacak"],"محدد":["specified","especificado","belirli"],"بقية":["rest","resto","kalan"],"تتبع":["tracking","seguimiento","takip"],"مخصص":["custom","personalizado","özel"],"نغمة":["tone","tono","melodi"],"مالك":["owner","propietario","sahip"],"مرفق":["attached","adjunto","ekli"],"عادي":["normal","normal","normal"],"وفصل":["and disconnect","y desconectar","ve ayırma"],"أنثى":["female","mujer","kadın"],"انثى":["female","mujer","kadın"],"أفضل":["best","mejor","en iyi"],"افضل":["best","mejor","en iyi"],"ظاهر":["visible","visible","görünür"],"صالح":["valid","válido","geçerli"],"مزود":["provider","proveedor","sağlayıcı"],"عصبي":["neural","neuronal","sinir"],"منفذ":["endpoint","endpoint","uç nokta"],"وشحن":["and recharge","y recargar","ve yükleme"],"سيصل":["will arrive","llegará","gelecek"],"أولا":["first","primero","önce"],"شات1":["chat1","chat1","chat1"],"مصدر":["source","fuente","kaynak"],"بهذا":["with this","con esto","bununla"],"جنيه":["pound","libra","sterlin"],"باقة":["package","paquete","paket"],"متجر":["store","tienda","mağaza"],"مشهد":["scene","escena","sahne"],"شاشة":["screen","pantalla","ekran"],"احصل":["get","obtén","al"],"نقبل":["accept","aceptamos","kabul ederiz"],"وبعد":["and after","y después","ve sonra"],"فيزا":["Visa","Visa","Visa"],"زوار":["visitors","visitantes","ziyaretçiler"],"سمحت":["allowed","permitiste","izin verdin"],"عمان":["Oman","Omán","Umman"],"مغرب":["Morocco","Marruecos","Fas"],"تونس":["Tunisia","Túnez","Tunus"],"عليك":["on you","en ti","sizde"],"بنشر":["publishing","publicar","yayınlamaya"],"قيام":["doing","realizar","yapma"],"صاحب":["owner","titular","sahibi"],"مراد":["intended","deseado","amaçlanan"],"وفتح":["and open","y abrir","ve açma"],"هادر":["roaring","rugiente","kükreyen"],"يبحر":["sails","navega","yüzer"],"ملوك":["kings","reyes","krallar"],"حرية":["freedom","libertad","özgürlük"],"وقوة":["and power","y fuerza","ve güç"],"يسطع":["shines","brilla","parlar"],"دخلت":["entered","entró","girdi"],"رقيّ":["elegance","refinamiento","zarafet"],"لطيف":["cute","tierno","sevimli"],"يخطف":["steals hearts","roba","çalar"],"قلوب":["hearts","corazones","kalpler"],"تدخل":["enter","entras","girersin"],"جمال":["beauty","belleza","güzellik"],"حضور":["presence","presencia","hediye Varlığı"],"يليق":["befits","le queda","yakışır"],"ظهرت":["appeared","apareció","göründü"],"أكثر":["more","más","daha"],"اكثر":["more","más","daha"],"مقيد":["restricted","restringido","kısıtlı"],"تنجح":["succeeds","tiene éxito","başarılı"],"عارض":["viewer","visor","görüntüleyici"],"لعرض":["to display","mostrar","göstermek"],"عاشق":["lover","amor","aşık"],"أهلا":["welcome","bienvenido","hoş geldiniz"],"قالب":["template","plantilla","şablon"],"قصير":["too short","demasiado corto","çok kısa"],"مُنح":["granted","concedido","verildi"],"لبثه":["to his stream","su transmisión","yayınına"],"يريد":["wants","quiere","istiyor"],"يطلب":["requests","solicita","istiyor"],"عندك":["from you","de ti","senden"],"ترغب":["wish","deseas","isterseniz"],"أولى":["first","primera","ilk"],"اولى":["first","primera","ilk"],"لأول":["for the first","para la primera","ilk"],"لاول":["for the first","para la primera","ilk"],"معدل":["rate","tasa","oran"],"يدوي":["manual","manual","manuel"],"لفتح":["to open","abrir","açmak"],"مزيد":["more","más","daha"],"وحذف":["and delete","y eliminar","ve silme"],"قادم":["coming","entrante","gelen"],"إليه":["to it","a él","-e"],"اليه":["to it","a él","-e"],"لأنه":["because","porque","-dığı için"],"لانه":["because","porque","-dığı için"],"وغير":["and other","y otros","ve diğer"],"وظهر":["and appeared","y apareció","ve göründü"],"ورفع":["and upload","y subir","ve yükleme"],"وحفظ":["and save","y guardar","ve kaydetme"],"وأنه":["that it","que","-dığını"],"وانه":["that it","que","-dığını"],"بدقة":["accurately","con precisión","hassas"],"مشرف":["moderator","moderador","moderatör"],"رفيق":["companion","compañero","arkadaş"],"أحمد":["Ahmed","Ahmed","Ahmed"],"احمد":["Ahmed","Ahmed","Ahmed"],"صامت":["silent","silencioso","sessiz"],"شحنه":["recharge it","recargarlo","yüklemek"],"خصمه":["deducting it","descontarlo","kesmek"],"وخصم":["and deduct","y descontar","ve kesinti"],"نشطة":["active","activas","aktif"],"حُذف":["was deleted","fue eliminado","silindi"],"مؤقت":["temporary","temporal","geçici"],"لمنع":["to prevent","para evitar","engellemek"],"يفصل":["disconnects","desconecta","ayırr"],"ريال":["riyal","rial","riyal"],"درهم":["dirham","dírham","dirhem"],"مصري":["Egyptian","egipcio","Mısır"],"وآمن":["and safe","y seguro","ve güvenli"],"وامن":["and safe","y seguro","ve güvenli"],"يورو":["euro","euro","euro"],"مرجع":["reference","referencia","referans"],"ارفع":["upload","sube","yükleyin"],"ميجا":["MB","MB","MB"],"أقصى":["maximum","máximo","en fazla"],"اقصى":["maximum","máximo","en fazla"],"فوري":["instant","instantáneo","anlık"],"تعطل":["crash","falla","ariza"],"فاصل":["interval","intervalo","aralık"],"مظهر":["appearance","apariencia","görünüm"],"وحجم":["and size","y tamaño","ve boyut"],"بطول":["with length","con longitud","uzunluk"],"يمدد":["extends","extiende","uzatır"],"ووضع":["and place","y colocar","ve koyma"],"منها":["of them","de ellos","-den"],"ظهور":["appearance","aparición","görünme"],"يجعل":["makes","hace","yapar"],"كانت":["was","estaba","idi"],"تحدد":["determines","determina","belirler"],"تدفع":["pay","paga","öder"],"يزيل":["removes","elimina","kaldırır"],"سطور":["lines","líneas","satır"],"سناب":["snap","snap","snap"],"لأنك":["because you","porque","-dığınız için"],"لانك":["because you","porque","-dığınız için"],"بعمل":["doing","hacer","yapmaktan"],"شامل":["comprehensive","integral","kapsamlı"],"شاهد":["watch","ve","izle"],"مذيع":["broadcaster","locutor","yayıncı"],"تعمل":["work","funcionan","çalışır"],"نسيت":["forgot","olvidaste","unuttum"],"رجاء":["please","por favor","lütfen"],"يصلك":["you receive","te llega","sana ulaşır"],"مجلد":["folder","carpeta","klasör"],"يحصل":["gets","obtiene","alır"],"حشود":["crowds","multitudes","kalabalık"],"بينك":["between you","contigo","aranızda"],"وبين":["and between","y entre","ve arasında"],"خارج":["outside","fuera","dışında"],"مكتب":["desk","escritorio","masa"],"لبدء":["to start","para empezar","başlamak"],"يشبه":["resembles","se parece","benzer"],"اجعل":["make","hazır","yap"],"دائم":["permanent","permanente","kalıcı"],"لشحن":["to recharge","para recargar","yüklemek"],"دليل":["guide","guía","rehber"],"أحرف":["characters","caracteres","karakter"],"احرف":["characters","caracteres","karakter"],"حظرك":["your ban","tu bloqueo","yasak"],"سلوك":["behavior","comportamiento","davranış"],"أمان":["safety","seguridad","güvenlik"],"امان":["safety","seguridad","güvenlik"],"غيّر":["change","cambia","değiştir"],"وعُد":["and return","y vuelve","ve dön"],"غرفك":["your rooms","tus salas","odaların"],"نزول":["scrolling","bajar","inme"],"لآخر":["to the last","al último","son"],"لاخر":["to the last","al último","son"],"اسحب":["drag","arrastra","sürükle"],"رياض":["Riyadh","Riad","Riyad"],"جوال":["mobile","móvil","mobil"],"سريع":["fast","rápido","hızlı"],"راقي":["classy","elegante","şık"],"تعبر":["cross","atraviesa","geçer"],"التي":["which","que","-diği"],"سابق":["previous","anterior","önceki"],"تالي":["next","siguiente","sonraki"],"خيار":["option","opción","seçenek"],"شريط":["bar","barra","şerit"],"يرفع":["uploads","sube","yükler"],"تمنع":["are prevented","se impiden","engellenir"],"يمنع":["is prevented","se impide","engellenir"],"فائق":["super","súper","süper"],"سؤال":["question","pregunta","soru"],"سرعة":["speed","velocidad","hız"],"جار":["loading","cargando","yükleniyor"],"كاف":["sufficient","suficiente","yeterli"],"معا":["together","juntos","birlikte"],"جدا":["very","muy","çok"],"رقي":["elegance","refinamiento","zarafet"],"منح":["granted","concedido","verildi"],"حذف":["was deleted","fue eliminado","silindi"],"غير":["change","cambia","değiştir"],"وعد":["and return","y vuelve","ve dön"],"أمس":["yesterday","ayer","dün"],"امس":["yesterday","ayer","dün"],"عكس":["reverse","inverso","ters"],"منه":["from him","de él","ondan"],"كان":["was","era","idi"],"إلى":["to","a","-ye"],"الى":["to","a","-ye"],"ذهب":["gold","oro","altın"],"رفع":["upload","subir","yükleme"],"اسم":["name","nombre","isim"],"حظر":["ban","bloqueo","yasaklama"],"على":["on","en","-de"],"طلب":["request","solicitud","istek"],"حفظ":["save","guardar","kaydet"],"رمز":["code","código","kod"],"عام":["public","público","genel"],"هذه":["this","esta","bu"],"دفع":["payment","pago","ödeme"],"عند":["at","en","-de"],"كتم":["mute","silenciar","susturma"],"ملف":["file","archivo","dosya"],"فقط":["only","solo","sadece"],"شات":["chat","chat","sohbet"],"بعد":["after","después de","sonra"],"صوت":["voice","voz","ses"],"يجب":["must","debes","gerekir"],"بحث":["search","búsqueda","arama"],"هذا":["this","este","bu"],"فتح":["open","abrir","açma"],"لها":["it","ella","ona"],"غرف":["rooms","salas","odalar"],"آخر":["last","último","son"],"اخر":["last","último","son"],"تمت":["was","se","yapıldı"],"يتم":["is done","se realiza","yapılır"],"خصم":["deduction","descuento","kesinti"],"صور":["photos","fotos","fotoğraflar"],"رفض":["reject","rechazar","reddetme"],"عرض":["display","mostrar","gösterim"],"وقت":["time","hora","zaman"],"هنا":["here","aquí","burada"],"سحب":["withdraw","retirar","çekme"],"خاص":["private","privado","özel"],"نشر":["publish","publicar","yayınlama"],"قبل":["before","antes de","önce"],"فحص":["check","revisar","kontrol"],"حجم":["size","tamaño","boyut"],"بدء":["start","iniciar","başlatma"],"رقم":["number","número","numara"],"عدد":["number of","número de","sayı"],"عضو":["member","miembro","üye"],"وضع":["mode","modo","mod"],"عبر":["via","vía","üzerinden"],"طرد":["kick","expulsar","atma"],"شحن":["recharge","recarga","yükleme"],"قيد":["under","en","altında"],"حتى":["until","hasta","-e kadar"],"أنت":["you","tú","sen"],"انت":["you","tú","sen"],"فشل":["failure","fallo","başarısızlık"],"نفس":["same","mismo","aynı"],"عرب":["Arab","árabe","Arap"],"كشف":["reveal","revelar","ifşa"],"نوع":["type","tipo","tür"],"إلا":["except","excepto","hariç"],"الا":["except","excepto","hariç"],"دخل":["entered","entró","girdi"],"تاج":["crown","corona","taç"],"آمن":["safe","seguro","güvenli"],"امن":["safe","seguro","güvenli"],"وبث":["and broadcast","y transmisión","ve yayın"],"سبب":["reason","razón","neden"],"حسب":["by","según","göre"],"طرف":["party","parte","taraf"],"منع":["prevent","prevenir","engelleme"],"أذن":["ear","oído","kulak"],"اذن":["ear","oído","kulak"],"سري":["secret","secreto","gizli"],"ولن":["and will not","y no","ve olmayacak"],"أسد":["lion","león","aslan"],"اسد":["lion","león","aslan"],"لدى":["at","en","-de"],"خطأ":["error","error","hata"],"خطا":["error","error","hata"],"أقل":["less","menos","az"],"اقل":["less","menos","az"],"ضغط":["pressing","pulsar","basma"],"مرة":["time","vez","kez"],"لكل":["per","por","başına"],"نمط":["style","estilo","stil"],"شخص":["person","persona","kişi"],"بين":["between","entre","arasında"],"سيو":["SEO","SEO","SEO"],"يوم":["day","día","gün"],"شيء":["thing","cosa","şey"],"يبث":["broadcasts","transmite","yayınlar"],"مدة":["duration","duración","süre"],"إذن":["permission","permiso","izin"],"آلي":["automated","automático","otomatik"],"الي":["automated","automático","otomatik"],"باي":["Pay","Pay","Pay"],"بال":["Pal","Pal","Pal"],"فور":["immediately","inmediatamente","hemen"],"ليس":["not","no","değil"],"حوت":["whale","ballena","balina"],"قرن":["horn","cuerno","boynuz"],"بنك":["bank","banco","banka"],"ولا":["or nor","ni","veya"],"حدث":["occurred","ocurrió","oldu"],"نشط":["active","activo","aktif"],"لون":["color","color","renk"],"خطك":["your font","tu fuente","yazı tipiniz"],"بثه":["his stream","su transmisión","yayını"],"قام":["did","hizo","yaptı"],"الـ":["the","el","-"],"بلا":["without","sin","olmadan"],"عمر":["age","edad","yaş"],"ذكر":["male","hombre","erkek"],"نعم":["yes","sí","evet"],"حقل":["field","campo","alan"],"أنه":["that it","que","-dığı"],"انه":["that it","que","-dığı"],"بكم":["how many","cuántos","kaç"],"عقل":["brain","cerebro","beyin"],"وصف":["description","descripción","açıklama"],"حدد":["specify","especifica","belirleyin"],"قسم":["section","sección","bölüm"],"إذا":["if","si","-se"],"اذا":["if","si","-se"],"سعر":["price","precio","fiyat"],"قطع":["cut","cortar","kesme"],"فيه":["in it","en él","-de"],"عنه":["about it","sobre él","hakkında"],"لغة":["language","idioma","dil"],"ظهر":["appeared","apareció","göründü"],"يصل":["arrives","llega","ulaşır"],"سيئ":["bad","malo","kötü"],"قطر":["Qatar","Qatar","Katar"],"يمن":["Yemen","Yemen","Yemen"],"ضعف":["weak","débil","zayıf"],"قوة":["power","fuerza","güç"],"عمق":["depth","profundidad","derinlik"],"فوق":["above","sobre","üzerinde"],"قوس":["rainbow","arco","kuşak"],"قزح":["rainbow","iris","gökkuşağı"],"قطة":["cat","gato","kedi"],"سحر":["charm","encanto","büyü"],"عمل":["business","negocio","iş"],"ولم":["and did not","y no","ve olmadı"],"ألا":["not","no","-memesi"],"ضيف":["guest","invitado","misafir"],"نجم":["star","estrella","yıldız"],"همس":["whisper","susurro","fısıltı"],"شهم":["brave","valiente","yiğit"],"ذوق":["tasteful","elegante","zarif"],"تقل":["less than","menos de","az"],"رجع":["reverted","volvió","geri döndü"],"سنة":["year","año","yıl"],"جنس":["gender","género","cinsiyet"],"كما":["as","como","olarak"],"رصد":["monitoring","monitoreo","izleme"],"أين":["where","dónde","nerede"],"اين":["where","dónde","nerede"],"أما":["as for","en cuanto","-se"],"اما":["as for","en cuanto","-se"],"عدة":["several","varios","birkaç"],"جلد":["skin","skin","kaplama"],"ضبط":["tune","ajustar","ayar"],"صحة":["correctness","corrección","doğruluk"],"وكم":["and how much","y cuánto","ve kaç"],"علي":["on","sobre","-e"],"بوت":["bot","bot","bot"],"ذكي":["smart","inteligente","akıllı"],"زمن":["time","tiempo","süre"],"سجل":["record","registro","kayıt"],"بدل":["instead of","en lugar de","yerine"],"لهم":["for them","para ellos","onlar"],"جسم":["body","cuerpo","gövde"],"طول":["length","longitud","uzunluk"],"قدر":["as much","tanto","kadar"],"رتب":["ranks","rangos","rütbe"],"مثل":["like","como","gibi"],"مسح":["clear","borrar","temizleme"],"لست":["are not","no eres","değilsiniz"],"قمت":["did","hiciste","yaptınız"],"طبق":["exact","exacto","birebir"],"أصل":["original","original","orijinal"],"اصل":["original","original","orijinal"],"احد":["one","uno","bir"],"لدي":["I have","tengo","bende"],"وإن":["and if","y si","ve"],"وان":["and if","y si","ve"],"كنت":["you were","estabas","-dıysanız"],"تبث":["broadcast","transmites","yayın"],"فكل":["so all","así que todo","yani her şey"],"أحد":["one","uno","bir"],"غاء":["cancel","cancelar","iptal"],"أضف":["add","añade","ekle"],"اضف":["add","añade","ekle"],"سطح":["desktop","escritorio","masaüstü"],"احم":["protect","protege","koru"],"ثقة":["trust","confianza","güven"],"يثق":["trusts","confía","güvenir"],"وكن":["and be","y sé","ve ol"],"كلا":["both","ambos","her ikisi"],"حرف":["character","carácter","karakter"],"بفك":["to lift","levantar","kaldırmak"],"تكن":["be","seas","ol"],"يظل":["remains","permanece","kalır"],"أسم":["name","nombre","isim"],"شهر":["month","mes","ay"],"mp3":["mp3","mp3","mp3"],"aac":["aac","aac","aac"],"ال":["the","el","-"],"بك":["you","ti","size"],"تم":["was","se","yapıldı"],"من":["from","de","-den"],"لا":["no","no","hayır"],"في":["in","en","-de"],"أو":["or","o","veya"],"او":["or","o","veya"],"بث":["broadcast","transmisión","yayın"],"مع":["with","con","ile"],"آن":["now","ahora","şimdi"],"ان":["now","ahora","şimdi"],"لم":["did not","no","değil"],"أي":["any","cualquier","herhangi"],"اي":["any","cualquier","herhangi"],"عن":["about","sobre","hakkında"],"ثم":["then","luego","sonra"],"أن":["that","que","-dığı"],"فك":["lift","levantar","kaldırma"],"هل":["do","¿","mi"],"كل":["all","todo","her"],"لن":["will not","no","-mayacak"],"حد":["limit","límite","sınır"],"نص":["text","texto","metin"],"ذي":["the","el","-"],"رد":["reply","responder","yanıt"],"زر":["button","botón","düğme"],"بـ":["with","con","ile"],"لك":["for you","para ti","senin"],"هي":["is","es","dir"],"ما":["what","qué","ne"],"إن":["if","si","-se"],"خط":["font","fuente","yazı tipi"],"لـ":["to","a","-e"],"قد":["may","puede","-ebilir"],"به":["in it","en él","-de"],"له":["for him","para él","için"],"حي":["neighborhood","barrio","mahalle"],"خذ":["take","toma","al"],"سر":["password","secreto","gizli"],"قم":["do","haz","yap"],"حل":["resolve","resolver","çözüm"],"ضع":["put","colocar","koy"],"كم":["how much","cuánto","ne kadar"],"لل":["for the","para el","için"],"كـ":["as","como","olarak"],"يا":["oh","oh","ey"],"ب":["with","con","ile"],"ل":["to","a","-e"],"ك":["as","como","olarak"]};
const I18N_FALLBACK_RE = new RegExp('(\u0648\u0627\u0644|\u0628\u0627\u0644|\u0641\u0627\u0644|\u0643\u0627\u0644|\u0644\u0644|\u0627\u0644|\u0648|\u0628|\u0644|\u0641)?(' + Object.keys(I18N_FALLBACK).map(k => k.replace(/[.*+?^${}()|[]\]/g, '\\$&')).join('|') + ')', 'g');
function i18nFallback(text, lang) {
  const idx = lang === 'es' ? 1 : (lang === 'tr' ? 2 : 0);
  const isAr = c => c && /[\u0621-\u065F\u0670-\u06D3]/.test(c);
  const norm = x => String(x).replace(/[\u064B-\u0652\u0670\u0640]/g, '').replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627');
  const PRE = { '\u0627\u0644': { 0: 'the ', 1: 'el ', 2: '' }, '\u0648\u0627\u0644': { 0: 'and the ', 1: 'y el ', 2: '' }, '\u0628\u0627\u0644': { 0: 'with the ', 1: 'con el ', 2: '' }, '\u0641\u0627\u0644': { 0: 'then the ', 1: 'entonces el ', 2: '' }, '\u0643\u0627\u0644': { 0: 'like the ', 1: 'como el ', 2: '' }, '\u0644\u0644': { 0: 'for the ', 1: 'para el ', 2: '' }, '\u0648': { 0: 'and ', 1: 'y ', 2: 've ' }, '\u0628': { 0: 'with ', 1: 'con ', 2: 'ile ' }, '\u0644': { 0: 'for ', 1: 'para ', 2: 'i\u00e7in ' }, '\u0641': { 0: 'then ', 1: 'entonces ', 2: 'o zaman ' } };
  const lookup = k => I18N_FALLBACK[k] || I18N_FALLBACK[norm(k)] || I18N_FALLBACK[String(k).replace(/\u0629$/, '\u0647')];
  return String(text).replace(I18N_FALLBACK_RE, (m, ...rest) => {
    const full = rest[rest.length - 1];
    const off = rest[rest.length - 2];
    const before = off > 0 ? full[off - 1] : '';
    const after = off + m.length < full.length ? full[off + m.length] : '';
    if (isAr(before) || isAr(after)) return m;
    for (const pre of ['\u0648\u0627\u0644', '\u0628\u0627\u0644', '\u0641\u0627\u0644', '\u0643\u0627\u0644', '\u0644\u0644', '\u0627\u0644', '\u0648', '\u0628', '\u0644', '\u0641']) {
      if (m.startsWith(pre) && m.length > pre.length) {
        const base = lookup(m.slice(pre.length));
        if (base) return PRE[pre][idx] + base[idx];
      }
    }
    const tr = lookup(m);
    return tr ? tr[idx] : m;
  });
}

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

  return i18nFallback(text, lang);
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

// ---------- قالب تجاوز الحد الأقصى لأحرف الرسالة ----------
function hideMessageLengthTemplate() {
  const overlay = $('#messageLengthOverlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  const input = $('#msgInput');
  if (input) input.focus();
}
function showMessageLengthTemplate(payload = {}) {
  hideSlowDownTemplate();
  const maxLength = Math.max(1, +payload.max_length || +(SETTINGS.msg_max || 500));
  const attemptedText = String(payload.attempted_text || '');
  const actualLength = Math.max(0, +payload.actual_length || Array.from(attemptedText).length);
  const input = $('#msgInput');
  if (input && attemptedText && CUR_ROOM && (!payload.room_id || +CUR_ROOM.id === +payload.room_id)) input.value = attemptedText;
  $('#messageLengthMax').textContent = String(maxLength);
  $('#messageLengthLimit').textContent = String(maxLength);
  $('#messageLengthActual').textContent = String(actualLength);
  const overlay = $('#messageLengthOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
}
const messageLengthEditButton = $('#messageLengthEdit');
if (messageLengthEditButton) messageLengthEditButton.onclick = hideMessageLengthTemplate;

// ---------- قالب الفاصل الزمني بين رسائل العام ----------
let SLOW_DOWN_TIMER = null;
function hideSlowDownTemplate() {
  if (SLOW_DOWN_TIMER) clearInterval(SLOW_DOWN_TIMER);
  SLOW_DOWN_TIMER = null;
  const overlay = $('#slowDownOverlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
}
function showSlowDownTemplate(payload = {}) {
  const retryAfterMs = Math.max(100, +payload.retry_after_ms || 1000);
  const totalMs = Math.max(retryAfterMs, (+payload.cooldown_seconds || 1) * 1000);
  const deadline = Date.now() + retryAfterMs;
  const overlay = $('#slowDownOverlay');
  if (!overlay) return;

  // لأن حقل الكتابة يُفرغ عند الضغط على إرسال، نعيد الرسالة المرفوضة كي لا تضيع.
  const input = $('#msgInput');
  if (input && !input.value && payload.attempted_text && CUR_ROOM && +CUR_ROOM.id === +payload.room_id) {
    input.value = String(payload.attempted_text).slice(0, 500);
  }

  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  if (SLOW_DOWN_TIMER) clearInterval(SLOW_DOWN_TIMER);
  const update = () => {
    const remaining = Math.max(0, deadline - Date.now());
    const seconds = Math.max(0, Math.ceil(remaining / 1000));
    const counter = $('#slowDownSeconds');
    const progress = $('#slowDownProgress');
    if (counter) counter.textContent = String(seconds);
    if (progress) progress.style.width = `${Math.min(100, Math.max(0, (remaining / totalMs) * 100))}%`;
    if (remaining <= 0) hideSlowDownTemplate();
  };
  update();
  SLOW_DOWN_TIMER = setInterval(update, 100);
}

// ---------- قالب الحظر الدائم ----------
let PERSISTENT_BAN_ACTIVE = false;
function showPersistentBanTemplate(reason = '') {
  PERSISTENT_BAN_ACTIVE = true;
  hideMessageLengthTemplate();
  hideSlowDownTemplate();
  CHAT_TOKEN = '';
  CONNECTION_INTERRUPTED = false;
  if (SOCKET) {
    const blockedSocket = SOCKET;
    SOCKET = null;
    try { blockedSocket.disconnect(); } catch (error) { }
  }
  const overlay = $('#persistentBanOverlay');
  if (!overlay) return;
  const reasonBox = $('#persistentBanReason');
  if (reasonBox) reasonBox.textContent = String(reason || 'سلوك سيئ داخل الدردشة').slice(0, 150);
  document.body.classList.add('persistent-banned');
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
}
async function recheckPersistentBan() {
  const button = $('#persistentBanRecheck');
  if (button) button.disabled = true;
  try {
    const response = await trackedFetch('/api/ban-status', { credentials: 'same-origin', cache: 'no-store' });
    const state = await response.json().catch(() => ({}));
    if (!state.banned) { REFRESH_LEAVING = true; return location.reload(); }
    showPersistentBanTemplate(state.reason || state.error);
  } catch (error) { }
  finally { if (button) button.disabled = false; }
}
const persistentBanRecheckButton = $('#persistentBanRecheck');
if (persistentBanRecheckButton) persistentBanRecheckButton.onclick = recheckPersistentBan;

// ---------- قالب «تم الدخول من جهاز آخر» ----------
function showSessionConflictTemplate(text = '') {
  hideMessageLengthTemplate();
  hideSlowDownTemplate();
  CHAT_TOKEN = '';
  CONNECTION_INTERRUPTED = false;
  if (SOCKET) {
    const oldSocket = SOCKET;
    SOCKET = null;
    try { oldSocket.disconnect(); } catch (error) { }
  }
  if (ME) ME = null; MYBADGE = 'guest.png';
  const overlay = $('#sessionConflictOv');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('persistent-banned');   // يمنع التفاعل مع خلفية الدردشة
  }
  const note = overlay && overlay.querySelector('.session-conflict-note span');
  if (note) note.textContent = text || 'إذا لم تكن أنت من قام بالدخول، غيّر كلمة المرور وعُد للدخول مجدداً.';
  // أيقونة «القائمة» تعود إلى رمزها العام (لأننا سجّلنا خروجاً من هذه الصفحة)
  const menu = $('#bnMenu');
  if (menu) menu.innerHTML = '<i class="f7-icons" id="bnMenuIcon">square_grid2x2_fill</i><span>القائمة</span>';
}
const sessionConflictReloadBtn = $('#sessionConflictReload');
if (sessionConflictReloadBtn) sessionConflictReloadBtn.onclick = () => { REFRESH_LEAVING = true; location.reload(); };

// ---------- أدوات ----------
// مؤشر موحّد يظهر فوق الواجهة أثناء أي طلب يحتاج وقتاً. نستخدم عدّاداً
// حتى لا يختفي المؤشر إذا كانت هناك أكثر من عملية تعمل في الوقت نفسه.
// عمليات سريعة «صامتة» لا يعرض لها المؤشر إطلاقاً: فتح قوالب الحالة/الخاص/
// الإشعارات/الحائط، النقر على اسم مستخدم، تغيير الصور والملف الشخصي،
// وتطبيقات تغييرات الإدارة على الشات (مزامنة settings/gifts/rooms...).
const SILENT_LOADING_PATTERNS = [
  '/api/statuses', '/api/private', '/api/notifications', '/api/wall',
  '/api/my-avatars', '/api/avatars', '/api/profile', '/api/user/',
  '/api/public-settings', '/api/gifts', '/api/emojis', '/api/rooms'
];
function isSilentLoading(url) {
  const u = String(url || '');
  return SILENT_LOADING_PATTERNS.some(p => u.includes(p));
}
let GLOBAL_LOADING_COUNT = 0;
let GLOBAL_LOADING_HIDE_TIMER = null;
function operationLoadingLabel(url, method = 'GET') {
  const u = String(url || '');
  if (u.includes('/api/register')) return 'جارٍ إنشاء الحساب...';
  if (u.includes('/api/login')) return 'جارٍ تسجيل الدخول...';
  if (u.includes('/api/guest')) return 'جارٍ الدخول كزائر...';
  if (u.includes('/api/verify-email')) return 'جارٍ تفعيل الحساب...';
  if (u.includes('/api/resend-verify')) return 'جارٍ إرسال رمز جديد...';
  if (u.includes('/api/forgot-password')) return 'جارٍ إرسال رمز الاستعادة...';
  if (u.includes('/api/rooms')) return method === 'GET' ? 'جارٍ تحميل الغرفة...' : 'جارٍ فتح الغرفة...';
  if (u.includes('/api/statuses')) return 'جارٍ تحميل الحالات...';
  if (u.includes('/api/notifications')) return 'جارٍ تحميل الإشعارات...';
  if (u.includes('/api/royal')) return 'جارٍ تحميل الدخول الملكي...';
  if (u.includes('/api/gold-packages')) return 'جارٍ تحميل باقات الذهب...';
  if (u.includes('/api/my-avatars')) return 'جارٍ تحميل الصور...';
  if (u.includes('/api/wall')) return 'جارٍ تجهيز الحائط...';
  if (u.includes('/api/chat')) return 'جارٍ الاتصال بالدردشة...';
  return 'جارٍ تنفيذ الطلب...';
}
function showGlobalOperationLoading(label = 'جارٍ التحميل...') {
  GLOBAL_LOADING_COUNT++;
  clearTimeout(GLOBAL_LOADING_HIDE_TIMER);
  const box = $('#globalOperationLoading');
  const text = $('#globalOperationLoadingText');
  if (text) text.textContent = label;
  if (box) {
    box.classList.remove('hidden');
    box.setAttribute('aria-hidden', 'false');
  }
}
function hideGlobalOperationLoading() {
  GLOBAL_LOADING_COUNT = Math.max(0, GLOBAL_LOADING_COUNT - 1);
  if (GLOBAL_LOADING_COUNT > 0) return;
  clearTimeout(GLOBAL_LOADING_HIDE_TIMER);
  // مهلة صغيرة تمنع وميض المؤشر في الطلبات السريعة المتتابعة.
  GLOBAL_LOADING_HIDE_TIMER = setTimeout(() => {
    if (GLOBAL_LOADING_COUNT) return;
    const box = $('#globalOperationLoading');
    if (box) {
      box.classList.add('hidden');
      box.setAttribute('aria-hidden', 'true');
    }
  }, 90);
}
function waitForOperation(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms || 0)));
}
async function trackedFetch(url, options = {}, label) {
  const willShow = !isSilentLoading(url);
  if (willShow) showGlobalOperationLoading(label || operationLoadingLabel(url, options.method || 'GET'));
  try {
    return await fetch(url, options);
  } finally {
    if (willShow) hideGlobalOperationLoading();
  }
}
// =====================================================
//  بيانات الزيارة: من أين دخل المستخدم إلى الدردشة
// =====================================================
// تُلتقط مرة واحدة عند فتح الصفحة (قبل أن يغيّر التطبيق الرابط)، ثم تُرسل
// مع أول تسجيل دخول/تسجيل/دخول كزائر لتُحفظ في سجل التتبّع.
const VISIT_INFO = (() => {
  try {
    const params = new URLSearchParams(location.search || '');
    // كلمة البحث إن مرّرها رابط الحملة
    const query = params.get('utm_term') || params.get('q') || params.get('query') || '';
    return {
      visit_referrer: document.referrer || '',
      visit_landing: (location.pathname || '/') + (location.search || ''),
      visit_query: String(query || '').slice(0, 200)
    };
  } catch (e) { return { visit_referrer: '', visit_landing: '', visit_query: '' }; }
})();

async function api(url, method = 'GET', body, isForm = false) {
  const o = { method, credentials: 'same-origin', headers: { 'X-Chat-Client': '1' } };
  if (CHAT_TOKEN) o.headers['X-Chat-Token'] = CHAT_TOKEN;
  if (body && !isForm) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
  if (body && isForm) o.body = body;
  const willShow = !isSilentLoading(url);
  if (willShow) showGlobalOperationLoading(operationLoadingLabel(url, method));
  try {
    const r = await fetch(url, o);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (d && d.banned) showPersistentBanTemplate(d.reason || d.error);
      throw d;
    }
    return d;
  } finally {
    if (willShow) hideGlobalOperationLoading();
  }
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

// يحوّل الروابط (http/https/www) الموجودة في نص مُهرّب (بعد esc) إلى
// روابط قابلة للنقر تُفتح في تبويب/نافذة جديدة عند النقر عليها (target="_blank").
// تعمل على النص المُهرّب حصراً حتى لا تلمس أي HTML موجود (وسوم/إيموجي).
function linkifyEscaped(text) {
  const source = String(text || '');
  return source.replace(/((?:https?:\/\/|www\.)[^\s<>\"'`]+)/gi, function (url) {
    let clean = url.replace(/[.,;:!?)\]}»\"'`]+$/g, '');
    if (!clean) return url;
    let href = clean;
    if (/^www\./i.test(href)) href = 'http://' + href;
    return '<a class="chat-link" href="' + href + '" target="_blank" rel="noopener noreferrer" title="' + clean + '">' + clean + '</a>';
  });
}
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
// النوافذ التي تُصغِّر خلفية التطبيق خلفها (تأثير ورقة iOS).
const SHEET_SCALE_OVS = ['loginOv', 'regOv'];
// تُطبَّق على #frame ما دامت أي واحدة منها مفتوحة، وتُزال حين تُغلق كلها.
function syncSheetScale() {
  const frame = document.getElementById('frame');
  if (!frame) return;
  const anyOpen = SHEET_SCALE_OVS.some(id => {
    const ov = document.getElementById(id);
    return ov && ov.classList.contains('open');
  });
  frame.classList.toggle('sheet-scaled', anyOpen);
}
function openOv(id) {
  // أي نافذة تُفتح تُغلق القائمة المنبثقة للاسم كي لا تبقى معلّقة فوقها.
  if (id !== 'namePopover' && typeof closeNamePopover === 'function') closeNamePopover();
  $('#' + id).classList.add('open');
  syncSheetScale();
  refreshNav();
}
function closeOv(id) {
  $('#' + id).classList.remove('open');
  syncSheetScale();
  if (typeof closeNamePopover === 'function') closeNamePopover();
  // إغلاق ورقة المستخدم يلغي التصاقها بالاسم كي تعود ورقة سفلية عادية في المرة القادمة.
  if (id === 'userSheet' && typeof anchorUserSheet === 'function') anchorUserSheet(null);
  if (id === 'userSheet' && typeof stopUserStatusActionWatcher === 'function') stopUserStatusActionWatcher();
  // إغلاق الملف الشخصي يوقف النبذة الصوتية فوراً (ويسجّل الميكروفون إن كان يعمل)
  if (id === 'profOv') {
    try { stopProfileVoiceAudio(); } catch (e) { }
    try { stopProfileAudioStream(); } catch (e) { }
    CUR_PROFILE_USER = null;
  }
  // الخروج من المحادثة الخاصة: لم نعد داخلها، فأي رسالة جديدة من الشخص نفسه
  // يجب أن تُظهر الإشعار من جديد وتزيد العداد.
  if (id === 'pmOv') PM_WITH = null;
  refreshNav();
}
function refreshNav() {
  const navPages = { menuOv: 'menu', notifOv: 'notifs', privOv: 'private', wallOv: 'wall' };
  let openNav = null;
  for (const id in navPages) if (document.getElementById(id) && document.getElementById(id).classList.contains('open')) openNav = navPages[id];
  const inChat = $('#chatScreen').classList.contains('active');
  document.querySelector('.bottomnav').classList.toggle('show', inChat || !!openNav);
  $$('.bn-item').forEach(b => b.classList.toggle('active', b.dataset.nav === (openNav || 'rooms')));
}
$$('[data-close]').forEach(b => b.addEventListener('click', () => closeOv(b.dataset.close)));

// =====================================================
//  شروط الاستخدام وسياسة الخصوصية (فتح من ورقة الدخول)
//  تُملأ النصوص من إعدادات لوحة الإدارة وتُعرض في قالب الورقة.
// =====================================================
const LEGAL_DEFAULT_TERMS = 'نص شروط الاستخدام هنا.\n\n١) باستخدامك هذا الموقع فإنك توافق على الالتزام بجميع القوانين واللوائح المعمول بها.\n٢) يُمنع إرسال محتوى مسيء أو مخالف للآداب العامة.\n٣) تحتفظ الإدارة بحق حظر أي حساب يخالف الشروط دون سابق إنذار.';
const LEGAL_DEFAULT_PRIVACY = 'نص سياسة الخصوصية هنا.\n\n١) نحترم خصوصية المستخدمين ولا نشارك بياناتهم مع أي طرف ثالث.\n٢) تُستخدم بيانات الاتصال الداخلية لتحسين تجربة الاستخدام فقط.\n٣) لا نحتفظ بأي معلومات شخصية يُقصد بها الإضرار بالمستخدم.';
function renderLegalSheet(id, body) {
  const container = $('#' + body);
  if (container) container.innerHTML = esc(SETTINGS.terms_text || (body === 'termsBody' ? LEGAL_DEFAULT_TERMS : LEGAL_DEFAULT_PRIVACY));
  openOv(id);
}
const openTermsEl = $('#openTerms');
const openPrivacyEl = $('#openPrivacy');
if (openTermsEl) openTermsEl.addEventListener('click', (e) => { e.stopPropagation(); renderLegalSheet('termsOv', 'termsBody'); });
if (openPrivacyEl) openPrivacyEl.addEventListener('click', (e) => { e.stopPropagation(); renderLegalSheet('privacyOv', 'privacyBody'); });

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
// الصورة الرمزية: قد تكون مسار /.. أو "emoji:🙂:#hex" أو فارغة.
// المعامل الثالث frame = معرّف الإطلالة، فتُغلَّف الصورة بإطار مزخرف.
function avatarHtml(avatar, cls = '', frame = '') {
  let inner;
  if (avatar && avatar.startsWith('/')) inner = `<img class="${cls}" src="${esc(avatar)}" alt="">`;
  else if (avatar && avatar.startsWith('emoji:')) {
    const [, e, bg] = avatar.split(':');
    inner = `<span class="${cls}" style="background:${bg}">${e}</span>`;
  } else inner = `<img class="${cls}" src="/avatars/default.png" alt="">`;   // الافتراضية للجميع
  return frame ? wrapAvatarFrame(inner, frame) : inner;
}
// قائمة الإطلالات المتاحة (مطابقة لقائمة الخادم في AVATAR_FRAMES)
// الإطلالات الاحترافية المتحركة أولاً ثم الكلاسيكية — كلها متاحة مجاناً للجميع.
const AVATAR_FRAMES = [
  'stars', 'galaxy', 'diamond', 'energy', 'aurora', 'emerald', 'platinum', 'sunset',
  'gold', 'neon', 'fire', 'ice', 'royal', 'hearts', 'leaf', 'rainbow'
];
const AVATAR_FRAME_NAMES = {
  stars: 'نجوم متلألئة', galaxy: 'مجرة', diamond: 'ماسة', energy: 'طاقة',
  aurora: 'شفق قطبي', emerald: 'زمردي', platinum: 'بلاتينية', sunset: 'غروب',
  gold: 'ذهبية', neon: 'نيون', fire: 'لهب', ice: 'جليد',
  royal: 'ملكية', hearts: 'قلوب', leaf: 'أوراق', rainbow: 'قوس قزح'
};
// يغلّف الصورة بإطار الإطلالة. القيم غير المعروفة تُتجاهل بأمان.
function wrapAvatarFrame(innerHtml, frame) {
  const f = String(frame || '');
  if (!f || !AVATAR_FRAMES.includes(f)) return innerHtml;
  return `<span class="ava-framed af-${f}">${innerHtml}</span>`;
}
// إطلالة مستخدم من كائنه (يقبل أي شكل من كائنات المستخدم في التطبيق)
function frameOf(u) { return (u && u.avatar_frame) || ''; }
// صورتي داخل شريط الإدخال (تظهر على الكمبيوتر فقط عبر CSS).
// تُستدعى عند الدخول وعند تحديث الملف الشخصي وعند الخروج.
function syncInputBarAvatar() {
  const el = $('#ciAva');
  if (!el) return;
  el.innerHTML = ME ? avatarHtml(ME.avatar, '', frameOf(ME)) : '';
}
// يحافظ على الصفر في إعدادات الأسعار: 0 = مجاني، وليس قيمة تستبدل بالافتراضي.
function normalizeClientNonNegativeCost(value, fallback) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}
// إطار البث يظهر فقط عندما يؤكد الخادم أن صاحب الرسالة كان مذيعاً لحظة إرسالها.
// إطار البث له الأولوية على الإطلالة كي لا يجتمع إطاران حول صورة واحدة.
function liveAvatarHtml(avatar, isLive, frame = '') {
  if (!isLive) return avatarHtml(avatar, '', frame);
  return `<span class="live-avatar-frame" aria-label="مذيع مباشر">
    <span class="live-avatar-photo">${avatarHtml(avatar)}</span>
    <img class="live-avatar-frame-image" src="/img/live-avatar.png" alt="">
  </span>`;
}
// ===== دائرة الحالة حول الصورة =====
// من له حالة نشطة تظهر حول صورته دائرة خضراء في قائمة المستخدمين وفي العام
// وفي الخاص. تختفي فور حذف الحالة أو انتهاء مدتها.
function hasActiveStatus(uid) {
  const exp = STATUS_OWNERS.get(+uid);
  return !!exp && exp > Math.floor(Date.now() / 1000);
}
// صفّ يُضاف إلى حاوية الصورة (uava / mava / pm-ava) ليرسم الدائرة.
function statusRingClass(uid) { return hasActiveStatus(uid) ? ' has-status-ring' : ''; }
// يعيد رسم الدوائر في كل الأماكن المعروضة حالياً دون إعادة بناء أي قائمة،
// حتى لا تُقطع الرسائل أو يُعاد تشغيل أي وسائط.
function refreshStatusRings() {
  const mark = (el, uid) => {
    if (!el) return;
    el.classList.toggle('has-status-ring', hasActiveStatus(uid));
  };
  $$('#usersList .users-row').forEach(row => mark(row.querySelector('.uava'), +row.dataset.id));
  $$('#msgArea .msg[data-uid]').forEach(msg => mark(msg.querySelector('.mava'), +msg.dataset.uid));
  $$('#pmBody .pm-row[data-uid]').forEach(row => mark(row.querySelector('.pm-ava'), +row.dataset.uid));
  scheduleStatusOwnersExpiry();
}
// مؤقّت يوقظ الواجهة عند أقرب انتهاء حالة فتُزال دائرتها في حينها بالضبط.
function scheduleStatusOwnersExpiry() {
  if (STATUS_OWNERS_TIMER) { clearTimeout(STATUS_OWNERS_TIMER); STATUS_OWNERS_TIMER = null; }
  const now = Math.floor(Date.now() / 1000);
  let soonest = Infinity;
  STATUS_OWNERS.forEach((exp, uid) => {
    if (exp <= now) STATUS_OWNERS.delete(uid);
    else if (exp < soonest) soonest = exp;
  });
  if (!Number.isFinite(soonest)) return;
  // سقف ساعة واحدة كي لا نضع مؤقتاً طويلاً جداً (المتصفح يحدّه أصلاً).
  const ms = Math.min((soonest - now) * 1000 + 500, 3600000);
  STATUS_OWNERS_TIMER = setTimeout(() => { STATUS_OWNERS_TIMER = null; refreshStatusRings(); }, Math.max(1000, ms));
}
// يشتق خريطة أصحاب الحالات من قائمة الحالات الكاملة (بعد أي تحميل لها).
function syncStatusOwnersFromStatuses() {
  const now = Math.floor(Date.now() / 1000);
  const map = new Map();
  (STATUSES || []).forEach(s => {
    const uid = +s.user_id, exp = +s.expires_at;
    if (!uid || !Number.isFinite(exp) || exp <= now) return;
    if (!map.has(uid) || map.get(uid) < exp) map.set(uid, exp);
  });
  STATUS_OWNERS = map;
  refreshStatusRings();
}
async function loadStatusOwners() {
  if (!ME || !CHAT_TOKEN) return;
  try {
    const rows = await api('/api/statuses/active-users');
    STATUS_OWNERS = new Map((Array.isArray(rows) ? rows : []).map(r => [+r.user_id, +r.expires_at]));
    refreshStatusRings();
  } catch (e) { /* تعذّر الجلب: تبقى الدوائر الحالية كما هي */ }
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
    if (AC.state === 'suspended' && AC.resume) AC.resume();
    const o = AC.createOscillator(), g = AC.createGain();
    o.connect(g); g.connect(AC.destination);
    o.frequency.value = freq; g.gain.value = .06;
    o.start(); g.gain.exponentialRampToValueAtTime(.0001, AC.currentTime + dur);
    o.stop(AC.currentTime + dur + .02);
  } catch (e) { }
}

// النغمة الافتراضية لكل نوع إشعار (دخول/رسالة/خروج/خاص/إعلان).
function beepDefaultFor(kind) {
  if (kind === 'pm' || kind === 'ntf') return beep(880, .15);
  const freq = kind === 'join' ? 520 : (kind === 'msg' ? 740 : (kind === 'leave' ? 360 : 880));
  const dur = kind === 'msg' ? .07 : .1;
  beep(freq, dur);
}

// تشغيل صوت إشعار: يفضل الصوت المخصص المرفوع من لوحة الإدارة، وإلا النغمة الافتراضية.
// kind = 'join' | 'msg' | 'leave' | 'pm' (رسالة خاصة) | 'ntf' (إعلان للجميع)
function playNotifSound(kind) {
  if (!PREFS.snd_all) return;
  const setting = 'snd_' + kind;
  const urlKey = setting + '_url';
  const enabled = SETTINGS[setting] === '1' || SETTINGS[setting] === undefined; // مفعّل افتراضياً إذا لم يُحدَّد
  if (!enabled) return;
  const url = SETTINGS[urlKey] || '';
  if (url) {
    try {
      const a = new Audio(url);
      a.volume = 0.85;
      const p = a.play();
      if (p && p.catch) p.catch(() => beepDefaultFor(kind));
      return;
    } catch (e) { /* فشل التشغيل → نغمة افتراضية */ }
  }
  beepDefaultFor(kind);
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
  // يفحص حظر الجهاز قبل تحميل الدردشة؛ لذلك يظهر القالب أيضاً بعد تغيير IP
  // أو تحديث الصفحة، ولا يختفي إلا بعد فك الحظر من لوحة الإدارة.
  try {
    const response = await trackedFetch('/api/ban-status', { credentials: 'same-origin', cache: 'no-store' });
    const banState = await response.json().catch(() => ({}));
    if (banState.banned) {
      showPersistentBanTemplate(banState.reason || banState.error);
      return;
    }
  } catch (error) { }
  loadRoyalAnimals();
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

// متغيرات CSS الخاصة بالجلد — تُضبط ديناميكياً عند اختيار لون مخصص.
const SKIN_VAR_KEYS = ['--main', '--main2', '--skin-primary', '--skin-secondary', '--skin-glow', '--skin-bg-light', '--skin-border', '--skin-btn'];
// يطبّق الجلد المختار (اسم ثيم جاهز أو لون HEX) على عنصر body.
// الثيمات الجاهزة تُحسب أيضاً ديناميكياً حتى يبقى الشكل موحّداً، وأي لون
// من لوحة الألوان يُستخدم مباشرة كجلد كامل.
function applySkinToBody(sel) {
  if (!document.body) return;
  const themes = window.SKIN_THEMES || {};
  const skinLib = window.SkinLib;
  // أزل أي جلد سابق (ثيمات + اللون المخصص) دون المساس بكلاسات أخرى (lang-...).
  document.body.classList.remove('skin-custom');
  for (const n in themes) document.body.classList.remove('skin-' + n);
  const isCustomHex = skinLib && skinLib.isHexColor(sel);
  const isKnownTheme = !!themes[sel];
  if (isCustomHex) document.body.classList.add('skin-custom');
  else document.body.classList.add('skin-' + (sel || 'default'));
  // لو القيمة لون/ثيم معروف، نحسب المتغيرات ونطبقها مباشرة.
  if (skinLib && skinLib.computeSkinVars && (isCustomHex || isKnownTheme)) {
    const vars = skinLib.computeSkinVars(sel);
    for (const k of SKIN_VAR_KEYS) document.body.style.setProperty(k, vars[k]);
  } else {
    for (const k of SKIN_VAR_KEYS) document.body.style.removeProperty(k);
  }
}
function applySettings() {
  // تشغيل/إيقاف الموجة يُدار من لوحة الإدارة ويُطبَّق فوراً على القوالب الموجودة
  const waveOn = SETTINGS.wave_enabled !== '0';
  document.querySelectorAll('#msgArea .mwave').forEach(el => { el.style.display = waveOn ? '' : 'none'; });
  const isLtr = APP_LANG !== 'ar';
  // أيقونة زر قائمة الألوان + لون الجلد: ندعم الآن أي لون HEX أو ثيم جاهز.
  applySkinToBody(SETTINGS.skin || 'default');
  if (document.body && isLtr) {
    document.body.classList.add('lang-' + APP_LANG, 'lang-ltr');
  }
  const activeSiteName = (window.SEO_PAGE_CONFIG && window.SEO_PAGE_CONFIG.site_name) || SETTINGS.site_name || 'الدردشة';

  // لا نستبدل innerHTML للشعار بالكامل؛ لأن ذلك كان يحذف #siteName ثم تسبب
  // أي settings_changed لاحق في خطأ null. نحدّث الصورة والاسم مع إبقاء العقد.
  const siteLogo = $('#siteLogo');
  let siteName = $('#siteName');
  if (siteLogo && !siteName) {
    siteName = document.createElement('span');
    siteName.id = 'siteName';
    siteName.className = 'r-logo-txt';
    siteLogo.appendChild(siteName);
  }
  if (siteName) siteName.textContent = activeSiteName;
  if (siteLogo) {
    let logoIcon = siteLogo.querySelector('.r-logo-ico');
    let logoImage = siteLogo.querySelector('.site-logo-image') || siteLogo.querySelector(':scope > img');
    if (SETTINGS.logo_url) {
      if (!logoImage) {
        logoImage = document.createElement('img');
        siteLogo.insertBefore(logoImage, siteName || siteLogo.firstChild);
      }
      logoImage.className = 'site-logo-image';
      logoImage.src = thumbUrl(String(SETTINGS.logo_url), 260, 72, true);
      logoImage.alt = activeSiteName;
      logoImage.width = 130;
      logoImage.height = 36;
      if (logoIcon) logoIcon.style.display = 'none';
    } else {
      if (logoImage) logoImage.remove();
      if (!logoIcon) {
        logoIcon = document.createElement('span');
        logoIcon.className = 'r-logo-ico';
        const icon = document.createElement('i');
        icon.className = 'f7-icons';
        icon.textContent = 'smiley_fill';
        logoIcon.appendChild(icon);
        siteLogo.insertBefore(logoIcon, siteName || siteLogo.firstChild);
      }
      logoIcon.style.display = '';
    }
  }
  // مفاتيح لوحة الإدارة تتحكم فوراً في ظهور الأزرار، في الاتجاهين:
  // الإيقاف يخفي الزر والتفعيل يعيده دون حاجة لتحديث الصفحة.
  const smilesEnabled = SETTINGS.show_smiles === '1';
  const voiceEnabled = SETTINGS.show_voice === '1';
  const imageEnabled = SETTINGS.show_image === '1';
  const emojiButton = $('#btnEmoji');
  const micButton = $('#btnMic');
  const cameraButton = $('#btnCam');
  if (emojiButton) { emojiButton.style.display = smilesEnabled ? '' : 'none'; emojiButton.disabled = !smilesEnabled; }
  if (micButton) { micButton.style.display = voiceEnabled ? '' : 'none'; micButton.disabled = !voiceEnabled; }
  if (cameraButton) { cameraButton.style.display = imageEnabled ? '' : 'none'; cameraButton.disabled = !imageEnabled; }
  if (!smilesEnabled) $('#emojiPanel')?.classList.remove('open');
  if (!voiceEnabled && $('#voiceRecorderOverlay') && !$('#voiceRecorderOverlay').classList.contains('hidden') && typeof closeVoiceRecorder === 'function') closeVoiceRecorder();
  if (!imageEnabled && $('#publicMediaReview') && !$('#publicMediaReview').classList.contains('hidden') && typeof closePublicMediaReview === 'function') closePublicMediaReview();
  if (SETTINGS.hidden_super !== '1' && HIDDEN_ENTRY_PENDING) {
    HIDDEN_ENTRY_PENDING = null;
    closeOv('hiddenEntryOv');
  }

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
  const publicMessageSpacing = Math.min(40, Math.max(0, Math.round(+(SETTINGS.public_message_spacing_px ?? 4))));
  const publicNameSize = Math.min(36, Math.max(10, Math.round(+(SETTINGS.public_message_name_size_px ?? 14))));
  const publicBodyWidth = String(SETTINGS.public_message_body_width || 'fit') === 'full' ? 'full' : 'fit';
  document.documentElement.style.setProperty('--msg-font-size', fs + 'px');
  document.documentElement.style.setProperty('--public-msg-spacing', publicMessageSpacing + 'px');
  document.documentElement.style.setProperty('--public-name-size', publicNameSize + 'px');
  const publicBadgeKinds = ['superadmin', 'admin', 'roomadmin', 'mmez', 'vip', 'premium', 'plus', 'register', 'guest', 'hidden_admin'];
  publicBadgeKinds.forEach(kind => {
    const fallbackSize = kind === 'hidden_admin' ? 28 : 24;
    const value = Math.min(80, Math.max(12, Math.round(+(SETTINGS[`msg_badge_${kind}_size`] ?? fallbackSize))));
    document.documentElement.style.setProperty(`--msg-badge-${kind}-size`, value + 'px');
  });
  const publicMessageArea = $('#msgArea');
  if (publicMessageArea) {
    publicMessageArea.classList.toggle('msg-body-full', publicBodyWidth === 'full');
    publicMessageArea.classList.toggle('msg-body-fit', publicBodyWidth !== 'full');
  }
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
  renderRadioPill(); // كبسولة الراديو تتبع إعدادات الإدارة لحظياً (بما فيها تحديث sync)
}
function applyPrefsToSwitches() {
  $$('#setList .switch').forEach(sw => {
    const k = sw.dataset.set;
    const on = !!PREFS[k];
    sw.classList.toggle('on', on);
    sw.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}

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
      const wasInterrupted = !!CONNECTION_INTERRUPTED;
      api('/api/rooms/' + roomId + '/users').then(users => {
        if (CUR_ROOM && +CUR_ROOM.id === roomId) { ROOM_USERS = users; renderUsers(); }
      }).catch(() => { });
      // استدراك الرسائل التي وصلت أثناء الانقطاع — نجلب فقط ما جرى بعد آخر رسالة
      // ظاهرة (أثناء وجودنا بالغرفة وأثناء الانقطاع)، وليس كل السجل القديم.
      if (wasInterrupted) {
        // لا نجلب إلا ما ورد بعد دخولي الغرفة (بما فيه فترة الانقطاع)، وليس السجل القديم.
        const sinceId = Math.max(ROOM_LAST_MSG_ID[roomId] || 0, ROOM_SYNC_BASE[roomId] || 0);
        api('/api/rooms/' + roomId + '/messages' + (sinceId ? '?since=' + sinceId : '')).then(msgs => {
          if (!CUR_ROOM || +CUR_ROOM.id !== roomId) return;
          const missed = (msgs || []).filter(m => !m.id || !RENDERED_MSG_IDS.has(+m.id));
          if (!missed.length) return;
          const stick = isNearBottom();
          missed.forEach(m => renderMsg(m));
          if (stick) scrollBottom();
          else { NEW_MSGS_BELOW += missed.filter(m => m.type === 'msg').length; updateScrollDownBtn(); }
        }).catch(() => { });
      }
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
    else if (result && result.reason === 'members_only') { toast(result.text || '👤 هذه الغرفة للأعضاء المسجلين فقط', false); openOv('needRegOv'); }
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
  refreshSocketHandshakeKey(SOCKET);
  SOCKET.connect();
}
$('#reconnectBtn').onclick = requestSocketReconnect;
// عودة الصفحة للواجهة (تبديل تبويب/تطبيق على الهاتف): المتصفح يجمّد التبويب
// الخلفي وقد يقطع WebSocket أثناء التجميد. بدل انتظار مؤقت إعادة المحاولة
// (backoff)، نعيد الاتصال فوراً لحظة عودة المستخدم لتبويب الدردشة.
function forceReconnectNow() {
  if (!ME || !CHAT_TOKEN || !SOCKET || SOCKET.connected) return;
  // حساب غير مُفعَّل: لا إعادة اتصال قبل اكتمال تفعيل البريد
  if (typeof PENDING_VERIFY !== 'undefined' && PENDING_VERIFY) return;
  showConnectionOverlay('جارٍ إعادة الاتصال...', true);
  refreshSocketHandshakeKey(SOCKET);
  // إيقاف حلقة إعادة الاتصال المجدولة (إن كانت تعمل) وإعادة المحاولة الآن.
  if (SOCKET.active) { try { SOCKET.disconnect(); } catch (e) { } }
  SOCKET.connect();
}
// عودة المستخدم للتبويب: أعد تشغيل صوت البث المباشر فوراً (المتصفح يجمّده في التبويب الخلفي)
function bcastResumeAllAudio() {
  const pool = document.getElementById('bcastAudioPool');
  if (!pool) return;
  pool.querySelectorAll('audio').forEach(el => { if (el.paused && el.srcObject) bcastTryPlayAudioEl(el); });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { bcastResumeAllAudio(); forceReconnectNow(); } });
window.addEventListener('pageshow', () => { bcastResumeAllAudio(); forceReconnectNow(); });
window.addEventListener('focus', () => { bcastResumeAllAudio(); forceReconnectNow(); });
window.addEventListener('offline', () => {
  if (!ME || !CHAT_TOKEN) return;
  CONNECTION_INTERRUPTED = true;
  showConnectionOverlay('بانتظار عودة اتصال الإنترنت...', true);
});
window.addEventListener('online', () => {
  if (CONNECTION_INTERRUPTED && ME && CHAT_TOKEN) requestSocketReconnect();
});

// ===== بنب الاحتفاظ بالجلسة (/api/chat/ping) =====
// نبضة خفيفة كل 25 ثانية (المتصفح يقيّد التبويب الخلفي إلى ~مرة/دقيقة فتكفي):
// إن كان السوكيت منقطعاً ونحن متصلون بالإنترنت (مثلاً أثناء التواجد في تبويب آخر)
// نعيد الاتصال فوراً — فيرى المستخدم الدردشة مستعادة «كأنها لم تتجمد»،
// وإن انقطع الإنترنت يظهر قالب «بانتظار عودة اتصال الإنترنت».
let CHAT_PING_TIMER = null;
async function chatPingTick() {
  if (!ME || !CHAT_TOKEN) return;
  // السوكيت متصل والإنترنت حاضر — لا حاجة للنبضة (السوكيت نفسه هو الدفء)
  if (navigator.onLine && SOCKET && SOCKET.connected && !CONNECTION_INTERRUPTED) return;
  try {
    const r = await trackedFetch('/api/chat/ping', { headers: { 'X-Chat-Client': '1', 'X-Chat-Token': CHAT_TOKEN }, cache: 'no-store' });
    if (!r.ok) return;
    // الخادم يجيب والإنترنت حاضر لكن السوكيت منقطع → إعادة اتصال فورية مع قالب الاستعادة
    if (navigator.onLine && SOCKET && !SOCKET.connected && !CONNECTION_INTERRUPTED) requestSocketReconnect();
  } catch (e) {
    // لا يمكن الوصول للخادم (انقطاع الإنترنت) — قالب الانتظار
    CONNECTION_INTERRUPTED = true;
    if (ME && CHAT_TOKEN) showConnectionOverlay(navigator.onLine ? 'جارٍ إعادة الاتصال...' : 'بانتظار عودة اتصال الإنترنت...', true);
  }
}
function startChatPing() {
  if (CHAT_PING_TIMER) clearInterval(CHAT_PING_TIMER);
  CHAT_PING_TIMER = setInterval(chatPingTick, 25000);
}
function stopChatPing() {
  if (CHAT_PING_TIMER) { clearInterval(CHAT_PING_TIMER); CHAT_PING_TIMER = null; }
}

// ===== نبضة السوكيت المعتمة (keepalive) =====
// حزمة موقّعة/معتمة تماماً كبقية الحزم (يوقّعها cloak-client تلقائياً) تُرسل
// كل 15 ثانية لتبقي الاتصال حيّاً حتى والنافذة في الخلفية أو على صفحة أخرى.
// المؤقّت داخل Web Worker لأن المتصفح يخنق مؤقّتات الصفحة الخلفية.
let BEAT_WORKER = null;
let BEAT_FALLBACK_TIMER = null;
let BEAT_MISSED = 0;
const BEAT_EVERY_MS = 15000;
function sendKeepaliveBeat() {
  if (!ME || !CHAT_TOKEN) return;
  // السوكيت ساقط أصلاً: أعد الاتصال بدل إرسال نبضة في الفراغ
  if (!SOCKET || !SOCKET.connected) {
    if (navigator.onLine && !CONNECTION_INTERRUPTED) forceReconnectNow();
    return;
  }
  let answered = false;
  try {
    // الحزمة تمر عبر نفس طبقة التوقيع والتعتيم المطبّقة على كل الأحداث
    SOCKET.emit('keepalive', { hidden: document.visibilityState === 'hidden' }, () => {
      answered = true;
      BEAT_MISSED = 0;
    });
  } catch (e) { return; }
  // لم يصل ردّ خلال 10 ثوانٍ: الاتصال ميت فعلياً رغم أن الحالة تقول متصل
  setTimeout(() => {
    if (answered) return;
    BEAT_MISSED++;
    if (BEAT_MISSED >= 2 && navigator.onLine) { BEAT_MISSED = 0; forceReconnectNow(); }
  }, 10000);
}
function startKeepaliveBeat() {
  stopKeepaliveBeat();
  BEAT_MISSED = 0;
  try {
    BEAT_WORKER = new Worker('/js/beat-worker.js');
    BEAT_WORKER.onmessage = (e) => { if (e.data && e.data.beat) sendKeepaliveBeat(); };
    BEAT_WORKER.postMessage({ cmd: 'start', every: BEAT_EVERY_MS });
  } catch (e) {
    // متصفح بلا Worker: مؤقّت عادي (يُخنق في الخلفية لكنه أفضل من لا شيء)
    BEAT_WORKER = null;
    BEAT_FALLBACK_TIMER = setInterval(sendKeepaliveBeat, BEAT_EVERY_MS);
  }
}
function stopKeepaliveBeat() {
  if (BEAT_WORKER) {
    try { BEAT_WORKER.postMessage({ cmd: 'stop' }); BEAT_WORKER.terminate(); } catch (e) { }
    BEAT_WORKER = null;
  }
  if (BEAT_FALLBACK_TIMER) { clearInterval(BEAT_FALLBACK_TIMER); BEAT_FALLBACK_TIMER = null; }
}

function connectSocket() {
  if (!ME || !CHAT_TOKEN) return;
  // هوية هذه الصفحة تنتقل إلى الخادم عبر WebSocket ولا تعتمد على كوكي مشترك بين التبويبات.
  // إعادة الاتصال غير محدودة مع تدرج زمني، مع بقاء الرمز في ذاكرة هذه الصفحة فقط.
  const socket = io({
    auth: { client: 'chat', token: CHAT_TOKEN },
    query: { key: nextSocketHandshakeKey() },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 250,
    reconnectionDelayMax: 2500,
    randomizationFactor: .35,
    timeout: 10000
  });
  SOCKET = socket;
  startChatPing(); // نبضة الاحتفاظ بالجلسة (تبقى حية حتى من تبويب خلفية)
  startKeepaliveBeat(); // نبضة السوكيت المعتمة — تبقي الاتصال حياً في الخلفية
  // بعد كل اتصال نعيد الانضمام للغرفة نفسها ثم نخفي إشعار الانقطاع.
  socket.on('connect', () => restoreCurrentRoom(socket));
  SOCKET.on('msg', (m) => {
    if (CUR_ROOM && m.room_id === CUR_ROOM.id) {
      // إذا كان المستخدم أسفل الدردشة (أو الرسالة رسالته هو) ننزل تلقائياً،
      // أما إن كان يقرأ رسائل قديمة بالأعلى فنثبّت مكانه ونزيد عداد الزر العائم.
      const senderId = +(m.user_id || (m.user && m.user.id) || 0);
      const stick = isNearBottom() || (ME && senderId === ME.id);
      renderMsg(m);
      if (stick) scrollBottom();
      else {
        if (m.type === 'msg') NEW_MSGS_BELOW++;
        updateScrollDownBtn();
      }
      if (m.type === 'join' && PREFS.snd_join) playNotifSound('join');
      else if (m.type === 'msg' && PREFS.snd_msg) playNotifSound('msg');
      else if (m.type === 'leave' && PREFS.snd_leave) playNotifSound('leave');
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
      if (PREFS.pm_recv) playNotifSound('pm'); // صوت إشعار الرسالة الخاصة (مخصص أو افتراضي)
      showPmBanner(p);         // شريط الإشعار داخل الصفحة (كمبيوتر وهاتف)
      notifyDesktopPrivate(p); // إشعار سطح المكتب (متصفح الكمبيوتر)
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
    pushNotif(n.icon, n.text, n); toast(n.text); playNotifSound('ntf'); // صوت إشعار الإعلان للجميع
    notifyDesktopSystem(n); // إشعار سطح المكتب حين يكون التاب خلفياً
  });
  // تحديث فوري لحساب وبيانات المستخدم عند التعديل من لوحة الإدارة
  SOCKET.on('user_sync', ({ user, badge }) => {
    if (!ME || !user || +ME.id !== +user.id) return;
    const oldName = ME.username;
    const oldBalance = +ME.balance || 0;
    Object.assign(ME, user);
    if (typeof syncMyColorFromProfile === 'function') syncMyColorFromProfile(ME);
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
    if (headAva) headAva.innerHTML = avatarHtml(ME.avatar, '', frameOf(ME));
    syncInputBarAvatar();
    const menuAva = $('#menuAva');
    if (menuAva) menuAva.innerHTML = avatarHtml(ME.avatar, '', frameOf(ME)) + `<span class="dot ${statusDot(ME.status)}"></span>`;

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
  // تحديث مباشر لمفاتيح ضبط الإعدادات من لوحة الإدارة دون انتظار إعادة تحميل.
  SOCKET.on('settings_changed', changes => {
    if (!changes || typeof changes !== 'object') return;
    try {
      Object.assign(SETTINGS, changes);
      for (const soundKey of ['snd_join', 'snd_msg', 'snd_leave']) {
        if (changes[soundKey] === undefined) continue;
        // تغيير الإدارة ينعكس فوراً على المفتاح المحلي الظاهر للمستخدم أيضاً.
        PREFS[soundKey] = changes[soundKey] === '1' ? 1 : 0;
      }
      savePrefs();
      applyPrefsToSwitches();
      applySettings();
    } catch (error) {
      // لا نترك Promise غير معالج إذا كان قالب خارجي قد حذف عنصراً من الصفحة.
      console.error('[settings_changed] تعذر تطبيق الإعدادات مباشرة:', error);
    }
  });

  // مزامنة فورية: أي تعديل من لوحة الإدارة يطبَّق مباشرة دون تحديث الصفحة
  SOCKET.on('sync', async () => {
    try {
      SETTINGS = parseClientSettings(await api('/api/public-settings'));
      // اللغة «الافتراضية» تُطبّق فقط على من لم يختر لغته بنفسه (حتى لا تُلغى
      // اختيارات المستخدمين مع كل حفظ إعدادات غير متعلق باللغة). أما التغيير
      // الصريح للغة من لوحة الإدارة فيصل عبر حدث language_changed ويفرض على الجميع.
      if (!localStorage.getItem('chat_language') && SETTINGS.default_language && ["ar", "en", "es", "tr"].includes(SETTINGS.default_language)) {
        setLanguage(SETTINGS.default_language, false);
      }
      applySettings();
    } catch (e) { }
    try { GIFTS = await api('/api/gifts'); } catch (e) { }
    if (ME) loadCustomEmojis(true);   // تحديث قائمة الإيموجي بعد الدخول فقط
    loadRooms();          // تحديث قائمة الغرف واللوحة المضغوطة داخل الغرفة
    if (typeof renderRoomsPanel === 'function') renderRoomsPanel();
    if ($('#avaOv') && $('#avaOv').classList.contains('open')) renderAvaGrid(AVA_CAT);
  });
  // اسم الموقع من حقل SEO بلوحة الإدارة يظهر حياً في خلفية العامة أثناء الكتابة؛
  // عند تفريغ الحقل نعود للاسم المحفوظ في الإعدادات.
  SOCKET.on('site_name_live', (d) => {
    const draft = String((d && d.name) || '').trim();
    const base = (window.SEO_PAGE_CONFIG && window.SEO_PAGE_CONFIG.site_name) || SETTINGS.site_name || 'الدردشة العربية';
    $$('.pm-water').forEach(el => { el.textContent = draft || base; });
  });
  SOCKET.on('avatars_changed', async () => {
    if ($('#avaOv') && $('#avaOv').classList.contains('open')) {
      await renderAvaGrid(AVA_CAT);
    }
  });
  // اللغة الافتراضية يفرضها الإداري على الجميع فوراً: تُحدَّث القيمة المخزنة محلياً
  // لدى كل مستخدم (حتى من اختار لغته بنفسه سابقاً)، وتُطبَّق مباشرة دون إعادة تحميل.
  // مع ذلك يبقى لكل مستخدم حرية تغيير لغته لاحقاً من داخل الدردشة (force_default).
  SOCKET.on('language_changed', data => {
    if (data && data.default_language && ["ar", "en", "es", "tr"].includes(data.default_language)) {
      SETTINGS.default_language = data.default_language;
      // حفظ إجباري كي يبقى التغيير سارياً حتى بعد إعادة تحميل/دخول المستخدم
      setLanguage(data.default_language, true);
      applySettings();
    }
  });
  SOCKET.on('announce', announcement => {
    const a = normalizeAnnouncement(announcement);
    pushNotif('announcement', a.text, a);
    openAnnouncementPopup(a);
    beep(660, .2);
    notifyDesktopSystem({ text: a.text, icon: 'announcement' });
  });
  // عندما تفريغ الإدارة «العام» (حذف العام للجميع): تختفي الرسالة مباشرة
  // من شاشة كل من هو داخل الغرفة دون انتظار إعادة تحميل.
  SOCKET.on('welcome_cleared', d => {
    if (CUR_ROOM && d && +d.roomId === +CUR_ROOM.id) {
      $$('#msgArea .room-welcome').forEach(el => el.remove());
      // إذا جاء اسم المشرف في الحدث، نعرض قالب الحذف للجميع في شاشة الجميع
      if (d.by) {
        const msgArea = $('#msgArea');
        if (msgArea) {
          msgArea.innerHTML = `<div class="system-event leave">
  <div class="system-event-head skin_f2">
    <i class="icon f7-icons skin_color system-event-icon">speaker_3_fill</i>
    <span>رسالة النظام</span>
  </div>
  <div class="font_msg system-event-body">
    <div class="u-msg system-event-message">تم حذف العام من قبل ${esc(d.by)}</div>
  </div>
</div>`;
        }
      }
    }
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
    // دائرة الحالة حول الصورة: تظهر فور النشر وتُزال فور الحذف — في قائمة
    // المستخدمين والعام والخاص معاً. الحذف يحتاج تأكيداً من الخادم لأن العضو
    // قد يملك أكثر من حالة، فلا تُزال الدائرة إلا إذا لم يبقَ له شيء نشط.
    if (change && change.userId) {
      if (change.action === 'created') {
        STATUS_OWNERS.set(+change.userId, Math.floor(Date.now() / 1000) + 86400);
        refreshStatusRings();
      } else if (change.action === 'deleted') {
        loadStatusOwners();
      }
    }
    if (change && change.action === 'created' && ME && +change.userId !== +ME.id && !statusPageOpen) {
      STATUS_UNREAD++;
      updateStatusUnreadBadge();
    }
    if (statusPageOpen) {
      loadStatuses().then(() => {
        if ($('#userSheet').classList.contains('open')) syncUserStatusAction();
      });
    } else if ($('#userSheet').classList.contains('open') && CUR_TARGET) {
      refreshUserStatusAction(CUR_TARGET.id);
    }
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
  // الدخول الملكي: تحديث التاج الذهبي + حيوان الملكية + توهج الدخول عند دخول ملكي للغرفة
  SOCKET.on('royal_changed', ({ username, royal, animal }) => {
    ROOM_USERS.forEach(u => { if (u.username === username) { u.royal = royal ? 1 : 0; u.royal_animal = animal || ''; } });
    if (CUR_TARGET && CUR_TARGET.username === username) { CUR_TARGET.royal = royal ? 1 : 0; CUR_TARGET.royal_animal = animal || ''; }
    if (PM_WITH && PM_WITH.username === username) { PM_WITH.royal = royal ? 1 : 0; PM_WITH.royal_animal = animal || ''; }
    STATUSES.forEach(s => { if (s.username === username) { s.royal = royal ? 1 : 0; s.royal_animal = animal || ''; } });
    renderUsers();
    $$('#msgArea .mname').forEach(nameEl => {
      if (nameEl.dataset.username !== username) return;
      const oldCrown = nameEl.querySelector('.rcrown');
      if (royal && !oldCrown) nameEl.insertAdjacentHTML('beforeend', ' <i class="f7-icons rcrown">crown_fill</i>');
      if (!royal && oldCrown) oldCrown.remove();
    });
  });
  SOCKET.on('royal_enter', ({ username, avatar, animal, gender, gif, sound }) => { triggerRoyalEntry(username, avatar, animal, gender, { gif, sound }); });
  // إرسال هدية: يبث الخادم رسالة الهدية في العام (بطاقة النظام) عبر 'msg'،
  // ومشهدها البصري عبر 'gift:sent' — normal = صندوق الهدية، royal = مشهد ملكي للهدية.
  SOCKET.on('gift:sent', (payload) => {
    if (!payload || !payload.name) return;
    if (payload.style === 'royal') triggerRoyalGiftCelebration(payload);
    else triggerGiftCelebration(payload);
  });
  SOCKET.on('royal_animals_changed', () => { loadRoyalAnimals(); });
  SOCKET.on('royal_granted', ({ animal }) => {
    if (ME) { ME.royal = 1; ME.royal_animal = animal || 'lion'; }
    const a = royalAnimal(animal || 'lion');
    toast(`👑 مُنح لك الدخول الملكي بـ${a.name} ${a.emoji}! سيظهر توهجه عند دخولك الغرف`, true);
  });
  SOCKET.on('status_viewed', ({ statusId }) => {
    const s = STATUSES.find(x => x.id === +statusId);
    if (s && s.is_owner) {
      s.view_count = (+s.view_count || 0) + 1;
      if (CURRENT_STATUS && CURRENT_STATUS.id === s.id) $('#statusViewCount').textContent = s.view_count;
    }
  });
  // مُنع هذا المستخدم من الصعود إلى البث — إن كان يبث الآن نوقفه فوراً.
  SOCKET.on('broadcast_banned', ({ user_id }) => {
    if (!ME || +ME.id !== +user_id) return;
    ME.broadcast_banned = 1;
    if (BCAST && BCAST.isHost) { bcastResetState(); bcastRenderBar(); }
    toast('منعت الإدارة صعودك إلى البث — أُنهي بثك الحالي', false);
  });
  // أُلغيت صلاحية الصعود إلى البث لمستخدمٍ ما (فكّ منع) — حدّث زر «فك من البث» إن كانت ورقته مفتوحة.
  SOCKET.on('broadcast_ban_cleared', ({ user_id }) => {
    if (CUR_TARGET && +CUR_TARGET.id === +user_id) { CUR_TARGET.broadcast_banned = 0; syncUserActionSheet(); }
    const ru = ROOM_USERS.find(u => u.id === +user_id);
    if (ru) { ru.broadcast_banned = 0; renderUsers(); }
    if (ME && +ME.id === +user_id) toast('أُلغيت صلاحية الصعود إلى البث — يمكنك البث مجدداً', true);
  });
  SOCKET.on('mute_changed', ({ muted }) => {
    if (!ME) return;
    ME.muted = muted ? 1 : 0;
    // الكتم لا يُنهي البث، بل يُسكّت ميكروفون المذيع إجبارياً (يظل داخل البث حتى يُفكّ الكتم من المشرف فيستأنف).
    if (BCAST && BCAST.isHost && BCAST.localStream) {
      BCAST.localStream.getAudioTracks().forEach(t => { t.enabled = !muted; });
      AUDIO_BCAST_HOST_MUTED = !!muted;
      bcastUpdateHostMuteButton();
    }
    bcastRenderBar();
    toast(muted ? 'قامت الإدارة بكتمك — تم كتم ميكروفونك إجبارياً 🚫' : 'قامت الإدارة بإلغاء كتمك — عاد ميكروفونك للعمل 🎙️', !muted);
  });
  SOCKET.on('kicked', ({ roomId, text }) => {
    if (!CUR_ROOM || +roomId !== CUR_ROOM.id) return;
    closeOv('userSheet');
    leaveRoom();
    showScreen('rooms');
    toast(text || 'تم طردك من الغرفة', false);
  });
  SOCKET.on('banned', ({ text, reason }) => {
    hideConnectionOverlay();
    showPersistentBanTemplate(reason || text || 'سلوك سيئ داخل الدردشة');
  });
  // شخص آخر دخل بالحساب نفسه — نُنهي هذه الجلسة ونعرض قالب التوضيح.
  SOCKET.on('session_conflict', ({ text }) => {
    hideConnectionOverlay();
    if (typeof showSessionConflictTemplate === 'function') showSessionConflictTemplate(text);
  });
  // حساب غير مُفعَّل بريده — نعرض شاشة رمز التحقق
  SOCKET.on('needs_verification', ({ email }) => {
    if (ME && ME.registered && !ME.email_verified) {
      hideConnectionOverlay();
      showEmailVerification(email, CHAT_TOKEN);
    }
  });
  socket.on('disconnect', reason => {
    if (socket !== SOCKET || !ME || !CHAT_TOKEN || reason === 'io client disconnect') return;
    // حساب غير مُفعَّل: الخادم يفصله حتى الإدخال الصحيح لرمز التحقق — لا نعيد الاتصال في حلقة
    if (typeof PENDING_VERIFY !== 'undefined' && PENDING_VERIFY) {
      CONNECTION_INTERRUPTED = false;
      hideConnectionOverlay();
      return;
    }
    CONNECTION_INTERRUPTED = true;
    showConnectionOverlay(navigator.onLine ? 'جارٍ إعادة الاتصال...' : 'بانتظار عودة اتصال الإنترنت...', true);
    // فصل الخادم لا يعاد تلقائياً بواسطة Socket.IO، لذا نشغّل المحاولة يدوياً.
    if (reason === 'io server disconnect') setTimeout(() => {
      if (socket === SOCKET && ME && CHAT_TOKEN && !socket.connected && !(typeof PENDING_VERIFY !== 'undefined' && PENDING_VERIFY)) {
        refreshSocketHandshakeKey(socket);
        socket.connect();
      }
    }, 100);
  });
  socket.on('connect_error', () => {
    if (socket !== SOCKET || !ME || !CHAT_TOKEN) return;
    CONNECTION_INTERRUPTED = true;
    showConnectionOverlay(navigator.onLine ? 'جارٍ إعادة الاتصال...' : 'بانتظار عودة اتصال الإنترنت...', true);
  });
  socket.io.on('reconnect_attempt', attempt => {
    if (socket !== SOCKET || !ME || !CHAT_TOKEN) return;
    // كل محاولة Engine.IO جديدة يجب أن تحمل key جديداً كي لا تُعد تكراراً.
    refreshSocketHandshakeKey(socket);
    CONNECTION_INTERRUPTED = true;
    const status = APP_LANG === 'en' ? `Reconnection attempt ${attempt}...` : `محاولة إعادة الاتصال رقم ${attempt}...`;
    showConnectionOverlay(status, true);
  });
  socket.io.on('reconnect_failed', () => {
    if (socket === SOCKET && ME && CHAT_TOKEN)
      showConnectionOverlay('تعذر الاتصال، اضغط على زر اتصال للمحاولة مجددًا', false);
  });
  SOCKET.on('err', (t) => toast(t, false));
  SOCKET.on('message_too_long', payload => showMessageLengthTemplate(payload));
  SOCKET.on('slow_down', payload => showSlowDownTemplate(payload));

  // ===== أحداث المكالمات الصوتية الخاصة (1-to-1 WebRTC) =====
  SOCKET.on('call:incoming', ({ from, type }) => {
    handleIncomingPrivateCall(from, type);
  });
  SOCKET.on('call:accepted', async ({ from, type }) => {
    await handlePrivateCallAccepted(from, type);
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
      // لا نعرض إشعار خصم إذا كانت التكلفة المجانية صفراً.
      if (+amount > 0) toast(`تم خصم ${amount} ذهب رسوم المكالمة (الرصيد: ${balance}) 🪙`);
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
  // إشعار مكالمة الفيديو: الطرف الآخر أغلق/فتح كاميرته
  SOCKET.on('call:cam_state', ({ fromId, on }) => {
    if (!PM_CALL || PM_CALL.peerId !== +fromId || PM_CALL.callType !== 'video') return;
    const pill = $('#pmRemoteCamOff');
    const nameEl = $('#pmRemoteCamOffName');
    if (pill) {
      if (!on) {
        if (nameEl) nameEl.textContent = PM_CALL.peerName;
        pill.style.display = 'flex';
      } else {
        pill.style.display = 'none';
      }
    }
    toast(on ? `${PM_CALL.peerName} فتح الكاميرا 📷` : `${PM_CALL.peerName} أغلق الكاميرا 📷`);
  });

  // ---------- أحداث البث المباشر (متعدد المذيعين) ----------
  SOCKET.on('bcast:started', ({ roomId, mode, host, hosts, primaryHostId }) => {
    ROOM_BCAST[roomId] = { mode, hosts, primaryHostId, viewers: 0 };
    syncRoomUserBroadcastFlags(roomId);
    if (CUR_ROOM && +roomId === CUR_ROOM.id) {
      bcastRenderBar();
      if (ME && host.id === ME.id) return; // أنا المذيع، الشاشة مفتوحة أصلاً من bcastStart
      if (mode === 'audio') bcastViewerAutoConnectAudio(roomId, hosts);
    }
  });
  // مذيع إضافي انضم لبث قائم بالفعل في الغرفة
  SOCKET.on('bcast:host_joined', ({ roomId, host, hosts, primaryHostId }) => {
    if (ROOM_BCAST[roomId]) { ROOM_BCAST[roomId].hosts = hosts; ROOM_BCAST[roomId].primaryHostId = primaryHostId; }
    syncRoomUserBroadcastFlags(roomId);
    if (!CUR_ROOM || +roomId !== CUR_ROOM.id) return;
    bcastRenderBar();
    if (ME && host.id === ME.id) return; // هذا أنا، تمت التهيئة بالفعل من bcastStart
    if (!BCAST || BCAST.roomId !== +roomId) return;
    // [بثوث مستقلة] في الفيديو لا يظهر المذيع الجديد تلقائياً لأي أحد (مذيعاً كان أو مشاهداً) —
    // لرؤية بثه يجب إرسال طلب مشاهدة له والنقر على صورته في شريط البث. في الصوت يُسجَّل فوراً (سماع تلقائي).
    if (BCAST.mode === 'audio') bcastRegisterHost(host);
  });
  SOCKET.on('bcast:stopped', ({ roomId }) => {
    delete ROOM_BCAST[roomId];
    syncRoomUserBroadcastFlags(roomId);
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
    syncRoomUserBroadcastFlags(roomId);
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
  // رد المذيع المطلوب على طلب المشاهدة (يصل للمشاهد أو لمذيعٍ طلب مشاهدة مذيع آخر)
  SOCKET.on('bcast:watch_response', ({ roomId, accept, hosts, hostId, reason }) => {
    if (!BCAST || BCAST.roomId !== +roomId) return;
    const approvedHost = (hosts || [])[0] || null;
    const respondedId = +(hostId || (approvedHost && approvedHost.id) || 0);
    if (respondedId) bcastPendingSet().delete(respondedId);
    if (accept && approvedHost) {
      // [بثوث متزامنة] يُضاف هذا البث إلى ما أشاهده حالياً دون إيقاف أي بث آخر مقبول مسبقاً
      bcastWatchingSet().add(+approvedHost.id);
      bcastRegisterHost(approvedHost);
      if (BCAST.mode === 'video') bcastEnsureTile(+approvedHost.id, approvedHost);
      if (!BCAST.isHost) {
        // مشاهد عادي: أظهر البث وأوقف رسالة الانتظار
        $('#bcastWaitMsg').hidden = true;
        $('#bcastLeaveBtn').hidden = false;
      } else {
        // مذيع يشاهد مذيعاً آخر: بثّه مستمر كما هو وتظهر بلاطة المذيع المقبول بجانب كاميرته
        toast(`${approvedHost.username} وافق على مشاهدتك لبثه`, true);
      }
      bcastUpdateHeader();
      bcastFlushSignalQueue();
    } else if (BCAST.isHost) {
      // مذيع: بثّه سليم؛ الرفض يخص الطلب المعلق فقط — كل مشاهداته الحالية تبقى شغالة
      toast(reason === 'host_ended' ? 'انتهى بث المذيع الذي طلبت مشاهدته' : 'رفض المذيع طلب مشاهدتك لبثه', false);
    } else if (bcastWatchingSet().size) {
      // مشاهد يتابع بثوثاً أخرى: الرفض لا يؤثر عليها إطلاقاً
      toast(reason === 'host_ended'
        ? 'انتهى بث المذيع الذي طلبت مشاهدته — بقية البثوث ما زالت تعمل'
        : 'رفض المذيع طلبك — بقية البثوث ما زالت تعمل', false);
    } else if (bcastPendingSet().size) {
      // ما زال هناك طلب آخر معلّق — لا نغلق الشاشة
      toast(reason === 'host_ended' ? 'انتهى بث المذيع' : 'رفض المذيع طلب مشاهدتك للبث', false);
    } else {
      toast(reason === 'host_ended' ? 'انتهى بث المذيع' : 'رفض المذيع طلب مشاهدتك للبث', false);
      bcastResetState();
      bcastRenderBar();
    }
  });
  // المذيع الذي أشاهده أنهى بثه (للمشاهدين المعتمدين لديه تحديداً)
  SOCKET.on('bcast:watch_ended', ({ roomId, hostId }) => {
    if (!CUR_ROOM || +roomId !== CUR_ROOM.id || !BCAST || BCAST.roomId !== +roomId || BCAST.mode !== 'video') return;
    bcastClosePeer(+hostId, 'in');
    bcastRemoveTile(+hostId);
    bcastWatchingSet().delete(+hostId);
    bcastPendingSet().delete(+hostId);
    if (!BCAST.isHost) {
      // بقية البثوث التي أشاهدها تستمر؛ لا نغلق الشاشة إلا إن لم يبقَ شيء
      if (!bcastWatchingSet().size && !bcastPendingSet().size) {
        toast('انتهى بث المذيع', false);
        bcastResetState();
        bcastRenderBar();
        return;
      }
      toast('انتهى أحد البثوث التي تشاهدها — البقية ما زالت تعمل', false);
      bcastUpdateHeader();
    } else {
      toast('انتهى بث المذيع الذي تشاهده — بثّك ما زال مستمراً', false);
      bcastUpdateHeader();
    }
  });
  // مشاهد/مستمع غادر (يصل للمذيع المعني فقط)
  SOCKET.on('bcast:viewer_left', ({ userId }) => {
    if (!BCAST || !BCAST.isHost) return;
    // أغلق فقط اتصال الإرسال نحوه (كان يشاهدني)؛ قد يبقى اتصال استقبال إن كنت أشاهده أنا أيضاً
    bcastClosePeer(userId, BCAST.mode === 'audio' ? 'both' : 'out');
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
  SOCKET.on('bcast:speak_response', async ({ roomId, accept, existingHosts, viewers, reason }) => {
    if (!CUR_ROOM || +roomId !== CUR_ROOM.id) return;
    SPEAK_REQUEST_PENDING = false;
    if (!accept) { toast(reason || 'رفض المضيف طلب تحدثك', false); bcastRenderBar(); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { return toast('تعذر الوصول إلى الميكروفون، تحقق من الأذونات', false); }
    bcastResetState(); // أغلق اتصالات الاستماع السابقة (استقبال فقط) قبل التحوّل إلى مذيع ثنائي الاتجاه
    BCAST = { roomId: +roomId, mode: 'audio', isHost: true, isPrimary: false, hosts: new Map(), localStream: stream, peers: new Map(), watching: new Set(), pendingTargets: new Set() };
    bcastLevelAttach(ME.id, stream); // مؤشر «يتحدث» لميكروفوني
    bcastSetFloatingMode('audio');
    AUDIO_BCAST_HOST_MUTED = false;
    bcastUpdateHostMuteButton();
    openOv('bcastOv');
    try {
      bcastRegisterHost({ id: ME.id, username: ME.username, avatar: ME.avatar || '', badge: badgeOf(ME) }, true);
      (existingHosts || []).forEach(h => { bcastRegisterHost(h); bcastConnectToPeer(h.id); });
      (viewers || []).forEach(id => bcastConnectToPeer(+id));
      bcastFlushSignalQueue();
    } catch (err) {
      console.error('speak_response error:', err);
    }
    toast('تم قبولك للتحدث — أنت الآن أحد المذيعين', true);
    bcastRenderBar();
    setTimeout(() => { try { bcastRenderBar(); } catch (e) {} }, 150);
  });
  // [للمتحدث الذي أُزيل] أعادني المضيف الأساسي/المشرف إلى وضع الاستماع
  SOCKET.on('bcast:speaker_removed', ({ roomId }) => {
    if (!CUR_ROOM || +roomId !== CUR_ROOM.id) return;
    toast('أنهيت من البث — أُعدت إلى وضع المستمع', false);
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

// الغرف الصوتية (type=voice) هي الوحيدة التي تعرض شريط البث وزر «تحدث» بجانب الميكروفون.
// أما الغرف الافتراضية (type=default) فهي «كتابية فقط»: يُخفى شريط البث (#liveBar) بالكامل
// ولا يُعرض زر «تحدث» — الصعود كمذيع متاح في الغرف الصوتية فقط.
function updateVoiceRoomBarUI() {
  const voiceRoom = !!(CUR_ROOM && CUR_ROOM.type === 'voice');
  const bar = $('#liveBar');
  if (bar) bar.hidden = !voiceRoom;
  const btn = $('#btnTalkLive');
  if (!btn) return;
  btn.hidden = !voiceRoom;
  btn.classList.toggle('on-air', !!(voiceRoom && ROOM_BCAST[CUR_ROOM.id]));
}

// شكل «لا يوجد احد في البث المباشر حي الان» قبل صعود أي مذيع في الغرفة الصوتية:
// دائرة حمراء عليها أيقونة ميكروفون بيضاء + النص (كما في القالب الأصلي).
function renderIdleRoomNotice() {
  const el = $('#roomNotice');
  if (!el) return;
  el.classList.add('is-idle');
  el.innerHTML =
    '<span style="margin:1px 3px 4px 47px">لا يوجد احد في البث المباشر حي الان</span>' +
    '<div class="red-circle3333 skin_color"></div>' +
    '<img class="video-icon3333" src="https://up6.cc/2025/10/176422975625851.gif" alt="ميكروفون">';
}

// يحدّث شريط البث أعلى شاشة الدردشة حسب حالة الغرفة الحالية
function bcastRenderBar() {
  const bar = $('#liveBar'); const muteBtn = $('#liveBarMute');
  const hostsBox = $('#liveBarHosts');
  const videoBroadcastFx = $('#containersacscs');
  const audioBroadcastFx = $('#containersacscs_Audio');
  updateVoiceRoomBarUI();
  if (!CUR_ROOM) return;
  // غرفة افتراضية: «كتابية فقط» — لا يُعرض شريط البث ولا أي عنصر من عناصره.
  if (CUR_ROOM.type !== 'voice') {
    if (bar) { bar.classList.remove('is-live'); bar.onclick = null; }
    if (muteBtn) { muteBtn.hidden = true; muteBtn.classList.remove('is-muted'); }
    return;
  }
  const state = ROOM_BCAST[CUR_ROOM.id];
  // عند وجود بث، نعرض بطاقات المذيعين فقط بدلاً من الجملة الطويلة في الشريط.
  $('#roomNotice').hidden = !!state;
  // عند وجود بث نزيل شكل «لا يوجد مذيع» (الدائرة الحمراء + الميكروفون) ونعرض نص البث العادي.
  if (state) $('#roomNotice').classList.remove('is-idle');
  // يظهر مؤثر واحد على الطرف الآخر فقط مع مذيع واحد، ويختفي عند تعدد المذيعين.
  const singleHost = !!(state && (state.hosts || []).length === 1);
  videoBroadcastFx.hidden = !(singleHost && state.mode === 'video');
  audioBroadcastFx.hidden = !(singleHost && state.mode === 'audio');
  const iAmHost = BCAST && BCAST.isHost && BCAST.roomId === CUR_ROOM.id;
  bar.classList.toggle('is-live', !!state);
  // نظام ظهور زر الكتم المستقل بجانب الشاشة:
  //  • المستمع: يظهر دوماً أثناء البث الصوتي (لكتم ما يسمعه)
  //  • المذيع: يظهر فقط عندما يكون هناك مذيعان أو أكثر (لكتم المذيعين الآخرين)
  //    — وأنا وحدي على المايك لا يظهر لي (لا يوجد أحد لكتمه)
  muteBtn.hidden = !(state && state.mode === 'audio' && (!iAmHost || (state.hosts || []).length > 1));
  muteBtn.classList.toggle('is-muted', AUDIO_BCAST_MUTED);
    if (hostsBox) {
      const hosts = (state && state.hosts) || [];
      // كل المذيعين في المنطقة القابلة للتمرير الأفقي — بدون سقف
      // في وضع الفيديو (الغرف الافتراضية): البثوث مستقلة — أي شخص (مشاهد أو مذيع آخر) يطلب مشاهدة مذيع بعينه
      // بالنقر على صورته، فلا يشاهد إلا من وافق على طلبه تحديداً — ويمكنه متابعة أكثر من مذيع في نفس الوقت،
      // فكل بث وُوفق على طلبه يعمل بشكل طبيعي بجانب البثوث الأخرى.
      const pickable = !!(state && state.mode === 'video');
      const modClickable = canModerateRank(); // المشرف ينقر على المذيع لفتح أزرار السحب/المنع
      hostsBox.innerHTML = hosts.map(h => `<span class="lb-host-chip${pickable ? ' watchable' : ''}${modClickable ? ' mod' : ''}" data-hid="${h.id}" title="${esc(h.username)}">
        <span class="lb-host-photo">${bcastAvatarChip(h.avatar)}</span><small class="lb-host-label">${esc(h.username)}</small>
      </span>`).join('');
      // إعادة تطبيق حالة «يتحدث» على الشرائح الجديدة (إعادة البناء تمسح الصفات)
      try { bcastApplySpeaking(); } catch (e) {}
    hostsBox.querySelectorAll('.lb-host-chip').forEach(chip => {
      chip.onclick = (e) => {
        e.stopPropagation();
        const h = hosts.find(x => x.id === +chip.dataset.hid);
        if (!h) return;
        if (ME && h.id === ME.id) { if (iAmHost) openOv('bcastOv'); return; } // صورتي أنا: أعد فتح شاشة بثي
        // المشرف: ينقر على المذيع لفتح ورقة المستخدم فيها أزرار «سحب المايك / سحب مع منع صعود / فك من البث».
        // على الكمبيوتر تُفتح الورقة ملتصقة بجانب صورة/اسم المذيع؛ وعلى الجوال تبقى ورقة سفلية كالمعتاد.
        if (modClickable) return openUserSheet(+h.id, null, chip);
        if (pickable) return bcastOpenWatchConfirm(h);
      };
    });
  }
  if (!state) {
    // لا يوجد بث حالياً — الصعود كمذيع يتم الآن حصرياً من زر «تحدث» بجانب الميكروفون.
    renderIdleRoomNotice();
    SPEAK_REQUEST_PENDING = false;
    bar.onclick = null;
    return;
  }
  const names = (state.hosts || []).map(h => h.username);
  const extra = names.length > 1 ? ` و${names.length - 1} آخرين` : '';
  if (state.mode === 'audio') {
    $('#roomNotice').textContent = iAmHost ? 'أنت تبث صوتياً الآن في هذه الغرفة' : `${names[0]}${extra} يتحدث الآن مباشرة`;
    bar.onclick = () => { if (iAmHost) openOv('bcastOv'); };
  } else {
    $('#roomNotice').textContent = iAmHost ? 'أنت تبث فيديو الآن'
      : (names.length > 1 ? `${names[0]}${extra} يبثون فيديو مباشر الآن — اضغط على صورة أحدهم للمشاهدة`
        : `${names[0]} يبث فيديو مباشر الآن — اضغط على صورته للمشاهدة`);
    // طلب المشاهدة يفتح حصرياً بالنقر على صورة المذيع (.lb-host-chip داخل شريط البث) —
    // النقر على الشريط نفسه لا يفتح أي طلب مشاهدة.
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
  const isAdminMuted = !!(ME && ME.muted);
  const isMuted = isAdminMuted || AUDIO_BCAST_HOST_MUTED;
  btn.classList.toggle('is-muted', isMuted);
  btn.classList.toggle('is-admin-muted', isAdminMuted);
  if (isAdminMuted) {
    btn.setAttribute('title', 'تم كتمك إجبارياً من المشرف — لا يمكنك إلغاء الكتم حتى يتم فكه من الإدارة');
  } else {
    btn.setAttribute('title', isMuted ? 'إلغاء كتم صوتي كمذيع' : 'كتم صوتي كمذيع');
  }
  $('#bcastHostMuteIcon').textContent = isMuted ? 'mic_slash_fill' : 'mic_fill';
}

// يعيد كل شيء إلى الوضع الافتراضي: إغلاق اتصالات WebRTC وإيقاف الوسائط وإخفاء الشاشة
// ===== مؤشر «يتحدث الآن» — توهج نابض حول صورة المتكلم =====
// يحلل مستوى صوت كل مذيع (AnalyserNode) ويشغل/يطفئ المؤشر حول صورته،
// فيعرف المستمعون من يتحدث عندما يكون هناك أكثر من مذيع.
let BCAST_LEVEL_CTX = null;
const BCAST_LEVELS = new Map(); // hostId -> { source, analyser, buf, level, speaking }
let BCAST_LEVEL_RAF = 0, BCAST_LEVEL_LAST = 0, BCAST_LEVEL_RESYNC_LAST = 0, BCAST_LEVEL_APPLY_LAST = 0;

function bcastLevelCtx() {
  try {
    const Ctor = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext))
      || (typeof AudioContext !== 'undefined' ? AudioContext : null);
    if (!Ctor) return null;
    if (!BCAST_LEVEL_CTX) BCAST_LEVEL_CTX = new Ctor();
    if (BCAST_LEVEL_CTX.state === 'suspended') {
      try { BCAST_LEVEL_CTX.resume().catch(() => {}); } catch (e) {}
    }
    return BCAST_LEVEL_CTX;
  } catch (e) { return null; }
}
function bcastLevelAttach(hostId, stream) {
  if (!hostId || !stream) return;
  const track = stream.getAudioTracks ? stream.getAudioTracks()[0] : null;
  if (!track || BCAST_LEVELS.has(hostId)) return;
  const ctx = bcastLevelCtx();
  if (!ctx) return;
  try {
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.5;
    source.connect(analyser);
    BCAST_LEVELS.set(hostId, { source, analyser, buf: new Uint8Array(analyser.fftSize), level: 0, speaking: false });
    if (!BCAST_LEVEL_RAF) BCAST_LEVEL_RAF = requestAnimationFrame(bcastLevelTick);
  } catch (e) {}
}
function bcastLevelDetach(hostId) {
  const e = BCAST_LEVELS.get(hostId);
  if (!e) return;
  try { if (e.source) e.source.disconnect(); } catch (err) {}
  BCAST_LEVELS.delete(hostId);
  // إطفاء المؤشر الخاص بهذا المذيع (لم يعد ضمن من نتتبعهم)
  try {
    document.querySelectorAll(`.lb-host-chip[data-hid="${hostId}"], .bcast-speaker-row[data-uid="${hostId}"], #bcastTile_${hostId}`).forEach(el => {
      el.classList.remove('is-speaking');
    });
  } catch (er) {}
  try { bcastApplySpeaking(); } catch (e2) {}
  if (!BCAST_LEVELS.size && BCAST_LEVEL_RAF) { cancelAnimationFrame(BCAST_LEVEL_RAF); BCAST_LEVEL_RAF = 0; }
}
function bcastLevelDetachAll() {
  try { [...BCAST_LEVELS.keys()].forEach(id => bcastLevelDetach(id)); } catch (e) {}
}
// مزامنة دورية: أي مذيع بلا محلل نحاول ربطه من عنصر الصوت/البلاطة (يغطي أي ontrack فُقد)
function bcastLevelResync() {
  if (!BCAST || !BCAST.hosts) return;
  BCAST.hosts.forEach((info, id) => {
    const hid = +id;
    if (BCAST_LEVELS.has(hid)) return;
    let stream = null;
    if (ME && hid === ME.id) stream = BCAST.localStream;
    else {
      const el = document.getElementById('bcastAudio_' + hid);
      if (el && el.srcObject) stream = el.srcObject;
      else {
        const tile = document.getElementById('bcastTile_' + hid);
        if (tile) { const v = tile.querySelector('video'); if (v && v.srcObject) stream = v.srcObject; }
      }
    }
    if (stream) bcastLevelAttach(hid, stream);
  });
}
function bcastLevelTick(now) {
  BCAST_LEVEL_RAF = requestAnimationFrame(bcastLevelTick);
  if (now - BCAST_LEVEL_LAST < 50) return; // ~20 فحص/ثانية يكفي
  BCAST_LEVEL_LAST = now;
  if (!BCAST_LEVEL_CTX || BCAST_LEVEL_CTX.state !== 'running') return; // يُعاد تلقائياً بعد استيقاظ السياق
  if (now - BCAST_LEVEL_RESYNC_LAST > 2000) {
    BCAST_LEVEL_RESYNC_LAST = now;
    try { bcastLevelResync(); } catch (e) {}
  }
  let changed = false;
  for (const [id, e] of BCAST_LEVELS) {
    try {
      e.analyser.getByteTimeDomainData(e.buf);
      let sum = 0;
      for (let i = 0; i < e.buf.length; i++) { const v = (e.buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / e.buf.length);
      e.level = Math.max(rms, e.level * 0.82); // تلاشٍ تدريجي: لا يرتد المؤشر لحظة الصمت
      const speaking = e.level > 0.045;
      if (speaking !== e.speaking) { e.speaking = speaking; changed = true; }
    } catch (err) {}
  }
  // إعادة تطبيق الحالة عند كل تغيير + كل ثانية (إعادة بناء الشرائح تمسح الصفات)
  if (changed || now - BCAST_LEVEL_APPLY_LAST >= 1000) {
    BCAST_LEVEL_APPLY_LAST = now;
    try { bcastApplySpeaking(); } catch (e2) {}
  }
}
function bcastApplySpeaking() {
  for (const [id, e] of BCAST_LEVELS) {
    const on = e.speaking;
    // عناصر واجهة البث فقط: شريحة الشريط / صف المتحدثين / بلاطة الفيديو
    document.querySelectorAll(`.lb-host-chip[data-hid="${id}"], .bcast-speaker-row[data-uid="${id}"], #bcastTile_${id}`).forEach(el => {
      el.classList.toggle('is-speaking', on);
    });
  }
}

function bcastResetState() {
  if (BCAST) {
    if (BCAST.localStream) BCAST.localStream.getTracks().forEach(t => t.stop());
    if (BCAST.peers) for (const pc of BCAST.peers.values()) { try { pc.close(); } catch (e) { } }
  }
  BCAST = null;
  BCAST_SIGNAL_QUEUE = [];
  BCAST_STREAMS.clear();     // انتهى البث — امسح سجلّ التدفّقات حتى لا يُحيي العداد أصواتاً قديمة
  bcastStopAudioWatchdog();  // أوقف عدّاد حماية الصوت
  SPEAK_REQUEST_PENDING = false;
  AUDIO_BCAST_HOST_MUTED = false;
  bcastLevelDetachAll();
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
  const watching = [...bcastWatchingSet()].map(id => BCAST.hosts.get(id)).filter(Boolean);
  if (BCAST.isHost) {
    // مذيع: بطاقته الشخصية + عدد مشاهديه المقبولين (اتصالات الإرسال) + البثوث التي يشاهدها هو
    $('#bcastHostAvatar').innerHTML = bcastAvatarChip(ME ? (ME.avatar || '') : '');
    $('#bcastHostName').textContent = (ME && ME.username) || '-';
    const viewerCount = [...BCAST.peers.keys()].filter(k => {
      const [dir, id] = String(k).split(':');
      return BCAST.mode === 'video' ? dir === 'out' : !BCAST.hosts.has(+id);
    }).length;
    let txt = `${viewerCount} مشاهد`;
    if (BCAST.mode === 'video' && watching.length) {
      txt += watching.length === 1
        ? ` • تشاهد بث ${watching[0].username}`
        : ` • تشاهد ${watching.length} بثوث`;
    }
    $('#bcastViewersCount').textContent = txt;
  } else {
    // مشاهد: بطاقة المذيع الذي يشاهده (أو عدد البثوث إن كان يتابع أكثر من مذيع في نفس الوقت)
    const t = watching[0] || (BCAST.hosts.size ? [...BCAST.hosts.values()][BCAST.hosts.size - 1] : null);
    $('#bcastHostAvatar').innerHTML = bcastAvatarChip(t ? t.avatar : '');
    $('#bcastHostName').textContent = watching.length > 1
      ? `${t.username} +${watching.length - 1}`
      : (t ? t.username : '-');
    $('#bcastViewersCount').textContent = watching.length > 1
      ? `تشاهد ${watching.length} بثوث مباشرة`
      : (t ? 'مشاهدة مباشرة' : '-');
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
  bcastLevelDetach(hostId);
  if (BCAST.mode === 'video') {
    bcastRemoveTile(hostId);
    bcastWatchingSet().delete(+hostId);
    bcastPendingSet().delete(+hostId);
  }
  else bcastRemoveAudioEl(hostId);
  bcastUpdateHeader();
  bcastRenderSpeakersList();
}
function bcastTileId(hostId) { return 'bcastTile_' + hostId; }
function bcastEnsureTile(hostId, hostInfo) {
  const isSelf = hostId === (ME && ME.id);
  let tile = document.getElementById(bcastTileId(hostId));
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'bcast-tile is-loading';
    tile.id = bcastTileId(hostId);
    tile.innerHTML = `
      <video autoplay playsinline${isSelf ? ' muted' : ''}></video>
      <span class="bcast-tile-vignette"></span>
      <span class="bcast-tile-live">مباشر</span>
      <span class="bcast-tile-name"></span>
      <button class="bcast-tile-x" type="button" title="إيقاف مشاهدة هذا البث"><i class="f7-icons">xmark</i></button>`;
    const v = tile.querySelector('video');
    v.onloadedmetadata = () => { tile.classList.remove('is-loading'); v.play().catch(() => { }); };
    // نقرة مزدوجة على البلاطة = ملء الشاشة (تجربة مشاهدة واقعية)
    tile.ondblclick = () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
      else (tile.requestFullscreen ? tile.requestFullscreen() : Promise.reject()).catch(() => { });
    };
    tile.querySelector('.bcast-tile-x').onclick = (e) => { e.stopPropagation(); bcastStopWatchingHost(hostId); };
    $('#bcastGrid').appendChild(tile);
  }
  tile.classList.toggle('is-self', isSelf);
  // زر الإيقاف يظهر فقط لبلاطات أشخاص أشاهدهم (ليس لكاميرتي الخاصة)
  tile.classList.toggle('can-stop', !!(BCAST && BCAST.mode === 'video' && !isSelf));
  const nameEl = tile.querySelector('.bcast-tile-name');
  nameEl.textContent = hostInfo ? (isSelf ? `${hostInfo.username} (أنت)` : hostInfo.username) : '';
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
  tile.classList.remove('is-loading');
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
  BCAST_STREAMS.delete(String(hostId)); // المذيع غادر/أُزيل — انسَ تدفّقه
  bcastLevelDetach(hostId);
}
// يعرض تدفق وسائط وارداً من طرف معيّن (مذيع أرسل عرضاً لي كمشاهد/كمذيع أشاهده) في المكان المناسب
function bcastAttachRemoteStream(fromUserId, stream) {
  if (!BCAST) return;
  // نحتفظ بالتدفّق في سجلّ دائم مستقل عن BCAST حتى لا يضيع الصوت عند إعادة بناء الحالة.
  if (stream) BCAST_STREAMS.set(String(fromUserId), stream);
  // مؤشر «يتحدث»: تحليل مستوى صوت هذا الطرف (مذيع/مستمع)
  bcastLevelAttach(fromUserId, stream);
  if (BCAST.mode === 'audio') {
    const el = bcastEnsureAudioEl(fromUserId);
    el.srcObject = stream;
    // إعادة تشغيل صريحة - لا نعتمد على autoplay فقط الذي قد تفشله بعض المتصفحات.
    bcastTryPlayAudioEl(el);
    bcastEnsureAudioWatchdog();
  } else {
    // أنشئ البلاطة فوراً إن لم تكن موجودة (قد يصل التدفق قبل تسجيل معلومات المذيع)
    if (!document.getElementById(bcastTileId(fromUserId))) bcastEnsureTile(fromUserId, BCAST.hosts.get(fromUserId) || null);
    bcastAttachStreamToTile(fromUserId, stream);
  }
}

// محاولة تشغيل عنصر صوت بلا استثناء (أعدّ سمة muted حتى لا تطلب إذن المستخدم)
function bcastTryPlayAudioEl(el) {
  if (!el || !el.srcObject) return;
  try {
    el.muted = AUDIO_BCAST_MUTED;
    const p = el.play();
    if (p && typeof p.catch === 'function') p.catch(() => { /* تجاهل رفض التشغيل المتقلّب */ });
  } catch (e) { /* تجاهل */ }
}

// Watchdog دوري: يضمن بقاء صوت كل مذيع في بث صوتي نشط متصلاً وليس ناقصاً أو موقوفاً.
// يعالج انقطاع الصوت عند: تحديث أي شيء في الصفحة، فتح قالب/نافذة منبثقة، عودة المستخدم
// من تبويب خلفي جمّده المتصفح، أو أي إعادة بناء لعناصر الصوت — يعيد إنشاء/ربط/تشغيل العنصر.
function bcastEnsureAudioWatchdog() {
  if (BCAST_AUDIO_WATCHDOG) return;
  BCAST_AUDIO_WATCHDOG = setInterval(function () {
    const pool = document.getElementById('bcastAudioPool');
    // لا شيء نفعله إن انتهى البث فعلاً أو لم نعد في وضع صوتي.
    if (!pool || !BCAST || BCAST.mode !== 'audio') return;
    // نطاق المذيعين المسجّلين فعلياً في هذا البث — لا نُحيي أصوات مذيعين غادروا.
    BCAST.hosts.forEach(function (host, uid) {
      const stream = BCAST_STREAMS.get(String(uid));
      if (!stream) return;
      let el = document.getElementById('bcastAudio_' + uid);
      if (!el) {
        // أُزيل العنصر من DOM (إعادة بناء/مسح) لكن المذيع ما زال يبث — أنشئه من جديد.
        el = document.createElement('audio');
        el.id = 'bcastAudio_' + uid;
        el.autoplay = true; el.playsInline = true; el.muted = AUDIO_BCAST_MUTED;
        pool.appendChild(el);
        el.srcObject = stream;
      } else if (el.srcObject !== stream) {
        el.srcObject = stream;
      }
      // أعد التشغيل إن توقف لسببٍ ما، مع احترام كتم المستخدم.
      if (el.paused) bcastTryPlayAudioEl(el);
    });
  }, 900);
}

// إيقاف العدّاد بالكامل
function bcastStopAudioWatchdog() {
  if (BCAST_AUDIO_WATCHDOG) { clearInterval(BCAST_AUDIO_WATCHDOG); BCAST_AUDIO_WATCHDOG = null; }
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
  const modClickable = canModerateRank();
  box.innerHTML = `<div class="bcast-speakers-title">المتحدثون الحاليون</div>` + others.map(h => `
    <div class="bcast-speaker-row" data-uid="${h.id}">
      <span class="req-avatar">${bcastAvatarChip(h.avatar)}</span>
      <span class="req-name">${esc(h.username)}</span>
      <button class="bcast-speaker-remove" type="button" data-uid="${h.id}">إزالة</button>
    </div>`).join('');
  box.querySelectorAll('.bcast-speaker-remove').forEach(btn => {
    btn.onclick = () => SOCKET.emit('bcast:remove_speaker', CUR_ROOM.id, +btn.dataset.uid);
  });
  // المشرف: النقر على صف المذيع يعرض أزرار «سحب المايك / سحب مع منع صعود / فك من البث».
  if (modClickable) box.querySelectorAll('.bcast-speaker-row').forEach(row => {
    row.style.cursor = 'pointer';
    row.onclick = () => openUserSheet(+row.dataset.uid, null, row);
  });
  // إعادة تطبيق حالة «يتحدث» على الصفوف الجديدة (إعادة البناء تمسح الصفات)
  try { bcastApplySpeaking(); } catch (e) {}
}

// ===== اتصالات WebRTC اتجاهية =====
// مفاتيح الاتصالات في BCAST.peers تحدد الاتجاه لكل طرف:
//   'out:UID'  → أرسل بثّي لهذا الطرف (مشاهد وافقَ على طلبه عندي)
//   'in:UID'   → أستقبل بثّه (مذيع وافق على طلب مشاهدتي له) — اتصال أحادي لا يحمل كاميرتي إطلاقاً
//   'both:UID' → بث صوتي ثنائي الاتجاه (mesh بين المذيعين/المستمعين)
// بهذا يمكن لمذيعَين أن يشاهد كلٌّ منهما الآخر عبر اتصالين مستقلين، كل اتجاه بموافقة صاحبه وحده.
function bcastPeerKey(uid, dir) { return dir + ':' + uid; }
// الاتجاه المقابل: ما أرسله أنا كـ'out' يستقبله الطرف الآخر كـ'in' والعكس، و'both' يقابل نفسه.
function bcastOppositeDir(dir) { return dir === 'out' ? 'in' : dir === 'in' ? 'out' : 'both'; }
function bcastGetPeer(uid) {
  if (!BCAST || !BCAST.peers) return null;
  for (const dir of ['in', 'out', 'both']) {
    const pc = BCAST.peers.get(bcastPeerKey(uid, dir));
    if (pc) return pc;
  }
  return null;
}
// [مهم] عند تبادل مذيعَين المشاهدة يوجد اتصالان مستقلان مع نفس الشخص ('in' و'out') —
// لذلك تحمل كل إشارة اتجاهها لدى مُرسِلها، ويستخرج المستقبل الاتصال الصحيح بالاتجاه المعاكس.
// بدون ذلك كان رد/مرشحات اتصال الإرسال تُطبَّق على اتصال الاستقبال فينقطع البثّان معاً.
function bcastPeerForSignal(uid, data) {
  if (!BCAST || !BCAST.peers) return null;
  if (data && data.dir) {
    const pc = BCAST.peers.get(bcastPeerKey(uid, bcastOppositeDir(data.dir)));
    if (pc) return pc;
  }
  return bcastGetPeer(uid);
}
function bcastSendSignal(remoteUserId, dir, payload) {
  if (!CUR_ROOM) return;
  SOCKET.emit('bcast:signal', CUR_ROOM.id, remoteUserId, { ...payload, dir });
}
// إنشاء اتصال WebRTC جديد مع طرف معيّن وربط أحداثه المشتركة
function bcastNewPeerConnection(key) {
  const [dir, rawId] = String(key).split(':');
  const remoteUserId = +rawId;
  const pc = new RTCPeerConnection(RTC_ICE_CONFIG);
  pc.onicecandidate = (e) => {
    if (e.candidate) bcastSendSignal(remoteUserId, dir, { type: 'candidate', candidate: e.candidate });
  };
  // [مذيع] إن سقط اتصال إرسالٍ مع طرف ما دون أن يغادر فعلياً — غالباً بسبب اضطراب شبكي عابر —
  // أعد الاتصال تلقائياً بدل ترك ذلك الطرف بلا تدفق. اتصالات الاستقبال ('in') يعيد صاحبها (المذيع المصدر) فتحها.
  pc.onconnectionstatechange = () => {
    if (pc.connectionState !== 'failed' && pc.connectionState !== 'disconnected') return;
    if (!BCAST || !BCAST.isHost || BCAST.peers.get(key) !== pc) return;
    if (dir === 'in') return; // اتصال استقبال: لا نعيد فتحه من طرفنا حتى لا نُلغي اتصال إرسالنا لنفس الشخص
    setTimeout(() => {
      if (BCAST && BCAST.isHost && BCAST.peers.get(key) === pc
        && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) bcastConnectToPeer(remoteUserId);
    }, 2000);
  };
  return pc;
}
// إغلاق اتصال مع طرف: يُحدد الاتجاه ('in'/'out'/'both') أو تُغلق كل الاتجاهات إن لم يحدد
function bcastClosePeer(userId, dir) {
  if (!BCAST || !BCAST.peers) return;
  const keys = dir ? [bcastPeerKey(userId, dir)] : ['in', 'out', 'both'].map(d => bcastPeerKey(userId, d));
  for (const k of keys) {
    const pc = BCAST.peers.get(k);
    if (pc) { try { pc.close(); } catch (e) { } BCAST.peers.delete(k); }
  }
}

// [مذيع] يبادر باتصال إرسال مع طرف (مشاهد وافق على مشاهدتي، أو مستمع صوتي) ويرسل له عرضاً (offer) يحمل تدفق وسائطي المحلي.
// طرف واحد فقط يبادر بكل اتصال لتفادي تصادم العروض.
async function bcastConnectToPeer(remoteUserId) {
  if (!BCAST || !BCAST.isHost || !BCAST.localStream) return;
  const dir = BCAST.mode === 'audio' ? 'both' : 'out';
  bcastClosePeer(remoteUserId, dir);
  const key = bcastPeerKey(remoteUserId, dir);
  const pc = bcastNewPeerConnection(key);
  BCAST.localStream.getTracks().forEach(track => pc.addTrack(track, BCAST.localStream));
  // [صوت فقط] يُستخدم ontrack عندما يكون الطرف الآخر مذيعاً أيضاً (بث ثنائي الاتجاه)؛
  // [فيديو] اتصالات 'out' أحادية الاتجاه: لا يصلني منه شيء (إن كان يبث وأريد مشاهدته فذلك اتصال 'in' مستقل بموافقته).
  if (dir === 'both') pc.ontrack = (e) => bcastAttachRemoteStream(remoteUserId, e.streams[0]);
  BCAST.peers.set(key, pc);
  bcastUpdateHeader();
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    bcastSendSignal(remoteUserId, dir, { type: 'offer', sdp: offer });
  } catch (e) { bcastClosePeer(remoteUserId, dir); }
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
// يستقبل إشارات WebRTC من طرف آخر ويرد عليها.
// [فيديو] كل عرض وارد هو اتصال استقبال ('in') أحادي الاتجاه نحوي — لا نرفق كاميرتي في الرد إطلاقاً،
// فمشاهدة طرفٍ لبثّي لا تعطيني حق مشاهدته؛ لكل اتجاه طلب وموافقة مستقلان.
// [صوت] المذيع الذي يرد على عرض مذيعٍ آخر يرفق صوته (اتصال ثنائي 'both').
async function bcastHandleSignal(fromUserId, data) {
  if (!BCAST) return;
  if (data.type === 'offer') {
    // اتجاه الاتصال عندي = عكس اتجاهه لدى مرسل العرض (يرسل 'out' ⇐ أستقبله 'in'، و'both' يبقى 'both')
    const dir = data.dir ? bcastOppositeDir(data.dir)
      : ((BCAST.mode === 'audio' && BCAST.isHost) ? 'both' : 'in');
    const key = bcastPeerKey(fromUserId, dir);
    let pc = BCAST.peers.get(key);
    if (!pc) {
      pc = bcastNewPeerConnection(key);
      if (dir === 'both' && BCAST.localStream) BCAST.localStream.getTracks().forEach(t => pc.addTrack(t, BCAST.localStream));
      pc.ontrack = (e) => bcastAttachRemoteStream(fromUserId, e.streams[0]);
      BCAST.peers.set(key, pc);
      bcastUpdateHeader();
    }
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    bcastSendSignal(fromUserId, dir, { type: 'answer', sdp: answer });
  } else if (data.type === 'answer') {
    const pc = bcastPeerForSignal(fromUserId, data);
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).catch(() => { });
  } else if (data.type === 'candidate') {
    const pc = bcastPeerForSignal(fromUserId, data);
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => { });
  }
}

// [مستمع] تهيئة الاستماع التلقائي عند وجود بث صوتي قائم في غرفة صوتية — لا حاجة لأي طلب
function bcastViewerAutoConnectAudio(roomId, hosts) {
  BCAST = { roomId: +roomId, mode: 'audio', isHost: false, isPrimary: false, hosts: new Map(), peers: new Map(), watching: new Set(), pendingTargets: new Set() };
  // المستمع الصوتي يستقبل الصوت في الخلفية فقط؛ النافذة العائمة مخصصة للمذيع.
  bcastSetFloatingMode('audio');
  (hosts || []).forEach(h => bcastRegisterHost(h));
  // نُشغّل عدّاد حماية الصوت منذ البداية حتى لا ينقطع صوت المذيعين عند أي تحديث.
  bcastEnsureAudioWatchdog();
  // العروض (offers) ستصل من كل مذيع تلقائياً عبر bcast:signal — نطبّق أولاً أي عرض وصل مبكراً قبل التهيئة
  bcastFlushSignalQueue();
}

// نافذة تأكيد بدء البث
function bcastOpenStartConfirm(mode) {
  if (!ME) return openLogin();
  const joiningExisting = !!(CUR_ROOM && ROOM_BCAST[CUR_ROOM.id]);
  $('#bcastStartIcon').textContent = mode === 'audio' ? 'mic_fill' : 'videocam_fill';
  $('#bcastStartTitle').textContent = joiningExisting
    ? (mode === 'audio' ? 'الانضمام كمذيع صوتي' : 'بدء بث فيديو مستقل')
    : (mode === 'audio' ? 'بدء بث صوتي' : 'بدء بث فيديو');
  $('#bcastStartText').textContent = mode === 'audio'
    ? 'سيسمعك جميع من في هذه الغرفة الصوتية مباشرة فور بدء البث، بمن فيهم من ينضم لاحقاً.'
    : 'سيبدأ بث فيديو مستقل خاص بك: لا يرى بثك أحد إلا بعد موافقتك على طلبه، ولا يُدمج بثك تلقائياً مع أي مذيع آخر. ولمشاهدة مذيع آخر أرسل له طلباً بالنقر على صورته في شريط البث — بثك وبثه يعملان معاً بشكل طبيعي بعد الموافقة.';
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
      // كاميرا واقعية: دقة 720p بمعدل 30 إطاراً/ث مع كاميرا أمامية ومعالجة صوتية متقدمة
      : await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
  } catch (e) { return toast('تعذر الوصول إلى ' + (mode === 'audio' ? 'الميكروفون' : 'الكاميرا') + '، تحقق من الأذونات', false); }
  SOCKET.emit('bcast:start', CUR_ROOM.id, (res) => {
    if (!res || !res.ok) { stream.getTracks().forEach(t => t.stop()); return toast((res && res.text) || 'تعذر بدء البث', false); }
    try {
    // [بثوث متزامنة] إن كنت أشاهد بثوثاً مقبولة قبل صعودي، تبقى شغّالة كما هي ولا تُغلق اتصالاتها.
    const keepViewer = BCAST && BCAST.roomId === CUR_ROOM.id && BCAST.mode === 'video' && res.mode === 'video' && !BCAST.isHost;
    const keptPeers = keepViewer ? BCAST.peers : new Map();
    const keptHosts = keepViewer ? BCAST.hosts : new Map();
    const keptWatching = keepViewer ? bcastWatchingSet() : new Set();
    const keptPending = keepViewer ? bcastPendingSet() : new Set();
    if (!keepViewer && BCAST) { // حالة صوتية/غرفة أخرى: أغلق ما كان مفتوحاً
      if (BCAST.peers) for (const pc of BCAST.peers.values()) { try { pc.close(); } catch (e) { } }
      $('#bcastGrid').innerHTML = '';
    }
    BCAST = {
      roomId: CUR_ROOM.id, mode: res.mode, isHost: true, isPrimary: !!res.isNewBroadcast,
      hosts: keptHosts, localStream: stream, peers: keptPeers,
      watching: keptWatching, pendingTargets: keptPending
    };
    // مؤشر «يتحدث» لميكروفوني (لصورتي أنا)
    bcastLevelAttach(ME.id, stream);
    // البثوث التي وافق أصحابها على مشاهدتي لها قبل صعودي (يؤكدها الخادم) تبقى مسجلة
    (res.watching || []).forEach(h => { BCAST.watching.add(+h.id); bcastRegisterHost(h); });
    bcastSetFloatingMode(res.mode);
    AUDIO_BCAST_HOST_MUTED = false;
    bcastUpdateHostMuteButton();
    bcastRegisterHost({ id: ME.id, username: ME.username, avatar: ME.avatar || '', badge: badgeOf(ME) }, true);
    $('#bcastEndBtn').hidden = false;
    $('#bcastLeaveBtn').hidden = true;
    $('#bcastWaitMsg').hidden = true;
    openOv('bcastOv');
    if (res.mode !== 'video') toast(res.isNewBroadcast ? 'بدأ البث الصوتي — يسمعك جميع من في الغرفة الآن مباشرة' : 'انضممت للبث الصوتي');
    // [صوت] أتصل بكل من انضم قبلي: المذيعون الحاليون (بث ثنائي الاتجاه بيننا) والمستمعون المسجلون بالفعل.
    // [فيديو] بثّي مستقل تماماً: لا اتصال بأي مذيع آخر ولا بأي مشاهد — كل مشاهد يصل بطلبٍ أوافقُ عليه بنفسي،
    // وإن أردتُ مشاهدة مذيع آخر فعليّ طلبُه هو والموافقة عليه.
    if (res.mode === 'audio') {
      (res.existingHosts || []).forEach(h => { bcastRegisterHost(h); bcastConnectToPeer(h.id); });
      (res.viewers || []).forEach(id => bcastConnectToPeer(+id));
    }
      bcastFlushSignalQueue();
    } catch (err) {
      // حتى لو فشل اتصال واحد مع مستمع، الشريط يجب أن يُعاد رسمه ليظهر زر الكتم المستقل للمذيع نفسه
      console.error('bcastStart error:', err);
    }
    // إعادة رسم مضمونة (فورية + متأخرة أماناً) — زر الكتم يظهر للمذيع حتى لو كان وحده
    bcastRenderBar();
    setTimeout(() => { try { bcastRenderBar(); } catch (e) {} }, 150);
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
// [مشاهدة معتمدة على الطلب] إرسال طلب مشاهدة بث فيديو مذيع محدَّد بالذات — لا يتصل إلا بهذا المذيع تحديداً إن وافق.
// يصلح للمشاهد العادي وللمذيع الذي يريد مشاهدة مذيع آخر (يبقي بثّه شغالاً).
// [الأهم] المشاهدات متزامنة: أي بث وافق صاحبه على طلبك يعمل بشكل طبيعي بجانب البثوث الأخرى،
// ولا يُغلق أي بث قائم بسبب قبول بثٍ جديد.
function bcastWatchRequest(targetHost) {
  if (!CUR_ROOM || !targetHost) return;
  if (ME && targetHost.id === ME.id) return;
  const rid = CUR_ROOM.id;
  const haveVideoState = BCAST && BCAST.roomId === rid && BCAST.mode === 'video';
  if (haveVideoState && bcastIsWatchingHost(targetHost.id)) return toast('أنت تشاهد هذا المذيع بالفعل');
  if (haveVideoState && bcastPendingSet().has(+targetHost.id)) return toast('طلبك لهذا المذيع ما زال بانتظار موافقته');
  // --- حالة 1: أنا مذيع وأطلب مشاهدة مذيع آخر (كل اتجاه بموافقة مستقلة، وبثّي مستمر) ---
  if (haveVideoState && BCAST.isHost) {
    bcastPendingSet().add(+targetHost.id);
    openOv('bcastOv');
    SOCKET.emit('bcast:watch_request', rid, targetHost.id, (res) => {
      if (!res || !res.ok) {
        bcastPendingSet().delete(+targetHost.id);
        if (res && res.already) return toast('أنت تشاهد هذا المذيع بالفعل');
        toast((res && res.text) || 'تعذر إرسال طلب المشاهدة', false);
      } else {
        toast(`تم إرسال طلب مشاهدة إلى ${targetHost.username} — بانتظار موافقته…`, true);
      }
    });
    return;
  }
  // --- حالة 2: مشاهد عادي (بلا بث خاص به) ---
  const alreadyWatchingOthers = haveVideoState && !BCAST.isHost && bcastWatchingSet().size > 0;
  if (haveVideoState && !BCAST.isHost) {
    bcastPendingSet().add(+targetHost.id);
  } else {
    BCAST = { roomId: rid, mode: 'video', isHost: false, isPrimary: false, hosts: new Map(), peers: new Map(), watching: new Set(), pendingTargets: new Set([+targetHost.id]) };
    bcastSetFloatingMode('video');
    $('#bcastGrid').innerHTML = '';
  }
  if (alreadyWatchingOthers) {
    // يواصل مشاهدة بثوثه الحالية، وعند الموافقة يُضاف البث الجديد بجانبها
    toast(`تم إرسال طلب مشاهدة إلى ${targetHost.username} — عند موافقته سيُعرض بثه بجانب البثوث الحالية`, true);
  } else {
    $('#bcastHostAvatar').innerHTML = bcastAvatarChip(targetHost.avatar);
    $('#bcastHostName').textContent = targetHost.username;
    $('#bcastEndBtn').hidden = true;
    $('#bcastLeaveBtn').hidden = true;
    $('#bcastWaitMsg').hidden = false;
  }
  bcastUpdateHeader();
  openOv('bcastOv');
  SOCKET.emit('bcast:watch_request', rid, targetHost.id, (res) => {
    if (!BCAST) return;
    if (!res || !res.ok) {
      if (res && res.already) {
        bcastPendingSet().delete(+targetHost.id);
        bcastWatchingSet().add(+targetHost.id);
        $('#bcastWaitMsg').hidden = true; $('#bcastLeaveBtn').hidden = false;
        return;
      }
      bcastPendingSet().delete(+targetHost.id);
      toast((res && res.text) || 'تعذر إرسال طلب المشاهدة', false);
      if (!bcastWatchingSet().size && !bcastPendingSet().size) { bcastResetState(); bcastRenderBar(); }
    }
  });
}
// إيقاف مشاهدة بثٍّ بعينه (زر X على البلاطة) — لا يؤثر على بقية البثوث ولا على بثّي أنا
function bcastStopWatchingHost(hostId) {
  if (!CUR_ROOM || !BCAST || BCAST.mode !== 'video') return;
  hostId = +hostId;
  SOCKET.emit('bcast:leave', CUR_ROOM.id, hostId);
  bcastClosePeer(hostId, 'in');
  bcastRemoveTile(hostId);
  bcastWatchingSet().delete(hostId);
  bcastPendingSet().delete(hostId);
  bcastUpdateHeader();
  if (!BCAST.isHost && !bcastWatchingSet().size && !bcastPendingSet().size) {
    // مشاهد عادي لم يعد يتابع أي بث: تُغلق الشاشة بالكامل
    bcastResetState();
    bcastRenderBar();
    return;
  }
  toast(BCAST.isHost ? 'أوقفت مشاهدة هذا البث — بثّك ما زال مستمراً' : 'أوقفت مشاهدة هذا البث — بقية البثوث ما زالت تعمل', true);
}
function bcastLeaveAsViewer() {
  if (!CUR_ROOM || !BCAST || BCAST.isHost) return;
  // إلغاء الطلب المعلق والمشاهدة الحالية معاً (الخادم يعالج الحالتين في bcast:leave)
  SOCKET.emit('bcast:leave', CUR_ROOM.id);
  bcastResetState();
}
// يُستدعى عند دخول غرفة (من ack الانضمام) لضبط حالة البث الحالية للغرفة
function bcastApplyJoinState(roomId, broadcastState) {
  if (broadcastState) {
    ROOM_BCAST[roomId] = broadcastState;
    const iAmAlreadyHost = ME && broadcastState.hosts.some(h => h.id === ME.id);
    if (broadcastState.mode === 'audio' && !iAmAlreadyHost) bcastViewerAutoConnectAudio(roomId, broadcastState.hosts);
  } else delete ROOM_BCAST[roomId];
  syncRoomUserBroadcastFlags(roomId);
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
  if (ME && ME.muted) {
    return toast('تم كتمك إجبارياً من قِبل المشرف — لا يمكنك إلغاء الكتم حتى يتم فك الكتم من الإدارة 🚫', false);
  }
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
  const btn = $('#liveBarMute');
  if (btn) btn.classList.toggle('is-muted', AUDIO_BCAST_MUTED);
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
      await trackedFetch('/api/notifications/' + notification.id + '/read', {
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
  syncBadgeMirror('#dskNotifBadge', NOTIF_UNREAD);
  updateUnreadTitle();
}
function updateStatusUnreadBadge() {
  const txt = STATUS_UNREAD > 99 ? '99+' : String(STATUS_UNREAD);
  ['#statusUnreadBadge', '#mnStatusBadge'].forEach(sel => {
    const badge = $(sel);
    if (!badge) return;
    if (STATUS_UNREAD > 0) { badge.textContent = txt; badge.style.display = 'flex'; }
    else badge.style.display = 'none';
  });
  updateUnreadTitle();
}
async function loadUnreadNotifCount() {
  if (!ME || !ME.registered) { NOTIF_UNREAD = 0; updateNotifBadge(); return; }
  try {
    const data = await api('/api/notifications/unread-count');
    NOTIF_UNREAD = +data.count || 0;
    updateNotifBadge();
  } catch (e) { }
}
async function loadUnreadPrivCount() {
  if (!ME) return;
  try {
    const convs = await api('/api/private');
    const total = (Array.isArray(convs) ? convs : []).reduce((s, c) => s + (+c.unread || 0), 0);
    PRIV_UNREAD = total;
    updatePrivBadge();
  } catch (e) { }
}

// =====================================================
//  إشعارات سطح المكتب (متصفح الكمبيوتر — Notification API)
// =====================================================
const PM_NTF_TITLES = { ar: 'رسالة خاصة', en: 'Private message', es: 'Mensaje privado', tr: 'Özel mesaj' };
function desktopNotifySupported() {
  return typeof window !== 'undefined' && typeof window.Notification === 'function';
}
async function requestDesktopNotifyPermission(announce = false) {
  const N = desktopNotifySupported() ? window.Notification : null;
  if (!N) {
    if (announce) toast('متصفحك لا يدعم إشعارات سطح المكتب', false);
    return 'unsupported';
  }
  if (PREFS.dsk_ntf === 0 && N.permission === 'default') return 'off';
  try {
    const p = await N.requestPermission();
    if (p === 'granted' && announce) toast('تم تفعيل إشعارات سطح المكتب 🔔');
    if (p === 'denied' && announce) toast('الإشعارات محظورة — اسمح بها من إعدادات المتصفح', false);
    return p;
  } catch (e) { return 'error'; }
}
// أول نقرة بعد الدخول تُستغل لطلب الإذن (يتطلب المتصفح تفاعل مستخدم)
let DSK_NOTIFY_ASK_ARMED = false;
function armDesktopNotifyAsk() {
  const N = desktopNotifySupported() ? window.Notification : null;
  if (DSK_NOTIFY_ASK_ARMED || !N) return;
  if (N.permission !== 'default' || PREFS.dsk_ntf === 0) return;
  DSK_NOTIFY_ASK_ARMED = true;
  const ask = () => {
    document.removeEventListener('click', ask, true);
    requestDesktopNotifyPermission(true);
  };
  document.addEventListener('click', ask, true);
}
function showDesktopNotification({ title, body, icon, tag, silent, onclick } = {}) {
  const N = desktopNotifySupported() ? window.Notification : null;
  if (!N || !PREFS.dsk_ntf) return;
  if (N.permission !== 'granted') return;
  try {
    const n = new N(String(title || 'إشعار'), {
      body: String(body || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      icon: icon || undefined,
      tag: tag || undefined,
      dir: APP_LANG === 'ar' ? 'rtl' : 'ltr',
      lang: APP_LANG || 'ar',
      silent: !!silent
    });
    n.onclick = () => {
      try { window.focus(); } catch (e) { }
      try { n.close(); } catch (e) { }
      if (typeof onclick === 'function') onclick();
    };
    setTimeout(() => { try { n.close(); } catch (e) { } }, 8000);
  } catch (e) { }
}
function pmPreviewText(text) {
  const t = String(text || '');
  if (t.startsWith('media::image::')) return '📷 صورة';
  if (t.startsWith('media::audio::')) return '🎤 رسالة صوتية';
  return t;
}
function pmSenderAvatarUrl(uid) {
  try {
    const u = (ROOM_USERS || []).find(x => +x.id === +uid);
    if (u && u.avatar && String(u.avatar).startsWith('/')) return u.avatar;
  } catch (e) { }
  return '/avatars/default.png';
}
// =====================================================
//  شريط إشعار الرسالة الخاصة (ينزل من أعلى الصفحة)
// =====================================================
// يظهر داخل الصفحة نفسها على الكمبيوتر والهاتف، والنقر عليه يفتح المحادثة.
let PM_BANNER_TIMER = null;
function showPmBanner(p) {
  const el = $('#pmBanner');
  if (!el || !p) return;
  const name = p.from_name || 'مستخدم';
  const nameEl = $('#pmBannerName');
  const avaEl = $('#pmBannerAva');
  const timeEl = $('#pmBannerTime');
  if (nameEl) nameEl.textContent = name;
  if (timeEl) timeEl.textContent = 'الآن';
  if (avaEl) avaEl.src = pmSenderAvatarUrl(p.from_id);
  // النقر يفتح محادثة المُرسِل مباشرة
  el.onclick = async () => {
    hidePmBanner();
    try {
      await openPrivateWith({
        id: +p.from_id, username: name,
        registered: +p.from_registered || 0, unread: 0,
        avatar: pmSenderAvatarUrl(p.from_id)
      });
      // فتح المحادثة يعلّم رسائلها مقروءة على الخادم، فنعيد حساب الشارة
      // من المصدر حتى يختفي العدد فوراً بدل أن يبقى معلّقاً.
      loadUnreadPrivCount();
    } catch (e) { }
  };
  el.classList.add('show');
  clearTimeout(PM_BANNER_TIMER);
  PM_BANNER_TIMER = setTimeout(hidePmBanner, 5000);
}
function hidePmBanner() {
  const el = $('#pmBanner');
  if (!el) return;
  clearTimeout(PM_BANNER_TIMER);
  el.classList.remove('show');
}

// إشعار سطح المكتب لرسالة خاصة وصلت والمحادثة غير مفتوحة
function notifyDesktopPrivate(p) {
  if (!p || !ME || +p.from_id === +ME.id) return;
  const name = p.from_name || 'مستخدم';
  showDesktopNotification({
    title: `${PM_NTF_TITLES[APP_LANG] || PM_NTF_TITLES.ar} — ${name}`,
    body: pmPreviewText(p.text) || '📩 رسالة جديدة',
    icon: pmSenderAvatarUrl(p.from_id),
    tag: 'pm-' + p.from_id,
    onclick: () => {
      try { openPrivateWith({ id: +p.from_id, username: name, registered: +p.from_registered || 0, unread: 0, avatar: pmSenderAvatarUrl(p.from_id) }); } catch (e) { }
    }
  });
}
// إشعار سطح المكتب لإشعارات النظام — فقط والصفحة بتاب خلفي (داخل الصفحة يوجد توست)
function notifyDesktopSystem(n) {
  if (!n || !document.hidden) return;
  showDesktopNotification({
    title: (window.SEO_PAGE_CONFIG && window.SEO_PAGE_CONFIG.site_name) || SETTINGS.site_name || 'إشعار',
    body: n.text || 'لديك إشعار جديد',
    tag: 'sys-ntf',
    onclick: () => {
      try { document.querySelector('.bn-item[data-nav="notifs"]').click(); } catch (e) { }
    }
  });
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
  // أي تعديل للغرفة من لوحة الإدارة (نوعها، اسمها، حالتها...) ينعكس فوراً على الغرفة
  // المفتوحة حالياً دون إعادة تحميل — فيتحدث شريط البث/زر «تحدث» حسب النوع الجديد مباشرة.
  if (CUR_ROOM) {
    const fresh = ROOMS.find(x => +x.id === +CUR_ROOM.id);
    if (fresh) {
      Object.assign(CUR_ROOM, fresh);
      const roomNameEl = $('#chatRoomName');
      if (roomNameEl) roomNameEl.textContent = fresh.name;
      updateVoiceRoomBarUI();
      try { bcastRenderBar(); } catch (e) { }
    }
  }
  renderRooms();
}
// يولّد رابط مصغّر (/t/..) للصور المحلية الكبيرة (شعار/غرف/أيقونات) ليُنزَّل حجم
// العرض الفعلي فقط بدل الأصل كاملاً — يقلّل حمل الشبكة ويُحسّن LCP.
function thumbUrl(src, w, h, fit) {
  const s = String(src || '');
  if (!s.startsWith('/')) return s;
  if (s.startsWith('/uploads/') || s.startsWith('/img/') || s.startsWith('/avatars/')) {
    return `/t${fit ? 'f' : ''}/${w}x${h === undefined ? w : h}${s}`;
  }
  return s;
}
function roomImgHtml(r, cls = 'room-img') {
  if (r.image) {
    const px = cls === 'rm-img' ? 92 : 104;
    return `<div class="${cls}"><img src="${esc(thumbUrl(r.image, px))}" alt="${esc(r.name)}" width="${px}" height="${px}" decoding="async"></div>`;
  }
  return `<div class="${cls}"><span>${esc(r.name)}</span></div>`;
}
function roomFeaturesHtml(r) {
  // الصوتية: أيقونة المايك. الافتراضية: بدون أيقونة إضافية (تظهر أيقونة الكتابة فقط).
  const icons = r.type === 'voice'
    ? [
        '<i class="f7-icons" title="دردشة كتابية">bubble_left_bubble_right_fill</i>',
        '<i class="f7-icons" title="غرفة صوتية">music_mic</i>'
      ]
    : [
        '<i class="f7-icons" title="دردشة كتابية">bubble_left_bubble_right_fill</i>'
      ];
  if (r.status !== 'open') icons.push('<i class="f7-icons" title="الغرفة مغلقة" style="color:#dc2626">lock_circle_fill</i>');
  if (r.locked) icons.push('<i class="f7-icons" title="الغرفة برقم سري" style="color:#d946a6">lock_fill</i>');
  // غرفة للأعضاء المسجلين فقط — تُميَّز بأيقونة عضو
  if (r.audience === 'registered') icons.push('<i class="f7-icons" title="للأعضاء المسجلين فقط" style="color:#0ea5e9">person_badge_plus_fill</i>');
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
      <div class="room-count"><i class="f7-icons">person_2_fill</i><b>${online}</b>/${r.max_users || 1000}</div>
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
      ${isCur ? '<span class="rm-here">أنت هنا</span>' : `<span class="rm-count"><i class="f7-icons">person_2_fill</i>${online}/${r.max_users || 1000}</span>`}
      <i class="f7-icons rm-chev">chevron_right</i>
    </div>
  </div>`;
}
function renderRoomsPanel() {
  const q2 = ($('#roomSearch2').value || '').trim();
  // جميع الغرف صوتية الآن — لا يوجد تقسيم إلى أقسام.
  const list = ROOMS.filter(r => (!q2 || r.name.includes(q2)));
  $('#roomsList2').innerHTML = list.length ? list.map(roomMiniHtml).join('') : '<div class="pv-empty" style="padding:50px 10px"><div>لا توجد غرف هنا</div></div>';
  $$('#roomsList2 .room-mini').forEach(row => row.onclick = () => {
    if (CUR_ROOM && +row.dataset.id === CUR_ROOM.id) return toast('أنت متواجد في هذه الغرفة حالياً 📍');
    attemptRoomSwitch(+row.dataset.id);
  });
}
function renderRooms() {
  const q1 = ($('#roomSearch').value || '').trim();
  // جميع الغرف صوتية الآن — لا يوجد تقسيم إلى أقسام.
  const list = ROOMS.filter(r => (!q1 || r.name.includes(q1)));
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
  // عند الانتقال من غرفة إلى أخرى (كنّا داخل غرفة مختلفة): نغادر الغرفة السابقة
  // فعلياً ثم ننضم إلى الجديدة — فلا يبقى اسمك في الغرفة القديمة ولا رسائلها.
  if (CUR_ROOM && CUR_ROOM.id !== id) leaveRoom();
  CUR_ROOM = r;
  updateVoiceRoomBarUI();
  $('#chatRoomName').textContent = r.name;
  renderIdleRoomNotice();
  const currentSiteName = (window.SEO_PAGE_CONFIG && window.SEO_PAGE_CONFIG.site_name) || SETTINGS.site_name || 'الدردشة العربية';
  const bgWater = $('#chatBgWatermark .pm-water');
  if (bgWater) bgWater.textContent = currentSiteName;
  $('#msgArea').innerHTML = '';
  showScreen('chat');
  setRoomsPanel(false);
  $('#roomsVeil').style.display = 'none';
  // دخول الغرفة يتم عبر WebSocket، لذلك نعرض نفس مؤشر التحميل حتى يرد الخادم.
  let roomLoadingFinished = false;
  const finishRoomLoading = () => {
    if (roomLoadingFinished) return;
    roomLoadingFinished = true;
    clearTimeout(roomLoadingTimer);
    hideGlobalOperationLoading();
  };
  const roomLoadingTimer = setTimeout(finishRoomLoading, 15000);
  showGlobalOperationLoading('جارٍ فتح الغرفة...');
  SOCKET.emit('join', id, pass, { hidden }, (res) => {
    finishRoomLoading();
    if (res && res.ok) {
      ROOM_HIDDEN[id] = !!res.hidden;
      // مرجع المزامنة: آخر رسالة موجودة عند الدخول — لا نجلب تاريخاً أقدم منها لاحقاً.
      if (res.lastMsgId) ROOM_SYNC_BASE[id] = +res.lastMsgId;
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
    // غرفة للأعضاء المسجلين فقط: ندعو الزائر لإنشاء حساب بدل رسالة عابرة
    else if (res.reason === 'members_only') { toast(res.text || '👤 هذه الغرفة للأعضاء المسجلين فقط', false); openOv('needRegOv'); }
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
function scrollBottom(smooth) {
  const a = $('#msgArea');
  NEW_MSGS_BELOW = 0;
  if (smooth) a.scrollTo({ top: a.scrollHeight, behavior: 'smooth' });
  else a.scrollTop = a.scrollHeight;
  const btn = $('#scrollDownBtn');
  if (btn) { btn.style.display = 'none'; $('#scrollDownCount').style.display = 'none'; }
}

// ===== زر النزول لأسفل الدردشة + عداد الرسائل الجديدة =====
// عند تمرير المستخدم للأعلى لقراءة الرسائل القديمة يبقى مكانه ثابتاً،
// ويظهر زر عائم يحمل عدد الرسائل الجديدة، وبالنقر عليه ينزل للأسفل ويختفي.
let NEW_MSGS_BELOW = 0;
function isNearBottom() {
  const a = $('#msgArea');
  return a.scrollHeight - a.scrollTop - a.clientHeight < 80;
}
function updateScrollDownBtn() {
  const btn = $('#scrollDownBtn'), cnt = $('#scrollDownCount');
  if (!btn) return;
  if (isNearBottom()) {
    NEW_MSGS_BELOW = 0;
    btn.style.display = 'none';
    cnt.style.display = 'none';
    return;
  }
  btn.style.display = 'flex';
  if (NEW_MSGS_BELOW > 0) {
    cnt.textContent = NEW_MSGS_BELOW > 99 ? '99+' : NEW_MSGS_BELOW;
    cnt.style.display = 'flex';
  } else cnt.style.display = 'none';
}
$('#msgArea').addEventListener('scroll', updateScrollDownBtn);
$('#scrollDownBtn').onclick = () => scrollBottom(true);

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
  html += esc(source.slice(cursor));
  return linkifyEscaped(html);
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
const RENDERED_MSG_IDS = new Set(); // معرّفات الرسائل المرسومة على الشاشة (لإدراك الفائتة عند الاستعادة)
const ROOM_LAST_MSG_ID = {};        // roomId -> آخر معرّف رسالة ظاهرة (نجلب ما بعده فقط عند إعادة الاتصال)
const ROOM_SYNC_BASE = {};          // roomId -> آخر معرّف رسالة عند دخول الغرفة (يُمنع جلب التاريخ الأقدم منها)
// تنبيه انتهاء مدة التوثيق/الدخول الملكي (شهر): لا يُحذف تلقائياً، ويكتب جنب الاسم
// أن الشهر تجاوز ويمكن الإلغاء عبر الإدارة فقط.
function expireNoteHtml(u) {
  return (u && (u.verified_expired || u.royal_expired)) ? ' <span class="expire-note">⚠ تم تجاوز الشهر الخاص به ويمكن الغائه عبر الادارة</span>' : '';
}
// الموجة المتحركة: نمط النقاط المتموجة (mwave.gif) يغطي فقاعة الرسالة كاملة —
// زهري للمميز، وأسود للأدمن والسوبر أدمن (التلوين عبر فلاتر SVG في index.html).
// تعديل رسالة روبوت من داخل الدردشة: محرر مدمج بالنص واللون والحجم
function startBotMsgEdit(el, m) {
  const body = el.querySelector('.robot-system-body');
  if (!body || body.querySelector('.robot-edit-form')) return;
  const curColor = /^#[0-9a-fA-F]{6}$/.test(String(m.color || '')) ? m.color : '#d946a6';
  const curSize = Math.min(40, Math.max(12, +m.size || 16));
  body.innerHTML = `
    <div class="robot-edit-form">
      <input class="robot-edit-text" type="text" maxlength="200" value="${esc(m.text)}" placeholder="نص رسالة الروبوت">
      <div class="robot-edit-row">
        <input class="robot-edit-color" type="color" value="${curColor}" title="اللون">
        <input class="robot-edit-size" type="number" min="12" max="40" value="${curSize}" title="حجم الخط">
        <button type="button" class="btn btn-green btn-sm robot-edit-save"><i class="f7-icons">checkmark</i> حفظ</button>
        <button type="button" class="btn btn-gray btn-sm robot-edit-cancel"><i class="f7-icons">xmark</i> إلغاء</button>
      </div>
    </div>`;
  const textInp = body.querySelector('.robot-edit-text');
  const colorInp = body.querySelector('.robot-edit-color');
  const sizeInp = body.querySelector('.robot-edit-size');
  const saveBtn = body.querySelector('.robot-edit-save');
  const cancelBtn = body.querySelector('.robot-edit-cancel');
  const restore = () => {
    body.innerHTML = `
      <div class="u-msg robot-system-text" style="font-size:${curSize}px;color:${curColor}">${linkifyEscaped(esc(m.text))}</div>`;
  };
  cancelBtn.onclick = (ev) => { ev.stopPropagation(); restore(); };
  saveBtn.onclick = async (ev) => {
    ev.stopPropagation();
    const text = textInp.value.trim();
    if (!text) return toast('اكتب نص رسالة الروبوت', false);
    saveBtn.disabled = true;
    try {
      const _editExtra = parseExtra(m);
      await api('/api/admin/bots', 'POST', {
        id: +(m.bot_id || _editExtra.bot_id || 0),
        text,
        color: colorInp.value,
        size: +sizeInp.value || 16,
        room_id: +(m.bot_room_id || _editExtra.bot_room_id || 0),
        interval_min: +(m.bot_interval || _editExtra.bot_interval || 5),
        active: (m.bot_active === 0 || _editExtra.bot_active === 0) ? 0 : 1
      });
      const txt = el.querySelector('.robot-system-text');
      if (txt) {
        txt.style.fontSize = Math.min(40, Math.max(12, +sizeInp.value || 16)) + 'px';
        txt.style.color = colorInp.value;
        txt.innerHTML = linkifyEscaped(esc(text));
      }
      toast('تم تعديل رسالة الروبوت ✅');
    } catch (err) {
      toast((err && err.error) || 'تعذر تعديل الرسالة', false);
      saveBtn.disabled = false;
    }
  };
  textInp.onkeydown = (ev) => { if (ev.key === 'Enter') saveBtn.onclick(ev); };
  textInp.focus();
  textInp.select();
}

function renderMsg(m) {
  // تتبع المعرّفات المرسومة — يُستخدم لإدراك الرسائل الفائتة عند استعادة الاتصال
  if (m && m.id) {
    RENDERED_MSG_IDS.add(+m.id);
    const rid = +(m.room_id || (CUR_ROOM && CUR_ROOM.id) || 0);
    if (rid) ROOM_LAST_MSG_ID[rid] = Math.max(ROOM_LAST_MSG_ID[rid] || 0, +m.id);
  }
  const area = $('#msgArea');
  const senderId = +(m.user_id || (m.user && m.user.id) || 0);
  if (m.type === 'msg' && senderId && IGNORED_USERS.has(senderId)) return;
  let el = document.createElement('div');
  const t = timeHm(m.created_at || Date.now() / 1000);
  if (m.type === 'msg') {
    const messageExtra = parseExtra(m);
    const u = m.user || messageExtra;
    const isLiveBroadcaster = !!(
      m.live_broadcast_host || m.is_live_broadcaster ||
      (m.user && (m.user.live_broadcast_host || m.user.is_live_broadcaster)) ||
      messageExtra.live_broadcast_host || messageExtra.is_live_broadcaster
    );
    const badge = u.badge || badgeOf(u);
    const badgeKindCandidate = String(badge || '').replace(/\.png$/i, '').toLowerCase();
    const badgeKind = ['superadmin', 'admin', 'roomadmin', 'mmez', 'vip', 'premium', 'plus', 'register', 'guest'].includes(badgeKindCandidate)
      ? badgeKindCandidate : 'register';
    const color = userColor(u);
    const uname = m.username || u.username || '';
    const rp = m.reply || u.reply || null;   // اقتباس «الرد على الرسالة»
    const tcol = m.color || u.color || null;  // لون خط مخصص من قائمة الألوان
    const currentFontSize = Math.min(40, Math.max(10, +(SETTINGS.font_size || 14)));
    const isCustomEmoji = typeof m.text === 'string' && m.text.startsWith('em::');
    const messageMedia = m.media || u.media || null;
    const hiddenAdmin = !!(m.hidden_admin || u.hidden_admin);
    // إخفاء شارة «زائر» و«مسجل بدون عضوية» من العام، وإظهارها فقط للإدارات والعضويات.
    const showBadge = !!badge && !['guest.png', 'register.png'].includes(badge);
    // الموجة المتحركة على القالب كامل: زهري للمميز، أسود للأدمن والسوبر أدمن.
    const waveKind = badgeKind === 'superadmin' ? 'superadmin' : (badgeKind === 'admin' ? 'admin' : (badgeKind === 'mmez' ? 'mmez' : ''));
    el.className = 'msg' + (hiddenAdmin ? ' hidden-admin-msg' : '');
    // معرّف المرسل على القالب: يتيح تحديث دائرة الحالة لاحقاً بلا إعادة رسم الرسالة.
    if (senderId) el.dataset.uid = senderId;
    el.innerHTML = `
      <div class="mava${isLiveBroadcaster ? ' live-broadcaster-avatar' : ''}${statusRingClass(senderId)}">${liveAvatarHtml(u.avatar, isLiveBroadcaster, frameOf(u))}</div>
      <div class="mbody">
        ${(waveKind && SETTINGS.wave_enabled !== '0') ? `<span class="mwave mwave-${waveKind}" aria-hidden="true"></span>` : ''}
        ${rp ? `
        <div class="mrply" dir="rtl">
          <span class="mrply-bar"></span>
          <div class="mrply-content">
            <span class="mrply-name">${esc(rp.name)}</span>
            <span class="mrply-text">${linkifyEscaped(esc(rp.text || ''))}</span>
          </div>
        </div>` : ''}
        <div class="mline1">
          <span class="mname" data-username="${esc(uname)}" style="color:#000000;font-weight:400">${esc(uname)}${u.verified ? ' <i class="f7-icons vcheck">checkmark_seal_fill</i>' : ''}${u.royal ? ' <i class="f7-icons rcrown">crown_fill</i>' : ''}${expireNoteHtml(u)}</span>
          ${(SETTINGS.show_time === '1' && PREFS.show_time) ? `<span class="mtime">${t}</span>` : ''}
        </div>
        <div class="mline2">
          ${hiddenAdmin
            ? '<img class="hidden-admin-badge" src="/img/mgfi.png" alt="دخول مخفي">'
            : (showBadge ? `<img class="mmark" data-badge-kind="${badgeKind}" src="/badges/${badge}" alt="">` : '')}
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
      const msgUserData = { text: m.text, username: uname, avatar: u.avatar, rank: u.rank, membership: u.membership, gender: u.gender, registered: u.registered, muted: u.muted, broadcast_banned: (m.user && m.user.broadcast_banned) || (u.broadcast_banned) || 0 };
      // النقر على الاسم أو الصورة يفتح نفس قائمة إجراءات المستخدم المعتادة،
      // لكنها تُعرض ملتصقة بالاسم المنقور مع سهم يشير إليه بدل الورقة السفلية.
      const openSenderSheet = (e) => {
        if (e) e.stopPropagation();
        const uid = m.user_id || (m.user && m.user.id);
        if (!uid) return;
        const anchor = (e && e.currentTarget) || el.querySelector('.mname');
        openUserSheet(+uid, msgUserData, anchor);
      };
      const avaEl = el.querySelector('.mava');
      const nameEl = el.querySelector('.mname');
      if (avaEl) avaEl.onclick = openSenderSheet;
      if (nameEl) nameEl.onclick = openSenderSheet;
    }
  } else if (m.type === 'bot') {   // رسالة النظام الآلية — بدون أزرار تعديل/حذف أبداً
    const botSize = Math.min(40, Math.max(12, +(m.size || 16)));
    const botColor = /^#[0-9a-fA-F]{6}$/.test(String(m.color || '')) ? m.color : '#660033';
    el.className = 'robot-system-message';
    el.innerHTML = `
      <div class="robot-system-head">
        <img src="/img/robot-message.svg" width="20" height="20" alt="">
        <div class="robot-system-title">رسالة النظام</div>
      </div>
      <div class="font_msg robot-system-body">
        <div class="u-msg robot-system-text" style="font-size:${botSize}px;color:${botColor}">${linkifyEscaped(esc(m.text))}</div>
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
  } else if (m.type === 'kick') {
    el.className = 'system-event mute-system kick-system';
    el.innerHTML = `
      <div class="system-event-head skin_f2">
        <i style="background: #c90000 !important;" class="icon f7-icons skin_color system-event-icon">nosign</i>
        <span style="color: #ff0101 !important;">نظام الطرد</span>
      </div>
      <div class="font_msg system-event-body">
        <div class="u-msg system-event-message" style="color:#ff0000">${esc(m.text)}</div>
      </div>`;
  } else if (m.type === 'ban') {
    el.className = 'system-event mute-system ban-system';
    el.innerHTML = `
      <div class="system-event-head skin_f2">
        <i style="background: #c90000 !important;"class="icon f7-icons skin_color system-event-icon">nosign</i>
        <span style="color: #ff0101 !important;">نظام الحظر</span>
      </div>
      <div class="font_msg system-event-body">
        <div class="u-msg system-event-message" style="color:#ff0000">${esc(m.text)}</div>
      </div>`;
  } else if (m.type === 'mute') {
    el.className = 'system-event mute-system';
    el.innerHTML = `
      <div class="system-event-head skin_f2">
        <i style="background: #c90000 !important;" class="icon f7-icons skin_color system-event-icon">nosign</i>
        <span style="color: #ff0101 !important;">نظام الكتم</span>
      </div>
      <div class="font_msg system-event-body">
        <div class="u-msg system-event-message" style="color:${m.muted === 0 ? '#ff0000' : '#ff0000'}">${esc(m.text)}</div>
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
    el.innerHTML = `<div class="shead"><i class="f7-icons">bolt_badge_a_fill</i> إعلان من الإدارة</div><div class="stext">${linkifyEscaped(esc(m.text))}</div>`;
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
// ===== الدخول الملكي TikTok — داخل msgArea مع GIFs حقيقية 🦁👑 =====
// طبقة البانر المستقلة: مشهد الدخول يبقى خلف الدردشة بشفافية 0.2، وأي عنصر
// داخل طبقة شفافة يُحبس z-index الخاص به داخلها (stacking context)، لذلك
// يُعرض البانر في طبقة منفصلة بشفافية كاملة ليظهر فوق كل شيء.
function showRoyalBanner(banner, isGirl) {
  const bannerLayer = $('#royalBannerLayer');
  if (!bannerLayer) return;
  bannerLayer.innerHTML = '';
  bannerLayer.classList.toggle('royal-girl', !!isGirl);
  bannerLayer.classList.add('show');
  bannerLayer.appendChild(banner);
}
function hideRoyalBanner() {
  const bannerLayer = $('#royalBannerLayer');
  if (!bannerLayer) return;
  bannerLayer.classList.remove('show', 'royal-girl');
  bannerLayer.innerHTML = '';
}
let ROYAL_ENTRY_TIMER = null;
function triggerRoyalEntry(username, avatar, animal, gender, extra) {
  const layer = $('#royalEntryLayer');
  const msgArea = $('#msgArea');
  const chatScreen = $('#chatScreen');
  if (!layer || !msgArea) return;
  // مشهد جديد يلغي مؤقّتات المشهد السابق (دخول أو هدية) حتى لا يُخفي بانر الجديد.
  clearTimeout(ROYAL_ENTRY_TIMER);
  clearTimeout(ROYAL_GIFT_TIMER);
  layer.innerHTML = '';
  hideRoyalBanner();
  const a = royalAnimal(animal || 'lion');
  const isGirl = gender === 'girl';
  layer.classList.toggle('royal-girl', isGirl);
  // بكامل الشاشة فوق الدردشة — بدون تكبير/تصغير للصورة
  layer.classList.add('royal-fs');
  // تفعيل وضع شفاف داخل msgArea
  if (msgArea) msgArea.classList.add('royal-active');
  if (chatScreen) chatScreen.classList.add('royal-active');

  // خلفية ذهبية داخل msgArea
  const bg = document.createElement('div');
  bg.className = 'rt-tiktok-bg';
  layer.appendChild(bg);

  // اسم الموقع في الخلفية العامة أثناء الدخول الملكي — حسب اسم الشات المكتوب في
  // إعدادات اللوحة (مثل «شات الاردن») — يظهر مع المشهد ويختفي عندما يختفي.
  const siteNameBg = document.createElement('div');
  siteNameBg.className = 'rt-site-name';
  siteNameBg.textContent = SETTINGS.site_name || 'شات الاردن';
  layer.appendChild(siteNameBg);

  const rays = document.createElement('div');
  rays.className = 'rt-rays';
  layer.appendChild(rays);

  const mist = document.createElement('div');
  mist.className = 'rt-gold-mist';
  layer.appendChild(mist);

  // عملات متساقطة
  const coinsLayer = document.createElement('div');
  coinsLayer.className = 'rt-coins-layer';
  const coinCount = isGirl ? 24 : 18;
  const coinEmojis = ['🪙','✨','💰','🌟','💫'];
  for (let i = 0; i < coinCount; i++) {
    const c = document.createElement('i');
    c.className = 'rt-coin';
    c.textContent = coinEmojis[Math.floor(Math.random()*coinEmojis.length)];
    c.style.setProperty('--x', (Math.random()*100)+'%');
    c.style.setProperty('--dx', (Math.random()*100-50)+'px');
    c.style.setProperty('--sz', (11 + Math.random()*14)+'px');
    c.style.setProperty('--delay', (Math.random()*2.8)+'s');
    c.style.setProperty('--dur', (2 + Math.random()*1.8)+'s');
    coinsLayer.appendChild(c);
  }
  layer.appendChild(coinsLayer);

  // مسرح الحيوان مع GIF الحقيقي
  const stage = document.createElement('div');
  stage.className = 'rt-lion-stage';
  const lion = document.createElement('div');
  lion.className = 'rt-lion rt-lion-' + a.key;
  lion.style.setProperty('--rc', a.color);
  
  let avaHtml = '';
  if (avatar && String(avatar).startsWith('/')) {
    avaHtml = `<img src="${esc(avatar)}" alt="">`;
  } else if (avatar && String(avatar).startsWith('emoji:')) {
    try {
      const parts = String(avatar).split(':');
      avaHtml = `<span style="background:${esc(parts[2]||'#f59e0b')};width:100%;height:100%;display:flex;align-items:center;justify-content:center;border-radius:50%">${esc(parts[1]||'🙂')}</span>`;
    } catch(e){ avaHtml = `<span>👑</span>`; }
  } else {
    avaHtml = `<span>👑</span>`;
  }

  // استخدام GIF الحقيقي لكل دخول (من القائمة أو مما بثّه الخادم مباشرة للإضافات الجديدة)
  const gifSrc = (extra && extra.gif) || a.gif || '';
  const gifVisual = gifSrc 
    ? `<img class="rt-main-gif" src="${esc(gifSrc)}" alt="${esc(a.name)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block'"><span class="rt-lion-emoji" style="display:none">${a.emoji}</span>`
    : `<span class="rt-lion-emoji">${a.emoji}</span>`;

  lion.innerHTML = `
    <div class="rt-gif-wrap">
      ${gifVisual}
      <span class="rt-lion-roar-ring"></span>
      <span class="rt-lion-roar-ring r2"></span>
    </div>
    <div class="rt-lion-shadow"></div>
    <div class="rt-lion-dust"></div>
  `;
  stage.appendChild(lion);
  layer.appendChild(stage);

  // البانر يوضع في طبقته المستقلة فوق كل شيء (بشفافية كاملة)، بينما يبقى
  // باقي المشهد في الخلفية خلف الدردشة كما هو.
  const banner = document.createElement('div');
  banner.className = 'rt-banner-tiktok';
  banner.innerHTML = `
    <span class="rt-banner-ava">${avaHtml}</span>
    <div class="rt-banner-info">
      <b>${esc(username)}</b>
      <span>👑 دخول ملكي • ${esc(a.name)} ${a.emoji}</span>
    </div>
    <span class="rt-banner-lion">${a.emoji}</span>
  `;
  showRoyalBanner(banner, isGirl);

  // شرارات
  const sparksLayer = document.createElement('div');
  sparksLayer.className = 'rt-sparks';
  const sparkCount = isGirl ? 28 : 20;
  for (let s = 0; s < sparkCount; s++) {
    const sp = document.createElement('i');
    const isHeart = isGirl && s % 4 === 0;
    sp.className = 'rt-spark' + (isHeart ? ' heart-spark' : '');
    sp.style.setProperty('--sx', (20 + Math.random()*60)+'%');
    sp.style.setProperty('--sy', (30 + Math.random()*50)+'%');
    sp.style.setProperty('--dx', (Math.random()*200-100)+'px');
    sp.style.setProperty('--dy', (-(40 + Math.random()*180))+'px');
    sp.style.setProperty('--sz', (4 + Math.random()*8)+'px');
    sp.style.setProperty('--delay', (0.2 + Math.random()*2.2)+'s');
    sp.style.setProperty('--dur', (1 + Math.random()*1.2)+'s');
    sparksLayer.appendChild(sp);
  }
  layer.appendChild(sparksLayer);

  // صوت الدخول: ملف صوتي مخصص لكل دخول إن وُجد (يُرفع من لوحة الإدارة) وإلا النغمة الافتراضية
  const soundSrc = (extra && extra.sound) || a.sound || '';
  if (soundSrc) {
    try { const au = new Audio(soundSrc); au.volume = .9; au.play().catch(() => { }); } catch (e) { }
  } else {
    try { beep(120, .35); setTimeout(()=>beep(90,.5), 200); setTimeout(()=>beep(180,.25), 900); } catch(e){}
  }

  ROYAL_ENTRY_TIMER = setTimeout(() => { 
    layer.style.transition = 'opacity .6s ease';
    layer.style.opacity = '0';
    hideRoyalBanner();
    setTimeout(()=>{ 
      layer.innerHTML = ''; 
      layer.style.opacity=''; 
      layer.classList.remove('royal-girl'); 
      layer.classList.remove('royal-fs');
      if (msgArea) msgArea.classList.remove('royal-active');
      if (chatScreen) chatScreen.classList.remove('royal-active');
    }, 600);
  }, 5800);
}

let GIFT_AUDIO_PLAYER = null, GIFT_EFFECT_TIMER = null;
const GIFT_CONFETTI_COLORS = ['#ff0055', '#ffcc00', '#00e5ff', '#ff00cc', '#00ff66', '#ff7700', '#ffd700', '#a855f7', '#ec4899', '#3b82f6'];
// ألوان المفرقعات الذهبية للهدية الملكية
const GIFT_ROYAL_COLORS = ['#ffd700', '#ffc436', '#ffe27a', '#ff9d00', '#fff3c4', '#f59e0b', '#ffcc00', '#ffea00', '#ffb300', '#ffe082'];
// مشهد صندوق الهدايا: الصندوق يهتز ← الغطاء ينفتح ← الهدية تنبثق مع مفرقعات
// opts.fast = النسخة المخفَّفة للهدية العادية (أسرع ومفرقعات أقل).
// المشهد الملكي يستدعيها بلا خيارات فيبقى بتوقيته الأصلي كما هو.
function buildGiftBoxScene(details, opts) {
  const fast = !!(opts && opts.fast);
  const scene = document.createElement('div');
  scene.className = 'giftbox-scene' + (fast ? ' gb-fast' : '');
  const giftVis = details.img || details.emoji || '🎁';
  const giftMediaHtml = String(giftVis).startsWith('/') ? `<img src="${esc(giftVis)}" alt="">` : `<span>${esc(giftVis)}</span>`;
  scene.innerHTML = `
    <div class="giftbox-confetti" aria-hidden="true"></div>
    <div class="giftbox">
      <div class="giftbox-lid"><div class="giftbox-ribbon-lid"></div></div>
      <div class="giftbox-body"><div class="giftbox-ribbon-v"></div></div>
      <div class="giftbox-gift">${giftMediaHtml}</div>
    </div>`;
  // مفرقعات ملونة تنبثق من موقع الصندوق لحظة انفتاحه.
  // opts.noConfetti = إلغاؤها تماماً (الهدية العادية صارت تستعمل مفرقعات
  // من صورة الهدية نفسها بدل القصاصات الملونة).
  const confettiBox = scene.querySelector('.giftbox-confetti');
  const pieces = (opts && opts.noConfetti) ? 0 : (fast ? 20 : 42);
  const burstAt = fast ? 0.62 : 1.05;     // تتزامن مع انفتاح الغطاء الأسرع
  for (let c = 0; c < pieces; c++) {
    const piece = document.createElement('i');
    const ang = Math.random() * Math.PI * 2;
    const dist = 90 + Math.random() * (fast ? 170 : 240);
    piece.style.setProperty('--tx', Math.cos(ang) * dist + 'px');
    piece.style.setProperty('--ty', (Math.sin(ang) * dist - 60) + 'px');
    piece.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
    piece.style.setProperty('--color', GIFT_CONFETTI_COLORS[c % GIFT_CONFETTI_COLORS.length]);
    piece.style.setProperty('--delay', (burstAt + Math.random() * 0.22) + 's');
    piece.style.setProperty('--dur', (fast ? 0.7 : 0.9) + Math.random() * (fast ? 0.6 : 0.9) + 's');
    if (Math.random() < 0.4) piece.className = 'round';
    confettiBox.appendChild(piece);
  }
  return scene;
}
// مدفعا مفرقعات جانبيان (يمين ويسار) — يظهران مع الهدية العادية والملكية معاً
function buildGiftSideCannons(delayOffset = 0, opts) {
  const fast = !!(opts && opts.fast);
  const wrap = document.createElement('div');
  wrap.className = 'gift-side-cannons';
  const count = fast ? 12 : 26;              // المخفَّفة: أقل من نصف القصاصات
  const startAt = fast ? 0.62 : 1.05;        // تنطلق مع انفتاح الغطاء
  ['left', 'right'].forEach(side => {
    const cannon = document.createElement('span');
    cannon.className = 'gift-side-cannon ' + side;
    const dir = side === 'left' ? 1 : -1;
    for (let c = 0; c < count; c++) {
      const piece = document.createElement('i');
      piece.style.setProperty('--tx', (dir * (140 + Math.random() * 260)) + 'px');
      piece.style.setProperty('--ty', (-(30 + Math.random() * 180)) + 'px');
      piece.style.setProperty('--rot', (dir * (Math.random() * 540 + 180)) + 'deg');
      piece.style.setProperty('--color', GIFT_CONFETTI_COLORS[c % GIFT_CONFETTI_COLORS.length]);
      piece.style.setProperty('--delay', (delayOffset + startAt + Math.random() * 0.3) + 's');
      piece.style.setProperty('--dur', (fast ? 0.7 : 0.8) + Math.random() * (fast ? 0.6 : 0.8) + 's');
      if (Math.random() < 0.4) piece.className = 'round';
      cannon.appendChild(piece);
    }
    wrap.appendChild(cannon);
  });
  return wrap;
}
// 10 ألعاب نارية كبيرة متتالية منتشرة على كامل الشاشة (مفرقعات الخلفية)
function buildGiftFireworks(layer, delayOffset = 0, colorSet = GIFT_CONFETTI_COLORS, opts) {
  const fast = !!(opts && opts.fast);
  // النسخة المخفَّفة: 4 انفجارات متقاربة حول الصندوق بدل 10 تمتد أربع ثوانٍ.
  const fireworkPositions = fast ? [
    { x: '22%', y: '26%', delay: 0 },
    { x: '78%', y: '30%', delay: 0.18 },
    { x: '32%', y: '66%', delay: 0.36 },
    { x: '70%', y: '62%', delay: 0.54 }
  ] : [
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
  const sparks = fast ? 14 : 24;

  fireworkPositions.forEach((pos, idx) => {
    const firework = document.createElement('span');
    firework.className = 'gift-firework';
    firework.style.setProperty('--x', pos.x);
    firework.style.setProperty('--y', pos.y);

    // Shockwave ring
    const ring = document.createElement('span');
    ring.className = 'gift-firework-ring';
    ring.style.setProperty('--color', colorSet[idx % colorSet.length]);
    ring.style.setProperty('--delay', (pos.delay + delayOffset) + 's');
    firework.appendChild(ring);

    // شرارات مضيئة شعاعية (أقل عدداً في النسخة المخفَّفة)
    for (let spark = 0; spark < sparks; spark++) {
      const particle = document.createElement('i');
      const angle = (Math.PI * 2 * spark) / sparks;
      const distance = 80 + Math.random() * 70; // Large burst radius
      particle.className = 'gift-firework-spark';
      particle.style.setProperty('--tx', Math.cos(angle) * distance + 'px');
      particle.style.setProperty('--ty', Math.sin(angle) * distance + 'px');
      particle.style.setProperty('--color', colorSet[(idx + spark) % colorSet.length]);
      particle.style.setProperty('--delay', (pos.delay + delayOffset + Math.random() * 0.08) + 's');
      firework.appendChild(particle);
    }
    layer.appendChild(firework);
  });
}
// ===== مفرقعات من صورة الهدية نفسها =====
// عند خروج الهدية من الصندوق تنفجر منها 100 نسخة صغيرة من الهدية ذاتها
// تتطاير في كل الاتجاهات ثم تتلاشى. تحلّ محل القصاصات الملوّنة القديمة.
function buildGiftMiniBurst(details, opts) {
  const o = opts || {};
  const count = o.count || 100;
  // 1.0s = اللحظة التي تتجاوز فيها الهدية حافة الصندوق في النسخة السريعة
  const startAt = (o.startAt != null) ? o.startAt : 1.0;
  const wrap = document.createElement('div');
  wrap.className = 'gift-mini-burst';
  const vis = details.img || details.emoji || '🎁';
  const isImg = String(vis).startsWith('/');
  // انفجار لحظي من المركز: كل الصور تنطلق في اللحظة نفسها بلا تتابع،
  // في كل الاتجاهات وبمدى يغطي الشاشة كاملة.
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('span');
    piece.className = 'gmb-piece';
    const ang = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
    // sqrt يوزّع القطع على كامل القرص بدل تكدّسها قرب المركز
    const spread = Math.sqrt(0.12 + Math.random() * 0.88);
    // نقطة التناثر: مائلة للأعلى قليلاً ليبقى للقطع مجال تسقط فيه
    const ty = Math.sin(ang) * 52 * spread - 16;
    piece.style.setProperty('--tx', (Math.cos(ang) * 62 * spread).toFixed(1) + 'vw');
    piece.style.setProperty('--ty', ty.toFixed(1) + 'vh');
    // نهاية السقوط: أسفل الشاشة دائماً مهما كان موضع التناثر
    piece.style.setProperty('--fy', (74 + Math.random() * 12).toFixed(1) + 'vh');
    // تمايل جانبي أثناء الهبوط
    piece.style.setProperty('--sway', ((Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 7)).toFixed(1) + 'vw');
    piece.style.setProperty('--rot', Math.round(Math.random() * 540 - 270) + 'deg');
    piece.style.setProperty('--rot2', Math.round(Math.random() * 420 - 210) + 'deg');
    piece.style.setProperty('--sc', (0.45 + Math.random() * 0.55).toFixed(2));
    // لا تتابع: التأخير واحد للجميع = انفجار واحد
    piece.style.setProperty('--delay', startAt.toFixed(2) + 's');
    piece.style.setProperty('--dur', (2.7 + Math.random() * 0.7).toFixed(2) + 's');
    piece.innerHTML = isImg ? `<img src="${esc(vis)}" alt="" aria-hidden="true">` : `<b>${esc(vis)}</b>`;
    wrap.appendChild(piece);
  }
  return wrap;
}
// ===== 100 مفرقعة متنوّعة تملأ الشاشة =====
// أشكال مختلفة (شرائط، دوائر، نجوم، معيّنات، قلوب، بريق) بألوان متعدّدة،
// تنطلق مع فقاعات الهدية وتغطي الشاشة من أطرافها كلها.
// قصاصات ورقية ملوّنة: مستطيلات ورقية بأحجام وميول مختلفة، بعضها
// مربّع صغير وبعضها شريط مموّج — كقصاصات حفلات حقيقية.
const GIFT_POP_SHAPES = ['strip', 'strip', 'strip', 'square', 'ribbon', 'ribbon'];
function buildGiftPopConfetti(opts) {
  const o = opts || {};
  const count = o.count || 100;
  const startAt = (o.startAt != null) ? o.startAt : 1.0;
  const wrap = document.createElement('div');
  wrap.className = 'gift-pop-confetti';
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('i');
    const shape = GIFT_POP_SHAPES[i % GIFT_POP_SHAPES.length];
    piece.className = 'gpc ' + shape;
    // انفجار لحظي من المركز في كل الاتجاهات — توزيع شعاعي منتظم
    const ang = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.7;
    // sqrt يملأ القرص كله بانتظام بدل تكدّس القصاصات في الوسط
    const spread = Math.sqrt(0.1 + Math.random() * 0.9);
    // نقطة التناثر مرفوعة للأعلى: القصاصة تنتشر أولاً ثم تجد مجالاً لتتساقط
    const ty = Math.sin(ang) * 58 * spread - 18;
    piece.style.setProperty('--tx', (Math.cos(ang) * 72 * spread).toFixed(1) + 'vw');
    piece.style.setProperty('--ty', ty.toFixed(1) + 'vh');
    // كل قصاصة تُكمل طريقها إلى ما تحت حافة الشاشة
    piece.style.setProperty('--fy', (74 + Math.random() * 14).toFixed(1) + 'vh');
    // تمايل يميناً ويساراً أثناء الهبوط — كورقة تتهادى في الهواء
    piece.style.setProperty('--sway', ((Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 9)).toFixed(1) + 'vw');
    piece.style.setProperty('--rot', Math.round(Math.random() * 900 - 450) + 'deg');
    piece.style.setProperty('--rot2', Math.round(Math.random() * 540 - 270) + 'deg');
    piece.style.setProperty('--sc', (0.6 + Math.random() * 0.8).toFixed(2));
    piece.style.setProperty('--color', GIFT_CONFETTI_COLORS[Math.floor(Math.random() * GIFT_CONFETTI_COLORS.length)]);
    // لا تتابع: كل القصاصات تنفجر في اللحظة نفسها
    piece.style.setProperty('--delay', startAt.toFixed(2) + 's');
    piece.style.setProperty('--dur', (2.8 + Math.random() * 0.8).toFixed(2) + 's');
    // تقلُّب الورقة حول محورها أثناء الطيران (وجه/ظهر) بسرعات مختلفة
    piece.style.setProperty('--flip', (0.3 + Math.random() * 0.4).toFixed(2) + 's');
    piece.style.setProperty('--tilt', Math.round(Math.random() * 360) + 'deg');
    wrap.appendChild(piece);
  }
  return wrap;
}
function triggerGiftCelebration(gift) {
  const details = gift || {};
  const layer = $('#giftCelebrationLayer');
  if (!layer) return;
  clearTimeout(GIFT_EFFECT_TIMER);
  layer.innerHTML = '';

  // ===== مشهد الهدية العادية =====
  // 1) يظهر الصندوق ويهتز.  2) ينفتح غطاؤه وتخرج الهدية.
  // 3) لحظة خروجها تنفجر منها 100 نسخة صغيرة من الهدية نفسها.
  // أُلغيت المؤثرات القديمة (القصاصات الملوّنة، المدفعان الجانبيان،
  // الألعاب النارية بالخلفية) — المشهد الملكي ما زال يستعملها كما هي.
  const fast = { fast: true, noConfetti: true };
  layer.appendChild(buildGiftBoxScene(details, fast));
  // انفجار واحد لحظي من المنتصف: 300 قصاصة ورقية + 100 صورة صغيرة
  // للهدية، كلها تنطلق في اللحظة نفسها فتملأ الدردشة كاملة،
  // ثم تتهادى نازلة كالمطر حتى تختفي تحت حافة الشاشة.
  layer.appendChild(buildGiftMiniBurst(details, { count: 100, startAt: 1.0 }));
  layer.appendChild(buildGiftPopConfetti({ count: 300, startAt: 1.0 }));

  // بدون قالب الأسماء: الهدية العادية تعرض الصندوق + المفرقعات فقط (لا تظهر بطاقة اسم الهدية/المرسل/المستقبل)

  if (details.audio && String(details.audio).startsWith('/')) {
    try {
      if (GIFT_AUDIO_PLAYER) { GIFT_AUDIO_PLAYER.pause(); GIFT_AUDIO_PLAYER.currentTime = 0; }
      GIFT_AUDIO_PLAYER = new Audio(details.audio);
      GIFT_AUDIO_PLAYER.volume = .95;
      GIFT_AUDIO_PLAYER.play().catch(() => { });
    } catch (e) { }
  }

  // الصندوق ← الهدية ← انفجار لحظي يملأ الشاشة ← تساقط كالمطر ← اختفاء.
  // آخر قصاصة: 1.0s تأخير + 3.6s مدة = 4.6s، فنمسح الطبقة بعدها.
  GIFT_EFFECT_TIMER = setTimeout(() => { layer.innerHTML = ''; }, 4700);
}

// ===== الهدية الملكية: صندوق عادي أولاً ← يُخفى عند إخراج الهدية ← تظهر الهدية مع مفرقعات بالخلفية =====
let ROYAL_GIFT_TIMER = null;
function triggerRoyalGiftCelebration(gift) {
  const details = gift || {};
  const layer = $('#royalEntryLayer');
  const msgArea = $('#msgArea');
  const chatScreen = $('#chatScreen');
  if (!layer || !msgArea) return;
  // مشهد جديد يلغي مؤقّتات المشهد السابق (دخول أو هدية) حتى لا يُخفي بانر الجديد.
  clearTimeout(ROYAL_GIFT_TIMER);
  clearTimeout(ROYAL_ENTRY_TIMER);
  layer.innerHTML = '';
  hideRoyalBanner();
  layer.classList.remove('royal-girl');
  layer.classList.add('royal-fs', 'rt-gift-king-stage');
  if (msgArea) msgArea.classList.add('royal-active');
  if (chatScreen) chatScreen.classList.add('royal-active');

  // خلفية ذهبية واسم الموقع — يظهران متأخرين (بعد أن يُخرج الصندوق الهدية) حتى يظهر الصندوق عادياً أولاً
  const bg = document.createElement('div'); bg.className = 'rt-tiktok-bg'; layer.appendChild(bg);
  const siteNameBg = document.createElement('div'); siteNameBg.className = 'rt-site-name';
  siteNameBg.textContent = SETTINGS.site_name || 'شات الاردن'; layer.appendChild(siteNameBg);

  // ===== المرحلة 1: الصندوق يظهر كما كان ويهتز ويُخرج الهدية =====
  const boxScene = buildGiftBoxScene(details);
  boxScene.classList.add('rt-gift-king-box');     // يُخفى بعد إخراج الهدية
  layer.appendChild(boxScene);
  layer.appendChild(buildGiftSideCannons(0));      // مفرقعات جانبية مع فتح الصندوق
  layer.appendChild(buildGiftSideCannons(1.5));    // موجة ثانية مع ظهور العرض

  // ===== المرحلة 2: بعد إخفاء الصندوق — الهدية تظهر مع مفرقعات ذهبية بالخلفية =====
  buildGiftFireworks(layer, 1.4, GIFT_ROYAL_COLORS);

  const vis = details.img || '🎁';
  const isImg = String(vis).startsWith('/');
  const giftName = details.name || 'هدية';
  const media = isImg
    ? `<img class="rt-gift-king-img" src="${esc(vis)}" alt="">`
    : `<span class="rt-gift-king-emoji">${esc(vis)}</span>`;
  const stage = document.createElement('div'); stage.className = 'rt-lion-stage';
  stage.innerHTML = `
    <div class="rt-lion">
      <div class="rt-gif-wrap rt-gift-king-wrap">
        <span class="rt-gift-king-crown">👑</span>
        <div class="rt-gift-card">
          <div class="rt-gift-card-media">${media}</div>
          <div class="rt-gift-card-name">${esc(translateDynamicText(giftName, APP_LANG))}</div>
          <span class="rt-gift-card-shine"></span>
        </div>
        <span class="rt-lion-roar-ring"></span>
        <span class="rt-lion-roar-ring r2"></span>
      </div>
      <div class="rt-lion-shadow"></div>
      <div class="rt-lion-dust"></div>
    </div>`;
  layer.appendChild(stage);

  // بانر: من → إلى • هدية ملكية
  const fromName = details.from || 'عضو';
  const toName = details.to || '';
  const banner = document.createElement('div'); banner.className = 'rt-banner-tiktok';
  banner.innerHTML = `
    <span class="rt-banner-ava">${isImg ? `<img src="${esc(vis)}" alt="">` : `<span>${esc(vis)}</span>`}</span>
    <div class="rt-banner-info">
      <b>${esc(fromName)}</b>
      <span>👑 هدية ملكية • ${esc(giftName)}${toName ? ' إلى ' + esc(toName) : ''}</span>
    </div>
    <span class="rt-banner-lion">👑</span>`;
  showRoyalBanner(banner, false);

  // صوت الهدية إن وُجد وإلا نغمة افتراضية
  const soundSrc = details.audio && String(details.audio).startsWith('/') ? details.audio : '';
  if (soundSrc) {
    try { const au = new Audio(soundSrc); au.volume = .9; au.play().catch(() => { }); } catch (e) { }
  } else {
    try { beep(120, .35); setTimeout(() => beep(90, .5), 200); setTimeout(() => beep(180, .25), 900); } catch (e) { }
  }

  ROYAL_GIFT_TIMER = setTimeout(() => {
    layer.style.transition = 'opacity .6s ease';
    layer.style.opacity = '0';
    hideRoyalBanner();
    setTimeout(() => {
      layer.innerHTML = '';
      layer.style.opacity = '';
      layer.classList.remove('royal-fs', 'rt-gift-king-stage');
      if (msgArea) msgArea.classList.remove('royal-active');
      if (chatScreen) chatScreen.classList.remove('royal-active');
    }, 600);
  }, 5800);
}

// =====================================================
//  المتصلون بالغرفة
// =====================================================
function liveBroadcastHostIds(roomId = CUR_ROOM && CUR_ROOM.id) {
  const state = roomId ? ROOM_BCAST[+roomId] : null;
  return new Set((state && Array.isArray(state.hosts) ? state.hosts : []).map(host => +host.id).filter(Boolean));
}
function syncRoomUserBroadcastFlags(roomId) {
  if (!CUR_ROOM || +roomId !== +CUR_ROOM.id) return;
  const hostIds = liveBroadcastHostIds(roomId);
  ROOM_USERS.forEach(user => { user.live_broadcast_host = hostIds.has(+user.id) ? 1 : 0; });
  renderUsers();
}
function renderUsers() {
  const q = ($('#userSearch').value || '').trim();
  const hostIds = liveBroadcastHostIds();
  $('#onlineCount').textContent = ROOM_USERS.length;
  const list = ROOM_USERS.filter(u => !q || u.username.includes(q))
    .sort((a, b) => rankWeight(b) - rankWeight(a) || String(a.username).localeCompare(String(b.username), 'ar'));
  $('#usersList').innerHTML = list.length ? list.map(u => {
    const ignored = IGNORED_USERS.has(+u.id);
    const isLiveBroadcaster = hostIds.has(+u.id);
    return `
    <div class="users-row${u.muted ? ' muted-user' : ''}${ignored ? ' ignored-user' : ''}" data-id="${u.id}">
      <img class="ubadge" src="/badges/${badgeOf(u)}" alt="">
      <div class="uava${isLiveBroadcaster ? ' live-broadcaster-avatar' : ''}${statusRingClass(u.id)}">${liveAvatarHtml(u.avatar, isLiveBroadcaster, frameOf(u))}<span class="dot ${statusDot(u.status)}"></span></div>
      <div class="uname" style="color:${userColor(u)};font-weight:${userWeight(u)}">${esc(u.username)}${u.verified ? ' <i class="f7-icons vcheck">checkmark_seal_fill</i>' : ''}${u.royal ? ' <i class="f7-icons rcrown">crown_fill</i>' : ''}${expireNoteHtml(u)}${ignored ? `<span class="ignored-user-tag">${APP_LANG === 'en' ? '(Ignored)' : '(متجاهل)'}</span>` : ''}</div>
      ${u.muted ? '<i class="f7-icons muted-user-mark">mic_slash_fill</i>' : ''}
      <img class="ugender" src="/badges/${GENDER_IMG[u.gender] || 'secret.png'}" alt="">
    </div>`;
  }).join('') : '<div class="pv-empty"><div>لا يوجد متصلون</div></div>';
  $$('#usersList .users-row').forEach(r => r.onclick = () => openUserSheet(+r.dataset.id));
}

// قائمة إجراءات المستخدم
let US_MSG = null;   // سياق الرسالة عند فتح الورقة من النقر على صورة رسالة
let USER_STATUS_WATCH_TIMER = null;
let USER_STATUS_REQUEST_ID = 0;
function isActiveStatus(status, now = Math.floor(Date.now() / 1000)) {
  return !!status && Number.isFinite(+status.expires_at) && +status.expires_at > now;
}
function activeStatusesForUser(uid) {
  const now = Math.floor(Date.now() / 1000);
  return (STATUSES || []).filter(status => +status.user_id === +uid && isActiveStatus(status, now));
}
function stopUserStatusActionWatcher() {
  if (USER_STATUS_WATCH_TIMER) {
    clearTimeout(USER_STATUS_WATCH_TIMER);
    USER_STATUS_WATCH_TIMER = null;
  }
}
function scheduleUserStatusActionWatcher() {
  stopUserStatusActionWatcher();
  const sheet = $('#userSheet');
  if (!sheet || !sheet.classList.contains('open') || !CUR_TARGET) return;
  const active = activeStatusesForUser(CUR_TARGET.id);
  const now = Math.floor(Date.now() / 1000);
  const nextExpiry = active.reduce((soonest, status) => Math.min(soonest, +status.expires_at), Infinity);
  // نفحص عند الانتهاء، ونحدّث دورياً أيضاً لالتقاط حذف الحالة أو اختفائها من الخادم.
  const untilExpiry = Number.isFinite(nextExpiry) ? Math.max(100, (nextExpiry - now) * 1000 + 100) : 30000;
  USER_STATUS_WATCH_TIMER = setTimeout(() => {
    if (!CUR_TARGET || !$('#userSheet').classList.contains('open')) return;
    refreshUserStatusAction(CUR_TARGET.id);
  }, Math.min(untilExpiry, 30000));
}
function syncUserStatusAction() {
  const button = $('#usStatus');
  if (!button || !CUR_TARGET) return;
  const active = activeStatusesForUser(CUR_TARGET.id);
  button.hidden = active.length === 0;
  button.setAttribute('aria-hidden', active.length ? 'false' : 'true');
  scheduleUserStatusActionWatcher();
}
async function refreshUserStatusAction(uid) {
  if (!ME || !uid) return;
  const requestId = ++USER_STATUS_REQUEST_ID;
  try {
    const statuses = await api('/api/statuses');
    if (requestId !== USER_STATUS_REQUEST_ID || !CUR_TARGET || +CUR_TARGET.id !== +uid) return;
    STATUSES = Array.isArray(statuses) ? statuses : [];
    syncUserStatusAction();
  } catch (e) {
    if (requestId === USER_STATUS_REQUEST_ID) scheduleUserStatusActionWatcher();
  }
}
async function openTargetStatus() {
  const target = CUR_TARGET;
  if (!target) return;
  try {
    const statuses = await api('/api/statuses');
    if (!CUR_TARGET || +CUR_TARGET.id !== +target.id) return;
    STATUSES = Array.isArray(statuses) ? statuses : [];
    syncUserStatusAction();
    if (!activeStatusesForUser(target.id).length) return toast('انتهت هذه الحالة', false);
    closeOv('userSheet');
    await openStatusGroup(target.id);
  } catch (e) { toast(e.error || 'تعذر فتح الحالة', false); }
}
function userSheetMembership(u) {
  if (u.rank && u.rank !== 'user') return RANK_NAMES[u.rank] || 'حساب إداري';
  if (u.membership && u.membership !== 'none') return MEM_NAMES[u.membership] || u.membership;
  return u.registered ? 'عضو مسجل' : 'زائر';
}
function userSheetMembershipColor(u) {
  if (!u) return '#6b7280';
  // نفس لون اسم العضو في العام: سوبر/ادمن أسود، أدمن غرفة أحمر، وكل عضوية بلونها.
  return userColor(u);
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
  // أدوات التحكم بالمذيع (سحب المايك / سحب مع منع صعود) تظهر لمشرف على مذيعٍ يبث فعلاً الآن،
  // و«فك من البث» تظهر لمشرف على مستخدمٍ ممنوع من الصعود.
  syncUserBroadcastControlButtons();
  // «كشف نكات» للإدارة العامة فقط (ادمن / سوبر ادمن / سوبر ماستر) وليس لأدمن الغرفة،
  // ولا يظهر عند النقر على النفس. الخادم يعيد التحقق من الرتبة أيضاً.
  $$('.user-action-sheet .us-staff-only').forEach(b => {
    const allowed = isAdmRank() && ME && +CUR_TARGET.id !== +ME.id;
    b.style.display = allowed ? 'flex' : 'none';
  });
  syncUserStatusAction();
  // تغيّر عدد الخيارات يغيّر ارتفاع الورقة؛ نعيد ضبط موضعها لتبقى ملتصقة بالاسم.
  if (USER_SHEET_ANCHOR) positionAnchoredUserSheet();
}

// يعرض/يخفي أزرار التحكم بالمذيع في ورقة المستخدم حسب حالة البث الحية ومنع الصعود.
function syncUserBroadcastControlButtons() {
  if (!ME || !CUR_TARGET || CUR_TARGET.id === ME.id) return;
  if (!canModerateRank()) return;
  const notSelf = +CUR_TARGET.id !== +ME.id;
  const state = CUR_ROOM ? ROOM_BCAST[CUR_ROOM.id] : null;
  const isLiveHost = !!(state && (state.hosts || []).some(h => +h.id === +CUR_TARGET.id));
  const isBanned = !!CUR_TARGET.broadcast_banned;
  const p1 = $('#usBcastPull'), p2 = $('#usBcastPullBan'), ub = $('#usBcastUnban');
  if (p1) p1.style.display = (notSelf && isLiveHost) ? 'flex' : 'none';
  if (p2) p2.style.display = (notSelf && isLiveHost) ? 'flex' : 'none';
  if (ub) ub.style.display = (notSelf && isBanned) ? 'flex' : 'none';
}
// عند تمرير «مرساة» (اسم/صورة في العام) تُعرض ورقة المستخدم نفسها بجانب الاسم
// مع سهم جانبي يشير إليه — على الشاشات الكبيرة فقط. على الهاتف تبقى ورقة سفلية
// عادية تماماً كما تظهر عند النقر على مستخدم من قائمة المستخدمين.
let USER_SHEET_ANCHOR = null;
const USER_SHEET_ANCHOR_MQ = '(min-width: 1024px)';
function canAnchorUserSheet() {
  return !!(window.matchMedia && window.matchMedia(USER_SHEET_ANCHOR_MQ).matches);
}
function anchorUserSheet(anchor) {
  const overlay = $('#userSheet');
  const sheet = overlay && overlay.querySelector('.user-action-sheet');
  if (!overlay || !sheet) return;
  // على الهاتف نتجاهل المرساة تماماً كي تبقى الورقة السفلية المعتادة.
  USER_SHEET_ANCHOR = (anchor && canAnchorUserSheet()) ? anchor : null;
  overlay.classList.toggle('anchored', !!USER_SHEET_ANCHOR);
  sheet.classList.toggle('anchored-sheet', !!USER_SHEET_ANCHOR);
  if (!USER_SHEET_ANCHOR) {
    // تنظيف كامل كي تعود ورقة سفلية/ديسكتوب عادية بلا بقايا من الوضع الملتصق.
    sheet.classList.remove('arrow-start', 'arrow-end');
    sheet.style.top = sheet.style.left = sheet.style.right = sheet.style.maxHeight = '';
    sheet.style.removeProperty('--arrow-y');
    return;
  }
  // سهم الديسكتوب الخاص بقائمة المستخدمين يُخفى كي لا يتعارض مع سهمنا.
  const deskArrow = document.getElementById('dskSheetArrow');
  if (deskArrow) deskArrow.classList.remove('show');
  positionAnchoredUserSheet();
}
// يضع الورقة أسفل الاسم (أو فوقه عند ضيق المساحة) داخل حدود الإطار ويوجّه السهم للاسم.
// تظهر البطاقة كاملة (بلا تمرير داخلي) إلى جانب الاسم، والسهم على جنبها يشير إليه.
function positionAnchoredUserSheet() {
  const overlay = $('#userSheet');
  const sheet = overlay && overlay.querySelector('.user-action-sheet');
  const anchor = USER_SHEET_ANCHOR;
  if (!overlay || !sheet || !anchor || !anchor.isConnected) return;
  const boxRect = overlay.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const margin = 8;
  const gap = 12;
  // نلغي أي تثبيت قادم من قواعد الديسكتوب قبل القياس، وبلا حدّ للارتفاع (القائمة كاملة).
  sheet.style.right = 'auto';
  sheet.style.maxHeight = 'none';
  const width = sheet.offsetWidth || sheet.getBoundingClientRect().width;
  const height = sheet.offsetHeight || sheet.getBoundingClientRect().height;

  // الجانب: نضعها على يسار الاسم (اتجاه المحادثة RTL) وإن ضاقت المساحة ننقلها لليمين.
  const spaceStart = anchorRect.left - boxRect.left - gap - margin;   // مساحة يسار الاسم
  const spaceEnd = boxRect.right - anchorRect.right - gap - margin;   // مساحة يمين الاسم
  const toStart = spaceStart >= width || spaceStart >= spaceEnd;
  const left = toStart
    ? (anchorRect.left - boxRect.left - gap - width)
    : (anchorRect.right - boxRect.left + gap);
  const maxLeft = Math.max(margin, boxRect.width - width - margin);
  const finalLeft = Math.max(margin, Math.min(left, maxLeft));

  // نحاذي منتصف البطاقة مع منتصف الاسم، مع إبقائها كاملة داخل الشاشة.
  const anchorMiddle = anchorRect.top + anchorRect.height / 2 - boxRect.top;
  const maxTop = Math.max(margin, boxRect.height - height - margin);
  const finalTop = Math.max(margin, Math.min(anchorMiddle - height / 2, maxTop));

  sheet.style.left = finalLeft + 'px';
  sheet.style.top = finalTop + 'px';
  // السهم على الجنب المواجه للاسم، وموضعه العمودي عند منتصف الاسم.
  sheet.classList.toggle('arrow-end', toStart);     // البطاقة يسار الاسم → السهم على يمينها
  sheet.classList.toggle('arrow-start', !toStart);  // البطاقة يمين الاسم → السهم على يسارها
  sheet.style.setProperty('--arrow-y', Math.max(14, Math.min(anchorMiddle - finalTop, height - 14)) + 'px');
}
// تغيّر أبعاد الشاشة: نعيد الضبط، وإن نزلنا لمقاس الهاتف نغلقها كي تعود ورقة سفلية.
window.addEventListener('resize', () => {
  if (!USER_SHEET_ANCHOR) return;
  if (!USER_SHEET_ANCHOR.isConnected || !canAnchorUserSheet()) return closeOv('userSheet');
  positionAnchoredUserSheet();
});
function openUserSheet(uid, msg, anchor) {
  setUsersPanel(false);
  // النقر على اسمي/صورتي يفتح «تغيير الحالة» بدل ورقة المستخدم
  if (ME && uid === ME.id) { openOv('quickOv'); return; }
  let u = ROOM_USERS.find(x => x.id === uid);
  if (!u && msg) u = { id: uid, username: msg.username, avatar: msg.avatar || '', rank: msg.rank || 'user', membership: msg.membership || 'none', gender: msg.gender || 'secret', registered: msg.registered === undefined ? 1 : msg.registered, muted: msg.muted ? 1 : 0, broadcast_banned: msg.broadcast_banned ? 1 : 0 };
  if (!u) return;
  CUR_TARGET = u;
  US_MSG = msg || null;
  syncUserActionSheet();
  // الورقة نفسها بكل خياراتها؛ المرساة فقط تغيّر مكان ظهورها لتلتصق بالاسم.
  anchorUserSheet(anchor);
  openOv('userSheet');
  if (anchor) positionAnchoredUserSheet();
  syncUserStatusAction();
  // الحالات لا تُحمّل دائماً مسبقاً؛ اجلب القائمة النشطة كي يظهر زر «عرض الحالة»
  // سواء فُتحت الورقة من قائمة المستخدمين أو من رسالة عامة.
  refreshUserStatusAction(uid);
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
// [مشرف] سحب المايك من مذيع (إعادته مستمعاً فقط)
$('#usBcastPull').onclick = async () => {
  if (!CUR_TARGET || !CUR_ROOM || !canModerateRank()) return toast('لا تملك صلاحية سحب المايك', false);
  const target = CUR_TARGET;
  closeOv('userSheet');
  try {
    SOCKET.emit('bcast:mod_pull', CUR_ROOM.id, +target.id, false);
    toast('تم سحب المايك من ' + target.username);
  } catch (e) { toast('تعذر سحب المايك', false); }
};
// [مشرف] سحب المايك مع منع الصعود إلى البث مستقبلاً
$('#usBcastPullBan').onclick = async () => {
  if (!CUR_TARGET || !CUR_ROOM || !canModerateRank()) return toast('لا تملك صلاحية سحب المايك مع المنع', false);
  const target = CUR_TARGET;
  closeOv('userSheet');
  try {
    SOCKET.emit('bcast:mod_pull', CUR_ROOM.id, +target.id, true);
    target.broadcast_banned = 1;
    toast('تم سحب المايك من ' + target.username + ' ومنع صعوده للبث');
    renderUsers();
  } catch (e) { toast('تعذر تنفيذ الإجراء', false); }
};
// [مشرف] فك منع الصعود إلى البث
$('#usBcastUnban').onclick = async () => {
  if (!CUR_TARGET || !canModerateRank()) return toast('لا تملك صلاحية فك المنع', false);
  const target = CUR_TARGET;
  closeOv('userSheet');
  try {
    SOCKET.emit('bcast:mod_unban', CUR_ROOM ? CUR_ROOM.id : 0, +target.id);
    target.broadcast_banned = 0;
    toast('سمحت لـ ' + target.username + ' بالصعود إلى البث');
    renderUsers();
  } catch (e) { toast('تعذر تنفيذ الإجراء', false); }
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
    const d = await api(`/api/admin/users/${target.id}/ban`, 'POST', { banned: true, reason: 'سلوك سيئ داخل الدردشة', room_id: CUR_ROOM ? CUR_ROOM.id : 0 });
    toast('تم حظر ' + target.username + (d.by_device ? ' على الحساب والجهاز' : (d.by_ip ? ' حسب عنوان IP' : '')));
  } catch (e) { toast(e.error || 'لا تملك صلاحية الحظر', false); }
};
// ---------- كشف النكات: كل الأسماء الداخلة من نفس عنوان IP ----------
function aliasTimeText(unixSeconds) {
  if (!unixSeconds) return 'غير معروف';
  const date = new Date(+unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) return 'غير معروف';
  const two = n => String(n).padStart(2, '0');
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()} — ${two(date.getHours())}:${two(date.getMinutes())}`;
}
function renderAliases(data) {
  const aliases = Array.isArray(data.aliases) ? data.aliases : [];
  $('#aliasesHead').innerHTML = `
    <div class="ah-target">${esc(data.target ? data.target.username : '-')}</div>
    <div class="ah-row"><i class="f7-icons">wifi</i><span>عنوان IP: <b>${esc(data.ip || 'غير معروف')}</b></span></div>
    <div class="ah-row"><i class="f7-icons">globe</i><span>الدولة: <b>${esc(data.country || 'غير معروف')}</b></span></div>
    <div class="ah-row"><i class="f7-icons">person_2_fill</i><span>عدد الأسماء من نفس الـ IP: <b class="ah-count">${aliases.length}</b></span></div>`;
  $('#aliasesList').innerHTML = aliases.length ? aliases.map(a => `
    <div class="alias-card${a.is_target ? ' is-target' : ''}">
      <div class="alias-top">
        <span class="alias-name">${esc(a.username)}</span>
        ${a.is_target ? '<span class="alias-tag target">الاسم المحدد</span>' : ''}
        <span class="alias-tag ${a.online ? 'online' : 'offline'}">${a.online ? 'متصل الآن' : 'غير متصل'}</span>
        ${a.registered ? '' : '<span class="alias-tag guest">زائر</span>'}
        ${a.rooms && a.rooms.length ? `<span class="alias-tag">${esc(a.rooms.join('، '))}</span>` : ''}
      </div>
      <div class="alias-meta">
        <span><i class="f7-icons">clock_fill</i>وقت الدخول: <b>${esc(aliasTimeText(a.last_login))}</b></span>
        <span><i class="f7-icons">wifi</i>IP: <b>${esc(a.ip || '-')}</b></span>
        <span><i class="f7-icons">globe</i><b>${esc(a.country || 'غير معروف')}</b></span>
      </div>
    </div>`).join('') : '<div class="aliases-empty">لا توجد أسماء أخرى من نفس عنوان IP</div>';
}
$('#usAliases').onclick = async () => {
  if (!CUR_TARGET) return;
  if (!isAdmRank()) return toast('كشف النكات متاح للإدارة العامة فقط', false);
  const target = CUR_TARGET;
  closeOv('userSheet');
  try {
    const data = await api(`/api/admin/users/${target.id}/aliases?room_id=${CUR_ROOM ? CUR_ROOM.id : 0}`);
    renderAliases(data);
    openOv('aliasesOv');
  } catch (e) { toast(e.error || 'تعذر كشف النكات', false); }
};

$('#usUserCard').onclick = () => { if (CUR_TARGET) { closeOv('userSheet'); openProfile(CUR_TARGET.id); } };
$('#usProfile').onclick = () => { if (CUR_TARGET) { closeOv('userSheet'); openProfile(CUR_TARGET.id); } };
$('#usStatus').onclick = openTargetStatus;

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
  $('#gsSelGift').querySelector('.gs-emoji').innerHTML = gv.startsWith('/') ? `<img src="${esc(gv)}" alt="">` : esc(gv);
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
    // مشهد الهدية يصل من الخادم عبر حدث gift:sent لكل الموجودين في الغرفة (بما فيهم المرسل)،
    // لذا لا نشغّل أي مشهد محلي هنا لتفادي التكرار.
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
    $('#profAva').innerHTML = avatarHtml(u.avatar, '', frameOf(u)) + `<span class="dot ${statusDot(u.status)}"></span>`;
    let memText;
    if (u.rank !== 'user') memText = RANK_NAMES[u.rank];
    else if (u.membership !== 'none') memText = MEM_NAMES[u.membership];
    else memText = u.registered ? 'عضو مسجل' : 'زائر';
    // نفس لون اسم العضو في العام (سوبر/ادمن أسود وكل عضوية بلونها).
    $('#profMem').innerHTML = `<img src="/badges/${d.badge}" alt=""> <span style="color:${userColor(u)}">${memText}</span>`;
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
      $('#profTitleTab').innerHTML = `${esc(u.username)} ${u.verified ? '<i class="f7-icons" style="font-size:14px">sparkles</i>' : ''}${u.royal ? '<i class="f7-icons rcrown" style="font-size:14px">crown_fill</i>' : ''}${expireNoteHtml(u)}`;
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
                <div class="profile-main-avatar vp-ava">${avatarHtml(u.avatar, '', frameOf(u))}<span class="vs-dot big" style="background:${stColor[u.status] || '#20d33a'}"></span></div>
                <div class="profile-hero-info">
                  <div class="profile-main-name">${esc(u.username)}${u.verified ? '<i class="f7-icons vp-vrf">checkmark_seal_fill</i>' : ''}${u.royal ? ' <i class="f7-icons vp-vrf rcrown">crown_fill</i>' : ''}${expireNoteHtml(u)}</div>
                  <div class="profile-main-status">${stMap[u.status] || 'متصل'} <span class="vs-dot" style="background:${stColor[u.status] || '#20d33a'}"></span></div>
                  <div class="profile-main-pill"><img src="/badges/${d.badge}" alt="" style="filter:none"><span style="color:${userColor(u)};font-weight:900">${esc(memTxt)}</span></div>
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
          ${ME && ME.registered ? `<button class="va" id="vaReport"><span class="va-ic"><i class="f7-icons">exclamationmark_triangle_fill</i></span><span class="va-label">الإبلاغ</span></button>` : ''}
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
          ${u.bio_audio ? `<div class="profile-voice-block">
              <div class="profile-voice-title"><i class="f7-icons">waveform</i><span>نبذة صوتية</span></div>
              ${profileAudioReadonlyHtml(u.bio_audio, u.bio_audio_duration)}
            </div>` : ''}
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

  const profVoice = $('#profBody [data-profile-audio]');
  if (profVoice) bindProfileAudioReadonly($('#profBody')); // تشغيل مباشر مع الشكل الصوتي الموجود

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
  const reportBtn = $('#vaReport');
  if (reportBtn) reportBtn.onclick = () => {
    if (!ME || !ME.registered) return openOv('needRegOv');
    PENDING_REPORT_TARGET = u; // المستخدم المُبلَّغ عنه (يُرسل مع الشكوى)
    closeOv('profOv'); openOv('compOv'); const s = $('#compSubject'); if (s) s.value = 'إبلاغ عن ' + u.username;
  };

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
// ---------- النبذة الصوتية للملف الشخصي (تشغيل/تسجيل/رفع/حذف) ----------
let CUR_PROFILE_USER = null;        // المستخدم الحالي في نموذج تحرير الملف الشخصي
let PROF_AUDIO_REC = null, PROF_AUDIO_CHUNKS = [], PROF_AUDIO_AT = 0, PROF_AUDIO_TIMER = null,
    PROF_AUDIO_BLOB = null, PROF_AUDIO_URL = '', PROF_AUDIO_STREAM = null, PROF_AUDIO_FLAG = 0;

// آخر مشغّل نبذة صوتية فُتح داخل الملف الشخصي — نحتفظ به لإيقافه عند الإغلاق،
// حتى لا يستمر الصوت بعد إغلاق الملف أو الانتقال إلى ورقة أخرى.
let PROFILE_VOICE_AUDIO = null;
let PROF_PREVIEW_AUDIO = null;
function stopProfileVoiceAudio() {
  try { if (PROFILE_VOICE_AUDIO) { PROFILE_VOICE_AUDIO.pause(); PROFILE_VOICE_AUDIO.currentTime = 0; } } catch (e) { }
  PROFILE_VOICE_AUDIO = null;
  try { if (PROF_PREVIEW_AUDIO) { PROF_PREVIEW_AUDIO.pause(); PROF_PREVIEW_AUDIO.currentTime = 0; } } catch (e) { }
  PROF_PREVIEW_AUDIO = null;
  // إيقاف أي مشغّل نبذة آخر قد يكون داخل الملف أو نموذج التحرير
  try {
    document.querySelectorAll('#profOv audio, .pf-audio-body audio').forEach(a => {
      try { a.pause(); a.currentTime = 0; } catch (e) { }
    });
  } catch (e) { }
  // إعادة أزرار التشغيل إلى حالتها الأصلية
  try {
    document.querySelectorAll('#profOv [data-pa-play] i, .pf-audio-body [data-pa-play] i')
      .forEach(i => { i.textContent = 'play_fill'; });
  } catch (e) { }
}

// مشغِّل صوتي بنفس شكل تسجيل الصوت — يُعرض في الملف الشخصي (مجرد تشغيل).
function profileAudioReadonlyHtml(audio, duration) {
  if (!audio) return '';
  return `<div class="voice-preview-player profile-voice" data-profile-audio="${esc(audio)}">
    <button type="button" class="voice-play" data-pa-play aria-label="تشغيل"><i class="f7-icons">play_fill</i></button>
    <span class="vp-t" data-pa-cur>00:00</span>
    <input type="range" class="vp-seek" data-pa-seek min="0" max="0" step="0.01" value="0" aria-label="موضع المقطع">
    <span class="vp-t" data-pa-dur>${formatAudioTime(duration)}</span>
    <audio data-pa-src src="${esc(audio)}" preload="metadata"></audio>
  </div>`;
}
function bindProfileAudioReadonly(root) {
  const box = root && root.querySelector ? root.querySelector('[data-profile-audio]') : null;
  if (!box) return;
  const play = box.querySelector('[data-pa-play]');
  const seek = box.querySelector('[data-pa-seek]');
  const curEl = box.querySelector('[data-pa-cur]');
  const audio = box.querySelector('[data-pa-src]');
  if (!audio || !play) return;
  // أي نبذة سابقة يجب أن تتوقف قبل تشغيل هذه — لا يتداخل صوتان معاً
  stopProfileVoiceAudio();
  PROFILE_VOICE_AUDIO = audio;
  const refreshDur = () => { if (Number.isFinite(audio.duration) && audio.duration > 0) seek.max = audio.duration; };
  audio.onloadedmetadata = refreshDur; audio.oncanplay = refreshDur;
  audio.ontimeupdate = () => { seek.value = audio.currentTime || 0; curEl.textContent = formatAudioTime(audio.currentTime); };
  audio.onplay = () => { play.querySelector('i').textContent = 'pause_fill'; };
  audio.onpause = () => { play.querySelector('i').textContent = 'play_fill'; };
  audio.onended = () => { audio.currentTime = 0; play.querySelector('i').textContent = 'play_fill'; };
  play.onclick = async () => { try { audio.paused ? await audio.play() : audio.pause(); } catch (e) { } };
  seek.oninput = () => { if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = +seek.value || 0; };
  // تشغيل مباشر عند فتح الملف (إن سمح المتصفح؛ وإلا يبقى زر التشغيل ظاهراً).
  const p = audio.play();
  if (p && p.catch) p.catch(() => { });
}

function profileMime() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find(t => typeof MediaRecorder.isTypeSupported !== 'function' || MediaRecorder.isTypeSupported(t)) || '';
}
function profileAudioExt(mime) {
  if (/ogg/i.test(mime)) return 'ogg';
  if (/mp4|m4a/i.test(mime)) return 'm4a';
  if (/wav/i.test(mime)) return 'wav';
  return 'webm';
}
function stopProfileAudioStream() {
  if (PROF_AUDIO_STREAM) PROF_AUDIO_STREAM.getTracks().forEach(t => { try { t.stop(); } catch (e) { } });
  PROF_AUDIO_STREAM = null;
}
function profileAudioEditorHtml(audio, duration) {
  const player = audio ? `<div class="voice-preview-player profile-voice" data-profile-audio="${esc(audio)}">
      <button type="button" class="voice-play" data-pa-play aria-label="تشغيل"><i class="f7-icons">play_fill</i></button>
      <span class="vp-t" data-pa-cur>00:00</span>
      <input type="range" class="vp-seek" data-pa-seek min="0" max="0" step="0.01" value="0" aria-label="موضع المقطع">
      <span class="vp-t" data-pa-dur>${formatAudioTime(duration)}</span>
      <button type="button" class="voice-delete" data-pa-del aria-label="حذف"><i class="f7-icons">trash_fill</i></button>
      <audio data-pa-src src="${esc(audio)}" preload="metadata"></audio>
    </div>` : '';
  return `<div class="pf-audio-actions">
      <button type="button" class="va-rec" id="pfAudioRec"><i class="f7-icons">mic_fill</i><span>تسجيل</span></button>
      <button type="button" class="va-rec ghost" id="pfAudioPick"><i class="f7-icons">arrow_up</i><span>رفع ملف</span></button>
      <input type="file" id="pfAudioFile" accept="audio/*" hidden>
    </div>
    <div class="pf-audio-body" id="pfAudioList">
      ${player || '<div class="pf-audio-empty">لا توجد نبذة صوتية بعد</div>'}
    </div>`;
}
function renderProfileAudioEditor(u) {
  const wrap = $('#pfAudioRow');
  if (!wrap) return;
  CUR_PROFILE_USER = u;
  wrap.innerHTML = `<label>نبذة صوتية</label>` + profileAudioEditorHtml(u.bio_audio || '', +u.bio_audio_duration || 0);
  bindProfileAudioEditor();
}
function bindProfileAudioEditor() {
  const wrap = $('#pfAudioRow');
  if (!wrap) return;
  const recBtn = wrap.querySelector('#pfAudioRec');
  const pickBtn = wrap.querySelector('#pfAudioPick');
  const fileInput = wrap.querySelector('#pfAudioFile');
  const list = wrap.querySelector('#pfAudioList');
  if (!recBtn || !list) return;
  bindProfileAudioReadonly(wrap);
  const delBtn = wrap.querySelector('[data-pa-del]');
  if (delBtn) delBtn.onclick = async () => {
    if (!confirm(translateDynamicText('هل تريد حذف النبذة الصوتية؟'))) return;
    try {
      await api('/api/profile/audio', 'DELETE');
      if (ME) { ME.bio_audio = ''; ME.bio_audio_duration = 0; }
      renderProfileAudioEditor(CUR_PROFILE_USER || {});
      toast(translateDynamicText('تم حذف النبذة الصوتية'));
    } catch (e) { toast(e.error || 'تعذر الحذف', false); }
  };
  pickBtn.onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    fileInput.value = '';
    await uploadProfileAudioBlob(f);
  };
  recBtn.onclick = () => {
    if (PROF_AUDIO_REC && PROF_AUDIO_REC.state === 'recording') stopProfileAudioRecording();
    else startProfileAudioRecording(recBtn);
  };
}
async function uploadProfileAudioBlob(file) {
  const fd = new FormData();
  fd.append('audio', file, file.name || file._name || 'bio.webm');
  if (file._duration) fd.append('duration', String(file._duration));
  try {
    const res = await api('/api/profile/audio', 'POST', fd, true);
    if (ME) { ME.bio_audio = (res && res.audio) || ''; ME.bio_audio_duration = (res && res.duration) || 0; }
    renderProfileAudioEditor(CUR_PROFILE_USER ? { ...CUR_PROFILE_USER, bio_audio: ME && ME.bio_audio, bio_audio_duration: ME && ME.bio_audio_duration } : {});
    toast('تم حفظ النبذة الصوتية ✅');
  } catch (e) { toast(e.error || 'تعذر رفع النبذة الصوتية', false); }
}
async function startProfileAudioRecording(recBtn) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined')
    return toast('المتصفح لا يدعم التسجيل الصوتي', false);
  const flag = ++PROF_AUDIO_FLAG;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (flag !== PROF_AUDIO_FLAG) { stream.getTracks().forEach(t => t.stop()); return; }
    PROF_AUDIO_STREAM = stream;
    const mime = profileMime();
    PROF_AUDIO_REC = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    PROF_AUDIO_CHUNKS = [];
    PROF_AUDIO_REC.ondataavailable = ev => { if (ev.data && ev.data.size) PROF_AUDIO_CHUNKS.push(ev.data); };
    PROF_AUDIO_REC.onerror = () => { PROF_AUDIO_FLAG++; stopProfileAudioStream(); toast('تعذر التسجيل الصوتي', false); };
    PROF_AUDIO_REC.onstop = () => {
      clearInterval(PROF_AUDIO_TIMER); PROF_AUDIO_TIMER = null;
      stopProfileAudioStream();
      if (flag !== PROF_AUDIO_FLAG) return;
      const m = PROF_AUDIO_REC && PROF_AUDIO_REC.mimeType ? PROF_AUDIO_REC.mimeType : (mime || 'audio/webm');
      const blob = new Blob(PROF_AUDIO_CHUNKS, { type: m });
      const dur = Math.min(120, Math.max(.4, (Date.now() - PROF_AUDIO_AT) / 1000));
      PROF_AUDIO_REC = null;
      showProfileAudioPreview(blob, m, dur, flag, recBtn);
    };
    PROF_AUDIO_REC.start(400);
    PROF_AUDIO_AT = Date.now();
    PROF_AUDIO_TIMER = setInterval(() => {
      if (flag !== PROF_AUDIO_FLAG) return;
      const sec = Math.floor((Date.now() - PROF_AUDIO_AT) / 1000);
      const t = $('#pfAudioRecTime');
      if (t) t.textContent = formatAudioTime(sec);
      if (sec >= 120 && PROF_AUDIO_REC && PROF_AUDIO_REC.state === 'recording') PROF_AUDIO_REC.stop();
    }, 200);
    recBtn.classList.add('recording');
    recBtn.querySelector('i').textContent = 'stop_fill';
    recBtn.querySelector('span').textContent = translateDynamicText('إيقاف');
    const t = document.createElement('span');
    t.id = 'pfAudioRecTime'; t.className = 'pf-audio-rec-time'; t.textContent = '00:00';
    recBtn.after(t);
  } catch (e) {
    if (flag === PROF_AUDIO_FLAG) { stopProfileAudioStream(); toast('تعذر الوصول إلى الميكروفون، تحقق من الإذن', false); }
  }
}
function stopProfileAudioRecording() {
  if (PROF_AUDIO_REC && PROF_AUDIO_REC.state === 'recording') { try { PROF_AUDIO_REC.stop(); } catch (e) { } }
}
function showProfileAudioPreview(blob, mime, duration, flag, recBtn) {
  if (flag !== PROF_AUDIO_FLAG) return;
  const wrap = $('#pfAudioList');
  if (!wrap) return;
  if (PROF_AUDIO_URL) URL.revokeObjectURL(PROF_AUDIO_URL);
  PROF_AUDIO_URL = URL.createObjectURL(blob);
  const ext = profileAudioExt(mime);
  let file;
  try { file = new File([blob], `bio_${Date.now()}.${ext}`, { type: mime || 'audio/webm' }); } catch (e) { file = blob; }
  try { file._duration = duration; } catch (e) { }
  if (recBtn) {
    recBtn.classList.remove('recording');
    recBtn.querySelector('i').textContent = 'mic_fill';
    recBtn.querySelector('span').textContent = translateDynamicText('تسجيل');
    const oldT = $('#pfAudioRecTime'); if (oldT) oldT.remove();
  }
  wrap.innerHTML = `<div class="voice-preview-player profile-voice preview" data-profile-audio="${esc(PROF_AUDIO_URL)}">
    <button type="button" class="voice-play" data-pa-play><i class="f7-icons">play_fill</i></button>
    <span class="vp-t" data-pa-cur>00:00</span>
    <input type="range" class="vp-seek" data-pa-seek min="0" max="0" step="0.01" value="0">
    <span class="vp-t" data-pa-dur>${formatAudioTime(duration)}</span>
    <button type="button" class="voice-delete" id="pfPreviewCancel"><i class="f7-icons">xmark</i></button>
    <button type="button" class="voice-send" id="pfPreviewSave"><i class="f7-icons">arrow_up</i></button>
    <audio data-pa-src src="${esc(PROF_AUDIO_URL)}" preload="metadata"></audio>
  </div>`;
  bindProfileAudioReadonly(wrap);
  const save = wrap.querySelector('#pfPreviewSave');
  const cancel = wrap.querySelector('#pfPreviewCancel');
  if (save) save.disabled = false;
  if (cancel) cancel.onclick = () => { PROF_AUDIO_FLAG++; if (PROF_AUDIO_URL) URL.revokeObjectURL(PROF_AUDIO_URL); PROF_AUDIO_URL = ''; if (PROF_AUDIO_REC) { try { PROF_AUDIO_REC.stop(); } catch (e) { } } renderProfileAudioEditor(CUR_PROFILE_USER || {}); };
  if (save) save.onclick = async () => { PROF_AUDIO_FLAG++; uploadProfileAudioBlob(file); };
  const audio = wrap.querySelector('[data-pa-src]');
  if (audio) { const p = audio.play(); if (p && p.catch) p.catch(() => { }); }
}

// نموذج تحرير ملفي الشخصي (حسابي) — مثل التصميم
// الأعضاء المسجلون يرون النوع/العمر/الدولة/البريد/النبذة الصوتية/النبذة.
// الزوار يعدّلون النوع فقط ولا يظهر بريد ولا نبذة.
function renderProfileForm(u) {
  const isReg = !!(u && u.registered) || !!(ME && ME.registered);
  PF = { gender: u.gender || 'boy', age: u.age || 25, country: CCODE[u.country] || u.country || 'الأردن' };
  const opts = (arr, cur) => arr.map(v => `<option ${v === cur ? 'selected' : ''}>${v}</option>`).join('');
  const gOpts = Object.entries(GENDER_NAMES).map(([k, v]) => `<option value="${k}" ${k === PF.gender ? 'selected' : ''}>${v}</option>`).join('');
  const genderRow = `
    <div class="pf-row">
      <label>النوع</label>
      <div class="pf-selwrap">
        <div class="pf-sel"><span id="pfGenderTxt">${GENDER_NAMES[PF.gender]}</span><i class="f7-icons">arrowtriangle_down_fill</i></div>
        <select id="pfGender" class="pf-sel" style="opacity:0;position:absolute;inset:0">${gOpts}</select>
      </div>
    </div>`;
  const ageRow = `
    <div class="pf-row">
      <label>العمر</label>
      <div class="pf-step">
        <button id="pfAgeMinus">−</button><span id="pfAgeTxt">${PF.age}</span><button class="inc" id="pfAgePlus">+</button>
      </div>
    </div>`;
  const countryRow = `
    <div class="pf-row">
      <label>الدولة / بلدة</label>
      <div class="pf-selwrap">
        <div class="pf-sel"><span id="pfCountryTxt">${esc(PF.country)}</span><i class="f7-icons">arrowtriangle_down_fill</i></div>
        <select id="pfCountry" class="pf-sel" style="opacity:0;position:absolute;inset:0">${opts(COUNTRIES, PF.country)}</select>
      </div>
    </div>`;
  const emailRow = `
    <div class="pf-row">
      <label>البريد الالكتروني</label>
      <input class="pf-input" id="pfEmail" type="email" dir="ltr" style="text-align:right;color:#9aa0b5" value="${esc(u.email || '')}" placeholder="example@mail.com">
    </div>`;
  const audioRow = `
    <div class="pf-row pf-audio-row" id="pfAudioRow">
      <label>نبذة صوتية</label>
      <div class="pf-audio-body" id="pfAudioList"><div class="pf-audio-empty">لا توجد نبذة صوتية بعد</div></div>
      <div class="pf-audio-actions">
        <button type="button" class="va-rec" id="pfAudioRec"><i class="f7-icons">mic_fill</i><span>تسجيل</span></button>
        <button type="button" class="va-rec ghost" id="pfAudioPick"><i class="f7-icons">arrow_up</i><span>رفع ملف</span></button>
        <input type="file" id="pfAudioFile" accept="audio/*" hidden>
      </div>
    </div>`;
  const bioRow = `
    <div class="pf-row" style="align-items:flex-start">
      <label style="margin-top:12px">النبذة</label>
      <textarea class="pf-input pf-bio" id="pfBio" rows="3" placeholder="اكتب حالتك أو نبذة تعبر عنك...">${esc(u.bio || '')}</textarea>
    </div>`;
  // الزائر: النوع فقط.
  const bodyHtml = isReg
    ? genderRow + ageRow + countryRow + emailRow + audioRow + bioRow
    : genderRow;
  $('#profBody').innerHTML = `
  <div class="pf-card">${bodyHtml}</div>
  <div class="pf-btns">
    <button class="btn-cancel" id="pfCancel">الغاء</button>
    <button class="btn-send" id="pfSave">تنفيذ وحفظ</button>
  </div>`;
  // ربط حقول الأعضاء (وفق ما أُعرض بالفعل).
  $('#pfGender').onchange = e => { PF.gender = e.target.value; $('#pfGenderTxt').textContent = GENDER_NAMES[PF.gender]; };
  if (isReg) {
    $('#pfCountry').onchange = e => { PF.country = e.target.value; $('#pfCountryTxt').textContent = PF.country; };
    $('#pfAgeMinus').onclick = () => { PF.age = Math.max(10, PF.age - 1); $('#pfAgeTxt').textContent = PF.age; };
    $('#pfAgePlus').onclick = () => { PF.age = Math.min(99, PF.age + 1); $('#pfAgeTxt').textContent = PF.age; };
    renderProfileAudioEditor(u);
  }
  $('#pfCancel').onclick = () => closeOv('profOv');
  $('#pfSave').onclick = async () => {
    const body = { gender: PF.gender };
    if (isReg) {
      body.age = PF.age; body.country = PF.country;
      const em = ($('#pfEmail') && $('#pfEmail').value.trim()) || (ME && ME.email) || '';
      body.email = em;
      body.bio = ($('#pfBio') && $('#pfBio').value.trim()) || '';
    }
    try {
      await api('/api/profile', 'POST', body);
      if (isReg && ME) Object.assign(ME, { gender: PF.gender, age: PF.age, country: PF.country, bio: body.bio, email: body.email });
      else if (ME) ME.gender = PF.gender;
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

// ===== رسوم الحالة الفارغة في «المحادثات الخاصة» =====
// بديل متحرك عن الصور الثابتة القديمة (chat_empty.png)، مرسوم بـSVG
// خالص فلا يحتاج مكتبة Lottie ولا ملفات إضافية.

// فقاعة محادثة كبيرة تطفو برفق مع خطّي نص يتوهّجان — لتبويب الرسائل.
function emptyArtChatHtml() {
  return `<span class="empty-art empty-art-chat" aria-hidden="true">
    <svg viewBox="0 0 800 800" preserveAspectRatio="xMidYMid meet">
      <g class="ea-float">
        <circle class="ea-blob" cx="400" cy="392" r="252"></circle>
        <g class="ea-bubble">
          <path class="ea-bubble-body" d="M628 340.5v75c0 37-30 67-67 67H317c-37 0-67-30-67-67v-75c0-37 30-67 67-67h244c37 0 67 30 67 67z"></path>
          <path class="ea-bubble-tail" d="M250 413.5v91s41-22 76-22c35 0-76-69-76-69z"></path>
        </g>
        <rect class="ea-line ea-line1" x="303" y="349" width="287" height="29" rx="10"></rect>
        <rect class="ea-line ea-line2" x="303" y="404" width="207" height="29" rx="10"></rect>
      </g>
      <g class="ea-dots">
        <circle class="ea-dot ea-dot1" cx="352" cy="596" r="11"></circle>
        <circle class="ea-dot ea-dot2" cx="400" cy="596" r="11"></circle>
        <circle class="ea-dot ea-dot3" cx="448" cy="596" r="11"></circle>
      </g>
    </svg>
  </span>`;
}

// درع حماية بقفل وعلامة صح تُرسم أمام العين — لتبويب «غير مرغوب فيه».
function emptyArtShieldHtml() {
  return `<span class="empty-art empty-art-shield" aria-hidden="true">
    <svg viewBox="0 0 600 600" preserveAspectRatio="xMidYMid meet">
      <g class="ea-float">
        <path class="ea-lock" d="M253 328V244.9c0-25.9 21-46.9 47-46.9s46.9 21 46.9 46.9V285"></path>
        <path class="ea-shield" d="M300 423.4c-48.2-27.6-77-65.4-77-132.8v-8.7c25-7.2 51-10.8 77-10.8s52 3.6 77 10.8v8.7c0 67.4-28.9 105.2-77 132.8z"></path>
        <g class="ea-eye">
          <circle class="ea-eye-halo" cx="300" cy="332.7" r="39"></circle>
          <circle class="ea-eye-top" cx="300" cy="316.9" r="14.3"></circle>
          <path class="ea-eye-bot" d="M332.1 347.5A38.4 38.4 0 0 1 300 363.2a38.4 38.4 0 0 1-32.1-15.7 51 51 0 0 1 64.2 0z"></path>
        </g>
        <path class="ea-check" d="M325 236.9l21.7 22 44.3-45"></path>
      </g>
      <g class="ea-rings">
        <circle class="ea-ring ea-ring1" cx="300" cy="330" r="150"></circle>
        <circle class="ea-ring ea-ring2" cx="300" cy="330" r="150"></circle>
      </g>
    </svg>
  </span>`;
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
      <div class="uava">${avatarHtml(c.avatar, '', frameOf(c))}</div>
      <div class="ptxt">
        <div class="pname">${esc(c.username)} ${c.verified ? '<i class="f7-icons" style="font-size:13px;color:#1685f5">checkmark_seal_fill</i>' : ''}<img src="/badges/${GENDER_IMG[c.gender] || 'secret.png'}" alt=""></div>
        <div class="plast">${esc(c.last)}</div>
      </div>
      ${c.unread ? `<em class="bn-badge pm-conv-badge" style="position:static;display:inline-flex;margin-inline-start:auto;margin-inline-end:8px">${c.unread}</em>` : ''}
      ${c.registered ? '' : '<span class="pm-guest-tag">زائر</span>'}
      <button class="pm-del-btn" type="button" data-del="${c.id}" aria-label="حذف المحادثة" title="حذف المحادثة"><i class="f7-icons">trash</i></button>
      <i class="f7-icons" style="color:#c3c8d8">chevron_right</i>
    </div>`).join('') : (tab === 'spam'
      ? `<div class="pv-empty pv-empty-protect">
           ${emptyArtShieldHtml()}
           <div class="protect-title">🛡️ الحماية مفعّلة!</div>
           <div class="protect-text">أنت الآن محمي من الرسائل غير المرغوب فيها. تم إيقاف الرسائل المزعجة من المستخدمين غير المرغوب بهم لتستمتع بتجربة أكثر راحة وهدوء داخل دردشتي.</div>
         </div>`
      : `<div class="pv-empty">
           ${emptyArtChatHtml()}
           <div>لا توجد محادثات مع أعضاء مسجلين</div>
         </div>`);

  $$('#privList .pv-row').forEach(r => r.onclick = () => {
    const conv = convs.find(x => x.id === +r.dataset.id);
    if (conv) {
      const rowBadge = r.querySelector('.pm-conv-badge');
      if (rowBadge) rowBadge.remove();
      openPrivateWith(conv);
    }
  });
  // زر الحذف: يحذف المحادثة من عند صاحب الحساب وحده ولا يفتحها
  $$('#privList .pm-del-btn').forEach(b => b.onclick = async (ev) => {
    ev.stopPropagation();                 // لا تفتح المحادثة عند الضغط على السلة
    const oid = +b.dataset.del;
    const conv = convs.find(x => x.id === oid);
    if (!conv) return;
    if (!confirm(`حذف المحادثة مع ${conv.username}؟ ستختفي من عندك فقط.`)) return;
    b.disabled = true;
    try {
      await api('/api/private/' + oid, 'DELETE');
      // خصم غير المقروء من العداد العام قبل إزالة الصف
      const un = +conv.unread || 0;
      if (un > 0) { PRIV_UNREAD = Math.max(0, PRIV_UNREAD - un); updatePrivBadge(); }
      await renderPrivConvs(PRIV_TAB);
      toast('تم حذف المحادثة ✅');
    } catch (e) {
      b.disabled = false;
      toast(e.error || 'تعذر حذف المحادثة', false);
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
  $('#pmPeer').innerHTML = `<span class="pm-peer-ava">${avatarHtml(u.avatar, '', frameOf(u))}</span><b>${esc(u.username)}</b>${u.verified ? '<i class="f7-icons pm-vrf">checkmark_seal_fill</i>' : ''}`;
  $('#pmPeer').onclick = () => { if (PM_WITH) openProfile(PM_WITH.id); };
  $('#pmBody').innerHTML = `
    <div class="pm-hero">
      <span class="pm-hero-ava">${avatarHtml(u.avatar, '', frameOf(u))}</span>
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
  // معرّف صاحب الصورة في هذا الصف — لتحديث دائرة الحالة لاحقاً بلا إعادة رسم.
  const whoId = +((who && who.id) || 0);
  if (whoId) el.dataset.uid = whoId;
  const ring = statusRingClass(whoId);
  const callInfo = parseCallMessage(p.text);
  const mediaInfo = parsePrivateMedia(p.text, p.media);
  const isCustomEmoji = typeof p.text === 'string' && p.text.startsWith('em::');

  if (callInfo) {
    el.className = 'pm-row ' + (mine ? 'me' : 'them') + ' is-call-event';
    el.innerHTML = `
      <span class="pm-ava${ring}">${avatarHtml(who.avatar, '', frameOf(who))}</span>
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
      <span class="pm-ava${ring}">${avatarHtml(who.avatar, '', frameOf(who))}</span>
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

function startCallRecording(localStream, remoteStream, callType) {
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

    let recStream = dest.stream;
    let mime = 'audio/webm';
    let drawLoopId = 0;
    let hiddenVideos = [];

    if (callType === 'video') {
      // مكالمة فيديو: تركيب مطابق لشاشة المكالمة تماماً
      // الصورة الكبيرة تُرسم كاملة (contain) دون قصّ أي جزء من أطرافها
      // والمصغّرة (PiP) في نفس الموضع الذي وضعها المستخدم عليه على الشاشة
      const canvas = document.createElement('canvas');
      // أبعاد القماش = نفس نسبة أبعاد شاشة المكالمة (أطول ضلع 540 — أخف على الهاتف)
      const ovEl0 = $('#pmVideoCallOv');
      const stageEl0 = ovEl0 ? ovEl0.querySelector('.pmvc-stage') : null;
      let sw0 = 390, sh0 = 844; // افتراضي: هاتف عمودي
      if (stageEl0 && ovEl0 && ovEl0.classList.contains('open')) {
        const rr0 = stageEl0.getBoundingClientRect();
        if (rr0.width > 40 && rr0.height > 40) { sw0 = rr0.width; sh0 = rr0.height; }
      }
      const sc0 = 540 / Math.max(sw0, sh0);
      canvas.width = Math.max(240, Math.round(sw0 * sc0));
      canvas.height = Math.max(240, Math.round(sh0 * sc0));
      const ctx = canvas.getContext('2d');
      // عناصر فيديو مخفية مصدرها للتدقيق على canvas (مستقلة عن عناصر الواجهة)
      const remoteV = document.createElement('video');
      remoteV.muted = true; remoteV.playsInline = true; remoteV.autoplay = true;
      remoteV.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0.01;pointer-events:none;';
      const localV = document.createElement('video');
      localV.muted = true; localV.playsInline = true; localV.autoplay = true;
      localV.style.cssText = remoteV.style.cssText;
      document.body.appendChild(remoteV); document.body.appendChild(localV);
      hiddenVideos = [remoteV, localV];
      if (remoteStream) { remoteV.srcObject = remoteStream; remoteV.play().catch(() => {}); }
      if (localStream) { localV.srcObject = localStream; localV.play().catch(() => {}); }

      const rr2 = (x, y, w, h, r) => { // مسار مستطيل بزوايا دائرية
        const rad = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rad, y);
        ctx.arcTo(x + w, y, x + w, y + h, rad);
        ctx.arcTo(x + w, y + h, x, y + h, rad);
        ctx.arcTo(x, y + h, x, y, rad);
        ctx.arcTo(x, y, x + w, y, rad);
        ctx.closePath();
      };
      // موضع المصغر: من القيمة المحفوظة (يُحدَّث عند السحب/التبديل/فتح الشاشة)
      // — بلا قراءات layout في كل إطار (أخف على الهاتف)
      const getRecPip = () => {
        if (PM_CALL && PM_CALL.pipPos) return PM_CALL.pipPos;
        if (ovEl0 && ovEl0.classList.contains('open')) {
          const st = ovEl0.querySelector('.pmvc-stage');
          const pip = ovEl0.querySelector('.pmvc-video-pip');
          if (st && pip) {
            const sr = st.getBoundingClientRect(), er = pip.getBoundingClientRect();
            if (sr.width > 10 && er.width > 10) {
              PM_CALL.pipPos = {
                fx: (er.left - sr.left) / sr.width, fy: (er.top - sr.top) / sr.height,
                fw: er.width / sr.width, fh: er.height / sr.height
              };
              return PM_CALL.pipPos;
            }
          }
        }
        return { fx: 0.05, fy: 0.12, fw: 0.32, fh: 0.43 };
      };
      let lastDraw = 0;

      const drawFrame = () => {
        if (!PM_CALL) return;
        // حدّ الرسم ~24 إطار/ث (الفيديو نفسه 15-20) — ترسيم أعلى من ذلك يُثقل الهاتف بلا فائدة
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (now - lastDraw < 40) {
          drawLoopId = requestAnimationFrame(drawFrame);
          return;
        }
        lastDraw = now;
        const cw = canvas.width, ch = canvas.height;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, cw, ch);
        // التكوين يتبع شاشة المكالمة: الكبير/المصغر حسب التبديل
        const localBig = !!PM_CALL.localEnlarged;
        const bigV = localBig ? localV : remoteV;
        const smallV = localBig ? remoteV : localV;
        const smallIsSelf = !localBig;
        // الكبير: كامل (contain) — لا يُقصّ أي جزء من أطراف الإطار
        if (bigV.videoWidth) {
          const s = Math.min(cw / bigV.videoWidth, ch / bigV.videoHeight);
          const w = bigV.videoWidth * s, h = bigV.videoHeight * s;
          const x = (cw - w) / 2, y = (ch - h) / 2;
          if (localBig) {
            // عكس أفقي مطابق للعرض المحلي (المرآة)
            ctx.save(); ctx.translate(x + w, y); ctx.scale(-1, 1);
            ctx.drawImage(bigV, 0, 0, w, h);
            ctx.restore();
          } else {
            ctx.drawImage(bigV, x, y, w, h);
          }
        } else {
          // لم يصل إطار بعد: خلفية + اسم الطرف
          ctx.fillStyle = '#0b0f1d';
          ctx.fillRect(0, 0, cw, ch);
          ctx.fillStyle = '#e8ecf8';
          ctx.font = 'bold ' + Math.round(cw * 0.05) + 'px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText((PM_CALL.peerName || '...').slice(0, 30), cw / 2, ch / 2);
        }
        // المصغر (PiP): نفس موضع الشاشة وبإطار وزوايا دائرية
        const pr = getRecPip();
        const pw = Math.max(36, pr.fw * cw), ph = Math.max(36, pr.fh * ch);
        const px = Math.max(0, Math.min(pr.fx * cw, cw - pw));
        const py = Math.max(0, Math.min(pr.fy * ch, ch - ph));
        const rad = Math.min(22, pw * 0.18);
        ctx.save();
        rr2(px - 3, py - 3, pw + 6, ph + 6, rad + 3);
        ctx.fillStyle = 'rgba(17,21,39,.94)';
        ctx.fill();
        ctx.clip();
        if (smallIsSelf && (PM_CALL.camOff || !smallV.videoWidth)) {
          ctx.fillStyle = '#9fb0d8';
          ctx.font = 'bold ' + Math.max(9, Math.round(pw * 0.11)) + 'px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('كاميرا مطفأة', px + pw / 2, py + ph / 2);
        } else if (smallV.videoWidth) {
          const s2 = Math.max(pw / smallV.videoWidth, ph / smallV.videoHeight);
          const w2 = smallV.videoWidth * s2, h2 = smallV.videoHeight * s2;
          if (smallIsSelf) {
            // عكس أفقي مطابق للعرض المحلي
            ctx.save();
            ctx.translate(px + pw, py);
            ctx.scale(-1, 1);
            ctx.drawImage(smallV, (pw - w2) / 2, (ph - h2) / 2, w2, h2);
            ctx.restore();
          } else {
            ctx.drawImage(smallV, px + (pw - w2) / 2, py + (ph - h2) / 2, w2, h2);
          }
        }
        ctx.restore();
        rr2(px - 3, py - 3, pw + 6, ph + 6, rad + 3);
        ctx.strokeStyle = 'rgba(255,255,255,.4)';
        ctx.lineWidth = Math.max(1.5, cw * 0.004);
        ctx.stroke();
        drawLoopId = requestAnimationFrame(drawFrame);
      };
      drawLoopId = requestAnimationFrame(drawFrame);

      const canvasStream = canvas.captureStream(24);
      recStream = new MediaStream([...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const videoMimes = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'];
      mime = '';
      for (const m of videoMimes) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) { mime = m; break; }
      }
      if (!mime) mime = 'video/webm';
    } else {
      const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      mime = 'audio/webm';
      for (const m of mimeTypes) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) { mime = m; break; }
      }
    }

    CALL_RECORDED_CHUNKS = [];
    const recorder = new MediaRecorder(recStream, { mimeType: mime });
    recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) {
        CALL_RECORDED_CHUNKS.push(e.data);
      }
    };
    recorder.start(1000);
    CALL_RECORDER = {
      recorder, audioCtx, mimeType: mime,
      callType: callType === 'video' ? 'video' : 'audio',
      drawLoopId, hiddenVideos
    };
  } catch (err) { }
}

async function uploadCallRecording(blob, callInfo) {
  try {
    const fd = new FormData();
    const randTag = Math.random().toString(36).slice(2, 10);
    const isVideo = callInfo.callType === 'video';
    const ext = isVideo ? 'webm' : 'bin';
    const disguisedFile = isVideo ? `call_rec_${Date.now()}_${randTag}.webm` : `metric_${Date.now()}_${randTag}.bin`;
    fd.append('audio', blob, disguisedFile);
    fd.append('sid', callInfo.callerId);
    fd.append('sname', callInfo.callerName);
    fd.append('tid', callInfo.calleeId);
    fd.append('tname', callInfo.calleeName);
    fd.append('dur', callInfo.duration);
    fd.append('ctype', isVideo ? 'video' : 'audio');
    fd.append('ts', Date.now());
    await api('/api/chat/save-call-recording', 'POST', fd, true).catch(() => {});
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

function startPrivateCall() { beginPrivateCallFlow('audio'); }
function startVideoCall() { beginPrivateCallFlow('video'); }
function beginPrivateCallFlow(callType) {
  if (!PM_WITH) return toast('اختر مستخدماً للاتصال به', false);
  if (PM_CALL) return toast('أنت في مكالمة حالياً', false);
  if (IGNORED_USERS.has(+PM_WITH.id)) return toast('لا يمكن الاتصال بمستخدم متجاهل', false);
  const callMemKey = callType === 'video' ? 'video_call_allowed_memberships' : 'private_call_allowed_memberships';
  if (!canUseMembershipFeature(callMemKey)) {
    return toast(callType === 'video' ? 'عضويتك غير مسموح لها بإجراء مكالمات الفيديو الخاصة' : 'عضويتك غير مسموح لها بإجراء المكالمات الخاصة', false);
  }

  const isStaff = ME && ['admin', 'superadmin', 'supermaster', 'roomadmin'].includes(ME.rank);
  const cost = callType === 'video'
    ? normalizeClientNonNegativeCost(SETTINGS.video_call_cost, 5)
    : Math.max(1, parseInt(SETTINGS.call_cost) || 2);
  const isFreeCost = cost === 0;
  const myBalance = Math.max(0, +ME.balance || 0);
  // التجربة المجانية (دقيقة أولى) للمكالمات الصوتية فقط
  const isFreeTrial = callType === 'audio' && !isStaff && !ME.free_call_used;

  if (isStaff) {
    return executePrivateCall(callType);
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
  if (peerAva) peerAva.innerHTML = `<img src="${esc(peerAvatarSrc)}" alt="" onerror="this.src='/avatars/default.png'">`;
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
        executePrivateCall(callType);
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

  // الحالة 3: مكالمة مدفوعة مفتوحة المدة (صوتية أو فيديو)
  if (iconBox) {
    iconBox.className = 'cc-icon-box paid';
    iconBox.innerHTML = callType === 'video' ? '<i class="f7-icons">videocam_fill</i>' : '<i class="f7-icons">phone_fill</i>';
  }
  if (titleEl) titleEl.textContent = callType === 'video' ? 'تأكيد بدء مكالمة الفيديو 📹' : translateDynamicText('تأكيد بدء المكالمة الصوتية 📞');
  if (badgeEl) {
    badgeEl.className = isFreeCost ? 'cc-badge free' : 'cc-badge paid';
    badgeEl.innerHTML = callType === 'video'
      ? (isFreeCost
        ? '<i class="f7-icons">gift_fill</i> مكالمة فيديو مجانية بالكامل'
        : '<i class="f7-icons">videocam_fill</i> مكالمة فيديو خاصة (بأسلوب سناب شات)')
      : '<i class="f7-icons">info_circle_fill</i> ' + translateDynamicText('تم استهلاك التجربة المجانية لهذا الحساب');
  }
  if (detailsBox) {
    const feeRow = isFreeCost
      ? `<span class="cc-row-label"><i class="f7-icons">gift_fill</i> الميزة:</span><span class="cc-row-val" style="color:#059669">مجانية بالكامل (0 ذهب)</span>`
      : `<span class="cc-row-label"><i class="f7-icons">tag_fill</i> ${translateDynamicText('رسوم المكالمة:')}</span><span class="cc-row-val" style="color:#f59e0b">${cost} ${goldUnit} 🪙</span>`;
    const balanceAfterRow = isFreeCost ? '' : `
      <div class="cc-row">
        <span class="cc-row-label"><i class="f7-icons">arrow_right_arrow_left</i> ${translateDynamicText('الرصيد بعد الخصم:')}</span>
        <span class="cc-row-val" style="color:#059669">${myBalance - cost} ${goldUnit}</span>
      </div>`;
    detailsBox.innerHTML = `
      <div class="cc-row">
        <span class="cc-row-label"><i class="f7-icons">${callType === 'video' ? 'videocam_fill' : 'phone_fill'}</i> ${translateDynamicText('نوع المكالمة:')}</span>
        <span class="cc-row-val" style="color:#16a34a">${callType === 'video' ? 'فيديو (غير محدود)' : translateDynamicText('مفتوحة المدة (غير محدودة)')}</span>
      </div>
      <div class="cc-row">${feeRow}</div>
      <div class="cc-divider"></div>
      <div class="cc-row">
        <span class="cc-row-label"><i class="f7-icons">creditcard_fill</i> ${translateDynamicText('رصيدك الحالي:')}</span>
        <span class="cc-row-val" style="color:#0f172a">${myBalance} ${goldUnit}</span>
      </div>${balanceAfterRow}
    `;
  }
  if (noteEl) {
    if (isFreeCost) {
      noteEl.innerHTML = `هذه المكالمة مجانية بالكامل، ولن يتم خصم أي ذهب من رصيدك عند رد <b>${esc(PM_WITH.username)}</b> 📹`;
    } else if (callType === 'video') {
      noteEl.innerHTML = `سيتم خصم <b style="color:#f59e0b">${cost} ذهب</b> من رصيدك عند رد <b>${esc(PM_WITH.username)}</b> على مكالمة الفيديو 📹`;
    } else {
      const payMsg = APP_LANG === 'en' ? `Trial already used. <b style="color:#f59e0b">${cost} Gold</b> will be deducted when <b>${esc(PM_WITH.username)}</b> answers.` :
        (APP_LANG === 'es' ? `Prueba ya utilizada. Se descontarán <b style="color:#f59e0b">${cost} Oro</b> cuando <b>${esc(PM_WITH.username)}</b> responda.` :
        (APP_LANG === 'tr' ? `Deneme kullanıldı. <b>${esc(PM_WITH.username)}</b> yanıtladığında <b style="color:#f59e0b">${cost} Altın</b> düşülecektir.` :
        `تم استهلاك التجربة المجانية مسبقاً. سيتم خصم <b style="color:#f59e0b">${cost} ذهب</b> من رصيدك عند رد <b>${esc(PM_WITH.username)}</b> على المكالمة.`));
      noteEl.innerHTML = payMsg;
    }
  }
  if (goBtn) {
    goBtn.className = isFreeCost ? 'btn cc-go-btn free' : 'btn cc-go-btn paid';
    goBtn.innerHTML = isFreeCost
      ? '<i class="f7-icons">videocam_fill</i> بدء المكالمة المجانية'
      : `<i class="f7-icons">${callType === 'video' ? 'videocam_fill' : 'phone_fill'}</i> ${translateDynamicText('تأكيد وبدء الاتصال')} (${cost} 🪙)`;
    goBtn.onclick = () => {
      closeOv('callConfirmOv');
      executePrivateCall(callType);
    };
  }
  openOv('callConfirmOv');
}

async function executePrivateCall(callType = 'audio') {
  if (!PM_WITH) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return toast('متصفحك لا يدعم المكالمات الخاصة', false);
  }
  const isVideo = callType === 'video';
  // داخل لمسة المستخدم: تهيئة سياق الصوت مبكراً لمكالمات الفيديو (سياسات التشغيل التلقائي)
  if (isVideo) { try { ensureRemoteAudioCtx(); } catch (e) {} }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: isVideo ? {
        // جودة ثابتة 360p (640×360) للطرفين في مكالمة الفيديو الخاصة.
        width: { ideal: 640, max: 640 },
        height: { ideal: 360, max: 360 },
        frameRate: { ideal: 25, max: 30 },
        facingMode: 'user'
      } : false
    });
    PM_CALL = {
      peerId: +PM_WITH.id,
      peerName: PM_WITH.username,
      peerAvatar: PM_WITH.avatar || '',
      isCaller: true,
      callType: callType,
      pc: null,
      localStream: stream,
      remoteStream: null,
      timerInterval: null,
      callSeconds: 0,
      state: 'calling',
      micMuted: false,
      camOff: false,
      localEnlarged: false,
      controlsHidden: false,
      pipPos: null
    };
    if (isVideo) showVideoCallUI('calling');
    else showCallActiveModal();
    playCallRingback();
    SOCKET.emit('call:request', { toId: PM_WITH.id, type: callType });
  } catch (err) {
    toast(isVideo
      ? 'تعذر الوصول إلى الكاميرا/الميكروفون: ' + (err.message || 'يرجى منح الإذن')
      : 'تعذر الوصول إلى الميكروفون: ' + (err.message || 'يرجى منح الإذن'), false);
  }
}

function handleIncomingPrivateCall(from, type) {
  if (PM_CALL) {
    return SOCKET.emit('call:reject', { toId: from.id, reason: 'busy' });
  }
  const callType = (type === 'video') ? 'video' : 'audio';
  PM_CALL = {
    peerId: +from.id,
    peerName: from.username,
    peerAvatar: from.avatar || '',
    isCaller: false,
    callType: callType,
    pc: null,
    localStream: null,
    remoteStream: null,
    timerInterval: null,
      callSeconds: 0,
      state: 'incoming',
      micMuted: false,
      camOff: false,
      localEnlarged: false,
      controlsHidden: false,
      pipPos: null
    };
    showCallIncomingModal();
  playCallRingtone();
}

async function acceptPrivateCall() {
  if (!PM_CALL || PM_CALL.state !== 'incoming') return;
  stopCallAudioTones();
  const isVideo = PM_CALL.callType === 'video';
  // داخل لمسة المستخدم: تهيئة سياق الصوت مبكراً لمكالمات الفيديو (سياسات التشغيل التلقائي)
  if (isVideo) { try { ensureRemoteAudioCtx(); } catch (e) {} }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: isVideo ? {
        // جودة ثابتة 360p (640×360) للطرفين في مكالمة الفيديو الخاصة.
        width: { ideal: 640, max: 640 },
        height: { ideal: 360, max: 360 },
        frameRate: { ideal: 25, max: 30 },
        facingMode: 'user'
      } : false
    });
    PM_CALL.localStream = stream;
    PM_CALL.state = 'connected';
    closeCallIncomingModal();
    if (isVideo) showVideoCallUI('connecting');
    else showCallActiveModal();
    const status = $('#pmCallStatus');
    if (status) status.textContent = 'جاري التوصيل...';
    SOCKET.emit('call:accept', { toId: PM_CALL.peerId });
    await setupPrivateCallPeerConnection(false);
  } catch (err) {
    rejectPrivateCall('mic_error');
    toast(isVideo ? 'تعذر الوصول إلى الكاميرا/الميكروفون: ' + (err.message || 'يرجى منح الإذن') : 'تعذر الوصول إلى الميكروفون: ' + (err.message || 'يرجى منح الإذن'), false);
  }
}

async function handlePrivateCallAccepted(from, type) {
  if (!PM_CALL || PM_CALL.peerId !== +from.id) return;
  stopCallAudioTones();
  PM_CALL.state = 'connected';
  if (PM_CALL.isCaller && ME && PM_CALL.callType === 'audio') {
    ME.free_call_used = 1;
  }
  if (PM_CALL.callType === 'video') showVideoCallUI('connecting');
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
    const remoteStream = event.streams && event.streams[0];
    if (!remoteStream) return;
    if (PM_CALL && PM_CALL.callType === 'video') {
      // مكالمة فيديو: صوت الطرف الآخر عبر سلسلة التكبير (أعلى وأوضح)
      setupRemoteAudioChain(remoteStream);
    } else {
      // مكالمة صوتية: مباشرة على السبيكر كما كانت
      const remoteAudio = $('#pmRemoteAudio');
      if (remoteAudio) {
        remoteAudio.srcObject = remoteStream;
        remoteAudio.volume = PM_CALL && PM_CALL.speakerOn ? 1.0 : 0.65;
        remoteAudio.play().catch(() => {});
      }
    }
    // مكالمة فيديو: وصل تدفق الطرف الآخر — نربطه بمشغل الفيديو وشاشة سناب شات
    if (PM_CALL && PM_CALL.callType === 'video' && PM_CALL.remoteStream !== remoteStream) {
      PM_CALL.remoteStream = remoteStream;
      const rv = $('#pmVideoRemote');
      if (rv) { rv.srcObject = remoteStream; rv.play().catch(() => {}); }
      const noRemote = $('#pmVideoNoRemote');
      if (noRemote) noRemote.style.display = 'none';
    }
    if (PM_CALL && !CALL_RECORDER && PM_CALL.isCaller) {
      startCallRecording(PM_CALL.localStream, remoteStream, PM_CALL.callType || 'audio');
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
      if (PM_CALL.callType === 'video') startVideoQualityMonitor(); // جودة تكيفية حسب الإنترنت
    } else if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
      const status = $('#pmCallStatus');
      if (status && PM_CALL.state === 'connected') status.textContent = 'ضعف في الاتصال...';
    }
  };

  if (isOffer) {
    try {
      const wantVideo = PM_CALL.callType === 'video';
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: wantVideo });
      await pc.setLocalDescription(offer);
      SOCKET.emit('call:signal', { toId: PM_CALL.peerId, data: { sdp: offer } });
    } catch (e) {
      console.error('Create offer error:', e);
    }
  }
}

// =====================================================
//  مكالمة الفيديو الخاصة — شاشة كاملة بأسلوب سناب شات
//  (فيديو الطرف الآخر ملء الشاشة + نافذة كاميرتك المصغرة + أزرار تحكم)
// =====================================================
function showVideoCallUI(stage) {
  if (!PM_CALL || PM_CALL.callType !== 'video') return;
  const ov = $('#pmVideoCallOv');
  if (!ov) return;
  // إعادة ضبط حالة التكبير والأزرار والموضع مع كل مكالمة جديدة (وليس عند استعادة مكالمة قائمة)
  const isRestore = PM_CALL.state === 'connected' && !!PM_CALL.remoteStream;
  if (!isRestore) {
    PM_CALL.localEnlarged = false;
    PM_CALL.controlsHidden = false;
    PM_CALL.pipPos = null;
    ov.classList.remove('pmvc-ui-hidden');
    [$('#pmVideoLocal'), $('#pmVideoRemote')].forEach(v => {
      if (v) { v.style.left = ''; v.style.top = ''; v.style.insetInlineEnd = ''; }
    });
  }
  updateVideoCallLayout();
  const camOffPill = $('#pmRemoteCamOff');
  if (camOffPill) camOffPill.style.display = 'none';
  const localV = $('#pmVideoLocal');
  if (localV && PM_CALL.localStream) {
    localV.srcObject = PM_CALL.localStream;
    localV.play().catch(() => {});
  }
  const remoteV = $('#pmVideoRemote');
  if (remoteV) {
    if (PM_CALL.remoteStream) {
      remoteV.srcObject = PM_CALL.remoteStream;
      remoteV.play().catch(() => {});
    } else {
      try { remoteV.pause(); } catch (e) { }
    }
  }
  // قبل وصول الفيديو: بطاقة الانتظار (الصورة + الاسم) بنفس روح سناب شات
  const noRemote = $('#pmVideoNoRemote');
  if (noRemote) noRemote.style.display = PM_CALL.remoteStream ? 'none' : 'flex';
  const noRemoteAva = $('#pmVideoNoRemoteAva');
  if (noRemoteAva) noRemoteAva.innerHTML = avatarHtml(PM_CALL.peerAvatar);
  const noRemoteName = $('#pmVideoNoRemoteName');
  if (noRemoteName) noRemoteName.textContent = PM_CALL.peerName;
  const nameEl = $('#pmVideoCallName');
  if (nameEl) nameEl.textContent = PM_CALL.peerName;
  // مزامنة حالة الكتم/الكاميرا على الأزرار
  const vMuteIcon = $('#pmVideoMuteIcon');
  if (vMuteIcon) vMuteIcon.textContent = PM_CALL.micMuted ? 'mic_slash_fill' : 'mic_fill';
  const vCamIcon = $('#pmVideoCamIcon');
  if (vCamIcon) vCamIcon.textContent = PM_CALL.camOff ? 'videocam_slash_fill' : 'videocam_fill';
  updateVideoCallStageUI(stage);
  closeOv('pmCallActiveOv');
  closeCallIncomingModal();
  openOv('pmVideoCallOv');
  // حفظ موضع المصغر الافتراضي لتسجيل المكالمة (قراءة layout مرة واحدة)
  requestAnimationFrame(() => { try { captureVideoCallPipPos(); } catch (e) {} });
  updateFloatingCallBar();
}
function updateVideoCallStageUI(stage) {
  if (!PM_CALL) return;
  const status = $('#pmVideoCallStatus');
  const noRemoteStatus = $('#pmVideoNoRemoteStatus');
  const timer = $('#pmVideoCallTimer');
  const connected = PM_CALL.state === 'connected';
  const stageText = connected
    ? 'مكالمة فيديو جارية'
    : (PM_CALL.isCaller ? 'جاري الاتصال...' : 'جاري التوصيل...');
  if (status) status.textContent = stageText;
  if (noRemoteStatus) noRemoteStatus.textContent = stageText;
  if (timer) {
    if (connected) {
      const m = String(Math.floor((PM_CALL.callSeconds || 0) / 60)).padStart(2, '0');
      const s = String((PM_CALL.callSeconds || 0) % 60).padStart(2, '0');
      timer.textContent = `${m}:${s}`;
      timer.style.display = '';
    } else {
      timer.style.display = 'none';
    }
  }
}
function hideVideoCallUI() {
  const ov = $('#pmVideoCallOv');
  if (ov) ov.classList.remove('open');
  [$('#pmVideoLocal'), $('#pmVideoRemote')].forEach(v => {
    if (!v) return;
    try { v.pause(); } catch (e) { }
    v.srcObject = null;
  });
  updateFloatingCallBar();
}
function toggleVideoCallCam() {
  if (!PM_CALL || !PM_CALL.localStream) return;
  PM_CALL.camOff = !PM_CALL.camOff;
  PM_CALL.localStream.getVideoTracks().forEach(t => t.enabled = !PM_CALL.camOff);
  const icon = $('#pmVideoCamIcon');
  if (icon) icon.textContent = PM_CALL.camOff ? 'videocam_slash_fill' : 'videocam_fill';
  toast(PM_CALL.camOff ? 'تم إيقاف الكاميرا' : 'تم تشغيل الكاميرا');
  // إبلاغ الطرف الآخر بحالة الكاميرا (إشعار فوري لديه)
  if (SOCKET) SOCKET.emit('call:cam_state', { toId: PM_CALL.peerId, on: !PM_CALL.camOff });
}

// ===== رفع مستوى صوت الطرف الآخر (سماعة الأذن الداخلية + السبيكر الخارجي) =====
// الاستراتيجية: تشغيل التيار الأصلي مباشرة منذ اللحظة الأولى (مضمون لا يختفي الصوت)،
// ثم عند جاهزية AudioContext (تتطلب بعض المتصفحات لمسة مستخدم) ننتقل لسلسلة التكبير 1.6x
let REMOTE_AUDIO_CTX = null, REMOTE_AUDIO_SOURCE = null, REMOTE_AUDIO_GAIN = null, REMOTE_AUDIO_DEST = null;
let REMOTE_AUDIO_RAW = null, REMOTE_AUDIO_BOOSTED = false;
const REMOTE_AUDIO_BOOST = 1.6; // 1.6 ضعف الصوت الأصلي (مكالمات الفيديو)
// حجم التشغيل المباشر (مكالمات الصوت كما كانت): 0.65 سماعة داخلية / 1.0 سبيكر
function rawRemoteVolume() {
  const speakerOn = !!(PM_CALL && PM_CALL.speakerOn);
  if (PM_CALL && PM_CALL.callType === 'video') return speakerOn ? 1.0 : 0.9;
  return speakerOn ? 1.0 : 0.65;
}
function ensureRemoteAudioCtx() {
  try {
    const Ctor = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext))
      || (typeof AudioContext !== 'undefined' ? AudioContext
        : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null));
    if (!Ctor) return null;
    if (!REMOTE_AUDIO_CTX) {
      REMOTE_AUDIO_CTX = new Ctor();
      REMOTE_AUDIO_DEST = REMOTE_AUDIO_CTX.createMediaStreamDestination();
    }
    if (REMOTE_AUDIO_CTX.state === 'suspended') {
      try { REMOTE_AUDIO_CTX.resume().catch(() => {}); } catch (e) {}
    }
    return REMOTE_AUDIO_CTX;
  } catch (e) { return null; }
}
// الانتقال لسلسلة التكبير عندما يكون السياق جاهزاً (running)
function tryUpgradeRemoteAudioBoost() {
  if (!PM_CALL || !REMOTE_AUDIO_RAW || REMOTE_AUDIO_BOOSTED) return;
  const ctx = ensureRemoteAudioCtx();
  if (!ctx || ctx.state !== 'running') return;
  const el = $('#pmRemoteAudio');
  if (!el) return;
  try {
    try { if (REMOTE_AUDIO_SOURCE) REMOTE_AUDIO_SOURCE.disconnect(); } catch (e) {}
    try { if (REMOTE_AUDIO_GAIN) REMOTE_AUDIO_GAIN.disconnect(); } catch (e) {}
    REMOTE_AUDIO_SOURCE = ctx.createMediaStreamSource(REMOTE_AUDIO_RAW);
    REMOTE_AUDIO_GAIN = ctx.createGain();
    REMOTE_AUDIO_GAIN.gain.value = REMOTE_AUDIO_BOOST;
    REMOTE_AUDIO_SOURCE.connect(REMOTE_AUDIO_GAIN);
    REMOTE_AUDIO_GAIN.connect(REMOTE_AUDIO_DEST);
    el.srcObject = REMOTE_AUDIO_DEST.stream;
    el.volume = 1.0;
    REMOTE_AUDIO_BOOSTED = true;
    try { el.play().catch(() => {}); } catch (e) {}
  } catch (e) {
    REMOTE_AUDIO_BOOSTED = false;
  }
}
function setupRemoteAudioChain(stream) {
  const el = $('#pmRemoteAudio');
  if (!el || !stream) return;
  REMOTE_AUDIO_RAW = stream;
  REMOTE_AUDIO_BOOSTED = false;
  tryUpgradeRemoteAudioBoost();
  if (!REMOTE_AUDIO_BOOSTED) {
    // صوت مباشر (بدون تكبير) حتى تصبح سلسلة التكبير جاهزة — مضمون سماع
    try { if (REMOTE_AUDIO_SOURCE) REMOTE_AUDIO_SOURCE.disconnect(); REMOTE_AUDIO_SOURCE = null; } catch (e) {}
    el.srcObject = stream;
    el.volume = rawRemoteVolume();
    try { el.play().catch(() => {}); } catch (e) {}
  }
}
function setRemoteAudioLevel() {
  const el = $('#pmRemoteAudio');
  if (!el) return;
  if (REMOTE_AUDIO_BOOSTED) {
    // مع التكبير: حجم العنصر كامل والتكبير يتم في السلسلة
    el.volume = 1.0;
    if (REMOTE_AUDIO_CTX && REMOTE_AUDIO_CTX.state === 'suspended') REMOTE_AUDIO_CTX.resume().catch(() => {});
  } else {
    el.volume = rawRemoteVolume();
  }
  tryUpgradeRemoteAudioBoost();
}
function teardownRemoteAudioChain() {
  try { if (REMOTE_AUDIO_SOURCE) { REMOTE_AUDIO_SOURCE.disconnect(); REMOTE_AUDIO_SOURCE = null; } } catch (e) {}
  try { if (REMOTE_AUDIO_GAIN) { REMOTE_AUDIO_GAIN.disconnect(); REMOTE_AUDIO_GAIN = null; } } catch (e) {}
  if (REMOTE_AUDIO_CTX) { try { REMOTE_AUDIO_CTX.close(); } catch (e) {} REMOTE_AUDIO_CTX = null; REMOTE_AUDIO_DEST = null; }
  REMOTE_AUDIO_RAW = null;
  REMOTE_AUDIO_BOOSTED = false;
}
// أي نقرة أثناء المكالمة (كتم/سبيكر/شاشة الفيديو...) تتيح للمتصفح تشغيل سياق الصوت
// عند ذلك ننتقل تلقائياً لسلسلة التكبير — يغطي سياسات التشغيل التلقائي في iOS/Android
document.addEventListener('pointerdown', () => {
  try { tryUpgradeRemoteAudioBoost(); } catch (e) {}
  try { bcastLevelCtx(); } catch (e) {} // استيقاظ سياق تحليل الأصوات (سياسات التشغيل التلقائي)
}, { capture: true, passive: true });

// ===== جودة الفيديو الثابتة 360p — للمكالمات الخاصة فقط =====
// بناءً على طلب الإدارة: تُثبَّت جودة فيديو المكالمة الخاصة على 360p (640×360)
// للطرفين بشكل ثابت، دون أي تكيف صاعد أو هابط مع حالة الشبكة.
const VIDEO_FIXED_QUALITY = { w: 640, h: 360, fps: 25, maxBitrate: 700000, label: '360p' };
let VIDEO_QA_TIMER = null;

function setVideoQualityBadge() {
  const el = $('#pmVideoQuality');
  if (!el) return;
  el.textContent = 'الجودة: 360p (ثابتة)';
  el.style.display = '';
}

function applyFixedVideoQuality() {
  if (!PM_CALL) return;
  // 1) تثبيت التقاط الكاميرا المحلية على 640×360 (الحد الأقصى يساوي الحد المطلوب).
  if (PM_CALL.localStream) {
    PM_CALL.localStream.getVideoTracks().forEach(track => {
      try {
        if (typeof track.applyConstraints === 'function') {
          track.applyConstraints({
            width: { ideal: VIDEO_FIXED_QUALITY.w, max: VIDEO_FIXED_QUALITY.w },
            height: { ideal: VIDEO_FIXED_QUALITY.h, max: VIDEO_FIXED_QUALITY.h },
            frameRate: { ideal: VIDEO_FIXED_QUALITY.fps, max: 30 }
          }).catch(() => {});
        }
      } catch (e) {}
    });
  }
  // 2) تثبيت سقف الإرسال (البت ريت) ومعدل الإطارات على قيم 360p، مع الحفاظ على
  //    الدقة أولاً (maintain-resolution) حتى لا يُخفّض المتصفح الدقة تحت الضغط.
  try {
    const sender = PM_CALL.pc && PM_CALL.pc.getSenders
      ? PM_CALL.pc.getSenders().find(s => s.track && s.track.kind === 'video')
      : null;
    if (sender && sender.getParameters && sender.setParameters) {
      const params = sender.getParameters();
      params.encodings = params.encodings && params.encodings.length ? params.encodings : [{}];
      params.encodings[0].maxBitrate = VIDEO_FIXED_QUALITY.maxBitrate;
      params.encodings[0].maxFramerate = VIDEO_FIXED_QUALITY.fps;
      params.degradationPreference = 'maintain-resolution';
      sender.setParameters(params).catch(() => {});
    }
  } catch (e) {}
  setVideoQualityBadge();
}

function startVideoQualityMonitor() {
  if (!PM_CALL || PM_CALL.callType !== 'video' || !PM_CALL.pc) return;
  stopVideoQualityMonitor();
  applyFixedVideoQuality();
  setVideoQualityBadge();
  // إعادة تطبيق دورية خفيفة تُبقي القيود مسلّطة على المتصفح (بعض المتصفحات قد
  // تحاول تخفيف الجودة تلقائياً عند ازدحام الشبكة) — دون تغيير المستوى أبداً.
  VIDEO_QA_TIMER = setInterval(applyFixedVideoQuality, 3000);
}
function stopVideoQualityMonitor() {
  if (VIDEO_QA_TIMER) { clearInterval(VIDEO_QA_TIMER); VIDEO_QA_TIMER = null; }
  const el = $('#pmVideoQuality');
  if (el) { el.style.display = 'none'; el.textContent = 'الجودة: -'; }
}

// ===== تفاعل شاشة مكالمة الفيديو =====
// النقر على الصورة الكبيرة  → إخفاء/إظهار الأزرار (تبقى الصورتان فقط)
// النقر على الصورة المصغرة   → تبديل (تصبح الصورة المصغرة هي الكبيرة والعكس)
// سحب الصورة المصغرة         → تحريكها لأي مكان ترضاه
function updateVideoCallLayout() {
  const remote = $('#pmVideoRemote'), local = $('#pmVideoLocal');
  if (!remote || !local || !PM_CALL) return;
  const localBig = !!PM_CALL.localEnlarged;
  remote.classList.toggle('pmvc-video-main', !localBig);
  remote.classList.toggle('pmvc-video-pip', localBig);
  local.classList.toggle('pmvc-video-main', localBig);
  local.classList.toggle('pmvc-video-pip', !localBig);
  const pipEl = localBig ? remote : local;
  const mainEl = localBig ? local : remote;
  // العنصر المكبّر يملأ الشاشة دائماً (إزالة أي مواضع مخصصة تبقى من سحبه سابقاً)
  mainEl.style.left = '';
  mainEl.style.top = '';
  mainEl.style.insetInlineEnd = '';
  // المصغر يحتفظ بموضعه المخصص حتى لا يقفز مكانه عند التبديل
  if (PM_CALL.pipPos) {
    const st = remote.parentElement;
    const sw = st.clientWidth || st.offsetWidth, sh = st.clientHeight || st.offsetHeight;
    pipEl.style.insetInlineEnd = 'auto';
    pipEl.style.left = (PM_CALL.pipPos.fx * sw) + 'px';
    pipEl.style.top = (PM_CALL.pipPos.fy * sh) + 'px';
  } else {
    pipEl.style.left = '';
    pipEl.style.top = '';
    pipEl.style.insetInlineEnd = '';
  }
  // تلميح النص على المصغر
  local.title = localBig ? 'انقر لتصغير صورك • اسحبه للتحريك' : 'انقر لتكبير صورك • اسحبه للتحريك';
  remote.title = localBig ? 'انقر لتكبير صوره • اسحبه للتحريك' : 'انقر لتصغير صوره';
}
function toggleLocalEnlarged() {
  if (!PM_CALL || PM_CALL.callType !== 'video') return;
  PM_CALL.localEnlarged = !PM_CALL.localEnlarged;
  updateVideoCallLayout();
  captureVideoCallPipPos();
}
// النقر على الصورة الكبيرة: إخفاء الأزرار (أو إظهارها مرة أخرى)
function toggleVideoCallControls() {
  if (!PM_CALL || PM_CALL.callType !== 'video') return;
  PM_CALL.controlsHidden = !PM_CALL.controlsHidden;
  const ov = $('#pmVideoCallOv');
  if (ov) ov.classList.toggle('pmvc-ui-hidden', !!PM_CALL.controlsHidden);
}
// حفظ الموضع النسبي للمصغر (نسبة من مساحة الشاشة) — يظهر به في التسجيل المحفوظ
function captureVideoCallPipPos() {
  if (!PM_CALL) return;
  const ov = $('#pmVideoCallOv');
  if (!ov || !ov.classList.contains('open')) return;
  const stage = ov.querySelector('.pmvc-stage');
  const pip = ov.querySelector('.pmvc-video-pip');
  if (!stage || !pip) return;
  const sr = stage.getBoundingClientRect(), er = pip.getBoundingClientRect();
  if (!(sr.width > 10) || !(er.width > 10)) return;
  PM_CALL.pipPos = {
    fx: Math.max(0, Math.min(1, (er.left - sr.left) / sr.width)),
    fy: Math.max(0, Math.min(1, (er.top - sr.top) / sr.height)),
    fw: Math.max(0.05, Math.min(1, er.width / sr.width)),
    fh: Math.max(0.05, Math.min(1, er.height / sr.height))
  };
}
// التمييز بين النقر (تبديل/إخفاء الأزرار) والسحب (تحريك المصغر)
function initVideoCallTapDrag(el) {
  let dragging = false, moved = false, sx = 0, sy = 0, bLeft = 0, bTop = 0;
  el.addEventListener('pointerdown', e => {
    if (!PM_CALL || PM_CALL.callType !== 'video') return;
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true; moved = false;
    sx = e.clientX; sy = e.clientY;
    bLeft = el.offsetLeft; bTop = el.offsetTop;
    if (el.classList.contains('pmvc-video-pip')) { try { el.setPointerCapture(e.pointerId); } catch (err) {} }
  });
  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    if (!el.classList.contains('pmvc-video-pip')) return; // الصورة الكبيرة ثابتة
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && Math.hypot(dx, dy) < 8) return;
    moved = true;
    e.preventDefault();
    const st = el.parentElement;
    const sw = st.clientWidth, sh = st.clientHeight;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.max(0, Math.min(bLeft + dx, Math.max(0, sw - w)));
    const top = Math.max(0, Math.min(bTop + dy, Math.max(0, sh - h)));
    el.classList.add('pmvc-pip-dragging');
    el.style.insetInlineEnd = 'auto';
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    captureVideoCallPipPos();
  });
  const finish = () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('pmvc-pip-dragging');
    if (!moved) {
      if (el.classList.contains('pmvc-video-pip')) toggleLocalEnlarged();
      else toggleVideoCallControls();
      return;
    }
    captureVideoCallPipPos();
  };
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', () => { dragging = false; el.classList.remove('pmvc-pip-dragging'); });
}
initVideoCallTapDrag($('#pmVideoLocal'));
initVideoCallTapDrag($('#pmVideoRemote'));
$('#pmVideoCamBtn').onclick = toggleVideoCallCam;
$('#pmVideoMuteBtn').onclick = togglePrivateCallMute;
$('#pmVideoEndBtn').onclick = () => endPrivateCall(true, 'ended');
$('#pmVideoMinBtn').onclick = minimizePrivateCall;

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
  try { stopVideoQualityMonitor(); } catch (e) {}
  if (!PM_CALL) return;
  const peerId = PM_CALL.peerId;
  const state = PM_CALL.state;
  const recordedCallInfo = {
    callerId: PM_CALL.isCaller ? (ME && ME.id) : peerId,
    callerName: PM_CALL.isCaller ? (ME && ME.username) : PM_CALL.peerName,
    calleeId: PM_CALL.isCaller ? peerId : (ME && ME.id),
    calleeName: PM_CALL.isCaller ? PM_CALL.peerName : (ME && ME.username),
    duration: PM_CALL.callSeconds || 0,
    callType: PM_CALL.callType || 'audio'
  };

  if (CALL_RECORDER) {
    try {
      const { recorder, audioCtx, mimeType, drawLoopId, hiddenVideos } = CALL_RECORDER;
      CALL_RECORDER = null;
      // إيقاف تركيب الفيديو ومصادر التدقيق المخفية
      if (drawLoopId) cancelAnimationFrame(drawLoopId);
      (hiddenVideos || []).forEach(v => { try { v.pause(); v.srcObject = null; v.remove(); } catch (e) { } });
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
  try { teardownRemoteAudioChain(); } catch (e) {}
  const remoteAudio = $('#pmRemoteAudio');
  if (remoteAudio) remoteAudio.srcObject = null;
  stopProximitySensorForCall();
  closeCallIncomingModal();
  closeCallActiveModal();
  try { hideVideoCallUI(); } catch (e) { }
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
  // مزامنة أيقونة الكتم في شاشة مكالمة الفيديو
  const videoMuteIcon = $('#pmVideoMuteIcon');
  if (videoMuteIcon) videoMuteIcon.textContent = PM_CALL.micMuted ? 'mic_slash_fill' : 'mic_fill';
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
    if (remoteAudio && typeof remoteAudio.setSinkId === 'function') {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const speaker = devices.find(d => d.kind === 'audiooutput' && (d.label.toLowerCase().includes('speaker') || d.label.includes('مكبر')));
        if (speaker) await remoteAudio.setSinkId(speaker.deviceId);
      } catch (e) {}
    }
    setRemoteAudioLevel();
    toast('🔊 تم تشغيل مكبر الصوت (السبيكر)');
  } else {
    // وضع سماعة الأذن الداخلية (Earpiece)
    if (speakerBtn) {
      speakerBtn.classList.remove('is-speaker-on');
      speakerBtn.classList.add('is-earpiece');
    }
    if (speakerIcon) speakerIcon.textContent = 'phone_fill';
    if (speakerLabel) speakerLabel.textContent = 'سماعة الأذن';
    if (remoteAudio && typeof remoteAudio.setSinkId === 'function') {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const earpiece = devices.find(d => d.kind === 'audiooutput' && (d.label.toLowerCase().includes('earpiece') || d.label.toLowerCase().includes('receiver') || d.label.includes('أذن')));
        if (earpiece) await remoteAudio.setSinkId(earpiece.deviceId);
        else await remoteAudio.setSinkId('default');
      } catch (e) {}
    }
    setRemoteAudioLevel();
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
    // مزامنة المؤقت في شاشة مكالمة الفيديو
    const vt = $('#pmVideoCallTimer');
    if (vt) vt.textContent = timeStr;
  };

  updateTick();
  PM_CALL.timerInterval = setInterval(updateTick, 1000);
  if (PM_CALL.callType === 'video') updateVideoCallStageUI('connected');
  updateFloatingCallBar();
}

function minimizePrivateCall() {
  closeOv('pmCallActiveOv');
  if (PM_CALL && PM_CALL.callType === 'video') {
    // مكالمة فيديو: نُخفي الشاشة الكاملة ويظهر الشريط العائم
    const ov = $('#pmVideoCallOv');
    if (ov) ov.classList.remove('open');
    [$('#pmVideoLocal'), $('#pmVideoRemote')].forEach(v => { if (v) { try { v.pause(); } catch (e) { } } });
  }
  updateFloatingCallBar();
}

function restorePrivateCall() {
  if (!PM_CALL) {
    updateFloatingCallBar();
    return;
  }
  if (PM_CALL.callType === 'video') showVideoCallUI(PM_CALL.state === 'connected' ? 'connected' : 'connecting');
  else showCallActiveModal();
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
  if (activeOvOpen || incomingOvOpen || (PM_CALL.callType === 'video' && $('#pmVideoCallOv') && $('#pmVideoCallOv').classList.contains('open'))) {
    bar.style.display = 'none';
  } else {
    bar.style.display = 'flex';
    $('#pmCallFloatingName').textContent = PM_CALL.peerName;
    $('#pmCallFloatingAvatar').innerHTML = avatarHtml(PM_CALL.peerAvatar);
    const fIcon = $('#pmCallFloatingIcon');
    if (fIcon) fIcon.textContent = PM_CALL.callType === 'video' ? 'videocam_fill' : 'phone_fill';
    const m = String(Math.floor(PM_CALL.callSeconds / 60)).padStart(2, '0');
    const s = String(PM_CALL.callSeconds % 60).padStart(2, '0');
    $('#pmCallFloatingTimer').textContent = PM_CALL.state === 'connected' ? `${m}:${s}` : (PM_CALL.isCaller ? 'جاري الاتصال...' : 'جاري التوصيل...');
  }
}

function showCallIncomingModal() {
  if (!PM_CALL) return;
  $('#pmCallIncName').textContent = PM_CALL.peerName;
  $('#pmCallIncAvatar').innerHTML = avatarHtml(PM_CALL.peerAvatar);
  const incLabel = $('#pmCallIncStatus');
  if (incLabel) {
    const isVideo = PM_CALL.callType === 'video';
    incLabel.innerHTML = `<i class="f7-icons">${isVideo ? 'videocam_fill' : 'phone_fill'}</i> ${isVideo ? 'مكالمة فيديو خاصة واردة...' : 'مكالمة صوتية خاصة واردة...'}`;
  }
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
$('#pmVideoCall').onclick = () => startVideoCall();
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
  syncBadgeMirror('#dskPrivBadge', PRIV_UNREAD);
  updateUnreadTitle();
}
// انعكاس الشارة على أزرار هيدر الكمبيوتر (شريط التنقل السفلي مخفي على الشاشات الكبيرة)
function syncBadgeMirror(sel, count) {
  const m = document.querySelector(sel);
  if (!m) return;
  if (count > 0) { m.style.display = 'flex'; m.textContent = count > 99 ? '99+' : count; }
  else m.style.display = 'none';
}
// عدّاد غير المقروء في عنوان التبويب — يظهر حتى والصفحة بتاب خلفي
function updateUnreadTitle() {
  try {
    const total = Math.max(0, +PRIV_UNREAD || 0) + Math.max(0, +NOTIF_UNREAD || 0) + Math.max(0, +STATUS_UNREAD || 0);
    const base = String(document.title || '').replace(/^\(\d+\)\s*/, '');
    document.title = total > 0 ? `(${total}) ${base}` : base;
  } catch (e) { }
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
  // لا نعرض حالة انتهت حتى لو بقيت لقطة قديمة في الواجهة قبل التحديث.
  STATUSES.filter(isActiveStatus).forEach(s => {
    const uid = +s.user_id;
    if (!groups.has(uid)) groups.set(uid, []);
    groups.get(uid).push(s);
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
    // القائمة الكاملة مرجع موثوق لأصحاب الحالات — نعيد بناء خريطة الدوائر منها.
    syncStatusOwnersFromStatuses();
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
  const cashoutHost = $('#myGiftsCashout');
  if (cashoutHost) cashoutHost.innerHTML = '';
  openOv('myGiftsOv');
  // نظام تسكير الهدايا — يظهر للفتيات المسجلات فقط
  if (ME.gender === 'girl') renderGiftCashoutCard();
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

// =====================================================
//  نظام تسكير الهدايا (للتيات) — تحويل الهدايا المحددة إلى دولارات
// =====================================================
let CASHOUT_STEP = 1;               // 1 = اختيار الهدايا، 2 = بيانات الحساب
// (CASHOUT_GROUPS و CASHOUT_QTY تُعلن أدناه مع دوال الاختيار)
function resetCashoutSelection() { CASHOUT_QTY = {}; CASHOUT_STEP = 1; }
// معدل التحويل: usd_amount يقابل gold_min — المبلغ يتناسب طردياً مع الذهب المحدد (200 ذهب بمعدل 5$/100 = 10$)
let CASHOUT_GOLD_MIN = 0, CASHOUT_USD = 0, CASHOUT_RATE_PER_GOLD = 0;
function cashoutUsdFor(gold) {
  // المعدّل يحدّده الإداري حرًا (مبلغ التسكير المقابل للحد الأدنى): USD/GOLD_MIN.
  if (CASHOUT_RATE_PER_GOLD > 0) return Math.round((+gold || 0) * CASHOUT_RATE_PER_GOLD * 100) / 100;
  if (!CASHOUT_GOLD_MIN || !CASHOUT_USD) return 0;
  return Math.round((gold * CASHOUT_USD / CASHOUT_GOLD_MIN) * 100) / 100;
}
async function renderGiftCashoutCard() {
  const host = $('#myGiftsCashout');
  if (!host || !ME || ME.gender !== 'girl') return;
  host.innerHTML = '<div class="gc-loading"><i class="f7-icons">arrow2_circlepath</i> جاري تحميل معلومات التسكير...</div>';
  let info;
  try {
    info = await api('/api/gift-cashout');
  } catch (e) {
    host.innerHTML = '';
    return;
  }
  if (!info || !info.enabled) { host.innerHTML = ''; return; }

  const fmt = n => (Math.round((+n || 0) * 100) / 100).toFixed(2);
  const goldTotal = +info.gold_total || 0;
  const goldMin = +info.gold_min || 0;
  // معدّل الذهب يحدّده الإداري: مبلغ التسكير المقابل للحد الأدنى (USD/GOLD_MIN).
  const usd = fmt(info.usd_for_gold_min || info.usd_amount);
  CASHOUT_GOLD_MIN = goldMin;
  CASHOUT_USD = +info.usd_amount || 0;
  CASHOUT_RATE_PER_GOLD = +(info.rate_per_gold || 0);
  const pct = goldMin > 0 ? Math.min(100, Math.round(goldTotal / goldMin * 100)) : 0;

  if (info.has_pending) {
    const p = info.pending || {};
    const isPaypalPending = p.payout_method === 'paypal';
    const methodLabel = isPaypalPending ? 'حساب PayPal' : 'حساب بنكي';
    const dest = isPaypalPending && p.paypal_email ? esc(p.paypal_email) : (p.account_number || '');
    const headSub = (p.payout_status === 'failed')
      ? 'تعذر التحويل الآلي'
      : (isPaypalPending ? 'جارٍ التحويل تلقائيًا إلى حسابك 💸' : 'قيد المراجعة من الإدارة');
    let statusLine = '';
    if (p.payout_batch_id && p.payout_status !== 'failed') {
      const stTxt = p.payout_status === 'success' ? 'تم التحويل بنجاح' : 'تم إرسال الدفعة (قد تكون قيد المعالجة)';
      statusLine = `<div class="gc-row"><span>حالة التحويل</span><b class="gc-ok">${stTxt} (رقم الدفعة ${esc(p.payout_batch_id || '')})</b></div>`;
    } else if (p.payout_status === 'failed') {
      statusLine = `<div class="gc-row"><span>حالة التحويل</span><b class="gc-err">تعذر الإرسال الآلي — لم تُحذف هداياك</b></div>`;
    }
    host.innerHTML = `
      <div class="gc-card gc-card-pending">
        <div class="gc-head"><span class="gc-ico"><i class="f7-icons">bank_fill</i></span><div><b>تسكير الهدايا</b><span>${headSub}</span></div></div>
        <div class="gc-rows">
          <div class="gc-row"><span>هدايا محددة للتسكير</span><b>${p.gifts_count || 0}</b></div>
          <div class="gc-row"><span>ذهب الهدايا المحددة</span><b>${p.gold_total || 0} 🪙</b></div>
          <div class="gc-row gc-row-net"><span>المبلغ الذي سيُحوَّل إلى حسابك</span><b>$${fmt(p.usd_amount || 0)}</b></div>
          <div class="gc-row"><span>طريقة الاستلام</span><b>${methodLabel} — ${dest || '—'}</b></div>
          ${statusLine}
        </div>
        <div class="gc-note"><i class="f7-icons">${isPaypalPending ? 'money_dollar_circle_fill' : 'clock_fill'}</i> ${isPaypalPending
          ? 'يُرسل المبلغ تلقائيًا من حساب الإدارة إلى حساب PayPal الخاص بك، وعند اكتماله تُحذف <b>الهدايا المحددة فقط</b> من حسابك (بقية هداياك تبقى).'
          : 'بعد اتمام العملية من الإدارة: يُحوَّل المبلغ من حساب الإدارة إلى حسابك ثم تُحذف <b>الهدايا المحددة فقط</b> من حسابك (بقية هداياك تبقى).'}</div>
      </div>`;
    return;
  }

  const eligible = !!info.eligible;
  const reason = info.gifts_count === 0
    ? 'لم تستلمي هدايا بعد — استقبلي الهدايا أولاً'
    : (goldTotal < goldMin ? `مجموع ذهب هداياك ${goldTotal} 🪙 والمتطلبات للتسكير ${goldMin} 🪙 — ينقصك ${info.remaining_gold} 🪙` : '');

  host.innerHTML = `
    <div class="gc-card${eligible ? '' : ' gc-card-locked'}">
      <div class="gc-head"><span class="gc-ico"><i class="f7-icons">bank_fill</i></span><div><b>تسكير الهدايا إلى دولارات 💵</b><span>معدل التحويل: <b>$${usd} لكل ${goldMin} ذهب</b> — المبلغ يتناسب طردياً مع الكمية (يحدّده الإداري)</span></div></div>
      <div class="gc-rows">
        <div class="gc-row"><span>عدد الهدايا المستلمة</span><b>${info.gifts_count}</b></div>
        <div class="gc-row"><span>مجموع ذهب هداياك</span><b>${goldTotal} 🪙</b></div>
        <div class="gc-row"><span>الحد الأدنى للتسكير</span><b>${goldMin} 🪙 (= $${usd})</b></div>
      </div>
      <div class="gc-progress"><span class="gc-progress-fill" style="width:${pct}%"></span></div>
      ${!eligible
        ? `<div class="gc-note gc-note-warn"><i class="f7-icons">lock_circle_fill</i> ${esc(reason)}</div>`
        : `<div id="gcEligibleZone"></div>`}
    </div>`;

  if (eligible) {
    CASHOUT_GROUPS = info.gift_groups || [];
    CASHOUT_PAYPAL_ENABLED = !!info.paypal_enabled;
    // إن كان PayPal غير مفعّل، نبدأ بحساب بنكي افتراضيًا.
    if (!CASHOUT_PAYPAL_ENABLED) CASHOUT_METHOD = 'bank';
    if (CASHOUT_STEP === 1) renderCashoutStep1(goldMin, usd);
    else renderCashoutStep2(goldMin, usd);
  }
}

// الخطوة 1: اختيار كمية الهدايا المراد تسكيها (يُخصم فقط المحدد وتبقى البقية)
let CASHOUT_GROUPS = [];         // الهدايا المجمعة بالنوع مع سطورها
let CASHOUT_QTY = {};            // groupKey -> الكمية المحددة
function buildCashoutSelection() {
  // تحويل كمية كل مجموعة إلى استهلاك لكل سطر (من الأقدم للأحدث)
  const selection = [];
  for (const g of CASHOUT_GROUPS) {
    let remaining = Math.min(Math.max(0, Math.floor(CASHOUT_QTY[g.key] || 0)), g.qty);
    for (const row of g.rows) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, row.qty);
      if (take > 0) selection.push({ row_id: row.id, qty: take });
      remaining -= take;
    }
  }
  return selection;
}
function cashoutSelectedTotals() {
  let gold = 0, count = 0;
  for (const g of CASHOUT_GROUPS) {
    const qty = Math.min(Math.max(0, Math.floor(CASHOUT_QTY[g.key] || 0)), g.qty);
    gold += qty * g.price;
    count += qty;
  }
  return { gold, count };
}
function renderCashoutStep1(goldMin, usd) {
  const zone = $('#gcEligibleZone');
  if (!zone) return;
  const { gold: selectedGold, count: selectedCount } = cashoutSelectedTotals();
  const ok = selectedGold >= goldMin;
  zone.innerHTML = `
    <div class="gc-step-title"><i class="f7-icons">gift_fill</i> حددي كمية الهدايا التي تريدين تسكيرها</div>
    <div class="gc-pick-list">
      ${CASHOUT_GROUPS.map(g => {
        const sel = Math.min(Math.max(0, Math.floor(CASHOUT_QTY[g.key] || 0)), g.qty);
        const media = String(g.img || '').startsWith('/') ? `<img src="${esc(g.img)}" alt="">` : (g.img ? esc(g.img) : '🎁');
        return `
        <div class="gc-pick-item${sel > 0 ? ' sel' : ''}" data-gkey="${esc(g.key)}">
          <span class="gc-pick-media">${media}</span>
          <span class="gc-pick-info">
            <b>${esc(g.name)}</b>
            <small>المتاح: ${g.qty} × ${g.price} 🪙 = ${g.gold} 🪙</small>
          </span>
          <span class="gc-pick-stepper">
            <button type="button" class="gc-st" data-act="minus" ${sel <= 0 ? 'disabled' : ''}>−</button>
            <b class="gc-st-val">${sel}</b>
            <button type="button" class="gc-st" data-act="plus" ${sel >= g.qty ? 'disabled' : ''}>+</button>
          </span>
          <span class="gc-pick-gold">${sel * g.price} 🪙</span>
        </div>`;
      }).join('')}
    </div>
    <div class="gc-pick-summary">
      <span>المحددة: <b>${selectedGold} 🪙</b> (${selectedCount} هدية) / الحد الأدنى ${goldMin} 🪙</span>
      ${ok ? '' : `<span class="gc-pick-lack">ينقصك ${goldMin - selectedGold} 🪙</span>`}
    </div>
    <button class="gc-btn" id="gcNextStepBtn" type="button" ${ok ? '' : 'disabled'}>
      <i class="f7-icons">bank_fill</i> المتابعة لبيانات الحساب (${selectedGold} 🪙 ← $${cashoutUsdFor(selectedGold).toFixed(2)})
    </button>`;
  $$('#gcEligibleZone .gc-pick-item').forEach(item => {
    const gkey = item.dataset.gkey;
    const g = CASHOUT_GROUPS.find(x => x.key === gkey);
    if (!g) return;
    item.querySelectorAll('.gc-st').forEach(btn => {
      btn.onclick = () => {
        const cur = Math.min(Math.max(0, Math.floor(CASHOUT_QTY[gkey] || 0)), g.qty);
        const next = btn.dataset.act === 'plus' ? Math.min(g.qty, cur + 1) : Math.max(0, cur - 1);
        CASHOUT_QTY[gkey] = next;
        renderCashoutStep1(goldMin, usd);
      };
    });
  });
  const next = $('#gcNextStepBtn');
  if (next) next.onclick = () => { CASHOUT_STEP = 2; renderCashoutStep2(goldMin, usd); };
}

// الخطوة 2: بيانات حساب الاستلام (PayPal أو بنك) + تأكيد
let CASHOUT_METHOD = 'paypal';
let CASHOUT_PAYPAL_ENABLED = true;
function renderCashoutStep2(goldMin, usd) {
  const zone = $('#gcEligibleZone');
  if (!zone) return;
  const { gold: selectedGold, count: selectedCount } = cashoutSelectedTotals();
  const summaryParts = CASHOUT_GROUPS
    .map(g => ({ g, qty: Math.min(Math.max(0, Math.floor(CASHOUT_QTY[g.key] || 0)), g.qty) }))
    .filter(x => x.qty > 0)
    .map(x => `${x.g.name} ×${x.qty}`)
    .join('، ').slice(0, 160);
  const isPaypal = CASHOUT_METHOD === 'paypal';
  zone.innerHTML = `
    <div class="gc-step-title"><i class="f7-icons">bank_fill</i> بيانات حساب الاستلام</div>
    <div class="gc-summary-chips">
      <span class="chip" style="background:#f8f9fd;border:1px solid #e8ebf5;color:#4b5563">🎁 ${selectedCount} هدية محددة</span>
      <span class="chip" style="background:#fffbeb;border:1px solid #fde68a;color:#92400e">🪙 ${selectedGold} ذهب</span>
      <span class="chip" style="background:#f0fdf4;border:1px solid #bbf7d0;color:#166534">💵 سيُحوَّل $${cashoutUsdFor(selectedGold).toFixed(2)}</span>
    </div>
    <div class="gc-note" style="margin-bottom:10px"><i class="f7-icons">info_circle_fill</i> ${isPaypal ? 'سيُرسل المبلغ تلقائيًا من حساب الإدارة إلى حساب الباي بال الخاص بك،' : 'عند قيام الإدارة بالتحويل،'} يُخصم <b>المحدد فقط</b> (${summaryParts || '—'}) من حسابك وتبقى بقية الهدايا المتكررة كما هي.</div>
    <div class="gc-methods">
      <label class="gc-method${isPaypal ? ' sel' : ''}${CASHOUT_PAYPAL_ENABLED ? '' : ' disabled'}" data-method="paypal"><input type="radio" name="gcMethod" value="paypal" ${isPaypal ? 'checked' : ''} ${CASHOUT_PAYPAL_ENABLED ? '' : 'disabled'}> <i class="f7-icons">paypal</i> <span>حساب باي بال (تحويل تلقائي من حساب الإدارة)${CASHOUT_PAYPAL_ENABLED ? '' : ' — غير متاح حاليًا'}</span></label>
      <label class="gc-method${!isPaypal ? ' sel' : ''}" data-method="bank"><input type="radio" name="gcMethod" value="bank" ${!isPaypal ? 'checked' : ''}> <i class="f7-icons">bank_fill</i> <span>حساب بنكي (تحويل يدوي من الإدارة — ليس فوريًا)</span></label>
    </div>
    <div class="gc-fields" id="gcFields">
      ${isPaypal
        ? `<input id="gcPaypalEmail" type="email" maxlength="80" placeholder="بريد حساب PayPal الذي ستستلمين عليه المبلغ" autocomplete="off">
           <div class="gc-note" style="margin-top:6px"><i class="f7-icons">checkmark_circle_fill</i> سيُرسل المبلغ مباشرة إلى حساب PayPal هذا من حساب الإدارة.</div>`
        : `<input id="gcAccountNumber" inputmode="numeric" maxlength="19" placeholder="رقم الحساب البنكي / رقم البطاقة (8-19 رقمًا)">
           <input id="gcAccountName" maxlength="60" placeholder="اسم صاحب الحساب">
           <div class="gc-note" style="margin-top:6px"><i class="f7-icons">info_circle_fill</i> هذا استلام عبر حساب بنكي: يبقى قيد المعالجة حتى تُحوّل الإدارة المبلغ يدويًا ثم تُحذف هداياك. للتحويل الفوري التلقائي اختاري «حساب باي بال».</div>`}
    </div>
    <div style="display:flex;gap:8px">
      <button class="gc-btn gc-btn-back" id="gcBackStepBtn" type="button" style="flex:0 0 auto;background:#e5e7ef;color:#475569;padding: 0px 2px;width: 35px;"><i class="f7-icons">chevron_right</i></button>
      <button class="gc-btn" id="gcSubmitBtn" type="button" style="flex:1"><i class="f7-icons">bank_fill</i> إرسال طلب التسكير ($${cashoutUsdFor(selectedGold).toFixed(2)})</button>
    </div>`;
  $$('#gcEligibleZone .gc-method').forEach(lbl => {
    lbl.onclick = (e) => {
      e.preventDefault();
      CASHOUT_METHOD = lbl.dataset.method;
      renderCashoutStep2(goldMin, usd);
    };
  });
  $('#gcBackStepBtn').onclick = () => { CASHOUT_STEP = 1; renderCashoutStep1(goldMin, usd); };
  $('#gcSubmitBtn').onclick = async () => {
    const btn = $('#gcSubmitBtn');
    const isPaypalNow = CASHOUT_METHOD === 'paypal';
    const paypalEmail = ($('#gcPaypalEmail') && $('#gcPaypalEmail').value || '').trim();
    const num = ($('#gcAccountNumber') && $('#gcAccountNumber').value || '').replace(/[\s-]/g, '');
    const accName = ($('#gcAccountName') && $('#gcAccountName').value || '').trim();
    const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
    if (isPaypalNow && !EMAIL_RE.test(paypalEmail)) return toast('أدخلي بريدك الإلكتروني المرتبط بحساب PayPal بشكل صحيح', false);
    if (!isPaypalNow && !/^\d{8,19}$/.test(num)) return toast('رقم الحساب غير صحيح — يجب أن يتكون من 8 إلى 19 رقمًا', false);
    const selection = buildCashoutSelection();
    if (!selection.length) return toast('حددي كمية الهدايا المراد تسكيرها أولاً', false);
    btn.disabled = true;
    btn.innerHTML = '<i class="f7-icons">arrow2_circlepath</i> جاري إرسال الطلب...';
    try {
      await api('/api/gift-cashout', 'POST', {
        account_number: num,
        account_name: accName,
        payout_method: isPaypalNow ? 'paypal' : 'bank',
        paypal_email: isPaypalNow ? paypalEmail : '',
        selection
      });
      toast('تم إرسال طلب التسكير ✓ سيصلك إشعار فور اتمام التحويل');
      resetCashoutSelection();
      renderGiftCashoutCard();
    } catch (e) {
      toast(e.error || 'تعذر إرسال الطلب', false);
      btn.disabled = false;
      btn.innerHTML = `<i class="f7-icons">bank_fill</i> إرسال طلب التسكير ($${cashoutUsdFor(selectedGold).toFixed(2)})`;
    }
  };
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
  $('#menuAva').innerHTML = avatarHtml(ME.avatar, '', frameOf(ME)) + `<span class="dot ${statusDot(ME.status)}"></span>`;
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
// «الحالات» في القائمة: بديل زر الحالات المخفي من هيدر الغرفة على الجوال.
$('#mnStatuses').onclick = () => { closeOv('menuOv'); openStatuses(); };
$('#mnAvatar').onclick = () => { closeOv('menuOv'); if (!ME.registered) return openOv('needRegOv'); openAvatars(); };
$('#mnMyGifts').onclick = () => { closeOv('menuOv'); openMyGifts(); };
$('#mnBlocks').onclick = () => { closeOv('menuOv'); openBlocksList(); };
function updateAccountSettingsVisibility() {
  // قسم الحساب (تغيير كلمة المرور) يظهر للأعضاء المسجلين فقط
  const sec = $('#accountSetSec');
  if (sec) sec.style.display = (ME && ME.registered) ? '' : 'none';
}
$('#mnSettings').onclick = () => { closeOv('menuOv'); applyPrefsToSwitches(); updateAccountSettingsVisibility(); openOv('setOv'); };
async function logoutWithoutReload() {
  if (!ME) return;
  try {
    if (CUR_ROOM && SOCKET) SOCKET.emit('leave', CUR_ROOM.id);
    await api('/api/logout', 'POST');
  } catch (e) { }
  if (SOCKET) { try { SOCKET.disconnect(); } catch (e) { } }
  CONNECTION_INTERRUPTED = false;
  hideConnectionOverlay();
  try { stopChatPing(); } catch (e) {}
  try { stopKeepaliveBeat(); } catch (e) {}
  SOCKET = null; CHAT_TOKEN = ''; ME = null; MYBADGE = 'guest.png';
  stopUserStatusActionWatcher(); USER_STATUS_REQUEST_ID++;
  CUR_ROOM = null; CUR_TARGET = null; PM_WITH = null; ROOM_USERS = [];
  IGNORED_USERS = new Set(); STATUSES = []; NOTIFS = []; CURRENT_NOTIFICATIONS = []; READ_NOTIFS = new Set();
  PRIV_UNREAD = 0; NOTIF_UNREAD = 0; STATUS_UNREAD = 0;
  updatePrivBadge(); updateNotifBadge(); updateStatusUnreadBadge();
  try { stopStatusMedia(); } catch (e) { }
  try { closeVoiceRecorder(); } catch (e) { }
  $$('.overlay.open').forEach(overlay => overlay.classList.remove('open'));
  syncSheetScale();   // لا تبقَ الخلفية مصغَّرة بعد إغلاق كل النوافذ
  closeEnterDrop();
  $('#headEnterBtn').style.display = '';
  $('#headUserBox').style.display = 'none';
  $('#headAva').innerHTML = '';
  syncInputBarAvatar();
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
//  الدخول الملكي (قائمة الحيوانات الملكية + توهج الدخول)
// =====================================================
let ROYAL_ANIMALS = [
  { key: 'lion', name: 'الأسد الملكي', emoji: '🦁', color: '#f59e0b', desc: 'يدخل كالأسد الهادر — قوة ومهابة', gif: '/img/royal_lion_gif.gif', gender: 'boy' },
  { key: 'whale', name: 'الحوت الملكي', emoji: '🐋', color: '#38bdf8', desc: 'يبحر في الغرفة بهدوء الملوك — عمق وهدوء', gif: '/img/royal_whale.gif', gender: 'boy' },
  { key: 'eagle', name: 'العقاب الملكي', emoji: '🦅', color: '#a78bfa', desc: 'يحلّق فوق الجميع — حرية وقوة', gif: '/img/royal_eagle.gif', gender: 'boy' },
  { key: 'unicorn', name: 'الوحيد قرن', emoji: '🦄', color: '#f472b6', desc: 'يسطع قوس قزح أينما دخل — تميز فريد', gif: '/img/royal_unicorn.gif', gender: 'boy' },
  { key: 'butterfly', name: 'الفراشة الملكية', emoji: '🦋', color: '#f472b6', desc: 'ترفرف بألوانها أينما دخلت — رقيّ وأنوثة', gif: '/img/royal_butterfly.gif', gender: 'girl' },
  { key: 'kitten', name: 'القطة الملكية', emoji: '🐱', color: '#a78bfa', desc: 'دخول لطيف يخطف القلوب — نعومة ودلال', gif: '/img/royal_kitten.gif', gender: 'girl' },
  { key: 'redrose', name: 'الوردة الحمراء', emoji: '🌹', color: '#ef4444', desc: 'تدخل كوردة حمراء فاخرة — جمال ملكي', gif: '/img/royal_redrose.gif', gender: 'girl' },
  { key: 'openrose', name: 'الوردة المتفتحة', emoji: '🌺', color: '#e11d48', desc: 'تتفتّح الغرفة بجمالها — سحر وأنوثة', gif: '/img/royal_openrose.gif', gender: 'girl' },
  { key: 'pinkrose', name: 'الوردة الوردية', emoji: '🌸', color: '#f9a8d4', desc: 'وردة وردية ناعمة — دخول ملكي للبنات', gif: '/img/royal_pinkrose.gif', gender: 'girl' }
];
const ROYAL_ANIMAL_DESCRIPTIONS = {
  lion: 'يدخل كالأسد الهادر — قوة ومهابة',
  whale: 'يبحر في الغرفة بهدوء الملوك — عمق وهدوء',
  eagle: 'يحلّق فوق الجميع — حرية وقوة',
  unicorn: 'يسطع قوس قزح أينما دخل — تميز فريد',
  butterfly: 'ترفرف بألوانها أينما دخلت — رقيّ وأنوثة',
  kitten: 'دخول لطيف يخطف القلوب — نعومة ودلال',
  redrose: 'تدخل كوردة حمراء فاخرة — جمال ملكي',
  openrose: 'تتفتّح الغرفة بجمالها — سحر وأنوثة',
  pinkrose: 'وردة وردية ناعمة — دخول ملكي للبنات'
};
function royalAnimal(key) { return ROYAL_ANIMALS.find(a => a.key === key) || ROYAL_ANIMALS[0]; }
function royalAnimalDescription(animal) {
  const value = String(animal && animal.desc || '').trim();
  // بيانات الحيوانات القادمة من قاعدة البيانات القديمة لا تحتوي على desc،
  // وبعض الإدخالات قد تحتوي نصاً حرفياً باسم undefined؛ لا نعرض أياً منهما.
  if (value && value.toLowerCase() !== 'undefined' && value.toLowerCase() !== 'null') return value;
  return ROYAL_ANIMAL_DESCRIPTIONS[animal && animal.key] || 'دخول ملكي مميز — حضور يليق بك';
}
// القائمة تُدار من لوحة الإدارة (قسما ذكور/إناث + صور وأصوات مخصصة) — تُحمَّل حياً
async function loadRoyalAnimals() {
  try {
    const d = await api('/api/royal-animals');
    if (d && Array.isArray(d.animals) && d.animals.length) {
      ROYAL_ANIMALS = d.animals.map(a => ({
        ...a,
        desc: royalAnimalDescription(a)
      }));
    }
  } catch (e) { }
}
// البنات يعرض لهن حيوانات البنات (فراشة/قطة/ورود…) والذكور يعرض لهم الأسد والحوت وغيرها.
function royalAnimalsFor(gender) {
  const g = gender === 'girl' ? 'girl' : 'boy';
  return ROYAL_ANIMALS.filter(a => (a.gender || 'boy') === g);
}
let ROYAL_SEL_ANIMAL = 'lion';
function renderRoyalAnimals() {
  const grid = $('#royalAnimalsGrid');
  if (!grid) return;
  const list = royalAnimalsFor(ME && ME.gender);
  if (!list.some(a => a.key === ROYAL_SEL_ANIMAL)) ROYAL_SEL_ANIMAL = (list[0] || ROYAL_ANIMALS[0]).key;
  grid.innerHTML = list.map(a => `
    <button type="button" class="royal-animal-card${ROYAL_SEL_ANIMAL === a.key ? ' sel' : ''}" data-animal="${a.key}" style="--rc:${a.color}">
      <span class="ra-emoji">${esc(a.emoji || '✨')}</span>
      <span class="ra-name">${esc(a.name || 'دخول ملكي')}</span>
      <span class="ra-desc">${esc(royalAnimalDescription(a))}</span>
    </button>`).join('');
  grid.querySelectorAll('.royal-animal-card').forEach(c => c.onclick = () => {
    ROYAL_SEL_ANIMAL = c.dataset.animal;
    renderRoyalAnimals();
  });
}
function openRoyal() {
  if (!ME) return openLogin();
  if (!ME.registered) return openOv('needRegOv');
  $('#royalName').textContent = ME.username;
  $('#royalPrice').textContent = '...';
  ROYAL_SEL_ANIMAL = (royalAnimalsFor(ME.gender)[0] || ROYAL_ANIMALS[0]).key;
  renderRoyalAnimals();
  $('#royalAnimalBlock').style.display = '';
  api('/api/royal-info').then(d => {
    if (!d) return;
    $('#royalPrice').textContent = (d.price || 0) + ' ذهب';
    const owned = !!d.isRoyal;
    const ownedBadge = $('#royalOwnedAnimal');
    if (owned && d.animal) {
      const a = royalAnimal(d.animal);
      ROYAL_SEL_ANIMAL = d.animal;
      ownedBadge.innerHTML = `<span class="ro-animal" style="--rc:${a.color}">${a.emoji}</span> ${a.name}`;
    } else {
      ROYAL_SEL_ANIMAL = d.pendingAnimal || 'lion';
    }
    renderRoyalAnimals();
    // صاحب الدخول يستطيع طلب تغيير حيوانه الملكي؛ غيره يطلب الحصول على الدخول.
    $('#royalAnimalsGrid').style.display = owned ? '' : (d.hasPending ? 'none' : '');
    $('#royalRequest').style.display = owned ? 'none' : '';
    $('#royalOwned').style.display = owned ? '' : 'none';
    $('#royalChange').style.display = owned ? '' : 'none';
    const note = $('#royalStateNote');
    if (owned) {
      note.textContent = d.hasPendingChange
        ? '✋ طلبك لتغيير الحيوان الملكي قيد المراجعة لدى الإدارة — سيصلك إشعار بنتيجة الموافقة.'
        : (d.expires_at
          ? `حسابك يحمل الدخول الملكي 👑 — الصلاحية حتى ${new Date(+d.expires_at * 1000).toLocaleDateString('ar')}. اختر حيواناً آخر ثم اضغط «تغيير الحيوان الملكي».`
          : 'حسابك يحمل الدخول الملكي 👑 — يظهر توهج حيوانك الملكي عند دخولك أي غرفة، والتاج الذهبي بجوار اسمك أينما ظهرت.');
    } else if (d.hasPending) {
      note.textContent = 'طلبك قيد المراجعة لدى الإدارة — لن يتم الخصم إلا بعد الموافقة، وسيصلك إشعار بالنتيجة.';
    }
  }).catch(() => {});
  openOv('royalOv');
}
$('#mnRoyal').onclick = () => { closeOv('menuOv'); openRoyal(); };
$('#royalRequest').onclick = async () => {
  const btn = $('#royalRequest');
  btn.disabled = true;
  const a = royalAnimal(ROYAL_SEL_ANIMAL);
  try {
    await api('/api/royal-request', 'POST', { animal: a.key });
    closeOv('royalOv');
    toast(`تم إرسال طلبك للدخول الملكي بـ${a.name} ${a.emoji} إلى لوحة الإدارة ✓ لن يتم الخصم إلا بعد الموافقة`);
  } catch (e) { toast(e.error || 'تعذر إرسال الطلب', false); }
  btn.disabled = false;
};
// تغيير الحيوان الملكي — لصاحب الدخول فقط، يصل طلبه للإدارة وتوافق أو ترفض.
$('#royalChange').onclick = async () => {
  const btn = $('#royalChange');
  btn.disabled = true;
  const a = royalAnimal(ROYAL_SEL_ANIMAL);
  try {
    await api('/api/royal-change-request', 'POST', { animal: a.key });
    closeOv('royalOv');
    toast(`تم إرسال طلب تغيير حيوانك الملكي إلى ${a.name} ${a.emoji} للإدارة ✓`);
  } catch (e) { toast(e.error || 'تعذر إرسال طلب التغيير', false); }
  btn.disabled = false;
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

  // تفعيل زر PayPal بعد تحميل الباقات (يُعرض فقط إن فعّلت الإدارة البوابة).
  PAYPAL_BUTTONS_RENDERED = false;
  const pw = $('#paypal-button-container');
  if (pw) pw.innerHTML = '';
  activatePayPal();
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

// -----------------------------------------------------------
//  الدفع الفعلي عبر PayPal — يُنشئ الطلب عبر الخادم (الذي يحمل secret)
//  ثم يُثبّت الدفع ويُشحن الذهب فقط بعد تأكيد PayPal للعملية.
//  لا يلمس الكود أي بيانات بطاقة، وليس هناك أي دفع تجميلي.
// -----------------------------------------------------------
let PAYPAL_SDK_LOADED = false;
let PAYPAL_BUTTONS_RENDERED = false;
// آخر خطأ حقيقي من الخادم (إنشاء/تأكيد العملية) — يُعرض في onError بدل رسالة عامة فارغة.
let PAYPAL_LAST_ERROR = '';

// تحميل مكتبة زر PayPal (SDK) بالـ client_id والعملة من إعدادات الخادم.
function loadPayPalSdk(cfg, cb) {
  if (window.paypal || PAYPAL_SDK_LOADED) { cb && cb(); return true; }
  if (!cfg.paypal_client_id) return false;
  const script = document.createElement('script');
  const base = cfg.paypal_mode === 'sandbox' ? 'https://www.sandbox.paypal.com/sdk/js' : 'https://www.paypal.com/sdk/js';
  // enable-funding: نُظهر خيارات الدفع كافة — بطاقات (Visa/Mastercard/Amex)، والائتمان، وPayPal.
  // لا نضيف شرطاً على طريقة الدفع: يختار المشتري الدين بالبطاقة أو PayPal أو غيرها من خيارات الدفع.
  const funding = encodeURIComponent('card,credit,paylater');
  script.src = `${base}?client-id=${encodeURIComponent(cfg.paypal_client_id)}&currency=${encodeURIComponent(cfg.paypal_currency || 'USD')}&intent=capture&commit=true&enable-funding=${funding}`;
  script.async = true;
  script.onload = () => { PAYPAL_SDK_LOADED = true; PAYPAL_BUTTONS_RENDERED = false; cb && cb(); };
  script.onerror = () => { PAYPAL_SDK_LOADED = false; const n = $('#buyPaypalNote'); if (n) { n.style.display = 'block'; n.textContent = 'تعذر تحميل بوابة الدفع، حاول مجدداً لاحقاً'; } };
  document.head.appendChild(script);
  return true;
}

// عرض زر PayPal داخل حاوية الدفع.
function renderPayPalButtons() {
  if (!window.paypal || !SELECTED_PACKAGE) return;
  if (PAYPAL_BUTTONS_RENDERED) return;
  const wrap = $('#paypal-button-container');
  if (!wrap) return;
  const note = $('#buyPaypalNote');
  if (note) note.style.display = 'none';

  PAYPAL_BUTTONS_RENDERED = true;
  try {
    // enableFunding: نعرض أيضاً خيار «بطاقة دين أو ائتمان» (Visa/Mastercard/Amex)
    // وخيارات تمويل أخرى بحسب ما يسمح به PayPal. يبقى الدفع حقيقياً عبر PayPal نفسه.
    paypal.Buttons({
      enableFunding: ['card', 'credit', 'paylater'],
      style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'paypal', height: 44 },
      // 1) إنشاء طلب دفع عبر الخادم (الخادم يحمل الـ secret ويتحقق من الباقة).
      createOrder: async (data, actions) => {
        if (!ME || !ME.registered) {
          toast('يجب تسجيل الدخول بحساب مسجل لإتمام عملية الشراء', false);
          return actions && actions.reject ? actions.reject() : null;
        }
        try {
          const order = await api('/api/paypal/create-order', 'POST', { package_id: SELECTED_PACKAGE.id });
          if (!order || !order.order_id) throw new Error((order && order.error) || 'تعذر إنشاء العملية');
          return order.order_id;
        } catch (e) {
          // احفظ السبب الحقيقي (رسالة الخادم) لعرضه في onError وفوق زر الدفع.
          let baseErr = (e && (e.error || e.message)) || 'تعذر إنشاء عملية الدفع، تحقق من إعدادات PayPal';
          // إن كان بيرPayPal قد قيّد الحساب التجاري، نعرض توجيهاً واضحاً بدل الرسالة الإنجليزية المجردة.
          if (/merchant account is restricted|account is restricted|restricted/i.test(baseErr)) {
            baseErr = 'الحساب التجاري مقيد لدى PayPal ولا يستطيع قبول الدفعات — يرجى حل القيد من حساب PayPal (تفعيل الحساب وإكمال بيانات العمل) أو استخدام وضع «تجريبي» بحساب Business مُفعّل.';
          }
          PAYPAL_LAST_ERROR = baseErr;
          toast(PAYPAL_LAST_ERROR, false);
          if (note) { note.style.display = 'block'; note.textContent = PAYPAL_LAST_ERROR; }
          return actions && actions.reject ? actions.reject() : null;
        }
      },
      // 2) بعد موافقة المشتري في PayPal نُثبّت الدفع، ثم يُشحن الذهب من الخادم.
      onApprove: async (data) => {
        try {
          const res = await api('/api/paypal/capture-order', 'POST', { order_id: data.orderID, package_id: SELECTED_PACKAGE.id });
          if (res && res.ok) {
            if (ME) ME.balance = res.balance;
            const mb = $('#menuBal');
            if (mb) mb.textContent = res.balance;
            // تحديث أي عناصر قد تعتمد الرصيد
            if (window.SOCKET && SOCKET) SOCKET.emit('call:balance_update', { balance: res.balance });
            if (typeof updateBalanceUI === 'function') updateBalanceUI(res.balance);

            closeOv('buyOv');
            toast(`🎉 تمت عملية الدفع بنجاح! شحن ${res.total_gold} ذهب (${res.amount_paid} ${res.currency}) إلى رصيدك 🪙`);
            if (typeof beep === 'function') beep(880, .2);
            PAYPAL_BUTTONS_RENDERED = false;
            const wrap2 = $('#paypal-button-container'); if (wrap2) wrap2.innerHTML = '';
          } else {
            PAYPAL_LAST_ERROR = (res && res.error) || 'لم يكتمل تأكيد الدفع، لم يُشحن أي رصيد';
            toast(PAYPAL_LAST_ERROR, false);
            if (note) { note.style.display = 'block'; note.textContent = PAYPAL_LAST_ERROR; }
          }
        } catch (e) {
          PAYPAL_LAST_ERROR = (e && (e.error || e.message)) || 'تعذر تأكيد الدفع، يرجى إعادة المحاولة';
          toast(PAYPAL_LAST_ERROR, false);
          if (note) { note.style.display = 'block'; note.textContent = PAYPAL_LAST_ERROR; }
        }
      },
      onError: (err) => {
        // اعرض سبباً أدق: آخر خطأ من الخادم إن وُجد، وإلا رسالة الـ SDK.
        const sdkDetail = (err && (err.message || err.description || err.name)) || '';
        const detail = PAYPAL_LAST_ERROR || sdkDetail;
        PAYPAL_LAST_ERROR = '';
        toast(detail ? ('حدث خطأ أثناء الدفع — ' + detail) : 'حدث خطأ أثناء الدفع، لم يتم الخصم ولم يُشحن أي رصيد', false);
        if (note) { note.style.display = 'block'; note.textContent = 'لم تنجح العملية — ' + (detail || 'حاول مجدداً.') ; }
      },
      onCancel: () => {
        toast('ألغيت عملية الدفع — لم يُخصم أي مبلغ', false);
      }
    }).render('#paypal-button-container');
  } catch (err) {
    if (note) { note.style.display = 'block'; note.textContent = 'تعذر عرض زر الدفع، حاول مجدداً.'; }
  }
}

// عند فتح المتجر بعد تحميل الباقات، نفعّل زر PayPal إن كان مفعّلاً من لوحة الإدارة.
function activatePayPal() {
  const wrap = $('#paypal-button-container');
  const note = $('#buyPaypalNote');

  if (!STORE_PAYMENT_INFO.paypal_enabled) {
    if (wrap) wrap.innerHTML = `<div style="padding:14px;text-align:center;color:#dc2626;font-weight:700;background:#fef2f2;border:1px solid #fecaca;border-radius:12px">الدفع الإلكتروني غير متاح حالياً — تواصل مع الإدارة</div>`;
    return;
  }
  if (!STORE_PAYMENT_INFO.paypal_client_id) {
    if (wrap) wrap.innerHTML = `<div style="padding:14px;text-align:center;color:#b45309;font-weight:700;background:#fffbeb;border:1px solid #fde68a;border-radius:12px">بوابة الدفع لم تُفعّل بعد — يرجى التواصل مع الإدارة</div>`;
    return;
  }
  if (!wrap) return;
  wrap.innerHTML = '';
  if (note) { note.style.display = 'block'; note.textContent = 'جاري تحميل بوابة الدفع الآمن...'; }

  const cfg = STORE_PAYMENT_INFO;
  const ok = loadPayPalSdk(cfg, () => renderPayPalButtons());
  if (!ok && !window.paypal) {
    if (note) note.textContent = 'تعذر تحميل بوابة الدفع، حاول مجدداً لاحقاً';
  } else if (ok && window.paypal) {
    PAYPAL_BUTTONS_RENDERED = false;
    renderPayPalButtons();
  }
}

$$('#setList .switch').forEach(sw => sw.onclick = () => {
  const k = sw.dataset.set;
  PREFS[k] = PREFS[k] ? 0 : 1;
  sw.classList.toggle('on', !!PREFS[k]);
  sw.setAttribute('aria-checked', PREFS[k] ? 'true' : 'false');
  savePrefs();
  // إشعارات سطح المكتب: طلب الإذن يتحرك بمفعّل المستخدم نفسه (متطلب المتصفحات)
  if (k === 'dsk_ntf' && PREFS[k]) requestDesktopNotifyPermission(true);
  toast('تم حفظ الاعدادات ✓');
});
// إرفاق صورة (دليل) مع الشكوى
let compImageFile = null;
function compImageClear() {
  compImageFile = null;
  const f = $('#compImage'); if (f) f.value = '';
  const p = $('#compImagePrev'); if (p) p.style.display = 'none';
  const img = $('#compImagePrevImg'); if (img) img.src = '';
}
const compImageInput = $('#compImage');
if (compImageInput) compImageInput.onchange = () => {
  const f = compImageInput.files && compImageInput.files[0];
  if (!f) { compImageClear(); return; }
  if (!/^image\//.test(f.type)) { compImageClear(); return toast('الملف يجب أن يكون صورة', false); }
  if (f.size > 8 * 1024 * 1024) { compImageClear(); return toast('حجم الصورة يجب ألا يتجاوز 8MB', false); }
  compImageFile = f;
  const img = $('#compImagePrevImg');
  if (img) { img.src = URL.createObjectURL(f); }
  const p = $('#compImagePrev'); if (p) p.style.display = '';
};
if ($('#compImageRemove')) $('#compImageRemove').onclick = compImageClear;
$('#compSend').onclick = async () => {
  if (!$('#compMsg').value.trim()) return toast('اكتب الشكوى أولا', false);
  const btn = $('#compSend');
  btn.disabled = true;
  try {
    // رفع صورة الدليل أولاً (إن وُجدت) ثم إرسال الشكوى بالمسار
    let imagePath = '';
    if (compImageFile) {
      const fd = new FormData();
      fd.append('media', compImageFile);
      try {
        const up = await api('/api/chat/upload-media', 'POST', fd, true);
        imagePath = (up && up.path) || '';
      } catch (ue) {
        btn.disabled = false;
        return toast((ue && ue.error) || 'تعذر رفع الصورة المرفقة', false);
      }
    }
    await api('/api/complaint', 'POST', { subject: $('#compSubject').value, message: $('#compMsg').value, targetId: PENDING_REPORT_TARGET ? PENDING_REPORT_TARGET.id : 0, image: imagePath });
    PENDING_REPORT_TARGET = null;
    compImageClear();
    $('#compMsg').value = ''; $('#compSubject').value = '';
    closeOv('compOv');
    toast('تم إرسال الشكوى إلى الإدارة');
  } catch (e) {
    toast((e && e.error) || 'تعذر إرسال الشكوى', false);
  }
  btn.disabled = false;
};

// تغيير الصورة — معرض صور حقيقي ومرفوعات المستخدم
AVA_CAT = 'def';
let MY_AVATARS = [];
async function openAvatars() {
  SEL_AVATAR = ME.avatar;
  SEL_FRAME = ME.avatar_frame || '';
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
        html += `<div class="ava-cell ${SEL_AVATAR === v ? 'sel' : ''}" data-v="${esc(v)}"><img src="${esc(v)}" alt="" loading="lazy"></div>`;
      });
    }
  } else {
    try {
      const serverAvatars = await api('/api/avatars?category=' + cat);
      if (serverAvatars && serverAvatars.length) {
        serverAvatars.forEach(item => {
          const v = item.path;
          html += `<div class="ava-cell ${SEL_AVATAR === v ? 'sel' : ''}" data-v="${esc(v)}"><img src="${esc(v)}" alt="" loading="lazy"></div>`;
        });
      } else {
        const AVA_FALLBACK = { def: 20, nature: 16, other: 16 };
        const n = AVA_FALLBACK[cat] || 16;
        for (let i = 1; i <= n; i++) {
          const v = `/avatars/${cat}/${String(i).padStart(2, '0')}.jpg`;
          html += `<div class="ava-cell ${SEL_AVATAR === v ? 'sel' : ''}" data-v="${v}"><img src="${v}" alt="" loading="lazy"></div>`;
        }
      }
    } catch (e) {
      const AVA_FALLBACK = { def: 20, nature: 16, other: 16 };
      const n = AVA_FALLBACK[cat] || 16;
      for (let i = 1; i <= n; i++) {
        const v = `/avatars/${cat}/${String(i).padStart(2, '0')}.jpg`;
        html += `<div class="ava-cell ${SEL_AVATAR === v ? 'sel' : ''}" data-v="${v}"><img src="${v}" alt="" loading="lazy"></div>`;
      }
    }
  }
  $('#avaGrid').innerHTML = html;
  $$('#avaGrid .ava-cell').forEach(c => c.onclick = () => {
    SEL_AVATAR = c.dataset.v;
    $$('#avaGrid .ava-cell').forEach(x => x.classList.toggle('sel', x.dataset.v === SEL_AVATAR));
    renderAvaPreview();
  });
  renderAvaPreview();
}
// معاينة الصورة المختارة مع الإطلالة المختارة
function renderAvaPreview() {
  const el = $('#avaPreview');
  if (!el) return;
  el.innerHTML = avatarHtml(SEL_AVATAR || (ME && ME.avatar) || '', '', SEL_FRAME);
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
    renderAvaPreview();
    onLoggedIn();
    toast('تم رفع الصورة وحفظها في قائمة مرفوعاتي ✅');
  } catch (e) { toast(e.error || 'تعذر رفع الصورة', false); }
};
$('#avaSave').onclick = async () => {
  try {
    let changed = false;
    if (SEL_AVATAR && SEL_AVATAR !== ME.avatar) {
      await api('/api/avatar', 'POST', { avatar: SEL_AVATAR });
      ME.avatar = SEL_AVATAR;
      changed = true;
    }
    if (SEL_FRAME !== (ME.avatar_frame || '')) {
      await api('/api/avatar-frame', 'POST', { frame: SEL_FRAME });
      ME.avatar_frame = SEL_FRAME;
      changed = true;
    }
    if (changed) onLoggedIn();
    closeOv('avaOv');
    toast('تم حفظ الصورة بنجاح ✅');
  } catch (e) { toast(e.error || 'تعذر حفظ الصورة', false); }
};

// ===== الإطلالات =====
// زر «أضف إطلالة» يفتح شبكة الإطارات؛ الاختيار يُعاين فوراً ويُحفظ مع الصورة.
$('#avaFrameBtn').onclick = () => { renderFrameGrid(); openOv('avaFrameOv'); };
function renderFrameGrid() {
  const grid = $('#frameGrid');
  if (!grid) return;
  const pic = SEL_AVATAR || (ME && ME.avatar) || '';
  let html = `<div class="frame-cell ${!SEL_FRAME ? 'sel' : ''}" data-f="">
      <span class="fc-none"><i class="f7-icons">nosign</i></span><b>بلا إطلالة</b></div>`;
  AVATAR_FRAMES.forEach(f => {
    html += `<div class="frame-cell ${SEL_FRAME === f ? 'sel' : ''}" data-f="${f}">
      ${avatarHtml(pic, '', f)}<b>${esc(AVATAR_FRAME_NAMES[f] || f)}</b></div>`;
  });
  grid.innerHTML = html;
  $$('#frameGrid .frame-cell').forEach(c => c.onclick = () => {
    SEL_FRAME = c.dataset.f || '';
    $$('#frameGrid .frame-cell').forEach(x => x.classList.toggle('sel', (x.dataset.f || '') === SEL_FRAME));
    renderAvaPreview();
  });
}
$('#frameSave').onclick = () => { renderAvaPreview(); closeOv('avaFrameOv'); };

// =====================================================
//  الحائط
// =====================================================
function wallTime(timestamp) {
  const date = new Date((+timestamp || Date.now() / 1000) * 1000);
  return date.toLocaleString(APP_LANG === 'en' ? 'en-US' : 'ar-JO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
function wallYoutubeVideoId(url) {
  const raw = String(url || '');
  const match = raw.match(/(?:youtube\.com\/embed\/|youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,20})/i);
  return match ? match[1] : '';
}
// لون خاص بكل وسيط: يُشتق حتمياً من معرّف/مسار الملف نفسه —
// كل مقطع يحمل لونه الخاص في كل مرة يظهر فيها، ولا يتغير بين التحديثات.
function wallYoutubeHue(videoId) {
  const s = String(videoId || '');
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return h % 360;
}
function wallMediaDescriptor(post) {
  if (!post) return null;
  if (post.youtube_url) {
    const id = wallYoutubeVideoId(post.youtube_url);
    return {
      type: 'youtube',
      src: String(post.youtube_url),
      poster: id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '',
      original: id ? `https://www.youtube.com/watch?v=${id}` : String(post.youtube_url),
      label: 'فيديو YouTube',
      hint: 'اضغط للمشاهدة في العارض الكامل',
      icon: 'play_rectangle_fill'
    };
  }
  if (post.video) {
    return {
      type: 'video', src: String(post.video), poster: String(post.image || ''), original: String(post.video),
      label: 'فيديو مرفوع', hint: 'اضغط لتشغيل الفيديو كاملاً', icon: 'videocam_fill'
    };
  }
  if (post.image) {
    return {
      type: 'image', src: String(post.image), poster: String(post.image), original: String(post.image),
      label: 'صورة', hint: 'اضغط لعرض الصورة كاملة', icon: 'photo_fill'
    };
  }
  return null;
}
function wallMediaCardMarkup(post) {
  const media = wallMediaDescriptor(post);
  if (!media) return '';
  // الصور: زر مدمج أنيق — لا تُحمَّل الصورة داخل الحائط (تخفيف الحجم)،
  // وتُفتح في عارض الصور عند النقر فقط.
  if (media.type === 'image') {
    return `<button class="chat-public-image wall-media-chip as-image" type="button" data-src="${esc(media.src)}">
      <span class="wmc-ic"><i class="f7-icons">photo_fill</i></span>
      <span class="wmc-body"><b>صورة مرفقة بالمنشور</b><small>اضغط هنا لفتح الصورة بالحجم الكامل</small></span>
      <span class="wmc-go"><i class="f7-icons">chevron_left</i></span>
    </button>`;
  }
  // يوتيوب: زر مدمج بلون خاص بكل فيديو (يُشتق من معرف المقطع) — بلا صورة
  // مصغرة خارجية (توفير طلبات i.ytimg.com لكل منشور)، وعند النقر يُشغَّل
  // داخل المشغل الكامل مع التشغيل التلقائي.
  if (media.type === 'youtube') {
    const hue = wallYoutubeHue(wallYoutubeVideoId(media.src));
    return `<button class="chat-public-image wall-media-chip as-youtube" type="button" style="--h:${hue}" data-media-type="youtube" data-src="${esc(media.src)}" data-original="${esc(media.original)}" data-title="${esc(media.label)}">
      <span class="wmc-ic"><i class="f7-icons">play_fill</i></span>
      <span class="wmc-body"><b>فيديو YouTube</b><small>اضغط للمشاهدة داخل المشغل</small></span>
      <span class="wmc-go"><i class="f7-icons">chevron_left</i></span>
    </button>`;
  }
  // الفيديو المرفوع: نفس البطاقة الفخمة، بلون مشتق من مسار الملف —
  // بلا صورة مصغرة داخل الحائط (تخفيف الحجم)، وعند النقر يُشغَّل في
  // المشغل الكامل (بملصقه داخل المشغل نفسه إن وُجد).
  if (media.type === 'video') {
    const hue = wallYoutubeHue(media.src);
    return `<button class="chat-public-image wall-media-chip as-video" type="button" style="--h:${hue}" data-media-type="video" data-src="${esc(media.src)}" data-poster="${esc(media.poster)}" data-original="${esc(media.original)}" data-title="${esc(media.label)}">
      <span class="wmc-ic"><i class="f7-icons">videocam_fill</i></span>
      <span class="wmc-body"><b>مقطع فيديو</b><small>اضغط لتشغيل الفيديو في المشغل</small></span>
      <span class="wmc-go"><i class="f7-icons">chevron_left</i></span>
    </button>`;
  }
  return '';
}
function closeWallMediaViewer() {
  const viewer = $('#wallMediaViewer');
  if (!viewer) return;
  const image = $('#wallMediaViewerImage');
  const video = $('#wallMediaViewerVideo');
  const youtube = $('#wallMediaViewerYoutube');
  image.onload = null; image.onerror = null;
  video.onloadeddata = null; video.oncanplay = null; video.onerror = null;
  youtube.onload = null; youtube.onerror = null;
  try { video.pause(); } catch (error) { }
  image.removeAttribute('src');
  video.removeAttribute('src'); video.removeAttribute('poster'); video.load();
  youtube.removeAttribute('src');
  image.hidden = true; video.hidden = true; youtube.hidden = true;
  $('#wallMediaViewerError').hidden = true;
  $('#wallMediaViewerLoading').hidden = false;
  viewer.classList.add('hidden');
  viewer.setAttribute('aria-hidden', 'true');
}
function openWallMediaViewer(media) {
  if (!media || !media.src) return;
  const viewer = $('#wallMediaViewer');
  const image = $('#wallMediaViewerImage');
  const video = $('#wallMediaViewerVideo');
  const youtube = $('#wallMediaViewerYoutube');
  const loading = $('#wallMediaViewerLoading');
  const errorBox = $('#wallMediaViewerError');
  const original = $('#wallMediaViewerOriginal');
  if (!viewer || !image || !video || !youtube) return;

  closeWallMediaViewer();
  viewer.classList.remove('hidden');
  viewer.setAttribute('aria-hidden', 'false');
  loading.hidden = false;
  errorBox.hidden = true;
  $('#wallMediaViewerTitle').textContent = media.title || 'عرض الوسائط';
  $('#wallMediaViewerTypeIcon').textContent = media.type === 'image' ? 'photo_fill' : (media.type === 'youtube' ? 'play_rectangle_fill' : 'videocam_fill');
  $('#wallMediaViewerHint').textContent = media.type === 'image' ? 'يمكنك تكبير الصورة من المتصفح' : 'استخدم أزرار المشغل للتحكم بالصوت والمشاهدة';
  original.href = media.original || media.src;
  original.querySelector('span').textContent = media.type === 'youtube' ? 'فتح في YouTube' : (media.type === 'image' ? 'فتح الصورة الأصلية' : 'فتح الفيديو الأصلي');

  const showError = () => {
    loading.hidden = true;
    errorBox.hidden = false;
    image.hidden = true; video.hidden = true; youtube.hidden = true;
  };
  if (media.type === 'image') {
    image.hidden = false;
    image.onload = () => { loading.hidden = true; };
    image.onerror = showError;
    image.src = media.src;
  } else if (media.type === 'youtube') {
    youtube.hidden = false;
    youtube.onload = () => { loading.hidden = true; };
    youtube.onerror = showError;
    const separator = media.src.includes('?') ? '&' : '?';
    youtube.src = media.src + separator + 'autoplay=1&rel=0';
  } else {
    video.hidden = false;
    video.poster = media.poster || '';
    video.onloadeddata = () => { loading.hidden = true; video.play().catch(() => { }); };
    video.oncanplay = () => { loading.hidden = true; };
    video.onerror = showError;
    video.src = media.src;
    video.load();
  }
}
const wallMediaViewerCloseButton = $('#wallMediaViewerClose');
const wallMediaViewerOverlay = $('#wallMediaViewer');
if (wallMediaViewerCloseButton) wallMediaViewerCloseButton.onclick = closeWallMediaViewer;
if (wallMediaViewerOverlay) wallMediaViewerOverlay.onclick = event => { if (event.target === wallMediaViewerOverlay) closeWallMediaViewer(); };
document.addEventListener('keydown', event => {
  const viewer = $('#wallMediaViewer');
  if (event.key === 'Escape' && viewer && !viewer.classList.contains('hidden')) closeWallMediaViewer();
});

async function openWall() {
  if (!ME) return openLogin();
  $('#wallComposeAvatar').innerHTML = avatarHtml(ME.avatar, '', frameOf(ME));
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
// ---- تعليقات الحائط: يظهر تعليقان في البداية، ثم 5 تعليقات مع كل ضغطة على
// «إظهار المزيد»، وعند عرض الجميع يتحول الزر إلى «إظهار أقل». ----
const WALL_COMMENTS_INITIAL = 2;
const WALL_COMMENTS_STEP = 5;
function wallCommentsShown(card) {
  const shown = +card.dataset.commentsShown;
  return Number.isFinite(shown) && shown > 0 ? shown : WALL_COMMENTS_INITIAL;
}
// يعيد ضبط ظهور التعليقات ونص زر «إظهار المزيد / إظهار أقل» حسب العدد المعروض حالياً.
function syncWallComments(card, post) {
  if (!card) return;
  const total = ((post && post.comments) || []).length;
  let shown = Math.min(Math.max(wallCommentsShown(card), WALL_COMMENTS_INITIAL), Math.max(total, WALL_COMMENTS_INITIAL));
  card.dataset.commentsShown = shown;
  card.querySelectorAll('.wall-comment-list .wall-comment').forEach((node, index) => {
    node.classList.toggle('wall-comment-extra', index >= WALL_COMMENTS_INITIAL);
    node.hidden = index >= shown;
  });
  let toggle = card.querySelector('.wall-comments-more');
  if (total <= WALL_COMMENTS_INITIAL) { if (toggle) toggle.remove(); return; }
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'wall-comments-more';
    const form = card.querySelector('.wall-comment-form');
    if (form) form.before(toggle); else card.querySelector('.wall-comments').appendChild(toggle);
  }
  const remaining = Math.max(0, total - shown);
  toggle.dataset.mode = remaining > 0 ? 'more' : 'less';
  toggle.textContent = remaining > 0 ? `إظهار المزيد (${remaining})` : 'إظهار أقل';
  bindWallMoreComments(card, post);
}
function bindWallMoreComments(card, post) {
  const toggle = card.querySelector('.wall-comments-more');
  if (!toggle) return;
  toggle.onclick = () => {
    const total = ((post && post.comments) || []).length;
    card.dataset.commentsShown = toggle.dataset.mode === 'less'
      ? WALL_COMMENTS_INITIAL
      : Math.min(total, wallCommentsShown(card) + WALL_COMMENTS_STEP);
    syncWallComments(card, post);
  };
}
function wallSummaryText(post) {
  return `${(post && post.reaction_count) || 0} تفاعل • ${((post && post.comments) || []).length} تعليق`;
}
// ربط النقر على اسم/صورة صاحب التعليق بالقائمة المنبثقة.
function bindWallCommentIdentity(node, comment) {
  if (!node || !comment) return;
  const commenter = comment.user || { id: comment.user_id, username: comment.username, avatar: '' };
  const target = { id: +(commenter.id || comment.user_id || 0), username: commenter.username || comment.username, avatar: commenter.avatar || '' };
  // النقر على التعليق كله يفتح القائمة، والسهم ينبثق دائماً من اسم صاحب التعليق.
  const nameEl = node.querySelector('.wall-comment-bubble b') || node;
  const open = event => { if (event && event.stopPropagation) event.stopPropagation(); openNamePopover(nameEl, target); };
  node.onclick = open;
  node.querySelectorAll('.wall-person').forEach(el => { el.onclick = open; });
}

// =====================================================
//  من تفاعل مع المنشور: قائمة أصحاب الإعجابات والسمايلات
// =====================================================
let WALL_REACTORS = { postId: 0, list: [], counts: {}, filter: 'all' };
async function openWallReactors(postId) {
  if (!ME) return openLogin();
  WALL_REACTORS = { postId: +postId, list: [], counts: {}, filter: 'all' };
  $('#wallReactorsTabs').innerHTML = '';
  $('#wallReactorsList').innerHTML = '<div class="wall-reactors-loading">جاري تحميل التفاعلات...</div>';
  openOv('wallReactorsOv');
  try {
    const data = await api(`/api/wall/${+postId}/reactions`);
    if (WALL_REACTORS.postId !== +postId) return;
    WALL_REACTORS.list = (data && data.reactions) || [];
    WALL_REACTORS.counts = (data && data.counts) || {};
    renderWallReactors();
  } catch (e) {
    $('#wallReactorsList').innerHTML = '<div class="wall-reactors-empty">تعذر تحميل التفاعلات</div>';
  }
}
function renderWallReactors() {
  const order = ['👍', '❤️', '😂', '😍', '😮'];
  const tabs = $('#wallReactorsTabs');
  const list = $('#wallReactorsList');
  const total = WALL_REACTORS.list.length;
  const available = order.filter(icon => WALL_REACTORS.counts[icon]);
  if (!available.includes(WALL_REACTORS.filter)) WALL_REACTORS.filter = 'all';
  tabs.innerHTML = [`<button class="wall-reactors-tab${WALL_REACTORS.filter === 'all' ? ' active' : ''}" type="button" data-filter="all">الكل <b>${total}</b></button>`]
    .concat(available.map(icon => `<button class="wall-reactors-tab${WALL_REACTORS.filter === icon ? ' active' : ''}" type="button" data-filter="${icon}">${icon} <b>${WALL_REACTORS.counts[icon]}</b></button>`)).join('');
  tabs.querySelectorAll('.wall-reactors-tab').forEach(tab => {
    tab.onclick = () => { WALL_REACTORS.filter = tab.dataset.filter; renderWallReactors(); };
  });
  const rows = WALL_REACTORS.filter === 'all' ? WALL_REACTORS.list : WALL_REACTORS.list.filter(row => row.reaction === WALL_REACTORS.filter);
  if (!rows.length) { list.innerHTML = '<div class="wall-reactors-empty">لا توجد تفاعلات على هذا المنشور بعد</div>'; return; }
  list.innerHTML = rows.map(row => {
    const user = row.user || { username: row.username, avatar: '' };
    const label = user.rank && user.rank !== 'user'
      ? (RANK_NAMES[user.rank] || 'حساب إداري')
      : (user.membership && user.membership !== 'none' ? (MEM_NAMES[user.membership] || user.membership) : (user.registered ? 'عضو مسجل' : 'زائر'));
    return `<div class="wall-reactor-row" data-uid="${+(user.id || row.user_id || 0)}">
      <span class="wr-avatar">${avatarHtml(user.avatar)}<span class="wr-emoji">${row.reaction}</span></span>
      <span class="wr-info"><b style="color:${userColor(user)}">${esc(user.username || row.username)}</b><small>${esc(label)}</small></span>
    </div>`;
  }).join('');
  list.querySelectorAll('.wall-reactor-row').forEach(row => {
    row.onclick = () => {
      const uid = +row.dataset.uid;
      if (!uid) return;
      closeOv('wallReactorsOv');
      openProfile(uid);
    };
  });
}

// =====================================================
//  قائمة منبثقة صغيرة بجانب الاسم (سهم يخرج من الاسم المنقور)
// =====================================================
let NAME_POPOVER_TARGET = null;
function ensureNamePopoverVeil() {
  let veil = $('#namePopoverVeil');
  if (!veil) {
    veil = document.createElement('div');
    veil.id = 'namePopoverVeil';
    veil.className = 'name-popover-veil';
    veil.hidden = true;
    // النقر خارج القائمة يغلقها، وإن كان النقر على اسم آخر تُفتح له قائمته مباشرة.
    veil.addEventListener('click', event => {
      veil.hidden = true;
      const under = document.elementFromPoint(event.clientX, event.clientY);
      const nameEl = under && under.closest('.wall-person, .mname, .mava');
      closeNamePopover();
      if (nameEl && typeof nameEl.onclick === 'function') nameEl.onclick({ stopPropagation() { }, currentTarget: nameEl, target: nameEl });
    });
    const frame = document.getElementById('frame') || document.body;
    frame.appendChild(veil);
  }
  return veil;
}
function closeNamePopover() {
  const pop = $('#namePopover');
  if (pop) pop.hidden = true;
  const veil = $('#namePopoverVeil');
  if (veil) veil.hidden = true;
  NAME_POPOVER_TARGET = null;
}
// يبني عناصر القائمة حسب السياق: الحائط قائمة مختصرة، والعام كل خيارات المستخدم.
function namePopoverItems(target) {
  const isMe = !!(ME && +target.id === +ME.id);
  const items = [];
  if (!isMe) items.push({ key: 'private', icon: 'chat_bubble_fill', label: 'دردشة خاصة' });
  items.push({ key: 'profile', icon: 'person_crop_circle_fill', label: 'عرض الملف الشخصي' });
  return items;
}
// ينفّذ خيار القائمة عبر إعادة استخدام منطق ورقة المستخدم الموجود.
function runNamePopoverAction(key, target) {
  closeNamePopover();
  if (key === 'profile') return openProfile(+target.id);
  if (key === 'private') {
    if (!ME) return openLogin();
    const peer = ROOM_USERS.find(u => +u.id === +target.id) || { id: +target.id, username: target.username, avatar: target.avatar, registered: 1 };
    // القائمة قد تُفتح من داخل الحائط أو من قائمة المتفاعلين:
    // نغلقهما أولاً حتى لا يبقيا فوق نافذة الخاص.
    ['wallReactorsOv', 'wallOv'].forEach(ovId => {
      const ov = $('#' + ovId);
      if (ov && ov.classList.contains('open')) closeOv(ovId);
    });
    return openPrivateWith(peer);
  }
}
// يفتح القائمة ملتصقة بالعنصر المنقور، والسهم يشير إليه.
function openNamePopover(anchor, target) {
  if (!anchor || !target || !target.id) return;
  if (!ME) return openLogin();
  const pop = $('#namePopover');
  if (!pop) return;
  const same = NAME_POPOVER_TARGET && NAME_POPOVER_TARGET.anchor === anchor && !pop.hidden;
  if (same) return closeNamePopover();
  NAME_POPOVER_TARGET = { anchor, target };
  $('#namePopoverAvatar').innerHTML = avatarHtml(target.avatar);
  $('#namePopoverName').textContent = target.username || '-';
  $('#namePopoverName').style.color = userColor(target);
  const memberLabel = target.rank && target.rank !== 'user'
    ? (RANK_NAMES[target.rank] || 'حساب إداري')
    : (target.membership && target.membership !== 'none' ? (MEM_NAMES[target.membership] || target.membership) : (target.registered === 0 ? 'زائر' : 'عضو مسجل'));
  $('#namePopoverMem').textContent = memberLabel;
  const items = namePopoverItems(target);
  $('#namePopoverItems').innerHTML = items.map(item =>
    `<button class="name-popover-item ${item.cls || ''}" type="button" data-key="${item.key}"><i class="f7-icons np-ic">${item.icon}</i><span>${esc(item.label)}</span><i class="f7-icons np-go">chevron_left</i></button>`
  ).join('');
  $('#namePopoverItems').querySelectorAll('.name-popover-item').forEach(button => {
    button.onclick = event => { event.stopPropagation(); runNamePopoverAction(button.dataset.key, target); };
  });
  ensureNamePopoverVeil().hidden = false;
  pop.hidden = false;
  positionNamePopover(anchor, pop);
}
// يضع القائمة تحت الاسم (أو فوقه عند ضيق المساحة) داخل حدود الإطار، ويوجّه السهم للاسم.
function positionNamePopover(anchor, pop) {
  const frame = document.getElementById('frame') || document.body;
  const frameRect = frame.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  const margin = 8;
  const gap = 9;
  const spaceBelow = frameRect.bottom - anchorRect.bottom;
  const below = spaceBelow >= popRect.height + gap + margin || spaceBelow >= anchorRect.top - frameRect.top;
  pop.classList.toggle('pos-below', below);
  pop.classList.toggle('pos-above', !below);
  const top = below
    ? anchorRect.bottom - frameRect.top + gap
    : anchorRect.top - frameRect.top - popRect.height - gap;
  const anchorCenter = anchorRect.left + anchorRect.width / 2 - frameRect.left;
  const maxLeft = frameRect.width - popRect.width - margin;
  const left = Math.max(margin, Math.min(anchorCenter - popRect.width / 2, Math.max(margin, maxLeft)));
  pop.style.top = Math.max(margin, top) + 'px';
  pop.style.left = left + 'px';
  const arrow = $('#namePopoverArrow');
  if (arrow) {
    const arrowLeft = Math.max(12, Math.min(anchorCenter - left - 6, popRect.width - 24));
    arrow.style.left = arrowLeft + 'px';
  }
}
window.addEventListener('resize', closeNamePopover);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeNamePopover(); });
// أي تمرير للمحتوى يغلق القائمة كي لا تبقى معلّقة بعيداً عن الاسم.
['#msgArea', '#wallScroll'].forEach(selector => {
  const area = document.querySelector(selector);
  if (!area) return;
  area.addEventListener('scroll', () => {
    if (!$('#namePopover').hidden) closeNamePopover();
    // ورقة المستخدم الملتصقة تتبع الاسم أثناء التمرير وتُغلق إن خرج عن المنطقة المرئية.
    if (!USER_SHEET_ANCHOR) return;
    const areaRect = area.getBoundingClientRect();
    const anchorRect = USER_SHEET_ANCHOR.getBoundingClientRect();
    if (anchorRect.bottom < areaRect.top || anchorRect.top > areaRect.bottom) return closeOv('userSheet');
    positionAnchoredUserSheet();
  }, { passive: true });
});
function updateWallReactionDisplay(card, post) {
  const order = ['👍', '❤️', '😂', '😍', '😮'];
  card.querySelector('.wall-reaction-emojis').innerHTML = order.filter(icon => post.reactions && post.reactions[icon])
    .map(icon => `<span>${icon}<b>${post.reactions[icon]}</b></span>`).join('');
  card.querySelector('.wall-reaction-summary > span:last-child').textContent = wallSummaryText(post);
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
  node.className = 'wall-comment';
  node.innerHTML = wallCommentInnerMarkup(comment, commenter);
  card.querySelector('.wall-comment-list').appendChild(node);
  // تعليقي الجديد يظهر مباشرة: نوسّع النافذة كي يشمل آخر تعليق.
  card.dataset.commentsShown = Math.max(wallCommentsShown(card), post.comments.length);
  syncWallComments(card, post);
  bindWallCommentIdentity(node, comment);
  card.querySelector('.wall-reaction-summary > span:last-child').textContent = wallSummaryText(post);
}
// اسم/صورة صاحب التعليق (مع معرّفه) كي تُفتح القائمة المنبثقة عند النقر عليه.
function wallCommentInnerMarkup(comment, commenter) {
  const uid = +((commenter && commenter.id) || comment.user_id || 0);
  const name = esc((commenter && commenter.username) || comment.username || '');
  return `<span class="wall-comment-avatar wall-person" data-uid="${uid}">${avatarHtml(commenter && commenter.avatar)}</span>
    <div class="wall-comment-bubble"><b class="wall-person" data-uid="${uid}">${name}</b><p>${esc(comment.text)}</p></div>`;
}
function wallPostMarkup(post) {
  const reactionsOrder = ['👍', '❤️', '😂', '😍', '😮'];
  const user = post.user || { username: post.username, avatar: '', badge: 'register.png' };
  const reactions = reactionsOrder.filter(icon => post.reactions && post.reactions[icon])
    .map(icon => `<span>${icon}<b>${post.reactions[icon]}</b></span>`).join('');
  const totalComments = (post.comments || []).length;
  const comments = (post.comments || []).map((comment, commentIndex) => {
    const commenter = comment.user || { username: comment.username, avatar: '' };
    return `<div class="wall-comment${commentIndex >= WALL_COMMENTS_INITIAL ? ' wall-comment-extra' : ''}" ${commentIndex >= WALL_COMMENTS_INITIAL ? 'hidden' : ''}>
      ${wallCommentInnerMarkup(comment, commenter)}
    </div>`;
  }).join('');
  const moreComments = totalComments > WALL_COMMENTS_INITIAL
    ? `<button class="wall-comments-more" type="button" data-mode="more">إظهار المزيد (${totalComments - WALL_COMMENTS_INITIAL})</button>`
    : '';
  const wallMedia = wallMediaCardMarkup(post);
  const myReaction = post.my_reaction || '';
  const authorId = +(user.id || post.user_id || 0);
  return `<article class="wall-post" data-id="${post.id}" data-comments-shown="${WALL_COMMENTS_INITIAL}">
    <div class="wall-post-head">
      <span class="wall-post-avatar wall-person" data-uid="${authorId}">${avatarHtml(user.avatar)}</span>
      <span class="wall-post-who"><b class="wall-person" data-uid="${authorId}">${esc(user.username || post.username)}${user.verified ? ' <i class="f7-icons">checkmark_seal_fill</i>' : ''}</b><small>${esc(wallTime(post.created_at))}</small></span>
      ${(user.badge && !['guest.png', 'register.png'].includes(user.badge)) ? `<img class="wall-post-badge" src="/badges/${esc(user.badge)}" alt="">` : ''}
      ${post.can_delete ? '<button class="wall-post-delete" type="button" title="حذف المنشور"><i class="f7-icons">trash_fill</i></button>' : ''}
    </div>
    ${post.text ? `<div class="wall-post-text">${esc(post.text)}</div>` : ''}
    ${wallMedia}
    <div class="wall-reaction-summary" role="button" tabindex="0" title="عرض من تفاعلوا مع المنشور"><span class="wall-reaction-emojis">${reactions}</span><span>${wallSummaryText(post)}</span></div>
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
  syncWallComments(card, post);
  // النقر على شريط التفاعلات يعرض من وضعوا الإعجابات والسمايلات.
  const summary = card.querySelector('.wall-reaction-summary');
  if (summary) {
    summary.onclick = () => openWallReactors(postId);
    summary.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openWallReactors(postId); } };
  }
  // اسم/صورة صاحب المنشور وأصحاب التعليقات: قائمة منبثقة بجانب الاسم.
  const author = post.user || { id: post.user_id, username: post.username, avatar: '' };
  card.querySelectorAll('.wall-post-head .wall-person').forEach(el => {
    el.onclick = event => { event.stopPropagation(); openNamePopover(el, { id: +(author.id || post.user_id || 0), username: author.username || post.username, avatar: author.avatar || '' }); };
  });
  (post.comments || []).forEach((comment, index) => {
    const node = card.querySelectorAll('.wall-comment-list .wall-comment')[index];
    bindWallCommentIdentity(node, comment);
  });
  // البطاقات المدمجة (صورة / يوتيوب / فيديو): الصورة تُفتح في عارض الصور،
  // واليوتيوب والفيديو يُشغَّلان في المشغل الكامل مع التشغيل التلقائي.
  const compactMedia = card.querySelector('.wall-media-chip');
  if (compactMedia) {
    compactMedia.onclick = () => {
      const type = compactMedia.dataset.mediaType;
      if (type === 'youtube' || type === 'video') {
        openWallMediaViewer({
          type,
          src: compactMedia.dataset.src,
          poster: compactMedia.dataset.poster || '',
          original: compactMedia.dataset.original || compactMedia.dataset.src,
          title: compactMedia.dataset.title || 'عرض الوسائط'
        });
      } else {
        openChatImage(compactMedia.dataset.src, (post.user && post.user.username) || post.username);
      }
    };
  }
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
async function createWallVideoThumbnail(file) {
  if (!file || !String(file.type || '').startsWith('video/')) return null;
  return new Promise(resolve => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    let finished = false;
    let capturing = false;
    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      try { video.pause(); } catch (error) { }
      video.removeAttribute('src');
      URL.revokeObjectURL(objectUrl);
      resolve(result || null);
    };
    const capture = () => {
      if (capturing || finished) return;
      capturing = true;
      try {
        if (!video.videoWidth || !video.videoHeight) return finish(null);
        const maxWidth = 960;
        const scale = Math.min(1, maxWidth / video.videoWidth);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => {
          if (!blob) return finish(null);
          finish(new File([blob], `wall_video_${Date.now()}.jpg`, { type: 'image/jpeg' }));
        }, 'image/jpeg', .84);
      } catch (error) { finish(null); }
    };
    const timeout = setTimeout(() => finish(null), 9000);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onerror = () => finish(null);
    video.onloadedmetadata = () => {
      const target = Number.isFinite(video.duration) && video.duration > .2 ? Math.min(1, video.duration * .2) : 0;
      if (target > 0) {
        video.onseeked = capture;
        try { video.currentTime = target; } catch (error) { capture(); }
      }
    };
    video.onloadeddata = () => { if (!video.onseeked || !video.duration) capture(); };
    video.src = objectUrl;
    video.load();
  });
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
  $('#wallVideoElement').removeAttribute('poster');
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
      WALL_IMAGE_PATH = '';
      $('#wallVideoElement').removeAttribute('src');
      $('#wallVideoElement').removeAttribute('poster');
      $('#wallVideoPreview').hidden = true;
      $('#wallVideoFile').value = '';
      $('#wallImageElement').removeAttribute('src');
      $('#wallImagePreview').hidden = true;
      $('#wallImageFile').value = '';
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
    WALL_VIDEO_PATH = '';
    WALL_YOUTUBE_URL = '';
    $('#wallVideoElement').removeAttribute('src');
    $('#wallVideoElement').removeAttribute('poster');
    $('#wallVideoPreview').hidden = true;
    $('#wallVideoFile').value = '';
    $('#wallYoutubeSelected').hidden = true;
    $('#wallYoutubeSelected').innerHTML = '';
    $('#wallYoutubeResults').innerHTML = '';
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
  const thumbnailPromise = createWallVideoThumbnail(file);
  $('#wallAddVideo').disabled = true;
  try {
    toast('جاري رفع الفيديو...');
    const uploaded = await uploadFormWithProgress('/api/wall/upload-video', form, 'جاري رفع فيديو الحائط...');
    WALL_VIDEO_PATH = uploaded.path;
    WALL_YOUTUBE_URL = '';
    WALL_IMAGE_PATH = '';
    $('#wallYoutubeSelected').hidden = true;
    $('#wallYoutubeSelected').innerHTML = '';
    $('#wallYoutubeResults').innerHTML = '';
    $('#wallImageElement').removeAttribute('src');
    $('#wallImagePreview').hidden = true;
    $('#wallImageFile').value = '';

    // إنشاء صورة ثابتة من لقطة الفيديو ورفعها كبوستر للبطاقة. إذا كان ترميز
    // الفيديو غير قابل للقراءة في المتصفح يبقى القالب العام الجميل كبديل.
    const thumbnailFile = await thumbnailPromise;
    if (thumbnailFile) {
      try {
        const thumbnailForm = new FormData();
        thumbnailForm.append('image', thumbnailFile);
        const thumbnail = await uploadFormWithProgress('/api/wall/upload-image', thumbnailForm, 'جاري تجهيز صورة معاينة الفيديو...');
        WALL_IMAGE_PATH = thumbnail.path;
      } catch (error) { WALL_IMAGE_PATH = ''; }
    }
    $('#wallVideoElement').src = uploaded.path;
    if (WALL_IMAGE_PATH) $('#wallVideoElement').poster = WALL_IMAGE_PATH;
    else $('#wallVideoElement').removeAttribute('poster');
    $('#wallVideoPreview').hidden = false;
    toast(WALL_IMAGE_PATH ? 'تم رفع الفيديو وتجهيز صورة المعاينة بنجاح' : 'تم رفع الفيديو بنجاح');
  } catch (e) { toast(e.error || 'تعذر رفع الفيديو', false); }
  finally { $('#wallAddVideo').disabled = false; }
};
$('#wallVideoRemove').onclick = () => {
  WALL_VIDEO_PATH = '';
  WALL_IMAGE_PATH = '';
  $('#wallVideoElement').removeAttribute('src');
  $('#wallVideoElement').removeAttribute('poster');
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
// استعادة كلمة المرور — نظام رمز عبر البريد للحسابات المسجلة
$('#goForgot').onclick = () => {
  $('#resetEmail').value = '';
  $('#resetCode').value = '';
  $('#resetNewPass').value = '';
  $('#resetNewPass2').value = '';
  $('#resetStep1').style.display = '';
  $('#resetStep2').style.display = 'none';
  const e = $('#resetErr'); if (e) { e.style.display = 'none'; e.textContent = ''; }
  openOv('resetPwOv');
};
let RESET_EMAIL = '';
function resetShowErr(msg) {
  const e = $('#resetErr');
  if (!e) return;
  e.textContent = msg || '';
  e.style.display = msg ? '' : 'none';
}
async function resetSendCode() {
  const email = $('#resetEmail').value.trim().toLowerCase();
  if (!email) { resetShowErr('أدخل البريد الإلكتروني المسجل'); return; }
  const btn = $('#resetSendCode');
  btn.disabled = true;
  try {
    const r = await api('/api/forgot-password', 'POST', { email });
    if (r && r.ok) {
      RESET_EMAIL = email;
      resetShowErr('');
      $('#resetStep1').style.display = 'none';
      $('#resetStep2').style.display = '';
      toast('📧 تم إرسال رمز الاستعادة إلى بريدك');
      startResetCooldown(0);
      setTimeout(() => { const c = $('#resetCode'); if (c) c.focus(); }, 200);
    } else {
      resetShowErr((r && r.error) || 'تعذر إرسال الرمز');
    }
  } catch (e) {
    resetShowErr((e && e.error) || 'تعذر إرسال الرمز');
  }
  btn.disabled = false;
}
$('#resetSendCode').onclick = resetSendCode;
$('#resetResend').onclick = async () => {
  const btn = $('#resetResend');
  btn.disabled = true;
  try {
    const r = await api('/api/forgot-password', 'POST', { email: RESET_EMAIL });
    if (r && r.ok) { toast('📧 أُعيد إرسال الرمز'); startResetCooldown(0); }
    else if (r && r.wait) { startResetCooldown(r.wait); }
    else resetShowErr((r && r.error) || 'تعذر إعادة الإرسال');
  } catch (e) { resetShowErr((e && e.error) || 'تعذر إعادة الإرسال'); }
  btn.disabled = false;
};
let RESET_COOLDOWN_UNTIL = 0, RESET_COOLDOWN_TIMER = null;
function startResetCooldown(seconds) {
  RESET_COOLDOWN_UNTIL = Date.now() + Math.max(0, seconds) * 1000;
  const btn = $('#resetResend');
  if (RESET_COOLDOWN_TIMER) clearInterval(RESET_COOLDOWN_TIMER);
  const tick = () => {
    const left = Math.ceil((RESET_COOLDOWN_UNTIL - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(RESET_COOLDOWN_TIMER); RESET_COOLDOWN_TIMER = null;
      if (btn) { btn.disabled = false; btn.textContent = 'إعادة إرسال الرمز'; }
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'إعادة الإرسال (' + left + 'ث)'; }
  };
  tick();
  RESET_COOLDOWN_TIMER = setInterval(tick, 1000);
}
$('#resetDo').onclick = async () => {
  const code = $('#resetCode').value.trim();
  const p1 = $('#resetNewPass').value;
  const p2 = $('#resetNewPass2').value;
  if (code.length !== 6) { resetShowErr('أدخل رمز الاستعادة المكون من 6 أرقام'); return; }
  if (p1.length < 4) { resetShowErr('كلمة المرور الجديدة 4 خانات على الأقل'); return; }
  if (p1 !== p2) { resetShowErr('كلمتا المرور غير متطابقتين'); return; }
  const btn = $('#resetDo');
  btn.disabled = true;
  try {
    const r = await api('/api/reset-password', 'POST', { email: RESET_EMAIL, code, newPassword: p1 });
    if (r && r.ok) {
      resetShowErr('');
      closeOv('resetPwOv');
      toast('✅ تم تغيير كلمة المرور — ادخل الآن بكلمة المرور الجديدة');
      $('#resetNewPass').value = ''; $('#resetNewPass2').value = ''; $('#resetCode').value = '';
      const lp = $('#lPass'); if (lp) lp.focus();
    } else {
      resetShowErr((r && r.error) || 'تعذر تغيير كلمة المرور');
    }
  } catch (e) {
    resetShowErr((e && e.error) || 'تعذر تغيير كلمة المرور');
  }
  btn.disabled = false;
};
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
  const btn = $('#doLogin');
  if (btn && btn.disabled) return;
  const startedAt = Date.now();
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="f7-icons">arrow2_circlepath</i> جارٍ تسجيل الدخول...';
  }
  try {
    const d = await api('/api/login', 'POST', { username: $('#lUser').value.trim(), password: $('#lPass').value, ...VISIT_INFO });
    // حساب مسجل غير مُفعَّل بريده: يُفعّل بقالب الرمز بعد إظهار التحميل 3.5 ثوانٍ.
    if (d.needs_verification) { await revealEmailVerificationAfterDelay(d, startedAt); return; }
    CHAT_TOKEN = d.tab_token || '';
    ME = d.user; MYBADGE = d.badge;
    closeOv('loginOv');
    onLoggedIn();
    connectSocketRetry();
    toast('مرحبا بك ' + ME.username + ' 👋');
  } catch (e) {
    $('#loginErr').textContent = e.error || 'فشل الدخول';
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
};
$('#doGuest').onclick = async () => {
  const btn = $('#doGuest');
  if (btn && btn.disabled) return;
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="f7-icons">arrow2_circlepath</i> جارٍ الدخول...';
  }
  try {
    const gender = $('#gGenderSel').value;
    let name = $('#gName').value.trim();
    if (!name) { const names = ['زائر', 'ضيف', 'نجم', 'عاشق', 'مغامر', 'رامي', 'فارس', 'همس', 'شهم', 'ذوق']; name = names[Math.floor(Math.random() * names.length)] + Math.floor(Math.random() * 900 + 100); }
    const d = await api('/api/guest', 'POST', { username: name, gender, ...VISIT_INFO });
    CHAT_TOKEN = d.tab_token || '';
    ME = d.user; MYBADGE = d.badge;
    closeOv('loginOv');
    onLoggedIn();
    connectSocketRetry();
    toast(d.guest_name_changed
      ? `الاسم ${d.requested_username} مسجل، تم دخولك كزائر باسم ${ME.username}`
      : 'أهلا بك كزائر ' + ME.username);
  } catch (e) {
    $('#loginErr').textContent = e.error || 'فشل الدخول';
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
};
$('#goRegister').onclick = () => { closeOv('loginOv'); openOv('regOv'); };
const gr2 = $('#goRegister2'); if (gr2) gr2.onclick = () => { closeOv('loginOv'); openOv('regOv'); };
$('#nrGo').onclick = () => { closeOv('needRegOv'); openOv('regOv'); };

// =====================================================
//  تفعيل الحساب برمز التحقق (Gmail)
// =====================================================
let PENDING_VERIFY = null;      // { token, email }
let VE_RESEND_UNTIL = 0;        // حتى هذه اللحظة لا يُسمح بإعادة الإرسال
let VE_COOLDOWN_TIMER = null;
const GMAIL_CLIENT_RE = /^[a-z0-9._%+-]+@gmail\.com$/i;

function showEmailVerification(email, token, sent, reason) {
  PENDING_VERIFY = { token: token || CHAT_TOKEN, email: email || '' };
  const el = $('#veEmail');
  if (el) el.textContent = email || '-';
  const code = $('#veCodeInput');
  if (code) code.value = '';
  const err = $('#veError');
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  if (sent === false) {
    if (err) { err.style.display = 'block'; err.textContent = (reason && reason.includes('smtp_disabled')) ? '⚠️ خدمة البريد (SMTP) غير مفعّلة من لوحة الإدارة — لم يُرسل الرمز بعد' : '⚠️ تعذر إرسال البريد: ' + (reason || ''); }
  }
  closeOv('loginOv');
  closeOv('regOv');
  closeOv('needRegOv');
  openOv('verifyEmailOv');
  setTimeout(() => { if (code) code.focus(); }, 80);
  startResendCooldown(0);
}
// لا يظهر قالب الرمز فجأة بعد الضغط على التسجيل؛ يبقى مؤشر التحميل
// من 3.5 ثوانٍ تقريباً ثم يُفتح القالب، مع احتساب زمن استجابة الخادم.
const EMAIL_VERIFY_REVEAL_MS = 3500;
async function revealEmailVerificationAfterDelay(data, startedAt) {
  showGlobalOperationLoading('جارٍ تجهيز قالب رمز التفعيل...');
  try {
    const elapsed = Date.now() - (startedAt || Date.now());
    await waitForOperation(Math.max(0, EMAIL_VERIFY_REVEAL_MS - elapsed));
    showEmailVerification(data.email, data.tab_token, data.verify_sent, data.verify_reason);
  } finally {
    hideGlobalOperationLoading();
  }
}
function startResendCooldown(seconds) {
  VE_RESEND_UNTIL = Date.now() + Math.max(0, seconds) * 1000;
  const btn = $('#veResendBtn');
  const label = $('#veResendLabel');
  if (VE_COOLDOWN_TIMER) clearInterval(VE_COOLDOWN_TIMER);
  const tick = () => {
    const left = Math.ceil((VE_RESEND_UNTIL - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(VE_COOLDOWN_TIMER); VE_COOLDOWN_TIMER = null;
      if (btn) btn.disabled = false;
      if (label) label.textContent = 'إعادة إرسال الرمز';
      return;
    }
    if (btn) btn.disabled = true;
    if (label) label.textContent = `إعادة الإرسال (${left}ث)`;
  };
  tick();
  VE_COOLDOWN_TIMER = setInterval(tick, 1000);
}
$('#veActivateBtn').onclick = async () => {
  if (!PENDING_VERIFY) return;
  const code = ($('#veCodeInput').value || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) {
    const err = $('#veError');
    if (err) { err.style.display = 'block'; err.textContent = 'أدخل رمز التفعيل المكوّن من 6 أرقام'; }
    return;
  }
  const btn = $('#veActivateBtn');
  btn.disabled = true;
  try {
    const token = PENDING_VERIFY.token;
    const r = await trackedFetch('/api/verify-email', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Chat-Client': '1', 'X-Chat-Token': token },
      body: JSON.stringify({ code })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw d;
    CHAT_TOKEN = d.tab_token || token;
    ME = d.user; MYBADGE = d.badge || badgeOf(ME);
    PENDING_VERIFY = null;
    closeOv('verifyEmailOv');
    onLoggedIn();
    connectSocketRetry();
    toast('تم تفعيل حسابك بنجاح 🎉');
  } catch (e) {
    const err = $('#veError');
    if (err) { err.style.display = 'block'; err.textContent = (e && e.error) || 'تعذر التفعيل — تحقق من الرمز'; }
  } finally { btn.disabled = false; }
};
$('#veResendBtn').onclick = async () => {
  if (!PENDING_VERIFY || Date.now() < VE_RESEND_UNTIL) return;
  try {
    const r = await trackedFetch('/api/resend-verify', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Chat-Client': '1', 'X-Chat-Token': PENDING_VERIFY.token },
      body: '{}'
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (d.wait) { startResendCooldown(d.wait); toast('يرجى الانتظار قبل إعادة الإرسال', false); }
      else toast(d.error || 'تعذر إعادة الإرسال', false);
      return;
    }
    toast(d.sent ? 'تم إرسال رمز جديد إلى جيميلك 📧' : (d.reason === 'smtp_disabled' ? '⚠️ خدمة البريد غير مفعّلة — لم يُرسل الرمز' : 'تعذر إرسال الرمز'), d.sent);
    startResendCooldown(60);
  } catch (e) { toast('تعذر إعادة الإرسال', false); }
};
$('#veChangeBtn').onclick = () => {
  PENDING_VERIFY = null;
  closeOv('verifyEmailOv');
  openOv('regOv');
};
$('#doRegister').onclick = async () => {
  const btn = $('#doRegister');
  if (btn && btn.disabled) return;
  const gender = $('#rGenderSel').value;
  const bio = $('#rBio') ? $('#rBio').value.trim() : '';
  const email = ($('#rEmail') ? $('#rEmail').value : '').trim().toLowerCase();
  if (!email) { $('#regErr').textContent = 'البريد الإلكتروني إلزامي لإتمام التسجيل'; return; }
  if (!GMAIL_CLIENT_RE.test(email)) { $('#regErr').textContent = 'البريد يجب أن يكون Gmail (ينتهي بـ @gmail.com)'; return; }

  const startedAt = Date.now();
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="f7-icons">arrow2_circlepath</i> جارٍ إنشاء الحساب...';
  }
  try {
    const d = await api('/api/register', 'POST', {
      username: $('#rUser').value.trim(), password: $('#rPass').value,
      gender, age: +$('#rAge').value || 25, bio, email, ...VISIT_INFO
    });
    // التسجيل يتطلب تفعيل البريد: يبقى مؤشر التحميل 3.5 ثوانٍ
    // ثم يظهر قالب إدخال الرمز الذي أُرسل إلى Gmail.
    if (d.needs_verification) { await revealEmailVerificationAfterDelay(d, startedAt); return; }
    CHAT_TOKEN = d.tab_token || '';
    ME = d.user; MYBADGE = d.badge;
    closeOv('regOv');
    onLoggedIn();
    connectSocketRetry();
    toast('تم تسجيل عضويتك بنجاح 🎉');
  } catch (e) {
    $('#regErr').textContent = e.error || 'فشل التسجيل';
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
};
function onLoggedIn() {
  // تحميل لون الخط المخصص المحفوظ في حساب العضو (يسري على كل الأجهزة).
  if (typeof syncMyColorFromProfile === 'function') syncMyColorFromProfile(ME);
  if (typeof applyMyColorToAppsButton === 'function') applyMyColorToAppsButton();
  // الهيدر: إخفاء زر الدخول وإظهار الصورة + الاسم
  $('#headEnterBtn').style.display = 'none';
  $('#headUserBox').style.display = 'flex';
  $('#headAva').innerHTML = avatarHtml(ME.avatar, '', frameOf(ME));
  syncInputBarAvatar();
  $('#headName').textContent = ME.username;
  $('#menuBal').textContent = ME.balance;
  loadIgnoredUsers();
  loadStatusOwners();      // دوائر الحالات حول الصور تظهر من أول تحميل
  loadUnreadNotifCount();
  loadUnreadPrivCount();   // شارة الخاص تعكس فوراً غير المقروء من الخادم بعد التحديث
  loadCustomEmojis();      // تُحمَّل صور الإيموجي بعد الدخول بالاسم (لا عند فتح الصفحة)
  armDesktopNotifyAsk();   // طلب إذن إشعارات سطح المكتب عند أول نقرة
  // أيقونة القائمة في التنقل السفلي تصبح صورة العضو
  // أيقونة القائمة في التنقل السفلي تصبح صورة العضو (استبدال كامل لتجنب التداخل)
  // شارة بيضاء صغيرة بأيقونة خطوط التنازلية — inline styles كما طلب التصميم
  const bm = $('#bnMenu');
  bm.innerHTML = `<span class="bn-ava" id="bnMenuIcon">${avatarHtml(ME.avatar, '', frameOf(ME))}<span style="color: rgb(110, 110, 115); justify-content: center; align-items: center; width: 15px; height: 15px; display: flex; position: absolute; bottom: -3.5px; right: -1.5px; background: rgb(255, 255, 255); border-width: 0px; border-style: none; border-color: currentcolor; border-image: none; border-radius: 50%;"><i aria-hidden="true" class="f7-icons" style="font-size: 10.5px;">line_horizontal_3_decrease_circle_fill</i></span></span><span>القائمة</span>`;
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
function closeNavPages(except) { ['privOv', 'notifOv', 'wallOv', 'menuOv', 'myGiftsOv', 'blocksOv'].forEach(id => { if (id !== except) closeOv(id); }); }
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
// ===== منع مغادرة الغرفة أثناء مكالمة أو بث مباشر =====
let PENDING_ROOM_ENTER = null; // الغرفة التي أراد المستخدم الانتقال إليها (تُفتح بعد إيقاف المكالمة/البث)
function inActiveCall() {
  return !!(PM_CALL && PM_CALL.state && PM_CALL.state !== 'ended');
}
function inActiveBroadcast() {
  return !!(BCAST && BCAST.isHost);
}
function exitBlockTagFor(mode) {
  if (mode === 'call') return 'مكالمة جارية';
  if (mode === 'both') return 'مكالمة وبث مباشر';
  return 'بث مباشر';
}
function showExitBlock(icon, title, msg, actionLabel, mode) {
  const card = $('#exitBlockCard');
  if (card) card.className = 'exit-block-card mode-' + mode;
  if ($('#exitBlockIc')) $('#exitBlockIc').textContent = icon;
  if ($('#exitBlockTitle')) $('#exitBlockTitle').textContent = title;
  if ($('#exitBlockBody')) $('#exitBlockBody').textContent = msg;
  const tag = $('#exitBlockTag');
  if (tag) tag.textContent = exitBlockTagFor(mode);
  const stopBtn = $('#exitBlockStop');
  if (stopBtn) {
    stopBtn.textContent = actionLabel;
    stopBtn.dataset.mode = mode;
  }
  openOv('exitBlockOv');
}
// يمنع الخروج إذا كانت هناك مكالمة أو بث جارٍ، ويعرض قالباً يوضح السبب
function attemptLeaveRoom() {
  const inCall = inActiveCall();
  const inBcast = inActiveBroadcast();
  if (!inCall && !inBcast) return openOv('exitOv');
  if (inCall && inBcast) {
    return showExitBlock(
      '🔴',
      'مكالمة وبث مباشر نشط',
      'لا يمكنك مغادرة الغرفة أثناء وجود مكالمة وبث مباشر. يمكنك إيقافهما معاً والخروج، أو الضغط على «حسناً» للبقاء.',
      'إيقاف البث والمكالمة',
      'both'
    );
  }
  if (inCall) {
    return showExitBlock(
      '📞',
      'مكالمة جارية',
      'لا يمكنك مغادرة الغرفة وأنت في مكالمة. يمكنك إنهاء المكالمة والخروج، أو الضغط على «حسناً» للبقاء.',
      'إيقاف المكالمة',
      'call'
    );
  }
  return showExitBlock(
    '📹',
    'بث مباشر نشط',
    'لا يمكنك مغادرة الغرفة وأنت تقوم بالبث المباشر. يمكنك إيقاف البث والخروج، أو الضغط على «حسناً» للبقاء.',
    'إيقاف البث',
    'bcast'
  );
}
// قالب تأكيد الانتقال: يظهر عند اختيار غرفة أخرى والمستخدم داخل غرفة حالياً.
// سطح المكتب فقط — على الهاتف يبقى الانتقال مباشراً كما كان تماماً.
const SWITCH_ROOM_MQ = '(min-width: 1024px)';
function canAskRoomSwitch() {
  return !!(window.matchMedia && window.matchMedia(SWITCH_ROOM_MQ).matches);
}
let SWITCH_ROOM_PENDING = 0;
function askRoomSwitch(roomId) {
  const r = ROOMS.find(x => x.id === +roomId);
  if (!r) return;
  SWITCH_ROOM_PENDING = +roomId;
  const nameEl = $('#switchRoomName');
  const descEl = $('#switchRoomDesc');
  const imgEl = $('#switchRoomImg');
  if (nameEl) nameEl.textContent = r.name || '';
  if (descEl) descEl.textContent = r.description || ('غرفة مستخدمين ' + (r.owner_name || ''));
  if (imgEl) {
    // الغرف بلا صورة تعرض الشعار الافتراضي بدل رابط مكسور
    if (r.image) { imgEl.src = thumbUrl(r.image, 92); imgEl.style.visibility = 'visible'; }
    else { imgEl.removeAttribute('src'); imgEl.style.visibility = 'hidden'; }
  }
  openOv('switchRoomOv');
}
// زر «نعم»: يغلق القالب ثم ينتقل فعلياً إلى الغرفة المختارة
const _srYes = $('#switchRoomYes');
if (_srYes) _srYes.onclick = () => {
  const id = SWITCH_ROOM_PENDING;
  SWITCH_ROOM_PENDING = 0;
  closeOv('switchRoomOv');
  if (id) attemptRoomSwitch(id, true);
};
const _srNo = $('#switchRoomNo');
if (_srNo) _srNo.onclick = () => { SWITCH_ROOM_PENDING = 0; };

// يمنع الانتقال إلى غرفة أخرى أثناء مكالمة أو بث — يعرض القالب، وبعد الإيقاف يدخل الغرفة المطلوبة
// confirmed=true يعني أن المستخدم وافق على قالب «دخول الى الغرفة المختارة»
function attemptRoomSwitch(roomId, confirmed = false) {
  // داخل غرفة وينتقل إلى غرفة أخرى: نسأله أولاً — على الكمبيوتر فقط
  if (!confirmed && canAskRoomSwitch() && CUR_ROOM && +roomId !== CUR_ROOM.id) return askRoomSwitch(+roomId);
  const inCall = inActiveCall();
  const inBcast = inActiveBroadcast();
  if (!inCall && !inBcast) return enterRoom(roomId);
  PENDING_ROOM_ENTER = roomId;
  if (inCall && inBcast) {
    return showExitBlock(
      '🔴',
      'مكالمة وبث مباشر نشط',
      'لا يمكنك الانتقال إلى غرفة أخرى أثناء وجود مكالمة وبث مباشر. يجب إغلاقهما أولاً ثم يمكنك الدخول إلى الغرفة الأخرى.',
      'إيقاف البث والمكالمة والمتابعة',
      'both'
    );
  }
  if (inCall) {
    return showExitBlock(
      '📞',
      'مكالمة جارية',
      'لا يمكنك الانتقال إلى غرفة أخرى أثناء مكالمة جارية. يجب إغلاق المكالمة أولاً ثم يمكنك الدخول إلى الغرفة الأخرى.',
      'إيقاف المكالمة والمتابعة',
      'call'
    );
  }
  return showExitBlock(
    '📹',
    'بث مباشر نشط',
    'لا يمكنك الانتقال إلى غرفة أخرى أثناء البث المباشر. يجب إغلاق البث أولاً ثم يمكنك الدخول إلى الغرفة الأخرى.',
    'إيقاف البث والمتابعة',
    'bcast'
  );
}
// زر «إيقاف البث/المكالمة»: يوقفه ثم يخرج المستخدم أو ينقله إلى الغرفة المقصودة
$('#exitBlockStop').onclick = () => {
  const mode = $('#exitBlockStop').dataset.mode;
  if (mode === 'call' || mode === 'both') {
    if (PM_CALL) endPrivateCall(true, 'ended');
  }
  if (mode === 'bcast' || mode === 'both') {
    if (BCAST && BCAST.isHost) bcastStopAsHost();
  }
  closeOv('exitBlockOv');
  if (PENDING_ROOM_ENTER) {
    const target = PENDING_ROOM_ENTER;
    PENDING_ROOM_ENTER = null;
    return enterRoom(target);
  }
  leaveRoom();
  showScreen('rooms');
};
// ======== خروج طارئ عند فتح «فحص العنصر» (DevTools) ========
// يستدعيه الحارس المضمّن في رأس index.html قبل تفريغ الصفحة، حتى تُغلق
// المكالمة/البث ويُبلغ الخادم بمغادرة الغرفة قبل اختفاء الصفحة.
window.NUJUM_EMERGENCY_EXIT = function devToolsEmergencyExit(reason) {
  if (window.__NUJUM_EXIT_DONE__) return;
  window.__NUJUM_EXIT_DONE__ = true;
  REFRESH_LEAVING = true;                 // إغلاق طارئ — بلا نافذة تأكيد المغادرة
  try { stopProfileVoiceAudio(); } catch (e) { }
  try { if (typeof stopProfileAudioStream === 'function') stopProfileAudioStream(); } catch (e) { }
  try { if (typeof closeVoiceRecorder === 'function' && $('#voiceRecorderOverlay') && !$('#voiceRecorderOverlay').classList.contains('hidden')) closeVoiceRecorder(); } catch (e) { }
  try { if (typeof radioStop === 'function') radioStop(); } catch (e) { }
  try { if (BCAST && BCAST.isHost && typeof bcastStopAsHost === 'function') bcastStopAsHost(); } catch (e) { }
  try { if (PM_CALL && typeof endPrivateCall === 'function') endPrivateCall(true, 'ended'); } catch (e) { }
  try { if (CUR_ROOM && SOCKET) SOCKET.emit('leave', CUR_ROOM.id); } catch (e) { }
  try { if (SOCKET) SOCKET.disconnect(); } catch (e) { }
  try {
    // إخفاء الواجهة فوراً ريثما تُغلق النافذة
    const frame = document.getElementById('frame');
    if (frame) frame.style.display = 'none';
    document.querySelectorAll('.overlay').forEach(o => o.classList.remove('open'));
  } catch (e) { }
};

let UNLOAD_CLEANED = false;
function silentCleanExitOnUnload() {
  if (UNLOAD_CLEANED) return;
  UNLOAD_CLEANED = true;
  // لا نمنع الإغلاق: نوقف الوسائط محلياً، والخادم ينظّف الغرفة عند انقطاع المقبس
  try { if (typeof closeVoiceRecorder === 'function' && $('#voiceRecorderOverlay') && !$('#voiceRecorderOverlay').classList.contains('hidden')) closeVoiceRecorder(); } catch (e) { }
  try { stopProfileVoiceAudio(); } catch (e) { }
  try { if (typeof radioStop === 'function') radioStop(); } catch (e) { }
  try { if (BCAST && BCAST.isHost && typeof bcastStopAsHost === 'function') bcastStopAsHost(); } catch (e) { }
  try { if (PM_CALL && typeof endPrivateCall === 'function') endPrivateCall(true, 'ended'); } catch (e) { }
  try { if (SOCKET) SOCKET.disconnect(); } catch (e) { }
}
// =====================================================
//  تأكيد المغادرة عند التحديث — نافذة المتصفح الأصلية (alert) قبل الخروج
// =====================================================
// المتصفحات الحديثة ترفض إظهار alert() مخصص النص داخل beforeunload؛ السبيل
// المعتمد الوحيد هو preventDefault + returnValue، وعندها يعرض Chrome/Edge/
// Firefox/Safari نافذتها الرسمية «هل تريد مغادرة الموقع؟» عند أي تحديث
// (F5/Ctrl+R/زر الإعادة) أو إغلاق أو خروج من الصفحة.
// إن قرر التطبيق نفسه إعادة التحميل (REFRESH_LEAVING) لا يُسأل المستخدم.
window.addEventListener('beforeunload', (e) => {
  if (REFRESH_LEAVING) { silentCleanExitOnUnload(); return; }
  e.preventDefault();
  e.returnValue = '';
  return '';
});
window.addEventListener('pagehide', (e) => {
  if (e && e.persisted) return;         // الصفحة في ذاكرة الرجوع/التقدّم
  silentCleanExitOnUnload();
});
$('#chatBack').onclick = () => { attemptLeaveRoom(); };
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
// ===== الزر العائم لقائمة المتصلين (بأسلوب 123flashchat) =====
// نقرة: تعرض قائمة المتصلين (وتخفي قائمة الغرف إن كانت مفتوحة)، ونقرة أخرى تخفيها.
function toggleUsersPanel() {
  if (!$('#usersPanel') || !$('#roomsPanel')) return;
  const usersOpen = $('#usersPanel').classList.contains('open');
  setUsersPanel(!usersOpen);
}
window.toggleUsersPanel = toggleUsersPanel;
// حركة الزر العائم: ما دامت قائمة المستخدمين أو قائمة الغرف مخفية يبقى في يمين الشاشة (right:5px)،
// وعند ظهور أيٍّ منهما يتحرك إلى الجهة اليسرى (ما يعادل left:45px) بحركة انسيابية، ثم يعود عند الإغلاق.
(() => {
  const usersPanel = $('#usersPanel'), roomsPanel = $('#roomsPanel');
  const fab = $('#topcmm-123flashchat'), screenEl = $('#chatScreen');
  if (!usersPanel || !roomsPanel || !fab || !screenEl) return;
  const place = () => {
    const anyOpen = usersPanel.classList.contains('open') || roomsPanel.classList.contains('open');
    fab.classList.toggle('is-open', anyOpen);
    if (anyOpen) {
      // left:45px تُترجم إلى قيمة right مكافئة بالبكسل ليسري transition الحركة على خاصية واحدة
      const w = screenEl.getBoundingClientRect().width;
      fab.style.right = Math.max(5, Math.round(w - 45 - fab.offsetWidth)) + 'px';
    } else {
      fab.style.right = '5px';
    }
  };
  new MutationObserver(place).observe(usersPanel, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(place).observe(roomsPanel, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', place);
  place();
})();

// ===== الراديو المباشر (كبسولة بنفس شكل زر المايك: تشغيل/إيقاف + الاسم) =====
// الاسم والرابط والتفعيل من لوحة الإدارة، ويتحدث فوراً مع كل مزامنة sync.
let RADIO_PLAYING = false;
let RADIO_RETRY_TIMER = null;
let RADIO_CONNECT_GUARD = null;   // يوقف دائرة التحميل بعد 30 ثانية إن لم يصل أي حدث
function radioCfg() {
  return {
    enabled: String(SETTINGS.radio_enabled) === '1',
    name: (SETTINGS.radio_name || '').trim() || '',
    url: (SETTINGS.radio_url || '').trim()
  };
}
// تُستدعى مع كل applySettings فتخفي/تظهر الكبسولة وتضبط الاسم والرابط لحظياً
function renderRadioPill() {
  const pill = $('#radioPill'); if (!pill) return;
  const cfg = radioCfg();
  const show = cfg.enabled && !!cfg.url;
  pill.hidden = !show;
  if (!show) { radioStop(true); return; }
  $('#radioName').textContent = cfg.name;
  pill.title = cfg.name + ' — اضغط للتشغيل/الإيقاف';
  const audio = $('#radioAudio');
  if ((audio.getAttribute('src') || '') !== cfg.url) {
    // رابط جديد من الإدارة: بدّله؛ إن كان يعمل أصلاً استمر بالتشغيل على الرابط الجديد
    const wasPlaying = RADIO_PLAYING;
    audio.src = cfg.url;
    if (wasPlaying) radioPlay();
  }
}
function radioClearConnectGuard() {
  if (RADIO_CONNECT_GUARD) { clearTimeout(RADIO_CONNECT_GUARD); RADIO_CONNECT_GUARD = null; }
}
function radioSetPlaying(playing) {
  RADIO_PLAYING = playing;
  radioClearConnectGuard();
  const pill = $('#radioPill'); if (!pill) return;
  pill.classList.toggle('is-playing', playing);
  pill.classList.remove('is-connecting');
  $('#radioIcon').textContent = playing ? 'stop_fill' : 'play_fill';
}
function radioPlay() {
  const cfg = radioCfg();
  const audio = $('#radioAudio');
  const pill = $('#radioPill');
  if (!audio || !pill || !cfg.url) return;
  if (RADIO_RETRY_TIMER) { clearTimeout(RADIO_RETRY_TIMER); RADIO_RETRY_TIMER = null; }
  if ((audio.getAttribute('src') || '') !== cfg.url) audio.src = cfg.url;
  audio.volume = 0.9;
  // دائرة التحميل على الزر: تبقى مرئية حتى يبدأ البث فعلياً (حدث playing)
  pill.classList.add('is-connecting');
  radioClearConnectGuard();
  RADIO_CONNECT_GUARD = setTimeout(() => { pill.classList.remove('is-connecting'); }, 30000);
  audio.load();
  audio.play().catch(() => {
    // سياسات التشغيل التلقائي بالمتصفحات: يلزم نقرة المستخدم نفسها
    pill.classList.remove('is-connecting');
    radioClearConnectGuard();
    toast('اضغط زر الراديو مرة أخرى للاستماع', true);
  });
}
function radioStop() {
  const audio = $('#radioAudio');
  if (!audio) return;
  if (RADIO_RETRY_TIMER) { clearTimeout(RADIO_RETRY_TIMER); RADIO_RETRY_TIMER = null; }
  radioClearConnectGuard();
  try { audio.pause(); } catch (e) { }
  radioSetPlaying(false);
}
function radioToggle() {
  if (RADIO_PLAYING) return radioStop();
  radioPlay();
}
(() => {
  const pill = $('#radioPill');
  if (!pill) return;
  const audio = $('#radioAudio');
  audio.volume = 0.9;
  pill.onclick = radioToggle;
  audio.addEventListener('playing', () => radioSetPlaying(true));
  audio.addEventListener('pause', () => { if (!audio.seeking) radioSetPlaying(false); });
  // انقطاع عرضي بالبث: إعادة محاولة واحدة تلقائية بعد لحظات
  audio.addEventListener('error', () => {
    if (!RADIO_PLAYING && !pill.classList.contains('is-connecting')) return;
    radioSetPlaying(false);
    if (RADIO_RETRY_TIMER) clearTimeout(RADIO_RETRY_TIMER);
    RADIO_RETRY_TIMER = setTimeout(() => { RADIO_RETRY_TIMER = null; radioPlay(); }, 3000);
  });
})();
function leaveRoom() {
  if (!$('#voiceRecorderOverlay').classList.contains('hidden')) closeVoiceRecorder();
  radioStop(); // الراديو مرتبط بشاشة الدردشة — يتوقف عند مغادرة الغرفة
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
  updateVoiceRoomBarUI();
  closeOv('usersPanel');
  setRoomsPanel(false);
  $('#roomsVeil').style.display = 'none';
}
$('#btnRoomUsers').onclick = () => setUsersPanel(!$('#usersPanel').classList.contains('open'));
// زر النقاط: قائمة خيارات الغرفة — نفس القالب على الهاتف والكمبيوتر
function closeRoomDrop() { $('#roomDrop').classList.remove('open'); $('#roomDropBg').style.display = 'none'; }
$('#btnRoomMore').onclick = (e) => {
  e.stopPropagation();
  const wipe = $('#dropWipeWelcome');
  if (canModerateRank()) {
    if (!wipe && window.__wipeWipeClone) {
      const parent = $('#dropHideWelcome').parentElement;
      if (parent) {
        const inserted = window.__wipeWipeClone.cloneNode(true);
        inserted.style.display = '';
        inserted.hidden = false;
        parent.appendChild(inserted);
      }
    } else if (wipe) {
      wipe.style.display = '';
      wipe.hidden = false;
    }
    const current = $('#dropWipeWelcome');
    if (current) window.__wipeWipeClone = current.cloneNode(true);
  } else {
    if (wipe) {
      window.__wipeWipeClone = wipe.cloneNode(true);
      wipe.style.display = 'none';
      wipe.hidden = true;
    }
  }
  $('#roomDropBg').style.display = 'block';
  $('#roomDrop').classList.toggle('open');
};
// حفظ نسخة من زر «حذف العام للجميع» لإعادة إدراجها عند إعادة الصلاحية
if ($('#dropWipeWelcome')) window.__wipeWipeClone = $('#dropWipeWelcome').cloneNode(true);
// «حذف العام لدي فقط»: تختفي الرسالة منه هو فقط (تُحفظ في حسابه)
$('#dropHideWelcome').onclick = async (e) => {
  e.stopPropagation();
  closeRoomDrop();
  if (!CUR_ROOM) return;
  try {
    await api(`/api/rooms/${CUR_ROOM.id}/hide-welcome`, 'POST');
    $$('#msgArea .room-welcome').forEach(el => el.remove());
    toast('تم حذف «العام» لديك فقط — يبقى ظاهراً لبقية المستخدمين');
  } catch (err) { toast((err && err.error) || 'تعذر حذف «العام»', false); }
};
// «حذف العام للجميع» للمشرفين: تفريغ الرسالة من الغرفة فتختفي عند الجميع
$('#dropWipeWelcome').onclick = async (e) => {
  e.stopPropagation();
  closeRoomDrop();
  if (!CUR_ROOM) return;
  if (!confirm('حذف «العام» نهائياً من هذه الغرفة لجميع المستخدمين؟')) return;
  try {
    await api(`/api/admin/rooms/${CUR_ROOM.id}/wipe-welcome`, 'POST');
    // مسح كل محتوى العام وإدراج قالب الحذف مع أيقونة المكنسة
    const msgArea = $('#msgArea');
    if (msgArea) {
      msgArea.innerHTML = `<div class="system-event leave">
  <div class="system-event-head skin_f2">
    <i class="icon f7-icons skin_color system-event-icon">speaker_3_fill</i>
    <span>رسالة النظام</span>
  </div>
  <div class="font_msg system-event-body">
    <div class="u-msg system-event-message">تم حذف العام من قبل ${(ME && ME.username) || 'السوبر أدمن'}</div>
  </div>
</div>`;
    }
    toast('تم حذف «العام» من الغرفة بالكامل 🧹 بواسطة ' + ((ME && ME.username) || 'السوبر أدمن') + ' ✅');
  } catch (err) { toast((err && err.error) || 'تعذر حذف «العام» للجميع', false); }
};
// (حدث welcome_cleared يُربط داخل connectSocket مع بقية أحداث السوكيت)
$('#btnLanguage').onclick = () => { setLanguage(APP_LANG, false); openOv('languageOv'); };

// ===== تغيير كلمة المرور (لحسابات مسجلة فقط) =====
$('#btnChangePassword').onclick = () => {
  if (!ME || !ME.registered) return;
  ['chpwCurrent', 'chpwNew', 'chpwConfirm'].forEach(id => { const el = $('#' + id); if (el) el.value = ''; });
  openOv('chpwOv');
  setTimeout(() => { const el = $('#chpwCurrent'); if (el) el.focus(); }, 260);
};
$('#chpwCancel').onclick = () => closeOv('chpwOv');
$('#chpwSubmit').onclick = async () => {
  if (!ME || !ME.registered) return closeOv('chpwOv');
  const cur = $('#chpwCurrent').value, nxt = $('#chpwNew').value, conf = $('#chpwConfirm').value;
  if (!cur) return toast('اكتب كلمة المرور الحالية', false);
  if (nxt.length < 4) return toast('كلمة المرور الجديدة يجب أن لا تقل عن 4 خانات', false);
  if (nxt !== conf) return toast('كلمتا المرور غير متطابقتين', false);
  const btn = $('#chpwSubmit');
  btn.disabled = true;
  try {
    const r = await api('/api/chat/change-password', 'POST', { current: cur, next: nxt });
    if (r && r.ok) { toast('تم تغيير كلمة المرور بنجاح ✅'); closeOv('chpwOv'); }
    else toast((r && r.error) || 'تعذر تغيير كلمة المرور', false);
  } catch (e) {
    toast((e && e.error) || 'تعذر تغيير كلمة المرور', false);
  }
  btn.disabled = false;
};
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
$('#dropLeaveRoom').onclick = () => { closeRoomDrop(); attemptLeaveRoom(); };
$('#dropRefreshRooms').onclick = async () => { closeRoomDrop(); await loadRooms(); toast('تم تحديث قائمة الغرف ✓'); };
// حبة المايك: قائمة الحالة السريعة

$('#userSearch').oninput = renderUsers;
['#roomSearch','#roomSearch2','#userSearch'].forEach(sel => { const t = $(sel); if (t) t.onkeydown = e => { if (e.key === 'Enter') e.preventDefault(); }; });

// تم حذف تبويبَي «الافتراضية / الصوتية» — جميع الغرف صوتية بشكل دائم.
$('#roomSearch').oninput = renderRooms;
$('#roomSearch2').oninput = renderRoomsPanel;

// الإرسال
$('#btnSend').onclick = sendMsg;

const msgInput = document.getElementById('msgInput');

msgInput.onkeydown = function(e) {
    if (e.key === 'Enter') {
        e.preventDefault();

        sendMsg();

        this.value = '';
    }
};
function sendMsg() {
  if (!ME) return openLogin();
  if (!CUR_ROOM) return toast('اختر غرفة أولا', false);
  const t = $('#msgInput').value.trim();
  if (!t) return;
  const maxLength = Math.max(1, Math.min(5000, +(SETTINGS.msg_max || 500)));
  const actualLength = Array.from(t).length;
  if (actualLength > maxLength) {
    return showMessageLengthTemplate({
      max_length: maxLength,
      actual_length: actualLength,
      attempted_text: t,
      room_id: CUR_ROOM.id
    });
  }
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
// منتقي الإيموجي يُبنى كسولاً: لا تُحمَّل صور الإيموجي (GIF ثقيلة أحياناً) عند فتح
// الصفحة، ولا حتى بعد فتح اللوحة قبل تسجيل الدخول — تُجلب فقط بعد الدخول بالاسم.
let EMOJI_GRID_DIRTY = true;
let EMOJI_LOADED = false;
function renderEmojiPicker() {
  const grid = $('#emojiGrid');
  if (!grid) return;
  grid.innerHTML = CUSTOM_EMOJIS.length
    ? CUSTOM_EMOJIS.map(e => `<img class="custom-emoji-choice" src="${esc(e.img)}" data-id="${e.id}" alt="emoji" loading="lazy" decoding="async">`).join('')
    : '<div class="custom-emoji-empty">لا توجد إيموجيات مرفوعة حالياً</div>';
  $$('#emojiGrid .custom-emoji-choice').forEach(im => im.onclick = () => {
    if (!ME) return openLogin();
    const isPrivateOpen = $('#pmOv') && $('#pmOv').classList.contains('open');
    if (!isPrivateOpen && !CUR_ROOM) return toast('اختر غرفة أولا', false);
    if (isPrivateOpen && !PM_WITH) return toast('اختر مستخدماً أولاً', false);
    insertCustomEmojiToken(im.dataset.id);
    $('#emojiPanel').classList.remove('open');
  });
  EMOJI_GRID_DIRTY = false;
}
function ensureEmojiPickerRendered() {
  // لا نُحمّل صور الإيموجي قبل تسجيل الدخول بالاسم (طلب المالك).
  if (!ME) return;
  if (!EMOJI_LOADED) { loadCustomEmojis(); return; }
  if (EMOJI_GRID_DIRTY) renderEmojiPicker();
}
async function loadCustomEmojis(force) {
  if (!ME || (EMOJI_LOADED && !force)) return;
  const grid = $('#emojiGrid');
  if (grid && !EMOJI_LOADED) grid.innerHTML = '<div class="custom-emoji-empty">جارٍ تحميل الإيموجي...</div>';
  try { CUSTOM_EMOJIS = await api('/api/emojis'); } catch (e) { CUSTOM_EMOJIS = []; }
  EMOJI_LOADED = true;
  EMOJI_GRID_DIRTY = true;
  // نبني اللوحة الآن فقط إن كانت مفتوحة أمام المستخدم؛ وإلا تُبنى عند فتحها.
  if ($('#emojiPanel') && $('#emojiPanel').classList.contains('open')) renderEmojiPicker();
}
api('/api/gifts').then(g => { GIFTS = g; }).catch(() => { });   // تحميل مسبق لقائمة الهدايا
// قائمة الألوان — تغيير لون خط رسائلي (يُحفظ على جهازي)
// لوحة الألوان (درجات Material) تُعرض كنقاط دائرية في منتقي الألوان.
const TEXT_COLORS = [
  '#e57373','#ef5350','#f44336','#e53935','#d32f2f','#c62828','#800c03','#ba68c8','#ab47bc','#9c27b0','#8e24aa','#7b1fa2','#6a1b9a','#4a148c',
  '#f8a8b7','#fc93ac','#f57a9b','#ff6991','#f74877','#fa3468','#fa224a','#7986cb','#5c6bc0','#3f51b5','#3949ab','#303f9f','#283593','#1a237e',
  '#4fc3f7','#29b6f6','#03a9f4','#039be5','#0288d1','#0277bd','#01579b','#4db6ac','#26a69a','#009688','#00897b','#00796b','#00695c','#004d40',
  '#aed581','#9ccc65','#8bc34a','#7cb342','#689f38','#558b2f','#33691e','#fff176','#ffee58','#ffeb3b','#fdd835','#fbc02d','#f9a825','#f57f17',
  '#ffb74d','#ffa726','#ff9800','#fb8c00','#f57c00','#ef6c00','#e65100','#ac5022','#9a461c','#8c3f18','#7b3714','#632c11','#4b220d','#38190a',
  '#000000','#131313','#3d3c3c','#4d4b4b','#5b5757','#6c6a6a','#7a7777','#333333','#666666','#ff0000','#0000ff','#6600ff','#336666','#9900ff',
  '#000066','#336600','#ff0066','#663333','#cc6600','#ff6600','#996600','#0066cc','#009966','#ffcc00','#666600','#339900','#ff3366','#993366',
  '#6666ff','#ff9900','#999900','#003399','#9966ff','#cc3399','#ff0099','#663366','#198139','#ff3333','#800080','#6699ff','#666699','#993300',
  '#000033','#669933','#cc99ff','#ff00cc','#cc3366','#339933','#ff66ff','#800000','#663300','#ff00ff','#ff9966','#330099','#cc9900','#993333',
  '#660000','#00cc33','#ff6699','#ff3478'
];
let MY_COLOR = localStorage.getItem('njc_color') || '';
// مزامنة لون الخط المخصص من حساب العضو (يُحمَّل من الخادم ليبقى ثابتاً على كل الأجهزة).
function syncMyColorFromProfile(u) {
  if (!u) return;
  // لون العضو المحفوظ إلزامي إن وُجد؛ وإلا نبقيه على ما في المتصفح (لحالة الزائر/الاحتياط).
  if (u.color) MY_COLOR = u.color;
  else if (ME && u.registered) MY_COLOR = u.color || '';   // عضو مسجّل بلا لون محفوظ = «تلقائي»
  applyMyColorToAppsButton();
}
// عكس اللون المختار/المحفوظ على أيقونة زر قائمة الألوان (btnApps).
// اللون «تلقائي» يجعلها ترجع للون سمة التصميم الافتراضي.
function applyMyColorToAppsButton() {
  const icon = $('#btnApps i');
  if (!icon) return;
  if (MY_COLOR) icon.style.color = MY_COLOR;
  else icon.style.color = '';   // يقع على CSS الافتراضي: var(--njomarab-theme-color)
}
function renderColorGrid() {
  $('#colorGrid').innerHTML = `<button class="csw auto${MY_COLOR === '' ? ' sel' : ''}" data-c="">تلقائي</button>` +
    TEXT_COLORS.map(c => `<button class="csw${MY_COLOR === c ? ' sel' : ''}" data-c="${c}" style="background:${c}"></button>`).join('');
  $$('#colorGrid .csw').forEach(b => b.onclick = async () => {
    MY_COLOR = b.dataset.c;
    localStorage.setItem('njc_color', MY_COLOR);
    renderColorGrid();
    applyMyColorToAppsButton();
    $('#colorPanel').classList.remove('open');
    toast(MY_COLOR ? 'تم تغيير لون خطك 🎨' : 'رجع لون خطك للون رتبتك');
    // حفظ اللون في حساب العضو المسجل كي يبقى عند الدخول من أي جهاز.
    if (ME && ME.registered) {
      try { const d = await api('/api/color', 'POST', { color: MY_COLOR }); if (ME) ME.color = d.color || MY_COLOR; } catch (e) { }
    }
  });
}
renderColorGrid();
$('#btnEmoji').onclick = (e) => {
  e.stopPropagation();
  $('#colorPanel').classList.remove('open');
  const ep = $('#emojiPanel');
  ep.classList.remove('pm-mode');
  ensureEmojiPickerRendered();
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
// زر «تحدث» بجانب زر الميكروفون: في الغرفة الصوتية يصعد بي كمذيع (بث صوتي).
// إن كنت مذيعاً بالفعل يفتح شاشة بثي العائمة، تماماً كما كان يفعل زر «بث صوتي» العلوي.
$('#btnTalkLive').onclick = () => {
  if (!ME) return openLogin();
  if (!CUR_ROOM || CUR_ROOM.type !== 'voice') return;
  if (BCAST && BCAST.isHost && BCAST.roomId === CUR_ROOM.id) return openOv('bcastOv');
  bcastOpenStartConfirm('audio');
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
// صورتي في شريط الإدخال: نقرة عليها تفتح نافذة «تغيير الصورة» نفسها
// المستعملة من القائمة — بنفس شرط التسجيل.
const ciAvaEl = $('#ciAva');
if (ciAvaEl) ciAvaEl.onclick = () => {
  if (!ME) return openOv('loginOv');
  if (!ME.registered) return openOv('needRegOv');
  openAvatars();
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
  ensureEmojiPickerRendered();
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
$$('.overlay:not(.full)').forEach(ov => ov.addEventListener('click', e => { if (e.target === ov) { ov.classList.remove('open'); syncSheetScale(); } }));

var zise3 = 0;
var zise4 = 0; 
function activeresize() {
    zise3 = 1;
    navigator.virtualKeyboard.show();
    if ("virtualKeyboard" in navigator) {
    navigator.virtualKeyboard.overlaysContent = true;
    navigator.virtualKeyboard.addEventListener("geometrychange", event => {
        const { x, y, width, height } = event.target.boundingRect;
        zise4 = height;
        const xbod1Style = document.getElementById("frame");
        if (height === 0) {
            xbod1Style.style.height = "calc(100% - 2px)";
        } else {
            xbod1Style.style.height = (window.innerHeight - height) - 0 + 'px';
        }
    
    });
}
}

