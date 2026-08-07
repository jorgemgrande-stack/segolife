/**
 * bootHygiene.test.ts — STARTUP != MIGRATION / STARTUP != SEED (ver CLAUDE.md).
 *
 * server/_core/index.ts ejecuta su cadena de arranque a nivel de módulo (side
 * effect en el top-level, ver la llamada a verifyDatabaseConnectivity().then(...)
 * al final del archivo) — importarlo en un test intentaría arrancar el server
 * real y conectar a una BD real. Por eso estos tests son estructurales: leen el
 * código fuente como texto y verifican que las mutaciones de schema/datos que
 * antes corrían automáticamente en cada arranque ya no están presentes ni se
 * invocan desde aquí, y que solo existen como comandos explícitos separados.
 *
 * Fase de saneamiento de startup — ver CLAUDE.md para el contexto completo.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Estos archivos documentan a propósito, en comentarios, qué funciones se
 * movieron o se eliminaron de aquí (breadcrumbs para el siguiente desarrollador
 * — ver por ejemplo la cabecera de legacyNayadeContentSeeds.ts). Esos
 * comentarios mencionan literalmente los nombres de las funciones peligrosas,
 * así que las aserciones de este test deben ignorar comentarios y mirar solo
 * código real (definiciones, imports, invocaciones).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const readCode = (path: string) => stripComments(readFileSync(path, "utf-8"));

const indexSource = readCode(resolve(__dirname, "index.ts"));
const dbMigrateSource = readCode(resolve(__dirname, "../../scripts/db-migrate.ts"));
const dbSeedSource = readCode(resolve(__dirname, "../../scripts/db-seed.ts"));
const legacyMaintenanceSource = readCode(resolve(__dirname, "legacyMaintenance.ts"));
const legacyNayadeSeedsSource = readCode(resolve(__dirname, "legacyNayadeContentSeeds.ts"));

describe("server/_core/index.ts — el arranque no migra ni siembra nada", () => {
  it("no importa ni invoca el migrator real de Drizzle", () => {
    expect(indexSource).not.toMatch(/drizzle-orm\/mysql2\/migrator/);
    expect(indexSource).not.toMatch(/\brunMigrations\s*\(/);
  });

  it("no define ni llama a ninguna de las funciones de reparación de schema heredadas", () => {
    for (const fn of [
      "ensureCriticalSeeds",
      "migrateSiteSettingsToSystemSettings",
      "ensurePricingColumns",
      "ensureLeadSourceColumn",
      "ensureTicketingChannel",
      "ensureExpenseEmailIngestionSchema",
      "ensureReservationPublicToken",
      "ensureRefundColumns",
      "ensureDiscountColumns",
      "fixBrokenInvoicePdfUrls",
    ]) {
      expect(indexSource).not.toMatch(new RegExp(`\\basync function ${fn}\\b`));
      expect(indexSource).not.toMatch(new RegExp(`\\b${fn}\\s*\\(\\s*\\)`));
    }
  });

  it("no importa ni llama al seed de comunidades Segolife (IE/UVA)", () => {
    expect(indexSource).not.toMatch(/seedSegolifeCommunitiesIfEmpty/);
    expect(indexSource).not.toMatch(/from ["']\.\.\/db\/communitiesDb["']/);
  });

  it("no importa ni llama al seed RBAC", () => {
    expect(indexSource).not.toMatch(/seedRbacIfNeeded/);
    expect(indexSource).not.toMatch(/from ["']\.\/rbacSeed["']/);
  });

  it("no importa ni llama al seed de contenido heredado de Náyade (experiencias/CMS)", () => {
    expect(indexSource).not.toMatch(/seedExperiencesIfEmpty/);
    expect(indexSource).not.toMatch(/seedNayadeHomepageCms/);
    expect(indexSource).not.toMatch(/legacyNayadeContentSeeds/);
  });

  it("ningún job programado se autoactiva por defecto (todo default=false en conditionallyStartJob)", () => {
    const calls = [...indexSource.matchAll(/conditionallyStartJob\(\s*"[^"]+",\s*\w+,\s*"[^"]+"(?:,\s*(true|false))?\s*\)/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      // Sin cuarto argumento, conditionallyStartJob usa defaultEnabled=false (ver su firma) — ambos casos son seguros.
      if (call[1] !== undefined) {
        expect(call[1]).toBe("false");
      }
    }
  });

  it("conserva verifyDatabaseConnectivity() como único paso de comprobación de BD en el arranque", () => {
    expect(indexSource).toMatch(/async function verifyDatabaseConnectivity/);
    expect(indexSource).toMatch(/verifyDatabaseConnectivity\(\)\s*\n\s*\.then\(\(\)\s*=>\s*wipeTestDataIfRequested\(\)\)/);
  });
});

describe("scripts/db-migrate.ts y scripts/db-seed.ts — comandos explícitos y separados", () => {
  it("db-migrate.ts usa el migrator real de Drizzle y las reparaciones de schema heredadas", () => {
    expect(dbMigrateSource).toMatch(/drizzle-orm\/mysql2\/migrator/);
    expect(dbMigrateSource).toMatch(/runLegacySchemaMaintenance/);
  });

  it("db-migrate.ts NO siembra datos de Segolife ni RBAC", () => {
    expect(dbMigrateSource).not.toMatch(/seedSegolifeCommunitiesIfEmpty/);
    expect(dbMigrateSource).not.toMatch(/seedRbacIfNeeded/);
  });

  it("db-seed.ts siembra comunidades Segolife y RBAC, no migra schema", () => {
    expect(dbSeedSource).toMatch(/seedSegolifeCommunitiesIfEmpty/);
    expect(dbSeedSource).toMatch(/seedRbacIfNeeded/);
    expect(dbSeedSource).not.toMatch(/drizzle-orm\/mysql2\/migrator/);
  });

  it("db-seed.ts NO siembra el catálogo heredado de Náyade (experiencias/CMS)", () => {
    expect(dbSeedSource).not.toMatch(/seedExperiencesIfEmpty/);
    expect(dbSeedSource).not.toMatch(/legacyNayadeContentSeeds/);
  });
});

describe("legacyMaintenance.ts — sin contenido operativo de Náyade", () => {
  it("no fuerza el teléfono/email real de Náyade en system_settings ni en plantillas de email", () => {
    expect(legacyMaintenanceSource).not.toMatch(/reservas@nayadeexperiences\.es/);
    expect(legacyMaintenanceSource).not.toMatch(/\+34 639 57 66 27/);
    expect(legacyMaintenanceSource).not.toMatch(/email_templates.*REPLACE/s);
  });

  it("expone runLegacySchemaMaintenance como único punto de entrada", () => {
    expect(legacyMaintenanceSource).toMatch(/export async function runLegacySchemaMaintenance/);
  });

  it("registra los feature flags de jobs operativos desactivados por defecto (enabled=0, default_enabled=0)", () => {
    expect(legacyMaintenanceSource).not.toMatch(/VALUES \(\?, \?, \?, \?, 1, 1,/);
  });
});

describe("legacyNayadeContentSeeds.ts — desconectado de cualquier comando", () => {
  it("ningún otro archivo de server/ o scripts/ lo importa", () => {
    expect(dbMigrateSource).not.toMatch(/legacyNayadeContentSeeds/);
    expect(dbSeedSource).not.toMatch(/legacyNayadeContentSeeds/);
    expect(indexSource).not.toMatch(/legacyNayadeContentSeeds/);
  });

  it("sigue conteniendo el catálogo heredado (no se borró la implementación, solo se desconectó)", () => {
    expect(legacyNayadeSeedsSource).toMatch(/export async function seedExperiencesIfEmpty/);
    expect(legacyNayadeSeedsSource).toMatch(/export async function seedNayadeHomepageCms/);
  });
});
