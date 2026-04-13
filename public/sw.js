const CACHE_NAME = "private-ai-v2";

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

  // Model files from huggingface — let the library handle its own caching
  // We skip intercepting these because large model files use range requests (HTTP 206)
  // which the Cache API does not support
  if (url.hostname.includes("huggingface.co") || url.hostname.includes("hf.co") || url.hostname.includes("cdn-lfs")) {
    return;
  }

  // Navigation requests (HTML pages) — network first, fallback to cache
  // This ensures users always get the latest index.html with correct asset hashes
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets — cache first, fallback to network
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
