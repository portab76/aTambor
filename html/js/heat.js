// ============================================================
// heat.js — Motor de Atención: cálculo de heat scores
// Porta calcularAtencion() de CompresorOctava.java a JavaScript
// Depende de: state.js (gridData, noteRows, heatMapData)
// ============================================================

import { state } from './state.js';
import { BATCH_SIZE } from './chord-row.js';
import { invalidate as invalidateInterpretation } from './interpretation.js';

const MAX_NOTES_HEAT = 10000;  // Máximo de notas para la matriz (>2000 usa muestreo uniforme)

/**
 * Calcula scores de "calor" (dominancia) para cada nota del grid
 * usando el algoritmo de atención: dot-product matrix + softmax + norma L2.
 *
 * @param {Object} cellsMap - gridData.cells: Map<"note,step" → {duration, velocity}>
 * @param {Array} noteRowsArray - Array de MIDI numbers [lowest...highest]
 * @returns {Map} "note,step" → heatScore [0,1] | null si cellsMap vacío
 */
export function calcularHeatScores(cellsMap, noteRowsArray) {
    // 1. Convertir gridData.cells a array de objetos normalizados
    const notes = [];
    for (const [key, cell] of Object.entries(cellsMap)) {
        const [noteStr, stepStr] = key.split(',');
        notes.push({
            note:     parseInt(noteStr),
            step:     parseInt(stepStr),
            duration: cell.duration,
            velocity: cell.velocity
        });
    }

    if (notes.length === 0) return null;

    // 2. Muestreo uniforme si supera MAX_NOTES_HEAT
    let muestra = notes;
    if (notes.length > MAX_NOTES_HEAT) {
        const paso = Math.floor(notes.length / MAX_NOTES_HEAT);
        muestra = [];
        for (let i = 0; i < notes.length && muestra.length < MAX_NOTES_HEAT; i += paso) {
            muestra.push(notes[i]);
        }
    }

    const n = muestra.length;
    const d = 4;  // Dimensiones de feature vector
    const scale = Math.sqrt(d);  // = 2.0

    // 3. Calcular máximos para normalización
    const maxStep = Math.max(...muestra.map(x => x.step));
    const maxDur  = Math.max(...muestra.map(x => x.duration));

    // 4. Normalizar features: [step/maxStep, note/127, duration/maxDur, velocity/127]
    const f = muestra.map(x => [
        maxStep > 0 ? x.step / maxStep       : 0,
        x.note / 127,
        maxDur  > 0 ? x.duration / maxDur    : 0,
        x.velocity / 127
    ]);

    // 5. Calcular matriz de dot-products escalados + softmax por fila (max-trick)
    // Usamos Float32Array plano para mejor eficiencia de memoria
    const pesos = new Float32Array(n * n);

    for (let i = 0; i < n; i++) {
        // Primer paso: calcular raw dot-products y encontrar el máximo (para max-trick)
        let rowMax = -Infinity;
        const raw = new Float32Array(n);

        for (let j = 0; j < n; j++) {
            let s = 0;
            for (let k = 0; k < d; k++) {
                s += f[i][k] * f[j][k];
            }
            raw[j] = s / scale;
            if (raw[j] > rowMax) rowMax = raw[j];
        }

        // Segundo paso: exp(x - max) para estabilidad numérica
        let sum = 0;
        for (let j = 0; j < n; j++) {
            raw[j] = Math.exp(raw[j] - rowMax);
            sum += raw[j];
        }

        // Tercer paso: normalizar por suma (softmax)
        const baseIdx = i * n;
        for (let j = 0; j < n; j++) {
            pesos[baseIdx + j] = raw[j] / sum;
        }
    }

    // 6. Calcular scores: suma de columna j → atención recibida por cada nota
    // Cada pesos[i][j] indica cuánto atiende la nota i a la nota j.
    // La suma de la columna j = cuánta atención total recibe j del resto.
    const scores = new Float32Array(n);
    let minScore = Infinity, maxScore = -Infinity;

    for (let i = 0; i < n; i++) {
        const baseIdx = i * n;
        for (let j = 0; j < n; j++) {
            scores[j] += pesos[baseIdx + j];
        }
    }
    for (let j = 0; j < n; j++) {
        if (scores[j] < minScore) minScore = scores[j];
        if (scores[j] > maxScore) maxScore = scores[j];
    }

    // 7. Normalizar scores a [0, 1]
    const scoreRange = maxScore - minScore;
    const normalizedScores = scoreRange > 0
        ? scores.map(s => (s - minScore) / scoreRange)
        : scores.map(() => 0.5);

    // 8. Construir mapa de heat para las notas de la muestra
    const heatMap = new Map();
    for (let i = 0; i < n; i++) {
        const key = `${muestra[i].note},${muestra[i].step}`;
        heatMap.set(key, normalizedScores[i]);
    }

    // 9. Interpolación para notas no muestreadas (nearest neighbor por step)
    if (muestra.length < notes.length) {
        for (const note of notes) {
            const key = `${note.note},${note.step}`;
            if (heatMap.has(key)) continue;

            // Buscar nota de muestra más cercana en step
            let bestDist = Infinity, bestScore = 0.5;
            for (let i = 0; i < n; i++) {
                const dist = Math.abs(muestra[i].step - note.step);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestScore = normalizedScores[i];
                }
            }
            heatMap.set(key, bestScore);
        }
    }

    return heatMap;
}

/**
 * Recalcula heatMapData a partir del grid actual (gridData.cells, noteRows)
 */
export function _refreshHeatMap() {
    if (!state.gridData || Object.keys(state.gridData.cells).length === 0) {
        state.heatMapData = null;
        return;
    }
    state.heatMapData = calcularHeatScores(state.gridData.cells, state.noteRows);
    invalidateInterpretation();  // el heat cambió → la relevancia fusionada caduca

    // Debug: mostrar distribución de scores en consola
    if (state.heatMapData) {
        const vals = [...state.heatMapData.values()];
        const min  = Math.min(...vals).toFixed(3);
        const max  = Math.max(...vals).toFixed(3);
        const avg  = (vals.reduce((a,b) => a+b, 0) / vals.length).toFixed(3);
        console.log(`[heat] n=${vals.length}  min=${min}  max=${max}  avg=${avg}`);
        console.log('[heat] primeras claves:', [...state.heatMapData.entries()].slice(0,5));
        console.log('[heat] primera clave gridData:', Object.keys(state.gridData.cells)[0]);
    }
}

/**
 * Detecta silencios reales en la canción: rangos de pasos donde
 * ninguna nota está sonando (ni empezando ni sustentándose).
 * Estos son los únicos puntos seguros para vaciar el buffer del ESP32.
 *
 * Resultado: rellena breathingSegments con bloques de contenido musical
 * separados por silencios reales. El corte se hace al inicio de cada silencio.
 * Fallback: si la canción es densa (< 2 silencios), parte en lotes de compases.
 */
export function calcularBreathingPoints() {
    if (!state.gridData || Object.keys(state.gridData.cells).length === 0) {
        state.breathingSegments = [];
        return;
    }

    const MIN_SILENCE_STEPS = 2; // mínimo de pasos consecutivos sin nota para cortar

    // 1. Marcar qué pasos tienen nota sonando (inicio + duración completa)
    const active = new Uint8Array(state.totalSteps);
    for (const [key, cell] of Object.entries(state.gridData.cells)) {
        const [, stepStr] = key.split(',');
        const start = parseInt(stepStr);
        const end   = Math.min(start + Math.ceil(cell.duration), state.totalSteps);
        for (let s = start; s < end; s++) active[s] = 1;
    }

    // 2. Encontrar rangos de silencio real y usarlos como puntos de corte
    const breaks = [0];
    let s = 0;
    while (s < state.totalSteps) {
        if (!active[s]) {
            const silenceStart = s;
            while (s < state.totalSteps && !active[s]) s++;
            if (s - silenceStart >= MIN_SILENCE_STEPS) {
                breaks.push(silenceStart);
            }
        } else {
            s++;
        }
    }
    breaks.push(state.totalSteps);

    // Eliminar posibles duplicados y asegurar orden
    const uniqueBreaks = [...new Set(breaks)].sort((a, b) => a - b);

    // 3. Fallback: si la canción es densa (menos de 2 cortes reales)
    if (uniqueBreaks.length < 3) {
        const spm = state.currentTimeSig ? state.currentTimeSig.stepsPerMeasure : 16;
        const bm  = BATCH_SIZE;
        uniqueBreaks.length = 0;
        uniqueBreaks.push(0);
        for (let i = bm * spm; i < state.totalSteps; i += bm * spm) uniqueBreaks.push(i);
        uniqueBreaks.push(state.totalSteps);
        console.log(`[breath] Canción densa — fallback ${uniqueBreaks.length - 1} lotes de ${bm} compases`);
    }

    // 4. Construir segmentos con energía para el color del bloque
    state.breathingSegments = [];
    for (let i = 0; i < uniqueBreaks.length - 1; i++) {
        const startStep = uniqueBreaks[i];
        const endStep   = uniqueBreaks[i + 1];

        let totalE = 0, noteCount = 0;
        const noteSet = new Set();
        for (const [key, cell] of Object.entries(state.gridData.cells)) {
            const [noteStr, stepStr] = key.split(',');
            const step = parseInt(stepStr);
            if (step < startStep || step >= endStep) continue;
            const heat = (state.heatMapData && state.heatMapData.has(key)) ? state.heatMapData.get(key) : 0.5;
            totalE += heat * (cell.velocity / 127);
            noteCount++;
            noteSet.add(parseInt(noteStr));
        }
        const avgE = noteCount > 0 ? Math.min(totalE / noteCount, 1) : 0;

        state.breathingSegments.push({
            startStep,
            endStep,
            energy:        avgE,
            activeNotes:   [...noteSet].sort((a, b) => a - b),
            chordDisplay:  `R${i + 1}`,
            chordFunction: `${Math.round(avgE * 100)}% E`,
        });
    }

    const silences = uniqueBreaks.length - 2; // sin contar 0 y totalSteps
    console.log(`[breath] ${state.breathingSegments.length} bloques, ${silences} silencios reales detectados`);
}

/**
 * Calcula la octava MIDI central ponderada por heat score.
 * Usa el resultado de calcularHeatScores() para determinar
 * en qué octava se concentra la "energía" de la pieza.
 *
 * @param {Map} heatMap  — resultado de calcularHeatScores()
 * @returns {number}     — octava entera [0..9], por defecto 2 (octava del robot)
 */
export function calcularOctavaDesdeHeat(heatMap) {
    if (!heatMap || heatMap.size === 0) return 2;

    let sumScore = 0, sumOctava = 0;
    for (const [key, score] of heatMap) {
        const note = parseInt(key.split(',')[0]);
        const oct  = Math.floor(note / 12);
        sumOctava += score * oct;
        sumScore  += score;
    }
    return sumScore > 0 ? Math.round(sumOctava / sumScore) : 2;
}
