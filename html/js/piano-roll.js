// ============================================================
// piano-roll.js — Construcción del grid y renderizado en canvas
// Depende de: state.js, dom-refs.js (canvas/ctx)
// ============================================================

import { state } from './state.js';
import { canvas, ctx, playBtn } from './dom-refs.js';
import { drawVelocityLane } from './velocity-lane.js';
import { drawMinimap } from './minimap.js';
import { drawTimelineRuler } from './timeline-ruler.js';
import { drawChordRow } from './chord-row.js';
import { motorForNote, _mmVelRange, MOTOR_MAP } from './motor-map.js';
import { sendCommand } from './ws-connector.js';
import { historyClear } from './history.js';
import { tabMarkFileLoaded } from './tabs.js';
import { getSelCells, getSelDrag } from './editor.js';
import { gridScroll } from './dom-refs.js';

// ── Virtualización vertical ───────────────────────────────────
// El canvas tiene la altura completa (noteRows.length * rowHeight) y el scroll
// es nativo (#gridScroll). Solo necesitamos *dibujar* las filas visibles, no
// recorrer las 88 notas en cada repintado. Las coordenadas Y siguen siendo
// absolutas (rowIndex * rowHeight); virtualizar solo acota qué filas se pintan.
const ROW_OVERSCAN = 2;   // filas extra arriba/abajo para evitar bordes vacíos al hacer scroll

/**
 * Cálculo PURO del rango de filas visibles [first, last] (inclusive, con
 * overscan). Separado de _visibleRowRange para poder testearlo sin DOM.
 * @param {number} scrollTop  desplazamiento vertical (px)
 * @param {number} viewH      altura visible del contenedor (px)
 * @param {number} rowHeight  altura de fila (px)
 * @param {number} rowCount   número total de filas
 * @returns {[number, number]} [first, last]; [0, rowCount-1] si no hay layout
 */
export function computeVisibleRowRange(scrollTop, viewH, rowHeight, rowCount) {
    if (rowCount <= 0) return [0, -1];
    const rh = rowHeight || 1;
    // viewH <= 0 → contenedor sin layout (oculto / headless): pintar todo.
    if (!(viewH > 0)) return [0, rowCount - 1];

    let first = Math.floor(scrollTop / rh) - ROW_OVERSCAN;
    let last  = Math.ceil((scrollTop + viewH) / rh) + ROW_OVERSCAN;
    first = Math.max(0, first);
    last  = Math.min(rowCount - 1, last);
    return [first, last];
}

/**
 * Rango de filas visibles a partir del scroll real del contenedor #gridScroll.
 * @returns {[number, number]}
 */
function _visibleRowRange() {
    return computeVisibleRowRange(
        (gridScroll && gridScroll.scrollTop) || 0,
        (gridScroll && gridScroll.clientHeight) || 0,
        state.rowHeight || 1,
        state.noteRows.length
    );
}

/**
 * Construye gridData a partir de los eventos noteOn/noteOff del canal seleccionado,
 * redimensiona el canvas y dibuja el piano roll.
 * @param {number} channel - Canal MIDI (0-15)
 */
export function buildGridFromChannel(channel) {
    const channelEvents = state.rawEvents
        .filter(e => e.channel === channel)
        .sort((a, b) => a.tick - b.tick);

    // Emparejar noteOn con su noteOff correspondiente
    const pendingNotes = new Map(); // nota → { tickOn, velocity }
    const notesList = [];           // { tickOn, tickOff, note, velocity }

    for (const ev of channelEvents) {
        if (ev.type === 'noteOn' && ev.velocity > 0) {
            if (pendingNotes.has(ev.note)) {
                // Drum hit sin noteOff previo: cerrar la nota anterior con duración mínima (1 tick)
                const prev = pendingNotes.get(ev.note);
                notesList.push({ tickOn: prev.tickOn, tickOff: ev.tick || prev.tickOn + 1, note: ev.note, velocity: prev.velocity });
            }
            pendingNotes.set(ev.note, { tickOn: ev.tick, velocity: ev.velocity });
        } else if (ev.type === 'noteOff' || (ev.type === 'noteOn' && ev.velocity === 0)) {
            if (pendingNotes.has(ev.note)) {
                const on = pendingNotes.get(ev.note);
                notesList.push({ tickOn: on.tickOn, tickOff: ev.tick, note: ev.note, velocity: on.velocity });
                pendingNotes.delete(ev.note);
            }
        }
    }
    // Notas sin noteOff → duración mínima de 1 tick (drums sin cierre explícito)
    for (const [note, on] of pendingNotes) {
        notesList.push({ tickOn: on.tickOn, tickOff: on.tickOn + 1, note, velocity: on.velocity });
    }

    // Resolución: semicorchea = ppqn / 4
    state.ticksPerStep = state.ppqn / 4;
    state.totalSteps   = Math.ceil(state.totalTicks / state.ticksPerStep);

    // Convertir tempoMap (ticks → pasos) en tempoPoints editables
    state.tempoPoints = state.tempoMap
        .map(t => ({ step: Math.round(t.tick / state.ticksPerStep), bpm: Math.round(t.bpm) }))
        .filter((t, i, arr) => i === 0 || t.step !== arr[i - 1].step);
    if (!state.tempoPoints.length || state.tempoPoints[0].step !== 0)
        state.tempoPoints.unshift({ step: 0, bpm: state.tempoPoints[0]?.bpm || 120 });
    const _bpmEl = document.getElementById('bpmInput');
    if (_bpmEl) _bpmEl.value = Math.round(state.tempoPoints[0].bpm);

    // Límite de seguridad del canvas (~32.767px max en la mayoría de navegadores).
    // Si la canción es muy larga, reducimos stepWidth automáticamente.
    const MAX_CANVAS_W = 16000; // margen conservador
    if (state.totalSteps * state.stepWidth > MAX_CANVAS_W) {
        state.stepWidth = Math.max(2, Math.floor(MAX_CANVAS_W / state.totalSteps));
        console.warn(`[piano-roll] Canvas demasiado ancho. stepWidth reducido a ${state.stepWidth}px (${state.totalSteps} pasos)`);
    }

    // Rango de notas visible (con margen de una octava)
    let minNote = 127, maxNote = 0;
    for (const n of notesList) {
        if (n.note < minNote) minNote = n.note;
        if (n.note > maxNote) maxNote = n.note;
    }
    minNote  = Math.max(0,   minNote - 12);
    maxNote  = Math.min(127, maxNote + 12);
    state.noteRows = [];
    for (let n = minNote; n <= maxNote; n++) state.noteRows.push(n);

    // Convertir notas a celdas del grid.
    // La velocity de cada nota se comprime al rango [velMin, velMax] del MOTOR
    // que la toca (autoridad por motor, no global). El rango del motor está en
    // escala ESP32 (1-100); aquí lo expresamos en 0-127, que es la escala del
    // grid (el sequencer la reconvierte a 1-100 al reproducir).
    // Notas sin motor asignado → rango por defecto [VEL_MIN_DEFAULT, VEL_MAX_DEFAULT],
    // que es lo que devuelve _mmVelRange(null); así ninguna velocity importada
    // sobrepasa los umbrales aunque la nota no tenga motor.
    state.gridData = { cells: {} };
    for (const n of notesList) {
        const startStep = Math.floor(n.tickOn / state.ticksPerStep);
        const endStep   = Math.floor((n.tickOff - 1) / state.ticksPerStep);
        const duration  = endStep - startStep + 1;
        if (duration <= 0) continue;

        // Buscar el motor por la nota ABSOLUTA del grid (sin aplicar
        // transposeOffset: el offset es una transformación de runtime sobre un
        // grid ya construido, no afecta a cómo se lee el archivo). Usar
        // motorForNote aquí restaría un offset residual de una sesión previa y
        // dejaría notas válidas (p.ej. G2) sin motor → velocity cruda. Por eso
        // se busca directamente en MOTOR_MAP por m.note === n.note.
        // _mmVelRange(null) cae a [VEL_MIN_DEFAULT, VEL_MAX_DEFAULT], de modo que
        // las notas sin motor se comprimen al rango por defecto en vez de quedar
        // con la velocity cruda del MIDI (que podía superar los umbrales).
        const cfg = MOTOR_MAP.find(m => m.note === n.note) ?? null;
        const { min, max } = _mmVelRange(cfg);   // escala ESP32 1-100
        const lo = Math.round(min / 100 * 127);  // → escala grid 0-127
        const hi = Math.round(max / 100 * 127);
        const t  = Math.max(0, Math.min(1, n.velocity / 127));
        const velocity = Math.round(lo + (hi - lo) * t);
        const key = `${n.note},${startStep}`;
        // Colisión: dos notas distintas (p.ej. tras comprimir a motores) caen en
        // el mismo motor y step. En vez de sobrescribir silenciosamente (la última
        // del array ganaba sin criterio), conservamos la mayor velocidad y la mayor
        // duración por separado, para no perder presencia ni sostenido.
        const prev = state.gridData.cells[key];
        if (prev) {
            prev.duration = Math.max(prev.duration, duration);
            prev.velocity = Math.max(prev.velocity, velocity);
        } else {
            state.gridData.cells[key] = { duration, velocity };
        }
    }

    // Redimensionar canvas
    canvas.width  = state.totalSteps * state.stepWidth;
    canvas.height = state.noteRows.length * state.rowHeight;
    canvas.style.width  = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;

    drawPianoRoll();
    drawNoteLabels();
}

/**
 * Dibuja el fondo de cuadrícula y todas las notas del gridData actual.
 */
export function drawPianoRoll() {
    if (!ctx) return;
    canvas.width  = state.totalSteps * state.stepWidth;
    canvas.height = state.noteRows.length * state.rowHeight;
    canvas.style.width  = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const CT = window.CANVAS_THEME || {};
    const rowAlt  = CT.rowAlt  || '#1e1e28';
    const grid    = CT.grid    || '#3a3a50';
    const gridBar = CT.gridBar || '#555555';
    const label   = CT.label   || '#666666';

    // Virtualización: solo pintamos la banda de filas visible (+ overscan).
    const [firstRow, lastRow] = _visibleRowRange();

    // Fondo: notas negras del teclado (sostenidos/bemoles) en gris más oscuro
    const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
    for (let row = firstRow; row <= lastRow; row++) {
        if (BLACK_KEYS.has(state.noteRows[row] % 12)) {
            ctx.fillStyle = rowAlt;
            ctx.fillRect(0, row * state.rowHeight, canvas.width, state.rowHeight);
        }
    }

    // Cuadrícula vertical (columnas: abarcan toda la altura del canvas)
    for (let step = 0; step <= state.totalSteps; step++) {
        ctx.strokeStyle = (step % 16 === 0) ? gridBar : grid;
        ctx.lineWidth   = (step % 16 === 0) ? 1 : 0.5;
        const x = step * state.stepWidth;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    // Cuadrícula horizontal (solo filas visibles)
    ctx.strokeStyle = grid;
    ctx.lineWidth = 0.5;
    for (let row = firstRow; row <= lastRow + 1; row++) {
        const y = row * state.rowHeight;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    // Notas
    _drawNotes(null);

    // Numeración de compases
    ctx.fillStyle = label;
    ctx.font = "9px monospace";
    for (let step = 0; step < state.totalSteps; step += 16) {
        ctx.fillText(`${step / 16 + 1}`, step * state.stepWidth + 2, 10);
    }
}

/**
 * Dibuja el piano roll y, opcionalmente, un playhead amarillo.
 * @param {number} playheadStep - Paso del playhead, o -1 para no dibujarlo.
 */
export function drawPianoRollWithPlayhead(playheadStep) {
    if (state.activeHighlight) {
        drawPianoRollWithHighlight(state.activeHighlight.classes, state.activeHighlight.startStep, state.activeHighlight.endStep);
    } else {
        drawPianoRoll();
    }
    if (playheadStep >= 0) {
        const phColor = (window.CANVAS_THEME && window.CANVAS_THEME.playhead) || 'rgba(255,230,0,0.9)';
        const x = playheadStep * state.stepWidth;
        ctx.save();
        ctx.strokeStyle = phColor;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
        ctx.restore();
    }
    _drawSelectionOverlay();
    drawVelocityLane();
    drawMinimap();
}

/**
 * Dibuja el piano roll con highlight de notas Y playhead simultáneamente.
 * Usado durante la reproducción cuando el popup de acorde está visible.
 */
export function drawPianoRollWithHighlightAndPlayhead(chordClasses, hlStartStep, hlEndStep, playheadStep) {
    drawPianoRollWithHighlight(chordClasses, hlStartStep, hlEndStep);
    if (playheadStep >= 0) {
        const phColor = (window.CANVAS_THEME && window.CANVAS_THEME.playhead) || 'rgba(255,230,0,0.9)';
        const x = playheadStep * state.stepWidth;
        ctx.save();
        ctx.strokeStyle = phColor;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
        ctx.restore();
    }
    _drawSelectionOverlay();
}

/**
 * Redibuja el piano roll resaltando las notas cuya clase esté en chordClasses.
 * @param {Array<number>} chordClasses - Clases de altura (0-11) a resaltar
 */
export function drawPianoRollWithHighlight(chordClasses, hlStartStep = null, hlEndStep = null) {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const CT2 = window.CANVAS_THEME || {};
    const [firstRow, lastRow] = _visibleRowRange();
    const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
    for (let row = firstRow; row <= lastRow; row++) {
        if (BLACK_KEYS.has(state.noteRows[row] % 12)) {
            ctx.fillStyle = CT2.rowAlt || '#1e1e28';
            ctx.fillRect(0, row * state.rowHeight, canvas.width, state.rowHeight);
        }
    }
    ctx.strokeStyle = CT2.grid || '#3a3a50'; ctx.lineWidth = 0.5;
    for (let step = 0; step <= state.totalSteps; step++) {
        const x = step * state.stepWidth;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let row = firstRow; row <= lastRow + 1; row++) {
        const y = row * state.rowHeight;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    _drawNotes(chordClasses, hlStartStep, hlEndStep);
}

// ---- Columna de etiquetas de notas ----

const _NOTE_NAMES   = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const _LABEL_W      = 75;  // Aumentado de 62 a 75 para más espacio
const _BLACK_KEYS_S = new Set([1, 3, 6, 8, 10]);

/**
 * Dibuja la columna fija de etiquetas de notas (noteLabelsCanvas).
 * Se sincroniza verticalmente con el canvas principal vía JS en main.js.
 */
export function drawNoteLabels() {
    const labelsCanvas = document.getElementById('noteLabelsCanvas');
    if (!labelsCanvas || state.noteRows.length === 0) return;

    const h = state.noteRows.length * state.rowHeight;
    labelsCanvas.height       = h;
    labelsCanvas.style.height = `${h}px`;

    const lCtx = labelsCanvas.getContext('2d');
    lCtx.clearRect(0, 0, _LABEL_W, h);

    for (let i = 0; i < state.noteRows.length; i++) {
        const note    = state.noteRows[i];
        const y       = i * state.rowHeight;
        const isBlack = _BLACK_KEYS_S.has(note % 12);
        const isC     = note % 12 === 0;
        const octave  = Math.floor(note / 12) - 1;
        const name    = _NOTE_NAMES[note % 12];

        // Color arcoíris por octava: Do1=rojo → Do6=violeta
        const OCTAVE_COLORS = {
            1: { bg: '#2a0a0a', stripe: '#8b1a1a', text: '#ff6666' },  // rojo
            2: { bg: '#2a1a0a', stripe: '#8b4a1a', text: '#ff9944' },  // naranja
            3: { bg: '#2a2a0a', stripe: '#7a7a1a', text: '#dddd44' },  // amarillo
            4: { bg: '#0a2a0a', stripe: '#1a6a1a', text: '#44dd44' },  // verde
            5: { bg: '#0a1a2a', stripe: '#1a4a8b', text: '#4488ff' },  // azul
            6: { bg: '#1a0a2a', stripe: '#4a1a8b', text: '#bb66ff' },  // violeta
        };
        const oct = Math.max(1, Math.min(6, octave));
        const col = OCTAVE_COLORS[oct] || OCTAVE_COLORS[4];

        // Fondo de fila
        lCtx.fillStyle = isBlack ? col.bg : `${col.bg}cc`;
        lCtx.fillRect(0, y, _LABEL_W, state.rowHeight);

        // Franja izquierda coloreada por octava
        lCtx.fillStyle = col.stripe;
        lCtx.fillRect(0, y + 1, 6, state.rowHeight - 1);

        // Línea divisoria en cada Do (más visible)
        if (isC) {
            lCtx.strokeStyle = col.text;
            lCtx.lineWidth = 1;
            lCtx.beginPath();
            lCtx.moveTo(0, y); lCtx.lineTo(_LABEL_W, y);
            lCtx.stroke();
        }

        // Texto
        const fontSize = Math.min(13, state.rowHeight - 2);
        if (fontSize < 5) continue;

        const showLabel = state.rowHeight >= 10 || isC;
        if (!showLabel) continue;

        const motorCfg = motorForNote(note);

        lCtx.textAlign    = "right";
        lCtx.textBaseline = "middle";

        if (motorCfg !== null && state.rowHeight >= 16) {
            // Nota con motor: nombre arriba, número de motor abajo
            const halfSize = Math.max(7, Math.floor(fontSize * 0.75));
            lCtx.font      = isC ? `bold ${halfSize}px monospace` : `${halfSize}px monospace`;
            lCtx.fillStyle = col.text;
            lCtx.fillText(isC ? `C${octave}` : name, _LABEL_W - 4, y + state.rowHeight * 0.32);
            lCtx.font      = `bold ${halfSize}px monospace`;
            lCtx.fillStyle = '#ffcc44';
            lCtx.fillText(`m:${motorCfg.motor}`, _LABEL_W - 4, y + state.rowHeight * 0.72);
        } else {
            lCtx.font      = isC ? `bold ${fontSize}px monospace` : `${fontSize}px monospace`;
            lCtx.fillStyle = col.text;
            lCtx.fillText(isC ? `C${octave}` : name, _LABEL_W - 4, y + state.rowHeight / 2);
        }
    }
}

// ---- Interacción con la columna de etiquetas ----

/**
 * Registra los eventos de la columna de notas:
 * - mousedown → toca la nota y resalta la fila
 * - mouseup / mouseleave → suelta la nota
 */
export function initNoteLabelsEvents() {
    const labelsCanvas = document.getElementById('noteLabelsCanvas');
    if (!labelsCanvas) return;

    let _activeNote = null;

    function _noteFromY(clientY) {
        const rect     = labelsCanvas.getBoundingClientRect();
        const mouseY   = (clientY - rect.top) * (labelsCanvas.height / rect.height);
        const rowIndex = Math.floor(mouseY / state.rowHeight);
        if (rowIndex < 0 || rowIndex >= state.noteRows.length) return null;
        return { note: state.noteRows[rowIndex], rowIndex };
    }

    function _startNote(clientY) {
        const hit = _noteFromY(clientY);
        if (!hit) return;
        _activeNote = hit.note;
        const offset = state.transposeOffset || 0;
        const transposedNote = hit.note + offset;

        if (state.soundfontLoaded && MIDI.noteOn) {
            MIDI.noteOn(0, transposedNote, 90, 0);
        }

        // Disparar motor físico — motorForNote ya aplica transposeOffset internamente
        const entry = motorForNote(hit.note);
        if (entry && typeof entry.motor === 'number') {
            const vel = 80;  // velocidad fija para click manual
            const cmd = `e; m ${entry.motor}; o ${entry.homePwm}; t 80; v ${vel}; t 150; v 0; p;`;
            console.log(`[_startNote] Motor: ${entry.motor}, note: ${hit.note}, transposedNote: ${transposedNote}, cmd: ${cmd}`);
            sendCommand(cmd);
        } else {
            console.warn(`[_startNote] No motor found for transposedNote: ${transposedNote}`);
        }

        _highlightLabelRow(hit.rowIndex, true);
    }

    function _stopNote() {
        if (_activeNote === null) return;
        const offset = state.transposeOffset || 0;
        const transposedNote = _activeNote + offset;
        if (state.soundfontLoaded && MIDI.noteOff) {
            MIDI.noteOff(0, transposedNote, 0);
        }
        _highlightLabelRow(null, false);
        _activeNote = null;
    }

    labelsCanvas.addEventListener('mousedown', (e) => {
        e.preventDefault();
        _startNote(e.clientY);
    });
    labelsCanvas.addEventListener('mouseup',    () => _stopNote());
    labelsCanvas.addEventListener('mouseleave', () => _stopNote());

    // Deslizar el ratón hacia arriba/abajo cambia de nota sin soltar
    labelsCanvas.addEventListener('mousemove', (e) => {
        if (_activeNote === null) return;           // solo si hay nota activa
        const hit = _noteFromY(e.clientY);
        if (!hit || hit.note === _activeNote) return;
        _stopNote();
        _startNote(e.clientY);
    });
}

/** Resalta o limpia la fila rowIndex en el canvas de etiquetas. */
function _highlightLabelRow(rowIndex, on) {
    const labelsCanvas = document.getElementById('noteLabelsCanvas');
    if (!labelsCanvas) return;
    const lCtx = labelsCanvas.getContext('2d');

    // Redibujar la fila completa desde drawNoteLabels sería costoso;
    // dibujamos solo un overlay semitransparente sobre la fila.
    if (on && rowIndex !== null) {
        lCtx.save();
        lCtx.fillStyle = 'rgba(255,220,80,0.25)';
        lCtx.fillRect(0, rowIndex * state.rowHeight, _LABEL_W, state.rowHeight);
        lCtx.restore();
    } else {
        // Redibujar solo para limpiar el overlay
        drawNoteLabels();
    }
}

// ============================================================
// ── toggleNewGridPanel — abre/cierra el panel de selección ───
export function toggleNewGridPanel() {
    const panel = document.getElementById('newGridPanel');
    const btn   = document.getElementById('newGridBtn');
    if (!panel) return;
    const visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : '';
    if (btn) btn.classList.toggle('btn-active', !visible);
}

// ── closeNewGridPanel — cierra el panel sin alternar (idempotente) ──
// Necesario al cerrar o cambiar de tab mientras el panel está abierto: si no,
// quedaría visible y un clic en un número de compases caería sobre otro tab.
export function closeNewGridPanel() {
    const panel = document.getElementById('newGridPanel');
    const btn   = document.getElementById('newGridBtn');
    if (panel) panel.style.display = 'none';
    if (btn) btn.classList.remove('btn-active');
}

// ── _doLoadBlankGrid — crea el grid con el nº de compases elegido ──
export function _doLoadBlankGrid(measures) {
    // Cerrar el panel
    const panel = document.getElementById('newGridPanel');
    if (panel) panel.style.display = 'none';
    const btn = document.getElementById('newGridBtn');
    if (btn) btn.classList.remove('btn-active');

    // Extraer notas únicas del MOTOR_MAP ordenadas ascendente
    const motorNotes = [...new Set(MOTOR_MAP.map(m => m.note))].sort((a, b) => a - b);
    if (motorNotes.length === 0) {
        alert('No hay notas definidas en el Motor Map.');
        return;
    }

    // Leer BPM del panel
    const bpmInput = document.getElementById('newGridBpm');
    const bpm = bpmInput ? Math.max(20, Math.min(400, parseInt(bpmInput.value) || 120)) : 120;

    const spm = state.currentTimeSig.stepsPerMeasure;  // 16 en 4/4

    // Resetear estado
    state.gridData          = { cells: {} };
    state.noteRows          = motorNotes;
    state.ppqn              = 96;
    state.ticksPerStep      = state.ppqn / 4;
    state.totalSteps        = measures * spm;
    state.stepWidth         = 8;
    state.midiData          = null;
    state.rawEvents         = [];
    state.tempoMap          = [{ tick: 0, bpm }];
    state.pasoActual        = 0;

    // Sincronizar BPM con el input de la toolbar
    const toolbarBpm = document.getElementById('bpmInput');
    if (toolbarBpm) toolbarBpm.value = bpm;

    // Limpiar análisis armónico, frases, respiración y nombre MIDI
    state.currentHarmonicSegments = [];
    state.currentFusedSegments    = [];
    state.currentPhraseSegments   = [];
    state.breathingSegments       = [];
    state.currentKey              = 'C';
    state.currentMidiFileName     = '';
    const chordRow = document.getElementById('chordRowContainer');
    if (chordRow) chordRow.innerHTML = '';

    state.tempoPoints = [{ step: 0, bpm }];
    historyClear();

    // Redimensionar canvas y redibujar (resetea zoom label al default 40/25)
    applyZoom(40, 25);

    // Un grid nuevo siempre arranca al principio. applyZoom intenta preservar el
    // "paso central" del viewport anterior, lo que aquí (cambio de stepWidth 8→40
    // con un viewport ya montado) desplazaría el scroll a la derecha. Forzar 0;
    // el listener de scroll sincroniza ruler, chord row y carril de velocidades.
    const gs = document.getElementById('gridScroll');
    if (gs) gs.scrollLeft = 0;

    // Habilitar transporte y botones de compases
    playBtn.disabled  = false;
    _enableMeasureButtons();
    const abBtn = document.getElementById('abLoopBtn');
    if (abBtn) abBtn.disabled = false;

    // Actualizar nombre del tab
    tabMarkFileLoaded(`Sin título · ${measures} comp.`);
}

// Alias de compatibilidad por si algo lo llama directamente
export function loadBlankGrid() { toggleNewGridPanel(); }

// ── Zoom ─────────────────────────────────────────────────────
/**
 * Aplica un nuevo zoom horizontal (stepWidth) y/o vertical (rowHeight).
 * Redibujar todos los layers y restaura el scroll para que el punto
 * central visible no salte.
 */
export function applyZoom(newStepWidth, newRowHeight) {
    if (!state.totalSteps || !state.noteRows.length) return;

    const container = document.getElementById('gridScroll');
    // Guardar el paso que está en el centro del viewport para restaurarlo
    const centerStep = container
        ? (container.scrollLeft + container.clientWidth / 2) / state.stepWidth
        : 0;

    state.stepWidth = Math.max(8,  Math.min(80, Math.round(newStepWidth)));
    state.rowHeight = Math.max(10, Math.min(50, Math.round(newRowHeight)));

    // Redibujar todos los layers (drawPianoRoll ya redimensiona el canvas)
    drawPianoRollWithPlayhead(state.pasoActual);
    drawNoteLabels();
    drawTimelineRuler();

    // Redibujar chord row si hay análisis armónico
    if (state.currentHarmonicSegments && state.currentHarmonicSegments.length) {
        const key = {
            tonic: state.currentKey.replace('m', ''),
            mode:  state.currentKey.endsWith('m') ? 'minor' : 'major',
            rootClass: 0
        };
        drawChordRow(state.currentHarmonicSegments, key);
    }

    // Restaurar scroll centrado en el mismo paso
    if (container) {
        container.scrollLeft = Math.max(0, centerStep * state.stepWidth - container.clientWidth / 2);
    }

    // Actualizar indicador visual en toolbar
    const lbl = document.getElementById('zoomLabel');
    if (lbl) lbl.textContent = state.stepWidth;
}

export function zoom(dir) { applyZoom(state.stepWidth + dir * 8, state.rowHeight + dir * 5); }

// ── addMeasures / removeMeasures ─────────────────────────────
function _phraseMeasures() {
    const sel = document.getElementById('phraseUnitSelect');
    return sel ? parseInt(sel.value) : 4;
}

export function _enableMeasureButtons() {
    const a = document.getElementById('addMeasuresBtn');
    const r = document.getElementById('removeMeasuresBtn');
    if (a) a.disabled = false;
    if (r) r.disabled = false;
}

export function addMeasures(n) {
    if (!state.totalSteps) return;
    const m = n || _phraseMeasures();
    state.totalSteps += m * state.currentTimeSig.stepsPerMeasure;
    canvas.width       = state.totalSteps * state.stepWidth;
    canvas.style.width = `${canvas.width}px`;
    drawPianoRoll();
    drawTimelineRuler();
}

export function removeMeasures(n) {
    if (!state.totalSteps) return;
    const m       = n || _phraseMeasures();
    const spm     = state.currentTimeSig.stepsPerMeasure;
    const cutStep = state.totalSteps - m * spm;
    if (cutStep < spm) return;   // no eliminar por debajo de 1 compás

    // Avisar si hay notas en los compases a eliminar
    const hasNotes = Object.keys(state.gridData.cells).some(k => parseInt(k.split(',')[1]) >= cutStep);
    if (hasNotes && !confirm(`¿Eliminar los últimos ${m} compás${m > 1 ? 'es' : ''} con sus notas?`)) return;

    // Borrar celdas fuera del nuevo rango
    for (const key of Object.keys(state.gridData.cells)) {
        if (parseInt(key.split(',')[1]) >= cutStep) delete state.gridData.cells[key];
    }

    state.totalSteps = cutStep;
    if (state.pasoActual >= state.totalSteps) state.pasoActual = state.totalSteps - 1;

    canvas.width       = state.totalSteps * state.stepWidth;
    canvas.style.width = `${canvas.width}px`;
    drawPianoRoll();
    drawTimelineRuler();
}

// --- Función interna de dibujo de notas ---
// Colores RGB base por octava — idénticos al panel de etiquetas de notas
export const _OCT_RGB = {
    1: [255, 102, 102],   // rojo    (Do1 - graves)
    2: [255, 153,  68],   // naranja (Do2)
    3: [221, 221,  68],   // amarillo(Do3)
    4: [ 68, 221,  68],   // verde   (Do4 - centro)
    5: [ 68, 136, 255],   // azul    (Do5)
    6: [187, 102, 255],   // violeta (Do6 - agudos)
};

/**
 * Paleta heat map de alto contraste: azul → verde → naranja → rojo
 * En modo heat ignoramos el brillo de velocity para que las notas
 * comprimidas (velocity baja) no queden todas oscuras.
 * heat=0.0 → azul oscuro   rgb(15, 30, 120)  — nota subordinada
 * heat=0.3 → cian-verde     rgb(10, 130, 140)
 * heat=0.6 → verde-amarillo rgb(60, 200, 50)
 * heat=0.8 → naranja        rgb(255, 140, 0)
 * heat=1.0 → rojo brillante rgb(255, 30, 0)  — nota dominante
 */
function _heatColor(heat, or, og, ob, bright) {
    // Paleta de 5 puntos de control (cold → hot)
    const stops = [
        [15,  30, 120],   // 0.0 azul
        [10, 130, 140],   // 0.25 cian
        [60, 200,  50],   // 0.5  verde
        [255, 140,  0],   // 0.75 naranja
        [255,  30,  0],   // 1.0  rojo
    ];
    const t = Math.max(0, Math.min(1, heat));
    const seg = t * (stops.length - 1);
    const lo  = Math.floor(seg);
    const hi  = Math.min(lo + 1, stops.length - 1);
    const f   = seg - lo;
    return [
        Math.round(stops[lo][0] + (stops[hi][0] - stops[lo][0]) * f),
        Math.round(stops[lo][1] + (stops[hi][1] - stops[lo][1]) * f),
        Math.round(stops[lo][2] + (stops[hi][2] - stops[lo][2]) * f),
    ];
}

function _drawNotes(highlightClasses, hlStartStep = null, hlEndStep = null) {
    const selCells = getSelCells();
    const [firstRow, lastRow] = _visibleRowRange();
    for (const [key, cell] of Object.entries(state.gridData.cells)) {
        const [noteStr, stepStr] = key.split(',');
        const note     = parseInt(noteStr);
        const step     = parseInt(stepStr);
        const rowIndex = state.noteRows.indexOf(note);
        if (rowIndex === -1) continue;
        // Virtualización: omitir notas fuera de la banda de filas visible
        if (rowIndex < firstRow || rowIndex > lastRow) continue;

        const y = rowIndex * state.rowHeight;
        const x = step * state.stepWidth;
        const w = cell.duration * state.stepWidth;
        const h = state.rowHeight;

        // Color base de la octava
        const oct          = Math.max(1, Math.min(6, Math.floor(note / 12) - 1));
        const [or, og, ob] = _OCT_RGB[oct];

        // Degradado por velocidad: 0.20 (ppp muy suave) → 1.0 (fff muy fuerte)
        const bright = 0.20 + (cell.velocity / 127) * 0.80;

        const inRange     = hlStartStep === null || (step >= hlStartStep && step < hlEndStep);
        const isHighlight = highlightClasses && highlightClasses.includes(note % 12) && inRange;

        if (isHighlight) {
            // Mezcla 55% color de octava + 45% amarillo dorado → nota reconocible pero destacada
            const hr = Math.round(or * 0.55 + 255 * 0.45);
            const hg = Math.round(og * 0.55 + 220 * 0.45);
            const hb = Math.round(ob * 0.55 +  40 * 0.45);
            ctx.fillStyle   = `rgb(${hr},${hg},${hb})`;
            ctx.strokeStyle = 'gold';
            ctx.lineWidth   = 2;
        } else if (state.interpretPreviewActive && state.interpretPreviewData) {
            // Vista previa de interpretación (Fase 5): color por relevance fusionada
            const rel        = state.interpretPreviewData.get(key) ?? 0.5;
            const [fr, fg, fb] = _heatColor(rel, or, og, ob, bright);
            ctx.fillStyle    = `rgb(${fr},${fg},${fb})`;
            ctx.strokeStyle  = rel > 0.75 ? 'rgba(255,60,0,0.9)' : 'rgba(0,0,0,0.35)';
            ctx.lineWidth    = rel > 0.75 ? 1.5 : 0.5;
        } else {
            // Modo normal: color por octava + brillo por velocity
            const r = Math.round(or * bright);
            const g = Math.round(og * bright);
            const b = Math.round(ob * bright);
            ctx.fillStyle   = `rgb(${r},${g},${b})`;
            ctx.strokeStyle = 'rgba(0,0,0,0.35)';
            ctx.lineWidth   = 0.5;
        }

        // Motor muteado: sobreescribir color con gris semitransparente + raya diagonal
        if (motorForNote(note)?.muted) {
            ctx.fillStyle   = 'rgba(55,55,55,0.55)';
            ctx.strokeStyle = 'rgba(130,130,130,0.6)';
            ctx.lineWidth   = 0.5;
        }

        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);

        // Raya diagonal sobre nota muteada
        if (motorForNote(note)?.muted) {
            ctx.save();
            ctx.strokeStyle = 'rgba(200,60,60,0.55)';
            ctx.lineWidth   = 1;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + w, y + h);
            ctx.stroke();
            ctx.restore();
        }

        // Resaltar nota seleccionada (selección rectangular)
        if (selCells.has(key)) {
            ctx.save();
            ctx.fillStyle   = 'rgba(100,180,255,0.25)';
            ctx.strokeStyle = 'rgba(120,200,255,0.95)';
            ctx.lineWidth   = 2;
            ctx.fillRect  (x + 1, y + 1, w - 2, h - 2);
            ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
            ctx.restore();
        }

        // Glow de edición de velocidad: la(s) celda(s) del paso que el usuario
        // está editando en el carril. Si hay fragmento activo, solo sus clases.
        if (state.velEditStep === step && (!highlightClasses || (highlightClasses.includes(note % 12) && inRange))) {
            ctx.save();
            ctx.shadowColor = 'rgba(255,220,0,0.9)';
            ctx.shadowBlur  = 12;
            ctx.strokeStyle = 'rgba(255,220,0,0.95)';
            ctx.lineWidth   = 2;
            ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
            ctx.restore();
        }

    }
    ctx.lineWidth = 0.5;
}

// Dibuja el rectángulo semitransparente mientras el usuario arrastra una selección
function _drawSelectionOverlay() {
    const { dragging, start, end } = getSelDrag();
    if (!dragging || !start || !end) return;
    const s1 = Math.min(start.step,     end.step);
    const s2 = Math.max(start.step,     end.step);
    const r1 = Math.min(start.rowIndex, end.rowIndex);
    const r2 = Math.max(start.rowIndex, end.rowIndex);
    ctx.save();
    ctx.fillStyle   = 'rgba(100,180,255,0.15)';
    ctx.strokeStyle = 'rgba(120,200,255,0.85)';
    ctx.lineWidth   = 1.5;
    ctx.fillRect  (s1 * state.stepWidth,   r1 * state.rowHeight,
                   (s2 - s1 + 1) * state.stepWidth, (r2 - r1 + 1) * state.rowHeight);
    ctx.strokeRect(s1 * state.stepWidth,   r1 * state.rowHeight,
                   (s2 - s1 + 1) * state.stepWidth, (r2 - r1 + 1) * state.rowHeight);
    ctx.restore();
}

