// ============================================================
// harmonic.js — Análisis armónico completo
// Fusiona la segmentación temporal (ex-fase3) y el análisis
// de acordes/tonalidad (ex-fase4).
// Depende de: state.js
// ============================================================

// ---- SEGMENTACIÓN TEMPORAL ----

/**
 * Devuelve los ticks únicos donde hay cambio de estado (noteOn/noteOff) para el canal.
 */
function getAllChangeTicks(channelEvents) {
    const ticksSet = new Set([0, totalTicks]);
    for (const ev of channelEvents) ticksSet.add(ev.tick);
    return Array.from(ticksSet).sort((a, b) => a - b);
}

/**
 * Construye segmentos mínimos entre ticks de cambio, con el conjunto de notas activas en cada uno.
 */
function buildSegments(changeTicks, channelEvents) {
    const eventsByTick = new Map();
    for (const ev of channelEvents) {
        if (!eventsByTick.has(ev.tick)) eventsByTick.set(ev.tick, []);
        eventsByTick.get(ev.tick).push(ev);
    }

    const activeNotes = new Map(); // nota → { tickOn, velocity }
    const segments = [];

    for (let i = 0; i < changeTicks.length - 1; i++) {
        const startTick = changeTicks[i];
        const endTick   = changeTicks[i + 1];

        if (eventsByTick.has(startTick)) {
            for (const ev of eventsByTick.get(startTick)) {
                if (ev.type === 'noteOn' && ev.velocity > 0) {
                    activeNotes.set(ev.note, { tickOn: ev.tick, velocity: ev.velocity });
                } else if (ev.type === 'noteOff' || (ev.type === 'noteOn' && ev.velocity === 0)) {
                    activeNotes.delete(ev.note);
                }
            }
        }

        segments.push({
            startTick,
            endTick,
            activeNotes: Array.from(activeNotes.keys()).sort((a, b) => a - b),
            notesDetail: new Map(activeNotes)
        });
    }
    return segments;
}

/**
 * Fusiona segmentos adyacentes con exactamente el mismo conjunto de notas.
 */
function mergeSegments(segments) {
    if (segments.length === 0) return [];
    const merged = [];
    let current = { ...segments[0] };

    for (let i = 1; i < segments.length; i++) {
        const seg = segments[i];
        const sameNotes = current.activeNotes.length === seg.activeNotes.length &&
            current.activeNotes.every((v, idx) => v === seg.activeNotes[idx]);
        if (sameNotes) {
            current.endTick = seg.endTick;
        } else {
            merged.push(current);
            current = { ...seg };
        }
    }
    merged.push(current);
    return merged;
}

/**
 * Convierte los ticks de los segmentos a pasos del grid.
 */
function roundSegmentsToSteps(segments, tps) {
    return segments.map(seg => {
        let startStep = Math.round(seg.startTick / tps);
        let endStep   = Math.round(seg.endTick   / tps);
        if (startStep === endStep) endStep = startStep + 1;
        return { startStep, endStep, activeNotes: seg.activeNotes, notesDetail: seg.notesDetail };
    });
}

/**
 * Punto de entrada principal: obtiene los segmentos armónicos de un canal (en pasos).
 */
function getHarmonicSegments(channel) {
    const channelEvents = rawEvents.filter(
        e => e.channel === channel && (e.type === 'noteOn' || e.type === 'noteOff')
    );
    if (channelEvents.length === 0) return [];

    const changeTicks   = getAllChangeTicks(channelEvents);
    let   segments      = buildSegments(changeTicks, channelEvents);
    segments            = mergeSegments(segments);
    return roundSegmentsToSteps(segments, ppqn / 4);
}


// ---- DETECCIÓN DE TONALIDAD (Krumhansl-Kessler) ----

const KRUH_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KRUH_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function _buildNoteDurationProfile(channelEvents) {
    const pending = new Map();
    const durations = new Map();

    for (const ev of channelEvents) {
        if (ev.type === 'noteOn' && ev.velocity > 0) {
            pending.set(ev.note, ev.tick);
        } else if (ev.type === 'noteOff' || (ev.type === 'noteOn' && ev.velocity === 0)) {
            if (pending.has(ev.note)) {
                const dur = ev.tick - pending.get(ev.note);
                if (dur > 0) durations.set(ev.note, (durations.get(ev.note) || 0) + dur);
                pending.delete(ev.note);
            }
        }
    }
    for (const [note, tickOn] of pending) {
        const dur = totalTicks - tickOn;
        if (dur > 0) durations.set(note, (durations.get(note) || 0) + dur);
    }

    const profile = new Array(12).fill(0);
    for (const [note, dur] of durations) profile[note % 12] += dur;
    return profile;
}

function _pearsonCorrelation(a, b) {
    const n = 12;
    let sA = 0, sB = 0, sA2 = 0, sB2 = 0, sAB = 0;
    for (let i = 0; i < n; i++) {
        sA += a[i]; sB += b[i];
        sA2 += a[i] * a[i]; sB2 += b[i] * b[i];
        sAB += a[i] * b[i];
    }
    const denom = Math.sqrt((sA2 - sA * sA / n) * (sB2 - sB * sB / n));
    return denom === 0 ? 0 : (sAB - sA * sB / n) / denom;
}

/**
 * Detecta la tonalidad de la pieza a partir de los eventos de un canal.
 * @returns {{ tonic: string, mode: string, rootClass: number, correlation: number }}
 */
function detectKey(channelEvents) {
    const profile = _buildNoteDurationProfile(channelEvents);
    let bestCorr = -Infinity, bestTonic = 0, bestMode = "major";

    for (let t = 0; t < 12; t++) {
        const rotMaj = [...KRUH_MAJOR.slice(t), ...KRUH_MAJOR.slice(0, t)];
        const cMaj   = _pearsonCorrelation(profile, rotMaj);
        if (cMaj > bestCorr) { bestCorr = cMaj; bestTonic = t; bestMode = "major"; }

        const rotMin = [...KRUH_MINOR.slice(t), ...KRUH_MINOR.slice(0, t)];
        const cMin   = _pearsonCorrelation(profile, rotMin);
        if (cMin > bestCorr) { bestCorr = cMin; bestTonic = t; bestMode = "minor"; }
    }

    const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    return { tonic: NOTE_NAMES[bestTonic], mode: bestMode, rootClass: bestTonic, correlation: bestCorr };
}


// ---- RECONOCIMIENTO DE ACORDES ----

const CHORD_PATTERNS = [
    { intervals: [0,4,7],     name: "M",    quality: "major"      },
    { intervals: [0,3,7],     name: "m",    quality: "minor"      },
    { intervals: [0,4,7,10],  name: "7",    quality: "dominant7"  },
    { intervals: [0,4,7,11],  name: "maj7", quality: "major7"     },
    { intervals: [0,3,7,10],  name: "m7",   quality: "minor7"     },
    { intervals: [0,3,6],     name: "dim",  quality: "diminished" },
    { intervals: [0,4,8],     name: "aug",  quality: "augmented"  },
    { intervals: [0,4,7,9],   name: "6",    quality: "major6"     },
    { intervals: [0,3,7,9],   name: "m6",   quality: "minor6"     },
    { intervals: [0,5,7],     name: "sus4", quality: "sus4"       },
    { intervals: [0,2,7],     name: "sus2", quality: "sus2"       },
];

function _noteClassesFromNotes(notes) {
    return [...new Set(notes.map(n => n % 12))].sort((a, b) => a - b);
}

/**
 * Identifica el nombre del acorde a partir de las clases de nota activas.
 */
function findChord(noteClasses, bassNote = null) {
    if (noteClasses.length === 0) return { name: "—", root: null, quality: "none", tensions: [] };

    const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    const rootCandidate = bassNote !== null ? (bassNote % 12) : noteClasses[0];
    const candidates = [...new Set([rootCandidate, ...noteClasses.slice(0, 3)])];

    let bestMatch = null, bestScore = -1;

    for (const root of candidates) {
        const intervals = noteClasses.map(c => (c - root + 12) % 12).sort((a, b) => a - b);
        for (const pattern of CHORD_PATTERNS) {
            if (pattern.intervals.every(i => intervals.includes(i))) {
                const tensions = intervals.filter(i => !pattern.intervals.includes(i) && i !== 0);
                const score    = pattern.intervals.length - tensions.length;
                if (score > bestScore) {
                    bestScore = score;
                    const rootName  = NOTE_NAMES[root];
                    const chordName = pattern.name === "M"  ? rootName
                                    : pattern.name === "m"  ? rootName + "m"
                                    : rootName + pattern.name;
                    bestMatch = { name: chordName, root, quality: pattern.quality, tensions };
                }
            }
        }
    }
    return bestMatch || { name: "?", root: noteClasses[0], quality: "unknown", tensions: [] };
}

/**
 * Devuelve la función armónica del acorde dentro de la tonalidad dada.
 */
function getChordFunction(chord, key) {
    if (chord.root === null) return "";
    const degree = (chord.root - key.rootClass + 12) % 12;
    const map = key.mode === "major"
        ? { 0:"Tónica", 2:"Tónica (III)", 5:"Tónica (VI)", 3:"Subdominante (IV)", 1:"Subdominante (II)", 4:"Dominante (V)", 6:"Sensible (VII)" }
        : { 0:"Tónica", 2:"Dominante rel. (III)", 5:"Tónica rel. (VI)", 3:"Subdominante (IV)", 1:"Subdominante (II°)", 4:"Dominante (V)", 6:"Sensible (VII)" };
    return map[degree] || "Cromatismo";
}

/**
 * Detecta la inversión (estado del acorde) comparando el bajo con la fundamental.
 */
function detectInversion(notesMIDI, rootClass) {
    if (notesMIDI.length === 0) return "";
    const bass = notesMIDI[0] % 12;
    if (bass === rootClass)              return "";
    if (bass === (rootClass + 4)  % 12) return " (1ª inv.)";
    if (bass === (rootClass + 7)  % 12) return " (2ª inv.)";
    return "";
}

/**
 * Añade análisis armónico (acorde, función, inversión) a cada segmento.
 */
function analyzeChordsOnSegments(segments, key) {
    return segments.map(seg => {
        if (seg.activeNotes.length === 0) {
            return { ...seg, chord: { name: "—", root: null, quality: "none" }, chordFunction: "", inversion: "", chordDisplay: "—" };
        }
        const noteClasses = _noteClassesFromNotes(seg.activeNotes);
        const chord       = findChord(noteClasses, seg.activeNotes[0]);
        const chordFunction = getChordFunction(chord, key);
        const inversion   = detectInversion(seg.activeNotes, chord.root);
        return { ...seg, chord, chordFunction, inversion, chordDisplay: chord.name + inversion };
    });
}

/**
 * Punto de entrada: análisis armónico completo de un canal.
 * @returns {{ key: Object, segments: Array }}
 */
function performHarmonicAnalysis(channel) {
    const channelEvents = rawEvents.filter(
        e => e.channel === channel && (e.type === 'noteOn' || e.type === 'noteOff')
    );
    if (channelEvents.length === 0) return null;

    const key      = detectKey(channelEvents);
    const segments = getHarmonicSegments(channel);
    return { key, segments: analyzeChordsOnSegments(segments, key) };
}
