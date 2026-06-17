// ============================================================
// editor.test.js — Tests del debounce del análisis armónico
// Mini-framework inline (sin dependencias externas).
//
// scheduleHarmonicAnalysis() difiere el análisis 300ms y coalesce las ráfagas
// de ediciones en una sola ejecución. Usa state._harmonicDebounceTimer como
// handle cancelable. Aquí stubeamos setTimeout/clearTimeout (reloj falso) para
// comprobar el comportamiento de debounce de forma determinista.
// ============================================================

import { state } from '../js/state.js';
import { scheduleHarmonicAnalysis } from '../js/editor.js';

// ── Mini-framework ────────────────────────────────────────────
const results = { passed: 0, failed: 0, tests: [] };
function _record(name, ok, detail) { results.tests.push({ name, ok, detail }); if (ok) results.passed++; else results.failed++; }
function test(name, fn) { try { fn(); _record(name, true, ''); } catch (e) { _record(name, false, e.message); } }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(`${msg || 'assertEqual'} — esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`); }

// ── Reloj falso (setTimeout/clearTimeout deterministas) ───────
let _now = 0;
const _timers = [];   // { id, fireAt, fn }
let _timerId = 1;
let _execCount = 0;   // nº de callbacks ejecutados (para detectar coalescencia)

function installFakeTimers() {
    _now = 0; _timers.length = 0; _timerId = 1; _execCount = 0;
    globalThis.__realSetTimeout   = globalThis.setTimeout;
    globalThis.__realClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = (fn, delay = 0) => {
        const id = _timerId++;
        // Envolver para contar ejecuciones reales del callback diferido
        _timers.push({ id, fireAt: _now + delay, fn: () => { _execCount++; fn(); } });
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
function advance(ms) {
    const target = _now + ms;
    let guard = 0;
    while (guard++ < 1000) {
        const due = _timers.filter(t => t.fireAt <= target).sort((a, b) => a.fireAt - b.fireAt);
        if (!due.length) break;
        const t = due[0];
        _timers.splice(_timers.indexOf(t), 1);
        _now = t.fireAt;
        t.fn();
    }
    _now = target;
}
function pendingTimers() { return _timers.length; }

/** Estado mínimo para que _runHarmonicAnalysis no falle (grid vacío = camino corto). */
function resetState() {
    state._harmonicDebounceTimer = null;
    state.gridData = { cells: {} };   // grid vacío → _runHarmonicAnalysis hace el camino rápido
    state.currentHarmonicSegments = [];
    state.currentFusedSegments    = [];
    state.currentPhraseSegments   = [];
}

// ============================================================
// Suite
// ============================================================
export function runTests() {
    results.passed = 0; results.failed = 0; results.tests = [];

    // ── Una sola llamada se ejecuta tras 300ms ────────────────
    test('una edición → análisis tras 300ms (no antes)', () => {
        installFakeTimers();
        try {
            resetState();
            scheduleHarmonicAnalysis();
            assertEqual(pendingTimers(), 1, 'debe haber 1 timer pendiente');
            advance(299);
            assertEqual(_execCount, 0, 'no debe ejecutarse antes de 300ms');
            advance(1);   // total 300ms
            assertEqual(_execCount, 1, 'debe ejecutarse a los 300ms');
            assertEqual(state._harmonicDebounceTimer, null, 'el timer se limpia tras ejecutar');
        } finally { restoreTimers(); }
    });

    // ── Ráfaga de ediciones → una sola ejecución ──────────────
    test('ráfaga de 10 ediciones rápidas → un solo análisis', () => {
        installFakeTimers();
        try {
            resetState();
            // 10 ediciones separadas 50ms (ráfaga continua, < 300ms entre ellas)
            for (let i = 0; i < 10; i++) {
                scheduleHarmonicAnalysis();
                advance(50);
            }
            // Aún no han pasado 300ms desde la última → 0 ejecuciones
            assertEqual(_execCount, 0, 'no debe ejecutarse durante la ráfaga');
            assertEqual(pendingTimers(), 1, 'solo debe quedar 1 timer (los demás cancelados)');
            // Tras 300ms desde la última edición → exactamente 1 ejecución
            advance(300);
            assertEqual(_execCount, 1, 'la ráfaga coalesce en un solo análisis');
        } finally { restoreTimers(); }
    });

    // ── Cada llamada cancela la anterior ──────────────────────
    test('una nueva edición cancela el análisis pendiente', () => {
        installFakeTimers();
        try {
            resetState();
            scheduleHarmonicAnalysis();
            advance(200);                 // a falta de 100ms
            assertEqual(_execCount, 0, 'todavía no ejecuta');
            scheduleHarmonicAnalysis();   // reinicia el debounce
            advance(200);                 // 200ms desde el reinicio (total < 300 del nuevo)
            assertEqual(_execCount, 0, 'el reinicio pospone la ejecución');
            advance(100);                 // completa los 300ms del segundo
            assertEqual(_execCount, 1, 'ejecuta una sola vez tras el último cambio');
        } finally { restoreTimers(); }
    });

    // ── Ediciones espaciadas (> 300ms) → varias ejecuciones ───
    test('ediciones espaciadas (>300ms) → un análisis cada una', () => {
        installFakeTimers();
        try {
            resetState();
            scheduleHarmonicAnalysis();
            advance(300);
            assertEqual(_execCount, 1, 'primera ejecución');
            scheduleHarmonicAnalysis();
            advance(300);
            assertEqual(_execCount, 2, 'segunda ejecución tras nueva edición');
        } finally { restoreTimers(); }
    });

    return results;
}
