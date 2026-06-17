// ============================================================
// midi-export.test.js — Tests de la exportación a .mid binario
// Mini-framework inline (sin dependencias externas).
//
// buildMidiBytes() serializa state.gridData a un archivo MIDI estándar.
// Lo verificamos haciendo ROUND-TRIP: parseamos los bytes generados con el
// mismo parser jasmid (MidiFile) que usa la app y comprobamos header, tempo,
// compás y eventos noteOn/noteOff. Si jasmid lo parsea sin error, cualquier
// DAW también podrá abrirlo.
//
// Requiere jasmid global (Stream + MidiFile), cargado por runner.html.
// ============================================================

import { state } from '../js/state.js';
import { buildMidiBytes } from '../js/midi-export.js';

// ── Mini-framework ────────────────────────────────────────────
const results = { passed: 0, failed: 0, tests: [] };
function _record(name, ok, detail) { results.tests.push({ name, ok, detail }); if (ok) results.passed++; else results.failed++; }
function test(name, fn) { try { fn(); _record(name, true, ''); } catch (e) { _record(name, false, e.message); } }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(`${msg || 'assertEqual'} — esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`); }

// Uint8Array → binary string que espera jasmid Stream()
function bytesToBinaryString(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
}

/** Parsea los bytes exportados con jasmid y aplana los eventos con tick absoluto. */
function parseExported(bytes) {
    const parsed = MidiFile(bytesToBinaryString(bytes));   // jasmid global
    const tracks = parsed.tracks.map(track => {
        let tick = 0;
        return track.map(ev => { tick += ev.deltaTime; return { ...ev, absTick: tick }; });
    });
    return { header: parsed.header, tracks };
}

/** Fija un estado de grid conocido para exportar. */
function setupState(cells, { ppqn = 96, bpm = 120, ts = { numerator: 4, denominator: 4 } } = {}) {
    state.ppqn = ppqn;
    state.gridData = { cells };
    state.tempoPoints = [{ step: 0, bpm }];
    state.currentTimeSig = { numerator: ts.numerator, denominator: ts.denominator,
        stepsPerMeasure: ts.numerator * (16 / ts.denominator), stepsPerBeat: 16 / ts.denominator };
    state.transposeOffset = 0;
    state.currentMidiFileName = '';
}

// ============================================================
// Suite
// ============================================================
export function runTests() {
    results.passed = 0; results.failed = 0; results.tests = [];

    // ── Header: MThd válido con ppqn de state ─────────────────
    test('header MThd: ppqn de state, archivo parseable por jasmid', () => {
        setupState({ '60,0': { duration: 4, velocity: 100 } }, { ppqn: 96 });
        const { header } = parseExported(buildMidiBytes());
        assertEqual(header.ticksPerBeat, 96, 'ppqn del header');
        assert(header.trackCount >= 1, 'al menos 1 track');
    });

    test('header respeta un ppqn distinto (480)', () => {
        setupState({ '60,0': { duration: 4, velocity: 100 } }, { ppqn: 480 });
        const { header } = parseExported(buildMidiBytes());
        assertEqual(header.ticksPerBeat, 480, 'ppqn 480');
    });

    // ── setTempo desde tempoPoints[0].bpm ─────────────────────
    test('setTempo: BPM de state.tempoPoints[0] (140)', () => {
        setupState({ '60,0': { duration: 4, velocity: 100 } }, { bpm: 140 });
        const { tracks } = parseExported(buildMidiBytes());
        const tempoEv = tracks.flat().find(e => e.subtype === 'setTempo');
        assert(tempoEv, 'falta evento setTempo');
        const bpm = Math.round(60000000 / tempoEv.microsecondsPerBeat);
        assertEqual(bpm, 140, 'BPM exportado');
    });

    // ── timeSignature desde state.currentTimeSig ──────────────
    test('timeSignature 3/4 desde state.currentTimeSig', () => {
        setupState({ '60,0': { duration: 4, velocity: 100 } }, { ts: { numerator: 3, denominator: 4 } });
        const { tracks } = parseExported(buildMidiBytes());
        const tsEv = tracks.flat().find(e => e.subtype === 'timeSignature');
        assert(tsEv, 'falta evento timeSignature');
        assertEqual(tsEv.numerator, 3,   'numerador');
        assertEqual(tsEv.denominator, 4, 'denominador (jasmid lo da como valor real)');
    });

    // ── noteOn/noteOff: posición y duración correctas ─────────
    test('una nota: noteOn en tick correcto y noteOff tras la duración', () => {
        // Nota C4 (60) en paso 4, duración 2 pasos. ticksPerStep = 96/4 = 24.
        setupState({ '60,4': { duration: 2, velocity: 100 } }, { ppqn: 96 });
        const { tracks } = parseExported(buildMidiBytes());
        const evs = tracks.flat();

        const on  = evs.find(e => e.subtype === 'noteOn'  && e.noteNumber === 60);
        const off = evs.find(e => e.subtype === 'noteOff' && e.noteNumber === 60);
        assert(on,  'falta noteOn');
        assert(off, 'falta noteOff');

        const tps = 96 / 4;            // 24
        assertEqual(on.absTick, 4 * tps, 'noteOn en paso 4 (tick 96)');
        assertEqual(on.velocity, 100, 'velocity');
        // noteOff = (step + duration) * tps - 1 = (4+2)*24 - 1 = 143
        assertEqual(off.absTick, (4 + 2) * tps - 1, 'noteOff tras 2 pasos');
    });

    // ── varias notas: cuenta de eventos coherente ─────────────
    test('tres notas → 3 noteOn + 3 noteOff', () => {
        setupState({
            '60,0': { duration: 1, velocity: 80 },
            '64,0': { duration: 1, velocity: 80 },
            '67,0': { duration: 1, velocity: 80 },
        });
        const { tracks } = parseExported(buildMidiBytes());
        const evs = tracks.flat();
        const ons  = evs.filter(e => e.subtype === 'noteOn');
        const offs = evs.filter(e => e.subtype === 'noteOff');
        assertEqual(ons.length, 3,  '3 noteOn');
        assertEqual(offs.length, 3, '3 noteOff');
        const notes = ons.map(e => e.noteNumber).sort((a, b) => a - b);
        assertEqual(JSON.stringify(notes), JSON.stringify([60, 64, 67]), 'notas correctas');
    });

    // ── endOfTrack presente en cada track ─────────────────────
    test('cada track termina con endOfTrack', () => {
        setupState({ '60,0': { duration: 4, velocity: 100 } });
        const { tracks } = parseExported(buildMidiBytes());
        for (const track of tracks) {
            const last = track[track.length - 1];
            assertEqual(last.subtype, 'endOfTrack', 'último evento del track');
        }
    });

    // ── transposeOffset se aplica al exportar ─────────────────
    test('transposeOffset desplaza las notas exportadas', () => {
        setupState({ '60,0': { duration: 1, velocity: 100 } });
        state.transposeOffset = 12;   // +1 octava
        const { tracks } = parseExported(buildMidiBytes());
        const on = tracks.flat().find(e => e.subtype === 'noteOn');
        assertEqual(on.noteNumber, 72, 'nota transpuesta +12');
        state.transposeOffset = 0;
    });

    return results;
}
