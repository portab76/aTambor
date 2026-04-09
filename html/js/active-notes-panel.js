// ============================================================
// active-notes-panel.js — Ventana flotante de notas activas
// Resumen unificado de todas las notas únicas del instrumento
// Depende de: state.js, motor-map.js, chord-row.js
// ============================================================

const _NOTE_NAMES_ANP = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

let _anpCurrentFilter = 'all';  // 'all' o 'motor'

// ─────────────────────────────────────────────
// Toggle panel abierto/cerrado
// ─────────────────────────────────────────────

function activeNotesPanelToggle() {
    const existing = document.getElementById('activeNotesPanel');
    if (existing) {
        existing.remove();
        return;
    }
    _anpRender(_anpCurrentFilter);
}

// ─────────────────────────────────────────────
// Renderizar panel completo
// ─────────────────────────────────────────────

function _anpRender(filterMode = 'all') {
    _anpCurrentFilter = filterMode;

    // Cerrar panel anterior si existe
    const existing = document.getElementById('activeNotesPanel');
    if (existing) existing.remove();

    if (Object.keys(gridData.cells).length === 0) {
        console.log('No active notes to display');
        return;
    }

    // ─────────────────────────────────────────────
    // Extraer y agrupar notas
    // ─────────────────────────────────────────────

    const noteCountMap = {};
    for (const key of Object.keys(gridData.cells)) {
        const note = parseInt(key.split(',')[0]);
        noteCountMap[note] = (noteCountMap[note] || 0) + 1;
    }

    // Agrupar por octava
    const octaves = {};
    for (const [noteNum, count] of Object.entries(noteCountMap)) {
        const n = parseInt(noteNum);
        const octave = Math.floor(n / 12) - 1;
        if (!octaves[octave]) octaves[octave] = [];
        octaves[octave].push({ note: n, count });
    }

    // Ordenar notas dentro de cada octava
    for (const octave in octaves) {
        octaves[octave].sort((a, b) => a.note - b.note);
    }

    // ─────────────────────────────────────────────
    // Construir DOM
    // ─────────────────────────────────────────────

    const panel = document.createElement('div');
    panel.id = 'activeNotesPanel';
    panel.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        width: 380px;
        background: #1e1e32;
        border: 1px solid #5a5aaa;
        border-radius: 8px;
        box-shadow: 0 8px 32px #00000088;
        z-index: 9998;
        font-family: 'Segoe UI', sans-serif;
        color: #ddd;
        user-select: none;
    `;

    // ── Header ──
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: #2a2a48;
        padding: 10px 14px;
        border-bottom: 1px solid #3a3a5a;
        border-radius: 8px 8px 0 0;
    `;

    const title = document.createElement('span');
    title.style.cssText = `
        font-size: 13px;
        font-weight: bold;
        color: #aaa;
    `;
    const totalNotes = Object.keys(noteCountMap).length;
    title.textContent = `🎵 Notas activas — ${totalNotes}`;

    const filterGroup = document.createElement('div');
    filterGroup.style.cssText = `
        display: flex;
        gap: 6px;
    `;

    const btnAll = document.createElement('button');
    btnAll.textContent = 'Todas';
    btnAll.style.cssText = `
        background: ${filterMode === 'all' ? '#2a4a7a' : '#1a1a30'};
        border: 1px solid ${filterMode === 'all' ? '#5a7aaa' : '#3a3a5a'};
        color: ${filterMode === 'all' ? '#aaccff' : '#888'};
        padding: 3px 8px;
        border-radius: 3px;
        font-size: 11px;
        cursor: pointer;
        transition: 0.1s;
    `;
    btnAll.onclick = (e) => {
        e.stopPropagation();
        _anpRender('all');
    };

    const btnMotor = document.createElement('button');
    btnMotor.textContent = 'Con motor';
    btnMotor.style.cssText = `
        background: ${filterMode === 'motor' ? '#2a4a7a' : '#1a1a30'};
        border: 1px solid ${filterMode === 'motor' ? '#5a7aaa' : '#3a3a5a'};
        color: ${filterMode === 'motor' ? '#aaccff' : '#888'};
        padding: 3px 8px;
        border-radius: 3px;
        font-size: 11px;
        cursor: pointer;
        transition: 0.1s;
    `;
    btnMotor.onclick = (e) => {
        e.stopPropagation();
        _anpRender('motor');
    };

    filterGroup.appendChild(btnAll);
    filterGroup.appendChild(btnMotor);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
        background: none;
        border: none;
        color: #888;
        font-size: 16px;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 4px;
    `;
    closeBtn.onmouseenter = () => closeBtn.style.background = '#aa3333';
    closeBtn.onmouseleave = () => closeBtn.style.background = 'none';
    closeBtn.onclick = () => panel.remove();

    header.appendChild(title);
    header.appendChild(filterGroup);
    header.appendChild(closeBtn);

    // ── Body (chips) ──
    const body = document.createElement('div');
    body.style.cssText = `
        padding: 10px 14px;
        max-height: 400px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
    `;

    // Iterar octavas ordenadas
    const sortedOctaves = Object.keys(octaves).sort((a, b) => parseInt(a) - parseInt(b));
    for (const octaveStr of sortedOctaves) {
        const octave = parseInt(octaveStr);
        const notes = octaves[octave];

        const octaveDiv = document.createElement('div');
        octaveDiv.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        const octaveLabel = document.createElement('span');
        octaveLabel.textContent = `C${octave}–B${octave}`;
        octaveLabel.style.cssText = `
            font-size: 10px;
            color: #7777aa;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 2px;
        `;
        octaveDiv.appendChild(octaveLabel);

        const chipsRow = document.createElement('div');
        chipsRow.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
        `;

        for (const { note, count } of notes) {
            const noteName = _NOTE_NAMES_ANP[note % 12];
            const hasMotor = motorForNote(note) !== null;

            // Si filterMode=motor y no tiene motor → skip
            if (filterMode === 'motor' && !hasMotor) continue;

            const chip = document.createElement('div');
            chip.dataset.midi = note;
            chip.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 4px 8px;
                border-radius: 4px;
                background: ${hasMotor ? '#1a5f7a' : '#3a3a4a'};
                border: 1px solid ${hasMotor ? '#3a8aaa' : '#555'};
                font-size: 12px;
                color: ${hasMotor ? '#aaffdd' : '#aaa'};
                cursor: pointer;
                transition: filter 0.1s, transform 0.08s;
                font-weight: bold;
            `;

            const noteText = document.createElement('span');
            noteText.textContent = `${noteName}${octave}`;
            noteText.style.cssText = 'flex-shrink:0;';

            const countText = document.createElement('span');
            countText.textContent = `×${count}`;
            countText.style.cssText = `
                font-size: 10px;
                opacity: 0.7;
                flex-shrink: 0;
            `;

            chip.appendChild(noteText);
            chip.appendChild(countText);

            chip.addEventListener('mouseenter', () => {
                chip.style.filter = 'brightness(1.35)';
            });
            chip.addEventListener('mouseleave', () => {
                chip.style.filter = '';
            });

            chip.addEventListener('click', (e) => {
                e.stopPropagation();
                _anpPlayNote(note, chip);
            });

            chipsRow.appendChild(chip);
        }

        octaveDiv.appendChild(chipsRow);
        body.appendChild(octaveDiv);
    }

    // Agregar estilos globales para animaciones
    const style = document.createElement('style');
    style.textContent = `
        #activeNotesPanel .anp-ringing {
            background: #2a7aaa !important;
            transform: scale(1.1) !important;
        }
    `;
    panel.appendChild(style);

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);
}

// ─────────────────────────────────────────────
// Reproducir nota + animación
// ─────────────────────────────────────────────

function _anpPlayNote(midi, chipElement) {
    const DURATION_S = 1.2;

    // ── Audio MIDI virtual ─────────────────────────────────────
    if (soundfontLoaded && typeof MIDI !== 'undefined' && MIDI.noteOn) {
        MIDI.noteOn( 0, midi, 90, 0);
        MIDI.noteOff(0, midi, DURATION_S);
    }

    // ── Motores ESP32 ──────────────────────────────────────────
    if (typeof wsConnected !== 'undefined' && wsConnected &&
        typeof MOTOR_MAP !== 'undefined' && typeof sendCommand === 'function') {

        const hitMs     = 80;
        const retractMs = 150;

        const cfg = MOTOR_MAP.find(m => m.note === midi);
        if (cfg) {
            const cmd = `e; m ${cfg.motor}; o ${cfg.homePwm}; t ${hitMs}; v ${cfg.vel}; t ${retractMs}; v 0; p;`;
            sendCommand(cmd);
        }
    }

    // ── Animar chip ───────────────────────────────────────────
    chipElement.style.background = '#2a7aaa';
    chipElement.style.transform = 'scale(1.1)';
    setTimeout(() => {
        chipElement.style.background = '';
        chipElement.style.transform = '';
    }, DURATION_S * 1000);
}

// ─────────────────────────────────────────────
// Refrescar panel si está abierto
// ─────────────────────────────────────────────

function activeNotesPanelRefresh() {
    const panel = document.getElementById('activeNotesPanel');
    if (!panel) return;

    // Eliminar y recrear
    panel.remove();
    _anpRender(_anpCurrentFilter);
}
