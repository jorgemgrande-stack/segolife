import type { TFunction } from "i18next";

/**
 * comunitySocial.ts — COM-02 (Community Social Results): utilidades
 * compartidas entre ComunityHub.tsx (feed de Results) y
 * ComunityQuestionDetail.tsx (ficha social) — mismo criterio "no duplicar"
 * ya establecido en el resto del repo.
 */

export type QuestionType =
  | "single_choice" | "yes_no" | "percentage_scale" | "scale_1_5"
  | "multiselect" | "ranking" | "attendance_intention" | "me_apunto" | "open_text";

export function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "");
}

/** "hace 2h"/"2h ago" — Intl nativo, sin nuevas claves i18n ni tabla de traducción propia. */
export function relativeTimeLabel(date: Date | string, locale: string): string {
  const diffMs = new Date(date).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const diffMin = Math.round(diffMs / 60000);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, "hour");
  const diffDay = Math.round(diffHour / 24);
  if (Math.abs(diffDay) < 30) return rtf.format(diffDay, "day");
  return new Date(date).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Resultado destacado (spec §34) — UNA frase por tipo REAL de pregunta,
 * generada a partir de los campos que MG-05/communityResultsService.ts YA
 * calculan (nunca un algoritmo universal, spec §34 explícito). `results` usa
 * el tipo `any` ya establecido en esta página para el objeto ProposalResults
 * del servidor (mismo criterio que PublicResults en ComunityQuestionDetail.tsx).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resultHeadline(t: TFunction, qType: QuestionType, results: any): string | null {
  if (!results || results.totalResponses === 0) return null;
  if (qType === "single_choice" || qType === "multiselect") {
    const items = results.singleChoice ?? results.multiselect ?? [];
    if (items.length === 0) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const top = items.reduce((a: any, b: any) => (b.percentage > a.percentage ? b : a));
    return t("comunity.social.resultShareSingleChoice", { label: top.label, percentage: top.percentage });
  }
  if (results.yesNo) return t("comunity.social.resultShareYesNo", { percentage: results.yesNo.yesPercentage });
  if (results.percentageScale?.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const top = results.percentageScale.reduce((a: any, b: any) => (b.average > a.average ? b : a));
    return t("comunity.social.resultSharePercentage", { label: top.label, average: top.average });
  }
  if (results.scale15) return t("comunity.social.resultShareScale", { average: results.scale15.average });
  if (results.ranking?.length) return t("comunity.social.resultShareRanking", { label: results.ranking[0].label });
  if (results.attendanceIntention) return t("comunity.social.resultShareAttendance", { count: results.attendanceIntention.predictedInterested });
  if (results.meApunto) return t("comunity.social.resultShareMeApunto", { count: results.meApunto.count });
  if (results.openText) return t("comunity.social.resultShareOpenText", { count: results.totalResponses });
  return t("comunity.social.resultShareDefault", { count: results.totalResponses });
}

interface MyResponseValue { optionId: number | null; valueText: string | null; valueNumber: number | null }
interface MyResponseShape { values: MyResponseValue[] }

/**
 * "Tu respuesta: X" (spec COM-02B §12) — nunca debe parecer que el voto
 * desapareció al entrar en la ficha social de una propuesta activa. Solo se
 * reconstruye para los tipos donde el resumen es simple e inequívoco
 * (spec §12: "no es imprescindible para todos los tipos si la arquitectura
 * no lo expone limpiamente") — el resto se cubre con el indicador genérico
 * "✓ Ya has participado" en el propio componente, nunca con un resumen
 * inventado o parcial que pudiera confundir.
 */
export function myResponseSummary(
  t: TFunction, qType: QuestionType, myResponse: MyResponseShape | null, options: { id: number; label: string }[]
): string | null {
  if (!myResponse) return null;
  const first = myResponse.values[0];
  if (!first) return null;

  if (qType === "single_choice" && first.optionId != null) {
    const label = options.find(o => o.id === first.optionId)?.label;
    return label ? t("comunity.social.yourResponse", { value: label }) : null;
  }
  if (qType === "yes_no" && first.valueText) {
    return t("comunity.social.yourResponse", { value: first.valueText === "yes" ? t("comunity.yes") : t("comunity.no") });
  }
  if (qType === "scale_1_5" && first.valueNumber != null) {
    return t("comunity.social.yourRating", { value: first.valueNumber });
  }
  if (qType === "attendance_intention" && first.valueText) {
    return t("comunity.social.yourResponse", { value: t(`comunity.attendanceIntention.${first.valueText}`) });
  }
  return null;
}
