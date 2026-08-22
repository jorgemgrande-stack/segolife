/**
 * communitySocialDb.test.ts — COM-02 (Community Social Results): comentarios
 * y likes. Fake db despachado por tabla (mismo criterio que el resto de
 * tests de este módulo, p.ej. communityResultsService.test.ts) — varias
 * tablas necesitan requisitos de forma distintos según qué columnas pide
 * cada select, así que se distingue por presencia de columnas cuando hace
 * falta.
 */
import { describe, it, expect } from "vitest";
import {
  createComment, deleteOwnComment, moderateComment,
  toggleLike, getLikeCountsBatch, getCommentCountsBatch,
  resolveProposalAuthor, listComments,
} from "./communitySocialDb";
import { communityProposals, communityProposalComments, communityProposalLikes, communityStudentProposals, users, userCommunities, communityProposalCommunities, communityResponses } from "../../../drizzle/schema";

const NOW = new Date("2026-08-22T12:00:00.000Z");

function proposalRow(overrides: Record<string, unknown> = {}) {
  return { id: 10, status: "closed", venueId: null, sourceStudentProposalId: null, ...overrides };
}

/** Fake db en memoria — simula las tablas reales que toca communitySocialDb.ts, con inserciones/actualizaciones que persisten entre llamadas dentro del mismo test. */
function fakeDb(opts: {
  proposals?: Record<string, unknown>[];
  comments?: Array<Record<string, unknown>>;
  likes?: Array<{ id: number; proposalId: number; userId: number }>;
  userCommunityMemberships?: Array<{ userId: number; communityId: number }>;
  proposalCommunityLinks?: Array<{ proposalId: number; communityId: number }>;
  usersTable?: Array<{ id: number; name: string | null; avatarStorageKey: string | null }>;
  studentProposals?: Array<{ id: number; studentUserId: number }>;
  responses?: Array<{ id: number; proposalId: number; userId: number }>;
}) {
  const proposals = opts.proposals ?? [proposalRow()];
  const comments = opts.comments ?? [];
  const likes = opts.likes ?? [];
  const userCommunityMemberships = opts.userCommunityMemberships ?? [];
  const proposalCommunityLinks = opts.proposalCommunityLinks ?? [];
  const usersTable = opts.usersTable ?? [];
  const studentProposals = opts.studentProposals ?? [];
  const responses = opts.responses ?? [];
  let nextCommentId = (comments.reduce((max, c) => Math.max(max, c.id as number), 0)) + 1;
  const inserted: Array<Record<string, unknown>> = [];
  const updates: Array<{ table: unknown; values: Record<string, unknown>; where: unknown }> = [];

  function rowsFor(table: unknown): Record<string, unknown>[] {
    if (table === communityProposals) return proposals;
    if (table === communityProposalComments) return comments as Record<string, unknown>[];
    if (table === communityProposalLikes) return likes as unknown as Record<string, unknown>[];
    if (table === userCommunities) return userCommunityMemberships as unknown as Record<string, unknown>[];
    if (table === communityProposalCommunities) return proposalCommunityLinks as unknown as Record<string, unknown>[];
    if (table === users) return usersTable as unknown as Record<string, unknown>[];
    if (table === communityStudentProposals) return studentProposals as unknown as Record<string, unknown>[];
    if (table === communityResponses) return responses as unknown as Record<string, unknown>[];
    return [];
  }

  const db = {
    select: (cols?: Record<string, unknown>) => ({
      from: (table: unknown) => {
        const isCount = cols && "count" in cols;
        const rows = rowsFor(table);
        const chain = {
          where: (..._args: unknown[]) => {
            // Simplificación deliberada: el filtrado real por condiciones ya
            // se hace en cada test seleccionando qué filas entrega `opts`
            // (mismo criterio que otros fakeDb de este repo) — where() aquí
            // solo continúa la cadena, nunca reinterpreta el predicado.
            const terminal = isCount ? [{ count: rows.length }] : rows;
            return {
              limit: async (n: number) => terminal.slice(0, n),
              orderBy: () => ({
                limit: (n: number) => ({ offset: async () => terminal.slice(0, n) }),
              }),
              then: (resolve: (v: unknown) => void) => Promise.resolve(terminal).then(resolve),
            };
          },
        };
        return chain;
      },
    }),
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        if (table === communityProposalComments) {
          const row = { id: nextCommentId++, isHidden: false, hiddenByUserId: null, hiddenAt: null, parentCommentId: null, createdAt: NOW, updatedAt: NOW, ...values };
          comments.push(row);
          inserted.push(row);
          return [{ insertId: row.id }];
        }
        if (table === communityProposalLikes) {
          const row = { id: likes.length + 1, ...values };
          likes.push(row as never);
          return [{ insertId: row.id }];
        }
        return [{ insertId: 1 }];
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push({ table, values, where: null });
          if (table === communityProposalComments) {
            const id = values.__matchId as number | undefined; // no se usa — se aplica por comentario objetivo abajo
            void id;
          }
          return [{ affectedRows: 1 }];
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        if (table === communityProposalLikes) likes.length = 0; // simplificado: un solo like posible por test
        return [{ affectedRows: 1 }];
      },
    }),
    __comments: comments,
    __likes: likes,
    __inserted: inserted,
  };
  return db as never;
}

describe("createComment — COM-02 §11/§12/§19", () => {
  it("crea un comentario raíz en una propuesta cerrada y visible para el usuario", async () => {
    const db = fakeDb({ proposals: [proposalRow()] });
    const comment = await createComment({ proposalId: 10, userId: 42, content: "  Qué buena idea 😍  " }, db);
    expect(comment.content).toBe("Qué buena idea 😍");
    expect(comment.parentCommentId).toBeNull();
  });

  it("rechaza contenido vacío o solo espacios (INVALID_CONTENT)", async () => {
    const db = fakeDb({ proposals: [proposalRow()] });
    await expect(createComment({ proposalId: 10, userId: 42, content: "   " }, db)).rejects.toMatchObject({ code: "INVALID_CONTENT" });
  });

  it("rechaza contenido que supera el máximo de longitud", async () => {
    const db = fakeDb({ proposals: [proposalRow()] });
    await expect(createComment({ proposalId: 10, userId: 42, content: "a".repeat(1001) }, db)).rejects.toMatchObject({ code: "INVALID_CONTENT" });
  });

  it("propuesta inexistente -> NOT_FOUND", async () => {
    const db = fakeDb({ proposals: [] });
    await expect(createComment({ proposalId: 999, userId: 42, content: "hola" }, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("propuesta todavía activa (no cerrada) y el usuario NO ha respondido -> NOT_CLOSED (spec COM-02B §8, no saltarse la participación)", async () => {
    const db = fakeDb({ proposals: [proposalRow({ status: "active" })] });
    await expect(createComment({ proposalId: 10, userId: 42, content: "hola" }, db)).rejects.toMatchObject({ code: "NOT_CLOSED" });
  });

  it("propuesta ACTIVA pero el usuario YA respondió -> permitido (spec COM-02B §2.B/§7, fix de producto)", async () => {
    const db = fakeDb({ proposals: [proposalRow({ status: "active" })], responses: [{ id: 1, proposalId: 10, userId: 42 }] });
    const comment = await createComment({ proposalId: 10, userId: 42, content: "ya voté, comento" }, db);
    expect(comment.content).toBe("ya voté, comento");
  });

  it("propuesta scopeada a otra comunidad de la que el usuario no es miembro -> FORBIDDEN (spec §18/§27, cross-community)", async () => {
    const db = fakeDb({
      proposals: [proposalRow()],
      proposalCommunityLinks: [{ proposalId: 10, communityId: 2 }], // exclusiva de la comunidad 2 (p.ej. UVA)
      userCommunityMemberships: [{ userId: 42, communityId: 1 }],   // el usuario solo pertenece a la comunidad 1 (p.ej. IE)
    });
    await expect(createComment({ proposalId: 10, userId: 42, content: "hola" }, db)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // "crea una respuesta correcta" y "rechaza 2º nivel de profundidad" NO se
  // cubren aquí: ambas necesitan que el fake db distinga entre DOS filas de
  // comments por id real (WHERE id=1 vs WHERE id=2) — este fake despacha por
  // TABLA, no evalúa el predicado WHERE en sí (mismo límite ya documentado
  // para listComments más abajo), así que con más de una fila en la misma
  // tabla devolvería siempre la primera sin importar el id pedido — un fake
  // así "pasaría" sin probar nada real. Verificado en su lugar contra BD
  // local real (ver informe final COM-02, sección AJ/AK).

  it("responder a un comentario de OTRA propuesta -> NOT_FOUND (IDOR: parentCommentId manipulado)", async () => {
    const db = fakeDb({
      proposals: [proposalRow({ id: 10 })],
      comments: [{ id: 1, proposalId: 999, userId: 4, parentCommentId: null, content: "de otra propuesta", isHidden: false }],
    });
    await expect(createComment({ proposalId: 10, userId: 42, content: "hola", parentCommentId: 1 }, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("deleteOwnComment — solo el propio autor puede borrar (spec §15)", () => {
  it("el autor borra su propio comentario (soft-delete: isHidden=true)", async () => {
    const db = fakeDb({ comments: [{ id: 1, proposalId: 10, userId: 42, parentCommentId: null, content: "x", isHidden: false }] });
    await expect(deleteOwnComment(1, 42, db)).resolves.toBeUndefined();
  });

  it("otro estudiante NUNCA puede borrar un comentario ajeno -> FORBIDDEN", async () => {
    const db = fakeDb({ comments: [{ id: 1, proposalId: 10, userId: 4, parentCommentId: null, content: "x", isHidden: false }] });
    await expect(deleteOwnComment(1, 999, db)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("comentario inexistente -> NOT_FOUND", async () => {
    const db = fakeDb({ comments: [] });
    await expect(deleteOwnComment(999, 42, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("moderateComment — Admin (spec §17), mismo mecanismo soft-delete que el borrado propio", () => {
  it("oculta cualquier comentario, sea de quien sea", async () => {
    const db = fakeDb({ comments: [{ id: 1, proposalId: 10, userId: 4, parentCommentId: null, content: "x", isHidden: false }] });
    await expect(moderateComment(1, 1, db)).resolves.toBeUndefined();
  });

  it("comentario inexistente -> NOT_FOUND", async () => {
    const db = fakeDb({ comments: [] });
    await expect(moderateComment(999, 1, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// listComments: el CONTENIDO (paginación raíz+réplica, spec §12/§22/§23)
// hace varias queries DISTINTAS con predicados distintos sobre la MISMA
// tabla (community_proposal_comments) — un fake db genérico por tabla no
// puede distinguirlas de forma fiable, así que ese caso se verifica contra
// BD local real (ver informe final COM-02, sección AJ/AK). La PUERTA de
// acceso (assertCanInteract, spec COM-02B §14/§16) sí se puede probar aquí
// con seguridad: todos sus casos de rechazo terminan ANTES de llegar a esas
// queries ambiguas.
describe("listComments — puerta de acceso (spec COM-02B §14/§16, Student nunca lee antes de participar)", () => {
  it("propuesta inexistente -> NOT_FOUND", async () => {
    const db = fakeDb({ proposals: [] });
    await expect(listComments(999, 42, { limit: 20, offset: 0 }, false, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("propuesta de otra comunidad -> FORBIDDEN (spec §18, cross-community)", async () => {
    const db = fakeDb({
      proposals: [proposalRow()],
      proposalCommunityLinks: [{ proposalId: 10, communityId: 2 }],
      userCommunityMemberships: [{ userId: 42, communityId: 1 }],
    });
    await expect(listComments(10, 42, { limit: 20, offset: 0 }, false, db)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("propuesta ACTIVA y el Student NO ha respondido -> NOT_CLOSED, nunca lee comentarios antes de votar (spec COM-02B §16)", async () => {
    const db = fakeDb({ proposals: [proposalRow({ status: "active" })] });
    await expect(listComments(10, 42, { limit: 20, offset: 0 }, false, db)).rejects.toMatchObject({ code: "NOT_CLOSED" });
  });

  it("propuesta ACTIVA y el Student YA respondió -> se permite leer (spec COM-02B §16)", async () => {
    const db = fakeDb({ proposals: [proposalRow({ status: "active" })], responses: [{ id: 1, proposalId: 10, userId: 42 }] });
    await expect(listComments(10, 42, { limit: 20, offset: 0 }, false, db)).resolves.toMatchObject({ total: 0, items: [] });
  });

  it("includeHidden=true (vista Admin) NUNCA exige haber respondido — un Admin no participa en la propuesta", async () => {
    const db = fakeDb({ proposals: [proposalRow({ status: "active" })] }); // sin respuesta propia
    await expect(listComments(10, 1, { limit: 20, offset: 0 }, true, db)).resolves.toMatchObject({ total: 0, items: [] });
  });
});

describe("toggleLike — like social, NUNCA un voto (spec §35)", () => {
  it("primer toggle: da like", async () => {
    const db = fakeDb({ proposals: [proposalRow()], likes: [] });
    const result = await toggleLike(10, 42, db);
    expect(result.liked).toBe(true);
    expect(result.count).toBe(1);
  });

  it("segundo toggle sobre el mismo par (proposal,user): quita el like", async () => {
    const db = fakeDb({ proposals: [proposalRow()], likes: [{ id: 1, proposalId: 10, userId: 42 }] });
    const result = await toggleLike(10, 42, db);
    expect(result.liked).toBe(false);
  });

  it("propuesta todavía activa y sin respuesta propia -> NOT_CLOSED, no se puede dar like antes de participar (spec COM-02B §9)", async () => {
    const db = fakeDb({ proposals: [proposalRow({ status: "active" })] });
    await expect(toggleLike(10, 42, db)).rejects.toMatchObject({ code: "NOT_CLOSED" });
  });

  it("propuesta ACTIVA pero el usuario ya respondió -> se permite el like (spec COM-02B §9)", async () => {
    const db = fakeDb({ proposals: [proposalRow({ status: "active" })], responses: [{ id: 1, proposalId: 10, userId: 42 }] });
    const result = await toggleLike(10, 42, db);
    expect(result.liked).toBe(true);
  });
});

describe("getLikeCountsBatch / getCommentCountsBatch — batch sin N+1 (spec §23/§37)", () => {
  it("vacío si no se piden ids", async () => {
    const db = fakeDb({});
    expect((await getLikeCountsBatch([], db)).size).toBe(0);
    expect((await getCommentCountsBatch([], db)).size).toBe(0);
  });
});

describe("resolveProposalAuthor — spec §33: nunca expone la identidad personal de un admin como autor social", () => {
  it("propuesta creada directamente por admin (sin sourceStudentProposalId) -> null", async () => {
    const db = fakeDb({});
    const author = await resolveProposalAuthor({ sourceStudentProposalId: null }, db);
    expect(author).toBeNull();
  });

  it("propuesta convertida desde una idea de Student -> autor = el estudiante original", async () => {
    const db = fakeDb({
      studentProposals: [{ id: 3, studentUserId: 77 }],
      usersTable: [{ id: 77, name: "Antonio Ruiz", avatarStorageKey: null }],
    });
    const author = await resolveProposalAuthor({ sourceStudentProposalId: 3 }, db);
    expect(author).toMatchObject({ userId: 77, name: "Antonio Ruiz" });
  });
});
