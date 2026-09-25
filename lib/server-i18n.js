// =====================================================================
//  ترجمة الخادم (server-side i18n) للصفحات الجانبية ورسائل الخطأ.
//  تستقبل Accept-Language من الطلب وتُعيد أفضل لغة مطابقة من: ar, en, es, tr, fr.
// =====================================================================
'use strict';

const SUPPORTED = ['ar', 'en', 'es', 'tr', 'fr'];
const ALIASES = {
  arabic: 'ar', ar: 'ar',
  english: 'en', en: 'en', en_us: 'en', en_gb: 'en',
  spanish: 'es', es: 'es', es_es: 'es', es_mx: 'es',
  turkish: 'tr', tr: 'tr',
  french: 'fr', fr: 'fr', fr_fr: 'fr'
};

function detectLang(req) {
  // قراءة اللغة المفضلة من الطلب بالترتيب:
  //  1. معامل ?lang=  في الرابط
  //  2. كوكي chat_language الذي يحفظه اختيار المستخدم في العميل
  //  3. ترويسة Accept-Language
  //  4. الافتراضي ar
  try {
    if (req && req.query && req.query.lang && ALIASES[String(req.query.lang).toLowerCase().replace('-', '_')]) {
      return ALIASES[String(req.query.lang).toLowerCase().replace('-', '_')];
    }
    if (req && req.cookies && req.cookies.chat_language) {
      const c = String(req.cookies.chat_language).toLowerCase();
      if (SUPPORTED.includes(c)) return c;
    }
    if (req && req.headers && req.headers['accept-language']) {
      const al = String(req.headers['accept-language']).toLowerCase();
      // استخراج اللغات مع قيمة الجودة q
      const pairs = al.split(',').map(s => {
        const m = s.match(/^\s*([a-z]{2,3})(?:[-_][a-z]{2,3})?(?:;q=([0-9.]+))?/i);
        if (!m) return null;
        const code = m[1].toLowerCase();
        const q = m[2] !== undefined ? parseFloat(m[2]) : 1.0;
        return { code, q };
      }).filter(Boolean).sort((a, b) => b.q - a.q);
      for (const p of pairs) {
        if (SUPPORTED.includes(p.code)) return p.code;
        if (ALIASES[p.code]) return ALIASES[p.code];
      }
    }
  } catch (e) { /* ignore */ }
  return 'ar';
}

// ========== قاموس الصفحات الجانبية ==========
const DICT = {
  // صفحة 403 الخاصة برابط الإدارة
  admin403: {
    ar: {
      title: 'غير مصرح بالدخول | لوحة التحكم',
      heading: 'رابط الإدارة غير متاح أو منتهي الصلاحية',
      backBtn: 'العودة إلى الدردشة',
      prefixReason: 'هذا الرابط مشفر ومربوط بالجهاز والمتصفح المصدر فقط، ولا يمكن فتحه من جهاز أو متصفح آخر.',
      msgReason: 'يرجى التوجه إلى الدردشة والضغط على زر «لوحة التحكم الإدارية» لتوليد رابط وصول آمن ومباشر.',
      oldToken: 'تم إبطال رمز الأمان القديم عند تسجيل الدخول أو التحديث داخل الدردشة.',
      notInChat: 'يجب أن تكون متواجداً ومتصلاً داخل الدردشة في نفس الوقت لتتمكن من استخدام لوحة الإدارة.'
    },
    en: {
      title: 'Unauthorized | Admin Panel',
      heading: 'Admin link unavailable or expired',
      backBtn: 'Back to Chat',
      prefixReason: 'This link is encrypted and bound to the source device/browser. It cannot be opened from another device or browser.',
      msgReason: 'Please go to the chat and click the "Admin Control Panel" button to generate a new secure access link.',
      oldToken: 'The old security token was invalidated upon login or refresh from within the chat.',
      notInChat: 'You must be present and connected in the chat at the same time to use the admin panel.'
    },
    es: {
      title: 'No autorizado | Panel Admin',
      heading: 'Enlace de administración no disponible o expirado',
      backBtn: 'Volver al Chat',
      prefixReason: 'Este enlace está cifrado y vinculado al dispositivo/navegador de origen. No puede abrirse desde otro dispositivo o navegador.',
      msgReason: 'Por favor, ve al chat y pulsa el botón "Panel de Control Admin" para generar un nuevo enlace seguro.',
      oldToken: 'El token de seguridad antiguo fue invalidado al iniciar sesión o recargar desde el chat.',
      notInChat: 'Debes estar presente y conectado en el chat al mismo tiempo para usar el panel de administración.'
    },
    tr: {
      title: 'Yetkisiz | Yönetim Paneli',
      heading: 'Yönetim bağlantısı kullanılamıyor veya süresi dolmuş',
      backBtn: 'Sohbete Dön',
      prefixReason: 'Bu bağlantı şifrelidir ve kaynak cihaza/tarayıcıya bağlıdır. Başka bir cihaz veya tarayıcıdan açılamaz.',
      msgReason: 'Lütfen sohbete dön ve "Yönetim Kontrol Paneli" butonuna tıklayarak yeni güvenli erişim bağlantısı oluştur.',
      oldToken: 'Eski güvenlik belirteci, sohbet içinden giriş yapıldığında veya yenilendiğinde geçersiz kılındı.',
      notInChat: 'Yönetim panelini kullanabilmek için aynı anda sohbette bağlı ve mevcut olmalısın.'
    },
    fr: {
      title: 'Non autorisé | Panneau Admin',
      heading: "Lien d'administration indisponible ou expiré",
      backBtn: 'Retour au Tchat',
      prefixReason: "Ce lien est chiffré et lié à l'appareil/navigateur source. Il ne peut pas être ouvert depuis un autre appareil ou navigateur.",
      msgReason: "Veuillez retourner au tchat et cliquer sur le bouton « Panneau de Contrôle Admin » pour générer un nouveau lien sécurisé.",
      oldToken: "L'ancien jeton de sécurité a été invalidé lors d'une connexion ou mise à jour depuis le tchat.",
      notInChat: "Vous devez être présent et connecté dans le tchat en même temps pour pouvoir utiliser le panneau d'administration."
    }
  },

  // صفحة الحظر العام (VPN/متصفح/إلخ)
  blocked: {
    ar: {
      titlePrefix: 'تعذر الوصول إلى الدردشة',
      siteName: 'الدردشة',
      vpn: 'تم رصد اتصال عبر <b>برنامج VPN</b> أو <b>بروكسي</b>. الإدارة فعّلت منع هذه الأنواع من الاتصال حفاظاً على أمان الدردشة. يرجى إيقاف VPN/البروكسي ثم إعادة المحاولة.',
      browser: 'المتصفح الذي تستخدمه <b>غير مسموح</b> في هذه الدردشة حالياً. يُرجى استخدام أحد المتصفحات المسموحة (مثل كروم، فايرفوكس، سفاري، إيدج).',
      retry: 'إعادة المحاولة'
    },
    en: {
      titlePrefix: 'Unable to access chat',
      siteName: 'Chat',
      vpn: 'A connection via <b>VPN</b> or <b>proxy</b> was detected. The administration has blocked these connection types to keep the chat safe. Please disable VPN/proxy and try again.',
      browser: 'The browser you are using is <b>not allowed</b> in this chat. Please use one of the supported browsers (Chrome, Firefox, Safari, Edge).',
      retry: 'Retry'
    },
    es: {
      titlePrefix: 'No se puede acceder al chat',
      siteName: 'Chat',
      vpn: 'Se detectó una conexión a través de <b>VPN</b> o <b>proxy</b>. La administración ha bloqueado este tipo de conexiones para mantener el chat seguro. Desactiva la VPN/proxy e inténtalo de nuevo.',
      browser: 'El navegador que estás usando <b>no está permitido</b> en este chat. Utiliza uno de los navegadores soportados (Chrome, Firefox, Safari, Edge).',
      retry: 'Reintentar'
    },
    tr: {
      titlePrefix: 'Sohbete erişilemiyor',
      siteName: 'Sohbet',
      vpn: '<b>VPN</b> veya <b>proxy</b> üzerinden bağlantı tespit edildi. Yönetim, sohbetin güvenliği için bu bağlantıları engellemiştir. Lütfen VPN/proxy\'yi kapatıp tekrar deneyin.',
      browser: 'Kullandığınız tarayıcı bu sohbette <b>izinli değil</b>. Lütfen desteklenen tarayıcılardan birini kullanın (Chrome, Firefox, Safari, Edge).',
      retry: 'Tekrar Dene'
    },
    fr: {
      titlePrefix: "Impossible d'accéder au tchat",
      siteName: 'Tchat',
      vpn: "Une connexion via <b>VPN</b> ou <b>proxy</b> a été détectée. L'administration a bloqué ce type de connexion pour préserver la sécurité du tchat. Veuillez désactiver le VPN/proxy et réessayer.",
      browser: "Le navigateur que vous utilisez <b>n'est pas autorisé</b> sur ce tchat. Veuillez utiliser un navigateur pris en charge (Chrome, Firefox, Safari, Edge).",
      retry: 'Réessayer'
    }
  },

  // رسائل خطأ JSON شائعة
  errors: {
    'غير مسجل في هذه الصفحة': {
      en: 'Not authenticated on this page',
      es: 'No autenticado en esta página',
      tr: 'Bu sayfada oturum açılmamış',
      fr: 'Non authentifié sur cette page'
    },
    'حسابك غير مفعّل بعد — يجب إدخال رمز التفعيل أولاً': {
      en: 'Your account is not activated yet — you must enter the activation code first',
      es: 'Tu cuenta aún no está activada — primero debes introducir el código de activación',
      tr: 'Hesabın henüz aktif değil — önce aktivasyon kodunu girmelisin',
      fr: "Votre compte n'est pas encore activé — vous devez d'abord saisir le code d'activation"
    },
    'ممنوع - جلسة أو رابط الإدارة منتهي الصلاحية': {
      en: 'Forbidden — admin session or link has expired',
      es: 'Prohibido — la sesión o enlace de administración ha expirado',
      tr: 'Yasak — yönetim oturumu veya bağlantısı süresi dolmuş',
      fr: 'Interdit — la session ou le lien admin a expiré'
    },
    'هذه الصلاحية خاصة بالسوبر ادمن والمالك فقط': {
      en: 'This permission is for super admin and owner only',
      es: 'Este permiso es solo para super admin y propietario',
      tr: 'Bu yetki sadece süper yönetici ve sahip içindir',
      fr: 'Cette autorisation est réservée au super admin et au propriétaire'
    },
    'هذه الصلاحية خاصة بمالك الدردشة (supermaster) فقط': {
      en: 'This permission is for the chat owner (supermaster) only',
      es: 'Este permiso es solo para el propietario del chat (supermaster)',
      tr: 'Bu yetki sadece sohbet sahibi (supermaster) içindir',
      fr: 'Cette autorisation est réservée au propriétaire du tchat (supermaster)'
    },
    'لا تملك صلاحية الإشراف في هذه الغرفة': {
      en: 'You do not have moderation permission in this room',
      es: 'No tienes permiso de moderación en esta sala',
      tr: 'Bu odada moderatör yetkin yok',
      fr: "Vous n'avez pas la permission de modération dans cette salle"
    },
    'لا يمكنك الإشراف على مستخدم بصلاحية مساوية أو أعلى': {
      en: 'You cannot moderate a user with equal or higher permission',
      es: 'No puedes moderar a un usuario con permiso igual o superior',
      tr: 'Eşit veya daha yüksek yetkiye sahip bir kullanıcıyı yönetemezsin',
      fr: 'Vous ne pouvez pas modérer un utilisateur de permission égale ou supérieure'
    },
    'يمكنك الإشراف على مستخدمي غرفتك الحالية فقط': {
      en: 'You can only moderate users in your current room',
      es: 'Solo puedes moderar usuarios en tu sala actual',
      tr: 'Sadece mevcut odandaki kullanıcıları yönetebilirsin',
      fr: 'Vous ne pouvez modérer que les utilisateurs de votre salle actuelle'
    },
    'ممنوع - سوبر ادمين أو مالك فقط': {
      en: 'Forbidden — super admin or owner only',
      es: 'Prohibido — solo super admin o propietario',
      tr: 'Yasak — sadece süper yönetici veya sahip',
      fr: 'Interdit — super admin ou propriétaire uniquement'
    },
    'ليس لديك صلاحية لوحة الإدارة': {
      en: "You don't have admin panel permission",
      es: 'No tienes permiso para el panel de administración',
      tr: 'Yönetim paneli yetkin yok',
      fr: "Vous n'avez pas la permission du panneau d'administration"
    },
    'تم حظرك بسبب سلوكك السيئ': {
      en: 'You have been banned due to bad behavior',
      es: 'Has sido baneado por mal comportamiento',
      tr: 'Kötü davranışların nedeniyle yasaklandın',
      fr: 'Vous avez été banni en raison de votre mauvais comportement'
    },
    'حظر بواسطة الإدارة': {
      en: 'Banned by administration',
      es: 'Bloqueado por la administración',
      tr: 'Yönetim tarafından yasaklandı',
      fr: 'Banni par l\'administration'
    },
    'حظر الحساب بواسطة الإدارة': {
      en: 'Account banned by administration',
      es: 'Cuenta bloqueada por la administración',
      tr: 'Hesap yönetim tarafından yasaklandı',
      fr: 'Compte banni par l\'administration'
    },
    'تعذر التحقق من حالة الحظر': {
      en: 'Could not verify ban status',
      es: 'No se pudo verificar el estado de bloqueo',
      tr: 'Yasak durumu doğrulanamadı',
      fr: "Impossible de vérifier l'état du bannissement"
    },
    'هذا المستخدم أو الجهاز محظور': {
      en: 'This user or device is banned',
      es: 'Este usuario o dispositivo está bloqueado',
      tr: 'Bu kullanıcı veya cihaz yasaklı',
      fr: 'Cet utilisateur ou appareil est banni'
    }
  }
};

function t(key, group, lang) {
  const g = DICT[group];
  if (!g) return key;
  const row = g[lang] || g.en || g.ar || {};
  return row[key] !== undefined ? row[key] : (g.en && g.en[key] !== undefined ? g.en[key] : key);
}

function tError(arabicMsg, lang) {
  if (!arabicMsg || lang === 'ar') return arabicMsg;
  const key = String(arabicMsg).replace(/[ًٌٍَُِّْ]/g, '').trim();
  for (const k of Object.keys(DICT.errors)) {
    const kn = k.replace(/[ًٌٍَُِّْ]/g, '').trim();
    if (key === kn) return DICT.errors[k][lang] || DICT.errors[k].en || arabicMsg;
    if (key.indexOf(kn) !== -1 && kn.length > 4) return DICT.errors[k][lang] || DICT.errors[k].en || arabicMsg;
  }
  return arabicMsg;
}

// ترجمة كائن استجابة خطأ JSON بسيط
function translateErrorJson(obj, lang) {
  if (lang === 'ar') return obj;
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === 'string' && /[\u0600-\u06FF]/.test(v)) {
      out[k] = tError(v, lang);
    } else if (v && typeof v === 'object') {
      out[k] = translateErrorJson(v, lang);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// وسيط Express يضيف req.detectedLang وطرق مساعدة
function middleware(req, res, next) {
  req.detectedLang = detectLang(req);
  const origJson = res.json.bind(res);
  // ترجمة رسائل الخطأ (status 4xx/5xx) تلقائياً إن احتوت على نص عربي
  res.json = function (body) {
    try {
      if (res.statusCode >= 400 && res.statusCode < 600 && body && typeof body === 'object') {
        const hasArabic = JSON.stringify(body).match(/[\u0600-\u06FF]/);
        if (hasArabic && req.detectedLang !== 'ar') {
          body = translateErrorJson(body, req.detectedLang);
        }
      }
    } catch (e) {}
    return origJson(body);
  };
  next();
}

module.exports = {
  SUPPORTED,
  detectLang,
  t,
  tError,
  translateErrorJson,
  middleware
};
