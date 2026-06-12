// ============================================================
// piano-roll.js — Construcción del grid y renderizado en canvas
// Depende de: state.js  (canvas y ctx se declaran en main.js)
// ============================================================

/**
 * Construye gridData a partir de los eventos noteOn/noteOff del canal seleccionado,
 * redimensiona el canvas y dibuja el piano roll.
 * @param {number} channel - Canal MIDI (0-15)
 */
function buildGridFromChannel(channel) {
    const channelEvents = rawEvents
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
    ticksPerStep = ppqn / 4;
    totalSteps   = Math.ceil(totalTicks / ticksPerStep);

    // Convertir tempoMap (ticks → pasos) en tempoPoints editables
    tempoPoints = tempoMap
        .map(t => ({ step: Math.round(t.tick / ticksPerStep), bpm: Math.round(t.bpm) }))
        .filter((t, i, arr) => i === 0 || t.step !== arr[i - 1].step);
    if (!tempoPoints.length || tempoPoints[0].step !== 0)
        tempoPoints.unshift({ step: 0, bpm: tempoPoints[0]?.bpm || 120 });
    const _bpmEl = document.getElementById('bpmInput');
    if (_bpmEl) _bpmEl.value = Math.round(tempoPoints[0].bpm);

    // Límite de seguridad del canvas (~32.767px max en la mayoría de navegadores).
    // Si la canción es muy larga, reducimos stepWidth automáticamente.
    const MAX_CANVAS_W = 16000; // margen conservador
    if (totalSteps * stepWidth > MAX_CANVAS_W) {
        stepWidth = Math.max(2, Math.floor(MAX_CANVAS_W / totalSteps));
        console.warn(`[piano-roll] Canvas demasiado ancho. stepWidth reducido a ${stepWidth}px (${totalSteps} pasos)`);
    }

    // Rango de notas visible (con margen de una octava)
    let minNote = 127, maxNote = 0;
    for (const n of notesList) {
        if (n.note < minNote) minNote = n.note;
        if (n.note > maxNote) maxNote = n.note;
    }
    minNote  = Math.max(0,   minNote - 12);
    maxNote  = Math.min(127, maxNote + 12);
    noteRows = [];
    for (let n = minNote; n <= maxNote; n++) noteRows.push(n);

    // Convertir notas a celdas del grid
    gridData = { cells: {} };
    for (const n of notesList) {
        const startStep = Math.floor(n.tickOn / ticksPerStep);
        const endStep   = Math.floor((n.tickOff - 1) / ticksPerStep);
        const duration  = endStep - startStep + 1;
        if (duration <= 0) continue;
        const _minVel = parseInt(document.getElementById('midiImportMinVel')?.value) || 1;
        const _maxVel = parseInt(document.getElementById('midiImportMaxVel')?.value) || 40;
        gridData.cells[`${n.note},${startStep}`] = { duration, velocity: Math.max(_minVel, Math.round(n.velocity / 127 * _maxVel)) };
    }

    // Redimensionar canvas
    canvas.width  = totalSteps * stepWidth;
    canvas.height = noteRows.length * rowHeight;
    canvas.style.width  = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;

    drawPianoRoll();
    drawNoteLabels();
}

/**
 * Dibuja el fondo de cuadrícula y todas las notas del gridData actual.
 */
function drawPianoRoll() {
    if (!ctx) return;
    canvas.width  = totalSteps * stepWidth;
    canvas.height = noteRows.length * rowHeight;
    canvas.style.width  = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const CT = window.CANVAS_THEME || {};
    const rowAlt  = CT.rowAlt  || '#1e1e28';
    const grid    = CT.grid    || '#3a3a50';
    const gridBar = CT.gridBar || '#555555';
    const label   = CT.label   || '#666666';

    // Fondo: notas negras del teclado (sostenidos/bemoles) en gris más oscuro
    const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
    for (let row = 0; row < noteRows.length; row++) {
        if (BLACK_KEYS.has(noteRows[row] % 12)) {
            ctx.fillStyle = rowAlt;
            ctx.fillRect(0, row * rowHeight, canvas.width, rowHeight);
        }
    }

    // Cuadrícula
    for (let step = 0; step <= totalSteps; step++) {
        ctx.strokeStyle = (step % 16 === 0) ? gridBar : grid;
        ctx.lineWidth   = (step % 16 === 0) ? 1 : 0.5;
        const x = step * stepWidth;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    ctx.strokeStyle = grid;
    ctx.lineWidth = 0.5;
    for (let row = 0; row <= noteRows.length; row++) {
        const y = row * rowHeight;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    // Notas
    _drawNotes(null);

    // Numeración de compases
    ctx.fillStyle = label;
    ctx.font = "9px monospace";
    for (let step = 0; step < totalSteps; step += 16) {
        ctx.fillText(`${step / 16 + 1}`, step * stepWidth + 2, 10);
    }
}

/**
 * Dibuja el piano roll y, opcionalmente, un playhead amarillo.
 * @param {number} playheadStep - Paso del playhead, o -1 para no dibujarlo.
 */
function drawPianoRollWithPlayhead(playheadStep) {
    if (typeof activeHighlight !== 'undefined' && activeHighlight) {
        drawPianoRollWithHighlight(activeHighlight.classes, activeHighlight.startStep, activeHighlight.endStep);
    } else {
        drawPianoRoll();
    }
    if (playheadStep >= 0) {
        const phColor = (window.CANVAS_THEME && window.CANVAS_THEME.playhead) || 'rgba(255,230,0,0.9)';
        const x = playheadStep * stepWidth;
        ctx.save();
        ctx.strokeStyle = phColor;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
        ctx.restore();
    }
    _drawSelectionOverlay();
    if (typeof drawVelocityLane === 'function') drawVelocityLane();
    if (typeof drawMinimap      === 'function') drawMinimap();
}

/**
 * Dibuja el piano roll con highlight de notas Y playhead simultáneamente.
 * Usado durante la reproducción cuando el popup de acorde está visible.
 */
function drawPianoRollWithHighlightAndPlayhead(chordClasses, hlStartStep, hlEndStep, playheadStep) {
    drawPianoRollWithHighlight(chordClasses, hlStartStep, hlEndStep);
    if (playheadStep >= 0) {
        const phColor = (window.CANVAS_THEME && window.CANVAS_THEME.playhead) || 'rgba(255,230,0,0.9)';
        const x = playheadStep * stepWidth;
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
function drawPianoRollWithHighlight(chordClasses, hlStartStep = null, hlEndStep = null) {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const CT2 = window.CANVAS_THEME || {};
    const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
    for (let row = 0; row < noteRows.length; row++) {
        if (BLACK_KEYS.has(noteRows[row] % 12)) {
            ctx.fillStyle = CT2.rowAlt || '#1e1e28';
            ctx.fillRect(0, row * rowHeight, canvas.width, rowHeight);
        }
    }
    ctx.strokeStyle = CT2.grid || '#3a3a50'; ctx.lineWidth = 0.5;
    for (let step = 0; step <= totalSteps; step++) {
        const x = step * stepWidth;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let row = 0; row <= noteRows.length; row++) {
        const y = row * rowHeight;
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
function drawNoteLabels() {
    const labelsCanvas = document.getElementById('noteLabelsCanvas');
    if (!labelsCanvas || noteRows.length === 0) return;

    const h = noteRows.length * rowHeight;
    labelsCanvas.height       = h;
    labelsCanvas.style.height = `${h}px`;

    const lCtx = labelsCanvas.getContext('2d');
    lCtx.clearRect(0, 0, _LABEL_W, h);

    for (let i = 0; i < noteRows.length; i++) {
        const note    = noteRows[i];
        const y       = i * rowHeight;
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
        lCtx.fillRect(0, y, _LABEL_W, rowHeight);

        // Franja izquierda coloreada por octava
        lCtx.fillStyle = col.stripe;
        lCtx.fillRect(0, y + 1, 6, rowHeight - 1);

        // Línea divisoria en cada Do (más visible)
        if (isC) {
            lCtx.strokeStyle = col.text;
            lCtx.lineWidth = 1;
            lCtx.beginPath();
            lCtx.moveTo(0, y); lCtx.lineTo(_LABEL_W, y);
            lCtx.stroke();
        }

        // Texto
        const fontSize = Math.min(13, rowHeight - 2);
        if (fontSize < 5) continue;

        const showLabel = rowHeight >= 10 || isC;
        if (!showLabel) continue;

        const motorCfg = (typeof motorForNote === 'function') ? motorForNote(note) : null;

        lCtx.textAlign    = "right";
        lCtx.textBaseline = "middle";

        if (motorCfg !== null && rowHeight >= 16) {
            // Nota con motor: nombre arriba, número de motor abajo
            const halfSize = Math.max(7, Math.floor(fontSize * 0.75));
            lCtx.font      = isC ? `bold ${halfSize}px monospace` : `${halfSize}px monospace`;
            lCtx.fillStyle = col.text;
            lCtx.fillText(isC ? `C${octave}` : name, _LABEL_W - 4, y + rowHeight * 0.32);
            lCtx.font      = `bold ${halfSize}px monospace`;
            lCtx.fillStyle = '#ffcc44';
            lCtx.fillText(`m:${motorCfg.motor}`, _LABEL_W - 4, y + rowHeight * 0.72);
        } else {
            lCtx.font      = isC ? `bold ${fontSize}px monospace` : `${fontSize}px monospace`;
            lCtx.fillStyle = col.text;
            lCtx.fillText(isC ? `C${octave}` : name, _LABEL_W - 4, y + rowHeight / 2);
        }
    }
}

// ---- Interacción con la columna de etiquetas ----

/**
 * Registra los eventos de la columna de notas:
 * - mousedown → toca la nota y resalta la fila
 * - mouseup / mouseleave → suelta la nota
 */
function initNoteLabelsEvents() {
    const labelsCanvas = document.getElementById('noteLabelsCanvas');
    if (!labelsCanvas) return;

    let _activeNote = null;

    function _noteFromY(clientY) {
        const rect     = labelsCanvas.getBoundingClientRect();
        const mouseY   = (clientY - rect.top) * (labelsCanvas.height / rect.height);
        const rowIndex = Math.floor(mouseY / rowHeight);
        if (rowIndex < 0 || rowIndex >= noteRows.length) return null;
        return { note: noteRows[rowIndex], rowIndex };
    }

    function _startNote(clientY) {
        const hit = _noteFromY(clientY);
        if (!hit) return;
        _activeNote = hit.note;
        const offset = (typeof transposeOffset !== 'undefined') ? transposeOffset : 0;
        const transposedNote = hit.note + offset;

        if (soundfontLoaded && typeof MIDI !== 'undefined' && MIDI.noteOn) {
            MIDI.noteOn(0, transposedNote, 90, 0);
        }

        // Disparar motor físico — motorForNote ya aplica transposeOffset internamente
        if (typeof motorForNote === 'function' && typeof sendCommand === 'function') {
            const entry = motorForNote(hit.note);
            if (entry && typeof entry.motor === 'number') {
                const vel = 80;  // velocidad fija para click manual
                const cmd = `e; m ${entry.motor}; o ${entry.homePwm}; t 80; v ${vel}; t 150; v 0; p;`;
                console.log(`[_startNote] Motor: ${entry.motor}, note: ${hit.note}, transposedNote: ${transposedNote}, cmd: ${cmd}`);
                sendCommand(cmd);
            } else {
                console.warn(`[_startNote] No motor found for transposedNote: ${transposedNote}`);
            }
        } else {
            console.warn(`[_startNote] sendCommand not available or motorForNote not defined`);
        }

        _highlightLabelRow(hit.rowIndex, true);
    }

    function _stopNote() {
        if (_activeNote === null) return;
        const offset = (typeof transposeOffset !== 'undefined') ? transposeOffset : 0;
        const transposedNote = _activeNote + offset;
        if (soundfontLoaded && typeof MIDI !== 'undefined' && MIDI.noteOff) {
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
        lCtx.fillRect(0, rowIndex * rowHeight, _LABEL_W, rowHeight);
        lCtx.restore();
    } else {
        // Redibujar solo para limpiar el overlay
        drawNoteLabels();
    }
}

// ============================================================
// ── toggleNewGridPanel — abre/cierra el panel de selección ───
function toggleNewGridPanel() {
    const panel = document.getElementById('newGridPanel');
    const btn   = document.getElementById('newGridBtn');
    if (!panel) return;
    const visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : '';
    if (btn) btn.classList.toggle('btn-active', !visible);
}

// ── _doLoadBlankGrid — crea el grid con el nº de compases elegido ──
function _doLoadBlankGrid(measures) {
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

    const spm = currentTimeSig.stepsPerMeasure;  // 16 en 4/4

    // Resetear estado
    gridData          = { cells: {} };
    noteRows          = motorNotes;
    ppqn              = 96;
    ticksPerStep      = ppqn / 4;
    totalSteps        = measures * spm;
    stepWidth         = 8;
    midiData          = null;
    rawEvents         = [];
    tempoMap          = [{ tick: 0, bpm }];
    pasoActual        = 0;

    // Sincronizar BPM con el input de la toolbar
    const toolbarBpm = document.getElementById('bpmInput');
    if (toolbarBpm) toolbarBpm.value = bpm;

    // Limpiar análisis armónico, frases, respiración y nombre MIDI
    currentHarmonicSegments = [];
    currentFusedSegments    = [];
    currentPhraseSegments   = [];
    breathingSegments       = [];
    currentKey              = 'C';
    currentMidiFileName     = '';
    const chordRow = document.getElementById('chordRowContainer');
    if (chordRow) chordRow.innerHTML = '';

    tempoPoints = [{ step: 0, bpm }];
    if (typeof historyClear === 'function') historyClear();

    // Redimensionar canvas y redibujar (resetea zoom label al default 40/25)
    applyZoom(40, 25);

    // Habilitar transporte y botones de compases
    playBtn.disabled  = false;
    _enableMeasureButtons();
    const abBtn = document.getElementById('abLoopBtn');
    if (abBtn) abBtn.disabled = false;
    statusSpan.innerText = `Grid vacío · ${motorNotes.length} notas · ${measures} compás${measures > 1 ? 'es' : ''} · ${bpm} BPM`;

    // Actualizar nombre del tab
    if (typeof tabMarkFileLoaded === 'function')
        tabMarkFileLoaded(`Sin título · ${measures} comp.`);
}

// Alias de compatibilidad por si algo lo llama directamente
function loadBlankGrid() { toggleNewGridPanel(); }

// ── Zoom ─────────────────────────────────────────────────────
/**
 * Aplica un nuevo zoom horizontal (stepWidth) y/o vertical (rowHeight).
 * Redibujar todos los layers y restaura el scroll para que el punto
 * central visible no salte.
 */
function applyZoom(newStepWidth, newRowHeight) {
    if (!totalSteps || !noteRows.length) return;

    const container = document.getElementById('gridScroll');
    // Guardar el paso que está en el centro del viewport para restaurarlo
    const centerStep = container
        ? (container.scrollLeft + container.clientWidth / 2) / stepWidth
        : 0;

    stepWidth = Math.max(8,  Math.min(80, Math.round(newStepWidth)));
    rowHeight = Math.max(10, Math.min(50, Math.round(newRowHeight)));

    // Redibujar todos los layers (drawPianoRoll ya redimensiona el canvas)
    drawPianoRollWithPlayhead(typeof pasoActual !== 'undefined' ? pasoActual : -1);
    drawNoteLabels();
    drawTimelineRuler();

    // Redibujar chord row si hay análisis armónico
    if (currentHarmonicSegments && currentHarmonicSegments.length) {
        const key = {
            tonic: currentKey.replace('m', ''),
            mode:  currentKey.endsWith('m') ? 'minor' : 'major',
            rootClass: 0
        };
        drawChordRow(currentHarmonicSegments, key);
    }

    // Restaurar scroll centrado en el mismo paso
    if (container) {
        container.scrollLeft = Math.max(0, centerStep * stepWidth - container.clientWidth / 2);
    }

    // Actualizar indicador visual en toolbar
    const lbl = document.getElementById('zoomLabel');
    if (lbl) lbl.textContent = stepWidth;
}

function zoom(dir) { applyZoom(stepWidth + dir * 8, rowHeight + dir * 5); }

// ── addMeasures / removeMeasures ─────────────────────────────
function _phraseMeasures() {
    const sel = document.getElementById('phraseUnitSelect');
    return sel ? parseInt(sel.value) : 4;
}

function _enableMeasureButtons() {
    const a = document.getElementById('addMeasuresBtn');
    const r = document.getElementById('removeMeasuresBtn');
    if (a) a.disabled = false;
    if (r) r.disabled = false;
}

function addMeasures(n) {
    if (!totalSteps) return;
    const m = n || _phraseMeasures();
    totalSteps += m * currentTimeSig.stepsPerMeasure;
    canvas.width       = totalSteps * stepWidth;
    canvas.style.width = `${canvas.width}px`;
    drawPianoRoll();
    drawTimelineRuler();
    statusSpan.innerText = `${Math.round(totalSteps / currentTimeSig.stepsPerMeasure)} compases`;
}

function removeMeasures(n) {
    if (!totalSteps) return;
    const m       = n || _phraseMeasures();
    const spm     = currentTimeSig.stepsPerMeasure;
    const cutStep = totalSteps - m * spm;
    if (cutStep < spm) { statusSpan.innerText = 'Mínimo 1 compás'; return; }

    // Avisar si hay notas en los compases a eliminar
    const hasNotes = Object.keys(gridData.cells).some(k => parseInt(k.split(',')[1]) >= cutStep);
    if (hasNotes && !confirm(`¿Eliminar los últimos ${m} compás${m > 1 ? 'es' : ''} con sus notas?`)) return;

    // Borrar celdas fuera del nuevo rango
    for (const key of Object.keys(gridData.cells)) {
        if (parseInt(key.split(',')[1]) >= cutStep) delete gridData.cells[key];
    }

    totalSteps = cutStep;
    if (pasoActual >= totalSteps) pasoActual = totalSteps - 1;

    canvas.width       = totalSteps * stepWidth;
    canvas.style.width = `${canvas.width}px`;
    drawPianoRoll();
    drawTimelineRuler();
    statusSpan.innerText = `${Math.round(totalSteps / spm)} compases`;
}

// --- Función interna de dibujo de notas ---
// Colores RGB base por octava — idénticos al panel de etiquetas de notas
const _OCT_RGB = {
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

/**
 * Dibuja un marcador de calor (punto brillante) sobre una nota dominante
 */
function _drawHeatSymbol(ctx, x, y, w, h, heat) {
    ctx.save();
    // Punto blanco-amarillento, tamaño proporcional al heat
    const r = Math.min(3, Math.max(1.5, heat * 4));
    const cx = x + r + 2;   // Posición en extremo izquierdo de la nota
    const cy = y + h / 2;   // Centrado verticalmente
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 200, ${0.5 + heat * 0.5})`;
    ctx.fill();
    ctx.restore();
}

function _drawNotes(highlightClasses, hlStartStep = null, hlEndStep = null) {
    for (const [key, cell] of Object.entries(gridData.cells)) {
        const [noteStr, stepStr] = key.split(',');
        const note     = parseInt(noteStr);
        const step     = parseInt(stepStr);
        const rowIndex = noteRows.indexOf(note);
        if (rowIndex === -1) continue;

        const y = rowIndex * rowHeight;
        const x = step * stepWidth;
        const w = cell.duration * stepWidth;
        const h = rowHeight;

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
        } else if (heatMapActive && heatMapData) {
            // Modo heat map: interpolar frío-caliente según score de dominancia
            const heat       = heatMapData.get(key) ?? 0.5;
            const [fr, fg, fb] = _heatColor(heat, or, og, ob, bright);
            ctx.fillStyle    = `rgb(${fr},${fg},${fb})`;
            // Borde más grueso y coloreado para notas muy calientes
            ctx.strokeStyle  = heat > 0.75 ? 'rgba(255,60,0,0.9)' : 'rgba(0,0,0,0.35)';
            ctx.lineWidth    = heat > 0.75 ? 1.5 : 0.5;
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
        if (typeof motorForNote === 'function') {
            const _motor = motorForNote(note);
            if (_motor?.muted) {
                ctx.fillStyle   = 'rgba(55,55,55,0.55)';
                ctx.strokeStyle = 'rgba(130,130,130,0.6)';
                ctx.lineWidth   = 0.5;
            }
        }

        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);

        // Raya diagonal sobre nota muteada
        if (typeof motorForNote === 'function' && motorForNote(note)?.muted) {
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
        if (typeof _selCells !== 'undefined' && _selCells.has(key)) {
            ctx.save();
            ctx.fillStyle   = 'rgba(100,180,255,0.25)';
            ctx.strokeStyle = 'rgba(120,200,255,0.95)';
            ctx.lineWidth   = 2;
            ctx.fillRect  (x + 1, y + 1, w - 2, h - 2);
            ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
            ctx.restore();
        }

        // Dibuja símbolo de calor sobre notas muy dominantes
        if (heatMapActive && heatMapData && w >= 8) {
            const heat = heatMapData.get(key) ?? 0;
            if (heat > 0.80) _drawHeatSymbol(ctx, x, y, w, h, heat);
        }
    }
    ctx.lineWidth = 0.5;
}

// Dibuja el rectángulo semitransparente mientras el usuario arrastra una selección
function _drawSelectionOverlay() {
    if (typeof _selDragging === 'undefined' || !_selDragging) return;
    if (!_selDragStart || !_selDragEnd) return;
    const s1 = Math.min(_selDragStart.step,     _selDragEnd.step);
    const s2 = Math.max(_selDragStart.step,     _selDragEnd.step);
    const r1 = Math.min(_selDragStart.rowIndex, _selDragEnd.rowIndex);
    const r2 = Math.max(_selDragStart.rowIndex, _selDragEnd.rowIndex);
    ctx.save();
    ctx.fillStyle   = 'rgba(100,180,255,0.15)';
    ctx.strokeStyle = 'rgba(120,200,255,0.85)';
    ctx.lineWidth   = 1.5;
    ctx.fillRect  (s1 * stepWidth,   r1 * rowHeight,
                   (s2 - s1 + 1) * stepWidth, (r2 - r1 + 1) * rowHeight);
    ctx.strokeRect(s1 * stepWidth,   r1 * rowHeight,
                   (s2 - s1 + 1) * stepWidth, (r2 - r1 + 1) * rowHeight);
    ctx.restore();
}

