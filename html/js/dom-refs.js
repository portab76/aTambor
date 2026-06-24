// ============================================================
// dom-refs.js — Referencias DOM compartidas entre módulos
// Se resuelven una sola vez al cargar el módulo (los <canvas>,
// botones e inputs existen en el HTML desde el inicio).
//
// Sustituye a los antiguos `const canvas = ...` globales de midiGrid.js.
// ============================================================

export const fileInput         = document.getElementById('midiFileInput');
export const instrumentSelect  = document.getElementById('instrumentSelect');
export const loadInstrumentBtn = document.getElementById('loadInstrumentBtn');
export const debugDiv          = document.getElementById('debugInfo');
export const playBtn           = document.getElementById('playBtn');
export const stopBtn           = document.getElementById('stopBtn');
export const canvas            = document.getElementById('pianoRollCanvas');
export const ctx               = canvas.getContext('2d');
export const gridScroll        = document.getElementById('gridScroll');
export const notesPanelScroll  = document.getElementById('notesPanelScroll');
