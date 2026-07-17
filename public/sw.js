const CACHE_NAME = 'z-battle-v11';

// A stalled fetch (flaky/dead connection) would otherwise hang forever, which is
// exactly what let the app's own 90%-init-screen hang past its intended timeout —
// the JS chunk request never settled, so nothing downstream ever got a chance to run.
const FETCH_TIMEOUT_MS = 10000;

function fetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}

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
      fetchWithTimeout(event.request, FETCH_TIMEOUT_MS)
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
        return fetchWithTimeout(event.request, FETCH_TIMEOUT_MS).then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            cache.put(event.request, response.clone());
          }
          return response;
        });
      })
    )
  );
});
