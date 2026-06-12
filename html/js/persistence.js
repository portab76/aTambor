// ============================================================
// persistence.js — Exportación, guardado y carga de proyectos
// Depende de: state.js, piano-roll.js, chord-row.js
// ============================================================

/**
 * Guarda el estado completo del proyecto en un archivo JSON.
 */
function saveProject() {
    const project = {
        gridData,
        noteRows,
        totalSteps,
        ticksPerStep: ppqn / 4,
        selectedChannel,
        currentKey,
        harmonicSegments:  currentHarmonicSegments,
        fusedSegments:     currentFusedSegments,
        phraseSegments:    currentPhraseSegments,
        tempoMap,
        tempoPoints:    (typeof tempoPoints    !== 'undefined') ? tempoPoints.map(tp => ({ ...tp }))    : [],
        sectionMarkers: (typeof sectionMarkers !== 'undefined') ? sectionMarkers.map(sm => ({ ...sm })) : [],
        ppqn,
        stepWidth,
        rowHeight
    };
    const name = currentMidiFileName
        ? currentMidiFileName.replace(/\.midi?$/i, '')
        : 'midi_grid_project';
    if (typeof recentFilesAdd === 'function') recentFilesAdd(name, project);
    _downloadJSON(project, `${name}.json`);
    statusSpan.innerText = "Proyecto guardado.";
}

/**
 * Aplica un objeto de proyecto al estado global y redibuja.
 * Usado por loadProject() y por el historial de recientes.
 * @param {Object} p — proyecto parseado (estructura de saveProject)
 */
function _applyProjectData(p) {
    gridData                = p.gridData;
    noteRows                = p.noteRows;
    totalSteps              = p.totalSteps;
    ticksPerStep            = p.ticksPerStep;
    selectedChannel         = p.selectedChannel;
    currentKey              = p.currentKey;
    currentHarmonicSegments = p.harmonicSegments || [];
    currentFusedSegments    = p.fusedSegments    || [];
    currentPhraseSegments   = p.phraseSegments   || [];
    tempoMap                = p.tempoMap;
    ppqn                    = p.ppqn;

    // ── Tempo points ──────────────────────────────────
    if (p.tempoPoints && p.tempoPoints.length) {
        tempoPoints = p.tempoPoints.map(tp => ({ ...tp }));
    } else {
        tempoPoints = [{ step: 0, bpm: tempoMap?.[0]?.bpm || 120 }];
    }
    sectionMarkers = (p.sectionMarkers || []).map(sm => ({ ...sm }));

    // ── BPM ───────────────────────────────────────────
    const bpmEl = document.getElementById('bpmInput');
    if (bpmEl) bpmEl.value = Math.round(tempoPoints[0].bpm);

    // ── Canal en el selector ──────────────────────────
    if (selectedChannel !== null) {
        const sel = instrumentSelect;
        let opt = sel.querySelector(`option[value="${selectedChannel}"]`);
        if (!opt) {
            opt = document.createElement('option');
            opt.value       = selectedChannel;
            opt.textContent = `Canal ${selectedChannel + 1}`;
            sel.appendChild(opt);
        }
        sel.value    = selectedChannel;
        sel.disabled = false;
        loadInstrumentBtn.disabled = false;
    }

    // ── Re-analizar si el JSON no tiene segmentos guardados ──
    if (currentHarmonicSegments.length === 0 &&
        typeof performHarmonicAnalysisFromGrid === 'function') {
        const analysis = performHarmonicAnalysisFromGrid();
        if (analysis) {
            currentHarmonicSegments = analysis.segments;
            currentFusedSegments    = analysis.fusedSegments;
            currentPhraseSegments   = analysis.phraseSegments;
            currentKey = analysis.key.tonic + (analysis.key.mode === 'minor' ? 'm' : '');
        }
    }

    if (typeof historyClear === 'function') historyClear();

    // ── Redibujar ─────────────────────────────────────
    applyZoom(p.stepWidth || 8, p.rowHeight || 25);

    // ── Habilitar botones de transporte y herramientas ─
    playBtn.disabled = false;
    _enableMeasureButtons();
    const abBtn = document.getElementById('abLoopBtn');
    if (abBtn) abBtn.disabled = false;
    document.getElementById('activeNotesBtn').disabled = false;
    const heatBtn2 = document.getElementById('heatMapBtn');
    if (heatBtn2) heatBtn2.disabled = false;
    const chordPanelBtn2 = document.getElementById('chordPanelBtn');
    if (chordPanelBtn2) chordPanelBtn2.disabled = false;

    // ── Selector de nivel armónico ────────────────────
    const viewSel = document.getElementById('viewLevelSelect');
    if (viewSel) {
        viewSel.disabled = false;
        const hasSegs = currentHarmonicSegments.length > 0;
        // Habilitar/deshabilitar opciones según datos disponibles
        viewSel.querySelector('option[value="acordes"]').disabled    = (currentFusedSegments.length   === 0);
        viewSel.querySelector('option[value="frases"]').disabled     = (currentPhraseSegments.length  === 0);
        viewSel.querySelector('option[value="respiración"]').disabled = (typeof breathingSegments === 'undefined' || breathingSegments.length === 0);
        // Seleccionar nivel por defecto según datos disponibles
        if (currentFusedSegments.length > 0)        viewSel.value = 'acordes';
        else if (currentHarmonicSegments.length > 0) viewSel.value = 'pasos';
        else                                          viewSel.value = 'pasos';
    }

    // ── Respiración ───────────────────────────────────
    if (typeof calcularBreathingPoints === 'function') {
        calcularBreathingPoints();
        if (viewSel) {
            viewSel.querySelector('option[value="respiración"]').disabled =
                (typeof breathingSegments === 'undefined' || breathingSegments.length === 0);
        }
    }

    // ── Chord row ─────────────────────────────────────
    const chordRow = document.getElementById('chordRowContainer');
    if (chordRow) {
        if (currentHarmonicSegments.length > 0 && typeof drawChordRow === 'function') {
            const isMinor = currentKey && currentKey.endsWith('m');
            const keyObj  = currentKey
                ? { tonic: currentKey.replace('m', ''), mode: isMinor ? 'minor' : 'major', rootClass: 0 }
                : null;
            const level = viewSel ? viewSel.value : 'pasos';
            let segs = currentHarmonicSegments;
            if (level === 'acordes'    && currentFusedSegments.length)  segs = currentFusedSegments;
            if (level === 'frases'     && currentPhraseSegments.length) segs = currentPhraseSegments;
            drawChordRow(segs, keyObj);
        } else {
            chordRow.innerHTML = '';
        }
    }

    // ── Botones de fragmento A-B y pegado ─────────────────────
    if (typeof _updateFragmentButtons === 'function') _updateFragmentButtons();
    if (typeof _updateAbBtn           === 'function') _updateAbBtn();
}

/**
 * Carga el estado del proyecto desde un archivo JSON.
 * @param {File} file
 */
function loadProject(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const p    = JSON.parse(e.target.result);
            const name = file.name.replace(/\.json$/i, '');
            const hasContent = Object.keys(gridData.cells).length > 0 || noteRows.length > 0;
            if (hasContent && typeof tabNew === 'function') tabNew();
            _applyProjectData(p);
            if (typeof recentFilesAdd    === 'function') recentFilesAdd(name, p);
            if (typeof tabMarkFileLoaded === 'function') tabMarkFileLoaded(name);
            statusSpan.innerText = "Proyecto cargado.";
        } catch (err) {
            console.error(err);
            statusSpan.innerText = "Error al cargar el proyecto.";
        }
    };
    reader.readAsText(file);
}

// ---- Utilidad interna ----
function _downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
