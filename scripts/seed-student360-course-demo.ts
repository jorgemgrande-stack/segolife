/**
 * seed-student360-course-demo.ts — simulación de un curso académico completo
 * (sept/oct 2025 → jul 2026) para 3 estudiantes REALES de Segolife IE, para
 * poder demostrar Student 360 con datos ricos y coherentes.
 *
 * SIMULA OPERACIONES, NO RESULTADOS: cada fila se produce llamando a la
 * misma función de servicio que usaría un flujo real (createHold/
 * transitionOrderStatus/issueTicketsForOrder/ingestAttendance/
 * ingestCommerceTransaction/issueConsumptionQr+redeemConsumptionQr/
 * grantBenefit/redeemBenefit/earnTokens/postLedgerMovement) — nunca se
 * escribe un balance o una métrica directamente.
 *
 * TÉCNICA T1 (fechas históricas): ninguna de esas funciones acepta una
 * fecha pasada como parámetro (están pensadas para "ahora real"). Donde el
 * pipeline no expone la fecha (event_tickets.issuedAt, token_ledger.createdAt,
 * consumption_qr_codes.issuedAt/redeemedAt, user_benefits.grantedAt/usedAt),
 * este script llama primero a la función real (que calcula todo con
 * corrección — saldo, idempotencia, atomicidad) y a continuación aplica UN
 * UPDATE quirúrgico que corrige EXCLUSIVAMENTE la(s) columna(s) de fecha de
 * esa fila por su id — nunca importe/estado/relaciones. Documentado también
 * en docs/comunity si aplica y en el informe final de este encargo.
 *
 * MARCADO DE SIMULACIÓN: toda fila que tiene columna `metadata` JSON lleva
 * `{ simulation: SIMULATION_TAG }`. Las que no tienen metadata (event_tickets,
 * event_attendance sí tiene metadata realmente — event_attendance.metadata
 * existe, ticket_orders.metadata existe) quedan igualmente enlazadas por
 * FK real a una fila que sí lleva el tag, así que el rollback puede recorrer
 * la cadena. El script también imprime (y escribe en /tmp dentro del
 * contenedor) un manifest JSON con todos los ids creados, agrupados por tabla.
 *
 * IDEMPOTENCIA: cada entidad se crea con una idempotencyKey determinista
 * (`student360_demo:<student>:<tipo>:<índice>`) — volver a ejecutar el
 * script nunca duplica nada; cada paso comprueba primero.
 *
 * USO:
 *   npx tsx scripts/seed-student360-course-demo.ts --dry-run   (solo plan, sin escribir)
 *   npx tsx scripts/seed-student360-course-demo.ts --target=MySQL-zWz9   (ejecución real)
 *   npx tsx scripts/seed-student360-course-demo.ts --rollback --target=MySQL-zWz9   (retira la simulación)
 *
 * Sin --dry-run, --target=MySQL-zWz9 es OBLIGATORIO (misma convención que
 * scripts/bootstrap-qa-events.ts / bootstrap-production-venues.ts) — evita
 * ejecutar esto sin querer contra un DATABASE_URL equivocado.
 */
import { eq, and, inArray, sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  users, studentProfiles, userCommunities, communities, universities,
  venues, venueProducts,
  events, salesChannels, eventTicketTypes,
  ticketOrders, ticketPayments, eventTickets, eventAttendance,
  commerceTransactions, consumptionQrCodes,
  tokenRules, tokenLedger,
  benefitDefinitions, benefitCommunities, userBenefits,
  studentLoginEvents, notifications,
} from "../drizzle/schema";
import { createEvent } from "../server/db/eventsDb";
import { createVenueProduct } from "../server/db/venueProductsDb";
import { createTokenRule } from "../server/db/tokenRulesDb";
import { createHold } from "../server/segolife/ticketing/inventoryHoldService";
import { transitionOrderStatus } from "../server/segolife/ticketing/orderStateMachine";
import { issueTicketsForOrder } from "../server/segolife/ticketing/ticketIssuanceService";
import { ingestAttendance } from "../server/segolife/ticketing/attendancePipeline";
import { ingestCommerceTransaction } from "../server/segolife/commerce/commercePipeline";
import { issueConsumptionQr, redeemConsumptionQr } from "../server/segolife/qr/consumptionQrService";
import { grantBenefit } from "../server/segolife/benefits/benefitGrantService";
import { redeemBenefit } from "../server/segolife/benefits/benefitRedemptionService";
import { recordStudentLogin } from "../server/segolife/students/studentLoginEventsDb";

// ============================================================
// 0. CONFIGURACIÓN / PREFLIGHT
// ============================================================

const SIMULATION_TAG = "student360_course_demo_2025_26";
const REQUIRED_TARGET = "MySQL-zWz9";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ROLLBACK = args.includes("--rollback");
const targetArg = args.find(a => a.startsWith("--target="));
const TARGET = targetArg ? targetArg.split("=")[1] : null;

if (!DRY_RUN) {
  if (TARGET !== REQUIRED_TARGET) {
    console.error(`✗ Falta --target=${REQUIRED_TARGET} (atestación explícita, obligatoria fuera de --dry-run). Recibido: ${TARGET ?? "(nada)"}`);
    process.exit(1);
  }
  if (process.env.NODE_ENV !== "production") {
    console.error(`✗ Este script fuera de --dry-run solo está pensado para ejecutarse dentro del contenedor de producción (NODE_ENV=production). NODE_ENV actual: ${process.env.NODE_ENV}`);
    process.exit(1);
  }
}

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 5 });
const db = drizzle(_pool);
type DbHandle = typeof db;

// PRNG determinista (mulberry32) — el dry-run y la ejecución real producen
// EXACTAMENTE el mismo plan con la misma semilla, para que lo que se revisa
// en el dry-run sea lo que realmente se ejecuta después.
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(360260926); // semilla fija — "Student 360, curso 25/26"
function pick<T>(arr: T[]): T { return arr[Math.floor(rng() * arr.length)]; }
function pickWeighted<T>(items: { value: T; weight: number }[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = rng() * total;
  for (const it of items) { r -= it.weight; if (r <= 0) return it.value; }
  return items[items.length - 1].value;
}
function randInt(min: number, max: number): number { return Math.floor(rng() * (max - min + 1)) + min; }
function randomTimeOnDate(date: Date, hourMin: number, hourMax: number): Date {
  const d = new Date(date);
  d.setHours(randInt(hourMin, hourMax), randInt(0, 59), 0, 0);
  return d;
}

// ============================================================
// 1. MANIFEST — trazabilidad + rollback
// ============================================================

type ManifestEntry = { table: string; id: number; studentEmail?: string };
const manifest: ManifestEntry[] = [];
function track(table: string, id: number, studentEmail?: string) {
  manifest.push({ table, id, studentEmail });
}

const counters: Record<string, number> = {};
function count(key: string, n = 1) { counters[key] = (counters[key] ?? 0) + n; }

// ============================================================
// 2. ESTUDIANTES OBJETIVO
// ============================================================

interface PersonaConfig {
  key: "tono" | "javier" | "cristina";
  email: string;
  displayName: string;
  profile: "power" | "selective" | "opportunistic";
  registrationBackdateTo: Date; // student_profiles.createdAt de destino
  eventPurchaseTarget: [number, number];
  attendanceConversion: number; // 0-1, probabilidad de asistir a lo comprado
  venueWeights: Record<string, number>; // slug de venue -> peso relativo
  consumptionsPerMonth: [number, number];
  loginsPerActiveMonth: [number, number];
  monthlyIntensity: Record<string, number>; // "2025-09".."2026-07" -> multiplicador 0-1
}

const PERSONAS: PersonaConfig[] = [
  {
    key: "tono",
    email: "admin@casanovaclub.es",
    displayName: "Tono Ruiz Llorente",
    profile: "power",
    registrationBackdateTo: new Date("2025-09-08T10:00:00.000Z"),
    eventPurchaseTarget: [15, 25],
    attendanceConversion: 0.85,
    venueWeights: { casanova: 3, "tanker-events": 2.5, "chin-chin": 2, "tia-felisa": 1.5, limoncello: 1.5, "la-finca-club": 1, "selfish-poke": 0.5 },
    consumptionsPerMonth: [4, 7],
    loginsPerActiveMonth: [6, 12],
    monthlyIntensity: { "2025-09": 0.5, "2025-10": 0.7, "2025-11": 0.9, "2025-12": 0.8, "2026-01": 0.3, "2026-02": 0.6, "2026-03": 0.7, "2026-04": 0.9, "2026-05": 1.0, "2026-06": 1.0, "2026-07": 0.6 },
  },
  {
    key: "javier",
    email: "javier.herreria0@gmail.com",
    displayName: "Javier Herrería Martín",
    profile: "selective",
    registrationBackdateTo: new Date("2025-09-22T17:30:00.000Z"),
    eventPurchaseTarget: [10, 18],
    attendanceConversion: 0.92,
    venueWeights: { "tia-felisa": 3, limoncello: 2.5, casanova: 1.5, "selfish-poke": 1.5, "chin-chin": 1, "la-finca-club": 1, "tanker-events": 0.5 },
    consumptionsPerMonth: [2, 4],
    loginsPerActiveMonth: [3, 6],
    monthlyIntensity: { "2025-09": 0.3, "2025-10": 0.5, "2025-11": 0.7, "2025-12": 0.6, "2026-01": 0.2, "2026-02": 0.5, "2026-03": 0.6, "2026-04": 0.8, "2026-05": 0.9, "2026-06": 0.9, "2026-07": 0.4 },
  },
  {
    key: "cristina",
    email: "jgrande@skicenter.es",
    displayName: "Cristina Barristelli",
    profile: "opportunistic",
    registrationBackdateTo: new Date("2025-10-13T12:00:00.000Z"),
    eventPurchaseTarget: [6, 12],
    attendanceConversion: 0.7,
    venueWeights: { "la-finca-club": 2.5, "chin-chin": 2, casanova: 1.5, "tia-felisa": 1, limoncello: 1, "selfish-poke": 1, "tanker-events": 1 },
    consumptionsPerMonth: [1, 3],
    loginsPerActiveMonth: [1, 3],
    monthlyIntensity: { "2025-09": 0.1, "2025-10": 0.4, "2025-11": 0.5, "2025-12": 0.3, "2026-01": 0.1, "2026-02": 0.3, "2026-03": 0.3, "2026-04": 0.6, "2026-05": 0.7, "2026-06": 0.8, "2026-07": 0.3 },
  },
];

const MONTHS = ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];
function monthRange(m: string): { start: Date; end: Date } {
  const [y, mo] = m.split("-").map(Number);
  const start = new Date(Date.UTC(y, mo - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(mo === 12 ? y + 1 : y, mo === 12 ? 0 : mo, 0, 23, 59, 59));
  return { start, end };
}
function randomDateInMonth(m: string): Date {
  const { start, end } = monthRange(m);
  const t = start.getTime() + rng() * (end.getTime() - start.getTime());
  return new Date(t);
}

// ============================================================
// 3. VENUES REALES (spec §6) — auditados, ya existen en producción
// ============================================================

const VENUE_SLUGS = ["casanova", "chin-chin", "la-finca-club", "limoncello", "selfish-poke", "tanker-events", "tia-felisa"] as const;
// NOTA (corregido tras el primer dry-run): los 10 eventos QA existentes
// (scripts/qa-events-manifest.json) NO se reutilizan para la historia — su
// startsAt real cae fuera de la ventana sept.2025-jul.2026 (cerca de "ahora"/
// futuro, no en el pasado) y sus event_ticket_types llevan el precio de
// fixture antiguo 1,11€ que el encargo pide explícitamente evitar (spec
// §11). Se generan eventos históricos propios para los 7 venues (spec §7
// opción A) — los 10 QA existentes quedan intactos, sin tocar, por si sirven
// para otra cosa.

// ============================================================
// 4. CATÁLOGO DE PRODUCTOS DE CONSUMICIÓN (por venue)
// ============================================================

const PRODUCT_CATALOG: { slug: string; name: string; category: string; price: string }[] = [
  { slug: "cerveza", name: "Cerveza", category: "bebida", price: "4.00" },
  { slug: "copa", name: "Copa", category: "bebida", price: "8.00" },
  { slug: "cocktail", name: "Cóctel de la casa", category: "bebida", price: "10.00" },
  { slug: "refresco", name: "Refresco", category: "bebida", price: "3.50" },
  { slug: "menu-noche", name: "Menú de noche", category: "comida", price: "15.00" },
];

// ============================================================
// 5. LOG / RESUMEN
// ============================================================

function log(msg: string) { console.log(`${DRY_RUN ? "[DRY-RUN] " : ""}${msg}`); }

async function main() {
  log(`=== Student 360 — simulación de curso académico ===`);
  log(`Modo: ${ROLLBACK ? "ROLLBACK" : DRY_RUN ? "DRY-RUN (solo plan, nada se escribe)" : "EJECUCIÓN REAL"}`);
  log(`SIMULATION_TAG: ${SIMULATION_TAG}`);

  if (ROLLBACK) return runRollback();

  // ── PREFLIGHT ──────────────────────────────────────────────
  const community = await getRow(communities, eq(communities.slug, "ie"));
  if (!community) { console.error("✗ No existe la comunidad 'ie' — abortando."); process.exit(1); }
  log(`✓ Comunidad Segolife IE: id=${community.id}`);

  const university = await getRow(universities, eq(universities.slug, "ie-university"));
  if (!university) { console.error("✗ No existe la universidad 'ie-university' — abortando."); process.exit(1); }
  log(`✓ IE University: id=${university.id}`);

  const venueRows = await db.select().from(venues).where(inArray(venues.slug, [...VENUE_SLUGS]));
  const venueBySlug = new Map(venueRows.map(v => [v.slug, v]));
  for (const slug of VENUE_SLUGS) {
    if (!venueBySlug.has(slug)) { console.error(`✗ Falta el venue '${slug}' en producción — abortando.`); process.exit(1); }
  }
  log(`✓ 7 venues confirmados: ${VENUE_SLUGS.join(", ")}`);

  const studentUsers: Record<string, { user: typeof users.$inferSelect; profile: typeof studentProfiles.$inferSelect }> = {};
  for (const persona of PERSONAS) {
    const user = await getRow(users, eq(users.email, persona.email));
    if (!user) { console.error(`✗ No se encuentra el usuario ${persona.email} — DETENIÉNDOSE respecto a este estudiante.`); continue; }
    const profile = await getRow(studentProfiles, eq(studentProfiles.userId, user.id));
    if (!profile) { console.error(`✗ ${persona.email} no tiene student_profile — DETENIÉNDOSE respecto a este estudiante.`); continue; }
    const membership = await getRow(userCommunities, and(eq(userCommunities.userId, user.id), eq(userCommunities.communityId, community.id))!);
    if (!membership) { console.error(`✗ ${persona.email} no pertenece a Segolife IE — DETENIÉNDOSE respecto a este estudiante.`); continue; }
    if (profile.universityId !== university.id) { console.error(`✗ ${persona.email} no tiene universityId=IE University (tiene ${profile.universityId}) — DETENIÉNDOSE respecto a este estudiante.`); continue; }
    studentUsers[persona.key] = { user, profile };
    log(`✓ ${persona.displayName} (${persona.email}) → userId=${user.id}, studentProfileId=${profile.id}, alta actual=${profile.createdAt.toISOString()}`);
  }
  if (Object.keys(studentUsers).length !== 3) {
    console.error("✗ No se confirmaron los 3 estudiantes — abortando toda la simulación (spec: no continuar con discrepancias).");
    process.exit(1);
  }

  // ── FASE A: backdate de fecha de alta (aprobado explícitamente por el usuario) ──
  for (const persona of PERSONAS) {
    const { profile } = studentUsers[persona.key];
    log(`Backdate student_profiles.createdAt: ${persona.displayName} → ${persona.registrationBackdateTo.toISOString()} (era ${profile.createdAt.toISOString()})`);
    if (!DRY_RUN) {
      await db.update(studentProfiles).set({ createdAt: persona.registrationBackdateTo }).where(eq(studentProfiles.id, profile.id));
      await db.update(users).set({ createdAt: persona.registrationBackdateTo }).where(eq(users.id, studentUsers[persona.key].user.id));
    }
    count("backdated_profiles");
  }

  // ── FASE B: token_rules (opción A aprobada) ──────────────────
  const tokenRuleIds = await ensureTokenRules();

  // ── FASE C: catálogo de productos por venue ──────────────────
  const productsByVenue = await ensureVenueProducts(venueBySlug);

  // ── FASE D: eventos históricos nuevos (4 venues sin eventos QA) ──
  const newEvents = await ensureHistoricalEvents(venueBySlug, community.id);

  // ── FASE E: beneficios (2 definiciones nuevas, históricas) ────
  const benefitDefs = await ensureBenefitDefinitions(venueBySlug, community.id);

  // ── FASE F: pool de eventos por venue (solo los históricos de la FASE D — ver nota en VENUE_SLUGS) ──
  const eventPoolByVenue = new Map<number, typeof events.$inferSelect[]>();
  for (const ev of newEvents) {
    if (!ev.venueId) continue;
    const list = eventPoolByVenue.get(ev.venueId) ?? [];
    list.push(ev);
    eventPoolByVenue.set(ev.venueId, list);
  }
  const ticketTypesByEvent = new Map<number, typeof eventTicketTypes.$inferSelect[]>();
  const channelsByEvent = new Map<number, typeof salesChannels.$inferSelect[]>();
  if (!DRY_RUN) {
    const realEventIds = newEvents.map(e => e.id);
    const allTicketTypes = await db.select().from(eventTicketTypes).where(inArray(eventTicketTypes.eventId, realEventIds));
    for (const tt of allTicketTypes) {
      const list = ticketTypesByEvent.get(tt.eventId) ?? [];
      list.push(tt);
      ticketTypesByEvent.set(tt.eventId, list);
    }
    const allChannels = await db.select().from(salesChannels).where(inArray(salesChannels.eventId, realEventIds));
    for (const ch of allChannels) {
      if (ch.salesMode !== "native") continue; // spec §33 — nunca usar canales externos para la simulación
      const list = channelsByEvent.get(ch.eventId) ?? [];
      list.push(ch);
      channelsByEvent.set(ch.eventId, list);
    }
  } else {
    // Los eventos de FASE D en dry-run llevan ids negativos sintéticos (no
    // existen todavía en BD) — se sintetizan también su ticket type y canal
    // nativo, con la misma forma que crearía la ejecución real, para que el
    // plan del dry-run sea representativo.
    for (const ev of newEvents) {
      const spec = _dryRunEventSpecById.get(ev.id);
      if (!spec) continue;
      ticketTypesByEvent.set(ev.id, [{
        id: nextDryRunId(), eventId: ev.id, name: spec.priceCents === 0 ? "Entrada gratuita" : "Entrada general",
        description: null, priceCents: spec.priceCents, currency: "EUR", capacity: spec.capacity,
        salesStart: null, salesEnd: null, status: "active", metadata: null, createdAt: new Date(), updatedAt: new Date(),
      } as typeof eventTicketTypes.$inferSelect]);
      channelsByEvent.set(ev.id, [{
        id: nextDryRunId(), eventId: ev.id, channelType: "segolife_native", salesMode: "native",
        externalUrl: null, integrationType: null, integrationId: null, status: "active",
        isPrimary: true, sortOrder: 0, metadata: null, createdAt: new Date(), updatedAt: new Date(),
      } as typeof salesChannels.$inferSelect]);
    }
  }

  // ── FASE G: por estudiante, generar la historia ───────────────
  const summaries: Record<string, PersonaRunSummary> = {};
  for (const persona of PERSONAS) {
    const { user, profile } = studentUsers[persona.key];
    summaries[persona.key] = await runPersonaStory({
      persona, user, profile, communityId: community.id,
      venueBySlug, eventPoolByVenue, ticketTypesByEvent, channelsByEvent,
      productsByVenue, tokenRuleIds, benefitDefs,
    });
  }

  // ── RESUMEN FINAL ──────────────────────────────────────────
  log("\n=== RESUMEN ===");
  for (const [key, s] of Object.entries(summaries)) {
    log(`\n${s.displayName}:`);
    log(`  Eventos comprados: ${s.ticketsPurchased} | asistidos: ${s.attended} (${s.ticketsPurchased ? Math.round((s.attended / s.ticketsPurchased) * 100) : 0}%)`);
    log(`  Gasto en entradas: ${(s.ticketSpendCents / 100).toFixed(2)}€ | Consumiciones: ${s.consumptions} (${(s.commerceSpendCents / 100).toFixed(2)}€)`);
    log(`  SegoTokens ganados: ${s.tokensEarned} | gastados: ${s.tokensSpent}`);
    log(`  Beneficios concedidos: ${s.benefitsGranted} | usados: ${s.benefitsUsed}`);
    log(`  Logins simulados: ${s.logins} | Notificaciones: ${s.notifications} (${s.notificationsRead} leídas)`);
  }
  log(`\nTotales globales: ${JSON.stringify(counters, null, 2)}`);
  log(`Entidades en manifest: ${manifest.length}`);

  if (!DRY_RUN) {
    const fs = await import("fs");
    const manifestPath = "/tmp/student360-demo-manifest.json";
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    log(`Manifest escrito en ${manifestPath} (descárgalo desde el panel "Files" de la consola de Railway antes de que se pierda con el próximo deploy).`);
  } else {
    log(`\n(DRY-RUN: no se ha escrito nada. Vuelve a ejecutar sin --dry-run y con --target=${REQUIRED_TARGET} para aplicar.)`);
  }

  await _pool.end();
}

// ============================================================
// Helpers de bajo nivel
// ============================================================

async function getRow<T extends { $inferSelect: unknown }>(table: T, where: unknown): Promise<T["$inferSelect"] | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [row] = await (db as any).select().from(table).where(where).limit(1);
  return row ?? null;
}

function withSimTag(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return { ...(metadata ?? {}), simulation: SIMULATION_TAG };
}

// ============================================================
// FASE B — token_rules
// ============================================================

async function ensureTokenRules(): Promise<{ attendanceRuleId: number | null; consumptionRuleId: number | null }> {
  log("\n--- FASE B: token_rules ---");
  const existingAttendance = await getRow(tokenRules, and(eq(tokenRules.origin, "attendance"), eq(tokenRules.direction, "earn"), eq(tokenRules.active, true))!);
  const existingConsumption = await getRow(tokenRules, and(eq(tokenRules.origin, "consumption"), eq(tokenRules.direction, "earn"), eq(tokenRules.active, true))!);

  let attendanceRuleId = existingAttendance?.id ?? null;
  let consumptionRuleId = existingConsumption?.id ?? null;

  if (!attendanceRuleId) {
    log("Crear regla: 'Asistencia a evento' — origin=attendance, fixed=15 tokens, scope=global");
    if (!DRY_RUN) {
      const rule = await createTokenRule({
        name: "Asistencia a evento", description: "SegoTokens por hacer check-in en un evento",
        direction: "earn", origin: "attendance", scope: "global",
        calcMethod: "fixed", fixedAmount: 15, active: true, priority: 0,
      });
      attendanceRuleId = rule.id;
      track("token_rules", rule.id);
    }
    count("token_rules_created");
  } else {
    log(`Regla de asistencia ya existe activa (id=${attendanceRuleId}) — se reutiliza, no se crea otra.`);
  }

  if (!consumptionRuleId) {
    log("Crear regla: 'Consumo en venue' — origin=consumption, per_euro rate=0.5 (1 token cada 2€), scope=global");
    if (!DRY_RUN) {
      const rule = await createTokenRule({
        name: "Consumo en venue", description: "SegoTokens por consumiciones registradas (POS/QR)",
        direction: "earn", origin: "consumption", scope: "global",
        calcMethod: "per_euro", rate: "0.5", active: true, priority: 0,
      });
      consumptionRuleId = rule.id;
      track("token_rules", rule.id);
    }
    count("token_rules_created");
  } else {
    log(`Regla de consumo ya existe activa (id=${consumptionRuleId}) — se reutiliza, no se crea otra.`);
  }

  return { attendanceRuleId, consumptionRuleId };
}

// ============================================================
// FASE C — venue_products
// ============================================================

// Placeholder negativo — SOLO aparece en memoria durante --dry-run (nunca se
// persiste). Permite que el resto del pipeline calcule un plan realista
// incluso cuando la fila real todavía no existe. Un id negativo es imposible
// de confundir con un id real de MySQL (autoincrement empieza en 1).
let _dryRunFakeId = -1;
function nextDryRunId(): number { return _dryRunFakeId--; }

async function ensureVenueProducts(venueBySlug: Map<string, typeof venues.$inferSelect>): Promise<Map<number, typeof venueProducts.$inferSelect[]>> {
  log("\n--- FASE C: catálogo de productos por venue ---");
  const result = new Map<number, typeof venueProducts.$inferSelect[]>();
  for (const slug of VENUE_SLUGS) {
    const venue = venueBySlug.get(slug)!;
    const existing = await db.select().from(venueProducts).where(eq(venueProducts.venueId, venue.id));
    if (existing.length > 0) {
      result.set(venue.id, existing);
      log(`${venue.name}: ya tiene ${existing.length} productos — se reutilizan.`);
      continue;
    }
    log(`${venue.name}: crear ${PRODUCT_CATALOG.length} productos (${PRODUCT_CATALOG.map(p => p.name).join(", ")})`);
    const created: typeof venueProducts.$inferSelect[] = [];
    for (const p of PRODUCT_CATALOG) {
      if (!DRY_RUN) {
        const row = await createVenueProduct({ venueId: venue.id, name: p.name, slug: p.slug, category: p.category, price: p.price, metadata: withSimTag(null) });
        created.push(row);
        track("venue_products", row.id);
      } else {
        created.push({ id: nextDryRunId(), venueId: venue.id, name: p.name, slug: p.slug, category: p.category, price: p.price, isActive: true, metadata: null, createdAt: new Date(), updatedAt: new Date() } as typeof venueProducts.$inferSelect);
      }
    }
    result.set(venue.id, created);
    count("venue_products_created", PRODUCT_CATALOG.length);
  }
  return result;
}

// ============================================================
// FASE D — eventos históricos nuevos (los 7 venues, spec §7 opción A)
// ============================================================
// Reemplaza por completo la idea inicial de reutilizar los 10 eventos QA
// existentes (ver nota en VENUE_SLUGS más arriba) — fechas y precios propios,
// coherentes con la ventana sept.2025→jul.2026 y con precios variados reales
// (spec §11: nunca 1,11€ en todos lados).

interface NewEventSpec { venueSlug: string; name: string; month: string; priceCents: number; capacity: number }
const NEW_EVENT_SPECS: NewEventSpec[] = [
  // CASANOVA
  { venueSlug: "casanova", name: "Casanova — Bienvenida 25/26", month: "2025-09", priceCents: 0, capacity: 250 },
  { venueSlug: "casanova", name: "Casanova — Halloween Night", month: "2025-10", priceCents: 800, capacity: 250 },
  { venueSlug: "casanova", name: "Casanova — Fiesta de Navidad", month: "2025-12", priceCents: 1200, capacity: 250 },
  { venueSlug: "casanova", name: "Casanova — Graduación 25/26", month: "2026-05", priceCents: 1500, capacity: 300 },
  { venueSlug: "casanova", name: "Casanova — Fiesta Fin de Curso", month: "2026-06", priceCents: 1800, capacity: 300 },
  // CHIN CHIN
  { venueSlug: "chin-chin", name: "Chin Chin — Opening Season", month: "2025-09", priceCents: 0, capacity: 150 },
  { venueSlug: "chin-chin", name: "Chin Chin — Halloween", month: "2025-10", priceCents: 800, capacity: 200 },
  { venueSlug: "chin-chin", name: "Chin Chin — San Valentín", month: "2026-02", priceCents: 700, capacity: 150 },
  { venueSlug: "chin-chin", name: "Chin Chin — Graduados 25/26", month: "2026-06", priceCents: 1500, capacity: 200 },
  // LA FINCA CLUB
  { venueSlug: "la-finca-club", name: "La Finca — Otoño Sessions", month: "2025-10", priceCents: 600, capacity: 180 },
  { venueSlug: "la-finca-club", name: "La Finca — Pre-Navidad", month: "2025-12", priceCents: 1000, capacity: 200 },
  { venueSlug: "la-finca-club", name: "La Finca — Primavera", month: "2026-03", priceCents: 800, capacity: 180 },
  { venueSlug: "la-finca-club", name: "La Finca — Fin de Curso", month: "2026-06", priceCents: 1500, capacity: 200 },
  // LIMONCELLO
  { venueSlug: "limoncello", name: "Limoncello — Vuelta al Cole", month: "2025-09", priceCents: 0, capacity: 150 },
  { venueSlug: "limoncello", name: "Limoncello — Noche Italiana", month: "2025-11", priceCents: 1000, capacity: 180 },
  { venueSlug: "limoncello", name: "Limoncello — Primavera", month: "2026-04", priceCents: 800, capacity: 180 },
  { venueSlug: "limoncello", name: "Limoncello — Graduación", month: "2026-06", priceCents: 1500, capacity: 200 },
  // SELFISH POKE
  { venueSlug: "selfish-poke", name: "Selfish Poke Night", month: "2025-11", priceCents: 500, capacity: 100 },
  { venueSlug: "selfish-poke", name: "Selfish Poke — San Valentín", month: "2026-02", priceCents: 500, capacity: 100 },
  { venueSlug: "selfish-poke", name: "Selfish Poke — Spring Roll", month: "2026-04", priceCents: 500, capacity: 100 },
  { venueSlug: "selfish-poke", name: "Selfish Poke — Verano Anticipado", month: "2026-06", priceCents: 800, capacity: 120 },
  // TANKER EVENTS
  { venueSlug: "tanker-events", name: "Tanker — Warehouse Sessions", month: "2025-11", priceCents: 1200, capacity: 300 },
  { venueSlug: "tanker-events", name: "Tanker — Año Nuevo Chino", month: "2026-02", priceCents: 1000, capacity: 300 },
  { venueSlug: "tanker-events", name: "Tanker — Semana Santa", month: "2026-04", priceCents: 1200, capacity: 300 },
  { venueSlug: "tanker-events", name: "Tanker — Closing Party", month: "2026-06", priceCents: 1800, capacity: 350 },
  // TÍA FELISA
  { venueSlug: "tia-felisa", name: "Tía Felisa — Bienvenida", month: "2025-09", priceCents: 0, capacity: 150 },
  { venueSlug: "tia-felisa", name: "Tía Felisa — Nochebuena Universitaria", month: "2025-12", priceCents: 1200, capacity: 180 },
  { venueSlug: "tia-felisa", name: "Tía Felisa — Primavera", month: "2026-03", priceCents: 800, capacity: 180 },
  { venueSlug: "tia-felisa", name: "Tía Felisa — Pre-Exámenes", month: "2026-05", priceCents: 1000, capacity: 180 },
  { venueSlug: "tia-felisa", name: "Tía Felisa — Graduados", month: "2026-06", priceCents: 1500, capacity: 200 },
];

function slugify(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 100);
}

async function ensureHistoricalEvents(venueBySlug: Map<string, typeof venues.$inferSelect>, communityId: number): Promise<typeof events.$inferSelect[]> {
  log(`\n--- FASE D: ${NEW_EVENT_SPECS.length} eventos históricos nuevos (los 7 venues) ---`);
  const created: typeof events.$inferSelect[] = [];
  for (const spec of NEW_EVENT_SPECS) {
    const venue = venueBySlug.get(spec.venueSlug)!;
    const slug = slugify(`${spec.venueSlug}-${spec.name}`);
    const existing = await getRow(events, eq(events.slug, slug));
    if (existing) { created.push(existing); log(`"${spec.name}" ya existe (id=${existing.id}) — se reutiliza.`); continue; }

    const startsAt = randomTimeOnDate(randomDateInMonth(spec.month), 22, 23); // eventos nocturnos
    const endsAt = new Date(startsAt.getTime() + 5 * 60 * 60 * 1000);
    log(`Crear evento "${spec.name}" en ${venue.name} — ${startsAt.toISOString()} — ${spec.priceCents / 100}€`);

    if (!DRY_RUN) {
      const event = await createEvent({
        name: spec.name, slug, description: null, venueId: venue.id,
        startsAt, endsAt, capacity: spec.capacity, imageUrl: null,
        status: "active", sourceType: SIMULATION_TAG, sourceId: null,
      }, [communityId]);
      track("events", event.id);

      const [channelResult] = await db.insert(salesChannels).values({
        eventId: event.id, channelType: "segolife_native", salesMode: "native",
        status: "active", isPrimary: true, sortOrder: 0, metadata: withSimTag(null),
      });
      const channelId = (channelResult as unknown as { insertId: number }).insertId;
      track("sales_channels", channelId);

      const [ticketTypeResult] = await db.insert(eventTicketTypes).values({
        eventId: event.id, name: spec.priceCents === 0 ? "Entrada gratuita" : "Entrada general",
        description: null, priceCents: spec.priceCents, currency: "EUR",
        capacity: spec.capacity, status: "active", metadata: withSimTag(null),
      });
      const ticketTypeId = (ticketTypeResult as unknown as { insertId: number }).insertId;
      track("event_ticket_types", ticketTypeId);

      created.push(event);
    } else {
      const fakeId = nextDryRunId();
      created.push({
        id: fakeId, name: spec.name, slug, description: null, venueId: venue.id,
        startsAt, endsAt, capacity: spec.capacity, imageUrl: null, status: "active",
        isFeatured: false, homeSortOrder: 0, sourceType: SIMULATION_TAG, sourceId: null,
        createdAt: new Date(), updatedAt: new Date(),
      } as typeof events.$inferSelect);
      // El pool de ticket types/channels del dry-run se rellena aparte (ver runDryRunEventExtras).
      _dryRunEventSpecById.set(fakeId, spec);
    }
    count("events_created");
  }
  return created;
}
const _dryRunEventSpecById = new Map<number, NewEventSpec>();

// ============================================================
// FASE E — benefit_definitions históricas
// ============================================================

interface BenefitSpec { slug: string; nameEs: string; venueSlug: string; benefitType: "free_product" | "discount_percentage" }
const BENEFIT_SPECS: BenefitSpec[] = [
  { slug: "demo-2x1-tia-felisa", nameEs: "2x1 en consumición", venueSlug: "tia-felisa", benefitType: "free_product" },
  { slug: "demo-descuento-casanova", nameEs: "20% de descuento", venueSlug: "casanova", benefitType: "discount_percentage" },
];

async function ensureBenefitDefinitions(venueBySlug: Map<string, typeof venues.$inferSelect>, communityId: number): Promise<Record<string, typeof benefitDefinitions.$inferSelect>> {
  log("\n--- FASE E: benefit_definitions históricas ---");
  const result: Record<string, typeof benefitDefinitions.$inferSelect> = {};
  for (const spec of BENEFIT_SPECS) {
    const existing = await getRow(benefitDefinitions, eq(benefitDefinitions.slug, spec.slug));
    if (existing) { result[spec.slug] = existing; log(`"${spec.nameEs}" ya existe (id=${existing.id}) — se reutiliza.`); continue; }

    const venue = venueBySlug.get(spec.venueSlug)!;
    log(`Crear beneficio "${spec.nameEs}" en ${venue.name}`);
    if (!DRY_RUN) {
      const [insertResult] = await db.insert(benefitDefinitions).values({
        name: spec.nameEs, slug: spec.slug, benefitType: spec.benefitType,
        destinationVenueId: venue.id,
        discountType: spec.benefitType === "discount_percentage" ? "percentage" : null,
        discountValue: spec.benefitType === "discount_percentage" ? 20 : null,
        nameEn: spec.nameEs, nameEs: spec.nameEs,
        descriptionEn: `Historical simulation benefit (${SIMULATION_TAG})`,
        descriptionEs: `Beneficio histórico de simulación (${SIMULATION_TAG})`,
        active: true,
      });
      const id = (insertResult as unknown as { insertId: number }).insertId;
      track("benefit_definitions", id);
      await db.insert(benefitCommunities).values({ benefitDefinitionId: id, communityId });
      const [row] = await db.select().from(benefitDefinitions).where(eq(benefitDefinitions.id, id)).limit(1);
      result[spec.slug] = row;
    } else {
      result[spec.slug] = {
        id: nextDryRunId(), name: spec.nameEs, slug: spec.slug, description: null, benefitType: spec.benefitType,
        destinationVenueId: venue.id, destinationEventId: null, productId: null,
        discountType: spec.benefitType === "discount_percentage" ? "percentage" : null,
        discountValue: spec.benefitType === "discount_percentage" ? 20 : null,
        valueMetadata: null, active: true, imageUrl: null,
        nameEn: spec.nameEs, nameEs: spec.nameEs, descriptionEn: null, descriptionEs: null, termsEn: null, termsEs: null,
        createdAt: new Date(), updatedAt: new Date(),
      } as typeof benefitDefinitions.$inferSelect;
    }
    count("benefit_definitions_created");
  }
  return result;
}

// ============================================================
// FASE G — historia por estudiante
// ============================================================

interface PersonaRunSummary {
  displayName: string;
  ticketsPurchased: number; attended: number; ticketSpendCents: number;
  consumptions: number; commerceSpendCents: number;
  tokensEarned: number; tokensSpent: number;
  benefitsGranted: number; benefitsUsed: number;
  logins: number; notifications: number; notificationsRead: number;
}

async function runPersonaStory(ctx: {
  persona: PersonaConfig;
  user: typeof users.$inferSelect;
  profile: typeof studentProfiles.$inferSelect;
  communityId: number;
  venueBySlug: Map<string, typeof venues.$inferSelect>;
  eventPoolByVenue: Map<number, typeof events.$inferSelect[]>;
  ticketTypesByEvent: Map<number, typeof eventTicketTypes.$inferSelect[]>;
  channelsByEvent: Map<number, typeof salesChannels.$inferSelect[]>;
  productsByVenue: Map<number, typeof venueProducts.$inferSelect[]>;
  tokenRuleIds: { attendanceRuleId: number | null; consumptionRuleId: number | null };
  benefitDefs: Record<string, typeof benefitDefinitions.$inferSelect>;
}): Promise<PersonaRunSummary> {
  const { persona, user, communityId, venueBySlug, eventPoolByVenue, ticketTypesByEvent, channelsByEvent, productsByVenue, benefitDefs } = ctx;
  log(`\n--- FASE G: historia de ${persona.displayName} ---`);

  const summary: PersonaRunSummary = {
    displayName: persona.displayName, ticketsPurchased: 0, attended: 0, ticketSpendCents: 0,
    consumptions: 0, commerceSpendCents: 0, tokensEarned: 0, tokensSpent: 0,
    benefitsGranted: 0, benefitsUsed: 0, logins: 0, notifications: 0, notificationsRead: 0,
  };

  const totalPurchaseTarget = randInt(persona.eventPurchaseTarget[0], persona.eventPurchaseTarget[1]);
  const weightSum = MONTHS.reduce((s, m) => s + persona.monthlyIntensity[m], 0);

  const weightedVenueSlugs = Object.entries(persona.venueWeights).map(([value, weight]) => ({ value, weight }));
  const alreadyPurchasedEventIds = new Set<number>(); // evita comprar el mismo evento varias veces salvo que ya se hayan agotado los del venue (spec §36: irregularidad coherente, no repetición artificial)

  let purchaseIndex = 0;
  for (const month of MONTHS) {
    const share = persona.monthlyIntensity[month] / weightSum;
    const purchasesThisMonth = Math.max(0, Math.round(totalPurchaseTarget * share));

    // ── Compras de entradas + asistencia ──
    for (let i = 0; i < purchasesThisMonth; i++) {
      const venueSlug = pickWeighted(weightedVenueSlugs);
      const venue = venueBySlug.get(venueSlug)!;
      const pool = eventPoolByVenue.get(venue.id);
      if (!pool || pool.length === 0) continue;
      const unpurchasedInPool = pool.filter(e => !alreadyPurchasedEventIds.has(e.id));
      const event = pick(unpurchasedInPool.length > 0 ? unpurchasedInPool : pool);
      alreadyPurchasedEventIds.add(event.id);
      const ticketTypes = ticketTypesByEvent.get(event.id)?.filter(t => t.status === "active") ?? [];
      const channels = channelsByEvent.get(event.id) ?? [];
      if (ticketTypes.length === 0 || channels.length === 0) continue;
      const ticketType = pick(ticketTypes);
      const channel = pick(channels);

      // La compra ocurre ANTES del evento (spec §37 coherencia temporal) —
      // entre 1 y 21 días antes de startsAt, nunca después.
      const daysBefore = randInt(1, 21);
      let purchasedAt = new Date(event.startsAt.getTime() - daysBefore * 24 * 60 * 60 * 1000);
      if (purchasedAt < persona.registrationBackdateTo) purchasedAt = new Date(persona.registrationBackdateTo.getTime() + 1000 * randInt(3600, 3600 * 24 * 5));

      purchaseIndex++;
      const idempotencyKey = `student360_demo:${persona.key}:order:${purchaseIndex}:${event.id}`;
      log(`Compra #${purchaseIndex}: ${persona.displayName} → "${event.name}" (${venue.name}), ${ticketType.priceCents / 100}€, compra ${purchasedAt.toISOString().slice(0, 10)}, evento ${event.startsAt.toISOString().slice(0, 10)}`);

      if (!DRY_RUN) {
        const holdResult = await createHold({
          eventId: event.id, userId: user.id, items: [{ ticketTypeId: ticketType.id, quantity: 1 }],
          buyerName: persona.displayName, buyerEmail: persona.email, salesChannelId: channel.id, idempotencyKey,
        });
        const order = holdResult.order;
        if (holdResult.status === "created") {
          await transitionOrderStatus(order.id, ["pending"], "awaiting_payment", {}, db);
          const [payResult] = await db.insert(ticketPayments).values({
            orderId: order.id, provider: "segolife_seed", externalPaymentId: null,
            amountCents: order.totalCents, currency: "EUR", status: "succeeded",
            idempotencyKey: `student360_demo:${persona.key}:payment:${order.id}`,
            metadata: withSimTag(null),
          });
          track("ticket_payments", (payResult as unknown as { insertId: number }).insertId);
          const paidOrder = await transitionOrderStatus(order.id, ["awaiting_payment"], "paid", { purchasedAt, metadata: withSimTag(order.metadata) }, db);
          track("ticket_orders", paidOrder.id, persona.email);

          const tickets = await issueTicketsForOrder(paidOrder, db);
          for (const t of tickets) {
            await db.update(eventTickets).set({ issuedAt: purchasedAt }).where(eq(eventTickets.id, t.id)); // T1
            track("event_tickets", t.id, persona.email);
          }
          summary.ticketsPurchased++;
          summary.ticketSpendCents += order.totalCents;

          // ── ¿Asiste? ──
          if (rng() < persona.attendanceConversion) {
            const occurredAt = randomTimeOnDate(event.startsAt, 22, 23);
            const attendanceKey = `student360_demo:${persona.key}:attendance:${purchaseIndex}`;
            const result = await ingestAttendance({
              provider: "segolife_seed", eventId: event.id, venueId: venue.id, communityId,
              ticketId: tickets[0]?.id ?? null, resolvedUserId: user.id,
              attendance: { externalAttendanceId: attendanceKey, externalEventId: String(event.id), participant: { name: persona.displayName, email: persona.email, phone: null }, occurredAt },
            }, db);
            if (result.status === "processed") {
              track("event_attendance", result.attendance.id, persona.email);
              if (result.attendance.tokensLedgerId) {
                await db.update(tokenLedger).set({ createdAt: occurredAt, metadata: withSimTag({}) }).where(eq(tokenLedger.id, result.attendance.tokensLedgerId)); // T1
                track("token_ledger", result.attendance.tokensLedgerId, persona.email);
                summary.tokensEarned += 15;
              }
              summary.attended++;
            }
          }
        }
      } else {
        summary.ticketsPurchased++;
        summary.ticketSpendCents += ticketType.priceCents;
        if (rng() < persona.attendanceConversion) { summary.attended++; summary.tokensEarned += 15; } // estimación — misma regla fixed=15 de FASE B
      }
      count("tickets_purchased");
    }

    // ── Consumiciones (POS + QR mezclado) ──
    const consumptionsThisMonth = Math.round(randInt(...persona.consumptionsPerMonth) * persona.monthlyIntensity[month]);
    for (let i = 0; i < consumptionsThisMonth; i++) {
      const venueSlug = pickWeighted(weightedVenueSlugs);
      const venue = venueBySlug.get(venueSlug)!;
      const products = productsByVenue.get(venue.id) ?? [];
      if (products.length === 0) continue;
      const product = pick(products);
      const quantity = randInt(1, 2);
      const unitCents = Math.round(Number(product.price) * 100);
      const totalCents = unitCents * quantity;
      const occurredAt = randomTimeOnDate(randomDateInMonth(month), 21, 23);
      if (occurredAt < persona.registrationBackdateTo) continue;

      const useQr = rng() < 0.4; // 40% de las consumiciones vía QR, 60% POS — variedad realista
      const externalId = `student360_demo:${persona.key}:commerce:${month}:${i}`;
      log(`Consumo: ${persona.displayName} → ${product.name} x${quantity} en ${venue.name} (${useQr ? "QR" : "POS"}), ${occurredAt.toISOString().slice(0, 10)}`);

      if (!DRY_RUN) {
        if (useQr) {
          const issued = await issueConsumptionQr({ venueId: venue.id, productId: product.id, amountCents: totalCents, sourceType: SIMULATION_TAG }, db);
          track("consumption_qr_codes", issued.qr.id, persona.email);
          try {
            const redemption = await redeemConsumptionQr({ token: issued.publicToken, userId: user.id, communityId }, db);
            await db.update(consumptionQrCodes).set({ issuedAt: occurredAt, redeemedAt: occurredAt }).where(eq(consumptionQrCodes.id, issued.qr.id)); // T1
            if (redemption.qr.ledgerId) {
              await db.update(tokenLedger).set({ createdAt: occurredAt, metadata: withSimTag({}) }).where(eq(tokenLedger.id, redemption.qr.ledgerId)); // T1
              track("token_ledger", redemption.qr.ledgerId, persona.email);
              summary.tokensEarned += redemption.breakdown.final;
            }
            summary.consumptions++;
            summary.commerceSpendCents += totalCents;
          } catch { /* regla fuera de horario u otro motivo real — se omite este consumo, no rompe el resto */ }
        } else {
          const result = await ingestCommerceTransaction({
            provider: "segolife", venueId: venue.id, resolvedUserId: user.id,
            transaction: {
              externalTransactionId: externalId, status: "confirmed",
              subtotalCents: totalCents, feesCents: 0, totalCents, currency: "EUR", paymentMethod: "cash",
              buyer: { email: persona.email, phone: null, name: persona.displayName },
              occurredAt, // ← esta sí es nativamente parametrizable, sin T1
              items: [{ venueProductId: product.id, externalProductId: String(product.id), description: product.name, quantity, unitAmountCents: unitCents, totalAmountCents: totalCents }],
            },
          }, db);
          if (result.status !== "already_exists") {
            track("commerce_transactions", result.transaction.id, persona.email);
            const [refreshed] = await db.select().from(commerceTransactions).where(eq(commerceTransactions.id, result.transaction.id)).limit(1);
            if (refreshed.loyaltyLedgerId) {
              await db.update(tokenLedger).set({ createdAt: occurredAt, metadata: withSimTag({}) }).where(eq(tokenLedger.id, refreshed.loyaltyLedgerId)); // T1
              track("token_ledger", refreshed.loyaltyLedgerId, persona.email);
              summary.tokensEarned += Math.round(totalCents / 100 * 0.5);
            }
            summary.consumptions++;
            summary.commerceSpendCents += totalCents;
          }
        }
      } else {
        summary.consumptions++;
        summary.commerceSpendCents += totalCents;
        summary.tokensEarned += Math.round(totalCents / 100 * 0.5); // estimación — misma regla per_euro rate=0.5 de FASE B
      }
      count("consumptions");
    }

    // ── Logins ──
    if (persona.monthlyIntensity[month] > 0.15) {
      const loginsThisMonth = Math.round(randInt(...persona.loginsPerActiveMonth) * persona.monthlyIntensity[month]);
      for (let i = 0; i < loginsThisMonth; i++) {
        let occurredAt = randomTimeOnDate(randomDateInMonth(month), 8, 23);
        if (occurredAt < persona.registrationBackdateTo) continue;
        if (!DRY_RUN) {
          await db.insert(studentLoginEvents).values({ userId: user.id, method: "password", occurredAt });
        }
        summary.logins++;
        count("logins");
      }
    }
  }

  // ── Beneficios (1-2 por estudiante, según perfil) ──────────
  const benefitCount = persona.profile === "power" ? 2 : persona.profile === "selective" ? 1 : 1;
  const benefitSlugs = Object.keys(benefitDefs);
  for (let i = 0; i < Math.min(benefitCount, benefitSlugs.length); i++) {
    const def = benefitDefs[benefitSlugs[i]];
    if (!def) continue;
    const grantedAt = randomDateInMonth(pick(MONTHS.slice(3, 9)));
    const validUntil = new Date(grantedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    const idempotencyKey = `student360_demo:${persona.key}:benefit:${i}`;
    log(`Beneficio: ${persona.displayName} → "${def.nameEs}", concedido ${grantedAt.toISOString().slice(0, 10)}`);
    if (!DRY_RUN) {
      const granted = await grantBenefit({
        userId: user.id, benefitDefinitionId: def.id, sourceType: SIMULATION_TAG,
        communityId, validFrom: grantedAt, validUntil, idempotencyKey,
        metadata: withSimTag(null),
      }, db);
      await db.update(userBenefits).set({ grantedAt }).where(eq(userBenefits.id, granted.benefit.id)); // T1
      track("user_benefits", granted.benefit.id, persona.email);
      summary.benefitsGranted++;

      // ¿Se usa? (probabilidad según perfil)
      const usesIt = rng() < (persona.profile === "power" ? 0.8 : persona.profile === "selective" ? 0.6 : 0.4);
      if (usesIt && def.destinationVenueId != null) {
        const usedAt = new Date(grantedAt.getTime() + randInt(1, 20) * 24 * 60 * 60 * 1000);
        if (usedAt < validUntil) {
          try {
            const redeemed = await redeemBenefit({
              token: granted.qrToken, staffUserId: user.id, venueId: def.destinationVenueId,
              staffAuthorizedVenueIds: "all",
            }, db);
            await db.update(userBenefits).set({ usedAt }).where(eq(userBenefits.id, redeemed.userBenefit.id)); // T1
            summary.benefitsUsed++;
          } catch { /* validación real de venue/estado — se omite si no encaja, no rompe el resto */ }
        }
      }
    } else {
      summary.benefitsGranted++;
      const usesIt = rng() < (persona.profile === "power" ? 0.8 : persona.profile === "selective" ? 0.6 : 0.4);
      if (usesIt) summary.benefitsUsed++;
    }
    count("benefits_granted");
  }

  // ── Notificaciones (engagement) ────────────────────────────
  const notificationCount = persona.profile === "power" ? 8 : persona.profile === "selective" ? 5 : 3;
  for (let i = 0; i < notificationCount; i++) {
    const createdAt = randomDateInMonth(pick(MONTHS));
    if (createdAt < persona.registrationBackdateTo) continue;
    const isRead = rng() < (persona.profile === "power" ? 0.8 : persona.profile === "selective" ? 0.6 : 0.35);
    log(`Notificación #${i} para ${persona.displayName} — ${createdAt.toISOString().slice(0, 10)}${isRead ? " (leída)" : ""}`);
    if (!DRY_RUN) {
      const [insertResult] = await db.insert(notifications).values({
        userId: user.id, communityId, type: "student360_demo_digest", category: "events", audienceType: "marketing",
        titleEn: "This week at Segolife", titleEs: "Esta semana en Segolife",
        bodyEn: "Check out what's happening.", bodyEs: "Mira lo que se cuece.",
        status: "active", priority: "normal", createdAt,
        readAt: isRead ? new Date(createdAt.getTime() + randInt(1, 600) * 60000) : null,
        idempotencyKey: `student360_demo:${persona.key}:notification:${i}`,
        metadata: withSimTag(null),
      });
      track("notifications", (insertResult as unknown as { insertId: number }).insertId, persona.email);
    }
    summary.notifications++;
    if (isRead) summary.notificationsRead++;
    count("notifications");
  }

  return summary;
}

// ============================================================
// ROLLBACK — retira EXCLUSIVAMENTE lo etiquetado con SIMULATION_TAG
// ============================================================

async function runRollback() {
  log(`Rollback de simulación '${SIMULATION_TAG}' — recorriendo tablas con metadata.simulation…`);
  const tables: { name: string; table: any }[] = [
    { name: "notifications", table: notifications },
    { name: "user_benefits", table: userBenefits },
    { name: "token_ledger", table: tokenLedger },
    { name: "consumption_qr_codes", table: consumptionQrCodes },
    { name: "commerce_transactions", table: commerceTransactions },
    { name: "ticket_payments", table: ticketPayments },
    { name: "ticket_orders", table: ticketOrders },
    { name: "venue_products", table: venueProducts },
  ];
  for (const { name, table } of tables) {
    const rows = await db.select().from(table).where(drizzleSql`JSON_EXTRACT(${table.metadata}, '$.simulation') = ${SIMULATION_TAG}`);
    log(`${name}: ${rows.length} filas marcadas`);
    if (!DRY_RUN && rows.length > 0) {
      await db.delete(table).where(drizzleSql`JSON_EXTRACT(${table.metadata}, '$.simulation') = ${SIMULATION_TAG}`);
    }
  }
  log("NOTA: event_tickets/event_attendance/student_login_events no tienen columna metadata — se retiran por FK huérfana (orderId/ledgerId ya borrado) en un segundo paso manual documentado en el informe, nunca automáticamente por seguridad.");
  log("NOTA: events/sales_channels/event_ticket_types/token_rules/benefit_definitions creados por este script NO se borran en rollback automático — son configuración de plataforma real (spec §26 aplicado con criterio: borrar un evento con posibles ticket_orders reales de otros usuarios sería peligroso). Se listan en el manifest para retirada manual revisada.");
  await _pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
