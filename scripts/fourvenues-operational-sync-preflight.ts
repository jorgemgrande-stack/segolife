/**
 * fourvenues-operational-sync-preflight.ts — auditoría de solo lectura
 * contra producción, previa a activar el sync real de Fourvenues (spec
 * §81). NO escribe nada. NO imprime PII (emails/teléfonos/nombres reales) —
 * solo counts y booleanos.
 *
 * Ejecutar en la Console del servicio "segolife" en Railway:
 *   npx tsx scripts/fourvenues-operational-sync-preflight.ts
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { sql } from "drizzle-orm";
import {
  venueIntegrations, integrationProviders, venues,
  events, eventTickets, ticketOrders, eventAttendance,
  externalEntityMappings, externalIdentityMappings, unresolvedOperations,
  users,
} from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const host = dbUrl.match(/@([^/:]+)/)?.[1] ?? "desconocido";
  console.log(`DB host (solo hostname, sin credenciales): ${host}`);

  const pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
  const db = drizzle(pool);

  console.log("\n--- Kill switch global ---");
  console.log(`EXTERNAL_INTEGRATIONS_ENABLED = ${process.env.EXTERNAL_INTEGRATIONS_ENABLED ?? "(sin definir → false)"}`);

  console.log("\n--- Constraint UNIQUE users.email (real, aplicada en BD) ---");
  const [uniqueCheck] = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'users' AND non_unique = 0 AND column_name = 'email'
  `);
  const uniqueRows = uniqueCheck as unknown as Array<{ cnt: number }>;
  console.log(`Índices UNIQUE sobre users.email encontrados: ${uniqueRows[0]?.cnt ?? 0} (>0 = confirmado real)`);

  const [dupCheck] = await db.execute(sql`
    SELECT COUNT(*) as dupEmails FROM (
      SELECT email FROM users WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1
    ) t
  `);
  const dupRows = dupCheck as unknown as Array<{ dupEmails: number }>;
  console.log(`Emails duplicados existentes en users: ${dupRows[0]?.dupEmails ?? 0} (debe ser 0)`);

  console.log("\n--- Venue integrations Fourvenues ---");
  const providers = await db.select().from(integrationProviders).where(eq(integrationProviders.key, "fourvenues_integrations"));
  console.log(`Provider fourvenues_integrations en integration_providers: ${providers.length > 0 ? "existe" : "NO EXISTE"}`);
  const vis = await db.select().from(venueIntegrations);
  console.log(`Total venue_integrations (cualquier provider): ${vis.length}`);
  for (const vi of vis) {
    const [v] = await db.select({ name: venues.name }).from(venues).where(eq(venues.id, vi.venueId)).limit(1);
    console.log(`  #${vi.id} venue="${v?.name ?? "?"}" provider_id=${vi.providerId} env=${vi.environment} enabled=${vi.enabled} syncEnabled=${vi.syncEnabled} credentialsConfigured=${!!vi.credentialsEncrypted} status=${vi.status}`);
  }

  console.log("\n--- Datos Fourvenues ya existentes en Segolife (deberían ser 0 antes del primer sync) ---");
  const [mappingCount] = await db.select({ n: sql<number>`COUNT(*)` }).from(externalEntityMappings).where(eq(externalEntityMappings.provider, "fourvenues_integrations"));
  const [identityCount] = await db.select({ n: sql<number>`COUNT(*)` }).from(externalIdentityMappings).where(eq(externalIdentityMappings.provider, "fourvenues_integrations"));
  const [ordersCount] = await db.select({ n: sql<number>`COUNT(*)` }).from(ticketOrders).where(eq(ticketOrders.provider, "fourvenues_integrations"));
  const [ticketsCount] = await db.select({ n: sql<number>`COUNT(*)` }).from(eventTickets).where(eq(eventTickets.provider, "fourvenues_integrations"));
  const [attendanceCount] = await db.select({ n: sql<number>`COUNT(*)` }).from(eventAttendance).where(eq(eventAttendance.provider, "fourvenues_integrations"));
  const [unresolvedCount] = await db.select({ n: sql<number>`COUNT(*)` }).from(unresolvedOperations).where(eq(unresolvedOperations.provider, "fourvenues_integrations"));
  console.log(`external_entity_mappings (provider=fourvenues_integrations): ${mappingCount.n}`);
  console.log(`external_identity_mappings: ${identityCount.n}`);
  console.log(`ticket_orders: ${ordersCount.n}`);
  console.log(`event_tickets: ${ticketsCount.n}`);
  console.log(`event_attendance: ${attendanceCount.n}`);
  console.log(`unresolved_operations: ${unresolvedCount.n}`);

  console.log("\n--- Volumen general (contexto, no específico de Fourvenues) ---");
  const [totalEvents] = await db.select({ n: sql<number>`COUNT(*)` }).from(events);
  const [totalUsers] = await db.select({ n: sql<number>`COUNT(*)` }).from(users);
  console.log(`Total events: ${totalEvents.n}`);
  console.log(`Total users: ${totalUsers.n}`);

  console.log("\n--- token_rules con origin='ticket' (compra) activas ---");
  const [ticketRules] = await db.execute(sql`SELECT COUNT(*) as cnt FROM token_rules WHERE origin = 'ticket' AND active = 1`);
  const ticketRuleRows = ticketRules as unknown as Array<{ cnt: number }>;
  console.log(`Reglas activas origin=ticket: ${ticketRuleRows[0]?.cnt ?? 0} (0 esperado — confirma "sin regla, 0 tokens")`);

  await pool.end();
  console.log("\nPreflight completo.");
}

main().catch(err => { console.error("Preflight falló:", err instanceof Error ? err.message : err); process.exit(1); });
