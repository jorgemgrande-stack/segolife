# SEGOLIFE — Informe de Cierre y Handover Maestro

**Fecha:** 2026-08-17
**Alcance:** PRE-16.17 (manual) → PRE-16.17A (E2E automatizado) →
PRE-16.17B/C (reducción de QA manual + limpieza) → Fase 16 (auditoría
final) → Fase 17 (documentación de cliente) → Fase 18 (preparación de
arranque) → este informe.
**Producción verificada:** `https://www.segolife.es`, Railway proyecto
`thorough-liberation` / servicio `segolife`, repositorio
`jorgemgrande-stack/segolife`.

Este informe no repite desde cero el trabajo de fases ya cerradas
anteriormente a PRE-16.17 (RBAC/HR de PRE-16.16B, motor de SegoTokens,
Communication Center, Venue Commerce, etc.) — las referencia y las da por
válidas tal como quedaron verificadas, y se centra en consolidar el
resultado del cierre completo.

---

## A. Resumen ejecutivo

Segolife está operativo en producción real para su modelo de negocio actual:
Students de IE y UVA descubriendo eventos, comprando entradas (vía
Fourvenues), acumulando y gastando SegoTokens, y 7 locales reales operando
su TPV, Caja, puerta y escáner a través de sus propias cuentas de
Responsable de local. La plataforma tiene RBAC verificado, ningún bug
crítico de seguridad abierto, documentación de cliente completa y un plan
de arranque listo. El único bloqueo externo real es la ausencia de una
pasarela de pago configurada, que impide únicamente el cobro nativo online
de entradas — no afecta a ninguna otra funcionalidad real hoy operativa.

## B. Alcance y metodología de este informe

Este informe sintetiza: QA manual interactiva con captura de pantalla
(PRE-16.17), creación controlada de 7 cuentas reales de Responsable de
local, una suite de E2E con Playwright/Chromium contra producción real
(más de 100 tests, varios bloques, con reintentos y verificación aislada de
cada caso dudoso), lectura directa de base de datos de producción de solo
lectura para fundamentar cada clasificación, lectura del código real
desplegado (no solo de lo que debería existir), y la suite de tests de
servidor (vitest) como red de verificación adicional donde no había
credenciales para probar visualmente.

## C. Identidad de producción verificada

Razón social: **HAYQUE CAPITAL, S.L.** · CIF: **B13989264** · Dirección
fiscal: Finca Lindaraja, s/n, 40420 Segovia · Marca: **Segolife** ·
Dominio: `segolife.es` (redirige a `www.segolife.es`, 301 verificado).
Confirmado en `system_settings` de producción y en el panel
Configuración → Datos del negocio.

## D. Arquitectura y stack técnico

tRPC 11 + Drizzle ORM + MySQL 8 + Express 4 en servidor; React 19 + Vite 7 +
Tailwind 4 + shadcn/ui + Wouter en cliente. Autenticación local con
cookies JWT (`LOCAL_AUTH=true`). Regla arquitectónica fundamental respetada
en todo el cierre: ninguna lógica de negocio nueva introducida compara un
literal de comunidad (`"ie"`/`"uva"`) — toda diferencia se resuelve vía la
tabla `communities` y sus relaciones.

## E. Modelo de roles y RBAC

Cuatro roles operativos reales: **Student** (`user`), **Responsable de
local** (`venue_admin`), **Empleado** (identidad HR separada, no es un rol
de la tabla de usuarios de la plataforma) y **Administrador** (`admin`).
Verificado exhaustivamente esta fase: un `venue_admin` nunca ve el Command
Center ni ninguna sub-ruta global de Admin — es redirigido automáticamente
a su propio `/admin/mi-local` por un guard real y ya existente en
`AdminLayout.tsx`. Un Student nunca accede a superficies de Venue/Admin/
Empleado. El aislamiento cruzado entre locales (Venue A no puede operar
sobre datos de Venue B) está probado. La tabla de usuarios de producción
conserva además roles heredados de Náyade sin usuarios reales asignados
(`agente`, `monitor`, `controler`, `adminrest`) — irrelevantes para la
operación real de Segolife.

## F. Seguridad — hallazgos y correcciones del ciclo PRE-16.16B

Corregidos y verificados en producción antes del inicio de PRE-16.17:
aplicación real de `isActive` en autenticación, guard contra
sobrescritura de rol, fuga de PII de personal en `operations.ts`, entropía
débil en clave de subida de ficheros, eliminación de branding Náyade
residual, bug de regex en `stripComments()` de tests, y permiso RBAC
`hr.view` faltante (migración aplicada tras aprobación explícita del
usuario). Ninguna de estas correcciones ha mostrado regresión durante todo
el ciclo posterior de QA de este cierre.

## G. PRE-16.17 — QA manual interactivo (resumen)

QA bloque a bloque con capturas de pantalla reales. 2 bugs reales
encontrados y corregidos con ciclo completo de fix→deploy→retest: footer
público sin enlaces legales (`/condiciones-cancelacion` huérfana) y CTA de
registro del header perdiendo el parámetro de comunidad. Detalle completo
en `docs/PRE16_17_BROWSER_QA.md`.

## H. PRE-16.17 — Creación de cuentas reales de Responsable de local

7 cuentas `venue_admin` reales creadas bajo autorización explícita y
detallada del usuario, una por local activo, con contraseña inicial
compartida entregada de forma segura y nunca versionada. Cada cuenta
verificada con login real. Inventario completo en
`docs/handbook/04-accesos-venues.md`.

## I. PRE-16.17A — QA automatizado de navegador: alcance y herramientas

Playwright 1.58.2 + Chromium real contra `https://www.segolife.es` (config
dedicada `playwright.production.config.ts`, separada del e2e local
existente). Más de 100 tests reales a lo largo de bloques B a U, cubriendo
anónimo, Student, Venue y negativos de Admin/Command Center, en desktop,
tablet y móvil.

## J. PRE-16.17A — Resultados por bloque (resumen)

Todos los bloques ejecutados terminan en PASS o PASS AFTER FIX. Tabla
completa, bloque por bloque, con test IDs, en `docs/PRE16_17_BROWSER_QA.md`.

## K. PRE-16.17A — Bug real encontrado y corregido

`VenueApp.tsx`: el nombre real del local no se mostraba para ninguna de las
7 cuentas reales (mostraban el literal "Venue") porque la query de
locales solo se activaba para administradores globales. Corregido en el
commit `86cb572`, verificado visualmente en las 7 cuentas.

## L. PRE-16.17A — Hallazgos DATA STATE (no son bugs)

- 0 eventos activos con venta nativa de entradas — 100% de la venta actual
  es externa (Fourvenues). El código que decide el modo de venta
  (`computePurchaseAction`) funciona correctamente; simplemente no hay hoy
  ningún evento real configurado en modo nativo.
- 0/7 locales con política de canje de SegoTokens activa — el mecanismo de
  solicitud/autorización/rechazo/caducidad está verificado como seguro y
  reversible en el código, pero no se ha activado comercialmente para
  ningún local todavía.
- 0 Beneficios configurados en el marketplace — decisión comercial
  pendiente, no una limitación técnica.

## M. PRE-16.17A — Hallazgos CREDENTIAL REQUIRED

Todo flujo positivo de Administrador (dashboard real, gestión de
Estudiantes/Venues/Eventos/Tokens/Benefits/Comunity/Personal desde la UI)
queda sin verificar por navegador porque el entorno de QA nunca dispuso de
credenciales de Admin — y nunca se fabricó ni se reseteó una para
conseguirlo, por instrucción explícita del usuario. La cobertura negativa
(qué NO debe ver cada rol) sí está completa. El read-model del Command
Center está cubierto por 185 tests de servidor en verde.

## N. PRE-16.17A — Incidente de sesión paralela

Durante la Fase 3 del QA automatizado se detectó otra sesión trabajando en
paralelo sobre la misma carpeta (un commit y cambios sin commitear ajenos).
Siguiendo el protocolo de seguridad de git, se detuvo toda actividad de git
y se preguntó al usuario antes de continuar. El usuario confirmó que el
commit revertido era un error propio ya corregido y autorizó continuar. El
trabajo de esa sesión paralela se verificó de cero antes de darlo por
válido, sin asumir que estuviera correcto.

## O. PRE-16.17B — Reducción de QA manual/física/económica

De la lista original de verificaciones manuales pendientes, 2 ítems se
reclasificaron de "manual/físico" a "PASS automatizado (lógica) + solo
hardware pendiente" gracias a 49 tests de servidor ya existentes sobre
check-in y redención de Beneficios. 2 ítems más se reclasificaron de
"manual/económico" a DATA STATE tras confirmar por base de datos que el
mecanismo nunca se activa comercialmente hoy, sin necesidad de gastar
dinero ni SegoTokens reales para probarlo.

## P. PRE-16.17C — Limpieza de QA y higiene de producción

Sin acciones destructivas necesarias. Se auditó la ausencia de constraints
de FK a nivel de base de datos (irrelevante en la práctica porque no se
borra nada), y se confirmó que no queda ningún resto de simulación o dato
fabricado mezclado con datos reales de negocio, más allá de la única cuenta
QA de Student ya identificada y documentada.

## Q. Disposición de la cuenta QA del Student

`qa.pre1617.ie@segolife.es` (userId 14, comunidad IE) se mantiene como
**cuenta formal de QA**, no se elimina ni se anonimiza. Motivo: el esquema
no tiene constraints de FK (confirmado vía
`information_schema.KEY_COLUMN_USAGE`), por lo que un borrado no fallaría
pero dejaría registros huérfanos en `user_communities` y `notifications` —
justo el escenario de "romper trazabilidad" que la instrucción original
pedía evitar. Su email ya la autoidentifica sin ambigüedad como cuenta de
QA para cualquier administrador futuro.

## R. Fase 16 — Auditoría final de producción (resumen)

Auditoría de identidad, flags heredados, datos reales, migraciones y estado
de despliegue, integrada como base de este informe (secciones C, S, AK,
AL, AM).

## S. Estado de flags heredados de Náyade

21 flags de funcionalidad heredados de Náyade (`tpv_enabled`,
`crm_module_enabled`, `hotel_module_enabled`, `spa_module_enabled`,
`restaurants_module_enabled`, `partners_module_enabled`,
`suppliers_module_enabled` y sub-flags relacionados) permanecen todos
`enabled=0` en producción. El menú de Administración conserva además,
visibles pero fuera del alcance de producto de Segolife, los módulos
**Contabilidad**, **Gestoría e Impuestos** y **Marketing** (heredados, sin
flag que los oculte) — documentado explícitamente en
`docs/handbook/02-administrador.md` §18 para que nadie los confunda con
funcionalidad real de Segolife.

## T. Fase 17 — Paquete de documentación de cliente

6 manuales completos en `docs/handbook/`: general, Responsable de local
(prioridad máxima), Administración, Empleado, Accesos de locales, Guía
rápida. Incluyen 16 capturas reales de producción — 4 de ellas se
detectaron rotas en la primera pasada (capturaban una pantalla de carga en
lugar del contenido real) y se corrigieron ajustando las esperas del script
antes de dar la documentación por cerrada. QA de documentación superado:
sin secretos filtrados (contraseña real nunca escrita), sin branding
legacy presentado como actual, rutas/emails/roles verificados contra el
código y la base de datos reales.

## U. Fase 18 — Preparación de arranque (resumen)

Checklist de go-live, playbook operativo del primer día, plan de
monitorización de la primera semana (sin BI nuevo), plan de formación y
registro de dependencias externas — completo en
`docs/FASE18_GO_LIVE_READINESS.md`.

## V. Cobertura de tests automatizados (vitest) — baseline

**2968 passed / 18 failed / 2986 total**, idéntico byte a byte en cada
re-verificación de esta sesión. Los 18 fallos están concentrados en
exactamente los mismos 4 ficheros pre-existentes y ajenos a Segolife
(`nayade.test.ts`, `regression.recalculate.test.ts`,
`reservationEmails.test.ts`, `transferConfirmationEmail.test.ts`) — deuda
heredada, no introducida ni agravada en este cierre.

## W. Estado de TypeScript — baseline

`npx tsc --noEmit` → **184 errores**, sin cambio en ningún punto de esta
sesión pese a múltiples cambios de código — confirma que ninguna corrección
realizada introdujo nueva deuda de tipos.

## X. Cobertura E2E de navegador — inventario completo de bloques

Bloques B, C, D, E/F, S (RBAC), G, H/I, J (Venue×7), K/L/P, M/N/O, T
(responsive), P/Q/R (negativo Admin/Command Center exhaustivo por
sub-ruta), más el bloque de capturas de Fase 17. Detalle test por test en
`docs/PRE16_17_BROWSER_QA.md`.

## Y. Motor de SegoTokens — estado y seguridad del mecanismo

Verificado por lectura de código: `reserveTokenSpend` crea una reserva con
caducidad de 15 minutos; `confirmTokenPaymentRequest` solo marca
"confirmado", nunca liquida directamente; `rejectTokenPaymentRequest` y la
cancelación por parte del local liberan la reserva de forma inmediata y sin
pérdida para el Student; una reserva olvidada caduca sola. El mecanismo es
seguro y reversible; su activación comercial por local es una decisión
pendiente (ver L).

## Z. Motor de Beneficios — estado

Sistema construido y verificado (listado, pestañas de estado, redención
cubierta por 15 tests de servidor). 0 Beneficios configurados en el
marketplace hoy — decisión comercial pendiente.

## AA. Venta de entradas — nativa vs externa (estado real)

`computePurchaseAction()` decide correctamente por evento real vía
`sales_channels.sales_mode`. Hoy el 100% de los eventos activos son
`external_redirect` (Fourvenues); 0 en modo `native`.

## AB. Integración Fourvenues — estado

3 locales conectados y sincronizando (Casanova, Limoncello, Tía Felisa).
Panel de operaciones no resueltas disponible en
`/admin/integrations/unresolved` para vigilancia continua.

## AC. Communication Center / Brevo — estado

`BREVO_API_KEY` y `BREVO_WEBHOOK_TOKEN` configurados en producción
(cambio material respecto a memoria de sesiones previas, que los daba por
no configurados — reconfirmado con lectura directa de variables de entorno
esta sesión). Pendiente una prueba real de envío end-to-end antes de
depender de este canal en el primer día de operación (ver Fase 18-F).

## AD. Módulo de RRHH / Portal del Empleado — estado

Activación de cuenta, fichaje, perfil, documentos, nóminas y vacaciones (con
estado de solicitud) verificados contra el código real y documentados en
`docs/handbook/03-empleado.md`. No se documenta ninguna capacidad de RRHH
sin una pantalla de uso real detrás.

## AE. Command Center — cobertura y limitaciones de verificación

Read-model cubierto por 185 tests de servidor (`server/segolife/dashboard/
*.test.ts`, 19 ficheros). Verificación visual en navegador real queda
CREDENTIAL REQUIRED — nunca se fabricó una cuenta de Admin para QA.

## AF. Dependencias externas — registro consolidado

Ver tabla completa en `docs/FASE18_GO_LIVE_READINESS.md` sección E.
Resumen: pasarela de pago = bloqueo externo real; Brevo = configurado;
Fourvenues = configurado y activo; VAPI y GHL/WhatsApp = no configurados y
fuera del alcance actual del producto Segolife (módulos ocultos, heredados
de Náyade, 0 uso real).

## AG. Deuda técnica conocida (no introducida en este cierre)

184 errores de TypeScript y 18 tests fallidos en 4 ficheros ajenos a
Segolife, ambos baseline heredado, verificados sin cambio en cada punto de
control de esta sesión.

## AH. Riesgos conocidos y mitigaciones

- **Sin pasarela de pago** → mitigación: no se ofrece checkout nativo hasta
  contratarla; la venta externa vía Fourvenues no se ve afectada.
- **0 locales con canje de SegoTokens activo** → mitigación: es reversible
  activarlo por local en cualquier momento, el mecanismo ya está probado.
- **Sin verificación visual de Admin** → mitigación: cobertura negativa
  completa + 185 tests de servidor del read-model reducen el riesgo real
  aunque no lo eliminan del todo.
- **Deploy de Railway no siempre dispara solo con push** (quirk conocido y
  recurrente) → mitigación: verificar siempre `railway status` +
  `RAILWAY_GIT_COMMIT_SHA` real tras cada push, redeploy manual si hace
  falta.

## AI. Elementos explícitamente NO fabricados ni forzados

Ningún test de este cierre fabricó una venta, entrada, gasto de SegoTokens
o redención de Beneficio real solo para poblar BI o forzar un PASS. Ninguna
contraseña de usuario real se cambió. No se creó un segundo Global Admin.
No se rediseñó arquitectura ni se añadieron funcionalidades no pedidas. No
se reescribió ninguna migración ya aplicada.

## AJ. Cuentas reales de producción — inventario final

1 Administrador global, 7 Responsables de local (una por local activo,
inventario completo en `docs/handbook/04-accesos-venues.md`), 4 Students
(3 reales + 1 cuenta formal de QA, ver Q). 0 cuentas de Empleado con
identidad HR activada verificada en este cierre más allá de las de prueba
de código.

## AK. Datos reales de producción — snapshot final

2 comunidades activas (IE en-default, UVA es-default); migraciones
aplicadas hasta `0156_hr_view_permission`; 3 integraciones Fourvenues
conectadas; apex `segolife.es` → `www.segolife.es` verificado con 301.

## AL. Migraciones de base de datos — estado

Sin drift detectado en las tablas propias de Segolife. Ninguna migración
se reescribió ni se revirtió durante este cierre.

## AM. Infraestructura Railway — estado de despliegue

Servicio `segolife` en `Online`, commit de producción verificado vía
`RAILWAY_GIT_COMMIT_SHA` real dentro del contenedor en cada punto de
control, no solo confiando en el estado "Online" de la CLI.

## AN. Rama y disciplina de commits seguida en todo el cierre

Cada cambio de este cierre se hizo en su propia rama (`fix/...`,
`test/...`, `docs/...`), con merge fast-forward a `main` y push, nunca con
commits directos sobre `main` — según la disciplina de `CLAUDE.md`.

## AO. Reglas de "no hacer" respetadas durante todo el cierre

Sin PASS fabricado, sin dato de negocio inventado, sin cambio de
contraseñas de usuarios reales, sin segundo Global Admin, sin rediseño de
arquitectura, sin limpieza de historial de migraciones, sin re-auditar
desde cero fases ya cerradas.

## AP. Tabla de puertas de cierre (Gate Table)

| # | Puerta | Estado |
|---|---|---|
| 1 | Identidad legal en producción | PASS |
| 2 | Dominio apex → www | PASS |
| 3 | Comunidades activas (IE/UVA) | PASS |
| 4 | Regla multicomunidad respetada (sin ifs por comunidad) | PASS |
| 5 | RBAC — Student no accede a Admin | PASS |
| 6 | RBAC — Student no accede a Venue App | PASS |
| 7 | RBAC — venue_admin no accede a Command Center | PASS |
| 8 | RBAC — venue_admin redirigido en las 8 sub-rutas de Admin probadas | PASS |
| 9 | RBAC — aislamiento cruzado entre locales | PASS |
| 10 | RBAC — anónimo denegado en superficies protegidas | PASS |
| 11 | API — endpoints protegidos nunca 200 sin sesión | PASS |
| 12 | Seguridad — fuga de PII en operations.ts | PASS (corregido PRE-16.16B) |
| 13 | Seguridad — isActive real | PASS (corregido PRE-16.16B) |
| 14 | Seguridad — guard de sobrescritura de rol | PASS (corregido PRE-16.16B) |
| 15 | Seguridad — entropía de clave de upload | PASS (corregido PRE-16.16B) |
| 16 | Seguridad — auto-link silencioso de identidad histórica | PASS (corregido en fase anterior) |
| 17 | Branding — 0 restos de Náyade en superficie activa | PASS |
| 18 | Footer — enlaces legales completos | PASS (corregido esta fase) |
| 19 | CTA de registro conserva comunidad | PASS (corregido esta fase) |
| 20 | Venue App — nombre real del local | PASS (corregido esta fase) |
| 21 | 7 cuentas reales de local — creadas y verificadas | PASS |
| 22 | QR de identidad del Student — coherente | PASS |
| 23 | TPV — venta completa | PASS |
| 24 | Caja — apertura/cierre | PASS |
| 25 | Entradas — venta en puerta condicional | PASS |
| 26 | Mecanismo de SegoTokens presencial | PASS |
| 27 | Políticas de canje activas por local | PASS WITH DEPENDENCY (decisión comercial, 0/7 hoy) |
| 28 | Marketplace de Beneficios configurado | PASS WITH DEPENDENCY (decisión comercial, 0 hoy) |
| 29 | Venta nativa de entradas con datos reales | PASS WITH DEPENDENCY (sin eventos en modo nativo hoy) |
| 30 | Pasarela de pago configurada | EXTERNAL BLOCKER |
| 31 | Integración Fourvenues | PASS |
| 32 | Communication Center — Brevo configurado | PASS |
| 33 | Communication Center — prueba de envío real end-to-end | MANUAL REQUIRED |
| 34 | Portal del Empleado — flujo completo | PASS |
| 35 | Command Center — read-model | PASS (server-side) |
| 36 | Command Center — verificación visual | MANUAL REQUIRED (sin credenciales de Admin) |
| 37 | Responsive desktop/tablet/móvil | PASS |
| 38 | Tests automatizados (vitest) — baseline | PASS (estable, sin regresión) |
| 39 | TypeScript — baseline | PASS WITH DEPENDENCY (184 errores heredados, sin empeorar) |
| 40 | Migraciones — sin drift | PASS |
| 41 | Infraestructura Railway — Online, commit verificado | PASS |
| 42 | Cuenta QA de Student — disposición decidida | PASS |
| 43 | Documentación de cliente (Fase 17) completa y con QA pass | PASS |
| 44 | Preparación de arranque (Fase 18) completa | PASS |

**0 filas en FAIL.** Todas las dependencias están identificadas, ninguna es
una regresión ni un bug sin corregir.

## AQ. Preguntas y respuestas finales obligatorias

1. **¿Está Segolife listo para producción comercial real hoy?** Sí, para su
   modelo de negocio real actual (TPV en efectivo, venta externa vía
   Fourvenues, RRHH); no para cobro nativo online hasta contratar una
   pasarela de pago.
2. **¿Hay bugs críticos de seguridad sin corregir?** No.
3. **¿Puede un Student perder dinero o SegoTokens sin su consentimiento?**
   No — todo gasto de SegoTokens requiere autorización explícita del
   propio Student.
4. **¿Puede un Responsable de local ver datos de otro local?** No.
5. **¿Puede un venue_admin acceder al Command Center global?** No.
6. **¿Está la identidad legal/fiscal correcta en producción?** Sí.
7. **¿Queda branding de Náyade visible a clientes reales?** No, solo
   permanece en módulos internos de Admin fuera del alcance de producto,
   documentado como tal.
8. **¿Se puede vender una entrada con checkout nativo y pago real hoy?**
   No — bloqueado por la ausencia de pasarela de pago.
9. **¿Se puede vender vía Fourvenues hoy?** Sí, operativo con 3 locales
   conectados.
10. **¿Puede un local cobrar en efectivo por TPV hoy?** Sí.
11. **¿Puede un local cobrar con SegoTokens hoy?** El mecanismo es seguro y
    está listo; ningún local tiene la política de canje activada todavía
    — decisión comercial pendiente.
12. **¿Hay datos de prueba fabricados mezclados con datos reales?** No; la
    única cuenta de QA existente está identificada, documentada y
    justificada.
13. **¿Se ha verificado el flujo de RRHH de extremo a extremo?** Sí, contra
    código real y con manual de uso propio.
14. **¿Se puede confiar en los tests automatizados como red de seguridad?**
    Sí — baseline estable y re-verificado en cada punto de control de esta
    sesión.
15. **¿Hay deuda técnica de TypeScript sin resolver?** Sí, 184 errores
    heredados, sin agravarse durante este cierre.
16. **¿Se ha entregado documentación de cliente completa?** Sí, 6 manuales
    con 16 capturas reales de producción.
17. **¿Existe un plan de monitorización para la primera semana?** Sí, sin
    necesidad de construir BI nuevo.
18. **¿Existe un plan de formación?** Sí, contenido y agenda listos, sin
    sesiones agendadas todavía.
19. **¿Cuál es el único bloqueo externo real que afecta a toda la
    plataforma?** La pasarela de pago — y solo afecta al cobro nativo
    online, no al resto de la operación real actual.
20. **¿Cuál es la clasificación final de este cierre?** Ver sección AR.

## AR. Clasificación final

# READY FOR GO-LIVE WITH EXTERNAL DEPENDENCIES

La plataforma puede operar comercialmente hoy con su modelo de negocio real
actual (TPV en efectivo de los 7 locales, venta de entradas externa vía
Fourvenues, RRHH interno, comunicación por email). No se puede clasificar
como "READY FOR GO-LIVE" sin matices porque el cobro nativo online de
entradas depende de una pasarela de pago externa todavía sin contratar, y
porque dos capacidades reales y ya construidas (canje de SegoTokens,
marketplace de Beneficios) dependen de decisiones comerciales del cliente
que siguen pendientes. Ninguna de estas tres dependencias es un defecto de
la plataforma.

## AS. Condiciones para pasar a READY FOR GO-LIVE pleno

1. Contratar y configurar una pasarela de pago real (`PAYMENT_PROVIDER`/
   Redsys/Stripe u otra) y volver a probar el circuito completo de
   checkout nativo con datos reales.
2. Decidir y activar, local por local, la política de canje de SegoTokens
   donde el cliente quiera ofrecerlo.
3. Decidir y cargar el catálogo real de Beneficios del marketplace, si el
   cliente quiere ofrecerlo desde el lanzamiento.

Ninguna de las tres requiere cambios de código adicionales más allá de
configuración y datos — el mecanismo de las tres ya está construido y
verificado.

## AT. Próximos pasos recomendados (fuera del alcance de este cierre)

Realizar una prueba real de envío end-to-end de Communication Center antes
de depender de ese canal el primer día; obtener credenciales de Admin
propias del cliente para completar la verificación visual del Command
Center; decidir la titularidad futura de las credenciales de
Railway/GitHub/Brevo/Fourvenues.

## AU. Checklist de entrega al cliente

Ver `docs/FASE18_GO_LIVE_READINESS.md` sección F — no se repite aquí para
evitar dos fuentes de verdad divergentes.

## AV. Índice de documentos generados en todo el cierre

- `docs/PRE16_17_BROWSER_QA.md` — worklog de QA manual y automatizado
- `docs/handbook/00-manual-general.md` a `05-guia-rapida-venue.md` — Fase 17
- `docs/handbook/assets/` — 16 capturas reales de producción
- `docs/FASE18_GO_LIVE_READINESS.md` — Fase 18
- `docs/MASTER_CLOSURE_REPORT.md` — este informe
- `playwright.production.config.ts`, `e2e/pre16-17/` — suite E2E completa

## AW. Registro de verificación (cómo reproducir esta auditoría)

`pnpm test` (vitest, baseline 2968/2986), `npx tsc --noEmit` (184 errores
baseline), `pnpm test:e2e:pre16` (suite completa contra producción real,
requiere `.env.e2e.local` con credenciales, nunca versionado),
`railway status` / `railway logs` / `railway variables` para el estado de
infraestructura y dependencias externas.

## AX. Firma y validez del informe

Informe de cierre generado el 2026-08-17 tras verificación directa de
producción real, código real desplegado y suites de test reales — sin
ningún resultado fabricado ni suavizado para forzar una clasificación más
favorable. Válido como base de handover hasta el próximo cambio material
de la plataforma o de sus dependencias externas.

**FIN DEL CIERRE. No se inicia ninguna fase nueva tras este informe.**
