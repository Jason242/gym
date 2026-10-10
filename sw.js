/*
 * App-shell cache so the installed app opens with weak or no signal at the
 * gym. Data never goes through here: the record lives in IndexedDB and on the
 * server, and /api, /mcp and OAuth routes are always passed straight through.
 * A new version waits until every window of the app is closed before taking
 * over, so an update never swaps code under a session in progress.
 *
 * Also shows the "new plan" notification the owner's server pushes when a chat
 * proposes a plan (only after the owner turned notifications on in More).
 */
const CACHE = "gym-shell-v2"; // v2 (5 Oct 2026): the rabbit icon replaces the old one
// Where the app lives: "/" on its own domain, "/gym/" under https://jason242.github.io/gym/.
const BASE = new URL(self.registration.scope).pathname;
const at = (path) => BASE + path;
const SHELL = [BASE, at("manifest.webmanifest"), at("apple-touch-icon.png"), at("icon-192.png")];
const PASS_THROUGH = ["/api/", "/mcp", "/oauth", "/authorize", "/token", "/register", "/revoke", "/.well-known/"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (PASS_THROUGH.some((p) => url.pathname.startsWith(p))) return;

  if (request.mode === "navigate") {
    // Network first for the page itself. Only the app's own page replaces the cached copy; anything else
    // (no signal, an error page, a removed site, a parked domain) opens the copy on this phone instead,
    // so the record stored here always stays reachable.
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          const html = response.ok && (response.headers.get("content-type") || "").includes("text/html") ? await response.clone().text() : "";
          if (html.includes('id="root"')) {
            const cache = await caches.open(CACHE);
            await cache.put(BASE, new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }));
            return response;
          }
          return (await caches.match(BASE)) || response;
        })
        .catch(() => caches.match(BASE).then((cached) => cached || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith(at("assets/")) || url.pathname.startsWith(at("ocr/"))) {
    // Hashed build files and the versioned screen-reader folder (ocr/v2/) never change: cache first.
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});

self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(message.title || "Gym tracker", {
      body: message.body || "",
      tag: message.tag || "gym",
      icon: at("icon-192.png"),
      badge: at("icon-192.png"),
      data: { url: message.url || BASE },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || BASE, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        open.postMessage({ type: "open", url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
