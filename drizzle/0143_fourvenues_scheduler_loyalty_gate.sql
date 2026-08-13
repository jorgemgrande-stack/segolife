-- Fourvenues Production Scheduler & Incremental Reconciliation Gate
-- (2026-08-13). Generada a mano — drizzle-kit generate se detiene en un
-- prompt interactivo de reconciliación por drift preexistente del journal,
-- no relacionado con este cambio (mismo motivo documentado en 0141/0142).
--
-- Migración puramente aditiva, no destructiva:
--   1. venue_integrations.loyalty_enabled — gate DECOUPLADO de sync_enabled.
--      Permite que los datos (events/orders/tickets/paymentless/attendance)
--      se sincronicen en vivo vía scheduler sin conceder ni un solo
--      SegoToken/Benefit mientras loyalty_enabled=false (default) — earnTokens/
--      evaluateBenefitsForOrigin se suprimen exactamente igual que con
--      suppressLoyalty=true. Activar loyalty real es un flip explícito
--      posterior de esta columna, nunca un efecto colateral de activar el
--      scheduler.
--   2. integration_sync_runs.metadata — trigger ("manual"|"scheduler"),
--      mode ("incremental"|"reconciliation") y ventana usada en cada run,
--      para observabilidad. Nullable: los runs anteriores a esta columna
--      simplemente no la rellenan.
--
-- Aplicada directamente a producción (sin pasar por `pnpm db:migrate` — el
-- journal de Drizzle ya tenía drift preexistente antes de esta fase, mismo
-- estado que 0139-0142) tras revisión manual, dado que no hay MySQL
-- desechable disponible en este entorno para validar primero.

ALTER TABLE `venue_integrations` ADD COLUMN `loyalty_enabled` boolean NOT NULL DEFAULT false AFTER `sync_enabled`;
ALTER TABLE `integration_sync_runs` ADD COLUMN `metadata` json DEFAULT NULL AFTER `error_message`;
