/**
 * tokenClawbackReconciliationJob.ts — FIX-01 (spec §14). Job programado,
 * mismo patrón exacto que cancellationStaleJob.ts: cron propio, pool propio
 * de una conexión, nunca arranca sin que un admin active el feature flag
 * (default false, ver server/_core/index.ts). Reintenta cada 30 minutos
 * cualquier clawback de SegoTokens que quedara pendiente tras un fallo
 * transitorio en el momento del refund — ver tokenClawbackReconciliationService.ts.
 */
import cron from "node-cron";
import { retryPendingTokenClawbacks } from "./tokenClawbackReconciliationService";

async function runTokenClawbackReconciliationJob() {
  try {
    const result = await retryPendingTokenClawbacks();
    if (result.processed === 0) return;
    console.log(`[TokenClawbackReconciliation] ${result.resolved}/${result.processed} clawback(s) pendiente(s) resuelto(s) (${result.stillPending} siguen pendientes: ${result.candidateOrderIds.join(", ")})`);
  } catch (err) {
    console.error("[TokenClawbackReconciliation] Error en job:", err);
  }
}

/** Inicia el job programado. Se ejecuta cada 30 minutos. */
export function startTokenClawbackReconciliationJob() {
  console.log("[TokenClawbackReconciliation] Job de reconciliación de clawback pendiente iniciado (cada 30 min)");
  cron.schedule("*/30 * * * *", () => {
    runTokenClawbackReconciliationJob().catch(console.error);
  });
}
