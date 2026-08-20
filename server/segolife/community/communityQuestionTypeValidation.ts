/**
 * communityQuestionTypeValidation.ts — MG-05. Única semántica de "qué
 * configuración necesita cada tipo de pregunta COMUNITY", compartida entre
 * la propuesta de un Student (community_student_proposals.proposedOptions)
 * y la creación/conversión real de un Admin (community_proposals vía
 * createProposal/convertStudentProposalToFormal) — nunca dos reglas
 * distintas para el mismo concepto.
 *
 * Antes de esta fase, esta regla (mínimo 2 opciones para los tipos que las
 * necesitan) SOLO existía en el cliente (ComunityWizard.tsx/
 * ComunityModeration.tsx) — el servidor nunca la comprobaba, así que
 * cualquier caller de la API podía crear una pregunta imposible
 * (single_choice sin opciones, o yes_no con opciones arbitrarias). Se
 * corrige aquí de forma centralizada y se aplica también a los dos
 * caminos ya existentes de Admin (createProposal/convertStudentProposalToFormal),
 * nunca solo al nuevo camino de Student — "nunca confiar únicamente en
 * React" aplica a todo el dominio, no solo a lo nuevo.
 */
export type ComunityQuestionType =
  | "single_choice" | "yes_no" | "percentage_scale" | "scale_1_5"
  | "multiselect" | "ranking" | "attendance_intention" | "me_apunto" | "open_text";

/** Únicos tipos con opciones/criterios discretos — el resto tiene semántica fija en código (ver comentario de community_options en drizzle/schema.ts). */
export const QUESTION_TYPES_WITH_OPTIONS: readonly ComunityQuestionType[] = [
  "single_choice", "multiselect", "ranking", "percentage_scale",
];

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 20;

export interface QuestionTypeValidationResult {
  ok: boolean;
  error?: string;
  /** Opciones ya saneadas (trim + vacías descartadas) — usar SIEMPRE este valor, nunca el array crudo de entrada. */
  cleanOptions: string[];
}

/**
 * Valida que `options` sea coherente con `questionType`. Nunca lanza —
 * devuelve `{ok:false, error}` para que cada caller decida cómo reportarlo
 * (TRPCError en un router, Error en un helper de BD).
 */
export function validateQuestionTypeOptions(
  questionType: ComunityQuestionType,
  options: string[] | null | undefined
): QuestionTypeValidationResult {
  const cleanOptions = (options ?? []).map(o => o.trim()).filter(Boolean);
  const needsOptions = QUESTION_TYPES_WITH_OPTIONS.includes(questionType);

  if (needsOptions) {
    if (cleanOptions.length < MIN_OPTIONS) {
      return { ok: false, error: `Este tipo de pregunta necesita al menos ${MIN_OPTIONS} opciones`, cleanOptions };
    }
    if (cleanOptions.length > MAX_OPTIONS) {
      return { ok: false, error: `Máximo ${MAX_OPTIONS} opciones`, cleanOptions };
    }
    return { ok: true, cleanOptions };
  }

  // yes_no/scale_1_5/attendance_intention/me_apunto/open_text tienen
  // semántica fija en código — nunca deben llevar opciones (spec MG-05
  // §9: "impedir responseType=yes_no con opciones arbitrarias").
  if (cleanOptions.length > 0) {
    return { ok: false, error: "Este tipo de pregunta no admite opciones", cleanOptions: [] };
  }
  return { ok: true, cleanOptions: [] };
}
