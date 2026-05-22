// ============================================================
// velocity-lane.js — Carril de velocidades debajo del piano roll
// Depende de: state.js, piano-roll.js (_OCT_RGB), history.js
// ============================================================

let velLaneActive = false;
const _VEL_LANE_H = 64;

let _velDragging = false;
let _velLastStep = -1;

// ── Toggle ──────────────────────────────────────────────────

function toggleVelocityLane() {
    velLaneActive = !velLaneActive;
    const wrapper = document.getElementById('velocityLaneWrapper');
    if (wrapper) wrapper.style.display = velLaneActive ? 'flex' : 'none';
    const btn = document.getElementById('velLaneBtn');
    if (btn) btn.classList.toggle('btn-active', velLaneActive);
    if (velLaneActive) drawVelocityLane();
}

// ── Dibujo ───────────────────────────────────────────────────

function drawVelocityLane() {
    if (!velLaneActive) return;
    const velCanvas = document.getElementById('velocityLaneCanvas');
    if (!velCanvas || !totalSteps || !noteRows.length) return;

    const ctx2 = velCanvas.getContext('2d');
    velCanvas.width        = totalSteps * stepWidth;
    velCanvas.height       = _VEL_LANE_H;
    velCanvas.style.width  = `${velCanvas.width}px`;
    velCanvas.style.height = `${_VEL_LANE_H}px`;

    const CT = window.CANVAS_THEME || {};

    // Fondo
    ctx2.fillStyle = CT.bg || '#252530';
    ctx2.fillRect(0, 0, velCanvas.width, _VEL_LANE_H);

    // Líneas de cuadrícula verticales (alineadas con el piano roll)
    for (let step = 0; step <= totalSteps; step++) {
        ctx2.strokeStyle = (step % 16 === 0) ? (CT.gridBar || '#555555') : (CT.grid || '#3a3a50');
        ctx2.lineWidth   = (step % 16 === 0) ? 1 : 0.5;
        const x = step * stepWidth;
        ctx2.beginPath(); ctx2.moveTo(x, 0); ctx2.lineTo(x, _VEL_LANE_H); ctx2.stroke();
    }

    // Línea de referencia al 50%
    ctx2.strokeStyle = CT.gridBar || '#555555';
    ctx2.lineWidth   = 0.5;
    const midY = Math.round(_VEL_LANE_H * 0.5);
    ctx2.setLineDash([3, 3]);
    ctx2.beginPath(); ctx2.moveTo(0, midY); ctx2.lineTo(velCanvas.width, midY); ctx2.stroke();
    ctx2.setLineDash([]);

    // Barras por nota
    for (const [key, cell] of Object.entries(gridData.cells)) {
        const [noteStr, stepStr] = key.split(',');
        const step = parseInt(stepStr);
        const note = parseInt(noteStr);
        const vel  = cell.velocity || 0;

        const oct          = Math.max(1, Math.min(6, Math.floor(note / 12) - 1));
        const [or, og, ob] = _OCT_RGB[oct];
        const bright       = 0.35 + (vel / 127) * 0.65;

        const barH = Math.max(2, Math.round((vel / 127) * (_VEL_LANE_H - 6)));
        const x    = step * stepWidth + 1;
        const w    = Math.max(1, stepWidth - 2);
        const y    = _VEL_LANE_H - barH - 3;

        ctx2.fillStyle = `rgb(${Math.round(or*bright)},${Math.round(og*bright)},${Math.round(ob*bright)})`;
        ctx2.fillRect(x, y, w, barH);

        // Tope brillante (acento superior)
        ctx2.fillStyle = `rgba(${or},${og},${ob},0.55)`;
        ctx2.fillRect(x, y, w, 2);
    }

    // Etiqueta
    ctx2.fillStyle = CT.label || '#666666';
    ctx2.font      = '9px monospace';
    ctx2.fillText('VEL', 3, 10);
}

// ── Edición por arrastre ──────────────────────────────────────

function _velFromY(canvasY) {
    const clamped = Math.max(0, Math.min(_VEL_LANE_H - 6, canvasY));
    return Math.max(0, Math.min(127, Math.round((1 - clamped / (_VEL_LANE_H - 6)) * 127)));
}

function _stepsAtX(canvasX) {
    return Math.max(0, Math.min(totalSteps - 1, Math.floor(canvasX / stepWidth)));
}

function _editVelAtStep(step, vel) {
    let changed = false;
    for (const [key, cell] of Object.entries(gridData.cells)) {
        if (parseInt(key.split(',')[1]) === step) {
            cell.velocity = vel;
            changed = true;
        }
    }
    return changed;
}

function _onVelMouseDown(e) {
    e.preventDefault();
    historyPush();
    _velDragging = true;
    _velLastStep = -1;

    const velCanvas = document.getElementById('velocityLaneCanvas');
    const rect = velCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (velCanvas.width  / rect.width);
    const y = (e.clientY - rect.top)  * (velCanvas.height / rect.height);
    const step = _stepsAtX(x);
    _velLastStep = step;
    _editVelAtStep(step, _velFromY(y));
    drawVelocityLane();
    drawPianoRollWithPlayhead(reproduciendo ? pasoActual : -1);
    if (typeof tabMarkDirty === 'function') tabMarkDirty();
}

function _onVelDocMouseMove(e) {
    if (!_velDragging) return;
    const velCanvas = document.getElementById('velocityLaneCanvas');
    if (!velCanvas) return;
    const rect = velCanvas.getBoundingClientRect();
    const x    = (e.clientX - rect.left) * (velCanvas.width  / rect.width);
    const y    = Math.max(0, e.clientY - rect.top) * (velCanvas.height / rect.height);
    const step = _stepsAtX(x);
    const vel  = _velFromY(y);
    if (step === _velLastStep) return;
    _velLastStep = step;
    if (_editVelAtStep(step, vel)) {
        drawVelocityLane();
        drawPianoRollWithPlayhead(reproduciendo ? pasoActual : -1);
    }
}

function _onVelMouseUp() {
    if (!_velDragging) return;
    _velDragging = false;
    _velLastStep = -1;
    if (typeof tabMarkDirty === 'function') tabMarkDirty();
}

// ── Inicialización ────────────────────────────────────────────

function initVelocityLane() {
    const velCanvas = document.getElementById('velocityLaneCanvas');
    if (!velCanvas) return;
    velCanvas.addEventListener('mousedown', _onVelMouseDown);
    document.addEventListener('mousemove',  _onVelDocMouseMove);
    document.addEventListener('mouseup',    _onVelMouseUp);
}
