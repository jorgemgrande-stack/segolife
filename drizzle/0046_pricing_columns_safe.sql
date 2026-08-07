-- NEUTRALIZADA — Fase de saneamiento de startup SEGOLIFE (ver CLAUDE.md).
-- Esta migración pretendía ser un "redo idempotente" de 0045 usando
-- ADD COLUMN IF NOT EXISTS, que no es sintaxis válida en MySQL 8 estándar
-- (es una extensión de MariaDB) — nunca pudo ejecutarse contra MySQL real.
-- Ahora que 0045 tiene su statement-breakpoint corregido y se aplica
-- correctamente por sí sola, esta migración es redundante (mismas columnas,
-- mismas tablas) y se deja como no-op para no duplicar columnas.
SELECT 1;
