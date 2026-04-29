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
        harmonicSegments:       currentHarmonicSegments,
        fusedSegments:          currentFusedSegments,
        phraseSegments:         currentPhraseSegments,
        tempoMap,
        ppqn,
        stepWidth,
        rowHeight
    };
    _downloadJSON(project, "midi_grid_project.json");
    statusSpan.innerText = "Proyecto guardado.";
}

/**
 * Carga el estado del proyecto desde un archivo JSON.
 * @param {File} file
 */
function loadProject(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const p = JSON.parse(e.target.result);

            // ── Restaurar estado ──────────────────────────────
            gridData                = p.gridData;
            noteRows                = p.noteRows;
            totalSteps              = p.totalSteps;
            ticksPerStep            = p.ticksPerStep;
            selectedChannel         = p.selectedChannel;
            currentKey              = p.currentKey;
            currentHarmonicSegments = p.harmonicSegments   || [];
            currentFusedSegments    = p.fusedSegments      || [];
            currentPhraseSegments   = p.phraseSegments     || [];
            tempoMap                = p.tempoMap;
            ppqn                    = p.ppqn;

            // ── BPM ───────────────────────────────────────────
            const bpmEl = document.getElementById('bpmInput');
            if (bpmEl && tempoMap?.[0]?.bpm) bpmEl.value = tempoMap[0].bpm;

            // ── Canal en el selector ──────────────────────────
            if (selectedChannel !== null) {
                const sel = instrumentSelect;
                // Añadir opción si no existe (proyecto cargado sin MIDI previo)
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

            // ── Redibujar ─────────────────────────────────────
            applyZoom(p.stepWidth || 40, p.rowHeight || 25);

            // ── Habilitar botones de transporte y herramientas ─
            playBtn.disabled = false;
            _enableMeasureButtons();
            const abBtn = document.getElementById('abLoopBtn');
            if (abBtn) abBtn.disabled = false;
            document.getElementById('activeNotesBtn').disabled = false;

            // ── Selector de nivel armónico ────────────────────
            const viewSel = document.getElementById('viewLevelSelect');
            if (viewSel) {
                viewSel.disabled = false;
                viewSel.querySelector('option[value="frases"]').disabled =
                    (currentPhraseSegments.length === 0);
            }

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
