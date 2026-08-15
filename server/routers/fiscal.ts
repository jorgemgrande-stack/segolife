/**
 * fiscal.ts — SEGOLIFE FASE 10 (spec §5/§13-26). Superficie "Facturación":
 * entidades comerciales, vendedor por venue, tipos de IVA, series, facturas
 * y abonos. GLOBAL_ADMIN exclusivamente para configuración/emisión (spec
 * §5/§83/§86) — Student solo accede a SU billing profile/SUS documentos.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure, protectedProcedure } from "../_core/trpc";
import {
  listCommercialEntities, upsertCommercialEntity, setVenueSellerConfig, getVenueSellerConfig,
  resolveSellerForVenue, CommercialEntityError,
} from "../segolife/fiscal/commercialEntityService";
import { listTaxRates, upsertTaxRate, setVenueProductTaxRate, setEventTicketTypeTaxRate, TaxRateError } from "../segolife/fiscal/taxRateService";
import { ensureFiscalSnapshot } from "../segolife/fiscal/fiscalSnapshotService";
import { getBillingProfile, upsertBillingProfile, BillingProfileError } from "../segolife/fiscal/billingProfileService";
import {
  upsertInvoiceSeries, listInvoiceSeries, issueInvoice, issueCreditNote,
  listFiscalDocuments, getFiscalDocument, getFiscalDocumentLines, FiscalDocumentError,
} from "../segolife/fiscal/fiscalDocumentService";

const fiscalViewProcedure = permissionProcedure("fiscal.view", ["admin"]);
const fiscalManageProcedure = permissionProcedure("fiscal.manage", ["admin"]);

function mapFiscalError(err: unknown): never {
  if (err instanceof CommercialEntityError || err instanceof TaxRateError || err instanceof BillingProfileError || err instanceof FiscalDocumentError) {
    const codeMap: Record<string, "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT"> = {
      NOT_FOUND: "NOT_FOUND", SELLER_NOT_FOUND: "BAD_REQUEST", INVALID_INPUT: "BAD_REQUEST",
      NOT_ELIGIBLE: "BAD_REQUEST", SELLER_NOT_CONFIGURED: "BAD_REQUEST", TAX_NOT_CONFIGURED: "BAD_REQUEST",
      SERIES_NOT_FOUND: "BAD_REQUEST", SERIES_MISMATCH: "BAD_REQUEST", BILLING_PROFILE_NOT_FOUND: "BAD_REQUEST",
      REASON_REQUIRED: "BAD_REQUEST", INVALID_AMOUNT: "BAD_REQUEST", INVALID_ORIGINAL: "BAD_REQUEST", OVER_REFUND: "CONFLICT",
    };
    throw new TRPCError({ code: codeMap[err.code] ?? "BAD_REQUEST", message: err.message, cause: err });
  }
  throw err;
}

export const fiscalRouter = router({
  // ─── Entidades comerciales / vendedor por venue ────────────────────────────
  listEntities: fiscalViewProcedure.query(() => listCommercialEntities()),
  upsertEntity: fiscalManageProcedure
    .input(z.object({
      id: z.number().int().positive().optional(),
      legalName: z.string().min(1).max(256),
      tradeName: z.string().max(256).optional().nullable(),
      taxId: z.string().min(1).max(32),
      country: z.string().length(2).optional(),
      fiscalAddress: z.string().max(512).optional().nullable(),
      email: z.string().email().max(256).optional().nullable(),
      currency: z.string().max(8).optional(),
      active: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      try { return await upsertCommercialEntity(input); } catch (err) { mapFiscalError(err); }
    }),
  getVenueSellerConfig: fiscalViewProcedure
    .input(z.object({ venueId: z.number().int().positive() }))
    .query(({ input }) => getVenueSellerConfig(input.venueId)),
  setVenueSellerConfig: fiscalManageProcedure
    .input(z.object({ venueId: z.number().int().positive(), sellerEntityId: z.number().int().positive(), collectorEntityId: z.number().int().positive().optional().nullable() }))
    .mutation(async ({ ctx, input }) => {
      try { return await setVenueSellerConfig({ ...input, updatedByUserId: ctx.user.id }); } catch (err) { mapFiscalError(err); }
    }),
  resolveVenueSeller: fiscalViewProcedure
    .input(z.object({ venueId: z.number().int().positive() }))
    .query(({ input }) => resolveSellerForVenue(input.venueId)),

  // ─── Tipos de IVA ───────────────────────────────────────────────────────────
  listTaxRates: fiscalViewProcedure.query(() => listTaxRates()),
  upsertTaxRate: fiscalManageProcedure
    .input(z.object({ id: z.number().int().positive().optional(), name: z.string().min(1).max(128), rateBasisPoints: z.number().int().min(0).max(10000), country: z.string().length(2).optional(), active: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      try { return await upsertTaxRate(input); } catch (err) { mapFiscalError(err); }
    }),
  setVenueProductTaxRate: fiscalManageProcedure
    .input(z.object({ venueProductId: z.number().int().positive(), taxRateId: z.number().int().positive().nullable() }))
    .mutation(({ input }) => setVenueProductTaxRate(input.venueProductId, input.taxRateId)),
  setEventTicketTypeTaxRate: fiscalManageProcedure
    .input(z.object({ ticketTypeId: z.number().int().positive(), taxRateId: z.number().int().positive().nullable() }))
    .mutation(({ input }) => setEventTicketTypeTaxRate(input.ticketTypeId, input.taxRateId)),

  // ─── Series de facturación ──────────────────────────────────────────────────
  listSeries: fiscalViewProcedure
    .input(z.object({ sellerEntityId: z.number().int().positive().optional() }))
    .query(({ input }) => listInvoiceSeries(input.sellerEntityId)),
  upsertSeries: fiscalManageProcedure
    .input(z.object({ id: z.number().int().positive().optional(), sellerEntityId: z.number().int().positive(), documentType: z.enum(["invoice", "credit_note"]), code: z.string().min(1).max(16), active: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      try { return await upsertInvoiceSeries(input); } catch (err) { mapFiscalError(err); }
    }),

  // ─── Snapshot fiscal (detalle de pedido) ────────────────────────────────────
  snapshotFor: fiscalViewProcedure
    .input(z.object({ sourceType: z.enum(["commerce_transaction", "ticket_order"]), sourceId: z.number().int().positive() }))
    .query(async ({ input }) => {
      try { return await ensureFiscalSnapshot(input.sourceType, input.sourceId); } catch (err) { mapFiscalError(err); }
    }),

  // ─── Facturas / abonos (admin) ──────────────────────────────────────────────
  issueInvoice: fiscalManageProcedure
    .input(z.object({
      sourceType: z.enum(["commerce_transaction", "ticket_order"]),
      sourceId: z.number().int().positive(),
      seriesId: z.number().int().positive(),
      buyerBillingProfileId: z.number().int().positive().optional().nullable(),
      buyerUserId: z.number().int().positive().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      try { return await issueInvoice({ ...input, issuedByUserId: ctx.user.id }); } catch (err) { mapFiscalError(err); }
    }),
  issueCreditNote: fiscalManageProcedure
    .input(z.object({ originalDocumentId: z.number().int().positive(), amountCents: z.number().int().positive(), reason: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      try { return await issueCreditNote({ ...input, issuedByUserId: ctx.user.id }); } catch (err) { mapFiscalError(err); }
    }),
  listDocuments: fiscalViewProcedure
    .input(z.object({ sellerEntityId: z.number().int().positive().optional(), documentType: z.enum(["invoice", "credit_note"]).optional() }))
    .query(({ input }) => listFiscalDocuments(input)),
  getDocument: fiscalViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const document = await getFiscalDocument(input.id);
      if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Documento no encontrado" });
      const lines = await getFiscalDocumentLines(input.id);
      return { document, lines };
    }),

  // ─── Student self-service (billing profile / mis documentos) ───────────────
  myBillingProfile: protectedProcedure.query(({ ctx }) => getBillingProfile(ctx.user.id)),
  upsertMyBillingProfile: protectedProcedure
    .input(z.object({ legalName: z.string().min(1).max(256), taxId: z.string().min(1).max(32), address: z.string().max(512).optional().nullable(), country: z.string().length(2).optional(), email: z.string().email().max(256).optional().nullable() }))
    .mutation(async ({ ctx, input }) => {
      try { return await upsertBillingProfile({ ...input, userId: ctx.user.id }); } catch (err) { mapFiscalError(err); }
    }),
  // Ownership server-side (spec §25): nunca confía en un invoiceId aportado sin comprobar buyerUserId.
  myDocuments: protectedProcedure.query(({ ctx }) => listFiscalDocuments({ buyerUserId: ctx.user.id })),
  myDocument: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const document = await getFiscalDocument(input.id);
      if (!document || document.buyerUserId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "Documento no encontrado" });
      const lines = await getFiscalDocumentLines(input.id);
      return { document, lines };
    }),
});
