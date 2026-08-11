-- Requerido por SEGOLIFE — STUDENT REGISTRATION & ONBOARDING (spec puntos 11, 32):
-- antes de esta migración `users.email` no tenía ninguna restricción de unicidad
-- a nivel de motor, solo comprobación de aplicación (insuficiente ante una carrera
-- de dos registros simultáneos con el mismo email). Verificado sin duplicados
-- existentes en local antes de generar esta migración. NO aplicada a producción
-- hasta autorización explícita de cierre (ver docs/students/registration-onboarding.md).
ALTER TABLE `users` ADD CONSTRAINT `users_email_unique` UNIQUE(`email`);
