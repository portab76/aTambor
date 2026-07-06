// ============================================================
// playback.js — Motor de reproducción paso a paso
// Usa MIDI.noteOn / MIDI.noteOff con AudioContext para timing preciso.
// Depende de: state.js, piano-roll.js
// ============================================================

import { state } from './state.js';
import { sendStop, sendCommand } from './ws-connector.js';
import { MOTOR_MAP, motorForNote } from './motor-map.js';
import { buildFullSequence, buildRemainingSequence, buildRangeSequence, validateSequenceSize } from './esp32-sequencer.js';
import { updateRulerPlayhead } from './timeline-ruler.js';
import { _activeSegments, _selectChordAtStep, _updateChordPanelFromPlayback, _startNextBatch, cancelPendingAutoAdvance } from './chord-row.js';

// ── Callbacks de UI ───────────────────────────────────────────────────────────
// playback.js no toca el DOM directamente: dispara estos callbacks y deja que el
// entry point (midiGrid.js) actualice botones, estado y playhead. Mantiene el
// motor de reproducción desacoplado de la interfaz.
export const playbackCallbacks = {
    onStart:        null,   // () => void          — la reproducción ha arrancado
    onStop:         null,   // () => void          — la reproducción se ha detenido (reset a 0)
    onPause:        null,   // () => void          — la reproducción se ha pausado
    onStatusChange: null,   // (msg: string) => void — mensaje de estado para el usuario
    onStepChange:   null,   // (step: number) => void — el playhead está en `step` (-1 = oculto)
};

// Helpers internos para invocar los callbacks de forma segura.
function _emitStart()        { playbackCallbacks.onStart?.(); }
function _emitStop()         { playbackCallbacks.onStop?.(); }
function _emitPause()        { playbackCallbacks.onPause?.(); }
function _emitStatus(msg)    { playbackCallbacks.onStatusChange?.(msg); }
function _emitStep(step)     { playbackCallbacks.onStepChange?.(step); }

let _playInterval    = null;   // handle del setInterval de UI (playhead, chords)
let _playStartOffset = 0;      // paso desde el que arrancó play() — para loop y sync ESP32
let _pendingTimers   = [];     // handles de setTimeout activos — se cancelan en stop()
let _waitingEsp32Ack = false;  // true entre enviar la secuencia y recibir 'playing' del ESP32
let _esp32AckTimer   = null;   // timeout de seguridad de la espera del ACK

// ── AudioContext scheduler (timing sample-accurate) ───────────────────────────
// El audio se agenda con lookahead de 100ms usando AudioContext.currentTime,
// eliminando el jitter del setInterval (~5-30ms a BPM alto).
// El setInterval solo mueve el playhead visual (tolerancia ±30ms es invisible).
let _audioCtx          = null;   // AudioContext compartido con MIDI.js si existe
let _scheduleAhead     = 0.100;  // segundos de lookahead (100ms)
let _schedulerTimer    = null;   // setInterval del scheduler de audio (cada 25ms)
let _nextNoteTime      = 0;      // AudioContext.currentTime del siguiente paso a agendar
let _scheduleStep      = 0;      // paso que se agendará en la próxima llamada
let _scheduleLoopStart = 0;      // paso de inicio del loop activo (para wrap A-B)

let _esp32LastLoadedChordIndex = -1;  // índice del último acorde enviado al ESP32
let _esp32LastLoadedStep       = 0;   // paso hasta el que está cargado el ESP32
let _appendSentAt              = null; // performance.now() del último APPEND enviado
let _appendSentStep            = 0;   // paso de cierre de ese APPEND (para RTT)

/** BPM efectivo en el paso dado, consultando tempoPoints (con fallback al input). */
export function _bpmAtStep(step) {
    if (state.tempoPoints && state.tempoPoints.length) {
        let bpm = state.tempoPoints[0].bpm;
        for (const tp of state.tempoPoints) {
            if (tp.step <= step) bpm = tp.bpm;
            else break;
        }
        return bpm;
    }
    const el = document.getElementById('bpmInput');
    return el ? (parseFloat(el.value) || 120) : 120;
}

/** ms por semicorchea en el paso dado (por defecto pasoActual). */
export const MS_PER_STEP = (step) => {
    const s   = step !== undefined ? step : (state.pasoActual || 0);
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
    if (!state.wsConnected) return;
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

    const blocks   = validateSequenceSize(seqBody);
    const adv      = Math.round(state.ledAdvanceMs || 0);
    // Hue FastLED del LED de anticipación: 0 = rojo. Se pasa como 5º parámetro del header.
    const advHue   = 0;
    const header   = `PLAY|midiGrid|${Math.round(stepMs)}|${adv}|${advHue}`;
    console.log(`[play] Enviando PLAY: ${seq.length}B → ${blocks.length} bloque(s) ≤8KB`);

    if (blocks.length === 1) {
        if (state._serialActive) {
            // Serial: stream byte a byte — p; inline llega al firmware en orden garantizado
            const body    = hasPlayCmd ? blocks[0] + 'p;\n' : blocks[0];
            sendCommand(`${header}\n` + body);
        } else {
            // WebSocket: cada ws.send() es un frame independiente — p; debe ser mensaje separado
            sendCommand(`${header}\n` + blocks[0]);
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
    const fullCmd = `${header}\n` + blocks[0];
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
export function play() {
    if (!state.gridData || Object.keys(state.gridData.cells).length === 0) {
        _emitStatus("No hay notas en el grid.");
        return;
    }
    if (state.reproduciendo) return;
    if (_waitingEsp32Ack) return;   // ya hay un play esperando el ACK del ESP32

    if (!state.soundfontLoaded) {
        _emitStatus("⚠ SoundFont no cargado aún. Espera unos segundos.");
        return;
    }

    // Si A-B está activo y A está marcado, arrancar desde loopA
    const abActive = state.loopAB && state.loopA >= 0 && state.loopB > state.loopA;
    if (state.loopAB && state.loopA >= 0) state.pasoActual = state.loopA;

    // ── G1: enviar secuencia completa al ESP32 (WiFi o Serial) ─────────────────
    const isConnected = state.wsConnected || state._serialActive;
    console.log(`[play] wsConnected=${state.wsConnected}, _serialActive=${state._serialActive}`);

    if (isConnected) {
        const seq = abActive
            ? buildRangeSequence(MOTOR_MAP, state.loopA, state.loopB)
            : state.pasoActual > 0
                ? buildRemainingSequence(MOTOR_MAP, state.pasoActual)
                : buildFullSequence(MOTOR_MAP);

        console.log(`[seq] ${abActive ? `A-B [${state.loopA},${state.loopB})` : state.pasoActual > 0 ? `desde paso ${state.pasoActual}` : 'full'} · ${seq?.length ?? 0}B`);

        if (!seq) {
            // Sin secuencia para el ESP32 → arrancar el audio sin esperar ACK.
            console.warn('[play] Sin notas mapeadas a motores — se omite PLAY al ESP32');
            _playStartOffset = state.pasoActual;
            _startPlaybackLoop();
        } else {
            // Sincronía audio↔ESP32: enviamos la secuencia y NO arrancamos el
            // audio hasta que el ESP32 confirme con 'playing' (state.onEsp32PlayingCallback).
            // El ESP32 empieza al recibir el p; final (que llega tras varios bloques),
            // así ambos arrancan en el mismo instante desde el paso 0.
            _sendPlayCommand(seq);
            _waitForEsp32Ack();
        }
    } else {
        // Sin conexión: solo audio, arranque inmediato.
        _playStartOffset = state.pasoActual;
        _startPlaybackLoop();
    }
}

// Espera el ACK 'playing' del ESP32 antes de arrancar el audio. Si no llega
// dentro del timeout, se avisa y NO se reproduce (opción estricta elegida).
const _ESP32_ACK_TIMEOUT_MS = 8000;
function _waitForEsp32Ack() {
    _waitingEsp32Ack = true;
    _emitStatus("Cargando en ESP32…");
    _esp32AckTimer = setTimeout(() => {
        if (!_waitingEsp32Ack) return;
        _waitingEsp32Ack = false;
        _esp32AckTimer   = null;
        _pendingTimers.forEach(clearTimeout);
        _pendingTimers = [];
        _emitStatus("⚠ El ESP32 no respondió. No se reproduce (comprueba la conexión).");
        console.warn('[play] Timeout esperando ACK del ESP32 — reproducción cancelada');
    }, _ESP32_ACK_TIMEOUT_MS);
}

// Llamado desde state.onEsp32PlayingCallback cuando el ESP32 confirma 'playing'.
function _onEsp32Playing() {
    if (!_waitingEsp32Ack) return;   // ACK de un play anterior o no esperábamos
    _waitingEsp32Ack = false;
    if (_esp32AckTimer) { clearTimeout(_esp32AckTimer); _esp32AckTimer = null; }
    console.log('[play] ESP32 confirmó playing — arrancando audio sincronizado');
    _playStartOffset = state.pasoActual;
    _startPlaybackLoop();
}

// Cancela una espera de ACK en curso (al parar/pausar antes de que arranque).
function _cancelEsp32AckWait() {
    _waitingEsp32Ack = false;
    if (_esp32AckTimer) { clearTimeout(_esp32AckTimer); _esp32AckTimer = null; }
}

/** Obtiene (o reutiliza) el AudioContext. Intenta reutilizar el de MIDI.js. */
function _getAudioCtx() {
    if (_audioCtx && _audioCtx.state !== 'closed') return _audioCtx;
    // MIDI.js expone su contexto en MIDI.Player.ctx o MIDI.audioContext
    const midiCtx = MIDI.Player?.ctx || MIDI.audioContext || null;
    _audioCtx = midiCtx || new (window.AudioContext || window.webkitAudioContext)();
    return _audioCtx;
}

/**
 * Agenda notas reales vía MIDI.js hasta (currentTime + lookahead).
 * Se llama cada 25ms desde _schedulerTimer.
 * El setInterval de UI (_playInterval) solo actualiza el playhead visual.
 */
function _scheduleNotes() {
    if (!state.reproduciendo) return;
    const ctx    = _getAudioCtx();
    const abActive = state.loopAB && state.loopA >= 0 && state.loopB > state.loopA;
    const loopEnd  = abActive ? state.loopB : state.totalSteps;

    while (_nextNoteTime < ctx.currentTime + _scheduleAhead) {
        if (_scheduleStep >= loopEnd) {
            if (abActive) {
                // Wrap al inicio del loop A-B
                _scheduleStep    = state.loopA;
                _nextNoteTime   += (_scheduleStep - state.loopA) * (MS_PER_STEP(_scheduleStep) / 1000);
            } else {
                break;  // El setInterval de UI detectará el fin y llamará stop()
            }
        }

        const stepMs   = MS_PER_STEP(_scheduleStep);
        const stepSec  = stepMs / 1000;
        const offset   = state.transposeOffset || 0;

        for (const [key, cell] of Object.entries(state.gridData.cells)) {
            const [noteStr, stepStr] = key.split(',');
            if (parseInt(stepStr) !== _scheduleStep) continue;

            const note           = parseInt(noteStr);
            const transposedNote = note + offset;
            const velocity       = cell.velocity;
            const durSec         = (cell.duration * stepMs) / 1000;

            const motorOnly = document.getElementById('motorOnlyCheckbox')?.checked;
            if (motorOnly && !motorForNote(note)) continue;
            if (motorForNote(note)?.muted) continue;

            if (typeof MIDI.noteOn === 'function') {
                // whenInSeconds: tiempo absoluto del AudioContext para esta nota
                const when    = _nextNoteTime - ctx.currentTime;  // offset relativo a ahora
                MIDI.noteOn( 0, transposedNote, velocity, Math.max(0, when));
                MIDI.noteOff(0, transposedNote, Math.max(0, when) + durSec);
            }
        }

        _nextNoteTime += stepSec;
        _scheduleStep++;
    }
}

/** Arranca el scheduler de audio + el setInterval de UI. */
function _startPlaybackLoop() {
    state.reproduciendo = true;
    _emitStart();
    _emitStatus("Reproduciendo...");
    _currentBpm = _bpmAtStep(state.pasoActual);

    // Inicializar scheduler de audio
    const ctx     = _getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    _scheduleStep      = state.pasoActual;
    _scheduleLoopStart = state.pasoActual;
    _nextNoteTime      = ctx.currentTime + 0.050;  // 50ms de arranque

    // Scheduler de audio: cada 25ms — solo agenda notas, no toca el UI
    _schedulerTimer = setInterval(_scheduleNotes, 25);

    // setInterval de UI: actualiza playhead, scroll, chord highlight
    _tick();
    _playInterval = setInterval(_tick, MS_PER_STEP(state.pasoActual));
}

// ── pause() ──────────────────────────────────────────────────────────────────

/**
 * Pausa la reproducción conservando la posición.
 */
export function pause() {
    _cancelEsp32AckWait();
    if (!state.reproduciendo) return;
    state.reproduciendo = false;
    clearInterval(_playInterval);
    _playInterval = null;
    clearInterval(_schedulerTimer);
    _schedulerTimer = null;
    _pendingTimers.forEach(clearTimeout);
    _pendingTimers = [];
    _emitPause();
    _emitStatus("Pausado.");
}

// ── stop() ───────────────────────────────────────────────────────────────────

/**
 * Detiene la reproducción y vuelve al inicio.
 * G2: limpia el interval de audio y envía STOP al ESP32.
 */
export function stop() {
    _cancelEsp32AckWait();
    state.reproduciendo     = false;
    state.autoAdvanceActive = false;
    clearInterval(_playInterval);
    _playInterval = null;
    clearInterval(_schedulerTimer);
    _schedulerTimer = null;
    _scheduleStep   = 0;
    _pendingTimers.forEach(clearTimeout);
    _pendingTimers = [];
    state.pasoActual = 0;
    _playStartOffset = 0;
    _emitStop();          // el entry point resetea botones y dibuja el playhead a -1
    _emitStep(-1);        // ocultar playhead del piano roll
    updateRulerPlayhead(-1);
    _clearChordHighlight();
    _emitStatus("Detenido.");

    // Limpiar estado de streaming
    _esp32LastLoadedChordIndex = -1;
    _esp32LastLoadedStep       = 0;
    _appendSentAt              = null;
    const bufferEl = document.getElementById('streamingBuffer');
    if (bufferEl) { bufferEl.style.display = 'none'; bufferEl.textContent = ''; }

    // Cancelar cualquier auto-avance pendiente (evita lanzar el siguiente lote
    // si stop() fue llamado manualmente durante el window de 400ms)
    cancelPendingAutoAdvance();
    state.onStoppedCallback = null;

    // G2: parar el ESP32
    sendStop();
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
export function seekToStep(step) {
    const target = Math.max(0, Math.min(state.totalSteps - 1, step));
    const wasPlaying = state.reproduciendo;

    if (wasPlaying) {
        state.reproduciendo = false;
        clearInterval(_playInterval);
        _playInterval = null;
    }

    state.pasoActual = target;
    _playStartOffset = target;

    _emitStep(target);
    updateRulerPlayhead(target);
    _clearChordHighlight();

    _selectChordAtStep(target);

    // Resincronizar scheduler al nuevo punto de inicio
    _scheduleStep = target;

    if (wasPlaying) play();
}

// ── _tick() ──────────────────────────────────────────────────────────────────

let _tickCount = 0;

/**
 * Re-arma el interval del playhead con el nuevo MS_PER_STEP sin perder posición.
 * Usado al cambiar el BPM en caliente. El scheduler de audio relee MS_PER_STEP
 * en cada ciclo, así que solo hay que refrescar el interval visual.
 */
export function refreshPlaybackTempo() {
    if (!state.reproduciendo || !_playInterval) return;
    clearInterval(_playInterval);
    _playInterval = setInterval(_tick, MS_PER_STEP(state.pasoActual));
}

function _tick() {
    // ── A-B loop tiene prioridad sobre loop normal ────────────
    const abActive = state.loopAB && state.loopA >= 0 && state.loopB > state.loopA;

    // ── Fin de segmento ───────────────────────────────────────
    if (abActive && state.pasoActual >= state.loopB) {
        if (state.autoAdvanceActive) {
            _startNextBatch();
            return;
        }
        stop();
        return;
    } else if (state.pasoActual >= state.totalSteps) {
        stop();
        return;
    }

    // Las notas de audio las agenda _scheduleNotes() con lookahead preciso.
    // _tick() solo actualiza el UI visual (playhead, scroll, chord highlight).

    // El dibujado del playhead lo decide el entry point (incluido el caso del
    // panel de acordes abierto con highlight) a través de onStepChange.
    _emitStep(state.pasoActual);
    updateRulerPlayhead(state.pasoActual);
    _autoScroll(state.pasoActual);
    _highlightCurrentChord(state.pasoActual);
    _updateChordPanelFromPlayback();
    state.pasoActual++;

    // ── Cambio de tempo: reiniciar interval de UI si el BPM cambió ──
    // El scheduler de audio (_scheduleNotes) consulta MS_PER_STEP(_scheduleStep)
    // en cada llamada, así que se adapta automáticamente sin reiniciarse.
    if (state.tempoPoints && state.tempoPoints.length > 1) {
        const newBpm = _bpmAtStep(state.pasoActual);
        if (newBpm !== _currentBpm) {
            _currentBpm = newBpm;
            const bpmEl = document.getElementById('bpmInput');
            if (bpmEl) bpmEl.value = Math.round(newBpm);
            clearInterval(_playInterval);
            _playInterval = setInterval(_tick, MS_PER_STEP(state.pasoActual));
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

state.onBeatCallback = function(stepFromEsp32) {
    if (!state.reproduciendo) return;

    const adjustedStep = stepFromEsp32 + _playStartOffset;
    const drift        = adjustedStep - state.pasoActual;

    if (Math.abs(drift) > _BEAT_DRIFT_TOLERANCE) {
        console.log(`[beat] Deriva: pasoActual ${state.pasoActual} → ${adjustedStep} (drift=${drift})`);
        state.pasoActual = adjustedStep;
        _emitStep(state.pasoActual);
        _autoScroll(state.pasoActual);
    }
};

// ── Sincronía de arranque: el ESP32 confirma 'playing' tras recibir el p; ─────
// Los conectores (ws-connector.js / serial-connector.js) disparan este callback.
// play() lo usa para arrancar el audio en el mismo instante que el ESP32.
state.onEsp32PlayingCallback = function() {
    _onEsp32Playing();
};

// ── Autoscroll ────────────────────────────────────────────────────────────────

function _autoScroll(paso) {
    const container = document.getElementById('gridScroll');
    if (!container) return;

    const playheadX    = paso * state.stepWidth;
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
