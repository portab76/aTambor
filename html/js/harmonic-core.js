// ============================================================
// harmonic-core.js — Lógica PURA de análisis armónico (sin estado, sin DOM)
//
// Diseñado para ejecutarse en DOS contextos sin duplicar el algoritmo:
//   1. Hilo principal: se carga como <script> clásico tras tonal.min.js
//      y expone window.HarmonicCore. harmonic.js lo consume como global.
//   2. Web Worker (clásico): se carga con
//      importScripts('tonal.min.js', 'harmonic-core.js') y expone self.HarmonicCore.
//
// Todas las funciones reciben sus dependencias como parámetros (ppqn,
// totalTicks, fusionStepsPerUnit, channelEvents…) en lugar de leer `state`.
// `Tonal` se referencia como global (presente en ambos contextos).
// ============================================================

(function (root) {
    'use strict';

    // ---- SEGMENTACIÓN TEMPORAL ----

    function getAllChangeTicks(channelEvents, totalTicks) {
        const ticksSet = new Set([0, totalTicks]);
        for (const ev of channelEvents) ticksSet.add(ev.tick);
        return Array.from(ticksSet).sort((a, b) => a - b);
    }

    function buildSegments(changeTicks, channelEvents) {
        const eventsByTick = new Map();
        for (const ev of channelEvents) {
            if (!eventsByTick.has(ev.tick)) eventsByTick.set(ev.tick, []);
            eventsByTick.get(ev.tick).push(ev);
        }

        const activeNotes = new Map();
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

    function roundSegmentsToSteps(segments, tps) {
        return segments.map(seg => {
            let startStep = Math.floor(seg.startTick / tps);
            let endStep   = Math.floor(seg.endTick   / tps);
            if (startStep === endStep) endStep = startStep + 1;
            return { startStep, endStep, activeNotes: seg.activeNotes, notesDetail: seg.notesDetail };
        });
    }

    /** Segmentos armónicos (en pasos) a partir de los eventos de un canal. */
    function getHarmonicSegments(channelEvents, ppqn, totalTicks) {
        if (channelEvents.length === 0) return [];
        const changeTicks = getAllChangeTicks(channelEvents, totalTicks);
        let   segments    = buildSegments(changeTicks, channelEvents);
        segments          = mergeSegments(segments);
        return roundSegmentsToSteps(segments, ppqn / 4);
    }

    // ---- DETECCIÓN DE TONALIDAD (Krumhansl-Kessler) ----

    const KRUH_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    const KRUH_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

    function _buildNoteDurationProfile(channelEvents, totalTicks) {
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

    function detectKey(channelEvents, totalTicks) {
        const profile = _buildNoteDurationProfile(channelEvents, totalTicks);
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

    // ---- RECONOCIMIENTO DE ACORDES (Tonal.js) ----

    const _NOTE_NAMES_H = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

    function _mapTonalQuality(type) {
        if (!type) return 'unknown';
        const t = type.toLowerCase();
        if (t === 'major seventh' || t === 'major/major seventh') return 'major7';
        if (t === 'minor seventh')    return 'minor7';
        if (t === 'dominant seventh') return 'dominant7';
        if (t === 'diminished')       return 'diminished';
        if (t === 'diminished seventh') return 'diminished';
        if (t === 'augmented')        return 'augmented';
        if (t === 'major sixth')      return 'major6';
        if (t === 'minor sixth')      return 'minor6';
        if (t === 'suspended fourth') return 'sus4';
        if (t === 'suspended second') return 'sus2';
        if (t === 'minor')            return 'minor';
        if (t === 'major')            return 'major';
        return 'unknown';
    }

    function findChord(noteClasses, bassNote) {
        if (bassNote === undefined) bassNote = null;
        if (noteClasses.length === 0) return { name: "—", root: null, quality: "none", tensions: [] };

        let names = noteClasses.map(c => _NOTE_NAMES_H[c]);
        if (bassNote !== null) {
            const bassName = _NOTE_NAMES_H[bassNote % 12];
            names = [bassName, ...names.filter(n => n !== bassName)];
        }

        const detected = Tonal.Chord.detect(names);
        if (!detected || detected.length === 0) {
            return { name: "?", root: noteClasses[0], quality: "unknown", tensions: [] };
        }

        const best = detected.find(c => !c.includes('/')) || detected[0];
        const info  = Tonal.Chord.get(best);
        const root  = _NOTE_NAMES_H.indexOf(info.tonic);

        return {
            name:     best,
            root:     root === -1 ? noteClasses[0] : root,
            quality:  _mapTonalQuality(info.type),
            tensions: []
        };
    }

    function _noteClassesFromNotes(notes) {
        return [...new Set(notes.map(n => n % 12))].sort((a, b) => a - b);
    }

    function getChordFunction(chord, key) {
        if (chord.root === null) return "";
        const degree = (chord.root - key.rootClass + 12) % 12;
        const map = key.mode === "major"
            ? { 0:"Tónica", 2:"Tónica (III)", 5:"Tónica (VI)", 3:"Subdominante (IV)", 1:"Subdominante (II)", 4:"Dominante (V)", 6:"Sensible (VII)" }
            : { 0:"Tónica", 2:"Dominante rel. (III)", 5:"Tónica rel. (VI)", 3:"Subdominante (IV)", 1:"Subdominante (II°)", 4:"Dominante (V)", 6:"Sensible (VII)" };
        return map[degree] || "Cromatismo";
    }

    function detectInversion(notesMIDI, rootClass) {
        if (notesMIDI.length === 0) return "";
        const bass = notesMIDI[0] % 12;
        if (bass === rootClass)              return "";
        if (bass === (rootClass + 4)  % 12) return " (1ª inv.)";
        if (bass === (rootClass + 7)  % 12) return " (2ª inv.)";
        return "";
    }

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

    function fuseSegments(segments, key, stepsPerUnit) {
        if (!segments || segments.length === 0) return [];

        const buckets = new Map();
        for (const seg of segments) {
            const period = Math.floor(seg.startStep / stepsPerUnit);
            if (!buckets.has(period)) buckets.set(period, []);
            buckets.get(period).push(seg);
        }

        const fused = [];
        for (const [period, segs] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
            const startStep = period * stepsPerUnit;
            const endStep   = startStep + stepsPerUnit;

            const chordWeight = new Map();
            const allNotes    = new Set();

            for (const seg of segs) {
                const duration = seg.endStep - seg.startStep;
                const label    = seg.chordDisplay || '—';
                chordWeight.set(label, (chordWeight.get(label) || 0) + duration);
                seg.activeNotes.forEach(n => allNotes.add(n));
            }

            let dominantLabel = '—', maxWeight = 0;
            for (const [label, weight] of chordWeight.entries()) {
                if (label !== '—' && weight > maxWeight) {
                    maxWeight     = weight;
                    dominantLabel = label;
                }
            }

            const dominantSeg = segs.find(s => (s.chordDisplay || '—') === dominantLabel) || segs[0];

            fused.push({
                startStep,
                endStep,
                activeNotes:   [...allNotes].sort((a, b) => a - b),
                chord:         dominantSeg.chord,
                chordFunction: dominantSeg.chordFunction || '',
                chordDisplay:  dominantLabel,
                inversion:     dominantSeg.inversion || '',
                subSegments:   segs
            });
        }

        return fused;
    }

    function detectPhrases(fusedSegments, key) {
        if (!fusedSegments || fusedSegments.length < 2) return [];

        const STEPS_PER_MEASURE = 16;
        const measureMap = new Map();

        for (const seg of fusedSegments) {
            const m = Math.floor(seg.startStep / STEPS_PER_MEASURE);
            if (!measureMap.has(m)) measureMap.set(m, []);
            measureMap.get(m).push(seg);
        }

        const measures = [];
        for (const [m, segs] of [...measureMap.entries()].sort((a, b) => a[0] - b[0])) {
            const chordWeight = new Map();
            for (const s of segs) {
                const label = s.chordDisplay || '—';
                const dur   = s.endStep - s.startStep;
                chordWeight.set(label, (chordWeight.get(label) || 0) + dur);
            }
            let domLabel = '—', maxW = 0;
            for (const [label, w] of chordWeight) {
                if (label !== '—' && w > maxW) { maxW = w; domLabel = label; }
            }
            const domSeg = segs.find(s => (s.chordDisplay || '—') === domLabel) || segs[0];
            measures.push({
                measureIndex: m,
                startStep:    m * STEPS_PER_MEASURE,
                endStep:      (m + 1) * STEPS_PER_MEASURE,
                chord:        domSeg.chord,
                chordDisplay: domLabel,
                chordFunction: domSeg.chordFunction || '',
                activeNotes:  [...new Set(segs.flatMap(s => s.activeNotes))].sort((a, b) => a - b),
                beats:        segs
            });
        }

        if (measures.length < 2) return [];

        function _degree(measure) {
            if (!measure.chord || measure.chord.root === null) return null;
            return (measure.chord.root - key.rootClass + 12) % 12;
        }

        function _cadenceType(dA, dB) {
            if (dA === null || dB === null) return null;
            if (dA === 7 && dB === 0) return 'auténtica';
            if (dA === 7 && dB === 9) return 'rota';
            if (dA === 5 && dB === 0) return 'plagal';
            if (dA === 0 && dB === 7) return 'semicadencia';
            return null;
        }

        function _degreeToRoman(d, chord) {
            if (d === null) return '?';
            const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
            const base  = ROMAN[Math.round(d / (12 / 7))] || `(${d})`;
            const isMin = ['minor','minor7','diminished'].includes(chord?.quality);
            return isMin ? base.toLowerCase() : base;
        }

        const cadences = [];
        for (let i = 0; i < measures.length - 1; i++) {
            const type = _cadenceType(_degree(measures[i]), _degree(measures[i + 1]));
            if (type) cadences.push({ index: i + 1, type });
        }

        const phrases = [];
        let phraseStart = 0;
        const boundaries = [...cadences, { index: measures.length, type: 'final' }];

        for (const boundary of boundaries) {
            const mSegs = measures.slice(phraseStart, boundary.index);
            if (mSegs.length === 0) { phraseStart = boundary.index; continue; }

            const allNotes   = [...new Set(mSegs.flatMap(m => m.activeNotes))].sort((a, b) => a - b);
            const degrees    = mSegs.map(m => _degreeToRoman(_degree(m), m.chord));
            const chordNames = mSegs.map(m => m.chordDisplay || '—');
            const display    = degrees.join('–');

            const lastMeasure = mSegs[mSegs.length - 1];

            phrases.push({
                startStep:    mSegs[0].startStep,
                endStep:      lastMeasure.endStep,
                activeNotes:  allNotes,
                chords:       chordNames,
                degrees,
                cadenceType:  boundary.type,
                chordDisplay: display,
                chord:        lastMeasure.chord,
                chordFunction: boundary.type,
                subSegments:  mSegs.flatMap(m => m.beats)
            });

            phraseStart = boundary.index;
        }

        return phrases;
    }

    /**
     * Análisis armónico completo de un conjunto de eventos de canal.
     * @param {Array}  channelEvents      eventos noteOn/noteOff del canal
     * @param {number} ppqn               pulsos por negra
     * @param {number} totalTicks         duración total en ticks
     * @param {number} fusionStepsPerUnit pasos por bloque de fusión
     * @returns {{ key, segments, fusedSegments, phraseSegments } | null}
     */
    function analyzeChannelEvents(channelEvents, ppqn, totalTicks, fusionStepsPerUnit) {
        if (!channelEvents || channelEvents.length === 0) return null;
        const key            = detectKey(channelEvents, totalTicks);
        const segments       = getHarmonicSegments(channelEvents, ppqn, totalTicks);
        const analyzed       = analyzeChordsOnSegments(segments, key);
        const fusedSegments  = fuseSegments(analyzed, key, fusionStepsPerUnit);
        const phraseSegments = detectPhrases(fusedSegments, key);
        return { key, segments: analyzed, fusedSegments, phraseSegments };
    }

    // ---- API expuesta (global en main thread y en worker) ----
    root.HarmonicCore = {
        // primitivas de segmentación
        getAllChangeTicks, buildSegments, mergeSegments, roundSegmentsToSteps,
        getHarmonicSegments,
        // tonalidad / acordes
        detectKey, findChord, getChordFunction, detectInversion,
        analyzeChordsOnSegments, fuseSegments, detectPhrases,
        // punto de entrada completo
        analyzeChannelEvents,
    };
})(typeof self !== 'undefined' ? self : this);
