/**
 * communityStudentProposalDb.test.ts — MG-04. Mismo patrón de mock por
 * inyección de `db` que studentPhotoEventsDb.test.ts. Cubre lo que
 * server/routers/community.test.ts NO cubre porque ahí submitStudentProposal
 * está mockeado: la escritura real de coverImageUrl/urgency y el
 * leftJoin de venueName en listStudentProposals (gap real encontrado en la
 * auditoría MG-04, spec §20).
 */
import { describe, it, expect } from "vitest";
import { submitStudentProposal, listStudentProposals } from "./communityStudentProposalDb";

function makeSubmitMockDb(insertId = 1) {
  const inserted: Record<string, unknown>[] = [];
  const db: Record<string, unknown> = {
    insert: () => db,
    values: (v: Record<string, unknown>) => { inserted.push(v); return Promise.resolve([{ insertId }]); },
    select: () => db,
    from: () => db,
    where: () => db,
    limit: () => Promise.resolve([{ id: insertId, ...inserted[0] }]),
  };
  return { db: db as unknown as Parameters<typeof submitStudentProposal>[1], getInserted: () => inserted };
}

describe("submitStudentProposal — MG-04: coverImageUrl y urgency", () => {
  it("guarda coverImageUrl y urgency cuando se proporcionan", async () => {
    const { db, getInserted } = makeSubmitMockDb();
    await submitStudentProposal({
      studentUserId: 7, communityId: 1, title: "Torneo de pádel",
      coverImageUrl: "https://cdn.example.com/community-proposals/7/abc.jpg",
      urgency: "urgent",
    }, db);
    expect(getInserted()[0]).toMatchObject({
      coverImageUrl: "https://cdn.example.com/community-proposals/7/abc.jpg",
      urgency: "urgent",
    });
  });

  it("sin coverImageUrl/urgency, se guardan como null — nunca un valor inventado", async () => {
    const { db, getInserted } = makeSubmitMockDb();
    await submitStudentProposal({ studentUserId: 7, communityId: 1, title: "x" }, db);
    expect(getInserted()[0]).toMatchObject({ coverImageUrl: null, urgency: null });
  });

  it("una idea siempre empieza en pending_moderation, incluso con imagen/urgencia (nunca se auto-aprueba ni se auto-publica)", async () => {
    const { db, getInserted } = makeSubmitMockDb();
    await submitStudentProposal({
      studentUserId: 7, communityId: 1, title: "x", coverImageUrl: "https://cdn.example.com/x.jpg", urgency: "soon",
    }, db);
    expect(getInserted()[0]).toMatchObject({ status: "pending_moderation" });
  });
});

function makeListMockDb(rows: Array<{ proposal: Record<string, unknown>; studentName: string | null; venueName: string | null }>) {
  const db: Record<string, unknown> = {
    select: (_sel: unknown) => db,
    from: () => db,
    leftJoin: () => db,
    innerJoin: () => db,
    where: (..._args: unknown[]) => db,
    groupBy: () => Promise.resolve([]),
    orderBy: () => db,
    limit: (_n: number) => db,
    offset: (_n: number) => Promise.resolve(rows),
  };
  return db as unknown as Parameters<typeof listStudentProposals>[1];
}

describe("listStudentProposals — MG-04: venueName resuelto vía leftJoin (gap real corregido)", () => {
  it("expone venueName cuando la idea tiene un venue asociado", async () => {
    const db = makeListMockDb([
      { proposal: { id: 1, title: "Padel", venueId: 3, coverImageUrl: null, urgency: null, createdAt: new Date() }, studentName: "Ana", venueName: "Pádel Indoor Segovia" },
    ]);
    const { items } = await listStudentProposals({ communityIds: "all" }, db);
    expect(items[0].venueName).toBe("Pádel Indoor Segovia");
  });

  it("venueName es null cuando la idea no tiene venue asociado — nunca un string vacío ni undefined silencioso", async () => {
    const db = makeListMockDb([
      { proposal: { id: 2, title: "Sin venue", venueId: null, coverImageUrl: null, urgency: null, createdAt: new Date() }, studentName: "Ana", venueName: null },
    ]);
    const { items } = await listStudentProposals({ communityIds: "all" }, db);
    expect(items[0].venueName).toBeNull();
  });

  it("coverImageUrl y urgency se propagan tal cual desde la fila de BD (spread del proposal)", async () => {
    const db = makeListMockDb([
      { proposal: { id: 3, title: "Con imagen", venueId: null, coverImageUrl: "https://cdn.example.com/x.jpg", urgency: "no_rush", createdAt: new Date() }, studentName: "Ana", venueName: null },
    ]);
    const { items } = await listStudentProposals({ communityIds: "all" }, db);
    expect(items[0].coverImageUrl).toBe("https://cdn.example.com/x.jpg");
    expect(items[0].urgency).toBe("no_rush");
  });
});
