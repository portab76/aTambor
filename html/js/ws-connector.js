// ============================================================
// ws-connector.js — Conexión WebSocket con el ESP32
// Depende de: state.js
//
// API pública:
//   initWebSocket()          — conectar a ws://ESP32_IP:81 (reinicia el backoff)
//   sendCommand(cmd)         — enviar string; devuelve Promise (resuelve/rechaza)
//   sendStop()               — parada inmediata por WS + HTTP (best-effort)
//   closeWebSocket()         — cierre manual (sin reconexión automática)
//   onBeatCallback           — en state.onBeatCallback
//   onStoppedCallback        — en state.onStoppedCallback
//
// Reconexión: backoff exponencial 1·2·4·8·16s … máx 30s, hasta MAX_ATTEMPTS
// intentos; tras agotarlos se detiene y se ofrece un botón "Reintentar" manual.
//
// Variables compartidas: state.wsConnected, state.ESP32_IP
// ============================================================

import { state } from './state.js';

export let ESP32_IP = '192.168.1.128';
let ws = null;

// ── Estado de reconexión ──────────────────────────────────────
const RECONNECT_BASE_MS = 1000;    // primer reintento: 1s
const RECONNECT_MAX_MS  = 30000;   // techo del backoff: 30s
const MAX_ATTEMPTS      = 10;      // intentos antes de parar y pedir acción manual

let _reconnectAttempts = 0;        // nº de reintentos consumidos en la racha actual
let _reconnectTimer    = null;     // handle del setTimeout de reconexión
let _hasEverConnected  = false;    // distingue "nunca conectó" de "se desconectó"
let _manualClose       = false;    // closeWebSocket() lo activa para frenar el auto-retry

/** Retardo del backoff exponencial para el intento `n` (0-indexado). */
function _backoffDelay(n) {
    return Math.min(RECONNECT_BASE_MS * (2 ** n), RECONNECT_MAX_MS);
}

/** Cancela cualquier reconexión programada. */
function _clearReconnect() {
    if (_reconnectTimer !== null) {
        clearTimeout(_reconnectTimer);
        _reconnectTimer = null;
    }
}

/** Programa el siguiente intento de reconexión, o se rinde tras MAX_ATTEMPTS. */
function _scheduleReconnect() {
    if (_manualClose || state._serialActive) return;
    _clearReconnect();

    if (_reconnectAttempts >= MAX_ATTEMPTS) {
        // Agotados los intentos: parar y ofrecer reconexión manual.
        _setWsStatus('failed',
            `Sin conexión tras ${MAX_ATTEMPTS} intentos`);
        _showRetryButton(true);
        return;
    }

    const delay = _backoffDelay(_reconnectAttempts);
    _reconnectAttempts++;
    _setWsStatus('connecting',
        `Reintentando ${_reconnectAttempts}/${MAX_ATTEMPTS}… (${Math.round(delay / 1000)}s)`);

    _reconnectTimer = setTimeout(() => {
        _reconnectTimer = null;
        if (!state.wsConnected && !state._serialActive) _openSocket();
    }, delay);
}

// ── Conexión ──────────────────────────────────────────────────

/**
 * Punto de entrada público: (re)inicia la conexión desde cero.
 * Resetea el contador de backoff y el cierre manual.
 */
export function initWebSocket() {
    if (state._serialActive) return;
    _manualClose       = false;
    _reconnectAttempts = 0;
    _clearReconnect();
    _showRetryButton(false);
    _openSocket();
}

/** Abre (o reabre) el socket. No resetea el contador de intentos. */
function _openSocket() {
    if (state._serialActive) return;

    const ip = document.getElementById('esp32IpInput')?.value.trim() || ESP32_IP;
    ESP32_IP = ip;

    // Mensaje según sea primer intento o reconexión en curso
    if (_reconnectAttempts === 0) _setWsStatus('connecting', 'Conectando…');

    if (ws) {
        try { ws.close(); } catch (_) {}
        ws = null;
    }

    try {
        ws = new WebSocket('ws://' + ESP32_IP + ':81');
    } catch (e) {
        console.error('[WS] No se pudo crear WebSocket:', e);
        _scheduleReconnect();
        return;
    }

    ws.onopen = () => {
        state.wsConnected  = true;
        _hasEverConnected  = true;
        _reconnectAttempts = 0;          // reset del backoff al conectar
        _clearReconnect();
        _showRetryButton(false);
        _setWsStatus('connected');
        console.log('[WS] Conectado a', ESP32_IP);
    };

    ws.onclose = () => {
        console.log('[WS] Desconectado');
        if (_manualClose || state._serialActive) return;
        state.wsConnected = false;
        // Distinguir "nunca conectó" de "se cayó una conexión establecida"
        const reason = _hasEverConnected ? 'Conexión perdida' : 'No se pudo conectar';
        _setWsStatus('disconnected', reason);
        _scheduleReconnect();
    };

    ws.onerror = (e) => {
        console.error('[WS] Error:', e);
        // onerror suele ir seguido de onclose; el reintento se programa allí.
        if (!state._serialActive && !_manualClose) {
            _setWsStatus('disconnected',
                _hasEverConnected ? 'Conexión perdida' : 'No se pudo conectar');
        }
    };

    ws.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch (_) { return; }

        if (data.state === 'beat') {
            if (typeof state.onBeatCallback === 'function') state.onBeatCallback(data.step);
            return;
        }
        if (data.state === 'playing') {
            console.log('[ESP32] Reproduciendo');
            return;
        }
        if (data.state === 'stopped') {
            console.log('[ESP32] Detenido');
            if (typeof state.onStoppedCallback === 'function') state.onStoppedCallback();
            return;
        }
    };
}

/** Reconexión manual disparada por el botón "Reintentar" de la UI. */
export function retryWebSocket() {
    initWebSocket();
}

// ── Envío de comandos ─────────────────────────────────────────

/**
 * Envía un comando al ESP32 por el canal activo (Serial > WebSocket > HTTP).
 * @returns {Promise<void>} resuelve cuando el comando se entrega; rechaza si
 *   no hay ningún canal disponible o el envío falla (ya no falla en silencio).
 */
export function sendCommand(cmd) {
    const preview = cmd.length > 120
        ? cmd.slice(0, 120).replace(/\n/g, '↵') + `… [${cmd.length}B]`
        : cmd.replace(/\n/g, '↵');
    console.log(`%c[ESP32 →] ${preview}`, 'color:#44aaff;font-family:monospace;font-size:10px;');

    // 1) Serial activo
    if (state._serialActive && state._serialWriter) {
        return state._serialWriter.write(new TextEncoder().encode(cmd + '\0'))
            .catch(err => {
                console.error('[Serial] Error write:', err);
                throw new Error('Error al escribir por Serial: ' + err.message);
            });
    }

    // 2) WebSocket abierto
    if (state.wsConnected && ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(cmd);
            return Promise.resolve();
        } catch (err) {
            console.error('[WS] Error en send():', err);
            return Promise.reject(new Error('Error al enviar por WebSocket: ' + err.message));
        }
    }

    // 3) Fallback HTTP (solo modo WiFi). Si falla, propaga el error.
    if (!state._serialActive) {
        return fetch('http://' + ESP32_IP + '/command?cmd=' + encodeURIComponent(cmd))
            .then(resp => {
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
            })
            .catch(err => {
                console.error('[HTTP fallback] Error:', err);
                throw new Error('Canal cerrado y fallback HTTP falló: ' + err.message);
            });
    }

    // 4) Ningún canal disponible
    const msg = 'No hay canal de comunicación con el ESP32 (canal cerrado).';
    console.warn('[ESP32] ' + msg);
    return Promise.reject(new Error(msg));
}

export function sendStop() {
    // Best-effort: no propaga errores (parada de emergencia).
    if (state._serialActive && state._serialWriter) {
        state._serialWriter.write(new TextEncoder().encode('x;\0')).catch(() => {});
    } else {
        if (state.wsConnected && ws && ws.readyState === WebSocket.OPEN) {
            try { ws.send('STOP'); } catch (_) {}
        }
        fetch('http://' + ESP32_IP + '/command?cmd=' + encodeURIComponent('x;')).catch(() => {});
    }
}

export function closeWebSocket() {
    _manualClose = true;
    _clearReconnect();
    _reconnectAttempts = 0;
    _showRetryButton(false);
    if (ws) { try { ws.close(); } catch (_) {} ws = null; }
    state.wsConnected = false;
    _setWsStatus('disconnected');
}

// ── UI de estado ──────────────────────────────────────────────

export function _setWsStatus(status, message) {
    const dot = document.getElementById('esp32StatusDot');
    const lbl = document.getElementById('esp32StatusLabel');  // opcional
    const msg = document.getElementById('statusMsg');

    const MAP = {
        connected:    { color: '#44dd88', text: 'ESP32 conectado'    },
        disconnected: { color: '#dd4444', text: 'ESP32 desconectado' },
        connecting:   { color: '#ddaa33', text: 'Conectando…'        },
        failed:       { color: '#dd4444', text: 'Conexión fallida'   },
    };
    const s    = MAP[status] || MAP.disconnected;
    const text = message || s.text;
    if (dot) dot.style.color = s.color;
    if (lbl) lbl.textContent = text;
    if (msg) msg.textContent = text;
}

/** Muestra u oculta el botón "Reintentar" de reconexión manual. */
function _showRetryButton(show) {
    const btn = document.getElementById('esp32RetryBtn');
    if (btn) btn.style.display = show ? '' : 'none';
}
