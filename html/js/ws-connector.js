// ============================================================
// ws-connector.js — Conexión WebSocket con el ESP32
// Depende de: nada (módulo autónomo, cargado antes de main.js)
//
// API pública:
//   initWebSocket()          — conectar a ws://ESP32_IP:81
//   sendCommand(cmd)         — enviar string (WS o HTTP fallback)
//   sendStop()               — parada inmediata por WS + HTTP
//   onBeatCallback           — asignar función para sincronizar playhead
//
// Variables globales exportadas:
//   wsConnected, ESP32_IP
// ============================================================

// ── Configuración ─────────────────────────────────────────────
let ESP32_IP    = '192.168.1.128';
let ws          = null;
let wsConnected = false;

// Callback registrado externamente para recibir beats del firmware
// Uso: onBeatCallback = (stepIndex) => { ... }
let onBeatCallback = null;

// ── D2 — initWebSocket ─────────────────────────────────────────
function initWebSocket() {
    console.log('[WS] initWebSocket() llamado desde:', new Error().stack.split('\n')[2]?.trim());
    const ip = document.getElementById('esp32IpInput')?.value.trim() || ESP32_IP;
    ESP32_IP = ip;

    _setWsStatus('connecting');

    if (ws) {
        try { ws.close(); } catch(_) {}
        ws = null;
    }

    try {
        ws = new WebSocket('ws://' + ESP32_IP + ':81');
    } catch (e) {
        console.error('[WS] No se pudo crear WebSocket:', e);
        _setWsStatus('disconnected');
        return;
    }

    ws.onopen = () => {
        wsConnected = true;
        _setWsStatus('connected');
        console.log('[WS] Conectado a', ESP32_IP);
    };

    ws.onclose = () => {
        wsConnected = false;
        _setWsStatus('disconnected');
        console.log('[WS] Desconectado');
        // Reconexión automática tras 5 s
        setTimeout(() => {
            if (!wsConnected) initWebSocket();
        }, 5000);
    };

    ws.onerror = (e) => {
        console.error('[WS] Error:', e);
        _setWsStatus('disconnected');
    };

    // ── D5 — onMessage: parsear beats y estados del firmware ──
    ws.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch (_) { return; }

        if (data.state === 'beat') {
            // Sincronizar playhead visual con el paso físico real
            if (typeof onBeatCallback === 'function') {
                onBeatCallback(data.step);
            }
            return;
        }

        if (data.state === 'playing') {
            console.log('[ESP32] Reproduciendo');
            return;
        }

        if (data.state === 'stopped') {
            console.log('[ESP32] Detenido');
            return;
        }
    };
}

// ── D3 — sendCommand ──────────────────────────────────────────
// Envía un comando al ESP32.
// Si WebSocket está conectado lo usa; si no, cae en HTTP GET.
function sendCommand(cmd) {
    if (wsConnected && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(cmd);
    } else {
        // HTTP fallback
        fetch('http://' + ESP32_IP + '/command?cmd=' + encodeURIComponent(cmd))
            .catch(err => console.error('[HTTP fallback] Error:', err));
    }
}

// ── D4 — sendStop ─────────────────────────────────────────────
// Parada inmediata: STOP por WS Y x; por HTTP como seguro doble.
function sendStop() {
    if (wsConnected && ws && ws.readyState === WebSocket.OPEN) {
        ws.send('STOP');
    }
    // Siempre enviar también por HTTP como respaldo
    fetch('http://' + ESP32_IP + '/command?cmd=' + encodeURIComponent('x;'))
        .catch(() => {});
}

// ── D6 — helpers UI ───────────────────────────────────────────
function _setWsStatus(state) {
    const dot = document.getElementById('esp32StatusDot');
    const lbl = document.getElementById('esp32StatusLabel');
    if (!dot || !lbl) return;

    const MAP = {
        connected:    { color: '#44dd88', text: 'ESP32 conectado'    },
        disconnected: { color: '#dd4444', text: 'ESP32 desconectado' },
        connecting:   { color: '#ddaa33', text: 'Conectando...'      },
    };
    const s = MAP[state] || MAP.disconnected;
    dot.style.color = s.color;
    lbl.textContent = s.text;
}
