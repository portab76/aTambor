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
            pendingNotes.set(ev.note, { tickOn: ev.tick, velocity: ev.velocity });
        } else if (ev.type === 'noteOff' || (ev.type === 'noteOn' && ev.velocity === 0)) {
            if (pendingNotes.has(ev.note)) {
                const on = pendingNotes.get(ev.note);
                notesList.push({ tickOn: on.tickOn, tickOff: ev.tick, note: ev.note, velocity: on.velocity });
                pendingNotes.delete(ev.note);
            }
        }
    }
    // Notas sin noteOff → terminan al final de la canción
    for (const [note, on] of pendingNotes) {
        notesList.push({ tickOn: on.tickOn, tickOff: totalTicks, note, velocity: on.velocity });
    }

    // Resolución: semicorchea = ppqn / 4
    ticksPerStep = ppqn / 4;
    totalSteps   = Math.ceil(totalTicks / ticksPerStep);

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
        gridData.cells[`${n.note},${startStep}`] = { duration, velocity: n.velocity };
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
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Fondo: notas negras del teclado (sostenidos/bemoles) en gris más oscuro
    const BLACK_KEYS = new Set([1, 3, 6, 8, 10]); // clases de nota con sostenido
    for (let row = 0; row < noteRows.length; row++) {
        if (BLACK_KEYS.has(noteRows[row] % 12)) {
            ctx.fillStyle = "#1e1e28";
            ctx.fillRect(0, row * rowHeight, canvas.width, rowHeight);
        }
    }

    // Cuadrícula
    ctx.strokeStyle = "#3a3a50";
    ctx.lineWidth = 0.5;
    for (let step = 0; step <= totalSteps; step++) {
        // Línea de compás (cada 16 pasos = 1 compás 4/4 en semicorcheas) más gruesa
        ctx.strokeStyle = (step % 16 === 0) ? "#555" : "#3a3a50";
        ctx.lineWidth   = (step % 16 === 0) ? 1 : 0.5;
        const x = step * stepWidth;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    ctx.strokeStyle = "#3a3a50";
    ctx.lineWidth = 0.5;
    for (let row = 0; row <= noteRows.length; row++) {
        const y = row * rowHeight;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    // Notas
    _drawNotes(null);

    // Numeración de compases
    ctx.fillStyle = "#666";
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
    drawPianoRoll();
    if (playheadStep >= 0) {
        const x = playheadStep * stepWidth;
        ctx.save();
        ctx.strokeStyle = "rgba(255, 230, 0, 0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
        ctx.restore();
    }
}

/**
 * Redibuja el piano roll resaltando las notas cuya clase esté en chordClasses.
 * @param {Array<number>} chordClasses - Clases de altura (0-11) a resaltar
 */
function drawPianoRollWithHighlight(chordClasses) {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
    for (let row = 0; row < noteRows.length; row++) {
        if (BLACK_KEYS.has(noteRows[row] % 12)) {
            ctx.fillStyle = "#1e1e28";
            ctx.fillRect(0, row * rowHeight, canvas.width, rowHeight);
        }
    }
    ctx.strokeStyle = "#3a3a50"; ctx.lineWidth = 0.5;
    for (let step = 0; step <= totalSteps; step++) {
        const x = step * stepWidth;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let row = 0; row <= noteRows.length; row++) {
        const y = row * rowHeight;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    _drawNotes(chordClasses);
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

        lCtx.font         = isC ? `bold ${fontSize}px monospace` : `${fontSize}px monospace`;
        lCtx.fillStyle    = col.text;
        lCtx.textAlign    = "right";
        lCtx.textBaseline = "middle";
        lCtx.fillText(isC ? `C${octave}` : name, _LABEL_W - 4, y + rowHeight / 2);
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

        if (soundfontLoaded && typeof MIDI !== 'undefined' && MIDI.noteOn) {
            MIDI.noteOn(0, hit.note, 90, 0);
        }
        _highlightLabelRow(hit.rowIndex, true);
    }

    function _stopNote() {
        if (_activeNote === null) return;
        if (soundfontLoaded && typeof MIDI !== 'undefined' && MIDI.noteOff) {
            MIDI.noteOff(0, _activeNote, 0);
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
// loadBlankGrid — Nuevo documento vacío de 1 compás
// Usa las notas del MOTOR_MAP como rango visible.
// ============================================================
function loadBlankGrid() {
    // Confirmar si hay notas en el grid actual
    if (Object.keys(gridData.cells).length > 0) {
        if (!confirm('¿Descartar el grid actual y crear uno nuevo vacío?')) return;
    }

    // Extraer notas únicas del MOTOR_MAP ordenadas ascendente
    const motorNotes = [...new Set(MOTOR_MAP.map(m => m.note))].sort((a, b) => a - b);
    if (motorNotes.length === 0) {
        alert('No hay notas definidas en el Motor Map.');
        return;
    }

    // Resetear estado
    gridData          = { cells: {} };
    noteRows          = motorNotes;
    ppqn              = 96;
    ticksPerStep      = ppqn / 4;   // 24 ticks por semicorchea
    totalSteps        = 16;          // 1 compás de 4/4
    stepWidth         = 40;
    midiData          = null;
    rawEvents         = [];
    tempoMap          = [{ tick: 0, bpm: 120 }];
    pasoActual        = 0;

    // Limpiar análisis armónico
    currentHarmonicSegments = [];
    currentKey = 'C';
    const chordRow = document.getElementById('chordRowContainer');
    if (chordRow) chordRow.innerHTML = '';

    // Redimensionar canvas
    canvas.width        = totalSteps * stepWidth;
    canvas.height       = noteRows.length * rowHeight;
    canvas.style.width  = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;

    drawPianoRoll();
    drawNoteLabels();

    // Habilitar transporte
    playBtn.disabled  = false;
    loopBtn.disabled  = false;
    pauseBtn.disabled = true;
    stopBtn.disabled  = true;

    statusSpan.innerText = `Grid vacío · ${motorNotes.length} notas del Motor Map · 1 compás`;
}

// --- Función interna de dibujo de notas ---
function _drawNotes(highlightClasses) {
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
        const intensity = Math.min(255, Math.floor(cell.velocity * 2));

        const isHighlight = highlightClasses && highlightClasses.includes(note % 12);
        ctx.fillStyle   = isHighlight
            ? `rgb(255, 255, ${Math.max(80, 255 - intensity)})`
            : `rgb(${intensity}, ${200 - intensity}, 100)`;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = isHighlight ? "gold" : "rgba(255,255,255,0.4)";
        ctx.lineWidth   = isHighlight ? 2 : 0.5;
        ctx.strokeRect(x, y, w, h);
    }
    ctx.lineWidth = 0.5;
}
