/* PromptLab service worker —— 只缓存应用外壳，数据永远走 localStorage */
const CACHE = 'promptlab-shell-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/ui/styles.css',
  './src/ui/app.js',
  './src/core/template.js',
  './src/core/diff.js',
  './src/core/stats.js',
  './src/core/store.js',
  './src/core/persist.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 网络优先、失败回落缓存：保证更新即时可达，同时断网仍能打开
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
