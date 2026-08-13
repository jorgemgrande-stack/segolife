/**
 * _historical-loyalty-simulation.ts — SEGOLIFE LIVE LOYALTY DESIGN,
 * Historical Simulation. SOLO LECTURA — no escribe en ninguna tabla.
 *
 * Ejecuta los 5 modelos de política (A-E, ver historicalRewardSimulator.ts)
 * sobre las identidades históricas Fourvenues YA PERSISTIDAS en
 * `unresolved_operations` (reutilizando `loadHistoricalSimulationInput`, la
 * misma agregación canónica que ya usa el directorio admin de identidades
 * históricas — spec "REUSE FIRST"). Imprime un JSON estructurado con
 * estadísticas agregadas por modelo + impacto económico a 3 valores de
 * token — nunca imprime email/nombre/teléfono individuales.
 *
 * Uso (Railway Console, servicio segolife):
 *   npx tsx scripts/_historical-loyalty-simulation.ts
 */
import { loadHistoricalSimulationInput } from "../server/segolife/students/historicalIdentityService";
import {
  POLICY_MODELS,
  simulatePolicyModel,
  computeModelStats,
  computeEconomicImpact,
} from "../server/segolife/tokens/historicalRewardSimulator";

const TOKEN_VALUES_EUR_CENTS = [1, 2, 5]; // €0.01 / €0.02 / €0.05 por token

async function main() {
  console.log("Cargando identidades históricas (unresolved_operations, provider=fourvenues_integrations)...");
  const identities = await loadHistoricalSimulationInput();
  console.log(`Identidades cargadas: ${identities.length}`);

  const totalRows = identities.reduce((s, i) => s + i.rows.length, 0);
  const orderRows = identities.reduce((s, i) => s + i.rows.filter(r => r.operationType === "order").length, 0);
  const attendanceRows = identities.reduce((s, i) => s + i.rows.filter(r => r.operationType === "attendance").length, 0);
  const totalRevenueCents = identities.reduce((s, i) => s + i.rows.filter(r => r.operationType === "order").reduce((s2, r) => s2 + (r.amountCents ?? 0), 0), 0);
  const knownStudentsCount = identities.filter(i => i.isKnownStudent).length;

  console.log(JSON.stringify({
    identitiesTotal: identities.length,
    knownStudentsCount,
    historicalOnlyCount: identities.length - knownStudentsCount,
    rowsTotal: totalRows,
    orderRows,
    attendanceRows,
    totalRevenueCents,
    totalRevenueEur: (totalRevenueCents / 100).toFixed(2),
  }, null, 2));

  const results = POLICY_MODELS.map(model => {
    const events = simulatePolicyModel(model, identities);
    const stats = computeModelStats(model, events, identities.length);
    const economics = TOKEN_VALUES_EUR_CENTS.map(v => computeEconomicImpact(stats, totalRevenueCents, v));
    return { model: { key: model.key, name: model.name, description: model.description }, stats, economics };
  });

  console.log("\n=== RESULTADOS POR MODELO (A-E) ===");
  console.log(JSON.stringify(results, null, 2));

  console.log("\n=== TABLA COMPARATIVA RESUMEN ===");
  for (const r of results) {
    const midEconomics = r.economics[1]; // €0.02/token, valor intermedio de referencia
    console.log(
      `${r.model.key} | ${r.model.name} | premiados=${r.stats.peopleRewarded} | recompensas=${r.stats.rewardsCount} | ` +
      `tokens=${r.stats.totalTokensIssued} | media=${r.stats.avgTokensPerRewardedPerson.toFixed(1)} | p95=${r.stats.p95TokensPerRewardedPerson} | ` +
      `max=${r.stats.maxTokensPerRewardedPerson} | equiv€(0.02)=${(midEconomics.totalLiabilityEurCents / 100).toFixed(2)} | ` +
      `tasa/revenue=${(midEconomics.rewardRateOverRevenue * 100).toFixed(2)}% | top1%=${(r.stats.top1PercentShare * 100).toFixed(1)}%`
    );
  }

  console.log("\nSIMULATION_DONE");
  process.exit(0);
}

main().catch(err => {
  console.error("Simulación histórica falló:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
