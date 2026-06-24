// ============================================================
// voicing.js — Separación de manos / roles de voz (Fase 1)
//
// Detecta el ROL de cada nota del grid sin necesidad de canales MIDI
// separados, para piezas densas escritas en un solo canal:
//
//   - 'bass'   → mano izquierda: graves que sostienen la armonía
//   - 'melody' → mano derecha:   voz aguda que lleva la línea melódica
//   - 'inner'  → voces internas de relleno (ni lo más grave ni la melodía)
//
// El criterio combina REGISTRO (altura MIDI relativa) y MOVILIDAD
// (la melodía cambia de nota con frecuencia; la base es más estable y
// de notas largas). Trabaja sobre los segmentos armónicos ya fusionados
// (state.currentFusedSegments) y las duraciones del grid.
//
// Consumido por interpretation.js para la señal de melodía/base de la
// fusión de relevancia, sustituyendo la heurística "nota más aguda".
//
// API pública:
//   buildVoicing()             → Map<"note,step" → 'bass'|'melody'|'inner'>
//   invalidate()               → descarta el cache
// ============================================================

import { state } from './state.js';

let _cache = null;  // Map<"note,step" → role>

export function invalidate() {
    _cache = null;
}

/**
 * Umbral de registro que separa graves (mano izq) de agudos (mano der).
 * No es fijo: se calcula como la mediana ponderada de las notas de la pieza,
 * para adaptarse a obras graves (bajo) o agudas (música de cámara aguda).
 */
function _splitPoint(cells) {
    const notes = [];
    for (const key of Object.keys(cells)) {
        notes.push(parseInt(key.slice(0, key.indexOf(',')), 10));
    }
    if (notes.length === 0) return 60;  // C4 por defecto
    notes.sort((a, b) => a - b);
    return notes[Math.floor(notes.length / 2)];  // mediana
}

/**
 * Para cada segmento fusionado, decide qué nota activa es la melodía.
 * Regla: la voz superior del segmento ES melodía SOLO si está por encima del
 * punto de separación (evita marcar como "melodía" la nota más alta de un
 * acorde grave de mano izquierda). Devuelve Map<segmento → melodyNote|-1>.
 */
function _melodyBySegment(segments, split) {
    const mel = new Map();
    for (const seg of (segments || [])) {
        const notes = seg.activeNotes || [];
        if (notes.length === 0) { mel.set(seg, -1); continue; }
        const top = notes[notes.length - 1];
        mel.set(seg, top >= split ? top : -1);
    }
    return mel;
}

/**
 * Lookup binario step → segmento que lo cubre (segmentos ordenados por start).
 */
function _segmentLookup(segments) {
    if (!segments || segments.length === 0) return () => null;
    return (step) => {
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
 * Construye el mapa de roles por nota.
 *
 * Para cada celda del grid:
 *   - si es la melodía de su segmento (voz superior por encima del split) → 'melody'
 *   - si está por debajo del split (registro grave)                       → 'bass'
 *   - en otro caso (voz interna en registro medio/agudo)                  → 'inner'
 *
 * Refuerzo por movilidad: una nota grave de duración larga es base clara;
 * una nota grave corta y aislada puede ser melodía de mano izquierda — pero
 * mantenemos la regla simple (registro + voz superior) y dejamos los matices
 * de movilidad para una iteración futura si hiciera falta.
 *
 * @returns {Map<string,string>} "note,step" → 'bass'|'melody'|'inner'
 */
export function buildVoicing() {
    if (_cache) return _cache;

    const cells = state.gridData?.cells || {};
    const out = new Map();
    if (Object.keys(cells).length === 0) { _cache = out; return out; }

    const split    = _splitPoint(cells);
    const segments = state.currentFusedSegments || [];
    const segAt    = _segmentLookup(segments);
    const melodyOf = _melodyBySegment(segments, split);

    for (const key of Object.keys(cells)) {
        const ci   = key.indexOf(',');
        const note = parseInt(key.slice(0, ci), 10);
        const step = parseInt(key.slice(ci + 1), 10);

        let role;
        const seg = segAt(step);
        if (seg && melodyOf.get(seg) === note) {
            role = 'melody';
        } else if (note < split) {
            role = 'bass';
        } else {
            role = 'inner';
        }
        out.set(key, role);
    }

    _cache = out;
    return out;
}
