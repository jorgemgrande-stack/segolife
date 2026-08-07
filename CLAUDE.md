# CLAUDE.md — Guía de Contexto para Claude

> **THIS REPOSITORY IS SEGOLIFE.**
> **DO NOT OPERATE ON NÁYADE INFRASTRUCTURE, DATABASES, DOMAINS OR DEPLOYMENTS.**
>
> - **Proyecto:** SEGOLIFE
> - **Repositorio:** `jorgemgrande-stack/segolife` (origin)
> - **Origen técnico:** este código proviene de un clon de `jorgemgrande-stack/nayade_experiences_platform` (remote `upstream`, solo como referencia de historial — nunca hacer push ahí)
> - **Estado:** proyecto todavía en fase de transformación técnica y de producto. El código, los textos, los datos de seed y la lógica de negocio siguen siendo en gran parte los de Nayade Experiences hasta que se ejecute la conversión de producto.
> - **No realizar despliegues (Railway o cualquier otro) ni migraciones destructivas de base de datos sin instrucción explícita del usuario en la conversación actual.**
> - Náyade tiene su propia infraestructura de producción real (Railway, dominio, base de datos, facturación fiscal) completamente ajena a este repositorio. Ninguna acción de este proyecto debe tocarla, consultarla como si fuera propia, ni asumir sus credenciales, dominios o proyectos de Railway como válidos aquí.

Este archivo proporciona a Claude (en VS Code o cualquier entorno de desarrollo) contexto técnico para trabajar de forma efectiva en el proyecto **Segolife**. Léelo al inicio de cada sesión de trabajo. El detalle funcional de lo que Segolife será como producto se documentará en una fase posterior; este archivo cubre por ahora únicamente el estado técnico heredado.

---

## Reglas Operativas Generales (LEER ANTES DE CUALQUIER ACCIÓN)

Estas reglas de disciplina de desarrollo se heredan de la experiencia del repositorio base y aplican igualmente aquí, independientemente de la infraestructura concreta que use Segolife.

### Trabajo en ramas — nunca commits directos a main

Toda modificación se hace en una rama propia con prefijo descriptivo: `fix/...`, `feat/...`, `chore/...`, `refactor/...`. Si detectas que estás en `main`, ejecuta `git checkout -b <rama>` antes de tocar nada. El push a `main` solo ocurre vía merge desde una rama verificada.

### Un cambio = un commit = un deploy verificado

Cuando Segolife tenga su propio entorno de despliegue, después de cada push a `main` espera a que el build complete y verifica en logs que el servicio arranca limpio antes de hacer cualquier otro commit. No encadenes commits "para arreglar" sin haber visto el resultado del anterior desplegado.

### Prohibición de fixes en cascada

Si un commit hace que el arranque o el deploy fallen, **NO encadenes otro commit para parchear**. La acción correcta es:

1. Revertir el commit roto (`git revert <SHA>`) o resetear si aún no se ha hecho push
2. Identificar la causa real del fallo en local antes de tocar producción
3. Probar el fix en una rama separada con verificación local

### Cambios de infraestructura van aislados

Cualquier modificación a `Dockerfile`, `package.json`, `pnpm-lock.yaml`, `railway.toml`, `drizzle.config.ts`, configuración de Vite, configuración de TypeScript (`tsconfig.json`), variables de entorno o startup del servidor (`server/_core/index.ts`, partes de bootstrap) se hace en commit aislado, en rama propia, **sin mezclar features**. Estos cambios afectan a cómo arranca el contenedor — un fallo aquí es downtime, no un bug visual.

### Migraciones y schema — nunca en startup

NO añadir `drizzle-kit migrate` ni equivalentes al script de arranque del servidor. Las migraciones se generan con `pnpm drizzle-kit generate`, se revisan manualmente, y se aplican como paso explícito antes del deploy o vía un script separado. Un servidor que migra al arrancar puede colgarse silenciosamente y dejar la BD en estado intermedio.

Antes de añadir tablas o columnas nuevas, verifica que el schema en el entorno objetivo está sincronizado con `drizzle/schema.ts`. Si hay drift, arréglalo en un commit dedicado a la migración antes de seguir con la feature.

### Comandos git destructivos los lanza el humano

El agente NO ejecuta sin confirmación explícita en lenguaje natural del usuario:

- `git push --force` ni `git push -f` ni `git push --force-with-lease`
- `git reset --hard` sobre commits ya pusheados
- `git rebase` interactivo sobre `main`
- `git branch -D` ni `git tag -d` sobre tags o ramas remotas

Si el agente cree que uno de estos comandos es necesario, debe parar y pedirlo explícitamente.

### Perímetro estricto en cada tarea

Cuando recibas una tarea acotada, modifica únicamente los archivos directamente implicados. NO refactorices código adyacente, NO "limpies imports", NO añadas comentarios explicativos, NO cambies el formato de líneas que no estás tocando funcionalmente. Si crees que un cambio fuera del perímetro mejora la solución, pregunta antes.

### Verificación local antes de push

Antes de cualquier push a `main`, verifica que:

1. El cambio funciona en local (`pnpm dev` arranca sin errores nuevos en consola)
2. `git status` muestra solo los archivos esperados como modificados
3. `git diff` solo contiene el cambio descrito en el commit, sin ediciones colaterales
4. `pnpm test` pasa para los tests relacionados con el cambio (ver `docs/SEGOLIFE_BASELINE.md` para el baseline heredado de tests/TypeScript que aún no se corrige)

### Deploy — fuente de verdad

Segolife todavía no tiene un entorno de despliegue propio configurado. Cuando lo tenga, el deploy `Active` de ese entorno (no el de Náyade) será la fuente de verdad, y cualquier divergencia entre `main` en GitHub y el código desplegado debe investigarse antes de añadir código nuevo.

---

## Stack Tecnológico

El proyecto usa un stack moderno y tipado de extremo a extremo. En el servidor corre **Express 4** con **tRPC 11** como capa de API, **Drizzle ORM** sobre **MySQL 8**, y **TypeScript** en todo el código. En el cliente corre **React 19** con **Vite 7**, **Tailwind CSS 4**, **shadcn/ui** (componentes Radix UI), **TanStack Query** (a través de tRPC) y **Wouter** para el enrutado. Los formularios usan **React Hook Form** con validación **Zod**.

---

## Reglas de Desarrollo (OBLIGATORIAS)

**Nunca uses fetch o Axios directamente en el frontend.** Toda comunicación con el servidor debe hacerse a través de los hooks de tRPC: `trpc.*.useQuery()` y `trpc.*.useMutation()`. La única excepción son los endpoints de autenticación local (`/api/auth/*`) que son REST puro.

**Toda lógica de base de datos va en `server/db.ts` o en archivos `server/*Db.ts`.** Los procedimientos tRPC en `server/routers.ts` (o en `server/routers/*.ts`) llaman a esas funciones helper; no deben contener SQL inline.

**El schema de base de datos es la fuente de verdad.** Cualquier cambio en `drizzle/schema.ts` debe ir seguido de `pnpm drizzle-kit push` (desarrollo) o `pnpm drizzle-kit generate` + aplicar la migración SQL (producción).

**Los procedimientos protegidos usan `protectedProcedure`.** Los públicos usan `publicProcedure`. Nunca expongas datos sensibles en procedimientos públicos. Para operaciones exclusivas de admin, añade la comprobación `if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' })`.

**Los assets estáticos (imágenes, vídeos) no van en `client/public/` ni en `client/src/assets/`.** Deben subirse a S3/MinIO y referenciarse por URL CDN. En local, el adaptador de storage guarda en `/tmp/local-storage` durante desarrollo.

**Los tests Vitest son obligatorios** para cualquier lógica de negocio nueva. Los archivos de test van en `server/*.test.ts`. Ejecuta `pnpm test` antes de hacer commit.

---

## Estructura de Archivos Clave

```
drizzle/schema.ts          ← Modelo de datos completo
server/routers.ts          ← Router tRPC principal (todos los módulos)
server/routers/hotel.ts    ← Router del módulo Hotel
server/routers/spa.ts      ← Router del módulo SPA
server/routers/reviews.ts  ← Router del sistema de reseñas
server/db.ts               ← Helpers de BD genéricos
server/hotelDb.ts          ← Helpers de BD para Hotel
server/spaDb.ts            ← Helpers de BD para SPA
server/db/reviewsDb.ts     ← Helpers de BD para Reseñas
server/localAuth.ts        ← Autenticación local (email+JWT)
server/passwordReset.ts    ← Recuperación de contraseña
server/authGuard.ts        ← Middleware de protección de rutas
server/adapters/           ← Adaptadores para servicios externos
client/src/App.tsx         ← Rutas de la aplicación
client/src/pages/          ← Páginas públicas y de admin
client/src/components/     ← Componentes reutilizables
```

---

## Módulos tRPC Disponibles (estado heredado, aún no transformado)

El `appRouter` expone actualmente los siguientes namespaces, heredados del código base:

| Namespace | Descripción | Archivo |
|---|---|---|
| `auth` | Login, logout, me, registro, invitaciones | `server/routers.ts` |
| `public` | Datos públicos: experiencias, packs, hotel, SPA, restaurantes | `server/routers.ts` |
| `cms` | Gestión de contenidos: slideshow, menús, páginas, multimedia, módulos home | `server/routers.ts` |
| `products` | Gestión de experiencias, packs, categorías, ubicaciones, variantes | `server/routers.ts` |
| `leads` | Solicitudes de presupuesto y leads de contacto | `server/routers.ts` |
| `quotes` | Presupuestos personalizados con constructor | `server/routers.ts` |
| `bookings` | Reservas de experiencias (con Redsys) | `server/routers.ts` |
| `accounting` | Dashboard contable y listado de transacciones | `server/routers.ts` |
| `admin` | Operaciones de administración general | `server/routers.ts` |
| `homeModules` | Módulos configurables de la página de inicio | `server/routers.ts` |
| `reservations` | Reservas Redsys y webhooks GHL | `server/routers.ts` |
| `packs` | Packs de actividades con cross-sells | `server/routers.ts` |
| `hotel` | Habitaciones, tarifas, temporadas, reservas de hotel | `server/routers/hotel.ts` |
| `spa` | Tratamientos, recursos, slots, reservas de SPA | `server/routers/spa.ts` |
| `reviews` | Reseñas públicas y moderación de admin | `server/routers/reviews.ts` |
| `system` | Notificaciones al owner | `server/_core/systemRouter.ts` |

Este listado describe el estado actual del código heredado, no el diseño final de producto de Segolife (pendiente de fase posterior).

---

## Autenticación

El proyecto soporta dos modos de autenticación configurables mediante la variable de entorno `LOCAL_AUTH`:

Cuando `LOCAL_AUTH=true` (modo usado en desarrollo local de Segolife), se usa autenticación propia con email y contraseña. El módulo `server/localAuth.ts` gestiona el login, logout y la verificación de sesión mediante cookies JWT firmadas con `JWT_SECRET`. El middleware `server/authGuard.ts` protege las rutas `/api/trpc` que no están en la lista blanca pública.

Cuando `LOCAL_AUTH` no está definido, se usa el OAuth de Manus gestionado por `server/_core/oauth.ts` — mecanismo heredado, no configurado para Segolife.

---

## Servicios Externos y Adaptadores

Todos los servicios externos tienen adaptadores en `server/adapters/` que permiten sustituir los servicios de Manus por alternativas estándar:

| Servicio | Adaptador | Variables de entorno |
|---|---|---|
| LLM / IA | `adapters/llm.ts` | `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` |
| Almacenamiento | `adapters/storage.ts` | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` |
| Email / Notificaciones | `adapters/notification.ts` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` |
| Generación de imágenes | `adapters/imageGeneration.ts` | `LLM_API_KEY` (usa DALL-E) |
| Google Maps | `adapters/maps.ts` | `GOOGLE_MAPS_API_KEY` |
| Pagos (Redsys) | `server/redsys.ts` | `REDSYS_MERCHANT_CODE`, `REDSYS_MERCHANT_KEY`, etc. |

Todas las credenciales de estos servicios que use Segolife deben ser propias de Segolife, nunca las de Náyade.

---

## Variables de Entorno Imprescindibles (desarrollo local)

```bash
DATABASE_URL=mysql://nayade:nayade_pass@localhost:3307/nayade_db   # puerto local propio de Segolife
LOCAL_AUTH=true
JWT_SECRET=clave-secreta-de-al-menos-32-caracteres
PORT=3000
NODE_ENV=development
```

Consulta `env.example.txt` para la lista completa con descripciones, y `docs/SEGOLIFE_BASELINE.md` para el detalle de puertos locales (`segolife_db`:3307, `segolife_minio`:9020/9021) y el estado de arranque verificado.

---

## Comandos Útiles

```bash
pnpm dev                    # Servidor de desarrollo (Express + Vite HMR)
pnpm build                  # Build de producción
pnpm test                   # Ejecutar tests Vitest
pnpm check                  # Verificación de tipos TypeScript
pnpm drizzle-kit push       # Sincronizar schema con BD (desarrollo)
pnpm drizzle-kit generate   # Generar SQL de migración (producción)
node scripts/create-admin.mjs   # Crear/actualizar usuario admin
node scripts/setup-minio.mjs    # Inicializar bucket MinIO
docker compose up -d db minio   # Levantar MySQL + MinIO propios de Segolife (puertos 3307/9020-9021)
```

---

## Convenciones de Nomenclatura

Los archivos de componentes React usan **PascalCase** (`HotelRoom.tsx`). Los archivos de servidor usan **camelCase** (`hotelDb.ts`). Las tablas de base de datos usan **snake_case** (`room_rate_seasons`). Los procedimientos tRPC usan **camelCase** (`getPublicReviews`). Las rutas URL usan **kebab-case** (`/recuperar-contrasena`).
