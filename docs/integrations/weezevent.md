# Weezevent — Integración (documentación oficial)

Fecha de consulta: 2026-08-08

Fuente: https://api.weezevent.com/ y https://help.weezevent.com/

Subpáginas consultadas:
- https://api.weezevent.com/ (referencia de la API)
- https://api.weezevent.com/doc/fair-use
- https://help.weezevent.com/en/articles/13399570-how-to-use-weezevent-s-api
- https://help.weezevent.com/en/articles/13407126-setting-up-a-check-in-list
- https://help.weezevent.com/en/articles/13407120-participation-reports
- https://help.weezevent.com/en/collections/17924287-weezaccess

Intentos fallidos/no concluyentes: `https://docapi.weezevent.com/` (SPA sin contenido accesible para la herramienta usada), `https://support.weezevent.com/en/scan-records` (bucle de redirecciones), `https://help.weezevent.com/article/611-how-to-use-weezevents-api` (404, artículo legado).

Nota de método: extracción vía WebFetch (HTML→texto vía modelo intermedio). Los fragmentos citados se contrastaron en más de una pasada cuando fue posible (el bloque `control_status` se confirmó idéntico en dos fetches independientes). Antes de fijar el diseño final del adapter, releer directamente en navegador `/doc/fair-use` y `docapi.weezevent.com`.

## Autenticación

Modelo de dos pasos:

1. **API key** (de cuenta/partner) — se obtiene en el back-office, *Tools > API KEY*.
2. **Access token** (de sesión) — `POST https://api.weezevent.com/auth/access_token` con `username`, `password`, `api_key` → devuelve `accessToken`. La doc indica que "un access token es persistente" — no hay que reenviar usuario/contraseña en cada llamada, basta `api_key` + `access_token`.

UNKNOWN: expiración/rotación/revocación del token; esquema tipo OAuth2 con scopes granulares (no documentado — el modelo descrito es API key + token plano).

## Entornos

- Solo se documenta `https://api.weezevent.com/` (producción). Ninguna mención de sandbox/staging en las páginas consultadas.
- `GET /scan/settings` devuelve un campo `test` (junto a `sync_interval`, `scan_device`, etc.) — probablemente un modo de prueba del dispositivo de escaneo (app WeezAccess), no un entorno API paralelo. UNKNOWN su alcance exacto.
- **Conclusión: no hay sandbox oficial documentado.** Pruebas de integración tendrían que hacerse contra un evento real (de prueba) en la cuenta de producción.

## Endpoints relevantes

### Autenticación
- `POST /auth/access_token` — `username`, `password`, `api_key` → `accessToken`.

### Eventos
- `GET /events` — filtros `include_not_published`, `include_closed`, `include_without_sales`. Devuelve id, name, dates, nº participantes, `multiple_dates`, `sales_status`.
- `GET /event/:id/details` — ficha completa: `last_update`, title, `site_url`, descripción, imagen, categoría, periodo, rango de precio, venue, coordenadas, organizador, periodo de venta.
- `GET /event/search` — búsqueda en el calendario del partner (incluye eventos fuera de la propia organización). Filtros `date`, `category`, `city`, `zip_code`, `country`, `organizer`, `max_result`.
- `GET`/`POST /event/categories` — **acceso público**, sin `api_key` ni `access_token`.

### Fechas / sesiones
- `GET /dates` — requiere `id_event`; opcional `display_passed`. Devuelve id, `id_event`, date, tickets asociados.

### Entradas (tickets)
- `GET /tickets` — tipos de entrada por evento (`id_event`), anidados en categorías. id, name, price, participants, quota, `start_sale`, `end_sale`.
- `GET /tickets/:id/stats` — **estadísticas AGREGADAS** de escaneo: `{"total": N, "scanned": N, "in": N, "out": N}`. Sin datos por participante.

### Participantes / compradores
- `GET /participant/list` — filtros extensos (`id_event`, `id_ticket`, `last_update`, `create_date_from`, `include_deleted`, `include_unpaid`, `page`, `max`...). Por participante: `id_participant`, `barcode`, `id_weez_ticket`, `refund` status, `create_date`, `origin`, `id_transaction`, `code_member`, `transaction_reference`, **`control_status`** (ver sección crítica), `promo_code`, `owner` (comprador).
- `GET /participant/:id/answers` — respuestas al formulario de inscripción; si no hay participante, devuelve respuestas del buyer.

No existe endpoint separado de "compradores" — sus datos van embebidos como `owner` dentro de `participant/list`.

### Acceso / control de acceso
- `GET /scan/settings`, `POST /scan/user` (config de apps de escaneo).
- `control_status` es un CAMPO embebido en cada participante, no un endpoint aparte.

**No se encontró ningún endpoint de escritura para crear ventas/pedidos** (checkout programático) — la API pública documentada es de solo lectura sobre eventos/tickets/participantes, más configuración de escaneo.

## Rate limits / fair use

Fuente: https://api.weezevent.com/doc/fair-use

- 5 intentos con credenciales inválidas → ban 30 min (HTTP 429).
- >600 requests/minuto → ban 30 min (HTTP 429).
- >10 intentos de autenticación/minuto → ban 1 min.
- Recomendaciones explícitas: guardar el access token en servidor, cachear en vez de re-consultar, filtrar con `last_update` en `participant/list` en vez de traer todo.
- Disclaimer: "estos límites pueden cambiar sin previo aviso" — sin SLA fijo.

## Webhooks

**No documentado — parece ser solo polling.** Búsqueda explícita de "webhook" sin resultados en `api.weezevent.com`; el artículo oficial de uso de la API tampoco lo menciona. Las únicas referencias a "webhook" encontradas son proyectos de terceros no oficiales que en realidad hacen polling por detrás (no cuentan como confirmación).

Conclusión práctica: enterarse de nuevas ventas/escaneos requiere **polling propio** (p. ej. `GET /participant/list` con `last_update`), respetando el fair-use de arriba. UNKNOWN si existe algún webhook no público bajo acuerdo de partner.

## Asistencia individual vs agregada — CRÍTICO

**Respuesta: ambas existen, en dos sitios distintos.**

**1. Agregado (CONFIRMED).** `GET /tickets/:id/stats`:
```json
"stats": { "total": 23, "scanned": 18, "in": 18, "out": 0 }
```
Sin identificador de participante ni timestamp individual.

**2. Individual (CONFIRMED, con un matiz sin confirmar).** Cada participante de `GET /participant/list` incluye:
```json
"control_status": {
    "status": "0",
    "scan_date": "0000-00-00 00:00:00",
    "scan_user": "0",
    "scan_user_name": ""
}
```
Por cada `id_participant` (ligado a `barcode`, `id_ticket`, `id_event`): si fue escaneado, CUÁNDO (`scan_date`) y QUIÉN (`scan_user`/`scan_user_name`). **Esto sí permite construir asistencia individual real.**

**Matiz sin confirmar (UNKNOWN):** la doc no aclara si `control_status` es solo el ÚLTIMO escaneo o agrega múltiples pasadas — la forma del JSON (singular) sugiere que es el último estado, pero es inferencia estructural, no confirmación textual.

**Corroboración desde el back-office (fuera de la API):** "Participation Reports" describe una exportación CSV con "el número de pasadas" por lista de control, y remite a un "Scan History Report" que "captura todos los horarios de check-in para una única entrada" — sugiere reentradas múltiples en el sistema, pero **no se confirmó si ese histórico completo está expuesto vía API** o solo vía exportación manual CSV.

UNKNOWN explícito:
- Si `control_status` vía API es solo el último escaneo o hay forma de pedir el histórico completo.
- Significado exacto de los valores de `status` (ejemplo `"0"`, sin leyenda documentada).
- Si el "Scan History Report" multi-pasada tiene equivalente en la API.

**Recomendación de diseño (no implementar todavía):** para asistencia individual básica (última entrada/salida), `GET /participant/list` + `control_status` es suficiente y está CONFIRMADO. Para reentradas múltiples (relevante en festivales tipo Tankers/Mambo), confirmar con Weezevent si hay vía API para el histórico completo, o si Segolife debe conformarse con exportación CSV manual para ese caso.

## Capacidades confirmadas vs desconocidas

| Capacidad | Estado | Fuente |
|---|---|---|
| Auth API key + access token | CONFIRMED | `POST /auth/access_token` |
| Listado de eventos | CONFIRMED | `GET /events` |
| Detalle de evento | CONFIRMED | `GET /event/:id/details` |
| Búsqueda de eventos del calendario partner | CONFIRMED | `GET /event/search` |
| Categorías de evento sin auth | CONFIRMED | `GET`/`POST /event/categories` |
| Fechas/sesiones multi-fecha | CONFIRMED | `GET /dates` |
| Tipos de entrada | CONFIRMED | `GET /tickets` |
| Stats agregadas de escaneo | CONFIRMED — solo agregado | `GET /tickets/:id/stats` |
| Lista de participantes con filtros | CONFIRMED | `GET /participant/list` |
| Respuestas de inscripción por participante | CONFIRMED | `GET /participant/:id/answers` |
| Datos del comprador embebidos (`owner`) | CONFIRMED | `GET /participant/list` |
| Check-in individual con timestamp y operador | CONFIRMED | `control_status` |
| Histórico de múltiples escaneos/reentradas vía API | UNKNOWN | solo inferible desde reportes de back-office |
| Significado de valores de `status` | UNKNOWN | sin leyenda documentada |
| Webhooks nativos | NOT SUPPORTED (no documentado) | sin resultados de búsqueda |
| Entorno sandbox/test | NOT SUPPORTED (no documentado) | solo se documenta 1 base URL |
| Rate limits explícitos | CONFIRMED | `/doc/fair-use` |
| Expiración de access token | UNKNOWN | no mencionado |
| Venta/creación de pedido programática | UNKNOWN / probablemente NOT SUPPORTED | sin endpoint de escritura de ventas encontrado |
| Exportación CSV manual (Participation Reports) | CONFIRMED, fuera de la API | help.weezevent.com |

## Preguntas abiertas / limitaciones

1. ¿`control_status` refleja solo el último escaneo o hay histórico completo vía API? No confirmado.
2. ¿Qué significa cada valor de `status`? Sin leyenda documentada.
3. ¿Existe checkout programático para vender Tankers/Mambo sin redirigir a Weezevent? No se encontró ningún endpoint de escritura de ventas.
4. ¿Hay webhooks reales bajo acuerdo de partner, no documentados públicamente? No se pudo confirmar ni descartar.
5. ¿Expira el `access_token`? No documentado.
6. ¿Existe un entorno de pruebas real? No documentado — recomendable preguntar al equipo de partners al dar de alta la cuenta.
7. Campo `test` en `GET /scan/settings` — qué controla exactamente. No documentado.
8. Los límites de rate-limit se extrajeron vía fetch automatizado — recomendable verificarlos en navegador antes de fijar el throttling del adapter.
9. No se pudo acceder a `docapi.weezevent.com/` (posible v2/v3 de la doc con capacidades adicionales) ni a las páginas sobre "Scan Records" — revisar manualmente antes de cerrar el diseño del adapter.
10. Límite máximo de paginación de `GET /participant/list` (`max`) — no confirmado.
11. Formato/zona horaria exacta de `scan_date` — no confirmado más allá del placeholder de ejemplo.

## Resumen operativo

API de solo lectura (eventos/fechas/tickets/participantes/respuestas + config de escaneo), sin sandbox y sin webhooks documentados (requiere polling propio respetando el fair-use: 600 req/min, bans por 429). Hallazgo clave: **sí hay asistencia individual confirmada** (`control_status` con `scan_date`/`scan_user`), no solo agregada — a diferencia de lo que el spec de este proyecto consideraba posible. Lo que queda UNKNOWN real es si ese campo guarda solo el último escaneo o el histórico completo de reentradas, y si existe algún endpoint de venta programática.
