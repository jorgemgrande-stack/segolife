/**
 * benefits.test.ts — RBAC a nivel de router (Fase 4). Mismo patrón que
 * server/routers/consumptionQr.test.ts (Fase 3): todos los procedures
 * (admin, staff y autoservicio del estudiante) exigen sesión —
 * protectedProcedure/permissionProcedure rechazan ANTES de tocar la BD, así
 * que se prueban con `ctx.user = null` sin mockear nada más.
 * `staffRedeem`/`myBenefits`/`getMyBenefit` están explícitamente marcados
 * como PROTEGIDOS en el roadmap (nunca públicos) — se verifican aquí igual
 * que el resto (ver server/authGuard.ts, bug de Fase 1D).
 *
 * Sección de OWNERSHIP DEL QR (revisión de seguridad de cierre de Fase 4):
 * mockea server/db/benefitsDb.ts (mismo patrón que
 * server/_core/communityAccess.test.ts) para poder controlar exactamente
 * qué fila devuelve getUserBenefitWithDefinition/listUserBenefits con una
 * sesión REAL — las pruebas de "rechaza sin sesión" de arriba nunca llegan
 * a la BD, así que ese mock no las afecta.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetUserBenefitWithDefinition, mockListUserBenefits } = vi.hoisted(() => ({
  mockGetUserBenefitWithDefinition: vi.fn(),
  mockListUserBenefits: vi.fn(),
}));

vi.mock("../db/benefitsDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/benefitsDb")>();
  return {
    ...actual,
    getUserBenefitWithDefinition: mockGetUserBenefitWithDefinition,
    listUserBenefits: mockListUserBenefits,
  };
});

import { benefitsRouter } from "./benefits";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return benefitsRouter.createCaller({ user: null } as any);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAs(userId: number) {
  return benefitsRouter.createCaller({ user: { id: userId, role: "user" } } as any);
}

function benefitFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, userId: 42, benefitDefinitionId: 1, benefitRuleId: null,
    sourceType: "manual", sourceId: null, sourceVenueId: null, sourceEventId: null, sourceLedgerId: null,
    communityId: null, status: "active", grantedAt: new Date(),
    validFrom: new Date(Date.now() - 60_000), validUntil: null,
    usedAt: null, usedAtVenueId: null, usedAtEventId: null, usedByStaffUserId: null,
    qrToken: "secret-plaintext-token", qrTokenHash: "hash-of-secret", idempotencyKey: null, metadata: null,
    grantedByUserId: null, cancelledAt: null, cancelledByUserId: null, cancellationReason: null,
    createdAt: new Date(), updatedAt: new Date(),
    definition: { id: 1, name: "Entrada gratis", slug: "entrada-gratis", description: null, benefitType: "free_entry", destinationVenueId: null, destinationEventId: null, productId: null, discountType: null, discountValue: null, valueMetadata: null, active: true, imageUrl: null, nameEn: null, nameEs: null, descriptionEn: null, descriptionEs: null, termsEn: null, termsEs: null, createdAt: new Date(), updatedAt: new Date() },
    ...overrides,
  };
}

describe("benefits router — getMyBenefit: ownership del token QR en claro", () => {
  beforeEach(() => {
    mockGetUserBenefitWithDefinition.mockReset();
    mockListUserBenefits.mockReset();
  });

  it("otro usuario no puede obtener el qrToken de un beneficio ajeno (NOT_FOUND, no revela que existe)", async () => {
    mockGetUserBenefitWithDefinition.mockResolvedValue(benefitFixture({ userId: 42 }));
    await expect(callerAs(99).getMyBenefit({ id: 1 })).rejects.toMatchObject({ message: expect.stringMatching(/no encontrado/i) });
  });

  it("el owner autorizado sí obtiene el qrToken cuando el beneficio está vigente ahora mismo", async () => {
    mockGetUserBenefitWithDefinition.mockResolvedValue(benefitFixture({ userId: 42, status: "active", validFrom: new Date(Date.now() - 60_000), validUntil: null }));
    const result = await callerAs(42).getMyBenefit({ id: 1 });
    expect(result.qrToken).toBe("secret-plaintext-token");
  });

  it("el owner NO recibe el qrToken si el beneficio todavía no es vigente (validFrom en el futuro)", async () => {
    mockGetUserBenefitWithDefinition.mockResolvedValue(benefitFixture({ userId: 42, validFrom: new Date(Date.now() + 3_600_000) }));
    const result = await callerAs(42).getMyBenefit({ id: 1 });
    expect(result.qrToken).toBeNull();
  });

  it("el owner NO recibe el qrToken de un beneficio ya usado", async () => {
    mockGetUserBenefitWithDefinition.mockResolvedValue(benefitFixture({ userId: 42, status: "used" }));
    const result = await callerAs(42).getMyBenefit({ id: 1 });
    expect(result.qrToken).toBeNull();
  });
});

describe("benefits router — myBenefits: el listado nunca expone qrToken/qrTokenHash", () => {
  it("myBenefits nunca incluye qrToken/qrTokenHash en ninguna fila (listUserBenefits ya los omite a nivel de BD)", async () => {
    // Refleja fielmente la forma real de listUserBenefits (sin qrToken/qrTokenHash) — ver server/db/benefitsDb.ts.
    const { qrToken: _qrToken, qrTokenHash: _qrTokenHash, ...listItem } = benefitFixture();
    mockListUserBenefits.mockResolvedValue([listItem]);
    const result = await callerAs(42).myBenefits();
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty("qrToken");
    expect(result[0]).not.toHaveProperty("qrTokenHash");
  });
});

describe("benefits router — definiciones (admin) rechazan sin sesión", () => {
  it("benefits.listDefinitions rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listDefinitions()).rejects.toThrow(/please login/i);
  });
  it("benefits.getDefinitionById rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getDefinitionById({ id: 1 })).rejects.toThrow(/please login/i);
  });
  it("benefits.createDefinition rechaza sin sesión", async () => {
    await expect(callerWithoutSession().createDefinition({
      name: "x", slug: "x", benefitType: "free_entry",
    } as any)).rejects.toThrow(/please login/i);
  });
  it("benefits.updateDefinition rechaza sin sesión", async () => {
    await expect(callerWithoutSession().updateDefinition({ id: 1 })).rejects.toThrow(/please login/i);
  });
  it("benefits.setDefinitionActive rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setDefinitionActive({ id: 1, active: true })).rejects.toThrow(/please login/i);
  });
  it("benefits.setDefinitionCommunities rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setDefinitionCommunities({ id: 1, communityIds: [] })).rejects.toThrow(/please login/i);
  });
});

describe("benefits router — reglas (admin) rechazan sin sesión", () => {
  it("benefits.listRules rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listRules()).rejects.toThrow(/please login/i);
  });
  it("benefits.getRuleById rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getRuleById({ id: 1 })).rejects.toThrow(/please login/i);
  });
  it("benefits.createRule rechaza sin sesión", async () => {
    await expect(callerWithoutSession().createRule({
      name: "x", sourceType: "consumption", benefitDefinitionId: 1,
    } as any)).rejects.toThrow(/please login/i);
  });
  it("benefits.updateRule rechaza sin sesión", async () => {
    await expect(callerWithoutSession().updateRule({ id: 1 })).rejects.toThrow(/please login/i);
  });
  it("benefits.setRuleActive rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setRuleActive({ id: 1, active: true })).rejects.toThrow(/please login/i);
  });
});

describe("benefits router — concedidos (admin) rechazan sin sesión", () => {
  it("benefits.listGrants rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listGrants({ limit: 50, offset: 0 })).rejects.toThrow(/please login/i);
  });
  it("benefits.manualGrant rechaza sin sesión", async () => {
    await expect(callerWithoutSession().manualGrant({
      userId: 1, benefitDefinitionId: 1, validFrom: new Date(), reason: "x",
    })).rejects.toThrow(/please login/i);
  });
  it("benefits.cancelGrant rechaza sin sesión", async () => {
    await expect(callerWithoutSession().cancelGrant({ userBenefitId: 1, reason: "x" })).rejects.toThrow(/please login/i);
  });
  it("benefits.listRedemptionAttempts rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listRedemptionAttempts({ limit: 50, offset: 0 })).rejects.toThrow(/please login/i);
  });
});

describe("benefits router — asignación de staff a venue (admin) rechaza sin sesión", () => {
  it("benefits.listVenueStaff rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listVenueStaff({})).rejects.toThrow(/please login/i);
  });
  it("benefits.addVenueStaff rechaza sin sesión", async () => {
    await expect(callerWithoutSession().addVenueStaff({ userId: 1, venueId: 1 })).rejects.toThrow(/please login/i);
  });
  it("benefits.removeVenueStaff rechaza sin sesión", async () => {
    await expect(callerWithoutSession().removeVenueStaff({ userId: 1, venueId: 1 })).rejects.toThrow(/please login/i);
  });
});

describe("benefits router — 'Mis Beneficios' del estudiante (nunca público) rechaza sin sesión", () => {
  it("benefits.myBenefits rechaza sin sesión", async () => {
    await expect(callerWithoutSession().myBenefits()).rejects.toThrow(/please login/i);
  });
  it("benefits.getMyBenefit rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getMyBenefit({ id: 1 })).rejects.toThrow(/please login/i);
  });
  it("benefits.myAuthorizedVenues rechaza sin sesión", async () => {
    await expect(callerWithoutSession().myAuthorizedVenues()).rejects.toThrow(/please login/i);
  });
});

describe("benefits router — validación en puerta del staff (nunca público) rechaza sin sesión", () => {
  it("benefits.staffRedeem rechaza sin sesión — endpoint PROTEGIDO, nunca público", async () => {
    await expect(callerWithoutSession().staffRedeem({ token: "0123456789abcdef", venueId: 1 })).rejects.toThrow(/please login/i);
  });
});
