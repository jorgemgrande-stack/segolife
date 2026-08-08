/**
 * audienceEngine.test.ts — intersección AND entre filtros y la regla de
 * seguridad "sin filtros = sin audiencia" (spec puntos 18-22). Mismo patrón
 * de mock que benefitGrantService.test.ts: el mock devuelve filas
 * pre-filtradas por tabla (`.from(TABLE)`) — no valida el SQL en sí (eso lo
 * cubre la migración real contra MySQL 9.4), solo la lógica propia del
 * servicio (combinar Sets, deduplicar, no inventar audiencia).
 */
import { describe, it, expect } from "vitest";
import { resolveAudience, previewAudienceCount } from "./audienceEngine";
import { userCommunities, tokenWallets, studentTagAssignments } from "../../../drizzle/schema";

function makeMockDb(rowsByTable: Map<unknown, Array<Record<string, unknown>>>) {
  let currentTable: unknown;
  const b: any = {};
  b.select = () => b;
  b.from = (t: unknown) => { currentTable = t; return b; };
  b.innerJoin = () => b;
  b.where = () => Promise.resolve(rowsByTable.get(currentTable) ?? []);
  return b;
}

describe("audienceEngine — resolveAudience", () => {
  it("sin ningún filtro devuelve [] — nunca 'todos los usuarios' por accidente", async () => {
    const db = makeMockDb(new Map());
    expect(await resolveAudience({}, db)).toEqual([]);
  });

  it("un único filtro devuelve exactamente esos userIds, sin duplicados", async () => {
    const db = makeMockDb(new Map([[userCommunities, [{ userId: 1 }, { userId: 2 }, { userId: 1 }]]]));
    const ids = await resolveAudience({ communityIds: [1] }, db);
    expect([...ids].sort()).toEqual([1, 2]);
  });

  it("dos filtros se combinan con AND (intersección), nunca OR", async () => {
    const db = makeMockDb(new Map([
      [userCommunities, [{ userId: 1 }, { userId: 2 }, { userId: 3 }]],
      [tokenWallets, [{ userId: 2 }, { userId: 3 }, { userId: 4 }]],
    ]));
    const ids = await resolveAudience({ communityIds: [1], tokensBalanceMin: 100 }, db);
    expect(ids.sort()).toEqual([2, 3]);
  });

  it("tres filtros exigen coincidencia en los tres a la vez", async () => {
    const db = makeMockDb(new Map([
      [userCommunities, [{ userId: 1 }, { userId: 2 }, { userId: 3 }]],
      [tokenWallets, [{ userId: 2 }, { userId: 3 }]],
      [studentTagAssignments, [{ userId: 3 }]],
    ]));
    const ids = await resolveAudience({ communityIds: [1], tokensBalanceMin: 100, tagIds: [5] }, db);
    expect(ids).toEqual([3]);
  });

  it("si un filtro no encuentra a nadie, la intersección queda vacía (no ignora ese filtro)", async () => {
    const db = makeMockDb(new Map([
      [userCommunities, [{ userId: 1 }, { userId: 2 }]],
      [tokenWallets, []],
    ]));
    const ids = await resolveAudience({ communityIds: [1], tokensBalanceMin: 999999 }, db);
    expect(ids).toEqual([]);
  });
});

describe("audienceEngine — previewAudienceCount", () => {
  it("devuelve solo el conteo, no la lista de userIds (nunca PII masiva)", async () => {
    const db = makeMockDb(new Map([[userCommunities, [{ userId: 1 }, { userId: 2 }, { userId: 3 }]]]));
    expect(await previewAudienceCount({ communityIds: [1] }, db)).toBe(3);
  });

  it("sin filtros el conteo es 0, no el total de usuarios", async () => {
    const db = makeMockDb(new Map());
    expect(await previewAudienceCount({}, db)).toBe(0);
  });
});
