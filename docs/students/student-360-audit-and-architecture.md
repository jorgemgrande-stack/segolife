# STUDENT 360º — Auditoría de fuentes + Arquitectura propuesta

**Rama:** `feat/segolife-student-360` (sin commits nuevos aún — este documento es el primero)
**Estado:** AUDITORÍA Y DISEÑO. **Ningún código de UI, ninguna migración, ningún cambio de schema.** Nada tocado en producción.
**Fecha:** 2026-08-11
**Alcance de esta entrega:** exclusivamente lo pedido — auditoría de todas las fuentes, matriz definitiva, arquitectura propuesta, fórmula SegoScore (sin implementar), diseño de Timeline, diseño de queries/performance, propuesta de Audit Trail. **DETENIDO** al final de este documento a la espera de aprobación.

Metodología: 13 auditorías de solo lectura (6 iniciales + 7 de profundización) realizadas por subagentes de exploración sobre el código real del repositorio. Toda afirmación cita archivo:línea. Donde algo no existe, se dice explícitamente — cero invención.

---

## 0. Decisiones ya tomadas (confirmadas por el usuario, no se revisan aquí)

1. `studentsDb.ts` se conserva como dominio base del perfil del estudiante.
2. `students.ts` conserva el patrón `permissionProcedure` + `communityAccess` + `assertStudentAccessible` para cualquier lectura/mutación nueva.
3. No se crea RBAC ni community-scoping paralelo.
4. No se crea Customer/Client paralelo — Student es la entidad humana central.
5. `StudentTokensTab` no se reconstruye — se reorganiza dentro de Student 360.
6. La pestaña "Próximamente" se elimina conceptualmente (Benefits y QR ya están implementados, el placeholder está obsoleto).
7. El listado de Students debe evolucionar a paginación/cursor real (hoy `limit:100, offset:0` fijos sin control de UI).
8. CRM legacy (clients/leads/quotes/invoices) se conserva para B2B, nunca se usa como identidad paralela de un estudiante.

---

## 1. AUDITORÍA DE FUENTES

### A. Eventos / Ticketing

| Tabla | Columnas clave | Archivo:línea |
|---|---|---|
| `events` | `status` enum(`active`,`inactive`) — **sin** estado "finalizado" | `drizzle/schema.ts:3909-3925` |
| `salesChannels` | `channelType`(fourvenues/weezevent/segolife_native/manual/partner), `salesMode`(external_redirect/external_checkout/native) | `drizzle/schema.ts:4651-4667` |
| `eventTicketTypes` | `priceCents`, `capacity`, `salesStart/End` | `drizzle/schema.ts:4671-4686` |
| `ticketOrders` | `userId` **nullable**, `status` enum(pending/awaiting_payment/paid/cancelled/expired/refunded/partially_refunded/failed/reconciliation_required), `totalCents`, `purchasedAt`, `cancelledAt`, `refundedAt`, `salesChannelId` nullable | `drizzle/schema.ts:4709-4738` |
| `ticketPayments` | `status`(pending/succeeded/failed/refunded), `amountCents`, `failureReason` — 1 fila por intento de pago | `drizzle/schema.ts:4748-4765` |
| `ticketOrderItems` | `orderId`, `ticketTypeId`, `quantity`, `unitPriceCents`, `totalPriceCents` | `drizzle/schema.ts:4767-4777` |
| `eventTickets` | `userId` **nullable**, `salesChannel` enum(native/external), `status`(issued/cancelled/refunded/used), `qrToken/Hash` | `drizzle/schema.ts:4785-4808` |

**No existe ninguna relación Drizzle (`.references()`)** para ninguna de estas 9 tablas (`drizzle/relations.ts`, 0 coincidencias) — todos los joins son manuales.

**Refunds/cancelaciones:** no hay tabla dedicada — se modelan con columnas `status`+timestamp en `ticketOrders`/`eventTickets`, gobernadas por una máquina de estados (`server/segolife/ticketing/orderStateMachine.ts:36-46`) que **prohíbe** `paid→cancelled` directo (solo reembolso). `refundOrder()` (`ticketCancellationService.ts:51-95`): si algún ticket ya está `used` (check-in hecho), el order pasa a `reconciliation_required` en vez de revertir automáticamente tokens/beneficios — resolución manual admin.

**"purchaseAction" NO es un log de compra** — `purchaseAction.ts:54-93` solo resuelve qué botón/CTA mostrar en la ficha pública del evento (presentación, no persistencia). El evento de dominio más cercano, `emitEngagementEvent("ticket_purchased")`, **no es durable** (EventEmitter en memoria, `engagementEvents.ts:11-16`) y **no tiene ningún listener registrado** (grep confirmado). El registro real y durable de "se compró" es `ticketOrders.status='paid'` + `purchasedAt` (`checkoutService.ts:100,132`).

**Ya reutilizable, sin modificar:** `listMyOrders(userId)`, `getMyOrderById(orderId,userId)`, `listMyTickets(userId)`, `getMyTicketById(ticketId,userId)` en `server/segolife/ticketing/ticketingDb.ts:209-267` — todas aceptan `userId` como parámetro libre, no atado a sesión. **Pero el router (`ticketPurchase.ts`) solo las envuelve con `ctx.user.id`** — no existe hoy ningún camino admin que las invoque con un `studentId` arbitrario, y `students.ts` tiene **cero** referencias a ticketing.

**Hallazgo crítico #1:** las compras por canal **externo** (Fourvenues/Weezevent) **nunca generan filas en `ticketOrders`/`eventTickets`** — la única inserción real de `eventTickets` en todo el repo es `ticketIssuanceService.ts:46-59`, siempre con `salesChannel:"native"` hardcodeado. Las compras externas solo dejan rastro como `event_attendance` (si el pipeline de asistencia está activo). **Hoy solo se puede prometer "todo lo comprado vía checkout nativo Segolife" + "todo aquello a lo que asistió (de cualquier canal)" — no "todo lo comprado" en sentido absoluto.**

**Hallazgo crítico #2:** `ticketOrders.salesChannelId` está **siempre NULL en la práctica** — `startCheckout` (`ticketPurchase.ts:49-56`) nunca lo pasa. El "canal de venta" no es mostrable con datos reales hoy para compras nativas, sin antes corregir ese bug de origen (fuera de alcance de Student 360, es deuda técnica previa).

**Gaps confirmados (CREATE/ADAPT):** sin función de `SUM(totalCents)` por usuario (CREATE); `listMyTickets`/`getMyTicketById` no resuelven nombre de tipo de ticket, a diferencia de `getMyOrderById` que sí (ADAPT); sin router admin que reutilice las 4 funciones con `studentId` (CREATE).

---

### B. Attendance — y la pregunta central de "no-show"

`eventAttendance` (`drizzle/schema.ts:4818-4837`): `eventId`, `ticketId` nullable, `userId` **notNull**, `venueId`, `provider` (varchar libre, no enum), `integrationType/Id`, `occurredAt`, `idempotencyKey` único, `tokensLedgerId`. Comentario del propio schema: *"Fuente de verdad ÚNICA de asistencia Segolife"* (`:4810-4816`).

**No se registra quién hizo el check-in de staff** — no existe `checkedInByStaffUserId`; contraste directo con Benefits, que sí tiene `used_by_staff_user_id` (`schema.ts:4562`). El parámetro `staffUserId` de `checkInTicket()` se usa solo para autorización, nunca se persiste.

**No existe "método" como enum** — se infiere por convención de `provider` (varchar libre, sin catálogo cerrado) + presencia/ausencia de `ticketId`.

**CONFIRMADO CON 5 EVIDENCIAS INDEPENDIENTES: no existe ningún mecanismo de no-show.**
1. `eventTickets.status` = `[issued,cancelled,refunded,used]` — **sin** valor `no_show`, a diferencia de `reservation_status` (hotel, `schema.ts:1190`) y `restaurant_bookings.status` (`restaurantsDb.ts:343-346`), que sí lo tienen — decisión deliberada de no portarlo al dominio de eventos.
2. `events.status` = `[active,inactive]` — sin estado "finalizado"; "pasado" se calcula al vuelo (`shared/segolife/eventTiming.ts:39-45`, `getEventTemporalStatus`) y **nunca se persiste**.
3. Inventario completo de cron jobs (`server/_core/index.ts:670-679`) — ninguno menciona eventos/attendance/no-show.
4. `integrationSyncService.ts:1-16,45-50` documenta explícitamente que **no** sincroniza attendance, y que **ningún worker arranca solo**.
5. No existe ningún script de importación de histórico externo hacia `event_attendance` (`scripts/bootstrap-qa-events.ts:20-23` confirma explícitamente que no crea asistencia real).

**Consecuencia:** la ausencia de fila en `event_attendance` **nunca significa "no asistió"** — significa exclusivamente "no lo sabemos". El caso límite (ticket comprado + evento aún no ocurrido + sin fila de attendance) es indistinguible a nivel de dato crudo del caso (evento ya pasado + sin fila de attendance) — ambos son "ausencia de fila". Cualquier etiqueta "no-show" en Student 360 sería una **inferencia de UI**, nunca un hecho registrado, y heredaría un sesgo sistemático: eventos vendidos por canal externo con integraciones desactivadas generarían falsos no-show en masa.

**`listAttendanceByUserId` NO existe** (confirmado exhaustivamente) — solo `listEventAttendance(eventId)` (`ticketingDb.ts:199`, por evento). `studentsDb.ts` tiene cero referencias a asistencia.

**Estado "unresolved":** existe, pero en tabla separada `unresolved_operations` (`schema.ts:5005-5028`, status: unresolved/linked/ignored/conflict) — cuando la identidad de un asistente externo no se puede resolver a un `userId`, no se crea fila en `event_attendance`, se encola ahí hasta vinculación manual admin.

**Qué SÍ se puede calcular con seguridad (función nueva):** asistencias totales, última asistencia, detalle por evento/venue/provider. **Attendance rate SOLO sobre eventos ya finalizados con ticket no cancelado/reembolsado**, documentando el sesgo de cobertura por proveedor externo. **Qué NO:** no-show real, attendance rate global fiable, auditoría de qué staff hizo el check-in.

---

### C. Commerce / Consumption / QR

`commerceTransactions` (`drizzle/schema.ts:5041-5068`): `userId` **nullable**, `venueId` notNull, `status` enum(pending/confirmed/cancelled/refunded/reconciliation_required), `totalCents`, `occurredAt`, `loyaltyLedgerId`. Sin `communityId` (se deriva vía `venueId→community_venues`, regla multicomunidad). Sin FK declarada, sin índice sobre `userId`.

`commerceTransactionItems` (`:5070-5082`): `venueProductId` **nullable — columna muerta**, nunca se rellena en ningún camino de escritura del repo (`commercePipeline.ts:127-137`, `nativeCommerceService.ts:79-86` descarta el id tipado y lo convierte en `externalProductId` string). Producto solo reconstruible de forma fiable para `provider='segolife'`.

`venueProducts` (`:4033-4048`): catálogo mínimo por venue, deliberadamente sin stock/variantes/impuestos.

`consumptionQrCodes` (`:4276-4304`): `codeHash` (SHA-256, el token en claro **nunca** se persiste), `venueId`, `productId` nullable, `amountCents` nullable (puede quedar "en blanco"), `status`(issued/redeemed/expired/cancelled), `redeemedByUserId`, `ledgerId`.

**Hallazgo crítico: no existe NINGUNA función que liste/agregue `commerceTransactions`/`commerceTransactionItems` por `userId`.** Solo existen `listCommerceTransactionsByVenue(venueId)` y `listCommerceTransactionItems(transactionId)` (`server/segolife/commerce/commerceDb.ts:20-28`). El propio documento del módulo (`docs/commerce/native-commerce.md:43`) declara "informes de venta" explícitamente fuera de alcance. La columna `commerceTransactions.userId` existe pero sin índice — cualquier función nueva necesitará `INDEX(user_id)` de acompañamiento.

**Confirmado sin matices: QR de consumo y Commerce/POS son dos flujos completamente independientes, sin cruce en código ni en schema.** `consumptionQrService.ts` nunca importa `commerceTransactions`; `commercePipeline.ts` nunca importa `consumptionQrCodes`; no hay columna puente en ningún lado. El único punto de convergencia es aguas abajo: ambos llaman `earnTokens({origin:"consumption"})`, generando filas de `token_ledger` con el **mismo** `sourceType="consumption"` — indistinguibles salvo parseando el string de `idempotencyKey` (`consumption_qr:` vs `commerce_transaction:`), porque `token_ledger.sourceId` **nunca se rellena** en ninguno de los dos flujos pese a existir la columna.

**Ya reutilizable:** `listQrRedemptionsByUser(userId)` (`server/db/consumptionQrDb.ts:174-186`) y `listConsumptionQrCodes({redeemedByUserId})` — ya expuestos y consumidos por `StudentDetail.tsx`.

---

### D. SegoTokens (backend completo)

`token_wallets` (`:3965-3976`): `balance`, `lifetimeEarned`, `lifetimeSpent` — UNIQUE(userId), 1:1. **`token_ledger`** (`:4000-4021`): `direction`(credit/debit), `amount`, `balanceAfter`, `reason` (varchar256 **notNull**), `sourceType` (varchar64 libre, no enum), `sourceId` (nullable, nunca poblado), `createdByUserId`, `reversedLedgerId`, `idempotencyKey` único.

**Confirmado sin ambigüedad: no existe ningún mecanismo de expiración de tokens** — ni columna `expiresAt` en wallet ni en ledger, ni lógica alguna (grep exhaustivo de "expir" sobre todo el schema: ningún match pertenece a tokens).

**`postLedgerMovement()`** (`tokenLedgerService.ts:99-181`) es el **único** punto de escritura de wallet+ledger — transacción atómica con `SELECT...FOR UPDATE` (lock de fila real), rechaza saldo negativo, idempotente. `reverseTransaction()` nunca edita/borra, crea un movimiento nuevo de signo opuesto enlazado por `reversedLedgerId`. `adjustManualTokens()` exige `reason` no vacío y persiste `createdByUserId` — **esta es ya, hoy, la infraestructura completa de audit trail para ajustes de tokens.**

**Confirmado: no existe ningún contador de balance alternativo** (grep de `tokenBalance`/`token_balance`: 0 resultados en todo el repo) — `token_wallets.balance` es un valor materializado, escrito exclusivamente dentro de la misma transacción que el ledger; nunca por otra vía.

**Hallazgo crítico: `spendTokens()` existe y está testeado pero NO tiene ningún caller de producción** — hoy no hay ningún flujo real donde un estudiante gaste tokens. Y de los 9 valores posibles de `token_rules.origin`, **solo 2 están realmente conectados a un evento de negocio**: `"attendance"` (vía `attendancePipeline.ts`) y `"consumption"` (vía `commercePipeline.ts` + `consumptionQrService.ts`). `"ticket"`/`"purchase"`/`"product"`/`"event"`/`"manual"` existen en el schema y en el admin de reglas, pero ningún pipeline de producción los dispara automáticamente — **comprar un ticket no genera tokens hoy salvo que derive en asistencia o en un consumo**.

**Autoservicio del estudiante hoy: solo 2 procedures** (`getMyWallet`, `listMyLedger`) — sin gastar, sin ver reglas/campañas activas.

---

### E. Benefits (backend completo)

`userBenefits` (`:4544-4576`): `status` enum = **`active/used/expired/cancelled`** (corrige la hipótesis inicial — **no** existe valor `"available"`). `sourceType` varchar libre. `usedAt`, `usedAtVenueId`, `usedByStaffUserId` (**sí** existe, contraste con Attendance que no lo tiene). `grantedByUserId` (admin que concedió, columna dedicada). `cancelledAt/By/Reason` (columna dedicada).

`expireBenefitIfNeeded()` es **expiración perezosa on-read**, NO un cron (confirmado: sin callers en jobs, solo se resuelve cuando el propio estudiante consulta `myBenefits`/`getMyBenefit`) — **el conteo de "expirados" subestima la realidad** hasta que cada fila es tocada.

`listGrantedBenefits(filters)` **sí acepta `userId`** — ya usado por `StudentDetail.tsx:59`.

**Asimetría real:** el grant manual sí traza QUÉ admin (`grantedByUserId`, columna dedicada), pero el MOTIVO del grant manual **no tiene columna propia** — viaja sin tipar dentro de `metadata` JSON (`benefits.ts:220`), a diferencia de la cancelación, que sí tiene `cancellationReason` dedicado. ADAPT: exponer `metadata.reason` como campo explícito en `GrantedBenefitListItem`.

**Métrica de conversión (grant→uso):** datos crudos suficientes para un ratio simple, pero **no existe ninguna función que la calcule hoy**, y una versión honesta requiere decidir explícitamente cómo tratar `active`-aún-vigente (no es ni éxito ni fracaso) y `cancelled` (no es lo mismo que "no usado por decisión propia") — decisión de producto, no solo un `COUNT`.

---

### F. Engagement (Fase 7)

Infraestructura **real y completa para in-app**, **apagada por defecto para email/push/WhatsApp** (kill switches en `false`, confirmado en `env.example.txt` y ausencia en `.env` local). `notification_deliveries.status` incluye `"delivered"` en el enum pero **ningún código lo escribe jamás** (solo `pending→sent|failed|skipped`).

`studentNotifications` = router de inbox in-app del propio estudiante (deliberadamente separado del router legacy `notifications`, que es la campana CRM heredada de Náyade).

`campaignService.ts` + `engagementScheduler.ts` (cron cada minuto) están completos en código, pero gateados por `ENGAGEMENT_DELIVERY_ENABLED=false` — en un entorno nuevo el cron nunca se registra. **La única automatización realmente conectada hoy es: beneficio concedido → notificación in-app** (`benefitGrantedListener.ts`); el resto de 17 tipos de evento catalogados no tiene listener.

**Confirmado: ninguna función de lectura filtra por estudiante para uso admin.** `listMyNotifications(userId)`/`listMyPreferences(userId)`/`getUnreadCount(userId)` **sí** filtran por `userId` pero son solo-autoservicio (`ctx.user.id`); `listAllNotifications`/`listDeliveries`/`listCampaigns` son agregados globales **sin** filtro por usuario (`listDeliveries` solo acepta `{status,channel}`, nunca `userId` — confirmado, 0 usos). `engagement_campaign_audiences` solo se consulta por `campaignId`, nunca por `userId`.

**Confirmado NO medible hoy, con evidencia de ausencia de código, no supuesto:** open rate de email, click rate fuera de in-app, interacción con push — cero infraestructura de tracking.

**`StudentDetail.tsx` tiene CERO referencias a Engagement** — ni siquiera está anunciado como "próximamente".

---

### G. Login / Activity y Audit Trail

Auth **stateless, JWT-en-cookie**, sin tabla de sesiones (`server/localAuth.ts`). `logout` solo limpia la cookie — **no hay invalidación server-side** del JWT (sigue siendo válido hasta expirar a los 30 días).

`users.lastSignedIn` (`schema.ts:43`) es un **único timestamp que se sobreescribe** en cada login (`localAuth.ts:112-116`) — confirmado que **ninguna** query de estudiante lo selecciona hoy (`buildStudentDetail`, `studentsDb.ts:196-198`, no lo incluye).

**Confirmado sin ambigüedad: no existe ningún histórico de login/actividad** en todo el repo (grep exhaustivo de 8 variantes de nombre: 0 resultados; no existe tabla `sessions`; no hay `express-session`/`connect-redis`).

**Diseño mínimo propuesto (sin implementar):**
```
student_login_events
  id          int PK autoincrement
  userId      int NOT NULL
  occurredAt  timestamp NOT NULL DEFAULT (now())
  method      varchar(32) NOT NULL   -- "password" hoy; abre puerta a futuros métodos
```
Sin IP/user-agent/fingerprint (nada de eso existe hoy en `localAuth.ts`, así que añadirlo sería tracking nuevo). Punto de enganche exacto: `server/localAuth.ts`, entre las líneas 116 (fin del `UPDATE lastSignedIn`) y 118 (`signSessionToken`).

**Audit trail — búsqueda repo-wide.** Tablas de log reales encontradas, todas **aisladas por dominio, ninguna genérica**: `crmActivityLog` (CRM, enum cerrado `[lead,quote,reservation,invoice]`), `configChangeLogs` (feature flags), `cardTerminalBatchAuditLogs` (TPV), `settlementStatusLog` (hotel), `token_ledger` (SegoTokens, `sourceType` ya abierto/varchar libre). **No existe ningún log genérico transversal** — es el patrón arquitectónico consistente del repo: cada dominio tiene el suyo, aislado.

**Extender `crmActivityLog.entityType` con `'student'` es técnicamente trivial** — precedente idéntico ya aplicado (`drizzle/0101_hr_documents_enum_extend.sql`), ningún `switch` exhaustivo depende de los 4 valores actuales (todos los usos son comparaciones puntuales), solo 1 línea de tipo a ajustar (`server/db.ts:90`), frontend degrada de forma segura. **Pero** `entityId` es un `int` genérico sin FK — ambigüedad real sobre si apuntaría a `users.id` o `student_profiles.id` (los 4 valores actuales son todos "entidad comercial CRM", mutuamente consistentes; "student" no lo es), y semánticamente mezclaría un dominio de CRM comercial con SegoTokens/estudiantes, rompiendo el patrón de aislamiento por dominio que el resto del repo respeta sin excepción.

**Hallazgo que cambia el enfoque:** para el caso concreto que motivó la pregunta — *"Admin Jorge añadió +500 ST a Student X, motivo: compensación"* — **la infraestructura ya existe y funciona hoy sin ningún desarrollo adicional**: `tokens.adjustManual` → `adjustManualTokens()` → `token_ledger` con `reason` obligatorio y `createdByUserId`. El único gap real es que no admite fecha retroactiva (backdating) — `PostLedgerMovementInput` no tiene campo de fecha, `createdAt` siempre es `now()`. Lo mismo aplica a Benefits (`grantedByUserId`/`cancellationReason` ya existen). **El hueco real y genuino de audit trail está en un solo sitio: `updateStudentAdminFields` (cambio de `status` activo/inactivo) no deja ningún rastro — ni actor, ni motivo, ni histórico, es un `UPDATE` puro.**

Ver recomendación en §7.

---

### H. CRM Legacy — reutilizable

| Elemento | Veredicto | Motivo |
|---|---|---|
| `clients`, `leads`, `proposals`, `quotes`, `invoices` | **DO NOT USE** | Turismo B2C, cero FK a `users`, exactamente lo que la decisión de producto prohíbe duplicar |
| `crmLeadSources` | **DO NOT USE** | Patrón ya clonado correctamente en `studentTags` |
| `studentTags`/`studentTagAssignments` | **REUSE** | Completo, ya conectado, incluye unassign |
| `studentNotes` | **REUSE + ADAPT** | Falta delete/update; sin precedente que copiar (su ancestro `quoteInternalNotes` tampoco lo resolvió nunca) |
| `crmActivityLog` | **ADAPT (evaluar)** | Ver §G — migración trivial pero cruza dominio; decisión pendiente, ver §7 |
| Timeline patrón A (`crm.quotes.timeline.get`) | **REPLICAR patrón** | Construir `events[]` desde campos propios + activity log, deduplicar, ordenar server-side — reutilizable como técnica |
| Timeline patrón B (`crm.clients.getHistory`) | **REPLICAR patrón** | Fan-out de queries en paralelo + condiciones OR por tipo de entidad + fusión final — es el modelo para el Activity Aggregator de Student 360 (§4) |
| `emailCommLog` | **ADAPT** | Ya tiene par polimórfico `relatedEntityType`/`relatedEntityId` diseñado para reutilización sin tocar schema |
| `ghlConversations`, `vapiCalls` | **DO NOT USE** | Integraciones de proveedor externo específicas de ventas, sin relación con dominio estudiante |

---

### I. Módulo Students actual — confirmado como base correcta (auditoría ya aceptada)

- `studentsDb.ts`: perfil + comunidades + tags + notas. Contrato explícito (`:69`): el scoping de comunidad se resuelve en el router, **nunca** en la capa de BD — cualquier función nueva debe respetar esto.
- `students.ts`: `permissionProcedure("students.view"/"students.manage", ["admin"])` + `assertStudentAccessible()` (fetch completo → comparar comunidades → autorizar) repetido 7 veces — patrón a replicar en todo procedure nuevo de Student 360.
- `StudentDetail.tsx`: 8 pestañas; `StudentTokensTab` ya completo (wallet+ledger+ajuste manual+QR+benefits de solo lectura); pestaña "Próximamente" obsoleta (decisión #6, ya tomada).
- `StudentsManager.tsx`: `limit:100, offset:0` fijos, sin paginación real en UI (decisión #7, ya tomada).

---

## 2. MATRIZ DEFINITIVA

Leyenda: **R**=Reuse, **A**=Adapt, **C**=Create, **N/A**=no aplica/no construible hoy.

| CAPACIDAD | FUENTE REAL | TABLA/SERVICIO | DISPONIBLE HOY | R/A/C | LIMITACIONES |
|---|---|---|---|---|---|
| Student identity | `student_profiles`+`users` | `studentsDb.getStudentById/ByUserId` | Sí | R | — |
| Communities | `user_communities`+`communities` | `studentsDb` (batch en memoria) | Sí | R | Asume volumen bajo de estudiantes |
| University | `universities` | `studentsDb` | Sí | R | — |
| Profile (personal/académico/estancia) | `student_profiles` | `studentsDb`/`students.updateProfile` | Sí | R | — |
| Tags | `studentTags`+`studentTagAssignments` | `studentsDb` | Sí | R | — |
| Notes | `studentNotes` | `studentsDb` | Sí | A | Falta delete/update |
| Status (activo/inactivo) | `student_profiles.status` | `updateStudentAdminFields` | Sí | A | **Sin traceability** — ver §7 |
| Registration (fecha alta) | `student_profiles.createdAt` | `studentsDb` | Sí | R | — |
| Last login | `users.lastSignedIn` | — | Existe la columna, no seleccionada hoy | A | Un único valor, se sobreescribe |
| Login history | — | — | **No existe** | C | Propuesta mínima en §G, empieza a registrar desde ahora, no retroactivo |
| Event purchase (compra) | `ticketOrders`/`eventTickets` | `listMyOrders`/`listMyTickets` | Sí, **solo canal nativo** | R (backend) / C (router admin) | Compras por canal externo no dejan rastro de "compra", solo de asistencia |
| Ticket ownership | `eventTickets` | `listMyTickets`/`getMyTicketById` | Sí | R (backend) / C (router admin) | — |
| Payment (importe) | `ticketOrders.totalCents` | — | Sí, por order | C | Sin función de `SUM` agregada por usuario |
| Refund | `ticketOrders.status`/`eventTickets.status` | `refundOrder()` | Sí | R | Ticket ya usado → `reconciliation_required`, no auto-revierte tokens/beneficios |
| Attendance | `event_attendance` | `listEventAttendance(eventId)` | Sí, pero **no por usuario** | C | `listAttendanceByUserId` no existe |
| No-show | — | — | **No existe ningún mecanismo** | N/A | Ver §B — riesgo real de falso positivo si se infiere sin cuidado |
| Consumption (QR) | `consumptionQrCodes` | `listQrRedemptionsByUser` | Sí | R | — |
| Consumption (POS/comercio) | `commerceTransactions` | — | **No existe función por usuario** | C | Falta índice sobre `userId` |
| Products | `venueProducts` | — | Sí para QR; parcial para POS | R/A | `venue_product_id` en `commerceTransactionItems` es columna muerta |
| Spend (gasto total) | `ticketOrders`+`commerceTransactions`+`consumptionQrCodes` | — | Parcial | C | Requiere agregación nueva sobre 3 fuentes distintas |
| Lifetime value | Derivado de Spend | — | No existe cálculo | C | Depende de resolver Spend primero |
| Average ticket | Derivado de Spend/nº transacciones | — | No existe cálculo | C | Idem |
| Tokens balance | `token_wallets.balance` | `getWalletByUserId` | Sí | R | Materializado, fuente de verdad real = ledger |
| Tokens earned/spent (lifetime) | `token_wallets.lifetimeEarned/Spent` | `getWalletByUserId` | Sí | R | — |
| Benefits available | `userBenefits.status='active'` | `listGrantedBenefits({userId})` | Sí | R | Expiración perezosa puede mostrar como "active" algo ya vencido |
| Benefits used | `userBenefits.status='used'` | `listGrantedBenefits({userId})` | Sí | R | — |
| Benefits expired | `userBenefits.status='expired'` | `listGrantedBenefits({userId})` | Sí, subestimado | A | Expiración on-read, no cron |
| Notifications (in-app) | `notifications` | `listMyNotifications(userId)` | Sí (backend) | A | Sin endpoint admin ni UI en la ficha |
| Campaigns (pertenencia) | `engagement_campaign_audiences` | — | **No existe función por usuario** | C | Solo se consulta por `campaignId` hoy |
| Engagement (medible) | `notifications.readAt/clickedAt` | — | Solo in-app | A | Open/click rate de email, push: no medible, no inventar |
| Venue affinity | Derivado de attendance+consumo | — | No existe cálculo | C | Requiere agregación cross-fuente |
| Event affinity | Derivado de attendance+tickets | — | No existe cálculo | C | Idem |
| Activity timeline | Múltiples fuentes | — | No existe agregador | C | Ver §4 — replicar patrón `crm.clients.getHistory` |
| Admin audit | Parcial (tokens/benefits sí, status no) | `token_ledger`/`userBenefits` | Parcial | A/C | Ver §7 — gap real solo en cambio de `status` |
| SegoScore | Derivado multi-fuente | — | No existe | C | Ver §3 — fórmula propuesta, NO implementar aún |
| Segment | Derivado de SegoScore+actividad | — | No existe | C | Reglas centralizadas, no JSX |
| Ranking | Derivado, por comunidad | — | No existe | C | Diseñar agregación eficiente, no query por estudiante |
| Alerts | Derivado (perfil incompleto, inactividad, etc.) | `REQUIRED_FOR_COMPLETION` ya existe para perfil incompleto | Parcial | A/C | El resto de alertas no existen aún |

---

## 3. FÓRMULA SEGOSCORE — propuesta (NO implementar todavía)

Principio: cada dimensión cita su fuente real; si una dimensión no tiene datos suficientes, se excluye del cálculo (nunca penaliza) y se marca explícitamente "Datos insuficientes" en esa dimensión.

| Dimensión | Fuente real | Disponible hoy | Nota |
|---|---|---|---|
| **RECENCY** | `MAX(occurredAt)` entre `event_attendance`, `commerceTransactions`, `consumptionQrCodes.redeemedAt`, `token_ledger.createdAt` | Parcial (falta función agregadora cross-fuente) | **No** usar `lastSignedIn` todavía — no se selecciona ni es histórico fiable |
| **FREQUENCY** | Conteo de eventos de actividad (attendance + consumo + compras nativas) en una ventana (p.ej. 90 días) | Parcial | Requiere las mismas funciones nuevas que Activity Timeline (§4) |
| **EVENTS** | `ticketOrders`/`eventTickets` (compra) + `event_attendance` (asistencia) | Parcial | Documentar sesgo: solo compra nativa es visible como "compra" |
| **COMMERCE** | `commerceTransactions` + `consumptionQrCodes` | Parcial (falta función por usuario en commerce) | — |
| **LOYALTY** | `token_wallets`/`token_ledger` (earn/spend) + `userBenefits` (used) | Sí, ya disponible | Dimensión más madura hoy |
| **ENGAGEMENT** | únicamente `notifications.readAt/clickedAt` (in-app) | Muy parcial | **No** incluir open/click rate de email — no existe, sería fabricar dato |

**Normalización propuesta:** cada dimensión disponible se normaliza 0-100 (min-max o percentil dentro de la comunidad del estudiante, evita comparar entre comunidades de tamaño distinto). El SegoScore final es la media ponderada **solo de las dimensiones con datos suficientes** — si menos de N dimensiones (a decidir, ej. 3 de 6) tienen datos, el score completo se marca "Datos insuficientes" en vez de calcularse con supuestos.

**Pesos:** deliberadamente NO fijados en este documento — el propio mandato del usuario pide determinarlos **después** de ver datos reales de la comunidad piloto, no a priori.

**No implementar aún** — este documento es la propuesta de fórmula, no el código.

---

## 4. DISEÑO TIMELINE — fuentes, sin duplicar datos

| SOURCE | NORMALIZED TYPE | QUERY (a crear/reusar) | Paginable | Índice necesario |
|---|---|---|---|---|
| `ticketOrders` (por userId) | `ticket_purchase` | Reuse `listMyOrders(userId)` | Sí (createdAt+id) | `userId` (a confirmar/crear) |
| `eventTickets` (por userId) | `ticket_cancelled` / `ticket_refunded` (derivado de `status`) | Reuse `listMyTickets(userId)` | Sí | `userId` (a confirmar/crear) |
| `event_attendance` (por userId) | `event_attendance` | **Crear** `listAttendanceByUserId(userId)` | Sí (`occurredAt`) | `userId` (crear) |
| `commerceTransactions` (por userId) | `consumption_pos` | **Crear** `listCommerceTransactionsByUserId(userId)` | Sí (`occurredAt`) | `userId` (crear) |
| `consumptionQrCodes` (por redeemedByUserId) | `consumption_qr` | Reuse `listQrRedemptionsByUser(userId)` | Sí (`redeemedAt`) | ya filtrable |
| `token_ledger` (por userId) | `token_credit` / `token_debit` (por `direction`) | Reuse `listLedgerByUserId(userId)` | Sí (`createdAt`) | ya usado en producción |
| `userBenefits` (por userId) | `benefit_granted` / `benefit_used` / `benefit_cancelled` (derivado de `status`+timestamps) | Reuse `listGrantedBenefits({userId})` | Sí | ya filtrable |
| `studentNotes` (por studentProfileId) | `internal_note` (solo admin) | Reuse `listStudentNotes` | Sí | ya filtrable |
| `studentTagAssignments` | `tag_assigned` | Reuse `listStudentTags`/assignments | Sí | ya filtrable |
| `student_login_events` (futuro) | `login` | **Crear** (ver §G) | Sí | por diseño desde el inicio |
| Audit trail de status (futuro) | `admin_action` | Pendiente de §7 | Sí | por diseño desde el inicio |

**Decisión: NO crear una tabla materializada de actividad todavía.** Justificación: el volumen real actual es de piloto (unos pocos estudiantes reales), y el patrón ya usado en `crm.clients.getHistory` (fan-out de queries en paralelo por fuente + fusión y orden final) es suficiente y ya está probado en producción para un caso estructuralmente idéntico. Propuesta: cada fuente se consulta acotada (por rango de fecha o límite), se fusiona y ordena en el servicio (`students360.getActivity`), y se pagina sobre el array fusionado con un cursor sintético (`occurredAt`+`source`+`id`). Revisar esta decisión únicamente si el profiling real muestra un problema de latencia — no antes.

---

## 5. DISEÑO DE PERFORMANCE / QUERIES

**Contrato propuesto** (nombres tentativos, namespace `students360`):

- `students360.getSummary(studentProfileId)` — **una sola llamada** al abrir la ficha. Combina: perfil+comunidades+tags (reuse `buildStudentDetail`), snapshot de wallet (`getWalletByUserId`), conteos de benefits por estado (query agregada ligera), contador de notificaciones no leídas (`getUnreadCount`), y los últimos N eventos del timeline (acotado, no el histórico completo). Objetivo: responder las preguntas clave del resumen ejecutivo en una carga, no en 30-40 requests.
- Pestañas pesadas cargan **perezosamente** al abrirse, cada una con su propio procedure paginado: `getActivity(cursor,filters)`, `getEvents(cursor)`, `getConsumption(cursor)`, `getTokens(cursor)` (ya existe como `listLedger`), `getBenefits(cursor)` (ya existe como `listGrants`), `getEngagement(cursor)`.

**Índices a auditar/crear antes de Fase D** (ninguno de los 13 informes confirmó explícitamente su existencia — a verificar con `SHOW INDEX` real antes de escribir código, no asumir): `commerceTransactions.userId` (confirmado ausente), `eventAttendance.userId` (no confirmado, probable ausente dado que hoy solo se consulta por `eventId`), `ticketOrders.userId`, `eventTickets.userId` (no confirmados — las funciones existentes ya filtran por ellos en producción, así que probablemente sí exista un índice, pero debe confirmarse, no asumirse). Este es un punto de acción explícito para el inicio de Fase D, no una conclusión cerrada aquí.

**Evitar el error señalado explícitamente por el usuario:** ninguna capacidad de esta matriz requiere "una query monstruosa por estudiante" ejecutada en bucle — todas las agregaciones (Spend, Ranking, SegoScore) deben diseñarse como consultas agregadas server-side (`GROUP BY`, `SUM`), nunca como N llamadas por estudiante desde el listado.

---

## 6. STUDENTS LIST — evolución propuesta (sin programar aún)

Qué es **barato** de calcular hoy (candidatos a columna inmediata): Community (ya existe), Status (ya existe), University (ya existe), Tags (ya existe), Tokens balance (ya materializado en `token_wallets.balance`, un join simple).

Qué es **caro/no trivial** hoy (requiere diseño de agregación antes de añadirse como columna, no implementar a la ligera): Last Activity (requiere el mismo `MAX()` cross-fuente que Recency de SegoScore), Spend (requiere `SUM` cross-fuente de 3 tablas), Segment/Score (derivados de todo lo anterior). Recomendación: **paginación real + búsqueda con debounce + sorting server-side** primero (deuda técnica ya identificada, decisión #7), y añadir estas columnas caras **solo después** de tener las funciones de agregación de Activity/Spend ya construidas y perfiladas para la Fase D — no antes.

---

## 7. PROPUESTA DE AUDIT TRAIL

Evidencia resumida (detalle completo en §G):
- Para ajustes de SegoTokens: **ya resuelto**, `token_ledger` + `adjustManualTokens` (actor + reason + inmutable).
- Para grants/cancelaciones de Benefits: **ya resuelto**, `grantedByUserId`/`cancelledByUserId`/`cancellationReason` en `userBenefits`.
- Para tags/notas: **ya resuelto**, `assignedByUserId`/`authorUserId` ya existen.
- **Único gap real confirmado:** `updateStudentAdminFields` (cambio de `status`) no deja ningún rastro.

**Recomendación (sujeta a decisión final del usuario):** crear, en su momento, una tabla mínima `student_admin_actions` (no `crmActivityLog` extendido), porque:
1. `crmActivityLog` es semánticamente un log de CRM comercial (leads/quotes/reservations/invoices); mezclar acciones de dominio estudiante cruzaría la frontera que el propio repo respeta sin excepción en sus otros 4 logs de dominio (cada uno aislado).
2. `crmActivityLog.entityId` es un `int` genérico sin FK — ambigüedad real sobre si apuntaría a `users.id` o `student_profiles.id`, inconsistente con los 4 valores actuales (todos mutuamente "entidad CRM").
3. Una tabla dedicada permite columnas tipadas reales (`studentProfileId`, `actorUserId`, `action`, `beforeValue`, `afterValue`, `reason`, `occurredAt`) en vez de un JSON libre sin schema.
4. Dado que el gap real es pequeño (solo `status` hoy), la tabla nueva sería mínima — no una reconstrucción de infraestructura.

Contra: duplica parte de la infraestructura de paginación/permisos que `crm.ts` ya resolvió para `crmActivityLog`. **No se crea nada todavía** — esta es la propuesta con su justificación, a la espera de aprobación explícita antes de cualquier migración.

---

## 8. Confirmaciones explícitas de alcance

- **No se ha escrito código de UI.**
- **No se ha creado ninguna migración.**
- **No se ha tocado `drizzle/schema.ts`.**
- **No se ha tocado producción** (ni base de datos ni despliegue).
- **No hay merge a `main`.** Rama `feat/segolife-student-360`, sin commits nuevos hasta que este documento se apruebe.
- **No hay push.**
- Todo lo anterior es auditoría de solo lectura (13 subagentes de exploración) + diseño en documento — nada ejecutable.

---

## DETENIDO

Fin de la entrega solicitada. A la espera de tu revisión y decisiones (en particular: fórmula/pesos de SegoScore tras ver datos reales, aprobación del diseño de Timeline, aprobación de la propuesta de Audit Trail en §7) antes de iniciar cualquier Fase C/D de implementación.
