// ============================================================
// editor.js — Edición interactiva del grid en el canvas
// Click para añadir/quitar notas; arrastre para ajustar duración;
// Ctrl+Click para editar velocity.
// Depende de: state.js, piano-roll.js, heat.js
// ============================================================

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

// Helper: invalidar heat map después de ediciones
function _invalidateHeatMap() {
    if (heatMapActive && typeof _refreshHeatMap === 'function') {
        _refreshHeatMap();
    }
}

// ---- Coordenadas ----

// Coordenadas clamped al canvas (para arrastres que salen del borde)
function _coordsFromEvent(e) {
    const rect   = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * (canvas.width  / rect.width);
    const mouseY = (e.clientY - rect.top)  * (canvas.height / rect.height);
    return {
        step:     Math.max(0, Math.min(totalSteps - 1,    Math.floor(mouseX / stepWidth))),
        rowIndex: Math.max(0, Math.min(noteRows.length - 1, Math.floor(mouseY / rowHeight))),
    };
}

function _cellFromEvent(e) {
    const rect   = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * (canvas.width  / rect.width);
    const mouseY = (e.clientY - rect.top)  * (canvas.height / rect.height);
    const step     = Math.floor(mouseX / stepWidth);
    const rowIndex = Math.floor(mouseY / rowHeight);
    if (rowIndex < 0 || rowIndex >= noteRows.length) return null;
    if (step  < 0 || step  >= totalSteps)            return null;
    return { step, note: noteRows[rowIndex], rowIndex };
}

// ---- Operaciones sobre celdas ----

function toggleCell(step, note) {
    historyPush();
    const key = `${note},${step}`;
    if (gridData.cells[key]) {
        delete gridData.cells[key];
    } else {
        gridData.cells[key] = { duration: 1, velocity: 40 };
    }
    drawPianoRollWithPlayhead(reproduciendo ? pasoActual : -1);
    _invalidateHeatMap();
}

function setNoteDuration(step, note, newDuration) {
    const key = `${note},${step}`;
    if (gridData.cells[key]) {
        gridData.cells[key].duration = Math.max(1, newDuration);
        drawPianoRollWithPlayhead(reproduciendo ? pasoActual : -1);
        _invalidateHeatMap();
    }
}

function editVelocity(step, note) {
    const key = `${note},${step}`;
    if (!gridData.cells[key]) return;
    const cur = gridData.cells[key].velocity;
    const val = prompt(`Velocity actual: ${cur}\nIntroduce nuevo valor (0-127):`, cur);
    if (val !== null && !isNaN(val)) {
        historyPush();
        gridData.cells[key].velocity = Math.min(127, Math.max(0, parseInt(val)));
        drawPianoRollWithPlayhead(reproduciendo ? pasoActual : -1);
        _invalidateHeatMap();
    }
}

// ---- Manejadores de eventos del canvas ----

function _toggleMotorMute(note) {
    if (typeof motorForNote !== 'function') return;
    const entry = motorForNote(note);
    if (!entry) return;
    entry.muted = !entry.muted;
    if (typeof _mmSaveToStorage      === 'function') _mmSaveToStorage();
    if (typeof _renderMotorMapPanelRows === 'function') _renderMotorMapPanelRows();
    if (typeof _renderMotorMapRows   === 'function') _renderMotorMapRows();
    drawPianoRollWithPlayhead(reproduciendo ? pasoActual : -1);
    if (typeof statusSpan !== 'undefined')
        statusSpan.innerText = `Motor ${entry.motor} (${entry.name}): ${entry.muted ? 'muteado' : 'activo'}`;
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

    _dragging        = true;
    _dragStartStep   = cell.step;
    _dragStartNote   = cell.note;
    _dragCurrentStep = cell.step;
    e.preventDefault();
}

function _onMouseMove(e) {
    if (_selDragging) {
        _selDragEnd = _coordsFromEvent(e);
        drawPianoRollWithPlayhead(reproduciendo ? pasoActual : -1);
        return;
    }
    if (!_dragging) return;
    const cell = _cellFromEvent(e);
    if (cell) _dragCurrentStep = cell.step;
}

function _onDocumentMouseUp(e) {
    if (_selDragging) {
        _selDragging = false;
        _selDragEnd  = _coordsFromEvent(e);
        _selectionFromRect();
        _selActive = _selCells.size > 0;
        drawPianoRollWithPlayhead(reproduciendo ? pasoActual : -1);
    }
}

function _onMouseUp(e) {
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
        gridData.cells[key] = { duration, velocity: gridData.cells[key]?.velocity || 40 };
        drawPianoRollWithPlayhead(reproduciendo ? pasoActual : -1);
        _invalidateHeatMap();
    }

    _dragStartStep   = null;
    _dragCurrentStep = null;
}

// ---- Operaciones de fragmento A-B ----

function copyFragment() {
    if (!loopAB || loopA < 0 || loopB <= loopA) return;
    const cells = [];
    for (const [key, cell] of Object.entries(gridData.cells)) {
        const [noteStr, stepStr] = key.split(',');
        const step = parseInt(stepStr);
        if (step < loopA || step >= loopB) continue;
        cells.push({ relStep: step - loopA, note: parseInt(noteStr), duration: cell.duration, velocity: cell.velocity });
    }
    _clipboardFragment = { length: loopB - loopA, cells };
    _updateFragmentButtons();
}

function pasteFragment() {
    if (!_clipboardFragment) return;
    historyPush();
    const atStep = pasoActual;

    // Expandir noteRows con notas del clipboard que no existan en el grid actual
    const newNotes = [...new Set(_clipboardFragment.cells.map(c => c.note))]
        .filter(n => !noteRows.includes(n));
    if (newNotes.length) {
        noteRows = [...new Set([...noteRows, ...newNotes])].sort((a, b) => a - b);
    }

    for (const c of _clipboardFragment.cells) {
        const targetStep = atStep + c.relStep;
        if (targetStep + c.duration > totalSteps) totalSteps = targetStep + c.duration;
        gridData.cells[`${c.note},${targetStep}`] = { duration: c.duration, velocity: c.velocity };
    }
    drawPianoRollWithPlayhead(reproduciendo ? pasoActual : -1);
    if (typeof drawTimelineRuler === 'function') drawTimelineRuler();
    _invalidateHeatMap();
    if (typeof tabMarkDirty === 'function') tabMarkDirty();
}

function deleteFragment() {
    if (!loopAB || loopA < 0 || loopB <= loopA) return;
    historyPush();
    const fragLen = loopB - loopA;
    const newCells = {};
    for (const [key, cell] of Object.entries(gridData.cells)) {
        const [noteStr, stepStr] = key.split(',');
        const step = parseInt(stepStr);
        if (step >= loopA && step < loopB) continue;
        const newStep = step >= loopB ? step - fragLen : step;
        newCells[`${noteStr},${newStep}`] = { ...cell };
    }
    gridData.cells = newCells;
    totalSteps = Math.max(0, totalSteps - fragLen);
    loopA = loopB = -1;
    loopAB = false;
    drawPianoRollWithPlayhead(reproduciendo ? pasoActual : -1);
    if (typeof drawTimelineRuler === 'function') drawTimelineRuler();
    if (typeof _updateAbBtn === 'function') _updateAbBtn();
    _invalidateHeatMap();
}

// ---- Selección rectangular ----

function _selectionFromRect() {
    if (!_selDragStart || !_selDragEnd) return;
    const r1 = Math.min(_selDragStart.rowIndex, _selDragEnd.rowIndex);
    const r2 = Math.max(_selDragStart.rowIndex, _selDragEnd.rowIndex);
    const s1 = Math.min(_selDragStart.step,     _selDragEnd.step);
    const s2 = Math.max(_selDragStart.step,     _selDragEnd.step);
    _selCells = new Set();
    for (const [key, cell] of Object.entries(gridData.cells)) {
        const [noteStr, stepStr] = key.split(',');
        const step     = parseInt(stepStr);
        const rowIndex = noteRows.indexOf(parseInt(noteStr));
        if (rowIndex < r1 || rowIndex > r2) continue;
        if (step > s2 || step + cell.duration - 1 < s1) continue;
        _selCells.add(key);
    }
}

function selectionDelete() {
    if (!_selCells.size) return;
    historyPush();
    for (const key of _selCells) delete gridData.cells[key];
    selectionClear();
    if (heatMapActive && typeof _refreshHeatMap === 'function') _refreshHeatMap();
    if (typeof tabMarkDirty === 'function') tabMarkDirty();
}

function selectionCopy() {
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
        const cell = gridData.cells[key];
        cells.push({ relStep: step - minStep, note: parseInt(noteStr), duration: cell.duration, velocity: cell.velocity });
        maxEnd = Math.max(maxEnd, step - minStep + cell.duration);
    }
    _clipboardFragment = { length: maxEnd, cells };
    _updateFragmentButtons();
}

function selectionClear() {
    _selActive    = false;
    _selCells     = new Set();
    _selDragStart = null;
    _selDragEnd   = null;
    drawPianoRollWithPlayhead(reproduciendo ? pasoActual : -1);
}

function _updateFragmentButtons() {
    const hasRange = loopAB && loopA >= 0 && loopB > loopA;
    const copyBtn   = document.getElementById('copyFragBtn');
    const pasteBtn  = document.getElementById('pasteFragBtn');
    const deleteBtn = document.getElementById('deleteFragBtn');
    if (copyBtn)   copyBtn.disabled   = !hasRange;
    if (deleteBtn) deleteBtn.disabled = !hasRange;
    if (pasteBtn)  pasteBtn.disabled  = !_clipboardFragment;
}

// ---- Registro de eventos (llamado desde main.js) ----

function initCanvasEvents() {
    canvas.addEventListener('click',     _onCanvasClick);
    canvas.addEventListener('mousedown', _onMouseDown);
    canvas.addEventListener('mousemove', _onMouseMove);
    canvas.addEventListener('mouseup',   _onMouseUp);
    // Capturar mouseup fuera del canvas (arrastre que termina fuera del área)
    document.addEventListener('mouseup', _onDocumentMouseUp);
}
