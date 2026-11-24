// wersja 2026-11-24b
// Asystentka KRAMM - powiadomienia (poranny brief)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
// obsługa żądań (wymagana, żeby telefon zainstalował Asystentkę jako aplikację z ikoną)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.registration.scope)) return;
  // strona zawsze świeża z serwera (bez pamięci podręcznej telefonu)
  const swieza = e.request.mode === 'navigate' || /\.(html|js|webmanifest)$/.test(new URL(e.request.url).pathname);
  e.respondWith(fetch(e.request, swieza ? { cache: 'no-store' } : undefined).catch(() => caches.match(e.request)));
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { tresc: e.data && e.data.text() }; }
  const ikona = d.licznik && self.navigator && self.navigator.setAppBadge ? self.navigator.setAppBadge(d.licznik).catch(() => {}) : Promise.resolve();
  e.waitUntil(ikona.then(() => self.registration.showNotification(d.tytul || 'Asystentka KRAMM', {
    body: d.tresc || '', icon: 'ikona-192.png', badge: 'ikona-192.png', tag: d.tag || ('asystentka-' + Date.now()), renotify: true, data: { url: d.url || './' }
  })));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data && e.notification.data.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
    for (const c of lista) { if (c.url.startsWith(self.registration.scope) && 'focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
