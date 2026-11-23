// Service worker: shows push notifications and opens the app when one is tapped.
// iOS revokes push permission if a push arrives without a visible notification, so always show one.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Class Companion', {
      body: data.body || '',
      tag: data.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      lang: 'he',
      dir: 'rtl',
      data: { url: data.url || '/courses' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/courses', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        if (open.url !== url && 'navigate' in open) await open.navigate(url).catch(() => {});
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
