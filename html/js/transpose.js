// ============================================================
// transpose.js — Panel de transposición de escala en tiempo real
// Depende de: state.js, motor-map.js, esp32-sequencer.js
//
// API pública:
//   toggleTransposePanel()  — muestra/oculta el panel desplegable
// ============================================================

(function () {

// ── Constantes ────────────────────────────────────────────────
const NOTE_NAMES  = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const SHARP_NOTES = new Set([1, 3, 6, 8, 10]);

const PIANO_MIN_NOTE = 24;   // C1
const PIANO_MAX_NOTE = 95;   // B6

// Misma paleta que OCTAVE_COLORS en piano-roll.js
const OCT_COLORS = {
    1: { bg: '#2a0a0a', stripe: '#8b1a1a', text: '#ff6666' },
    2: { bg: '#2a1a0a', stripe: '#8b4a1a', text: '#ff9944' },
    3: { bg: '#2a2a0a', stripe: '#7a7a1a', text: '#dddd44' },
    4: { bg: '#0a2a0a', stripe: '#1a6a1a', text: '#44dd44' },
    5: { bg: '#0a1a2a', stripe: '#1a4a8b', text: '#4488ff' },
    6: { bg: '#1a0a2a', stripe: '#4a1a8b', text: '#bb66ff' },
};

const WHITE_W = 18;
const KEY_H   = 68;
const BLACK_H = 42;
const BLACK_W = 12;

function _octave(midi)  { return Math.floor(midi / 12) - 1; }
function _octColor(midi){ const oct = Math.max(1, Math.min(6, _octave(midi))); return OCT_COLORS[oct]; }

// ── Layout de teclas ──────────────────────────────────────────
function _buildKeyLayout() {
    const layout = [];
    let whiteX = 0;
    for (let midi = PIANO_MIN_NOTE; midi <= PIANO_MAX_NOTE; midi++) {
        const semi    = midi % 12;
        const isBlack = SHARP_NOTES.has(semi);
        if (isBlack) {
            layout.push({ x: whiteX - Math.round(BLACK_W * 0.6), w: BLACK_W, isBlack: true, midi });
        } else {
            layout.push({ x: whiteX, w: WHITE_W, isBlack: false, midi });
            whiteX += WHITE_W;
        }
    }
    return { layout, totalWidth: whiteX };
}

// ── Render del piano ──────────────────────────────────────────
function _renderPiano(canvas, currentOffset) {
    const { layout, totalWidth } = _buildKeyLayout();
    canvas.width  = totalWidth;
    canvas.height = KEY_H + 2;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const mappedOriginal   = new Set(MOTOR_MAP.map(m => m.note));
    const mappedTransposed = new Set(MOTOR_MAP.map(m => m.note + currentOffset));

    // Teclas blancas — color de octava uniforme (stripe como fondo, bg de base)
    for (const key of layout) {
        if (key.isBlack) continue;
        const midi = key.midi;
        const col  = _octColor(midi);

        ctx.fillStyle = col.bg;
        ctx.fillRect(key.x, 0, key.w - 1, KEY_H);
        ctx.fillStyle = col.stripe;
        ctx.fillRect(key.x, 0, key.w - 1, KEY_H);  // tono medio visible

        ctx.strokeStyle = '#1a1a1a';
        ctx.strokeRect(key.x + 0.5, 0.5, key.w - 1.5, KEY_H - 0.5);

        // Etiqueta C de cada octava con el color texto de la paleta
        if (midi % 12 === 0) {
            ctx.fillStyle = col.text;
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('C' + _octave(midi), key.x + key.w / 2, KEY_H - 3);
        }
    }

    // Teclas negras — usando bg (más oscuro que stripe)
    for (const key of layout) {
        if (!key.isBlack) continue;
        const col = _octColor(key.midi);

        ctx.fillStyle = col.bg;
        ctx.fillRect(key.x, 0, key.w, BLACK_H);

        ctx.strokeStyle = '#000';
        ctx.strokeRect(key.x + 0.5, 0.5, key.w - 0.5, BLACK_H - 0.5);
    }

    // Línea de puntos SIEMPRE visible: marca las notas activas (motor.note + offset)
    if (MOTOR_MAP.length > 0) {
        const tMin = Math.min(...MOTOR_MAP.map(m => m.note + currentOffset));
        const tMax = Math.max(...MOTOR_MAP.map(m => m.note + currentOffset));
        const minKey = layout.find(k => k.midi === Math.max(PIANO_MIN_NOTE, tMin));
        const maxKey = layout.find(k => k.midi === Math.min(PIANO_MAX_NOTE, tMax));
        if (minKey && maxKey) {
            ctx.strokeStyle = 'rgba(255,255,255,0.85)';
            ctx.lineWidth   = 2;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.rect(minKey.x + 1, 1, maxKey.x + maxKey.w - minKey.x - 2, KEY_H);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.lineWidth = 1;
        }
    }
}

// ── Etiqueta de rango ─────────────────────────────────────────
function _rangeLabel(offset) {
    if (!MOTOR_MAP || MOTOR_MAP.length === 0) return '(sin motor map)';
    const notes = MOTOR_MAP.map(m => m.note);
    const minN  = Math.min(...notes);
    const maxN  = Math.max(...notes);
    function noteName(n) {
        return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
    }
    const orig = noteName(minN) + ' – ' + noteName(maxN);
    if (offset === 0) return `Rango original: ${orig}`;
    const dir  = offset > 0 ? `+${offset}` : `${offset}`;
    return `Original: ${orig}  →  ${dir} st: ${noteName(minN + offset)} – ${noteName(maxN + offset)}`;
}

// ── Rango dinámico del slider ─────────────────────────────────
function _sliderRange() {
    if (!MOTOR_MAP || MOTOR_MAP.length === 0) return { min: -24, max: 24 };
    const notes = MOTOR_MAP.map(m => m.note);
    return {
        min: PIANO_MIN_NOTE - Math.min(...notes),
        max: PIANO_MAX_NOTE - Math.max(...notes),
    };
}

// ── Hot-apply ─────────────────────────────────────────────────
function _applyTranspose(newOffset) {
    transposeOffset = newOffset;
    if (typeof reproduciendo !== 'undefined' && reproduciendo &&
        typeof wsConnected !== 'undefined' && wsConnected &&
        typeof buildRemainingSequence === 'function') {
        const remaining = buildRemainingSequence(MOTOR_MAP, pasoActual);
        if (remaining) {
            const blocks = validateSequenceSize(remaining);
            sendCommand('APPEND\n' + blocks[0]);
            if (blocks.length > 1) setTimeout(() => sendCommand('APPEND\n' + blocks[1]), 100);
        }
    }
}

// ── Actualizar UI ─────────────────────────────────────────────
function _tpRefreshUI(offset) {
    const canvas = document.getElementById('transposePianoCanvas');
    const label  = document.getElementById('transposeRangeLabel');
    const valLbl = document.getElementById('transposeValueLabel');
    const slider = document.getElementById('transposeSlider');
    if (canvas) _renderPiano(canvas, offset);
    if (label)  label.textContent = _rangeLabel(offset);
    if (valLbl) valLbl.textContent = (offset > 0 ? '+' : '') + offset;
    if (slider) slider.value = offset;
}

// ── Handlers globales ─────────────────────────────────────────
window._tpSlider = function (val) {
    const offset = parseInt(val, 10);
    _applyTranspose(offset);
    _tpRefreshUI(offset);
};

window._tpShift = function (delta, absolute) {
    const current = (typeof transposeOffset !== 'undefined') ? transposeOffset : 0;
    const { min, max } = _sliderRange();
    const offset = absolute ? delta : Math.max(min, Math.min(max, current + delta));
    _applyTranspose(offset);
    _tpRefreshUI(offset);
};

// ── API pública ───────────────────────────────────────────────
window.toggleTransposePanel = function () {
    const panel  = document.getElementById('transposePanel');
    const btn    = document.getElementById('transposePanelBtn');
    if (!panel) return;

    const visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : '';
    if (btn) btn.classList.toggle('btn-active', !visible);

    if (!visible) {
        // Primera apertura: calibrar slider y renderizar piano
        const { min, max } = _sliderRange();
        const slider = document.getElementById('transposeSlider');
        if (slider) { slider.min = min; slider.max = max; }
        const offset = (typeof transposeOffset !== 'undefined') ? transposeOffset : 0;
        _tpRefreshUI(offset);
    }
};

})();
