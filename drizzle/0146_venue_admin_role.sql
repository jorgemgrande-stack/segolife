-- SEGOLIFE — RBAC CONSOLIDATION & LEGACY ROLE CLEANUP (spec §5/§39).
-- Generada a mano — drizzle-kit generate sigue detenido en el mismo drift
-- preexistente documentado desde 0139-0145 (pregunta interactiva sobre
-- admin_notification_dismissals, no relacionado con este cambio).
--
-- Puramente aditivo: añade "venue_admin" al enum existente de users.role.
-- Ningún valor existente se modifica ni se elimina, ninguna fila cambia.
-- Necesario como valor REAL del enum (no solo un rol en rbac_user_roles)
-- porque Login.tsx (homeForRole) decide el destino post-login comparando
-- literalmente users.role — un Administrador de Local con role="user"
-- aterrizaría por error en la Student App en vez de en /admin.

ALTER TABLE `users`
  MODIFY COLUMN `role` enum('user','admin','monitor','agente','adminrest','controler','partner_admin','partner_user','supplier','employee','gestoria','venue_admin') NOT NULL DEFAULT 'user';
