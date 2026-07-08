// ============================================================
// tabs.js — Sistema de pestañas multi-documento
// Cada tab guarda una copia completa del estado del grid.
// El portapapeles (_clipboardFragment) es COMPARTIDO entre tabs.
// ============================================================

import { state } from './state.js';
import { getUndoRedoStacks, setUndoRedoStacks } from './history.js';
import { historyPush } from './history.js';
import { getSelectionState, setSelectionState, scheduleHarmonicAnalysis } from './editor.js';
import { play, stop } from './playback.js';
import { applyZoom, drawPianoRollWithPlayhead, toggleNewGridPanel, closeNewGridPanel, _enableMeasureButtons } from './piano-roll.js';
import { drawTimelineRuler, _updateAbBtn } from './timeline-ruler.js';
import { drawChordRow } from './chord-row.js';
import { _tpSlider } from './transpose.js';
import { playBtn, stopBtn, instrumentSelect, loadInstrumentBtn } from './dom-refs.js';

// ── Estado por defecto de un tab vacío ───────────────────────
function _tabDefaults() {
    return {
        name:    'Sin título',
        isDirty: false,

        gridData:     { cells: {} },
        noteRows:     [],
        totalSteps:   0,
        ticksPerStep: 0,
        stepWidth:    8,
        rowHeight:    25,

        rawEvents:  [],
        tempoMap:   [{ tick: 0, bpm: 120 }],
        ppqn:       96,
        totalTicks: 0,
        midiData:   null,

        selectedChannel:     null,
        instrumentNames:     [],
        currentMidiFileName: '',

        currentTimeSig: { numerator: 4, denominator: 4, stepsPerMeasure: 16, stepsPerBeat: 4 },

        loopA: -1, loopB: -1, loopAB: false,
        pasoActual: 0,

        currentHarmonicSegments: [],
        currentFusedSegments:    [],
        currentPhraseSegments:   [],
        breathingSegments:       [],
        currentKey:         'C',
        fusionStepsPerUnit: 4,

        transposeOffset: 0,

        scrollLeft: 0,
        scrollTop:  0,
        bpm:        120,
        viewLevel:  'pasos',

        undoStack: [],
        redoStack: [],

        selCells:  [],
        selActive: false,

        tempoPoints:    [{ step: 0, bpm: 120 }],
        sectionMarkers: [],
    };
}

let _tabs          = [_tabDefaults()];
let _activeTabIdx  = 0;

// ── Captura del estado global en el slot activo ───────────────
function _tabSaveCurrent() {
    const t = _tabs[_activeTabIdx];
    if (!t) return;

    t.gridData    = JSON.parse(JSON.stringify(state.gridData));
    t.noteRows    = [...state.noteRows];
    t.totalSteps  = state.totalSteps;
    t.ticksPerStep = state.ticksPerStep;
    t.stepWidth   = state.stepWidth;
    t.rowHeight   = state.rowHeight;

    t.rawEvents  = state.rawEvents.map(e => ({ ...e }));
    t.tempoMap   = state.tempoMap.map(e => ({ ...e }));
    t.ppqn       = state.ppqn;
    t.totalTicks = state.totalTicks;
    t.midiData   = state.midiData ? JSON.parse(JSON.stringify(state.midiData)) : null;

    t.selectedChannel     = state.selectedChannel;
    t.instrumentNames     = [...state.instrumentNames];
    t.currentMidiFileName = state.currentMidiFileName;

    t.currentTimeSig = { ...state.currentTimeSig };

    t.loopA  = state.loopA;
    t.loopB  = state.loopB;
    t.loopAB = state.loopAB;
    t.pasoActual = state.pasoActual;

    t.currentHarmonicSegments = JSON.parse(JSON.stringify(state.currentHarmonicSegments));
    t.currentFusedSegments    = JSON.parse(JSON.stringify(state.currentFusedSegments));
    t.currentPhraseSegments   = JSON.parse(JSON.stringify(state.currentPhraseSegments));
    t.breathingSegments       = JSON.parse(JSON.stringify(state.breathingSegments));
    t.currentKey          = state.currentKey;
    t.fusionStepsPerUnit  = state.fusionStepsPerUnit;

    const gs = document.getElementById('gridScroll');
    if (gs) { t.scrollLeft = gs.scrollLeft; t.scrollTop = gs.scrollTop; }

    const { undoStack, redoStack } = getUndoRedoStacks();
    t.undoStack = undoStack;
    t.redoStack = redoStack;
    const { selCells, selActive } = getSelectionState();
    t.selCells  = selCells;
    t.selActive = selActive;
    t.tempoPoints    = state.tempoPoints.map(tp => ({ ...tp }));
    t.sectionMarkers = state.sectionMarkers.map(sm => ({ ...sm }));

    const bpmEl = document.getElementById('bpmInput');
    if (bpmEl) t.bpm = parseFloat(bpmEl.value) || 120;

    const sel = document.getElementById('viewLevelSelect');
    if (sel) t.viewLevel = sel.value;
}

// ── Restauración del estado desde un slot ────────────────────
function _tabRestoreFrom(t) {
    // Parar reproducción
    if (state.reproduciendo) stop();

    state.gridData     = JSON.parse(JSON.stringify(t.gridData));
    state.noteRows     = [...t.noteRows];
    state.totalSteps   = t.totalSteps;
    state.ticksPerStep = t.ticksPerStep;
    state.stepWidth    = t.stepWidth;
    state.rowHeight    = t.rowHeight;

    state.rawEvents  = t.rawEvents.map(e => ({ ...e }));
    state.tempoMap   = t.tempoMap.map(e => ({ ...e }));
    state.ppqn       = t.ppqn;
    state.totalTicks = t.totalTicks;
    state.midiData   = t.midiData ? JSON.parse(JSON.stringify(t.midiData)) : null;

    state.selectedChannel     = t.selectedChannel;
    state.instrumentNames     = [...t.instrumentNames];
    state.currentMidiFileName = t.currentMidiFileName;

    state.currentTimeSig = { ...t.currentTimeSig };

    state.loopA  = t.loopA;
    state.loopB  = t.loopB;
    state.loopAB = t.loopAB;
    state.pasoActual    = 0;
    state.reproduciendo = false;

    state.currentHarmonicSegments = JSON.parse(JSON.stringify(t.currentHarmonicSegments));
    state.currentFusedSegments    = JSON.parse(JSON.stringify(t.currentFusedSegments));
    state.currentPhraseSegments   = JSON.parse(JSON.stringify(t.currentPhraseSegments));
    state.breathingSegments       = JSON.parse(JSON.stringify(t.breathingSegments));
    state.currentKey         = t.currentKey;
    state.fusionStepsPerUnit = t.fusionStepsPerUnit;

    const hasGrid = Object.keys(state.gridData.cells).length > 0;

    // ── BPM ──
    const bpmEl = document.getElementById('bpmInput');
    if (bpmEl) bpmEl.value = t.bpm;

    // ── Selector de vista armónica ──
    const viewSel = document.getElementById('viewLevelSelect');
    if (viewSel) {
        const level = (t.currentHarmonicSegments.length > 0) ? t.viewLevel : 'pasos';
        viewSel.value    = level;
        viewSel.disabled = !hasGrid;
        const respOpt   = viewSel.querySelector('option[value="respiración"]');
        if (respOpt)   respOpt.disabled   = (t.breathingSegments.length === 0);
        const frasesOpt = viewSel.querySelector('option[value="frases"]');
        if (frasesOpt) frasesOpt.disabled = (t.currentPhraseSegments.length === 0);
    }

    // ── Transport ──
    playBtn.disabled = !hasGrid;
    stopBtn.disabled = false;

    // ── Botones de toolbar ──
    const abBtn         = document.getElementById('abLoopBtn');
    const chordPanelBtn = document.getElementById('chordPanelBtn');
    const activeNotesBtn= document.getElementById('activeNotesBtn');
    if (abBtn)          abBtn.disabled          = !hasGrid;
    if (chordPanelBtn)  chordPanelBtn.disabled  = !hasGrid;
    if (activeNotesBtn) activeNotesBtn.disabled = !hasGrid;

    // ── Botones de compases ──
    if (hasGrid) _enableMeasureButtons();

    // ── Instrumento select ──
    instrumentSelect.innerHTML = '<option value="">-- Canal --</option>';
    t.instrumentNames.forEach((name, i) => {
        if (!name) return;
        const opt = document.createElement('option');
        opt.value       = i;
        opt.textContent = `${i + 1}: ${name}`;
        if (i === t.selectedChannel) opt.selected = true;
        instrumentSelect.appendChild(opt);
    });
    // ── Piano roll ──
    if (hasGrid) {
        applyZoom(t.stepWidth, t.rowHeight);
    } else {
        drawPianoRollWithPlayhead(-1);
        drawTimelineRuler();
    }

    // ── Chord row ──
    const chordRow = document.getElementById('chordRowContainer');
    if (chordRow) {
        if (t.currentHarmonicSegments.length) {
            const keyObj = _tabParseKey(t.currentKey);
            const segs   = _tabActiveSegs(t);
            drawChordRow(segs, keyObj);
        } else {
            chordRow.innerHTML = '';
        }
    }

    // ── Transposición: global, no por tab — refrescar UI con el valor actual ──
    _tpSlider(state.transposeOffset);

    // ── A-B ──
    _updateAbBtn();

    // ── Heat map ── (se recalcula bajo demanda desde la interpretación)
    state.heatMapData = null;

    // ── Historial Undo/Redo ──
    setUndoRedoStacks(t.undoStack, t.redoStack);
    setSelectionState(t.selCells, t.selActive);
    state.tempoPoints    = (t.tempoPoints    || [{ step: 0, bpm: 120 }]).map(tp => ({ ...tp }));
    state.sectionMarkers = (t.sectionMarkers || []).map(sm => ({ ...sm }));

    // ── Scroll ──
    const gs = document.getElementById('gridScroll');
    if (gs) { gs.scrollLeft = t.scrollLeft; gs.scrollTop = t.scrollTop; }
}

// ── Helpers internos ─────────────────────────────────────────
function _tabParseKey(keyStr) {
    if (!keyStr) return null;
    const isMinor = keyStr.endsWith('m');
    return { tonic: keyStr.replace('m', ''), mode: isMinor ? 'minor' : 'major', rootClass: 0 };
}

function _tabActiveSegs(t) {
    const level = t.viewLevel;
    if (level === 'respiración' && t.breathingSegments.length)    return t.breathingSegments;
    if (level === 'frases'      && t.currentPhraseSegments.length) return t.currentPhraseSegments;
    if (level === 'acordes'     && t.currentFusedSegments.length)  return t.currentFusedSegments;
    return t.currentHarmonicSegments;
}

// ── API pública ──────────────────────────────────────────────

/** Cambia al tab idx guardando el estado actual. */
export function tabSwitch(idx) {
    if (idx === _activeTabIdx || idx < 0 || idx >= _tabs.length) return;
    // El panel "nuevo grid" pertenece al tab que se abandona: cerrarlo para que
    // su clic de compases no caiga sobre el tab al que cambiamos.
    closeNewGridPanel();
    const wasPlaying = state.reproduciendo;
    _tabSaveCurrent();
    _activeTabIdx = idx;
    _tabRestoreFrom(_tabs[_activeTabIdx]);
    _tabRender();
    // Si había reproducción activa y el nuevo tab tiene notas, arrancar automáticamente
    if (wasPlaying && Object.keys(state.gridData.cells).length > 0) {
        play();
    }
}

/** Crea un tab vacío y cambia a él. */
export function tabNew() {
    _tabSaveCurrent();
    _tabs.push(_tabDefaults());
    _activeTabIdx = _tabs.length - 1;
    _tabRestoreFrom(_tabs[_activeTabIdx]);
    _tabRender();
}

/**
 * Punto de entrada unificado para el botón [+] y "📄 Nuevo" del menú.
 * Si el tab activo tiene contenido crea uno nuevo primero; luego abre
 * el panel de configuración de compases/BPM.
 */
export function tabNewWithDialog() {
    const hasContent = Object.keys(state.gridData.cells).length > 0 || state.noteRows.length > 0;
    if (hasContent) {
        _tabSaveCurrent();
        _tabs.push(_tabDefaults());
        _activeTabIdx = _tabs.length - 1;
        _tabRestoreFrom(_tabs[_activeTabIdx]);
        _tabRender();
    }
    toggleNewGridPanel();
}

/** Cierra el tab idx. Siempre queda al menos 1. */
export function tabClose(idx) {
    if (_tabs.length === 1) return;
    const t = _tabs[idx];
    const hasContent = Object.keys(t.gridData.cells).length > 0;
    if (t.isDirty && hasContent) {
        if (!confirm(`¿Cerrar "${t.name}" sin guardar?`)) return;
    }
    // Cerrar el panel "nuevo grid" si estaba abierto: tras cerrar el tab caería
    // sobre otro tab y un clic en un número de compases lo sobrescribiría.
    closeNewGridPanel();
    _tabs.splice(idx, 1);
    if (_activeTabIdx > idx)  _activeTabIdx--;
    if (_activeTabIdx >= _tabs.length) _activeTabIdx = _tabs.length - 1;
    _tabRestoreFrom(_tabs[_activeTabIdx]);
    _tabRender();
}

/** Actualiza el nombre del tab activo y quita el flag dirty. */
export function tabMarkFileLoaded(name) {
    const t = _tabs[_activeTabIdx];
    t.name    = name || 'Sin título';
    t.isDirty = false;
    _tabRender();
}

/** Marca el tab activo como modificado (muestra ●). */
export function tabMarkDirty() {
    if (!_tabs[_activeTabIdx].isDirty) {
        _tabs[_activeTabIdx].isDirty = true;
        _tabRender();
    }
}

// ── Render del tab bar ───────────────────────────────────────
function _tabRender() {
    const list = document.getElementById('tabList');
    if (!list) return;
    list.innerHTML = '';

    _tabs.forEach((t, idx) => {
        const el = document.createElement('div');
        el.className = 'tab-item' + (idx === _activeTabIdx ? ' tab-active' : '');

        const label = document.createElement('span');
        label.className   = 'tab-label';
        label.textContent = (t.isDirty ? '● ' : '') + t.name;
        label.title       = t.name;
        label.onclick     = () => tabSwitch(idx);

        const closeBtn = document.createElement('span');
        closeBtn.className   = 'tab-close';
        closeBtn.textContent = '✕';
        closeBtn.title       = 'Cerrar tab';
        closeBtn.onclick     = (e) => { e.stopPropagation(); tabClose(idx); };

        el.appendChild(label);
        el.appendChild(closeBtn);
        list.appendChild(el);
    });

}

// ── Helpers para el módulo raíz (midiGrid.js) ────────────────
// Evitan que el entry point manipule _tabs / _activeTabIdx directamente.

/** Guarda el estado actual en el slot activo. */
export function tabSaveCurrent() { _tabSaveCurrent(); }

/** Redibuja la barra de tabs. */
export function tabRender() { _tabRender(); }

/**
 * Crea un nuevo tab pre-cargado, lo activa y restaura su estado.
 * Devuelve el índice del nuevo tab.
 * @param {Object} preload  campos a fusionar sobre _tabDefaults()
 */
export function tabPushPreloaded(preload = {}) {
    _tabSaveCurrent();
    const t = Object.assign(_tabDefaults(), preload);
    _tabs.push(t);
    _activeTabIdx = _tabs.length - 1;
    _tabRestoreFrom(t);
    _tabRender();
    return _activeTabIdx;
}

/** Índice del primer slot que ocuparía el siguiente tab nuevo. */
export function tabNextIndex() { return _tabs.length; }

/** Aplica cambios al tab activo (nombre, dirty) y opcionalmente lo guarda. */
export function tabUpdateActive({ name, isDirty } = {}, save = false) {
    const t = _tabs[_activeTabIdx];
    if (!t) return;
    if (name !== undefined)    t.name    = name;
    if (isDirty !== undefined) t.isDirty = isDirty;
    if (save) _tabSaveCurrent();
}

/** True si existe un tab inmediatamente a la izquierda del activo. */
export function hasTabToLeft() {
    return _activeTabIdx > 0;
}

/**
 * Fusiona en el grid ACTIVO todas las notas del tab inmediatamente a la
 * izquierda, conservando su step de origen (mismo instante temporal → las dos
 * piezas quedan sincronizadas desde el inicio). En colisión note,step conserva
 * la mayor velocity y duración, igual que la importación. Las notas añadidas
 * quedan seleccionadas (como tras Shift+arrastre). Reversible con Ctrl+Z.
 *
 * @returns {{ added: number, merged: number }} notas nuevas y notas fusionadas
 */
export function mergeFromLeftTab() {
    if (_activeTabIdx <= 0) return { added: 0, merged: 0 };
    const src = _tabs[_activeTabIdx - 1];
    if (!src || !src.gridData || !src.gridData.cells) return { added: 0, merged: 0 };

    const srcCells = Object.entries(src.gridData.cells);
    if (srcCells.length === 0) return { added: 0, merged: 0 };

    historyPush();   // snapshot ANTES de fusionar → Ctrl+Z restaura

    const newSel = new Set();
    let added = 0, merged = 0;
    let maxStep = state.totalSteps;

    for (const [key, cell] of srcCells) {
        const stepStr = key.slice(key.indexOf(',') + 1);
        const step     = parseInt(stepStr, 10);
        const duration = cell.duration || 1;
        const velocity = cell.velocity || 0;

        const prev = state.gridData.cells[key];
        if (prev) {
            // Colisión: conservar la mayor presencia (misma regla que el import).
            prev.duration = Math.max(prev.duration, duration);
            prev.velocity = Math.max(prev.velocity, velocity);
            merged++;
        } else {
            state.gridData.cells[key] = { duration, velocity };
            added++;
        }
        newSel.add(key);
        if (step + duration > maxStep) maxStep = step + duration;
    }

    // Si el tab izquierdo era más largo, ampliar el grid para que quepan sus notas.
    if (maxStep > state.totalSteps) state.totalSteps = maxStep;

    // Filas: asegurar que las notas pegadas tengan su fila en noteRows, si no el
    // render las omite. Recalcular el rango si alguna nota cae fuera.
    _ensureRowsForCells(newSel);

    // Dejar las notas añadidas seleccionadas (mismo estado que Shift+arrastre).
    setSelectionState([...newSel], newSel.size > 0);

    drawPianoRollWithPlayhead(state.reproduciendo ? state.pasoActual : -1);
    drawTimelineRuler();
    scheduleHarmonicAnalysis();
    tabMarkDirty();

    return { added, merged };
}

/**
 * Asegura que state.noteRows cubra las notas de las claves dadas; si alguna cae
 * fuera del rango actual, reconstruye noteRows como rango contiguo [min,max].
 */
function _ensureRowsForCells(keys) {
    if (state.noteRows.length === 0) return;
    let lo = state.noteRows[0];
    let hi = state.noteRows[state.noteRows.length - 1];
    let changed = false;
    for (const key of keys) {
        const note = parseInt(key.slice(0, key.indexOf(',')), 10);
        if (note < lo) { lo = note; changed = true; }
        if (note > hi) { hi = note; changed = true; }
    }
    if (changed) {
        state.noteRows = [];
        for (let n = lo; n <= hi; n++) state.noteRows.push(n);
    }
}

document.addEventListener('DOMContentLoaded', () => { _tabRender(); });
