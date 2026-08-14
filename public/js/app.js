// =====================================================
//  شات نجوم العرب - واجهة المستخدم
// =====================================================
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let ME = null, MYBADGE = 'guest.png', SOCKET = null;
// رمز هوية خاص بهذه الصفحة فقط؛ لا يُحفظ في localStorage أو sessionStorage.
// عند التحديث أو فتح تبويب جديد يجب إدخال الاسم من جديد.
let CHAT_TOKEN = '';
let SETTINGS = { site_name: 'نجوم العرب', skin: 'default', font_size: '14', msg_max: 500, vip_cost: 30, premium_cost: 20, plus_cost: 10, show_smiles: '1', show_voice: '1', show_image: '1', snd_join: '1', snd_msg: '0', snd_leave: '1', show_time: '1' };
let PREFS = { snd_all: 1, snd_msg: 0, snd_join: 1, show_time: 1, pm_recv: 1 };
try { Object.assign(PREFS, JSON.parse(localStorage.getItem('prefs') || '{}')); } catch (e) { }
function savePrefs() { localStorage.setItem('prefs', JSON.stringify(PREFS)); }
let ROOMS = [], ROOM_COUNTS = {}, CUR_ROOM = null, CUR_TAB = 'default';
let ROOM_PWD = {};                       // كلمات مرور الغرف الصحيحة لهذه الجلسة (لا تُعاد كتابتها)
const isAdmRank = () => ME && (ME.rank === 'superadmin' || ME.rank === 'admin');
const canModerateRank = () => ME && ['superadmin', 'admin', 'roomadmin'].includes(ME.rank);
let ROOM_USERS = [], CUR_TARGET = null;
let GIFTS = [], SEL_GIFT = null, G_QTY = 1;
let UP_PLAN = 'vip', UP_MONTHS = 1, UP_TARGET = null;
let PM_WITH = null, PRIV_UNREAD = 0, PRIV_TAB = 'members';
let NOTIFS = [];
let SEL_AVATAR = null, AVA_CAT = 'def';
let STATUSES = [], STATUS_GROUP = [], STATUS_INDEX = 0, CURRENT_STATUS = null;
// قائمة التجاهل تُحمّل من الخادم وتبقى مرتبطة بالحساب.
let IGNORED_USERS = new Set();

// =====================================================
//  ترجمة واجهة الشات (العربية / English)
// =====================================================
let APP_LANG = localStorage.getItem('chat_language') === 'en' ? 'en' : 'ar';
const I18N_EN = {
  'دخول': 'Login', 'إنشاء حساب': 'Create account', 'الخروج': 'Logout', 'الافتراضية': 'Default', 'الصوتية': 'Voice',
  'لا يوجد احد في البث المباشر حي الان': 'No one is live right now', 'بث مباشر': 'Live', 'مغادرة الغرفة': 'Leave room', 'تحديث الغرف': 'Refresh rooms',
  'متصل الان': 'Online now', 'إيموجي': 'Emoji', 'قائمة الألوان': 'Colors',
  'الغرف': 'Rooms', 'الخاص': 'Private', 'الإشعارات': 'Notifications', 'القائمة': 'Menu',
  'الحالات': 'Statuses', 'حالتي': 'My status', 'اضغط لإضافة تحديث الحالة': 'Tap to add a status update', 'الحالات الحديثة': 'Recent updates',
  'جاري تحميل الحالات...': 'Loading statuses...', 'إضافة حالة': 'Add status', 'صورة': 'Photo', 'فيديو': 'Video', 'ملف صوتي': 'Audio', 'كتابة': 'Text',
  'تختفي الحالة تلقائياً بعد 24 ساعة': 'Your status disappears automatically after 24 hours', 'إلغاء': 'Cancel', 'حالة كتابية': 'Text status', 'نشر': 'Publish',
  'حالة صوتية': 'Audio status', 'المشاهدات': 'Views', 'حذف الحالة': 'Delete status', 'شاهد حالتي': 'Viewed my status', 'مشاهدة': 'view',
  'لغة الواجهة': 'Interface language', 'العربية': 'Arabic', 'عرض الواجهة باللغة العربية': 'Display the interface in Arabic', 'عرض الواجهة باللغة الإنجليزية': 'Display the interface in English', 'تغيير اللغة': 'Change language',
  'تسجيل الدخول': 'Sign in', 'دخول كزائر/ة': 'Continue as guest', 'نسيت كلمة السر؟': 'Forgot your password?', 'استعادة كلمة السر': 'Recover password',
  'لا يوجد لديك عضوية؟': 'Do not have an account?', 'إنشاء حساب مجانًا': 'Create a free account', 'النوع': 'Gender', 'ذكر': 'Male', 'أنثى': 'Female', 'مجهول': 'Unknown',
  'الرجاء قراءة': 'Please read', 'شروط الاستخدام': 'Terms of Use', 'وقراءة': 'and read', 'سياسة الخصوصية': 'Privacy Policy', 'تسجيل العضوية': 'Register account',
  'يتطلب الدخول باستخدام عضويتك أو تسجيل عضوية': 'Sign in or create an account', 'هذه الميزة متاحة للمستخدمين المسجلين فقط، قم بتسجيل عضوية مجانا الان': 'This feature is available to registered users only. Create a free account now.',
  'التسجيل الان': 'Register now', 'لاحقا': 'Later', 'عضو مسجل': 'Registered member', 'زائر': 'Guest', 'الرد على الرسالة': 'Reply to message',
  'دردشة خاصة': 'Private chat', 'ارسل هدية': 'Send gift', 'ترقية هذا المستخدم': 'Upgrade this user', 'تجاهل': 'Ignore', 'إلغاء التجاهل': 'Unignore',
  'كتم المستخدم': 'Mute user', 'إلغاء الكتم': 'Unmute', 'طرد المستخدم': 'Kick user', 'حظر المستخدم': 'Ban user', 'المعلومات الشخصية': 'Profile information', 'إغلاق': 'Close',
  'متجر الهدايا الافتراضية': 'Virtual gift store', 'فاخرة': 'Luxury', 'جواهر': 'Jewels', 'افتراضي': 'Default', 'هدية لـ :': 'Gift to:', 'اختر هدية': 'Choose a gift',
  'كمية :': 'Quantity:', 'تحتاج لتنفق :': 'You need to spend:', 'جائزة هذه الهدية :': 'Gift reward:', 'يحصل مستلم هذه الهدية على هذا الرصيد': 'The recipient receives this balance',
  'رصيدك الحالي :': 'Your current balance:', 'الغاء': 'Cancel', 'أرسل': 'Send', 'الترقية': 'Upgrade', 'قم بترقية عضوية الحساب لتبرز من بين الحشود !': 'Upgrade the account to stand out from the crowd!',
  'الترقية الى :': 'Upgrade to:', 'المدة بالأشهر :': 'Duration in months:', 'ترقية': 'Upgrade', 'حسابي': 'My account', 'الهدايا': 'Gifts', 'عودة': 'Back',
  'المحادثات الخاصة': 'Private conversations', 'الاعضاء المسجلين': 'Registered members', 'غير مرغوب فيه': 'Spam', 'القائمة الرئيسية': 'Main menu',
  'متصل': 'Online', 'رصيدك الحالي': 'Current balance', 'شراء رصيد': 'Buy credit', 'توثيق حسابي': 'Verify my account', 'ترقية حسابي': 'Upgrade my account',
  'تغيير الصورة': 'Change photo', 'هدايا حسابي': 'My gifts', 'قوائم الحظر': 'Block lists', 'الاعدادات': 'Settings', 'تسجيل الخروج': 'Sign out',
  'تغيير الحالة': 'Change status', 'مشغول': 'Busy', 'بالخارج': 'Away', 'حساب': 'Account', 'الطبيعة': 'Nature', 'اخرى': 'Other', 'رفع صورة': 'Upload photo',
  'اختيار هذه الصورة': 'Choose this photo', 'عام': 'General', 'تفعيل الصوت': 'Enable sound', 'صوت الرسائل الجديدة': 'New message sound',
  'صوت دخول المستخدمين': 'User join sound', 'اظهار الوقت في الرسائل': 'Show message time', 'استقبال الرسائل الخاصة': 'Receive private messages',
  'إشعارات': 'Notifications', 'نظام الكتم': 'Mute system', 'نظام الإشراف': 'Supervision system', 'احصل على توثيق دردشتي': 'Get verified', 'شارة تم التحقق ؟': 'Verification badge',
  'احصل على شارة تحقق خاصة تظهر بجوار اسمك أينما ظهر': 'Get a verification badge shown next to your name everywhere', 'حماية حسابك': 'Protect your account',
  'احم حسابك في مجتمعنا من مرسلي البريد العشوائي، لن نقبل التحقق من أي شخص آخر يشبه حسابك': 'Protect your account from impersonation and spam.',
  'الثقة والتميز': 'Trust and distinction', 'اجعل مجتمع دردشتي يثق بك وكن دائمًا مميز في المقدمة': 'Build trust in the community and always stand out.',
  'الصلاحية والرسوم': 'Validity and fees', 'الرسوم هي': 'The fee is', '10 ذهب': '10 Gold', 'افتراضي ومدة الصلاحية': 'and the validity period is', '3 أشهر': '3 months',
  'طلب التحقق من حسابي': 'Request account verification',
  'سيتم خصم رسوم إرسال قدرها 10 ذهب افتراضي، وفي حالة رفض إرسالك، سيتم إرجاع الرسوم إلى حسابك. بعد التحقق من حسابك سيكون التحقق الخاص بك صالحًا لمدة 3 أشهر، إذا انتهكت شروط الاستخدام الخاصة بنا فسيتم إلغاء حالة التحقق الخاصة بك ولن يتم استرداد الرسوم': 'A 10 Gold submission fee will be deducted. If your request is rejected, the fee will be returned. Verification remains valid for 3 months and may be revoked if the Terms of Use are violated.',
  'اشترِ الذهب الافتراضي لترقية حسابك أو حساب أصدقائك وإرسال الهدايا': 'Buy virtual gold to upgrade accounts and send gifts.',
  'شراء ذهب دردشتي الافتراضي': 'Buy virtual gold', 'من خلال شراء ذهب دردشتي الافتراضي، فإنك توافق على شروط الاستخدام الخاصة بنا بما في ذلك شرط التحكيم وسياسة الخصوصية الخاصة بنا': 'By purchasing virtual gold, you agree to our Terms of Use, arbitration provision, and Privacy Policy.', 'متابعة شراء': 'Continue purchase', 'هل انت متأكد تريد الخروج من هذه الغرفة ؟': 'Are you sure you want to leave this room?',
  'كلا': 'No', 'نعم': 'Yes', 'غرفة محمية': 'Protected room', 'غرفة «': 'Room “', '» محمية بكلمة مرور.': '” is password protected.', 'اكتب كلمة المرور للدخول:': 'Enter the room password:', '❌ كلمة المرور غير صحيحة — حاول مرة أخرى': '❌ Incorrect password — try again',
  'الحالة السابقة': 'Previous status', 'الحالة التالية': 'Next status',
  'قسم الشكاوي': 'Complaints', 'إرسال الشكوى': 'Send complaint', 'رسالة النظام': 'System message', 'إعلان من الإدارة': 'Admin announcement', 'نظام الهدايا': 'Gift system',
  'لا توجد غرف هنا': 'No rooms here', 'لا يوجد متصلون': 'No users online', 'لا توجد حالات حديثة بعد': 'No recent updates', 'تعذر تحميل الحالات': 'Could not load statuses',
  'لا توجد رسائل من الزوار': 'No messages from guests', 'لا توجد محادثات مع أعضاء مسجلين': 'No conversations with registered members',
  'لا يوجد رسائل خاصة بعد': 'No private messages yet', 'لا يوجد إشعارات بعد': 'No notifications yet', 'لا توجد هدايا بعد': 'No gifts yet',
  'إلغاء الطرد': 'Remove kick', 'أنت هنا': 'You are here', 'بحث عن غرف': 'Search rooms', 'بحث عن مستخدمين': 'Search users', 'ابحث عن غرفك': 'Search rooms',
  'رسالة عامة': 'Public message', 'رسالة': 'Message', 'اكتب حالتك...': 'Write your status...', 'الأسم المستعار': 'Display name', 'اسم المستعار': 'Display name',
  'الرقم السري': 'Password', 'العمر': 'Age', 'كلمة المرور': 'Password', 'موضوع الشكوى': 'Complaint subject', 'اكتب شكواك هنا...': 'Write your complaint here...',
  'جاري تحميل قائمة الغرف...': 'Loading rooms...', 'الرسائل': 'Messages', 'معلومات': 'Information', 'الإبلاغ': 'Report', 'إرسل ترقية': 'Send upgrade', 'إرسل هدية': 'Send gift',
  'دردشة': 'Chat', 'يتم عرض الهدايا التي يتلقاها هذا المستخدم هنا': 'Gifts received by this user appear here', 'أظهر المزيد': 'Show more',
  'تنفيذ وحفظ': 'Save changes', 'البريد الالكتروني': 'Email', 'الدولة / بلدة': 'Country / City', 'النبذة': 'Bio', 'حفظ': 'Save',
  'تلقائي': 'Automatic', 'قائمة التجاهل': 'Ignore list', 'إعدادات الإشعارات': 'Notification settings'
};
Object.assign(I18N_EN, {
  'مغلقة 🔒': 'Closed 🔒', 'لم يتلقَ هدايا بعد': 'No gifts received yet',
  'أنت متواجد في هذه الغرفة حالياً 📍': 'You are already in this room 📍', 'اختر غرفة أولا': 'Choose a room first', 'اختر هدية أولا': 'Choose a gift first',
  'اكتب الشكوى أولا': 'Write your complaint first', 'اكتب نص الحالة أولاً': 'Write your status first', 'انتهت هذه الحالة': 'This status has expired',
  'تعذر إرسال الطلب': 'Could not send the request', 'تعذر الإرسال': 'Could not send', 'تعذر الحفظ': 'Could not save', 'تعذر الدخول للغرفة': 'Could not enter the room',
  'تعذر الشراء': 'Purchase failed', 'تعذر تغيير حالة الكتم': 'Could not change mute status', 'تعذر حذف الحالة': 'Could not delete status', 'تعذر حفظ الصورة': 'Could not save photo',
  'تعذر رفع الصورة': 'Could not upload photo', 'تعذر طرد المستخدم': 'Could not kick user', 'تعذر فتح الحالة': 'Could not open status', 'تعذر فتح الملف الشخصي': 'Could not open profile',
  'تعذر نشر الحالة': 'Could not publish status', 'تعذرت الترقية': 'Upgrade failed', 'تم إرسال الشكوى للإدارة ✅': 'Complaint sent to the administration ✅',
  'تم إرسال الصورة 📷': 'Photo sent 📷', 'تم إرسال طلب التوثيق للإدارة ✓ (خصم 10 ذهب)': 'Verification request sent ✓ (10 Gold deducted)',
  'تم الحفظ بنجاح ✅': 'Saved successfully ✅', 'تم تحديث قائمة الغرف ✓': 'Room list refreshed ✓', 'تم تسجيل عضويتك بنجاح 🎉': 'Account registered successfully 🎉',
  'تم تغيير اللغة إلى العربية': 'Language changed to Arabic', 'تم تغيير لون خطك 🎨': 'Text color changed 🎨', 'تم حذف الحالة': 'Status deleted',
  'تم حظرك بواسطة الإدارة': 'You were banned by the administration', 'تم حفظ الاعدادات ✓': 'Settings saved ✓', 'تم حفظ الصورة ✅': 'Photo saved ✅',
  'تم رفع الصورة وحفظها ✅': 'Photo uploaded and saved ✅', 'تم طردك من الغرفة': 'You were kicked from the room', 'تم نشر حالتك لمدة 24 ساعة ✓': 'Your status was published for 24 hours ✓',
  'تمت الإضافة لقائمة التجاهل 🚫': 'Added to the ignore list 🚫', 'جاري نشر الحالة...': 'Publishing status...', 'حجم الملف أكبر من 50MB': 'File is larger than 50MB',
  'حساب إداري': 'Admin account', 'رجع لون خطك للون رتبتك': 'Text color reset to your rank color', 'ادمن': 'Admin', 'ادمن غرفة': 'Room admin', 'سوبر ادمين': 'Super admin',
  'عضوية Plus': 'Plus membership', 'عضوية Premium': 'Premium membership', 'عضوية النخبة': 'VIP membership', 'عضوية مميز': 'Special membership',
  'غير متصل': 'Offline', 'فشل التسجيل': 'Registration failed', 'فشل الدخول': 'Login failed', 'نوع الملف لا يطابق نوع الحالة المختار': 'The file does not match the selected status type',
  'الأردن': 'Jordan', 'السعودية': 'Saudi Arabia', 'مصر': 'Egypt', 'العراق': 'Iraq', 'فلسطين': 'Palestine', 'الإمارات': 'UAE', 'الكويت': 'Kuwait',
  'قطر': 'Qatar', 'البحرين': 'Bahrain', 'سلطنة عمان': 'Oman', 'سوريا': 'Syria', 'لبنان': 'Lebanon', 'الجزائر': 'Algeria', 'المغرب': 'Morocco',
  'تونس': 'Tunisia', 'ليبيا': 'Libya', 'اليمن': 'Yemen', 'السودان': 'Sudan',
  'التكلفة المقترحة :': 'Suggested cost:', 'إرسال طلب الترقية': 'Send upgrade request', 'الموافقة والرسوم': 'Approval and fees',
  'الإدارة تحدد مقدار الذهب النهائي عند الموافقة • رصيدك الحالي :': 'The administration sets the final Gold amount upon approval • Current balance:',
  'التكلفة المقترحة': 'Suggested cost', 'وتستطيع الإدارة تحديد مقدار الذهب النهائي عند الموافقة': 'and the administration may set the final Gold amount upon approval', '، وتستطيع الإدارة تحديد مقدار الذهب النهائي عند الموافقة': ', and the administration may set the final Gold amount upon approval',
  'لن يتم خصم أي ذهب عند إرسال الطلب. يصل اسمك إلى لوحة الإدارة، وبعد مراجعة الطلب تختار الإدارة مقدار الذهب ثم توافق على التوثيق أو ترفضه، وسيصلك إشعار بالنتيجة.': 'No Gold is deducted when submitting. The administration reviews your request, chooses the Gold amount, and then approves or rejects it. You will be notified of the result.',
  'الهدايا المستلمة': 'Received gifts', 'جميع الهدايا التي أرسلها الأعضاء إلى حسابك': 'All gifts members sent to your account',
  'قائمة التجاهل': 'Ignore list', 'لا يمكن تبادل الرسائل الخاصة بينك وبين الأشخاص المتجاهلين.': 'Private messages are disabled between you and ignored users.',
  'إلغاء التجاهل': 'Unignore', 'قائمة التجاهل فارغة': 'Your ignore list is empty', 'جاري تحميل قائمة التجاهل...': 'Loading ignore list...',
  'جاري تحميل الهدايا...': 'Loading gifts...', 'لم تستلم أي هدايا بعد': 'You have not received any gifts yet', 'تعذر تحميل الهدايا': 'Could not load gifts',
  'من:': 'From:', 'متجاهل • الرسائل الخاصة متوقفة': 'Ignored • private messages disabled', 'تم إغلاق المحادثة بسبب التجاهل': 'The conversation was closed because of the ignore setting'
});
const I18N_SKIP_SELECTOR = '.mtext,.pm-tx,.stext,.room-name,.room-desc,.uname,.mname,#statusViewerText,#statusTextInput,#siteName,.head-name,.us-userinfo,.vp-name,.prof-name,.pm-peer,.pm-hero-name,.sv-info,.room-welcome-text,.robot-system-text,.my-gift-card h4,.my-gift-card b,.blocked-user-info b';
function translateDynamicText(text) {
  if (I18N_EN[text]) return I18N_EN[text];
  let match = text.match(/^مرحباً بـ (.+) في غرفة (.+)$/);
  if (match) return `Welcome ${match[1]} to ${match[2]}`;
  match = text.match(/^(.+) خرج من الغرفة$/);
  if (match) return `${match[1]} left the room`;
  match = text.match(/^تم كتم (.+) بواسطة (.+)$/);
  if (match) return `${match[1]} was muted by ${match[2]}`;
  match = text.match(/^تم إلغاء كتم (.+) بواسطة (.+)$/);
  if (match) return `${match[1]} was unmuted by ${match[2]}`;
  match = text.match(/^تم تجاهل (.+) ومنع الرسائل الخاصة بينكما$/);
  if (match) return `${match[1]} was ignored and private messages were disabled`;
  if (text.startsWith('الكمية: ')) return 'Quantity: ' + text.slice('الكمية: '.length);
  if (text.startsWith('اليوم الساعة ')) return 'Today at ' + text.slice('اليوم الساعة '.length);
  if (text.startsWith('أمس الساعة ')) return 'Yesterday at ' + text.slice('أمس الساعة '.length);
  if (text.startsWith('آخر تحديث ')) return 'Last update ' + translateDynamicText(text.slice('آخر تحديث '.length));
  if (text.startsWith('متصل الان ')) return 'Online now ' + text.slice('متصل الان '.length);
  if (text.startsWith('تم كتم ')) return 'Muted ' + text.slice('تم كتم '.length);
  if (text.startsWith('تم إلغاء كتم ')) return 'Unmuted ' + text.slice('تم إلغاء كتم '.length);
  if (text.startsWith('تم طرد ')) return 'Kicked ' + text.slice('تم طرد '.length);
  if (text.startsWith('تم حظر ')) return 'Banned ' + text.slice('تم حظر '.length);
  if (text.startsWith('تم تجاهل ')) return 'Ignored ' + text.slice('تم تجاهل '.length);
  if (text.startsWith('تم إلغاء تجاهل ')) return 'Unignored ' + text.slice('تم إلغاء تجاهل '.length);
  if (text.startsWith('مرحبا بك ')) return 'Welcome ' + text.slice('مرحبا بك '.length);
  if (text.startsWith('أهلا بك كزائر ')) return 'Welcome, guest ' + text.slice('أهلا بك كزائر '.length);
  if (text.startsWith('رصيد: ')) return 'Balance: ' + text.slice('رصيد: '.length);
  if (text.startsWith('تم تغيير الحالة إلى ')) return 'Status changed to ' + translateDynamicText(text.slice('تم تغيير الحالة إلى '.length));
  if (text.startsWith('غرفة مستخدمين ')) return 'Users room: ' + text.slice('غرفة مستخدمين '.length);
  if (text.startsWith('إبلاغ عن ')) return 'Report ' + text.slice('إبلاغ عن '.length);
  if (text.endsWith(' حسب عنوان IP')) return translateDynamicText(text.slice(0, -' حسب عنوان IP'.length)) + ' by IP address';
  if (text.endsWith(' من الغرفة')) return translateDynamicText(text.slice(0, -' من الغرفة'.length)) + ' from the room';
  return text;
}
function shouldSkipTranslation(node) {
  const el = node.nodeType === 1 ? node : node.parentElement;
  return !el || !!el.closest('script,style,' + I18N_SKIP_SELECTOR);
}
function translateTextNode(node) {
  if (!node || node.nodeType !== 3 || shouldSkipTranslation(node)) return;
  if (node.__arabicSource === undefined) node.__arabicSource = node.nodeValue;
  const source = node.__arabicSource;
  const match = source.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const core = match ? match[2] : source;
  const translated = APP_LANG === 'en' ? translateDynamicText(core) : core;
  const next = (match ? match[1] : '') + translated + (match ? match[3] : '');
  if (node.nodeValue !== next) node.nodeValue = next;
}
function translateAttributes(el) {
  if (!el || el.nodeType !== 1 || shouldSkipTranslation(el)) return;
  el.__arabicAttrs = el.__arabicAttrs || {};
  for (const attr of ['placeholder', 'title', 'aria-label']) {
    if (!el.hasAttribute(attr)) continue;
    if (el.__arabicAttrs[attr] === undefined) el.__arabicAttrs[attr] = el.getAttribute(attr);
    const source = el.__arabicAttrs[attr];
    el.setAttribute(attr, APP_LANG === 'en' ? translateDynamicText(source) : source);
  }
}
function applyLanguage(root = document.body) {
  if (!root) return;
  if (root.nodeType === 3) return translateTextNode(root);
  translateAttributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) node.nodeType === 3 ? translateTextNode(node) : translateAttributes(node);
}
let LANGUAGE_OBSERVER = null;
function setLanguage(language, save = true) {
  APP_LANG = language === 'en' ? 'en' : 'ar';
  if (save) localStorage.setItem('chat_language', APP_LANG);
  document.documentElement.lang = APP_LANG;
  document.documentElement.dir = APP_LANG === 'ar' ? 'rtl' : 'ltr';
  document.title = APP_LANG === 'en' ? 'Arab Stars Chat' : 'شات نجوم العرب';
  document.body.classList.toggle('lang-en', APP_LANG === 'en');
  $$('.language-option').forEach(b => b.classList.toggle('active', b.dataset.language === APP_LANG));
  const currentLanguage = $('#currentLanguageLabel');
  if (currentLanguage) currentLanguage.textContent = APP_LANG === 'en' ? 'English' : 'العربية';
  applyLanguage(document.body);
}
function initLanguage() {
  setLanguage(APP_LANG, false);
  if (!LANGUAGE_OBSERVER) {
    LANGUAGE_OBSERVER = new MutationObserver(mutations => {
      for (const mutation of mutations) for (const node of mutation.addedNodes) applyLanguage(node);
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
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(msg, ok = true) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.background = ok ? '#111827e6' : '#dc2626e6';
  t.classList.add('show');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove('show'), 2400);
}
function openOv(id) { $('#' + id).classList.add('open'); refreshNav(); }
function closeOv(id) { $('#' + id).classList.remove('open'); refreshNav(); }
function refreshNav() {
  const navPages = { menuOv: 'menu', notifOv: 'notifs', privOv: 'private' };
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
const RANK_NAMES = { superadmin: 'سوبر ادمين', admin: 'ادمن', roomadmin: 'ادمن غرفة', user: '' };
function badgeOf(u) {
  if (!u) return 'guest.png';
  if (u.badge) return u.badge;
  if (u.rank === 'superadmin') return 'superadmin.png';
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
const DEFAULT_BIO = 'اذا صعدت الي الجبل فانظر الي القمة ولا تنظر الي الصخور المتناثرة من حولك اصعد بخطوات ثابتة ولا تتقفز فتزل قدمك';
function rankWeight(u) {
  if (!u) return 1;
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
  if (u.rank === 'superadmin' || u.rank === 'admin') return '#000000';   // أسود عريض
  if (u.rank === 'roomadmin') return '#e03131';                          // أحمر
  if (u.membership === 'mmez') return '#e91e8c';                         // زهري
  if (u.membership === 'vip') return '#1479f2';                          // أزرق
  if (u.membership === 'plus') return '#2e9e44';                         // أخضر
  if (u.membership === 'premium') return '#38b6ff';                      // أزرق فاتح
  if (u.registered) return '#795548';                                    // بني (مسجل)
  return '#000000';                                                      // زائر أسود رقيق
}
function userWeight(u) {
  if (u && (u.rank === 'superadmin' || u.rank === 'admin')) return 900;  // عريض
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

// =====================================================
//  الإقلاع
// =====================================================
(async function init() {
  initLanguage();
  try { SETTINGS = await api('/api/public-settings'); } catch (e) { }
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
  document.body.className = 'skin-' + (SETTINGS.skin || 'default') + (APP_LANG === 'en' ? ' lang-en' : '');
  $('#siteName').textContent = SETTINGS.site_name || 'نجوم العرب';
  if (SETTINGS.logo_url) {
    $('#siteLogo').innerHTML = `<img src="${esc(SETTINGS.logo_url)}" alt="">`;
  }
  if (SETTINGS.show_smiles !== '1') $('#btnEmoji').style.display = 'none';
  if (SETTINGS.show_voice !== '1') $('#btnMic').style.display = 'none';
  if (SETTINGS.show_image !== '1') $('#btnCam').style.display = 'none';
}
function applyPrefsToSwitches() {
  $$('#setList .switch').forEach(sw => {
    const k = sw.dataset.set;
    sw.classList.toggle('on', !!PREFS[k]);
  });
}

function connectSocket() {
  if (!ME || !CHAT_TOKEN) return;
  // هوية هذه الصفحة تنتقل إلى الخادم عبر WebSocket ولا تعتمد على كوكي مشترك بين التبويبات.
  SOCKET = io({ auth: { client: 'chat', token: CHAT_TOKEN } });
  // عند إعادة الاتصال (مثل بعد تسجيل اسم جديد) نعود للغرفة الحالية مباشرة فيُحدَّث الاسم للجميع
  SOCKET.on('connect', () => { if (CUR_ROOM) SOCKET.emit('join', CUR_ROOM.id, ROOM_PWD[CUR_ROOM.id] || ''); });
  SOCKET.on('msg', (m) => {
    if (CUR_ROOM && m.room_id === CUR_ROOM.id) {
      renderMsg(m);
      scrollBottom();
      if (m.type === 'join' && PREFS.snd_join && SETTINGS.snd_join === '1') beep(520, .1);
      else if (m.type === 'msg' && PREFS.snd_msg && SETTINGS.snd_msg === '1') beep(740, .07);
    }
  });
  SOCKET.on('roomUsers', ({ roomId, users, count }) => {
    if (CUR_ROOM && roomId === CUR_ROOM.id) { ROOM_USERS = users; renderUsers(); }
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
      pushNotif('chat_bubble2_fill', `رسالة خاصة من ${p.from_name}`);
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
    pushNotif(n.icon, n.text); toast(n.text); beep(880, .15);
  });
  // مزامنة فورية: أي تعديل من لوحة الإدارة يطبَّق مباشرة دون تحديث الصفحة
  SOCKET.on('sync', async () => {
    try { SETTINGS = await api('/api/public-settings'); applySettings(); } catch (e) { }
    try { GIFTS = await api('/api/gifts'); } catch (e) { }
    loadCustomEmojis();
    loadRooms();          // تحديث قائمة الغرف واللوحة المضغوطة داخل الغرفة
    if (typeof renderRoomsPanel === 'function') renderRoomsPanel();
  });
  SOCKET.on('announce', (a) => {
    pushNotif('bolt_badge_a_fill', '📢 ' + a.text);
    showAnnounce(a.text);
    beep(660, .2);
  });
  SOCKET.on('membership_changed', ({ plan }) => { if (ME) { ME.membership = plan; MYBADGE = badgeOf(ME); } });
  SOCKET.on('statuses_changed', () => {
    if ($('#statusOv').classList.contains('open')) loadStatuses();
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
    setTimeout(() => location.reload(), 2200);
  });
  SOCKET.on('err', (t) => toast(t, false));
}
function showAnnounce(text) {
  const b = $('#announceBar');
  b.textContent = '📢 ' + text;
  b.style.display = 'block';
  clearTimeout(b._tm);
  b._tm = setTimeout(() => b.style.display = 'none', 6000);
}
function pushNotif(icon, text) {
  NOTIFS.unshift({ icon, text, at: Date.now() });
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
function roomRowHtml(r) {
  const online = ROOM_COUNTS[r.id] || 0;
  return `
  <div class="room-row" data-id="${r.id}">
    ${roomImgHtml(r)}
    <div class="room-info">
      <div class="room-name">${esc(r.name)} ${r.locked ? '<i class="f7-icons" style="font-size:13px;color:#d946a6">lock_fill</i>' : ''}${r.status !== 'open' ? ' <span style="font-size:11px;color:#dc2626;font-weight:800">مغلقة 🔒</span>' : ''}</div>
      <div class="room-desc">${esc(r.description || 'اهلا وسهلا بكم في شات نجوم العرب ★')}</div>
    </div>
    <div class="room-side">
      <div class="room-count"><i class="f7-icons">person2_fill</i><b>${online}</b>/${r.max_users}</div>
      <i class="f7-icons room-chev">chevron_right</i>
      <div class="room-feats"><i class="f7-icons">photo_fill</i><i class="f7-icons">videocam_fill</i></div>
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
      ${isCur ? '<span class="rm-here">أنت هنا</span>' : `<span class="rm-count"><i class="f7-icons">person2_fill</i>${online}/${r.max_users}</span>`}
      <i class="f7-icons rm-chev">chevron_right</i>
    </div>
  </div>`;
}
function renderRoomsPanel() {
  const q2 = ($('#roomSearch2').value || '').trim();
  const tab2 = ($('.r-tab2.active') || {}).dataset ? $('.r-tab2.active').dataset.tab : 'voice';
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
function enterRoom(id, pwd) {
  if (!ME) { openLogin(); return; }
  const r = ROOMS.find(x => x.id === id);
  if (!r) return;
  if (r.status !== 'open' && !isAdmRank()) return toast('🔒 هذه الغرفة مغلقة حالياً');
  const adm = isAdmRank();
  const pass = adm ? '' : (pwd || ROOM_PWD[id] || '');
  if (r.locked && !adm && !pass) { openPassOv(r); return; }   // اطلب كلمة السر قبل الدخول
  if (pass) ROOM_PWD[id] = pass;
  CUR_ROOM = r;
  $('#chatRoomName').textContent = r.name;
  $('#roomNotice').textContent = 'لا يوجد احد في البث المباشر حي الان';
  $('#msgArea').innerHTML = '';
  showScreen('chat');
  setRoomsPanel(false);
  $('#roomsVeil').style.display = 'none';
  SOCKET.emit('join', id, pass, (res) => {
    if (res && res.ok) {
      // لا نحمّل سجل الرسائل القديم؛ العام يبدأ فارغاً ويظهر فقط ترحيب الغرفة من الإدارة.
      api('/api/rooms/' + id + '/users').then(u => { ROOM_USERS = u; renderUsers(); });
      return;
    }
    // رُفض الدخول (كلمة مرور خاطئة/غرفة مغلقة/مطرود) — نرجع لقائمة الغرف
    delete ROOM_PWD[id];
    leaveRoom();
    showScreen('rooms');
    if (res.reason === 'password') openPassOv(r, false);
    else if (res.reason === 'wrong_pass') openPassOv(r, true);
    else if (res.reason === 'kicked') toast(res.text || '🚫 أنت مطرود من هذه الغرفة', false);
    else toast(res.text || 'تعذر الدخول للغرفة', false);
  });
}
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
    const weight = userWeight(u);
    const uname = m.username || u.username || '';
    const rp = m.reply || u.reply || null;   // اقتباس «الرد على الرسالة»
    const tcol = m.color || u.color || null;  // لون خط مخصص من قائمة الألوان
    const tsize = Math.min(40, Math.max(12, +(m.size || u.size || 0))) || null;   // حجم خط مخصص (الروبوت)
    const isCustomEmoji = typeof m.text === 'string' && m.text.startsWith('em::');
    el.className = 'msg';
    el.innerHTML = `
      <div class="mava">${avatarHtml(u.avatar)}</div>
      <div class="mbody">
        <div class="mline1">
          <span class="mname" data-username="${esc(uname)}" style="color:${color};font-weight:${weight}">${esc(uname)}${u.verified ? ' <i class="f7-icons vcheck">checkmark_seal_fill</i>' : ''}</span>
          ${(SETTINGS.show_time === '1' && PREFS.show_time) ? `<span class="mtime">${t}</span>` : ''}
        </div>
        ${rp ? `<span class="mrply" dir="rtl"><i class="f7-icons">arrowshape_turn_up_left_fill</i>${esc(rp.name)}: ${esc(rp.text)}</span>` : ''}
        <div class="mline2">
          ${(badge && badge !== 'register.png' && badge !== 'guest.png') ? `<img class="mmark" src="/badges/${badge}" alt="">` : ''}
          ${isCustomEmoji
            ? `<img class="mcustom-emoji" src="${esc(m.text.slice(4))}" alt="emoji">`
            : `<span class="mtext" style="color:${tcol || color};font-size:${tsize || SETTINGS.font_size || 14}px">${esc(m.text)}</span>`}
        </div>
      </div>`;
    // النقر على صورة الرسالة يفتح ورقة المستخدم (ومن بينها «الرد على الرسالة»)
    el.querySelector('.mava').onclick = () => {
      const uid = m.user_id || (m.user && m.user.id);
      if (uid) openUserSheet(+uid, { text: m.text, username: uname, avatar: u.avatar, rank: u.rank, membership: u.membership, gender: u.gender, registered: u.registered, muted: u.muted });
    };
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
  } else if (m.type === 'gift') {
    const ex = parseExtra(m);
    const vis = ex.img || ex.emoji || '🎁';   // صورة مرفوعة أو إيموجي
    const gImg = vis.startsWith('/') ? `<img src="${esc(vis)}" alt="">` : `<span>${esc(vis)}</span>`;
    el.className = 'sys gift-block';
    el.innerHTML = `
      <div class="gm-card">
        <div class="gm-l"><span class="gm-imgw">${gImg}</span><span class="gm-name">${esc(ex.name || 'هدية')}</span></div>
        <div class="gm-r">
          <div class="gm-line b" dir="rtl">${esc(ex.from || m.username)}</div>
          <div class="gm-line" dir="rtl">أرسل هدية إلى</div>
          <div class="gm-line b" dir="rtl">${esc(ex.to || '')}</div>
          <div class="gm-qty" dir="rtl">كمية: <b>${ex.qty || 1}</b></div>
        </div>
      </div>
      <div class="gm-sys">
        <div class="gm-st" dir="rtl">🎁 نظام الهدايا</div>
        <div class="gm-sb" dir="rtl">${esc(ex.from || m.username)} أرسل الى ${esc(ex.to || '')} ${ex.qty || 1} ${esc(ex.name || '')}</div>
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
function syncUserActionSheet() {
  if (!CUR_TARGET) return;
  $('#usAvatar').innerHTML = avatarHtml(CUR_TARGET.avatar);
  $('#usName').textContent = CUR_TARGET.username;
  $('#usMembership').textContent = userSheetMembership(CUR_TARGET);
  $('#usIgnoreLabel').textContent = IGNORED_USERS.has(+CUR_TARGET.id) ? 'إلغاء التجاهل' : 'تجاهل';
  $('#usMuteLabel').textContent = CUR_TARGET.muted ? 'إلغاء الكتم' : 'كتم المستخدم';
  $('#usMuteIcon').textContent = CUR_TARGET.muted ? 'mic_fill' : 'mic_slash_fill';
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
$('#usUpgrade').onclick = () => { closeOv('userSheet'); if (!ME.registered) return openOv('needRegOv'); openUpgrade(CUR_TARGET); };
$('#usIgnore').onclick = async () => {
  if (!CUR_TARGET) return;
  const target = CUR_TARGET;
  const uid = +target.id;
  const nextIgnored = !IGNORED_USERS.has(uid);
  const button = $('#usIgnore');
  button.disabled = true;
  try {
    await api('/api/ignore/' + uid, 'POST', { ignored: nextIgnored });
    if (nextIgnored) {
      IGNORED_USERS.add(uid);
      toast('تم تجاهل ' + target.username + ' ومنع الرسائل الخاصة بينكما');
    } else {
      IGNORED_USERS.delete(uid);
      toast('تم إلغاء تجاهل ' + target.username);
    }
    syncUserActionSheet();
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
  try {
    const d = await api(`/api/admin/users/${target.id}/mute`, 'POST', { muted: nextMuted, room_id: CUR_ROOM ? CUR_ROOM.id : 0 });
    target.muted = d.muted ? 1 : 0;
    const roomUser = ROOM_USERS.find(u => u.id === target.id);
    if (roomUser) roomUser.muted = target.muted;
    syncUserActionSheet();
    toast((target.muted ? `تم كتم ${target.username}` : `تم إلغاء كتم ${target.username}`) + (d.by_ip ? ' حسب عنوان IP' : ''));
  } catch (e) { toast(e.error || 'تعذر تغيير حالة الكتم', false); }
  finally { button.disabled = false; }
};
$('#usKick').onclick = async () => {
  if (!CUR_TARGET || !CUR_ROOM || !canModerateRank()) return toast('لا تملك صلاحية الطرد', false);
  const target = CUR_TARGET;
  const button = $('#usKick');
  button.disabled = true;
  try {
    const d = await api(`/api/admin/users/${target.id}/kick`, 'POST', { room_id: CUR_ROOM.id });
    closeOv('userSheet');
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
    const d = await api('/api/gifts/send', 'POST', { to_id: CUR_TARGET.id, gift_id: SEL_GIFT.id, qty: G_QTY, room_id: CUR_ROOM ? CUR_ROOM.id : 0 });
    ME.balance = d.balance;
    $('#gBal').textContent = d.balance;
    toast(`تم إرسال ${SEL_GIFT.name} بنجاح 🎉`);
    closeOv('giftOv');
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
  UP_TARGET = target;
  UP_MONTHS = 1;
  $('#upQty').textContent = 1;
  $('#upToName').textContent = target.username;
  $('#upBal').textContent = ME.balance;
  renderUpCards();
  openOv('upOv');
}
function renderUpCards() {
  $('#upCards').innerHTML = PLANS.map(p => `
    <div class="up-card ${UP_PLAN === p.key ? 'sel' : ''}" data-plan="${p.key}">
      <img src="${p.img}" alt="">
      <div class="up-name">${p.name}</div>
      <div class="up-price">${planCost(p.key)} 🪙 / شهر</div>
      <div class="up-feats">${p.feats}</div>
    </div>`).join('');
  $$('.up-card').forEach(c => c.onclick = () => { UP_PLAN = c.dataset.plan; renderUpCards(); });
  $('#upNeed').textContent = planCost(UP_PLAN) * UP_MONTHS;
}
$('#upMinus').onclick = () => { UP_MONTHS = Math.max(1, UP_MONTHS - 1); $('#upQty').textContent = UP_MONTHS; renderUpCards(); };
$('#upPlus').onclick = () => { UP_MONTHS = Math.min(24, UP_MONTHS + 1); $('#upQty').textContent = UP_MONTHS; renderUpCards(); };
$('#doUpgradeBtn').onclick = async () => {
  try {
    const d = await api('/api/upgrade', 'POST', { target_id: UP_TARGET.id, plan: UP_PLAN, months: UP_MONTHS });
    toast(`تم إرسال طلب ترقية ${UP_TARGET.username} إلى ${UP_PLAN.toUpperCase()} للإدارة ✓ (التكلفة المقترحة ${d.suggested_gold} ذهب)`);
    closeOv('upOv');
  } catch (e) { toast(e.error || 'تعذر إرسال طلب الترقية', false); }
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
    $('#profTitleTab').textContent = isMe ? 'حسابي' : u.username;
    $('#profName').textContent = u.username;
    $('#profAva').innerHTML = avatarHtml(u.avatar) + `<span class="dot ${statusDot(u.status)}"></span>`;
    let memText, memColor;
    if (u.rank !== 'user') { memText = RANK_NAMES[u.rank]; memColor = { superadmin: '#7c3aed', admin: '#ea580c', roomadmin: '#0e9fdd' }[u.rank]; }
    else if (u.membership !== 'none') { memText = MEM_NAMES[u.membership]; memColor = MEM_COLORS[u.membership]; }
    else { memText = u.registered ? 'عضو مسجل' : 'زائر'; memColor = u.registered ? '#c2185b' : '#6b7280'; }
    $('#profMem').innerHTML = `<img src="/badges/${d.badge}"> <span style="color:${memColor}">${memText}</span>`;
    if (isMe) {
      $('.profpage').classList.remove('visitor');
      document.querySelector('.prof-hero').style.display = '';
      renderProfileForm(u); $('#profGifts').style.display = 'none'; $('#profGiftsSub').style.display = 'none';
    } else {
      document.querySelector('.prof-hero').style.display = 'none';   // ملف الزائر بواجهة مختلفة
      $('#profGifts').style.display = 'none'; $('#profGiftsSub').style.display = 'none';
      $('#profTitleTab').innerHTML = `${esc(u.username)} ${u.verified ? '<i class="f7-icons" style="font-size:14px">sparkles</i>' : ''}`;
      $('.profpage').classList.add('visitor');
      $('.profpage').style.setProperty('--vpava', u.avatar && u.avatar.startsWith('/') ? `url('${u.avatar}')` : 'none');
      renderVisitorProfile(u, d);
    }
    openOv('profOv');
  } catch (e) { toast('تعذر فتح الملف الشخصي', false); }
}
// ----- ملف الزائر: مطابق لصورة «الملف الشخصي للزوار» -----
function renderVisitorProfile(u, d) {
  const stMap = { online: 'متصل', busy: 'مشغول', away: 'بالخارج', offline: 'غير متصل' };
  const stColor = { online: '#22c55e', busy: '#ef4444', away: '#f59e0b', offline: '#b9c0d2' };
  const memTxt = u.rank !== 'user' ? RANK_NAMES[u.rank] : (u.membership !== 'none' ? MEM_NAMES[u.membership] : (u.registered ? 'عضو مسجل' : 'زائر'));
  const gifts = (d.gifts || []).slice().sort((a, b) => b.created_at - a.created_at);   // الأحدث أولاً مثل المرجع
  const gCards = gifts.map(g => {
    const dt = new Date(g.created_at * 1000);
    return `<div class="vg-card">
      <div class="vg-top">
        <span class="vg-e">${(g.gift_img || '').startsWith('/') ? `<img src="${esc(g.gift_img)}" alt="">` : esc(g.gift_img || '🎁')}</span>
        <div class="vg-txt">
          <div class="vg-date">${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()}</div>
          <div class="vg-fl">الهدية من</div>
          <div class="vg-from">${esc(g.from_name)}</div>
        </div>
      </div>
      <div class="vg-bot"><span class="vg-name">${esc(g.gift_name)}</span><span class="vg-qty">كمية: <b>${g.qty}</b></span></div>
    </div>`;
  }).join('');
  $('#profBody').innerHTML = `
  <div class="vp-top">
    <div class="vp-col">
      <div class="vp-name">${esc(u.username)}</div>
      <div class="vp-decor"><i class="f7-icons vp-spark">sparkles</i>${u.verified ? '<i class="f7-icons vp-vrf">checkmark_seal_fill</i>' : ''}</div>
      <div class="vp-status"><span class="vs-dot" style="background:${stColor[u.status] || '#22c55e'}"></span> ${stMap[u.status] || 'متصل'}</div>
      <span class="vp-pill"><img src="/badges/${d.badge}" alt=""> ${memTxt}</span>
    </div>
    <div class="vp-ava">${avatarHtml(u.avatar)}<span class="vs-dot big" style="background:${stColor[u.status] || '#22c55e'}"></span></div>
  </div>
  <div class="vp-tabs">
    <button class="vp-tab" data-vtab="gifts">الهدايا</button>
    <button class="vp-tab active" data-vtab="info">معلومات</button>
  </div>
  <div class="vp-acts">
    <button class="va" id="vaIgnore"><span class="va-ic"><i class="f7-icons">exclamationmark_octagon_fill</i></span>تجاهل</button>
    <button class="va" id="vaReport"><span class="va-ic"><i class="f7-icons">exclamationmark_triangle_fill</i></span>الإبلاغ</button>
    <button class="va" id="vaUpgrade"><span class="va-ic"><i class="f7-icons">chart_bar_fill</i></span>إرسل ترقية</button>
    <button class="va" id="vaGift"><span class="va-ic"><i class="f7-icons">gift_fill</i></span>إرسل هدية</button>
    <button class="va" id="vaChat"><span class="va-ic"><i class="f7-icons">chat_bubble_fill</i></span>دردشة</button>
  </div>
  <div class="vp-info" id="vpInfo">
    <p class="vp-bio">${esc(u.bio || DEFAULT_BIO)}</p>
    <div class="vp-irow"><span class="vp-k">العمر</span><span class="vp-v">${u.age || 0}</span></div>
    <div class="vp-irow"><span class="vp-k">النوع</span><span class="vp-v">${GENDER_NAMES[u.gender] || 'مجهول'}</span></div>
  </div>
  <div class="vp-gifts" id="vpGifts" style="display:none">
    <div class="vp-gtitle">يتم عرض الهدايا التي يتلقاها هذا المستخدم هنا</div>
    <div class="vp-ggrid">${gCards || '<div class="pv-empty" style="grid-column:1/3;padding:26px"><div>لا توجد هدايا بعد</div></div>'}</div>
    ${gifts.length ? '<button class="vp-more" id="vpMore">أظهر المزيد</button>' : ''}
  </div>`;
  $$('#profBody .vp-tab').forEach(t => t.onclick = () => {
    $$('#profBody .vp-tab').forEach(x => x.classList.toggle('active', x === t));
    $('#vpInfo').style.display = t.dataset.vtab === 'info' ? '' : 'none';
    $('#vpGifts').style.display = t.dataset.vtab === 'gifts' ? '' : 'none';
  });
  $('#vaChat').onclick = () => { closeOv('profOv'); openPrivateWith(u); };
  $('#vaGift').onclick = () => { closeOv('profOv'); if (!ME.registered) return openOv('needRegOv'); openGifts(u); };
  $('#vaUpgrade').onclick = () => { closeOv('profOv'); openUpgrade(u); };
  $('#vaReport').onclick = () => { closeOv('profOv'); openOv('compOv'); const s = $('#compSubject'); if (s) s.value = 'إبلاغ عن ' + u.username; };
  $('#vaIgnore').onclick = () => toast('تمت الإضافة لقائمة التجاهل 🚫');
  const vm = $('#vpMore'); if (vm) vm.onclick = () => toast('لا توجد هدايا أخرى');
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
      <textarea class="pf-input pf-bio" id="pfBio" rows="3" placeholder="اكتب جملة تعبر عنك...">${esc(u.bio || DEFAULT_BIO)}</textarea>
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
  $('#profGifts').innerHTML = gifts && gifts.length ? `<div class="prof-gifts">${gifts.map(g => `
    <div class="pg-card">
      <div class="d">${new Date(g.created_at * 1000).toLocaleDateString('ar-EG')}</div>
      <div class="e">${esc(g.gift_img)}</div>
      <div class="n">${esc(g.gift_name)}</div>
      <div class="f">الهدية من ${esc(g.from_name)}</div>
      <div class="f" style="color:var(--main);font-weight:900">كمية : ${g.qty}</div>
    </div>`).join('')}</div>`
    : '<div class="pv-empty" style="padding:36px"><div>لم يتلقَ هدايا بعد</div></div>';
}

// =====================================================
//  الرسائل الخاصة
// =====================================================
async function openPrivateList() {
  if (!ME) return openLogin();
  openOv('privOv');
  renderPrivConvs(PRIV_TAB);
}
async function renderPrivConvs(tab = 'members') {
  PRIV_TAB = tab;
  $$('.pv-tab').forEach(t => t.classList.toggle('active', t.dataset.ptab === tab));
  const allConvs = await api('/api/private');
  // محادثات الأعضاء المسجلين في التبويب الأول، والزوار في «غير مرغوب فيه».
  const convs = allConvs.filter(c => tab === 'spam' ? !c.registered : !!c.registered);
  $('#privList').innerHTML = convs.length ? convs.map(c => `
    <div class="pv-row ${c.registered ? '' : 'guest-pm'}" data-id="${c.id}">
      <div class="uava">${avatarHtml(c.avatar)}</div>
      <div class="ptxt">
        <div class="pname">${esc(c.username)} ${c.verified ? '<i class="f7-icons" style="font-size:13px;color:#1685f5">checkmark_seal_fill</i>' : ''}<img src="/badges/${GENDER_IMG[c.gender] || 'secret.png'}"></div>
        <div class="plast">${esc(c.last)}</div>
      </div>
      ${c.registered ? '' : '<span class="pm-guest-tag">زائر</span>'}
      <i class="f7-icons" style="color:#c3c8d8">chevron_right</i>
    </div>`).join('') : `<div class="pv-empty"><span class="empty-img"><img src="/img/chat_empty.png" alt=""></span><div>${tab === 'spam' ? 'لا توجد رسائل من الزوار' : 'لا توجد محادثات مع أعضاء مسجلين'}</div></div>`;
  $$('#privList .pv-row').forEach(r => r.onclick = () => openPrivateWith(convs.find(x => x.id === +r.dataset.id)));
}
$$('.pv-tab').forEach(t => t.onclick = () => renderPrivConvs(t.dataset.ptab));
async function openPrivateWith(u) {
  if (IGNORED_USERS.has(+u.id)) return toast('لا يمكن فتح الخاص مع مستخدم متجاهَل', false);
  try { const d = await api('/api/user/' + u.id); if (d && d.user) u = d.user; } catch (e) { }  // أحدث صورة وبيانات الطرف الآخر
  PM_WITH = u;
  $('#pmPeer').innerHTML = `<span class="pm-peer-ava">${avatarHtml(u.avatar)}</span><b>${esc(u.username)}</b>${u.verified ? '<i class="f7-icons pm-vrf">checkmark_seal_fill</i>' : ''}`;
  $('#pmBody').innerHTML = `
    <div class="pm-hero">
      <span class="pm-hero-ava">${avatarHtml(u.avatar)}</span>
      <div class="pm-hero-name">${esc(u.username)}</div>
      <div class="pm-water">${esc(SETTINGS.site_name || 'نجوم العرب')}</div>
    </div>`;
  closeOv('privOv');
  openOv('pmOv');
  try {
    const msgs = await api('/api/private/' + u.id);
    msgs.forEach(renderPm);
    scrollPm();
  } catch (e) {
    closeOv('pmOv');
    PM_WITH = null;
    toast(e.error || 'المحادثة الخاصة غير متاحة', false);
  }
}
function renderPm(p) {
  const mine = p.from_id === ME.id;
  const who = mine ? ME : PM_WITH;
  const el = document.createElement('div');
  el.className = 'pm-row ' + (mine ? 'me' : 'them');
  el.innerHTML = `
    <span class="pm-ava">${avatarHtml(who.avatar)}</span>
    <div class="pm-bub">
      <div class="pm-bh"><span>${timeHm(p.created_at)}</span><b>${esc(who.username)}</b></div>
      <div class="pm-tx">${esc(p.text)}</div>
    </div>`;
  $('#pmBody').appendChild(el);
}
$('#pmCall').onclick = () => toast('📞 المكالمات الصوتية قريباً');
$('#pmMic').onclick = () => toast('🎙 الرسائل الصوتية متاحة لأصحاب العضويات');
$('#pmCam').onclick = () => toast('📷 إرسال الصور متاح لأصحاب العضويات');
$('#pmEmoji').onclick = () => toast('😊 الايموجي قريباً');
function scrollPm() { const b = $('#pmBody'); b.scrollTop = b.scrollHeight; }
$('#pmSend').onclick = sendPm;
$('#pmInput').onkeydown = e => { if (e.key === 'Enter') sendPm(); };
function sendPm() {
  const t = $('#pmInput').value.trim();
  if (!t || !PM_WITH) return;
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
  if (!ME.registered) return openOv('needRegOv');
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
    const added = await api('/api/statuses', 'POST', fd, true);
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
    $('#myGiftsList').innerHTML = gifts.length ? gifts.map(gift => {
      const media = gift.gift_img || '🎁';
      const visual = String(media).startsWith('/') ? `<img src="${esc(media)}" alt="">` : esc(media);
      return `<div class="my-gift-card">
        <div class="my-gift-media">${visual}</div>
        <h4>${esc(gift.gift_name || 'هدية')}</h4>
        <p>من: <b>${esc(gift.from_name || '-')}</b></p>
        <p>${new Date(gift.created_at * 1000).toLocaleDateString(APP_LANG === 'en' ? 'en-US' : 'ar-JO')}</p>
        <p class="gift-qty">الكمية: ${gift.qty || 1}</p>
      </div>`;
    }).join('') : '<div class="my-gifts-empty"><i class="f7-icons">gift_fill</i>لم تستلم أي هدايا بعد</div>';
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
function openMenu() {
  if (!ME) return openLogin();
  $('#menuName').textContent = ME.username;
  $('#menuStatus').textContent = statusName(ME.status);
  $('#menuBal').textContent = ME.balance;
  $('#menuAva').innerHTML = avatarHtml(ME.avatar) + `<span class="dot ${statusDot(ME.status)}"></span>`;
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
$('#mnLogout').onclick = async () => { await api('/api/logout', 'POST'); location.reload(); };

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
//  شراء رصيد (ذهب افتراضي)
// =====================================================
const GOLD_PACKS = [10, 20, 30, 50, 100, 200];
let SEL_GOLD = 10;
function openBuy() {
  SEL_GOLD = 10;
  renderGold(false);
  openOv('buyOv');
}
function renderGold(markSel = true) {
  $('#goldGrid').innerHTML = GOLD_PACKS.map(g => `
    <div class="gold-card ${markSel && SEL_GOLD === g ? 'sel' : ''}" data-g="${g}">
      <div class="gn">${g} Gold</div>
      <img src="/img/gold.png" alt="">
      <div class="gp">${g} $ <span class="gl">السعر</span></div>
    </div>`).join('');
  $$('.gold-card').forEach(c => c.onclick = () => { SEL_GOLD = +c.dataset.g; renderGold(true); });
  $('#buyStrip').innerHTML = `متابعة شراء <b>${SEL_GOLD} Gold</b> <span>$ ${SEL_GOLD}</span>`;
}
async function buyGold() {
  try {
    const d = await api('/api/buy-gold', 'POST', { gold: SEL_GOLD });
    ME.balance = d.balance;
    $('#menuBal').textContent = d.balance;
    closeOv('buyOv');
    toast(`تمت إضافة ${SEL_GOLD} ذهب الى رصيدك 💰`);
    pushNotif('creditcard_fill', `تمت إضافة ${SEL_GOLD} ذهب افتراضي الى رصيدك`);
  } catch (e) { toast(e.error || 'تعذر الشراء', false); }
}
$('#buyPaypal').onclick = buyGold;
$('#buyDebit').onclick = buyGold;
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

// تغيير الصورة — معرض صور حقيقي
const AVA_FILES = { def: 20, nature: 16, other: 16 };
function openAvatars() {
  SEL_AVATAR = ME.avatar;
  renderAvaGrid(AVA_CAT);
  openOv('avaOv');
}
$$('.ava-tab').forEach(t => t.onclick = () => {
  AVA_CAT = t.dataset.acat;
  $$('.ava-tab').forEach(x => x.classList.toggle('active', x === t));
  renderAvaGrid(AVA_CAT);
});
function renderAvaGrid(cat) {
  const n = AVA_FILES[cat];
  let html = '';
  for (let i = 1; i <= n; i++) {
    const v = `/avatars/${cat}/${String(i).padStart(2, '0')}.jpg`;
    html += `<div class="ava-cell ${SEL_AVATAR === v ? 'sel' : ''}" data-v="${v}"><img src="${v}" loading="lazy"></div>`;
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
    const d = await api('/api/avatar', 'POST', fd, true);
    SEL_AVATAR = d.avatar;
    ME.avatar = d.avatar;
    closeOv('avaOv');
    onLoggedIn();
    toast('تم رفع الصورة وحفظها ✅');
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
    toast('تم حفظ الصورة ✅');
  } catch (e) { toast(e.error || 'تعذر حفظ الصورة', false); }
};

// =====================================================
//  الإشعارات
// =====================================================
$('#notifSettings').onclick = () => toast('إعدادات الإشعارات');
async function openNotifs() {
  if (!ME) return openLogin();
  openOv('notifOv');
  let server = [];
  if (ME.registered) { try { server = await api('/api/notifications'); } catch (e) { } }
  const all = [...NOTIFS.map(n => ({ icon: n.icon, text: n.text, created_at: n.at / 1000 })), ...server];
  $('#notifList').innerHTML = all.length ? all.map(n => `
    <div class="pv-row">
      <div class="uava" style="background:var(--main)"><i class="f7-icons" style="font-size:18px">${n.icon || 'bell_fill'}</i></div>
      <div class="ptxt"><div class="plast" style="white-space:normal;font-size:12.5px;color:#374151">${esc(n.text)}</div>
      <div class="ptime">${new Date(n.created_at * 1000).toLocaleString('ar')}</div></div>
    </div>`).join('') : '<div class="pv-empty"><span class="empty-img"><img src="/img/notif_empty.png" alt=""></span><div>لا يوجد إشعارات بعد</div></div>';
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
$('#dropLogout').onclick = async () => { closeEnterDrop(); await api('/api/logout', 'POST'); location.reload(); };
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
    toast('أهلا بك كزائر ' + ME.username);
  } catch (e) { $('#loginErr').textContent = e.error || 'فشل الدخول'; }
};
$('#goRegister').onclick = () => { closeOv('loginOv'); openOv('regOv'); };
const gr2 = $('#goRegister2'); if (gr2) gr2.onclick = () => { closeOv('loginOv'); openOv('regOv'); };
$('#nrGo').onclick = () => { closeOv('needRegOv'); openOv('regOv'); };
$('#doRegister').onclick = async () => {
  try {
    const gender = document.querySelector('input[name=rGender]:checked').value;
    const d = await api('/api/register', 'POST', {
      username: $('#rUser').value.trim(), password: $('#rPass').value,
      gender, age: +$('#rAge').value || 25
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
function closeNavPages(except) { ['privOv', 'notifOv', 'menuOv'].forEach(id => { if (id !== except) closeOv(id); }); }
$$('.bn-item').forEach(b => b.onclick = () => {
  const nav = b.dataset.nav;
  if (nav === 'rooms') {           // «الغرف» = العودة إلى العامة (الدردشة الحالية)
    closeNavPages(null);
    if (CUR_ROOM) showScreen('chat'); else showScreen('rooms');
  }
  else if (nav === 'private') { closeNavPages('privOv'); PRIV_UNREAD = 0; updatePrivBadge(); openPrivateList(); }
  else if (nav === 'notifs') { closeNavPages('notifOv'); openNotifs(); }
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
  if (open) renderRoomsPanel();
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
  if (CUR_ROOM) SOCKET.emit('leave', CUR_ROOM.id);
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
$$('.language-option').forEach(b => b.onclick = () => { setLanguage(b.dataset.language); closeOv('languageOv'); toast(b.dataset.language === 'en' ? 'Language changed to English' : 'تم تغيير اللغة إلى العربية'); });
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
  SOCKET.emit('msg', { roomId: CUR_ROOM.id, text: t, reply: REPLY_TO, color: MY_COLOR || null });
  setReply(null);
  $('#msgInput').value = '';
}
// الإيموجي النصي والمصور المرفوع من لوحة الإدارة
const EMOJIS = '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👹 👺 🤡 💩 👻 💀 👽 👾 🤖 🎃 😺 😸 😹 😻 😼 😽 🙀 😿 😾 👍 👎 👏 🙌 👐 🤲 🤝 🙏 ✌️ 🤞 🤟 🤘 👌 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐 🖖 👋 🤙 💪 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 🌹 🌺 🌸 🌼 🌻 🔥 ✨ ⭐ 🌟 💫 💥 💢 💦 💨 🕊️ 🎁 🎂 🎈 🎉 🎊 ☕ 🍫 🍬 🍭 🚗 ⚽ 🏆 🎯 🎤 🎵 🎶 👑 💎 💍'.split(' ');
let CUSTOM_EMOJIS = [];
function renderEmojiPicker() {
  $('#emojiGrid').innerHTML = EMOJIS.map(e => `<span>${e}</span>`).join('') +
    CUSTOM_EMOJIS.map(e => `<img class="custom-emoji-choice" src="${esc(e.img)}" data-id="${e.id}" alt="emoji">`).join('');
  $$('#emojiGrid span').forEach(s => s.onclick = () => {
    const inp = $('#msgInput');
    inp.value += s.textContent;
    inp.focus();
  });
  $$('#emojiGrid .custom-emoji-choice').forEach(im => im.onclick = () => {
    if (!ME) return openLogin();
    if (!CUR_ROOM) return toast('اختر غرفة أولا', false);
    SOCKET.emit('msg', { roomId: CUR_ROOM.id, text: 'em::' + im.getAttribute('src') });
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
$('#btnEmoji').onclick = () => { $('#colorPanel').classList.remove('open'); $('#emojiPanel').classList.toggle('open'); };
$('#colorPanel').classList.remove('open');
$('#btnApps').onclick = () => { $('#emojiPanel').classList.remove('open'); $('#colorPanel').classList.toggle('open'); };
$('#btnMic').onclick = () => toast('🎙 الرسائل الصوتية متاحة لأصحاب العضويات');
$('#btnCam').onclick = async () => {
  if (!ME || !ME.registered) return openOv('needRegOv');
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f || !CUR_ROOM) return;
    const fd = new FormData();
    fd.append('avatar', f);
    try { await api('/api/avatar', 'POST', fd, true); } catch (e) { }
    toast('تم إرسال الصورة 📷');
  };
  inp.click();
};
$('#privSettings').onclick = () => toast('اعدادات الخاص : استقبال الرسائل من الجميع');

// إغلاق اللوحات عند الضغط خارجها
document.addEventListener('click', (e) => {
  const ep = $('#emojiPanel');
  if (ep.classList.contains('open') && !ep.contains(e.target) && !e.target.closest('#btnEmoji')) ep.classList.remove('open');
});
// إغلاق النوافذ عند لمس الخلفية
$$('.overlay:not(.full)').forEach(ov => ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('open'); }));
