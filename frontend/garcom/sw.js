const CACHE_NAME = 'garcom-cache-v5'; // Incrementado para forçar atualização
const urlsToCache = [
  'index.html',
  'style.css',
  'app.js',
  'favicon.svg',
  '../notificacao.mp3'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // Força o novo service worker a assumir o controle imediatamente
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  // ESTRATÉGIA: Network First para arquivos da API, Cache First para estáticos
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});

// Limpar caches antigos e assumir abas abertas
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      })
    ])
  );
});

// --- WEB PUSH (BACKGROUND NOTIFICATIONS) ---
self.addEventListener('push', event => {
  if (event.data) {
    try {
      const data = event.data.json();
      
      // Criamos um 'tag' único para cada mensagem baseado no tempo se não houver um,
      // ou usamos o evento. Isso FORÇA o Android a tratar como uma nova notificação
      // e tocar o som/vibrar novamente mesmo que a anterior não tenha sido lida.
      const uniqueTag = data.tag || `${data.event || 'push'}-${Date.now()}`;
      
      const options = {
        body: data.body,
        icon: '/garcom/favicon.svg',
        badge: '/garcom/favicon.svg',
        // Padrão de vibração "SOS/Emergência" ultra-agressivo
        vibrate: [1000, 200, 1000, 200, 1000, 200, 500, 100, 500, 100, 500, 100, 1000, 200, 1000, 200, 1000],
        requireInteraction: true, // Não deixa a notificação sumir sozinha
        renotify: true, // Força vibrar/tocar mesmo se houver outra notificação do mesmo app
        silent: false,
        tag: uniqueTag, 
        data: {
          url: self.registration.scope
        },
        actions: [
          { action: 'open', title: '✅ VER AGORA' }
        ]
      };

      event.waitUntil(
        self.registration.showNotification(data.title || '🚨 GarçomExpress', options)
      );
    } catch (e) {
      console.error('Erro ao processar push:', e);
    }
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Se houver uma janela aberta, foca nela
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === event.notification.data.url && 'focus' in client) {
          return client.focus();
        }
      }
      // Se não, abre uma nova
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url);
      }
    })
  );
});