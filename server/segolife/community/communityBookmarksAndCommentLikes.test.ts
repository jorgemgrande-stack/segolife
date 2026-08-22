/**
 * communityBookmarksAndCommentLikes.test.ts — F68 (Community Engagement
 * avanzado): bookmarks (guardar para más tarde) y likes de comentario.
 * Archivo SEPARADO de communitySocialDb.test.ts a propósito: ese archivo
 * usa un fakeDb que despacha por TABLA sin evaluar el WHERE real (documentado
 * ahí mismo como límite deliberado) — insuficiente para un toggle real
 * (existe/no existe por userId concreto).
 *
 * toggleBookmark/getBookmarkState (select/insert/delete simples, una sola
 * tabla) usan el helper genérico createMockDb (mismo criterio que
 * cashSessionService.test.ts). listMyBookmarkedProposals (JOIN+proyección) y
 * los conteos de comment-like (SELECT COUNT(*)/GROUP BY) exceden lo que ese
 * helper genérico soporta hoy — createMockDb no interpreta joins ni
 * agregados — así que esos dos casos usan un builder propio de este archivo
 * que sí resuelve join/COUNT/GROUP BY reutilizando evalCond() directamente.
 */
import { describe, it, expect, vi } from "vitest";
import { drizzleConditionMockFactory, MockTable, createMockDb, evalCond, type MockCond } from "../_testHelpers/drizzleTableMock";

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, ...drizzleConditionMockFactory() };
});

import {
  communityProposals, communityProposalBookmarks, communityCommentLikes,
  communityProposalComments, venues, userCommunities, communityProposalCommunities, communityResponses,
} from "../../../drizzle/schema";
import {
  toggleBookmark, getBookmarkState, listMyBookmarkedProposals,
  toggleCommentLike, getCommentLikeCountsBatch, getMyCommentLikesBatch,
  CommunitySocialError,
} from "./communitySocialDb";

function proposalRow(overrides: Record<string, unknown> = {}) {
  return { id: 10, status: "closed", venueId: null, sourceStudentProposalId: null, title: "Prop", ...overrides };
}
function commentRow(overrides: Record<string, unknown> = {}) {
  return { id: 1, proposalId: 10, userId: 4, parentCommentId: null, content: "x", isHidden: false, ...overrides };
}

// ─── toggleBookmark/getBookmarkState: select/insert/delete simples, un helper genérico basta ──

function makeSimpleDb(config: {
  proposals?: Array<Record<string, unknown>>;
  bookmarks?: Array<Record<string, unknown>>;
  userCommunityMemberships?: Array<Record<string, unknown>>;
  proposalCommunityLinks?: Array<Record<string, unknown>>;
} = {}) {
  const tables = new Map<unknown, MockTable<Record<string, unknown>>>([
    [communityProposals, new MockTable(communityProposals as unknown as Record<string, unknown>, config.proposals ?? [proposalRow()])],
    [communityProposalBookmarks, new MockTable(communityProposalBookmarks as unknown as Record<string, unknown>, config.bookmarks ?? [])],
    [userCommunities, new MockTable(userCommunities as unknown as Record<string, unknown>, config.userCommunityMemberships ?? [])],
    [communityProposalCommunities, new MockTable(communityProposalCommunities as unknown as Record<string, unknown>, config.proposalCommunityLinks ?? [])],
  ]);
  return { db: createMockDb(tables) as never, tables };
}

describe("toggleBookmark / getBookmarkState — F68", () => {
  it("guarda una propuesta visible que aún no estaba guardada", async () => {
    const { db, tables } = makeSimpleDb();
    const result = await toggleBookmark(10, 42, db);
    expect(result.bookmarked).toBe(true);
    expect(tables.get(communityProposalBookmarks)!.rows).toHaveLength(1);
  });

  it("un segundo toggle sobre la MISMA propuesta+usuario la quita (nunca duplica la fila)", async () => {
    const { db, tables } = makeSimpleDb({ bookmarks: [{ id: 1, proposalId: 10, userId: 42 }] });
    const result = await toggleBookmark(10, 42, db);
    expect(result.bookmarked).toBe(false);
    expect(tables.get(communityProposalBookmarks)!.rows).toHaveLength(0);
  });

  it("un bookmark de OTRO usuario sobre la misma propuesta no interfiere — cada usuario tiene su propio estado", async () => {
    const { db } = makeSimpleDb({ bookmarks: [{ id: 1, proposalId: 10, userId: 99 }] });
    expect(await getBookmarkState(10, 42, db)).toBe(false); // 42 nunca lo guardó, aunque 99 sí
    const result = await toggleBookmark(10, 42, db);
    expect(result.bookmarked).toBe(true); // 42 lo guarda por primera vez, sin verse afectado por el de 99
  });

  it("NUNCA exige que la propuesta esté cerrada — se puede guardar una ACTIVA sin haber respondido todavía (a diferencia de like/comment)", async () => {
    const { db } = makeSimpleDb({ proposals: [proposalRow({ status: "active" })] });
    const result = await toggleBookmark(10, 42, db);
    expect(result.bookmarked).toBe(true);
  });

  it("propuesta inexistente -> NOT_FOUND", async () => {
    const { db } = makeSimpleDb({ proposals: [] });
    await expect(toggleBookmark(999, 42, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("propuesta scopeada a otra comunidad de la que el usuario no es miembro -> FORBIDDEN (mismo criterio cross-community que like/comment)", async () => {
    const { db } = makeSimpleDb({
      proposals: [proposalRow()],
      proposalCommunityLinks: [{ proposalId: 10, communityId: 2 }],
      userCommunityMemberships: [{ userId: 42, communityId: 1 }],
    });
    await expect(toggleBookmark(10, 42, db)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── listMyBookmarkedProposals: JOIN + proyección — builder propio ─────────

function makeBookmarkListDb(config: { bookmarks: Array<Record<string, unknown>>; proposals: Array<Record<string, unknown>>; venuesRows?: Array<Record<string, unknown>> }) {
  const bookmarksTable = new MockTable(communityProposalBookmarks as unknown as Record<string, unknown>, config.bookmarks);
  const proposalsTable = new MockTable(communityProposals as unknown as Record<string, unknown>, config.proposals);
  const venuesTable = new MockTable(venues as unknown as Record<string, unknown>, config.venuesRows ?? []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    select: () => ({
      from: (table: unknown) => {
        if (table === venues) {
          return { where: (cond: MockCond) => Promise.resolve(venuesTable.select(cond)) };
        }
        // La única otra combinación real: from(communityProposalBookmarks).innerJoin(communityProposals, eq(bookmarkId, proposalId)).where(eq(userId)).orderBy(...)
        return {
          innerJoin: () => ({
            where: (cond: MockCond) => ({
              orderBy: async () => {
                const bookmarkRows = bookmarksTable.select(cond);
                return bookmarkRows.map(bm => {
                  const proposal = proposalsTable.rows.find(p => p.id === bm.proposalId)!;
                  return {
                    id: proposal.id, title: proposal.title, status: proposal.status,
                    urgencyType: proposal.urgencyType, endsAt: proposal.endsAt, venueId: proposal.venueId,
                    bookmarkedAt: bm.createdAt,
                  };
                });
              },
            }),
          }),
        };
      },
    }),
  };
  return db;
}

describe("listMyBookmarkedProposals — F68", () => {
  it("lista solo los bookmarks del propio usuario, con el nombre de venue resuelto", async () => {
    const db = makeBookmarkListDb({
      proposals: [proposalRow({ id: 10, title: "Afterparty", venueId: 5 }), proposalRow({ id: 11, title: "Torneo", venueId: null })],
      bookmarks: [
        { id: 1, proposalId: 10, userId: 42, createdAt: new Date("2026-08-01") },
        { id: 2, proposalId: 11, userId: 42, createdAt: new Date("2026-08-02") },
        { id: 3, proposalId: 10, userId: 99, createdAt: new Date("2026-08-03") }, // de otro usuario, nunca debe aparecer
      ],
      venuesRows: [{ id: 5, name: "Casanova" }],
    });

    const items = await listMyBookmarkedProposals(42, db);

    expect(items).toHaveLength(2);
    expect(items.map(i => i.id).sort()).toEqual([10, 11]);
    const afterparty = items.find(i => i.id === 10)!;
    expect(afterparty.venueName).toBe("Casanova");
    const torneo = items.find(i => i.id === 11)!;
    expect(torneo.venueName).toBeNull();
  });

  it("sin ningún bookmark, devuelve una lista vacía", async () => {
    const db = makeBookmarkListDb({ proposals: [proposalRow()], bookmarks: [] });
    expect(await listMyBookmarkedProposals(42, db)).toEqual([]);
  });
});

// ─── toggleCommentLike / batches: necesita COUNT(*)/GROUP BY — builder propio ──

function makeCommentLikeDb(config: {
  proposals?: Array<Record<string, unknown>>;
  comments?: Array<Record<string, unknown>>;
  commentLikes?: Array<Record<string, unknown>>;
  responses?: Array<Record<string, unknown>>;
  proposalCommunityLinks?: Array<Record<string, unknown>>;
  userCommunityMemberships?: Array<Record<string, unknown>>;
}) {
  const proposalsTable = new MockTable(communityProposals as unknown as Record<string, unknown>, config.proposals ?? [proposalRow()]);
  const commentsTable = new MockTable(communityProposalComments as unknown as Record<string, unknown>, config.comments ?? [commentRow()]);
  const commentLikesTable = new MockTable(communityCommentLikes as unknown as Record<string, unknown>, config.commentLikes ?? []);
  const responsesTable = new MockTable(communityResponses as unknown as Record<string, unknown>, config.responses ?? []);
  const proposalCommunitiesTable = new MockTable(communityProposalCommunities as unknown as Record<string, unknown>, config.proposalCommunityLinks ?? []);
  const userCommunitiesTable = new MockTable(userCommunities as unknown as Record<string, unknown>, config.userCommunityMemberships ?? []);

  const plainTables = new Map<unknown, MockTable<Record<string, unknown>>>([
    [communityProposals, proposalsTable], [communityProposalComments, commentsTable],
    [communityResponses, responsesTable], [communityProposalCommunities, proposalCommunitiesTable],
    [userCommunities, userCommunitiesTable],
  ]);
  const genericDb = createMockDb(plainTables);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    ...genericDb,
    select: (cols?: Record<string, unknown>) => ({
      from: (table: unknown) => {
        if (table !== communityCommentLikes) return (genericDb as never as { select: typeof db.select }).select(cols).from(table);
        const isCount = cols && "count" in cols;
        const groupByCol = cols && "commentId" in cols && isCount;
        return {
          where: (cond: MockCond) => {
            const matched = () => commentLikesTable.rows.filter(r => evalCond(cond, r, communityCommentLikes as unknown as Record<string, unknown>)).map(r => ({ ...r }));
            if (groupByCol) {
              return {
                groupBy: async () => {
                  const byComment = new Map<number, number>();
                  for (const r of matched()) byComment.set(r.commentId as number, (byComment.get(r.commentId as number) ?? 0) + 1);
                  return Array.from(byComment.entries()).map(([commentId, count]) => ({ commentId, count }));
                },
              };
            }
            if (isCount) return Promise.resolve([{ count: matched().length }]);
            // Thenable directamente (getMyCommentLikesBatch nunca llama .limit()) Y con
            // .limit() colgado encima (el chequeo de existencia dentro de toggleCommentLike sí lo llama).
            const p = Promise.resolve(matched()) as Promise<unknown[]> & { limit?: (n: number) => Promise<unknown[]> };
            p.limit = async (n: number) => matched().slice(0, n);
            return p;
          },
        };
      },
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        if (table === communityCommentLikes) { const row = commentLikesTable.insert(v); return Promise.resolve([{ insertId: row.id }]); }
        return (genericDb.insert(table) as { values: (v: Record<string, unknown>) => Promise<unknown> }).values(v);
      },
    }),
    delete: (table: unknown) => ({
      where: (cond: MockCond) => {
        if (table === communityCommentLikes) { const n = commentLikesTable.delete(cond); return Promise.resolve([{ affectedRows: n }]); }
        return (genericDb.delete(table) as { where: (c: unknown) => Promise<unknown> }).where(cond);
      },
    }),
  };
  return db;
}

describe("toggleCommentLike / getCommentLikeCountsBatch / getMyCommentLikesBatch — F68", () => {
  it("da like a un comentario visible al que el usuario tiene acceso", async () => {
    const db = makeCommentLikeDb({});
    const result = await toggleCommentLike(1, 42, db);
    expect(result).toEqual({ liked: true, count: 1 });
  });

  it("un segundo toggle del MISMO usuario sobre el MISMO comentario lo quita", async () => {
    const db = makeCommentLikeDb({ commentLikes: [{ id: 1, commentId: 1, userId: 42 }] });
    const result = await toggleCommentLike(1, 42, db);
    expect(result).toEqual({ liked: false, count: 0 });
  });

  it("el count agregado refleja los likes de VARIOS usuarios distintos sobre el mismo comentario", async () => {
    const db = makeCommentLikeDb({ commentLikes: [{ id: 1, commentId: 1, userId: 1 }, { id: 2, commentId: 1, userId: 2 }] });
    const result = await toggleCommentLike(1, 3, db); // un tercer usuario da like
    expect(result).toEqual({ liked: true, count: 3 });
  });

  it("comentario inexistente -> NOT_FOUND", async () => {
    const db = makeCommentLikeDb({ comments: [] });
    await expect(toggleCommentLike(999, 42, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("comentario ya oculto (moderado/borrado) -> NOT_FOUND, nunca se puede reaccionar a él", async () => {
    const db = makeCommentLikeDb({ comments: [commentRow({ isHidden: true })] });
    await expect(toggleCommentLike(1, 42, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("propuesta dueña del comentario todavía activa y el usuario NO ha respondido -> NOT_CLOSED (misma puerta que like/comment de propuesta)", async () => {
    const db = makeCommentLikeDb({ proposals: [proposalRow({ status: "active" })] });
    await expect(toggleCommentLike(1, 42, db)).rejects.toMatchObject({ code: "NOT_CLOSED" });
  });

  it("getCommentLikeCountsBatch: batch correcto por comentario, sin mezclar contadores entre comentarios distintos", async () => {
    const db = makeCommentLikeDb({ commentLikes: [{ id: 1, commentId: 1, userId: 1 }, { id: 2, commentId: 1, userId: 2 }, { id: 3, commentId: 2, userId: 1 }] });
    const counts = await getCommentLikeCountsBatch([1, 2, 3], db);
    expect(counts.get(1)).toBe(2);
    expect(counts.get(2)).toBe(1);
    expect(counts.has(3)).toBe(false); // sin filas -> ausente, nunca 0 falso-positivo en el Map
  });

  it("getMyCommentLikesBatch: solo devuelve los comentarios que ESE usuario ha likeado, entre una tanda", async () => {
    const db = makeCommentLikeDb({ commentLikes: [{ id: 1, commentId: 1, userId: 42 }, { id: 2, commentId: 2, userId: 99 }] });
    const mine = await getMyCommentLikesBatch([1, 2, 3], 42, db);
    expect(mine).toEqual(new Set([1]));
  });
});

describe("CommunitySocialError — sanity", () => {
  it("expone el código real para mapCommunitySocialError del router", () => {
    const err = new CommunitySocialError("NOT_FOUND", "x");
    expect(err.code).toBe("NOT_FOUND");
  });
});
