/**
 * communityIntentService.ts — semántica y pesos de "intención de asistencia"
 * (spec punto 6.G, 40) y definición de "respondente positivo" por tipo de
 * pregunta (spec punto 48). Funciones puras — sin I/O, testeables sin BD.
 *
 * Pesos DOCUMENTADOS como heurística inicial (spec punto 40: "dar pesos
 * analíticos... conceptual"), no una medición estadística — se muestran
 * siempre junto al dato bruto, nunca reemplazándolo (spec: "resultados
 * brutos siempre visibles por separado").
 */
import type { CommunityProposal, CommunityOption, CommunityResponseValue } from "../../../drizzle/schema";

export type AttendanceIntentionValue = "no" | "maybe" | "probably" | "definitely";

export const ATTENDANCE_INTENTION_VALUES: AttendanceIntentionValue[] = ["no", "maybe", "probably", "definitely"];

/** Código entero persistido en community_response_values.value_number. */
export const ATTENDANCE_INTENTION_CODES: Record<AttendanceIntentionValue, number> = {
  no: 0, maybe: 1, probably: 2, definitely: 3,
};

export function attendanceIntentionFromCode(code: number): AttendanceIntentionValue {
  return ATTENDANCE_INTENTION_VALUES[code] ?? "no";
}

/** Peso analítico 0-1 — spec punto 40, ejemplo conceptual explícito del propio encargo. */
export const ATTENDANCE_INTENTION_WEIGHTS: Record<AttendanceIntentionValue, number> = {
  no: 0, maybe: 0.35, probably: 0.70, definitely: 1.00,
};

export function isPositiveAttendanceIntention(value: AttendanceIntentionValue): boolean {
  return value === "probably" || value === "definitely";
}

/**
 * "Respondente positivo" (spec punto 48) — depende del tipo de pregunta.
 * Para tipos sin semántica de intención clara (percentage_scale, ranking,
 * open_text, scale_1_5 sin threshold definido) devuelve `null` — NUNCA
 * infiere positividad donde no hay una regla explícita (principio general
 * de esta feature: "no inferir incorrectamente").
 */
export function isPositiveRespondent(
  proposal: Pick<CommunityProposal, "questionType">,
  values: CommunityResponseValue[],
  options: CommunityOption[]
): boolean | null {
  switch (proposal.questionType) {
    case "yes_no":
      return values[0]?.valueText === "yes";
    case "attendance_intention": {
      const code = values[0]?.valueNumber;
      if (code == null) return null;
      return isPositiveAttendanceIntention(attendanceIntentionFromCode(code));
    }
    case "me_apunto":
      // Responder ES la señal — intención fuerte por definición (spec punto 6.H).
      return values.length > 0;
    case "single_choice": {
      const optionId = values[0]?.optionId;
      if (optionId == null) return null;
      const option = options.find(o => o.id === optionId);
      return option ? option.isPositiveIntent : null;
    }
    default:
      return null;
  }
}
