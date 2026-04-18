// ============================================================
// playback.js — Motor de reproducción paso a paso
// Usa MIDI.noteOn / MIDI.noteOff con AudioContext para timing preciso.
// Depende de: state.js, piano-roll.js
// ============================================================

let loopEnabled      = false;
let _playInterval    = null;   // handle del setInterval
let _playStartOffset = 0;      // paso desde el que arrancó play() — para loop y sync ESP32

/** ms por semicorchea, leyendo el BPM del input de la toolbar (o del MIDI si no existe). */
const MS_PER_STEP = () => {
    const el  = document.getElementById('bpmInput');
    const bpm = el ? (parseFloat(el.value) || 120) : (tempoMap[0]?.bpm || 120);
    return (60000 / bpm) / 4;
};

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

    const stepMs = MS_PER_STEP();

    // Si A-B está activo y hay rango, fijar pasoActual ANTES de construir la secuencia
    const abActive = (typeof loopAB !== 'undefined') && loopAB && loopA >= 0 && loopB > loopA;
    if (abActive) pasoActual = loopA;

    // ── G1: enviar secuencia al ESP32 ─────────────────────────
    console.log(`[play] wsConnected=${wsConnected}, ws.readyState=${ws ? ws.readyState : 'null'}`);
    if (typeof wsConnected !== 'undefined' && wsConnected) {
        const seq = abActive
            ? buildRangeSequence(MOTOR_MAP, loopA, loopB)     // solo el rango A-B
            : pasoActual > 0
                ? buildRemainingSequence(MOTOR_MAP, pasoActual)
                : buildFullSequence(MOTOR_MAP);
        if (!seq) {
            console.warn('[play] No hay notas mapeadas a motores — se omite comando PLAY al ESP32');
        } else {
            // Extraer p; del final para enviarlo como comando FINAL después de todos los APPENDs
            let seqBody = seq;
            let hasPlayCmd = false;
            if (seqBody.endsWith('p;\n')) {
                seqBody = seqBody.slice(0, -3); // remover 'p;\n'
                hasPlayCmd = true;
            }

            const blocks = validateSequenceSize(seqBody);

            const fullCmd = `PLAY|midiGrid|${Math.round(stepMs)}\n` + blocks[0];
            console.log(`[play] Enviando PLAY: seq=${seq.length}B → ${blocks.length} bloque(s) de ≤8KB (sin p; aún)`);
            sendCommand(fullCmd);

            // Bloques adicionales: APPEND con 200ms de separación entre cada uno
            let lastDelay = 0;
            for (let i = 1; i < blocks.length; i++) {
                lastDelay = i * 200;
                const block = blocks[i];
                setTimeout(() => {
                    console.log(`[play] APPEND bloque ${i + 1}/${blocks.length} (${block.length}B)`);
                    sendCommand('APPEND\n' + block);
                }, lastDelay);
            }

            // Comando PLAY final (p;) después de que todos los APPENDs hayan sido encolados
            if (hasPlayCmd) {
                const playDelay = (blocks.length > 1 ? lastDelay + 300 : 50);  // esperar a que lleguen todos
                setTimeout(() => {
                    console.log('[play] Enviando p; para ejecutar la secuencia completa');
                    sendCommand('p;');
                }, playDelay);
            }
        }
    }

    // ── G1: arrancar audio con offset de 20ms ─────────────────
    _playStartOffset = pasoActual;   // pasoActual ya apunta a loopA si A-B activo
    setTimeout(_startPlaybackLoop, 20);
}

/** Arranca el setInterval de audio (separado para poder llamarlo desde play y resume) */
function _startPlaybackLoop() {
    reproduciendo = true;
    playBtn.disabled  = true;
    pauseBtn.disabled = false;
    stopBtn.disabled  = false;
    statusSpan.innerText = "Reproduciendo...";
    _playInterval = setInterval(_tick, MS_PER_STEP());
}

/**
 * Pausa la reproducción conservando la posición.
 */
function pause() {
    if (!reproduciendo) return;
    reproduciendo = false;
    clearInterval(_playInterval);
    _playInterval = null;
    playBtn.disabled  = false;
    pauseBtn.disabled = true;
    statusSpan.innerText = "Pausado.";
}

/**
 * Detiene la reproducción y vuelve al inicio.
 * G2: limpia el interval de audio y envía STOP al ESP32.
 */
function stop() {
    reproduciendo = false;
    clearInterval(_playInterval);
    _playInterval = null;
    pasoActual       = 0;
    _playStartOffset = 0;
    playBtn.disabled  = false;
    pauseBtn.disabled = true;
    drawPianoRollWithPlayhead(-1);
    updateRulerPlayhead(-1);
    _clearChordHighlight();
    statusSpan.innerText = "Detenido.";

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

    if (wasPlaying) play();
}

/**
 * Activa/desactiva el loop.
 */
function toggleLoop() {
    loopEnabled = !loopEnabled;
    loopBtn.style.background = loopEnabled ? "#2a5a2a" : "";
    statusSpan.innerText = loopEnabled ? "Loop ON." : "Loop OFF.";
}

// --- Tick interno ---
let _tickCount = 0;  // para limitar logs

function _tick() {
    // ── A-B loop tiene prioridad sobre loop normal ────────────
    const abActive = (typeof loopAB !== 'undefined') && loopAB && loopA >= 0 && loopB > loopA;
    if (abActive && pasoActual >= loopB) {
        pasoActual = loopA;
        // Reenviar el rango A-B al ESP32 como nueva secuencia PLAY (no APPEND, porque ya terminó)
        if (typeof wsConnected !== 'undefined' && wsConnected) {
            const seq = buildRangeSequence(MOTOR_MAP, loopA, loopB);
            if (seq) {
                let body = seq;
                if (body.endsWith('p;\n')) body = body.slice(0, -3);
                const blocks = validateSequenceSize(body);
                const stepMs = Math.round(MS_PER_STEP());
                sendCommand(`PLAY|midiGrid|${stepMs}\n` + blocks[0]);
                let lastDelay = 0;
                for (let i = 1; i < blocks.length; i++) {
                    lastDelay = i * 200;
                    const b = blocks[i];
                    setTimeout(() => sendCommand('APPEND\n' + b), lastDelay);
                }
                setTimeout(() => sendCommand('p;'), blocks.length > 1 ? lastDelay + 300 : 50);
            }
        }
    } else if (pasoActual >= totalSteps) {
        if (abActive) {
            pasoActual = loopA;
        } else if (loopEnabled) {
            pasoActual = _playStartOffset;
        } else {
            stop();
            return;
        }
    }

    // Reproducir notas que comienzan exactamente en este paso
    let notasEnEstePaso = 0;
    for (const [key, cell] of Object.entries(gridData.cells)) {
        const [noteStr, stepStr] = key.split(',');
        if (parseInt(stepStr) !== pasoActual) continue;

        const note       = parseInt(noteStr);
        const velocity   = cell.velocity;
        const delayOff   = (cell.duration * MS_PER_STEP()) / 1000; // segundos

        notasEnEstePaso++;
        if (typeof MIDI !== 'undefined' && typeof MIDI.noteOn === 'function') {
            // MIDI.js carga el soundfont en canal 0; usamos siempre 0 para audio
            MIDI.noteOn( 0, note, velocity, 0);
            MIDI.noteOff(0, note, delayOff);
        }
    }

    // Log de los primeros ticks para diagnóstico
    if (_tickCount < 5) {
        console.log(`[tick ${pasoActual}] notas: ${notasEnEstePaso} | MIDI disponible: ${typeof MIDI !== 'undefined'}`);
        _tickCount++;
    }

    if (activeHighlight && document.getElementById('chordInfoPopup')) {
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
    pasoActual++;
}

// --- Resaltado del acorde activo en el chord row ---
let _lastHighlightedBlock = null;

function _highlightCurrentChord(paso) {
    const container = document.getElementById('chordRowContainer');
    if (!container) return;

    // Buscar el bloque que contiene el paso actual
    const blocks = container.querySelectorAll('div[data-start]');
    let found = null;
    for (const b of blocks) {
        if (paso >= parseInt(b.dataset.start) && paso < parseInt(b.dataset.end)) {
            found = b;
            break;
        }
    }
    if (found === _lastHighlightedBlock) return; // sin cambio

    // Quitar resaltado anterior
    if (_lastHighlightedBlock) {
        _lastHighlightedBlock.style.outline    = '';
        _lastHighlightedBlock.style.boxShadow  = '';
        _lastHighlightedBlock.style.zIndex     = '';
        _lastHighlightedBlock.style.fontWeight = '';
    }
    // Aplicar resaltado nuevo
    if (found) {
        found.style.outline    = '2px solid #ffcc00';
        found.style.boxShadow  = '0 0 6px #ffcc0088';
        found.style.zIndex     = '2';
        found.style.fontWeight = 'bold';
    }
    _lastHighlightedBlock = found;
}

// ── G3: callback de beat del ESP32 ───────────────────────────
// El firmware emite {"state":"beat","step":N} cada stepMs.
// Usamos esto para corregir la deriva entre el setInterval del
// browser (impreciso) y el millis() del ESP32 (fuente de verdad).
//
// Tolerancia: si la diferencia es > 2 pasos se corrige pasoActual;
// si es ≤ 2 pasos se deja que el audio fluya suavemente para evitar
// saltos audibles.
const _BEAT_DRIFT_TOLERANCE = 2;

onBeatCallback = function(stepFromEsp32) {
    if (!reproduciendo) return;

    const abActive = (typeof loopAB !== 'undefined') && loopAB && loopA >= 0 && loopB > loopA;

    let adjustedStep;
    if (abActive) {
        // En modo A-B los pasos del ESP32 son relativos al rango (0..rangeLen-1).
        // Si el ESP32 ya terminó el rango y manda step=0 del siguiente ciclo,
        // NO aplicamos la corrección: dejamos que _tick() haga el wrap y reenvíe PLAY.
        const rangeLen = loopB - loopA;
        adjustedStep = (stepFromEsp32 % rangeLen) + loopA;
        // Ignorar correcciones hacia atrás que cruzan loopB (son el inicio del ciclo siguiente)
        if (adjustedStep < pasoActual - _BEAT_DRIFT_TOLERANCE) return;
    } else {
        adjustedStep = stepFromEsp32 + _playStartOffset;
    }

    const drift = adjustedStep - pasoActual;

    if (Math.abs(drift) > _BEAT_DRIFT_TOLERANCE) {
        console.log(`[beat] Corrección de deriva: pasoActual ${pasoActual} → ${adjustedStep} (drift=${drift})`);
        pasoActual = adjustedStep;
        drawPianoRollWithPlayhead(pasoActual);
        _autoScroll(pasoActual);
    }
};

// --- Autoscroll: mantiene el playhead centrado horizontalmente ---
function _autoScroll(paso) {
    const container = document.getElementById('gridScroll');
    if (!container) return;

    const playheadX    = paso * stepWidth;
    const visibleWidth = container.clientWidth;
    const scrollLeft   = container.scrollLeft;

    // Margen: mantener el playhead al 30% del lado izquierdo del área visible
    const margenIzq = visibleWidth * 0.30;
    const margenDer = visibleWidth * 0.70;

    const relX = playheadX - scrollLeft;

    if (relX > margenDer) {
        // Playhead saliendo por la derecha → adelantar vista
        container.scrollLeft = playheadX - margenIzq;
    } else if (relX < margenIzq && scrollLeft > 0) {
        // Playhead saliendo por la izquierda (loop) → resetear vista
        container.scrollLeft = Math.max(0, playheadX - margenIzq);
    }
}
