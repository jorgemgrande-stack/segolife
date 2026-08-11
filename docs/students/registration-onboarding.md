# Student Registration & Onboarding

Convierte el CTA "Únete a SEGOLIFE" de PublicHome en un alta real de estudiante: VISITANTE → REGISTRO → ESTUDIANTE → SESIÓN → COMUNIDAD. Construido enteramente sobre infraestructura ya existente — ninguna tabla nueva, ningún sistema de auth paralelo, ningún rol nuevo.

## Dominio y flujo

```
PublicHome (CTA "Únete") → /register (Cuenta → Comunidad+consentimientos)
  → POST /api/auth/register → registerStudent() [1 transacción]
  → users + student_profiles + user_communities + notification_preferences
  → cookie de sesión (misma que /login) → redirect a returnTo | /<comunidad>
```

## REUSE / ADAPT / CREATE NEW / DO NOT USE

| Pieza | Decisión | Detalle |
|---|---|---|
| Tabla `users` | REUSE + ADAPT | Alta normal (`role="user"`, `loginMethod="local"`). Se añadió `UNIQUE(email)` — ver "Seguridad" |
| Tabla `student_profiles` | REUSE | `ensureStudentProfile`/`updateStudentProfile` (`server/db/studentsDb.ts`), sin CRM paralelo |
| Tabla `user_communities` | REUSE | `addUserToCommunity` (`server/db/communitiesDb.ts`), M2M ya existente — nunca `users.communityId` |
| Tabla `notification_preferences` | REUSE | Es la tabla de consentimiento de marketing, `updatePreference()` (`server/segolife/engagement/notificationPreferencesService.ts`) |
| Auth JWT/cookie | REUSE | `signSessionToken`/cookie `nayade_session`, idénticos a `/api/auth/login` |
| `users.role` | REUSE | Enum heredado sin `"student"` — no hace falta: `role="user"` + `protectedProcedure` ya representa al estudiante |
| Rate limiting | REUSE | `authRateLimit` (mismo limiter que login/forgot-password), montado también en `/api/auth/register` |
| `returnTo` | REUSE + ADAPT | Mismo query param que `/login`; se añadió `isSafeInternalPath()` (`shared/const.ts`) para sanear ambos, antes sin validar |
| Verificación de email | DO NOT USE | Sin `email_verified_at` en el schema y sin transporte de email activo — registro abierto en esta fase (ver "Decisiones deliberadas") |
| Tabla nueva de "consent" | DO NOT USE | `notification_preferences` ya cumple ese rol |
| `studentAuthRouter` / router tRPC nuevo | DO NOT USE | El registro es REST puro (`server/localAuth.ts`), como login/logout/me — única excepción documentada en `CLAUDE.md` |
| `registrationService.ts` | CREATE NEW | Única pieza nueva de lógica: orquesta la transacción (`server/segolife/students/registrationService.ts`) |
| `/register` (página) | CREATE NEW | `client/src/pages/Register.tsx`, tema `.segolife-theme` |
| `UNIQUE(users.email)` | CREATE NEW (migración) | `drizzle/0140_users_email_unique.sql` — ver "Migración" |

## Endpoint

`POST /api/auth/register` (REST, `server/localAuth.ts`) — público por definición, no requiere cambios en `authGuard.ts` (ese middleware solo intercepta `/api/trpc/*`; una ruta REST nunca pasa por él).

```
body: { firstName, lastName, email, phone, password, communitySlug, universityId, academicYear?, marketingConsent, website? }
201 → { id, name, email, role, communitySlug } + Set-Cookie: nayade_session (idéntica a /login)
400 → { error, code: INVALID_EMAIL | WEAK_PASSWORD | INVALID_PHONE | COMMUNITY_NOT_FOUND | UNIVERSITY_NOT_FOUND | INVALID_INPUT }
409 → { error, code: EMAIL_EXISTS }
429 → { error, code: RATE_LIMIT_EXCEEDED } (authRateLimit: 5 req/min/IP)
```

`phone` y `universityId` son obligatorios (pedido explícito posterior al cierre inicial de la feature, para poder ubicar al estudiante en el sistema por universidad real, no solo por comunidad). `phone` se persiste en `users.phone` (columna ya existente); `universityId` en `student_profiles.universityId` (columna ya existente) — ninguna de las dos requirió migración. `universityId` se valida server-side contra `communities.getCommunityUniversities({communityId})` (endpoint público nuevo, `server/routers/communities.ts`) — nunca se confía en el id enviado por el cliente, igual que `communitySlug`. El frontend auto-selecciona la universidad cuando la comunidad elegida solo sirve una (caso real hoy de IE/UVA); si sirviera varias, el estudiante debe elegir explícitamente y el envío queda bloqueado hasta entonces.

`website` es un honeypot — un bot que rellena todos los campos cae ahí; la respuesta es un 201 falso sin crear nada (no delata al bot con un código de error distinto).

## `registrationService.ts` — transacción

`registerStudent()` valida (formato de email, longitud de contraseña, comunidad real y `status="active"`) y luego abre **una sola transacción** Drizzle que hace, en orden: INSERT `users` → `ensureStudentProfile` + `updateStudentProfile` → `addUserToCommunity` → `updatePreference` (marketing). Si cualquier paso falla, la transacción entera revierte — nunca queda un `users` huérfano sin perfil ni comunidad.

Para poder pasar el `tx` abierto a funciones ya existentes de otros módulos (`studentsDb.ts`, `communitiesDb.ts`, `notificationPreferencesService.ts`) se amplió su tipo `db?: DbHandle` a `db?: AnyDbHandle` (`DbHandle | TxHandle`) — mismo workaround de tipos ya usado en `server/segolife/ticketing/ticketingDb.ts`. Cambio de tipo puramente aditivo (una `DbHandle` sigue siendo válida), no afecta a ningún llamador existente.

### Duplicado de email — comprobación + carrera real

1. Comprobación de aplicación (`SELECT` antes del `INSERT`) → mensaje limpio en el caso normal.
2. Garantía real ante una carrera: `UNIQUE(users.email)` a nivel de MySQL (`drizzle/0140_users_email_unique.sql`, collation `utf8mb4_0900_ai_ci` → case-insensitive). Un `INSERT` que choca captura `ER_DUP_ENTRY` (errno 1062) y se traduce al mismo `EMAIL_EXISTS`, nunca un 500.

Verificado en `server/segolife/students/registrationService.test.ts` (mock de `errno:1062`) y manualmente contra el `segolife_db` local (dos inserts con distinta capitalización del mismo email → el segundo choca con `ER_DUP_ENTRY`).

## Comunidad

`communitySlug` nunca se confía tal cual: `registerStudent()` resuelve la comunidad real vía `getCommunityBySlug()` y exige `status="active"` (rechaza `"inactive"`/`"onboarding"`, aunque el cliente mande ese slug). El estudiante elige **una** comunidad primaria al registrarse (`addUserToCommunity`, M2M `user_communities`) — no bloquea que el sistema le añada más comunidades en el futuro.

`/register` opcionalmente preselecciona por `?community=<slug>` (si es una comunidad activa real) — el estudiante siempre puede cambiarla, nunca se preselecciona por defecto sin ese parámetro.

## `/login` — i18n y enlace a registro

`Login.tsx` (panel de admin) era 100% texto español hardcodeado hasta esta feature — convertido a i18n propio (`login.*` en `client/src/locales/{es,en}/segolife.json`) con selector ES/EN igual al de `PublicHomeNav.tsx`/`Register.tsx`, a petición explícita del usuario tras el cierre inicial. Incluye el enlace "¿Aún no estás registrado? Regístrate ahora" → `/register` (con `returnTo` propagado si existe).

## Sesión y `returnTo`

Tras el `201`, la cuenta queda autenticada de inmediato (misma cookie `nayade_session`, mismo `signSessionToken`) — nunca se fuerza un login aparte. Redirección: `returnTo` (si es una ruta interna segura) o `/<comunidad-elegida>`.

`isSafeInternalPath()` (`shared/const.ts`) es el único validador de `returnTo`, reusado tanto por `Register.tsx` como por `Login.tsx` (que antes de esta feature no saneaba `returnTo` en absoluto). Acepta solo rutas que empiezan por `/` y rechaza `//`, `\`, y por construcción cualquier `http://`/`https://`/`javascript:` (no empiezan por `/`).

Si un usuario ya autenticado visita `/register`, nunca ve el formulario — redirección inmediata (mismo criterio que si acabase de registrarse).

## Consentimientos

- **Términos** (obligatorio, sin premarcar): enlaza a `/privacidad` y `/terminos` (páginas reales ya existentes — nunca un 404). El backend no lo persiste como fila propia porque no hay infraestructura de "consent log"; es una condición de UI para poder enviar el formulario.
- **Marketing** (opcional, sin premarcar): `notification_preferences` con `category="promotions"`, `channel="email"`, `enabled=<checkbox>` — se escribe siempre explícitamente (incluso `false`) para dejar constancia auditable de la decisión tomada en el registro.

## Decisiones deliberadas (alcance de esta fase)

- **Registro abierto**: sin invitación ni aprobación de admin ni verificación de email obligatoria — no existe `email_verified_at` en el schema y el transporte de email real está desactivado (ver `docs/SEGOLIFE_BASELINE.md`). No se ha activado ningún proveedor de email para esta feature.
- **Sin auto-otorgar SegoTokens/Benefits** al registrarse — ninguna regla real y configurable lo pedía.
- **Sin CAPTCHA de terceros** — solo honeypot (`website`) + rate limiting reutilizado. Se evaluó un gate por tiempo mínimo de relleno y se descartó: el riesgo de falsos positivos con autofill no compensaba frente al honeypot, que ya es una señal real sin coste de UX.
- **`returnTo` automático desde cada ruta protegida** (vía `useAuth`) queda fuera de alcance — se implementó explícitamente solo en `/login` y `/register`, que es lo que la propagación de contexto (llegar desde un evento/venue concreto) realmente necesita.

## Migración `0140_users_email_unique.sql`

`drizzle-kit generate` sigue con drift en este repo (pide renombrar tablas no relacionadas) — SQL escrito a mano, patrón ya establecido para migraciones de este proyecto. Validada contra el `segolife_db` local (MySQL 8.0.45): sin duplicados de email previos, aplicación limpia, re-aplicación falla de forma segura (`ER_DUP_ENTRY` sobre el nombre del índice, sin corromper nada). **No aplicada a producción** — pendiente de autorización explícita de cierre.

## Ciclo de vida en Admin

Un estudiante registrado aparece de inmediato en `/admin/students` (misma consulta `listStudents`, mismo origen de datos — sin sincronización manual). Suspender/reactivar sigue usando `updateStudentAdminFields` ya existente, sin tocar. No se ha añadido ninguna acción de "eliminar estudiante" en esta feature.

## Archivos

**Nuevos**: `server/segolife/students/registrationService.ts` (+ test), `client/src/pages/Register.tsx` (+ test), `drizzle/0140_users_email_unique.sql`, `shared/const.test.ts`, este documento.
**Modificados**: `drizzle/schema.ts` (`users.email` unique), `server/localAuth.ts` (endpoint), `server/_core/index.ts` (rate limit), `server/routers/communities.ts` (+ `authGuard.ts`: `getCommunityUniversities` público), `server/db/studentsDb.ts` / `server/db/communitiesDb.ts` / `server/segolife/engagement/notificationPreferencesService.ts` (tipo `AnyDbHandle`), `shared/const.ts` (`isSafeInternalPath`), `client/src/const.ts` (`getRegisterUrl`), `client/src/App.tsx` (ruta), `client/src/components/CookieBanner.tsx` (`/register` añadido a las rutas con tema Segolife — antes mostraba el banner legacy de Náyade y podía tapar el botón de envío en móvil), `client/src/pages/Login.tsx` (returnTo saneado, enlace a registro, conversión completa a i18n + selector ES/EN), `client/src/pages/PublicHome.tsx` / `client/src/components/publicHome/PublicHomeNav.tsx` (CTAs → `/register`), `client/src/locales/{es,en}/segolife.json` (namespaces `register` y `login`).
