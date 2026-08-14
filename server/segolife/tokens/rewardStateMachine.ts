/**
 * rewardStateMachine.ts — SEGOLIFE LOYALTY PRODUCTION HARDENING (spec §4-5).
 * Formaliza el estado de una recompensa externa (NOT_EVALUATED / ELIGIBLE /
 * GRANTED / DENIED_TEMPORARY / DENIED_PERMANENT / REVERSED) SIN tabla nueva
 * — REUSE FIRST (spec §4: "no crees tabla nueva salvo justificación clara").
 *
 * PERSISTENCIA: un `RewardAttempt` se guarda en el `metadata` JSON de la
 * fila origen (`ticket_orders.metadata.rewardAttempt`,
 * `event_attendance.metadata.rewardAttempt`,
 * `commerce_transactions.metadata.rewardAttempt`) — mismo criterio que ya
 * usa `ticket_orders.metadata.purchaseLoyaltyLedgerId`/
 * `loyaltyReconciliationRequired`. GRANTED/REVERSED siguen derivándose del
 * ledger real (`ledgerId` + `isLedgerEntryReversed`), nunca duplicados aquí
 * como una verdad paralela — este módulo solo añade lo que el ledger no
 * puede responder por sí solo: "¿ya lo intenté?, ¿por qué no?, ¿puedo
 * reintentar?".
 *
 * RETRY (spec §5): distingue denegación TEMPORAL (puede resolverse sola —
 * tope agotado, fuera de horario, sin regla activa TODAVÍA) de PERMANENTE
 * (corte de loyalty — un hecho histórico fijo que nunca cambia) — y limita
 * los reintentos con `MAX_ATTEMPTS` para que "temporal" nunca signifique
 * "para siempre" (spec: "NO implementes retries infinitos").
 */

export type RewardState = "NOT_EVALUATED" | "ELIGIBLE" | "GRANTED" | "DENIED_TEMPORARY" | "DENIED_PERMANENT" | "REVERSED";

/** Mismos códigos que RewardReason en rewardEngine.ts + UNKNOWN_IDENTITY (gestionado en realidad por unresolved_operations, incluido aquí solo para completar la matriz) + GLOBAL_LIVE_DISABLED (SegoTokens Live Activation, spec §19/§35). */
export type DenialReasonCode = "CUTOFF_BLOCKED" | "OUTSIDE_SCHEDULE" | "NO_RULE_FOUND" | "RULE_LIMIT_EXCEEDED" | "UNKNOWN_IDENTITY" | "GLOBAL_LIVE_DISABLED";

export const MAX_RETRY_ATTEMPTS = 5;

export interface RewardAttempt {
  status: "GRANTED" | "DENIED_TEMPORARY" | "DENIED_PERMANENT";
  reason: DenialReasonCode | null;
  attempts: number;
  lastAttemptAt: string;
  ledgerId: number | null;
  /** Generación de idempotencia (spec §3, "refunded → paid") — 0 en el primer intento, +1 cada vez que se reintenta tras una reversión confirmada. Ver ticketPurchasePipeline.buildPurchaseIdempotencyKey. */
  generation: number;
  retryable: boolean;
}

/**
 * Clasifica un motivo de denegación como PERMANENTE (nunca cambiará por sí
 * solo, spec §5 ejemplo: "operación anterior al cutoff") o TEMPORAL (spec
 * §5 ejemplos: tope agotado, horario, regla aún no activa). Decisión
 * explícita, no heurística — cambiar esto es una decisión de política, no
 * un detalle de implementación.
 */
export function isPermanentDenial(reason: DenialReasonCode): boolean {
  switch (reason) {
    case "CUTOFF_BLOCKED": return true;
    case "OUTSIDE_SCHEDULE": return false;
    case "RULE_LIMIT_EXCEEDED": return false;
    case "NO_RULE_FOUND": return false; // una regla nueva podría activarse después — nunca se asume no-retroactividad sin una política explícita que aún no existe
    case "UNKNOWN_IDENTITY": return false;
    // Permanente respecto a ESTE intento concreto (nunca se reintenta solo):
    // solo cambia con un commit revisado, nunca por sí sola con el tiempo —
    // mismo criterio que CUTOFF_BLOCKED (spec §19).
    case "GLOBAL_LIVE_DISABLED": return true;
  }
}

/** Construye el siguiente intento a partir del anterior (o null si es el primero) — puro, determinista, sin I/O. */
export function buildNextAttempt(
  outcome: { ledgerId: number | null; reason: DenialReasonCode | null },
  previous: RewardAttempt | null | undefined,
  now: Date = new Date()
): RewardAttempt {
  const attempts = (previous?.attempts ?? 0) + 1;
  const generation = previous?.generation ?? 0;

  if (outcome.ledgerId != null) {
    return { status: "GRANTED", reason: null, attempts, lastAttemptAt: now.toISOString(), ledgerId: outcome.ledgerId, generation, retryable: false };
  }

  const permanent = outcome.reason != null && isPermanentDenial(outcome.reason);
  const exhausted = attempts >= MAX_RETRY_ATTEMPTS;
  return {
    status: permanent || exhausted ? "DENIED_PERMANENT" : "DENIED_TEMPORARY",
    reason: outcome.reason,
    attempts,
    lastAttemptAt: now.toISOString(),
    ledgerId: null,
    generation,
    retryable: !permanent && !exhausted,
  };
}

/** Construye el primer intento tras una regeneración (spec §3: refunded→paid tras una reversión ya confirmada) — reinicia el contador de intentos, incrementa la generación. */
export function buildRegeneratedAttempt(previous: RewardAttempt): RewardAttempt {
  return { status: "DENIED_TEMPORARY", reason: null, attempts: 0, lastAttemptAt: new Date(0).toISOString(), ledgerId: null, generation: previous.generation + 1, retryable: true };
}

/** ¿Debe el pipeline intentar (de nuevo) conceder esta recompensa? NOT_EVALUATED (`previous` null) siempre sí; GRANTED nunca (ya está); denegación temporal con margen de reintento sí; permanente/agotada no. */
export function shouldAttemptReward(previous: RewardAttempt | null | undefined): boolean {
  if (!previous) return true;
  if (previous.status === "GRANTED") return false;
  return previous.retryable;
}

/**
 * Estado observable — GRANTED se reclasifica como REVERSED si el ledger
 * referenciado ya fue revertido (comprobación real vía
 * `isLedgerEntryReversed`, nunca un booleano duplicado en este metadata).
 */
export function deriveRewardState(attempt: RewardAttempt | null | undefined, isReversed: boolean): RewardState {
  if (!attempt) return "NOT_EVALUATED";
  if (attempt.status === "GRANTED") return isReversed ? "REVERSED" : "GRANTED";
  return attempt.status;
}
