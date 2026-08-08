/**
 * mockProviders.ts — providers de prueba (spec punto 60). Nunca se usan en
 * producción — solo en tests y, opcionalmente, "Test send" en desarrollo
 * cuando el provider real no está configurado.
 */
import type { NotificationProvider, DeliveryResult } from "../notificationProvider";
import { EMAIL_CAPABILITIES_UNCONFIGURED, PUSH_CAPABILITIES_UNCONFIGURED, WHATSAPP_CAPABILITIES_UNCONFIGURED } from "../capabilities";

export function createMockProvider(channel: "email" | "push" | "whatsapp", result: DeliveryResult = { status: "sent" }): NotificationProvider {
  const capabilities =
    channel === "email" ? { ...EMAIL_CAPABILITIES_UNCONFIGURED, configured: true } :
    channel === "push" ? { ...PUSH_CAPABILITIES_UNCONFIGURED, configured: true } :
    { ...WHATSAPP_CAPABILITIES_UNCONFIGURED, configured: true };

  return {
    channel,
    capabilities,
    async send(): Promise<DeliveryResult> {
      return result;
    },
  };
}
