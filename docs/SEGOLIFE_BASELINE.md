# SEGOLIFE — Baseline Técnico (Fase 0)

**Fecha del baseline:** 2026-08-07

**Repositorio actual (origin):** https://github.com/jorgemgrande-stack/segolife
**Repositorio de origen (upstream, solo referencia):** https://github.com/jorgemgrande-stack/nayade_experiences_platform

Este documento fija el estado exacto del proyecto en el momento de independizar el repositorio, **antes de cualquier transformación funcional Náyade → Segolife**. Sirve como punto de comparación para detectar regresiones futuras.

---

## ⚠️ Advertencia

**Todavía NO se ha realizado ninguna transformación de producto Náyade → Segolife.** El código, los textos, los datos de seed, las plantillas de email y la lógica de negocio siguen siendo los de Nayade Experiences (hotel, SPA, restaurantes, experiencias acuáticas). Este commit es únicamente el punto cero técnico: repositorio independiente + entorno local funcional + documentación honesta del estado heredado.

---

## Stack técnico

- **Runtime:** Node.js (recomendado 22.x; entorno de desarrollo probado con v24.14.1)
- **Gestor de paquetes:** pnpm 10.32.1 (fijado en `packageManager`)
- **Backend:** Express 4 + tRPC 11 + TypeScript 5.9
- **ORM / BD:** Drizzle ORM 0.44 sobre MySQL 8
- **Frontend:** React 19 + Vite 7 + Wouter + TanStack Query + React Hook Form + Zod
- **UI:** Tailwind CSS 4 + shadcn/ui (Radix UI)
- **Auth:** JWT propio (`LOCAL_AUTH=true`) + bcryptjs, alternativa a Manus OAuth
- **Testing:** Vitest (unit/integración) + Playwright (e2e)
- **Contenedores:** Docker multi-stage (Node 22-alpine + Chromium para PDFs)
- **Deploy (heredado, no usado todavía en Segolife):** Railway (Nixpacks)

## Entorno local — estado de arranque

**Estado: funcional.** `pnpm dev` arranca sin errores bloqueantes; home, login, admin y la capa tRPC responden correctamente (HTTP 200).

| Servicio | Detalle |
|---|---|
| Node local | v24.14.1 |
| pnpm | 10.32.1 (coincide con `packageManager` del repo) |
| MySQL | Contenedor Docker `segolife_db`, puerto host **3307** |
| MinIO | Contenedor Docker `segolife_minio`, API puerto **9020**, consola puerto **9021** |
| Servidor app | `pnpm dev` → http://localhost:3000 |
| Admin local | Creado vía `scripts/create-admin.mjs`, credenciales solo en `.env` local (no versionado) |

## Tests (baseline heredado)

```
645 / 657 tests pasan
12 tests fallan
```

Ficheros con fallos conocidos (heredados del repo base, **no corregidos en esta fase**):
- `server/nayade.test.ts` (7 casos — control de acceso admin, CRM leads/quotes, bookings, accounting)
- `server/regression.recalculate.test.ts` (2 casos — reservas CRM/online)
- `server/reservationEmails.test.ts` (2 casos — notificaciones SMTP)
- `server/transferConfirmationEmail.test.ts` (1 caso — enlace de factura PDF)

## TypeScript (baseline heredado)

```
119 errores de TypeScript (pnpm check / tsc --noEmit)
```

No bloquean `pnpm dev` (tsx/esbuild no verifican tipos en tiempo de ejecución), pero sí bloquearían un `pnpm build` estricto que dependa de `tsc --noEmit` pasando limpio. Concentrados sobre todo en `server/routers/*.ts`, `server/services/*.ts` y `server/vapiWebhookRouter.ts`.

Un audit interno previo del repo (`AUDITORIA_TECNICA.md`, fechado 2026-03-22) registraba "0 errores TypeScript / 114 tests OK" — la deuda técnica ha crecido considerablemente en los ~4.5 meses posteriores, ya dentro del repo base de Náyade, antes de que existiera Segolife.

## Problemas preexistentes conocidos (no corregidos en esta fase)

- **`ensureReservationPublicToken`**: error no fatal al arrancar por falta de privilegio `SUPER` en MySQL 8 en Docker (binary logging activo). No impide el arranque.
- **Documentación desalineada:** `CLAUDE.md` (versión heredada), `Dockerfile` y `package.json` (`name: skicenter_platform`) titulaban el proyecto "Skicenter Platform" pese a que los módulos reales corresponden a Nayade Experiences (Hotel, SPA, Restaurantes, TPV, Fiscal REAV). Artefacto de una plantilla compartida entre proyectos anteriores del autor.
- **`drizzle/migrations/` vacía:** las migraciones SQL reales (0000–0124) viven directamente en `drizzle/`, no en `drizzle/migrations/` como referencian algunos documentos internos (`LOCAL_SETUP.md`).
- **Archivos zombie / código muerto** ya documentados en `AUDITORIA_TECNICA.md` (páginas no enrutadas, routers legacy duplicados de CRM, `framer-motion` sin uso, etc.) — no tocados en esta fase.

## Adaptaciones locales realizadas (Fase 0 y esta fase)

| Cambio | Motivo |
|---|---|
| `docker-compose.yml`: `container_name` y puertos de host propios (`segolife_db`:3307, `segolife_minio`:9020/9021) | El equipo de desarrollo ya tiene entornos Docker locales de otros proyectos (Skicenter, Nayade Experiences) usando los nombres/puertos originales (`nayade_db`:3306, `nayade_minio`:9000-9001). Cambio necesario para que Segolife conviva sin colisiones. |
| `package.json`: reordenado de claves de dependencias + campo `pnpm.onlyBuiltDependencies` | Efecto automático de `pnpm approve-builds --all`, necesario para que `esbuild` y `@tailwindcss/oxide` puedan ejecutar sus scripts de instalación. **Ninguna versión de dependencia fue modificada.** |
| Archivo `console.log('Plan` eliminado | Artefacto accidental sin uso ni referencias en el código (ver limpieza de baseline). |
| Remotes Git reconfigurados | `origin` → `jorgemgrande-stack/segolife`, `upstream` → `jorgemgrande-stack/nayade_experiences_platform` (solo referencia, sin push). |

## Variables de entorno

`.env` local creado a partir de `env.example.txt`, no versionado (correctamente ignorado por `.gitignore`). Contiene `DATABASE_URL` apuntando al puerto 3307, `LOCAL_AUTH=true`, `JWT_SECRET` generado localmente, y configuración de MinIO en los puertos 9020/9021. El resto de variables opcionales (SMTP, Redsys, LLM, Google Maps, Meta) no están configuradas; la aplicación arranca igualmente con sus *fallbacks* seguros documentados en `README-LOCAL.md`.

---

*Este documento no debe editarse retroactivamente para reflejar mejoras futuras — es una fotografía del punto cero. Los avances posteriores se documentan en archivos nuevos.*
