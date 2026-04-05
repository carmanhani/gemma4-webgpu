const CACHE_NAME = "private-ai-v1";

// App shell files to cache on install
const APP_SHELL = [
  "/",
  "/index.html",
  "/favicon.png",
  "/clockin.png",
  "/logo.png",
  "/manifest.json",
];

// Install: cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && !k.startsWith("transformers")).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for model files (huggingface), cache-first for app shell
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Model files from huggingface — cache them persistently
  if (url.hostname.includes("huggingface.co") || url.hostname.includes("hf.co")) {
    event.respondWith(
      caches.open("transformers-cache").then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) {
          cache.put(event.request, response.clone());
        }
        return response;
      })
    );
    return;
  }

  // App shell — cache first, fallback to network
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
