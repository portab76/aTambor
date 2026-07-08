// ============================================================
// theme.js — Sistema de temas claro / oscuro
// ============================================================

import { state } from './state.js';
import { drawPianoRollWithPlayhead, drawNoteLabels } from './piano-roll.js';
import { drawTimelineRuler } from './timeline-ruler.js';

const THEMES = {
    dark: {
        // Paleta CSS (se aplica como data-theme en <html>)
        name: 'dark',
        label: '🌙 Oscuro',

        // Colores del canvas (leídos por piano-roll.js, timeline-ruler.js, minimap.js)
        canvas: {
            bg:       '#252530',
            rowAlt:   '#1e1e28',
            grid:     '#3a3a50',
            gridBar:  '#555555',
            label:    '#666666',
            playhead: 'rgba(255,230,0,0.9)',
            deepBg:   '#0d0d1c',   // fondo profundo (regla, minimap)
            deepLine: '#1a1a3a',   // líneas tenues sobre el fondo profundo

            // Columna de etiquetas de notas (noteLabelsCanvas): arcoíris por octava
            octaveColors: {
                1: { bg: '#2a0a0a', stripe: '#8b1a1a', text: '#ff6666' },  // rojo
                2: { bg: '#2a1a0a', stripe: '#8b4a1a', text: '#ff9944' },  // naranja
                3: { bg: '#2a2a0a', stripe: '#7a7a1a', text: '#dddd44' },  // amarillo
                4: { bg: '#0a2a0a', stripe: '#1a6a1a', text: '#44dd44' },  // verde
                5: { bg: '#0a1a2a', stripe: '#1a4a8b', text: '#4488ff' },  // azul
                6: { bg: '#1a0a2a', stripe: '#4a1a8b', text: '#bb66ff' },  // violeta
            },
        },

        // Patches de inline styles que CSS variables no pueden alcanzar
        inline: {
            appMenu:      { background: '#1a1a30', borderColor: '#3a3a5a' },
            helpModal:    { background: '#1e1e32', borderColor: '#5a5aaa' },
            helpHeader:   { background: '#2a2a48', borderColor: '#3a3a5a' },
            motorPanel:   { background: '#13132a', borderColor: '#33335a' },
        },
    },

    light: {
        name: 'light',
        label: '☀️ Claro',

        canvas: {
            bg:       '#f8f9ff',
            rowAlt:   '#eef0fa',
            grid:     '#ccd0e8',
            gridBar:  '#9090bb',
            label:    '#7788aa',
            playhead: 'rgba(220,80,0,0.85)',
            deepBg:   '#dde0ee',   // fondo profundo claro (regla, minimap)
            deepLine: '#c0c4d8',   // líneas tenues sobre el fondo profundo claro

            // Columna de etiquetas de notas (noteLabelsCanvas): arcoíris por octava, versión clara
            octaveColors: {
                1: { bg: '#ffe0e0', stripe: '#e08888', text: '#a02020' },  // rojo
                2: { bg: '#ffe8d0', stripe: '#e0a868', text: '#a05a10' },  // naranja
                3: { bg: '#fbf6c8', stripe: '#c8c060', text: '#807410' },  // amarillo
                4: { bg: '#dcf0dc', stripe: '#78c078', text: '#206020' },  // verde
                5: { bg: '#d8e6fa', stripe: '#7098d8', text: '#204090' },  // azul
                6: { bg: '#ecdcf8', stripe: '#a878d0', text: '#5a2090' },  // violeta
            },
        },

        inline: {
            appMenu:      { background: '#f5f6ff', borderColor: '#b0b4d0' },
            helpModal:    { background: '#f0f2fa', borderColor: '#9090cc' },
            helpHeader:   { background: '#e4e6f8', borderColor: '#b0b4d0' },
            motorPanel:   { background: '#eaecf8', borderColor: '#b8bcd8' },
        },
    },
};

// Paleta viva — el canvas la lee en cada redraw
window.CANVAS_THEME = { ...THEMES.dark.canvas };

let _currentTheme = 'light';

// ── Aplicar tema ─────────────────────────────────────────────
export function setTheme(name) {
    const t = THEMES[name];
    if (!t) return;
    _currentTheme = name;

    // 1. CSS variables (cubre todos los selectores de CSS)
    document.documentElement.setAttribute('data-theme', name);

    // 2. Paleta del canvas
    Object.assign(window.CANVAS_THEME, t.canvas);

    // 3. Patches de inline styles
    const p = t.inline;
    const appMenu = document.getElementById('appMenu');
    if (appMenu) {
        appMenu.style.background   = p.appMenu.background;
        appMenu.style.borderColor  = p.appMenu.borderColor;
    }
    const helpModal = document.querySelector('#helpModal > div');
    if (helpModal) {
        helpModal.style.background = p.helpModal.background;
        helpModal.style.borderColor= p.helpModal.borderColor;
    }
    const helpHeader = document.querySelector('#helpModal .help-header');
    if (helpHeader) {
        helpHeader.style.background = p.helpHeader.background;
        helpHeader.style.borderColor= p.helpHeader.borderColor;
    }
    document.querySelectorAll('.motor-map-panel').forEach(el => {
        el.style.background  = p.motorPanel.background;
        el.style.borderColor = p.motorPanel.borderColor;
    });

    // 4. Actualizar botón del menú
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.textContent = name === 'dark' ? THEMES.light.label : THEMES.dark.label;

    // 5. Persistir
    try { localStorage.setItem('midiGrid_theme', name); } catch (_) {}

    // 6. Redibujar canvas con la nueva paleta
    drawPianoRollWithPlayhead(state.pasoActual !== undefined ? state.pasoActual : -1);
    drawTimelineRuler();
    drawNoteLabels();
}

export function toggleTheme() {
    setTheme(_currentTheme === 'dark' ? 'light' : 'dark');
}

// ── Inicializar al cargar ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    let saved = 'light';
    try { saved = localStorage.getItem('midiGrid_theme') || 'light'; } catch (_) {}
    setTheme(saved);
});
