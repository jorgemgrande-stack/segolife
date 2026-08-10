/**
 * scripts/bootstrap-qa-events.ts — CLI explícito, manual y one-shot para
 * crear un lote controlado de EVENTS DE QA en los 3 venues reales que ya
 * tienen posters históricos subidos a Multimedia (Casanova, Tía Felisa,
 * Limoncello), con fecha futura, para validar visualmente/arquitectónicamente
 * el dominio de Events (Explore, VenueDetail, Event Detail, Admin Events) y
 * el modelo de venta POR EVENTO (sales_channels), no por venue.
 *
 * Mismo patrón de seguridad que bootstrap-production-venues.ts: exige una
 * atestación explícita `--target=MySQL-zWz9` del operador, lee DATABASE_URL
 * del entorno (nunca lo construye), verifica HTTP 200 + Content-Type de
 * imagen real de cada poster ANTES de escribir nada, y NUNCA se invoca desde
 * npm start / db:migrate / db:seed / el arranque del servidor.
 *
 * REUSE FIRST: reutiliza createEvent/getEventBySlug (server/db/eventsDb.ts),
 * createSalesChannel/createTicketType (server/segolife/ticketing/ticketingDb.ts)
 * y getVenueBySlug (server/db/venuesDb.ts) — el script crea exactamente lo
 * mismo que crearía un humano desde el admin, nunca SQL inline.
 *
 * SOLO crea: events, community_events (vía createEvent), sales_channels,
 * event_ticket_types (solo en eventos "native"). NUNCA crea ticket_orders,
 * ticket_order_items, event_tickets ni event_attendance — cero ventas/
 * asistencia reales, cero pagos.
 *
 * `events` NO tiene columna `metadata` (auditado contra el schema real antes
 * de escribir este script) — el marcado QA para poder identificar/borrar
 * estos eventos más adelante vive en `sales_channels.metadata` y
 * `event_ticket_types.metadata` (ambas columnas JSON sí existen), y sobre
 * todo en el manifiesto `scripts/qa-events-manifest.json` que este script
 * escribe/actualiza tras cada ejecución real — es la fuente de verdad para
 * un futuro cleanup, no un campo oculto en la tabla events.
 *
 * URLs de compra externas: NINGÚN evento de este lote tiene una URL real de
 * Fourvenues confirmada (auditado: no existe ninguna URL de evento concreta
 * en el histórico de la conversación, solo dominios genéricos de la
 * integración Fase 0). Por eso TODOS los canales external_redirect se crean
 * con externalUrl=null a propósito — computePurchaseAction() los resuelve
 * correctamente como "unavailable" en vez de mostrar un CTA falso. Esto es
 * parte de lo que este lote de QA valida.
 *
 * Uso:
 *   DATABASE_URL=... pnpm tsx scripts/bootstrap-qa-events.ts -- --target=MySQL-zWz9 [--dry-run]
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { getVenueBySlug } from "../server/db/venuesDb";
import { createEvent, getEventBySlug } from "../server/db/eventsDb";
import { createSalesChannel, createTicketType, listSalesChannels, listTicketTypes } from "../server/segolife/ticketing/ticketingDb";
import { communities as communitiesTable } from "../drizzle/schema";

const EXPECTED_TARGET = "MySQL-zWz9";
const QA_SOURCE = "historical_event_replay_2026";

const MEDIA_BASE = "https://segolife-production.up.railway.app/local-storage/segolife/uploads/";

interface QaTicketType {
  name: string;
  priceCents: number;
}

interface QaEventSpec {
  venueSlug: "casanova" | "tia-felisa" | "limoncello";
  name: string;
  slug: string;
  description: string;
  /** ISO UTC — ya convertido desde la hora local Europe/Madrid (CEST, UTC+2 en estas fechas). */
  startsAtIso: string;
  imageUrl: string;
  isFeatured: boolean;
  salesMode: "external_redirect" | "native";
  /** Solo para salesMode="native". */
  ticketType?: QaTicketType;
}

// ─── Los 10 EVENTS DE QA confirmados visualmente contra los posters reales ───
// subidos hoy a Multimedia (media_files id 113-124). Falta un 5º poster de
// Tía Felisa (no se ha subido ninguno más allá de id124 — auditado: MAX(id)
// de media_files = 124, total 35 filas) — ESE evento se deja pendiente a
// propósito, nunca se inventa ni se reutiliza el poster de otro venue.
const QA_EVENTS: QaEventSpec[] = [
  // ── CASANOVA (venue real id=1, slug="casanova") ────────────────────────────
  {
    venueSlug: "casanova",
    name: "Graduación 25/26 — Viernes",
    slug: "casanova-graduacion-2526-viernes",
    description: "Fiesta de Graduación 25/26 en Casanova.",
    startsAtIso: "2026-08-28T21:30:00Z", // Viernes 28 ago, 23:30 Europe/Madrid
    imageUrl: MEDIA_BASE + "1786354792694-slam2o.avif", // id114
    isFeatured: false,
    salesMode: "external_redirect",
  },
  {
    venueSlug: "casanova",
    name: "F*CK PAU",
    slug: "casanova-fck-pau",
    description: "Entrada gratuita para graduados de Casanova y Tía Felisa.",
    startsAtIso: "2026-08-29T21:00:00Z", // Sábado 29 ago, 23:00 Europe/Madrid
    imageUrl: MEDIA_BASE + "1786354793167-90ikvi.avif", // id116
    isFeatured: false,
    salesMode: "external_redirect",
  },
  {
    venueSlug: "casanova",
    name: "Graduación 25/26 — Jueves",
    slug: "casanova-graduacion-2526-jueves",
    description: "Fiesta de Graduación 25/26 en Casanova.",
    startsAtIso: "2026-09-03T21:30:00Z", // Jueves 3 sep, 23:30 Europe/Madrid
    imageUrl: MEDIA_BASE + "1786354792976-2hctge.avif", // id115
    isFeatured: false,
    salesMode: "native",
    ticketType: { name: "General", priceCents: 111 },
  },
  {
    venueSlug: "casanova",
    name: "FOMO — San Juan",
    slug: "casanova-fomo-san-juan",
    description: "Fiesta de San Juan. Line-up: MBPM B2B PYROS, MDMONKEY, ØDS, RUNAGROOVE.",
    startsAtIso: "2026-09-05T21:30:00Z", // Sábado 5 sep, 23:30 Europe/Madrid
    imageUrl: MEDIA_BASE + "1786354792404-xprj4o.avif", // id113
    isFeatured: true,
    salesMode: "native",
    ticketType: { name: "General", priceCents: 111 },
  },
  {
    venueSlug: "casanova",
    name: "FOMO — San Pedro",
    slug: "casanova-fomo-san-pedro",
    description: "Fiesta de San Pedro. Line-up: BORJA VITESSE, POPE, PYROS B2B MDMONKEY, YBSS.",
    startsAtIso: "2026-09-10T21:00:00Z", // Jueves 10 sep, 23:00 Europe/Madrid
    imageUrl: MEDIA_BASE + "1786354793378-ibszf6.avif", // id117
    isFeatured: false,
    salesMode: "external_redirect",
  },

  // ── TÍA FELISA (venue real id=7, slug="tia-felisa") ────────────────────────
  // Solo 4 de los 5 eventos requeridos: no hay un 5º poster subido. Pendiente.
  {
    venueSlug: "tia-felisa",
    name: "One More Felisa Before Exams",
    slug: "tia-felisa-one-more-felisa-before-exams",
    description: "Tía Felisa, antes de los exámenes.",
    startsAtIso: "2026-08-27T21:00:00Z", // Jueves 27 ago, 23:00 Europe/Madrid
    imageUrl: MEDIA_BASE + "1786355431366-v3lfhv.avif", // id121
    isFeatured: false,
    salesMode: "external_redirect",
  },
  {
    venueSlug: "tia-felisa",
    name: "F*ck Exams",
    slug: "tia-felisa-fck-exams",
    description: "Tía Felisa — despedida de exámenes.",
    startsAtIso: "2026-09-04T21:30:00Z", // Viernes 4 sep, 23:30 Europe/Madrid
    imageUrl: MEDIA_BASE + "1786355431174-kvqzg7.avif", // id120
    isFeatured: false,
    salesMode: "native",
    ticketType: { name: "General", priceCents: 111 },
  },
  {
    venueSlug: "tia-felisa",
    name: "Tía Felisa Se Gradúa",
    slug: "tia-felisa-se-gradua",
    description: "Tía Felisa se gradúa.",
    startsAtIso: "2026-09-05T20:30:00Z", // Sábado 5 sep, 22:30 Europe/Madrid
    imageUrl: MEDIA_BASE + "1786355431555-1b1ymp.avif", // id122
    isFeatured: false,
    salesMode: "external_redirect",
  },
  {
    venueSlug: "tia-felisa",
    name: "Tía Felisa Graduates",
    slug: "tia-felisa-graduates",
    description: "Exams are done!",
    startsAtIso: "2026-09-10T21:30:00Z", // Jueves 10 sep, 23:30 Europe/Madrid
    imageUrl: MEDIA_BASE + "1786355430981-jo0t3c.avif", // id119
    isFeatured: true,
    salesMode: "native",
    ticketType: { name: "General", priceCents: 111 },
  },

  // ── LIMONCELLO (venue real id=4, slug="limoncello") ─────────────────────────
  {
    venueSlug: "limoncello",
    name: "El Eclipse x Confes1on",
    slug: "limoncello-eclipse-x-confesion",
    description: "CONFESION DJs + DJ invitado. Dos escenarios: Boat Party (plazas limitadas) y Beach Club. Gafas para ver el eclipse. +6 horas de fiesta. Transporte + consumición desde 10€. +18, reservado el derecho de admisión.",
    startsAtIso: "2026-08-29T16:00:00Z", // Sábado 29 ago, 18:00 Europe/Madrid
    imageUrl: MEDIA_BASE + "1786355479491-wab63e.avif", // id124
    isFeatured: true,
    salesMode: "external_redirect",
  },
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

// Nota: el adaptador de storage local sirve los .avif subidos desde el
// admin (Multimedia) con Content-Type "application/octet-stream" en vez de
// "image/avif" (confirmado con curl -I contra producción — comportamiento
// preexistente del middleware estático, no introducido por este script).
// Se acepta ese caso concreto para extensiones de imagen conocidas, sin
// dejar de exigir HTTP 200 + bytes reales — sigue detectando enlaces rotos.
const KNOWN_IMAGE_EXTENSIONS = [".avif", ".jpg", ".jpeg", ".png", ".webp", ".gif"];

async function verifyAssetHttp200(url: string): Promise<{ ok: boolean; contentType: string | null }> {
  const res = await fetch(url, { method: "GET" });
  const contentType = res.headers.get("content-type");
  const contentLength = Number(res.headers.get("content-length") ?? "0");
  const looksLikeImage = !!contentType?.startsWith("image/")
    || (contentType === "application/octet-stream" && KNOWN_IMAGE_EXTENSIONS.some(ext => url.toLowerCase().endsWith(ext)));
  return { ok: res.ok && looksLikeImage && contentLength > 0, contentType };
}

interface ManifestEntry {
  eventId: number;
  slug: string;
  name: string;
  venueSlug: string;
  qaFixture: true;
  qaSource: string;
  createdAt: string;
}

function manifestPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "qa-events-manifest.json");
}

function readManifest(): ManifestEntry[] {
  const p = manifestPath();
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeManifest(entries: ManifestEntry[]) {
  fs.writeFileSync(manifestPath(), JSON.stringify(entries, null, 2) + "\n", "utf8");
}

async function main() {
  const { target, dryRun } = parseArgs(process.argv.slice(2));

  if (target !== EXPECTED_TARGET) {
    console.error(`[bootstrap-qa-events] --target debe ser exactamente "${EXPECTED_TARGET}" (atestación explícita del operador). Recibido: "${target || "(vacío)"}". Aborta.`);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("[bootstrap-qa-events] DATABASE_URL no está definida. Aborta.");
    process.exit(1);
  }

  console.log(`[bootstrap-qa-events] Objetivo declarado por el operador: ${target}`);
  console.log(`[bootstrap-qa-events] Modo: ${dryRun ? "DRY-RUN (sin escritura)" : "ESCRITURA REAL"}`);
  console.log(`[bootstrap-qa-events] Eventos a procesar: ${QA_EVENTS.length} (Casanova=${QA_EVENTS.filter(e => e.venueSlug === "casanova").length}, Tía Felisa=${QA_EVENTS.filter(e => e.venueSlug === "tia-felisa").length}, Limoncello=${QA_EVENTS.filter(e => e.venueSlug === "limoncello").length})`);
  console.log(`[bootstrap-qa-events] NOTA: falta un 5º poster de Tía Felisa (no subido aún) — ese evento queda pendiente a propósito, no se crea.`);

  // 1. Verificar HTTP 200 + Content-Type imagen de TODOS los posters antes de tocar la BD.
  console.log("\n[bootstrap-qa-events] Verificando posters reales (HTTP 200 + image/*)...");
  const urls = new Set(QA_EVENTS.map(e => e.imageUrl));
  let anyAssetFailed = false;
  for (const url of urls) {
    const { ok, contentType } = await verifyAssetHttp200(url);
    console.log(`  ${ok ? "OK " : "FAIL"} ${contentType ?? "(sin content-type)"} ${url}`);
    if (!ok) anyAssetFailed = true;
  }
  if (anyAssetFailed) {
    console.error("[bootstrap-qa-events] Al menos un poster no respondió HTTP 200 con Content-Type de imagen real. Aborta sin escribir nada.");
    process.exit(1);
  }

  const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 1 });
  const db = drizzle(pool);

  // 2. Resolver comunidades IE/UVA (reutilizadas, nunca recreadas).
  const allCommunities = await db.select().from(communitiesTable);
  const ie = allCommunities.find(c => c.slug === "ie");
  const uva = allCommunities.find(c => c.slug === "uva");
  if (!ie || !uva) {
    console.error(`[bootstrap-qa-events] No se encontraron las comunidades IE/UVA reales (encontradas: ${allCommunities.map(c => c.slug).join(", ") || "ninguna"}). Aborta.`);
    process.exit(1);
  }
  console.log(`\n[bootstrap-qa-events] Comunidades: IE=${ie.id} UVA=${uva.id}`);

  // 3. Resolver los 3 venues reales por slug — NUNCA se crean, solo se verifican.
  const venueSlugs = ["casanova", "tia-felisa", "limoncello"] as const;
  const venueBySlug = new Map<string, { id: number; name: string }>();
  for (const slug of venueSlugs) {
    const detail = await getVenueBySlug(slug, db);
    if (!detail) {
      console.error(`[bootstrap-qa-events] No se encontró el venue real con slug="${slug}". Aborta.`);
      process.exit(1);
    }
    venueBySlug.set(slug, { id: detail.venue.id, name: detail.venue.name });
    console.log(`[bootstrap-qa-events] Venue verificado: ${detail.venue.name} (id=${detail.venue.id}, slug=${slug})`);
  }

  // 4. Crear/verificar cada evento de QA — idempotente por slug.
  const results: Array<{ slug: string; status: string; id?: number }> = [];
  const manifest = readManifest();

  for (const spec of QA_EVENTS) {
    const venue = venueBySlug.get(spec.venueSlug)!;
    console.log(`\n[bootstrap-qa-events] ${spec.name} (${spec.slug}) — ${venue.name}`);

    const existing = await getEventBySlug(spec.slug, db);
    if (existing) {
      if (existing.event.venueId !== venue.id) {
        console.error(`  DETENIDO: ya existe un event con slug="${spec.slug}" pero venue_id=${existing.event.venueId} (esperado ${venue.id}). No se toca esta fila.`);
        results.push({ slug: spec.slug, status: "DETENIDO (incompatible)" });
        continue;
      }
      console.log(`  ya existe (id=${existing.event.id}) — no se duplica`);
      if (!dryRun) {
        await ensureSalesChannelAndTicketType(existing.event.id, spec, db);
      }
      results.push({ slug: spec.slug, status: "ya existía", id: existing.event.id });
      continue;
    }

    if (dryRun) {
      console.log(`  [dry-run] se crearía: venue=${venue.name}, starts_at=${spec.startsAtIso}, sales_mode=${spec.salesMode}, featured=${spec.isFeatured}`);
      results.push({ slug: spec.slug, status: "[dry-run] se crearía" });
      continue;
    }

    const created = await createEvent(
      {
        name: spec.name,
        slug: spec.slug,
        description: spec.description,
        venueId: venue.id,
        startsAt: new Date(spec.startsAtIso),
        imageUrl: spec.imageUrl,
      },
      [ie.id, uva.id],
      db
    );

    if (spec.isFeatured) {
      const { events } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(events).set({ isFeatured: true }).where(eq(events.id, created.id));
    }

    await ensureSalesChannelAndTicketType(created.id, spec, db);

    console.log(`  creado (id=${created.id})`);
    results.push({ slug: spec.slug, status: "creado", id: created.id });

    manifest.push({
      eventId: created.id,
      slug: spec.slug,
      name: spec.name,
      venueSlug: spec.venueSlug,
      qaFixture: true,
      qaSource: QA_SOURCE,
      createdAt: new Date().toISOString(),
    });
  }

  if (!dryRun) writeManifest(manifest);

  console.log("\n[bootstrap-qa-events] Resumen:");
  for (const r of results) console.log(`  ${r.slug.padEnd(45)} ${r.status}${r.id ? ` (id=${r.id})` : ""}`);

  const stopped = results.filter(r => r.status.startsWith("DETENIDO"));
  await pool.end();

  if (stopped.length > 0) {
    console.error(`\n[bootstrap-qa-events] Completado CON ${stopped.length} fila(s) detenida(s) — revisar manualmente.`);
    process.exit(1);
  }
  console.log(`\n[bootstrap-qa-events] Completado. Manifiesto: ${manifestPath()}`);
  process.exit(0);
}

/** Idempotente: no duplica un sales_channel/ticket_type ya existente para este evento. */
async function ensureSalesChannelAndTicketType(eventId: number, spec: QaEventSpec, db: unknown) {
  const existingChannels = await listSalesChannels(eventId, db as any);
  const alreadyHasChannel = existingChannels.some(c => c.salesMode === spec.salesMode);
  if (!alreadyHasChannel) {
    await createSalesChannel(
      {
        eventId,
        channelType: spec.salesMode === "native" ? "segolife_native" : "fourvenues",
        salesMode: spec.salesMode,
        externalUrl: null, // Nunca se inventa una URL — ver cabecera del archivo.
        status: "active",
        isPrimary: true,
        sortOrder: 0,
        metadata: { qaFixture: true, qaSource: QA_SOURCE },
      },
      db as any
    );
    console.log(`  [sales_channel] creado (${spec.salesMode})`);
  } else {
    console.log(`  [sales_channel] ya existía (${spec.salesMode})`);
  }

  if (spec.salesMode === "native" && spec.ticketType) {
    const existingTypes = await listTicketTypes(eventId, db as any);
    if (!existingTypes.length) {
      await createTicketType(
        {
          eventId,
          name: spec.ticketType.name,
          priceCents: spec.ticketType.priceCents,
          currency: "EUR",
          status: "active",
          metadata: { qaFixture: true, qaSource: QA_SOURCE },
        },
        db as any
      );
      console.log(`  [ticket_type] creado (${spec.ticketType.name}, ${(spec.ticketType.priceCents / 100).toFixed(2)}€)`);
    } else {
      console.log(`  [ticket_type] ya existía`);
    }
  }
}

main().catch(err => {
  console.error("[bootstrap-qa-events] Error:", err.message);
  process.exit(1);
});
