/**
 * commandCenterPlanAndPlay.ts — SEGOLIFE ADMIN COMMAND CENTER. `dashboard.getPlanAndPlay`
 * (spec §21) y `dashboard.getCommunityFunnel` (spec §22).
 *
 * PLAN & PLAY (spec §1.1, decisión cerrada): "PLAN & PLAY" es SOLO una capa
 * de marca en la UI — el backend sigue siendo "Comunity"
 * (community_proposals/community_responses/community_supports/
 * community_student_proposals). Este módulo NUNCA crea una tabla ni lógica
 * paralela, solo LEE el backend real ya existente.
 *
 * COMMUNITY FUNNEL: cada etapa declara su PROPIA población y periodo (spec
 * §22) — nunca se calcula un % entre dos etapas de poblaciones distintas
 * (p.ej. "Historical Audience" es TODO el histórico, sin periodo; "Active
 * Students" es del rango de filtro actual). El frontend debe mostrar cada
 * etapa con su propia nota, nunca una barra de embudo que implique
 * comparabilidad directa entre poblaciones incompatibles.
 */
import { sql } from "drizzle-orm";
import type { AnyDbHandle } from "../tokens/tokenLedgerService";
import type { DashboardFilterContext } from "./dashboardFilters";
import { countActiveStudents, distinctVenuesByStudent } from "./activitySignals";
import { getHistoricalIdentityStats } from "../students/historicalIdentityService";

function rowsOf<T>(result: unknown): T[] {
  return (result as unknown as [T[]])[0] ?? [];
}

export interface EndingSoonProposal {
  proposalId: number;
  title: string;
  endsAt: string | null;
}

export interface MostActiveProposal {
  proposalId: number;
  title: string;
  responseCount: number;
  topAnswerLabel: string | null;
  topAnswerPct: number | null;
}

export interface PlanAndPlaySnapshot {
  activeProposals: number;
  responsesInPeriod: number;
  participationPct: number | null;
  pendingModerationStudentProposals: number;
  endingSoon: EndingSoonProposal[];
  mostActive: MostActiveProposal | null;
}

const ENDING_SOON_HOURS = 72;

export async function getPlanAndPlay(ctx: DashboardFilterContext, db: AnyDbHandle, now: Date = ctx.to): Promise<PlanAndPlaySnapshot> {
  const proposalCommunityJoin = ctx.communityId != null ? sql`JOIN community_proposal_communities cpc ON cpc.proposal_id = cp.id AND cpc.community_id = ${ctx.communityId}` : sql``;
  const soonThreshold = new Date(now.getTime() + ENDING_SOON_HOURS * 60 * 60 * 1000);

  const [activeCountResult, responsesResult, audienceResult, pendingModerationResult, endingSoonResult] = await Promise.all([
    db.execute(sql`SELECT COUNT(DISTINCT cp.id) AS n FROM community_proposals cp ${proposalCommunityJoin} WHERE cp.status = 'active'`),
    db.execute(sql`
      SELECT COUNT(*) AS n FROM community_responses cr
      JOIN community_proposals cp ON cp.id = cr.proposal_id ${proposalCommunityJoin}
      WHERE cr.responded_at >= ${ctx.from} AND cr.responded_at < ${ctx.to}
    `),
    // Audiencia de las propuestas ACTIVAS hoy (snapshot al publicar, spec) — denominador real de participación, nunca el total de Students.
    db.execute(sql`
      SELECT COUNT(*) AS n FROM community_proposal_audiences cpa
      JOIN community_proposals cp ON cp.id = cpa.proposal_id ${proposalCommunityJoin}
      WHERE cp.status = 'active'
    `),
    ctx.communityId != null
      ? db.execute(sql`SELECT COUNT(*) AS n FROM community_student_proposals WHERE status = 'pending_moderation' AND community_id = ${ctx.communityId}`)
      : db.execute(sql`SELECT COUNT(*) AS n FROM community_student_proposals WHERE status = 'pending_moderation'`),
    db.execute(sql`
      SELECT cp.id AS proposal_id, cp.title AS title, cp.ends_at AS ends_at
      FROM community_proposals cp ${proposalCommunityJoin}
      WHERE cp.status = 'active' AND cp.ends_at IS NOT NULL AND cp.ends_at >= ${now} AND cp.ends_at <= ${soonThreshold}
      ORDER BY cp.ends_at ASC
      LIMIT 10
    `),
  ]);

  const activeProposals = Number(rowsOf<{ n: number | string }>(activeCountResult)[0]?.n ?? 0);
  const responsesInPeriod = Number(rowsOf<{ n: number | string }>(responsesResult)[0]?.n ?? 0);
  const audienceSize = Number(rowsOf<{ n: number | string }>(audienceResult)[0]?.n ?? 0);
  const pendingModerationStudentProposals = Number(rowsOf<{ n: number | string }>(pendingModerationResult)[0]?.n ?? 0);
  const endingSoon = rowsOf<{ proposal_id: number; title: string; ends_at: string | null }>(endingSoonResult)
    .map(r => ({ proposalId: Number(r.proposal_id), title: r.title, endsAt: r.ends_at != null ? String(r.ends_at) : null }));

  const mostActive = await getMostActiveProposal(ctx, db);

  return {
    activeProposals,
    responsesInPeriod,
    participationPct: audienceSize > 0 ? Math.round((responsesInPeriod / audienceSize) * 1000) / 10 : null,
    pendingModerationStudentProposals,
    endingSoon,
    mostActive,
  };
}

async function getMostActiveProposal(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<MostActiveProposal | null> {
  const proposalCommunityJoin = ctx.communityId != null ? sql`JOIN community_proposal_communities cpc ON cpc.proposal_id = cp.id AND cpc.community_id = ${ctx.communityId}` : sql``;

  const rankingResult = await db.execute(sql`
    SELECT cp.id AS proposal_id, cp.title AS title, cp.min_sample_size AS min_sample_size, COUNT(cr.id) AS response_count
    FROM community_proposals cp ${proposalCommunityJoin}
    JOIN community_responses cr ON cr.proposal_id = cp.id
    WHERE cr.responded_at >= ${ctx.from} AND cr.responded_at < ${ctx.to}
    GROUP BY cp.id, cp.title, cp.min_sample_size
    ORDER BY response_count DESC
    LIMIT 1
  `);
  const top = rowsOf<{ proposal_id: number; title: string; min_sample_size: number; response_count: number | string }>(rankingResult)[0];
  if (!top) return null;
  const responseCount = Number(top.response_count);
  const minSampleSize = Number(top.min_sample_size ?? 5);

  // Anonimato (spec): nunca desglosar una muestra por debajo del mínimo configurado en la propia propuesta.
  if (responseCount < minSampleSize) {
    return { proposalId: Number(top.proposal_id), title: top.title, responseCount, topAnswerLabel: null, topAnswerPct: null };
  }

  const answerResult = await db.execute(sql`
    SELECT COALESCE(co.label, crv.value_text) AS label, COUNT(*) AS n
    FROM community_response_values crv
    JOIN community_responses cr ON cr.id = crv.response_id
    LEFT JOIN community_options co ON co.id = crv.option_id
    WHERE cr.proposal_id = ${top.proposal_id}
    GROUP BY COALESCE(co.label, crv.value_text)
    ORDER BY n DESC
    LIMIT 1
  `);
  const answer = rowsOf<{ label: string | null; n: number | string }>(answerResult)[0];

  return {
    proposalId: Number(top.proposal_id), title: top.title, responseCount,
    topAnswerLabel: answer?.label ?? null,
    topAnswerPct: answer && responseCount > 0 ? Math.round((Number(answer.n) / responseCount) * 1000) / 10 : null,
  };
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  population: string;
  period: string;
}

export interface CommunityFunnelSnapshot {
  stages: FunnelStage[];
  note: string;
}

export async function getCommunityFunnel(ctx: DashboardFilterContext, db: AnyDbHandle): Promise<CommunityFunnelSnapshot> {
  const communityUserJoin = ctx.communityId != null ? sql`AND user_id IN (SELECT user_id FROM user_communities WHERE community_id = ${ctx.communityId})` : sql``;
  const registeredCommunityCond = ctx.communityId != null ? sql`JOIN user_communities uc ON uc.user_id = u.id AND uc.community_id = ${ctx.communityId}` : sql``;

  const [historical, registeredResult, activeStudents, purchasersResult, attendeesResult, loyaltyResult, benefitsResult, venuesMap] = await Promise.all([
    getHistoricalIdentityStats(db as never),
    db.execute(sql`SELECT COUNT(DISTINCT u.id) AS n FROM users u JOIN student_profiles sp ON sp.user_id = u.id ${registeredCommunityCond}`),
    countActiveStudents(ctx.from, ctx.to, ctx.communityId, db),
    db.execute(sql`SELECT COUNT(DISTINCT user_id) AS n FROM ticket_orders WHERE status = 'paid' AND user_id IS NOT NULL AND purchased_at >= ${ctx.from} AND purchased_at < ${ctx.to} ${communityUserJoin}`),
    db.execute(sql`SELECT COUNT(DISTINCT user_id) AS n FROM event_attendance WHERE occurred_at >= ${ctx.from} AND occurred_at < ${ctx.to} ${communityUserJoin}`),
    db.execute(sql`SELECT COUNT(DISTINCT user_id) AS n FROM token_ledger WHERE created_at >= ${ctx.from} AND created_at < ${ctx.to} ${communityUserJoin}`),
    db.execute(sql`SELECT COUNT(DISTINCT user_id) AS n FROM user_benefits WHERE used_at >= ${ctx.from} AND used_at < ${ctx.to} ${communityUserJoin}`),
    distinctVenuesByStudent(db),
  ]);

  const registered = Number(rowsOf<{ n: number | string }>(registeredResult)[0]?.n ?? 0);
  const purchasers = Number(rowsOf<{ n: number | string }>(purchasersResult)[0]?.n ?? 0);
  const attendees = Number(rowsOf<{ n: number | string }>(attendeesResult)[0]?.n ?? 0);
  const loyaltyParticipants = Number(rowsOf<{ n: number | string }>(loyaltyResult)[0]?.n ?? 0);
  const benefitRedeemers = Number(rowsOf<{ n: number | string }>(benefitsResult)[0]?.n ?? 0);
  const multiVenue = Array.from(venuesMap.values()).filter(v => v >= 2).length;

  const periodLabel = `${ctx.from.toISOString().slice(0, 10)} → ${ctx.to.toISOString().slice(0, 10)}`;

  const stages: FunnelStage[] = [
    { key: "historical_audience", label: "Historical Audience", count: historical.total, population: "Identidades históricas (Fourvenues), no Students registrados", period: "Histórico completo (sin periodo)" },
    { key: "registered_students", label: "Registered Students", count: registered, population: "Students con cuenta registrada", period: "Total acumulado (sin periodo)" },
    { key: "active_students", label: "Active Students", count: activeStudents, population: "Students registrados con actividad genuina", period: periodLabel },
    { key: "purchasers", label: "Purchasers", count: purchasers, population: "Students registrados con >=1 pedido pagado", period: periodLabel },
    { key: "attendees", label: "Attendees", count: attendees, population: "Students registrados con >=1 asistencia confirmada", period: periodLabel },
    { key: "loyalty_participants", label: "Loyalty Participants", count: loyaltyParticipants, population: "Students registrados con >=1 movimiento de SegoTokens (LIVE OFF)", period: periodLabel },
    { key: "benefit_redeemers", label: "Benefit Redeemers", count: benefitRedeemers, population: "Students registrados que canjearon >=1 Benefit", period: periodLabel },
    { key: "multi_venue", label: "Multi-Venue", count: multiVenue, population: "Students registrados con actividad en >=2 venues", period: "Histórico completo (sin periodo)" },
  ];

  return {
    stages,
    note: "Cada etapa usa su PROPIA población y periodo (ver columna 'population'/'period') — no son directamente comparables como % de una etapa anterior salvo que ambas compartan población y periodo.",
  };
}
