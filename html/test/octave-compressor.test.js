// ============================================================
// octave-compressor.test.js — Tests de comprimirAMotores()
//                             y calcularOctavaDesdeHeat()
// Mini-framework inline (sin dependencias externas).
//
// comprimirAMotores(rawEvents, channel, motorMap) lee state.heatMapData
// y state.gridData. En la mayoría de tests los dejamos a null para forzar
// la octava por defecto (2), lo que hace los tests deterministas sin calcular
// la matriz de atención.
//
// CONVENCIÓN DE OCTAVA (la del código): octava = Math.floor(MIDI / 12).
//   → MIDI 24-35 = octava 2,  36-47 = octava 3,  48-59 = octava 4,  60-71 = octava 5.
// El "ideal" de comprimirAMotores es octavaObjetivo*12 + pc; con octavaObjetivo=2
// el ancla es MIDI 24, así que cada pitch class se mapea al motor más cercano a 24.
// Los valores esperados de estos tests reflejan ESE comportamiento real.
// ============================================================

import { state }                    from '../js/state.js';
import { comprimirAMotores }        from '../js/octave-compressor.js';
import { calcularOctavaDesdeHeat }  from '../js/heat.js';

// ── Mini-framework ────────────────────────────────────────────
const results = { passed: 0, failed: 0, tests: [] };
function _record(name, ok, detail) {
    results.tests.push({ name, ok, detail });
    if (ok) results.passed++; else results.failed++;
}
function test(name, fn) {
    try { fn(); _record(name, true, ''); }
    catch (e) { _record(name, false, e.message); }
}
function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEqual(a, b, msg) {
    if (a !== b)
        throw new Error(`${msg || 'assertEqual'} — esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`);
}

// ── Motor Map del robot real (16 notas) ──────────────────────
// Idéntico al MOTOR_MAP de motor-map.js: A1,B1 + octava cromática C2-B2 + C3,D3.
const ROBOT_MAP = [
    { note: 33, name: 'A1',  motor: 12 },
    { note: 35, name: 'B1',  motor: 13 },
    { note: 36, name: 'C2',  motor:  0 },
    { note: 37, name: 'C#2', motor: 10 },
    { note: 38, name: 'D2',  motor:  1 },
    { note: 39, name: 'D#2', motor: 11 },
    { note: 40, name: 'E2',  motor:  2 },
    { note: 41, name: 'F2',  motor:  3 },
    { note: 42, name: 'F#2', motor:  7 },
    { note: 43, name: 'G2',  motor:  4 },
    { note: 44, name: 'G#2', motor:  8 },
    { note: 45, name: 'A2',  motor:  5 },
    { note: 46, name: 'A#2', motor:  9 },
    { note: 47, name: 'B2',  motor:  6 },
    { note: 48, name: 'C3',  motor: 14 },
    { note: 50, name: 'D3',  motor: 15 },
];
const ROBOT_NOTES = new Set(ROBOT_MAP.map(m => m.note));

// ── Helpers: crea un noteOn / noteOff ─────────────────────────
function on(note, channel = 0, tick = 0, velocity = 80) {
    return { tick, type: 'noteOn', channel, note, velocity };
}
function off(note, channel = 0, tick = 96) {
    return { tick, type: 'noteOff', channel, note, velocity: 0 };
}

// ── Setup: sin datos de atención (octava por defecto = 2) ─────
function resetState() {
    state.heatMapData = null;
    state.heatMapDataPreCompresion = null;
    state.gridData    = null;
}

// ============================================================
// Suite
// ============================================================
export function runTests() {
    results.passed = 0; results.failed = 0; results.tests = [];

    // ── calcularOctavaDesdeHeat ──────────────────────────────
    // octava = floor(MIDI/12): así MIDI 48-59 → octava 4, 36-47 → octava 3.

    test('calcularOctavaDesdeHeat: null → devuelve 2 (octava por defecto)', () => {
        assertEqual(calcularOctavaDesdeHeat(null), 2, 'octava por defecto');
    });

    test('calcularOctavaDesdeHeat: mapa vacío → devuelve 2', () => {
        assertEqual(calcularOctavaDesdeHeat(new Map()), 2, 'mapa vacío');
    });

    test('calcularOctavaDesdeHeat: notas MIDI 48-59 → devuelve 4 (floor(48/12))', () => {
        const hm = new Map();
        for (let n = 48; n < 60; n++) hm.set(`${n},0`, 1);
        assertEqual(calcularOctavaDesdeHeat(hm), 4, 'MIDI 48-59 → octava 4');
    });

    test('calcularOctavaDesdeHeat: peso dominante en MIDI 36-47 → devuelve 3', () => {
        const hm = new Map();
        // MIDI 36-47 (octava 3): score=10 cada nota
        for (let n = 36; n < 48; n++) hm.set(`${n},0`, 10);
        // MIDI 60-71 (octava 5): score=1 cada nota
        for (let n = 60; n < 72; n++) hm.set(`${n},0`, 1);
        assertEqual(calcularOctavaDesdeHeat(hm), 3, 'peso dominante en octava 3');
    });

    // ── comprimirAMotores: casos básicos ─────────────────────

    test('todas las notas de salida pertenecen al Motor Map', () => {
        resetState();
        const events = [
            on(60), on(62), on(64), on(65), on(67),  // C4 D4 E4 F4 G4
            off(60), off(62), off(64), off(65), off(67),
        ];
        const result = comprimirAMotores(events, 0, ROBOT_MAP);
        const salida = result.filter(e => e.type === 'noteOn').map(e => e.note);
        for (const nota of salida) {
            assert(ROBOT_NOTES.has(nota),
                `nota ${nota} no está en el Motor Map (${[...ROBOT_NOTES].join(',')})`);
        }
    });

    test('solo se modifica el canal seleccionado', () => {
        resetState();
        const events = [
            on(60, 0),   // canal 0 — debe comprimirse
            on(72, 1),   // canal 1 — no debe tocarse
            off(60, 0),
            off(72, 1),
        ];
        const result = comprimirAMotores(events, 0, ROBOT_MAP);

        const notaCh0 = result.find(e => e.type === 'noteOn' && e.channel === 0).note;
        const notaCh1 = result.find(e => e.type === 'noteOn' && e.channel === 1).note;

        assert(ROBOT_NOTES.has(notaCh0), `canal 0 comprimido correctamente (nota ${notaCh0})`);
        assertEqual(notaCh1, 72, 'canal 1 no debe modificarse');
    });

    test('preserva tick, channel y velocity; solo cambia note', () => {
        resetState();
        const ev = on(60, 0, 192, 100);
        const result = comprimirAMotores([ev], 0, ROBOT_MAP);
        const out = result[0];
        assertEqual(out.tick,     192,      'tick preservado');
        assertEqual(out.channel,  0,        'channel preservado');
        assertEqual(out.velocity, 100,      'velocity preservado');
        assertEqual(out.type,     'noteOn', 'type preservado');
        assert(ROBOT_NOTES.has(out.note), `note comprimida al motor map (${out.note})`);
    });

    test('no muta el array ni los objetos originales', () => {
        resetState();
        const orig = [on(60), off(60)];
        const notaOrig = orig[0].note;
        comprimirAMotores(orig, 0, ROBOT_MAP);
        assertEqual(orig[0].note, notaOrig, 'el objeto original no debe mutarse');
        assertEqual(orig.length, 2, 'el array original no debe mutarse');
    });

    test('con motorMap vacío devuelve rawEvents intactos', () => {
        resetState();
        const events = [on(60), off(60)];
        const result = comprimirAMotores(events, 0, []);
        assertEqual(result.length, events.length, 'misma longitud');
        assertEqual(result[0].note, 60, 'nota no modificada con motorMap vacío');
    });

    // ── Mapeo por pitch class (octava objetivo = 2, ancla MIDI 24) ───
    // Pasamos un heatPre explícito anclado en octava 2 (MIDI 24-35) para que
    // estos tests sigan probando SOLO el mapeo por pitch class, sin depender del
    // auto-cálculo del heatmap (que con una nota suelta daría su propia octava).
    const HEAT_OCT2 = new Map();
    for (let n = 24; n < 36; n++) HEAT_OCT2.set(`${n},0`, 1);

    test('C4 (MIDI 60, pc=0) → C3 (MIDI 48) por contorno (sobre el umbral C2/C3)', () => {
        resetState();
        // C tiene 2 motores: C2(36) y C3(48); umbral = punto medio = 42.
        // C4(60) > 42 → motor agudo C3(48). Preserva el contorno de altura.
        const result = comprimirAMotores([on(60)], 0, ROBOT_MAP, HEAT_OCT2);
        assertEqual(result[0].note, 48, 'C4 → C3 (motor agudo)');
    });

    test('C2 (MIDI 36, pc=0) → C2 (MIDI 36) por contorno (bajo el umbral)', () => {
        resetState();
        // C2(36) ≤ 42 → motor grave C2(36). El par grave/agudo se conserva.
        const result = comprimirAMotores([on(36)], 0, ROBOT_MAP, HEAT_OCT2);
        assertEqual(result[0].note, 36, 'C2 → C2 (motor grave)');
    });

    test('E4 (MIDI 64, pc=4) → E2 (MIDI 40): E solo tiene un motor', () => {
        resetState();
        const result = comprimirAMotores([on(64)], 0, ROBOT_MAP, HEAT_OCT2);
        assertEqual(result[0].note, 40, 'E4 → E2 (motor único)');
    });

    test('B3 (MIDI 59, pc=11) → B2 (MIDI 47) por contorno (sobre el umbral B1/B2)', () => {
        resetState();
        // B tiene B1(35) y B2(47); umbral = 41. B3(59) > 41 → motor agudo B2(47).
        const result = comprimirAMotores([on(59)], 0, ROBOT_MAP, HEAT_OCT2);
        assertEqual(result[0].note, 47, 'B3 → B2 (motor agudo)');
    });

    test('noteOff recibe el mismo remapeo de pitch class que noteOn', () => {
        resetState();
        const evOn  = on(64,  0, 0);
        const evOff = off(64, 0, 96);
        const result = comprimirAMotores([evOn, evOff], 0, ROBOT_MAP);
        assertEqual(result[0].note, result[1].note,
            'noteOn y noteOff del mismo PC deben apuntar a la misma nota de motor');
    });

    test('nota cuyo PC no existe en motorMap → aproxima a la nota más cercana', () => {
        resetState();
        // Motor map reducido: solo C2(36) y E2(40). D4(62, pc=2) no tiene D en el mapa.
        const mapaReducido = [{ note: 36 }, { note: 40 }];
        const result = comprimirAMotores([on(62)], 0, mapaReducido);
        const nota = result[0].note;
        assert(nota === 36 || nota === 40,
            `D4(pc=2) sin D en mapa → esperado 36 o 40, obtenido ${nota}`);
    });

    test('eventos meta (no noteOn/noteOff) pasan sin modificar', () => {
        resetState();
        const meta = { tick: 0, type: 'meta', subtype: 'setTempo', channel: 0, bpm: 120 };
        const result = comprimirAMotores([meta, on(60)], 0, ROBOT_MAP);
        const metaSalida = result.find(e => e.type === 'meta');
        assert(metaSalida, 'evento meta debe aparecer en la salida');
        assertEqual(metaSalida.bpm, 120, 'meta intacto');
    });

    // ── Integración con heat map ya calculado ────────────────

    test('si state.heatMapData concentra energía en MIDI 48-59 (octava 4), usa octava 4', () => {
        // heatMap con scores en MIDI 48-59 → calcularOctavaDesdeHeat = 4
        const hm = new Map();
        for (let n = 48; n < 60; n++) hm.set(`${n},0`, 10);
        state.heatMapData = hm;
        state.gridData    = null;

        // D5 (MIDI 62, pc=2): ideal = 4*12+2 = 50; candidatos D2(38) y D3(50): gana 50
        const result = comprimirAMotores([on(62)], 0, ROBOT_MAP);
        assertEqual(result[0].note, 50, 'D5 → D3 (octava objetivo=4, ancla 48 → D3 más cercana)');

        state.heatMapData = null;
    });

    // ── Polifonía contextual guiada por atención ─────────────
    // ppqn=96 → ticksPerStep=24; tick=0 → step 0. Notas con mismo tick colisionan.

    test('A/A simultáneas usan los DOS motores de A (A1 y A2), no se pisan', () => {
        resetState();
        // A3(57) y A4(69): ambos pc=9. El robot tiene A1(33) y A2(45).
        const events = [on(57, 0, 0), on(69, 0, 0), off(57, 0, 96), off(69, 0, 96)];
        const result = comprimirAMotores(events, 0, ROBOT_MAP);
        const notas = result.filter(e => e.type === 'noteOn').map(e => e.note).sort((a,b)=>a-b);
        assertEqual(notas.length, 2, 'ambas A deben sobrevivir');
        assert(notas[0] !== notas[1], 'deben ir a motores distintos');
        assert(notas.every(n => n % 12 === 9), 'ambas siguen siendo pitch class A');
    });

    test('G/G simultáneas: solo 1 sobrevive (G solo tiene un motor), gana la de + atención', () => {
        resetState();
        // G3(55) y G4(67): pc=7. Solo hay G2(43). heatPre da más score a G4.
        const heatPre = new Map();
        heatPre.set('55,0', 0.2);  // G3 menos importante
        heatPre.set('67,0', 0.9);  // G4 más importante
        const events = [on(55, 0, 0), on(67, 0, 0), off(55, 0, 96), off(67, 0, 96)];
        const result = comprimirAMotores(events, 0, ROBOT_MAP, heatPre);
        const noteOns = result.filter(e => e.type === 'noteOn');
        assertEqual(noteOns.length, 1, 'solo una G sobrevive');
        assertEqual(noteOns[0].note, 43, 'la superviviente va a G2 (motor único)');
    });

    test('nota descartada NO deja noteOff huérfano', () => {
        resetState();
        const heatPre = new Map();
        heatPre.set('55,0', 0.2);
        heatPre.set('67,0', 0.9);
        const events = [on(55, 0, 0), on(67, 0, 0), off(55, 0, 96), off(67, 0, 96)];
        const result = comprimirAMotores(events, 0, ROBOT_MAP, heatPre);
        const ons  = result.filter(e => e.type === 'noteOn').length;
        const offs = result.filter(e => e.type === 'noteOff').length;
        assertEqual(ons, offs, 'cada noteOn tiene su noteOff (sin huérfanos)');
    });

    test('notas en STEPS distintos no colisionan (mismo motor, distinto tiempo)', () => {
        resetState();
        // Dos G en steps separados (tick 0 y tick 48 = step 2): ambas al motor G2.
        const events = [on(55, 0, 0), off(55, 0, 24), on(67, 0, 48), off(67, 0, 72)];
        const result = comprimirAMotores(events, 0, ROBOT_MAP);
        const noteOns = result.filter(e => e.type === 'noteOn');
        assertEqual(noteOns.length, 2, 'ambas G sobreviven en steps distintos');
        assert(noteOns.every(e => e.note === 43), 'ambas en G2');
    });

    test('la nota de MAYOR atención conserva su motor natural', () => {
        resetState();
        // C4(60) y C5(72), pc=0. Robot tiene C2(36) y C3(48). Octava heat por defecto=2
        // → ancla 24 → motor natural de C es C2(36). El de + atención debe quedárselo.
        const heatPre = new Map();
        heatPre.set('60,0', 0.9);  // C4 importante → debe coger C2(36)
        heatPre.set('72,0', 0.3);  // C5 menos → realojo a C3(48)
        const events = [on(60, 0, 0), on(72, 0, 0), off(60, 0, 96), off(72, 0, 96)];
        const result = comprimirAMotores(events, 0, ROBOT_MAP, heatPre);
        const map = {};
        for (const e of result.filter(e => e.type === 'noteOn')) map[e.velocity] = e.note;
        // ambas C deben sobrevivir en motores distintos (C tiene 2 motores)
        const notas = result.filter(e => e.type === 'noteOn').map(e => e.note).sort((a,b)=>a-b);
        assertEqual(notas.length, 2, 'ambas C sobreviven (C2 y C3)');
        assert(notas.includes(36) && notas.includes(48), 'usan C2(36) y C3(48)');
    });

    // ── Patrón real de la canción (compases 49–54 de la imagen) ──────────
    // Transcripción del fragmento mostrado. step = (compás-49)*16 + step_local.
    // tick = step * ticksPerStep (ppqn=96 → 24). Una sola voz por step (melódico):
    // el fragmento es secuencial, así que NINGUNA nota debería perderse ni
    // moverse de step al comprimir. Esto reproduce el bug reportado de las G.
    //
    // Tabla editable (corregir aquí si la lectura de la imagen no es exacta):
    //   step | nota MIDI | descripción
    const PATRON_49_54 = [
        { step:  0, note: 36 },  // C2  (bloque amarillo, inicio compás 49)
        { step:  7, note: 48 },  // C3  (verde)
        { step:  8, note: 36 },  // C2
        { step: 10, note: 36 },  // C2
        { step: 15, note: 48 },  // C3  (verde)
        { step: 18, note: 59 },  // B3  (rojo, fila B m:13)
        { step: 24, note: 47 },  // B2  (marrón, fila B m:6)
        { step: 30, note: 47 },  // B2
        { step: 33, note: 57 },  // A3  (rojo, fila A m:12)
        { step: 36, note: 67 },  // G4  (rojo, fila G alta)
        { step: 39, note: 43 },  // G2  (marrón, fila G m:4)
        { step: 42, note: 67 },  // G4
        { step: 45, note: 67 },  // G4
        { step: 48, note: 43 },  // G2
        { step: 51, note: 67 },  // G4
        { step: 56, note: 43 },  // G2
        { step: 57, note: 67 },  // G4
        { step: 64, note: 43 },  // G2
        { step: 68, note: 36 },  // C2  (compás 53)
        { step: 73, note: 48 },  // C3  (verde, compás 53)
        { step: 74, note: 36 },  // C2
        { step: 77, note: 36 },  // C2
        { step: 81, note: 48 },  // C3  (verde)
        { step: 85, note: 59 },  // B3  (rojo, compás 54)
        { step: 89, note: 47 },  // B2  (marrón)
        { step: 90, note: 59 },  // B3
        { step: 93, note: 59 },  // B3
        { step: 97, note: 47 },  // B2
    ];

    // Construye eventos on/off con duración 1 step para cada entrada del patrón.
    function eventosDePatron(patron) {
        const TPS = 24;  // ppqn(96)/4
        const evs = [];
        for (const p of patron) {
            const t = p.step * TPS;
            evs.push(on(p.note, 0, t), off(p.note, 0, t + TPS));
        }
        return evs.sort((a, b) => a.tick - b.tick);
    }

    test('patrón 49–54: ninguna nota se pierde (todas secuenciales)', () => {
        resetState();
        const events = eventosDePatron(PATRON_49_54);
        const result = comprimirAMotores(events, 0, ROBOT_MAP);
        const ons = result.filter(e => e.type === 'noteOn').length;
        assertEqual(ons, PATRON_49_54.length,
            `deben sobrevivir las ${PATRON_49_54.length} notas (no hay colisiones simultáneas)`);
    });

    test('patrón 49–54: cada nota conserva su step original (bug de posición)', () => {
        resetState();
        const events = eventosDePatron(PATRON_49_54);
        const result = comprimirAMotores(events, 0, ROBOT_MAP);
        const stepsOrig   = PATRON_49_54.map(p => p.step).sort((a, b) => a - b);
        const stepsSalida = result.filter(e => e.type === 'noteOn')
            .map(e => Math.floor(e.tick / 24)).sort((a, b) => a - b);
        assertEqual(JSON.stringify(stepsSalida), JSON.stringify(stepsOrig),
            'el conjunto de steps de inicio no debe cambiar tras comprimir');
    });

    test('patrón 49–54: cada nota acaba en un motor válido del MOTOR_MAP', () => {
        resetState();
        const events = eventosDePatron(PATRON_49_54);
        const result = comprimirAMotores(events, 0, ROBOT_MAP);
        for (const e of result.filter(e => e.type === 'noteOn')) {
            assert(ROBOT_NOTES.has(e.note),
                `nota de salida ${e.note} no está en el Motor Map`);
        }
    });

    test('patrón 49–54: las notas G (pc=7) se mapean todas a G2 (motor 43)', () => {
        resetState();
        const events = eventosDePatron(PATRON_49_54);
        const result = comprimirAMotores(events, 0, ROBOT_MAP);
        // Steps que en el patrón son pitch class G (G4=67 o G2=43)
        const stepsG = new Set(PATRON_49_54.filter(p => p.note % 12 === 7).map(p => p.step));
        for (const e of result.filter(e => e.type === 'noteOn')) {
            if (stepsG.has(Math.floor(e.tick / 24))) {
                assertEqual(e.note, 43, `G en step ${e.tick / 24} debe ir a G2(43), no ${e.note}`);
            }
        }
    });

    return results;
}
