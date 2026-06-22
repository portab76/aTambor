// ============================================================
// midiGrid.js — Módulo raíz (entry point ES6)
// Importa todos los módulos, cablea los event listeners y expone
// en window las funciones a las que apuntan los atributos onclick
// del HTML y las llamadas cruzadas `typeof X === 'function'`.
//
// Este es el ÚNICO script que carga midiGrid.html:
//   <script type="module" src="js/midiGrid.js"></script>
// ============================================================

import { state } from './state.js';

// ── Módulos de datos / análisis ──────────────────────────────
import { loadMIDIFile, enableInstrumentSelection } from './midi-parser.js';
import { loadMMLText, openMMLImportModal, closeMMLImportModal, mmlCallbacks } from './mml-parser.js';
import {
    performHarmonicAnalysis, performHarmonicAnalysisFromGrid, performHarmonicAnalysisAsync,
    getHarmonicSegments, detectKey, findChord, analyzeChordsOnSegments,
    fuseSegments, detectPhrases, getChordFunction, detectInversion,
} from './harmonic.js';
import { exportMIDI, defaultMidiExportName } from './midi-export.js';

// ── Render del piano roll ────────────────────────────────────
import {
    buildGridFromChannel, drawPianoRoll, drawPianoRollWithPlayhead,
    drawPianoRollWithHighlightAndPlayhead, drawPianoRollWithHighlight,
    drawNoteLabels, initNoteLabelsEvents, toggleNewGridPanel,
    _doLoadBlankGrid, loadBlankGrid, applyZoom, zoom, addMeasures, removeMeasures,
    _enableMeasureButtons, _OCT_RGB,
} from './piano-roll.js';

// ── Regla de compases ────────────────────────────────────────
import {
    drawTimelineRuler, toggleTempoEditMode, initRulerSeek,
    toggleLoopAB, updateRulerPlayhead, _updateAbBtn,
} from './timeline-ruler.js';

// ── Minimap, velocidades, calor ──────────────────────────────
import { drawMinimap, initMinimap } from './minimap.js';
import { toggleVelocityLane, drawVelocityLane, initVelocityLane } from './velocity-lane.js';
import {
    calcularHeatScores, _refreshHeatMap, calcularBreathingPoints, toggleHeatMap,
} from './heat.js';

// ── Fila de acordes / panel armónico ─────────────────────────
import {
    drawChordRow, toggleChordPanel, onChordBlockClick, _selectChordAtStep,
    _updateChordPanelFromPlayback, _activeSegments, _playSegmentLoop,
    _startNextBatch, _toggleAutoAdvance, _cpanelPlayLoop, _cpanelPrevChord,
    _cpanelNextChord, BATCH_SIZE,
} from './chord-row.js';

// ── Notas activas ────────────────────────────────────────────
import { activeNotesPanelToggle, activeNotesPanelRefresh } from './active-notes-panel.js';

// ── Reproducción ─────────────────────────────────────────────
import { play, pause, stop, seekToStep, MS_PER_STEP, _bpmAtStep, refreshPlaybackTempo, playbackCallbacks } from './playback.js';

// ── Historial / edición ──────────────────────────────────────
import { historyPush, historyUndo, historyRedo, historyClear } from './history.js';
import {
    initCanvasEvents, copyFragment, pasteFragment, moveSelection,
    deleteFragment, selectionDelete, selectionCopy, selectionClear,
    _updateFragmentButtons, getSelectionState,
} from './editor.js';

// ── Persistencia / recientes ─────────────────────────────────
import { saveProject, loadProject, _applyProjectData, projectCallbacks, defaultProjectName } from './persistence.js';
import {
    recentFilesAdd, toggleRecentInMenu, recentFilesLoad, recentFilesClear,
} from './recent-files.js';

// ── Tabs ─────────────────────────────────────────────────────
import {
    tabSwitch, tabNew, tabNewWithDialog, tabClose, tabMarkFileLoaded, tabMarkDirty,
    tabSaveCurrent, tabRender, tabPushPreloaded, tabNextIndex, tabUpdateActive,
} from './tabs.js';

// ── Tema ─────────────────────────────────────────────────────
import { setTheme, toggleTheme } from './theme.js';

// ── Transposición ────────────────────────────────────────────
import { toggleTransposePanel, _sliderRange, _tpSlider, _tpShift } from './transpose.js';

// ── Paneles / menú extraídos ─────────────────────────────────
import { toggleAppMenu, closeAppMenu } from './app-menu.js';
import { toggleMotorEscalaPanel } from './motor-escala-panel.js';

// ── Referencias DOM compartidas ──────────────────────────────
import {
    fileInput, instrumentSelect, loadInstrumentBtn, debugDiv, statusSpan,
    playBtn, stopBtn, canvas, ctx, gridScroll, notesPanelScroll,
} from './dom-refs.js';

// ── Hardware ESP32 ───────────────────────────────────────────
import {
    initWebSocket, sendCommand, sendStop, closeWebSocket, retryWebSocket, ESP32_IP,
} from './ws-connector.js';
import { initSerial, closeSerial } from './serial-connector.js';
import {
    buildFullSequence, buildRemainingSequence, buildRangeSequence,
    buildLedMappingCmd, validateSequenceSize,
} from './esp32-sequencer.js';
import { comprimirAMotores } from './octave-compressor.js';
import {
    MOTOR_MAP, motorForNote, motorMapUI, motorMapExport, motorMapImport,
    toggleMotorMapPanel, NUM_LEDS, ledForNote, _mmReleaseAllNotes,
    _mmPanelTest, _renderMotorMapPanelRows, _renderMotorMapRows, _mmListenForKey, _mmEdit,
} from './motor-map.js';

// ============================================================
// Helper: devuelve el array de segmentos según nivel seleccionado
// ============================================================
function _activeSegmentsFor(level, analysis) {
    if (level === 'respiración' && state.breathingSegments.length)
        return state.breathingSegments;
    if (level === 'frases'  && analysis?.phraseSegments?.length) return analysis.phraseSegments;
    if (level === 'acordes' && analysis?.fusedSegments?.length)  return analysis.fusedSegments;
    return analysis?.segments || state.currentHarmonicSegments;
}

// Las referencias DOM (canvas, ctx, statusSpan, …) se importan de dom-refs.js.

// ---- Sincronización de scroll: columna de notas sigue al grid ----
let _lastScrollTop = 0;
gridScroll.addEventListener('scroll', () => {
    notesPanelScroll.scrollTop = gridScroll.scrollTop;
    const chordRow = document.getElementById('chordRowContainer');
    if (chordRow) chordRow.scrollLeft = gridScroll.scrollLeft;
    const ruler = document.getElementById('rulerScrollArea');
    if (ruler) ruler.scrollLeft = gridScroll.scrollLeft;
    const velLane = document.getElementById('velocityLaneScroll');
    if (velLane) velLane.scrollLeft = gridScroll.scrollLeft;
    drawMinimap();

    // Virtualización: al desplazarse verticalmente cambia la banda de filas
    // visibles, así que hay que repintar el piano roll para dibujar las nuevas
    // filas. El scroll horizontal no lo necesita (las columnas ya ocupan toda
    // la altura del canvas).
    if (gridScroll.scrollTop !== _lastScrollTop) {
        _lastScrollTop = gridScroll.scrollTop;
        drawPianoRollWithPlayhead(state.reproduciendo ? state.pasoActual : -1);
    }
});

// ---- Carga de archivo MIDI ----
fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    state.currentMidiFileName = file.name;
    statusSpan.innerText = "Leyendo archivo...";
    const reader = new FileReader();
    reader.onload = (e) => {
        // Convertir ArrayBuffer → binary string que espera jasmid Stream()
        const bytes = new Uint8Array(e.target.result);
        let binaryString = '';
        for (let i = 0; i < bytes.length; i++) {
            binaryString += String.fromCharCode(bytes[i]);
        }
        _applyMidiLoadResult(loadMIDIFile(binaryString));
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
    const hasContent = Object.keys(state.gridData.cells).length > 0 || state.rawEvents.length > 0;
    if (hasContent) tabNew();

    // Mismo flujo que fileInput change
    state.currentMidiFileName = file.name;
    statusSpan.innerText = 'Leyendo archivo...';
    const reader = new FileReader();
    reader.onload = (ev) => {
        const bytes = new Uint8Array(ev.target.result);
        let binaryString = '';
        for (let i = 0; i < bytes.length; i++) binaryString += String.fromCharCode(bytes[i]);
        const result = _applyMidiLoadResult(loadMIDIFile(binaryString));
        if (!result || result.error) return;

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

// ---- Gestión de UI tras parsear un MIDI (resultado de loadMIDIFile) ----
// loadMIDIFile solo puebla el estado y devuelve datos; aquí actualizamos el DOM.
function _applyMidiLoadResult(result) {
    // Reset del checkbox compresor al cargar un nuevo MIDI
    const _cCb = document.getElementById('comprimirCheckbox');
    const _cLb = document.getElementById('comprimirLabel');
    if (_cCb) { _cCb.checked = false; _cCb.disabled = true; }
    if (_cLb) { _cLb.style.opacity = '0.4'; _cLb.style.cursor = 'default'; }

    if (!result || result.error) {
        debugDiv.innerHTML = `<strong>Error al parsear MIDI:</strong> ${result?.error ?? 'desconocido'}`;
        statusSpan.innerText = "Error: archivo MIDI inválido.";
        return result;
    }

    const ts = result.timeSig;

    // BPM input
    const bpmInput = document.getElementById('bpmInput');
    if (bpmInput) bpmInput.value = result.bpm;

    // Panel de debug
    debugDiv.innerHTML =
        `<strong>MIDI parseado</strong><br>` +
        (state.currentMidiFileName ? `<span style="color:#aaccff;word-break:break-all;">📄 ${state.currentMidiFileName}</span><br>` : '') +
        `PPQN=${result.ppqn} | BPM: ${result.bpm} | Compás: ${ts.numerator}/${ts.denominator} ` +
        `(${ts.stepsPerMeasure} pasos/compás) | ` +
        `Duración: ${result.totalTicks} ticks | Pistas: ${result.trackCount}<br>` +
        `Canales con notas: ${result.channelsWithNotes.map(c => c + 1).join(', ')}<br>` +
        `Eventos totales: ${result.rawEvents.length}`;

    // Etiqueta del ruler
    const rulerLabel = document.getElementById('rulerTimeSigLabel');
    if (rulerLabel) rulerLabel.textContent = `${ts.numerator} / ${ts.denominator}`;

    // Rellenar el selector de canales y habilitar transporte
    enableInstrumentSelection();
    statusSpan.innerText = "MIDI cargado. Selecciona un instrumento/canal.";
    return result;
}

// ---- Selección de canal/instrumento ----
instrumentSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    state.selectedChannel      = val === "" ? null : parseInt(val);
    loadInstrumentBtn.disabled = (state.selectedChannel === null);
});

// ---- Captura del estado MIDI actual (para clonar en tabs nuevos) ----
function _captureSnapshot() {
    return {
        rawEvents:           state.rawEvents.map(e => ({ ...e })),
        tempoMap:            state.tempoMap.map(e => ({ ...e })),
        ppqn:                state.ppqn,
        totalTicks:          state.totalTicks,
        midiData:            state.midiData ? JSON.parse(JSON.stringify(state.midiData)) : null,
        instrumentNames:     [...state.instrumentNames],
        currentMidiFileName: state.currentMidiFileName,
        currentTimeSig:      { ...state.currentTimeSig },
    };
}

// ---- Habilita transporte y herramientas tras construir un grid ----
function _enableChannelButtons() {
    playBtn.disabled = false;
    const exportBtn = document.getElementById('exportMidiMenuBtn');
    if (exportBtn) exportBtn.disabled = false;
    loadInstrumentBtn.disabled = false;
    document.getElementById('activeNotesBtn').disabled = false;
    _enableMeasureButtons();
    const abBtn = document.getElementById('abLoopBtn');
    if (abBtn) abBtn.disabled = false;
    const heatBtn = document.getElementById('heatMapBtn');
    if (heatBtn) heatBtn.disabled = false;
    const chordPanelBtn = document.getElementById('chordPanelBtn');
    if (chordPanelBtn) chordPanelBtn.disabled = false;
}

/**
 * Construye el grid del canal `ch` y prepara la UI dependiente: análisis
 * armónico, heat map / respiración, botones y chord row. NO crea el tab
 * (el llamador decide si reutiliza el activo o crea uno nuevo).
 * @returns {Object|null} el análisis armónico (o null si el canal no tiene notas)
 */
// Aplica un análisis armónico (de canal) al estado + UI: segmentos, tonalidad,
// selector de vista y chord row. Compartido por las rutas sync y async.
function _applyChannelAnalysis(analysis) {
    if (!analysis) return;
    state.currentHarmonicSegments = analysis.segments;
    state.currentFusedSegments    = analysis.fusedSegments;
    state.currentPhraseSegments   = analysis.phraseSegments;
    state.currentKey = analysis.key.tonic + (analysis.key.mode === 'minor' ? 'm' : '');

    const viewSel = document.getElementById('viewLevelSelect');
    if (viewSel) {
        viewSel.disabled = false;
        viewSel.value    = 'acordes';
        viewSel.querySelector('option[value="frases"]').disabled      = (state.currentPhraseSegments.length === 0);
        viewSel.querySelector('option[value="respiración"]').disabled = (state.breathingSegments.length === 0);
    }
    drawChordRow(_activeSegmentsFor('acordes', analysis), analysis.key);
}

// Indicador de "analizando…" en el chord row mientras trabaja el worker.
function _showChordRowLoading() {
    const chordRow = document.getElementById('chordRowContainer');
    if (chordRow) {
        chordRow.innerHTML =
            '<div style="padding:8px 12px;color:#8888aa;font-size:12px;font-style:italic;">' +
            '⏳ Analizando armonía…</div>';
    }
}

/**
 * Construye el grid del canal `ch` y prepara la UI dependiente.
 * El análisis armónico (CPU-intensivo) se ejecuta en un Web Worker para no
 * bloquear el hilo principal con archivos MIDI grandes.
 * @param {number} ch
 * @param {Object} [opts]
 * @param {boolean} [opts.async=true] usar el worker (true) o análisis síncrono (false)
 * @returns {Promise<Object|null>} resuelve con el análisis aplicado
 */
function _buildChannelGrid(ch, { async = true } = {}) {
    // ── Compresión a motores ────────────────────────────────
    const _comprimir = document.getElementById('comprimirCheckbox')?.checked;
    let _rawEventsOrig = null;
    if (_comprimir && MOTOR_MAP.length > 0) {
        // Heatmap PRE-compresión: se calcula del grid ORIGINAL y se conserva para
        // que la compresión decida colisiones por atención y para poder comparar
        // antes/después. Se construye el grid original una vez aquí.
        buildGridFromChannel(ch);
        const heatPre = (state.gridData && Object.keys(state.gridData.cells).length > 0)
            ? calcularHeatScores(state.gridData.cells, state.noteRows)
            : null;
        state.heatMapDataPreCompresion = heatPre;

        _rawEventsOrig = state.rawEvents;
        state.rawEvents = comprimirAMotores(state.rawEvents, ch, MOTOR_MAP, heatPre);
    } else {
        state.heatMapDataPreCompresion = null;
    }

    buildGridFromChannel(ch);

    if (_rawEventsOrig !== null) {
        state.rawEvents = _rawEventsOrig;
        _rawEventsOrig  = null;
    }

    historyClear();
    state.pasoActual = 0;
    drawTimelineRuler();

    const finish = (analysis) => {
        _applyChannelAnalysis(analysis);
        calcularBreathingPoints();
        _refreshHeatMap();
        _enableChannelButtons();
        return analysis;
    };

    if (!async) {
        // Ruta síncrona (p.ej. openAllInstruments: muchos tabs en bucle).
        return Promise.resolve(finish(performHarmonicAnalysis(ch)));
    }

    // Ruta asíncrona (carga de un canal/MIDI): worker + indicador de carga.
    _showChordRowLoading();
    return performHarmonicAnalysisAsync(ch)
        .then(finish)
        .catch(err => {
            console.error('[harmonic] análisis async falló, fallback síncrono:', err);
            return finish(performHarmonicAnalysis(ch));
        });
}

/**
 * Crea un tab nuevo para el canal `ch` (pre-cargado con el snapshot MIDI) y
 * construye su grid completo. Lógica compartida por openAllInstruments() y el
 * handler de loadInstrumentBtn.
 * @returns {Object|null} el análisis armónico (o null si el canal no tiene notas)
 */
function _setupChannelTab(ch, snap, { name, async = false } = {}) {
    tabPushPreloaded({
        rawEvents:           snap.rawEvents.map(e => ({ ...e })),
        tempoMap:            snap.tempoMap.map(e => ({ ...e })),
        ppqn:                snap.ppqn,
        totalTicks:          snap.totalTicks,
        midiData:            snap.midiData ? JSON.parse(JSON.stringify(snap.midiData)) : null,
        instrumentNames:     [...snap.instrumentNames],
        currentMidiFileName: snap.currentMidiFileName,
        currentTimeSig:      { ...snap.currentTimeSig },
        selectedChannel:     ch,
        ...(name ? { name } : {}),
    });
    enableInstrumentSelection();
    return _buildChannelGrid(ch, { async });
}

// ---- Cargar instrumento y mostrar grid ----
loadInstrumentBtn.addEventListener('click', () => {
    if (state.selectedChannel === null) {
        statusSpan.innerText = "Primero selecciona un canal.";
        return;
    }

    // H2: si hay reproducción activa → hot-swap en caliente
    if (state.reproduciendo) {
        // Reconstruir el grid con el nuevo canal sin parar el audio
        buildGridFromChannel(state.selectedChannel);
        drawTimelineRuler();

        // Enviar al ESP32 solo los pasos que quedan por sonar
        if (state.wsConnected) {
            const remaining = buildRemainingSequence(MOTOR_MAP, state.pasoActual);
            if (remaining) {
                const blocks = validateSequenceSize(remaining);
                sendCommand('APPEND\n' + blocks[0]);
                if (blocks.length > 1) {
                    setTimeout(() => sendCommand('APPEND\n' + blocks[1]), 100);
                }
            }
        }

        // Actualizar análisis armónico sin interrumpir la melodía
        const analysis = performHarmonicAnalysis(state.selectedChannel);
        if (analysis) {
            state.currentHarmonicSegments = analysis.segments;
            state.currentKey = analysis.key.tonic + (analysis.key.mode === 'minor' ? 'm' : '');
            drawChordRow(state.currentHarmonicSegments, analysis.key);
        }

        // Recalcular heat map y puntos de respiración en modo hot-swap
        _refreshHeatMap();
        calcularBreathingPoints();

        // Refrescar panel de notas activas si está abierto
        if (document.getElementById('activeNotesPanel')) activeNotesPanelRefresh();

        statusSpan.innerText =
            `🔄 Instrumento cambiado en caliente · Canal ${state.selectedChannel + 1} · ` +
            `${Object.keys(state.gridData.cells).length} notas`;
        return;
    }

    // H2: flujo normal (sin reproducción activa)
    const ch = state.selectedChannel;

    // Si el tab activo ya tiene contenido, abrir el canal en uno nuevo.
    // (Si está vacío, reutilizamos el tab actual: no creamos uno nuevo.)
    if (Object.keys(state.gridData.cells).length > 0) {
        tabPushPreloaded({ ..._captureSnapshot(), selectedChannel: ch });
        // enableInstrumentSelection filtra por canales con noteOn (igual que al cargar el MIDI),
        // evitando que _tabRestoreFrom muestre canales con programChange pero sin notas.
        enableInstrumentSelection();
        tabRender();
    }

    statusSpan.innerText = `Construyendo grid para canal ${ch + 1}...`;

    // Volver al inicio del grid al cargar un nuevo canal
    const _gs = document.getElementById('gridScroll');
    if (_gs) _gs.scrollLeft = 0;  // el listener de scroll sincroniza chordRow y ruler

    // Refrescar panel de notas activas si está abierto
    if (document.getElementById('activeNotesPanel')) activeNotesPanelRefresh();

    // Debug del grid (no depende del análisis: disponible de inmediato)
    const _numMeasures = Math.ceil(state.totalSteps / state.currentTimeSig.stepsPerMeasure);
    debugDiv.innerHTML +=
        `<br><strong>Grid generado:</strong> ${state.instrumentNames[ch]}, ` +
        `<strong>${_numMeasures} compases</strong>, ` +
        `Pasos=${state.totalSteps}, Rango=${state.noteRows[0]}–${state.noteRows[state.noteRows.length - 1]}, ` +
        `Zoom=${state.stepWidth}px/paso, Canvas=${canvas.width}×${canvas.height}px`;

    // Actualizar nombre del tab: nombre del instrumento seguido del archivo MIDI
    const _instrName = state.instrumentNames[ch] || `Canal ${ch + 1}`;
    const _fileName  = state.currentMidiFileName || 'Sin título';
    tabMarkFileLoaded(`${_instrName} - ${_fileName}`);

    // Lógica de setup compartida — el análisis armónico corre en el worker.
    // Todo lo que dependa de la tonalidad/segmentos se aplica al resolver.
    _buildChannelGrid(ch, { async: true }).then((analysis) => {
        // Redibujar con heat map si está activo (necesita los segmentos ya aplicados)
        if (state.heatMapActive) drawPianoRollWithPlayhead(-1);

        statusSpan.innerText =
            `Grid listo · Canal ${ch + 1} · ` +
            `${Object.keys(state.gridData.cells).length} notas · ` +
            `Tonalidad: ${state.currentKey}`;

        if (analysis) {
            const cadCounts = state.currentPhraseSegments.reduce((acc, p) => {
                acc[p.cadenceType] = (acc[p.cadenceType] || 0) + 1; return acc;
            }, {});
            const cadText = Object.entries(cadCounts)
                .map(([t, n]) => `${n} ${t}`).join(', ') || '—';

            debugDiv.innerHTML +=
                `<br><strong>Análisis armónico:</strong> Tonalidad: ${state.currentKey} ` +
                `(correlación: ${analysis.key.correlation.toFixed(2)}) | ` +
                `Segmentos: ${state.currentHarmonicSegments.length} | ` +
                `Bloques fusionados: ${state.currentFusedSegments.length} (cada ${state.fusionStepsPerUnit} pasos) | ` +
                `Frases: ${state.currentPhraseSegments.length} (${cadText})`;
        }
    });
});

// ---- Select nivel de vista armónica ----
document.getElementById('viewLevelSelect').addEventListener('change', function () {
    if (this.value === 'respiración') {
        if (state.breathingSegments.length) drawChordRow(state.breathingSegments, null);
        return;
    }
    if (!state.currentHarmonicSegments.length) return;
    const key = { tonic: state.currentKey.replace('m', ''), mode: state.currentKey.endsWith('m') ? 'minor' : 'major', rootClass: 0 };
    drawChordRow(_activeSegmentsFor(this.value, {
        segments: state.currentHarmonicSegments,
        fusedSegments: state.currentFusedSegments,
        phraseSegments: state.currentPhraseSegments
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

// ---- Callbacks de UI de playback.js (desacople DOM) ----
// playback.js no toca el DOM: dispara estos callbacks y aquí actualizamos
// botones, mensaje de estado y playhead del piano roll.
playbackCallbacks.onStart = () => {
    playBtn.disabled = true;
    stopBtn.disabled = false;
};
playbackCallbacks.onStop = () => {
    playBtn.disabled = false;
};
playbackCallbacks.onPause = () => {
    playBtn.disabled = false;
};
playbackCallbacks.onStatusChange = (msg) => {
    statusSpan.innerText = msg;
};
playbackCallbacks.onStepChange = (step) => {
    // Si el panel de acordes está abierto y hay highlight activo, dibujar con él;
    // si no, dibujar solo el playhead.
    if (step >= 0 && state.activeHighlight &&
        document.getElementById('chordPanel')?.classList.contains('open')) {
        drawPianoRollWithHighlightAndPlayhead(
            state.activeHighlight.classes,
            state.activeHighlight.startStep,
            state.activeHighlight.endStep,
            step
        );
    } else {
        drawPianoRollWithPlayhead(step);
    }
};

// ---- BPM en caliente: sincroniza tempoPoints[0] y reinicia interval ----
document.getElementById('bpmInput').addEventListener('change', () => {
    const bpm = parseFloat(document.getElementById('bpmInput').value) || 120;
    if (state.tempoPoints && state.tempoPoints.length) {
        state.tempoPoints[0].bpm = bpm;
        drawTimelineRuler();
    }
    // Refrescar el interval visual con el nuevo tempo sin perder posición
    refreshPlaybackTempo();
});

// ---- Modal de nombre de archivo (Guardar / Exportar MIDI) ----
// Pequeño diálogo reutilizable: muestra un input con el nombre por defecto y
// resuelve con el nombre saneado al confirmar (Enter / botón) o null al cancelar.
let _fileNameOnConfirm = null;   // callback activo del modal

function promptFileName({ title, defaultName, extension, confirmLabel, onConfirm }) {
    const modal = document.getElementById('fileNameModal');
    const input = document.getElementById('fileNameInput');
    const ext   = document.getElementById('fileNameExt');
    const ttl   = document.getElementById('fileNameModalTitle');
    const btn   = document.getElementById('fileNameConfirmBtn');
    if (!modal || !input) return;

    ttl.textContent = title || 'Guardar archivo';
    ext.textContent = extension || '';
    btn.textContent = confirmLabel || 'Guardar';
    input.value     = defaultName || '';
    _fileNameOnConfirm = onConfirm || null;

    modal.style.display = 'flex';
    // Seleccionar el nombre (sin extensión) para sobrescribir cómodamente.
    setTimeout(() => { input.focus(); input.select(); }, 30);
}

function closeFileNameModal() {
    const modal = document.getElementById('fileNameModal');
    if (modal) modal.style.display = 'none';
    _fileNameOnConfirm = null;
}

function _confirmFileName() {
    const input = document.getElementById('fileNameInput');
    const name  = input ? input.value.trim() : '';
    if (!name) { input?.focus(); return; }   // no permitir nombre vacío
    const cb = _fileNameOnConfirm;
    closeFileNameModal();
    cb?.(name);
}

// Wiring del modal: botón confirmar, Enter en el input, Escape para cerrar.
document.getElementById('fileNameConfirmBtn')?.addEventListener('click', _confirmFileName);
document.getElementById('fileNameInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); _confirmFileName(); }
    if (e.key === 'Escape') { e.preventDefault(); closeFileNameModal(); }
});
// Click en el fondo oscuro cierra el modal.
document.getElementById('fileNameModal')?.addEventListener('mousedown', (e) => {
    if (e.target.id === 'fileNameModal') closeFileNameModal();
});

/** Abre el diálogo de nombre para guardar el proyecto JSON. */
function promptSaveProject() {
    promptFileName({
        title:       'Guardar proyecto',
        defaultName: defaultProjectName(),
        extension:   '.json',
        confirmLabel: 'Guardar',
        onConfirm:   (name) => saveProject(name),
    });
}

/** Abre el diálogo de nombre para exportar el MIDI. */
function promptExportMidi() {
    promptFileName({
        title:       'Exportar MIDI',
        defaultName: defaultMidiExportName(),
        extension:   '.mid',
        confirmLabel: 'Exportar',
        onConfirm:   (name) => exportMIDI(name),
    });
}

// ---- Botones de persistencia ----
document.getElementById('saveProjectBtn')?.addEventListener('click', () => {
    closeAppMenu();
    promptSaveProject();
});
document.getElementById('loadProjectBtn')?.addEventListener('click', () => {
    document.getElementById('loadProjectInput').click();
});
document.getElementById('loadProjectInput')?.addEventListener('change', (e) => {
    if (e.target.files[0]) loadProject(e.target.files[0]);
});

// ---- Habilitación de toda la UI tras cargar un proyecto ----
// Reúne la habilitación de botones/selectores que antes vivía dentro de
// _applyProjectData (persistence.js). Lee el estado ya poblado.
function _enableAllButtons() {
    // BPM
    const bpmEl = document.getElementById('bpmInput');
    if (bpmEl && state.tempoPoints[0]) bpmEl.value = Math.round(state.tempoPoints[0].bpm);

    // Selector de canal
    if (state.selectedChannel !== null) {
        let opt = instrumentSelect.querySelector(`option[value="${state.selectedChannel}"]`);
        if (!opt) {
            opt = document.createElement('option');
            opt.value       = state.selectedChannel;
            opt.textContent = `Canal ${state.selectedChannel + 1}`;
            instrumentSelect.appendChild(opt);
        }
        instrumentSelect.value    = state.selectedChannel;
        instrumentSelect.disabled = false;
        loadInstrumentBtn.disabled = false;
    }

    // Transporte y herramientas
    playBtn.disabled = false;
    _enableMeasureButtons();
    const abBtn = document.getElementById('abLoopBtn');
    if (abBtn) abBtn.disabled = false;
    document.getElementById('activeNotesBtn').disabled = false;
    const heatBtn = document.getElementById('heatMapBtn');
    if (heatBtn) heatBtn.disabled = false;
    const chordPanelBtn = document.getElementById('chordPanelBtn');
    if (chordPanelBtn) chordPanelBtn.disabled = false;

    // Selector de nivel armónico
    const viewSel = document.getElementById('viewLevelSelect');
    if (viewSel) {
        viewSel.disabled = false;
        viewSel.querySelector('option[value="acordes"]').disabled     = (state.currentFusedSegments.length  === 0);
        viewSel.querySelector('option[value="frases"]').disabled      = (state.currentPhraseSegments.length === 0);
        viewSel.querySelector('option[value="respiración"]').disabled = (state.breathingSegments.length     === 0);
        viewSel.value = (state.currentFusedSegments.length > 0) ? 'acordes' : 'pasos';
    }
}

// persistence.js dispara estos callbacks; aquí gestionamos la UI.
projectCallbacks.onApplied      = _enableAllButtons;
projectCallbacks.onStatusChange = (msg) => { statusSpan.innerText = msg; };

// ---- Callbacks de UI de mml-parser.js (desacople DOM) ----
// mml-parser puebla el estado y dispara onLoaded(result); aquí actualizamos la
// barra (BPM, ruler), el panel de debug, el selector y construimos el grid.
mmlCallbacks.onError = (msg) => { statusSpan.innerText = msg; };
mmlCallbacks.onLoaded = (result) => {
    // BPM input
    const bpmInput = document.getElementById('bpmInput');
    if (bpmInput) bpmInput.value = result.bpm;

    // Etiqueta del ruler (MML siempre 4/4)
    const rulerLabel = document.getElementById('rulerTimeSigLabel');
    if (rulerLabel) rulerLabel.textContent = '4 / 4';

    // Panel de debug
    debugDiv.innerHTML =
        `<strong>MML cargado</strong><br>` +
        `Pistas: ${result.trackCount} | BPM: ${result.bpm} | PPQN: ${result.ppqn} | ` +
        `Ticks totales: ${result.totalTicks}<br>` +
        result.noteCounts.map((n, i) => `Pista ${i + 1}: ${n} notas`).join(' &nbsp;|&nbsp; ');

    // Selector de canales + construir el grid de la primera pista
    enableInstrumentSelection();
    instrumentSelect.value = '0';
    loadInstrumentBtn.disabled = false;
    loadInstrumentBtn.click();
};

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

    const _isLight = document.documentElement.getAttribute('data-theme') === 'light';
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
<style>${_CSS}
#cmd{display:flex;gap:6px;align-items:center;flex-shrink:0;padding-top:4px;border-top:1px solid #2a2a44;}
#cmdInput{flex:1;background:#080816;border:1px solid #334;color:#adf;font-family:monospace;font-size:11px;padding:4px 8px;border-radius:4px;outline:none;}
</style></head><body>
<div id="tb">
  <span style="color:#ff4466;font-weight:bold;font-size:12px;letter-spacing:2px">ESP32 LOG</span>
  <span style="font-size:10px;color:#44aaff;">Serie (COM)</span>
  <button onclick="autoScroll=!autoScroll;this.textContent=autoScroll?'▼ Auto':'— Fijo'">▼ Auto</button>
  <button onclick="window.opener._serialLog='';prev='';document.getElementById('L').textContent=''">🗑 Limpiar</button>
</div>
<pre id="L"></pre>
<div id="cmd">
  <span style="font-size:10px;opacity:.5;white-space:nowrap;">CMD&nbsp;→</span>
  <input id="cmdInput" type="text" placeholder="ej: m 0; o 375; t 80; v 100; t 150; v 0; p;"
         onkeydown="if(event.key==='Enter')sendCmd()">
  <button onclick="sendCmd()">Enviar</button>
</div>
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
function sendCmd(){
  var inp=document.getElementById('cmdInput');
  var cmd=inp.value.trim();
  if(!cmd)return;
  try{window.opener.sendCommand(cmd);inp.select();}catch(e){alert('Sin conexión con la ventana principal.');}
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
<style>${_CSS}
#cmd{display:flex;gap:6px;align-items:center;flex-shrink:0;padding-top:4px;border-top:1px solid #2a2a44;}
#cmdInput{flex:1;background:#080816;border:1px solid #334;color:#adf;font-family:monospace;font-size:11px;padding:4px 8px;border-radius:4px;outline:none;}
</style></head><body>
<div id="tb">
  <span style="color:#ff4466;font-weight:bold;font-size:12px;letter-spacing:2px">ESP32 LOG</span>
  <span style="font-size:10px;color:#556;">${ip}</span>
  <button onclick="autoScroll=!autoScroll;this.textContent=autoScroll?'▼ Auto':'— Fijo'">▼ Auto</button>
  <button onclick="document.getElementById('L').textContent='';seen=''">🗑 Limpiar</button>
</div>
<pre id="L"></pre>
<div id="cmd">
  <span style="font-size:10px;opacity:.5;white-space:nowrap;">CMD&nbsp;→</span>
  <input id="cmdInput" type="text" placeholder="ej: m 0; o 375; t 80; v 100; t 150; v 0; p;"
         onkeydown="if(event.key==='Enter')sendCmd()">
  <button onclick="sendCmd()">Enviar</button>
</div>
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
function sendCmd(){
  var inp=document.getElementById('cmdInput');
  var cmd=inp.value.trim();
  if(!cmd)return;
  try{window.opener.sendCommand(cmd);inp.select();}catch(e){alert('Sin conexión con la ventana principal.');}
}
setInterval(u,600);u();
<\/script></body></html>`);
    w.document.close();
}

// ---- Inicializar MIDI.js y SoundFont ----
function initMIDI() {
    MIDI.loadPlugin({
        soundfontUrl: "./MIDI.js/examples/soundfont/",
        instrument:   state.currentInstrument,
        onsuccess: () => {
            state.soundfontLoaded = true;
            statusSpan.innerText = "SoundFont listo. Carga un archivo MIDI.";
            console.log("MIDI.js: SoundFont cargado.");
            if (state.midiData) enableInstrumentSelection();

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
state.onStoppedCallback = () => {
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
    const sel = getSelectionState();   // { selCells:[...], selActive }
    const hasSel = sel.selCells.length > 0;

    // Escape: primero limpia selección si la hay, luego cierra modal
    if (e.key === 'Escape') {
        if (sel.selActive || hasSel) { selectionClear(); return; }
        closeHelpModal();
        return;
    }

    // No interceptar atajos de edición cuando el foco está en un campo de texto
    const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
    if (inInput) return;

    // Mover la selección por el grid con las flechas:
    //   ←/→ = ±1 paso · ↑/↓ = ±1 semitono · Shift+↑/↓ = ±1 octava (12 semitonos)
    if (hasSel && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        let dStep = 0, dRow = 0;
        const oct = e.shiftKey ? 12 : 1;
        if      (e.key === 'ArrowLeft')  dStep = -1;
        else if (e.key === 'ArrowRight') dStep =  1;
        else if (e.key === 'ArrowUp')    dRow  = -oct;   // ↑ = subir en pantalla (índice menor en noteRows)
        else if (e.key === 'ArrowDown')  dRow  =  oct;
        if (moveSelection(dStep, dRow)) { e.preventDefault(); return; }
    }

    // Borrar selección rectangular
    if ((e.key === 'Delete' || e.key === 'Backspace') && hasSel) {
        e.preventDefault();
        selectionDelete();
        return;
    }

    // Copiar selección al portapapeles de fragmentos
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c' && hasSel) {
        selectionCopy();
        return;
    }

    // Pegar fragmento en el playhead (las notas pegadas quedan seleccionadas).
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v') {
        if (state._clipboardFragment) {
            e.preventDefault();
            pasteFragment();
            return;
        }
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
    const snap = _captureSnapshot();

    tabSaveCurrent();
    const startIdx = tabNextIndex();   // índice del primer tab nuevo

    opts.forEach((opt) => {
        const chName = opt.textContent.trim();
        _setupChannelTab(parseInt(opt.value), snap, { name: chName });
        tabUpdateActive({ name: chName, isDirty: false }, true);  // graba el grid construido en este slot
    });

    tabSwitch(startIdx);   // activa el primer tab nuevo
    statusSpan.innerText = `${opts.length} canal${opts.length > 1 ? 'es' : ''} abierto${opts.length > 1 ? 's' : ''} en tabs separados.`;
}

// ---- Conexión ESP32 (handlers de la barra) ──────────────────
function _connectEsp32() {
    const mode = document.getElementById('connModeSelect').value;
    if (mode === 'serial') {
        initSerial();
    } else {
        initWebSocket();
    }
}

function _onConnModeChange() {
    const mode    = document.getElementById('connModeSelect').value;
    const ipInput = document.getElementById('esp32IpInput');
    const logBtn  = document.getElementById('esp32LogBtn');
    ipInput.style.display = mode === 'wifi' ? '' : 'none';
    logBtn.style.display  = '';
    // Desconectar el canal anterior al cambiar de modo
    if (mode === 'serial') closeWebSocket();
    if (mode === 'wifi')   closeSerial();
    // Resetear offset del panel Escala al cambiar de modo
    _tpSlider(0);
}

// ============================================================
// Exposición en window — atributos onclick del HTML y llamadas
// cruzadas `typeof X === 'function'` desde otros módulos.
// ============================================================
Object.assign(window, {
    // estado compartido (handlers inline lo mutan)
    state,

    // datos / análisis
    loadMIDIFile, enableInstrumentSelection,
    loadMMLText, openMMLImportModal, closeMMLImportModal,
    performHarmonicAnalysis, performHarmonicAnalysisFromGrid,
    getHarmonicSegments, detectKey, findChord, analyzeChordsOnSegments,
    fuseSegments, detectPhrases, getChordFunction, detectInversion,
    exportMIDI, promptExportMidi, promptSaveProject, closeFileNameModal,

    // piano roll
    buildGridFromChannel, drawPianoRoll, drawPianoRollWithPlayhead,
    drawPianoRollWithHighlightAndPlayhead, drawPianoRollWithHighlight,
    drawNoteLabels, initNoteLabelsEvents, toggleNewGridPanel,
    _doLoadBlankGrid, loadBlankGrid, applyZoom, zoom, addMeasures, removeMeasures,
    _enableMeasureButtons,

    // regla
    drawTimelineRuler, toggleTempoEditMode, toggleLoopAB,
    updateRulerPlayhead, _updateAbBtn,

    // minimap / velocidades / calor
    drawMinimap, toggleVelocityLane, drawVelocityLane,
    calcularHeatScores, _refreshHeatMap, calcularBreathingPoints, toggleHeatMap,

    // acordes
    drawChordRow, toggleChordPanel, onChordBlockClick, _selectChordAtStep,
    _updateChordPanelFromPlayback, _activeSegments, _playSegmentLoop,
    _startNextBatch, _toggleAutoAdvance, _cpanelPlayLoop, _cpanelPrevChord,
    _cpanelNextChord,

    // notas activas
    activeNotesPanelToggle, activeNotesPanelRefresh,

    // reproducción
    play, pause, stop, seekToStep, MS_PER_STEP, _bpmAtStep,

    // historial / edición
    historyPush, historyUndo, historyRedo, historyClear,
    copyFragment, pasteFragment, moveSelection, deleteFragment,
    selectionDelete, selectionCopy, selectionClear, _updateFragmentButtons,

    // persistencia / recientes
    saveProject, loadProject, _applyProjectData,
    recentFilesAdd, toggleRecentInMenu, recentFilesLoad, recentFilesClear,

    // tabs
    tabSwitch, tabNew, tabNewWithDialog, tabClose, tabMarkFileLoaded, tabMarkDirty,

    // tema / transposición
    setTheme, toggleTheme, toggleTransposePanel, _sliderRange,

    // hardware
    initWebSocket, sendCommand, sendStop, closeWebSocket, retryWebSocket,
    initSerial, closeSerial,
    buildFullSequence, buildRemainingSequence, buildRangeSequence,
    buildLedMappingCmd, validateSequenceSize,
    comprimirAMotores,
    MOTOR_MAP, motorForNote, motorMapUI, motorMapExport, motorMapImport,
    toggleMotorMapPanel, ledForNote, _mmReleaseAllNotes, _mmPanelTest,
    _renderMotorMapPanelRows, _renderMotorMapRows, _mmListenForKey, _mmEdit,

    // entry-point local
    openAllInstruments, openEsp32LogWindow, showHelpModal, closeHelpModal,
    toggleMotorEscalaPanel, _connectEsp32, _onConnModeChange,
    toggleAppMenu, closeAppMenu,
});

// ============================================================
// Documento por defecto: al cargar la página (o F5) se crea un grid
// vacío en 4/4 con 8 compases sobre el tab inicial, listo para editar.
// ============================================================
function _initDefaultDocument() {
    _doLoadBlankGrid(8);   // 8 compases en 4/4 (16 pasos/compás)
}

if (document.readyState === 'loading') {
    // Esperar a que tabs.js haya renderizado el tab inicial en DOMContentLoaded.
    document.addEventListener('DOMContentLoaded', _initDefaultDocument);
} else {
    _initDefaultDocument();
}
