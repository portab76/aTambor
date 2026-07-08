// ============================================================
// sw.js — Service Worker (PWA) para PianoRoll
//
// Debe estar en la RAÍZ del proyecto: el scope de un service worker se limita
// a su propio directorio, y necesitamos controlar midiGrid.html (raíz) + js/ +
// MIDI.js/. Por eso se registra como './sw.js' y no desde js/.
//
// Estrategia: cache-first para los assets estáticos listados en PRECACHE_URLS
// (precargados en install). El resto de peticiones GET del mismo origen se
// sirven de caché si están, con fallback a red (y se cachean al vuelo).
//
// Versionado: al cambiar CACHE_NAME, el evento activate borra las versiones
// antiguas.
// ============================================================

const CACHE_NAME = 'midiGrid-v3';

// Lista EXPLÍCITA de URLs a precachear (rutas relativas al scope = raíz).
const PRECACHE_URLS = [
    // App shell
    './',
    './midiGrid.html',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',

    // Librerías externas (cargadas por <script> en midiGrid.html)
    './MIDI.js/inc/shim/Base64.js',
    './MIDI.js/inc/shim/Base64binary.js',
    './MIDI.js/inc/shim/WebAudioAPI.js',
    './MIDI.js/inc/jasmid/stream.js',
    './MIDI.js/inc/jasmid/midifile.js',
    './MIDI.js/build/MIDI.min.js',
    './MIDI.js/tonal.min.js',

    // Módulos ES6 del proyecto (js/*.js)
    './js/midiGrid.js',
    './js/state.js',
    './js/dom-refs.js',
    './js/app-menu.js',
    './js/motor-escala-panel.js',
    './js/harmonic-core.js',
    './js/harmonic.js',
    './js/harmonic-worker.js',
    './js/midi-parser.js',
    './js/mml-parser.js',
    './js/midi-export.js',
    './js/piano-roll.js',
    './js/timeline-ruler.js',
    './js/chord-row.js',
    './js/active-notes-panel.js',
    './js/playback.js',
    './js/history.js',
    './js/editor.js',
    './js/persistence.js',
    './js/transpose.js',
    './js/heat.js',
    './js/theme.js',
    './js/tabs.js',
    './js/velocity-lane.js',
    './js/minimap.js',
    './js/recent-files.js',
    './js/motor-map.js',
    './js/esp32-sequencer.js',
    './js/ws-connector.js',
    './js/serial-connector.js',

    // SoundFont del instrumento por defecto (audio embebido base64). Se cachean
    // mp3 y ogg; el navegador usa el formato que soporte. synth_drum como extra.
    './MIDI.js/examples/soundfont/acoustic_grand_piano-mp3.js',
    './MIDI.js/examples/soundfont/acoustic_grand_piano-ogg.js',
    './MIDI.js/examples/soundfont/synth_drum-mp3.js',
    './MIDI.js/examples/soundfont/synth_drum-ogg.js',
];

// ── install: precachear el app shell ──────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            // addAll falla si UNA sola URL falla (404). Cacheamos una a una para
            // ser tolerantes a assets opcionales (p.ej. soundfont ogg ausente).
            await Promise.all(PRECACHE_URLS.map(async (url) => {
                try {
                    const resp = await fetch(url, { cache: 'reload' });
                    if (resp.ok) await cache.put(url, resp);
                    else console.warn('[sw] precache omitido (no ok):', url, resp.status);
                } catch (e) {
                    console.warn('[sw] precache falló:', url, e.message);
                }
            }));
        }).then(() => self.skipWaiting())
    );
});

// ── activate: limpiar versiones antiguas de la caché ──────────
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter((k) => k !== CACHE_NAME).map((k) => {
                console.log('[sw] borrando caché antigua:', k);
                return caches.delete(k);
            })
        )).then(() => self.clients.claim())
    );
});

// ── fetch: cache-first para GET del mismo origen ──────────────
self.addEventListener('fetch', (event) => {
    const req = event.request;

    // Solo GET; ignoramos otras (no se pueden cachear de forma fiable).
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    // Solo gestionamos peticiones del mismo origen (no el ESP32, no CDNs).
    if (url.origin !== self.location.origin) return;

    // No interceptar la suite de tests ni el propio SW/manifest: deben ir
    // SIEMPRE a la red, sin caché ni fallback al shell de la app. (Si el SW
    // los gestionara, una navegación a test/runner.html con el servidor caído
    // acabaría sirviendo midiGrid.html — la pantalla de la app.)
    if (url.pathname.includes('/test/') ||
        url.pathname.endsWith('/sw.js') ||
        url.pathname.endsWith('/manifest.json')) {
        return;   // deja pasar a la red por defecto
    }

    event.respondWith(
        caches.match(req).then((cached) => {
            if (cached) return cached;
            // No estaba en caché: ir a red y cachear al vuelo (mismo origen).
            return fetch(req).then((resp) => {
                if (resp && resp.ok && resp.type === 'basic') {
                    const copy = resp.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                }
                return resp;
            }).catch(() => {
                // Sin red y sin caché: para navegaciones DENTRO de la app,
                // servir el shell (midiGrid.html). Para otras rutas, error.
                if (req.mode === 'navigate' && url.pathname.endsWith('/midiGrid.html')) {
                    return caches.match('./midiGrid.html');
                }
                return Response.error();
            });
        })
    );
});
