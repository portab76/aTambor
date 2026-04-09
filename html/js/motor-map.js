// ============================================================
// motor-map.js — Mapeo MIDI note → motor físico ESP32
// Depende de: nada (módulo autónomo)
//
// API pública:
//   MOTOR_MAP            — array de configuración (editable en runtime)
//   motorForNote(midi)   — devuelve config del motor o null
//   motorMapUI()         — abre/cierra el panel visual de edición
//
// Estructura de cada entrada:
//   { note, name, motor, homePwm, vel, inverted }
//
//   note     — número de nota MIDI (0-127)
//   name     — nombre legible ("C4", "D#3"...)
//   motor    — índice global del motor en el ESP32 (0-127)
//   homePwm  — posición de reposo del servo (150-600, neutro=375)
//   vel      — velocidad del golpe (1-100)
//   inverted — invertir dirección del golpe (bool)
//
// MOTOR_MAP es el único lugar que hay que editar para cambiar
// qué notas MIDI controlan qué solenoides físicos.
// Routing firmware: chip = motor/16,  canal = motor%16
// ============================================================

// ── Tabla de conversión nombre de nota → número MIDI ──────────
// MIDI: C-1=0, C0=12, C1=24, C2=36, C3=48, C4=60, C5=72 ...
// Convención aTambor: octava 1 = MIDI 24 (C1)
const _NOTE_SEMITONES = { C:0, 'C#':1, 'Db':1, D:2, 'D#':3, 'Eb':3,
                           E:4, F:5, 'F#':6, 'Gb':6, G:7, 'G#':8,
                           'Ab':8, A:9, 'A#':10, 'Bb':10, B:11 };

function _midiNote(noteName, octave) {
    // MIDI C(-1)=0  →  C(oct) = (oct+1)*12 + semitono
    const semi = _NOTE_SEMITONES[noteName];
    if (semi === undefined) return null;
    return (octave + 1) * 12 + semi;
}

// ── E1 — MOTOR_MAP ────────────────────────────────────────────
// Adaptación directa de DEFAULT_KEYS (script.js).
// Valores por defecto: homePwm=375 (neutro), vel=60, inverted=false.
// Editar aquí o en tiempo real desde motorMapUI().
let MOTOR_MAP = [

  /*/ ── PCA 0  (motores 0-11)  →  C1–B1  (MIDI 36–47) ──────────
  { note: _midiNote('C',   1), name: 'C1',  motor: 0,  homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('C#',  1), name: 'C#1', motor: 1,  homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('D',   1), name: 'D1',  motor: 2,  homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('D#',  1), name: 'D#1', motor: 3,  homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('E',   1), name: 'E1',  motor: 4,  homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('F',   1), name: 'F1',  motor: 5,  homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('F#',  1), name: 'F#1', motor: 6,  homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('G',   1), name: 'G1',  motor: 7,  homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('G#',  1), name: 'G#1', motor: 8,  homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('A',   1), name: 'A1',  motor: 9,  homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('A#',  1), name: 'A#1', motor: 10, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('B',   1), name: 'B1',  motor: 11, homePwm: 375, vel: 60, inverted: false },

  // ── PCA 1  (motores 16-27)  →  C2–B2  (MIDI 48–59) ─────────
  { note: _midiNote('C',   2), name: 'C2',  motor: 16, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('C#',  2), name: 'C#2', motor: 17, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('D',   2), name: 'D2',  motor: 18, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('D#',  2), name: 'D#2', motor: 19, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('E',   2), name: 'E2',  motor: 20, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('F',   2), name: 'F2',  motor: 21, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('F#',  2), name: 'F#2', motor: 22, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('G',   2), name: 'G2',  motor: 23, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('G#',  2), name: 'G#2', motor: 24, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('A',   2), name: 'A2',  motor: 25, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('A#',  2), name: 'A#2', motor: 26, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('B',   2), name: 'B2',  motor: 27, homePwm: 375, vel: 60, inverted: false },

  // ── PCA 2  (motores 32-43)  →  C3–B3  (MIDI 60–71) ─────────*/
  { note: _midiNote('C',   3), name: 'C3',  motor: 0, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('C#',  3), name: 'C#3', motor: 1, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('D',   3), name: 'D3',  motor: 2, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('D#',  3), name: 'D#3', motor: 3, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('E',   3), name: 'E3',  motor: 4, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('F',   3), name: 'F3',  motor: 5, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('F#',  3), name: 'F#3', motor: 6, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('G',   3), name: 'G3',  motor: 7, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('G#',  3), name: 'G#3', motor: 8, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('A',   3), name: 'A3',  motor: 9, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('A#',  3), name: 'A#3', motor: 10, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('B',   3), name: 'B3',  motor: 11, homePwm: 375, vel: 60, inverted: false },
/*
12
13
14
15
*/
  // ── PCA 3  (motores 48-59)  →  C4–B4  (MIDI 72–83) ─────────
  { note: _midiNote('C',   4), name: 'C4',  motor: 16, homePwm: 375, vel: 60, inverted: false },
 // { note: _midiNote('C#',  4), name: 'C#4', motor: 17, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('D',   4), name: 'D4',  motor: 18, homePwm: 375, vel: 60, inverted: false },
 // { note: _midiNote('D#',  4), name: 'D#4', motor: 19, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('E',   4), name: 'E4',  motor: 20, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('F',   4), name: 'F4',  motor: 21, homePwm: 375, vel: 60, inverted: false },
  //{ note: _midiNote('F#',  4), name: 'F#4', motor: 22, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('G',   4), name: 'G4',  motor: 23, homePwm: 375, vel: 60, inverted: false },
  //{ note: _midiNote('G#',  4), name: 'G#4', motor: 24, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('A',   4), name: 'A4',  motor: 25, homePwm: 375, vel: 60, inverted: false },
  /*{ note: _midiNote('A#',  4), name: 'A#4', motor: 26, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('B',   4), name: 'B4',  motor: 27, homePwm: 375, vel: 60, inverted: false },

  // ── PCA 4  (motores 64-75)  →  C5–B5  (MIDI 84–95) ─────────
  { note: _midiNote('C',   5), name: 'C5',  motor: 64, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('C#',  5), name: 'C#5', motor: 65, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('D',   5), name: 'D5',  motor: 66, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('D#',  5), name: 'D#5', motor: 67, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('E',   5), name: 'E5',  motor: 68, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('F',   5), name: 'F5',  motor: 69, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('F#',  5), name: 'F#5', motor: 70, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('G',   5), name: 'G5',  motor: 71, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('G#',  5), name: 'G#5', motor: 72, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('A',   5), name: 'A5',  motor: 73, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('A#',  5), name: 'A#5', motor: 74, homePwm: 375, vel: 60, inverted: false },
  { note: _midiNote('B',   5), name: 'B5',  motor: 75, homePwm: 375, vel: 60, inverted: false },*/
];

// ── Persistencia en localStorage ─────────────────────────────
const _MM_STORAGE_KEY = 'aTambor_motorMap';

// Cargar configuración guardada al arrancar (sobreescribe los defaults)
(function _mmLoadFromStorage() {
    try {
        const saved = localStorage.getItem(_MM_STORAGE_KEY);
        if (!saved) return;
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed) || parsed.length === 0) return;
        // Restaurar solo los campos editables — mantener note/name del default
        parsed.forEach(saved => {
            const entry = MOTOR_MAP.find(m => m.note === saved.note);
            if (!entry) return;
            if (saved.motor   !== undefined) entry.motor   = saved.motor;
            if (saved.homePwm !== undefined) entry.homePwm = saved.homePwm;
            if (saved.vel     !== undefined) entry.vel     = saved.vel;
            if (saved.inverted !== undefined) entry.inverted = saved.inverted;
        });
        console.log('[motor-map] Configuración restaurada desde localStorage');
    } catch(e) {
        console.warn('[motor-map] Error al cargar desde localStorage:', e);
    }
})();

// Guardar MOTOR_MAP completo en localStorage
function _mmSaveToStorage() {
    try {
        localStorage.setItem(_MM_STORAGE_KEY, JSON.stringify(MOTOR_MAP));
    } catch(e) {
        console.warn('[motor-map] Error al guardar en localStorage:', e);
    }
}

// Exportar configuración como archivo JSON descargable
function motorMapExport() {
    const json = JSON.stringify(MOTOR_MAP, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'motorMap.json';
    a.click();
    URL.revokeObjectURL(url);
}

// Importar configuración desde archivo JSON
function motorMapImport() {
    const input = document.createElement('input');
    input.type  = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const parsed = JSON.parse(ev.target.result);
                if (!Array.isArray(parsed)) throw new Error('Formato inválido');
                parsed.forEach(saved => {
                    const entry = MOTOR_MAP.find(m => m.note === saved.note);
                    if (!entry) return;
                    if (saved.motor    !== undefined) entry.motor    = saved.motor;
                    if (saved.homePwm  !== undefined) entry.homePwm  = saved.homePwm;
                    if (saved.vel      !== undefined) entry.vel      = saved.vel;
                    if (saved.inverted !== undefined) entry.inverted = saved.inverted;
                });
                _mmSaveToStorage();
                _renderMotorMapRows();
                _renderMotorMapPanelRows();
                console.log('[motor-map] Configuración importada desde archivo');
            } catch(err) {
                alert('Error al importar: ' + err.message);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// ── E2 — motorForNote ─────────────────────────────────────────
// Devuelve la configuración del motor para una nota MIDI dada,
// o null si esa nota no está mapeada a ningún motor físico.
function motorForNote(midiNote) {
    return MOTOR_MAP.find(m => m.note === midiNote) ?? null;
}

// ── E3 — motorMapUI ───────────────────────────────────────────
// Abre/cierra el panel de edición del mapeo.
// Cada fila muestra: nota MIDI | nombre | motor# | homePwm | vel | invertido
// Los campos son editables en tiempo real — los cambios se aplican
// inmediatamente en MOTOR_MAP sin recargar la página.

function motorMapUI() {
    const PANEL_ID = 'motorMapPanel';
    const existing = document.getElementById(PANEL_ID);
    if (existing) { existing.remove(); return; }

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = `
        position: fixed; top: 50%; left: 50%; z-index: 9998;
        transform: translate(-50%, -50%);
        background: #1a1a2e; border: 1px solid #5a5aaa;
        border-radius: 8px; box-shadow: 0 8px 32px #00000099;
        width: 680px; max-height: 80vh;
        display: flex; flex-direction: column;
        font-family: 'Segoe UI', monospace; font-size: 12px; color: #ddd;
    `;

    // ── Header ──
    panel.innerHTML = `
        <div style="background:#2a2a48;padding:10px 14px;border-radius:8px 8px 0 0;
                    display:flex;align-items:center;justify-content:space-between;
                    border-bottom:1px solid #3a3a5a;flex-shrink:0;">
            <span style="font-size:14px;font-weight:bold;color:#fff;">
                Motor Map — MIDI note → ESP32 motor
            </span>
            <div style="display:flex;gap:8px;align-items:center;">
                <button id="mmTestBtn"
                    style="background:#1a5f3a;border:1px solid #2a8a5a;color:#aaffcc;
                           border-radius:4px;padding:3px 10px;cursor:pointer;font-size:11px;">
                    Test motor activo
                </button>
                <button onclick="motorMapExport()"
                    style="background:#2a3a5a;border:1px solid #3a5a8a;color:#aaccff;
                           border-radius:4px;padding:3px 10px;cursor:pointer;font-size:11px;"
                    title="Exportar configuración a JSON">
                    ⬇ Export
                </button>
                <button onclick="motorMapImport()"
                    style="background:#2a3a5a;border:1px solid #3a5a8a;color:#aaccff;
                           border-radius:4px;padding:3px 10px;cursor:pointer;font-size:11px;"
                    title="Importar configuración desde JSON">
                    ⬆ Import
                </button>
                <button onclick="document.getElementById('${PANEL_ID}').remove()"
                    style="background:none;border:none;color:#888;font-size:16px;cursor:pointer;
                           padding:2px 6px;border-radius:4px;">✕</button>
            </div>
        </div>`;

    // ── Tabla ──
    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'overflow-y:auto;flex:1;padding:8px 14px;';

    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;';
    table.innerHTML = `
        <thead>
            <tr style="color:#7777aa;font-size:11px;text-transform:uppercase;
                       letter-spacing:.5px;border-bottom:1px solid #3a3a5a;">
                <th style="padding:4px 6px;text-align:left;">MIDI</th>
                <th style="padding:4px 6px;text-align:left;">Nota</th>
                <th style="padding:4px 6px;text-align:left;">Motor</th>
                <th style="padding:4px 6px;text-align:left;">HomePWM</th>
                <th style="padding:4px 6px;text-align:left;">Vel</th>
                <th style="padding:4px 6px;text-align:left;">Inv</th>
                <th style="padding:4px 6px;text-align:left;">PCA/ch</th>
            </tr>
        </thead>
        <tbody id="motorMapTbody"></tbody>`;
    tableWrap.appendChild(table);
    panel.appendChild(tableWrap);
    document.body.appendChild(panel);

    _renderMotorMapRows();

    // Test: enviar un golpe al motor seleccionado (resaltado en la tabla)
    document.getElementById('mmTestBtn').addEventListener('click', () => {
        if (_mmSelectedIdx === null) return;
        const m = MOTOR_MAP[_mmSelectedIdx];
        const hit  = 80;
        const gap  = 150;
        const cmd  = `e; m ${m.motor}; o ${m.homePwm}; t ${hit}; v ${m.vel}; t ${gap}; v 0; p;`;
        if (typeof sendCommand === 'function') sendCommand(cmd);
    });
}

let _mmSelectedIdx = null;

function _renderMotorMapRows() {
    const tbody = document.getElementById('motorMapTbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    MOTOR_MAP.forEach((m, i) => {
        const tr = document.createElement('tr');
        tr.style.cssText = `border-bottom:1px solid #2a2a3a;cursor:pointer;
                            ${_mmSelectedIdx === i ? 'background:#2a2a50;' : ''}`;
        tr.addEventListener('click', () => {
            _mmSelectedIdx = i;
            _renderMotorMapRows();
        });

        const pca = Math.floor(m.motor / 16);
        const ch  = m.motor % 16;

        tr.innerHTML = `
            <td style="padding:3px 6px;color:#aaaadd;">${m.note}</td>
            <td style="padding:3px 6px;font-weight:bold;color:#ddeeff;">${m.name}</td>
            <td style="padding:3px 6px;">${_editCell(i, 'motor',   m.motor,   0, 127)}</td>
            <td style="padding:3px 6px;">${_editCell(i, 'homePwm', m.homePwm, 150, 600)}</td>
            <td style="padding:3px 6px;">${_editCell(i, 'vel',     m.vel,     1, 100)}</td>
            <td style="padding:3px 6px;text-align:center;">
                <input type="checkbox" ${m.inverted ? 'checked' : ''}
                    onchange="MOTOR_MAP[${i}].inverted=this.checked"
                    style="cursor:pointer;">
            </td>
            <td style="padding:3px 6px;color:#666;font-size:11px;">PCA${pca}/ch${ch}</td>`;
        tbody.appendChild(tr);
    });
}

function _editCell(idx, field, value, min, max) {
    return `<input type="number" value="${value}" min="${min}" max="${max}"
                style="width:56px;background:#0e0e1e;color:#eee;border:1px solid #3a3a5a;
                       border-radius:3px;padding:1px 4px;font-size:11px;"
                onchange="MOTOR_MAP[${idx}].${field}=parseInt(this.value);
                          _mmSaveToStorage();
                          document.getElementById('motorMapTbody') && _renderMotorMapRows();
                          _renderMotorMapPanelRows();"
                onclick="event.stopPropagation();">`;
}

// ============================================================
// Panel colapsable integrado en midiGrid.html (I3)
// ============================================================

let _mmPanelSelectedIdx = null;

function toggleMotorMapPanel() {
    const panel  = document.getElementById('motorMapPanel');
    const toggle = document.getElementById('motorMapToggle');
    if (!panel || !toggle) return;
    const isOpen = panel.classList.toggle('open');
    toggle.classList.toggle('open', isOpen);
    if (isOpen) _renderMotorMapPanelRows();
}

// ── Colores arcoíris por octava ───────────────────────────────
const _MM_OCT_COLORS = {
    1: { bg: '#1a0505', border: '#8b1a1a', text: '#ff6666', stripe: '#6b0000' },
    2: { bg: '#1a0e05', border: '#8b4a1a', text: '#ff9944', stripe: '#7a3000' },
    3: { bg: '#1a1a05', border: '#7a7a1a', text: '#dddd44', stripe: '#5a5a00' },
    4: { bg: '#051a05', border: '#1a6a1a', text: '#44dd44', stripe: '#0a4a0a' },
    5: { bg: '#050e1a', border: '#1a4a8b', text: '#4488ff', stripe: '#0a2a6a' },
    6: { bg: '#0e051a', border: '#4a1a8b', text: '#bb66ff', stripe: '#3a0a6a' },
};

function _mmOctaveColor(midiNote) {
    const oct = Math.max(1, Math.min(6, Math.floor(midiNote / 12) - 1));
    return _MM_OCT_COLORS[oct] || _MM_OCT_COLORS[4];
}

// ── Teclado miniatura ─────────────────────────────────────────
function _renderMiniKeyboard() {
    const canvas = document.getElementById('mmMiniKeyboard');
    if (!canvas) return;

    const mappedNotes = new Set(MOTOR_MAP.map(m => m.note));

    // Rango: desde la nota más grave a la más aguda del MOTOR_MAP
    const allNotes = MOTOR_MAP.map(m => m.note);
    if (allNotes.length === 0) return;
    const minNote = Math.min(...allNotes);
    const maxNote = Math.max(...allNotes);

    // Calcular notas blancas en el rango para dimensionar el canvas
    const BLACK_SEMITONES = new Set([1, 3, 6, 8, 10]);
    const whiteNotes = [];
    for (let n = minNote; n <= maxNote; n++) {
        if (!BLACK_SEMITONES.has(n % 12)) whiteNotes.push(n);
    }

    const W = canvas.parentElement.clientWidth || 600;
    const keyW = Math.max(8, Math.floor(W / whiteNotes.length));
    const keyH = 48;
    const blackH = 28;
    const blackW = Math.max(5, Math.floor(keyW * 0.6));

    canvas.width  = whiteNotes.length * keyW;
    canvas.height = keyH;
    canvas.style.width  = '100%';
    canvas.style.height = keyH + 'px';

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Mapa nota → posición X de la tecla blanca
    const whiteX = {};
    whiteNotes.forEach((n, i) => { whiteX[n] = i * keyW; });

    // Dibujar teclas blancas
    whiteNotes.forEach((n) => {
        const x   = whiteX[n];
        const col = _mmOctaveColor(n);
        const mapped = mappedNotes.has(n);

        ctx.fillStyle   = mapped ? col.bg.replace('05', '18').replace('0a', '22') : '#0e0e1e';
        ctx.strokeStyle = mapped ? col.border : '#2a2a4a';
        ctx.lineWidth   = 1;
        ctx.fillRect(x + 1, 0, keyW - 2, keyH);
        ctx.strokeRect(x + 1, 0, keyW - 2, keyH);

        if (mapped) {
            // Franja de color en la parte inferior
            ctx.fillStyle = col.border;
            ctx.fillRect(x + 2, keyH - 6, keyW - 4, 5);
        }

        // Etiqueta C en cada Do
        if (n % 12 === 0 && keyW >= 10) {
            const oct = Math.floor(n / 12) - 1;
            ctx.fillStyle   = mapped ? col.text : '#444';
            ctx.font        = `bold ${Math.min(9, keyW - 2)}px monospace`;
            ctx.textAlign   = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(`C${oct}`, x + keyW / 2, keyH - 7);
        }
    });

    // Dibujar teclas negras encima
    for (let n = minNote; n <= maxNote; n++) {
        if (!BLACK_SEMITONES.has(n % 12)) continue;
        // Encontrar tecla blanca anterior
        let prevWhite = n - 1;
        while (BLACK_SEMITONES.has(prevWhite % 12)) prevWhite--;
        if (whiteX[prevWhite] === undefined) continue;

        const x      = whiteX[prevWhite] + keyW - Math.floor(blackW / 2);
        const col    = _mmOctaveColor(n);
        const mapped = mappedNotes.has(n);

        ctx.fillStyle   = mapped ? col.stripe : '#111';
        ctx.strokeStyle = mapped ? col.border : '#333';
        ctx.lineWidth   = 1;
        ctx.fillRect(x, 0, blackW, blackH);
        ctx.strokeRect(x, 0, blackW, blackH);

        if (mapped) {
            ctx.fillStyle = col.text;
            ctx.fillRect(x + 2, blackH - 5, blackW - 4, 4);
        }
    }

    // Guardar layout para hit-test en eventos de ratón
    canvas._whiteNotes  = whiteNotes;
    canvas._whiteX      = whiteX;
    canvas._keyW        = keyW;
    canvas._keyH        = keyH;
    canvas._blackW      = blackW;
    canvas._blackH      = blackH;
    canvas._minNote     = minNote;
    canvas._maxNote     = maxNote;

    // Registrar eventos solo una vez
    if (!canvas._eventsRegistered) {
        canvas._eventsRegistered = true;

        canvas.addEventListener('mousemove', (e) => {
            const note = _mmNoteFromMouseEvent(canvas, e);
            if (note === canvas._hoverNote) return;
            canvas._hoverNote = note;

            // Glissando: si el botón está pulsado y la nota cambió → disparar
            if (canvas._pressing && note !== null && note !== canvas._lastPlayedNote) {
                _mmFireNote(canvas, note);
            }

            _renderMiniKeyboard();
            if (note !== null) _mmHighlightKey(note, true);
        });

        canvas.addEventListener('mouseleave', () => {
            canvas._hoverNote = null;
            canvas._pressing  = false;
            _renderMiniKeyboard();
        });

        canvas.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const note = _mmNoteFromMouseEvent(canvas, e);
            if (note === null) return;
            canvas._pressing = true;
            _mmFireNote(canvas, note);
            _mmHighlightKey(note, true);
        });

        canvas.addEventListener('mouseup', () => {
            canvas._pressing      = false;
            canvas._lastPlayedNote = null;
            _renderMiniKeyboard();
        });
    }
}

// ── Render de filas con color por octava ─────────────────────
function _renderMotorMapPanelRows() {
    const tbody = document.getElementById('motorMapPanelTbody');
    if (!tbody) return;

    const summary = document.getElementById('motorMapSummary');
    if (summary) summary.textContent = `${MOTOR_MAP.length} motores mapeados`;

    tbody.innerHTML = '';
    MOTOR_MAP.forEach((m, i) => {
        const tr  = document.createElement('tr');
        const pca = Math.floor(m.motor / 16);
        const ch  = m.motor % 16;
        const sel = _mmPanelSelectedIdx === i;
        const col = _mmOctaveColor(m.note);

        tr.style.cursor     = 'pointer';
        tr.style.borderLeft = `3px solid ${col.border}`;
        tr.style.background = sel ? col.bg.replace('05','20').replace('0a','28') : col.bg;

        if (sel) tr.classList.add('mm-selected');

        tr.addEventListener('click', () => {
            _mmPanelSelectedIdx = i;
            _renderMotorMapPanelRows();
            _renderMiniKeyboard();
        });
        tr.addEventListener('mouseenter', () => {
            tr.style.background = col.bg.replace('05','15').replace('0a','22');
            _mmHighlightKey(m.note, true);
        });
        tr.addEventListener('mouseleave', () => {
            tr.style.background = sel ? col.bg.replace('05','20').replace('0a','28') : col.bg;
            _mmHighlightKey(m.note, false);
        });

        tr.innerHTML = `
            <td style="color:${col.text};font-size:11px;">${m.note}</td>
            <td style="font-weight:bold;color:${col.text};">${m.name}</td>
            <td><input class="mm-input" type="number" value="${m.motor}" min="0" max="127"
                onchange="MOTOR_MAP[${i}].motor=parseInt(this.value);_mmSaveToStorage();_renderMotorMapPanelRows();"
                onclick="event.stopPropagation();"></td>
            <td><input class="mm-input" type="number" value="${m.homePwm}" min="150" max="600"
                onchange="MOTOR_MAP[${i}].homePwm=parseInt(this.value);_mmSaveToStorage();_renderMotorMapPanelRows();"
                onclick="event.stopPropagation();"></td>
            <td><input class="mm-input" type="number" value="${m.vel}" min="1" max="100"
                onchange="MOTOR_MAP[${i}].vel=parseInt(this.value);_mmSaveToStorage();_renderMotorMapPanelRows();"
                onclick="event.stopPropagation();"></td>
            <td style="text-align:center;">
                <input type="checkbox" ${m.inverted ? 'checked' : ''}
                    onchange="MOTOR_MAP[${i}].inverted=this.checked;_mmSaveToStorage();"
                    onclick="event.stopPropagation();" style="cursor:pointer;">
            </td>
            <td style="color:${col.border};font-size:10px;">PCA${pca}/ch${ch}</td>`;
        tbody.appendChild(tr);
    });

    _renderMiniKeyboard();
}

function _mmFireNote(canvas, note) {
    canvas._lastPlayedNote = note;

    // 1. Sonido MIDI virtual
    if (typeof MIDI !== 'undefined' && MIDI.noteOn) {
        MIDI.noteOff(0, note, 0);   // cortar nota anterior si sigue sonando
        MIDI.noteOn(0, note, 90, 0);
        setTimeout(() => MIDI.noteOff(0, note, 0), 250);
    }

    // 2. Motor ESP32 (solo si tiene motor asignado)
    const entry = MOTOR_MAP.find(m => m.note === note);
    if (entry && typeof sendCommand === 'function') {
        const cmd = `e; m ${entry.motor}; o ${entry.homePwm}; t 80; v ${entry.vel}; t 150; v 0; p;`;
        sendCommand(cmd);
    }

    // 3. Seleccionar fila en la tabla
    const idx = MOTOR_MAP.findIndex(m => m.note === note);
    if (idx >= 0) {
        _mmPanelSelectedIdx = idx;
        // Actualizar tabla sin re-renderizar el teclado (evita parpadeo durante glissando)
        document.querySelectorAll('#motorMapPanelTbody tr').forEach((tr, i) => {
            tr.classList.toggle('mm-selected', i === idx);
        });
    }
}

function _mmNoteFromMouseEvent(canvas, e) {
    const rect  = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const x     = (e.clientX - rect.left) * scaleX;
    const y     = (e.clientY - rect.top)  * (canvas.height / rect.height);

    const BLACK_SEMITONES = new Set([1, 3, 6, 8, 10]);

    // Primero comprobar teclas negras (están encima)
    for (let n = canvas._minNote; n <= canvas._maxNote; n++) {
        if (!BLACK_SEMITONES.has(n % 12)) continue;
        let prevWhite = n - 1;
        while (BLACK_SEMITONES.has(prevWhite % 12)) prevWhite--;
        const bx = canvas._whiteX[prevWhite];
        if (bx === undefined) continue;
        const kx = bx + canvas._keyW - Math.floor(canvas._blackW / 2);
        if (x >= kx && x < kx + canvas._blackW && y < canvas._blackH) {
            return n;
        }
    }

    // Luego teclas blancas
    for (const n of canvas._whiteNotes) {
        const kx = canvas._whiteX[n];
        if (x >= kx && x < kx + canvas._keyW) return n;
    }

    return null;
}

function _mmHighlightKey(note, on) {
    const canvas = document.getElementById('mmMiniKeyboard');
    if (!canvas || !canvas._whiteNotes) return;
    // Re-render completo es suficientemente rápido para este tamaño
    _renderMiniKeyboard();
    if (!on) return;

    const BLACK_SEMITONES = new Set([1, 3, 6, 8, 10]);
    const ctx = canvas.getContext('2d');
    const col = _mmOctaveColor(note);
    const isBlack = BLACK_SEMITONES.has(note % 12);

    if (!isBlack) {
        const x = canvas._whiteX[note];
        if (x === undefined) return;
        ctx.fillStyle = col.text + '55';
        ctx.fillRect(x + 1, 0, canvas._keyW - 2, canvas._keyH);
    } else {
        let prevWhite = note - 1;
        while (BLACK_SEMITONES.has(prevWhite % 12)) prevWhite--;
        const x = canvas._whiteX[prevWhite];
        if (x === undefined) return;
        const bx = x + canvas._keyW - Math.floor(canvas._blackW / 2);
        ctx.fillStyle = col.text + '66';
        ctx.fillRect(bx, 0, canvas._blackW, canvas._blackH);
    }
}

function _mmPanelTest() {
    if (_mmPanelSelectedIdx === null) {
        alert('Selecciona una fila de la tabla primero.');
        return;
    }
    const m   = MOTOR_MAP[_mmPanelSelectedIdx];
    const cmd = `e; m ${m.motor}; o ${m.homePwm}; t 80; v ${m.vel}; t 150; v 0; p;`;
    if (typeof sendCommand === 'function') sendCommand(cmd);
}
