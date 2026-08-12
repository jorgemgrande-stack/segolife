/**
 * scripts/seed-fourvenues-integrations-provider.ts — registra el nuevo
 * provider `fourvenues_integrations` en el catálogo de integration_providers
 * (Fase 5). Deliberadamente NO ejecuta el resto de scripts/db-seed.ts (RBAC,
 * feature flag baseline, comunidades) — solo esta fila, para no arrastrar
 * ningún otro efecto secundario a producción.
 *
 * Uso: npx tsx scripts/seed-fourvenues-integrations-provider.ts
 *
 * Idempotente (INSERT IGNORE dentro de seedIntegrationProvidersIfNeeded) —
 * seguro de ejecutar más de una vez. No crea ninguna integración por venue
 * ni guarda ninguna credencial — solo el catálogo de providers disponibles.
 */
import "dotenv/config";
import { seedIntegrationProvidersIfNeeded } from "../server/segolife/integrations/integrationProvidersSeed";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[seed-fourvenues-integrations-provider] DATABASE_URL no está definido. Aborta.");
    process.exit(1);
  }
  console.log("[seed-fourvenues-integrations-provider] Sembrando catálogo de providers (fourvenues / fourvenues_integrations / weezevent / segolife_native)...");
  const { providersAdded } = await seedIntegrationProvidersIfNeeded();
  console.log(`[seed-fourvenues-integrations-provider] Completado. Providers nuevos: ${providersAdded.join(", ") || "ninguno (ya existían)"}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-fourvenues-integrations-provider] Error:", err);
  process.exit(1);
});
