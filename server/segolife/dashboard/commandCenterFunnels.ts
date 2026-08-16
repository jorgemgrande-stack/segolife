/**
 * commandCenterFunnels.ts — SEGOLIFE ADMIN COMMAND CENTER (Fase 14, "solo lo
 * nuevo" tras la Fase 12). Funnels de CONVERSIÓN reales (spec §14) —
 * DISTINTOS del "Community Funnel" ya existente
 * (`commandCenterPlanAndPlay.ts::getCommunityFunnel`, spec §22), que es un
 * snapshot de poblaciones con periodo propio por etapa, nunca una secuencia
 * de conversión. Para evitar la confusión de nombres ya documentada en la
 * auditoría de esta fase, este módulo expone 3 funciones con nombre propio
 * — nunca una `getFunnel` genérica.
 *
 * Solo se incluyen etapas con un hecho canónico real detrás (spec §14 "Do
 * not include stages for which no canonical fact exists"): el funnel de
 * Benefits NO incluye "viewed" — auditoría de esta fase confirmó que no
 * existe ninguna columna `viewedAt`/`seenAt` en `user_benefits` ni tracking
 * de vista de detalle; el único proxy (notifications.readAt de la
 * notificación de "Benefit concedido") es best-effort y no garantiza
 * cobertura, así que NO se presenta como un hecho de negocio real.
 */
import { sql } from "drizzle-orm";
import type { AnyDbHandle } from "../tokens/tokenLedgerService";
import type { DashboardFilterContext } from "./dashboardFilters";
import { getBenefitsPerformance } from "./commandCenterLoyalty";

function rowsOf<T>(result: unknown): T[] {
  return (result as unknown as [T[]])[0] ?? [];
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
}

export interface ConversionFunnel {
  stages: FunnelStage[];
  note: string;
}

/**
 * Event funnel (spec §14): "Tickets/orders → issued → attendance" —
 * agregado en TODO el periodo/comunidad filtrados, cruzando eventos (no por
 * evento individual — eso ya lo cubre `commandCenterEvents.ts::getEventPerformance`
 * por fila). Reutiliza EXACTAMENTE los mismos criterios de estado que
 * `commandCenterOverview.ts::getTicketsKpi`/`getAttendanceKpi` (paid /
 * issued|used / occurredAt en rango) — nunca una definición de "válido"
 * distinta a la ya establecida.
 */
export async function getEventFunnel(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<ConversionFunnel> {
  const communityJoin = ctx.communityId != null ? sql`AND user_id IN (SELECT user_id FROM user_communities WHERE community_id = ${ctx.communityId})` : sql``;

  const [ordersResult, issuedResult, attendanceResult] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*) AS n FROM ticket_orders
      WHERE status = 'paid' AND purchased_at >= ${ctx.from} AND purchased_at < ${ctx.to} ${communityJoin}
    `),
    db.execute(sql`
      SELECT COUNT(*) AS n FROM event_tickets et
      JOIN ticket_orders o ON o.id = et.order_id
      WHERE et.status IN ('issued','used') AND o.purchased_at >= ${ctx.from} AND o.purchased_at < ${ctx.to}
      ${ctx.communityId != null ? sql`AND et.user_id IN (SELECT user_id FROM user_communities WHERE community_id = ${ctx.communityId})` : sql``}
    `),
    db.execute(sql`
      SELECT COUNT(*) AS n FROM event_attendance
      WHERE occurred_at >= ${ctx.from} AND occurred_at < ${ctx.to} ${communityJoin}
    `),
  ]);

  const orders = Number(rowsOf<{ n: number | string }>(ordersResult)[0]?.n ?? 0);
  const issued = Number(rowsOf<{ n: number | string }>(issuedResult)[0]?.n ?? 0);
  const attendance = Number(rowsOf<{ n: number | string }>(attendanceResult)[0]?.n ?? 0);

  return {
    stages: [
      { key: "orders_paid", label: "Pedidos pagados", count: orders },
      { key: "tickets_issued", label: "Entradas emitidas", count: issued },
      { key: "attendance", label: "Asistencias confirmadas", count: attendance },
    ],
    note: "Agregado de TODOS los eventos en el periodo/comunidad filtrados — para el desglose por evento individual, ver Event Performance.",
  };
}

/**
 * Referral funnel (spec §14): "link/referral registered → conversion →
 * reward". Auditoría de esta fase confirmó que "ineligible"/"expired"/
 * "cancelled" son valores de enum reservados que ningún código real escribe
 * hoy — se muestran solo si aparecieran (nunca se ocultan silenciosamente),
 * pero las 3 etapas reales del funnel son registered/converted/rewarded.
 */
export async function getReferralFunnel(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<ConversionFunnel> {
  const communityCond = ctx.communityId != null ? sql`AND community_id = ${ctx.communityId}` : sql``;
  const result = await db.execute(sql`
    SELECT status, COUNT(*) AS n FROM referrals
    WHERE registered_at >= ${ctx.from} AND registered_at < ${ctx.to} ${communityCond}
    GROUP BY status
  `);
  const rows = rowsOf<{ status: string; n: number | string }>(result);
  const byStatus = new Map(rows.map(r => [r.status, Number(r.n)]));
  const registered = rows.reduce((sum, r) => sum + Number(r.n), 0);
  const converted = (byStatus.get("converted") ?? 0) + (byStatus.get("rewarded") ?? 0);
  const rewarded = byStatus.get("rewarded") ?? 0;

  return {
    stages: [
      { key: "registered", label: "Referidos registrados", count: registered },
      { key: "converted", label: "Convertidos", count: converted },
      { key: "rewarded", label: "Recompensados", count: rewarded },
    ],
    note: "'Convertidos' incluye también los ya recompensados (todo recompensado pasó primero por convertido).",
  };
}

/**
 * Benefit funnel (spec §14): "granted → redeemed → expired" — reutiliza
 * EXACTAMENTE `getBenefitsPerformance()` (commandCenterLoyalty.ts, ya
 * probado), nunca reimplementa el criterio de "canjeado"/"expirado".
 */
export async function getBenefitFunnel(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<ConversionFunnel> {
  const perf = await getBenefitsPerformance(ctx, db);
  return {
    stages: [
      { key: "granted", label: "Concedidos", count: perf.generated },
      { key: "redeemed", label: "Canjeados", count: perf.redeemed },
      { key: "expired", label: "Expirados", count: perf.expired },
    ],
    note: "Sin etapa 'visto' — no existe ningún hecho canónico de vista de detalle de Benefit en producción (auditado explícitamente, spec §14).",
  };
}
