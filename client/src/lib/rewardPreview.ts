import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type RouterOutputs = inferRouterOutputs<AppRouter>;

/**
 * Tipo del read model de Student (Fase 10.6) — inferido DIRECTAMENTE del
 * router, nunca redeclarado a mano: si el shape de
 * studentRewardPreviewService.ts cambia, este tipo cambia solo.
 */
export type StudentRewardPreview = RouterOutputs["tokens"]["previewMyEventReward"];

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/**
 * Texto corto para una card de evento/venue en una lista (Fase 10.6, spec
 * §31) — SIEMPRE deriva el número/tasa de un StudentRewardPreview real
 * (batch previewMy*RewardBatch), nunca de una constante local. Prioridad:
 * recompensa condicional real (asistencia, calc_method fixed → siempre
 * calculable sin importe) > tasa efectiva de la garantizada (cuando el
 * importe todavía no se conoce) > importe garantizado ya calculado.
 */
export function formatCardRewardBadge(preview: StudentRewardPreview | undefined, t: TFn): string | null {
  if (!preview) return null;
  const conditional = preview.conditionalRewards.find(r => r.eligible && r.totalTokens > 0);
  if (conditional) return t("rewardPreview.cardBadgeUpTo", { amount: conditional.totalTokens });
  if (preview.totalGuaranteedTokens > 0) return t("rewardPreview.cardBadgeGuaranteed", { amount: preview.totalGuaranteedTokens });
  if (preview.effectiveRate) return t("rewardPreview.cardBadgeRate", { rate: preview.effectiveRate });
  return null;
}
