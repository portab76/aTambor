package deep;

import javax.sound.midi.*;
import java.io.*;
import java.util.*;

public class CompresorOctava {

    private static final int      MAX_NOTAS_ATENCION = 10000;
    private static final String[] PC = {"C","C#","D","D#","E","F","F#","G","G#","A","A#","B"};

    // ===== ESTRUCTURAS =====

    static class Nota {
        int tiempo, midi, duracion, velocidad, canal;
        Nota(int t, int m, int d, int v, int c) {
            tiempo=t; midi=m; duracion=d; velocidad=v; canal=c;
        }
    }

    static class ResultadoAtencion {
        final double[][] pesos;
        final List<Nota> muestra; // subconjunto uniforme usado para calcular la atencion
        ResultadoAtencion(double[][] pesos, List<Nota> muestra) {
            this.pesos = pesos; this.muestra = muestra;
        }
    }

    static class Metricas {
        String archivo;
        int bpm, resolucion, numNotas, canalesActivos, compases44;
        int notaGrave, notaAguda, rangoSemitonos, octavasUsadas, rangoDinamico;
        int octavaAtencion;
        double duracionSeg, densidad, pitchMedio;
        double durMediaMs, durMinMs, durMaxMs;
        double velMedia, pctPiano, pctForte;
        double concentracion;
        int muestraAtencion;
        String notaFrecuente = "", tonicaAtencion = "";
        String error = "";
    }

    // ===== MIDI I/O =====

    public static List<Nota> leerArchivoMidi(String ruta) throws Exception {
        List<Nota> notas = new ArrayList<>();
        Sequence sequence = MidiSystem.getSequence(new File(ruta));
        int resolution = sequence.getResolution();

        for (Track track : sequence.getTracks()) {
            for (int i = 0; i < track.size(); i++) {
                MidiEvent event = track.get(i);
                MidiMessage message = event.getMessage();
                long tick = event.getTick();

                if (message instanceof ShortMessage) {
                    ShortMessage sm = (ShortMessage) message;
                    int canal     = sm.getChannel();
                    int nota      = sm.getData1();
                    int velocidad = sm.getData2();

                    if (sm.getCommand() == ShortMessage.NOTE_ON && velocidad > 0) {
                        int duracion = buscarDuracion(track, i, nota, canal, tick, resolution);
                        notas.add(new Nota((int) tick, nota, duracion, velocidad, canal));
                    }
                }
            }
        }
        return notas;
    }

    private static int buscarDuracion(Track track, int inicio, int nota, int canal,
                                      long tickInicio, int resolution) {
        for (int j = inicio + 1; j < track.size(); j++) {
            MidiMessage message = track.get(j).getMessage();
            if (message instanceof ShortMessage) {
                ShortMessage sm = (ShortMessage) message;
                boolean esOff = sm.getCommand() == ShortMessage.NOTE_OFF
                        || (sm.getCommand() == ShortMessage.NOTE_ON && sm.getData2() == 0);
                if (esOff && sm.getData1() == nota && sm.getChannel() == canal)
                    return (int) (track.get(j).getTick() - tickInicio);
            }
        }
        return resolution;
    }

    public static int leerResolucion(String ruta) throws Exception {
        return MidiSystem.getSequence(new File(ruta)).getResolution();
    }

    public static int leerBPM(String ruta) throws Exception {
        for (Track track : MidiSystem.getSequence(new File(ruta)).getTracks()) {
            for (int i = 0; i < track.size(); i++) {
                MidiMessage msg = track.get(i).getMessage();
                if (msg instanceof MetaMessage) {
                    MetaMessage mm = (MetaMessage) msg;
                    if (mm.getType() == 0x51) {
                        byte[] d = mm.getData();
                        int micros = ((d[0] & 0xFF) << 16) | ((d[1] & 0xFF) << 8) | (d[2] & 0xFF);
                        return 60000000 / micros;
                    }
                }
            }
        }
        return 120;
    }

    public static void escribirArchivoMidi(List<Nota> notas, String ruta,
                                           int bpm, int resolucion) throws Exception {
        Sequence sequence = new Sequence(Sequence.PPQ, resolucion);
        Track track = sequence.createTrack();

        int microsegundosPorNegra = 60000000 / bpm;
        MetaMessage tempo = new MetaMessage();
        byte[] tempoData = {
            (byte)(microsegundosPorNegra >> 16),
            (byte)(microsegundosPorNegra >> 8),
            (byte) microsegundosPorNegra
        };
        tempo.setMessage(0x51, tempoData, 3);
        track.add(new MidiEvent(tempo, 0));

        for (Nota nota : notas) {
            ShortMessage on = new ShortMessage();
            on.setMessage(ShortMessage.NOTE_ON, nota.canal, nota.midi, nota.velocidad);
            track.add(new MidiEvent(on, nota.tiempo));

            ShortMessage off = new ShortMessage();
            off.setMessage(ShortMessage.NOTE_OFF, nota.canal, nota.midi, 0);
            track.add(new MidiEvent(off, nota.tiempo + nota.duracion));
        }

        MidiSystem.write(sequence, 1, new File(ruta));
        System.out.println("  Guardado: " + ruta);
    }

    // ===== MOTOR DE ATENCION =====
    // Muestreo uniforme para evitar matrices enormes en archivos con muchas notas.

    public static ResultadoAtencion calcularAtencion(List<Nota> notas) {
        List<Nota> muestra = notas;
        if (notas.size() > MAX_NOTAS_ATENCION) {
            int paso = notas.size() / MAX_NOTAS_ATENCION;
            muestra = new ArrayList<>();
            for (int i = 0; i < notas.size() && muestra.size() < MAX_NOTAS_ATENCION; i += paso)
                muestra.add(notas.get(i));
        }

        int n = muestra.size();
        int d = 4;
        double scale = Math.sqrt(d);

        int maxT = muestra.stream().mapToInt(x -> x.tiempo).max().getAsInt();
        int maxD = muestra.stream().mapToInt(x -> x.duracion).max().getAsInt();
        double[][] f = new double[n][d];
        for (int i = 0; i < n; i++) {
            Nota x = muestra.get(i);
            f[i][0] = maxT > 0 ? (double) x.tiempo   / maxT : 0;
            f[i][1] = x.midi / 127.0;
            f[i][2] = maxD > 0 ? (double) x.duracion / maxD : 0;
            f[i][3] = x.velocidad / 127.0;
        }

        double[][] pesos = new double[n][n];
        for (int i = 0; i < n; i++) {
            double max = Double.NEGATIVE_INFINITY;
            for (int j = 0; j < n; j++) {
                double s = 0;
                for (int k = 0; k < d; k++) s += f[i][k] * f[j][k];
                pesos[i][j] = s / scale;
                if (pesos[i][j] > max) max = pesos[i][j];
            }
            double sum = 0;
            for (int j = 0; j < n; j++) { pesos[i][j] = Math.exp(pesos[i][j] - max); sum += pesos[i][j]; }
            for (int j = 0; j < n; j++) pesos[i][j] /= sum;
        }

        return new ResultadoAtencion(pesos, muestra);
    }

    // ===== METRICAS =====

    static Metricas calcularMetricas(String archivo, List<Nota> notas,
                                     ResultadoAtencion ra, int bpm, int resolucion) {
        Metricas m = new Metricas();
        m.archivo = archivo;
        m.bpm = bpm;
        m.resolucion = resolucion;
        m.numNotas = notas.size();

        if (notas.isEmpty()) { m.error = "sin notas"; return m; }

        double ticksPerSeg = resolucion * bpm / 60.0;
        double msPerTick   = 1000.0 / ticksPerSeg;
        int ultimoTick = notas.stream().mapToInt(n -> n.tiempo + n.duracion).max().getAsInt();

        m.duracionSeg = ultimoTick / ticksPerSeg;
        m.densidad    = m.duracionSeg > 0 ? m.numNotas / m.duracionSeg : 0;
        m.compases44  = (int)(ultimoTick / (resolucion * 4.0));

        // Canales activos (excl. canal 9 percusion)
        Set<Integer> canales = new HashSet<>();
        for (Nota n : notas) if (n.canal != 9) canales.add(n.canal);
        m.canalesActivos = canales.size();

        // Pitch
        m.notaGrave      = notas.stream().mapToInt(n -> n.midi).min().getAsInt();
        m.notaAguda      = notas.stream().mapToInt(n -> n.midi).max().getAsInt();
        m.rangoSemitonos = m.notaAguda - m.notaGrave;
        m.pitchMedio     = notas.stream().mapToInt(n -> n.midi).average().getAsDouble();

        int[] freqPC = new int[12];
        Set<Integer> octavas = new HashSet<>();
        for (Nota n : notas) { freqPC[n.midi % 12]++; octavas.add(n.midi / 12); }
        m.octavasUsadas = octavas.size();
        int pcMax = 0;
        for (int i = 1; i < 12; i++) if (freqPC[i] > freqPC[pcMax]) pcMax = i;
        m.notaFrecuente = PC[pcMax];

        // Ritmo
        m.durMediaMs = notas.stream().mapToInt(n -> n.duracion).average().getAsDouble() * msPerTick;
        m.durMinMs   = notas.stream().mapToInt(n -> n.duracion).min().getAsInt() * msPerTick;
        m.durMaxMs   = notas.stream().mapToInt(n -> n.duracion).max().getAsInt() * msPerTick;

        // Dinamica
        m.velMedia      = notas.stream().mapToInt(n -> n.velocidad).average().getAsDouble();
        int velMin      = notas.stream().mapToInt(n -> n.velocidad).min().getAsInt();
        int velMax      = notas.stream().mapToInt(n -> n.velocidad).max().getAsInt();
        m.rangoDinamico = velMax - velMin;
        m.pctPiano      = 100.0 * notas.stream().filter(n -> n.velocidad < 40).count() / m.numNotas;
        m.pctForte      = 100.0 * notas.stream().filter(n -> n.velocidad > 90).count() / m.numNotas;

        // Atencion
        int nA = ra.pesos.length;
        m.muestraAtencion = nA;
        if (nA > 0) {
            double[] score = new double[nA];
            double sumConc = 0;
            for (int i = 0; i < nA; i++) {
                double s = 0;
                for (double v : ra.pesos[i]) s += v * v;
                score[i] = Math.sqrt(s);
                sumConc += score[i];
            }
            m.concentracion = sumConc / nA;

            // Octava objetivo: media ponderada por score sobre la muestra
            double sumScore = 0, sumOctava = 0;
            for (int i = 0; i < nA; i++) {
                sumOctava += score[i] * (ra.muestra.get(i).midi / 12);
                sumScore  += score[i];
            }
            m.octavaAtencion = sumScore > 0 ? (int) Math.round(sumOctava / sumScore) : 4;
            m.octavaAtencion = Math.max(0, Math.min(9, m.octavaAtencion));

            // Tonica: pitch class que acumula mas atencion recibida (suma de columnas por PC)
            double[] impPC = new double[12];
            for (int j = 0; j < nA; j++) {
                double recv = 0;
                for (int i = 0; i < nA; i++) recv += ra.pesos[i][j];
                impPC[ra.muestra.get(j).midi % 12] += recv;
            }
            int tonicaPC = 0;
            for (int p = 1; p < 12; p++) if (impPC[p] > impPC[tonicaPC]) tonicaPC = p;
            m.tonicaAtencion = PC[tonicaPC];
        }

        return m;
    }

    static void imprimirMetricas(Metricas m) {
        System.out.println("\n  --- METRICAS DIRECTAS ---");
        System.out.printf("  Duracion       : %.1f seg  |  Compases 4/4 est.: %d%n",
            m.duracionSeg, m.compases44);
        System.out.printf("  Notas totales  : %d  |  Densidad: %.2f notas/seg%n",
            m.numNotas, m.densidad);
        System.out.printf("  Canales activos: %d  (excl. ch9 percusion)%n",
            m.canalesActivos);
        System.out.printf("  Nota grave     : %d (%s%d)  |  Nota aguda: %d (%s%d)%n",
            m.notaGrave, PC[m.notaGrave % 12], m.notaGrave / 12,
            m.notaAguda,  PC[m.notaAguda  % 12], m.notaAguda  / 12);
        System.out.printf("  Rango          : %d semitonos  |  Pitch medio: %.1f  |  Octavas: %d%n",
            m.rangoSemitonos, m.pitchMedio, m.octavasUsadas);
        System.out.printf("  Nota frecuente : %s%n", m.notaFrecuente);
        System.out.printf("  Duracion nota  : media %.0f ms  |  min %.0f ms  |  max %.0f ms%n",
            m.durMediaMs, m.durMinMs, m.durMaxMs);
        System.out.printf("  Velocidad media: %.1f  |  Rango dinamico: %d%n",
            m.velMedia, m.rangoDinamico);
        System.out.printf("  Piano (<40)    : %.1f%%  |  Forte (>90): %.1f%%%n",
            m.pctPiano, m.pctForte);

        System.out.println("\n  --- METRICAS DE ATENCION ---");
        System.out.printf("  Muestra        : %d notas (de %d totales)%n",
            m.muestraAtencion, m.numNotas);
        System.out.printf("  Concentracion  : %.5f%n", m.concentracion);
        System.out.printf("  Tonica atencion: %s%n", m.tonicaAtencion);
        System.out.printf("  Octava atencion: %d  (MIDI %d-%d)  <- destino de la compresion%n",
            m.octavaAtencion, m.octavaAtencion * 12, m.octavaAtencion * 12 + 11);
    }

    // ===== COMPRESION A UNA OCTAVA =====
    // La octava objetivo se calcula sobre la muestra de la atencion.
    // La compresion se aplica a TODAS las notas del archivo original.

    public static List<Nota> comprimirAUnaOctava(ResultadoAtencion ra, List<Nota> notas) {
        int nA = ra.pesos.length;

        // Score por nota de la muestra: norma L2 de su fila de pesos
        double[] score = new double[nA];
        for (int i = 0; i < nA; i++) {
            double suma = 0;
            for (double v : ra.pesos[i]) suma += v * v;
            score[i] = Math.sqrt(suma);
        }

        // Octava objetivo: media ponderada por score
        double sumScore = 0, sumOctava = 0;
        for (int i = 0; i < nA; i++) {
            sumOctava += score[i] * (ra.muestra.get(i).midi / 12);
            sumScore  += score[i];
        }
        int octavaObjetivo = sumScore > 0 ? (int) Math.round(sumOctava / sumScore) : 4;
        octavaObjetivo = Math.max(0, Math.min(9, octavaObjetivo));

        // Informe de distribucion original sobre todas las notas
        int n = notas.size();
        int[] contPorOctava = new int[11];
        for (Nota nota : notas) {
            int o = nota.midi / 12;
            if (o < contPorOctava.length) contPorOctava[o]++;
        }

        System.out.println("\nCOMPRESION A UNA OCTAVA:");
        System.out.printf("  Octava objetivo (media ponderada por atencion): %d  (MIDI %d-%d)%n",
            octavaObjetivo, octavaObjetivo * 12, octavaObjetivo * 12 + 11);
        System.out.println("  Distribucion original:");
        for (int o = 0; o < 11; o++) {
            if (contPorOctava[o] == 0) continue;
            int barras = (int)(contPorOctava[o] / (double) n * 30);
            StringBuilder barra = new StringBuilder();
            for (int b = 0; b < barras; b++) barra.append('=');
            System.out.printf("    Octava %d  |%-30s| %d notas%s%n",
                o, barra, contPorOctava[o], o == octavaObjetivo ? "  <- objetivo" : "");
        }

        // Conservar pitch class (midi % 12), mover a octava objetivo
        List<Nota> resultado = new ArrayList<>();
        for (Nota orig : notas) {
            int nuevoMidi = Math.max(0, Math.min(127, octavaObjetivo * 12 + (orig.midi % 12)));
            resultado.add(new Nota(orig.tiempo, nuevoMidi, orig.duracion, orig.velocidad, orig.canal));
        }

        System.out.printf("  Resultado: %d notas dentro de MIDI %d-%d%n",
            resultado.size(), octavaObjetivo * 12, octavaObjetivo * 12 + 11);
        return resultado;
    }

    // ===== CSV =====

    static final String[] CABECERAS = {
        "archivo","bpm","resolucion","duracion_seg","num_notas","densidad_nps",
        "canales_activos","compases_44","nota_grave","nota_aguda","rango_semitonos",
        "pitch_medio","nota_frecuente","octavas_usadas","dur_media_ms","dur_min_ms",
        "dur_max_ms","vel_media","rango_dinamico","pct_piano","pct_forte",
        "concentracion_atencion","tonica_atencion","octava_atencion","muestra_atencion","error"
    };

    static String toCSV(Metricas m) {
        if (!m.error.isEmpty() && m.numNotas == 0)
            return String.format("\"%s\",,,,,,,,,,,,,,,,,,,,,,,,,\"%s\"", m.archivo, m.error);
        return String.format(Locale.US,
            "\"%s\",%d,%d,%.1f,%d,%.2f,%d,%d,%d,%d,%d,%.1f,%s,%d,%.0f,%.0f,%.0f,%.1f,%d,%.1f,%.1f,%.5f,%s,%d,%d,\"%s\"",
            m.archivo, m.bpm, m.resolucion, m.duracionSeg, m.numNotas, m.densidad,
            m.canalesActivos, m.compases44, m.notaGrave, m.notaAguda, m.rangoSemitonos,
            m.pitchMedio, m.notaFrecuente, m.octavasUsadas,
            m.durMediaMs, m.durMinMs, m.durMaxMs,
            m.velMedia, m.rangoDinamico, m.pctPiano, m.pctForte,
            m.concentracion, m.tonicaAtencion,
            m.octavaAtencion, m.muestraAtencion, m.error);
    }

    static void escribirCSV(List<Metricas> lista, File dir) {
        File csvFile = new File(dir, "CompresorOctava.csv");
        try (PrintWriter pw = new PrintWriter(new FileWriter(csvFile))) {
            pw.println(String.join(",", CABECERAS));
            for (Metricas m : lista) pw.println(toCSV(m));
            System.out.println("CSV guardado    : " + csvFile.getAbsolutePath());
        } catch (IOException e) {
            System.err.println("Error escribiendo CSV: " + e.getMessage());
        }
    }

    // ===== AYUDA =====

    static final String AYUDA =
        "GUIA DE INTERPRETACION - COMPRESOR DE OCTAVA\n" +
        "=============================================\n" +
        "Generado por CompresorOctava.java\n" +
        "Cada fila = un archivo MIDI procesado. Separador decimal: punto (.).\n" +
        "Abre con Excel o LibreOffice Calc usando codificacion UTF-8.\n\n" +

        "COLUMNA               ORIGEN                          COMO INTERPRETARLO\n" +
        "--------------------------------------------------------------------------------\n\n" +

        "archivo               Nombre del fichero              Identificador del archivo procesado.\n\n" +

        "--- METRICAS DIRECTAS ---\n\n" +

        "bpm                   MetaMessage tipo 0x51           Pulsos por minuto (tempo).\n" +
        "                      Si no existe -> 120 por defecto <60=lento (balada) | 60-100=moderado | >120=rapido\n\n" +

        "resolucion            Sequence.getResolution()        Ticks por negra. Precision de cuantizacion.\n" +
        "                                                      96, 120, 192, 480 son valores tipicos.\n" +
        "                                                      No afecta al sonido, si a la precision ritmica.\n\n" +

        "duracion_seg          ultimo_tick / (res * bpm / 60)  Duracion total de la pieza en segundos.\n\n" +

        "num_notas             Eventos NOTE_ON con vel > 0     Total de notas en todas las pistas.\n" +
        "                                                      Incluye percusion (canal 9).\n\n" +

        "densidad_nps          num_notas / duracion_seg        Notas por segundo. Actividad musical.\n" +
        "                                                      <2=espaciado | 2-10=normal | >10=muy denso\n\n" +

        "canales_activos       distinct(canal) excl. ch9       Pistas melodicas independientes.\n" +
        "                      Canal 9 = percusion MIDI        1=monofonia | 2-4=arreglo | >4=orquestal\n\n" +

        "compases_44           ultimo_tick / (res * 4)         Compases estimados asumiendo 4/4.\n" +
        "                                                      Aproximado: invalido para 3/4 o 6/8.\n\n" +

        "nota_grave            min(midi)                       Nota MIDI mas baja presente.\n" +
        "nota_aguda            max(midi)                       Nota MIDI mas alta presente.\n" +
        "                                                      Referencia: 60=C4 (Do central), 69=A4 (La 440Hz)\n\n" +

        "rango_semitonos       nota_aguda - nota_grave         Amplitud melodica total en semitonos.\n" +
        "                                                      <12=una octava | 12-24=dos octavas | >24=amplio\n\n" +

        "pitch_medio           avg(midi)                       Centro de gravedad tonal de la pieza.\n" +
        "                                                      <55=grave | 55-65=medio | >65=agudo\n\n" +

        "nota_frecuente        mode(midi % 12)                 Pitch class con mas apariciones.\n" +
        "                                                      Suele coincidir con la tonica de la pieza.\n" +
        "                                                      C C# D D# E F F# G G# A A# B\n\n" +

        "octavas_usadas        distinct(midi / 12)             Numero de octavas distintas con notas.\n" +
        "                                                      1-2=rango estrecho | 4+=rango amplio\n\n" +

        "dur_media_ms          avg(duracion_ticks) * ms/tick   Duracion media de nota en milisegundos.\n" +
        "                                                      <100ms=staccato/rapido | 100-500ms=normal\n" +
        "                                                      >500ms=legato/lento\n\n" +

        "dur_min_ms            min(duracion_ticks) * ms/tick   Nota mas corta: ornamentos, grace notes.\n\n" +

        "dur_max_ms            max(duracion_ticks) * ms/tick   Nota mas larga: pedal, ligaduras.\n\n" +

        "vel_media             avg(velocidad 0-127)            Intensidad media de todas las notas.\n" +
        "                                                      <40=piano | 40-80=mezzo | >80=forte\n\n" +

        "rango_dinamico        max_vel - min_vel               Variacion dinamica de la pieza.\n" +
        "                                                      <20=plana (electronica) | >60=expresiva (humana)\n\n" +

        "pct_piano             (vel<40 / total) * 100          Porcentaje de notas suaves.\n" +
        "                                                      Alto=pieza delicada, clasica o ambiental.\n\n" +

        "pct_forte             (vel>90 / total) * 100          Porcentaje de notas fuertes.\n" +
        "                                                      Alto=pieza energica, rock, percusiva.\n\n" +

        "--- METRICAS DE ATENCION (muestra uniforme de hasta " + MAX_NOTAS_ATENCION + " notas) ---\n\n" +

        "concentracion_atencion  avg( norma_L2(fila_i) )       Cuanto se concentra la atencion en pocas notas.\n" +
        "                        de la matriz de pesos          La norma L2 de una fila mide cuanto atiende\n" +
        "                                                      esa nota selectivamente (vs. uniformemente).\n" +
        "                                                      >0.05=estructura clara o repetitiva\n" +
        "                                                      <0.02=alta complejidad armonica\n\n" +

        "tonica_atencion         argmax( sum_columnas_PC )      Pitch class que recibe mas atencion del resto.\n" +
        "                        sobre la matriz de pesos        Cada columna j indica cuanto 'atienden' las\n" +
        "                                                      demas notas a la nota j. Agrupando por pitch\n" +
        "                                                      class se obtiene el centro armonico segun\n" +
        "                                                      el modelo. Si coincide con nota_frecuente,\n" +
        "                                                      la tonica esta bien identificada.\n\n" +

        "octava_atencion         round( sum(score_i * oct_i) /  Octava elegida como destino de la compresion.\n" +
        "                               sum(score_i) )          score_i = norma_L2(fila_i de pesos).\n" +
        "                                                      Las notas con mayor score (las que atienden\n" +
        "                                                      selectivamente a pocas notas clave) son las\n" +
        "                                                      que deciden la octava final.\n" +
        "                                                      Rango MIDI: octava*12 ... octava*12+11\n\n" +

        "muestra_atencion        min(num_notas, " + MAX_NOTAS_ATENCION + ")          Notas usadas para calcular la atencion.\n" +
        "                                                      Si < num_notas se aplico muestreo uniforme\n" +
        "                                                      para limitar memoria y tiempo de computo.\n\n" +

        "error                   Excepcion Java                 Vacio si el archivo se proceso correctamente.\n" +
        "                                                      Si hay error el resto de columnas estan vacias.\n";

    static void escribirAyuda(File dir) {
        File ayudaFile = new File(dir, "compresor_ayuda.txt");
        try (PrintWriter pw = new PrintWriter(new FileWriter(ayudaFile))) {
            pw.print(AYUDA);
            System.out.println("Ayuda guardada  : " + ayudaFile.getAbsolutePath());
        } catch (IOException e) {
            System.err.println("Error escribiendo ayuda: " + e.getMessage());
        }
    }

    // ===== MAIN =====

    public static void main(String[] args) {
        String ruta = args.length > 0 ? args[0] : "C:\\midi\\test";

        System.out.println("=== COMPRESOR DE OCTAVA ===");
        System.out.println("Ruta recibida: " + ruta);

        File entrada = new File(ruta);
        if (!entrada.exists()) {
            System.out.println("ERROR: la ruta no existe -> " + entrada.getAbsolutePath());
            System.out.println("Uso: java deep.CompresorOctava <directorio|archivo.mid>");
            return;
        }

        List<Metricas> todasMetricas = new ArrayList<>();
        File dirSalida;

        if (entrada.isDirectory()) {
            File[] midis = entrada.listFiles(
                f -> f.isFile() && f.getName().toLowerCase().endsWith(".mid"));
            if (midis == null || midis.length == 0) {
                System.out.println("No se encontraron archivos .mid en: " + ruta);
                return;
            }
            Arrays.sort(midis);
            dirSalida = entrada;
            System.out.printf("Directorio: %s  (%d archivos .mid)%n", ruta, midis.length);
            System.out.printf("CSV destino: %s%n%n", new File(dirSalida, "CompresorOctava.csv").getAbsolutePath());

            int ok = 0, errores = 0;
            for (int idx = 0; idx < midis.length; idx++) {
                System.out.printf("[%3d/%3d] %s%n", idx + 1, midis.length, midis[idx].getName());
                try {
                    todasMetricas.add(procesarArchivo(midis[idx]));
                    ok++;
                } catch (Exception e) {
                    System.err.printf("  [ERROR] %s: %s%n", midis[idx].getName(), e.getMessage());
                    Metricas m = new Metricas();
                    m.archivo = midis[idx].getName();
                    m.error   = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                    todasMetricas.add(m);
                    errores++;
                }
            }
            System.out.printf("%nResumen: %d procesados, %d errores%n%n", ok, errores);

        } else {
            dirSalida = entrada.getParentFile();
            if (dirSalida == null || !dirSalida.exists())
                dirSalida = new File(System.getProperty("user.dir"));
            System.out.printf("CSV destino: %s%n%n", new File(dirSalida, "CompresorOctava.csv").getAbsolutePath());
            try {
                todasMetricas.add(procesarArchivo(entrada));
            } catch (Exception e) {
                System.err.println("Error: " + e.getMessage());
                e.printStackTrace();
                Metricas m = new Metricas();
                m.archivo = entrada.getName();
                m.error   = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                todasMetricas.add(m);
            }
        }

        escribirCSV(todasMetricas, dirSalida);
        escribirAyuda(dirSalida);
    }

    private static Metricas procesarArchivo(File inputFile) throws Exception {
        int bpm        = leerBPM(inputFile.getPath());
        int resolucion = leerResolucion(inputFile.getPath());
        System.out.printf("  BPM: %d  |  Resolucion: %d ticks/negra%n", bpm, resolucion);

        List<Nota> notas = leerArchivoMidi(inputFile.getPath());
        System.out.printf("  Notas cargadas: %d%n", notas.size());

        ResultadoAtencion ra = calcularAtencion(notas);

        Metricas m = calcularMetricas(inputFile.getName(), notas, ra, bpm, resolucion);
        imprimirMetricas(m);

        String nombre = inputFile.getName();
        String nombreSinExt = nombre.toLowerCase().endsWith(".mid")
            ? nombre.substring(0, nombre.length() - 4) : nombre;
        String rutaSalida = new File(inputFile.getParent(), nombreSinExt + "_1oct.mid").getPath();

        List<Nota> comprimidas = comprimirAUnaOctava(ra, notas);
        escribirArchivoMidi(comprimidas, rutaSalida, bpm, resolucion);
        System.out.println();

        return m;
    }
}
