/**
 * scripts/db-migrate.ts — comando explícito de migración de schema.
 *
 * Uso: pnpm db:migrate
 *
 * Ejecuta, en orden:
 *  1. Las migraciones reales de Drizzle (drizzle/*.sql) vía el migrator
 *     oficial de drizzle-orm — la misma función que antes se llamaba
 *     automáticamente en cada arranque del servidor (server/_core/index.ts).
 *  2. Las reparaciones de schema heredadas de Náyade que nunca llegaron a
 *     convertirse en migraciones formales (server/_core/legacyMaintenance.ts).
 *
 * STARTUP != MIGRATION: este script NUNCA se invoca desde server/_core/index.ts.
 * `pnpm dev` / `pnpm start` no tocan el schema — solo este comando lo hace,
 * y solo cuando alguien lo ejecuta a propósito.
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { resolve } from "path";
import { runLegacySchemaMaintenance } from "../server/_core/legacyMaintenance";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[db:migrate] DATABASE_URL no está definido. Aborta.");
    process.exit(1);
  }

  console.log("[db:migrate] Conectando a la base de datos...");
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 1 });
  const db = drizzle(pool);
  const migrationsFolder = resolve(process.cwd(), "drizzle");

  console.log(`[db:migrate] Aplicando migraciones desde ${migrationsFolder} ...`);
  await migrate(db, { migrationsFolder });
  await pool.end();
  console.log("[db:migrate] Migraciones de Drizzle aplicadas correctamente.");

  console.log("[db:migrate] Aplicando reparaciones de schema heredadas (legacyMaintenance)...");
  await runLegacySchemaMaintenance();

  console.log("[db:migrate] Completado.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[db:migrate] Error:", err);
  process.exit(1);
});
