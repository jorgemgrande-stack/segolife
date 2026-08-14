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
  /** Communication Center (spec §10) — `renderTemplate()` ya calculaba subjectEn/Es (cayendo al título si la plantilla no declaraba uno propio) pero se descartaba antes de llegar aquí; ahora se snapshotea igual que el resto del contenido renderizado. */
  emailSubject?: { en: string | null; es: string | null };
  /** Communication Center (spec §25) — un envío manual (CRM/Student 360) deja elegir remitente explícitamente; sin esto, resolveSenderIdentity() caería a la resolución automática por templateKey/category e ignoraría la elección del admin. */
  senderOverride?: import("./senderRouting").SenderKey;
}

export function isNotificationEmailMetadata(value: unknown): value is NotificationEmailMetadata {
  return typeof value === "object" && value !== null;
}
