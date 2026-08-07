# SEGOLIFE — Roadmap Técnico y Riesgos (Fase 1, Paso 9 y cierre)

**Fecha:** 2026-08-07

---

## Roadmap por fases

El usuario propuso el orden 1A→1B→1C→1D→2→3→4→5→6. Se mantiene casi íntegro; la única mejora justificada por dependencias técnicas encontradas en la auditoría es **adelantar el andamiaje de i18n/CommunityContext al bloque 1B-1D en vez de dejarlo para la Fase 6**, porque introducirlo después de crear contenido de venues/events (1D) obligaría a retrabajar ese contenido. La Fase 6 se redefine como "pulido final" (extracción masiva del copy heredado de Náyade, branding visual definitivo), no como "primera vez que existe i18n".

### Fase 1A — Limpieza estructural mínima
**Ya iniciada en esta fase.** Hecho: auditoría completa de acoplamiento (4 documentos en `docs/`), corrección de la fuga de datos `GLOBAL_CC_EMAIL`/`EMAIL_FALLBACKS`, namespace de dominio vacío (`shared/segolife/domain.ts`). Pendiente para cuando se autorice avanzar: confirmar explícitamente en BD que las feature flags de módulos turísticos/marketing (GHL, Vapi, Meta CAPI, Hotel, SPA, TPV, REAV, email ingestion) están en `false`; recablear `_core/llm.ts`/`_core/notification.ts` hacia los adapters genéricos ya existentes en `server/adapters/` (hoy desconectados) para que notificaciones al owner no dependan de credenciales de Manus Forge inexistentes.

### Fase 1B — Multicomunidad (fundación de datos)
Crear/adaptar `communities` (a partir de `organizations`), `universities`, `user_communities`; añadir `community_id` nullable a `rbac_user_roles`. Introducir `CommunityProvider` en frontend (patrón `ThemeProvider`) y la capa de resolución de comunidad en servidor (subdominio→ruta→sesión, ver `docs/SEGOLIFE_MULTICOMMUNITY_ARCHITECTURE.md` Paso 7). Instalar `react-i18next` y los ficheros de recursos EN/ES mínimos (nav, botones comunes) — sin traducir todavía el contenido heredado de Náyade.

### Fase 1C — Usuarios / CRM
Adaptar el flujo de alta de usuario para asociar comunidad (por dominio de email `.ie.edu`/`@uva.es` u otro mecanismo a definir), `user_profiles`. Adaptar el CRM heredado (`leads`/`pipeline`) para gestión de negocios/patrocinadores en vez de presupuestos turísticos.

### Fase 1D — Venues / Events
Crear `venues`, `events`, `venue_communities`, `event_communities`. CRUD admin. Sembrar los 6 negocios compartidos y los 3 eventos iniciales (2 exclusivos IE, 1 exclusivo UVA) descritos por el usuario. Usar el patrón de turnos/disponibilidad de `restaurants.ts` como referencia técnica para inscripción a evento — **sin tokens, sin QR, sin pago todavía**.

### Fase 2 — SegoTokens
`token_wallets`, `token_ledger`, `token_rules`. Cálculo de puntuación por frecuencia/recurrencia sobre `attendance` (a crear en esta fase, no antes).

### Fase 3 — QR
`qr_redemptions`, flujo de validación en puerta/consumición, campañas x2/x3 (`campaigns`).

### Fase 4 — Beneficios
`benefits`, `benefit_wallet`, beneficios cruzados entre locales, entradas gratuitas día siguiente.

### Fase 5 — Fourvenues
`external_ticketing` como capa adaptadora de sincronización — integración externa real.

### Fase 6 — Frontend final
Extracción sistemática del copy/branding heredado de Náyade que aún quede (Home, legales, emails), theming visual definitivo por comunidad, pulido de UX del selector EN/ES.

**Ninguna fase posterior a 1A se ejecuta en esta tarea.** Este roadmap es la referencia para las siguientes conversaciones.

---

## Riesgos detectados

1. **`experiences` y `reservations` son los nodos de mayor acoplamiento del schema heredado** (ver dependencias en `docs/SEGOLIFE_DOMAIN_MODEL.md`). Cualquier fase que las toque debe secuenciarse con cuidado — no hay FKs reales que avisen de una rotura, así que el riesgo es silencioso, no un error de base de datos.
2. **`drizzle/relations.ts` está vacío y solo hay 1 FK real en 152 tablas** — ventaja de flexibilidad, pero también significa que nada impide dejar huérfanos al retirar tablas. Antes de cualquier `DROP TABLE` futuro conviene un chequeo de integridad explícito (script), no confiar en que MySQL avise.
3. **`server/adapters/` está desconectado del código vivo** — parece que Náyade ya "solucionó" la dependencia de Manus, pero en realidad `_core/llm.ts` y `_core/notification.ts` siguen siendo los que se ejecutan, y ambos requieren credenciales de Manus Forge que Segolife no tiene. Cualquier feature que se asuma "ya desacoplada de Manus" por la documentación heredada debe verificarse en el código, no en el CLAUDE.md anterior.
4. **Contaminación de marca de tres generaciones de clones** (Skicenter → Náyade → Segolife) en fallbacks de código (`env.example.txt`, `SITE_URL`, nombre de cookie, nombre de marca en emails). Ya se corrigió el caso con riesgo real de fuga de datos (`GLOBAL_CC_EMAIL`); el resto son cosméticos hoy pero el patrón indica que conviene un barrido dedicado antes de manejar datos reales de estudiantes o desplegar.
5. **Ausencia total de i18n y de concepto de comunidad** — el esfuerzo dominante de las Fases 1B-1D/6 no es arquitectónico (el mecanismo de conmutación es barato) sino la extracción sistemática de ~150 páginas/componentes con copy hardcodeado. Subestimar esto en la planificación de tiempo sería el error más probable.
6. **Deuda técnica heredada ya cuantificada** (119 errores TypeScript, 12/657 tests fallando, baseline en `docs/SEGOLIFE_BASELINE.md`) — el riesgo no es que bloquee el arranque (no lo hace), sino que dificulta distinguir una regresión nueva introducida por trabajo futuro del ruido ya existente. Recomendable no dejar crecer más esa cifra a partir de aquí, sin necesidad de corregirla retroactivamente ahora.
7. **RRHH/Fiscal/Contabilidad/TPV físico están marcados DEPRECATE como producto, pero podrían seguir siendo necesarios como back-office interno** de la empresa que opera Segolife — es una decisión de negocio pendiente (no técnica) antes de poder clasificarlos definitivamente como candidatos a retirada real.
8. **La decisión subdominios vs. rutas internas (Paso 7) tiene implicaciones de DNS/SEO** que conviene fijar razonablemente pronto — aunque la capa de resolución propuesta soporta cambiar de una a otra sin reescritura, hacerlo ya en producción con usuarios reales sería más costoso que decidirlo antes de la Fase 1D.

---

## Cambios realizados en esta fase

Ver detalle completo, con archivo:línea, en `docs/SEGOLIFE_MODULE_AUDIT.md` §"Hallazgo de seguridad corregido en esta fase".

| Archivo | Cambio | Motivo |
|---|---|---|
| `server/mailer.ts` | `GLOBAL_CC_EMAIL` sin fallback hardcodeado (antes: `reservas@nayadeexperiences.es`); `mergeGlobalCc` filtra valores vacíos | Todo email saliente copiaba automáticamente a una bandeja real de Náyade — incluidos los de recuperación de contraseña con datos de estudiantes de Segolife |
| `server/config/index.ts` | `EMAIL_FALLBACKS.reservations`/`.cancellations`: `reservas@nayadeexperiences.es` → `admin@tuempresa.com` (mismo placeholder ya usado en el resto de claves del diccionario) | Mismo motivo, ruta de fallback alternativa |
| `docs/SEGOLIFE_MODULE_AUDIT.md` | Nuevo | Paso 1: mapas de reutilización y retirada |
| `docs/SEGOLIFE_DOMAIN_MODEL.md` | Nuevo | Pasos 2 y 6: propuesta de dominio + plan de migración de schema |
| `docs/SEGOLIFE_MULTICOMMUNITY_ARCHITECTURE.md` | Nuevo | Pasos 3, 4, 5, 7 y 8 |
| `docs/SEGOLIFE_ROADMAP.md` | Nuevo (este archivo) | Paso 9 + riesgos |
| `shared/segolife/domain.ts` | Nuevo | Capa de dominio Segolife vacía: solo tipos TypeScript, sin runtime, sin tablas Drizzle, sin lógica — ver siguiente sección |

**No se ha tocado:** ninguna tabla de base de datos, ningún router existente, ningún componente de frontend, ningún feature flag, ninguna dependencia de `package.json`. No se ha desplegado nada. No se ha construido SegoTokens, QR, beneficios ni la integración Fourvenues.
