// ============================================================
// minimap.js — Minimap panorámico
// Vista comprimida de la pieza completa con rectángulo de
// viewport arrastrable para navegar. Depende de: state.js
// ============================================================

import { state } from './state.js';

const MINIMAP_H = 28;

export function drawMinimap() {
    const canvas = document.getElementById('minimapCanvas');
    if (!canvas) return;

    const W = canvas.offsetWidth;
    if (W <= 0) return;
    canvas.width  = W;
    canvas.height = MINIMAP_H;

    const mc = canvas.getContext('2d');

    // Paleta del tema (claro/oscuro); fallback al tema oscuro.
    const CT      = window.CANVAS_THEME || {};
    const deepBg  = CT.deepBg   || '#07071a';
    const deepLn  = CT.deepLine || '#1a1a3a';

    // ── Fondo ──────────────────────────────────────────────
    mc.fillStyle = deepBg;
    mc.fillRect(0, 0, W, MINIMAP_H);

    if (!state.totalSteps || !state.stepWidth) {
        mc.strokeStyle = deepLn;
        mc.lineWidth   = 1;
        mc.strokeRect(0.5, 0.5, W - 1, MINIMAP_H - 1);
        return;
    }

    const scale = W / state.totalSteps;   // px por paso en el minimap

    // ── Notas ──────────────────────────────────────────────
    const OCTAVE_COLORS = ['#cc5555','#cc8844','#aaaa44','#44aa66','#4488cc','#6655bb','#aa44aa'];
    if (state.noteRows.length > 0 && Object.keys(state.gridData.cells).length > 0) {
        const noteMin   = state.noteRows[0];
        const noteMax   = state.noteRows[state.noteRows.length - 1];
        const noteRange = Math.max(noteMax - noteMin, 1);
        const noteArea  = MINIMAP_H - 6;

        for (const key of Object.keys(state.gridData.cells)) {
            const [noteStr, stepStr] = key.split(',');
            const note     = parseInt(noteStr);
            const step     = parseInt(stepStr);
            const duration = state.gridData.cells[key].duration;

            const nx = step * scale;
            const nw = Math.max(1, duration * scale);
            const ny = 3 + noteArea - Math.round(((note - noteMin) / noteRange) * noteArea);

            mc.fillStyle = OCTAVE_COLORS[Math.floor(note / 12) % OCTAVE_COLORS.length];
            mc.fillRect(nx, ny, nw, 2);
        }
    }

    // ── Marcadores de sección ──────────────────────────────
    if (state.sectionMarkers && state.sectionMarkers.length) {
        mc.font = '7px monospace';
        for (const sm of state.sectionMarkers) {
            const x = Math.round(sm.step * scale);
            mc.strokeStyle = sm.color || '#aaaaff';
            mc.lineWidth   = 1;
            mc.beginPath();
            mc.moveTo(x + 0.5, 0);
            mc.lineTo(x + 0.5, MINIMAP_H);
            mc.stroke();
            mc.fillStyle = sm.color || '#aaaaff';
            mc.textAlign = 'left';
            mc.fillText(sm.label, x + 2, 8);
        }
    }

    // ── Playhead ────────────────────────────────────────────
    if (state.pasoActual >= 0 && state.reproduciendo) {
        const px = Math.round(state.pasoActual * scale);
        mc.strokeStyle = '#ff4444';
        mc.lineWidth   = 1.5;
        mc.beginPath();
        mc.moveTo(px + 0.5, 0);
        mc.lineTo(px + 0.5, MINIMAP_H);
        mc.stroke();
    }

    // ── Rectángulo de viewport ──────────────────────────────
    const gs = document.getElementById('gridScroll');
    if (gs && state.stepWidth) {
        const vLeft  = (gs.scrollLeft  / state.stepWidth) * scale;
        const vWidth = (gs.clientWidth / state.stepWidth) * scale;
        mc.fillStyle   = 'rgba(200,200,255,0.08)';
        mc.fillRect(vLeft, 0, vWidth, MINIMAP_H);
        mc.strokeStyle = 'rgba(200,200,255,0.45)';
        mc.lineWidth   = 1;
        mc.strokeRect(vLeft + 0.5, 0.5, vWidth - 1, MINIMAP_H - 1);
    }

    // ── Borde inferior ──────────────────────────────────────
    mc.strokeStyle = deepLn;
    mc.lineWidth   = 1;
    mc.beginPath();
    mc.moveTo(0, MINIMAP_H - 0.5);
    mc.lineTo(W, MINIMAP_H - 0.5);
    mc.stroke();
}

// ── Arrastre del minimap para navegar ───────────────────
let _minimapDragging = false;

export function initMinimap() {
    const canvas = document.getElementById('minimapCanvas');
    if (!canvas) return;

    canvas.addEventListener('mousedown', function (e) {
        _minimapDragging = true;
        _minimapScrollTo(e);
        e.preventDefault();
    });

    document.addEventListener('mousemove', function (e) {
        if (!_minimapDragging) return;
        _minimapScrollTo(e);
    });

    document.addEventListener('mouseup', function () {
        _minimapDragging = false;
    });

    canvas.style.cursor = 'pointer';
}

function _minimapScrollTo(e) {
    const canvas = document.getElementById('minimapCanvas');
    const gs     = document.getElementById('gridScroll');
    if (!canvas || !gs || !state.totalSteps || !state.stepWidth) return;

    const rect      = canvas.getBoundingClientRect();
    const xFrac     = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetStep = xFrac * state.totalSteps;
    gs.scrollLeft    = Math.max(0, targetStep * state.stepWidth - gs.clientWidth / 2);

    // Sincronizar ruler
    const rulerArea = document.getElementById('rulerScrollArea');
    if (rulerArea) rulerArea.scrollLeft = gs.scrollLeft;

    drawMinimap();
}
