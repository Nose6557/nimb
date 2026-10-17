/* NIMB service worker — офлайн-оболонка й інсталяція PWA.
   Навігація → network-first з фолбеком на кеш. Свої статики → stale-while-revalidate.
   Чужі домени (Supabase, CDN, шрифти, погода) не перехоплюємо.
   Бампни NIMB_VERSION у version.js — старий кеш видалиться сам. */
importScripts("version.js");
const CACHE = "nimb-v" + NIMB_VERSION;
const SHELL = [".", "index.html", "style.css", "version.js", "config.js", "store.js", "tags.js", "env.js", "charts.js", "app.js", "manifest.json", "favicon/icon.svg", "favicon/icon-192.png", "favicon/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => { caches.open(CACHE).then((c) => c.put("index.html", res.clone())); return res; })
      .catch(() => caches.match("index.html").then((r) => r || caches.match("."))));
    return;
  }
  e.respondWith(caches.match(req).then((cached) => {
    const net = fetch(req).then((res) => { caches.open(CACHE).then((c) => c.put(req, res.clone())); return res; }).catch(() => cached);
    return cached || net;
  }));
});
