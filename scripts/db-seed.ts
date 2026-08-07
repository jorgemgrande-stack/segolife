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

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[db:seed] DATABASE_URL no está definido. Aborta.");
    process.exit(1);
  }

  console.log("[db:seed] Sembrando comunidades Segolife (IE/UVA)...");
  await seedSegolifeCommunitiesIfEmpty();

  console.log("[db:seed] Sembrando catálogo RBAC (students.view/students.manage + sync de roles)...");
  await seedRbacIfNeeded();

  console.log("[db:seed] Completado.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[db:seed] Error:", err);
  process.exit(1);
});
