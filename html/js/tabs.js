// ============================================================
// tabs.js — Sistema de pestañas multi-documento
// Cada tab guarda una copia completa del estado del grid.
// El portapapeles (_clipboardFragment) es COMPARTIDO entre tabs.
// ============================================================

// ── Estado por defecto de un tab vacío ───────────────────────
function _tabDefaults() {
    return {
        name:    'Sin título',
        isDirty: false,

        gridData:     { cells: {} },
        noteRows:     [],
        totalSteps:   0,
        ticksPerStep: 0,
        stepWidth:    8,
        rowHeight:    25,

        rawEvents:  [],
        tempoMap:   [{ tick: 0, bpm: 120 }],
        ppqn:       96,
        totalTicks: 0,
        midiData:   null,

        selectedChannel:     null,
        instrumentNames:     [],
        currentMidiFileName: '',

        currentTimeSig: { numerator: 4, denominator: 4, stepsPerMeasure: 16, stepsPerBeat: 4 },

        loopA: -1, loopB: -1, loopAB: false,
        pasoActual: 0,

        currentHarmonicSegments: [],
        currentFusedSegments:    [],
        currentPhraseSegments:   [],
        breathingSegments:       [],
        currentKey:         'C',
        fusionStepsPerUnit: 4,

        transposeOffset: 0,

        scrollLeft: 0,
        scrollTop:  0,
        bpm:        120,
        viewLevel:  'pasos',

        undoStack: [],
        redoStack: [],

        selCells:  [],
        selActive: false,

        tempoPoints:    [{ step: 0, bpm: 120 }],
        sectionMarkers: [],
    };
}

let _tabs          = [_tabDefaults()];
let _activeTabIdx  = 0;

// ── Captura del estado global en el slot activo ───────────────
function _tabSaveCurrent() {
    const t = _tabs[_activeTabIdx];
    if (!t) return;

    t.gridData    = JSON.parse(JSON.stringify(gridData));
    t.noteRows    = [...noteRows];
    t.totalSteps  = totalSteps;
    t.ticksPerStep = ticksPerStep;
    t.stepWidth   = stepWidth;
    t.rowHeight   = rowHeight;

    t.rawEvents  = rawEvents.map(e => ({ ...e }));
    t.tempoMap   = tempoMap.map(e => ({ ...e }));
    t.ppqn       = ppqn;
    t.totalTicks = totalTicks;
    t.midiData   = midiData ? JSON.parse(JSON.stringify(midiData)) : null;

    t.selectedChannel     = selectedChannel;
    t.instrumentNames     = [...instrumentNames];
    t.currentMidiFileName = currentMidiFileName;

    t.currentTimeSig = { ...currentTimeSig };

    t.loopA  = loopA;
    t.loopB  = loopB;
    t.loopAB = loopAB;
    t.pasoActual = pasoActual;

    t.currentHarmonicSegments = JSON.parse(JSON.stringify(currentHarmonicSegments));
    t.currentFusedSegments    = JSON.parse(JSON.stringify(currentFusedSegments));
    t.currentPhraseSegments   = JSON.parse(JSON.stringify(currentPhraseSegments));
    t.breathingSegments       = JSON.parse(JSON.stringify(breathingSegments));
    t.currentKey          = currentKey;
    t.fusionStepsPerUnit  = fusionStepsPerUnit;

    const gs = document.getElementById('gridScroll');
    if (gs) { t.scrollLeft = gs.scrollLeft; t.scrollTop = gs.scrollTop; }

    if (typeof _undoStack !== 'undefined') t.undoStack = _undoStack.map(s => JSON.parse(JSON.stringify(s)));
    if (typeof _redoStack !== 'undefined') t.redoStack = _redoStack.map(s => JSON.parse(JSON.stringify(s)));
    if (typeof _selCells  !== 'undefined') t.selCells  = [..._selCells];
    if (typeof _selActive !== 'undefined') t.selActive = _selActive;
    if (typeof tempoPoints     !== 'undefined') t.tempoPoints    = tempoPoints.map(tp => ({ ...tp }));
    if (typeof sectionMarkers  !== 'undefined') t.sectionMarkers = sectionMarkers.map(sm => ({ ...sm }));

    const bpmEl = document.getElementById('bpmInput');
    if (bpmEl) t.bpm = parseFloat(bpmEl.value) || 120;

    const sel = document.getElementById('viewLevelSelect');
    if (sel) t.viewLevel = sel.value;
}

// ── Restauración del estado desde un slot ────────────────────
function _tabRestoreFrom(t) {
    // Parar reproducción
    if (reproduciendo && typeof stop === 'function') stop();

    gridData     = JSON.parse(JSON.stringify(t.gridData));
    noteRows     = [...t.noteRows];
    totalSteps   = t.totalSteps;
    ticksPerStep = t.ticksPerStep;
    stepWidth    = t.stepWidth;
    rowHeight    = t.rowHeight;

    rawEvents  = t.rawEvents.map(e => ({ ...e }));
    tempoMap   = t.tempoMap.map(e => ({ ...e }));
    ppqn       = t.ppqn;
    totalTicks = t.totalTicks;
    midiData   = t.midiData ? JSON.parse(JSON.stringify(t.midiData)) : null;

    selectedChannel     = t.selectedChannel;
    instrumentNames     = [...t.instrumentNames];
    currentMidiFileName = t.currentMidiFileName;

    currentTimeSig = { ...t.currentTimeSig };

    loopA  = t.loopA;
    loopB  = t.loopB;
    loopAB = t.loopAB;
    pasoActual    = 0;
    reproduciendo = false;

    currentHarmonicSegments = JSON.parse(JSON.stringify(t.currentHarmonicSegments));
    currentFusedSegments    = JSON.parse(JSON.stringify(t.currentFusedSegments));
    currentPhraseSegments   = JSON.parse(JSON.stringify(t.currentPhraseSegments));
    breathingSegments       = JSON.parse(JSON.stringify(t.breathingSegments));
    currentKey         = t.currentKey;
    fusionStepsPerUnit = t.fusionStepsPerUnit;

    const hasGrid = Object.keys(gridData.cells).length > 0;

    // ── BPM ──
    const bpmEl = document.getElementById('bpmInput');
    if (bpmEl) bpmEl.value = t.bpm;

    // ── Selector de vista armónica ──
    const viewSel = document.getElementById('viewLevelSelect');
    if (viewSel) {
        const level = (t.currentHarmonicSegments.length > 0) ? t.viewLevel : 'pasos';
        viewSel.value    = level;
        viewSel.disabled = !hasGrid;
        const respOpt   = viewSel.querySelector('option[value="respiración"]');
        if (respOpt)   respOpt.disabled   = (t.breathingSegments.length === 0);
        const frasesOpt = viewSel.querySelector('option[value="frases"]');
        if (frasesOpt) frasesOpt.disabled = (t.currentPhraseSegments.length === 0);
    }

    // ── Transport ──
    if (typeof playBtn !== 'undefined') playBtn.disabled = !hasGrid;
    if (typeof stopBtn !== 'undefined') stopBtn.disabled = false;

    // ── Botones de toolbar ──
    const abBtn         = document.getElementById('abLoopBtn');
    const heatBtn       = document.getElementById('heatMapBtn');
    const chordPanelBtn = document.getElementById('chordPanelBtn');
    const activeNotesBtn= document.getElementById('activeNotesBtn');
    if (abBtn)          abBtn.disabled          = !hasGrid;
    if (heatBtn)        heatBtn.disabled        = !hasGrid;
    if (chordPanelBtn)  chordPanelBtn.disabled  = !hasGrid;
    if (activeNotesBtn) activeNotesBtn.disabled = !hasGrid;

    // ── Botones de compases ──
    if (hasGrid && typeof _enableMeasureButtons === 'function') _enableMeasureButtons();

    // ── Instrumento select ──
    if (typeof instrumentSelect !== 'undefined') {
        instrumentSelect.innerHTML = '<option value="">-- Canal --</option>';
        t.instrumentNames.forEach((name, i) => {
            if (!name) return;
            const opt = document.createElement('option');
            opt.value       = i;
            opt.textContent = `${i + 1}: ${name}`;
            if (i === t.selectedChannel) opt.selected = true;
            instrumentSelect.appendChild(opt);
        });
        instrumentSelect.disabled = !hasGrid && !t.midiData;
    }
    if (typeof loadInstrumentBtn !== 'undefined')
        loadInstrumentBtn.disabled = (t.selectedChannel === null);

    const openAllBtn = document.getElementById('openAllInstrumentsBtn');
    if (openAllBtn) {
        const chCount = instrumentSelect
            ? instrumentSelect.querySelectorAll('option[value]:not([value=""])').length
            : 0;
        openAllBtn.disabled = chCount < 2;
    }

    // ── Piano roll ──
    if (hasGrid) {
        applyZoom(t.stepWidth, t.rowHeight);
    } else {
        if (typeof drawPianoRollWithPlayhead === 'function') drawPianoRollWithPlayhead(-1);
        if (typeof drawTimelineRuler        === 'function') drawTimelineRuler();
    }

    // ── Chord row ──
    const chordRow = document.getElementById('chordRowContainer');
    if (chordRow) {
        if (t.currentHarmonicSegments.length && typeof drawChordRow === 'function') {
            const keyObj = _tabParseKey(t.currentKey);
            const segs   = _tabActiveSegs(t);
            drawChordRow(segs, keyObj);
        } else {
            chordRow.innerHTML = '';
        }
    }

    // ── Transposición: global, no por tab — refrescar UI con el valor actual ──
    if (typeof _tpSlider === 'function') _tpSlider(transposeOffset);

    // ── A-B ──
    if (typeof _updateAbBtn === 'function') _updateAbBtn();

    // ── Heat map ──
    heatMapData = null;
    if (heatMapActive && hasGrid && typeof _refreshHeatMap === 'function') _refreshHeatMap();

    // ── Historial Undo/Redo ──
    if (typeof _undoStack  !== 'undefined') _undoStack  = (t.undoStack || []).map(s => JSON.parse(JSON.stringify(s)));
    if (typeof _redoStack  !== 'undefined') _redoStack  = (t.redoStack || []).map(s => JSON.parse(JSON.stringify(s)));
    if (typeof _selCells   !== 'undefined') { _selCells = new Set(t.selCells || []); _selActive = t.selActive || false; _selDragging = false; _selDragStart = null; _selDragEnd = null; }
    if (typeof tempoPoints    !== 'undefined') tempoPoints    = (t.tempoPoints    || [{ step: 0, bpm: 120 }]).map(tp => ({ ...tp }));
    if (typeof sectionMarkers !== 'undefined') sectionMarkers = (t.sectionMarkers || []).map(sm => ({ ...sm }));

    // ── Scroll ──
    const gs = document.getElementById('gridScroll');
    if (gs) { gs.scrollLeft = t.scrollLeft; gs.scrollTop = t.scrollTop; }

    // ── Status ──
    if (typeof statusSpan !== 'undefined') {
        statusSpan.innerText = hasGrid
            ? `${t.name} · ${Object.keys(gridData.cells).length} notas`
            : 'Tab vacío — abre un MIDI (🎵) o crea un grid nuevo (📄 Nuevo).';
    }
}

// ── Helpers internos ─────────────────────────────────────────
function _tabParseKey(keyStr) {
    if (!keyStr) return null;
    const isMinor = keyStr.endsWith('m');
    return { tonic: keyStr.replace('m', ''), mode: isMinor ? 'minor' : 'major', rootClass: 0 };
}

function _tabActiveSegs(t) {
    const level = t.viewLevel;
    if (level === 'respiración' && t.breathingSegments.length)    return t.breathingSegments;
    if (level === 'frases'      && t.currentPhraseSegments.length) return t.currentPhraseSegments;
    if (level === 'acordes'     && t.currentFusedSegments.length)  return t.currentFusedSegments;
    return t.currentHarmonicSegments;
}

// ── API pública ──────────────────────────────────────────────

/** Cambia al tab idx guardando el estado actual. */
function tabSwitch(idx) {
    if (idx === _activeTabIdx || idx < 0 || idx >= _tabs.length) return;
    const wasPlaying = (typeof reproduciendo !== 'undefined') && reproduciendo;
    _tabSaveCurrent();
    _activeTabIdx = idx;
    _tabRestoreFrom(_tabs[_activeTabIdx]);
    _tabRender();
    // Si había reproducción activa y el nuevo tab tiene notas, arrancar automáticamente
    if (wasPlaying && typeof play === 'function' &&
        typeof gridData !== 'undefined' && Object.keys(gridData.cells).length > 0) {
        play();
    }
}

/** Crea un tab vacío y cambia a él. */
function tabNew() {
    _tabSaveCurrent();
    _tabs.push(_tabDefaults());
    _activeTabIdx = _tabs.length - 1;
    _tabRestoreFrom(_tabs[_activeTabIdx]);
    _tabRender();
}

/**
 * Punto de entrada unificado para el botón [+] y "📄 Nuevo" del menú.
 * Si el tab activo tiene contenido crea uno nuevo primero; luego abre
 * el panel de configuración de compases/BPM.
 */
function tabNewWithDialog() {
    const hasContent = Object.keys(gridData.cells).length > 0 || noteRows.length > 0;
    if (hasContent) {
        _tabSaveCurrent();
        _tabs.push(_tabDefaults());
        _activeTabIdx = _tabs.length - 1;
        _tabRestoreFrom(_tabs[_activeTabIdx]);
        _tabRender();
    }
    if (typeof toggleNewGridPanel === 'function') toggleNewGridPanel();
}

/** Cierra el tab idx. Siempre queda al menos 1. */
function tabClose(idx) {
    if (_tabs.length === 1) return;
    const t = _tabs[idx];
    const hasContent = Object.keys(t.gridData.cells).length > 0;
    if (t.isDirty && hasContent) {
        if (!confirm(`¿Cerrar "${t.name}" sin guardar?`)) return;
    }
    _tabs.splice(idx, 1);
    if (_activeTabIdx > idx)  _activeTabIdx--;
    if (_activeTabIdx >= _tabs.length) _activeTabIdx = _tabs.length - 1;
    _tabRestoreFrom(_tabs[_activeTabIdx]);
    _tabRender();
}

/** Actualiza el nombre del tab activo y quita el flag dirty. */
function tabMarkFileLoaded(name) {
    const t = _tabs[_activeTabIdx];
    t.name    = name || 'Sin título';
    t.isDirty = false;
    _tabRender();
}

/** Marca el tab activo como modificado (muestra ●). */
function tabMarkDirty() {
    if (!_tabs[_activeTabIdx].isDirty) {
        _tabs[_activeTabIdx].isDirty = true;
        _tabRender();
    }
}

// ── Render del tab bar ───────────────────────────────────────
function _tabRender() {
    const list = document.getElementById('tabList');
    if (!list) return;
    list.innerHTML = '';

    _tabs.forEach((t, idx) => {
        const el = document.createElement('div');
        el.className = 'tab-item' + (idx === _activeTabIdx ? ' tab-active' : '');

        const label = document.createElement('span');
        label.className   = 'tab-label';
        label.textContent = (t.isDirty ? '● ' : '') + t.name;
        label.title       = t.name;
        label.onclick     = () => tabSwitch(idx);

        const closeBtn = document.createElement('span');
        closeBtn.className   = 'tab-close';
        closeBtn.textContent = '✕';
        closeBtn.title       = 'Cerrar tab';
        closeBtn.onclick     = (e) => { e.stopPropagation(); tabClose(idx); };

        el.appendChild(label);
        el.appendChild(closeBtn);
        list.appendChild(el);
    });
}

document.addEventListener('DOMContentLoaded', () => { _tabRender(); });
