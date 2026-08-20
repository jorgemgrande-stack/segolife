# SEGOLIFE — Fase 19: Commercial Activation & Go-Live

Verificado 2026-08-18. Continuación directa de PRE-16 → Fase 16 → Fase 17
→ Fase 18 (clasificación de partida: READY FOR GO-LIVE WITH EXTERNAL
DEPENDENCIES). Esta fase es de activación comercial, no una auditoría
técnica nueva — se apoya en lectura de código real y consultas de solo
lectura contra producción; no se ha creado ninguna venta, ticket, gasto de
SegoTokens, check-in ni dato comercial ficticio.

Documentos complementarios de esta fase: `docs/GO_LIVE_CONTROL_BOARD.md`
(cuadro de lanzamiento + matrices) y
`docs/PAYMENT_PROVIDER_ACTIVATION_CHECKLIST.md`.

> **Nota 2026-08-20**: las cifras de esta fase ("3/3 integraciones
> Fourvenues") reflejan el estado en su fecha de verificación. Desde
> entonces se dio de alta una 4ª integración (La Finca Club, pendiente de
> activar) — estado real y actualizado siempre en
> `docs/GO_LIVE_CONTROL_BOARD.md`, nunca en este snapshot histórico.

---

## 19A — SegoTokens Commercial Activation

**Cambio material respecto a Fase 16/18:** el hallazgo previo de "0/7
venues con política de canje activa" ha quedado desactualizado. Existe
ahora **1 política de canje activa y global** (`SEGOLIFE Economy V1 —
Global`, id 1, creada 2026-08-15 por la cuenta de Administrador real):
100 SegoTokens = €1,00, hasta el 100% de una compra pagable en ST, pago
100% ST permitido explícitamente. Por resolución de "más específico gana"
del motor (evento > venue > comunidad > global), esta política global se
aplica hoy a los 7 venues por igual, al no existir ninguna política más
específica.

El motor de ganancia (earn) está activo globalmente: 9 reglas reales,
todas activas, todas de alcance global — asistencia a evento (100 ST
fijos), consumo en venue (3 ST/€), compra de entrada (5 ST/€), 4 reglas de
recurrencia (3ª/5ª/10ª acción del mes, descubrir otro venue), y 2 reglas
de participación en Comunity. El interruptor de negocio por venue
(`venue_integrations.loyaltyEnabled`) está en `true` para los 3 venues con
Fourvenues conectado (Casanova, Limoncello, Tía Felisa) — es decir, la
asistencia real sincronizada desde Fourvenues en esos 3 venues ya concede
SegoTokens reales hoy. Ningún venue tiene horario restringido (0 filas en
`venue_token_schedules` — comportamiento correcto por diseño: sin filas,
sin restricción).

Mecanismo verificado seguro (por lectura de código, sin ejecutar nada
real): reserva con caducidad de 15 minutos, captura solo tras confirmación
del Student, liberación inmediata en rechazo/cancelación, caducidad
automática sin cron, reversión real de ledger disponible y auditada
(`reverseTransaction`, exige motivo).

**Balance real:** 5 wallets en producción, saldo combinado 130 ST. No se
ha creado ni modificado ningún saldo en esta auditoría.

**Matriz completa de los 7 venues:** ver `docs/GO_LIVE_CONTROL_BOARD.md`.

**Decisiones comerciales pendientes (documentadas, no bloquean el resto de
la fase):**
- Si se desea diferenciar condiciones de canje por venue (en vez de la
  única política global actual), hace falta crear una fila de política
  específica por venue desde `/admin/tokens/redemption`.
- Verificar (vía el Simulador de `/admin/tokens/economy`, sin venta real)
  que el origen "Consumo en venue" se dispara correctamente para los 4
  venues sin Fourvenues.

## 19B — Benefits Commercial Activation

**Hallazgo urgente — ver detalle completo en
`docs/GO_LIVE_CONTROL_BOARD.md`.** Resumen: de 3 `benefit_definitions` en
producción, 2 son datos históricos de simulación explícitamente marcados
como tales (`isMarketplaceEnabled=false`, correctamente ocultos del
marketplace real) y 1 es el único Beneficio con intención comercial real
("Bienvenida nuevo estudiante", destino Tía Felisa, coste 5 ST) —
incompleto (sin descuento/producto real asignado), con la ventana de
compra ya caducada (terminó 2026-08-17) y **ya comprado por 2 Students
reales con SegoTokens reales**, más una concesión automática adicional al
registrarse un tercer Student. Este es el hallazgo que más urgencia
comercial requiere de toda la Fase 19.

**Plantilla de activación** (campos reales del formulario de
`/admin/benefits`, pestaña Definiciones), para que negocio complete un
Beneficio real nuevo:

| Campo | Dónde se define |
|---|---|
| Nombre interno / Slug | Definiciones |
| Tipo de beneficio | Definiciones |
| Venue destino / Evento destino | Definiciones |
| Tipo y valor de descuento (si aplica) | Definiciones |
| Comunidades permitidas (vacío = todas) | Definiciones |
| Canjeable con SegoTokens + coste en ST | Definiciones |
| Validez tras canje (días) | Definiciones |
| Stock total / Límite por Student | Definiciones |
| Ventana de venta (desde/hasta) | Definiciones |
| Nombre/Descripción/Términos en EN y ES | Definiciones |
| Activa | Interruptor en la lista |

**Hueco real del formulario detectado en esta fase:** el campo
`productId` (qué producto físico concreto otorga un Beneficio de tipo
"producto gratis") existe en el esquema y lo usa la lógica de redención
para descontar stock, pero **no tiene ningún campo en el formulario de
Administración** — hoy no hay forma de vincular un Beneficio de "producto
gratis" a un producto real de stock desde la interfaz. Es una limitación
técnica real, no una decisión comercial — documentada, no corregida en
esta fase por no ser un bug con reproducción clara ni estar bloqueando
nada operativo hoy.

**Recordatorio importante:** cancelar un Beneficio ya concedido **no
reembolsa** los SegoTokens gastados — comportamiento confirmado, sin
cambios, y documentado como decisión de producto deliberada (no un bug).

## 19C — Venue Go-Live

Verificado por consulta directa de producción (cuenta, staff, catálogo,
Fourvenues) para los 7 venues reales. Matriz completa y hallazgo (Selfish
Poke y Tanker Events con 0 productos en su catálogo TPV) en
`docs/GO_LIVE_CONTROL_BOARD.md`. Ningún dato de venta, caja o stock se ha
creado ni alterado.

Resumen: **5/7 venues en READY** (Casanova, Chin Chin, La Finca Club,
Limoncello, Tía Felisa) — cuenta, RBAC, logo/portada, catálogo real y
(donde aplica) Fourvenues, todo verificado en orden. **2/7 en
CONFIGURATION REQUIRED** (Selfish Poke, Tanker Events) — la cuenta y el
acceso funcionan correctamente, pero su TPV no tiene ningún producto
cargado; no se ha inventado ningún catálogo para ellos, por instrucción
explícita de no fabricar datos comerciales.

## 19D — Student Go-Live

No se ha vuelto a ejecutar la suite de QA de navegador completa (ya
cerrada y verificada en PRE-16.17A) — esta fase reutiliza esos resultados,
que siguen vigentes: registro, login, aislamiento de comunidad,
navegación de la app (Home/Explorar/Comunidad/Entradas/Escanear/Rewards/
Perfil), idioma inicial correcto por comunidad (IE=inglés, UVA=español,
cambiable desde el perfil), y el carácter universal del wallet y del QR de
identidad (mismo token exacto entre el QR visual y el campo manual del
POS) — todo confirmado en su momento, sin regresión detectada desde
entonces (baseline de tests sin cambios). No se ha fabricado actividad
económica nueva para esta fase.

## 19E — Communication Go-Live

Brevo (`BREVO_API_KEY`/`BREVO_WEBHOOK_TOKEN`) configurado en producción,
confirmado de nuevo en esta fase. Infraestructura técnicamente completa:
routing de remitente por categoría a 6 direcciones reales `@segolife.es`
(con guarda activa contra branding heredado), ~30 plantillas bilingües
versionadas en código (EN para IE, ES para UVA, resuelto sin ifs de
comunidad), motor de audiencia con vista previa de solo recuento (nunca
expone PII), pipeline de entrega con reintentos idempotentes (máx. 3
intentos), webhook de Brevo activo y verificado con comparación de tiempo
constante, lista de supresión automática ante rebote duro/bloqueo/spam.

**Existe un mecanismo de envío de prueba real y seguro**
(`/admin/engagement/templates` → plantilla → "Enviar prueba", con
confirmación en dos pasos, a una dirección que teclea el propio
Administrador) — exactamente lo que esta fase permite ejecutar como test
controlado. **No se ha podido ejecutar** porque requiere una sesión real
de Administrador, que esta auditoría nunca fabrica ni resetea — queda
como **MANUAL REQUIRED**, no como fallo técnico.

VAPI y GHL/WhatsApp: confirmados de nuevo como código heredado de Náyade
sin ninguna credencial configurada, sin tráfico real, ocultos del menú —
correctamente fuera del alcance del núcleo comercial de SEGOLIFE, no se
tratan como bloqueo.

## 19F — Payment Provider Readiness

Ver `docs/PAYMENT_PROVIDER_ACTIVATION_CHECKLIST.md` para el detalle
completo. Resumen ejecutivo: existe una abstracción de proveedor de pago
propia de SEGOLIFE, completamente aislada del Redsys heredado de Náyade,
lista para recibir una implementación real (Stripe, un Redsys propio de
SEGOLIFE, u otro) sin tener que rediseñar nada. El webhook de pago ya
existe y está montado (`POST /api/ticket-payments/webhook`), a la espera
de una implementación real de verificación de firma. El reembolso, el
pago mixto (ST + dinero) y el pago 100% en SegoTokens ya están
completamente implementados y probados — de hecho, **una compra puede
completarse hoy sin ningún proveedor de pago configurado, siempre que se
pague al 100% con SegoTokens**, porque el código nunca llama al proveedor
cuando el importe en dinero real es cero.

No se ha elegido proveedor, no se han creado credenciales, no se ha
conectado nada — por ser una decisión comercial y de credenciales externa,
explícitamente fuera del alcance de esta fase.

## 19G — Operational Launch Control

Ver `docs/GO_LIVE_CONTROL_BOARD.md` para el cuadro completo (18 filas,
clasificación GREEN/AMBER/RED/EXTERNAL). Resumen: **14 GREEN, 2 AMBER
(Selfish Poke, Tanker Events, Brevo — 3 filas AMBER en total), 1 RED
(Benefits), 1 EXTERNAL (Payment Provider)**.

## 19H — Go-Live Report

Ver sección de respuestas obligatorias y clasificación final más abajo.

---

## Respuestas obligatorias

1. **¿Está SEGOLIFE técnicamente lista?** Sí — infraestructura estable,
   baseline de tests sin regresión, arquitectura de pagos/SegoTokens/
   Benefits completa y correctamente aislada por capas.
2. **¿Está comercialmente lista?** Parcialmente — sí para SegoTokens
   (activo, global) y para 5/7 venues; no todavía para Benefits (hallazgo
   urgente) ni para 2/7 venues (catálogo vacío) ni para pago con dinero
   real (proveedor externo pendiente).
3. **¿Qué puede utilizarse HOY?** TPV en efectivo en 5 venues, venta
   externa de entradas vía Fourvenues en 3 venues, acumulación y gasto de
   SegoTokens en cualquier venue (política global activa), compra de
   entradas 100% pagadas con SegoTokens, RRHH/Portal del Empleado,
   Communication Center (salvo el test real pendiente).
4. **¿Qué no puede utilizarse HOY?** TPV real en Selfish Poke/Tanker
   Events (sin catálogo), compra de entradas con dinero real o mixto
   (sin proveedor de pago), el Beneficio de bienvenida (incompleto y
   caducado).
5. **¿Qué venues están preparados?** Casanova, Chin Chin, La Finca Club,
   Limoncello, Tía Felisa (5/7).
6. **¿Qué venues requieren configuración?** Selfish Poke y Tanker Events —
   cargar su catálogo real de productos.
7. **¿Está IE preparada?** Sí, verificado end-to-end en PRE-16.17A, sin
   regresión desde entonces.
8. **¿Está UVA preparada?** Sí, mismo criterio que IE.
9. **¿Está SegoTokens earning preparado?** Sí, técnica y comercialmente —
   9 reglas globales activas.
10. **¿Está SegoTokens spending preparado técnicamente?** Sí — mecanismo
    completo de reserva/autorización/rechazo/caducidad/reversión.
11. **¿Está activado comercialmente?** Sí — política global activa desde
    2026-08-15, aplicable hoy a los 7 venues.
12. **¿Qué falta para activarlo del todo?** Nada bloqueante; opcional:
    diferenciar condiciones por venue con políticas específicas.
13. **¿Benefits está técnicamente preparado?** Sí, el motor completo
    (definiciones, reglas automáticas, marketplace, canje por QR,
    auditoría de intentos) funciona.
14. **¿Qué falta comercialmente?** Completar o retirar el único Beneficio
    real existente (incompleto y caducado, ya comprado por Students
    reales) y, si se desea, cargar Beneficios comerciales nuevos reales.
15. **¿Fourvenues está operativo?** Sí, 3/3 integraciones configuradas
    funcionando.
16. **¿Brevo está operativo?** Técnicamente sí; falta un envío de prueba
    real end-to-end (MANUAL REQUIRED, necesita sesión de Administrador).
17. **¿Qué bloquea PAYMENT_PROVIDER?** Una decisión comercial de
    proveedor y sus credenciales — no hay ningún impedimento técnico, la
    abstracción ya está lista (ver checklist dedicado).
18. **¿El pago 100% ST puede funcionar sin gateway?** Sí, confirmado por
    código — hoy mismo, sin ningún proveedor configurado.
19. **¿Qué acciones requieren decisión humana?** Completar/retirar el
    Beneficio de bienvenida (urgente); cargar catálogo de Selfish Poke y
    Tanker Events; elegir proveedor de pago; decidir si diferenciar
    política de SegoTokens por venue; ejecutar el envío de prueba real de
    Brevo.
20. **¿Cuál es la clasificación FINAL de GO-LIVE?** Ver abajo.

## Clasificación final

# LISTA PARA ACTIVACIÓN COMERCIAL — CON UNA ACCIÓN URGENTE PENDIENTE

SEGOLIFE puede operar comercialmente hoy en su mayor parte: SegoTokens
está activo de verdad (no solo listo técnicamente), 5 de 7 venues están
completamente preparados, y una compra de entrada puede completarse al
100% incluso sin proveedor de pago si se paga en SegoTokens. Esto es una
mejora real sobre la clasificación de Fase 18 (`READY FOR GO-LIVE WITH
EXTERNAL DEPENDENCIES`), no un retroceso.

No se marca como plenamente lista sin matices por un motivo concreto y
accionable: **el único Beneficio real de la plataforma está incompleto,
caducado, y ya ha sido pagado por Students reales con SegoTokens reales**
— esto necesita resolución comercial urgente, no técnica. A eso se suman,
sin la misma urgencia: 2 venues sin catálogo cargado, el proveedor de pago
externo pendiente (ya conocido desde Fase 18), y un envío de prueba real
de Brevo todavía sin ejecutar.

---

**FIN DE FASE 19. No se inicia Fase 20.**
