// Minimal service worker — its only real job is letting the page trigger
// showNotification(), which is more reliable than the page-level Notification
// API (it still works even when this tab isn't the focused one, as long as
// the browser itself is running). It does no caching or offline work.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Clicking a notification focuses an existing tab if one's open, or opens a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => 'focus' in c);
      if (existing) return existing.focus();
      return self.clients.openWindow('./');
    })
  );
});
