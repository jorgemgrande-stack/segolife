/**
 * templatePreviewData.ts — datos ficticios para /admin (preview de
 * plantillas, spec punto 34). CLARAMENTE preview-only — nunca se inserta en
 * BD, nunca se usa fuera de `previewTemplate`/`sendTestForTemplate`. Cubre
 * todas las `allowedVariables` que aparece en el catálogo real
 * (templates.ts) para que ningún template quede con un placeholder sin
 * resolver en el preview del admin.
 */
export const PREVIEW_VARIABLES_EN: Record<string, string> = {
  studentFirstName: "Cristina",
  title: "Boat party this Saturday?",
  message: "We're checking interest for a boat party — reply if you're in.",
  eventName: "FOMO San Juan",
  venueName: "Casanova",
  dateLabel: "Jun 23, 2026",
  timeLabel: "23:30",
  ticketTypeName: "General",
  quantity: "1",
  totalAmountLabel: "€12.00",
  orderReference: "#10234",
  changeDescription: "The venue has changed.",
  refundInfo: "Contact support for refund details.",
  amountLabel: "100",
  reason: "Attendance at FOMO San Juan",
  balanceLabel: "1,420 SegoTokens",
  benefitName: "Free entry next Friday",
  expiryLabel: "Expires in 3 days",
  expiryMinutes: "60",
  pollTitle: "Boat party this Saturday?",
  daysLabel: "7",
  milestoneLabel: "1,000",
  minutesLabel: "45",
  percentageLabel: "78%",
  proposalTitle: "Rooftop movie night",
};

export const PREVIEW_VARIABLES_ES: Record<string, string> = {
  studentFirstName: "Cristina",
  title: "¿Boat party este sábado?",
  message: "Estamos viendo interés para una boat party — responde si te apuntas.",
  eventName: "FOMO San Juan",
  venueName: "Casanova",
  dateLabel: "23 jun 2026",
  timeLabel: "23:30",
  ticketTypeName: "General",
  quantity: "1",
  totalAmountLabel: "12,00 €",
  orderReference: "#10234",
  changeDescription: "El venue ha cambiado.",
  refundInfo: "Contacta con soporte para los detalles del reembolso.",
  amountLabel: "100",
  reason: "Asistencia a FOMO San Juan",
  balanceLabel: "1.420 SegoTokens",
  benefitName: "Entrada gratis el próximo viernes",
  expiryLabel: "Caduca en 3 días",
  expiryMinutes: "60",
  pollTitle: "¿Boat party este sábado?",
  daysLabel: "7",
  milestoneLabel: "1.000",
  minutesLabel: "45",
  percentageLabel: "78%",
  proposalTitle: "Noche de cine en la azotea",
};
