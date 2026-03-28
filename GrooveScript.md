# MML-R — Music Macro Language for Robots
### Technical Reference Manual v2.0

---

## Overview

MML-R (Music Macro Language – Robot) is a compact textual language designed to represent music in a simple, readable, and programmable way. It allows encoding melodies, rhythms, harmonies, dynamics, and timing without using traditional sheet music.

It is suitable for:
- Embedded systems (ESP32, Arduino)
- MIDI-like playback engines
- Algorithmic composition
- Quick musical prototyping
- Robot piano / servo motor control

---

## Is this a standard language?

MML-R is **inspired by existing systems** such as:
- MIDI (event-based music representation)
- Classic MML (used in early computers and game consoles)
- Tracker/sequencer notation

However, **this specific design is custom** and optimized for:
- Simplicity — writable by non-musicians
- Human readability — looks like music, not code
- Direct execution in microcontrollers and grid-based sequencers

---

## Core Concepts

### 1. Note (Pitch)

```
[A-G][#|b][octave]
```

| Part | Description | Examples |
|------|-------------|---------|
| Letter | Note name A through G | `C`, `E`, `G` |
| Accidental | `#` (sharp) or `b` (flat), optional | `F#`, `Bb`, `C#` |
| Octave | Integer 0–8, optional | `C4`, `F#2`, `Bb3` |

Notes without octave are treated as pitch class only (no octave distinction).
Enharmonic equivalents are accepted: `C#` = `Db`, `F#` = `Gb`, etc.

**Valid examples:**
```
C4    F#2    Bb3    G    E    C#    Ab5
```

---

### 2. Duration

Duration can be expressed in two formats:

#### Format A — Milliseconds
```
NOTE:ms
C4:120      → C4 lasting 120 ms
R:500       → silence of 500 ms
```

#### Format B — Musical Values (fractions of a whole note)
```
NOTE:1      → whole note     (1 compás completo = 16 steps)
NOTE:1/2    → half note      (blanca  = 8 steps)
NOTE:1/4    → quarter note   (negra   = 4 steps)
NOTE:1/8    → eighth note    (corchea = 2 steps)
NOTE:1/16   → sixteenth note (semicorchea = 1 step)
```

Both formats can be mixed in the same sequence.
When no duration is specified, `@DEFAULT_DUR` is used.

**Conversion from ms to grid steps:**
```
ms_per_step = (60000 / BPM) / 4
steps = round(duration_ms / ms_per_step)
```

Example at BPM=120: `1 step = 125 ms`

---

### 3. Velocity (Intensity)

- Range: `0–127`
- Optional third field after duration
- Default: `@DEFAULT_VEL` (100 if not set)

```
C4:120:110     → C4, 120ms, velocity 110
C4:1/4:80      → C4, quarter note, velocity 80
C4:1/4         → C4, quarter note, default velocity
```

---

### 4. Rest (Silence)

```
R:DURATION
```

Examples:
```
R:120          → silence of 120 ms
R:1/4          → quarter rest
R:1/8          → eighth rest
```

---

### 5. Chords (Simultaneous Notes)

Multiple notes played at the same time, grouped with parentheses:

```
(NOTE NOTE NOTE):DURATION:VELOCITY
```

The duration and velocity apply to all notes in the group.

**Examples:**
```
(E4 G4 B4):1/4        → E minor chord, quarter note
(C4 E4 G4):1/2:90     → C major chord, half note, vel 90
(F#3 A3 C#4):1/4      → F# minor chord, quarter note
```

**Named chord shorthand** (suffix notation):
```
Em:1/4        → E minor triad (E + G + B)
Cmaj:1/4      → C major triad (C + E + G)
G7:1/4        → G dominant 7th (G + B + D + F)
Am:1/4        → A minor (A + C + E)
```

Supported chord suffixes:

| Suffix | Type | Intervals |
|--------|------|-----------|
| (none) | Single note | root only |
| `maj` | Major triad | 0, 4, 7 |
| `m` or `min` | Minor triad | 0, 3, 7 |
| `7` | Dominant 7th | 0, 4, 7, 10 |
| `maj7` | Major 7th | 0, 4, 7, 11 |
| `m7` or `min7` | Minor 7th | 0, 3, 7, 10 |
| `sus2` | Suspended 2nd | 0, 2, 7 |
| `sus4` | Suspended 4th | 0, 5, 7 |
| `dim` | Diminished | 0, 3, 6 |
| `aug` or `+` | Augmented | 0, 4, 8 |

> **Key rule:** A bare note name (`G`, `E`, `C#`) is always a **single note**.
> A chord suffix must be explicit (`Gmaj`, `Em`, `G7`).

---

## Full Syntax

```
EVENT EVENT EVENT ...
```

Each event is one of:
```
NOTE                        → single note, default duration and velocity
NOTE:DUR                    → note with duration
NOTE:DUR:VEL                → note with duration and velocity
NOTE:DUR:VEL[articulation]  → note with articulation
(N1 N2 N3):DUR:VEL          → chord
CHORD_NAME:DUR:VEL          → named chord
R:DUR                       → rest
[ EVENTS ]xN                → repeated block
```

Events are separated by spaces or newlines.
Newlines are ignored — the entire script is one linear sequence.

---

## Global Parameters

Declared at the beginning of the script with `@KEY=VALUE` syntax.
Parameters apply to the entire sequence unless overridden inline.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `@TEMPO=120` | 120 | BPM (beats per minute) |
| `@DEFAULT_VEL=100` | 100 | Default velocity (0–127) |
| `@DEFAULT_DUR=1/4` | 1/4 | Default duration when omitted |
| `@OCT=4` | 4 | Default octave when omitted |
| `@SWING=0` | 0 | Swing amount (0–100). Delays even 16th notes |
| `@HUMAN=0` | 0 | Humanization: random ±variation in timing and velocity |
| `@HARMONIZE=C:Mayor` | off | Auto-harmonize single notes using diatonic chords |

### @HARMONIZE

When set, single notes are automatically converted to their diatonic chord within the specified key and scale:

```
@HARMONIZE=C:Mayor
E:1/4    → Em chord  (E is the 3rd degree of C Major → iii = Em)
F:1/4    → F chord   (4th degree → IV = F major)
G:1/4    → G chord   (5th degree → V = G major)
```

Format: `@HARMONIZE=KEY:SCALE`

Supported scales: `Mayor`, `Menor Natural`, `Menor Armónica`, `Menor Melódica`,
`Dórica`, `Frigia`, `Lidia`, `Mixolidia`, `Pentatónica Mayor`, `Pentatónica Menor`, `Blues`

If a note is **chromatic** (not in the scale), it remains as a single note.

---

## Articulation

Applied as a suffix directly after the velocity (or duration if no velocity):

| Symbol | Name | Effect |
|--------|------|--------|
| `.` | Staccato | Note shortened to ~50% of its duration |
| `-` | Legato | Note extended to 100% (no gap) |
| `>` | Accent | Velocity +20 (max 127) |
| `<` | Soft | Velocity −20 (min 1) |

```
C4:100:110.     → C4, staccato
D4:120:100-     → D4, legato
E4:80:90>       → E4, accented
F4:100:70<      → F4, soft
```

Multiple articulations can be combined:
```
G4:100:100>.    → accented staccato
```

---

## Ties (Ligatures)

Join two consecutive notes of the same pitch without re-triggering the attack.
The total duration is the sum of both.

```
C4:1/4~C4:1/4     → C4 lasting a half note (no re-attack)
```

> In robot/servo systems, ties are approximated by not sending a new hit command.

---

## Repetition Blocks

Repeat a block of events N times:

```
[ EVENTS ]xN
```

Examples:
```
[ C4:1/8 R:1/8 ]x4                     → 4 repetitions
[ F#2:120:110 R:40 F#2:70:80 ]x2       → 2 repetitions
[ (E4 G4 B4):1/4 R:1/4 ]x8            → chord repeated 8 times
```

Blocks can be **nested**:
```
[ [ C4:1/16 D4:1/16 ]x2 R:1/8 ]x4
```

---

## Octave Control (Inline)

Raise or lower the default octave for subsequent notes:

```
O+    → increase default octave by 1
O-    → decrease default octave by 1
```

```
C:1/4 D:1/4 O+ C:1/4 D:1/4    → second C and D one octave higher
```

---

## Measure Separator

Optional visual aid — the `|` character separates measures.
It is **ignored by the parser** but helps human readability.

```
C4:1/4 D4:1/4 E4:1/4 F4:1/4 | G4:1/4 F4:1/4 E4:1/4 D4:1/4 | C4:1/2 R:1/2
```

---

## Humanization

```
@HUMAN=10
```

Adds slight random variations to make the sequence feel less mechanical:
- Timing: ±N milliseconds per note
- Velocity: ±N per note

> In grid-based sequencers, humanization is limited by step resolution.
> Values below the grid step size (e.g., <125ms at BPM=120) are ignored.

---

## Swing

```
@SWING=60
```

Delays every even 16th note by a percentage of the step duration.
- `@SWING=0` → straight (no swing)
- `@SWING=50` → triplet swing (jazz feel)
- `@SWING=100` → maximum delay

> Grid-based sequencers may not support sub-step swing. This parameter is parsed
> but may be ignored depending on the target engine.

---

## Complete Examples

### Example 1 — Simple melody (Ode to Joy, C Major)

```
@TEMPO=120
@DEFAULT_DUR=1/4

E E F G G F E D C C D E E:1/2 D:1/2
E E F G G F E D C C D E D:1/2 C:1/2
```

### Example 2 — Melody with auto-harmonization

```
@TEMPO=120
@DEFAULT_DUR=1/4
@HARMONIZE=C:Mayor

E E F G G F E D C C D E E:1/2 D:1/2
```
Each note becomes its diatonic chord in C Major:
`E → Em`, `F → F`, `G → G`, `D → Dm`, `C → C`

### Example 3 — Groove pattern with chords and rests

```
@TEMPO=100
@SWING=50

[ (E4 G4 B4):1/8 R:1/8 (C4 E4 G4):1/8 R:1/8 ]x4
```

### Example 4 — Funk rhythm with accents and staccato

```
@TEMPO=120
@DEFAULT_VEL=90

F#2:120:110. R:40 F#2:70:80 F#3:70:85> R:40
[ F#2:1/16. R:1/16 F#2:1/16 R:1/8 ]x4
```

### Example 5 — Repetition with octave shift

```
@TEMPO=140
@DEFAULT_DUR=1/8

[ C D E F ]x2 O+ [ C D E F ]x2 O- [ C:1/4 G:1/4 C:1/2 ]
```

### Example 6 — Full song structure with measure separators

```
@TEMPO=120
@DEFAULT_DUR=1/4
@HARMONIZE=G:Mayor

G G A G E | G G A G D | G G G5 E C B A | F F E C D:1/2 C:1/2
```

---

## Implementation Notes for aTambor

### Grid mapping

aTambor uses a 12-row grid (one row per semitone: C, C#, D, D#, E, F, F#, G, G#, A, A#, B).
There is **no octave dimension** — all octaves map to the same 12 rows.

| MML-R concept | aTambor mapping |
|---------------|----------------|
| Note pitch | Semitone row (0–11), octave ignored |
| Duration (ms) | Converted to steps: `steps = round(ms / ms_per_step)` |
| Duration (musical) | Direct: `1/16=1 step`, `1/8=2`, `1/4=4`, `1/2=8`, `1=16` |
| Velocity | Step value (0–127) |
| Rest | Steps filled with 0 |
| Chord | Multiple rows activated at the same step |
| Repetition | Block expanded before writing to grid |
| @TEMPO | Updates global BPM |
| @HARMONIZE | Uses CHORD_SCALES diatonic lookup |
| @SWING | Not supported (sub-step resolution required) |
| @HUMAN | Not supported (sub-step resolution required) |
| Ties `~` | Second hit suppressed (approximated) |

### Step value convention

The value stored in a grid step encodes duration:

| Value | Duration | Musical name |
|-------|----------|--------------|
| 1 | 1 step | Semicorchea (1/16) |
| 2 | 2 steps | Corchea (1/8) |
| 4 | 4 steps | Negra (1/4) |
| 8 | 8 steps | Blanca (1/2) |
| 16 | 16 steps | Redonda (1/1) |

The value is placed at the **first step** of the note slot. All remaining steps of the slot are 0.

---

## Philosophy

MML-R is designed to:
- Be **faster to write** than sheet music
- Be **clearer** than raw MIDI hex data
- **Preserve musical groove** and expression
- Work for **non-musicians** who just want to encode a melody quickly
- Scale from **simple melodies** to **harmonized arrangements**

---

## Usage

This language can be parsed to:
- MIDI messages
- Servo motor control commands (robot piano / aTambor)
- Audio synthesis engines
- Grid-based step sequencer patterns

---

## License

Free to use and modify.
