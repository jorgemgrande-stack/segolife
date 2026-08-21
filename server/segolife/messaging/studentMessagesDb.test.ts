/**
 * studentMessagesDb.test.ts — COM-01. A diferencia del resto de *Db.test.ts
 * de este repo (que mockean el parámetro `db` para nunca tocar una BD
 * real), esta suite exige DATABASE_URL real exportado (`export
 * DATABASE_URL=mysql://nayade:nayade_pass@localhost:3307/nayade_db` antes
 * de `npx vitest run`) — la lógica que se prueba aquí (transacciones
 * multi-insert, JOIN con users, recálculo de waitingFor al reabrir,
 * paginación/orden real) es precisamente la que un mock de cadena de
 * Drizzle no verificaría de verdad, solo simularía. Usa usuarios de prueba
 * dedicados (openId con prefijo `test-com01-`), creados en beforeAll y
 * borrados en afterAll — nunca toca una fila real.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, like } from "drizzle-orm";
import { users, conversations, conversationMessages } from "../../../drizzle/schema";
import {
  createConversation, replyAsStudent, replyAsAdmin,
  getConversationForStudent, getConversationForAdmin,
  listConversationsForStudent, listConversationsForAdmin,
  countAwaitingAdmin, closeConversation, reopenConversation,
  markReadByStudent, markReadByAdmin, StudentMessagesError,
  assertValidBody, preview, MESSAGE_BODY_MAX_LENGTH,
} from "./studentMessagesDb";

const pool = mysql.createPool({ uri: process.env.DATABASE_URL });
const db = drizzle(pool);

let studentId: number;
let student2Id: number;
let adminId: number;

beforeAll(async () => {
  const [s1] = await db.insert(users).values({ openId: "test-com01-student-1", name: "QA Student One", role: "user" });
  studentId = (s1 as unknown as { insertId: number }).insertId;
  const [s2] = await db.insert(users).values({ openId: "test-com01-student-2", name: "QA Student Two", role: "user" });
  student2Id = (s2 as unknown as { insertId: number }).insertId;
  const [a1] = await db.insert(users).values({ openId: "test-com01-admin-1", name: "QA Admin", role: "admin" });
  adminId = (a1 as unknown as { insertId: number }).insertId;
});

afterAll(async () => {
  const testUsers = await db.select({ id: users.id }).from(users).where(like(users.openId, "test-com01-%"));
  const ids = testUsers.map(u => u.id);
  for (const id of ids) {
    const convs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.studentUserId, id));
    for (const c of convs) {
      await db.delete(conversationMessages).where(eq(conversationMessages.conversationId, c.id));
      await db.delete(conversations).where(eq(conversations.id, c.id));
    }
    await db.delete(users).where(eq(users.id, id));
  }
  await pool.end();
});

describe("preview / assertValidBody — funciones puras", () => {
  it("preview recorta a 160 caracteres con elipsis, sin tocar textos cortos", () => {
    expect(preview("hola")).toBe("hola");
    expect(preview("  hola  ")).toBe("hola");
    const long = "a".repeat(200);
    expect(preview(long)).toHaveLength(160);
    expect(preview(long).endsWith("…")).toBe(true);
  });

  it("assertValidBody rechaza vacío/solo-espacios y el máximo de longitud", () => {
    expect(() => assertValidBody("")).toThrow(StudentMessagesError);
    expect(() => assertValidBody("   ")).toThrow(StudentMessagesError);
    expect(() => assertValidBody("a".repeat(MESSAGE_BODY_MAX_LENGTH + 1))).toThrow(StudentMessagesError);
    expect(assertValidBody("  hola  ")).toBe("hola");
  });
});

describe("createConversation — Admin inicia (COM-01, ciclo de vida completo)", () => {
  it("crea conversation + primer mensaje, status=open, waitingFor=student", async () => {
    const { conversation, message } = await createConversation({
      studentUserId: studentId, createdByUserId: adminId, subject: "[QA COM-01] Asunto de prueba", body: "Hola, primer mensaje",
    }, db);
    expect(conversation.status).toBe("open");
    expect(conversation.waitingFor).toBe("student");
    expect(conversation.lastMessagePreview).toBe("Hola, primer mensaje");
    expect(message.senderRole).toBe("admin");
    expect(message.visibility).toBe("public");
  });

  it("rechaza asunto vacío y cuerpo vacío sin tocar la BD", async () => {
    await expect(createConversation({ studentUserId: studentId, createdByUserId: adminId, subject: "", body: "x" }, db)).rejects.toThrow(StudentMessagesError);
    await expect(createConversation({ studentUserId: studentId, createdByUserId: adminId, subject: "x", body: "" }, db)).rejects.toThrow(StudentMessagesError);
  });
});

describe("replyAsStudent / replyAsAdmin — waitingFor, IDOR, cerrada", () => {
  it("Student responde: waitingFor pasa a admin", async () => {
    const { conversation: created } = await createConversation({ studentUserId: studentId, createdByUserId: adminId, subject: "[QA COM-01] hilo", body: "hola" }, db);
    const { conversation } = await replyAsStudent({ conversationId: created.id, studentUserId: studentId, body: "respuesta del student" }, db);
    expect(conversation.waitingFor).toBe("admin");
  });

  it("Admin responde: waitingFor vuelve a student", async () => {
    const { conversation: created } = await createConversation({ studentUserId: studentId, createdByUserId: adminId, subject: "[QA COM-01] hilo2", body: "hola" }, db);
    await replyAsStudent({ conversationId: created.id, studentUserId: studentId, body: "r1" }, db);
    const { conversation } = await replyAsAdmin({ conversationId: created.id, adminUserId: adminId, body: "r2 admin" }, db);
    expect(conversation.waitingFor).toBe("student");
  });

  it("REGRESIÓN IDOR — Student B nunca puede responder la conversación de Student A", async () => {
    const { conversation: created } = await createConversation({ studentUserId: studentId, createdByUserId: adminId, subject: "[QA COM-01] ajena", body: "hola" }, db);
    await expect(replyAsStudent({ conversationId: created.id, studentUserId: student2Id, body: "intento ajeno" }, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("conversación cerrada: ni Student ni Admin pueden responder", async () => {
    const { conversation: created } = await createConversation({ studentUserId: studentId, createdByUserId: adminId, subject: "[QA COM-01] cerrada", body: "hola" }, db);
    await closeConversation(created.id, adminId, db);
    await expect(replyAsStudent({ conversationId: created.id, studentUserId: studentId, body: "x" }, db)).rejects.toMatchObject({ code: "CONVERSATION_CLOSED" });
    await expect(replyAsAdmin({ conversationId: created.id, adminUserId: adminId, body: "x" }, db)).rejects.toMatchObject({ code: "CONVERSATION_CLOSED" });
  });

  it("nota interna (visibility=internal): NUNCA cambia waitingFor a student — sigue siendo turno de Admin", async () => {
    const { conversation: created } = await createConversation({ studentUserId: studentId, createdByUserId: adminId, subject: "[QA COM-01] nota interna", body: "hola" }, db);
    const { conversation } = await replyAsAdmin({ conversationId: created.id, adminUserId: adminId, body: "nota solo staff", visibility: "internal" }, db);
    expect(conversation.waitingFor).toBe("admin");
  });
});

describe("getConversationForStudent / getConversationForAdmin — visibilidad e IDOR", () => {
  it("Student NUNCA ve un mensaje visibility=internal, Admin sí", async () => {
    const { conversation: created } = await createConversation({ studentUserId: studentId, createdByUserId: adminId, subject: "[QA COM-01] visibilidad", body: "público inicial" }, db);
    await replyAsAdmin({ conversationId: created.id, adminUserId: adminId, body: "nota interna oculta", visibility: "internal" }, db);

    const studentView = await getConversationForStudent(created.id, studentId, db);
    expect(studentView.messages.some(m => m.body === "nota interna oculta")).toBe(false);

    const adminView = await getConversationForAdmin(created.id, db);
    expect(adminView.messages.some(m => m.body === "nota interna oculta")).toBe(true);
    expect(adminView.student?.id).toBe(studentId);
  });

  it("REGRESIÓN IDOR — Student B nunca puede leer la conversación de Student A por id", async () => {
    const { conversation: created } = await createConversation({ studentUserId: studentId, createdByUserId: adminId, subject: "[QA COM-01] lectura ajena", body: "hola" }, db);
    await expect(getConversationForStudent(created.id, student2Id, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("conversación inexistente: NOT_FOUND tanto para Student como para Admin", async () => {
    await expect(getConversationForStudent(999999, studentId, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getConversationForAdmin(999999, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("los mensajes se devuelven en orden cronológico", async () => {
    const { conversation: created } = await createConversation({ studentUserId: studentId, createdByUserId: adminId, subject: "[QA COM-01] orden", body: "m1" }, db);
    await replyAsStudent({ conversationId: created.id, studentUserId: studentId, body: "m2" }, db);
    await replyAsAdmin({ conversationId: created.id, adminUserId: adminId, body: "m3" }, db);
    const { messages } = await getConversationForAdmin(created.id, db);
    expect(messages.map(m => m.body)).toEqual(["m1", "m2", "m3"]);
  });
});

describe("close / reopen", () => {
  it("closeConversation: status=closed, waitingFor=none, closedByUserId registrado", async () => {
    const { conversation: created } = await createConversation({ studentUserId: studentId, createdByUserId: adminId, subject: "[QA COM-01] close", body: "hola" }, db);
    const closed = await closeConversation(created.id, adminId, db);
    expect(closed.status).toBe("closed");
    expect(closed.waitingFor).toBe("none");
    expect(closed.closedByUserId).toBe(adminId);
    expect(closed.closedAt).not.toBeNull();
  });

  it("reopenConversation recalcula waitingFor a partir del último mensaje real (nunca un valor fijo)", async () => {
    const { conversation: created } = await createConversation({ studentUserId: studentId, createdByUserId: adminId, subject: "[QA COM-01] reopen-a", body: "hola" }, db);
    await replyAsStudent({ conversationId: created.id, studentUserId: studentId, body: "último fue del student" }, db);
    await closeConversation(created.id, adminId, db);
    const reopened = await reopenConversation(created.id, db);
    expect(reopened.status).toBe("open");
    expect(reopened.waitingFor).toBe("admin"); // último mensaje fue del student → ahora espera a Admin
    expect(reopened.closedAt).toBeNull();
    expect(reopened.closedByUserId).toBeNull();
  });

  it("reopen es idempotente si ya está abierta", async () => {
    const { conversation: created } = await createConversation({ studentUserId: studentId, createdByUserId: adminId, subject: "[QA COM-01] reopen-b", body: "hola" }, db);
    const reopened = await reopenConversation(created.id, db);
    expect(reopened.status).toBe("open");
  });
});

describe("read state (studentLastReadAt / adminLastReadAt) y unread derivado", () => {
  it("una conversación recién creada aparece unread=false para Admin (ya la 'leyó' al escribirla) y sin marcar para Student hasta que responde", async () => {
    const { conversation: created } = await createConversation({ studentUserId: studentId, createdByUserId: adminId, subject: "[QA COM-01] unread-1", body: "hola" }, db);
    const adminList = await listConversationsForAdmin({ search: "[QA COM-01] unread-1" }, db);
    expect(adminList.items[0].unread).toBe(false);

    const studentList = await listConversationsForStudent(studentId, {}, db);
    const row = studentList.items.find(c => c.id === created.id);
    expect(row?.unread).toBe(true); // el Student aún no ha abierto/leído el primer mensaje de Admin
  });

  it("markReadByStudent limpia el unread del Student; una respuesta nueva de Admin lo vuelve a marcar", async () => {
    const { conversation: created } = await createConversation({ studentUserId: studentId, createdByUserId: adminId, subject: "[QA COM-01] unread-2", body: "hola" }, db);
    await markReadByStudent(created.id, studentId, db);
    let studentList = await listConversationsForStudent(studentId, {}, db);
    expect(studentList.items.find(c => c.id === created.id)?.unread).toBe(false);

    await replyAsAdmin({ conversationId: created.id, adminUserId: adminId, body: "otra vez" }, db);
    studentList = await listConversationsForStudent(studentId, {}, db);
    expect(studentList.items.find(c => c.id === created.id)?.unread).toBe(true);
  });

  it("markReadByAdmin limpia el unread de Admin tras una respuesta del Student", async () => {
    const { conversation: created } = await createConversation({ studentUserId: studentId, createdByUserId: adminId, subject: "[QA COM-01] unread-3", body: "hola" }, db);
    await replyAsStudent({ conversationId: created.id, studentUserId: studentId, body: "respuesta" }, db);
    let adminList = await listConversationsForAdmin({ search: "[QA COM-01] unread-3" }, db);
    expect(adminList.items[0].unread).toBe(true);

    await markReadByAdmin(created.id, db);
    adminList = await listConversationsForAdmin({ search: "[QA COM-01] unread-3" }, db);
    expect(adminList.items[0].unread).toBe(false);
  });
});

describe("countAwaitingAdmin / listConversationsForAdmin — filtros y paginación", () => {
  it("countAwaitingAdmin solo cuenta conversaciones abiertas con waitingFor=admin", async () => {
    const before = await countAwaitingAdmin(db);
    const { conversation: created } = await createConversation({ studentUserId: studentId, createdByUserId: adminId, subject: "[QA COM-01] awaiting", body: "hola" }, db);
    await replyAsStudent({ conversationId: created.id, studentUserId: studentId, body: "x" }, db); // waitingFor=admin
    const after = await countAwaitingAdmin(db);
    expect(after).toBe(before + 1);
  });

  it("filtra por status/waitingFor y por búsqueda de subject", async () => {
    const { conversation: created } = await createConversation({ studentUserId: studentId, createdByUserId: adminId, subject: "[QA COM-01] filtro-unico-xyz", body: "hola" }, db);
    const bySubject = await listConversationsForAdmin({ search: "filtro-unico-xyz" }, db);
    expect(bySubject.items.some(c => c.id === created.id)).toBe(true);

    const byOpenWaitingStudent = await listConversationsForAdmin({ status: "open", waitingFor: "student", search: "filtro-unico-xyz" }, db);
    expect(byOpenWaitingStudent.items.some(c => c.id === created.id)).toBe(true);

    const byWrongWaiting = await listConversationsForAdmin({ waitingFor: "admin", search: "filtro-unico-xyz" }, db);
    expect(byWrongWaiting.items.some(c => c.id === created.id)).toBe(false);
  });

  it("paginación: limit/offset respetados, orden por última actividad descendente", async () => {
    const result = await listConversationsForStudent(studentId, { limit: 2, offset: 0 }, db);
    expect(result.items.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < result.items.length; i++) {
      const prev = result.items[i - 1].lastMessageAt?.getTime() ?? 0;
      const curr = result.items[i].lastMessageAt?.getTime() ?? 0;
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });
});
