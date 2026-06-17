// ============================================================
// motor-map-history.test.js — Undo/redo de cambios en el Motor Map
// Mini-framework inline (sin dependencias externas).
//
// Verifica que _mmEdit() registra el cambio en el historial y que
// historyUndo()/historyRedo() restauran MOTOR_MAP (motor, homePWM, mute, key),
// además de gridData. Requiere DOM stub (runner.html) para los render no-op.
// ============================================================

import { state } from '../js/state.js';
import { historyPush, historyUndo, historyRedo, historyClear } from '../js/history.js';
import { MOTOR_MAP, _mmEdit, getMotorMapSnapshot, restoreMotorMap } from '../js/motor-map.js';

// ── Mini-framework ────────────────────────────────────────────
const results = { passed: 0, failed: 0, tests: [] };
function _record(name, ok, detail) { results.tests.push({ name, ok, detail }); if (ok) results.passed++; else results.failed++; }
function test(name, fn) { try { fn(); _record(name, true, ''); } catch (e) { _record(name, false, e.message); } }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(`${msg || 'assertEqual'} — esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`); }

// Estado de grid mínimo y limpio para que history funcione sin ruido.
function resetEnv() {
    state.gridData = { cells: {} };
    state.noteRows = [];
    state.totalSteps = 0;
    state.heatMapActive = false;
    historyClear();
}

// ============================================================
// Suite
// ============================================================
export function runTests() {
    results.passed = 0; results.failed = 0; results.tests = [];

    test('getMotorMapSnapshot devuelve copia profunda independiente', () => {
        const snap = getMotorMapSnapshot();
        assert(Array.isArray(snap) && snap.length === MOTOR_MAP.length, 'misma longitud');
        snap[0].motor = 999;
        assert(MOTOR_MAP[0].motor !== 999, 'la copia no debe afectar al original');
    });

    test('_mmEdit cambia el campo y es deshacible (motor)', () => {
        resetEnv();
        const orig = MOTOR_MAP[0].motor;
        const nuevo = orig + 7;

        _mmEdit(0, 'motor', nuevo);
        assertEqual(MOTOR_MAP[0].motor, nuevo, 'el valor cambió');

        historyUndo();
        assertEqual(MOTOR_MAP[0].motor, orig, 'undo restaura el valor original');

        historyRedo();
        assertEqual(MOTOR_MAP[0].motor, nuevo, 'redo reaplica el cambio');

        // restaurar
        _mmEdit(0, 'motor', orig);
    });

    test('_mmEdit deshace toggle de mute', () => {
        resetEnv();
        const orig = MOTOR_MAP[1].muted;
        _mmEdit(1, 'muted', !orig);
        assertEqual(MOTOR_MAP[1].muted, !orig, 'mute cambiado');
        historyUndo();
        assertEqual(MOTOR_MAP[1].muted, orig, 'undo restaura mute');
        _mmEdit(1, 'muted', orig);   // dejar como estaba (no-op si ya igual)
    });

    test('_mmEdit deshace cambio de homePWM', () => {
        resetEnv();
        const orig = MOTOR_MAP[2].homePwm;
        _mmEdit(2, 'homePwm', orig + 25);
        assertEqual(MOTOR_MAP[2].homePwm, orig + 25, 'homePwm cambiado');
        historyUndo();
        assertEqual(MOTOR_MAP[2].homePwm, orig, 'undo restaura homePwm');
        _mmEdit(2, 'homePwm', orig);
    });

    test('_mmEdit sin cambio real no ensucia el historial', () => {
        resetEnv();
        const orig = MOTOR_MAP[3].motor;
        _mmEdit(3, 'motor', orig);   // mismo valor → no debe hacer historyPush
        // Un undo no debería alterar MOTOR_MAP (no hay nada que deshacer de este edit)
        historyUndo();
        assertEqual(MOTOR_MAP[3].motor, orig, 'sin cambios espurios');
    });

    test('undo del Motor Map NO altera gridData (independencia de campos)', () => {
        resetEnv();
        state.gridData = { cells: { '60,0': { duration: 1, velocity: 80 } } };
        const origMotor = MOTOR_MAP[0].motor;

        _mmEdit(0, 'motor', origMotor + 3);
        // gridData sigue intacto tras editar el motor map
        assert(state.gridData.cells['60,0'], 'la celda sigue ahí tras editar motor map');

        historyUndo();
        assertEqual(MOTOR_MAP[0].motor, origMotor, 'motor restaurado');
        assert(state.gridData.cells['60,0'], 'la celda se conserva tras el undo');

        _mmEdit(0, 'motor', origMotor);
    });

    test('restoreMotorMap aplica un snapshot completo en sitio', () => {
        resetEnv();
        const before = getMotorMapSnapshot();
        const ref = MOTOR_MAP;            // misma referencia de array
        const modified = getMotorMapSnapshot();
        modified[0].motor = 42;
        modified[0].muted = true;

        restoreMotorMap(modified);
        assert(MOTOR_MAP === ref, 'MOTOR_MAP mantiene su identidad (mutación en sitio)');
        assertEqual(MOTOR_MAP[0].motor, 42, 'snapshot aplicado: motor');
        assertEqual(MOTOR_MAP[0].muted, true, 'snapshot aplicado: muted');

        restoreMotorMap(before);          // restaurar
        assertEqual(MOTOR_MAP[0].motor, before[0].motor, 'restaurado al original');
    });

    test('historial combinado: el snapshot incluye motorMap', () => {
        resetEnv();
        const origMotor = MOTOR_MAP[5].motor;
        // push manual + mutación directa (simula edición compuesta)
        historyPush();
        MOTOR_MAP[5].motor = origMotor + 1;
        historyUndo();
        assertEqual(MOTOR_MAP[5].motor, origMotor, 'el snapshot del historial restaura MOTOR_MAP');
    });

    return results;
}
