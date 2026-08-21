/**
 * communityResultsService.test.ts (extensión) — getProposalRespondents /
 * isProposalRespondent: avatar-stack de respondientes (petición del cliente,
 * 2026-08-22). Estas dos funciones NUNCA reautorizan nada por sí mismas —
 * eso vive en community.ts::getPublicRespondents (ver community.test.ts,
 * describe "getPublicRespondents") — aquí solo se prueba la forma de los
 * datos que devuelven, con un fake db que responde según qué columnas pide
 * cada select (mismo criterio de despacho por tabla que el resto del repo,
 * adaptado porque aquí hay 3 shapes de select distintos sobre la misma tabla
 * communityResponses: COUNT, lista paginada de userId, y existencia puntual).
 */
import { describe, it, expect } from "vitest";
import { getProposalRespondents, isProposalRespondent } from "./communityResultsService";
import { communityResponses, users } from "../../../drizzle/schema";

function fakeDb(opts: {
  total?: number;
  responseUserIds?: number[];
  userRows?: Array<{ id: number; name: string | null; avatarStorageKey: string | null }>;
  respondentExists?: boolean;
}) {
  const db = {
    select: (cols: Record<string, unknown>) => ({
      from: (table: unknown) => {
        if (table === communityResponses) {
          if ("count" in cols) {
            // getProposalRespondents: total de respuestas.
            return { where: async () => [{ count: opts.total ?? 0 }] };
          }
          if ("userId" in cols) {
            // getProposalRespondents: página de userIds, orden+límite+offset.
            return {
              where: () => ({
                orderBy: () => ({
                  limit: () => ({
                    offset: async () => (opts.responseUserIds ?? []).map(userId => ({ userId })),
                  }),
                }),
              }),
            };
          }
          if ("id" in cols) {
            // isProposalRespondent: ¿existe una fila para este userId?
            return { where: () => ({ limit: async () => (opts.respondentExists ? [{ id: 1 }] : []) }) };
          }
        }
        if (table === users) {
          return { where: async () => opts.userRows ?? [] };
        }
        return { where: async () => [] };
      },
    }),
  };
  return db as never;
}

describe("getProposalRespondents — avatar-stack (petición del cliente, 2026-08-22)", () => {
  it("total=0: devuelve items vacíos sin consultar users (nadie ha respondido)", async () => {
    const db = fakeDb({ total: 0 });
    const result = await getProposalRespondents(10, { limit: 5, offset: 0 }, db);
    expect(result).toEqual({ total: 0, items: [] });
  });

  it("resuelve name/hasAvatar por userId, en el mismo orden que la página de respuestas", async () => {
    const db = fakeDb({
      total: 3,
      responseUserIds: [4, 5],
      userRows: [
        { id: 4, name: "Ana Gómez", avatarStorageKey: "avatars/4.jpg" },
        { id: 5, name: "Bea Ruiz", avatarStorageKey: null },
      ],
    });
    const result = await getProposalRespondents(10, { limit: 2, offset: 0 }, db);
    expect(result.total).toBe(3);
    expect(result.items).toEqual([
      { userId: 4, name: "Ana Gómez", hasAvatar: true },
      { userId: 5, name: "Bea Ruiz", hasAvatar: false },
    ]);
  });

  it("usuario sin fila en `users` (borrado/corrupto): name=null, hasAvatar=false, nunca lanza", async () => {
    const db = fakeDb({ total: 1, responseUserIds: [999], userRows: [] });
    const result = await getProposalRespondents(10, { limit: 5, offset: 0 }, db);
    expect(result.items).toEqual([{ userId: 999, name: null, hasAvatar: false }]);
  });
});

describe("isProposalRespondent — usado por la ruta de foto para no servir la foto de quien ni siquiera respondió", () => {
  it("true si el userId tiene una respuesta real a esa propuesta", async () => {
    const db = fakeDb({ respondentExists: true });
    expect(await isProposalRespondent(10, 4, db)).toBe(true);
  });

  it("false si no respondió (aunque comparta audiencia con la propuesta)", async () => {
    const db = fakeDb({ respondentExists: false });
    expect(await isProposalRespondent(10, 4, db)).toBe(false);
  });
});
