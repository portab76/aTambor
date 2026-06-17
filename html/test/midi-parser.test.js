// ============================================================
// midi-parser.test.js — Tests de loadMIDIFile() con fixtures binarios
// Mini-framework inline (sin dependencias externas).
//
// El fixture MIDI se construye byte a byte como Uint8Array dentro del test
// (header MThd + pista MTrk con timeSignature, setTempo, noteOn/noteOff).
// loadMIDIFile espera un "binary string" (cada char = 1 byte), igual que el
// que produce FileReader.readAsArrayBuffer en la app.
//
// Requiere jasmid global (Stream + MidiFile), cargado por runner.html.
// ============================================================

import { loadMIDIFile } from '../js/midi-parser.js';

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

// ── Constructor de fixtures MIDI ──────────────────────────────

/** Codifica un entero como Variable-Length Quantity (deltaTime MIDI). */
function vlq(value) {
    const bytes = [value & 0x7f];
    value >>= 7;
    while (value > 0) {
        bytes.unshift((value & 0x7f) | 0x80);
        value >>= 7;
    }
    return bytes;
}

/** Big-endian de 4 bytes. */
function uint32(v) {
    return [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/** Big-endian de 2 bytes. */
function uint16(v) {
    return [(v >> 8) & 0xff, v & 0xff];
}

/**
 * Construye un archivo MIDI Tipo 0 de 1 pista con los eventos indicados.
 * @param {Object} opts
 *   ppqn          — ticks por negra (header)
 *   timeSigNum    — numerador del compás (opcional)
 *   timeSigDenExp — exponente del denominador (2 → negra=4) (opcional)
 *   bpm           — tempo (opcional; genera setTempo)
 *   notes         — [{ deltaOn, note, velocity, duration, channel }]
 * @returns {Uint8Array}
 */
function buildMidi({ ppqn = 96, timeSigNum, timeSigDenExp, bpm, notes = [] } = {}) {
    const trackData = [];

    // timeSignature (en tick 0)
    if (timeSigNum !== undefined) {
        trackData.push(...vlq(0), 0xFF, 0x58, 0x04, timeSigNum, timeSigDenExp, 24, 8);
    }
    // setTempo (en tick 0)
    if (bpm !== undefined) {
        const mpb = Math.round(60000000 / bpm);   // microsegundos por negra
        trackData.push(...vlq(0), 0xFF, 0x51, 0x03,
            (mpb >> 16) & 0xff, (mpb >> 8) & 0xff, mpb & 0xff);
    }
    // notas: noteOn (deltaOn) + noteOff (duration)
    for (const n of notes) {
        const ch = n.channel || 0;
        trackData.push(...vlq(n.deltaOn ?? 0), 0x90 | ch, n.note, n.velocity);
        trackData.push(...vlq(n.duration ?? 96), 0x80 | ch, n.note, 0);
    }
    // endOfTrack
    trackData.push(...vlq(0), 0xFF, 0x2F, 0x00);

    const header = [
        0x4D, 0x54, 0x68, 0x64,        // "MThd"
        ...uint32(6),                  // header length
        ...uint16(0),                  // formatType 0
        ...uint16(1),                  // trackCount 1
        ...uint16(ppqn),               // timeDivision (PPQN)
    ];
    const track = [
        0x4D, 0x54, 0x72, 0x6B,        // "MTrk"
        ...uint32(trackData.length),   // track length
        ...trackData,
    ];

    return new Uint8Array([...header, ...track]);
}

/** Convierte un Uint8Array al binary string que espera loadMIDIFile. */
function toBinaryString(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
}

function loadBytes(bytes) {
    return loadMIDIFile(toBinaryString(bytes));
}

// ============================================================
// Suite
// ============================================================
export function runTests() {
    results.passed = 0; results.failed = 0; results.tests = [];

    // ── PPQN del header ────────────────────────────────────────
    test("PPQN se lee correctamente del header", () => {
        const r = loadBytes(buildMidi({ ppqn: 480, notes: [{ note: 60, velocity: 100 }] }));
        assert(!r.error, 'no debería haber error: ' + r.error);
        assertEqual(r.ppqn, 480, 'ppqn');
    });

    // ── noteOn / noteOff ───────────────────────────────────────
    test("noteOn y noteOff se extraen con tick, channel, note y velocity correctos", () => {
        const r = loadBytes(buildMidi({
            ppqn: 96,
            notes: [{ deltaOn: 0, note: 64, velocity: 90, duration: 96, channel: 2 }],
        }));
        assert(!r.error, 'no debería haber error: ' + r.error);

        const on  = r.rawEvents.find(e => e.type === 'noteOn');
        const off = r.rawEvents.find(e => e.type === 'noteOff');

        assert(on,  'falta noteOn');
        assert(off, 'falta noteOff');

        assertEqual(on.tick, 0,       'noteOn.tick');
        assertEqual(on.channel, 2,    'noteOn.channel');
        assertEqual(on.note, 64,      'noteOn.note');
        assertEqual(on.velocity, 90,  'noteOn.velocity');

        assertEqual(off.tick, 96,     'noteOff.tick');
        assertEqual(off.channel, 2,   'noteOff.channel');
        assertEqual(off.note, 64,     'noteOff.note');
        assertEqual(off.velocity, 0,  'noteOff.velocity');
    });

    // ── setTempo → tempoMap ────────────────────────────────────
    test("setTempo actualiza tempoMap con el BPM correcto", () => {
        const r = loadBytes(buildMidi({
            ppqn: 96, bpm: 140,
            notes: [{ note: 60, velocity: 100 }],
        }));
        assert(!r.error, 'no debería haber error: ' + r.error);

        // tempoMap[0] es el default {tick:0,bpm:120}; el setTempo se añade después.
        const tempo = r.tempoMap.find(t => Math.round(t.bpm) === 140);
        assert(tempo, `tempoMap no contiene 140 BPM (tiene: ${r.tempoMap.map(t => Math.round(t.bpm)).join(', ')})`);
        // bpm del resultado (el efectivo de la pieza) debe ser 140
        assertEqual(r.bpm, 140, 'bpm efectivo');
    });

    // ── timeSignature 3/4 → stepsPerMeasure 12 ─────────────────
    test("timeSignature 3/4 produce stepsPerMeasure=12", () => {
        const r = loadBytes(buildMidi({
            ppqn: 96,
            timeSigNum: 3, timeSigDenExp: 2,   // 3/4 (2^2 = 4 = negra)
            notes: [{ note: 60, velocity: 100 }],
        }));
        assert(!r.error, 'no debería haber error: ' + r.error);
        assertEqual(r.timeSig.numerator, 3,        'numerator');
        assertEqual(r.timeSig.denominator, 4,      'denominator');
        assertEqual(r.timeSig.stepsPerMeasure, 12, 'stepsPerMeasure');
        assertEqual(r.timeSig.stepsPerBeat, 4,     'stepsPerBeat');
    });

    // ── Archivo inválido → { error }, sin lanzar ───────────────
    test("archivo inválido → resultado con campo error, sin lanzar excepción", () => {
        // Bytes basura: no es un chunk MThd válido
        const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
        let r;
        // No debe lanzar: loadMIDIFile captura la excepción internamente
        r = loadBytes(garbage);
        assert(r && typeof r === 'object', 'debería devolver un objeto');
        assert('error' in r, 'el resultado debe tener campo error');
        assert(r.error, 'error no debe ser vacío');
    });

    return results;
}
