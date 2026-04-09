// ============================================================
// persistence.js — Exportación, guardado y carga de proyectos
// Depende de: state.js, piano-roll.js, chord-row.js
// ============================================================

/**
 * Exporta los eventos del grid a un archivo JSON
 * (placeholder hasta integrar midi-writer-js para MIDI binario real).
 */
function exportToMIDI() {
    if (selectedChannel === null) {
        alert("Selecciona un instrumento primero.");
        return;
    }
    const tps    = ppqn / 4;
    const events = [];

    for (const [key, cell] of Object.entries(gridData.cells)) {
        const [noteStr, stepStr] = key.split(',');
        const note     = parseInt(noteStr);
        const step     = parseInt(stepStr);
        const tickOn   = step * tps;
        const tickOff  = (step + cell.duration) * tps;
        events.push({ tick: tickOn,  type: 'noteOn',  channel: selectedChannel, note, velocity: cell.velocity });
        events.push({ tick: tickOff, type: 'noteOff', channel: selectedChannel, note, velocity: 0 });
    }
    events.sort((a, b) => a.tick - b.tick);

    _downloadJSON(events, "midi_export.json");
    statusSpan.innerText = "Eventos exportados a JSON.";
}

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
        harmonicSegments: currentHarmonicSegments,
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
            gridData                = p.gridData;
            noteRows                = p.noteRows;
            totalSteps              = p.totalSteps;
            ticksPerStep            = p.ticksPerStep;
            selectedChannel         = p.selectedChannel;
            currentKey              = p.currentKey;
            currentHarmonicSegments = p.harmonicSegments || [];
            tempoMap                = p.tempoMap;
            ppqn                    = p.ppqn;
            stepWidth               = p.stepWidth  || 40;
            rowHeight               = p.rowHeight  || 25;

            canvas.width        = totalSteps * stepWidth;
            canvas.height       = noteRows.length * rowHeight;
            canvas.style.width  = `${canvas.width}px`;
            canvas.style.height = `${canvas.height}px`;

            drawPianoRollWithPlayhead(-1);
            if (currentHarmonicSegments.length) drawChordRow(currentHarmonicSegments, null);
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
