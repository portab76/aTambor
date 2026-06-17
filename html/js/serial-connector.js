// ============================================================
// serial-connector.js — Conexión USB Serial con el ESP32
// Requiere Web Serial API (Chrome / Edge 89+)
// Depende de: state.js, ws-connector.js
// ============================================================

import { state } from './state.js';
import { _setWsStatus } from './ws-connector.js';

let _serialPort         = null;
let _serialReader       = null;
let _serialReadRunning  = false;
let _serialReadyTimeout = null;

const _SERIAL_LOG_MAX = 60000;
export var _serialLog = '';

export async function initSerial() {
    if (!navigator.serial) {
        alert('Web Serial API no disponible.\nUsa Chrome o Edge 89+.');
        return;
    }

    _setWsStatus('connecting');

    try {
        _serialPort = await navigator.serial.requestPort();
        await _serialPort.open({ baudRate: 115200 });

        const writable      = _serialPort.writable;
        state._serialWriter = writable.getWriter();
        state._serialActive = true;
        state.wsConnected   = false;

        console.log('[Serial] Puerto abierto — esperando firmware...');
        _setWsStatus('connecting');

        _serialReadyTimeout = setTimeout(() => {
            if (state._serialActive && !state.wsConnected) {
                console.log('[Serial] Timeout espera firmware — asumiendo listo');
                state.wsConnected = true;
                _setWsStatus('connected');
            }
        }, 5000);

        _serialReadLoop();

    } catch (e) {
        console.error('[Serial] Error al abrir puerto:', e);
        _setWsStatus('disconnected');
        state._serialActive = false;
        state.wsConnected   = false;
    }
}

export async function closeSerial() {
    state._serialActive = false;
    state.wsConnected   = false;
    clearTimeout(_serialReadyTimeout);

    try {
        if (_serialReader)        { await _serialReader.cancel(); _serialReader.releaseLock(); }
        if (state._serialWriter)  { state._serialWriter.releaseLock(); }
        if (_serialPort)          { await _serialPort.close(); }
    } catch (_) {}

    state._serialWriter = null;
    _serialReader       = null;
    _serialPort         = null;
    _setWsStatus('disconnected');
    console.log('[Serial] Puerto cerrado');
}

async function _serialReadLoop() {
    if (_serialReadRunning) return;
    _serialReadRunning = true;

    const decoder = new TextDecoder();
    let   buffer  = '';

    try {
        _serialReader = _serialPort.readable.getReader();

        while (state._serialActive) {
            const { value, done } = await _serialReader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                _serialLog += trimmed + '\n';
                if (_serialLog.length > _SERIAL_LOG_MAX) {
                    _serialLog = _serialLog.slice(_serialLog.length - _SERIAL_LOG_MAX);
                    const nl = _serialLog.indexOf('\n');
                    if (nl >= 0) _serialLog = _serialLog.slice(nl + 1);
                }

                try {
                    const data = JSON.parse(trimmed);

                    if (data.state === 'beat') {
                        if (typeof state.onBeatCallback === 'function') state.onBeatCallback(data.step);
                    } else if (data.state === 'playing') {
                        console.log('[Serial] Reproduciendo');
                    } else if (data.state === 'stopped') {
                        console.log('[Serial] Detenido');
                        if (typeof state.onStoppedCallback === 'function') state.onStoppedCallback();
                    }

                } catch (_) {
                    console.log('%c[Serial ←] ' + trimmed,
                        'color:#aaffaa;font-family:monospace;font-size:10px;');

                    if (!state.wsConnected && trimmed.includes('firmware listo')) {
                        clearTimeout(_serialReadyTimeout);
                        state.wsConnected = true;
                        _setWsStatus('connected');
                        console.log('[Serial] Firmware listo — conectado');
                    }
                }
            }
        }

    } catch (e) {
        if (state._serialActive) {
            console.error('[Serial] Error de lectura:', e);
            state._serialActive = false;
            state.wsConnected   = false;
            _setWsStatus('disconnected');
        }
    } finally {
        _serialReadRunning = false;
    }
}
