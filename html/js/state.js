// ============================================================
// state.js — Estado global de la aplicación
// Variables compartidas entre todos los módulos.
// Ningún otro módulo declara estado global; sólo lo lee/escribe.
// ============================================================

export const state = {

    // --- Datos MIDI crudos ---
    rawEvents:  [],     // Array de { tick, type, channel, note, velocity }
    tempoMap:   [],     // Array de { tick, bpm }
    ppqn:       96,     // Pulses Per Quarter Note (leído del archivo)
    totalTicks: 0,      // Tick del último evento
    midiData:   null,   // Objeto resumen { ppqn, totalTicks, rawEvents, tempoMap }

    // --- Selección de instrumento ---
    selectedChannel:   null,
    instrumentNames:   [],       // Nombre GM por canal [0..15]
    soundfontLoaded:   false,
    currentInstrument: "acoustic_grand_piano",

    // --- Grid (piano roll) ---
    gridData:     { cells: {} }, // { "nota,step": { duration, velocity } }
    noteRows:     [],            // Notas MIDI presentes en el rango visible (ordenadas ascendente)
    totalSteps:   0,
    ticksPerStep: 0,             // ticks / semicorchea = ppqn / 4
    stepWidth:    8,             // píxeles por paso (zoom)
    rowHeight:    25,            // píxeles por fila de nota

    // --- Reproducción ---
    reproduciendo: false,
    pasoActual:    0,

    // --- Compás (leído del MIDI) ---
    currentTimeSig: {
        numerator:      4,   // numerador: cuántos tiempos por compás
        denominator:    4,   // denominador: valor de nota del tiempo (4=negra, 8=corchea…)
        stepsPerMeasure: 16, // semicorcheas por compás = numerator × (16 / denominator)
        stepsPerBeat:    4   // semicorcheas por tiempo  = 16 / denominator
    },

    // --- Highlight activo del popup (se mantiene durante la reproducción) ---
    activeHighlight: null,   // { classes, startStep, endStep } o null

    // --- Transposición global de escala ---
    transposeOffset: 0,      // semitonos aplicados a todos los lookups de motor (−24 … +24)

    // --- Loop A-B ---
    loopA:  -1,     // paso de inicio del rango A-B (−1 = no definido)
    loopB:  -1,     // paso de fin del rango A-B
    loopAB: false,  // modo A-B activo

    // --- Análisis armónico ---
    currentHarmonicSegments: [],  // micro-segmentos originales (uno por cambio de nota)
    currentFusedSegments:    [],  // segmentos fusionados por tiempo (vista musical)
    currentPhraseSegments:   [],  // frases detectadas por cadencias (vista de pianista)
    fusionStepsPerUnit:      4,   // pasos por unidad de fusión: 4=negra, 8=blanca, 16=compás
    currentKey:              "C", // Tonalidad detectada como string, ej. "C", "Am"
    currentMidiFileName:     '',  // Nombre del archivo MIDI cargado

    // --- Mapa de tempo editable ---
    tempoPoints: [{ step: 0, bpm: 120 }],  // Array<{step, bpm}> ordenado por step

    // --- Clipboard de fragmento A-B ---
    _clipboardFragment: null,  // { length, cells: [{relStep, note, duration, velocity}] }

    // --- LED strip WS2812B — modo de color y Synthesia ---
    ledColorMode: 'octava',  // 'rainbow' | 'octava' | 'calor' | 'blanco'
    ledAdvanceMs: 0,         // ms de anticipación LED Synthesia (0 = desactivado)

    // --- Heat map (notas de calor, Motor de Atención) ---
    heatMapActive: false,  // true = modo calor activo desde toolbar
    heatMapData:   null,   // Map "note,step" → heatScore [0,1] | null = sin calcular
    heatMapDataPreCompresion: null,  // heatmap del grid ORIGINAL (antes de comprimir a motores)

    // --- Segmentos de respiración (puntos de reset I2C) ---
    breathingSegments: [],  // [{startStep, endStep, energy, activeNotes}] | [] = sin calcular

    // --- Marcadores de sección ---
    sectionMarkers: [],  // Array<{step, label, color}>

    // --- Auto-advance (APPEND predictivo compás a compás) ---
    autoAdvanceActive: false,  // true = encadenado automático de segmentos via APPEND
    _batchStartSegIdx: -1,     // índice del primer segmento del lote activo

    // --- Conexión hardware ---
    wsConnected:       false,
    _serialActive:     false,
    _serialWriter:     null,
    onBeatCallback:    null,
    onStoppedCallback: null,

    // --- UI: panel unificado Motor Map + Escala ---
    motorEscalaPanelOpen: false,

    // --- Debounce del análisis armónico tras ediciones ---
    _harmonicDebounceTimer: null,  // handle de setTimeout cancelable (editor.js)
};
