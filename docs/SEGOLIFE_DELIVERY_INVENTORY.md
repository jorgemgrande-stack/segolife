# SEGOLIFE — Delivery Inventory (Phase 16)

> Fuente técnica para la Fase 17 (manual de cliente). Generado a partir de una auditoría completa de producción (8 workstreams paralelos + verificación directa contra la base de datos y configuración reales) el 2026-08-16. **No es el manual de cliente** — es el inventario técnico del que ese manual debe derivarse, para no documentar nunca una capacidad que no existe realmente.

Convención de esta tabla: **Estado producción** refleja lo verificado contra la BD/entorno real de Railway el 2026-08-16, no lo que el código "debería" hacer en teoría.

---

## PUBLIC (sin sesión)

| Módulo | Ruta | Rol | Propósito | Fuente de datos | Escritura | Estado producción |
|---|---|---|---|---|---|---|
| Master Home | `/` | Anónimo | Marca neutra SEGOLIFE + selector de comunidades | `communities.list`, `gallery.getItems` | No | LISTO |
| Landing de comunidad | `/ie`, `/uva` (`/:community`, sin sesión) | Anónimo | Landing pública filtrada por comunidad, CTA registro/login | `events.publicActive`, `venues.publicActive` (filtrados por `communityId`) | No | LISTO |
| Explorar | `/:community/explore` | Anónimo o Student | Listado de eventos/locales de la comunidad | `events.publicActive`, `venues.publicActive` | No | LISTO |
| Detalle de evento | `/:community/events/:slug` | Anónimo o Student | Ficha de evento, CTA de compra | `events.publicGetBySlug` (scoping por comunidad reforzado Fase 15) | No (compra requiere sesión) | LISTO |
| Detalle de local | `/:community/venues/:slug` | Anónimo o Student | Ficha de local | `venues.publicGetBySlug` | No | LISTO |
| Login | `/login` | Anónimo | Email+contraseña, `returnTo` seguro | REST `/api/auth/login` | Sí (sesión) | LISTO |
| Registro | `/register` | Anónimo | Alta de Student, preselección de comunidad vía `?community=` | REST `/api/auth/register` → `registerStudent()` | Sí (usuario+perfil+membresía) | LISTO |
| Reset de contraseña | `/nueva-contrasena` | Anónimo | Reset con token de un solo uso | REST `/api/auth/forgot-password`, `/reset-password` | Sí | LISTO (bug de email sin botón corregido en esta fase) |

## STUDENT (sesión requerida salvo lo ya listado como público)

| Módulo | Ruta | Propósito | Fuente de datos | Escritura | Estado producción |
|---|---|---|---|---|---|
| Home personalizada | `/:community` (con sesión) | "Qué pasa para mí" — wallet, hero, tonight, actividad reciente | `home.getSummary` | No | LISTO |
| Universal QR / identidad | dentro de header/perfil | QR opaco de identidad, reusado para POS y check-in | `studentIdentityService` | No (rota token bajo demanda) | LISTO |
| Checkout de entrada | `/:community/checkout/:orderId` | Compra de entrada nativa | `ticketPurchase.startCheckout` | Sí (pedido, reserva de stock) | **BLOQUEADO para dinero real** — sin proveedor de pago configurado; solo 100% SegoTokens o pedidos gratuitos completan hoy |
| Mis entradas | `/:community/tickets`, `/:community/tickets/:id` | Historial de entradas propias | `ticketPurchase.listMyOrders/getMyTicketById` (IDOR verificado: solo las propias) | No | LISTO |
| Wallet / SegoTokens | `/:community/rewards` | Saldo, gasto, marketplace | `tokens.getMyWallet`, `tokens.listMyLedger` | Sí (gasto) | LISTO |
| Beneficios | `/:community/benefits`, `/:community/benefits/:id` | Beneficios activos, canje | `benefits.getMyBenefit` (IDOR verificado — NOT_FOUND si no es tuyo) | Sí (canje vía staff) | LISTO — canje de stock en `free_product` sigue siendo best-effort (aceptado, documentado) |
| Referidos / Invitar | dentro de Rewards | Código propio, tracking de conversión | `referrals.*` | Sí (atribución en registro) | LISTO — campaña real activa (+500/+250 ST), sin protección anti-fraude por IP/dispositivo (aceptado para MVP) |
| Comunity (encuestas/propuestas) | `/:community/comunity`, `/:community/comunity/:id` | Votar, proponer ideas, ver resultados | `community.*` | Sí (voto, propuesta) | LISTO — **i18n corregido en esta fase** (antes 100% español hardcodeado, rompía IE=inglés) |
| Perfil | `/:community/profile` | Datos personales, idioma, QR, logout | `students.me/updateProfile` | Sí | LISTO |
| Actividad | `/:community/activity` | Historial de ST/beneficios/eventos | `home.getSummary` (recentActivity) | No | LISTO |
| Notificaciones | `/:community/notifications`, `/:community/settings/notifications` | Bandeja + preferencias por canal | `studentNotifications.*` | Sí (preferencias) | LISTO — envío de email real activo desde esta fase (Brevo configurado) |
| Scan | `/:community/scan` | Escanear QR de consumición/beneficio | `consumptionQr`/`benefits.staffRedeem` (vista Student) | Sí | LISTO |

## VENUE (Venue Admin — rol `venue_admin`, scoping real vía `venue_staff`)

| Módulo | Ruta | Propósito | Fuente de datos | Escritura | Estado producción |
|---|---|---|---|---|---|
| Mi Local (shell) | `/admin/mi-local` | Contenedor de las 8 pestañas siguientes | — | — | Código LISTO — **0 usuarios reales con este rol hoy** (ver bloqueador) |
| Hoy / Actividad | pestañas internas | Resumen operativo del día del venue | `venueApp.today` | No | LISTO (una vez haya un Venue Admin real) |
| Escanear | pestaña interna | Check-in de entrada nativa + canje de beneficios | `staffCheckin.*`, `benefits.staffRedeem` | Sí | LISTO |
| TPV (POS) | pestaña interna | Venta de barra: catálogo, cesta, ST, pago mixto | `commerce.pos*` | Sí | LISTO — 165 productos reales sembrados en 5 venues |
| Entradas (puerta) | pestaña interna | Venta de entrada en puerta | `commerce.doorEntryTicketTypes/recordDoorSale` | Sí | LISTO |
| Caja | pestaña interna | Apertura/cierre de turno, stock, merma | `cash.*`, `stock.*` | Sí | LISTO — cash/card distinguidos en POS; puerta sigue sin distinguirlos (aceptado, sin datáfono) |
| Eventos del venue | pestaña interna | Eventos propios y sus métricas en vivo | `events.myVenueEvents` | No | LISTO |
| Venue (ficha) | pestaña interna | Datos del propio local, stats de beneficios | `venues.getMyVenueById` | No | LISTO |

**BLOQUEADOR REAL DE OPERACIÓN** (ver sección de bloqueadores del informe): `venue_staff` está vacío en producción — 0 filas. Ningún usuario real tiene hoy `role='venue_admin'` ni membresía de venue. Corregido en esta fase: el seed RBAC (`rbacSeed.ts`) ahora también aprovisiona el rol `venue_admin` con el bundle de permisos correcto (antes solo existía manualmente en BD, nunca en el script — un entorno nuevo se rompería igual). **Sigue pendiente, como decisión de negocio, dar de alta al primer Venue Admin real** (asignar `role='venue_admin'` + fila en `venue_staff` a la persona correcta de cada venue) — no se ha hecho unilateralmente en esta auditoría porque es una decisión operativa real, no un bug de código.

## GLOBAL ADMIN (rol `admin`)

| Módulo | Ruta | Propósito | Configurable sin código | Estado producción |
|---|---|---|---|---|
| Command Center | `/admin` (Dashboard) | Overview, alertas, BI de Students/Venues/Eventos/POS/SegoTokens/Beneficios/Referidos/Comunidad, funnels, retención, heatmaps, resumen ejecutivo determinista | — (solo lectura) | LISTO — corregido en esta fase: "ventas nativas" del resumen ejecutivo incluía Fourvenues sin decirlo, ahora etiquetado correctamente |
| Estudiantes | `/admin/students`, `/admin/students/:id`, `/historical`, `/referrals` | CRM de estudiantes, identidad histórica, referidos | Sí | LISTO |
| Locales | `/admin/venues`, `/admin/venues/:id` | Alta/edición de venues, config de SegoTokens por venue | Sí | LISTO |
| Eventos | `/admin/events`, `/new`, `/:id` | Alta/edición de eventos, tipos de entrada, canal de venta | Sí | LISTO — selector de comunidad dinámico, sin IDs hardcodeados |
| SegoTokens | `/admin/tokens`, `/economy`, `/rules`, `/campaigns`, `/redemption`, `/shadow` | Economy Control Center: reglas de ganancia/gasto, campañas, política de canje | Sí — **verificado en vivo**: 9 reglas activas, 1 política de canje (100 ST=€1), 1 campaña de referidos activa | LISTO |
| Beneficios | `/admin/benefits` | Definiciones y reglas de beneficios | Sí (definiciones) — **reglas de disparo automático NO tienen builder visible confirmado** (2 de 3 definiciones reales no tienen ninguna regla que las conceda) | PARCIAL — revisar caso de uso |
| Comunity | `/admin/comunity*` | Crear/moderar propuestas y preguntas | Sí | LISTO |
| Engagement / Comunicación | `/admin/engagement/*` | Campañas, plantillas, audiencias, log de envíos | Sí | LISTO para transaccional — **campañas manuales usan HTML sin escapar y sin enlace de baja** (hallazgo real, no corregido en esta fase por alcance) |
| Fiscal | `/admin/fiscal*` | Entidades comerciales, tipos de IVA, facturas | Sí (UI existe) | **BLOQUEADOR DE CONFIGURACIÓN** — 0 tipos de IVA, 0 entidades vendedoras configuradas en producción; VeriFactu no implementado |
| Liquidaciones | `/admin/settlements` | Cálculo de comisiones/liquidaciones por venue | Sí | Motor verificado correcto (tests); 0 acuerdos comerciales configurados (estado válido, no defecto) |
| Usuarios/roles | `/admin/users` (RBAC) | Alta de staff, asignación de rol | Sí | LISTO — bug de onboarding de Venue Admin corregido en esta fase |

## BACKGROUND / INTEGRATION

| Job/integración | Cadencia | Propósito | Estado producción |
|---|---|---|---|
| FourvenuesScheduler | cada minuto (tick), sync incremental cada 10 min, reconciliación cada 6h | Sincroniza eventos/entradas/pedidos/asistencia desde Fourvenues (polling, nunca validación en vivo) | ACTIVO — lock real por fila (`SELECT...FOR UPDATE`), a prueba de múltiples instancias |
| EngagementScheduler | cada minuto | Envío de campañas programadas y notificaciones pendientes | ACTIVO (`ENGAGEMENT_DELIVERY_ENABLED=true` en producción) — sin lock cross-instancia (riesgo latente, hoy real porque solo hay 1 instancia) |
| Brevo (email transaccional) | por evento | Envío real de emails (bienvenida, reset password, tickets, ST, beneficios...) | **ACTIVO desde esta fase** (`BREVO_API_KEY`/`SEGOLIFE_ENGAGEMENT_EMAIL_FROM`/`EMAIL_NOTIFICATIONS_ENABLED` confirmados configurados) |
| GHL/Vapi/WhatsApp | — | Integraciones heredadas de Náyade, sin credenciales en el entorno de Segolife | NO CONFIGURADO (legítimamente inactivo) |
| Proveedor de pago online | — | Pasarela real para checkout nativo con dinero | **NO CONFIGURADO** — bloqueador de go-live para venta de entradas de pago online |
| Proveedor IA/LLM | — | Interpretación IA para Command Center | NO CONFIGURADO — todo el "resumen ejecutivo" es determinista (if/then), nunca IA, y así se etiqueta en el propio panel |

---

## Notas para Fase 17

- **Nunca documentar** el proveedor de pago, VeriFactu, WhatsApp/GHL/Vapi, o "IA" como si estuvieran activos — no lo están.
- El check-in de entradas Fourvenues **no es en vivo** — es sincronización por sondeo (10 min / 6h). Explicarlo así al cliente evita expectativas equivocadas en la puerta.
- El "Venue Admin" como rol operativo existe en código y en RBAC, pero **no hay ningún usuario real dado de alta todavía** — esto es lo primero que hay que resolver operativamente antes de que cualquier venue pueda usar su TPV.
- Terminología cliente-segura pendiente de revisión editorial en Fase 17 (el código usa `communityId`, `idempotencyKey`, `sourceType`, etc. — nunca deben aparecer en el manual).

Ver el informe completo de Fase 16 (auditoría de producción, 2026-08-16) para el detalle de cada hallazgo, su clasificación y la matriz de bloqueadores de go-live.
