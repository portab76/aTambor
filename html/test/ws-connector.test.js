// ============================================================
// ws-connector.test.js — Tests del manejo de errores / reconexión
// Mini-framework inline (sin dependencias externas).
//
// Sustituimos globales del entorno (WebSocket, setTimeout, fetch) por dobles
// controlables para probar de forma determinista:
//   - backoff exponencial (1·2·4·8·16s … máx 30s)
//   - contador de intentos + límite (MAX_ATTEMPTS)
//   - parada tras agotar intentos + botón "Reintentar"
//   - sendCommand devuelve Promise y la rechaza si el canal está cerrado
//
// Requiere DOM mínimo (esp32StatusDot/Label, statusMsg, esp32RetryBtn,
// esp32IpInput) que runner.html provee.
// ============================================================

import { state } from '../js/state.js';
import {
    initWebSocket, sendCommand, closeWebSocket, retryWebSocket,
} from '../js/ws-connector.js';

// ── Mini-framework ────────────────────────────────────────────
const results = { passed: 0, failed: 0, tests: [] };
function _record(name, ok, detail) { results.tests.push({ name, ok, detail }); if (ok) results.passed++; else results.failed++; }
function test(name, fn) { try { fn(); _record(name, true, ''); } catch (e) { _record(name, false, e.message); } }
async function testAsync(name, fn) { try { await fn(); _record(name, true, ''); } catch (e) { _record(name, false, e.message); } }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(`${msg || 'assertEqual'} — esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`); }

// ── Dobles del entorno ────────────────────────────────────────
// Reloj falso para setTimeout determinista
let _now = 0;
const _timers = [];   // { id, fireAt, fn }
let _timerId = 1;

function installFakeTimers() {
    _now = 0; _timers.length = 0; _timerId = 1;
    globalThis.__realSetTimeout   = globalThis.setTimeout;
    globalThis.__realClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = (fn, delay = 0) => {
        const id = _timerId++;
        _timers.push({ id, fireAt: _now + delay, fn });
        return id;
    };
    globalThis.clearTimeout = (id) => {
        const i = _timers.findIndex(t => t.id === id);
        if (i >= 0) _timers.splice(i, 1);
    };
}
function restoreTimers() {
    globalThis.setTimeout   = globalThis.__realSetTimeout;
    globalThis.clearTimeout = globalThis.__realClearTimeout;
}
/** Avanza el reloj `ms` disparando los timers vencidos en orden. */
function advance(ms) {
    const target = _now + ms;
    // Disparar en bucle por si un timer programa otro dentro de la ventana
    let guard = 0;
    while (true) {
        const due = _timers.filter(t => t.fireAt <= target).sort((a, b) => a.fireAt - b.fireAt);
        if (due.length === 0 || guard++ > 1000) break;
        const t = due[0];
        _timers.splice(_timers.indexOf(t), 1);
        _now = t.fireAt;
        t.fn();
    }
    _now = target;
}
/** Delay del próximo timer pendiente (para inspeccionar el backoff). */
function nextTimerDelay() {
    if (_timers.length === 0) return null;
    return Math.min(..._timers.map(t => t.fireAt)) - _now;
}

// WebSocket falso: por defecto se queda "connecting" hasta que el test decida.
let _lastWs = null;
class FakeWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSED = 3;
    constructor(url) {
        this.url = url;
        this.readyState = FakeWebSocket.CONNECTING;
        this.sent = [];
        this.onopen = this.onclose = this.onerror = this.onmessage = null;
        _lastWs = this;
    }
    send(data) {
        if (this.readyState !== FakeWebSocket.OPEN) throw new Error('WebSocket no abierto');
        this.sent.push(data);
    }
    close() { this.readyState = FakeWebSocket.CLOSED; }
    // helpers de test
    _open()  { this.readyState = FakeWebSocket.OPEN;   this.onopen  && this.onopen(); }
    _fail()  { this.readyState = FakeWebSocket.CLOSED;
               this.onerror && this.onerror(new Error('fail'));
               this.onclose && this.onclose(); }
}

function installFakeWebSocket() {
    globalThis.__realWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = FakeWebSocket;
    _lastWs = null;
}
function restoreWebSocket() {
    globalThis.WebSocket = globalThis.__realWebSocket;
}

// fetch falso controlable (para el fallback HTTP de sendCommand)
let _fetchImpl = null;
function installFakeFetch() {
    globalThis.__realFetch = globalThis.fetch;
    globalThis.fetch = (...args) => _fetchImpl ? _fetchImpl(...args) : Promise.reject(new Error('fetch no configurado'));
}
function restoreFetch() { globalThis.fetch = globalThis.__realFetch; }

function resetEnvState() {
    state._serialActive = false;
    state._serialWriter = null;
    state.wsConnected   = false;
    closeWebSocket();    // limpia timers/estado interno y resetea _manualClose vía init posterior
}

// ============================================================
// Suite
// ============================================================
export async function runTests() {
    results.passed = 0; results.failed = 0; results.tests = [];

    // ── 1) Backoff exponencial 1·2·4·8·16·30·30… ──────────────
    test('backoff exponencial: 1s, 2s, 4s, 8s, 16s, 30s (techo)', () => {
        installFakeTimers();
        installFakeWebSocket();
        try {
            state._serialActive = false; state.wsConnected = false;
            initWebSocket();                 // intento inicial (no cuenta como reintento)
            assert(_lastWs, 'no se creó WebSocket');

            const delays = [];
            // Cada fallo del socket debe programar un reintento con delay creciente
            for (let i = 0; i < 6; i++) {
                _lastWs._fail();             // dispara onclose → _scheduleReconnect
                delays.push(nextTimerDelay());
                advance(nextTimerDelay());   // ejecuta el reintento → crea nuevo _lastWs
            }
            assertEqual(delays[0], 1000,  'reintento 1');
            assertEqual(delays[1], 2000,  'reintento 2');
            assertEqual(delays[2], 4000,  'reintento 3');
            assertEqual(delays[3], 8000,  'reintento 4');
            assertEqual(delays[4], 16000, 'reintento 5');
            assertEqual(delays[5], 30000, 'reintento 6 (techo 30s)');
        } finally {
            closeWebSocket(); restoreWebSocket(); restoreTimers();
        }
    });

    // ── 2) Contador de intentos en la UI ──────────────────────
    test('contador de intentos visible: "Reintentando N/10…"', () => {
        installFakeTimers();
        installFakeWebSocket();
        try {
            state._serialActive = false; state.wsConnected = false;
            initWebSocket();
            _lastWs._fail();   // primer fallo → "Reintentando 1/10…"
            const msg = document.getElementById('statusMsg').textContent;
            assert(/Reintentando\s+1\/10/.test(msg), `mensaje inesperado: "${msg}"`);
        } finally {
            closeWebSocket(); restoreWebSocket(); restoreTimers();
        }
    });

    // ── 3) Parada tras MAX_ATTEMPTS + botón "Reintentar" ──────
    test('tras 10 intentos fallidos: para y muestra botón Reintentar', () => {
        installFakeTimers();
        installFakeWebSocket();
        const retryBtn = document.getElementById('esp32RetryBtn');
        try {
            state._serialActive = false; state.wsConnected = false;
            retryBtn.style.display = 'none';
            initWebSocket();

            // Fallar repetidamente hasta agotar los 10 reintentos
            for (let i = 0; i < 12; i++) {
                if (_lastWs) _lastWs._fail();
                const d = nextTimerDelay();
                if (d !== null) advance(d);
            }
            // Ya no debe quedar ningún timer de reconexión programado
            assertEqual(nextTimerDelay(), null, 'no debe seguir reintentando');
            // El botón Reintentar debe estar visible
            assert(retryBtn.style.display !== 'none', 'el botón Reintentar debe mostrarse');
            const msg = document.getElementById('statusMsg').textContent;
            assert(/10 intentos/.test(msg), `mensaje final inesperado: "${msg}"`);

            // retryWebSocket() resetea el contador y reintenta (oculta el botón)
            retryWebSocket();
            assertEqual(retryBtn.style.display, 'none', 'botón oculto tras Reintentar');
        } finally {
            closeWebSocket(); restoreWebSocket(); restoreTimers();
        }
    });

    // ── reset del backoff al conectar ─────────────────────────
    test('el backoff se resetea al conectar correctamente', () => {
        installFakeTimers();
        installFakeWebSocket();
        try {
            state._serialActive = false; state.wsConnected = false;
            initWebSocket();
            _lastWs._fail(); advance(1000);   // reintento 1 (1s)
            _lastWs._fail();                  // reintento 2 programado a 2s
            assertEqual(nextTimerDelay(), 2000, 'va por el 2º reintento');
            advance(2000);
            _lastWs._open();                  // ¡conecta!
            assert(state.wsConnected, 'debería estar conectado');
            // Una nueva caída debe volver a empezar en 1s
            _lastWs._fail();
            assertEqual(nextTimerDelay(), 1000, 'backoff reseteado a 1s tras conectar');
        } finally {
            closeWebSocket(); restoreWebSocket(); restoreTimers();
        }
    });

    // ── 4) sendCommand devuelve Promise y rechaza si está cerrado ──
    await testAsync('sendCommand rechaza (Promise) si el canal está cerrado', async () => {
        state._serialActive = false; state._serialWriter = null; state.wsConnected = false;
        // Sin serial, sin WS y SIN fallback (simulamos modo serial inactivo → path 4)
        // Forzamos que no haya fallback marcando serial como "el modo" no aplica:
        // en WiFi habría fetch; para probar el rechazo directo, stubeamos fetch a fallo.
        installFakeFetch();
        _fetchImpl = () => Promise.reject(new Error('network down'));
        try {
            const p = sendCommand('m 0; p;');
            assert(p && typeof p.then === 'function', 'sendCommand debe devolver una Promise');
            let rejected = false, errMsg = '';
            await p.then(() => {}, (e) => { rejected = true; errMsg = e.message; });
            assert(rejected, 'la Promise debería rechazarse con el canal cerrado');
            assert(errMsg.length > 0, 'el error debe tener mensaje');
        } finally {
            restoreFetch();
        }
    });

    await testAsync('sendCommand resuelve (Promise) cuando el WebSocket está abierto', async () => {
        installFakeTimers();
        installFakeWebSocket();
        try {
            state._serialActive = false; state._serialWriter = null; state.wsConnected = false;
            initWebSocket();
            _lastWs._open();
            assert(state.wsConnected, 'WS debería estar abierto');
            const p = sendCommand('hola');
            assert(p && typeof p.then === 'function', 'debe devolver Promise');
            let resolved = false;
            await p.then(() => { resolved = true; }, () => {});
            assert(resolved, 'debería resolver con WS abierto');
            assert(_lastWs.sent.includes('hola'), 'el comando debe haberse enviado por WS');
        } finally {
            closeWebSocket(); restoreWebSocket(); restoreTimers();
        }
    });

    return results;
}
