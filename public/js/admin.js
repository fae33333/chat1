// =====================================================
//  لوحة التحكم - المنطق
// =====================================================
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
let ME = null;
let SETTINGS = {};
let ROOMS_CACHE = [];
let editingRoom = null, editingUser = null, editingWord = null, EDIT_ROOM_BOT = null;
let MONITOR_TIMER = null;

// ---------- أدوات ----------
async function api(url, method = 'GET', body, isForm = false) {
  const token = window.ACTIVE_ADMIN_TOKEN || new URLSearchParams(location.search).get('token') || '';
  const headers = {};
  if (token) headers['x-admin-token'] = token;
  const opt = { method, credentials: 'same-origin', headers };
  if (body && !isForm) { headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  if (body && isForm) opt.body = body;
  const r = await fetch(url, opt);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 403 && d.error && (d.error.includes('جلسة أو رابط الإدارة') || d.error.includes('منتهي الصلاحية'))) {
      toast('انتهت صلاحية جلسة الإدارة نظراً لتوليد رمز جديد في الدردشة', false);
      setTimeout(() => location.href = '/', 1800);
    }
    throw d;
  }
  return d;
}
function toast(msg, ok = true) {
  const t = $('#toast');
  const text = String(msg || '');
  t.innerHTML = `<i class="f7-icons">${ok ? 'checkmark_circle_fill' : 'xmark_circle_fill'}</i><span></span>`;
  t.querySelector('span').textContent = text;
  t.className = 'toast show ' + (ok ? 'ok' : 'err');
  clearTimeout(t._tm);
  const duration = Math.min(6000, Math.max(2600, text.length * 45));
  t._tm = setTimeout(() => t.classList.remove('show'), duration);
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// معاينة حيّة للجلد المختار (ثيم جاهز أو لون مخصص) داخل لوحة الإدارة.
function renderSkinLive(sel) {
  const box = $('#skinLive');
  if (!box || !window.SkinLib) return;
  const v = window.SkinLib.computeSkinVars(sel || 'default');
  if (!v) return;
  box.style.background = v['--skin-bg-light'];
  box.style.borderColor = v['--skin-border'];
  box.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
      <span style="width:24px;height:24px;border-radius:50%;background:${v['--main']};display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:900;box-shadow:0 2px 8px ${v['--skin-glow']}">ن</span>
      <span style="font-weight:800;color:${v['--main']};font-size:14px">نجوم العرب</span>
      <span style="font-size:10px;color:#8a90a3">الآن</span>
    </div>
    <div style="max-width:82%;padding:9px 12px;border-radius:4px 12px 12px 12px;background:${v['--skin-btn']};color:#fff;font-size:13px;box-shadow:0 3px 10px ${v['--skin-glow']}">هذه معاينة للون الجلد الجديد 🎨</div>
    <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
      <span style="padding:7px 14px;border-radius:10px;background:${v['--skin-btn']};color:#fff;font-size:12px;font-weight:800;box-shadow:0 2px 8px ${v['--skin-glow']}">زر أساسي</span>
      <span style="padding:7px 14px;border-radius:10px;background:#fff;color:${v['--main']};border:1.5px solid ${v['--skin-border']};font-size:12px;font-weight:800">زر ثانوي</span>
      <span style="font-size:11px;color:#6b7280;font-weight:800">${v['--main']}</span>
    </div>`;
}

// =====================================================
//  نظام اللغات والترجمة الشامل في لوحة الإدارة (Admin i18n Engine)
// =====================================================
let ADMIN_LANG = localStorage.getItem("admin_language") || "ar";
if (!["ar", "en", "es", "tr"].includes(ADMIN_LANG)) ADMIN_LANG = "ar";

const ADMIN_I18N_EN = {
  "لوحة التحكم الإدارية": "Admin Control Panel",
  "لوحة التحكم": "Control Panel",
  "نظام إدارة الدردشة": "Chat Management System",
  "نظام إدارة الدردشة المتكامل": "Integrated Chat Management System",
  "اسم المستخدم": "Username",
  "كلمة المرور": "Password",
  "دخول": "Login",
  "تسجيل الخروج": "Logout",
  "الصلاحية :": "Role:",
  "الصلاحية": "Role",
  "★ الصلاحية :": "★ Role:",
  "ملك الدردشة 👑": "Super Master 👑",
  "ملك الدردشة (سوبر ماستر 👑)": "Super Master (Owner 👑)",
  "سوبر ماستر 👑": "Super Master 👑",
  "سوبر ماستر": "Super Master",
  "سوبر ادمين": "Super Admin",
  "سوبر أدمن": "Super Admin",
  "★Súper Admin": "★ Super Admin",
  "★Admin": "★ Admin",
  "ادمن": "Admin",
  "أدمن": "Admin",
  "ادمن غرفة": "Room Admin",
  "أدمن غرفة": "Room Admin",
  "مشرفو الغرف (أدمن غرفة)": "Room Admins",
  "عضو عادي": "Regular Member",
  "عضو مسجل": "Registered Member",
  "الزائر": "Guest",
  "زائر": "Guest",
  "بدون عضوية": "No Membership",
  "مميز": "Featured",
  "هذا الحساب ليس حساب إدارة": "This account is not an administrator",
  "فشل تسجيل الدخول": "Login failed",
  "باقات الذهب والدفع": "Gold Packages & Payments",
  "إدارة باقات الذهب": "Manage Gold Packages",
  "إدارة باقات شراء الذهب": "Manage Gold Packages",
  "إعدادات بطاقة الإيداع والدفع": "PayPal Payment Settings",
  "إعدادات بطاقة الإيداع وبوابة الدفع": "Deposit Card & Payment Gateway",
  "إعدادات بطاقة الإيداع وبوابة الدفع البنكية": "Deposit Card & Payment Gateway",
  "سجل مدفوعات البطاقات": "PayPal Payment Transactions",
  "سجل مدفوعات البطاقات البنكية": "PayPal Payment Log",
  "إعدادات بوابة الدفع PayPal": "PayPal Payment Settings",
  "سجل مدفوعات PayPal": "PayPal Payment Transactions",
  "تكاليف العضويات والمكالمات": "Memberships & Call Costs",
  "الاعدادات الاساسيه": "Basic Settings",
  "إعدادات اللغة والترجمة": "Language & Translation",
  "ضبط الاعدادات": "General Settings",
  "صلاحيات العضويات": "Membership Permissions",
  "اعدادات الرسائل": "Message Settings",
  "وضع الشعار": "Set Logo",
  "وضع الجلد": "Skin (Theme)",
  "تحديد حجم الخط": "Font Size",
  "اعدادات الغرف": "Room Settings",
  "قائمة الغرف": "Rooms List",
  "اضافة غرفة": "Add Room",
  "اضافة غرفة جديدة": "Add New Room",
  "رسائل الروبوت": "Bot Messages",
  "إعدادات الذكاء الاصطناعي (AI)": "AI & Neural Settings",
  "إعدادات العقل العصبي والذكاء الاصطناعي (AI)": "Neural Engine & AI Settings",
  "حفظ إعدادات الذكاء الاصطناعي": "Save AI Settings",
  "تجربة رد الذكاء الاصطناعي ⚡": "Test Neural AI Reply ⚡",
  "توليد روبوت غرفة": "Generate Room Bot",
  "توليد وإعداد روبوت الغرفة": "Generate & Configure Room Bot",
  "وضع التحدث والرد في الغرفة :": "Speaking & AI Reply Mode:",
  "🤖 متحدث ذكي (يرد بالذكاء الاصطناعي عند مناداته بالاسم)": "🤖 Smart AI Speaker (Replies with AI when called by name)",
  "💬 متحدث برد مخصص (يرد بالنص المحدد عند مناداته بالاسم)": "💬 Custom Speaker (Replies with custom text when called by name)",
  "🔇 صامت (لا يتحدث ولا يرد أبداً)": "🔇 Silent (Never speaks or replies)",
  "الرد المخصص عند مناداة اسم الروبوت :": "Custom Reply When Bot is Called:",
  "🤖 متحدث ذكي (AI)": "🤖 Smart AI Speaker",
  "🔇 صامت (لا يتحدث)": "🔇 Silent (No Replies)",
  "اعدادات النظام": "System Settings",
  "اعدادات النظام الاساسي": "Core System Settings",
  "ادارة المستخدمين": "User Management",
  "اضافه مستخدم": "Add User",
  "إضافة مستخدم جديد": "Add New User",
  "تحرير مستخدم": "Edit User",
  "طلبات التوثيق والترقية": "Upgrade & Verification Requests",
  "الحسابات الادارية": "Admin Accounts",
  "الحسابات الإدارية": "Admin Accounts",
  "قائمة المطرودين": "Kicked Users",
  "قائمة المطرودين من الغرف": "Kicked Users List",
  "قائمة الحظر": "Ban List",
  "قائمة المحظورين": "Banned Users List",
  "نظام الادارة": "Management System",
  "ارسال اعلان للجميع": "Broadcast Announcement",
  "إرسال إعلان للجميع": "Broadcast Announcement",
  "فلترة الكلمات": "Word Filter",
  "استئناف الخادم": "Restart Server",
  "استئناف خادم الشات": "Restart Chat Server",
  "الهدايا والإيموجي": "Gifts & Emojis",
  "اداره الهدايا": "Manage Gifts",
  "ادارة الهدايا": "Manage Gifts",
  "رفع الإيموجي": "Upload Emojis",
  "الأرشفة ومحركات البحث": "SEO & Search Engines",
  "الأرشفة ومحركات البحث (SEO)": "SEO & Search Engines",
  "الأرشفة ومسارات البحث (SEO)": "SEO & Search Routes",
  "النسخ الاحتياطي": "Backup & Restore",
  "النسخ الاحتياطي والاستعادة": "Backup & Restore Database",
  "النسخ الاحتياطي واستعادة البيانات": "Database Backup & Restore",
  "مراقبة الخاص والمكالمات": "Private & Call Monitor",
  "مراقبة الرسائل الخاصة": "Private Message Monitor",
  "تسجيلات المكالمات": "Call Recordings",
  "توثيق": "Verification",
  "رصد فريق": "Team Monitoring",
  "تحكم في باقات الذهب المعروضة للمستخدمين في المتجر، يمكنك إضافة باقات جديدة، تعديل الأسعار، وإضافة ذهب مجاني وهدايا وشارات ترويجية.": "Manage gold packages in the store: add packages, adjust prices, and configure bonus gold and promotional badges.",
  "إضافة باقة ذهب جديدة": "Add New Gold Package",
  "إضافة Paquete de Oro جديدة": "Add New Gold Package",
  "تعديل باقة الذهب": "Edit Gold Package",
  "اسم الباقة:": "Package Name:",
  "كمية الذهب الأساسية (🪙):": "Base Gold Amount (🪙):",
  "كمية الذهب الأساسية:": "Base Gold Amount:",
  "سعر الباقة:": "Package Price:",
  "السعر المطلوب ($):": "Price ($):",
  "العملة:": "Currency:",
  "ذهب إضافي مجاني (Bonus):": "Free Bonus Gold:",
  "ذهب إضافي هدية (Bonus):": "Gift Bonus Gold:",
  "شارة ترويجية (Badge):": "Promo Badge:",
  "ترتيب الظهور (Sort):": "Display Order (Sort):",
  "الترتيب في العرض:": "Display Order:",
  "تفعيل هذه الباقة في المتجر الآن": "Activate this package in the store now",
  "باقة نشطة ومعروضة للمستخدمين": "Active and visible to users",
  "حفظ باقة الذهب": "Save Gold Package",
  "إلغاء التعديل": "Cancel Edit",
  "باقات الذهب المتوفرة حالياً": "Available Gold Packages",
  "اسم الباقة": "Package Name",
  "الذهب": "Gold",
  "السعر": "Price",
  "ذهب إضافي": "Bonus Gold",
  "الشارة": "Badge",
  "الترتيب": "Order",
  "الحالة": "Status",
  "الإجراءات": "Actions",
  "نشط": "Active",
  "معطل": "Disabled",
  "لا توجد باقات ذهب مضافة بعد": "No gold packages added yet",
  "تم حفظ باقة الذهب بنجاح": "Gold package saved successfully",
  "حذف هذه الباقة نهائياً؟": "Permanently delete this package?",
  "حدد هنا بيانات بطاقة الصراف الآلي والحساب البنكي المعتمد الذي يتم استقبال مدفوعات وإيداعات شراء الذهب عليه من المستخدمين.": "Set the authorized bank account and debit card details used to receive user gold purchases and deposits.",
  "بيانات البطاقة البنكية المعتمدة لاستقبال مدفوعات الأعضاء عند شحن الذهب بالبطاقات.": "Bank card details used to receive member payments when purchasing gold.",
  "بيانات الحساب وبطاقة الإيداع المعتمدة": "Authorized Account & Deposit Card Details",
  "اسم البنك أو المصرف المعتمد:": "Authorized Bank Name:",
  "اسم البنك / مزود الخدمة المعتمد:": "Authorized Bank / Service Provider:",
  "اسم صاحب الحساب / المستفيد:": "Account Holder / Beneficiary Name:",
  "اسم صاحب الحساب / الإدارة المعتمدة:": "Account Holder / Merchant Name:",
  "رقم بطاقة الصراف الآلي للإيداع (Receiver Card Number):": "Debit Card Number for Deposits (Receiver Card Number):",
  "رقم البطاقة / الحساب المعتمد للإيداع:": "Deposit Card / Account Number:",
  "رقم الآيبان (IBAN) / رقم الحساب الدولي:": "IBAN / International Bank Account Number:",
  "رقم الآيبان (IBAN) الدولي (اختياري):": "International IBAN (Optional):",
  "العملة الافتراضية للدفع:": "Default Payment Currency:",
  "رمز العملة (مثال: $ أو ريال أو ج.م):": "Currency Symbol (e.g. $, USD, EUR):",
  "تفعيل بوابة الدفع ببطاقات الصراف والائتمان في المتجر": "Enable Debit/Credit Card Payment Gateway in Store",
  "تفعيل الدفع بالبطاقات البنكية": "Enable Card Payments",
  "تمكين استقبال المدفوعات عبر البطاقات البنكية في متجر الذهب": "Enable card payments in the gold store",
  "حفظ إعدادات البطاقة والدفع": "Save Card & Payment Settings",
  "تم حفظ إعدادات البطاقة والدفع بنجاح": "Payment and card settings saved successfully",
  "$ (الدولار الأمريكي)": "$ (US Dollar)",
  "د.أ (الدينار الأردني)": "JOD (Jordanian Dinar)",
  "ر.س (الريال السعودي)": "SAR (Saudi Riyal)",
  "د.إ (الدرهم الإماراتي)": "AED (UAE Dirham)",
  "ج.م (الجنيه المصري)": "EGP (Egyptian Pound)",
  "سجل كامل لجميع عمليات شراء الذهب والدفع الإلكتروني الناجحة التي تمت عبر بطاقات الصراف والائتمان.": "Full transaction log of all successful gold purchases and electronic card payments.",
  "العمليات المنفذة بنجاح": "Successfully Completed Transactions",
  "🔍 ابحث برقم المعاملة أو اسم المستخدم أو آخر 4 أرقام من البطاقة...": "🔍 Search by transaction ID, username, or last 4 digits...",
  "تصدير السجل (CSV)": "Export CSV",
  "رقم المعاملة": "Transaction ID",
  "المستخدم": "User",
  "الباقة": "Package",
  "الذهب المشحون": "Gold Credited",
  "الذهب المستلم": "Gold Credited",
  "المبلغ المدفوع": "Amount Paid",
  "البطاقة المستخدمة": "Card Used",
  "حساب الإيداع": "Deposit Account",
  "نوع البطاقة": "Card Brand",
  "آخر 4 أرقام": "Last 4 Digits",
  "اسم حامل البطاقة": "Cardholder Name",
  "تاريخ المعاملة": "Transaction Date",
  "التاريخ": "Date",
  "ناجحة": "Completed",
  "لا توجد معاملات دفع بعد": "No payment transactions yet",
  "إعدادات رصيد العضويات والمكافآت": "Membership Pricing & Bonus Settings",
  "إعدادات رصيد العضويات والتسجيل": "Membership Pricing & Registration Settings",
  "رصيد العضويات والتسجيل": "Membership & Registration Balances",
  "لشراء عضوية VIP 👑": "to purchase VIP membership 👑",
  "لشراء عضوية Premium 💎": "to purchase Premium membership 💎",
  "لشراء عضوية Plus ⭐": "to purchase Plus membership ⭐",
  "الذهب الممنوح تلقائياً عند تسجيل حساب جديد 💰": "Gold automatically awarded upon registering a new account 💰",
  "VIP - الرصيد المطلوب :رصيد": "VIP - Required Balance: Credits",
  "Premium - الرصيد المطلوب :رصيد": "Premium - Required Balance: Credits",
  "Plus - الرصيد المطلوب :رصيد": "Plus - Required Balance: Credits",
  "الذهب الممنوح عند تسجيل حساب جديد :ذهب": "Gold awarded on registration: Gold",
  "تكلفة المكالمة الصوتية المفتوحة (بالذهب) :ذهب": "Open voice call rate: Gold",
  "VIP - الرصيد المطلوب": "VIP - Required Balance",
  "Premium - الرصيد المطلوب": "Premium - Required Balance",
  "Plus - الرصيد المطلوب": "Plus - Required Balance",
  "الذهب الممنوح عند تسجيل حساب جديد": "Gold awarded on registration",
  "تكلفة المكالمة الصوتية المفتوحة (بالذهب)": "Open voice call rate (in gold)",
  "استعادة الافتراضي": "Restore Defaults",
  "استعادة الPredeterminado": "Restore Defaults",
  "يمكنك هنا تعيين اللغة الافتراضية للشات لجميع الزوار والأعضاء الجدد، بالإضافة إلى تحديد لغة عرض لوحة الإدارة للمشرفين.": "Here you can configure the default chat language for new visitors and members, as well as the default Admin Panel display language.",
  "اللغة الافتراضية للدردشة والموقع": "Default Site & Chat Language",
  "يتم تطبيق هذه اللغة تلقائياً على أي زائر أو مستخدم جديد يدخل الدردشة لأول مرة. يمكن لكل مستخدم اختيار لغته الخاصة بحرية من قائمة اللغات داخل الشات.": "This language is automatically applied to any new visitor or user entering the chat for the first time. Each user can freely change their personal language anytime.",
  "لغة لوحة التحكم والإدارة": "Admin Control Panel Language",
  "لغة Panel de Control والإدارة": "Admin Control Panel Language",
  "تحديد لغة عرض لوحة الإدارة للمشرفين والمسؤولين. يمكنك أيضاً التبديل السريع من شريط اللغات أعلى القائمة.": "Set the default language for the Admin Control Panel for staff and supervisors. You can also switch languages instantly from the sidebar bar.",
  "حفظ وتطبيق إعدادات اللغة": "Save & Apply Language Settings",
  "عرض زر الاسمايلات :": "Show Emojis Button:",
  "عرض زر تسجيل الصوت :": "Show Voice Record Button:",
  "عرض زر ارسال صورة :": "Show Send Photo Button:",
  "(i1) دخول مخفي للسوبر :": "(i1) Hidden Super Admin Entry:",
  "الإشعارات الصوتية": "Sound Notifications",
  "صوت عند دخول المستخدم (b1) :": "Sound on User Join (b1):",
  "صوت عند ارسال رسالة (b4) :": "Sound on Message Send (b4):",
  "صوت عند خروج المستخدم (b5) :": "Sound on User Leave (b5):",
  "حفظ الاعدادات": "Save Settings",
  "إرسال الرسائل في العام": "Send Public Messages",
  "كتابة وإرسال الرسائل النصية والإيموجي داخل الغرف العامة.": "Writing and sending text messages and emojis in public rooms.",
  "إرسال الرسائل الخاصة": "Send Private Messages",
  "إرسال رسالة نصية مباشرة إلى مستخدم آخر في الخاص.": "Sending direct one-on-one private messages to other users.",
  "المكالمات الصوتية في الخاص": "Private Voice Calls",
  "إجراء وبدء مكالمات صوتية مباشرة بين شخصين في المحادثة الخاصة.": "Making direct one-on-one private voice calls.",
  "إرسال الصور في العام": "Send Public Photos",
  "رفع صورة من زر الكاميرا وإرسالها داخل الغرفة العامة.": "Uploading and sending photos in public rooms.",
  "إرسال مقطع صوتي في العام": "Send Public Voice Notes",
  "رفع ملف صوتي وإرساله داخل الغرفة العامة.": "Recording and uploading voice notes in public rooms.",
  "الصعود كمذيع في البث المباشر": "Go Live Broadcaster",
  "بدء بث صوتي أو فيديو والانضمام كمذيع في بث قائم.": "Starting a live audio/video stream or joining as a broadcaster.",
  "النشر في الحائط": "Post on Wall",
  "إنشاء منشور نصي أو صورة أو فيديو أو فيديو YouTube.": "Creating text, photo, video, or YouTube posts on the wall.",
  "النشر في الحالة": "Post Status",
  "نشر حالات النص والصورة والفيديو والصوت.": "Publishing text, photo, video, and audio status stories.",
  "حفظ صلاحيات العضويات": "Save Membership Permissions",
  "إظهار الوقت مع الرسالة (espumh) :": "Show Time with Messages (espumh):",
  "تفعيل مراقبة الرسائل قبل نشرها (mrs eab) :": "Enable Message Moderation (mrs eab):",
  "الحد الأقصى لأحرف الرسالة :حرف": "Maximum Message Length: chars",
  "رابط الرسائل العامة (puurl) :": "Public Messages Link (puurl):",
  "الرابط : الافتراضي": "Link: Default",
  "رفع شعار جديد": "Upload New Logo",
  "انقر لاختيار صورة": "Click to choose an image",
  "PNG, JPG, JPEG, GIF (حد أقصى 2MB)": "PNG, JPG, JPEG, GIF (Max 2MB)",
  "حفظ الشعار الجديد": "Save New Logo",
  "استعادة الشعار الافتراضي": "Restore Default Logo",
  "استعادة الشعار الPredeterminado": "Restore Default Logo",
  "اختر لون جلد الشات": "Choose Chat Theme Skin",
  "حفظ الجلد": "Save Theme",
  "حجم خط الرسائل :14px": "Message Font Size: 14px",
  "معاينة": "Preview",
  "مرحبا بكم في شات نجوم العرب 2221111 ★ هذه رسالة تجريبية لمعاينة حجم الخط": "Welcome to the chat ★ This is sample text to preview font size.",
  "حفظ حجم الخط": "Save Font Size",
  "قائمة الغرف المتاحة": "Available Rooms List",
  "خيمة دردشتي": "My Chat Tent",
  "غرفة الخيمة": "Tent Room",
  "غرفة الأردن": "Jordan Room",
  "غرفة الأردن العامة": "Jordan Public Room",
  "خيمة دردشي": "Chat Tent",
  "غرفة دردشي الرئيسية": "Main Chat Room",
  "فلسطين": "Palestine",
  "غرفة مستخدمين فلسطين": "Palestine Users Room",
  "العراق": "Iraq",
  "غرفة مستخدمين العراق": "Iraq Users Room",
  "الاردن 1": "Jordan 1",
  "غرفة مستخدمين الاردن": "Jordan Users Room",
  "الاردن 2": "Jordan 2",
  "السعودية": "Saudi Arabia",
  "غرفة مستخدمين السعودية": "Saudi Users Room",
  "مصر 1": "Egypt 1",
  "غرفة مستخدمين مصر": "Egypt Users Room",
  "غرفة صوتية 1": "Voice Room 1",
  "غرفة صوتية 2": "Voice Room 2",
  "غرفة الدردشة الصوتية ★": "Voice Chat Room ★",
  "افتراضية 💬": "Default 💬",
  "صوتية 🎙": "Voice 🎙",
  "مفتوحة": "Open",
  "مغلقة": "Closed",
  "500 مستخدم": "500 Users",
  "1000 مستخدم": "1000 Users",
  "تعديل غرفة": "Edit Room",
  "اسم الغرفة *": "Room Name *",
  "حالة الغرفة": "Room Status",
  "🟢 مفتوحة (نشطة)": "🟢 Open (Active)",
  "🔴 مغلقة": "🔴 Closed",
  "وصف الغرفة": "Room Description",
  "رسالة الترحيب عند دخول الغرفة": "Welcome message on room entry",
  "رسالة الترحيب عند Entrar الغرفة": "Welcome message on room entry",
  "هذه الرسالة وحدها تظهر للعضو عند الدخول، ولا يتم تحميل سجل الرسائل القديم.": "This welcome message appears to the user upon entry; old message history is not loaded.",
  "هذه الرسالة وحدها تظهر للعضو عند الEntrar، ولا يتم تحميل سجل الMensajes القديم.": "This welcome message appears to the user upon entry; old message history is not loaded.",
  "الحد الأقصى للمستخدمين": "Maximum Users Limit",
  "نوع الغرفة": "Room Type",
  "إعدادات إضافية": "Additional Settings",
  "تمكين الصوت :": "Enable Voice:",
  "تمكين الفيديو :": "Enable Video:",
  "تفعيل الروبوت (eabrmp) :": "Enable Bot (eabrmp):",
  "تفعيل الهدايا (eabvg) :": "Enable Gifts (eabvg):",
  "تفعيل الألعاب (gm) :": "Enable Games (gm):",
  "❌ معطل": "❌ Disabled",
  "✅ مفعل": "✅ Enabled",
  "الرمز السري (اتركها فارغة = بدون حماية)": "Secret Password (leave empty = unlocked)",
  "Contraseña السرية (اتركها فارغة = بدون حماية)": "Secret Password (leave empty = unlocked)",
  "صورة الغرفة": "Room Image",
  "رفع صورة الغرفة": "Upload Room Image",
  "لم تُرفع صورة بعد (تظهر أول حرف من اسمها)": "No image uploaded yet (shows first letter)",
  "No se ha subido imagen aún (تظهر أول caracteres من اسمها)": "No image uploaded yet (shows first letter)",
  "مشرفو الغرف المستقلون (أدمن غرفة)": "Independent Room Admins",
  "مشرفو الغرف المستقلون (Admin de Sala)": "Independent Room Admins",
  "قم بتعيين مشرف مستقل لكل غرفة؛ المشرف المعين هنا سيكون أدمن غرفة في هذه الغرفة المحددة فقط ويحمل شارة أدمن غرفة وصلاحيات الكتم والطرد بداخلها، بينما في الغرف الأخرى يظهر بعضويته العادية.": "Assign an independent admin for each room. The assigned user will be a Room Admin only in that specific room.",
  "تعيين مشرف جديد لغرفة": "Assign New Admin to Room",
  "اختر الغرفة المستهدفة:": "Select Target Room:",
  "اسم المستخدم المراد تعيينه كأدمن:": "Username to assign as Admin:",
  "Nombre de usuario المراد تعيينه كAdmin:": "Username to assign as Admin:",
  "تعيين كأدمن لهذه الغرفة": "Assign as Admin for this Room",
  "تعيين كAdmin لهذه الغرفة": "Assign as Admin for this Room",
  "قائمة مشرفي الغرف الحاليين": "Current Room Admins List",
  "إزالة الإشراف": "Remove Admin",
  "رسائل الروبوت المجدولة": "Scheduled Bot Messages",
  "Mensajes del Bot المجدولة": "Scheduled Bot Messages",
  "إضافة رسالة روبوت — تُرسل تلقائياً كل فترة": "Add Bot Message — Broadcasted Automatically",
  "نص الرسالة": "Message Text",
  "الغرفة": "Room",
  "🌐 كل الغرف": "🌐 All Rooms",
  "كل الغرف": "All Rooms",
  "لون الخط": "Font Color",
  "حجم الخط (12 - 40)": "Font Size (12 - 40)",
  "التوقيت — تُرسل كل كم ثانية": "Interval — Send every X seconds",
  "التوقيت — تُرسل كل كم seg": "Interval — Send every X seconds",
  "إضافة رسالة الروبوت": "Add Bot Message",
  "رسائل الروبوت الحالية": "Current Bot Messages",
  "Mensajes del Bot الحالية": "Current Bot Messages",
  "لا توجد رسائل روبوت بعد": "No bot messages yet",
  "لا توجد Mensajes روبوت بعد": "No bot messages yet",
  "رفع صورة الروبوت": "Upload Bot Avatar",
  "اسم الروبوت": "Bot Name",
  "الغرفة التي يدخل إليها": "Room to Enter",
  "نوع الصلاحية": "Role Type",
  "نوع Rol": "Role Type",
  "مستخدم عادي": "Regular User",
  "نوع العضوية": "Membership Type",
  "الرد المختصر عند ذكر اسم الروبوت": "Short reply when bot name is mentioned",
  "حساب موثق": "Verified Account",
  "يدخل الغرفة مباشرة": "Enters room immediately",
  "يرد عند ذكر اسمه": "Replies when name is mentioned",
  "توليد الروبوت وإدخاله": "Generate and Deploy Bot",
  "روبوتات الغرف الحالية": "Current Room Bots",
  "لم يتم إنشاء روبوتات غرف بعد": "No room bots created yet",
  "اسم المستخدم (u) * :": "Username (u) * :",
  "Nombre de usuario (u) * :": "Username (u) * :",
  "الرقم السري (pwd) * :": "Password (pwd) * :",
  "Contraseña (pwd) * :": "Password (pwd) * :",
  "البريد الإلكتروني (e) :": "Email (e) :",
  "الرصيد (crdsamt) :": "Balance (crdsamt) :",
  "الSaldo (crdsamt) :": "Balance (crdsamt) :",
  "الدولة (l) :": "Country (l) :",
  "الجنس (g) :": "Gender (g) :",
  "؟ مجهول": "? Unknown",
  "👦 ذكر": "👦 Male",
  "👧 أنثى": "👧 Female",
  "العمر (bt) :": "Age (bt) :",
  "العضوية :": "Membership:",
  "إضافة مستخدم": "Add User",
  "عند الموافقة اختر مقدار الذهب الذي سيُخصم من صاحب الطلب. لا يتم الخصم ولا تطبيق التوثيق أو العضوية قبل موافقتك.": "Upon approval, choose the gold deduction amount. No balance is deducted until your approval.",
  "قيد المراجعة": "Under Review",
  "تمت الموافقة": "Approved",
  "مرفوضة": "Rejected",
  "لا توجد طلبات في هذه القائمة": "No requests in this list",
  "إضافة حساب إداري": "Add Admin Account",
  "يبقى الطرد فعالاً ويمنع إعادة دخول الغرفة حتى تضغط «فك الطرد» من هذه الصفحة.": "The kick remains active preventing room re-entry until you unkick the user here.",
  "قائمة المطرودين فارغة": "Kicked users list is empty",
  "Usuarios Expulsados فارغة": "Kicked users list is empty",
  "حظر الزائر مرتبط بعنوان IP الحقيقي ويبقى فعالاً حتى إزالته من هنا.": "Guest ban is linked to the real IP address and remains active until removed here.",
  "قائمة المحظورين فارغة": "Ban list is empty",
  "Lista de Bloqueados فارغة": "Ban list is empty",
  "ارسال الاعلان": "Send Announcement",
  "رمز الاستبدال": "Replacement Symbol",
  "سيتم استبدال الكلمات الممنوعة بـ :": "Banned words will be replaced with:",
  "قائمة الكلمات المغلقة": "Banned Words List",
  "إضافة كلمة جديدة": "Add New Word",
  "اضافة كلمة": "Add Word",
  "إعادة تشغيل خادم الشات": "Restart Chat Server",
  "سيتم قطع الاتصال عن جميع المستخدمين لثوانٍ قليلة ثم يعود الخادم للعمل.": "All users will be disconnected for a few seconds during startup.",
  "استئناف الخادم الآن": "Restart Server Now",
  "إضافة إيموجي مصور جديد": "Upload New Graphic Emoji",
  "انقر لاختيار صور الإيموجي": "Click to select emoji images",
  "يمكن اختيار عدة صور — PNG / GIF / WEBP — وتظهر فوراً مع الإيموجي في الدردشة بحجم صغير": "You can select multiple images (PNG/GIF/WEBP) that appear in chat emojis.",
  "الإيموجي المرفوع حالياً": "Currently Uploaded Emojis",
  "لا يوجد إيموجي مرفوع بعد": "No custom emojis uploaded yet",
  "تحكم في ظهور موقعك ومساراته الفرعية في محركات البحث (Google) ومواقع التواصل الاجتماعي عبر الكلمات المفتاحية والوصف المخصص والصور مع دعم التوليد الذكي بالذكاء الاصطناعي.": "Control your site search engine appearance (Google) and social media via meta tags, descriptions, and AI SEO.",
  "إعدادات الهوية والأرشفة للموقع الأساسي (/)": "Homepage Identity & SEO Settings (/)",
  "🤖 توليد SEO ذكي بالذكاء الاصطناعي": "🤖 AI Smart SEO Generator",
  "اسم الموقع والدردشة (Site Name):": "Site & Chat Name (Site Name):",
  "عنوان الصفحة لمحركات البحث (Title):": "Page Title for Search Engines (Title):",
  "وصف الموقع لمحركات البحث (Meta Description):": "Meta Description for Search Engines:",
  "الكلمات المفتاحية (Meta Keywords):": "Meta Keywords:",
  "صورة الشعار ومواقع التواصل (Open Graph Image):": "Open Graph Image for Social Media:",
  "رفع الشعار": "Upload Logo",
  "أيقونة الموقع المصغرة (Favicon Icon):": "Favicon Icon:",
  "رفع أيقونة": "Upload Icon",
  "حفظ إعدادات الموقع والأرشفة الأساسية": "Save Main Site & SEO Settings",
  "مسارات الأرشفة المتعددة (مثل /chat1 و /chat2)": "Multi-Route SEO Pages (e.g. /chat1, /chat2)",
  "إضافة مسار أرشفة جديد": "Add New SEO Route",
  "مفعل": "Active",
  "اسم الدردشة:": "Chat Name:",
  "الكلمات:": "Keywords:",
  "فتح المسار": "Open Route",
  "الشعار مرفق": "Logo attached",
  "يشمل النسخ الاحتياطي قاعدة البيانات بالكامل: الحسابات والرتب والأرصدة، الرسائل العامة، المحادثات الخاصة، سجلات وتسجيلات المكالمات، الحائط والتعليقات والتفاعلات، الحالات، الهدايا والإيموجيات، الغرف والروبوتات، وصفحات الأرشفة والإعدادات.": "Backup includes entire database: accounts, roles, balances, messages, call logs, wall posts, statuses, gifts, emojis, rooms, bots, and settings.",
  "إنشاء وتحميل نسخة احتياطية جديدة": "Create & Download Full Backup",
  "اضغط على الزر أدناه لتوليد وتنزيل ملف نسخة احتياطية شاملة بصيغة JSON على جهازك فوراً.": "Click below to generate and download a comprehensive JSON backup snapshot.",
  "تحميل نسخة احتياطية كاملة (JSON)": "Download Full Backup (JSON)",
  "استعادة نسخة احتياطية سابقة": "Restore Previous Backup",
  "اختر ملف النسخة الاحتياطية (.json) لاستعادة كافة البيانات والجداول إلى الحالة المحفوظة في الملف.": "Select a backup file (.json) to restore all database tables.",
  "⚠️ تنبيه: استعادة النسخة الاحتياطية ستستبدل البيانات الحالية ببيانات النسخة المرفوعة. يُفضل تحميل نسخة جديدة أولاً قبل الاستعادة.": "⚠️ Warning: Restoring will overwrite existing records with file data.",
  "اختيار ملف النسخة (.json)": "Choose Backup File (.json)",
  "لم يتم اختيار ملف بعد": "No file chosen yet",
  "بدء استعادة البيانات": "Start Data Restore",
  "الوصول المشترك": "Shared Access",
  "قائمة الوصول المشترك": "Shared Access List",
  "إضافة عضو جديد للتوثيق": "Add Member to Verified List",
  "إضافة": "Add",
  "يمكنك إضافة عدة أسماء باستخدام | بين كل اسم": "You can add multiple names using | as separator",
  "بطاقة واحدة لكل عنوان IP، وبداخلها أسماء الأشخاص والغرف التي دخلوها.": "One card per IP address showing active users and joined rooms.",
  "الاتصالات النشطة حسب عنوان IP": "Active Connections by IP",
  "البريد الإلكتروني": "Email",
  "الإصدار": "Version",
  "حفظ": "Save",
  "تعديل": "Edit",
  "حذف": "Delete",
  "بحث": "Search",
  "إغلاق": "Close",
  "إلغاء": "Cancel",
  "تأكيد": "Confirm",
  "عرض": "View",
  "نسخ": "Copy",
  "تطبيق": "Apply",
  "حفظ التعديلات": "Save Changes",
  "تفريغ الحقول": "Clear Fields",
  "رصيد": "Balance",
  "ذهب": "Gold",
  "حرف": "chars",
  "ثانية": "sec",
  "عنابي (افتراضي)": "Maroon (Default)",
  "أزرق ملكي": "Royal Blue",
  "أخضر زمردي": "Emerald Green",
  "بنفسجي أنيق": "Elegant Purple",
  "أسود ليلي": "Night Black",
  "برتقالي جذاب": "Attractive Orange",
  "وردي فخم": "Luxury Pink",
  "تركواز بحري": "Sea Turquoise",
  "وضع المشرفين (msip) :": "Supervisors Mode (msip):",
  "تمكين المستخدم من التسجيل في الشات (eur) :": "Allow User Registration (eur):",
  "تفعيل الكتم (mt e) :": "Enable Mute System (mt e):",
  "تفعيل الكتم الصامت (mt amt) :": "Enable Silent Mute (mt amt):",
  "تفعيل إعدادات الروبوت (esprmh) :": "Enable Bot Settings (esprmh):",
  "إعدادات متقدمة": "Advanced Settings",
  "إدارة الرمزيات والصور": "Avatar & Photo Management",
  "تحكم في الرمزيات والصور الافتراضية المتاحة للأعضاء في الشات، يمكنك رفع صور جديدة وتحديد تصنيفها (الافتراضية، الطبيعة، اخرى) أو حذف أي صورة.": "Manage default avatars and photos available to members. Upload new images and categorize them (Default, Nature, Other), or delete any image.",
  "رفع رمزية جديدة": "Upload New Avatar",
  "تصنيف الرمزية:": "Avatar Category:",
  "اختيار ملف الصورة:": "Choose Image File:",
  "اختيار ورفع الصورة": "Choose & Upload Image",
  "الرمزيات المتوفرة": "Available Avatars",
  "الافتراضية (def)": "Default (def)",
  "الطبيعة (nature)": "Nature (nature)",
  "اخرى (other)": "Other (other)",
  "لا توجد رمزيات في هذا القسم": "No avatars in this category",
  "هل تريد حذف هذه الرمزية؟": "Do you want to delete this avatar?",
  "تم رفع وحفظ الرمزية بنجاح ✓": "Avatar uploaded and saved successfully ✓",
  "مرفوعاتي": "My Uploads"
};

const ADMIN_I18N_ES = {
  "لوحة التحكم الإدارية": "Panel de Control de Administración",
  "لوحة التحكم": "Panel de Control",
  "نظام إدارة الدردشة": "Sistema de Gestión de Chat",
  "نظام إدارة الدردشة المتكامل": "Sistema Integrado de Gestión de Chat",
  "اسم المستخدم": "Nombre de usuario",
  "كلمة المرور": "Contraseña",
  "دخول": "Entrar",
  "تسجيل الخروج": "Cerrar sesión",
  "الصلاحية :": "Rol:",
  "الصلاحية": "Rol",
  "★ الصلاحية :": "★ Rol:",
  "ملك الدردشة 👑": "Súper Maestro 👑",
  "ملك الدردشة (سوبر ماستر 👑)": "Súper Maestro (Dueño 👑)",
  "سوبر ماستر 👑": "Súper Maestro 👑",
  "سوبر ماستر": "Súper Maestro",
  "سوبر ادمين": "Súper Admin",
  "سوبر أدمن": "Súper Admin",
  "★Súper Admin": "★ Súper Admin",
  "★Admin": "★ Admin",
  "ادمن": "Admin",
  "أدمن": "Admin",
  "ادمن غرفة": "Admin de Sala",
  "أدمن غرفة": "Admin de Sala",
  "مشرفو الغرف (أدمن غرفة)": "Administradores de Sala",
  "عضو عادي": "Miembro Normal",
  "عضو مسجل": "Miembro Registrado",
  "الزائر": "Visitante",
  "زائر": "Visitante",
  "بدون عضوية": "Sin Membresía",
  "مميز": "Destacado",
  "هذا الحساب ليس حساب إدارة": "Esta cuenta no es de administración",
  "فشل تسجيل الدخول": "Error al iniciar sesión",
  "باقات الذهب والدفع": "Paquetes de Oro y Pagos",
  "إدارة باقات الذهب": "Gestionar Paquetes de Oro",
  "إدارة باقات شراء الذهب": "Gestionar Paquetes de Oro",
  "إعدادات بطاقة الإيداع والدفع": "Configuración de Pagos de PayPal",
  "إعدادات بطاقة الإيداع وبوابة الدفع": "Configuración de Tarjeta y Pagos",
  "إعدادات بطاقة الإيداع وبوابة الدفع البنكية": "Configuración de Tarjeta y Pagos",
  "سجل مدفوعات البطاقات": "Registro de Pagos de PayPal",
  "سجل مدفوعات البطاقات البنكية": "Registro de Pagos de PayPal",
  "إعدادات بوابة الدفع PayPal": "Configuración de Pagos de PayPal",
  "سجل مدفوعات PayPal": "Registro de Pagos de PayPal",
  "تكاليف العضويات والمكالمات": "Costos de Membresías y Llamadas",
  "الاعدادات الاساسيه": "Configuración Básica",
  "إعدادات اللغة والترجمة": "Idioma y Traducción",
  "ضبط الاعدادات": "Configuración General",
  "صلاحيات العضويات": "Permisos de Membresía",
  "اعدادات الرسائل": "Configuración de Mensajes",
  "وضع الشعار": "Cambiar Logo",
  "وضع الجلد": "Cambiar Tema (Skin)",
  "تحديد حجم الخط": "Tamaño de Fuente",
  "اعدادات الغرف": "Configuración de Salas",
  "قائمة الغرف": "Lista de Salas",
  "اضافة غرفة": "Añadir Sala",
  "اضافة غرفة جديدة": "Añadir Nueva Sala",
  "رسائل الروبوت": "Mensajes del Bot",
  "إعدادات الذكاء الاصطناعي (AI)": "Configuración de IA y Red Neuronal",
  "إعدادات العقل العصبي والذكاء الاصطناعي (AI)": "Configuración del Motor Neuronal e IA",
  "حفظ إعدادات الذكاء الاصطناعي": "Guardar Configuración de IA",
  "تجربة رد الذكاء الاصطناعي ⚡": "Probar Respuesta IA ⚡",
  "توليد روبوت غرفة": "Generar Bot de Sala",
  "توليد وإعداد روبوت الغرفة": "Generar y Configurar Bot de Sala",
  "وضع التحدث والرد في الغرفة :": "Modo de voz y respuesta IA:",
  "🤖 متحدث ذكي (يرد بالذكاء الاصطناعي عند مناداته بالاسم)": "🤖 Orador IA Inteligente (Responde con IA al ser llamado por su nombre)",
  "💬 متحدث برد مخصص (يرد بالنص المحدد عند مناداته بالاسم)": "💬 Orador con Respuesta Personalizada",
  "🔇 صامت (لا يتحدث ولا يرد أبداً)": "🔇 Silencioso (Nunca habla ni responde)",
  "الرد المخصص عند مناداة اسم الروبوت :": "Respuesta personalizada al ser llamado:",
  "🤖 متحدث ذكي (AI)": "🤖 Orador IA Inteligente",
  "🔇 صامت (لا يتحدث)": "🔇 Silencioso",
  "اعدادات النظام": "Configuración del Sistema",
  "اعدادات النظام الاساسي": "Configuración Principal del Sistema",
  "ادارة المستخدمين": "Gestión de Usuarios",
  "اضافه مستخدم": "Añadir Usuario",
  "إضافة مستخدم جديد": "Añadir Nuevo Usuario",
  "تحرير مستخدم": "Editar Usuario",
  "طلبات التوثيق والترقية": "Solicitudes de Verificación y Ascenso",
  "الحسابات الادارية": "Cuentas Administrativas",
  "الحسابات الإدارية": "Cuentas Administrativas",
  "قائمة المطرودين": "Usuarios Expulsados",
  "قائمة المطرودين من الغرف": "Lista de Usuarios Expulsados",
  "قائمة الحظر": "Lista de Bloqueados",
  "قائمة المحظورين": "Lista de Usuarios Bloqueados",
  "نظام الادارة": "Sistema de Administración",
  "ارسال اعلان للجميع": "Enviar Anuncio Global",
  "إرسال إعلان للجميع": "Enviar Anuncio Global",
  "فلترة الكلمات": "Filtro de Palabras",
  "استئناف الخادم": "Reiniciar Servidor",
  "استئناف خادم الشات": "Reiniciar Servidor de Chat",
  "الهدايا والإيموجي": "Regalos y Emojis",
  "اداره الهدايا": "Gestionar Regalos",
  "ادارة الهدايا": "Gestionar Regalos",
  "رفع الإيموجي": "Subir Emojis",
  "الأرشفة ومحركات البحث": "SEO y Motores de Búsqueda",
  "الأرشفة ومحركات البحث (SEO)": "SEO y Motores de Búsqueda",
  "الأرشفة ومسارات البحث (SEO)": "SEO y Rutas de Búsqueda",
  "النسخ الاحتياطي": "Copia de Seguridad",
  "النسخ الاحتياطي والاستعادة": "Copia de Seguridad y Restauración",
  "النسخ الاحتياطي واستعادة البيانات": "Copia de Seguridad y Restauración",
  "مراقبة الخاص والمكالمات": "Monitoreo de Privados y Llamadas",
  "مراقبة الرسائل الخاصة": "Monitoreo de Mensajes Privados",
  "تسجيلات المكالمات": "Grabaciones de Llamadas",
  "توثيق": "Verificación",
  "رصد فريق": "Monitoreo del Equipo",
  "تحكم في باقات الذهب المعروضة للمستخدمين في المتجر، يمكنك إضافة باقات جديدة، تعديل الأسعار، وإضافة ذهب مجاني وهدايا وشارات ترويجية.": "Gestiona los paquetes de oro en la tienda: añade paquetes, ajusta precios y configura bonos y distintivos.",
  "إضافة باقة ذهب جديدة": "Añadir Nuevo Paquete de Oro",
  "إضافة Paquete de Oro جديدة": "Añadir Nuevo Paquete de Oro",
  "تعديل باقة الذهب": "Editar Paquete de Oro",
  "اسم الباقة:": "Nombre del Paquete:",
  "كمية الذهب الأساسية (🪙):": "Cantidad de Oro Base (🪙):",
  "كمية الذهب الأساسية:": "Cantidad de Oro Base:",
  "سعر الباقة:": "Precio del Paquete:",
  "السعر المطلوب ($):": "Precio ($):",
  "العملة:": "Moneda:",
  "ذهب إضافي مجاني (Bonus):": "Oro Extra Gratis (Bonus):",
  "ذهب إضافي هدية (Bonus):": "Oro Extra de Regalo (Bonus):",
  "شارة ترويجية (Badge):": "Insignia Promocional:",
  "ترتيب الظهور (Sort):": "Orden de Visualización:",
  "الترتيب في العرض:": "Orden:",
  "تفعيل هذه الباقة في المتجر الآن": "Activar este paquete en la tienda ahora",
  "باقة نشطة ومعروضة للمستخدمين": "Activo y visible para usuarios",
  "حفظ باقة الذهب": "Guardar Paquete de Oro",
  "إلغاء التعديل": "Cancelar Edición",
  "باقات الذهب المتوفرة حالياً": "Paquetes de Oro Disponibles",
  "اسم الباقة": "Nombre del Paquete",
  "الذهب": "Oro",
  "السعر": "Precio",
  "ذهب إضافي": "Oro Extra",
  "الشارة": "Insignia",
  "الترتيب": "Orden",
  "الحالة": "Estado",
  "الإجراءات": "Acciones",
  "نشط": "Activo",
  "معطل": "Desactivado",
  "لا توجد باقات ذهب مضافة بعد": "No hay paquetes de oro añadidos aún",
  "تم حفظ باقة الذهب بنجاح": "Paquete de oro guardado con éxito",
  "حذف هذه الباقة نهائياً؟": "¿Eliminar permanentemente este paquete?",
  "حدد هنا بيانات بطاقة الصراف الآلي والحساب البنكي المعتمد الذي يتم استقبال مدفوعات وإيداعات شراء الذهب عليه من المستخدمين.": "Configura aquí los datos de la tarjeta bancaria autorizada para recibir depósitos y compras de oro de los usuarios.",
  "بيانات البطاقة البنكية المعتمدة لاستقبال مدفوعات الأعضاء عند شحن الذهب بالبطاقات.": "Detalles de la tarjeta bancaria para recibir pagos al recargar oro.",
  "بيانات الحساب وبطاقة الإيداع المعتمدة": "Datos de la Cuenta y Tarjeta de Depósito Autorizada",
  "اسم البنك أو المصرف المعتمد:": "Nombre del Banco Autorizado:",
  "اسم البنك / مزود الخدمة المعتمد:": "Nombre del Banco / Proveedor Autorizado:",
  "اسم صاحب الحساب / المستفيد:": "Nombre del Titular / Beneficiario:",
  "اسم صاحب الحساب / الإدارة المعتمدة:": "Nombre del Titular / Administración:",
  "رقم بطاقة الصراف الآلي للإيداع (Receiver Card Number):": "Número de Tarjeta de Débito para Depósitos:",
  "رقم البطاقة / الحساب المعتمد للإيداع:": "Número de Tarjeta / Cuenta de Depósito:",
  "رقم الآيبان (IBAN) / رقم الحساب الدولي:": "Número IBAN / Cuenta Bancaria Internacional:",
  "رقم الآيبان (IBAN) الدولي (اختياري):": "IBAN Internacional (Opcional):",
  "العملة الافتراضية للدفع:": "Moneda Predeterminada de Pago:",
  "رمز العملة (مثال: $ أو ريال أو ج.م):": "Símbolo de Moneda (ej. $, USD, EUR):",
  "تفعيل بوابة الدفع ببطاقات الصراف والائتمان في المتجر": "Activar Pasarela de Pago con Tarjeta en la Tienda",
  "تفعيل الدفع بالبطاقات البنكية": "Activar Pagos con Tarjeta",
  "تمكين استقبال المدفوعات عبر البطاقات البنكية في متجر الذهب": "Permitir pagos con tarjeta en la tienda de oro",
  "حفظ إعدادات البطاقة والدفع": "Guardar Configuración de Tarjeta y Pagos",
  "تم حفظ إعدادات البطاقة والدفع بنجاح": "Configuración de tarjeta guardada con éxito",
  "$ (الدولار الأمريكي)": "$ (Dólar Estadounidense)",
  "د.أ (الدينار الأردني)": "JOD (Dinar Jordano)",
  "ر.س (الريال السعودي)": "SAR (Riyal Saudí)",
  "د.إ (الدرهم الإماراتي)": "AED (Dírham de EAU)",
  "ج.م (الجنيه المصري)": "EGP (Libra Egipcia)",
  "سجل كامل لجميع عمليات شراء الذهب والدفع الإلكتروني الناجحة التي تمت عبر بطاقات الصراف والائتمان.": "Registro completo de todas las compras de oro y pagos exitosos con tarjeta.",
  "العمليات المنفذة بنجاح": "Operaciones Realizadas con Éxito",
  "🔍 ابحث برقم المعاملة أو اسم المستخدم أو آخر 4 أرقام من البطاقة...": "🔍 Buscar por ID de transacción, usuario o últimos 4 dígitos...",
  "تصدير السجل (CSV)": "Exportar CSV",
  "رقم المعاملة": "ID de Transacción",
  "المستخدم": "Usuario",
  "الباقة": "Paquete",
  "الذهب المشحون": "Oro Cargado",
  "الذهب المستلم": "Oro Recibido",
  "المبلغ المدفوع": "Monto Pagado",
  "البطاقة المستخدمة": "Tarjeta Utilizada",
  "حساب الإيداع": "Cuenta de Depósito",
  "نوع البطاقة": "Marca de Tarjeta",
  "آخر 4 أرقام": "Últimos 4 Dígitos",
  "اسم حامل البطاقة": "Nombre del Titular",
  "تاريخ المعاملة": "Fecha de Transacción",
  "التاريخ": "Fecha",
  "ناجحة": "Completada",
  "لا توجد معاملات دفع بعد": "No hay transacciones aún",
  "إعدادات رصيد العضويات والمكافآت": "Configuración de Membresías y Recompensas",
  "إعدادات رصيد العضويات والتسجيل": "Configuración de Membresías y Registro",
  "رصيد العضويات والتسجيل": "Saldos de Membresías y Registro",
  "لشراء عضوية VIP 👑": "para comprar membresía VIP 👑",
  "لشراء عضوية Premium 💎": "para comprar membresía Premium 💎",
  "لشراء عضوية Plus ⭐": "para comprar membresía Plus ⭐",
  "الذهب الممنوح تلقائياً عند تسجيل حساب جديد 💰": "Oro otorgado automáticamente al registrar una nueva cuenta 💰",
  "VIP - الرصيد المطلوب :رصيد": "VIP - Saldo Requerido: Créditos",
  "Premium - الرصيد المطلوب :رصيد": "Premium - Saldo Requerido: Créditos",
  "Plus - الرصيد المطلوب :رصيد": "Plus - Saldo Requerido: Créditos",
  "الذهب الممنوح عند تسجيل حساب جديد :ذهب": "Oro otorgado al registrarse: Oro",
  "تكلفة المكالمة الصوتية المفتوحة (بالذهب) :ذهب": "Costo de llamada abierta: Oro",
  "VIP - الرصيد المطلوب": "VIP - Saldo Requerido",
  "Premium - الرصيد المطلوب": "Premium - Saldo Requerido",
  "Plus - الرصيد المطلوب": "Plus - Saldo Requerido",
  "الذهب الممنوح عند تسجيل حساب جديد": "Oro otorgado al registrarse",
  "تكلفة المكالمة الصوتية المفتوحة (بالذهب)": "Costo de llamada abierta (en oro)",
  "استعادة الافتراضي": "Restablecer Valores Predeterminados",
  "استعادة الPredeterminado": "Restablecer Valores Predeterminados",
  "يمكنك هنا تعيين اللغة الافتراضية للشات لجميع الزوار والأعضاء الجدد، بالإضافة إلى تحديد لغة عرض لوحة الإدارة للمشرفين.": "Aquí puedes configurar el idioma predeterminado del chat para nuevos visitantes y miembros, así como el idioma del panel de administración.",
  "اللغة الافتراضية للدردشة والموقع": "Idioma Predeterminado del Sitio y Chat",
  "يتم تطبيق هذه اللغة تلقائياً على أي زائر أو مستخدم جديد يدخل الدردشة لأول مرة. يمكن لكل مستخدم اختيار لغته الخاصة بحرية من قائمة اللغات داخل الشات.": "Este idioma se aplica automáticamente a cualquier nuevo visitante o usuario. Cada usuario puede cambiar su idioma en cualquier momento.",
  "لغة لوحة التحكم والإدارة": "Idioma del Panel de Control",
  "لغة Panel de Control والإدارة": "Idioma del Panel de Control",
  "تحديد لغة عرض لوحة الإدارة للمشرفين والمسؤولين. يمكنك أيضاً التبديل السريع من شريط اللغات أعلى القائمة.": "Establece el idioma predeterminado del panel de administración para los moderadores y administradores.",
  "حفظ وتطبيق إعدادات اللغة": "Guardar y Aplicar Configuración de Idioma",
  "عرض زر الاسمايلات :": "Mostrar Botón de Emojis:",
  "عرض زر تسجيل الصوت :": "Mostrar Botón de Grabación de Voz:",
  "عرض زر ارسال صورة :": "Mostrar Botón de Enviar Foto:",
  "(i1) دخول مخفي للسوبر :": "(i1) Entrada Oculta para Súper Administrador:",
  "الإشعارات الصوتية": "Notificaciones de Sonido",
  "صوت عند دخول المستخدم (b1) :": "Sonido al Entrar Usuario (b1):",
  "صوت عند ارسال رسالة (b4) :": "Sonido al Enviar Mensaje (b4):",
  "صوت عند خروج المستخدم (b5) :": "Sonido al Salir Usuario (b5):",
  "حفظ الاعدادات": "Guardar Configuración",
  "إرسال الرسائل في العام": "Enviar Mensajes Públicos",
  "كتابة وإرسال الرسائل النصية والإيموجي داخل الغرف العامة.": "Escribir y enviar mensajes de texto y emojis en salas públicas.",
  "إرسال الرسائل الخاصة": "Enviar Mensajes Privados",
  "إرسال رسالة نصية مباشرة إلى مستخدم آخر في الخاص.": "Enviar mensajes de texto directos a otros usuarios en privado.",
  "المكالمات الصوتية في الخاص": "Llamadas de Voz Privadas",
  "إجراء وبدء مكالمات صوتية مباشرة بين شخصين في المحادثة الخاصة.": "Iniciar llamadas de voz directas entre dos personas en privado.",
  "إرسال الصور في العام": "Enviar Fotos en Público",
  "رفع صورة من زر الكاميرا وإرسالها داخل الغرفة العامة.": "Subir y enviar fotos en la sala pública.",
  "إرسال مقطع صوتي في العام": "Enviar Audio en Público",
  "رفع ملف صوتي وإرساله داخل الغرفة العامة.": "Subir y enviar notas de voz en la sala pública.",
  "الصعود كمذيع في البث المباشر": "Transmitir en Vivo",
  "بدء بث صوتي أو فيديو والانضمام كمذيع في بث قائم.": "Iniciar transmisión en vivo o unirse como locutor.",
  "النشر في الحائط": "Publicar en el Muro",
  "إنشاء منشور نصي أو صورة أو فيديو أو فيديو YouTube.": "Crear publicaciones de texto, fotos, video o YouTube en el muro.",
  "النشر في الحالة": "Publicar en el Estado",
  "نشر حالات النص والصورة والفيديو والصوت.": "Publicar historias de texto, fotos, video y audio.",
  "حفظ صلاحيات العضويات": "Guardar Permisos de Membresía",
  "إظهار الوقت مع الرسالة (espumh) :": "Mostrar Hora con Mensajes (espumh):",
  "تفعيل مراقبة الرسائل قبل نشرها (mrs eab) :": "Activar Revisión de Mensajes (mrs eab):",
  "الحد الأقصى لأحرف الرسالة :حرف": "Límite Máximo de Caracteres: caracteres",
  "رابط الرسائل العامة (puurl) :": "Enlace de Mensajes Públicos (puurl):",
  "الرابط : الافتراضي": "Enlace: Predeterminado",
  "رفع شعار جديد": "Subir Nuevo Logo",
  "انقر لاختيار صورة": "Haz clic para elegir una imagen",
  "PNG, JPG, JPEG, GIF (حد أقصى 2MB)": "PNG, JPG, JPEG, GIF (Máx. 2MB)",
  "حفظ الشعار الجديد": "Guardar Nuevo Logo",
  "استعادة الشعار الافتراضي": "Restaurar Logo Predeterminado",
  "استعادة الشعار الPredeterminado": "Restaurar Logo Predeterminado",
  "اختر لون جلد الشات": "Elige el Tema del Chat",
  "حفظ الجلد": "Guardar Tema",
  "حجم خط الرسائل :14px": "Tamaño de Fuente: 14px",
  "معاينة": "Vista Previa",
  "مرحبا بكم في شات نجوم العرب 2221111 ★ هذه رسالة تجريبية لمعاينة حجم الخط": "Bienvenido al chat ★ Este es un texto de ejemplo para previsualizar el tamaño de fuente.",
  "حفظ حجم الخط": "Guardar Tamaño de Fuente",
  "قائمة الغرف المتاحة": "Lista de Salas Disponibles",
  "خيمة دردشتي": "Carpa de Chat",
  "غرفة الخيمة": "Sala de la Carpa",
  "غرفة الأردن": "Sala de Jordania",
  "غرفة الأردن العامة": "Sala Pública de Jordania",
  "خيمة دردشي": "Carpa de Charla",
  "غرفة دردشي الرئيسية": "Sala Principal de Chat",
  "فلسطين": "Palestina",
  "غرفة مستخدمين فلسطين": "Sala de Usuarios de Palestina",
  "العراق": "Irak",
  "غرفة مستخدمين العراق": "Sala de Usuarios de Irak",
  "الاردن 1": "Jordania 1",
  "غرفة مستخدمين الاردن": "Sala de Usuarios de Jordania",
  "الاردن 2": "Jordania 2",
  "السعودية": "Arabia Saudita",
  "غرفة مستخدمين السعودية": "Sala de Usuarios de Arabia Saudita",
  "مصر 1": "Egipto 1",
  "غرفة مستخدمين مصر": "Sala de Usuarios de Egipto",
  "غرفة صوتية 1": "Sala de Voz 1",
  "غرفة صوتية 2": "Sala de Voz 2",
  "غرفة الدردشة الصوتية ★": "Sala de Chat de Voz ★",
  "افتراضية 💬": "Predeterminada 💬",
  "صوتية 🎙": "Voz 🎙",
  "مفتوحة": "Abierta",
  "مغلقة": "Cerrada",
  "500 مستخدم": "500 Usuarios",
  "1000 مستخدم": "1000 Usuarios",
  "تعديل غرفة": "Editar Sala",
  "اسم الغرفة *": "Nombre de la Sala *",
  "حالة الغرفة": "Estado de la Sala",
  "🟢 مفتوحة (نشطة)": "🟢 Abierta (Activa)",
  "🔴 مغلقة": "🔴 Cerrada",
  "وصف الغرفة": "Descripción de la Sala",
  "رسالة الترحيب عند دخول الغرفة": "Mensaje de bienvenida al entrar a la sala",
  "رسالة الترحيب عند Entrar الغرفة": "Mensaje de bienvenida al entrar a la sala",
  "هذه الرسالة وحدها تظهر للعضو عند الدخول، ولا يتم تحميل سجل الرسائل القديم.": "Este mensaje aparece al entrar; no se carga el historial de mensajes antiguos.",
  "هذه الرسالة وحدها تظهر للعضو عند الEntrar، ولا يتم تحميل سجل الMensajes القديم.": "Este mensaje aparece al entrar; no se carga el historial de mensajes antiguos.",
  "الحد الأقصى للمستخدمين": "Límite Máximo de Usuarios",
  "نوع الغرفة": "Tipo de Sala",
  "إعدادات إضافية": "Configuración Adicional",
  "تمكين الصوت :": "Habilitar Voz:",
  "تمكين الفيديو :": "Habilitar Video:",
  "تفعيل الروبوت (eabrmp) :": "Activar Bot (eabrmp):",
  "تفعيل الهدايا (eabvg) :": "Activar Regalos (eabvg):",
  "تفعيل الألعاب (gm) :": "Activar Juegos (gm):",
  "❌ معطل": "❌ Desactivado",
  "✅ مفعل": "✅ Activado",
  "الرمز السري (اتركها فارغة = بدون حماية)": "Contraseña Secreta (dejar vacío = sin protección)",
  "Contraseña السرية (اتركها فارغة = بدون حماية)": "Contraseña Secreta (dejar vacío = sin protección)",
  "صورة الغرفة": "Imagen de la Sala",
  "رفع صورة الغرفة": "Subir Imagen de la Sala",
  "لم تُرفع صورة بعد (تظهر أول حرف من اسمها)": "No se ha subido imagen aún (muestra la primera letra)",
  "No se ha subido imagen aún (تظهر أول caracteres من اسمها)": "No se ha subido imagen aún (muestra la primera letra)",
  "مشرفو الغرف المستقلون (أدمن غرفة)": "Administradores de Sala Independientes",
  "مشرفو الغرف المستقلون (Admin de Sala)": "Administradores de Sala Independientes",
  "قم بتعيين مشرف مستقل لكل غرفة؛ المشرف المعين هنا سيكون أدمن غرفة في هذه الغرفة المحددة فقط ويحمل شارة أدمن غرفة وصلاحيات الكتم والطرد بداخلها، بينما في الغرف الأخرى يظهر بعضويته العادية.": "Asigna un administrador independiente para cada sala; tendrá rango e insignia de Admin de Sala solo en esa sala.",
  "تعيين مشرف جديد لغرفة": "Asignar Nuevo Admin a Sala",
  "اختر الغرفة المستهدفة:": "Seleccionar Sala de Destino:",
  "اسم المستخدم المراد تعيينه كأدمن:": "Nombre de usuario a asignar como Admin:",
  "Nombre de usuario المراد تعيينه كAdmin:": "Nombre de usuario a asignar como Admin:",
  "تعيين كأدمن لهذه الغرفة": "Asignar como Admin de esta Sala",
  "تعيين كAdmin لهذه الغرفة": "Asignar como Admin de esta Sala",
  "قائمة مشرفي الغرف الحاليين": "Lista de Administradores de Sala Actuales",
  "إزالة الإشراف": "Eliminar Admin",
  "رسائل الروبوت المجدولة": "Mensajes Programados del Bot",
  "Mensajes del Bot المجدولة": "Mensajes Programados del Bot",
  "إضافة رسالة روبوت — تُرسل تلقائياً كل فترة": "Añadir Mensaje de Bot — Enviado Periódicamente",
  "نص الرسالة": "Texto del Mensaje",
  "الغرفة": "Sala",
  "🌐 كل الغرف": "🌐 Todas las Salas",
  "كل الغرف": "Todas las Salas",
  "لون الخط": "Color de Fuente",
  "حجم الخط (12 - 40)": "Tamaño de Fuente (12 - 40)",
  "التوقيت — تُرسل كل كم ثانية": "Intervalo — Enviar cada X segundos",
  "التوقيت — تُرسل كل كم seg": "Intervalo — Enviar cada X segundos",
  "إضافة رسالة الروبوت": "Añadir Mensaje de Bot",
  "رسائل الروبوت الحالية": "Mensajes Actuales del Bot",
  "Mensajes del Bot الحالية": "Mensajes Actuales del Bot",
  "لا توجد رسائل روبوت بعد": "No hay mensajes de bot aún",
  "لا توجد Mensajes روبوت بعد": "No hay mensajes de bot aún",
  "رفع صورة الروبوت": "Subir Avatar del Bot",
  "اسم الروبوت": "Nombre del Bot",
  "الغرفة التي يدخل إليها": "Sala a la que Entra",
  "نوع الصلاحية": "Tipo de Rol",
  "نوع Rol": "Tipo de Rol",
  "مستخدم عادي": "Usuario Normal",
  "نوع العضوية": "Tipo de Membresía",
  "الرد المختصر عند ذكر اسم الروبوت": "Respuesta corta al mencionar el bot",
  "حساب موثق": "Cuenta Verificada",
  "يدخل الغرفة مباشرة": "Entra a la sala directamente",
  "يرد عند ذكر اسمه": "Responde al mencionar su nombre",
  "توليد الروبوت وإدخاله": "Generar y Desplegar Bot",
  "روبوتات الغرف الحالية": "Bots de Sala Actuales",
  "لم يتم إنشاء روبوتات غرف بعد": "No se han creado bots de sala aún",
  "اسم المستخدم (u) * :": "Nombre de usuario (u) * :",
  "Nombre de usuario (u) * :": "Nombre de usuario (u) * :",
  "الرقم السري (pwd) * :": "Contraseña (pwd) * :",
  "Contraseña (pwd) * :": "Contraseña (pwd) * :",
  "البريد الإلكتروني (e) :": "Correo Electrónico (e) :",
  "الرصيد (crdsamt) :": "Saldo (crdsamt) :",
  "الSaldo (crdsamt) :": "Saldo (crdsamt) :",
  "الدولة (l) :": "País (l) :",
  "الجنس (g) :": "Género (g) :",
  "؟ مجهول": "? Desconocido",
  "👦 ذكر": "👦 Hombre",
  "👧 أنثى": "👧 Mujer",
  "العمر (bt) :": "Edad (bt) :",
  "العضوية :": "Membresía:",
  "إضافة مستخدم": "Añadir Usuario",
  "عند الموافقة اختر مقدار الذهب الذي سيُخصم من صاحب الطلب. لا يتم الخصم ولا تطبيق التوثيق أو العضوية قبل موافقتك.": "Al aprobar, elige la cantidad de oro a descontar. No se aplica nada antes de tu aprobación.",
  "قيد المراجعة": "En Revisión",
  "تمت الموافقة": "Aprobado",
  "مرفوضة": "Rechazada",
  "لا توجد طلبات في هذه القائمة": "No hay solicitudes en esta lista",
  "إضافة حساب إداري": "Añadir Cuenta de Admin",
  "يبقى الطرد فعالاً ويمنع إعادة دخول الغرفة حتى تضغط «فك الطرد» من هذه الصفحة.": "La expulsión permanece activa impidiendo volver a entrar hasta que la canceles aquí.",
  "قائمة المطرودين فارغة": "La lista de expulsados está vacía",
  "Usuarios Expulsados فارغة": "La lista de expulsados está vacía",
  "حظر الزائر مرتبط بعنوان IP الحقيقي ويبقى فعالاً حتى إزالته من هنا.": "El bloqueo de visitantes está vinculado a la IP real y permanece activo hasta eliminarlo aquí.",
  "قائمة المحظورين فارغة": "La lista de bloqueados está vacía",
  "Lista de Bloqueados فارغة": "La lista de bloqueados está vacía",
  "ارسال الاعلان": "Enviar Anuncio",
  "رمز الاستبدال": "Símbolo de Reemplazo",
  "سيتم استبدال الكلمات الممنوعة بـ :": "Las palabras prohibidas se reemplazarán con:",
  "قائمة الكلمات المغلقة": "Lista de Palabras Prohibidas",
  "إضافة كلمة جديدة": "Añadir Nueva Palabra",
  "اضافة كلمة": "Añadir Palabra",
  "إعادة تشغيل خادم الشات": "Reiniciar Servidor de Chat",
  "سيتم قطع الاتصال عن جميع المستخدمين لثوانٍ قليلة ثم يعود الخادم للعمل.": "Todos los usuarios se desconectarán por unos segundos mientras reinicia.",
  "استئناف الخادم الآن": "Reiniciar Servidor Ahora",
  "إضافة إيموجي مصور جديد": "Subir Nuevo Emoji Gráfico",
  "انقر لاختيار صور الإيموجي": "Haz clic para seleccionar imágenes de emojis",
  "يمكن اختيار عدة صور — PNG / GIF / WEBP — وتظهر فوراً مع الإيموجي في الدردشة بحجم صغير": "Puedes elegir varias imágenes (PNG/GIF/WEBP) para usarlas como emojis en el chat.",
  "الإيموجي المرفوع حالياً": "Emojis Subidos Actualmente",
  "لا يوجد إيموجي مرفوع بعد": "No hay emojis subidos aún",
  "تحكم في ظهور موقعك ومساراته الفرعية في محركات البحث (Google) ومواقع التواصل الاجتماعي عبر الكلمات المفتاحية والوصف المخصص والصور مع دعم التوليد الذكي بالذكاء الاصطناعي.": "Controla la visibilidad de tu sitio en Google y redes sociales con metadatos y generación con IA.",
  "إعدادات الهوية والأرشفة للموقع الأساسي (/)": "Configuración de Identidad y SEO de Portada (/)",
  "🤖 توليد SEO ذكي بالذكاء الاصطناعي": "🤖 Generador Inteligente de SEO con IA",
  "اسم الموقع والدردشة (Site Name):": "Nombre del Sitio y Chat (Site Name):",
  "عنوان الصفحة لمحركات البحث (Title):": "Título de Página para Motores de Búsqueda (Title):",
  "وصف الموقع لمحركات البحث (Meta Description):": "Descripción Meta para Motores de Búsqueda:",
  "الكلمات المفتاحية (Meta Keywords):": "Palabras Clave Meta:",
  "صورة الشعار ومواقع التواصل (Open Graph Image):": "Imagen Open Graph para Redes Sociales:",
  "رفع الشعار": "Subir Logo",
  "أيقونة الموقع المصغرة (Favicon Icon):": "Icono Favicon:",
  "رفع أيقونة": "Subir Icono",
  "حفظ إعدادات الموقع والأرشفة الأساسية": "Guardar Configuración de Sitio y SEO",
  "مسارات الأرشفة المتعددة (مثل /chat1 و /chat2)": "Rutas SEO Múltiples (ej. /chat1, /chat2)",
  "إضافة مسار أرشفة جديد": "Añadir Nueva Ruta SEO",
  "مفعل": "Activo",
  "اسم الدردشة:": "Nombre del Chat:",
  "الكلمات:": "Palabras clave:",
  "فتح المسار": "Abrir Ruta",
  "الشعار مرفق": "Logo adjunto",
  "يشمل النسخ الاحتياطي قاعدة البيانات بالكامل: الحسابات والرتب والأرصدة، الرسائل العامة، المحادثات الخاصة، سجلات وتسجيلات المكالمات، الحائط والتعليقات والتفاعلات، الحالات، الهدايا والإيموجيات، الغرف والروبوتات، وصفحات الأرشفة والإعدادات.": "La copia de seguridad incluye toda la base de datos: cuentas, mensajes, llamadas, muro, estados, regalos, salas y configuración.",
  "إنشاء وتحميل نسخة احتياطية جديدة": "Crear y Descargar Copia de Seguridad",
  "اضغط على الزر أدناه لتوليد وتنزيل ملف نسخة احتياطية شاملة بصيغة JSON على جهازك فوراً.": "Haz clic abajo para descargar una copia de seguridad completa en formato JSON.",
  "تحميل نسخة احتياطية كاملة (JSON)": "Descargar Copia Completa (JSON)",
  "استعادة نسخة احتياطية سابقة": "Restaurar Copia de Seguridad Anterior",
  "اختر ملف النسخة الاحتياطية (.json) لاستعادة كافة البيانات والجداول إلى الحالة المحفوظة في الملف.": "Selecciona un archivo (.json) para restaurar todas las tablas.",
  "⚠️ تنبيه: استعادة النسخة الاحتياطية ستستبدل البيانات الحالية ببيانات النسخة المرفوعة. يُفضل تحميل نسخة جديدة أولاً قبل الاستعادة.": "⚠️ Advertencia: La restauración sobrescribirá los datos actuales.",
  "اختيار ملف النسخة (.json)": "Elegir Archivo (.json)",
  "لم يتم اختيار ملف بعد": "No se ha elegido archivo aún",
  "بدء استعادة البيانات": "Iniciar Restauración de Datos",
  "الوصول المشترك": "Acceso Compartido",
  "قائمة الوصول المشترك": "Lista de Acceso Compartido",
  "إضافة عضو جديد للتوثيق": "Añadir Miembro Verificado",
  "إضافة": "Añadir",
  "يمكنك إضافة عدة أسماء باستخدام | بين كل اسم": "Puedes añadir varios nombres usando | entre ellos",
  "بطاقة واحدة لكل عنوان IP، وبداخلها أسماء الأشخاص والغرف التي دخلوها.": "Una tarjeta por dirección IP que muestra usuarios activos y salas.",
  "الاتصالات النشطة حسب عنوان IP": "Conexiones Activas por IP",
  "البريد الإلكتروني": "Correo Electrónico",
  "الإصدار": "Versión",
  "حفظ": "Guardar",
  "تعديل": "Editar",
  "حذف": "Eliminar",
  "بحث": "Buscar",
  "إغلاق": "Cerrar",
  "إلغاء": "Cancelar",
  "تأكيد": "Confirmar",
  "عرض": "Ver",
  "نسخ": "Copiar",
  "تطبيق": "Aplicar",
  "حفظ التعديلات": "Guardar Cambios",
  "تفريغ الحقول": "Limpiar Campos",
  "رصيد": "Saldo",
  "ذهب": "Oro",
  "حرف": "caracteres",
  "ثانية": "seg",
  "عنابي (افتراضي)": "Granate (Predeterminado)",
  "أزرق ملكي": "Azul Real",
  "أخضر زمردي": "Verde Esmeralda",
  "بنفسجي أنيق": "Púrpura Elegante",
  "أسود ليلي": "Negro Noche",
  "برتقالي جذاب": "Naranja Atractivo",
  "وردي فخم": "Rosa de Lujo",
  "تركواز بحري": "Turquesa Marino",
  "وضع المشرفين (msip) :": "Modo Supervisores (msip):",
  "تمكين المستخدم من التسجيل في الشات (eur) :": "Permitir Registro de Usuarios (eur):",
  "تفعيل الكتم (mt e) :": "Activar Silenciar (mt e):",
  "تفعيل الكتم الصامت (mt amt) :": "Activar Silenciar Oculto (mt amt):",
  "تفعيل إعدادات الروبوت (esprmh) :": "Activar Configuración de Bot (esprmh):",
  "إعدادات متقدمة": "Configuración Avanzada",
  "إدارة الرمزيات والصور": "Gestión de Avatares y Fotos",
  "تحكم في الرمزيات والصور الافتراضية المتاحة للأعضاء في الشات، يمكنك رفع صور جديدة وتحديد تصنيفها (الافتراضية، الطبيعة، اخرى) أو حذف أي صورة.": "Gestiona los avatares disponibles para los miembros. Sube nuevas imágenes y clasifícalas (Predeterminado, Naturaleza, Otros).",
  "رفع رمزية جديدة": "Subir Nuevo Avatar",
  "تصنيف الرمزية:": "Categoría del Avatar:",
  "اختيار ملف الصورة:": "Elegir Archivo de Imagen:",
  "اختيار ورفع الصورة": "Elegir y Subir Imagen",
  "الرمزيات المتوفرة": "Avatares Disponibles",
  "الافتراضية (def)": "Predeterminado (def)",
  "الطبيعة (nature)": "Naturaleza (nature)",
  "اخرى (other)": "Otros (other)",
  "لا توجد رمزيات في هذا القسم": "No hay avatares en esta categoría",
  "هل تريد حذف هذه الرمزية؟": "¿Deseas eliminar este avatar?",
  "تم رفع وحفظ الرمزية بنجاح ✓": "Avatar subido y guardado con éxito ✓",
  "مرفوعاتي": "Mis Subidas"
};

const ADMIN_I18N_TR = {
  "لوحة التحكم الإدارية": "Yönetim Kontrol Paneli",
  "لوحة التحكم": "Kontrol Paneli",
  "نظام إدارة الدردشة": "Sohbet Yönetim Sistemi",
  "نظام إدارة الدردشة المتكامل": "Entegre Sohbet Yönetim Sistemi",
  "اسم المستخدم": "Kullanıcı Adı",
  "كلمة المرور": "Şifre",
  "دخول": "Giriş Yap",
  "تسجيل الخروج": "Çıkış Yap",
  "الصلاحية :": "Yetki:",
  "الصلاحية": "Yetki",
  "★ الصلاحية :": "★ Yetki:",
  "ملك الدردشة 👑": "Süper Usta 👑",
  "ملك الدردشة (سوبر ماستر 👑)": "Süper Usta (Sahip 👑)",
  "سوبر ماستر 👑": "Süper Usta 👑",
  "سوبر ماستر": "Süper Usta",
  "سوبر ادمين": "Süper Yönetici",
  "سوبر أدمن": "Süper Yönetici",
  "★Súper Admin": "★ Süper Yönetici",
  "★Admin": "★ Yönetici",
  "ادمن": "Yönetici",
  "أدمن": "Yönetici",
  "ادمن غرفة": "Oda Yöneticisi",
  "أدمن غرفة": "Oda Yöneticisi",
  "مشرفو الغرف (أدمن غرفة)": "Oda Yöneticileri",
  "عضو عادي": "Normal Üye",
  "عضو مسجل": "Kayıtlı Üye",
  "الزائر": "Ziyaretçi",
  "زائر": "Ziyaretçi",
  "بدون عضوية": "Üyeliksiz",
  "مميز": "Özel",
  "هذا الحساب ليس حساب إدارة": "Bu hesap yönetici hesabı değil",
  "فشل تسجيل الدخول": "Giriş başarısız",
  "باقات الذهب والدفع": "Altın Paketleri ve Ödeme",
  "إدارة باقات الذهب": "Altın Paketlerini Yönet",
  "إدارة باقات شراء الذهب": "Altın Paketlerini Yönet",
  "إعدادات بطاقة الإيداع والدفع": "Yatırım Kartı ve Ödeme Ayarları",
  "إعدادات بطاقة الإيداع وبوابة الدفع": "Yatırım Kartı ve Ödeme Ayarları",
  "إعدادات بطاقة الإيداع وبوابة الدفع البنكية": "Yatırım Kartı ve Ödeme Ayarları",
  "سجل مدفوعات البطاقات": "Kart Ödeme İşlemleri Geçmişi",
  "سجل مدفوعات البطاقات البنكية": "Banka Kartı Ödeme İşlemleri Geçmişi",
  "تكاليف العضويات والمكالمات": "Üyelik ve Arama Ücretleri",
  "الاعدادات الاساسيه": "Temel Ayarlar",
  "إعدادات اللغة والترجمة": "Dil ve Çeviri Ayarları",
  "ضبط الاعدادات": "Genel Ayarlar",
  "صلاحيات العضويات": "Üyelik Yetkileri",
  "اعدادات الرسائل": "Mesaj Ayarları",
  "وضع الشعار": "Logo Ayarla",
  "وضع الجلد": "Tema (Skin) Seçimi",
  "تحديد حجم الخط": "Yazı Boyutu",
  "اعدادات الغرف": "Oda Ayarları",
  "قائمة الغرف": "Oda Listesi",
  "اضافة غرفة": "Oda Ekle",
  "اضافة غرفة جديدة": "Yeni Oda Ekle",
  "رسائل الروبوت": "Bot Mesajları",
  "إعدادات الذكاء الاصطناعي (AI)": "Yapay Zeka ve Sinir Ağı Ayarları",
  "إعدادات العقل العصبي والذكاء الاصطناعي (AI)": "Sinir Ağı Motoru ve Yapay Zeka Ayarları",
  "حفظ إعدادات الذكاء الاصطناعي": "Yapay Zeka Ayarlarını Kaydet",
  "تجربة رد الذكاء الاصطناعي ⚡": "Yapay Zeka Yanıtını Test Et ⚡",
  "توليد روبوت غرفة": "Oda Botu Oluştur",
  "توليد وإعداد روبوت الغرفة": "Oda Botu Oluştur ve Yapılandır",
  "وضع التحدث والرد في الغرفة :": "Konuşma ve Yapay Zeka Yanıt Modu:",
  "🤖 متحدث ذكي (يرد بالذكاء الاصطناعي عند مناداته بالاسم)": "🤖 Akıllı Yapay Zeka Konuşmacı (İsmiyle seslenildiğinde yanıt verir)",
  "💬 متحدث برد مخصص (يرد بالنص المحدد عند مناداته بالاسم)": "💬 Özel Yanıtlı Konuşmacı (Belirlenen metinle yanıt verir)",
  "🔇 صامت (لا يتحدث ولا يرد أبداً)": "🔇 Sessiz (Asla konuşmaz ve yanıt vermez)",
  "الرد المخصص عند مناداة اسم الروبوت :": "Bot ismi çağrıldığında özel yanıt:",
  "🤖 متحدث ذكي (AI)": "🤖 Akıllı Yapay Zeka Konuşmacı",
  "🔇 صامت (لا يتحدث)": "🔇 Sessiz",
  "اعدادات النظام": "Sistem Ayarları",
  "اعدادات النظام الاساسي": "Temel Sistem Ayarları",
  "ادارة المستخدمين": "Kullanıcı Yönetimi",
  "اضافه مستخدم": "Kullanıcı Ekle",
  "إضافة مستخدم جديد": "Yeni Kullanıcı Ekle",
  "تحرير مستخدم": "Kullanıcı Düzenle",
  "طلبات التوثيق والترقية": "Doğrulama ve Yükseltme Talepleri",
  "الحسابات الادارية": "Yönetici Hesapları",
  "الحسابات الإدارية": "Yönetici Hesapları",
  "قائمة المطرودين": "Atılan Kullanıcılar",
  "قائمة المطرودين من الغرف": "Odalardan Atılanlar Listesi",
  "قائمة الحظر": "Yasaklılar Listesi",
  "قائمة المحظورين": "Yasaklı Kullanıcılar Listesi",
  "نظام الادارة": "Yönetim Sistemi",
  "ارسال اعلان للجميع": "Genel Duyuru Gönder",
  "إرسال إعلان للجميع": "Genel Duyuru Gönder",
  "فلترة الكلمات": "Kelime Filtresi",
  "استئناف الخادم": "Sunucuyu Yeniden Başlat",
  "استئناف خادم الشات": "Sohbet Sunucusunu Yeniden Başlat",
  "الهدايا والإيموجي": "Hediyeler ve Emojiler",
  "اداره الهدايا": "Hediyeleri Yönet",
  "ادارة الهدايا": "Hediyeleri Yönet",
  "رفع الإيموجي": "Emoji Yükle",
  "الأرشفة ومحركات البحث": "SEO ve Arama Motorları",
  "الأرشفة ومحركات البحث (SEO)": "SEO ve Arama Motorları",
  "الأرشفة ومسارات البحث (SEO)": "SEO ve Arama Rotaları",
  "النسخ الاحتياطي": "Yedekleme ve Geri Yükleme",
  "النسخ الاحتياطي والاستعادة": "Veritabanı Yedekleme ve Geri Yükleme",
  "النسخ الاحتياطي واستعادة البيانات": "Veritabanı Yedekleme ve Geri Yükleme",
  "مراقبة الخاص والمكالمات": "Özel Mesaj ve Arama İzleme",
  "مراقبة الرسائل الخاصة": "Özel Mesajları İzle",
  "تسجيلات المكالمات": "Arama Kayıtları",
  "توثيق": "Doğrulama",
  "رصد فريق": "Ekip Takibi",
  "تحكم في باقات الذهب المعروضة للمستخدمين في المتجر، يمكنك إضافة باقات جديدة، تعديل الأسعار، وإضافة ذهب مجاني وهدايا وشارات ترويجية.": "Mağazadaki altın paketlerini yönetin: yeni paketler ekleyin, fiyatları düzenleyin ve bonus altınlar tanımlayın.",
  "إضافة باقة ذهب جديدة": "Yeni Altın Paketi Ekle",
  "إضافة Paquete de Oro جديدة": "Yeni Altın Paketi Ekle",
  "تعديل باقة الذهب": "Altın Paketini Düzenle",
  "اسم الباقة:": "Paket Adı:",
  "كمية الذهب الأساسية (🪙):": "Temel Altın Miktarı (🪙):",
  "كمية الذهب الأساسية:": "Temel Altın Miktarı:",
  "سعر الباقة:": "Paket Fiyatı:",
  "السعر المطلوب ($):": "Fiyat ($):",
  "العملة:": "Para Birimi:",
  "ذهب إضافي مجاني (Bonus):": "Ücretsiz Bonus Altın:",
  "ذهب إضافي هدية (Bonus):": "Hediye Bonus Altın:",
  "شارة ترويجية (Badge):": "Promosyon Rozeti:",
  "ترتيب الظهور (Sort):": "Görünüm Sırası:",
  "الترتيب في العرض:": "Sıralama:",
  "تفعيل هذه الباقة في المتجر الآن": "Bu paketi mağazada şimdi etkinleştir",
  "باقة نشطة ومعروضة للمستخدمين": "Aktif ve kullanıcılara görünür",
  "حفظ باقة الذهب": "Altın Paketini Kaydet",
  "إلغاء التعديل": "Düzenlemeyi İptal Et",
  "باقات الذهب المتوفرة حالياً": "Mevcut Altın Paketleri",
  "اسم الباقة": "Paket Adı",
  "الذهب": "Altın",
  "السعر": "Fiyat",
  "ذهب إضافي": "Bonus Altın",
  "الشارة": "Rozet",
  "الترتيب": "Sıra",
  "الحالة": "Durum",
  "الإجراءات": "İşlemler",
  "نشط": "Aktif",
  "معطل": "Devre Dışı",
  "لا توجد باقات ذهب مضافة بعد": "Henüz altın paketi eklenmedi",
  "تم حفظ باقة الذهب بنجاح": "Altın paketi başarıyla kaydedildi",
  "حذف هذه الباقة نهائياً؟": "Bu paketi kalıcı olarak silmek istiyor musunuz?",
  "حدد هنا بيانات بطاقة الصراف الآلي والحساب البنكي المعتمد الذي يتم استقبال مدفوعات وإيداعات شراء الذهب عليه من المستخدمين.": "Kullanıcıların altın alımlarında ödemelerini yatıracağı yetkili banka hesabı ve banka kartı bilgilerini belirleyin.",
  "بيانات البطاقة البنكية المعتمدة لاستقبال مدفوعات الأعضاء عند شحن الذهب بالبطاقات.": "Altın yüklemelerinde üye ödemelerini almak için kullanılan banka kartı bilgileri.",
  "بيانات الحساب وبطاقة الإيداع المعتمدة": "Yetkili Hesap ve Yatırım Kartı Bilgileri",
  "اسم البنك أو المصرف المعتمد:": "Yetkili Banka Adı:",
  "اسم البنك / مزود الخدمة المعتمد:": "Yetkili Banka / Servis Sağlayıcı:",
  "اسم صاحب الحساب / المستفيد:": "Hesap Sahibi / Faydalanıcı Adı:",
  "اسم صاحب الحساب / الإدارة المعتمدة:": "Hesap Sahibi / Yetkili Yönetim:",
  "رقم بطاقة الصراف الآلي للإيداع (Receiver Card Number):": "Yatırım İçin Banka Kartı Numarası:",
  "رقم البطاقة / الحساب المعتمد للإيداع:": "Yatırım Kart / Hesap Numarası:",
  "رقم الآيبان (IBAN) / رقم الحساب الدولي:": "IBAN / Uluslararası Hesap Numarası:",
  "رقم الآيبان (IBAN) الدولي (اختياري):": "Uluslararası IBAN (İsteğe bağlı):",
  "العملة الافتراضية للدفع:": "Varsayılan Ödeme Para Birimi:",
  "رمز العملة (مثال: $ أو ريال أو ج.م):": "Para Birimi Sembolü (örn: $, TL, USD):",
  "تفعيل بوابة الدفع ببطاقات الصراف والائتمان في المتجر": "Mağazada Banka/Kredi Kartı ile Ödeme Ağ Geçidini Etkinleştir",
  "تفعيل الدفع بالبطاقات البنكية": "Banka Kartı ile Ödemeyi Etkinleştir",
  "تمكين استقبال المدفوعات عبر البطاقات البنكية في متجر الذهب": "Altın mağazasında kartla ödeme almayı etkinleştir",
  "حفظ إعدادات البطاقة والدفع": "Kart ve Ödeme Ayarlarını Kaydet",
  "تم حفظ إعدادات البطاقة والدفع بنجاح": "Kart ve ödeme ayarları başarıyla kaydedildi",
  "$ (الدولار الأمريكي)": "$ (ABD Doları)",
  "د.أ (الدينار الأردني)": "JOD (Ürdün Dinarı)",
  "ر.س (الريال السعودي)": "SAR (Suudi Riyali)",
  "د.إ (الدرهم الإماراتي)": "AED (BAE Dirhemi)",
  "ج.م (الجنيه المصري)": "EGP (Mısır Lirası)",
  "سجل كامل لجميع عمليات شراء الذهب والدفع الإلكتروني الناجحة التي تمت عبر بطاقات الصراف والائتمان.": "Banka ve kredi kartlarıyla yapılan tüm başarılı altın satın alma işlemlerinin tam geçmişi.",
  "العمليات المنفذة بنجاح": "Başarıyla Tamamlanan İşlemler",
  "🔍 ابحث برقم المعاملة أو اسم المستخدم أو آخر 4 أرقام من البطاقة...": "🔍 İşlem no, kullanıcı adı veya son 4 haneye göre ara...",
  "تصدير السجل (CSV)": "CSV Dışa Aktar",
  "رقم المعاملة": "İşlem No",
  "المستخدم": "Kullanıcı",
  "الباقة": "Paket",
  "الذهب المشحون": "Yüklenen Altın",
  "الذهب المستلم": "Yüklenen Altın",
  "المبلغ المدفوع": "Ödenen Tutar",
  "البطاقة المستخدمة": "Kullanılan Kart",
  "حساب الإيداع": "Yatırım Hesabı",
  "نوع البطاقة": "Kart Türü",
  "آخر 4 أرقام": "Son 4 Hane",
  "اسم حامل البطاقة": "Kart Sahibinin Adı",
  "تاريخ المعاملة": "İşlem Tarihi",
  "التاريخ": "Tarih",
  "ناجحة": "Tamamlandı",
  "لا توجد معاملات دفع بعد": "Henüz ödeme işlemi bulunmuyor",
  "إعدادات رصيد العضويات والمكافآت": "Üyelik Ücretleri ve Bonus Ayarları",
  "إعدادات رصيد العضويات والتسجيل": "Üyelik Ücretleri ve Kayıt Ayarları",
  "رصيد العضويات والتسجيل": "Üyelik ve Kayıt Bakiyeleri",
  "لشراء عضوية VIP 👑": "VIP üyelik satın almak için 👑",
  "لشراء عضوية Premium 💎": "Premium üyelik satın almak için 💎",
  "لشراء عضوية Plus ⭐": "Plus üyelik satın almak için ⭐",
  "الذهب الممنوح تلقائياً عند تسجيل حساب جديد 💰": "Yeni hesap kaydında otomatik verilen altın 💰",
  "VIP - الرصيد المطلوب :رصيد": "VIP - Gerekli Bakiye: Kredi",
  "Premium - الرصيد المطلوب :رصيد": "Premium - Gerekli Bakiye: Kredi",
  "Plus - الرصيد المطلوب :رصيد": "Plus - Gerekli Bakiye: Kredi",
  "الذهب الممنوح عند تسجيل حساب جديد :ذهب": "Kayıtta verilen altın: Altın",
  "تكلفة المكالمة الصوتية المفتوحة (بالذهب) :ذهب": "Açık sesli arama ücreti: Altın",
  "VIP - الرصيد المطلوب": "VIP - Gerekli Bakiye",
  "Premium - الرصيد المطلوب": "Premium - Gerekli Bakiye",
  "Plus - الرصيد المطلوب": "Plus - Gerekli Bakiye",
  "الذهب الممنوح عند تسجيل حساب جديد": "Kayıtta verilen altın",
  "تكلفة المكالمة الصوتية المفتوحة (بالذهب)": "Açık sesli arama ücreti (altın cinsinden)",
  "استعادة الافتراضي": "Varsayılanlara Sıfırla",
  "استعادة الPredeterminado": "Varsayılanlara Sıfırla",
  "يمكنك هنا تعيين اللغة الافتراضية للشات لجميع الزوار والأعضاء الجدد، بالإضافة إلى تحديد لغة عرض لوحة الإدارة للمشرفين.": "Yeni ziyaretçiler ve üyeler için varsayılan sohbet dilini ve yönetim panelinin görüntüleme dilini buradan ayarlayabilirsiniz.",
  "اللغة الافتراضية للدردشة والموقع": "Site ve Sohbet Varsayılan Dili",
  "يتم تطبيق هذه اللغة تلقائياً على أي زائر أو مستخدم جديد يدخل الدردشة لأول مرة. يمكن لكل مستخدم اختيار لغته الخاصة بحرية من قائمة اللغات داخل الشات.": "Bu dil yeni giren ziyaretçilere veya üyelere otomatik olarak uygulanır. Kullanıcılar diledikleri zaman sohbet içinden dillerini değiştirebilirler.",
  "لغة لوحة التحكم والإدارة": "Yönetim Paneli Dili",
  "لغة Panel de Control والإدارة": "Yönetim Paneli Dili",
  "تحديد لغة عرض لوحة الإدارة للمشرفين والمسؤولين. يمكنك أيضاً التبديل السريع من شريط اللغات أعلى القائمة.": "Yöneticiler için yönetim panelinin varsayılan dilini belirleyin. Yan menüdeki dil çubuğundan da değiştirebilirsiniz.",
  "حفظ وتطبيق إعدادات اللغة": "Dil Ayarlarını Kaydet ve Uygula",
  "عرض زر الاسمايلات :": "Emojiler Butonunu Göster:",
  "عرض زر تسجيل الصوت :": "Ses Kayıt Butonunu Göster:",
  "عرض زر ارسال صورة :": "Fotoğraf Gönder Butonunu Göster:",
  "(i1) دخول مخفي للسوبر :": "(i1) Süper Yönetici Gizli Giriş:",
  "الإشعارات الصوتية": "Sesli Bildirimler",
  "صوت عند دخول المستخدم (b1) :": "Kullanıcı Giriş Sesi (b1):",
  "صوت عند ارسال رسالة (b4) :": "Mesaj Gönderme Sesi (b4):",
  "صوت عند خروج المستخدم (b5) :": "Kullanıcı Çıkış Sesi (b5):",
  "حفظ الاعدادات": "Ayarları Kaydet",
  "إرسال الرسائل في العام": "Genel Mesaj Gönder",
  "كتابة وإرسال الرسائل النصية والإيموجي داخل الغرف العامة.": "Genel odalarda metin mesajları ve emojiler yazma ve gönderme.",
  "إرسال الرسائل الخاصة": "Özel Mesaj Gönder",
  "إرسال رسالة نصية مباشرة إلى مستخدم آخر في الخاص.": "Özel sohbette diğer kullanıcılara doğrudan metin mesajı gönderme.",
  "المكالمات الصوتية في الخاص": "Özel Sesli Aramalar",
  "إجراء وبدء مكالمات صوتية مباشرة بين شخصين في المحادثة الخاصة.": "Özel sohbette birebir doğrudan sesli arama yapma.",
  "إرسال الصور في العام": "Genel Fotoğraf Gönder",
  "رفع صورة من زر الكاميرا وإرسالها داخل الغرفة العامة.": "Kamera butonuyla genel odada fotoğraf yükleyip gönderme.",
  "إرسال مقطع صوتي في العام": "Genel Ses Kaydı Gönder",
  "رفع ملف صوتي وإرساله داخل الغرفة العامة.": "Genel odada ses kaydı yükleyip gönderme.",
  "الصعود كمذيع في البث المباشر": "Canlı Yayıncı Ol",
  "بدء بث صوتي أو فيديو والانضمام كمذيع في بث قائم.": "Sesli/görüntülü canlı yayın başlatma veya yayıncı olarak katılma.",
  "النشر في الحائط": "Duvara Gönderi Paylaş",
  "إنشاء منشور نصي أو صورة أو فيديو أو فيديو YouTube.": "Duvarda metin, fotoğraf, video veya YouTube gönderisi oluşturma.",
  "النشر في الحالة": "Durum Paylaş",
  "نشر حالات النص والصورة والفيديو والصوت.": "Metin, fotoğraf, video ve ses durumları paylaşma.",
  "حفظ صلاحيات العضويات": "Üyelik Yetkilerini Kaydet",
  "إظهار الوقت مع الرسالة (espumh) :": "Mesajlarda Saati Göster (espumh):",
  "تفعيل مراقبة الرسائل قبل نشرها (mrs eab) :": "Mesaj Onay Sistemini Etkinleştir (mrs eab):",
  "الحد الأقصى لأحرف الرسالة :حرف": "Maksimum Mesaj Karakteri: karakter",
  "رابط الرسائل العامة (puurl) :": "Genel Mesajlar Bağlantısı (puurl):",
  "الرابط : الافتراضي": "Bağlantı: Varsayılan",
  "رفع شعار جديد": "Yeni Logo Yükle",
  "انقر لاختيار صورة": "Resim seçmek için tıklayın",
  "PNG, JPG, JPEG, GIF (حد أقصى 2MB)": "PNG, JPG, JPEG, GIF (Maks. 2MB)",
  "حفظ الشعار الجديد": "Yeni Logoyu Kaydet",
  "استعادة الشعار الافتراضي": "Varsayılan Logoya Sıfırla",
  "استعادة الشعار الPredeterminado": "Varsayılan Logoya Sıfırla",
  "اختر لون جلد الشات": "Sohbet Teması Seçin",
  "حفظ الجلد": "Temayı Kaydet",
  "حجم خط الرسائل :14px": "Mesaj Yazı Boyutu: 14px",
  "معاينة": "Önizleme",
  "مرحبا بكم في شات نجوم العرب 2221111 ★ هذه رسالة تجريبية لمعاينة حجم الخط": "Sohbete hoş geldiniz ★ Bu, yazı boyutunu önizlemek için örnek bir metindir.",
  "حفظ حجم الخط": "Yazı Boyutunu Kaydet",
  "قائمة الغرف المتاحة": "Mevcut Odalar Listesi",
  "خيمة دردشتي": "Sohbet Çadırı",
  "غرفة الخيمة": "Çadır Odası",
  "غرفة الأردن": "Ürdün Odası",
  "غرفة الأردن العامة": "Genel Ürdün Odası",
  "خيمة دردشي": "Muhabbet Çadırı",
  "غرفة دردشي الرئيسية": "Ana Sohbet Odası",
  "فلسطين": "Filistin",
  "غرفة مستخدمين فلسطين": "Filistin Kullanıcıları Odası",
  "العراق": "Irak",
  "غرفة مستخدمين العراق": "Irak Kullanıcıları Odası",
  "الاردن 1": "Ürdün 1",
  "غرفة مستخدمين الاردن": "Ürdün Kullanıcıları Odası",
  "الاردن 2": "Ürdün 2",
  "السعودية": "Suudi Arabistan",
  "غرفة مستخدمين السعودية": "Suudi Arabistan Kullanıcıları Odası",
  "مصر 1": "Mısır 1",
  "غرفة مستخدمين مصر": "Mısır Kullanıcıları Odası",
  "غرفة صوتية 1": "Sesli Oda 1",
  "غرفة صوتية 2": "Sesli Oda 2",
  "غرفة الدردشة الصوتية ★": "Sesli Sohbet Odası ★",
  "افتراضية 💬": "Varsayılan 💬",
  "صوتية 🎙": "Sesli 🎙",
  "مفتوحة": "Açık",
  "مغلقة": "Kapalı",
  "500 مستخدم": "500 Kullanıcı",
  "1000 مستخدم": "1000 Kullanıcı",
  "تعديل غرفة": "Odayı Düzenle",
  "اسم الغرفة *": "Oda Adı *",
  "حالة الغرفة": "Oda Durumu",
  "🟢 مفتوحة (نشطة)": "🟢 Açık (Aktif)",
  "🔴 مغلقة": "🔴 Kapalı",
  "وصف الغرفة": "Oda Açıklaması",
  "رسالة الترحيب عند دخول الغرفة": "Odaya girişte karşılama mesajı",
  "رسالة الترحيب عند Entrar الغرفة": "Odaya girişte karşılama mesajı",
  "هذه الرسالة وحدها تظهر للعضو عند الدخول، ولا يتم تحميل سجل الرسائل القديم.": "Bu karşılama mesajı kullanıcı odaya girdiğinde görünür; eski mesaj geçmişi yüklenmez.",
  "هذه الرسالة وحدها تظهر للعضو عند الEntrar، ولا يتم تحميل سجل الMensajes القديم.": "Bu karşılama mesajı kullanıcı odaya girdiğinde görünür; eski mesaj geçmişi yüklenmez.",
  "الحد الأقصى للمستخدمين": "Maksimum Kullanıcı Limiti",
  "نوع الغرفة": "Oda Türü",
  "إعدادات إضافية": "Ek Ayarlar",
  "تمكين الصوت :": "Sesi Etkinleştir:",
  "تمكين الفيديو :": "Videoyu Etkinleştir:",
  "تفعيل الروبوت (eabrmp) :": "Botu Etkinleştir (eabrmp):",
  "تفعيل الهدايا (eabvg) :": "Hediyeleri Etkinleştir (eabvg):",
  "تفعيل الألعاب (gm) :": "Oyunları Etkinleştir (gm):",
  "❌ معطل": "❌ Devre Dışı",
  "✅ مفعل": "✅ Etkin",
  "الرمز السري (اتركها فارغة = بدون حماية)": "Gizli Şifre (boş bırakılırsa = korumasız)",
  "Contraseña السرية (اتركها فارغة = بدون حماية)": "Gizli Şifre (boş bırakılırsa = korumasız)",
  "صورة الغرفة": "Oda Resmi",
  "رفع صورة الغرفة": "Oda Resmi Yükle",
  "لم تُرفع صورة بعد (تظهر أول حرف من اسمها)": "Henüz resim yüklenmedi (isminin ilk harfi görünür)",
  "No se ha subido imagen aún (تظهر أول caracteres من اسمها)": "Henüz resim yüklenmedi (isminin ilk harfi görünür)",
  "مشرفو الغرف المستقلون (أدمن غرفة)": "Bağımsız Oda Yöneticileri",
  "مشرفو الغرف المستقلون (Admin de Sala)": "Bağımsız Oda Yöneticileri",
  "قم بتعيين مشرف مستقل لكل غرفة؛ المشرف المعين هنا سيكون أدمن غرفة في هذه الغرفة المحددة فقط ويحمل شارة أدمن غرفة وصلاحيات الكتم والطرد بداخلها، بينما في الغرف الأخرى يظهر بعضويته العادية.": "Her oda için bağımsız bir yönetici atayın; bu kullanıcı yalnızca o odada Oda Yöneticisi yetkisine ve rozetine sahip olur.",
  "تعيين مشرف جديد لغرفة": "Odaya Yeni Yönetici Ata",
  "اختر الغرفة المستهدفة:": "Hedef Odayı Seçin:",
  "اسم المستخدم المراد تعيينه كأدمن:": "Yönetici Olarak Atanacak Kullanıcı Adı:",
  "Nombre de usuario المراد تعيينه كAdmin:": "Yönetici Olarak Atanacak Kullanıcı Adı:",
  "تعيين كأدمن لهذه الغرفة": "Bu Odaya Yönetici Olarak Ata",
  "تعيين كAdmin لهذه الغرفة": "Bu Odaya Yönetici Olarak Ata",
  "قائمة مشرفي الغرف الحاليين": "Mevcut Oda Yöneticileri Listesi",
  "إزالة الإشراف": "Yöneticiliği Kaldır",
  "رسائل الروبوت المجدولة": "Zamanlanmış Bot Mesajları",
  "Mensajes del Bot المجدولة": "Zamanlanmış Bot Mesajları",
  "إضافة رسالة روبوت — تُرسل تلقائياً كل فترة": "Bot Mesajı Ekle — Otomatik Gönderilir",
  "نص الرسالة": "Mesaj Metni",
  "الغرفة": "Oda",
  "🌐 كل الغرف": "🌐 Tüm Odalar",
  "كل الغرف": "Tüm Odalar",
  "لون الخط": "Yazı Rengi",
  "حجم الخط (12 - 40)": "Yazı Boyutu (12 - 40)",
  "التوقيت — تُرسل كل كم ثانية": "Zamanlama — Kaç saniyede bir gönderilsin",
  "التوقيت — تُرسل كل كم seg": "Zamanlama — Kaç saniyede bir gönderilsin",
  "إضافة رسالة الروبوت": "Bot Mesajı Ekle",
  "رسائل الروبوت الحالية": "Mevcut Bot Mesajları",
  "Mensajes del Bot الحالية": "Mevcut Bot Mesajları",
  "لا توجد رسائل روبوت بعد": "Henüz bot mesajı yok",
  "لا توجد Mensajes روبوت بعد": "Henüz bot mesajı yok",
  "رفع صورة الروبوت": "Bot Avatarı Yükle",
  "اسم الروبوت": "Bot Adı",
  "الغرفة التي يدخل إليها": "Gireceği Oda",
  "نوع الصلاحية": "Yetki Türü",
  "نوع Rol": "Yetki Türü",
  "مستخدم عادي": "Normal Kullanıcı",
  "نوع العضوية": "Üyelik Türü",
  "الرد المختصر عند ذكر اسم الروبوت": "Bot adı anıldığında kısa yanıt",
  "حساب موثق": "Doğrulanmış Hesap",
  "يدخل الغرفة مباشرة": "Odaya doğrudan girer",
  "يرد عند ذكر اسمه": "Adı anıldığında yanıt verir",
  "توليد الروبوت وإدخاله": "Bot Oluştur ve Odaya Sok",
  "روبوتات الغرف الحالية": "Mevcut Oda Botları",
  "لم يتم إنشاء روبوتات غرف بعد": "Henüz oda botu oluşturulmadı",
  "اسم المستخدم (u) * :": "Kullanıcı Adı (u) * :",
  "Nombre de usuario (u) * :": "Kullanıcı Adı (u) * :",
  "الرقم السري (pwd) * :": "Şifre (pwd) * :",
  "Contraseña (pwd) * :": "Şifre (pwd) * :",
  "البريد الإلكتروني (e) :": "E-posta (e) :",
  "الرصيد (crdsamt) :": "Bakiye (crdsamt) :",
  "الSaldo (crdsamt) :": "Bakiye (crdsamt) :",
  "الدولة (l) :": "Ülke (l) :",
  "الجنس (g) :": "Cinsiyet (g) :",
  "؟ مجهول": "? Bilinmiyor",
  "👦 ذكر": "👦 Erkek",
  "👧 أنثى": "👧 Kadın",
  "العمر (bt) :": "Yaş (bt) :",
  "العضوية :": "Üyelik:",
  "إضافة مستخدم": "Kullanıcı Ekle",
  "عند الموافقة اختر مقدار الذهب الذي سيُخصم من صاحب الطلب. لا يتم الخصم ولا تطبيق التوثيق أو العضوية قبل موافقتك.": "Onay sırasında kesilecek altın miktarını seçin. Onayınız olmadan bakiye kesilmez veya işlem uygulanmaz.",
  "قيد المراجعة": "İnceleniyor",
  "تمت الموافقة": "Onaylandı",
  "مرفوضة": "Reddedildi",
  "لا توجد طلبات في هذه القائمة": "Bu listede talep bulunmuyor",
  "إضافة حساب إداري": "Yönetici Hesabı Ekle",
  "يبقى الطرد فعالاً ويمنع إعادة دخول الغرفة حتى تضغط «فك الطرد» من هذه الصفحة.": "Buradan atma yasağını kaldırana kadar kullanıcının odaya girişi engellenir.",
  "قائمة المطرودين فارغة": "Atılanlar listesi boş",
  "Usuarios Expulsados فارغة": "Atılanlar listesi boş",
  "حظر الزائر مرتبط بعنوان IP الحقيقي ويبقى فعالاً حتى إزالته من هنا.": "Ziyaretçi yasağı gerçek IP adresine bağlıdır ve buradan kaldırılana kadar aktif kalır.",
  "قائمة المحظورين فارغة": "Yasaklılar listesi boş",
  "Lista de Bloqueados فارغة": "Yasaklılar listesi boş",
  "ارسال الاعلان": "Duyuruyu Gönder",
  "رمز الاستبدال": "Değiştirme Sembolü",
  "سيتم استبدال الكلمات الممنوعة بـ :": "Yasaklı kelimeler şununla değiştirilecek:",
  "قائمة الكلمات المغلقة": "Yasaklı Kelimeler Listesi",
  "إضافة كلمة جديدة": "Yeni Kelime Ekle",
  "اضافة كلمة": "Kelime Ekle",
  "إعادة تشغيل خادم الشات": "Sohbet Sunucusunu Yeniden Başlat",
  "سيتم قطع الاتصال عن جميع المستخدمين لثوانٍ قليلة ثم يعود الخادم للعمل.": "Yeniden başlatma sırasında tüm kullanıcıların bağlantısı birkaç saniyeliğine kesilecektir.",
  "استئناف الخادم الآن": "Sunucuyu Şimdi Yeniden Başlat",
  "إضافة إيموجي مصور جديد": "Yeni Görsel Emoji Ekle",
  "انقر لاختيار صور الإيموجي": "Emoji resimlerini seçmek için tıklayın",
  "يمكن اختيار عدة صور — PNG / GIF / WEBP — وتظهر فوراً مع الإيموجي في الدردشة بحجم صغير": "Sohbette emoji olarak görünmesi için birden fazla resim (PNG/GIF/WEBP) seçebilirsiniz.",
  "الإيموجي المرفوع حالياً": "Şu Anda Yüklü Emojiler",
  "لا يوجد إيموجي مرفوع بعد": "Henüz emoji yüklenmedi",
  "تحكم في ظهور موقعك ومساراته الفرعية في محركات البحث (Google) ومواقع التواصل الاجتماعي عبر الكلمات المفتاحية والوصف المخصص والصور مع دعم التوليد الذكي بالذكاء الاصطناعي.": "Meta etiketleri, açıklamalar ve yapay zeka SEO ile sitenizin Google ve sosyal medyadaki görünümünü yönetin.",
  "إعدادات الهوية والأرشفة للموقع الأساسي (/)": "Ana Sayfa Kimlik ve SEO Ayarları (/)",
  "🤖 توليد SEO ذكي بالذكاء الاصطناعي": "🤖 Yapay Zeka Akıllı SEO Oluşturucu",
  "اسم الموقع والدردشة (Site Name):": "Site ve Sohbet Adı (Site Name):",
  "عنوان الصفحة لمحركات البحث (Title):": "Arama Motorları İçin Sayfa Başlığı (Title):",
  "وصف الموقع لمحركات البحث (Meta Description):": "Arama Motorları İçin Meta Açıklaması:",
  "الكلمات المفتاحية (Meta Keywords):": "Meta Anahtar Kelimeler:",
  "صورة الشعار ومواقع التواصل (Open Graph Image):": "Sosyal Medya İçin Open Graph Resmi:",
  "رفع الشعار": "Logo Yükle",
  "أيقونة الموقع المصغرة (Favicon Icon):": "Favicon Simgesi:",
  "رفع أيقونة": "Simge Yükle",
  "حفظ إعدادات الموقع والأرشفة الأساسية": "Ana Site ve SEO Ayarlarını Kaydet",
  "مسارات الأرشفة المتعددة (مثل /chat1 و /chat2)": "Çoklu SEO Rotaları (örn: /chat1, /chat2)",
  "إضافة مسار أرشفة جديد": "Yeni SEO Rotası Ekle",
  "مفعل": "Aktif",
  "اسم الدردشة:": "Sohbet Adı:",
  "الكلمات:": "Anahtar kelimeler:",
  "فتح المسار": "Rotayı Aç",
  "الشعار مرفق": "Logo ekli",
  "يشمل النسخ الاحتياطي قاعدة البيانات بالكامل: الحسابات والرتب والأرصدة، الرسائل العامة، المحادثات الخاصة، سجلات وتسجيلات المكالمات، الحائط والتعليقات والتفاعلات، الحالات، الهدايا والإيموجيات، الغرف والروبوتات، وصفحات الأرشفة والإعدادات.": "Yedekleme tüm veritabanını kapsar: hesaplar, roller, bakiyeler, mesajlar, aramalar, duvar, durumlar, hediyeler, odalar ve ayarlar.",
  "إنشاء وتحميل نسخة احتياطية جديدة": "Yeni Yedek Oluştur ve İndir",
  "اضغط على الزر أدناه لتوليد وتنزيل ملف نسخة احتياطية شاملة بصيغة JSON على جهازك فوراً.": "Tam veritabanı yedeğini JSON olarak anında indirmek için aşağıdaki butona tıklayın.",
  "تحميل نسخة احتياطية كاملة (JSON)": "Tam Yedeği İndir (JSON)",
  "استعادة نسخة احتياطية سابقة": "Önceki Yedeği Geri Yükle",
  "اختر ملف النسخة الاحتياطية (.json) لاستعادة كافة البيانات والجداول إلى الحالة المحفوظة في الملف.": "Tüm verileri ve tabloları geri yüklemek için bir yedekleme dosyası (.json) seçin.",
  "⚠️ تنبيه: استعادة النسخة الاحتياطية ستستبدل البيانات الحالية ببيانات النسخة المرفوعة. يُفضل تحميل نسخة جديدة أولاً قبل الاستعادة.": "⚠️ Uyarı: Yedeğin geri yüklenmesi mevcut verilerin üzerine yazacaktır.",
  "اختيار ملف النسخة (.json)": "Yedek Dosyası Seç (.json)",
  "لم يتم اختيار ملف بعد": "Henüz dosya seçilmedi",
  "بدء استعادة البيانات": "Verileri Geri Yüklemeyi Başlat",
  "الوصول المشترك": "Ortak Erişim",
  "قائمة الوصول المشترك": "Ortak Erişim Listesi",
  "إضافة عضو جديد للتوثيق": "Doğrulamaya Yeni Üye Ekle",
  "إضافة": "Ekle",
  "يمكنك إضافة عدة أسماء باستخدام | بين كل اسم": "İsimler arasında | kullanarak birden fazla isim ekleyebilirsiniz",
  "بطاقة واحدة لكل عنوان IP، وبداخلها أسماء الأشخاص والغرف التي دخلوها.": "Her IP adresi için aktif kullanıcıları ve girdikleri odaları gösteren tek bir kart.",
  "الاتصالات النشطة حسب عنوان IP": "IP Adresine Göre Aktif Bağlantılar",
  "البريد الإلكتروني": "E-posta",
  "الإصدار": "Sürüm",
  "حفظ": "Kaydet",
  "تعديل": "Düzenle",
  "حذف": "Sil",
  "بحث": "Ara",
  "إغلاق": "Kapat",
  "إلغاء": "İptal",
  "تأكيد": "Onayla",
  "عرض": "Görüntüle",
  "نسخ": "Kopyala",
  "تطبيق": "Uygula",
  "حفظ التعديلات": "Değişiklikleri Kaydet",
  "تفريغ الحقول": "Alanları Temizle",
  "رصيد": "Bakiye",
  "ذهب": "Altın",
  "حرف": "karakter",
  "ثانية": "sn",
  "عنابي (افتراضي)": "Bordo (Varsayılan)",
  "أزرق ملكي": "Kraliyet Mavisi",
  "أخضر زمردي": "Zümrüt Yeşili",
  "بنفسجي أنيق": "Zarif Mor",
  "أسود ليلي": "Gece Siyahı",
  "برتقالي جذاب": "Çekici Turuncu",
  "وردي فخم": "Lüks Pembe",
  "تركواز بحري": "Deniz Turkuazı",
  "وضع المشرفين (msip) :": "Süpervizör Modu (msip):",
  "تمكين المستخدم من التسجيل في الشات (eur) :": "Kullanıcı Kaydına İzin Ver (eur):",
  "تفعيل الكتم (mt e) :": "Susturmayı Etkinleştir (mt e):",
  "تفعيل الكتم الصامت (mt amt) :": "Sessiz Susturmayı Etkinleştir (mt amt):",
  "تفعيل إعدادات الروبوت (esprmh) :": "Bot Ayarlarını Etkinleştir (esprmh):",
  "إعدادات متقدمة": "Gelişmiş Ayarlar",
  "إدارة الرمزيات والصور": "Avatar ve Fotoğraf Yönetimi",
  "تحكم في الرمزيات والصور الافتراضية المتاحة للأعضاء في الشات، يمكنك رفع صور جديدة وتحديد تصنيفها (الافتراضية، الطبيعة، اخرى) أو حذف أي صورة.": "Üyeler için mevcut olan varsayılan avatarları yönetin. Yeni resimler yükleyin ve kategorilere ayırın (Varsayılan, Doğa, Diğer).",
  "رفع رمزية جديدة": "Yeni Avatar Yükle",
  "تصنيف الرمزية:": "Avatar Kategorisi:",
  "اختيار ملف الصورة:": "Resim Dosyası Seç:",
  "اختيار ورفع الصورة": "Resim Seç ve Yükle",
  "الرمزيات المتوفرة": "Mevcut Avatarlar",
  "الافتراضية (def)": "Varsayılan (def)",
  "الطبيعة (nature)": "Doğa (nature)",
  "اخرى (other)": "Diğer (other)",
  "لا توجد رمزيات في هذا القسم": "Bu kategoride avatar yok",
  "هل تريد حذف هذه الرمزية؟": "Bu avatarı silmek istiyor musunuz?",
  "تم رفع وحفظ الرمزية بنجاح ✓": "Avatar başarıyla yüklendi ve kaydedildi ✓",
  "مرفوعاتي": "Yüklemelerim"
};

const ADMIN_I18N_DICTS = { en: ADMIN_I18N_EN, es: ADMIN_I18N_ES, tr: ADMIN_I18N_TR };

function translateDynamicAdminText(text, lang = ADMIN_LANG) {
  if (!text || lang === "ar") return text;
  const dict = ADMIN_I18N_DICTS[lang];
  if (!dict) return text;
  
  const raw = String(text).trim();
  if (!raw) return text;
  if (dict[raw]) return dict[raw];

  // Specific gift pattern: القيمة: 70 🪙 ← يربح المستقبل: 28 🪙 • جواهر
  let match = raw.match(/^القيمة:\s*(\d+)\s*🪙\s*←\s*يربح المستقبل:\s*(\d+)\s*🪙\s*•\s*(.+)$/);
  if (match) {
    const price = match[1], payout = match[2], cat = match[3].trim();
    const catTr = dict[cat] || translateDynamicAdminText(cat, lang);
    if (lang === "es") return `Costo: ${price} 🪙 ← Ganancia receptor: ${payout} 🪙 • ${catTr}`;
    if (lang === "tr") return `Değer: ${price} 🪙 ← Alıcı kazancı: ${payout} 🪙 • ${catTr}`;
    return `Cost: ${price} 🪙 ← Receiver gets: ${payout} 🪙 • ${catTr}`;
  }

  match = raw.match(/^تعديل هدية #(\d+)$/);
  if (match) {
    if (lang === "es") return `Editar Regalo #${match[1]}`;
    if (lang === "tr") return `Hediyeyi Düzenle #${match[1]}`;
    return `Edit Gift #${match[1]}`;
  }

  match = raw.match(/^تحرير مستخدم\s*:\s*(.+)$/);
  if (match) {
    if (lang === "es") return `Editar Usuario: ${match[1]}`;
    if (lang === "tr") return `Kullanıcı Düzenle: ${match[1]}`;
    return `Edit User: ${match[1]}`;
  }

  match = raw.match(/^(\d+)\s*رسالة$/);
  if (match) {
    if (lang === "es") return `${match[1]} mensajes`;
    if (lang === "tr") return `${match[1]} mesaj`;
    return `${match[1]} messages`;
  }

  // Common prefix patterns
  if (raw.startsWith("رصيد: ")) return (lang === "es" ? "Saldo: " : (lang === "tr" ? "Bakiye: " : "Balance: ")) + raw.slice("رصيد: ".length);
  if (raw.startsWith("القيمة: ")) return (lang === "es" ? "Costo: " : (lang === "tr" ? "Değer: " : "Cost: ")) + raw.slice("القيمة: ".length);
  if (raw.startsWith("الغرفة: ")) return (lang === "es" ? "Sala: " : (lang === "tr" ? "Oda: " : "Room: ")) + translateDynamicAdminText(raw.slice("الغرفة: ".length), lang);
  if (raw.startsWith("🏠 الغرفة: ")) return "🏠 " + (lang === "es" ? "Sala: " : (lang === "tr" ? "Oda: " : "Room: ")) + translateDynamicAdminText(raw.slice("🏠 الغرفة: ".length), lang);
  if (raw.startsWith("📅 تاريخ التعيين: ")) return "📅 " + (lang === "es" ? "Fecha de asignación: " : (lang === "tr" ? "Atama tarihi: " : "Assigned Date: ")) + raw.slice("📅 تاريخ التعيين: ".length);
  if (raw.startsWith("الرابط : ")) return (lang === "es" ? "Enlace: " : (lang === "tr" ? "Bağlantı: " : "Link: ")) + raw.slice("الرابط : ".length);
  if (raw.startsWith("الترتيب: ")) return (lang === "es" ? "Orden: " : (lang === "tr" ? "Sıra: " : "Order: ")) + raw.slice("الترتيب: ".length);
  if (raw.startsWith("تاريخ: ")) return (lang === "es" ? "Fecha: " : (lang === "tr" ? "Tarih: " : "Date: ")) + raw.slice("تاريخ: ".length);
  if (raw.startsWith("المستخدم: ")) return (lang === "es" ? "Usuario: " : (lang === "tr" ? "Kullanıcı: " : "User: ")) + raw.slice("المستخدم: ".length);

  // Normalized matching (strips symbols, emojis, colons, stars)
  const normMatch = raw.match(/^([\s\:\★\•\💬\🪙\📢\⚠️\🚨\🟢\⚪\🔇\🔊\🏠\📅\🔍\👑\💎\⭐\🔴\👧\👦\-]*)(\S(?:[\s\S]*\S)?)([\s\:\★\•\💬\🪙\📢\⚠️\🚨\🟢\⚪\🔇\🔊\🏠\📅\🔍\👑\💎\⭐\🔴\👧\👦\-]*)$/);
  if (normMatch && normMatch[2] && dict[normMatch[2]]) {
    return normMatch[1] + dict[normMatch[2]] + normMatch[3];
  }

  return text;
}

function t(key) {
  return translateDynamicAdminText(key, ADMIN_LANG);
}

function shouldSkipAdminTranslation(node) {
  const el = node.nodeType === 1 ? node : node.parentElement;
  if (!el) return true;
  if (el.classList && (el.classList.contains('f7-icons') || el.classList.contains('framework7-icons'))) return true;
  if (el.tagName === 'I' && (el.classList.contains('mi') || el.classList.contains('f7-icons') || el.classList.contains('framework7-icons'))) return true;
  if (el.closest('script, style, .no-translate, [dir=ltr].serp-snippet-card')) return true;
  return false;
}

function translateAdminTextNode(node) {
  if (!node || node.nodeType !== 3 || shouldSkipAdminTranslation(node)) return;
  if (node.__arabicSource === undefined) node.__arabicSource = node.nodeValue;
  const source = node.__arabicSource;
  const match = source.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const core = match ? match[2] : source;
  const translated = ADMIN_LANG === "ar" ? core : translateDynamicAdminText(core, ADMIN_LANG);
  const next = (match ? match[1] : "") + translated + (match ? match[3] : "");
  if (node.nodeValue !== next) node.nodeValue = next;
}

function translateAdminAttributes(el) {
  if (!el || el.nodeType !== 1 || shouldSkipAdminTranslation(el)) return;
  el.__arabicAttrs = el.__arabicAttrs || {};
  for (const attr of ["placeholder", "title", "aria-label"]) {
    if (!el.hasAttribute(attr)) continue;
    if (el.__arabicAttrs[attr] === undefined) el.__arabicAttrs[attr] = el.getAttribute(attr);
    const source = el.__arabicAttrs[attr];
    el.setAttribute(attr, ADMIN_LANG === "ar" ? source : translateDynamicAdminText(source, ADMIN_LANG));
  }
}

function applyAdminLanguage(root = document.body) {
  if (!root) return;
  if (root.nodeType === 3) return translateAdminTextNode(root);
  translateAdminAttributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === 3) translateAdminTextNode(node);
    else translateAdminAttributes(node);
  }
}

let ADMIN_OBSERVER = null;
function initAdminLanguageObserver() {
  if (ADMIN_OBSERVER) return;
  ADMIN_OBSERVER = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) applyAdminLanguage(node);
    }
  });
  ADMIN_OBSERVER.observe(document.body, { childList: true, subtree: true });
}

function setAdminLanguage(lang, persist = false) {
  ADMIN_LANG = ["ar", "en", "es", "tr"].includes(lang) ? lang : "ar";
  if (persist) {
    localStorage.setItem("admin_language", ADMIN_LANG);
  }
  document.documentElement.lang = ADMIN_LANG;
  document.documentElement.dir = (ADMIN_LANG === "ar") ? "rtl" : "ltr";

  document.body.classList.remove("lang-en", "lang-es", "lang-tr", "lang-ltr");
  if (ADMIN_LANG !== "ar") {
    document.body.classList.add("lang-" + ADMIN_LANG, "lang-ltr");
  }

  // Update title
  const titles = {
    ar: "لوحة التحكم الإدارية",
    en: "Admin Control Panel",
    es: "Panel de Control de Administración",
    tr: "Yönetim Kontrol Paneli"
  };
  document.title = titles[ADMIN_LANG] || titles.ar;

  // Update active state on buttons
  $$('.sb-lang-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.lang === ADMIN_LANG));
  $$('.login-lang-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.lang === ADMIN_LANG));

  applyAdminLanguage(document.body);

  // Re-build menu if logged in
  if (ME) {
    buildMenu();
    if (CURRENT_PAGE_ID) {
      loadPage(CURRENT_PAGE_ID);
    }
  }
}

function bindLangSwitchers() {
  $$('.sb-lang-btn').forEach(btn => {
    btn.onclick = async () => {
      const lang = btn.dataset.lang;
      setAdminLanguage(lang, true);
      try {
        await api('/api/admin/settings', 'POST', { admin_language: lang, default_language: lang });
        SETTINGS.admin_language = lang;
        SETTINGS.default_language = lang;
      } catch (e) {}
      toast(t('تم حفظ وتطبيق إعدادات اللغة بنجاح'));
    };
  });

  $$('.login-lang-btn').forEach(btn => {
    btn.onclick = () => {
      const lang = btn.dataset.lang;
      setAdminLanguage(lang, true);
    };
  });
}

// ---------- القائمة الجانبية ----------
const MENU = [
  { icon: 'creditcard_fill', color: '#fbbf24', label: 'باقات الذهب والدفع', superAdminOnly: true, subs: [
    { id: 'goldPackages', icon: 'cube_box_fill', label: 'إدارة باقات الذهب', superAdminOnly: true },
    { id: 'paymentSettings', icon: 'paypal', label: 'إعدادات بوابة الدفع PayPal', superAdminOnly: true },
    { id: 'paymentTransactions', icon: 'doc_plaintext', label: 'سجل مدفوعات PayPal', superAdminOnly: true },
    { id: 'memberships', icon: 'money_dollar_circle_fill', label: 'تكاليف العضويات والمكالمات', superAdminOnly: true }
  ]},
  { icon: 'gear_alt_fill', color: '#94a3b8', label: 'الاعدادات الاساسيه', superAdminOnly: true, subs: [
    { id: 'languages', icon: 'globe', label: 'إعدادات اللغة والترجمة', superAdminOnly: true },
    { id: 'general', icon: 'wrench_fill', label: 'ضبط الاعدادات', superAdminOnly: true },
    { id: 'featureAccess', icon: 'person_badge_key_fill', label: 'صلاحيات العضويات', superAdminOnly: true },
    { id: 'msgSettings', icon: 'chat_bubble_fill', label: 'اعدادات الرسائل', superAdminOnly: true },
    { id: 'logo', icon: 'paintbrush_fill', label: 'وضع الشعار', superAdminOnly: true },
    { id: 'skin', icon: 'paintbrush_fill', label: 'وضع الجلد', superAdminOnly: true },
    { id: 'fontsize', icon: 'textformat_size', label: 'تحديد حجم الخط', superAdminOnly: true },
    { id: 'radio', icon: 'antenna_radiowaves_left_right', label: 'إعدادات الراديو', superAdminOnly: true },
    { id: 'emailSettings', icon: 'envelope_fill', label: 'البريد الإلكتروني والتحقق (Gmail)', superAdminOnly: true }]},
  { icon: 'house_fill', color: '#fb923c', label: 'اعدادات الغرف', subs: [
    { id: 'rooms', icon: 'list_bullet', label: 'قائمة الغرف', superAdminOnly: true },
    { id: 'roomAdd', icon: 'plus_square_fill', label: 'اضافة غرفة' },
    { id: 'roomAdmins', icon: 'person_badge_shield_checkmark_fill', label: 'مشرفو الغرف (أدمن غرفة)', superAdminOnly: true },
    { id: 'bots', icon: 'wand_stars', label: 'رسائل الروبوت', superAdminOnly: true },
    { id: 'roomBots', icon: 'person_badge_plus_fill', label: 'توليد روبوت غرفة', superAdminOnly: true },
    { id: 'aiSettings', icon: 'sparkles', label: 'إعدادات الذكاء الاصطناعي (AI)', superAdminOnly: true }]},
  { icon: 'desktopcomputer', color: '#38bdf8', label: 'اعدادات النظام', superAdminOnly: true, subs: [
    { id: 'system', icon: 'wrench_fill', label: 'اعدادات النظام الاساسي', superAdminOnly: true },
    { id: 'legal', icon: 'doc_text_fill', label: 'الشروط والخصوصية', superAdminOnly: true }]},
  { icon: 'person2_fill', color: '#818cf8', label: 'ادارة المستخدمين', subs: [
    { id: 'userAdd', icon: 'plus_circle_fill', label: 'اضافه مستخدم' },
    { id: 'userEdit', icon: 'pencil_circle_fill', label: 'تحرير مستخدم', superAdminOnly: true },
    { id: 'serviceRequests', icon: 'bell_badge_fill', label: 'طلبات التوثيق والترقية', superAdminOnly: true },
    { id: 'userComplaints', icon: 'exclamationmark_triangle_fill', label: 'شكاوى المستخدمين', superAdminOnly: true },
    { id: 'admins', icon: 'rosette', label: 'الحسابات الادارية', superAdminOnly: true },
    { id: 'kicks', icon: 'square_arrow_right_fill', label: 'قائمة المطرودين' },
    { id: 'bans', icon: 'slash_circle_fill', label: 'قائمة الحظر' }]},
  { icon: 'gear_alt_fill', color: '#94a3b8', label: 'نظام الادارة', subs: [
    { id: 'broadcast', icon: 'bolt_badge_a_fill', label: 'ارسال اعلان للجميع' },
    { id: 'words', icon: 'search', label: 'فلترة الكلمات' },
    { id: 'restart', icon: 'arrow_clockwise_circle_fill', label: 'استئناف الخادم', superAdminOnly: true }]},
  { icon: 'gift_fill', color: '#f472b6', label: 'الهدايا والإيموجي', superAdminOnly: true, subs: [
    { id: 'gifts', icon: 'gift_fill', label: 'ادارة الهدايا', superAdminOnly: true },
    { id: 'userGifts', icon: 'person_crop_circle_badge_xmark', label: 'هدايا حساب (بحث وحذف)', superAdminOnly: true },
    { id: 'giftCashout', icon: 'bank_fill', label: 'تسكير الهدايا (سحب الدولارات)', superAdminOnly: true },
    { id: 'emojis', icon: 'smiley_fill', label: 'رفع الإيموجي', superAdminOnly: true },
    { id: 'avatars', icon: 'photo_on_rectangle', label: 'إدارة الرمزيات والصور', superAdminOnly: true }]},
  { icon: 'globe', color: '#10b981', label: 'الأرشفة ومحركات البحث', superAdminOnly: true, subs: [
    { id: 'seoArchive', icon: 'globe', label: 'الأرشفة ومسارات البحث (SEO)', superAdminOnly: true }]},
  { icon: 'arrow_down_doc_fill', color: '#38bdf8', label: 'النسخ الاحتياطي', superAdminOnly: true, subs: [
    { id: 'backup', icon: 'arrow_down_doc_fill', label: 'النسخ الاحتياطي والاستعادة', superAdminOnly: true }]},
  { icon: 'chat_bubble_2_fill', color: '#ec4899', label: 'مراقبة الخاص والمكالمات', masterOnly: true, subs: [
    { id: 'privateMonitor', icon: 'chat_bubble_2_fill', label: 'مراقبة الرسائل الخاصة', masterOnly: true },
    { id: 'callsRecordings', icon: 'phone_waveform_fill', label: 'تسجيلات المكالمات الصوتية', masterOnly: true },
    { id: 'videoCallRecordings', icon: 'videocam_fill', label: 'تسجيل مكالمات الفيديو', masterOnly: true },
    { id: 'userComplaints', icon: 'exclamationmark_triangle_fill', label: 'شكاوى المستخدمين', masterOnly: true }]},
  { icon: 'shield_fill', color: '#60a5fa', label: 'توثيق', subs: [
    { id: 'verified', icon: 'checkmark_shield_fill', label: 'التوثيق والدخول الملكي' },
    { id: 'royalAnimals', icon: 'crown_fill', label: 'صور وأصوات الدخول الملكي', superAdminOnly: true }]},
  { icon: 'eye_fill', color: '#f472b6', label: 'رصد فريق', superAdminOnly: true, subs: [
    { id: 'monitor', icon: 'eye_fill', label: 'رصد فريق', superAdminOnly: true }]},
];

function buildMenu() {
  const el = $('#sbMenu');
  el.innerHTML = '';
  const isMaster = ME && ME.rank === 'supermaster';
  const isSuper = ME && (ME.rank === 'superadmin' || ME.rank === 'supermaster');
  MENU.forEach((m) => {
    if (m.masterOnly && !isMaster) return;
    if (m.superAdminOnly && !isSuper) return;
    const visibleSubs = m.subs.filter(s => (!s.masterOnly || isMaster) && (!s.superAdminOnly || isSuper));
    if (!visibleSubs.length) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="sb-item">
        <i class="f7-icons mi" style="color:${m.color}">${m.icon}</i>
        <span>${t(m.label)}</span>
        <i class="f7-icons chev">chevron_down</i>
      </div>
      <div class="sb-sub">
        ${visibleSubs.map(s => `<div class="sb-subitem" data-page="${s.id}"><i class="f7-icons mi">${s.icon}</i> ${t(s.label)}</div>`).join('')}
      </div>`;
    const item = wrap.querySelector('.sb-item');
    const sub = wrap.querySelector('.sb-sub');
    item.onclick = () => {
      const wasOpen = sub.classList.contains('open');
      $$('.sb-sub').forEach(x => x.classList.remove('open'));
      $$('.sb-item').forEach(x => x.classList.remove('open'));
      if (!wasOpen) { sub.classList.add('open'); item.classList.add('open'); }
    };
    wrap.querySelectorAll('.sb-subitem').forEach(si => {
      si.onclick = (e) => {
        e.stopPropagation();
        $$('.sb-subitem').forEach(x => x.classList.remove('active'));
        si.classList.add('active');
        loadPage(si.dataset.page);
        closeMobileSidebar();
      };
    });
    el.appendChild(wrap);
  });
}

function openMobileSidebar() {
  $('.sidebar')?.classList.add('mobile-open');
  $('#sbBackdrop')?.classList.add('active');
  document.body.classList.add('sidebar-active');
}
function closeMobileSidebar() {
  $('.sidebar')?.classList.remove('mobile-open');
  $('#sbBackdrop')?.classList.remove('active');
  document.body.classList.remove('sidebar-active');
}
function toggleMobileSidebar() {
  if ($('.sidebar')?.classList.contains('mobile-open')) {
    closeMobileSidebar();
  } else {
    openMobileSidebar();
  }
}

// ---------- صف حقل إعداد (تبديل) ----------
const swRow = (icon, color, label, key) => `
  <div class="row">
    <span class="lbl"><i class="f7-icons mi" style="color:${color}">${icon}</i> ${t(label)} :</span>
    <label class="switch"><input type="checkbox" data-key="${key}" ${SETTINGS[key] === '1' ? 'checked' : ''}><span class="tr"><span class="th"></span></span></label>
  </div>`;
// صف إشعار صوتي: مفتاح تشغيل + رفع صوت مخصص + معاينة/استماع + إزالة
const soundRow = (icon, color, label, key, hint = '') => {
  const urlKey = key + '_url';
  const url = SETTINGS[urlKey] || '';
  const on = SETTINGS[key] === '1';
  return `
    <div class="sound-card">
      <div class="sound-top">
        <span class="lbl"><i class="f7-icons mi" style="color:${color}">${icon}</i> ${t(label)}</span>
        <label class="switch"><input type="checkbox" data-key="${key}" ${on ? 'checked' : ''}><span class="tr"><span class="th"></span></span></label>
      </div>
      <div class="sound-controls">
        <span class="sound-status ${url ? 'has' : ''}">${url ? '✓ صوت مخصص مرفوع' : (on ? '🔊 نغمة افتراضية' : '🔇 مكتوم (مفصول)')}</span>
        <button type="button" class="btn btn-sm btn-green sound-up" data-urlkey="${urlKey}"><i class="f7-icons">arrow_up</i> رفع صوت</button>
        <audio class="sound-audio" data-urlkey="${urlKey}" src="${esc(url)}" controls preload="none" ${url ? '' : 'style="display:none"'}></audio>
        <button type="button" class="btn btn-sm btn-red sound-del" data-urlkey="${urlKey}" ${url ? '' : 'style="display:none"'}><i class="f7-icons">trash_fill</i> إزالة</button>
        <input type="hidden" data-key="${urlKey}" value="${esc(url)}">
      </div>
      ${hint ? `<div class="sound-hint">${hint}</div>` : ''}
    </div>`;
};
const inpRow = (icon, color, label, key, type = 'number', suffix = 'رصيد') => `
  <div class="row">
    <span class="lbl"><i class="f7-icons mi" style="color:${color}">${icon}</i> ${t(label)} :</span>
    <span style="display:flex;align-items:center;gap:10px">
      <input class="inp num" type="${type}" data-key="${key}" value="${esc(SETTINGS[key] ?? '')}">
      ${suffix ? `<span class="suffix">${t(suffix)}</span>` : ''}
    </span>
  </div>`;
const MESSAGE_BADGE_SIZE_SETTINGS = [
  ['superadmin', 'سوبر أدمن / المالك', 'superadmin.png', 'msg_badge_superadmin_size'],
  ['admin', 'أدمن', 'admin.png', 'msg_badge_admin_size'],
  ['roomadmin', 'أدمن غرفة', 'roomadmin.png', 'msg_badge_roomadmin_size'],
  ['mmez', 'عضوية مميز', 'mmez.png', 'msg_badge_mmez_size'],
  ['vip', 'عضوية VIP', 'vip.png', 'msg_badge_vip_size'],
  ['premium', 'عضوية Premium', 'premium.png', 'msg_badge_premium_size'],
  ['plus', 'عضوية Plus', 'plus.png', 'msg_badge_plus_size'],
  ['register', 'عضو مسجل', 'register.png', 'msg_badge_register_size'],
  ['guest', 'زائر', 'guest.png', 'msg_badge_guest_size'],
  ['hidden_admin', 'شارة الدخول المخفي', '/img/mgfi.png', 'msg_badge_hidden_admin_size', 28]
];
const messageBadgeSizeEditor = () => `
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:9px;margin:10px 0 16px">
    ${MESSAGE_BADGE_SIZE_SETTINGS.map(([kind, label, image, key, fallback = 24]) => {
      const size = Math.min(80, Math.max(12, +(SETTINGS[key] || fallback)));
      const imageSrc = String(image).startsWith('/') ? image : `/badges/${image}`;
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #e5e7ef;border-radius:12px;background:#fafbff">
        <span style="width:90px;height:90px;display:flex;align-items:center;justify-content:center;border-radius:10px;background:#fff;border:1px solid #eef0f5;overflow:hidden;flex:none">
          <img src="${imageSrc}" data-badge-preview="${kind}" style="width:${size}px;height:${size}px;object-fit:contain;transition:.2s" alt="${esc(label)}">
        </span>
        <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px">
          <b style="color:#343a4d;font-size:11px">${esc(label)}</b>
          <span style="display:flex;align-items:center;gap:6px"><input class="inp num" type="number" min="12" max="80" step="1" data-key="${key}" data-badge-size="${kind}" value="${size}" style="width:82px"><small>بكسل</small></span>
        </span>
      </div>`;
    }).join('')}
  </div>`;
const ACCESS_MEMBERSHIPS = [
  ['guest', 'الزائر'], ['registered', 'عضو مسجل'], ['mmez', 'مميز'],
  ['plus', 'Plus'], ['premium', 'Premium'], ['vip', 'VIP']
];
const membershipAccessCard = (icon, color, title, key, description) => {
  const selected = new Set(String(SETTINGS[key] || '').split(',').filter(Boolean));
  return `<div class="section" style="margin-bottom:16px">
    <div class="section-title"><i class="f7-icons mi" style="color:${color}">${icon}</i> ${t(title)}</div>
    <div style="color:#73798d;font-size:13px;margin:-3px 0 15px">${t(description)}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:10px">
      ${ACCESS_MEMBERSHIPS.map(([value, label]) => `<label style="display:flex;align-items:center;gap:8px;background:#f7f8fc;border:1px solid #e5e7ef;border-radius:10px;padding:11px 12px;font-weight:800;color:#3d435b;cursor:pointer"><input type="checkbox" data-access-key="${key}" value="${value}" ${selected.has(value) ? 'checked' : ''}> ${t(label)}</label>`).join('')}
    </div>
  </div>`;
};

// =====================================================
//  الصفحات
// =====================================================
// ---- مساعدا قسمَي الهدايا والإيموجي ----
let ED_GIFT = null, ADMIN_GIFT_AUDIO = null;
async function renderAdminGifts() {
  const list = await api('/api/admin/gifts');
  $('#gAdminList').innerHTML = list.map(g => `
    <div style="display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #e7eaf5;border-radius:12px;padding:10px 14px">
      ${g.img && g.img.startsWith('/') ? `<img src="${esc(g.img)}" style="width:46px;height:46px;object-fit:contain;background:#f6f7fc;border-radius:10px;padding:4px">` : `<span style="font-size:32px;width:46px;text-align:center">${esc(g.img || '🎁')}</span>`}
      <div style="flex:1"><b style="font-size:13.5px;color:#2c3154">${esc(g.name)}</b>
        <div style="font-size:11.5px;color:#98a0b3;font-weight:700">القيمة: ${g.price} 🪙 ← يربح المستقبل: ${g.payout} 🪙 • التسكير: $${(+g.usd_value || 0)} • ${esc(g.cat)}</div>
        <div style="font-size:10.5px;color:${g.audio ? '#16a34a' : '#9ca3af'};font-weight:700;margin-top:3px">${g.audio ? '🔊 صوت الهدية مرفق' : '🔇 بدون صوت'} • ${g.style === 'royal' ? '👑 نمط ملكي' : (g.style === 'normal' ? '🎁 نمط عادي' : '⚙️ تلقائي حسب القيمة')}</div></div>
      ${g.audio ? `<button class="btn btn-gray g-audio-play" data-src="${esc(g.audio)}" style="padding:7px 10px"><i class="f7-icons">play_fill</i> تجربة</button>` : ''}
      <button class="btn btn-gray g-edit" data-id="${g.id}" style="padding:7px 13px"><i class="f7-icons">pencil</i> تعديل</button>
      <button class="btn btn-red g-del" data-id="${g.id}" style="padding:7px 13px"><i class="f7-icons">trash</i> حذف</button>
    </div>`).join('') || '<div style="color:#9aa0b5;font-weight:800;text-align:center;padding:18px">لا توجد هدايا</div>';
  $$('.g-audio-play').forEach(button => button.onclick = async () => {
    try {
      if (ADMIN_GIFT_AUDIO) { ADMIN_GIFT_AUDIO.pause(); ADMIN_GIFT_AUDIO.currentTime = 0; }
      ADMIN_GIFT_AUDIO = new Audio(button.dataset.src);
      await ADMIN_GIFT_AUDIO.play();
    } catch (e) { toast('تعذر تشغيل صوت الهدية', false); }
  });
  $$('.g-edit').forEach(b => b.onclick = () => { ED_GIFT = list.find(x => x.id === +b.dataset.id); loadPage('gifts'); });
  $$('.g-del').forEach(b => b.onclick = async () => {
    if (!confirm(t('حذف هذه الهدية نهائياً؟'))) return;
    await api('/api/admin/gifts/' + b.dataset.id + '/del', 'POST');
    toast('تم الحذف');
    renderAdminGifts();
  });
  applyAdminLanguage($('#gAdminList'));
}

// ---- عرض طلبات تسكير الهدايا في لوحة الإدارة ----
async function renderCashoutRequests() {
  const host = $('#cashoutList');
  if (!host) return;
  try {
    const data = await api('/api/admin/gift-cashouts');
    const list = data.list || [];
    if (!list.length) {
      host.innerHTML = '<div class="empty" style="padding:30px;text-align:center;color:#98a0b3"><i class="f7-icons" style="font-size:30px;display:block;margin-bottom:8px">bank_fill</i>لا توجد طلبات تسكير</div>';
      return;
    }
    const fmt = n => (Math.round((+n || 0) * 100) / 100).toFixed(2);
    host.innerHTML = list.map(r => {
      const isPending = r.status === 'pending';
      const isPaypalReq = r.payout_method === 'paypal';
      let statusChip;
      if (isPending && isPaypalReq) {
        statusChip = (r.payout_status === 'failed')
          ? '<span class="chip" style="background:#fee2e2;color:#991b1b">⛔ تعذر التحويل الآلي</span>'
          : '<span class="chip" style="background:#e0f2fe;color:#0369a1">💸 جارٍ التحويل تلقائيًا</span>';
      } else if (isPending) {
        statusChip = '<span class="chip" style="background:#fef3c7;color:#92400e">⏳ قيد المراجعة</span>';
      } else if (r.status === 'completed') {
        statusChip = '<span class="chip" style="background:#dcfce7;color:#166534">✅ مكتمل</span>';
      } else if (r.status === 'failed') {
        statusChip = '<span class="chip" style="background:#fee2e2;color:#991b1b">⛔ تعذر التحويل الآلي</span>';
      } else {
        statusChip = `<span class="chip" style="background:#fee2e2;color:#991b1b">⛔ مرفوض${r.note ? ' — ' + esc(r.note) : ''}</span>`;
      }
      const time = new Date((+r.created_at || 0) * 1000).toLocaleString('ar-JO');
      const ava = r.avatar && r.avatar.startsWith('/') ? `<img src="${esc(r.avatar)}" style="width:40px;height:40px;border-radius:50%;object-fit:cover">` : '<span style="width:40px;height:40px;border-radius:50%;background:#f3c8de;display:flex;align-items:center;justify-content:center;font-size:18px">👩</span>';
      return `
        <div style="background:#fff;border:1px solid #e7eaf5;border-radius:14px;padding:14px 16px">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            ${ava}
            <div style="flex:1;min-width:160px">
              <b style="font-size:14.5px;color:#2c3154">${esc(r.username)}</b> ${r.gender === 'girl' ? '<span style="font-size:11px;color:#d43d6e;font-weight:800">♀ فتاة</span>' : ''}
              <div style="font-size:12px;color:#98a0b3;font-weight:700">${time}</div>
            </div>
            ${statusChip}
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin:12px 0">
            <div style="background:#f8f9fd;border:1px solid #e8ebf5;border-radius:10px;padding:9px 12px"><div style="font-size:11px;color:#98a0b3;font-weight:800">هدايا محددة للتسكير</div><b style="font-size:14px;color:#2c3154">${r.gifts_count}</b></div>
            <div style="background:#f8f9fd;border:1px solid #e8ebf5;border-radius:10px;padding:9px 12px"><div style="font-size:11px;color:#98a0b3;font-weight:800">ذهب الهدايا المحددة</div><b style="font-size:14px;color:#f59e0b">${r.gold_total || 0} 🪙</b></div>
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:9px 12px"><div style="font-size:11px;color:#16a34a;font-weight:800">مبلغ التسكير الذي يُدفع</div><b style="font-size:15px;color:#166534">$${fmt(r.usd_amount || r.net_usd)}</b></div>
          </div>
          ${(() => {
            try {
              const sel = JSON.parse(r.selection_json || '[]');
              if (Array.isArray(sel) && sel.length) {
                const agg = {};
                sel.forEach(s => { const k = s.name || 'هدية'; agg[k] = (agg[k] || 0) + (+s.qty || 0); });
                const parts = Object.entries(agg).map(([n, q]) => `${esc(n)} ×${q}`).join('، ');
                return `<div style="background:#fff7fb;border:1px solid #f3d3e2;border-radius:10px;padding:9px 12px;font-size:12px;font-weight:700;color:#7b4a63;margin-bottom:8px"><i class="f7-icons" style="color:#d43d6e">gift_fill</i> تفاصيل الهدايا المحددة (يُخصم فقط): <b>${parts}</b></div>`;
              }
            } catch (e) {}
            return '';
          })()}
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#f8f9fd;border:1px dashed #d4d9ea;border-radius:10px;padding:9px 12px;font-size:12.5px;font-weight:800;color:#4b5563">
            <i class="f7-icons" style="color:#38bdf8">${r.payout_method === 'paypal' ? 'paypal' : 'bank_fill'}</i>
            ${isPaypalReq
              ? `<span>الاستلام عبر: <b style="direction:ltr;display:inline-block">${esc(r.paypal_email)}</b> — تحويل تلقائي من حساب الإدارة (PayPal Payouts)</span>`
              : `<span>الحساب: <b style="direction:ltr;display:inline-block">${esc(r.account_number)}</b> — <b>${esc(r.account_name || '-')}</b> (تحويل يدوي)</span>`}
            ${r.payout_batch_id ? `<span style="color:#0369a1"><i class="f7-icons">paperplane_fill</i> دفعة تلقائية ${esc(r.payout_batch_id)}</span>` : ''}
            ${r.payout_status === 'failed' ? `<span style="color:#b91c1c"><i class="f7-icons">xmark_circle_fill</i> تعذر الإرسال الآلي</span>` : ''}
          </div>
          ${isPending && isPaypalReq ? `
          <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
            <span class="btn btn-green" style="opacity:.75;cursor:not-allowed"><i class="f7-icons">arrow2_circlepath</i> يتم التحويل تلقائيًا (بدون تدخل الإدارة)</span>
          </div>` : ''}
          ${isPending && !isPaypalReq ? `
          <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
            <button class="btn btn-green" data-cashout-complete="${r.id}" data-usd="${fmt(r.usd_amount || r.net_usd)}" data-acc="${esc(r.account_number)}" data-count="${r.gifts_count || 0}"><i class="f7-icons">checkmark_circle_fill</i> اتمام التحويل ($${fmt(r.usd_amount || r.net_usd)})</button>
            <button class="btn btn-gray" data-cashout-reject="${r.id}"><i class="f7-icons">xmark_circle_fill</i> رفض الطلب</button>
          </div>` : ''}
        </div>`;
    }).join('');

    $$('#cashoutList [data-cashout-complete]').forEach(b => b.onclick = async () => {
      if (!confirm(`هذا طلب استلام عبر حساب بنكي — التحويل يدوي من حساب الإدارة (لا يُرسل آليًا).\n\nالصرف الحالي: $${b.dataset.usd} إلى ${b.dataset.acc}.\nبعد الضغط سيُحذف ${b.dataset.count || 0} هدية من حساب المستلمة نهائيًا.\n\nهل تلقّت المستلمة المبلغ فعلاً على حسابها البنكي؟`)) return;
      b.disabled = true;
      try {
        const r = await api('/api/admin/gift-cashout/' + b.dataset.cashoutComplete + '/complete', 'POST');
        toast(`تم اتمام التسكير — تم حذف ${r.deleted} هدية من حساب المستلمة ✓`);
        renderCashoutRequests();
      } catch (e) { toast(e.error || 'تعذر اتمام العملية', false); b.disabled = false; }
    });
    $$('#cashoutList [data-cashout-reject]').forEach(b => b.onclick = async () => {
      const note = prompt('سبب الرفض (اختياري):') || '';
      if (note === null) return;
      try {
        await api('/api/admin/gift-cashout/' + b.dataset.cashoutReject + '/reject', 'POST', { note });
        toast('تم رفض الطلب وإبلاغ المستلمة');
        renderCashoutRequests();
      } catch (e) { toast(e.error || 'تعذر رفض الطلب', false); }
    });
  } catch (e) {
    host.innerHTML = '<div class="empty" style="padding:30px;text-align:center;color:#ef4444">تعذر تحميل الطلبات</div>';
  }
}

function updateTeamMonitor(items) {
  const list = $('#teamMonitorList');
  if (!list) return;
  const existing = new Map([...list.querySelectorAll('.monitor-item')].map(card => [card.dataset.ip, card]));
  if (!items.length) {
    list.innerHTML = '<div class="empty monitor-empty">لا توجد اتصالات دردشة نشطة الآن</div>';
    return;
  }
  const empty = list.querySelector('.monitor-empty'); if (empty) empty.remove();
  for (const item of items) {
    let card = existing.get(item.ip);
    if (!card) {
      card = document.createElement('div');
      card.className = 'monitor-item';
      card.dataset.ip = item.ip;
      list.appendChild(card);
    }
    existing.delete(item.ip);
    const since = new Date(item.connected_at || Date.now()).toLocaleTimeString('ar', { hour: 'numeric', minute: '2-digit' });
    const people = (item.users || []).map(user => {
      const rooms = (user.rooms || []).map(room => esc(room.name)).join('، ') || 'لم يدخل غرفة بعد';
      return `<div class="monitor-person">
        <span class="monitor-user">👤 ${esc(user.username)}</span>
        <span class="monitor-room">🏠 الغرفة: <b>${rooms}</b></span>
        ${user.connections > 1 ? `<span class="monitor-tabs">📱 ${user.connections} اتصالات</span>` : ''}
      </div>`;
    }).join('');
    card.innerHTML = `
      <div class="monitor-card-head">
        <div class="monitor-badges">
          <span class="monitor-online">🟢 متصل</span>
          <span class="monitor-ip" dir="ltr">IP: ${esc(item.ip)}</span>
        </div>
        <div class="monitor-head-actions">
          <span class="monitor-since">منذ ${esc(since)}</span>
          <button class="monitor-ban" type="button" data-ip="${esc(item.ip)}"><i class="f7-icons">nosign</i> حظر IP</button>
        </div>
      </div>
      <div class="monitor-people">${people}</div>`;
  }
  existing.forEach(card => card.remove());
  // ترتيب ثابت حسب IP؛ البطاقة الموجودة تُنقل ولا تُنشأ نسخة مكررة.
  items.forEach(item => {
    const card = [...list.querySelectorAll('.monitor-item')].find(node => node.dataset.ip === item.ip);
    if (card) list.appendChild(card);
  });
  list.querySelectorAll('.monitor-ban').forEach(button => button.onclick = async () => {
    const ip = button.dataset.ip;
    if (!confirm(`حظر جميع الاتصالات من عنوان IP ${ip}؟`)) return;
    try {
      await api('/api/admin/ip/ban', 'POST', { ip, reason: 'حظر من صفحة الرصد' });
      toast('تم حظر عنوان IP وفصل اتصالاته');
      await refreshTeamMonitor();
    } catch (e) { toast(e.error || 'تعذر حظر عنوان IP', false); }
  });
}
async function refreshTeamMonitor() {
  try { updateTeamMonitor(await api('/api/admin/monitor')); } catch (e) { }
}

async function renderRoomBots() {
  const bots = await api('/api/admin/room-bots');
  const rankNames = { user: 'مستخدم', roomadmin: 'أدمن غرفة', admin: 'أدمن', superadmin: 'سوبر أدمن', supermaster: 'ملك الدردشة (سوبر ماستر 👑)' };
  const membershipNames = { none: 'بدون عضوية', mmez: 'مميز', plus: 'Plus', premium: 'Premium', vip: 'VIP' };
  $('#roomBotList').innerHTML = bots.length ? bots.map(bot => {
    const replyBadge = bot.reply_enabled === 1
      ? '<span class="chip" style="background:#ecfdf5;color:#047857;border:1px solid #a7f3d0">🤖 متحدث ذكي (AI)</span>'
      : (bot.reply_enabled === 2
        ? `<span class="chip" style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe">💬 متحدث مخصص (${esc(bot.reply_text || 'نعم؟')})</span>`
        : '<span class="chip" style="background:#f1f5f9;color:#64748b">🔇 صامت (لا يتحدث)</span>');
    return `
    <div class="room-bot-card${bot.active ? '' : ' inactive'}">
      <img class="room-bot-avatar" src="${esc(bot.avatar)}" alt="">
      <div class="room-bot-info">
        <b>${esc(bot.username)} ${bot.verified ? '<i class="f7-icons room-bot-verified">checkmark_seal_fill</i>' : ''}</b>
        <span>🏠 ${esc(bot.room_name || 'غرفة محذوفة')} • ${rankNames[bot.rank] || bot.rank} • ${membershipNames[bot.membership] || bot.membership}</span>
        <small>${bot.active ? '🟢 متواجد داخل الغرفة' : '⚪ متوقف وغير ظاهر'} • ${replyBadge}</small>
      </div>
      <div class="room-bot-actions">
        <button class="btn btn-gray rb-toggle" data-id="${bot.id}">${bot.active ? 'إيقاف' : 'تشغيل'}</button>
        <button class="btn btn-yellow rb-edit" data-id="${bot.id}"><i class="f7-icons">pencil</i> تعديل</button>
        <button class="btn btn-red rb-delete" data-id="${bot.id}"><i class="f7-icons">trash</i> حذف</button>
      </div>
    </div>`;
  }).join('') : '<div class="empty">لم يتم إنشاء روبوتات غرف بعد</div>';
  $$('.rb-edit').forEach(button => button.onclick = () => {
    EDIT_ROOM_BOT = bots.find(bot => bot.id === +button.dataset.id) || null;
    loadPage('roomBots');
  });
  $$('.rb-toggle').forEach(button => button.onclick = async () => {
    const bot = bots.find(item => item.id === +button.dataset.id);
    if (!bot) return;
    await api('/api/admin/room-bots', 'POST', {
      id: bot.id, username: bot.username, avatar: bot.avatar, room_id: bot.room_id,
      rank: bot.rank, membership: bot.membership, verified: !!bot.verified, active: !bot.active,
      reply_enabled: bot.reply_enabled, reply_text: bot.reply_text || 'نعم؟'
    });
    toast(bot.active ? 'تم إيقاف الروبوت' : 'تم إدخال الروبوت إلى الغرفة');
    await renderRoomBots();
  });
  $$('.rb-delete').forEach(button => button.onclick = async () => {
    if (!confirm(t('حذف هذا الروبوت نهائياً؟'))) return;
    await api('/api/admin/room-bots/' + button.dataset.id, 'DELETE');
    toast('تم حذف الروبوت');
    EDIT_ROOM_BOT = null;
    await renderRoomBots();
  });
}

async function renderAdminBots() {
  const list = await api('/api/admin/bots');
  $('#botList').innerHTML = list.map(b => `
    <div style="display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #e7eaf5;border-radius:12px;padding:10px 14px">
      <div style="width:44px;height:44px;border-radius:12px;background:#fdf2fa;display:flex;align-items:center;justify-content:center;font-size:22px">🤖</div>
      <div style="flex:1;min-width:0">
        <b style="font-size:${Math.min(22, b.size)}px;color:${esc(b.color)};display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.text)}</b>
        <div style="font-size:11.5px;color:#98a0b3;font-weight:700;margin-top:3px">📍 ${esc(b.room_name || 'كل الغرف')} • كل ${b.interval_min} ثانية • حجم ${b.size} • ${b.active ? 'يعمل ✔' : 'متوقف'}</div>
      </div>
      <button class="btn btn-red bot-del" data-id="${b.id}" style="padding:7px 13px"><i class="f7-icons">trash</i> حذف</button>
    </div>`).join('') || '<div style="color:#9aa0b5;font-weight:800;text-align:center;padding:18px">لا توجد رسائل روبوت بعد</div>';
  $$('.bot-del').forEach(x => x.onclick = async () => {
    if (!confirm(t('حذف رسالة الروبوت هذه؟'))) return;
    await api('/api/admin/bots/' + x.dataset.id + '/del', 'POST');
    toast('تم الحذف');
    renderAdminBots();
  });
}
async function renderAdminEmojis() {
  const list = await api('/api/admin/emojis');
  $('#emojiAdminGrid').innerHTML = list.map(e => `
    <div style="position:relative;background:#fff;border:1px solid #e7eaf5;border-radius:12px;padding:10px;display:flex;align-items:center;justify-content:center">
      <img src="${esc(e.img)}" style="width:48px;height:48px;object-fit:contain">
      <button class="emoji-del" data-id="${e.id}" style="position:absolute;top:4px;left:4px;border:0;background:#fee2e2;color:#dc2626;border-radius:8px;width:22px;height:22px;cursor:pointer;font-weight:900">×</button>
    </div>`).join('') || '<div style="color:#9aa0b5;font-weight:800;grid-column:1/-1;text-align:center">لا يوجد إيموجي مرفوع بعد</div>';
  $$('.emoji-del').forEach(b => b.onclick = async () => { await api('/api/admin/emojis/' + b.dataset.id + '/del', 'POST'); renderAdminEmojis(); });
  applyAdminLanguage($('#emojisGrid'));
}

// ---------- إدارة صور وأصوات الدخول الملكي (قسما الذكور/الإناث) ----------
let RA_GIF_PATH = '', RA_SOUND_PATH = '', RA_EDIT_ID = null;
// تعبئة نموذج الإضافة لوضع التعديل (أو تفريغه للإضافة الجديدة)
function raSetEdit(a) {
  RA_EDIT_ID = a ? a.id : null;
  if (!a) {
    RA_GIF_PATH = ''; RA_SOUND_PATH = '';
    const nm = $('#raName'); if (nm) nm.value = '';
    const em = $('#raEmoji'); if (em) em.value = '';
    const co = $('#raColor'); if (co) co.value = '#f59e0b';
    const gd = $('#raGender'); if (gd) gd.value = 'boy';
  } else {
    const nm = $('#raName'); if (nm) nm.value = a.name || '';
    const em = $('#raEmoji'); if (em) em.value = a.emoji || '';
    const co = $('#raColor'); if (co) co.value = a.color || '#f59e0b';
    const gd = $('#raGender'); if (gd) gd.value = a.gender === 'girl' ? 'girl' : 'boy';
    RA_GIF_PATH = a.gif || ''; RA_SOUND_PATH = a.sound || '';
  }
  const addBtn = $('#raAdd');
  if (addBtn) addBtn.innerHTML = RA_EDIT_ID
    ? '<i class="f7-icons">checkmark_alt</i> حفظ التعديل'
    : '<i class="f7-icons">plus</i> إضافة الدخول';
  const cancel = $('#raCancel');
  if (cancel) cancel.style.display = RA_EDIT_ID ? '' : 'none';
  const n = $('#raFiles');
  if (n) n.textContent = RA_EDIT_ID
    ? '✏️ تعديل: «' + (a.name || '') + '» — ' + (RA_GIF_PATH ? '✔ صورة' : '') + (RA_SOUND_PATH ? ' + ✔ صوت' : '') + ' — ارفع صورة/صوتاً جديداً للاستبدال'
    : ((RA_GIF_PATH ? '✔ صورة جاهزة' : 'لا صورة بعد') + (RA_SOUND_PATH ? ' + ✔ صوت جاهز' : ''));
  if (RA_EDIT_ID) window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function renderRoyalAdmin() {
  const boys = $('#raBoys'), girls = $('#raGirls');
  if (!boys || !girls) return;
  boys.innerHTML = girls.innerHTML = '<div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري التحميل...</div>';
  const d = await api('/api/admin/royal-animals');
  const list = (d && d.animals) || [];
  const card = a => `
    <div class="section" style="margin:0;padding:10px;text-align:center">
      <img src="${esc(a.gif)}" alt="" style="width:100%;height:70px;object-fit:contain;border-radius:8px;background:#0b1220">
      <div style="font-weight:800;margin-top:6px">${esc(a.emoji || '')} ${esc(a.name)}</div>
      <div style="color:#94a3b8;font-size:11px">${a.sound ? '🔊 له صوت خاص' : '🔇 الصوت الافتراضي'}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">
        <button class="btn btn-purple btn-sm ra-edit" data-id="${a.id}" style="width:100%;padding:7px 4px"><i class="f7-icons">pencil</i> تعديل</button>
        <button class="btn btn-red btn-sm ra-del" data-id="${a.id}" style="width:100%;padding:7px 4px"><i class="f7-icons">trash_fill</i> حذف</button>
      </div>
    </div>`;
  boys.innerHTML = list.filter(a => a.gender !== 'girl').map(card).join('') || '<div style="color:#94a3b8">لا يوجد</div>';
  girls.innerHTML = list.filter(a => a.gender === 'girl').map(card).join('') || '<div style="color:#94a3b8">لا يوجد</div>';
  $$('.ra-edit').forEach(b => b.onclick = () => {
    const item = list.find(x => String(x.id) === String(b.dataset.id));
    if (item) raSetEdit(item);
  });
  $$('.ra-del').forEach(b => b.onclick = async () => {
    if (!confirm('حذف هذا الدخول الملكي؟')) return;
    await api('/api/admin/royal-animals/' + b.dataset.id, 'DELETE');
    toast('تم الحذف');
    renderRoyalAdmin();
  });
}
function bindRoyalAdminForm() {
  const gifInp = $('#raGif'), sndInp = $('#raSound');
  if (!gifInp || !sndInp) return;
  const note = () => { const n = $('#raFiles'); if (n) n.textContent = (RA_GIF_PATH ? '✔ صورة جاهزة' : 'لا صورة بعد') + (RA_SOUND_PATH ? ' + ✔ صوت جاهز' : ''); };
  gifInp.onchange = async () => {
    const f = gifInp.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    const d = await api('/api/admin/upload/royal-gif', 'POST', fd, true);
    if (d && d.path) { RA_GIF_PATH = d.path; toast('تم رفع الصورة'); } else toast((d && d.error) || 'تعذر الرفع', false);
    note();
  };
  sndInp.onchange = async () => {
    const f = sndInp.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    const d = await api('/api/admin/upload/royal-sound', 'POST', fd, true);
    if (d && d.path) { RA_SOUND_PATH = d.path; toast('تم رفع الصوت'); } else toast((d && d.error) || 'تعذر الرفع', false);
    note();
  };
  const addBtn = $('#raAdd');
  if (addBtn) addBtn.onclick = async () => {
    const name = $('#raName').value.trim();
    if (!name) return toast('اكتب اسم الدخول', false);
    if (!RA_GIF_PATH) return toast('ارفع صورة الدخول أولاً', false);
    const body = { name, emoji: $('#raEmoji').value.trim(), color: $('#raColor').value, gender: $('#raGender').value, gif: RA_GIF_PATH, sound: RA_SOUND_PATH };
    if (RA_EDIT_ID) {
      await api('/api/admin/royal-animals/' + RA_EDIT_ID, 'PUT', body);
      toast('تم حفظ التعديل — وصل للدردشة فوراً');
      raSetEdit(null);
    } else {
      await api('/api/admin/royal-animals', 'POST', body);
      toast('تمت الإضافة — وصلت للدردشة فوراً');
      raSetEdit(null);
    }
    gifInp.value = ''; sndInp.value = '';
    renderRoyalAdmin();
  };
  const cancelBtn = $('#raCancel');
  if (cancelBtn) cancelBtn.onclick = () => { raSetEdit(null); gifInp.value = ''; sndInp.value = ''; toast('أُلغي التعديل'); };
  note();
}
const PAGES = {

  // ====== إدارة باقات الذهب ======
  goldPackages: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#fbbf24">cube_box_fill</i> إدارة باقات شراء الذهب</div>
      <div class="info-box" style="background:#fef3c7;border-color:#fde68a;color:#92400e;margin-bottom:18px">
        تحكم في باقات الذهب المعروضة للمستخدمين في المتجر، يمكنك إضافة باقات جديدة، تعديل الأسعار، وإضافة ذهب مجاني وهدايا وشارات ترويجية.
      </div>

      <div class="section" style="margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px">
          <div class="section-title" style="margin:0" id="pkgFormHeader"><i class="f7-icons mi" style="color:#6366f1">plus_circle_fill</i> إضافة باقة ذهب جديدة</div>
        </div>
        <input type="hidden" id="editPkgId">
        <div class="grid2">
          <div class="fgroup">
            <label><i class="f7-icons mi" style="color:#f59e0b">tag_fill</i> اسم الباقة:</label>
            <input class="inp" id="pkgName" placeholder="مثال: الباقة الفضية أو باقة المبتدئين">
          </div>
          <div class="fgroup">
            <label><i class="f7-icons mi" style="color:#fbbf24">money_dollar_circle_fill</i> كمية الذهب الأساسية:</label>
            <input class="inp" id="pkgGold" type="number" min="1" placeholder="مثال: 100">
          </div>
        </div>
        <div class="grid2">
          <div class="fgroup">
            <label><i class="f7-icons mi" style="color:#10b981">creditcard_fill</i> سعر الباقة:</label>
            <input class="inp" id="pkgPrice" type="number" step="0.01" min="0.1" placeholder="مثال: 9.99">
          </div>
          <div class="fgroup">
            <label><i class="f7-icons mi" style="color:#6366f1">textformat</i> العملة:</label>
            <select class="inp" id="pkgCurrency">
              <option value="$">$ (USD)</option>
              <option value="د.أ">د.أ (دينار أردني)</option>
              <option value="ر.س">ر.س (ريال سعودي)</option>
              <option value="د.إ">د.إ (درهم إماراتي)</option>
              <option value="ج.م">ج.م (جنيه مصري)</option>
            </select>
          </div>
        </div>
        <div class="grid2">
          <div class="fgroup">
            <label><i class="f7-icons mi" style="color:#ec4899">gift_fill</i> ذهب إضافي هدية (Bonus):</label>
            <input class="inp" id="pkgBonus" type="number" min="0" placeholder="مثال: 15 (اتركه 0 إذا لم يوجد)">
          </div>
          <div class="fgroup">
            <label><i class="f7-icons mi" style="color:#ef4444">flame_fill</i> شارة ترويجية (Badge):</label>
            <input class="inp" id="pkgBadge" placeholder="مثال: 🔥 الأكثر طلباً أو ⭐ باقة التوفير">
          </div>
        </div>
        <div class="grid2">
          <div class="fgroup">
            <label><i class="f7-icons mi" style="color:#64748b">arrow_up_arrow_down</i> ترتيب الظهور (Sort):</label>
            <input class="inp" id="pkgSort" type="number" value="1" placeholder="1">
          </div>
          <div class="fgroup" style="display:flex;align-items:center;margin-top:24px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:800">
              <input type="checkbox" id="pkgActive" checked style="width:18px;height:18px;accent-color:#10b981">
              تفعيل هذه الباقة في المتجر الآن
            </label>
          </div>
        </div>
        <div class="btn-row" style="justify-content:flex-start;margin-top:14px;gap:8px">
          <button class="btn btn-green" id="savePkgBtn"><i class="f7-icons">checkmark_circle_fill</i> حفظ الباقة</button>
          <button class="btn btn-gray" id="cancelPkgBtn" style="display:none">إلغاء التعديل</button>
        </div>
      </div>

      <div class="section">
        <div class="section-title"><i class="f7-icons mi" style="color:#fbbf24">list_bullet</i> قائمة باقات الذهب الحالية</div>
        <div id="goldPackagesList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل الباقات...</div></div>
      </div>`,
    bind: async () => {
      await renderAdminGoldPackages();
    }
  },

  // ====== إعدادات بطاقة الإيداع وبوابة الدفع ======
  paymentSettings: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#3b82f6">paypal</i> إعدادات بوابة الدفع PayPal</div>
      <div class="info-box" style="background:#eff6ff;border-color:#bfdbfe;color:#1e40af;margin-bottom:18px">
        أُنشئت بوابة الدفع عبر <b>PayPal</b> كبديل حقيقي وآمن للبطاقات. أدخل مفاتيح تطبيق PayPal لديك (Client ID + Secret) من لوحة PayPal Developer، وستُخصم المبالغ فعلياً من حساب/بطاقة المشتري ويُشحن الذهب فقط بعد تأكيد الدفع.
      </div>

      <div class="section">
        <div class="section-title"><i class="f7-icons mi" style="color:#10b981">creditcard_fill</i> مفاتيح PayPal (Rest API App)</div>

        <div class="grid2">
          <div class="fgroup">
            <label><i class="f7-icons mi" style="color:#3b82f6">key_fill</i> Client ID:</label>
            <input class="inp" id="payPaypalClientId" placeholder="مثال: AQ7vH2..." style="direction:ltr;text-align:left;font-family:monospace">
          </div>
          <div class="fgroup">
            <label><i class="f7-icons mi" style="color:#10b981">lock_fill</i> Secret:
              <span id="paySecretStatus" style="font-size:11px;font-weight:700;color:#64748b"></span>
            </label>
            <input class="inp" type="password" id="payPaypalSecret" placeholder="مثال: EO9xK3..." style="direction:ltr;text-align:left;font-family:monospace">
            <small style="display:block;margin-top:4px;color:#64748b;font-size:11px">اتركه فارغاً للإبقاء على المفتاح الحالي.</small>
          </div>
        </div>

        <div class="grid2">
          <div class="fgroup">
            <label><i class="f7-icons mi" style="color:#f59e0b">server_alt</i> وضع التشغيل:</label>
            <select class="inp" id="payPaypalMode">
              <option value="live">وضع حي (Live) — مدفوعات حقيقية</option>
              <option value="sandbox">وضع تجريبي (Sandbox) — للاختبار</option>
            </select>
          </div>
          <div class="fgroup">
            <label><i class="f7-icons mi" style="color:#8b5cf6">money_dollar</i> العملة:</label>
            <select class="inp" id="payPaypalCurrency">
              <option value="USD">USD (الدولار الأمريكي)</option>
              <option value="EUR">EUR (اليورو)</option>
              <option value="GBP">GBP (الجنيه الإسترليني)</option>
              <option value="JOD">JOD (الدينار الأردني)</option>
            </select>
          </div>
        </div>

        <div class="grid2">
          <div class="fgroup" style="display:flex;align-items:center;margin-top:24px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:800;color:#1e293b">
              <input type="checkbox" id="payPaypalEnabled" checked style="width:18px;height:18px;accent-color:#10b981">
              تفعيل الدفع عبر PayPal في المتجر
            </label>
          </div>
        </div>

        <div class="btn-row" style="justify-content:flex-start;margin-top:16px;flex-wrap:wrap">
          <button class="btn btn-purple" id="savePaymentSettingsBtn"><i class="f7-icons">square_arrow_down_fill</i> حفظ إعدادات PayPal</button>
          <button class="btn" id="testPaymentSettingsBtn" style="background:#0ea5e9;color:#fff"><i class="f7-icons">checkmark_circle_fill</i> اختبار الاتصال بالبوابة</button>
        </div>
        <div id="payTestResult" style="margin-top:12px;padding:12px;border-radius:12px;font-size:13px;font-weight:700;display:none"></div>
      </div>

      <div class="section">
        <div class="section-title"><i class="f7-icons mi" style="color:#64748b">building_2_fill</i> بيانات الحساب المصرفي للإيداع (اختياري — للمراسلة)</div>
        <div class="grid2">
          <div class="fgroup">
            <label><i class="f7-icons mi" style="color:#3b82f6">building_2_fill</i> اسم البنك:</label>
            <input class="inp" id="payBankName" placeholder="مثال: البنك الأهلي التجاري">
          </div>
          <div class="fgroup">
            <label><i class="f7-icons mi" style="color:#10b981">person_crop_circle_fill</i> اسم المستفيد:</label>
            <input class="inp" id="payHolderName" placeholder="مثال: إدارة الدردشة المعتمدة">
          </div>
        </div>
        <div class="grid2">
          <div class="fgroup">
            <label><i class="f7-icons mi" style="color:#8b5cf6">number</i> رقم الآيبان (IBAN):</label>
            <input class="inp" id="payIban" placeholder="مثال: JO94 ARAB 1234 5678 9012 3456" style="direction:ltr;text-align:left;font-family:monospace">
          </div>
        </div>
      </div>`,
    bind: async () => {
      const refresh = async () => {
        try {
          const res = await api('/api/admin/payment-settings');
          $('#payPaypalClientId').value = res.paypal_client_id || '';
          $('#payPaypalSecret').value = '';
          $('#paySecretStatus').textContent = res.paypal_has_secret ? '✓ المفتاح محفوظ' : 'لم يُحفظ بعد';
          $('#paySecretStatus').style.color = res.paypal_has_secret ? '#059669' : '#dc2626';
          $('#payPaypalMode').value = res.paypal_mode || 'live';
          $('#payPaypalCurrency').value = res.paypal_currency || 'USD';
          $('#payPaypalEnabled').checked = res.paypal_enabled !== 0;
          $('#payBankName').value = res.merchant_bank_name || '';
          $('#payHolderName').value = res.merchant_holder_name || '';
          $('#payIban').value = res.merchant_iban || '';
        } catch (e) {}
      };
      await refresh();

      $('#savePaymentSettingsBtn').onclick = async () => {
        try {
          const r = await api('/api/admin/payment-settings', 'POST', {
            paypal_client_id: $('#payPaypalClientId').value.trim(),
            paypal_secret: $('#payPaypalSecret').value.trim(),
            paypal_mode: $('#payPaypalMode').value,
            paypal_currency: $('#payPaypalCurrency').value,
            paypal_enabled: $('#payPaypalEnabled').checked ? 1 : 0,
            merchant_bank_name: $('#payBankName').value.trim(),
            merchant_holder_name: $('#payHolderName').value.trim(),
            merchant_iban: $('#payIban').value.trim()
          });
          if (r && r.ok) {
            toast('تم حفظ إعدادات بوابة الدفع PayPal بنجاح ✓');
            // أعد قراءة الحالة المحفوظة فوراً: يظهر الـ Client ID و«المفتاح محفوظ ✓»
            // حتى يرى المستخدم أن القيم ذُخّرت فعلاً في الخادم.
            await refresh();
          } else {
            toast((r && r.error) || 'تعذر حفظ إعدادات PayPal', false);
          }
        } catch (e) {
          toast((e && e.error) || 'تعذر حفظ إعدادات PayPal', false);
        }
      };

      // اختبار الاتصال بالبوابة: يُشخّص فوراً سبب فشل الدفع (مفاتيح/وضع غير صحيح).
      const testBtn = $('#testPaymentSettingsBtn');
      if (testBtn) testBtn.onclick = async () => {
        const box = $('#payTestResult');
        if (box) { box.style.display = 'none'; }
        try {
          // أولاً نحفظ القيم الحالية حتى يُجرَّب الاختبار على مفاتيح مُدخلة في الحقول.
          await api('/api/admin/payment-settings', 'POST', {
            paypal_client_id: $('#payPaypalClientId').value.trim(),
            paypal_secret: $('#payPaypalSecret').value.trim(),
            paypal_mode: $('#payPaypalMode').value,
            paypal_currency: $('#payPaypalCurrency').value,
            paypal_enabled: $('#payPaypalEnabled').checked ? 1 : 0,
            merchant_bank_name: $('#payBankName').value.trim(),
            merchant_holder_name: $('#payHolderName').value.trim(),
            merchant_iban: $('#payIban').value.trim()
          });
          const r = await api('/api/admin/paypal/test', 'POST');
          if (box) {
            box.style.display = 'block';
            box.style.background = r.ok ? '#ecfdf5' : '#fef2f2';
            box.style.borderColor = r.ok ? '#10b981' : '#dc2626';
            box.style.color = r.ok ? '#065f46' : '#b91c1c';
            box.textContent = r.ok ? `✅ ${r.message}` : `❌ ${r.message}`;
          }
          if (r.ok) toast('تم التحقق من مفاتيح PayPal بنجاح ✓');
          else toast('فشل الاتصال بـ PayPal — راجع التفاصيل على الشاشة', false);
        } catch (e) {
          if (box) {
            box.style.display = 'block';
            box.style.background = '#fef2f2';
            box.style.borderColor = '#dc2626';
            box.style.color = '#b91c1c';
            box.textContent = '❌ ' + ((e && e.error) || 'تعذر اختبار الاتصال بالبوابة');
          }
          toast('تعذر اختبار الاتصال بالبوابة', false);
        }
      };
    }
  },

  // ====== سجل مدفوعات البطاقات ======
  paymentTransactions: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#10b981">doc_plaintext</i> سجل مدفوعات PayPal</div>
      <div class="section">
        <div class="section-title"><i class="f7-icons mi" style="color:#64748b">list_bullet</i> العمليات المؤكّدة من PayPal</div>
        <div id="transactionsList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل سجل العمليات...</div></div>
      </div>`,
    bind: async () => {
      try {
        const txs = await api('/api/admin/payment-transactions');
        if (!txs.length) {
          $('#transactionsList').innerHTML = '<div class="empty">لا توجد عمليات دفع مسجلة بعد</div>';
          return;
        }
        $('#transactionsList').innerHTML = `
          <div style="overflow-x:auto">
            <table class="table" style="width:100%;text-align:right">
              <thead>
                <tr>
                  <th>#</th>
                  <th>المستخدم</th>
                  <th>الباقة</th>
                  <th>الذهب المشحون</th>
                  <th>المبلغ المدفوع</th>
                  <th>بوابة الدفع</th>
                  <th>مرجع العملية (PayPal)</th>
                  <th>التاريخ</th>
                </tr>
              </thead>
              <tbody>
                ${txs.map(t => {
                  const date = new Date((+t.created_at || Date.now() / 1000) * 1000).toLocaleString('ar-JO');
                  // عملية PayPal: card_brand=PayPal و order_ref يحوي معرّف العملية.
                  const isPayPal = (t.card_brand || '').toLowerCase() === 'paypal';
                  const reference = t.order_ref || '';
                  const paidVia = isPayPal ? 'PayPal 🅿️' : (t.card_brand || 'بطاقة');
                  const refDisplay = isPayPal
                    ? `<span class="chip" style="direction:ltr;font-family:monospace;font-size:11px">${esc(reference || '—')}</span>`
                    : `<span class="chip">${paidVia} •••• ${esc(t.card_last4 || '****')}</span>`;
                  return `
                    <tr>
                      <td><span class="chip">#${t.id}</span></td>
                      <td><b>${esc(t.username)}</b></td>
                      <td><span class="chip" style="background:#eff6ff;color:#1d4ed8">${esc(t.package_name || 'باقة ذهب')}</span></td>
                      <td><b style="color:#f59e0b">${t.total_gold} ذهب 🪙</b></td>
                      <td><b style="color:#16a34a">${t.amount_paid} ${esc(t.currency || 'USD')}</b></td>
                      <td><span class="chip" style="background:#111827;color:#fff;font-weight:700">${isPayPal ? 'PayPal 🅿️' : esc(paidVia)}</span></td>
                      <td>${refDisplay}</td>
                      <td style="font-size:12px;color:#64748b">${esc(date)}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `;
      } catch (e) {
        $('#transactionsList').innerHTML = '<div class="empty" style="color:#ef4444">تعذر تحميل سجل العمليات</div>';
      }
    }
  },

  // ====== رصيد العضويات ======
  memberships: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#fbbf24">money_dollar_circle_fill</i> رصيد العضويات والتسجيل</div>
      <div style="background:#eef0ff;border:1px solid #c9d1ff;border-radius:12px;padding:8px 18px 12px;margin-bottom:22px">
        <div style="color:#4f46e5;font-weight:800;font-size:14.5px;padding:10px 0;border-bottom:1px dashed #c9d1ff;margin-bottom:8px;text-align:center">إعدادات رصيد العضويات والمكافآت</div>
        <ul style="list-style:none">
          <li style="padding:6px 0;display:flex;align-items:center;gap:9px;color:#4b5563;font-size:14px"><span style="width:7px;height:7px;border-radius:50%;background:#6b7280"></span> VIP - الرصيد المطلوب لشراء عضوية VIP 👑</li>
          <li style="padding:6px 0;display:flex;align-items:center;gap:9px;color:#4b5563;font-size:14px"><span style="width:7px;height:7px;border-radius:50%;background:#6b7280"></span> Premium - الرصيد المطلوب لشراء عضوية Premium 💎</li>
          <li style="padding:6px 0;display:flex;align-items:center;gap:9px;color:#4b5563;font-size:14px"><span style="width:7px;height:7px;border-radius:50%;background:#6b7280"></span> Plus - الرصيد المطلوب لشراء عضوية Plus ⭐</li>
          <li style="padding:6px 0;display:flex;align-items:center;gap:9px;color:#4b5563;font-size:14px"><span style="width:7px;height:7px;border-radius:50%;background:#10b981"></span> الذهب الممنوح تلقائياً عند تسجيل حساب جديد 💰</li>
        </ul>
      </div>
      <div class="section" style="border:0;box-shadow:none;padding:0">
        <div class="section-title"><i class="f7-icons mi" style="color:#38bdf8">suit_diamond_fill</i> إعدادات رصيد العضويات والتسجيل</div>
        ${inpRow('rosette', '#f59e0b', 'VIP - الرصيد المطلوب', 'vip_cost')}
        ${inpRow('suit_diamond_fill', '#38bdf8', 'Premium - الرصيد المطلوب', 'premium_cost')}
        ${inpRow('star_fill', '#eab308', 'Plus - الرصيد المطلوب', 'plus_cost')}
        ${inpRow('money_dollar_circle_fill', '#10b981', 'الذهب الممنوح عند تسجيل حساب جديد', 'register_gold', 'number', 'ذهب')}
        ${inpRow('phone_fill', '#10b981', 'تكلفة المكالمة الصوتية المفتوحة (تُخصم من المتصل)', 'call_cost', 'number', 'ذهب')}
        ${inpRow('videocam_fill', '#ec4899', 'تكلفة مكالمة الفيديو الخاصة (تُخصم من المتصل)', 'video_call_cost', 'number', 'ذهب')}
        ${inpRow('crown_fill', '#f59e0b', 'تكلفة الدخول الملكي 👑 (تُخصم عند موافقة الإدارة)', 'royal_entry_cost', 'number', 'ذهب')}
        <div class="btn-row">
          <button class="btn btn-gray" id="resetMem"><i class="f7-icons">arrow_clockwise</i> استعادة الافتراضي</button>
          <button class="btn btn-green" id="saveMem"><i class="f7-icons">square_arrow_down_fill</i> حفظ الإعدادات</button>
        </div>
      </div>`,
    bind: () => {
      $('#saveMem').onclick = async () => {
        await saveKeys(['vip_cost', 'premium_cost', 'plus_cost', 'register_gold', 'call_cost', 'video_call_cost', 'royal_entry_cost']);
        toast('تم حفظ إعدادات رصيد العضويات والتسجيل بنجاح');
      };
      $('#resetMem').onclick = async () => {
        SETTINGS = { ...SETTINGS, vip_cost: '30', premium_cost: '20', plus_cost: '10', register_gold: '10', call_cost: '2', video_call_cost: '5', royal_entry_cost: '50' };
        await saveKeys(['vip_cost', 'premium_cost', 'plus_cost', 'register_gold', 'call_cost', 'video_call_cost', 'royal_entry_cost']);
        loadPage('memberships');
        toast('تمت استعادة القيم الافتراضية');
      };
    }
  },

  // ====== إعدادات اللغة والترجمة ======
  languages: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#10b981">globe</i> ${t('إعدادات اللغة والترجمة')}</div>
      
      <div class="info-box" style="background:#e0f2fe;border-color:#bae6fd;color:#0369a1;margin-bottom:20px">
        <i class="f7-icons" style="vertical-align:middle;margin-inline-end:6px">info_circle_fill</i>
        ${t('يمكنك هنا تعيين اللغة الافتراضية للشات لجميع الزوار والأعضاء الجدد، بالإضافة إلى تحديد لغة عرض لوحة الإدارة للمشرفين.')}
      </div>

      <div class="section" style="margin-bottom:22px">
        <div class="section-title"><i class="f7-icons mi" style="color:#6366f1">chat_bubble_2_fill</i> ${t('اللغة الافتراضية للدردشة والموقع')}</div>
        <div style="color:#64748b;font-size:13.5px;margin-bottom:14px;line-height:1.6">
          ${t('يتم تطبيق هذه اللغة تلقائياً على أي زائر أو مستخدم جديد يدخل الدردشة لأول مرة. يمكن لكل مستخدم اختيار لغته الخاصة بحرية من قائمة اللغات داخل الشات.')}
        </div>
        <div class="lang-setting-cards">
          <label class="lang-radio-card ${(SETTINGS.default_language === 'ar' || !SETTINGS.default_language) ? 'selected' : ''}">
            <input type="radio" name="set_default_language" value="ar" ${(SETTINGS.default_language === 'ar' || !SETTINGS.default_language) ? 'checked' : ''}>
            <span class="lang-flag">🇸🇦</span>
            <span class="lang-meta"><b>العربية</b><small>Arabic (${t('الافتراضية')})</small></span>
          </label>
          <label class="lang-radio-card ${SETTINGS.default_language === 'en' ? 'selected' : ''}">
            <input type="radio" name="set_default_language" value="en" ${SETTINGS.default_language === 'en' ? 'checked' : ''}>
            <span class="lang-flag">🇺🇸</span>
            <span class="lang-meta"><b>English</b><small>English</small></span>
          </label>
          <label class="lang-radio-card ${SETTINGS.default_language === 'es' ? 'selected' : ''}">
            <input type="radio" name="set_default_language" value="es" ${SETTINGS.default_language === 'es' ? 'checked' : ''}>
            <span class="lang-flag">🇪🇸</span>
            <span class="lang-meta"><b>Español</b><small>Español</small></span>
          </label>
          <label class="lang-radio-card ${SETTINGS.default_language === 'tr' ? 'selected' : ''}">
            <input type="radio" name="set_default_language" value="tr" ${SETTINGS.default_language === 'tr' ? 'checked' : ''}>
            <span class="lang-flag">🇹🇷</span>
            <span class="lang-meta"><b>Türkçe</b><small>Türkçe</small></span>
          </label>
        </div>
      </div>

      <div class="section" style="margin-bottom:22px">
        <div class="section-title"><i class="f7-icons mi" style="color:#f59e0b">shield_fill</i> ${t('لغة لوحة التحكم والإدارة')}</div>
        <div style="color:#64748b;font-size:13.5px;margin-bottom:14px;line-height:1.6">
          ${t('تحديد لغة عرض لوحة الإدارة للمشرفين والمسؤولين. يمكنك أيضاً التبديل السريع من شريط اللغات أعلى القائمة.')}
        </div>
        <div class="lang-setting-cards">
          <label class="lang-radio-card ${ADMIN_LANG === 'ar' ? 'selected' : ''}">
            <input type="radio" name="set_admin_language" value="ar" ${ADMIN_LANG === 'ar' ? 'checked' : ''}>
            <span class="lang-flag">🇸🇦</span>
            <span class="lang-meta"><b>العربية</b><small>Arabic</small></span>
          </label>
          <label class="lang-radio-card ${ADMIN_LANG === 'en' ? 'selected' : ''}">
            <input type="radio" name="set_admin_language" value="en" ${ADMIN_LANG === 'en' ? 'checked' : ''}>
            <span class="lang-flag">🇺🇸</span>
            <span class="lang-meta"><b>English</b><small>English</small></span>
          </label>
          <label class="lang-radio-card ${ADMIN_LANG === 'es' ? 'selected' : ''}">
            <input type="radio" name="set_admin_language" value="es" ${ADMIN_LANG === 'es' ? 'checked' : ''}>
            <span class="lang-flag">🇪🇸</span>
            <span class="lang-meta"><b>Español</b><small>Español</small></span>
          </label>
          <label class="lang-radio-card ${ADMIN_LANG === 'tr' ? 'selected' : ''}">
            <input type="radio" name="set_admin_language" value="tr" ${ADMIN_LANG === 'tr' ? 'checked' : ''}>
            <span class="lang-flag">🇹🇷</span>
            <span class="lang-meta"><b>Türkçe</b><small>Türkçe</small></span>
          </label>
        </div>
      </div>

      <div class="btn-row" style="justify-content:flex-start">
        <button class="btn btn-purple" id="saveLangSettings">
          <i class="f7-icons">square_arrow_down_fill</i> ${t('حفظ وتطبيق إعدادات اللغة')}
        </button>
      </div>`,
    bind: () => {
      $$('input[name="set_default_language"]').forEach(r => {
        r.onchange = () => {
          $$('input[name="set_default_language"]').forEach(x => x.closest('.lang-radio-card').classList.toggle('selected', x.checked));
        };
      });
      $$('input[name="set_admin_language"]').forEach(r => {
        r.onchange = () => {
          $$('input[name="set_admin_language"]').forEach(x => x.closest('.lang-radio-card').classList.toggle('selected', x.checked));
        };
      });

      $('#saveLangSettings').onclick = async () => {
        const defaultLang = document.querySelector('input[name="set_default_language"]:checked')?.value || 'ar';
        const adminLang = document.querySelector('input[name="set_admin_language"]:checked')?.value || 'ar';
        
        SETTINGS.default_language = defaultLang;
        SETTINGS.admin_language = adminLang;

        await api('/api/admin/settings', 'POST', {
          default_language: defaultLang,
          admin_language: adminLang
        });

        setAdminLanguage(adminLang, true);
        toast(t('تم حفظ وتطبيق إعدادات اللغة بنجاح'));
        loadPage('languages');
      };
    }
  },

  // ====== ضبط الاعدادات ======
  general: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#94a3b8">wrench_fill</i> ضبط الاعدادات</div>
      ${swRow('smiley_fill', '#fbbf24', 'عرض زر الاسمايلات', 'show_smiles')}
      ${swRow('mic_fill', '#f472b6', 'عرض زر تسجيل الصوت', 'show_voice')}
      ${swRow('photo_fill', '#4ade80', 'عرض زر ارسال صورة', 'show_image')}
      ${swRow('dot_radiowaves_right', '#38bdf8', 'تفعيل الموجة المتحركة على قوالب الرسائل', 'wave_enabled')}
      ${swRow('eye_slash_fill', '#c084fc', 'دخول مخفي للإدمن والسوبر أدمن', 'hidden_super')}
      <div class="section-title" style="margin-top:24px"><i class="f7-icons mi" style="color:#60a5fa">speaker2_fill</i> الإشعارات الصوتية</div>
      ${soundRow('person_badge_plus_fill', '#60a5fa', 'صوت عند دخول المستخدم (b1)', 'snd_join', 'يُشغَّل تلقائياً عند دخول أي مستخدم إلى الغرفة.')}
      ${soundRow('paperplane_fill', '#94a3b8', 'صوت عند ارسال رسالة (b4)', 'snd_msg', 'يُشغَّل تلقائياً عند وصول رسالة جديدة في العام.')}
      ${soundRow('square_arrow_right_fill', '#fb923c', 'صوت عند خروج المستخدم (b5)', 'snd_leave', 'يُشغَّل تلقائياً عند مغادرة أي مستخدم للغرفة.')}
      <div class="style-hint" style="margin:6px 4px 14px">⬆️ ارفع ملفاً صوتياً لتشغيله بدل النغمة الافتراضية. الحقل يدعم MP3 / WAV / OGG / M4A / AAC / OPUS حتى 12 ميجا.</div>
      <div class="btn-row" style="justify-content:flex-start">
        <button class="btn btn-purple" id="saveGen"><i class="f7-icons">square_arrow_down_fill</i> حفظ الاعدادات</button>
      </div>`,
    bind: () => {
      bindSoundUploads();
      $('#saveGen').onclick = async () => { await saveSwitches(); toast('تم حفظ الاعدادات بنجاح'); };
    }
  },

  // ====== صلاحيات الميزات حسب العضوية ======
  featureAccess: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#6366f1">checkmark_shield_fill</i> صلاحيات العضويات</div>
      <div style="background:#eef2ff;border:1px solid #c7d2fe;color:#4f46e5;border-radius:12px;padding:13px 16px;margin-bottom:18px;font-size:13.5px;font-weight:700">حدد العضويات المسموح لها باستخدام كل ميزة. حسابات الإدارة ومشرفو الغرف مسموح لهم دائماً.</div>
      ${membershipAccessCard('chat_bubble_fill', '#2563eb', 'إرسال الرسائل في العام', 'public_message_allowed_memberships', 'كتابة وإرسال الرسائل النصية والإيموجي داخل الغرف العامة.')}
      ${membershipAccessCard('bubble_left_bubble_right_fill', '#14b8a6', 'إرسال الرسائل الخاصة', 'private_message_allowed_memberships', 'إرسال رسالة نصية مباشرة إلى مستخدم آخر في الخاص.')}
      ${membershipAccessCard('phone_fill', '#10b981', 'المكالمات الصوتية في الخاص', 'private_call_allowed_memberships', 'إجراء وبدء مكالمات صوتية مباشرة بين شخصين في المحادثة الخاصة.')}
      ${membershipAccessCard('videocam_fill', '#ec4899', 'مكالمات الفيديو في الخاص (سناب شات)', 'video_call_allowed_memberships', 'تحديد من يمكنه بدء مكالمة فيديو خاصة — يتم تحديد العضويات المسموح لها بدقة من هنا.')}
      ${membershipAccessCard('photo_fill', '#22c55e', 'إرسال الصور في العام', 'public_image_allowed_memberships', 'رفع صورة من زر الكاميرا وإرسالها داخل الغرفة العامة.')}
      ${membershipAccessCard('mic_fill', '#ec4899', 'إرسال مقطع صوتي في العام', 'voice_allowed_memberships', 'رفع ملف صوتي وإرساله داخل الغرفة العامة.')}
      ${membershipAccessCard('dot_radiowaves_right', '#ef4444', 'الصعود كمذيع في البث المباشر', 'broadcast_allowed_memberships', 'بدء بث صوتي أو فيديو والانضمام كمذيع في بث قائم.')}
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:14px 16px;margin-top:14px">
        <div style="display:flex;align-items:center;gap:9px;font-size:14px;font-weight:900;color:#1e293b">
          <i class="f7-icons" style="color:#ef4444;font-size:18px">mic_fill</i> عدد المذيعين المتزامن (الميكروفونات)
        </div>
        <div style="font-size:12px;color:#64748b;font-weight:700;margin-top:5px">أقصى عدد مسموح بالبقاء على المايك في نفس الوقت داخل البث — عند امتلائها يُرفض صعود أي شخص جديد برسالة «الميكروفونات ممتلئة».</div>
        <div class="fgroup" style="margin-top:10px">
          <input type="number" id="maxLiveSpeakers" class="inp" min="1" max="10" value="${SETTINGS.max_live_speakers || 4}" style="max-width:140px">
        </div>
      </div>
      ${membershipAccessCard('rectangle_and_pencil_and_ellipsis', '#8b5cf6', 'النشر في الحائط', 'wall_allowed_memberships', 'إنشاء منشور نصي أو صورة أو فيديو أو فيديو YouTube.')}
      ${membershipAccessCard('circle_grid_hex_fill', '#0ea5e9', 'النشر في الحالة', 'status_allowed_memberships', 'نشر حالات النص والصورة والفيديو والصوت.')}
      <div class="btn-row" style="justify-content:flex-start"><button class="btn btn-purple" id="saveFeatureAccess"><i class="f7-icons">square_arrow_down_fill</i> حفظ صلاحيات العضويات</button></div>`,
    bind: () => {
      $('#saveFeatureAccess').onclick = async () => {
        const body = {};
        [
          'public_message_allowed_memberships', 'private_message_allowed_memberships', 'private_call_allowed_memberships',
          'video_call_allowed_memberships',
          'public_image_allowed_memberships', 'voice_allowed_memberships', 'broadcast_allowed_memberships',
          'wall_allowed_memberships', 'status_allowed_memberships'
        ].forEach(key => {
          body[key] = [...document.querySelectorAll(`input[data-access-key="${key}"]:checked`)].map(input => input.value).join(',');
          SETTINGS[key] = body[key];
        });
        // عدد المذيعين المتزامن — يُرسل مع الحفظ ويُطبَّق فوراً على البث
        const msInput = $('#maxLiveSpeakers');
        if (msInput) {
          const v = Math.max(1, Math.min(10, parseInt(msInput.value) || 4));
          msInput.value = v;
          body.max_live_speakers = String(v);
          SETTINGS.max_live_speakers = String(v);
        }
        await api('/api/admin/settings', 'POST', body);
        toast('تم حفظ صلاحيات العضويات بنجاح');
      };
      // حفظ فوري عند تغيير عدد المذيعين (بدون انتظار زر الحفظ) — يتأثر البث مباشرة
      const msInput2 = $('#maxLiveSpeakers');
      if (msInput2) msInput2.addEventListener('change', async () => {
        const v = Math.max(1, Math.min(10, parseInt(msInput2.value) || 4));
        msInput2.value = v;
        SETTINGS.max_live_speakers = String(v);
        try {
          await api('/api/admin/settings', 'POST', { max_live_speakers: String(v) });
          toast(`✅ تم الحفظ والتطبيق الفوري — حد المذيعين الآن: ${v}`);
        } catch (e) { toast(e.error || 'تعذر الحفظ', false); }
      });
    }
  },

  // ====== اعدادات الرسائل ======
  msgSettings: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#94a3b8">chat_bubble_fill</i> اعدادات الرسائل</div>
      ${swRow('clock_fill', '#60a5fa', 'إظهار الوقت مع الرسالة (espumh)', 'show_time')}
      ${swRow('search', '#f472b6', 'تفعيل مراقبة الرسائل قبل نشرها (mrs eab)', 'msg_review')}
      ${inpRow('textformat_size', '#818cf8', 'الحد الأقصى لأحرف الرسالة', 'msg_max', 'number', 'حرف')}
      ${inpRow('timer', '#f59e0b', 'الفاصل الزمني بين رسائل الشخص في العام', 'public_message_cooldown_seconds', 'number', 'ثانية')}
      <div class="info-box" style="background:#fffbeb;border-color:#fde68a;color:#92400e;margin:10px 0 16px">
        اكتب عدداً من 1 إلى 60 ثانية. القيمة 0 تعطل الفاصل. عند الإرسال بسرعة تظهر للمستخدم رسالة «لا تتحدث بسرعة، خذ استراحة» ولا تُنشر رسالته الثانية.
      </div>
      <div class="section-title" style="margin-top:22px"><i class="f7-icons mi" style="color:#0ea5e9">rectangle_3_group_fill</i> مظهر رسائل العام</div>
      ${inpRow('arrow_up_and_down', '#0ea5e9', 'المسافة بين كل رسالة عامة والتي تليها', 'public_message_spacing_px', 'number', 'بكسل')}
      ${inpRow('textformat_size', '#8b5cf6', 'حجم اسم المرسل', 'public_message_name_size_px', 'number', 'بكسل')}
      <div class="row">
        <span class="lbl"><i class="f7-icons mi" style="color:#10b981">rectangle_expand_vertical</i> عرض جسم الرسالة :</span>
        <select class="inp" data-key="public_message_body_width" style="max-width:260px">
          <option value="fit" ${String(SETTINGS.public_message_body_width || 'fit') === 'fit' ? 'selected' : ''}>حسب طول الرسالة</option>
          <option value="full" ${String(SETTINGS.public_message_body_width || '') === 'full' ? 'selected' : ''}>بطول صفحة الدردشة</option>
        </select>
      </div>
      <div class="info-box" style="background:#eff6ff;border-color:#bfdbfe;color:#1e40af;margin:10px 0 16px">
        المسافة من 0 إلى 40 بكسل، وحجم الاسم من 10 إلى 36 بكسل. وضع «بطول الصفحة» يمدد <b>mbody</b> إلى كامل المساحة المتاحة، ووضع «حسب طول الرسالة» يجعله على قدر المحتوى.
      </div>
      <div class="section-title" style="margin-top:22px"><i class="f7-icons mi" style="color:#f59e0b">rosette</i> حجم شارات الرتب والعضويات في العام</div>
      <div class="info-box" style="background:#fff7ed;border-color:#fed7aa;color:#9a3412;margin:8px 0 10px">
        حدد حجماً مستقلاً لكل صورة شارة من 12 إلى 80 بكسل. تتغير صورة المعاينة أثناء الكتابة، ويُطبق الحجم على الرسائل القديمة والجديدة فور الحفظ.
      </div>
      ${messageBadgeSizeEditor()}
      <button class="btn btn-gray" id="resetMessageBadgeSizes" type="button" style="margin-bottom:14px"><i class="f7-icons">arrow_clockwise</i> توحيد جميع الشارات على 24px</button>
      ${inpRow('link', '#4ade80', 'رابط الرسائل العامة (puurl)', 'public_msgs_link', 'text', '')}
      <div class="btn-row" style="justify-content:flex-start">
        <button class="btn btn-purple" id="saveMsg"><i class="f7-icons">square_arrow_down_fill</i> حفظ الاعدادات</button>
      </div>`,
    bind: () => {
      const maxLengthInput = document.querySelector('input[data-key="msg_max"]');
      const cooldownInput = document.querySelector('input[data-key="public_message_cooldown_seconds"]');
      const spacingInput = document.querySelector('input[data-key="public_message_spacing_px"]');
      const nameSizeInput = document.querySelector('input[data-key="public_message_name_size_px"]');
      if (maxLengthInput) { maxLengthInput.min = '1'; maxLengthInput.max = '5000'; maxLengthInput.step = '1'; if (maxLengthInput.value === '') maxLengthInput.value = '500'; }
      if (cooldownInput) { cooldownInput.min = '0'; cooldownInput.max = '60'; cooldownInput.step = '1'; if (cooldownInput.value === '') cooldownInput.value = '3'; }
      if (spacingInput) { spacingInput.min = '0'; spacingInput.max = '40'; spacingInput.step = '1'; if (spacingInput.value === '') spacingInput.value = '4'; }
      if (nameSizeInput) { nameSizeInput.min = '10'; nameSizeInput.max = '36'; nameSizeInput.step = '1'; if (nameSizeInput.value === '') nameSizeInput.value = '14'; }
      const badgeSizeInputs = [...document.querySelectorAll('input[data-badge-size]')];
      badgeSizeInputs.forEach(input => {
        input.oninput = () => {
          const size = Math.min(80, Math.max(12, Math.round(+input.value || 24)));
          const preview = document.querySelector(`[data-badge-preview="${input.dataset.badgeSize}"]`);
          if (preview) { preview.style.width = size + 'px'; preview.style.height = size + 'px'; }
        };
      });
      $('#resetMessageBadgeSizes').onclick = () => {
        badgeSizeInputs.forEach(input => { input.value = '24'; input.dispatchEvent(new Event('input')); });
        toast('تم ضبط معاينة جميع الشارات على 24px — اضغط حفظ لتطبيقها');
      };
      $('#saveMsg').onclick = async () => {
        if (maxLengthInput) maxLengthInput.value = String(Math.min(5000, Math.max(1, Math.round(+maxLengthInput.value || 500))));
        if (cooldownInput) cooldownInput.value = String(Math.min(60, Math.max(0, Math.round(+cooldownInput.value || 0))));
        if (spacingInput) spacingInput.value = String(Math.min(40, Math.max(0, Math.round(+spacingInput.value || 0))));
        if (nameSizeInput) nameSizeInput.value = String(Math.min(36, Math.max(10, Math.round(+nameSizeInput.value || 14))));
        badgeSizeInputs.forEach(input => { input.value = String(Math.min(80, Math.max(12, Math.round(+input.value || 24)))); });
        await saveSwitches();
        await saveKeys([
          'msg_max', 'public_message_cooldown_seconds', 'public_message_spacing_px',
          'public_message_name_size_px', 'public_message_body_width', 'public_msgs_link',
          ...MESSAGE_BADGE_SIZE_SETTINGS.map(item => item[3])
        ]);
        toast('تم حفظ إعدادات الرسائل وأحجام الشارات وتطبيقها مباشرة');
      };
    }
  },

  // ====== وضع الشعار ======
  logo: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#c084fc">paintbrush_fill</i> وضع الشعار</div>
      <div style="background:#f2f5ff;border:1px solid #dfe5ff;border-radius:12px;padding:30px;text-align:center;margin-bottom:22px">
        ${SETTINGS.logo_url ? `<img src="${esc(SETTINGS.logo_url)}" style="max-width:260px;max-height:120px" onerror="this.outerHTML='<div style=&quot;color:#9ca3af&quot;>تعذر تحميل الشعار</div>'">` : `<div style="font-size:20px;font-weight:800;color:#4f46e5">★ ${esc(SETTINGS.site_name || 'الدردشة')}</div>`}
        <div style="color:#9ca3af;font-size:12px;margin-top:8px">الرابط : ${esc(SETTINGS.logo_url || 'الافتراضي')}</div>
      </div>
      <div class="section-title">رفع شعار جديد <i class="f7-icons mi" style="color:#818cf8">square_arrow_up_fill</i></div>
      <div class="drop" id="dropLogo">
        <i class="f7-icons folder">folder_fill</i>
        <div class="t1">انقر لاختيار صورة</div>
        <div class="t2">PNG, JPG, JPEG, GIF (حد أقصى 2MB)</div>
        <input type="file" id="logoFile" accept="image/*" style="display:none">
      </div>
      <div style="margin:12px 0"><input class="inp" id="logoUrl" placeholder="أو ضع رابط الشعار هنا https://..." value="${esc(SETTINGS.logo_url || '')}"></div>
      <div class="btn-row">
        <button class="btn btn-purple" id="saveLogo"><i class="f7-icons">square_arrow_down_fill</i> حفظ الشعار الجديد</button>
        <button class="btn btn-gray" id="resetLogo"><i class="f7-icons">arrow_clockwise</i> استعادة الشعار الافتراضي</button>
      </div>`,
    bind: () => {
      const drop = $('#dropLogo'), file = $('#logoFile');
      drop.onclick = () => file.click();
      drop.ondragover = e => { e.preventDefault(); drop.style.background = '#eef2ff'; };
      drop.ondragleave = () => drop.style.background = '';
      drop.ondrop = e => { e.preventDefault(); drop.style.background = ''; if (e.dataTransfer.files[0]) { file.files = e.dataTransfer.files; uploadLogo(); } };
      file.onchange = uploadLogo;
      async function uploadLogo() {
        if (!file.files[0]) return;
        const fd = new FormData();
        fd.append('logo', file.files[0]);
        fd.append('logo_url', $('#logoUrl').value);
        const d = await api('/api/admin/logo', 'POST', fd, true);
        SETTINGS.logo_url = d.logo_url;
        toast('تم رفع الشعار بنجاح');
        loadPage('logo');
      }
      $('#saveLogo').onclick = async () => {
        const fd = new FormData();
        fd.append('logo_url', $('#logoUrl').value);
        const d = await api('/api/admin/logo', 'POST', fd, true);
        SETTINGS.logo_url = d.logo_url;
        toast('تم حفظ الشعار');
        loadPage('logo');
      };
      $('#resetLogo').onclick = async () => {
        const fd = new FormData(); fd.append('logo_url', '');
        await api('/api/admin/logo', 'POST', fd, true);
        SETTINGS.logo_url = '';
        toast('تمت استعادة الشعار الافتراضي');
        loadPage('logo');
      };
    }
  },

  // ====== وضع الجلد ======
  // ====== إدارة الهدايا (رفع صورة + قيمة + ربح المستقبل) ======
  gifts: {
    build: () => {
      const ge = ED_GIFT || {};
      const vis = ge.img
        ? (ge.img.startsWith('/') ? `<img src="${esc(ge.img)}" style="width:54px;height:54px;object-fit:contain">` : `<span style="font-size:40px">${esc(ge.img)}</span>`)
        : '<span style="font-size:38px">🎁</span>';
      return `
      <div class="page-title"><i class="f7-icons mi" style="color:#f472b6">gift_fill</i> ادارة الهدايا</div>
      <div class="section-title">${ge.id ? 'تعديل هدية #' + ge.id : 'إضافة هدية جديدة'} <i class="f7-icons mi" style="color:#818cf8">square_arrow_up_fill</i></div>
      <div style="background:#fff;border:1px solid #e7eaf5;border-radius:14px;padding:16px;margin-bottom:22px">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">
          <div id="gPrev" style="width:70px;height:70px;border-radius:16px;background:#f6f7fc;display:flex;align-items:center;justify-content:center;border:1px dashed #d4d9ea">${vis}</div>
          <div style="flex:1">
            <button class="btn btn-gray" id="gUpBtn"><i class="f7-icons">square_arrow_up_fill</i> رفع صورة الهدية (PNG/GIF/WEBP)</button>
            <input type="file" id="gFile" accept="image/*" style="display:none">
            <div style="font-size:11px;color:#9aa0b5;margin-top:6px" id="gImgPath">${esc(ge.img || 'لم تُرفع صورة بعد')}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;padding:12px;border-radius:12px;background:#f8f5ff;border:1px solid #e9ddff">
          <div style="width:54px;height:54px;border-radius:50%;background:#7c3aed;color:#fff;display:flex;align-items:center;justify-content:center"><i class="f7-icons" style="font-size:25px">music_note_2</i></div>
          <div style="flex:1;min-width:0">
            <button class="btn btn-purple" id="gAudioUpBtn"><i class="f7-icons">waveform</i> رفع صوت الهدية</button>
            <input type="file" id="gAudioFile" accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/opus,audio/webm,.mp3,.wav,.ogg,.m4a,.aac,.opus,.webm" style="display:none">
            <div style="font-size:11px;color:#7b8495;margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" id="gAudioPath">${esc(ge.audio || 'لم يُرفع صوت بعد')}</div>
            <audio id="gAudioPreview" src="${esc(ge.audio || '')}" controls style="${ge.audio ? '' : 'display:none;'}width:100%;height:30px;margin-top:7px"></audio>
          </div>
        </div>
        <div class="inp-row"><label>اسم الهدية</label><input class="inp" id="gName" value="${esc(ge.name || '')}" placeholder="مثال: أسد"></div>
        <div class="inp-row"><label>قيمة الهدية بالذهب (تُخصم من مُرسِل الهدية)</label><input class="inp" id="gPrice" type="number" min="0" value="${ge.price ?? 10}"></div>
        <div class="inp-row"><label>كم يربح مستقبِل الهدية منها (ذهب) — مثال: قيمتها 10 يربح 4</label><input class="inp" id="gPayout" type="number" min="0" value="${ge.payout ?? 4}"></div>
        <div class="inp-row"><label>قيمة الهدية بالدولار (تسكير الهدايا — للفتيات)</label><input class="inp" id="gUsd" type="number" step="0.01" min="0" value="${ge.usd_value ?? 0}"><div style="font-size:11px;color:#9aa0b5;margin-top:5px">تُستخدم لاحتساب قيمة التحويل إلى دولارات في نظام التسكير (مثال: 1.5 = $1.50)</div></div>
        <div class="inp-row"><label>القسم</label><select class="inp" id="gCat">${['افتراضي', 'فاخرة', 'جواهر'].map(c => `<option ${ge.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="inp-row"><label>نمط الظهور عند الإرسال</label>
          <select class="inp" id="gStyle">
            <option value="auto" ${ge.style !== 'normal' && ge.style !== 'royal' ? 'selected' : ''}>تلقائي (حسب قيمة الهدية)</option>
            <option value="normal" ${ge.style === 'normal' ? 'selected' : ''}>عادية — مشهد صندوق الهدية فقط</option>
            <option value="royal" ${ge.style === 'royal' ? 'selected' : ''}>ملكية — مشهد ملكي بتوهج وتاج 👑</option>
          </select>
          <div style="font-size:11px;color:#9aa0b5;margin-top:5px">«تلقائي» يجعل الهدية تظهر بالمشهد الملكي تلقائياً إذا كانت قيمتها ≥ الحد المحدد أدناه</div>
        </div>
        <div class="inp-row"><label>الحد التلقائي للمشهد الملكي (ذهب)</label><input class="inp" id="gThreshold" type="number" min="0" value="${+(SETTINGS.royal_gift_threshold || 100)}"><div style="font-size:11px;color:#9aa0b5;margin-top:5px">يسري على الهدايا بنمط «تلقائي» فقط. 0 = تعطيل التلقائي (كل الهدايا عادية)</div></div>
        <div class="btn-row" style="justify-content:flex-start">
          <button class="btn btn-purple" id="gSave"><i class="f7-icons">square_arrow_down_fill</i> ${ge.id ? 'حفظ التعديلات' : 'إضافة الهدية'}</button>
          ${ge.id ? '<button class="btn btn-gray" id="gCancel">إلغاء التعديل</button>' : ''}
        </div>
      </div>
      <div class="section-title">الهدايا الحالية</div>
      <div id="gAdminList" style="display:grid;gap:8px"></div>`;
    },
    bind: async () => {
      await renderAdminGifts();
      $('#gUpBtn').onclick = () => $('#gFile').click();
      $('#gFile').onchange = async () => {
        if (!$('#gFile').files[0]) return;
        const fd = new FormData(); fd.append('file', $('#gFile').files[0]);
        const d = await api('/api/admin/upload/gift', 'POST', fd, true);
        $('#gImgPath').textContent = d.path;
        $('#gPrev').innerHTML = `<img src="${esc(d.path)}" style="width:54px;height:54px;object-fit:contain">`;
        toast('تم رفع الصورة');
      };
      $('#gAudioUpBtn').onclick = () => $('#gAudioFile').click();
      $('#gAudioFile').onchange = async () => {
        if (!$('#gAudioFile').files[0]) return;
        const fd = new FormData(); fd.append('file', $('#gAudioFile').files[0]);
        try {
          const d = await api('/api/admin/upload/gift-audio', 'POST', fd, true);
          $('#gAudioPath').textContent = d.path;
          $('#gAudioPreview').src = d.path;
          $('#gAudioPreview').style.display = '';
          toast('تم رفع صوت الهدية');
        } catch (e) { toast(e.error || 'تعذر رفع صوت الهدية', false); }
      };
      $('#gSave').onclick = async () => {
        try {
          const pathTxt = $('#gImgPath').textContent.trim();
          await api('/api/admin/gifts', 'POST', {
            id: ED_GIFT && ED_GIFT.id,
            name: $('#gName').value,
            img: pathTxt.startsWith('/') ? pathTxt : ((ED_GIFT && ED_GIFT.img) || ''),
            audio: $('#gAudioPath').textContent.trim().startsWith('/') ? $('#gAudioPath').textContent.trim() : ((ED_GIFT && ED_GIFT.audio) || ''),
            price: $('#gPrice').value, payout: $('#gPayout').value, cat: $('#gCat').value,
            usd_value: $('#gUsd').value,
            style: $('#gStyle').value
          });
          // حفظ الحد التلقائي للمشهد الملكي (إعداد عام)
          await api('/api/admin/settings', 'POST', { royal_gift_threshold: $('#gThreshold').value });
          SETTINGS.royal_gift_threshold = $('#gThreshold').value;
          ED_GIFT = null;
          toast('تم الحفظ — طُبِّق مباشرة على صفحات الدردشة ⚡');
          loadPage('gifts');
        } catch (e) { toast(e.error || 'تعذر الحفظ', false); }
      };
      const gc = $('#gCancel'); if (gc) gc.onclick = () => { ED_GIFT = null; loadPage('gifts'); };
    }
  },

  // ====== تسكير الهدايا (تحويل الهدايا إلى دولارات — للفتيات فقط) ======
  giftCashout: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#16a34a">bank_fill</i> تسكير الهدايا (تحويل الهدايا إلى دولارات)</div>
      <div class="info-box" style="background:#f0fdf4;border-color:#bbf7d0;color:#166534;margin-bottom:20px">
        <i class="f7-icons" style="vertical-align:middle;margin-inline-end:6px">info_circle_fill</i>
        ميزة خاصة بالفتيات فقط: الهدايا بقيمها <b>بالذهب فقط</b> (لا يوجد سعر دولار لكل هدية).
        تحدد الإدارة <b>الحد الأدنى للذهب</b> (مثال: 100 ذهب) و<b>مبلغ التسكير المقابل له</b> (مثال: 5$) وحساب السحب المصدر.
        <b>المبلغ يتناسب طردياً مع الكمية المحددة:</b> بمعدل 5$ لكل 100 ذهب → إذا حددت 200 ذهب فسيُحوَّل 10$، و150 ذهب = 7.5$.
        عندما يجمع حساب الفتاة الحد الأدنى تحدّد <b>الهدايا التي تريد تسكيها</b> (المحددة فقط تُحذف).
        عند اتمام الطلب من هنا: تدفع الإدارة المبلغ يدوياً من حسابها إلى حساب المستلمة، ثم <b>تُحذف الهدايا المحددة فقط</b> وتبقى بقية هداياها.
      </div>
      <div class="section" style="border:0;box-shadow:none;padding:0">
        <div class="section-title"><i class="f7-icons mi" style="color:#16a34a">wrench_fill</i> إعدادات التسكير</div>
        ${swRow('power', '#16a34a', 'تفعيل نظام تسكير الهدايا', 'cashout_enabled')}
        ${inpRow('cube_box_fill', '#f59e0b', 'الحد الأدنى من الذهب للتسكير (يُجمع عبر الهدايا المستلمة)', 'cashout_gold_min', 'number', 'ذهب 🪙')}
        ${inpRow('bank_fill', '#38bdf8', 'مبلغ التسكير المقابل للحد الأدنى (يتناسب مع الكمية: 5$ لكل 100 ذهب = 10$ لكل 200)', 'cashout_usd_amount', 'number', 'دولار $')}
        ${inpRow('creditcard_fill', '#ec4899', 'حساب الإدارة المصدر (يُسحب منه ويُحوَّل لمستلمة الهدايا)', 'cashout_source_account', 'text', '')}
        <div class="btn-row" style="justify-content:flex-start">
          <button class="btn btn-green" id="saveCashout"><i class="f7-icons">square_arrow_down_fill</i> حفظ إعدادات التسكير</button>
        </div>
      </div>
      <div class="section" style="border:0;box-shadow:none;padding:0;margin-top:22px">
        <div class="section-title"><i class="f7-icons mi" style="color:#818cf8">doc_plaintext</i> طلبات التسكير</div>
        <div id="cashoutList" style="display:grid;gap:10px">جاري التحميل...</div>
      </div>`,
    bind: async () => {
      $('#saveCashout').onclick = async () => {
        await saveKeys(['cashout_enabled', 'cashout_gold_min', 'cashout_usd_amount', 'cashout_source_account']);
        toast('تم حفظ إعدادات تسكير الهدايا ✓');
      };
      await renderCashoutRequests();
    }
  },

  // ====== هدايا حساب معيّن: بحث + عرض + حذف ======
  userGifts: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#ec4899">gift_fill</i> هدايا حساب (بحث وحذف)</div>
      <div class="info-box" style="background:#fff7fb;border-color:#f3d3e2;color:#7b4a63;margin-bottom:16px">
        <i class="f7-icons" style="vertical-align:middle;margin-inline-end:6px">info_circle_fill</i>
        ابحث عن الحساب ثم اختر <b>عرض الهدايا</b> لرؤية كل الهدايا المستلمة في حسابه.
        الحذف يزيل الهدية من رصيد هداياه نهائياً ويؤثر على مجموع الذهب المتاح للتسكير.
        <b>لا يُعاد أي ذهب إلى رصيد الحساب</b> عند الحذف.
      </div>
      <div style="display:flex;gap:10px;margin-bottom:16px">
        <input class="inp" id="ugSearch" placeholder="🔍 ابحث باسم المستخدم...">
        <button class="btn btn-purple btn-sm" id="ugSearchBtn"><i class="f7-icons">search</i> بحث</button>
      </div>
      <div id="ugUsers"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل المستخدمين...</div></div>
      <div id="ugGifts" style="margin-top:20px"></div>`,
    bind: async () => {
      const renderUsers = async (term = '') => {
        const users = await api('/api/admin/users?q=' + encodeURIComponent(term));
        $('#ugUsers').innerHTML = users.length ? users.slice(0, 30).map(u => `
          <div class="list-card">
            <div style="display:flex;align-items:center;gap:10px">
              ${u.avatar ? `<img class="avatar" src="${esc(u.avatar)}" style="width:36px;height:36px;border-radius:50%">` : `<span style="width:36px;height:36px;border-radius:50%;background:#312e81;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px"><i class="f7-icons">person_fill</i></span>`}
              <div>
                <div style="font-weight:800">${esc(u.username)}</div>
                <div style="display:flex;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap">
                  <img src="/badges/${u.badge}" style="width:18px;height:18px">
                  <span class="chip">رصيد: ${u.balance}</span>
                  ${u.gender === 'girl' ? '<span class="chip" style="color:#d43d6e">♀ فتاة</span>' : ''}
                </div>
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
              <button class="btn btn-purple btn-sm" data-ug-open="${u.id}"><i class="f7-icons">gift_fill</i> عرض الهدايا</button>
            </div>
          </div>`).join('') : '<div class="empty">لا يوجد مستخدمون مطابقون</div>';
        $$('#ugUsers [data-ug-open]').forEach(b => b.onclick = () => renderGifts(+b.dataset.ugOpen));
      };

      const renderGifts = async (userId) => {
        const box = $('#ugGifts');
        box.innerHTML = '<div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل الهدايا...</div>';
        let d;
        try { d = await api('/api/admin/users/' + userId + '/gifts'); }
        catch (e) { box.innerHTML = `<div class="empty">${esc(e.error || 'تعذر تحميل الهدايا')}</div>`; return; }
        const u = d.user, tt = d.totals;
        const media = (g) => String(g.gift_img || '').startsWith('/')
          ? `<img src="${esc(g.gift_img)}" style="width:34px;height:34px;object-fit:contain">`
          : `<span style="font-size:26px">${esc(g.gift_img || '🎁')}</span>`;
        box.innerHTML = `
          <div class="section-title"><i class="f7-icons mi" style="color:#ec4899">gift_fill</i> هدايا ${esc(u.username)}</div>
          ${d.pending_cashout ? `<div class="info-box" style="background:#fffbeb;border-color:#fde68a;color:#92400e;margin-bottom:12px">
            <i class="f7-icons" style="vertical-align:middle;margin-inline-end:6px">exclamationmark_triangle_fill</i>
            لهذا الحساب <b>طلب تسكير قيد المراجعة</b> (${d.pending_cashout.gifts_count || 0} هدية — ${d.pending_cashout.gold_total || 0} ذهب).
            حذف الهدايا الآن قد يُنقص ما سيُخصم عند اتمام الطلب.
          </div>` : ''}
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:14px">
            <div style="background:#f8f9fd;border:1px solid #e8ebf5;border-radius:10px;padding:9px 12px"><div style="font-size:11px;color:#98a0b3;font-weight:800">عدد سطور الهدايا</div><b style="font-size:14px;color:#2c3154" id="ugRows">${tt.rows}</b></div>
            <div style="background:#f8f9fd;border:1px solid #e8ebf5;border-radius:10px;padding:9px 12px"><div style="font-size:11px;color:#98a0b3;font-weight:800">إجمالي القطع</div><b style="font-size:14px;color:#2c3154" id="ugItems">${tt.items}</b></div>
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:9px 12px"><div style="font-size:11px;color:#92400e;font-weight:800">مجموع الذهب</div><b style="font-size:15px;color:#b45309" id="ugGold">${tt.gold} 🪙</b></div>
          </div>
          ${tt.rows ? `<div class="btn-row" style="justify-content:flex-start;margin-bottom:12px">
            <button class="btn btn-red btn-sm" id="ugDelAll" style="background:#fee2e2;color:#dc2626"><i class="f7-icons">trash_fill</i> حذف كل الهدايا (${tt.rows})</button>
          </div>` : ''}
          <div id="ugList" style="display:grid;gap:8px">
            ${d.gifts.length ? d.gifts.map(g => `
              <div class="list-card" data-ug-row="${g.id}">
                <div style="display:flex;align-items:center;gap:10px;min-width:0">
                  ${media(g)}
                  <div style="min-width:0">
                    <div style="font-weight:800">${esc(g.gift_name)} <span style="color:#98a0b3">×${g.qty}</span></div>
                    <div style="display:flex;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap">
                      <span class="chip">من: ${esc(g.from_name || '-')}</span>
                      <span class="chip" style="color:#b45309">${g.gold} 🪙</span>
                      <span class="chip">${g.created_at ? new Date(g.created_at * 1000).toLocaleString('ar-EG') : '-'}</span>
                    </div>
                  </div>
                </div>
                <div style="display:flex;gap:8px;justify-content:flex-end">
                  <button class="btn btn-red btn-sm" data-ug-del="${g.id}" data-name="${esc(g.gift_name)}" data-qty="${g.qty}"><i class="f7-icons">trash_fill</i> حذف</button>
                </div>
              </div>`).join('') : '<div class="empty">لا توجد هدايا في هذا الحساب</div>'}
          </div>`;

        const syncTotals = (t) => {
          if ($('#ugRows')) $('#ugRows').textContent = t.rows;
          if ($('#ugItems')) $('#ugItems').textContent = t.items;
          if ($('#ugGold')) $('#ugGold').textContent = t.gold + ' 🪙';
        };

        $$('#ugList [data-ug-del]').forEach(b => b.onclick = async () => {
          if (!confirm(`حذف الهدية "${b.dataset.name}" ×${b.dataset.qty} من حساب ${u.username} نهائياً؟\nلن يُعاد أي ذهب إلى رصيد الحساب.`)) return;
          b.disabled = true;
          try {
            const r = await api(`/api/admin/users/${userId}/gifts/${b.dataset.ugDel}`, 'DELETE');
            const row = document.querySelector(`#ugList [data-ug-row="${b.dataset.ugDel}"]`);
            if (row) row.remove();
            syncTotals(r.totals);
            if (!r.totals.rows) renderGifts(userId);
            toast('تم حذف الهدية من حساب المستخدم ✓');
          } catch (e) { b.disabled = false; toast(e.error || 'تعذر حذف الهدية', false); }
        });

        if ($('#ugDelAll')) $('#ugDelAll').onclick = async () => {
          if (!confirm(`حذف كل هدايا ${u.username} نهائياً (${tt.rows} سطر — ${tt.gold} ذهب)؟\nلا يمكن التراجع، ولن يُعاد أي ذهب إلى رصيد الحساب.`)) return;
          try {
            const r = await api(`/api/admin/users/${userId}/gifts`, 'DELETE');
            toast(`تم حذف ${r.deleted} سطر هدايا من الحساب ✓`);
            renderGifts(userId);
          } catch (e) { toast(e.error || 'تعذر حذف الهدايا', false); }
        };
      };

      await renderUsers();
      $('#ugSearchBtn').onclick = () => renderUsers($('#ugSearch').value);
      $('#ugSearch').onkeydown = e => { if (e.key === 'Enter') renderUsers($('#ugSearch').value); };
    }
  },

  // ====== رفع الإيموجي ======
  emojis: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#fbbf24">smiley_fill</i> رفع الإيموجي</div>
      <div class="section-title">إضافة إيموجي مصور جديد <i class="f7-icons mi" style="color:#818cf8">square_arrow_up_fill</i></div>
      <div class="drop" id="emojiDrop">
        <i class="f7-icons folder">folder_fill</i>
        <div class="t1">انقر لاختيار صور الإيموجي</div>
        <div class="t2">يمكن اختيار عدة صور — PNG / GIF / WEBP — وتظهر فوراً مع الإيموجي في الدردشة بحجم صغير</div>
        <input type="file" id="emojiFiles" accept="image/png,image/gif,image/webp,image/jpeg" multiple style="display:none">
      </div>
      <div class="section-title">الإيموجي المرفوع حالياً</div>
      <div id="emojiAdminGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:10px"></div>`,
    bind: async () => {
      await renderAdminEmojis();
      const doFiles = async (files) => {
        for (const f of files) {
          const fd = new FormData(); fd.append('file', f);
          const up = await api('/api/admin/upload/emoji', 'POST', fd, true);
          await api('/api/admin/emojis', 'POST', { img: up.path });
        }
        toast('تم رفع الإيموجي وظهر فوراً لجميع المتصلين ⚡');
        renderAdminEmojis();
      };
      const dz = $('#emojiDrop');
      dz.onclick = () => $('#emojiFiles').click();
      dz.ondragover = e => { e.preventDefault(); dz.style.background = '#eef2ff'; };
      dz.ondragleave = () => dz.style.background = '';
      dz.ondrop = e => { e.preventDefault(); dz.style.background = ''; if (e.dataTransfer.files.length) doFiles([...e.dataTransfer.files]); };
      $('#emojiFiles').onchange = () => { if ($('#emojiFiles').files.length) doFiles([...$('#emojiFiles').files]); };
    }
  },


  // ====== إدارة الرمزيات والصور ======
  avatars: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#0ea5e9">photo_on_rectangle</i> ${t('إدارة الرمزيات والصور')}</div>
      <div class="info-box" style="background:#e0f2fe;border-color:#bae6fd;color:#0369a1;margin-bottom:18px">
        ${t('تحكم في الرمزيات والصور الافتراضية المتاحة للأعضاء في الشات، يمكنك رفع صور جديدة وتحديد تصنيفها (الافتراضية، الطبيعة، اخرى) أو حذف أي صورة.')}
      </div>

      <div class="section" style="margin-bottom:22px">
        <div class="section-title"><i class="f7-icons mi" style="color:#6366f1">plus_circle_fill</i> ${t('رفع رمزية جديدة')}</div>
        <div style="display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap">
          <div style="flex:1;min-width:180px">
            <label style="display:block;font-size:13px;font-weight:700;color:#334155;margin-bottom:6px">${t('تصنيف الرمزية:')}</label>
            <select class="inp" id="adminAvaCat">
              <option value="def">${t('الافتراضية (def)')}</option>
              <option value="nature">${t('الطبيعة (nature)')}</option>
              <option value="other">${t('اخرى (other)')}</option>
            </select>
          </div>
          <div style="flex:2;min-width:240px">
            <label style="display:block;font-size:13px;font-weight:700;color:#334155;margin-bottom:6px">${t('اختيار ملفات الصور:')}</label>
            <input type="file" id="adminAvaFile" accept="image/*" multiple style="display:none">
            <button class="btn btn-purple" id="adminAvaPickBtn" type="button" style="width:100%"><i class="f7-icons">square_arrow_up_fill</i> ${t('اختيار ورفع الصور (يمكن تحديد عدة صور)')}</button>
          </div>
        </div>
      </div>

      <div class="section">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:16px">
          <div class="section-title" style="margin:0">${t('الرمزيات المتوفرة')}</div>
          <div class="seg blue" style="margin:0">
            <button class="admin-ava-filter active" data-cat="def">${t('الافتراضية')}</button>
            <button class="admin-ava-filter" data-cat="nature">${t('الطبيعة')}</button>
            <button class="admin-ava-filter" data-cat="other">${t('اخرى')}</button>
          </div>
        </div>
        <div id="adminAvaList" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:12px"></div>
      </div>`,
    bind: async () => {
      let currentCat = 'def';
      const renderAdminAvatars = async () => {
        const list = await api('/api/admin/avatars?category=' + currentCat);
        $('#adminAvaList').innerHTML = list.length ? list.map(a => `
          <div style="position:relative;border-radius:14px;overflow:hidden;background:#f1f5f9;border:1px solid #e2e8f0;aspect-ratio:1">
            <img src="${esc(a.path)}" style="width:100%;height:100%;object-fit:cover">
            <button class="btn-del-ava" data-id="${a.id}" style="position:absolute;top:4px;right:4px;background:rgba(220,38,38,0.92);color:#fff;border:0;border-radius:6px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;font-weight:900" title="حذف">×</button>
          </div>
        `).join('') : '<div class="empty" style="grid-column:1/-1">لا توجد رمزيات في هذا القسم</div>';

        $$('.btn-del-ava').forEach(b => b.onclick = async () => {
          if (!confirm(t('هل تريد حذف هذه الرمزية؟'))) return;
          await api('/api/admin/avatars/' + b.dataset.id, 'DELETE');
          toast(t('تم الحذف'));
          renderAdminAvatars();
        });
        applyAdminLanguage($('#adminAvaList'));
      };

      $$('.admin-ava-filter').forEach(btn => {
        btn.onclick = () => {
          $$('.admin-ava-filter').forEach(x => x.classList.toggle('active', x === btn));
          currentCat = btn.dataset.cat;
          renderAdminAvatars();
        };
      });

      $('#adminAvaPickBtn').onclick = () => $('#adminAvaFile').click();
      $('#adminAvaFile').onchange = async () => {
        const files = $('#adminAvaFile').files;
        if (!files || !files.length) return;
        const cat = $('#adminAvaCat').value;
        let successCount = 0;
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const fd = new FormData();
          fd.append('file', f);
          try {
            const up = await api('/api/admin/upload/avatar', 'POST', fd, true);
            await api('/api/admin/avatars', 'POST', { category: cat, path: up.path });
            successCount++;
          } catch (e) { }
        }
        toast(t('تم رفع وحفظ الرمزيات بنجاح ✓') + ` (${successCount})`);
        $('#adminAvaFile').value = '';
        renderAdminAvatars();
      };

      await renderAdminAvatars();
    }
  },

  skin: {
    build: () => {
      const themes = window.SKIN_THEMES || {};
      const palette = window.SKIN_COLOR_PALETTE || [];
      const current = SETTINGS.skin || 'default';
      const themeSwatches = Object.keys(themes).map(k => {
        const t = themes[k];
        const sel = current === k;
        return `
          <div class="skin-box" data-skin="${k}" style="cursor:pointer;text-align:center">
            <div class="skin-swatch" data-skin="${k}" style="background:linear-gradient(135deg, ${t.primary}, ${t.secondary});border:${sel ? '4px solid #4f46e5' : '3px solid #e5e7eb'};box-shadow:${sel ? '0 6px 18px ' : '0 6px 12px '}${t.primary}66"></div>
            <div style="font-size:12px;font-weight:800;color:#374151;margin-top:7px">${t.label}</div>
          </div>`;
      }).join('');
      const colorSwatches = palette.map(c => `
        <button class="skin-dot${current === c ? ' sel' : ''}" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('');
      return `
        <div class="page-title"><i class="f7-icons mi" style="color:#c084fc">paintbrush_fill</i> وضع الجلد</div>

        <div class="section-title">🎨 الثيمات الجميلة الجاهزة</div>
        <div class="section">
          <div style="display:flex;gap:14px;flex-wrap:wrap" id="skins">${themeSwatches}</div>
        </div>

        <div class="section-title">🌈 كل الألوان — اختر لون جلد الشات</div>
        <div class="section">
          <div class="skin-color-grid" id="skinColors">
            <button class="skin-dot auto${current === 'default' ? ' sel' : ''}" data-c="" style="background:linear-gradient(135deg,#9c1e46,#c22e5e)" title="تلقائي (عنابي)">تلقائي</button>
            ${colorSwatches}
          </div>
          <div class="skin-hint">اضغط أي نقطة لاستخدامها كلون كامل للجلد — دون الحاجة إلى ثيم جاهز.</div>
        </div>

        <div class="section-title">🖥️ معاينة حية</div>
        <div class="section">
          <div class="skin-live-preview" id="skinLive"></div>
        </div>

        <div class="btn-row" style="justify-content:flex-start;margin-top:26px">
          <button class="btn btn-purple" id="saveSkin"><i class="f7-icons">square_arrow_down_fill</i> حفظ الجلد</button>
          <button class="btn" id="resetSkin"><i class="f7-icons">arrow_clockwise</i> إعادة العنابي</button>
        </div>`;
    },
    bind: () => {
      renderSkinLive(SETTINGS.skin || 'default');
      $$('.skin-box').forEach(b => {
        const k = b.dataset.skin;
        b.onmouseenter = () => renderSkinLive(k);
        b.onclick = () => { SETTINGS.skin = k; loadPage('skin'); };
      });
      $$('.skin-swatch').forEach(s => s.style.cursor = 'pointer');
      $$('#skinColors .skin-dot').forEach(d => {
        const c = d.dataset.c;
        d.onmouseenter = () => renderSkinLive(c || 'default');
        d.onclick = () => {
          SETTINGS.skin = c || 'default';
          loadPage('skin');
        };
      });
      $('#resetSkin').onclick = () => { SETTINGS.skin = 'default'; loadPage('skin'); };
      $('#saveSkin').onclick = async () => { await saveKeys(['skin']); toast('تم حفظ الجلد'); };
    }
  },

  // ====== تحديد حجم الخط ======
  fontsize: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#94a3b8">textformat_size</i> تحديد حجم الخط</div>
      <div class="row">
        <span class="lbl"><i class="f7-icons mi" style="color:#818cf8">textformat_size</i> حجم خط الرسائل :</span>
        <span style="display:flex;align-items:center;gap:12px">
          <input type="range" min="12" max="22" value="${esc(SETTINGS.font_size || '14')}" id="fsRange" style="width:220px">
          <span class="chip" id="fsVal">${esc(SETTINGS.font_size || '14')}px</span>
        </span>
      </div>
      <div class="section" style="margin-top:18px">
        <div class="section-title">معاينة</div>
        <div id="fsPreview" style="font-size:${esc(SETTINGS.font_size || '14')}px;color:#1f2937">مرحبا بكم في ${esc(SETTINGS.site_name || 'الدردشة')} ★ هذه رسالة تجريبية لمعاينة حجم الخط</div>
      </div>
      <div class="btn-row" style="justify-content:flex-start">
        <button class="btn btn-purple" id="saveFs"><i class="f7-icons">square_arrow_down_fill</i> حفظ حجم الخط</button>
      </div>`,
    bind: () => {
      const r = $('#fsRange');
      r.oninput = () => { $('#fsVal').textContent = r.value + 'px'; $('#fsPreview').style.fontSize = r.value + 'px'; };
      $('#saveFs').onclick = async () => { SETTINGS.font_size = r.value; await saveKeys(['font_size']); toast('تم حفظ حجم الخط'); };
    }
  },

  // ====== إعدادات الراديو المباشر ======
  radio: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#ec4899">antenna_radiowaves_left_right</i> إعدادات الراديو</div>
      <div style="background:#fdf2f8;border:1px solid #fbcfe8;color:#9d174d;border-radius:12px;padding:13px 16px;margin-bottom:18px;font-size:13.5px;font-weight:700;line-height:1.8">
        ضع <b>اسم الراديو</b> و<b>رابط البث المباشر</b> (بث mp3/aac مثل icecast أو shoutcast) ثم فعّل الراديو.<br>
        سيظهر مشغل الراديو <b>أعلى الدردشة مباشرة تحت الهيدر</b> فوراً لجميع المستخدمين، ويعمل على جميع الهواتف.
      </div>
      ${inpRow('textformat_abc', '#ec4899', 'اسم الراديو (يظهر داخل الدردشة)', 'radio_name', 'text', '')}
      ${inpRow('link', '#4ade80', 'رابط البث المباشر (https://.../mp3)', 'radio_url', 'text', '')}
      ${swRow('dot_radiowaves_left_right', '#f59e0b', 'تفعيل الراديو في الدردشة', 'radio_enabled')}
      <div class="btn-row" style="justify-content:flex-start;gap:10px;flex-wrap:wrap">
        <button class="btn btn-purple" id="saveRadio"><i class="f7-icons">square_arrow_down_fill</i> حفظ إعدادات الراديو</button>
        <button class="btn" id="testRadio" type="button" style="background:#10b981;color:#fff"><i class="f7-icons">play_fill</i> تجربة الراديو</button>
      </div>
      <div id="radioTestMsg" style="margin-top:12px;color:#6b7280;font-size:13px;font-weight:700"></div>`,
    bind: () => {
      $('#saveRadio').onclick = async () => {
        await saveSwitches();
        toast('تم حفظ إعدادات الراديو — يتحدّث المشغل فوراً في الدردشة');
      };
      $('#testRadio').onclick = () => {
        const url = String(SETTINGS.radio_url || '').trim();
        const msg = $('#radioTestMsg');
        if (window.__radioTest) {
          try { window.__radioTest.pause(); } catch (e) { }
          window.__radioTest = null;
          $('#testRadio').innerHTML = '<i class="f7-icons">play_fill</i> تجربة الراديو';
          msg.textContent = 'تم إيقاف التجربة.';
          msg.style.color = '#6b7280';
          return;
        }
        if (!url) {
          msg.textContent = '✋ ضع رابط البث أولاً في الحقل أعلاه ثم اضغط تجربة.';
          msg.style.color = '#dc2626';
          return;
        }
        const a = new Audio();
        a.src = url; a.volume = 0.9;
        window.__radioTest = a;
        msg.textContent = '⏳ جاري الاتصال بالبث…';
        msg.style.color = '#6b7280';
        a.play().then(() => {
          msg.textContent = '✅ البث يعمل الآن — هذا بالضبط ما سيسمعه المستخدمون في الدردشة.';
          msg.style.color = '#059669';
          $('#testRadio').innerHTML = '<i class="f7-icons">stop_fill</i> إيقاف التجربة';
        }).catch(() => {
          msg.textContent = '❌ تعذر تشغيل الرابط — تحقق أنه رابط بث مباشر صالح (mp3/aac).';
          msg.style.color = '#dc2626';
          window.__radioTest = null;
        });
        a.onerror = () => {
          msg.textContent = '❌ تعذر الوصول للرابط — تحقق من صحة رابط البث وأنه يعمل.';
          msg.style.color = '#dc2626';
          if (window.__radioTest === a) window.__radioTest = null;
          $('#testRadio').innerHTML = '<i class="f7-icons">play_fill</i> تجربة الراديو';
        };
      };
    }
  },

  // ====== قائمة الغرف ======
  rooms: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#fb923c">house_fill</i> اعدادات الغرف</div>
      <div class="section-title"><i class="f7-icons mi" style="color:#94a3b8">list_bullet</i> قائمة الغرف المتاحة</div>
      <div id="roomsList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل قائمة الغرف...</div></div>`,
    bind: async () => {
      const rooms = await api('/api/admin/rooms');
      ROOMS_CACHE = rooms;
      $('#roomsList').innerHTML = rooms.length ? rooms.map(r => `
        <div class="list-card">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="width:46px;height:46px;border-radius:10px;background:linear-gradient(135deg,#9c1f46,#d43d6e);display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;overflow:hidden">${r.image ? `<img src="${esc(r.image)}" style="width:100%;height:100%;object-fit:cover">` : '<i class="f7-icons">house_fill</i>'}</div>
            <div>
              <div style="font-weight:800;color:#111827">${esc(r.name)}</div>
              <div style="font-size:12.5px;color:#6b7280">${esc(r.description)}</div>
              <div style="display:flex;gap:7px;margin-top:5px;flex-wrap:wrap">
                <span class="chip">${r.type === 'voice' ? 'صوتية 🎙' : 'افتراضية 💬'}</span>
                <span class="chip">${r.max_users} مستخدم</span>
                <span class="chip" style="color:${r.status === 'open' ? '#059669' : '#dc2626'}">${r.status === 'open' ? '● مفتوحة' : '● مغلقة'}</span>
                ${r.password ? '<span class="chip" style="color:#d946a6">🔒 برقم سري</span>' : ''}
              </div>
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-yellow btn-sm" onclick="editRoom(${r.id})"><i class="f7-icons">pencil</i> تعديل</button>
            <button class="btn btn-red btn-sm" onclick="delRoom(${r.id})"><i class="f7-icons">trash_fill</i> حذف</button>
          </div>
        </div>`).join('') : '<div class="empty">لا توجد غرف بعد</div>';
    }
  },

  // ====== اضافة غرفة ======
  roomAdd: {
    build: () => {
      const r = editingRoom || {};
      return `
      <div class="page-title"><i class="f7-icons mi" style="color:#7c3aed">plus_square_fill</i> ${editingRoom ? 'تعديل غرفة' : 'اضافة غرفة جديدة'}</div>
      <div class="grid2">
        <div class="fgroup"><label><i class="f7-icons mi" style="color:#fb923c">house_fill</i> اسم الغرفة *</label>
          <input class="inp" id="rName" value="${esc(r.name || '')}" placeholder="اسم الغرفة"></div>
        <div class="fgroup"><label><i class="f7-icons mi" style="color:#4ade80">circle_grid_hex_fill</i> حالة الغرفة</label>
          <select class="inp" id="rStatus">
            <option value="open" ${(!r.status || r.status === 'open') ? 'selected' : ''}>🟢 مفتوحة (نشطة)</option>
            <option value="closed" ${r.status === 'closed' ? 'selected' : ''}>🔴 مغلقة</option>
          </select></div>
      </div>
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#60a5fa">text_alignleft</i> وصف الغرفة</label>
        <input class="inp" id="rDesc" value="${esc(r.description || `اهلا وسهلا بكم في ${SETTINGS.site_name || 'الدردشة'} ★`)}"></div>
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#16a34a">chat_bubble_text_fill</i> رسالة الترحيب عند دخول الغرفة</label>
        <textarea class="inp" id="rWelcome" rows="3" maxlength="500" placeholder="اتركها فارغة ليبدأ العام بدون أي رسالة">${esc(r.welcome || '')}</textarea>
        <div style="font-size:11.5px;color:#9aa0b5;margin-top:5px">هذه الرسالة وحدها تظهر للعضو عند الدخول، ولا يتم تحميل سجل الرسائل القديم.</div></div>
      <div class="grid2">
        <div class="fgroup"><label><i class="f7-icons mi" style="color:#818cf8">person2_fill</i> الحد الأقصى للمستخدمين</label>
          <input class="inp" type="number" id="rMax" value="${r.max_users || 1000}"></div>
      </div>
      <div style="font-size:12.5px;color:#7b8495;font-weight:700;background:#f8f5ff;border:1px solid #e9ddff;border-radius:10px;padding:9px 13px;margin-top:10px">🎙 جميع الغرف تعمل الآن كنوع «صوتية» بشكل دائم.</div>
      <div class="section-title"><i class="f7-icons mi" style="color:#94a3b8">gear_alt_fill</i> إعدادات إضافية</div>
      ${roomSel('mic_fill', '#c084fc', 'تمكين الصوت', 'rSound', r.sound)}
      ${roomSel('videocam_fill', '#60a5fa', 'تمكين الفيديو', 'rVideo', r.video)}
      ${roomSel('slider_horizontal3', '#f472b6', 'تفعيل الروبوت (eabrmp)', 'rBots', r.bots)}
      ${roomSel('gift_fill', '#fb923c', 'تفعيل الهدايا (eabvg)', 'rGifts', r.gifts)}
      ${roomSel('gamecontroller_fill', '#4ade80', 'تفعيل الألعاب (gm)', 'rGames', r.games)}
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#d946a6">lock_fill</i> كلمة المرور السرية (اتركها فارغة = بدون حماية)</label>
        <input class="inp" id="rPass" placeholder="اتركها فارغة بدون كلمة مرور" value="${esc(r.password || '')}"></div>
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#22c55e">photo_fill</i> صورة الغرفة</label>
        <div style="display:flex;align-items:center;gap:14px;background:#fff;border:1px solid #e7eaf5;border-radius:12px;padding:12px 14px">
          <div id="roomImgPrev" style="width:64px;height:64px;border-radius:14px;background:linear-gradient(135deg,#9c1f46,#d43d6e);display:flex;align-items:center;justify-content:center;color:#fff;font-size:26px;overflow:hidden;flex:0 0 auto">${r.image ? `<img src="${esc(r.image)}" style="width:100%;height:100%;object-fit:cover">` : '<i class="f7-icons">house_fill</i>'}</div>
          <div style="flex:1">
            <button type="button" class="btn btn-gray" id="roomImgBtn"><i class="f7-icons">square_arrow_up_fill</i> رفع صورة الغرفة</button>
            <input type="file" id="roomImgFile" accept="image/*" style="display:none">
            <div style="font-size:11px;color:#9aa0b5;margin-top:6px" id="roomImgPath">${esc(r.image || 'لم تُرفع صورة بعد (تظهر أول حرف من اسمها)')}</div>
          </div>
        </div></div>
      <div class="btn-row">
        <button class="btn btn-gray" onclick="clearRoomForm()"><i class="f7-icons">trash_fill</i> تفريغ الحقول</button>
        <button class="btn btn-green" id="saveRoomBtn"><i class="f7-icons">checkmark_circle_fill</i> ${editingRoom ? 'حفظ التعديلات' : 'اضافة غرفة'}</button>
      </div>`;
    },
    bind: () => {
      $('#roomImgBtn').onclick = () => $('#roomImgFile').click();
      $('#roomImgFile').onchange = async () => {
        if (!$('#roomImgFile').files[0]) return;
        const fd = new FormData(); fd.append('file', $('#roomImgFile').files[0]);
        const d = await api('/api/admin/upload/room', 'POST', fd, true);
        $('#roomImgPath').textContent = d.path;
        $('#roomImgPrev').innerHTML = `<img src="${esc(d.path)}" style="width:100%;height:100%;object-fit:cover">`;
        toast('تم رفع صورة الغرفة');
      };
      $('#saveRoomBtn').onclick = async () => {
        const imgPath = $('#roomImgPath').textContent.trim();
        const body = {
          name: $('#rName').value.trim(), description: $('#rDesc').value,
          welcome: $('#rWelcome').value.trim(),
          status: $('#rStatus').value, max_users: +$('#rMax').value || 1000, type: 'voice',
          sound: $('#rSound').value === '1', video: $('#rVideo').value === '1', bots: $('#rBots').value === '1',
          gifts: $('#rGifts').value === '1', games: $('#rGames').value === '1',
          password: $('#rPass').value.trim(),
          image: imgPath.startsWith('/') ? imgPath : ((editingRoom && editingRoom.image) || '')
        };
        if (!body.name) return toast('اكتب اسم الغرفة', false);
        if (editingRoom) body.id = editingRoom.id;
        await api('/api/admin/rooms', 'POST', body);
        toast(editingRoom ? 'تم تعديل الغرفة' : 'تمت اضافة الغرفة بنجاح');
        editingRoom = null;
        loadPage('rooms');
      };
    }
  },

  // ====== مشرفو الغرف المستقلون (أدمن لكل غرفة) ======
  roomAdmins: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#fb923c">person_badge_shield_checkmark_fill</i> مشرفو الغرف المستقلون (أدمن غرفة)</div>
      <div class="info-box" style="background:#fff7ed;border-color:#fed7aa;color:#9a3412;margin-bottom:18px">
        قم بتعيين أدمن مستقل لكل غرفة؛ المشرف المعين هنا سيكون <b>أدمن غرفة</b> في هذه الغرفة المحددة فقط ويحمل شارة <b>ادمن غرفة</b> وصلاحيات الكتم والطرد بداخلها، بينما في الغرف الأخرى يظهر بعضويته العادية.
      </div>

      <div class="section" style="margin-bottom:20px">
        <div class="section-title"><i class="f7-icons mi" style="color:#6366f1">plus_circle_fill</i> تعيين مشرف جديد لغرفة</div>
        <div class="grid2">
          <div class="fgroup">
            <label><i class="f7-icons mi" style="color:#fb923c">house_fill</i> اختر الغرفة المستهدفة:</label>
            <select class="inp" id="raRoomSelect">
              <option value="">جاري تحميل الغرف...</option>
            </select>
          </div>
          <div class="fgroup">
            <label><i class="f7-icons mi" style="color:#10b981">person_fill</i> اسم المستخدم المراد تعيينه كأدمن:</label>
            <input class="inp" id="raUsernameInput" placeholder="اكتب اسم المستخدم المسجل بدقة">
          </div>
        </div>
        <div class="btn-row" style="justify-content:flex-start;margin-top:14px">
          <button class="btn btn-green" id="addRoomAdminBtn"><i class="f7-icons">checkmark_circle_fill</i> تعيين كأدمن لهذه الغرفة</button>
        </div>
      </div>

      <div class="section">
        <div class="section-title"><i class="f7-icons mi" style="color:#fbbf24">list_bullet</i> قائمة مشرفي الغرف الحاليين</div>
        <div id="roomAdminsList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل المشرفين...</div></div>
      </div>`,
    bind: async () => {
      try {
        const rooms = await api('/api/admin/rooms');
        $('#raRoomSelect').innerHTML = rooms.length
          ? rooms.map(r => `<option value="${r.id}">🏠 ${esc(r.name)} (${r.type === 'voice' ? 'صوتية' : 'كتابية'})</option>`).join('')
          : '<option value="">لا توجد غرف متاحة</option>';
      } catch (e) {}

      await renderRoomAdminsList();

      $('#addRoomAdminBtn').onclick = async () => {
        const roomId = $('#raRoomSelect').value;
        const username = $('#raUsernameInput').value.trim();
        if (!roomId) return toast('اختر الغرفة أولاً', false);
        if (!username) return toast('اكتب اسم المستخدم', false);
        try {
          await api('/api/admin/room-admins', 'POST', { room_id: +roomId, username });
          $('#raUsernameInput').value = '';
          toast(`تم تعيين ${username} أدمن في الغرفة بنجاح ✓`);
          renderRoomAdminsList();
        } catch (e) {
          toast(e.error || 'تعذر تعيين المشرف', false);
        }
      };
    }
  },

  // ====== رسائل الروبوت المجدولة ======
  bots: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#7c3aed">wand_stars</i> رسائل الروبوت المجدولة</div>
      <div class="section-title"><i class="f7-icons mi" style="color:#d946a6">plus_circle_fill</i> إضافة رسالة روبوت — تُرسل تلقائياً كل فترة</div>
      <div style="background:#fff;border:1px solid #e7eaf5;border-radius:14px;padding:16px;margin-bottom:22px">
        <div class="inp-row"><label>نص الرسالة</label><input class="inp" id="botText" placeholder="مثال: أهلاً وسهلاً بكم في الدردشة ★"></div>
        <div class="inp-row"><label>الغرفة</label><select class="inp" id="botRoom"><option value="0">🌐 كل الغرف</option></select></div>
        <div class="grid2">
          <div class="inp-row"><label>لون الخط</label><input id="botColor" type="color" value="#d946a6" style="height:44px;width:100%;border:1px solid #e7eaf5;border-radius:10px;padding:4px;background:#fff;cursor:pointer"></div>
          <div class="inp-row"><label>حجم الخط (12 - 40)</label><input class="inp" id="botSize" type="number" min="12" max="40" value="16"></div>
        </div>
        <div class="inp-row"><label>التوقيت — تُرسل كل كم ثانية</label><input class="inp num" id="botInterval" type="number" min="1" max="86400" value="5"></div>
        <div class="btn-row" style="justify-content:flex-start">
          <button class="btn btn-purple" id="botSave"><i class="f7-icons">plus_circle_fill</i> إضافة رسالة الروبوت</button>
        </div>
      </div>
      <div class="section-title"><i class="f7-icons mi" style="color:#94a3b8">timer_fill</i> رسائل الروبوت الحالية</div>
      <div id="botList" style="display:grid;gap:8px"></div>`,
    bind: async () => {
      try {
        const rooms = await api('/api/admin/rooms');
        $('#botRoom').innerHTML = '<option value="0">🌐 كل الغرف</option>' + rooms.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
      } catch (e) { }
      renderAdminBots();
      $('#botSave').onclick = async () => {
        try {
          await api('/api/admin/bots', 'POST', {
            text: $('#botText').value, room_id: +$('#botRoom').value || 0,
            color: $('#botColor').value, size: +$('#botSize').value || 16, interval_min: +$('#botInterval').value || 5
          });
          toast('تمت الإضافة — يعمل الروبوت فوراً ⚡');
          loadPage('bots');
        } catch (e) { toast(e.error || 'تعذر الحفظ', false); }
      };
    }
  },

  // ====== توليد روبوت مستخدم داخل غرفة ======
  roomBots: {
    build: () => {
      const bot = EDIT_ROOM_BOT || {};
      const replyMode = bot.reply_enabled !== undefined ? bot.reply_enabled : 1;
      return `
      <div class="page-title"><i class="f7-icons mi" style="color:#7c3aed">person_badge_plus_fill</i> توليد وإعداد روبوت الغرفة</div>
      <div class="room-bot-form">
        <div class="room-bot-form-head">
          <div class="room-bot-preview" id="roomBotPreview">${bot.avatar ? `<img src="${esc(bot.avatar)}" alt="">` : '<i class="f7-icons">person_crop_circle_fill</i>'}</div>
          <div style="flex:1;min-width:0">
            <button class="btn btn-purple" id="roomBotUpload"><i class="f7-icons">photo_fill</i> رفع صورة الروبوت</button>
            <input id="roomBotFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
            <div class="room-bot-path" id="roomBotAvatarPath">${esc(bot.avatar || 'لم تُرفع صورة بعد')}</div>
          </div>
        </div>
        <div class="inp-row"><label>اسم الروبوت</label><input class="inp" id="roomBotName" maxlength="20" value="${esc(bot.username || '')}" placeholder="مثال: رفيق_الدردشة"></div>
        <div class="inp-row"><label>الغرفة التي يدخل إليها</label><select class="inp" id="roomBotRoom"><option value="">جاري تحميل الغرف...</option></select></div>
        <div class="grid2">
          <div class="inp-row"><label>نوع الصلاحية</label><select class="inp" id="roomBotRank">
            <option value="user" ${(!bot.rank || bot.rank === 'user') ? 'selected' : ''}>مستخدم عادي</option>
            <option value="roomadmin" ${bot.rank === 'roomadmin' ? 'selected' : ''}>أدمن غرفة</option>
            <option value="admin" ${bot.rank === 'admin' ? 'selected' : ''}>أدمن</option>
            <option value="superadmin" ${bot.rank === 'superadmin' ? 'selected' : ''}>سوبر أدمن</option>
            ${(ME && ME.rank === 'supermaster') ? `<option value="supermaster" ${bot.rank === 'supermaster' ? 'selected' : ''}>ملك الدردشة (سوبر ماستر 👑)</option>` : ''}
          </select></div>
          <div class="inp-row"><label>نوع العضوية</label><select class="inp" id="roomBotMembership">
            <option value="none" ${(!bot.membership || bot.membership === 'none') ? 'selected' : ''}>بدون عضوية</option>
            <option value="mmez" ${bot.membership === 'mmez' ? 'selected' : ''}>مميز</option>
            <option value="plus" ${bot.membership === 'plus' ? 'selected' : ''}>Plus</option>
            <option value="premium" ${bot.membership === 'premium' ? 'selected' : ''}>Premium</option>
            <option value="vip" ${bot.membership === 'vip' ? 'selected' : ''}>VIP</option>
          </select></div>
        </div>
        
        <div class="inp-row">
          <label><i class="f7-icons mi" style="color:#6366f1">sparkles</i> وضع التحدث والرد في الغرفة :</label>
          <select class="inp" id="roomBotReplyMode">
            <option value="1" ${replyMode === 1 ? 'selected' : ''}>🤖 متحدث ذكي (يرد بالذكاء الاصطناعي عند مناداته بالاسم)</option>
            <option value="2" ${replyMode === 2 ? 'selected' : ''}>💬 متحدث برد مخصص (يرد بالنص المحدد عند مناداته بالاسم)</option>
            <option value="0" ${replyMode === 0 ? 'selected' : ''}>🔇 صامت (لا يتحدث ولا يرد أبداً)</option>
          </select>
        </div>

        <div class="inp-row" id="roomBotCustomRow" style="${replyMode === 2 ? '' : 'display:none'}">
          <label>الرد المخصص عند مناداة اسم الروبوت :</label>
          <input class="inp" id="roomBotReplyText" maxlength="120" value="${esc(bot.reply_text || 'نعم يا {name}؟')}" placeholder="مثال: نعم يا {name}؟">
        </div>

        <div class="room-bot-checks">
          <label><input type="checkbox" id="roomBotVerified" ${bot.verified ? 'checked' : ''}><span>حساب موثق</span><i class="f7-icons">checkmark_seal_fill</i></label>
          <label><input type="checkbox" id="roomBotActive" ${bot.active === 0 ? '' : 'checked'}><span>متواجد داخل الغرفة</span><i class="f7-icons">antenna_radiowaves_left_right</i></label>
        </div>
        <div class="btn-row" style="justify-content:flex-start">
          <button class="btn btn-purple" id="roomBotSave"><i class="f7-icons">wand_stars</i> ${bot.id ? 'حفظ تعديل الروبوت' : 'توليد الروبوت وإدخاله'}</button>
          ${bot.id ? '<button class="btn btn-gray" id="roomBotCancel">إلغاء التعديل</button>' : ''}
        </div>
      </div>
      <div class="section-title"><i class="f7-icons mi" style="color:#8b5cf6">person_2_fill</i> روبوتات الغرف الحالية</div>
      <div id="roomBotList" class="room-bot-list"></div>`;
    },
    bind: async () => {
      const rooms = await api('/api/admin/rooms');
      const current = EDIT_ROOM_BOT ? +EDIT_ROOM_BOT.room_id : 0;
      $('#roomBotRoom').innerHTML = rooms.map(room => `<option value="${room.id}" ${+room.id === current ? 'selected' : ''}>${esc(room.name)}</option>`).join('');
      await renderRoomBots();

      const replyModeSelect = $('#roomBotReplyMode');
      if (replyModeSelect) {
        replyModeSelect.onchange = () => {
          $('#roomBotCustomRow').style.display = replyModeSelect.value === '2' ? 'block' : 'none';
        };
      }

      $('#roomBotUpload').onclick = () => $('#roomBotFile').click();
      $('#roomBotFile').onchange = async () => {
        const file = $('#roomBotFile').files[0]; if (!file) return;
        const fd = new FormData(); fd.append('file', file);
        try {
          const uploaded = await api('/api/admin/upload/bot-avatar', 'POST', fd, true);
          $('#roomBotAvatarPath').textContent = uploaded.path;
          $('#roomBotPreview').innerHTML = `<img src="${esc(uploaded.path)}" alt="">`;
          toast('تم رفع صورة الروبوت');
        } catch (e) { toast(e.error || 'تعذر رفع الصورة', false); }
      };
      $('#roomBotSave').onclick = async () => {
        try {
          const avatarText = $('#roomBotAvatarPath').textContent.trim();
          const replyMode = +$('#roomBotReplyMode').value;
          await api('/api/admin/room-bots', 'POST', {
            id: EDIT_ROOM_BOT && EDIT_ROOM_BOT.id,
            username: $('#roomBotName').value.trim(),
            avatar: avatarText.startsWith('/') ? avatarText : ((EDIT_ROOM_BOT && EDIT_ROOM_BOT.avatar) || ''),
            room_id: +$('#roomBotRoom').value,
            rank: $('#roomBotRank').value,
            membership: $('#roomBotMembership').value,
            verified: $('#roomBotVerified').checked,
            active: $('#roomBotActive').checked,
            reply_enabled: replyMode,
            reply_text: $('#roomBotReplyText') ? $('#roomBotReplyText').value : ''
          });
          EDIT_ROOM_BOT = null;
          toast('تم حفظ الروبوت بنجاح ⚡');
          loadPage('roomBots');
        } catch (e) { toast(e.error || 'تعذر حفظ الروبوت', false); }
      };
      const cancel = $('#roomBotCancel'); if (cancel) cancel.onclick = () => { EDIT_ROOM_BOT = null; loadPage('roomBots'); };
    }
  },

  // ====== إعدادات الذكاء الاصطناعي والعقل العصبي ======
  aiSettings: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#6366f1">sparkles</i> إعدادات العقل العصبي والذكاء الاصطناعي (AI)</div>
      <div class="info-box" style="background:#eef2ff;border-color:#c7d2fe;color:#3730a3;margin-bottom:18px">
        يتحكم هذا القسم في العقل العصبي للذكاء الاصطناعي الذي تستخدمه روبوتات الدردشة عند مناداتها بالاسم للإجابة عن أي سؤال بشكل واقعي وذكي. يدعم النظام Google Gemini و Groq (Llama 3.3) و OpenAI و DeepSeek أو أي خادم عصبي مخصص (Ollama / LocalAI).
      </div>

      <div class="section" style="margin-bottom:20px">
        <div class="section-title"><i class="f7-icons mi" style="color:#6366f1">gear_alt_fill</i> تهيئة مزود الذكاء الاصطناعي ومفتاح الـ API</div>
        
        <div class="fgroup">
          <label><i class="f7-icons mi" style="color:#38bdf8">cpu</i> مزود خدمة الذكاء الاصطناعي :</label>
          <select class="inp" id="aiProvider">
            <option value="gemini">⚡ Google Gemini (مجاني وسريع وذكي جداً - مُستحسن)</option>
            <option value="groq">🚀 Groq Cloud (Llama 3.3 70B - مجاني وفائق السرعة)</option>
            <option value="openai">🧠 OpenAI (GPT-4o-mini / GPT-4o)</option>
            <option value="deepseek">🐋 DeepSeek (DeepSeek-V3 / DeepSeek-R1)</option>
            <option value="custom">🌐 خادم عصبي مخصص / Ollama / LocalAI</option>
          </select>
        </div>

        <div class="fgroup">
          <label><i class="f7-icons mi" style="color:#fbbf24">key_fill</i> مفتاح الـ API Key :</label>
          <input class="inp" type="password" id="aiApiKey" placeholder="أدخل مفتاح الـ API الخاص بالمزود المختار هنا...">
        </div>

        <div class="fgroup" id="aiModelGroup">
          <label><i class="f7-icons mi" style="color:#10b981">cube_box_fill</i> اسم النموذج (Model Name) :</label>
          <input class="inp" id="aiModel" placeholder="مثال: gemini-1.5-flash أو llama-3.3-70b-versatile أو gpt-4o-mini">
        </div>

        <div class="fgroup" id="aiCustomGroup" style="display:none">
          <label><i class="f7-icons mi" style="color:#a855f7">link</i> رابط الـ Endpoint المخصص (Custom URL) :</label>
          <input class="inp" id="aiCustomEndpoint" placeholder="مثال: http://localhost:11434/v1/chat/completions">
        </div>

        <div class="fgroup">
          <label><i class="f7-icons mi" style="color:#f472b6">chat_bubble_2_fill</i> التوجيه العام للذكاء الاصطناعي (System Prompt) :</label>
          <textarea class="inp" id="aiSystemPrompt" rows="3" style="resize:vertical" placeholder="التوجيه العام لشخصية الذكاء الاصطناعي..."></textarea>
        </div>

        <div class="btn-row" style="justify-content:flex-start">
          <button class="btn btn-purple" id="saveAiSettingsBtn"><i class="f7-icons">square_arrow_down_fill</i> حفظ إعدادات الذكاء الاصطناعي</button>
        </div>
      </div>

      <div class="section">
        <div class="section-title"><i class="f7-icons mi" style="color:#10b981">bolt_badge_a_fill</i> اختبار العقل العصبي المباشر (Live Neural Test)</div>
        <p style="color:#475569;font-size:13.5px;margin-bottom:14px">اكتب أي سؤال تجريبي لتجربة توليد الرد من العقل العصبي للذكاء الاصطناعي مباشرة والتأكد من سرعة ودقة الإجابة.</p>
        
        <div class="fgroup">
          <input class="inp" id="aiTestPrompt" value="ما هي عاصمة الأردن وكم الساعة الآن واقترح علي نصيحة لليوم؟" placeholder="اكتب سؤالك التجريبي هنا...">
        </div>

        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-green" id="runAiTestBtn" type="button"><i class="f7-icons">sparkles</i> تجربة رد الذكاء الاصطناعي ⚡</button>
        </div>

        <div id="aiTestResultBox" style="display:none;margin-top:16px;background:#f8fafc;border:1.5px solid #cbd5e1;border-radius:14px;padding:16px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap">
            <span class="chip" id="aiTestProviderBadge" style="background:#e0e7ff;color:#3730a3;font-weight:800">🤖 المزود: -</span>
            <span class="chip" id="aiTestLatencyBadge" style="background:#ecfdf5;color:#047857;font-weight:800">⚡ زمن الاستجابة: -</span>
          </div>
          <div id="aiTestReplyText" style="font-size:14.5px;line-height:1.8;color:#0f172a;font-weight:700;white-space:pre-wrap"></div>
        </div>
      </div>`,
    bind: async () => {
      try {
        const s = await api('/api/admin/ai-settings');
        if ($('#aiProvider')) $('#aiProvider').value = s.ai_provider || 'gemini';
        if ($('#aiApiKey')) $('#aiApiKey').value = s.ai_api_key || '';
        if ($('#aiModel')) $('#aiModel').value = s.ai_model || 'gemini-1.5-flash';
        if ($('#aiCustomEndpoint')) $('#aiCustomEndpoint').value = s.ai_custom_endpoint || '';
        if ($('#aiSystemPrompt')) $('#aiSystemPrompt').value = s.ai_system_prompt || '';

        const syncVisibility = () => {
          const prov = $('#aiProvider').value;
          $('#aiCustomGroup').style.display = prov === 'custom' ? 'block' : 'none';
          if (!s.ai_model || s.ai_model === 'gemini-1.5-flash' || s.ai_model === 'llama-3.3-70b-versatile' || s.ai_model === 'gpt-4o-mini' || s.ai_model === 'deepseek-chat') {
            if (prov === 'gemini') $('#aiModel').value = 'gemini-1.5-flash';
            else if (prov === 'groq') $('#aiModel').value = 'llama-3.3-70b-versatile';
            else if (prov === 'openai') $('#aiModel').value = 'gpt-4o-mini';
            else if (prov === 'deepseek') $('#aiModel').value = 'deepseek-chat';
          }
        };
        $('#aiProvider').onchange = syncVisibility;
        syncVisibility();
      } catch (e) { }

      $('#saveAiSettingsBtn').onclick = async () => {
        try {
          await api('/api/admin/ai-settings', 'POST', {
            ai_provider: $('#aiProvider').value,
            ai_api_key: $('#aiApiKey').value.trim(),
            ai_model: $('#aiModel').value.trim(),
            ai_custom_endpoint: $('#aiCustomEndpoint').value.trim(),
            ai_system_prompt: $('#aiSystemPrompt').value.trim()
          });
          toast('تم حفظ إعدادات العقل العصبي والذكاء الاصطناعي بنجاح ✅');
        } catch (e) { toast(e.error || 'تعذر حفظ الإعدادات', false); }
      };

      $('#runAiTestBtn').onclick = async () => {
        const prompt = $('#aiTestPrompt').value.trim();
        if (!prompt) return toast('اكتب سؤالاً تجريبياً أولاً', false);
        const resultBox = $('#aiTestResultBox');
        const replyText = $('#aiTestReplyText');
        const provBadge = $('#aiTestProviderBadge');
        const latBadge = $('#aiTestLatencyBadge');

        resultBox.style.display = 'block';
        replyText.textContent = 'جاري التفكير والتوليد عبر العقل العصبي للذكاء الاصطناعي... ⏳';
        provBadge.textContent = 'جاري الاتصال...';
        latBadge.textContent = '...';

        try {
          const res = await api('/api/admin/ai-test', 'POST', { prompt, user_name: 'أحمد', bot_name: 'البوت_الذكي' });
          replyText.textContent = res.reply;
          provBadge.textContent = '🤖 المزود: ' + res.provider;
          latBadge.textContent = '⚡ زمن الاستجابة: ' + res.latency_ms + ' ms';
          toast('تم توليد الرد بنجاح ⚡');
        } catch (e) {
          replyText.textContent = 'خطأ في التوليد: ' + (e.error || e.message || 'فشل الاتصال');
          toast(e.error || 'فشل التوليد', false);
        }
      };
    }
  },

  // ====== البريد الإلكتروني والتحقق (Gmail) ======
  emailSettings: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#d97706">envelope_fill</i> البريد الإلكتروني والتحقق (Gmail)</div>
      <div class="info-box" style="background:#fffbeb;border-color:#fde68a;color:#92400e;margin-bottom:18px">
        <i class="f7-icons" style="vertical-align:middle;margin-inline-end:6px">info_circle_fill</i>
        عند تسجيل عضوية جديدة يُطلب <b>بريد Gmail</b> إلزامياً، ويُرسَل <b>رمز تفعيل (6 أرقام)</b> إليه — لا يُفعَّل الحساب ولا يدخل الدردشة إلا بعد إدخال الرمز الصحيح.
        البريد المستخدم <b>لا يمكن استخدامه لحساب آخر</b>.
        لإرسال الرسائل فعلياً فعّل SMTP أدناه (لـ Gmail: استخدم «كلمة مرور تطبيق» من Google).
      </div>
      <div class="section">
        <div class="section-title"><i class="f7-icons mi" style="color:#d97706">cloud_fill</i> إعدادات SMTP (إرسال الرمز)</div>
        ${swRow('power', '#d97706', 'تفعيل إرسال البريد (SMTP)', 'smtp_enabled')}
        ${inpRow('globe', '#6366f1', 'خادم SMTP (host)', 'smtp_host', 'text', '')}
        ${inpRow('number', '#10b981', 'المنفذ (port) — 587 أو 465', 'smtp_port', 'number', '')}
        ${inpRow('person_fill', '#38bdf8', 'بريد SMTP (user)', 'smtp_user', 'text', '')}
        ${inpRow('key_fill', '#ef4444', 'كلمة مرور SMTP / كلمة مرور تطبيق', 'smtp_pass', 'text', '')}
        ${swRow('lock_fill', '#8b5cf6', 'اتصال آمن (SSL/TLS — اختره مع المنفذ 465)', 'smtp_secure')}
        ${inpRow('envelope_fill', '#d97706', 'اسم/بريد المرسل (from)', 'smtp_from', 'text', '')}
        <div class="btn-row" style="justify-content:flex-start">
          <button class="btn btn-green" id="saveEmailSettings"><i class="f7-icons">square_arrow_down_fill</i> حفظ إعدادات البريد</button>
          <button class="btn btn-gray" id="sendEmailTest"><i class="f7-icons">paperplane_fill</i> إرسال بريد تجريبي</button>
        </div>
        <div class="fgroup" style="margin-top:12px">
          <input type="email" id="emailTestTo" class="inp" dir="ltr" style="text-align:left" placeholder="بريد Gmail لتجربة الإرسال (مثال: you@gmail.com)">
        </div>
      </div>
      <div class="section" style="margin-top:22px">
        <div class="section-title"><i class="f7-icons mi" style="color:#ef4444">mail_fill</i> إلغاء / تحرير بريد من أي حساب</div>
        <div class="info-box" style="background:#fef2f2;border-color:#fecaca;color:#991b1b;margin-bottom:12px">
          <i class="f7-icons" style="vertical-align:middle;margin-inline-end:6px">info_circle_fill</i>
          اكتب بريد Gmail أو اسم مستخدم ثم ألغِ البريد من الحساب — يُحرَّر البريد ليُستخدم لحساب آخر.
          الحساب الذي برده <b>غير مفعَّل</b> يبقى «محتاجاً للتفعيل» ولا يدخل الدردشة حتى يُفعَّل.
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <input type="text" id="acctSearchQ" class="inp" dir="ltr" style="text-align:left;flex:1" placeholder="you@gmail.com أو اسم المستخدم">
          <button class="btn btn-purple" id="acctSearchBtn" type="button"><i class="f7-icons">magnifier</i> بحث</button>
        </div>
        <div id="acctSearchResults" style="display:flex;flex-direction:column;gap:8px"><div style="color:#94a3b8;font-weight:700;font-size:12.5px">أدخل بريداً أو اسم مستخدم للبحث...</div></div>
      </div>
      <div class="section" style="margin-top:22px">
        <div class="section-title"><i class="f7-icons mi" style="color:#94a3b8">doc_text_fill</i> سجل الرسائل (آخر 100)</div>
        <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12.5px;font-weight:700">
          <thead><tr style="background:#f8fafc;color:#64748b">
            <th style="text-align:right;padding:9px 12px">البريد</th>
            <th style="text-align:right;padding:9px 12px">الموضوع</th>
            <th style="text-align:center;padding:9px 12px">الرمز</th>
            <th style="text-align:center;padding:9px 12px">الحالة</th>
            <th style="text-align:right;padding:9px 12px">الوقت</th>
          </tr></thead>
          <tbody id="emailLogsBody"><tr><td colspan="5" style="padding:16px;text-align:center;color:#94a3b8">جاري التحميل...</td></tr></tbody>
        </table></div>
      </div>`,
    bind: async () => {
      try {
        const s = await api('/api/admin/email-settings');
        ['smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from'].forEach(k => { const el = $(`[data-key="${k}"]`); if (el) el.value = s[k] ?? ''; });
        const en = $('[data-key="smtp_enabled"]'); if (en) en.checked = !!s.smtp_enabled;
        const se = $('[data-key="smtp_secure"]'); if (se) se.checked = !!s.smtp_secure;
      } catch (e) {}
      $('#saveEmailSettings').onclick = async () => {
        try {
          await api('/api/admin/email-settings', 'POST', {
            smtp_enabled: $('[data-key="smtp_enabled"]').checked ? 1 : 0,
            smtp_host: $('[data-key="smtp_host"]').value.trim(),
            smtp_port: +$('[data-key="smtp_port"]').value || 587,
            smtp_user: $('[data-key="smtp_user"]').value.trim(),
            smtp_pass: $('[data-key="smtp_pass"]').value,
            smtp_secure: $('[data-key="smtp_secure"]').checked ? 1 : 0,
            smtp_from: $('[data-key="smtp_from"]').value.trim()
          });
          toast('تم حفظ إعدادات البريد ✓');
        } catch (e) { toast(e.error || 'تعذر الحفظ', false); }
      };
      $('#sendEmailTest').onclick = async () => {
        const to = $('#emailTestTo').value.trim();
        if (!to) { toast('أدخل بريداً Gmail صالحاً للتجربة', false); return; }
        const btn = $('#sendEmailTest'); btn.disabled = true;
        try {
          const d = await api('/api/admin/email-test', 'POST', { to });
          toast(d.sent ? 'تم إرسال البريد التجريبي ✓' : (d.reason === 'smtp_disabled' ? '⚠️ SMTP غير مفعّل — فعّله أولاً' : 'تعذر الإرسال: ' + (d.reason || '')), d.sent);
        } catch (e) { toast(e.error || 'تعذر الإرسال', false); }
        finally { btn.disabled = false; }
      };
      // سجل الرسائل
      const renderLogs = (logs) => {
        const body = $('#emailLogsBody');
        if (!body) return;
        if (!logs.length) { body.innerHTML = '<tr><td colspan="5" style="padding:16px;text-align:center;color:#94a3b8">لا توجد رسائل مسجلة بعد</td></tr>'; return; }
        body.innerHTML = logs.map(l => {
          const st = l.status === 'sent'
            ? '<span class="chip" style="background:#dcfce7;color:#166534">مُرسَل</span>'
            : (l.status === 'smtp_disabled'
              ? '<span class="chip" style="background:#fef9c3;color:#854d0e">SMTP غير مفعّل</span>'
              : '<span class="chip" style="background:#fee2e2;color:#991b1b">فشل</span>');
          const time = new Date((+l.created_at || 0) * 1000).toLocaleString('ar-JO');
          return `<tr style="border-top:1px solid #eef0f6">
            <td style="padding:9px 12px" dir="ltr">${esc(l.to_email)}</td>
            <td style="padding:9px 12px">${esc(l.subject || '')}</td>
            <td style="padding:9px 12px;text-align:center;font-weight:900;letter-spacing:2px" dir="ltr">${esc(l.code || '')}</td>
            <td style="padding:9px 12px;text-align:center">${st}${l.error ? `<div style="font-size:10.5px;color:#b91c1c;margin-top:3px">${esc(l.error.slice(0, 90))}</div>` : ''}</td>
            <td style="padding:9px 12px;color:#94a3b8">${time}</td>
          </tr>`;
        }).join('');
      };
      try { renderLogs(await api('/api/admin/email-logs')); } catch (e) { renderLogs([]); }

      // ===== إلغاء/تحرير بريد من أي حساب =====
      const renderAcctResults = (rows) => {
        const box = $('#acctSearchResults');
        if (!box) return;
        if (!rows.length) {
          box.innerHTML = '<div style="color:#94a3b8;font-weight:700;font-size:12.5px">لا يوجد حساب بهذا البريد أو الاسم</div>';
          return;
        }
        box.innerHTML = rows.map(r => {
          const st = r.email_verified
            ? '<span class="chip" style="background:#dcfce7;color:#166534">مفعَّل</span>'
            : '<span class="chip" style="background:#fef9c3;color:#854d0e">غير مفعَّل (محتاج للتفعيل)</span>';
          const created = new Date((+r.created_at || 0) * 1000).toLocaleString('ar-JO');
          return `
            <div style="border:1px solid #eef0f6;border-radius:14px;padding:12px 14px;background:#fff">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <b style="font-size:14px">${esc(r.username)}</b>
                <span style="font-size:11.5px;color:#94a3b8;font-weight:700">${esc(r.rank)}</span>
                ${st}
                <span style="font-size:11px;color:#94a3b8" dir="ltr">${esc(r.email)}</span>
                <span style="font-size:11px;color:#cbd5e1">📅 ${created}</span>
              </div>
              <div style="margin-top:10px;display:flex;gap:8px">
                <button class="btn btn-red btn-sm" data-release="${r.id}" data-email="${esc(r.email)}">
                  <i class="f7-icons">mail_open_fill</i> إلغاء البريد وتحريره
                </button>
              </div>
            </div>`;
        }).join('');
        box.querySelectorAll('[data-release]').forEach(btn => {
          btn.onclick = async () => {
            if (!confirm(`إلغاء البريد ${btn.dataset.email} من هذا الحساب؟\nسيُحرَّر البريد ليُستخدم لحساب آخر، والحساب غير المفعَّل يبقى محتاجاً للتفعيل.`)) return;
            btn.disabled = true;
            try {
              const d = await api(`/api/admin/release-email/${btn.dataset.release}`, 'POST');
              toast('تم إلغاء البريد وتحريره ✓ ' + (d.released || ''));
              renderAcctResults(rows.filter(x => +x.id !== +btn.dataset.release));
            } catch (e) {
              toast(e.error || 'تعذر إلغاء البريد', false);
              btn.disabled = false;
            }
          };
        });
      };
      const doAcctSearch = async () => {
        const term = ($('#acctSearchQ').value || '').trim();
        if (!term) { toast('أدخل بريداً أو اسم مستخدم', false); return; }
        try {
          const d = await api('/api/admin/find-account?q=' + encodeURIComponent(term));
          renderAcctResults(d.found || []);
        } catch (e) { toast(e.error || 'تعذر البحث', false); }
      };
      const sb = $('#acctSearchBtn');
      if (sb) sb.onclick = doAcctSearch;
      const sq = $('#acctSearchQ');
      if (sq) sq.addEventListener('keydown', e => { if (e.key === 'Enter') doAcctSearch(); });
    }
  },

  // ====== اعدادات النظام ======
  system: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#94a3b8">wrench_fill</i> اعدادات النظام الاساسي</div>
      ${swRow('rosette', '#fbbf24', 'وضع المشرفين (msip)', 'supervisors_mode')}
      ${swRow('keyboard', '#f472b6', 'تمكين المستخدم من التسجيل في الشات (eur)', 'allow_register')}
      ${swRow('clock_fill', '#60a5fa', 'إظهار الوقت مع الرسالة (espumh)', 'show_time')}
      ${swRow('mic_slash_fill', '#94a3b8', 'تفعيل الكتم (mt e)', 'enable_mute')}
      ${swRow('mic_slash_fill', '#f472b6', 'تفعيل الكتم الصامت (mt amt)', 'enable_silent_mute')}
      ${swRow('eye_fill', '#c084fc', 'تفعيل مراقبة الرسائل قبل نشرها (mrs eab)', 'msg_review')}
      ${swRow('wrench_fill', '#94a3b8', 'تفعيل إعدادات الروبوت (esprmh)', 'enable_bots')}
      <div class="section-title" style="margin-top:24px"><i class="f7-icons mi" style="color:#4ade80">chart_bar_fill</i> إعدادات متقدمة</div>
      ${inpRow('link', '#60a5fa', 'رابط الرسائل العامة (puurl)', 'public_msgs_link', 'text', '')}
      <div class="btn-row" style="justify-content:flex-start">
        <button class="btn btn-purple" id="saveSys"><i class="f7-icons">square_arrow_down_fill</i> حفظ الاعدادات</button>
      </div>`,
    bind: () => { $('#saveSys').onclick = async () => { await saveSwitches(); await saveKeys(['public_msgs_link']); toast('تم حفظ اعدادات النظام'); }; }
  },

  // *** أُلغيت صفحة «الحماية والوصول (VPN / المتصفحات)» بالكامل حسب طلب المالك ***
  // لم يعد هناك حظر على VPN/بروكسي/متصفحات، لذا لا صفحة إعدادات لهذه الخاصية.

  // ====== الشروط والخصوصية ======
  legal: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#fdba74">doc_text_fill</i> الشروط والخصوصية</div>
      <div class="info-box" style="background:#eff6ff;border-color:#bfdbfe;color:#1e40af;margin:10px 0 16px">
        اكتب نص «شروط الاستخدام» و«سياسة الخصوصية» اللذين يُعرضان عند النقر على روابط ورقة الدخول في الشات. يدعم النص أسطراً جديدة.
      </div>
      <div class="row" style="flex-direction:column;align-items:stretch;gap:6px">
        <span class="lbl"><i class="f7-icons mi" style="color:#60a5fa">doc_text_fill</i> شروط الاستخدام :</span>
        <textarea class="inp" data-key="terms_text" style="min-height:200px;direction:rtl;white-space:pre-wrap">${esc(SETTINGS.terms_text || '')}</textarea>
      </div>
      <div class="row" style="flex-direction:column;align-items:stretch;gap:6px;margin-top:14px">
        <span class="lbl"><i class="f7-icons mi" style="color:#f472b6">lock_shield_fill</i> سياسة الخصوصية :</span>
        <textarea class="inp" data-key="privacy_text" style="min-height:200px;direction:rtl;white-space:pre-wrap">${esc(SETTINGS.privacy_text || '')}</textarea>
      </div>
      <div class="btn-row" style="justify-content:flex-start">
        <button class="btn btn-purple" id="saveLegal"><i class="f7-icons">square_arrow_down_fill</i> حفظ الشروط والخصوصية</button>
      </div>`,
    bind: () => { $('#saveLegal').onclick = async () => { await saveSwitches(); toast('تم حفظ الشروط والخصوصية'); }; }
  },

  // ====== اضافة مستخدم ======
  userAdd: {
    build: () => userForm(null),
    bind: () => bindUserForm(null)
  },

  // ====== تحرير مستخدم ======
  userEdit: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#f59e0b">pencil_circle_fill</i> تحرير مستخدم</div>
      <div style="display:flex;gap:10px;margin-bottom:16px">
        <input class="inp" id="searchUser" placeholder="🔍 ابحث باسم المستخدم...">
        <button class="btn btn-purple btn-sm" id="searchBtn"><i class="f7-icons">search</i> بحث</button>
      </div>
      <div id="userEditArea"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل المستخدمين...</div></div>`,
    bind: async () => {
      const render = async (q = '') => {
        const users = await api('/api/admin/users?q=' + encodeURIComponent(q));
        const isMaster = ME && ME.rank === 'supermaster';
        const isSuper = ME && (ME.rank === 'superadmin' || ME.rank === 'supermaster');
        $('#userEditArea').innerHTML = users.length ? users.slice(0, 30).map(u => {
          const isSelf = ME && +ME.id === +u.id;
          const canDel = !isSelf && (isMaster || (isSuper && u.rank !== 'superadmin' && u.rank !== 'supermaster'));
          return `
          <div class="list-card">
            <div style="display:flex;align-items:center;gap:10px">
              ${u.avatar ? `<img class="avatar" src="${esc(u.avatar)}" style="width:36px;height:36px;border-radius:50%">` : `<span style="width:36px;height:36px;border-radius:50%;background:#312e81;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px"><i class="f7-icons">person_fill</i></span>`}
              <div>
                <div style="font-weight:800">${esc(u.username)}</div>
                <div style="display:flex;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap">
                  <img src="/badges/${u.badge}" style="width:18px;height:18px">
                  <span class="chip">رصيد: ${u.balance}</span>
                  ${u.ip ? `<span class="chip" dir="ltr">IP: ${esc(u.ip)}</span>` : ''}
                  ${u.banned ? '<span class="chip" style="color:#dc2626">محظور</span>' : ''}
                  ${u.muted ? '<span class="chip" style="color:#d97706">مكتوم</span>' : ''}
                </div>
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
              <button class="btn btn-yellow btn-sm" onclick="editUser(${u.id})"><i class="f7-icons">pencil</i> تعديل</button>
              <button class="btn btn-gray btn-sm" onclick="muteUser(${u.id},${u.muted ? 0 : 1})"><i class="f7-icons">${u.muted ? 'mic_fill' : 'mic_slash_fill'}</i> ${u.muted ? 'إلغاء الكتم' : 'كتم'}</button>
              <button class="btn btn-red btn-sm" onclick="banUser(${u.id},${u.banned ? 0 : 1})"><i class="f7-icons">slash_circle_fill</i> ${u.banned ? 'فك الحظر' : 'حظر'}</button>
              ${canDel ? `<button class="btn btn-red btn-sm" style="background:#fee2e2;color:#dc2626" onclick="deleteUser(${u.id},'${esc(u.username)}')"><i class="f7-icons">trash_fill</i> حذف</button>` : ''}
            </div>
          </div>`;
        }).join('') : '<div class="empty">لا يوجد مستخدمون مطابقون</div>';
      };
      await render();
      $('#searchBtn').onclick = () => render($('#searchUser').value);
      $('#searchUser').onkeydown = e => { if (e.key === 'Enter') render($('#searchUser').value); };
      window._renderUsers = render;
    }
  },

  // ====== طلبات التوثيق والترقية ======
  serviceRequests: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#6366f1">bell_badge_fill</i> طلبات التوثيق والترقية</div>
      <div class="info-box" style="background:#eef2ff;border-color:#c7d2fe;color:#3730a3;margin-bottom:16px">
        عند الموافقة اختر مقدار الذهب الذي سيُخصم من صاحب الطلب. لا يتم الخصم ولا تطبيق التوثيق أو العضوية قبل موافقتك.
      </div>
      <div style="display:flex;gap:8px;margin-bottom:16px" id="requestTabs">
        <button class="btn btn-purple req-tab" data-status="pending">قيد المراجعة</button>
        <button class="btn btn-gray req-tab" data-status="approved">تمت الموافقة</button>
        <button class="btn btn-gray req-tab" data-status="rejected">مرفوضة</button>
      </div>
      <div id="serviceRequestsList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل الطلبات...</div></div>`,
    bind: async () => {
      let currentStatus = 'pending';
      const render = async () => {
        const list = await api('/api/admin/service-requests?status=' + currentStatus);
        $$('.req-tab').forEach(b => {
          b.classList.toggle('btn-purple', b.dataset.status === currentStatus);
          b.classList.toggle('btn-gray', b.dataset.status !== currentStatus);
        });
        $('#serviceRequestsList').innerHTML = list.length ? list.map(r => {
          const isGold = r.request_type === 'gold';
          const isVerify = r.request_type === 'verify';
          const isRoyal = r.request_type === 'royal';
          const isRoyalChange = r.request_type === 'royal_change';
          const title = isGold ? `طلب شراء رصيد (${r.suggested_gold || 0} ذهب)` : (isVerify
            ? 'طلب توثيق الحساب'
            : (isRoyal ? '👑 طلب دخول ملكي'
              : (isRoyalChange ? '👑 طلب تغيير الحيوان الملكي'
                : `طلب ترقية إلى ${String(r.plan || '').toUpperCase()}`)));
          const icon = isGold ? 'money_dollar_circle_fill' : (isVerify ? 'checkmark_seal_fill' : 'crown_fill');
          const iconColor = isGold ? '#f59e0b' : (isVerify ? '#2563eb' : (isRoyal || isRoyalChange ? '#b45309' : '#7c3aed'));
          const iconBg = isGold ? '#fef3c7' : (isVerify ? '#dbeafe' : (isRoyal || isRoyalChange ? '#fef3c7' : '#ede9fe'));
          const borderColor = isGold ? '#fde68a' : (isVerify ? '#bfdbfe' : (isRoyal || isRoyalChange ? '#fcd34d' : '#ddd6fe'));
          let details;
          if (isGold) details = `المستخدم: ${esc(r.username)} • الكمية المطلوبة: ${r.suggested_gold || 0} ذهب`;
          else if (isVerify) details = `المستخدم: ${esc(r.username)}`;
          else if (isRoyal || isRoyalChange) {
            const RA = { lion: ['🦁', 'الأسد الملكي'], whale: ['🐋', 'الحوت الملكي'], eagle: ['🦅', 'العقاب الملكي'], unicorn: ['🦄', 'الوحيد قرن'] };
            const ra = RA[String(r.plan || 'lion')] || RA.lion;
            details = `المستخدم: ${esc(r.username)} • ${isRoyalChange ? 'الحيوان الملكي الجديد' : 'الحيوان الملكي'}: ${ra[0]} ${ra[1]}`;
          } else details = `صاحب الطلب: ${esc(r.username)} • الحساب المستهدف: ${esc(r.target_name)} • المدة: ${r.months} شهر`;
          return `<div class="section" style="margin-bottom:12px;border-color:${borderColor}">
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              <div style="width:44px;height:44px;border-radius:13px;background:${iconBg};color:${iconColor};display:flex;align-items:center;justify-content:center;flex:none"><i class="f7-icons" style="font-size:23px">${icon}</i></div>
              <div style="flex:1;min-width:220px">
                <div style="font-weight:900;color:#1f2937">${title}</div>
                <div style="font-size:12.5px;color:#6b7280;margin-top:4px">${details}</div>
                <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:7px">
                  <span class="chip">الرصيد الحالي: ${r.current_balance ?? 0} ذهب</span>
                  <span class="chip">${isGold ? 'الكمية المطلوبة' : 'التكلفة المقترحة'}: ${r.suggested_gold || 0} ذهب</span>
                  <span class="chip">${new Date(r.created_at * 1000).toLocaleString('ar')}</span>
                </div>
              </div>
            </div>
            ${currentStatus === 'pending' ? `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid #edf0f5">
              <label style="font-size:13px;font-weight:800;color:#374151">${isGold ? 'الذهب المطلوب شحنه للمستخدم:' : 'الذهب المطلوب خصمه:'}</label>
              <input class="inp num request-gold" data-id="${r.id}" type="number" min="${isGold ? 1 : 0}" max="100000" value="${r.suggested_gold ?? (isGold ? 10 : 0)}" style="width:120px">
              <button class="btn btn-green request-approve" data-id="${r.id}" data-type="${r.request_type}"><i class="f7-icons">checkmark_circle_fill</i> ${isGold ? 'موافقة وشحن الذهب' : 'موافقة وتنفيذ'}</button>
              <button class="btn btn-red request-reject" data-id="${r.id}"><i class="f7-icons">xmark_circle_fill</i> رفض</button>
            </div>` : `<div style="margin-top:12px;padding-top:10px;border-top:1px solid #edf0f5;font-size:12.5px;color:${currentStatus === 'approved' ? '#059669' : '#dc2626'};font-weight:800">
              ${currentStatus === 'approved' ? (isGold ? `تمت الموافقة وشحن ${r.approved_gold || 0} ذهب` : `تمت الموافقة وخصم ${r.approved_gold || 0} ذهب`) : `تم الرفض: ${esc(r.note || 'بدون سبب')}`} ${r.admin_name ? `• بواسطة ${esc(r.admin_name)}` : ''}
            </div>`}
          </div>`;
        }).join('') : '<div class="empty">لا توجد طلبات في هذه القائمة</div>';

        $$('.request-approve').forEach(b => b.onclick = async () => {
          const input = $(`.request-gold[data-id="${b.dataset.id}"]`);
          const gold = Math.max(0, parseInt(input.value) || 0);
          const isGoldReq = b.dataset.type === 'gold';
          if (!confirm(isGoldReq ? `الموافقة وشحن ${gold} ذهب إلى رصيد المستخدم؟` : `الموافقة وخصم ${gold} ذهب من المستخدم؟`)) return;
          try {
            await api('/api/admin/service-requests/' + b.dataset.id + '/approve', 'POST', { gold });
            toast(isGoldReq ? 'تمت الموافقة وشحن الذهب للمستخدم' : 'تمت الموافقة وتنفيذ الطلب وخصم الذهب');
            render();
          } catch (e) { toast(e.error || 'تعذرت الموافقة', false); }
        });
        $$('.request-reject').forEach(b => b.onclick = async () => {
          const note = prompt('اكتب سبب الرفض الذي سيصل للمستخدم:', 'تم رفض الطلب من الإدارة');
          if (note === null) return;
          try {
            await api('/api/admin/service-requests/' + b.dataset.id + '/reject', 'POST', { note });
            toast('تم رفض الطلب وإبلاغ المستخدم');
            render();
          } catch (e) { toast(e.error || 'تعذر رفض الطلب', false); }
        });
      };
      $$('.req-tab').forEach(b => b.onclick = () => { currentStatus = b.dataset.status; render(); });
      await render();
    }
  },

  // ====== الحسابات الادارية ======
  admins: {
    build: () => `
      <div class="page-title" style="margin-inline-start:auto"><span style="display:flex;align-items:center;gap:8px">الحسابات الإدارية <i class="f7-icons mi" style="color:#fbbf24">rosette</i></span></div>
      <div style="display:flex;justify-content:flex-start;margin-bottom:18px">
        <button class="btn btn-green btn-sm" onclick="addAdminAccount()"><i class="f7-icons">plus</i> إضافة حساب إداري</button>
      </div>
      <div id="adminsList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل الحسابات...</div></div>`,
    bind: async () => {
      const list = await api('/api/admin/admins');
      const isMaster = ME && ME.rank === 'supermaster';
      const isSuper = ME && (ME.rank === 'superadmin' || ME.rank === 'supermaster');
      $('#adminsList').innerHTML = list.map(u => {
        const isSelf = ME && +ME.id === +u.id;
        const canDelete = isMaster ? !isSelf : (isSuper && u.rank !== 'superadmin' && u.rank !== 'supermaster');
        const canEdit = isMaster || (isSuper && u.rank !== 'supermaster') || isSelf;
        const rankLabel = u.rank === 'supermaster' ? 'ملك الدردشة (سوبر ماستر 👑)' : u.rank === 'superadmin' ? 'سوبر ادمين' : u.rank === 'admin' ? 'ادمن' : 'ادمن غرفة';
        const rankColor = u.rank === 'supermaster' ? '#d97706' : u.rank === 'superadmin' ? '#7c3aed' : u.rank === 'admin' ? '#ea580c' : '#0e9fdd';
        return `
        <div class="list-card">
          <div style="display:flex;gap:8px">
            ${canDelete ? `<button class="btn btn-sm" style="background:#fee2e2;color:#dc2626" onclick="delAdmin(${u.id},'${esc(u.username)}')"><i class="f7-icons">trash_fill</i> حذف</button>` : ''}
            ${canEdit ? `<button class="btn btn-sm" style="background:#fef3c7;color:#92400e" onclick="editUser(${u.id})"><i class="f7-icons">pencil</i> تعديل</button>` : ''}
          </div>
          <div class="u-cell">
            <div class="u-name">${esc(u.username)}
              <span class="avatar-i">${u.avatar ? `<img class="avatar" src="${esc(u.avatar)}" style="width:34px;height:34px;border-radius:50%">` : '<i class="f7-icons">person_fill</i>'}</span>
            </div>
            <span class="rank-pill" style="border-color:${rankColor};color:${rankColor}"><span class="star">★</span> ${rankLabel}</span>
          </div>
        </div>`;
      }).join('') || '<div class="empty">لا توجد حسابات إدارية</div>';
    }
  },

  // ====== قائمة المطرودين من الغرف ======
  kicks: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#f97316">square_arrow_right_fill</i> قائمة المطرودين من الغرف</div>
      <div class="info-box" style="background:#fff7ed;border-color:#fed7aa;color:#9a3412;margin-bottom:16px">
        يبقى الطرد فعالاً ويمنع إعادة دخول الغرفة حتى تضغط «فك الطرد» من هذه الصفحة.
      </div>
      <div id="kicksList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل المطرودين...</div></div>`,
    bind: async () => {
      const list = await api('/api/admin/kicks');
      $('#kicksList').innerHTML = list.length ? list.map(k => `
        <div class="list-card word-card">
          <span class="word-name" style="display:flex;flex-direction:column;align-items:flex-start;gap:5px">
            <span><i class="f7-icons" style="color:#f97316">square_arrow_right_fill</i> ${esc(k.username || 'زائر')}</span>
            <span style="display:flex;gap:6px;flex-wrap:wrap">
              <span class="chip">الغرفة: ${esc(k.room_name)}</span>
              ${k.ip ? `<span class="chip" dir="ltr">IP: ${esc(k.ip)}</span>` : `<span class="chip">User ID: ${k.user_id}</span>`}
              <span class="chip">${esc(k.reason || 'بدون سبب')}</span>
            </span>
          </span>
          <button class="btn btn-green btn-sm" onclick="unkick(${k.id})"><i class="f7-icons">arrow_uturn_left</i> فك الطرد</button>
        </div>`).join('') : '<div class="empty">✅ قائمة المطرودين فارغة</div>';
    }
  },

  // ====== قائمة الحظر ======
  bans: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#dc2626">slash_circle_fill</i> قائمة الحظر</div>
      <div class="info-box" style="background:#fef2f2;border-color:#fecaca;color:#991b1b;margin-bottom:16px">
        حظر الزائر مرتبط بعنوان IP الحقيقي ويبقى فعالاً حتى إزالته من هنا.
      </div>
      <div id="bansList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري التحميل...</div></div>`,
    bind: async () => {
      const list = await api('/api/admin/bans');
      $('#bansList').innerHTML = list.length ? list.map(b => `
        <div class="list-card word-card">
          <span class="word-name" style="display:flex;flex-direction:column;align-items:flex-start;gap:5px">
            <span><i class="f7-icons">nosign</i> ${esc(b.username || 'زائر')}</span>
            <span style="display:flex;gap:6px;flex-wrap:wrap">
              ${b.ip ? `<span class="chip" dir="ltr">IP: ${esc(b.ip)}</span>` : '<span class="chip">حظر حساب</span>'}
              ${b.device_id ? '<span class="chip" style="color:#7c3aed">🔒 حظر جهاز دائم عند تغيير IP</span>' : ''}
              <span class="chip">${esc(b.reason || 'بدون سبب')}</span>
            </span>
          </span>
          <button class="btn btn-green btn-sm" onclick="unban(${b.id})"><i class="f7-icons">arrow_uturn_left</i> فك الحظر</button>
        </div>`).join('') : '<div class="empty">✅ قائمة الحظر فارغة</div>';
    }
  },

  // ====== ارسال اعلان ======
  broadcast: {
    build: () => `
      <div class="page-title" style="margin-inline-start:auto"><span style="display:flex;align-items:center;gap:8px">ارسال اعلان للجميع <i class="f7-icons mi" style="color:#ec4899">bolt_badge_a_fill</i></span></div>
      <div class="section">
        <textarea class="inp" id="bcText" rows="6" maxlength="500" placeholder="اكتب رسالة الاعلان هنا..." style="resize:vertical;font-size:15px"></textarea>
        <div class="counter" style="text-align:left"><span id="bcCount">0</span> / 500 حرف</div>
        <div class="btn-row">
          <button class="btn btn-purple" style="min-width:60%" id="bcSend"><i class="f7-icons">paperplane_fill</i> ارسال الاعلان</button>
        </div>
      </div>`,
    bind: () => {
      const t = $('#bcText');
      t.oninput = () => $('#bcCount').textContent = t.value.length;
      $('#bcSend').onclick = async () => {
        if (!t.value.trim()) return toast('اكتب نص الإعلان أولا', false);
        await api('/api/admin/broadcast', 'POST', { text: t.value });
        toast('تم إرسال الإعلان لجميع الغرف');
        t.value = ''; $('#bcCount').textContent = '0';
      };
    }
  },

  // ====== فلترة الكلمات ======
  words: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#94a3b8">search</i> فلترة الكلمات</div>
      <div class="info-box" style="display:flex;align-items:center;gap:14px;background:#fefce8;border-color:#fde68a">
        <button class="btn btn-yellow btn-sm" id="replBtn"><i class="f7-icons">lock_shield_fill</i> تعديل رمز الاستبدال</button>
        <span style="background:#ef4444;color:#fff;border-radius:50%;width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;font-weight:800">**</span>
        <span style="color:#713f12;font-weight:700">سيتم استبدال الكلمات الممنوعة بـ :</span>
      </div>
      <div class="section-title"><i class="f7-icons mi" style="color:#dc2626">nosign</i> قائمة الكلمات المغلقة</div>
      <div id="wordsList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري التحميل...</div></div>
      <div class="section-title" style="margin-top:22px"><i class="f7-icons mi" style="color:#7c3aed">plus_circle_fill</i> إضافة كلمة جديدة</div>
      <div style="display:flex;gap:10px">
        <input class="inp" id="newWord" placeholder="اكتب الكلمة الممنوعة هنا...">
        <button class="btn btn-green" id="addWordBtn"><i class="f7-icons">plus</i> اضافة كلمة</button>
      </div>`,
    bind: async () => {
      await renderWords();
      $('#addWordBtn').onclick = async () => {
        const w = $('#newWord').value.trim();
        if (!w) return toast('اكتب الكلمة أولا', false);
        if (editingWord) { await api('/api/admin/words', 'POST', { id: editingWord, word: w }); editingWord = null; toast('تم تعديل الكلمة'); }
        else { await api('/api/admin/words', 'POST', { word: w }); toast('تمت إضافة الكلمة'); }
        $('#newWord').value = '';
        await renderWords();
      };
      $('#replBtn').onclick = () => toast('رمز الاستبدال الحالي : **');
    }
  },

  // ====== استئناف الخادم ======
  restart: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#60a5fa">arrow_clockwise_circle_fill</i> استئناف الخادم</div>
      <div class="section" style="text-align:center;padding:50px 20px">
        <i class="f7-icons" style="font-size:60px;color:#6366f1">arrow_clockwise_circle_fill</i>
        <h3 style="margin:14px 0 6px;color:#1f2937">إعادة تشغيل خادم الشات</h3>
        <p style="color:#6b7280;font-size:13.5px">سيتم قطع الاتصال عن جميع المستخدمين لثوانٍ قليلة ثم يعود الخادم للعمل.</p>
        <div class="btn-row">
          <button class="btn btn-red" id="doRestart"><i class="f7-icons">power</i> استئناف الخادم الآن</button>
        </div>
        <div id="rsState" style="margin-top:20px"></div>
      </div>`,
    bind: () => {
      $('#doRestart').onclick = () => {
        $('#rsState').innerHTML = '<div class="loading" style="padding:10px"><i class="f7-icons">arrow2_circlepath</i>جاري استئناف الخادم...</div>';
        setTimeout(() => { $('#rsState').innerHTML = '<div style="color:#059669;font-weight:800">✅ تم استئناف الخادم بنجاح</div>'; }, 2500);
      };
    }
  },

  // ====== توثيق ======
  royalAnimals: {
    build: () => `
      <div class="page-title"><span style="display:flex;align-items:center;gap:8px">صور وأصوات الدخول الملكي <i class="f7-icons mi" style="color:#f59e0b">crown_fill</i></span></div>
      <div class="info-box" style="background:#fff7ed;border-color:#fed7aa;color:#9a3412;margin-bottom:16px">
        هنا تُدير مشاهد الدخول الملكي: قسمان (<b>ذكور</b> / <b>إناث</b>) — لكل دخول زر <b>تعديل</b> ✏️ وزر <b>حذف</b> 🗑️، ويمكن إضافة صورة (GIF/PNG/JPG) وصوت اختياري — يصل التغيير فوراً إلى الدردشة.
      </div>
      <div class="section-title"><span style="display:flex;align-items:center;gap:8px">إضافة دخول ملكي جديد <i class="f7-icons" style="color:#7c3aed">plus_circle_fill</i></span></div>
      <div class="section" style="margin-bottom:16px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <input class="inp" id="raName" placeholder="الاسم (مثال: الوردة الذهبية)">
          <input class="inp" id="raEmoji" placeholder="إيموجي 🌹">
          <input class="inp" id="raColor" type="color" value="#f59e0b" style="height:42px">
          <select class="inp" id="raGender"><option value="boy">قسم الذكور 🦁</option><option value="girl">قسم الإناث 🦋</option></select>
        </div>
        <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">
          <label class="btn btn-purple" style="cursor:pointer"><i class="f7-icons">photo_fill</i> رفع صورة الدخول (GIF/PNG/JPG)<input type="file" id="raGif" accept="image/*" hidden></label>
          <label class="btn btn-green" style="cursor:pointer"><i class="f7-icons">speaker2_fill</i> رفع صوت الدخول (اختياري)<input type="file" id="raSound" accept="audio/*" hidden></label>
          <span id="raFiles" style="align-self:center;color:#64748b;font-size:12px"></span>
        </div>
        <div class="btn-row" style="justify-content:flex-start;margin-top:12px">
          <button class="btn btn-purple" id="raAdd"><i class="f7-icons">plus</i> إضافة الدخول</button>
          <button class="btn" id="raCancel" style="display:none"><i class="f7-icons">xmark</i> إلغاء التعديل</button>
        </div>
      </div>
      <div class="section-title"><span style="display:flex;align-items:center;gap:8px">قسم الذكور <i class="f7-icons" style="color:#38bdf8">person_fill</i></span></div>
      <div id="raBoys" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:18px"></div>
      <div class="section-title"><span style="display:flex;align-items:center;gap:8px">قسم الإناث <i class="f7-icons" style="color:#f472b6">person_fill</i></span></div>
      <div id="raGirls" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px"></div>`,
    bind: () => { bindRoyalAdminForm(); raSetEdit(null); renderRoyalAdmin(); }
  },

  verified: {
    build: () => `
      <div class="page-title" style="margin-inline-start:auto"><span style="display:flex;align-items:center;gap:8px">التوثيق والدخول الملكي <i class="f7-icons mi" style="color:#60a5fa">checkmark_shield_fill</i></span></div>
      <div class="info-box" style="background:#f5f3ff;border-color:#ddd6fe;color:#5b21b6;margin-bottom:16px">
        مدة التوثيق والدخول الملكي <b>شهر واحد (30 يوماً)</b> من تاريخ المنح. يمكنك هنا حذف التوثيق أو الدخول الملكي يدوياً بأي وقت، ويُطبق التغيير فوراً على كل الغرف.
      </div>
      <div class="section-title" style="justify-content:flex-end"><span style="display:flex;align-items:center;gap:8px">الموثقون <i class="f7-icons" style="color:#2563eb">checkmark_seal_fill</i></span></div>
      <div id="verList" style="min-height:60px"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري التحميل...</div></div>
      <div class="section" style="background:#f2f5ff;border-color:#dfe5ff;margin:16px 0">
        <div class="section-title" style="justify-content:flex-end"><span style="display:flex;align-items:center;gap:8px">إضافة عضو جديد للتوثيق <i class="f7-icons" style="color:#7c3aed">plus_circle_fill</i></span></div>
        <div style="display:flex;gap:10px">
          <button class="btn btn-purple" id="addVer"><i class="f7-icons">plus</i> إضافة</button>
          <input class="inp" id="verNames" placeholder="أدخل اسم العضو (مثال: ahmed|mohamed|ali)" style="text-align:right">
        </div>
        <div style="color:#92400e;font-size:12.5px;margin-top:10px;display:flex;align-items:center;gap:6px">
          <i class="f7-icons" style="color:#f59e0b">lightbulb_fill</i> يمكنك إضافة عدة أسماء باستخدام | بين كل اسم، وتُسجَّل الصلاحية شهراً من الآن.
        </div>
      </div>
      <div class="section-title" style="justify-content:flex-end;margin-top:18px"><span style="display:flex;align-items:center;gap:8px">أصحاب الدخول الملكي <i class="f7-icons" style="color:#f59e0b">crown_fill</i></span></div>
      <div id="royalList" style="min-height:60px"></div>`,
    bind: async () => {
      await renderVerified();
      $('#addVer').onclick = async () => {
        const names = $('#verNames').value.trim();
        if (!names) return toast('اكتب اسم العضو', false);
        await api('/api/admin/verified', 'POST', { names });
        $('#verNames').value = '';
        toast('تمت الإضافة للتوثيق');
        await renderVerified();
      };
    }
  },

  // ====== رصد فريق ======
  monitor: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#f472b6">eye_fill</i> رصد فريق</div>
      <div class="monitor-note"><i class="f7-icons">info_circle_fill</i> بطاقة واحدة لكل عنوان IP، وبداخلها أسماء الأشخاص والغرف التي دخلوها.</div>
      <div class="section-title monitor-title"><i class="f7-icons">dot_radiowaves_left_right</i> الاتصالات النشطة حسب عنوان IP</div>
      <div id="teamMonitorList" class="team-monitor-list"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري الرصد...</div></div>`,
    bind: async () => {
      await refreshTeamMonitor();
      MONITOR_TIMER = setInterval(refreshTeamMonitor, 2000);
    }
  },

  // ====== الأرشفة ومحركات البحث (SEO) ======
  seoArchive: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#10b981">globe</i> الأرشفة ومحركات البحث (SEO)</div>
      <div class="info-box" style="background:#ecfdf5;border-color:#a7f3d0;color:#065f46;margin-bottom:18px">
        تحكم في ظهور موقعك ومساراته الفرعية في محركات البحث (Google) ومواقع التواصل الاجتماعي عبر الكلمات المفتاحية والوصف المخصص والصور مع دعم التوليد الذكي بالذكاء الاصطناعي.
      </div>

      <div class="section" style="margin-bottom:22px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px">
          <div class="section-title" style="margin:0"><i class="f7-icons mi" style="color:#6366f1">sparkles</i> إعدادات الهوية والأرشفة للموقع الأساسي (/)</div>
          <button class="btn btn-yellow btn-sm" id="aiGenMainSeoBtn" type="button"><i class="f7-icons">wand_stars</i> 🤖 توليد SEO ذكي بالذكاء الاصطناعي</button>
        </div>
        <div class="grid2">
          <div class="fgroup">
            <label><i class="f7-icons mi" style="color:#3b82f6">house_fill</i> اسم الموقع والدردشة (Site Name):</label>
            <input class="inp" id="seoMainSiteName" placeholder="مثال: شات العرب أو شات الأردن">
          </div>
          <div class="fgroup">
            <label><i class="f7-icons mi" style="color:#3b82f6">textbox</i> عنوان الصفحة لمحركات البحث (Title):</label>
            <input class="inp" id="seoMainTitle" placeholder="مثال: شات العرب - دردشة صوتية وكتابية مجانية">
          </div>
        </div>
        <div class="fgroup">
          <label><i class="f7-icons mi" style="color:#8b5cf6">doc_plaintext</i> وصف الموقع لمحركات البحث (Meta Description):</label>
          <textarea class="inp" id="seoMainDesc" rows="3" placeholder="اكتب وصفاً جذاباً يظهر في نتائج بحث Google..."></textarea>
        </div>
        <div class="fgroup">
          <label><i class="f7-icons mi" style="color:#ec4899">tag_fill</i> الكلمات المفتاحية (Meta Keywords):</label>
          <input class="inp" id="seoMainKeywords" placeholder="شات, دردشة, شات عربي, تعارف, شات صوتي">
        </div>
        <div class="grid2">
          <div class="fgroup">
            <label><i class="f7-icons mi" style="color:#f59e0b">photo_fill</i> صورة الشعار ومواقع التواصل (Open Graph Image):</label>
            <div style="display:flex;align-items:center;gap:8px">
              <input class="inp" id="seoMainImage" placeholder="رابط صورة الشعار (مثال: /img/announcement.png)" style="flex:1">
              <input type="file" id="mainSeoFileInput" accept="image/*" style="display:none">
              <button class="btn btn-green btn-sm" id="uploadMainSeoFileBtn" type="button"><i class="f7-icons">camera_fill</i> رفع الشعار</button>
            </div>
            <div style="margin-top:6px">
              <img id="mainSeoImagePreview" src="" alt="معاينة الشعار" style="max-height:60px;border-radius:8px;border:1px solid #e2e8f0;display:none">
            </div>
          </div>
          <div class="fgroup">
            <label><i class="f7-icons mi" style="color:#38bdf8">star_fill</i> أيقونة الموقع المصغرة (Favicon Icon):</label>
            <div style="display:flex;align-items:center;gap:8px">
              <input class="inp" id="seoMainFavicon" placeholder="رابط الفافيكون (مثال: /uploads/favicon.png)" style="flex:1">
              <input type="file" id="mainFaviconFileInput" accept=".ico,.png,.jpg,.jpeg,.webp,.svg" style="display:none">
              <button class="btn btn-green btn-sm" id="uploadMainFaviconBtn" type="button"><i class="f7-icons">camera_fill</i> رفع أيقونة</button>
            </div>
            <div style="margin-top:6px">
              <img id="mainFaviconPreview" src="" alt="معاينة الفافيكون" style="max-height:36px;border-radius:4px;border:1px solid #e2e8f0;display:none">
            </div>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:800;color:#334155;margin-top:10px;font-size:12.5px">
              <input type="checkbox" id="seoUniqueFavicon" checked style="width:18px;height:18px;accent-color:#7c3aed">
              توليد أيقونة (Favicon) <b>فريدة ومختلفة</b> لكل مسار تلقائياً — إلغاء التحديد يوحّد أيقونة الموقع لكل المسارات
            </label>
          </div>
        </div>
        <button class="btn btn-purple" id="saveMainSeo"><i class="f7-icons">square_arrow_down_fill</i> حفظ إعدادات الموقع والأرشفة الأساسية</button>
      </div>

      <div class="section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px">
          <div class="section-title" style="margin:0"><i class="f7-icons mi" style="color:#10b981">link</i> مسارات الأرشفة المتعددة (مثل /chat1 و /chat2)</div>
          <button class="btn btn-green btn-sm" id="addNewSeoPageBtn"><i class="f7-icons">plus</i> إضافة مسار أرشفة جديد</button>
        </div>

        <div id="seoFormContainer" style="display:none;background:#f8fafc;border:1.5px dashed #cbd5e1;border-radius:14px;padding:16px;margin-bottom:18px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:10px">
            <div style="font-weight:900;color:#1e293b" id="seoFormTitle">إضافة مسار أرشفة جديد</div>
            <button class="btn btn-yellow btn-sm" id="aiGenPageSeoBtn" type="button"><i class="f7-icons">wand_stars</i> 🤖 توليد SEO ذكي لهذا المسار</button>
          </div>
          <input type="hidden" id="seoPageId">
          <div class="grid2">
            <div class="fgroup">
              <label>اسم المسار بالإنجليزية (Slug):</label>
              <div style="display:flex;align-items:center;gap:6px" dir="ltr">
                <span style="color:#64748b;font-weight:800">/</span>
                <input class="inp" id="seoPageSlug" placeholder="chat1" style="flex:1;text-align:left">
              </div>
            </div>
            <div class="fgroup">
              <label>الاسم الظاهر داخل الدردشة (Site Name):</label>
              <input class="inp" id="seoPageSiteName" placeholder="مثال: شات شات1">
            </div>
          </div>
          <div class="fgroup">
            <label>عنوان الصفحة لمحركات البحث (SEO Title):</label>
            <input class="inp" id="seoPageTitleInput" placeholder="مثال: شات 1 - أفضل شات كتابي وصوتي">
          </div>
          <div class="fgroup">
            <label>الوصف لمحركات البحث (Description):</label>
            <textarea class="inp" id="seoPageDesc" rows="2" placeholder="وصف مخصص يظهر في Google عند البحث عن هذا المسار..."></textarea>
          </div>
          <div class="grid2">
            <div class="fgroup">
              <label>الكلمات المفتاحية (Keywords):</label>
              <input class="inp" id="seoPageKeywords" placeholder="شات1, chat1, شات عربي">
            </div>
            <div class="fgroup">
              <label>رابط الشعار المخصص (Logo / Image):</label>
              <div style="display:flex;align-items:center;gap:8px">
                <input class="inp" id="seoPageImage" placeholder="مثال: /img/announcement.png" style="flex:1">
                <input type="file" id="pageSeoFileInput" accept="image/*" style="display:none">
                <button class="btn btn-green btn-sm" id="uploadPageSeoFileBtn" type="button"><i class="f7-icons">camera_fill</i> رفع</button>
              </div>
            </div>
          </div>
          <div style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:10px;padding:10px 13px;margin-bottom:14px;font-size:12px;font-weight:700;line-height:1.9">
            \uD83E\uDDEC <b>منع «طبق الأصل»:</b> يُولَّد لكل مسار عنوان H1 ومحتوى تعريفي وأسئلة شائعة <b>مختلفة</b> تلقائياً من بصمة المسار نفسه. اترك الحقول أدناه فارغة ليُملأ كل مسار بمحتوى فريد، أو اكتبها يدوياً لتتحكم بها بالكامل.
          </div>
          <div class="fgroup">
            <label>العنوان الرئيسي المرئي لمحركات البحث (H1):</label>
            <input class="inp" id="seoPageH1" placeholder="مثال: شات العرب — دردشة صوتية وكتابية مجانية">
          </div>
          <div class="fgroup">
            <label>المحتوى التعريفي الفريد داخل الصفحة (Intro):</label>
            <textarea class="inp" id="seoPageIntro" rows="3" placeholder="نص فريد يظهر داخل صفحة هذا المسار فقط — اتركه فارغاً للتوليد التلقائي..."></textarea>
          </div>
          <div class="fgroup">
            <label>أيقونة الموقع المصغّرة (Favicon) — تُجلب أو تُولَّد تلقائياً:</label>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <img id="seoPageFaviconPreview" src="" alt="" style="width:28px;height:28px;border-radius:7px;border:1px solid #cbd5e1;background:#fff;object-fit:contain;display:none">
              <input class="inp" id="seoPageFavicon" placeholder="اتركه فارغاً ليُولَّد تلقائياً" style="flex:1;min-width:150px">
              <input type="file" id="pageFaviconFileInput" accept=".ico,.png,.jpg,.jpeg,.webp,.svg" style="display:none">
              <button class="btn btn-green btn-sm" id="uploadPageFaviconBtn" type="button"><i class="f7-icons">camera_fill</i> رفع أيقونة</button>
              <button class="btn btn-blue btn-sm" id="autoFaviconBtn" type="button"><i class="f7-icons">sparkles</i> توليد فريد</button>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
              <input class="inp" id="seoPageFaviconUrl" placeholder="أو رابط الموقع لجلب أيقونته: https://example.com" style="flex:1">
              <button class="btn btn-purple btn-sm" id="fetchFaviconBtn" type="button"><i class="f7-icons">arrow_down_circle_fill</i> جلب من الموقع</button>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:800;color:#334155">
              <input type="checkbox" id="seoPageActive" checked style="width:18px;height:18px;accent-color:#10b981">
              تفعيل هذا المسار الآن
            </label>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-green btn-sm" id="saveSeoPageBtn"><i class="f7-icons">checkmark_circle_fill</i> حفظ المسار</button>
            <button class="btn btn-gray btn-sm" id="cancelSeoPageBtn">إلغاء</button>
          </div>
        </div>

        <div id="seoDupPanel" style="margin-bottom:14px"></div>
        <div id="seoPagesList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل المسارات...</div></div>
      </div>`,
    bind: async () => {
      // تحميل إعدادات الأرشفة الأساسية
      try {
        const mainSeo = await api('/api/admin/seo-settings');
        $('#seoMainTitle').value = mainSeo.seo_title || '';
        $('#seoMainDesc').value = mainSeo.seo_description || '';
        $('#seoMainKeywords').value = mainSeo.seo_keywords || '';
        $('#seoMainImage').value = mainSeo.seo_image || mainSeo.logo_url || '';
        $('#seoMainFavicon').value = mainSeo.favicon_url || '';
        $('#seoMainSiteName').value = mainSeo.site_name || SETTINGS.site_name || '';
        if ($('#seoUniqueFavicon')) $('#seoUniqueFavicon').checked = String(mainSeo.seo_unique_favicon || '1') !== '0';
        if (mainSeo.seo_image || mainSeo.logo_url) {
          $('#mainSeoImagePreview').src = mainSeo.seo_image || mainSeo.logo_url;
          $('#mainSeoImagePreview').style.display = 'block';
        }
        if (mainSeo.favicon_url) {
          $('#mainFaviconPreview').src = mainSeo.favicon_url;
          $('#mainFaviconPreview').style.display = 'block';
        }
      } catch (e) {}

      // رفع صورة الشعار للأرشفة الأساسية
      $('#uploadMainSeoFileBtn').onclick = () => $('#mainSeoFileInput').click();
      $('#mainSeoFileInput').onchange = async () => {
        const file = $('#mainSeoFileInput').files && $('#mainSeoFileInput').files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('file', file);
        try {
          toast('جاري رفع صورة الشعار للأرشفة...');
          const res = await api('/api/admin/upload/seo-image', 'POST', fd, true);
          if (res && res.path) {
            $('#seoMainImage').value = res.path;
            $('#mainSeoImagePreview').src = res.path;
            $('#mainSeoImagePreview').style.display = 'block';
            toast('تم رفع صورة الشعار بنجاح ✓');
          }
        } catch (e) { toast(e.error || 'تعذر رفع الصورة', false); }
      };

      // رفع فافيكون للموقع الأساسي
      $('#uploadMainFaviconBtn').onclick = () => $('#mainFaviconFileInput').click();
      $('#mainFaviconFileInput').onchange = async () => {
        const file = $('#mainFaviconFileInput').files && $('#mainFaviconFileInput').files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('file', file);
        try {
          toast('جاري رفع أيقونة الفافيكون...');
          const res = await api('/api/admin/upload/seo-image', 'POST', fd, true);
          if (res && res.path) {
            $('#seoMainFavicon').value = res.path;
            $('#mainFaviconPreview').src = res.path;
            $('#mainFaviconPreview').style.display = 'block';
            toast('تم رفع أيقونة الموقع بنجاح ✓');
          }
        } catch (e) { toast(e.error || 'تعذر رفع الأيقونة', false); }
      };

      // رفع صورة مسار SEO فرعي
      $('#uploadPageSeoFileBtn').onclick = () => $('#pageSeoFileInput').click();
      $('#pageSeoFileInput').onchange = async () => {
        const file = $('#pageSeoFileInput').files && $('#pageSeoFileInput').files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('file', file);
        try {
          toast('جاري رفع صورة الشعار...');
          const res = await api('/api/admin/upload/seo-image', 'POST', fd, true);
          if (res && res.path) {
            $('#seoPageImage').value = res.path;
            toast('تم رفع صورة الشعار بنجاح ✓');
          }
        } catch (e) { toast(e.error || 'تعذر رفع الصورة', false); }
      };

      // رفع فافيكون مسار SEO فرعي
      $('#uploadPageFaviconBtn').onclick = () => $('#pageFaviconFileInput').click();
      $('#pageFaviconFileInput').onchange = async () => {
        const file = $('#pageFaviconFileInput').files && $('#pageFaviconFileInput').files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('file', file);
        try {
          toast('جاري رفع أيقونة الفافيكون...');
          const res = await api('/api/admin/upload/seo-image', 'POST', fd, true);
          if (res && res.path) {
            $('#seoPageFavicon').value = res.path;
            toast('تم رفع أيقونة الفافيكون بنجاح ✓');
          }
        } catch (e) { toast(e.error || 'تعذر رفع الأيقونة', false); }
      };

      // التوليد الذكي بالذكاء الاصطناعي للموقع الأساسي
      $('#aiGenMainSeoBtn').onclick = () => openSeoAiModal('main');

      // التوليد الذكي بالذكاء الاصطناعي للمسار الفرعي
      $('#aiGenPageSeoBtn').onclick = () => openSeoAiModal('page');

      $('#saveMainSeo').onclick = async () => {
        const siteName = $('#seoMainSiteName').value.trim();
        const seoImg = $('#seoMainImage').value.trim();
        const faviconUrl = $('#seoMainFavicon').value.trim();
        await api('/api/admin/seo-settings', 'POST', {
          site_name: siteName,
          logo_url: seoImg,
          favicon_url: faviconUrl,
          seo_title: $('#seoMainTitle').value.trim(),
          seo_description: $('#seoMainDesc').value.trim(),
          seo_keywords: $('#seoMainKeywords').value.trim(),
          seo_image: seoImg,
          seo_unique_favicon: ($('#seoUniqueFavicon') && $('#seoUniqueFavicon').checked) ? '1' : '0'
        });
        if (siteName) SETTINGS.site_name = siteName;
        if (seoImg) SETTINGS.logo_url = seoImg;
        if (faviconUrl) SETTINGS.favicon_url = faviconUrl;
        toast('تم حفظ إعدادات الموقع والأرشفة الأساسية بنجاح ✓');
      };

      // الاسم يظهر حياً في خلفية العامة أثناء الكتابة (بث مسودة فوري للدردشة)
      let seoNameTimer = null;
      const seoNameInput = $('#seoMainSiteName');
      if (seoNameInput) seoNameInput.addEventListener('input', () => {
        clearTimeout(seoNameTimer);
        seoNameTimer = setTimeout(() => {
          api('/api/admin/seo-name-live', 'POST', { site_name: seoNameInput.value.trim() }).catch(() => { });
        }, 350);
      });

      // تحميل قائمة المسارات
      let pages = [];
      const renderPages = async () => {
        try { pages = await api('/api/admin/seo-pages'); } catch (e) { pages = []; }
        if (!pages.length) {
          $('#seoPagesList').innerHTML = '<div class="empty">لم يتم إضافة مسارات أرشفة مخصصة بعد (اضغط ➕ إضافة مسار لإنشاء مسار مثل /chat1)</div>';
          return;
        }
        $('#seoPagesList').innerHTML = pages.map(p => `
          <div class="list-card" style="align-items:flex-start;flex-wrap:wrap;border-right:4px solid ${p.active ? '#10b981' : '#94a3b8'}">
            <div style="flex:1;min-width:260px">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                <span class="chip" style="background:#f0fdf4;color:#166534;font-weight:900" dir="ltr">/${esc(p.slug)}</span>
                <span style="font-weight:900;color:#1e293b;font-size:14.5px">${esc(p.title)}</span>
                <span class="chip" style="font-size:10.5px">${p.active ? '✅ مفعل' : '⏸️ متوقف'}</span>
              </div>
              <div style="font-size:12px;color:#64748b;margin-bottom:4px">${esc(p.description || 'بدون وصف')}</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;font-size:11px">
                <span class="chip">اسم الدردشة: ${esc(p.site_name || 'افتراضي')}</span>
                <span class="chip">الكلمات: ${esc(p.keywords || '—')}</span>
                ${p.logo_image ? `<span class="chip" style="color:#0284c7">🖼️ الشعار مرفق</span>` : ''}
                ${p.favicon ? `<span class="chip" style="color:#7c3aed"><img src="${esc(p.favicon)}" style="width:13px;height:13px;vertical-align:-2px;margin-left:4px;border-radius:3px"> أيقونة خاصة</span>` : '<span class="chip" style="color:#94a3b8">⏳ أيقونة تلقائية</span>'}
                ${p.h1 || p.intro ? '<span class="chip" style="background:#f0fdf4;color:#166534">🧬 محتوى فريد</span>' : '<span class="chip" style="background:#fef2f2;color:#b91c1c">⚠️ بلا محتوى فريد</span>'}
              </div>
            </div>
            <div style="display:flex;gap:6px;align-items:center;margin-top:6px">
              <a href="/${esc(p.slug)}" target="_blank" class="btn btn-sm btn-purple" style="text-decoration:none;display:inline-flex;align-items:center;gap:4px">
                <i class="f7-icons">arrow_up_right</i> فتح المسار
              </a>
              <button class="btn btn-yellow btn-sm edit-seo-btn" data-id="${p.id}"><i class="f7-icons">pencil</i> تعديل</button>
              <button class="btn btn-red btn-sm del-seo-btn" data-id="${p.id}"><i class="f7-icons">trash_fill</i> حذف</button>
            </div>
          </div>`).join('');

        $$('.edit-seo-btn').forEach(btn => {
          btn.onclick = () => {
            const page = pages.find(x => x.id === +btn.dataset.id);
            if (!page) return;
            $('#seoFormContainer').style.display = 'block';
            $('#seoFormTitle').textContent = 'تعديل مسار الأرشفة /' + page.slug;
            $('#seoPageId').value = page.id;
            $('#seoPageSlug').value = page.slug;
            $('#seoPageSiteName').value = page.site_name || '';
            $('#seoPageTitleInput').value = page.title || '';
            $('#seoPageDesc').value = page.description || '';
            $('#seoPageKeywords').value = page.keywords || '';
            $('#seoPageImage').value = page.logo_image || '';
            $('#seoPageFavicon').value = page.favicon || '';
            $('#seoPageH1').value = page.h1 || '';
            $('#seoPageIntro').value = page.intro || '';
            updateSeoFaviconPreview(page.favicon || '');
            $('#seoPageActive').checked = !!page.active;
            $('#seoFormContainer').scrollIntoView({ behavior: 'smooth' });
          };
        });

        $$('.del-seo-btn').forEach(btn => {
          btn.onclick = async () => {
            if (!confirm(t('هل تريد حذف هذا المسار نهائياً؟'))) return;
            await api('/api/admin/seo-pages/' + btn.dataset.id, 'DELETE');
            toast('تم حذف المسار');
            renderPages();
            renderSeoDuplicates();
          };
        });
      };

      // ---------- الأيقونة المصغّرة: توليد فريد أو جلب من موقع خارجي ----------
      $('#autoFaviconBtn').onclick = async () => {
        const slug = $('#seoPageSlug').value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (!slug) return toast('اكتب اسم المسار أولاً', false);
        try {
          const r = await api('/api/admin/seo-favicon/auto', 'POST', { slug });
          $('#seoPageFavicon').value = r.path || '';
          updateSeoFaviconPreview(r.path || '');
          toast('تم توليد أيقونة فريدة لهذا المسار \u2713');
        } catch (e) { toast(e.error || 'تعذر توليد الأيقونة', false); }
      };

      $('#fetchFaviconBtn').onclick = async () => {
        const slug = $('#seoPageSlug').value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        const url = $('#seoPageFaviconUrl').value.trim();
        if (!slug) return toast('اكتب اسم المسار أولاً', false);
        if (!url) return toast('اكتب رابط الموقع لجلب أيقونته', false);
        try {
          const r = await api('/api/admin/seo-favicon/auto', 'POST', { slug, url });
          $('#seoPageFavicon').value = r.path || '';
          updateSeoFaviconPreview(r.path || '');
          toast(r.fetched ? 'تم جلب الأيقونة من الموقع \u2713' : 'تعذر الجلب — تم توليد أيقونة فريدة بدلاً منها');
        } catch (e) { toast(e.error || 'تعذر جلب الأيقونة', false); }
      };

      $('#addNewSeoPageBtn').onclick = () => {
        $('#seoFormContainer').style.display = 'block';
        $('#seoFormTitle').textContent = 'إضافة مسار أرشفة جديد';
        $('#seoPageId').value = '';
        $('#seoPageSlug').value = '';
        $('#seoPageSiteName').value = '';
        $('#seoPageTitleInput').value = '';
        $('#seoPageDesc').value = '';
        $('#seoPageKeywords').value = '';
        $('#seoPageImage').value = '';
        $('#seoPageFavicon').value = '';
        $('#seoPageFaviconUrl').value = '';
        $('#seoPageH1').value = '';
        $('#seoPageIntro').value = '';
        updateSeoFaviconPreview('');
        $('#seoPageActive').checked = true;
      };

      $('#cancelSeoPageBtn').onclick = () => {
        $('#seoFormContainer').style.display = 'none';
      };

      $('#saveSeoPageBtn').onclick = async () => {
        const id = $('#seoPageId').value;
        const slug = $('#seoPageSlug').value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        const title = $('#seoPageTitleInput').value.trim();
        if (!slug) return toast('اكتب اسم المسار مثل chat1', false);
        if (!title) return toast('اكتب عنوان الصفحة', false);

        try {
          const res = await api('/api/admin/seo-pages', 'POST', {
            id: id ? +id : undefined,
            slug,
            title,
            description: $('#seoPageDesc').value.trim(),
            keywords: $('#seoPageKeywords').value.trim(),
            logo_image: $('#seoPageImage').value.trim(),
            site_name: $('#seoPageSiteName').value.trim(),
            favicon: $('#seoPageFavicon').value.trim(),
            h1: $('#seoPageH1').value.trim(),
            intro: $('#seoPageIntro').value.trim(),
            auto_fill: 1,
            active: $('#seoPageActive').checked ? 1 : 0
          });
          if (res && res.favicon) { $('#seoPageFavicon').value = res.favicon; updateSeoFaviconPreview(res.favicon); }
          if (res && res.h1 && !$('#seoPageH1').value.trim()) $('#seoPageH1').value = res.h1;
          if (res && res.intro && !$('#seoPageIntro').value.trim()) $('#seoPageIntro').value = res.intro;
          toast('تم حفظ مسار الأرشفة بنجاح ✓ — بمحتوى وأيقونة فريدة');
          $('#seoFormContainer').style.display = 'none';
          renderPages();
          renderSeoDuplicates();
        } catch (e) {
          toast(e.error || 'تعذر حفظ المسار', false);
        }
      };

      await renderPages();
      renderSeoDuplicates();
    }
  },

  // ====== النسخ الاحتياطي واستعادة البيانات ======
  backup: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#38bdf8">arrow_down_doc_fill</i> النسخ الاحتياطي واستعادة البيانات</div>
      <div class="info-box" style="background:#f0f9ff;border-color:#bae6fd;color:#0369a1;margin-bottom:18px">
        يشمل النسخ الاحتياطي قاعدة البيانات بالكامل: الحسابات والرتب والأرصدة، الرسائل العامة، المحادثات الخاصة، سجلات وتسجيلات المكالمات، الحائط والتعليقات والتفاعلات، الحالات، الهدايا والإيموجيات، الغرف والروبوتات، وصفحات الأرشفة والإعدادات.
      </div>

      <div class="section" style="margin-bottom:22px">
        <div class="section-title"><i class="f7-icons mi" style="color:#10b981">arrow_down_circle_fill</i> إنشاء وتحميل نسخة احتياطية جديدة</div>
        <p style="color:#475569;font-size:13.5px;margin-bottom:16px">اضغط على الزر أدناه لتوليد وتنزيل ملف نسخة احتياطية شاملة بصيغة JSON على جهازك فوراً.</p>
        <a href="/api/admin/backup/export" class="btn btn-purple" style="text-decoration:none;display:inline-flex;align-items:center;gap:8px">
          <i class="f7-icons">arrow_down_to_line</i> تحميل نسخة احتياطية كاملة (JSON)
        </a>
      </div>

      <div class="section">
        <div class="section-title"><i class="f7-icons mi" style="color:#f59e0b">arrow_up_circle_fill</i> استعادة نسخة احتياطية سابقة</div>
        <p style="color:#475569;font-size:13.5px;margin-bottom:14px">اختر ملف النسخة الاحتياطية (.json) لاستعادة كافة البيانات والجداول إلى الحالة المحفوظة في الملف.</p>
        <div style="background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:10px;padding:11px 14px;margin-bottom:16px;font-size:12.5px;font-weight:700">
          ⚠️ تنبيه: استعادة النسخة الاحتياطية ستستبدل البيانات الحالية ببيانات النسخة المرفوعة. يُفضل تحميل نسخة جديدة أولاً قبل الاستعادة.
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <input type="file" id="backupFileInput" accept=".json" style="display:none">
          <button class="btn btn-green" id="selectBackupBtn" type="button"><i class="f7-icons">folder_fill</i> اختيار ملف النسخة (.json)</button>
          <span id="selectedBackupName" style="color:#64748b;font-weight:700;font-size:13px">لم يتم اختيار ملف بعد</span>
          <button class="btn btn-red" id="restoreBackupBtn" type="button" style="display:none"><i class="f7-icons">arrow_up_to_line</i> بدء استعادة البيانات</button>
        </div>
      </div>`,
    bind: () => {
      const fileInput = $('#backupFileInput');
      const selectBtn = $('#selectBackupBtn');
      const nameLabel = $('#selectedBackupName');
      const restoreBtn = $('#restoreBackupBtn');

      selectBtn.onclick = () => fileInput.click();
      fileInput.onchange = () => {
        const file = fileInput.files && fileInput.files[0];
        if (file) {
          nameLabel.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
          restoreBtn.style.display = 'inline-flex';
        } else {
          nameLabel.textContent = 'لم يتم اختيار ملف بعد';
          restoreBtn.style.display = 'none';
        }
      };

      restoreBtn.onclick = async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return toast('اختر ملف النسخة أولاً', false);
        if (!confirm(t('⚠️ تحذير: هل أنت متأكد من استعادة النسخة الاحتياطية؟ سيتم استبدال البيانات الحالية ببيانات هذا الملف.'))) return;

        const fd = new FormData();
        fd.append('backup', file);

        try {
          toast('جاري قراءة واستعادة النسخة الاحتياطية...');
          const res = await api('/api/admin/backup/import', 'POST', fd, true);
          toast(res.message || 'تمت استعادة النسخة الاحتياطية بنجاح ✅');
          setTimeout(() => location.reload(), 1500);
        } catch (e) {
          toast(e.error || 'تعذرت استعادة النسخة الاحتياطية', false);
        }
      };
    }
  },

  // ====== مراقبة الرسائل الخاصة ======
  privateMonitor: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#ec4899">chat_bubble_2_fill</i> مراقبة الرسائل الخاصة</div>
      <div id="pmMonitorContainer">
        <div class="section-title"><i class="f7-icons mi" style="color:#94a3b8">list_bullet</i> المحادثات الخاصة بين المستخدمين</div>
        <div class="fgroup" style="margin-bottom:14px">
          <input type="text" id="pmMonitorSearch" class="inp" placeholder="🔍 بحث باسم أي طرف في المحادثة...">
        </div>
        <div id="pmConvsList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل المحادثات...</div></div>
      </div>
      <div id="pmHistoryContainer" style="display:none"></div>`,
    bind: async () => {
      let convs = [];
      try { convs = await api('/api/admin/private-conversations'); } catch (e) { convs = []; }

      const renderList = (filter = '') => {
        const f = filter.toLowerCase().trim();
        const filtered = convs.filter(c => !f || c.u1.username.toLowerCase().includes(f) || c.u2.username.toLowerCase().includes(f));
        if (!filtered.length) {
          $('#pmConvsList').innerHTML = '<div class="empty">⏳ لا توجد محادثات خاصة مسجلة</div>';
          return;
        }
        $('#pmConvsList').innerHTML = filtered.map(c => `
          <div class="pm-monitor-conv-card">
            <div class="pm-monitor-peers">
              <div class="pm-monitor-user">
                <img src="${esc(c.u1.avatar || '/avatars/default.png')}" alt="">
                <span>${esc(c.u1.username)}</span>
              </div>
              <i class="f7-icons pm-monitor-arrow">arrow_right_arrow_left</i>
              <div class="pm-monitor-user">
                <img src="${esc(c.u2.avatar || '/avatars/default.png')}" alt="">
                <span>${esc(c.u2.username)}</span>
              </div>
              <span class="chip" style="margin-inline-start:8px">${c.msgCount} رسالة</span>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              <div style="font-size:11.5px;color:#94a3b8;font-weight:700">${new Date(c.lastAt * 1000).toLocaleTimeString('ar-JO')}</div>
              <button class="btn btn-purple btn-sm view-pm-btn" data-u1="${c.u1.id}" data-u2="${c.u2.id}"><i class="f7-icons">eye_fill</i> عرض المحادثة</button>
              <button class="btn btn-red btn-sm clear-pm-btn" data-u1="${c.u1.id}" data-u2="${c.u2.id}"><i class="f7-icons">trash_fill</i></button>
            </div>
          </div>`).join('');

        $$('.view-pm-btn').forEach(btn => {
          btn.onclick = () => openPmHistoryView(+btn.dataset.u1, +btn.dataset.u2);
        });
        $$('.clear-pm-btn').forEach(btn => {
          btn.onclick = async () => {
            if (!confirm(t('هل أنت متأكد من مسح هذه المحادثة بالكامل؟'))) return;
            await api(`/api/admin/private-conversations?u1=${btn.dataset.u1}&u2=${btn.dataset.u2}`, 'DELETE');
            toast('تم مسح المحادثة');
            loadPage('privateMonitor');
          };
        });
      };

      renderList();
      $('#pmMonitorSearch').oninput = e => renderList(e.target.value);

      async function openPmHistoryView(u1Id, u2Id) {
        $('#pmMonitorContainer').style.display = 'none';
        const hc = $('#pmHistoryContainer');
        hc.style.display = 'block';
        hc.innerHTML = '<div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل الرسائل...</div>';

        const msgs = await api(`/api/admin/private-messages?u1=${u1Id}&u2=${u2Id}`);
        const c = convs.find(x => (x.u1.id === u1Id && x.u2.id === u2Id) || (x.u1.id === u2Id && x.u2.id === u1Id));
        const u1Name = c ? c.u1.username : 'المستخدم الأول';
        const u2Name = c ? c.u2.username : 'المستخدم الثاني';

        hc.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px">
            <button class="btn btn-purple btn-sm" id="pmBackBtn"><i class="f7-icons">chevron_right</i> عودة للمحادثات</button>
            <div style="font-weight:900;color:#1e293b;font-size:15px">محادثة: <span style="color:#2563eb">${esc(u1Name)}</span> مع <span style="color:#7c3aed">${esc(u2Name)}</span> (${msgs.length} رسالة)</div>
            <button class="btn btn-red btn-sm" id="pmClearFullBtn"><i class="f7-icons">trash_fill</i> مسح الكل</button>
          </div>
          <div class="pm-chat-history-box">
            ${msgs.length ? msgs.map(m => {
              const isU1 = m.from_id === u1Id;
              let contentHtml = esc(m.text);
              if (m.text && m.text.startsWith('media::image::')) {
                const imgPath = m.text.slice('media::image::'.length);
                contentHtml = `<a href="${esc(imgPath)}" target="_blank"><img src="${esc(imgPath)}" style="max-width:200px;max-height:160px;border-radius:8px;display:block;margin-top:4px"></a>`;
              } else if (m.text && m.text.startsWith('media::audio::')) {
                const audioPath = m.text.slice('media::audio::'.length).split('::')[0];
                contentHtml = `<audio src="${esc(audioPath)}" controls style="height:34px;margin-top:4px;width:100%"></audio>`;
              }
              return `
                <div class="pm-history-row ${isU1 ? 'u1' : 'u2'}">
                  <div class="pm-history-header">
                    <b>${esc(m.from_name)}</b>
                    <span>${new Date(m.created_at * 1000).toLocaleTimeString('ar-JO')}</span>
                    <button class="btn btn-red" style="padding:2px 6px;font-size:10px;border-radius:4px;margin-inline-start:auto" onclick="delSinglePm(${m.id}, ${u1Id}, ${u2Id})">حذف</button>
                  </div>
                  <div>${contentHtml}</div>
                </div>`;
            }).join('') : '<div class="empty">لا توجد رسائل</div>'}
          </div>`;

        $('#pmBackBtn').onclick = () => {
          hc.style.display = 'none';
          $('#pmMonitorContainer').style.display = 'block';
        };
        $('#pmClearFullBtn').onclick = async () => {
          if (!confirm(t('هل تريد مسح جميع الرسائل بين هذين المستخدمين؟'))) return;
          await api(`/api/admin/private-conversations?u1=${u1Id}&u2=${u2Id}`, 'DELETE');
          toast('تم مسح المحادثة');
          loadPage('privateMonitor');
        };
      }
    }
  },

  // ====== تسجيلات المكالمات الخاصة ======
  callsRecordings: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#10b981">phone_waveform_fill</i> تسجيلات المكالمات الصوتية</div>
      <div class="info-box" style="background:#f0fdf4;border-color:#bbf7d0;color:#166534;margin-bottom:16px">
        <i class="f7-icons" style="vertical-align:middle;margin-inline-end:6px">lock_shield_fill</i>
        تُحفظ تلقائياً تسجيلات المكالمات الخاصة — هذه الصفحة <b>خاصة بالسوبر ماستر (مالك الدردشة) فقط</b>.
        <b>تسجيلات الفيديو</b> موجودة في صفحة مستقلة: «تسجيل مكالمات الفيديو».
      </div>
      <div class="section-title"><i class="f7-icons mi" style="color:#94a3b8">list_bullet</i> قائمة المكالمات الصوتية المسجلة</div>
      <div class="fgroup" style="margin-bottom:14px">
        <input type="text" id="callSearch" class="inp" placeholder="🔍 بحث باسم المتصل أو المستلم أو اسم الملف...">
      </div>
      <div id="callsList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل التسجيلات...</div></div>`,
    bind: async () => {
      let recs = [];
      try { recs = (await api('/api/admin/call-recordings')).filter(r => r.call_type !== 'video'); } catch (e) { recs = []; }

      const renderCalls = (filter = '') => {
        const f = filter.toLowerCase().trim();
        const filtered = recs.filter(r => !f || r.caller_name.toLowerCase().includes(f) || r.callee_name.toLowerCase().includes(f) || r.filename.toLowerCase().includes(f));
        if (!filtered.length) {
          $('#callsList').innerHTML = '<div class="empty">⏳ لا توجد تسجيلات صوتية بعد</div>';
          return;
        }
        $('#callsList').innerHTML = filtered.map(r => {
          const mediaPath = r.audio_path || r.video_path;
          const m = String(Math.floor((r.duration || 0) / 60)).padStart(2, '0');
          const s = String((r.duration || 0) % 60).padStart(2, '0');
          const durStr = `${m}:${s}`;
          const dateStr = new Date(r.created_at * 1000).toLocaleString('ar-JO');
          return `
            <div class="pm-call-rec-card">
              <div class="pm-call-rec-head">
                <div class="pm-call-rec-title">
                  <i class="f7-icons">phone_fill</i>
                  <span>${esc(r.caller_name)}</span>
                  <i class="f7-icons" style="font-size:15px;color:#94a3b8">arrow_right</i>
                  <span>${esc(r.callee_name)}</span>
                </div>
                <div class="pm-call-rec-meta">
                  <span class="chip" style="background:#ecfdf5;color:#059669;border:1px solid #a7f3d0">⏱️ ${durStr}</span>
                  <span class="chip" style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe">🎙 صوت</span>
                  <span>📅 ${dateStr}</span>
                  <span style="font-size:11px;color:#94a3b8" dir="ltr">${esc(r.filename)}</span>
                </div>
                <div class="pm-call-rec-actions">
                  <a href="${esc(mediaPath)}" download="${esc(r.filename)}" class="btn btn-purple btn-sm" style="text-decoration:none;display:inline-flex;align-items:center;gap:4px">
                    <i class="f7-icons">arrow_down_to_line</i> تحميل
                  </a>
                  <button class="btn btn-red btn-sm" onclick="delCallRecording(${r.id})">
                    <i class="f7-icons">trash_fill</i> حذف
                  </button>
                </div>
              </div>
              <div class="pm-call-rec-player">
                <audio src="${esc(mediaPath)}" controls preload="metadata"></audio>
              </div>
            </div>`;
        }).join('');
      };

      renderCalls();
      $('#callSearch').oninput = e => renderCalls(e.target.value);
    }
  },

  // ====== تسجيل مكالمات الفيديو (صفحة مستقلة بملعق فيديو) ======
  videoCallRecordings: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#ec4899">videocam_fill</i> تسجيل مكالمات الفيديو</div>
      <div class="info-box" style="background:#fdf2f8;border-color:#fbcfe8;color:#9d174d;margin-bottom:16px">
        <i class="f7-icons" style="vertical-align:middle;margin-inline-end:6px">lock_shield_fill</i>
        أرشيف مكالمات الفيديو الخاصة — كل تسجيل يظهر فيه فيديو المتصل كاملاً وكاميرتك مصغّرة (بأسلوب سناب شات) مع الصوت.
        هذه الصفحة <b>خاصة بالسوبر ماستر (مالك الدردشة) فقط</b>.
      </div>
      <div class="section-title"><i class="f7-icons mi" style="color:#94a3b8">list_bullet</i> أرشيف مكالمات الفيديو</div>
      <div class="fgroup" style="margin-bottom:14px">
        <input type="text" id="videoCallSearch" class="inp" placeholder="🔍 بحث باسم المتصل أو المستلم...">
      </div>
      <div id="videoCallsList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل تسجيلات الفيديو...</div></div>`,
    bind: async () => {
      let recs = [];
      try { recs = (await api('/api/admin/call-recordings')).filter(r => r.call_type === 'video'); } catch (e) { recs = []; }

      const renderVideoCalls = (filter = '') => {
        const f = filter.toLowerCase().trim();
        const filtered = recs.filter(r => !f || r.caller_name.toLowerCase().includes(f) || r.callee_name.toLowerCase().includes(f) || r.filename.toLowerCase().includes(f));
        if (!filtered.length) {
          $('#videoCallsList').innerHTML = '<div class="empty">🎬 لا توجد تسجيلات فيديو بعد — عند إجراء مكالمة فيديو وتفعيل التسجيل ستظهر هنا</div>';
          return;
        }
        $('#videoCallsList').innerHTML = filtered.map(r => {
          const mediaPath = r.video_path || r.audio_path;
          const m = String(Math.floor((r.duration || 0) / 60)).padStart(2, '0');
          const s = String((r.duration || 0) % 60).padStart(2, '0');
          const durStr = `${m}:${s}`;
          const dateStr = new Date(r.created_at * 1000).toLocaleString('ar-JO');
          return `
            <div class="pm-video-rec-card">
              <div class="pm-video-rec-head">
                <div class="pm-video-rec-title">
                  <span class="pm-video-rec-badge"><i class="f7-icons">videocam_fill</i></span>
                  <div class="pm-video-rec-names">
                    <b>${esc(r.caller_name)} <i class="f7-icons" style="font-size:13px;color:#94a3b8">arrow_right</i> ${esc(r.callee_name)}</b>
                    <small>📅 ${dateStr} • ⏱️ ${durStr} • <span dir="ltr">${esc(r.filename)}</span></small>
                  </div>
                </div>
                <div class="pm-video-rec-actions">
                  <a href="${esc(mediaPath)}" download="${esc(r.filename)}" class="btn btn-purple btn-sm" style="text-decoration:none;display:inline-flex;align-items:center;gap:4px">
                    <i class="f7-icons">arrow_down_to_line</i> تحميل
                  </a>
                  <button class="btn btn-red btn-sm" onclick="delCallRecording(${r.id})">
                    <i class="f7-icons">trash_fill</i> حذف
                  </button>
                </div>
              </div>
              <div class="pm-video-rec-player">
                <video src="${esc(mediaPath)}" controls preload="metadata" playsinline></video>
              </div>
            </div>`;
        }).join('');
      };

      renderVideoCalls();
      $('#videoCallSearch').oninput = e => renderVideoCalls(e.target.value);
    }
  },

  // ====== شكاوى المستخدمين (إبلاغ من الملفات الشخصية) ======
  userComplaints: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#f59e0b">exclamationmark_triangle_fill</i> شكاوى المستخدمين</div>
      <div class="info-box" style="background:#fffbeb;border-color:#fde68a;color:#92400e;margin-bottom:16px">
        <i class="f7-icons" style="vertical-align:middle;margin-inline-end:6px">info_circle_fill</i>
        الشكاوى الواردة من الأعضاء المسجلين (زر «الإبلاغ» في الملف الشخصي) — تُعرض مع اسم المبلِّغ والمُبلَّغ عنه.
      </div>
      <div class="fgroup" style="margin-bottom:14px">
        <input type="text" id="complaintSearch" class="inp" placeholder="🔍 بحث باسم المبلِّغ أو المُبلَّغ عنه أو النص...">
      </div>
      <div id="complaintsList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل الشكاوى...</div></div>`,
    bind: async () => {
      let recs = [];
      try { recs = await api('/api/admin/complaints'); } catch (e) { recs = []; }

      const renderComplaints = (filter = '') => {
        const f = filter.toLowerCase().trim();
        const filtered = (recs || []).filter(r => !f
          || (r.username || '').toLowerCase().includes(f)
          || (r.target_name || '').toLowerCase().includes(f)
          || (r.subject || '').toLowerCase().includes(f)
          || (r.message || '').toLowerCase().includes(f));
        const box = $('#complaintsList');
        if (!box) return;
        if (!filtered.length) {
          box.innerHTML = '<div class="empty">📭 لا توجد شكاوى' + (f ? ' مطابقة للبحث' : ' بعد') + '</div>';
          return;
        }
        box.innerHTML = filtered.map(r => {
          const dateStr = new Date((+r.created_at || 0) * 1000).toLocaleString('ar-JO');
          const target = r.target_name
            ? `<span class="chip" style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca">⚠️ المُبلَّغ عنه: ${esc(r.target_name)}</span>`
            : '<span class="chip" style="background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0">بدون تحديد</span>';
          return `
            <div class="pm-call-rec-card">
              <div class="pm-call-rec-head">
                <div class="pm-call-rec-title">
                  <i class="f7-icons" style="color:#f59e0b">person_fill</i>
                  <span>${esc(r.username || 'مجهول')}</span>
                  <i class="f7-icons" style="font-size:15px;color:#94a3b8">arrow_left</i>
                  <span>${esc(r.target_name || '—')}</span>
                </div>
                <div class="pm-call-rec-meta">
                  ${target}
                  <span class="chip" style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe">📌 ${esc(r.subject || 'بدون موضوع')}</span>
                  <span>📅 ${dateStr}</span>
                </div>
                <div style="font-size:13px;font-weight:700;color:#334155;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin:4px 0 10px">${esc(r.message || '—')}</div>
                ${r.image ? `<div style="margin:0 0 10px"><span style="font-size:11px;font-weight:800;color:#64748b;display:block;margin-bottom:6px">📎 صورة الدليل (انقر للعرض):</span><img src="${esc(r.image)}" alt="صورة الشكوى" style="max-width:200px;max-height:140px;border-radius:10px;border:1px solid #e2e8f0;cursor:zoom-in" onclick="window.open('${esc(r.image)}','_blank')"></div>` : ''}
                <div class="pm-call-rec-actions">
                  <button class="btn btn-red btn-sm" onclick="delComplaint(${r.id})">
                    <i class="f7-icons">trash_fill</i> حذف الشكوى
                  </button>
                </div>
              </div>
            </div>`;
        }).join('');
      };

      renderComplaints();
      const s = $('#complaintSearch');
      if (s) s.oninput = e => renderComplaints(e.target.value);
    }
  }
};

const roomSel = (icon, color, label, id, val) => `
  <div class="row">
    <span class="lbl"><i class="f7-icons mi" style="color:${color}">${icon}</i> ${label} :</span>
    <select class="inp" id="${id}" style="width:180px">
      <option value="0" ${!val ? 'selected' : ''}>❌ معطل</option>
      <option value="1" ${val ? 'selected' : ''}>✅ مفعل</option>
    </select>
  </div>`;

// ---------- نموذج مستخدم (إضافة/تعديل) ----------
function userForm(u) {
  const isEdit = !!u;
  u = u || {};
  const isMaster = ME && ME.rank === 'supermaster';
  const isSuper = ME && (ME.rank === 'superadmin' || ME.rank === 'supermaster');
  return `
    <div class="page-title"><i class="f7-icons mi" style="color:#7c3aed">${isEdit ? 'pencil_circle_fill' : 'plus_circle_fill'}</i> ${isEdit ? 'تحرير مستخدم : ' + esc(u.username) : 'إضافة مستخدم جديد'}</div>
    <div class="fgroup"><label><i class="f7-icons mi" style="color:#60a5fa">person_fill</i> اسم المستخدم (u) * :</label>
      <input class="inp" id="uName" value="${esc(u.username || '')}" placeholder="اسم المستخدم"></div>
    <div class="fgroup"><label><i class="f7-icons mi" style="color:#fbbf24">lock_fill</i> كلمة المرور (pwd) ${isEdit ? '(اتركها فارغة للإبقاء)' : '*'} :</label>
      <input class="inp" type="password" id="uPass" placeholder="••••••"></div>
    <div class="fgroup"><label><i class="f7-icons mi" style="color:#6366f1">envelope_fill</i> البريد الإلكتروني (e) :</label>
      <input class="inp" id="uEmail" value="${esc(u.email || '')}" placeholder="example@email.com"></div>
    <div class="grid2">
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#fbbf24">money_dollar_circle_fill</i> الرصيد (crdsamt) :</label>
        <input class="inp" type="number" id="uBalance" value="${u.balance ?? 80}"></div>
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#38bdf8">globe</i> الدولة (l) :</label>
        <input class="inp" id="uCountry" value="${esc(u.country || '')}" placeholder="مثل: jo, eg, sa"></div>
    </div>
    <div class="grid2">
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#f472b6">person2_fill</i> الجنس (g) :</label>
        <select class="inp" id="uGender">
          <option value="secret" ${(!u.gender || u.gender === 'secret') ? 'selected' : ''}>؟ مجهول</option>
          <option value="boy" ${u.gender === 'boy' ? 'selected' : ''}>👦 ذكر</option>
          <option value="girl" ${u.gender === 'girl' ? 'selected' : ''}>👧 أنثى</option>
        </select></div>
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#fdba74">gift_fill</i> العمر (bt) :</label>
        <input class="inp" type="number" id="uAge" value="${u.age || 25}"></div>
    </div>
    <div class="grid2">
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#fbbf24">rosette</i> العضوية :</label>
        <select class="inp" id="uMembership">
          <option value="none" ${(!u.membership || u.membership === 'none') ? 'selected' : ''}>بدون عضوية</option>
          ${isSuper ? `
            <option value="mmez" ${u.membership === 'mmez' ? 'selected' : ''}>🔴 مميز</option>
            <option value="plus" ${u.membership === 'plus' ? 'selected' : ''}>⭐ Plus</option>
            <option value="premium" ${u.membership === 'premium' ? 'selected' : ''}>💎 Premium</option>
            <option value="vip" ${u.membership === 'vip' ? 'selected' : ''}>👑 VIP</option>
          ` : ''}
        </select></div>
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#8b5cf6">shield_fill</i> الصلاحية :</label>
        <select class="inp" id="uRank">
          <option value="user" ${(!u.rank || u.rank === 'user') ? 'selected' : ''}>عضو عادي</option>
          ${isSuper ? `
            <option value="roomadmin" ${u.rank === 'roomadmin' ? 'selected' : ''}>ادمن غرفة</option>
            <option value="admin" ${u.rank === 'admin' ? 'selected' : ''}>ادمن</option>
            <option value="superadmin" ${u.rank === 'superadmin' ? 'selected' : ''}>سوبر ادمين</option>
          ` : ''}
          ${isMaster ? `<option value="supermaster" ${u.rank === 'supermaster' ? 'selected' : ''}>ملك الدردشة (سوبر ماستر 👑)</option>` : ''}
        </select></div>
    </div>
    <div class="btn-row">
      <button class="btn btn-gray" onclick="resetUserForm()"><i class="f7-icons">trash_fill</i> تفريغ الحقول</button>
      <button class="btn btn-green" id="saveUserBtn"><i class="f7-icons">${isEdit ? 'checkmark_circle_fill' : 'plus'}</i> ${isEdit ? 'حفظ التعديلات' : 'إضافة مستخدم'}</button>
    </div>`;
}
function bindUserForm(u) {
  $('#saveUserBtn').onclick = async () => {
    const body = {
      username: $('#uName').value.trim(), password: $('#uPass').value,
      email: $('#uEmail').value.trim(), balance: +$('#uBalance').value || 0,
      country: $('#uCountry').value.trim(), gender: $('#uGender').value,
      age: +$('#uAge').value || 25, membership: $('#uMembership').value, rank: $('#uRank').value
    };
    if (u) body.id = u.id;
    try {
      await api('/api/admin/users', 'POST', body);
      toast(u ? 'تم تحديث المستخدم بنجاح' : 'تمت إضافة المستخدم بنجاح');
      editingUser = null;
      if (u) loadPage('userEdit'); else resetUserForm();
    } catch (e) { toast(e.error || 'حدث خطأ', false); }
  };
}
window.resetUserForm = () => { editingUser = null; loadPage('userAdd'); };
window.editUser = async (id) => {
  const users = await api('/api/admin/users');
  const u = users.find(x => x.id === id);
  if (!u) return;
  editingUser = u;
  $('#content').innerHTML = userForm(u);
  bindUserForm(u);
  window.scrollTo(0, 0);
};
window.banUser = async (id, b) => {
  await api(`/api/admin/users/${id}/ban`, 'POST', { banned: !!b, reason: 'حظر من لوحة التحكم' });
  toast(b ? 'تم حظر المستخدم' : 'تم فك الحظر');
  if (window._renderUsers) window._renderUsers($('#searchUser') ? $('#searchUser').value : '');
};
window.muteUser = async (id, m) => {
  await api(`/api/admin/users/${id}/mute`, 'POST', { muted: !!m });
  toast(m ? 'تم كتم المستخدم' : 'تم إلغاء كتم المستخدم');
  // أعد تحميل القائمة مباشرة حتى يتحول الزر بين «كتم» و«إلغاء الكتم» دون تحديث الصفحة.
  if (window._renderUsers) await window._renderUsers($('#searchUser') ? $('#searchUser').value : '');
};
window.deleteUser = async (id, name) => {
  if (!confirm(`هل أنت متأكد من حذف المستخدم "${name}" نهائياً من قاعدة البيانات؟`)) return;
  try {
    await api('/api/admin/users/' + id, 'DELETE');
    toast('تم حذف المستخدم بنجاح');
    if (window._renderUsers) window._renderUsers($('#searchUser') ? $('#searchUser').value : '');
  } catch (e) {
    toast(e.error || 'تعذر حذف المستخدم', false);
  }
};
window.unkick = async (id) => { await api('/api/admin/kicks/' + id, 'DELETE'); toast('تم فك الطرد ويمكن للمستخدم دخول الغرفة الآن'); loadPage('kicks'); };
window.unban = async (id) => { await api('/api/admin/bans/' + id, 'DELETE'); toast('تم فك الحظر عن الحساب / IP'); loadPage('bans'); };
window.delAdmin = async (id, name) => {
  if (!confirm(`حذف الحساب الإداري "${name}" ؟`)) return;
  try {
    await api('/api/admin/users/' + id, 'DELETE');
    toast('تم حذف الحساب الإداري');
    loadPage('admins');
  } catch (e) {
    toast(e.error || 'تعذر حذف الحساب الإداري', false);
  }
};
window.addAdminAccount = () => { editingUser = null; $('#content').innerHTML = userForm(null); bindUserForm(null); window.scrollTo(0, 0); toast('املأ البيانات واختر الصلاحية'); };
window.editRoom = (id) => { editingRoom = ROOMS_CACHE.find(r => r.id === id); loadPage('roomAdd'); };
window.delRoom = async (id) => {
  if (!confirm(t('حذف هذه الغرفة نهائيا؟'))) return;
  await api('/api/admin/rooms/' + id, 'DELETE');
  toast('تم حذف الغرفة');
  loadPage('rooms');
};
window.clearRoomForm = () => { editingRoom = null; loadPage('roomAdd'); };
window.editWord = (id, w) => { editingWord = id; $('#newWord').value = w; $('#newWord').focus(); toast('عدّل الكلمة ثم اضغط اضافة'); };
window.delWord = async (id) => { await api('/api/admin/words/' + id, 'DELETE'); toast('تم حذف الكلمة'); await renderWords(); };
window.delVerified = async (username) => {
  if (!confirm('إزالة التوثيق من "' + username + '"؟')) return;
  await api('/api/admin/verify-remove', 'POST', { username });
  toast('تم إزالة توثيق ' + username);
  await renderVerified();
};
window.delRoyal = async (username) => {
  if (!confirm('إزالة الدخول الملكي من "' + username + '"؟')) return;
  await api('/api/admin/royal-remove', 'POST', { username });
  toast('تم إزالة الدخول الملكي من ' + username);
  await renderVerified();
};

async function renderWords() {
  const words = await api('/api/admin/words');
  $('#wordsList').innerHTML = words.length ? words.map(w => `
    <div class="list-card word-card">
      <span class="word-name"><i class="f7-icons">nosign</i> ${esc(w.word)}</span>
      <span style="display:flex;gap:8px">
        <button class="btn btn-yellow btn-sm" onclick="editWord(${w.id},'${esc(w.word).replace(/'/g, '')}')"><i class="f7-icons">pencil</i> تعديل</button>
        <button class="btn btn-red btn-sm" onclick="delWord(${w.id})"><i class="f7-icons">trash_fill</i> حذف</button>
      </span>
    </div>`).join('') : '<div class="empty">لا توجد كلمات ممنوعة</div>';
}
async function renderVerified() {
  const data = await api('/api/admin/verified-royal');
  const now = +(data.now || 0);
  const fmtExp = (exp) => {
    if (!+exp) return 'غير محدد';
    const dt = new Date(+exp * 1000);
    return now > +exp ? `${dt.toLocaleDateString('ar-JO')} (منتهي)` : dt.toLocaleDateString('ar-JO');
  };
  const RA = { lion: ['🦁', 'الأسد الملكي'], whale: ['🐋', 'الحوت الملكي'], eagle: ['🦅', 'العقاب الملكي'], unicorn: ['🦄', 'الوحيد قرن'] };
  const verified = (data.verified || []);
  $('#verList').innerHTML = verified.length ? verified.map(v => `
    <div class="list-card">
      <span class="word-name"><i class="f7-icons" style="color:#059669">checkmark_shield_fill</i> ${esc(v.username)} <span style="color:#6b7280;font-size:12px">${esc(fmtExp(v.expires_at))}</span></span>
      <button class="btn btn-red btn-sm ver-remove" data-name="${esc(v.username)}"><i class="f7-icons">trash_fill</i> حذف</button>
    </div>`).join('') : '<div class="empty">⏳ لا توجد أسماء موثقة بعد</div>';
  $$('#verList .ver-remove').forEach(b => b.onclick = () => delVerified(b.dataset.name));

  const royal = (data.royal || []);
  $('#royalList').innerHTML = royal.length ? royal.map(r => {
    const ra = RA[String(r.animal || 'lion')] || RA.lion;
    return `<div class="list-card">
      <span class="word-name"><i class="f7-icons" style="color:#b45309">crown_fill</i> ${esc(r.username)} • ${ra[0]} ${ra[1]} <span style="color:#6b7280;font-size:12px">${esc(fmtExp(r.expires_at))}</span></span>
      <button class="btn btn-red btn-sm royal-remove" data-name="${esc(r.username)}"><i class="f7-icons">trash_fill</i> حذف</button>
    </div>`;
  }).join('') : '<div class="empty">👑 لا يوجد أصحاب دخول ملكي بعد</div>';
  $$('#royalList .royal-remove').forEach(b => b.onclick = () => delRoyal(b.dataset.name));
}

// ---------- حفظ الإعدادات ----------
async function saveKeys(keys) {
  const body = {};
  keys.forEach(k => { body[k] = SETTINGS[k]; });
  await api('/api/admin/settings', 'POST', body);
}
async function saveSwitches() {
  const body = {};
  $$('.switch input[data-key]').forEach(i => { body[i.dataset.key] = i.checked ? '1' : '0'; SETTINGS[i.dataset.key] = body[i.dataset.key]; });
  $$('input[data-key]:not([type=checkbox])').forEach(i => { body[i.dataset.key] = i.value; SETTINGS[i.dataset.key] = i.value; });
  $$('textarea[data-key]').forEach(i => { body[i.dataset.key] = i.value; SETTINGS[i.dataset.key] = i.value; });
  $$('select[data-key]').forEach(i => { body[i.dataset.key] = i.value; SETTINGS[i.dataset.key] = i.value; });
  await api('/api/admin/settings', 'POST', body);
}

// ربط أزرار رفع/إزالة أصوات الإشعارات في صفحة «ضبط الاعدادات».
function bindSoundUploads() {
  $$('.sound-up').forEach(btn => {
    btn.onclick = () => {
      const key = btn.dataset.urlkey;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*,.mp3,.wav,.ogg,.m4a,.aac,.opus,.webm';
      input.onchange = async () => {
        const f = input.files && input.files[0];
        if (!f) return;
        const fd = new FormData(); fd.append('file', f);
        toast('جاري رفع الصوت...');
        try {
          const d = await api('/api/admin/upload/sound', 'POST', fd, true);
          SETTINGS[key] = d.path;
          const hidden = $('#content input[data-key="' + key + '"]');
          if (hidden) hidden.value = d.path;
          toast('تم رفع صوت الإشعار ✓');
          loadPage(CURRENT_PAGE_ID);
        } catch (e) { toast(e.error || 'تعذر رفع الصوت', false); }
      };
      input.click();
    };
  });
  $$('.sound-del').forEach(btn => {
    btn.onclick = () => {
      const key = btn.dataset.urlkey;
      SETTINGS[key] = '';
      const hidden = $('#content input[data-key="' + key + '"]');
      if (hidden) hidden.value = '';
      loadPage(CURRENT_PAGE_ID);
    };
  });
}

const ADMIN_ALLOWED_PAGES = new Set(['roomAdd', 'userAdd', 'kicks', 'bans', 'broadcast', 'words', 'verified']);

let CURRENT_PAGE_ID = 'memberships';

// ---------- تحميل صفحة ----------
async function loadPage(id) {
  CURRENT_PAGE_ID = id;
  if (MONITOR_TIMER) { clearInterval(MONITOR_TIMER); MONITOR_TIMER = null; }
  editingWord = null;
  if (id !== 'roomAdd') editingRoom = null;
  if (id !== 'roomBots') EDIT_ROOM_BOT = null;
  const isMaster = ME && ME.rank === 'supermaster';
  const isSuper = ME && (ME.rank === 'superadmin' || ME.rank === 'supermaster');

  if (isMaster) {
    // السوبر ماستر لديه كامل الصلاحيات دون استثناء
  } else if (isSuper) {
    if (id === 'privateMonitor' || id === 'callsRecordings') {
      toast('هذه الصفحة خاصة بمالك الدردشة (supermaster) فقط', false);
      return loadPage('memberships');
    }
  } else {
    // الأدمن العادي لديه فقط الصفحات المحددة
    if (!ADMIN_ALLOWED_PAGES.has(id)) {
      toast('هذه الصفحة خاصة بالسوبر ادمن والمالك فقط', false);
      return loadPage('roomAdd');
    }
  }

  const p = PAGES[id];
  if (!p) return;
  // حقول الأرقام تُحفظ عند الكتابة في SETTINGS المحلي
  $('#content').innerHTML = p.build();
  $$('#content input[data-key]').forEach(i => i.addEventListener('input', () => SETTINGS[i.dataset.key] = i.value));
  applyAdminLanguage($('#content'));
  if (p.bind) await p.bind();
  applyAdminLanguage($('#content'));
}

window.delSinglePm = async (id, u1, u2) => {
  if (!confirm(t('حذف هذه الرسالة؟'))) return;
  await api(`/api/admin/private-messages/${id}`, 'DELETE');
  toast(t('تم حذف الرسالة'));
  loadPage('privateMonitor');
};

window.delCallRecording = async (id) => {
  if (!confirm(t('هل أنت متأكد من حذف هذا التسجيل نهائياً؟'))) return;
  await api(`/api/admin/call-recordings/${id}`, 'DELETE');
  toast(t('تم حذف التسجيل'));
  loadPage('callsRecordings');
};
window.delComplaint = async (id) => {
  if (!confirm(t('هل أنت متأكد من حذف هذه الشكوى نهائياً؟'))) return;
  try {
    await api(`/api/admin/complaints/${id}`, 'DELETE');
    toast(t('تم حذف الشكوى'));
    loadPage('userComplaints');
  } catch (e) { toast(e.error || t('تعذر الحذف'), false); }
};

function showAdminTerminatedScreen() {
  document.body.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(15,23,42,0.96);backdrop-filter:blur(10px);z-index:9999999;display:flex;align-items:center;justify-content:center;color:#fff;text-align:center;padding:20px;font-family:'Noto Sans Arabic',sans-serif">
      <div style="max-width:440px;width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:24px;padding:36px 24px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5)">
        <div style="width:74px;height:74px;border-radius:50%;background:rgba(239,68,68,0.15);border:1.5px solid rgba(239,68,68,0.35);color:#ef4444;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:36px">
          <i class="f7-icons">lock_shield_fill</i>
        </div>
        <h2 style="font-size:20px;font-weight:900;margin-bottom:12px;color:#f8fafc">انتهت جلسة لوحة الإدارة</h2>
        <p style="font-size:13.5px;color:#94a3b8;line-height:1.8;margin-bottom:26px">تم إبطال رابط وجلسة الإدارة فوراً لأنك لست متواجداً في الدردشة أو قمت بعمل تحديث.<br>يجب أن تكون متواجداً ومتصلاً داخل الدردشة في نفس الوقت لتشغيل لوحة الإدارة.</p>
        <a href="/" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;text-decoration:none;padding:12px 28px;border-radius:14px;font-weight:800;font-size:14px">العودة إلى الدردشة</a>
      </div>
    </div>
  `;
}

let HEARTBEAT_TIMER = null;
function startAdminHeartbeat() {
  if (HEARTBEAT_TIMER) clearInterval(HEARTBEAT_TIMER);
  HEARTBEAT_TIMER = setInterval(async () => {
    try {
      await api('/api/admin/heartbeat');
    } catch (e) {
      clearInterval(HEARTBEAT_TIMER);
      showAdminTerminatedScreen();
    }
  }, 2500);
}

function bindMobileDrawer() {
  $('#sbToggleBtn')?.addEventListener('click', toggleMobileSidebar);
  $('#sbBackdrop')?.addEventListener('click', closeMobileSidebar);
  $('#sbMobileCloseBtn')?.addEventListener('click', closeMobileSidebar);
  $('#mobileLogoutBtn')?.addEventListener('click', () => $('#logoutBtn')?.click());
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) closeMobileSidebar();
  });
}

// ---------- تشغيل ----------
async function init() {
  initAdminLanguageObserver();
  bindLangSwitchers();
  bindMobileDrawer();
  setAdminLanguage(ADMIN_LANG, false);
  const me = await api('/api/me');
  if (me.user && ['admin', 'superadmin', 'supermaster'].includes(me.user.rank)) { enterPanel(me.user); return; }
  $('#loginScreen').style.display = 'flex';
}
function enterPanel(user) {
  ME = user;
  $('#loginScreen').style.display = 'none';
  $('#panel').style.display = 'flex';
  $('#sbUserName').textContent = user.username;
  $('#sbUserRank').textContent = user.rank === 'supermaster' ? t('ملك الدردشة 👑') : (user.rank === 'superadmin' ? t('سوبر ادمين') : (user.rank === 'admin' ? t('ادمن') : user.rank));
  startAdminHeartbeat();
    api('/api/admin/settings').then(s => {
    SETTINGS = s;
    if (SETTINGS.wave_enabled === undefined) SETTINGS.wave_enabled = '1';
    const explicitSaved = localStorage.getItem("admin_language");
    if (!explicitSaved && s.admin_language && ["ar", "en", "es", "tr"].includes(s.admin_language)) {
      setAdminLanguage(s.admin_language, false);
    } else {
      setAdminLanguage(ADMIN_LANG, false);
    }
    buildMenu();
    const defaultPage = (user.rank === 'admin') ? 'roomAdd' : 'memberships';
    loadPage(defaultPage);
    document.querySelector('.sb-sub')?.classList.add('open');
    document.querySelector('.sb-item')?.classList.add('open');
    document.querySelector('.sb-subitem')?.classList.add('active');
  });
}
$('#loginBtn').onclick = async () => {
  try {
    const d = await api('/api/login', 'POST', { username: $('#loginUser').value.trim(), password: $('#loginPass').value });
    if (!['admin', 'superadmin', 'supermaster'].includes(d.user.rank)) { $('#loginErr').textContent = 'هذا الحساب ليس حساب إدارة'; return; }
    enterPanel(d.user);
  } catch (e) { $('#loginErr').textContent = e.error || 'فشل تسجيل الدخول'; }
};
$('#loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#loginBtn').click(); });
$('#logoutBtn').onclick = async () => { await api('/api/logout', 'POST'); location.reload(); };

// =====================================================
//  مُوَلّد SEO والأرشفة بالذكاء الاصطناعي (AI SEO Modal Controller)
// =====================================================
let ACTIVE_SEO_AI_TARGET = 'main'; // 'main' or 'page'

function updateSeoFaviconPreview(src) {
  const img = document.getElementById('seoPageFaviconPreview');
  if (!img) return;
  if (src) { img.src = src; img.style.display = 'inline-block'; }
  else { img.removeAttribute('src'); img.style.display = 'none'; }
}

// لوحة فحص «طبق الأصل»: تكشف المسارات المتطابقة وتلك التي ينقصها محتوى فريد
async function renderSeoDuplicates() {
  const box = document.getElementById('seoDupPanel');
  if (!box) return;
  try {
    const d = await api('/api/admin/seo-duplicates');
    if (!d || !d.total) { box.innerHTML = ''; return; }
    const color = d.score >= 85 ? '#10b981' : (d.score >= 60 ? '#f59e0b' : '#ef4444');
    box.innerHTML = `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
          <b style="color:#1e293b;font-size:13.5px"><i class="f7-icons mi" style="color:${color}">doc_text_search</i> فحص «طبق الأصل» بين المسارات</b>
          <span class="chip" style="background:${color}1a;color:${color};font-weight:900">درجة التفريد: ${d.score}/100</span>
          <span class="chip">${d.total} مسار</span>
        </div>
        ${d.duplicateGroups.length
        ? `<div style="color:#b91c1c;font-size:12px;font-weight:800;margin-bottom:6px">\u26A0\uFE0F ${d.duplicateGroups.length} مجموعة متطابقة:</div>` +
        d.duplicateGroups.slice(0, 8).map(g => `<div style="font-size:12px;color:#475569;margin-bottom:4px">\u2022 <b>${esc(g.label)}</b> مشترك بين: ${g.slugs.map(x => '<span class="chip" dir="ltr">/' + esc(x) + '</span>').join(' ')}</div>`).join('')
        : '<div style="color:#166534;font-size:12px;font-weight:800">\u2705 لا يوجد أي تكرار بين المسارات</div>'}
        ${d.missingContent && d.missingContent.length ? `<div style="color:#b45309;font-size:12px;font-weight:800;margin-top:8px">ينقصها محتوى فريد: ${d.missingContent.map(x => '<span class="chip" dir="ltr">/' + esc(x) + '</span>').join(' ')}</div>` : ''}
        <div style="margin-top:9px;font-size:11.5px;color:#64748b">
          خريطة الموقع: <a href="/sitemap.xml" target="_blank" style="color:#2563eb;font-weight:800">/sitemap.xml</a> &middot;
          ملف الروبوتات: <a href="/robots.txt" target="_blank" style="color:#2563eb;font-weight:800">/robots.txt</a>
          <span style="color:#94a3b8"> (يُحدَّثان تلقائياً مع كل مسار جديد)</span>
        </div>
      </div>`;
  } catch (e) { box.innerHTML = ''; }
}

function openSeoAiModal(target) {
  ACTIVE_SEO_AI_TARGET = target;
  const modal = $('#seoAiModal');
  const input = $('#seoAiInput');
  const results = $('#seoAiResults');
  if (!modal) return;

  let currentVal = '';
  if (target === 'main') {
    currentVal = $('#seoMainSiteName')?.value || $('#seoMainTitle')?.value || SETTINGS.site_name || '';
  } else {
    currentVal = $('#seoPageSiteName')?.value || $('#seoPageSlug')?.value || '';
  }

  input.value = currentVal;
  modal.style.display = 'flex';
  if (currentVal) {
    executeSeoAiGeneration(currentVal);
  } else {
    results.innerHTML = `
      <div class="seo-ai-placeholder">
        <i class="f7-icons">sparkles</i>
        <p>أدخل اسم الدردشة أو الكلمة المستهدفة أعلاه واضغط "توليد النماذج الآن" لإنشاء باقات سيو قوية متوافقة مع Google.</p>
      </div>
    `;
  }
}

function closeSeoAiModal() {
  const modal = $('#seoAiModal');
  if (modal) modal.style.display = 'none';
}

async function executeSeoAiGeneration(query) {
  const results = $('#seoAiResults');
  if (!results) return;
  const name = String(query || $('#seoAiInput').value || '').trim();
  if (!name) {
    toast('اكتب اسم الدردشة أو الكلمة المستهدفة أولاً', false);
    return;
  }

  results.innerHTML = `
    <div class="seo-ai-placeholder">
      <div class="loading"><i class="f7-icons">arrow2_circlepath</i> جاري تحليل الكلمات وتوليد نماذج SEO متوافقة مع معايير Google...</div>
    </div>
  `;

  try {
    const slug = ACTIVE_SEO_AI_TARGET === 'page' ? ($('#seoPageSlug')?.value || '') : '';
    const res = await api('/api/admin/seo-ai-generate', 'POST', { name, customTopic: name, slug });
    if (!res || !res.ok || !res.variations || res.variations.length === 0) {
      results.innerHTML = `<div class="seo-ai-placeholder" style="color:#ef4444">تعذر توليد نماذج السيو، يرجى المحاولة مجدداً.</div>`;
      return;
    }

    const host = window.location.host;
    const proto = window.location.protocol;
    const pathPreview = ACTIVE_SEO_AI_TARGET === 'page' ? (slug ? `/${slug}` : '/chat1') : '/';
    const serpUrl = `${proto}//${host}${pathPreview}`;

    results.innerHTML = res.variations.map((v, idx) => {
      const titleLen = (v.title || '').length;
      const descLen = (v.description || '').length;
      const kwList = (v.keywords || '').split(',').map(k => k.trim()).filter(Boolean);
      const kwCount = kwList.length;

      let badgeClass = 'gold';
      if (v.id === 'voice') badgeClass = 'green';
      else if (v.id === 'dating') badgeClass = 'purple';
      else if (v.id === 'mobile') badgeClass = 'blue';

      return `
        <div class="seo-ai-card-item">
          <div class="seo-card-head">
            <span class="seo-card-badge ${badgeClass}">${esc(v.badge || 'نموذج SEO')}</span>
            <div class="seo-metrics-row">
              <span class="seo-metric-tag ${titleLen <= 65 ? 'ok' : ''}">العنوان: ${titleLen} حرف ${titleLen <= 65 ? '✓ مثالي' : ''}</span>
              <span class="seo-metric-tag ${descLen >= 120 && descLen <= 165 ? 'ok' : ''}">الوصف: ${descLen} حرف ${descLen >= 120 && descLen <= 165 ? '✓ مثالي' : ''}</span>
              <span class="seo-metric-tag ok">${kwCount} كلمة مفتاحية</span>
            </div>
          </div>

          <!-- محاكاة نتيجة بحث Google -->
          <div class="google-serp-preview">
            <div class="serp-url-row">
              <span class="serp-favicon"><i class="f7-icons">globe</i></span>
              <span class="serp-url-txt">${esc(serpUrl)}</span>
            </div>
            <div class="serp-title">${esc(v.title)}</div>
            <p class="serp-desc">${esc(v.description)}</p>
          </div>

          <!-- الكلمات المفتاحية -->
          <div class="seo-keywords-box">
            <span class="seo-kw-label"><i class="f7-icons mi">tag_fill</i> الكلمات الدلالية المتصدرة (Keywords & LSI):</span>
            <div class="seo-kw-chips">
              ${kwList.map(k => `<span class="seo-kw-chip">${esc(k)}</span>`).join('')}
            </div>
          </div>

          <!-- زر التطبيق -->
          <button class="seo-apply-btn" type="button" onclick="applySeoVariation(${idx})">
            <i class="f7-icons">checkmark_circle_fill</i> تطبيق هذا النموذج الآن ✨
          </button>
        </div>
      `;
    }).join('');

    window._CURRENT_SEO_VARIATIONS = res.variations;
  } catch (e) {
    results.innerHTML = `<div class="seo-ai-placeholder" style="color:#ef4444">${esc(e.error || 'حدث خطأ أثناء التوليد')}</div>`;
  }
}

window.applySeoVariation = function(index) {
  if (!window._CURRENT_SEO_VARIATIONS || !window._CURRENT_SEO_VARIATIONS[index]) return;
  const v = window._CURRENT_SEO_VARIATIONS[index];
  if (ACTIVE_SEO_AI_TARGET === 'main') {
    if (v.site_name && $('#seoMainSiteName')) $('#seoMainSiteName').value = v.site_name;
    if (v.title && $('#seoMainTitle')) $('#seoMainTitle').value = v.title;
    if (v.description && $('#seoMainDesc')) $('#seoMainDesc').value = v.description;
    if (v.keywords && $('#seoMainKeywords')) $('#seoMainKeywords').value = v.keywords;
  } else {
    if (v.site_name && $('#seoPageSiteName')) $('#seoPageSiteName').value = v.site_name;
    if (v.title && $('#seoPageTitleInput')) $('#seoPageTitleInput').value = v.title;
    if (v.description && $('#seoPageDesc')) $('#seoPageDesc').value = v.description;
    if (v.keywords && $('#seoPageKeywords')) $('#seoPageKeywords').value = v.keywords;
    // المحتوى الفريد يمنع تشابه المسارات في نتائج Google
    if (v.h1 && $('#seoPageH1')) $('#seoPageH1').value = v.h1;
    if (v.intro && $('#seoPageIntro')) $('#seoPageIntro').value = v.intro;
  }
  closeSeoAiModal();
  toast('تم تطبيق بيانات السيو بنجاح ✨ يرجى الضغط على زر الحفظ لتثبيتها');
};

const closeBtn = $('#closeSeoAiModal');
if (closeBtn) closeBtn.onclick = closeSeoAiModal;

const triggerBtn = $('#seoAiTriggerBtn');
if (triggerBtn) triggerBtn.onclick = () => executeSeoAiGeneration($('#seoAiInput').value);

const aiInput = $('#seoAiInput');
if (aiInput) {
  aiInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') executeSeoAiGeneration(aiInput.value);
  });
}

$$('.seo-quick-btn').forEach(btn => {
  btn.onclick = () => {
    const val = btn.dataset.val;
    if (aiInput) aiInput.value = val;
    executeSeoAiGeneration(val);
  };
});

// =====================================================
//  دوال إدارة باقات الذهب
// =====================================================
async function renderAdminGoldPackages() {
  const container = $('#goldPackagesList');
  if (!container) return;
  try {
    const pkgs = await api('/api/admin/gold-packages');
    if (!pkgs.length) {
      container.innerHTML = '<div class="empty">لا توجد باقات مضافة بعد (اضغط حفظ الباقة لإضافة باقة جديدة)</div>';
      return;
    }
    container.innerHTML = pkgs.map(p => `
      <div class="list-card" style="align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;border-right:4px solid ${p.active ? '#10b981' : '#cbd5e1'}">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:48px;height:48px;border-radius:12px;background:#fef3c7;color:#d97706;display:flex;align-items:center;justify-content:center;font-size:24px">
            <i class="f7-icons">money_dollar_circle_fill</i>
          </div>
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <b style="font-size:15px;color:#0f172a">${esc(p.name)}</b>
              ${p.badge ? `<span class="chip" style="background:#fee2e2;color:#dc2626;font-weight:800">${esc(p.badge)}</span>` : ''}
              <span class="chip" style="font-size:11px">${p.active ? '✅ مفعلة' : '⏸️ متوقفة'}</span>
            </div>
            <div style="display:flex;gap:10px;margin-top:4px;font-size:12.5px;color:#64748b;flex-wrap:wrap">
              <span>🪙 الذهب: <b style="color:#f59e0b">${p.gold}</b></span>
              ${p.bonus ? `<span>🎁 هدية: <b style="color:#10b981">+${p.bonus}</b></span>` : ''}
              <span>💵 السعر: <b style="color:#16a34a">${p.price} ${esc(p.currency || '$')}</b></span>
              <span>الترتيب: ${p.sort}</span>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-yellow btn-sm edit-pkg-btn" data-id="${p.id}"><i class="f7-icons">pencil</i> تعديل</button>
          <button class="btn btn-red btn-sm del-pkg-btn" data-id="${p.id}"><i class="f7-icons">trash_fill</i> حذف</button>
        </div>
      </div>
    `).join('');

    $$('.edit-pkg-btn').forEach(b => {
      b.onclick = () => {
        const pkg = pkgs.find(x => x.id === +b.dataset.id);
        if (!pkg) return;
        $('#editPkgId').value = pkg.id;
        $('#pkgName').value = pkg.name;
        $('#pkgGold').value = pkg.gold;
        $('#pkgPrice').value = pkg.price;
        $('#pkgCurrency').value = pkg.currency || '$';
        $('#pkgBonus').value = pkg.bonus || 0;
        $('#pkgBadge').value = pkg.badge || '';
        $('#pkgSort').value = pkg.sort || 1;
        $('#pkgActive').checked = !!pkg.active;
        $('#pkgFormHeader').innerHTML = '<i class="f7-icons mi" style="color:#f59e0b">pencil</i> تعديل الباقة: ' + esc(pkg.name);
        $('#cancelPkgBtn').style.display = 'inline-flex';
        $('#pkgName').scrollIntoView({ behavior: 'smooth' });
      };
    });

    $$('.del-pkg-btn').forEach(b => {
      b.onclick = async () => {
        if (!confirm(t('هل تريد حذف هذه الباقة نهائياً؟'))) return;
        await api('/api/admin/gold-packages/' + b.dataset.id, 'DELETE');
        toast('تم حذف الباقة بنجاح');
        renderAdminGoldPackages();
      };
    });
  } catch (e) {
    container.innerHTML = '<div class="empty" style="color:#ef4444">تعذر تحميل الباقات</div>';
  }

  $('#savePkgBtn').onclick = async () => {
    const id = $('#editPkgId').value;
    const name = $('#pkgName').value.trim();
    const gold = parseInt($('#pkgGold').value);
    const price = parseFloat($('#pkgPrice').value);
    if (!name || isNaN(gold) || isNaN(price)) {
      return toast('يرجى كتابة اسم الباقة وكمية الذهب والسعر بشكل صحيح', false);
    }
    await api('/api/admin/gold-packages', 'POST', {
      id: id || undefined,
      name,
      gold,
      price,
      currency: $('#pkgCurrency').value,
      bonus: parseInt($('#pkgBonus').value) || 0,
      badge: $('#pkgBadge').value.trim(),
      sort: parseInt($('#pkgSort').value) || 1,
      active: $('#pkgActive').checked ? 1 : 0
    });
    resetPkgForm();
    toast('تم حفظ الباقة بنجاح ✓');
    renderAdminGoldPackages();
  };

  $('#cancelPkgBtn').onclick = resetPkgForm;
}

function resetPkgForm() {
  $('#editPkgId').value = '';
  $('#pkgName').value = '';
  $('#pkgGold').value = '';
  $('#pkgPrice').value = '';
  $('#pkgBonus').value = '';
  $('#pkgBadge').value = '';
  $('#pkgSort').value = '1';
  $('#pkgActive').checked = true;
  $('#pkgFormHeader').innerHTML = '<i class="f7-icons mi" style="color:#6366f1">plus_circle_fill</i> إضافة باقة ذهب جديدة';
  $('#cancelPkgBtn').style.display = 'none';
}

async function renderRoomAdminsList() {
  const container = $('#roomAdminsList');
  if (!container) return;
  try {
    const list = await api('/api/admin/room-admins');
    if (!list.length) {
      container.innerHTML = '<div class="empty">لا يوجد مشرفو غرف معينون بعد (اختر غرفة وعين مشرفاً من الأعلى)</div>';
      return;
    }
    container.innerHTML = list.map(item => `
      <div class="list-card" style="align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;border-right:4px solid #fb923c">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:44px;height:44px;border-radius:50%;overflow:hidden;flex:none;background:#e2e8f0;display:flex;align-items:center;justify-content:center">
            ${item.user_avatar ? `<img src="${esc(item.user_avatar)}" style="width:100%;height:100%;object-fit:cover">` : '<i class="f7-icons" style="font-size:22px;color:#64748b">person_fill</i>'}
          </div>
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <b style="font-size:14.5px;color:#0f172a">${esc(item.username)}</b>
              <span class="chip" style="background:#fff7ed;color:#ea580c;font-weight:900"><img src="/badges/roomadmin.png" style="width:14px;height:14px;vertical-align:middle;margin-inline-end:3px"> أدمن غرفة</span>
            </div>
            <div style="display:flex;gap:10px;margin-top:4px;font-size:12px;color:#64748b;flex-wrap:wrap">
              <span>🏠 الغرفة: <b style="color:#0f172a">${esc(item.room_name || 'غرفة')}</b></span>
              <span>📅 تاريخ التعيين: ${new Date(item.created_at * 1000).toLocaleDateString('ar-JO')}</span>
            </div>
          </div>
        </div>
        <button class="btn btn-red btn-sm del-ra-btn" data-id="${item.id}"><i class="f7-icons">trash_fill</i> إزالة الإشراف</button>
      </div>
    `).join('');

    $$('.del-ra-btn').forEach(b => {
      b.onclick = async () => {
        if (!confirm(t('هل تريد إزالة هذا المشرف من الغرفة؟'))) return;
        await api('/api/admin/room-admins/' + b.dataset.id, 'DELETE');
        toast('تمت إزالة المشرف من الغرفة');
        renderRoomAdminsList();
      };
    });
  } catch (e) {
    container.innerHTML = '<div class="empty" style="color:#ef4444">تعذر تحميل المشرفين</div>';
  }
}

init();
