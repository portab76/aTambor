// ============================================================
// chord-row.js — Renderizado de la fila de acordes + popup de info armónica
// Depende de: state.js, harmonic.js, piano-roll.js
// ============================================================

const _NOTE_NAMES_CR = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

// ─────────────────────────────────────────────
// Dibujo de la fila de bloques
// ─────────────────────────────────────────────

function drawChordRow(segments, key) {
    const container = document.getElementById('chordRowContainer');
    if (!container) return;
    container.innerHTML = '';

    if (!segments || segments.length === 0) {
        container.innerHTML = '<div style="padding:10px;color:#888;">No hay segmentos armónicos</div>';
        return;
    }

    container.style.width = `${totalSteps * stepWidth}px`;

    for (let i = 0; i < segments.length; i++) {
        const seg   = segments[i];
        const width = (seg.endStep - seg.startStep) * stepWidth;
        if (width <= 0) continue;

        let chordName, chordFunc, chord;
        if (seg.chordDisplay) {
            chordName = seg.chordDisplay;
            chordFunc = seg.chordFunction || "";
            chord     = seg.chord || null;
        } else {
            const noteClasses = [...new Set(seg.activeNotes.map(n => n % 12))].sort((a,b) => a-b);
            chord     = findChord(noteClasses, seg.activeNotes[0] || null);
            chordName = chord.name;
            chordFunc = key ? getChordFunction(chord, key) : "";
        }

        const bgColor = _chordFunctionColor(chordFunc);
        const block   = document.createElement('div');

        block.style.cssText = [
            `display:inline-block`,
            `width:${width - 1}px`,
            `height:50px`,
            `background:${bgColor}`,
            `border:1px solid #555`,
            `text-align:center`,
            `line-height:50px`,
            `color:white`,
            `font-size:${width < 50 ? '10px' : '13px'}`,
            `overflow:hidden`,
            `cursor:pointer`,
            `vertical-align:top`,
            `box-sizing:border-box`,
            `transition:filter .1s`,
        ].join(';');

        block.textContent   = chordName;
        block.dataset.idx   = i;
        block.dataset.start = seg.startStep;
        block.dataset.end   = seg.endStep;

        block.addEventListener('mouseenter', () => { block.style.filter = 'brightness(1.35)'; });
        block.addEventListener('mouseleave', () => { block.style.filter = ''; });
        block.addEventListener('click', (e) => {
            e.stopPropagation();
            onChordBlockClick(e, seg, chordName, chordFunc, chord, key);
        });

        container.appendChild(block);
    }
}

function _chordFunctionColor(fn) {
    if (!fn) return "#3a3a4a";
    if (fn.startsWith("Tónica"))       return "#1a5f7a";
    if (fn.startsWith("Dominante"))    return "#7a1a1a";
    if (fn.startsWith("Subdominante")) return "#1a6a3a";
    return "#4a4a6a";
}

// ─────────────────────────────────────────────
// Click: popup + resaltado en el grid
// ─────────────────────────────────────────────

function onChordBlockClick(event, segment, chordName, chordFunc, chord, key) {
    // Resaltar notas en el canvas
    const rootClass  = chord?.root ?? _NOTE_NAMES_CR.indexOf((chordName.match(/^[A-G][#]?/) || [])[0]);
    if (rootClass !== -1 && rootClass !== undefined) {
        const isMinor    = /m(?!aj)/.test(chordName.slice(1));
        const classes    = [rootClass, (rootClass + (isMinor ? 3 : 4)) % 12, (rootClass + 7) % 12];
        if (chordName.includes("maj7")) classes.push((rootClass + 11) % 12);
        else if (chordName.includes("7")) classes.push((rootClass + 10) % 12);
        drawPianoRollWithHighlight([...new Set(classes)]);
    }

    // Construir y mostrar el popup
    _showChordPopup(event, segment, chordName, chordFunc, chord, key);
}

// ─────────────────────────────────────────────
// Popup de información armónica
// ─────────────────────────────────────────────

function _showChordPopup(event, seg, chordName, chordFunc, chord, key) {
    // Eliminar popup anterior si existe
    const old = document.getElementById('chordInfoPopup');
    if (old) old.remove();

    // ── Calcular datos a mostrar ──────────────────────────────

    // Notas MIDI + nombres
    const noteNames = seg.activeNotes.map(n =>
        `${_NOTE_NAMES_CR[n % 12]}${Math.floor(n / 12) - 1} (${n})`
    );

    // Calidad del acorde en texto legible
    const qualityMap = {
        major:'Mayor', minor:'Menor', dominant7:'Dominante 7ª',
        major7:'Mayor 7ª (maj7)', minor7:'Menor 7ª', diminished:'Disminuido',
        augmented:'Aumentado', major6:'Mayor 6ª', minor6:'Menor 6ª',
        sus4:'Suspendido 4ª', sus2:'Suspendido 2ª', unknown:'Desconocido', none:'—'
    };
    const quality = qualityMap[chord?.quality] || chord?.quality || '?';

    // Tensiones
    const tensionNames = (chord?.tensions || []).map(i => {
        const map = {1:'b9',2:'9',3:'#9',5:'11',6:'#11',8:'b13',9:'13',10:'7',11:'maj7'};
        return map[i] || `+${i}st`;
    });

    // Inversión
    const invText = seg.inversion || (
        seg.activeNotes.length > 0 && chord?.root !== undefined
            ? detectInversion(seg.activeNotes, chord.root)
            : ''
    ) || 'Estado fundamental';

    // Grado romano
    const romanDegree = _romanDegree(chord, key);

    // Duración en pasos y compases
    const steps    = seg.endStep - seg.startStep;
    const measures = (steps / 16).toFixed(2);  // 16 semicorcheas = 1 compás 4/4

    // Escala relativa
    const scaleNotes = key ? _scaleNotes(key) : [];

    // Notas del acorde que están fuera de la escala (cromatismos)
    const outOfScale = chord?.root !== undefined
        ? seg.activeNotes.filter(n => !scaleNotes.includes(n % 12))
                         .map(n => _NOTE_NAMES_CR[n % 12])
        : [];

    // ── Construir HTML del popup ──────────────────────────────

    const popup = document.createElement('div');
    popup.id    = 'chordInfoPopup';
    popup.innerHTML = `
        <div class="cpop-header">
            <span class="cpop-chord">${chordName}</span>
            <span class="cpop-quality">${quality}</span>
            <button class="cpop-close" onclick="document.getElementById('chordInfoPopup').remove()">✕</button>
        </div>
        <div class="cpop-body">
            <div class="cpop-section">
                <div class="cpop-row"><span class="cpop-lbl">Grado</span>
                    <span class="cpop-val">${romanDegree} ${chordFunc ? '— ' + chordFunc : ''}</span></div>
                <div class="cpop-row"><span class="cpop-lbl">Inversión</span>
                    <span class="cpop-val">${invText}</span></div>
                <div class="cpop-row"><span class="cpop-lbl">Tonalidad</span>
                    <span class="cpop-val">${key ? key.tonic + ' ' + (key.mode === 'major' ? 'Mayor' : 'Menor') : '—'}</span></div>
                <div class="cpop-row"><span class="cpop-lbl">Tensiones</span>
                    <span class="cpop-val">${tensionNames.length ? tensionNames.join(', ') : 'Ninguna'}</span></div>
            </div>
            <div class="cpop-section">
                <div class="cpop-row"><span class="cpop-lbl">Duración</span>
                    <span class="cpop-val">${steps} pasos · ${measures} compases</span></div>
                <div class="cpop-row"><span class="cpop-lbl">Posición</span>
                    <span class="cpop-val">Paso ${seg.startStep} → ${seg.endStep}</span></div>
                <div class="cpop-row"><span class="cpop-lbl">Notas fuera de escala</span>
                    <span class="cpop-val ${outOfScale.length ? 'cpop-warn' : ''}">${outOfScale.length ? outOfScale.join(', ') : '—'}</span></div>
            </div>
            <div class="cpop-section">
                <div class="cpop-lbl" style="margin-bottom:4px">Notas sonando (${seg.activeNotes.length})</div>
                <div class="cpop-notes">${seg.activeNotes.map((midi, i) =>
                    `<span class="cpop-note" data-midi="${midi}" title="Click: nota · Shift+Click: acorde completo">${noteNames[i]}</span>`
                ).join('')}</div>
            </div>
        </div>
    `;

    // ── Estilos inline (sin necesidad de CSS externo) ─────────
    popup.style.cssText = `
        position: fixed;
        z-index: 9999;
        background: #1e1e32;
        border: 1px solid #5a5aaa;
        border-radius: 8px;
        box-shadow: 0 8px 32px #00000088;
        width: 320px;
        font-family: 'Segoe UI', sans-serif;
        font-size: 13px;
        color: #ddd;
        user-select: none;
    `;

    // Estilos de los sub-elementos
    const style = document.createElement('style');
    style.textContent = `
        #chordInfoPopup .cpop-header {
            display: flex; align-items: center; gap: 8px;
            background: #2a2a48; padding: 10px 14px;
            border-radius: 8px 8px 0 0; border-bottom: 1px solid #3a3a5a;
        }
        #chordInfoPopup .cpop-chord  { font-size: 20px; font-weight: bold; color: #fff; }
        #chordInfoPopup .cpop-quality{ font-size: 12px; color: #aaaadd; flex: 1; }
#chordInfoPopup .cpop-close  {
            background: none; border: none; color: #888; font-size: 16px;
            cursor: pointer; padding: 2px 6px; border-radius: 4px;
        }
        #chordInfoPopup .cpop-close:hover { background: #aa3333; color: #fff; }
        #chordInfoPopup .cpop-body   { padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }
        #chordInfoPopup .cpop-section{ background: #25253a; border-radius: 5px; padding: 8px 10px; }
        #chordInfoPopup .cpop-row    { display: flex; justify-content: space-between; margin-bottom: 4px; }
        #chordInfoPopup .cpop-row:last-child { margin-bottom: 0; }
        #chordInfoPopup .cpop-lbl    { color: #7777aa; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
        #chordInfoPopup .cpop-val    { color: #ddeeff; font-size: 12px; text-align: right; max-width: 60%; }
        #chordInfoPopup .cpop-warn   { color: #ffaa44; }
        #chordInfoPopup .cpop-notes  { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
        #chordInfoPopup .cpop-note   {
            background: #333355; border: 1px solid #5555aa;
            border-radius: 4px; padding: 2px 7px; font-size: 11px;
            font-family: monospace; color: #aaddff;
            cursor: pointer; transition: background .1s, transform .08s;
        }
        #chordInfoPopup .cpop-note:hover  { background: #4a4a88; border-color: #8888cc; }
        #chordInfoPopup .cpop-note.ringing { background: #5a5aaa; transform: scale(1.1); }
    `;
    popup.prepend(style);

    document.body.appendChild(popup);

    // ── Botón de reproducción del acorde ──────────────────────
    // ── Chips de notas: click = nota sola / Shift+click = acorde completo ──
    popup.querySelectorAll('.cpop-note').forEach(chip => {
        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            if (e.shiftKey) {
                // Shift+click → todas las notas del segmento a la vez
                _playNotes(seg.activeNotes, popup.querySelectorAll('.cpop-note'));
            } else {
                // Click simple → solo esta nota
                const midi = parseInt(chip.dataset.midi);
                _playNotes([midi], [chip]);
            }
        });
    });

    // ── Posicionar cerca del click sin salirse de la pantalla ──
    const pw = 320, ph = 320;
    let x = event.clientX + 12;
    let y = event.clientY + 12;
    if (x + pw > window.innerWidth)  x = event.clientX - pw - 12;
    if (y + ph > window.innerHeight) y = event.clientY - ph - 12;
    popup.style.left = `${x}px`;
    popup.style.top  = `${y}px`;

    // Cerrar al hacer clic fuera
    setTimeout(() => {
        document.addEventListener('click', function _close(e) {
            if (!popup.contains(e.target)) {
                popup.remove();
                document.removeEventListener('click', _close);
            }
        });
    }, 50);
}

// ─────────────────────────────────────────────
// Helpers armónicos para el popup
// ─────────────────────────────────────────────

function _romanDegree(chord, key) {
    if (!chord || chord.root === null || !key) return '?';
    const degree = (chord.root - key.rootClass + 12) % 12;
    const DEGREES_MAJOR = { 0:'I', 2:'III', 4:'V', 5:'VI', 7:'VII', 3:'IV', 1:'II' };
    const DEGREES_MINOR = { 0:'i', 2:'III', 4:'v', 5:'VI', 7:'VII', 3:'iv', 1:'ii°' };
    const map = key.mode === 'major' ? DEGREES_MAJOR : DEGREES_MINOR;
    const roman = map[degree] || `(${degree}st)`;
    // Minúscula si es acorde menor
    const isMinorQuality = ['minor','minor7','diminished'].includes(chord.quality);
    return isMinorQuality ? roman.toLowerCase() : roman.toUpperCase();
}

/**
 * Toca un array de notas MIDI simultáneamente durante 1.2 segundos
 * y anima los chips correspondientes.
 * @param {Array<number>}      notes - Notas MIDI a sonar
 * @param {NodeList|Array}     chips - Elementos DOM a animar
 */
function _playNotes(notes, chips) {
    const DURATION_S = 1.2;

    // ── Audio MIDI virtual ─────────────────────────────────────
    if (soundfontLoaded && typeof MIDI !== 'undefined' && MIDI.noteOn) {
        notes.forEach(note => {
            MIDI.noteOn( 0, note, 90, 0);
            MIDI.noteOff(0, note, DURATION_S);
        });
    }

    // ── Motores ESP32 ──────────────────────────────────────────
    // Para cada nota buscar si hay un motor asignado en MOTOR_MAP
    // y enviar un golpe de prueba individual.
    if (typeof wsConnected !== 'undefined' && wsConnected &&
        typeof MOTOR_MAP !== 'undefined' && typeof sendCommand === 'function') {

        const hitMs     = 80;
        const retractMs = 150;

        notes.forEach(note => {
            const cfg = MOTOR_MAP.find(m => m.note === note);
            if (!cfg) return;
            const cmd = `e; m ${cfg.motor}; o ${cfg.homePwm}; t ${hitMs}; v ${cfg.vel}; t ${retractMs}; v 0; p;`;
            sendCommand(cmd);
        });
    }

    // ── Animar chips ───────────────────────────────────────────
    chips.forEach(chip => {
        chip.classList.add('ringing');
        setTimeout(() => chip.classList.remove('ringing'), DURATION_S * 1000);
    });
}

function _scaleNotes(key) {
    const MAJOR_INTERVALS = [0,2,4,5,7,9,11];
    const MINOR_INTERVALS = [0,2,3,5,7,8,10];
    const intervals = key.mode === 'major' ? MAJOR_INTERVALS : MINOR_INTERVALS;
    return intervals.map(i => (key.rootClass + i) % 12);
}
