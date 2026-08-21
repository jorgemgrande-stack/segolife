/**
 * lostFound.test.ts — LNF-01. Mismo criterio que studentMessages.test.ts:
 * se mockean las dependencias de BD/notificación para probar RBAC/IDOR/
 * delegación del router de forma barata y determinista, sin BD real. La
 * lógica de negocio real (atomicidad, estados, alcance por venue) vive en
 * lostFoundDb.test.ts — no se reimplementa aquí.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetLostFoundReportForStudent, mockListLostFoundReportsForStudent,
  mockGetLostFoundReportForAdmin, mockListLostFoundReportsForAdmin,
  mockGetLostFoundReportVenueId, mockMarkFound, mockMarkClosedNotFound, mockReopenReport,
  mockListCaseActions, mockCountPendingForAdmin, mockGetVenueStaffAccess, mockRequireVenueAccess,
  mockReplyAsAdmin, mockGetConversationForAdmin, mockCloseConversation, mockReopenConversation, mockMarkReadByAdmin,
  mockNotifyStudentNewMessage,
} = vi.hoisted(() => ({
  mockGetLostFoundReportForStudent: vi.fn(),
  mockListLostFoundReportsForStudent: vi.fn(),
  mockGetLostFoundReportForAdmin: vi.fn(),
  mockListLostFoundReportsForAdmin: vi.fn(),
  mockGetLostFoundReportVenueId: vi.fn(),
  mockMarkFound: vi.fn(),
  mockMarkClosedNotFound: vi.fn(),
  mockReopenReport: vi.fn(),
  mockListCaseActions: vi.fn(),
  mockCountPendingForAdmin: vi.fn(),
  mockGetVenueStaffAccess: vi.fn(),
  mockRequireVenueAccess: vi.fn(),
  mockReplyAsAdmin: vi.fn(),
  mockGetConversationForAdmin: vi.fn(),
  mockCloseConversation: vi.fn(),
  mockReopenConversation: vi.fn(),
  mockMarkReadByAdmin: vi.fn(),
  mockNotifyStudentNewMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../segolife/lostFound/lostFoundDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/lostFound/lostFoundDb")>();
  return {
    ...actual,
    getLostFoundReportForStudent: mockGetLostFoundReportForStudent,
    listLostFoundReportsForStudent: mockListLostFoundReportsForStudent,
    getLostFoundReportForAdmin: mockGetLostFoundReportForAdmin,
    listLostFoundReportsForAdmin: mockListLostFoundReportsForAdmin,
    getLostFoundReportVenueId: mockGetLostFoundReportVenueId,
    markFound: mockMarkFound,
    markClosedNotFound: mockMarkClosedNotFound,
    reopenReport: mockReopenReport,
    listCaseActions: mockListCaseActions,
    countPendingForAdmin: mockCountPendingForAdmin,
  };
});
vi.mock("../segolife/benefits/venueStaffAccess", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/benefits/venueStaffAccess")>();
  return { ...actual, getVenueStaffAccess: mockGetVenueStaffAccess, requireVenueAccess: mockRequireVenueAccess };
});
vi.mock("../segolife/messaging/studentMessagesDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/messaging/studentMessagesDb")>();
  return {
    ...actual,
    replyAsAdmin: mockReplyAsAdmin,
    getConversationForAdmin: mockGetConversationForAdmin,
    closeConversation: mockCloseConversation,
    reopenConversation: mockReopenConversation,
    markReadByAdmin: mockMarkReadByAdmin,
  };
});
vi.mock("./studentMessages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./studentMessages")>();
  return { ...actual, notifyStudentNewMessage: mockNotifyStudentNewMessage };
});

import { TRPCError } from "@trpc/server";
import { lostFoundRouter } from "./lostFound";
import { LostFoundError } from "../segolife/lostFound/lostFoundDb";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return lostFoundRouter.createCaller({ user: null } as any);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAs(id: number, role: string) {
  return lostFoundRouter.createCaller({ user: { id, role } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireVenueAccess.mockResolvedValue(undefined); // por defecto: acceso concedido, cada test lo sobreescribe si necesita lo contrario
});

describe("lostFound — ningún procedure es accesible sin sesión", () => {
  it("Student y Admin procedures rechazan sin sesión", async () => {
    await expect(callerWithoutSession().myReports()).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().myReport({ id: 1 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().adminList({})).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().adminGet({ id: 1 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().adminMarkFound({ reportId: 1, resolutionNote: "x" })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().adminMarkClosedNotFound({ reportId: 1, resolutionNote: "x" })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().adminReopen({ reportId: 1, reason: "x" })).rejects.toThrow(/please login/i);
  });
});

describe("lostFound — RBAC: un Student (role=user) nunca accede a los procedures Admin", () => {
  it("adminList/adminGet/adminMarkFound/adminMarkClosedNotFound/adminReopen: FORBIDDEN para un Student", async () => {
    await expect(callerAs(7, "user").adminList({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs(7, "user").adminGet({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs(7, "user").adminMarkFound({ reportId: 1, resolutionNote: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs(7, "user").adminMarkClosedNotFound({ reportId: 1, resolutionNote: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs(7, "user").adminReopen({ reportId: 1, reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockMarkFound).not.toHaveBeenCalled();
  });
});

describe("lostFound — Student: self-scoped SIEMPRE por ctx.user.id (IDOR)", () => {
  it("myReports/myReport pasan ctx.user.id, nunca un id recibido del cliente", async () => {
    mockListLostFoundReportsForStudent.mockResolvedValue({ items: [], total: 0 });
    await callerAs(7, "user").myReports();
    expect(mockListLostFoundReportsForStudent).toHaveBeenCalledWith(7, {});

    mockGetLostFoundReportForStudent.mockResolvedValue({ id: 1, studentUserId: 7 });
    await callerAs(7, "user").myReport({ id: 1 });
    expect(mockGetLostFoundReportForStudent).toHaveBeenCalledWith(1, 7);
  });

  it("REGRESIÓN IDOR — caso ajeno/inexistente: NOT_FOUND (nunca FORBIDDEN, no confirma su existencia)", async () => {
    mockGetLostFoundReportForStudent.mockRejectedValue(new LostFoundError("NOT_FOUND", "Objeto perdido no encontrado"));
    await expect(callerAs(7, "user").myReport({ id: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("lostFound — alcance por venue (spec §14/§25, IDOR CRÍTICO)", () => {
  // NOTA: sin BD real, permissionProcedure("lost_found.view"/"lost_found.process")
  // rechaza a `venue_admin` en la propia puerta RBAC (su fallback legacy es
  // ["admin"] — un venue_admin real solo pasa vía una fila RBAC real, que
  // este entorno mockeado no simula). Estos tests actúan como `admin` para
  // ejercitar la lógica de alcance INTERNA (requireVenueAccess/
  // getVenueStaffAccess, la misma para cualquier rol que llegue al
  // handler); que un venue_admin real SÍ llega hasta aquí en producción lo
  // garantiza venueAdminPolicy.test.ts (bundle) + la verificación E2E.
  it("sin acceso al venue del caso (requireVenueAccess rechaza): FORBIDDEN, nunca llega a leer el caso", async () => {
    mockGetLostFoundReportVenueId.mockResolvedValue(42);
    mockRequireVenueAccess.mockRejectedValue(new TRPCError({ code: "FORBIDDEN", message: "Sin acceso a este venue" }));
    await expect(callerAs(9, "admin").adminGet({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockGetLostFoundReportForAdmin).not.toHaveBeenCalled();
  });

  it("con acceso al venue del caso: opera con normalidad, revalidando el venueId REAL del caso (nunca el del input)", async () => {
    mockGetLostFoundReportVenueId.mockResolvedValue(42);
    mockRequireVenueAccess.mockResolvedValue(undefined);
    mockGetLostFoundReportForAdmin.mockResolvedValue({ report: { id: 1, venueId: 42, conversationId: 5 }, venueName: "Venue", communityName: null, student: { id: 7, name: "QA", email: "qa@test", phone: null } });
    mockListCaseActions.mockResolvedValue([]);
    const result = await callerAs(9, "admin").adminGet({ id: 1 });
    expect(result.report.id).toBe(1);
    expect(mockRequireVenueAccess).toHaveBeenCalledWith(9, "admin", 42, "lost_found.manage");
  });

  it("caso inexistente: NOT_FOUND antes incluso de comprobar el venue", async () => {
    mockGetLostFoundReportVenueId.mockResolvedValue(null);
    await expect(callerAs(1, "admin").adminGet({ id: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockRequireVenueAccess).not.toHaveBeenCalled();
  });

  it("adminList: venueId de input SIEMPRE se cruza con el alcance real, nunca se confía en el filtro del cliente", async () => {
    mockGetVenueStaffAccess.mockResolvedValue([42]); // actor acotado al venue 42
    mockListLostFoundReportsForAdmin.mockResolvedValue({ items: [], total: 0 });
    await callerAs(9, "admin").adminList({ venueId: 99 }); // intenta pedir el venue 99, ajeno
    expect(mockListLostFoundReportsForAdmin).toHaveBeenCalledWith(expect.objectContaining({ venueIds: [] })); // 99 no está en [42] -> queda vacío, nunca "todos"
  });

  it("adminList: admin global (access='all') respeta el venueId pedido si lo hay", async () => {
    mockGetVenueStaffAccess.mockResolvedValue("all");
    mockListLostFoundReportsForAdmin.mockResolvedValue({ items: [], total: 0 });
    await callerAs(1, "admin").adminList({ venueId: 42 });
    expect(mockListLostFoundReportsForAdmin).toHaveBeenCalledWith(expect.objectContaining({ venueIds: [42] }));
  });
});

describe("lostFound — adminPendingCount (badge de nav, spec §13/§14)", () => {
  it("resuelve el alcance real del actor y delega en countPendingForAdmin — nunca confía en un venueId de input (no lo recibe siquiera)", async () => {
    mockGetVenueStaffAccess.mockResolvedValue([42]);
    mockCountPendingForAdmin.mockResolvedValue(3);
    const result = await callerAs(9, "admin").adminPendingCount();
    expect(result).toBe(3);
    expect(mockGetVenueStaffAccess).toHaveBeenCalledWith(9, "admin", undefined, "lost_found.manage");
    expect(mockCountPendingForAdmin).toHaveBeenCalledWith([42]);
  });

  it("admin global (access='all'): cuenta sin restringir por venue", async () => {
    mockGetVenueStaffAccess.mockResolvedValue("all");
    mockCountPendingForAdmin.mockResolvedValue(11);
    const result = await callerAs(1, "admin").adminPendingCount();
    expect(result).toBe(11);
    expect(mockCountPendingForAdmin).toHaveBeenCalledWith("all");
  });

  it("un Student nunca accede a este procedure", async () => {
    await expect(callerAs(7, "user").adminPendingCount()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockCountPendingForAdmin).not.toHaveBeenCalled();
  });
});

describe("lostFound — transiciones de estado", () => {
  it("adminMarkFound: delega, envía el mensaje de resolución y notifica al Student", async () => {
    mockGetLostFoundReportVenueId.mockResolvedValue(42);
    mockMarkFound.mockResolvedValue({ id: 1, status: "found", conversationId: 5 });
    mockReplyAsAdmin.mockResolvedValue({ conversation: { id: 5, studentUserId: 7, subject: "s" }, message: { id: 2 } });
    const result = await callerAs(1, "admin").adminMarkFound({ reportId: 1, resolutionNote: "Encontrado en barra." });
    expect(result.status).toBe("found");
    expect(mockMarkFound).toHaveBeenCalledWith(1, 1, "Encontrado en barra.");
    expect(mockReplyAsAdmin).toHaveBeenCalledWith({ conversationId: 5, adminUserId: 1, body: "Encontrado en barra.", visibility: "public" });
    expect(mockNotifyStudentNewMessage).toHaveBeenCalledWith(7, 5, "s");
  });

  it("si el envío del mensaje de resolución falla, la transición de estado YA confirmada NUNCA se deshace (best-effort)", async () => {
    mockGetLostFoundReportVenueId.mockResolvedValue(42);
    mockMarkFound.mockResolvedValue({ id: 1, status: "found", conversationId: 5 });
    mockReplyAsAdmin.mockRejectedValue(new Error("boom"));
    const result = await callerAs(1, "admin").adminMarkFound({ reportId: 1, resolutionNote: "x" });
    expect(result.status).toBe("found");
  });

  it("transición inválida (spec §6): CONFLICT, nunca un 500 crudo", async () => {
    mockGetLostFoundReportVenueId.mockResolvedValue(42);
    mockMarkClosedNotFound.mockRejectedValue(new LostFoundError("INVALID_TRANSITION", 'No se puede pasar de "found" a "closed_not_found"'));
    await expect(callerAs(1, "admin").adminMarkClosedNotFound({ reportId: 1, resolutionNote: "x" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("adminReopen delega con motivo y actorUserId reales", async () => {
    mockGetLostFoundReportVenueId.mockResolvedValue(42);
    mockReopenReport.mockResolvedValue({ id: 1, status: "open" });
    await callerAs(1, "admin").adminReopen({ reportId: 1, reason: "Se aportaron más datos." });
    expect(mockReopenReport).toHaveBeenCalledWith(1, 1, "Se aportaron más datos.");
  });
});

describe("lostFound — comunicación del caso (envoltorio COM-01)", () => {
  it("adminReplyToConversation: sin conversación todavía, NOT_FOUND claro", async () => {
    mockGetLostFoundReportVenueId.mockResolvedValue(42);
    mockGetLostFoundReportForAdmin.mockResolvedValue({ report: { id: 1, conversationId: null }, venueName: null, communityName: null, student: { id: 7, name: null, email: null, phone: null } });
    await expect(callerAs(1, "admin").adminReplyToConversation({ reportId: 1, body: "hola" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockReplyAsAdmin).not.toHaveBeenCalled();
  });

  it("adminReplyToConversation: delega en replyAsAdmin y notifica", async () => {
    mockGetLostFoundReportVenueId.mockResolvedValue(42);
    mockGetLostFoundReportForAdmin.mockResolvedValue({ report: { id: 1, conversationId: 5 }, venueName: null, communityName: null, student: { id: 7, name: null, email: null, phone: null } });
    mockReplyAsAdmin.mockResolvedValue({ conversation: { id: 5, studentUserId: 7, subject: "s" }, message: { id: 3 } });
    await callerAs(1, "admin").adminReplyToConversation({ reportId: 1, body: "Hemos encontrado tus llaves." });
    expect(mockReplyAsAdmin).toHaveBeenCalledWith({ conversationId: 5, adminUserId: 1, body: "Hemos encontrado tus llaves.", visibility: "public" });
    expect(mockNotifyStudentNewMessage).toHaveBeenCalledWith(7, 5, "s");
  });

  it("venue_admin sin acceso al venue del caso: FORBIDDEN antes de tocar la conversación", async () => {
    mockGetLostFoundReportVenueId.mockResolvedValue(42);
    mockRequireVenueAccess.mockRejectedValue(new TRPCError({ code: "FORBIDDEN", message: "Sin acceso a este venue" }));
    await expect(callerAs(9, "venue_admin").adminReplyToConversation({ reportId: 1, body: "hola" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockGetLostFoundReportForAdmin).not.toHaveBeenCalled();
  });
});
