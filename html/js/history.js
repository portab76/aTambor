// ============================================================
// history.js — Undo / Redo para el piano roll
// Cada snapshot guarda cells, noteRows y totalSteps.
// Depende de: state.js, piano-roll.js
// ============================================================

import { state } from './state.js';
import { drawPianoRollWithPlayhead, drawNoteLabels } from './piano-roll.js';
import { drawTimelineRuler } from './timeline-ruler.js';
import { _refreshHeatMap } from './heat.js';
import { tabMarkDirty } from './tabs.js';
import { getMotorMapSnapshot, restoreMotorMap } from './motor-map.js';

let _undoStack = [];
let _redoStack = [];
const _HISTORY_MAX = 50;

function _historySnapshot() {
    return {
        cells:      JSON.parse(JSON.stringify(state.gridData.cells)),
        noteRows:   [...state.noteRows],
        totalSteps: state.totalSteps,
        motorMap:   getMotorMapSnapshot(),   // copia profunda de MOTOR_MAP
    };
}

/** Guardar estado actual antes de una mutación. Limpia el stack de redo. */
export function historyPush() {
    _undoStack.push(_historySnapshot());
    if (_undoStack.length > _HISTORY_MAX) _undoStack.shift();
    _redoStack = [];
}

function _historyApply(snap) {
    state.gridData.cells = JSON.parse(JSON.stringify(snap.cells));
    state.noteRows       = [...snap.noteRows];
    state.totalSteps     = snap.totalSteps;

    // Restaurar el Motor Map (asignación nota→servo, homePWM, mute, tecla)
    if (snap.motorMap) restoreMotorMap(snap.motorMap);

    drawPianoRollWithPlayhead(state.pasoActual !== undefined ? state.pasoActual : -1);
    drawNoteLabels();
    drawTimelineRuler();
    if (state.heatMapActive) _refreshHeatMap();
    tabMarkDirty();
}

/** Deshacer último cambio (Ctrl+Z). */
export function historyUndo() {
    if (!_undoStack.length) return;
    _redoStack.push(_historySnapshot());
    _historyApply(_undoStack.pop());
}

/** Rehacer cambio deshecho (Ctrl+Y / Ctrl+Shift+Z). */
export function historyRedo() {
    if (!_redoStack.length) return;
    _undoStack.push(_historySnapshot());
    if (_undoStack.length > _HISTORY_MAX) _undoStack.shift();
    _historyApply(_redoStack.pop());
}

/** Vaciar ambos stacks (al cargar archivo, nuevo proyecto, cambiar canal). */
export function historyClear() {
    _undoStack = [];
    _redoStack = [];
}

/** Devuelve copias de los stacks actuales (para serializar en tabs). */
export function getUndoRedoStacks() {
    return {
        undoStack: _undoStack.map(s => JSON.parse(JSON.stringify(s))),
        redoStack: _redoStack.map(s => JSON.parse(JSON.stringify(s))),
    };
}

/** Reemplaza los stacks (al restaurar un tab). */
export function setUndoRedoStacks(undoStack, redoStack) {
    _undoStack = (undoStack || []).map(s => JSON.parse(JSON.stringify(s)));
    _redoStack = (redoStack || []).map(s => JSON.parse(JSON.stringify(s)));
}
