// ============================================================
// main.js — Punto de entrada: referencias DOM, inicialización
// y cableado de event listeners entre módulos.
// Se carga el último, cuando todos los módulos ya están disponibles.
// ============================================================

// ---- Helper: devuelve el array de segmentos según nivel seleccionado ----
function _activeSegmentsFor(level, analysis) {
    if (level === 'frases'  && analysis?.phraseSegments?.length) return analysis.phraseSegments;
    if (level === 'acordes' && analysis?.fusedSegments?.length)  return analysis.fusedSegments;
    return analysis?.segments || currentHarmonicSegments;
}

// ---- Referencias al DOM (accesibles globalmente por todos los módulos) ----
const fileInput         = document.getElementById('midiFileInput');
const instrumentSelect  = document.getElementById('instrumentSelect');
const loadInstrumentBtn = document.getElementById('loadInstrumentBtn');
const debugDiv          = document.getElementById('debugInfo');
const statusSpan        = document.getElementById('statusMsg');
const playBtn           = document.getElementById('playBtn');
const stopBtn           = document.getElementById('stopBtn');
const canvas            = document.getElementById('pianoRollCanvas');
const ctx               = canvas.getContext('2d');

// ---- Sincronización de scroll: columna de notas sigue al grid ----
const gridScroll       = document.getElementById('gridScroll');
const notesPanelScroll = document.getElementById('notesPanelScroll');

gridScroll.addEventListener('scroll', () => {
    notesPanelScroll.scrollTop = gridScroll.scrollTop;
    const chordRow = document.getElementById('chordRowContainer');
    if (chordRow) chordRow.scrollLeft = gridScroll.scrollLeft;
    const ruler = document.getElementById('rulerScrollArea');
    if (ruler) ruler.scrollLeft = gridScroll.scrollLeft;
});

// ---- Carga de archivo MIDI ----
fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    currentMidiFileName = file.name;
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
        drawTimelineRuler();

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
    drawTimelineRuler();

    // Análisis armónico
    const analysis = performHarmonicAnalysis(selectedChannel);
    if (analysis) {
        currentHarmonicSegments = analysis.segments;
        currentFusedSegments    = analysis.fusedSegments;
        currentPhraseSegments   = analysis.phraseSegments;
        currentKey = analysis.key.tonic + (analysis.key.mode === 'minor' ? 'm' : '');

        // Habilitar select y opción frases
        const sel = document.getElementById('viewLevelSelect');
        sel.disabled = false;
        sel.value = 'acordes';
        sel.querySelector('option[value="frases"]').disabled = (currentPhraseSegments.length === 0);

        drawChordRow(_activeSegmentsFor(sel.value, analysis), analysis.key);

        // Conteo de cadencias por tipo
        const cadCounts = currentPhraseSegments.reduce((acc, p) => {
            acc[p.cadenceType] = (acc[p.cadenceType] || 0) + 1; return acc;
        }, {});
        const cadText = Object.entries(cadCounts)
            .map(([t, n]) => `${n} ${t}`).join(', ') || '—';

        debugDiv.innerHTML +=
            `<br><strong>Análisis armónico:</strong> Tonalidad: ${currentKey} ` +
            `(correlación: ${analysis.key.correlation.toFixed(2)}) | ` +
            `Segmentos: ${currentHarmonicSegments.length} | ` +
            `Bloques fusionados: ${currentFusedSegments.length} (cada ${fusionStepsPerUnit} pasos) | ` +
            `Frases: ${currentPhraseSegments.length} (${cadText})`;
    }

    // Habilitar botón de notas activas
    document.getElementById('activeNotesBtn').disabled = false;

    // Refrescar panel de notas activas si está abierto
    if (document.getElementById('activeNotesPanel')) activeNotesPanelRefresh();

    playBtn.disabled = false;
    _enableMeasureButtons();
    const abBtn = document.getElementById('abLoopBtn');
    if (abBtn) abBtn.disabled = false;

    statusSpan.innerText =
        `Grid listo · Canal ${selectedChannel + 1} · ` +
        `${Object.keys(gridData.cells).length} notas · ` +
        `Tonalidad: ${currentKey}`;

    debugDiv.innerHTML +=
        `<br><strong>Grid generado:</strong> ${instrumentNames[selectedChannel]}, ` +
        `Pasos=${totalSteps}, Rango=${noteRows[0]}–${noteRows[noteRows.length - 1]}, ` +
        `Zoom=${stepWidth}px/paso, Canvas=${canvas.width}×${canvas.height}px`;
});

// ---- Select nivel de vista armónica ----
document.getElementById('viewLevelSelect').addEventListener('change', function () {
    if (!currentHarmonicSegments.length) return;
    const key = { tonic: currentKey.replace('m', ''), mode: currentKey.endsWith('m') ? 'minor' : 'major', rootClass: 0 };
    drawChordRow(_activeSegmentsFor(this.value, {
        segments: currentHarmonicSegments,
        fusedSegments: currentFusedSegments,
        phraseSegments: currentPhraseSegments
    }), key);
});

// ---- Botón notas activas ----
document.getElementById('activeNotesBtn').addEventListener('click', function () {
    activeNotesPanelToggle();
    this.classList.toggle('active', !!document.getElementById('activeNotesPanel'));
});

// ---- Botones de reproducción ----
playBtn.onclick  = play;
stopBtn.onclick  = stop;

// ---- BPM en caliente: reinicia el interval si ya está reproduciendo ----
document.getElementById('bpmInput').addEventListener('change', () => {
    if (!reproduciendo || !_playInterval) return;
    clearInterval(_playInterval);
    _playInterval = setInterval(_tick, MS_PER_STEP());
});

// ---- Botones de persistencia ----
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

// ---- Seek en la regla de compases (timeline-ruler.js) ----
initRulerSeek();

// ---- Log ESP32 en ventana emergente ----
function openEsp32LogWindow() {
    const ip = document.getElementById('esp32IpInput')?.value?.trim() || ESP32_IP;
    const w  = window.open('', 'ESP32Log', 'width=700,height=500,resizable=yes,scrollbars=yes');
    w.document.write(`<!DOCTYPE html><html><head><title>ESP32 Log</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:monospace;background:#111122;color:#00ff88;display:flex;flex-direction:column;height:100vh;padding:8px;gap:6px;}
#tb{display:flex;gap:6px;align-items:center;flex-shrink:0;}
button{background:#1a1a33;border:1px solid #445;color:#aaa;border-radius:4px;padding:3px 10px;cursor:pointer;font-size:11px;}
button:hover{background:#2a2a55;color:#fff;}
#L{flex:1;overflow-y:auto;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all;background:#080816;border:1px solid #2a2a44;border-radius:4px;padding:8px;}
</style></head><body>
<div id="tb">
  <span style="color:#ff4466;font-weight:bold;font-size:12px;letter-spacing:2px">ESP32 LOG</span>
  <span style="font-size:10px;color:#556;">${ip}</span>
  <button onclick="autoScroll=!autoScroll;this.textContent=autoScroll?'▼ Auto':'— Fijo'">▼ Auto</button>
  <button onclick="document.getElementById('L').textContent='';seen=''">🗑 Limpiar</button>
</div>
<pre id="L"></pre>
<script>
var autoScroll=true,seen='';
function u(){
  fetch('http://${ip}/logs').then(r=>r.text()).then(d=>{
    if(d===seen)return;
    var l=document.getElementById('L');
    if(d.startsWith(seen)){l.textContent+=d.slice(seen.length);}else{l.textContent=d;}
    seen=d;
    if(autoScroll)l.scrollTop=l.scrollHeight;
  }).catch(function(){});
}
setInterval(u,600);u();
<\/script></body></html>`);
    w.document.close();
}

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

// ---- Modal de ayuda ----
function showHelpModal() {
    const m = document.getElementById('helpModal');
    m.style.display = 'flex';
    // Cerrar al pulsar fuera del panel interior
    m.onclick = (e) => { if (e.target === m) closeHelpModal(); };
}

function closeHelpModal() {
    document.getElementById('helpModal').style.display = 'none';
}

// Cerrar con Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeHelpModal();
});
