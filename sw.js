// Service worker: lagrer appens filer på enheten, så appen åpnes raskt
// og kan startes uten nett. Varene håndteres av Firebase, ikke her.

// Bytt nummeret hvis du vil tvinge alle til å hente filene på nytt
const CACHE = "matlager-v1";

const APP_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./firebase.js",
  "./manifest.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
];

// Første gang: lagre appens filer
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

// Rydd bort gamle lagre når en ny versjon tas i bruk
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === location.origin) {
    // Appens egne filer: hent nyeste fra nettet, bruk lagret kopi uten nett
    event.respondWith(
      fetch(request)
        .then((response) => saveCopy(request, response))
        .catch(() => caches.match(request))
    );
  } else if (url.hostname === "www.gstatic.com") {
    // Firebase-biblioteket: endres aldri for samme versjon, så lagret kopi holder
    event.respondWith(
      caches.match(request).then(
        (cached) => cached || fetch(request).then((response) => saveCopy(request, response))
      )
    );
  }
  // Alt annet (f.eks. Firestore-data) går rett til nettet som vanlig
});

// Legg en kopi av svaret i lageret og send svaret videre
function saveCopy(request, response) {
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
}
