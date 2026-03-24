// ============================================================
// aTambor — MIDI Importer  (midi.js)
// Soporta batería (canal GM 9) y cualquier instrumento melódico.
// ============================================================

// Nombres de instrumentos GM (programa 0-127)
const GM_INSTRUMENTS = [
  'Acoustic Grand Piano','Bright Acoustic Piano','Electric Grand Piano',
  'Honky-tonk Piano','Electric Piano 1','Electric Piano 2','Harpsichord',
  'Clavinet','Celesta','Glockenspiel','Music Box','Vibraphone',
  'Marimba','Xylophone','Tubular Bells','Dulcimer',
  'Drawbar Organ','Percussive Organ','Rock Organ','Church Organ',
  'Reed Organ','Accordion','Harmonica','Tango Accordion',
  'Acoustic Guitar (nylon)','Acoustic Guitar (steel)','Electric Guitar (jazz)',
  'Electric Guitar (clean)','Electric Guitar (muted)','Overdriven Guitar',
  'Distortion Guitar','Guitar Harmonics',
  'Acoustic Bass','Electric Bass (finger)','Electric Bass (pick)',
  'Fretless Bass','Slap Bass 1','Slap Bass 2','Synth Bass 1','Synth Bass 2',
  'Violin','Viola','Cello','Contrabass','Tremolo Strings',
  'Pizzicato Strings','Orchestral Harp','Timpani',
  'String Ensemble 1','String Ensemble 2','Synth Strings 1','Synth Strings 2',
  'Choir Aahs','Voice Oohs','Synth Choir','Orchestra Hit',
  'Trumpet','Trombone','Tuba','Muted Trumpet','French Horn',
  'Brass Section','Synth Brass 1','Synth Brass 2',
  'Soprano Sax','Alto Sax','Tenor Sax','Baritone Sax',
  'Oboe','English Horn','Bassoon','Clarinet',
  'Piccolo','Flute','Recorder','Pan Flute',
  'Blown Bottle','Shakuhachi','Whistle','Ocarina',
  'Lead 1 (square)','Lead 2 (sawtooth)','Lead 3 (calliope)','Lead 4 (chiff)',
  'Lead 5 (charang)','Lead 6 (voice)','Lead 7 (fifths)','Lead 8 (bass+lead)',
  'Pad 1 (new age)','Pad 2 (warm)','Pad 3 (polysynth)','Pad 4 (choir)',
  'Pad 5 (bowed)','Pad 6 (metallic)','Pad 7 (halo)','Pad 8 (sweep)',
  'FX 1 (rain)','FX 2 (soundtrack)','FX 3 (crystal)','FX 4 (atmosphere)',
  'FX 5 (brightness)','FX 6 (goblins)','FX 7 (echoes)','FX 8 (sci-fi)',
  'Sitar','Banjo','Shamisen','Koto','Kalimba','Bagpipe','Fiddle','Shanai',
  'Tinkle Bell','Agogo','Steel Drums','Woodblock','Taiko Drum',
  'Melodic Tom','Synth Drum','Reverse Cymbal',
  'Guitar Fret Noise','Breath Noise','Seashore','Bird Tweet',
  'Telephone Ring','Helicopter','Applause','Gunshot'
];

// Nombres GM de percusión (canal 9)
const GM_DRUM_NAMES = {
  35:'Kick2',  36:'Kick',    37:'SnareX',  38:'Snare',   39:'Clap',
  40:'Snare2', 41:'Tom L',   42:'HiHat C', 43:'Tom LF',  44:'HiHat P',
  45:'Tom M',  46:'HiHat O', 47:'Tom MH',  48:'Tom H',   49:'Crash',
  50:'Tom HH', 51:'Ride',    56:'Cowbell', 57:'Crash2'
};

// Convierte número MIDI a nombre de nota (ej: 60 → "C4", 69 → "A4")
function midiNoteName(n) {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return names[n % 12] + (Math.floor(n / 12) - 1);
}

// Nombre para mostrar en la tabla según canal
function noteDisplayName(ch, note) {
  return (ch === 9)
    ? (GM_DRUM_NAMES[note] || 'Perc ' + note)
    : midiNoteName(note);
}

// ---- Leer VLQ (variable-length quantity) -------------------
function midiVlq(bytes, pos) {
  let val = 0, n = 0;
  do {
    val = (val << 7) | (bytes[pos + n] & 0x7F);
  } while (bytes[pos + n++] & 0x80);
  return { val, n };
}

// ---- Parser MIDI binario -----------------------------------
// Retorna: { bpm, division, tempo, events, maxTick, durationMs,
//            chanInfo, noteStats, tickToMs }
// chanInfo[ch] = { program, instrName, noteStats: {note: count} }
// events[i]   = { note, tick, vel, ch }
function parseMidi(arrayBuffer) {
  const b   = new Uint8Array(arrayBuffer);
  const u16 = o => (b[o] << 8) | b[o + 1];
  const u32 = o => (b[o] << 24) | (b[o+1] << 16) | (b[o+2] << 8) | b[o+3];

  if (b[0] !== 0x4D || b[1] !== 0x54 || b[2] !== 0x68 || b[3] !== 0x64)
    throw new Error('Cabecera MThd no encontrada — no es un archivo MIDI válido');

  const numTracks = u16(10);
  const division  = u16(12);
  let   tempo     = 500000;
  const tempoEvents = [{ tick: 0, tempo: 500000 }];
  const events      = [];
  const chanInfo    = {};   // { ch: { program, instrName, noteStats } }
  const pendingNotes = {};  // { "ch_note": [event, ...] } para emparejar NoteOff
  let   maxTick     = 0;

  const ensureChan = ch => {
    if (!chanInfo[ch]) {
      const prog = (ch === 9) ? -1 : 0;
      chanInfo[ch] = {
        program:   prog,
        instrName: (ch === 9) ? 'GM Drums' : (GM_INSTRUMENTS[0] || 'Instrumento'),
        noteStats: {}
      };
    }
    return chanInfo[ch];
  };

  let trkStart = 14;
  for (let t = 0; t < numTracks; t++) {
    if (trkStart + 8 > b.length) break;
    if (b[trkStart]   !== 0x4D || b[trkStart+1] !== 0x54 ||
        b[trkStart+2] !== 0x72 || b[trkStart+3] !== 0x6B) break;

    const trkLen = u32(trkStart + 4);
    const trkEnd = trkStart + 8 + trkLen;
    let   pos    = trkStart + 8;
    let   tick   = 0;
    let   run    = 0;

    while (pos < trkEnd) {
      const dt = midiVlq(b, pos); pos += dt.n; tick += dt.val;

      let st;
      if (b[pos] & 0x80) { st = b[pos++]; run = st; }
      else                { st = run; }

      const cmd = st & 0xF0;
      const ch  = st & 0x0F;

      if (st === 0xFF) {
        const mt = b[pos++];
        const ml = midiVlq(b, pos); pos += ml.n;
        if (mt === 0x51 && ml.val >= 3) {
          tempo = (b[pos] << 16) | (b[pos+1] << 8) | b[pos+2];
          tempoEvents.push({ tick, tempo });
        }
        if (mt === 0x2F) { pos += ml.val; break; }
        pos += ml.val;

      } else if (st === 0xF0 || st === 0xF7) {
        const sl = midiVlq(b, pos); pos += sl.n + sl.val;

      } else if (cmd === 0x90) {
        // Note On — todos los canales
        const note = b[pos++], vel = b[pos++];
        if (vel > 0) {
          const ci = ensureChan(ch);
          ci.noteStats[note] = (ci.noteStats[note] || 0) + 1;
          const evt = { note, tick, vel, ch, durationTicks: 0 };
          events.push(evt);
          if (tick > maxTick) maxTick = tick;
          // Registrar para emparejar con NoteOff
          const pkey = `${ch}_${note}`;
          if (!pendingNotes[pkey]) pendingNotes[pkey] = [];
          pendingNotes[pkey].push(evt);
        } else {
          // NoteOn con vel=0 equivale a NoteOff
          const pkey = `${ch}_${note}`;
          const q = pendingNotes[pkey];
          if (q && q.length) {
            const evt = q.shift();
            evt.durationTicks = tick - evt.tick;
            if (tick > maxTick) maxTick = tick;
          }
        }

      } else if (cmd === 0x80) {
        // Note Off
        const note = b[pos++]; pos++; // ignorar velocidad NoteOff
        const pkey = `${ch}_${note}`;
        const q = pendingNotes[pkey];
        if (q && q.length) {
          const evt = q.shift();
          evt.durationTicks = tick - evt.tick;
          if (tick > maxTick) maxTick = tick;
        }

      } else if (cmd === 0xC0) {
        // Program Change — guarda el instrumento del canal
        const program = b[pos++];
        if (ch !== 9) {
          const ci = ensureChan(ch);
          ci.program   = program;
          ci.instrName = GM_INSTRUMENTS[program] || ('Programa ' + program);
        }

      } else if (cmd === 0xA0 || cmd === 0xB0 || cmd === 0xE0) {
        pos += 2;
      } else if (cmd === 0xD0) {
        pos += 1;
      } else {
        pos++;
      }
    }
    trkStart = trkEnd;
  }

  if (!events.length)
    throw new Error('No se encontraron notas. Comprueba que el archivo MIDI contiene eventos Note On.');

  // Normalizar tempo map: ordenar y deduplicar por tick (último gana)
  tempoEvents.sort((a, b) => a.tick - b.tick);
  const normTempo = [];
  tempoEvents.forEach(e => {
    const last = normTempo[normTempo.length - 1];
    if (last && last.tick === e.tick) last.tempo = e.tempo;
    else normTempo.push({ tick: e.tick, tempo: e.tempo });
  });

  // Precalcular ms acumulados por segmento para tickToMs rápido
  const tempoSegs = [];
  let accMs = 0;
  for (let i = 0; i < normTempo.length; i++) {
    const cur = normTempo[i];
    const nextTick = (i + 1 < normTempo.length) ? normTempo[i + 1].tick : null;
    tempoSegs.push({
      tick: cur.tick,
      tempo: cur.tempo,
      accMs,
      nextTick
    });
    if (nextTick != null) {
      const dt = nextTick - cur.tick;
      accMs += (dt * cur.tempo) / division / 1000;
    }
  }

  const tickToMs = t => {
    if (t <= 0) return 0;
    let lo = 0, hi = tempoSegs.length - 1, idx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tempoSegs[mid].tick <= t) { idx = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    const seg = tempoSegs[idx];
    const dt = t - seg.tick;
    return Math.round(seg.accMs + (dt * seg.tempo) / division / 1000);
  };

  const tickDeltaToMs = (startTick, deltaTicks) => {
    if (deltaTicks <= 0) return 0;
    return tickToMs(startTick + deltaTicks) - tickToMs(startTick);
  };
  // noteStats global (para compatibilidad con código anterior)
  const noteStats = {};
  events.forEach(e => { noteStats[e.note] = (noteStats[e.note] || 0) + 1; });

  return {
    division, tempo,
    bpm:        Math.round(60000000 / tempo),
    events,
    maxTick,
    durationMs: tickToMs(maxTick),
    chanInfo,
    noteStats,
    tickToMs,
    tickDeltaToMs
  };
}

// ---- Convertir MIDI → channels (cuantizado a 1/16) ---------
// noteMap: { "ch_note": motor }  (motor === -1 → no asignar)
// Usa el mismo modelo de datos que el editor manual: steps[i] = duración en 1/16.
// La duración MIDI de cada nota se cuantiza a pasos de 1/16 (mínimo 1).
// Si dos notas del mismo canal+nota se solapan por redondeo, la segunda se omite.
function midiToRhythm(md, noteMap, htDur) {
  const tps    = md.division / 4;  // ticks por semicorchea (1/16)
  const nMeas  = Math.max(1, Math.ceil(Math.ceil((md.maxTick + tps) / tps) / 16));
  const nSteps = nMeas * 16;

  // Agrupar por clave ch_note
  const byKey = {};
  md.events.forEach(e => {
    const key   = `${e.ch}_${e.note}`;
    const motor = (noteMap[key] != null) ? parseInt(noteMap[key]) : -1;
    if (motor < 0 || motor > 7) return;
    if (!byKey[key]) byKey[key] = { motor, ch: e.ch, note: e.note, steps: new Array(nSteps).fill(0) };
    const steps = byKey[key].steps;
    const si = Math.round(e.tick / tps);
    if (si < 0 || si >= nSteps) return;

    // Comprobar que el paso no está cubierto por la nota anterior (mismo canal+nota)
    if (steps[si] > 0) return;
    for (let j = si - 1; j >= 0; j--) {
      if (steps[j] > 0) { if (j + steps[j] > si) return; break; }
    }

    // Duración en pasos de 1/16 (mínimo 1, máximo hasta fin de secuencia)
    const durSteps = e.durationTicks > 0
      ? Math.max(1, Math.min(Math.round(e.durationTicks / tps), nSteps - si))
      : 1;
    steps[si] = durSteps;
  });

  // Post-proceso: redondear duración al estándar musical más cercano,
  // limitado siempre por el inicio de la siguiente nota del mismo canal.
  // En empate (raw=3 entre 2 y 4) se prefiere el MAYOR para que notas
  // ligeramente recortadas por el DAW no pierdan un paso visual.
  function _snapDur(raw, gap) {
    const standards = [1, 2, 4, 8, 16, 32];
    let best = 1, bestDiff = Infinity;
    for (const s of standards) {
      if (s > gap) continue;           // nunca superar el espacio hasta la siguiente nota
      const d = Math.abs(raw - s);
      if (d < bestDiff || (d === bestDiff && s > best)) { best = s; bestDiff = d; }
    }
    return best;
  }

  Object.values(byKey).forEach(({ steps }) => {
    const pos = [];
    for (let i = 0; i < nSteps; i++) { if (steps[i] > 0) pos.push(i); }
    for (let k = 0; k < pos.length; k++) {
      const si     = pos[k];
      const nextSi = pos[k + 1] ?? nSteps;
      const gap    = nextSi - si;
      steps[si] = Math.max(1, _snapDur(steps[si], gap));
    }
  });

  const chs = Object.values(byKey).sort((a, b) => a.motor - b.motor).map(k => ({
    name:    noteDisplayName(k.ch, k.note),
    motor:   k.motor,
    vel:     70,
    homePwm: 375,
    muted:   false,
    sustain: true,   // siempre percusivo: un golpe por paso, sin fusionar adyacentes
    steps:   k.steps
  }));

  return { bpm: md.bpm, hitDur: htDur || 80, numMeasures: nMeas, channels: chs };
}

// ---- Convertir MIDI → comando exacto (timestamps ms) -------
// Usa durationTicks de cada evento (calculado por parseMidi con NoteOff)
// para mantener el servo pulsado el tiempo exacto de la nota.
// El firmware omite el evento "volver a home" entre movimientos consecutivos
// con velocidad > 0 (fix en generarArrayEventos), por lo que dos instrucciones
// t X; v vel; seguidas mantienen el servo pulsado sin rebote.
function midiToExactCmd(md, noteMap, htDur) {
  const hitMs   = htDur || 80;
  const cycleMs = md.tickToMs(md.maxTick) + hitMs + 20;

  const byMotor = {};
  md.events.forEach(e => {
    const key   = `${e.ch}_${e.note}`;
    const motor = (noteMap[key] != null) ? parseInt(noteMap[key]) : -1;
    if (motor < 0 || motor > 7) return;
    const noteMs = md.tickToMs(e.tick);
    // holdMs: duración total de la nota (mínimo hitMs para que suene)
    const holdMs = e.durationTicks > 0
      ? Math.max(hitMs, md.tickDeltaToMs(e.tick, e.durationTicks))
      : hitMs;
    (byMotor[motor] = byMotor[motor] || []).push({ ms: noteMs, vel: e.vel, holdMs });
  });

  if (!Object.keys(byMotor).length) return '';

  let cmd = 'e;\n';
  Object.keys(byMotor).sort((a, b) => a - b).forEach(mstr => {
    const motor = parseInt(mstr);
    const evts  = byMotor[mstr].sort((a, b) => a.ms - b.ms);
    cmd += `m ${motor}; o 375;\n`;
    let cursor = 0;
    evts.forEach(ev => {
      // Para percusión física sólo importa el golpe (hitMs).
      // El cursor solo avanza hitMs, no holdMs, para no fusionar notas.
      // Si la nota llega antes de que termine el hitMs anterior,
      // la retrasamos el mínimo indispensable (1 ms) en vez de omitirla.
      const startMs = Math.max(ev.ms, cursor);
      const pause   = startMs - cursor;
      if (pause > 0) cmd += `t ${pause}; v 0;\n`;
      cmd += `t ${hitMs}; v 70;\n`;
      cursor = startMs + hitMs;
    });
    if (cursor < cycleMs) cmd += `t ${cycleMs - cursor}; v 0;\n`;
  });
  cmd += 'r;';
  return cmd;
}

// ---- Convertir MIDI → array de comandos exactos (paginado por compases) ----
// Retorna string[] — un comando por página de measuresPerPage compases.
// Cada comando tiene timestamps relativos al inicio de esa página.
// Páginas sin notas se omiten (null filtrado por startMidiPaged en script.js).
function midiToExactCmdPaged(md, noteMap, htDur, measuresPerPage) {
  const hitMs = htDur || 80;
  const targetMs = 9000;
  const maxMs = 14000;
  const maxNotesPerPage = 220;
  const maxNotesPerMotor = 90;

  const mapped = [];
  md.events.forEach(e => {
    const key   = `${e.ch}_${e.note}`;
    const motor = (noteMap[key] != null) ? parseInt(noteMap[key]) : -1;
    if (motor < 0 || motor > 19) return;
    const noteMs = md.tickToMs(e.tick);
    const holdMs = e.durationTicks > 0
      ? Math.max(hitMs, md.tickDeltaToMs(e.tick, e.durationTicks))
      : hitMs;
    mapped.push({ motor, noteMs, holdMs });
  });

  if (!mapped.length) return [];
  mapped.sort((a, b) => a.noteMs - b.noteMs);

  const pages = [];
  let cursor = 0;

  while (cursor < mapped.length) {
    const pageStartMs = mapped[cursor].noteMs;
    let pageEndTarget = pageStartMs + targetMs;
    let pageEndMs = pageEndTarget;

    const motorCounts = {};
    let totalNotes = 0;
    let lastEvtEnd = pageStartMs;

    let i = cursor;
    for (; i < mapped.length; i++) {
      const ev = mapped[i];
      if (ev.noteMs >= pageEndMs && totalNotes > 0) break;

      motorCounts[ev.motor] = (motorCounts[ev.motor] || 0) + 1;
      totalNotes++;

      const evtEnd = ev.noteMs + hitMs;   // solo el golpe físico, no la duración MIDI
      if (evtEnd > lastEvtEnd) lastEvtEnd = evtEnd;

      if (totalNotes >= maxNotesPerPage) break;
      if (motorCounts[ev.motor] >= maxNotesPerMotor) break;

      if (ev.noteMs >= pageEndTarget && (ev.noteMs - pageStartMs) >= 1500) break;
      if ((ev.noteMs - pageStartMs) >= maxMs) break;

      if (ev.noteMs > pageEndMs) pageEndMs = ev.noteMs;
      const maxSpan = pageStartMs + maxMs;
      if (pageEndMs > maxSpan) pageEndMs = maxSpan;
    }

    const pageSlice = mapped.slice(cursor, i);
    cursor = i;

    if (!pageSlice.length) continue;

    const pageDurMs = Math.min(Math.max(lastEvtEnd - pageStartMs + 40, 1200), maxMs);
    const byMotor = {};
    pageSlice.forEach(ev => {
      (byMotor[ev.motor] = byMotor[ev.motor] || []).push({
        ms: Math.max(0, Math.round(ev.noteMs - pageStartMs)),
        holdMs: Math.max(hitMs, Math.round(ev.holdMs))
      });
    });

    let cmd = 'e;\n';
    Object.keys(byMotor).sort((a, b) => a - b).forEach(mstr => {
      const motor = parseInt(mstr);
      const evts  = byMotor[mstr].sort((a, b) => a.ms - b.ms);
      cmd += `m ${motor}; o 375;\n`;
      let tcur = 0;
      evts.forEach(ev => {
        // Igual que en midiToExactCmd: cursor solo avanza hitMs,
        // notas solapadas se retrasan el mínimo en vez de omitirse.
        const startMs = Math.max(ev.ms, tcur);
        const pause   = startMs - tcur;
        if (pause > 0) cmd += `t ${pause}; v 0;\n`;
        cmd += `t ${hitMs}; v 70;\n`;
        tcur = startMs + hitMs;
      });
      if (tcur < pageDurMs) cmd += `t ${pageDurMs - tcur}; v 0;\n`;
    });
    cmd += 'r;';
    pages.push({ cmd, pageMs: pageDurMs });
  }

  return pages;
}

// ============================================================
// UI — Modal de importación MIDI
// ============================================================
let _midiData = null;

function openMidiImport() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.mid,.midi';
  inp.onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        _midiData = parseMidi(ev.target.result);
        _midiData._name = file.name;
        showMidiModal(_midiData);
      } catch (err) {
        setStatus('Error MIDI: ' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  };
  inp.click();
}

function closeMidiModal() {
  const m = document.getElementById('midiModal'); if (m) m.remove();
}

// Lee el mapa nota→motor según los checkboxes del modal
// Asigna motores consecutivos a las notas de cada canal seleccionado
function _getNoteMap() {
  if (!_midiData) return {};
  const map = {};
  let motorCursor = 0;

  const checked = [];
  document.querySelectorAll('#midiModal [data-ch]').forEach(chk => {
    if (chk.checked) checked.push(parseInt(chk.dataset.ch));
  });

  checked.sort((a, b) => { if (a === 9) return 1; if (b === 9) return -1; return a - b; });

  checked.forEach(ch => {
    Object.keys(_midiData.chanInfo[ch].noteStats)
      .map(Number).sort((a, b) => a - b)
      .forEach(note => { map[`${ch}_${note}`] = motorCursor < 20 ? motorCursor++ : -1; });
  });

  return map;
}

// Botón "↺ Ver en secuenciador"
function applyMidiToSequencer() {
  if (!_midiData) return;
  const noteMap = _getNoteMap();
  const rhythm  = midiToRhythm(_midiData, noteMap, hitDur);

  if (!rhythm.channels.length) {
    setStatus('Asigna al menos un instrumento a un motor (0-7)', 'error');
    return;
  }

  bpm = rhythm.bpm;
  document.getElementById('bpmSlider').value = bpm;
  document.getElementById('bpmValue').value  = bpm;
  hitDur = rhythm.hitDur;
  document.getElementById('hitDur').value = hitDur;

  channels    = rhythm.channels;
  numMeasures = rhythm.numMeasures;
  numSteps    = rhythm.numMeasures * 16;
  document.getElementById('measuresInput').value = numMeasures;

  songLoadedIdx = -1; songLoadedModified = false;
  render();

  if (isPlaying) {
    const cmd = document.getElementById('cmdOutput').value;
    if (cmd) sendCommand(cmd);
    setRhythmState('pending');
  }

  closeMidiModal();
  setStatus('MIDI → secuenciador: ' + _midiData._name + ' — ' + bpm + ' BPM');
}

// Botón "▶ Enviar exacto"
function applyMidiExact() {
  if (!_midiData) return;
  const noteMap = _getNoteMap();
  const cmd     = midiToExactCmd(_midiData, noteMap, hitDur);

  if (!cmd) { setStatus('Sin motores asignados', 'error'); return; }

  document.getElementById('cmdOutput').value = cmd;
  closeMidiModal();
  document.getElementById('cmdOutput').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setStatus('Comando exacto listo — pulsa ▶ Enviar para reproducir');
}

// Botón "▶ Enviar paginado" — fragmenta el MIDI en páginas de 8 compases
function applyMidiExactPaged() {
  if (!_midiData) return;
  const noteMap = _getNoteMap();
  const pages   = midiToExactCmdPaged(_midiData, noteMap, hitDur, 8);
  if (!pages.length) { setStatus('Sin motores asignados', 'error'); return; }
  closeMidiModal();
  startMidiPaged(pages);   // definida en script.js
  setStatus('Reproduciendo MIDI paginado: ' + _midiData._name +
           ' — ' + pages.length + ' páginas de duración variable');
}

// ---- Construir y mostrar el modal --------------------------
function showMidiModal(md) {
  closeMidiModal();

  const chanNums = Object.keys(md.chanInfo)
    .map(Number)
    .filter(ch => Object.keys(md.chanInfo[ch].noteStats).length > 0)
    .sort((a, b) => { if (a === 9) return 1; if (b === 9) return -1; return a - b; });

  // Overlay
  const ov = document.createElement('div');
  ov.id = 'midiModal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;z-index:9999;overflow:auto;padding:16px;';
  ov.onclick = e => { if (e.target === ov) closeMidiModal(); };

  // Caja
  const box = document.createElement('div');
  box.style.cssText = [
    'background:#1a1a33', 'border:1px solid #3498db', 'border-radius:10px',
    'padding:20px', 'width:min(480px,100%)',
    'font-family:"Courier New",monospace', 'color:#ddd',
    'box-shadow:0 0 40px rgba(52,152,219,.3)', 'max-height:90vh',
    'overflow-y:auto', 'display:flex', 'flex-direction:column', 'gap:12px'
  ].join(';');

  // Título
  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center';
  hdr.innerHTML = `
    <span style="color:#3498db;font-weight:bold;font-size:13px;letter-spacing:2px">📥 IMPORTAR MIDI</span>
    <button onclick="closeMidiModal()" style="background:transparent;border:1px solid #445;color:#888;border-radius:4px;padding:2px 8px;cursor:pointer;font-family:inherit;font-size:13px">✕</button>`;
  box.appendChild(hdr);

  // Info del archivo
  const info = document.createElement('div');
  info.style.cssText = 'background:#0d0d22;border-radius:6px;padding:9px 12px;font-size:11px;color:#888;line-height:2';
  info.innerHTML =
    `<span style="color:#ff4466">${md._name}</span><br>` +
    `BPM: <b style="color:#fff">${md.bpm}</b>` +
    ` &nbsp;·&nbsp; Duración: <b style="color:#fff">${(md.durationMs/1000).toFixed(1)}s</b>` +
    ` &nbsp;·&nbsp; Canales: <b style="color:#fff">${chanNums.length}</b>` +
    ` &nbsp;·&nbsp; Eventos: <b style="color:#fff">${md.events.length}</b>`;
  box.appendChild(info);

  // Título sección
  const selTitle = document.createElement('div');
  selTitle.style.cssText = 'font-size:11px;color:#3498db;letter-spacing:2px;font-weight:bold;padding-bottom:4px;border-bottom:1px solid #2a2a44';
  selTitle.textContent = 'SELECCIONAR INSTRUMENTOS';
  box.appendChild(selTitle);

  // Lista de checkboxes por canal
  const chkList = document.createElement('div');
  chkList.style.cssText = 'display:flex;flex-direction:column;gap:6px';

  chanNums.forEach(ch => {
    const ci        = md.chanInfo[ch];
    const noteCount = Object.keys(ci.noteStats).length;
    const hitCount  = md.events.filter(e => e.ch === ch).length;

    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;background:#0d0d22;border:1px solid #3498db;border-radius:6px;padding:10px 14px;cursor:pointer;transition:border-color .15s,opacity .15s;user-select:none';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = true;
    chk.dataset.ch = ch;
    chk.style.cssText = 'accent-color:#3498db;width:16px;height:16px;flex-shrink:0;cursor:pointer';

    const infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'flex:1;min-width:0';
    infoDiv.innerHTML =
      `<div style="font-weight:bold;font-size:12px;color:#ddd">${ci.instrName}</div>` +
      `<div style="font-size:10px;color:#556;margin-top:2px">CH ${ch} &nbsp;·&nbsp; ${noteCount} pitch${noteCount !== 1 ? 'es' : ''} &nbsp;·&nbsp; ${hitCount} hits</div>`;

    chk.onchange = () => {
      row.style.borderColor = chk.checked ? '#3498db' : '#2a2a44';
      row.style.opacity     = chk.checked ? '1' : '0.45';
    };

    row.appendChild(chk);
    row.appendChild(infoDiv);
    chkList.appendChild(row);
  });
  box.appendChild(chkList);

  // Aviso
  const warn = document.createElement('p');
  warn.style.cssText = 'font-size:10px;color:#445;line-height:1.6;margin:0';
  warn.textContent = '⚠ homePwm = 375 por defecto. Los motores se asignan consecutivamente desde 0.';
  box.appendChild(warn);

  // Botones
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding-top:4px';

  const mkBtn = (txt, col, fn) => {
    const btn = document.createElement('button');
    btn.textContent = txt;
    btn.style.cssText = `border:1px solid ${col};color:${col};border-radius:6px;padding:7px 14px;cursor:pointer;font-family:inherit;font-size:12px;background:transparent;transition:all .12s`;
    btn.onmouseover = () => { btn.style.background = col; btn.style.color = '#000'; };
    btn.onmouseout  = () => { btn.style.background = 'transparent'; btn.style.color = col; };
    btn.onclick = fn;
    return btn;
  };

  btnRow.appendChild(mkBtn('✕ Cancelar',           '#445',    closeMidiModal));
  btnRow.appendChild(mkBtn('↺ Ver en secuenciador', '#3498db', applyMidiToSequencer));
  btnRow.appendChild(mkBtn('▶ Enviar exacto',       '#2ecc71', applyMidiExact));
  btnRow.appendChild(mkBtn('▶ Enviar paginado',     '#e67e22', applyMidiExactPaged));
  box.appendChild(btnRow);

  ov.appendChild(box);
  document.body.appendChild(ov);
}

// ---- Enlazar botón al cargar el DOM ------------------------
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btnMidi');
  if (btn) btn.onclick = () => {
    const p = document.getElementById('loadDropdownPanel');
    const b = document.getElementById('loadDropdownBtn');
    if (p) p.classList.remove('open');
    if (b) b.classList.remove('open');
    openMidiImport();
  };
});