# Esp32S3_Midi — ESP32-S3 USB-MIDI LED strip for Synthesia

Turn an **ESP32-S3** into a **class-compliant USB-MIDI device** that lights a
WS2812B LED strip in sync with Synthesia, [MIDIano](https://app.midiano.com/)
(free, browser-based) — or any MIDI player (DAWs, MuseScore, MIDI-OX...).
**No drivers, no loopMIDI, no bridge software**: plug the USB cable in and
Windows sees a MIDI device.

Part of the [PianoRoll](https://elper.es) project — a web MIDI sequencer that
drives a 3D-printed piano-playing robot.

## Features

- **Class-compliant USB-MIDI** via the S3's native USB-OTG (TinyUSB). Appears
  as "TinyUSB MIDI" in Synthesia / any MIDI software. Zero install on Windows.
- **Note → LED**: each Note On lights its key on a 60-LED chromatic strip
  (C1–B5, `led = note − 24`), coloured by octave with velocity-scaled
  brightness. Note Off turns it off.
- **Synthesia key lights**: set *Key Light* → *Channel 16* in Synthesia and
  guide notes glow yellow (configurable via `KEYLIGHT_CHANNEL`).
- **Percussion filtered**: GM channel 10 never lights LEDs.
- **WiFi log & setup**: joins your WiFi (falls back to an open AP
  `midiGrid-S3` at 192.168.4.1). Endpoints: `/` (status), `/logs` (live log —
  your serial monitor without a cable), `/setwifi?ssid=..&pass=..`,
  `/resetwifi`.
- **Serial commands** (same protocol as the main PianoRoll firmware):
  `W ssid|pass;` to save WiFi, `R;` to reset it.
- **Boot test**: rainbow sweep on power-up to verify the strip wiring.

## Works with

| Player | Cost | Notes |
|---|---|---|
| [MIDIano](https://app.midiano.com/) | **Free** | Runs in the browser (Chrome/Edge, Web MIDI) — gear icon → select the device as MIDI output |
| [Synthesia](https://synthesiagame.com/) | Paid | *Settings → Music Devices* → enable as output; optional key lights on channel 16 (guide notes glow yellow) |
| [PianoBooster](https://pianobooster.sourceforge.io/) | Free (open source) | Select the device as MIDI output |
| Any DAW / MuseScore / MIDI-OX | — | Anything that can send MIDI to an output device works |

## Hardware

| Part | Detail |
|---|---|
| Board | ESP32-S3 dev board (tested on N16R8: 16 MB flash, 8 MB PSRAM) |
| LED strip | WS2812B, 60 LEDs (one per note, C1–B5) |
| Strip DATA | **GPIO 5** (`LED_DATA_PIN`) |
| Strip power | External 5 V supply for the strip, **common GND** with the S3 |

Most S3 dev boards have **two USB-C ports**: flash/log via the **COM/UART**
port; the MIDI device enumerates on the **USB/OTG** port.

## Arduino IDE setup (critical)

| Setting | Value |
|---|---|
| Board | **ESP32S3 Dev Module** |
| **USB Mode** | **USB-OTG (TinyUSB)** ← required, or `USBMIDI` won't compile |
| USB CDC On Boot | Disabled |
| Flash Size / PSRAM | 16MB / OPI PSRAM (for N16R8) |

Libraries: `FastLED` (the USB/WiFi stacks are part of the arduino-esp32 core 3.x).

## Quick start

1. Flash via the COM port. On boot the strip does a ~2 s rainbow sweep.
2. First time only — set your WiFi (choose one):
   - Serial monitor: send `W yourSSID|yourPassword`
   - Or join the `midiGrid-S3` AP and open
     `http://192.168.4.1/setwifi?ssid=yourSSID&pass=yourPassword`
3. Move the cable to the OTG port. Open `http://<board-ip>/logs` in a browser.
4. Open your player and enable **TinyUSB MIDI** as output — e.g. Synthesia
   (*Settings → Music Devices*, turn its *Metronome* off) or MIDIano in the
   browser (gear icon → MIDI output). Play a song — the strip follows it.

## Roadmap

- [x] Phase 1 — USB-MIDI enumeration + note logging
- [x] Phase 1.5 — WiFi, web log, WiFi setup endpoints
- [x] Phase 2 — Note → LED with octave colours & key-light channel
- [ ] Phase 3 — Note → solenoid motors (PCA9685, motor map from PianoRoll)

## License

MIT — see [LICENSE](../LICENSE).

---

### Resumen en español

Firmware que convierte un ESP32-S3 en un **dispositivo USB-MIDI estándar**:
Windows lo detecta sin drivers y Synthesia, [MIDIano](https://app.midiano.com/)
(gratuito, en el navegador) o cualquier reproductor MIDI le envía las notas,
que iluminan una tira WS2812B de 60 LEDs (una por tecla, C1–B5) con color por
octava y brillo según velocity. Incluye log y
configuración WiFi por web (`/logs`, `/setwifi`), comandos serie `W`/`R`
compatibles con el firmware principal, y test arcoíris al arrancar.
Configuración crítica del IDE: placa *ESP32S3 Dev Module* + **USB Mode:
USB-OTG (TinyUSB)**. Fase 3 (motores) en desarrollo.
