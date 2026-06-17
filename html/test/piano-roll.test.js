// ============================================================
// piano-roll.test.js — Tests de la virtualización vertical del canvas
// Mini-framework inline (sin dependencias externas).
//
// computeVisibleRowRange(scrollTop, viewH, rowHeight, rowCount) → [first, last]
// es el cálculo puro de la banda de filas a pintar (con overscan de 2 filas).
// El canvas conserva la altura total; solo se acota qué filas se dibujan.
// ============================================================

import { computeVisibleRowRange } from '../js/piano-roll.js';

// ── Mini-framework ────────────────────────────────────────────
const results = { passed: 0, failed: 0, tests: [] };
function _record(name, ok, detail) { results.tests.push({ name, ok, detail }); if (ok) results.passed++; else results.failed++; }
function test(name, fn) { try { fn(); _record(name, true, ''); } catch (e) { _record(name, false, e.message); } }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(`${msg || 'assertEqual'} — esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`); }
function assertRange(r, first, last, msg) {
    assert(Array.isArray(r) && r.length === 2, (msg || '') + ' — no es un rango');
    assertEqual(r[0], first, (msg || '') + ' first');
    assertEqual(r[1], last,  (msg || '') + ' last');
}

const ROW_OVERSCAN = 2;   // debe coincidir con piano-roll.js

// ============================================================
// Suite
// ============================================================
export function runTests() {
    results.passed = 0; results.failed = 0; results.tests = [];

    // rowHeight = 25 en todos los casos; 88 filas (teclado completo)

    // ── Scroll en la cima: primeras filas + overscan inferior ──
    test('scrollTop=0 → desde fila 0; banda = viewport/rowHeight + overscan', () => {
        // viewH=250 → 10 filas visibles; +2 overscan abajo (arriba clamp a 0)
        const r = computeVisibleRowRange(0, 250, 25, 88);
        assertRange(r, 0, 12, 'cima');   // last = ceil(250/25)+2 = 12
    });

    // ── Scroll a media página ─────────────────────────────────
    test('scroll a media página → banda centrada con overscan a ambos lados', () => {
        // scrollTop=500 (fila 20), viewH=250 (10 filas)
        // first = floor(500/25)-2 = 18 ; last = ceil(750/25)+2 = 32
        const r = computeVisibleRowRange(500, 250, 25, 88);
        assertRange(r, 18, 32, 'media página');
    });

    // ── Scroll al fondo: last se clampa a rowCount-1 ──────────
    test('scroll al fondo → last se limita a rowCount-1', () => {
        // 88 filas * 25 = 2200px de alto total; scrollTop cerca del fondo
        const r = computeVisibleRowRange(2200 - 250, 250, 25, 88);
        // last no puede pasar de 87
        assertEqual(r[1], 87, 'last clamped');
        assert(r[0] < r[1], 'first < last');
        assert(r[0] >= 0, 'first no negativo');
    });

    // ── La banda virtualizada es mucho menor que el total ─────
    test('la banda dibujada es << que el total de filas', () => {
        const [first, last] = computeVisibleRowRange(500, 250, 25, 88);
        const drawn = last - first + 1;
        // 10 filas visibles + 4 de overscan = 14, muy por debajo de 88
        assert(drawn <= 20, `debería dibujar pocas filas, dibuja ${drawn}`);
        assert(drawn < 88, 'debe dibujar menos que todas las filas');
    });

    // ── Sin layout (viewH = 0) → pinta TODAS las filas ────────
    test('viewH=0 (sin layout) → pinta todas las filas [0, n-1]', () => {
        assertRange(computeVisibleRowRange(0, 0, 25, 88), 0, 87, 'sin layout');
        assertRange(computeVisibleRowRange(100, 0, 25, 88), 0, 87, 'sin layout con scroll');
    });

    // ── overscan exacto en la cima ────────────────────────────
    test('overscan: first nunca es negativo (clamp a 0 en la cima)', () => {
        const r = computeVisibleRowRange(10, 250, 25, 88);  // floor(10/25)-2 = -2 → 0
        assertEqual(r[0], 0, 'first clamp a 0');
    });

    // ── overscan correcto (no recorta filas visibles) ─────────
    test('la banda incluye overscan de 2 filas por arriba', () => {
        // scrollTop=500 → primera fila realmente visible = 20; con overscan = 18
        const [first] = computeVisibleRowRange(500, 250, 25, 88);
        assertEqual(first, 20 - ROW_OVERSCAN, 'overscan superior');
    });

    // ── grid vacío ────────────────────────────────────────────
    test('rowCount=0 → rango vacío [0, -1]', () => {
        assertRange(computeVisibleRowRange(0, 250, 25, 0), 0, -1, 'vacío');
    });

    // ── La virtualización NO altera el resultado con pocas filas ──
    test('si todas las filas caben en el viewport → se pintan todas', () => {
        // 10 filas, viewport de 250px (10 filas) → todas visibles
        const r = computeVisibleRowRange(0, 250, 25, 10);
        assertRange(r, 0, 9, 'todas caben');
    });

    return results;
}
