const CACHE_NAME = 'trafxos-v15';
const ASSETS = [
    './',
    './index.html',
    './app.css',
    './app.js',
    './manifest.json',
    './firebase-config.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

// Install — cache core assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate — clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Fetch — network-first for local files (so updates land immediately), cache-first for CDN
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Skip Firebase/Google API requests — always network
    if (url.hostname.includes('firebaseio.com') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('gstatic.com') ||
        url.hostname.includes('firebaseapp.com')) {
        return;
    }

    // Local app files (same origin): network-first so updates land immediately
    if (url.origin === self.location.origin) {
        event.respondWith(
            fetch(event.request).then(response => {
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => caches.match(event.request))
        );
        return;
    }

    // External CDN assets: cache-first (they don't change)
    event.respondWith(
        caches.match(event.request).then(cached => {
            return cached || fetch(event.request).then(response => {
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            });
        })
    );
});

// Push notifications
self.addEventListener('push', event => {
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'TrafxOS';
    const options = {
        body: data.body || 'You have a new alert',
        icon: 'https://i.postimg.cc/PxH6xwBr/web-app-manifest-192x192.png',
        badge: 'https://i.postimg.cc/PxH6xwBr/web-app-manifest-192x192.png',
        data: { url: data.url || './' },
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click — open the app
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = event.notification.data?.url || './';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            for (const client of windowClients) {
                if (client.url.includes('trafxos') && 'focus' in client) return client.focus();
            }
            return clients.openWindow(url);
        })
    );
});
