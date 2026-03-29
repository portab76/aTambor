// ============================================================
// aTambor Drum Machine
// ============================================================
// Genera comandos m/t/v/r para el firmware del ESP32.
// Cada canal = un servo. Cada fila = 16 pasos (semicorcheas).
// El BPM convierte los pasos en milisegundos.
// ============================================================

let ESP32_IP   = '192.168.1.128'; // ← IP real del ESP32 en tu red (configurable desde Settings)
const MAX_CH     = 20;
const DEFAULT_KEYS = [
  { name: 'C1',        motor: 0  },
  { name: 'C#',       motor: 1  },
  { name: 'D1',        motor: 2  },
  { name: 'D#1 / Eb1', motor: 3  },
  { name: 'E1',        motor: 4  },
  { name: 'F1',        motor: 5  },
  { name: 'F#1 / Gb1', motor: 6  },
  { name: 'G1',        motor: 7  },
  { name: 'G#1 / Ab1', motor: 8  },
  { name: 'A1',        motor: 9  },
  { name: 'A#1 / Bb1', motor: 10 },
  { name: 'B1',        motor: 11 },
  { name: 'C2',       motor: 12 },
  { name: 'D2',       motor: 13 },
  { name: 'E2',       motor: 14 },
  { name: 'G2',       motor: 15 },
];
let numMeasures  = 1;
let numSteps     = 16;  // numMeasures * 16

// Estado global
let channels  = [];
let bpm       = 60;
let hitDur     = 80;   // ms que el servo permanece en posición de golpe
let retractDur = 150;  // ms que el servo necesita para volver al neutro entre notas
let isPlaying        = false;
let selectedMeasures = new Set();  // índices 0-based de compases seleccionados
let drumStreamActive = false;   // streaming compás a compás
let drumStreamIdx    = 0;       // índice absoluto del próximo compás a enviar
let metroTimer  = null;
let currentStep = -1;
let pendingPlayTimeout = null;

// Drag-select + clipboard
let seqDragStart  = null;  // { ci, s } celda donde empezó el drag
let seqDragEnd    = null;  // { ci, s } celda actual durante el drag
let seqDragMoved  = false; // true si el ratón salió de la celda inicial
let seqClipboard  = null;  // { rows, cols, data[][] } patrón copiado

// Audio MIDI - Piano con soundfont
let audioEnabled = false;
let audioOctaveOffset = 3;  // C3, C4, C5, etc.
let toneInitialized = false;
let sampler = null;  // Tone.PolySynth para piano
let currentInstrument = 'piano';
let currentWaveform = 'triangle';

// Definiciones de envolventes ADSR por instrumento
const instrumentEnvelopes = {
  piano: { attack: 0.008, decay: 0.15, sustain: 0.35, release: 1.2 },
  xylophone: { attack: 0.002, decay: 0.08, sustain: 0, release: 0.1 },
  bell: { attack: 0.01, decay: 0.5, sustain: 0.2, release: 2 },
  organ: { attack: 0.05, decay: 0, sustain: 1, release: 0.3 },
  flute: { attack: 0.05, decay: 0.1, sustain: 0.7, release: 0.5 }
};

// ---- ACORDES POR TONALIDAD Y ESCALA ----
const CHORD_SCALES = {
  'Mayor': {
    chords: [
      { numeral: 'I',    type: 'major',      offset: 0 },
      { numeral: 'ii',   type: 'minor',      offset: 2 },
      { numeral: 'iii',  type: 'minor',      offset: 4 },
      { numeral: 'IV',   type: 'major',      offset: 5 },
      { numeral: 'V',    type: 'major',      offset: 7 },
      { numeral: 'vi',   type: 'minor',      offset: 9 },
      { numeral: 'vii°', type: 'diminished', offset: 11 }
    ]
  },
  'Menor Natural': {
    chords: [
      { numeral: 'i',    type: 'minor',      offset: 0 },
      { numeral: 'ii°',  type: 'diminished', offset: 2 },
      { numeral: 'III',  type: 'major',      offset: 3 },
      { numeral: 'iv',   type: 'minor',      offset: 5 },
      { numeral: 'v',    type: 'minor',      offset: 7 },
      { numeral: 'VI',   type: 'major',      offset: 8 },
      { numeral: 'VII',  type: 'major',      offset: 10 }
    ]
  },
  'Menor Armónica': {
    chords: [
      { numeral: 'i',    type: 'minor',      offset: 0 },
      { numeral: 'ii°',  type: 'diminished', offset: 2 },
      { numeral: 'III+', type: 'major',      offset: 3 },
      { numeral: 'iv',   type: 'minor',      offset: 5 },
      { numeral: 'V',    type: 'major',      offset: 7 },
      { numeral: 'VI',   type: 'major',      offset: 8 },
      { numeral: 'vii°', type: 'diminished', offset: 11 }
    ]
  },
  'Menor Melódica': {
    chords: [
      { numeral: 'i',    type: 'minor',      offset: 0 },
      { numeral: 'ii',   type: 'minor',      offset: 2 },
      { numeral: 'III+', type: 'major',      offset: 3 },
      { numeral: 'IV',   type: 'major',      offset: 5 },
      { numeral: 'V',    type: 'major',      offset: 7 },
      { numeral: 'vi°',  type: 'diminished', offset: 9 },
      { numeral: 'vii°', type: 'diminished', offset: 11 }
    ]
  },
  'Dórica': {
    chords: [
      { numeral: 'i',    type: 'minor',      offset: 0 },
      { numeral: 'ii',   type: 'minor',      offset: 2 },
      { numeral: 'III',  type: 'major',      offset: 3 },
      { numeral: 'IV',   type: 'major',      offset: 5 },
      { numeral: 'v',    type: 'minor',      offset: 7 },
      { numeral: 'vi°',  type: 'diminished', offset: 9 },
      { numeral: 'VII',  type: 'major',      offset: 10 }
    ]
  },
  'Frigia': {
    chords: [
      { numeral: 'i',    type: 'minor',      offset: 0 },
      { numeral: 'II',   type: 'major',      offset: 1 },
      { numeral: 'III',  type: 'major',      offset: 3 },
      { numeral: 'iv',   type: 'minor',      offset: 5 },
      { numeral: 'v°',   type: 'diminished', offset: 7 },
      { numeral: 'VI',   type: 'major',      offset: 8 },
      { numeral: 'vii',  type: 'minor',      offset: 10 }
    ]
  },
  'Lidia': {
    chords: [
      { numeral: 'I',    type: 'major',      offset: 0 },
      { numeral: 'II',   type: 'major',      offset: 2 },
      { numeral: 'iii',  type: 'minor',      offset: 4 },
      { numeral: 'iv°',  type: 'diminished', offset: 6 },
      { numeral: 'V',    type: 'major',      offset: 7 },
      { numeral: 'vi',   type: 'minor',      offset: 9 },
      { numeral: 'vii',  type: 'minor',      offset: 11 }
    ]
  },
  'Mixolidia': {
    chords: [
      { numeral: 'I',    type: 'major',      offset: 0 },
      { numeral: 'ii',   type: 'minor',      offset: 2 },
      { numeral: 'iii°', type: 'diminished', offset: 4 },
      { numeral: 'IV',   type: 'major',      offset: 5 },
      { numeral: 'v',    type: 'minor',      offset: 7 },
      { numeral: 'vi',   type: 'minor',      offset: 9 },
      { numeral: 'VII',  type: 'major',      offset: 10 }
    ]
  },
  'Pentatónica Mayor': {
    chords: [
      { numeral: 'I',    type: 'major',      offset: 0 },
      { numeral: 'II',   type: 'major',      offset: 2 },
      { numeral: 'iii',  type: 'minor',      offset: 4 },
      { numeral: 'V',    type: 'major',      offset: 7 },
      { numeral: 'vi',   type: 'minor',      offset: 9 }
    ]
  },
  'Pentatónica Menor': {
    chords: [
      { numeral: 'i',    type: 'minor',      offset: 0 },
      { numeral: 'III',  type: 'major',      offset: 3 },
      { numeral: 'IV',   type: 'major',      offset: 5 },
      { numeral: 'v',    type: 'minor',      offset: 7 },
      { numeral: 'VII',  type: 'major',      offset: 10 }
    ]
  },
  'Blues': {
    chords: [
      { numeral: 'I',    type: 'major',      offset: 0 },
      { numeral: 'I7',   type: 'major',      offset: 0 },
      { numeral: 'IV',   type: 'major',      offset: 5 },
      { numeral: 'IV7',  type: 'major',      offset: 5 },
      { numeral: 'V',    type: 'major',      offset: 7 },
      { numeral: 'V7',   type: 'major',      offset: 7 }
    ]
  }
};

// Notas cromáticas (semitonos desde C)
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// ---- Canal vacío --------------------------------------------
function emptyChannel(index) {
  return { name: `Drum ${index + 1}`, motor: index, vel: 60, homePwm: 375, muted: false, sustain: false, steps: new Array(numSteps).fill(0), notation: { dynamics: {}, articulations: {} } };
}
function _chNotation(ch) {
  if (!ch.notation)                    ch.notation = {};
  ch.notation.dynamics      = ch.notation.dynamics      || {};
  ch.notation.articulations = ch.notation.articulations || {};
  ch.notation.ties          = ch.notation.ties          || [];
  ch.notation.durOverride   = ch.notation.durOverride   || {};
  ch.notation.tuplets       = ch.notation.tuplets       || [];
  return ch.notation;
}

// Redimensiona todos los canales repitiendo/truncando el patrón actual
function setMeasures(n) {
  n = Math.max(1, Math.min(8, n));
  const newSteps = n * 16;
  channels.forEach(ch => {
    if (newSteps === ch.steps.length) return;
    if (newSteps > ch.steps.length) {
      while (ch.steps.length < newSteps) ch.steps.push(0);
    } else {
      ch.steps = ch.steps.slice(0, newSteps);
    }
  });
  numMeasures = n;
  numSteps    = newSteps;
  // Eliminar selecciones de compases que ya no existen
  for (const m of selectedMeasures) { if (m >= n) selectedMeasures.delete(m); }
  _updateMeasureSelBar();
  render();
}

// ---- Inicializar canales vacíos -----------------------------
function initChannels() {
  songLoadedIdx = -1; songLoadedModified = false;
  channels = DEFAULT_KEYS.map(k => ({ ...emptyChannel(k.motor), name: k.name, motor: k.motor }));
  render();
  if (isPlaying) {
    if (drumStreamActive) { drumStreamStop(); setTimeout(drumStreamStart, 100); }
    else { const cmd = generateCommand(); if (cmd) sendCommand(cmd); }
  }
}

function clearSteps() {
  channels.forEach(ch => { ch.steps = new Array(numSteps).fill(0); });
  render();
  if (isPlaying) {
    if (drumStreamActive) { drumStreamStop(); setTimeout(drumStreamStart, 100); }
    else { const cmd = generateCommand(); if (cmd) sendCommand(cmd); }
  }
}

// ============================================================
// AUDIO MIDI - PIANO SOUNDFONT
// ============================================================

// Envolventes ADSR por instrumento para Tone.PolySynth
const SYNTH_ENVELOPES = {
  'piano': {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.005, decay: 0.3, sustain: 0.2, release: 1.5 }
  },
  'piano2': {
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.003, decay: 0.5, sustain: 0.15, release: 2.0 }
  },
  'xylophone': {
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.05 }
  },
  'marimba': {
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.3, sustain: 0.05, release: 0.3 }
  },
  'bell': {
    oscillator: { type: 'sine' },
    envelope: { attack: 0.01, decay: 0.8, sustain: 0.3, release: 2.0 }
  },
  'tubbell': {
    oscillator: { type: 'sine' },
    envelope: { attack: 0.005, decay: 1.5, sustain: 0.1, release: 3.0 }
  },
  'organ': {
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.02, decay: 0, sustain: 1, release: 0.1 }
  },
  'organ2': {
    oscillator: { type: 'square' },
    envelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.05 }
  },
  'flute': {
    oscillator: { type: 'sine' },
    envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.3 }
  },
  'oboe': {
    oscillator: { type: 'square' },
    envelope: { attack: 0.05, decay: 0.1, sustain: 0.8, release: 0.2 }
  },
  'clarinet': {
    oscillator: { type: 'square' },
    envelope: { attack: 0.03, decay: 0.05, sustain: 0.9, release: 0.15 }
  },
  'strings': {
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.3, decay: 0.1, sustain: 0.9, release: 0.5 }
  },
  'guitar': {
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.005, decay: 0.4, sustain: 0.1, release: 0.8 }
  },
  'harp': {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.002, decay: 0.6, sustain: 0.05, release: 1.0 }
  }
};

// Inicializar Tone.js con PolySynth mejorado
async function initToneAudio() {
  try {
    if (toneInitialized) return;
    await Tone.start();
    recreateSampler();
    toneInitialized = true;
    console.log("🎹 Piano Tone.PolySynth listo (offline)");
  } catch (err) {
    console.error("Error al inicializar piano:", err);
    audioEnabled = false;
  }
}

// Recrear PolySynth con envolvente del instrumento actual
function recreateSampler() {
  // Destruir el anterior si existe
  if (sampler) {
    sampler.dispose();
    sampler = null;
  }

  // Crear nuevo PolySynth con la envolvente del instrumento
  const envelope = SYNTH_ENVELOPES[currentInstrument] || SYNTH_ENVELOPES['piano'];
  sampler = new Tone.PolySynth(Tone.Synth, envelope).toDestination();

  console.log(`🎵 Instrumento: ${currentInstrument} cargado`);
}

// Convertir motor (0-11) a nombre de nota MIDI + octava
function motorToNoteName(motor, octaveOffset) {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = notes[motor % 12];
  const octave = Math.floor(motor / 12) + octaveOffset;
  return noteName + octave;  // "C4", "D#3", etc.
}

// Convertir motor (0-11) a número MIDI (0-127)
function motorToMidiNote(motor, octaveOffset) {
  // Motor 0-11 corresponde a C0-B0 (notas 0-11)
  // octaveOffset suma octavas (típicamente 3 = C3)
  const baseNote = motor % 12;
  const octave = Math.floor(motor / 12) + octaveOffset;
  return baseNote + (octave * 12);  // C4 = 60
}

// Parsear comando ESP32 y reproducir con Tone.PolySynth
async function playCommandAsAudio(cmd, bpm) {
  if (!toneInitialized) await initToneAudio();
  if (!sampler) {
    console.error("❌ Sampler no inicializado");
    return;
  }

  let currentTime = 0;
  let currentMotor = 0;
  let lastVelocity = {};  // Rastrear velocidad anterior por motor
  const notesToPlay = {};  // Agrupar notas por tiempo para tocarlas simultáneamente

  // Parsear comandos separados por ; o \n
  const tokens = cmd.split(/[;\n]/).map(t => t.trim()).filter(t => t);

  // Primera pasada: recopilar todas las notas con sus tiempos
  for (const token of tokens) {
    const parts = token.split(/\s+/);
    if (!parts.length) continue;

    const cmd_char = parts[0];
    const value = parseInt(parts[1]);

    if (cmd_char === 'm') {
      currentMotor = value;
      currentTime = 0;  // Reiniciar tiempo al cambiar de motor (cada motor empieza en t=0)
    } else if (cmd_char === 't') {
      currentTime += value;
    } else if (cmd_char === 'v') {
      const velocity = value;
      const lastVel = lastVelocity[currentMotor] || 0;

      // Solo registrar si hay transición de 0→velocidad (note-on)
      if (lastVel === 0 && velocity > 0 && currentMotor >= 0 && currentMotor <= 11) {
        if (!notesToPlay[currentTime]) notesToPlay[currentTime] = [];
        notesToPlay[currentTime].push(currentMotor);
      }

      lastVelocity[currentMotor] = velocity;
    }
  }

  // Segunda pasada: tocar todas las notas agrupadas por tiempo
  let notesPlayed = 0;
  for (const timeStr in notesToPlay) {
    const time = parseInt(timeStr);
    const motors = notesToPlay[time];
    const noteTime = Tone.now() + (time / 1000);

    for (const motor of motors) {
      const noteName = motorToNoteName(motor, audioOctaveOffset);
      const duration = "8n";
      const velocity127 = 76;  // Velocidad estándar

      console.log(`🎹 Tocando ${noteName} en t=${noteTime.toFixed(3)}s`);
      sampler.triggerAttackRelease(noteName, duration, noteTime, velocity127 / 127);
      notesPlayed++;
    }
  }
  console.log(`✅ Notas tocadas: ${notesPlayed}`);
}

// ============================================================
// MODELO DE DATOS: steps[i] = 0 (vacío/ocupado) | D>0 (nota de D pasos que empieza aquí)
// Compatible con el modelo antiguo donde steps[i]=1 significa nota de 1/16.
// ============================================================

// Devuelve true si el paso i está cubierto por una nota que empieza antes de i.
function _isOccupied(steps, i) {
  for (let j = i - 1; j >= 0; j--) {
    if (steps[j] > 0) return (j + steps[j]) > i;
  }
  return false;
}

// Devuelve el índice de inicio de la nota que cubre el paso i, o -1 si no hay nota.
function _noteStart(steps, i) {
  if (steps[i] > 0) return i;
  for (let j = i - 1; j >= 0; j--) {
    if (steps[j] > 0) return (j + steps[j]) > i ? j : -1;
  }
  return -1;
}

// ============================================================
// GENERACIÓN DE COMANDOS
// ============================================================

function buildCommand(chs, _bpm, _hitDur, _numSteps) {
  const stepMs = Math.round(60000 / _bpm / 4);
  const hit    = Math.min(_hitDur, stepMs - 10);
  if (hit < 10) return '';
  // Tiempo de retracción: ms que el servo necesita para volver al neutro.
  // Se usa el global retractDur (ajustable por el usuario en la UI).
  const gapMs  = retractDur;

  // Fusionar canales que comparten motor: las notas no conflictivas se acumulan.
  const motorGroups = {};
  chs.forEach(ch => {
    if (ch.muted || !ch.steps.some(s => s)) return;
    const m = ch.motor;
    if (!motorGroups[m]) {
      motorGroups[m] = { ...ch, steps: ch.steps.slice() };
    } else {
      ch.steps.forEach((s, i) => {
        if (s > 0 && motorGroups[m].steps[i] === 0 && !_isOccupied(motorGroups[m].steps, i))
          motorGroups[m].steps[i] = s;
      });
      if (ch.vel     > motorGroups[m].vel)     motorGroups[m].vel     = ch.vel;
      if (ch.homePwm > motorGroups[m].homePwm) motorGroups[m].homePwm = ch.homePwm;
    }
  });

  let cmd = 'e;\n';
  let hasContent = false;
  Object.values(motorGroups).forEach(ch => {
    hasContent = true;
    cmd += `m ${ch.motor}; o ${ch.homePwm};\n`;
    const vHit    = `v ${ch.vel};`;
    const cycleMs = _numSteps * stepMs;
    let t = 0;

    for (let i = 0; i < _numSteps; i++) {
      const dur = ch.steps[i];
      if (!dur) continue;   // vacío o cubierto por nota anterior

      const noteStartMs = i * stepMs;
      const noteTotalMs = dur * stepMs;

      // Descanso antes de la nota
      const restMs = noteStartMs - t;
      if (restMs > 0) { cmd += `t ${restMs}; v 0;\n`; t = noteStartMs; }

      // Golpe inicial
      cmd += `t ${hit}; ${vHit}\n`;
      t += hit;

      // Sostener en posición de golpe (puede ser 0 para notas muy cortas)
      const holdMs   = Math.max(0, noteTotalMs - hit - gapMs);
      // Gap real: lo que queda tras hit + hold, siempre >= 0
      const actualGap = noteTotalMs - hit - holdMs;  // == min(gapMs, noteTotalMs - hit)
      if (holdMs > 0) { cmd += `t ${holdMs}; ${vHit}\n`; t += holdMs; }

      // Retracción al neutro: el servo tiene exactamente actualGap ms para volver
      cmd += `t ${actualGap}; v 0;\n`;
      t += actualGap;
    }

    // Silencio final hasta completar el ciclo
    if (t < cycleMs) cmd += `t ${cycleMs - t}; v 0;\n`;
  });
  if (!hasContent) return '';
  cmd += 'p;';
  return cmd;
}

// ---- Streaming compas a compas (modo infinito + SETLIVE) --------
// Mecanismo: el primer compas se envía como bucle infinito (igual que
// el drum machine clásico). Los siguientes se aplican con SETLIVE en
// cada boundary de ciclo. Así el STOP funciona igual de fiable que antes.

let drumStreamTimer    = null;
let drumStreamStartRef = 0;      // performance.now() cuando arrancó el stream
let drumStreamPauseIdx = -1;     // compás donde se pausó (-1 = sin pausa activa)
let isPausing          = false;  // true entre pulsar PAUSE y fin del compás actual

function _buildMeasureCmd(m) {
  const start  = m * 16;
  const sliced = channels.map(ch => ({ ...ch, steps: ch.steps.slice(start, start + 16) }));
  return buildCommand(sliced, bpm, hitDur, 16);
}

// Envía SETLIVE para el compas actual del stream y programa el siguiente
function _drumStreamTick() {

  
  if (!drumStreamActive) return;
  
  const m   = drumStreamIdx % numMeasures;
  const cmd = _buildMeasureCmd(m);
  
  if (cmd) {
    if (wsConnected && ws && ws.readyState === WebSocket.OPEN) {
      //ws.send('SETLIVE|' + (m + 1) + '\n' + cmd);

      sendCommand(cmd);

    } else {
      // Sin WebSocket no hay forma fiable/rápida de encadenar compases en drumStream.
      // Parar para evitar que se quede sonando el primer compás indefinidamente.
      drumStreamStop(); drumStreamPauseIdx = -1;
      isPlaying = false;
      stopMetronome();
      setRhythmState('hidden');
      document.getElementById('btnPlay').disabled  = false;
      document.getElementById('btnPause').disabled = true;
      setStatus('Error: WebSocket disconnected — cannot chain measures', 'error');
      return;
    }
  }
  drumStreamIdx++;

  // Programar el siguiente tick exactamente al final del compás actual
  const measureMs = Math.round(60000 / bpm / 4) * 16;
  const elapsed   = performance.now() - drumStreamStartRef;
  const nextFire  = drumStreamIdx * measureMs;
  const delay     = Math.max(50, nextFire - elapsed);
  drumStreamTimer = setTimeout(_drumStreamTick, delay);
}

function drumStreamStart() {
  drumStreamActive   = true;
  drumStreamIdx      = 1;          // el 0 se envía ahora como raw
  drumStreamStartRef = performance.now();

  // Compas 0: enviar como PLAY|compas0|1 (una sola vez) para permitir transición sin pausa
  const firstCmd = _buildMeasureCmd(0);
  if (!firstCmd) { drumStreamStop(); return; }
  if (wsConnected && ws && ws.readyState === WebSocket.OPEN) {
    ws.send('PLAY|compas0|1\n' + firstCmd);
    // Reproducir audio si está habilitado (siempre, incluso con WebSocket)
    if (audioEnabled && firstCmd.trim()) {
      playCommandAsAudio(firstCmd, bpm);
    }
  } else {
    // Fallback HTTP: enviar comando con p; (una vez)
    sendCommand(firstCmd);
  }
  
  
  // Si hay más de un compas, programar el primer SETLIVE exactamente al final del compás actual
  if (numMeasures > 1) {
    const measureMs = Math.round(60000 / bpm / 4) * 10;
     const preMs     = Math.round(measureMs * 0.75); // enviar 50% antes del boundary
    drumStreamTimer = setTimeout(_drumStreamTick, measureMs - preMs);
  }
}

function drumStreamStop() {
  drumStreamActive = false;
  drumStreamIdx    = 0;
  if (drumStreamTimer) { clearTimeout(drumStreamTimer); drumStreamTimer = null; }
}

// Pausa: cancela el envío del próximo compás y guarda la posición.
// El STOP al ESP32 lo envía el metrónomo al llegar al último paso del compás actual.
function drumStreamPause() {
  drumStreamPauseIdx = drumStreamIdx;  // próximo compás a enviar al reanudar
  drumStreamActive   = false;
  if (drumStreamTimer) { clearTimeout(drumStreamTimer); drumStreamTimer = null; }
}

// Reanuda desde el compás donde se pausó
function drumStreamResume() {
  isPausing = false;
  if (drumStreamPauseIdx < 0) { drumStreamStart(); return; }
  drumStreamActive   = true;
  drumStreamIdx      = drumStreamPauseIdx;
  drumStreamPauseIdx = -1;

  const m        = drumStreamIdx % numMeasures;
  const resumeCmd = _buildMeasureCmd(m);
  if (!resumeCmd) { drumStreamStop(); return; }

  if (wsConnected && ws && ws.readyState === WebSocket.OPEN) {
    ws.send('PLAY|compas0|1\n' + resumeCmd);
  } else {
    sendCommand(resumeCmd);
  }
  drumStreamIdx++;

  if (numMeasures > 1) {
    drumStreamStartRef = performance.now();
    const measureMs    = Math.round(60000 / bpm / 4) * 10;
    const preMs        = Math.round(measureMs * 0.75);
    drumStreamTimer    = setTimeout(_drumStreamTick, measureMs - preMs);
  }
}

// ---- Wrapper para el drum machine: usa globals y actualiza el textarea
function generateCommand() {
  const hasSteps = channels.some(ch => !ch.muted && ch.steps.some(s => s));
  const cmd = buildCommand(channels, bpm, hitDur, numSteps);
  if (!cmd) {
    const msg = hasSteps
      ? 'ERROR: BPM demasiado alto o golpe demasiado largo'
      : 'Sin golpes activos — marca algún paso para reproducir';
    setStatus(msg, hasSteps ? 'error' : 'warn');
    return '';
  }
  syncToSongQueue();
  return cmd;
}

// Sincroniza el estado actual del secuenciador de vuelta al patrón de la cola de canción.
// Se llama automáticamente desde generateCommand() tras cualquier cambio del usuario.
function syncToSongQueue() {
  if (_suppressSync || songLoadedIdx < 0 || songLoadedIdx >= songQueue.length) return;
  const e = songQueue[songLoadedIdx];
  e.bpm         = bpm;
  e.hitDur      = hitDur;
  e.numMeasures = numMeasures;
  e.channels    = channels.map(ch => Object.assign({}, ch, { steps: ch.steps.slice() }));
  if (!songLoadedModified) {
    songLoadedModified = true;
    renderSongQueue();   // solo re-renderiza la primera vez para mostrar el badge
  }
}

function updateMuteAllState() {
  const muteAllChk = document.getElementById('muteAll');
  if (!muteAllChk) return;
  const anyMuted = channels.some(c => c.muted);
  const allMuted = channels.length > 0 && channels.every(c => c.muted);
  muteAllChk.indeterminate = anyMuted && !allMuted;
  muteAllChk.checked = allMuted;
}

// ============================================================
// RENDER DEL SECUENCIADOR
// ============================================================
const SUB_LABELS = ['1','e','+','a'];

function render() {
  renderHeaders();
  renderChannels();
  _updateMeasureJumpBar();
  generateCommand();
}

function deleteMeasure(m) {
  if (numMeasures <= 1) return;
  const start = m * 16;
  channels.forEach(ch => ch.steps.splice(start, 16));
  numMeasures--;
  numSteps = numMeasures * 16;
  document.getElementById('measuresInput').value = numMeasures;
  render();
}

// Elimina 4 pasos (1 beat) a partir de beatGlobalIdx*4 y desplaza la secuencia
// a la izquierda. El final se rellena con 4 pasos vacíos para mantener la longitud.
function deleteBeat(beatGlobalIdx) {
  const startStep = beatGlobalIdx * 4;
  if (startStep >= numSteps) return;
  channels.forEach(ch => {
    ch.steps.splice(startStep, 4);
    // Rellenar al final para mantener la longitud total (numSteps)
    while (ch.steps.length < numSteps) ch.steps.push(0);
  });
  render();
  const cmd = generateCommand();
  if (isPlaying && cmd) sendLive(cmd);
  setStatus(`Beat ${beatGlobalIdx + 1} deleted — sequence shifted`);
}

function playMeasure(m) {
  drumStreamStop();
  const start     = m * 16;
  const slicedChs = channels.map(ch => ({ ...ch, steps: ch.steps.slice(start, start + 16) }));
  const cmd       = buildCommand(slicedChs, bpm, hitDur, 16);
  if (!cmd) { setStatus('Measure ' + (m + 1) + ' has no active hits', 'warn'); return; }
  sendCommand('PLAY|compas_' + (m + 1) + '|1\n' + cmd);
  setStatus('▶ Measure ' + (m + 1) + ' — single playback');
}

function playBeat(beatGlobalIdx) {
  drumStreamStop();
  const start     = beatGlobalIdx * 4;  // 1 beat = 4 pasos
  const slicedChs = channels.map(ch => ({ ...ch, steps: ch.steps.slice(start, start + 4) }));
  const cmd       = buildCommand(slicedChs, bpm, hitDur, 4);
  if (!cmd) { setStatus('Beat ' + (beatGlobalIdx + 1) + ' has no active hits', 'warn'); return; }
  sendCommand('PLAY|beat_' + (beatGlobalIdx + 1) + '|1\n' + cmd);
  setStatus('▶ Beat ' + (beatGlobalIdx + 1) + ' — single playback');
}

function toggleMeasureSel(m) {
  if (selectedMeasures.has(m)) selectedMeasures.delete(m);
  else selectedMeasures.add(m);
  _updateMeasureSelBar();
  // Re-render solo la fila de cabeceras para reflejar el estado visual
  renderHeaders();
}

function _updateMeasureSelBar() {
  const bar   = document.getElementById('measureSelBar');
  const label = document.getElementById('measureSelLabel');
  if (!bar) return;
  if (selectedMeasures.size === 0) {
    bar.classList.remove('visible');
  } else {
    const sorted = [...selectedMeasures].sort((a, b) => a - b).map(m => 'C' + (m + 1)).join(', ');
    label.textContent = sorted;
    bar.classList.add('visible');
  }
}

function _updateMeasureJumpBar() {
  const bar = document.getElementById('measureJumpBar');
  if (!bar) return;
  bar.style.display = numMeasures > 1 ? 'flex' : 'none';
}

function jumpToMeasure(m) {
  if (m < 1 || m > numMeasures) return;
  // Buscar el header del compás m (0-indexed: m-1)
  const headers = document.querySelectorAll('.measure-label');
  if (m - 1 < headers.length) {
    const target = headers[m - 1];
    // Scroll al elemento (con offset para verlo bien en pantalla)
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  }
}

function addSelMeasuresToQueue() {
  if (selectedMeasures.size === 0) return;
  const sorted    = [...selectedMeasures].sort((a, b) => a - b);
  const measureSeq = sorted.map(m => m + 1).join(',');  // 1-based para songSendNext
  const name      = sorted.map(m => 'C' + (m + 1)).join('\xB7');  // "C1·C3"
  songQueue.push({
    name,
    channels:    channels.map(ch => Object.assign({}, ch, { steps: ch.steps.slice() })),
    bpm,
    hitDur,
    numMeasures,
    repeats:     1,
    measureSeq
  });
  renderSongQueue();
  // Cambiar al tab de cancion para que el usuario vea el resultado
  const tabSong = document.querySelector('[data-tab="tab-cancion"]');
  if (tabSong) tabSong.click();
  setStatus('Measures ' + name + ' added to queue');
  // Limpiar seleccion
  selectedMeasures.clear();
  _updateMeasureSelBar();
  renderHeaders();
}

function renderHeaders() {
  const thead = document.getElementById('stepHeaders');
  let html = '';

  // Fila 0: etiquetas de compás (C1, C2, …)
  // Cada compás ocupa 16 celdas de paso + 3 beat-gaps internos = 19 columnas
  html += '<tr>';
  html += '<th colspan="1" class="seq-header-info"></th>';
  for (let m = 0; m < numMeasures; m++) {
    if (m > 0) html += '<td class="measure-gap"></td>';
    const btnStyle = 'position:absolute;top:50%;transform:translateY(-50%);background:transparent;border:none;color:inherit;opacity:0.35;cursor:pointer;font-size:11px;padding:0 2px;line-height:1';
    const playBtn = `<button onclick="playMeasure(${m})" title="Reproducir compás ${m+1}" style="${btnStyle};left:3px" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.35">▶</button>`;
    const delBtn  = numMeasures > 1
      ? `<button onclick="deleteMeasure(${m})" title="Borrar compás ${m+1}" style="${btnStyle};right:3px" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.35">✕</button>`
      : '';
    const selClass = selectedMeasures.has(m) ? ' sel' : '';
    html += `<th colspan="19" class="measure-label mc${m % 4}${selClass}" style="position:relative" onclick="toggleMeasureSel(${m})">C${m + 1}${playBtn}${delBtn}</th>`;
  }
  html += '</tr>';

  // Fila 1: números de tiempo (1 e + a) con color del compás al que pertenecen
  html += '<tr>';
  html += '<th colspan="1" class="seq-header-info"></th>';

  for (let s = 0; s < numSteps; s++) {
    if (s > 0 && s % 16 === 0)     html += '<td class="measure-gap"></td>';
    else if (s > 0 && s % 4 === 0) html += '<td class="beat-gap"></td>';
    const isBeat     = (s % 4 === 0);
    const measureIdx = Math.floor(s / 16);
    const beatNum    = (s % 16) / 4 + 1;
    const mcClass    = ` mc${measureIdx % 4}`;
    if (isBeat) {
      const beatGlobalIdx = s / 4;
      html += `<th class="step-header-cell beat${mcClass}"><button class="beat-play-btn" onclick="playBeat(${beatGlobalIdx})" title="Reproducir beat ${beatNum}">▶</button>${beatNum}<button class="beat-del-btn" onclick="deleteBeat(${beatGlobalIdx})" title="Borrar beat — desplaza secuencia">✕</button></th>`;
    } else {
      html += `<th class="step-header-cell${mcClass}">${SUB_LABELS[s % 4]}</th>`;
    }
  }
  html += '</tr>';
  thead.innerHTML = html;

}

function renderChannels() {
  const tbody = document.getElementById('channelRows');
  tbody.innerHTML = '';

  channels.forEach((ch, ci) => {
    const tr = document.createElement('tr');
    tr.classList.toggle('ch-muted', !!ch.muted);

    // Columna info (sticky) — solo nombre visible; resto en panel desplegable
    const tdInfo = document.createElement('td');
    tdInfo.className = 'ch-info-sticky';
    tdInfo.style.position = 'sticky'; // refuerzo para algunos navegadores

    const infoDiv = document.createElement('div');
    infoDiv.className = 'ch-info-inner';

    const nameIn = document.createElement('input');
    nameIn.type = 'text'; nameIn.className = 'ch-name-input';
    nameIn.value = ch.name;
    nameIn.oninput = e => { channels[ci].name = e.target.value; syncToSongQueue(); };
    infoDiv.appendChild(nameIn);

    const optBtn = document.createElement('button');
    optBtn.className = 'ch-opt-btn';
    optBtn.textContent = '⋯';
    optBtn.title = 'Channel options';
    infoDiv.appendChild(optBtn);

    // Panel de opciones
    const optPanel = document.createElement('div');
    optPanel.className = 'ch-opt-panel';

    // Motor
    const motorRow = document.createElement('div');
    motorRow.className = 'ch-opt-row';
    const motorLabel = document.createElement('span');
    motorLabel.className = 'ch-label-mini'; motorLabel.textContent = 'Motor';
    const sel = document.createElement('select');
    sel.className = 'ch-motor-sel';
    for (let m = 0; m < MAX_CH; m++) {
      const opt = document.createElement('option');
      opt.value = m; opt.textContent = m;
      if (m === ch.motor) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.onchange = e => { channels[ci].motor = parseInt(e.target.value); const cmd = generateCommand(); if (isPlaying && cmd) sendLive(cmd); };
    motorRow.appendChild(motorLabel); motorRow.appendChild(sel);
    optPanel.appendChild(motorRow);

    // Velocidad
    const velRow = document.createElement('div');
    velRow.className = 'ch-opt-row';
    const velLabel = document.createElement('span');
    velLabel.className = 'ch-label-mini'; velLabel.textContent = 'Vel';
    const velIn = document.createElement('input');
    velIn.type = 'number'; velIn.className = 'ch-vel-input';
    velIn.value = ch.vel;
    velIn.onchange = e => { channels[ci].vel = parseInt(e.target.value) || 60; const cmd = generateCommand(); if (isPlaying && cmd) sendLive(cmd); };
    velRow.appendChild(velLabel); velRow.appendChild(velIn);
    optPanel.appendChild(velRow);

    // Mute
    const muteRow = document.createElement('div');
    muteRow.className = 'ch-opt-row';
    const muteLbl = document.createElement('label');
    muteLbl.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:#888;';
    const muteChk = document.createElement('input');
    muteChk.type = 'checkbox';
    muteChk.checked = !!ch.muted;
    muteChk.style.accentColor = '#e74c3c';
    muteChk.onchange = e => {
      channels[ci].muted = e.target.checked;
      tr.classList.toggle('ch-muted', channels[ci].muted);
      updateMuteAllState();
      const cmd = generateCommand();
      if (isPlaying && cmd) sendLive(cmd);
    };
    muteLbl.appendChild(muteChk);
    muteLbl.appendChild(document.createTextNode(' Mute'));
    muteRow.appendChild(muteLbl);
    optPanel.appendChild(muteRow);

    // Test + Eliminar
    const btnRow = document.createElement('div');
    btnRow.className = 'ch-opt-row';
    btnRow.style.borderTop = '1px solid #2a2a44';
    btnRow.style.paddingTop = '6px';
    const testBtn = document.createElement('button');
    testBtn.className = 'btn btn-calib btn-test-hit';
    testBtn.textContent = '🥁 Test';
    testBtn.title = 'Test hit';
    testBtn.onclick = () => {
      const stepMs = Math.round(60000 / bpm / 4);
      const hit = Math.min(hitDur, stepMs - 10);
      const rest = stepMs - hit;
      const cmd = `e; m ${channels[ci].motor}; o ${channels[ci].homePwm}; t ${hit}; v ${channels[ci].vel}; t ${rest}; v 0; p;`;
      sendCommand(cmd);
      setStatus(`Testing hit on channel "${channels[ci].name}"`);
    };
    const delBtn = document.createElement('button');
    delBtn.className = 'ch-del-btn'; delBtn.textContent = '✕ Delete';
    delBtn.title = 'Delete channel';
    delBtn.onclick = () => { if (channels.length > 1) { channels.splice(ci, 1); render(); } };
    btnRow.appendChild(testBtn); btnRow.appendChild(delBtn);
    optPanel.appendChild(btnRow);

    // Toggle
    optBtn.onclick = e => {
      e.stopPropagation();
      const alreadyOpen = optPanel.classList.contains('open');
      document.querySelectorAll('.ch-opt-panel.open').forEach(p => p.classList.remove('open'));
      document.querySelectorAll('.ch-opt-btn.open').forEach(b => b.classList.remove('open'));
      if (!alreadyOpen) {
        const rect = optBtn.getBoundingClientRect();
        optPanel.style.left = rect.right + 'px';
        optPanel.style.top  = rect.top + 'px';
        optPanel.classList.add('open');
        optBtn.classList.add('open');
      }
    };
    optPanel.addEventListener('click', e => e.stopPropagation());

    tdInfo.appendChild(infoDiv);
    tdInfo.appendChild(optPanel);
    tr.appendChild(tdInfo);

    // Pre-calcular clases de bloque por duración de nota (steps[i] = duración en 1/16)
    const _susClass = new Array(numSteps).fill('');
    for (let i = 0; i < numSteps; i++) {
      const dur = ch.steps[i];
      if (dur > 0) {
        const end = Math.min(i + dur - 1, numSteps - 1);
        if (dur === 1) {
          _susClass[i] = 'sus-solo';
        } else {
          _susClass[i] = 'sus-start';
          for (let j = i + 1; j < end; j++) _susClass[j] = 'sus-mid';
          if (end > i) _susClass[end] = 'sus-end';
        }
      }
    }

    // Botones de paso
    for (let s = 0; s < numSteps; s++) {
      if (s > 0 && s % 16 === 0) {
        const gap = document.createElement('td');
        gap.className = 'measure-gap'; tr.appendChild(gap);
      } else if (s > 0 && s % 4 === 0) {
        const gap = document.createElement('td');
        gap.className = 'beat-gap'; tr.appendChild(gap);
      }
      const td = document.createElement('td');
      const btn = document.createElement('button');
      btn.className = 'step-btn' +
        (_susClass[s] ? ' on' : ' off') +
        (_susClass[s] ? ' ' + _susClass[s] : '') +
        (currentStep === s ? ' current' : '');
      btn.dataset.ci = ci; btn.dataset.s = s;
      btn.title = 'Click: add/remove note · Right-click: choose duration';
      btn.onclick = () => {
        if (seqDragMoved) { seqDragMoved = false; return; }
        toggleStep(ci, s);
      };
      btn.oncontextmenu = ev => { ev.preventDefault(); showDurationPicker(ev, ci, s); };
      td.appendChild(btn);
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  });
}

function toggleStep(ci, si) {
  const steps = channels[ci].steps;
  const ns = _noteStart(steps, si);
  if (ns >= 0) {
    steps[ns] = 0;   // quitar la nota (basta con poner a 0 el inicio)
  } else {
    steps[si] = 1;   // añadir nota de 1/16 (duración 1 paso)
  }
  renderChannels();
  const cmd = generateCommand();
  if (isPlaying && cmd) sendLive(cmd);
}

// Picker de duración (clic derecho sobre cualquier celda)
function showDurationPicker(e, ci, stepIdx) {
  const existing = document.getElementById('durPicker');
  if (existing) existing.remove();

  const steps  = channels[ci].steps;
  // Si el click es sobre una nota existente, editar esa nota; si no, añadir nueva aquí.
  const ns     = _noteStart(steps, stepIdx) >= 0 ? _noteStart(steps, stepIdx) : stepIdx;

  const stepMs = Math.round(60000 / bpm / 4);
  const opts = [
    { sym: '♬', label: '1/16', steps: 1  },
    { sym: '♪', label: '1/8',  steps: 2  },
    { sym: '♩', label: '1/4',  steps: 4  },
    { sym: '𝅗𝅥', label: '1/2',  steps: 8  },
    { sym: '𝅝',  label: '1',    steps: 16 },
  ];

  const picker = document.createElement('div');
  picker.id = 'durPicker';
  picker.style.cssText = [
    'position:fixed', 'background:#e8dac8', 'border:1px solid #3a6a9a',
    'border-radius:8px', 'padding:8px', 'display:flex', 'gap:6px',
    'z-index:9999', 'box-shadow:0 4px 24px rgba(80,40,10,.25)',
    'font-family:"Courier New",monospace'
  ].join(';');
  picker.style.left = Math.min(e.clientX - 40, window.innerWidth - 270) + 'px';
  picker.style.top  = Math.max(4, e.clientY - 95) + 'px';

  // Agregar botón Paste primero si hay contenido en el portapapeles
  if (seqClipboard) {
    const pb = document.createElement('button');
    pb.style.cssText = 'background:#d8e8f5;border:1px solid #3a6a9a;border-radius:6px;color:#3a6a9a;cursor:pointer;padding:5px 9px;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:44px;font-family:inherit;';
    pb.innerHTML = '<span style="font-size:15px">📋</span><span style="font-size:10px">Paste</span><span style="font-size:9px;color:#6a8aaa">' + seqClipboard.rows + '×' + seqClipboard.cols + '</span>';
    pb.onmouseover = () => { pb.style.borderColor = '#2a5a8a'; pb.style.background = '#b8d0e8'; };
    pb.onmouseout  = () => { pb.style.borderColor = '#3a6a9a'; pb.style.background = '#d8e8f5'; };
    pb.onclick = () => { _pasteFromClipboard(ci, stepIdx); picker.remove(); };
    picker.appendChild(pb);
    const sep = document.createElement('div');
    sep.style.cssText = 'width:1px;background:#c8a882;align-self:stretch;margin:0 4px;flex-shrink:0;';
    picker.appendChild(sep);
  }

  opts.forEach(opt => {
    const ms = opt.steps * stepMs;
    const msLabel = ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms';
    const ob = document.createElement('button');
    ob.style.cssText = 'background:#ddd0b8;border:1px solid #c8a882;border-radius:6px;color:#2c1e12;cursor:pointer;padding:5px 9px;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:38px;font-family:inherit;';
    ob.innerHTML = `<span style="font-size:15px">${opt.sym}</span><span style="font-size:10px;color:#6b4c3b">${opt.label}</span><span style="font-size:9px;color:#9a7860">${msLabel}</span>`;
    ob.onmouseover = () => { ob.style.borderColor = '#3a6a9a'; ob.style.background = '#c8d8e8'; };
    ob.onmouseout  = () => { ob.style.borderColor = '#c8a882'; ob.style.background = '#ddd0b8'; };
    ob.onclick = () => {
      const dur = Math.min(opt.steps, steps.length - ns);
      // Borrar todas las notas que queden dentro del nuevo rango (sobreescribir)
      for (let i = ns + 1; i < ns + dur; i++) {
        if (steps[i] > 0) steps[i] = 0;
      }
      steps[ns] = dur;
      picker.remove();
      renderChannels();
      const cmd = generateCommand();
      if (isPlaying && cmd) sendLive(cmd);
    };
    picker.appendChild(ob);
  });

  document.body.appendChild(picker);
  setTimeout(() => {
    const close = ev => { if (!picker.contains(ev.target)) { picker.remove(); document.removeEventListener('mousedown', close); } };
    document.addEventListener('mousedown', close);
  }, 0);
}

// ============================================================
// METRÓNOMO VISUAL (JS-side, aproximado)
// ============================================================
// ============================================================
// FUSIONAR — aplica una duración objetivo a todos los canales
// ============================================================
function snapAllChannels(targetSteps) {
  let totalMerged = 0;
  let affectedCh  = 0;

  channels.forEach(ch => {
    const s = ch.steps;
    const n = s.length;
    let merged = 0;

    if (targetSteps === 1) {
      // Expandir: toda nota de duración > 1 se despliega en 1/16 individuales
      for (let i = 0; i < n; i++) {
        if (s[i] > 1) {
          const end = Math.min(i + s[i], n);
          for (let j = i + 1; j < end; j++) s[j] = 1;
          s[i] = 1;
          merged++;
        }
      }
    } else {
      // Agrupar: dentro de cada compás (16 pasos), iterar grupos de targetSteps
      // alineados a sus fronteras naturales. Solo fusiona si TODOS los pasos
      // del grupo contienen exactamente una nota 1/16 (steps[i] === 1).
      for (let mStart = 0; mStart < n; mStart += 16) {
        for (let g = mStart; g + targetSteps <= mStart + 16; g += targetSteps) {
          let allOne = true;
          for (let j = g; j < g + targetSteps; j++) {
            if (s[j] !== 1) { allOne = false; break; }
          }
          if (allOne) {
            s[g] = targetSteps;
            for (let j = g + 1; j < g + targetSteps; j++) s[j] = 0;
            merged++;
          }
        }
      }
    }

    if (merged > 0) { totalMerged += merged; affectedCh++; }
  });

  renderChannels();
  const cmd = generateCommand();
  if (isPlaying && cmd) sendLive(cmd);

  const durLabel = ['','1/16','1/8','','1/4','','','','1/2','','','','','','','','1'][targetSteps] || targetSteps;
  if (totalMerged > 0)
    setStatus(`Merge ${durLabel} → ${totalMerged} group${totalMerged>1?'s':''} in ${affectedCh} channel${affectedCh>1?'s':''}`);
  else
    setStatus(`Merge ${durLabel} → no eligible groups`);
}

// Convierte cada nota 1/16 aislada en 1/8 usando el hueco adyacente libre.
// Prioridad: izquierda → derecha. Respeta fronteras de compás.
// Elimina compases duplicados: conserva solo la primera aparición de cada patrón único.
function deduplicateMeasures() {
  const seen = new Set();
  const keepIdx = [];

  for (let m = 0; m < numMeasures; m++) {
    const start = m * 16;
    const sig = channels.map(ch => ch.steps.slice(start, start + 16).join(',')).join('|');
    if (!seen.has(sig)) { seen.add(sig); keepIdx.push(m); }
  }

  const originalMeasures = numMeasures;
  const removed = numMeasures - keepIdx.length;
  if (removed === 0) { setStatus(`Unique measures → ${numMeasures} measures, no duplicates`); return; }

  channels.forEach(ch => {
    ch.steps = keepIdx.flatMap(m => ch.steps.slice(m * 16, m * 16 + 16));
  });
  numMeasures = keepIdx.length;
  numSteps    = numMeasures * 16;
  document.getElementById('measuresInput').value = numMeasures;

  render();
  syncToSongQueue();
  const cmd = generateCommand();
  if (isPlaying && cmd) sendLive(cmd);
  setStatus(`Unique measures → ${originalMeasures} original → ${numMeasures} unique (${removed} duplicate${removed > 1 ? 's' : ''} removed)`);
}

function convert16to8() {
  let total = 0;
  let affectedCh = 0;

  channels.forEach(ch => {
    const s = ch.steps;
    const n = s.length;
    let converted = 0;

    for (let i = 0; i < n; i++) {
      if (s[i] !== 1) continue;                        // solo notas 1/16

      const mEnd = Math.floor(i / 16) * 16 + 15;

      // Solo derecha: el paso i+1 debe estar libre (dentro del mismo compás)
      if (i < mEnd && s[i + 1] === 0 && !_isOccupied(s, i + 1)) {
        s[i]     = 2;
        s[i + 1] = 0;                                  // pasa a cola
        converted++;
        i++;                                           // saltar la cola ya procesada
      }
    }

    if (converted > 0) { total += converted; affectedCh++; }
  });

  renderChannels();
  const cmd = generateCommand();
  if (isPlaying && cmd) sendLive(cmd);

  if (total > 0)
    setStatus(`1/16→1/8 → ${total} note${total > 1 ? 's' : ''} in ${affectedCh} channel${affectedCh > 1 ? 's' : ''}`);
  else
    setStatus('1/16→1/8 → no eligible notes');
}

function startMetronome(startStep = 0) {
  // Inicializar Tone.Transport si aún no está hecho
  if (!toneInitialized) {
    Tone.Transport.bpm.value = bpm;
  }

  // Configurar el BPM en Tone.Transport
  Tone.Transport.bpm.value = bpm;

  currentStep = startStep;
  updateHighlight();

  // Crear un callback cada paso (cada 1/16)
  let stepCallback = Tone.Transport.scheduleRepeat((_time) => {
    const prevStep = currentStep;
    currentStep = (currentStep + 1) % numSteps;
    updateHighlight();

    // Pausa pendiente: esperar al último paso del compás actual para parar limpiamente
    if (isPausing && currentStep % 16 === 15) {
      isPausing = false;
      isPlaying = false;
      Tone.Transport.stop();
      Tone.Transport.cancel();
      sendStop();
      setRhythmState('hidden');
      document.getElementById('btnPlay').disabled    = true;
      document.getElementById('btnPause').disabled   = false;
      document.getElementById('btnPause').textContent = '▶ RESUME';
      document.getElementById('btnStop').disabled    = false;
      setStatus('⏸ Paused — press RESUME to continue');
    }

    // Parada automática cuando termina la canción (vuelve a 0)
    if (currentStep === 0 && prevStep === numSteps - 1 && !isPausing) {
      isPlaying = false;
      Tone.Transport.stop();
      Tone.Transport.cancel();
      sendStop();
      setRhythmState('hidden');
      document.getElementById('btnPlay').disabled    = false;
      document.getElementById('btnPause').disabled   = true;
      document.getElementById('btnStop').disabled    = false;
      setStatus('Ready');
    }
  }, '16n');  // cada 1/16 nota

  // Guardar referencia para poder cancelarla después
  metroTimer = stepCallback;

  // Iniciar Tone.Transport
  Tone.Transport.start();
}

function stopMetronome(keepPosition = false) {
  // Detener Tone.Transport
  if (Tone.Transport.state === 'started') {
    Tone.Transport.stop();
  }

  // Cancelar todos los eventos programados
  Tone.Transport.cancel();

  metroTimer = null;
  if (!keepPosition) {
    currentStep = -1;
    updateHighlight();
  }
}

function updateHighlight() {
  document.querySelectorAll('.step-btn').forEach(btn => {
    const s = parseInt(btn.dataset.s);
    btn.classList.toggle('current', s === currentStep);
  });
  if (isPlaying && currentStep >= 0) _autoScroll(currentStep);
}

function _autoScroll(step) {
  const wrap = document.querySelector('.sequencer-wrap');
  if (!wrap) return;
  const btn = document.querySelector(`.step-btn[data-s="${step}"][data-ci="0"]`);
  if (!btn) return;

  // Posición absoluta del botón dentro del contenedor scrollable
  const btnLeft = btn.getBoundingClientRect().left
                - wrap.getBoundingClientRect().left
                + wrap.scrollLeft;

  // Queremos que el paso actual quede a 1/4 del ancho visible
  const targetX = Math.round(wrap.clientWidth * 0.25);
  wrap.scrollLeft = btnLeft - targetX;
}


function setBpm(val) {
  bpm = val;
  document.getElementById('bpmSlider').value = val;
  document.getElementById('bpmValue').value  = val;
  const cmd = generateCommand();
  if (isPlaying) {
    if (!drumStreamActive && cmd) sendCommand(cmd);
    stopMetronome(); startMetronome();
  }
}

// ============================================================
// WEBSOCKET + COMUNICACIÓN CON ESP32
// ============================================================
let ws          = null;
let wsConnected = false;

function initWS() {
  const url = 'ws://' + ESP32_IP + ':81';
  ws = new WebSocket(url);
  ws.onopen  = () => {
    wsConnected = true;
    const dot = document.getElementById('wsDot');
    if (dot) { dot.classList.add('on'); dot.classList.remove('off'); }
    setStatus('WebSocket connected');
    setTimeout(() => { if (document.getElementById('statusBar').textContent === 'WebSocket connected') setStatus('Ready'); }, 2000);
  };
  ws.onclose = () => {
    wsConnected = false;
    const dot = document.getElementById('wsDot');
    if (dot) { dot.classList.remove('on'); dot.classList.add('off'); }

    // Si estamos en drumStream con varios compases, sin WS no podemos seguir avanzando.
    if (drumStreamActive && numMeasures > 1) {
      drumStreamStop(); drumStreamPauseIdx = -1;
      isPlaying = false;
      stopMetronome();
      setRhythmState('hidden');
      document.getElementById('btnPlay').disabled  = false;
      document.getElementById('btnPause').disabled = true;
      setStatus('Error: WebSocket disconnected — playback stopped', 'error');
    }

    setTimeout(initWS, 3000);
  };
  ws.onerror = () => { wsConnected = false; };
  ws.onmessage = e => {
    try { handleEspMsg(JSON.parse(e.data)); } catch (_) {}
  };
}

// Comprueba si el ESP32 responde. Llama onOk() si está disponible,
// muestra error y llama onFail() si no responde en 2.5 s.
function checkESP32(onOk, onFail) {
  if (wsConnected && ws && ws.readyState === WebSocket.OPEN) {
    onOk(); return;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  fetch('http://' + ESP32_IP + '/', { method: 'HEAD', signal: ctrl.signal })
    .then(() => { clearTimeout(timer); onOk(); })
    .catch(() => {
      clearTimeout(timer);
      setStatus('ESP32 not responding at ' + ESP32_IP + ' — check IP and network', 'error');
      if (onFail) onFail();
    });
}

// Envía un comando: usa WS si esta disponible, cae en fetch si no
function sendCommand(cmd) {
  if (wsConnected && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(cmd);
  } else {
    // Timeout corto (1.5s) para no bloquear el audio si no hay ESP32
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    fetch('http://' + ESP32_IP + '/command?cmd=' + encodeURIComponent(cmd), { signal: ctrl.signal })
      .then(r => r.text())
      .then(() => { clearTimeout(timer); })
      .catch(() => {
        clearTimeout(timer);
        // Silenciar error si es timeout o conexión rechazada — el piano seguirá funcionando
      });
  }

  // Reproducir audio si está habilitado (siempre, incluso sin ESP32)
  if (audioEnabled && cmd.trim()) {
    playCommandAsAudio(cmd, bpm);
  }
}

// Actualización en vivo del patrón durante la reproducción.
// Usa SETLIVE para que el firmware nunca auto-arranque si está parado,
// evitando la race condition entre ediciones rápidas y STOP.
function sendLive(cmd) {
  if (drumStreamActive) return; // en stream mode los cambios se aplican en el proximo ciclo
  if (wsConnected && ws && ws.readyState === WebSocket.OPEN) {
    ws.send('SETLIVE\n' + cmd);
  } else {
    // Fallback HTTP: usa el endpoint raw (backward compat) con timeout corto
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1000);
    fetch('http://' + ESP32_IP + '/command?cmd=' + encodeURIComponent(cmd), { signal: ctrl.signal })
      .catch(() => { clearTimeout(timer); });
  }
}

// Parada inmediata — envía STOP por WS y x; por HTTP como respaldo garantizado
function sendStop() {
  midiPageActive = false;
  midiPages      = [];
  if (wsConnected && ws && ws.readyState === WebSocket.OPEN) {
    ws.send('STOP');
  }
  // Siempre enviamos también por HTTP: el ESP32 lo procesa en server.handleClient()
  // incluso cuando está dentro del bucle de reproducción, garantizando la parada.
  // Con timeout corto para no bloquear si no hay ESP32 disponible
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1000);
  fetch('http://' + ESP32_IP + '/command?cmd=' + encodeURIComponent('x;'), { signal: ctrl.signal })
    .catch(() => { clearTimeout(timer); });
}

// Mensajes push del ESP32 → browser
function handleEspMsg(d) {
  if (!d || !d.state) return;
  if (d.state === 'playing') {
    songUpdateUI(d.pat, d.cycle, d.total);
    if (songActive) {
      setRhythmState('playing', d.pat + ' — ' + d.cycle + '/' + d.total);
    } else if (isPlaying) {
      // Drum machine: el ESP32 confirma que sigue reproduciendo → mantener panel visible
      setRhythmState('playing');
    }
  } else if (d.state === 'ready') {
    // El ESP32 esta en su ultimo ciclo del patron actual: enviamos el siguiente
    if (midiPageActive)  midiSendNextPage();
    // songSendNext solo actúa si hay patrones pendientes de enviar
    else if (songActive && songPlayIdx < songQueue.length) songSendNext();
    // drumStream usa modo infinito + SETLIVE, no necesita manejar 'ready'
  } else if (d.state === 'ack') {
    // ACK del firmware: confirma que el patrón/página pendiente fue recibida
    // El firmware incluye el nombre del patrón en d.pat (wsPushState).
    if (midiPageActive && typeof d.pat === 'string' && d.pat.startsWith('midi|')) {
      const parts = d.pat.split('|');
      const pageId = parseInt(parts[2]) || 0;
      if (pageId && pageId === midiAwaitAckPage) {
        midiAwaitAckPage = 0;
        midiAckRetries = 0;
        if (midiAckTimer) { clearTimeout(midiAckTimer); midiAckTimer = null; }
        // Si ya hemos recibido un READY y estábamos bloqueados esperando ACK,
        // esto permite continuar enviando la siguiente página inmediatamente.
        midiSendNextPage();
      }
    }
  } else if (d.state === 'finished') {
    if (midiPageActive) {
      // La última página terminó
      midiPageActive = false;
      isPlaying      = false;
      stopMetronome();
      setRhythmState('hidden');
      setStatus('MIDI completed (' + midiPages.length + ' pages)');
    } else {
      songActive   = false;
      songPlayIdx  = 0;
      isPlaying    = false;
      stopMetronome();
      songUpdateUI(null, 0, 0);
      setRhythmState('hidden');
      setStatus('Song completed');
    }
  }
}

function setStatus(msg, cls) {
  const bar = document.getElementById('statusBar');
  bar.textContent = msg;
  bar.className = 'status-bar' + (cls ? ' ' + cls : '');
}

// ============================================================
// GUARDAR / CARGAR
// ============================================================
function saveRhythm() {
  let data = JSON.stringify({ bpm, hitDur, numMeasures, channels }, null, 2);
  // Comprimir los arrays "steps" a una sola línea
  data = data.replace(/"steps":\s*\[\s*([^\]]*?)\s*\]/gs, (match) => {
    return match.replace(/\s+/g, ' ').replace(/\[\s+/, '[').replace(/\s+\]/, ']');
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = 'ritmo.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

// Convert current sequencer grid to MML-R (GrooveScript) text
function saveAsGrooveScript() {
  const NM       = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const gridSize = numMeasures * 16;

  // Collect hits: position → { semitones[], dur }
  const hits = {};
  for (let ch = 0; ch < 12; ch++) {
    if (!channels[ch] || channels[ch].muted) continue;
    for (let i = 0; i < gridSize; i++) {
      const v = channels[ch].steps[i];
      if (v > 0) {
        if (!hits[i]) hits[i] = { semitones: [], dur: v };
        else hits[i].dur = Math.max(hits[i].dur, v);
        hits[i].semitones.push(ch);
      }
    }
  }

  // Build ordered event list with rests between hits
  const events = [];
  let pos = 0;
  while (pos < gridSize) {
    if (hits[pos]) {
      events.push({ type: 'note', semitones: hits[pos].semitones, dur: hits[pos].dur });
      pos += hits[pos].dur;
    } else {
      let nextHit = pos + 1;
      while (nextHit < gridSize && !hits[nextHit]) nextHit++;
      events.push({ type: 'rest', dur: nextHit - pos });
      pos = nextHit;
    }
  }

  // Duration steps → MML-R string
  const durToStr = d => ({ 16:'1', 8:'1/2', 4:'1/4', 2:'1/8', 1:'1/16' }[d] || `${d}/16`);

  // Build MML-R text, adding | measure separators every 16 steps
  const lines = [`@TEMPO=${bpm}`, '@DEFAULT_DUR=1/4', ''];
  let line = '', stepCount = 0;
  for (const ev of events) {
    let token;
    if (ev.type === 'rest') {
      token = `R:${durToStr(ev.dur)}`;
    } else if (ev.semitones.length === 1) {
      token = `${NM[ev.semitones[0]]}:${durToStr(ev.dur)}`;
    } else {
      token = `(${ev.semitones.map(s => NM[s]).join(' ')}):${durToStr(ev.dur)}`;
    }
    line += (line ? ' ' : '') + token;
    stepCount += ev.dur;
    if (stepCount % 16 === 0) {
      lines.push(line + ' |');
      line = '';
    }
  }
  if (line) lines.push(line);

  const text = lines.join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = 'groove.mmlr';
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus('✓ Saved as GrooveScript (.mmlr)');
}

// ---- Indicador visual de estado del ritmo ------------------
function setRhythmState(state, label) {
  const panel = document.getElementById('rhythmStatePanel');
  const icon  = document.getElementById('rhythmStateIcon');
  const txt   = document.getElementById('rhythmStateTxt');

  if (state === 'pending') {
    panel.className = 'rhythm-state-panel pending';
    icon.textContent = '⏳';
    txt.textContent  = label || 'Esperando fin de ciclo...';
    setStatus('Changing rhythm — waiting for next cycle', 'pending');
  } else if (state === 'playing') {
    panel.className = 'rhythm-state-panel playing';
    icon.textContent = '▶';
    txt.textContent  = label || ('Playing — ' + bpm + ' BPM');
    setStatus('▶ Playing — BPM ' + bpm, 'playing');
    // Ocultar el panel 3 s después SOLO en song mode.
    // En drum machine (isPlaying && !songActive) se mantiene visible hasta STOP.
    if (songActive) {
      setTimeout(() => {
        if (panel.classList.contains('playing')) panel.className = 'rhythm-state-panel';
      }, 3000);
    }
  } else {
    panel.className = 'rhythm-state-panel'; // oculto
  }
}

// ---- Carga un archivo JSON sin pausa entre ritmos ----------
function loadRhythm() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const d = JSON.parse(ev.target.result);
        songLoadedIdx = -1; songLoadedModified = false;

        // 1. Calcular duración del ciclo ACTUAL antes de cambiar nada
        const currentCycleMs = Math.round(60000 / bpm / 4) * numSteps;
        const newBpm = (d.bpm != null) ? d.bpm : bpm;
        const bpmChanged = newBpm !== bpm;

        // 2. Actualizar TODO el estado de golpe, sin enviar comandos todavía
        if (d.bpm != null) {
          bpm = d.bpm;
          document.getElementById('bpmSlider').value = bpm;
          document.getElementById('bpmValue').value  = bpm;
        }
        if (d.hitDur != null) {
          hitDur = d.hitDur;
          document.getElementById('hitDur').value = hitDur;
        }
        if (d.channels && d.channels.length) {
          channels    = d.channels.map(ch => Object.assign({}, ch, { steps: ch.steps.slice() }));
          numSteps    = channels[0].steps.length;
          numMeasures = Math.max(1, Math.round(numSteps / 16));
          document.getElementById('measuresInput').value = numMeasures;
        }

        // 3. Render actualiza la UI
        render();

        if (isPlaying) {
          setRhythmState('pending');
          // Tras el tiempo del ciclo en curso, el nuevo ritmo ya está sonando
          setTimeout(() => {
            setRhythmState('playing', file.name.replace('.json', '') + ' — ' + bpm + ' BPM');
            // Solo reiniciar el metrónomo si cambió el BPM
            if (bpmChanged) {
              stopMetronome();
              startMetronome();
            }
          }, currentCycleMs);
        } else {
          setStatus('Rhythm loaded: ' + file.name);
        }

      } catch (err) {
        setStatus('Error reading JSON file', 'error');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ============================================================
// SONG SEQUENCER — COLA DE CANCIÓN
// ============================================================
let songQueue       = [];   // [{name, channels, bpm, hitDur, numMeasures, repeats}]
let songPlayIdx     = 0;    // próximo índice a enviar al ESP32
let songActive      = false;

// Expande rangos de compases en la secuencia. Ej: "1,3-5,7" → [1,3,4,5,7]
function expandMeasureSeq(seqStr, maxMeasure) {
  if (!seqStr || !seqStr.trim()) return [];
  const result = [];
  const parts = seqStr.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      // Es un rango: "15-20"
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr.trim());
      const end   = parseInt(endStr.trim());
      if (!isNaN(start) && !isNaN(end)) {
        const from = Math.min(start, end);
        const to   = Math.max(start, end);
        for (let i = from; i <= to && i <= maxMeasure; i++) {
          if (i >= 1) result.push(i);
        }
      }
    } else {
      // Es un número individual
      const n = parseInt(trimmed);
      if (!isNaN(n) && n >= 1 && n <= maxMeasure) result.push(n);
    }
  }
  return result;
}

// Reproducción MIDI paginada (canciones largas fragmentadas en bloques de 8 compases)
let midiPages      = [];    // array de páginas: { cmd, pageMs }
let midiPageIdx    = 0;     // siguiente índice a enviar
let midiPageActive = false; // true mientras el ESP32 está reproduciendo páginas MIDI
let midiSongId     = '';
let midiAwaitAckPage = 0;
let midiAckTimer     = null;
let midiAckRetries   = 0;
let songCurrentName = '';   // nombre del patrón que suena ahora
let songCurrentQIdx = -1;   // índice en songQueue del patrón que suena
let songCycleN      = 0;
let songCycleTotal  = 0;
let songLoadedIdx   = -1;   // índice del patrón cargado actualmente en el secuenciador de Ritmo
let dragSrcIdx      = -1;   // índice del patrón que se está arrastrando
let songLoadedModified = false; // el patrón cargado en Ritmo tiene cambios sin sincronizar
let _suppressSync      = false; // evita sync durante la carga inicial de un patrón
let songSelected       = new Set(); // índices seleccionados para fusionar

// Calcula duración total de una entrada
function songEntryMs(e) {
  let totalSteps = e.numMeasures * 16;
  const rawSeq = e.measureSeq && e.measureSeq.trim();
  if (rawSeq) {
    const nums = rawSeq.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >= 1 && n <= e.numMeasures);
    if (nums.length > 0) totalSteps = nums.length * 16;
  }
  return Math.round(60000 / e.bpm / 4) * totalSteps;
}
function songFmtMs(ms) {
  const s = Math.round(ms / 1000), m = Math.floor(s / 60);
  return m > 0 ? m + 'm ' + (s % 60) + 's' : s + 's';
}

// Carga un fichero JSON y lo añade a la cola
function songLoadFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const d    = JSON.parse(ev.target.result);
      const name = file.name.replace(/\.json$/i, '');
      songQueue.push({
        name,
        channels:    (d.channels || []).map(ch => Object.assign({}, ch, { steps: ch.steps.slice() })),
        bpm:         d.bpm      || 120,
        hitDur:      d.hitDur   || 80,
        numMeasures: d.numMeasures || Math.max(1, Math.round((d.channels && d.channels[0] && d.channels[0].steps.length / 16) || 1)),
          measureSeq:  ''
      });
      renderSongQueue();
    } catch (_) { setStatus('Error reading JSON: ' + file.name, 'error'); }
  };
  reader.readAsText(file);
}

// Guarda la canción actual (songQueue) en formato JSON
function saveSongToJSON() {
  if (songQueue.length === 0) {
    setStatus('No patterns to save', 'warning');
    return;
  }

  const data = JSON.stringify(songQueue, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cancion.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setStatus('Song saved as song.json');
}

// Carga la canción desde cancion.json
function loadSongFromJSON() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json';
  inp.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);

        // Validar que sea un array con estructura correcta
        if (!Array.isArray(data) || data.length === 0) {
          setStatus('Invalid JSON file: must contain an array of patterns', 'error');
          return;
        }

        // Validar que cada elemento tenga las propiedades necesarias
        for (let entry of data) {
          if (!entry.name || !entry.channels || entry.bpm === undefined ||
              entry.hitDur === undefined || entry.numMeasures === undefined) {
            setStatus('Invalid JSON file: incorrect pattern structure', 'error');
            return;
          }
        }

        // Añadir solo los patrones que no estén ya en la cola (por nombre)
        const existingNames = new Set(songQueue.map(e => e.name));
        const newEntries = data
          .filter(entry => !existingNames.has(entry.name))
          .map(entry => ({
            name: entry.name,
            channels: (entry.channels || []).map(ch => Object.assign({}, ch, { steps: ch.steps.slice() })),
            bpm: entry.bpm || 120,
            hitDur: entry.hitDur || 80,
            numMeasures: entry.numMeasures || 1,
            measureSeq: entry.measureSeq || ''
          }));
        const skipped = data.length - newEntries.length;
        songQueue.push(...newEntries);

        renderSongQueue();
        if (newEntries.length === 0)
          setStatus('Song: all patterns were already in the queue (' + skipped + ' skipped)');
        else if (skipped > 0)
          setStatus('Song: ' + newEntries.length + ' added, ' + skipped + ' skipped (duplicate) — total ' + songQueue.length);
        else
          setStatus('Song: ' + newEntries.length + ' pattern(s) added — total ' + songQueue.length);
      } catch (err) {
        setStatus('Error reading song.json: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  };
  inp.click();
}

// ---- Reproducción MIDI paginada ----------------------------------------
function startMidiPaged(pages) {
  midiPages      = (pages || []).filter(p => p && p.cmd);
  midiPageIdx    = 0;
  midiPageActive = true;
  isPlaying      = true;
  midiSongId     = 'midi';
  midiAwaitAckPage = 0;
  midiAckRetries   = 0;
  if (midiAckTimer) { clearTimeout(midiAckTimer); midiAckTimer = null; }
  setRhythmState('playing', 'MIDI paginado');
  midiSendNextPage();
}

function midiSendNextPage() {
  if (!midiPageActive) return;
  if (midiPageIdx >= midiPages.length) { midiPageActive = false; return; }
  if (!(wsConnected && ws && ws.readyState === WebSocket.OPEN)) {
    midiPageActive = false;
    isPlaying = false;
    stopMetronome();
    setRhythmState('hidden');
    setStatus('Error: WebSocket disconnected — cannot continue paged MIDI', 'error');
    return;
  }

  // No enviar una nueva página si estamos esperando ACK de la anterior
  if (midiAwaitAckPage) return;

  const page = midiPages[midiPageIdx];
  const verb = midiPageIdx === 0 ? 'PLAY' : 'QUEUE';
  const pageId = midiPageIdx + 1;
  const total  = midiPages.length;
  const pageMs = Math.max(1, parseInt(page.pageMs) || 1);
  const songId = (midiSongId || 'midi').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 16) || 'midi';
  const name = `midi|${songId}|${pageId}|${total}|${pageMs}`;

  const payload = `${verb}|${name}|1\n${page.cmd}`;
  ws.send(payload);

  midiAwaitAckPage = pageId;
  midiAckRetries = 0;

  if (midiAckTimer) { clearTimeout(midiAckTimer); midiAckTimer = null; }
  const retry = () => {
    if (!midiPageActive) return;
    if (!midiAwaitAckPage || midiAwaitAckPage !== pageId) return;
    if (!(wsConnected && ws && ws.readyState === WebSocket.OPEN)) return;
    midiAckRetries++;
    if (midiAckRetries > 6) {
      midiPageActive = false;
      isPlaying = false;
      stopMetronome();
      setRhythmState('hidden');
      setStatus('Error: no ACK from ESP32 — playback stopped', 'error');
      return;
    }
    ws.send(payload);
    midiAckTimer = setTimeout(retry, 350);
  };
  midiAckTimer = setTimeout(retry, 350);

  midiPageIdx++;
}

// Envía el siguiente patrón de la cola al ESP32
// Expande los canales de una entrada según su measureSeq.
// Devuelve { chs, ns } listos para buildCommand.
function songSendNext() {
  if (songPlayIdx >= songQueue.length) return;
  const e    = songQueue[songPlayIdx];
  const type = (songPlayIdx === 0) ? 'PLAY' : 'QUEUE';

  // Expandir compases según la secuencia definida (measureSeq, con soporte para rangos)
  let chs = e.channels;
  let ns  = e.numMeasures * 16;
  const rawSeq = e.measureSeq && e.measureSeq.trim();
  if (rawSeq) {
    const seqNums = expandMeasureSeq(rawSeq, e.numMeasures);
    if (seqNums.length > 0) {
      ns  = seqNums.length * 16;
      chs = e.channels.map(ch => {
        const newSteps = [];
        seqNums.forEach(m => { const st = (m - 1) * 16; for (let i = 0; i < 16; i++) newSteps.push(ch.steps[st + i] || 0); });
        return Object.assign({}, ch, { steps: newSteps });
      });
    }
  }

  const cmd  = buildCommand(chs, e.bpm, e.hitDur, ns);
  if (!cmd) { songPlayIdx++; songSendNext(); return; }
  ws.send(`${type}|${e.name}|1\n${cmd}`);
  songPlayIdx++;
}


function songStop() {
  sendStop();
  songActive  = false;
  songPlayIdx = 0;
  isPlaying   = false;
  drumStreamStop();
  stopMetronome();
  setRhythmState('hidden');
  setStatus('Stopped');
  songUpdateUI(null, 0, 0);
}

// Carga un patrón de la cola de canción en el secuenciador de Ritmo
function loadSongEntryIntoSequencer(entry, idx) {
  const currentCycleMs = Math.round(60000 / bpm / 4) * numSteps;

  bpm = entry.bpm;
  document.getElementById('bpmSlider').value = bpm;
  document.getElementById('bpmValue').value  = bpm;
  hitDur = entry.hitDur;
  document.getElementById('hitDur').value = hitDur;

  let _chs = entry.channels.map(ch => Object.assign({}, ch, { steps: ch.steps.slice() }));
  let _nm  = entry.numMeasures;
  const _seq = entry.measureSeq && entry.measureSeq.trim();
  if (_seq) {
    const seqNums = expandMeasureSeq(_seq, entry.numMeasures);
    if (seqNums.length > 0) {
      _nm  = seqNums.length;
      _chs = entry.channels.map(ch => {
        const newSteps = [];
        seqNums.forEach(m => { const st = (m - 1) * 16; for (let i = 0; i < 16; i++) newSteps.push(ch.steps[st + i] || 0); });
        return Object.assign({}, ch, { steps: newSteps });
      });
    }
  }
  channels    = _chs;
  numSteps    = _nm * 16;
  numMeasures = _nm;
  document.getElementById('measuresInput').value = numMeasures;
  _suppressSync = true;
  render();
  _suppressSync = false;
  songLoadedModified = false;

  if (isPlaying) {
    if (drumStreamActive) {
      drumStreamStop();
      setTimeout(drumStreamStart, 100);
    } else {
      const cmd = generateCommand();
      if (cmd) sendCommand(cmd);
    }
    setRhythmState('pending');
    setTimeout(() => setRhythmState('playing', entry.name + ' — ' + bpm + ' BPM'), currentCycleMs);
  } else {
    setStatus('Loaded in Rhythm: ' + entry.name);
  }

  songLoadedIdx = idx;
  renderSongQueue();
}

// Actualiza UI con el estado que manda el ESP32
function songUpdateUI(patName, cycleN, total) {
  if (patName && patName !== songCurrentName) {
    songCurrentName = patName;
    // Buscar hacia adelante desde la posición actual
    let found = -1;
    for (let i = Math.max(0, songCurrentQIdx); i < songQueue.length; i++) {
      if (songQueue[i].name === patName) { found = i; break; }
    }
    songCurrentQIdx = found;
  }
  songCycleN     = cycleN;
  songCycleTotal = total;
  // Barra de progreso dentro del ciclo actual
  const fill = document.getElementById('songProgressFill');
  if (fill) fill.style.width = (total > 0 ? Math.round((cycleN / total) * 100) : 0) + '%';
  renderSongQueue();
}

// Construye el comando de previsualización de un patrón (reproduce una vez, sin loop)
function buildPreviewCommand(entry) {
  let chs = entry.channels;
  let ns  = entry.numMeasures * 16;
  const rawSeq = entry.measureSeq && entry.measureSeq.trim();
  if (rawSeq) {
    const seqNums = expandMeasureSeq(rawSeq, entry.numMeasures);
    if (seqNums.length > 0) {
      ns  = seqNums.length * 16;
      chs = entry.channels.map(ch => {
        const newSteps = [];
        seqNums.forEach(m => { const st = (m - 1) * 16; for (let i = 0; i < 16; i++) newSteps.push(ch.steps[st + i] || 0); });
        return Object.assign({}, ch, { steps: newSteps });
      });
    }
  }
  const cmd = buildCommand(chs, entry.bpm, entry.hitDur, ns);
  // Sustituir 'r;' final por 'p;' para reproducir una sola vez
  return cmd ? cmd.replace(/r;$/, 'p;') : '';
}

function _updateSongMergeBar() {
  const bar   = document.getElementById('songMergeBar');
  const label = document.getElementById('songMergeLabel');
  if (!bar) return;
  if (songSelected.size < 2) {
    bar.style.display = 'none';
  } else {
    const names = [...songSelected].sort((a,b)=>a-b).map(i => songQueue[i] ? songQueue[i].name : '?').join(' + ');
    label.textContent = names;
    bar.style.display = 'flex';
  }
}

// Expande los steps de una entrada respetando su measureSeq.
// Devuelve un array de (numExpandedMeasures * 16) booleans por canal, indexado por motor.
function _expandEntry(entry) {
  const stepsPerMeasure = 16;
  let seq = [];
  const rawSeq = entry.measureSeq && entry.measureSeq.trim();
  if (rawSeq) {
    seq = rawSeq.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >= 1 && n <= entry.numMeasures).map(n => n - 1); // 0-based
  }
  if (seq.length === 0) {
    for (let m = 0; m < entry.numMeasures; m++) seq.push(m);
  }
  const result = {}; // motor -> steps[]
  entry.channels.forEach(ch => {
    const expanded = [];
    seq.forEach(m => {
      for (let s = 0; s < stepsPerMeasure; s++) {
        expanded.push(ch.steps[m * stepsPerMeasure + s] || false);
      }
    });
    result[ch.motor] = { ch, steps: expanded };
  });
  return { byMotor: result, numMeasures: seq.length };
}

function mergeSongEntries() {
  if (songSelected.size < 2) return;
  const indices = [...songSelected].sort((a, b) => a - b);

  // Expandir cada entrada
  const expanded = indices.map(i => _expandEntry(songQueue[i]));

  // Unión de motores en orden de aparición
  const motorOrder = [];
  const motorMeta  = {}; // motor -> primer ch encontrado
  expanded.forEach(exp => {
    Object.entries(exp.byMotor).forEach(([motor, data]) => {
      if (!motorMeta[motor]) { motorOrder.push(Number(motor)); motorMeta[motor] = data.ch; }
    });
  });

  const totalMeasures = expanded.reduce((s, e) => s + e.numMeasures, 0);
  const stepsPerMeasure = 16;

  // Construir canales fusionados
  const mergedChannels = motorOrder.map(motor => {
    const steps = [];
    expanded.forEach(exp => {
      const src = exp.byMotor[motor];
      const n   = exp.numMeasures * stepsPerMeasure;
      if (src) {
        steps.push(...src.steps);
      } else {
        // canal ausente en este patrón → relleno con false
        for (let k = 0; k < n; k++) steps.push(false);
      }
    });
    const meta = motorMeta[motor];
    return {
      name:       meta.name,
      motor:      motor,
      steps:      steps,
      vel:        meta.vel        !== undefined ? meta.vel        : 100,
      hitDur:     meta.hitDur     !== undefined ? meta.hitDur     : hitDur,
      retractDur: meta.retractDur !== undefined ? meta.retractDur : retractDur,
      muted:      false,
    };
  });

  // Nombre y BPM del primer patrón seleccionado
  const firstName = indices.map(i => songQueue[i].name).join('+');
  const firstBpm  = songQueue[indices[0]].bpm;
  const firstHit  = songQueue[indices[0]].hitDur;
  const firstRet  = songQueue[indices[0]].retractDur;

  songQueue.push({
    name:        firstName,
    channels:    mergedChannels,
    bpm:         firstBpm,
    hitDur:      firstHit,
    retractDur:  firstRet,
    numMeasures: totalMeasures,
    measureSeq:  '',
  });

  songSelected.clear();
  _updateSongMergeBar();
  renderSongQueue();
  setStatus('Merged ' + indices.length + ' patterns into "' + firstName + '"');
}

// Renderiza la lista de la cola de canción
function renderSongQueue() {
  const list = document.getElementById('songQueueList');
  if (!list) return;
  const totalMs = songQueue.reduce((a, e) => a + songEntryMs(e), 0);
  const durEl   = document.getElementById('songTotalDur');
  if (durEl) durEl.textContent = songQueue.length > 0 ? '⏱ ' + songFmtMs(totalMs) : '';

  if (songQueue.length === 0) {
    list.innerHTML = '<div class="song-empty">No patterns. Use "+ Pattern" to load JSON files.</div>';
    return;
  }
  list.innerHTML = '';
  songQueue.forEach((entry, i) => {
    const isActive  = (i === songCurrentQIdx && songActive);
    const isPending = (i === songCurrentQIdx + 1 && songActive);

    const isLoaded  = (i === songLoadedIdx);

    const row = document.createElement('div');
    row.className = 'song-row' +
      (isActive  ? ' song-row-active'  : '') +
      (isPending ? ' song-row-pending' : '') +
      (isLoaded  ? ' song-row-loaded'  : '');
    row.draggable = true;
    row.style.cursor = 'pointer';
    row.title = 'Click to load in the Rhythm sequencer';
    row.addEventListener('click', e => {
      if (e.target.closest('button, input, label, .song-grip')) return;
      loadSongEntryIntoSequencer(entry, i);
    });

    // Drag & Drop — reordenar arrastrando
    row.addEventListener('dragstart', e => {
      dragSrcIdx = i;
      e.dataTransfer.effectAllowed = 'move';
      // Diferir la clase para que no afecte al ghost del navegador
      setTimeout(() => row.classList.add('song-row-dragging'), 0);
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('song-row-dragging');
      document.querySelectorAll('.song-row-dragover')
        .forEach(el => el.classList.remove('song-row-dragover'));
      dragSrcIdx = -1;
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    row.addEventListener('dragenter', () => {
      if (dragSrcIdx !== i) row.classList.add('song-row-dragover');
    });
    row.addEventListener('dragleave', e => {
      if (!row.contains(e.relatedTarget)) row.classList.remove('song-row-dragover');
    });
    row.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      const src = dragSrcIdx;
      const dst = i;
      if (src < 0 || src === dst) return;
      const [moved] = songQueue.splice(src, 1);
      songQueue.splice(dst, 0, moved);
      // Actualizar songLoadedIdx tras el reordenamiento
      if      (songLoadedIdx === src)                              songLoadedIdx = dst;
      else if (src < dst && songLoadedIdx > src && songLoadedIdx <= dst) songLoadedIdx--;
      else if (src > dst && songLoadedIdx >= dst && songLoadedIdx < src) songLoadedIdx++;
      dragSrcIdx = -1;
      songSelected.clear(); _updateSongMergeBar();
      renderSongQueue();
    });

    // Checkbox de selección para fusionar
    const chk = document.createElement('input');
    chk.type    = 'checkbox';
    chk.checked = songSelected.has(i);
    chk.title   = 'Select to merge';
    chk.style.cssText = 'cursor:pointer;accent-color:#f0c040;flex-shrink:0;';
    chk.addEventListener('click', e => e.stopPropagation());
    chk.addEventListener('change', () => {
      if (chk.checked) songSelected.add(i);
      else             songSelected.delete(i);
      _updateSongMergeBar();
    });
    row.appendChild(chk);

    // Grip handle (asa de arrastre)
    const grip = document.createElement('span');
    grip.className   = 'song-grip';
    grip.textContent = '⠿';
    grip.title       = 'Drag to reorder';
    row.appendChild(grip);

    // Indicador
    const ind = document.createElement('span');
    ind.className   = 'song-indicator';
    ind.textContent = isActive ? '▶' : String(i + 1) + '.';
    row.appendChild(ind);

    // Nombre (editable)
    const nm = document.createElement('input');
    nm.type      = 'text';
    nm.className = 'song-name';
    nm.value     = entry.name;
    nm.title     = 'Pattern name (editable)';
    nm.style.cssText = 'background:transparent;border:none;outline:none;cursor:text;min-width:60px;';
    nm.addEventListener('click', e => e.stopPropagation());
    nm.addEventListener('change', () => { songQueue[i].name = nm.value; });
    row.appendChild(nm);

    if (isLoaded && songLoadedModified) {
      const badge = document.createElement('span');
      badge.className = 'song-modified-badge';
      badge.textContent = '✎';
      badge.title = 'Modified — will apply on playback';
      row.appendChild(badge);
    }

    // Info: compases (texto) + BPM (editable)
    const inf = document.createElement('span');
    inf.className = 'song-info';
    // Mostrar SIEMPRE el número total de compases guardados en el patrón
    inf.appendChild(document.createTextNode(entry.numMeasures + ' c / '));
    const bpmIn = document.createElement('input');
    bpmIn.type = 'number'; bpmIn.min = 20; bpmIn.max = 300;
    bpmIn.value = entry.bpm;
    bpmIn.className = 'song-rep-input';
    bpmIn.style.width = '54px';
    bpmIn.title = 'BPM for this pattern';
    bpmIn.onchange = e => { songQueue[i].bpm = Math.min(300, Math.max(20, parseInt(e.target.value) || entry.bpm)); renderSongQueue(); };
    inf.appendChild(bpmIn);
    inf.appendChild(document.createTextNode(' BPM'));
    row.appendChild(inf);


    // Secuencia de compases (ej: "3,3,1" → repite compás 3 dos veces, luego el 1)
    const seqWrap = document.createElement('label');
    seqWrap.className = 'song-seq-wrap';
    seqWrap.title = 'Measures to play. Supports ranges: 1,3-5,7 = measures 1,3,4,5,7';
    seqWrap.appendChild(document.createTextNode('c:'));
    const seqIn = document.createElement('input');
    seqIn.type = 'text';
    seqIn.value = entry.measureSeq || '';
    seqIn.className = 'song-seq-input';
    seqIn.placeholder = '1,3-5,7…';
    seqIn.title = 'E.g. "3,3,1" or "5-8,10,12-15". Supports ranges (5-8 = 5,6,7,8)';
    seqIn.onchange = e => {
      songQueue[i].measureSeq = e.target.value.trim();
      // Si esta entrada está cargada en el secuenciador, recargala con la nueva secuencia
      if (songLoadedIdx === i) loadSongEntryIntoSequencer(songQueue[i], i);
      else renderSongQueue();
    };
    seqWrap.appendChild(seqIn);

    const seqMinus = document.createElement('button');
    seqMinus.className = 'btn song-btn';
    seqMinus.textContent = '−';
    seqMinus.title = 'Remove last measure from sequence';
    seqMinus.onclick = () => {
      const parts = (songQueue[i].measureSeq || '').split(',').map(s => s.trim()).filter(s => s);
      parts.pop();
      songQueue[i].measureSeq = parts.join(',');
      if (songLoadedIdx === i) loadSongEntryIntoSequencer(songQueue[i], i);
      else renderSongQueue();
    };
    seqWrap.appendChild(seqMinus);

    const seqPlus = document.createElement('button');
    seqPlus.className = 'btn song-btn';
    seqPlus.textContent = '+';
    seqPlus.title = 'Add next measure to sequence';
    seqPlus.onclick = () => {
      const parts = (songQueue[i].measureSeq || '').split(',').map(s => s.trim()).filter(s => s !== '');
      const last  = parts.length > 0 ? parseInt(parts[parts.length - 1]) : 0;
      const next  = (last >= entry.numMeasures) ? 1 : last + 1;
      parts.push(String(next));
      songQueue[i].measureSeq = parts.join(',');
      if (songLoadedIdx === i) loadSongEntryIntoSequencer(songQueue[i], i);
      else renderSongQueue();
    };
    seqWrap.appendChild(seqPlus);

    const origBtn = document.createElement('button');
    origBtn.className = 'btn song-btn';
    origBtn.textContent = '📖';
    origBtn.title = 'Load original (all measures without sequence)';
    origBtn.onclick = () => {
      // Crear una copia temporal sin measureSeq para cargar la versión original
      const origEntry = Object.assign({}, songQueue[i], { measureSeq: '' });
      loadSongEntryIntoSequencer(origEntry, i);
    };
    seqWrap.appendChild(origBtn);

    row.appendChild(seqWrap);

    // Botón de previsualización — reproduce los compases seleccionados una sola vez
    const prevBtn = document.createElement('button');
    prevBtn.className = 'btn song-btn song-btn-prev';
    prevBtn.textContent = '▶';
    prevBtn.title = 'Preview selected measures (once)';
    prevBtn.onclick = () => {
      const cmd = buildPreviewCommand(entry);
      if (!cmd) { setStatus('No active notes in pattern', 'error'); return; }
      sendCommand(cmd);
      setStatus('Previewing: ' + entry.name);
    };
    row.appendChild(prevBtn);

    // Duración
    const dur = document.createElement('span');
    dur.className   = 'song-dur';
    dur.textContent = songFmtMs(songEntryMs(entry));
    row.appendChild(dur);

    // Progreso de ciclo (solo si es el activo)
    const cyc = document.createElement('span');
    cyc.className   = 'song-cycle-prog';
    cyc.textContent = isActive && songCycleTotal > 0 ? songCycleN + '/' + songCycleTotal : '';
    row.appendChild(cyc);

    // Botón ↑
    const upBtn = document.createElement('button');
    upBtn.className = 'btn song-btn';
    upBtn.textContent = '↑'; upBtn.title = 'Move up';
    upBtn.disabled = (i === 0);
    upBtn.onclick = () => {
      [songQueue[i-1], songQueue[i]] = [songQueue[i], songQueue[i-1]];
      if (songLoadedIdx === i) songLoadedIdx = i - 1;
      else if (songLoadedIdx === i - 1) songLoadedIdx = i;
      renderSongQueue();
    };
    row.appendChild(upBtn);

    // Botón ↓
    const dnBtn = document.createElement('button');
    dnBtn.className = 'btn song-btn';
    dnBtn.textContent = '↓'; dnBtn.title = 'Bajar';
    dnBtn.disabled = (i === songQueue.length - 1);
    dnBtn.onclick = () => {
      [songQueue[i], songQueue[i+1]] = [songQueue[i+1], songQueue[i]];
      if (songLoadedIdx === i) songLoadedIdx = i + 1;
      else if (songLoadedIdx === i + 1) songLoadedIdx = i;
      renderSongQueue();
    };
    row.appendChild(dnBtn);

    // Botón ✕
    const rmBtn = document.createElement('button');
    rmBtn.className = 'btn song-btn song-btn-rm';
    rmBtn.textContent = '✕'; rmBtn.title = 'Eliminar';
    rmBtn.onclick = () => {
      songQueue.splice(i, 1);
      if (songLoadedIdx === i) songLoadedIdx = -1;
      else if (songLoadedIdx > i) songLoadedIdx--;
      renderSongQueue();
    };
    row.appendChild(rmBtn);

    list.appendChild(row);
  });
}

// ============================================================
// DRAG-SELECT + COPY/PASTE EN LA CUADRÍCULA
// ============================================================

function initDragSelect() {
  const table = document.querySelector('.sequencer-table');
  if (!table) return;

  table.addEventListener('mousedown', ev => {
    if (ev.button !== 0) return;
    const btn = ev.target.closest('.step-btn');
    if (!btn) return;
    seqDragStart = { ci: +btn.dataset.ci, s: +btn.dataset.s };
    seqDragEnd   = { ci: +btn.dataset.ci, s: +btn.dataset.s };
    seqDragMoved = false;
  });

  document.addEventListener('mousemove', ev => {
    if (!seqDragStart) return;
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!el) return;
    const sb = el.closest ? el.closest('.step-btn') : null;
    if (!sb) return;
    const ci = +sb.dataset.ci;
    const s  = +sb.dataset.s;
    if (ci !== seqDragStart.ci || s !== seqDragStart.s) seqDragMoved = true;
    seqDragEnd = { ci, s };
    _updateDragHighlight();
  });

  document.addEventListener('mouseup', ev => {
    if (!seqDragStart || ev.button !== 0) {
      seqDragStart = seqDragEnd = null;
      return;
    }
    const realDrag = seqDragMoved &&
      (seqDragEnd.ci !== seqDragStart.ci || seqDragEnd.s !== seqDragStart.s);
    if (realDrag) {
      _copySelectionToClipboard();
    } else {
      seqDragMoved = false;
    }
    _clearDragHighlight();
    seqDragStart = seqDragEnd = null;
  });
}

function _updateDragHighlight() {
  if (!seqDragStart || !seqDragEnd) return;
  const minCi = Math.min(seqDragStart.ci, seqDragEnd.ci);
  const maxCi = Math.max(seqDragStart.ci, seqDragEnd.ci);
  const minS  = Math.min(seqDragStart.s,  seqDragEnd.s);
  const maxS  = Math.max(seqDragStart.s,  seqDragEnd.s);
  document.querySelectorAll('.step-btn').forEach(btn => {
    const ci = +btn.dataset.ci, s = +btn.dataset.s;
    btn.classList.toggle('sel-drag', ci >= minCi && ci <= maxCi && s >= minS && s <= maxS);
  });
}

function _clearDragHighlight() {
  document.querySelectorAll('.step-btn.sel-drag').forEach(b => b.classList.remove('sel-drag'));
}

function _copySelectionToClipboard() {
  if (!seqDragStart || !seqDragEnd) return;
  const minCi = Math.min(seqDragStart.ci, seqDragEnd.ci);
  const maxCi = Math.max(seqDragStart.ci, seqDragEnd.ci);
  const minS  = Math.min(seqDragStart.s,  seqDragEnd.s);
  const maxS  = Math.max(seqDragStart.s,  seqDragEnd.s);
  const data = [];
  for (let r = 0; r <= maxCi - minCi; r++) {
    const row = [];
    for (let c = 0; c <= maxS - minS; c++) {
      const s = minS + c;
      const val = channels[minCi + r].steps[s];
      row.push(val > 0 ? Math.min(val, maxS - s + 1) : 0);
    }
    data.push(row);
  }
  seqClipboard = { rows: maxCi - minCi + 1, cols: maxS - minS + 1, data };
  setStatus(`✓ Copied ${seqClipboard.rows}×${seqClipboard.cols} pattern`);
  setTimeout(() => setStatus('Ready'), 2000);
}

function _pasteFromClipboard(toCi, toS) {
  if (!seqClipboard) return;
  const { rows, cols, data } = seqClipboard;
  for (let r = 0; r < rows; r++) {
    const ci = toCi + r;
    if (ci >= channels.length) break;
    const steps = channels[ci].steps;
    for (let c = 0; c < cols; c++) {
      const s = toS + c;
      if (s >= steps.length) break;
      const val = data[r][c];
      if (val > 0) {
        for (let i = s; i < s + val && i < steps.length; i++) {
          const ns = _noteStart(steps, i);
          if (ns >= 0) steps[ns] = 0;
        }
        steps[s] = val;
      }
    }
  }
  renderChannels();
  const cmd = generateCommand();
  if (isPlaying && cmd) sendLive(cmd);
}

// ---- FUNCIONES DE ACORDES ----
function getChordNotes(key, scaleType, chordNumeral) {
  const scaleData = CHORD_SCALES[scaleType];
  if (!scaleData) return [];

  const chordDef = scaleData.chords.find(c => c.numeral === chordNumeral);
  if (!chordDef) return [];

  // Encontrar índice de la tonalidad (0-11)
  const keyIdx = NOTE_NAMES.indexOf(key) >= 0 ? NOTE_NAMES.indexOf(key) : FLAT_NAMES.indexOf(key);
  if (keyIdx < 0) return [];

  // Obtener las 3 notas del acorde (triada)
  const intervals = [0, 4, 7]; // Mayor: tónica, tercera, quinta
  if (chordDef.type === 'minor') intervals[1] = 3; // Menor: tónica, tercera menor, quinta
  if (chordDef.type === 'diminished') { intervals[1] = 3; intervals[2] = 6; } // Disminuido

  return intervals.map(int => {
    const noteIdx = (keyIdx + chordDef.offset + int) % 12;
    return NOTE_NAMES[noteIdx];
  });
}

function getScaleChords(key, scaleType) {
  // Retorna los 7 acordes (cada uno con sus 3 notas)
  const scaleData = CHORD_SCALES[scaleType];
  if (!scaleData) return [];

  return scaleData.chords.map(chord => ({
    numeral: chord.numeral,
    type: chord.type,
    notes: getChordNotes(key, scaleType, chord.numeral)
  }));
}

function updateScaleDescription() {
  const key = document.getElementById('chordKey').value;
  const scaleType = document.getElementById('chordScale').value;
  const chords = getScaleChords(key, scaleType);

  if (!chords.length) return;

  let description = `<strong>${key} ${scaleType}</strong><br>`;
  description += `Acordes: `;

  chords.forEach((chord, idx) => {
    const typeSymbol = chord.type === 'major' ? '' : chord.type === 'minor' ? 'm' : '°';
    const notesStr = chord.notes.join('-');
    const chordColor = chord.type === 'major' ? '#3a7850' : chord.type === 'minor' ? '#3a6a9a' : '#a03828';
    description += `<span style="color:${chordColor}">${chord.numeral}(${notesStr}${typeSymbol})</span>`;
    if (idx < chords.length - 1) description += ` | `;
  });

  document.getElementById('scaleDescription').innerHTML = description;
}

function viewScale() {
  const key = document.getElementById('chordKey').value;
  const scaleType = document.getElementById('chordScale').value;
  const chords = getScaleChords(key, scaleType);

  if (!chords.length) {
    setStatus('❌ Escala no válida', 'error');
    return;
  }

  // Limpiar canales
  channels.forEach(ch => ch.steps.fill(0));

  // Cargar los 7 acordes: cada acorde ocupa 3 canales, en 7 posiciones horizontales
  for (let chordIdx = 0; chordIdx < chords.length; chordIdx++) {
    const chord = chords[chordIdx];
    const stepPos = chordIdx * 4; // Cada acorde comienza cada 4 pasos (1/4 de compás)

    // Cargar las 3 notas del acorde en 3 canales diferentes
    for (let noteIdx = 0; noteIdx < chord.notes.length && noteIdx < channels.length; noteIdx++) {
      const note = chord.notes[noteIdx];
      const motorIdx = NOTE_NAMES.indexOf(note);

      if (motorIdx >= 0 && motorIdx < channels.length) {
        // Colocar la nota con duración 4 (1/4)
        channels[motorIdx].steps[stepPos] = 4;
      }
    }
  }

  renderChannels();
  setStatus(`🎵 Acordes de ${key} ${scaleType} cargados en el secuenciador`);
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {

  initChannels(null); // 4 canales vacíos por defecto
  initDragSelect();   // Inicializar drag-select para copiar/pegar

  // Compases
  document.getElementById('measuresInput').onchange = e => setMeasures(parseInt(e.target.value) || 1);

  // Helper: inicializar un ctrl-dropdown genérico
  function initDropdown(btnId, panelId) {
    const btn   = document.getElementById(btnId);
    const panel = document.getElementById(panelId);
    btn.onclick = e => {
      e.stopPropagation();
      const open = panel.classList.toggle('open');
      btn.classList.toggle('open', open);
    };
    panel.addEventListener('click', e => e.stopPropagation());
  }

  initDropdown('ctrlDropdownBtn',  'ctrlDropdownPanel');
  initDropdown('loadDropdownBtn',  'loadDropdownPanel');
  initDropdown('saveDropdownBtn',  'saveDropdownPanel');

  document.addEventListener('click', () => {
    document.querySelectorAll('.ctrl-dropdown-panel.open').forEach(p => p.classList.remove('open'));
    document.querySelectorAll('.ctrl-dropdown-toggle.open').forEach(b => b.classList.remove('open'));
    document.querySelectorAll('.ch-opt-panel.open').forEach(p => p.classList.remove('open'));
    document.querySelectorAll('.ch-opt-btn.open').forEach(b => b.classList.remove('open'));
  });

  // BPM
  document.getElementById('bpmSlider').oninput  = e => setBpm(parseInt(e.target.value));
  document.getElementById('bpmValue').onchange  = e => setBpm(parseInt(e.target.value));

  // ESP32 IP
  const esp32IpInput = document.getElementById('esp32IpInput');
  if (esp32IpInput) {
    esp32IpInput.onchange = e => {
      ESP32_IP = e.target.value.trim();
      localStorage.setItem('esp32_ip', ESP32_IP);
      setStatus('ESP32 IP: ' + ESP32_IP);
    };
    // Cargar IP guardada en localStorage si existe
    const savedIp = localStorage.getItem('esp32_ip');
    if (savedIp) {
      ESP32_IP = savedIp;
      esp32IpInput.value = ESP32_IP;
    }
  }

  // Golpe
  document.getElementById('hitDur').onchange = e => {
    hitDur = Math.max(10, parseInt(e.target.value) || 80);
    const cmd = generateCommand();
    if (isPlaying && cmd) sendLive(cmd);
  };

  // Retract
  document.getElementById('retractDur').onchange = e => {
    retractDur = Math.max(10, parseInt(e.target.value) || 150);
    const cmd = generateCommand();
    if (isPlaying && cmd) sendLive(cmd);
  };

  const _btnPlay  = document.getElementById('btnPlay');
  const _btnPause = document.getElementById('btnPause');
  const _btnStop  = document.getElementById('btnStop');

  function _setTransport(state) {  // 'stopped' | 'playing' | 'paused'
    _btnPlay.disabled  = (state !== 'stopped');
    _btnPause.disabled = (state === 'stopped');
    _btnStop.disabled  = false;
    _btnPause.textContent = (state === 'paused') ? '▶ RESUME' : '⏸ PAUSE';
  }

  // ---- PLAY ---- arranca desde cero (resume lo gestiona el botón PAUSE)
  _btnPlay.onclick = () => {
    if (pendingPlayTimeout) { clearTimeout(pendingPlayTimeout); pendingPlayTimeout = null; }

    const measuresVal = parseInt(document.getElementById('measuresInput').value) || 1;
    if (measuresVal !== numMeasures) setMeasures(measuresVal);
    const cmd = generateCommand();
    if (!cmd) return;

    if (numMeasures > 1 && !(wsConnected && ws && ws.readyState === WebSocket.OPEN)) {
      setStatus('⚠ ESP32 no conectado — reproduciendo solo audio', 'pending');
    }

    drumStreamStart();
    isPlaying = true;
    startMetronome();
    setRhythmState('playing');
    _setTransport('playing');
  };

  // ---- PAUSE / RESUME ---- el mismo botón alterna entre pausar y reanudar
  _btnPause.onclick = () => {
    if (isPausing) return;  // ya en proceso de pausa, ignorar

    if (drumStreamPauseIdx >= 0) {
      // ---- RESUME ----
      const resumeStep = (drumStreamPauseIdx % numMeasures) * 16; // primer paso del compás a reanudar
      checkESP32(() => {
        drumStreamResume();
        isPlaying = true;
        startMetronome(resumeStep);
        setRhythmState('playing');
        _setTransport('playing');
      });
    } else if (isPlaying) {
      // ---- PAUSE ---- el metrónomo finalizará al llegar al último paso del compás
      drumStreamPause();
      isPausing = true;
      _setTransport('paused');
      setStatus('⏸ Pausando…');
    }
  };

  // ---- STOP ---- para inmediato y vuelve al principio
  _btnStop.onclick = () => {
    console.log("🛑 STOP clickeado");
    if (pendingPlayTimeout) { clearTimeout(pendingPlayTimeout); pendingPlayTimeout = null; }
    isPausing = false;
    sendStop();
    isPlaying = false;
    drumStreamStop();
    drumStreamPauseIdx = -1;
    if (songActive) { songActive = false; songPlayIdx = 0; songUpdateUI(null, 0, 0); }
    stopMetronome();        // resetea scroll y currentStep
    setRhythmState('hidden');
    _setTransport('stopped');

    // Detener todas las notas de Tone.js (piano/sintetizador)
    if (toneInitialized && sampler) {
      try {
        sampler.releaseAll();
      } catch (err) { /* ignorar */ }
    }

    setStatus('Ready');
    console.log("✅ STOP completado");
  };

  // Fusionar grupos de notas 1/16 consecutivas en notas de hasta 1/4
  document.getElementById('btnSnap').onclick = e => {
    const existing = document.getElementById('snapPicker');
    if (existing) { existing.remove(); return; }

    const stepMs = Math.round(60000 / bpm / 4);
    const opts = [
      { sym: '♬', label: '1/16', steps: 1  },
      { sym: '♪', label: '1/8',  steps: 2  },
      { sym: '♩', label: '1/4',  steps: 4  },
      { sym: '𝅗𝅥', label: '1/2',  steps: 8  },
      { sym: '𝅝',  label: '1',    steps: 16 },
      { sym: '⇒', label: '1/16→1/8', steps: null, action: () => convert16to8() },
      { sym: '◈', label: 'Únicos',   steps: null, action: () => deduplicateMeasures() },
      { sym: '🎵', label: 'Notes→Chords', steps: null, action: () => openHarmonizeGridModal() },
    ];

    const picker = document.createElement('div');
    picker.id = 'snapPicker';
    picker.style.cssText = [
      'position:fixed', 'background:#1a1a33', 'border:1px solid #ff4466',
      'border-radius:8px', 'padding:8px', 'display:flex', 'gap:6px',
      'z-index:9999', 'box-shadow:0 4px 24px rgba(0,0,0,.85)',
      'font-family:"Courier New",monospace'
    ].join(';');

    const rect = document.getElementById('btnSnap').getBoundingClientRect();
    picker.style.left = rect.left + 'px';
    picker.style.top  = (rect.bottom + 4) + 'px';

    opts.forEach(opt => {
      const isConvert = !!opt.action;
      const ms = isConvert ? null : opt.steps * stepMs;
      const msLabel = isConvert ? '' : (ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms');
      const ob = document.createElement('button');
      if (isConvert) {
        // Separador visual antes del botón de conversión
        const sep = document.createElement('div');
        sep.style.cssText = 'width:1px;background:#2a2a55;align-self:stretch;margin:0 2px';
        picker.appendChild(sep);
        ob.style.cssText = 'background:#0a1a22;border:1px solid #3498db;border-radius:6px;color:#3498db;cursor:pointer;padding:5px 9px;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:38px;font-family:inherit';
        ob.onmouseover = () => { ob.style.borderColor = '#5bc0de'; ob.style.background = '#0d2233'; };
        ob.onmouseout  = () => { ob.style.borderColor = '#3498db'; ob.style.background = '#0a1a22'; };
      } else {
        ob.style.cssText = 'background:#0d0d22;border:1px solid #334;border-radius:6px;color:#ddd;cursor:pointer;padding:5px 9px;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:38px;font-family:inherit';
        ob.onmouseover = () => { ob.style.borderColor = '#ff4466'; ob.style.background = '#200810'; };
        ob.onmouseout  = () => { ob.style.borderColor = '#334';    ob.style.background = '#0d0d22'; };
      }
      ob.innerHTML = `<span style="font-size:15px">${opt.sym}</span><span style="font-size:10px;color:#aaa">${opt.label}</span><span style="font-size:9px;color:#556">${msLabel}</span>`;
      ob.onclick = () => { picker.remove(); isConvert ? opt.action() : snapAllChannels(opt.steps); };
      picker.appendChild(ob);
    });

    document.body.appendChild(picker);
    setTimeout(() => {
      const close = ev => {
        if (!picker.contains(ev.target) && ev.target !== document.getElementById('btnSnap')) {
          picker.remove();
          document.removeEventListener('mousedown', close);
        }
      };
      document.addEventListener('mousedown', close);
    }, 0);
  };

  // Guardar / Cargar
  document.getElementById('btnSave').onclick      = saveRhythm;
  document.getElementById('btnSaveGroove').onclick = saveAsGrooveScript;
  document.getElementById('btnLoad').onclick = () => {
    document.getElementById('loadDropdownPanel').classList.remove('open');
    document.getElementById('loadDropdownBtn').classList.remove('open');
    loadRhythm();
  };

  // + Canal
  document.getElementById('btnAddCh').onclick = () => {
    if (channels.length >= MAX_CH) return;
    channels.push(emptyChannel(channels.length));
    render();
  };



  // Rueda del ratón → scroll horizontal en el secuenciador
  document.querySelector('.sequencer-wrap').addEventListener('wheel', e => {
    e.preventDefault();
    document.querySelector('.sequencer-wrap').scrollLeft += e.deltaY || e.deltaX;
  }, { passive: false });

  // WebSocket — iniciar conexión al cargar la página
  initWS();

  // Song panel — botones
  document.getElementById('btnSongAdd').onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json'; inp.multiple = true;
    inp.onchange = e => Array.from(e.target.files).forEach(songLoadFile);
    inp.click();
  };
  document.getElementById('btnMeasureSelAdd').onclick   = addSelMeasuresToQueue;
  document.getElementById('btnMeasureSelClear').onclick = () => {
    selectedMeasures.clear(); _updateMeasureSelBar(); renderHeaders();
  };

  document.getElementById('btnMeasureJump').onclick = () => {
    const inp = document.getElementById('jumpMeasureInput');
    const m = parseInt(inp.value) || 1;
    jumpToMeasure(m);
  };
  document.getElementById('jumpMeasureInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const m = parseInt(e.target.value) || 1;
      jumpToMeasure(m);
    }
  });

  document.getElementById('btnSongSave').onclick = saveSongToJSON;
  document.getElementById('btnSongLoad').onclick = loadSongFromJSON;

  document.getElementById('btnSongMerge').onclick = mergeSongEntries;
  document.getElementById('btnSongMergeClear').onclick = () => {
    songSelected.clear(); _updateSongMergeBar(); renderSongQueue();
  };

  // Piano Audio - Toggle on/off
  const _pianoControls = ['pianoOctave', 'pianoInstrument', 'pianoWaveform'];
  function _setPianoControlsEnabled() {
    _pianoControls.forEach(id => {
      const el = document.getElementById(id);
      // Siempre habilitados por defecto
      el.style.color       = '#2c1e12';
      el.style.background  = '#ede0ce';
      el.style.borderColor = '#c8a882';
    });
  }

  document.getElementById('audioToggle').onchange = async (e) => {
    audioEnabled = e.target.checked;
    _setPianoControlsEnabled(audioEnabled);
    if (audioEnabled) {
      await initToneAudio();
      setStatus('🎹 Piano Virtual ACTIVADO');
    } else {
      setStatus('🎹 Piano Virtual desactivado');
    }
  };

  // Piano Audio - Cambiar octava
  document.getElementById('pianoOctave').onchange = (e) => {
    audioOctaveOffset = parseInt(e.target.value);
    if (audioEnabled) {
      setStatus('🎹 Piano octava: C' + audioOctaveOffset);
    }
  };

  // Piano Audio - Cambiar instrumento
  document.getElementById('pianoInstrument').onchange = (e) => {
    currentInstrument = e.target.value;
    if (toneInitialized) recreateSampler();
    setStatus('🎺 Instrumento: ' + currentInstrument);
  };

  // Piano Audio - Cambiar tipo de onda
  document.getElementById('pianoWaveform').onchange = (e) => {
    currentWaveform = e.target.value;
    if (toneInitialized) {
      recreateSampler();
    }
    setStatus('〰️ Onda: ' + currentWaveform);
  };

  // Logs
  document.getElementById('btnLogs').onclick = () => {
    const w = window.open('', 'Logs', 'width=700,height=600,resizable=yes,scrollbars=yes');
    w.document.write(`<!DOCTYPE html><html><head><title>ESP32 Logs</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:monospace;background:#111122;color:#00ff88;display:flex;flex-direction:column;height:100vh;padding:8px;gap:6px;}
#toolbar{display:flex;gap:6px;align-items:center;flex-shrink:0;}
button{background:#1a1a33;border:1px solid #445;color:#aaa;border-radius:4px;padding:3px 10px;cursor:pointer;font-family:monospace;font-size:11px;}
button:hover{background:#2a2a55;color:#fff;}
#L{flex:1;overflow-y:auto;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all;background:#080816;border:1px solid #2a2a44;border-radius:4px;padding:8px;}
</style></head>
<body>
<div id="toolbar">
  <span style="color:#ff4466;font-weight:bold;font-size:12px;letter-spacing:2px">ESP32 LOGS</span>
  <button onclick="autoScroll=!autoScroll;this.textContent=autoScroll?'▼ Auto':'— Fijo'">▼ Auto</button>
  <button onclick="document.getElementById('L').textContent='';seen=''">🗑 Limpiar</button>
</div>
<pre id="L"></pre>
<script>
var autoScroll=true, seen='';
function u(){
  fetch('http://${ESP32_IP}/logs').then(r=>r.text()).then(d=>{
    if(d===seen) return;
    var l=document.getElementById('L');
    // Añadir solo las líneas nuevas
    if(d.startsWith(seen)){
      l.textContent+=d.slice(seen.length);
    } else {
      l.textContent=d;
    }
    seen=d;
    if(autoScroll) l.scrollTop=l.scrollHeight;
  }).catch(function(){});
}
setInterval(u,600); u();
<\/script></body></html>`);
    w.document.close();
  };
});


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
  const events       = [];
  const chanInfo     = {};
  const trackInfo    = {};  // { t: { name, noteStats, minNote, maxNote } }
  const pendingNotes = {};
  let   maxTick      = 0;

  const ensureChan = ch => {
    if (!chanInfo[ch]) {
      const prog = (ch === 9) ? -1 : 0;
      chanInfo[ch] = { program: prog, instrName: (ch === 9) ? 'GM Drums' : (GM_INSTRUMENTS[0] || 'Instrumento'), noteStats: {} };
    }
    return chanInfo[ch];
  };

  const ensureTrack = t => {
    if (!trackInfo[t]) trackInfo[t] = { name: `Track ${t}`, noteStats: {}, minNote: 127, maxNote: 0, hits: 0 };
    return trackInfo[t];
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
        if (mt === 0x51 && ml.val >= 3)
          tempo = (b[pos] << 16) | (b[pos+1] << 8) | b[pos+2];
        // Meta 0x03 = Track Name
        if (mt === 0x03 && ml.val > 0) {
          const name = String.fromCharCode(...b.slice(pos, pos + ml.val)).trim();
          if (name) ensureTrack(t).name = name;
        }
        if (mt === 0x2F) { pos += ml.val; break; }
        pos += ml.val;

      } else if (st === 0xF0 || st === 0xF7) {
        const sl = midiVlq(b, pos); pos += sl.n + sl.val;

      } else if (cmd === 0x90) {
        const note = b[pos++], vel = b[pos++];
        if (vel > 0) {
          const ci = ensureChan(ch);
          ci.noteStats[note] = (ci.noteStats[note] || 0) + 1;
          // Guardar track en el evento
          const ti = ensureTrack(t);
          ti.noteStats[note] = (ti.noteStats[note] || 0) + 1;
          ti.hits++;
          if (note < ti.minNote) ti.minNote = note;
          if (note > ti.maxNote) ti.maxNote = note;

          const evt = { note, tick, vel, ch, track: t, durationTicks: 0 };
          events.push(evt);
          if (tick > maxTick) maxTick = tick;
          const pkey = `${t}_${ch}_${note}`;
          if (!pendingNotes[pkey]) pendingNotes[pkey] = [];
          pendingNotes[pkey].push(evt);
        } else {
          const pkey = `${t}_${ch}_${note}`;
          const q = pendingNotes[pkey];
          if (q && q.length) { const evt = q.shift(); evt.durationTicks = tick - evt.tick; if (tick > maxTick) maxTick = tick; }
        }

      } else if (cmd === 0x80) {
        const note = b[pos++]; pos++;
        const pkey = `${t}_${ch}_${note}`;
        const q = pendingNotes[pkey];
        if (q && q.length) { const evt = q.shift(); evt.durationTicks = tick - evt.tick; if (tick > maxTick) maxTick = tick; }

      } else if (cmd === 0xC0) {
        const program = b[pos++];
        if (ch !== 9) {
          const ci = ensureChan(ch);
          ci.program = program;
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

  const tickToMs  = t => Math.round(t * tempo / division / 1000);
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
    trackInfo,
    noteStats,
    tickToMs
  };
}

function midiToRhythm(md, noteMap, htDur) {
  const tps    = md.division / 4;  // ticks por semicorchea
  const nMeas  = Math.max(1, Math.ceil(Math.ceil((md.maxTick + tps) / tps) / 16));
  const nSteps = nMeas * 16;

  const byKey = {};
  md.events.forEach(e => {
    const key   = `${e.ch}_${e.note}`;
    const motor = (noteMap[key] != null) ? parseInt(noteMap[key]) : -1;
    if (motor < 0 || motor >= MAX_CH) return;
    if (!byKey[key]) byKey[key] = { motor, ch: e.ch, note: e.note, steps: new Array(nSteps).fill(0) };
    
    // --- Cálculo exacto de pasos que ocupa la nota ---
    let startStep = Math.floor(e.tick / tps);
    if (startStep < 0 || startStep >= nSteps) return;
    
    let endStep;
    if (e.durationTicks > 0) {
      // El último tick que pertenece a la nota es tick + durationTicks - 1
      endStep = Math.floor((e.tick + e.durationTicks - 1) / tps);
    } else {
      endStep = startStep; // duración cero → al menos un paso
    }
    if (endStep >= nSteps) endStep = nSteps - 1;
    
    // Escribir duración real: steps[startStep] = nPasos, colas = 0
    const durSteps = endStep - startStep + 1;
    byKey[key].steps[startStep] = durSteps;
    for (let i = startStep + 1; i <= endStep; i++)
      byKey[key].steps[i] = 0;
  });

  const chs = Object.values(byKey).sort((a, b) => a.motor - b.motor).map(k => ({
    name:    noteDisplayName(k.ch, k.note),
    motor:   k.motor,
    vel:     70,
    homePwm: 375,
    muted:   false,
    sustain: k.ch === 9,   // batería → percusivo; melódico → sostenido
    steps:   k.steps
  }));

  return { bpm: md.bpm, hitDur: htDur || 80, numMeasures: nMeas, channels: chs };
}

// ---- Convertir MIDI → comando exacto (timestamps ms) -------
// ============================================================
// UI — Modal de importación MIDI  (flujo en pasos)
// ============================================================
let _midiData = null;

// ---- Pitch class → motor (escala cromática: 12 notas = 12 motores) ----
const _PC_TO_MOTOR = { 0:0, 1:1, 2:2, 3:3, 4:4, 5:5, 6:6, 7:7, 8:8, 9:9, 10:10, 11:11 };
const _MOTOR_NOTE_NAME = ['C','C#','D','D#/Eb','E','F','F#/Gb','G','G#/Ab','A','A#/Bb','B'];

// ---- Orden musical de notas ----------------------------------
// C, D, E, F, G, A, B (naturales) luego C#, D#, F#, G#, A# — ascendente por octava.
const _NOTE_SORT_POS = [0, 7, 1, 8, 2, 3, 9, 4, 10, 5, 11, 6]; // índice=pc
function _musicalSortKey(midiNote) {
  return Math.floor(midiNote / 12) * 12 + _NOTE_SORT_POS[midiNote % 12];
}

// ---- Auto-asignar motores por pitch class -------------------
// Cada nota se asigna directamente a su motor cromático (note % 12).
function _autoMotorMap(ch, notesSorted) {
  const map = {};
  notesSorted.forEach(note => {
    map[`${ch}_${note}`] = note % 12;
  });
  return map;
}

// ---- Cargar ritmo en el secuenciador -------------------------
// Mantiene siempre la estructura de 12 canales cromáticos (Do–Si, motores 0–11)
// y vuelca las notas MIDI en los canales correspondientes.
function _loadRhythmFromNoteMap(md, noteMap) {
  const rhythm = midiToRhythm(md, noteMap, hitDur);
  if (!rhythm.channels.length) {
    setStatus('No hay notas asignadas a motores', 'error');
    return false;
  }
  bpm = rhythm.bpm;
  document.getElementById('bpmSlider').value = bpm;
  document.getElementById('bpmValue').value  = bpm;
  hitDur = rhythm.hitDur;
  document.getElementById('hitDur').value = hitDur;
  numMeasures = rhythm.numMeasures;
  numSteps    = rhythm.numMeasures * 16;
  document.getElementById('measuresInput').value = numMeasures;

  // Estructura fija de 12 canales cromáticos
  channels = DEFAULT_KEYS.map(k => ({
    ...emptyChannel(k.motor),
    name: k.name,
    motor: k.motor,
    steps: new Array(numSteps).fill(0)
  }));

  // Volcar datos MIDI en los canales correspondientes por número de motor
  rhythm.channels.forEach(midiCh => {
    const target = channels.find(c => c.motor === midiCh.motor);
    if (!target) return;
    // Copiar pasos respetando la duración (steps[i] > 1 = nota larga)
    for (let i = 0; i < numSteps && i < midiCh.steps.length; i++) {
      if (midiCh.steps[i]) target.steps[i] = midiCh.steps[i];
    }
    target.sustain = midiCh.sustain;
  });

  songLoadedIdx = -1; songLoadedModified = false;
  render();
  if (isPlaying) {
  }
  return true;
}

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

// ---- Helpers de construcción del modal ----------------------
function _mkModalBtn(txt, col, fn) {
  const btn = document.createElement('button');
  btn.textContent = txt;
  btn.style.cssText = `border:1px solid ${col};color:${col};border-radius:6px;padding:7px 14px;cursor:pointer;font-family:inherit;font-size:12px;background:transparent;transition:all .12s;letter-spacing:1px`;
  btn.onmouseover = () => { btn.style.background = col; btn.style.color = '#000'; };
  btn.onmouseout  = () => { btn.style.background = 'transparent'; btn.style.color = col; };
  btn.onclick = fn;
  return btn;
}
function _mkModalOverlay() {
  const ov = document.createElement('div');
  ov.id = 'midiModal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;z-index:9999;overflow:auto;padding:16px;';
  ov.onclick = e => { if (e.target === ov) closeMidiModal(); };
  return ov;
}
function _mkModalBox() {
  const box = document.createElement('div');
  box.style.cssText = [
    'background:#1a1a33','border:1px solid #3498db','border-radius:10px',
    'padding:20px','width:min(520px,100%)','font-family:"Courier New",monospace',
    'color:#ddd','box-shadow:0 0 40px rgba(52,152,219,.3)',
    'max-height:90vh','overflow-y:auto','display:flex','flex-direction:column','gap:12px'
  ].join(';');
  return box;
}
function _mkModalFooter() {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding-top:10px;margin-top:auto;position:sticky;bottom:-20px;background:#1a1a33;padding-bottom:4px';
  return row;
}
function _mkModalHeader(title) {
  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center';
  hdr.innerHTML = `
    <span style="color:#3498db;font-weight:bold;font-size:13px;letter-spacing:2px">${title}</span>
    <button onclick="closeMidiModal()" style="background:transparent;border:1px solid #445;color:#888;border-radius:4px;padding:2px 8px;cursor:pointer;font-family:inherit;font-size:13px">✕</button>`;
  return hdr;
}
function _mkFileInfo(md, chanNums) {
  const info = document.createElement('div');
  info.style.cssText = 'background:#0d0d22;border-radius:6px;padding:9px 12px;font-size:11px;color:#888;line-height:2';
  info.innerHTML =
    `<span style="color:#ff4466">${md._name}</span><br>` +
    `BPM: <b style="color:#fff">${md.bpm}</b>` +
    ` &nbsp;·&nbsp; Duración: <b style="color:#fff">${(md.durationMs/1000).toFixed(1)}s</b>` +
    ` &nbsp;·&nbsp; Instrumentos: <b style="color:#fff">${chanNums.length}</b>`;
  return info;
}

// ============================================================
// PASO 1 — Seleccionar instrumentos (multi-selección)
// ============================================================
function showMidiModal(md) {
  closeMidiModal();
  const chanNums = Object.keys(md.chanInfo)
    .map(Number)
    .filter(ch => Object.keys(md.chanInfo[ch].noteStats).length > 0)
    .sort((a, b) => { if (a===9) return 1; if (b===9) return -1; return a-b; });

  const ov  = _mkModalOverlay();
  const box = _mkModalBox();
  box.appendChild(_mkModalHeader('📥 PASO 1 — SELECCIONAR INSTRUMENTOS'));
  box.appendChild(_mkFileInfo(md, chanNums));

  const listDiv = document.createElement('div');
  listDiv.style.cssText = 'display:flex;flex-direction:column;gap:4px';
  chanNums.forEach(ch => {
    const ci     = md.chanInfo[ch];
    const nNotes = Object.keys(ci.noteStats).length;
    const nHits  = md.events.filter(e => e.ch === ch).length;

    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #3498db;border-radius:8px;cursor:pointer;transition:border-color .15s,opacity .15s;user-select:none';

    const chk = document.createElement('input');
    chk.type = 'checkbox'; chk.checked = true; chk.dataset.ch = ch;
    chk.style.cssText = 'accent-color:#3498db;width:15px;height:15px;flex-shrink:0;cursor:pointer';
    chk.addEventListener('change', () => {
      row.style.borderColor = chk.checked ? '#3498db' : '#2a2a44';
      row.style.opacity     = chk.checked ? '1' : '0.45';
    });

    const infoSpan = document.createElement('span');
    infoSpan.style.cssText = 'flex:1;min-width:0';
    infoSpan.innerHTML =
      `<span style="font-weight:bold;font-size:13px;color:#ddd">${ci.instrName}</span><br>` +
      `<span style="color:#445;font-size:10px">CH ${ch} &nbsp;·&nbsp; ${nNotes} pitch${nNotes>1?'es':''} &nbsp;·&nbsp; ${nHits} hits</span>`;

    row.appendChild(chk);
    row.appendChild(infoSpan);
    listDiv.appendChild(row);
  });
  box.appendChild(listDiv);

  const btnRow = _mkModalFooter();
  btnRow.appendChild(_mkModalBtn('✕ Cancelar', '#445', closeMidiModal));
  btnRow.appendChild(_mkModalBtn('Siguiente →', '#3498db', () => {
    const selChs = [...box.querySelectorAll('[data-ch]:checked')].map(c => parseInt(c.dataset.ch));
    if (!selChs.length) { alert('Selecciona al menos un instrumento'); return; }
    showMidiStep2Instrument(md, selChs);
  }));
  box.appendChild(btnRow);

  ov.appendChild(box);
  document.body.appendChild(ov);
}

// ============================================================
// PASO 2 — Elegir modo: transposición automática o manual
// ============================================================
function showMidiStep2Instrument(md, selChs) {
  closeMidiModal();

  const ov  = _mkModalOverlay();
  const box = _mkModalBox();
  box.appendChild(_mkModalHeader('📥 PASO 2 — MODO DE ASIGNACIÓN'));

  // — Resumen de instrumentos seleccionados —
  const info = document.createElement('div');
  info.style.cssText = 'background:#0d0d22;border-radius:6px;padding:9px 12px;font-size:11px;color:#888;line-height:1.8';
  const names = selChs.map(ch => `<span style="color:#ddd">${md.chanInfo[ch].instrName}</span>`).join(' &nbsp;·&nbsp; ');
  const totalHits = selChs.reduce((sum, ch) => sum + md.events.filter(e => e.ch === ch).length, 0);
  info.innerHTML =
    `<b style="color:#3498db">${selChs.length} instrumento${selChs.length>1?'s':''}</b> &nbsp;·&nbsp; ` +
    `<b style="color:#fff">${totalHits}</b> hits totales<br>${names}`;
  box.appendChild(info);

  const hint = document.createElement('p');
  hint.style.cssText = 'font-size:12px;color:#888;margin:0';
  hint.textContent = 'Elige cómo asignar las notas a los motores:';
  box.appendChild(hint);

  // — Opción 1: Transposición automática —
  const optTransp = document.createElement('div');
  optTransp.style.cssText = 'border:1px solid #2a2a44;border-radius:8px;padding:12px 14px;cursor:pointer;transition:border-color .15s';
  optTransp.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px">
      <input type="radio" name="midiStep2" value="auto" id="midiStep2Auto" checked style="accent-color:#ff8800;width:16px;height:16px">
      <label for="midiStep2Auto" style="cursor:pointer;font-size:13px;font-weight:bold;color:#ff8800">🎵 Transposición automática</label>
    </div>
    <p style="margin:8px 0 0 26px;font-size:11px;color:#666;line-height:1.5">
      Cada nota MIDI se asigna automáticamente a su motor cromático (Do=0, Do#=1, … Si=11).
      Las notas del mismo nombre en distintas octavas comparten motor.
    </p>`;
  box.appendChild(optTransp);

  // — Opción 2: Asignación manual —
  const optManual = document.createElement('div');
  optManual.style.cssText = 'border:1px solid #2a2a44;border-radius:8px;padding:12px 14px;cursor:pointer;transition:border-color .15s';
  optManual.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px">
      <input type="radio" name="midiStep2" value="manual" id="midiStep2Manual" style="accent-color:#3498db;width:16px;height:16px">
      <label for="midiStep2Manual" style="cursor:pointer;font-size:13px;font-weight:bold;color:#3498db">🎹 Asignación manual</label>
    </div>
    <p style="margin:8px 0 0 26px;font-size:11px;color:#666;line-height:1.5">
      Se muestran todas las notas del instrumento y tú decides qué motor
      toca cada una.
    </p>`;
  box.appendChild(optManual);

  // Resaltar opción activa
  box.querySelectorAll('input[name="midiStep2"]').forEach(r => {
    r.addEventListener('change', () => {
      optTransp.style.borderColor  = '#2a2a44';
      optManual.style.borderColor  = '#2a2a44';
      const sel = box.querySelector('input[name="midiStep2"]:checked');
      if (!sel) return;
      if (sel.value === 'auto') optTransp.style.borderColor = '#ff8800';
      else                      optManual.style.borderColor = '#3498db';
    });
  });

  // — Botones —
  const btnRow = _mkModalFooter();
  btnRow.appendChild(_mkModalBtn('← Volver', '#445', () => showMidiModal(md)));
  btnRow.appendChild(_mkModalBtn('Siguiente →', '#3498db', () => {
    const sel = box.querySelector('input[name="midiStep2"]:checked');
    if (!sel) { alert('Elige una opción primero'); return; }
    if (sel.value === 'auto') showMidiAutoTranspose(md, selChs);
    else                      showMidiManualAssign(md, selChs);
  }));
  box.appendChild(btnRow);

  ov.appendChild(box);
  document.body.appendChild(ov);
}

// ============================================================
// PASO 3A — Asignación cromática automática (DEFAULT_KEYS motores)
// ============================================================
function showMidiAutoTranspose(md, selChs) {
  closeMidiModal();

  // Build REPR (one MIDI note per motor) from DEFAULT_KEYS
  const REPR = DEFAULT_KEYS.map(key => {
    const noteName = key.name.replace(/[\s\/].*$/, '').replace(/\d/g, '');
    const semitone = NOTE_TO_SEMITONE[noteName] ?? (key.motor % 12);
    const octave   = parseInt(key.name.match(/(\d)/)?.[1] ?? '4');
    return (octave + 1) * 12 + semitone;
  });

  function buildEvents() {
    return md.events.map(e => {
      if (!selChs.includes(e.ch)) return e;
      // Prefer exact octave match, fall back to semitone (motor 0-11)
      const exactIdx = REPR.indexOf(e.note);
      const motor    = exactIdx >= 0 ? exactIdx : e.note % 12;
      return { ...e, note: REPR[motor] };
    });
  }

  const col = '#2ecc71';
  const ov  = _mkModalOverlay();
  const box = _mkModalBox();
  box.appendChild(_mkModalHeader('📥 STEP 3 — CHROMATIC ASSIGNMENT'));

  const resDiv = document.createElement('div');
  resDiv.style.cssText = 'background:#0d0d22;border-radius:6px;padding:12px 14px;font-size:12px;line-height:1.9';
  resDiv.innerHTML =
    `<div style="color:#888">Each MIDI note is assigned to its chromatic motor (note % 12). Higher-octave motors take priority.</div>` +
    `<div style="color:#2ecc71;margin-top:4px">✔ ${selChs.length} instrument${selChs.length>1?'s':''} · motors 0–${DEFAULT_KEYS.length - 1}</div>`;
  box.appendChild(resDiv);

  const tblWrap = document.createElement('div');
  tblWrap.style.cssText = 'border:1px solid #2a2a44;border-radius:8px;overflow:hidden;max-height:320px;overflow-y:auto';
  const tbl = document.createElement('table');
  tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';
  tbl.innerHTML = `
    <thead style="color:#445;font-size:10px;text-transform:uppercase;letter-spacing:1px;background:#0d0d22;position:sticky;top:0">
      <tr>
        <th style="text-align:center;padding:4px 8px">Motor</th>
        <th style="text-align:left;padding:4px 10px">Note</th>
        <th style="text-align:center;padding:4px 8px">MIDI</th>
      </tr>
    </thead><tbody></tbody>`;

  const tbody = tbl.querySelector('tbody');
  DEFAULT_KEYS.forEach((key, motor) => {
    const isHighOctave = motor >= 12;
    const isSharp      = [1,3,6,8,10].includes(motor % 12);
    const tr = document.createElement('tr');
    tr.style.cssText = 'border-top:1px solid ' + (isHighOctave ? '2px solid #3498db' : '1px solid #1e1e36') +
      (isSharp && !isHighOctave ? ';background:#0a0a1e' : '');
    tr.innerHTML = `
      <td style="padding:5px 8px;text-align:center;font-weight:bold;color:#fff">${motor}</td>
      <td style="padding:5px 10px;color:${isHighOctave?'#3498db':isSharp?'#ff8800':'#2ecc71'};font-weight:bold;font-size:13px">${key.name}</td>
      <td style="padding:5px 8px;text-align:center;color:#556;font-size:11px">${REPR[motor]}</td>`;
    tbody.appendChild(tr);
  });
  tblWrap.appendChild(tbl);
  box.appendChild(tblWrap);

  const btnRow = _mkModalFooter();
  btnRow.appendChild(_mkModalBtn('← Back', '#445', () => showMidiStep2Instrument(md, selChs)));
  btnRow.appendChild(_mkModalBtn('✔ Load to Sequencer', col, () => {
    const newEvents = buildEvents();
    const noteMap = {};
    selChs.forEach(ch => REPR.forEach((note, motor) => {
      noteMap[`${ch}_${note}`] = motor;
    }));
    const newChanInfo = { ...md.chanInfo };
    selChs.forEach(ch => {
      const ns = {};
      newEvents.forEach(e => { if (e.ch === ch) ns[e.note] = (ns[e.note] || 0) + 1; });
      newChanInfo[ch] = { ...md.chanInfo[ch], noteStats: ns };
    });
    const mdQ = { ...md, events: newEvents, chanInfo: newChanInfo };
    if (_loadRhythmFromNoteMap(mdQ, noteMap)) {
      closeMidiModal();
      setStatus('MIDI → sequencer (chromatic): ' + md._name + ' — ' + mdQ.bpm + ' BPM');
    }
  }));
  box.appendChild(btnRow);

  ov.appendChild(box);
  document.body.appendChild(ov);
}

// ============================================================
// PASO 3B — Asignación manual nota → motor (multi-instrumento)
// ============================================================
function showMidiManualAssign(md, selChs) {
  closeMidiModal();

  // Todas las notas únicas ordenadas por pitch ascendente
  const allNotes = [];
  selChs.forEach(ch => {
    Object.keys(md.chanInfo[ch].noteStats).map(Number).forEach(note => {
      if (!allNotes.find(e => e.ch === ch && e.note === note))
        allNotes.push({ ch, note, hits: md.chanInfo[ch].noteStats[note], instrName: md.chanInfo[ch].instrName });
    });
  });
  allNotes.sort((a, b) => a.note - b.note);

  // Octavas presentes en el MIDI (floor(note/12))
  const octaves = [...new Set(allNotes.map(e => Math.floor(e.note / 12)))].sort((a, b) => a - b);
  let octaveIdx = 0; // índice en el array octaves

  // Nombre de octava para mostrar (MIDI: C4=60, floor(60/12)=5, octava=5-1=4)
  const _PC_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const _octLabel = raw => { const o = raw - 1; return `${_PC_NAMES[0]}${o} – ${_PC_NAMES[11]}${o}`; };

  // Construye el mapa nota→motor para la octava activa
  const _buildMap = () => {
    const target = octaves[octaveIdx];
    const map = {};
    allNotes.forEach(({ ch, note }) => {
      map[`${ch}_${note}`] = Math.floor(note / 12) === target ? note % 12 : -1;
    });
    return map;
  };

  // Actualiza todos los selects según la octava activa
  const _updateSelects = () => {
    const map = _buildMap();
    Object.entries(map).forEach(([key, motor]) => {
      const sel = document.getElementById(`midiM_${key}`);
      if (sel) sel.value = motor;
    });
    shiftIndicator.textContent = _octLabel(octaves[octaveIdx]);
  };

  const ov  = _mkModalOverlay();
  const box = _mkModalBox();
  box.appendChild(_mkModalHeader('📥 PASO 3 — ASIGNACIÓN MANUAL'));

  const hint = document.createElement('p');
  hint.style.cssText = 'font-size:11px;color:#666;margin:0;line-height:1.5';
  hint.textContent = 'Usa − / + para cambiar la octava asignada a los motores. El resto queda sin asignar (—).';
  box.appendChild(hint);

  // Fila de control de octava
  const shiftRow = document.createElement('div');
  shiftRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0';
  const shiftLbl = document.createElement('span');
  shiftLbl.style.cssText = 'font-size:11px;color:#888';
  shiftLbl.textContent = 'Octava activa:';
  shiftRow.appendChild(shiftLbl);

  const shiftIndicator = document.createElement('span');
  shiftIndicator.style.cssText = 'font-size:12px;color:#ff8800;font-weight:bold;min-width:90px;text-align:center';
  shiftIndicator.textContent = _octLabel(octaves[0]);

  const btnShiftM = _mkModalBtn('−', '#ff8800', () => {
    if (octaveIdx > 0) { octaveIdx--; _updateSelects(); }
  });
  const btnShiftP = _mkModalBtn('+', '#ff8800', () => {
    if (octaveIdx < octaves.length - 1) { octaveIdx++; _updateSelects(); }
  });
  btnShiftM.style.padding = '3px 10px';
  btnShiftP.style.padding = '3px 10px';

  shiftRow.appendChild(btnShiftM);
  shiftRow.appendChild(shiftIndicator);
  shiftRow.appendChild(btnShiftP);
  box.appendChild(shiftRow);

  // Tabla de notas ordenadas por pitch
  const tblWrap = document.createElement('div');
  tblWrap.style.cssText = 'border:1px solid #2a2a44;border-radius:8px;overflow:hidden;max-height:340px;overflow-y:auto';
  const tbl = document.createElement('table');
  tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';
  tbl.innerHTML = `
    <tr style="color:#445;font-size:10px;text-transform:uppercase;letter-spacing:1px;background:#0d0d22;position:sticky;top:0">
      <th style="text-align:left;padding:4px 10px">Instrumento</th>
      <th style="text-align:left;padding:4px 6px">Nota</th>
      <th style="text-align:center;padding:4px 6px">Hits</th>
      <th style="text-align:center;padding:4px 10px">Motor</th>
    </tr>`;

  const initialMap = _buildMap();
  allNotes.forEach(({ ch, note, hits, instrName }) => {
    const key     = `${ch}_${note}`;
    const initVal = initialMap[key];
    const isSharp = [1,3,6,8,10].includes(note % 12);
    const noteCol = isSharp ? '#ff8800' : '#2ecc71';
    const opts = [-1, ...DEFAULT_KEYS.map((_, i) => i)]
      .map(m => `<option value="${m}" ${initVal===m?'selected':''}>${m===-1?'—':m+' '+DEFAULT_KEYS[m].name}</option>`)
      .join('');
    const tr = document.createElement('tr');
    tr.style.borderTop = '1px solid #1e1e36';
    tr.innerHTML = `
      <td style="padding:5px 10px;color:#888;font-size:11px">${instrName}</td>
      <td style="padding:5px 6px;color:${noteCol};font-weight:bold">${noteDisplayName(ch, note)}</td>
      <td style="padding:5px 6px;text-align:center;color:#666">${hits}</td>
      <td style="padding:5px 10px;text-align:center">
        <select id="midiM_${key}" style="background:#1a1a44;color:#ddd;border:1px solid #334;border-radius:4px;padding:2px 4px;font-family:inherit;font-size:12px;width:72px">${opts}</select>
      </td>`;
    tbl.appendChild(tr);
  });

  tblWrap.appendChild(tbl);
  box.appendChild(tblWrap);

  const warn = document.createElement('p');
  warn.style.cssText = 'font-size:10px;color:#445;line-height:1.6;margin:0';
  warn.textContent = '⚠ homePwm = 375 por defecto. Ajusta con "m X; o PWM;" después si es necesario.';
  box.appendChild(warn);

  const btnRow = _mkModalFooter();
  btnRow.style.flexWrap = 'wrap';
  btnRow.appendChild(_mkModalBtn('← Volver', '#445', () => showMidiStep2Instrument(md, selChs)));
  btnRow.appendChild(_mkModalBtn('✔ Cargar en secuenciador', '#3498db', () => {
    const noteMap = {};
    document.querySelectorAll('[id^="midiM_"]').forEach(sel => {
      noteMap[sel.id.slice(6)] = parseInt(sel.value);
    });
    if (_loadRhythmFromNoteMap(md, noteMap)) {
      closeMidiModal();
      setStatus('MIDI → secuenciador: ' + md._name + ' — ' + md.bpm + ' BPM');
    }
  }));
  box.appendChild(btnRow);

  ov.appendChild(box);
  document.body.appendChild(ov);
}

// ============================================================
// POPUP — ACORDES (tonalidad + escala)
// ============================================================

function closeAcordesModal() {
  const m = document.getElementById('acordesModal'); if (m) m.remove();
}

function openAcordesModal() {
  closeAcordesModal();

  const ov  = document.createElement('div');
  ov.id = 'acordesModal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;z-index:9999;overflow:auto;padding:16px;';
  ov.onclick = e => { if (e.target === ov) closeAcordesModal(); };

  const box = _mkModalBox();
  box.style.width = 'min(560px,100%)';

  // Header
  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center';
  hdr.innerHTML = `
    <span style="color:#3498db;font-weight:bold;font-size:13px;letter-spacing:2px">🎼 ACORDES — TONALIDAD Y ESCALA</span>
    <button onclick="closeAcordesModal()" style="background:transparent;border:1px solid #445;color:#888;border-radius:4px;padding:2px 8px;cursor:pointer;font-family:inherit;font-size:13px">✕</button>`;
  box.appendChild(hdr);

  // Controles tonalidad + escala
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end';

  const selStyle = 'background:#0d0d22;color:#ddd;border:1px solid #3498db;border-radius:4px;padding:5px 8px;font-size:12px;font-family:"Courier New",monospace;cursor:pointer;';

  row.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:4px">
      <label style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:1px">Tonalidad</label>
      <select id="chordKey" style="${selStyle}width:75px">
        ${['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'].map(n=>`<option value="${n}">${n}</option>`).join('')}
      </select>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px">
      <label style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:1px">Escala</label>
      <select id="chordScale" style="${selStyle}width:170px">
        ${['Mayor','Menor Natural','Menor Armónica','Menor Melódica','Dórica','Frigia','Lidia','Mixolidia','Pentatónica Mayor','Pentatónica Menor','Blues'].map(s=>`<option value="${s}">${s}</option>`).join('')}
      </select>
    </div>`;
  box.appendChild(row);

  // Descripción de la escala
  const desc = document.createElement('div');
  desc.id = 'scaleDescription';
  desc.style.cssText = 'background:#0d0d22;border:1px solid #334;border-radius:6px;padding:10px;font-size:11px;color:#aaa;line-height:1.8;min-height:40px';
  box.appendChild(desc);

  // Footer
  const footer = _mkModalFooter();
  footer.appendChild(_mkModalBtn('👁 View Scale', '#3498db', () => { viewScale(); closeAcordesModal(); }));
  footer.appendChild(_mkModalBtn('✕ Cerrar', '#666', closeAcordesModal));
  box.appendChild(footer);

  ov.appendChild(box);
  document.body.appendChild(ov);

  // Conectar selects y actualizar descripción inicial
  document.getElementById('chordKey').onchange   = updateScaleDescription;
  document.getElementById('chordScale').onchange = updateScaleDescription;
  updateScaleDescription();
}

// ============================================================
// NOTES → CHORDS (harmonize current grid)
// ============================================================

function applyHarmonizeToGrid(key, scale) {
  const gridSize = channels[0]?.steps.length || numSteps;
  let count = 0;

  for (let step = 0; step < gridSize; step++) {
    // Collect hits at this step position (snapshot before modifying)
    const hits = [];
    for (let ch = 0; ch < 12; ch++) {
      if (channels[ch] && channels[ch].steps[step] > 0) {
        hits.push({ ch, val: channels[ch].steps[step] });
      }
    }

    // Expand each hit to its diatonic triad
    for (const hit of hits) {
      const chordSemitones = harmonizeNote(hit.ch, key, scale);
      for (const s of chordSemitones) {
        if (s !== hit.ch && channels[s] && channels[s].steps[step] === 0) {
          channels[s].steps[step] = hit.val; // same duration as original note
          count++;
        }
      }
    }
  }

  render();
  setStatus(`✓ Notes → Chords: ${count} note${count !== 1 ? 's' : ''} added`);
  closeHarmonizeGridModal();
}

function closeHarmonizeGridModal() {
  const m = document.getElementById('harmonizeGridModal'); if (m) m.remove();
}

function openHarmonizeGridModal() {
  closeHarmonizeGridModal();

  const ov = document.createElement('div');
  ov.id = 'harmonizeGridModal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;z-index:9999;overflow:auto;padding:16px;';
  ov.onclick = e => { if (e.target === ov) closeHarmonizeGridModal(); };

  const box = _mkModalBox();
  box.style.width = 'min(420px,100%)';

  // Header
  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center';
  hdr.innerHTML = `<span style="color:#3498db;font-weight:bold;font-size:13px;letter-spacing:2px">🎵 NOTES → CHORDS</span>
    <button onclick="closeHarmonizeGridModal()" style="background:transparent;border:1px solid #445;color:#888;border-radius:4px;padding:2px 8px;cursor:pointer;font-family:inherit;font-size:13px">✕</button>`;
  box.appendChild(hdr);

  // Info
  const info = document.createElement('div');
  info.style.cssText = 'font-size:11px;color:#888;line-height:1.7;background:#0d0d22;border:1px solid #334;border-radius:6px;padding:10px;';
  info.textContent = 'Expands each note in the grid to its diatonic 3-note chord. Chord duration matches the original note.';
  box.appendChild(info);

  // Key + Scale selectors
  const selStyle = 'background:#0d0d22;color:#ddd;border:1px solid #3498db;border-radius:4px;padding:5px 8px;font-size:12px;font-family:"Courier New",monospace;cursor:pointer;';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end';
  row.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:4px">
      <label style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:1px">Key</label>
      <select id="hgKey" style="${selStyle}width:75px">
        ${['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'].map(n=>`<option value="${n}">${n}</option>`).join('')}
      </select>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px">
      <label style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:1px">Scale</label>
      <select id="hgScale" style="${selStyle}width:170px">
        ${['Mayor','Menor Natural','Menor Armónica','Menor Melódica','Dórica','Frigia','Lidia','Mixolidia','Pentatónica Mayor','Pentatónica Menor','Blues'].map(s=>`<option value="${s}">${s}</option>`).join('')}
      </select>
    </div>`;
  box.appendChild(row);

  // Footer
  const footer = _mkModalFooter();
  footer.appendChild(_mkModalBtn('🎵 Apply', '#27ae60', () => {
    applyHarmonizeToGrid(
      document.getElementById('hgKey').value,
      document.getElementById('hgScale').value
    );
  }));
  footer.appendChild(_mkModalBtn('✕ Cancel', '#666', closeHarmonizeGridModal));
  box.appendChild(footer);

  ov.appendChild(box);
  document.body.appendChild(ov);
}

// ============================================================
// CONVERSOR DE ACORDES → SECUENCIA
// ============================================================

// Mapeo de notas a semitono desde C
const NOTE_TO_SEMITONE = {
  'C': 0, 'C#': 1, 'Db': 1,
  'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'F': 5, 'F#': 6, 'Gb': 6,
  'G': 7, 'G#': 8, 'Ab': 8,
  'A': 9, 'A#': 10, 'Bb': 10,
  'B': 11
};

// Triadas mayores y menores (intervalos desde root en semitonos)
const CHORD_INTERVALS = {
  'major': [0, 4, 7],      // C, E, G
  'minor': [0, 3, 7],      // C, Eb, G
  'maj7': [0, 4, 7, 11],   // C, E, G, B
  'min7': [0, 3, 7, 10],   // C, Eb, G, Bb
  '7': [0, 4, 7, 10],      // C, E, G, Bb (dominante)
  'sus2': [0, 2, 7],       // C, D, G
  'sus4': [0, 5, 7],       // C, F, G
  'dim': [0, 3, 6],        // C, Eb, Gb
  'aug': [0, 4, 8]         // C, E, G#
};

// Parsear nombre de nota/acorde
// Reglas:
//   "E4", "F#3", "Bb2" → sufijo solo dígito ≠ 7  → nota individual (octava ignorada)
//   "E", "G", "C#"     → sin sufijo              → acorde mayor (3 notas)
//   "Em", "G7", "Cmaj7"→ sufijo de acorde        → acorde completo
function parseChordName(text) {
  text = text.trim();
  if (!text) return null;

  const upper = text.toUpperCase();

  // Extraer nota (2 chars si hay # o b, sino 1 char)
  let note, suffix;
  if (upper.length >= 2 && (upper[1] === '#' || upper[1] === 'B') &&
      NOTE_TO_SEMITONE.hasOwnProperty(upper.substring(0, 2))) {
    note   = upper.substring(0, 2);
    suffix = text.substring(2).toLowerCase();
  } else {
    note   = upper[0];
    suffix = text.substring(1).toLowerCase();
  }

  if (!NOTE_TO_SEMITONE.hasOwnProperty(note)) return null;

  // Si el sufijo es solo un dígito y NO es '7' (dom7), es número de octava → nota individual
  if (/^\d$/.test(suffix) && suffix !== '7') {
    return { note, chordType: 'single' };
  }

  const chordType =
    suffix === ''                               ? 'single' : // nota sola → punteo individual
    suffix === 'maj'                            ? 'major'  : // Gmaj explícito → acorde mayor
    suffix === 'm' || suffix === 'min'          ? 'minor'  :
    suffix === '7'                              ? '7'      :
    suffix === 'maj7'                           ? 'maj7'   :
    suffix === 'm7' || suffix === 'min7'        ? 'min7'   :
    suffix === 'sus2'                           ? 'sus2'   :
    suffix === 'sus4'                           ? 'sus4'   :
    suffix === 'dim' || suffix === '°'          ? 'dim'    :
    suffix === 'aug' || suffix === '+'          ? 'aug'    :
    /^\d+$/.test(suffix)                        ? 'single' : // número de octava → individual
    'single'; // sufijo desconocido → nota individual por seguridad

  return { note, chordType };
}

// Devuelve los semitonos (0-11) de una nota o acorde
function getChordSemitones(chordName) {
  const chord = parseChordName(chordName);
  if (!chord) return [];
  const root = NOTE_TO_SEMITONE[chord.note];
  if (chord.chordType === 'single') return [root];  // nota individual
  const intervals = CHORD_INTERVALS[chord.chordType] || CHORD_INTERVALS['major'];
  return intervals.map(i => (root + i) % 12);
}

// Armoniza una nota con el acorde diatónico de la escala que empieza en ella.
// Devuelve array de semitonos (1 nota si no hay match, 3 si hay acorde).
function harmonizeNote(noteSemitone, key, scaleType) {
  const keyIdx = NOTE_NAMES.indexOf(key) >= 0 ? NOTE_NAMES.indexOf(key) : FLAT_NAMES.indexOf(key);
  if (keyIdx < 0) return [noteSemitone];

  const scaleData = CHORD_SCALES[scaleType];
  if (!scaleData) return [noteSemitone];

  // Offset de la nota desde la tónica
  const offset = (noteSemitone - keyIdx + 12) % 12;

  // Buscar el grado de la escala que tiene ese offset
  const chordDef = scaleData.chords.find(c => c.offset === offset);
  if (!chordDef) return [noteSemitone]; // nota cromática → nota sola

  // Triada correspondiente al tipo de ese grado
  const intervals = chordDef.type === 'major'      ? [0, 4, 7] :
                    chordDef.type === 'minor'      ? [0, 3, 7] :
                    /* diminished */                 [0, 3, 6];

  return intervals.map(i => (noteSemitone + i) % 12);
}

// ============================================================
// MML-R (GrooveScript) PARSER
// ============================================================

// Convert duration string to grid steps
// Musical: "1"→16, "1/2"→8, "1/4"→4, "1/8"→2, "1/16"→1
// Ms: "120" → round(120 / ms_per_step), ms_per_step = (60000/tempo)/4
function mmlrDurationToSteps(durStr, tempo) {
  tempo = tempo || 120;
  durStr = String(durStr).trim();
  const fracMatch = durStr.match(/^(\d+)(?:\/(\d+))?$/);
  if (fracMatch) {
    const num = parseInt(fracMatch[1]);
    const den = fracMatch[2] ? parseInt(fracMatch[2]) : 1;
    return Math.max(1, Math.round((num / den) * 16));
  }
  const ms = parseFloat(durStr);
  if (!isNaN(ms) && ms > 0) {
    const msPerStep = (60000 / tempo) / 4;
    return Math.max(1, Math.round(ms / msPerStep));
  }
  return 4;
}

// Parse @PARAM=VALUE directives from text
function mmlrParseParams(text) {
  const params = { tempo: 120, defaultVel: 100, defaultDur: '1/4', oct: 4, harmonize: null };
  for (const line of text.split('\n')) {
    const m = line.match(/@(\w+)\s*=\s*(.+)/);
    if (!m) continue;
    const k = m[1].toUpperCase(), v = m[2].trim();
    if (k === 'TEMPO')       params.tempo      = parseInt(v)  || 120;
    if (k === 'DEFAULT_VEL') params.defaultVel = parseInt(v)  || 100;
    if (k === 'DEFAULT_DUR') params.defaultDur = v;
    if (k === 'OCT')         params.oct        = parseInt(v)  || 4;
    if (k === 'HARMONIZE') {
      const p = v.split(':');
      if (p.length >= 2) params.harmonize = { key: p[0].trim(), scale: p[1].trim() };
    }
  }
  return params;
}

// Strip @PARAM lines and | separators
function mmlrStripParams(text) {
  return text.split('\n').filter(l => !l.trim().startsWith('@')).join(' ').replace(/\|/g, ' ');
}

// Expand [EVENTS]xN repetition blocks (recursive, innermost first)
function mmlrExpandRepetitions(text) {
  let prev;
  do {
    prev = text;
    text = text.replace(/\[([^\[\]]*)\]x(\d+)/gi, (_, content, n) => (content + ' ').repeat(parseInt(n)));
  } while (text !== prev);
  return text;
}

// Main MML-R parser → { events[], params }
function parseMMLR(text) {
  const params = mmlrParseParams(text);
  let clean    = mmlrStripParams(text);
  clean        = mmlrExpandRepetitions(clean);

  // Encode spaces inside () to split on whitespace later
  clean = clean.replace(/\(([^)]+)\)/g, (_, inner) => '(' + inner.trim().replace(/\s+/g, '_') + ')');

  const tokens = clean.trim().split(/\s+/).filter(t => t.length > 0);
  const events = [];
  const defSteps = () => mmlrDurationToSteps(params.defaultDur, params.tempo);

  for (const token of tokens) {
    // Octave shifts — no octave dimension in aTambor, skip
    if (token === 'O+' || token === 'O-') continue;

    // Rest: R:DUR
    if (/^R:/i.test(token)) {
      const parts = token.split(':');
      const steps = parts[1] ? mmlrDurationToSteps(parts[1], params.tempo) : defSteps();
      events.push({ type: 'rest', semitones: [], steps, vel: 0 });
      continue;
    }

    // Chord group: (N_N_N):DUR:VEL[articulation]
    if (token.startsWith('(')) {
      const m = token.match(/^\(([^)]+)\)(?::([^:>.<\-]+))?(?::([^>.<\-]+))?([>.<\-]*)$/);
      if (m) {
        const semitones = [...new Set(m[1].split('_').map(n => {
          const key = n.toUpperCase().replace(/\d/g, '');
          return NOTE_TO_SEMITONE[key] !== undefined ? NOTE_TO_SEMITONE[key] % 12 : null;
        }).filter(s => s !== null))];
        const steps = m[2] ? mmlrDurationToSteps(m[2], params.tempo) : defSteps();
        let vel     = m[3] ? (parseInt(m[3]) || params.defaultVel) : params.defaultVel;
        const art   = m[4] || '';
        if (art.includes('>')) vel = Math.min(127, vel + 20);
        if (art.includes('<')) vel = Math.max(1,   vel - 20);
        const adjSteps = art.includes('.') ? Math.max(1, Math.round(steps * 0.5)) : steps;
        if (semitones.length > 0) events.push({ type: 'chord', semitones, steps: adjSteps, vel });
      }
      continue;
    }

    // Note / named chord: NOTE[:DUR[:VEL]][articulation]
    const artM = token.match(/^(.+?)([>.<\-]*)$/);
    const main  = artM[1], art = artM[2];
    const parts = main.split(':');
    const noteName = parts[0];
    const durPart  = parts[1] || null;
    const velPart  = parts[2] || null;

    const chordParsed = parseChordName(noteName);
    if (!chordParsed) continue;

    let semitones = getChordSemitones(noteName);
    if (semitones.length === 0) continue;

    // Apply @HARMONIZE: single note → diatonic chord
    if (params.harmonize && semitones.length === 1) {
      semitones = harmonizeNote(semitones[0], params.harmonize.key, params.harmonize.scale);
    }

    let steps = durPart ? mmlrDurationToSteps(durPart, params.tempo) : defSteps();
    let vel   = velPart ? (parseInt(velPart) || params.defaultVel) : params.defaultVel;

    if (art.includes('>')) vel = Math.min(127, vel + 20);
    if (art.includes('<')) vel = Math.max(1,   vel - 20);
    if (art.includes('.')) steps = Math.max(1, Math.round(steps * 0.5));

    events.push({ type: semitones.length === 1 ? 'note' : 'chord', semitones, steps, vel });
  }

  return { events, params };
}

// Convert parsed MML-R to a 12-channel Fragment
function mmlrToFragment(parsed) {
  const { events, params } = parsed;
  const totalSteps    = events.reduce((a, e) => a + e.steps, 0);
  const totalMeasures = Math.max(1, Math.ceil(totalSteps / 16));
  const gridSize      = totalMeasures * 16;

  const channels = DEFAULT_KEYS.map(key => ({
    name: key.name, motor: key.motor, vel: 60, homePwm: 375,
    muted: false, sustain: false, steps: new Array(gridSize).fill(0)
  }));

  let pos = 0;
  for (const ev of events) {
    if (ev.type !== 'rest' && pos < gridSize) {
      ev.semitones.forEach(s => { channels[s % 12].steps[pos] = ev.steps; });
    }
    pos += ev.steps;
  }

  return { channels, totalMeasures, params };
}

// Preview for MML-R modal
function updateMMLRPreview() {
  const text    = document.getElementById('mmlrInputText').value;
  const preview = document.getElementById('mmlrParsePreview');
  if (!text.trim()) { preview.textContent = '(type MML-R to see preview)'; return; }

  try {
    const { events, params } = parseMMLR(text);
    if (events.length === 0) { preview.textContent = 'No valid events recognized.'; return; }

    const NM = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const totalSteps    = events.reduce((a, e) => a + e.steps, 0);
    const totalMeasures = Math.max(1, Math.ceil(totalSteps / 16));

    let out = `BPM: ${params.tempo}  |  Events: ${events.length}  |  ${totalMeasures} measure${totalMeasures !== 1 ? 's' : ''}`;
    if (params.harmonize) out += `  |  🎼 ${params.harmonize.key} ${params.harmonize.scale}`;
    out += '\n\n';

    const MAX = 30;
    events.slice(0, MAX).forEach((ev, i) => {
      const label = ev.type === 'rest' ? '— rest' : ev.semitones.length === 1 ? '♩' : '🎵';
      const notes = ev.semitones.map(s => NM[s % 12]).join('+');
      out += `${i + 1}. ${label} [${notes || '—'}]  ${ev.steps}step${ev.steps !== 1 ? 's' : ''}\n`;
    });
    if (events.length > MAX) out += `... (+${events.length - MAX} more)\n`;
    out += `\nTotal: ${totalSteps} steps = ${totalMeasures} measure${totalMeasures !== 1 ? 's' : ''}`;
    preview.textContent = out;
  } catch(e) {
    preview.textContent = 'Error: ' + e.message;
  }
}

// Add MML-R fragment to sequencer
function addMMLRToSequencer() {
  const text = document.getElementById('mmlrInputText').value;
  if (!text.trim()) { alert('Type a MML-R sequence.'); return; }

  let parsed;
  try { parsed = parseMMLR(text); }
  catch(e) { alert('Parse error: ' + e.message); return; }

  if (parsed.events.length === 0) { alert('No valid events recognized.'); return; }

  const { channels, totalMeasures, params } = mmlrToFragment(parsed);
  const NM = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const firstNotes = parsed.events
    .filter(e => e.type !== 'rest').slice(0, 6)
    .map(e => e.semitones.map(s => NM[s % 12]).join('+')).join(' ');

  const fragmentName = `GS: ${firstNotes || 'Secuencia'}`;

  songQueue.push({
    name: fragmentName, channels,
    bpm: params.tempo || bpm, hitDur, retractDur,
    numMeasures: totalMeasures, repeats: 1
  });

  renderSongQueue();
  setStatus(`✓ Fragment: "${fragmentName}" — ${parsed.events.length} events, ${totalMeasures} measures`);
  closeMMLRModal();
  const tab = document.querySelector('[data-tab="tab-cancion"]');
  if (tab) tab.click();
}

// ============================================================
// POPUP — GrooveScript (MML-R) EDITOR
// ============================================================

function closeMMLRModal() {
  const m = document.getElementById('mmlrModal'); if (m) m.remove();
}

function openChordConverterModal() {
  closeMMLRModal();

  const ov = document.createElement('div');
  ov.id = 'mmlrModal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;z-index:9999;overflow:auto;padding:16px;';
  ov.onclick = e => { if (e.target === ov) closeMMLRModal(); };

  const box = _mkModalBox();
  box.style.width = 'min(600px,100%)';

  // Header
  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center';
  hdr.innerHTML = `<span style="color:#3498db;font-weight:bold;font-size:13px;letter-spacing:2px">🎵 GROOVESCRIPT → FRAGMENT</span>
    <button onclick="closeMMLRModal()" style="background:transparent;border:1px solid #445;color:#888;border-radius:4px;padding:2px 8px;cursor:pointer;font-family:inherit;font-size:13px">✕</button>`;
  box.appendChild(hdr);

  // Template quick-load buttons
  const tmplRow = document.createElement('div');
  tmplRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
  [
    ['Melody',      '@TEMPO=120\n@DEFAULT_DUR=1/4\n\nE E F G G F E D C C D E E:1/2 D:1/2'],
    ['Chords',      '@TEMPO=120\n@DEFAULT_DUR=1/4\n\nCmaj:1/4 Am:1/4 Fmaj:1/4 G7:1/4'],
    ['Harmonizing', '@TEMPO=120\n@DEFAULT_DUR=1/4\n@HARMONIZE=C:Mayor\n\nE F G D C C D E'],
    ['Groove',      '@TEMPO=120\n@DEFAULT_DUR=1/8\n\n[ C:1/16 R:1/16 C:1/8 R:1/8 ]x4'],
  ].forEach(([label, tmpl]) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = 'background:#0d0d22;color:#3498db;border:1px solid #3498db;border-radius:4px;padding:3px 10px;font-size:10px;cursor:pointer;font-family:"Courier New",monospace;';
    btn.onclick = () => { document.getElementById('mmlrInputText').value = tmpl; updateMMLRPreview(); };
    tmplRow.appendChild(btn);
  });
  box.appendChild(tmplRow);

  // Syntax hint bar
  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:9px;color:#556;line-height:1.6;background:#0a0a18;border:1px solid #223;border-radius:4px;padding:8px;font-family:"Courier New",monospace;';
  hint.innerHTML = '<b style="color:#3498db">@TEMPO</b>=120  <b style="color:#27ae60">@DEFAULT_DUR</b>=1/4  <b style="color:#e67e22">@HARMONIZE</b>=C:Mayor<br>'
    + '<span style="color:#aaa">C4:1/4  E:1/8  R:1/4  Em:1/2  (E4 G4 B4):1/4  [C D E F]x4  O+  O-</span>';
  box.appendChild(hint);

  // Textarea
  const ta = document.createElement('textarea');
  ta.id = 'mmlrInputText';
  ta.placeholder = '@TEMPO=120\n@DEFAULT_DUR=1/4\n\nE E F G G F E D C C D E';
  ta.style.cssText = 'width:100%;min-height:100px;background:#0d0d22;color:#ddd;border:1px solid #3498db;border-radius:4px;padding:8px;font-size:12px;font-family:"Courier New",monospace;resize:vertical;box-sizing:border-box;';
  ta.oninput = updateMMLRPreview;
  box.appendChild(ta);

  // Preview panel
  const prev = document.createElement('div');
  prev.id = 'mmlrParsePreview';
  prev.style.cssText = 'background:#0d0d22;border:1px solid #334;border-radius:6px;padding:10px;font-size:11px;color:#aaa;line-height:1.7;min-height:60px;white-space:pre-wrap;word-wrap:break-word;max-height:180px;overflow-y:auto;';
  prev.textContent = '(type MML-R to see preview)';
  box.appendChild(prev);

  // Footer
  const footer = _mkModalFooter();
  footer.appendChild(_mkModalBtn('➕ Add Fragment', '#27ae60', addMMLRToSequencer));
  footer.appendChild(_mkModalBtn('✕ Close',        '#666',    closeMMLRModal));
  box.appendChild(footer);

  ov.appendChild(box);
  document.body.appendChild(ov);
  updateMMLRPreview();
}

// ============================================================
// STAFF VIEW — VexFlow Phase 4 (full scope)
// ============================================================
let staffViewActive          = false;
let staffEditMode            = 'add';   // 'add'|'delete'|'tie'|'tuplet'|'repeat-start'|'repeat-end'
let staffSelectedDur         = 4;       // steps: 16,8,4,2,1,-1(32nd),-2(64th)
let staffSelectedCh          = 0;       // channel index
let staffSelectedDynamic     = '';      // ''|'ppp'|'pp'|'p'|'mp'|'mf'|'f'|'ff'|'fff'|'sfz'
let staffSelectedArticulation= '';      // ''|'staccato'|'tenuto'|'accent'|'marcato'|'fermata'
let staffTupletCount         = 3;       // 3 = triplet, 6 = sextuplet
let staffTiePending          = null;    // {ci, absStep} — first note of pending tie
let measureNotation          = {};      // {mi: {repeatStart, repeatEnd}}
let _staveLayout             = [];      // [{mi,x,y,w,h,noteX,noteW}]
let staffZoom                = 32;      // px per occupied step (controls stave width)

// VexFlow key + accidental per motor index (0-15)
const MOTOR_VEX = [
  { key: 'c/4',  acc: null },  // 0  C1
  { key: 'c#/4', acc: '#'  },  // 1  C#
  { key: 'd/4',  acc: null },  // 2  D1
  { key: 'd#/4', acc: '#'  },  // 3  D#1
  { key: 'e/4',  acc: null },  // 4  E1
  { key: 'f/4',  acc: null },  // 5  F1
  { key: 'f#/4', acc: '#'  },  // 6  F#1
  { key: 'g/4',  acc: null },  // 7  G1
  { key: 'g#/4', acc: '#'  },  // 8  G#1
  { key: 'a/4',  acc: null },  // 9  A1
  { key: 'a#/4', acc: '#'  },  // 10 A#1
  { key: 'b/4',  acc: null },  // 11 B1
  { key: 'c/5',  acc: null },  // 12 C2
  { key: 'd/5',  acc: null },  // 13 D2
  { key: 'e/5',  acc: null },  // 14 E2
  { key: 'g/5',  acc: null },  // 15 G2
];

const _STEPS_TO_DUR = [[16,'w'],[8,'h'],[4,'q'],[2,'8'],[1,'16']];

function _stepsToVexDur(n) {
  return (_STEPS_TO_DUR.find(([s]) => s <= n) || [1,'16'])[1];
}

// Fill a gap of `steps` steps with rest notes
function _addRests(out, steps, VF) {
  let rem = steps;
  while (rem > 0) {
    const [s, d] = _STEPS_TO_DUR.find(([s]) => s <= rem) || [1,'16'];
    out.push(new VF.StaveNote({ keys: ['b/4'], duration: d + 'r' }));
    rem -= s;
  }
}

// Build VexFlow notes for one measure — returns {notes, noteReg, tupletGroups}
function _buildMeasureNotes(mi, VF) {
  const offset = mi * 16;
  const byStep = {};

  channels.forEach((ch, ci) => {
    if (ci >= MOTOR_VEX.length) return;
    for (let s = 0; s < 16; s++) {
      const dur = ch.steps[offset + s] || 0;
      if (dur > 0) {
        if (!byStep[s]) byStep[s] = [];
        const n = ch.notation || {};
        byStep[s].push({
          ci, dur, muted: !!ch.muted,
          dynamic:     (n.dynamics     || {})[offset + s] || '',
          articulation:(n.articulations|| {})[offset + s] || '',
          durOverride: (n.durOverride  || {})[offset + s] || ''
        });
      }
    }
  });

  const notes       = [];
  const noteReg     = {};  // `${ci}_${absStep}` → VF note
  const stepToNote  = {};  // local step → VF note (for tuplet lookup)
  let pos = 0;

  Object.keys(byStep).map(Number).sort((a, b) => a - b).forEach(step => {
    if (step > pos) _addRests(notes, step - pos, VF);

    const evs    = byStep[step].sort((a, b) => a.ci - b.ci);
    const keys   = evs.map(e => MOTOR_VEX[e.ci].key);
    const maxDur = Math.max(...evs.map(e => e.dur));
    const vexDur = evs[0].durOverride || _stepsToVexDur(maxDur);
    const note   = new VF.StaveNote({ keys, duration: vexDur, clef: 'treble' });

    evs.forEach((e, ki) => {
      const vex   = MOTOR_VEX[e.ci];
      const color = e.muted ? '#999999' : '#27ae60';
      if (vex.acc) note.addModifier(new VF.Accidental(vex.acc), ki);
      note.setKeyStyle(ki, { fillStyle: color, strokeStyle: color });
    });
    note.setStemStyle({ fillStyle: '#555', strokeStyle: '#555' });

    const dynVal = evs.find(e => e.dynamic)?.dynamic;
    if (dynVal) {
      const ann = new VF.Annotation(dynVal);
      ann.setFont('Times New Roman', 11, 'bold italic');
      ann.setVerticalJustification(3);
      note.addModifier(ann);
    }
    const artVal = evs.find(e => e.articulation)?.articulation;
    if (artVal) {
      const artMap = { staccato:'a.', tenuto:'a-', accent:'a>', marcato:'a^', fermata:'a@a' };
      const code = artMap[artVal];
      if (code) note.addModifier(new VF.Articulation(code));
    }

    notes.push(note);
    evs.forEach(e => { noteReg[`${e.ci}_${offset + step}`] = note; });
    stepToNote[step] = note;
    pos = step + maxDur;
  });

  if (pos < 16) _addRests(notes, 16 - pos, VF);

  // Detect tuplet groups for this measure
  const tupletGroups = [];
  channels.forEach((ch, ci) => {
    if (ci >= MOTOR_VEX.length) return;
    (ch.notation?.tuplets || []).forEach(tup => {
      const localStart = tup.start - offset;
      if (localStart < 0 || localStart >= 16) return;
      const relevant = Object.keys(byStep).map(Number)
        .filter(s => s >= localStart && byStep[s].some(e => e.ci === ci))
        .sort((a, b) => a - b).slice(0, tup.count);
      const tupNotes = relevant.map(s => stepToNote[s]).filter(Boolean);
      if (tupNotes.length >= 2) tupletGroups.push({ notes: tupNotes, count: tup.count });
    });
  });

  return { notes, noteReg, tupletGroups };
}

// ---- Toolbar ------------------------------------------------
function _buildStaffToolbar() {
  const tb = document.getElementById('staffToolbar');
  if (!tb) return;
  const durs = [
    { steps:16, sym:'𝅝',   label:'Whole'     },
    { steps: 8, sym:'𝅗𝅥',   label:'Half'      },
    { steps: 4, sym:'♩',   label:'Quarter'   },
    { steps: 2, sym:'♪',   label:'Eighth'    },
    { steps: 1, sym:'♬',   label:'Sixteenth' },
    { steps:-1, sym:'𝅘𝅥𝅯',  label:'32nd (fusa)'    },
    { steps:-2, sym:'𝅘𝅥𝅱',  label:'64th (semifusa)' },
  ];
  // Helper: btn with .btn class + optional active-color override
  const btn = (onclick, label, title, selColor, isSelected, extraStyle='') => {
    const activeStyle = isSelected ? `background:${selColor};color:#fff;border-color:${selColor};` : '';
    return `<button class="btn" onclick="${onclick}" title="${title||label}" style="font-size:11px;padding:3px 8px;letter-spacing:0;${activeStyle}${extraStyle}">${label}</button>`;
  };
  const sep = `<span style="color:#b09070;margin:0 2px;font-size:13px">│</span>`;
  const lbl = (t) => `<span style="font-size:10px;color:#7a5a40;margin-right:1px;letter-spacing:0.5px;text-transform:uppercase">${t}</span>`;

  let h = `<div style="display:flex;gap:3px;flex-wrap:wrap;align-items:center;padding:6px 4px 4px;background:#ede0ce;border-radius:8px;border:1px solid #c8a882;margin-bottom:6px">`;

  // Group 1: Mode
  h += lbl('Mode');
  h += btn("setStaffMode('add')",    '✏ Add',     'Add note',   '#3a7850', staffEditMode==='add');
  h += btn("setStaffMode('delete')", '🗑 Del',    'Delete',     '#a03828', staffEditMode==='delete');
  h += btn("setStaffMode('tie')",    '~ Tie',     'Tie notes',  '#3a6a9a', staffEditMode==='tie');
  h += sep;

  // Group 2: Duration
  h += lbl('Duration');
  durs.forEach(d => {
    h += btn(`setStaffDur(${d.steps})`, d.sym, d.label, '#3a6a9a', staffSelectedDur===d.steps, 'font-size:14px;padding:2px 6px;');
  });
  h += sep;

  // Group 3: Note (channel selector)
  h += lbl('Note');
  DEFAULT_KEYS.forEach((k, i) => {
    const sharp = k.name.includes('#');
    const label = k.name.replace(/\d.*/,'');
    const baseStyle = sharp ? 'color:#8b5e00;' : '';
    h += btn(`setStaffCh(${i})`, label, k.name, '#8e44ad', staffSelectedCh===i, `font-size:10px;padding:2px 4px;min-width:24px;${baseStyle}`);
  });
  h += `</div>`;

  // Row 2: Dynamics + Articulations
  h += `<div style="display:flex;gap:3px;flex-wrap:wrap;align-items:center;padding:4px;background:#ede0ce;border-radius:8px;border:1px solid #c8a882;margin-bottom:4px">`;
  h += lbl('Dynamics');
  ['ppp','pp','p','mp','mf','f','ff','fff','sfz'].forEach(d => {
    h += btn(`setStaffDyn('${d}')`, d, d, '#a03828', staffSelectedDynamic===d, 'font-style:italic;min-width:26px;');
  });
  h += btn("setStaffDyn('')", '✕', 'Clear dynamic', '', false, 'color:#999;padding:3px 6px;');
  h += sep;
  h += lbl('Articulation');
  [['staccato','·','Staccato'],['tenuto','—','Tenuto'],['accent','>','Accent'],['marcato','^','Marcato'],['fermata','𝄐','Fermata']].forEach(([id,sym,title]) => {
    h += btn(`setStaffArt('${id}')`, sym, title, '#9a7820', staffSelectedArticulation===id, 'font-size:14px;');
  });
  h += btn("setStaffArt('')", '✕', 'Clear articulation', '', false, 'color:#999;padding:3px 6px;');
  h += `</div>`;

  // Row 3: Tuplets + Repeats + Zoom
  h += `<div style="display:flex;gap:3px;flex-wrap:wrap;align-items:center;padding:4px;background:#ede0ce;border-radius:8px;border:1px solid #c8a882;margin-bottom:6px">`;
  h += lbl('Tuplet');
  h += btn("setStaffMode('tuplet')",  '3 Triplet',   'Triplet',    '#7d3c98', staffEditMode==='tuplet' && staffTupletCount===3);
  h += btn("setStaffMode('tuplet6')", '6 Sextuplet', 'Sextuplet',  '#6c3483', staffEditMode==='tuplet' && staffTupletCount===6);
  h += sep;
  h += lbl('Repeat');
  h += btn("setStaffMode('repeat-start')", '|: Begin', 'Repeat begin', '#16a085', staffEditMode==='repeat-start');
  h += btn("setStaffMode('repeat-end')",   ':| End',   'Repeat end',   '#16a085', staffEditMode==='repeat-end');
  h += sep;
  h += lbl('Zoom');
  h += btn('setStaffZoom(staffZoom-6)', '−', 'Zoom out', '', false, 'padding:3px 9px;font-size:14px;');
  h += `<span style="font-size:11px;color:#7a5a40;min-width:34px;text-align:center">${staffZoom}px</span>`;
  h += btn('setStaffZoom(staffZoom+6)', '+', 'Zoom in',  '', false, 'padding:3px 9px;font-size:14px;');
  if (staffEditMode === 'tie' && staffTiePending) {
    h += `<span style="font-size:11px;color:#3a6a9a;margin-left:8px;font-style:italic">~ click second note (ch ${staffTiePending.ci})</span>`;
  }
  h += `</div>`;

  tb.innerHTML = h;
}

function setStaffMode(m) {
  if (m === 'tuplet')  { staffTupletCount = 3; staffEditMode = 'tuplet'; }
  else if (m === 'tuplet6') { staffTupletCount = 6; staffEditMode = 'tuplet'; }
  else { staffEditMode = m; }
  if (m !== 'tie') staffTiePending = null;
  _buildStaffToolbar();
}
function setStaffDur(d)  { staffSelectedDur          = d; _buildStaffToolbar(); }
function setStaffCh(i)   { staffSelectedCh           = i; _buildStaffToolbar(); }
function setStaffDyn(d)  { staffSelectedDynamic      = staffSelectedDynamic  === d ? '' : d; _buildStaffToolbar(); }
function setStaffArt(a)  { staffSelectedArticulation = staffSelectedArticulation === a ? '' : a; _buildStaffToolbar(); }
function setStaffZoom(v) { staffZoom = Math.max(20, Math.min(80, +v)); _buildStaffToolbar(); renderStaff(); }

// Count unique occupied step positions in a measure (0-16)
function _staffDensity(mi) {
  const offset = mi * 16;
  const occ = new Set();
  channels.forEach(ch => {
    for (let s = 0; s < 16; s++) {
      if ((ch.steps[offset + s] || 0) > 0) occ.add(s);
    }
  });
  return occ.size;
}

// ---- Click → measure + step ---------------------------------
function _xyToMeasureStep(px, py) {
  for (const s of _staveLayout) {
    if (px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h) {
      const relX = px - s.noteX;
      if (relX < 0 || relX > s.noteW) return { mi: -1, step: -1 };
      const step = Math.max(0, Math.min(15, Math.floor(relX / s.noteW * 16)));
      return { mi: s.mi, step };
    }
  }
  return { mi: -1, step: -1 };
}

function _onStaffSvgClick(ev) {
  if (!staffViewActive) return;
  const wrap = document.getElementById('staffSvg');
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const px   = ev.clientX - rect.left;
  const py   = ev.clientY - rect.top;
  const { mi, step } = _xyToMeasureStep(px, py);
  if (mi < 0 || step < 0) return;

  const absStep = mi * 16 + step;
  const ci      = staffSelectedCh;

  // ---- Repeat barlines (measure-level, no channel needed) ----
  if (staffEditMode === 'repeat-start' || staffEditMode === 'repeat-end') {
    if (!measureNotation[mi]) measureNotation[mi] = {};
    const key = staffEditMode === 'repeat-start' ? 'repeatStart' : 'repeatEnd';
    measureNotation[mi][key] = !measureNotation[mi][key];
    renderStaff();
    return;
  }

  if (ci >= channels.length) return;
  const stps = channels[ci].steps;

  // ---- Tie mode (two-click) ----------------------------------
  if (staffEditMode === 'tie') {
    const ns = _noteStart(stps, absStep);
    if (!staffTiePending) {
      if (ns >= 0) { staffTiePending = { ci, absStep: ns }; _buildStaffToolbar(); }
    } else {
      if (staffTiePending.ci === ci && ns >= 0 && ns !== staffTiePending.absStep) {
        const n = _chNotation(channels[ci]);
        const from = Math.min(staffTiePending.absStep, ns);
        const to   = Math.max(staffTiePending.absStep, ns);
        // Remove duplicate tie if exists
        n.ties = n.ties.filter(t => !(t.from === from && t.to === to));
        n.ties.push({ from, to });
      }
      staffTiePending = null;
      _buildStaffToolbar();
      renderStaff();
    }
    return;
  }

  // ---- Tuplet mode -------------------------------------------
  if (staffEditMode === 'tuplet') {
    const ns = _noteStart(stps, absStep);
    if (ns >= 0) {
      const n = _chNotation(channels[ci]);
      n.tuplets = n.tuplets.filter(t => t.start !== ns);
      n.tuplets.push({ start: ns, count: staffTupletCount });
      renderStaff();
    }
    return;
  }

  // ---- Delete ------------------------------------------------
  if (staffEditMode === 'delete') {
    const ns = _noteStart(stps, absStep);
    if (ns >= 0) {
      const n = _chNotation(channels[ci]);
      delete n.dynamics[ns];
      delete n.articulations[ns];
      delete n.durOverride[ns];
      n.ties    = n.ties.filter(t => t.from !== ns && t.to !== ns);
      n.tuplets = n.tuplets.filter(t => t.start !== ns);
      stps[ns] = 0;
      renderStaff();
      renderChannels();
    }
    return;
  }

  // ---- Add ---------------------------------------------------
  const gridDur = staffSelectedDur > 0 ? staffSelectedDur : 1;
  const durOvr  = staffSelectedDur === -1 ? '32' : staffSelectedDur === -2 ? '64' : '';
  const end = Math.min(absStep + gridDur, stps.length);
  for (let s = absStep; s < end; s++) {
    const ns = _noteStart(stps, s);
    if (ns >= 0) stps[ns] = 0;
  }
  stps[absStep] = gridDur;
  const n = _chNotation(channels[ci]);
  if (staffSelectedDynamic)      n.dynamics[absStep]      = staffSelectedDynamic;
  else                           delete n.dynamics[absStep];
  if (staffSelectedArticulation) n.articulations[absStep] = staffSelectedArticulation;
  else                           delete n.articulations[absStep];
  if (durOvr) n.durOverride[absStep] = durOvr;
  else        delete n.durOverride[absStep];
  renderStaff();
  renderChannels();
}

// ---- Renderer -----------------------------------------------
function renderStaff() {
  const container = document.getElementById('staffSvg');
  if (!container) return;
  if (typeof Vex === 'undefined') {
    container.innerHTML = '<p style="color:#c0392b;padding:12px">VexFlow not loaded — check internet connection.</p>';
    return;
  }
  container.innerHTML = '';
  _staveLayout = [];
  const VF = Vex.Flow;

  const STAVE_H    = 120;
  const CLEF_EXTRA = 80;
  const MAX_ROW_W  = 960;
  const ML = 20, MT = 24;

  // --- Dynamic layout: per-measure width based on note density ---
  const layout = [];     // [{mi, x, y, w, isFirst}]
  let rowX = 0, rowY = 0, rowHasEntry = false;

  for (let mi = 0; mi < numMeasures; mi++) {
    const density = _staffDensity(mi);
    const baseW   = Math.max(120, density * staffZoom + 30);
    const isFirst = !rowHasEntry;
    const w       = isFirst ? baseW + CLEF_EXTRA : baseW;

    if (rowHasEntry && rowX + w > MAX_ROW_W) {
      rowY += STAVE_H;
      rowX = 0;
      rowHasEntry = false;
      const wf = baseW + CLEF_EXTRA;
      layout.push({ mi, x: ML, y: MT + rowY, w: wf, isFirst: true });
      rowX = wf;
    } else {
      layout.push({ mi, x: ML + rowX, y: MT + rowY, w, isFirst });
      rowX += w;
    }
    rowHasEntry = true;
  }

  const totalW = Math.max(...layout.map(e => e.x + e.w)) + ML;
  const totalH = MT + rowY + STAVE_H + 10;

  const renderer = new VF.Renderer(container, VF.Renderer.Backends.SVG);
  renderer.resize(totalW, totalH);
  const ctx = renderer.getContext();
  ctx.setFont('Arial', 9, 'normal');

  const noteRegistry = {};  // `${ci}_${absStep}` → VF note (for ties)

  for (const { mi, x, y, w, isFirst } of layout) {
    const noteX = isFirst ? x + CLEF_EXTRA + 8 : x + 5;
    const noteW = w - 35;
    _staveLayout.push({ mi, x, y, w, h: STAVE_H - 20, noteX, noteW });

    const stave = new VF.Stave(x, y, w);
    if (isFirst) stave.addClef('treble').addTimeSignature('4/4');

    // Repeat barlines
    const mn = measureNotation[mi] || {};
    if (mn.repeatStart) stave.setBegBarType(VF.Barline.type.REPEAT_BEGIN);
    if (mn.repeatEnd)   stave.setEndBarType(VF.Barline.type.REPEAT_END);

    stave.setContext(ctx).draw();

    ctx.setFillStyle('#999');
    ctx.fillText('C' + (mi + 1), x + (isFirst ? CLEF_EXTRA - 8 : 4), y - 6);

    const { notes, noteReg, tupletGroups } = _buildMeasureNotes(mi, VF);
    Object.assign(noteRegistry, noteReg);
    if (!notes.length) continue;

    const voice = new VF.Voice({ num_beats: 4, beat_value: 4 });
    voice.setStrict(false);
    voice.addTickables(notes);
    new VF.Formatter().joinVoices([voice]).format([voice], noteW);
    voice.draw(ctx, stave);

    // Tuplet brackets (drawn after voice.draw)
    tupletGroups.forEach(tg => {
      try {
        new VF.Tuplet(tg.notes, { num_notes: tg.count, beats_occupied: tg.count - 1, bracketed: true })
          .setContext(ctx).draw();
      } catch (_) { /* skip malformed group */ }
    });
  }

  // Ties — drawn after all measures so cross-stave ties also work
  channels.forEach((ch, ci) => {
    (ch.notation?.ties || []).forEach(tie => {
      const fn = noteRegistry[`${ci}_${tie.from}`];
      const ln = noteRegistry[`${ci}_${tie.to}`];
      if (!fn || !ln) return;
      try {
        new VF.StaveTie({ first_note: fn, last_note: ln, first_indices: [0], last_indices: [0] })
          .setContext(ctx).draw();
      } catch (_) { /* skip */ }
    });
  });
}

function toggleStaffView() {
  staffViewActive = !staffViewActive;
  const grid  = document.querySelector('.sequencer-wrap');
  const staff = document.getElementById('staffView');
  const btn   = document.getElementById('btnStaffToggle');
  if (staffViewActive) {
    grid.style.display  = 'none';
    staff.style.display = 'block';
    btn.textContent     = '🎹 Grid';
    _buildStaffToolbar();
    document.getElementById('staffSvg').onclick = _onStaffSvgClick;
    renderStaff();
  } else {
    grid.style.display  = '';
    staff.style.display = 'none';
    btn.textContent     = '🎼 Score';
  }
}

// ---- Enlazar botones al cargar el DOM ----------------------
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btnMidi');
  if (btn) btn.onclick = openMidiImport;

  document.getElementById('btnOpenAcordes').onclick   = openAcordesModal;
  document.getElementById('btnOpenConverter').onclick = openChordConverterModal;
});
