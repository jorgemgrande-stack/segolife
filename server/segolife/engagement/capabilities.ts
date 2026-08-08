/**
 * capabilities.ts — contrato de capacidades de canal (Fase 7, spec punto
 * 43). Mismo criterio que server/segolife/integrations/capabilities.ts en
 * Fase 5: el código SIEMPRE consulta, nunca asume.
 */
export interface ChannelCapabilities {
  supportsTransactional: boolean;
  supportsMarketing: boolean;
  supportsDeliveryStatus: boolean;
  supportsRichContent: boolean;
  supportsDeepLinks: boolean;
  configured: boolean;
}

export const IN_APP_CAPABILITIES: ChannelCapabilities = {
  supportsTransactional: true,
  supportsMarketing: true,
  supportsDeliveryStatus: false, // "entregado" = la fila existe; no hay estado intermedio
  supportsRichContent: true,
  supportsDeepLinks: true,
  configured: true, // nunca depende de un provider externo
};

/** Se recalcula en runtime según haya un remitente real configurado (ver emailProvider.ts) — este valor es el caso "sin configurar". */
export const EMAIL_CAPABILITIES_UNCONFIGURED: ChannelCapabilities = {
  supportsTransactional: true,
  supportsMarketing: true,
  supportsDeliveryStatus: false, // Brevo API no se consulta por estado en esta fase — solo envío/fallo inmediato
  supportsRichContent: true,
  supportsDeepLinks: true,
  configured: false,
};

export const PUSH_CAPABILITIES_UNCONFIGURED: ChannelCapabilities = {
  supportsTransactional: true,
  supportsMarketing: true,
  supportsDeliveryStatus: false,
  supportsRichContent: false,
  supportsDeepLinks: true,
  configured: false, // sin VAPID keys reales — spec punto 41
};

export const WHATSAPP_CAPABILITIES_UNCONFIGURED: ChannelCapabilities = {
  supportsTransactional: false, // WhatsApp Business exige plantillas pre-aprobadas incluso para transaccionales — no asumido hasta tener proveedor real
  supportsMarketing: false, // exige opt-in explícito + plantilla aprobada — no asumido
  supportsDeliveryStatus: true, // las APIs de WhatsApp business SÍ suelen exponer esto — documentado como capacidad típica, no activado
  supportsRichContent: true,
  supportsDeepLinks: true,
  configured: false,
};
