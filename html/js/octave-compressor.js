// ============================================================
// octave-compressor.js — Remapeo de notas a las notas físicas del motorMap
// Concentra la pieza en las teclas disponibles del robot, eligiendo para cada
// pitch class el motor más cercano a la octava donde se concentra la energía
// (heat map). Depende de: heat.js, state.js
// ============================================================

import { calcularHeatScores, calcularOctavaDesdeHeat } from './heat.js';
import { state } from './state.js';

/**
 * Remapea rawEvents a las notas disponibles en motorMap.
 * Reutiliza state.heatMapData si ya existe (botón Calor activado),
 * o lo calcula en el momento si no existe.
 *
 * @param {Array}  rawEvents  — state.rawEvents (no se muta)
 * @param {number} channel    — canal MIDI a procesar
 * @param {Array}  motorMap   — MOTOR_MAP de motor-map.js
 * @returns {Array}           — copia de rawEvents con notas remapeadas
 */
export function comprimirAMotores(rawEvents, channel, motorMap) {
    // 1. Notas de motor disponibles, ordenadas
    const motorNotes = motorMap.map(m => m.note).sort((a, b) => a - b);
    if (motorNotes.length === 0) return rawEvents;

    // 2. Usar heatMap existente o calcular uno desde rawEvents del canal
    let heatMap = state.heatMapData;
    if (!heatMap && state.gridData) {
        heatMap = calcularHeatScores(state.gridData.cells, state.noteRows);
    }
    const octavaObjetivo = calcularOctavaDesdeHeat(heatMap);

    // 3. Para cada pitch class (0-11), ¿cuál motor lo tiene en la octava objetivo?
    //    Precomputar: pitchClass → nota de motor más cercana
    const pcToMotor = new Map();
    for (let pc = 0; pc < 12; pc++) {
        // Buscar motor con este pitch class
        const candidatos = motorNotes.filter(n => n % 12 === pc);
        if (candidatos.length === 0) {
            // No hay motor para este PC → buscar el más cercano en MIDI
            const ideal = octavaObjetivo * 12 + pc;
            const nearest = motorNotes.reduce((best, n) =>
                Math.abs(n - ideal) < Math.abs(best - ideal) ? n : best
            , motorNotes[0]);
            pcToMotor.set(pc, nearest);
        } else if (candidatos.length === 1) {
            pcToMotor.set(pc, candidatos[0]);
        } else {
            // Varios motores con el mismo PC → elegir el más cercano a octavaObjetivo
            const ideal = octavaObjetivo * 12 + pc;
            const nearest = candidatos.reduce((best, n) =>
                Math.abs(n - ideal) < Math.abs(best - ideal) ? n : best
            , candidatos[0]);
            pcToMotor.set(pc, nearest);
        }
    }

    // 4. Reasignar notas en los eventos del canal seleccionado
    return rawEvents.map(ev => {
        if (ev.channel !== channel) return ev;
        if (ev.type !== 'noteOn' && ev.type !== 'noteOff') return ev;
        const nuevaNota = pcToMotor.get(ev.note % 12) ?? ev.note;
        return { ...ev, note: nuevaNota };
    });
}

// ── Test rápido (activo con ?testCompresor en la URL) ─────────
if (typeof window !== 'undefined' && window.location.search.includes('testCompresor')) {
    console.group('[CompresorTest] Iniciando test del compresor...');

    // Simular state mínimo (sin gridData ni heatMapData para forzar octava=2 por defecto)
    const _stateOrig = window.state;
    window.state = { heatMapData: null, gridData: null };

    const testEvents = [
        { tick:  0, type: 'noteOn',  channel: 0, note: 60, velocity: 80 },  // C4
        { tick:  0, type: 'noteOn',  channel: 0, note: 64, velocity: 70 },  // E4
        { tick:  0, type: 'noteOn',  channel: 0, note: 76, velocity: 90 },  // E5
        { tick: 96, type: 'noteOff', channel: 0, note: 60, velocity:  0 },
        { tick: 96, type: 'noteOff', channel: 0, note: 64, velocity:  0 },
        { tick: 96, type: 'noteOff', channel: 0, note: 76, velocity:  0 },
        { tick: 96, type: 'noteOn',  channel: 1, note: 48, velocity: 60 },  // C3 canal 1
    ];

    // Motor map idéntico al del robot (16 notas, octava 2 + bordes A1,B1,C3,D3)
    const testMotorMap = [
        { note: 33 }, { note: 35 },  // A1, B1
        { note: 36 }, { note: 37 }, { note: 38 }, { note: 39 },
        { note: 40 }, { note: 41 }, { note: 42 }, { note: 43 },
        { note: 44 }, { note: 45 }, { note: 46 }, { note: 47 },
        { note: 48 }, { note: 50 },  // C3, D3
    ];

    // Canal 0 debe comprimirse; canal 1 no debe tocarse
    const resultado = comprimirAMotores(testEvents, 0, testMotorMap);

    const notasEntrada  = testEvents.filter(e => e.type === 'noteOn').map(e => `${e.note}(ch${e.channel})`);
    const notasSalida   = resultado.filter(e => e.type === 'noteOn').map(e => `${e.note}(ch${e.channel})`);
    const notasMotor    = testMotorMap.map(m => m.note);

    console.log('Entrada  :', notasEntrada.join(', '));
    console.log('Salida   :', notasSalida.join(', '));
    console.log('Motores  :', notasMotor.join(', '));

    // Verificaciones
    const ch0Salida = resultado.filter(e => e.type === 'noteOn' && e.channel === 0).map(e => e.note);
    const ch1Salida = resultado.filter(e => e.type === 'noteOn' && e.channel === 1).map(e => e.note);

    const todoEnMotores = ch0Salida.every(n => notasMotor.includes(n));
    const ch1Intacto    = ch1Salida[0] === 48;  // canal 1 no debe cambiar

    console.log(todoEnMotores ? '✅ Todas las notas del canal 0 están en el Motor Map'
                              : '❌ ERROR: hay notas fuera del Motor Map');
    console.log(ch1Intacto    ? '✅ El canal 1 (no seleccionado) no fue modificado'
                              : '❌ ERROR: el canal 1 fue modificado por error');

    // Restaurar state real
    if (_stateOrig !== undefined) window.state = _stateOrig;
    console.groupEnd();
}
