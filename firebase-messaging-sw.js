/* Background service worker for push notifications (Firebase Cloud Messaging, Web Push).
   The app registers this file with its Firebase project config passed as query params
   (see registerPushSW() in index.html), so this file itself needs no secrets baked in —
   everything it needs comes through self.location.search at registration time. */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

const params = new URLSearchParams(self.location.search);
firebase.initializeApp({
  apiKey: params.get('apiKey') || '',
  projectId: params.get('projectId') || '',
  messagingSenderId: params.get('messagingSenderId') || '',
  appId: params.get('appId') || ''
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = (payload.notification && payload.notification.title) || 'Слова';
  const body = (payload.notification && payload.notification.body) || data.uk || '';
  self.registration.showNotification(title, {
    body,
    icon: 'icon.png',
    badge: 'icon.png',
    tag: 'slova-word',
    renotify: true,
    data
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const qs = 'notif=1&uk=' + encodeURIComponent(d.uk || '') +
    '&tl=' + encodeURIComponent(d.tl || '') +
    '&lang=' + encodeURIComponent(d.lang || '') +
    '&wid=' + encodeURIComponent(d.wid || '');
  const url = new URL('./?' + qs, self.registration.scope).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          if ('navigate' in c) c.navigate(url);
          return c.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
