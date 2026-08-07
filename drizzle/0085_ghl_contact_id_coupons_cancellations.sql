-- Añadir ghlContactId a coupon_redemptions y cancellation_requests
-- Permite trazar el contacto GHL desde el momento de creación y actualizar
-- tags en cada cambio de estado del pipeline.

ALTER TABLE `coupon_redemptions`
  ADD COLUMN `ghlContactId` varchar(128);
--> statement-breakpoint

ALTER TABLE `cancellation_requests`
  ADD COLUMN `ghl_contact_id` varchar(128);
