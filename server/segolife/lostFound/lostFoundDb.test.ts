/**
 * lostFoundDb.test.ts — LNF-01. Mismo criterio que studentMessagesDb.test.ts/
 * studentLifecycleService.test.ts: requiere DATABASE_URL real (`mysql://
 * nayade:nayade_pass@localhost:3307/nayade_db`), nunca mockea la cadena de
 * Drizzle — la atomicidad caso+conversación, el bloqueo de fila en
 * transiciones de estado y el alcance por venue son precisamente lo que un
 * mock no verificaría de verdad. Usuarios/venues de prueba dedicados
 * (openId con prefijo `test-lnf01-`, venue con nombre `[QA LNF-01] ...`),
 * creados en beforeAll y borrados en afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, like } from "drizzle-orm";
import {
  users, venues, userCommunities, lostFoundReports, lostFoundCaseActions,
  conversations, conversationMessages,
} from "../../../drizzle/schema";
import {
  createLostFoundReport, getLostFoundReportForStudent, listLostFoundReportsForStudent,
  getLostFoundReportForAdmin, listLostFoundReportsForAdmin, getLostFoundReportVenueId,
  markFound, markClosedNotFound, reopenReport, listCaseActions, countPendingForAdmin, LostFoundError,
  todayInMadrid,
} from "./lostFoundDb";

const pool = mysql.createPool({ uri: process.env.DATABASE_URL });
const db = drizzle(pool);

let studentAId: number;
let studentBId: number;
let adminId: number;
let venueId: number;
let otherVenueId: number;

beforeAll(async () => {
  const [sA] = await db.insert(users).values({ openId: "test-lnf01-student-a", name: "QA LNF01 Student A", role: "user" });
  studentAId = (sA as unknown as { insertId: number }).insertId;
  const [sB] = await db.insert(users).values({ openId: "test-lnf01-student-b", name: "QA LNF01 Student B", role: "user" });
  studentBId = (sB as unknown as { insertId: number }).insertId;
  const [a] = await db.insert(users).values({ openId: "test-lnf01-admin", name: "QA LNF01 Admin", role: "admin" });
  adminId = (a as unknown as { insertId: number }).insertId;

  const [v1] = await db.insert(venues).values({ name: "[QA LNF-01] Venue A", slug: `qa-lnf01-venue-a-${Date.now()}` });
  venueId = (v1 as unknown as { insertId: number }).insertId;
  const [v2] = await db.insert(venues).values({ name: "[QA LNF-01] Venue B", slug: `qa-lnf01-venue-b-${Date.now()}` });
  otherVenueId = (v2 as unknown as { insertId: number }).insertId;
});

afterAll(async () => {
  const testUsers = await db.select({ id: users.id }).from(users).where(like(users.openId, "test-lnf01-%"));
  for (const u of testUsers) {
    const reports = await db.select({ id: lostFoundReports.id, conversationId: lostFoundReports.conversationId }).from(lostFoundReports).where(eq(lostFoundReports.studentUserId, u.id));
    for (const r of reports) {
      await db.delete(lostFoundCaseActions).where(eq(lostFoundCaseActions.reportId, r.id));
      if (r.conversationId) {
        await db.delete(conversationMessages).where(eq(conversationMessages.conversationId, r.conversationId));
        await db.delete(conversations).where(eq(conversations.id, r.conversationId));
      }
    }
    await db.delete(lostFoundReports).where(eq(lostFoundReports.studentUserId, u.id));
    await db.delete(userCommunities).where(eq(userCommunities.userId, u.id));
    await db.delete(users).where(eq(users.id, u.id));
  }
  await db.delete(venues).where(eq(venues.id, venueId));
  await db.delete(venues).where(eq(venues.id, otherVenueId));
  await pool.end();
});

function validInput(overrides: Partial<Parameters<typeof createLostFoundReport>[0]> = {}) {
  return {
    studentUserId: studentAId,
    venueId,
    communityId: null,
    lostDate: todayInMadrid(),
    approximateTime: "18:30",
    description: "Cartera de cuero marrón, la perdí en la barra.",
    imageStorageKey: null,
    venueName: "[QA LNF-01] Venue A",
    ...overrides,
  };
}

describe("createLostFoundReport — atomicidad caso + conversación inicial", () => {
  it("crea el caso Y la conversación en una sola operación; el primer mensaje es la propia descripción del Student", async () => {
    const report = await createLostFoundReport(validInput(), db);
    expect(report.status).toBe("open");
    expect(report.conversationId).not.toBeNull();

    const [conv] = await db.select().from(conversations).where(eq(conversations.id, report.conversationId!)).limit(1);
    expect(conv.contextType).toBe("lost_found");
    expect(conv.contextId).toBe(report.id);
    expect(conv.waitingFor).toBe("admin"); // el Student escribió primero — le toca responder al Admin
    expect(conv.studentLastReadAt).not.toBeNull();
    expect(conv.adminLastReadAt).toBeNull();

    const messages = await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, report.conversationId!));
    expect(messages).toHaveLength(1);
    expect(messages[0].senderRole).toBe("student");
    expect(messages[0].body).toBe(report.description);
  });

  it("rechaza descripción vacía y fecha futura, sin crear nada", async () => {
    // Student propio de este test (no studentAId, que ya tiene un reporte
    // válido de un test anterior) — aísla la comprobación de "no se creó
    // nada" de cualquier otro dato ya existente.
    const [s] = await db.insert(users).values({ openId: "test-lnf01-validation-only", name: "QA LNF01 Validation", role: "user" });
    const freshStudentId = (s as unknown as { insertId: number }).insertId;

    await expect(createLostFoundReport(validInput({ studentUserId: freshStudentId, description: "   " }), db)).rejects.toThrow(LostFoundError);
    await expect(createLostFoundReport(validInput({ studentUserId: freshStudentId, lostDate: "2099-01-01" }), db)).rejects.toThrow(LostFoundError);
    const reports = await db.select().from(lostFoundReports).where(eq(lostFoundReports.studentUserId, freshStudentId));
    expect(reports).toHaveLength(0);
  });
});

describe("getLostFoundReportForStudent / listLostFoundReportsForStudent — IDOR y visibilidad propia", () => {
  it("un Student ve su propio caso; el otro Student recibe NOT_FOUND (nunca confirma su existencia)", async () => {
    const report = await createLostFoundReport(validInput(), db);
    const own = await getLostFoundReportForStudent(report.id, studentAId, db);
    expect(own.id).toBe(report.id);
    expect(own.venueName).toBe("[QA LNF-01] Venue A");

    await expect(getLostFoundReportForStudent(report.id, studentBId, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("listLostFoundReportsForStudent nunca devuelve casos de otro Student", async () => {
    await createLostFoundReport(validInput({ studentUserId: studentBId }), db);
    const { items } = await listLostFoundReportsForStudent(studentAId, {}, db);
    expect(items.every(i => i.studentUserId === studentAId)).toBe(true);
  });
});

describe("listLostFoundReportsForAdmin — alcance por venue (spec §14/§25)", () => {
  it("venueIds='all' (admin global) ve casos de cualquier venue", async () => {
    await createLostFoundReport(validInput({ venueId: otherVenueId, venueName: "[QA LNF-01] Venue B" }), db);
    const { items } = await listLostFoundReportsForAdmin({ venueIds: "all", limit: 100 }, db);
    const venueIds = new Set(items.map(i => i.venueId));
    expect(venueIds.has(venueId) || venueIds.has(otherVenueId)).toBe(true);
  });

  it("venueIds=[venueId] (venue_admin acotado) NUNCA devuelve casos de otro venue", async () => {
    const { items } = await listLostFoundReportsForAdmin({ venueIds: [venueId], limit: 100 }, db);
    expect(items.every(i => i.venueId === venueId)).toBe(true);
  });

  it("venueIds=[] (venue_admin sin ningún venue asignado) devuelve vacío, NUNCA 'todos' por omisión", async () => {
    const { items, total } = await listLostFoundReportsForAdmin({ venueIds: [] }, db);
    expect(items).toHaveLength(0);
    expect(total).toBe(0);
  });
});

describe("getLostFoundReportVenueId — comprobación barata de IDOR", () => {
  it("devuelve el venueId real sin traer el resto de campos", async () => {
    const report = await createLostFoundReport(validInput(), db);
    const result = await getLostFoundReportVenueId(report.id, db);
    expect(result).toBe(venueId);
  });
  it("null si el caso no existe", async () => {
    expect(await getLostFoundReportVenueId(999999999, db)).toBeNull();
  });
});

describe("getLostFoundReportForAdmin — solo name/email/phone del Student, nunca el CRM completo", () => {
  it("expone exactamente id/name/email/phone", async () => {
    const report = await createLostFoundReport(validInput(), db);
    const detail = await getLostFoundReportForAdmin(report.id, db);
    expect(Object.keys(detail.student).sort()).toEqual(["email", "id", "name", "phone"]);
    expect(detail.venueName).toBe("[QA LNF-01] Venue A");
  });
});

describe("Máquina de estados — transiciones válidas/inválidas (spec §6)", () => {
  it("OPEN → FOUND exige nota de resolución no vacía, registra auditoría y resolvedAt/resolvedByUserId", async () => {
    const report = await createLostFoundReport(validInput(), db);
    await expect(markFound(report.id, adminId, "   ", db)).rejects.toThrow(LostFoundError);

    const updated = await markFound(report.id, adminId, "Hemos encontrado tu cartera, pásate por barra.", db);
    expect(updated.status).toBe("found");
    expect(updated.resolvedByUserId).toBe(adminId);
    expect(updated.resolvedAt).not.toBeNull();

    const actions = await listCaseActions(report.id, db);
    expect(actions.some(a => a.action === "marked_found" && a.beforeValue === "open" && a.afterValue === "found")).toBe(true);
  });

  it("FOUND → CLOSED_NOT_FOUND directo está PROHIBIDO — nunca transiciones incoherentes", async () => {
    const report = await createLostFoundReport(validInput(), db);
    await markFound(report.id, adminId, "Encontrado.", db);
    await expect(markClosedNotFound(report.id, adminId, "Cerrado.", db)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("reopen exige motivo, revierte a OPEN y queda auditado; el reopen NO borra la última resolutionNote real", async () => {
    const report = await createLostFoundReport(validInput(), db);
    await markClosedNotFound(report.id, adminId, "No se encontró tras revisar el local.", db);
    await expect(reopenReport(report.id, adminId, "", db)).rejects.toThrow(LostFoundError);

    const reopened = await reopenReport(report.id, adminId, "El Student aportó más detalles, reabrimos la búsqueda.", db);
    expect(reopened.status).toBe("open");
    expect(reopened.resolutionNote).toBe("No se encontró tras revisar el local.");

    const actions = await listCaseActions(report.id, db);
    expect(actions.some(a => a.action === "reopened" && a.reason?.includes("reabrimos"))).toBe(true);
  });

  it("un segundo intento sobre un caso ya resuelto con el status antiguo (concurrencia, spec §26) es rechazado limpiamente", async () => {
    const report = await createLostFoundReport(validInput(), db);
    await markFound(report.id, adminId, "Encontrado por el primer admin.", db);
    // El "segundo admin" actúa sobre el MISMO reportId sin refrescar — su
    // propia llamada revalida el status real dentro de la transacción
    // (FOR UPDATE), nunca confía en un estado leído antes.
    await expect(markClosedNotFound(report.id, adminId, "Intento tardío.", db)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe("countPendingForAdmin — badge de nav (spec §13/§14)", () => {
  it("cuenta casos abiertos + casos con respuesta del Student sin leer, nunca los ya resueltos y leídos, con alcance por venue", async () => {
    // Venue dedicado — aísla el conteo de los reportes ya creados por otros
    // tests de este archivo sobre `venueId`/`otherVenueId`.
    const [v] = await db.insert(venues).values({ name: "[QA LNF-01] Venue Pending", slug: `qa-lnf01-venue-pending-${Date.now()}` });
    const pendingVenueId = (v as unknown as { insertId: number }).insertId;

    const open = await createLostFoundReport(validInput({ venueId: pendingVenueId, venueName: "Pending" }), db);
    const resolvedAndRead = await createLostFoundReport(validInput({ venueId: pendingVenueId, venueName: "Pending" }), db);
    await markFound(resolvedAndRead.id, adminId, "Resuelto y leído.", db);
    await db.update(conversations).set({ adminLastReadAt: new Date() }).where(eq(conversations.id, resolvedAndRead.conversationId!));

    const countAll = await countPendingForAdmin("all", db);
    expect(countAll).toBeGreaterThanOrEqual(1); // al menos `open`, sin filtrar por venue

    const countScoped = await countPendingForAdmin([pendingVenueId], db);
    expect(countScoped).toBe(1); // solo `open` — el resuelto+leído no cuenta

    expect(await countPendingForAdmin([], db)).toBe(0); // nunca "todos" por omisión

    await db.delete(venues).where(eq(venues.id, pendingVenueId));
  });
});
