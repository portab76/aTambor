#ifndef WEB_SERVER_H
#define WEB_SERVER_H

#include <Arduino.h>

// Logging
void agregarLog(const String& mensaje);

// Parser de comandos (definido en Esp32.ino)
void procesarComandoCmd(const String& comando);

// Servidor HTTP + WebSocket
void iniciarServidorWeb();
void manejarServidorWeb();

// Push estado al browser via WebSocket
void wsPushState(const char* state);
void wsPushBeat(uint32_t stepIndex);

// Handler de comandos WS (definido en Esp32.ino)
void procesarComandoWs(const String& msg);

#endif // WEB_SERVER_H
