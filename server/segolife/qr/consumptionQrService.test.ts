/**
 * consumptionQrService.test.ts — emisión, canje atómico y cancelación de QR
 * de consumición (Fase 3). El mock reproduce fielmente la semántica de
 * MySQL para el UPDATE condicional de un solo uso (`WHERE status='issued'`,
 * comprobando affectedRows) y simula un ROLLBACK real de `.transaction()`
 * descartando todos los cambios si el callback lanza — así se puede probar
 * honestamente "fallo tokens → QR no redeemed" sin una BD real.
 */
import { describe, it, expect } from "vitest";
import {
  issueConsumptionQr,
  issueQrBatch,
  redeemConsumptionQr,
  cancelConsumptionQr,
  QrError,
} from "./consumptionQrService";
import {
  consumptionQrCodes,
  qrBatches,
  qrRedemptionAttempts,
  venues,
  venueProducts,
  communityVenues,
  tokenRules,
  tokenLedger,
  tokenWallets,
  tokenCampaigns,
  venueTokenSchedules,
} from "../../../drizzle/schema";
import { TokenEngineError } from "../tokens/tokenLedgerService";

function blankQr(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, codeHash: "hash1", venueId: 10, productId: null, amountCents: null, quantity: 1,
    batchId: null, issuedAt: new Date("2026-01-01"), expiresAt: null, status: "issued",
    redeemedAt: null, redeemedByUserId: null, ledgerId: null, sourceType: "manual",
    sourceReference: null, issuedByUserId: null, terminalId: null,
    cancelledAt: null, cancelledByUserId: null, cancelReason: null, metadata: null,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function blankVenue(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 10, name: "Chin Chin", slug: "chin-chin", status: "active", city: "Segovia", createdAt: new Date(), updatedAt: new Date(), ...overrides };
}

function blankRule(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, name: "Consumición", description: null, direction: "earn", origin: "consumption",
    scope: "global", scopeCommunityId: null, scopeVenueId: null, scopeEventId: null, scopeProductId: null,
    calcMethod: "fixed", fixedAmount: 20, rate: null, multiplier: null, minSpend: null,
    maxTokens: null, dailyLimit: null, monthlyLimit: null,
    recurrenceWindow: null, recurrenceThreshold: null, recurrenceMode: null,
    startsAt: null, endsAt: null, active: true, priority: 0,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Mock combinado: estado real de UN qr + UN wallet + ledger — comparte
 * estado entre llamadas de nivel raíz (pre-checks, cancel, expirar
 * perezosamente) y las de dentro de `.transaction()` (canje atómico),
 * simulando ROLLBACK real si el callback de la transacción lanza.
 */
function makeQrServiceMockDb(config: {
  qr: Record<string, unknown>;
  venue?: Record<string, unknown> | null;
  product?: Record<string, unknown> | null;
  venueCommunityRows?: Array<{ communityId: number }>;
  rules?: Array<Record<string, unknown>>;
  schedules?: Array<Record<string, unknown>>;
  wallet?: Record<string, unknown>;
}) {
  let qr = { ...config.qr };
  let wallet = config.wallet ?? { id: 1, userId: 42, balance: 0, lifetimeEarned: 0, lifetimeSpent: 0, status: "active", createdAt: new Date(), updatedAt: new Date() };
  const ledgerRows: Array<Record<string, unknown>> = [];
  const attempts: Array<Record<string, unknown>> = [];
  let nextLedgerId = 1;

  function makeBuilder() {
    let mode: "select" | "insert" | "update" = "select";
    let table: unknown = null;
    let pendingFields: Record<string, unknown> = {};
    let hasInsertedLedger = false;
    let insertedLedgerRow: Record<string, unknown> | null = null;

    const b: Record<string, unknown> = {};
    b.select = () => { mode = "select"; return b; };
    b.from = (t: unknown) => { table = t; return b; };
    b.insert = (t: unknown) => { mode = "insert"; table = t; return b; };
    b.update = (t: unknown) => { mode = "update"; table = t; return b; };
    b.set = (fields: Record<string, unknown>) => { pendingFields = fields; return b; };
    b.limit = () => b;
    b.for = () => b;
    b.where = () => {
      if (mode === "update") {
        if (table === tokenWallets) {
          wallet = { ...wallet, ...pendingFields };
          return Promise.resolve([{ affectedRows: 1 }]);
        }
        if (table === consumptionQrCodes) {
          if ("status" in pendingFields) {
            const conditionMet = qr.status === "issued";
            if (conditionMet) qr = { ...qr, ...pendingFields };
            return Promise.resolve([{ affectedRows: conditionMet ? 1 : 0 }]);
          }
          qr = { ...qr, ...pendingFields };
          return Promise.resolve([{ affectedRows: 1 }]);
        }
      }
      return b;
    };
    b.values = (v: Record<string, unknown>) => {
      if (table === qrRedemptionAttempts) {
        attempts.push(v);
        return Promise.resolve([{ insertId: attempts.length }]);
      }
      if (table === tokenWallets) {
        wallet = { id: 1, balance: 0, lifetimeEarned: 0, lifetimeSpent: 0, status: "active", createdAt: new Date(), updatedAt: new Date(), ...v };
        return Promise.resolve([{ insertId: 1 }]);
      }
      if (table === consumptionQrCodes) {
        qr = { id: 1, status: "issued", quantity: 1, sourceType: "manual", createdAt: new Date(), updatedAt: new Date(), ...v };
        return Promise.resolve([{ insertId: 1 }]);
      }
      if (table === qrBatches) {
        return Promise.resolve([{ insertId: 1 }]);
      }
      const row = { id: nextLedgerId++, ...v };
      ledgerRows.push(row);
      insertedLedgerRow = row;
      hasInsertedLedger = true;
      return Promise.resolve([{ insertId: row.id }]);
    };
    b.then = (resolve: (v: unknown) => void) => {
      if (table === consumptionQrCodes) return resolve([qr]);
      if (table === venues) return resolve(config.venue !== undefined ? (config.venue ? [config.venue] : []) : [blankVenue()]);
      if (table === venueProducts) return resolve(config.product ? [config.product] : []);
      if (table === communityVenues) return resolve(config.venueCommunityRows ?? []);
      if (table === tokenRules) return resolve(config.rules ?? [blankRule()]);
      if (table === tokenCampaigns) return resolve([]);
      if (table === venueTokenSchedules) return resolve(config.schedules ?? []);
      if (table === tokenWallets) return resolve([wallet]);
      if (table === tokenLedger) return resolve(hasInsertedLedger ? [insertedLedgerRow] : []);
      if (table === qrBatches) return resolve([{ id: 1, venueId: qr.venueId, quantity: 1, createdAt: new Date() }]);
      return resolve([]);
    };
    // Transacción anidada (savepoint real en MySQL, ver tokenLedgerService.ts)
    // — el mock la trata como una ejecución directa sobre estado compartido;
    // el rollback real lo cubre la transacción EXTERNA (root.transaction).
    b.transaction = (cb: (tx: unknown) => Promise<unknown>) => cb(makeBuilder());
    return b;
  }

  const root: Record<string, unknown> = {
    select: () => makeBuilder().select(),
    insert: (t: unknown) => makeBuilder().insert(t),
    update: (t: unknown) => makeBuilder().update(t),
  };

  root.transaction = async (cb: (tx: unknown) => Promise<unknown>) => {
    const qrSnapshot = { ...qr };
    const walletSnapshot = { ...wallet };
    const ledgerSnapshot = [...ledgerRows];
    try {
      return await cb(makeBuilder());
    } catch (err) {
      qr = qrSnapshot;
      wallet = walletSnapshot;
      ledgerRows.length = 0;
      ledgerRows.push(...ledgerSnapshot);
      throw err;
    }
  };

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: root as any,
    getQr: () => qr,
    getWallet: () => wallet,
    getLedgerRows: () => ledgerRows,
    getAttempts: () => attempts,
  };
}

describe("consumptionQrService — emisión (issueConsumptionQr)", () => {
  it("genera un token único por QR y solo persiste su hash", async () => {
    const { db: db1 } = makeQrServiceMockDb({ qr: blankQr() });
    const issued1 = await issueConsumptionQr({ venueId: 10 }, db1);
    const { db: db2 } = makeQrServiceMockDb({ qr: blankQr() });
    const issued2 = await issueConsumptionQr({ venueId: 10 }, db2);

    expect(issued1.publicToken).not.toBe(issued2.publicToken);
    expect(issued1.qr.codeHash).not.toBe(issued1.publicToken); // nunca se guarda el token en claro
    expect(issued1.qr.codeHash).toHaveLength(64); // SHA-256 hex
  });

  it("guarda el importe en céntimos como entero (nunca float)", async () => {
    const { db, getQr } = makeQrServiceMockDb({ qr: blankQr() });
    await issueConsumptionQr({ venueId: 10, amountCents: 1850 }, db);
    expect(getQr().amountCents).toBe(1850);
    expect(Number.isInteger(getQr().amountCents)).toBe(true);
  });
});

describe("consumptionQrService — emisión en lote (issueQrBatch)", () => {
  it("genera N códigos únicos, todos asociados al mismo batch", async () => {
    const { db } = makeQrServiceMockDb({ qr: blankQr() });
    const result = await issueQrBatch({ venueId: 10, quantity: 5, createdByUserId: 1 }, db);
    expect(result.qrs).toHaveLength(5);
    const tokens = new Set(result.qrs.map(q => q.publicToken));
    expect(tokens.size).toBe(5); // todos únicos
    result.qrs.forEach(q => expect(q.qr.batchId).toBe(result.batch.id));
  });
});

describe("consumptionQrService — canje (redeemConsumptionQr)", () => {
  it("un canje válido acredita tokens, marca el QR redeemed y adjunta ledgerId", async () => {
    const { db, getQr, getWallet, getLedgerRows } = makeQrServiceMockDb({
      qr: blankQr({ amountCents: 1000 }),
      venue: blankVenue(),
      rules: [blankRule({ fixedAmount: 20 })],
    });
    const result = await redeemConsumptionQr({ token: "sometoken", userId: 42 }, db);

    expect(result.breakdown.final).toBe(20);
    expect(result.balanceAfter).toBe(20);
    expect(result.balanceBefore).toBe(0);
    expect(getQr().status).toBe("redeemed");
    expect(getQr().ledgerId).toBeDefined();
    expect(getWallet().balance).toBe(20);
    expect(getLedgerRows()).toHaveLength(1);
    expect(getLedgerRows()[0].idempotencyKey).toBe(`consumption_qr:${getQr().id}`);
  });

  it("un QR ya canjeado lanza ALREADY_REDEEMED", async () => {
    const { db, getAttempts } = makeQrServiceMockDb({
      qr: blankQr({ status: "redeemed" }),
      venue: blankVenue(),
    });
    await expect(redeemConsumptionQr({ token: "x", userId: 42 }, db)).rejects.toMatchObject({ code: "ALREADY_REDEEMED" });
    expect(getAttempts()).toHaveLength(1);
    expect(getAttempts()[0].result).toBe("already_redeemed");
  });

  it("un QR cancelado lanza CANCELLED", async () => {
    const { db } = makeQrServiceMockDb({ qr: blankQr({ status: "cancelled" }), venue: blankVenue() });
    await expect(redeemConsumptionQr({ token: "x", userId: 42 }, db)).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("un QR caducado lanza EXPIRED y lo marca expired perezosamente", async () => {
    const { db, getQr } = makeQrServiceMockDb({
      qr: blankQr({ expiresAt: new Date("2020-01-01") }),
      venue: blankVenue(),
    });
    await expect(redeemConsumptionQr({ token: "x", userId: 42 }, db)).rejects.toMatchObject({ code: "EXPIRED" });
    expect(getQr().status).toBe("expired");
  });

  it("un token que no resuelve a ningún QR lanza NOT_FOUND", async () => {
    const { db, getAttempts } = makeQrServiceMockDb({ qr: blankQr() });
    // Simula "no encontrado" — el mock de consumptionQrCodes normalmente
    // devuelve el QR sembrado; para simular ausencia real se sobreescribe
    // devolviendo un venue nulo y ningún qr coincidente vía un mock dedicado.
    const emptyDb = {
      select: () => ({
        from: (t: unknown) => ({
          where: () => ({ limit: () => ({ then: (resolve: (v: unknown) => void) => resolve(t === consumptionQrCodes ? [] : []) }) }),
        }),
      }),
      insert: (t: unknown) => ({
        values: (v: Record<string, unknown>) => { if (t === qrRedemptionAttempts) getAttempts().push(v); return Promise.resolve([{ insertId: 1 }]); },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    await expect(redeemConsumptionQr({ token: "no-existe", userId: 42 }, emptyDb)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("un venue inactivo lanza VENUE_INACTIVE", async () => {
    const { db } = makeQrServiceMockDb({ qr: blankQr(), venue: blankVenue({ status: "inactive" }) });
    await expect(redeemConsumptionQr({ token: "x", userId: 42 }, db)).rejects.toMatchObject({ code: "VENUE_INACTIVE" });
  });

  it("un producto inactivo lanza PRODUCT_INACTIVE", async () => {
    const { db } = makeQrServiceMockDb({
      qr: blankQr({ productId: 5 }),
      venue: blankVenue(),
      product: { id: 5, venueId: 10, name: "Cóctel", slug: "coctel", isActive: false, category: null, price: null, metadata: null, createdAt: new Date(), updatedAt: new Date() },
    });
    await expect(redeemConsumptionQr({ token: "x", userId: 42 }, db)).rejects.toMatchObject({ code: "PRODUCT_INACTIVE" });
  });

  it("un venue vinculado a otra comunidad lanza COMMUNITY_NOT_AUTHORIZED", async () => {
    const { db } = makeQrServiceMockDb({
      qr: blankQr(),
      venue: blankVenue(),
      venueCommunityRows: [{ communityId: 1 }], // venue solo pertenece a la comunidad 1
    });
    await expect(redeemConsumptionQr({ token: "x", userId: 42, communityId: 2 }, db)).rejects.toMatchObject({ code: "COMMUNITY_NOT_AUTHORIZED" });
  });

  it("un venue sin ninguna comunidad vinculada NO bloquea el canje (dato no configurado, no restrictivo)", async () => {
    const { db } = makeQrServiceMockDb({
      qr: blankQr(),
      venue: blankVenue(),
      venueCommunityRows: [],
      rules: [blankRule()],
    });
    const result = await redeemConsumptionQr({ token: "x", userId: 42, communityId: 2 }, db);
    expect(result.breakdown.final).toBeGreaterThan(0);
  });

  it("sin regla aplicable, propaga NO_RULE_FOUND del motor de tokens y el QR NO queda redeemed (rollback)", async () => {
    const { db, getQr, getWallet } = makeQrServiceMockDb({
      qr: blankQr(),
      venue: blankVenue(),
      rules: [], // ninguna regla activa
    });
    await expect(redeemConsumptionQr({ token: "x", userId: 42 }, db)).rejects.toThrow(TokenEngineError);
    expect(getQr().status).toBe("issued"); // el rollback deshizo la marca redeemed
    expect(getWallet().balance).toBe(0);
  });

  it("fuera de horario, propaga OUTSIDE_SCHEDULE y el QR NO queda redeemed (rollback)", async () => {
    const { db, getQr } = makeQrServiceMockDb({
      qr: blankQr(),
      venue: blankVenue(),
      rules: [blankRule()],
      // day_of_week=99 nunca coincide con ningún día real → siempre fuera de horario.
      schedules: [{ id: 1, venueId: 10, operationType: "earn", dayOfWeek: 99, startTime: "00:00", endTime: "00:00", active: true, timezone: "Europe/Madrid", validFrom: null, validTo: null }],
    });
    await expect(redeemConsumptionQr({ token: "x", userId: 42 }, db)).rejects.toThrow(TokenEngineError);
    expect(getQr().status).toBe("issued");
  });
});

describe("consumptionQrService — atomicidad y concurrencia (dos canjes simultáneos del mismo QR)", () => {
  it("de dos canjes concurrentes del mismo QR, solo uno se acredita", async () => {
    const { db, getWallet, getLedgerRows } = makeQrServiceMockDb({
      qr: blankQr(),
      venue: blankVenue(),
      rules: [blankRule({ fixedAmount: 15 })],
    });

    const results = await Promise.allSettled([
      redeemConsumptionQr({ token: "same-token", userId: 42 }, db),
      redeemConsumptionQr({ token: "same-token", userId: 42 }, db),
    ]);

    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(getWallet().balance).toBe(15); // solo se acreditó una vez
    expect(getLedgerRows()).toHaveLength(1);
  });
});

describe("consumptionQrService — cancelación (cancelConsumptionQr)", () => {
  it("cancela un QR issued", async () => {
    const { db, getQr } = makeQrServiceMockDb({ qr: blankQr() });
    const updated = await cancelConsumptionQr({ qrId: 1, reason: "Impreso por error", cancelledByUserId: 1 }, db);
    expect(updated.status).toBe("cancelled");
    expect(getQr().cancelReason).toBe("Impreso por error");
  });

  it("un QR ya redeemed no se puede cancelar (CANNOT_CANCEL)", async () => {
    const { db } = makeQrServiceMockDb({ qr: blankQr({ status: "redeemed" }) });
    await expect(cancelConsumptionQr({ qrId: 1, reason: "x", cancelledByUserId: 1 }, db)).rejects.toMatchObject({ code: "CANNOT_CANCEL" });
  });

  it("requiere un motivo", async () => {
    const { db } = makeQrServiceMockDb({ qr: blankQr() });
    await expect(cancelConsumptionQr({ qrId: 1, reason: "  ", cancelledByUserId: 1 }, db)).rejects.toMatchObject({ code: "REASON_REQUIRED" });
  });
});
