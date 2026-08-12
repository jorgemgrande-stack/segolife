/**
 * notificationProvider.ts — contrato único que implementa cada canal
 * (Fase 7, spec punto 36). `send()` nunca sabe de campañas/audiencias — solo
 * recibe un mensaje ya resuelto y devuelve un resultado de entrega.
 */
import type { ChannelCapabilities } from "./capabilities";

export interface OutboundMessage {
  userId: number;
  title: string;
  body: string;
  deepLink: string | null;
  imageUrl: string | null;
  /**
   * HTML enriquecido ya renderizado (EmailShell + cards, ver
   * server/segolife/engagement/email/emailShell.ts), snapshoteado al crear
   * la notificación. Si está presente, el provider de email lo usa en vez de
   * envolver `body` en un `<p>` genérico. Otros canales lo ignoran.
   */
  htmlBody?: string | null;
  /** Alternativa texto plano del email enriquecido — si falta, el provider cae a `body`. */
  plainTextBody?: string | null;
  /** Datos de contacto ya resueltos por el llamador — el provider nunca consulta la BD de usuarios. */
  recipient: { email?: string | null; phone?: string | null; pushEndpoint?: string | null };
}

export interface DeliveryResult {
  status: "sent" | "failed" | "skipped";
  externalMessageId?: string | null;
  error?: string | null;
}

export interface NotificationProvider {
  readonly channel: "in_app" | "email" | "push" | "whatsapp";
  readonly capabilities: ChannelCapabilities;
  send(message: OutboundMessage): Promise<DeliveryResult>;
}
