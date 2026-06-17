// ============================================================
// harmonic.js — Análisis armónico (capa ligada al estado)
//
// La LÓGICA PURA del algoritmo vive en harmonic-core.js (window.HarmonicCore),
// cargado como <script> clásico tras tonal.min.js. Aquí solo se enlazan esas
// funciones con `state` (rawEvents, ppqn, totalTicks, fusionStepsPerUnit,
// gridData…) y se ofrece el análisis ASÍNCRONO vía Web Worker.
//
// Depende de: state.js, window.HarmonicCore (harmonic-core.js)
// ============================================================

import { state } from './state.js';

// Acceso perezoso al core global (se resuelve en tiempo de llamada, no de
// import, para no depender del orden de carga de los <script>).
function _core() {
    if (typeof window === 'undefined' || !window.HarmonicCore) {
        throw new Error('HarmonicCore no está cargado (incluye js/harmonic-core.js antes del módulo).');
    }
    return window.HarmonicCore;
}

// ── Helpers para extraer los eventos de un canal del estado ───
function _channelEvents(channel) {
    return state.rawEvents.filter(
        e => e.channel === channel && (e.type === 'noteOn' || e.type === 'noteOff')
    );
}

// ── API pública (misma firma que antes; delega en el core) ────

export function getHarmonicSegments(channel) {
    const events = _channelEvents(channel);
    if (events.length === 0) return [];
    return _core().getHarmonicSegments(events, state.ppqn, state.totalTicks);
}

export function detectKey(channelEvents) {
    return _core().detectKey(channelEvents, state.totalTicks);
}

export function findChord(noteClasses, bassNote = null) {
    return _core().findChord(noteClasses, bassNote);
}

export function getChordFunction(chord, key) {
    return _core().getChordFunction(chord, key);
}

export function detectInversion(notesMIDI, rootClass) {
    return _core().detectInversion(notesMIDI, rootClass);
}

export function analyzeChordsOnSegments(segments, key) {
    return _core().analyzeChordsOnSegments(segments, key);
}

export function fuseSegments(segments, key, stepsPerUnit) {
    return _core().fuseSegments(segments, key, stepsPerUnit);
}

export function detectPhrases(fusedSegments, key) {
    return _core().detectPhrases(fusedSegments, key);
}

/**
 * Análisis armónico completo de un canal (SÍNCRONO).
 * @returns {{ key, segments, fusedSegments, phraseSegments } | null}
 */
export function performHarmonicAnalysis(channel) {
    const events = _channelEvents(channel);
    if (events.length === 0) return null;
    return _core().analyzeChannelEvents(events, state.ppqn, state.totalTicks, state.fusionStepsPerUnit);
}

/**
 * Construye eventos sintéticos noteOn/noteOff desde gridData.cells.
 * Compartido por performHarmonicAnalysisFromGrid (sync) y la variante async.
 * @returns {{ events, ppqn, totalTicks, fusionStepsPerUnit } | null}
 */
function _buildEventsFromGrid() {
    if (!state.gridData || Object.keys(state.gridData.cells).length === 0) return null;

    const tps = state.ticksPerStep || (state.ppqn / 4) || 24;
    const events = [];
    for (const [key, cell] of Object.entries(state.gridData.cells)) {
        const [noteStr, stepStr] = key.split(',');
        const note     = parseInt(noteStr);
        const step     = parseInt(stepStr);
        const duration = cell.duration || 1;
        const velocity = cell.velocity || 80;
        const tickOn   = step * tps;
        const tickOff  = (step + duration) * tps;
        events.push({ tick: tickOn,  type: 'noteOn',  channel: 0, note, velocity });
        events.push({ tick: tickOff, type: 'noteOff', channel: 0, note, velocity: 0 });
    }
    if (events.length === 0) return null;
    events.sort((a, b) => a.tick - b.tick || (a.type === 'noteOff' ? -1 : 1));

    return {
        events,
        ppqn:               state.ppqn,
        totalTicks:         state.totalSteps * tps,
        fusionStepsPerUnit: state.fusionStepsPerUnit,
    };
}

/**
 * Análisis armónico desde gridData.cells (SÍNCRONO). Usado al cargar JSON.
 * @returns {{ key, segments, fusedSegments, phraseSegments } | null}
 */
export function performHarmonicAnalysisFromGrid() {
    const built = _buildEventsFromGrid();
    if (!built) return null;
    return _core().analyzeChannelEvents(built.events, built.ppqn, built.totalTicks, built.fusionStepsPerUnit);
}

// ============================================================
// Análisis ASÍNCRONO vía Web Worker (no bloquea el hilo principal)
// ============================================================

let _worker        = null;
let _workerOK      = true;   // false si el worker no se pudo crear (fallback sync)
let _msgId         = 0;
const _pending     = new Map();  // id → { resolve, reject }

/** Crea (una sola vez) el worker de análisis armónico. */
function _getWorker() {
    if (_worker || !_workerOK) return _worker;
    try {
        // URL relativa a ESTE módulo (no al documento) → robusta sea cual sea
        // la ruta de la página. Worker clásico (usa importScripts).
        const workerUrl = new URL('./harmonic-worker.js', import.meta.url);
        _worker = new Worker(workerUrl);
        _worker.onmessage = (e) => {
            const { type, id, analysis, message } = e.data || {};
            const p = _pending.get(id);
            if (!p) return;
            _pending.delete(id);
            if (type === 'result')      p.resolve(analysis);
            else if (type === 'error')  p.reject(new Error(message));
        };
        _worker.onerror = (err) => {
            // Fallo global del worker: rechazar todo lo pendiente y desactivarlo.
            console.error('[harmonic-worker] error:', err.message || err);
            for (const p of _pending.values()) p.reject(new Error('worker error'));
            _pending.clear();
            _workerOK = false;
            _worker   = null;
        };
    } catch (e) {
        console.warn('[harmonic] No se pudo crear el Web Worker, se usará análisis síncrono:', e);
        _workerOK = false;
        _worker   = null;
    }
    return _worker;
}

/**
 * Envía un conjunto de eventos al worker y devuelve una Promise con el análisis.
 * Si el worker no está disponible, cae a análisis síncrono en el hilo principal.
 */
function _analyzeViaWorker(channelEvents, ppqn, totalTicks, fusionStepsPerUnit) {
    if (!channelEvents || channelEvents.length === 0) return Promise.resolve(null);

    const worker = _getWorker();
    if (!worker) {
        // Fallback síncrono
        return Promise.resolve(
            _core().analyzeChannelEvents(channelEvents, ppqn, totalTicks, fusionStepsPerUnit)
        );
    }

    const id = ++_msgId;
    return new Promise((resolve, reject) => {
        _pending.set(id, { resolve, reject });
        worker.postMessage({ type: 'analyze', id, channelEvents, ppqn, totalTicks, fusionStepsPerUnit });
    });
}

/**
 * Versión ASÍNCRONA de performHarmonicAnalysis: ejecuta el análisis en el
 * Web Worker para no congelar la UI con archivos MIDI grandes.
 * @returns {Promise<{ key, segments, fusedSegments, phraseSegments } | null>}
 */
export function performHarmonicAnalysisAsync(channel) {
    const events = _channelEvents(channel);
    if (events.length === 0) return Promise.resolve(null);
    return _analyzeViaWorker(events, state.ppqn, state.totalTicks, state.fusionStepsPerUnit);
}
