/**
 * salesOperations.ts — SEGOLIFE COMMERCE CORE (Fase 9, spec §26-40/§78-79).
 * Router de la nueva superficie admin "Ventas y Operaciones" — visibilidad
 * GLOBAL_ADMIN exclusivamente (spec §80: Venue Admin sigue en Venue App con
 * sus propios datos acotados, nunca este router global). Solo LECTURA de
 * fuentes ya existentes (ticket_orders/commerce_transactions/event_tickets/
 * commerce_refunds) vía salesReadModel.ts/dailyOperationsService.ts — nunca
 * escribe nada.
 */
import { z } from "zod";
import { router, permissionProcedure } from "../_core/trpc";
import { listUnifiedSales, getSalesAggregate, listRefunds } from "../segolife/commerce/salesReadModel";
import { getDailyOperationsSnapshot, getOperationalCalendarRange, getEventOperationsDetail } from "../segolife/commerce/dailyOperationsService";

const salesViewProcedure = permissionProcedure("sales.view", ["admin"]);

const dateInput = z.coerce.date().optional();

export const salesOperationsRouter = router({
  listSales: salesViewProcedure
    .input(z.object({
      from: dateInput,
      to: dateInput,
      venueId: z.number().int().positive().optional(),
      eventId: z.number().int().positive().optional(),
      source: z.enum(["SEGOLIFE", "FOURVENUES"]).optional(),
      studentUserId: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().min(0).optional(),
    }))
    .query(({ input }) => listUnifiedSales(input)),

  overview: salesViewProcedure
    .input(z.object({
      from: z.coerce.date(),
      to: z.coerce.date(),
      venueId: z.number().int().positive().optional(),
      eventId: z.number().int().positive().optional(),
    }))
    .query(({ input }) => getSalesAggregate(input)),

  dailyOperations: salesViewProcedure
    .input(z.object({ date: z.coerce.date().optional(), venueId: z.number().int().positive().optional() }))
    .query(({ input }) => getDailyOperationsSnapshot(input.date ?? new Date(), input.venueId ?? null)),

  operationalCalendar: salesViewProcedure
    .input(z.object({ fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), venueId: z.number().int().positive().optional() }))
    .query(({ input }) => getOperationalCalendarRange(input.fromDate, input.toDate, input.venueId ?? null)),

  eventOperationsDetail: salesViewProcedure
    .input(z.object({ eventId: z.number().int().positive() }))
    .query(({ input }) => getEventOperationsDetail(input.eventId)),

  listRefunds: salesViewProcedure
    .input(z.object({
      venueId: z.number().int().positive().optional(),
      from: dateInput,
      to: dateInput,
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().min(0).optional(),
    }))
    .query(({ input }) => listRefunds(input)),
});
