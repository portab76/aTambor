// ============================================================
// motor-escala-panel.js — Panel desplegable unificado Motor Map + Escala
// Extraído de midiGrid.js para que motor-map.js y transpose.js puedan
// abrir/cerrar el panel sin depender del entry point.
//
// El estado abierto/cerrado vive en state.motorEscalaPanelOpen.
// ============================================================

import { state } from './state.js';
import { _mmReleaseAllNotes, _renderMotorMapPanelRows } from './motor-map.js';
import { _sliderRange } from './transpose.js';

export function toggleMotorEscalaPanel() {
    const panel  = document.getElementById('motorEscalaPanel');
    const toggle = document.getElementById('motorMapToggle');
    const btn    = document.getElementById('motorEscalaBtn');
    if (!panel) return;

    state.motorEscalaPanelOpen = !state.motorEscalaPanelOpen;
    const open = state.motorEscalaPanelOpen;
    panel.classList.toggle('me-open', open);
    if (toggle) toggle.classList.toggle('me-open', open);
    if (btn)    btn.classList.toggle('btn-active', open);

    // Al cerrar el panel, liberar todos los motores activos por seguridad
    if (!open) _mmReleaseAllNotes();

    if (open) {
        // Refrescar ambas secciones al abrir
        _renderMotorMapPanelRows();
        const { min, max } = _sliderRange();
        const sl = document.getElementById('transposeSlider');
        if (sl) { sl.min = min; sl.max = max; }
        if (typeof window._tpSlider === 'function') window._tpSlider(state.transposeOffset || 0);
    }
}
