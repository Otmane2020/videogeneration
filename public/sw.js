// Service worker ClipMotion : rend l'app installable et affiche les notifications.
// Aucune mise en cache des pages (le site reste toujours à jour) ; seule la page hors ligne est gardée.
const OFFLINE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ClipMotion</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#07060f;color:#f2f0ff;font-family:system-ui;text-align:center"><div><h1>You are offline</h1><p>ClipMotion needs a connection to create videos.</p></div>';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'content-type': 'text/html; charset=utf-8' } })));
});
// Les notifications arrivent sans contenu (pas de chiffrement à gérer) : le texte est lu sur le serveur.
self.addEventListener('push', (e) => {
  e.waitUntil(fetch('/api/push?latest=1').then((r) => r.json()).catch(() => ({})).then((m) =>
    self.registration.showNotification(m.title || 'ClipMotion', { body: m.body || 'Something new is waiting for you.', icon: '/icon-192.png', badge: '/icon-192.png', data: { url: m.url || '/' } })));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow(e.notification.data?.url || '/'));
});
