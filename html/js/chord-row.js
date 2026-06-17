// ============================================================
// chord-row.js — Renderizado de la fila de acordes + popup de info armónica
// Depende de: state.js, harmonic.js, piano-roll.js
// ============================================================

import { state } from './state.js';
import { findChord, getChordFunction, detectInversion } from './harmonic.js';
import { drawPianoRollWithPlayhead, drawPianoRollWithHighlight } from './piano-roll.js';
import { updateRulerPlayhead, _updateAbBtn, drawTimelineRuler } from './timeline-ruler.js';
import { play, stop } from './playback.js';
import { MOTOR_MAP } from './motor-map.js';
import { sendCommand } from './ws-connector.js';

// Segmentos por lote: equilibrio entre gap de reset y acumulación de drift I2C
export const BATCH_SIZE = 5;


const _NOTE_NAMES_CR = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

// Bloque de la chord-row actualmente resaltado
let _activeChordBlock = null;

// Índice del segmento centrado en el panel de acordes (-1 = sin selección)
let _chordPanelIndex = -1;

// Ancho mínimo de cada columna del panel (px) — adaptativo al ancho disponible
const _CHORD_COL_MIN_W = 200;

// Key handler activo para atajo Enter en el panel
let _panelKeyHandler = null;

// ─────────────────────────────────────────────
// Helper: extrae metadatos de un segmento
// (evita duplicar la misma lógica en drawChordRow, _renderChordPanel, etc.)
// ─────────────────────────────────────────────
function _chordMeta(seg) {
    const isPhrase = Array.isArray(seg.degrees);
    let chordName, chordFunc, chord;
    if (isPhrase) {
        chordName = seg.chordDisplay || '?';
        chordFunc = seg.cadenceType  || '';
        chord     = seg.chord        || null;
    } else if (seg.chordDisplay) {
        chordName = seg.chordDisplay;
        chordFunc = seg.chordFunction || '';
        chord     = seg.chord        || null;
    } else {
        const nc  = [...new Set(seg.activeNotes.map(n => n % 12))].sort((a, b) => a - b);
        chord     = findChord(nc, seg.activeNotes[0] || null);
        chordName = chord.name;
        chordFunc = state.currentKey ? getChordFunction(chord, state.currentKey) : '';
    }
    return { isPhrase, chordName, chordFunc, chord };
}

// ─────────────────────────────────────────────
// Toggle del panel de acordes
// ─────────────────────────────────────────────
export function toggleChordPanel() {
    const panel = document.getElementById('chordPanel');
    const btn   = document.getElementById('chordPanelBtn');
    if (!panel) return;
    const isOpen = panel.classList.toggle('open');
    if (btn) btn.classList.toggle('btn-active', isOpen);
    if (isOpen) {
        if (_chordPanelIndex >= 0) _renderChordPanel(_chordPanelIndex);
        if (!_panelKeyHandler) {
            _panelKeyHandler = (e) => {
                if (e.key === 'Enter') { e.preventDefault(); _playAndAdvance(); }
            };
            document.addEventListener('keydown', _panelKeyHandler);
        }
    } else {
        state.autoAdvanceActive = false;
        state.activeHighlight   = null;
        if (_panelKeyHandler) {
            document.removeEventListener('keydown', _panelKeyHandler);
            _panelKeyHandler = null;
        }
        drawPianoRollWithPlayhead(state.reproduciendo ? state.pasoActual : -1);
    }
}

function _highlightChordBlock(segIndex) {
    if (_activeChordBlock) {
        _activeChordBlock.style.boxShadow = '';
        _activeChordBlock.style.outline   = '';
        _activeChordBlock.style.zIndex    = '';
        _activeChordBlock = null;
    }
    const block = document.querySelector(`#chordRowContainer [data-idx="${segIndex}"]`);
    if (!block) return;
    block.classList.add('chord-block-selected');
    _activeChordBlock = block;

    // Sincronizar scroll del chord row y el grid para que el bloque quede visible
    const startStep = parseInt(block.dataset.start);
    const gs = document.getElementById('gridScroll');
    const cr = document.getElementById('chordRowContainer');
    if (gs && state.stepWidth) {
        const blockX  = startStep * state.stepWidth;
        const visible = gs.clientWidth;
        const cur     = gs.scrollLeft;
        if (blockX < cur || blockX + block.offsetWidth > cur + visible) {
            const next = Math.max(0, blockX - visible * 0.2);
            gs.scrollLeft = next;
            if (cr) cr.scrollLeft = next;   // forzar sync inmediato (no esperar evento scroll)
        }
    }
}

function _clearChordBlockHighlight() {
    if (_activeChordBlock) {
        _activeChordBlock.classList.remove('chord-block-selected');
        _activeChordBlock = null;
    }
}

// ─────────────────────────────────────────────
// Renderizado del panel de acordes
// ─────────────────────────────────────────────

const _QUALITY_MAP = {
    major:'Mayor', minor:'Menor', dominant7:'Dominante 7ª', major7:'Mayor 7ª (maj7)',
    minor7:'Menor 7ª', diminished:'Disminuido', augmented:'Aumentado',
    major6:'Mayor 6ª', minor6:'Menor 6ª', sus4:'Suspendido 4ª', sus2:'Suspendido 2ª',
    unknown:'Desconocido', none:'—'
};

function _renderChordPanel(centerIndex) {
    const slider  = document.getElementById('chordColsSlider');
    const content = document.getElementById('chordPanelContent');
    if (!slider || !content) return;

    const segs = _activeSegments();
    if (!segs.length) return;
    _chordPanelIndex = Math.max(0, Math.min(segs.length - 1, centerIndex));

    // Actualizar highlight de notas en el piano roll
    const _currSeg = segs[_chordPanelIndex];
    const _hClasses = [...new Set(_currSeg.activeNotes.map(n => n % 12))];
    if (_hClasses.length) {
        state.activeHighlight = { classes: _hClasses, startStep: _currSeg.startStep, endStep: _currSeg.endStep };
        if (!state.reproduciendo) {
            drawPianoRollWithHighlight(_hClasses, _currSeg.startStep, _currSeg.endStep);
        }
    }
    _highlightChordBlock(_chordPanelIndex);

    // Columnas adaptativas al ancho disponible
    const availW  = content.clientWidth || 800;
    const numCols = Math.max(2, Math.floor(availW / _CHORD_COL_MIN_W));
    const colW    = Math.floor(availW / numCols);

    // 1 anterior (si existe) + actual + siguientes
    const hasPrev  = _chordPanelIndex > 0;
    const nextSlots = numCols - (hasPrev ? 1 : 0) - 1;
    const indices  = [];
    if (hasPrev) indices.push(_chordPanelIndex - 1);
    indices.push(_chordPanelIndex);
    for (let i = 1; i <= nextSlots; i++) {
        if (_chordPanelIndex + i < segs.length) indices.push(_chordPanelIndex + i);
    }

    // Columna fija de etiquetas (se actualiza según tipo del segmento actual)
    const labelsCol  = document.getElementById('chordLabelsCol');
    const currSeg    = segs[_chordPanelIndex];
    const isCurrPhrase = Array.isArray(currSeg.degrees);
    if (labelsCol) {
        labelsCol.innerHTML = isCurrPhrase ? `
            <div class="cp-section">
                <div class="cp-row"><span class="cp-lbl">Progresión</span></div>
                <div class="cp-row"><span class="cp-lbl">Cadencia</span></div>
                <div class="cp-row"><span class="cp-lbl">Tonalidad</span></div>
            </div>
            <div class="cp-section">
                <div class="cp-row"><span class="cp-lbl">Duración</span></div>
                <div class="cp-row"><span class="cp-lbl">Posición</span></div>
                <div class="cp-row cp-dim"><span class="cp-lbl">Pasos</span></div>
            </div>
            <div class="cp-section">

            </div>` : `
            <div class="cp-section">
                <div class="cp-row"><span class="cp-lbl">Grado</span></div>
                <div class="cp-row"><span class="cp-lbl">Inversión</span></div>
                <div class="cp-row"><span class="cp-lbl">Tonalidad</span></div>
                <div class="cp-row"><span class="cp-lbl">Tensiones</span></div>
            </div>
            <div class="cp-section">
                <div class="cp-row"><span class="cp-lbl">Duración</span></div>
                <div class="cp-row"><span class="cp-lbl">Posición</span></div>
                <div class="cp-row cp-dim"><span class="cp-lbl">Pasos</span></div>
            </div>
            <div class="cp-section">

            </div>`;
    }

    slider.innerHTML = indices.map(idx => {
        const seg    = segs[idx];
        const meta   = _chordMeta(seg);
        const isCurr = idx === _chordPanelIndex;
        const isPrev = idx === _chordPanelIndex - 1;
        const colCls = isPrev ? 'cp-prev' : isCurr ? 'cp-current' : 'cp-next';

        // Grado romano + función
        const degree  = meta.isPhrase
            ? (seg.degrees ? seg.degrees.join(' – ') : '')
            : _romanDegree(meta.chord, state.currentKey);
        const funcStr = meta.chordFunc ? ` — ${meta.chordFunc}` : '';

        // Inversión
        const inv = meta.isPhrase ? '—' : (
            seg.inversion ||
            (seg.activeNotes.length && meta.chord?.root !== undefined
                ? detectInversion(seg.activeNotes, meta.chord.root) : '')
            || 'Estado fundamental'
        );

        // Tonalidad
        const key    = state.currentKey || null;
        const keyStr = key
            ? (typeof key === 'object'
                ? key.tonic + ' ' + (key.mode === 'major' ? 'Mayor' : 'Menor')
                : String(key))
            : '—';

        // Tensiones
        const tensionNames = (meta.chord?.tensions || []).map(i => {
            const tm = {1:'b9',2:'9',3:'#9',5:'11',6:'#11',8:'b13',9:'13',10:'7',11:'maj7'};
            return tm[i] || `+${i}`;
        });
        const tensionStr = tensionNames.length ? tensionNames.join(', ') : 'Ninguna';

        // Duración / posición
        const steps    = seg.endStep - seg.startStep;
        const spm      = state.currentTimeSig ? state.currentTimeSig.stepsPerMeasure : 16;
        const measures = (steps / spm).toFixed(2);
        const posStr   = _stepToMusical(seg.startStep) + ' → ' + _stepToMusical(seg.endStep);

        // Chips de notas
        const noteChips = seg.activeNotes.map(n =>
            `<span class="cp-chip">${_NOTE_NAMES_CR[n % 12]}${Math.floor(n / 12) - 1} (${n})</span>`
        ).join('');

        const bgColor = isCurr ? '#141430' : _chordFunctionColor(meta.chordFunc);

        const bodyHtml = meta.isPhrase ? `
            <div class="cp-section">
                <div class="cp-row"><span class="cp-val cp-mono">${seg.degrees ? seg.degrees.join(' – ') : '—'}</span></div>
                <div class="cp-row"><span class="cp-val">${seg.cadenceType || '—'}</span></div>
                <div class="cp-row"><span class="cp-val">${keyStr}</span></div>
            </div>
            <div class="cp-section">
                <div class="cp-row"><span class="cp-val">${steps} pasos · ${measures} compases</span></div>
                <div class="cp-row"><span class="cp-val">${posStr}</span></div>
                <div class="cp-row cp-dim"><span class="cp-val">${seg.startStep} → ${seg.endStep}</span></div>
            </div>
            <div class="cp-section">
                <div class="cp-chips">${(seg.chords || []).map((c, i) =>
                    `<span class="cp-chip">${seg.degrees?.[i] ? seg.degrees[i] + ' ' : ''}${c}</span>`
                ).join('')}</div>
            </div>` : `
            <div class="cp-section">
                <div class="cp-row"><span class="cp-val">${degree}${funcStr}</span></div>
                <div class="cp-row"><span class="cp-val">${inv}</span></div>
                <div class="cp-row"><span class="cp-val">${keyStr}</span></div>
                <div class="cp-row"><span class="cp-val">${tensionStr}</span></div>
            </div>
            <div class="cp-section">
                <div class="cp-row"><span class="cp-val">${steps} pasos · ${measures} compases</span></div>
                <div class="cp-row"><span class="cp-val">${posStr}</span></div>
                <div class="cp-row cp-dim"><span class="cp-val">${seg.startStep} → ${seg.endStep}</span></div>
            </div>
            <div class="cp-section">
                <div class="cp-chips">${noteChips}</div>
            </div>`;

        return `<div class="chord-col ${colCls}" data-idx="${idx}" style="width:${colW}px;background:${bgColor};">
            <div class="cp-counter">${idx + 1} / ${segs.length}</div>
            ${bodyHtml}
            ${isCurr ? '<div class="chord-col-progress" id="chordColProgress"></div>' : ''}
        </div>`;
    }).join('');

    // Click en columna → esa pasa a ser ACTUAL
    slider.querySelectorAll('.chord-col').forEach(col => {
        col.addEventListener('click', () => {
            const idx = parseInt(col.dataset.idx);
            const s   = segs[idx];
            // Highlight notas en piano roll
            const classes = [...new Set(s.activeNotes.map(n => n % 12))];
            if (classes.length) {
                drawPianoRollWithHighlight(classes, s.startStep, s.endStep);
                state.activeHighlight = { classes, startStep: s.startStep, endStep: s.endStep };
            }
            _highlightChordBlock(idx);
            if (!state.reproduciendo) {
                state.pasoActual = s.startStep;
                updateRulerPlayhead(s.startStep);
            }
            _renderChordPanel(idx);
        });
    });

    // Actualizar estado de navegación (usado por auto-avance y _playAndAdvance)
    const curr = segs[_chordPanelIndex];
    window._cpopNavTo     = (idx) => _renderChordPanel(idx);
    window._cpopSegIndex  = _chordPanelIndex;
    window._cpopTotalSegs = segs.length;
    window._cpopStartStep = curr.startStep;
    window._cpopEndStep   = curr.endStep;

    // Footer: habilitar botones
    const loopBtn = document.getElementById('cpanel-loop-btn');
    const autoBtn = document.getElementById('cpanel-auto-btn');
    const prevBtn = document.getElementById('cpanel-prev-btn');
    const nextBtn = document.getElementById('cpanel-next-btn');
    if (loopBtn) loopBtn.disabled = false;
    if (prevBtn) prevBtn.disabled = (_chordPanelIndex <= 0);
    if (nextBtn) nextBtn.disabled = (_chordPanelIndex >= segs.length - 1);
    if (autoBtn) {
        autoBtn.disabled = (_chordPanelIndex >= segs.length - 1);
        autoBtn.classList.toggle('cpop-auto-on', state.autoAdvanceActive);
    }
}

/** Reproduce en loop el segmento actualmente centrado en el panel. */
export function _cpanelPlayLoop() {
    const segs = _activeSegments();
    const seg  = segs[_chordPanelIndex];
    if (seg) _playSegmentLoop(seg.startStep, seg.endStep);
}

/** Navega al acorde anterior sin reproducir. */
export function _cpanelPrevChord() {
    const segs = _activeSegments();
    const idx  = Math.max(0, _chordPanelIndex - 1);
    _cpanelGoToChord(segs, idx);
}

/** Navega al acorde siguiente sin reproducir. */
export function _cpanelNextChord() {
    const segs = _activeSegments();
    const idx  = Math.min(segs.length - 1, _chordPanelIndex + 1);
    _cpanelGoToChord(segs, idx);
}

/** Selecciona el acorde en el índice dado: actualiza piano roll, playhead y panel. */
function _cpanelGoToChord(segs, idx) {
    if (idx < 0 || idx >= segs.length) return;
    const s = segs[idx];
    const classes = [...new Set(s.activeNotes.map(n => n % 12))];
    if (classes.length) {
        drawPianoRollWithHighlight(classes, s.startStep, s.endStep);
        state.activeHighlight = { classes, startStep: s.startStep, endStep: s.endStep };
    }
    _highlightChordBlock(idx);
    if (!state.reproduciendo) {
        state.pasoActual = s.startStep;
        updateRulerPlayhead(s.startStep);
    }
    _renderChordPanel(idx);
}

/** Actualiza el panel durante la reproducción (llamado desde _tick). */
export function _updateChordPanelFromPlayback() {
    const panel = document.getElementById('chordPanel');
    if (!panel || !panel.classList.contains('open')) return;

    const segs = _activeSegments();
    const idx  = segs.findIndex(s =>
        state.pasoActual >= s.startStep && state.pasoActual < s.endStep
    );

    // Re-renderizar solo si cambió el segmento activo
    if (idx >= 0 && idx !== _chordPanelIndex) _renderChordPanel(idx);

    // Siempre actualizar barra de progreso
    if (idx >= 0) {
        const bar = document.getElementById('chordColProgress');
        if (bar) {
            const seg = segs[idx];
            const pct = (state.pasoActual - seg.startStep) / (seg.endStep - seg.startStep) * 100;
            bar.style.width = Math.min(100, Math.max(0, pct)).toFixed(1) + '%';
        }
    }
}

// ─────────────────────────────────────────────
// Dibujo de la fila de bloques
// ─────────────────────────────────────────────

export function drawChordRow(segments, key) {
    const container = document.getElementById('chordRowContainer');
    if (!container) return;
    container.innerHTML = '';

    if (!segments || segments.length === 0) {
        container.innerHTML = '<div style="padding:10px;color:#888;">No hay segmentos armónicos</div>';
        return;
    }

    container.style.width = `${state.totalSteps * state.stepWidth}px`;

    for (let i = 0; i < segments.length; i++) {
        const seg   = segments[i];
        const width = (seg.endStep - seg.startStep) * state.stepWidth;
        if (width <= 0) continue;

        const isBreath = typeof seg.energy !== 'undefined';
        const isPhrase = !isBreath && Array.isArray(seg.degrees);

        let chordName, chordFunc, chord, bgColor;
        if (isBreath) {
            chordName = seg.chordDisplay || `R${i + 1}`;
            chordFunc = seg.chordFunction || '';
            chord     = null;
            bgColor   = _breathingSegColor(seg.energy);
        } else if (isPhrase) {
            chordName = seg.chordDisplay || '?';
            chordFunc = seg.cadenceType  || '';
            chord     = seg.chord        || null;
            bgColor   = _phraseCadenceColor(seg.cadenceType);
        } else if (seg.chordDisplay) {
            chordName = seg.chordDisplay;
            chordFunc = seg.chordFunction || "";
            chord     = seg.chord || null;
            bgColor   = _chordFunctionColor(chordFunc);
        } else {
            const noteClasses = [...new Set(seg.activeNotes.map(n => n % 12))].sort((a,b) => a-b);
            chord     = findChord(noteClasses, seg.activeNotes[0] || null);
            chordName = chord.name;
            chordFunc = key ? getChordFunction(chord, key) : '';
            bgColor   = _chordFunctionColor(chordFunc);
        }

        const block = document.createElement('div');

        // Contenido interior según tipo
        let blockInner = '';
        if (isBreath) {
            blockInner = `<div style="font-size:${width < 80 ? '9px' : '11px'};font-weight:bold;` +
                         `line-height:1.3;padding-top:6px">${chordName}</div>` +
                         `<div style="font-size:9px;opacity:0.65;line-height:1.2">${(seg.energy * 100).toFixed(0)}%</div>`;
        } else if (isPhrase) {
            blockInner = `<div style="font-size:${width < 80 ? '9px' : '12px'};font-weight:bold;` +
                         `line-height:1.3;padding-top:6px">${chordName}</div>` +
                         `<div style="font-size:9px;opacity:0.7;line-height:1.2">${seg.cadenceType || ''}</div>`;
        }

        const useMultiline = isBreath || isPhrase;
        block.style.cssText = [
            `display:inline-block`,
            `width:${width - 1}px`,
            `height:50px`,
            `background:${bgColor}`,
            `border:1px solid ${isBreath ? '#4a5a6a' : isPhrase ? '#7a7aaa' : '#555'}`,
            `text-align:center`,
            `line-height:${useMultiline ? '1' : '50px'}`,
            `color:white`,
            `font-size:${width < 50 ? '10px' : '13px'}`,
            `overflow:hidden`,
            `cursor:pointer`,
            `vertical-align:top`,
            `box-sizing:border-box`,
            `transition:filter .1s`,
        ].join(';');

        if (useMultiline) {
            block.innerHTML = blockInner;
        } else {
            block.textContent = chordName;
        }
        block.dataset.idx   = i;
        block.dataset.start = seg.startStep;
        block.dataset.end   = seg.endStep;

        block.addEventListener('mouseenter', () => { block.style.filter = 'brightness(1.35)'; });
        block.addEventListener('mouseleave', () => { block.style.filter = ''; });
        block.addEventListener('click', (e) => {
            e.stopPropagation();
            onChordBlockClick(seg, i);
        });

        container.appendChild(block);
    }
}

function _breathingSegColor(energy) {
    // Baja energía → azul-gris oscuro (punto de respiración), alta → naranja-marrón cálido
    const r = Math.round(26  + energy * 110);
    const g = Math.round(30  + energy * 40);
    const b = Math.round(80  - energy * 54);
    return `rgb(${r},${g},${b})`;
}

function _chordFunctionColor(fn) {
    if (!fn) return "#3a3a4a";
    if (fn.startsWith("Tónica"))       return "#1a5f7a";
    if (fn.startsWith("Dominante"))    return "#7a1a1a";
    if (fn.startsWith("Subdominante")) return "#1a6a3a";
    return "#4a4a6a";
}

function _phraseCadenceColor(cadenceType) {
    if (!cadenceType)                    return "#2a2a4a";
    if (cadenceType === 'auténtica')     return "#1a4a2a";  // verde oscuro — cierre fuerte
    if (cadenceType === 'plagal')        return "#1a3a4a";  // azul oscuro  — cierre suave
    if (cadenceType === 'semicadencia')  return "#4a3a1a";  // naranja oscuro — pausa
    if (cadenceType === 'rota')          return "#4a1a3a";  // morado oscuro — sorpresa
    if (cadenceType === 'final')         return "#2a2a2a";  // gris — fin de pieza
    return "#2a2a4a";
}

// ─────────────────────────────────────────────
// Helper: array activo según estado del checkbox
// ─────────────────────────────────────────────

export function _activeSegments() {
    const sel = document.getElementById('viewLevelSelect');
    const val = sel ? sel.value : 'pasos';
    if (val === 'respiración' && state.breathingSegments.length)
        return state.breathingSegments;
    if (val === 'frases'      && state.currentPhraseSegments.length)
        return state.currentPhraseSegments;
    if (val === 'acordes'     && state.currentFusedSegments.length)
        return state.currentFusedSegments;
    return state.currentHarmonicSegments;
}

/** True cuando el auto-avance debe usar 1 segmento por lote (frases o respiración). */
function _isSegmentBatchMode() {
    const val = document.getElementById('viewLevelSelect')?.value;
    return val === 'frases' || val === 'respiración';
}

// ─────────────────────────────────────────────
// Click: popup + resaltado en el grid
// ─────────────────────────────────────────────

export function onChordBlockClick(segment, segIndex, openPanel = true) {
    // Highlight de notas en el piano roll
    const classes = [...new Set(segment.activeNotes.map(n => n % 12))];
    if (classes.length > 0) {
        drawPianoRollWithHighlight(classes, segment.startStep, segment.endStep);
        state.activeHighlight = { classes, startStep: segment.startStep, endStep: segment.endStep };
    }

    // Highlight del bloque en el chord row
    _highlightChordBlock(segIndex);

    // Mover playhead si no está reproduciendo
    if (!state.reproduciendo) {
        state.pasoActual = segment.startStep;
        updateRulerPlayhead(segment.startStep);
    }

    // Abrir/actualizar el panel de acordes
    const panel = document.getElementById('chordPanel');
    if (panel) {
        const wasOpen = panel.classList.contains('open');
        if (openPanel && !wasOpen) {
            panel.classList.add('open');
            const btn = document.getElementById('chordPanelBtn');
            if (btn) btn.classList.add('btn-active');
        }
        if (wasOpen || openPanel) _renderChordPanel(segIndex);
    }

    // Registrar Enter → avanzar acorde (si no está ya activo)
    if (!_panelKeyHandler) {
        _panelKeyHandler = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); _playAndAdvance(); }
        };
        document.addEventListener('keydown', _panelKeyHandler);
    }
}

// -------------------------------------------
// _showChordPopup removed � replaced by chord panel accordion
// -------------------------------------------



/**
 * Activa/desactiva el modo APPEND predictivo (auto-avance compás a compás).
 * Si no hay reproducción activa, arranca el primer segmento.
 */
export function _toggleAutoAdvance() {
    state.autoAdvanceActive = !state.autoAdvanceActive;

    const btn = document.getElementById('cpanel-auto-btn');
    if (btn) btn.classList.toggle('cpop-auto-on', state.autoAdvanceActive);

    if (!state.autoAdvanceActive) return;

    if (!state.reproduciendo) {
        _playSegmentLoop(window._cpopStartStep, window._cpopEndStep);
    } else {
        // Ya reproduciendo: fijar loopB al final del lote actual
        const segs = _activeSegments();
        if (_isSegmentBatchMode()) {
            const idx = segs.findIndex(s => state.pasoActual >= s.startStep && state.pasoActual < s.endStep);
            if (idx >= 0) { state._batchStartSegIdx = idx; state.loopB = segs[idx].endStep; }
        } else {
            const idx = _chordPanelIndex || 0;
            state._batchStartSegIdx = idx;
            state.loopB = segs[Math.min(idx + BATCH_SIZE - 1, segs.length - 1)].endStep;
        }
        // Si pasoActual ya superó loopB, el siguiente _tick dispararía _startNextBatch
        // inmediatamente, saltándose el lote actual. Volver al inicio del lote.
        if (state.pasoActual >= state.loopB && state._batchStartSegIdx >= 0) {
            state.pasoActual = segs[state._batchStartSegIdx].startStep;
            state.loopA      = state.pasoActual;
            state.loopAB     = true;
            updateRulerPlayhead(state.pasoActual);
        }
        _updateAbBtn();
        drawTimelineRuler();
    }
}

/**
 * Reproduce el segmento actual en bucle y avanza el popup al siguiente.
 * Orden: 1) play en bucle del segmento actual  2) navega al siguiente.
 */
function _playAndAdvance(startStep, endStep) {
    const idxToNav = window._cpopSegIndex + 1;
    if (typeof window._cpopNavTo === 'function' && idxToNav < window._cpopTotalSegs) {
        window._cpopNavTo(idxToNav);
        // Tras navegar, _cpopStartStep/_cpopEndStep apuntan al nuevo segmento
        _playSegmentLoop(window._cpopStartStep, window._cpopEndStep);
    }
}

/**
 * Fija el rango A→B al segmento indicado y lanza la reproducción en bucle.
 * En modo "frases" o "respiración": 1 segmento por lote.
 * En otros modos: BATCH_SIZE segmentos de acorde por lote.
 */
export function _playSegmentLoop(startStep, endStep) {
    if (state.reproduciendo) {
        stop();
    }

    let batchEndStep = endStep;
    if (state.autoAdvanceActive) {
        const segs = _activeSegments();
        if (_isSegmentBatchMode()) {
            // 1 segmento por lote (frase o respiración)
            const idx = segs.findIndex(s => startStep >= s.startStep && startStep < s.endStep);
            if (idx >= 0) {
                state._batchStartSegIdx = idx;
                batchEndStep            = segs[idx].endStep;
                console.log(`[batch] ${document.getElementById('viewLevelSelect')?.value} ` +
                            `${idx + 1}/${segs.length} [${startStep}–${batchEndStep})`);
            }
        } else {
            // BATCH_SIZE segmentos de acorde por lote
            // Primero buscar coincidencia exacta de startStep; si falla, buscar por rango
            let idx = segs.findIndex(s => s.startStep === startStep);
            if (idx < 0) idx = segs.findIndex(s => startStep >= s.startStep && startStep < s.endStep);
            if (idx >= 0) {
                state._batchStartSegIdx = idx;
                const last              = Math.min(idx + BATCH_SIZE - 1, segs.length - 1);
                batchEndStep            = segs[last].endStep;
                console.log(`[batch] Acordes ${idx + 1}–${last + 1}/${segs.length} [${segs[idx].startStep}–${batchEndStep})`);
            } else {
                console.warn(`[batch] segmento no encontrado para startStep=${startStep} — se mantiene _batchStartSegIdx=${state._batchStartSegIdx}`);
            }
        }
    }

    state.loopAB     = true;
    state.loopA      = startStep;
    state.loopB      = batchEndStep;
    state.pasoActual = startStep;

    _updateAbBtn();
    drawTimelineRuler();
    updateRulerPlayhead(startStep);
    play();
}

// Flag para el auto-avance pendiente — cancelado por stop() manual
let _pendingAutoAdvance = false;

/** Cancela un auto-avance pendiente (llamado por playback.stop()). */
export function cancelPendingAutoAdvance() { _pendingAutoAdvance = false; }

/**
 * Para el lote actual, resetea las colas del ESP32 y arranca el siguiente lote.
 * El reset elimina el drift I2C acumulado — se acepta un gap breve entre lotes.
 * Espera la confirmación {"state":"stopped"} del ESP32 antes de enviar el siguiente
 * PLAY, evitando la race condition donde el nuevo bloque llega mientras el ESP32
 * aún está ejecutando el anterior.
 */
export function _startNextBatch() {
    const segs    = _activeSegments();
    const nextIdx = state._batchStartSegIdx + (_isSegmentBatchMode() ? 1 : BATCH_SIZE);

    if (state._batchStartSegIdx < 0 || nextIdx >= segs.length) {
        stop();
        return;
    }

    const nextSeg = segs[nextIdx];
    // _cpopNavTo se mueve dentro de _launch (después de stop) para que el panel
    // no adelante el estado visual mientras el lote anterior aún suena.

    // 1. Parar browser + enviar STOP al ESP32
    stop(); // pone autoAdvanceActive = false

    // 2. Registrar la intención de arrancar el siguiente lote
    _pendingAutoAdvance = true;

    let _launched = false;
    const _launch = () => {
        if (_launched || !_pendingAutoAdvance) return; // cancelado por stop() manual
        _launched = true;
        _pendingAutoAdvance     = false;
        state.autoAdvanceActive = true;
        // Navegar el panel DESPUÉS del stop, con estado limpio
        if (typeof window._cpopNavTo === 'function') window._cpopNavTo(nextIdx);
        state.onStoppedCallback = null;
        _playSegmentLoop(nextSeg.startStep, nextSeg.endStep);
    };

    const _connected = state.wsConnected || state._serialActive;

    if (_connected) {
        // Esperar confirmación "stopped" del ESP32 antes de enviar el PLAY.
        // Fallback de 350ms por si el mensaje nunca llega (WiFi con pérdidas).
        const _fallback = setTimeout(_launch, 350);
        state.onStoppedCallback = () => { clearTimeout(_fallback); _launch(); };
    } else {
        // Sin ESP32: arrancar inmediatamente
        _launch();
    }
}

// ─────────────────────────────────────────────
// Helpers armónicos para el popup
// ─────────────────────────────────────────────

/**
 * Convierte un número de paso a posición musical legible.
 * Ejemplo: paso 32 en 4/4 → "C3·T1"  (Compás 3, Tiempo 1)
 */
function _stepToMusical(step) {
    const spm     = state.currentTimeSig ? state.currentTimeSig.stepsPerMeasure : 16;
    const spb     = state.currentTimeSig ? state.currentTimeSig.stepsPerBeat    : 4;
    const measure = Math.floor(step / spm) + 1;
    const beat    = Math.floor((step % spm) / spb) + 1;
    return `C${measure}·T${beat}`;
}

function _romanDegree(chord, key) {
    if (!chord || chord.root === null || !key) return '?';
    const degree = (chord.root - key.rootClass + 12) % 12;
    const DEGREES_MAJOR = { 0:'I', 2:'III', 4:'V', 5:'VI', 7:'VII', 3:'IV', 1:'II' };
    const DEGREES_MINOR = { 0:'i', 2:'III', 4:'v', 5:'VI', 7:'VII', 3:'iv', 1:'ii°' };
    const map = key.mode === 'major' ? DEGREES_MAJOR : DEGREES_MINOR;
    const roman = map[degree] || `(${degree}st)`;
    // Minúscula si es acorde menor
    const isMinorQuality = ['minor','minor7','diminished'].includes(chord.quality);
    return isMinorQuality ? roman.toLowerCase() : roman.toUpperCase();
}

/**
 * Toca un array de notas MIDI simultáneamente durante 1.2 segundos
 * y anima los chips correspondientes.
 * @param {Array<number>}      notes - Notas MIDI a sonar
 * @param {NodeList|Array}     chips - Elementos DOM a animar
 */
function _playNotes(notes, chips) {
    const DURATION_S = 1.2;

    // ── Audio MIDI virtual ─────────────────────────────────────
    if (state.soundfontLoaded && MIDI.noteOn) {
        notes.forEach(note => {
            MIDI.noteOn( 0, note, 90, 0);
            MIDI.noteOff(0, note, DURATION_S);
        });
    }

    // ── Motores ESP32 ──────────────────────────────────────────
    // Para cada nota buscar si hay un motor asignado en MOTOR_MAP
    // y enviar un golpe de prueba individual.
    if (state.wsConnected) {
        const hitMs     = 80;
        const retractMs = 150;

        notes.forEach(note => {
            const cfg = MOTOR_MAP.find(m => m.note === note);
            if (!cfg) return;
            const cmd = `e; m ${cfg.motor}; o ${cfg.homePwm}; t ${hitMs}; v ${cfg.vel}; t ${retractMs}; v 0; p;`;
            sendCommand(cmd);
        });
    }

    // ── Animar chips ───────────────────────────────────────────
    chips.forEach(chip => {
        chip.classList.add('ringing');
        setTimeout(() => chip.classList.remove('ringing'), DURATION_S * 1000);
    });
}

/**
 * Selecciona el segmento armónico que contiene el paso dado:
 * resalta su bloque en el chord row y abre el popup de info.
 * Llamado desde seekToStep() cuando el usuario clica en el ruler.
 */
export function _selectChordAtStep(step) {
    const segs = _activeSegments();
    const idx  = segs.findIndex(s => step >= s.startStep && step < s.endStep);
    if (idx >= 0) onChordBlockClick(segs[idx], idx, false);
}

function _scaleNotes(key) {
    if (!key) return [];
    const scaleName = `${key.tonic} ${key.mode}`;
    const scale = Tonal.Scale.get(scaleName);
    if (scale.empty) return [];
    return scale.notes.map(n => Tonal.Note.get(n).chroma);
}
