// ============================================================
// harmonic.test.js — Tests de las funciones puras de harmonic.js
// Mini-framework inline (sin dependencias externas).
//
// Ejecutar abriendo test/runner.html en el navegador (sirve por HTTP:
// las funciones usan Tonal.js global, cargado por runner.html).
// ============================================================

import { state } from '../js/state.js';
import { detectKey, findChord, detectPhrases } from '../js/harmonic.js';

// ── Mini-framework de test ────────────────────────────────────
const results = { passed: 0, failed: 0, tests: [] };

function _record(name, ok, detail) {
    results.tests.push({ name, ok, detail });
    if (ok) results.passed++; else results.failed++;
}

function test(name, fn) {
    try {
        fn();
        _record(name, true, '');
    } catch (e) {
        _record(name, false, e.message);
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error(`${msg || 'assertEqual'} — esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`);
    }
}

function assertContains(str, sub, msg) {
    if (typeof str !== 'string' || !str.includes(sub)) {
        throw new Error(`${msg || 'assertContains'} — "${str}" no contiene "${sub}"`);
    }
}

// ── Helpers de construcción de datos ──────────────────────────

// Perfiles Krumhansl-Kessler (idénticos a los de harmonic.js). detectKey
// correlaciona el perfil de duraciones de la pieza contra estos perfiles
// rotados a las 12 tónicas. Un perfil que sigue de cerca el K-K de una
// tonalidad da una correlación inequívoca con ella.
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/**
 * Genera eventos cuya distribución de duraciones por clase de nota replica el
 * perfil Krumhansl-Kessler que detectKey asocia a la tonalidad (tonicClass,
 * mode). Modela una pieza "idealmente tonal": detectKey debe identificar esa
 * tonalidad con correlación ≈ 1.
 *
 * detectKey correlaciona el perfil contra `KK.rotado(t)`, donde
 * `KK.rotado(t)[k] = KK[(t + k) % 12]`. Para que la correlación sea máxima en
 * `t = tonicClass`, asignamos a la clase `k` el peso `KK[(tonicClass + k) % 12]`.
 */
function eventsForKey(tonicClass, mode) {
    const base = (mode === 'minor') ? KK_MINOR : KK_MAJOR;
    const events = [];
    let tick = 0;
    for (let k = 0; k < 12; k++) {
        const dur  = Math.round(base[(tonicClass + k) % 12] * 40);   // ticks ∝ peso rotado
        const note = 60 + k;                                         // clase k en octava 4
        events.push({ tick,            type: 'noteOn',  channel: 0, note, velocity: 100 });
        events.push({ tick: tick + dur, type: 'noteOff', channel: 0, note, velocity: 0 });
        tick += dur;
    }
    return events;
}

/** Bloque fusionado mínimo para detectPhrases. */
function fusedBlock(startStep, rootClass, quality, display) {
    return {
        startStep,
        endStep:      startStep + 16,
        activeNotes:  [],
        chord:        { name: display, root: rootClass, quality, tensions: [] },
        chordFunction: '',
        chordDisplay: display,
        inversion:    '',
        subSegments:  [],
    };
}

// ============================================================
// Suite
// ============================================================
export function runTests() {
    results.passed = 0; results.failed = 0; results.tests = [];

    // detectKey usa state.totalTicks para notas sin noteOff; fijamos un valor
    // grande para que no afecte (todos nuestros eventos tienen noteOff).
    state.totalTicks = 100000;

    // ── detectKey ──────────────────────────────────────────────
    // Se usan perfiles de duración arquetípicos (Krumhansl-Kessler) de cada
    // tonalidad, que es lo que detectKey está diseñado para reconocer.
    test("detectKey: escala de C mayor → { tonic:'C', mode:'major' }", () => {
        const key = detectKey(eventsForKey(0, 'major'));   // C = clase 0
        assertEqual(key.tonic, 'C', 'tónica');
        assertEqual(key.mode, 'major', 'modo');
    });

    test("detectKey: escala de La menor → { tonic:'A', mode:'minor' }", () => {
        const key = detectKey(eventsForKey(9, 'minor'));   // A = clase 9
        assertEqual(key.tonic, 'A', 'tónica');
        assertEqual(key.mode, 'minor', 'modo');
    });

    test("detectKey: escala de Re mayor → { tonic:'D', mode:'major' }", () => {
        const key = detectKey(eventsForKey(2, 'major'));   // D = clase 2
        assertEqual(key.tonic, 'D', 'tónica');
        assertEqual(key.mode, 'major', 'modo');
    });

    // ── findChord ──────────────────────────────────────────────
    test("findChord([0,4,7]) → quality:'major', name contiene 'C'", () => {
        const chord = findChord([0, 4, 7]);
        assertEqual(chord.quality, 'major', 'quality');
        assertContains(chord.name, 'C', 'name');
    });

    test("findChord([9,0,4]) → quality:'minor'", () => {
        // A C E = A menor
        const chord = findChord([9, 0, 4]);
        assertEqual(chord.quality, 'minor', 'quality');
    });

    test("findChord([0,4,7,11]) → quality:'major7'", () => {
        // C E G B = Cmaj7
        const chord = findChord([0, 4, 7, 11]);
        assertEqual(chord.quality, 'major7', 'quality');
    });

    // ── detectPhrases ──────────────────────────────────────────
    test("detectPhrases: progresión V→I → cadenceType:'auténtica'", () => {
        const key = { tonic: 'C', mode: 'major', rootClass: 0 };
        // Compás 0: G (root 7 = grado V), compás 1: C (root 0 = grado I)
        const fused = [
            fusedBlock(0,  7, 'major', 'G'),
            fusedBlock(16, 0, 'major', 'C'),
        ];
        const phrases = detectPhrases(fused, key);
        assert(phrases.length > 0, 'sin frases');
        assert(phrases.some(p => p.cadenceType === 'auténtica'),
               `no se detectó cadencia auténtica (tipos: ${phrases.map(p => p.cadenceType).join(', ')})`);
    });

    test("detectPhrases: progresión IV→I → cadenceType:'plagal'", () => {
        const key = { tonic: 'C', mode: 'major', rootClass: 0 };
        // Compás 0: F (root 5 = grado IV), compás 1: C (root 0 = grado I)
        const fused = [
            fusedBlock(0,  5, 'major', 'F'),
            fusedBlock(16, 0, 'major', 'C'),
        ];
        const phrases = detectPhrases(fused, key);
        assert(phrases.length > 0, 'sin frases');
        assert(phrases.some(p => p.cadenceType === 'plagal'),
               `no se detectó cadencia plagal (tipos: ${phrases.map(p => p.cadenceType).join(', ')})`);
    });

    return results;
}
