const CACHE_NAME = 'lernplan-v1.7.4';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/css/styles.css',
    '/js/app.js',
    '/manifest.json',
    '/css/leistung.css',
    '/js/leistung.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.url.includes('/api/')) {
        // API: Network first, fall back to cache
        event.respondWith(
            fetch(request).catch(() => caches.match(request))
        );
    } else {
        // Static: Cache first
        event.respondWith(
            caches.match(request).then(cached => cached || fetch(request))
        );
    }
});
