-- NEUTRALIZADA — Fase de saneamiento de startup SEGOLIFE (ver CLAUDE.md).
-- Redo de 0092 usando ADD COLUMN IF NOT EXISTS (sintaxis no válida en MySQL 8
-- estándar, extensión de MariaDB). Con 0092 ya corregido (ADD COLUMN sin
-- IF NOT EXISTS) y aplicándose correctamente por sí solo, esta migración es
-- redundante — se deja como no-op para no duplicar columnas.
SELECT 1;
