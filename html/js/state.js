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

// --- Análisis armónico ---
let currentHarmonicSegments = [];
let currentKey = "C";            // Tonalidad detectada como string, ej. "C", "Am"
