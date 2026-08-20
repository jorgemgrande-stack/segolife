# SEGOLIFE — Go-Live Control Board

Verificado 2026-08-18 mediante lectura directa de código real y consultas
de solo lectura contra la base de datos de producción
(`thorough-liberation`/`segolife`). GREEN = operativo. AMBER = requiere
configuración o decisión (no es un fallo técnico). RED = bloqueador
operativo real. EXTERNAL = dependencia externa a la plataforma.

## Cuadro de lanzamiento

| Ítem | Estado | Motivo |
|---|---|---|
| PLATFORM | 🟢 GREEN | Infraestructura Online, baseline de tests estable, sin regresión |
| STUDENT IE | 🟢 GREEN | Registro/login/idioma inicial (inglés)/wallet/QR verificados end-to-end |
| STUDENT UVA | 🟢 GREEN | Registro/login/idioma inicial (español)/wallet/QR verificados end-to-end |
| CASANOVA | 🟢 GREEN | Cuenta, staff, catálogo (33 productos), Fourvenues conectado, loyalty activo |
| CHIN CHIN | 🟢 GREEN | Cuenta, staff, catálogo (33 productos) — sin Fourvenues (no requerido salvo venta externa de entradas) |
| LA FINCA CLUB | 🟢 GREEN | Cuenta, staff, catálogo (33 productos) — sin Fourvenues (no requerido salvo venta externa de entradas) |
| LIMONCELLO | 🟢 GREEN | Cuenta, staff, catálogo (33 productos), Fourvenues conectado, loyalty activo |
| SELFISH POKE | 🟠 AMBER | Cuenta y RBAC correctos, **0 productos en catálogo TPV** — el TPV real se vería vacío hoy |
| TANKER EVENTS | 🟠 AMBER | Cuenta y RBAC correctos, **0 productos en catálogo TPV** — el TPV real se vería vacío hoy |
| TÍA FELISA | 🟢 GREEN | Cuenta, staff, catálogo (33 productos), Fourvenues conectado, loyalty activo |
| SEGOTOKENS (ganar/gastar) | 🟢 GREEN | Motor de ganancia activo globalmente (9 reglas); política de canje global activa desde 2026-08-15 (100 ST = €1, hasta 100% de la compra, pago 100% ST permitido) |
| BENEFITS | 🔴 RED | Ver hallazgo urgente abajo — un Beneficio real ya comprado por Students queda sin definición de qué otorga, y su ventana de compra ya caducó |
| FOURVENUES | 🟢 GREEN | 3/3 integraciones configuradas operativas (Casanova, Limoncello, Tía Felisa) |
| BREVO | 🟢 GREEN | **Actualizado 2026-08-20** — envío de prueba real end-to-end confirmado con la cuenta Admin QA dedicada (`docs/QA_ACCOUNTS.md`): Brevo aceptó el envío (messageId real de `smtp-relay.mailin.fr`), webhook `/api/engagement/brevo-webhook/health` → `configured:true`. Entrega final en bandeja no verificable desde este entorno (sin acceso a inbox) — EXTERNAL VERIFICATION REQUIRED solo para ese último tramo, nunca para la integración en sí |
| PAYMENT PROVIDER | ⚪ EXTERNAL | Sin proveedor real conectado — bloquea únicamente el tramo en dinero real de una compra; el 100% SegoTokens funciona hoy sin él (ver `PAYMENT_PROVIDER_ACTIVATION_CHECKLIST.md`) |
| EMPLOYEE/HR | 🟢 GREEN | Portal y flujo completos, documentados en Fase 17 |
| ADMIN | 🟢 GREEN | Funcional por código y por los tests de servidor del Command Center. **Actualizado 2026-08-20** — verificación visual real ya realizada con Chromium (Command Center, Events, Community Moderation, Communication Center, Employee/HR, Venues) usando la nueva cuenta Admin QA dedicada; 1 bug real encontrado y corregido (overflow horizontal del header en móvil, afectaba a todas las páginas Admin) |
| COMMAND CENTER | 🟢 GREEN | Read-model cubierto por batería de tests de servidor, sin regresión |

## ⚠️ Hallazgo urgente — Benefits (id=1, "Bienvenida nuevo estudiante")

Descubierto en esta fase, mediante lectura de producción real:

- El único Benefit con intención comercial real (destino: Tía Felisa,
  coste 5 SegoTokens, marketplace activado) **nunca fue terminado de
  configurar** — no tiene descuento, producto ni tipo de recompensa real
  asignado. Su propia descripción interna dice literalmente: *"PENDIENTE:
  un administrador debe asignarle un venue/producto/descuento real desde
  /admin/benefits."*
- **Su ventana de compra terminó el 2026-08-17 (ayer)** — ya no es
  comprable, pero sigue marcado como activo y con marketplace habilitado.
- **2 Students reales ya lo compraron con SegoTokens reales** (14 y 15 de
  agosto) y una tercera cuenta lo recibió automáticamente al registrarse
  (17 de agosto) — 3 concesiones reales de un beneficio que hoy no tiene
  nada definido que entregar.
- Además, su nombre en inglés ("entrada Libre en Casanova") no coincide
  con su nombre en español ("Visita tia felisa") ni con su venue de
  destino real (Tía Felisa, no Casanova) — una inconsistencia de contenido
  que confundiría a cualquier Student de IE que lo vea en inglés.

Esto no se ha corregido en esta auditoría porque decidir qué otorga
realmente el Beneficio (descuento, producto, importe) es una decisión
comercial, no técnica — pero dado que ya hay Students reales con esta
concesión en la mano, se recomienda resolverlo con prioridad alta.

## Matriz SegoTokens por venue

| Venue | Ganar ST | Gastar ST | Máx. % | 100% ST | Horario | Estado |
|---|---|---|---|---|---|---|
| Casanova | Sí (motor global) | Sí (política global) | 100% | Sí | Sin restricción | Activo |
| Chin Chin | Sí (motor global) | Sí (política global) | 100% | Sí | Sin restricción | Activo |
| La Finca Club | Sí (motor global) | Sí (política global) | 100% | Sí | Sin restricción | Activo |
| Limoncello | Sí (motor global) | Sí (política global) | 100% | Sí | Sin restricción | Activo |
| Selfish Poke | Sí (motor global) | Sí (política global) | 100% | Sí | Sin restricción | Activo (pero sin catálogo TPV que cobrar) |
| Tanker Events | Sí (motor global) | Sí (política global) | 100% | Sí | Sin restricción | Activo (pero sin catálogo TPV que cobrar) |
| Tía Felisa | Sí (motor global) | Sí (política global) | 100% | Sí | Sin restricción | Activo |

**Nota de alcance:** ninguno de los 7 venues tiene todavía una política de
canje *propia* — los 7 dependen de la única política global activa
(`SEGOLIFE Economy V1 — Global`, creada 2026-08-15). Esto es suficiente
para operar hoy en los 7 venues por igual; diferenciar condiciones por
venue (p. ej. un tope distinto en un local concreto) sigue siendo una
decisión comercial pendiente, no un bloqueo.

**Nota sobre el origen de ganancia "Consumo en venue"** (3 ST por €): está
activo globalmente, pero esta auditoría no ha podido verificar con una
venta real que se dispare automáticamente en los 4 venues sin Fourvenues —
verificarlo con una venta real está prohibido por las reglas de seguridad
de esta fase. Se recomienda usar el **Simulador** de
`/admin/tokens/economy` (no requiere ninguna venta real) para confirmarlo
antes de depender de él comercialmente.

## Balance real de SegoTokens en producción

5 wallets, saldo total 130 ST (2 estudiantes reales con saldo: 115 y 15
ST; el resto en 0). Ningún saldo se ha creado ni alterado en esta
auditoría — solo lectura.
