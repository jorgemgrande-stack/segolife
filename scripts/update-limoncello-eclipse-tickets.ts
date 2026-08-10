/**
 * scripts/update-limoncello-eclipse-tickets.ts — CLI explícito y one-shot
 * para completar la ficha de "El Eclipse x Confes1on" (Limoncello) con los
 * datos REALES de su página histórica de Fourvenues, que el usuario mostró
 * directamente por captura de pantalla:
 *   https://site.fourvenues.com/es/limoncelo-playa/events/el-eclipse-x-confes1on-12-08-2026-ZUX5
 *
 * Hace dos cosas, ambas idempotentes:
 *  1. Actualiza el canal external_redirect existente con esa URL real ahora
 *     confirmada (antes null, a propósito, por no tener fuente confirmada).
 *  2. Crea un canal native (primario) + las 3 entradas reales visibles en la
 *     página de Fourvenues, para poder ver la UI de selección de entradas
 *     completa en Segolife. PaymentProvider sigue sin configurar — esto NO
 *     habilita cobros reales, sigue siendo contenido de QA (metadata.qaFixture).
 *
 * Uso:
 *   DATABASE_URL=... pnpm tsx scripts/update-limoncello-eclipse-tickets.ts -- --target=MySQL-zWz9 [--dry-run]
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { getEventBySlug } from "../server/db/eventsDb";
import { listSalesChannels, updateSalesChannel, createSalesChannel, listTicketTypes, createTicketType } from "../server/segolife/ticketing/ticketingDb";

const EXPECTED_TARGET = "MySQL-zWz9";
const EVENT_SLUG = "limoncello-eclipse-x-confesion";
const REAL_FOURVENUES_URL = "https://site.fourvenues.com/es/limoncelo-playa/events/el-eclipse-x-confes1on-12-08-2026-ZUX5";
const QA_SOURCE = "historical_event_replay_2026";

const REAL_TICKET_TYPES = [
  { name: "Anticipada - Sin transporte", description: "1 consumición hasta las 20:00", priceCents: 1200 },
  { name: "Anticipada - Transporte 17:30", description: "Transporte 17:30 y consumición", priceCents: 1800 },
  { name: "Anticipada - Transporte 18:30", description: "Transporte 18:30 + consumición", priceCents: 1800 },
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

async function main() {
  const { target, dryRun } = parseArgs(process.argv.slice(2));
  if (target !== EXPECTED_TARGET) {
    console.error(`[update-limoncello] --target debe ser exactamente "${EXPECTED_TARGET}". Recibido: "${target || "(vacío)"}". Aborta.`);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("[update-limoncello] DATABASE_URL no está definida. Aborta.");
    process.exit(1);
  }
  console.log(`[update-limoncello] Modo: ${dryRun ? "DRY-RUN" : "ESCRITURA REAL"}`);

  const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 1 });
  const db = drizzle(pool);

  const detail = await getEventBySlug(EVENT_SLUG, db);
  if (!detail) {
    console.error(`[update-limoncello] No se encontró el evento slug="${EVENT_SLUG}". Aborta.`);
    process.exit(1);
  }
  console.log(`[update-limoncello] Evento: ${detail.event.name} (id=${detail.event.id})`);

  const channels = await listSalesChannels(detail.event.id, db as any);
  const externalChannel = channels.find(c => c.salesMode === "external_redirect");
  const nativeChannel = channels.find(c => c.salesMode === "native");

  if (externalChannel) {
    if (externalChannel.externalUrl === REAL_FOURVENUES_URL && !externalChannel.isPrimary) {
      console.log("  [external_redirect] ya tiene la URL real y no es primario — no se toca");
    } else if (!dryRun) {
      await updateSalesChannel(externalChannel.id, { externalUrl: REAL_FOURVENUES_URL, isPrimary: false, sortOrder: 1 }, db as any);
      console.log("  [external_redirect] URL real confirmada aplicada, isPrimary=false, sortOrder=1");
    } else {
      console.log("  [dry-run] [external_redirect] se actualizaría con URL real, isPrimary=false, sortOrder=1");
    }
  } else {
    console.log("  [external_redirect] no existe — no se crea (fuera de alcance de este script)");
  }

  if (nativeChannel) {
    console.log(`  [native] ya existe (id=${nativeChannel.id}) — no se duplica`);
  } else if (!dryRun) {
    const created = await createSalesChannel(
      {
        eventId: detail.event.id,
        channelType: "segolife_native",
        salesMode: "native",
        externalUrl: null,
        status: "active",
        isPrimary: true,
        sortOrder: 0,
        metadata: { qaFixture: true, qaSource: QA_SOURCE, realPricesFrom: "fourvenues" },
      },
      db as any
    );
    console.log(`  [native] creado (id=${created.id}, isPrimary=true, sortOrder=0)`);
  } else {
    console.log("  [dry-run] [native] se crearía como canal primario");
  }

  const existingTypes = await listTicketTypes(detail.event.id, db as any);
  if (existingTypes.length > 0) {
    console.log(`  [ticket_types] ya existen ${existingTypes.length} — no se duplican`);
  } else if (!dryRun) {
    for (const tt of REAL_TICKET_TYPES) {
      const created = await createTicketType(
        {
          eventId: detail.event.id,
          name: tt.name,
          description: tt.description,
          priceCents: tt.priceCents,
          currency: "EUR",
          status: "active",
          metadata: { qaFixture: true, qaSource: QA_SOURCE, realPricesFrom: "fourvenues" },
        },
        db as any
      );
      console.log(`  [ticket_type] creado: ${tt.name} — ${(tt.priceCents / 100).toFixed(2)}€ (id=${created.id})`);
    }
  } else {
    for (const tt of REAL_TICKET_TYPES) {
      console.log(`  [dry-run] [ticket_type] se crearía: ${tt.name} — ${(tt.priceCents / 100).toFixed(2)}€`);
    }
  }

  await pool.end();
  console.log("\n[update-limoncello] Completado.");
  process.exit(0);
}

main().catch(err => {
  console.error("[update-limoncello] Error:", err.message);
  process.exit(1);
});
