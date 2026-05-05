// ============================================================
// heat.js — Motor de Atención: cálculo de heat scores
// Porta calcularAtencion() de CompresorOctava.java a JavaScript
// Depende de: state.js (gridData, noteRows, heatMapActive, heatMapData)
// ============================================================

const MAX_NOTES_HEAT = 10000;  // Máximo de notas para la matriz (>2000 usa muestreo uniforme)

/**
 * Calcula scores de "calor" (dominancia) para cada nota del grid
 * usando el algoritmo de atención: dot-product matrix + softmax + norma L2.
 *
 * @param {Object} cellsMap - gridData.cells: Map<"note,step" → {duration, velocity}>
 * @param {Array} noteRowsArray - Array de MIDI numbers [lowest...highest]
 * @returns {Map} "note,step" → heatScore [0,1] | null si cellsMap vacío
 */
function calcularHeatScores(cellsMap, noteRowsArray) {
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
function _refreshHeatMap() {
    if (!gridData || Object.keys(gridData.cells).length === 0) {
        heatMapData = null;
        return;
    }
    heatMapData = calcularHeatScores(gridData.cells, noteRows);

    // Debug: mostrar distribución de scores en consola
    if (heatMapData) {
        const vals = [...heatMapData.values()];
        const min  = Math.min(...vals).toFixed(3);
        const max  = Math.max(...vals).toFixed(3);
        const avg  = (vals.reduce((a,b) => a+b, 0) / vals.length).toFixed(3);
        console.log(`[heat] n=${vals.length}  min=${min}  max=${max}  avg=${avg}`);
        console.log('[heat] primeras claves:', [...heatMapData.entries()].slice(0,5));
        console.log('[heat] primera clave gridData:', Object.keys(gridData.cells)[0]);
    }
}

/**
 * Toggle del modo heat map desde la toolbar
 * Activa/desactiva visualización, calcula si es necesario
 */
function toggleHeatMap() {
    heatMapActive = !heatMapActive;

    const btn = document.getElementById('heatMapBtn');
    if (btn) {
        btn.classList.toggle('btn-active', heatMapActive);
    }

    // Si activando y no hay datos aún, calcular
    if (heatMapActive && heatMapData === null && gridData && Object.keys(gridData.cells).length > 0) {
        _refreshHeatMap();
    }

    // Redibujar con los nuevos datos
    if (typeof drawPianoRollWithPlayhead === 'function') {
        drawPianoRollWithPlayhead(reproduciendo ? pasoActual : -1);
    }
}
