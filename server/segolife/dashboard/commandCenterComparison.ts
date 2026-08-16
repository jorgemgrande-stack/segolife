/**
 * commandCenterComparison.ts — SEGOLIFE ADMIN COMMAND CENTER (Fase 14, "solo
 * lo nuevo" tras la Fase 12). Motor GENÉRICO de comparación contra el
 * periodo anterior equivalente — auditoría de esta fase confirmó que
 * `dashboardFilters.ts` no tenía ningún helper de este tipo (Fase 12 solo
 * resolvía `{from,to}` del periodo actual, nunca el anterior).
 *
 * Semántica (spec §19, documentada aquí una única vez): el periodo anterior
 * tiene EXACTAMENTE la misma duración que el actual, terminando justo donde
 * empieza el actual — `[from - (to-from), from)`. Así "hoy" (día nocturno)
 * se compara con "la noche operativa anterior", "7 días" con "los 7 días
 * anteriores a esos", etc. — nunca un "día completo aleatorio" (spec §19,
 * ejemplo explícito).
 *
 * Puro, sin I/O — solo aritmética de fechas y el cálculo de delta. Cada
 * módulo de Command Center decide QUÉ contar en el periodo anterior
 * (reejecutando su propia query con el `DashboardFilterContext` anterior
 * que devuelve `previousPeriodContext`), este archivo nunca vuelve a
 * definir agregados de negocio.
 */
import type { DashboardFilterContext } from "./dashboardFilters";

export interface PeriodComparison {
  current: number;
  previous: number;
  /** Diferencia relativa en % (redondeada a 1 decimal). `null` si previous=0 y current=0 (nada que comparar) o si previous=0 y current>0 (variación no representable como %, se reporta como null — nunca "Infinity%"). */
  deltaPct: number | null;
  /** Diferencia absoluta, siempre calculable. */
  deltaAbs: number;
  direction: "up" | "down" | "flat";
}

/**
 * Dado el contexto de filtro ACTUAL, calcula el contexto del periodo
 * ANTERIOR equivalente (misma duración, mismo communityId — nunca se
 * cambia la comunidad al comparar). `rangeLabel` se preserva para que el
 * consumidor sepa qué comparación semántica está viendo.
 */
export function previousPeriodContext(ctx: DashboardFilterContext): DashboardFilterContext {
  const durationMs = ctx.to.getTime() - ctx.from.getTime();
  return {
    communityId: ctx.communityId,
    from: new Date(ctx.from.getTime() - durationMs),
    to: new Date(ctx.from.getTime()),
    rangeLabel: ctx.rangeLabel,
  };
}

export function comparePeriods(current: number, previous: number): PeriodComparison {
  const deltaAbs = current - previous;
  let deltaPct: number | null;
  if (previous === 0) {
    deltaPct = current === 0 ? null : null; // spec §19 — nunca "Infinity%"; se reporta el delta absoluto y se deja deltaPct en null.
  } else {
    deltaPct = Math.round((deltaAbs / previous) * 1000) / 10;
  }
  const direction: PeriodComparison["direction"] = deltaAbs > 0 ? "up" : deltaAbs < 0 ? "down" : "flat";
  return { current, previous, deltaPct, deltaAbs, direction };
}
