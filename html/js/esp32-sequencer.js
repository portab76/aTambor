// ============================================================
// esp32-sequencer.js — Generador de comandos ESP32 desde gridData
// Depende de: state.js, motor-map.js
//
// API pública:
//   buildFullSequence(motorMap)               → string de comandos completo
//   buildRemainingSequence(motorMap, fromStep) → string desde un paso en adelante
//   validateSequenceSize(cmd)                 → array de bloques ≤ 60 KB
//
// El string resultante se envía directamente al ESP32:
//   ws.send("PLAY|cancion|stepMs\n" + buildFullSequence(MOTOR_MAP))
// ============================================================

import { state } from './state.js';
import { MOTOR_MAP, NUM_LEDS, ledForNote, _mmVelRange } from './motor-map.js';
import { MS_PER_STEP } from './playback.js';

// Parámetros de golpe (ms) — deben coincidir con los del firmware
export const HIT_MS     = 80;   // duración del golpe (solenoide extendido)
export const RETRACT_MS = 150;  // duración de la retracción (vuelta al neutro)
// Total mínimo de tiempo que consume un golpe: HIT_MS + RETRACT_MS = 230 ms

// ── F1 — buildFullSequence ────────────────────────────────────
/**
 * Recorre gridData.cells completo y genera el string de comandos
 * para el firmware ESP32.
 *
 * @param {Array}  motorMap  — MOTOR_MAP de motor-map.js
 * @returns {string}         — bloque de comandos listo para enviar
 */
export function buildFullSequence(motorMap) {
    const seq = _buildSequence(motorMap, 0, state.totalSteps);
    // Nota: el p; está al final de seq (en _buildSequence)
    return seq;
}

// ── F2 — buildRemainingSequence ───────────────────────────────
/**
 * Igual que buildFullSequence pero solo desde fromStep en adelante.
 * Usado para hot-swap de instrumento en caliente via APPEND.
 *
 * @param {Array}  motorMap  — MOTOR_MAP de motor-map.js
 * @param {number} fromStep  — paso desde el que empezar (pasoActual)
 * @returns {string}
 */
export function buildRemainingSequence(motorMap, fromStep) {
    return _buildSequence(motorMap, fromStep, state.totalSteps);
}

// ── F4 — buildRangeSequence ───────────────────────────────────
/**
 * Construye la secuencia solo para el rango [fromStep, toStep).
 * Usado por el loop A-B para enviar al ESP32 únicamente ese fragmento.
 *
 * @param {Array}  motorMap
 * @param {number} fromStep  — paso de inicio (loopA)
 * @param {number} toStep    — paso de fin exclusivo (loopB)
 * @returns {string}
 */
export function buildRangeSequence(motorMap, fromStep, toStep) {
    return _buildSequence(motorMap, fromStep, toStep);
}

// ── F5 — buildLedMappingCmd ───────────────────────────────────
/**
 * Genera solo los comandos L (mapping motor → LED) para el motorMap
 * y el transposeOffset actuales, sin incluir movimientos.
 * Usado por _applyTranspose para actualizar LEDs sin duplicar colas.
 *
 * @param {Array} motorMap
 * @returns {string}  — líneas "L motor ledIdx hue sat;\n"
 */
export function buildLedMappingCmd(motorMap) {
    if (!motorMap) return '';

    let noteAvgHeat = null;
    if (state.ledColorMode === 'calor' && state.heatMapData) {
        noteAvgHeat = new Map();
        for (const [key, val] of state.heatMapData) {
            const note = parseInt(key.split(',')[0]);
            const prev = noteAvgHeat.get(note) || { sum: 0, n: 0 };
            noteAvgHeat.set(note, { sum: prev.sum + val, n: prev.n + 1 });
        }
    }

    let cmd = '';
    for (const m of motorMap) {
        if (m.motor >= 99) continue;
        const ledIdx = ledForNote(m.note);  // posición física del motor, sin offset
        if (ledIdx < 0 || ledIdx >= NUM_LEDS) continue;
        const { hue, sat } = _ledHueSat(m, ledIdx, noteAvgHeat);
        cmd += `L ${m.motor} ${ledIdx} ${hue} ${sat};\n`;
    }
    return cmd;
}

// ── F3 — validateSequenceSize ─────────────────────────────────
/**
 * Comprueba el tamaño del comando generado.
 * Si supera 60 KB lo parte en dos bloques de tamaño similar,
 * respetando siempre los límites de instrucción (corte en '\n').
 *
 * @param {string} cmd  — comando completo
 * @returns {Array<string>}  — array de 1 o 2 bloques
 */
export function validateSequenceSize(cmd, maxBytes = 8000 ) {
    if (cmd.length <= maxBytes) return [cmd];

    const blocks = [];
    let remaining = cmd;

    while (remaining.length > maxBytes) {
        // Cortar en el '\n' más cercano al límite
        let splitAt = remaining.lastIndexOf('\n', maxBytes);
        if (splitAt === -1) splitAt = maxBytes;  // sin salto de línea: cortar duro
        blocks.push(remaining.slice(0, splitAt + 1));
        remaining = remaining.slice(splitAt + 1);
    }
    if (remaining.length > 0) blocks.push(remaining);

    console.warn(`[esp32-sequencer] Secuencia partida en ${blocks.length} bloques: ` +
                 blocks.map(b => b.length + 'B').join(' + '));
    return blocks;
}

// ── Core interno ──────────────────────────────────────────────
/**
 * Genera el bloque de comandos para los pasos [startStep, endStep).
 * Los timestamps se calculan siempre desde t=0 (inicio de la secuencia),
 * independientemente de startStep — el firmware ejecutará desde
 * el primer 'p;' que reciba.
 *
 * Para buildRemainingSequence los tiempos también parten de 0 porque
 * el comando APPEND añade movimientos a continuación de los ya encolados,
 * así que el firmware los interpola correctamente.
 *
 * @param {Array}  motorMap
 * @param {number} startStep  — paso de inicio (inclusivo)
 * @param {number} endStep    — paso de fin (exclusivo)
 * @returns {string}
 */
function _buildSequence(motorMap, startStep, endStep) {
    if (!state.gridData || !state.gridData.cells) return '';

    const stepMs   = MS_PER_STEP();   // ms por semicorchea
    const totalMs  = (endStep - startStep) * stepMs;

    // ── Agrupar celdas por motor ──────────────────────────────
    // byMotor[motorIdx] = { cfg, events: [{step, duration, velocity}] }
    const byMotor = {};
    let   hasCellsInRange = false;

    for (const [key, cell] of Object.entries(state.gridData.cells)) {
        const [noteStr, stepStr] = key.split(',');
        const step = parseInt(stepStr);

        // Filtrar solo los pasos del rango solicitado
        if (step < startStep || step >= endStep) continue;
        hasCellsInRange = true;

        const midiNote = parseInt(noteStr);
        const offset   = state.transposeOffset || 0;
        const cfg      = motorMap ? motorMap.find(m => m.note === midiNote - offset) : null;
        if (!cfg || cfg.muted) continue;

        if (!byMotor[cfg.motor]) {
            byMotor[cfg.motor] = { cfg, events: [] };
        }
        byMotor[cfg.motor].events.push({
            step:     step - startStep,   // relativo al inicio del bloque
            duration: cell.duration,
            velocity: cell.velocity,
            heatKey:  key                 // "midiNote,absStep" para lookup de heat
        });
    }

    if (Object.keys(byMotor).length === 0 && !hasCellsInRange) return '';

    // ── Generar instrucciones por motor ───────────────────────
    let cmd = 'e;\n';

    // Pre-calcular heat medio por nota (para modo 'calor') — usado en L y l commands
    let noteAvgHeat = null;
    if (state.ledColorMode === 'calor' && state.heatMapData) {
        noteAvgHeat = new Map();
        for (const [key, val] of state.heatMapData) {
            const note = parseInt(key.split(',')[0]);
            const prev = noteAvgHeat.get(note) || { sum: 0, n: 0 };
            noteAvgHeat.set(note, { sum: prev.sum + val, n: prev.n + 1 });
        }
    }

    // Enviar mapping motor → LED + color al firmware antes de la secuencia.
    // LED index = posición física del motor en el strip (m.note, sin offset).
    // El offset solo afecta qué motor toca qué nota MIDI, no dónde está la tecla física.
    if (motorMap) {
        for (const m of motorMap) {
            if (m.motor >= 99) continue;
            const ledIdx = ledForNote(m.note);
            if (ledIdx < 0 || ledIdx >= NUM_LEDS) continue;
            const { hue, sat } = _ledHueSat(m, ledIdx, null);
            cmd += `L ${m.motor} ${ledIdx} ${hue} ${sat};\n`;
        }
    }

    for (const { cfg, events } of Object.values(byMotor)) {
        // Ordenar eventos por paso
        events.sort((a, b) => a.step - b.step);

        // ── Fusión de notas físicamente imposibles ────────────
        // Si dos golpes del mismo motor están separados menos de HIT_MS+RETRACT_MS
        // el solenoides no puede retraerse a tiempo — se fusionan en una nota más larga.
        const minGapMs = HIT_MS + RETRACT_MS;
        const merged = [];
        let mi = 0;
        while (mi < events.length) {
            const ev = { ...events[mi] };
            while (mi + 1 < events.length) {
                const next    = events[mi + 1];
                const gapMs   = (next.step - ev.step) * stepMs;
                if (gapMs < minGapMs) {
                    // Extender duración para cubrir el final de la nota siguiente
                    const evEnd   = ev.step   + ev.duration;
                    const nextEnd = next.step  + next.duration;
                    ev.duration   = Math.max(evEnd, nextEnd) - ev.step;
                    ev.velocity   = Math.max(ev.velocity, next.velocity);
                    mi++;
                } else { break; }
            }
            merged.push(ev);
            mi++;
        }

        cmd += `m ${cfg.motor}; o ${cfg.homePwm};\n`;

        // cursorMs: posición temporal del "cabezal de escritura" para este motor
        let cursorMs = 0;

        for (const ev of merged) {
            const startMs = ev.step * stepMs;

            // Silencio previo hasta el inicio de esta nota
            const restMs = startMs - cursorMs;
            if (restMs > 0) {
                cmd += `t ${Math.round(restMs)}; v 0;\n`;
            }

            // Velocidad real del golpe: la velocity del grid (escala 0-127) ya
            // viene comprimida al rango del motor desde el import, así que aquí
            // solo se convierte a escala ESP32 (0-100). NO se impone un suelo:
            // la velocity del grid manda — a 0, no hay golpe (silencio).
            // El techo vMax se respeta como protección física del solenoide.
            const { max: vMax } = _mmVelRange(cfg);
            const velEsp32 = Math.min(vMax, Math.round(ev.velocity / 127 * 100));

            const hitMs  = Math.min(HIT_MS, stepMs - 10);
            const holdMs = Math.max(0, ev.duration * stepMs - hitMs - RETRACT_MS);

            if (velEsp32 <= 0) {
                // Velocity 0 → la nota no golpea: solo consume su tiempo en silencio.
                const silentMs = hitMs + holdMs + RETRACT_MS;
                cmd += `t ${Math.round(silentMs)}; v 0;\n`;
            } else {
                cmd += `t ${hitMs}; v ${velEsp32};\n`;
                if (holdMs > 0) cmd += `t ${Math.round(holdMs)}; v ${velEsp32};\n`;
                cmd += `t ${RETRACT_MS}; v 0;\n`;
            }
            cursorMs = startMs + hitMs + holdMs + RETRACT_MS;
        }

        // Silencio final hasta completar el ciclo total
        const remaining = totalMs - cursorMs;
        if (remaining > 0) {
            cmd += `t ${Math.round(remaining)}; v 0;\n`;
        }
    }

    // ── Marcadores de sincronía en límites de compás ─────────────
    // El firmware mide el drift I2C acumulado en cada compás y
    // corrige los timestamps de eventos futuros en consecuencia.
    const stepsPerMeasure = (state.currentTimeSig && state.currentTimeSig.stepsPerMeasure)
        ? state.currentTimeSig.stepsPerMeasure : 16;
    const firstBoundary = Math.ceil((startStep + 1) / stepsPerMeasure) * stepsPerMeasure;
    for (let s = firstBoundary; s < endStep; s += stepsPerMeasure) {
        cmd += `c ${Math.round((s - startStep) * stepMs)};\n`;
    }

    cmd += 'p;\n';
    return cmd;
}

// ── _ledHueSat — color FastLED (hue 0-255, sat 0-255) por modo ──
// Hue sigue la escala HSV de FastLED: 0=rojo, 85=verde, 128=cian, 160=azul, 213=magenta
function _ledHueSat(motorEntry, ledIdx, noteAvgHeat) {
    const mode = state.ledColorMode || 'rainbow';
    switch (mode) {
        case 'octava': {
            // Colores por octava: rojo→naranja→amarillo→verde→cian→azul→violeta
            const oct  = Math.floor(motorEntry.note / 12) - 1;
            const hues = [0, 0, 20, 43, 85, 140, 170, 213];
            return { hue: hues[Math.max(0, Math.min(7, oct))], sat: 230 };
        }
        case 'calor': {
            // Heat alto (nota dominante) → rojo (hue 0), heat bajo → azul (hue 160)
            const entry = noteAvgHeat && noteAvgHeat.get(motorEntry.note);
            const heat  = entry ? entry.sum / entry.n : 0.5;
            return { hue: Math.round((1 - heat) * 160), sat: 240 };
        }
        case 'blanco':
            return { hue: 0, sat: 0 };
        case 'rainbow':
        default:
            return { hue: Math.round(ledIdx * 256 / NUM_LEDS), sat: 230 };
    }
}
