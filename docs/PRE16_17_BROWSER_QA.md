# PRE-16.17 — QA de navegador contra producción

Worklog interno de PRE-16.17 (manual) y PRE-16.17A (automatizado con
Playwright/Chromium contra `https://www.segolife.es`). Ejecutar con:

```
pnpm test:e2e:pre16
```

Config: `playwright.production.config.ts` (separada de `playwright.config.ts`,
que sigue apuntando a `localhost:5173` para el e2e existente). Credenciales
en `.env.e2e.local` (gitignored, nunca en los specs).

## Resultados manuales (PRE-16.17, previos a PRE-16.17A)

| Test ID | Rol | Superficie | Resultado | Hallazgo | Fix | Retest |
|---|---|---|---|---|---|---|
| A01 | Anónimo | Master Home | PASS | — | — | — |
| A11/A12 | Anónimo | Footer / enlaces legales | PASS AFTER FIX | Footer sin enlaces legales, `/condiciones-cancelacion` huérfana | `5611897` | Confirmado manualmente |
| A16 | Anónimo | Errores de consola | NOT TESTED | No verificable por captura | — | — |
| B01-B04 | Anónimo | /ie — shell público + idioma EN | PASS | — | — | — |
| B08 | Anónimo | /ie /uva — CTA registro header | PASS AFTER FIX | El nav del header perdía la comunidad (`/register` en vez de `/register?community=ie`) | `afb559c` | Confirmado manualmente |
| — | — | Evento "La Gran Novatada (UVA)" en feed IE | DATA STATE | Vinculado a ambas comunidades en `community_events` — no es bug de código | — | — |

## Resultados automatizados (PRE-16.17A)

Tooling: Playwright 1.58.2 + Chromium real, instalado esta fase. Target:
producción real. Commit verificado en el momento de cada tanda de tests vía
`RAILWAY_GIT_COMMIT_SHA` real dentro del contenedor.

| Test ID | Rol | Superficie | Resultado | Hallazgo | Fix | Retest |
|---|---|---|---|---|---|---|
| B09 | Venue | login returnTo=/ie | PASS | — | — | — |
| B14 | Anónimo | /ie responsive móvil | PASS | — | — | — |
| A/B regresión | Anónimo | Footer + CTA registro | PASS | — | — | — |
| C01-C13 | Anónimo/Venue | /uva completo | PASS (8/8) | — | — | — |
| D01,D03,D05 | Anónimo | Validación de formulario | PASS | — | — | — |
| D06/D07 | Anónimo→Student | Registro real controlado | PASS | — | — | — |
| D08/D09/D11/D12/D14 | Student | Login/sesión/returnTo/aislamiento comunidad | PASS (5/5) | — | — | — |
| E01-E19 | Student | Home autenticada, wallet, nav, deep link | PASS (6/6) | — | — | — |
| F08 | Student | Aislamiento /uva sin membresía | PASS | — | — | — |
| F03/F05 | Student | Selector de idioma en shell autenticado | SKIPPED | No se localizó el toggle EN/ES en el header de escritorio autenticado — revisar manualmente (posible ausencia real en desktop, ver SegolifeHeader.tsx max-w-md sugiere diseño mobile-only) | — | — |
| S (14 tests) | Anónimo/Student/Venue | RBAC/IDOR negativo, cliente + API | PASS (14/14) | — | — | — |
| J-VENUE-01..14 (×7 cuentas) | Venue×7 | Smoke completo Venue App | **PASS AFTER FIX** (21/21) | Header mostraba el fallback literal "Venue" en vez del nombre real — `venues.publicActive` solo se activaba para admins globales | `86cb572` | Confirmado en navegador real, las 7 cuentas, incluida captura visual |

**Bloques NO automatizados todavía** (G, H, I, K, L, M, N, O, P, Q, R, T) —
ver informe final PRE-16.17A para el detalle de qué falta y por qué.
