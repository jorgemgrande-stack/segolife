/**
 * scripts/bootstrap-production-venues.ts — CLI explícito, manual y one-shot
 * para crear los 7 venues reales de SEGOLIFE (Fase 8.6, cierre en
 * producción). Mismo patrón de seguridad que bootstrap-segolife-admin.ts:
 * exige una atestación explícita `--target=MySQL-zWz9` del operador, lee
 * DATABASE_URL del entorno (nunca lo construye), y NUNCA se invoca desde
 * npm start / db:migrate / db:seed / el arranque del servidor.
 *
 * REUSE FIRST: reutiliza createVenue/getVenueBySlug/setVenueCommunities de
 * server/db/venuesDb.ts (misma lógica que usa el router admin) en vez de
 * SQL inline — así el bootstrap crea EXACTAMENTE lo mismo que crearía un
 * humano desde /admin/venues.
 *
 * Datos autorizados por el spec de cierre de Fase 8.6, sección 15: SOLO
 * name/slug/logo(imageUrl)/cover(coverImageUrl)/gallery/comunidades IE+UVA.
 * NO se escribe tagline/instagramUrl/categoryId/address/phone/email/website
 * — son "datos no confirmados" y quedan NULL a propósito (nunca inventados).
 *
 * Idempotencia por slug: si el venue ya existe con el nombre esperado, no
 * se duplica (solo se asegura el vínculo de comunidades); si existe con un
 * nombre distinto al esperado, esa fila se detiene y se reporta sin tocarla.
 *
 * Uso:
 *   DATABASE_URL=... pnpm tsx scripts/bootstrap-production-venues.ts -- --target=MySQL-zWz9 [--dry-run]
 */
import "dotenv/config";
import { getVenueBySlug, createVenue, setVenueCommunities } from "../server/db/venuesDb";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { communities as communitiesTable } from "../drizzle/schema";

const EXPECTED_TARGET = "MySQL-zWz9";

const BASE = "https://segolife-production.up.railway.app/local-storage/nayade/uploads/";

interface VenueSpec {
  name: string;
  slug: string;
  imageUrl: string; // LOGO
  coverImageUrl: string; // COVER
  galleryUrl: string;
}

const VENUES: VenueSpec[] = [
  { name: "Casanova", slug: "casanova", imageUrl: BASE + "1786317449870-zc9v3t.png", coverImageUrl: BASE + "1786269405565-dot58r.jpg", galleryUrl: BASE + "1786316525751-ds2a1t.jpg" },
  { name: "Chin Chin", slug: "chin-chin", imageUrl: BASE + "1786317562916-vqhuaz.png", coverImageUrl: BASE + "1786317649924-g7crmu.jpg", galleryUrl: BASE + "1786317649310-7lprj6.jpg" },
  { name: "La Finca Club", slug: "la-finca-club", imageUrl: BASE + "1786317941615-ztszw4.png", coverImageUrl: BASE + "1786317991383-xo65cx.jpg", galleryUrl: BASE + "1786317991078-enc8en.jpg" },
  { name: "Limoncello", slug: "limoncello", imageUrl: BASE + "1786318032912-xs3jhy.png", coverImageUrl: BASE + "1786318052105-jfktws.jpg", galleryUrl: BASE + "1786318052367-99g99g.jpg" },
  // Selfish Poke: logo y cover comparten intencionalmente la misma URL — ver
  // docs/venues/venue-domain.md "gap editorial conocido". Auditado
  // visualmente en Fase 8.6 (QA local): funciona razonablemente como
  // identidad, se usa temporalmente. PENDIENTE LOGO SELFISH POKE dedicado.
  { name: "Selfish Poke", slug: "selfish-poke", imageUrl: BASE + "1786318124874-52jl67.jpg", coverImageUrl: BASE + "1786318124874-52jl67.jpg", galleryUrl: BASE + "1786318125387-wv2nyg.jpg" },
  // Tanker Events: venue estándar, sin excepción arquitectónica — mismos
  // campos autorizados que cualquier otro venue.
  { name: "Tanker Events", slug: "tanker-events", imageUrl: BASE + "1786318184854-vfjnfd.png", coverImageUrl: BASE + "1786318238349-hr1l54.jpg", galleryUrl: BASE + "1786318201725-jhd2js.jpg" },
  { name: "Tía Felisa", slug: "tia-felisa", imageUrl: BASE + "1786318274368-c5uq5e.png", coverImageUrl: BASE + "1786318283631-j14vth.jpg", galleryUrl: BASE + "1786318284092-lwjdab.jpg" },
];

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

async function verifyAssetHttp200(url: string): Promise<{ ok: boolean; contentType: string | null }> {
  const res = await fetch(url, { method: "GET" });
  const contentType = res.headers.get("content-type");
  return { ok: res.ok && !!contentType?.startsWith("image/"), contentType };
}

async function insertGalleryItem(db: ReturnType<typeof drizzle>, venueId: number, imageUrl: string, title: string) {
  const { galleryItems } = await import("../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");
  const existing = await db.select().from(galleryItems).where(and(eq(galleryItems.venueId, venueId), eq(galleryItems.imageUrl, imageUrl))).limit(1);
  if (existing.length > 0) {
    console.log(`  [gallery] ya existe, se omite`);
    return;
  }
  await db.insert(galleryItems).values({
    imageUrl,
    fileKey: "",
    title,
    category: "venue_gallery",
    sortOrder: 0,
    isActive: true,
    venueId,
  });
  console.log(`  [gallery] foto añadida`);
}

async function main() {
  const { target, dryRun } = parseArgs(process.argv.slice(2));

  if (target !== EXPECTED_TARGET) {
    console.error(`[bootstrap-venues] --target debe ser exactamente "${EXPECTED_TARGET}" (atestación explícita del operador). Recibido: "${target || "(vacío)"}". Aborta.`);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("[bootstrap-venues] DATABASE_URL no está definida. Aborta.");
    process.exit(1);
  }

  console.log(`[bootstrap-venues] Objetivo declarado por el operador: ${target}`);
  console.log(`[bootstrap-venues] Modo: ${dryRun ? "DRY-RUN (sin escritura)" : "ESCRITURA REAL"}`);

  // 1. Verificar HTTP 200 + Content-Type imagen de TODOS los assets antes de tocar la BD.
  console.log("\n[bootstrap-venues] Verificando assets reales (HTTP 200 + image/*)...");
  const urls = new Set<string>();
  for (const v of VENUES) { urls.add(v.imageUrl); urls.add(v.coverImageUrl); urls.add(v.galleryUrl); }
  let anyAssetFailed = false;
  for (const url of urls) {
    const { ok, contentType } = await verifyAssetHttp200(url);
    console.log(`  ${ok ? "OK " : "FAIL"} ${contentType ?? "(sin content-type)"} ${url}`);
    if (!ok) anyAssetFailed = true;
  }
  if (anyAssetFailed) {
    console.error("[bootstrap-venues] Al menos un asset no respondió HTTP 200 con Content-Type de imagen real. Aborta sin escribir nada.");
    process.exit(1);
  }

  const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 1 });
  const db = drizzle(pool);

  // 2. Resolver IDs de comunidades IE/UVA (reutilizadas, nunca recreadas).
  const allCommunities = await db.select().from(communitiesTable);
  const ie = allCommunities.find(c => c.slug === "ie");
  const uva = allCommunities.find(c => c.slug === "uva");
  if (!ie || !uva) {
    console.error(`[bootstrap-venues] No se encontraron las comunidades IE/UVA reales (encontradas: ${allCommunities.map(c => c.slug).join(", ") || "ninguna"}). Aborta.`);
    process.exit(1);
  }
  console.log(`\n[bootstrap-venues] Comunidades: IE=${ie.id} UVA=${uva.id}`);

  // 3. Crear/verificar cada venue — idempotente por slug.
  const results: Array<{ slug: string; status: string; id?: number }> = [];
  for (const spec of VENUES) {
    console.log(`\n[bootstrap-venues] ${spec.name} (${spec.slug})`);
    const existingDetail = await getVenueBySlug(spec.slug, db);

    if (existingDetail) {
      if (existingDetail.venue.name !== spec.name) {
        console.error(`  DETENIDO: ya existe un venue con slug="${spec.slug}" pero name="${existingDetail.venue.name}" (esperado "${spec.name}"). No se toca esta fila.`);
        results.push({ slug: spec.slug, status: "DETENIDO (incompatible)" });
        continue;
      }
      console.log(`  ya existe (id=${existingDetail.venue.id}) — no se duplica`);
      if (!dryRun) {
        await setVenueCommunities(existingDetail.venue.id, [ie.id, uva.id], db);
        await insertGalleryItem(db, existingDetail.venue.id, spec.galleryUrl, spec.name);
      }
      results.push({ slug: spec.slug, status: "ya existía, comunidades aseguradas", id: existingDetail.venue.id });
      continue;
    }

    if (dryRun) {
      console.log(`  [dry-run] se crearía con logo/cover/comunidades IE+UVA`);
      results.push({ slug: spec.slug, status: "[dry-run] se crearía" });
      continue;
    }

    const created = await createVenue(
      { name: spec.name, slug: spec.slug, imageUrl: spec.imageUrl, coverImageUrl: spec.coverImageUrl },
      [ie.id, uva.id],
      db
    );
    await insertGalleryItem(db, created.id, spec.galleryUrl, spec.name);
    console.log(`  creado (id=${created.id})`);
    results.push({ slug: spec.slug, status: "creado", id: created.id });
  }

  console.log("\n[bootstrap-venues] Resumen:");
  for (const r of results) console.log(`  ${r.slug.padEnd(16)} ${r.status}${r.id ? ` (id=${r.id})` : ""}`);

  const stopped = results.filter(r => r.status.startsWith("DETENIDO"));
  await pool.end();

  if (stopped.length > 0) {
    console.error(`\n[bootstrap-venues] Completado CON ${stopped.length} fila(s) detenida(s) — revisar manualmente.`);
    process.exit(1);
  }
  console.log("\n[bootstrap-venues] Completado.");
  process.exit(0);
}

main().catch(err => {
  console.error("[bootstrap-venues] Error:", err.message);
  process.exit(1);
});
