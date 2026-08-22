/**
 * tokenRuleEngine.test.ts — selección de reglas, cálculo, recurrencia y
 * campañas (Fase 2). Los mocks devuelven directamente lo que "ya habría
 * filtrado" una consulta SQL real (direction/origin/active) — el filtrado
 * real bajo test es el que hace el propio motor en JS (scope, ventana de
 * fechas, prioridad).
 */
import { describe, it, expect } from "vitest";
import {
  findApplicableRule,
  calculateBaseTokens,
  applyRecurrenceBonus,
  findApplicableCampaign,
  applyCampaignToAmount,
} from "./tokenRuleEngine";
import { tokenRules, tokenLedger, tokenCampaigns, campaignCommunities, campaignVenues, campaignEvents } from "../../../drizzle/schema";

function blankRule(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, name: "Regla", description: null, direction: "earn", origin: "manual",
    scope: "global", scopeCommunityId: null, scopeVenueId: null, scopeEventId: null, scopeProductId: null, scopeTicketTypeId: null,
    calcMethod: "fixed", fixedAmount: 10, rate: null, multiplier: null, minSpend: null,
    maxTokens: null, dailyLimit: null, weeklyLimit: null, monthlyLimit: null, lifetimeLimit: null,
    recurrenceWindow: null, recurrenceThreshold: null, recurrenceMode: null,
    startsAt: null, endsAt: null, active: true, priority: 0,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeSimpleMockDb(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.from = () => builder;
  builder.where = () => builder;
  builder.then = (resolve: (v: unknown) => void) => resolve(rows);
  return builder as unknown as Parameters<typeof findApplicableRule>[2];
}

describe("tokenRuleEngine — calculateBaseTokens (pura, sin BD)", () => {
  it("fixed devuelve el importe fijo", () => {
    expect(calculateBaseTokens(blankRule({ calcMethod: "fixed", fixedAmount: 15 }))).toBe(15);
  });

  it("per_euro multiplica rate por el gasto y redondea hacia abajo", () => {
    const rule = blankRule({ calcMethod: "per_euro", rate: "2.5" });
    expect(calculateBaseTokens(rule, { amountSpent: 10 })).toBe(25);
    expect(calculateBaseTokens(rule, { amountSpent: 3 })).toBe(7); // 7.5 → floor 7
  });

  it("percentage calcula el porcentaje del gasto", () => {
    const rule = blankRule({ calcMethod: "percentage", rate: "10" });
    expect(calculateBaseTokens(rule, { amountSpent: 100 })).toBe(10);
  });

  it("multiplier multiplica el gasto directamente", () => {
    const rule = blankRule({ calcMethod: "multiplier", multiplier: "3" });
    expect(calculateBaseTokens(rule, { amountSpent: 4 })).toBe(12);
  });

  it("minSpend no alcanzado devuelve 0", () => {
    const rule = blankRule({ calcMethod: "per_euro", rate: "1", minSpend: "20" });
    expect(calculateBaseTokens(rule, { amountSpent: 10 })).toBe(0);
  });

  it("maxTokens recorta el resultado", () => {
    const rule = blankRule({ calcMethod: "fixed", fixedAmount: 100, maxTokens: 30 });
    expect(calculateBaseTokens(rule)).toBe(30);
  });

  it("nunca devuelve un valor negativo", () => {
    const rule = blankRule({ calcMethod: "per_euro", rate: "-5" });
    expect(calculateBaseTokens(rule, { amountSpent: 10 })).toBe(0);
  });
});

describe("tokenRuleEngine — selección de regla (findApplicableRule)", () => {
  it("selecciona la regla global cuando no hay ninguna más específica", async () => {
    const db = makeSimpleMockDb([blankRule({ id: 1, scope: "global" })]);
    const rule = await findApplicableRule({ direction: "earn", origin: "manual" }, new Date(), db);
    expect(rule?.id).toBe(1);
  });

  it("una regla scope=venue solo aplica al venue exacto (product-specific/venue-specific)", async () => {
    const rule = blankRule({ id: 2, scope: "venue", scopeVenueId: 7 });
    const dbMatch = makeSimpleMockDb([rule]);
    const matched = await findApplicableRule({ direction: "earn", origin: "manual", venueId: 7 }, new Date(), dbMatch);
    expect(matched?.id).toBe(2);

    const dbNoMatch = makeSimpleMockDb([rule]);
    const notMatched = await findApplicableRule({ direction: "earn", origin: "manual", venueId: 99 }, new Date(), dbNoMatch);
    expect(notMatched).toBeNull();
  });

  it("una regla scope=product solo aplica al producto exacto", async () => {
    const rule = blankRule({ id: 3, scope: "product", scopeProductId: 5 });
    const db = makeSimpleMockDb([rule]);
    const matched = await findApplicableRule({ direction: "earn", origin: "product", productId: 5 }, new Date(), db);
    expect(matched?.id).toBe(3);
  });

  it("una regla inactiva nunca la devuelve el motor (el SQL real ya la filtraría)", async () => {
    const db = makeSimpleMockDb([]); // simula WHERE active=true sin resultados
    const rule = await findApplicableRule({ direction: "earn", origin: "manual" }, new Date(), db);
    expect(rule).toBeNull();
  });

  it("excluye una regla fuera de su ventana de fechas (startsAt futuro)", async () => {
    const future = new Date("2099-01-01");
    const db = makeSimpleMockDb([blankRule({ startsAt: future })]);
    const rule = await findApplicableRule({ direction: "earn", origin: "manual" }, new Date("2026-06-01"), db);
    expect(rule).toBeNull();
  });

  it("excluye una regla fuera de su ventana de fechas (endsAt pasado)", async () => {
    const past = new Date("2020-01-01");
    const db = makeSimpleMockDb([blankRule({ endsAt: past })]);
    const rule = await findApplicableRule({ direction: "earn", origin: "manual" }, new Date("2026-06-01"), db);
    expect(rule).toBeNull();
  });

  it("entre varias reglas que encajan, gana la de mayor prioridad", async () => {
    const low = blankRule({ id: 1, priority: 0, fixedAmount: 5 });
    const high = blankRule({ id: 2, priority: 10, fixedAmount: 50 });
    const db = makeSimpleMockDb([low, high]);
    const rule = await findApplicableRule({ direction: "earn", origin: "manual" }, new Date(), db);
    expect(rule?.id).toBe(2);
  });

  // F61 — repro exacto del ejemplo del cliente: regla general de un venue vs.
  // regla específica de un evento de ese mismo venue, ambas encajan a la vez
  // porque el check-in real trae venueId Y eventId simultáneamente
  // (attendancePipeline.ts). Si la del evento tiene mayor prioridad, gana
  // ella pese a que "venue" no es su alcance — el motor NUNCA infiere
  // jerarquías, solo mira el número que puso el admin.
  it("venue general (priority=5) vs. evento específico del mismo venue (priority=10): gana el evento", async () => {
    const venueRule = blankRule({ id: 1, scope: "venue", scopeVenueId: 10, priority: 5, fixedAmount: 10 });
    const eventRule = blankRule({ id: 2, scope: "event", scopeEventId: 77, priority: 10, fixedAmount: 20 });
    const db = makeSimpleMockDb([venueRule, eventRule]);
    const rule = await findApplicableRule({ direction: "earn", origin: "attendance", venueId: 10, eventId: 77 }, new Date(), db);
    expect(rule?.id).toBe(2);
  });

  it("mismo escenario con las prioridades invertidas: gana el venue general, aunque el evento sea 'más específico'", async () => {
    const venueRule = blankRule({ id: 1, scope: "venue", scopeVenueId: 10, priority: 10, fixedAmount: 10 });
    const eventRule = blankRule({ id: 2, scope: "event", scopeEventId: 77, priority: 5, fixedAmount: 20 });
    const db = makeSimpleMockDb([venueRule, eventRule]);
    const rule = await findApplicableRule({ direction: "earn", origin: "attendance", venueId: 10, eventId: 77 }, new Date(), db);
    expect(rule?.id).toBe(1);
  });

  // F61 — desempate DETERMINISTA cuando la prioridad numérica es idéntica:
  // 1) prioridad (ya probado arriba) → 2) especificidad del alcance → 3) id
  // más bajo. Nunca el orden crudo (no garantizado) de un SELECT sin ORDER BY.
  it("empate exacto de prioridad, venue vs evento del mismo venue: gana el alcance más específico (evento)", async () => {
    const venueRule = blankRule({ id: 5, scope: "venue", scopeVenueId: 10, priority: 5 });
    const eventRule = blankRule({ id: 1, scope: "event", scopeEventId: 77, priority: 5 }); // id más bajo, pero NO debe ganar por eso
    const db = makeSimpleMockDb([venueRule, eventRule]);
    const rule = await findApplicableRule({ direction: "earn", origin: "attendance", venueId: 10, eventId: 77 }, new Date(), db);
    expect(rule?.id).toBe(1); // gana por especificidad (event > venue), no por prioridad ni por id
  });

  it("empate exacto de prioridad Y de especificidad de alcance: gana el id más bajo (la regla creada primero)", async () => {
    const older = blankRule({ id: 3, scope: "global", priority: 5 });
    const newer = blankRule({ id: 9, scope: "global", priority: 5 });
    const db = makeSimpleMockDb([newer, older]); // orden de lectura deliberadamente "al revés"
    const rule = await findApplicableRule({ direction: "earn", origin: "manual" }, new Date(), db);
    expect(rule?.id).toBe(3);
  });

  it("una regla scope=ticket_type solo aplica al tipo de entrada exacto (Loyalty Production Hardening)", async () => {
    const rule = blankRule({ id: 4, scope: "ticket_type", scopeTicketTypeId: 77 });
    const dbMatch = makeSimpleMockDb([rule]);
    const matched = await findApplicableRule({ direction: "earn", origin: "ticket", ticketTypeId: 77 }, new Date(), dbMatch);
    expect(matched?.id).toBe(4);

    const dbNoMatch = makeSimpleMockDb([rule]);
    const notMatched = await findApplicableRule({ direction: "earn", origin: "ticket", ticketTypeId: 99 }, new Date(), dbNoMatch);
    expect(notMatched).toBeNull();

    const dbNoTicketType = makeSimpleMockDb([rule]);
    const noTicketType = await findApplicableRule({ direction: "earn", origin: "ticket" }, new Date(), dbNoTicketType);
    expect(noTicketType).toBeNull(); // sin ticketTypeId en el contexto, una regla ticket_type-específica nunca encaja
  });
});

describe("tokenRuleEngine — recurrencia (applyRecurrenceBonus)", () => {
  function makeRecurrenceMockDb(rules: unknown[], ledgerRows: unknown[]) {
    let table: unknown = null;
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.from = (t: unknown) => { table = t; return builder; };
    builder.where = () => builder;
    builder.then = (resolve: (v: unknown) => void) => {
      if (table === tokenRules) return resolve(rules);
      if (table === tokenLedger) return resolve(ledgerRows);
      return resolve([]);
    };
    return builder as unknown as Parameters<typeof applyRecurrenceBonus>[1];
  }

  it("dispara el bonus exactamente en la 2ª visita de la semana (threshold=2)", async () => {
    const rule = blankRule({ id: 5, origin: "recurrence", calcMethod: "fixed", fixedAmount: 10, recurrenceWindow: "week", recurrenceThreshold: 2, recurrenceMode: "visit_count" });
    // 1 visita ya contabilizada esta semana → +1 (esta) = 2 = threshold
    const db = makeRecurrenceMockDb([rule], [{ id: 100 }]);
    const result = await applyRecurrenceBonus({ userId: 42 }, db);
    expect(result.bonus).toBe(10);
    expect(result.rule?.id).toBe(5);
  });

  it("NO dispara en la 1ª visita (count+1=1, distinto de threshold=2)", async () => {
    const rule = blankRule({ id: 5, origin: "recurrence", recurrenceWindow: "week", recurrenceThreshold: 2, recurrenceMode: "visit_count" });
    const db = makeRecurrenceMockDb([rule], []); // 0 visitas previas
    const result = await applyRecurrenceBonus({ userId: 42 }, db);
    expect(result.bonus).toBe(0);
    expect(result.rule).toBeNull();
  });

  it("modo distinct_venues cuenta venues distintos, no visitas totales", async () => {
    const rule = blankRule({ id: 6, origin: "recurrence", calcMethod: "fixed", fixedAmount: 25, recurrenceWindow: "month", recurrenceThreshold: 3, recurrenceMode: "distinct_venues" });
    // 2 venues distintos ya visitados este mes → +1 (este, un 3º venue nuevo) = 3 = threshold
    const db = makeRecurrenceMockDb([rule], [{ venueId: 1 }, { venueId: 2 }]);
    const result = await applyRecurrenceBonus({ userId: 42 }, db);
    expect(result.bonus).toBe(25);
  });

  it("sin reglas de recurrencia activas, no hay bonus", async () => {
    const db = makeRecurrenceMockDb([], []);
    const result = await applyRecurrenceBonus({ userId: 42 }, db);
    expect(result).toEqual({ bonus: 0, rule: null });
  });

  it("recurrence_window='lifetime' dispara un hito real (5ª visita) sin reiniciarse por periodo (Loyalty Production Hardening)", async () => {
    const rule = blankRule({ id: 7, origin: "recurrence", calcMethod: "fixed", fixedAmount: 50, recurrenceWindow: "lifetime", recurrenceThreshold: 5, recurrenceMode: "visit_count" });
    // 4 visitas previas de TODA la vida (independiente de cuándo ocurrieron) → +1 (esta) = 5 = threshold
    const db = makeRecurrenceMockDb([rule], [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    const result = await applyRecurrenceBonus({ userId: 42 }, db);
    expect(result.bonus).toBe(50);
    expect(result.rule?.id).toBe(7);
  });

  it("recurrence_window='lifetime' NO dispara de nuevo en la 6ª visita si el umbral es 5 (idempotencia de hito)", async () => {
    const rule = blankRule({ id: 7, origin: "recurrence", calcMethod: "fixed", fixedAmount: 50, recurrenceWindow: "lifetime", recurrenceThreshold: 5, recurrenceMode: "visit_count" });
    const db = makeRecurrenceMockDb([rule], [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]); // ya van 5 — esta sería la 6ª
    const result = await applyRecurrenceBonus({ userId: 42 }, db);
    expect(result.bonus).toBe(0);
  });
});

describe("tokenRuleEngine — campañas (findApplicableCampaign / applyCampaignToAmount)", () => {
  /**
   * findApplicableCampaign lanza 3 SELECTs CONCURRENTES (Promise.all) por
   * cada campaña — un mock con una única variable `table` compartida se
   * pisaría entre las 3 llamadas (la última `.from()` en construirse gana
   * para las 3, aunque cada `.then()` se invoque más tarde). Cada `.from()`
   * debe devolver un closure PROPIO que capture su tabla en el momento de la
   * llamada — mismo patrón ya usado en venuesDb.test.ts (makeDetailMockDb).
   */
  function makeCampaignMockDb(campaigns: unknown[]) {
    const communityQueue: unknown[][] = [];
    const venueQueue: unknown[][] = [];
    const eventQueue: unknown[][] = [];

    function makeQueryFor(table: unknown) {
      const q: Record<string, unknown> = {};
      q.where = () => q;
      q.then = (resolve: (v: unknown) => void) => {
        if (table === tokenCampaigns) return resolve(campaigns);
        if (table === campaignCommunities) return resolve(communityQueue.shift() ?? []);
        if (table === campaignVenues) return resolve(venueQueue.shift() ?? []);
        if (table === campaignEvents) return resolve(eventQueue.shift() ?? []);
        return resolve([]);
      };
      return q;
    }

    const root = { select: () => ({ from: (t: unknown) => makeQueryFor(t) }) };
    return {
      db: root as unknown as Parameters<typeof findApplicableCampaign>[1],
      queueCommunities: (r: unknown[]) => communityQueue.push(r),
      queueVenues: (r: unknown[]) => venueQueue.push(r),
      queueEvents: (r: unknown[]) => eventQueue.push(r),
    };
  }

  function blankCampaign(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 1, name: "Campaña", description: null, multiplier: "2.00", bonusTokens: null,
      startsAt: null, endsAt: null, active: true, priority: 0,
      createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
      ...overrides,
    };
  }

  it("una campaña sin ninguna fila de alcance es global — aplica siempre", async () => {
    const { db, queueCommunities, queueVenues, queueEvents } = makeCampaignMockDb([blankCampaign()]);
    queueCommunities([]); queueVenues([]); queueEvents([]);
    const campaign = await findApplicableCampaign({ venueId: 999 }, db);
    expect(campaign?.id).toBe(1);
  });

  it("una campaña con alcance de venue solo aplica a ese venue", async () => {
    const { db, queueCommunities, queueVenues, queueEvents } = makeCampaignMockDb([blankCampaign({ id: 2 })]);
    queueCommunities([]); queueVenues([{ venueId: 7 }]); queueEvents([]);
    const matched = await findApplicableCampaign({ venueId: 7 }, db);
    expect(matched?.id).toBe(2);

    const { db: db2, queueCommunities: qc2, queueVenues: qv2, queueEvents: qe2 } = makeCampaignMockDb([blankCampaign({ id: 2 })]);
    qc2([]); qv2([{ venueId: 7 }]); qe2([]);
    const notMatched = await findApplicableCampaign({ venueId: 999 }, db2);
    expect(notMatched).toBeNull();
  });

  it("una campaña expirada (endsAt pasado) queda excluida", async () => {
    const { db } = makeCampaignMockDb([blankCampaign({ endsAt: new Date("2020-01-01") })]);
    const campaign = await findApplicableCampaign({ at: new Date("2026-06-01") }, db);
    expect(campaign).toBeNull();
  });

  it("applyCampaignToAmount aplica multiplicador y luego bonus fijo", () => {
    const campaign = blankCampaign({ multiplier: "2.00", bonusTokens: 5 }) as never;
    expect(applyCampaignToAmount(campaign, 20)).toBe(45); // 20*2=40, +5=45
  });

  it("applyCampaignToAmount sin campaña devuelve el importe sin cambios", () => {
    expect(applyCampaignToAmount(null, 30)).toBe(30);
  });
});
