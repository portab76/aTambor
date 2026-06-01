// ============================================================
// history.js — Undo / Redo para el piano roll
// Cada snapshot guarda cells, noteRows y totalSteps.
// Depende de: state.js, piano-roll.js
// ============================================================

let _undoStack = [];
let _redoStack = [];
const _HISTORY_MAX = 50;

function _historySnapshot() {
    return {
        cells:      JSON.parse(JSON.stringify(gridData.cells)),
        noteRows:   [...noteRows],
        totalSteps: totalSteps,
    };
}

/** Guardar estado actual antes de una mutación. Limpia el stack de redo. */
function historyPush() {
    _undoStack.push(_historySnapshot());
    if (_undoStack.length > _HISTORY_MAX) _undoStack.shift();
    _redoStack = [];
}

function _historyApply(snap) {
    gridData.cells = JSON.parse(JSON.stringify(snap.cells));
    noteRows       = [...snap.noteRows];
    totalSteps     = snap.totalSteps;

    drawPianoRollWithPlayhead(typeof pasoActual !== 'undefined' ? pasoActual : -1);
    if (typeof drawNoteLabels    === 'function') drawNoteLabels();
    if (typeof drawTimelineRuler === 'function') drawTimelineRuler();
    if (heatMapActive && typeof _refreshHeatMap === 'function') _refreshHeatMap();
    if (typeof tabMarkDirty      === 'function') tabMarkDirty();
}

/** Deshacer último cambio (Ctrl+Z). */
function historyUndo() {
    if (!_undoStack.length) return;
    _redoStack.push(_historySnapshot());
    _historyApply(_undoStack.pop());
}

/** Rehacer cambio deshecho (Ctrl+Y / Ctrl+Shift+Z). */
function historyRedo() {
    if (!_redoStack.length) return;
    _undoStack.push(_historySnapshot());
    if (_undoStack.length > _HISTORY_MAX) _undoStack.shift();
    _historyApply(_redoStack.pop());
}

/** Vaciar ambos stacks (al cargar archivo, nuevo proyecto, cambiar canal). */
function historyClear() {
    _undoStack = [];
    _redoStack = [];
}
