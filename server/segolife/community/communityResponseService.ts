/**
 * communityResponseService.ts — envío de respuestas (los 9 tipos de
 * pregunta, spec punto 6) + agregación de resultados server-side (spec
 * punto 63: "nunca traer 2000 respuestas al frontend para calcular
 * porcentajes"). Idempotencia: UNIQUE(proposal,user) en community_responses
 * (spec punto 27/67); la recompensa de SegoTokens se concede como mucho una
 * vez por (proposal,user) vía el flag `reward_granted` (spec punto 77: "si
 * cambia respuesta, NO volver a premiar").
 *
 * SEGOTOKENS (SEGOLIFE — COMMUNITY Production Implementation): la recompensa
 * pasa SIEMPRE por `earnTokens()` (origin="community_response", regla real
 * en `token_rules`) — nunca un `postLedgerMovement()` directo. Esto respeta
 * `LIVE_LOYALTY_ENABLED`, idempotencia estándar, caps diarios/semanales/
 * mensuales/lifetime y ledger/wallet atómicos, exactamente igual que
 * attendance/ticket/consumption. El importe YA NO lo decide
 * `proposal.tokenReward` (campo legacy, ver `communityDb.ts` — se conserva
 * en schema por los 2 grants históricos ya concedidos con el mecanismo
 * anterior, nunca tocados) — lo decide la regla activa `COMMUNITY_RESPONSE`,
 * igual que el resto de orígenes. Best-effort: un fallo del motor de tokens
 * nunca debe perder la respuesta ya registrada (mismo criterio que
 * earnTokens en attendancePipeline.ts/commercePipeline.ts).
 */
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  communityProposals, communityOptions, communityResponses, communityResponseValues,
  type CommunityProposal, type CommunityOption, type CommunityResponse, type CommunityResponseValue,
} from "../../../drizzle/schema";
import { getProposalById, isProposalOpenForResponses, type AnyDbHandle } from "./communityDb";
import { earnTokens } from "../tokens/tokenEngine";
import { isPositiveRespondent, attendanceIntentionFromCode, ATTENDANCE_INTENTION_CODES, type AttendanceIntentionValue } from "./communityIntentService";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);
type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class CommunityResponseError extends Error {
  code: "NOT_FOUND" | "CLOSED" | "ALREADY_RESPONDED" | "INVALID_PAYLOAD" | "NOT_IN_AUDIENCE";
  constructor(code: CommunityResponseError["code"], message: string) {
    super(message);
    this.name = "CommunityResponseError";
    this.code = code;
  }
}

export const OPEN_TEXT_MAX_LENGTH = 1000;

/** Sanitización mínima (spec punto 73): sin HTML arbitrario, longitud acotada. No es un sanitizador HTML completo — solo strip de tags, suficiente porque el texto se renderiza siempre como texto plano en el frontend, nunca con dangerouslySetInnerHTML. */
export function sanitizeOpenText(raw: string): string {
  return raw.replace(/<[^>]*>/g, "").trim().slice(0, OPEN_TEXT_MAX_LENGTH);
}

// ─── PAYLOAD POR TIPO DE PREGUNTA ───────────────────────────────────────────

export type ResponsePayload =
  | { questionType: "single_choice"; optionId: number }
  | { questionType: "yes_no"; value: "yes" | "no" }
  | { questionType: "percentage_scale"; values: { optionId: number; value: number }[] }
  | { questionType: "scale_1_5"; value: number }
  | { questionType: "multiselect"; optionIds: number[] }
  | { questionType: "ranking"; orderedOptionIds: number[] }
  | { questionType: "attendance_intention"; value: AttendanceIntentionValue }
  | { questionType: "me_apunto" }
  | { questionType: "open_text"; text: string };

/** Exportada para test unitario directo (spec punto 89) — es una función pura, sin I/O, no necesita BD para probarse. */
export function buildValueRows(payload: ResponsePayload, options: CommunityOption[]): Array<Pick<CommunityResponseValue, "optionId" | "valueText" | "valueNumber">> {
  const optionIds = new Set(options.map(o => o.id));

  switch (payload.questionType) {
    case "single_choice": {
      if (!optionIds.has(payload.optionId)) throw new CommunityResponseError("INVALID_PAYLOAD", "Opción no válida para esta propuesta");
      return [{ optionId: payload.optionId, valueText: null, valueNumber: null }];
    }
    case "yes_no": {
      if (payload.value !== "yes" && payload.value !== "no") throw new CommunityResponseError("INVALID_PAYLOAD", "Valor yes_no inválido");
      return [{ optionId: null, valueText: payload.value, valueNumber: null }];
    }
    case "percentage_scale": {
      if (!payload.values.length) throw new CommunityResponseError("INVALID_PAYLOAD", "Debe puntuar al menos un criterio");
      for (const v of payload.values) {
        if (!optionIds.has(v.optionId)) throw new CommunityResponseError("INVALID_PAYLOAD", "Criterio no válido para esta propuesta");
        if (!Number.isInteger(v.value) || v.value < 0 || v.value > 100) throw new CommunityResponseError("INVALID_PAYLOAD", "Cada criterio debe puntuarse 0-100");
      }
      return payload.values.map(v => ({ optionId: v.optionId, valueText: null, valueNumber: v.value }));
    }
    case "scale_1_5": {
      if (!Number.isInteger(payload.value) || payload.value < 1 || payload.value > 5) throw new CommunityResponseError("INVALID_PAYLOAD", "El valor debe ser un entero 1-5");
      return [{ optionId: null, valueText: null, valueNumber: payload.value }];
    }
    case "multiselect": {
      if (!payload.optionIds.length) throw new CommunityResponseError("INVALID_PAYLOAD", "Debe seleccionar al menos una opción");
      const unique = new Set(payload.optionIds);
      if (unique.size !== payload.optionIds.length) throw new CommunityResponseError("INVALID_PAYLOAD", "Opciones duplicadas");
      for (const id of payload.optionIds) if (!optionIds.has(id)) throw new CommunityResponseError("INVALID_PAYLOAD", "Opción no válida para esta propuesta");
      return payload.optionIds.map(id => ({ optionId: id, valueText: null, valueNumber: null }));
    }
    case "ranking": {
      // Spec punto 29: "validar no duplicados; todas las opciones requeridas
      // o subset según config" — se exige el conjunto COMPLETO por simplicidad
      // (un ranking parcial no es comparable de forma consistente entre
      // estudiantes sin una regla adicional que el spec no fija).
      if (payload.orderedOptionIds.length !== options.length) throw new CommunityResponseError("INVALID_PAYLOAD", "Debe ordenar todas las opciones");
      const unique = new Set(payload.orderedOptionIds);
      if (unique.size !== payload.orderedOptionIds.length) throw new CommunityResponseError("INVALID_PAYLOAD", "Opciones duplicadas en el ranking");
      for (const id of payload.orderedOptionIds) if (!optionIds.has(id)) throw new CommunityResponseError("INVALID_PAYLOAD", "Opción no válida para esta propuesta");
      return payload.orderedOptionIds.map((id, idx) => ({ optionId: id, valueText: null, valueNumber: idx + 1 }));
    }
    case "attendance_intention": {
      const code = ATTENDANCE_INTENTION_CODES[payload.value];
      if (code === undefined) throw new CommunityResponseError("INVALID_PAYLOAD", "Valor de intención de asistencia inválido");
      return [{ optionId: null, valueText: payload.value, valueNumber: code }];
    }
    case "me_apunto": {
      return [{ optionId: null, valueText: "me_apunto", valueNumber: null }];
    }
    case "open_text": {
      const text = sanitizeOpenText(payload.text);
      if (!text) throw new CommunityResponseError("INVALID_PAYLOAD", "La respuesta no puede estar vacía");
      return [{ optionId: null, valueText: text, valueNumber: null }];
    }
  }
}

export interface SubmitResponseResult {
  response: CommunityResponse;
  rewardGranted: boolean;
}

export async function submitResponse(
  proposalId: number,
  userId: number,
  payload: ResponsePayload,
  db?: AnyDbHandle
): Promise<SubmitResponseResult> {
  const conn = db ?? (await getDb());
  const proposal = await getProposalById(proposalId, conn);
  if (!proposal) throw new CommunityResponseError("NOT_FOUND", "Propuesta no encontrada");
  if (payload.questionType !== proposal.questionType) {
    throw new CommunityResponseError("INVALID_PAYLOAD", "El tipo de respuesta no coincide con el tipo de pregunta");
  }
  // Nunca confiar solo en la UI para la ventana de tiempo (spec punto 70).
  if (!isProposalOpenForResponses(proposal, new Date())) {
    throw new CommunityResponseError("CLOSED", "Esta propuesta no está abierta para respuestas ahora mismo");
  }

  const options = await conn.select().from(communityOptions).where(eq(communityOptions.proposalId, proposalId)) as CommunityOption[];
  const valueRows = buildValueRows(payload, options);

  const [existing] = await (conn as DbHandle).select().from(communityResponses)
    .where(and(eq(communityResponses.proposalId, proposalId), eq(communityResponses.userId, userId))).limit(1);

  if (existing && !proposal.allowChangeResponse) {
    throw new CommunityResponseError("ALREADY_RESPONDED", "Ya has respondido a esta propuesta y no admite cambios");
  }

  let responseId: number;
  let isFirstResponse: boolean;

  if (existing) {
    responseId = existing.id;
    isFirstResponse = false;
    await (conn as DbHandle).update(communityResponses).set({ updatedAt: new Date() }).where(eq(communityResponses.id, responseId));
    await (conn as DbHandle).delete(communityResponseValues).where(eq(communityResponseValues.responseId, responseId));
  } else {
    const insertResult = await (conn as DbHandle).insert(communityResponses).values({ proposalId, userId });
    responseId = (insertResult as unknown as [{ insertId: number }])[0].insertId;
    isFirstResponse = true;
  }

  for (const row of valueRows) {
    await (conn as DbHandle).insert(communityResponseValues).values({ responseId, ...row });
  }

  let rewardGranted = false;
  if (isFirstResponse) {
    try {
      const result = await earnTokens({
        userId,
        origin: "community_response",
        venueId: proposal.venueId ?? null,
        eventId: proposal.relatedEventId ?? null,
        sourceId: proposalId,
        idempotencyKey: `community_response:${proposalId}:${userId}`,
      }, conn as DbHandle);
      await (conn as DbHandle).update(communityResponses).set({ rewardGranted: true, tokenLedgerId: result.ledger.id }).where(eq(communityResponses.id, responseId));
      rewardGranted = true;
    } catch (err) {
      // Best-effort — un fallo/ausencia de regla del motor de tokens nunca
      // debe perder la respuesta ya registrada (mismo criterio que
      // earnTokens en attendancePipeline.ts/commercePipeline.ts). Incluye el
      // caso NO_RULE_FOUND si la regla COMMUNITY_RESPONSE llegara a
      // desactivarse — no es un error real, solo "hoy no se premia".
      console.error(`[communityResponseService] No se concedió recompensa (proposal=${proposalId}, user=${userId}):`, err);
    }
  }

  const [response] = await (conn as DbHandle).select().from(communityResponses).where(eq(communityResponses.id, responseId)).limit(1);
  return { response, rewardGranted };
}

export async function getUserResponse(proposalId: number, userId: number, db?: AnyDbHandle): Promise<{ response: CommunityResponse; values: CommunityResponseValue[] } | null> {
  const conn = db ?? (await getDb());
  const [response] = await (conn as DbHandle).select().from(communityResponses)
    .where(and(eq(communityResponses.proposalId, proposalId), eq(communityResponses.userId, userId))).limit(1);
  if (!response) return null;
  const values = await (conn as DbHandle).select().from(communityResponseValues).where(eq(communityResponseValues.responseId, response.id));
  return { response, values };
}

export async function countResponses(proposalId: number, db?: AnyDbHandle): Promise<number> {
  const conn = db ?? (await getDb());
  const [row] = await (conn as DbHandle).select({ count: sql<number>`COUNT(*)` }).from(communityResponses).where(eq(communityResponses.proposalId, proposalId));
  return Number(row?.count ?? 0);
}

export interface UserResponseHistoryItem {
  response: CommunityResponse;
  proposalTitle: string;
  proposalQuestionType: CommunityProposal["questionType"];
}

/** Para Student 360 (Activity Aggregator, spec punto 79) — historial de respuestas del estudiante, con el título de la propuesta ya resuelto (evita un segundo fan-out en el caller). */
export async function listResponsesByUserId(userId: number, limit: number, db?: AnyDbHandle): Promise<UserResponseHistoryItem[]> {
  const conn = (db ?? (await getDb())) as DbHandle;
  return conn.select({
    response: communityResponses,
    proposalTitle: communityProposals.title,
    proposalQuestionType: communityProposals.questionType,
  })
    .from(communityResponses)
    .innerJoin(communityProposals, eq(communityResponses.proposalId, communityProposals.id))
    .where(eq(communityResponses.userId, userId))
    .orderBy(desc(communityResponses.respondedAt))
    .limit(limit);
}
