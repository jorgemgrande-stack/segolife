/**
 * communityResultsService.ts — resultados agregados SERVER-SIDE (spec punto
 * 63: "no traer 2000 respuestas al frontend para calcular porcentajes").
 * Una forma de resultado distinta por tipo de pregunta — mismo criterio que
 * community_response_values (equilibrio entre JSON y N tablas, spec 66).
 */
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  communityOptions, communityResponses, communityResponseValues, users,
} from "../../../drizzle/schema";
import { getProposalById, type AnyDbHandle } from "./communityDb";
import { ATTENDANCE_INTENTION_VALUES, ATTENDANCE_INTENTION_WEIGHTS, attendanceIntentionFromCode } from "./communityIntentService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);
type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export interface OptionCount {
  optionId: number;
  label: string;
  count: number;
  percentage: number;
}

export interface ProposalResults {
  totalResponses: number;
  totalAudience: number;
  participationRate: number;
  // Solo el bloque correspondiente al questionType de la propuesta viene poblado.
  singleChoice?: OptionCount[];
  yesNo?: { yes: number; no: number; yesPercentage: number };
  percentageScale?: { optionId: number; label: string; average: number; count: number }[];
  scale15?: { average: number; distribution: Record<number, number> };
  multiselect?: OptionCount[];
  ranking?: { optionId: number; label: string; averageRank: number; topChoiceCount: number }[];
  attendanceIntention?: {
    breakdown: Record<string, number>;
    predictedInterested: number;
    predictedStrongIntent: number;
  };
  meApunto?: { count: number };
  openText?: { id: number; text: string; isFeatured: boolean; isHidden: boolean; createdAt: Date }[];
}

async function countAudience(proposalId: number, conn: DbHandle): Promise<number> {
  const { communityProposalAudiences } = await import("../../../drizzle/schema");
  const [row] = await conn.select({ count: sql<number>`COUNT(*)` }).from(communityProposalAudiences)
    .where(eq(communityProposalAudiences.proposalId, proposalId));
  return Number(row?.count ?? 0);
}

/** includeHidden: solo para vista admin — el estudiante nunca ve open_text ocultos. */
export async function getProposalResults(proposalId: number, includeHidden = false, db?: AnyDbHandle): Promise<ProposalResults | null> {
  const conn = (db ?? (await getDb())) as DbHandle;
  const proposal = await getProposalById(proposalId, conn);
  if (!proposal) return null;

  const [totalResponses, totalAudience] = await Promise.all([
    conn.select({ count: sql<number>`COUNT(*)` }).from(communityResponses).where(eq(communityResponses.proposalId, proposalId)).then(r => Number(r[0]?.count ?? 0)),
    countAudience(proposalId, conn),
  ]);

  const base: ProposalResults = {
    totalResponses,
    totalAudience,
    participationRate: totalAudience > 0 ? Math.round((totalResponses / totalAudience) * 100) : 0,
  };

  const options = await conn.select().from(communityOptions).where(eq(communityOptions.proposalId, proposalId)).orderBy(communityOptions.sortOrder);
  const labelById = new Map(options.map(o => [o.id, o.label]));

  switch (proposal.questionType) {
    case "single_choice":
    case "multiselect": {
      const rows = await conn.select({ optionId: communityResponseValues.optionId, count: sql<number>`COUNT(*)` })
        .from(communityResponseValues)
        .innerJoin(communityResponses, eq(communityResponseValues.responseId, communityResponses.id))
        .where(eq(communityResponses.proposalId, proposalId))
        .groupBy(communityResponseValues.optionId);
      const denominator = proposal.questionType === "single_choice" ? totalResponses : totalResponses;
      const items: OptionCount[] = options.map(o => {
        const found = rows.find(r => r.optionId === o.id);
        const count = found ? Number(found.count) : 0;
        return { optionId: o.id, label: o.label, count, percentage: denominator > 0 ? Math.round((count / denominator) * 100) : 0 };
      });
      if (proposal.questionType === "single_choice") base.singleChoice = items;
      else base.multiselect = items;
      break;
    }
    case "yes_no": {
      const rows = await conn.select({ value: communityResponseValues.valueText, count: sql<number>`COUNT(*)` })
        .from(communityResponseValues)
        .innerJoin(communityResponses, eq(communityResponseValues.responseId, communityResponses.id))
        .where(eq(communityResponses.proposalId, proposalId))
        .groupBy(communityResponseValues.valueText);
      const yes = Number(rows.find(r => r.value === "yes")?.count ?? 0);
      const no = Number(rows.find(r => r.value === "no")?.count ?? 0);
      base.yesNo = { yes, no, yesPercentage: totalResponses > 0 ? Math.round((yes / totalResponses) * 100) : 0 };
      break;
    }
    case "percentage_scale": {
      const rows = await conn.select({
        optionId: communityResponseValues.optionId,
        avg: sql<string>`AVG(${communityResponseValues.valueNumber})`,
        count: sql<number>`COUNT(*)`,
      }).from(communityResponseValues)
        .innerJoin(communityResponses, eq(communityResponseValues.responseId, communityResponses.id))
        .where(eq(communityResponses.proposalId, proposalId))
        .groupBy(communityResponseValues.optionId);
      base.percentageScale = options.map(o => {
        const found = rows.find(r => r.optionId === o.id);
        return { optionId: o.id, label: o.label, average: found ? Math.round(Number(found.avg)) : 0, count: found ? Number(found.count) : 0 };
      });
      break;
    }
    case "scale_1_5": {
      const rows = await conn.select({
        value: communityResponseValues.valueNumber,
        count: sql<number>`COUNT(*)`,
      }).from(communityResponseValues)
        .innerJoin(communityResponses, eq(communityResponseValues.responseId, communityResponses.id))
        .where(eq(communityResponses.proposalId, proposalId))
        .groupBy(communityResponseValues.valueNumber);
      const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let sum = 0;
      for (const r of rows) {
        const v = Number(r.value);
        if (v >= 1 && v <= 5) { distribution[v] = Number(r.count); sum += v * Number(r.count); }
      }
      base.scale15 = { average: totalResponses > 0 ? Math.round((sum / totalResponses) * 10) / 10 : 0, distribution };
      break;
    }
    case "ranking": {
      const rows = await conn.select({
        optionId: communityResponseValues.optionId,
        avgRank: sql<string>`AVG(${communityResponseValues.valueNumber})`,
        topChoiceCount: sql<number>`SUM(CASE WHEN ${communityResponseValues.valueNumber} = 1 THEN 1 ELSE 0 END)`,
      }).from(communityResponseValues)
        .innerJoin(communityResponses, eq(communityResponseValues.responseId, communityResponses.id))
        .where(eq(communityResponses.proposalId, proposalId))
        .groupBy(communityResponseValues.optionId);
      base.ranking = options.map(o => {
        const found = rows.find(r => r.optionId === o.id);
        return {
          optionId: o.id, label: o.label,
          averageRank: found ? Math.round(Number(found.avgRank) * 10) / 10 : 0,
          topChoiceCount: found ? Number(found.topChoiceCount) : 0,
        };
      }).sort((a, b) => a.averageRank - b.averageRank);
      break;
    }
    case "attendance_intention": {
      const rows = await conn.select({ code: communityResponseValues.valueNumber, count: sql<number>`COUNT(*)` })
        .from(communityResponseValues)
        .innerJoin(communityResponses, eq(communityResponseValues.responseId, communityResponses.id))
        .where(eq(communityResponses.proposalId, proposalId))
        .groupBy(communityResponseValues.valueNumber);
      const breakdown: Record<string, number> = { no: 0, maybe: 0, probably: 0, definitely: 0 };
      let predictedInterested = 0;
      for (const r of rows) {
        const value = attendanceIntentionFromCode(Number(r.code));
        breakdown[value] = Number(r.count);
        predictedInterested += Number(r.count) * ATTENDANCE_INTENTION_WEIGHTS[value];
      }
      base.attendanceIntention = {
        breakdown,
        predictedInterested: Math.round(predictedInterested),
        predictedStrongIntent: breakdown.definitely,
      };
      break;
    }
    case "me_apunto": {
      base.meApunto = { count: totalResponses };
      break;
    }
    case "open_text": {
      const conditions = [eq(communityResponses.proposalId, proposalId)];
      if (!includeHidden) conditions.push(eq(communityResponseValues.isHidden, false));
      const rows = await conn.select({
        id: communityResponseValues.id,
        text: communityResponseValues.valueText,
        isFeatured: communityResponseValues.isFeatured,
        isHidden: communityResponseValues.isHidden,
        createdAt: communityResponseValues.createdAt,
      }).from(communityResponseValues)
        .innerJoin(communityResponses, eq(communityResponseValues.responseId, communityResponses.id))
        .where(and(...conditions))
        .orderBy(desc(communityResponseValues.createdAt))
        .limit(500);
      base.openText = rows.map(r => ({ id: r.id, text: r.text ?? "", isFeatured: r.isFeatured, isHidden: r.isHidden, createdAt: r.createdAt }));
      break;
    }
  }

  return base;
}

export interface ProposalRespondent {
  userId: number;
  name: string | null;
  hasAvatar: boolean;
}

export interface ProposalRespondentsPage {
  total: number;
  items: ProposalRespondent[];
}

/**
 * Lista de estudiantes que respondieron — petición del cliente (2026-08-22,
 * captura): mostrar hasta 5 nombres/avatares y un "+N" clicable al estilo
 * Instagram. NUNCA se llama sin comprobar antes, en el router
 * (community.ts::getRespondents), que quien pregunta pertenece a la
 * audiencia de esta propuesta Y que sus resultados son visibles
 * (computeResultsVisible) — esta función en sí no reautoriza nada.
 *
 * `hasAvatar` en vez de una URL directa: la foto real se sirve por una ruta
 * REST dedicada y auditada aparte (communityRespondentPhotoRoutes.ts) que
 * revalida la misma pertenencia a la audiencia en cada petición — nunca la
 * ruta genérica /api/students/:userId/photo (esa es deliberadamente
 * self/admin-only, spec §10 de studentPhotoRoutes.ts, y no se toca aquí).
 */
export async function getProposalRespondents(proposalId: number, opts: { limit: number; offset: number }, db?: AnyDbHandle): Promise<ProposalRespondentsPage> {
  const conn = (db ?? (await getDb())) as DbHandle;

  const [totalRow] = await conn.select({ count: sql<number>`COUNT(*)` }).from(communityResponses).where(eq(communityResponses.proposalId, proposalId));
  const total = Number(totalRow?.count ?? 0);
  if (total === 0) return { total: 0, items: [] };

  const rows = await conn.select({ userId: communityResponses.userId })
    .from(communityResponses)
    .where(eq(communityResponses.proposalId, proposalId))
    .orderBy(desc(communityResponses.respondedAt))
    .limit(opts.limit).offset(opts.offset);
  if (rows.length === 0) return { total, items: [] };

  const userIds = rows.map(r => r.userId);
  const userRows = await conn.select({ id: users.id, name: users.name, avatarStorageKey: users.avatarStorageKey })
    .from(users).where(inArray(users.id, userIds));
  const byId = new Map(userRows.map(u => [u.id, u]));

  const items: ProposalRespondent[] = rows.map(r => {
    const u = byId.get(r.userId);
    return { userId: r.userId, name: u?.name ?? null, hasAvatar: !!u?.avatarStorageKey };
  });
  return { total, items };
}

/** true si userId está entre quienes ya respondieron a esta propuesta — usado por la ruta de foto para no exponer la foto de un estudiante que ni siquiera respondió. */
export async function isProposalRespondent(proposalId: number, userId: number, db?: AnyDbHandle): Promise<boolean> {
  const conn = (db ?? (await getDb())) as DbHandle;
  const [row] = await conn.select({ id: communityResponses.id }).from(communityResponses)
    .where(and(eq(communityResponses.proposalId, proposalId), eq(communityResponses.userId, userId))).limit(1);
  return !!row;
}
