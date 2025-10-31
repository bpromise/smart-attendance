/* Smart Attendance SW: cache app shell + retry failed POSTs via Background Sync */
const APP_SHELL = [
  '/', '/index.html',
  '/manifest.webmanifest', '/logo-full.png', '/logo-mark.png',
  '/icon-192.png', '/icon-512.png'
];
const SHELL_CACHE = 'sa-shell-v1';
const RUNTIME_CACHE = 'sa-runtime-v1';
const OUTBOX_DB = 'sa-outbox-db';
const OUTBOX_STORE = 'outbox';

// ---- tiny IndexedDB helpers (no external libs) ----
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OUTBOX_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(OUTBOX_STORE, { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbAdd(item) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    tx.objectStore(OUTBOX_STORE).add(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbAll() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readonly');
    const req = tx.objectStore(OUTBOX_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function idbDelete(id) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    tx.objectStore(OUTBOX_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- install: precache shell ----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

// ---- activate: cleanup old caches ----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => {
        if (![SHELL_CACHE, RUNTIME_CACHE].includes(k)) return caches.delete(k);
      }));
      await self.clients.claim();
    })()
  );
});

// ---- fetch strategy ----
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle http(s)
  if (!/^https?/.test(url.protocol)) return;

  // Cache-first for GET same-origin (static assets)
  if (req.method === 'GET' && url.origin === location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        // clone & store
        cache.put(req, res.clone());
        return res;
      } catch (e) {
        // fallback to shell for root
        if (url.pathname === '/' || url.pathname === '/index.html') {
          const shell = await caches.match('/index.html');
          if (shell) return shell;
        }
        throw e;
      }
    })());
    return;
  }

  // For API POSTs: try network; on failure queue to outbox
  if (req.method === 'POST') {
    event.respondWith((async () => {
      try {
        return await fetch(req.clone());
      } catch (e) {
        const body = await req.clone().text();
        await idbAdd({
          url: req.url,
          headers: [...req.headers.entries()],
          body,
          timestamp: Date.now(),
          method: 'POST'
        });
        // Schedule background sync
        const reg = await self.registration.sync.getTags();
        if (!reg.includes('sync-outbox')) {
          try { await self.registration.sync.register('sync-outbox'); } catch {}
        }
        // Inform client we queued it
        return new Response(JSON.stringify({ queued: true }), {
          status: 202, headers: { 'Content-Type': 'application/json' }
        });
      }
    })());
    return;
  }

  // Default: network-first
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      return res;
    } catch {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      return new Response('Offline', { status: 503 });
    }
  })());
});

// ---- background sync: replay queued POSTs ----
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-outbox') {
    event.waitUntil((async () => {
      const items = await idbAll();
      for (const item of items) {
        try {
          const hdrs = new Headers(item.headers || []);
          await fetch(item.url, { method: 'POST', headers: hdrs, body: item.body });
          await idbDelete(item.id);
        } catch (e) {
          // stop on first failure; will retry next sync
          break;
        }
      }
    })());
  }
});
