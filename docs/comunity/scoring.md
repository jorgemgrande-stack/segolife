# COMUNITY — Score, intención y predicción

Todas las funciones descritas aquí son **puras** (sin I/O, sin BD) — viven en `communityIntentService.ts` y `communityScoreService.ts`, cubiertas por `communityIntentService.test.ts` y `communityScoreService.test.ts`.

## 1. Intención de asistencia (`attendance_intention`)

Pesos analíticos — **heurística inicial documentada, no una medición estadística** (spec punto 40 lo pide explícitamente así: "conceptual, no hardcodear hasta confirmar datos reales"). Los pesos son el ejemplo **literal** dado en el propio encargo:

| Valor | Código | Peso |
|---|---|---|
| No puedo | 0 | 0.00 |
| Quizá | 1 | 0.35 |
| Probablemente | 2 | 0.70 |
| Voy seguro | 3 | 1.00 |

`predictedInterested` = Σ(count × peso) por bucket, redondeado. `predictedStrongIntent` = conteo exacto de "Voy seguro". **Ambos se muestran siempre junto al resultado bruto (el desglose real por valor), nunca lo sustituyen** — nadie ve solo un número inventado sin el dato crudo al lado.

## 2. Respondente positivo (spec punto 48)

`isPositiveRespondent(proposal, values, options)` — depende del tipo, **nunca infiere donde no hay regla explícita**:

- `yes_no` → `yes`
- `attendance_intention` → `probably`/`definitely`
- `me_apunto` → responder ya es la señal (siempre positivo si hay respuesta)
- `single_choice` → el admin marca por opción qué respuesta cuenta como positiva (`community_options.is_positive_intent`, nunca visible al estudiante)
- Cualquier otro tipo (`percentage_scale`, `ranking`, `scale_1_5`, `multiselect`, `open_text`) → `null` — no hay una regla de "positivo/negativo" definible sin arbitrariedad, así que la función lo dice explícitamente en vez de adivinar.

Este campo alimenta: la dimensión "intención positiva" del COMUNITY Score, el drilldown de respondentes, y `notifyInterestedRespondents()` al convertir en Evento.

## 3. COMUNITY Score

`computeCommunityScore(input): CommunityScoreResult` — responde **"¿merece la pena convertir esto en algo real?"**, nunca altera el voto bruto (que siempre se muestra aparte).

**Umbral mínimo:** menos de 3 respuestas → `{ score: 0, insufficientData: true, dimensions: [] }`. Nunca se fabrica un score sobre una muestra insuficiente.

**Dimensiones y pesos** (documentados en un único sitio, `communityScoreService.ts`, nunca repetidos en otro archivo):

| Dimensión | Peso | Cómo se calcula | Cuándo se omite |
|---|---|---|---|
| Participación | 25% | `respuestas / audiencia × 100` | Nunca (siempre disponible) |
| Intención positiva | 30% | `respondentes positivos / respuestas × 100` | Si `isPositiveRespondent` devuelve `null` para el tipo de pregunta |
| Intención fuerte | 20% | `respondentes con intención fuerte / respuestas × 100` | Igual que arriba |
| Velocidad de respuesta | 15% | Basada en minutos medianos desde publicación | Si no hay dato de velocidad disponible (fase actual: siempre omitida, requiere histórico de timestamps por respuesta — documentado como futuro) |
| Calidad de muestra | 10% | `respuestas / 20 × 100`, **saturado en 100** | Nunca |

El score final es el promedio ponderado **solo de las dimensiones presentes** (el denominador es la suma de pesos de las dimensiones disponibles, no siempre 100%) — así una propuesta `yes_no` no se penaliza por no tener "intención fuerte" definida.

**Nunca penaliza audiencias pequeñas:** la dimensión de calidad de muestra satura en 100 a partir de 20 respuestas — una propuesta con audiencia de 5 y 5 respuestas puntúa igual en participación que una con audiencia de 500 y 500 respuestas (ambas 100%), y no pierde puntos por ser pequeña en la dimensión de muestra una vez supera el umbral mínimo de 3.

## 4. Predicción vs. realidad — solo lo que hay dato real para mostrar

Predicted attendance (`predictedInterested`/`predictedStrongIntent`) y el COMUNITY Score se presentan siempre como **estimaciones**, nunca como hechos — el desglose real está siempre visible al lado. No se ha implementado ningún paso de "comparar predicción vs. asistencia real post-evento" ni "funnel de conversión completo" (`respondió → intención positiva → compró → asistió → consumió`) porque no existe hoy trazabilidad fiable de principio a fin entre una respuesta de COMUNITY y una compra/asistencia real — implementarlo con datos parciales generaría un funnel engañoso. Se documenta como integración futura, no como una función a medio construir.
