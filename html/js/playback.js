// ============================================================
// playback.js — Motor de reproducción paso a paso
// Usa MIDI.noteOn / MIDI.noteOff con AudioContext para timing preciso.
// Depende de: state.js, piano-roll.js
// ============================================================

let _playInterval    = null;   // handle del setInterval
let _playStartOffset = 0;      // paso desde el que arrancó play() — para loop y sync ESP32
let _pendingTimers   = [];     // handles de setTimeout activos — se cancelan en stop()

let _esp32LastLoadedChordIndex = -1;  // índice del último acorde enviado al ESP32
let _esp32LastLoadedStep       = 0;   // paso hasta el que está cargado el ESP32
let _appendSentAt              = null; // performance.now() del último APPEND enviado
let _appendSentStep            = 0;   // paso de cierre de ese APPEND (para RTT)

/** BPM efectivo en el paso dado, consultando tempoPoints (con fallback al input). */
function _bpmAtStep(step) {
    if (typeof tempoPoints !== 'undefined' && tempoPoints.length) {
        let bpm = tempoPoints[0].bpm;
        for (const tp of tempoPoints) {
            if (tp.step <= step) bpm = tp.bpm;
            else break;
        }
        return bpm;
    }
    const el = document.getElementById('bpmInput');
    return el ? (parseFloat(el.value) || 120) : 120;
}

/** ms por semicorchea en el paso dado (por defecto pasoActual). */
const MS_PER_STEP = (step) => {
    const s   = step !== undefined ? step : (typeof pasoActual !== 'undefined' ? pasoActual : 0);
    return (60000 / _bpmAtStep(s)) / 4;
};

let _currentBpm = 0;  // BPM con el que se arrancó el interval activo

// ── Helpers de streaming ──────────────────────────────────────────────────────

/** Devuelve el índice del segmento de acorde que contiene el paso dado. */
function _chordIndexAtStep(step) {
    const segs = _activeSegments();
    for (let i = 0; i < segs.length; i++) {
        if (step >= segs[i].startStep && step < segs[i].endStep) return i;
    }
    return Math.max(0, segs.length - 1);
}

/** Construye y envía APPEND para el acorde chordIndex. */
function _appendChordToEsp32(chordIndex) {
    if (!wsConnected) return;
    const segs = _activeSegments();
    if (chordIndex < 0 || chordIndex >= segs.length) return;

    const chord = segs[chordIndex];
    let seq = buildRangeSequence(MOTOR_MAP, chord.startStep, chord.endStep);

    if (!seq) {
        // Sin notas mapeadas en este acorde: enviar keep-alive de silencio para
        // extender g_tiempoMaximo en el firmware y que no salga del event loop.
        const chordMs = Math.round((chord.endStep - chord.startStep) * MS_PER_STEP());
        const m = MOTOR_MAP && MOTOR_MAP.find(e => !e.muted) || (MOTOR_MAP && MOTOR_MAP[0]);
        if (m && chordMs > 0) {
            seq = `m ${m.motor}; o ${m.homePwm};\nt ${chordMs}; v 0;\n`;
            console.log(`[streaming] APPEND acorde ${chordIndex + 1}/${segs.length} ` +
                        `(keep-alive ${chordMs}ms, sin notas)`);
        } else {
            // Sin motores: solo avanzar puntero
            _esp32LastLoadedChordIndex = chordIndex;
            _esp32LastLoadedStep       = chord.endStep;
            return;
        }
    } else {
        // Quitar p; final — la reproducción ya está en curso
        seq = seq.endsWith('p;\n') ? seq.slice(0, -3) : seq;
        if (!seq.trim()) {
            _esp32LastLoadedChordIndex = chordIndex;
            _esp32LastLoadedStep       = chord.endStep;
            return;
        }
        console.log(`[streaming] APPEND acorde ${chordIndex + 1}/${segs.length} ` +
                    `[${chord.startStep}–${chord.endStep}) · ${seq.length}B`);
    }

    _appendSentAt              = performance.now();
    _appendSentStep            = chord.endStep;
    _esp32LastLoadedStep       = chord.endStep;
    _esp32LastLoadedChordIndex = chordIndex;

    sendCommand('APPEND\n' + seq);
}

/**
 * Envía el bloque inicial de secuencia al ESP32 como comando PLAY.
 * Maneja el partido en bloques ≤8KB y el p; final.
 */
function _sendPlayCommand(seq) {
    const stepMs = MS_PER_STEP();
    let seqBody = seq;
    let hasPlayCmd = false;
    if (seqBody.endsWith('p;\n')) {
        seqBody    = seqBody.slice(0, -3);
        hasPlayCmd = true;
    }

    const blocks  = validateSequenceSize(seqBody);
    const adv     = (typeof ledAdvanceMs !== 'undefined') ? Math.round(ledAdvanceMs) : 0;
    console.log(`[play] Enviando PLAY: ${seq.length}B → ${blocks.length} bloque(s) ≤8KB`);

    if (blocks.length === 1) {
        if (_serialActive) {
            // Serial: stream byte a byte — p; inline llega al firmware en orden garantizado
            const body    = hasPlayCmd ? blocks[0] + 'p;\n' : blocks[0];
            sendCommand(`PLAY|midiGrid|${Math.round(stepMs)}|${adv}\n` + body);
        } else {
            // WebSocket: cada ws.send() es un frame independiente — p; debe ser mensaje separado
            sendCommand(`PLAY|midiGrid|${Math.round(stepMs)}|${adv}\n` + blocks[0]);
            if (hasPlayCmd) {
                _pendingTimers.push(setTimeout(() => {
                    console.log('[play] Enviando p; (WS, bloque único)');
                    sendCommand('p;');
                }, 150));
            }
        }
        return;
    }

    // Múltiples bloques: enviar por partes con timers
    const fullCmd = `PLAY|midiGrid|${Math.round(stepMs)}|${adv}\n` + blocks[0];
    sendCommand(fullCmd);

    let lastDelay = 0;
    for (let i = 1; i < blocks.length; i++) {
        lastDelay = i * 200;
        const block = blocks[i];
        _pendingTimers.push(setTimeout(() => {
            console.log(`[play] APPEND bloque ${i + 1}/${blocks.length} (${block.length}B)`);
            sendCommand('APPEND\n' + block);
        }, lastDelay));
    }

    if (hasPlayCmd) {
        _pendingTimers.push(setTimeout(() => {
            console.log('[play] Enviando p; para ejecutar la secuencia');
            sendCommand('p;');
        }, lastDelay + 300));
    }
}

// ── play() ───────────────────────────────────────────────────────────────────

/**
 * Inicia la reproducción desde pasoActual.
 * G1: envía la secuencia completa al ESP32 y arranca el audio 20ms después.
 */
function play() {
    if (!gridData || Object.keys(gridData.cells).length === 0) {
        statusSpan.innerText = "No hay notas en el grid.";
        return;
    }
    if (reproduciendo) return;

    if (!soundfontLoaded) {
        statusSpan.innerText = "⚠ SoundFont no cargado aún. Espera unos segundos.";
        return;
    }

    // Si A-B está activo y A está marcado, arrancar desde loopA
    const abActive = (typeof loopAB !== 'undefined') && loopAB && loopA >= 0 && loopB > loopA;
    if ((typeof loopAB !== 'undefined') && loopAB && loopA >= 0) pasoActual = loopA;

    // ── G1: enviar secuencia completa al ESP32 (WiFi o Serial) ─────────────────
    const isConnected = (typeof wsConnected !== 'undefined' && wsConnected) ||
                        (typeof _serialActive !== 'undefined' && _serialActive);
    console.log(`[play] wsConnected=${wsConnected}, _serialActive=${_serialActive}`);

    if (isConnected) {
        const seq = abActive
            ? buildRangeSequence(MOTOR_MAP, loopA, loopB)
            : pasoActual > 0
                ? buildRemainingSequence(MOTOR_MAP, pasoActual)
                : buildFullSequence(MOTOR_MAP);

        console.log(`[seq] ${abActive ? `A-B [${loopA},${loopB})` : pasoActual > 0 ? `desde paso ${pasoActual}` : 'full'} · ${seq?.length ?? 0}B`);

        if (!seq) {
            console.warn('[play] Sin notas mapeadas a motores — se omite PLAY al ESP32');
        } else {
            _sendPlayCommand(seq);
        }
    }

    _playStartOffset = pasoActual;
    _startPlaybackLoop();
}

/** Arranca el setInterval de audio (separado para poder llamarlo desde play y resume) */
function _startPlaybackLoop() {
    reproduciendo = true;
    playBtn.disabled  = true;
    stopBtn.disabled  = false;
    statusSpan.innerText = "Reproduciendo...";
    _currentBpm = _bpmAtStep(pasoActual);
    _tick();
    _playInterval = setInterval(_tick, MS_PER_STEP(pasoActual));
}

// ── pause() ──────────────────────────────────────────────────────────────────

/**
 * Pausa la reproducción conservando la posición.
 */
function pause() {
    if (!reproduciendo) return;
    reproduciendo = false;
    clearInterval(_playInterval);
    _playInterval = null;
    _pendingTimers.forEach(clearTimeout);
    _pendingTimers = [];
    playBtn.disabled  = false;
    statusSpan.innerText = "Pausado.";
}

// ── stop() ───────────────────────────────────────────────────────────────────

/**
 * Detiene la reproducción y vuelve al inicio.
 * G2: limpia el interval de audio y envía STOP al ESP32.
 */
function stop() {
    reproduciendo     = false;
    autoAdvanceActive = false;
    clearInterval(_playInterval);
    _playInterval = null;
    _pendingTimers.forEach(clearTimeout);
    _pendingTimers = [];
    pasoActual       = 0;
    _playStartOffset = 0;
    playBtn.disabled  = false;
    drawPianoRollWithPlayhead(-1);
    updateRulerPlayhead(-1);
    _clearChordHighlight();
    statusSpan.innerText = "Detenido.";

    // Limpiar estado de streaming
    _esp32LastLoadedChordIndex = -1;
    _esp32LastLoadedStep       = 0;
    _appendSentAt              = null;
    const bufferEl = document.getElementById('streamingBuffer');
    if (bufferEl) { bufferEl.style.display = 'none'; bufferEl.textContent = ''; }

    // Cancelar cualquier auto-avance pendiente (evita lanzar el siguiente lote
    // si stop() fue llamado manualmente durante el window de 400ms)
    if (typeof _pendingAutoAdvance !== 'undefined') _pendingAutoAdvance = false;
    onStoppedCallback = null;

    // G2: parar el ESP32
    if (typeof sendStop === 'function') sendStop();
}

function _clearChordHighlight() {
    if (_lastHighlightedBlock) {
        _lastHighlightedBlock.style.outline    = '';
        _lastHighlightedBlock.style.boxShadow  = '';
        _lastHighlightedBlock.style.zIndex     = '';
        _lastHighlightedBlock.style.fontWeight = '';
        _lastHighlightedBlock = null;
    }
}

// ── seekToStep() ─────────────────────────────────────────────────────────────

/**
 * Salta a un paso concreto (seek desde la regla de compases).
 * Si estaba reproduciendo, para y rearranea desde el nuevo punto.
 * @param {number} step
 */
function seekToStep(step) {
    const target = Math.max(0, Math.min(totalSteps - 1, step));
    const wasPlaying = reproduciendo;

    if (wasPlaying) {
        reproduciendo = false;
        clearInterval(_playInterval);
        _playInterval = null;
    }

    pasoActual       = target;
    _playStartOffset = target;

    drawPianoRollWithPlayhead(target);
    updateRulerPlayhead(target);
    _clearChordHighlight();

    if (typeof _selectChordAtStep === 'function') _selectChordAtStep(target);

    if (wasPlaying) play();
}

// ── _tick() ──────────────────────────────────────────────────────────────────

let _tickCount = 0;

function _tick() {
    // ── A-B loop tiene prioridad sobre loop normal ────────────
    const abActive = (typeof loopAB !== 'undefined') && loopAB && loopA >= 0 && loopB > loopA;

    // ── Fin de segmento ───────────────────────────────────────
    if (abActive && pasoActual >= loopB) {
        if (autoAdvanceActive) {
            _startNextBatch();
            return;
        }
        stop();
        return;
    } else if (pasoActual >= totalSteps) {
        stop();
        return;
    }

    // Reproducir notas que comienzan exactamente en este paso
    let notasEnEstePaso = 0;
    const offset = (typeof transposeOffset !== 'undefined') ? transposeOffset : 0;
    for (const [key, cell] of Object.entries(gridData.cells)) {
        const [noteStr, stepStr] = key.split(',');
        if (parseInt(stepStr) !== pasoActual) continue;

        const note           = parseInt(noteStr);
        const transposedNote = note + offset;
        const velocity       = cell.velocity;
        const delayOff       = (cell.duration * MS_PER_STEP()) / 1000;

        const motorOnly = document.getElementById('motorOnlyCheckbox')?.checked;
        if (motorOnly && !motorForNote(note)) continue;
        if (motorForNote(note)?.muted) continue;

        notasEnEstePaso++;
        if (typeof MIDI !== 'undefined' && typeof MIDI.noteOn === 'function') {
            MIDI.noteOn( 0, transposedNote, velocity, 0);
            MIDI.noteOff(0, transposedNote, delayOff);
        }
    }

    if (_tickCount < 5) {
        console.log(`[tick ${pasoActual}] notas: ${notasEnEstePaso} | MIDI: ${typeof MIDI !== 'undefined'}`);
        _tickCount++;
    }

    if (activeHighlight && document.getElementById('chordPanel')?.classList.contains('open')) {
        drawPianoRollWithHighlightAndPlayhead(
            activeHighlight.classes,
            activeHighlight.startStep,
            activeHighlight.endStep,
            pasoActual
        );
    } else {
        drawPianoRollWithPlayhead(pasoActual);
    }
    updateRulerPlayhead(pasoActual);
    _autoScroll(pasoActual);
    _highlightCurrentChord(pasoActual);
    if (typeof _updateChordPanelFromPlayback === 'function') _updateChordPanelFromPlayback();
    pasoActual++;

    // ── Cambio de tempo: reiniciar interval si el BPM cambió ─────
    if (typeof tempoPoints !== 'undefined' && tempoPoints.length > 1) {
        const newBpm = _bpmAtStep(pasoActual);
        if (newBpm !== _currentBpm) {
            _currentBpm = newBpm;
            const bpmEl = document.getElementById('bpmInput');
            if (bpmEl) bpmEl.value = Math.round(newBpm);
            clearInterval(_playInterval);
            _playInterval = setInterval(_tick, MS_PER_STEP(pasoActual));
        }
    }
}

// ── Resaltado del acorde activo en el chord row ───────────────────────────────

let _lastHighlightedBlock = null;

function _highlightCurrentChord(paso) {
    const container = document.getElementById('chordRowContainer');
    if (!container) return;

    const blocks = container.querySelectorAll('div[data-start]');
    let found = null;
    for (const b of blocks) {
        if (paso >= parseInt(b.dataset.start) && paso < parseInt(b.dataset.end)) {
            found = b;
            break;
        }
    }
    if (found === _lastHighlightedBlock) return;

    if (_lastHighlightedBlock) {
        _lastHighlightedBlock.style.outline    = '';
        _lastHighlightedBlock.style.boxShadow  = '';
        _lastHighlightedBlock.style.zIndex     = '';
        _lastHighlightedBlock.style.fontWeight = '';
    }
    if (found) {
        found.style.outline    = '2px solid #ffcc00';
        found.style.boxShadow  = '0 0 6px #ffcc0088';
        found.style.zIndex     = '2';
        found.style.fontWeight = 'bold';
    }
    _lastHighlightedBlock = found;
}

// ── G3: callback de beat del ESP32 ───────────────────────────────────────────
// El firmware emite {"state":"beat","step":N} cada stepMs.
// Corrige la deriva visual entre setInterval del browser y millis() del ESP32.
const _BEAT_DRIFT_TOLERANCE = 2;

onBeatCallback = function(stepFromEsp32) {
    if (!reproduciendo) return;

    const adjustedStep = stepFromEsp32 + _playStartOffset;
    const drift        = adjustedStep - pasoActual;

    if (Math.abs(drift) > _BEAT_DRIFT_TOLERANCE) {
        console.log(`[beat] Deriva: pasoActual ${pasoActual} → ${adjustedStep} (drift=${drift})`);
        pasoActual = adjustedStep;
        drawPianoRollWithPlayhead(pasoActual);
        _autoScroll(pasoActual);
    }
};

// ── Autoscroll ────────────────────────────────────────────────────────────────

function _autoScroll(paso) {
    const container = document.getElementById('gridScroll');
    if (!container) return;

    const playheadX    = paso * stepWidth;
    const visibleWidth = container.clientWidth;
    const scrollLeft   = container.scrollLeft;

    const margenIzq = visibleWidth * 0.30;
    const margenDer = visibleWidth * 0.70;
    const relX      = playheadX - scrollLeft;

    if (relX > margenDer) {
        container.scrollLeft = playheadX - margenIzq;
    } else if (relX < margenIzq && scrollLeft > 0) {
        container.scrollLeft = Math.max(0, playheadX - margenIzq);
    }
}
