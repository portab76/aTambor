#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>
#include <algorithm>
#include <FastLED.h>
#include <WiFi.h>
#include "web_server.h"

// ============================================================
// CONFIGURACIÓN PCA9685 Y SERVOS — MULTI-PCA DINÁMICO
// Motor routing: chip = motor/16,  canal = motor%16
// Los PCAs se detectan automáticamente en setup() via I2C scan.
// ============================================================

#define MAX_PCA_SLOTS   8
#define MOTORS_PER_PCA  16
#define MAX_SERVOS_ABS  (MAX_PCA_SLOTS * MOTORS_PER_PCA)  // 128

// Dual I2C bus
#define SDA_BUS0  21
#define SCL_BUS0  22
#define SDA_BUS1  16
#define SCL_BUS1  17

uint8_t numPcasDetected = 0;
uint8_t numServosActive = 0;

Adafruit_PWMServoDriver pcaArray[MAX_PCA_SLOTS];
bool                    pcaPresent[MAX_PCA_SLOTS] = {false};

#define SERVO_MIN     150    // PWM → 0°
#define SERVO_MAX     600    // PWM → 180°
#define SERVO_NEUTRAL 375    // PWM → 90°

uint8_t frecuenciaPWM = 60; // Hz

int posicionActual[MAX_SERVOS_ABS] = {0};
int homePosicion[MAX_SERVOS_ABS];

// ============================================================
// WS2812B LED STRIP
// ============================================================

#define LED_DATA_PIN  5
#define NUM_LEDS      60

CRGB    leds[NUM_LEDS];
bool    ledsDirty = false;

// Mapeo motor → índice LED + color (255 = sin LED asignado).
// Configurado desde el browser con 'L motor ledIdx hue sat;' antes de cada PLAY.
uint8_t motorToLed[MAX_SERVOS_ABS];
uint8_t motorHue[MAX_SERVOS_ABS];
uint8_t motorSat[MAX_SERVOS_ABS];

// Color por-LED para eventos "LED-only" (notas que suenan pero NO tienen motor
// asignado). Se configuran desde el browser con 'K ledIdx hue sat;' antes del
// PLAY, y los eventos LED_ONLY_ID los usan para encender leds[ledIdx].
uint8_t ledOnlyHue[NUM_LEDS];
uint8_t ledOnlySat[NUM_LEDS];
void initMotorToLed() {
  memset(motorToLed, 255, sizeof(motorToLed));
  memset(motorHue,   128, sizeof(motorHue));
  memset(motorSat,   230, sizeof(motorSat));
  memset(ledOnlyHue, 128, sizeof(ledOnlyHue));
  memset(ledOnlySat, 230, sizeof(ledOnlySat));
}

// ============================================================
// SISTEMA DE COLAS FIFO PARALELAS (UNA POR MOTOR)
// Límites dimensionados para canciones completas sin paginado.
// MAX_MOV_POR_MOTOR 800 ≈ 32 compases a semicorchea por motor.
// ============================================================

#define MAX_MOV_POR_MOTOR  800
#define MAX_EVENTOS        7000

struct MovimientoMotor {
  uint16_t tiempo;      // Duración en ms
  int8_t   velocidad;   // -100..100  (0 = neutro/silencio)
  bool     invertido;   // Invertir dirección del golpe
};

struct EventoMotor {
  uint32_t timestamp;   // ms desde inicio de reproducción
  uint8_t  motor;
  uint16_t posicion;    // valor PWM calculado
};

EventoMotor eventos[MAX_EVENTOS];

// Colas dinámicas: se asignan en el primer uso (ensureMotorQueue)
MovimientoMotor* colasMotores[MAX_SERVOS_ABS]        = {nullptr};
uint16_t numMovimientosPorMotor[MAX_SERVOS_ABS]       = {0};
uint16_t indiceEscrituraPorMotor[MAX_SERVOS_ABS]      = {0};
uint16_t indiceLecturaPorMotor[MAX_SERVOS_ABS]        = {0};

bool ensureMotorQueue(uint8_t motor) {
  if (colasMotores[motor] != nullptr) return true;
  colasMotores[motor] = new MovimientoMotor[MAX_MOV_POR_MOTOR];
  if (colasMotores[motor] == nullptr) {
    Serial.println("ERROR: out of memory for motor " + String(motor));
    return false;
  }
  return true;
}

// ============================================================
// VARIABLES TEMPORALES (estado del parser m/t/v)
// ============================================================

uint8_t  motorTemporal         = 255;   // 255 = no definido
uint16_t tiempoTemporal        = 0;
bool     motorTemporalInvertido = false;

// ============================================================
// CONTROL DE REPRODUCCIÓN
// ============================================================

bool          modoRepeticion    = false;
volatile bool detenerRepeticion = false;
bool          reproduciendo     = false;
bool          g_pendingPlay     = false;  // activado por p;/r; desde callback WS

// Estado global del loop de reproducción (necesario para APPEND)
uint16_t  g_numEventos   = 0;
uint32_t  g_tiempoMaximo = 0;
uint32_t  g_tiempoInicio = 0;   // millis() cuando arrancó la secuencia actual
uint16_t  g_eventoActual = 0;   // índice del próximo evento a ejecutar

// ── NoteOn/NoteOff — estado por motor ────────────────────────
// Timeout de seguridad: si el motor lleva NOTE_ON_TIMEOUT_MS en posición
// de golpe sin recibir F, el firmware lo devuelve a home automáticamente.
#define NOTE_ON_TIMEOUT_MS 2000

uint32_t noteOnTimestamp[MAX_SERVOS_ABS];  // millis() del último NoteOn
bool     noteOnActive[MAX_SERVOS_ABS];     // true = motor en posición de golpe

// Parámetros de beat (enviados por el browser en el header de PLAY)
uint32_t  g_stepMs       = 0;   // ms por semicorchea (0 = beat desactivado)
uint32_t  g_ultimoBeat   = 0;   // timestamp del último beat emitido
uint32_t  g_advanceMs    = 0;   // ms de anticipación LED Synthesia (0 = desactivado)

// Marcadores de sincronía por compás (comando c N;)
#define MAX_SYNC_MARKERS 200
#define SYNC_MOTOR_ID    0xFF   // ID reservado para eventos de sync (no es un motor real)
#define LED_ADV_ID       0xFE   // ID reservado para pre-eventos LED Synthesia (amarillo)
#define LED_ONLY_ID      0xFD   // ID reservado para eventos LED-only (notas sin motor)
                                // posicion: byte alto = ledIdx, byte bajo = 1 (on) / 0 (off)
uint32_t syncTimestamps[MAX_SYNC_MARKERS];
uint8_t  numSyncMarkers = 0;

// Cola de eventos LED-only (notas sin motor). Cada entrada = un encendido o
// apagado con su timestamp. Se rellena con el comando 'k ts ledIdx on;' antes
// del PLAY y se vuelca en generarArrayEventos() como eventos LED_ONLY_ID.
// Empaquetado (5 bytes) y capacidad acotada para no desbordar la DRAM: el bit 7
// de ledIdxOn codifica on/off y los bits 0-6 el ledIdx (0-60 caben de sobra).
#define MAX_LED_ONLY_EVENTS 2000
struct __attribute__((packed)) LedOnlyEvent { uint32_t ts; uint8_t ledIdxOn; };
LedOnlyEvent ledOnlyEvents[MAX_LED_ONLY_EVENTS];
uint16_t     numLedOnlyEvents = 0;

// ============================================================
// BUFFER SERIAL
// ============================================================

#define MAX_CMD_LENGTH 128
char    cmdBuffer[MAX_CMD_LENGTH];
uint8_t cmdIndex = 0;

// Buffer dinámico para comandos WS-protocol por serial (PLAY/STOP/APPEND/SETLED).
// Se asigna en heap solo durante la recepción y se libera tras procesar.
#define MAX_WS_SERIAL_LEN 9000
static char* _wsSerBuf = nullptr;
static int   _wsSerIdx  = 0;
static bool  _wsSerMode = false;

// ============================================================
// DECLARACIONES FORWARD
// ============================================================

void logMessage(const String& mensaje);
void procesarComandoComun(char comando, const String& argumento);
void procesarComandoCmd(const String& comando);
void detenerTodosServos();
void info();
bool validarServoNum(int num);
void inicializarSistema();
void procesarBufferComando();
void debugEstadoServos();
bool agregarMovimientoAColaMotor(uint8_t motor, uint16_t tiempo, int8_t velocidad, bool invertido);
void ejecutarMovimientosParalelos();
void borrarTodasLasColas();
void mostrarTodasLasColas();
void configurarMotorTemporal(const String& argumento);
void configurarTiempoTemporal(const String& argumento);
void agregarMovimientoDesdeTemporales(const String& argumento);
void configurarLedMapping(const String& argumento);
void configurarLedOnlyColor(const String& argumento);
void encolarLedOnlyEvent(const String& argumento);
void configurarWifiSerie(const String& argumento);
void resetWifiSerie();
void agregarPausaDesdeTemporales();
bool tieneMovimientos(uint8_t motor);
uint8_t contarMotoresActivos();
uint32_t calcularTiempoTotalMotor(uint8_t motor);
void verificarComandoDetener();
void irAPosicionDirecta(const String& argumento);
void establecerHomePosicion(const String& argumento);
void noteOn(const String& argumento);
void noteOff(const String& argumento);
uint16_t generarArrayEventos(uint32_t& tiempoMaximo);
bool estaReproduciendo();
void procesarComandoWs(const String& msg);
void wsPushBeat(uint32_t stepIndex);

// ============================================================
// HELPER PWM — routing motor → PCA → canal
// ============================================================

inline void setServoPWM(uint8_t motor, uint16_t pwm) {
  uint8_t slot  = motor / MOTORS_PER_PCA;
  uint8_t canal = motor % MOTORS_PER_PCA;
  if (slot >= MAX_PCA_SLOTS || !pcaPresent[slot]) {
    logMessage("WARN: motor " + String(motor) + " -> PCA[" + String(slot) + "] not present");
    return;
  }
  pcaArray[slot].setPWM(canal, 0, pwm);
}

// ============================================================
// LOGGING
// ============================================================

void logMessage(const String& mensaje) {
  Serial.println(mensaje);
  agregarLog(mensaje);
}

// ============================================================
// SETUP Y LOOP
// ============================================================

void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);

  Wire.begin(SDA_BUS0, SCL_BUS0);
  Wire1.begin(SDA_BUS1, SCL_BUS1);

  numPcasDetected = 0;

  Wire.beginTransmission(0x40);
  if (Wire.endTransmission() == 0) {
    pcaArray[0] = Adafruit_PWMServoDriver(0x40, Wire);
    pcaArray[0].begin();
    pcaArray[0].setPWMFreq(frecuenciaPWM);
    pcaPresent[0] = true;
    numPcasDetected++;
    Serial.println("PCA[0] found on Bus0 GPIO" + String(SDA_BUS0) + "/" + String(SCL_BUS0) + " (motors 0-15)");
  }

  Wire1.beginTransmission(0x40);
  if (Wire1.endTransmission() == 0) {
    pcaArray[1] = Adafruit_PWMServoDriver(0x40, Wire1);
    pcaArray[1].begin();
    pcaArray[1].setPWMFreq(frecuenciaPWM);
    pcaPresent[1] = true;
    numPcasDetected++;
    Serial.println("PCA[1] found on Bus1 GPIO" + String(SDA_BUS1) + "/" + String(SCL_BUS1) + " (motors 16-31)");
  }

  if (numPcasDetected == 0) {
    Serial.println("FATAL: no PCA9685 found on any I2C bus!");
    while (1) delay(500);
  }
  // numServosActive debe cubrir hasta el slot más alto detectado,
  // no solo el conteo. Ejemplo: si solo está slot 1 (Bus1, motors 16-31)
  // necesitamos 32 slots activos, no 16.
  uint8_t highestSlot = 0;
  for (uint8_t s = 0; s < MAX_PCA_SLOTS; s++) {
    if (pcaPresent[s]) highestSlot = s;
  }
  numServosActive = (highestSlot + 1) * MOTORS_PER_PCA;
  Serial.println("Total PCAs: " + String(numPcasDetected) +
                 " | Highest slot: " + String(highestSlot) +
                 " | Active motors: 0-" + String(numServosActive - 1));

  inicializarSistema();
  initMotorToLed();

  FastLED.addLeds<WS2812B, LED_DATA_PIN, GRB>(leds, NUM_LEDS);
  FastLED.setBrightness(150);
  // Test de arranque: barrido completo de los 60 LEDs (30 ms/LED → ~2 s total)
  fill_solid(leds, NUM_LEDS, CRGB::Black);
  for (int i = 0; i < NUM_LEDS; i++) {
    leds[i] = CRGB(0, 100, 200);   // cian para distinguirlo del uso normal
    FastLED.show();
    delay(30);
  }
  delay(400);
  fill_solid(leds, NUM_LEDS, CRGB::Black);
  FastLED.show();
  Serial.println("LED startup test OK (GPIO " + String(LED_DATA_PIN) + ", " + String(NUM_LEDS) + " LEDs)");

  iniciarServidorWeb();
  logMessage("midiGrid firmware listo");
}

void loop() {
  manejarServidorWeb();

  // ── Timeout de seguridad NoteOn ───────────────────────────────
  // Si un motor lleva NOTE_ON_TIMEOUT_MS en posición de golpe sin
  // recibir F (NoteOff), lo devuelve a home para evitar quemarlo.
  {
    uint32_t ahora = millis();
    for (uint8_t i = 0; i < numServosActive; i++) {
      if (noteOnActive[i] && (ahora - noteOnTimestamp[i]) >= NOTE_ON_TIMEOUT_MS) {
        setServoPWM(i, homePosicion[i]);
        posicionActual[i] = homePosicion[i];
        noteOnActive[i]   = false;
        logMessage("NoteOn TIMEOUT motor " + String(i) + " -> home (seguridad)");
      }
    }
  }

  // Ejecutar reproducción desde loop() — nunca desde un callback WebSocket.
  // El callback solo activa el flag; loop() hace el trabajo bloqueante en Core 1.
  if (g_pendingPlay && !reproduciendo) {
    g_pendingPlay = false;
    ejecutarMovimientosParalelos();
  }

  while (Serial.available()) {
    char c = Serial.read();

    // Detectar inicio de comando WS-protocol (PLAY, STOP, APPEND, SETLED)
    if (!_wsSerMode && _wsSerIdx == 0 &&
        (c == 'P' || c == 'S' || c == 'A')) {
      if (!_wsSerBuf) _wsSerBuf = (char*)malloc(MAX_WS_SERIAL_LEN);
      if (!_wsSerBuf) { logMessage("ERROR: sin heap para serial WS"); }
      else _wsSerMode = true;
    }

    if (_wsSerMode) {
      // Acumular hasta '\0' (terminador que envía serial-connector.js)
      if (c == '\0' || _wsSerIdx >= MAX_WS_SERIAL_LEN - 1) {
        _wsSerBuf[_wsSerIdx] = '\0';
        procesarComandoWs(String(_wsSerBuf));
        _wsSerIdx  = 0;
        _wsSerMode = false;
      } else {
        _wsSerBuf[_wsSerIdx++] = c;
      }
    } else {
      // Parser original — comandos cortos de debug (m 2; t 80; v 80; p;)
      if (c == ';' || c == '\n') {
        cmdBuffer[cmdIndex] = '\0';
        if (cmdIndex > 0) procesarBufferComando();
        cmdIndex = 0;
      } else if (c == '\0') {
        // Terminador de serial-connector.js: ignorar (el ';' anterior ya procesó)
        cmdIndex = 0;
      } else if (cmdIndex < MAX_CMD_LENGTH - 1) {
        cmdBuffer[cmdIndex++] = c;
      } else {
        logMessage("ERROR: Buffer serial lleno");
        cmdIndex = 0;
      }
    }
  }
}

// ============================================================
// PROCESAMIENTO DE COMANDOS
// ============================================================

void procesarBufferComando() {
  String cmd = String(cmdBuffer);
  cmd.trim();
  if (cmd.length() == 0) return;
  logMessage("CMD: " + cmd);
  procesarComandoCmd(cmd);
}

void procesarComandoCmd(const String& comando) {
  int start = 0;
  while (start < (int)comando.length()) {
    int end = comando.indexOf(';', start);
    if (end == -1) end = comando.length();
    String sub = comando.substring(start, end);
    sub.trim();
    if (sub.length() > 0) {
      char   op  = sub[0];
      String arg = sub.substring(1);
      arg.trim();
      procesarComandoComun(op, arg);
    }
    start = end + 1;
  }
}

void procesarComandoComun(char comando, const String& argumento) {
  switch (comando) {
    case 'v': agregarMovimientoDesdeTemporales(argumento); break;
    case 's': agregarPausaDesdeTemporales();               break;
    case 't': configurarTiempoTemporal(argumento);         break;
    case 'm': configurarMotorTemporal(argumento);          break;

    case 'p':
      modoRepeticion    = false;
      detenerRepeticion = false;
      g_pendingPlay     = true;   // loop() llama a ejecutarMovimientosParalelos()
      break;

    case 'r':
      modoRepeticion    = true;
      detenerRepeticion = false;
      g_pendingPlay     = true;
      break;

    case 'c': {
      uint32_t ts = (uint32_t)argumento.toInt();
      if (numSyncMarkers < MAX_SYNC_MARKERS) {
        syncTimestamps[numSyncMarkers++] = ts;
      }
      break;
    }

    case 'e': borrarTodasLasColas();   break;

    case 'L': configurarLedMapping(argumento); break;
    case 'K': configurarLedOnlyColor(argumento); break;   // K ledIdx hue sat (color notas sin motor)
    case 'k': encolarLedOnlyEvent(argumento); break;      // k ts ledIdx on  (evento LED-only)
    case 'l': mostrarTodasLasColas();  break;

    case 'x':
      modoRepeticion    = false;
      detenerRepeticion = true;
      detenerTodosServos();
      logMessage("Stop solicitado");
      break;

    case 'N': noteOn(argumento);                 break;
    case 'F': noteOff(argumento);               break;

    case 'd': debugEstadoServos();              break;
    case 'g': irAPosicionDirecta(argumento);    break;
    case 'o': establecerHomePosicion(argumento); break;
    case 'h': info();                           break;

    case 'W': configurarWifiSerie(argumento);   break;   // W ssid|pass
    case 'R': resetWifiSerie();                 break;   // borra red y reinicia en AP

    default:
      logMessage("ERROR: Comando desconocido: " + String(comando));
      break;
  }
}

// ============================================================
// CONFIGURACIÓN WIFI POR SERIE
// ------------------------------------------------------------
// Réplica de los endpoints HTTP /setwifi y /resetwifi (web_server.cpp),
// pero disparada desde el puerto serie. Permite configurar/borrar la red
// sin tener que conectarse antes al AP "midiGrid-Setup".
// ============================================================

// Guarda una red WiFi y reinicia para conectarse a ella.
// Uso serie: "W ssid|pass"  (pass puede ir vacío para redes abiertas).
// El separador es '|' porque el parser de comandos ya trocea por ';',
// y una contraseña WiFi sí puede contener ';'.
void configurarWifiSerie(const String& argumento) {
  int sep = argumento.indexOf('|');
  String ssid = (sep == -1) ? argumento : argumento.substring(0, sep);
  String pass = (sep == -1) ? String("") : argumento.substring(sep + 1);
  ssid.trim();
  if (ssid.length() == 0) {
    logMessage("ERROR: falta SSID. Uso: W ssid|pass");
    return;
  }
  logMessage("SetWiFi (serie) -> guardando red '" + ssid + "' y reiniciando...");
  Serial.flush();
  WiFi.persistent(true);                  // fuerza persistencia en NVS
  WiFi.begin(ssid.c_str(), pass.c_str());
  delay(500);
  ESP.restart();
}

// Borra la red guardada en NVS y reinicia en modo AP (midiGrid-Setup / 192.168.4.1).
// Uso serie: "R"
void resetWifiSerie() {
  logMessage("Reset WiFi (serie) -> borrando credenciales NVS y reiniciando en modo AP...");
  Serial.flush();
  WiFi.disconnect(true, true);            // desconecta + borra credenciales de NVS
  delay(500);
  ESP.restart();
}

// ============================================================
// CONFIGURACIÓN DE MOVIMIENTOS
// ============================================================

void configurarMotorTemporal(const String& argumento) {
  if (argumento.length() == 0) {
    logMessage("ERROR: Especificar motor (ej: m 3 o m 3-)");
    return;
  }
  String numStr = argumento;
  numStr.trim();
  bool invertir = numStr.endsWith("-");
  if (invertir) numStr = numStr.substring(0, numStr.length() - 1);
  int motorNum = numStr.toInt();
  if (!validarServoNum(motorNum)) {
    logMessage("ERROR: Motor " + String(motorNum) + " fuera de rango (0-" + String(numServosActive - 1) + ")");
    return;
  }
  motorTemporal          = motorNum;
  motorTemporalInvertido = invertir;
  logMessage("Motor: " + String(motorTemporal) + (motorTemporalInvertido ? " (inv)" : ""));
}

void configurarTiempoTemporal(const String& argumento) {
  uint16_t tiempo = argumento.toInt();
  if (tiempo >= 1 && tiempo <= 60000) {
    tiempoTemporal = tiempo;
  } else {
    logMessage("ERROR: Tiempo fuera de rango (1-60000ms)");
  }
}

void agregarMovimientoDesdeTemporales(const String& argumento) {
  if (motorTemporal == 255) { logMessage("ERROR: Selecciona motor primero (m N)"); return; }
  if (tiempoTemporal == 0)  { logMessage("ERROR: Configura tiempo primero (t MS)"); return; }
  int factor = argumento.toInt();
  if (factor < -100 || factor > 100) { logMessage("ERROR: Velocidad fuera de rango (-100..100)"); return; }
  agregarMovimientoAColaMotor(motorTemporal, tiempoTemporal, (int8_t)factor, motorTemporalInvertido);
}

void agregarPausaDesdeTemporales() {
  if (motorTemporal == 255) { logMessage("ERROR: Selecciona motor primero"); return; }
  if (tiempoTemporal == 0)  { logMessage("ERROR: Configura tiempo primero"); return; }
  agregarMovimientoAColaMotor(motorTemporal, tiempoTemporal, 0, false);
}

// Formato argumento: "motor ledIdx hue sat"  (ej: "5 12 85 230")
void configurarLedMapping(const String& argumento) {
  int vals[4] = {-1, -1, 128, 230};
  int idx = 0, start = 0;
  for (int i = 0; i <= (int)argumento.length() && idx < 4; i++) {
    if (i == (int)argumento.length() || argumento[i] == ' ') {
      if (i > start) vals[idx++] = argumento.substring(start, i).toInt();
      start = i + 1;
    }
  }
  if (vals[0] < 0 || vals[1] < 0) { logMessage("LED map ERROR: bad args [" + argumento + "]"); return; }
  int motor = vals[0], ledIdx = vals[1];
  if (motor >= 0 && motor < MAX_SERVOS_ABS && ledIdx >= 0 && ledIdx < NUM_LEDS) {
    motorToLed[motor] = (uint8_t)ledIdx;
    motorHue[motor]   = (uint8_t)vals[2];
    motorSat[motor]   = (uint8_t)vals[3];
    logMessage("LED m=" + String(motor) + " led=" + String(ledIdx) + " h=" + String(vals[2]));
  } else {
    logMessage("LED map OOB: m=" + String(motor) + " led=" + String(ledIdx));
  }
}

// Color para un LED "solo" (nota sin motor). Formato: "ledIdx hue sat"
// El color lo consumen los eventos LED_ONLY_ID al encender leds[ledIdx].
void configurarLedOnlyColor(const String& argumento) {
  int vals[3] = {-1, 128, 230};
  int idx = 0, start = 0;
  for (int i = 0; i <= (int)argumento.length() && idx < 3; i++) {
    if (i == (int)argumento.length() || argumento[i] == ' ') {
      if (i > start) vals[idx++] = argumento.substring(start, i).toInt();
      start = i + 1;
    }
  }
  int ledIdx = vals[0];
  if (ledIdx >= 0 && ledIdx < NUM_LEDS) {
    ledOnlyHue[ledIdx] = (uint8_t)vals[1];
    ledOnlySat[ledIdx] = (uint8_t)vals[2];
  } else {
    logMessage("LED-only OOB: led=" + String(ledIdx));
  }
}

// Encola un evento LED-only. Formato: "ts ledIdx on"  (on = 1 encender / 0 apagar)
// ts en ms desde el inicio de la reproducción.
void encolarLedOnlyEvent(const String& argumento) {
  int vals[3] = {-1, -1, 0};
  int idx = 0, start = 0;
  for (int i = 0; i <= (int)argumento.length() && idx < 3; i++) {
    if (i == (int)argumento.length() || argumento[i] == ' ') {
      if (i > start) vals[idx++] = argumento.substring(start, i).toInt();
      start = i + 1;
    }
  }
  if (vals[0] < 0 || vals[1] < 0 || vals[1] >= NUM_LEDS) return;
  if (numLedOnlyEvents >= MAX_LED_ONLY_EVENTS) return;
  uint8_t ledIdxOn = (uint8_t)(vals[1] & 0x7F) | (vals[2] ? 0x80 : 0x00);
  ledOnlyEvents[numLedOnlyEvents++] = { (uint32_t)vals[0], ledIdxOn };
}

// ============================================================
// GESTIÓN DE COLAS FIFO
// ============================================================

bool agregarMovimientoAColaMotor(uint8_t motor, uint16_t tiempo, int8_t velocidad, bool invertido) {
  if (!validarServoNum(motor))         return false;
  if (!ensureMotorQueue(motor))        return false;
  if (numMovimientosPorMotor[motor] >= MAX_MOV_POR_MOTOR) {
    logMessage("ERROR: Cola llena motor " + String(motor));
    return false;
  }
  uint16_t idx = indiceEscrituraPorMotor[motor];
  colasMotores[motor][idx] = { tiempo, velocidad, invertido };
  indiceEscrituraPorMotor[motor] = (idx + 1) % MAX_MOV_POR_MOTOR;
  numMovimientosPorMotor[motor]++;
  return true;
}

bool tieneMovimientos(uint8_t motor)  { return numMovimientosPorMotor[motor] > 0; }

uint8_t contarMotoresActivos() {
  uint8_t c = 0;
  for (uint8_t i = 0; i < numServosActive; i++) if (tieneMovimientos(i)) c++;
  return c;
}

uint32_t calcularTiempoTotalMotor(uint8_t motor) {
  uint32_t total = 0;
  uint16_t idx   = indiceLecturaPorMotor[motor];
  for (uint16_t i = 0; i < numMovimientosPorMotor[motor]; i++) {
    total += colasMotores[motor][idx].tiempo;
    idx = (idx + 1) % MAX_MOV_POR_MOTOR;
  }
  return total;
}

void borrarTodasLasColas() {
  for (uint8_t i = 0; i < numServosActive; i++) {
    numMovimientosPorMotor[i]  = 0;
    indiceLecturaPorMotor[i]   = 0;
    indiceEscrituraPorMotor[i] = 0;
  }
  numSyncMarkers   = 0;
  numLedOnlyEvents = 0;
  logMessage("Colas borradas");
}

void mostrarTodasLasColas() {
  if (contarMotoresActivos() == 0) { logMessage("Todas las colas vacías"); return; }
  for (uint8_t motor = 0; motor < numServosActive; motor++) {
    if (!tieneMovimientos(motor)) continue;
    logMessage("Motor " + String(motor) + ": " +
               String(numMovimientosPorMotor[motor]) + " mov, " +
               String(calcularTiempoTotalMotor(motor)) + "ms");
  }
}

// ============================================================
// GENERAR ARRAY DE EVENTOS (std::sort — O(n log n))
// ============================================================

uint16_t generarArrayEventos(uint32_t& tiempoMaximo) {
  uint16_t numEventos = 0;
  tiempoMaximo = 0;

  // Calcular duración total de la secuencia (motores)
  for (uint8_t motor = 0; motor < numServosActive; motor++) {
    if (tieneMovimientos(motor)) {
      uint32_t t = calcularTiempoTotalMotor(motor);
      if (t > tiempoMaximo) tiempoMaximo = t;
    }
  }

  // Construir array de eventos por motor
  bool _overflowLogged = false;
  for (uint8_t motor = 0; motor < numServosActive; motor++) {
    if (!tieneMovimientos(motor)) continue;

    uint32_t tiempoAcumulado = 0;
    uint16_t idx = indiceLecturaPorMotor[motor];

    for (uint16_t i = 0; i < numMovimientosPorMotor[motor]; i++) {
      MovimientoMotor mov  = colasMotores[motor][idx];
      int             base = homePosicion[motor];
      int             pos;

      if (mov.velocidad == 0) {
        pos = base;
      } else {
        int ajuste = map(abs(mov.velocidad), 1, 100, 1, SERVO_MAX - SERVO_MIN);
        pos = base + (mov.velocidad > 0 ? ajuste : -ajuste);
      }
      pos = constrain(pos, SERVO_MIN, SERVO_MAX);
      if (mov.invertido) {
        pos = base - (pos - base);
        pos = constrain(pos, SERVO_MIN, SERVO_MAX);
      }

      if (numEventos < MAX_EVENTOS) {
        eventos[numEventos++] = { tiempoAcumulado, motor, (uint16_t)pos };
      } else if (!_overflowLogged) {
        _overflowLogged = true;
        logMessage("WARN: MAX_EVENTOS overflow at motor=" + String(motor) +
                   " t=" + String(tiempoAcumulado) + "ms");
      }

      tiempoAcumulado += mov.tiempo;

      // Evento de retorno al home (solo si necesario)
      bool esUltimo   = (i == numMovimientosPorMotor[motor] - 1);
      bool emitirFin  = true;
      if (!esUltimo) {
        uint16_t idxSig = (idx + 1) % MAX_MOV_POR_MOTOR;
        if (colasMotores[motor][idxSig].velocidad != 0) emitirFin = false;
      } else if (modoRepeticion && mov.velocidad != 0) {
        emitirFin = false;
      }
      if (emitirFin && numEventos < MAX_EVENTOS) {
        eventos[numEventos++] = { tiempoAcumulado, motor, (uint16_t)homePosicion[motor] };
      }

      idx = (idx + 1) % MAX_MOV_POR_MOTOR;
    }
  }

  // Insertar eventos de sincronía de compás
  for (uint8_t i = 0; i < numSyncMarkers; i++) {
    if (numEventos < MAX_EVENTOS) {
      eventos[numEventos++] = { syncTimestamps[i], SYNC_MOTOR_ID, 0 };
    }
  }

  // Insertar eventos LED-only (notas sin motor). posicion = (ledIdx<<8)|on.
  for (uint16_t i = 0; i < numLedOnlyEvents && numEventos < MAX_EVENTOS; i++) {
    const LedOnlyEvent& le = ledOnlyEvents[i];
    uint8_t  ledIdx = le.ledIdxOn & 0x7F;
    uint8_t  on     = (le.ledIdxOn & 0x80) ? 0x01 : 0x00;
    uint16_t packed = ((uint16_t)ledIdx << 8) | on;
    eventos[numEventos++] = { le.ts, LED_ONLY_ID, packed };
    // La secuencia debe durar al menos hasta el último apagado LED-only.
    if (le.ts > tiempoMaximo) tiempoMaximo = le.ts;
  }

  // Insertar pre-eventos LED Synthesia (amarillo, advance_ms antes del golpe)
  if (g_advanceMs > 0) {
    uint16_t numBase = numEventos;
    for (uint16_t i = 0; i < numBase && numEventos < MAX_EVENTOS; i++) {
      uint8_t m = eventos[i].motor;
      if (m == SYNC_MOTOR_ID || m == LED_ADV_ID) continue;
      if (m >= MAX_SERVOS_ABS) continue;  // reservado: no acceder homePosicion/motorToLed
      if (eventos[i].posicion == (uint16_t)homePosicion[m]) continue; // solo golpes
      uint8_t ledIdx = motorToLed[m];
      if (ledIdx >= NUM_LEDS) continue;
      uint32_t advTs = (eventos[i].timestamp > g_advanceMs)
          ? eventos[i].timestamp - g_advanceMs : 0;
      eventos[numEventos++] = { advTs, LED_ADV_ID, ledIdx };
    }
  }

  // Ordenar por timestamp con std::sort (O(n log n))
  if (numEventos >= 2) {
    std::sort(eventos, eventos + numEventos,
      [](const EventoMotor& a, const EventoMotor& b) {
        return a.timestamp < b.timestamp;
      });
  }

  logMessage("Eventos generados: " + String(numEventos) +
             " | Duracion: " + String(tiempoMaximo) + "ms");
  return numEventos;
}

// ============================================================
// EJECUCIÓN PARALELA CON TIMESTAMPS
// ============================================================

void ejecutarMovimientosParalelos() {
  // Reproducir si hay movimientos de motor O eventos LED-only (notas sin
  // motor). Un fragmento con solo LEDs también es una reproducción válida.
  if (contarMotoresActivos() == 0 && numLedOnlyEvents == 0) {
    logMessage("WARN: No hay movimientos en ninguna cola");
    return;
  }

  g_numEventos = generarArrayEventos(g_tiempoMaximo);
  if (g_numEventos == 0) return;

  reproduciendo     = true;
  detenerRepeticion = false;
  g_tiempoInicio    = millis();
  g_eventoActual    = 0;
  g_ultimoBeat      = 0;
  wsPushState("playing");

  do {
    g_tiempoInicio             = millis();
    g_eventoActual             = 0;
    g_ultimoBeat               = 0;
    uint32_t ultimaVerificacion = g_tiempoInicio;

    // ── Loop principal de eventos ──────────────────────────────
    while (g_eventoActual < g_numEventos && !detenerRepeticion) {
      uint32_t ahora   = millis();
      uint32_t elapsed = ahora - g_tiempoInicio;

      // Disparar eventos cuyo timestamp ya ha llegado
      while (g_eventoActual < g_numEventos &&
             eventos[g_eventoActual].timestamp <= elapsed) {

        if (eventos[g_eventoActual].motor == LED_ADV_ID) {
          // Pre-evento Synthesia: encender LED en amarillo antes del golpe
          uint8_t ledIdx = (uint8_t)eventos[g_eventoActual].posicion;
          if (ledIdx < NUM_LEDS) {
            leds[ledIdx] = CHSV(43, 255, 220);  // amarillo FastLED
            ledsDirty    = true;
          }
        } else if (eventos[g_eventoActual].motor == LED_ONLY_ID) {
          // Evento LED-only: nota sin motor. posicion codifica ledIdx (byte alto)
          // y on/off (byte bajo). El color viene de ledOnlyHue/Sat[ledIdx].
          uint16_t packed = eventos[g_eventoActual].posicion;
          uint8_t  ledIdx = (uint8_t)(packed >> 8);
          bool     on     = (packed & 0x01) != 0;
          if (ledIdx < NUM_LEDS) {
            if (on) leds[ledIdx] = CHSV(ledOnlyHue[ledIdx], ledOnlySat[ledIdx], 220);
            else    leds[ledIdx] = CRGB::Black;
            ledsDirty    = true;
          }
        } else if (eventos[g_eventoActual].motor == SYNC_MOTOR_ID) {
          // Evento de sincronía: medir drift I2C acumulado y corregir timestamps futuros
          uint32_t expectedMs = eventos[g_eventoActual].timestamp;
          int32_t drift = (int32_t)elapsed - (int32_t)expectedMs;
          if (abs(drift) > 5 && abs(drift) < 500) {
            for (uint16_t j = g_eventoActual + 1; j < g_numEventos; j++) {
              if (eventos[j].motor == SYNC_MOTOR_ID) continue;
              if (drift > 0) {
                // Retrasados: adelantar eventos futuros
                eventos[j].timestamp = (eventos[j].timestamp > (uint32_t)drift)
                    ? eventos[j].timestamp - (uint32_t)drift : 0;
              } else {
                // Adelantados: retrasar eventos futuros
                eventos[j].timestamp += (uint32_t)(-drift);
              }
            }
            logMessage("Sync drift=" + String(drift) + "ms corregido");
          }
        } else {
          uint8_t  evMotor = eventos[g_eventoActual].motor;
          uint16_t evPos   = eventos[g_eventoActual].posicion;
          setServoPWM(evMotor, evPos);
          posicionActual[evMotor] = evPos;

          // LED: encender con color enviado desde el browser, apagar al home
          uint8_t ledIdx = motorToLed[evMotor];
          static uint8_t _dbgLedCnt = 0;
          if (_dbgLedCnt < 4) {
            _dbgLedCnt++;
            logMessage("EVT m=" + String(evMotor) + " led=" + String(ledIdx) + " pos=" + String(evPos) + " home=" + String(homePosicion[evMotor]));
          }
          if (ledIdx < NUM_LEDS) {
            if (evPos != (uint16_t)homePosicion[evMotor]) {
              leds[ledIdx] = CHSV(motorHue[evMotor], motorSat[evMotor], 220);
            } else {
              leds[ledIdx] = CRGB::Black;
            }
            ledsDirty = true;
          }
        }

        g_eventoActual++;
      }

      // ── B4: emitir beat al browser cada stepMs ──────────────
      if (g_stepMs > 0) {
        uint32_t stepActual = elapsed / g_stepMs;
        if (stepActual > g_ultimoBeat) {
          g_ultimoBeat = stepActual;
          wsPushBeat(stepActual);
        }
      }

      if (ahora - ultimaVerificacion >= 10) {
        ultimaVerificacion = ahora;
        if (ledsDirty) { FastLED.show(); ledsDirty = false; }
        verificarComandoDetener();
        manejarServidorWeb();
      }
      yield();
    }

    if (detenerRepeticion) break;

    // Esperar el silencio final hasta completar g_tiempoMaximo
    while (millis() - g_tiempoInicio < g_tiempoMaximo && !detenerRepeticion) {
      uint32_t ahora = millis();

      if (g_stepMs > 0) {
        uint32_t elapsed    = ahora - g_tiempoInicio;
        uint32_t stepActual = elapsed / g_stepMs;
        if (stepActual > g_ultimoBeat) {
          g_ultimoBeat = stepActual;
          wsPushBeat(stepActual);
        }
      }

      if (ahora - ultimaVerificacion >= 10) {
        ultimaVerificacion = ahora;
        verificarComandoDetener();
        manejarServidorWeb();
      }
      yield();
    }

  } while (modoRepeticion && !detenerRepeticion);

  // Volver todos los motores al home
  detenerTodosServos();
  borrarTodasLasColas();
  reproduciendo     = false;
  modoRepeticion    = false;
  detenerRepeticion = false;
  g_numEventos      = 0;
  g_stepMs          = 0;
  g_advanceMs       = 0;
  wsPushState("stopped");
  logMessage("Secuencia completada");
}

// ============================================================
// HANDLER WEBSOCKET — Protocolo midiGrid
//
//   PLAY|nombre|stepMs\n{bloque}  →  ejecutar secuencia completa
//                                     stepMs: ms por semicorchea (para beat)
//                                     0 = beat desactivado
//   APPEND\n{bloque}              →  añadir movimientos SIN borrar colas
//                                     ni reiniciar tiempoInicio
//                                     (hot-swap de instrumento en caliente)
//   STOP                          →  parada inmediata + servos a home
//   {cmd raw}                     →  backward compat / debug Serial
// ============================================================

void procesarComandoWs(const String& msg) {

  // ── STOP ────────────────────────────────────────────────────
  if (msg.startsWith("STOP")) {
    modoRepeticion    = false;
    detenerRepeticion = true;
    detenerTodosServos();
    logMessage("WS: STOP");
    return;
  }

  // ── PLAY|nombre|stepMs\n{bloque} ────────────────────────────
  if (msg.startsWith("PLAY|")) {
    int nl = msg.indexOf('\n');
    if (nl < 0) { logMessage("WS PLAY: falta newline"); return; }
    String header = msg.substring(0, nl);
    String data   = msg.substring(nl + 1);
    data.trim();

    // Parsear header: PLAY|nombre|stepMs|advanceMs
    int p1 = header.indexOf('|');
    int p2 = (p1 >= 0) ? header.indexOf('|', p1 + 1) : -1;
    int p3 = (p2 >= 0) ? header.indexOf('|', p2 + 1) : -1;
    String nombre = (p1 >= 0 && p2 > p1) ? header.substring(p1 + 1, p2)
                                          : (p1 >= 0 ? header.substring(p1 + 1) : "song");
    g_stepMs    = (p2 >= 0) ? (uint32_t)header.substring(p2 + 1, p3 > 0 ? p3 : header.length()).toInt() : 0;
    g_advanceMs = (p3 >= 0) ? (uint32_t)header.substring(p3 + 1).toInt() : 0;

    logMessage("WS PLAY: " + nombre +
               " | stepMs=" + String(g_stepMs) +
               " | advanceMs=" + String(g_advanceMs) +
               " | " + String(data.length()) + " bytes");

    // Si hay reproducción activa, terminarla INMEDIATAMENTE antes de cargar nuevos datos
    if (reproduciendo) {
      reproduciendo     = false;
      modoRepeticion    = false;
      detenerRepeticion = true;
      detenerTodosServos();
      logMessage("WS PLAY: reproducción previa terminada forzadamente");
    }

    // Limpiar colas ANTES de cargar nuevos datos
    borrarTodasLasColas();

    procesarComandoCmd(data);
    return;
  }

  // ── APPEND\n{bloque} ────────────────────────────────────────
  // Añade movimientos a las colas existentes SIN borrarlas y SIN
  // reiniciar tiempoInicio. Permite cambiar de instrumento en caliente
  // mientras la secuencia está sonando.
  if (msg.startsWith("APPEND\n")) {
    /*if (!reproduciendo) {
      logMessage("WS APPEND: ignorado (no hay reproducción activa)");
      return;
    }*/
    String data = msg.substring(7);
    data.trim();
    if (data.length() == 0) return;

    logMessage("WS APPEND: " + String(data.length()) + " bytes");

    // Cargar los nuevos movimientos en las colas (sin borrar los existentes).
    // Solo instrucciones m/t/v/o/s — p,r,e,x se ignoran.
    int start = 0;
    while (start < (int)data.length()) {
      int end = data.indexOf(';', start);
      if (end == -1) end = data.length();
      String sub = data.substring(start, end);
      sub.trim();
      if (sub.length() > 0) {
        char   op  = sub[0];
        String arg = sub.substring(1);
        arg.trim();
        if (op == 'm' || op == 't' || op == 'v' || op == 's' || op == 'o' ||
            op == 'L' || op == 'K' || op == 'k') {
          procesarComandoComun(op, arg);
        }
      }
      start = end + 1;
    }

    // Regenerar el array de eventos solo si ya hay reproducción activa.
    // Si aún no ha empezado (p; llegará después), los bloques previos al p;
    // solo cargan las colas — el array se genera una sola vez cuando llega p;.
    // Esto evita N sorts innecesarios + saturación de heap antes de arrancar.
    if (reproduciendo) {
      uint32_t nuevoMax;
      uint16_t nuevosEventos = generarArrayEventos(nuevoMax);
      g_numEventos   = nuevosEventos;
      g_tiempoMaximo = nuevoMax;
      logMessage("APPEND: array regenerado, " + String(nuevosEventos) +
                 " eventos | " + String(nuevoMax) + "ms");
    } else {
      logMessage("APPEND: colas cargadas (pendiente p;)");
    }
    return;
  }

  // ── Comando raw (debug Serial / tests) ──────────────────────
  procesarComandoCmd(msg);
}

// ============================================================
// UTILIDADES
// ============================================================

bool estaReproduciendo() { return reproduciendo; }

void verificarComandoDetener() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == 'x' || c == 'X') {
      detenerRepeticion = true;
      while (Serial.available()) Serial.read();
      _wsSerIdx  = 0;
      _wsSerMode = false;
      logMessage("Stop serial detectado");
      return;
    }
  }
}

void detenerTodosServos() {
  for (uint8_t i = 0; i < numServosActive; i++) {
    setServoPWM(i, homePosicion[i]);
    posicionActual[i] = homePosicion[i];
  }
  fill_solid(leds, NUM_LEDS, CRGB::Black);
  FastLED.show();
  ledsDirty = false;
  logMessage("Servos en home");
}

bool validarServoNum(int num) {
  return (num >= 0 && num < (int)numServosActive);
}

void inicializarSistema() {
  for (uint8_t i = 0; i < numServosActive; i++) {
    homePosicion[i]   = SERVO_NEUTRAL;
    posicionActual[i] = SERVO_NEUTRAL;
    setServoPWM(i, SERVO_NEUTRAL);
    numMovimientosPorMotor[i]  = 0;
    indiceLecturaPorMotor[i]   = 0;
    indiceEscrituraPorMotor[i] = 0;
    noteOnActive[i]    = false;
    noteOnTimestamp[i] = 0;
  }
  motorTemporal          = 255;
  tiempoTemporal         = 0;
  motorTemporalInvertido = false;
  modoRepeticion         = false;
  detenerRepeticion      = false;
  reproduciendo          = false;
  delay(100);
  detenerTodosServos();
  logMessage("Sistema inicializado - Servos en neutral");
}

void irAPosicionDirecta(const String& argumento) {
  if (motorTemporal == 255) { logMessage("ERROR: Selecciona motor primero"); return; }
  int pwm = argumento.toInt();
  if (pwm < SERVO_MIN || pwm > SERVO_MAX) {
    logMessage("ERROR: PWM fuera de rango (" + String(SERVO_MIN) + "-" + String(SERVO_MAX) + ")");
    return;
  }
  setServoPWM(motorTemporal, pwm);
  posicionActual[motorTemporal] = pwm;
  logMessage("Motor " + String(motorTemporal) + " -> PWM " + String(pwm));
}

void establecerHomePosicion(const String& argumento) {
  if (motorTemporal == 255) { logMessage("ERROR: Selecciona motor primero"); return; }
  int pwm = argumento.toInt();
  if (pwm < SERVO_MIN || pwm > SERVO_MAX) {
    logMessage("ERROR: PWM fuera de rango (" + String(SERVO_MIN) + "-" + String(SERVO_MAX) + ")");
    return;
  }
  homePosicion[motorTemporal] = pwm;
  setServoPWM(motorTemporal, pwm);
  posicionActual[motorTemporal] = pwm;
  logMessage("Home motor " + String(motorTemporal) + " = " + String(pwm));
}

// ── NoteOn/NoteOff: control directo sin colas ─────────────────
// N motor  — mueve el servo a posición de golpe y lo mantiene
// F motor  — devuelve el servo a home
// Operan directamente sobre el PCA sin pasar por el sistema de
// colas, por lo que son compatibles con secuencias en reproducción.

// N motor [vel]
// motor — índice del motor (0-127)
// vel   — velocidad 1-100 (opcional, default 40). Mismo rango que cmd 'v'.
//         Usa map(vel, 1, 100, 1, SERVO_MAX-SERVO_MIN) igual que el secuenciador.
void noteOn(const String& argumento) {
  // Parsear "motor [vel]"
  int spaceIdx = argumento.indexOf(' ');
  int motor    = (spaceIdx > 0 ? argumento.substring(0, spaceIdx) : argumento).toInt();
  int vel      = (spaceIdx > 0 ? argumento.substring(spaceIdx + 1).toInt() : 40);
  vel = constrain(vel, 1, 100);

  if (!validarServoNum(motor)) {
    logMessage("ERROR: N — motor " + String(motor) + " fuera de rango");
    return;
  }

  int home  = homePosicion[motor];
  int ajuste = map(vel, 1, 100, 1, SERVO_MAX - SERVO_MIN);
  int hit   = constrain(home + ajuste, SERVO_MIN, SERVO_MAX);

  setServoPWM(motor, hit);
  posicionActual[motor]  = hit;
  noteOnActive[motor]    = true;
  noteOnTimestamp[motor] = millis();
  logMessage("NoteOn motor " + String(motor) + " vel=" + String(vel) + " -> PWM " + String(hit));
}

// F motor — devuelve el motor a home y cancela el timeout de seguridad
void noteOff(const String& argumento) {
  int motor = argumento.toInt();
  if (!validarServoNum(motor)) {
    logMessage("ERROR: F — motor " + String(motor) + " fuera de rango");
    return;
  }
  setServoPWM(motor, homePosicion[motor]);
  posicionActual[motor] = homePosicion[motor];
  noteOnActive[motor]   = false;
  logMessage("NoteOff motor " + String(motor) + " -> home " + String(homePosicion[motor]));
}

void debugEstadoServos() {
  logMessage("=== DEBUG ===");
  logMessage("PWM freq: " + String(frecuenciaPWM) + "Hz");
  logMessage("PCAs: " + String(numPcasDetected) + " | Motores activos: " + String(numServosActive));
  logMessage("Reproduciendo: " + String(reproduciendo ? "SI" : "NO"));
  logMessage("Motor temporal: " + (motorTemporal != 255 ? String(motorTemporal) : String("--")));
  logMessage("Tiempo temporal: " + String(tiempoTemporal) + "ms");
  uint8_t total = 0;
  for (uint8_t i = 0; i < numServosActive; i++) {
    if (numMovimientosPorMotor[i] > 0) {
      logMessage("  Motor " + String(i) + ": " +
                 String(numMovimientosPorMotor[i]) + " mov / " +
                 String(calcularTiempoTotalMotor(i)) + "ms");
      total += numMovimientosPorMotor[i];
    }
  }
  logMessage("Total movimientos: " + String(total));
  logMessage("=============");
}

void info() {
  logMessage("=== midiGrid ESP32 Firmware ===");
  logMessage("PROTOCOLO WS:");
  logMessage("  PLAY|nombre\\n{cmd}  ejecutar secuencia completa");
  logMessage("  STOP                parada inmediata");
  logMessage("COMANDOS (m/t/v/p/r/e/x/o/g/d/h/l):");
  logMessage("  m N[−]  seleccionar motor (- invierte)");
  logMessage("  o PWM   fijar posicion home del motor actual");
  logMessage("  t MS    duracion del siguiente movimiento (ms)");
  logMessage("  v VEL   agregar golpe (-100..100)");
  logMessage("  p       ejecutar UNA VEZ");
  logMessage("  r       repetir en bucle");
  logMessage("  e       borrar colas");
  logMessage("  x       parar");
  logMessage("  g PWM   mover motor a PWM exacto (calibracion)");
  logMessage("  l       listar colas");
  logMessage("  d       debug completo");
  logMessage("CAPACIDAD:");
  logMessage("  Motores    : " + String(numServosActive));
  logMessage("  Mov/motor  : " + String(MAX_MOV_POR_MOTOR));
  logMessage("  Max eventos: " + String(MAX_EVENTOS));
  logMessage("  Max msg WS : 64 KB");
}
