/**
 * whatsappProvider.ts — preparado conceptualmente, NO ACTIVADO (spec punto
 * 42). Sin proveedor real, sin opt-in, sin plantillas aprobadas. NUNCA usa
 * GHL ni Vapi — `configured` siempre false hasta tener un proveedor real de
 * WhatsApp Business.
 */
import type { NotificationProvider, DeliveryResult } from "../notificationProvider";
import { WHATSAPP_CAPABILITIES_UNCONFIGURED } from "../capabilities";

export const whatsappProvider: NotificationProvider = {
  channel: "whatsapp",
  capabilities: WHATSAPP_CAPABILITIES_UNCONFIGURED,
  async send(): Promise<DeliveryResult> {
    return { status: "skipped", error: "WhatsApp provider not configured — Fase 7 preparado conceptualmente, no activado" };
  },
};
