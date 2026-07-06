// ============================================================
// editor.js — Edición interactiva del grid en el canvas
// Click para añadir/quitar notas; arrastre para ajustar duración;
// Ctrl+Click para editar velocity.
// Depende de: state.js, piano-roll.js
// ============================================================

import { state } from './state.js';
import { historyPush } from './history.js';
import { drawPianoRollWithPlayhead } from './piano-roll.js';
import { drawVelocityLane } from './velocity-lane.js';
import { drawTimelineRuler, _updateAbBtn } from './timeline-ruler.js';
import { tabMarkDirty } from './tabs.js';
import { motorForNote, _mmSaveToStorage, _renderMotorMapPanelRows, _renderMotorMapRows,
         velGridToEsp32, velEsp32ToGrid, velMaxGridForNote } from './motor-map.js';
import { canvas } from './dom-refs.js';
import { performHarmonicAnalysisFromGrid } from './harmonic.js';
import { drawChordRow } from './chord-row.js';

// ── Debounce del análisis armónico ────────────────────────────
// El análisis armónico (Krumhansl-Kessler + detección de acordes) es costoso
// en grids grandes. Tras una ráfaga de ediciones (drag, paste masivo) lo
// lanzamos UNA sola vez, 300ms después del último cambio. El piano roll se
// redibuja siempre de inmediato; solo se difieren el análisis y el chord row.
const HARMONIC_DEBOUNCE_MS = 300;

// Callback nombrado del módulo (no closure): lee state fresco al ejecutarse,
// evitando retener referencias obsoletas.
function _runHarmonicAnalysis() {
    state._harmonicDebounceTimer = null;
    if (!state.gridData || Object.keys(state.gridData.cells).length === 0) {
        // Grid vacío: limpiar el chord row y los segmentos.
        state.currentHarmonicSegments = [];
        state.currentFusedSegments    = [];
        state.currentPhraseSegments   = [];
        const chordRow = document.getElementById('chordRowContainer');
        if (chordRow) chordRow.innerHTML = '';
        return;
    }
    const analysis = performHarmonicAnalysisFromGrid();
    if (!analysis) return;
    state.currentHarmonicSegments = analysis.segments;
    state.currentFusedSegments    = analysis.fusedSegments;
    state.currentPhraseSegments   = analysis.phraseSegments;
    state.currentKey = analysis.key.tonic + (analysis.key.mode === 'minor' ? 'm' : '');

    // Respetar el nivel de vista activo (pasos / acordes / frases / respiración).
    const level = document.getElementById('viewLevelSelect')?.value || 'acordes';
    let segs = state.currentHarmonicSegments;
    if (level === 'acordes'     && state.currentFusedSegments.length)  segs = state.currentFusedSegments;
    else if (level === 'frases' && state.currentPhraseSegments.length) segs = state.currentPhraseSegments;
    else if (level === 'respiración' && state.breathingSegments.length) segs = state.breathingSegments;
    else if (state.currentFusedSegments.length)                        segs = state.currentFusedSegments;

    drawChordRow(segs, analysis.key);
}

/**
 * Programa el análisis armónico tras 300ms, cancelando cualquier análisis
 * pendiente de la ráfaga actual. El timer se guarda en state para poder
 * cancelarlo sin closures que retengan refs obsoletas. Exportada para que
 * otros módulos (y los tests) puedan reutilizar el debounce.
 */
export function scheduleHarmonicAnalysis() {
    if (state._harmonicDebounceTimer !== null) {
        clearTimeout(state._harmonicDebounceTimer);
    }
    state._harmonicDebounceTimer = setTimeout(_runHarmonicAnalysis, HARMONIC_DEBOUNCE_MS);
}

let _dragging        = false;
let _dragStartStep   = null;
let _dragStartNote   = null;
let _dragCurrentStep = null;
let _noteDragged     = false;  // true cuando mouseup completó un arrastre real; suprime el click siguiente

// ---- Estado de selección rectangular ----
let _selActive    = false;
let _selCells     = new Set();   // "note,step" seleccionados
let _selDragging  = false;
let _selDragStart = null;        // { step, rowIndex }
let _selDragEnd   = null;        // { step, rowIndex }

// ---- Estado de movimiento de la selección (arrastre) ----
let _movingSel     = false;
let _moveStart     = null;       // { step, rowIndex } donde empezó el arrastre
let _moveSnapshot  = null;       // [{ note, step, duration, velocity }] de las celdas seleccionadas al iniciar
let _moveDelta     = null;       // { dStep, dRow } aplicado en la última previsualización
let _moveGridBak   = null;       // clon de gridData.cells antes del arrastre (para history y restaurar colisiones)
let _moveTotalBak  = 0;          // totalSteps antes del arrastre

// ---- Coordenadas ----

// Coordenadas clamped al canvas (para arrastres que salen del borde)
function _coordsFromEvent(e) {
    const rect   = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * (canvas.width  / rect.width);
    const mouseY = (e.clientY - rect.top)  * (canvas.height / rect.height);
    return {
        step:     Math.max(0, Math.min(state.totalSteps - 1,    Math.floor(mouseX / state.stepWidth))),
        rowIndex: Math.max(0, Math.min(state.noteRows.length - 1, Math.floor(mouseY / state.rowHeight))),
    };
}

function _cellFromEvent(e) {
    const rect   = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * (canvas.width  / rect.width);
    const mouseY = (e.clientY - rect.top)  * (canvas.height / rect.height);
    const step     = Math.floor(mouseX / state.stepWidth);
    const rowIndex = Math.floor(mouseY / state.rowHeight);
    if (rowIndex < 0 || rowIndex >= state.noteRows.length) return null;
    if (step  < 0 || step  >= state.totalSteps)            return null;
    return { step, note: state.noteRows[rowIndex], rowIndex };
}

// ---- Operaciones sobre celdas ----

function toggleCell(step, note) {
    historyPush();
    const key = `${note},${step}`;
    if (state.gridData.cells[key]) {
        delete state.gridData.cells[key];
    } else {
        state.gridData.cells[key] = { duration: 1, velocity: 40 };
    }
    drawPianoRollWithPlayhead(state.reproduciendo ? state.pasoActual : -1);
    scheduleHarmonicAnalysis();
}

function setNoteDuration(step, note, newDuration) {
    const key = `${note},${step}`;
    if (state.gridData.cells[key]) {
        state.gridData.cells[key].duration = Math.max(1, newDuration);
        drawPianoRollWithPlayhead(state.reproduciendo ? state.pasoActual : -1);
        scheduleHarmonicAnalysis();
    }
}

function editVelocity(step, note) {
    const key = `${note},${step}`;
    if (!state.gridData.cells[key]) return;

    // Mostrar en escala ESP32 (1-100), la misma del Motor Map. El grid guarda 0-127.
    const cur = velGridToEsp32(state.gridData.cells[key].velocity);

    // Tooltip inline: pequeño input flotante sobre el canvas, evita bloquear el hilo
    const existing = document.getElementById('_velTooltip');
    if (existing) existing.remove();

    const rect  = canvas.getBoundingClientRect();
    const x     = rect.left + step * state.stepWidth * (rect.width / canvas.width);
    const rowIdx = state.noteRows.indexOf(note);
    const y     = rect.top + rowIdx * state.rowHeight * (rect.height / canvas.height);

    const tip = document.createElement('div');
    tip.id    = '_velTooltip';
    Object.assign(tip.style, {
        position: 'fixed', zIndex: 9999,
        left: `${Math.min(x, window.innerWidth - 120)}px`,
        top:  `${Math.max(y - 36, 4)}px`,
        background: '#1a1a30', border: '1px solid #6688cc',
        borderRadius: '6px', padding: '4px 8px',
        display: 'flex', alignItems: 'center', gap: '6px',
        fontSize: '12px', color: '#ddeeff', boxShadow: '0 2px 8px #0008'
    });
    tip.innerHTML = `<span style="opacity:.7">vel</span>
        <input id="_velInput" type="number" min="0" max="100" value="${cur}"
               style="width:52px;background:#0e0e1e;color:#ddeeff;border:1px solid #3a3a5a;
                      border-radius:4px;padding:2px 4px;font-size:12px;text-align:center;">
        <span style="opacity:.5;font-size:10px">↵</span>`;
    document.body.appendChild(tip);

    const input = document.getElementById('_velInput');
    input.select();

    // Listener de "click fuera" (se registra con retardo para no auto-cerrarse
    // con el mismo mousedown que abrió el tooltip).
    let _outside = null;

    // Cierre único: quita el listener global y elimina el tooltip. Idempotente.
    const close = () => {
        if (_outside) { document.removeEventListener('mousedown', _outside); _outside = null; }
        tip.remove();
    };

    const commit = () => {
        const val = parseInt(input.value);   // el usuario teclea en escala ESP32 1-100
        if (!isNaN(val)) {
            historyPush();
            // Convertir a escala grid y acotar al velMax del motor de esta nota,
            // para no rebasar el límite físico del solenoide.
            const vGrid = velEsp32ToGrid(val);
            state.gridData.cells[key].velocity = Math.min(vGrid, velMaxGridForNote(note));
            drawPianoRollWithPlayhead(state.reproduciendo ? state.pasoActual : -1);
            drawVelocityLane();   // no-op interno si el carril está oculto (velLaneActive)
        }
        close();
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); }   // cancelar sin aplicar
    });

    // Click fuera del tooltip → aplica y cierra.
    setTimeout(() => {
        _outside = (ev) => { if (!tip.contains(ev.target)) commit(); };
        document.addEventListener('mousedown', _outside);
    }, 50);
}

// ---- Manejadores de eventos del canvas ----

function _toggleMotorMute(note) {
    const entry = motorForNote(note);
    if (!entry) return;
    entry.muted = !entry.muted;
    _mmSaveToStorage();
    _renderMotorMapPanelRows();
    _renderMotorMapRows();
    drawPianoRollWithPlayhead(state.reproduciendo ? state.pasoActual : -1);
}

function _onCanvasClick(e) {
    if (e.ctrlKey || e.shiftKey || e.altKey) return;
    // Suprimir el click que el navegador dispara tras finalizar un arrastre
    if (_noteDragged) { _noteDragged = false; return; }
    const cell = _cellFromEvent(e);
    if (!cell) return;
    // Click normal con selección activa → deseleccionar (sin añadir nota)
    if (_selActive) { selectionClear(); return; }
    if (!_dragging) toggleCell(cell.step, cell.note);
}

function _onMouseDown(e) {
    const cell = _cellFromEvent(e);
    if (!cell) return;

    if (e.altKey) {
        e.preventDefault();
        _toggleMotorMute(cell.note);
        return;
    }

    if (e.shiftKey) {
        // Iniciar selección rectangular
        _selDragging  = true;
        _selActive    = false;
        _selCells     = new Set();
        _selDragStart = { step: cell.step, rowIndex: cell.rowIndex };
        _selDragEnd   = { step: cell.step, rowIndex: cell.rowIndex };
        e.preventDefault();
        return;
    }

    if (e.ctrlKey) {
        editVelocity(cell.step, cell.note);
        return;
    }

    // Click plano sobre una nota ya seleccionada → arrastrar la selección entera
    // para reposicionarla en el grid (pasos y semitonos).
    if (_selCells.size > 0 && _cellInSelection(cell.step, cell.note)) {
        _movingSel    = true;
        _moveStart    = { step: cell.step, rowIndex: cell.rowIndex };
        _moveSnapshot = _snapshotSelection();
        _moveDelta    = { dStep: 0, dRow: 0 };
        // Backup completo del grid: permite restaurar colisiones sobrescritas
        // durante la previsualización y registrar un único punto de historia.
        _moveGridBak  = {};
        for (const [k, v] of Object.entries(state.gridData.cells)) _moveGridBak[k] = { ...v };
        _moveTotalBak = state.totalSteps;
        e.preventDefault();
        return;
    }

    _dragging        = true;
    _dragStartStep   = cell.step;
    _dragStartNote   = cell.note;
    _dragCurrentStep = cell.step;
    e.preventDefault();
}

/** ¿La celda (step,note) pertenece a una nota seleccionada (incluyendo su duración)? */
function _cellInSelection(step, note) {
    for (const key of _selCells) {
        const [noteStr, stepStr] = key.split(',');
        if (parseInt(noteStr) !== note) continue;
        const start = parseInt(stepStr);
        const dur   = state.gridData.cells[key]?.duration || 1;
        if (step >= start && step < start + dur) return true;
    }
    return false;
}

/** Snapshot de las celdas seleccionadas (datos + posición) para mover desde un origen estable. */
function _snapshotSelection() {
    const snap = [];
    for (const key of _selCells) {
        const [noteStr, stepStr] = key.split(',');
        const cell = state.gridData.cells[key];
        if (!cell) continue;
        snap.push({ note: parseInt(noteStr), step: parseInt(stepStr), duration: cell.duration, velocity: cell.velocity });
    }
    return snap;
}

/**
 * Clampa (dStep, dRow) para que NINGUNA nota del snapshot se salga del grid:
 * por la izquierda (step >= 0) y por los bordes de noteRows (índice válido).
 * Por la derecha el grid se amplía, así que no se limita. Devuelve el delta corregido.
 */
function _clampMoveDelta(dStep, dRow) {
    let minStep = Infinity, minRow = Infinity, maxRow = -Infinity;
    for (const s of _moveSnapshot) {
        const row = state.noteRows.indexOf(s.note);
        minStep = Math.min(minStep, s.step);
        minRow  = Math.min(minRow,  row);
        maxRow  = Math.max(maxRow,  row);
    }
    if (minStep + dStep < 0)                         dStep = -minStep;
    if (minRow + dRow < 0)                           dRow  = -minRow;
    if (maxRow + dRow > state.noteRows.length - 1)   dRow  = state.noteRows.length - 1 - maxRow;
    return { dStep, dRow };
}

/**
 * Reconstruye el grid desde el backup íntegro y coloca la selección desplazada
 * (dRow filas, dStep pasos), sobrescribiendo colisiones. Partir SIEMPRE del backup
 * garantiza que las notas pisadas en un frame reaparezcan si el arrastre las libera.
 * Reconstruye _selCells con las claves nuevas. No persiste history.
 */
function _applyMoveFromSnapshot(dStep, dRow) {
    // 1. Restaurar el grid íntegro (incluye las notas no seleccionadas y las que
    //    pudieran haber sido pisadas en una previsualización anterior).
    state.gridData.cells = {};
    for (const [k, v] of Object.entries(_moveGridBak)) state.gridData.cells[k] = { ...v };
    state.totalSteps = _moveTotalBak;

    // 2. Quitar las celdas que la selección ocupaba en su posición original.
    for (const s of _moveSnapshot) delete state.gridData.cells[`${s.note},${s.step}`];

    // 3. Colocar desde el snapshot con el delta. dRow desplaza el índice en noteRows.
    const newSel = new Set();
    let maxEnd = 0;
    for (const s of _moveSnapshot) {
        const row     = state.noteRows.indexOf(s.note);
        const newNote = state.noteRows[row + dRow];   // delta ya clampado a índices válidos
        const newStep = s.step + dStep;
        const key     = `${newNote},${newStep}`;
        state.gridData.cells[key] = { duration: s.duration, velocity: s.velocity };
        newSel.add(key);
        maxEnd = Math.max(maxEnd, newStep + s.duration);
    }

    // 4. Ampliar el grid por la derecha si la selección rebasa el final.
    if (maxEnd > state.totalSteps) state.totalSteps = maxEnd;

    _selCells  = newSel;
    _selActive = true;
}

/** Previsualiza el movimiento en vivo mientras se arrastra (sin tocar history). */
function _previewMove(dStep, dRow) {
    const cl = _clampMoveDelta(dStep, dRow);
    _moveDelta = { dStep, dRow };   // guardamos el bruto para comparar en el próximo move
    _applyMoveFromSnapshot(cl.dStep, cl.dRow);
    drawPianoRollWithPlayhead(state.reproduciendo ? state.pasoActual : -1);
    drawTimelineRuler();
}

/** Finaliza el arrastre de la selección: confirma posición, refresca análisis. */
function _finishMove() {
    _movingSel = false;
    const moved = _moveDelta && (_moveDelta.dStep !== 0 || _moveDelta.dRow !== 0);
    if (moved) {
        // Registrar UN punto de historia con el estado PREVIO al movimiento (el backup),
        // luego confirmar el delta final ya clampado. _applyMoveFromSnapshot restaura el
        // backup internamente, así que el push captura el grid pre-arrastre.
        const cl = _clampMoveDelta(_moveDelta.dStep, _moveDelta.dRow);
        state.gridData.cells = {};
        for (const [k, v] of Object.entries(_moveGridBak)) state.gridData.cells[k] = { ...v };
        state.totalSteps = _moveTotalBak;
        historyPush();
        _applyMoveFromSnapshot(cl.dStep, cl.dRow);
        _noteDragged = true;        // suprime el click que el navegador dispara tras el arrastre
        drawPianoRollWithPlayhead(state.reproduciendo ? state.pasoActual : -1);
        drawTimelineRuler();
        scheduleHarmonicAnalysis();
        tabMarkDirty();
    }
    _moveStart    = null;
    _moveSnapshot = null;
    _moveDelta    = null;
    _moveGridBak  = null;
    _updateFragmentButtons();
}

function _onMouseMove(e) {
    if (_movingSel) {
        const c = _coordsFromEvent(e);
        const dStep = c.step     - _moveStart.step;
        const dRow  = c.rowIndex - _moveStart.rowIndex;
        if (dStep !== _moveDelta.dStep || dRow !== _moveDelta.dRow) {
            _previewMove(dStep, dRow);
        }
        return;
    }
    if (_selDragging) {
        _selDragEnd = _coordsFromEvent(e);
        drawPianoRollWithPlayhead(state.reproduciendo ? state.pasoActual : -1);
        return;
    }
    if (!_dragging) return;
    const cell = _cellFromEvent(e);
    if (cell) _dragCurrentStep = cell.step;
}

function _onDocumentMouseUp(e) {
    if (_movingSel) {
        _finishMove();
        return;
    }
    if (_selDragging) {
        _selDragging = false;
        _selDragEnd  = _coordsFromEvent(e);
        _selectionFromRect();
        _selActive = _selCells.size > 0;
        drawPianoRollWithPlayhead(state.reproduciendo ? state.pasoActual : -1);
        _updateFragmentButtons();   // habilitar Copiar/Eliminar con la selección
    }
}

function _onMouseUp(e) {
    if (_movingSel) { _finishMove(); return; }
    if (!_dragging) return;
    _dragging = false;

    // Si el arrastre fue sobre la misma nota: ajustar duración
    const cell = _cellFromEvent(e);
    if (cell && cell.note === _dragStartNote && _dragStartStep !== _dragCurrentStep) {
        _noteDragged = true;   // suprimir el click que el navegador dispara justo después
        historyPush();
        const start    = Math.min(_dragStartStep, _dragCurrentStep);
        const duration = Math.abs(_dragCurrentStep - _dragStartStep) + 1;
        const key      = `${_dragStartNote},${start}`;
        state.gridData.cells[key] = { duration, velocity: state.gridData.cells[key]?.velocity || 40 };
        drawPianoRollWithPlayhead(state.reproduciendo ? state.pasoActual : -1);
        scheduleHarmonicAnalysis();
    }

    _dragStartStep   = null;
    _dragCurrentStep = null;
}

// ---- Operaciones de fragmento A-B ----

export function copyFragment() {
    // Si hay selección rectangular activa, el botón copia la selección.
    if (_selCells.size > 0) { selectionCopy(); return; }
    if (!state.loopAB || state.loopA < 0 || state.loopB <= state.loopA) return;
    const cells = [];
    for (const [key, cell] of Object.entries(state.gridData.cells)) {
        const [noteStr, stepStr] = key.split(',');
        const step = parseInt(stepStr);
        if (step < state.loopA || step >= state.loopB) continue;
        cells.push({ relStep: step - state.loopA, note: parseInt(noteStr), duration: cell.duration, velocity: cell.velocity });
    }
    state._clipboardFragment = { length: state.loopB - state.loopA, cells };
    _updateFragmentButtons();
}

/**
 * Pega el fragmento del portapapeles en la posición del playhead. Las notas
 * pegadas quedan SELECCIONADAS (como una selección rectangular), listas para
 * reposicionarlas arrastrándolas o con las flechas — sin botones de octava.
 */
export function pasteFragment() {
    if (!state._clipboardFragment) return;
    historyPush();
    const atStep = Math.max(0, state.pasoActual);

    const newSel = new Set();
    for (const c of state._clipboardFragment.cells) {
        const targetNote = Math.max(0, Math.min(127, c.note));
        const targetStep = atStep + c.relStep;
        if (targetStep + c.duration > state.totalSteps) state.totalSteps = targetStep + c.duration;
        const key = `${targetNote},${targetStep}`;
        state.gridData.cells[key] = { duration: c.duration, velocity: c.velocity };
        newSel.add(key);
    }

    // Dejar las notas pegadas seleccionadas para poder moverlas de inmediato.
    _selCells  = newSel;
    _selActive = newSel.size > 0;

    drawPianoRollWithPlayhead(state.reproduciendo ? state.pasoActual : -1);
    drawTimelineRuler();
    scheduleHarmonicAnalysis();
    tabMarkDirty();
    _updateFragmentButtons();
}

/**
 * Mueve la selección activa con el teclado: ±pasos / ±filas (semitonos en
 * noteRows). Clampa a bordes y amplía el grid a la derecha. Devuelve true si
 * había selección y se movió (para que el llamador haga preventDefault).
 */
export function moveSelection(dStep, dRow) {
    if (_selCells.size === 0) return false;
    _moveSnapshot = _snapshotSelection();
    _moveGridBak  = {};
    for (const [k, v] of Object.entries(state.gridData.cells)) _moveGridBak[k] = { ...v };
    _moveTotalBak = state.totalSteps;

    const cl = _clampMoveDelta(dStep, dRow);
    if (cl.dStep === 0 && cl.dRow === 0) { _moveSnapshot = _moveGridBak = null; return true; }

    historyPush();
    _applyMoveFromSnapshot(cl.dStep, cl.dRow);
    drawPianoRollWithPlayhead(state.reproduciendo ? state.pasoActual : -1);
    drawTimelineRuler();
    scheduleHarmonicAnalysis();
    tabMarkDirty();

    _moveSnapshot = _moveGridBak = null;
    return true;
}

export function deleteFragment() {
    // Si hay selección rectangular activa, el botón borra la selección.
    if (_selCells.size > 0) { selectionDelete(); return; }
    if (!state.loopAB || state.loopA < 0 || state.loopB <= state.loopA) return;
    historyPush();
    const fragLen = state.loopB - state.loopA;
    const newCells = {};
    for (const [key, cell] of Object.entries(state.gridData.cells)) {
        const [noteStr, stepStr] = key.split(',');
        const step = parseInt(stepStr);
        if (step >= state.loopA && step < state.loopB) continue;
        const newStep = step >= state.loopB ? step - fragLen : step;
        newCells[`${noteStr},${newStep}`] = { ...cell };
    }
    state.gridData.cells = newCells;
    state.totalSteps = Math.max(0, state.totalSteps - fragLen);
    state.loopA = state.loopB = -1;
    state.loopAB = false;
    drawPianoRollWithPlayhead(state.reproduciendo ? state.pasoActual : -1);
    drawTimelineRuler();
    _updateAbBtn();
    scheduleHarmonicAnalysis();
}

// ---- Selección rectangular ----

function _selectionFromRect() {
    if (!_selDragStart || !_selDragEnd) return;
    const r1 = Math.min(_selDragStart.rowIndex, _selDragEnd.rowIndex);
    const r2 = Math.max(_selDragStart.rowIndex, _selDragEnd.rowIndex);
    const s1 = Math.min(_selDragStart.step,     _selDragEnd.step);
    const s2 = Math.max(_selDragStart.step,     _selDragEnd.step);
    _selCells = new Set();
    for (const [key, cell] of Object.entries(state.gridData.cells)) {
        const [noteStr, stepStr] = key.split(',');
        const step     = parseInt(stepStr);
        const rowIndex = state.noteRows.indexOf(parseInt(noteStr));
        if (rowIndex < r1 || rowIndex > r2) continue;
        if (step > s2 || step + cell.duration - 1 < s1) continue;
        _selCells.add(key);
    }
}

export function selectionDelete() {
    if (!_selCells.size) return;
    historyPush();
    for (const key of _selCells) delete state.gridData.cells[key];
    selectionClear();
    scheduleHarmonicAnalysis();
    tabMarkDirty();
}

export function selectionCopy() {
    if (!_selCells.size) return;
    let minStep = Infinity;
    for (const key of _selCells) {
        const step = parseInt(key.split(',')[1]);
        if (step < minStep) minStep = step;
    }
    const cells = [];
    let maxEnd = 0;
    for (const key of _selCells) {
        const [noteStr, stepStr] = key.split(',');
        const step = parseInt(stepStr);
        const cell = state.gridData.cells[key];
        cells.push({ relStep: step - minStep, note: parseInt(noteStr), duration: cell.duration, velocity: cell.velocity });
        maxEnd = Math.max(maxEnd, step - minStep + cell.duration);
    }
    state._clipboardFragment = { length: maxEnd, cells };
    _updateFragmentButtons();
}

export function selectionClear() {
    _selActive    = false;
    _selCells     = new Set();
    _selDragStart = null;
    _selDragEnd   = null;
    drawPianoRollWithPlayhead(state.reproduciendo ? state.pasoActual : -1);
    _updateFragmentButtons();   // re-deshabilitar Copiar/Eliminar si ya no hay selección ni rango
}

export function _updateFragmentButtons() {
    const hasRange = state.loopAB && state.loopA >= 0 && state.loopB > state.loopA;
    const hasSel   = _selCells.size > 0;
    const hasFrag  = !!state._clipboardFragment;
    // Copiar/Eliminar operan sobre la selección rectangular O el rango A→B.
    const canCopyDelete = hasRange || hasSel;
    const copyBtn      = document.getElementById('copyFragBtn');
    const pasteBtn     = document.getElementById('pasteFragBtn');
    const deleteBtn    = document.getElementById('deleteFragBtn');
    if (copyBtn)     copyBtn.disabled    = !canCopyDelete;
    if (deleteBtn)   deleteBtn.disabled  = !canCopyDelete;
    if (pasteBtn)    pasteBtn.disabled   = !hasFrag;
}

/** Devuelve el estado de selección actual (para serializar en tabs). */
export function getSelectionState() {
    return {
        selCells:  [..._selCells],
        selActive: _selActive,
    };
}

/**
 * Referencias vivas del estado de selección, para que piano-roll.js
 * dibuje el overlay sin guards `typeof _selCells`. Devuelve el propio
 * Set/objetos (no copias) — solo para lectura durante el render.
 */
export function getSelCells()   { return _selCells; }
export function getSelDrag()    { return { dragging: _selDragging, start: _selDragStart, end: _selDragEnd }; }

/** Restaura el estado de selección (al restaurar un tab). */
export function setSelectionState(selCells, selActive) {
    _selCells     = new Set(selCells || []);
    _selActive    = selActive || false;
    _selDragging  = false;
    _selDragStart = null;
    _selDragEnd   = null;
}

// ---- Registro de eventos (llamado desde main.js) ----

export function initCanvasEvents() {
    canvas.addEventListener('click',     _onCanvasClick);
    canvas.addEventListener('mousedown', _onMouseDown);
    canvas.addEventListener('mousemove', _onMouseMove);
    canvas.addEventListener('mouseup',   _onMouseUp);
    // Capturar mouseup fuera del canvas (arrastre que termina fuera del área)
    document.addEventListener('mouseup', _onDocumentMouseUp);
}
