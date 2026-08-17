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

Se completa incrementalmente según se ejecutan los specs — ver el reporte
final de PRE-16.17A para la tabla completa y el gate table.
