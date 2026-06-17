// ============================================================
// harmonic-core.test.js — Tests de la lógica pura del análisis armónico
// (window.HarmonicCore), que es la que ejecuta el Web Worker.
//
// Mini-framework inline (sin dependencias externas). Requiere que runner.html
// haya cargado tonal.min.js y harmonic-core.js antes que los módulos.
// ============================================================

// ── Mini-framework ────────────────────────────────────────────
const results = { passed: 0, failed: 0, tests: [] };
function _record(name, ok, detail) { results.tests.push({ name, ok, detail }); if (ok) results.passed++; else results.failed++; }
function test(name, fn) { try { fn(); _record(name, true, ''); } catch (e) { _record(name, false, e.message); } }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(`${msg || 'assertEqual'} — esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`); }

const C = () => window.HarmonicCore;

/** Genera pares noteOn/noteOff para una secuencia de notas (cada una `dur` ticks). */
function notesToEvents(midiNotes, dur = 96) {
    const events = [];
    let tick = 0;
    for (const note of midiNotes) {
        events.push({ tick,            type: 'noteOn',  channel: 0, note, velocity: 100 });
        events.push({ tick: tick + dur, type: 'noteOff', channel: 0, note, velocity: 0 });
        tick += dur;
    }
    return events;
}

// ============================================================
// Suite
// ============================================================
export function runTests() {
    results.passed = 0; results.failed = 0; results.tests = [];

    test('HarmonicCore está disponible como global', () => {
        assert(typeof window.HarmonicCore === 'object', 'window.HarmonicCore no existe');
        assert(typeof window.HarmonicCore.analyzeChannelEvents === 'function', 'falta analyzeChannelEvents');
    });

    test('analyzeChannelEvents: null si no hay eventos', () => {
        assertEqual(C().analyzeChannelEvents([], 96, 0, 4), null, 'sin eventos → null');
    });

    test('analyzeChannelEvents: escala de C → key C major + segmentos', () => {
        // C D E F G A B C (negras); totalTicks = 8*96
        const events = notesToEvents([60, 62, 64, 65, 67, 69, 71, 72], 96);
        const r = C().analyzeChannelEvents(events, 96, 8 * 96, 4);
        assert(r, 'debería devolver análisis');
        assertEqual(r.key.tonic, 'C', 'tónica');
        assertEqual(r.key.mode, 'major', 'modo');
        assert(Array.isArray(r.segments) && r.segments.length > 0, 'segmentos');
        assert(Array.isArray(r.fusedSegments), 'fusedSegments es array');
        assert(Array.isArray(r.phraseSegments), 'phraseSegments es array');
    });

    test('analyzeChannelEvents: detecta acorde de C mayor en un segmento', () => {
        // C-E-G sonando juntos (mismo tick) durante 96 ticks
        const events = [
            { tick: 0,  type: 'noteOn',  channel: 0, note: 60, velocity: 100 },
            { tick: 0,  type: 'noteOn',  channel: 0, note: 64, velocity: 100 },
            { tick: 0,  type: 'noteOn',  channel: 0, note: 67, velocity: 100 },
            { tick: 96, type: 'noteOff', channel: 0, note: 60, velocity: 0 },
            { tick: 96, type: 'noteOff', channel: 0, note: 64, velocity: 0 },
            { tick: 96, type: 'noteOff', channel: 0, note: 67, velocity: 0 },
        ];
        const r = C().analyzeChannelEvents(events, 96, 96, 4);
        assert(r && r.segments.length > 0, 'sin segmentos');
        const withChord = r.segments.find(s => s.chord && s.chord.quality === 'major');
        assert(withChord, 'debería haber un acorde mayor (C) entre los segmentos');
        assert(/C/.test(withChord.chordDisplay), `chordDisplay debería contener C: "${withChord.chordDisplay}"`);
    });

    test('analyzeChannelEvents: dataset grande (1000+ eventos) no falla', () => {
        const scale = [60,62,64,65,67,69,71,72];
        const events = [];
        let tick = 0;
        for (let i = 0; i < 600; i++) {        // 1200 eventos
            const note = scale[i % scale.length];
            events.push({ tick, type:'noteOn', channel:0, note, velocity:90 });
            events.push({ tick: tick + 48, type:'noteOff', channel:0, note, velocity:0 });
            tick += 48;
        }
        const r = C().analyzeChannelEvents(events, 96, tick, 4);
        assert(r, 'debería analizar el dataset grande');
        assertEqual(events.length, 1200, 'sanity: 1200 eventos');
        assert(r.segments.length > 0, 'segmentos del dataset grande');
    });

    // findChord directo (la primitiva que usa Tonal dentro del worker)
    test('findChord([0,4,7]) → major; findChord([0,4,7,11]) → major7', () => {
        assertEqual(C().findChord([0, 4, 7]).quality, 'major', 'triada mayor');
        assertEqual(C().findChord([0, 4, 7, 11]).quality, 'major7', 'séptima mayor');
    });

    return results;
}
