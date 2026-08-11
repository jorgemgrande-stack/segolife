/**
 * registrationService.test.ts — unitarios con DB mockeada (mismo patrón que
 * server/db/communitiesDb.test.ts y server/segolife/ticketing/salesModeService.test.ts —
 * este repo no mantiene una suite de integración contra MySQL real, ver
 * comentario de cabecera de communitiesDb.test.ts).
 *
 * La restricción UNIQUE(email) real en MySQL (drizzle/0140_users_email_unique.sql)
 * se verificó EMPÍRICAMENTE contra el segolife_db local durante esta feature:
 * re-aplicar la migración falla limpio (ER_DUP_ENTRY sobre el nombre del
 * índice, sin corromper nada) y un INSERT con el mismo email en distinta
 * capitalización (collation utf8mb4_0900_ai_ci, case-insensitive) choca con
 * ER_DUP_ENTRY 1062 tal y como asume el test "carrera real" de abajo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetCommunityBySlug, mockAddUserToCommunity, mockEnsureStudentProfile, mockUpdateStudentProfile, mockUpdatePreference } = vi.hoisted(() => ({
  mockGetCommunityBySlug: vi.fn(),
  mockAddUserToCommunity: vi.fn(),
  mockEnsureStudentProfile: vi.fn(),
  mockUpdateStudentProfile: vi.fn(),
  mockUpdatePreference: vi.fn(),
}));

vi.mock("../../db/communitiesDb", () => ({
  getCommunityBySlug: mockGetCommunityBySlug,
  addUserToCommunity: mockAddUserToCommunity,
}));
vi.mock("../../db/studentsDb", () => ({
  ensureStudentProfile: mockEnsureStudentProfile,
  updateStudentProfile: mockUpdateStudentProfile,
}));
vi.mock("../engagement/notificationPreferencesService", () => ({
  updatePreference: mockUpdatePreference,
}));

import { registerStudent, RegistrationError } from "./registrationService";

const ACTIVE_COMMUNITY = { id: 1, slug: "ie", name: "IE University", status: "active" as const };

function makeMockDb({ existingUserRow = null as unknown, insertError = null as unknown, insertId = 42 } = {}) {
  const tx = {
    insert: () => ({
      values: async () => {
        if (insertError) throw insertError;
        return [{ insertId }];
      },
    }),
  };
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (existingUserRow ? [existingUserRow] : []),
        }),
      }),
    }),
    transaction: async (cb: (tx: unknown) => Promise<number>) => cb(tx),
  };
}

const VALID_INPUT = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "Ada.Lovelace@Example.com",
  password: "supersecret123",
  communitySlug: "ie",
  marketingConsent: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCommunityBySlug.mockResolvedValue(ACTIVE_COMMUNITY);
  mockEnsureStudentProfile.mockResolvedValue({});
  mockUpdateStudentProfile.mockResolvedValue({});
  mockAddUserToCommunity.mockResolvedValue(undefined);
  mockUpdatePreference.mockResolvedValue(undefined);
});

describe("registerStudent — caso exitoso", () => {
  it("crea el user + perfil + comunidad + preferencia en una única transacción y normaliza el email", async () => {
    const db = makeMockDb({ insertId: 77 }) as any;
    const result = await registerStudent(VALID_INPUT, db);

    expect(result).toEqual({
      userId: 77,
      name: "Ada Lovelace",
      email: "ada.lovelace@example.com",
      role: "user",
      communitySlug: "ie",
    });
    expect(mockEnsureStudentProfile).toHaveBeenCalledWith(77, expect.anything());
    expect(mockUpdateStudentProfile).toHaveBeenCalledWith(77, { firstName: "Ada", lastName: "Lovelace" }, expect.anything());
    expect(mockAddUserToCommunity).toHaveBeenCalledWith(77, ACTIVE_COMMUNITY.id, undefined, expect.anything());
    expect(mockUpdatePreference).toHaveBeenCalledWith(
      { userId: 77, category: "promotions", channel: "email", enabled: false },
      expect.anything()
    );
  });

  it("respeta marketingConsent=true y añade academicYear cuando se envía", async () => {
    const db = makeMockDb({ insertId: 5 }) as any;
    await registerStudent({ ...VALID_INPUT, marketingConsent: true, academicYear: "2" }, db);

    expect(mockUpdatePreference).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
      expect.anything()
    );
    expect(mockUpdateStudentProfile).toHaveBeenCalledWith(5, { firstName: "Ada", lastName: "Lovelace", academicYear: "2" }, expect.anything());
  });
});

describe("registerStudent — validación", () => {
  it("email duplicado (comprobación de aplicación) → EMAIL_EXISTS, nunca abre transacción", async () => {
    const db = makeMockDb({ existingUserRow: { id: 1 } }) as any;
    await expect(registerStudent(VALID_INPUT, db)).rejects.toMatchObject({ code: "EMAIL_EXISTS" });
    expect(mockEnsureStudentProfile).not.toHaveBeenCalled();
  });

  it("carrera real: el INSERT choca con ER_DUP_ENTRY (errno 1062 directo) → se traduce a EMAIL_EXISTS, nunca un error crudo", async () => {
    const db = makeMockDb({ insertError: Object.assign(new Error("dup"), { errno: 1062 }) }) as any;
    await expect(registerStudent(VALID_INPUT, db)).rejects.toMatchObject({ code: "EMAIL_EXISTS" });
  });

  it("carrera real dentro de una transacción: drizzle-orm envuelve el error de mysql2 en .cause (DrizzleQueryError) → sigue traduciéndose a EMAIL_EXISTS, nunca un 500 (bug real detectado y corregido durante la QA de esta feature — ver registrationService.ts)", async () => {
    const wrapped = Object.assign(new Error("Failed query"), {
      cause: Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY", errno: 1062 }),
    });
    const db = makeMockDb({ insertError: wrapped }) as any;
    await expect(registerStudent(VALID_INPUT, db)).rejects.toMatchObject({ code: "EMAIL_EXISTS" });
  });

  it("otro error de INSERT (no 1062) se propaga tal cual, no se enmascara como EMAIL_EXISTS", async () => {
    const db = makeMockDb({ insertError: new Error("connection lost") }) as any;
    await expect(registerStudent(VALID_INPUT, db)).rejects.toThrow("connection lost");
  });

  it("comunidad inexistente → COMMUNITY_NOT_FOUND", async () => {
    mockGetCommunityBySlug.mockResolvedValue(null);
    const db = makeMockDb() as any;
    await expect(registerStudent(VALID_INPUT, db)).rejects.toMatchObject({ code: "COMMUNITY_NOT_FOUND" });
  });

  it("comunidad inactiva/onboarding → COMMUNITY_NOT_FOUND (nunca confía en el estado enviado por el cliente)", async () => {
    mockGetCommunityBySlug.mockResolvedValue({ ...ACTIVE_COMMUNITY, status: "onboarding" });
    const db = makeMockDb() as any;
    await expect(registerStudent(VALID_INPUT, db)).rejects.toMatchObject({ code: "COMMUNITY_NOT_FOUND" });
  });

  it("contraseña demasiado corta → WEAK_PASSWORD, ni siquiera consulta la comunidad", async () => {
    const db = makeMockDb() as any;
    await expect(registerStudent({ ...VALID_INPUT, password: "1234567" }, db)).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    expect(mockGetCommunityBySlug).not.toHaveBeenCalled();
  });

  it("email con formato inválido → INVALID_EMAIL", async () => {
    const db = makeMockDb() as any;
    await expect(registerStudent({ ...VALID_INPUT, email: "no-es-un-email" }, db)).rejects.toMatchObject({ code: "INVALID_EMAIL" });
  });

  it("nombre/apellidos en blanco → INVALID_EMAIL (validación conjunta de identidad)", async () => {
    const db = makeMockDb() as any;
    await expect(registerStudent({ ...VALID_INPUT, firstName: "   " }, db)).rejects.toBeInstanceOf(RegistrationError);
  });
});
