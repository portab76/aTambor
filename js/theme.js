// ============================================================
// theme.js — Sistema de temas claro / oscuro
// ============================================================

const THEMES = {
    dark: {
        // Paleta CSS (se aplica como data-theme en <html>)
        name: 'dark',
        label: '🌙 Oscuro',

        // Colores del canvas (leídos por piano-roll.js y timeline-ruler.js)
        canvas: {
            bg:       '#252530',
            rowAlt:   '#1e1e28',
            grid:     '#3a3a50',
            gridBar:  '#555555',
            label:    '#666666',
            playhead: 'rgba(255,230,0,0.9)',
        },

        // Patches de inline styles que CSS variables no pueden alcanzar
        inline: {
            appMenu:      { background: '#1a1a30', borderColor: '#3a3a5a' },
            helpModal:    { background: '#1e1e32', borderColor: '#5a5aaa' },
            helpHeader:   { background: '#2a2a48', borderColor: '#3a3a5a' },
            motorPanel:   { background: '#13132a', borderColor: '#33335a' },
            motorToggle:  { background: '#1a1a30', borderColor: '#33335a', color: '#7777aa' },
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
        },

        inline: {
            appMenu:      { background: '#f5f6ff', borderColor: '#b0b4d0' },
            helpModal:    { background: '#f0f2fa', borderColor: '#9090cc' },
            helpHeader:   { background: '#e4e6f8', borderColor: '#b0b4d0' },
            motorPanel:   { background: '#eaecf8', borderColor: '#b8bcd8' },
            motorToggle:  { background: '#e0e2f0', borderColor: '#b8bcd8', color: '#5566aa' },
        },
    },
};

// Paleta viva — el canvas la lee en cada redraw
window.CANVAS_THEME = { ...THEMES.dark.canvas };

let _currentTheme = 'dark';

// ── Aplicar tema ─────────────────────────────────────────────
function setTheme(name) {
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
    document.querySelectorAll('.motor-map-toggle').forEach(el => {
        el.style.background  = p.motorToggle.background;
        el.style.borderColor = p.motorToggle.borderColor;
        el.style.color       = p.motorToggle.color;
    });

    // 4. Actualizar botón del menú
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.textContent = name === 'dark' ? THEMES.light.label : THEMES.dark.label;

    // 5. Persistir
    try { localStorage.setItem('midiGrid_theme', name); } catch (_) {}

    // 6. Redibujar canvas con la nueva paleta
    if (typeof drawPianoRollWithPlayhead === 'function') {
        drawPianoRollWithPlayhead(typeof pasoActual !== 'undefined' ? pasoActual : -1);
    }
    if (typeof drawTimelineRuler === 'function') drawTimelineRuler();
    if (typeof drawNoteLabels === 'function') drawNoteLabels();
}

function toggleTheme() {
    setTheme(_currentTheme === 'dark' ? 'light' : 'dark');
}

// ── Inicializar al cargar ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    let saved = 'dark';
    try { saved = localStorage.getItem('midiGrid_theme') || 'dark'; } catch (_) {}
    setTheme(saved);
});
