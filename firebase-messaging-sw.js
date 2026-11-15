/* Service worker for the hourly word reminder (Web Push via Firebase Cloud Messaging).
   The server sends DATA-ONLY messages, and this worker turns every push into a visible
   notification itself. That matters on iPhone: Safari requires each push to show a
   notification, and otherwise drops the subscription after a few silent ones. */
const SWV = 'sw-3';
// Tiny on-device log (Cache Storage) so the app's diagnostics screen can show what the worker did.
async function slog(m) {
  try {
    const c = await caches.open('slova-log');
    await c.put('/__log/' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), new Response(new Date().toISOString() + ' ' + SWV + ' ' + m));
  } catch (e) { /* ignore */ }
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function readPayload(event) {
  try {
    const j = event.data ? event.data.json() : {};
    return j.data || j.notification || j || {};
  } catch (e) {
    try { return { body: event.data.text() }; } catch (e2) { return {}; }
  }
}

self.addEventListener('push', (event) => {
  const d = readPayload(event);
  const title = d.title || 'Слова';
  const body = d.body || d.uk || 'Час повторити слово';
  event.waitUntil((async () => {
    await slog('push received: ' + (d.uk || '(no word)'));
    const nd = { uk: d.uk || '', tl: d.tl || '', lang: d.lang || '', wid: d.wid || '' };
    try {
      await self.registration.showNotification(title, { body, icon: 'icon.png', badge: 'icon.png', data: nd });
      await slog('notification shown');
    } catch (e) {
      await slog('show FAILED: ' + e.message + ' — retrying plain');
      await self.registration.showNotification(title, { body, data: nd });
      await slog('plain notification shown');
    }
    // If the app is open on screen, also jump straight to the one-word screen.
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (c.visibilityState === 'visible') c.postMessage({ type: 'quick', uk: d.uk, tl: d.tl, lang: d.lang, wid: d.wid });
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(slog('notification clicked'));
  const d = event.notification.data || {};
  const qs = 'notif=1&uk=' + encodeURIComponent(d.uk || '') + '&tl=' + encodeURIComponent(d.tl || '') +
    '&lang=' + encodeURIComponent(d.lang || '') + '&wid=' + encodeURIComponent(d.wid || '');
  const url = new URL('./?' + qs, self.registration.scope).href;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      try {
        c.postMessage({ type: 'quick', uk: d.uk, tl: d.tl, lang: d.lang, wid: d.wid });
        return await c.focus();
      } catch (e) { /* try next / open a new window */ }
    }
    return self.clients.openWindow(url);
  })());
});
