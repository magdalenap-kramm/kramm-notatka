// wersja 2026-11-26b
// Asystentka KRAMM - powiadomienia (poranny brief)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
// obsługa żądań (wymagana, żeby telefon zainstalował Asystentkę jako aplikację z ikoną)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.registration.scope)) return;
  // strona zawsze świeża z serwera; żądania nawigacji nie można przerabiać, więc pobieramy po adresie
  const swieza = e.request.mode === 'navigate' || /\.(html|js|webmanifest)$/.test(new URL(e.request.url).pathname);
  const pobierz = swieza ? fetch(e.request.url, { cache: 'no-store', credentials: 'same-origin' }) : fetch(e.request);
  e.respondWith(pobierz.catch(() => fetch(e.request)).catch(async () =>
    (await caches.match(e.request)) || new Response('<meta charset="utf-8"><p style="font:18px sans-serif;padding:40px;text-align:center">Brak internetu. Spróbuj za chwilę.</p>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { tresc: e.data && e.data.text() }; }
  const ikona = d.licznik && self.navigator && self.navigator.setAppBadge ? self.navigator.setAppBadge(d.licznik).catch(() => {}) : Promise.resolve();
  e.waitUntil(ikona.then(() => self.registration.showNotification(d.tytul || 'Asystentka KRAMM', {
    body: d.tresc || '', icon: 'ikona-192.png', badge: 'odznaka-96.png', tag: d.tag || ('asystentka-' + Date.now()), renotify: true, data: { url: d.url || './' }
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
