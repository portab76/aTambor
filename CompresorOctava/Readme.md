# 🎵 Compresor de Octava por Atención

CompresorOctava es una herramienta Java que **reduce la complejidad tonal** de una canción MIDI compactándola en **una sola octava**. La octava no se elige al azar: el algoritmo de **atención** analiza la estructura musical del tema y decide cuál es la octava más significativa, conservando la esencia melódica y armónica.

## 📋 Tabla de contenidos
- [Filosofía del programa](#-filosofía-del-programa)
- [¿Qué hace?](#-qué-hace)
- [El papel clave de la atención](#-el-papel-clave-de-la-atención)
- [Formato de entrada y salida](#-formato-de-entrada-y-salida)
- [¿Cómo funciona internamente?](#-cómo-funciona-internamente)
  - [1. Extracción de eventos MIDI](#1-extracción-de-eventos-midi)
  - [2. Muestreo controlado](#2-muestreo-controlado)
  - [3. Vectorización de cada nota](#3-vectorización-de-cada-nota)
  - [4. Cálculo de la matriz de atención](#4-cálculo-de-la-matriz-de-atención)
  - [5. Score de selectividad](#5-score-de-selectividad)
  - [6. Selección de la octava destino](#6-selección-de-la-octava-destino)
  - [7. Tónica por atención](#7-tónica-por-atención)
  - [8. Compresión a una octava](#8-compresión-a-una-octava)
- [Métricas de salida](#-métricas-de-salida)
- [Cómo usar el programa](#-cómo-usar-el-programa)
- [Limitaciones conocidas](#-limitaciones-conocidas)
- [Posibles mejoras](#-posibles-mejoras)
- [Interpretación de concentracion_atencion](#-interpretación-de-concentracion_atencion)
- [Licencia](#-licencia)

## 💡 Filosofía del programa

La mayoría de las canciones tienen una "altura típica": las notas más importantes suelen moverse alrededor de una octava concreta. **CompresorOctava detecta esa octava mediante atención y transpone toda la canción a ese rango**.

El resultado suena armónicamente igual (porque se conservan los semitonos relativos), pero en una tesitura más compacta.

## 🔧 ¿Qué hace?

| Etapa | Resultado |
|-------|-----------|
| **Análisis** | Calcula una matriz de atención entre una **muestra** de notas |
| **Decisión** | Elige la octava que concentra la "energía atencional" |
| **Transformación** | Transpone **todas** las notas originales a esa única octava |
| **Salida** | Guarda un nuevo archivo MIDI `_1oct.mid` con la misma duración y número de notas |

## 🔑 El papel clave de la atención

La **atención** se usa en IA para medir cuánto se "fija" un elemento en otro. Aquí:

> Una nota **atiende** a otra si sus características (tiempo, altura, duración, intensidad) son similares.

A partir de la matriz de atención calculamos:
- **Score de cada nota** — cuánto se concentra su atención
- **Octava destino** — media ponderada de octavas por score
- **Tónica atencional** — pitch class que más atención recibe

## 📂 Formato de entrada y salida

- **Entrada**: archivo MIDI (`.mid`)
- **Salida**: `nombre_1oct.mid` (mismo directorio)
- **CSV**: `CompresorOctava.csv` — una fila por archivo
- **Ayuda**: `compresor_ayuda.txt` — explicación columna por columna

## ⚙️ ¿Cómo funciona internamente?

### 1. 🎹 Extracción de eventos MIDI
Lee pistas y eventos, detecta `NOTE_ON` con velocidad > 0 y busca su `NOTE_OFF` para obtener la duración real.

### 2. 📊 Muestreo controlado
Para evitar matrices enormes, si hay más de **MAX_NOTAS_ATENCION** se toma una muestra uniforme:

```java
int paso = notas.size() / MAX_NOTAS_ATENCION;
for (int i = 0; i < notas.size() && muestra.size() < MAX_NOTAS_ATENCION; i += paso)
    muestra.add(notas.get(i));
```

- Máximo MAX_NOTAS_ATENCION notas en la muestra
- Cobertura homogénea de toda la canción
- La compresión posterior se aplica a todas las notas originales

### 3. 📐 Vectorización de cada nota
Cada nota → vector de 4 dimensiones normalizadas:

| Componente | Normalización | Significado |
|-----------|---------------|-------------|
| t | tiempo / max_tiempo | Momento relativo |
| p | midi / 127.0 | Altura |
| d | duracion / max_duracion | Duración relativa |
| v | velocidad / 127.0 | Intensidad |

### 4. 🧮 Cálculo de la matriz de atención
Producto punto escalado:

```text
scores[i][j] = (t_i·t_j + p_i·p_j + d_i·d_j + v_i·v_j) / √4
```

Softmax por fila:

```text
pesos[i][j] = exp(scores[i][j] - max_i) / Σ_k exp(scores[i][k] - max_i)
```

Cada fila suma 1. `pesos[i][j]` = probabilidad de que nota `i` atienda a nota `j`.

### 5. 📈 Score de selectividad
Para cada nota de la muestra:

```text
score[i] = √( Σ_j pesos[i][j]² )
```

- Alto (~1.0): la nota atiende a muy pocas (estructura clara)
- Bajo (~0.1-0.2): atiende a muchas (complejidad o ruido)

### 6. 🎯 Selección de la octava destino

```text
octava_destino = round( (Σ score[i] · octava(i)) / Σ score[i] )
```

Media ponderada: las notas más "selectivas" deciden la octava.

### 7. 🎵 Tónica por atención recibida
Sumamos por pitch class la atención recibida:

```text
impPC[p] = Σ_j ( Σ_i pesos[i][j] )  para notas j con pitch_class = p
```

La clase con mayor valor es la tónica estimada.

### 8. 🗜️ Compresión a una octava
Se recorre cada nota original (no solo la muestra):

```text
nuevo_midi = octava_destino × 12 + (midi_original % 12)
```

- Se conserva pitch class (Do, Do#, Re...)
- Mismo tiempo, duración, velocidad, canal
- La canción suena armónicamente igual, todo en una octava

## 📊 Métricas de salida
El CSV incluye:
- BPM, resolución, duración real
- Densidad (notas/segundo), rango de semitonos, octavas usadas
- Dinámica: velocidad media, % piano/forte, rango dinámico
- Atención: concentracion_atencion, tonica_atencion, octava_atencion, muestra_atencion

El archivo `compresor_ayuda.txt` explica cada columna en detalle.

## 🚀 Cómo usar el programa

**Compilar**
```bash
javac deep/CompresorOctava.java
```

**Ejecutar**
```bash
# Sobre un archivo
java deep.CompresorOctava "ruta/cancion.mid"

# Sobre un directorio (todos los .mid)
java deep.CompresorOctava "C:/mis_midis"
```

**Resultados**
- `nombre_1oct.mid` — canción comprimida
- `CompresorOctava.csv` — métricas
- `compresor_ayuda.txt` — guía de interpretación

## ⚠️ Limitaciones conocidas
- Muestreo fijo de MAX_NOTAS_ATENCION notas — canciones muy largas pierden resolución
- No distingue notas simultáneas (acordes)
- Asume compás 4/4 para estimar compases
- No analiza silencios

## 💡 Posibles mejoras
- Muestreo por tiempo (cada X segundos)
- Incluir silencios como "notas fantasma"
- Usar chroma features en lugar de solo MIDI
- Exportar matriz de atención como mapa de calor

## 📖 Interpretación de concentracion_atencion

| Rango | Significado |
|-------|-------------|
| > 0.07 | Estructura muy clara, repetitiva (pop, rock) |
| 0.03–0.07 | Equilibrio entre repetición y variedad |
| < 0.02 | Alta complejidad, atonal o polifónica densa |

## 📜 Licencia
Proyecto educativo en Java puro (solo `javax.sound.midi`). Libre para usar, modificar y compartir.

Generado a partir del código fuente `CompresorOctava.java`
