# SEGOLIFE — Arquitectura Multicomunidad (Fase 1, Pasos 3, 4, 5, 7 y 8)

**Fecha:** 2026-08-07. Propuesta de arquitectura, sin implementación de producto todavía (salvo el scaffolding vacío descrito en `docs/SEGOLIFE_ROADMAP.md`).

---

## Regla arquitectónica fundamental (aplica a TODO el documento y a todo desarrollo futuro)

**SEGOLIFE es una única plataforma. IE y UVA no son dos aplicaciones, dos backends ni dos forks — son comunidades configurables dentro de SEGOLIFE.** Un único backend, una única base de datos, un único admin, un único CRM, un único motor de eventos, y a futuro un único motor de SegoTokens y un único motor de beneficios. Lo que varía por comunidad es configuración y relaciones de datos, nunca la infraestructura.

Toda funcionalidad nueva debe asumir desde el diseño que en el futuro pueden existir: nuevas universidades, nuevas comunidades, nuevos campus, comunidades con uno o varios idiomas, negocios compartidos entre comunidades, y eventos compartidos o exclusivos.

**Prohibido** escribir lógica de negocio del tipo `if (community === "ie")` / `if (community === "uva")` (o equivalentes: `switch` sobre el nombre, comparaciones de slug hardcodeadas, nombres de función con "IE"/"UVA" en el propio nombre). La única excepción admitida es **datos de seed o fixtures de test** (por ejemplo, un script de seed que inserta la fila inicial `communities` para IE y UVA, o un test que arma un escenario concreto) — nunca código de lógica de negocio en `server/routers/*`, `server/*Db.ts`, ni en componentes de frontend que decidan comportamiento por el nombre literal de una comunidad.

La lógica siempre consulta configuración y relaciones: `communities` (locale por defecto, branding, flags), las tablas puente M2M (`venue_communities`, `event_communities`, `user_communities`), o el `community_id`/scope resuelto en tiempo de request (ver Paso 7) — nunca un literal de comunidad embebido en el código.

---

## Paso 3 — Estrategia multicomunidad

Dos mecanismos distintos según el tipo de dato (ver `docs/SEGOLIFE_DOMAIN_MODEL.md` para las tablas):

1. **Contenido compartible por naturaleza (venues, events, futuras campañas/beneficios): tabla puente M2M** (`venue_communities`, `event_communities`). Un venue o evento puede tener 1 fila (exclusivo) o 2 filas (compartido IE+UVA) en la tabla puente. Esto es exactamente lo que pide el requisito de negocio ("Discoteca Tía Felisa" compartida, "Tankers Evento 1" exclusivo IE) sin ninguna columna booleana `is_ie`/`is_uva` que habría que tocar cada vez que se añada un campus nuevo.

2. **Pertenencia de usuario: tabla puente M2M** (`user_communities`) en vez de una columna `community_id` directa en `users`. El caso normal (99% de estudiantes) es pertenecer a 1 sola comunidad, pero modelarlo como M2M desde el principio evita tener que migrar `users` el día que aparezca un admin global sin comunidad fija, o un caso de doble afiliación.

3. **Contenido intrínsecamente propio de una comunidad (ej. una campaña diseñada solo para IE) puede llevar `community_id` directo** si conceptualmente nunca tendría sentido compartirlo — pero se recomienda **empezar siempre por el patrón M2M** y solo simplificar a columna directa si con el tiempo se confirma que ese tipo de contenido nunca se comparte. Es más fácil quitar una tabla puente subutilizada que añadir M2M retroactivamente sobre una columna ya en producción.

Ver "Regla arquitectónica fundamental" al inicio de este documento — aplica íntegramente aquí. Añadir un tercer campus debe ser, en el caso ideal, una operación de **datos** (INSERT en `communities`), no de código.

---

## Paso 4 — Frontend: un solo codebase, dos comunidades

### Diagnóstico de la arquitectura actual (auditoría, ver `docs/SEGOLIFE_MODULE_AUDIT.md`)

- Un único `Router()` con Wouter en `App.tsx`, sin layouts anidados de router.
- Ya existe el patrón necesario para esto: `client/src/contexts/ThemeContext.tsx` — Context + persistencia en localStorage + provider envolviendo todo el árbol en `App.tsx`. **No existe ningún `business_entities`/`entityFilter` heredado de otros proyectos hermanos — hay que construirlo desde cero, pero el patrón de referencia (ThemeContext) ya está en este mismo repo.**
- Sistema de theming visual (variables CSS OKLCH de shadcn) ya centralizado en `client/src/index.css`, con precedente de sets alternativos (`.dark`/`.force-light`) — un tercer/cuarto set de valores por comunidad es extensión directa, no rediseño.
- **El obstáculo real no es el mecanismo de conmutación (eso es barato), es que ~150 páginas/componentes tienen marca, copy e idioma mezclados directamente en JSX** (`index.html`, `PublicNav.tsx`, `Home.tsx`, páginas legales completas) sin ninguna capa de indirección hoy.

### Arquitectura propuesta

```
CommunityProvider (nuevo, mismo patrón que ThemeProvider)
  ├─ resuelve community activa al montar (ver Paso 7: subdominio / prefijo de ruta / sesión)
  ├─ expone { community, locale, brandConfig } vía Context
  └─ envuelve <Router /> en App.tsx, igual que ThemeProvider hoy

I18nProvider (nuevo, ver Paso 8)
  └─ usa community.default_locale para fijar idioma inicial

Componentes de página
  └─ leen textos de recursos i18n (no hardcodeados)
  └─ leen contenido (venues/events/CMS) ya filtrado por community_id desde el backend
     (el filtrado ocurre en el servidor, no en el cliente — el cliente nunca ve
     datos de la comunidad equivocada)
```

**No se duplica la aplicación.** Un único build de Vite, una única base de código, un único deploy. Lo que cambia por comunidad es: (a) qué fila de `communities` resuelve el Provider, (b) qué datos devuelve el backend (ya filtrados), (c) el idioma inicial y el branding visual (vía CSS vars + Context).

### Esfuerzo dominante (para dimensionar fases futuras)

No es "construir el CommunityContext" (pequeño, un día de trabajo). Es la **extracción sistemática de contenido y copy hardcodeado** de las páginas existentes hacia el nuevo modelo (CMS + i18n) — comparable en volumen a introducir i18n desde cero en una aplicación mediana. Se aborda en fases incrementales, no de golpe (ver roadmap).

---

## Paso 5 — Admin único con selector global

### Propuesta

Un selector persistente en el layout del admin (mismo patrón de estado que `ThemeContext`: Context + localStorage), con 3 valores: **Todas / IE / UVA**. El valor seleccionado se pasa como parámetro opcional (`communityId?: number`) a los procedimientos tRPC de listado/analítica:

- Si `communityId` está definido → el router filtra por esa comunidad (vía join con la tabla puente correspondiente).
- Si es "Todas" → sin filtro, comportamiento actual.

Esto aplica a: CRM (leads/eventos de un negocio o comunidad concreta), usuarios (filtro por `user_communities`), eventos, negocios, y a futuro campañas/analítica — el mismo parámetro se reutiliza en todos los routers admin en vez de construir un mecanismo de filtrado distinto por módulo.

### Qué del admin actual es reutilizable

- **Reutilizable tal cual (A):** `AdminLayout.tsx` (shell, sidebar, navegación por `roles: [...]`), el patrón de RBAC (`permissionProcedure`), el motor de feature flags/settings, la numeración de documentos, el sistema de notificaciones tipo campana (`notifications.ts`), el motor CMS (bloques/páginas/media), el motor de plantillas de email.
- **Reutilizable como shell de UI, con datos nuevos (B):** las vistas de listado de CRM (leads/pipeline) pueden reapuntarse a los nuevos `venues`/`events` en vez de `experiences`/`hotel`; el patrón de disponibilidad por turnos de `restaurants.ts` es la referencia más directa para una futura vista de "aforo de evento".
- **No aplica (C/D):** paneles de Hotel/SPA/TPV/REAV/Fiscal/RRHH nómina — se mantienen ocultos tras sus feature flags (ya existentes) hasta que se decida su retirada definitiva.

---

## Paso 7 — Rutas y módulos: subdominios vs. rutas internas

### Recomendación: diseñar la capa de resolución para soportar ambos, empezar por rutas internas

Se propone una única función de resolución de comunidad en el servidor (Express, antes del handler de tRPC), con este orden de prioridad:

1. **Subdominio** (`ie.segolife.es` / `uva.segolife.es`) si `req.hostname` coincide — mecanismo objetivo de producción.
2. **Prefijo de ruta** (`/ie/...`, `/uva/...`) como *fallback* — útil en local (sin DNS) y como red de seguridad si el subdominio no resuelve.
3. **Comunidad por defecto de la sesión del usuario** si ninguno de los anteriores aplica (ej. un admin autenticado navegando `/admin` sin prefijo).

Con esta capa abstraída desde el día uno, **empezar el desarrollo con rutas internas (`/ie`, `/uva`) no compromete nada** — activar subdominios en producción más adelante es solo configurar DNS + activar la rama 1 de la función de resolución, sin tocar el resto de la aplicación.

**Por qué no recomendar solo rutas internas de forma permanente:** SEO y analítica más limpios por comunidad, posibilidad de branding de dominio completamente distinto si algún campus lo pidiera a futuro, y evita una página raíz `/` ambigua que tenga que "elegir" entre IE/UVA cada vez.

**`/admin` permanece siempre como panel único**, sin prefijo de comunidad — el filtrado se hace con el selector del Paso 5, no con la URL.

No se implementa DNS ni configuración de subdominios en esta fase — es una decisión de arquitectura documentada para cuando se aborde el despliegue.

---

## Paso 8 — Internacionalización (i18n)

### Estado actual: inexistente

Confirmado por auditoría exhaustiva (grep sobre `package.json`, `pnpm-lock.yaml` y todo `client/src`): **cero librerías de i18n, cero patrón casero de traducción.** `index.html` tiene `<html lang="es">` fijo y todo el copy vive directamente en JSX.

### Librería propuesta: `react-i18next`

Estándar de facto para React + Vite, soporta namespaces (para no cargar todo el diccionario de golpe), carga perezosa, y se integra bien con un Context de comunidad (el locale inicial lo decide `CommunityProvider`, no el navegador, aunque se puede usar el idioma del navegador como *override* explícito del usuario vía el selector EN/ES de IE).

### Arquitectura de dos capas (evita sobre-ingeniería para un MVP de 2 idiomas)

| Tipo de texto | Dónde vive | Por qué |
|---|---|---|
| **Interfaz estática** (botones, navegación, formularios, textos legales estructurales) | Ficheros de recursos JSON en el propio código (`en.json` / `es.json`, organizados por namespace) | Cambia con cada deploy, lo mantiene el equipo técnico, no necesita edición desde el admin. Es lo que gestiona `react-i18next` de forma nativa. |
| **Contenido dinámico** (títulos/descripciones de eventos y venues, copy de campañas, plantillas de notificación, bloques CMS) | Columnas duales en la propia tabla (`title_en`/`title_es`, `description_en`/`description_es`) | Con solo 2 idiomas fijos (EN/ES), una tabla `translations` polimórfica genérica sería sobre-ingeniería en esta fase — más código, más joins, mismo resultado. Se documenta como vía de escalado en `docs/SEGOLIFE_DOMAIN_MODEL.md` si se añade un tercer idioma más adelante. |

### Comportamiento por comunidad

- **SEGOLIFE IE:** `default_locale = "en"`, selector EN/ES visible.
- **SEGOLIFE UVA:** `default_locale = "es"`, sin selector visible (o secundario/oculto).
- `<html lang>` deja de ser fijo en `index.html` — se fija dinámicamente al montar la app según la comunidad resuelta (ver Paso 7). Si en el futuro se sirve por subdominio, cabe la opción de servir un `index.html` ligeramente distinto por subdominio (meta tags/OG específicos por comunidad) sin cambiar la app React interna.

### No incluido en esta fase

No se instala `react-i18next` ni se crean los ficheros de recursos todavía — esta sección es la decisión de arquitectura para la fase de implementación (ver `docs/SEGOLIFE_ROADMAP.md`, Fase 1B/1D).
