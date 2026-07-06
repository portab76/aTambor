// ============================================================
// Esp32S3_Midi — Fase 2 "MIDI → LEDs"
// ESP32-S3 como dispositivo USB-MIDI + tira WS2812B + log por WiFi.
//
// Synthesia (u otro soft MIDI) envía Note On/Off por USB y cada nota
// enciende su LED en la tira, con el mismo color por octava que usa
// el grid de midiGrid.html. El log se consulta por WiFi en /logs.
//
// Fases del sprint:
//   Fase 1  : enumerar como USB-MIDI + log de notas.        [HECHO]
//   Fase 1.5: WiFi + /logs + /setwifi + /resetwifi.         [HECHO]
//   Fase 2  : nota → LED WS2812B (ledIdx = nota − C1).      [este sketch]
//   Fase 3  : nota → motor PCA9685 (MOTOR_MAP) golpe/retracción.
//
// ── Configuración en Arduino IDE ────────────────────────────
//   Placa:               "ESP32S3 Dev Module"
//   USB Mode:            "USB-OTG (TinyUSB)"      ← IMPRESCINDIBLE
//   USB CDC On Boot:     "Disabled"
//   Flash Size:          16MB  ·  PSRAM: OPI PSRAM (placa N16R8)
//
// ── Conexionado de la tira WS2812B al S3 ────────────────────
//   DATA  → GPIO 5   (cambiar LED_DATA_PIN si usas otro)
//   5V    → fuente 5V (la tira NO se alimenta del pin 5V del S3 si
//           hay muchos LEDs encendidos; GND común obligatorio)
//   GND   → GND del S3 y de la fuente
//
//   Al arrancar, la tira hace un barrido ARCOÍRIS de ~2s: es el test
//   de verificación del conexionado (como el barrido cian del Esp32.2).
//
// ── Synthesia (Music Devices → TinyUSB MIDI) ────────────────
//   Enviar salidas a este dispositivo: ON
//   Mis notas / Instrumentos de fondo: ON
//   Percusión y Metrónomo: recomendado OFF (el canal 10 de percusión
//     se filtra igualmente en este firmware para no encender LEDs sueltos)
//   Iluminación de teclas: opcional — si se pone "Canal 16", las notas
//     que el usuario debe tocar llegan duplicadas por el canal 16 y se
//     pintan en AMARILLO (anticipación, como el "Avance" del clásico).
//
// Comandos por serie (compatibles con el protocolo de Esp32.2):
//   W ssid|pass;   guarda la red WiFi en NVS y reinicia
//   R;             borra la red y reinicia en modo AP
// ============================================================

// Guard de configuración: sin USB-OTG las clases USB/USBMIDI no existen y el
// compilador daría errores crípticos ("USBMIDI does not name a type").
#if !SOC_USB_OTG_SUPPORTED
#error "Placa incorrecta: selecciona Tools -> Board -> 'ESP32S3 Dev Module' (esta placa no tiene USB-OTG)"
#endif
#if ARDUINO_USB_MODE
#error "Config incorrecta: selecciona Tools -> USB Mode -> 'USB-OTG (TinyUSB)'"
#endif

#include "USB.h"
#include "USBMIDI.h"
#include <WiFi.h>
#include <WebServer.h>
#include <FastLED.h>

USBMIDI   MIDI;
WebServer server(80);

// AP de fallback cuando no hay red guardada o no conecta.
#define AP_SETUP_SSID "midiGrid-S3"

// ── Tira WS2812B ─────────────────────────────────────────────
// Mismo mapeo que motor-map.js: 60 LEDs cromáticos C1–B5.
//   ledIdx = notaMIDI − 24   (C1=24 → LED 0 … B5=83 → LED 59)
#define LED_DATA_PIN   5      // GPIO del S3 con el cable DATA de la tira (igual que el ESP32 clásico)
#define NUM_LEDS       60
#define LED_BASE_NOTE  24     // C1

CRGB leds[NUM_LEDS];
bool ledsDirty = false;

// Canal de "Iluminación de teclas" de Synthesia (1-16). Las notas que lleguen
// por este canal se pintan en amarillo (anticipación). 0 = desactivado.
#define KEYLIGHT_CHANNEL 16

// Canal de percusión General MIDI (no queremos LEDs con la batería).
#define PERCUSSION_CHANNEL 10

// ── Log circular (visible en /logs y por el monitor serie) ──
#define LOG_BUF_SIZE 4096
static char     logBuffer[LOG_BUF_SIZE];
static uint16_t logLen = 0;

void logMessage(const String& mensaje) {
  Serial.println(mensaje);
  size_t n = mensaje.length() + 1;          // +1 por el '\n'
  if (n >= LOG_BUF_SIZE) return;
  if (logLen + n >= LOG_BUF_SIZE) {         // lleno → descartar la mitad más antigua
    uint16_t drop = logLen / 2;
    memmove(logBuffer, logBuffer + drop, logLen - drop);
    logLen -= drop;
    if (logLen + n >= LOG_BUF_SIZE) logLen = 0;
  }
  memcpy(logBuffer + logLen, mensaje.c_str(), n - 1);
  logBuffer[logLen + n - 1] = '\n';
  logLen += n;
}

// ── Contadores para la página de estado ─────────────────────
uint32_t notasRecibidas = 0;

// ── Nombre de nota legible (C4, F#2, ...) ───────────────────
const char* NOTE_NAMES[12] = {"C","C#","D","D#","E","F","F#","G","G#","A","A#","B"};
String noteName(uint8_t note) {
  return String(NOTE_NAMES[note % 12]) + String((int)(note / 12) - 1);
}

// ============================================================
// COLOR DE NOTA — mismo esquema "como el grid" del piano roll
// (color por octava + brillo por velocity, ver piano-roll.js)
// ============================================================

const uint8_t OCT_RGB[6][3] = {
  {255, 102, 102},   // octava 1 — rojo    (graves)
  {255, 153,  68},   // octava 2 — naranja
  {221, 221,  68},   // octava 3 — amarillo
  { 68, 221,  68},   // octava 4 — verde   (centro)
  { 68, 136, 255},   // octava 5 — azul
  {187, 102, 255},   // octava 6 — violeta (agudos)
};

CRGB colorForNote(uint8_t note, uint8_t vel) {
  int oct = (int)(note / 12) - 1;
  if (oct < 1) oct = 1;
  if (oct > 6) oct = 6;
  const uint8_t* c = OCT_RGB[oct - 1];
  // Brillo por velocity: 0.20 (ppp) → 1.0 (fff), como en el grid
  float bright = 0.20f + (vel / 127.0f) * 0.80f;
  return CRGB((uint8_t)(c[0] * bright), (uint8_t)(c[1] * bright), (uint8_t)(c[2] * bright));
}

// Test de arranque: barrido arcoíris (~2s) para verificar el conexionado.
void ledStartupTest() {
  for (int i = 0; i < NUM_LEDS; i++) {
    leds[i] = CHSV((uint8_t)(i * 256 / NUM_LEDS), 230, 200);
    FastLED.show();
    delay(25);
  }
  delay(400);
  fill_solid(leds, NUM_LEDS, CRGB::Black);
  FastLED.show();
  logMessage("LED startup test OK (GPIO " + String(LED_DATA_PIN) + ", " + String(NUM_LEDS) + " LEDs)");
}

// ============================================================
// WIFI + SERVIDOR HTTP  (patrón portado de Esp32.2/web_server.cpp)
// ============================================================

void handleRoot() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  String s = "PianoRoll S3 — dispositivo USB-MIDI\n";
  s += "IP: " + (WiFi.getMode() == WIFI_AP ? WiFi.softAPIP().toString()
                                           : WiFi.localIP().toString()) + "\n";
  s += "Notas MIDI recibidas: " + String(notasRecibidas) + "\n\n";
  s += "Endpoints:\n  /logs\n  /setwifi?ssid=...&pass=...\n  /resetwifi\n";
  server.send(200, "text/plain", s);
}

void handleLogs() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "text/plain", String(logBuffer, logLen));
}

// Guarda una red nueva y reinicia (idéntico a handleSetWifi de Esp32.2).
void handleSetWifi() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  if (!server.hasArg("ssid") || server.arg("ssid").length() == 0) {
    server.send(400, "text/plain", "Error: falta parametro 'ssid'");
    return;
  }
  String ssid = server.arg("ssid");
  String pass = server.hasArg("pass") ? server.arg("pass") : "";
  server.send(200, "text/plain",
    "Red guardada: " + ssid + ". Reiniciando para conectar...\n"
    "Si conecta, el S3 tomara una IP de esa red. Si falla, volvera al AP " AP_SETUP_SSID ".");
  logMessage("SetWiFi -> guardando red '" + ssid + "' y reiniciando");
  WiFi.persistent(true);
  WiFi.begin(ssid.c_str(), pass.c_str());
  delay(500);
  ESP.restart();
}

// Borra la red guardada y reinicia en modo AP.
void handleResetWifi() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "text/plain", "WiFi reseteada. Reiniciando en modo AP (" AP_SETUP_SSID " / 192.168.4.1)...");
  logMessage("Reset WiFi -> borrando credenciales NVS y reiniciando");
  WiFi.disconnect(true, true);
  delay(500);
  ESP.restart();
}

void iniciarWifi() {
  logMessage("Iniciando WiFi...");
  WiFi.mode(WIFI_STA);
  WiFi.begin();                       // reutiliza credenciales guardadas en NVS

  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 10000) delay(250);

  if (WiFi.status() == WL_CONNECTED) {
    logMessage("Conectado a WiFi (STA). IP: " + WiFi.localIP().toString());
  } else {
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SETUP_SSID);       // AP abierto de configuración
    logMessage("Modo AP. SSID: " AP_SETUP_SSID " | IP: " + WiFi.softAPIP().toString());
  }

  server.on("/",          handleRoot);
  server.on("/logs",      handleLogs);
  server.on("/setwifi",   handleSetWifi);
  server.on("/resetwifi", handleResetWifi);
  server.begin();
  logMessage("Servidor HTTP listo (/, /logs, /setwifi, /resetwifi)");
}

// ============================================================
// COMANDOS POR SERIE — W ssid|pass;  R;   (protocolo de Esp32.2)
// ============================================================

void procesarComandoSerie(String linea) {
  linea.trim();
  if (linea.length() == 0) return;
  char   op  = linea[0];
  String arg = linea.substring(1);
  arg.trim();

  if (op == 'W') {
    int sep = arg.indexOf('|');
    String ssid = (sep == -1) ? arg : arg.substring(0, sep);
    String pass = (sep == -1) ? String("") : arg.substring(sep + 1);
    ssid.trim();
    if (ssid.length() == 0) { logMessage("ERROR: falta SSID. Uso: W ssid|pass"); return; }
    logMessage("SetWiFi (serie) -> guardando red '" + ssid + "' y reiniciando...");
    Serial.flush();
    WiFi.persistent(true);
    WiFi.begin(ssid.c_str(), pass.c_str());
    delay(500);
    ESP.restart();
  } else if (op == 'R') {
    logMessage("Reset WiFi (serie) -> borrando credenciales y reiniciando en AP...");
    Serial.flush();
    WiFi.disconnect(true, true);
    delay(500);
    ESP.restart();
  } else {
    logMessage("Comando serie desconocido: " + String(op) + " (validos: W ssid|pass; R;)");
  }
}

void leerSerie() {
  static String buf;
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r' || c == ';') {
      if (buf.length()) procesarComandoSerie(buf);
      buf = "";
    } else if (buf.length() < 160) {
      buf += c;
    }
  }
}

// ============================================================
// SETUP / LOOP
// ============================================================

void setup() {
  Serial.begin(115200);

  // Identidad USB del dispositivo. Nota: el puerto MIDI que muestran las apps
  // se llama "TinyUSB MIDI" (cadena fija del core); el productName aparece en
  // las propiedades del dispositivo en Windows.
  USB.productName("PianoRoll");
  USB.manufacturerName("elper.es");

  MIDI.begin();
  USB.begin();

  FastLED.addLeds<WS2812B, LED_DATA_PIN, GRB>(leds, NUM_LEDS);
  FastLED.setBrightness(150);
  ledStartupTest();                  // barrido arcoíris de verificación

  iniciarWifi();

  logMessage("[S3-MIDI] Fase 2 — USB-MIDI + LEDs + WiFi iniciados");
  logMessage("[S3-MIDI] Abre /logs en el navegador y envia notas desde Synthesia");
}

void loop() {
  server.handleClient();   // HTTP: /logs, /setwifi, /resetwifi
  leerSerie();             // comandos W / R por el puerto COM

  midiEventPacket_t packet;
  while (MIDI.readPacket(&packet)) {
    uint8_t cin     = packet.header & 0x0F;  // Code Index Number del paquete USB-MIDI
    uint8_t channel = (packet.byte1 & 0x0F) + 1;  // canal MIDI 1-16
    uint8_t note    = packet.byte2;
    uint8_t vel     = packet.byte3;

    // Convención MIDI: Note On con velocity 0 equivale a Note Off
    bool isOn  = (cin == 0x09) && (vel > 0);
    bool isOff = (cin == 0x08) || ((cin == 0x09) && vel == 0);
    if (!isOn && !isOff) continue;           // CC, pitch bend, etc.

    if (channel == PERCUSSION_CHANNEL) continue;  // batería: sin LEDs

    int ledIdx = (int)note - LED_BASE_NOTE;  // C1=24 → LED 0 … B5=83 → LED 59

    if (isOn) {
      notasRecibidas++;
      char msg[72];
      snprintf(msg, sizeof(msg), "[NOTE ON ] %-4s (MIDI %3u) vel=%-3u ch=%-2u led=%d",
               noteName(note).c_str(), note, vel, channel, ledIdx);
      logMessage(msg);

      if (ledIdx >= 0 && ledIdx < NUM_LEDS) {
        if (KEYLIGHT_CHANNEL && channel == KEYLIGHT_CHANNEL) {
          leds[ledIdx] = CHSV(43, 255, 220);        // amarillo: anticipación Synthesia
        } else {
          leds[ledIdx] = colorForNote(note, vel);   // color por octava + velocity
        }
        ledsDirty = true;
      }
      // Fase 3: aquí irá el golpe del motor de MOTOR_MAP[note]
#ifdef RGB_BUILTIN
      rgbLedWrite(RGB_BUILTIN, 0, 40, 10);
#endif
    } else {
      if (ledIdx >= 0 && ledIdx < NUM_LEDS) {
        leds[ledIdx] = CRGB::Black;
        ledsDirty = true;
      }
      // Fase 3: retracción del motor a home
#ifdef RGB_BUILTIN
      rgbLedWrite(RGB_BUILTIN, 0, 0, 0);
#endif
    }
  }

  if (ledsDirty) { FastLED.show(); ledsDirty = false; }
}
