/**
 * comunity.ts — helpers de presentación compartidos entre las pantallas
 * admin y estudiante de COMUNITY (labels/badges) — evita repetir el mismo
 * mapeo de enum→texto en cada página.
 */
export type ComunityQuestionType =
  | "single_choice" | "yes_no" | "percentage_scale" | "scale_1_5"
  | "multiselect" | "ranking" | "attendance_intention" | "me_apunto" | "open_text";

export type ComunityStatus = "draft" | "scheduled" | "active" | "closed" | "cancelled" | "converted";

/**
 * MG-05 — única fuente de verdad de "qué tipos necesitan opciones/criterios
 * discretos" en el cliente (antes duplicado de forma idéntica en
 * ComunityWizard.tsx y ComunityModeration.tsx — ahora también reutilizado
 * por el bloque de configuración de voto propuesta del Student en
 * ComunityHub.tsx). Debe coincidir SIEMPRE con
 * server/segolife/community/communityQuestionTypeValidation.ts
 * (QUESTION_TYPES_WITH_OPTIONS) — mismo concepto, una sola semántica.
 */
export const QUESTION_TYPES_WITH_OPTIONS: ComunityQuestionType[] = ["single_choice", "multiselect", "ranking", "percentage_scale"];

export const QUESTION_TYPE_LABEL: Record<ComunityQuestionType, string> = {
  single_choice: "Elección única",
  yes_no: "Sí / No",
  percentage_scale: "Escala 0-100 (varios criterios)",
  scale_1_5: "Escala 1-5",
  multiselect: "Selección múltiple",
  ranking: "Ranking",
  attendance_intention: "Intención de asistencia",
  me_apunto: "Me apunto",
  open_text: "Texto abierto",
};

export const STATUS_LABEL: Record<ComunityStatus, string> = {
  draft: "Borrador",
  scheduled: "Programada",
  active: "Activa",
  closed: "Cerrada",
  cancelled: "Cancelada",
  converted: "Convertida",
};

export const STATUS_VARIANT: Record<ComunityStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  scheduled: "secondary",
  active: "default",
  closed: "outline",
  cancelled: "destructive",
  converted: "secondary",
};

export const ATTENDANCE_INTENTION_LABEL: Record<string, string> = {
  no: "No puedo",
  maybe: "Quizá",
  probably: "Probablemente",
  definitely: "Voy seguro",
};

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Cuenta atrás compacta ("2h 15m", "45m", "Cerrada") — spec punto 15 (countdown UI). */
export function timeLeftLabel(endsAt: Date | string | null | undefined): string {
  if (!endsAt) return "Sin fecha límite";
  const diffMs = new Date(endsAt).getTime() - Date.now();
  if (diffMs <= 0) return "Cerrada";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
