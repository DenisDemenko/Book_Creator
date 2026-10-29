/* GrabFusion service worker. Версія й перелік оболонки підставляє сервер (__VERSION__, __SHELL__).
   Що робить: сторінка (оболонка) відкривається без звʼязку; API й фото НІКОЛИ не кешуються —
   це приватні дані викладача, а черга нових фото живе в IndexedDB сторінки. */
const VERSION = '__VERSION__';
const CACHE = 'grabfusion-shell-' + VERSION;
const SCOPE = self.registration.scope; // напр. https://fusionlab.in.ua/grabfisionstidio/
const SHELL = __SHELL__.map((p) => new URL(p, SCOPE).href);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('grabfusion-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.href.startsWith(SCOPE)) return;
  const rel = url.href.slice(SCOPE.length);
  if (rel.startsWith('api/') || rel === 'healthz' || rel === 'sw.js') return; // дані — лише з мережі

  if (req.mode === 'navigate') {
    // Мережа першою (щоб бачити свіжу версію), без звʼязку — збережена оболонка.
    event.respondWith(
      fetch(req).catch(() => caches.match(SCOPE).then((r) => r || Response.error())),
    );
    return;
  }
  // Статика оболонки: з кешу (версія кешу змінюється разом із файлами), решта — мережа.
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
