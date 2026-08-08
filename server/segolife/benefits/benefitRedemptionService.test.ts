/**
 * benefitRedemptionService.test.ts — canje (validación en puerta) del QR de
 * un Benefit. Mismo patrón de mock estado-real que consumptionQrService.test.ts
 * (Fase 3): un solo beneficio relevante por mock, UPDATE condicional
 * simulado fielmente para probar single-use y concurrencia honestamente.
 */
import { describe, it, expect } from "vitest";
import { redeemBenefit } from "./benefitRedemptionService";
import { userBenefits, benefitDefinitions, benefitRedemptionAttempts, users } from "../../../drizzle/schema";

function blankBenefit(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, userId: 42, benefitDefinitionId: 1, benefitRuleId: null,
    sourceType: "manual", sourceId: null, sourceVenueId: null, sourceEventId: null, sourceLedgerId: null,
    communityId: null, status: "active", grantedAt: new Date("2026-06-01"),
    validFrom: new Date("2026-06-01T00:00:00Z"), validUntil: null,
    usedAt: null, usedAtVenueId: null, usedAtEventId: null, usedByStaffUserId: null,
    qrToken: "plaintoken", qrTokenHash: "abc123hash", idempotencyKey: null, metadata: null,
    grantedByUserId: null, cancelledAt: null, cancelledByUserId: null, cancellationReason: null,
    createdAt: new Date("2026-06-01"), updatedAt: new Date("2026-06-01"),
    ...overrides,
  };
}

function blankDefinition(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, name: "Entrada gratis Casanova", slug: "entrada-casanova", description: null,
    benefitType: "free_entry", destinationVenueId: 20, destinationEventId: null, productId: null,
    discountType: null, discountValue: null, valueMetadata: null, active: true, imageUrl: null,
    nameEn: null, nameEs: null, descriptionEn: null, descriptionEs: null, termsEn: null, termsEs: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

function makeRedeemMockDb(config: {
  benefit?: Record<string, unknown> | null;
  definition?: Record<string, unknown> | null;
  studentName?: string | null;
}) {
  let benefit = config.benefit ? { ...config.benefit } : null;
  const attempts: Array<Record<string, unknown>> = [];

  const b: any = {};
  let mode: "select" | "insert" | "update" = "select";
  let table: unknown = null;
  let pendingFields: Record<string, unknown> = {};

  b.select = () => { mode = "select"; return b; };
  b.from = (t: unknown) => { table = t; return b; };
  b.insert = (t: unknown) => { mode = "insert"; table = t; return b; };
  b.update = (t: unknown) => { mode = "update"; table = t; return b; };
  b.set = (f: Record<string, unknown>) => { pendingFields = f; return b; };
  b.limit = () => b;
  b.where = () => {
    if (mode === "update" && table === userBenefits) {
      if (!benefit) return Promise.resolve([{ affectedRows: 0 }]);
      const conditionMet = benefit.status === "active";
      if (conditionMet) benefit = { ...benefit, ...pendingFields };
      return Promise.resolve([{ affectedRows: conditionMet ? 1 : 0 }]);
    }
    return b;
  };
  b.values = (v: Record<string, unknown>) => {
    if (table === benefitRedemptionAttempts) {
      attempts.push(v);
      return Promise.resolve([{ insertId: attempts.length }]);
    }
    return Promise.resolve([{ insertId: 1 }]);
  };
  b.then = (resolve: (v: unknown) => void) => {
    if (table === userBenefits) return resolve(benefit ? [benefit] : []);
    if (table === benefitDefinitions) return resolve(config.definition !== undefined ? (config.definition ? [config.definition] : []) : [blankDefinition()]);
    if (table === users) return resolve(config.studentName !== undefined ? (config.studentName ? [{ name: config.studentName }] : []) : [{ name: "Jorge" }]);
    return resolve([]);
  };

  return { db: b as any, getBenefit: () => benefit, getAttempts: () => attempts };
}

describe("benefitRedemptionService — redeemBenefit (validación en puerta)", () => {
  it("un canje válido marca el beneficio used con venue/staff/timestamp reales", async () => {
    const { db, getBenefit, getAttempts } = makeRedeemMockDb({ benefit: blankBenefit() });
    const result = await redeemBenefit({
      token: "x", staffUserId: 7, venueId: 20, staffAuthorizedVenueIds: "all",
    }, db);
    expect(result.userBenefit.status).toBe("used");
    expect(getBenefit()?.status).toBe("used");
    expect(getBenefit()?.usedAtVenueId).toBe(20);
    expect(getBenefit()?.usedByStaffUserId).toBe(7);
    expect(getAttempts()).toHaveLength(1);
    expect(getAttempts()[0].result).toBe("valid");
  });

  it("un token que no resuelve a ningún beneficio lanza NOT_FOUND", async () => {
    const { db, getAttempts } = makeRedeemMockDb({ benefit: null });
    await expect(redeemBenefit({ token: "x", staffUserId: 7, venueId: 20, staffAuthorizedVenueIds: "all" }, db))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(getAttempts()[0].result).toBe("not_found");
  });

  it("un beneficio ya usado lanza ALREADY_USED", async () => {
    const { db } = makeRedeemMockDb({ benefit: blankBenefit({ status: "used" }) });
    await expect(redeemBenefit({ token: "x", staffUserId: 7, venueId: 20, staffAuthorizedVenueIds: "all" }, db))
      .rejects.toMatchObject({ code: "ALREADY_USED" });
  });

  it("un beneficio cancelado lanza CANCELLED", async () => {
    const { db } = makeRedeemMockDb({ benefit: blankBenefit({ status: "cancelled" }) });
    await expect(redeemBenefit({ token: "x", staffUserId: 7, venueId: 20, staffAuthorizedVenueIds: "all" }, db))
      .rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("un beneficio con valid_until pasado lanza EXPIRED y lo marca expired perezosamente", async () => {
    const { db, getBenefit } = makeRedeemMockDb({ benefit: blankBenefit({ validUntil: new Date("2020-01-01") }) });
    await expect(redeemBenefit({ token: "x", staffUserId: 7, venueId: 20, staffAuthorizedVenueIds: "all" }, db))
      .rejects.toMatchObject({ code: "EXPIRED" });
    expect(getBenefit()?.status).toBe("expired");
  });

  it("un beneficio cuyo valid_from todavía no llegó lanza NOT_ACTIVE_YET", async () => {
    const { db } = makeRedeemMockDb({ benefit: blankBenefit({ validFrom: new Date("2099-01-01") }) });
    await expect(redeemBenefit({ token: "x", staffUserId: 7, venueId: 20, staffAuthorizedVenueIds: "all" }, db))
      .rejects.toMatchObject({ code: "NOT_ACTIVE_YET" });
  });

  it("staff sin autorización para este venue lanza UNAUTHORIZED_STAFF (auditado)", async () => {
    const { db, getAttempts } = makeRedeemMockDb({ benefit: blankBenefit() });
    await expect(redeemBenefit({ token: "x", staffUserId: 7, venueId: 20, staffAuthorizedVenueIds: [99] }, db))
      .rejects.toMatchObject({ code: "UNAUTHORIZED_STAFF" });
    expect(getAttempts()[0].result).toBe("unauthorized_staff");
  });

  it("staff autorizado para el venue concreto (no admin global) puede validar", async () => {
    const { db } = makeRedeemMockDb({ benefit: blankBenefit() });
    const result = await redeemBenefit({ token: "x", staffUserId: 7, venueId: 20, staffAuthorizedVenueIds: [20, 30] }, db);
    expect(result.userBenefit.status).toBe("used");
  });

  it("venue de canje distinto al destino de la definición lanza WRONG_VENUE", async () => {
    const { db } = makeRedeemMockDb({ benefit: blankBenefit(), definition: blankDefinition({ destinationVenueId: 20 }) });
    await expect(redeemBenefit({ token: "x", staffUserId: 7, venueId: 99, staffAuthorizedVenueIds: "all" }, db))
      .rejects.toMatchObject({ code: "WRONG_VENUE" });
  });

  it("evento de canje distinto al destino de la definición lanza WRONG_EVENT", async () => {
    const { db } = makeRedeemMockDb({
      benefit: blankBenefit(),
      definition: blankDefinition({ destinationVenueId: null, destinationEventId: 5 }),
    });
    await expect(redeemBenefit({ token: "x", staffUserId: 7, venueId: 20, eventId: 6, staffAuthorizedVenueIds: "all" }, db))
      .rejects.toMatchObject({ code: "WRONG_EVENT" });
  });

  it("una definición sin destino (venue-agnóstica) acepta cualquier venue del staff autorizado", async () => {
    const { db } = makeRedeemMockDb({ benefit: blankBenefit(), definition: blankDefinition({ destinationVenueId: null }) });
    const result = await redeemBenefit({ token: "x", staffUserId: 7, venueId: 55, staffAuthorizedVenueIds: "all" }, db);
    expect(result.userBenefit.status).toBe("used");
  });

  it("privacidad: la respuesta no incluye email/teléfono del estudiante, solo su nombre", async () => {
    const { db } = makeRedeemMockDb({ benefit: blankBenefit(), studentName: "Jorge M." });
    const result = await redeemBenefit({ token: "x", staffUserId: 7, venueId: 20, staffAuthorizedVenueIds: "all" }, db);
    expect(result.studentName).toBe("Jorge M.");
    expect(result).not.toHaveProperty("email");
    expect(result).not.toHaveProperty("phone");
  });
});

describe("benefitRedemptionService — atomicidad y concurrencia (dos validaciones simultáneas)", () => {
  it("de dos validaciones concurrentes del mismo beneficio, solo una gana", async () => {
    const { db, getAttempts } = makeRedeemMockDb({ benefit: blankBenefit() });
    const results = await Promise.allSettled([
      redeemBenefit({ token: "x", staffUserId: 7, venueId: 20, staffAuthorizedVenueIds: "all" }, db),
      redeemBenefit({ token: "x", staffUserId: 8, venueId: 20, staffAuthorizedVenueIds: "all" }, db),
    ]);
    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(getAttempts().filter(a => a.result === "valid")).toHaveLength(1);
    expect(getAttempts().filter(a => a.result === "already_used")).toHaveLength(1);
  });
});
