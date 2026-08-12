# COMUNITY — Tipos de pregunta

9 tipos (spec punto 6), cada uno con su propia forma de payload, validación y agregación de resultados. Ninguno comparte código de validación con otro salvo lo genuinamente común (existencia de la propuesta, ventana temporal, pertenencia de las opciones).

Validación de payload: `server/segolife/community/communityResponseService.ts` → `buildValueRows()` (función pura, cubierta por `communityResponseService.test.ts`). Agregación de resultados: `communityResultsService.ts` → `getProposalResults()` (siempre server-side, `GROUP BY`/`AVG`/`SUM`, nunca se traen filas crudas al frontend).

| Tipo | Payload del estudiante | Almacenamiento (`community_response_values`) | Resultado agregado |
|---|---|---|---|
| `single_choice` | `{ optionId }` | 1 fila, `optionId` | Conteo + % por opción |
| `yes_no` | `{ value: "yes" \| "no" }` | 1 fila, `valueText` | `{ yes, no, yesPercentage }` |
| `percentage_scale` | `{ values: [{optionId, value: 0-100}] }` | N filas (una por criterio), `valueNumber` entero | Media por criterio + nº de respuestas |
| `scale_1_5` | `{ value: 1-5 }` | 1 fila, `valueNumber` | Media + distribución 1-5 |
| `multiselect` | `{ optionIds: number[] }` | N filas, una por opción marcada | Conteo + % por opción (denominador = respuestas totales, no selecciones) |
| `ranking` | `{ orderedOptionIds: number[] }` — **exige TODAS las opciones**, sin duplicados | N filas, `valueNumber` = posición 1-based | Posición media + veces elegida #1 por opción |
| `attendance_intention` | `{ value: "no"\|"maybe"\|"probably"\|"definitely" }` | 1 fila, `valueText` + código en `valueNumber` | Desglose por valor + interés predicho + intención fuerte predicha |
| `me_apunto` | `{}` (sin datos — responder ES la señal) | 1 fila fija | Conteo total |
| `open_text` | `{ text }` (máx. 1000 caracteres, HTML eliminado) | 1 fila, `valueText` sanitizado | Lista moderable (destacar/ocultar), admin ve todo, estudiante solo lo no oculto |

## Reglas de validación notables

- **Ranking exige el conjunto completo**, nunca un subconjunto — un ranking parcial no es comparable de forma consistente entre estudiantes sin una regla adicional que el propio encargo no fija (decisión documentada, no un olvido).
- **Percentage scale** — cada criterio se valida 0-100 entero de forma independiente; al menos un criterio es obligatorio.
- **Multiselect/Ranking** rechazan IDs de opción duplicados y opciones que no pertenecen a la propuesta.
- **Open text** — `sanitizeOpenText()` elimina cualquier etiqueta HTML (`<[^>]*>`) y trunca a 1000 caracteres; el texto se renderiza siempre como texto plano en el frontend (nunca `dangerouslySetInnerHTML`), así que este strip básico es suficiente, no hace falta un sanitizador HTML completo.

## Cambio de respuesta

`allowChangeResponse` (por propuesta, default `true` mientras está activa) controla si un segundo envío actualiza la fila existente (`UPSERT`, mismo `id` de `community_responses`, se borran y reinsertan sus `community_response_values`) o se rechaza con `ALREADY_RESPONDED`. Al cerrar la propuesta, ya no se puede responder en absoluto (independiente de este flag) — `isProposalOpenForResponses()` corta antes de llegar a esta comprobación.

## Visibilidad de resultados (independiente del tipo)

`resultsVisibility` por propuesta: `immediate` (siempre visibles), `after_vote` (solo tras responder — nunca se muestra el porcentaje antes de votar, para no sesgar), `after_close` (solo cuando cierra), `never`. Esta lógica vive **enteramente en el servidor** (`community.getPublicById`) — el cliente nunca decide si mostrar resultados, solo renderiza lo que el servidor ya decidió mostrar.
