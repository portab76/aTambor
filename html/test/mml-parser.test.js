// ============================================================
// mml-parser.test.js — Tests de la conversión MML → eventos/celdas del grid
// Mini-framework inline (sin dependencias externas).
//
// Se prueba parseMMLTrackToEvents() (función pura: MML → eventos noteOn/noteOff)
// y se derivan las "celdas del grid" como hace el piano roll:
//   step      = tick / ticksPerStep         (ticksPerStep = ppqn/4 = 24)
//   durPasos  = (tickOff - tickOn) / ticksPerStep
//
// NOTA sobre la semántica (parser real, MML estándar):
//   El número tras una nota es la FIGURA musical, no el nº de pasos:
//     "C4" = negra  = 96 ticks = 4 pasos
//     "C2" = blanca = 192 ticks = 8 pasos
//   El parser NO soporta sintaxis de acorde "[CEG]": los corchetes se ignoran
//   y C, E, G se emiten como notas CONSECUTIVAS.
//   Estos tests reflejan ese comportamiento real (decisión acordada).
// ============================================================

import { parseMMLTrackToEvents } from '../js/mml-parser.js';

// ── Mini-framework de test ────────────────────────────────────
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

function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error(`${msg || 'assertEqual'} — esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`);
    }
}

// ── Helpers ───────────────────────────────────────────────────

const MML_PPQN      = 96;
const TICKS_PER_STEP = MML_PPQN / 4;   // 24 ticks = 1 semicorchea = 1 paso

/**
 * Parsea una pista MML y devuelve las "celdas del grid" derivadas de los
 * eventos: una celda por noteOn, con { note, step, durPasos }.
 */
function mmlToCells(src) {
    const { events } = parseMMLTrackToEvents(src, 0);
    const cells = [];
    for (const on of events) {
        if (on.type !== 'noteOn') continue;
        const off = events.find(e => e.type === 'noteOff' && e.note === on.note && e.tick > on.tick);
        cells.push({
            note:     on.note,
            step:     on.tick / TICKS_PER_STEP,
            durPasos: off ? (off.tick - on.tick) / TICKS_PER_STEP : null,
            velocity: on.velocity,
        });
    }
    return cells;
}

// ============================================================
// Suite
// ============================================================
export function runTests() {
    results.passed = 0; results.failed = 0; results.tests = [];

    // "C4" → Do4 (MIDI 60). Octava por defecto = 4 → (4+1)*12 = 60.
    // Duración: figura 4 (negra) = 96 ticks = 4 pasos.
    test('"C4" → nota Do4 (MIDI 60), duración 4 pasos (negra)', () => {
        const cells = mmlToCells('C4');
        assertEqual(cells.length, 1, 'nº de notas');
        assertEqual(cells[0].note, 60, 'nota (Do4 = MIDI 60)');
        assertEqual(cells[0].step, 0, 'paso de inicio');
        assertEqual(cells[0].durPasos, 4, 'duración en pasos (negra = 4)');
    });

    // "C4D4E4" → tres notas consecutivas (cada negra empieza tras la anterior).
    test('"C4D4E4" → tres notas consecutivas (Do Re Mi)', () => {
        const cells = mmlToCells('C4D4E4');
        assertEqual(cells.length, 3, 'nº de notas');
        assertEqual(cells[0].note, 60, 'nota 1 = C (60)');
        assertEqual(cells[1].note, 62, 'nota 2 = D (62)');
        assertEqual(cells[2].note, 64, 'nota 3 = E (64)');
        // Consecutivas: cada una empieza 4 pasos después de la anterior
        assertEqual(cells[0].step, 0, 'C en paso 0');
        assertEqual(cells[1].step, 4, 'D en paso 4');
        assertEqual(cells[2].step, 8, 'E en paso 8');
    });

    // "R4" → silencio: avanza el tiempo, no genera ninguna celda.
    test('"R4" → silencio (ninguna celda)', () => {
        const cells = mmlToCells('R4');
        assertEqual(cells.length, 0, 'no debe haber notas');
        // El silencio sí consume tiempo: la pista dura 4 pasos
        const { totalTicks } = parseMMLTrackToEvents('R4', 0);
        assertEqual(totalTicks / TICKS_PER_STEP, 4, 'el silencio avanza 4 pasos');
    });

    // "O5 C4" → C en octava 5 → (5+1)*12 = 72.
    test('"O5 C4" → nota en octava 5 (MIDI 72)', () => {
        const cells = mmlToCells('O5 C4');
        assertEqual(cells.length, 1, 'nº de notas');
        assertEqual(cells[0].note, 72, 'C5 = MIDI 72');
    });

    // "[CEG]4" → el parser NO soporta acordes con corchetes: ignora '[' y ']'
    // y emite C, E, G como notas CONSECUTIVAS (figura por defecto = negra).
    test('"[CEG]4" → C,E,G consecutivas (sin soporte de acorde [])', () => {
        const cells = mmlToCells('[CEG]4');
        assertEqual(cells.length, 3, 'tres notas');
        assertEqual(cells[0].note, 60, 'C (60)');
        assertEqual(cells[1].note, 64, 'E (64)');
        assertEqual(cells[2].note, 67, 'G (67)');
        // Consecutivas (no apiladas): pasos 0, 4, 8 — NO todas en el paso 0
        assertEqual(cells[0].step, 0, 'C en paso 0');
        assertEqual(cells[1].step, 4, 'E en paso 4');
        assertEqual(cells[2].step, 8, 'G en paso 8');
    });

    // "C2" → figura 2 (blanca) = 192 ticks = 8 pasos.
    test('"C2" → nota con duración 8 pasos (blanca)', () => {
        const cells = mmlToCells('C2');
        assertEqual(cells.length, 1, 'nº de notas');
        assertEqual(cells[0].durPasos, 8, 'duración en pasos (blanca = 8)');
    });

    // MML malformado → sin notas, sin lanzar excepción.
    test('MML malformado → resultado vacío, sin lanzar excepción', () => {
        let cells;
        // Caracteres no reconocidos: el parser los ignora silenciosamente
        cells = mmlToCells('XYZ%%%@@@123');
        assertEqual(cells.length, 0, 'no debe generar notas');
        // Cadena vacía
        assertEqual(mmlToCells('').length, 0, 'cadena vacía → 0 notas');
    });

    return results;
}
