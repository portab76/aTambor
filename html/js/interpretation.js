// ============================================================
// interpretation.js — Capa de Interpretación Expresiva
// "Escuchar antes de tocar"
//
// Fusiona las capas de escucha que el proyecto ya calcula (atención,
// armonía/frases, respiración) más el rol de voz (Fase 1) en un único score
// de relevancia por nota, y lo traduce a un factor expresivo sobre la
// velocity de cada celda.
//
// NO muta el timing global ni reordena notas: solo reescribe la velocity de
// cada celda según lo que la pieza "pide". El cambio es VISIBLE en el panel de
// velocidad y EDITABLE a mano; es destructivo y reversible con Undo.
//
// Depende de (todo ya existente en state.js):
//   - state.heatMapData          → atención por nota   (heat.js)
//   - state.currentFusedSegments → acordes por bloque  (harmonic-core.js)
//   - state.currentPhraseSegments→ cadencias/frases     (harmonic-core.js)
//   - state.breathingSegments    → silencios/energía    (heat.js)
//   - buildVoicing()             → rol de voz por nota  (voicing.js, Fase 1)
//
// API pública:
//   buildInterpretation()        → Map<"note,step" → relevance[0,1]>
//   applyInterpretationToGrid(opts) → reescribe velocity + duración y, opcional,
//                                     omite voces internas. Destructivo.
// ============================================================

import { state } from './state.js';
import { buildVoicing, invalidate as invalidateVoicing } from './voicing.js';
import { MOTOR_MAP, _mmVelRange } from './motor-map.js';

// Pesos de fusión. Suman 1.0 para que relevance quede normalizada en [0,1]
// sin pasos extra. Ajustables luego desde UI (Fase 5) — son la "firma
// expresiva" del compositor.
export const WEIGHTS = {
    heat:     0.40,  // cuánta atención recibe la nota del resto de la pieza
    chord:    0.18,  // pertenece al acorde detectado vs nota de paso
    voice:    0.22,  // rol de voz (melody/bass/inner) — Fase 1, ver _voiceScore
    cadence:  0.12,  // cae en el último compás de una frase / cadencia
    breath:   0.08,  // primera nota de un bloque tras un silencio real
};

// Peso del rol de voz dentro del término WEIGHTS.voice.
// La melodía (mano der.) canta; el bajo (mano izq.) sostiene con presencia
// media; las voces internas se apartan.
const VOICE_SCORE = {
    melody: 1.0,
    bass:   0.55,
    inner:  0.2,
};

// Rangos de modulación, ajustables desde la UI (Fase 5). Objeto mutable para
// que los sliders escriban sobre él en vivo.
//   dynFloor/dynCeil → multiplicador de velocity en relevance 0 / 1
//   artFloor/artCeil → multiplicador de duración (staccato ↔ legato)
export const RANGE = {
    dynFloor: 0.72,  // -28% en lo más irrelevante
    dynCeil:  1.18,  // +18% en lo más clave (luego se clampa a 127)
    artFloor: 0.55,  // notas de relleno: se acortan (más secas)
    artCeil:  1.35,  // melodía/clave: se alargan (cantan)
};

const ART_MIN_STEPS = 1; // nunca por debajo de 1 paso

// Copia inmutable de los valores por defecto, para el botón "Resetear" de la UI.
// Se toma de los objetos de arriba ANTES de que ningún slider los mute.
const WEIGHTS_DEFAULT = Object.freeze({ ...WEIGHTS });
const RANGE_DEFAULT   = Object.freeze({ ...RANGE });

/**
 * Restaura WEIGHTS y RANGE a sus valores por defecto (mutando en sitio, ya que
 * otros módulos importan las referencias) e invalida el cache de la vista previa.
 */
export function resetWeightsAndRanges() {
    Object.assign(WEIGHTS, WEIGHTS_DEFAULT);
    Object.assign(RANGE,   RANGE_DEFAULT);
    invalidate();
}

let _cache = null;  // Map<"note,step" → relevance>, invalidado con invalidate()

/**
 * Invalida el cache. Llamar tras cualquier recálculo de heat/armónico/respiración
 * o edición del grid. Barato: la próxima lectura reconstruye perezosamente.
 */
export function invalidate() {
    _cache = null;
    state.interpretPreviewData = null;  // la vista previa también caduca
    invalidateVoicing();  // el voicing depende del grid/segmentos → caduca a la vez
}

/**
 * Asegura que state.heatMapData esté calculado. El heat es entrada obligatoria
 * de la fusión, pero solo se refresca automáticamente cuando el modo calor está
 * activo. Si el usuario activa la interpretación sin el heat map visible, lo
 * calculamos aquí bajo demanda. Import dinámico para evitar ciclo con heat.js.
 */
async function _ensureHeat() {
    if (state.heatMapData && state.heatMapData.size > 0) return;
    if (!state.gridData || Object.keys(state.gridData.cells).length === 0) return;
    const { calcularHeatScores } = await import('./heat.js');
    state.heatMapData = calcularHeatScores(state.gridData.cells, state.noteRows);
    invalidate();
}

/**
 * ¿Hay material suficiente para interpretar? Sin heat al menos, no fusionamos.
 */
function _hasInputs() {
    return !!(state.heatMapData && state.heatMapData.size > 0);
}

/**
 * Indexa los segmentos fusionados por paso para lookup O(1) amortizado.
 * Devuelve función (step) → segmento que cubre ese paso, o null.
 */
function _segmentLookup(segments) {
    if (!segments || segments.length === 0) return () => null;
    // Los segmentos vienen ordenados por startStep desde harmonic-core.
    return (step) => {
        // Búsqueda binaria sobre [startStep, endStep)
        let lo = 0, hi = segments.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const s = segments[mid];
            if (step < s.startStep)      hi = mid - 1;
            else if (step >= s.endStep)  lo = mid + 1;
            else return s;
        }
        return null;
    };
}

/**
 * Construye el set de pasos que inician un bloque tras un silencio real.
 * breathingSegments[i].startStep es el primer paso de cada bloque de contenido.
 */
function _breathOnsetSteps() {
    const onsets = new Set();
    for (const seg of (state.breathingSegments || [])) {
        onsets.add(seg.startStep);
    }
    return onsets;
}

/**
 * Construye el set de pasos que pertenecen al último compás de una frase
 * (zona de cadencia / resolución — donde el fraseo humano "respira" y acentúa).
 */
function _cadenceSteps() {
    const steps = new Set();
    const phrases = state.currentPhraseSegments || [];
    const SPM = (state.currentTimeSig && state.currentTimeSig.stepsPerMeasure) || 16;
    for (const ph of phrases) {
        // Último compás de la frase: [endStep - SPM, endStep)
        const from = Math.max(ph.startStep, ph.endStep - SPM);
        for (let s = from; s < ph.endStep; s++) steps.add(s);
    }
    return steps;
}

/**
 * Reconstruye el mapa de relevancia fusionando las cinco señales.
 * Recorre las notas del heatMap (que cubre todas las celdas del grid).
 *
 * @returns {Map<string, number>} "note,step" → relevance [0,1]
 */
export function buildInterpretation() {
    if (_cache) return _cache;
    if (!_hasInputs()) { _cache = new Map(); return _cache; }

    const fused      = state.currentFusedSegments || [];
    const segAt      = _segmentLookup(fused);
    const voicing    = buildVoicing();   // Fase 1: rol real de cada nota
    const breathSet  = _breathOnsetSteps();
    const cadenceSet = _cadenceSteps();

    const out = new Map();

    for (const [key, heat] of state.heatMapData) {
        const ci = key.indexOf(',');
        const note = parseInt(key.slice(0, ci), 10);
        const step = parseInt(key.slice(ci + 1), 10);

        // 1) Atención (ya en [0,1])
        const sHeat = heat;

        // 2) Acorde: pertenece al acorde detectado vs nota de paso
        let sChord = 0.3;
        const seg = segAt(step);
        if (seg) {
            sChord = (seg.activeNotes || []).includes(note) ? 1 : 0.3;
        }

        // 3) Rol de voz (Fase 1): melody / bass / inner → VOICE_SCORE
        const role = voicing.get(key) || 'inner';
        const sVoice = VOICE_SCORE[role];

        // 4) Cadencia / fin de frase
        const sCadence = cadenceSet.has(step) ? 1 : 0;

        // 5) Respiración: inicio de bloque tras silencio
        const sBreath = breathSet.has(step) ? 1 : 0;

        const relevance =
              WEIGHTS.heat    * sHeat
            + WEIGHTS.chord   * sChord
            + WEIGHTS.voice   * sVoice
            + WEIGHTS.cadence * sCadence
            + WEIGHTS.breath  * sBreath;

        out.set(key, relevance);
    }

    _cache = out;
    return out;
}

/**
 * Traduce relevance a un factor multiplicativo sobre la dinámica.
 * relevance 0 → RANGE.dynFloor, relevance 1 → RANGE.dynCeil, lineal entre medias.
 */
function _dynamicFactor(relevance) {
    return RANGE.dynFloor + (RANGE.dynCeil - RANGE.dynFloor) * relevance;
}

/** Factor de articulación (duración) según relevancia. */
function _articulationFactor(relevance) {
    return RANGE.artFloor + (RANGE.artCeil - RANGE.artFloor) * relevance;
}

/**
 * Límites de velocity (escala grid 0-127) para una nota MIDI concreta. Si la
 * nota tiene un motor asignado en MOTOR_MAP, devuelve su rango [velMin, velMax]
 * convertido de escala ESP32 (1-100) a escala grid (0-127), de modo que la
 * velocity resultante de la interpretación nunca se salga del rango parametrizado
 * para esa nota. Si la nota NO tiene motor, no se aplican límites de motor: se
 * usa la escala completa del grid (1-127).
 *
 * Se busca por nota ABSOLUTA (sin transposeOffset), igual que en el import.
 */
function _velLimits(midiNote) {
    const cfg = MOTOR_MAP.find(m => m.note === midiNote) ?? null;
    if (!cfg) return { min: 1, max: 127 };
    const { min, max } = _mmVelRange(cfg);        // escala ESP32 1-100
    return {
        min: Math.max(1, Math.round(min / 100 * 127)),
        max: Math.round(max / 100 * 127),
    };
}

/**
 * Para cada nota (misma altura MIDI), calcula el siguiente paso de inicio,
 * para poder topar el estiramiento de duración y no solapar dos golpes del
 * mismo motor. Devuelve Map<"note,step" → nextStartStep | Infinity>.
 */
function _nextOnsetByPitch(cells) {
    const byPitch = new Map();  // note → [steps...]
    for (const key of Object.keys(cells)) {
        const ci = key.indexOf(',');
        const note = parseInt(key.slice(0, ci), 10);
        const step = parseInt(key.slice(ci + 1), 10);
        if (!byPitch.has(note)) byPitch.set(note, []);
        byPitch.get(note).push(step);
    }
    const nextOf = new Map();
    for (const [note, steps] of byPitch) {
        steps.sort((a, b) => a - b);
        for (let i = 0; i < steps.length; i++) {
            const next = (i + 1 < steps.length) ? steps[i + 1] : Infinity;
            nextOf.set(`${note},${steps[i]}`, next);
        }
    }
    return nextOf;
}

/**
 * Aplica la interpretación DIRECTAMENTE al grid. A diferencia de la vía "al
 * vuelo", es visible (panel de velocidad / piano roll) y editable a mano.
 * Destructivo y reversible con Undo (el caller registra historial antes).
 *
 * @param {Object}  opts
 * @param {boolean} opts.dynamics      reescribir velocity  (default true)
 * @param {boolean} opts.articulation  reescribir duración  (default true)
 * @returns {{ velChanged, durChanged, total }}
 */
export async function applyInterpretationToGrid(opts = {}) {
    const {
        dynamics     = true,
        articulation = true,
    } = opts;

    await _ensureHeat();
    const map = buildInterpretation();
    if (map.size === 0) return { velChanged: 0, durChanged: 0, total: 0 };

    const cells   = state.gridData?.cells || {};
    const nextOf  = articulation ? _nextOnsetByPitch(cells) : null;

    let velChanged = 0, durChanged = 0, total = 0;

    for (const [key, cell] of Object.entries(cells)) {
        total++;
        const relevance = map.get(key);
        if (relevance === undefined) continue;

        // ── Dinámica: velocity (clampada al rango del MOTOR de esta nota) ──
        if (dynamics) {
            const midiNote = parseInt(key.slice(0, key.indexOf(',')), 10);
            const vlim     = _velLimits(midiNote);   // rango [velMin,velMax] del motor (escala grid)
            const nuevoVel = Math.max(vlim.min, Math.min(vlim.max,
                Math.round(cell.velocity * _dynamicFactor(relevance))));
            if (nuevoVel !== cell.velocity) { cell.velocity = nuevoVel; velChanged++; }
        }

        // ── Articulación: duración (topada a la siguiente nota de igual altura) ──
        if (articulation) {
            const step = parseInt(key.slice(key.indexOf(',') + 1, key.length), 10);
            const maxDur = (nextOf.get(key) ?? Infinity) - step;  // hueco hasta el próximo golpe
            let nuevoDur = Math.round(cell.duration * _articulationFactor(relevance));
            nuevoDur = Math.max(ART_MIN_STEPS, nuevoDur);
            if (maxDur !== Infinity) nuevoDur = Math.min(nuevoDur, maxDur);
            if (nuevoDur !== cell.duration) { cell.duration = nuevoDur; durChanged++; }
        }
    }

    return { velChanged, durChanged, total };
}

// ============================================================
// Fase 5 — soporte de UI (vista previa por color + sliders)
// ============================================================

/**
 * Recalcula state.interpretPreviewData (mapa relevance por nota) para que el
 * piano roll lo pinte. Llamar al activar la vista previa, al mover un slider o
 * tras editar el grid. Asegura el heat bajo demanda.
 */
export async function refreshInterpretPreview() {
    await _ensureHeat();
    state.interpretPreviewData = buildInterpretation();
    return state.interpretPreviewData;
}

/**
 * Ajusta un peso de la fusión y recalcula. Los pesos NO se renormalizan: el
 * usuario controla la mezcla tal cual (relevance puede pasar de 1 pero el factor
 * dinámico/articulación se clampa igual). Invalida el cache para forzar recálculo.
 *
 * @param {string} name  — 'heat'|'chord'|'voice'|'cadence'|'breath'
 * @param {number} value — peso [0..1]
 */
export function setWeight(name, value) {
    if (!(name in WEIGHTS)) return;
    WEIGHTS[name] = Math.max(0, Math.min(1, value));
    invalidate();
}

/**
 * Ajusta un extremo de rango (dinámica o articulación) y recalcula.
 * @param {string} name  — 'dynFloor'|'dynCeil'|'artFloor'|'artCeil'
 * @param {number} value
 */
export function setRange(name, value) {
    if (!(name in RANGE)) return;
    RANGE[name] = value;
    // El rango no afecta a relevance (solo al factor), pero invalidamos por
    // consistencia: la vista previa pinta relevance, que no cambia con el rango.
}
