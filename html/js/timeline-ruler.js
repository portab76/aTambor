// ============================================================
// timeline-ruler.js — Regla de compases / tiempos tipo DAW
// Orientación musical sobre el piano roll: compás, tiempo,
// corchea. Playhead rojo sincronizado con la reproducción.
// Depende de: state.js
// ============================================================

const RULER_H = 34;   // altura total de la regla en px

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

    // ── Fondo ──────────────────────────────────────────────
    rc.fillStyle = '#0d0d1c';
    rc.fillRect(0, 0, W, RULER_H);

    // ── Línea inferior de separación ───────────────────────
    rc.strokeStyle = '#4a4a7a';
    rc.lineWidth   = 1;
    rc.beginPath();
    rc.moveTo(0, RULER_H - 0.5);
    rc.lineTo(W, RULER_H - 0.5);
    rc.stroke();

    const spm = currentTimeSig.stepsPerMeasure;  // pasos por compás (ej: 16 en 4/4, 12 en 3/4)
    const spb = currentTimeSig.stepsPerBeat;     // pasos por tiempo (ej: 4 para negra, 2 para corchea)
    // Tiempo "central" del compás (fuerte secundario). En 4/4 es el 3; en 3/4 no existe.
    const midBeat = (currentTimeSig.numerator > 2) ? Math.floor(spm / 2) : -1;

    for (let step = 0; step <= totalSteps; step++) {
        const x = step * stepWidth;

        const isMeasure = step % spm === 0;
        const isMidBeat = midBeat > 0 && step % spm === midBeat;  // tiempo 3 en 4/4, etc.
        const isBeat    = step % spb === 0;
        const isEighth  = step % 2  === 0;

        // ── Ticks verticales — jerarquía musical ───────────
        if (isMeasure) {
            // Barra de compás: altura completa, color claro
            rc.strokeStyle = '#9090cc';
            rc.lineWidth   = 1.5;
            rc.beginPath();
            rc.moveTo(x + 0.5, 0);
            rc.lineTo(x + 0.5, RULER_H);
            rc.stroke();

        } else if (isMidBeat) {
            // Tiempo central (ej: T3 en 4/4): 60% desde abajo, lila medio
            rc.strokeStyle = '#555577';
            rc.lineWidth   = 1;
            rc.beginPath();
            rc.moveTo(x + 0.5, RULER_H * 0.40);
            rc.lineTo(x + 0.5, RULER_H - 1);
            rc.stroke();

        } else if (isBeat) {
            // Tiempos 2 y 4: 40% desde abajo, gris oscuro
            rc.strokeStyle = '#3d3d5a';
            rc.lineWidth   = 1;
            rc.beginPath();
            rc.moveTo(x + 0.5, RULER_H * 0.60);
            rc.lineTo(x + 0.5, RULER_H - 1);
            rc.stroke();

        } else if (isEighth && stepWidth >= 20) {
            // Corcheas: 20% desde abajo, casi invisible
            rc.strokeStyle = '#252538';
            rc.lineWidth   = 1;
            rc.beginPath();
            rc.moveTo(x + 0.5, RULER_H * 0.82);
            rc.lineTo(x + 0.5, RULER_H - 1);
            rc.stroke();
        }

        // ── Texto — números de compás y tiempos ────────────
        if (isMeasure && x + 3 < W) {
            const measure = Math.floor(step / spm) + 1;
            rc.fillStyle  = '#c4c4ff';
            rc.font       = 'bold 11px "Segoe UI", monospace';
            rc.fillText(String(measure), x + 4, 13);
        }

        // Números de tiempo (2…N) en la franja inferior
        if (isBeat && !isMeasure && stepWidth >= 14) {
            const beatNum = (Math.floor(step / spb) % currentTimeSig.numerator) + 1;
            rc.fillStyle  = isMidBeat ? '#6060a0' : '#40405a';
            rc.font       = '9px monospace';
            rc.fillText(String(beatNum), x + 2, RULER_H - 5);
        }
    }

    // ── Franja A-B ─────────────────────────────────────────
    if (typeof loopAB !== 'undefined' && loopAB && loopA >= 0 && loopB > loopA) {
        const xA = loopA * stepWidth;
        const xB = Math.min(loopB * stepWidth, W);
        rc.fillStyle = 'rgba(80,200,120,0.13)';
        rc.fillRect(xA, 0, xB - xA, RULER_H);
    }

    // ── Marcadores A y B ───────────────────────────────────
    function _drawMarker(step, color, label) {
        if (step < 0 || step > totalSteps) return;
        const x = step * stepWidth;
        // Triángulo apuntando hacia abajo en la parte superior
        rc.fillStyle = color;
        rc.beginPath();
        rc.moveTo(x - 5, 0);
        rc.lineTo(x + 5, 0);
        rc.lineTo(x,     9);
        rc.closePath();
        rc.fill();
        // Línea vertical
        rc.strokeStyle = color;
        rc.lineWidth   = 1.5;
        rc.beginPath();
        rc.moveTo(x + 0.5, 0);
        rc.lineTo(x + 0.5, RULER_H);
        rc.stroke();
        rc.lineWidth = 1;
        // Etiqueta
        rc.fillStyle = color;
        rc.font      = 'bold 9px monospace';
        rc.textAlign = 'left';
        rc.fillText(label, x + 3, RULER_H - 4);
    }

    if (typeof loopA !== 'undefined' && loopA >= 0) _drawMarker(loopA, '#ffaa00', 'A');
    if (typeof loopB !== 'undefined' && loopB >= 0) _drawMarker(loopB, '#44ddaa', 'B');

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

function _rulerStepFromEvent(e, area) {
    const rect = area.getBoundingClientRect();
    const x    = e.clientX - rect.left + area.scrollLeft;
    return { x, step: Math.max(0, Math.min(totalSteps - 1, Math.floor(x / stepWidth))) };
}

function initRulerSeek() {
    const area = document.getElementById('rulerScrollArea');
    if (!area) return;

    // ── Mousemove: hover cursor + preview de drag ─────────────
    area.addEventListener('mousemove', function (e) {
        if (!totalSteps || !stepWidth) return;
        const { x, step } = _rulerStepFromEvent(e, area);

        if (_abDragging) {
            _abDragPreviewStep = step;
            _abDragMoved       = true;
            _updateAbDragLine(x);
            drawTimelineRuler();
            return;
        }

        // Cambiar cursor si se está sobre un marcador A o B
        if (loopAB) {
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
        if (!loopAB || !totalSteps || !stepWidth) return;
        const { x } = _rulerStepFromEvent(e, area);
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

    // ── Click: colocar A/B o hacer seek ──────────────────────
    area.addEventListener('click', function (e) {
        if (_abDragMoved) { _abDragMoved = false; return; }   // ignorar si fue drag
        if (!totalSteps || !stepWidth) return;
        const { step } = _rulerStepFromEvent(e, area);

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
