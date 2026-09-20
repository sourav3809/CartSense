const CACHE_NAME = 'cartsense-cache-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
  '/icon-maskable.svg'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching application shell');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Skip non-GET requests and chrome-extension/external origins (except google fonts)
  if (request.method !== 'GET' || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    return;
  }

  // 1. API Requests: Network-First strategy
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Do NOT permanently cache authenticated API responses.
          // Return the fresh network response directly.
          return response;
        })
        .catch((error) => {
          console.log('[Service Worker] API request failed (device offline):', url.pathname);
          // Return a friendly JSON message for the offline state to prevent exposing raw fetch errors
          return new Response(
            JSON.stringify({
              offline: true,
              error: "You're offline. Some information may be unavailable until your connection is restored."
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        })
    );
    return;
  }

  // 2. Navigation Requests: Network-First with Cache Fallback to index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache the fresh navigated page shell
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put('/', clone);
          });
          return response;
        })
        .catch(() => {
          console.log('[Service Worker] Navigation failed, serving cached shell index.html');
          return caches.match('/').then((cachedResponse) => {
            return cachedResponse || caches.match('/index.html');
          });
        })
    );
    return;
  }

  // 3. Static Assets: Stale-While-Revalidate strategy
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch((err) => {
          console.warn('[Service Worker] Fetch failed for asset:', request.url, err);
          // Return cached response if available even if network failed
          return cachedResponse;
        });

      return cachedResponse || fetchPromise;
    })
  );
});

// Update Listener
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Helper: Validate deep link destinations safely
function validateRouteInSW(route) {
  if (!route || typeof route !== 'string') return '/';
  const cleanRoute = route.trim();
  const lower = cleanRoute.toLowerCase();

  const validExactRoutes = ['/', '/running-low', '/prices', '/settings', '/history', '/insights'];
  if (validExactRoutes.includes(lower)) {
    return lower;
  }

  if (lower.startsWith('/order/')) {
    const parts = cleanRoute.split('/');
    if (parts.length >= 3) {
      const platform = parts[2].trim();
      if (platform && platform.length > 0) {
        return `/order/${encodeURIComponent(platform.toLowerCase())}`;
      }
    }
  }

  return '/';
}

// Helper: Broadcast analytics event to all open client windows
function broadcastAnalytics(eventName, params = {}) {
  try {
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => {
        client.postMessage({
          type: 'ANALYTICS_EVENT',
          eventName,
          params
        });
      });
    }).catch((e) => console.warn('[Service Worker] Analytics broadcast warning:', e));
  } catch (e) {
    console.warn('[Service Worker] Analytics broadcast error:', e);
  }
}

// Push Event Handler
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push event received');
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { body: event.data.text() };
    }
  }

  event.waitUntil(
    (async () => {
      // Check client-side reminder suppression ("Remind Me Later")
      try {
        const cache = await caches.open('cartsense-reminders-v1');
        const match = await cache.match('/remind-later-until');
        if (match) {
          const text = await match.text();
          const suppressUntil = parseInt(text, 10);
          if (Date.now() < suppressUntil) {
            console.log('[Service Worker] Push notification suppressed due to Remind Me Later rule');
            return;
          }
        }
      } catch (err) {
        console.warn('[Service Worker] Error checking reminder suppression:', err);
      }

      // Max 1 simultaneous notification enforcement: close older active notifications
      try {
        const existingNotifications = await self.registration.getNotifications();
        for (const activeNotif of existingNotifications) {
          activeNotif.close();
        }
      } catch (e) {
        console.warn('[Service Worker] Error closing previous notifications:', e);
      }

      // Safe defaults for all payload fields
      const title = data.title || 'CartSense 🛒';
      const targetRoute = validateRouteInSW(data.data?.route || '/running-low');
      const options = {
        body: data.body || 'Your stock check is ready. Tap to review.',
        icon: data.icon || '/icon-192.svg',
        badge: data.badge || '/icon-192.svg',
        image: data.image || undefined,
        tag: 'cartsense-nudge',
        renotify: true,
        data: { ...data.data, route: targetRoute },
        actions: data.actions || [
          { action: 'review_stock', title: 'Review Stock' },
          { action: 'remind_later', title: 'Remind Me Later' }
        ],
        timestamp: data.timestamp || Date.now()
      };

      broadcastAnalytics('Notification Received', { title, tag: options.tag });

      return self.registration.showNotification(title, options);
    })()
  );
});

// Notification Click Handler (Deep Linking & Actions)
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification click action:', event.action);
  const notification = event.notification;
  const action = event.action;
  const data = notification.data || {};

  // Action 1: Remind Me Later
  if (action === 'remind_later') {
    notification.close();
    const suppressUntil = Date.now() + 2 * 60 * 60 * 1000;
    event.waitUntil(
      (async () => {
        try {
          const cache = await caches.open('cartsense-reminders-v1');
          await cache.put(
            '/remind-later-until',
            new Response(suppressUntil.toString(), {
              headers: { 'Content-Type': 'text/plain' }
            })
          );
        } catch (err) {
          console.warn('[Service Worker] Failed to save remind-later timestamp:', err);
        }
        broadcastAnalytics('Notification Action Clicked', { action: 'remind_later', tag: notification.tag });
      })()
    );
    return;
  }

  // Action 2: Review Stock or Default Body Tap
  notification.close();

  let targetRoute = data.route || data.url || '/';
  if (action === 'review_stock') {
    targetRoute = '/running-low';
  }
  targetRoute = validateRouteInSW(targetRoute);

  const targetUrl = new URL(targetRoute, self.location.origin).href;

  broadcastAnalytics(
    action ? 'Notification Action Clicked' : 'Notification Opened',
    { action: action || 'default', route: targetRoute, tag: notification.tag }
  );

  event.waitUntil(
    (async () => {
      if (data.userId) {
        try {
          await fetch(`/api/users/${data.userId}/nudge/open`, { method: 'POST' });
        } catch (e) {
          // ignore offline failure
        }
      }

      // Tab reuse: focus most recently active CartSense window tab
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      let targetClient = null;
      for (const client of clientList) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin) {
          if (client.focused) {
            targetClient = client;
            break;
          }
          if (!targetClient) {
            targetClient = client;
          }
        }
      }

      if (targetClient) {
        await targetClient.focus();
        targetClient.postMessage({ type: 'NAVIGATE', url: targetRoute });
        return;
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })()
  );
});

// Notification Close Event
self.addEventListener('notificationclose', (event) => {
  const notification = event.notification;
  console.log('[Service Worker] Notification closed:', notification.tag);
  broadcastAnalytics('Notification Closed', { tag: notification.tag });
  broadcastAnalytics('Notification Dismissed', { tag: notification.tag });
});

