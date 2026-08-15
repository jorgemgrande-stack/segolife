/**
 * commercialAgreementService.ts — SEGOLIFE FASE 10 (spec §55-58). Términos
 * comerciales configurables entre SEGOLIFE y un venue — NUNCA hardcodea un
 * 50/50 ni ningún % (spec §56). Un único acuerdo ACTIVO por (venueId,
 * eventId opcional) — resuelto por especificidad (evento > venue) en
 * settlementService.ts. 0 acuerdos configurados es un estado de producción
 * válido (spec §106) — nunca se inventa uno.
 */
import { eq, and, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { commercialAgreements, type CommercialAgreement } from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class CommercialAgreementError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "CommercialAgreementError";
  }
}

export interface UpsertAgreementInput {
  id?: number;
  venueId: number;
  eventId?: number | null;
  commissionModel: "platform_commission_percent" | "fixed_fee" | "venue_net" | "no_commission";
  commissionBasisPoints?: number;
  fixedFeeCents?: number;
  tokenFundingModel?: "venue_funded" | "platform_funded" | "shared" | "no_settlement_value";
  benefitFundingModel?: "venue_funded" | "platform_funded" | "shared" | "no_settlement_value";
  createdByUserId: number;
}

export async function upsertAgreement(input: UpsertAgreementInput, db?: DbHandle): Promise<CommercialAgreement> {
  const conn = db ?? (await getDb());
  if (input.commissionModel === "platform_commission_percent" && (input.commissionBasisPoints == null || input.commissionBasisPoints < 0 || input.commissionBasisPoints > 10000)) {
    throw new CommercialAgreementError("INVALID_INPUT", "commissionBasisPoints debe estar entre 0 y 10000 para el modelo de porcentaje");
  }

  if (input.id) {
    await conn.update(commercialAgreements).set({
      commissionModel: input.commissionModel,
      commissionBasisPoints: input.commissionBasisPoints ?? 0,
      fixedFeeCents: input.fixedFeeCents ?? 0,
      tokenFundingModel: input.tokenFundingModel ?? "no_settlement_value",
      benefitFundingModel: input.benefitFundingModel ?? "no_settlement_value",
    }).where(eq(commercialAgreements.id, input.id));
    const [row] = await conn.select().from(commercialAgreements).where(eq(commercialAgreements.id, input.id)).limit(1);
    if (!row) throw new CommercialAgreementError("NOT_FOUND", "Acuerdo no encontrado");
    return row;
  }

  // Solo un acuerdo activo por (venueId, eventId) — desactiva el anterior si existía (spec §57, "avoid excessive complexity": nunca versionado temporal completo, el snapshot vive en el propio settlement calculado).
  const scopeCondition = input.eventId != null ? eq(commercialAgreements.eventId, input.eventId) : isNull(commercialAgreements.eventId);
  await conn.update(commercialAgreements).set({ active: false }).where(and(eq(commercialAgreements.venueId, input.venueId), scopeCondition, eq(commercialAgreements.active, true)));

  const [result] = await conn.insert(commercialAgreements).values({
    venueId: input.venueId,
    eventId: input.eventId ?? null,
    commissionModel: input.commissionModel,
    commissionBasisPoints: input.commissionBasisPoints ?? 0,
    fixedFeeCents: input.fixedFeeCents ?? 0,
    tokenFundingModel: input.tokenFundingModel ?? "no_settlement_value",
    benefitFundingModel: input.benefitFundingModel ?? "no_settlement_value",
    active: true,
    createdByUserId: input.createdByUserId,
  });
  const insertId = (result as unknown as { insertId: number }).insertId;
  const [row] = await conn.select().from(commercialAgreements).where(eq(commercialAgreements.id, insertId)).limit(1);
  return row!;
}

/** Resuelve por especificidad: evento > venue (spec §57). null = sin acuerdo configurado todavía — nunca se inventa uno. */
export async function resolveAgreement(venueId: number, eventId?: number | null, db?: DbHandle): Promise<CommercialAgreement | null> {
  const conn = db ?? (await getDb());
  if (eventId != null) {
    const [eventScoped] = await conn.select().from(commercialAgreements).where(and(eq(commercialAgreements.venueId, venueId), eq(commercialAgreements.eventId, eventId), eq(commercialAgreements.active, true))).limit(1);
    if (eventScoped) return eventScoped;
  }
  const [venueScoped] = await conn.select().from(commercialAgreements).where(and(eq(commercialAgreements.venueId, venueId), isNull(commercialAgreements.eventId), eq(commercialAgreements.active, true))).limit(1);
  return venueScoped ?? null;
}

export async function listAgreements(venueId?: number, db?: DbHandle): Promise<CommercialAgreement[]> {
  const conn = db ?? (await getDb());
  if (venueId != null) return conn.select().from(commercialAgreements).where(eq(commercialAgreements.venueId, venueId));
  return conn.select().from(commercialAgreements);
}
