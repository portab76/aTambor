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

// Parámetros de golpe (ms) — deben coincidir con los del firmware
const HIT_MS     = 80;   // duración del golpe (solenoide extendido)
const RETRACT_MS = 150;  // duración de la retracción (vuelta al neutro)
// Total mínimo de tiempo que consume un golpe: HIT_MS + RETRACT_MS = 230 ms

// ── F1 — buildFullSequence ────────────────────────────────────
/**
 * Recorre gridData.cells completo y genera el string de comandos
 * para el firmware ESP32.
 *
 * @param {Array}  motorMap  — MOTOR_MAP de motor-map.js
 * @returns {string}         — bloque de comandos listo para enviar
 */
function buildFullSequence(motorMap) {
    const seq = _buildSequence(motorMap, 0, totalSteps);
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
function buildRemainingSequence(motorMap, fromStep) {
    return _buildSequence(motorMap, fromStep, totalSteps);
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
function validateSequenceSize(cmd, maxBytes = 8000) {
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
    if (!gridData || !gridData.cells) return '';

    const stepMs   = MS_PER_STEP();   // ms por semicorchea
    const totalMs  = (endStep - startStep) * stepMs;

    // ── Agrupar celdas por motor ──────────────────────────────
    // byMotor[motorIdx] = { cfg, events: [{step, duration, velocity}] }
    const byMotor = {};

    for (const [key, cell] of Object.entries(gridData.cells)) {
        const [noteStr, stepStr] = key.split(',');
        const step = parseInt(stepStr);

        // Filtrar solo los pasos del rango solicitado
        if (step < startStep || step >= endStep) continue;

        const midiNote = parseInt(noteStr);
        const cfg      = motorMap ? motorMap.find(m => m.note === midiNote) : null;
        if (!cfg) continue;  // nota sin motor asignado → ignorar

        if (!byMotor[cfg.motor]) {
            byMotor[cfg.motor] = { cfg, events: [] };
        }
        byMotor[cfg.motor].events.push({
            step:     step - startStep,   // relativo al inicio del bloque
            duration: cell.duration,
            velocity: cell.velocity
        });
    }

    if (Object.keys(byMotor).length === 0) return '';

    // ── Generar instrucciones por motor ───────────────────────
    let cmd = 'e;\n';

    for (const { cfg, events } of Object.values(byMotor)) {
        // Ordenar eventos por paso
        events.sort((a, b) => a.step - b.step);

        cmd += `m ${cfg.motor}; o ${cfg.homePwm};\n`;

        // cursorMs: posición temporal del "cabezal de escritura" para este motor
        let cursorMs = 0;

        for (const ev of events) {
            const startMs = ev.step * stepMs;

            // Silencio previo hasta el inicio de esta nota
            const restMs = startMs - cursorMs;
            if (restMs > 0) {
                cmd += `t ${Math.round(restMs)}; v 0;\n`;
            }

            // Velocidad real del golpe: escalar velocity MIDI (0-127) a rango 1-100
            const velEsp32 = Math.max(1, Math.min(100,
                Math.round((cfg.vel / 100) * (ev.velocity / 127) * 100)
            ));

            // Calcular duración del golpe teniendo en cuenta notas largas
            // (duration > 1 paso → el servo permanece más tiempo extendido)
            const holdMs   = Math.max(0, (ev.duration - 1) * stepMs);
            const actualHit = Math.min(HIT_MS, stepMs - 10);

            cmd += `t ${actualHit}; v ${velEsp32};\n`;

            if (holdMs > 0) {
                cmd += `t ${Math.round(holdMs)}; v ${velEsp32};\n`;
            }

            cmd += `t ${RETRACT_MS}; v 0;\n`;

            cursorMs = startMs + actualHit + holdMs + RETRACT_MS;
        }

        // Silencio final hasta completar el ciclo total
        const remaining = totalMs - cursorMs;
        if (remaining > 0) {
            cmd += `t ${Math.round(remaining)}; v 0;\n`;
        }
    }

    cmd += 'p;\n';
    return cmd;
}
