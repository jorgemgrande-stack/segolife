/**
 * referralService.ts — SEGOLIFE REFERRAL & INVITE REWARDS ENGINE (Fase 8).
 *
 * Núcleo único del motor de referidos — mismo criterio de "un solo punto de
 * entrada por dominio" que tokenLedgerService.ts/benefitGrantService.ts.
 * Auditado antes de escribirse (spec §0): el dominio de referidos es
 * genuinamente nuevo, sin equivalente previo (el único "invite" del repo es
 * el alta LEGACY de staff en server/db.ts, sin relación con esto).
 *
 * DECISIÓN ARQUITECTÓNICA (documentada, spec §20): las recompensas de
 * referido NO pasan por earnTokens()/token_rules — ese motor calcula un
 * importe FIJO por origen mediante una regla configurada, incompatible con
 * el requisito de este dominio (cada CAMPAÑA de referido define su propio
 * importe para inviter/invitee). Se usa `postLedgerMovementInTx` de forma
 * directa, mismo patrón ya establecido por benefitPurchaseService.ts/
 * tokenSpendService.ts (Fases 6/7) para "el importe viene de una fila de
 * definición/campaña concreta, no de una regla genérica").
 *
 * MODELO DE ATRIBUCIÓN (spec §6/§18, documentado explícitamente): NO existe
 * una tabla `referral_clicks` — la atribución pre-registro se guarda en el
 * cliente (localStorage: código + timestamp del click) y se revalida/liga
 * de forma ATÓMICA dentro de la misma transacción de registerStudent. Esto
 * significa que "atribución" y "registro" son la MISMA operación en este
 * modelo — `referrals.status` arranca directamente en "registered" (nunca
 * existe un estado "ATTRIBUTED" previo, spec §17, documentado como
 * simplificación deliberada). Consecuencia directa: spec §28 ("una cuenta
 * YA EXISTENTE no puede convertirse en un nuevo referido") queda satisfecho
 * estructuralmente — `referredUserId` es SIEMPRE una fila `users` recién
 * creada dentro de esa misma transacción, nunca una cuenta preexistente.
 *
 * MODELO DE ECONOMÍA (spec §46, LA ATRIBUCIÓN FIJA LA ECONOMÍA): en el
 * momento del registro se resuelve la campaña activa que aplica (comunidad +
 * fecha) y sus importes/condición se FOTOGRAFÍAN en la propia fila de
 * `referrals` — una edición posterior de la campaña, o que la campaña
 * termine antes de que el amigo complete la condición, nunca cambia lo ya
 * prometido a esta relación concreta.
 */
import crypto from "crypto";
import { eq, and, asc, desc, isNotNull, sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  referrals,
  referralCampaigns,
  studentProfiles,
  users,
  userCommunities,
  communities,
  type Referral,
  type ReferralCampaign,
} from "../../../drizzle/schema";
import { postLedgerMovementInTx } from "../tokens/tokenLedgerService";
import { emitEngagementEvent } from "../engagement/engagementEvents";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
export type AnyDbHandle = DbHandle | TxHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

/** Mismo criterio que registrationService.ts: comprueba errno 1062 directo Y `.cause` (Drizzle envuelve el error real de mysql2 dentro de una transacción). */
function isDuplicateKeyError(err: unknown): boolean {
  const hasErrno1062 = (e: unknown): boolean =>
    !!e && typeof e === "object" && "errno" in e && (e as { errno?: number }).errno === 1062;
  if (hasErrno1062(err)) return true;
  const cause = err && typeof err === "object" ? (err as { cause?: unknown }).cause : undefined;
  return hasErrno1062(cause);
}

// ─── Identidad de referido (spec §2) ────────────────────────────────────────

// Alfabeto sin 0/O/1/I (ambiguos al leer/compartir) — opaco y no secuencial
// (spec §2/§62): nunca codifica email/userId/comunidad/saldo.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function randomCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Devuelve el código permanente del estudiante, generándolo si es la
 * primera vez que se necesita (spec §2: "todo Student elegible debería
 * tener una identidad de invitación permanente" — lazy en vez de forzar el
 * cálculo en cada registro histórico, spec §29: nunca backfill masivo).
 * Reintenta ante colisión real (entropía de 33^8 hace la colisión
 * extremadamente improbable, pero el UNIQUE real de MySQL es la garantía).
 */
export async function ensureReferralCode(userId: number, db?: AnyDbHandle): Promise<string> {
  const conn = db ?? (await getDb());
  const [existing] = await conn.select({ referralCode: studentProfiles.referralCode }).from(studentProfiles).where(eq(studentProfiles.userId, userId)).limit(1);
  if (existing?.referralCode) return existing.referralCode;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    try {
      await conn.update(studentProfiles).set({ referralCode: code }).where(eq(studentProfiles.userId, userId));
      return code;
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      // Colisión real con otro estudiante — reintenta con un código nuevo.
    }
  }
  throw new Error("No se pudo generar un código de referido único");
}

interface ReferrerLookup {
  userId: number;
  email: string | null;
  phone: string | null;
  isActive: boolean;
}

async function resolveReferrerByCode(code: string, conn: AnyDbHandle): Promise<ReferrerLookup | null> {
  const [row] = await conn
    .select({ userId: studentProfiles.userId, email: users.email, phone: users.phone, isActive: users.isActive })
    .from(studentProfiles)
    .innerJoin(users, eq(studentProfiles.userId, users.id))
    .where(eq(studentProfiles.referralCode, code))
    .limit(1);
  return row ?? null;
}

/** Primera comunidad por antigüedad de alta — mismo criterio que resolveVisitorCommunityId en venueVisitService.ts, nunca inferida del venue/campaña. */
async function resolvePrimaryCommunityId(userId: number, conn: AnyDbHandle): Promise<number | null> {
  const [membership] = await conn.select({ communityId: userCommunities.communityId })
    .from(userCommunities).where(eq(userCommunities.userId, userId)).orderBy(asc(userCommunities.joinedAt)).limit(1);
  return membership?.communityId ?? null;
}

// ─── Resolución de campaña (spec §14, determinista) ─────────────────────────

/**
 * `communityId = null` → sin contexto de comunidad todavía (visitante
 * anónimo antes de elegir comunidad, spec §60): solo pueden resolver
 * campañas GLOBALES (community_id IS NULL) — nunca se anuncia una campaña
 * scoped a una comunidad concreta antes de saber a cuál se va a unir.
 * Desempate: comunidad-específica > global, luego priority desc, luego más
 * reciente — mismo criterio de especificidad que
 * token_redemption_policies (Fase 7).
 */
async function resolveActiveCampaign(communityId: number | null, now: Date, conn: AnyDbHandle): Promise<ReferralCampaign | null> {
  const rows = await conn.select().from(referralCampaigns).where(eq(referralCampaigns.status, "active"));
  const candidates = rows.filter(c =>
    (c.communityId == null || c.communityId === communityId) &&
    (c.startsAt == null || c.startsAt.getTime() <= now.getTime()) &&
    (c.endsAt == null || c.endsAt.getTime() >= now.getTime())
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aScoped = a.communityId != null ? 1 : 0;
    const bScoped = b.communityId != null ? 1 : 0;
    if (aScoped !== bScoped) return bScoped - aScoped;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  return candidates[0];
}

const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 30;

// ─── Atribución (spec §5-§9, dentro de la transacción de registro) ──────────

export interface AttributeReferralInput {
  referredUserId: number;
  referredCommunityId: number;
  referredEmail: string;
  referredPhone: string;
  referralCode: string | null | undefined;
  /** Timestamp del click, persistido client-side (localStorage) — límite de confianza documentado: no es una garantía criptográfica, solo una señal de baja exigencia (spec §5/§27, "sensato, no ML"). */
  referralClickedAt?: Date | null;
}

/**
 * Se llama DENTRO de la transacción de registerStudent, justo después de
 * resolver `insertId` (spec §18: vincular la atribución de forma atómica).
 * Nunca lanza por un código inválido/expirado/autorreferido — un fallo de
 * atribución nunca debe bloquear el alta real del estudiante (silenciosa a
 * propósito: spec §62, nunca confirmar/negar la validez de un código a un
 * llamador que no debería saberlo).
 */
export async function attributeReferralInTx(tx: AnyDbHandle, input: AttributeReferralInput): Promise<void> {
  if (!input.referralCode) return;
  const code = normalizeCode(input.referralCode);
  if (!code) return;

  const referrer = await resolveReferrerByCode(code, tx);
  if (!referrer) return;

  // Autorreferido (spec §8) — varias señales, nunca solo email (que aquí ni
  // siquiera podría colisionar por el UNIQUE real de users.email; el
  // teléfono SÍ es una señal real de "misma persona, cuenta distinta").
  if (referrer.userId === input.referredUserId) return;
  if (referrer.email && referrer.email.toLowerCase() === input.referredEmail.toLowerCase()) return;
  if (referrer.phone && referrer.phone === input.referredPhone) return;

  const now = new Date();
  const campaign = await resolveActiveCampaign(input.referredCommunityId, now, tx);
  const effectiveWindowDays = campaign?.attributionWindowDays ?? DEFAULT_ATTRIBUTION_WINDOW_DAYS;

  let clickedAt = input.referralClickedAt ?? now;
  if (clickedAt.getTime() > now.getTime()) clickedAt = now; // nunca confiar en un timestamp futuro del cliente
  const ageDays = (now.getTime() - clickedAt.getTime()) / 86_400_000;
  if (ageDays > effectiveWindowDays) return; // click demasiado antiguo (spec §6) — no se atribuye

  try {
    await tx.insert(referrals).values({
      referrerUserId: referrer.userId,
      referredUserId: input.referredUserId,
      referralCode: code,
      campaignId: campaign?.id ?? null,
      communityId: input.referredCommunityId,
      status: "registered",
      requiredConversionCondition: campaign?.conversionCondition ?? null,
      inviterRewardTokens: campaign?.inviterRewardTokens ?? 0,
      inviteeRewardTokens: campaign?.inviteeRewardTokens ?? 0,
    });
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    // referred_user_id ya tenía fila — no debería poder pasar (userId nuevo
    // dentro de esta misma transacción), defensivo, nunca bloquea el alta.
  }
}

// ─── Evaluación de conversión (spec §9-§10, §81-§83) ────────────────────────

export type ReferralConversionFact = "account_created" | "profile_completed" | "first_venue_visit" | "first_event_attendance";

/** Envoltorio best-effort — usado por los 4 productores de hechos (spec §23: un fallo aquí NUNCA revierte el hecho real ya confirmado). */
export async function evaluateReferralConversionBestEffort(userId: number, fact: ReferralConversionFact, occurredAt: Date): Promise<void> {
  try {
    await evaluateReferralConversion(userId, fact, occurredAt);
  } catch (err) {
    console.error(`[referralService] Evaluación de conversión falló (user=${userId}, fact=${fact}):`, err);
  }
}

export async function evaluateReferralConversion(userId: number, fact: ReferralConversionFact, occurredAt: Date, db?: AnyDbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  const [referral] = await conn.select().from(referrals).where(and(
    eq(referrals.referredUserId, userId),
    eq(referrals.status, "registered"),
    eq(referrals.requiredConversionCondition, fact),
  )).limit(1);
  if (!referral) return;

  // Nunca calificación retroactiva (spec §83) — el hecho debe ocurrir en o
  // después del propio registro (defensa incluso ante un futuro llamador
  // que pasara un hecho con fecha anterior, p.ej. un backfill histórico).
  if (occurredAt.getTime() < referral.registeredAt.getTime()) return;

  // UPDATE condicional + affectedRows (mismo patrón que orderStateMachine.ts/
  // benefitRedemptionService.ts) — exactamente una llamada concurrente gana
  // la transición registered→converted (spec §31, "exactamente una vez").
  const [updateResult] = await conn.update(referrals).set({
    status: "converted",
    convertedAt: occurredAt,
    convertedVia: fact,
  }).where(and(eq(referrals.id, referral.id), eq(referrals.status, "registered")));
  const affectedRows = (updateResult as unknown as { affectedRows: number }).affectedRows ?? 0;
  if (affectedRows === 0) return; // otra llamada concurrente ya la convirtió

  try {
    await grantReferralReward(referral.id, conn);
  } catch (err) {
    // spec §23: un fallo al conceder la recompensa NUNCA revierte la
    // conversión ya confirmada — la fila queda en 'converted'
    // (rewardedAt sigue null) para reconciliación posterior (ver
    // findReferralsPendingReconciliation).
    console.error(`[referralService] No se pudo conceder la recompensa de referido (referral=${referral.id}):`, err);
  }
}

// ─── Recompensa de doble lado (spec §20-§26) ────────────────────────────────

export class ReferralRewardError extends Error {
  code: "BUDGET_EXCEEDED";
  constructor(code: "BUDGET_EXCEEDED", message: string) {
    super(message);
    this.name = "ReferralRewardError";
    this.code = code;
  }
}

interface PendingRewardNotification {
  referrerUserId: number;
  referredUserId: number;
  inviterLedgerId: number | null;
  inviterAmount: number;
  inviteeLedgerId: number | null;
  inviteeAmount: number;
  campaignId: number | null;
}

async function emitReferralRewardEvents(n: PendingRewardNotification, conn: AnyDbHandle): Promise<void> {
  // Reutiliza el evento/plantilla YA existente "tokens_earned" (spec §35:
  // reutilizar Communication Center, nunca construir uno nuevo) — el propio
  // umbral de relevancia de tokensEarnedListener.ts decide si además manda
  // email (el inviter, típicamente por encima del umbral, sí; el invitee,
  // típicamente por debajo, solo in-app — evita spam por defecto sin lógica
  // nueva, spec §36).
  if (n.inviterLedgerId) {
    const communityId = await resolvePrimaryCommunityId(n.referrerUserId, conn);
    emitEngagementEvent("tokens_earned", { userId: n.referrerUserId, communityId, amount: n.inviterAmount, ledgerId: n.inviterLedgerId, venueId: null, eventId: null });
  }
  if (n.inviteeLedgerId) {
    const communityId = await resolvePrimaryCommunityId(n.referredUserId, conn);
    emitEngagementEvent("tokens_earned", { userId: n.referredUserId, communityId, amount: n.inviteeAmount, ledgerId: n.inviteeLedgerId, venueId: null, eventId: null });
  }
}

/**
 * Concede ambos lados en UNA transacción propia (spec §22, atomicidad real:
 * si algo falla a mitad, todo se revierte y la fila queda 'converted' para
 * reintentar, nunca "inviter cobrado, invitee huérfano para siempre"). Se
 * llama tanto desde evaluateReferralConversion (automático) como desde el
 * endpoint admin de reintento (idempotente: si ya está 'rewarded' o no está
 * lista, no hace nada).
 */
export async function grantReferralReward(referralId: number, db?: AnyDbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  let notification: PendingRewardNotification | null = null;

  await (conn as DbHandle).transaction(async (tx) => {
    const [referral] = await tx.select().from(referrals).where(eq(referrals.id, referralId)).limit(1).for("update");
    if (!referral) return;
    if (referral.status !== "converted" || referral.rewardedAt) return; // ya concedida o no lista — idempotente

    const [referrerUser] = await tx.select({ isActive: users.isActive }).from(users).where(eq(users.id, referral.referrerUserId)).limit(1);
    const referrerActive = referrerUser?.isActive ?? false;

    let campaign: ReferralCampaign | null = null;
    if (referral.campaignId) {
      const [row] = await tx.select().from(referralCampaigns).where(eq(referralCampaigns.id, referral.campaignId)).limit(1).for("update");
      campaign = row ?? null;
    }

    // Presupuesto de campaña (spec §26) — bajo el mismo lock de fila que la
    // campaña, serializa la comprobación ante conversiones concurrentes
    // (mismo criterio que el lock de token_campaigns en tokenEngine.ts).
    if (campaign?.budgetTokens != null) {
      const [{ spent }] = await tx.select({ spent: drizzleSql<string>`COALESCE(SUM(${referrals.inviterRewardTokens} + ${referrals.inviteeRewardTokens}), 0)` })
        .from(referrals).where(and(eq(referrals.campaignId, campaign.id), eq(referrals.status, "rewarded")));
      const alreadySpent = Number(spent ?? 0);
      const thisCost = referral.inviterRewardTokens + referral.inviteeRewardTokens;
      if (alreadySpent + thisCost > campaign.budgetTokens) {
        await tx.update(referrals).set({ ineligibleReason: "BUDGET_EXCEEDED" }).where(eq(referrals.id, referralId));
        throw new ReferralRewardError("BUDGET_EXCEEDED", `Presupuesto de la campaña ${campaign.id} agotado`);
      }
    }

    let inviterCapReached = false;
    if (referrerActive && campaign?.maxRewardsPerInviter != null) {
      const rewardedForInviter = await tx.select({ id: referrals.id }).from(referrals).where(and(
        eq(referrals.referrerUserId, referral.referrerUserId),
        eq(referrals.campaignId, campaign.id),
        isNotNull(referrals.inviterLedgerId),
      ));
      inviterCapReached = rewardedForInviter.length >= campaign.maxRewardsPerInviter;
    }

    let ineligibleReason: string | null = null;
    let inviterLedgerId: number | null = null;
    if (!referrerActive) {
      ineligibleReason = "INELIGIBLE_REFERRER"; // spec §48 — sin recompensa nueva mientras el referrer esté inactivo, la relación se conserva igualmente.
    } else if (inviterCapReached) {
      ineligibleReason = "REFERRER_CAP_REACHED"; // spec §25 — el invitee se sigue recompensando igual.
    } else if (referral.inviterRewardTokens > 0) {
      const { ledger } = await postLedgerMovementInTx(tx, {
        userId: referral.referrerUserId,
        direction: "credit",
        amount: referral.inviterRewardTokens,
        reason: "Recompensa por invitar a un amigo a SEGOLIFE",
        sourceType: "referral_inviter",
        sourceId: referral.id,
        campaignId: referral.campaignId,
        idempotencyKey: `referral:${referral.id}:inviter`,
      });
      inviterLedgerId = ledger.id;
    }

    let inviteeLedgerId: number | null = null;
    if (referral.inviteeRewardTokens > 0) {
      const { ledger } = await postLedgerMovementInTx(tx, {
        userId: referral.referredUserId,
        direction: "credit",
        amount: referral.inviteeRewardTokens,
        reason: "Recompensa de bienvenida por invitación de un amigo",
        sourceType: "referral_invitee",
        sourceId: referral.id,
        campaignId: referral.campaignId,
        idempotencyKey: `referral:${referral.id}:invitee`,
      });
      inviteeLedgerId = ledger.id;
    }

    await tx.update(referrals).set({
      status: "rewarded",
      rewardedAt: new Date(),
      inviterLedgerId,
      inviteeLedgerId,
      ineligibleReason,
    }).where(eq(referrals.id, referralId));

    notification = {
      referrerUserId: referral.referrerUserId,
      referredUserId: referral.referredUserId,
      inviterLedgerId,
      inviterAmount: referral.inviterRewardTokens,
      inviteeLedgerId,
      inviteeAmount: referral.inviteeRewardTokens,
      campaignId: referral.campaignId,
    };
  });

  // SIEMPRE después del commit (spec: nunca notificar dentro de la propia
  // transacción — mismo criterio que grantWelcomeBenefitBestEffort/
  // evaluateBenefitsForOrigin en el resto del repo).
  if (notification) await emitReferralRewardEvents(notification, conn);
}

// ─── Reconciliación (spec §65-67) ───────────────────────────────────────────

/** CONVERTED pero sin recompensa concedida más allá de un margen de gracia — candidatas a reintento manual desde el admin. Sin cron: detección bajo demanda (spec: "detección obligatoria como mínimo, job automático opcional"). */
export async function findReferralsPendingReconciliation(graceMinutes = 15, db?: AnyDbHandle): Promise<Referral[]> {
  const conn = db ?? (await getDb());
  const cutoff = new Date(Date.now() - graceMinutes * 60_000);
  const rows = await conn.select().from(referrals).where(eq(referrals.status, "converted"));
  return rows.filter(r => r.convertedAt && r.convertedAt.getTime() <= cutoff.getTime());
}

/** Reintento manual admin — idempotente (grantReferralReward ya no hace nada si no está en 'converted' sin recompensar). */
export async function retryReferralReward(referralId: number, db?: AnyDbHandle): Promise<void> {
  await grantReferralReward(referralId, db);
}

// ─── Superficie para el propio Student (spec §32-34) ────────────────────────

export interface StudentReferralSummary {
  referralCode: string;
  inviteLink: string;
  activeCampaign: {
    inviterRewardTokens: number;
    inviteeRewardTokens: number;
    conversionCondition: ReferralCampaign["conversionCondition"];
    maxRewardsPerInviter: number | null;
  } | null;
  stats: {
    totalReferred: number;
    converted: number;
    rewarded: number;
    tokensEarnedFromReferrals: number;
    remainingCapThisCampaign: number | null;
  };
}

function appBaseUrl(): string {
  return (process.env.APP_URL ?? "").replace(/\/+$/, "");
}

export async function getStudentReferralSummary(userId: number, db?: AnyDbHandle): Promise<StudentReferralSummary> {
  const conn = db ?? (await getDb());
  const code = await ensureReferralCode(userId, conn);
  const communityId = await resolvePrimaryCommunityId(userId, conn);
  const campaign = communityId != null ? await resolveActiveCampaign(communityId, new Date(), conn) : null;

  const mine = await conn.select().from(referrals).where(eq(referrals.referrerUserId, userId));
  const converted = mine.filter(r => r.status === "converted" || r.status === "rewarded").length;
  const rewarded = mine.filter(r => r.status === "rewarded" && r.inviterLedgerId != null).length;
  const tokensEarnedFromReferrals = mine.reduce((sum, r) => sum + (r.inviterLedgerId != null ? r.inviterRewardTokens : 0), 0);

  const remainingCapThisCampaign = campaign?.maxRewardsPerInviter != null
    ? Math.max(0, campaign.maxRewardsPerInviter - mine.filter(r => r.campaignId === campaign.id && r.inviterLedgerId != null).length)
    : null;

  return {
    referralCode: code,
    inviteLink: `${appBaseUrl()}/invite/${code}`,
    activeCampaign: campaign ? {
      inviterRewardTokens: campaign.inviterRewardTokens,
      inviteeRewardTokens: campaign.inviteeRewardTokens,
      conversionCondition: campaign.conversionCondition,
      maxRewardsPerInviter: campaign.maxRewardsPerInviter,
    } : null,
    stats: { totalReferred: mine.length, converted, rewarded, tokensEarnedFromReferrals, remainingCapThisCampaign },
  };
}

// ─── Superficie pública — landing de invitación (spec §30/§60-62) ───────────

export interface PublicReferralLanding {
  valid: boolean;
  campaign: {
    inviterRewardTokens: number;
    inviteeRewardTokens: number;
    conversionCondition: ReferralCampaign["conversionCondition"];
  } | null;
}

/**
 * Respuesta MÍNIMA a propósito (spec §60-62): nunca email/teléfono/wallet/
 * perfil del referrer, ni siquiera su nombre — "un amigo te ha invitado a
 * SEGOLIFE" es toda la información que necesita el visitante. Un código
 * inválido devuelve exactamente la misma forma que uno válido sin campaña
 * (`{valid:false}` es la única señal, nunca se explica el motivo).
 */
export async function resolvePublicReferralLanding(rawCode: string, communityHint: number | null, db?: AnyDbHandle): Promise<PublicReferralLanding> {
  const conn = db ?? (await getDb());
  const code = normalizeCode(rawCode);
  if (!code) return { valid: false, campaign: null };
  const referrer = await resolveReferrerByCode(code, conn);
  if (!referrer) return { valid: false, campaign: null };

  const campaign = await resolveActiveCampaign(communityHint, new Date(), conn);
  return {
    valid: true,
    campaign: campaign ? {
      inviterRewardTokens: campaign.inviterRewardTokens,
      inviteeRewardTokens: campaign.inviteeRewardTokens,
      conversionCondition: campaign.conversionCondition,
    } : null,
  };
}

// ─── Administración — campañas (spec §41-45, GLOBAL_ADMIN only vía router) ──

export interface CreateReferralCampaignInput {
  name: string;
  communityId: number | null;
  inviterRewardTokens: number;
  inviteeRewardTokens: number;
  conversionCondition: ReferralCampaign["conversionCondition"];
  attributionWindowDays: number;
  maxRewardsPerInviter: number | null;
  maxTotalConversions: number | null;
  budgetTokens: number | null;
  priority: number;
  startsAt: Date | null;
  endsAt: Date | null;
  createdByUserId: number;
}

export class ReferralCampaignValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferralCampaignValidationError";
  }
}

/** Validación server-side obligatoria (spec §44) — nunca confiar solo en el formulario admin. */
function validateCampaignEconomics(input: {
  inviterRewardTokens: number; inviteeRewardTokens: number; attributionWindowDays: number;
  maxRewardsPerInviter: number | null; maxTotalConversions: number | null; budgetTokens: number | null;
  startsAt: Date | null; endsAt: Date | null;
}): void {
  if (!Number.isInteger(input.inviterRewardTokens) || input.inviterRewardTokens < 0) throw new ReferralCampaignValidationError("La recompensa del inviter debe ser un entero ≥ 0");
  if (!Number.isInteger(input.inviteeRewardTokens) || input.inviteeRewardTokens < 0) throw new ReferralCampaignValidationError("La recompensa del invitee debe ser un entero ≥ 0");
  if (input.inviterRewardTokens === 0 && input.inviteeRewardTokens === 0) throw new ReferralCampaignValidationError("La campaña debe recompensar al menos a una de las dos partes");
  if (!Number.isInteger(input.attributionWindowDays) || input.attributionWindowDays <= 0) throw new ReferralCampaignValidationError("La ventana de atribución debe ser un entero positivo");
  if (input.maxRewardsPerInviter != null && (!Number.isInteger(input.maxRewardsPerInviter) || input.maxRewardsPerInviter <= 0)) throw new ReferralCampaignValidationError("El máximo por inviter debe ser un entero positivo");
  if (input.maxTotalConversions != null && (!Number.isInteger(input.maxTotalConversions) || input.maxTotalConversions <= 0)) throw new ReferralCampaignValidationError("El máximo total de conversiones debe ser un entero positivo");
  if (input.budgetTokens != null && (!Number.isInteger(input.budgetTokens) || input.budgetTokens <= 0)) throw new ReferralCampaignValidationError("El presupuesto debe ser un entero positivo");
  if (input.startsAt && input.endsAt && input.startsAt.getTime() > input.endsAt.getTime()) throw new ReferralCampaignValidationError("La fecha de inicio no puede ser posterior a la de fin");
}

export async function createReferralCampaign(input: CreateReferralCampaignInput, db?: AnyDbHandle): Promise<ReferralCampaign> {
  const conn = db ?? (await getDb());
  validateCampaignEconomics(input);
  if (!input.name.trim()) throw new ReferralCampaignValidationError("El nombre de la campaña es obligatorio");

  const [insertResult] = await conn.insert(referralCampaigns).values({
    name: input.name.trim(),
    status: "draft",
    communityId: input.communityId,
    inviterRewardTokens: input.inviterRewardTokens,
    inviteeRewardTokens: input.inviteeRewardTokens,
    conversionCondition: input.conversionCondition,
    attributionWindowDays: input.attributionWindowDays,
    maxRewardsPerInviter: input.maxRewardsPerInviter,
    maxTotalConversions: input.maxTotalConversions,
    budgetTokens: input.budgetTokens,
    priority: input.priority,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    createdByUserId: input.createdByUserId,
  });
  const insertId = (insertResult as unknown as { insertId: number }).insertId;
  const [row] = await conn.select().from(referralCampaigns).where(eq(referralCampaigns.id, insertId)).limit(1);
  return row;
}

export type UpdateReferralCampaignInput = Partial<Omit<CreateReferralCampaignInput, "createdByUserId">>;

export async function updateReferralCampaign(id: number, input: UpdateReferralCampaignInput, db?: AnyDbHandle): Promise<ReferralCampaign> {
  const conn = db ?? (await getDb());
  const [current] = await conn.select().from(referralCampaigns).where(eq(referralCampaigns.id, id)).limit(1);
  if (!current) throw new ReferralCampaignValidationError("Campaña no encontrada");

  const merged = {
    inviterRewardTokens: input.inviterRewardTokens ?? current.inviterRewardTokens,
    inviteeRewardTokens: input.inviteeRewardTokens ?? current.inviteeRewardTokens,
    attributionWindowDays: input.attributionWindowDays ?? current.attributionWindowDays,
    maxRewardsPerInviter: input.maxRewardsPerInviter === undefined ? current.maxRewardsPerInviter : input.maxRewardsPerInviter,
    maxTotalConversions: input.maxTotalConversions === undefined ? current.maxTotalConversions : input.maxTotalConversions,
    budgetTokens: input.budgetTokens === undefined ? current.budgetTokens : input.budgetTokens,
    startsAt: input.startsAt === undefined ? current.startsAt : input.startsAt,
    endsAt: input.endsAt === undefined ? current.endsAt : input.endsAt,
  };
  validateCampaignEconomics(merged);
  if (input.name != null && !input.name.trim()) throw new ReferralCampaignValidationError("El nombre de la campaña es obligatorio");

  await conn.update(referralCampaigns).set({
    ...(input.name != null ? { name: input.name.trim() } : {}),
    ...(input.communityId !== undefined ? { communityId: input.communityId } : {}),
    ...(input.conversionCondition != null ? { conversionCondition: input.conversionCondition } : {}),
    ...(input.priority != null ? { priority: input.priority } : {}),
    ...merged,
  }).where(eq(referralCampaigns.id, id));
  const [row] = await conn.select().from(referralCampaigns).where(eq(referralCampaigns.id, id)).limit(1);
  return row;
}

/** DRAFT/PAUSED → ACTIVE (spec §45: registra activatedAt/activatedByUserId; ninguna campaña queda activa por defecto tras un deploy, spec §13/§91). */
export async function activateReferralCampaign(id: number, adminUserId: number, db?: AnyDbHandle): Promise<ReferralCampaign> {
  const conn = db ?? (await getDb());
  const [current] = await conn.select().from(referralCampaigns).where(eq(referralCampaigns.id, id)).limit(1);
  if (!current) throw new ReferralCampaignValidationError("Campaña no encontrada");
  if (current.status !== "draft" && current.status !== "paused") throw new ReferralCampaignValidationError(`No se puede activar una campaña en estado "${current.status}"`);
  validateCampaignEconomics(current);

  await conn.update(referralCampaigns).set({ status: "active", activatedAt: new Date(), activatedByUserId: adminUserId }).where(eq(referralCampaigns.id, id));
  const [row] = await conn.select().from(referralCampaigns).where(eq(referralCampaigns.id, id)).limit(1);
  return row;
}

export async function setReferralCampaignStatus(id: number, status: "paused" | "ended" | "archived", db?: AnyDbHandle): Promise<ReferralCampaign> {
  const conn = db ?? (await getDb());
  await conn.update(referralCampaigns).set({ status }).where(eq(referralCampaigns.id, id));
  const [row] = await conn.select().from(referralCampaigns).where(eq(referralCampaigns.id, id)).limit(1);
  if (!row) throw new ReferralCampaignValidationError("Campaña no encontrada");
  return row;
}

export async function listReferralCampaigns(db?: AnyDbHandle): Promise<ReferralCampaign[]> {
  const conn = db ?? (await getDb());
  return conn.select().from(referralCampaigns).orderBy(desc(referralCampaigns.createdAt));
}

export async function getReferralCampaignById(id: number, db?: AnyDbHandle): Promise<ReferralCampaign | null> {
  const conn = db ?? (await getDb());
  const [row] = await conn.select().from(referralCampaigns).where(eq(referralCampaigns.id, id)).limit(1);
  return row ?? null;
}

// ─── Administración — listado y analítica (spec §39-40, §73-74) ────────────

export interface AdminReferralRow {
  id: number;
  referrerUserId: number;
  referrerName: string | null;
  referredUserId: number;
  referredName: string | null;
  communityId: number | null;
  communityName: string | null;
  campaignId: number | null;
  campaignName: string | null;
  status: Referral["status"];
  registeredAt: Date;
  convertedAt: Date | null;
  rewardedAt: Date | null;
  inviterRewardTokens: number;
  inviteeRewardTokens: number;
  inviterRewarded: boolean;
  inviteeRewarded: boolean;
}

export interface ListAdminReferralsFilters {
  campaignId?: number;
  status?: Referral["status"];
  limit?: number;
  offset?: number;
}

export async function listReferralsForAdmin(filters: ListAdminReferralsFilters = {}, db?: AnyDbHandle): Promise<AdminReferralRow[]> {
  const conn = db ?? (await getDb());
  const referrerUsers = users;
  const conditions = [];
  if (filters.campaignId != null) conditions.push(eq(referrals.campaignId, filters.campaignId));
  if (filters.status != null) conditions.push(eq(referrals.status, filters.status));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const base = conn.select({
    r: referrals,
    referrerName: referrerUsers.name,
    community: communities,
    campaign: referralCampaigns,
  })
    .from(referrals)
    .leftJoin(referrerUsers, eq(referrals.referrerUserId, referrerUsers.id))
    .leftJoin(communities, eq(referrals.communityId, communities.id))
    .leftJoin(referralCampaigns, eq(referrals.campaignId, referralCampaigns.id));

  const rows = await (whereClause ? base.where(whereClause) : base)
    .orderBy(desc(referrals.registeredAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);

  const referredIds = rows.map(r => r.r.referredUserId);
  const referredNames = new Map<number, string | null>();
  if (referredIds.length > 0) {
    const referredRows = await conn.select({ id: users.id, name: users.name }).from(users);
    for (const u of referredRows) if (referredIds.includes(u.id)) referredNames.set(u.id, u.name);
  }

  return rows.map(({ r, referrerName, community, campaign }) => ({
    id: r.id,
    referrerUserId: r.referrerUserId,
    referrerName: referrerName ?? null,
    referredUserId: r.referredUserId,
    referredName: referredNames.get(r.referredUserId) ?? null,
    communityId: r.communityId,
    communityName: community?.name ?? null,
    campaignId: r.campaignId,
    campaignName: campaign?.name ?? null,
    status: r.status,
    registeredAt: r.registeredAt,
    convertedAt: r.convertedAt,
    rewardedAt: r.rewardedAt,
    inviterRewardTokens: r.inviterRewardTokens,
    inviteeRewardTokens: r.inviteeRewardTokens,
    inviterRewarded: r.inviterLedgerId != null,
    inviteeRewarded: r.inviteeLedgerId != null,
  }));
}

export interface ReferralOverview {
  totalReferred: number;
  totalConverted: number;
  totalRewarded: number;
  conversionRate: number;
  tokensIssued: number;
  uniqueInviters: number;
  pendingReconciliation: number;
}

export async function getReferralOverview(db?: AnyDbHandle): Promise<ReferralOverview> {
  const conn = db ?? (await getDb());
  const all = await conn.select().from(referrals);
  const totalReferred = all.length;
  const totalConverted = all.filter(r => r.status === "converted" || r.status === "rewarded").length;
  const rewardedRows = all.filter(r => r.status === "rewarded");
  const totalRewarded = rewardedRows.length;
  const tokensIssued = rewardedRows.reduce((sum, r) => sum + (r.inviterLedgerId != null ? r.inviterRewardTokens : 0) + (r.inviteeLedgerId != null ? r.inviteeRewardTokens : 0), 0);
  const uniqueInviters = new Set(all.map(r => r.referrerUserId)).size;
  const pending = await findReferralsPendingReconciliation(15, conn);

  return {
    totalReferred,
    totalConverted,
    totalRewarded,
    conversionRate: totalReferred > 0 ? totalConverted / totalReferred : 0,
    tokensIssued,
    uniqueInviters,
    pendingReconciliation: pending.length,
  };
}

export interface CampaignAnalytics {
  campaign: ReferralCampaign;
  totalReferred: number;
  totalConverted: number;
  totalRewarded: number;
  conversionRate: number;
  tokensIssued: number;
  uniqueInviters: number;
  topReferrers: Array<{ referrerUserId: number; name: string | null; convertedCount: number }>;
}

// ─── Student 360 (spec §37-38) ──────────────────────────────────────────────

export interface StudentReferralTimelineEvent {
  kind: "referral_registered" | "referral_converted";
  occurredAt: Date;
  referralId: number;
}

/**
 * Usado por studentActivityAggregator.ts — SOLO los 2 hechos con valor real
 * para un admin viendo la ficha 360 (spec §37-38): "llegó por invitación"
 * (como invitee, como mucho una fila — spec §7, un referido tiene un único
 * referrer) y "una invitación suya se convirtió" (como inviter, una por
 * cada referido convertido). Nunca incluye la recompensa en sí — ya visible
 * como token_credit vía el ledger real.
 */
export async function listReferralEventsByUserId(userId: number, db?: AnyDbHandle): Promise<StudentReferralTimelineEvent[]> {
  const conn = db ?? (await getDb());
  const [asInvitee, asInviter] = await Promise.all([
    conn.select().from(referrals).where(eq(referrals.referredUserId, userId)).limit(1),
    conn.select().from(referrals).where(eq(referrals.referrerUserId, userId)),
  ]);

  const events: StudentReferralTimelineEvent[] = [];
  if (asInvitee[0]) events.push({ kind: "referral_registered", occurredAt: asInvitee[0].registeredAt, referralId: asInvitee[0].id });
  for (const r of asInviter) {
    if ((r.status === "converted" || r.status === "rewarded") && r.convertedAt) {
      events.push({ kind: "referral_converted", occurredAt: r.convertedAt, referralId: r.id });
    }
  }
  return events;
}

export async function getCampaignAnalytics(campaignId: number, db?: AnyDbHandle): Promise<CampaignAnalytics | null> {
  const conn = db ?? (await getDb());
  const campaign = await getReferralCampaignById(campaignId, conn);
  if (!campaign) return null;

  const rows = await conn.select().from(referrals).where(eq(referrals.campaignId, campaignId));
  const totalConverted = rows.filter(r => r.status === "converted" || r.status === "rewarded").length;
  const rewardedRows = rows.filter(r => r.status === "rewarded");
  const tokensIssued = rewardedRows.reduce((sum, r) => sum + (r.inviterLedgerId != null ? r.inviterRewardTokens : 0) + (r.inviteeLedgerId != null ? r.inviteeRewardTokens : 0), 0);

  const byReferrer = new Map<number, number>();
  for (const r of rows) {
    if (r.status === "converted" || r.status === "rewarded") {
      byReferrer.set(r.referrerUserId, (byReferrer.get(r.referrerUserId) ?? 0) + 1);
    }
  }
  const topEntries = Array.from(byReferrer.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const namesRows = topEntries.length > 0 ? await conn.select({ id: users.id, name: users.name }).from(users) : [];
  const nameById = new Map(namesRows.map(u => [u.id, u.name]));

  return {
    campaign,
    totalReferred: rows.length,
    totalConverted,
    totalRewarded: rewardedRows.length,
    conversionRate: rows.length > 0 ? totalConverted / rows.length : 0,
    tokensIssued,
    uniqueInviters: new Set(rows.map(r => r.referrerUserId)).size,
    topReferrers: topEntries.map(([referrerUserId, convertedCount]) => ({ referrerUserId, name: nameById.get(referrerUserId) ?? null, convertedCount })),
  };
}
