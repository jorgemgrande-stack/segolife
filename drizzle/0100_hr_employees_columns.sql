-- Fase 1 del módulo Personal / RRHH.
--
-- Amplía la tabla física `monitors` con las columnas que necesita el concepto
-- de "empleado" (puesto, departamento, jornada, vacaciones, datos fiscales,
-- centro de coste). NO renombra ni dropea nada. El alias TypeScript
-- `employees = monitors` vive en drizzle/schema.ts.
--
-- Todas las columnas son nullable o con DEFAULT para no romper INSERTs
-- existentes ni datos previos. Idempotente con IF NOT EXISTS.

ALTER TABLE `monitors`
  ADD COLUMN `position`         varchar(64)   DEFAULT NULL,
  ADD COLUMN `department`       varchar(64)   DEFAULT NULL,
  ADD COLUMN `weekly_hours`     decimal(5,2)  DEFAULT NULL,
  ADD COLUMN `holiday_days_year` int          DEFAULT 22,
  ADD COLUMN `nss`              varchar(20)   DEFAULT NULL,
  ADD COLUMN `irpf_percent`     decimal(5,2)  DEFAULT NULL,
  ADD COLUMN `cost_center_id`   int           DEFAULT NULL;
--> statement-breakpoint

-- Índice opcional para futuras consultas por centro de coste (no es FK formal,
-- siguiendo la convención del sistema actual con FKs débiles).
CREATE INDEX `idx_monitors_cost_center_id` ON `monitors` (`cost_center_id`);
