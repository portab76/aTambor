# aTambor — Sistema de Percusión Robótica

**aTambor** es un sistema de composición y reproducción musical para instrumentos de percusión físicos controlados por servomotores y solenoides a través de un microcontrolador ESP32. Combina una interfaz web con hardware real, permitiendo que una máquina toque música con precisión y expresividad.

El sistema cuenta con dos entornos de trabajo complementarios:

---

## 🥁 aTambor — Drum Machine

🔗 **Demo online:** https://elper.es/aTambor/aTambor.html  
**Archivo:** `aTambor.html`

Entorno orientado a la **composición de ritmos por canales**, al estilo de las clásicas cajas de ritmos (drum machines).

### Características

- **Secuenciador paso a paso** con cuadrícula de pasos activables por canal
- **Múltiples canales de percusión** independientes, cada uno asignado a un motor físico
- **Control de tempo (BPM)** ajustable en tiempo real
- **Patrones de compás** editables: añadir, eliminar y reordenar compases
- **Modo Song**: encadena patrones en una secuencia de canción completa
- **Notas sostenidas**: duración variable por paso (golpe, medio, largo)
- **Mute por canal**: silenciar canales individuales durante la reproducción
- **Calibración de motores**: ajuste fino de posición y velocidad por canal
- **Test de golpe** individual por canal
- **Sincronización con ESP32** vía WebSocket — los motores físicos se mueven en tiempo real
- **Modo loop** y control de reproducción (play / pause / stop)
- **Colores de estado** en los pasos: activo, silenciado, actual, sostenido

---

## 🎹 midiGrid — Secuenciador MIDI con Piano Roll

🔗 **Demo online:** https://elper.es/aTambor/midiGrid.html  
**Archivo:** `midiGrid.html`

Entorno orientado a la **reproducción de archivos MIDI** sobre los motores físicos, con visualización de piano roll, análisis armónico y control avanzado del hardware.

### Carga y navegación

- **Carga de archivos MIDI** (.mid / .midi) mediante botón, menú o arrastre directo al navegador
- **Selección de canal**: selector de instrumento/canal con botón **Mostrar** — si el tab activo ya tiene contenido, abre el canal en un tab nuevo automáticamente
- **Todos (Ctrl+Shift+A)**: abre cada canal del MIDI en un tab independiente con un solo clic
- **Sistema de tabs multi-documento**: cada tab es un proyecto independiente con su propio grid, historial undo/redo, análisis armónico y scroll. Al cambiar de tab durante la reproducción, la música continúa automáticamente en el nuevo tab
- **Archivos recientes**: historial de los últimos archivos cargados con acceso rápido desde el menú

### Piano roll

- **Piano roll interactivo** con zoom ajustable (teclas −/+), scroll horizontal y vertical sincronizado
- **Edición directa de notas**: click para añadir/quitar, arrastrar para ajustar duración
- **Ctrl+Click**: editar velocity de una nota individual
- **Alt+Click**: mutear/desmutear el motor asociado a esa nota al instante — la nota aparece en gris con raya diagonal roja
- **Shift+arrastrar**: selección rectangular de notas (borrar con Delete, copiar con Ctrl+C)
- **Minimap panorámico**: vista comprimida de toda la canción con indicador de posición
- **Regla de compases tipo DAW**: seek por clic, marcadores A-B, puntos de tempo editables
- **Carril de velocidades**: editar velocity nota a nota arrastrando; **Shift+arrastrar** aplica la misma velocity a todas las notas a la vez
- **Historial Undo/Redo** (Ctrl+Z / Ctrl+Y) con 50 pasos por tab

### Reproducción y transporte

- **Play / Pause / Stop** con sincronización ESP32
- **Loop A→B**: marcar inicio y fin en la regla para repetir un fragmento
- **Mapa de tempo editable**: añadir y arrastrar puntos de BPM en la regla para crear aceleraciones y ralentizaciones
- **Streaming predictivo**: envía la secuencia al ESP32 en bloques mientras suena, minimizando la memoria del firmware

### Motor Map y Escala (panel unificado)

El botón **Motor** abre un panel único con dos secciones siempre visibles:

**🎹 Escala — Transposición global**
- Slider de transposición −32 … +24 semitonos con botones de salto rápido (−12/−1/+1/+12) y reset
- El offset es **global entre todos los tabs** y persiste al cambiar de tab
- Al pulsar una tecla del piano lateral, el motor que se mueve respeta el offset de escala
- **Alt+Click en el grid** muta el motor de esa nota respetando el offset activo
- Checkbox "Solo motores": reproduce solo las notas con motor asignado
- Vel. mín / Vel. máx: rango de velocidad al importar MIDI

**⚙ Motor Map — Mapeo nota → motor físico**
- Tabla completa MIDI → motor → HomePWM → PCA/ch → Mute
- Teclado de piano miniatura con teclas iluminadas por octava (Do1=rojo → Do6=violeta)
- Checkbox de mute por fila: silencia tanto el audio por altavoces como el ESP32
- Test de motor individual, Export/Import de configuración en JSON
- **LEDs WS2812B**: modos de color arcoíris, por octava, calor y blanco
- **Avance LED** (slider en el menú): el LED rojo se enciende N ms antes del golpe (Synthesia)

### Análisis armónico

- **Detección automática de tonalidad** con correlación de perfil de Krumhansl
- **Chord row sincronizada**: barra de acordes alineada con el piano roll y el scroll
- Cuatro niveles de vista: pasos, acordes, frases y respiración
- **Panel de acordes deslizante**: popup con info del acorde/frase, navegación ←/→, reproducción en loop
- **Auto-avance (▶▶ Auto)**: encadena segmentos automáticamente; espera confirmación del ESP32 antes de enviar el siguiente bloque (evita solapamiento de secuencias)
- **Motor de Atención (modo Calor)**: colorea el piano roll según importancia estructural de cada nota

### Conexión ESP32

- **WiFi** (WebSocket ws://IP:81) o **Serie** (Web Serial API USB-CDC)
- Indicador de estado (● verde/rojo/naranja), reconexión automática
- **Ventana de log** en tiempo real (WiFi: polling /logs · Serie: buffer interno)
- Consola de comandos directos ESP32 integrada en el modal de ayuda

---

## ⚙️ Hardware requerido

- **ESP32** con firmware aTambor (WebSocket en puerto 81)
- **PCA9685** (controladores PWM I2C): hasta 2 chips, 32 motores en total
- **Servomotores o solenoides** conectados a los canales PCA9685
- **Strip LED WS2812B** de 61 LEDs (Do1–Si5 cromático) para visualización Synthesia
- **Red WiFi** local para comunicación WebSocket, o cable USB-CDC para modo Serie

---

## 🚀 Puesta en marcha

1. Servir los archivos desde un servidor local (ej: XAMPP → `localhost/PianoRoll/`)
2. Abrir `midiGrid.html` o `aTambor.html` en el navegador
3. Conectar el ESP32 a la misma red WiFi, anotar su IP
4. Introducir la IP en el campo ESP32 y pulsar **Conectar**
5. Cargar un archivo MIDI (botón 🎵 o arrastrarlo a la ventana)
6. Seleccionar canal → **Mostrar** (o **Todos** para abrir todos los instrumentos)
7. Pulsar **▶ Play**

---

## 📁 Estructura del proyecto

```
PianoRoll/
├── midiGrid.html          # Piano roll / secuenciador MIDI
├── aTambor.html           # Drum machine
├── js/
│   ├── state.js           # Variables globales compartidas
│   ├── midi-parser.js     # Lectura y parseo de archivos MIDI
│   ├── piano-roll.js      # Renderizado del canvas y teclado lateral
│   ├── editor.js          # Edición interactiva del grid
│   ├── playback.js        # Motor de reproducción paso a paso
│   ├── timeline-ruler.js  # Regla de compases tipo DAW
│   ├── harmonic.js        # Análisis armónico y detección de tonalidad
│   ├── chord-row.js       # Chord row y auto-avance
│   ├── motor-map.js       # Mapeo nota MIDI → motor físico + LEDs
│   ├── esp32-sequencer.js # Construcción de secuencias para ESP32
│   ├── tabs.js            # Sistema de pestañas multi-documento
│   ├── transpose.js       # Panel de transposición global
│   ├── heat.js            # Motor de Atención (mapa de calor)
│   ├── velocity-lane.js   # Carril de velocidades
│   ├── minimap.js         # Minimap panorámico
│   ├── history.js         # Historial undo/redo
│   ├── persistence.js     # Guardar/cargar proyectos JSON
│   ├── active-notes-panel.js
│   ├── ws-connector.js    # Conexión WebSocket ESP32
│   ├── serial-connector.js# Conexión Serie (Web Serial API)
│   └── midiGrid.js        # Punto de entrada y cableado de eventos
└── MIDI.js/               # Librería de reproducción MIDI + SoundFont
```

---

*aTambor — donde el software toca el mundo físico.*
