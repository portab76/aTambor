// ============================================================
// main.js — Punto de entrada: referencias DOM, inicialización
// y cableado de event listeners entre módulos.
// Se carga el último, cuando todos los módulos ya están disponibles.
// ============================================================

// ---- Helper: devuelve el array de segmentos según nivel seleccionado ----
function _activeSegmentsFor(level, analysis) {
    if (level === 'respiración' && typeof breathingSegments !== 'undefined' && breathingSegments.length)
        return breathingSegments;
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
    const velLane = document.getElementById('velocityLaneScroll');
    if (velLane) velLane.scrollLeft = gridScroll.scrollLeft;
    if (typeof drawMinimap === 'function') drawMinimap();
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

// ---- Drag & drop de archivos MIDI ----
let _dragEnterCount = 0;  // contador para evitar falsos dragleave en elementos hijos

document.body.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    _dragEnterCount++;
    document.getElementById('dropOverlay').style.display = 'flex';
});

document.body.addEventListener('dragleave', () => {
    _dragEnterCount--;
    if (_dragEnterCount <= 0) {
        _dragEnterCount = 0;
        document.getElementById('dropOverlay').style.display = 'none';
    }
});

document.body.addEventListener('dragover', (e) => { e.preventDefault(); });

document.body.addEventListener('drop', (e) => {
    e.preventDefault();
    _dragEnterCount = 0;
    document.getElementById('dropOverlay').style.display = 'none';

    const file = Array.from(e.dataTransfer.files).find(f => f.name.toLowerCase().endsWith('.mid'));
    if (!file) return;

    // Abrir en nueva tab si la actual ya tiene contenido
    const hasContent = Object.keys(gridData.cells).length > 0 || rawEvents.length > 0;
    if (hasContent && typeof tabNew === 'function') tabNew();

    // Mismo flujo que fileInput change
    currentMidiFileName = file.name;
    statusSpan.innerText = 'Leyendo archivo...';
    const reader = new FileReader();
    reader.onload = (ev) => {
        const bytes = new Uint8Array(ev.target.result);
        let binaryString = '';
        for (let i = 0; i < bytes.length; i++) binaryString += String.fromCharCode(bytes[i]);
        loadMIDIFile(binaryString);

        // Auto-seleccionar el primer canal con notas y construir el grid directamente
        const firstOpt = instrumentSelect.querySelector('option[value]:not([value=""])');
        if (firstOpt) {
            instrumentSelect.value = firstOpt.value;
            instrumentSelect.dispatchEvent(new Event('change'));
            loadInstrumentBtn.click();
        }
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

        // Recalcular heat map y puntos de respiración en modo hot-swap
        _refreshHeatMap();
        calcularBreathingPoints();

        // Refrescar panel de notas activas si está abierto
        if (document.getElementById('activeNotesPanel')) activeNotesPanelRefresh();

        statusSpan.innerText =
            `🔄 Instrumento cambiado en caliente · Canal ${selectedChannel + 1} · ` +
            `${Object.keys(gridData.cells).length} notas`;
        return;
    }

    // H2: flujo normal (sin reproducción activa)
    // Si el tab activo ya tiene contenido, abrir el canal en uno nuevo
    if (Object.keys(gridData.cells).length > 0) {
        const snap = {
            rawEvents:           rawEvents.map(e => ({ ...e })),
            tempoMap:            tempoMap.map(e => ({ ...e })),
            ppqn, totalTicks,
            midiData:            midiData ? JSON.parse(JSON.stringify(midiData)) : null,
            instrumentNames:     [...instrumentNames],
            currentMidiFileName,
            currentTimeSig:      { ...currentTimeSig },
        };
        _tabSaveCurrent();
        const t = _tabDefaults();
        t.rawEvents           = snap.rawEvents;
        t.tempoMap            = snap.tempoMap;
        t.ppqn                = snap.ppqn;
        t.totalTicks          = snap.totalTicks;
        t.midiData            = snap.midiData;
        t.instrumentNames     = [...snap.instrumentNames];
        t.currentMidiFileName = snap.currentMidiFileName;
        t.currentTimeSig      = { ...snap.currentTimeSig };
        t.selectedChannel     = selectedChannel;
        _tabs.push(t);
        _activeTabIdx = _tabs.length - 1;
        _tabRestoreFrom(t);
        // enableInstrumentSelection filtra por canales con noteOn (igual que al cargar el MIDI),
        // evitando que _tabRestoreFrom muestre canales con programChange pero sin notas.
        if (typeof enableInstrumentSelection === 'function') enableInstrumentSelection();
        _tabRender();
    }

    statusSpan.innerText = `Construyendo grid para canal ${selectedChannel + 1}...`;
    buildGridFromChannel(selectedChannel);
    if (typeof historyClear === 'function') historyClear();
    pasoActual = 0;
    drawTimelineRuler();

    // Volver al inicio del grid al cargar un nuevo canal
    const _gs = document.getElementById('gridScroll');
    if (_gs) _gs.scrollLeft = 0;  // el listener de scroll sincroniza chordRow y ruler

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

    // Calcular heat map y respiración
    _refreshHeatMap();
    calcularBreathingPoints();
    const heatBtn = document.getElementById('heatMapBtn');
    if (heatBtn) heatBtn.disabled = false;
    if (heatMapActive) drawPianoRollWithPlayhead(-1);

    // Habilitar opción "respiración" en el selector de vista
    const selResp = document.getElementById('viewLevelSelect');
    if (selResp) selResp.querySelector('option[value="respiración"]').disabled = (breathingSegments.length === 0);

    // Habilitar botón del panel de acordes
    const chordPanelBtn = document.getElementById('chordPanelBtn');
    if (chordPanelBtn) chordPanelBtn.disabled = false;

    statusSpan.innerText =
        `Grid listo · Canal ${selectedChannel + 1} · ` +
        `${Object.keys(gridData.cells).length} notas · ` +
        `Tonalidad: ${currentKey}`;

    debugDiv.innerHTML +=
        `<br><strong>Grid generado:</strong> ${instrumentNames[selectedChannel]}, ` +
        `Pasos=${totalSteps}, Rango=${noteRows[0]}–${noteRows[noteRows.length - 1]}, ` +
        `Zoom=${stepWidth}px/paso, Canvas=${canvas.width}×${canvas.height}px`;

    // Actualizar nombre del tab con el archivo MIDI cargado
    if (typeof tabMarkFileLoaded === 'function') tabMarkFileLoaded(currentMidiFileName);
});

// ---- Select nivel de vista armónica ----
document.getElementById('viewLevelSelect').addEventListener('change', function () {
    if (this.value === 'respiración') {
        if (breathingSegments.length) drawChordRow(breathingSegments, null);
        return;
    }
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

// ---- BPM en caliente: sincroniza tempoPoints[0] y reinicia interval ----
document.getElementById('bpmInput').addEventListener('change', () => {
    const bpm = parseFloat(document.getElementById('bpmInput').value) || 120;
    if (typeof tempoPoints !== 'undefined' && tempoPoints.length) {
        tempoPoints[0].bpm = bpm;
        if (typeof drawTimelineRuler === 'function') drawTimelineRuler();
    }
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

// ---- Inicializar carril de velocidades ----
initVelocityLane();

// ---- Inicializar eventos de la columna de notas (piano-roll.js) ----
initNoteLabelsEvents();

// ---- Seek en la regla de compases (timeline-ruler.js) ----
initRulerSeek();

// ---- Minimap panorámico (minimap.js) ----
initMinimap();

// ---- Log ESP32 en ventana emergente ----
function openEsp32LogWindow() {
    const mode = document.getElementById('connModeSelect')?.value || 'wifi';

    const _isLight = (typeof _currentTheme !== 'undefined') && _currentTheme === 'light';
    const _CSS = _isLight
        ? `*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:monospace;background:#f4f4f8;color:#1a1a2e;display:flex;flex-direction:column;height:100vh;padding:8px;gap:6px;}
#tb{display:flex;gap:6px;align-items:center;flex-shrink:0;}
button{background:#e0e0ec;border:1px solid #bbb;color:#333;border-radius:4px;padding:3px 10px;cursor:pointer;font-size:11px;}
button:hover{background:#c8c8e0;color:#000;}
#L{flex:1;overflow-y:auto;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all;background:#ffffff;border:1px solid #ccc;border-radius:4px;padding:8px;color:#1a6630;}`
        : `*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:monospace;background:#111122;color:#00ff88;display:flex;flex-direction:column;height:100vh;padding:8px;gap:6px;}
#tb{display:flex;gap:6px;align-items:center;flex-shrink:0;}
button{background:#1a1a33;border:1px solid #445;color:#aaa;border-radius:4px;padding:3px 10px;cursor:pointer;font-size:11px;}
button:hover{background:#2a2a55;color:#fff;}
#L{flex:1;overflow-y:auto;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all;background:#080816;border:1px solid #2a2a44;border-radius:4px;padding:8px;}`;

    if (mode === 'serial') {
        const w = window.open('', 'ESP32Log', 'width=700,height=500,resizable=yes,scrollbars=yes');
        w.document.write(`<!DOCTYPE html><html><head><title>ESP32 Log (Serie)</title>
<style>${_CSS}</style></head><body>
<div id="tb">
  <span style="color:#ff4466;font-weight:bold;font-size:12px;letter-spacing:2px">ESP32 LOG</span>
  <span style="font-size:10px;color:#44aaff;">Serie (COM)</span>
  <button onclick="autoScroll=!autoScroll;this.textContent=autoScroll?'▼ Auto':'— Fijo'">▼ Auto</button>
  <button onclick="window.opener._serialLog='';prev='';document.getElementById('L').textContent=''">🗑 Limpiar</button>
</div>
<pre id="L"></pre>
<script>
var autoScroll=true,prev='';
function u(){
  try{
    var log=window.opener._serialLog||'';
    if(log===prev)return;
    var l=document.getElementById('L');
    if(log.startsWith(prev)){l.textContent+=log.slice(prev.length);}else{l.textContent=log;}
    prev=log;
    if(autoScroll)l.scrollTop=l.scrollHeight;
  }catch(e){}
}
setInterval(u,300);u();
<\/script></body></html>`);
        w.document.close();
        return;
    }

    // Modo WiFi: fetch al endpoint /logs del firmware
    const ip = document.getElementById('esp32IpInput')?.value?.trim() || ESP32_IP;
    const w  = window.open('', 'ESP32Log', 'width=700,height=500,resizable=yes,scrollbars=yes');
    w.document.write(`<!DOCTYPE html><html><head><title>ESP32 Log</title>
<style>${_CSS}</style></head><body>
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

// ---- Auto-STOP cuando ESP32 termina reproducción ----
onStoppedCallback = () => {
    console.log('[onStoppedCallback] ESP32 terminó reproducción → ejecutar stop()');
    stop();
};

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

// Cerrar con Escape · Undo/Redo con Ctrl+Z / Ctrl+Y · Selección con Delete/Ctrl+C
document.addEventListener('keydown', (e) => {
    // Escape: primero limpia selección si la hay, luego cierra modal
    if (e.key === 'Escape') {
        if (typeof _selActive !== 'undefined' && _selActive) { selectionClear(); return; }
        closeHelpModal();
        return;
    }

    // No interceptar atajos de edición cuando el foco está en un campo de texto
    const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
    if (inInput) return;

    // Borrar selección rectangular
    if ((e.key === 'Delete' || e.key === 'Backspace') && typeof _selCells !== 'undefined' && _selCells.size > 0) {
        e.preventDefault();
        selectionDelete();
        return;
    }

    // Copiar selección al portapapeles de fragmentos
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && typeof _selCells !== 'undefined' && _selCells.size > 0) {
        selectionCopy();
        return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        historyUndo();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault();
        historyRedo();
    }

    // Abrir todos los canales en tabs separados
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        openAllInstruments();
    }
});

// ---- Abrir cada canal MIDI en un tab independiente ----
function openAllInstruments() {
    const opts = Array.from(
        instrumentSelect.querySelectorAll('option[value]:not([value=""])')
    );
    if (opts.length === 0) {
        statusSpan.innerText = 'No hay canales MIDI cargados.';
        return;
    }

    // Captura el estado MIDI antes de mover tabs
    const snap = {
        rawEvents:           rawEvents.map(e => ({ ...e })),
        tempoMap:            tempoMap.map(e => ({ ...e })),
        ppqn,
        totalTicks,
        midiData:            midiData ? JSON.parse(JSON.stringify(midiData)) : null,
        instrumentNames:     [...instrumentNames],
        currentMidiFileName,
        currentTimeSig:      { ...currentTimeSig },
    };

    _tabSaveCurrent();
    const startIdx = _tabs.length;   // índice del primer tab nuevo

    opts.forEach((opt) => {
        const ch     = parseInt(opt.value);
        const chName = opt.textContent.trim();

        // Tab nuevo pre-cargado con los datos MIDI compartidos
        const t = _tabDefaults();
        t.rawEvents           = snap.rawEvents.map(e => ({ ...e }));
        t.tempoMap            = snap.tempoMap.map(e => ({ ...e }));
        t.ppqn                = snap.ppqn;
        t.totalTicks          = snap.totalTicks;
        t.midiData            = snap.midiData ? JSON.parse(JSON.stringify(snap.midiData)) : null;
        t.instrumentNames     = [...snap.instrumentNames];
        t.currentMidiFileName = snap.currentMidiFileName;
        t.currentTimeSig      = { ...snap.currentTimeSig };
        t.selectedChannel     = ch;
        t.name                = chName;

        _tabs.push(t);
        _activeTabIdx = _tabs.length - 1;
        _tabRestoreFrom(t);  // restaura globals: selectedChannel=ch, rawEvents=snap...
        if (typeof enableInstrumentSelection === 'function') enableInstrumentSelection();

        buildGridFromChannel(ch);
        if (typeof historyClear === 'function') historyClear();
        pasoActual = 0;
        drawTimelineRuler();

        const analysis = performHarmonicAnalysis(ch);
        if (analysis) {
            currentHarmonicSegments = analysis.segments;
            currentFusedSegments    = analysis.fusedSegments;
            currentPhraseSegments   = analysis.phraseSegments;
            currentKey = analysis.key.tonic + (analysis.key.mode === 'minor' ? 'm' : '');

            const viewSel = document.getElementById('viewLevelSelect');
            if (viewSel) {
                viewSel.disabled = false;
                viewSel.value    = 'acordes';
                viewSel.querySelector('option[value="frases"]').disabled =
                    (currentPhraseSegments.length === 0);
            }
            const keyObj = {
                tonic:    currentKey.replace('m', ''),
                mode:     currentKey.endsWith('m') ? 'minor' : 'major',
                rootClass: 0
            };
            drawChordRow(currentFusedSegments, keyObj);
        }

        if (typeof calcularBreathingPoints === 'function') calcularBreathingPoints();
        _refreshHeatMap();
        _enableMeasureButtons();

        playBtn.disabled = false;
        loadInstrumentBtn.disabled = false;
        document.getElementById('activeNotesBtn').disabled = false;
        const abBtn = document.getElementById('abLoopBtn');
        if (abBtn) abBtn.disabled = false;
        const heatBtn = document.getElementById('heatMapBtn');
        if (heatBtn) heatBtn.disabled = false;
        const chordPanelBtn = document.getElementById('chordPanelBtn');
        if (chordPanelBtn) chordPanelBtn.disabled = false;

        const viewSel2 = document.getElementById('viewLevelSelect');
        if (viewSel2 && analysis) {
            viewSel2.querySelector('option[value="respiración"]').disabled =
                (breathingSegments.length === 0);
        }

        _tabs[_activeTabIdx].name    = chName;
        _tabs[_activeTabIdx].isDirty = false;
        _tabSaveCurrent();   // graba el grid construido en este slot
    });

    tabSwitch(startIdx);   // activa el primer tab nuevo
    statusSpan.innerText = `${opts.length} canal${opts.length > 1 ? 'es' : ''} abierto${opts.length > 1 ? 's' : ''} en tabs separados.`;
}
