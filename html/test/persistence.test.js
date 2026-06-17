// ============================================================
// persistence.test.js — Tests de validación de integridad de proyectos
// Mini-framework inline (sin dependencias externas).
//
// Prueba validateProjectData(): la comprobación de campos OBLIGATORIOS que
// loadProject() ejecuta antes de aplicar el estado. Campos opcionales ausentes
// NO deben invalidar (los rellena _applyProjectData con valores por defecto).
// ============================================================

import { validateProjectData } from '../js/persistence.js';

// ── Mini-framework ────────────────────────────────────────────
const results = { passed: 0, failed: 0, tests: [] };
function _record(name, ok, detail) { results.tests.push({ name, ok, detail }); if (ok) results.passed++; else results.failed++; }
function test(name, fn) { try { fn(); _record(name, true, ''); } catch (e) { _record(name, false, e.message); } }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(`${msg || 'assertEqual'} — esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`); }

/** Proyecto válido mínimo (estructura de saveProject). */
function validProject() {
    return {
        gridData:   { cells: { '60,0': { duration: 1, velocity: 90 } } },
        noteRows:   [60],
        totalSteps: 16,
        ppqn:       96,
        tempoMap:   [{ tick: 0, bpm: 120 }],
        // opcionales:
        ticksPerStep: 24,
        selectedChannel: 0,
        currentKey: 'C',
        harmonicSegments: [], fusedSegments: [], phraseSegments: [],
        tempoPoints: [{ step: 0, bpm: 120 }],
        sectionMarkers: [],
        stepWidth: 8, rowHeight: 25,
    };
}

// ============================================================
// Suite
// ============================================================
export function runTests() {
    results.passed = 0; results.failed = 0; results.tests = [];

    // ── Caso válido ────────────────────────────────────────────
    test('proyecto válido completo → { valid: true }', () => {
        const r = validateProjectData(validProject());
        assertEqual(r.valid, true, 'debería ser válido');
        assertEqual(r.error, null, 'sin error');
    });

    // ── No-objeto / null ───────────────────────────────────────
    test('null → inválido', () => {
        assertEqual(validateProjectData(null).valid, false, 'null no es válido');
    });
    test('array → inválido', () => {
        assertEqual(validateProjectData([]).valid, false, 'array no es proyecto');
    });
    test('string → inválido', () => {
        assertEqual(validateProjectData('nope').valid, false, 'string no es proyecto');
    });

    // ── gridData / cells ───────────────────────────────────────
    test('falta gridData → inválido con error descriptivo', () => {
        const p = validProject(); delete p.gridData;
        const r = validateProjectData(p);
        assert(!r.valid, 'debería ser inválido');
        assert(/gridData/.test(r.error), `error debe mencionar gridData: "${r.error}"`);
    });
    test('gridData sin cells → inválido', () => {
        const p = validProject(); p.gridData = {};
        const r = validateProjectData(p);
        assert(!r.valid, 'debería ser inválido');
        assert(/cells/.test(r.error), `error debe mencionar cells: "${r.error}"`);
    });
    test('gridData.cells que es array → inválido', () => {
        const p = validProject(); p.gridData = { cells: [] };
        assert(!validateProjectData(p).valid, 'cells array no vale');
    });

    // ── noteRows ───────────────────────────────────────────────
    test('falta noteRows → inválido', () => {
        const p = validProject(); delete p.noteRows;
        const r = validateProjectData(p);
        assert(!r.valid && /noteRows/.test(r.error), `error noteRows: "${r.error}"`);
    });
    test('noteRows que no es array → inválido', () => {
        const p = validProject(); p.noteRows = 'x';
        assert(!validateProjectData(p).valid, 'noteRows string no vale');
    });

    // ── totalSteps ─────────────────────────────────────────────
    test('totalSteps = 0 → inválido', () => {
        const p = validProject(); p.totalSteps = 0;
        const r = validateProjectData(p);
        assert(!r.valid && /totalSteps/.test(r.error), `error totalSteps: "${r.error}"`);
    });
    test('totalSteps negativo → inválido', () => {
        const p = validProject(); p.totalSteps = -5;
        assert(!validateProjectData(p).valid, 'totalSteps negativo no vale');
    });
    test('totalSteps no numérico → inválido', () => {
        const p = validProject(); p.totalSteps = '16';
        assert(!validateProjectData(p).valid, 'totalSteps string no vale');
    });

    // ── ppqn ───────────────────────────────────────────────────
    test('ppqn = 0 → inválido', () => {
        const p = validProject(); p.ppqn = 0;
        const r = validateProjectData(p);
        assert(!r.valid && /ppqn/.test(r.error), `error ppqn: "${r.error}"`);
    });
    test('falta ppqn → inválido', () => {
        const p = validProject(); delete p.ppqn;
        assert(!validateProjectData(p).valid, 'ppqn ausente no vale');
    });

    // ── tempoMap ───────────────────────────────────────────────
    test('tempoMap vacío → inválido', () => {
        const p = validProject(); p.tempoMap = [];
        const r = validateProjectData(p);
        assert(!r.valid && /tempoMap/.test(r.error), `error tempoMap: "${r.error}"`);
    });
    test('falta tempoMap → inválido', () => {
        const p = validProject(); delete p.tempoMap;
        assert(!validateProjectData(p).valid, 'tempoMap ausente no vale');
    });

    // ── Campos OPCIONALES ausentes → SIGUE siendo válido ───────
    test('sin sectionMarkers / tempoPoints / stepWidth → sigue válido', () => {
        const p = validProject();
        delete p.sectionMarkers;
        delete p.tempoPoints;
        delete p.stepWidth;
        delete p.rowHeight;
        delete p.currentKey;
        delete p.harmonicSegments;
        const r = validateProjectData(p);
        assertEqual(r.valid, true, `los opcionales ausentes no deben invalidar: "${r.error}"`);
    });

    return results;
}
