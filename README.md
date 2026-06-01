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

Entorno orientado a la **reproducción de archivos MIDI** sobre los motores físicos, con visualización de piano roll y análisis armónico.

### Características

- **Carga de archivos MIDI** (.mid / .midi) con selección de canal/instrumento
- **Piano roll interactivo**: visualización de notas con zoom, scroll y edición directa
- **Reproducción de audio** con SoundFont (instrumento virtual por software)
- **Sincronización física**: envía la secuencia completa al ESP32 para que los motores toquen en paralelo con el audio
- **Nuevo documento vacío**: crea un grid en blanco de 1 compás con las notas del Motor Map
- **Análisis armónico automático**: detecta tonalidad, grados y acordes por segmento
- **Chord row**: barra de acordes sincronizada con el piano roll
- **Motor Map**: tabla de asignación nota MIDI → motor físico, editable en tiempo real
  - Teclado de piano miniatura con teclas iluminadas por octava
  - **Glissando interactivo**: desliza el ratón con el botón pulsado para tocar notas consecutivas activando motores y sonido simultáneamente
  - Exportar / importar configuración de motores en JSON
  - Test de motor individual desde la tabla
- **Código de colores por octava** (arcoíris): Do1=rojo → Do6=violeta, tanto en el piano roll como en el Motor Map
- **Panel de notas activas**: muestra qué notas del instrumento tienen motor asignado
- **Persistencia de proyecto**: guardar y cargar sesiones completas en JSON
- **Exportar a MIDI**: genera un archivo .mid desde el grid editado
- **Conexión ESP32** configurable: IP editable, indicador de estado, reconexión automática
- **Loop** y control de transporte completo (play / pause / stop)

---

## ⚙️ Hardware requerido

- **ESP32** con firmware `midiGrid` (WebSocket en puerto 81)
- **PCA9685** (controladores PWM): hasta 2 chips en buses I2C independientes (32 motores)
- **Servomotores o solenoides** conectados a los canales PCA9685
- **Red WiFi** local para comunicación WebSocket entre navegador y ESP32

---

## 🚀 Puesta en marcha

1. Conectar el ESP32 a la red WiFi local y anotar su IP
2. Servir los archivos HTML desde un servidor local (ej: XAMPP → `localhost/aTambor/`)
3. Abrir `aTambor.html` o `midiGrid.html` en el navegador
4. Introducir la IP del ESP32 y pulsar **Conectar**
5. Cargar un MIDI o crear un patrón y pulsar **Play**

---

*aTambor — donde el software toca el mundo físico.*
