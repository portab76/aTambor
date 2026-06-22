// ============================================================
// octave-compressor.js — Remapeo de notas a las notas físicas del motorMap
// Concentra la pieza en las teclas disponibles del robot, eligiendo para cada
// pitch class el motor más cercano a la octava donde se concentra la energía
// (heat map). Depende de: heat.js, state.js
// ============================================================

import { calcularHeatScores, calcularOctavaDesdeHeat } from './heat.js';
import { state } from './state.js';

/**
 * Construye un cellsMap "note,step" → {duration, velocity} a partir de los
 * rawEvents de un canal, replicando el emparejamiento noteOn/noteOff de
 * buildGridFromChannel(). Se usa para calcular el heatmap PRE-compresión sin
 * depender de state.gridData (que aún no existe cuando se comprime).
 *
 * @param {Array}  rawEvents
 * @param {number} channel
 * @param {number} ticksPerStep
 * @returns {Object} cellsMap simple ({} si no hay notas)
 */
function _cellsMapDesdeRaw(rawEvents, channel, ticksPerStep) {
    const eventos = rawEvents
        .filter(e => e.channel === channel)
        .sort((a, b) => a.tick - b.tick);

    const pendientes = new Map();   // note → {tickOn, velocity}
    const cells = {};
    const _push = (tickOn, tickOff, note, velocity) => {
        const startStep = Math.floor(tickOn / ticksPerStep);
        const endStep   = Math.floor((tickOff - 1) / ticksPerStep);
        const duration  = endStep - startStep + 1;
        if (duration <= 0) return;
        cells[`${note},${startStep}`] = { duration, velocity };
    };

    for (const ev of eventos) {
        if (ev.type === 'noteOn' && ev.velocity > 0) {
            pendientes.set(ev.note, { tickOn: ev.tick, velocity: ev.velocity });
        } else if (ev.type === 'noteOff' || (ev.type === 'noteOn' && ev.velocity === 0)) {
            const on = pendientes.get(ev.note);
            if (on) { _push(on.tickOn, ev.tick, ev.note, on.velocity); pendientes.delete(ev.note); }
        }
    }
    for (const [note, on] of pendientes) _push(on.tickOn, on.tickOn + 1, note, on.velocity);
    return cells;
}

/**
 * Remapea rawEvents a las notas disponibles en motorMap, resolviendo la
 * polifonía de forma CONTEXTUAL (step a step) y guiada por la matriz de
 * atención (heat):
 *
 *   1. Cada pitch class puede tener VARIOS motores físicos (A,B → 2; C,D → 2;
 *      resto → 1). Se ordenan por cercanía a la octava de energía.
 *   2. En cada step, las notas se procesan por atención descendente: la más
 *      importante coge su motor natural; si está ocupado ese step, se intenta
 *      otro motor del MISMO pitch class; si no hay, la nota (la de MENOR
 *      atención) se descarta. Así nunca se pierde la nota importante por azar,
 *      y se aprovechan los motores duplicados.
 *
 * El noteOff hereda el destino (o el descarte) de su noteOn correspondiente.
 *
 * @param {Array}  rawEvents  — state.rawEvents (no se muta)
 * @param {number} channel    — canal MIDI a procesar
 * @param {Array}  motorMap   — MOTOR_MAP de motor-map.js
 * @param {Map}    [heatPre]  — heatmap del grid ORIGINAL ("note,step" → score).
 *                              Si se omite, se calcula internamente.
 * @returns {Array}           — copia de rawEvents con notas remapeadas
 */
export function comprimirAMotores(rawEvents, channel, motorMap, heatPre) {
    const motorNotes = motorMap.map(m => m.note).sort((a, b) => a - b);
    if (motorNotes.length === 0) return rawEvents;

    const ticksPerStep = (state.ppqn || 96) / 4;

    // 1. heatmap pre-compresión: parámetro, o state, o cálculo al vuelo
    let heatMap = heatPre || state.heatMapDataPreCompresion || state.heatMapData;
    if (!heatMap) {
        const cells = _cellsMapDesdeRaw(rawEvents, channel, ticksPerStep);
        heatMap = Object.keys(cells).length ? calcularHeatScores(cells, state.noteRows) : null;
    }
    const octavaObjetivo = calcularOctavaDesdeHeat(heatMap);
    const scoreDe = (note, step) => heatMap?.get(`${note},${step}`) ?? 0.5;

    // 2. pitchClass → LISTA de motores que lo tienen, ORDENADOS por altura MIDI
    //    (grave→agudo). Para pc sin motor propio, fallback al más cercano al ancla.
    const pcToMotores = new Map();
    for (let pc = 0; pc < 12; pc++) {
        const ideal = octavaObjetivo * 12 + pc;
        let candidatos = motorNotes.filter(n => n % 12 === pc);
        if (candidatos.length === 0) {
            const nearest = motorNotes.reduce((best, n) =>
                Math.abs(n - ideal) < Math.abs(best - ideal) ? n : best, motorNotes[0]);
            candidatos = [nearest];
        }
        candidatos = [...candidatos].sort((a, b) => a - b);  // grave → agudo
        pcToMotores.set(pc, candidatos);
    }

    // Elige el motor PREFERIDO de una nota según su altura original, para
    // preservar el contorno grave/agudo: si el pc tiene 2 motores (p.ej. C2/C3),
    // la frontera es el punto medio entre ellos. Devuelve la lista de candidatos
    // reordenada con el preferido primero, luego los demás (fallback en colisión).
    const motorPreferido = (note) => {
        const candidatos = pcToMotores.get(note % 12) || [];
        if (candidatos.length <= 1) return candidatos;
        // Buscar el motor cuyo "punto medio" deja la nota en su tramo de altura.
        let idx = 0;
        for (let i = 0; i < candidatos.length - 1; i++) {
            const umbral = (candidatos[i] + candidatos[i + 1]) / 2;
            if (note > umbral) idx = i + 1;
        }
        // Preferido primero; resto ordenado por cercanía al preferido (fallback).
        const pref = candidatos[idx];
        const resto = candidatos.filter((_, i) => i !== idx)
            .sort((a, b) => Math.abs(a - pref) - Math.abs(b - pref));
        return [pref, ...resto];
    };

    // 3. Resolver step a step: cada nota pide su motor PREFERIDO (por contorno);
    //    en colisión, la de mayor atención lo conserva y las demás caen al
    //    siguiente motor libre del mismo pc, o se descartan si no hay.
    const reasignacion = new Map();
    const porStep = new Map();
    for (const ev of rawEvents) {
        if (ev.channel !== channel || ev.type !== 'noteOn' || ev.velocity <= 0) continue;
        const step = Math.floor(ev.tick / ticksPerStep);
        if (!porStep.has(step)) porStep.set(step, []);
        porStep.get(step).push(ev);
    }
    for (const [step, notas] of porStep) {
        const ocupados = new Set();
        notas.sort((a, b) => scoreDe(b.note, step) - scoreDe(a.note, step));
        for (const ev of notas) {
            const candidatos = motorPreferido(ev.note);
            const libre = candidatos.find(n => !ocupados.has(n));
            if (libre !== undefined) { ocupados.add(libre); reasignacion.set(ev, libre); }
            else                     { reasignacion.set(ev, null); }  // descartar
        }
    }

    // 4. Emitir eventos remapeados; el noteOff hereda el destino de su noteOn.
    //    pendientes: note original → destino (nota de motor, o null = descartado).
    const pendientes = new Map();
    const salida = [];
    for (const ev of rawEvents) {
        if (ev.channel !== channel) { salida.push(ev); continue; }

        if (ev.type === 'noteOn' && ev.velocity > 0) {
            const destino = reasignacion.has(ev) ? reasignacion.get(ev) : ev.note;
            pendientes.set(ev.note, destino);
            if (destino !== null) salida.push({ ...ev, note: destino });
            // destino null → noteOn descartado (no se emite)
        } else if (ev.type === 'noteOff' || (ev.type === 'noteOn' && ev.velocity === 0)) {
            const destino = pendientes.has(ev.note) ? pendientes.get(ev.note) : ev.note;
            pendientes.delete(ev.note);
            if (destino !== null) salida.push({ ...ev, note: destino });
            // destino null → su noteOn fue descartado: no emitir noteOff huérfano
        } else {
            salida.push(ev);  // meta/otros eventos del canal: intactos
        }
    }
    return salida;
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
