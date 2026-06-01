// ============================================================
// serial-connector.js — Conexión USB Serial con el ESP32
// Requiere Web Serial API (Chrome / Edge 89+)
//
// API pública (misma interfaz que ws-connector.js):
//   initSerial()   — solicitar y abrir puerto COM
//   closeSerial()  — cerrar puerto
//
// Comparte con ws-connector.js:
//   _serialActive, _serialWriter  — leídos por sendCommand / sendStop
//   wsConnected                   — puesto a true cuando serial está abierto
//   onBeatCallback, onStoppedCallback — callbacks compartidos
// ============================================================

let _serialPort         = null;
let _serialReader       = null;
let _serialReadRunning  = false;
let _serialReadyTimeout = null;

// Buffer de log serial accesible desde la ventana de log
const _SERIAL_LOG_MAX = 60000;
var _serialLog = '';

// ── Abrir puerto ──────────────────────────────────────────────
async function initSerial() {
    if (!navigator.serial) {
        alert('Web Serial API no disponible.\nUsa Chrome o Edge 89+.');
        return;
    }

    _setWsStatus('connecting');

    try {
        // Solicitar puerto al usuario (requiere gesto del usuario → click en botón)
        _serialPort = await navigator.serial.requestPort();
        await _serialPort.open({ baudRate: 115200 });

        const writable = _serialPort.writable;
        _serialWriter  = writable.getWriter();
        _serialActive  = true;
        wsConnected    = false; // esperar confirmación del firmware

        console.log('[Serial] Puerto abierto — esperando firmware...');
        _setWsStatus('connecting');

        // El ESP32 se resetea al abrir el puerto USB (DTR del driver).
        // Esperamos "midiGrid firmware listo" en el read loop, con timeout de 5s
        // por si el firmware ya estaba corriendo (no se resetea en algunas placas).
        _serialReadyTimeout = setTimeout(() => {
            if (_serialActive && !wsConnected) {
                console.log('[Serial] Timeout espera firmware — asumiendo listo');
                wsConnected = true;
                _setWsStatus('connected');
            }
        }, 5000);

        _serialReadLoop();

    } catch (e) {
        console.error('[Serial] Error al abrir puerto:', e);
        _setWsStatus('disconnected');
        _serialActive = false;
        wsConnected   = false;
    }
}

// ── Cerrar puerto ─────────────────────────────────────────────
async function closeSerial() {
    _serialActive = false;
    wsConnected   = false;
    clearTimeout(_serialReadyTimeout);

    try {
        if (_serialReader)  { await _serialReader.cancel(); _serialReader.releaseLock(); }
        if (_serialWriter)  { _serialWriter.releaseLock(); }
        if (_serialPort)    { await _serialPort.close(); }
    } catch (_) {}

    _serialWriter = null;
    _serialReader = null;
    _serialPort   = null;
    _setWsStatus('disconnected');
    console.log('[Serial] Puerto cerrado');
}

// ── Loop de lectura ───────────────────────────────────────────
// Parsea líneas JSON del firmware (beat, playing, stopped) igual que ws-connector.
async function _serialReadLoop() {
    if (_serialReadRunning) return;
    _serialReadRunning = true;

    const decoder = new TextDecoder();
    let   buffer  = '';

    try {
        _serialReader = _serialPort.readable.getReader();

        while (_serialActive) {
            const { value, done } = await _serialReader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // guardar fragmento incompleto

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                // Acumular en buffer de log (con límite circular)
                _serialLog += trimmed + '\n';
                if (_serialLog.length > _SERIAL_LOG_MAX) {
                    _serialLog = _serialLog.slice(_serialLog.length - _SERIAL_LOG_MAX);
                    const nl = _serialLog.indexOf('\n');
                    if (nl >= 0) _serialLog = _serialLog.slice(nl + 1);
                }

                try {
                    const data = JSON.parse(trimmed);

                    if (data.state === 'beat') {
                        if (typeof onBeatCallback === 'function') onBeatCallback(data.step);

                    } else if (data.state === 'playing') {
                        console.log('[Serial] Reproduciendo');

                    } else if (data.state === 'stopped') {
                        console.log('[Serial] Detenido');
                        if (typeof onStoppedCallback === 'function') onStoppedCallback();
                    }

                } catch (_) {
                    // Línea no-JSON: debug del firmware
                    console.log('%c[Serial ←] ' + trimmed,
                        'color:#aaffaa;font-family:monospace;font-size:10px;');

                    // Firmware listo tras reset
                    if (!wsConnected && trimmed.includes('firmware listo')) {
                        clearTimeout(_serialReadyTimeout);
                        wsConnected = true;
                        _setWsStatus('connected');
                        console.log('[Serial] Firmware listo — conectado');
                    }
                }
            }
        }

    } catch (e) {
        if (_serialActive) {
            console.error('[Serial] Error de lectura:', e);
            _serialActive = false;
            wsConnected   = false;
            _setWsStatus('disconnected');
        }
    } finally {
        _serialReadRunning = false;
    }
}
