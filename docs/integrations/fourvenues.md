# Fourvenues — Integración (documentación oficial)

Fecha de consulta: 2026-08-08

Fuente: https://docs.fourvenues.com/ (+ índice completo https://docs.fourvenues.com/llms.txt)

Subpáginas consultadas directamente (contenido leído, no solo listado en el índice):

- `introduction/readme.md`
- Channel Manager: `introduction/overview`, `introduction/authentication`, `introduction/requirements`, `introduction/use-cases`, `introduction/what-can-i-do`
- Channel Manager webhooks: `webhooks/introduction/introduction`, `webhooks/introduction/authentication`, `webhooks/introduction/creating-a-webhook-endpoint`, `webhooks/introduction/webhook-event-object`, `webhooks/events/payment-success-event`, `webhooks/events/ticket-request-refund-event`
- Channel Manager recipes: `recipes/creating-a-checkout-process`, `recipes/listening-to-webhooks`
- Channel Manager API reference: `auth/get-auth-information`, `events/get-all-events`, `events/post-event-preregister`, `ticketrates/get-all-ticket-rates`, `tickets/create-ticket`, `tickets/refund-ticket`, `tickets/get-tickets`, `lists/create-list`, `payments/get-all-payments`, `organizations/get-all-organizations`, `locations/get-all-locations`, `discount-codes/post-discount-codes-tickets-validate`, `webhooks/create-a-new-webhook-endpoint`
- Integrations: `introduction/overview`, `introduction/authentication`, `introduction/requirements`, `introduction/use-cases`, `introduction/what-can-i-do`, `introduction/publishing-checklist`
- Integrations recipes: `recipes/checkin-tickets`, `recipes/datawarehouse`
- Integrations API reference: `events/get-events`, `tickets/put-ticket-checkin`, `tickets/get-tickets-check-in`, `tickets/get-tickets-rates`, `tickets/patch-tickets-supplement-product-quantity-used`, `passes/put-pass-checkin`, `bookings/post-bookings-walk-in`, `bookings/put-bookings-products`, `sales/get-sales`, `wallet-movement/get-wallet-movements`, `external-payments/get-external-payments`, `subscriptions/post-subscription`, `clients/get-clients`, `users/get-users`, `refunds/get-refunds`, `channels/get-channels`
- Reseller: `introduction/overview`, `introduction/authentication`, `api-reference/swap-reseller-ticket`, `api-reference/validate-reseller-barcode`

No consultadas en detalle en esta pasada (existen, quedan como UNKNOWN hasta revisarlas): resto de endpoints de `bookings` (disponibilidad, deposit, minimum-spend, zonas), `event-groups`, `list-rates`, `tip-rates`, `custom-taxes`, `invoicing`, v2 de passes/tickets, y los tres ficheros OpenAPI completos (`openapi/*.json`).

Nota metodológica: investigación hecha con WebFetch (HTML→Markdown vía modelo intermedio), no leyendo el HTML/OpenAPI crudo. Donde el propio fetch decía "no está en el contenido proporcionado" se marca UNKNOWN en vez de completarse.

---

## Autenticación

Fourvenues tiene **tres APIs separadas, cada una con su propia autenticación por API Key**:

### 1. Channel Manager API (marketplaces / operadores multi-venue)
- Credencial: API Key, solicitada desde "Settings > Developer Portal" del portal de organización.
- Header: `X-Api-Key: <apiKey>`
- Alcance: la key está asociada a un **"channel"** (la cuenta del propio marketplace/reseller, p. ej. Segolife), no a una organización o local individual. Un channel ve solo las organizaciones ("hosts") que le han añadido como partner.
- Provisión: **requiere aprobación manual de Fourvenues** — contactar `integrations@fourvenues.com`.
- Endpoint de verificación: `GET /auth` devuelve el channel y su lista de `hosts` (organizaciones partner).

### 2. Integrations API (para el propio local, no colaboradores)
- Credencial: API Key, vía "Settings > Developer Portal" de la organización del propio local.
- Header estándar (Auth v2): `X-Api-Key: <apiKey>`.
- **Hallazgo importante**: varios endpoints individuales (`put-ticket-checkin`, `post-bookings-walk-in`, `post-subscription`, `get-channels`, `get-tickets-rates`) documentan explícitamente DOS métodos de auth posibles: `integration_id`+`secret` ("Auth v1", aparentemente heredado) o `X-Api-Key` ("Auth v2"). No mencionado en la página general de autenticación — posible inconsistencia de documentación a verificar con credenciales reales.
- Provisión: igual, contactar `integrations@fourvenues.com`. Explícitamente **NO da acceso a locales de terceros** — solo a los locales de la propia cuenta.

### 3. Reseller API (reventa segura de entradas ya emitidas entre particulares)
- Credencial: API Key, "solo pueden ser creadas por el equipo de Fourvenues".
- Header: `Authorization` (distinto de las otras dos).
- No parece apto para el caso de uso principal de Segolife (venta primaria en nombre de los locales) — eso corresponde a Channel Manager.

**En las tres**: las keys "tienen un tiempo de vida limitado y pueden ser revocadas si se hace mal uso", scoped a los endpoints concretos solicitados en la aprobación.

UNKNOWN: expiración/rotación exacta, si Reseller comparte rate limits con las otras dos.

## ⚠️ Tensión con el requisito "credenciales independientes por venue" — RESUELTO

El spec de este proyecto asume que cada local (Casanova, Tía Felisa,
Limoncello) tendrá **credenciales Fourvenues completamente independientes**.
La documentación oficial confirma que el modelo real de **Channel Manager**
(la vía principal para que Segolife venda en nombre de varios locales) es
**UNA sola API key de "channel" que ve N "hosts"** (`GET /auth` →
`channel.hosts[]`) — no una key por local.

**Confirmado empíricamente 2026-08-12**: los tres locales reales (Casanova,
Tía Felisa, Limoncello) entregaron cada uno su propia API key con prefijo
`ik_live_...`, que autentica contra `https://api.fourvenues.com/integrations`
(no contra `channels-service.fourvenues.com`). Es decir, **el modelo real es
Integrations API, no Channel Manager** — cada local es su propia
organización Fourvenues con su propia key, exactamente la "alternativa real"
que este documento dejaba como hipótesis. Ver `fourvenuesIntegrationsAdapter.ts`,
construido específicamente contra este modelo. El adapter `fourvenuesAdapter.ts`
original (Channel Manager) se mantiene en el código por si algún día Segolife
opera como marketplace agregador de terceros, pero **no es el que corresponde
a las credenciales reales actuales**.

## Entornos

Confirmado con URLs base explícitas para Channel Manager e Integrations:

| API | Alpha / test | Producción |
|---|---|---|
| Channel Manager | `https://channels-service-alpha.fourvenues.com` | `https://channels-service.fourvenues.com` |
| Integrations | `https://api-alpha.fourvenues.com/integrations` | `https://api.fourvenues.com/integrations` |
| Reseller | `https://api-alpha.fourvenues.com` | `https://api.fourvenues.com` (paths bajo `/resellers/...`) |

Alpha = "datos de prueba únicamente", "aislado, sin pagos reales". Recomendación oficial: validar la integración completa (incl. webhooks) en alpha antes de producción. HTTPS obligatorio. No se documenta ningún otro entorno.

## Endpoints relevantes

### Eventos
- Channel Manager: `GET /events` (filtros `organization_id`, `start_date`, `end_date`, `populate`, `search`, `location_id`, geo, `limit`/`offset`); `GET /events/{id}`; por slug; `POST /events/{id}/preregister`.
- Integrations: `GET /events/` (filtros `start`/`end`); `GET /events/{id}`. Campos: `_id`, `slug`, `url`, fechas unix, `name`, `description`, `flyer`, `music_genres`, `outfit`, `age`, `location_town`, `active`, `visible`, `artists`.

### Tarifas / ticket types
- Channel Manager: `GET /ticket-rates?event_id=`, `GET /ticket-rates/{id}`, por slug, pricing con fees incluidos. `availability.sold`/`available`, `min`/`max` por compra.
- Integrations: `GET /tickets-rates/?event_id=` (solo lectura), modelo distinto orientado a "opciones" (`options[]` con `price`, `age`, `max_quantity`, `until`).
- Discount codes (solo Channel Manager): `POST /discount-codes/tickets/validate/{code}`.

### Compradores / participantes
- Ticket (Channel Manager `GET /tickets`): `full_name`, `email`, `phone`, `birthday`, `gender`, documento, `status` (processing/active/voided/filled_client/pending_payment), `qr_code`, `enter`, `entry_time`, `price`, `total_price`, `discount_amount`.
- Client (solo Integrations `GET /clients/`): perfil agregado del comprador (`total_bookings`, `total_tickets`, etc.) — no existe equivalente en Channel Manager.
- Lists/guest lists (Channel Manager `POST /lists`): `list_rate_id`, `qr_code` opcional, `full_name`, `email`, `for` (nº personas).
- Passes: mencionados, sin definición conceptual clara de cuándo un evento usa passes vs tickets — UNKNOWN.
- Users (Integrations `GET /users/`): sin campo de rol — UNKNOWN si son staff del local.

### Pagos
- Channel Manager `GET /payments`: `status`, `resource_type` (ticket/name-change/list/pass/plan/booking), `total`, `currency`, `paid_at`, `metadata` libre.
- Checkout confirmado end-to-end: `POST /tickets/checkout` → `payment_url` (hosted) → confirmación por webhook `payment.success`.
- `POST /tickets` (create-ticket): emite tickets **saltándose** la pasarela de Fourvenues — para cuando el canal usa su propia pasarela (relevante si Segolife usa Redsys propio en el futuro nativo).
- External payments (solo Integrations `GET /external-payments/`): pagos vinculados a recursos, con `method`, `client_id`.
- Wallet movements (solo Integrations `GET /wallet-movements/`): parece ser libro contable de la ORGANIZACIÓN (categorías payment-gateway/subscriptions/withdrawal/returns), **NO confirmado** como monedero prepago de cliente — UNKNOWN su relación con "consumiciones".

### Reembolsos
- Channel Manager `PUT /tickets/{id}/refund`: única API de las tres donde se puede DISPARAR un reembolso (parcial o total, múltiples veces).
- Integrations `GET /refunds/`: **estrictamente solo lectura** — confirmado explícitamente "No refund triggering". Nota: "Only using Fourvenues payments gateway" (reembolsos de pagos externos podrían no aparecer — UNKNOWN).
- Reseller: sin endpoint de reembolso.

### Check-in / asistencia
- **Channel Manager: explícitamente NO soporta check-in** — confirmado dos veces ("No check-in — venues handle this separately", "Cannot mark ticket/list entries as checked in"). Limitación arquitectónica clave: si Segolife vende vía Channel Manager, NO puede hacer check-in con esa misma API.
- Integrations API (solo del propio local dueño de la cuenta):
  - `GET /tickets/check-in/{ticketCode}` — valida si puede entrar, `{ success, ticket_id }`.
  - `PUT /tickets/{ticketId}/checkin` — body `{ enter, entry_date, quality }`; falla si ya fue usado.
  - `PUT /passes/{passId}/checkin` — análogo para passes.
  - Recipe oficial: polling de `GET /tickets/` cada 5 min (`created_at` como cursor) para precargar localmente, fallback a `GET /tickets/{id}` para compras de última hora, luego `PUT /checkin` — pensado para conectividad intermitente en puerta.

### Consumiciones / POS
Resultado de la investigación (esto es lo que el spec pedía verificar con certeza, no asumir):

- **No existe un endpoint genérico de venta de barra/POS walk-in** en ninguna de las tres APIs, hasta donde se pudo verificar.
- `GET /sales/` (Integrations) existe pero **su schema de respuesta está vacío/no documentado** — UNKNOWN qué representa "sale" exactamente.
- Lo más cercano documentado, y SOLO en Integrations API (nunca accesible al channel externo):
  - `PUT /bookings/{bookingId}/products` — actualiza productos de una reserva/mesa VIP (ej. "VIP Bottle 70cl") — sincroniza consumo de botella de mesa reservada, no venta nueva de barra.
  - `PATCH /tickets/supplement-product-quantity-used/{ticketId}` — consumo de un "supplement" ya vendido con el ticket.
- **Conclusión**: sin evidencia de POS genérico. Lo que existe está acoplado a una reserva/ticket ya existente y vive solo en Integrations API del propio local. `supportsConsumptions` queda como `false`/`unknown` según el modelo de acceso (Channel Manager vs Integrations) — nunca se asume soportado.

## Esquemas reales verificados (Integrations API, 2026-08-12)

Verificado con las tres API keys reales (`ik_live_...`) de Casanova, Tía
Felisa y Limoncello, mediante llamadas GET de solo lectura. Ningún dato de
cliente real se ha copiado a este repositorio — solo la FORMA de los campos.
Esto resuelve varios UNKNOWN de las secciones anteriores.

- `GET /events/?start=YYYY-MM-DD&end=YYYY-MM-DD` — **el filtro de fecha es
  obligatorio** (sin él, `400 {"error":"Date is empty"}`). Campos reales:
  `_id`, `name`, `slug`, `url`, `start`/`end`/`date` (unix segundos),
  `flyer` (URL de imagen), `description`.
- `GET /tickets-rates/?event_id=` — confirma el modelo por "opciones" ya
  documentado: `{ _id, slug, name, options: [{ _id, until, max_quantity,
  price, age, content, additional_info }] }`. **`price` viene en unidades
  enteras (euros), no en céntimos** — a diferencia de Channel Manager.
- `GET /tickets/?event_id=` — schema real mucho más rico de lo documentado
  públicamente: `_id`, `code`, `event_id`, `rate_id`, `status` (visto:
  `"activated"`), `name`, `email`, `phone`, `price`, `total_paid`,
  `total_fees`, `refunded` (0/1), `payment_id`, `sale_type`, `channel_id`,
  `created_at`/`updated_at`, `supplements[]` (perks incluidos en el ticket,
  con `product_quantity`/`product_quantity_used`), y — el hallazgo
  importante — **`enter` (0/1) y `entry_date` (unix) SÍ vienen en la
  respuesta bulk**, no hace falta `GET /tickets/check-in/{code}` por ticket
  para saber quién ha entrado. Esto resuelve a favor la pregunta abierta
  nº2 de este documento: el check-in SÍ es legible en bulk vía polling de
  `/tickets/`.
- **`orders` pasa de UNKNOWN a CONFIRMADO (derivado)**: no existe un
  endpoint nativo de "pedido", pero cada ticket trae `payment_id` +
  `total_paid` + `total_fees` + `refunded` — agrupar tickets por
  `payment_id` reconstruye el pedido con la misma fidelidad que
  `GET /payments` en Channel Manager. Implementado así en
  `fourvenuesIntegrationsAdapter.ts`, documentado como agregación propia
  (no un endpoint inventado).
- `consumptions` se mantiene sin implementar: `supplements[]` es un perk YA
  incluido en el ticket (p.ej. "1 copa"), no una venta de barra nueva —
  confirma la conclusión previa, no la contradice.

## Rate limits / fair use

Documentado consistentemente para Channel Manager e Integrations (no encontrado para Reseller):

- Máximo ~10 peticiones/segundo por API key (evitar más de eso).
- Ante `429`: backoff exponencial.
- Polling (Integrations): no más de 1 vez/minuto por endpoint; precarga de check-in recomendada cada 5 minutos.
- Webhooks (Channel Manager): el endpoint receptor debe responder en menos de 5 segundos.
- Sin cuotas diarias/mensuales documentadas — UNKNOWN si existen.

## Webhooks

**Solo Channel Manager tiene webhooks documentados.** Integrations API es solo lectura/polling.

- Registro: `POST /webhooks` `{ name, url }` → `{ _id, name, url, sign_secret }`. `GET /webhooks`, `DELETE /webhooks/{id}`.
- Selección de tipos de evento al crear el endpoint: **no documentada** (el body solo tiene `name`+`url`) — UNKNOWN si se reciben todos los tipos automáticamente.
- Firma: **HMAC-SHA256** sobre el payload stringificado, usando `sign_secret`. Header `X-Webhook-Signature` + `X-Webhook-Id`.
- Payload: `{ id, event, payload }`.
- Tipos de evento confirmados (solo 2): `payment.success` (`payment_id`, `resource_type`, `resource_ids[]`, `metadata`), `ticket.request_refund` (`qr_code`, `client_name`, `client_email`, `event_id`, `ticket_id`, `amount_to_refund`). UNKNOWN si existen más tipos no documentados.
- Reintentos: backoff exponencial + jitter, hasta 40 intentos antes de marcar fallido.
- Recomendación de seguridad oficial: rechazar con 403 si la firma no coincide; verificar sobre el string crudo antes de parsear JSON (cuidado con middlewares de body-parser).

## Capacidades confirmadas vs desconocidas

| Capacidad | Estado | Fuente |
|---|---|---|
| Listar eventos de locales partner | CONFIRMED | Channel Manager `GET /events` |
| Listar tarifas con precio/disponibilidad | CONFIRMED | Channel Manager `GET /ticket-rates` |
| Checkout con redirección a pago hosted | CONFIRMED | `POST /tickets/checkout` → `payment_url` |
| Emitir ticket con pasarela propia externa | CONFIRMED | `POST /tickets` |
| Reembolsar ticket vía Channel Manager | CONFIRMED | `PUT /tickets/{id}/refund` |
| Crear entrada en guest list | CONFIRMED | `POST /lists` |
| Webhooks payment.success / ticket.request_refund con HMAC | CONFIRMED | ver sección Webhooks |
| Check-in vía Channel Manager | **NOT SUPPORTED** | doc explícita, 2 citas independientes |
| Crear/editar eventos desde el channel | **NOT SUPPORTED** | "venue owners manage events through dashboard" |
| 1 API key ve múltiples locales partner (Channel Manager) | CONFIRMED | `channel.hosts[]` |
| Credenciales independientes por venue | **CONFIRMED — vía Integrations API**, ver sección "resuelto" arriba | 3 keys `ik_live_...` reales, 2026-08-12 |
| Check-in vía Integrations API (solo propio local) | CONFIRMED, no accesible al channel externo | `PUT /tickets/{id}/checkin` |
| Check-in legible en bulk (sin pedir ticket a ticket) | CONFIRMED | `GET /tickets/` trae `enter`+`entry_date` por ticket |
| "Pedido" reconstruible sin endpoint nativo | CONFIRMED (derivado) | agrupar `GET /tickets/` por `payment_id` |
| POS/venta de barra genérica | UNKNOWN, probablemente no existe | `GET /sales/` sin schema |
| Consumo de botella/mesa VIP | CONFIRMED, solo Integrations API | `PUT /bookings/{id}/products` |
| Monedero prepago de cliente | UNKNOWN, probablemente no es esto | `wallet-movements` parece contable |
| Sandbox aislado | CONFIRMED | entorno "alpha" |
| Reventa entre particulares | CONFIRMED (API separada) | Reseller |

## Multi-cuenta / credenciales por venue

Ver sección de tensión arriba. Resumen: Channel Manager = 1 key de channel ↔ N hosts partner. Integrations = 1 key por cuenta/organización propietaria (posiblemente 1 por local si cada local es su propia organización Fourvenues — UNKNOWN sin confirmar en onboarding real). Jerarquía confirmada: Organization → Location (`location_id`) → Event → Ticket Rate/List Rate → Ticket/List entry.

## Preguntas abiertas / limitaciones

1. Qué es realmente `GET /sales/` (schema vacío en la doc pública).
2. Si un ticket vendido vía Channel Manager aparece automáticamente en el check-in del local (inferencia razonable, no confirmada explícitamente).
3. Discrepancia Auth v1 (`integration_id`+`secret`) vs Auth v2 (`X-Api-Key`) en Integrations — cuál usar, si v1 está deprecado.
4. Si existen más tipos de webhook no listados públicamente.
5. Si se puede filtrar por tipo de evento al crear un webhook.
6. Rate limits exactos por día/mes/plan — solo hay límite de ráfaga documentado.
7. Relación entre Integrations API del local y Channel Manager de Segolife si ambas conviven sobre el mismo local — no documentado.
8. Diferencia conceptual exacta "ticket" vs "pass".
9. Alcance real de "wallet-movements" (¿cashless de cliente o contable de organización?).
10. Reseller API — no parece apto para el caso de uso principal de Segolife.
11. Tiempos/SLA reales de aprobación de la solicitud a `integrations@fourvenues.com` — no documentado.
12. Especificaciones OpenAPI completas no revisadas íntegramente en esta pasada — recomendable antes de implementar el adapter final.
13. Endpoints de `bookings` (disponibilidad/deposit/minimum-spend/zonas) no revisados en detalle.
