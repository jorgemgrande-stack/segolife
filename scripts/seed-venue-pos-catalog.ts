/**
 * scripts/seed-venue-pos-catalog.ts — CLI explícito, manual y one-shot para
 * poblar el catálogo BASE de barra (Venue Bar POS, Fase 10.7) de los venues
 * reales de nightlife de SEGOLIFE (Fase 12.5). Mismo patrón de seguridad
 * que bootstrap-production-venues.ts: exige una atestación explícita
 * `--target=MySQL-zWz9` del operador, lee DATABASE_URL del entorno (nunca
 * lo construye), y NUNCA se invoca desde npm start / db:migrate / db:seed /
 * el arranque del servidor.
 *
 * REUSE FIRST: reutiliza createVenueProduct/listVenueProducts de
 * server/db/venueProductsDb.ts (misma lógica que usaría un humano desde el
 * admin) y el planificador puro y probado de
 * server/segolife/commerce/venueProductCatalogSeed.ts — este script NO
 * decide qué insertar, solo ejecuta el plan que el planificador calcula.
 *
 * Venues objetivo: SOLO los venues nightlife/bar reales confirmados en la
 * auditoría de esta fase (Casanova, Chin Chin, La Finca Club, Limoncello,
 * Tía Felisa) — "Selfish Poke" (restaurante) y "Tanker Events" (tipo
 * ambiguo, sin metadata que lo confirme) quedan deliberadamente excluidos,
 * ver informe final de la Fase 12.5.
 *
 * Idempotencia por (venueId, slug) — mismo criterio que el planificador; no
 * requiere ningún constraint nuevo (venue_products_venue_slug_unique ya
 * existe). No sobrescribe productos existentes, no borra nada, no toca
 * stock/precio/categoría de una fila ya presente.
 *
 * metadata.seedSource permite identificar el origen sin añadir ninguna
 * columna nueva (spec §30 "no migration needed").
 *
 * Uso:
 *   DATABASE_URL=... pnpm tsx scripts/seed-venue-pos-catalog.ts -- --target=MySQL-zWz9 [--dry-run]
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { venues as venuesTable, venueProducts } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { createVenueProduct } from "../server/db/venueProductsDb";
import { planCatalogSeed } from "../server/segolife/commerce/venueProductCatalogSeed";

const EXPECTED_TARGET = "MySQL-zWz9";

// Confirmados nightlife/bar reales en la auditoría de la Fase 12.5 (sin
// metadata de categoría de venue disponible en producción — venue_categories
// está vacía — así que la clasificación usa el nombre, único dato real
// disponible, tal y como el propio spec anticipa cuando no hay metadata más
// fuerte, spec §29).
const NIGHTLIFE_VENUE_SLUGS = ["casanova", "chin-chin", "la-finca-club", "limoncello", "tia-felisa"];

function parseArgs(argv: string[]): { target: string; dryRun: boolean } {
  let target = "";
  let dryRun = false;
  for (const arg of argv) {
    const m = /^--([a-zA-Z0-9_-]+)=(.*)$/.exec(arg);
    if (m?.[1] === "target") target = m[2];
    if (arg === "--dry-run") dryRun = true;
  }
  return { target, dryRun };
}

async function main() {
  const { target, dryRun } = parseArgs(process.argv.slice(2));

  if (target !== EXPECTED_TARGET) {
    console.error(`[seed-venue-pos-catalog] --target debe ser exactamente "${EXPECTED_TARGET}" (atestación explícita del operador). Recibido: "${target || "(vacío)"}". Aborta.`);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("[seed-venue-pos-catalog] DATABASE_URL no está definida. Aborta.");
    process.exit(1);
  }

  console.log(`[seed-venue-pos-catalog] Objetivo declarado por el operador: ${target}`);
  console.log(`[seed-venue-pos-catalog] Modo: ${dryRun ? "DRY-RUN (sin escritura)" : "ESCRITURA REAL"}`);

  const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 1 });
  const db = drizzle(pool);

  const allVenues = await db.select().from(venuesTable);
  const targetVenues = allVenues.filter(v => NIGHTLIFE_VENUE_SLUGS.includes(v.slug));

  const missing = NIGHTLIFE_VENUE_SLUGS.filter(slug => !targetVenues.some(v => v.slug === slug));
  if (missing.length > 0) {
    console.error(`[seed-venue-pos-catalog] Venues esperados no encontrados en producción: ${missing.join(", ")}. Aborta sin escribir nada.`);
    await pool.end();
    process.exit(1);
  }

  console.log(`\n[seed-venue-pos-catalog] Venues objetivo (${targetVenues.length}): ${targetVenues.map(v => `${v.name} (id=${v.id})`).join(", ")}`);

  const existingByVenue = new Map<number, Array<{ name: string; slug: string }>>();
  for (const v of targetVenues) {
    const existing = await db.select({ name: venueProducts.name, slug: venueProducts.slug })
      .from(venueProducts).where(eq(venueProducts.venueId, v.id));
    existingByVenue.set(v.id, existing);
  }

  const plan = planCatalogSeed(targetVenues.map(v => v.id), existingByVenue);

  console.log(`\n[seed-venue-pos-catalog] Plan calculado:`);
  console.log(`  A insertar:      ${plan.toInsert.length}`);
  console.log(`  Ya existentes:   ${plan.alreadyExists.length} (se omiten, no se tocan)`);
  console.log(`  Ambiguos:        ${plan.ambiguous.length} (se omiten, requieren revisión humana)`);

  if (plan.ambiguous.length > 0) {
    console.log(`\n[seed-venue-pos-catalog] Coincidencias ambiguas (NO se insertan, NO se fusionan):`);
    for (const a of plan.ambiguous) console.log(`  venue=${a.venueId} candidato="${a.candidateName}" vs existente="${a.existingName}"`);
  }

  if (dryRun) {
    console.log(`\n[seed-venue-pos-catalog] [dry-run] Se insertarían ${plan.toInsert.length} productos:`);
    const byVenue = new Map<number, typeof plan.toInsert>();
    for (const p of plan.toInsert) byVenue.set(p.venueId, [...(byVenue.get(p.venueId) ?? []), p]);
    for (const [venueId, products] of byVenue) {
      const venueName = targetVenues.find(v => v.id === venueId)?.name;
      console.log(`  ${venueName} (id=${venueId}): ${products.length} productos`);
      for (const p of products) console.log(`    [${p.category}] ${p.name} — €${p.price}`);
    }
    await pool.end();
    console.log("\n[seed-venue-pos-catalog] Dry-run completado. Sin escritura.");
    process.exit(0);
  }

  let created = 0;
  for (const p of plan.toInsert) {
    await createVenueProduct({
      venueId: p.venueId, name: p.name, slug: p.slug, category: p.category, price: p.price,
      metadata: { seedSource: "phase12_5_bootstrap" },
    }, db);
    created++;
  }

  console.log(`\n[seed-venue-pos-catalog] Completado. ${created} productos creados, ${plan.alreadyExists.length} ya existían, ${plan.ambiguous.length} ambiguos sin tocar.`);
  await pool.end();
  process.exit(0);
}

main().catch(err => {
  console.error("[seed-venue-pos-catalog] Error:", err.message);
  process.exit(1);
});
