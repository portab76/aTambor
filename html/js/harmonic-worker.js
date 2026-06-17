// ============================================================
// harmonic-worker.js — Web Worker (clásico) para análisis armónico
//
// El análisis Krumhansl-Kessler + detección de acordes/frases es CPU-intensivo
// y bloquea el hilo principal con archivos MIDI grandes (>500 eventos). Este
// worker lo ejecuta fuera del hilo principal.
//
// Carga Tonal.js (UMD global) y la lógica pura compartida (harmonic-core.js)
// vía importScripts — por eso es un worker CLÁSICO, no de tipo módulo.
//
// Protocolo:
//   ← postMessage({ type:'analyze', id, channelEvents, ppqn, totalTicks, fusionStepsPerUnit })
//   → postMessage({ type:'result', id, analysis })           (analysis puede ser null)
//   → postMessage({ type:'error',  id, message })
// ============================================================

// Rutas relativas a la ubicación del worker (js/).
try {
    importScripts('../MIDI.js/tonal.min.js', './harmonic-core.js');
} catch (e) {
    // Si la carga falla, lo reportaremos al recibir el primer mensaje.
    self.__importError = String(e);
}

self.onmessage = function (e) {
    const msg = e.data || {};
    if (msg.type !== 'analyze') return;

    const { id } = msg;

    if (self.__importError || typeof self.HarmonicCore === 'undefined') {
        self.postMessage({
            type: 'error', id,
            message: 'No se pudo cargar la lógica de análisis: ' + (self.__importError || 'HarmonicCore ausente'),
        });
        return;
    }

    try {
        const analysis = self.HarmonicCore.analyzeChannelEvents(
            msg.channelEvents,
            msg.ppqn,
            msg.totalTicks,
            msg.fusionStepsPerUnit
        );
        self.postMessage({ type: 'result', id, analysis });
    } catch (err) {
        self.postMessage({ type: 'error', id, message: String(err && err.message || err) });
    }
};
