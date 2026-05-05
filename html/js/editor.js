// ============================================================
// editor.js — Edición interactiva del grid en el canvas
// Click para añadir/quitar notas; arrastre para ajustar duración;
// Ctrl+Click para editar velocity.
// Depende de: state.js, piano-roll.js, heat.js
// ============================================================

let _dragging       = false;
let _dragStartStep  = null;
let _dragStartNote  = null;
let _dragCurrentStep = null;

// Helper: invalidar heat map después de ediciones
function _invalidateHeatMap() {
    if (heatMapActive && typeof _refreshHeatMap === 'function') {
        _refreshHeatMap();
    }
}

// ---- Coordenadas ----

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
        gridData.cells[key].velocity = Math.min(127, Math.max(0, parseInt(val)));
        drawPianoRollWithPlayhead(reproduciendo ? pasoActual : -1);
        _invalidateHeatMap();
    }
}

// ---- Manejadores de eventos del canvas ----

function _onCanvasClick(e) {
    if (e.ctrlKey) return;
    const cell = _cellFromEvent(e);
    if (!cell) return;
    if (!_dragging) toggleCell(cell.step, cell.note);
}

function _onMouseDown(e) {
    const cell = _cellFromEvent(e);
    if (!cell) return;

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
    if (!_dragging) return;
    const cell = _cellFromEvent(e);
    if (cell) _dragCurrentStep = cell.step;
}

function _onMouseUp(e) {
    if (!_dragging) return;
    _dragging = false;

    // Si el arrastre fue sobre la misma nota: ajustar duración
    const cell = _cellFromEvent(e);
    if (cell && cell.note === _dragStartNote && _dragStartStep !== _dragCurrentStep) {
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
    const atStep = pasoActual;
    for (const c of _clipboardFragment.cells) {
        const targetStep = atStep + c.relStep;
        if (targetStep + c.duration > totalSteps) totalSteps = targetStep + c.duration;
        gridData.cells[`${c.note},${targetStep}`] = { duration: c.duration, velocity: c.velocity };
    }
    drawPianoRollWithPlayhead(reproduciendo ? pasoActual : -1);
    if (typeof drawTimelineRuler === 'function') drawTimelineRuler();
    _invalidateHeatMap();
}

function deleteFragment() {
    if (!loopAB || loopA < 0 || loopB <= loopA) return;
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
}
