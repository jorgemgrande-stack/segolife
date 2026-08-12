# COMUNITY — Ideas de estudiante, moderación y apoyos

`server/segolife/community/communityStudentProposalDb.ts` — lifecycle **propio**, distinto del de `community_proposals` (una encuesta formal). Una idea de estudiante nunca se reescribe como si ya fuera una encuesta — convertirla crea una fila **nueva** en `community_proposals` enlazada por `sourceStudentProposalId`.

## 1. Ciclo de vida

```
pending_moderation → approved → (convertStudentProposalToFormal) → converted
                   → rejected
```

- **Nunca hay un camino público que salte la moderación.** Toda idea nace en `pending_moderation` (spec punto 32) — no existe ningún endpoint que la publique directamente.
- `approveStudentProposal(id, moderatorUserId)` — solo cambia el estado, nunca modifica el contenido de la idea.
- `rejectStudentProposal(id, moderatorUserId, reasonInternal, reasonStudent?)` — **`reasonInternal` es obligatorio** (lanza si viene vacío); `reasonStudent` es opcional y es el único motivo que el estudiante llega a ver — el motivo interno nunca se expone en ningún endpoint de autoservicio.
- `convertStudentProposalToFormal(studentProposalId, questionType, options?)` (router `community.ts`) — solo permitido si `status === "approved"`; crea una `community_proposals` en **borrador**, prellenada (título, descripción, venue, fecha sugerida como `startsAt`), y marca la idea original como `converted` con `convertedProposalId`. Audiencia/timing/gamificación se completan después en la ficha de la propuesta nueva — la conversión nunca publica nada automáticamente.

## 2. Apoyos (`community_supports`)

- **Un apoyo por persona** — `UNIQUE(student_proposal_id, user_id)`; `supportStudentProposal()` captura el error 1062 y lo trata como no-op (idempotente, nunca lanza por doble-clic).
- **Nunca hay recompensa en SegoTokens por apoyar** (spec punto 34, explícito).
- **El conteo de apoyos nunca se denormaliza** — siempre `COUNT(*)` en vivo (`getSupportCount`, y el `JOIN`+`GROUP BY` dentro de `listStudentProposals`). Documentado en el propio comentario de schema para que nadie lo "optimice" a una columna cacheada sin querer.

## 3. Tendencia ("alta demanda")

`listTrendingStudentProposals()` — heurística **deliberadamente simple** (spec punto 35: "empezar simple"): apoyos recibidos en las últimas 24 horas, ordenados descendente, solo ideas `pending_moderation` con al menos 1 apoyo reciente. No es una fórmula compuesta (no combina volumen total + velocidad + tamaño de audiencia) — se documenta aquí como decisión explícita, no como una limitación oculta. El score completo de COMUNITY (`scoring.md`) **no se aplica** a una idea de estudiante hasta que se convierte en encuesta formal — antes de eso, solo se muestra "🔥 Alta demanda" como señal cualitativa.

## 4. Moderación de respuestas de texto libre (`open_text`)

Independiente del flujo de ideas de estudiante: cada fila de `community_response_values` de tipo `open_text` tiene `isHidden`/`isFeatured`, gestionables por un admin con `community.moderate` vía `setResponseValueVisibility`. Un texto oculto nunca aparece en los resultados que ve el estudiante (`getPublicById` no filtra por admin), pero sigue siendo visible para el admin (`getResults(id, includeHidden=true)`).

## 5. Privacidad

- Ningún estudiante ve individualmente cómo respondió otro estudiante — el drilldown de identidad (`community.getRespondents`) es exclusivo de `community.view` (admin).
- El motivo interno de rechazo de una idea **nunca** se expone en un endpoint que un estudiante pueda llamar.
- Las comparativas por segmento (IE vs UVA, nuevo vs. VIP...) solo se muestran con una muestra mínima configurable (`minSampleSize`, default 5) — evita poder identificar a un individuo por eliminación en un microsegmento.

## 6. Rate limiting anti-abuso

`server/_core/index.ts` — `communitySubmitProposalRateLimit` (5 ideas/min por IP) y `communitySupportRateLimit` (30 apoyos/min por IP), mismo patrón manual de `express-rate-limit` que el resto del repo. No se ha añadido CAPTCHA (spec punto 72 lo permite explícitamente: "no hace falta inicialmente").
