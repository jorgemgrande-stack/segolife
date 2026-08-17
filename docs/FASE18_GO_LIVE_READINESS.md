# SEGOLIFE — FASE 18: Go-Live Readiness

Verificado contra producción real (`www.segolife.es`, proyecto Railway
`thorough-liberation`/servicio `segolife`) el 2026-08-17. Continuación
directa de PRE-16.17B/C y Fase 16 (auditoría final) y Fase 17 (documentación
de cliente, ver `docs/handbook/`). No se ejecuta ninguna operación
comercial real durante esta fase.

---

## A. Go-Live Checklist

Estado = lo verificado en producción real a fecha de este documento.

| # | Ítem | Estado | Detalle |
|---|---|---|---|
| 1 | Identidad legal correcta en producción | ✅ PASS | HAYQUE CAPITAL, S.L. / CIF B13989264 / Finca Lindaraja s/n, 40420 Segovia / marca Segolife |
| 2 | Dominio y redirección apex→www | ✅ PASS | `segolife.es` → `https://www.segolife.es` (301 verificado) |
| 3 | Comunidades activas configuradas | ✅ PASS | IE (en) y UVA (es), verificadas end-to-end |
| 4 | Branding legacy (Náyade) eliminado de superficies activas | ✅ PASS | 0 referencias en superficie pública/Student/Venue; menú de Admin conserva módulos legacy ocultos/desactivados por flag, documentado en `docs/handbook/02-administrador.md` §18 |
| 5 | RBAC — aislamiento Responsable de local | ✅ PASS | Verificado con pruebas automatizadas (aislamiento cruzado entre locales, sin acceso a Command Center) |
| 6 | Cuentas reales de los 7 locales activas y correctas | ✅ PASS | Ver `docs/handbook/04-accesos-venues.md` |
| 7 | Flujo completo Venue App (TPV, Caja, Entradas, Escanear) | ✅ PASS | QA de navegador real contra producción, incluido 1 bug real corregido (nombre de venue) |
| 8 | Flujo de SegoTokens presencial (solicitud/autorización/rechazo/caducidad) | ✅ PASS (mecanismo) / ⚠️ DATA STATE | Código y lógica de servidor verificados seguros y reversibles; 0/7 locales con política de canje activa hoy — decisión comercial pendiente, no bloqueo técnico |
| 9 | Identidad QR del Student | ✅ PASS | Token real verificado, mismo valor entre QR visual y campo manual del POS |
| 10 | Venta de entradas | ✅ PASS (externa) / ⚠️ DATA STATE (nativa) | 100% de eventos activos actuales venden vía Fourvenues (externo); 0 eventos con venta nativa activa hoy — el checkout nativo no tiene dato real contra el que probarse, no es un fallo |
| 11 | Integración Fourvenues | ✅ PASS | 3 locales conectados (Casanova, Limoncello, Tía Felisa) |
| 12 | Comunicación por email (Brevo) | ✅ PASS | `BREVO_API_KEY` y `BREVO_WEBHOOK_TOKEN` configurados en producción |
| 13 | Pasarela de pago (Redsys/Stripe u otra) | ❌ EXTERNAL BLOCKER | Ninguna variable `PAYMENT_PROVIDER`/`REDSYS`/`STRIPE` configurada — ver Registro de Dependencias Externas (E) |
| 14 | Portal del Empleado (RRHH) | ✅ PASS | Activación, fichaje, perfil, documentos, nóminas, vacaciones — verificado contra código real |
| 15 | Command Center (read-model) | ✅ PASS (server-side) | 185 tests de servidor en verde; verificación visual en navegador queda CREDENTIAL REQUIRED (sin cuenta de Admin en el entorno de QA) |
| 16 | Suite de tests (vitest) | ✅ PASS (baseline estable) | 2968 passed / 18 failed (los mismos 4 ficheros pre-existentes ajenos a Segolife) / 2986 total |
| 17 | TypeScript (`tsc --noEmit`) | ⚠️ BASELINE CONOCIDO | 184 errores, sin cambio durante toda la sesión — deuda técnica heredada, no regresión introducida |
| 18 | Migraciones de base de datos | ✅ PASS | Aplicadas hasta `0156_hr_view_permission`, sin drift detectado en tablas de Segolife |
| 19 | Cuenta QA de Student | ✅ PASS (decisión documentada) | `qa.pre1617.ie@segolife.es` — se mantiene como cuenta formal de QA (ver Fase 16), no se elimina |

**Bloqueos reales para Go-Live comercial pleno:** únicamente el ítem 13
(pasarela de pago). Todo lo demás está en PASS o en un estado de datos
(DATA STATE) que depende de una decisión comercial, no de una limitación
técnica.

---

## B. Manual de Operación del Primer Día

### Antes de abrir

1. Login de Administrador en `/admin` — confirmar que el Dashboard carga y
   muestra datos del día actual.
2. Confirmar en Railway (`railway status`) que el servicio está `Online` y
   con el commit esperado.
3. Confirmar que los schedulers/jobs de fondo están activos (sincronización
   Fourvenues, expiración de reservas de SegoTokens).
4. Probar login de al menos 1 cuenta de Responsable de local real y
   confirmar que llega directo a `/admin/mi-local` con su nombre de local
   correcto.
5. En el local que vaya a operar hoy: abrir **TPV** y confirmar que el
   catálogo de productos carga con precios correctos.
6. Confirmar que el **escáner** de QR abre cámara correctamente en el
   dispositivo real que se va a usar en puerta.
7. Si hay evento con caja: abrir **Caja** con el fondo de apertura real en
   efectivo.
8. Si hay evento hoy: comprobar en **Eventos** que aparece con la fecha/hora
   correctas.
9. Confirmar (Student) que la Home carga, el saldo de SegoTokens es
   correcto y el QR de identidad se genera sin error.

### Durante la operación

- **Ventas TPV**: cobrar con normalidad; identificar al Student solo si es
  necesario (es opcional).
- **Entradas**: si el evento tiene venta en puerta activada, usar la
  pestaña Entradas; si no aparece nada, confirmar primero que el tipo de
  entrada del evento está marcado como "venta en puerta" antes de asumir un
  fallo.
- **Solicitudes de SegoTokens** (en locales con política activa): solicitar
  el pago, esperar la autorización del Student desde su móvil. Si el
  Student no responde en 15 minutos, la solicitud caduca sola.
- **Errores puntuales**: si una pantalla no responde, recargar sesión
  (cerrar/volver a entrar) antes de escalar como incidencia.
- **Reintentos**: ninguna acción del panel de local duplica el cobro al
  reintentar — el carrito/TPV se resetea tras cada venta cerrada.
- **Conciliación en vivo**: el total de Caja debe cuadrar con el efectivo
  físico al final del turno; cualquier descuadre se registra en el cierre,
  no se corrige a mano en la pantalla.

### Al cierre

1. Cerrar **Caja** desde el panel del local, registrando el efectivo real
   contado.
2. Revisar **Actividad** del local para confirmar que las ventas del día
   quedaron registradas.
3. Revisar **Stock** si el local vende producto físico limitado.
4. Anotar cualquier incidencia del día (qué, hora, quién) para trasladarla
   a Segolife.
5. Cerrar sesión en todos los dispositivos compartidos del local.
6. Desde Administración: revisar el **Command Center** para confirmar que
   la actividad del día se refleja correctamente (ventas, check-ins,
   SegoTokens emitidos/gastados).

---

## C. Plan de Monitorización de la Primera Semana

Ningún indicador de esta tabla requiere construir BI nuevo — todos son
visibles hoy desde superficies ya existentes.

| Indicador | Dónde se ve hoy |
|---|---|
| Usuarios registrados (por comunidad) | `/admin` Dashboard, `/admin/students` |
| Logins / actividad de sesión | `/admin` Dashboard (funnel), logs de Railway para errores de auth |
| Ventas (TPV, por local) | `/admin/sales`, Caja de cada local |
| Entradas vendidas / check-ins | `/admin/events`, `/admin/sales`, pestaña Entradas/Escanear de cada local |
| SegoTokens emitidos / gastados | `/admin/tokens` → Dashboard y Economía |
| Solicitudes de SegoTokens pendientes / caducadas | `/admin/tokens` (o revisión directa de `token_payment_requests` si hiciera falta detalle) |
| Beneficios concedidos / canjeados | `/admin/benefits` |
| Sincronización Fourvenues | `/admin/integrations` → Unresolved operations (si aparece algo, revisar ahí primero) |
| Entregas de Communication Center | `/admin/engagement/deliveries` |
| `reconciliation_required` (operaciones que necesitan revisión manual) | `/admin/integrations/unresolved` |
| Errores de aplicación en tiempo real | `railway logs` (filtrar por `error`/`exception`/`crash`, excluyendo líneas conocidas benignas de FourvenuesAdapter/Scheduler) |

**Cadencia sugerida la primera semana:** revisión diaria de Unresolved
operations y `railway logs`; revisión cada 2-3 días del resto de
indicadores; sin necesidad de guardia nocturna dado que no hay pasarela de
pago real activa todavía (ítem 13 del checklist).

---

## D. Plan de Formación

Contenido y agenda únicamente — no se agenda ninguna sesión real en esta
fase.

### Administrador (60-90 min)

1. Recorrido del Dashboard/Command Center (15 min).
2. Estudiantes, Venues, Eventos — alta y edición (20 min).
3. SegoTokens: reglas, campañas, políticas de canje (15 min) — con foco en
   cómo activar la política de canje de un local cuando se tome la decisión
   comercial.
4. Benefits, Communication Center, Comunity (15 min).
5. Personal (RRHH) y Usuarios/roles (15 min).
6. Preguntas y casos reales (10 min).

### Responsable de local (30-45 min)

Basado directamente en `docs/handbook/01-responsable-local.md`:

1. Login y estructura de pestañas (5 min).
2. TPV: venta completa, con y sin identificar al Student (10 min).
3. Identificación de Student — QR y manual, y el énfasis explícito en que
   escanear no autoriza ni descuenta SegoTokens (10 min).
4. Caja: apertura/cierre (5 min).
5. Entradas y Escanear (5 min).
6. Preguntas y simulacro de venta real (5-10 min).

### Empleado — guía + autoservicio (sin sesión formal)

`docs/handbook/03-empleado.md` está escrito para autoservicio completo:
activación de cuenta, fichaje, perfil, documentos, nóminas y vacaciones. Se
entrega el enlace de activación junto con la guía; RRHH queda disponible
para dudas puntuales, sin necesidad de formación programada.

---

## E. Registro de Dependencias Externas

| Dependencia | Estado real verificado | Qué bloquea | Qué NO bloquea | Qué verificar cuando se configure |
|---|---|---|---|---|
| **Pasarela de pago** (Redsys/Stripe/otra) | ❌ No configurada — ninguna variable `PAYMENT_PROVIDER`/`REDSYS`/`STRIPE` en producción | Venta de entradas con **checkout nativo** dentro de Segolife; cualquier cobro online real | Venta externa vía Fourvenues (no depende de esto); TPV en efectivo de los locales; SegoTokens (no es dinero real); toda la operación actual de los 7 locales | Repetir con datos reales el hold→pago→confirmación del checkout nativo (hoy solo probado hasta el hold, de forma segura y reversible) |
| **Brevo (email)** | ✅ Configurada — `BREVO_API_KEY` y `BREVO_WEBHOOK_TOKEN` presentes en producción | — | — | Confirmar con un envío real de prueba desde Communication Center que la entrega y el webhook de estado funcionan de extremo a extremo |
| **VAPI (agente de voz IA)** | ⚪ No configurada, y **fuera del alcance actual de Segolife** — módulo oculto del menú de Admin (heredado de Náyade, 0 llamadas reales registradas) | Nada del producto Segolife actual | Todo — no es una dependencia de la operación real de Segolife hoy | No aplica salvo que se decida incorporar esta capacidad al producto en el futuro |
| **GHL / WhatsApp comercial** | ⚪ No configurada, y **fuera del alcance actual de Segolife** — mismo criterio que VAPI (0 conversaciones reales registradas) | Nada del producto Segolife actual | Todo | No aplica salvo decisión futura de producto |
| **Fourvenues / Weezevent** | ✅ Configurada y activa — 3 locales conectados (Casanova, Limoncello, Tía Felisa) | — | — | Vigilar `/admin/integrations/unresolved` durante la primera semana |

---

## F. Checklist de Entrega al Cliente

- [ ] Entregar por separado y de forma segura la contraseña inicial
      compartida de las 7 cuentas de Responsable de local (nunca por email
      sin cifrar ni en texto plano en ningún documento).
- [ ] Entregar el enlace a `docs/handbook/` (o el paquete exportado) con
      los 6 manuales.
- [ ] Confirmar con el cliente la decisión comercial pendiente sobre
      políticas de canje de SegoTokens por local (hoy 0/7 activas).
- [ ] Confirmar con el cliente la decisión comercial pendiente sobre el
      catálogo de Beneficios (hoy vacío).
- [ ] Confirmar con el cliente si se va a contratar una pasarela de pago
      para venta nativa de entradas, y con qué proveedor.
- [ ] Confirmar titularidad y custodia futura de las credenciales de
      Railway/GitHub/Brevo/Fourvenues.
- [ ] Agendar (fuera de esta fase) la sesión de formación de Administrador,
      si el cliente la quiere en vivo en vez de autoservicio con este
      manual.
- [ ] Confirmar el canal de soporte post-entrega (a qué canal reportar
      incidencias).

---

Continúa en el **Informe de Cierre y Handover Maestro**
(`docs/MASTER_CLOSURE_REPORT.md`).
