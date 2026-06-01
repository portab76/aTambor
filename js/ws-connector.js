// ============================================================
// ws-connector.js — Conexión WebSocket con el ESP32
// Depende de: nada (módulo autónomo, cargado antes de main.js)
//
// API pública:
//   initWebSocket()          — conectar a ws://ESP32_IP:81
//   sendCommand(cmd)         — enviar string (WS o HTTP fallback)
//   sendStop()               — parada inmediata por WS + HTTP
//   onBeatCallback           — asignar función para sincronizar playhead
//   onStoppedCallback        — asignar función para manejar fin de secuencia ESP32
//
// Variables globales exportadas:
//   wsConnected, ESP32_IP
// ============================================================

// ── Configuración ─────────────────────────────────────────────
let ESP32_IP    = '192.168.1.128';
let ws          = null;
let wsConnected = false;

// Variables compartidas con serial-connector.js — se rellenan por ese módulo
let _serialActive = false;
let _serialWriter = null;

// Callback registrado externamente para recibir beats del firmware
// Uso: onBeatCallback = (stepIndex) => { ... }
let onBeatCallback = null;

// Callback disparado cuando el ESP32 informa que terminó de reproducir
// Uso: onStoppedCallback = () => { ... }
let onStoppedCallback = null;

// ── D2 — initWebSocket ─────────────────────────────────────────
function initWebSocket() {
    if (_serialActive) return;   // serial tiene prioridad; no competir con wsConnected
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
        console.log('[WS] Desconectado');
        if (!_serialActive) {
            wsConnected = false;
            _setWsStatus('disconnected');
            setTimeout(() => { if (!wsConnected && !_serialActive) initWebSocket(); }, 5000);
        }
    };

    ws.onerror = (e) => {
        console.error('[WS] Error:', e);
        if (!_serialActive) _setWsStatus('disconnected');
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
            if (typeof onStoppedCallback === 'function') onStoppedCallback();
            return;
        }
    };
}

// ── D3 — sendCommand ──────────────────────────────────────────
// Enruta al canal activo: Serial > WebSocket > HTTP fallback.
function sendCommand(cmd) {
    const preview = cmd.length > 120
        ? cmd.slice(0, 120).replace(/\n/g, '↵') + `… [${cmd.length}B]`
        : cmd.replace(/\n/g, '↵');
    console.log(`%c[ESP32 →] ${preview}`, 'color:#44aaff;font-family:monospace;font-size:10px;');

    if (_serialActive && _serialWriter) {
        _serialWriter.write(new TextEncoder().encode(cmd + '\0'))
            .catch(err => console.error('[Serial] Error write:', err));
    } else if (wsConnected && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(cmd);
    } else {
        fetch('http://' + ESP32_IP + '/command?cmd=' + encodeURIComponent(cmd))
            .catch(err => console.error('[HTTP fallback] Error:', err));
    }
}

// ── D4 — sendStop ─────────────────────────────────────────────
// Parada inmediata en el canal activo.
function sendStop() {
    if (_serialActive && _serialWriter) {
        // El firmware reconoce 'x'/'X' en verificarComandoDetener() durante la reproducción.
        // 'STOP\0' es ignorado silenciosamente — causaría que el segundo PLAY se pierda.
        _serialWriter.write(new TextEncoder().encode('x;\0'))
            .catch(() => {});
    } else {
        if (wsConnected && ws && ws.readyState === WebSocket.OPEN) {
            ws.send('STOP');
        }
        // Respaldo HTTP solo en modo WiFi
        fetch('http://' + ESP32_IP + '/command?cmd=' + encodeURIComponent('x;'))
            .catch(() => {});
    }
}

// ── D7 — closeWebSocket ───────────────────────────────────────
function closeWebSocket() {
    if (ws) { try { ws.close(); } catch (_) {} ws = null; }
    wsConnected = false;
    _setWsStatus('disconnected');
}

// ── D6 — helpers UI ───────────────────────────────────────────
function _setWsStatus(state) {
    const dot = document.getElementById('esp32StatusDot');
    const lbl = document.getElementById('esp32StatusLabel');  // opcional
    const msg = document.getElementById('statusMsg');

    const MAP = {
        connected:    { color: '#44dd88', text: 'ESP32 conectado'    },
        disconnected: { color: '#dd4444', text: 'ESP32 desconectado' },
        connecting:   { color: '#ddaa33', text: 'Conectando...'      },
    };
    const s = MAP[state] || MAP.disconnected;
    if (dot) dot.style.color = s.color;
    if (lbl) lbl.textContent = s.text;
    if (msg) msg.textContent = s.text;
}
