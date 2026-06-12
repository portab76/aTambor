# aTambor — Sistema de Composición Musical para Instrumentos Robóticos

**aTambor** es un entorno web de composición y reproducción musical para instrumentos físicos controlados por servomotores y solenoides a través de un ESP32. Combina un secuenciador MIDI profesional con análisis armónico en tiempo real y control directo de hardware, permitiendo que una máquina toque música con expresividad.

El sistema cuenta con dos entornos de trabajo complementarios accesibles desde el navegador, sin instalación.

---

## Entornos

### 🎹 midiGrid — Secuenciador MIDI con Piano Roll

**Archivo:** `midiGrid.html`

Entorno principal orientado a la **composición y reproducción de música melódica** sobre instrumentos físicos. Piano roll interactivo, análisis armónico, exportación MIDI y control total del hardware ESP32.

---

### 🥁 aTambor — Drum Machine

**Archivo:** `aTambor.html`

Entorno orientado a la **composición rítmica por canales**, al estilo de las clásicas cajas de ritmos. Secuenciador paso a paso con patrones editables y sincronización con motores físicos.

---

## Características de midiGrid

### Importación y archivo

| Función | Descripción |
|---------|-------------|
| Abrir MIDI | Botón 🎵, menú o arrastrar `.mid` / `.midi` a la ventana |
| Importar MML | Music Macro Language — formato de texto compacto para melodías |
| **Exportar MIDI** | Genera archivo `.mid` Tipo 1 estándar compatible con Ableton, Logic, MuseScore, Cubase — incluye mapa de tempo y transposición activa |
| Guardar proyecto | JSON con grid, análisis armónico, mapa de tempo y marcadores de sección |
| Cargar proyecto | Importar JSON guardado previamente |
| Archivos recientes | Historial de los últimos 10 proyectos con tiempo transcurrido |

### Piano roll

- **Canvas interactivo** con zoom horizontal ajustable (1–32 px/paso), scroll sincronizado y minimap panorámico
- **Click** — añadir / quitar nota
- **Click + arrastrar →** — ajustar duración de la nota
- **Ctrl + Click** — editar velocity con tooltip inline sobre la nota (sin prompt nativo)
- **Alt + Click** — mutear / desmutear el motor físico de esa nota
- **Shift + arrastrar** — selección rectangular con borde azul
- **Carril de velocidades** visible por defecto — arrastrar edita la velocity del paso; Shift+arrastrar aplica a todas las notas a la vez
- **Historial Undo / Redo** (Ctrl+Z / Ctrl+Y) — 50 pasos por tab, independiente entre tabs

### Reproducción y transporte

- **Motor de audio AudioContext** con scheduler de lookahead 100 ms — timing sample-accurate sin jitter, incluso a 200 BPM
- **Play / Pause / Stop** con sincronización automática al ESP32
- **Seek** haciendo clic en la regla de compases
- **Loop A→B** — marcar inicio y fin en la regla para repetir un fragmento en audio y hardware
- **Mapa de tempo editable** — puntos de BPM editables en la regla para crear aceleraciones y ralentizaciones; interpolación automática
- **Streaming predictivo** — envía la secuencia al ESP32 en bloques APPEND mientras suena, sin límite de longitud

### Análisis armónico

- **Detección de tonalidad automática** por correlación Krumhansl-Kessler (24 claves mayor/menor)
- **Chord row** sincronizada con el piano roll en cuatro niveles de detalle:
  - **pasos** — micro-segmentos, uno por cada cambio de notas activas
  - **acordes** — fusionado por negra, acorde dominante cada 4 pasos
  - **frases** — detectadas por cadencias (V→I, IV→I, ii→V→I, vi→IV)
  - **respiración** — zonas de baja energía óptimas para resetear el buffer ESP32
- Click en cualquier bloque abre un popup con nombre del acorde, función tonal (I, ii, V…) y notas
- **Loop de segmento** y **Auto-avance** segmento a segmento con confirmación de beat del ESP32

### Motor de Atención — Mapa de Calor

- Colorea el piano roll por importancia estructural mediante un algoritmo de atención basado en softmax 4D (paso, nota, duración, velocity)
- Rojo = nota dominante · Azul = nota subordinada
- Exclusivo: no existe esta visualización en ningún DAW web conocido

### Sistema de tabs

- Cada tab es un proyecto independiente con su propio grid, historial de undo y análisis armónico
- Portapapeles compartido entre tabs — permite trasladar secciones entre composiciones
- Al cambiar de tab la reproducción se detiene y el estado se guarda automáticamente

### Motor Map + Escala

- **Tabla nota MIDI → motor físico** con HomePWM, canal PCA, mute y atajo de teclado por fila
- Mute por fila silencia audio interno y ESP32 simultáneamente
- Test de motor individual, Export / Import JSON
- **Transposición global** ±24 semitonos — offset compartido entre todos los tabs, aplicado al ESP32 vía APPEND en caliente
- **LEDs WS2812B** — modos: octava, arcoíris, calor, blanco
- **Avance LED** (slider) — el LED de anticipación se enciende N ms antes del golpe (efecto Synthesia)

### Conexión ESP32

- **WiFi** — WebSocket `ws://IP:81`, auto-reconexión cada 5 s
- **Serie** — Web Serial API USB-CDC a 115 200 baud (Chrome / Edge 89+)
- Indicador de estado ● en tiempo real
- **Ventana Log** con log en tiempo real y consola de comandos directos al ESP32

---

## Características de aTambor (Drum Machine)

- Secuenciador paso a paso con cuadrícula de pasos activables por canal
- Múltiples canales de percusión independientes, cada uno asignado a un motor físico
- Control de tempo (BPM) ajustable en tiempo real
- Patrones de compás editables: añadir, eliminar y reordenar
- **Modo Song** — encadena patrones en una secuencia de canción completa
- Notas sostenidas con duración variable por paso (golpe, medio, largo)
- Mute por canal durante la reproducción
- Calibración de HomePWM y velocidad por canal
- Test de golpe individual por canal
- Sincronización con ESP32 vía WebSocket

---

## Atajos de teclado principales (midiGrid)

| Atajo | Acción |
|-------|--------|
| Ctrl + Z | Deshacer |
| Ctrl + Y / Ctrl+Shift+Z | Rehacer |
| Ctrl + C | Copiar selección rectangular |
| Ctrl + V | Pegar en posición del playhead |
| Ctrl + Shift + V | Pegar una octava más arriba |
| Ctrl + Alt + V | Pegar una octava más abajo |
| Ctrl + Shift + A | Abrir todos los canales en tabs separados |
| Delete / Backspace | Borrar notas seleccionadas |
| Escape | Deseleccionar / cerrar modal |
| Click en regla | Seek · marcar A o B si loop activo |

---

## Puesta en marcha

### Requisitos

- Servidor local (XAMPP, VS Code Live Server, Python `http.server`…)
- Chrome o Edge 89+ para Web Serial; cualquier navegador moderno para WiFi

### Pasos

```
1. Copiar la carpeta PianoRoll/ en el directorio web del servidor
2. Abrir http://localhost/PianoRoll/midiGrid.html en el navegador
3. Conectar el ESP32 a la misma red WiFi o por USB-CDC
4. Introducir la IP del ESP32 → pulsar Conectar  (o seleccionar modo Serie)
5. Abrir un archivo MIDI con el botón 🎵 o arrastrarlo a la ventana
6. Seleccionar canal → Mostrar  (o Todos para abrir todos los instrumentos)
7. Pulsar ▶ Play
```

---

## Estructura del proyecto

```
PianoRoll/
├── midiGrid.html              # Secuenciador MIDI / piano roll principal
├── aTambor.html               # Drum machine
├── js/
│   ├── state.js               # Variables globales compartidas entre módulos
│   ├── midi-parser.js         # Lectura y parseo de archivos MIDI (jasmid)
│   ├── mml-parser.js          # Parser de Music Macro Language → eventos MIDI
│   ├── midi-export.js         # Exportación de gridData a archivo .mid estándar
│   ├── piano-roll.js          # Renderizado Canvas 2D y teclado lateral
│   ├── editor.js              # Edición interactiva del grid (click, drag, selección)
│   ├── velocity-lane.js       # Carril de velocidades con edición por arrastre
│   ├── timeline-ruler.js      # Regla de compases tipo DAW con mapa de tempo
│   ├── minimap.js             # Vista panorámica con viewport arrastrable
│   ├── playback.js            # Motor de reproducción — AudioContext scheduler lookahead
│   ├── harmonic.js            # Análisis armónico: Krumhansl-Kessler + Tonal.js
│   ├── chord-row.js           # Chord row, popup de acorde y auto-avance
│   ├── heat.js                # Motor de Atención — mapa de calor por softmax
│   ├── esp32-sequencer.js     # Generador de secuencias de comandos para ESP32
│   ├── ws-connector.js        # Conexión WebSocket al ESP32
│   ├── serial-connector.js    # Conexión Serie vía Web Serial API
│   ├── motor-map.js           # Tabla nota MIDI → motor físico + LEDs WS2812B
│   ├── transpose.js           # Panel de transposición global con visualización piano
│   ├── tabs.js                # Sistema de pestañas multi-documento
│   ├── history.js             # Historial undo/redo por tab (50 pasos)
│   ├── persistence.js         # Guardar / cargar proyectos JSON
│   ├── theme.js               # Sistema de temas claro / oscuro
│   ├── active-notes-panel.js  # Panel flotante de notas activas
│   ├── recent-files.js        # Historial de archivos recientes (localStorage)
│   └── midiGrid.js            # Punto de entrada: DOM, inicialización, eventos
├── MIDI.js/                   # Librería MIDI.js + jasmid + soundfonts GM
│   ├── build/MIDI.min.js
│   ├── inc/jasmid/            # Parser binario MIDI
│   └── examples/soundfont/    # Soundfonts GM en MP3
└── tonal.min.js               # Tonal.js — teoría musical (acordes, escalas)
```

---

## Hardware

### Componentes

| Componente | Cantidad | Notas |
|------------|----------|-------|
| ESP32 (cualquier variante) | 1 | Firmware aTambor, WebSocket puerto 81 |
| PCA9685 (controlador PWM I2C) | 2 | Direcciones 0x40 y 0x41, hasta 32 motores |
| Servomotores o solenoides | hasta 32 | 50 Hz PWM |
| Strip LED WS2812B | 1 × 61 LEDs | Do1–Si5 cromático |
| **Módulo XL4015 Buck 75W** | 1 | Regulación + protección sobretemperatura + voltímetro |
| Fuente de alimentación | 1 | Ver rango de entrada XL4015: 8–36V |

### Diagrama de bloques

```
┌─────────────────────────────────────────────────────────┐
│                    NAVEGADOR (Chrome/Edge)               │
│              midiGrid.html  ·  aTambor.html             │
└──────────────────┬──────────────────────────────────────┘
                   │ WiFi WebSocket ws://IP:81
                   │   ó  USB-CDC Web Serial API
                   ▼
         ┌─────────────────┐
         │     ESP32        │
         │  Firmware aTambor│
         └──┬──────┬───┬───┘
            │I2C   │   │GPIO
            ▼      ▼   ▼
      ┌──────┐ ┌──────┐ ┌────────────────┐
      │PCA   │ │PCA   │ │ WS2812B        │
      │9685  │ │9685  │ │ 61 LEDs        │
      │#0    │ │#1    │ │ Do1 – Si5      │
      │0x40  │ │0x41  │ └────────────────┘
      │M0–15 │ │M16–31│
      └──┬───┘ └──┬───┘
         │PWM     │PWM
         ▼        ▼
    ┌──────────────────────────────┐
    │  Módulo XL4015 Buck 75W      │ ◄── Fuente 8–36V entrada
    │  Regulación + OTP + OCP      │
    │  Voltímetro display          │
    └─────────────┬────────────────┘
                  │ Vout ajustado
    ┌─────────────▼────────────────┐
    │    Servos / Solenoides × 16+ │
    └──────────────────────────────┘
```

### Configuración PCA9685

| Chip | Dirección I2C | Motores | Jumpers A0–A5 |
|------|--------------|---------|---------------|
| PCA9685 #0 | `0x40` | 0 – 15 | todos a GND |
| PCA9685 #1 | `0x41` | 16 – 31 | A0 a VCC, resto GND |

- Frecuencia PWM: **50 Hz**
- HomePWM de reposo: **375** (≈ 1,46 ms)
- Routing: `PCA = motor ÷ 16` · `canal = motor mod 16`

### Strip LED WS2812B

| Parámetro | Valor |
|-----------|-------|
| LEDs totales | 61 |
| Rango | LED 0 (reservado) → LED 60 (Si5) |
| Nota base | C1 (MIDI 24) = LED 1 |
| Fórmula índice | `ledIdx = MIDI_note − 23` |
| Protocolo | WS2812B 800 kHz |
| Alimentación | 5V independiente |
| Resistencia | 330 Ω en serie en el pin Data |
| Condensador | 100–1000 µF entre VCC y GND del strip |

Modos de color: **octava · arcoíris · calor · blanco**  
LED de anticipación: rojo (hue FastLED = 0), N ms antes del golpe.

### Motor Map por defecto
```
| Nota | MIDI | Motor | PCA | Ch |
|------|------|-------|-----|----|
| A1 | 33 | 12 | 0 | 12 |
| B1 | 35 | 13 | 0 | 13 |
| C2 | 36 | 0  | 0 | 0  |
| C#2 | 37 | 10 | 0 | 10 |
| D2 | 38 | 1  | 0 | 1  |
| D#2 | 39 | 11 | 0 | 11 |
| E2 | 40 | 2  | 0 | 2  |
| F2 | 41 | 3  | 0 | 3  |
| F#2 | 42 | 7  | 0 | 7  |
| G2 | 43 | 4  | 0 | 4  |
| G#2 | 44 | 8  | 0 | 8  |
| A2 | 45 | 5  | 0 | 5  |
| A#2 | 46 | 9  | 0 | 9  |
| B2 | 47 | 6  | 0 | 6  |
| C3 | 48 | 14 | 0 | 14 |
| D3 | 50 | 15 | 0 | 15 |

```
## Protocolo ESP32 ↔ Navegador

Transporte: **WebSocket** puerto 81 (`ws://IP:81`) o **Web Serial** 115 200 baud.
```
### Comandos navegador → ESP32

| Comando | Formato | Descripción |
|---------|---------|-------------|
| `PLAY` | `PLAY\|midiGrid\|<stepMs>\|<advMs>\|<advHue>\n<seq>` | Cargar y ejecutar secuencia |
| `APPEND` | `APPEND\n<seq>` | Encolar bloque siguiente (streaming) |
| `STOP` | `STOP` | Detener reproducción |
| `p;` | `p;` | Arrancar secuencia ya cargada (WebSocket) |

### Instrucciones de secuencia

| Instrucción | Ejemplo | Descripción |
|-------------|---------|-------------|
| `e;` | `e;` | Reset motores al inicio del bloque |
| `m N;` | `m 0;` | Seleccionar motor N |
| `o PWM;` | `o 375;` | Posición de reposo (HomePWM) |
| `t Ms;` | `t 80;` | Esperar Ms milisegundos |
| `v Vel;` | `v 80;` | Aplicar velocidad (0 = reposo, 1–100) |
| `L m i h s;` | `L 0 13 20 230;` | Motor m → LED índice i, hue h, saturación s |
| `c Ms;` | `c 500;` | Marcador de compás (corrección drift I2C) |

Tiempos de golpe por defecto: **HIT = 80 ms · RETRACT = 150 ms**

### Mensajes ESP32 → navegador (JSON)

| Mensaje | Descripción |
|---------|-------------|
| `{"state":"playing"}` | Reproducción iniciada |
| `{"state":"stopped"}` | Reproducción terminada |
| `{"state":"beat","step":N}` | Beat N — corrección de deriva visual entre browser y ESP32 |

---

## Dependencias y compatibilidad

| Componente | Versión | Uso |
|------------|---------|-----|
| MIDI.js + jasmid | incluido en `MIDI.js/` | Reproducción audio GM + parseo binario MIDI |
| Tonal.js | incluido en `tonal.min.js` | Detección de acordes y escalas |
| Web Audio API | nativo | AudioContext scheduler sample-accurate |
| Web Serial API | Chrome / Edge 89+ | Conexión USB-CDC al ESP32 |
| WebSocket API | todos los navegadores modernos | Conexión WiFi al ESP32 |
| Canvas 2D | todos los navegadores modernos | Renderizado del piano roll |

No requiere Node.js, npm ni ningún proceso de build. Todo el código es vanilla JavaScript.

---

*aTambor — donde el software toca el mundo físico.*
