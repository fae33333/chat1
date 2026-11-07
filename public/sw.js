/* Service Worker: استقبال الإشعارات (Web Push) وفتح التطبيق عند النقر */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
// لا تخزين مؤقت: الطلبات تمر للشبكة كما هي
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  const title = d.title || 'SoulChill';
  const opts = {
    body: d.body || '',
    icon: d.icon || '/img/icon-192.png',
    badge: '/img/icon-192.png',
    tag: d.tag || undefined,
    dir: 'rtl', lang: 'ar',
    data: { url: d.url || '/' }
  };
  if (d.image) opts.image = d.image;
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        try { await c.focus(); if ('navigate' in c && c.url !== target) await c.navigate(target); return; } catch (e) {}
      }
    }
    await self.clients.openWindow(target);
  })());
});
