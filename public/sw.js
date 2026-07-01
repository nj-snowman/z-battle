const CACHE_NAME = 'z-battle-v3';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(['/', '/cards.json', '/manifest.json']);
      // Precache every card image up front so offline play doesn't depend on
      // having previously viewed each card during a prior online session.
      try {
        const res = await fetch('/cards.json');
        const data = await res.json();
        const images = [...new Set(
          (data.cards || []).map(c => c.image).filter(Boolean).map(img => '/' + img)
        )];
        await Promise.all(images.map(url => cache.add(url).catch(() => {})));
      } catch {
        // cards.json unreachable at install time — images still cache lazily via fetch handler
      }
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  const isNavigation = event.request.mode === 'navigate' || event.request.destination === 'document';

  // App shell: always try the network first so new deploys are picked up
  // immediately; fall back to cache only when offline.
  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.open(CACHE_NAME).then(cache => cache.match(event.request)))
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            cache.put(event.request, response.clone());
          }
          return response;
        });
      })
    )
  );
});
