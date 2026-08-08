/**
 * scripts/db-seed.ts — comando explícito de seed de datos de Segolife.
 *
 * Uso: pnpm db:seed
 *
 * Ejecuta, en orden:
 *  1. seedSegolifeCommunitiesIfEmpty() — comunidades IE/UVA + universidades +
 *     relación community_universities (server/db/communitiesDb.ts).
 *  2. seedRbacIfNeeded() — catálogo RBAC mínimo + permisos students.view/
 *     students.manage + sincronización de roles de usuarios existentes
 *     (server/_core/rbacSeed.ts).
 *  3. applySegolifeFeatureFlagBaseline() — apaga (enabled=0) los feature
 *     flags de módulos/jobs legacy de Náyade que `pnpm db:migrate` deja
 *     activados por venir así en migraciones históricas
 *     (server/_core/segolifeFeatureFlagBaseline.ts).
 *  4. seedIntegrationProvidersIfNeeded() — catálogo (NO datos de negocio)
 *     de providers del Integration Hub: fourvenues/weezevent/segolife_native
 *     (Fase 5, server/segolife/integrations/integrationProvidersSeed.ts).
 *     NUNCA siembra venues/eventos/credenciales reales (Casanova, Tía
 *     Felisa, Limoncello, Tankers, Mambo quedan sin dar de alta).
 *
 * STARTUP != SEED: este script NUNCA se invoca desde server/_core/index.ts.
 * Requiere que el schema ya exista — ejecuta `pnpm db:migrate` antes si es
 * la primera vez sobre una base de datos vacía.
 *
 * Deliberadamente NO incluye ningún seed de contenido/catálogo heredado de
 * Náyade Experiences (ver server/_core/legacyNayadeContentSeeds.ts, que está
 * desconectado de todo script a propósito).
 */
import "dotenv/config";
import { seedSegolifeCommunitiesIfEmpty } from "../server/db/communitiesDb";
import { seedRbacIfNeeded } from "../server/_core/rbacSeed";
import { applySegolifeFeatureFlagBaseline } from "../server/_core/segolifeFeatureFlagBaseline";
import { seedIntegrationProvidersIfNeeded } from "../server/segolife/integrations/integrationProvidersSeed";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[db:seed] DATABASE_URL no está definido. Aborta.");
    process.exit(1);
  }

  console.log("[db:seed] Sembrando comunidades Segolife (IE/UVA)...");
  await seedSegolifeCommunitiesIfEmpty();

  console.log("[db:seed] Sembrando catálogo RBAC (students.view/students.manage + sync de roles)...");
  await seedRbacIfNeeded();

  console.log("[db:seed] Aplicando baseline operativo Segolife (apagando módulos/jobs legacy de Náyade)...");
  await applySegolifeFeatureFlagBaseline();

  console.log("[db:seed] Sembrando catálogo de providers del Integration Hub (fourvenues/weezevent/segolife_native)...");
  await seedIntegrationProvidersIfNeeded();

  console.log("[db:seed] Completado.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[db:seed] Error:", err);
  process.exit(1);
});
