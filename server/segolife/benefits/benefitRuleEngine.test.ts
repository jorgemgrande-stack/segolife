/**
 * benefitRuleEngine.test.ts — matching de reglas y motor genérico
 * `evaluateBenefitsForOrigin`. Los mocks devuelven lo que "ya habría
 * filtrado" una consulta SQL real por tabla (mismo criterio que
 * tokenRuleEngine.test.ts) — el filtrado bajo test es el que hace el propio
 * motor en JS (venue/producto/comunidad/importe/fecha/día-semana/límites).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockEvaluateAggregateMetric } = vi.hoisted(() => ({ mockEvaluateAggregateMetric: vi.fn() }));
vi.mock("./benefitAggregateMetrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./benefitAggregateMetrics")>();
  return { ...actual, evaluateAggregateMetric: mockEvaluateAggregateMetric };
});

import { evaluateBenefitsForOrigin, type BenefitOrigin } from "./benefitRuleEngine";
import { benefitRules, benefitDefinitions, benefitCommunities, userBenefits, tokenLedger } from "../../../drizzle/schema";
import { emitBenefitGranted, buildBenefitGrantedPayload, benefitEvents, type BenefitGrantedPayload } from "./benefitEvents";

function blankRule(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, name: "Regla", description: null, sourceType: "consumption",
    sourceVenueId: null, sourceEventId: null, sourceProductId: null, communityId: null,
    minAmountCents: null, minVisits: null, recurrenceWindow: null,
    aggregateMetric: null, aggregateThreshold: null,
    conditionDaysOfWeek: null, conditionStartTime: null, conditionEndTime: null,
    startsAt: null, endsAt: null, active: true, priority: 0,
    benefitDefinitionId: 1, quantity: 1,
    validityType: "immediate", validityOffsetMinutes: null, validityDurationMinutes: null,
    validityStartTime: null, validityEndTime: null, validityDaysOffset: null,
    maxPerUser: null, maxPerDay: null, maxTotal: null, oncePerOrigin: false, oncePerRule: false,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function blankDefinition(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, name: "Entrada gratis Casanova", slug: "entrada-casanova", description: null,
    benefitType: "free_entry", destinationVenueId: 20, destinationEventId: null, productId: null,
    discountType: null, discountValue: null, valueMetadata: null, active: true, imageUrl: null,
    nameEn: "Free entry Casanova", nameEs: "Entrada gratis Casanova",
    descriptionEn: null, descriptionEs: null, termsEn: null, termsEs: null,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function blankOrigin(overrides: Partial<BenefitOrigin> = {}): BenefitOrigin {
  return {
    type: "consumption", userId: 42, venueId: 10, eventId: null, productId: null,
    amountCents: 1000, communityId: 1, sourceId: 99, ledgerId: 555,
    occurredAt: new Date("2026-06-12T21:00:00Z"), // viernes ~23:00 Madrid (CEST)
    ...overrides,
  };
}

/**
 * Extrae pares (columna_db, valor) de una condición real de Drizzle
 * (`eq(...)`/`and(eq(...), eq(...))`) recorriendo `queryChunks` — necesario
 * aquí porque `userBenefits` recibe VARIAS queries de select distintas
 * dentro de una misma evaluación (precheck de idempotencia, contadores de
 * límites) y un mock que ignorase la condición devolvería filas de un
 * lookup para otro completamente distinto (falso positivo de duplicado).
 */
type CondPair = [column: string, op: "=" | "<>", value: unknown];

function extractCondPairs(node: any, pairs: CondPair[] = []): CondPair[] {
  if (!node || typeof node !== "object" || !Array.isArray(node.queryChunks)) return pairs;
  const chunks = node.queryChunks;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (c && typeof c === "object" && "columnType" in c && typeof c.name === "string") {
      let op: "=" | "<>" = "=";
      for (let j = i + 1; j < chunks.length; j++) {
        const p = chunks[j];
        if (p && typeof p === "object" && "value" in p && Array.isArray((p as { value?: unknown }).value) && !("columnType" in p)) {
          const opStr = (p as { value: unknown[] }).value.join("");
          if (opStr.includes("<>") || opStr.includes("!=")) op = "<>";
        }
        if (p && typeof p === "object" && "brand" in p && "value" in p && !("columnType" in p)) {
          pairs.push([c.name as string, op, (p as { value: unknown }).value]);
          break;
        }
        if (p && typeof p === "object" && Array.isArray((p as { queryChunks?: unknown }).queryChunks)) break;
      }
    } else if (c && typeof c === "object" && Array.isArray(c.queryChunks)) {
      extractCondPairs(c, pairs);
    }
  }
  return pairs;
}

function toCamelCase(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function matchesCondition(row: Record<string, unknown>, cond: unknown): boolean {
  const pairs = extractCondPairs(cond);
  if (pairs.length === 0) return true;
  return pairs.every(([col, op, val]) => {
    const rowVal = row[toCamelCase(col)];
    return op === "=" ? rowVal === val : rowVal !== val;
  });
}

function makeRuleEngineMockDb(config: {
  rules?: Array<Record<string, unknown>>;
  definition?: Record<string, unknown> | null;
  communityRows?: Array<{ communityId: number }>;
  existingUserBenefits?: Array<Record<string, unknown>>;
  ledgerRows?: Array<Record<string, unknown>>;
} = {}) {
  const userBenefitRows: Array<Record<string, unknown>> = config.existingUserBenefits ? [...config.existingUserBenefits] : [];
  let nextId = userBenefitRows.length > 0 ? Math.max(...userBenefitRows.map(r => r.id as number)) + 1 : 1;

  function makeBuilder() {
    let mode: "select" | "insert" = "select";
    let table: unknown = null;
    let lastCond: unknown = null;
    const b: any = {};
    b.select = () => { mode = "select"; return b; };
    b.from = (t: unknown) => { table = t; return b; };
    b.insert = (t: unknown) => { mode = "insert"; table = t; return b; };
    b.where = (cond: unknown) => { lastCond = cond; return b; };
    b.limit = () => b;
    b.values = (v: Record<string, unknown>) => {
      if (table === userBenefits) {
        if (v.idempotencyKey != null) {
          const dup = userBenefitRows.find(r => r.idempotencyKey === v.idempotencyKey);
          if (dup) { const err: any = new Error("dup"); err.errno = 1062; throw err; }
        }
        const row = { id: nextId++, status: "active", qrToken: "tok", qrTokenHash: "hash", ...v };
        userBenefitRows.push(row);
        return Promise.resolve([{ insertId: row.id }]);
      }
      return Promise.resolve([{ insertId: 1 }]);
    };
    b.then = (resolve: (v: unknown) => void) => {
      if (table === benefitRules) return resolve(config.rules ?? []);
      if (table === benefitDefinitions) {
        const def = config.definition !== undefined ? config.definition : blankDefinition();
        return resolve(def && def.active !== false ? [def] : []);
      }
      if (table === benefitCommunities) return resolve(config.communityRows ?? []);
      if (table === tokenLedger) return resolve(config.ledgerRows ?? []);
      if (table === userBenefits) return resolve(userBenefitRows.filter(r => matchesCondition(r, lastCond)));
      return resolve([]);
    };
    return b;
  }

  return { db: makeBuilder() as any, getUserBenefitRows: () => userBenefitRows };
}

describe("evaluateBenefitsForOrigin — matching básico", () => {
  it("sin ninguna regla activa para el sourceType, no concede nada", async () => {
    const { db } = makeRuleEngineMockDb({ rules: [] });
    const result = await evaluateBenefitsForOrigin(blankOrigin(), db);
    expect(result).toEqual([]);
  });

  it("una regla que encaja concede el beneficio de su benefit_definition_id", async () => {
    const { db, getUserBenefitRows } = makeRuleEngineMockDb({
      rules: [blankRule()],
      definition: blankDefinition(),
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin(), db);
    expect(result).toHaveLength(1);
    expect(result[0].definition.id).toBe(1);
    expect(getUserBenefitRows()).toHaveLength(1);
  });

  it("sourceVenueId de la regla que no coincide con el origen descarta la regla", async () => {
    const { db } = makeRuleEngineMockDb({
      rules: [blankRule({ sourceVenueId: 999 })], // origen es venueId=10
      definition: blankDefinition(),
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin(), db);
    expect(result).toEqual([]);
  });

  it("minAmountCents no alcanzado descarta la regla", async () => {
    const { db } = makeRuleEngineMockDb({
      rules: [blankRule({ minAmountCents: 5000 })],
      definition: blankDefinition(),
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin({ amountCents: 1000 }), db);
    expect(result).toEqual([]);
  });

  it("fuera de la ventana starts_at/ends_at de la regla, no concede", async () => {
    const { db } = makeRuleEngineMockDb({
      rules: [blankRule({ startsAt: new Date("2099-01-01"), endsAt: new Date("2099-12-31") })],
      definition: blankDefinition(),
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin(), db);
    expect(result).toEqual([]);
  });

  it("condition_days_of_week que no incluye el día del origen descarta la regla", async () => {
    // El origen ocurre un viernes Madrid (day 5) — la regla solo aplica sábados (6).
    const { db } = makeRuleEngineMockDb({
      rules: [blankRule({ conditionDaysOfWeek: [6] })],
      definition: blankDefinition(),
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin(), db);
    expect(result).toEqual([]);
  });

  it("condition_start_time/end_time fuera de rango descarta la regla", async () => {
    const { db } = makeRuleEngineMockDb({
      // Origen ~23:00 Madrid — la regla solo aplica 08:00–12:00.
      rules: [blankRule({ conditionStartTime: "08:00", conditionEndTime: "12:00" })],
      definition: blankDefinition(),
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin(), db);
    expect(result).toEqual([]);
  });

  it("una definición inactiva descarta la regla aunque encaje", async () => {
    const { db } = makeRuleEngineMockDb({
      rules: [blankRule()],
      definition: blankDefinition({ active: false }),
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin(), db);
    expect(result).toEqual([]);
  });

  it("quantity > 1 concede varias copias del mismo beneficio con idempotencyKeys distintos", async () => {
    const { db, getUserBenefitRows } = makeRuleEngineMockDb({
      rules: [blankRule({ quantity: 2 })],
      definition: blankDefinition(),
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin(), db);
    expect(result).toHaveLength(2);
    const rows = getUserBenefitRows();
    expect(rows[0].idempotencyKey).not.toBe(rows[1].idempotencyKey);
  });
});

describe("evaluateBenefitsForOrigin — cross-venue (origen ≠ destino)", () => {
  it("origen en venue A, destino de la definición en venue B — ambos se conservan trazados", async () => {
    const { db } = makeRuleEngineMockDb({
      rules: [blankRule({ sourceVenueId: 10 })], // Chin Chin
      definition: blankDefinition({ destinationVenueId: 20 }), // Casanova
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin({ venueId: 10 }), db);
    expect(result).toHaveLength(1);
    expect(result[0].userBenefit.sourceVenueId).toBe(10); // Chin Chin
    expect(result[0].definition.destinationVenueId).toBe(20); // Casanova
  });
});

describe("evaluateBenefitsForOrigin — alcance de comunidad", () => {
  it("definición sin filas en benefit_communities aplica a cualquier comunidad", async () => {
    const { db } = makeRuleEngineMockDb({
      rules: [blankRule()], definition: blankDefinition(), communityRows: [],
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin({ communityId: 2 }), db);
    expect(result).toHaveLength(1);
  });

  it("definición restringida a otra comunidad descarta la concesión", async () => {
    const { db } = makeRuleEngineMockDb({
      rules: [blankRule()], definition: blankDefinition(), communityRows: [{ communityId: 1 }],
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin({ communityId: 2 }), db);
    expect(result).toEqual([]);
  });

  it("definición restringida a la comunidad correcta concede normalmente", async () => {
    const { db } = makeRuleEngineMockDb({
      rules: [blankRule()], definition: blankDefinition(), communityRows: [{ communityId: 2 }],
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin({ communityId: 2 }), db);
    expect(result).toHaveLength(1);
  });
});

describe("evaluateBenefitsForOrigin — límites", () => {
  it("oncePerOrigin ya concedido para el mismo (regla, sourceType, sourceId) no concede de nuevo", async () => {
    const { db, getUserBenefitRows } = makeRuleEngineMockDb({
      rules: [blankRule({ oncePerOrigin: true })],
      definition: blankDefinition(),
      existingUserBenefits: [{ id: 1, benefitRuleId: 1, sourceType: "consumption", sourceId: 99, status: "active" }],
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin({ sourceId: 99 }), db);
    expect(result).toEqual([]);
    expect(getUserBenefitRows()).toHaveLength(1); // no se añadió una segunda
  });

  it("maxPerUser alcanzado no concede más para ese usuario", async () => {
    const { db } = makeRuleEngineMockDb({
      rules: [blankRule({ maxPerUser: 1 })],
      definition: blankDefinition(),
      existingUserBenefits: [{ id: 1, userId: 42, benefitRuleId: 1, status: "active" }],
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin(), db);
    expect(result).toEqual([]);
  });

  it("maxTotal alcanzado no concede más aunque sea a otro usuario", async () => {
    const { db } = makeRuleEngineMockDb({
      rules: [blankRule({ maxTotal: 1 })],
      definition: blankDefinition(),
      existingUserBenefits: [{ id: 1, userId: 999, benefitRuleId: 1, status: "active" }],
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin(), db);
    expect(result).toEqual([]);
  });

  it("oncePerRule ya concedido (cualquier origen) no concede de nuevo para ese usuario", async () => {
    const { db } = makeRuleEngineMockDb({
      rules: [blankRule({ oncePerRule: true })],
      definition: blankDefinition(),
      existingUserBenefits: [{ id: 1, userId: 42, benefitRuleId: 1, status: "active" }],
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin(), db);
    expect(result).toEqual([]);
  });

  it("sin límites configurados, no hace ninguna comprobación adicional y concede normalmente", async () => {
    const { db } = makeRuleEngineMockDb({ rules: [blankRule()], definition: blankDefinition() });
    const result = await evaluateBenefitsForOrigin(blankOrigin(), db);
    expect(result).toHaveLength(1);
  });
});

describe("evaluateBenefitsForOrigin — idempotencia end-to-end", () => {
  it("el mismo origen (mismo sourceId) reevaluado no duplica la concesión", async () => {
    const { db, getUserBenefitRows } = makeRuleEngineMockDb({
      rules: [blankRule()],
      definition: blankDefinition(),
    });
    const origin = blankOrigin({ sourceId: 77 });
    const first = await evaluateBenefitsForOrigin(origin, db);
    const second = await evaluateBenefitsForOrigin(origin, db);
    expect(first).toHaveLength(1);
    expect(second).toEqual([]); // ya existía por idempotencyKey — no se re-añade a "unlocked"
    expect(getUserBenefitRows()).toHaveLength(1);
  });

  /**
   * evaluateBenefitsForOrigin() NUNCA emite BenefitGranted por sí mismo
   * (ver benefitGrantService.ts, cabecera) — el llamador real (p.ej.
   * consumptionQrService.redeemConsumptionQr) recorre el array devuelto y
   * emite un evento por cada elemento, DESPUÉS de que su transacción haya
   * confirmado. Aquí se simula exactamente ese patrón de llamador para
   * probar que reevaluar el MISMO origen no produce una segunda emisión —
   * el array ya viene vacío en la repetición, así que el bucle del
   * llamador simplemente no tiene nada que emitir.
   */
  it("simulando el patrón del llamador real: reevaluar el mismo origen NO vuelve a emitir BenefitGranted", async () => {
    const { db } = makeRuleEngineMockDb({
      rules: [blankRule()],
      definition: blankDefinition(),
    });
    const received: BenefitGrantedPayload[] = [];
    const listener = (p: BenefitGrantedPayload) => { received.push(p); };
    benefitEvents.onTyped("BenefitGranted", listener);

    const origin = blankOrigin({ sourceId: 321 });
    for (const attempt of [1, 2, 3]) {
      const unlocked = await evaluateBenefitsForOrigin(origin, db);
      for (const u of unlocked) emitBenefitGranted(buildBenefitGrantedPayload(u.userBenefit, u.definition));
      void attempt;
    }
    await new Promise(resolve => setImmediate(resolve));

    expect(received).toHaveLength(1); // solo el primer intento generó una concesión real → un único evento
    benefitEvents.removeListener("BenefitGranted", listener);
  });
});

describe("evaluateBenefitsForOrigin — varias reglas simultáneas (aditivo, no competitivo)", () => {
  it("dos reglas activas distintas que encajan conceden DOS beneficios distintos", async () => {
    const { db } = makeRuleEngineMockDb({
      rules: [
        blankRule({ id: 1, benefitDefinitionId: 1, priority: 10 }),
        blankRule({ id: 2, benefitDefinitionId: 2, priority: 5 }),
      ],
      definition: blankDefinition(), // se reutiliza para ambas en este mock simplificado
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin(), db);
    expect(result).toHaveLength(2);
  });
});

// SEGOLIFE — BEHAVIORAL BENEFITS RULE ENGINE (Fase 6, spec §17/§18, "NO
// HISTORICAL REWARD BLAST" — CRITICAL): un hecho real anterior a la
// creación de la regla nunca puede desencadenarla, ni siquiera si la fila
// de event_attendance/venue_visit/commerce_transaction es genuinamente
// NUEVA en la base de datos (p.ej. una sincronización tardía de Fourvenues
// que ingiere hoy un evento de hace 3 semanas).
describe("evaluateBenefitsForOrigin — protección histórica (spec §41 test #5)", () => {
  it("un hecho cuyo occurredAt es ANTERIOR a la creación de la regla NUNCA la dispara, aunque la regla no tenga startsAt configurado", async () => {
    const { db } = makeRuleEngineMockDb({
      rules: [blankRule({ createdAt: new Date("2026-06-13T00:00:00Z") })], // regla creada HOY
      definition: blankDefinition(),
    });
    // Un hecho genuinamente nuevo en BD, pero cuyo occurredAt real es de hace 3 semanas (sync tardía).
    const result = await evaluateBenefitsForOrigin(blankOrigin({ occurredAt: new Date("2026-05-22T21:00:00Z") }), db);
    expect(result).toEqual([]);
  });

  it("un hecho posterior a la creación de la regla sí la dispara con normalidad", async () => {
    const { db } = makeRuleEngineMockDb({
      rules: [blankRule({ createdAt: new Date("2026-06-01T00:00:00Z") })],
      definition: blankDefinition(),
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin({ occurredAt: new Date("2026-06-12T21:00:00Z") }), db);
    expect(result).toHaveLength(1);
  });
});

// SEGOLIFE — VENUE VISIT como trigger real (Fase 6, spec §5/§41 test #8) —
// cierra la laguna de Fase 5 (venue_visit existía en el enum pero sin
// productor). El motor en sí es agnóstico del sourceType concreto — este
// test prueba que "venue_visit" fluye exactamente igual que cualquier otro
// origen ya cubierto arriba, sin caso especial.
describe("evaluateBenefitsForOrigin — venue_visit como origen real (spec §5)", () => {
  it("una regla con sourceType='venue_visit' concede al recibir un origen de ese tipo", async () => {
    const { db } = makeRuleEngineMockDb({
      rules: [blankRule({ sourceType: "venue_visit" })],
      definition: blankDefinition(),
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin({ type: "venue_visit", eventId: null, amountCents: null }), db);
    expect(result).toHaveLength(1);
  });
});

// SEGOLIFE — MÉTRICAS DE AGREGADO (Fase 6, spec §6/§7/§14, Example B "5
// consumiciones"). aggregateMetric tiene prioridad sobre minVisits/
// recurrenceWindow legacy y usa las tablas de hechos reales
// (benefitAggregateMetrics.ts, mockeado aquí — su lógica de conteo se
// prueba por separado en benefitAggregateMetrics.test.ts).
describe("evaluateBenefitsForOrigin — aggregate_metric (umbral sobre hechos reales, spec §6/§7)", () => {
  beforeEach(() => { mockEvaluateAggregateMetric.mockReset(); });

  it("umbral alcanzado (evaluateAggregateMetric=true) → concede", async () => {
    mockEvaluateAggregateMetric.mockResolvedValue(true);
    const { db } = makeRuleEngineMockDb({
      rules: [blankRule({ aggregateMetric: "commerce_count", aggregateThreshold: 5, recurrenceWindow: "day" })],
      definition: blankDefinition(),
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin(), db);
    expect(result).toHaveLength(1);
    expect(mockEvaluateAggregateMetric).toHaveBeenCalledWith("commerce_count", "day", 5, 42, 10, expect.any(Date), expect.anything());
  });

  it("umbral NO alcanzado (evaluateAggregateMetric=false) → no concede (spec §41 test #14: 'below threshold → no grant')", async () => {
    mockEvaluateAggregateMetric.mockResolvedValue(false);
    const { db } = makeRuleEngineMockDb({
      rules: [blankRule({ aggregateMetric: "commerce_count", aggregateThreshold: 5 })],
      definition: blankDefinition(),
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin(), db);
    expect(result).toEqual([]);
  });

  it("aggregate_metric tiene prioridad sobre min_visits/recurrence_window legacy cuando ambos están presentes", async () => {
    mockEvaluateAggregateMetric.mockResolvedValue(true);
    const { db } = makeRuleEngineMockDb({
      // min_visits=999 haría fallar la condición legacy si se evaluara — la aggregate gana y nunca se llega a mirar min_visits.
      rules: [blankRule({ aggregateMetric: "venue_visit_count", aggregateThreshold: 3, minVisits: 999, recurrenceWindow: "day" })],
      definition: blankDefinition(),
    });
    const result = await evaluateBenefitsForOrigin(blankOrigin(), db);
    expect(result).toHaveLength(1);
  });

  it("sin ventana configurada, usa 'day' por defecto", async () => {
    mockEvaluateAggregateMetric.mockResolvedValue(true);
    const { db } = makeRuleEngineMockDb({
      rules: [blankRule({ aggregateMetric: "commerce_count", aggregateThreshold: 5, recurrenceWindow: null })],
      definition: blankDefinition(),
    });
    await evaluateBenefitsForOrigin(blankOrigin(), db);
    expect(mockEvaluateAggregateMetric).toHaveBeenCalledWith("commerce_count", "day", 5, 42, 10, expect.any(Date), expect.anything());
  });
});

// SEGOLIFE — THRESHOLD CROSSING / IDEMPOTENCIA CONCURRENTE (Fase 6, spec
// §13/§14 — CRITICAL, "concurrent 5th does not duplicate"). Con
// once_per_rule=true la clave de idempotencia YA NO depende de sourceId
// (ver buildIdempotencyKey) — dos hechos DISTINTOS que ambos crucen el
// umbral colisionan en la MISMA clave, así que el segundo nunca duplica
// aunque "aparente" que el motor todavía no había concedido nada cuando se
// evaluó (el unique constraint de la BD, no una lectura en memoria, es
// quien decide).
describe("evaluateBenefitsForOrigin — once_per_rule con clave fija (spec §14, umbral cruzado por hechos DISTINTOS)", () => {
  it("dos hechos distintos (sourceId diferente) que ambos cumplen el umbral con once_per_rule=true producen UN solo beneficio, nunca dos", async () => {
    mockEvaluateAggregateMetric.mockResolvedValue(true);
    const { db, getUserBenefitRows } = makeRuleEngineMockDb({
      rules: [blankRule({ aggregateMetric: "commerce_count", aggregateThreshold: 5, oncePerRule: true })],
      definition: blankDefinition(),
    });
    // Transacción #5 cruza el umbral — concede.
    const first = await evaluateBenefitsForOrigin(blankOrigin({ sourceId: 5005 }), db);
    // Transacción #6, evaluada de nuevo (p.ej. reintento tardío o llegada casi simultánea) — sourceId DISTINTO.
    const second = await evaluateBenefitsForOrigin(blankOrigin({ sourceId: 5006 }), db);
    expect(first).toHaveLength(1);
    expect(second).toEqual([]); // bloqueado por la MISMA clave de idempotencia (once:user:42), no por sourceId
    expect(getUserBenefitRows()).toHaveLength(1);
  });

  it("la clave de idempotencia de una regla once_per_rule=true NUNCA incluye el sourceId del origen", async () => {
    mockEvaluateAggregateMetric.mockResolvedValue(true);
    const { db, getUserBenefitRows } = makeRuleEngineMockDb({
      rules: [blankRule({ id: 7, oncePerRule: true, aggregateMetric: "commerce_count", aggregateThreshold: 5 })],
      definition: blankDefinition(),
    });
    await evaluateBenefitsForOrigin(blankOrigin({ sourceId: 12345 }), db);
    const key = getUserBenefitRows()[0].idempotencyKey as string;
    expect(key).toBe("benefit_rule:7:once:user:42");
    expect(key).not.toContain("12345");
  });
});
