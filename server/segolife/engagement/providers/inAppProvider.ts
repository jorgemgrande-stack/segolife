/**
 * inAppProvider.ts — provider PRINCIPAL, completamente funcional (spec
 * punto 37). No depende de ningún servicio externo: la fila de
 * `notifications` YA ES la entrega — este provider solo confirma el envío,
 * nunca falla, nunca necesita reintentos.
 */
import type { NotificationProvider, OutboundMessage, DeliveryResult } from "../notificationProvider";
import { IN_APP_CAPABILITIES } from "../capabilities";

export const inAppProvider: NotificationProvider = {
  channel: "in_app",
  capabilities: IN_APP_CAPABILITIES,
  async send(_message: OutboundMessage): Promise<DeliveryResult> {
    return { status: "sent" };
  },
};
