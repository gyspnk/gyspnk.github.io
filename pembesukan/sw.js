const CACHE_NAME = 'sapa-static-v1';
const BASE_PATH = '/pembesukan/';

const STATIC_ASSETS = [
  BASE_PATH,
  `${BASE_PATH}index.html`,
  `${BASE_PATH}manifest.webmanifest`,
  `${BASE_PATH}branding/tjc_logo_indonesian_color.png`,
  `${BASE_PATH}branding/tjc_logo_indonesian_color_150dpi.png`,
  `${BASE_PATH}branding/tjc_logo_indonesian_white.png`,
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Keamanan: jangan pernah cache panggilan API Firebase / Google APIs / data pribadi
  if (
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(BASE_PATH) ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebase')
  ) {
    return;
  }

  // Network-first untuk HTML navigasi agar selalu mendapat update terbaru
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(`${BASE_PATH}index.html`)),
    );
    return;
  }

  // Stale-while-revalidate hanya untuk asset statis lokal (JS/CSS/gambar branding)
  if (
    url.pathname.includes('/assets/') ||
    url.pathname.includes('/branding/') ||
    url.pathname.endsWith('.webmanifest')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetched = fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => cached);
        return cached || fetched;
      }),
    );
  }
});
