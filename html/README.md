# PianoRoll

Secuenciador MIDI web que controla un **robot pianista físico** desde el navegador, sin instalación. La aplicación corre íntegramente en el cliente (HTML + JavaScript vanilla, módulos ES6) y envía comandos de movimiento a un ESP32 que acciona servomotores ES08MA sobre las teclas de un piano, montados con piezas impresas en 3D. No hay backend: el navegador hace de DAW, analizador armónico y controlador de hardware al mismo tiempo.

El punto de entrada es `midiGrid.html`.

---

## 1. Qué es

PianoRoll edita y reproduce música en un piano roll de canvas, la analiza armónicamente en tiempo real y traduce las notas en órdenes de servo que un ESP32 ejecuta sobre un piano real. El flujo es:

```
MIDI/MML  →  grid de notas  →  análisis armónico  →  audio (Web Audio)
                                                  └→  secuencia de comandos  →  ESP32  →  servos ES08MA  →  teclas
```

El audio interno (MIDI.js + SoundFont) sirve de monitorización; el hardware reproduce la misma secuencia en paralelo, sincronizado por mensajes de *beat* que devuelve el ESP32.

---

## 2. Funcionalidades

- **Grid MIDI (piano roll).** Canvas 2D con zoom horizontal, scroll sincronizado, minimap, carril de velocidades, selección rectangular, copiar/pegar fragmentos, loop A→B, mapa de tempo editable y sistema de pestañas multi-documento con undo/redo por pestaña.
- **Entrada.** Importación de archivos `.mid`/`.midi` (parser jasmid) y de texto **MML** (Music Macro Language). Carga/guardado de proyectos en JSON e historial de recientes en `localStorage`.
- **Análisis armónico en tiempo real.** Detección de tonalidad por correlación **Krumhansl-Kessler**, reconocimiento de acordes con **Tonal.js**, fusión por tiempo y **detección de cadencias** (auténtica V→I, plagal IV→I, rota V→vi, semicadencia I→V) para segmentar en frases. Se ejecuta en un **Web Worker** para no bloquear la interfaz con archivos grandes.
- **Mapa de Atención (heat map).** Coloreado del grid por importancia estructural de cada nota.
- **Compresión a motores (🤖 Comprimir).** Casilla en la toolbar (junto a *Mostrar*) que, al construir el grid de un canal, remapea cada nota a la nota física más cercana disponible en el Motor Map — concentrando la pieza en las teclas que el robot puede tocar. La octava destino se pondera con el heat map (o cae a una octava por defecto si no hay análisis). Se habilita al cargar un MIDI con canales y se resetea con cada archivo nuevo.
- **Control de hardware ESP32.** Dos transportes: **WebSocket** sobre WiFi (`ws://IP:81`) y **USB Serial** (Web Serial API). Streaming de secuencias en bloques `APPEND`, sincronización por beats, reconexión con backoff exponencial.
- **Exportación `.mid` real.** Genera un archivo MIDI Tipo 1 binario estándar (no JSON) con mapa de tempo, compás y la transposición activa, compatible con cualquier DAW.
- **PWA instalable.** `manifest.json` + service worker con caché *cache-first*; tras la primera carga funciona sin conexión.

---

## 3. Arquitectura del código

Todo es JavaScript vanilla con **módulos ES6**. No hay framework, bundler ni paso de build. `midiGrid.html` carga un único módulo de entrada (`js/midiGrid.js`) más unas pocas librerías clásicas (MIDI.js, jasmid, Tonal.js, `harmonic-core.js`) vía `<script>`.

### Estado centralizado (`state.js`)

Un único objeto `state` exportado concentra **todo** el estado mutable de la app: eventos MIDI crudos (`rawEvents`), `ppqn`, el grid (`gridData.cells`, mapa `"nota,step" → {duration, velocity}`), `noteRows`, posición de reproducción, compás, loop A→B, segmentos armónicos, mapa de tempo (`tempoPoints`), flags de conexión hardware, etc. Ningún otro módulo declara estado global propio: todos importan `state` y lo leen/escriben. Esto hace que las pestañas funcionen guardando/restaurando una copia de los campos relevantes de `state`.

### Módulo de entrada (`midiGrid.js`)

Importa todos los demás módulos, cablea los *event listeners* de la toolbar y expone en `window` las funciones a las que apuntan los atributos `onclick` del HTML. Es el único responsable de tocar el DOM de la barra de herramientas; los módulos de lógica se comunican con él mediante objetos de callbacks (`playbackCallbacks`, `mmlCallbacks`, `projectCallbacks`) en lugar de manipular botones directamente. Las referencias DOM compartidas se centralizan en `dom-refs.js`.

### Renderizado del piano roll (`piano-roll.js`, `editor.js`, `velocity-lane.js`, `timeline-ruler.js`, `minimap.js`)

`piano-roll.js` construye el grid desde un canal MIDI y dibuja en canvas (notas, playhead, highlight de acordes, heat map), con virtualización de filas para no pintar fuera del viewport. `editor.js` gestiona la edición interactiva (click para añadir/quitar, arrastre para duración, Ctrl+Click para velocity, selección rectangular) y dispara un análisis armónico *debounced*. `velocity-lane.js` es el carril de velocidades editable; `timeline-ruler.js` la regla de compases tipo DAW con seek, loop A→B y mapa de tempo; `minimap.js` la vista panorámica con viewport arrastrable.

### Análisis armónico (`harmonic-core.js`, `harmonic.js`, `harmonic-worker.js`)

La **lógica pura** del algoritmo (segmentación temporal, Krumhansl-Kessler, reconocimiento de acordes vía Tonal.js, fusión y detección de cadencias) vive en `harmonic-core.js`, escrito para ejecutarse en dos contextos sin duplicarse: como `<script>` clásico en el hilo principal (expone `window.HarmonicCore`) y dentro de un Web Worker vía `importScripts`. `harmonic.js` es una capa fina que enlaza ese núcleo con `state` y ofrece tanto la versión síncrona como la **asíncrona** `performHarmonicAnalysisAsync()`. `harmonic-worker.js` es el worker clásico que recibe `{type:'analyze', channelEvents, ppqn, totalTicks, fusionStepsPerUnit}` y devuelve el análisis por `postMessage`, evitando que el hilo principal se congele con piezas de >500 eventos.

### Chord row y heat map (`chord-row.js`, `heat.js`, `active-notes-panel.js`)

`chord-row.js` dibuja la fila de acordes sincronizada con el grid en cuatro niveles (pasos / acordes / frases / respiración), el popup de información de acorde y el auto-avance segmento a segmento. `heat.js` calcula el "Motor de Atención" (puntuación de dominancia por nota), los segmentos de respiración y `calcularOctavaDesdeHeat()` (octava central ponderada por el heat score). `active-notes-panel.js` es el panel flotante de notas únicas presentes.

### Compresión a motores (`octave-compressor.js`)

`comprimirAMotores(rawEvents, channel, motorMap)` produce una **copia** de los eventos del canal con cada nota remapeada por pitch class al motor más cercano disponible en el `MOTOR_MAP`. La octava de referencia la da `calcularOctavaDesdeHeat()` (reutiliza `state.heatMapData` si existe, o lo calcula al vuelo; cae a una octava por defecto si no hay análisis). No muta el estado: cuando la casilla **🤖 Comprimir** está activa, `midiGrid.js` aplica la compresión sobre `state.rawEvents` solo durante `buildGridFromChannel()` y luego restaura los originales, de modo que el grid mostrado queda comprimido sin contaminar otros canales.

### Reproducción (`playback.js`)

Motor de reproducción con dos relojes desacoplados. El **scheduler de audio** agenda notas reales (`MIDI.noteOn/noteOff`) usando `AudioContext.currentTime` con un **lookahead de 100 ms** (revisado cada 25 ms con un `setInterval`), lo que elimina el jitter del temporizador del navegador y da timing *sample-accurate* incluso a BPM altos. Un segundo `setInterval` mueve solo el playhead visual (tolerancia ±30 ms, imperceptible). En paralelo envía la secuencia al ESP32 y corrige la deriva entre el navegador y el reloj físico con los mensajes `beat` del firmware. No toca el DOM: emite eventos vía `playbackCallbacks`.

### Hardware (`ws-connector.js`, `serial-connector.js`, `esp32-sequencer.js`, `motor-map.js`)

`esp32-sequencer.js` traduce `gridData` en el string de comandos del firmware (selección de motor, HomePWM, esperas, velocidad, mapeo de LEDs) y lo trocea en bloques (`validateSequenceSize`) para el streaming. `motor-map.js` mantiene la tabla **nota MIDI → motor físico** (`MOTOR_MAP`: `{note, name, motor, homePwm, muted, key}`), con routing `chip = motor/16`, `canal = motor%16`. `ws-connector.js` gestiona el WebSocket con reconexión por backoff exponencial (1·2·4·8·16 … máx 30 s, 10 intentos y luego botón "Reintentar"); `serial-connector.js` el transporte USB vía Web Serial API. Ambos comparten los flags de conexión en `state`.

### Transposición y paneles (`transpose.js`, `motor-escala-panel.js`, `app-menu.js`)

`transpose.js` aplica una transposición global de escala (±24 semitonos) con previsualización en un mini-teclado. `motor-escala-panel.js` y `app-menu.js` son paneles/menú extraídos del entry point para evitar dependencias circulares.

### Persistencia e historial (`persistence.js`, `tabs.js`, `history.js`, `recent-files.js`, `midi-parser.js`, `mml-parser.js`, `midi-export.js`, `theme.js`)

`persistence.js` guarda/carga proyectos JSON con validación de integridad; `tabs.js` el sistema multi-documento; `history.js` el undo/redo (incluye snapshot del Motor Map); `recent-files.js` el historial en `localStorage`; `midi-parser.js`/`mml-parser.js` la importación; `midi-export.js` la exportación `.mid` binaria (sufijo `_motores.mid` si el grid se construyó con la compresión activa, `_export.mid` en caso contrario); `theme.js` el tema claro/oscuro.

---

## 4. Cómo arrancarlo

### Requisitos

- **Navegador:** Chrome, Edge u Opera 89+ (necesario para Web Serial; para WiFi sirve cualquier navegador moderno con WebSocket).
- **ESP32** con el firmware correspondiente (escucha WebSocket en el puerto 81 y/o serie a 115 200 baud).

### Servir la app

La app usa módulos ES6 y un Web Worker, que requieren servirse por **HTTP** (no `file://`). Cualquier servidor estático vale:

```
# XAMPP: copiar el proyecto en htdocs y abrir
http://localhost/PianoRoll/midiGrid.html

# o con Python
python -m http.server 8000      # → http://localhost:8000/midiGrid.html

# o VS Code Live Server, etc.
```

> Abrir `midiGrid.html` directamente como `file://` no funcionará (los `import` ES6 y el worker fallan por CORS). El service worker (PWA/offline) también exige HTTP.

### Conectar el ESP32

1. **WiFi:** ESP32 y navegador en la misma red. Seleccionar modo `WiFi`, escribir la IP del ESP32 y pulsar **Conectar**.
2. **Serie:** conectar el ESP32 por USB, seleccionar modo `Serie` y pulsar **Conectar** (el navegador pedirá elegir el puerto).

El indicador ● muestra el estado de conexión. Después: abrir un MIDI (🎵), elegir canal → **Mostrar**, y **▶ Play**.

---

## 5. Tests

Los tests son una suite propia (mini-framework inline, sin dependencias) que se ejecuta en el navegador:

```
http://localhost/PianoRoll/test/runner.html
```

`runner.html` carga las librerías necesarias y ejecuta todas las suites de `test/*.test.js` (harmonic, harmonic-core, midi-parser, midi-export, mml-parser, ws-connector, persistence, editor, piano-roll, motor-map, octave-compressor). Muestra el resultado por suite en la página y vuelca un resumen en la consola.

---

## 6. Hardware

- **ESP32** — controlador; recibe comandos por WebSocket (puerto 81) o serie (115 200 baud).
- **Servomotores ES08MA** — uno por tecla a accionar; PWM de 50 Hz, posición de reposo HomePWM ≈ 375.
- **PCA9685** — controladores PWM I²C de 16 canales; routing `chip = motor/16`, `canal = motor%16` (varios chips para >16 servos).
- **Tira LED WS2812B** (opcional) — feedback visual tipo Synthesia.
- **Piezas impresas en 3D** — soportes de servo y mecanismo de pulsación; STL publicados en Printables.

---

## 7. Estructura de archivos

```
PianoRoll/
├── midiGrid.html              # App principal: piano roll, toolbar y modales (único entry point)
├── manifest.json              # Manifiesto PWA (nombre, iconos, standalone, theme #0d0d1c)
├── sw.js                      # Service worker: caché cache-first, funciona offline tras 1ª carga
├── icons/
│   ├── icon-192.png           # Icono PWA 192×192
│   └── icon-512.png           # Icono PWA 512×512
│
├── js/                        # Módulos ES6 de la aplicación
│   ├── midiGrid.js            # Módulo raíz: importa todo, cablea eventos, expone API en window
│   ├── state.js               # Objeto de estado centralizado compartido por todos los módulos
│   ├── dom-refs.js            # Referencias DOM compartidas (canvas, botones, inputs)
│   │
│   ├── midi-parser.js         # Parseo de archivos .mid (jasmid) → rawEvents
│   ├── mml-parser.js          # Parser de Music Macro Language → eventos MIDI
│   ├── midi-export.js         # Exportación de gridData a .mid binario Tipo 1
│   │
│   ├── piano-roll.js          # Construcción del grid y render Canvas 2D (notas, playhead, heat)
│   ├── editor.js              # Edición interactiva del grid (click, drag, selección, velocity)
│   ├── velocity-lane.js       # Carril de velocidades editable
│   ├── timeline-ruler.js      # Regla de compases tipo DAW: seek, loop A→B, mapa de tempo
│   ├── minimap.js             # Vista panorámica con viewport arrastrable
│   │
│   ├── harmonic-core.js       # Lógica PURA del análisis armónico (hilo principal + worker)
│   ├── harmonic.js            # Capa que enlaza el core con state; análisis sync y async
│   ├── harmonic-worker.js     # Web Worker que ejecuta el análisis fuera del hilo principal
│   ├── chord-row.js           # Fila de acordes, popup armónico y auto-avance
│   ├── heat.js                # Motor de Atención (heat map), respiración y octava ponderada
│   ├── octave-compressor.js   # Remapeo de notas a las teclas físicas del Motor Map (🤖 Comprimir)
│   ├── active-notes-panel.js  # Panel flotante de notas activas
│   │
│   ├── playback.js            # Motor de reproducción: AudioContext scheduler (lookahead 100 ms)
│   │
│   ├── ws-connector.js        # Conexión WebSocket al ESP32 (backoff exponencial, reintentos)
│   ├── serial-connector.js    # Conexión USB Serial (Web Serial API)
│   ├── esp32-sequencer.js     # Genera el string de comandos para el firmware desde gridData
│   ├── motor-map.js           # Tabla nota MIDI → motor físico + LEDs WS2812B
│   │
│   ├── transpose.js           # Transposición global de escala (±24 semitonos)
│   ├── motor-escala-panel.js  # Panel desplegable Motor Map + Escala
│   ├── app-menu.js            # Menú principal desplegable
│   │
│   ├── persistence.js         # Guardar/cargar proyectos JSON (con validación)
│   ├── tabs.js                # Sistema de pestañas multi-documento
│   ├── history.js             # Undo/redo (grid + Motor Map), 50 pasos por pestaña
│   ├── recent-files.js        # Historial de archivos recientes (localStorage)
│   └── theme.js               # Tema claro/oscuro
│
├── test/
│   ├── runner.html            # Ejecutor de toda la suite en el navegador
│   └── *.test.js              # Suites por módulo (harmonic, midi-parser, ws-connector, …)
│
└── MIDI.js/                   # Librería MIDI.js + jasmid + Tonal.js + soundfonts GM
    ├── build/MIDI.min.js      # Reproducción de audio General MIDI
    ├── inc/jasmid/            # Parser binario de archivos MIDI (stream.js, midifile.js)
    ├── tonal.min.js           # Tonal.js — teoría musical (acordes, escalas)
    └── examples/soundfont/    # SoundFonts (acoustic_grand_piano, synth_drum; mp3 y ogg)
```

---

Sin Node.js, sin npm, sin build. Todo es JavaScript vanilla servido estáticamente.
