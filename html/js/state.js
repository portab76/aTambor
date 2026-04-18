// ============================================================
// state.js — Estado global de la aplicación
// Variables compartidas entre todos los módulos.
// Ningún otro módulo declara estado global; sólo lo lee/escribe.
// ============================================================

// --- Datos MIDI crudos ---
let rawEvents = [];       // Array de { tick, type, channel, note, velocity }
let tempoMap  = [];       // Array de { tick, bpm }
let ppqn      = 96;       // Pulses Per Quarter Note (leído del archivo)
let totalTicks = 0;       // Tick del último evento
let midiData   = null;    // Objeto resumen { ppqn, totalTicks, rawEvents, tempoMap }

// --- Selección de instrumento ---
let selectedChannel  = null;  // Canal MIDI actualmente seleccionado
let instrumentNames  = [];    // Nombre GM por canal [0..15]
let soundfontLoaded  = false;
let currentInstrument = "acoustic_grand_piano";

// --- Grid (piano roll) ---
let gridData    = { cells: {} }; // { "nota,step": { duration, velocity } }
let noteRows    = [];            // Notas MIDI presentes en el rango visible (ordenadas ascendente)
let totalSteps  = 0;
let ticksPerStep = 0;            // ticks / semicorchea = ppqn / 4
let stepWidth   = 40;            // píxeles por paso (zoom)
let rowHeight   = 25;            // píxeles por fila de nota

// --- Reproducción ---
let reproduciendo = false;
let pasoActual    = 0;

// --- Compás (leído del MIDI) ---
let currentTimeSig = {
    numerator:      4,   // numerador: cuántos tiempos por compás
    denominator:    4,   // denominador: valor de nota del tiempo (4=negra, 8=corchea…)
    stepsPerMeasure: 16, // semicorcheas por compás = numerator × (16 / denominator)
    stepsPerBeat:    4   // semicorcheas por tiempo  = 16 / denominator
};

// --- Highlight activo del popup (se mantiene durante la reproducción) ---
let activeHighlight = null;  // { classes, startStep, endStep } o null

// --- Transposición global de escala ---
let transposeOffset = 0;     // semitonos aplicados a todos los lookups de motor (−24 … +24)

// --- Loop A-B ---
let loopA  = -1;    // paso de inicio del rango A-B (−1 = no definido)
let loopB  = -1;    // paso de fin del rango A-B
let loopAB = false; // modo A-B activo

// --- Análisis armónico ---
let currentHarmonicSegments = [];  // micro-segmentos originales (uno por cambio de nota)
let currentFusedSegments    = [];  // segmentos fusionados por tiempo (vista musical)
let currentPhraseSegments   = [];  // frases detectadas por cadencias (vista de pianista)
let fusionStepsPerUnit      = 4;   // pasos por unidad de fusión: 4=negra, 8=blanca, 16=compás
let currentKey = "C";              // Tonalidad detectada como string, ej. "C", "Am"
