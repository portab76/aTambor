// ============================================================
// timeline-ruler.js — Regla de compases / tiempos tipo DAW
// Orientación musical sobre el piano roll: compás, tiempo,
// corchea. Playhead rojo sincronizado con la reproducción.
// Depende de: state.js
// ============================================================

const SECTION_H = 16;             // franja de marcadores de sección (parte superior)
const RULER_H   = 34 + SECTION_H; // altura total del canvas de regla en px
const _SECTION_COLORS = ['#ff6688','#66aaff','#66ffcc','#ffaa44','#cc88ff','#44ddff','#ffdd55'];

/**
 * Dibuja la regla completa sobre el canvas #timelineRulerCanvas.
 * Llamar después de buildGridFromChannel() cuando totalSteps y stepWidth estén listos.
 */
function drawTimelineRuler() {
    const canvas = document.getElementById('timelineRulerCanvas');
    if (!canvas || !totalSteps || !stepWidth) return;

    const W = totalSteps * stepWidth;
    canvas.width  = W;
    canvas.height = RULER_H;

    const rc = canvas.getContext('2d');
    const RH = RULER_H - SECTION_H;  // altura neta de la sección de compases

    // ── Fondo total ────────────────────────────────────────
    rc.fillStyle = '#0d0d1c';
    rc.fillRect(0, 0, W, RULER_H);

    // ── Franja de marcadores de sección (0..SECTION_H) ────
    rc.fillStyle = '#0a0a1a';
    rc.fillRect(0, 0, W, SECTION_H);
    rc.strokeStyle = '#2a2a44';
    rc.lineWidth   = 1;
    rc.beginPath();
    rc.moveTo(0, SECTION_H - 0.5);
    rc.lineTo(W, SECTION_H - 0.5);
    rc.stroke();

    if (typeof sectionMarkers !== 'undefined' && sectionMarkers.length) {
        rc.font = 'bold 9px "Segoe UI", monospace';
        for (const sm of sectionMarkers) {
            if (sm.step < 0 || sm.step > totalSteps) continue;
            const x     = Math.round(sm.step * stepWidth);
            const color = sm.color || '#aaaaff';
            // Línea vertical
            rc.strokeStyle = color;
            rc.lineWidth   = 1.5;
            rc.beginPath();
            rc.moveTo(x + 0.5, 0);
            rc.lineTo(x + 0.5, SECTION_H - 1);
            rc.stroke();
            // Triángulo ▼
            rc.fillStyle = color;
            rc.beginPath();
            rc.moveTo(x - 4, 0); rc.lineTo(x + 4, 0); rc.lineTo(x, 6);
            rc.closePath(); rc.fill();
            // Label chip
            rc.textAlign = 'left';
            const tw = rc.measureText(sm.label).width + 6;
            rc.fillStyle = color + '22';
            rc.fillRect(x + 2, 1, tw, SECTION_H - 3);
            rc.fillStyle = color;
            rc.fillText(sm.label, x + 5, SECTION_H - 4);
        }
    }

    // ── Línea inferior de separación ───────────────────────
    rc.strokeStyle = '#4a4a7a';
    rc.lineWidth   = 1;
    rc.beginPath();
    rc.moveTo(0, RULER_H - 0.5);
    rc.lineTo(W, RULER_H - 0.5);
    rc.stroke();

    const spm     = currentTimeSig.stepsPerMeasure;
    const spb     = currentTimeSig.stepsPerBeat;
    const midBeat = (currentTimeSig.numerator > 2) ? Math.floor(spm / 2) : -1;

    for (let step = 0; step <= totalSteps; step++) {
        const x = step * stepWidth;

        const isMeasure = step % spm === 0;
        const isMidBeat = midBeat > 0 && step % spm === midBeat;
        const isBeat    = step % spb === 0;
        const isEighth  = step % 2  === 0;

        // ── Ticks verticales — jerarquía musical ───────────
        if (isMeasure) {
            rc.strokeStyle = '#9090cc';
            rc.lineWidth   = 1.5;
            rc.beginPath();
            rc.moveTo(x + 0.5, SECTION_H);
            rc.lineTo(x + 0.5, RULER_H);
            rc.stroke();

        } else if (isMidBeat) {
            rc.strokeStyle = '#555577';
            rc.lineWidth   = 1;
            rc.beginPath();
            rc.moveTo(x + 0.5, SECTION_H + RH * 0.40);
            rc.lineTo(x + 0.5, RULER_H - 1);
            rc.stroke();

        } else if (isBeat) {
            rc.strokeStyle = '#3d3d5a';
            rc.lineWidth   = 1;
            rc.beginPath();
            rc.moveTo(x + 0.5, SECTION_H + RH * 0.60);
            rc.lineTo(x + 0.5, RULER_H - 1);
            rc.stroke();

        } else if (isEighth && stepWidth >= 20) {
            rc.strokeStyle = '#252538';
            rc.lineWidth   = 1;
            rc.beginPath();
            rc.moveTo(x + 0.5, SECTION_H + RH * 0.82);
            rc.lineTo(x + 0.5, RULER_H - 1);
            rc.stroke();
        }

        // ── Texto — números de compás y tiempos ────────────
        if (isMeasure && x + 3 < W) {
            const measure = Math.floor(step / spm) + 1;
            rc.fillStyle  = '#c4c4ff';
            rc.font       = 'bold 11px "Segoe UI", monospace';
            rc.textAlign  = 'left';
            rc.fillText(String(measure), x + 4, SECTION_H + 13);
        }

        if (isBeat && !isMeasure && stepWidth >= 14) {
            const beatNum = (Math.floor(step / spb) % currentTimeSig.numerator) + 1;
            rc.fillStyle  = isMidBeat ? '#6060a0' : '#40405a';
            rc.font       = '9px monospace';
            rc.textAlign  = 'left';
            rc.fillText(String(beatNum), x + 2, RULER_H - 5);
        }
    }

    // ── Franja A-B ─────────────────────────────────────────
    if (typeof loopAB !== 'undefined' && loopAB && loopA >= 0 && loopB > loopA) {
        const xA = loopA * stepWidth;
        const xB = Math.min(loopB * stepWidth, W);
        rc.fillStyle = 'rgba(80,200,120,0.13)';
        rc.fillRect(xA, SECTION_H, xB - xA, RH);
    }

    // ── Marcadores A y B ───────────────────────────────────
    function _drawMarker(step, color, label) {
        if (step < 0 || step > totalSteps) return;
        const x = step * stepWidth;
        rc.fillStyle = color;
        rc.beginPath();
        rc.moveTo(x - 5, SECTION_H);
        rc.lineTo(x + 5, SECTION_H);
        rc.lineTo(x,     SECTION_H + 9);
        rc.closePath();
        rc.fill();
        rc.strokeStyle = color;
        rc.lineWidth   = 1.5;
        rc.beginPath();
        rc.moveTo(x + 0.5, SECTION_H);
        rc.lineTo(x + 0.5, RULER_H);
        rc.stroke();
        rc.lineWidth = 1;
        rc.fillStyle = color;
        rc.font      = 'bold 9px monospace';
        rc.textAlign = 'left';
        rc.fillText(label, x + 3, RULER_H - 4);
    }

    if (typeof loopA !== 'undefined' && loopA >= 0) _drawMarker(loopA, '#ffaa00', 'A');
    if (typeof loopB !== 'undefined' && loopB >= 0) _drawMarker(loopB, '#44ddaa', 'B');

    // ── Marcadores de tempo ────────────────────────────────────
    if (typeof tempoPoints !== 'undefined' && tempoPoints.length) {
        rc.font = 'bold 8px monospace';
        for (let i = 0; i < tempoPoints.length; i++) {
            const tp = tempoPoints[i];
            if (tp.step > totalSteps) continue;
            const x = Math.round(tp.step * stepWidth);

            if (i > 0) {
                rc.strokeStyle = tempoEditMode ? '#ff9900' : '#885500';
                rc.lineWidth   = 1.5;
                rc.setLineDash([3, 2]);
                rc.beginPath();
                rc.moveTo(x + 0.5, SECTION_H);
                rc.lineTo(x + 0.5, RULER_H);
                rc.stroke();
                rc.setLineDash([]);
            }

            const label = `♩${Math.round(tp.bpm)}`;
            const tw    = rc.measureText(label).width + 6;
            const fh    = 13;
            const fx    = i === 0 ? 2 : x + 2;
            rc.fillStyle = tempoEditMode ? '#cc6600' : '#664400';
            rc.fillRect(fx, RULER_H - fh, tw, fh);
            rc.fillStyle = '#ffddaa';
            rc.textAlign = 'left';
            rc.fillText(label, fx + 3, RULER_H - 2);
        }
    }

    // ── Línea de preview durante drag de marcador ──────────────
    if (typeof _abDragPreviewStep !== 'undefined' && _abDragPreviewStep >= 0) {
        const xP = _abDragPreviewStep * stepWidth;
        rc.save();
        rc.strokeStyle = '#ffff00';
        rc.lineWidth   = 2;
        rc.setLineDash([4, 3]);
        rc.beginPath();
        rc.moveTo(xP + 0.5, 0);
        rc.lineTo(xP + 0.5, RULER_H);
        rc.stroke();
        rc.restore();
    }

    // Sincronizar playhead con posición actual
    updateRulerPlayhead(typeof pasoActual !== 'undefined' ? pasoActual : -1);

    // Actualizar minimap
    if (typeof drawMinimap === 'function') drawMinimap();
}

/**
 * Registra el listener de click en la regla para hacer seek.
 * Llamar una sola vez tras crear el canvas (al cargar la página).
 */
// _abNextClick: 'A' → siguiente click pone loopA; 'B' → pone loopB
let _abNextClick      = 'A';
let _abDragging       = null;   // 'A' | 'B' | null — marcador que se está arrastrando
let _abDragPreviewStep = -1;    // paso de la línea de preview amarilla
let _abDragMoved      = false;  // true si hubo movimiento real durante el drag

// ── Estado de edición de tempo ─────────────────────────────
let tempoEditMode   = false;
let _tempoDragging  = null;   // índice en tempoPoints del punto que se arrastra
let _tempoDragMoved = false;

function _rulerStepFromEvent(e, area) {
    const rect = area.getBoundingClientRect();
    const x    = e.clientX - rect.left + area.scrollLeft;
    return { x, step: Math.max(0, Math.min(totalSteps - 1, Math.floor(x / stepWidth))) };
}

function toggleTempoEditMode() {
    tempoEditMode = !tempoEditMode;
    const btn = document.getElementById('tempoEditBtn');
    if (btn) {
        btn.classList.toggle('btn-active', tempoEditMode);
        btn.textContent = tempoEditMode ? '♩ Editando' : '♩ Tempo';
    }
    drawTimelineRuler();
    if (typeof statusSpan !== 'undefined') {
        statusSpan.innerText = tempoEditMode
            ? 'Tempo: clic para añadir/editar · arrastra para mover · clic derecho para borrar'
            : 'Modo edición de tempo desactivado';
    }
}

function initRulerSeek() {
    const area = document.getElementById('rulerScrollArea');
    if (!area) return;

    // ── Mousemove: hover cursor + preview de drag ─────────────
    area.addEventListener('mousemove', function (e) {
        if (!totalSteps || !stepWidth) return;
        const { x, step } = _rulerStepFromEvent(e, area);

        // Drag de punto de tempo
        if (_tempoDragging !== null) {
            tempoPoints[_tempoDragging].step = Math.max(1, step);
            _tempoDragMoved = true;
            drawTimelineRuler();
            return;
        }

        if (_abDragging) {
            _abDragPreviewStep = step;
            _abDragMoved       = true;
            _updateAbDragLine(x);
            drawTimelineRuler();
            return;
        }

        // Cambiar cursor según modo
        if (tempoEditMode) {
            const HIT = Math.max(8, stepWidth * 0.4);
            let near = false;
            for (let i = 1; i < tempoPoints.length; i++) {
                if (Math.abs(x - tempoPoints[i].step * stepWidth) <= HIT) { near = true; break; }
            }
            area.style.cursor = near ? 'ew-resize' : 'crosshair';
        } else if (loopAB) {
            const HIT = Math.max(8, stepWidth * 0.4);
            const nearA = loopA >= 0 && Math.abs(x - loopA * stepWidth) <= HIT;
            const nearB = loopB >= 0 && Math.abs(x - loopB * stepWidth) <= HIT;
            area.style.cursor = (nearA || nearB) ? 'pointer' : 'default';
        } else {
            area.style.cursor = 'default';
        }
    });

    // ── Mousedown: iniciar drag de marcador ──────────────────
    area.addEventListener('mousedown', function (e) {
        if (!totalSteps || !stepWidth) return;
        const { x } = _rulerStepFromEvent(e, area);

        // En modo tempo: iniciar drag de punto (i>0; el punto inicial no se mueve)
        if (tempoEditMode) {
            const HIT = Math.max(8, stepWidth * 0.4);
            for (let i = 1; i < tempoPoints.length; i++) {
                if (Math.abs(x - tempoPoints[i].step * stepWidth) <= HIT) {
                    _tempoDragging  = i;
                    _tempoDragMoved = false;
                    e.preventDefault();
                    return;
                }
            }
            return;  // en modo tempo el mousedown sobre espacio vacío no hace nada
        }

        if (!loopAB) return;
        const HIT   = Math.max(8, stepWidth * 0.4);
        const nearA = loopA >= 0 && Math.abs(x - loopA * stepWidth) <= HIT;
        const nearB = loopB >= 0 && Math.abs(x - loopB * stepWidth) <= HIT;
        if (nearA || nearB) {
            _abDragging        = nearB ? 'B' : 'A';  // B tiene prioridad si coinciden
            _abDragPreviewStep = nearB ? loopB : loopA;
            _abDragMoved       = false;
            e.preventDefault();
        }
    });

    // ── Mouseup en document: soltar marcador ─────────────────
    document.addEventListener('mouseup', function (e) {
        // Soltar punto de tempo
        if (_tempoDragging !== null) {
            tempoPoints.sort((a, b) => a.step - b.step);
            if (tempoPoints[0].step !== 0) tempoPoints.unshift({ step: 0, bpm: tempoPoints[0].bpm });
            _tempoDragging = null;
            drawTimelineRuler();
            return;
        }

        if (!_abDragging) return;
        const { step } = _rulerStepFromEvent(e, area);

        if (_abDragging === 'A') {
            loopA = step;
            if (loopB >= 0 && loopB <= loopA) loopB = -1;
        } else {
            loopB = step > loopA ? step : -1;
        }

        _abDragging        = null;
        _abDragPreviewStep = -1;
        _hideAbDragLine();
        drawTimelineRuler();
        _updateAbBtn();
    });

    // ── Click: añadir/editar tempo, colocar A/B, o hacer seek ─
    area.addEventListener('click', function (e) {
        if (!totalSteps || !stepWidth) return;
        const { x, step } = _rulerStepFromEvent(e, area);

        // Shift+click (modo normal): añadir o editar marcador de sección
        if (e.shiftKey && !tempoEditMode) {
            const HIT = Math.max(8, stepWidth * 0.4);
            const idx = typeof sectionMarkers !== 'undefined'
                ? sectionMarkers.findIndex(sm => Math.abs(x - sm.step * stepWidth) <= HIT)
                : -1;
            if (idx >= 0) {
                const newLabel = prompt('Nombre del marcador:', sectionMarkers[idx].label);
                if (newLabel !== null && newLabel.trim()) {
                    sectionMarkers[idx].label = newLabel.trim();
                    drawTimelineRuler();
                }
            } else {
                const newLabel = prompt('Marcador de sección (Intro, Verso, Coro…):', '');
                if (newLabel !== null && newLabel.trim()) {
                    const color = _SECTION_COLORS[sectionMarkers.length % _SECTION_COLORS.length];
                    sectionMarkers.push({ step, label: newLabel.trim(), color });
                    sectionMarkers.sort((a, b) => a.step - b.step);
                    drawTimelineRuler();
                }
            }
            return;
        }

        // Modo tempo: editar punto existente o añadir nuevo
        if (tempoEditMode) {
            if (_tempoDragMoved) { _tempoDragMoved = false; return; }
            const HIT = Math.max(8, stepWidth * 0.4);
            let hitIdx = -1;
            for (let i = 0; i < tempoPoints.length; i++) {
                if (Math.abs(x - tempoPoints[i].step * stepWidth) <= HIT) { hitIdx = i; break; }
            }
            if (hitIdx >= 0) {
                // Editar BPM del punto existente
                const cur   = Math.round(tempoPoints[hitIdx].bpm);
                const input = prompt(`BPM en paso ${tempoPoints[hitIdx].step}:`, cur);
                if (input === null) return;
                const bpm = Math.max(20, Math.min(400, parseFloat(input)));
                if (!isNaN(bpm)) {
                    tempoPoints[hitIdx].bpm = bpm;
                    if (hitIdx === 0) {
                        const bpmEl = document.getElementById('bpmInput');
                        if (bpmEl) bpmEl.value = Math.round(bpm);
                    }
                    drawTimelineRuler();
                }
            } else {
                // Añadir nuevo punto de tempo
                const cur   = Math.round(typeof _bpmAtStep === 'function' ? _bpmAtStep(step) : 120);
                const input = prompt(`Nuevo punto de tempo en paso ${step} (BPM):`, cur);
                if (input === null) return;
                const bpm = Math.max(20, Math.min(400, parseFloat(input)));
                if (!isNaN(bpm)) {
                    const existing = tempoPoints.findIndex(tp => tp.step === step);
                    if (existing >= 0) {
                        tempoPoints[existing].bpm = bpm;
                    } else {
                        tempoPoints.push({ step, bpm });
                        tempoPoints.sort((a, b) => a.step - b.step);
                    }
                    drawTimelineRuler();
                }
            }
            return;
        }

        if (_abDragMoved) { _abDragMoved = false; return; }   // ignorar si fue drag

        if (typeof loopAB !== 'undefined' && loopAB) {
            if (_abNextClick === 'A') {
                loopA        = step;
                loopB        = -1;
                _abNextClick = 'B';
            } else {
                if (step > loopA) {
                    loopB = step;
                } else {
                    loopA = step;
                    loopB = -1;
                }
                _abNextClick = 'A';
            }
            drawTimelineRuler();
            _updateAbBtn();
        } else {
            if (typeof seekToStep === 'function') seekToStep(step);
        }
    });

    // ── Contextmenu: eliminar punto de tempo o marcador de sección ──
    area.addEventListener('contextmenu', function (e) {
        if (!totalSteps || !stepWidth) return;
        const { x } = _rulerStepFromEvent(e, area);
        const HIT = Math.max(8, stepWidth * 0.4);

        if (tempoEditMode) {
            e.preventDefault();
            for (let i = 1; i < tempoPoints.length; i++) {
                if (Math.abs(x - tempoPoints[i].step * stepWidth) <= HIT) {
                    if (confirm(`¿Eliminar punto ♩${Math.round(tempoPoints[i].bpm)} en paso ${tempoPoints[i].step}?`)) {
                        tempoPoints.splice(i, 1);
                        drawTimelineRuler();
                    }
                    return;
                }
            }
            return;
        }

        // Modo normal: eliminar marcador de sección
        if (typeof sectionMarkers !== 'undefined') {
            const idx = sectionMarkers.findIndex(sm => Math.abs(x - sm.step * stepWidth) <= HIT);
            if (idx >= 0) {
                e.preventDefault();
                if (confirm(`¿Eliminar marcador "${sectionMarkers[idx].label}"?`)) {
                    sectionMarkers.splice(idx, 1);
                    drawTimelineRuler();
                }
            }
        }
    });

    area.style.cursor = 'pointer';
}

function _updateAbDragLine(clientX) {
    const line = document.getElementById('abDragLine');
    if (!line || !stepWidth) return;
    // clientX es la posición relativa al rulerScrollArea; el gridScroll tiene el mismo scroll
    const gridScroll = document.getElementById('gridScroll');
    const rulerArea  = document.getElementById('rulerScrollArea');
    if (!gridScroll || !rulerArea) return;
    // Posición relativa al contenido del grid (no al viewport)
    const scrollOffset = rulerArea.scrollLeft;
    const rulerRect    = rulerArea.getBoundingClientRect();
    const xInContent   = clientX - rulerRect.left + scrollOffset;
    line.style.left    = (xInContent - 1) + 'px';
    line.style.display = 'block';
}

function _hideAbDragLine() {
    const line = document.getElementById('abDragLine');
    if (line) line.style.display = 'none';
}

function _updateAbBtn() {
    const btn = document.getElementById('abLoopBtn');
    if (!btn) return;
    if (loopAB) {
        const hasRange = loopA >= 0 && loopB > loopA;
        btn.classList.add('btn-active');
        btn.textContent = hasRange
            ? `▶ A→B`
            : (loopA >= 0 ? 'A→ …B' : '→A');
    } else {
        btn.classList.remove('btn-active');
        btn.textContent = 'A→B';
    }
    if (typeof _updateFragmentButtons === 'function') _updateFragmentButtons();
}

function toggleLoopAB() {
    loopAB = !loopAB;
    if (!loopAB) {
        // Al desactivar, limpiar rango y redibujar
        loopA = loopB = -1;
        _abNextClick = 'A';
        drawTimelineRuler();
    } else {
        _abNextClick = 'A';
    }
    _updateAbBtn();
    if (typeof statusSpan !== 'undefined')
        statusSpan.innerText = loopAB ? 'Loop A-B: clic en regla para marcar inicio (A)' : 'Loop A-B desactivado';
}

/**
 * Mueve el playhead (aguja roja) a la posición del paso indicado.
 * Llamar en cada tick de reproducción y en stop() (paso = -1 para ocultar).
 * @param {number} step  — paso actual (−1 = ocultar)
 */
function updateRulerPlayhead(step) {
    const ph = document.getElementById('timelinePlayhead');
    if (!ph) return;
    if (step < 0 || !totalSteps || !stepWidth) {
        ph.style.display = 'none';
        return;
    }
    ph.style.left    = (step * stepWidth) + 'px';
    ph.style.display = 'block';
}
