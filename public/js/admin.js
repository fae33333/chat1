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
  "الصور الافتراضية": "Default Images",
  "اختر صورة الروبوت من المكتبة أو من الصور التي رفعتها": "Pick the bot image from the library or your uploads",
  "الافتراضية": "Default",
  "الطبيعة": "Nature",
  "اخرى": "Other",
  "جاري تحميل الصور...": "Loading images...",
  "لا توجد صور مرفوعة بعد — استخدم زر «رفع صورة الروبوت» ثم عد إلى هنا": "No uploaded images yet — use the \"Upload Bot Avatar\" button then come back here",
  "تحديد الصورة": "Select Image",
  "اختر صورة من المعرض أولاً": "Pick an image from the gallery first",
  "تم تحديد الصورة ✅": "Image selected ✅",
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
  "مرفوعاتي": "My Uploads",
  "إصلاح تلقائي شامل (تفريد العناوين + الغرف المخفية)": "One-Click Auto-Fix (Deduplicate Titles + Hidden Rooms)",
  "يعيد توليد عناوين/أوصاف المسارات المتضاربة تلقائياً وينشئ غرفة SEO مخفية لكل مسار": "Regenerates duplicate titles/descriptions and creates a hidden SEO room per path",
  "جاري الفحص والإصلاح...": "Scanning and fixing...",
  "غرفة SEO مخفية (لمحركات البحث)": "Hidden SEO room (for search engines)"
,
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
  "عضوية مميز": "Membership premium",
  "عضوية VIP": "Membership VIP",
  "عضوية Premium": "Membership Premium",
  "عضوية Plus": "Membership Plus",
  "شارة الدخول المخفي": "Badge the login the hidden",
  "هدية": "Gift",
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
  "مباشر": "Live",
  "داخل الموقع": "Inside the site",
  "بلا اسم": "Without name",
  "من أين دخل": "From where entered",
  "كلمة البحث": "Word the search",
  "الرابط / المسار": "The link / the path",
  "الوقت": "The time",
  "الاعدادات: كل التفاصيل + الحظر": "The settings: all the details + the ban",
  "العمر": "The age",
  "ذكر": "Male",
  "أنثى": "Female",
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
  "النوع": "Gender",
  "دولة الحساب": "Country the account",
  "الرصيد (ذهب)": "The balance(gold)",
  "تاريخ إنشاء الحساب": "Date creating the account",
  "آخر دخول": "Last login",
  "إجمالي عمليات الدخول": "Total operations the login",
  "النبذة": "The bio",
  "فك الحظر عن الحساب": "Lift the ban about the account",
  "🚫 حظر المستخدم (الحساب + الجهاز)": "🚫 ban the user(the account + the device)",
  "لأنه عضو مسجل فالأفضل «حظر المستخدم» — أما الزائر غير المسجل فيُحظر عبر IP وأجهزته.": "Because member registered best«ban the user» — as for the visitor not the registered is banned via IP and his device.",
  "حظر من صفحة تتبع المستخدمين": "Ban from page tracking the users",
  "تم حظر المستخدم وفصله فوراً 🚫": "Was ban the user and disconnect him immediately 🚫",
  "تم فك الحظر عن المستخدم": "Was lift the ban about the user",
  "تعذر تنفيذ الحظر": "Failed to execute the ban",
  "وفصل جميع اتصالاتهم 🚫": "And disconnect all their connections 🚫",
  "غرفة محذوفة": "Deleted room",
  "🟢 متواجد داخل الغرفة": "🟢 in the room",
  "⚪ متوقف وغير ظاهر": "⚪ stopped and other visible",
  "إيقاف": "Stop",
  "تشغيل": "Run",
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
  "اكتب اسم المستخدم": "Type name the user",
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
  "جاري الاتصال...": "The connection...",
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
  "إلغاء الكتم": "Cancel the mute",
  "كتم": "Mute",
  "فك الحظر": "Lift the ban",
  "حظر": "Ban",
  "طلب توثيق الحساب": "Request verification the account",
  "👑 طلب دخول ملكي": "👑 request login royal",
  "👑 طلب تغيير الحيوان الملكي": "👑 request change royal animal",
  "الحيوان الملكي الجديد": "Royal animal the new",
  "الحيوان الملكي": "Royal animal",
  "الكمية المطلوبة": "The quantity the required",
  "التكلفة المقترحة": "The cost the suggested",
  "الذهب المطلوب شحنه للمستخدم:": "The gold the required recharge it user:",
  "الذهب المطلوب خصمه:": "The gold the required deducting it:",
  "موافقة وشحن الذهب": "Approval and recharge the gold",
  "موافقة وتنفيذ": "Approval and execute",
  "بدون سبب": "Without reason",
  "تمت الموافقة وشحن الذهب للمستخدم": "Was the approval and recharge the gold user",
  "تمت الموافقة وتنفيذ الطلب وخصم الذهب": "Was the approval and execute the request and deduct the gold",
  "تعذرت الموافقة": "Failed to the approval",
  "اكتب سبب الرفض الذي سيصل للمستخدم:": "Type reason the reject the the will arrive user:",
  "تم رفض الطلب من الإدارة": "Was reject the request from the administration",
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
  "افتراضي": "Default",
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
  "العربية": "Arabic",
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
  "رفض": "Reject",
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
  "رسالة": "Message",
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
  "إنشاء حساب": "Create account",
  "الخروج": "Log out",
  "لا يوجد احد في البث المباشر حي الان": "No one is live streaming right now",
  "مغادرة الغرفة": "Leave room",
  "تحديث الغرف": "Refresh rooms",
  "حذف العام لدي فقط": "Delete the public I have only",
  "حذف العام للجميع": "Delete the public all",
  "الدردشة العربية": "The Arabic Chat",
  "متصل الان": "Online now",
  "تحدث": "Talk",
  "الغرف": "Rooms",
  "الخاص": "Private",
  "الإشعارات": "Notifications",
  "الحائط": "Wall",
  "القائمة": "Menu",
  "الحالات": "Statuses",
  "حالتي": "My status",
  "اضغط لإضافة تحديث الحالة": "Tap to add a status update",
  "الحالات الحديثة": "Recent statuses",
  "جاري تحميل الحالات...": "Loading the statuses...",
  "إضافة حالة": "Add status",
  "صورة": "Photo",
  "فيديو": "Video",
  "ملف صوتي": "Voice clip",
  "كتابة": "Text",
  "تختفي الحالة تلقائياً بعد 24 ساعة": "Status disappears automatically after 24 hours",
  "حالة كتابية": "Text status",
  "نشر": "Publish",
  "حالة صوتية": "Voice status",
  "المشاهدات": "Views",
  "حذف الحالة": "Delete the status",
  "شاهد حالتي": "View my status",
  "مشاهدة": "View",
  "بدء بث فيديو": "Start video stream",
  "بدء البث": "Start streaming",
  "مشاهدة البث": "Watch stream",
  "0 مشاهد": "0 viewers",
  "بانتظار موافقة أحد المذيعين على مشاهدة البث…": "Awaiting approval one the broadcasters on view the broadcast…",
  "إنهاء البث": "End stream",
  "مغادرة المشاهدة": "Leave viewing",
  "لغة الواجهة": "Interface language",
  "ع": "ع",
  "عرض الواجهة باللغة العربية": "Show interface in Arabic",
  "تسجيل الدخول": "Log in",
  "دخول كزائر/ة": "Enter as guest",
  "نسيت كلمة السر؟": "Forgot password?",
  "استعادة كلمة السر": "Recover password",
  "لا يوجد لديك عضوية؟": "No membership yet?",
  "إنشاء حساب مجانًا": "Create free account",
  "مجهول": "Secret",
  "الرجاء قراءة": "Please read",
  "شروط الاستخدام": "Terms of Use",
  "وقراءة": "and read",
  "سياسة الخصوصية": "Privacy Policy",
  "يُستخدم للتفعيل والمتابعة — يجب أن يكون Gmail (ينتهي بـ @gmail.com)": "Used for activation and follow-up — must be Gmail (ending in @gmail.com)",
  "تسجيل العضوية": "Register membership",
  "تفعيل الحساب": "Activate account",
  "أرسلنا رمز تفعيل مكونًا من 6 أرقام إلى جيميلك:": "We sent code activation composed of from 6 digits to your Gmail:",
  "إعادة إرسال الرمز": "Resend code",
  "تغيير البريد": "Change email",
  "يتطلب الدخول باستخدام عضويتك أو تسجيل عضوية": "Requires the login using your membership or registration membership",
  "التسجيل الان": "The registration the now",
  "لاحقا": "Later",
  "عرض الحالة": "Display the status",
  "الرد على الرسالة": "Reply to message",
  "دردشة خاصة": "Private chat",
  "ارسل هدية": "Send gift",
  "ترقية هذا المستخدم": "Upgrade this the user",
  "تجاهل": "Ignore",
  "سحب المايك": "Withdraw the mic",
  "سحب مع منع صعود": "Withdraw with prevent joining",
  "فك من البث": "Lift from the broadcast",
  "كتم المستخدم": "Mute the user",
  "طرد المستخدم": "Kick the user",
  "حظر المستخدم": "Ban the user",
  "كشف نكات": "Reveal nicknames",
  "المعلومات الشخصية": "The information the personal",
  "عودة": "Return",
  "كشف النكات": "Reveal the nicknames",
  "صورة المستخدم": "Photo the user",
  "متجر الهدايا الافتراضية": "Store the gifts the default",
  "فاخرة": "Luxurious",
  "مجوهرات": "Jewels",
  "هدية لـ :": "Gift to:",
  "كمية :": "Quantity:",
  "تحتاج لتنفق :": "Need to spend:",
  "جائزة هذه الهدية :": "Prize this the gift:",
  "يحصل مستلم هذه الهدية على هذا الرصيد": "Gets recipient this the gift on this the balance",
  "رصيدك الحالي :": "Your balance the current:",
  "اختر هدية": "Choose gift",
  "الغاء": "Cancel",
  "أرسل": "Send",
  "الترقية": "The upgrade",
  "قم بترقية عضوية الحساب لتبرز من بين الحشود !": "Do upgrading membership the account to stand out from between the crowds!",
  "الترقية الى :": "The upgrade to:",
  "المدة بالأشهر :": "The duration months:",
  "التكلفة الإجمالية :": "The cost the total:",
  "ترقية الحساب الآن": "Upgrade the account the now",
  "حسابي": "My account",
  "الهدايا": "The gifts",
  "المحادثات الخاصة": "The chats the private",
  "الاعضاء المسجلين": "The members the registered",
  "غير مرغوب فيه": "Not desired in it",
  "مكالمة صوتية خاصة واردة...": "Call voice private incoming...",
  "رد": "Reply",
  "سبيكر": "Speaker",
  "إنهاء": "End",
  "أغلق الكاميرا": "Close the camera",
  "الجودة: -": "The quality: -",
  "الكاميرا": "The camera",
  "المكالمة بالسماعة جارية • انقر لإضاءة الشاشة": "The call earpiece ongoing• click to light up the screen",
  "بدء مكالمة صوتية": "Start call voice",
  "مكالمة تجريبية مجانية 🎁": "Call trial free 🎁",
  "المتصل به": "The connected in it",
  "متابعة": "Continue",
  "إشعار من النظام": "Notification from the system",
  "حسناً": "OK",
  "الهدية من:": "The gift from:",
  "أرسلت إلى:": "I sent to:",
  "العدد والكمية:": "The number of quantity:",
  "التاريخ والوقت:": "The date time:",
  "إيموجي": "Emoji",
  "قائمة الألوان": "List the colors",
  "القائمة الرئيسية": "The list the main",
  "متصل": "Connected",
  "رصيدك الحالي": "Your balance the current",
  "شراء رصيد": "Purchase balance",
  "توثيق حسابي": "Verification my account",
  "الدخول الملكي 👑": "Royal entrance 👑",
  "ترقية حسابي": "Upgrade my account",
  "تغيير الصورة": "Change the photo",
  "هدايا حسابي": "Gifts my account",
  "قوائم الحظر": "Lists the ban",
  "الاعدادات": "The settings",
  "الهدايا المستلمة": "The gifts the received",
  "جميع الهدايا التي أرسلها الأعضاء إلى حسابك": "All the gifts which send it the members to your account",
  "قائمة التجاهل": "List the ignore",
  "لا يمكن تبادل الرسائل الخاصة بينك وبين الأشخاص المتجاهلين.": "Cannot exchange private messages between you and between the people the ignored.",
  "تغيير الحالة": "Change the status",
  "مشغول": "Busy",
  "بالخارج": "Outside",
  "حساب": "Account",
  "أضف إطلالة": "Add look",
  "اختر صورة": "Choose photo",
  "او": "Or",
  "رفع صورة": "Upload photo",
  "عام": "Public",
  "تفعيل الصوت": "Activation the voice",
  "صوت الرسائل الجديدة": "Voice the messages the new",
  "صوت دخول المستخدمين": "Voice login the users",
  "اظهار الوقت في الرسائل": "Show the time in the messages",
  "استقبال الرسائل الخاصة": "Receiving private messages",
  "إشعارات سطح المكتب": "Notifications desktop the desk",
  "تغيير اللغة": "Change the language",
  "الحساب": "The account",
  "تغيير كلمة المرور": "Change password",
  "لحسابك المسجل — أدخل كلمة المرور الحالية ثم الجديدة": "To your account the registered — enter password the current then the new",
  "إشعارات": "Notifications",
  "منشور جديد": "Post new",
  "يوتيوب": "YouTube",
  "جاري تحميل المنشورات...": "Loading the posts...",
  "عرض الوسائط": "Display the media",
  "جارٍ تجهيز الوسائط...": "Loading preparing the media...",
  "تعذر تشغيل الفيديو داخل المتصفح": "Failed to run the video inside the browser",
  "قد يكون ترميز الملف غير مدعوم. يمكنك فتح الملف الأصلي من الزر بالأسفل.": "May be encoding the file not supported. you can open the file the original from the button bottom.",
  "انقر تشغيل لبدء المشاهدة": "Click run to start the view",
  "فتح الملف الأصلي": "Open the file the original",
  "التفاعلات": "The interactions",
  "احصل على توثيق شاتنا": "Get on verification our chat",
  "احصل على شارة تحقق خاصة تظهر بجوار اسمك أينما ظهر": "Get on badge check private appear next to your name wherever appeared",
  "حماية حسابك": "Protection your account",
  "الثقة والتميز": "The trust distinction",
  "اجعل مجتمع شاتنا يثق بك وكن دائمًا مميز في المقدمة": "Make community our chat trusts you and be always premium in the intro",
  "الموافقة والرسوم": "The approval fees",
  "10 ذهب": "10 gold",
  "طلب التحقق من حسابي": "Request the check from my account",
  "شارة التاج الملكي": "Badge the crown the royal",
  "توهج ملكي عند دخول الغرف": "Glow royal at login the rooms",
  "عند دخولك أي غرفة يظهر توهج ملكي ذهبي احترافي مع التاج وإشعار الترحيب الملكي للجميع": "At your entry any room appears glow royal golden professional with the crown and notify the welcome the royal all",
  "تميز دائم": "Distinction permanent",
  "شارة ملكية لا تُزال — تميّزك في المقدمة دائماً": "Badge ownership no are removed — your distinction in the intro always",
  "اختر حيوانك الملكي": "Choose your animal the royal",
  "التكلفة": "The cost",
  "طلب الدخول الملكي": "Request royal entrance",
  "لديك الدخول الملكي": "You have royal entrance",
  "تغيير الحيوان الملكي": "Change royal animal",
  "اشترِ الذهب الافتراضي لترقية حسابك أو حساب أصدقائك وإرسال الهدايا": "Buy the gold the default to upgrade your account or account your friends and send the gifts",
  "باقات شحن الذهب المميزة": "Packages recharge the gold the special",
  "اختر الباقة المناسبة وادفع عبر PayPal أو بطاقة فيزا/ماستركارد/أمريكان إكسبريس لشحن رصيدك فورياً بعد تأكيد الدفع": "Choose the package the suitable and pay via PayPal or card Visa/Mastercard/American Express to recharge your balance instantly after confirm the payment",
  "متابعة شراء": "Continue purchase",
  "إعلان عام": "Announcement public",
  "بواسطة:": "By:",
  "الإدارة": "The administration",
  "طريقة دخول الغرفة": "Method login the room",
  "اختر طريقة دخولك إلى غرفة": "Choose method your entry to room",
  "دخول ظاهر": "Login visible",
  "دخول مخفي": "Login hidden",
  "كلا": "Both",
  "نعم": "Yes",
  "دخول الى الغرفة المختارة": "Login to the room the selected",
  "لا": "No",
  "بث مباشر": "Live stream",
  "بث مباشر نشط": "Live stream active",
  "لا يمكنك مغادرة الغرفة وأنت تقوم بالبث المباشر.": "Cannotas leave the room while you are doing withlive stream.",
  "البقاء في الغرفة": "The staying in the room",
  "إيقاف البث والخروج": "Stop the broadcast exit",
  "غرفة محمية": "Room protected",
  "غرفة «": "Room«",
  "» محمية بكلمة مرور.": "» protected with word passing.",
  "اكتب كلمة المرور للدخول:": "Type password login:",
  "❌ كلمة المرور غير صحيحة — حاول مرة أخرى": "❌ password not correct — try time other",
  "قسم الشكاوي": "Section the complaints",
  "إرفاق صورة (دليل) — اختياري": "Attach photo(guide) — optional",
  "إرسال الشكوى": "Send the complaint",
  "استعادة كلمة المرور": "Recovery password",
  "أدخل بريدك المسجل وسنرسل لك رمز استعادة من 6 أرقام": "Enter your email the registered and we will send for you code recovery from 6 digits",
  "إرسال الرمز": "Send the code",
  "جاري رفع الملف...": "Upload the file...",
  "فحص الملف قبل الإرسال": "Check the file before the send",
  "جارٍ فحص الملف...": "Loading check the file...",
  "إرسال إلى العام": "Send to the public",
  "تسجيل مقطع صوتي": "Registration clip audio",
  "جارٍ التسجيل...": "Loading the registration...",
  "إيقاف ومعاينة": "Stop and preview",
  "معاينة المقطع قبل الإرسال": "Preview the clip before the send",
  "استمع إلى المقطع ثم أرسله أو احذفه": "Listen to the clip then send it or delete it",
  "الرسالة طويلة": "The message long",
  "يجب أن تكون الرسالة": "Must that be the message",
  "حرف أو أقل": "Character or less",
  "عدد الأحرف المكتوبة": "Number of the characters the written",
  "العودة لتعديل الرسالة": "The return to edit the message",
  "لا تتحدث بسرعة": "No are talking quickly",
  "خذ استراحة قصيرة قبل إرسال الرسالة التالية": "Take break short before send the message the next",
  "تم إيقاف الوصول": "Was stop the access",
  "تم حظرك بسبب سلوكك السيئ": "Was your ban because of your behavior the bad",
  "لن تتمكن من دخول الدردشة من هذا الحساب أو الجهاز حتى تقوم الإدارة بفك الحظر.": "Will not be able from login the chat from this the account or the device until are doing the administration to lift the ban.",
  "سبب الحظر": "Reason the ban",
  "سلوك سيئ داخل الدردشة": "Behavior bad inside the chat",
  "الحظر مرتبط بالحساب والجهاز ويستمر عند تغيير عنوان IP": "The ban linked account device and continues at change title IP",
  "إعادة التحقق بعد فك الحظر": "Re- the check after lift the ban",
  "جلسة جديدة": "Session new",
  "تم الدخول بحسابك من جهاز آخر": "Was the login with your account from device last",
  "العودة لتسجيل الدخول": "The return to register the login",
  "تم قطع الاتصال": "Was cut the connection",
  "جارٍ إعادة الاتصال...": "Loading re- the connection...",
  "اتصال": "Connection",
  "جارٍ التحميل...": "Loading the loading...",
  "ارسل لك رسالة خاصة": "Send for you private message",
  "انتقل إلى قائمة الرسائل الخاصة لقراءتها": "Go to list private messages to read it",
  "إنهاء المكالمة": "End the call",
  "ابحث عن غرفك": "Search about your rooms",
  "تشغيل الراديو": "Run the radio",
  "كتم/إلغاء كتم صوت المذيعين": "Mute/cancel mute voice the broadcasters",
  "حذف «العام» من شاشة أنت فقط — يظل ظاهراً لبقية المستخدمين": "Delete«the public» from screen you only — remains visible for rest the users",
  "حذف «العام» نهائياً من الغرفة لجميع المستخدمين": "Delete«the public» permanently from the room for all the users",
  "النزول لآخر الرسائل": "The scrolling to the last the messages",
  "بحث عن غرف": "Search about rooms",
  "بحث عن مستخدمين": "Search about users",
  "عرض/إخفاء قائمة المتصلين": "Display/hide list the online users",
  "تغيير الصورة الشخصية": "Change the photo the personal",
  "رسالة عامة": "Message public",
  "تحدث — الصعود كمذيع": "Talk — the joining as broadcaster",
  "اكتب حالتك...": "Type your status...",
  "اسحب لتحريك نافذة البث": "Drag to move window the broadcast",
  "كتم/إلغاء كتم صوتي كمذيع": "Mute/cancel mute audio as broadcaster",
  "الأسم المستعار": "The name the alias",
  "الرقم السري": "The number the secret",
  "اسم المستعار": "Name the alias",
  "البريد الإلكتروني (Gmail)": "The email address(Gmail)",
  "الحالة / نبذة شخصية (اختياري)": "The status / bio personal(optional)",
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
  "اكتب منشورك هنا...": "Type your post here...",
  "ابحث عن فيديو في YouTube": "Search about video in YouTube",
  "موضوع الشكوى": "Subject the complaint",
  "اكتب شكواك هنا...": "Type your complaint here...",
  "إزالة الصورة": "Removal the photo",
  "كلمة المرور الجديدة": "The new password",
  "🇸🇦 العربية": "🇸🇦 the Arabic",
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
  "اكتب حالتك أو نبذة تعبر عنك...": "Type your status or bio cross about...",
  "حذف المنشور": "Delete the post",
  "عرض من تفاعلوا مع المنشور": "Display from interact with the post",
  "اكتب تعليقاً...": "Type a comment...",
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
  "تحديث الحائط": "Refresh wall",
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
  "طلب تغيير الحيوان الملكي": "Royal animal change request",
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
  "الصور الافتراضية": "Imágenes Predeterminadas",
  "اختر صورة الروبوت من المكتبة أو من الصور التي رفعتها": "Elige la imagen del bot de la biblioteca o de tus subidas",
  "الافتراضية": "Predeterminadas",
  "الطبيعة": "Naturaleza",
  "اخرى": "Otros",
  "جاري تحميل الصور...": "Cargando imágenes...",
  "لا توجد صور مرفوعة بعد — استخدم زر «رفع صورة الروبوت» ثم عد إلى هنا": "Aún no hay imágenes subidas — usa el botón «Subir Avatar del Bot» y vuelve aquí",
  "تحديد الصورة": "Seleccionar Imagen",
  "اختر صورة من المعرض أولاً": "Elige primero una imagen de la galería",
  "تم تحديد الصورة ✅": "Imagen seleccionada ✅",
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
  "مرفوعاتي": "Mis Subidas",
  "إصلاح تلقائي شامل (تفريد العناوين + الغرف المخفية)": "Arreglo Automático Total (Títulos Únicos + Salas Ocultas)",
  "يعيد توليد عناوين/أوصاف المسارات المتضاربة تلقائياً وينشئ غرفة SEO مخفية لكل مسار": "Regenera automáticamente títulos/descripciones duplicados y crea una sala SEO oculta por ruta",
  "جاري الفحص والإصلاح...": "Escaneando y reparando...",
  "غرفة SEO مخفية (لمحركات البحث)": "Sala SEO oculta (para motores de búsqueda)"
,
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
  "هدية": "Regalo",
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
  "مباشر": "En vivo",
  "داخل الموقع": "Dentro de el sitio",
  "بلا اسم": "Sin nombre",
  "من أين دخل": "De dónde entró",
  "كلمة البحث": "Palabra el búsqueda",
  "الرابط / المسار": "El enlace / el ruta",
  "الوقت": "El hora",
  "الاعدادات: كل التفاصيل + الحظر": "El ajustes: todo el detalles + el bloqueo",
  "العمر": "El edad",
  "ذكر": "Hombre",
  "أنثى": "Mujer",
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
  "النوع": "Género",
  "دولة الحساب": "País el cuenta",
  "الرصيد (ذهب)": "El saldo(oro)",
  "تاريخ إنشاء الحساب": "Fecha crear el cuenta",
  "آخر دخول": "Último inicio de sesión",
  "إجمالي عمليات الدخول": "Total operaciones el inicio de sesión",
  "النبذة": "El biografía",
  "فك الحظر عن الحساب": "Levantar el bloqueo sobre el cuenta",
  "🚫 حظر المستخدم (الحساب + الجهاز)": "🚫 bloqueo el usuario(el cuenta + el dispositivo)",
  "لأنه عضو مسجل فالأفضل «حظر المستخدم» — أما الزائر غير المسجل فيُحظر عبر IP وأجهزته.": "Porque miembro registrado mejor«bloqueo el usuario» — en cuanto el visitante no el registrado se bloquea vía IP y su dispositivo.",
  "حظر من صفحة تتبع المستخدمين": "Bloqueo de página seguimiento el usuarios",
  "تم حظر المستخدم وفصله فوراً 🚫": "Se bloqueo el usuario y desconectarlo inmediatamente 🚫",
  "تم فك الحظر عن المستخدم": "Se levantar el bloqueo sobre el usuario",
  "تعذر تنفيذ الحظر": "No se pudo ejecutar el bloqueo",
  "وفصل جميع اتصالاتهم 🚫": "Y desconectar todos sus conexiones 🚫",
  "غرفة محذوفة": "Sala eliminada",
  "🟢 متواجد داخل الغرفة": "🟢 en la sala",
  "⚪ متوقف وغير ظاهر": "⚪ detenido y otros visible",
  "إيقاف": "Detener",
  "تشغيل": "Ejecutar",
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
  "اكتب اسم المستخدم": "Escribe nombre el usuario",
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
  "جاري الاتصال...": "El conexión...",
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
  "إلغاء الكتم": "Cancelar el silenciar",
  "كتم": "Silenciar",
  "فك الحظر": "Levantar el bloqueo",
  "حظر": "Bloqueo",
  "طلب توثيق الحساب": "Solicitud verificación el cuenta",
  "👑 طلب دخول ملكي": "👑 solicitud inicio de sesión real",
  "👑 طلب تغيير الحيوان الملكي": "👑 solicitud cambio animal real",
  "الحيوان الملكي الجديد": "Animal real el nuevo",
  "الحيوان الملكي": "Animal real",
  "الكمية المطلوبة": "La cantidad el requeridas",
  "التكلفة المقترحة": "El costo el sugerida",
  "الذهب المطلوب شحنه للمستخدم:": "El oro el requerido recargarlo usuario:",
  "الذهب المطلوب خصمه:": "El oro el requerido descontarlo:",
  "موافقة وشحن الذهب": "Aprobación y recargar el oro",
  "موافقة وتنفيذ": "Aprobación y ejecutar",
  "بدون سبب": "Sin razón",
  "تمت الموافقة وشحن الذهب للمستخدم": "Se el aprobación y recargar el oro usuario",
  "تمت الموافقة وتنفيذ الطلب وخصم الذهب": "Se el aprobación y ejecutar el solicitud y descontar el oro",
  "تعذرت الموافقة": "No se pudo el aprobación",
  "اكتب سبب الرفض الذي سيصل للمستخدم:": "Escribe razón el rechazar el el llegará usuario:",
  "تم رفض الطلب من الإدارة": "Se rechazar el solicitud de el administración",
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
  "افتراضي": "Predeterminado",
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
  "العربية": "Árabe",
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
  "رفض": "Rechazar",
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
  "رسالة": "Mensaje",
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
  "إنشاء حساب": "Crear cuenta",
  "الخروج": "Salir",
  "لا يوجد احد في البث المباشر حي الان": "Nadie está en vivo ahora",
  "مغادرة الغرفة": "Salir de la sala",
  "تحديث الغرف": "Actualizar salas",
  "حذف العام لدي فقط": "Eliminar el público tengo solo",
  "حذف العام للجميع": "Eliminar el público todos",
  "الدردشة العربية": "El Chat Árabe",
  "متصل الان": "En línea ahora",
  "تحدث": "Habla",
  "الغرف": "Salas",
  "الخاص": "Privado",
  "الإشعارات": "Notificaciones",
  "الحائط": "Muro",
  "القائمة": "Menú",
  "الحالات": "Estados",
  "حالتي": "Mi estado",
  "اضغط لإضافة تحديث الحالة": "Toca para añadir un estado",
  "الحالات الحديثة": "Estados recientes",
  "جاري تحميل الحالات...": "Carga el estados...",
  "إضافة حالة": "Añadir estado",
  "صورة": "Foto",
  "فيديو": "Vídeo",
  "ملف صوتي": "Audio",
  "كتابة": "Texto",
  "تختفي الحالة تلقائياً بعد 24 ساعة": "El estado desaparece tras 24 horas",
  "حالة كتابية": "Estado de texto",
  "نشر": "Publicar",
  "حالة صوتية": "Estado de voz",
  "المشاهدات": "Vistas",
  "حذف الحالة": "Eliminar el estado",
  "شاهد حالتي": "Ver mi estado",
  "مشاهدة": "Ver",
  "بدء بث فيديو": "Iniciar transmisión",
  "بدء البث": "Empezar a transmitir",
  "مشاهدة البث": "Ver transmisión",
  "0 مشاهد": "0 espectadores",
  "بانتظار موافقة أحد المذيعين على مشاهدة البث…": "Esperando aprobación uno el locutores en ver el transmisión…",
  "إنهاء البث": "Terminar transmisión",
  "مغادرة المشاهدة": "Dejar de ver",
  "لغة الواجهة": "Idioma de la interfaz",
  "ع": "ع",
  "عرض الواجهة باللغة العربية": "Mostrar la interfaz en árabe",
  "تسجيل الدخول": "Iniciar sesión",
  "دخول كزائر/ة": "Entrar como invitado",
  "نسيت كلمة السر؟": "¿Olvidaste la contraseña?",
  "استعادة كلمة السر": "Recuperar contraseña",
  "لا يوجد لديك عضوية؟": "¿Aún no tienes membresía?",
  "إنشاء حساب مجانًا": "Crear cuenta gratis",
  "مجهول": "Secreto",
  "الرجاء قراءة": "Lee por favor",
  "شروط الاستخدام": "Términos de Uso",
  "وقراءة": "y lee",
  "سياسة الخصوصية": "Política de Privacidad",
  "يُستخدم للتفعيل والمتابعة — يجب أن يكون Gmail (ينتهي بـ @gmail.com)": "Se usa para activación y seguimiento — debe ser Gmail (termina en @gmail.com)",
  "تسجيل العضوية": "Registrar membresía",
  "تفعيل الحساب": "Activar cuenta",
  "أرسلنا رمز تفعيل مكونًا من 6 أرقام إلى جيميلك:": "Enviamos código activación compuesto de de 6 dígitos a tu Gmail:",
  "إعادة إرسال الرمز": "Reenviar código",
  "تغيير البريد": "Cambiar correo",
  "يتطلب الدخول باستخدام عضويتك أو تسجيل عضوية": "Requiere el inicio de sesión usando tu membresía o registro membresía",
  "التسجيل الان": "El registro el ahora",
  "لاحقا": "Más tarde",
  "عرض الحالة": "Mostrar el estado",
  "الرد على الرسالة": "Responder al mensaje",
  "دردشة خاصة": "Chat privado",
  "ارسل هدية": "Enviar regalo",
  "ترقية هذا المستخدم": "Mejora este el usuario",
  "تجاهل": "Ignorar",
  "سحب المايك": "Retirar el micrófono",
  "سحب مع منع صعود": "Retirar con prevenir subir",
  "فك من البث": "Levantar de el transmisión",
  "كتم المستخدم": "Silenciar el usuario",
  "طرد المستخدم": "Expulsar el usuario",
  "حظر المستخدم": "Bloqueo el usuario",
  "كشف نكات": "Revelar apodos",
  "المعلومات الشخصية": "El información el personal",
  "عودة": "Volver",
  "كشف النكات": "Revelar el apodos",
  "صورة المستخدم": "Foto el usuario",
  "متجر الهدايا الافتراضية": "Tienda el regalos el predeterminada",
  "فاخرة": "Lujosa",
  "مجوهرات": "Joyas",
  "هدية لـ :": "Regalo a:",
  "كمية :": "Cantidad:",
  "تحتاج لتنفق :": "Necesitas gastar:",
  "جائزة هذه الهدية :": "Premio esta el regalo:",
  "يحصل مستلم هذه الهدية على هذا الرصيد": "Obtiene destinatario esta el regalo en este el saldo",
  "رصيدك الحالي :": "Tu saldo el actual:",
  "اختر هدية": "Elige regalo",
  "الغاء": "Cancelar",
  "أرسل": "Envía",
  "الترقية": "El mejora",
  "قم بترقية عضوية الحساب لتبرز من بين الحشود !": "Haz mejorar membresía el cuenta para destacar de entre el multitudes!",
  "الترقية الى :": "El mejora a:",
  "المدة بالأشهر :": "El duración meses:",
  "التكلفة الإجمالية :": "El costo el total:",
  "ترقية الحساب الآن": "Mejora el cuenta el ahora",
  "حسابي": "Mi cuenta",
  "الهدايا": "El regalos",
  "المحادثات الخاصة": "El chats el privado",
  "الاعضاء المسجلين": "El miembros el registrados",
  "غير مرغوب فيه": "No deseado en él",
  "مكالمة صوتية خاصة واردة...": "Llamada de voz privado entrante...",
  "رد": "Responder",
  "سبيكر": "Altavoz",
  "إنهاء": "Finalizar",
  "أغلق الكاميرا": "Cierra la cámara",
  "الجودة: -": "El calidad: -",
  "الكاميرا": "La cámara",
  "المكالمة بالسماعة جارية • انقر لإضاءة الشاشة": "El llamada auricular en curso• haz clic para iluminar el pantalla",
  "بدء مكالمة صوتية": "Iniciar llamada de voz",
  "مكالمة تجريبية مجانية 🎁": "Llamada de prueba gratis 🎁",
  "المتصل به": "El conectado en él",
  "متابعة": "Continuar",
  "إشعار من النظام": "Notificación de el sistema",
  "حسناً": "De acuerdo",
  "الهدية من:": "El regalo de:",
  "أرسلت إلى:": "Envié a:",
  "العدد والكمية:": "El número de cantidad:",
  "التاريخ والوقت:": "El fecha hora:",
  "إيموجي": "Emoji",
  "قائمة الألوان": "Lista el colores",
  "القائمة الرئيسية": "El lista el principales",
  "متصل": "Conectado",
  "رصيدك الحالي": "Tu saldo el actual",
  "شراء رصيد": "Compra saldo",
  "توثيق حسابي": "Verificación mi cuenta",
  "الدخول الملكي 👑": "Entrada real 👑",
  "ترقية حسابي": "Mejora mi cuenta",
  "تغيير الصورة": "Cambio el foto",
  "هدايا حسابي": "Regalos mi cuenta",
  "قوائم الحظر": "Listas el bloqueo",
  "الاعدادات": "El ajustes",
  "الهدايا المستلمة": "El regalos el recibida",
  "جميع الهدايا التي أرسلها الأعضاء إلى حسابك": "Todos el regalos que envíala el miembros a tu cuenta",
  "قائمة التجاهل": "Lista el ignorar",
  "لا يمكن تبادل الرسائل الخاصة بينك وبين الأشخاص المتجاهلين.": "No se puede intercambio mensajes privados contigo y entre el personas el ignorados.",
  "تغيير الحالة": "Cambio el estado",
  "مشغول": "Ocupado",
  "بالخارج": "Fuera",
  "حساب": "Cuenta",
  "أضف إطلالة": "Añade look",
  "اختر صورة": "Elige foto",
  "او": "O",
  "رفع صورة": "Subir foto",
  "عام": "Público",
  "تفعيل الصوت": "Activación el voz",
  "صوت الرسائل الجديدة": "Voz el mensajes el nueva",
  "صوت دخول المستخدمين": "Voz inicio de sesión el usuarios",
  "اظهار الوقت في الرسائل": "Mostrar el hora en el mensajes",
  "استقبال الرسائل الخاصة": "Recepción mensajes privados",
  "إشعارات سطح المكتب": "Notificaciones escritorio el escritorio",
  "تغيير اللغة": "Cambio el idioma",
  "الحساب": "El cuenta",
  "تغيير كلمة المرور": "Cambio contraseña",
  "لحسابك المسجل — أدخل كلمة المرور الحالية ثم الجديدة": "A tu cuenta el registrado — introduce contraseña el actual luego el nueva",
  "إشعارات": "Notificaciones",
  "منشور جديد": "Publicación nuevo",
  "يوتيوب": "YouTube",
  "جاري تحميل المنشورات...": "Carga el publicaciones...",
  "عرض الوسائط": "Mostrar el multimedia",
  "جارٍ تجهيز الوسائط...": "Cargando preparar el multimedia...",
  "تعذر تشغيل الفيديو داخل المتصفح": "No se pudo ejecutar el vídeo dentro de el navegador",
  "قد يكون ترميز الملف غير مدعوم. يمكنك فتح الملف الأصلي من الزر بالأسفل.": "Puede ser codificación el archivo no soportado. puedes abrir el archivo el original de el botón abajo.",
  "انقر تشغيل لبدء المشاهدة": "Haz clic ejecutar para empezar el ver",
  "فتح الملف الأصلي": "Abrir el archivo el original",
  "التفاعلات": "El interacciones",
  "احصل على توثيق شاتنا": "Obtén en verificación nuestro chat",
  "احصل على شارة تحقق خاصة تظهر بجوار اسمك أينما ظهر": "Obtén en insignia verifica privado aparecen junto a tu nombre dondequiera apareció",
  "حماية حسابك": "Protección tu cuenta",
  "الثقة والتميز": "El confianza distinción",
  "اجعل مجتمع شاتنا يثق بك وكن دائمًا مميز في المقدمة": "Hazır comunidad nuestro chat confía ti y sé siempre premium en el introducción",
  "الموافقة والرسوم": "El aprobación tarifas",
  "10 ذهب": "10 oro",
  "طلب التحقق من حسابي": "Solicitud el verifica de mi cuenta",
  "شارة التاج الملكي": "Insignia el corona el real",
  "توهج ملكي عند دخول الغرف": "Brillo real en inicio de sesión el salas",
  "عند دخولك أي غرفة يظهر توهج ملكي ذهبي احترافي مع التاج وإشعار الترحيب الملكي للجميع": "En tu entrada cualquier sala aparece brillo real dorado profesional con el corona y notificar el bienvenida el real todos",
  "تميز دائم": "Distinción permanente",
  "شارة ملكية لا تُزال — تميّزك في المقدمة دائماً": "Insignia propiedad no se eliminan — te distinga en el introducción siempre",
  "اختر حيوانك الملكي": "Elige tu animal el real",
  "التكلفة": "El costo",
  "طلب الدخول الملكي": "Solicitud entrada real",
  "لديك الدخول الملكي": "Tienes entrada real",
  "تغيير الحيوان الملكي": "Cambio animal real",
  "اشترِ الذهب الافتراضي لترقية حسابك أو حساب أصدقائك وإرسال الهدايا": "Compra el oro el predeterminado para mejorar tu cuenta o cuenta tus amigos y enviar el regalos",
  "باقات شحن الذهب المميزة": "Paquetes recarga el oro el especiales",
  "اختر الباقة المناسبة وادفع عبر PayPal أو بطاقة فيزا/ماستركارد/أمريكان إكسبريس لشحن رصيدك فورياً بعد تأكيد الدفع": "Elige el paquete el adecuada y paga vía PayPal o tarjeta Visa/Mastercard/American Express para recargar tu saldo al instante después de confirmar el pago",
  "متابعة شراء": "Continuar compra",
  "إعلان عام": "Anuncio público",
  "بواسطة:": "Por:",
  "الإدارة": "El administración",
  "طريقة دخول الغرفة": "Método inicio de sesión el sala",
  "اختر طريقة دخولك إلى غرفة": "Elige método tu entrada a sala",
  "دخول ظاهر": "Inicio de sesión visible",
  "دخول مخفي": "Inicio de sesión oculto",
  "كلا": "Ambos",
  "نعم": "Sí",
  "دخول الى الغرفة المختارة": "Inicio de sesión a el sala el seleccionadas",
  "لا": "No",
  "بث مباشر": "Transmisión en vivo",
  "بث مباشر نشط": "Transmisión en vivo activo",
  "لا يمكنك مغادرة الغرفة وأنت تقوم بالبث المباشر.": "No se puedecomo salir de el sala mientras tú estás contransmisión en vivo.",
  "البقاء في الغرفة": "El permanecer en el sala",
  "إيقاف البث والخروج": "Detener el transmisión salir",
  "غرفة محمية": "Sala protegida",
  "غرفة «": "Sala«",
  "» محمية بكلمة مرور.": "» protegida con la palabra paso.",
  "اكتب كلمة المرور للدخول:": "Escribe contraseña inicio de sesión:",
  "❌ كلمة المرور غير صحيحة — حاول مرة أخرى": "❌ contraseña no correctas — intenta vez otra",
  "قسم الشكاوي": "Sección el quejas",
  "إرفاق صورة (دليل) — اختياري": "Adjuntar foto(guía) — opcional",
  "إرسال الشكوى": "Enviar el queja",
  "استعادة كلمة المرور": "Recuperación contraseña",
  "أدخل بريدك المسجل وسنرسل لك رمز استعادة من 6 أرقام": "Introduce tu correo el registrado y enviaremos para ti código recuperación de 6 dígitos",
  "إرسال الرمز": "Enviar el código",
  "جاري رفع الملف...": "Subir el archivo...",
  "فحص الملف قبل الإرسال": "Revisar el archivo antes de el enviar",
  "جارٍ فحص الملف...": "Cargando revisar el archivo...",
  "إرسال إلى العام": "Enviar a el público",
  "تسجيل مقطع صوتي": "Registro clip de audio",
  "جارٍ التسجيل...": "Cargando el registro...",
  "إيقاف ومعاينة": "Detener y vista previa",
  "معاينة المقطع قبل الإرسال": "Vista previa el clip antes de el enviar",
  "استمع إلى المقطع ثم أرسله أو احذفه": "Escucha a el clip luego envíalo o bórralo",
  "الرسالة طويلة": "El mensaje largos",
  "يجب أن تكون الرسالة": "Debes que ser el mensaje",
  "حرف أو أقل": "Carácter o menos",
  "عدد الأحرف المكتوبة": "Número de el caracteres el escritos",
  "العودة لتعديل الرسالة": "El volver para editar el mensaje",
  "لا تتحدث بسرعة": "No hablan rápidamente",
  "خذ استراحة قصيرة قبل إرسال الرسالة التالية": "Toma descanso corta antes de enviar el mensaje el siguiente",
  "تم إيقاف الوصول": "Se detener el acceso",
  "تم حظرك بسبب سلوكك السيئ": "Se tu bloqueo debido a tu comportamiento el malo",
  "لن تتمكن من دخول الدردشة من هذا الحساب أو الجهاز حتى تقوم الإدارة بفك الحظر.": "No puedas de inicio de sesión el chat de este el cuenta o el dispositivo hasta estás el administración levantar el bloqueo.",
  "سبب الحظر": "Razón el bloqueo",
  "سلوك سيئ داخل الدردشة": "Comportamiento malo dentro de el chat",
  "الحظر مرتبط بالحساب والجهاز ويستمر عند تغيير عنوان IP": "El bloqueo vinculado cuenta dispositivo y continúa en cambio título IP",
  "إعادة التحقق بعد فك الحظر": "Re- el verifica después de levantar el bloqueo",
  "جلسة جديدة": "Sesión nueva",
  "تم الدخول بحسابك من جهاز آخر": "Se el inicio de sesión con tu cuenta de dispositivo último",
  "العودة لتسجيل الدخول": "El volver para registrarte el inicio de sesión",
  "تم قطع الاتصال": "Se cortar el conexión",
  "جارٍ إعادة الاتصال...": "Cargando re- el conexión...",
  "اتصال": "Conexión",
  "جارٍ التحميل...": "Cargando el carga...",
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
  "رسالة عامة": "Mensaje públicas",
  "تحدث — الصعود كمذيع": "Habla — el subir como locutor",
  "اكتب حالتك...": "Escribe tu estado...",
  "اسحب لتحريك نافذة البث": "Arrastra para mover ventana el transmisión",
  "كتم/إلغاء كتم صوتي كمذيع": "Silenciar/cancelar silenciar de audio como locutor",
  "الأسم المستعار": "El nombre el alias",
  "الرقم السري": "El número el secreto",
  "اسم المستعار": "Nombre el alias",
  "البريد الإلكتروني (Gmail)": "El correo electrónico(Gmail)",
  "الحالة / نبذة شخصية (اختياري)": "El estado / biografía personal(opcional)",
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
  "اكتب منشورك هنا...": "Escribe tu publicación aquí...",
  "ابحث عن فيديو في YouTube": "Busca sobre vídeo en YouTube",
  "موضوع الشكوى": "Asunto el queja",
  "اكتب شكواك هنا...": "Escribe tu queja aquí...",
  "إزالة الصورة": "Eliminar el foto",
  "كلمة المرور الجديدة": "La nueva contraseña",
  "🇸🇦 العربية": "🇸🇦 el árabe",
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
  "اكتب حالتك أو نبذة تعبر عنك...": "Escribe tu estado o biografía atraviesa sobre...",
  "حذف المنشور": "Eliminar el publicación",
  "عرض من تفاعلوا مع المنشور": "Mostrar de interactúen con el publicación",
  "اكتب تعليقاً...": "Escribe un comentario...",
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
  "تحديث الحائط": "Actualizar muro",
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
  "طلب تغيير الحيوان الملكي": "Solicitud de cambio de animal real",
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
  "الصور الافتراضية": "Varsayılan Resimler",
  "اختر صورة الروبوت من المكتبة أو من الصور التي رفعتها": "Bot resmini kütüphaneden veya yükledikleriniz arasından seçin",
  "الافتراضية": "Varsayılan",
  "الطبيعة": "Doğa",
  "اخرى": "Diğer",
  "جاري تحميل الصور...": "Resimler yükleniyor...",
  "لا توجد صور مرفوعة بعد — استخدم زر «رفع صورة الروبوت» ثم عد إلى هنا": "Henüz yüklenmiş resim yok — «Bot Avatarı Yükle» düğmesini kullanın ve buraya geri dönün",
  "تحديد الصورة": "Resmi Seç",
  "اختر صورة من المعرض أولاً": "Önce galeriden bir resim seçin",
  "تم تحديد الصورة ✅": "Resim seçildi ✅",
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
  "مرفوعاتي": "Yüklemelerim",
  "إصلاح تلقائي شامل (تفريد العناوين + الغرف المخفية)": "Tek Tıkla Otomatik Düzeltme (Benzersiz Başlıklar + Gizli Odalar)",
  "يعيد توليد عناوين/أوصاف المسارات المتضاربة تلقائياً وينشئ غرفة SEO مخفية لكل مسار": "Çakışan başlık/açıklamaları otomatik yeniler ve her yol için gizli SEO odası oluşturur",
  "جاري الفحص والإصلاح...": "Taranıyor ve düzeltiliyor...",
  "غرفة SEO مخفية (لمحركات البحث)": "Gizli SEO odası (arama motorları için)"
,
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
  "هدية": "Hediye",
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
  "مباشر": "Canlı",
  "داخل الموقع": "Içinde site",
  "بلا اسم": "Olmadan isim",
  "من أين دخل": "-den nerede girdi",
  "كلمة البحث": "Kelime arama",
  "الرابط / المسار": "Bağlantı / yol",
  "الوقت": "Zaman",
  "الاعدادات: كل التفاصيل + الحظر": "Ayarlar: her detaylar + yasaklama",
  "العمر": "Yaş",
  "ذكر": "Erkek",
  "أنثى": "Kadın",
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
  "النوع": "Cinsiyet",
  "دولة الحساب": "Ülke hesap",
  "الرصيد (ذهب)": "Bakiye(altın)",
  "تاريخ إنشاء الحساب": "Tarih oluşturma hesap",
  "آخر دخول": "Son giriş",
  "إجمالي عمليات الدخول": "Toplam işlemler giriş",
  "النبذة": "Hakkında",
  "فك الحظر عن الحساب": "Kaldırma yasaklama hakkında hesap",
  "🚫 حظر المستخدم (الحساب + الجهاز)": "🚫 yasaklama kullanıcı(hesap + cihaz)",
  "لأنه عضو مسجل فالأفضل «حظر المستخدم» — أما الزائر غير المسجل فيُحظر عبر IP وأجهزته.": "-dığı için üye kayıtlı en iyi«yasaklama kullanıcı» — -se ziyaretçi değil kayıtlı yasaklanır üzerinden IP ve cihazı.",
  "حظر من صفحة تتبع المستخدمين": "Yasaklama -den sayfa takip kullanıcılar",
  "تم حظر المستخدم وفصله فوراً 🚫": "Yapıldı yasaklama kullanıcı ve ayırmak hemen 🚫",
  "تم فك الحظر عن المستخدم": "Yapıldı kaldırma yasaklama hakkında kullanıcı",
  "تعذر تنفيذ الحظر": "Başarısız yürütme yasaklama",
  "وفصل جميع اتصالاتهم 🚫": "Ve ayırma tüm bağlantıları 🚫",
  "غرفة محذوفة": "Silinmiş oda",
  "🟢 متواجد داخل الغرفة": "🟢 odada",
  "⚪ متوقف وغير ظاهر": "⚪ durdurulmuş ve diğer görünür",
  "إيقاف": "Durdur",
  "تشغيل": "Çalıştırma",
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
  "اكتب اسم المستخدم": "Yaz isim kullanıcı",
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
  "جاري الاتصال...": "Bağlantı...",
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
  "إلغاء الكتم": "Iptal susturma",
  "كتم": "Susturma",
  "فك الحظر": "Kaldırma yasaklama",
  "حظر": "Yasaklama",
  "طلب توثيق الحساب": "Istek doğrulama hesap",
  "👑 طلب دخول ملكي": "👑 istek giriş kraliyet",
  "👑 طلب تغيير الحيوان الملكي": "👑 istek değiştirme kraliyet hayvanı",
  "الحيوان الملكي الجديد": "Kraliyet hayvanı yeni",
  "الحيوان الملكي": "Kraliyet hayvanı",
  "الكمية المطلوبة": "Miktar gerekli",
  "التكلفة المقترحة": "Maliyet önerilen",
  "الذهب المطلوب شحنه للمستخدم:": "Altın gerekli yüklemek kullanıcı:",
  "الذهب المطلوب خصمه:": "Altın gerekli kesmek:",
  "موافقة وشحن الذهب": "Onay ve yükleme altın",
  "موافقة وتنفيذ": "Onay ve yürütme",
  "بدون سبب": "Olmadan neden",
  "تمت الموافقة وشحن الذهب للمستخدم": "Yapıldı onay ve yükleme altın kullanıcı",
  "تمت الموافقة وتنفيذ الطلب وخصم الذهب": "Yapıldı onay ve yürütme istek ve kesinti altın",
  "تعذرت الموافقة": "Başarısız onay",
  "اكتب سبب الرفض الذي سيصل للمستخدم:": "Yaz neden reddetme - gelecek kullanıcı:",
  "تم رفض الطلب من الإدارة": "Yapıldı reddetme istek -den yönetim",
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
  "افتراضي": "Varsayılan",
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
  "العربية": "Arapça",
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
  "رفض": "Reddetme",
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
  "رسالة": "Mesaj",
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
  "إنشاء حساب": "Hesap oluştur",
  "الخروج": "Çıkış",
  "لا يوجد احد في البث المباشر حي الان": "Şu anda canlı yayın yapan yok",
  "مغادرة الغرفة": "Odadan çık",
  "تحديث الغرف": "Odaları yenile",
  "حذف العام لدي فقط": "Silme genel bende sadece",
  "حذف العام للجميع": "Silme genel tüm",
  "الدردشة العربية": "Arap Sohbeti",
  "متصل الان": "Şimdi çevrimiçi",
  "تحدث": "Konuş",
  "الغرف": "Odalar",
  "الخاص": "Özel",
  "الإشعارات": "Bildirimler",
  "الحائط": "Duvar",
  "القائمة": "Menü",
  "الحالات": "Durumlar",
  "حالتي": "Durumum",
  "اضغط لإضافة تحديث الحالة": "Durum eklemek için dokun",
  "الحالات الحديثة": "Son durumlar",
  "جاري تحميل الحالات...": "Indirme durumlar...",
  "إضافة حالة": "Durum ekle",
  "صورة": "Fotoğraf",
  "فيديو": "Video",
  "ملف صوتي": "Ses kaydı",
  "كتابة": "Yazı",
  "تختفي الحالة تلقائياً بعد 24 ساعة": "Durum 24 saat sonra otomatik kaybolur",
  "حالة كتابية": "Yazı durumu",
  "نشر": "Yayınla",
  "حالة صوتية": "Ses durumu",
  "المشاهدات": "Izlenmeler",
  "حذف الحالة": "Silme durum",
  "شاهد حالتي": "Durumumu gör",
  "مشاهدة": "İzle",
  "بدء بث فيديو": "Video yayını başlat",
  "بدء البث": "Yayını başlat",
  "مشاهدة البث": "Yayını izle",
  "0 مشاهد": "0 izleyiciler",
  "بانتظار موافقة أحد المذيعين على مشاهدة البث…": "Bekliyor onay bir yayıncılar -de izleme yayın…",
  "إنهاء البث": "Yayını bitir",
  "مغادرة المشاهدة": "İzlemeyi bırak",
  "لغة الواجهة": "Arayüz dili",
  "ع": "ع",
  "عرض الواجهة باللغة العربية": "Arayüzü Arapça göster",
  "تسجيل الدخول": "Giriş yap",
  "دخول كزائر/ة": "Misafir gir",
  "نسيت كلمة السر؟": "Şifreni mi unuttun?",
  "استعادة كلمة السر": "Şifreyi kurtar",
  "لا يوجد لديك عضوية؟": "Üyeliğin yok mu?",
  "إنشاء حساب مجانًا": "Ücretsiz hesap oluştur",
  "مجهول": "Gizli",
  "الرجاء قراءة": "Lütfen oku",
  "شروط الاستخدام": "Kullanım Şartları",
  "وقراءة": "ve oku",
  "سياسة الخصوصية": "Gizlilik Politikası",
  "يُستخدم للتفعيل والمتابعة — يجب أن يكون Gmail (ينتهي بـ @gmail.com)": "Etkinleştirme için kullanılır — Gmail olmalı (@gmail.com ile bitmeli)",
  "تسجيل العضوية": "Üyelik kaydı",
  "تفعيل الحساب": "Hesabı etkinleştir",
  "أرسلنا رمز تفعيل مكونًا من 6 أرقام إلى جيميلك:": "Gönderdik kod etkinleştirme oluşan -den 6 rakamlar -ye Gmailiniz:",
  "إعادة إرسال الرمز": "Kodu yeniden gönder",
  "تغيير البريد": "E-postayı değiştir",
  "يتطلب الدخول باستخدام عضويتك أو تسجيل عضوية": "Gerektirir giriş kullanarak üyeliğiniz veya kayıt üyelik",
  "التسجيل الان": "Kayıt şimdi",
  "لاحقا": "Sonra",
  "عرض الحالة": "Gösterim durum",
  "الرد على الرسالة": "Mesajı yanıtla",
  "دردشة خاصة": "Özel sohbet",
  "ارسل هدية": "Hediye gönder",
  "ترقية هذا المستخدم": "Yükseltme bu kullanıcı",
  "تجاهل": "Yok sayma",
  "سحب المايك": "Çekme mikrofon",
  "سحب مع منع صعود": "Çekme ile engelleme katılma",
  "فك من البث": "Kaldırma -den yayın",
  "كتم المستخدم": "Susturma kullanıcı",
  "طرد المستخدم": "Atma kullanıcı",
  "حظر المستخدم": "Yasaklama kullanıcı",
  "كشف نكات": "Ifşa takma adlar",
  "المعلومات الشخصية": "Bilgi kişisel",
  "عودة": "Dönüş",
  "كشف النكات": "Ifşa takma adlar",
  "صورة المستخدم": "Fotoğraf kullanıcı",
  "متجر الهدايا الافتراضية": "Mağaza hediyeler varsayılan",
  "فاخرة": "Lüks",
  "مجوهرات": "Mücevher",
  "هدية لـ :": "Hediye -e:",
  "كمية :": "Miktar:",
  "تحتاج لتنفق :": "Ihtiyacın harcamak:",
  "جائزة هذه الهدية :": "Ödül bu hediye:",
  "يحصل مستلم هذه الهدية على هذا الرصيد": "Alır alan bu hediye -de bu bakiye",
  "رصيدك الحالي :": "Bakiyeniz mevcut:",
  "اختر هدية": "Seç hediye",
  "الغاء": "Iptal",
  "أرسل": "Gönder",
  "الترقية": "Yükseltme",
  "قم بترقية عضوية الحساب لتبرز من بين الحشود !": "Yap yükseltme üyelik hesap öne çıkmak -den arasında kalabalık!",
  "الترقية الى :": "Yükseltme -ye:",
  "المدة بالأشهر :": "Süre ay:",
  "التكلفة الإجمالية :": "Maliyet toplam:",
  "ترقية الحساب الآن": "Yükseltme hesap şimdi",
  "حسابي": "Hesabım",
  "الهدايا": "Hediyeler",
  "المحادثات الخاصة": "Sohbetler özel",
  "الاعضاء المسجلين": "Üyeler kayıtlı",
  "غير مرغوب فيه": "Değil istenilen -de",
  "مكالمة صوتية خاصة واردة...": "Arama sesli özel gelen...",
  "رد": "Yanıt",
  "سبيكر": "Hoparlör",
  "إنهاء": "Bitirme",
  "أغلق الكاميرا": "Kapat kamera",
  "الجودة: -": "Kalite: -",
  "الكاميرا": "Kamera",
  "المكالمة بالسماعة جارية • انقر لإضاءة الشاشة": "Arama kulaklık devam eden• tıklayın aydınlatmak ekran",
  "بدء مكالمة صوتية": "Başlatma arama sesli",
  "مكالمة تجريبية مجانية 🎁": "Arama deneme ücretsiz 🎁",
  "المتصل به": "Bağlı -de",
  "متابعة": "Devam",
  "إشعار من النظام": "Bildirim -den sistem",
  "حسناً": "Tamam",
  "الهدية من:": "Hediye -den:",
  "أرسلت إلى:": "Gönderdim -ye:",
  "العدد والكمية:": "Sayı miktar:",
  "التاريخ والوقت:": "Tarih zaman:",
  "إيموجي": "Emoji",
  "قائمة الألوان": "Liste renkler",
  "القائمة الرئيسية": "Liste ana",
  "متصل": "Bağlı",
  "رصيدك الحالي": "Bakiyeniz mevcut",
  "شراء رصيد": "Satın alma bakiye",
  "توثيق حسابي": "Doğrulama hesabım",
  "الدخول الملكي 👑": "Kraliyet girişi 👑",
  "ترقية حسابي": "Yükseltme hesabım",
  "تغيير الصورة": "Değiştirme fotoğraf",
  "هدايا حسابي": "Hediyeler hesabım",
  "قوائم الحظر": "Listeler yasaklama",
  "الاعدادات": "Ayarlar",
  "الهدايا المستلمة": "Hediyeler alınan",
  "جميع الهدايا التي أرسلها الأعضاء إلى حسابك": "Tüm hediyeler -diği gönder üyeler -ye hesabınız",
  "قائمة التجاهل": "Liste yok sayma",
  "لا يمكن تبادل الرسائل الخاصة بينك وبين الأشخاص المتجاهلين.": "Olamaz değişim özel mesajlar aranızda ve arasında insanlar yok sayılanlar.",
  "تغيير الحالة": "Değiştirme durum",
  "مشغول": "Meşgul",
  "بالخارج": "Dışında",
  "حساب": "Hesap",
  "أضف إطلالة": "Ekle görünüm",
  "اختر صورة": "Seç fotoğraf",
  "او": "Veya",
  "رفع صورة": "Yükleme fotoğraf",
  "عام": "Genel",
  "تفعيل الصوت": "Etkinleştirme ses",
  "صوت الرسائل الجديدة": "Ses mesajlar yeni",
  "صوت دخول المستخدمين": "Ses giriş kullanıcılar",
  "اظهار الوقت في الرسائل": "Gösterme zaman -de mesajlar",
  "استقبال الرسائل الخاصة": "Alma özel mesajlar",
  "إشعارات سطح المكتب": "Bildirimler masaüstü masa",
  "تغيير اللغة": "Değiştirme dil",
  "الحساب": "Hesap",
  "تغيير كلمة المرور": "Değiştirme şifre",
  "لحسابك المسجل — أدخل كلمة المرور الحالية ثم الجديدة": "Hesabınıza kayıtlı — girin şifre mevcut sonra yeni",
  "إشعارات": "Bildirimler",
  "منشور جديد": "Gönderi yeni",
  "يوتيوب": "YouTube",
  "جاري تحميل المنشورات...": "Indirme gönderiler...",
  "عرض الوسائط": "Gösterim medya",
  "جارٍ تجهيز الوسائط...": "Yükleniyor hazırlama medya...",
  "تعذر تشغيل الفيديو داخل المتصفح": "Başarısız çalıştırma video içinde tarayıcı",
  "قد يكون ترميز الملف غير مدعوم. يمكنك فتح الملف الأصلي من الزر بالأسفل.": "-ebilir olmak kodlama dosya değil destekleniyor. yapabilirsiniz açma dosya orijinal -den düğme alt.",
  "انقر تشغيل لبدء المشاهدة": "Tıklayın çalıştırma başlamak izleme",
  "فتح الملف الأصلي": "Açma dosya orijinal",
  "التفاعلات": "Etkileşimler",
  "احصل على توثيق شاتنا": "Al -de doğrulama sohbetimiz",
  "احصل على شارة تحقق خاصة تظهر بجوار اسمك أينما ظهر": "Al -de rozet kontrol özel görünür yanında adınız nerede göründü",
  "حماية حسابك": "Koruma hesabınız",
  "الثقة والتميز": "Güven ayrıcalık",
  "اجعل مجتمع شاتنا يثق بك وكن دائمًا مميز في المقدمة": "Yap topluluk sohbetimiz güvenir size ve ol her zaman premium -de giriş",
  "الموافقة والرسوم": "Onay ücret",
  "10 ذهب": "10 altın",
  "طلب التحقق من حسابي": "Istek kontrol -den hesabım",
  "شارة التاج الملكي": "Rozet taç kraliyet",
  "توهج ملكي عند دخول الغرف": "Parıltı kraliyet -de giriş odalar",
  "عند دخولك أي غرفة يظهر توهج ملكي ذهبي احترافي مع التاج وإشعار الترحيب الملكي للجميع": "-de girişiniz herhangi oda görünür parıltı kraliyet altın profesyonel ile taç ve bildirim karşılama kraliyet tüm",
  "تميز دائم": "Ayrıcalık kalıcı",
  "شارة ملكية لا تُزال — تميّزك في المقدمة دائماً": "Rozet sahiplik hayır kaldırılır — seni ayıran -de giriş her zaman",
  "اختر حيوانك الملكي": "Seç hayvanınız kraliyet",
  "التكلفة": "Maliyet",
  "طلب الدخول الملكي": "Istek kraliyet girişi",
  "لديك الدخول الملكي": "Sizde kraliyet girişi",
  "تغيير الحيوان الملكي": "Değiştirme kraliyet hayvanı",
  "اشترِ الذهب الافتراضي لترقية حسابك أو حساب أصدقائك وإرسال الهدايا": "Satın al altın varsayılan yükseltmek hesabınız veya hesap arkadaşların ve gönderme hediyeler",
  "باقات شحن الذهب المميزة": "Paketler yükleme altın özel",
  "اختر الباقة المناسبة وادفع عبر PayPal أو بطاقة فيزا/ماستركارد/أمريكان إكسبريس لشحن رصيدك فورياً بعد تأكيد الدفع": "Seç paket uygun ve öde üzerinden PayPal veya kart Visa/Mastercard/American Express yüklemek bakiyeniz anında sonra onay ödeme",
  "متابعة شراء": "Devam satın alma",
  "إعلان عام": "Duyuru genel",
  "بواسطة:": "Tarafından:",
  "الإدارة": "Yönetim",
  "طريقة دخول الغرفة": "Yöntem giriş oda",
  "اختر طريقة دخولك إلى غرفة": "Seç yöntem girişiniz -ye oda",
  "دخول ظاهر": "Giriş görünür",
  "دخول مخفي": "Giriş gizli",
  "كلا": "Her ikisi",
  "نعم": "Evet",
  "دخول الى الغرفة المختارة": "Giriş -ye oda seçilmiş",
  "لا": "Hayır",
  "بث مباشر": "Canlı yayın",
  "بث مباشر نشط": "Canlı yayın aktif",
  "لا يمكنك مغادرة الغرفة وأنت تقوم بالبث المباشر.": "Olamazolarak ayrılma oda ve sen yapıyorsun ilecanlı yayın.",
  "البقاء في الغرفة": "Kalma -de oda",
  "إيقاف البث والخروج": "Durdur yayın çıkış",
  "غرفة محمية": "Oda korunan",
  "غرفة «": "Oda«",
  "» محمية بكلمة مرور.": "» korunan kelime ile geçiş.",
  "اكتب كلمة المرور للدخول:": "Yaz şifre giriş:",
  "❌ كلمة المرور غير صحيحة — حاول مرة أخرى": "❌ şifre değil doğru — deneyin kez diğer",
  "قسم الشكاوي": "Bölüm şikayetler",
  "إرفاق صورة (دليل) — اختياري": "Ekleme fotoğraf(rehber) — isteğe bağlı",
  "إرسال الشكوى": "Gönderme şikayet",
  "استعادة كلمة المرور": "Kurtarma şifre",
  "أدخل بريدك المسجل وسنرسل لك رمز استعادة من 6 أرقام": "Girin e-postanız kayıtlı ve göndereceğiz senin kod kurtarma -den 6 rakamlar",
  "إرسال الرمز": "Gönderme kod",
  "جاري رفع الملف...": "Yükleme dosya...",
  "فحص الملف قبل الإرسال": "Kontrol dosya önce gönderme",
  "جارٍ فحص الملف...": "Yükleniyor kontrol dosya...",
  "إرسال إلى العام": "Gönderme -ye genel",
  "تسجيل مقطع صوتي": "Kayıt klip sesli",
  "جارٍ التسجيل...": "Yükleniyor kayıt...",
  "إيقاف ومعاينة": "Durdur ve önizleme",
  "معاينة المقطع قبل الإرسال": "Önizleme klip önce gönderme",
  "استمع إلى المقطع ثم أرسله أو احذفه": "Dinle -ye klip sonra gönder veya sil",
  "الرسالة طويلة": "Mesaj uzun",
  "يجب أن تكون الرسالة": "Gerekir -dığı olmak mesaj",
  "حرف أو أقل": "Karakter veya az",
  "عدد الأحرف المكتوبة": "Sayı karakter yazılı",
  "العودة لتعديل الرسالة": "Dönüş düzenlemek mesaj",
  "لا تتحدث بسرعة": "Hayır konuşuyor hızlıca",
  "خذ استراحة قصيرة قبل إرسال الرسالة التالية": "Al mola kısa önce gönderme mesaj sonraki",
  "تم إيقاف الوصول": "Yapıldı durdur erişim",
  "تم حظرك بسبب سلوكك السيئ": "Yapıldı yasak nedeniyle davranışınız kötü",
  "لن تتمكن من دخول الدردشة من هذا الحساب أو الجهاز حتى تقوم الإدارة بفك الحظر.": "-mayacak yapabilirsin -den giriş sohbet -den bu hesap veya cihaz -e kadar yapıyorsun yönetim kaldırmak yasaklama.",
  "سبب الحظر": "Neden yasaklama",
  "سلوك سيئ داخل الدردشة": "Davranış kötü içinde sohbet",
  "الحظر مرتبط بالحساب والجهاز ويستمر عند تغيير عنوان IP": "Yasaklama bağlı hesap cihaz ve devam -de değiştirme başlık IP",
  "إعادة التحقق بعد فك الحظر": "Yeniden kontrol sonra kaldırma yasaklama",
  "جلسة جديدة": "Oturum yeni",
  "تم الدخول بحسابك من جهاز آخر": "Yapıldı giriş hesabınızla -den cihaz son",
  "العودة لتسجيل الدخول": "Dönüş kayıt olmak giriş",
  "تم قطع الاتصال": "Yapıldı kesme bağlantı",
  "جارٍ إعادة الاتصال...": "Yükleniyor yeniden bağlantı...",
  "اتصال": "Bağlantı",
  "جارٍ التحميل...": "Yükleniyor indirme...",
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
  "رسالة عامة": "Mesaj genel",
  "تحدث — الصعود كمذيع": "Konuş — katılma yayıncı olarak",
  "اكتب حالتك...": "Yaz durumunuz...",
  "اسحب لتحريك نافذة البث": "Sürükle taşımak pencere yayın",
  "كتم/إلغاء كتم صوتي كمذيع": "Susturma/iptal susturma sesli yayıncı olarak",
  "الأسم المستعار": "Isim takma",
  "الرقم السري": "Numara gizli",
  "اسم المستعار": "Isim takma",
  "البريد الإلكتروني (Gmail)": "E-posta adresi(Gmail)",
  "الحالة / نبذة شخصية (اختياري)": "Durum / hakkında kişisel(isteğe bağlı)",
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
  "اكتب منشورك هنا...": "Yaz gönderin burada...",
  "ابحث عن فيديو في YouTube": "Ara hakkında video -de YouTube",
  "موضوع الشكوى": "Konu şikayet",
  "اكتب شكواك هنا...": "Yaz şikayetiniz burada...",
  "إزالة الصورة": "Kaldırma fotoğraf",
  "كلمة المرور الجديدة": "Yeni şifre",
  "🇸🇦 العربية": "🇸🇦 Arapça",
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
  "اكتب حالتك أو نبذة تعبر عنك...": "Yaz durumunuz veya hakkında geçer hakkında...",
  "حذف المنشور": "Silme gönderi",
  "عرض من تفاعلوا مع المنشور": "Gösterim -den etkileşin ile gönderi",
  "اكتب تعليقاً...": "Yaz bir yorum...",
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
  "تحديث الحائط": "Duvarı yenile",
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
  "طلب تغيير الحيوان الملكي": "Kraliyet hayvan değiştirme talebi",
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

const ADMIN_I18N_DICTS = { en: ADMIN_I18N_EN, es: ADMIN_I18N_ES, tr: ADMIN_I18N_TR };

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

  return i18nFallback(text, lang);
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
    { id: 'monitor', icon: 'eye_fill', label: 'رصد فريق', superAdminOnly: true },
    { id: 'userTracking', icon: 'location_north_line_fill', label: 'تتبع المستخدمين', superAdminOnly: true }]},
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
      ${g.img && g.img.startsWith('/') ? `<img src="${esc(g.img)}" alt="هدية" style="width:46px;height:46px;object-fit:contain;background:#f6f7fc;border-radius:10px;padding:4px">` : `<span style="font-size:32px;width:46px;text-align:center">${esc(g.img || '🎁')}</span>`}
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
      const ava = r.avatar && r.avatar.startsWith('/') ? `<img src="${esc(r.avatar)}" alt="" style="width:40px;height:40px;border-radius:50%;object-fit:cover">` : '<span style="width:40px;height:40px;border-radius:50%;background:#f3c8de;display:flex;align-items:center;justify-content:center;font-size:18px">👩</span>';
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

// علم الدولة من رمزها الدولي (ISO-2) — بدون أي صور خارجية.
function countryFlagEmoji(code) {
  const clean = String(code || '').trim().toUpperCase();
  if (clean === 'LAN') return '🏠';
  if (!/^[A-Z]{2}$/.test(clean)) return '🌍';
  return String.fromCodePoint(...[...clean].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
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
    const country = item.country || 'غير معروف';
    const flag = countryFlagEmoji(item.country_code);
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
          <span class="monitor-country" title="دولة عنوان IP">${flag} ${esc(country)}</span>
        </div>
        <div class="monitor-head-actions">
          <span class="monitor-since">منذ ${esc(since)}</span>
          <button class="monitor-ban" type="button" data-ip="${esc(item.ip)}"><i class="f7-icons">nosign</i> حظر المستخدم (IP + الجهاز)</button>
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
    if (!confirm(`حظر نهائي لكل من يستخدم عنوان IP ${ip} وأجهزتهم؟\nسيتم حظر اتصال الإنترنت (IP) وجهاز المستخدم معاً وفصلهم فوراً.`)) return;
    button.disabled = true;
    try {
      const result = await api('/api/admin/ip/ban', 'POST', { ip, reason: 'حظر من صفحة الرصد' });
      toast('تم حظر عنوان IP' + (result && result.devices ? ` و${result.devices} جهاز مرتبط به` : '') + ' وفصل جميع اتصالاتهم');
      await refreshTeamMonitor();
    } catch (e) { toast(e.error || 'تعذر حظر عنوان IP', false); }
    finally { button.disabled = false; }
  });
}
// =====================================================
//  تتبع المستخدمين: عرض المصادر وسجل الدخول
// =====================================================
// لون ورمز لكل مصدر زيارة
function trackingSourceStyle(src) {
  const n = String(src || '').toLowerCase();
  if (n.includes('google')) return { bg: '#e8f0fe', fg: '#1a73e8', icon: 'search' };
  if (n.includes('bing') || n.includes('yahoo') || n.includes('duckduckgo') || n.includes('yandex') || n.includes('ecosia') || n.includes('brave'))
    return { bg: '#eef2ff', fg: '#4338ca', icon: 'search' };
  if (n.includes('facebook')) return { bg: '#e7f0fd', fg: '#1877f2', icon: 'globe' };
  if (n.includes('instagram')) return { bg: '#fdeef5', fg: '#c13584', icon: 'camera_fill' };
  if (n.includes('twitter') || n.includes('x')) return { bg: '#e8f5fd', fg: '#1d9bf0', icon: 'globe' };
  if (n.includes('tiktok')) return { bg: '#f1f1f1', fg: '#111', icon: 'music_note_2' };
  if (n.includes('youtube')) return { bg: '#fdeaea', fg: '#ff0000', icon: 'play_rectangle_fill' };
  if (n.includes('whatsapp')) return { bg: '#e7f7ef', fg: '#25d366', icon: 'chat_bubble_2_fill' };
  if (n.includes('telegram')) return { bg: '#e8f4fb', fg: '#229ed9', icon: 'paperplane_fill' };
  if (n.includes('مباشر')) return { bg: '#f1f5f9', fg: '#475569', icon: 'arrow_right_circle_fill' };
  if (n.includes('داخل الموقع')) return { bg: '#f0fdf4', fg: '#15803d', icon: 'arrow_2_squarepath' };
  return { bg: '#f8fafc', fg: '#64748b', icon: 'link' };
}
// بطاقات ملخّص: كم زيارة من كل مصدر
function renderTrackingSources(d) {
  const box = $('#trkSources');
  if (!box) return;
  const list = (d && d.sources) || [];
  if (!list.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="trk-cards">` + list.map(s => {
    const st = trackingSourceStyle(s.source);
    return `<div class="trk-card" style="background:${st.bg};border-color:${st.fg}22">
      <i class="f7-icons" style="color:${st.fg}">${st.icon}</i>
      <b style="color:${st.fg}">${s.count}</b>
      <span>${esc(s.source)}</span>
    </div>`;
  }).join('') + `</div>
  <div class="trk-total">إجمالي عمليات الدخول المسجّلة: <b>${d.total || 0}</b></div>`;
}
// جدول السجل
function renderTrackingRows(d) {
  const box = $('#trkList');
  if (!box) return;
  const rows = (d && d.rows) || [];
  if (!rows.length) {
    box.innerHTML = '<div class="empty-state" style="padding:26px;text-align:center;color:#94a3b8">لا توجد سجلات مطابقة</div>';
    return;
  }
  box.innerHTML = `<div class="trk-table-wrap"><table class="trk-table">
    <thead><tr>
      <th>المستخدم</th><th>من أين دخل</th><th>كلمة البحث</th>
      <th>الرابط / المسار</th><th>IP</th><th>الدولة</th><th>الوقت</th><th>إجراءات</th>
    </tr></thead><tbody>` + rows.map(r => {
      const st = trackingSourceStyle(r.source);
      const time = r.created_at ? new Date(r.created_at * 1000).toLocaleString('ar-JO') : '-';
      const who = `${esc(r.username || 'بلا اسم')}${r.registered
        ? '<span class="trk-tag reg">عضو</span>' : '<span class="trk-tag guest">زائر</span>'}`;
      // الرابط الكامل يظهر عند المرور بالفأرة، والمختصر داخل الخلية
      const refShort = r.referrer ? String(r.referrer).replace(/^https?:\/\//, '').slice(0, 46) : '';
      return `<tr>
        <td data-label="المستخدم">${who}</td>
        <td data-label="من أين دخل"><span class="trk-src" style="background:${st.bg};color:${st.fg}">
          <i class="f7-icons">${st.icon}</i>${esc(r.source)}</span></td>
        <td data-label="كلمة البحث">${r.search_query
          ? `<span class="trk-q">${esc(r.search_query)}</span>`
          : '<span class="trk-dash">—</span>'}</td>
        <td data-label="الرابط / المسار" dir="ltr" class="trk-link">
          ${r.landing ? `<div class="trk-landing">${esc(r.landing)}</div>` : ''}
          ${refShort ? `<div class="trk-ref" title="${esc(r.referrer)}">${esc(refShort)}${r.referrer.length > 53 ? '…' : ''}</div>` : ''}
          ${!r.landing && !refShort ? '<span class="trk-dash">—</span>' : ''}
        </td>
        <td data-label="IP" dir="ltr" class="trk-ip">${esc(r.ip || '-')}</td>
        <td data-label="الدولة">${esc(r.country || 'غير معروف')}</td>
        <td data-label="الوقت" class="trk-time">${time}</td>
        <td data-label="" class="trk-actions-cell">
          <button type="button" class="btn btn-purple btn-sm trk-gear" data-id="${r.id}" title="الاعدادات: كل التفاصيل + الحظر">
            <i class="f7-icons">gearshape_fill</i> الإعدادات
          </button>
        </td>
      </tr>`;
    }).join('') + `</tbody></table></div>`;
  // زر الإعدادات لكل مستخدم دخل: يفتح كل تفاصيله مع خيارات الحظر
  box.querySelectorAll('.trk-gear').forEach(btn => {
    btn.onclick = () => openTrackingDetail(+btn.dataset.id);
  });
}

// ====== نافذة «الإعدادات» لكل مستخدم دخل: كل تفاصيله + الحظر ======
let TRK_DETAIL_ESC = null;
function closeTrackingDetail() {
  const ov = $('#trkDetailOverlay');
  if (ov) ov.remove();
  if (TRK_DETAIL_ESC) { document.removeEventListener('keydown', TRK_DETAIL_ESC); TRK_DETAIL_ESC = null; }
}
function trkDtRow(icon, color, label, value, ltr) {
  const empty = value === '' || value == null || value === 0 && label !== 'العمر';
  return `<div class="trk-dt-row">
    <span class="trk-dt-lbl"><i class="f7-icons" style="color:${color}">${icon}</i> ${label}:</span>
    <span class="trk-dt-val${empty ? ' empty' : ''}"${ltr ? ' dir="ltr"' : ''}>${empty ? '—' : esc(value)}</span>
  </div>`;
}
async function openTrackingDetail(loginId) {
  closeTrackingDetail();
  const ov = document.createElement('div');
  ov.className = 'admin-modal-overlay trk-detail-ov';
  ov.id = 'trkDetailOverlay';
  ov.innerHTML = `
    <div class="admin-modal-card trk-detail-card">
      <div class="admin-modal-header">
        <div class="admin-modal-title">
          <div class="seo-ai-icon" style="background:linear-gradient(135deg,#ec4899,#f472b6)"><i class="f7-icons">gearshape_fill</i></div>
          <div>
            <h3>الإعدادات — تفاصيل المستخدم</h3>
            <p>كل ما دخل به هذا الشخص + بيانات حسابه + أدوات الحظر</p>
          </div>
        </div>
        <button class="admin-modal-close" type="button" data-close><i class="f7-icons">xmark</i></button>
      </div>
      <div class="trk-detail-body">
        <div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل التفاصيل...</div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov || (e.target.closest && e.target.closest('[data-close]'))) closeTrackingDetail(); });
  TRK_DETAIL_ESC = (e) => { if (e.key === 'Escape') closeTrackingDetail(); };
  document.addEventListener('keydown', TRK_DETAIL_ESC);

  const body = ov.querySelector('.trk-detail-body');
  let d;
  try {
    d = await api('/api/admin/user-tracking/' + loginId + '/details');
  } catch (e) {
    body.innerHTML = `<div class="empty-state" style="padding:22px;text-align:center;color:#dc2626">تعذر تحميل التفاصيل: ${esc(e.error || '')}</div>`;
    return;
  }
  const L = d.login, U = d.user;
  const rankNames = { user: 'مستخدم', roomadmin: 'أدمن غرفة', admin: 'أدمن', superadmin: 'سوبر أدمن', supermaster: 'ملك الدردشة 👑' };
  const membershipNames = { none: 'بدون عضوية', mmez: 'مميز', plus: 'Plus', premium: 'Premium', vip: 'VIP' };
  const genderNames = { boy: 'ذكر', girl: 'أنثى', secret: 'سري' };
  const fmtTime = ts => ts ? new Date(ts * 1000).toLocaleString('ar-JO') : '—';

  // ---- هوية المستخدم ----
  let identity = `
    <div class="trk-dt-identity">
      ${U && U.avatar
        ? `<img class="trk-dt-avatar" src="${esc(U.avatar)}" alt="">`
        : `<span class="trk-dt-avatar"><i class="f7-icons">person_fill</i></span>`}
      <div style="min-width:0">
        <div class="trk-dt-name">${esc(L.username || 'بلا اسم')}</div>
        <div class="trk-dt-chips">
          <span class="chip" style="${L.registered ? 'background:#dcfce7;color:#166534' : 'background:#fee2e2;color:#991b1b'}">${L.registered ? '✅ عضو مسجل' : '👤 زائر (غير مسجل)'}</span>
          <span class="chip" style="${d.online ? 'background:#ecfdf5;color:#047857' : 'background:#f1f5f9;color:#64748b'}">${d.online ? '🟢 متصل الآن' : '⚪ غير متصل حالياً'}</span>
          ${U && U.banned ? '<span class="chip" style="background:#fee2e2;color:#dc2626">🚫 محظور</span>' : ''}
          ${U && U.muted ? '<span class="chip" style="background:#fef3c7;color:#92400e">🔇 مكتوم</span>' : ''}
        </div>
      </div>
    </div>`;

  // ---- تفاصيل هذا الدخول ----
  const st = trackingSourceStyle(L.source);
  let loginSec = `
    <div class="trk-dt-sec"><i class="f7-icons" style="color:#ec4899">location_north_line_fill</i> تفاصيل هذا الدخول</div>
    <div class="trk-dt-grid">
      <div class="trk-dt-row"><span class="trk-dt-lbl"><i class="f7-icons" style="color:${st.fg}">${st.icon}</i> المصدر:</span>
        <span class="trk-dt-val"><span class="trk-src" style="background:${st.bg};color:${st.fg}"><i class="f7-icons">${st.icon}</i>${esc(L.source || 'غير معروف')}</span></span></div>
      ${trkDtRow('search', '#f59e0b', 'كلمة البحث', L.search_query || '')}
      ${trkDtRow('link', '#10b981', 'الرابط القادم', L.referrer || '', true)}
      ${trkDtRow('signpost_right', '#0ea5e9', 'المسار الذي دخل إليه', L.landing || '', true)}
      ${trkDtRow('network', '#6366f1', 'عنوان IP', L.ip || '', true)}
      ${trkDtRow('globe_2', '#10b981', 'الدولة', L.country || 'غير معروف')}
      ${trkDtRow('mobile_vibration', '#8b5cf6', 'الجهاز / المتصفح', L.user_agent || '', true)}
      ${trkDtRow('clock', '#94a3b8', 'وقت الدخول', fmtTime(L.created_at))}
    </div>`;

  // ---- تفاصيل الحساب (إن وُجد) ----
  let userSec = '';
  if (U) {
    userSec = `
    <div class="trk-dt-sec"><i class="f7-icons" style="color:#8b5cf6">person_crop_circle_fill</i> تفاصيل الحساب</div>
    <div class="trk-dt-grid">
      ${trkDtRow('rosette', '#f59e0b', 'الصلاحية', rankNames[U.rank] || U.rank)}
      ${trkDtRow('money_dollar_circle', '#f59e0b', 'العضوية', membershipNames[U.membership] || U.membership)}
      ${trkDtRow('person_2', '#38bdf8', 'النوع', genderNames[U.gender] || U.gender)}
      ${trkDtRow('123', '#38bdf8', 'العمر', U.age ? U.age : '')}
      ${trkDtRow('globe_2', '#10b981', 'دولة الحساب', U.country || '')}
      ${trkDtRow('cube_box', '#f59e0b', 'الرصيد (ذهب)', U.balance)}
      ${trkDtRow('calendar', '#94a3b8', 'تاريخ إنشاء الحساب', fmtTime(U.created_at))}
      ${trkDtRow('arrow_uturn_left', '#6366f1', 'آخر دخول', fmtTime(d.stats ? d.stats.last_login : 0))}
      ${trkDtRow('list_number', '#6366f1', 'إجمالي عمليات الدخول', d.stats ? d.stats.logins : 0)}
      ${trkDtRow('message', '#ec4899', 'النبذة', U.bio || '')}
    </div>
    ${d.online && d.currentRooms.length ? `
    <div class="trk-dt-sec"><i class="f7-icons" style="color:#22c55e">antenna_radiowaves_left_right</i> الغرف المتواجد بها الآن</div>
    <div class="trk-dt-chips" style="margin-bottom:4px">${d.currentRooms.map(rm => `<span class="chip" style="background:#f0fdf4;color:#15803d">🏠 ${esc(rm.name)}</span>`).join('')}</div>` : ''}`;
  } else {
    userSec = `
    <div class="trk-dt-sec"><i class="f7-icons" style="color:#94a3b8">exclamationmark_triangle_fill</i> ملاحظة</div>
    <div class="empty-state" style="padding:14px;text-align:center;color:#64748b;font-size:12.5px">
      لا يوجد حساب مرتبط بهذا الدخول في قاعدة البيانات حالياً (حُذف أو أنه اسم زائر مؤقت لم يُنشأ له حساب).
      يمكنك حظر عنوان IP أدناه لمنع عودته.
    </div>`;
  }

  // ---- أدوات الحظر ----
  let banSec = `
    <div class="trk-dt-sec"><i class="f7-icons" style="color:#dc2626">slash_circle_fill</i> الحظر والإجراءات</div>
    <div class="trk-dt-actions">
      ${U ? `<button type="button" class="btn ${U.banned ? 'btn-green' : 'btn-red'}" data-act="ban-user">
        <i class="f7-icons">${U.banned ? 'arrow_uturn_left' : 'slash_circle_fill'}</i> ${U.banned ? 'فك الحظر عن الحساب' : '🚫 حظر المستخدم (الحساب + الجهاز)'}</button>` : ''}
      ${L.ip && L.ip !== 'غير معروف' ? `<button type="button" class="btn btn-red" data-act="ban-ip">
        <i class="f7-icons">network</i> 🌐 حظر IP + كل أجهزته (${esc(L.ip)})</button>` : ''}
    </div>
    <div class="trk-dt-note">
      الحظر يفصل المستخدم فوراً ويمنعه من العودة من نفس الحساب/IP/الجهاز حتى يتم فك الحظر من «قائمة الحظر».
      ${U && U.registered ? 'لأنه عضو مسجل فالأفضل «حظر المستخدم» — أما الزائر غير المسجل فيُحظر عبر IP وأجهزته.' : ''}
    </div>`;

  body.innerHTML = identity + loginSec + userSec + banSec;

  // ---- ربط الأزرار ----
  const banUserBtn = body.querySelector('[data-act="ban-user"]');
  if (banUserBtn) {
    banUserBtn.onclick = async () => {
      const willBan = !U.banned;
      const msg = willBan
        ? `حظر «${L.username}» نهائيّاً؟\nسيُفصل فوراً من الدردشة ولن يعود من نفس الحساب/الجهاز حتى فك الحظر.`
        : `فك الحظر عن «${L.username}»؟`;
      if (!confirm(msg)) return;
      try {
        await api(`/api/admin/users/${U.id}/ban`, 'POST', { banned: willBan ? 1 : 0, reason: 'حظر من صفحة تتبع المستخدمين' });
        toast(willBan ? 'تم حظر المستخدم وفصله فوراً 🚫' : 'تم فك الحظر عن المستخدم');
        closeTrackingDetail();
      } catch (e) { toast(e.error || 'تعذر تنفيذ الحظر', false); }
    };
  }
  const banIpBtn = body.querySelector('[data-act="ban-ip"]');
  if (banIpBtn) {
    banIpBtn.onclick = async () => {
      if (!confirm(`حظر نهائي لكل من يستخدم عنوان IP ${L.ip} وأجهزتهم؟\nسيتم فصل جميع اتصالاتهم فوراً.`)) return;
      try {
        const result = await api('/api/admin/ip/ban', 'POST', { ip: L.ip, reason: 'حظر من صفحة تتبع المستخدمين' });
        toast('تم حظر عنوان IP' + (result && result.devices ? ` و${result.devices} جهاز مرتبط به` : '') + ' وفصل جميع اتصالاتهم 🚫');
        closeTrackingDetail();
      } catch (e) { toast(e.error || 'تعذر حظر عنوان IP', false); }
    };
  }
}

async function refreshTeamMonitor() {
  try { updateTeamMonitor(await api('/api/admin/monitor')); } catch (e) { }
}

// ====== معرض «الصور الافتراضية» لاختيار صورة روبوت الغرفة ======
// قالب يُفتح فوق النموذج: مكتبة الرمزيات (الافتراضية/الطبيعة/اخرى) + صور الروبوتات المرفوعة سابقاً.
const RBA_FALLBACK = { def: 20, nature: 16, other: 16 };
let RBA_SEL = '';
async function openBotAvatarGallery() {
  const old = document.getElementById('rbaGalleryOv');
  if (old) old.remove();
  RBA_SEL = ($('#roomBotAvatarPath') && $('#roomBotAvatarPath').textContent.trim().startsWith('/'))
    ? $('#roomBotAvatarPath').textContent.trim() : '';
  const ov = document.createElement('div');
  ov.className = 'admin-modal-overlay rba-ov';
  ov.id = 'rbaGalleryOv';
  ov.innerHTML = `
    <div class="admin-modal-card rba-card">
      <div class="admin-modal-header">
        <div class="admin-modal-title">
          <div class="seo-ai-icon rba-icon"><i class="f7-icons">photo_on_rectangle</i></div>
          <div>
            <h3>الصور الافتراضية</h3>
            <p>اختر صورة الروبوت من المكتبة أو من الصور التي رفعتها</p>
          </div>
        </div>
        <button class="admin-modal-close" type="button" data-rba-close><i class="f7-icons">xmark</i></button>
      </div>
      <div class="rba-tabs">
        <button class="rba-tab active" type="button" data-rcat="def">الافتراضية</button>
        <button class="rba-tab" type="button" data-rcat="nature">الطبيعة</button>
        <button class="rba-tab" type="button" data-rcat="other">اخرى</button>
        <button class="rba-tab" type="button" data-rcat="bots">مرفوعاتي</button>
      </div>
      <div class="rba-body">
        <div class="rba-grid" id="rbaGrid"><div class="rba-loading"><i class="f7-icons">photo_stack</i> جاري تحميل الصور...</div></div>
      </div>
      <div class="rba-foot">
        <button class="btn btn-gray" type="button" data-rba-close><i class="f7-icons">xmark</i> إلغاء</button>
        <button class="btn btn-purple" type="button" id="rbaSave"><i class="f7-icons">checkmark</i> تحديد الصورة</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const close = () => ov.remove();
  ov.addEventListener('click', e => {
    if (e.target === ov || (e.target.closest && e.target.closest('[data-rba-close]'))) close();
  });

  const grid = ov.querySelector('#rbaGrid');
  const renderCat = async (cat) => {
    grid.innerHTML = '<div class="rba-loading"><i class="f7-icons">photo_stack</i> جاري تحميل الصور...</div>';
    let items = [];
    try {
      if (cat === 'bots') {
        items = (await api('/api/admin/bot-avatars')).map(x => x.path || x);
      } else {
        const rows = await api('/api/avatars?category=' + cat);
        items = (rows || []).map(x => x.path || x);
        if (!items.length) {
          const n = RBA_FALLBACK[cat] || 16;
          for (let i = 1; i <= n; i++) items.push(`/avatars/${cat}/${String(i).padStart(2, '0')}.jpg`);
        }
      }
    } catch (e) {
      if (cat === 'bots') items = [];
      else {
        const n = RBA_FALLBACK[cat] || 16;
        for (let i = 1; i <= n; i++) items.push(`/avatars/${cat}/${String(i).padStart(2, '0')}.jpg`);
      }
    }
    if (!items.length) {
      grid.innerHTML = `<div class="rba-empty"><i class="f7-icons">photo_on_rectangle</i>
        لا توجد صور مرفوعة بعد — استخدم زر «رفع صورة الروبوت» ثم عد إلى هنا</div>`;
      return;
    }
    grid.innerHTML = items.map(v =>
      `<div class="rba-cell${RBA_SEL === v ? ' sel' : ''}" data-v="${esc(v)}"><img src="${esc(v)}" alt="" loading="lazy"></div>`
    ).join('');
    grid.querySelectorAll('.rba-cell').forEach(c => c.onclick = () => {
      RBA_SEL = c.dataset.v;
      grid.querySelectorAll('.rba-cell').forEach(x => x.classList.toggle('sel', x === c));
    });
  };

  ov.querySelectorAll('.rba-tab').forEach(tab => tab.onclick = () => {
    ov.querySelectorAll('.rba-tab').forEach(x => x.classList.toggle('active', x === tab));
    renderCat(tab.dataset.rcat);
  });
  renderCat('def');

  const saveBtn = ov.querySelector('#rbaSave');
  saveBtn.onclick = () => {
    if (!RBA_SEL) return toast('اختر صورة من المعرض أولاً', false);
    const pathEl = $('#roomBotAvatarPath'), prevEl = $('#roomBotPreview');
    if (pathEl) pathEl.textContent = RBA_SEL;
    if (prevEl) prevEl.innerHTML = `<img src="${esc(RBA_SEL)}" alt="">`;
    close();
    toast('تم تحديد الصورة ✅');
  };
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
    const kindBadge = (bot.kind === 'visitor')
      ? '<span class="chip" style="background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0">👤 زائر عادي</span>'
      : '';
    return `
    <div class="room-bot-card${bot.active ? '' : ' inactive'}">
      <img class="room-bot-avatar" src="${esc(bot.avatar)}" alt="">
      <div class="room-bot-info">
        <b>${esc(bot.username)} ${bot.verified ? '<i class="f7-icons room-bot-verified">checkmark_seal_fill</i>' : ''}</b>
        <span>🏠 ${esc(bot.room_name || 'غرفة محذوفة')} • ${rankNames[bot.rank] || bot.rank} • ${membershipNames[bot.membership] || bot.membership}</span>
        <small>${bot.active ? '🟢 متواجد داخل الغرفة' : '⚪ متوقف وغير ظاهر'} • ${replyBadge} ${kindBadge}</small>
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
    const target = bots.find(item => item.id === +button.dataset.id);
    const withVisitor = target && target.kind !== 'visitor';
    if (!confirm(withVisitor
      ? 'حذف هذا الروبوت نهائياً؟\nسيُحذف معه «الزائر العادي» المولّد تلقائياً معه إن وُجد.'
      : 'حذف هذا الزائر نهائياً؟')) return;
    await api('/api/admin/room-bots/' + button.dataset.id, 'DELETE');
    toast('تم الحذف');
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
      <img src="${esc(e.img)}" alt="" style="width:48px;height:48px;object-fit:contain">
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
      ${soundRow('bubble_left_bubble_right_fill', '#14b8a6', 'صوت إشعار الرسالة الخاصة', 'snd_pm', 'يُشغَّل عند وصول رسالة خاصة جديدة والمحادثة غير مفتوحة.')}
      ${soundRow('bolt_badge_a_fill', '#ec4899', 'صوت إشعار الإعلان للجميع', 'snd_ntf', 'يُشغَّل عند وصول إعلان عام أو إشعار من الإدارة إلى جميع المستخدمين.')}
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
        ${SETTINGS.logo_url ? `<img src="${esc(SETTINGS.logo_url)}" alt="شعار الموقع" style="max-width:260px;max-height:120px" onerror="this.outerHTML='<div style=&quot;color:#9ca3af&quot;>تعذر تحميل الشعار</div>'">` : `<div style="font-size:20px;font-weight:800;color:#4f46e5">★ ${esc(SETTINGS.site_name || 'الدردشة')}</div>`}
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
        ? (ge.img.startsWith('/') ? `<img src="${esc(ge.img)}" alt="" style="width:54px;height:54px;object-fit:contain">` : `<span style="font-size:40px">${esc(ge.img)}</span>`)
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
        $('#gPrev').innerHTML = `<img src="${esc(d.path)}" alt="معاينة الهدية" style="width:54px;height:54px;object-fit:contain">`;
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
              ${u.avatar ? `<img class="avatar" src="${esc(u.avatar)}" alt="" style="width:36px;height:36px;border-radius:50%">` : `<span style="width:36px;height:36px;border-radius:50%;background:#312e81;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px"><i class="f7-icons">person_fill</i></span>`}
              <div>
                <div style="font-weight:800">${esc(u.username)}</div>
                <div style="display:flex;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap">
                  <img src="/badges/${u.badge}" alt="" style="width:18px;height:18px">
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
          ? `<img src="${esc(g.gift_img)}" alt="" style="width:34px;height:34px;object-fit:contain">`
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
            <img src="${esc(a.path)}" alt="إعلان" style="width:100%;height:100%;object-fit:cover">
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
            <div style="width:46px;height:46px;border-radius:10px;background:linear-gradient(135deg,#9c1f46,#d43d6e);display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;overflow:hidden">${r.image ? `<img src="${esc(r.image)}" alt="صورة الغرفة" style="width:100%;height:100%;object-fit:cover">` : '<i class="f7-icons">house_fill</i>'}</div>
            <div>
              <div style="font-weight:800;color:#111827">${esc(r.name)}</div>
              <div style="font-size:12.5px;color:#6b7280">${esc(r.description)}</div>
              <div style="display:flex;gap:7px;margin-top:5px;flex-wrap:wrap">
                <span class="chip">${r.type === 'voice' ? 'صوتية 🎙' : 'افتراضية 💬'}</span>
                <span class="chip">${r.max_users} مستخدم</span>
                <span class="chip" style="color:${r.status === 'open' ? '#059669' : '#dc2626'}">${r.status === 'open' ? '● مفتوحة' : '● مغلقة'}</span>
                ${r.password ? '<span class="chip" style="color:#d946a6">🔒 برقم سري</span>' : ''}
                ${r.audience === 'registered' ? '<span class="chip" style="color:#0ea5e9">👤 للأعضاء المسجلين فقط</span>' : ''}
                ${r.hidden ? '<span class="chip" style="background:#ede9fe;color:#6d28d9">🤖 غرفة SEO مخفية (لمحركات البحث)</span>' : ''}
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
        <div class="fgroup"><label><i class="f7-icons mi" style="color:#d946a6">dot_radiowaves_right</i> نوع الغرفة</label>
          <select class="inp" id="rType">
            <option value="voice" ${r.type === 'voice' ? 'selected' : ''}>🎙 صوتية — بث صوتي وزر «تحدث»</option>
            <option value="default" ${r.type !== 'voice' ? 'selected' : ''}>💬 افتراضية — كتابية فقط</option>
          </select></div>
      </div>
      <div class="fgroup"><label><i class="f7-icons mi" style="color:#0ea5e9">person_2_square_stack_fill</i> من يدخل الغرفة؟</label>
        <select class="inp" id="rAudience">
          <option value="all" ${r.audience !== 'registered' ? 'selected' : ''}>🌍 للجميع — الزوار والأعضاء المسجلون</option>
          <option value="registered" ${r.audience === 'registered' ? 'selected' : ''}>🔐 للأعضاء المسجلين فقط — الزائر لا يدخل</option>
        </select>
        <div style="font-size:11.5px;color:#9aa0b5;margin-top:5px">عند اختيار «للأعضاء المسجلين فقط» تُمنع حسابات الزوار من دخول الغرفة، وتظهر لهم رسالة تدعوهم لإنشاء حساب. الإدارة تدخل دائماً.</div></div>
      <div style="font-size:12.5px;color:#7b8495;font-weight:700;background:#f8f5ff;border:1px solid #e9ddff;border-radius:10px;padding:9px 13px;margin-top:10px">💡 الغرفة الصوتية: يظهر شريط البث وزر «تحدث» للصعود كمذيع. الغرفة الافتراضية: دردشة كتابية فقط — لا شريط بث ولا زر «تحدث».</div>
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
          <div id="roomImgPrev" style="width:64px;height:64px;border-radius:14px;background:linear-gradient(135deg,#9c1f46,#d43d6e);display:flex;align-items:center;justify-content:center;color:#fff;font-size:26px;overflow:hidden;flex:0 0 auto">${r.image ? `<img src="${esc(r.image)}" alt="صورة الغرفة" style="width:100%;height:100%;object-fit:cover">` : '<i class="f7-icons">house_fill</i>'}</div>
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
        $('#roomImgPrev').innerHTML = `<img src="${esc(d.path)}" alt="معاينة الغرفة" style="width:100%;height:100%;object-fit:cover">`;
        toast('تم رفع صورة الغرفة');
      };
      $('#saveRoomBtn').onclick = async () => {
        const imgPath = $('#roomImgPath').textContent.trim();
        const body = {
          name: $('#rName').value.trim(), description: $('#rDesc').value,
          welcome: $('#rWelcome').value.trim(),
          status: $('#rStatus').value, max_users: +$('#rMax').value || 1000, type: $('#rType').value === 'voice' ? 'voice' : 'default',
          audience: $('#rAudience').value === 'registered' ? 'registered' : 'all',
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
      const accountType = bot.kind === 'visitor' ? 'visitor' : 'robot';
      const botGender = bot.gender || 'secret';
      return `
      <div class="page-title"><i class="f7-icons mi" style="color:#7c3aed">person_badge_plus_fill</i> توليد وإعداد روبوت الغرفة</div>
      <div class="info-box" style="background:#ecfdf5;border-color:#a7f3d0;color:#065f46;margin-bottom:16px">
        <i class="f7-icons mi" style="color:#10b981">wand_stars</i>
        اختر <b>«زائر عادي»</b> من خيار نوع الحساب لتوليد زائر بلا أي شارة روبوت: اسم عربي طبيعي وصورة عشوائية
        إن تُركا فارغين، ويدخل الغرفة كأي زائر حقيقي. ويمكن تحديد <b>النوع (ذكر / أنثى / مجهول)</b> لكل حساب تولّده.
      </div>
      <div class="room-bot-form">
        <div class="room-bot-form-head">
          <div class="room-bot-preview" id="roomBotPreview">${bot.avatar ? `<img src="${esc(bot.avatar)}" alt="">` : '<i class="f7-icons">person_crop_circle_fill</i>'}</div>
          <div style="flex:1;min-width:0">
            <div class="room-bot-upload-row">
              <button class="btn btn-purple" id="roomBotUpload"><i class="f7-icons">photo_fill</i> رفع صورة الروبوت</button>
              <button class="btn btn-gray" id="roomBotGalleryBtn" type="button"><i class="f7-icons">photo_on_rectangle</i> الصور الافتراضية</button>
            </div>
            <input id="roomBotFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
            <div class="room-bot-path" id="roomBotAvatarPath">${esc(bot.avatar || 'لم تُرفع صورة بعد')}</div>
          </div>
        </div>
        <div class="inp-row"><label id="roomBotNameLabel">اسم الروبوت</label><input class="inp" id="roomBotName" maxlength="20" value="${esc(bot.username || '')}" placeholder="مثال: رفيق_الدردشة"></div>
        <div class="inp-row"><label>الغرفة التي يدخل إليها</label><select class="inp" id="roomBotRoom"><option value="">جاري تحميل الغرف...</option></select></div>
        <div class="grid2">
          <div class="inp-row"><label>نوع الحساب</label><select class="inp" id="roomBotAccountType">
            <option value="robot" ${accountType === 'robot' ? 'selected' : ''}>🤖 روبوت (شارة روبوت)</option>
            <option value="visitor" ${accountType === 'visitor' ? 'selected' : ''}>👤 زائر عادي (بلا شارة)</option>
          </select></div>
          <div class="inp-row"><label>النوع</label><select class="inp" id="roomBotGender">
            <option value="secret" ${botGender === 'secret' ? 'selected' : ''}>مجهول</option>
            <option value="boy" ${botGender === 'boy' ? 'selected' : ''}>ذكر</option>
            <option value="girl" ${botGender === 'girl' ? 'selected' : ''}>أنثى</option>
          </select></div>
        </div>
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
        
        <div class="inp-row" id="roomBotReplyRow">
          <label><i class="f7-icons mi" style="color:#6366f1">sparkles</i> وضع التحدث والرد في الغرفة :</label>
          <select class="inp" id="roomBotReplyMode">
            <option value="1" ${replyMode === 1 ? 'selected' : ''}>🤖 متحدث ذكي (يرد بالذكاء الاصطناعي عند مناداته بالاسم)</option>
            <option value="2" ${replyMode === 2 ? 'selected' : ''}>💬 متحدث برد مخصص (يرد بالنص المحدد عند مناداته بالاسم)</option>
            <option value="0" ${replyMode === 0 ? 'selected' : ''}>🔇 صامت (لا يتحدث ولا يرد أبداً)</option>
          </select>
        </div>

        <div class="inp-row" id="roomBotCustomRow" style="${replyMode === 2 && accountType !== 'visitor' ? '' : 'display:none'}">
          <label>الرد المخصص عند مناداة اسم الروبوت :</label>
          <input class="inp" id="roomBotReplyText" maxlength="120" value="${esc(bot.reply_text || 'نعم يا {name}؟')}" placeholder="مثال: نعم يا {name}؟">
        </div>

        <div class="room-bot-checks">
          <label><input type="checkbox" id="roomBotVerified" ${bot.verified ? 'checked' : ''}><span>حساب موثق</span><i class="f7-icons">checkmark_seal_fill</i></label>
          <label><input type="checkbox" id="roomBotActive" ${bot.active === 0 ? '' : 'checked'}><span>متواجد داخل الغرفة</span><i class="f7-icons">antenna_radiowaves_left_right</i></label>
        </div>
        <div class="btn-row" style="justify-content:flex-start">
          <button class="btn btn-purple" id="roomBotSave"><i class="f7-icons">wand_stars</i> ${bot.id ? 'حفظ التعديلات' : (accountType === 'visitor' ? 'توليد الزائر وإدخاله' : 'توليد الروبوت وإدخاله')}</button>
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

      // تبديل السلوك حسب نوع الحساب: زائر عادي (اسم وصورة اختياريان وصامت دائماً)
      // أو روبوت (اسم وصورة مطلوبان ويتحدث حسب الوضع المختار).
      const accountTypeSelect = $('#roomBotAccountType');
      const syncAccountTypeUi = () => {
        const isVisitor = accountTypeSelect.value === 'visitor';
        $('#roomBotNameLabel').textContent = isVisitor ? 'اسم الزائر (اختياري)' : 'اسم الروبوت';
        $('#roomBotName').placeholder = isVisitor
          ? 'اتركه فارغاً لتوليد اسم عربي طبيعي تلقائياً'
          : 'مثال: رفيق_الدردشة';
        $('#roomBotReplyRow').style.display = isVisitor ? 'none' : 'block';
        if (isVisitor) $('#roomBotCustomRow').style.display = 'none';
        else if (replyModeSelect && replyModeSelect.value === '2') $('#roomBotCustomRow').style.display = 'block';
        if (!EDIT_ROOM_BOT || !EDIT_ROOM_BOT.id) {
          const pathEl = $('#roomBotAvatarPath');
          const current = pathEl.textContent.trim();
          if (isVisitor && (!current || current === 'لم تُرفع صورة بعد' || !current.startsWith('/')))
            pathEl.textContent = 'ستُختار صورة عشوائية من المكتبة تلقائياً';
          else if (!isVisitor && current === 'ستُختار صورة عشوائية من المكتبة تلقائياً')
            pathEl.textContent = 'لم تُرفع صورة بعد';
          $('#roomBotSave').innerHTML = `<i class="f7-icons">wand_stars</i> ${isVisitor ? 'توليد الزائر وإدخاله' : 'توليد الروبوت وإدخاله'}`;
        }
      };
      if (accountTypeSelect) {
        accountTypeSelect.onchange = syncAccountTypeUi;
        syncAccountTypeUi();
      }

      $('#roomBotUpload').onclick = () => $('#roomBotFile').click();
      $('#roomBotFile').onchange = async () => {
        const file = $('#roomBotFile').files[0]; if (!file) return;
        const fd = new FormData(); fd.append('file', file);
        try {
          const uploaded = await api('/api/admin/upload/bot-avatar', 'POST', fd, true);
          $('#roomBotAvatarPath').textContent = uploaded.path;
          $('#roomBotPreview').innerHTML = `<img src="${esc(uploaded.path)}" alt="">`;
          toast('تم رفع الصورة');
        } catch (e) { toast(e.error || 'تعذر رفع الصورة', false); }
      };
      const galleryBtn = $('#roomBotGalleryBtn');
      if (galleryBtn) galleryBtn.onclick = () => openBotAvatarGallery();
      $('#roomBotSave').onclick = async () => {
        try {
          const avatarText = $('#roomBotAvatarPath').textContent.trim();
          const isCreate = !(EDIT_ROOM_BOT && EDIT_ROOM_BOT.id);
          const accountType = $('#roomBotAccountType') ? $('#roomBotAccountType').value : 'robot';
          const isVisitor = accountType === 'visitor';
          const saved = await api('/api/admin/room-bots', 'POST', {
            id: EDIT_ROOM_BOT && EDIT_ROOM_BOT.id,
            account_type: accountType,
            gender: $('#roomBotGender') ? $('#roomBotGender').value : 'secret',
            username: $('#roomBotName').value.trim(),
            avatar: avatarText.startsWith('/') ? avatarText : ((EDIT_ROOM_BOT && EDIT_ROOM_BOT.avatar) || ''),
            room_id: +$('#roomBotRoom').value,
            rank: $('#roomBotRank').value,
            membership: $('#roomBotMembership').value,
            verified: $('#roomBotVerified').checked,
            active: $('#roomBotActive').checked,
            reply_enabled: isVisitor ? 0 : +$('#roomBotReplyMode').value,
            reply_text: $('#roomBotReplyText') ? $('#roomBotReplyText').value : ''
          });
          EDIT_ROOM_BOT = null;
          if (isCreate && isVisitor && saved && saved.username) {
            toast(`تم توليد «زائر عادي» باسم ${saved.username} ✅`);
          } else if (isCreate) {
            toast('تم توليد الروبوت وإدخاله ⚡');
          } else {
            toast('تم حفظ التعديلات بنجاح ⚡');
          }
          loadPage('roomBots');
        } catch (e) { toast(e.error || 'تعذر الحفظ', false); }
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
              ${u.avatar ? `<img class="avatar" src="${esc(u.avatar)}" alt="" style="width:36px;height:36px;border-radius:50%">` : `<span style="width:36px;height:36px;border-radius:50%;background:#312e81;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px"><i class="f7-icons">person_fill</i></span>`}
              <div>
                <div style="font-weight:800">${esc(u.username)}</div>
                <div style="display:flex;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap">
                  <img src="/badges/${u.badge}" alt="" style="width:18px;height:18px">
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
              <span class="avatar-i">${u.avatar ? `<img class="avatar" src="${esc(u.avatar)}" alt="" style="width:34px;height:34px;border-radius:50%">` : '<i class="f7-icons">person_fill</i>'}</span>
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

  // ====== تتبع المستخدمين: من أين دخل كل مستخدم ======
  userTracking: {
    build: () => `
      <div class="page-title"><i class="f7-icons mi" style="color:#f472b6">location_north_line_fill</i> تتبع المستخدمين</div>
      <div class="info-box" style="background:#fdf2f8;border-color:#fbcfe8;color:#9d174d;margin-bottom:16px">
        سجل كامل لكل دخول إلى الدردشة: الاسم الذي دخل به، ومن أي رابط جاء، ومن أين دخل
        (Google أو فيسبوك أو دخول مباشر…)، وكلمة البحث إن توفّرت، وعنوان IP، والدولة.
      </div>
      <div id="trkSources" class="trk-sources"></div>
      <div class="section" style="margin-bottom:14px">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <input class="inp" id="trkSearch" placeholder="ابحث باسم المستخدم أو IP أو كلمة البحث أو الدولة..." style="flex:1;min-width:220px">
          <select class="inp" id="trkLimit" style="max-width:150px">
            <option value="200">آخر 200</option>
            <option value="500">آخر 500</option>
            <option value="1000">آخر 1000</option>
          </select>
          <button class="btn" id="trkRefresh"><i class="f7-icons">arrow2_circlepath</i> تحديث</button>
        </div>
      </div>
      <div id="trkList"><div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري تحميل سجل التتبع...</div></div>`,
    bind: async () => {
      const load = async () => {
        const box = $('#trkList');
        if (box) box.innerHTML = '<div class="loading"><i class="f7-icons">arrow2_circlepath</i>جاري التحميل...</div>';
        try {
          const search = encodeURIComponent(($('#trkSearch')?.value || '').trim());
          const limit = $('#trkLimit')?.value || 200;
          const d = await api(`/api/admin/user-tracking?limit=${limit}&search=${search}`);
          renderTrackingSources(d);
          renderTrackingRows(d);
        } catch (e) {
          if (box) box.innerHTML = `<div class="empty-state">تعذر تحميل سجل التتبع: ${esc(e.error || '')}</div>`;
        }
      };
      const btn = $('#trkRefresh'); if (btn) btn.onclick = load;
      const inp = $('#trkSearch');
      if (inp) {
        let t = null;
        inp.oninput = () => { clearTimeout(t); t = setTimeout(load, 350); };
        inp.onkeydown = (e) => { if (e.key === 'Enter') { clearTimeout(t); load(); } };
      }
      const lim = $('#trkLimit'); if (lim) lim.onchange = load;
      await load();
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
        fd.append('kind', 'favicon');
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
        fd.append('kind', 'favicon');
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
                ${p.favicon ? `<span class="chip" style="color:#7c3aed"><img src="${esc(p.favicon)}" alt="" style="width:13px;height:13px;vertical-align:-2px;margin-left:4px;border-radius:3px"> أيقونة خاصة</span>` : '<span class="chip" style="color:#94a3b8">⏳ أيقونة تلقائية</span>'}
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
          if (res && res.seo_room && res.seo_room.created) {
            setTimeout(() => toast(`تم إنشاء غرفة SEO مخفية باسم «${res.seo_room.name}» 🤖 — مرئية لمحركات البحث فقط`), 900);
          }
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
                contentHtml = `<a href="${esc(imgPath)}" target="_blank"><img src="${esc(imgPath)}" alt="صورة" style="max-width:200px;max-height:160px;border-radius:8px;display:block;margin-top:4px"></a>`;
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
        <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:11px;align-items:center">
          <button class="btn btn-purple btn-sm" id="seoFixBtn" type="button"><i class="f7-icons">wand_stars</i> إصلاح تلقائي شامل (تفريد العناوين + الغرف المخفية)</button>
          <span style="font-size:11px;color:#64748b">يعيد توليد عناوين/أوصاف المسارات المتضاربة تلقائياً وينشئ غرفة SEO مخفية لكل مسار</span>
        </div>
        <div style="margin-top:9px;font-size:11.5px;color:#64748b">
          خريطة الموقع: <a href="/sitemap.xml" target="_blank" style="color:#2563eb;font-weight:800">/sitemap.xml</a> &middot;
          ملف الروبوتات: <a href="/robots.txt" target="_blank" style="color:#2563eb;font-weight:800">/robots.txt</a>
          <span style="color:#94a3b8"> (يُحدَّثان تلقائياً مع كل مسار جديد)</span>
        </div>
      </div>`;
    const fixBtn = document.getElementById('seoFixBtn');
    if (fixBtn) fixBtn.onclick = async () => {
      if (!confirm('تشغيل الإصلاح الشامل؟\n\n• إعادة توليد عناوين وأوصاف المسارات المتضاربة (حتى نهاية العنوان المشتركة)\n• إنشاء غرفة SEO مخفية لكل مسار بلا غرفة\n• تحديث خريطة الموقع')) return;
      fixBtn.disabled = true; fixBtn.innerHTML = '<i class="f7-icons">arrow2_circlepath</i> جاري الفحص والإصلاح...';
      try {
        const r = await api('/api/admin/seo-fix-duplicates', 'POST', { mode: 'all' });
        const fixedN = (r.fixed || []).length, roomsN = (r.rooms_created || []).length;
        toast(`تم الإصلاح الشامل ✓ — عناوين مُعاد توليدها: ${fixedN} • غرف مخفية مُنشأة: ${roomsN}`);
        if (roomsN) {
          const names = (r.rooms_created || []).slice(0, 4).map(x => '«' + x.name + '»').join('، ');
          setTimeout(() => toast(`غرف SEO مخفية جديدة: ${names}${roomsN > 4 ? ' وغيرها' : ''} 🤖`), 1200);
        }
      } catch (e) { toast(e.error || 'تعذر تنفيذ الإصلاح', false); }
      renderSeoDuplicates();
    };
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
            ${item.user_avatar ? `<img src="${esc(item.user_avatar)}" alt="" style="width:100%;height:100%;object-fit:cover">` : '<i class="f7-icons" style="font-size:22px;color:#64748b">person_fill</i>'}
          </div>
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <b style="font-size:14.5px;color:#0f172a">${esc(item.username)}</b>
              <span class="chip" style="background:#fff7ed;color:#ea580c;font-weight:900"><img src="/badges/roomadmin.png" alt="" style="width:14px;height:14px;vertical-align:middle;margin-inline-end:3px"> أدمن غرفة</span>
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
