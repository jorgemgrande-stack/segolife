-- SEGOLIFE — BEHAVIORAL BENEFITS RULE ENGINE (Fase 6). Generada a mano —
-- drizzle-kit generate sigue detenido en el drift preexistente documentado
-- desde 0139.
--
-- Puramente aditiva: 2 columnas nuevas nullable en benefit_rules (el motor
-- ya existente sigue funcionando igual cuando son NULL — comportamiento
-- legacy sin cambios) + 3 índices que faltaban en columnas ya consultadas
-- en caliente por benefitRuleEngine.ts/benefitGrantService.ts en cada
-- asistencia/consumo/entrada. Ninguna tabla existente pierde datos ni
-- cambia semántica.

ALTER TABLE `benefit_rules`
  ADD COLUMN `aggregate_metric` enum('attendance_count','venue_visit_count','distinct_venues','commerce_count','commerce_quantity','spend_cents') AFTER `recurrence_window`,
  ADD COLUMN `aggregate_threshold` int AFTER `aggregate_metric`;

CREATE INDEX `benefit_rules_source_type_active_idx` ON `benefit_rules` (`source_type`, `active`);
CREATE INDEX `user_benefits_user_id_idx` ON `user_benefits` (`user_id`);
CREATE INDEX `user_benefits_benefit_rule_id_idx` ON `user_benefits` (`benefit_rule_id`);
