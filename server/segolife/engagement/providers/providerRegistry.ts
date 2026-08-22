/**
 * providerRegistry.ts — resuelve el NotificationProvider real por canal.
 * Único lugar que instancia providers — notificationService.ts y
 * campaignService.ts nunca importan un provider concreto directamente.
 */
import type { NotificationProvider } from "../notificationProvider";
import { inAppProvider } from "./inAppProvider";
import { createEmailProvider } from "./emailProvider";
import { createPushProvider } from "./pushProvider";
import { whatsappProvider } from "./whatsappProvider";

const emailProviderInstance = createEmailProvider();
const pushProviderInstance = createPushProvider();

const registry: Record<string, NotificationProvider> = {
  in_app: inAppProvider,
  email: emailProviderInstance,
  push: pushProviderInstance,
  whatsapp: whatsappProvider,
};

/** Kill switch por canal — además de ENGAGEMENT_DELIVERY_ENABLED (que gobierna si el scheduler arranca) y de si el provider tiene credenciales, cada canal externo requiere su propia variable en "true". Todas default false. */
const CHANNEL_ENV_FLAGS: Record<string, string | null> = {
  in_app: null, // in_app nunca se desactiva — no depende de ningún kill switch
  email: "EMAIL_NOTIFICATIONS_ENABLED",
  push: "PUSH_NOTIFICATIONS_ENABLED",
  whatsapp: "WHATSAPP_NOTIFICATIONS_ENABLED",
};

export function getProvider(channel: "in_app" | "email" | "push" | "whatsapp"): NotificationProvider {
  const provider = registry[channel];
  const envFlag = CHANNEL_ENV_FLAGS[channel];
  if (envFlag && process.env[envFlag] !== "true" && provider.capabilities.configured) {
    return { ...provider, capabilities: { ...provider.capabilities, configured: false } };
  }
  return provider;
}
