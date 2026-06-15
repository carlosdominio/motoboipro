const CACHE_NAME = 'motoboy-cache-v1';
const urlsToCache = [
  'index.html',
  'style.css',
  'app.js',
  'favicon.svg',
  '../notificacao.mp3'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  if (event.request.url.includes('/api/') || event.request.url.includes('pusher.com')) {
    return;
  }
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : { title: 'Motoboy Express', body: 'Nova atualização!' };
  const options = {
    body: data.body,
    icon: 'favicon.svg',
    badge: 'favicon.svg',
    vibrate: [200, 100, 200],
    data: { url: '/motoboy/index.html' }
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});
