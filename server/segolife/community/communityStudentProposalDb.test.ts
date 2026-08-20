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

describe("submitStudentProposal — MG-05: configuración de voto propuesta (opcional, nunca obligatoria)", () => {
  it("sin proposedQuestionType, ambos campos se guardan null — proponer configuración de voto nunca es obligatorio (comportamiento pre-MG-05 intacto)", async () => {
    const { db, getInserted } = makeSubmitMockDb();
    await submitStudentProposal({ studentUserId: 7, communityId: 1, title: "x" }, db);
    expect(getInserted()[0]).toMatchObject({ proposedQuestionType: null, proposedOptions: null });
  });

  it("yes_no: se guarda sin necesitar opciones", async () => {
    const { db, getInserted } = makeSubmitMockDb();
    await submitStudentProposal({ studentUserId: 7, communityId: 1, title: "x", proposedQuestionType: "yes_no" }, db);
    expect(getInserted()[0]).toMatchObject({ proposedQuestionType: "yes_no", proposedOptions: null });
  });

  it("single_choice con 2+ opciones válidas: se guardan recortadas (trim)", async () => {
    const { db, getInserted } = makeSubmitMockDb();
    await submitStudentProposal({
      studentUserId: 7, communityId: 1, title: "x",
      proposedQuestionType: "single_choice", proposedOptions: ["  Jueves  ", "Viernes"],
    }, db);
    expect(getInserted()[0]).toMatchObject({ proposedQuestionType: "single_choice", proposedOptions: ["Jueves", "Viernes"] });
  });

  it("single_choice sin opciones suficientes: RECHAZA — el servidor nunca confía solo en el formulario", async () => {
    const { db } = makeSubmitMockDb();
    await expect(submitStudentProposal({
      studentUserId: 7, communityId: 1, title: "x", proposedQuestionType: "single_choice", proposedOptions: ["Solo una"],
    }, db)).rejects.toThrow();
  });

  it("yes_no con opciones arbitrarias: RECHAZA (bug real que el servidor no comprobaba antes de MG-05)", async () => {
    const { db } = makeSubmitMockDb();
    await expect(submitStudentProposal({
      studentUserId: 7, communityId: 1, title: "x", proposedQuestionType: "yes_no", proposedOptions: ["Jueves", "Viernes"],
    }, db)).rejects.toThrow();
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

  it("MG-05: una idea anterior a esta fase (sin proposedQuestionType/proposedOptions en la fila real) sigue listándose con normalidad — nunca rompe registros históricos", async () => {
    const db = makeListMockDb([
      { proposal: { id: 4, title: "Idea anterior a MG-05", venueId: null, coverImageUrl: null, urgency: null, createdAt: new Date() }, studentName: "Ana", venueName: null },
    ]);
    const { items } = await listStudentProposals({ communityIds: "all" }, db);
    expect(items[0].proposedQuestionType).toBeUndefined();
    expect(items[0].id).toBe(4);
  });

  it("MG-05: propaga proposedQuestionType/proposedOptions tal cual desde la fila de BD", async () => {
    const db = makeListMockDb([
      { proposal: { id: 5, title: "Con voto propuesto", venueId: null, coverImageUrl: null, urgency: null, createdAt: new Date(), proposedQuestionType: "single_choice", proposedOptions: ["Jueves", "Viernes"] }, studentName: "Ana", venueName: null },
    ]);
    const { items } = await listStudentProposals({ communityIds: "all" }, db);
    expect(items[0].proposedQuestionType).toBe("single_choice");
    expect(items[0].proposedOptions).toEqual(["Jueves", "Viernes"]);
  });
});
