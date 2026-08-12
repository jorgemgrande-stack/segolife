/**
 * notificationMetadata.ts — forma del JSON guardado en `notifications.metadata`
 * cuando la plantilla tiene un cuerpo de email enriquecido (EmailShell). Se
 * snapshotea al CREAR la notificación (mismo principio que titleEn/titleEs —
 * nunca se re-renderiza al momento de enviar), reutilizando la columna
 * `metadata` JSON ya existente — sin migración de schema.
 */
export interface NotificationEmailMetadata {
  emailHtml?: { en: string | null; es: string | null };
  emailText?: { en: string | null; es: string | null };
}

export function isNotificationEmailMetadata(value: unknown): value is NotificationEmailMetadata {
  return typeof value === "object" && value !== null;
}
