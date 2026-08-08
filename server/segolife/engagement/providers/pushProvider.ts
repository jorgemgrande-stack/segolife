/**
 * pushProvider.ts — preparado, NO ACTIVADO (spec punto 41). Sin VAPID keys
 * reales, `configured` siempre false. `push_subscriptions` existe en schema
 * para no necesitar una migración futura, pero nada la escribe todavía.
 */
import type { NotificationProvider, DeliveryResult } from "../notificationProvider";
import { PUSH_CAPABILITIES_UNCONFIGURED } from "../capabilities";

export const pushProvider: NotificationProvider = {
  channel: "push",
  capabilities: PUSH_CAPABILITIES_UNCONFIGURED,
  async send(): Promise<DeliveryResult> {
    return { status: "skipped", error: "Push provider not configured (no VAPID keys) — Fase 7 preparado, no activado" };
  },
};
