// ============================================================
// velocity-lane.js — Carril de velocidades debajo del piano roll
// Depende de: state.js, piano-roll.js (_OCT_RGB), history.js
// ============================================================

import { state } from './state.js';
import { historyPush } from './history.js';
import { _OCT_RGB, drawPianoRollWithPlayhead } from './piano-roll.js';
import { tabMarkDirty } from './tabs.js';
import { velGridToEsp32, velMaxGridForNote } from './motor-map.js';

let velLaneActive = false;  // oculto por defecto; se muestra al pulsar velLaneBtn
const _VEL_LANE_H = 64;

let _velDragging = false;
let _velLastStep = -1;
let _velAllMode  = false;   // true = Shift+drag → todas las notas a la vez

// Snapshot para el modo Shift+drag proporcional: velocities originales por celda
// y velocity de referencia (la media) al iniciar el arrastre. Permite escalar
// todas las notas manteniendo sus diferencias relativas en lugar de igualarlas.
let _velAllSnapshot = null;   // Map<key → velocityOriginal>
let _velAllRefVel   = 0;      // velocity media del snapshot (pivote del escalado)

// ── Fragmento activo ────────────────────────────────────────
// Cuando hay un acorde/frase seleccionado en la lista (state.activeHighlight),
// la edición de velocidad se restringe a SUS notas: solo las celdas cuyo paso
// cae en [startStep, endStep) y cuya clase (note % 12) está en `classes`.
// Sin selección → comportamiento clásico (toda la columna del paso).

/** Devuelve el fragmento activo {classes, startStep, endStep} o null. */
function _activeFragment() {
    const h = state.activeHighlight;
    if (h && Array.isArray(h.classes) && h.classes.length &&
        h.startStep != null && h.endStep != null) {
        return h;
    }
    return null;
}

/** True si la celda (note, step) pertenece al fragmento (o no hay fragmento). */
function _cellInFragment(note, step, frag) {
    if (!frag) return true;
    return step >= frag.startStep && step < frag.endStep &&
           frag.classes.includes(note % 12);
}

// ── Toggle ──────────────────────────────────────────────────

export function toggleVelocityLane() {
    velLaneActive = !velLaneActive;
    const wrapper = document.getElementById('velocityLaneWrapper');
    if (wrapper) wrapper.style.display = velLaneActive ? 'flex' : 'none';
    const btn = document.getElementById('velLaneBtn');
    if (btn) btn.classList.toggle('btn-active', velLaneActive);
    if (velLaneActive) drawVelocityLane();
}

// ── Dibujo ───────────────────────────────────────────────────

export function drawVelocityLane() {
    if (!velLaneActive) return;
    const velCanvas = document.getElementById('velocityLaneCanvas');
    if (!velCanvas || !state.totalSteps || !state.noteRows.length) return;

    const ctx2 = velCanvas.getContext('2d');
    velCanvas.width        = state.totalSteps * state.stepWidth;
    velCanvas.height       = _VEL_LANE_H;
    velCanvas.style.width  = `${velCanvas.width}px`;
    velCanvas.style.height = `${_VEL_LANE_H}px`;

    const CT = window.CANVAS_THEME || {};

    // Fondo
    ctx2.fillStyle = CT.bg || '#252530';
    ctx2.fillRect(0, 0, velCanvas.width, _VEL_LANE_H);

    // Líneas de cuadrícula verticales (alineadas con el piano roll)
    for (let step = 0; step <= state.totalSteps; step++) {
        ctx2.strokeStyle = (step % 16 === 0) ? (CT.gridBar || '#555555') : (CT.grid || '#3a3a50');
        ctx2.lineWidth   = (step % 16 === 0) ? 1 : 0.5;
        const x = step * state.stepWidth;
        ctx2.beginPath(); ctx2.moveTo(x, 0); ctx2.lineTo(x, _VEL_LANE_H); ctx2.stroke();
    }

    // Línea de referencia al 50%
    ctx2.strokeStyle = CT.gridBar || '#555555';
    ctx2.lineWidth   = 0.5;
    const midY = Math.round(_VEL_LANE_H * 0.5);
    ctx2.setLineDash([3, 3]);
    ctx2.beginPath(); ctx2.moveTo(0, midY); ctx2.lineTo(velCanvas.width, midY); ctx2.stroke();
    ctx2.setLineDash([]);

    // Barras por nota. Si hay fragmento activo, las notas fuera de él se
    // atenúan para señalar que el arrastre solo afectará a las del fragmento.
    const frag = _activeFragment();
    for (const [key, cell] of Object.entries(state.gridData.cells)) {
        const [noteStr, stepStr] = key.split(',');
        const step = parseInt(stepStr);
        const note = parseInt(noteStr);
        const vel  = cell.velocity || 0;

        const inFrag = _cellInFragment(note, step, frag);
        const dim    = frag && !inFrag ? 0.25 : 1;

        const oct          = Math.max(1, Math.min(6, Math.floor(note / 12) - 1));
        const [or, og, ob] = _OCT_RGB[oct];
        const bright       = (0.35 + (vel / 127) * 0.65) * dim;

        const barH = Math.max(2, Math.round((vel / 127) * (_VEL_LANE_H - 6)));
        const x    = step * state.stepWidth + 1;
        const w    = Math.max(1, state.stepWidth - 2);
        const y    = _VEL_LANE_H - barH - 3;

        ctx2.fillStyle = `rgb(${Math.round(or*bright)},${Math.round(og*bright)},${Math.round(ob*bright)})`;
        ctx2.fillRect(x, y, w, barH);

        // Tope brillante (acento superior)
        ctx2.fillStyle = `rgba(${or},${og},${ob},${0.55 * dim})`;
        ctx2.fillRect(x, y, w, 2);
    }

    // En modo Shift+drag proporcional: línea horizontal en la velocity MEDIA
    // actual (el pivote del escalado). Las barras mantienen sus proporciones.
    if (_velAllMode && _velDragging) {
        const cells = Object.values(state.gridData.cells);
        if (cells.length) {
            const refVel = Math.round(cells.reduce((s, c) => s + (c.velocity || 0), 0) / cells.length);
            const refY   = _VEL_LANE_H - 3 - Math.round((refVel / 127) * (_VEL_LANE_H - 6));
            ctx2.save();
            ctx2.strokeStyle = 'rgba(255,220,0,0.85)';
            ctx2.lineWidth   = 1.5;
            ctx2.setLineDash([4, 3]);
            ctx2.beginPath();
            ctx2.moveTo(0, refY);
            ctx2.lineTo(velCanvas.width, refY);
            ctx2.stroke();
            ctx2.setLineDash([]);
            ctx2.fillStyle = 'rgba(255,220,0,0.9)';
            ctx2.font      = '9px monospace';
            ctx2.fillText(`${velGridToEsp32(refVel)}`, 3, refY - 2);  // mostrar en escala ESP32 1-100
            ctx2.restore();
        }
    }

    // Etiqueta: indica el alcance de la edición
    ctx2.fillStyle = frag ? '#ffd400' : (CT.label || '#666666');
    ctx2.font      = '9px monospace';
    ctx2.fillText(_velAllMode ? 'ALL' : (frag ? 'FRAG' : 'VEL'), 3, 10);
}

// ── Edición por arrastre ──────────────────────────────────────

function _velFromY(canvasY) {
    const clamped = Math.max(0, Math.min(_VEL_LANE_H - 6, canvasY));
    return Math.max(0, Math.min(127, Math.round((1 - clamped / (_VEL_LANE_H - 6)) * 127)));
}

function _stepsAtX(canvasX) {
    let step = Math.max(0, Math.min(state.totalSteps - 1, Math.floor(canvasX / state.stepWidth)));
    // Con fragmento activo, el arrastre se confina a su rango de pasos.
    const frag = _activeFragment();
    if (frag) step = Math.max(frag.startStep, Math.min(frag.endStep - 1, step));
    return step;
}

// Toma una foto de las velocities actuales y su media — pivote del escalado.
function _snapshotAllVelocities() {
    _velAllSnapshot = new Map();
    const frag = _activeFragment();
    let sum = 0, n = 0;
    for (const [key, cell] of Object.entries(state.gridData.cells)) {
        const [noteStr, stepStr] = key.split(',');
        if (!_cellInFragment(parseInt(noteStr), parseInt(stepStr), frag)) continue;
        const v = cell.velocity || 0;
        _velAllSnapshot.set(key, v);
        sum += v; n++;
    }
    _velAllRefVel = n > 0 ? sum / n : 0;
}

// Escala TODAS las notas proporcionalmente: la velocity de referencia (media
// original) se lleva a `targetVel`, y cada nota se mueve por el mismo factor,
// conservando sus diferencias relativas. Si la media original es 0 se aplica un
// desplazamiento plano (no hay proporción que preservar).
function _scaleAllVelocities(targetVel) {
    if (!_velAllSnapshot) return false;
    let changed = false;
    if (_velAllRefVel > 0) {
        const factor = targetVel / _velAllRefVel;
        for (const [key, orig] of _velAllSnapshot) {
            const cell = state.gridData.cells[key];
            if (!cell) continue;
            cell.velocity = _clampVelForKey(key, Math.round(orig * factor));
            changed = true;
        }
    } else {
        for (const key of _velAllSnapshot.keys()) {
            const cell = state.gridData.cells[key];
            if (!cell) continue;
            cell.velocity = _clampVelForKey(key, targetVel);
            changed = true;
        }
    }
    return changed;
}

// Acota una velocity (escala grid) al techo físico del motor que toca esa nota,
// para que ninguna edición masiva rebase el velMax parametrizado y fuerce el
// solenoide. El suelo es 0 (silencio permitido); el techo es velMaxGridForNote.
function _clampVelForKey(key, vel) {
    const note = parseInt(key.slice(0, key.indexOf(',')), 10);
    const hi   = velMaxGridForNote(note);
    return Math.max(0, Math.min(hi, vel));
}

function _editVelAtStep(step, vel) {
    const frag = _activeFragment();
    let changed = false;
    for (const [key, cell] of Object.entries(state.gridData.cells)) {
        const [noteStr, stepStr] = key.split(',');
        if (parseInt(stepStr) !== step) continue;
        if (!_cellInFragment(parseInt(noteStr), step, frag)) continue;
        cell.velocity = _clampVelForKey(key, vel);   // no rebasar el velMax del motor
        changed = true;
    }
    return changed;
}

function _onVelMouseDown(e) {
    e.preventDefault();
    historyPush();
    _velDragging = true;
    _velAllMode  = e.shiftKey;
    _velLastStep = -1;

    const velCanvas = document.getElementById('velocityLaneCanvas');
    const rect = velCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (velCanvas.width  / rect.width);
    const y = (e.clientY - rect.top)  * (velCanvas.height / rect.height);
    const vel = _velFromY(y);

    if (_velAllMode) {
        _snapshotAllVelocities();
        _scaleAllVelocities(vel);
        state.velEditStep = null;
    } else {
        const step = _stepsAtX(x);
        _velLastStep = step;
        _editVelAtStep(step, vel);
        state.velEditStep = step;   // glow en las celdas del paso editado
    }
    drawVelocityLane();
    drawPianoRollWithPlayhead(state.reproduciendo ? state.pasoActual : -1);
    tabMarkDirty();
}

function _onVelDocMouseMove(e) {
    if (!_velDragging) return;
    const velCanvas = document.getElementById('velocityLaneCanvas');
    if (!velCanvas) return;
    const rect = velCanvas.getBoundingClientRect();
    const x    = (e.clientX - rect.left) * (velCanvas.width  / rect.width);
    const y    = Math.max(0, e.clientY - rect.top) * (velCanvas.height / rect.height);
    const vel  = _velFromY(y);

    if (_velAllMode) {
        if (_scaleAllVelocities(vel)) {
            drawVelocityLane();
            drawPianoRollWithPlayhead(state.reproduciendo ? state.pasoActual : -1);
        }
        return;
    }

    const step = _stepsAtX(x);
    if (step === _velLastStep) return;
    _velLastStep = step;
    state.velEditStep = step;   // mover el glow al nuevo paso
    if (_editVelAtStep(step, vel)) {
        drawVelocityLane();
        drawPianoRollWithPlayhead(state.reproduciendo ? state.pasoActual : -1);
    }
}

function _onVelMouseUp() {
    if (!_velDragging) return;
    _velDragging = false;
    _velAllMode  = false;
    _velLastStep = -1;
    _velAllSnapshot = null;
    _velAllRefVel   = 0;
    state.velEditStep = null;   // apagar el glow de edición
    drawVelocityLane();         // elimina la línea guía amarilla
    drawPianoRollWithPlayhead(state.reproduciendo ? state.pasoActual : -1);  // borra el glow del grid
    tabMarkDirty();
}

// ── Inicialización ────────────────────────────────────────────

export function initVelocityLane() {
    const velCanvas = document.getElementById('velocityLaneCanvas');
    if (!velCanvas) return;
    velCanvas.addEventListener('mousedown', _onVelMouseDown);
    document.addEventListener('mousemove',  _onVelDocMouseMove);
    document.addEventListener('mouseup',    _onVelMouseUp);
}
