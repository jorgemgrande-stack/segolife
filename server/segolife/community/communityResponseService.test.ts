import { describe, it, expect, vi, beforeEach } from "vitest";
import { communityOptions, communityResponses, type CommunityOption, type CommunityProposal } from "../../../drizzle/schema";

const { mockGetProposalById, mockEarnTokens } = vi.hoisted(() => ({
  mockGetProposalById: vi.fn(),
  mockEarnTokens: vi.fn(),
}));
vi.mock("./communityDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./communityDb")>();
  return { ...actual, getProposalById: mockGetProposalById };
});
vi.mock("../tokens/tokenEngine", () => ({ earnTokens: mockEarnTokens }));

import { buildValueRows, sanitizeOpenText, OPEN_TEXT_MAX_LENGTH, CommunityResponseError, submitResponse, type ResponsePayload } from "./communityResponseService";

function option(overrides: Partial<CommunityOption> = {}): CommunityOption {
  return { id: 1, proposalId: 1, label: "Opción", sortOrder: 0, isPositiveIntent: false, createdAt: new Date(), ...overrides } as CommunityOption;
}

const OPTS = [option({ id: 1, label: "A" }), option({ id: 2, label: "B" }), option({ id: 3, label: "C" })];

function expectInvalid(payload: ResponsePayload, options: CommunityOption[] = OPTS) {
  expect(() => buildValueRows(payload, options)).toThrow(CommunityResponseError);
}

describe("buildValueRows — validación por tipo de pregunta (spec puntos 6, 28-30)", () => {
  it("single_choice: opción válida produce una fila; opción ajena a la propuesta se rechaza", () => {
    const rows = buildValueRows({ questionType: "single_choice", optionId: 1 }, OPTS);
    expect(rows).toEqual([{ optionId: 1, valueText: null, valueNumber: null }]);
    expectInvalid({ questionType: "single_choice", optionId: 999 });
  });

  it("yes_no: solo acepta 'yes'/'no'", () => {
    expect(buildValueRows({ questionType: "yes_no", value: "yes" }, [])).toEqual([{ optionId: null, valueText: "yes", valueNumber: null }]);
  });

  it("percentage_scale: cada criterio 0-100 entero; fuera de rango se rechaza", () => {
    const rows = buildValueRows({ questionType: "percentage_scale", values: [{ optionId: 1, value: 0 }, { optionId: 2, value: 100 }] }, OPTS);
    expect(rows).toHaveLength(2);
    expectInvalid({ questionType: "percentage_scale", values: [{ optionId: 1, value: 101 }] });
    expectInvalid({ questionType: "percentage_scale", values: [{ optionId: 1, value: -1 }] });
    expectInvalid({ questionType: "percentage_scale", values: [] });
  });

  it("scale_1_5: solo enteros 1-5", () => {
    expect(buildValueRows({ questionType: "scale_1_5", value: 3 }, [])).toEqual([{ optionId: null, valueText: null, valueNumber: 3 }]);
    expectInvalid({ questionType: "scale_1_5", value: 0 });
    expectInvalid({ questionType: "scale_1_5", value: 6 });
  });

  it("multiselect: rechaza vacío y duplicados", () => {
    expect(buildValueRows({ questionType: "multiselect", optionIds: [1, 2] }, OPTS)).toHaveLength(2);
    expectInvalid({ questionType: "multiselect", optionIds: [] });
    expectInvalid({ questionType: "multiselect", optionIds: [1, 1] });
  });

  it("ranking: exige TODAS las opciones sin duplicados, asigna posición 1-based", () => {
    const rows = buildValueRows({ questionType: "ranking", orderedOptionIds: [3, 1, 2] }, OPTS);
    expect(rows).toEqual([
      { optionId: 3, valueText: null, valueNumber: 1 },
      { optionId: 1, valueText: null, valueNumber: 2 },
      { optionId: 2, valueText: null, valueNumber: 3 },
    ]);
    expectInvalid({ questionType: "ranking", orderedOptionIds: [1, 2] }); // parcial — falta la opción 3
    expectInvalid({ questionType: "ranking", orderedOptionIds: [1, 1, 2] }); // duplicado
  });

  it("attendance_intention: mapea al código numérico correcto", () => {
    expect(buildValueRows({ questionType: "attendance_intention", value: "definitely" }, [])).toEqual([{ optionId: null, valueText: "definitely", valueNumber: 3 }]);
  });

  it("me_apunto: siempre produce una fila fija, sin datos de entrada", () => {
    expect(buildValueRows({ questionType: "me_apunto" }, [])).toEqual([{ optionId: null, valueText: "me_apunto", valueNumber: null }]);
  });

  it("open_text: rechaza vacío tras sanitizar (p.ej. solo HTML)", () => {
    expect(buildValueRows({ questionType: "open_text", text: "Hola" }, [])[0].valueText).toBe("Hola");
    expectInvalid({ questionType: "open_text", text: "   " });
    expectInvalid({ questionType: "open_text", text: "<script></script>" });
  });
});

describe("sanitizeOpenText — spec punto 73 (sin HTML arbitrario, longitud acotada)", () => {
  it("elimina etiquetas HTML", () => {
    expect(sanitizeOpenText("<b>hola</b> <script>alert(1)</script>")).toBe("hola alert(1)");
  });

  it("recorta espacios y trunca al máximo permitido", () => {
    expect(sanitizeOpenText("  hola  ")).toBe("hola");
    const long = "a".repeat(OPEN_TEXT_MAX_LENGTH + 500);
    expect(sanitizeOpenText(long)).toHaveLength(OPEN_TEXT_MAX_LENGTH);
  });
});

// ─── submitResponse — recompensa vía earnTokens() (SEGOLIFE — COMMUNITY
// Production Implementation) — reemplaza el bypass legacy a
// postLedgerMovement(). No se re-prueba aquí la selección de regla/topes
// (ya cubierto por tokenEngine.test.ts/rewardEngine.test.ts) — solo la
// ORQUESTACIÓN: cuándo se llama, con qué idempotencyKey, y que un fallo
// nunca pierde la respuesta ya registrada.
function proposalFixture(overrides: Partial<CommunityProposal> = {}): CommunityProposal {
  return {
    id: 1, title: "¿Vamos a Casanova?", description: null, questionType: "yes_no", status: "active",
    urgencyType: "scheduled", startsAt: null, endsAt: null, resultsVisibility: "after_vote",
    allowChangeResponse: true, tokenReward: null, coverImageUrl: null, venueId: 7,
    relatedEventId: null, convertedEventId: null, sourceStudentProposalId: null,
    audienceDefinition: null, audienceSnapshotAt: null, minSampleSize: 5,
    createdByUserId: 1, publishedAt: null, closedAt: null, cancelledAt: null,
    createdAt: new Date("2026-08-14"), updatedAt: new Date("2026-08-14"),
    ...overrides,
  } as CommunityProposal;
}

function fakeDb(opts: { options?: CommunityOption[]; existingResponse?: Record<string, unknown> | null } = {}) {
  let responseRow: Record<string, unknown> | null = opts.existingResponse ?? null;
  let nextId = 900;

  function selectFrom(table: unknown) {
    const chain: Record<string, unknown> = {};
    chain.where = () => chain;
    chain.limit = () => chain;
    chain.then = (resolve: (v: unknown) => void) => {
      if (table === communityOptions) return resolve(opts.options ?? []);
      if (table === communityResponses) return resolve(responseRow ? [responseRow] : []);
      return resolve([]);
    };
    return chain;
  }

  const db = {
    select: () => ({ from: selectFrom }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        if (table === communityResponses) {
          responseRow = { id: nextId, proposalId: v.proposalId, userId: v.userId, respondedAt: new Date(), updatedAt: new Date(), rewardGranted: false, tokenLedgerId: null };
          return Promise.resolve([{ insertId: nextId }]);
        }
        return Promise.resolve([{ insertId: 1 }]);
      },
    }),
    update: (table: unknown) => ({
      set: (fields: Record<string, unknown>) => ({
        where: () => {
          if (table === communityResponses && responseRow) responseRow = { ...responseRow, ...fields };
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  };

  return { db: db as never, getResponseRow: () => responseRow };
}

describe("submitResponse — recompensa vía earnTokens() (nunca postLedgerMovement directo)", () => {
  beforeEach(() => { mockGetProposalById.mockReset(); mockEarnTokens.mockReset(); });

  it("primera respuesta válida → earnTokens con origin='community_response', venueId de la propuesta e idempotencyKey estable", async () => {
    mockGetProposalById.mockResolvedValue(proposalFixture());
    mockEarnTokens.mockResolvedValue({ ledger: { id: 555 }, wallet: {}, breakdown: {} });
    const { db, getResponseRow } = fakeDb();

    const result = await submitResponse(1, 42, { questionType: "yes_no", value: "yes" }, db);

    expect(mockEarnTokens).toHaveBeenCalledOnce();
    expect(mockEarnTokens.mock.calls[0][0]).toMatchObject({
      userId: 42, origin: "community_response", venueId: 7, sourceId: 1,
      idempotencyKey: "community_response:1:42",
    });
    expect(result.rewardGranted).toBe(true);
    expect((getResponseRow() as { rewardGranted: boolean; tokenLedgerId: number }).tokenLedgerId).toBe(555);
  });

  it("cambiar de respuesta (no es la primera) → NUNCA vuelve a llamar earnTokens", async () => {
    mockGetProposalById.mockResolvedValue(proposalFixture());
    const { db } = fakeDb({ existingResponse: { id: 5, proposalId: 1, userId: 42, rewardGranted: true, tokenLedgerId: 555 } });

    const result = await submitResponse(1, 42, { questionType: "yes_no", value: "no" }, db);

    expect(mockEarnTokens).not.toHaveBeenCalled();
    expect(result.rewardGranted).toBe(false); // este submitResponse concreto no concedió nada nuevo
  });

  it("earnTokens lanza (p.ej. NO_RULE_FOUND si la regla está desactivada) → la respuesta se guarda igualmente, rewardGranted=false", async () => {
    mockGetProposalById.mockResolvedValue(proposalFixture());
    mockEarnTokens.mockRejectedValue(new Error("NO_RULE_FOUND"));
    const { db, getResponseRow } = fakeDb();

    const result = await submitResponse(1, 42, { questionType: "yes_no", value: "yes" }, db);

    expect(result.rewardGranted).toBe(false);
    expect(getResponseRow()).not.toBeNull(); // la respuesta SÍ quedó persistida
  });
});
