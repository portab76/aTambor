// ============================================================
// web_server.cpp — WiFi, HTTP y WebSocket para midiGrid/Esp32
//
// Librerías requeridas (Arduino IDE → Gestor de Librerías):
//   - "WebSockets" by Markus Sattler (arduinoWebSockets)
//   - "CircularBuffer" by AgileWare
// ============================================================

#include <WiFi.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include "web_server.h"
#include <FS.h>
#include <SPIFFS.h>

// ---- Servidores -----------------------------------------------
WebServer        server(80);
WebSocketsServer webSocket(81);

// ---- Red WiFi -------------------------------------------------
// Sin credenciales hardcodeadas. Se guardan en NVS vía WiFi.begin() y se
// configuran desde el piano roll con el endpoint /setwifi.
// Si no hay red guardada o no conecta, se levanta el AP abierto de abajo.
#define AP_SETUP_SSID "midiGrid-Setup"   // AP abierto (sin contraseña)

// ---- Log circular (512 bytes) ---------------------------------
#define LOG_BUF_SIZE 2048
static char     logBuffer[LOG_BUF_SIZE] = {0};
static uint16_t logLen = 0;

void agregarLog(const String& mensaje) {
  const char* s      = mensaje.c_str();
  uint16_t    sl     = (uint16_t)mensaje.length();
  uint16_t    needed = sl + 1; // +1 para '\n'
  if (needed >= LOG_BUF_SIZE) return;
  if (logLen + needed >= LOG_BUF_SIZE) {
    uint16_t excess = logLen + needed - LOG_BUF_SIZE + 1;
    memmove(logBuffer, logBuffer + excess, logLen - excess);
    logLen -= excess;
  }
  memcpy(logBuffer + logLen, s, sl);
  logLen += sl;
  logBuffer[logLen++] = '\n';
  logBuffer[logLen]   = '\0';
}

// ============================================================
// WEBSOCKET
// ============================================================

extern void procesarComandoWs(const String& msg);
extern volatile bool detenerRepeticion;

void wsEventHandler(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
  if (type == WStype_TEXT && length > 0) {
    String msg = String((char*)payload);
    procesarComandoWs(msg);
  }
}

// Envía estado simple al browser — WebSocket + Serial (modo USB)
void wsPushState(const char* state) {
  char msg[64];
  snprintf(msg, sizeof(msg), "{\"state\":\"%s\"}", state);
  webSocket.broadcastTXT(msg);
  Serial.println(msg);
}

// Envía tick de beat — WebSocket + Serial (modo USB)
void wsPushBeat(uint32_t stepIndex) {
  char msg[64];
  snprintf(msg, sizeof(msg), "{\"state\":\"beat\",\"step\":%lu}", stepIndex);
  webSocket.broadcastTXT(msg);
  Serial.println(msg);
}

// ============================================================
// HTTP HANDLERS
// ============================================================

void handleLogs() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "text/plain", logBuffer);
}

void handleCommand() {
  if (!server.hasArg("cmd")) {
    server.send(400, "text/plain", "Error: falta parametro 'cmd'");
    return;
  }
  String comando = server.arg("cmd");
  if (comando.length() == 0) {
    server.send(400, "text/plain", "Error: comando vacio");
    return;
  }
  // Responder antes de ejecutar para no bloquear fetch()
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "text/plain", "OK");
  Serial.println(comando);

  // Parada inmediata — nunca se encola
  String cmdTrim = comando;
  cmdTrim.trim();
  if (cmdTrim == "x" || cmdTrim == "x;" || cmdTrim.startsWith("STOP")) {
    detenerRepeticion = true;
    extern void detenerTodosServos();
    detenerTodosServos();
    return;
  }

  procesarComandoCmd(comando);
}

void handleStatus() {
  extern bool     estaReproduciendo();
  extern uint32_t g_ultimoBeat;
  extern uint8_t  numServosActive;
  char msg[96];
  snprintf(msg, sizeof(msg),
    "{\"playing\":%s,\"step\":%lu,\"motor_count\":%u}",
    estaReproduciendo() ? "true" : "false",
    g_ultimoBeat,
    (unsigned)numServosActive);
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", msg);
}

void handleScript() {
  File file = SPIFFS.open("/script.js", "r");
  if (!file) { server.send(404, "text/plain", "Archivo no encontrado"); return; }
  server.streamFile(file, "application/javascript");
  file.close();
}

void handleRoot() {
  File file = SPIFFS.open("/index.html", "r");
  if (!file) { server.send(404, "text/plain", "Archivo HTML no encontrado"); return; }
  server.streamFile(file, "text/html");
  file.close();
}

// Borra la red WiFi guardada en NVS y reinicia en modo AP.
// Tras esto el ESP32 cambia de red: el cliente debe reconectarse al AP
// "midiGrid-Setup" (192.168.4.1) para volver a operar.
void handleResetWifi() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "text/plain", "WiFi reseteada. Reiniciando en modo AP (midiGrid-Setup / 192.168.4.1)...");
  Serial.println("Reset WiFi solicitado -> borrando credenciales NVS y reiniciando");
  WiFi.disconnect(true, true);   // desconecta + borra credenciales de NVS
  delay(500);
  ESP.restart();
}

// Guarda una red WiFi nueva y reinicia para conectarse a ella.
// Uso: GET /setwifi?ssid=MiRed&pass=MiClave  (pass puede ir vacío para redes abiertas)
// WiFi.begin(ssid,pass) persiste las credenciales en NVS; el arranque las reutiliza.
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
    "Si conecta, el ESP32 tomara una IP de esa red. Si falla, volvera al AP midiGrid-Setup (192.168.4.1).");
  Serial.println("SetWiFi solicitado -> guardando red '" + ssid + "' y reiniciando");

  WiFi.persistent(true);                 // fuerza persistencia en NVS
  WiFi.begin(ssid.c_str(), pass.c_str());
  delay(500);
  ESP.restart();
}

// ============================================================
// INIT
// ============================================================

void iniciarSPIFFS() {
  if (!SPIFFS.begin(true)) { Serial.println("Error al montar SPIFFS"); return; }
  Serial.println("SPIFFS montado correctamente");
}

void iniciarServidorWeb() {
  iniciarSPIFFS();

  // ── WiFi no bloqueante (STA con fallback a AP operativo) ────
  // NO usamos wifiManager.autoConnect(): ese método arranca un portal
  // bloqueante que impide llegar a server.begin() hasta que expira.
  // En su lugar:
  //   1) Intentamos conectar a la red guardada en NVS (WiFi.begin() sin args
  //      reutiliza las últimas credenciales, incl. las que guardó WiFiManager).
  //   2) Si no conecta en 15 s -> levantamos softAP() INMEDIATO y seguimos.
  // Así el servidor (piano roll + WebSocket) queda operativo al instante,
  // tanto en modo STA como en modo AP (192.168.4.1). Nunca hay portal bloqueante.
  Serial.println("Iniciando WiFi...");
  WiFi.mode(WIFI_STA);
  WiFi.begin();  // reutiliza credenciales guardadas en NVS

  uint32_t inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 15000) {
    delay(250);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("\nConectado a WiFi (STA). IP: ");
    Serial.println(WiFi.localIP());
  } else {
    // Sin red -> AP operativo inmediato (no un portal de configuración).
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SETUP_SSID);   // AP abierto, sin contraseña
    Serial.print("\nModo AP standalone. SSID: " AP_SETUP_SSID " | IP: ");
    Serial.println(WiFi.softAPIP());   // 192.168.4.1
  }

  // HTTP (puerto 80)
  server.on("/",         handleRoot);
  server.on("/logs",     handleLogs);
  server.on("/command",  handleCommand);
  server.on("/status",   handleStatus);
  server.on("/script.js", handleScript);
  server.on("/resetwifi", handleResetWifi);
  server.on("/setwifi",   handleSetWifi);
  server.onNotFound([]() {
    if (server.method() == HTTP_OPTIONS) {
      server.sendHeader("Access-Control-Allow-Origin",  "*");
      server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      server.sendHeader("Access-Control-Allow-Headers", "*");
      server.send(204);
    } else {
      server.send(404, "text/plain", "Not found");
    }
  });
  server.begin();
  Serial.println("Servidor HTTP iniciado (puerto 80)");

  // WebSocket (puerto 81)
  webSocket.begin();
  webSocket.onEvent(wsEventHandler);
  Serial.println("Servidor WebSocket iniciado (puerto 81)");
}

void manejarServidorWeb() {
  server.handleClient();
  webSocket.loop();
}
