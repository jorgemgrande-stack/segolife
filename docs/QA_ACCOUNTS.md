# SEGOLIFE — Cuentas de QA (Playwright / verificación manual)

> Nunca contiene contraseñas. Las contraseñas viven exclusivamente en
> `.env.e2e.local` (gitignored) — ver `e2e/pre16-17/fixtures/credentials.ts`
> para cómo se leen.

## Student

- **Email**: `qa.pre1617.ie@segolife.es` (userId=14)
- **Comunidad**: IE
- **Creada**: bloque PRE-16.17A, reutilizada en toda la sesión desde entonces (MG-03B/MG-04 visual QA, etc).
- **Uso**: flujos de Student (foto de perfil, Community Proposals, tickets propios...). Nunca usada para crear compras/pedidos/asistencia reales.

## Venue (7 cuentas, una por local real)

- Casanova, Chinchín, La Finca Club, Limoncello, Selfish Poke, Tanker Events, Tía Felisa — `E2E_VENUE_<KEY>_EMAIL`, password compartido `E2E_VENUE_PASSWORD`.
- **Creadas**: tarea de handover previa a esta sesión.
- **Uso**: Venue App (TPV, escaneo, identidad).

## Admin — `qa.admin@segolife.es`

- **userId**: 16
- **Creada**: 2026-08-20, FINAL ZERO-DEBT Block B, vía el mecanismo canónico `scripts/create-admin.mjs` (bcrypt cost 12, `role='admin'`, `loginMethod='local'`, `isActive=1`) — nunca a mano, nunca copiando un hash existente.
- **Por qué una cuenta nueva**: las únicas 2 cuentas `role='admin'` existentes en producción eran la cuenta personal del usuario (`jorgemgrande@gmail.com` — explícitamente prohibido usarla como QA automatizado) y la de un miembro real del equipo (`herre.casanova@gmail.com`, Javier Herrería) — ninguna de las dos es una cuenta de QA dedicada.
- **Rol**: `role` legacy `admin` únicamente — sin filas en `rbac_user_roles` (RBAC "moderno" no sembrado para este usuario a propósito, ver `server/_core/rbac.ts::checkRbacOrLegacy`: sin RBAC sembrado, cada permiso cae al fallback legacy `fallbackAllowedRoles.includes("admin")`, que es exactamente lo que casi todos los `permissionProcedure(...)` de este repo declaran como fallback). Verificado con sesión real: `events.list`, `hr.employees.list`, `community.listStudentProposals`, `dashboard.getCommunityPulse` — los 4 responden 200 sin error de permisos.
- **Comunidad**: sin restricción — `getCommunityAccess` resuelve `"all"` para cualquier legacy-admin real (vía `settings.manage` fallback), sin necesitar filas en `user_communities`.
- **Uso**: exclusivamente QA de superficies Admin (Command Center, Communication Center, Employee/HR, Community Moderation, Events management, RBAC-sensitive surfaces). Nunca usada para aprobar/rechazar contenido real de negocio salvo que el propio QA lo requiera de forma explícita y reversible.
- **Permanece activa deliberadamente** tras esta sesión — no se desactiva al cerrar el QA, para reutilizarse en sesiones futuras (mismo criterio que la cuenta Student/Venue).
