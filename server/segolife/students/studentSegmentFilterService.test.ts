/**
 * studentSegmentFilterService.test.ts — Deep Navigation (Production Polish
 * Gate, spec §10): filtra Students por segmento REAL usando exactamente las
 * mismas reglas/prioridad que computeSegment() (mismos umbrales importados,
 * nunca redefinidos), y devuelve el mismo shape que `listStudents` para que
 * el frontend no necesite dos tablas distintas.
 */
import { describe, it, expect, vi } from "vitest";
import { studentProfiles, users, tokenWallets, userCommunities } from "../../../drizzle/schema";

const { mockLastActivityByStudent, mockActivityCountByStudentSince } = vi.hoisted(() => ({
  mockLastActivityByStudent: vi.fn(),
  mockActivityCountByStudentSince: vi.fn(),
}));
vi.mock("../dashboard/activitySignals", () => ({
  lastActivityByStudent: (...args: unknown[]) => mockLastActivityByStudent(...args),
  activityCountByStudentSince: (...args: unknown[]) => mockActivityCountByStudentSince(...args),
}));

import { listStudentsBySegment } from "./studentSegmentFilterService";

const NOW = new Date("2026-08-14T12:00:00.000Z");

function chainable(getRows: () => unknown) {
  const node = {
    innerJoin: (_t?: unknown) => node,
    leftJoin: (_t?: unknown) => node,
    where: (_c?: unknown) => node,
    then: (resolve: (v: unknown) => void) => Promise.resolve(getRows()).then(resolve),
  };
  return node;
}

function studentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    profile: { id: 100, userId: 1, createdAt: new Date("2026-01-01T00:00:00.000Z"), nationality: null, degreeProgram: null, academicYear: null, status: "active", profileCompleted: true, universityId: null, ...overrides },
    user: { name: "Ana García", email: "ana@example.com", phone: null, avatarUrl: null },
    university: null,
  };
}

/**
 * candidateRows: filas de la query inicial (studentProfiles). spendRows: única
 * llamada real a `db.execute()` en esta función (la query de gasto) — lastActivity
 * y frequency están mockeadas a nivel de módulo (`vi.mock("../dashboard/activitySignals")`)
 * y por tanto NUNCA tocan `db.execute` en este test. wallets/communities: filas de esas dos tablas.
 */
function fakeDb(opts: {
  candidateRows?: unknown[];
  spendRows?: unknown[];
  walletsRows?: unknown[];
  communitiesRows?: unknown[];
}) {
  const executeQueue = [opts.spendRows ?? []];
  return {
    select: (_cols?: unknown) => ({
      from: (table: unknown) => {
        if (table === studentProfiles) return chainable(() => opts.candidateRows ?? []);
        if (table === tokenWallets) return chainable(() => opts.walletsRows ?? []);
        if (table === userCommunities) return chainable(() => opts.communitiesRows ?? []);
        return chainable(() => []);
      },
    }),
    execute: vi.fn(async () => {
      const next = executeQueue.shift() ?? [];
      return [next, []];
    }),
  };
}

describe("listStudentsBySegment", () => {
  it("clasifica y filtra correctamente por segmento (caso 'at_risk')", async () => {
    mockLastActivityByStudent.mockResolvedValue(new Map([[1, new Date("2026-06-30T12:00:00.000Z")]])); // hace 45 días
    mockActivityCountByStudentSince.mockResolvedValue(new Map());
    const db = fakeDb({
      candidateRows: [studentRow({ userId: 1, createdAt: new Date("2026-01-01") })],
      walletsRows: [],
      communitiesRows: [],
    });
    const result = await listStudentsBySegment("at_risk", { communityIds: "all" }, db as never, NOW);
    expect(result.total).toBe(1);
    expect(result.items[0].userId).toBe(1);
  });

  it("un Student que NO pertenece al segmento pedido queda excluido", async () => {
    mockLastActivityByStudent.mockResolvedValue(new Map([[1, new Date("2026-08-13T00:00:00.000Z")]])); // activo ayer
    mockActivityCountByStudentSince.mockResolvedValue(new Map());
    const db = fakeDb({ candidateRows: [studentRow({ userId: 1 })] });
    const result = await listStudentsBySegment("at_risk", { communityIds: "all" }, db as never, NOW);
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("sin candidatos (comunidad/filtros no matchean nada) -> devuelve vacío sin más queries", async () => {
    mockLastActivityByStudent.mockClear();
    const db = fakeDb({ candidateRows: [] });
    const result = await listStudentsBySegment("active", { communityIds: "all" }, db as never, NOW);
    expect(result).toEqual({ items: [], total: 0 });
    expect(mockLastActivityByStudent).not.toHaveBeenCalled();
  });

  it("comunidad vacía ([]) -> devuelve vacío inmediatamente, nunca consulta 'todos'", async () => {
    const db = fakeDb({ candidateRows: [studentRow()] });
    const result = await listStudentsBySegment("active", { communityIds: [] }, db as never, NOW);
    expect(result).toEqual({ items: [], total: 0 });
  });

  it("paginación: total refleja TODOS los que matchean el segmento, items solo la página pedida", async () => {
    mockLastActivityByStudent.mockResolvedValue(new Map([
      [1, new Date("2026-08-13T00:00:00.000Z")], [2, new Date("2026-08-13T00:00:00.000Z")], [3, new Date("2026-08-13T00:00:00.000Z")],
    ]));
    mockActivityCountByStudentSince.mockResolvedValue(new Map());
    const db = fakeDb({
      candidateRows: [
        studentRow({ userId: 1, id: 101 }), studentRow({ userId: 2, id: 102 }), studentRow({ userId: 3, id: 103 }),
      ],
    });
    const result = await listStudentsBySegment("active", { communityIds: "all", limit: 2, offset: 0 }, db as never, NOW);
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(2);
  });

  it("gasto/tokens altos + actividad reciente -> 'high_spend', igual que computeSegment()", async () => {
    mockLastActivityByStudent.mockResolvedValue(new Map([[1, new Date("2026-08-13T00:00:00.000Z")]]));
    mockActivityCountByStudentSince.mockResolvedValue(new Map());
    const db = fakeDb({
      candidateRows: [studentRow({ userId: 1 })],
      spendRows: [{ user_id: 1, total: 25000 }], // 250€ de gasto
    });
    const result = await listStudentsBySegment("high_spend", { communityIds: "all" }, db as never, NOW);
    expect(result.total).toBe(1);
  });

  it("devuelve el MISMO shape que StudentListItem (studentProfileId, tokensBalance, communities…) para reutilizar la tabla del frontend", async () => {
    mockLastActivityByStudent.mockResolvedValue(new Map([[1, new Date("2026-08-13T00:00:00.000Z")]]));
    mockActivityCountByStudentSince.mockResolvedValue(new Map());
    const db = fakeDb({
      candidateRows: [studentRow({ userId: 1, id: 555 })],
      walletsRows: [{ userId: 1, balance: 300, lifetimeEarned: 50 }],
      communitiesRows: [{ userId: 1, community: { id: 3, name: "Segolife IE", slug: "ie" } }],
    });
    const result = await listStudentsBySegment("active", { communityIds: "all" }, db as never, NOW);
    expect(result.items[0]).toMatchObject({
      studentProfileId: 555, userId: 1, tokensBalance: 300,
      communities: [{ id: 3, name: "Segolife IE", slug: "ie" }],
    });
  });
});
