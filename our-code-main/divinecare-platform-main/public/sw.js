/* Altrixs PWA — production only register. No PHI cached from /api/*. */
const CACHE = 'altrixs-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/dashboard', '/manifest.webmanifest'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // NetworkFirst — reference / catalog APIs only (non-PHI)
  if (
    url.pathname.startsWith('/api/reference') ||
    url.pathname.startsWith('/api/cpt')
  ) {
    event.respondWith(
      caches.open('altrixs-ref-v1').then(async (cache) => {
        try {
          const res = await fetch(event.request);
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        } catch {
          const hit = await cache.match(event.request);
          if (hit) return hit;
          throw new Error('offline');
        }
      })
    );
    return;
  }

  // NetworkOnly — never cache API (PHI)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // CacheFirst — Google fonts
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open('altrixs-fonts-v1').then(async (cache) => {
        const hit = await cache.match(event.request);
        if (hit) return hit;
        const res = await fetch(event.request);
        if (res.ok) cache.put(event.request, res.clone());
        return res;
      })
    );
    return;
  }

  // StaleWhileRevalidate — dashboard pages
  if (url.pathname.startsWith('/dashboard')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        const network = fetch(event.request)
          .then((res) => {
            if (res.ok) cache.put(event.request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Default — network only
  event.respondWith(fetch(event.request));
});
