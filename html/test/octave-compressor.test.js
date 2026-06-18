// ============================================================
// octave-compressor.test.js — Tests de comprimirAMotores()
//                             y calcularOctavaDesdeHeat()
// Mini-framework inline (sin dependencias externas).
//
// comprimirAMotores(rawEvents, channel, motorMap) lee state.heatMapData
// y state.gridData. En la mayoría de tests los dejamos a null para forzar
// la octava por defecto (2), lo que hace los tests deterministas sin calcular
// la matriz de atención.
//
// CONVENCIÓN DE OCTAVA (la del código): octava = Math.floor(MIDI / 12).
//   → MIDI 24-35 = octava 2,  36-47 = octava 3,  48-59 = octava 4,  60-71 = octava 5.
// El "ideal" de comprimirAMotores es octavaObjetivo*12 + pc; con octavaObjetivo=2
// el ancla es MIDI 24, así que cada pitch class se mapea al motor más cercano a 24.
// Los valores esperados de estos tests reflejan ESE comportamiento real.
// ============================================================

import { state }                    from '../js/state.js';
import { comprimirAMotores }        from '../js/octave-compressor.js';
import { calcularOctavaDesdeHeat }  from '../js/heat.js';

// ── Mini-framework ────────────────────────────────────────────
const results = { passed: 0, failed: 0, tests: [] };
function _record(name, ok, detail) {
    results.tests.push({ name, ok, detail });
    if (ok) results.passed++; else results.failed++;
}
function test(name, fn) {
    try { fn(); _record(name, true, ''); }
    catch (e) { _record(name, false, e.message); }
}
function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEqual(a, b, msg) {
    if (a !== b)
        throw new Error(`${msg || 'assertEqual'} — esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`);
}

// ── Motor Map del robot real (16 notas) ──────────────────────
// Idéntico al MOTOR_MAP de motor-map.js: A1,B1 + octava cromática C2-B2 + C3,D3.
const ROBOT_MAP = [
    { note: 33, name: 'A1',  motor: 12 },
    { note: 35, name: 'B1',  motor: 13 },
    { note: 36, name: 'C2',  motor:  0 },
    { note: 37, name: 'C#2', motor: 10 },
    { note: 38, name: 'D2',  motor:  1 },
    { note: 39, name: 'D#2', motor: 11 },
    { note: 40, name: 'E2',  motor:  2 },
    { note: 41, name: 'F2',  motor:  3 },
    { note: 42, name: 'F#2', motor:  7 },
    { note: 43, name: 'G2',  motor:  4 },
    { note: 44, name: 'G#2', motor:  8 },
    { note: 45, name: 'A2',  motor:  5 },
    { note: 46, name: 'A#2', motor:  9 },
    { note: 47, name: 'B2',  motor:  6 },
    { note: 48, name: 'C3',  motor: 14 },
    { note: 50, name: 'D3',  motor: 15 },
];
const ROBOT_NOTES = new Set(ROBOT_MAP.map(m => m.note));

// ── Helpers: crea un noteOn / noteOff ─────────────────────────
function on(note, channel = 0, tick = 0, velocity = 80) {
    return { tick, type: 'noteOn', channel, note, velocity };
}
function off(note, channel = 0, tick = 96) {
    return { tick, type: 'noteOff', channel, note, velocity: 0 };
}

// ── Setup: sin datos de atención (octava por defecto = 2) ─────
function resetState() {
    state.heatMapData = null;
    state.gridData    = null;
}

// ============================================================
// Suite
// ============================================================
export function runTests() {
    results.passed = 0; results.failed = 0; results.tests = [];

    // ── calcularOctavaDesdeHeat ──────────────────────────────
    // octava = floor(MIDI/12): así MIDI 48-59 → octava 4, 36-47 → octava 3.

    test('calcularOctavaDesdeHeat: null → devuelve 2 (octava por defecto)', () => {
        assertEqual(calcularOctavaDesdeHeat(null), 2, 'octava por defecto');
    });

    test('calcularOctavaDesdeHeat: mapa vacío → devuelve 2', () => {
        assertEqual(calcularOctavaDesdeHeat(new Map()), 2, 'mapa vacío');
    });

    test('calcularOctavaDesdeHeat: notas MIDI 48-59 → devuelve 4 (floor(48/12))', () => {
        const hm = new Map();
        for (let n = 48; n < 60; n++) hm.set(`${n},0`, 1);
        assertEqual(calcularOctavaDesdeHeat(hm), 4, 'MIDI 48-59 → octava 4');
    });

    test('calcularOctavaDesdeHeat: peso dominante en MIDI 36-47 → devuelve 3', () => {
        const hm = new Map();
        // MIDI 36-47 (octava 3): score=10 cada nota
        for (let n = 36; n < 48; n++) hm.set(`${n},0`, 10);
        // MIDI 60-71 (octava 5): score=1 cada nota
        for (let n = 60; n < 72; n++) hm.set(`${n},0`, 1);
        assertEqual(calcularOctavaDesdeHeat(hm), 3, 'peso dominante en octava 3');
    });

    // ── comprimirAMotores: casos básicos ─────────────────────

    test('todas las notas de salida pertenecen al Motor Map', () => {
        resetState();
        const events = [
            on(60), on(62), on(64), on(65), on(67),  // C4 D4 E4 F4 G4
            off(60), off(62), off(64), off(65), off(67),
        ];
        const result = comprimirAMotores(events, 0, ROBOT_MAP);
        const salida = result.filter(e => e.type === 'noteOn').map(e => e.note);
        for (const nota of salida) {
            assert(ROBOT_NOTES.has(nota),
                `nota ${nota} no está en el Motor Map (${[...ROBOT_NOTES].join(',')})`);
        }
    });

    test('solo se modifica el canal seleccionado', () => {
        resetState();
        const events = [
            on(60, 0),   // canal 0 — debe comprimirse
            on(72, 1),   // canal 1 — no debe tocarse
            off(60, 0),
            off(72, 1),
        ];
        const result = comprimirAMotores(events, 0, ROBOT_MAP);

        const notaCh0 = result.find(e => e.type === 'noteOn' && e.channel === 0).note;
        const notaCh1 = result.find(e => e.type === 'noteOn' && e.channel === 1).note;

        assert(ROBOT_NOTES.has(notaCh0), `canal 0 comprimido correctamente (nota ${notaCh0})`);
        assertEqual(notaCh1, 72, 'canal 1 no debe modificarse');
    });

    test('preserva tick, channel y velocity; solo cambia note', () => {
        resetState();
        const ev = on(60, 0, 192, 100);
        const result = comprimirAMotores([ev], 0, ROBOT_MAP);
        const out = result[0];
        assertEqual(out.tick,     192,      'tick preservado');
        assertEqual(out.channel,  0,        'channel preservado');
        assertEqual(out.velocity, 100,      'velocity preservado');
        assertEqual(out.type,     'noteOn', 'type preservado');
        assert(ROBOT_NOTES.has(out.note), `note comprimida al motor map (${out.note})`);
    });

    test('no muta el array ni los objetos originales', () => {
        resetState();
        const orig = [on(60), off(60)];
        const notaOrig = orig[0].note;
        comprimirAMotores(orig, 0, ROBOT_MAP);
        assertEqual(orig[0].note, notaOrig, 'el objeto original no debe mutarse');
        assertEqual(orig.length, 2, 'el array original no debe mutarse');
    });

    test('con motorMap vacío devuelve rawEvents intactos', () => {
        resetState();
        const events = [on(60), off(60)];
        const result = comprimirAMotores(events, 0, []);
        assertEqual(result.length, events.length, 'misma longitud');
        assertEqual(result[0].note, 60, 'nota no modificada con motorMap vacío');
    });

    // ── Mapeo por pitch class (octava objetivo = 2, ancla MIDI 24) ───

    test('C4 (MIDI 60, pc=0) → C2 (MIDI 36) con octava objetivo 2', () => {
        resetState();
        // octavaObjetivo=2 → ideal pc0 = 24; C más cercana a 24 = C2 (36) vs C3 (48)
        const result = comprimirAMotores([on(60)], 0, ROBOT_MAP);
        assertEqual(result[0].note, 36, 'C4 → C2');
    });

    test('E4 (MIDI 64, pc=4) → E2 (MIDI 40) con octava objetivo 2', () => {
        resetState();
        const result = comprimirAMotores([on(64)], 0, ROBOT_MAP);
        assertEqual(result[0].note, 40, 'E4 → E2');
    });

    test('B3 (MIDI 59, pc=11) → B1 (MIDI 35) con octava objetivo 2', () => {
        resetState();
        // ideal pc11 = 24+11 = 35; candidatos B1(35) y B2(47): gana 35 (distancia 0)
        const result = comprimirAMotores([on(59)], 0, ROBOT_MAP);
        assertEqual(result[0].note, 35, 'B3 → B1 (más cercano al ancla 24)');
    });

    test('noteOff recibe el mismo remapeo de pitch class que noteOn', () => {
        resetState();
        const evOn  = on(64,  0, 0);
        const evOff = off(64, 0, 96);
        const result = comprimirAMotores([evOn, evOff], 0, ROBOT_MAP);
        assertEqual(result[0].note, result[1].note,
            'noteOn y noteOff del mismo PC deben apuntar a la misma nota de motor');
    });

    test('nota cuyo PC no existe en motorMap → aproxima a la nota más cercana', () => {
        resetState();
        // Motor map reducido: solo C2(36) y E2(40). D4(62, pc=2) no tiene D en el mapa.
        const mapaReducido = [{ note: 36 }, { note: 40 }];
        const result = comprimirAMotores([on(62)], 0, mapaReducido);
        const nota = result[0].note;
        assert(nota === 36 || nota === 40,
            `D4(pc=2) sin D en mapa → esperado 36 o 40, obtenido ${nota}`);
    });

    test('eventos meta (no noteOn/noteOff) pasan sin modificar', () => {
        resetState();
        const meta = { tick: 0, type: 'meta', subtype: 'setTempo', channel: 0, bpm: 120 };
        const result = comprimirAMotores([meta, on(60)], 0, ROBOT_MAP);
        const metaSalida = result.find(e => e.type === 'meta');
        assert(metaSalida, 'evento meta debe aparecer en la salida');
        assertEqual(metaSalida.bpm, 120, 'meta intacto');
    });

    // ── Integración con heat map ya calculado ────────────────

    test('si state.heatMapData concentra energía en MIDI 48-59 (octava 4), usa octava 4', () => {
        // heatMap con scores en MIDI 48-59 → calcularOctavaDesdeHeat = 4
        const hm = new Map();
        for (let n = 48; n < 60; n++) hm.set(`${n},0`, 10);
        state.heatMapData = hm;
        state.gridData    = null;

        // D5 (MIDI 62, pc=2): ideal = 4*12+2 = 50; candidatos D2(38) y D3(50): gana 50
        const result = comprimirAMotores([on(62)], 0, ROBOT_MAP);
        assertEqual(result[0].note, 50, 'D5 → D3 (octava objetivo=4, ancla 48 → D3 más cercana)');

        state.heatMapData = null;
    });

    return results;
}
