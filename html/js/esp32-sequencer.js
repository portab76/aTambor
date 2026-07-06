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

// Longitud real del strip en el firmware (Esp32.2.ino define NUM_LEDS 60).
// El JS declara NUM_LEDS = 61 (C1–B5 inclusive); capamos al valor físico del
// firmware para no enviar índices fuera de rango que rechazaría. Se usa el
// literal (no NUM_LEDS) para no depender del orden de init de imports.
const LED_STRIP_LEN = 60;

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
        if (ledIdx < 0 || ledIdx >= LED_STRIP_LEN) continue;
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

    // Notas SIN motor asignado (o muteadas): no mueven ningún servo, pero SÍ
    // encienden su LED durante la reproducción. ledByIdx[ledIdx] = [{step,duration,note}]
    const ledOnly = {};

    for (const [key, cell] of Object.entries(state.gridData.cells)) {
        const [noteStr, stepStr] = key.split(',');
        const step = parseInt(stepStr);

        // Filtrar solo los pasos del rango solicitado
        if (step < startStep || step >= endStep) continue;
        hasCellsInRange = true;

        const midiNote = parseInt(noteStr);
        const offset   = state.transposeOffset || 0;
        const cfg      = motorMap ? motorMap.find(m => m.note === midiNote - offset) : null;

        if (!cfg || cfg.muted) {
            // Sin motor (o muteada) → encender solo el LED de la nota.
            // El LED va por la posición física de la nota MIDI real (con offset
            // aplicado, como se toca), no por la del motor.
            const ledIdx = ledForNote(midiNote);
            if (ledIdx >= 0 && ledIdx < LED_STRIP_LEN) {
                (ledOnly[ledIdx] ??= []).push({
                    step: step - startStep,
                    duration: cell.duration,
                    note: midiNote,
                    velocity: cell.velocity,
                    key                      // "midiNote,absStep" para modo 'grid'/Interpretar
                });
            }
            continue;
        }

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

    if (Object.keys(byMotor).length === 0 &&
        Object.keys(ledOnly).length === 0 && !hasCellsInRange) return '';

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
        const offset = state.transposeOffset || 0;
        for (const m of motorMap) {
            if (m.motor >= 99) continue;
            const ledIdx = ledForNote(m.note);
            if (ledIdx < 0 || ledIdx >= LED_STRIP_LEN) continue;
            // Contexto para el modo 'grid': nota real (con offset) + velocity/key
            // de la primera ocurrencia de este motor en el grid (representativa).
            let ctx = null;
            const grp = byMotor[m.motor];
            if (grp && grp.events.length) {
                const ev = grp.events[0];
                ctx = { note: m.note + offset, key: ev.heatKey, velocity: ev.velocity };
            }
            const { hue, sat } = _ledHueSat(m, ledIdx, noteAvgHeat, ctx);
            cmd += `L ${m.motor} ${ledIdx} ${hue} ${sat};\n`;
        }
    }

    // ── LEDs de notas SIN motor ───────────────────────────────
    // Para cada LED usado: color (K) + pares de eventos on/off (k). Se fusionan
    // los intervalos solapados del mismo LED para no apagarlo mientras otra nota
    // que comparte esa posición sigue sonando.
    for (const [ledIdxStr, occs] of Object.entries(ledOnly)) {
        const ledIdx = parseInt(ledIdxStr);

        // Color del LED según el modo activo, usando la primera ocurrencia
        // (los modos octava/calor/rainbow dependen de la nota/posición; el modo
        // 'grid' además usa velocity/key para replicar el color exacto del grid).
        const o0  = occs[0];
        const ctx = { note: o0.note, key: o0.key, velocity: o0.velocity };
        const { hue, sat } = _ledHueSat({ note: o0.note }, ledIdx, noteAvgHeat, ctx);
        cmd += `K ${ledIdx} ${hue} ${sat};\n`;

        // Fusionar intervalos [startMs, endMs) solapados
        const intervals = occs
            .map(o => ({ on: o.step * stepMs, off: (o.step + o.duration) * stepMs }))
            .sort((a, b) => a.on - b.on);
        const merged = [];
        for (const iv of intervals) {
            const last = merged[merged.length - 1];
            if (last && iv.on <= last.off) {
                last.off = Math.max(last.off, iv.off);
            } else {
                merged.push({ ...iv });
            }
        }
        for (const iv of merged) {
            cmd += `k ${Math.round(iv.on)} ${ledIdx} 1;\n`;
            cmd += `k ${Math.round(iv.off)} ${ledIdx} 0;\n`;
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

// ── Color "como el grid" ─────────────────────────────────────
// Réplica de la lógica de piano-roll.js (_drawNotes): color de octava con
// brillo por velocity, o color de relevancia cuando la vista previa de
// Interpretar está activa. Devuelve [r,g,b] 0-255, el MISMO color que ve el
// usuario en el grid, para poder pintarlo en el LED.
const _GRID_OCT_RGB = {
    1: [255, 102, 102], 2: [255, 153, 68], 3: [221, 221, 68],
    4: [ 68, 221,  68], 5: [ 68, 136, 255], 6: [187, 102, 255],
};
const _GRID_HEAT_STOPS = [
    [15, 30, 120], [10, 130, 140], [60, 200, 50], [255, 140, 0], [255, 30, 0],
];
function _gridHeatRGB(heat) {
    const t   = Math.max(0, Math.min(1, heat));
    const seg = t * (_GRID_HEAT_STOPS.length - 1);
    const lo  = Math.floor(seg);
    const hi  = Math.min(lo + 1, _GRID_HEAT_STOPS.length - 1);
    const f   = seg - lo;
    return [
        Math.round(_GRID_HEAT_STOPS[lo][0] + (_GRID_HEAT_STOPS[hi][0] - _GRID_HEAT_STOPS[lo][0]) * f),
        Math.round(_GRID_HEAT_STOPS[lo][1] + (_GRID_HEAT_STOPS[hi][1] - _GRID_HEAT_STOPS[lo][1]) * f),
        Math.round(_GRID_HEAT_STOPS[lo][2] + (_GRID_HEAT_STOPS[hi][2] - _GRID_HEAT_STOPS[lo][2]) * f),
    ];
}
function noteGridRGB(note, key, velocity) {
    const oct          = Math.max(1, Math.min(6, Math.floor(note / 12) - 1));
    const [or, og, ob] = _GRID_OCT_RGB[oct];
    // Interpretar activo → color por relevancia fusionada (igual que la vista previa)
    if (state.interpretPreviewActive && state.interpretPreviewData) {
        const rel = state.interpretPreviewData.get(key) ?? 0.5;
        return _gridHeatRGB(rel);
    }
    // Modo normal → color de octava con brillo por velocity (0.20 → 1.0)
    const bright = 0.20 + (velocity / 127) * 0.80;
    return [Math.round(or * bright), Math.round(og * bright), Math.round(ob * bright)];
}

// RGB (0-255) → HSV de FastLED (hue 0-255, sat 0-255). value se ignora (el
// firmware fija V=220); si RGB es puro negro devolvemos sat 0 para no perder
// la nota (un LED negro no se vería).
function _rgbToHsvFastLED(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === r)      h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else                h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : d / max;
    return { hue: Math.round(h / 360 * 255) & 0xFF, sat: Math.round(s * 255) };
}

// ── _ledHueSat — color FastLED (hue 0-255, sat 0-255) por modo ──
// Hue sigue la escala HSV de FastLED: 0=rojo, 85=verde, 128=cian, 160=azul, 213=magenta
// ctx (opcional): { note, key, velocity } — necesario para el modo 'grid'.
function _ledHueSat(motorEntry, ledIdx, noteAvgHeat, ctx) {
    const mode = state.ledColorMode || 'grid';
    switch (mode) {
        case 'grid': {
            // Color exacto del grid (incluye Interpretar), convertido a HSV.
            const note = ctx?.note ?? motorEntry.note;
            const [r, g, b] = noteGridRGB(note, ctx?.key, ctx?.velocity ?? 100);
            return _rgbToHsvFastLED(r, g, b);
        }
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
