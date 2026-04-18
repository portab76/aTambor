// ============================================================
// mml-parser.js — Convierte texto MML estándar al formato
// rawEvents de midiGrid (tick, type, channel, note, velocity)
// ============================================================
//
// Formato MML soportado:
//   MML@pista1,pista2,...   prefijo opcional, pistas separadas por coma
//   t<num>   tempo
//   v<num>   velocidad (0-127)
//   o<num>   octava (0-9)
//   l<num>[.] duración por defecto
//   >  octava arriba    <  octava abajo
//   [a-g][+#-][dur][.]   nota con sostenido/bemol, duración, puntillo
//   r[dur][.]             silencio
//   &[nota]               ligadura: extiende la duración de la nota anterior
//
// Conversión de duración con PPQN = 96 (negra = 96 ticks):
//   1  → 384 ticks  (redonda)
//   2  → 192 ticks  (blanca)
//   4  →  96 ticks  (negra)
//   8  →  48 ticks  (corchea)
//   16 →  24 ticks  (semicorchea)
//   32 →  12 ticks  (fusa)
//   Puntillo: × 1.5
//
// Cada pista MML → canal MIDI independiente (0, 1, 2…).
// El usuario elige qué pista visualizar en el piano roll.
// ============================================================

const MML_PPQN = 96;

const MML_SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

// ---- Duración MML → ticks --------------------------------
function mmlDurToTicks(dur, dotted) {
    const ticks = Math.round((4 / (dur || 4)) * MML_PPQN);
    return dotted ? Math.round(ticks * 1.5) : ticks;
}

// ---- Parser de una pista MML → eventos noteOn/noteOff ----
// Devuelve { events[], tempo, tempoChanges[], totalTicks }
function parseMMLTrackToEvents(src, channel) {
    const events = [];
    let i = 0;
    let tick = 0;
    let octave = 4, defaultDur = 4, defaultDot = false;
    let vel = 100, tempo = 120;
    const tempoChanges = [];

    // tieMap: midiNote → índice del evento noteOff en events[]
    // Permite extender la duración cuando aparece una ligadura (&)
    const tieMap = {};

    const readInt = () => {
        let s = '';
        while (i < src.length && /\d/.test(src[i])) s += src[i++];
        return s ? parseInt(s) : null;
    };

    while (i < src.length) {
        const ch = src[i].toLowerCase();

        if (/\s/.test(ch)) { i++; continue; }

        // Tempo: t<num>
        if (ch === 't') {
            i++;
            const v = readInt();
            if (v !== null) {
                tempo = v;
                tempoChanges.push({ tick, bpm: v });
            }
            continue;
        }

        // Volumen: v<num>  (0-127)
        if (ch === 'v') {
            i++;
            const v = readInt();
            if (v !== null) vel = Math.min(127, Math.max(1, v));
            continue;
        }

        // Octava: o<num>
        if (ch === 'o') {
            i++;
            const v = readInt();
            if (v !== null) octave = Math.max(0, Math.min(9, v));
            continue;
        }

        // Duración por defecto: l<num>[.]
        if (ch === 'l') {
            i++;
            const v = readInt();
            if (v !== null) defaultDur = v;
            defaultDot = (i < src.length && src[i] === '.') ? (i++, true) : false;
            continue;
        }

        // Octava arriba / abajo
        if (ch === '>') { octave = Math.min(9, octave + 1); i++; continue; }
        if (ch === '<') { octave = Math.max(0, octave - 1); i++; continue; }

        // Silencio: r[dur][.]
        if (ch === 'r') {
            i++;
            const durN   = readInt();
            const dot    = (i < src.length && src[i] === '.') ? (i++, true) : false;
            const dur    = durN !== null ? durN : defaultDur;
            const useDot = dot || (durN === null && defaultDot);
            tick += mmlDurToTicks(dur, useDot);
            continue;
        }

        // Ligadura: &<nota>
        // Extiende la duración del último noteOff de la misma nota
        if (ch === '&') {
            i++;
            const nc = i < src.length ? src[i].toLowerCase() : '';
            if (!MML_SEMI.hasOwnProperty(nc)) continue; // & sin nota a continuación
            i++;
            let semi = MML_SEMI[nc];
            if (i < src.length && (src[i] === '+' || src[i] === '#')) { semi++; i++; }
            else if (i < src.length && src[i] === '-') { semi--; i++; }
            const durN   = readInt();
            const dot    = (i < src.length && src[i] === '.') ? (i++, true) : false;
            const dur    = durN !== null ? durN : defaultDur;
            const useDot = dot || (durN === null && defaultDot);
            const addTk  = mmlDurToTicks(dur, useDot);
            const midi   = Math.max(0, Math.min(127, (octave + 1) * 12 + ((semi % 12 + 12) % 12)));
            // Retrasar el noteOff pendiente de esta nota
            if (tieMap[midi] !== undefined) {
                events[tieMap[midi]].tick += addTk;
            }
            tick += addTk;
            continue;
        }

        // Nota: [a-g][+#-][dur][.]
        if (MML_SEMI.hasOwnProperty(ch)) {
            i++;
            let semi = MML_SEMI[ch];
            if (i < src.length && (src[i] === '+' || src[i] === '#')) { semi++; i++; }
            else if (i < src.length && src[i] === '-') { semi--; i++; }

            const durN   = readInt();
            const dot    = (i < src.length && src[i] === '.') ? (i++, true) : false;
            const dur    = durN !== null ? durN : defaultDur;
            const useDot = dot || (durN === null && defaultDot);
            const durTk  = mmlDurToTicks(dur, useDot);
            const midi   = Math.max(0, Math.min(127, (octave + 1) * 12 + ((semi % 12 + 12) % 12)));

            events.push({ tick, type: 'noteOn',  channel, note: midi, velocity: vel });
            tieMap[midi] = events.length; // índice del noteOff que añadimos a continuación
            events.push({ tick: tick + durTk, type: 'noteOff', channel, note: midi, velocity: 0 });
            tick += durTk;
            continue;
        }

        i++; // carácter desconocido → ignorar
    }

    return { events, tempo, tempoChanges, totalTicks: tick };
}

// ---- Carga MML en el estado global de midiGrid -----------
// Rellena rawEvents, ppqn, tempoMap, totalTicks, instrumentNames,
// currentTimeSig, midiData y llama a enableInstrumentSelection().
function loadMMLText(text) {
    let raw = text.trim();
    if (raw.toUpperCase().startsWith('MML@')) raw = raw.slice(4);

    const trackTexts = raw.split(',').map(t => t.trim()).filter(t => t.length > 0);
    if (trackTexts.length === 0) {
        statusSpan.innerText = 'MML vacío o sin pistas válidas.';
        return;
    }

    // Parsear cada pista en su propio canal (0, 1, 2…)
    const parsed = trackTexts.map((t, idx) => parseMMLTrackToEvents(t, idx));

    // Rellenar rawEvents global con todos los eventos mezclados
    rawEvents = parsed.flatMap(p => p.events);
    rawEvents.sort((a, b) => a.tick - b.tick || a.type.localeCompare(b.type));

    // PPQN y ticks por paso
    ppqn         = MML_PPQN;
    ticksPerStep = ppqn / 4; // semicorchea = 24 ticks

    // tempoMap: arrancar en BPM de la primera pista, luego cambios ordenados
    const allChanges = parsed.flatMap(p => p.tempoChanges).sort((a, b) => a.tick - b.tick);
    tempoMap = [{ tick: 0, bpm: parsed[0]?.tempo || 120 }];
    for (const tc of allChanges) {
        if (tc.tick === 0) { tempoMap[0].bpm = tc.bpm; continue; }
        if (tempoMap.at(-1).tick !== tc.tick) tempoMap.push({ tick: tc.tick, bpm: tc.bpm });
    }

    // totalTicks = duración de la pista más larga
    totalTicks = Math.max(...parsed.map(p => p.totalTicks), 0);
    midiData   = { ppqn, totalTicks, rawEvents, tempoMap };

    // BPM en el input de la barra de herramientas
    const bpm0     = tempoMap[0]?.bpm || 120;
    const bpmInput = document.getElementById('bpmInput');
    if (bpmInput) bpmInput.value = bpm0;

    // Compás 4/4 por defecto (MML no lleva info de compás)
    currentTimeSig = { numerator: 4, denominator: 4, stepsPerMeasure: 16, stepsPerBeat: 4 };
    const rulerLabel = document.getElementById('rulerTimeSigLabel');
    if (rulerLabel) rulerLabel.textContent = '4 / 4';

    // Nombres de pista para el selector de instrumento
    instrumentNames = parsed.map((_, i) => `MML Pista ${i + 1}`);
    for (let i = parsed.length; i < 16; i++) instrumentNames[i] = `Canal ${i + 1}`;

    // Resumen en el panel de debug
    const noteCounts = parsed.map(p => p.events.filter(e => e.type === 'noteOn').length);
    debugDiv.innerHTML =
        `<strong>MML cargado</strong><br>` +
        `Pistas: ${parsed.length} | BPM: ${bpm0} | PPQN: ${ppqn} | ` +
        `Ticks totales: ${totalTicks}<br>` +
        parsed.map((_, i) => `Pista ${i + 1}: ${noteCounts[i]} notas`).join(' &nbsp;|&nbsp; ');

    enableInstrumentSelection();

    // Auto-seleccionar la primera pista y cargar el grid directamente
    // sin obligar al usuario a hacer click en "Mostrar Grid"
    selectedChannel = 0;
    instrumentSelect.value = '0';
    loadInstrumentBtn.disabled = false;
    loadInstrumentBtn.click();
}

// ============================================================
// Modal de importación MML para midiGrid
// ============================================================

function closeMMLImportModal() {
    const m = document.getElementById('mmlImportModalGrid');
    if (m) m.remove();
}

function openMMLImportModal() {
    closeMMLImportModal();

    // --- Overlay ---
    const ov = document.createElement('div');
    ov.id = 'mmlImportModalGrid';
    ov.style.cssText = [
        'position:fixed', 'inset:0', 'background:rgba(0,0,0,.86)',
        'display:flex', 'align-items:center', 'justify-content:center',
        'z-index:99999', 'overflow:auto', 'padding:16px'
    ].join(';');
    ov.onclick = e => { if (e.target === ov) closeMMLImportModal(); };

    // --- Caja interior ---
    const box = document.createElement('div');
    box.style.cssText = [
        'background:#1e1e32', 'border:1px solid #5a5aaa', 'border-radius:10px',
        'padding:20px', 'width:min(660px,100%)',
        'font-family:"Segoe UI",Tahoma,monospace', 'color:#ddd',
        'box-shadow:0 0 40px rgba(90,90,170,.35)',
        'display:flex', 'flex-direction:column', 'gap:12px',
        'max-height:90vh', 'overflow-y:auto'
    ].join(';');

    // Cabecera
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
    hdr.innerHTML = `
        <span style="color:#aaccff;font-weight:bold;font-size:14px;letter-spacing:2px;">
            🎼 IMPORTAR MML ESTÁNDAR
        </span>
        <button onclick="closeMMLImportModal()"
                style="background:transparent;border:1px solid #445;color:#888;
                       border-radius:4px;padding:2px 8px;cursor:pointer;font-size:14px;">✕</button>`;
    box.appendChild(hdr);

    // Panel informativo
    const info = document.createElement('div');
    info.style.cssText = [
        'background:#13132a', 'border:1px solid #2a2a5a', 'border-radius:6px',
        'padding:9px 12px', 'font-size:10px', 'color:#8888aa', 'line-height:1.8'
    ].join(';');
    info.innerHTML = `
        <strong style="color:#aaccff;">Comandos soportados</strong><br>
        <code>t120</code> tempo &nbsp;·&nbsp;
        <code>v100</code> volumen &nbsp;·&nbsp;
        <code>o5</code> octava &nbsp;·&nbsp;
        <code>l8</code> duración base &nbsp;·&nbsp;
        <code>&lt; &gt;</code> octava ↑↓ &nbsp;·&nbsp;
        <code>&amp;</code> ligadura<br>
        Notas: <code>c d e f g a b</code>
        &nbsp;·&nbsp; <code>+</code> / <code>-</code> sostenido/bemol
        &nbsp;·&nbsp; <code>r</code> silencio
        &nbsp;·&nbsp; <code>.</code> puntillo<br>
        Múltiples pistas separadas por <code>,</code> — cada pista aparece como un canal
        independiente en el selector.`;
    box.appendChild(info);

    // Textarea
    const ta = document.createElement('textarea');
    ta.id = 'mmlGridInputText';
    ta.placeholder =
        'Pega aquí tu partitura MML, por ejemplo:\n' +
        'MML@l4o4t120cdefgab>c,l4o3t120e4e4e4';
    ta.style.cssText = [
        'width:100%', 'min-height:130px', 'background:#0d0d1c', 'color:#ddeeff',
        'border:1px solid #3a5a9a', 'border-radius:4px', 'padding:8px',
        'font-size:11px', 'font-family:"Courier New",monospace',
        'resize:vertical', 'box-sizing:border-box', 'line-height:1.5'
    ].join(';');
    ta.oninput = _mmlGridUpdatePreview;
    box.appendChild(ta);

    // Panel de preview
    const pre = document.createElement('div');
    pre.id = 'mmlGridPreview';
    pre.style.cssText = [
        'background:#0d0d1c', 'border:1px solid #1a2a4a', 'border-radius:5px',
        'padding:10px', 'font-size:11px', 'color:#7788aa', 'line-height:1.7',
        'min-height:56px', 'white-space:pre-wrap', 'word-break:break-all',
        'max-height:140px', 'overflow-y:auto', 'font-family:"Courier New",monospace'
    ].join(';');
    pre.textContent = '(pega un MML para ver el resumen)';
    box.appendChild(pre);

    // Input de archivo oculto (.mml / .txt)
    const fileIn = document.createElement('input');
    fileIn.type    = 'file';
    fileIn.accept  = '.mml,.txt';
    fileIn.style.display = 'none';
    fileIn.onchange = e => {
        const f = e.target.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = ev => {
            ta.value = ev.target.result;
            _mmlGridUpdatePreview();
        };
        reader.readAsText(f, 'utf-8');
        fileIn.value = '';
    };
    box.appendChild(fileIn);

    // Footer
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:2px;';

    const mkBtn = (label, color, fn) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = [
            `border:1px solid ${color}`, `color:${color}`, 'border-radius:5px',
            'padding:7px 15px', 'cursor:pointer', 'background:transparent',
            'font-size:12px', 'font-family:inherit', 'transition:background .1s'
        ].join(';');
        b.onmouseover = () => { b.style.background = color; b.style.color = '#111'; };
        b.onmouseout  = () => { b.style.background = 'transparent'; b.style.color = color; };
        b.onclick = fn;
        return b;
    };

    const openFileBtn = mkBtn('📂 Abrir .mml / .txt', '#8860d0', () => fileIn.click());
    openFileBtn.style.marginRight = 'auto';
    footer.appendChild(openFileBtn);
    footer.appendChild(mkBtn('➕ Cargar en grid', '#4a9aff', () => {
        const text = (document.getElementById('mmlGridInputText') || {}).value || '';
        if (!text.trim()) {
            statusSpan.innerText = 'Pega una partitura MML primero.';
            return;
        }
        loadMMLText(text);
        closeMMLImportModal();
    }));
    footer.appendChild(mkBtn('✕ Cerrar', '#555', closeMMLImportModal));
    box.appendChild(footer);

    ov.appendChild(box);
    document.body.appendChild(ov);
    ta.focus();
}

// ---- Preview en tiempo real --------------------------------
function _mmlGridUpdatePreview() {
    const ta  = document.getElementById('mmlGridInputText');
    const pre = document.getElementById('mmlGridPreview');
    if (!ta || !pre) return;
    const text = ta.value.trim();
    if (!text) { pre.textContent = '(pega un MML para ver el resumen)'; return; }

    try {
        let raw = text;
        if (raw.toUpperCase().startsWith('MML@')) raw = raw.slice(4);
        const tracks = raw.split(',').map(t => t.trim()).filter(t => t.length > 0);
        if (!tracks.length) { pre.textContent = 'Sin pistas detectadas.'; return; }

        const NM = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
        let out = `Pistas: ${tracks.length}\n\n`;
        for (let idx = 0; idx < tracks.length; idx++) {
            const { events, tempo, totalTicks: tt } = parseMMLTrackToEvents(tracks[idx], idx);
            const notes    = events.filter(e => e.type === 'noteOn');
            const measures = Math.ceil(tt / (MML_PPQN * 4)) || 0;
            const first8   = notes.slice(0, 8)
                .map(e => NM[e.note % 12] + (Math.floor(e.note / 12) - 1))
                .join(' ');
            out += `Pista ${idx + 1}:  ${notes.length} notas · ${measures} compás(es) · BPM ${tempo}\n`;
            if (first8) out += `  → ${first8}${notes.length > 8 ? ' …' : ''}\n`;
        }
        pre.textContent = out;
    } catch (e) {
        pre.textContent = 'Error al parsear: ' + e.message;
    }
}
