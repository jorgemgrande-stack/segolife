# SEGOLIFE — MG-03B + MG-04 Final Visual QA (Chromium/Playwright)

> QA visual real contra producción (`https://www.segolife.es`), remate final
> tras el cierre funcional documentado en `docs/MG03B_MG04_FINAL_CLOSURE.md`.
> Ejecutado con la infraestructura Playwright ya existente del repo
> (`playwright.production.config.ts`) — ningún framework nuevo.

## Alcance

- MG-03B (Profile Photo Activity): ciclo added→updated→removed reflejado en
  `/:community/activity`.
- MG-04 (Community Proposals 2.0): formulario "Proponer" — imagen de
  portada, urgencia, presets de fecha/fecha personalizada, ausencia de
  selector de comunidad.

## Viewports

Desktop 1440×900, mobile 390×844 (`isMobile: true`), tablet 1024×768 — los 3
proyectos ya definidos en `playwright.production.config.ts`.

## Specs nuevos

- `e2e/pre16-17/mg03b-activity.responsive.spec.ts` — corre en los 3
  proyectos (naming `.responsive.spec.ts`, mismo criterio que
  `mg03-profile-photo.responsive.spec.ts`).
- `e2e/pre16-17/mg04-community-proposal-form.responsive.spec.ts` — ídem.

## Cuentas usadas

Únicamente el Student QA ya existente en `.env.e2e.local`
(`E2E_STUDENT_EMAIL`, comunidad `ie`, userId=14). Ninguna cuenta nueva
creada. Sin credencial de Admin en este entorno (confirmado: no existe
ninguna `E2E_ADMIN_*` — mismo hallazgo ya documentado en
`block-p-q-r-employee-admin-commandcenter.spec.ts`) → **Admin Moderation
visual = CREDENTIAL REQUIRED**, no fabricada.

## MG-03B — resultado

Ciclo completo (subir→`added`, reemplazar→`updated`, eliminar→`removed`)
verificado en los 3 viewports: cada acción aparece en `/activity` con el
texto correcto, sin overflow horizontal, sin ningún "+0 ST" ni importe,
orden temporal correcto (más reciente arriba). Cero errores de consola
relevantes, cero respuestas 4xx/5xx inesperadas. Capturas:
`activity-added.png` / `activity-updated.png` / `activity-removed.png` por
viewport en `artifacts/mg03b-mg04-visual-qa/` (gitignored).

## MG-04 — resultado

Campos base visibles (título, descripción, venue, imagen, urgencia,
presets, fecha personalizada). Sin selector de comunidad en el DOM.
Imagen SVG (MIME inválido) rechazada en cliente sin llegar a red. Imagen
válida (misma fixture sintética que MG-03,
`fixtures/mg03-qa-avatar.jpg` — geométrica, nunca una fotografía real) sube
de verdad (`POST /api/community/proposal-image` → 200), preview visible,
sin overflow, botón quitar funcional. Urgencia: selección/deselección con
clase real distinguible; ninguno de los 3 botones menciona SegoTokens.
Fecha: preset → fecha personalizada deja estado coherente (el preset se
desmarca), botón "Clear"/"Quitar" funcional. **Nunca se pulsó "Submit
idea"** — ver razón en la cabecera del propio spec. Capturas:
`community-form.png` / `community-image-preview.png` /
`community-urgency.png` por viewport.

## Hallazgo investigado y descartado (falso positivo de test, no bug de producto)

Una primera captura del botón "Urgent"/"This weekend" seleccionado parecía
mostrar un color casi invisible en vez del morado sólido esperado. Se
investigó con `getComputedStyle` directamente contra producción:
`background-color` pasaba de `oklab(...  / 0)` (transparente, estado
`outline`) a `oklab(... / 0.9-1)` (sólido, estado `default`) a través de
la transición CSS de 150ms (`transition-all`) ya existente en el
componente `Button`. La primera captura se tomó milisegundos después del
click — a mitad de esa transición — no por ningún fallo del producto. Se
corrigió el TEST (esperar a que la transición se asiente + mover el ratón
fuera del botón antes de capturar, para no mezclar el estado `:hover` con
el estado "seleccionado" real) y la captura corregida confirma el morado
sólido esperado, igual que "Submit idea" y el resto de acentos de marca de
la app. **Cero cambios de producto** — el bug era enteramente del arnés de
QA, no de MG-03B/MG-04.

## Bugs de producto encontrados

Ninguno. MG-03B y MG-04 se verifican visual y funcionalmente correctos en
los 3 viewports contra producción real.

## Consola / Red

Cero errores de consola relevantes (filtrando ruido genérico y transitorio
ya documentado en `mg02-reward-visibility.responsive.spec.ts` — "Failed to
fetch" de queries canceladas por navegación entre páginas). Cero
respuestas 4xx/5xx inesperadas. Ninguna subida duplicada (un solo
`POST /api/community/proposal-image` por interacción de subida válida).

## Integridad de datos

- **Nunca se creó una propuesta real** — el botón "Submit idea" nunca se
  pulsó (ver razón arriba). Cubierto por tests de componente/integración
  existentes.
- El ciclo de foto de perfil (MG-03B) usó el Student QA ya establecido;
  cada test limpia la foto al terminar (`afterEach`/`request` REST directo
  a `students.removeMyPhoto`) — verificado tras la sesión completa que la
  cuenta QA (userId=14) no tiene ninguna foto huérfana
  (`user.avatarUrl: null`, comprobado con una llamada real a
  `students.me`).
- La subida de imagen de portada (MG-04) SÍ crea un objeto real en storage
  público (`community-proposals/14/<uuid>.jpg`, ~6 KB cada uno — la misma
  imagen sintética redimensionada) — no existe ningún endpoint de borrado
  para una imagen sin propuesta asociada (gap conocido, documentado, no
  bloqueante). Las 17 imágenes huérfanas generadas por las distintas
  iteraciones de esta sesión de QA se **eliminaron manualmente** vía
  `railway ssh` (`rm -rf /tmp/local-storage/community-proposals/14`) al
  cerrar la sesión — ninguna quedó residual en producción.
- Cero pedidos/entradas/movimientos de ledger/reembolsos/asistencia/
  compras de Benefits/empleados/eventos reales tocados.

## Regresión / TypeScript / Build

3309 passed / 18 failed (idéntico al baseline — no se tocó código de
producción en este bloque, solo specs E2E nuevos). TypeScript: 118
baseline, 0 nuevos. `pnpm build`: limpio.

## Git / Deploy

Rama `test/mg03b-mg04-visual-qa` → merge ff-only a `main` (commit
`9d57f2a`) → push → Railway reconstruyó igualmente (el webhook no
distingue "solo tests E2E" de cambios de app) → verificado Online, SHA
`9d57f2a3c17b53ec66352e160ea3ed852d0ee030` coincide con `origin/main`,
health/ready 200, logs limpios.

## Limitaciones

- Admin Moderation: **CREDENTIAL REQUIRED** — sin credencial de Admin QA en
  este entorno, no verificado visualmente. La visibilidad de
  imagen/venue/urgencia para Admin ya está cubierta a nivel de componente
  en `ComunityModeration.test.tsx` (5 tests).
- i18n ES en producción real: el selector de idioma del header
  (`EN`/`ES`) no reflejó el cambio de forma fiable durante esta sesión de
  QA (comportamiento preexistente del propio selector global, ajeno a
  MG-03B/MG-04 — fuera de perímetro tocarlo, spec §21 "no refactor
  global"). La cobertura ES real y determinista sigue siendo la de los
  tests de componente (`Activity.test.tsx`/`ComunityHub.test.tsx`, ambos
  con aserciones EN y ES explícitas vía `i18n.changeLanguage`). Documentado
  aquí en vez de omitido en silencio.
