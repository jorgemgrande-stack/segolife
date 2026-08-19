# SEGOLIFE — Overnight Backlog (LOW / COSMETIC / fuera de alcance)

Hallazgos de severidad LOW/COSMETIC encontrados durante la sesión nocturna,
o trabajo explícitamente clasificado como fuera de perímetro. Nunca se
actúa sobre esta lista sin instrucción explícita futura.

- **`e2e/segolife-comunity.spec.ts` usa una credencial admin hardcodeada en el propio fichero** (`admin@nayadeexperiences.es`/`Nayade26*`), no leída de `.env.e2e.local` como el resto de la suite `e2e/pre16-17/`. Es un fichero anterior al patrón de fixtures/credenciales por variable de entorno — posible contaminación de marca Náyade (ver CLAUDE.md) y riesgo de credencial expuesta en el repo. No corregido esta noche por estar fuera del bloque actual (Community Proposals) — candidato a migrar al patrón `fixtures/credentials.ts` en una sesión dedicada.
- **Community Proposals — imagen de portada NO implementada** (BUSINESS DECISION REQUIRED, ver `docs/OVERNIGHT_EXECUTION_LOG.md` sección Community Proposals): el propio wizard Admin no tiene subida real de imagen (solo URL pegada a mano desde CMS→Multimedia), así que no existe ningún patrón de subida pública de imágenes ya construido que un Student pueda reutilizar de forma segura. Construir uno nuevo es una decisión de producto/seguridad (superficie de abuso/moderación) que merece su propio diseño, no una mejora de una noche.
