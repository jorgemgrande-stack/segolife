/**
 * benefitValidityEngine.ts — cálculo puro (sin BD) de la ventana de vigencia
 * (valid_from/valid_until) de un Benefit a partir de una `benefit_rules` y el
 * instante en que se disparó el origen (p.ej. el canje de un QR de
 * consumición). Ver drizzle/schema.ts, comentario de benefit_rules, para el
 * mapeo completo de los 3 `validity_type` a los 7 casos de vigencia pedidos
 * (inmediato / offset / mañana / fecha concreta / N horas / hasta una hora /
 * N días) — todos se expresan combinando estos 3 tipos con sus campos.
 *
 * ZONA HORARIA: reutiliza `resolveMadridMoment` de tokenScheduleService.ts
 * (Fase 2) — nunca se añade una librería de zonas horarias nueva. La
 * conversión inversa (wall-clock Madrid → instante UTC real) usa una única
 * pasada de corrección: Europe/Madrid nunca tiene un offset de fracción de
 * hora (solo +1 CET / +2 CEST), así que medir el offset real en el instante
 * candidato y corregir una vez es exacto — no hace falta iterar. El único
 * caso límite no resuelto explícitamente es una hora de pared que cae en el
 * hueco inexistente del cambio de horario de primavera (venue nunca opera a
 * esa hora en la práctica) — ver benefitValidityEngine.test.ts para los
 * casos de medianoche/DST verificados.
 */
import { resolveMadridMoment } from "../tokens/tokenScheduleService";
import { resolveOperationalDate } from "../venues/venueVisitService";

export type ValidityType = "immediate" | "offset" | "day_anchored";

export interface ValidityRuleInput {
  validityType: ValidityType;
  validityOffsetMinutes?: number | null;
  validityDurationMinutes?: number | null;
  validityStartTime?: string | null;
  validityEndTime?: string | null;
  validityDaysOffset?: number | null;
}

export interface ValidityWindow {
  validFrom: Date;
  validUntil: Date | null;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Aritmética de fecha calendario pura (sin hora) — se hace en UTC a propósito para no arrastrar ningún desfase de zona horaria en un cálculo que es solo "día + N". */
function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, mo - 1, d) + days * 86400000);
  const yy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Convierte una hora de pared en Europe/Madrid ("YYYY-MM-DD" + "HH:MM") al instante UTC real correspondiente, corrigiendo CET/CEST en una sola pasada (ver cabecera del archivo). */
export function madridWallTimeToUtc(dateStr: string, timeStr: string): Date {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const guessUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  const madridAtGuess = resolveMadridMoment(new Date(guessUtc));
  const [gy, gmo, gd] = madridAtGuess.date.split("-").map(Number);
  const [gh, gmi] = madridAtGuess.time.split(":").map(Number);
  const madridAsUtcMillis = Date.UTC(gy, gmo - 1, gd, gh, gmi, 0);
  const offsetMs = madridAsUtcMillis - guessUtc;
  return new Date(guessUtc - offsetMs);
}

function computeDayAnchoredWindow(rule: ValidityRuleInput, triggerAt: Date): ValidityWindow {
  // SEGOLIFE — BEHAVIORAL BENEFITS RULE ENGINE (Fase 6, spec §10, "TARGET
  // VENUE / TARGET EVENT" y el ejemplo de "mañana" resuelto explícitamente):
  // el ancla usa el día OPERATIVO (corte 06:00 Europe/Madrid, mismo criterio
  // que venue_visits.operational_date), NUNCA el día de calendario plano del
  // instante del trigger. Antes de esta corrección, un check-in a las 00:45
  // del sábado (que pertenece a la noche del viernes) calculaba
  // days_offset=1 como domingo — un día de más — porque partía del día de
  // calendario (sábado) en vez del día operativo al que realmente pertenece
  // el hecho (viernes). Con el día operativo como ancla: viernes + 1 =
  // sábado, que es lo que el negocio realmente quiere decir con "mañana".
  const anchorDate = addDaysToDateStr(resolveOperationalDate(triggerAt), rule.validityDaysOffset ?? 0);

  const validFrom = rule.validityStartTime
    ? madridWallTimeToUtc(anchorDate, rule.validityStartTime)
    : triggerAt;

  let validUntil: Date | null = null;
  if (rule.validityEndTime) {
    const endMinutes = timeToMinutes(rule.validityEndTime);
    const startMinutes = rule.validityStartTime ? timeToMinutes(rule.validityStartTime) : null;
    // Si end <= start (con start definido), la ventana cruza medianoche —
    // mismo criterio que venue_token_schedules (Fase 2).
    const crossesMidnight = startMinutes != null && endMinutes <= startMinutes;
    const endDate = crossesMidnight ? addDaysToDateStr(anchorDate, 1) : anchorDate;
    validUntil = madridWallTimeToUtc(endDate, rule.validityEndTime);
  }

  return { validFrom, validUntil };
}

/**
 * Punto de entrada único del motor de vigencia. `triggerAt` es el instante
 * real del evento origen (p.ej. el momento del canje del QR de consumición,
 * NO "ahora" si se recalculara más tarde) — todas las ventanas se anclan a
 * ese instante, nunca al momento en que corre este código.
 */
export function computeValidityWindow(rule: ValidityRuleInput, triggerAt: Date): ValidityWindow {
  if (rule.validityType === "immediate") {
    const validUntil = rule.validityDurationMinutes != null
      ? new Date(triggerAt.getTime() + rule.validityDurationMinutes * 60000)
      : null;
    return { validFrom: triggerAt, validUntil };
  }

  if (rule.validityType === "offset") {
    const validFrom = new Date(triggerAt.getTime() + (rule.validityOffsetMinutes ?? 0) * 60000);
    const validUntil = rule.validityDurationMinutes != null
      ? new Date(validFrom.getTime() + rule.validityDurationMinutes * 60000)
      : null;
    return { validFrom, validUntil };
  }

  return computeDayAnchoredWindow(rule, triggerAt);
}
