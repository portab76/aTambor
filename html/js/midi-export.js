// ============================================================
// midi-export.js — Exporta gridData a archivo .mid estándar
// Genera MIDI Tipo 1 (multitracks): track 0 = metadata,
// track 1 = notas del grid cuantizadas a stepWidth.
// Depende de: state.js
// ============================================================

// ── Codificación de enteros MIDI ──────────────────────────────

/** Entero de 4 bytes big-endian (para headers). */
function _int32(n) {
    return [(n >> 24) & 0xFF, (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF];
}

/** Entero de 2 bytes big-endian. */
function _int16(n) {
    return [(n >> 8) & 0xFF, n & 0xFF];
}

/**
 * Variable-Length Quantity — codificación MIDI para delta-times.
 * Un int de hasta 28 bits comprimido en 1-4 bytes.
 */
function _vlq(n) {
    if (n < 0x80)  return [n];
    if (n < 0x4000) return [0x80 | (n >> 7), n & 0x7F];
    if (n < 0x200000) return [0x80 | (n >> 14), 0x80 | ((n >> 7) & 0x7F), n & 0x7F];
    return [0x80 | (n >> 21), 0x80 | ((n >> 14) & 0x7F), 0x80 | ((n >> 7) & 0x7F), n & 0x7F];
}

// ── Construcción de tracks ────────────────────────────────────

/**
 * Envuelve un array de bytes de eventos en un chunk MTrk.
 * @param {number[]} eventBytes
 * @returns {number[]}
 */
function _makeMTrk(eventBytes) {
    return [
        0x4D, 0x54, 0x72, 0x6B,   // "MTrk"
        ..._int32(eventBytes.length),
        ...eventBytes
    ];
}

/**
 * Construye el track 0: tempo + compás.
 * Un evento de tempo cada vez que cambia en tempoPoints.
 */
function _buildTempoTrack() {
    const ticksPerStep = ppqn / 4;   // ppqn pulses = 1 negra = 4 semicorcheas
    const events = [];

    // Time signature (asume currentTimeSig)
    const ts = (typeof currentTimeSig !== 'undefined')
        ? currentTimeSig
        : { numerator: 4, denominator: 4 };
    const denomPow = Math.round(Math.log2(ts.denominator));   // 4 → 2, 8 → 3

    events.push(
        0x00,                          // delta 0
        0xFF, 0x58, 0x04,              // meta: time signature, 4 bytes
        ts.numerator & 0xFF,
        denomPow & 0xFF,
        0x18,                          // 24 MIDI clocks per metronome click
        0x08                           // 8 32nd notes per quarter
    );

    // Tempo points → μs per quarter note
    const points = (typeof tempoPoints !== 'undefined' && tempoPoints.length)
        ? tempoPoints
        : [{ step: 0, bpm: 120 }];

    let lastTick = 0;
    for (const tp of points) {
        const tick   = Math.round(tp.step * ticksPerStep);
        const delta  = tick - lastTick;
        lastTick     = tick;
        const uspqn  = Math.round(60000000 / tp.bpm);

        events.push(
            ..._vlq(delta),
            0xFF, 0x51, 0x03,          // meta: set tempo
            (uspqn >> 16) & 0xFF,
            (uspqn >>  8) & 0xFF,
             uspqn        & 0xFF
        );
    }

    // End of track
    events.push(0x00, 0xFF, 0x2F, 0x00);

    return _makeMTrk(events);
}

/**
 * Construye el track 1: notas del grid.
 * Cada celda de gridData.cells genera un noteOn + noteOff.
 */
function _buildNoteTrack() {
    const ticksPerStep = ppqn / 4;
    const offset = (typeof transposeOffset !== 'undefined') ? transposeOffset : 0;

    // Recopilar todos los eventos (noteOn + noteOff) con tick absoluto
    const evts = [];
    for (const [key, cell] of Object.entries(gridData.cells)) {
        const [noteStr, stepStr] = key.split(',');
        const note     = Math.min(127, Math.max(0, parseInt(noteStr) + offset));
        const step     = parseInt(stepStr);
        const vel      = Math.min(127, Math.max(1, cell.velocity || 64));
        const duration = Math.max(1, cell.duration || 1);

        const tickOn  = Math.round(step * ticksPerStep);
        const tickOff = Math.round((step + duration) * ticksPerStep) - 1;

        evts.push({ tick: tickOn,  type: 0x90, note, vel  });   // noteOn
        evts.push({ tick: tickOff, type: 0x80, note, vel: 0 }); // noteOff
    }

    // Ordenar por tick; empates: noteOff antes de noteOn (evita polifonía colgante)
    evts.sort((a, b) => a.tick !== b.tick ? a.tick - b.tick : a.type - b.type);

    // Serializar con delta-times
    const bytes = [];
    let lastTick = 0;
    for (const ev of evts) {
        const delta = ev.tick - lastTick;
        lastTick    = ev.tick;
        bytes.push(..._vlq(delta), ev.type, ev.note & 0x7F, ev.vel & 0x7F);
    }

    // End of track
    bytes.push(0x00, 0xFF, 0x2F, 0x00);

    return _makeMTrk(bytes);
}

// ── Punto de entrada público ──────────────────────────────────

/**
 * Genera y descarga un archivo .mid desde el estado actual del grid.
 * Llama a esta función desde un botón de la toolbar.
 */
function exportMIDI() {
    if (!gridData || Object.keys(gridData.cells).length === 0) {
        alert('No hay notas en el grid para exportar.');
        return;
    }

    const tempoTrack = _buildTempoTrack();
    const noteTrack  = _buildNoteTrack();

    // MIDI Header chunk: tipo 1, 2 tracks, ppqn
    const header = [
        0x4D, 0x54, 0x68, 0x64,   // "MThd"
        ..._int32(6),              // longitud siempre 6
        ..._int16(1),              // formato 1 (multitracks)
        ..._int16(2),              // número de tracks
        ..._int16(ppqn)            // resolución temporal
    ];

    const midiBytes = new Uint8Array([...header, ...tempoTrack, ...noteTrack]);
    const blob      = new Blob([midiBytes], { type: 'audio/midi' });
    const url       = URL.createObjectURL(blob);

    const a    = document.createElement('a');
    a.href     = url;
    const base = (typeof currentMidiFileName !== 'undefined' && currentMidiFileName)
        ? currentMidiFileName.replace(/\.mid[i]?$/i, '')
        : 'composicion';
    a.download = `${base}_export.mid`;
    a.click();
    URL.revokeObjectURL(url);

    if (typeof statusSpan !== 'undefined')
        statusSpan.innerText = `MIDI exportado: ${a.download}`;
}
