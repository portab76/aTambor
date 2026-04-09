// ============================================================
// main.js — Punto de entrada: referencias DOM, inicialización
// y cableado de event listeners entre módulos.
// Se carga el último, cuando todos los módulos ya están disponibles.
// ============================================================

// ---- Referencias al DOM (accesibles globalmente por todos los módulos) ----
const fileInput         = document.getElementById('midiFileInput');
const instrumentSelect  = document.getElementById('instrumentSelect');
const loadInstrumentBtn = document.getElementById('loadInstrumentBtn');
const debugDiv          = document.getElementById('debugInfo');
const statusSpan        = document.getElementById('statusMsg');
const playBtn           = document.getElementById('playBtn');
const pauseBtn          = document.getElementById('pauseBtn');
const stopBtn           = document.getElementById('stopBtn');
const loopBtn           = document.getElementById('loopBtn');
const canvas            = document.getElementById('pianoRollCanvas');
const ctx               = canvas.getContext('2d');

// ---- Sincronización de scroll: columna de notas sigue al grid ----
const gridScroll       = document.getElementById('gridScroll');
const notesPanelScroll = document.getElementById('notesPanelScroll');

gridScroll.addEventListener('scroll', () => {
    notesPanelScroll.scrollTop = gridScroll.scrollTop;
    const chordRow = document.getElementById('chordRowContainer');
    if (chordRow) chordRow.scrollLeft = gridScroll.scrollLeft;
});

// ---- Carga de archivo MIDI ----
fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    statusSpan.innerText = "Leyendo archivo...";
    const reader = new FileReader();
    reader.onload = (e) => {
        // Convertir ArrayBuffer → binary string que espera jasmid Stream()
        const bytes = new Uint8Array(e.target.result);
        let binaryString = '';
        for (let i = 0; i < bytes.length; i++) {
            binaryString += String.fromCharCode(bytes[i]);
        }
        loadMIDIFile(binaryString);
    };
    reader.readAsArrayBuffer(file);
});

// ---- Selección de canal/instrumento ----
instrumentSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    selectedChannel          = val === "" ? null : parseInt(val);
    loadInstrumentBtn.disabled = (selectedChannel === null);
});

// ---- Cargar instrumento y mostrar grid ----
loadInstrumentBtn.addEventListener('click', () => {
    if (selectedChannel === null) {
        statusSpan.innerText = "Primero selecciona un canal.";
        return;
    }

    // H2: si hay reproducción activa → hot-swap en caliente
    if (reproduciendo) {
        // Reconstruir el grid con el nuevo canal sin parar el audio
        buildGridFromChannel(selectedChannel);

        // Enviar al ESP32 solo los pasos que quedan por sonar
        if (typeof wsConnected !== 'undefined' && wsConnected) {
            const remaining = buildRemainingSequence(MOTOR_MAP, pasoActual);
            if (remaining) {
                const blocks = validateSequenceSize(remaining);
                sendCommand('APPEND\n' + blocks[0]);
                if (blocks.length > 1) {
                    setTimeout(() => sendCommand('APPEND\n' + blocks[1]), 100);
                }
            }
        }

        // Actualizar análisis armónico sin interrumpir la melodía
        const analysis = performHarmonicAnalysis(selectedChannel);
        if (analysis) {
            currentHarmonicSegments = analysis.segments;
            currentKey = analysis.key.tonic + (analysis.key.mode === 'minor' ? 'm' : '');
            drawChordRow(currentHarmonicSegments, analysis.key);
        }

        // Refrescar panel de notas activas si está abierto
        if (document.getElementById('activeNotesPanel')) activeNotesPanelRefresh();

        statusSpan.innerText =
            `🔄 Instrumento cambiado en caliente · Canal ${selectedChannel + 1} · ` +
            `${Object.keys(gridData.cells).length} notas`;
        return;
    }

    // H2: flujo normal (sin reproducción activa)
    statusSpan.innerText = `Construyendo grid para canal ${selectedChannel + 1}...`;
    buildGridFromChannel(selectedChannel);

    // Análisis armónico
    const analysis = performHarmonicAnalysis(selectedChannel);
    if (analysis) {
        currentHarmonicSegments = analysis.segments;
        currentKey = analysis.key.tonic + (analysis.key.mode === 'minor' ? 'm' : '');
        drawChordRow(currentHarmonicSegments, analysis.key);

        debugDiv.innerHTML +=
            `<br><strong>Análisis armónico:</strong> Tonalidad: ${currentKey} ` +
            `(correlación: ${analysis.key.correlation.toFixed(2)}) | ` +
            `Segmentos: ${currentHarmonicSegments.length}`;
    }

    // Habilitar botón de notas activas
    document.getElementById('activeNotesBtn').disabled = false;

    // Refrescar panel de notas activas si está abierto
    if (document.getElementById('activeNotesPanel')) activeNotesPanelRefresh();

    playBtn.disabled = false;
    loopBtn.disabled = false;

    statusSpan.innerText =
        `Grid listo · Canal ${selectedChannel + 1} · ` +
        `${Object.keys(gridData.cells).length} notas · ` +
        `Tonalidad: ${currentKey}`;

    debugDiv.innerHTML +=
        `<br><strong>Grid generado:</strong> ${instrumentNames[selectedChannel]}, ` +
        `Pasos=${totalSteps}, Rango=${noteRows[0]}–${noteRows[noteRows.length - 1]}, ` +
        `Zoom=${stepWidth}px/paso, Canvas=${canvas.width}×${canvas.height}px`;
});

// ---- Botón notas activas ----
document.getElementById('activeNotesBtn').addEventListener('click', function () {
    activeNotesPanelToggle();
    this.classList.toggle('active', !!document.getElementById('activeNotesPanel'));
});

// ---- Botones de reproducción ----
playBtn.onclick  = play;
pauseBtn.onclick = pause;
stopBtn.onclick  = stop;
loopBtn.onclick  = toggleLoop;

// ---- Botones de persistencia ----
document.getElementById('exportMidiBtn')?.addEventListener('click', exportToMIDI);
document.getElementById('saveProjectBtn')?.addEventListener('click', saveProject);
document.getElementById('loadProjectBtn')?.addEventListener('click', () => {
    document.getElementById('loadProjectInput').click();
});
document.getElementById('loadProjectInput')?.addEventListener('change', (e) => {
    if (e.target.files[0]) loadProject(e.target.files[0]);
});

// ---- Inicializar eventos del canvas (editor.js) ----
initCanvasEvents();

// ---- Inicializar eventos de la columna de notas (piano-roll.js) ----
initNoteLabelsEvents();

// ---- Inicializar MIDI.js y SoundFont ----
function initMIDI() {
    MIDI.loadPlugin({
        soundfontUrl: "./MIDI.js/examples/soundfont/",
        instrument:   currentInstrument,
        onsuccess: () => {
            soundfontLoaded = true;
            statusSpan.innerText = "SoundFont listo. Carga un archivo MIDI.";
            console.log("MIDI.js: SoundFont cargado.");
            if (midiData) enableInstrumentSelection();

            // H1: conectar con el ESP32 una vez el audio está listo
            initWebSocket();
        },
        onerror: (err) => {
            console.error("Error SoundFont:", err);
            statusSpan.innerText = "SoundFont no disponible (reproducción desactivada).";
            // Intentar conectar igualmente — los servos funcionan sin audio
            initWebSocket();
        }
    });
}

initMIDI();
