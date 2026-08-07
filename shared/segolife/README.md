# shared/segolife/

Namespace preparado para el dominio propio de Segolife (Fase 1 de la transformación técnica).

`domain.ts` contiene únicamente tipos TypeScript conceptuales — sin tablas Drizzle, sin routers, sin runtime. Es la forma escrita del diseño documentado en:

- `docs/SEGOLIFE_MODULE_AUDIT.md` — qué se reutiliza y qué se retira del código heredado de Náyade
- `docs/SEGOLIFE_DOMAIN_MODEL.md` — propuesta de dominio y plan de migración del schema
- `docs/SEGOLIFE_MULTICOMMUNITY_ARCHITECTURE.md` — estrategia multicomunidad, frontend, admin, rutas, i18n
- `docs/SEGOLIFE_ROADMAP.md` — fases de implementación y riesgos

Nada de este namespace está cableado todavía a `drizzle/schema.ts`, a ningún router tRPC ni a ningún componente de frontend. Se puebla de verdad a partir de la Fase 1B del roadmap.
