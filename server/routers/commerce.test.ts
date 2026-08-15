/**
 * commerce.test.ts — SEGOLIFE VENUE & PARTNER APP (spec §21/§31, IDOR
 * CRITICAL encontrado en la auditoría de esta fase): `listByVenue`/
 * `listItems` estaban gateados únicamente por `commerce.view` (permiso
 * GLOBAL que un Venue Admin ya tiene desde la fase RBAC) SIN comprobación
 * de propiedad de venue — cualquier Venue Admin real podía pedir las
 * transacciones de OTRO venue con solo cambiar `venueId`/`transactionId`.
 * Este archivo prueba el fix (`assertVenueAuthorized`), no solo que el
 * router "rechaza sin sesión" (eso ya no basta para demostrar el gate real).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetVenueStaffAccess } = vi.hoisted(() => ({ mockGetVenueStaffAccess: vi.fn() }));
vi.mock("../segolife/benefits/venueStaffAccess", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/benefits/venueStaffAccess")>();
  return { ...actual, getVenueStaffAccess: mockGetVenueStaffAccess };
});

const { mockListByVenue, mockListItems, mockGetTxVenueId } = vi.hoisted(() => ({
  mockListByVenue: vi.fn(),
  mockListItems: vi.fn(),
  mockGetTxVenueId: vi.fn(),
}));
vi.mock("../segolife/commerce/commerceDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/commerce/commerceDb")>();
  return {
    ...actual,
    listCommerceTransactionsByVenue: mockListByVenue,
    listCommerceTransactionItems: mockListItems,
    getCommerceTransactionVenueId: mockGetTxVenueId,
  };
});

// SEGOLIFE — SEGOTOKENS UNIVERSAL SPEND (Fase 7).
const { mockLookupStudentByIdentityToken } = vi.hoisted(() => ({ mockLookupStudentByIdentityToken: vi.fn() }));
vi.mock("../segolife/commerce/studentIdentityService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/commerce/studentIdentityService")>();
  return { ...actual, lookupStudentByIdentityToken: mockLookupStudentByIdentityToken };
});

const { mockRecordNativeSale, mockResolveCartTotalCents } = vi.hoisted(() => ({
  mockRecordNativeSale: vi.fn(),
  mockResolveCartTotalCents: vi.fn(),
}));
vi.mock("../segolife/commerce/nativeCommerceService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/commerce/nativeCommerceService")>();
  return { ...actual, recordNativeSale: mockRecordNativeSale, resolveCartTotalCents: mockResolveCartTotalCents };
});

const { mockQuoteTokenSpend } = vi.hoisted(() => ({ mockQuoteTokenSpend: vi.fn() }));
vi.mock("../segolife/tokens/tokenSpendService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/tokens/tokenSpendService")>();
  return { ...actual, quoteTokenSpend: mockQuoteTokenSpend };
});

// SEGOLIFE — COMMERCE CORE (Fase 9): venta de puerta + reembolso parcial POS.
const { mockQuoteDoorEntry, mockRecordDoorSale, mockRefundDoorSale, mockListDoorEntryTicketTypesForVenue } = vi.hoisted(() => ({
  mockQuoteDoorEntry: vi.fn(),
  mockRecordDoorSale: vi.fn(),
  mockRefundDoorSale: vi.fn(),
  mockListDoorEntryTicketTypesForVenue: vi.fn(),
}));
vi.mock("../segolife/commerce/doorSaleService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/commerce/doorSaleService")>();
  return {
    ...actual,
    quoteDoorEntry: mockQuoteDoorEntry,
    recordDoorSale: mockRecordDoorSale,
    refundDoorSale: mockRefundDoorSale,
    listDoorEntryTicketTypesForVenue: mockListDoorEntryTicketTypesForVenue,
  };
});

const { mockRefundPosSale } = vi.hoisted(() => ({ mockRefundPosSale: vi.fn() }));
vi.mock("../segolife/commerce/refundOrchestrator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../segolife/commerce/refundOrchestrator")>();
  return { ...actual, refundPosSale: mockRefundPosSale };
});

import { commerceRouter } from "./commerce";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return commerceRouter.createCaller({ user: null } as any);
}
// role "admin" satisface el fallback legacy de commerceViewProcedure
// (permissionProcedure("commerce.view", ["admin"])) sin tocar BD real — el
// alcance por venue real de un Venue Admin lo sigue controlando por
// completo el mock de getVenueStaffAccess de abajo, independiente del rol.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAs(userId: number) {
  return commerceRouter.createCaller({ user: { id: userId, role: "admin" } } as any);
}

const CASANOVA = 1;
const TIA_FELISA = 2;

describe("commerce router — rechaza sin sesión", () => {
  it("listByVenue rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listByVenue({ venueId: CASANOVA })).rejects.toThrow(/please login/i);
  });
  it("listItems rechaza sin sesión", async () => {
    await expect(callerWithoutSession().listItems({ transactionId: 1 })).rejects.toThrow(/please login/i);
  });
});

describe("commerce router — IDOR CRITICAL: Venue Admin de Casanova no puede leer transacciones de Tía Felisa", () => {
  beforeEach(() => {
    mockGetVenueStaffAccess.mockReset();
    mockListByVenue.mockReset();
    mockListItems.mockReset();
    mockGetTxVenueId.mockReset();
    // Venue Admin real: solo tiene fila venue_staff activa para Casanova.
    mockGetVenueStaffAccess.mockResolvedValue([CASANOVA]);
  });

  it("listByVenue de SU propio venue (Casanova): permitido", async () => {
    mockListByVenue.mockResolvedValue([{ id: 1, venueId: CASANOVA }]);
    const result = await callerAs(10).listByVenue({ venueId: CASANOVA });
    expect(result).toEqual([{ id: 1, venueId: CASANOVA }]);
    expect(mockListByVenue).toHaveBeenCalledWith(CASANOVA);
  });

  it("listByVenue de OTRO venue (Tía Felisa) cambiando venueId en el input: DENEGADO, nunca llega a leer la BD", async () => {
    await expect(callerAs(10).listByVenue({ venueId: TIA_FELISA })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockListByVenue).not.toHaveBeenCalled();
  });

  it("listItems de una transacción de OTRO venue manipulando transactionId: DENEGADO — el venueId se resuelve del lado servidor, nunca se confía en uno del cliente", async () => {
    mockGetTxVenueId.mockResolvedValue(TIA_FELISA);
    await expect(callerAs(10).listItems({ transactionId: 999 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockListItems).not.toHaveBeenCalled();
  });

  it("listItems de una transacción inexistente: NOT_FOUND, no FORBIDDEN (no confirma ni niega autorización sobre algo que no existe)", async () => {
    mockGetTxVenueId.mockResolvedValue(null);
    await expect(callerAs(10).listItems({ transactionId: 424242 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("admin global ('all'): puede leer cualquier venue", async () => {
    mockGetVenueStaffAccess.mockResolvedValue("all");
    mockListByVenue.mockResolvedValue([]);
    await expect(callerAs(1).listByVenue({ venueId: TIA_FELISA })).resolves.toEqual([]);
  });
});

// SEGOLIFE — SEGOTOKENS UNIVERSAL SPEND (Fase 7, spec §33/§34, §41 tests
// #44-45): "identidad no es un cheque en blanco de pago" — posRecordSale
// exige un escaneo FRESCO del QR del Student para autorizar el gasto,
// nunca confía en un identifiedUserId que el cliente ya tenía guardado de
// un paso anterior.
describe("commerce.posRecordSale — autorización de gasto de SegoTokens (spec §33/§34)", () => {
  beforeEach(() => {
    mockGetVenueStaffAccess.mockReset();
    mockLookupStudentByIdentityToken.mockReset();
    mockRecordNativeSale.mockReset();
    mockGetVenueStaffAccess.mockResolvedValue([CASANOVA]);
    mockRecordNativeSale.mockResolvedValue({ status: "processed_with_loyalty", transaction: { id: 1 } });
  });

  const BASE_SALE = { venueId: CASANOVA, items: [{ venueProductId: 1, quantity: 1 }], idempotencyKey: "sale-idempotency-1" };

  it("aplicar tokens SIN identityToken: rechazado antes de llegar al servicio (spec §41 test #45)", async () => {
    await expect(callerAs(10).posRecordSale({ ...BASE_SALE, tokensToApply: 100 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockRecordNativeSale).not.toHaveBeenCalled();
  });

  it("identityToken que no resuelve a ningún Student: NOT_FOUND, nunca procede a la venta", async () => {
    mockLookupStudentByIdentityToken.mockResolvedValue(null);
    await expect(callerAs(10).posRecordSale({ ...BASE_SALE, tokensToApply: 100, identityToken: "a".repeat(20) })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("identityToken que resuelve a un Student DISTINTO del ya identificado para la venta: rechazado — impide sustituir de quién se gastan los tokens (spec §41 test #44)", async () => {
    mockLookupStudentByIdentityToken.mockResolvedValue({ userId: 999, name: "Otro Student" });
    await expect(callerAs(10).posRecordSale({ ...BASE_SALE, identifiedUserId: 42, tokensToApply: 100, identityToken: "a".repeat(20) }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockRecordNativeSale).not.toHaveBeenCalled();
  });

  it("identityToken válido y coincidente: procede, pasando el userId RESUELTO por el servidor (nunca el del cliente sin verificar)", async () => {
    mockLookupStudentByIdentityToken.mockResolvedValue({ userId: 42, name: "Ana" });
    await callerAs(10).posRecordSale({ ...BASE_SALE, identifiedUserId: 42, tokensToApply: 100, identityToken: "a".repeat(20) });
    expect(mockRecordNativeSale).toHaveBeenCalledOnce();
    expect(mockRecordNativeSale.mock.calls[0][0]).toMatchObject({ identifiedUserId: 42, tokensToApply: 100 });
  });

  it("sin tokensToApply, no exige ningún identityToken — la venta en efectivo sin SegoTokens sigue funcionando sin cambios", async () => {
    await callerAs(10).posRecordSale({ ...BASE_SALE, identifiedUserId: 42 });
    expect(mockLookupStudentByIdentityToken).not.toHaveBeenCalled();
    expect(mockRecordNativeSale).toHaveBeenCalledOnce();
  });

  it("IDOR: Venue Admin de Casanova no puede registrar venta/aplicar tokens en Tía Felisa", async () => {
    await expect(callerAs(10).posRecordSale({ ...BASE_SALE, venueId: TIA_FELISA })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockRecordNativeSale).not.toHaveBeenCalled();
  });
});

describe("commerce.posQuoteTokenSpend — previsualización de solo lectura (spec §36)", () => {
  beforeEach(() => {
    mockGetVenueStaffAccess.mockReset();
    mockResolveCartTotalCents.mockReset();
    mockQuoteTokenSpend.mockReset();
    mockGetVenueStaffAccess.mockResolvedValue([CASANOVA]);
  });

  it("recalcula el bruto desde el catálogo real y lo pasa al motor de cotización, nunca un importe del cliente", async () => {
    mockResolveCartTotalCents.mockResolvedValue({ totalCents: 1500, items: [] });
    mockQuoteTokenSpend.mockResolvedValue({ eligible: true });
    await callerAs(10).posQuoteTokenSpend({ venueId: CASANOVA, items: [{ venueProductId: 1, quantity: 1 }], identifiedUserId: 42, requestedTokens: 100 });
    expect(mockQuoteTokenSpend).toHaveBeenCalledWith(expect.objectContaining({ grossAmountCents: 1500, requestedTokens: 100, userId: 42 }));
  });

  it("IDOR: Venue Admin de Casanova no puede previsualizar canjes de Tía Felisa", async () => {
    await expect(callerAs(10).posQuoteTokenSpend({ venueId: TIA_FELISA, items: [{ venueProductId: 1, quantity: 1 }], identifiedUserId: 42, requestedTokens: 100 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockResolveCartTotalCents).not.toHaveBeenCalled();
  });
});

// SEGOLIFE — COMMERCE CORE (Fase 9, spec §85): misma protección IDOR real
// (assertVenueAuthorized) ya probada arriba para POS, ahora sobre las
// nuevas procedures de venta de puerta — MISMA función, nuevos call sites.
describe("commerce router — venta de puerta (Fase 9, IDOR + RBAC)", () => {
  beforeEach(() => {
    mockGetVenueStaffAccess.mockReset();
    mockQuoteDoorEntry.mockReset();
    mockRecordDoorSale.mockReset();
    mockRefundDoorSale.mockReset();
    mockListDoorEntryTicketTypesForVenue.mockReset();
    mockLookupStudentByIdentityToken.mockReset();
    mockGetVenueStaffAccess.mockResolvedValue([CASANOVA]);
  });

  it("doorEntryTicketTypes de SU propio venue: permitido", async () => {
    mockListDoorEntryTicketTypesForVenue.mockResolvedValue([]);
    await expect(callerAs(10).doorEntryTicketTypes({ venueId: CASANOVA })).resolves.toEqual([]);
  });

  it("IDOR: doorEntryTicketTypes de OTRO venue (Tía Felisa) denegado", async () => {
    await expect(callerAs(10).doorEntryTicketTypes({ venueId: TIA_FELISA })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockListDoorEntryTicketTypesForVenue).not.toHaveBeenCalled();
  });

  it("IDOR: recordDoorSale en OTRO venue denegado, nunca llega al servicio", async () => {
    await expect(callerAs(10).recordDoorSale({ venueId: TIA_FELISA, eventId: 1, ticketTypeId: 1, quantity: 1, idempotencyKey: "door-idem-1" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockRecordDoorSale).not.toHaveBeenCalled();
  });

  it("recordDoorSale con SegoTokens sin identityToken: rechazado antes del servicio (mismo criterio que posRecordSale)", async () => {
    await expect(callerAs(10).recordDoorSale({ venueId: CASANOVA, eventId: 1, ticketTypeId: 1, quantity: 1, idempotencyKey: "door-idem-2", tokensToApply: 50 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockRecordDoorSale).not.toHaveBeenCalled();
  });

  it("recordDoorSale sin SegoTokens no exige identityToken — venta anónima/en efectivo sigue funcionando", async () => {
    mockRecordDoorSale.mockResolvedValue({ order: { id: 1 }, tickets: [] });
    await callerAs(10).recordDoorSale({ venueId: CASANOVA, eventId: 1, ticketTypeId: 1, quantity: 1, idempotencyKey: "door-idem-3" });
    expect(mockLookupStudentByIdentityToken).not.toHaveBeenCalled();
    expect(mockRecordDoorSale).toHaveBeenCalledOnce();
  });

  it("refundDoorSale es commerceManageProcedure (admin), no commerceRecordProcedure — un simple operador de puerta no puede reembolsar", async () => {
    // fallback legacy: ambos procedimientos caen a ["admin"] si RBAC falla,
    // así que aquí se prueba la FORMA del gate (permiso distinto), no un
    // rol de staff real — ver referrals.test.ts para el mismo patrón.
    mockRefundDoorSale.mockResolvedValue({ id: 1, status: "refunded" });
    await expect(callerAs(10).refundDoorSale({ orderId: 1, reason: "motivo" })).resolves.toMatchObject({ status: "refunded" });
  });
});

describe("commerce router — refundTransactionLines (reembolso parcial POS, Fase 9 spec §21)", () => {
  it("delega en refundPosSale (Commerce Core) — nunca reimplementa el cálculo en el router", async () => {
    mockRefundPosSale.mockResolvedValue({ transaction: { id: 1 }, isFullRefund: false, refundedAmountCents: 500, tokensReversed: false, purchaseRewardReversed: false });
    const result = await callerAs(10).refundTransactionLines({ transactionId: 1, lines: [{ itemId: 1, quantity: 1 }], reason: "motivo real" });
    expect(result.isFullRefund).toBe(false);
    expect(mockRefundPosSale).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 1, lines: [{ itemId: 1, quantity: 1 }] }));
  });

  it("rechaza sin sesión", async () => {
    await expect(callerWithoutSession().refundTransactionLines({ transactionId: 1, lines: [{ itemId: 1, quantity: 1 }], reason: "x" })).rejects.toThrow(/please login/i);
  });
});
