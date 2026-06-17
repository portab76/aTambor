// ============================================================
// persistence.js — Exportación, guardado y carga de proyectos
// Depende de: state.js, piano-roll.js, chord-row.js
// ============================================================

import { state } from './state.js';
import { performHarmonicAnalysisFromGrid } from './harmonic.js';
import { calcularBreathingPoints } from './heat.js';
import { applyZoom } from './piano-roll.js';
import { drawChordRow } from './chord-row.js';
import { historyClear } from './history.js';
import { _updateFragmentButtons } from './editor.js';
import { _updateAbBtn } from './timeline-ruler.js';
import { recentFilesAdd } from './recent-files.js';
import { tabNew, tabMarkFileLoaded } from './tabs.js';

// ── Callbacks de UI ───────────────────────────────────────────────────────────
// persistence.js no toca botones ni selectores: tras aplicar los datos invoca
// onApplied, y el entry point (midiGrid.js) habilita la interfaz.
export const projectCallbacks = {
    onApplied:      null,   // () => void           — datos aplicados, habilitar UI
    onStatusChange: null,   // (msg: string) => void — mensaje de estado para el usuario
};

function _emitApplied()    { projectCallbacks.onApplied?.(); }
function _emitStatus(msg)  { projectCallbacks.onStatusChange?.(msg); }

/**
 * Guarda el estado completo del proyecto en un archivo JSON.
 */
export function saveProject() {
    const project = {
        gridData:      state.gridData,
        noteRows:      state.noteRows,
        totalSteps:    state.totalSteps,
        ticksPerStep:  state.ppqn / 4,
        selectedChannel: state.selectedChannel,
        currentKey:    state.currentKey,
        harmonicSegments: state.currentHarmonicSegments,
        fusedSegments:    state.currentFusedSegments,
        phraseSegments:   state.currentPhraseSegments,
        tempoMap:      state.tempoMap,
        tempoPoints:   state.tempoPoints.map(tp => ({ ...tp })),
        sectionMarkers: (state.sectionMarkers || []).map(sm => ({ ...sm })),
        ppqn:          state.ppqn,
        stepWidth:     state.stepWidth,
        rowHeight:     state.rowHeight
    };
    const name = state.currentMidiFileName
        ? state.currentMidiFileName.replace(/\.midi?$/i, '')
        : 'midi_grid_project';
    recentFilesAdd(name, project);
    _downloadJSON(project, `${name}.json`);
    _emitStatus("Proyecto guardado.");
}

/**
 * Valida la integridad de un objeto de proyecto antes de aplicarlo.
 * Comprueba solo los campos OBLIGATORIOS; los opcionales (sectionMarkers,
 * tempoPoints, stepWidth…) se rellenan con valores por defecto en
 * _applyProjectData, así que su ausencia no invalida el proyecto.
 *
 * @param {*} p — objeto parseado del JSON
 * @returns {{ valid: boolean, error: string|null }}
 */
export function validateProjectData(p) {
    if (p === null || typeof p !== 'object' || Array.isArray(p)) {
        return { valid: false, error: 'El archivo no contiene un objeto de proyecto válido.' };
    }

    // gridData con campo cells (objeto)
    if (!p.gridData || typeof p.gridData !== 'object' || Array.isArray(p.gridData)) {
        return { valid: false, error: 'Falta "gridData" o no es un objeto.' };
    }
    if (!p.gridData.cells || typeof p.gridData.cells !== 'object' || Array.isArray(p.gridData.cells)) {
        return { valid: false, error: 'Falta "gridData.cells" o no es un objeto.' };
    }

    // noteRows (array)
    if (!Array.isArray(p.noteRows)) {
        return { valid: false, error: 'Falta "noteRows" o no es un array.' };
    }

    // totalSteps (número > 0)
    if (typeof p.totalSteps !== 'number' || !Number.isFinite(p.totalSteps) || p.totalSteps <= 0) {
        return { valid: false, error: '"totalSteps" debe ser un número mayor que 0.' };
    }

    // ppqn (número > 0)
    if (typeof p.ppqn !== 'number' || !Number.isFinite(p.ppqn) || p.ppqn <= 0) {
        return { valid: false, error: '"ppqn" debe ser un número mayor que 0.' };
    }

    // tempoMap (array no vacío)
    if (!Array.isArray(p.tempoMap) || p.tempoMap.length === 0) {
        return { valid: false, error: 'Falta "tempoMap" o está vacío.' };
    }

    return { valid: true, error: null };
}

/**
 * Aplica un objeto de proyecto al estado global y redibuja.
 * Usado por loadProject() y por el historial de recientes.
 * @param {Object} p — proyecto parseado (estructura de saveProject)
 */
export function _applyProjectData(p) {
    state.gridData                = p.gridData;
    state.noteRows                = p.noteRows;
    state.totalSteps              = p.totalSteps;
    state.ticksPerStep            = p.ticksPerStep;
    state.selectedChannel         = p.selectedChannel;
    state.currentKey              = p.currentKey;
    state.currentHarmonicSegments = p.harmonicSegments || [];
    state.currentFusedSegments    = p.fusedSegments    || [];
    state.currentPhraseSegments   = p.phraseSegments   || [];
    state.tempoMap                = p.tempoMap;
    state.ppqn                    = p.ppqn;

    // ── Tempo points ──────────────────────────────────
    if (p.tempoPoints && p.tempoPoints.length) {
        state.tempoPoints = p.tempoPoints.map(tp => ({ ...tp }));
    } else {
        state.tempoPoints = [{ step: 0, bpm: state.tempoMap?.[0]?.bpm || 120 }];
    }
    state.sectionMarkers = (p.sectionMarkers || []).map(sm => ({ ...sm }));

    // ── Re-analizar si el JSON no tiene segmentos guardados ──
    if (state.currentHarmonicSegments.length === 0) {
        const analysis = performHarmonicAnalysisFromGrid();
        if (analysis) {
            state.currentHarmonicSegments = analysis.segments;
            state.currentFusedSegments    = analysis.fusedSegments;
            state.currentPhraseSegments   = analysis.phraseSegments;
            state.currentKey = analysis.key.tonic + (analysis.key.mode === 'minor' ? 'm' : '');
        }
    }

    historyClear();

    // ── Redibujar grid (dimensiona el canvas) ─────────
    applyZoom(p.stepWidth || 8, p.rowHeight || 25);

    // ── Respiración ───────────────────────────────────
    calcularBreathingPoints();

    // ── Chord row: nivel decidido desde el estado (no del DOM) ──
    const chordRow = document.getElementById('chordRowContainer');
    if (chordRow) {
        if (state.currentHarmonicSegments.length > 0) {
            const isMinor = state.currentKey && state.currentKey.endsWith('m');
            const keyObj  = state.currentKey
                ? { tonic: state.currentKey.replace('m', ''), mode: isMinor ? 'minor' : 'major', rootClass: 0 }
                : null;
            const segs = state.currentFusedSegments.length
                ? state.currentFusedSegments
                : state.currentHarmonicSegments;
            drawChordRow(segs, keyObj);
        } else {
            chordRow.innerHTML = '';
        }
    }

    // ── Botones de fragmento A-B y pegado ─────────────────────
    _updateFragmentButtons();
    _updateAbBtn();

    // ── Habilitación de la UI (botones, selectores) la hace el entry point ──
    _emitApplied();
}

/**
 * Carga el estado del proyecto desde un archivo JSON.
 * @param {File} file
 */
export function loadProject(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        let p;
        try {
            p = JSON.parse(e.target.result);
        } catch (err) {
            console.error('[loadProject] JSON inválido:', err);
            _emitStatus('Error: el archivo no es JSON válido.');
            return;
        }

        // Validar integridad ANTES de tocar el estado o crear tabs.
        const { valid, error } = validateProjectData(p);
        if (!valid) {
            console.error('[loadProject] Proyecto inválido:', error);
            _emitStatus('Proyecto inválido: ' + error);
            return;
        }

        const name = file.name.replace(/\.json$/i, '');
        const hasContent = Object.keys(state.gridData.cells).length > 0 || state.noteRows.length > 0;
        if (hasContent) tabNew();
        _applyProjectData(p);
        recentFilesAdd(name, p);
        tabMarkFileLoaded(name);
        _emitStatus("Proyecto cargado.");
    };
    reader.readAsText(file);
}

// ---- Utilidad interna ----
function _downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
