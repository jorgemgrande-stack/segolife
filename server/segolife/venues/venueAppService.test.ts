/**
 * venueAppService.test.ts — getVenueStudentCard (MG-03: foto de perfil
 * embebida en la Ficha Operativa del Venue App). Cubre específicamente la
 * integración nueva (photoDataUri); el resto de la ficha (wallet/
 * comunidades/beneficios/actividad) ya se prueba indirectamente vía
 * server/routers/venueApp.test.ts (que mockea esta función entera).
 *
 * getVenueStudentCard dispara 7 `conn.select(...)` DIRECTOS dentro de un
 * único Promise.all — su ORDEN DE RESOLUCIÓN no está garantizado, pero la
 * llamada SÍNCRONA a `.select()` sí ocurre en el orden literal del array
 * (antes de que ninguna promesa se resuelva) — así que un contador que
 * incrementa en `.select()` (no en `.then()`) identifica cada consulta de
 * forma fiable, a diferencia de indexar por tabla (aquí event_attendance y
 * user_benefits se consultan CADA UNA dos veces con forma distinta).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetUserCommunitiesWithDetails, mockGetWalletByUserId, mockGetStudentPhotoDataUri } = vi.hoisted(() => ({
  mockGetUserCommunitiesWithDetails: vi.fn(),
  mockGetWalletByUserId: vi.fn(),
  mockGetStudentPhotoDataUri: vi.fn(),
}));

vi.mock("../../db/communitiesDb", () => ({ getUserCommunitiesWithDetails: mockGetUserCommunitiesWithDetails }));
vi.mock("../tokens/tokenLedgerService", () => ({ getWalletByUserId: mockGetWalletByUserId }));
vi.mock("../students/studentPhotoService", () => ({ getStudentPhotoDataUri: mockGetStudentPhotoDataUri }));

import { getVenueStudentCard } from "./venueAppService";

/** Orden real de los 7 `conn.select()` directos dentro del Promise.all de getVenueStudentCard. */
const SELECT_ORDER = ["userRow", "attendanceToday", "visitToday", "benefits", "recentAttendance", "recentVisits", "recentBenefitUses"] as const;

function makeMockDb(results: Partial<Record<(typeof SELECT_ORDER)[number] | "events", unknown[]>>) {
  let selectCallIndex = 0;
  const db: Record<string, unknown> = {
    select: () => {
      const key = SELECT_ORDER[selectCallIndex] ?? "events"; // tras las 7 primeras, cualquier select() adicional es la de `events`
      selectCallIndex++;
      const rows = results[key] ?? [];
      const builder: Record<string, unknown> = {};
      builder.from = () => builder;
      builder.where = () => builder;
      builder.innerJoin = () => builder;
      builder.orderBy = () => builder;
      builder.limit = () => builder;
      builder.then = (resolve: (v: unknown) => void) => resolve(rows);
      return builder;
    },
  };
  return db as unknown as Parameters<typeof getVenueStudentCard>[3];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserCommunitiesWithDetails.mockResolvedValue([]);
  mockGetWalletByUserId.mockResolvedValue({ balance: 0 });
});

describe("getVenueStudentCard — foto de perfil embebida (MG-03)", () => {
  it("Student con foto: photoDataUri llega tal cual desde getStudentPhotoDataUri (misma autorización ya resuelta, sin endpoint nuevo)", async () => {
    mockGetStudentPhotoDataUri.mockResolvedValue("data:image/jpeg;base64,AAAA");
    const db = makeMockDb({ userRow: [{ name: "Ana García" }] });

    const card = await getVenueStudentCard(42, 7, new Date("2026-08-19T20:00:00Z"), db);

    expect(card.photoDataUri).toBe("data:image/jpeg;base64,AAAA");
    expect(mockGetStudentPhotoDataUri).toHaveBeenCalledWith(42);
  });

  it("Student sin foto: photoDataUri es null (fallback a iniciales en el frontend, nunca un placeholder inventado)", async () => {
    mockGetStudentPhotoDataUri.mockResolvedValue(null);
    const db = makeMockDb({ userRow: [{ name: "Ana García" }] });

    const card = await getVenueStudentCard(42, 7, new Date("2026-08-19T20:00:00Z"), db);

    expect(card.photoDataUri).toBeNull();
  });

  it("nunca pasa el venueId al resolver la foto — la foto es del Student, no del venue (misma foto en cualquier venue que lo escanee)", async () => {
    mockGetStudentPhotoDataUri.mockResolvedValue(null);
    const db = makeMockDb({ userRow: [{ name: "Ana García" }] });

    await getVenueStudentCard(42, 999, new Date("2026-08-19T20:00:00Z"), db);

    expect(mockGetStudentPhotoDataUri).toHaveBeenCalledWith(42);
    expect(mockGetStudentPhotoDataUri).not.toHaveBeenCalledWith(42, 999);
  });

  it("resto de la ficha sigue construyéndose con normalidad junto a la foto (no la desplaza ni la rompe)", async () => {
    mockGetStudentPhotoDataUri.mockResolvedValue("data:image/jpeg;base64,BBBB");
    mockGetWalletByUserId.mockResolvedValue({ balance: 250 });
    mockGetUserCommunitiesWithDetails.mockResolvedValue([{ id: 1, name: "Segolife IE", slug: "ie" }]);
    const db = makeMockDb({ userRow: [{ name: "Cristina Battistelli" }] });

    const card = await getVenueStudentCard(42, 7, new Date("2026-08-19T20:00:00Z"), db);

    expect(card.name).toBe("Cristina Battistelli");
    expect(card.walletBalance).toBe(250);
    expect(card.communities).toEqual(["Segolife IE"]);
    expect(card.photoDataUri).toBe("data:image/jpeg;base64,BBBB");
  });
});
