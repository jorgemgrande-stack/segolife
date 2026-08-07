# SEGOLIFE — Propuesta de Dominio y Plan de Migración de Schema (Fase 1, Pasos 2 y 6)

**Fecha:** 2026-08-07
**Estado:** propuesta de diseño. **Ninguna tabla nueva se ha creado, ninguna tabla existente se ha tocado, ningún `DROP TABLE` se ha ejecutado.** Ver `shared/segolife/domain.ts` para los tipos TypeScript de referencia (sin runtime, sin tablas Drizzle) que estructuran esta propuesta.

---

## Parte 1 — Propuesta de dominio Segolife

### Principio de diseño

No hardcodear IE/UVA en ningún sitio del dominio ni de la lógica de negocio. Toda diferenciación por comunidad se resuelve con **datos** (filas en `communities`), nunca con `if (community === 'ie')` en el código. Esto es lo que permite añadir un tercer campus en el futuro sin tocar lógica.

### Entidades núcleo propuestas

| Entidad | Propósito | Relación con el schema heredado |
|---|---|---|
| **`universities`** | Catálogo de instituciones académicas reales (IE University, Universidad de Valladolid...). Uso principal: verificación de pertenencia (dominio de email `.ie.edu`, `@uva.es`), nombre oficial, branding institucional si aplica. | No existe equivalente heredado. Entidad nueva y simple (id, name, slug, email_domain, country, status). |
| **`communities`** | La unidad real de tenant de Segolife (SEGOLIFE IE, SEGOLIFE UVA, futuros campus). Es a lo que TODO lo demás se ancla: contenido, eventos, promociones, idioma por defecto, branding. | La tabla `organizations` (id, name, slug, status, ownerUserId) ya existe en el schema heredado y es el punto de partida correcto en **forma** — pero está completamente desconectada (0 tablas de negocio la referencian hoy). Se propone **reutilizar/renombrar `organizations` como `communities`** en vez de crear una tabla paralela, añadiéndole: `university_id` (FK opcional a `universities`, nullable — una comunidad puede no estar atada a una única universidad), `default_locale` (`en`/`es`), `brand_config` (JSON: colores, logo, nombre corto — reutilizando el patrón ya visto en `system_settings.brand_*`). |
| **`users`** | Usuario de la plataforma (estudiante, staff de negocio, admin). | Tabla `users` heredada, reutilizable en estructura. El enum `role` actual (agente/adminrest/gestoria/...) se **deprecia** en favor del RBAC (`rbac_*`) ya existente, que es genérico. |
| **`user_profiles`** | Datos extendidos del usuario que no pertenecen al núcleo de auth (universidad, año de carrera, preferencias, idioma preferido, foto). | No existe heredado — se separa deliberadamente de `users` para no mezclar auth con perfil, y porque distintos tipos de usuario (estudiante vs. staff de negocio vs. admin) tendrán campos de perfil muy distintos. |
| **`user_communities`** (tabla puente M2M) | A qué comunidad(es) pertenece un usuario, con `role_in_community` y `joined_at`. | No existe heredado. Modelo M2M explícito en vez de columna única `community_id` en `users`, porque aunque el caso normal es 1 estudiante = 1 comunidad (por dominio de email), la relación M2M no cierra la puerta a: un admin global sin comunidad fija, un estudiante que se mueve de universidad, o —a futuro— comunidades no ligadas a una única universidad. |
| **`venues`** | Los negocios (Discoteca Tía Felisa, Chin Chin, La Finca Club...). | Reemplaza conceptualmente `hotel`/`spa`/`restaurants` (verticales turísticos, a deprecar) y se inspira fuertemente en el patrón de `restaurants` (turnos, cierres, disponibilidad) por ser el dominio heredado más cercano. Tabla nueva, no una adaptación literal de ninguna existente. |
| **`events`** | Un evento concreto en un venue (fecha/hora, aforo, precio si aplica, exclusividad). | Reemplaza conceptualmente `experiences` (hub de catálogo hoy) y el patrón de slots de `spa`/`timeSlots`. Tabla nueva. |
| **`venue_communities`** (M2M) | A qué comunidad(es) está disponible un venue — "compartido" = fila en ambas comunidades. | Nueva. Resuelve el requisito "negocios compartidos vs. exclusivos" sin ninguna columna booleana `is_ie`/`is_uva`. |
| **`event_communities`** (M2M) | A qué comunidad(es) está disponible un evento — exclusivo IE, exclusivo UVA, o ambas. | Nueva. Mismo patrón que `venue_communities`, resuelve directamente el requisito de "Tankers Evento 1/2 exclusivos IE" y "Mambo Evento 1 exclusivo UVA". |
| **`roles` / `permissions`** | Roles y permisos del sistema. | **Ya existen y son reutilizables tal cual**: `rbac_roles`, `rbac_permissions`, `rbac_role_permissions`, `rbac_user_roles`. Único cambio propuesto: añadir `community_id` (nullable) a `rbac_user_roles` para poder decir "este usuario es admin, pero solo de la comunidad UVA" — nullable para que un rol global (superadmin) siga funcionando sin esa dimensión. |
| **`translations`** | Contenido traducible que no vive bien como columna fija (textos de UI dinámicos, contenido CMS con más de 2 idiomas a futuro). | No existe heredado — cero i18n en el repo actual (confirmado por auditoría, ver `docs/SEGOLIFE_MODULE_AUDIT.md`). Ver estrategia detallada en `docs/SEGOLIFE_MULTICOMMUNITY_ARCHITECTURE.md` §i18n: se recomienda **NO** construir esta tabla todavía para el MVP de 2 idiomas (EN/ES) — usar columnas duales (`title_en`/`title_es`) en `events`/`venues`/CMS es más simple y suficiente por ahora. `translations` queda documentada aquí como la vía de escalado si se añade un tercer idioma. |

### Entidades futuras (solo conceptuales — NO implementar todavía)

Se describen únicamente para verificar que el diseño de arriba no las bloquea. Ninguna se crea en esta fase.

| Entidad futura | Fase | Cómo se ancla al dominio núcleo |
|---|---|---|
| `attendance` | Filosofía de producto (frecuencia/recurrencia) | `user_id` + `event_id` o `venue_id` + `checked_in_at`. Es la tabla que alimentará cualquier cálculo de frecuencia — por eso `users`/`venues`/`events` deben tener PKs estables desde ya, cosa que esta propuesta ya garantiza. |
| `token_wallets` / `token_ledger` | Fase 2 (SegoTokens) | `token_wallets.user_id` (1:1), `token_ledger` como libro mayor inmutable (`user_id`, `delta`, `reason`, `ref_type`, `ref_id`) apuntando polimórficamente a `attendance`/`campaigns`/`qr_redemptions`. Patrón calcado del ya existente `document_number_logs`/`crm_activity_log` (log inmutable + tabla resumen cacheada). |
| `token_rules` | Fase 2 | Reglas de cuántos tokens da cada acción, con scope opcional a `venue_id`/`event_id`/`community_id`. |
| `campaigns` | Fase 2-3 | Ventanas temporales con multiplicador (x2/x3), con scope a `community_id`/`venue_id`/`event_id` — mismo patrón M2M que `venue_communities`. |
| `benefits` / `benefit_wallet` | Fase 4 | Catálogo de beneficios canjeables (`benefits`, con `venue_id` emisor opcional para beneficios cruzados entre locales) + `benefit_wallet` (beneficios concedidos/canjeados por usuario). |
| `qr_redemptions` | Fase 3-4 | Log de escaneos de QR (consumición o acceso), `user_id` + `venue_id` + `benefit_id`/`event_id` opcional + `validated_by_staff_id`. |
| `external_ticketing` | Fase 5 (Fourvenues) | Tabla puente de mapeo (`event_id` ↔ `external_provider`, `external_event_id`, `sync_status`) — un adaptador, no una reimplementación de Fourvenues. |

**Conclusión de la verificación:** el diseño núcleo (`communities`, `users`, `venues`, `events`, las 3 tablas puente M2M, RBAC) soporta todas estas extensiones futuras sin cambios estructurales retroactivos — cada una cuelga de una FK a una entidad que ya existiría. Esto confirma que es correcto construir el núcleo ahora sin necesidad de adelantar las entidades futuras.

---

## Parte 2 — Plan de migración del schema heredado (152 tablas)

### Advertencia estructural importante

`drizzle/relations.ts` está **vacío** y de las 152 tablas del schema heredado, **solo existe 1 FK real** (`reservations.quoteId → quotes.id`). Todo lo demás es acoplamiento "por convención de nombre de columna", no un constraint que MySQL vaya a hacer respetar. Esto es una ventaja para migrar (nada impide estructuralmente eliminar una tabla) pero exige revisar el código (routers/`db.ts`), no solo el schema, antes de tocar nada — el schema por sí solo no avisa de las dependencias.

### Clasificación por grupo funcional

| Grupo | Tablas | Clasificación | Nota |
|---|---|---|---|
| Auth/Usuarios | `users`, `password_reset_tokens` | **KEEP** (estructura) / **ADAPT** (enum `role`) | Ver Parte 1. |
| RBAC | `rbac_roles`, `rbac_permissions`, `rbac_role_permissions`, `rbac_user_roles` | **KEEP**, ampliar con `community_id` | Motor genérico, listo. |
| Multi-tenant | `organizations`, `onboarding_status` | **ADAPT** | Base de `communities` (ver Parte 1). Hoy desconectada de todo lo demás. |
| Config/Feature flags | `feature_flags`, `system_settings`, `config_change_logs` | **KEEP** | Sin acoplamiento de dominio; útil añadir scoping por comunidad a futuro. |
| CMS genérico | `site_settings`, `media_files`, `static_pages`, `page_blocks`, `menu_items` | **KEEP** | Reutilizable tal cual, necesitará `community_id`/columnas de idioma. |
| CMS ligado a experiencias | `slideshow_items`, `home_module_items`, `gallery_items` | **ADAPT** | Reutilizable como "slideshow de eventos" quitando el acoplamiento a `experienceId`. |
| Taxonomía | `locations`, `categories` | **KEEP/ADAPT** | Encajan como "campus/zona" y "categoría de evento". |
| Productos/Experiencias/Packs | `experiences`, `experience_variants`, `product_time_slots`, `packs`, `pack_cross_sells`, `lego_packs`, `lego_pack_lines`, `lego_pack_snapshots` | **ADAPT** | Buena forma (slug, precio, capacidad, slots) pero saturada de campos fiscales de agencia de viajes a eliminar al adaptar. |
| Productos: `ticketing_products` | 1 tabla | **DEPRECATE** | Específico de canje Groupon. |
| CRM Leads/Quotes/Clients | `crm_lead_sources`, `leads`, `proposals`, `proposal_options`, `quotes`, `crm_activity_log`, `quote_commercial_tracking`, `quote_internal_notes`, `clients` | **ADAPT** | Buena forma de pipeline comercial; reutilizable para CRM de patrocinadores/venues, no para el flujo estudiante. |
| CRM: `vapi_calls` | 1 tabla | **DEPRECATE / REMOVE LATER** | IA de llamadas telefónicas, integración de marketing de Náyade. |
| Reservas/Bookings | `bookings`, `booking_monitors`, `daily_orders`, `reservations`, `reservation_operational` | **ADAPT** | `reservations` es la tabla de mayor fan-in de todo el sistema (ver dependencias abajo) — cualquier estrategia de migración debe decidir primero qué pasa con ella. |
| Facturación/Transacciones | `invoices`, `transactions` | **ADAPT/DEPRECATE** | Solo aplican si Segolife cobra membresías/entradas con factura fiscal real. |
| Hotel | `room_types`, `room_rate_seasons`, `room_rates`, `room_blocks` | **DEPRECATE** | Vertical inexistente en Segolife. |
| SPA | `spa_categories`, `spa_treatments`, `spa_resources`, `spa_slots`, `spa_schedule_templates` | **DEPRECATE** | Vertical inexistente; patrón de slots inspirador para `events`. |
| Restaurantes | `restaurants`, `restaurant_shifts`, `restaurant_closures`, `restaurant_bookings`, `restaurant_booking_logs`, `restaurant_staff` | **DEPRECATE** | Vertical inexistente, pero es la referencia de patrón más cercana a `venues`/`events`. |
| Reviews | `reviews` | **ADAPT** | Tabla polimórfica genérica (`entityType`), trivial de adaptar a `event`/`venue`. |
| REAV fiscal | `reav_expedients`, `reav_documents`, `reav_costs` | **DEPRECATE → REMOVE LATER** | Régimen de IVA de agencias de viajes españolas. |
| Suppliers/Liquidaciones | `suppliers`, `supplier_settlements`, `settlement_lines`, `settlement_documents`, `settlement_status_log` | **DEPRECATE** | Comisión a proveedores turísticos. |
| TPV físico/Caja/Datáfono | `cash_registers`, `cash_sessions`, `cash_movements`, `tpv_sales`, `tpv_sale_items`, `tpv_sale_payments`, `tpv_file_imports`, `card_terminal_operations`, `card_terminal_batches`, `card_terminal_batch_operations`, `card_terminal_batch_audit_logs` | **DEPRECATE → REMOVE LATER** | 11 tablas, subsistema aislado (TPV físico de hostelería). |
| Descuentos/Cupones/Bonos | `discount_codes`, `discount_code_uses` | **ADAPT** | Reutilizable para códigos promo de eventos/membresías. |
| Descuentos: `coupon_redemptions`, `coupon_email_config`, `compensation_vouchers` | 3 tablas | **DEPRECATE** | Canje Groupon con OCR / vale de compensación turístico. |
| Plataformas externas (Groupon/Smartbox) | `platforms`, `platform_products`, `platform_settlements` | **DEPRECATE → REMOVE LATER** | Subsistema aislado. |
| Anulaciones | `cancellation_requests`, `cancellation_logs` | **DEPRECATE** | Flujo de anulación de actividad turística con política de reembolso. |
| Finanzas: Gastos/Caja contable/Banco/Pagos fraccionados | `cost_centers`, `expense_categories`, `expense_suppliers`, `expenses`, `expense_files`, `recurring_expenses`, `fin_cash_accounts`, `fin_cash_movements`, `fin_cash_closures`, `fin_cash_alerts`, `fin_cash_closure_actions`, `bank_file_imports`, `bank_movements`, `bank_movement_links`, `pending_payments`, `payment_plans`, `payment_installments`, `email_ingestion_logs`, `expense_email_ingestion_logs` | **DEPRECATE → REMOVE LATER** (como producto) / **posible KEEP** (como back-office interno de empresa) | 19 tablas de contabilidad de PYME española. Decisión de negocio, no técnica: ¿la empresa detrás de Segolife necesita este back-office o no? |
| Numeración de documentos | `document_counters`, `document_number_logs` | **KEEP** | Utilidad genérica, reutilizable para inscripciones/recibos/QR. |
| Email/PDF templates y comunicaciones | `email_templates`, `pdf_templates`, `email_accounts`, `commercial_emails`, `email_template_configs`, `email_automation_rules`, `email_comm_log`, `email_scheduled_jobs`, `customer_email_prefs` | **KEEP** (mecanismo) / **ADAPT** (contenido) | Infraestructura genérica; el contenido de plantillas es 100% Náyade. |
| GHL/WhatsApp | `ghl_webhook_logs`, `ghl_conversations`, `ghl_messages`, `ghl_webhook_events` | **DEPRECATE** | Integración específica con GoHighLevel. |
| Partners | `partners`, `partner_billing_batches`, `partner_billing_batch_items` | **ADAPT** | Colaborador comercial con comisión — reconvertible a "partner/patrocinador universitario" con poda de campos. |
| RRHH/Personal | `monitors`(`employees`), `monitor_documents`, `monitor_payroll`, `hr_time_clock`, `hr_schedule_templates`, `hr_schedule_exceptions`, `hr_payslips`, `hr_payroll_batches`, `hr_irpf_ledger`, `hr_ss_ledger`, `hr_bonus`, `hr_leave_requests`, `hr_leave_balance`, `hr_settings` | **DEPRECATE** (como producto) / **KEEP** (como back-office interno si aplica) | 14 tablas de nómina/fichaje de empresa española. `monitors`/`employees` como concepto de "staff/organizador de evento" podría sobrevivir muy simplificado (**ADAPT**) si Segolife necesita asignar organizadores a eventos. |
| Fiscal/Gestoría (AEAT) | `tax_obligations`, `tax_obligation_lines`, `tax_obligation_log`, `tax_documents`, `tax_settings`, `tax_dossiers`, `tax_deferrals`, `tax_deferral_installments` | **DEPRECATE → REMOVE LATER** | Modelos 303/390/111/190/200/202, exclusivo de la fiscalidad de la empresa operadora. |
| Notificaciones admin | `admin_notification_dismissals` | **KEEP** | Mecanismo simple y genérico. |

### Dependencias críticas a respetar (antes de cualquier `DROP TABLE` futuro)

1. **`experiences` es el hub del que cuelga casi todo el catálogo de venta** (leads, home_module_items, product_time_slots, packs, platform_products, ticketing_products, reservations, tpv_sale_items). Cualquier plan de retirada debe decidir primero qué pasa con `experiences`.
2. **`reservations` es polimórfica de facto** (sirve a los 5 verticales: activity/restaurant/hotel/spa/pack, diferenciados solo por convención, no por FK tipada) y tiene el mayor "fan-in" del sistema: invoices, transactions, tpv_sales, bookings, discount_code_uses, cancellation_requests, reav_expedients, settlement_lines, partner_billing_batch_items, pending_payments, email_comm_log, ghl_conversations, vapi_calls. **Ninguna migración debe tocar `reservations` sin antes mapear qué de esta lista se retira en el mismo movimiento.**
3. **`users` es compartida por 3 subsistemas de identidad vía columnas planas** (`partnerId`, `supplierId`) — este es exactamente el precedente estructural que se propone copiar para `community_id`/`user_communities` (ver Parte 1).
4. **Bloque de conciliación financiera totalmente autocontenido** (`bank_file_imports` → `bank_movements` → `bank_movement_links`/`card_terminal_batches` → `card_terminal_batch_operations`/`audit_logs`) — 7 tablas con fan-out mínimo hacia el resto, buen candidato de retirada en bloque único.
5. **RRHH y Finanzas están entrelazados entre sí** (`hr_bonus.expenseId`, `hr_ss_ledger.bankMovementId`) — tratar como un único bloque de decisión, no como grupos independientes.
6. **`cancellation_requests` ↔ `compensation_vouchers` ↔ `discount_codes` forman un ciclo** — si se retiran anulaciones, decidir primero qué pasa con estos 3 puntos de enganche antes de tocar `discount_codes` (que sí se recomienda ADAPT/KEEP).

### Regla de esta fase

**No se ejecuta ningún `DROP TABLE`, `ALTER TABLE` destructivo, ni migración de datos en Fase 1.** Este documento es el mapa de decisión para una fase posterior explícitamente autorizada por el usuario.
