// ============================================================
// midi-parser.js — Lectura y parseo de archivos MIDI
// Usa jasmid (stream.js + midifile.js) directamente.
// Depende de: state.js
// ============================================================

const GM_INSTRUMENTS = [
    "Acoustic Grand Piano","Bright Acoustic Piano","Electric Grand Piano","Honky-tonk Piano",
    "Electric Piano 1","Electric Piano 2","Harpsichord","Clavinet",
    "Celesta","Glockenspiel","Music Box","Vibraphone","Marimba","Xylophone","Tubular Bells","Dulcimer",
    "Drawbar Organ","Percussive Organ","Rock Organ","Church Organ","Reed Organ","Accordion","Harmonica","Tango Accordion",
    "Acoustic Guitar (nylon)","Acoustic Guitar (steel)","Electric Guitar (jazz)","Electric Guitar (clean)",
    "Electric Guitar (muted)","Overdriven Guitar","Distortion Guitar","Guitar Harmonics",
    "Acoustic Bass","Electric Bass (finger)","Electric Bass (pick)","Fretless Bass",
    "Slap Bass 1","Slap Bass 2","Synth Bass 1","Synth Bass 2",
    "Violin","Viola","Cello","Contrabass","Tremolo Strings","Pizzicato Strings","Orchestral Harp","Timpani",
    "String Ensemble 1","String Ensemble 2","Synth Strings 1","Synth Strings 2",
    "Choir Aahs","Voice Oohs","Synth Choir","Orchestra Hit",
    "Trumpet","Trombone","Tuba","Muted Trumpet","French Horn","Brass Section","Synth Brass 1","Synth Brass 2",
    "Soprano Sax","Alto Sax","Tenor Sax","Baritone Sax",
    "Oboe","English Horn","Bassoon","Clarinet",
    "Piccolo","Flute","Recorder","Pan Flute","Blown Bottle","Shakuhachi","Whistle","Ocarina",
    "Lead 1 (square)","Lead 2 (sawtooth)","Lead 3 (calliope)","Lead 4 (chiff)",
    "Lead 5 (charang)","Lead 6 (voice)","Lead 7 (fifths)","Lead 8 (bass+lead)",
    "Pad 1 (new age)","Pad 2 (warm)","Pad 3 (polysynth)","Pad 4 (choir)",
    "Pad 5 (bowed)","Pad 6 (metallic)","Pad 7 (halo)","Pad 8 (sweep)",
    "FX 1 (rain)","FX 2 (soundtrack)","FX 3 (crystal)","FX 4 (atmosphere)",
    "FX 5 (brightness)","FX 6 (goblins)","FX 7 (echoes)","FX 8 (sci-fi)",
    "Sitar","Banjo","Shamisen","Koto","Kalimba","Bagpipe","Fiddle","Shanai",
    "Tinkle Bell","Agogo","Steel Drums","Woodblock","Taiko Drum","Melodic Tom","Synth Drum","Reverse Cymbal",
    "Guitar Fret Noise","Breath Noise","Seashore","Bird Tweet","Telephone Ring","Helicopter","Applause","Gunshot"
];

/**
 * Parsea un archivo MIDI desde su representación binaria (string de bytes).
 * Actualiza las variables globales: ppqn, rawEvents, tempoMap, totalTicks,
 * instrumentNames, midiData.
 * Llama a enableInstrumentSelection() al terminar.
 * @param {string} binaryString - Resultado de FileReader.readAsArrayBuffer convertido a string
 */
function loadMIDIFile(binaryString) {
    let parsed;
    try {
        parsed = MidiFile(binaryString);  // jasmid
    } catch (e) {
        debugDiv.innerHTML = `<strong>Error al parsear MIDI:</strong> ${e}`;
        statusSpan.innerText = "Error: archivo MIDI inválido.";
        return;
    }

    // ticksPerBeat = PPQN según la nomenclatura de jasmid
    ppqn = parsed.header.ticksPerBeat || 96;
    rawEvents = [];
    tempoMap  = [{ tick: 0, bpm: 120 }];
    // Resetear compás antes de parsear (el meta-evento lo sobreescribirá si existe)
    currentTimeSig = { numerator: 4, denominator: 4, stepsPerMeasure: 16, stepsPerBeat: 4 };
    const channelInstruments = {};

    // Cada pista usa deltaTime relativo → acumulamos ticks absolutos por pista
    for (const track of parsed.tracks) {
        let absoluteTick = 0;
        for (const ev of track) {
            absoluteTick += ev.deltaTime;

            if (ev.type === 'channel') {
                const ch = ev.channel;
                if (ev.subtype === 'noteOn' && ev.velocity > 0) {
                    rawEvents.push({ tick: absoluteTick, type: 'noteOn',  channel: ch, note: ev.noteNumber, velocity: ev.velocity });
                } else if (ev.subtype === 'noteOff' || (ev.subtype === 'noteOn' && ev.velocity === 0)) {
                    rawEvents.push({ tick: absoluteTick, type: 'noteOff', channel: ch, note: ev.noteNumber, velocity: 0 });
                } else if (ev.subtype === 'programChange') {
                    channelInstruments[ch] = ev.programNumber;
                }
            } else if (ev.type === 'meta' && ev.subtype === 'setTempo') {
                tempoMap.push({ tick: absoluteTick, bpm: 60000000 / ev.microsecondsPerBeat });
            } else if (ev.type === 'meta' && ev.subtype === 'timeSignature') {
                // Guardamos el primer evento de compás encontrado
                if (currentTimeSig.numerator === 4 && currentTimeSig.denominator === 4
                    && absoluteTick === 0) {
                    // jasmid ya convierte el denominador a valor real (4, 8, 16…)
                    const num = ev.numerator;
                    const den = ev.denominator;
                    const spb = Math.round(16 / den);   // steps por tiempo
                    const spm = num * spb;               // steps por compás
                    currentTimeSig = { numerator: num, denominator: den,
                                       stepsPerMeasure: spm, stepsPerBeat: spb };
                }
            }
        }
    }

    tempoMap.sort((a, b) => a.tick - b.tick);
    totalTicks = rawEvents.length > 0 ? Math.max(...rawEvents.map(e => e.tick)) : 0;

    instrumentNames = [];
    for (let ch = 0; ch < 16; ch++) {
        const prog = channelInstruments[ch];
        instrumentNames[ch] = (prog !== undefined) ? (GM_INSTRUMENTS[prog] || `Prog ${prog}`) : `Canal ${ch + 1}`;
    }

    const channelsWithNotes = new Set();
    rawEvents.forEach(e => { if (e.type === 'noteOn') channelsWithNotes.add(e.channel); });

    const bpm0 = Math.round(tempoMap[tempoMap.length > 1 ? 1 : 0]?.bpm || 120);
    const bpmInput = document.getElementById('bpmInput');
    if (bpmInput) bpmInput.value = bpm0;
    debugDiv.innerHTML =
        `<strong>MIDI parseado</strong><br>` +
        (currentMidiFileName ? `<span style="color:#aaccff;word-break:break-all;">📄 ${currentMidiFileName}</span><br>` : '') +
        `PPQN=${ppqn} | BPM: ${bpm0} | Compás: ${currentTimeSig.numerator}/${currentTimeSig.denominator} ` +
        `(${currentTimeSig.stepsPerMeasure} pasos/compás) | ` +
        `Duración: ${totalTicks} ticks | Pistas: ${parsed.tracks.length}<br>` +
        `Canales con notas: ${Array.from(channelsWithNotes).map(c => c + 1).join(', ')}<br>` +
        `Eventos totales: ${rawEvents.length}`;

    // Actualizar etiqueta del ruler
    const rulerLabel = document.getElementById('rulerTimeSigLabel');
    if (rulerLabel) rulerLabel.textContent =
        `${currentTimeSig.numerator} / ${currentTimeSig.denominator}`;

    midiData = { ppqn, totalTicks, rawEvents, tempoMap };
    enableInstrumentSelection();
    statusSpan.innerText = "MIDI cargado. Selecciona un instrumento/canal.";
}

/**
 * Rellena el <select> de canales/instrumentos con los canales que tienen notas.
 */
function enableInstrumentSelection() {
    const channels = new Set();
    rawEvents.forEach(e => { if (e.type === 'noteOn') channels.add(e.channel); });

    instrumentSelect.innerHTML = '<option value="">-- Selecciona canal/instrumento --</option>';
    for (const ch of channels) {
        instrumentSelect.innerHTML += `<option value="${ch}">Canal ${ch + 1}: ${instrumentNames[ch]}</option>`;
    }
    instrumentSelect.disabled = false;
    loadInstrumentBtn.disabled = false;
}
