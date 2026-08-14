/**
 * commandCenterCommunityPulse.test.ts — DAU/WAU/MAU + nuevos + inactivos +
 * completitud de perfil + serie diaria (spec §9). Reutiliza activitySignals
 * — este test verifica la COMPOSICIÓN, no redefine "actividad".
 *
 * El fake `db` usa un nodo "chainable" que acepta cualquier combinación de
 * `.innerJoin()/.where()/.groupBy()` y solo resuelve las filas al final
 * (`.then()`/`.groupBy()`) — necesario porque este archivo encadena
 * `.from(users).innerJoin(studentProfiles)` con y sin `.where()` en distintos
 * puntos. Las filas se sirven de una cola FIFO por tabla, en el mismo orden
 * secuencial real del código (ver comentarios en cada test).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { users } from "../../../drizzle/schema";

const { mockCountActiveStudents, mockDailyActiveStudents, mockLastActivityByStudent } = vi.hoisted(() => ({
  mockCountActiveStudents: vi.fn(),
  mockDailyActiveStudents: vi.fn(),
  mockLastActivityByStudent: vi.fn(),
}));
vi.mock("./activitySignals", () => ({
  countActiveStudents: (...args: unknown[]) => mockCountActiveStudents(...args),
  dailyActiveStudents: (...args: unknown[]) => mockDailyActiveStudents(...args),
  lastActivityByStudent: (...args: unknown[]) => mockLastActivityByStudent(...args),
}));

import { getCommunityPulse } from "./commandCenterCommunityPulse";
import type { DashboardFilterContext } from "./dashboardFilters";

const NOW = new Date("2026-08-14T12:00:00.000Z");
const CTX: DashboardFilterContext = { communityId: null, from: new Date("2026-07-15T00:00:00.000Z"), to: NOW, rangeLabel: "30d" };

function chainable(getRows: () => unknown) {
  const node = {
    innerJoin: (_t?: unknown) => node,
    where: (_c?: unknown) => node,
    groupBy: async () => getRows(),
    then: (resolve: (v: unknown) => void) => Promise.resolve(getRows()).then(resolve),
  };
  return node;
}

/** usersQueue: filas servidas EN ORDEN a cada `.from(users)` sucesivo — newRow, completionRow, [communityUserIds si aplica], allStudentIds. */
function fakeDb(usersQueue: unknown[][]) {
  const queue = [...usersQueue];
  return {
    select: (_cols?: unknown) => ({
      from: (table: unknown) => {
        if (table === users) return chainable(() => queue.shift() ?? []);
        return chainable(() => []);
      },
    }),
  };
}

describe("getCommunityPulse", () => {
  beforeEach(() => {
    mockCountActiveStudents.mockReset();
    mockDailyActiveStudents.mockReset();
    mockLastActivityByStudent.mockReset();
  });

  it("compone dau/wau/mau/newStudents/profileCompletionPct/dailySeries correctamente", async () => {
    mockCountActiveStudents.mockResolvedValueOnce(5).mockResolvedValueOnce(20).mockResolvedValueOnce(45);
    mockLastActivityByStudent.mockResolvedValue(new Map());
    mockDailyActiveStudents.mockResolvedValue([{ date: "2026-08-01", activeCount: 3 }]);
    const db = fakeDb([
      [{ n: 12 }], // newRow
      [{ pct: 0.75 }], // completionRow
      [], // allStudentIds (communityId null -> sin communityUserIds query)
    ]);
    const snapshot = await getCommunityPulse(CTX, db as never);
    expect(snapshot.dau).toBe(5);
    expect(snapshot.wau).toBe(20);
    expect(snapshot.mau).toBe(45);
    expect(snapshot.newStudents).toBe(12);
    expect(snapshot.profileCompletionPct).toBe(75);
    expect(snapshot.dailySeries).toEqual([{ date: "2026-08-01", activeCount: 3 }]);
  });

  it("profileCompletionPct es null sin Students (nunca división engañosa)", async () => {
    mockCountActiveStudents.mockResolvedValue(0);
    mockLastActivityByStudent.mockResolvedValue(new Map());
    mockDailyActiveStudents.mockResolvedValue([]);
    const db = fakeDb([[{ n: 0 }], [{ pct: null }], []]);
    const snapshot = await getCommunityPulse(CTX, db as never);
    expect(snapshot.profileCompletionPct).toBeNull();
  });

  it("inactive7d/inactive30d: bulk-fetch + lookup en Node (nunca una query por Student), umbrales correctos", async () => {
    mockCountActiveStudents.mockResolvedValue(0);
    mockDailyActiveStudents.mockResolvedValue([]);
    mockLastActivityByStudent.mockResolvedValue(new Map([
      [1, new Date("2026-08-13T00:00:00.000Z")], // activo ayer -> ni inactive7d ni inactive30d
      [2, new Date("2026-07-25T00:00:00.000Z")], // hace 20 días -> inactive7d SI, inactive30d NO
      // Student 3: sin entrada en el mapa -> nunca tuvo actividad -> inactive7d Y inactive30d
    ]));
    const db = fakeDb([
      [{ n: 0 }], [{ pct: null }],
      [{ userId: 1 }, { userId: 2 }, { userId: 3 }], // allStudentIds
    ]);
    const snapshot = await getCommunityPulse(CTX, db as never);
    expect(snapshot.inactive7d).toBe(2); // students 2 y 3
    expect(snapshot.inactive30d).toBe(1); // solo student 3
  });

  it("con comunidad filtrada, un Student fuera de la comunidad NUNCA cuenta en inactive7d/30d", async () => {
    mockCountActiveStudents.mockResolvedValue(0);
    mockDailyActiveStudents.mockResolvedValue([]);
    mockLastActivityByStudent.mockResolvedValue(new Map());
    const db = fakeDb([
      [{ n: 0 }], [{ pct: null }],
      [{ userId: 1 }], // communityUserIds -> solo el Student 1 pertenece a la comunidad
      [{ userId: 1 }, { userId: 2 }], // allStudentIds -> Student 2 existe pero NO es de esta comunidad
    ]);
    const snapshot = await getCommunityPulse({ ...CTX, communityId: 3 }, db as never);
    expect(snapshot.inactive7d).toBe(1); // solo el Student 1, nunca el 2
    expect(snapshot.inactive30d).toBe(1);
  });
});
