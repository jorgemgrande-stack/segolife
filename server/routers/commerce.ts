import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure } from "../_core/trpc";
import { listCommerceTransactionsByVenue, listCommerceTransactionsByVenueWithNames, listCommerceTransactionItems, getCommerceTransactionVenueId } from "../segolife/commerce/commerceDb";
import { listPosProducts, recordNativeSale, resolveCartTotalCents, PosError } from "../segolife/commerce/nativeCommerceService";
import { refundCommerceTransaction, CommerceError } from "../segolife/commerce/commercePipeline";
import { refundPosSale, RefundOrchestratorError } from "../segolife/commerce/refundOrchestrator";
import { quoteDoorEntry, recordDoorSale, refundDoorSale, listDoorEntryTicketTypesForVenue, DoorSaleError } from "../segolife/commerce/doorSaleService";
import { lookupStudentByIdentityToken } from "../segolife/commerce/studentIdentityService";
import { getVenueStaffAccess } from "../segolife/benefits/venueStaffAccess";
import { quoteTokenSpend, TokenSpendError } from "../segolife/tokens/tokenSpendService";
import { ensureWallet, getLedgerById } from "../segolife/tokens/tokenLedgerService";
import { previewMyReward, previewMyWalletValue } from "../segolife/tokens/studentRewardPreviewService";
import { listUserBenefits } from "../db/benefitsDb";
import {
  requestTokenPayment, getTokenPaymentRequestView, cancelTokenPaymentRequest,
  TokenPaymentRequestError,
} from "../segolife/tokens/tokenPaymentRequestService";

const commerceViewProcedure = permissionProcedure("commerce.view", ["admin"]);
// Fase 8 — POS nativo de staff (mirroring benefits.redeem/attendance.redeem).
const commerceRecordProcedure = permissionProcedure("commerce.record", ["admin"]);
// SEGOLIFE — Venue Commerce, Consumption QR & SegoTokens: reembolso es acción admin, nunca de staff/POS (spec §46/§58 "Admin puede ver/cancelar").
const commerceManageProcedure = permissionProcedure("commerce.manage", ["admin"]);

function mapTokenPaymentRequestError(err: unknown): never {
  if (err instanceof TokenPaymentRequestError) {
    const codeMap: Record<string, "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST" | "FORBIDDEN"> = {
      NOT_FOUND: "NOT_FOUND", INVALID_STATE: "CONFLICT", EXPIRED: "CONFLICT",
      NOT_OWNER: "FORBIDDEN", CONTEXT_MISMATCH: "BAD_REQUEST", NO_POLICY: "BAD_REQUEST", INVALID_AMOUNT: "BAD_REQUEST",
    };
    throw new TRPCError({ code: codeMap[err.code] ?? "BAD_REQUEST", message: err.message, cause: err });
  }
  throw err;
}

function mapPosError(err: unknown): never {
  if (err instanceof PosError) {
    throw new TRPCError({ code: err.code === "PRODUCT_UNAVAILABLE" ? "CONFLICT" : "BAD_REQUEST", message: err.message, cause: err });
  }
  if (err instanceof TokenSpendError) {
    const codeMap: Record<string, "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST"> = {
      NOT_FOUND: "NOT_FOUND", ALREADY_CAPTURED: "CONFLICT", ALREADY_RELEASED: "CONFLICT",
      ALREADY_REVERSED: "CONFLICT", RESERVATION_EXPIRED: "CONFLICT",
    };
    throw new TRPCError({ code: codeMap[err.code] ?? "BAD_REQUEST", message: err.message, cause: err });
  }
  throw err;
}

function mapCommerceError(err: unknown): never {
  if (err instanceof CommerceError) {
    const codeMap: Record<string, "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT"> = { NOT_FOUND: "NOT_FOUND", INVALID_STATE: "CONFLICT", REASON_REQUIRED: "BAD_REQUEST" };
    throw new TRPCError({ code: codeMap[err.code] ?? "BAD_REQUEST", message: err.message, cause: err });
  }
  if (err instanceof RefundOrchestratorError) {
    const codeMap: Record<string, "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT"> = { NOT_FOUND: "NOT_FOUND", INVALID_STATE: "CONFLICT", INVALID_LINE: "BAD_REQUEST", INVALID_QUANTITY: "BAD_REQUEST", REASON_REQUIRED: "BAD_REQUEST", EMPTY_LINES: "BAD_REQUEST" };
    throw new TRPCError({ code: codeMap[err.code] ?? "BAD_REQUEST", message: err.message, cause: err });
  }
  throw err;
}

function mapDoorSaleError(err: unknown): never {
  if (err instanceof DoorSaleError) {
    const codeMap: Record<string, "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT"> = {
      NOT_FOUND: "NOT_FOUND", NOT_DOOR_ENTRY: "BAD_REQUEST", INACTIVE: "BAD_REQUEST", INVALID_QUANTITY: "BAD_REQUEST",
      STUDENT_REQUIRED: "BAD_REQUEST", NO_REDEMPTION_POLICY: "BAD_REQUEST", INVALID_TOKEN_AMOUNT: "BAD_REQUEST",
      NOT_DOOR_SALE: "BAD_REQUEST", INVALID_STATE: "CONFLICT", REASON_REQUIRED: "BAD_REQUEST", SOLD_OUT: "CONFLICT",
    };
    throw new TRPCError({ code: codeMap[err.code] ?? "BAD_REQUEST", message: err.message, cause: err });
  }
  throw err;
}

async function assertVenueAuthorized(userId: number, role: string, venueId: number): Promise<void> {
  const access = await getVenueStaffAccess(userId, role, undefined, "commerce.manage");
  if (access !== "all" && !access.includes(venueId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tienes autorización de POS para este venue" });
  }
}

export const commerceRouter = router({
  // SEGOLIFE — VENUE & PARTNER APP (spec §31, IDOR real encontrado en
  // auditoría): commerce.view lo tiene también venue_admin (Fase RBAC), pero
  // permissionProcedure es un check de permiso GLOBAL puro, sin idea de
  // "cuál venue" — sin este assertVenueAuthorized, cualquier Venue Admin
  // podía pedir listByVenue de OTRO venue con solo cambiar el venueId.
  listByVenue: commerceViewProcedure
    .input(z.object({ venueId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      return listCommerceTransactionsByVenue(input.venueId);
    }),

  listItems: commerceViewProcedure
    .input(z.object({ transactionId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const venueId = await getCommerceTransactionVenueId(input.transactionId);
      if (venueId == null) throw new TRPCError({ code: "NOT_FOUND", message: "Transacción no encontrada" });
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, venueId);
      return listCommerceTransactionItems(input.transactionId);
    }),

  // SEGOLIFE — VENUE BAR POS & LIVE COMMERCE TERMINAL (Fase 10.7, spec §23):
  // historial de ventas para el propio TPV — variante enriquecida de
  // listByVenue (que se deja intacto, VenueCommerceTab.tsx sigue usándolo
  // sin cambios) con nombre de Student/operador resueltos server-side.
  listByVenueWithNames: commerceViewProcedure
    .input(z.object({ venueId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      return listCommerceTransactionsByVenueWithNames(input.venueId);
    }),

  refundTransaction: commerceManageProcedure
    .input(z.object({ transactionId: z.number().int().positive(), reason: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await refundCommerceTransaction({ transactionId: input.transactionId, reason: input.reason, refundedByUserId: ctx.user.id });
      } catch (err) {
        mapCommerceError(err);
      }
    }),

  // SEGOLIFE — COMMERCE CORE (Fase 9, spec §21): reembolso total o parcial
  // POR LÍNEA de una venta de POS — sustituye a refundTransaction para el
  // flujo real del admin (refundTransaction se conserva sin cambios, sigue
  // siendo un reembolso total válido, útil para integraciones que no
  // necesiten desglose por línea).
  refundTransactionLines: commerceManageProcedure
    .input(z.object({
      transactionId: z.number().int().positive(),
      lines: z.array(z.object({ itemId: z.number().int().positive(), quantity: z.number().int().positive() })).min(1),
      reason: z.string().min(1).max(500),
      // SEGOLIFE — FASE 10 (spec §33): el operador decide explícitamente si
      // el producto vuelve físicamente al stock — nunca automático.
      restock: z.boolean().optional(),
      idempotencyKey: z.string().min(8).max(191),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await refundPosSale({ transactionId: input.transactionId, lines: input.lines, reason: input.reason, refundedByUserId: ctx.user.id, restock: input.restock, idempotencyKey: input.idempotencyKey });
      } catch (err) {
        mapCommerceError(err);
      }
    }),

  // ─── Venta de puerta (Fase 9, spec §14-15/§44-45) ───────────────────────────
  doorEntryTicketTypes: commerceRecordProcedure
    .input(z.object({ venueId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      return listDoorEntryTicketTypesForVenue(input.venueId);
    }),

  quoteDoorEntry: commerceRecordProcedure
    .input(z.object({
      venueId: z.number().int().positive(),
      eventId: z.number().int().positive(),
      ticketTypeId: z.number().int().positive(),
      quantity: z.number().int().positive().default(1),
      identifiedUserId: z.number().int().positive().optional(),
      requestedTokens: z.number().int().min(0).optional(),
    }))
    .query(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      try {
        return await quoteDoorEntry(input);
      } catch (err) {
        mapDoorSaleError(err);
      }
    }),

  /**
   * SEGOLIFE — SEGOTOKENS PRESENCIALES (Pre-16.1, spec §3/§4): el operador
   * SOLICITA — el Student confirma desde su propio teléfono
   * (tokenPaymentRequests.confirm) antes de que se mueva un solo token.
   * Mismo criterio de re-verificación fresca del QR que antes tenía
   * posRecordSale/recordDoorSale (spec §33/§34) — identidad no autoriza
   * gasto de SegoTokens por sí sola, solo lo IDENTIFICA para poder pedirlo.
   */
  doorRequestTokenPayment: commerceRecordProcedure
    .input(z.object({
      venueId: z.number().int().positive(),
      eventId: z.number().int().positive(),
      ticketTypeId: z.number().int().positive(),
      quantity: z.number().int().positive().default(1),
      identifiedUserId: z.number().int().positive(),
      requestedTokens: z.number().int().positive(),
      identityToken: z.string().min(16).max(256),
      idempotencyKey: z.string().min(8).max(191),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      const student = await lookupStudentByIdentityToken(input.identityToken);
      if (!student) throw new TRPCError({ code: "NOT_FOUND", message: "Código no reconocido" });
      if (student.userId !== input.identifiedUserId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El QR escaneado no corresponde al Student identificado para esta venta" });
      }
      let quote;
      try {
        quote = await quoteDoorEntry({ eventId: input.eventId, ticketTypeId: input.ticketTypeId, quantity: input.quantity });
      } catch (err) {
        mapDoorSaleError(err);
      }
      try {
        const result = await requestTokenPayment({
          userId: student.userId,
          venueId: input.venueId,
          eventId: input.eventId,
          grossAmountCents: quote.grossAmountCents,
          requestedTokens: input.requestedTokens,
          orderContextType: "door",
          idempotencyKey: input.idempotencyKey,
          operatorUserId: ctx.user.id,
        });
        return { requestId: result.request.id, reservation: result.reservation };
      } catch (err) {
        mapTokenPaymentRequestError(err);
      }
    }),

  recordDoorSale: commerceRecordProcedure
    .input(z.object({
      venueId: z.number().int().positive(),
      eventId: z.number().int().positive(),
      ticketTypeId: z.number().int().positive(),
      quantity: z.number().int().positive().default(1),
      identifiedUserId: z.number().int().positive().nullish(),
      idempotencyKey: z.string().min(8).max(191),
      /** Id de una solicitud YA confirmada por el Student — ver doorRequestTokenPayment. */
      confirmedTokenRequestId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      try {
        return await recordDoorSale({
          eventId: input.eventId,
          ticketTypeId: input.ticketTypeId,
          quantity: input.quantity,
          identifiedUserId: input.identifiedUserId ?? null,
          operatorUserId: ctx.user.id,
          confirmedTokenRequestId: input.confirmedTokenRequestId ?? null,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (err) {
        mapDoorSaleError(err);
      }
    }),

  refundDoorSale: commerceManageProcedure
    .input(z.object({ orderId: z.number().int().positive(), reason: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await refundDoorSale({ orderId: input.orderId, refundedByUserId: ctx.user.id, reason: input.reason });
      } catch (err) {
        mapDoorSaleError(err);
      }
    }),

  // ─── POS nativo (staff) — Fase 8 ─────────────────────────────────────────────
  myAuthorizedVenuesForPos: commerceRecordProcedure.query(async ({ ctx }) => {
    const access = await getVenueStaffAccess(ctx.user.id, ctx.user.role as string, undefined, "commerce.manage");
    return access === "all" ? { all: true as const, venueIds: [] as number[] } : { all: false as const, venueIds: access };
  }),

  posProducts: commerceRecordProcedure
    .input(z.object({ venueId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      const products = await listPosProducts(input.venueId);
      return products.filter(p => p.isActive);
    }),

  /**
   * Fase 10.7 (spec §7 "Student panel"): enriquece la identificación con lo
   * MÍNIMO operativamente útil — saldo real, su valor en € (si hay política
   * de canje activa) y cuántos Benefits tiene activos ahora mismo. Reutiliza
   * ensureWallet/previewMyWalletValue/listUserBenefits TAL CUAL (Fase 10.6/
   * anteriores) — nunca recalcula nada de esto aquí.
   */
  posIdentifyStudent: commerceRecordProcedure
    .input(z.object({ token: z.string().min(16).max(256) }))
    .query(async ({ input }) => {
      const student = await lookupStudentByIdentityToken(input.token);
      if (!student) throw new TRPCError({ code: "NOT_FOUND", message: "Código no reconocido" });
      const [wallet, activeBenefitsCount] = await Promise.all([
        previewMyWalletValue(student.userId),
        listUserBenefits(student.userId).then(items => items.filter(b => b.status === "active").length),
      ]);
      return { ...student, walletBalance: wallet.balance, promotionalValue: wallet.promotionalValue, activeBenefitsCount };
    }),

  /**
   * Fase 10.7 (spec §11 "Reward preview integration"): preview de solo
   * lectura para el Student YA IDENTIFICADO en este POS — reutiliza
   * EXACTAMENTE el mismo read model de Fase 10.6 (studentRewardPreviewService),
   * solo que aquí el userId lo aporta el STAFF (ya verificado vía QR de
   * identidad) en vez de ctx.user.id, porque quien previsualiza es el
   * operador, no el propio Student. origin="consumption" fijo — un TPV de
   * venue siempre es una compra de consumición, nunca otro origen.
   */
  /**
   * Fase 10.7 (spec §21 "receipt") — variante de `listItems` gateada por
   * `commerce.record` (no `commerce.view`, distinto permiso): un operador de
   * TPV puro necesita poder ver el recibo de SU PROPIA venta recién
   * confirmada sin depender de tener también permiso de admin de comercio.
   * Misma protección IDOR exacta que listItems, mismo dato — nunca
   * reimplementa el listado.
   */
  posReceiptItems: commerceRecordProcedure
    .input(z.object({ transactionId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const venueId = await getCommerceTransactionVenueId(input.transactionId);
      if (venueId == null) throw new TRPCError({ code: "NOT_FOUND", message: "Transacción no encontrada" });
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, venueId);
      return listCommerceTransactionItems(input.transactionId);
    }),

  posPreviewReward: commerceRecordProcedure
    .input(z.object({
      venueId: z.number().int().positive(),
      identifiedUserId: z.number().int().positive(),
      amountSpent: z.number().nonnegative().optional(),
    }))
    .query(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      return previewMyReward({ userId: input.identifiedUserId, origin: "consumption", venueId: input.venueId, amountSpent: input.amountSpent });
    }),

  /**
   * SEGOLIFE — SEGOTOKENS UNIVERSAL SPEND (Fase 7, spec §36 "checkout UX
   * contract"): previsualización de solo lectura antes de confirmar la
   * venta — recalcula el carrito desde el catálogo real (nunca confía en
   * un importe del cliente) y devuelve el mismo quote que posRecordSale
   * aplicaría, sin comprometer ningún token todavía.
   */
  posQuoteTokenSpend: commerceRecordProcedure
    .input(z.object({
      venueId: z.number().int().positive(),
      items: z.array(z.object({ venueProductId: z.number().int().positive(), quantity: z.number().int().positive() })).min(1),
      identifiedUserId: z.number().int().positive(),
      requestedTokens: z.number().int().min(0),
    }))
    .query(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      const { totalCents } = await resolveCartTotalCents(input.venueId, input.items).catch(err => { mapPosError(err); });
      return quoteTokenSpend({
        userId: input.identifiedUserId, venueId: input.venueId,
        grossAmountCents: totalCents, requestedTokens: input.requestedTokens,
      });
    }),

  /**
   * SEGOLIFE — SEGOTOKENS PRESENCIALES (Pre-16.1, spec §3/§4): el operador
   * SOLICITA — el Student confirma desde su propio teléfono
   * (tokenPaymentRequests.confirm) antes de que se mueva un solo token.
   * Reemplaza el antiguo camino directo de posRecordSale con
   * tokensToApply+identityToken. Mismo criterio de re-verificación fresca
   * del QR que tenía ese camino (spec §33/§34).
   */
  posRequestTokenPayment: commerceRecordProcedure
    .input(z.object({
      venueId: z.number().int().positive(),
      items: z.array(z.object({ venueProductId: z.number().int().positive(), quantity: z.number().int().positive() })).min(1),
      identifiedUserId: z.number().int().positive(),
      requestedTokens: z.number().int().positive(),
      identityToken: z.string().min(16).max(256),
      idempotencyKey: z.string().min(8).max(191),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);
      const student = await lookupStudentByIdentityToken(input.identityToken);
      if (!student) throw new TRPCError({ code: "NOT_FOUND", message: "Código no reconocido" });
      if (student.userId !== input.identifiedUserId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El QR escaneado no corresponde al Student identificado para esta venta" });
      }
      const { totalCents } = await resolveCartTotalCents(input.venueId, input.items).catch(err => { mapPosError(err); });
      try {
        const result = await requestTokenPayment({
          userId: student.userId,
          venueId: input.venueId,
          grossAmountCents: totalCents,
          requestedTokens: input.requestedTokens,
          orderContextType: "pos",
          idempotencyKey: input.idempotencyKey,
          operatorUserId: ctx.user.id,
        });
        return { requestId: result.request.id, reservation: result.reservation };
      } catch (err) {
        mapTokenPaymentRequestError(err);
      }
    }),

  /**
   * Estado de una solicitud (operador Y Student comparten el mismo motor,
   * pero cada uno con su propia comprobación de propiedad — este endpoint es
   * para el OPERADOR: polling de la pantalla "Esperando confirmación..."
   * mientras liquida (ver tokenPaymentRequests.myPending/confirm/reject para
   * el lado del Student).
   */
  getTokenPaymentRequestStatus: commerceRecordProcedure
    .input(z.object({ requestId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const view = await getTokenPaymentRequestView(input.requestId).catch(err => mapTokenPaymentRequestError(err));
      if (view.reservation.venueId == null) throw new TRPCError({ code: "FORBIDDEN", message: "Solicitud sin venue asociado" });
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, view.reservation.venueId);
      return { status: view.effectiveStatus, reservation: view.reservation };
    }),

  /** Operador cancela — antes O después de que el Student confirme (spec §14/§16, p.ej. el cobro del dinero restante falla). */
  cancelTokenPaymentRequest: commerceRecordProcedure
    .input(z.object({ requestId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const view = await getTokenPaymentRequestView(input.requestId).catch(err => mapTokenPaymentRequestError(err));
      if (view.reservation.venueId == null) throw new TRPCError({ code: "FORBIDDEN", message: "Solicitud sin venue asociado" });
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, view.reservation.venueId);
      try {
        const result = await cancelTokenPaymentRequest(input.requestId, ctx.user.id);
        return { status: result.effectiveStatus };
      } catch (err) {
        mapTokenPaymentRequestError(err);
      }
    }),

  posRecordSale: commerceRecordProcedure
    .input(z.object({
      venueId: z.number().int().positive(),
      items: z.array(z.object({ venueProductId: z.number().int().positive(), quantity: z.number().int().positive() })).min(1),
      identifiedUserId: z.number().int().positive().nullish(),
      idempotencyKey: z.string().min(8).max(191),
      /** Id de una solicitud YA confirmada por el Student — ver posRequestTokenPayment. */
      confirmedTokenRequestId: z.number().int().positive().optional(),
      /** Fase 10.7 (spec §10) — cómo se cobró la porción en DINERO. Por defecto "cash" (compatibilidad). */
      moneyPaymentMethod: z.enum(["cash", "card"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertVenueAuthorized(ctx.user.id, ctx.user.role as string, input.venueId);

      try {
        const result = await recordNativeSale({
          venueId: input.venueId,
          items: input.items,
          identifiedUserId: input.identifiedUserId ?? null,
          staffUserId: ctx.user.id,
          idempotencyKey: input.idempotencyKey,
          confirmedTokenRequestId: input.confirmedTokenRequestId ?? null,
          moneyPaymentMethod: input.moneyPaymentMethod ?? null,
        });
        // Fase 10.7 (spec §20 "receipt / sale result"): la confirmación debe
        // mostrar el resultado REAL, nunca repetir el preview — se lee el
        // ledger real ya escrito por processCommerceLoyalty() dentro de
        // ingestCommerceTransaction(), nunca se recalcula.
        let tokensEarned: number | null = null;
        if ("transaction" in result && result.transaction.loyaltyLedgerId != null) {
          const ledger = await getLedgerById(result.transaction.loyaltyLedgerId);
          tokensEarned = ledger?.amount ?? null;
        }
        return { ...result, tokensEarned };
      } catch (err) {
        mapPosError(err);
      }
    }),
});
