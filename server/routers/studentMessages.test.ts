/**
 * studentMessages.test.ts — COM-01. Mismo criterio que community.test.ts:
 * se mockean las dependencias de BD/notificación para probar RBAC/IDOR/
 * delegación del router de forma barata y determinista, sin BD real.
 * La lógica de negocio real (transacciones, IDOR, waitingFor) vive en
 * studentMessagesDb.ts — no se reimplementa aquí.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockCreateGeneralConversationForStudent, mockFindGeneralConversationForStudent,
  mockReplyAsStudent, mockReplyAsAdmin,
  mockGetConversationForStudent, mockGetConversationForAdmin,
  mockListConversationsForStudent, mockListConversationsForAdmin,
  mockCountAwaitingAdmin, mockCloseConversation, mockReopenConversation,
  mockMarkReadByStudent, mockMarkReadByAdmin,
  mockGetStudentByUserId, mockGetUserCommunitiesWithDetails, mockCreateNotification,
} = vi.hoisted(() => ({
  mockCreateGeneralConversationForStudent: vi.fn(),
  mockFindGeneralConversationForStudent: vi.fn(),
  mockReplyAsStudent: vi.fn(),
  mockReplyAsAdmin: vi.fn(),
  mockGetConversationForStudent: vi.fn(),
  mockGetConversationForAdmin: vi.fn(),
  mockListConversationsForStudent: vi.fn(),
  mockListConversationsForAdmin: vi.fn(),
  mockCountAwaitingAdmin: vi.fn(),
  mockCloseConversation: vi.fn(),
  mockReopenConversation: vi.fn(),
  mockMarkReadByStudent: vi.fn(),
  mockMarkReadByAdmin: vi.fn(),
  mockGetStudentByUserId: vi.fn(),
  mockGetUserCommunitiesWithDetails: vi.fn(),
  mockCreateNotification: vi.fn().mockResolvedValue({ status: "created", notification: { id: 1 } }),
}));

vi.mock("../segolife/messaging/studentMessagesDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/messaging/studentMessagesDb")>();
  return {
    ...actual,
    createGeneralConversationForStudent: mockCreateGeneralConversationForStudent,
    findGeneralConversationForStudent: mockFindGeneralConversationForStudent,
    replyAsStudent: mockReplyAsStudent,
    replyAsAdmin: mockReplyAsAdmin,
    getConversationForStudent: mockGetConversationForStudent,
    getConversationForAdmin: mockGetConversationForAdmin,
    listConversationsForStudent: mockListConversationsForStudent,
    listConversationsForAdmin: mockListConversationsForAdmin,
    countAwaitingAdmin: mockCountAwaitingAdmin,
    closeConversation: mockCloseConversation,
    reopenConversation: mockReopenConversation,
    markReadByStudent: mockMarkReadByStudent,
    markReadByAdmin: mockMarkReadByAdmin,
  };
});
vi.mock("../db/studentsDb", () => ({ getStudentByUserId: mockGetStudentByUserId }));
vi.mock("../db/communitiesDb", () => ({ getUserCommunitiesWithDetails: mockGetUserCommunitiesWithDetails }));
vi.mock("../segolife/engagement/notificationService", () => ({ createNotification: mockCreateNotification }));

import { studentMessagesRouter } from "./studentMessages";
import { StudentMessagesError } from "../segolife/messaging/studentMessagesDb";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return studentMessagesRouter.createCaller({ user: null } as any);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAs(id: number) {
  return studentMessagesRouter.createCaller({ user: { id, role: "user" } } as any);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAsAdmin(id: number) {
  return studentMessagesRouter.createCaller({ user: { id, role: "admin" } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateNotification.mockResolvedValue({ status: "created", notification: { id: 1 } });
  mockGetUserCommunitiesWithDetails.mockResolvedValue([{ id: 1, slug: "ie", name: "Segolife IE" }]);
});

describe("studentMessages — ningún procedure es accesible sin sesión", () => {
  it("Student procedures rechazan sin sesión", async () => {
    await expect(callerWithoutSession().myConversations()).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().getConversation({ id: 1 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().reply({ conversationId: 1, body: "x" })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().markRead({ conversationId: 1 })).rejects.toThrow(/please login/i);
  });

  it("Admin procedures rechazan sin sesión", async () => {
    await expect(callerWithoutSession().adminList({})).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().adminPendingCount()).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().adminGetConversation({ id: 1 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().adminFindGeneralConversation({ studentUserId: 1 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().adminCreateConversation({ studentUserId: 1, subject: "s", body: "b" })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().adminReply({ conversationId: 1, body: "b" })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().adminClose({ conversationId: 1 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().adminReopen({ conversationId: 1 })).rejects.toThrow(/please login/i);
  });
});

describe("studentMessages — RBAC: un Student (role=user) nunca accede a los procedures Admin", () => {
  it("adminList/adminPendingCount/adminGetConversation/adminFindGeneralConversation/adminCreateConversation/adminReply/adminClose/adminReopen: FORBIDDEN para un Student", async () => {
    await expect(callerAs(7).adminList({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs(7).adminPendingCount()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs(7).adminGetConversation({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs(7).adminFindGeneralConversation({ studentUserId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs(7).adminCreateConversation({ studentUserId: 1, subject: "s", body: "b" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs(7).adminReply({ conversationId: 1, body: "b" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs(7).adminClose({ conversationId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs(7).adminReopen({ conversationId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockCreateGeneralConversationForStudent).not.toHaveBeenCalled();
    expect(mockFindGeneralConversationForStudent).not.toHaveBeenCalled();
    expect(mockReplyAsAdmin).not.toHaveBeenCalled();
  });
});

describe("studentMessages — Student: self-scoped SIEMPRE por ctx.user.id (IDOR)", () => {
  it("myConversations pasa ctx.user.id, nunca un id recibido del cliente", async () => {
    mockListConversationsForStudent.mockResolvedValue({ items: [], total: 0 });
    await callerAs(7).myConversations();
    expect(mockListConversationsForStudent).toHaveBeenCalledWith(7, {});
  });

  it("getConversation delega en getConversationForStudent con ctx.user.id — la comprobación de propiedad vive en la capa de BD", async () => {
    mockGetConversationForStudent.mockResolvedValue({ conversation: { id: 1 }, messages: [] });
    await callerAs(7).getConversation({ id: 1 });
    expect(mockGetConversationForStudent).toHaveBeenCalledWith(1, 7);
  });

  it("REGRESIÓN IDOR — conversación ajena/inexistente: NOT_FOUND (nunca FORBIDDEN, no confirma su existencia)", async () => {
    mockGetConversationForStudent.mockRejectedValue(new StudentMessagesError("NOT_FOUND", "Conversación no encontrada"));
    await expect(callerAs(7).getConversation({ id: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reply delega en replyAsStudent con ctx.user.id, nunca un studentUserId del body", async () => {
    mockReplyAsStudent.mockResolvedValue({ conversation: { id: 1 }, message: { id: 10 } });
    await callerAs(7).reply({ conversationId: 1, body: "hola" });
    expect(mockReplyAsStudent).toHaveBeenCalledWith({ conversationId: 1, studentUserId: 7, body: "hola" });
  });

  it("responder una conversación ajena: NOT_FOUND, nunca crea el mensaje", async () => {
    mockReplyAsStudent.mockRejectedValue(new StudentMessagesError("NOT_FOUND", "Conversación no encontrada"));
    await expect(callerAs(7).reply({ conversationId: 999, body: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("responder una conversación cerrada: BAD_REQUEST, mensaje claro", async () => {
    mockReplyAsStudent.mockRejectedValue(new StudentMessagesError("CONVERSATION_CLOSED", "Esta conversación está cerrada"));
    await expect(callerAs(7).reply({ conversationId: 1, body: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("markRead delega en markReadByStudent con ctx.user.id", async () => {
    mockMarkReadByStudent.mockResolvedValue(undefined);
    await callerAs(7).markRead({ conversationId: 1 });
    expect(mockMarkReadByStudent).toHaveBeenCalledWith(1, 7);
  });

  it("un mensaje vacío es rechazado por Zod antes de llegar a la capa de BD", async () => {
    await expect(callerAs(7).reply({ conversationId: 1, body: "" })).rejects.toThrow();
    expect(mockReplyAsStudent).not.toHaveBeenCalled();
  });
});

describe("studentMessages — Admin: creación de conversación + notificación", () => {
  it("Student inexistente: NOT_FOUND, nunca crea la conversación", async () => {
    mockGetStudentByUserId.mockResolvedValue(null);
    await expect(callerAsAdmin(1).adminCreateConversation({ studentUserId: 999, subject: "s", body: "b" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockCreateGeneralConversationForStudent).not.toHaveBeenCalled();
  });

  it("creación exitosa: crea la conversación con ctx.user.id como createdByUserId y dispara la notificación al Student", async () => {
    mockGetStudentByUserId.mockResolvedValue({ id: 1, userId: 42 });
    mockCreateGeneralConversationForStudent.mockResolvedValue({ conversation: { id: 5, studentUserId: 42, subject: "Asunto QA" }, message: { id: 1 }, alreadyExisted: false });
    await callerAsAdmin(1).adminCreateConversation({ studentUserId: 42, subject: "Asunto QA", body: "Hola" });
    expect(mockCreateGeneralConversationForStudent).toHaveBeenCalledWith({ studentUserId: 42, createdByUserId: 1, subject: "Asunto QA", body: "Hola" });
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification.mock.calls[0][0]).toMatchObject({ userId: 42, category: "messages", audienceType: "transactional" });
  });

  it("STU-02 — idempotencia: si ya existía una conversación general (alreadyExisted=true), NUNCA notifica un mensaje nuevo que no se envió", async () => {
    mockGetStudentByUserId.mockResolvedValue({ id: 1, userId: 42 });
    mockCreateGeneralConversationForStudent.mockResolvedValue({ conversation: { id: 5, studentUserId: 42, subject: "Ya existente" }, message: null, alreadyExisted: true });
    const result = await callerAsAdmin(1).adminCreateConversation({ studentUserId: 42, subject: "Otro asunto", body: "Otro mensaje" });
    expect(result.conversation.id).toBe(5);
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("si no se encuentra ninguna comunidad real del Student (caso límite), la notificación se omite sin lanzar y la conversación sigue creada", async () => {
    mockGetStudentByUserId.mockResolvedValue({ id: 1, userId: 42 });
    mockCreateGeneralConversationForStudent.mockResolvedValue({ conversation: { id: 5, studentUserId: 42, subject: "s" }, message: { id: 1 }, alreadyExisted: false });
    mockGetUserCommunitiesWithDetails.mockResolvedValue([]);
    const result = await callerAsAdmin(1).adminCreateConversation({ studentUserId: 42, subject: "s", body: "b" });
    expect(result.conversation.id).toBe(5);
  });

  it("si createNotification falla, la conversación ya creada NUNCA desaparece (best-effort, spec §29)", async () => {
    mockGetStudentByUserId.mockResolvedValue({ id: 1, userId: 42 });
    mockCreateGeneralConversationForStudent.mockResolvedValue({ conversation: { id: 5, studentUserId: 42, subject: "s" }, message: { id: 1 }, alreadyExisted: false });
    mockCreateNotification.mockRejectedValue(new Error("boom"));
    const result = await callerAsAdmin(1).adminCreateConversation({ studentUserId: 42, subject: "s", body: "b" });
    expect(result.conversation.id).toBe(5);
  });
});

describe("studentMessages — STU-02: adminFindGeneralConversation (localizar sin crear)", () => {
  it("devuelve el conversationId cuando ya existe una conversación general", async () => {
    mockFindGeneralConversationForStudent.mockResolvedValue({ id: 7, studentUserId: 42 });
    const result = await callerAsAdmin(1).adminFindGeneralConversation({ studentUserId: 42 });
    expect(result).toEqual({ conversationId: 7 });
    expect(mockFindGeneralConversationForStudent).toHaveBeenCalledWith(42);
  });

  it("devuelve conversationId=null cuando no existe ninguna — nunca crea nada", async () => {
    mockFindGeneralConversationForStudent.mockResolvedValue(null);
    const result = await callerAsAdmin(1).adminFindGeneralConversation({ studentUserId: 42 });
    expect(result).toEqual({ conversationId: null });
    expect(mockCreateGeneralConversationForStudent).not.toHaveBeenCalled();
  });

  it("venue_admin: FORBIDDEN — misma política que el resto de procedures Admin de COM-01", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callerAsVenueAdmin = studentMessagesRouter.createCaller({ user: { id: 9, role: "venue_admin" } } as any);
    await expect(callerAsVenueAdmin.adminFindGeneralConversation({ studentUserId: 42 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockFindGeneralConversationForStudent).not.toHaveBeenCalled();
  });
});

describe("studentMessages — Admin: respuesta pública vs. nota interna", () => {
  it("respuesta pública (default): delega en replyAsAdmin y SÍ notifica al Student", async () => {
    mockReplyAsAdmin.mockResolvedValue({ conversation: { id: 5, studentUserId: 42, subject: "s" }, message: { id: 2 } });
    await callerAsAdmin(1).adminReply({ conversationId: 5, body: "Respuesta" });
    expect(mockReplyAsAdmin).toHaveBeenCalledWith({ conversationId: 5, adminUserId: 1, body: "Respuesta", visibility: "public" });
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
  });

  it("nota interna (visibility=internal): delega en replyAsAdmin pero NUNCA notifica al Student — la nota no es suya", async () => {
    mockReplyAsAdmin.mockResolvedValue({ conversation: { id: 5, studentUserId: 42, subject: "s" }, message: { id: 2 } });
    await callerAsAdmin(1).adminReply({ conversationId: 5, body: "Nota solo staff", visibility: "internal" });
    expect(mockReplyAsAdmin).toHaveBeenCalledWith({ conversationId: 5, adminUserId: 1, body: "Nota solo staff", visibility: "internal" });
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("responder una conversación cerrada: BAD_REQUEST (Admin también debe reabrir primero)", async () => {
    mockReplyAsAdmin.mockRejectedValue(new StudentMessagesError("CONVERSATION_CLOSED", "cerrada"));
    await expect(callerAsAdmin(1).adminReply({ conversationId: 5, body: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("studentMessages — Admin: close/reopen/markRead/pendingCount/list delegan correctamente", () => {
  it("adminClose delega con ctx.user.id como closedByUserId", async () => {
    mockCloseConversation.mockResolvedValue({ id: 5, status: "closed" });
    await callerAsAdmin(1).adminClose({ conversationId: 5 });
    expect(mockCloseConversation).toHaveBeenCalledWith(5, 1);
  });

  it("adminReopen delega sin argumentos extra (recalcula waitingFor internamente)", async () => {
    mockReopenConversation.mockResolvedValue({ id: 5, status: "open" });
    await callerAsAdmin(1).adminReopen({ conversationId: 5 });
    expect(mockReopenConversation).toHaveBeenCalledWith(5);
  });

  it("adminMarkRead delega en markReadByAdmin", async () => {
    mockMarkReadByAdmin.mockResolvedValue(undefined);
    await callerAsAdmin(1).adminMarkRead({ conversationId: 5 });
    expect(mockMarkReadByAdmin).toHaveBeenCalledWith(5);
  });

  it("adminPendingCount delega en countAwaitingAdmin", async () => {
    mockCountAwaitingAdmin.mockResolvedValue(3);
    const result = await callerAsAdmin(1).adminPendingCount();
    expect(result).toBe(3);
  });

  it("adminList pasa los filtros de estado/waitingFor/búsqueda/paginación tal cual", async () => {
    mockListConversationsForAdmin.mockResolvedValue({ items: [], total: 0 });
    await callerAsAdmin(1).adminList({ status: "open", waitingFor: "admin", search: "ana", limit: 10, offset: 0 });
    expect(mockListConversationsForAdmin).toHaveBeenCalledWith({ status: "open", waitingFor: "admin", search: "ana", limit: 10, offset: 0 });
  });

  it("adminGetConversation delega en getConversationForAdmin", async () => {
    mockGetConversationForAdmin.mockResolvedValue({ conversation: { id: 5 }, messages: [], student: null });
    await callerAsAdmin(1).adminGetConversation({ id: 5 });
    expect(mockGetConversationForAdmin).toHaveBeenCalledWith(5);
  });

  it("conversación inexistente en adminGetConversation: NOT_FOUND", async () => {
    mockGetConversationForAdmin.mockRejectedValue(new StudentMessagesError("NOT_FOUND", "no encontrada"));
    await expect(callerAsAdmin(1).adminGetConversation({ id: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
