/**
 * legalAcceptancesDb.test.ts — unitarios con DB mockeada (mismo patrón que
 * registrationService.test.ts/communitiesDb.test.ts, ver cabecera de ambos:
 * este repo no mantiene una suite de integración contra MySQL real).
 *
 * El dedup "última aceptación por documentType" ocurre en JS, no en SQL —
 * por eso el fake db solo necesita devolver filas ya ordenadas por
 * acceptedAt DESC (como haría MySQL real ante ORDER BY), sin interpretar el
 * WHERE/ORDER BY reales.
 */
import { describe, it, expect } from "vitest";
import { recordLegalAcceptance, getLatestLegalAcceptances, getLatestLegalAcceptancesBatch } from "./legalAcceptancesDb";

function makeFakeDb({ selectRows = [] as any[] } = {}) {
  const inserted: any[] = [];
  const db = {
    insert: () => ({
      values: async (vals: any) => { inserted.push(vals); },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => selectRows,
        }),
      }),
    }),
  };
  return { db, inserted };
}

describe("recordLegalAcceptance", () => {
  it("inserta una fila con userId/documentType/documentVersion exactos, nunca sobrescribe nada existente", async () => {
    const { db, inserted } = makeFakeDb();
    await recordLegalAcceptance({ userId: 7, documentType: "terms", documentVersion: "terminos_v1_2026-08-23" }, db as any);
    expect(inserted).toEqual([{ userId: 7, documentType: "terms", documentVersion: "terminos_v1_2026-08-23" }]);
  });
});

describe("getLatestLegalAcceptances", () => {
  it("sin ninguna fila (usuario anterior a esta fase, spec punto 24): mapa vacío, nunca asume aceptación", async () => {
    const { db } = makeFakeDb({ selectRows: [] });
    const result = await getLatestLegalAcceptances(7, db as any);
    expect(result.size).toBe(0);
  });

  it("con varias aceptaciones históricas del mismo documento, se queda con la MÁS RECIENTE (primera de la lista ordenada DESC)", async () => {
    const { db } = makeFakeDb({
      selectRows: [
        { documentType: "terms", documentVersion: "terminos_v2_2026-09-10", acceptedAt: new Date("2026-09-10") },
        { documentType: "terms", documentVersion: "terminos_v1_2026-08-23", acceptedAt: new Date("2026-08-23") },
        { documentType: "privacy", documentVersion: "privacidad_v1_2026-08-23", acceptedAt: new Date("2026-08-23") },
      ],
    });
    const result = await getLatestLegalAcceptances(7, db as any);
    expect(result.get("terms")).toEqual({ version: "terminos_v2_2026-09-10", acceptedAt: new Date("2026-09-10") });
    expect(result.get("privacy")).toEqual({ version: "privacidad_v1_2026-08-23", acceptedAt: new Date("2026-08-23") });
  });
});

describe("getLatestLegalAcceptancesBatch", () => {
  it("lista de userIds vacía: mapa vacío, sin llamar a la base de datos", async () => {
    const { db } = makeFakeDb({ selectRows: [{ userId: 1, documentType: "terms", documentVersion: "x", acceptedAt: new Date() }] });
    const result = await getLatestLegalAcceptancesBatch([], db as any);
    expect(result.size).toBe(0);
  });

  it("agrupa correctamente por usuario y se queda con la más reciente por (usuario, documento)", async () => {
    const { db } = makeFakeDb({
      selectRows: [
        { userId: 1, documentType: "terms", documentVersion: "terminos_v2", acceptedAt: new Date("2026-09-10") },
        { userId: 1, documentType: "terms", documentVersion: "terminos_v1", acceptedAt: new Date("2026-08-23") },
        { userId: 2, documentType: "privacy", documentVersion: "privacidad_v1", acceptedAt: new Date("2026-08-23") },
      ],
    });
    const result = await getLatestLegalAcceptancesBatch([1, 2], db as any);
    expect(result.get(1)?.get("terms")).toEqual({ version: "terminos_v2", acceptedAt: new Date("2026-09-10") });
    expect(result.get(2)?.get("privacy")).toEqual({ version: "privacidad_v1", acceptedAt: new Date("2026-08-23") });
    expect(result.get(2)?.has("terms")).toBe(false);
  });
});
