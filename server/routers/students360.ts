/**
 * students360.ts — endpoints batched de "Student 360" (ficha 360 del
 * estudiante). Diseño completo en
 * docs/students/student-360-audit-and-architecture.md §4-5.
 *
 * `getSummary` es LA única llamada al abrir la ficha (un solo fan-out de
 * fuentes en paralelo, nunca 30-40 requests). El resto de endpoints son
 * perezosos — se piden solo cuando el admin abre esa pestaña concreta.
 *
 * Reutiliza el mismo patrón de autorización que server/routers/students.ts
 * (permissionProcedure + communityAccess + fetch-then-check por overlap de
 * comunidades) — decisión ya tomada, no se inventa un mecanismo paralelo.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure } from "../_core/trpc";
import { getCommunityAccess } from "../_core/communityAccess";
import { getStudentById, type StudentDetail } from "../db/studentsDb";
import {
  getStudentActivitySnapshot,
  getStudentActivity,
  deriveLastActivityAt,
} from "../segolife/students/studentActivityAggregator";
import { computeSegoScore, computeSegment, computeAlerts, type StudentIntelligenceInput } from "../segolife/students/studentIntelligenceService";
import { getWalletByUserId } from "../segolife/tokens/tokenLedgerService";
import { listGrantedBenefits } from "../db/benefitsDb";
import { getUnreadCount, listMyNotifications } from "../segolife/engagement/notificationsDb";
import { listMyPreferences } from "../segolife/engagement/notificationPreferencesService";
import { getTicketSpendSummaryByUserId, listMyTickets, listAttendanceByUserId } from "../segolife/ticketing/ticketingDb";
import { getCommerceSpendSummaryByUserId, listCommerceTransactionsByUserId } from "../segolife/commerce/commerceDb";
import { listQrRedemptionsByUser } from "../db/consumptionQrDb";
import { listAdminActionsByStudentProfileId } from "../segolife/students/studentAdminActionsDb";
import { listLoginEventsByUserId } from "../segolife/students/studentLoginEventsDb";
import { getHistoricalOverviewForStudent, getHistoricalTimelineForStudent } from "../segolife/students/historicalIdentityService";
import type { StudentSummaryDTO, TimelineFilters, TimelineEventType } from "../../shared/segolife/student360";

const students360ViewProcedure = permissionProcedure("students.view", ["admin"]);

/** Mismo helper que students.ts (misma decisión de arquitectura, ver auditoría §I) — copiado, no importado, para no acoplar dos routers por una función interna. */
function assertStudentAccessible(access: "all" | number[], studentCommunityIds: number[]) {
  if (access === "all") return;
  const hasOverlap = studentCommunityIds.some(id => access.includes(id));
  if (!hasOverlap) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a este estudiante" });
  }
}

async function loadAuthorizedStudent(studentProfileId: number, ctx: { user: { id: number; role: string } }): Promise<StudentDetail> {
  const detail = await getStudentById(studentProfileId);
  if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Estudiante no encontrado" });
  const access = await getCommunityAccess(ctx.user.id, ctx.user.role);
  assertStudentAccessible(access, detail.communities.map(c => c.id));
  return detail;
}

function daysUntil(date: Date, now: Date): number {
  return Math.floor((new Date(date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

const timelineTypeEnum = z.enum([
  "ticket_purchase", "ticket_cancelled", "ticket_refunded", "event_attendance",
  "consumption_pos", "consumption_qr", "token_credit", "token_debit",
  "benefit_granted", "benefit_used", "benefit_cancelled", "internal_note",
  "tag_assigned", "login", "admin_action",
  "community_response", "community_support", "community_proposal_submitted",
]);

export const students360Router = router({
  /**
   * Resumen ejecutivo — responde las preguntas clave en una sola carga.
   * Un único Promise.all con todo lo necesario para header + KPIs +
   * SegoScore + segmento + alertas + últimos eventos del timeline.
   */
  getSummary: students360ViewProcedure
    .input(z.object({ studentProfileId: z.number().int().positive() }))
    .query(async ({ input, ctx }): Promise<StudentSummaryDTO> => {
      const detail = await loadAuthorizedStudent(input.studentProfileId, ctx);
      const userId = detail.profile.userId;
      const now = new Date();

      const [snapshot, wallet, benefits, unread, ticketSpend, commerceSpend, tickets, notifications] = await Promise.all([
        getStudentActivitySnapshot(userId, input.studentProfileId),
        getWalletByUserId(userId),
        listGrantedBenefits({ communityIds: "all", userId, limit: 200 }),
        getUnreadCount(userId),
        getTicketSpendSummaryByUserId(userId),
        getCommerceSpendSummaryByUserId(userId),
        listMyTickets(userId),
        listMyNotifications(userId, 100),
      ]);

      const eventsAttendedCount = snapshot.filter(e => e.type === "event_attendance").length;
      const benefitsAvailable = benefits.items.filter(b => b.status === "active");
      const benefitsUsed = benefits.items.filter(b => b.status === "used");
      const hasBenefitExpiringSoon = benefitsAvailable.some(b => {
        if (!b.validUntil) return false;
        const d = daysUntil(b.validUntil, now);
        return d >= 0 && d <= 7;
      });

      const nextTicket = tickets
        .filter(t => t.event && new Date(t.event.startsAt).getTime() > now.getTime() && t.ticket.status !== "cancelled" && t.ticket.status !== "refunded")
        .sort((a, b) => new Date(a.event!.startsAt).getTime() - new Date(b.event!.startsAt).getTime())[0];

      const notificationInteractionCount = notifications.filter(n => n.readAt || n.clickedAt).length;
      const totalSpendCents = ticketSpend.totalPaidCents + commerceSpend.totalSpendCents;

      const intelligenceInput: StudentIntelligenceInput = {
        registeredAt: detail.profile.createdAt,
        profileCompleted: detail.profile.profileCompleted,
        activitySnapshot: snapshot,
        eventsPurchasedCount: ticketSpend.ticketCount,
        eventsAttendedCount,
        totalSpendCents,
        tokensBalance: wallet?.balance ?? 0,
        tokensLifetimeEarned: wallet?.lifetimeEarned ?? 0,
        benefitsUsedCount: benefitsUsed.length,
        benefitsAvailableCount: benefitsAvailable.length,
        hasBenefitExpiringSoon,
        nextEventStartsAt: nextTicket?.event ? new Date(nextTicket.event.startsAt).toISOString() : null,
        unreadNotifications: unread,
        notificationInteractionCount,
        now,
      };

      const segoScore = computeSegoScore(intelligenceInput);
      const segment = computeSegment(intelligenceInput);
      const alerts = computeAlerts(intelligenceInput);

      const fullName = [detail.profile.firstName, detail.profile.lastName].filter(Boolean).join(" ") || detail.user.name || "(sin nombre)";

      return {
        studentProfileId: detail.profile.id,
        userId,
        fullName,
        status: detail.profile.status,
        profileCompleted: detail.profile.profileCompleted,
        communities: detail.communities,
        segoScore,
        segment,
        kpis: {
          eventsPurchased: ticketSpend.ticketCount,
          eventsAttended: eventsAttendedCount,
          totalSpendCents,
          tokensBalance: wallet?.balance ?? 0,
          tokensLifetimeEarned: wallet?.lifetimeEarned ?? 0,
          tokensLifetimeSpent: wallet?.lifetimeSpent ?? 0,
          benefitsAvailable: benefitsAvailable.length,
          benefitsUsed: benefitsUsed.length,
          unreadNotifications: unread,
        },
        nextEvent: nextTicket?.event
          ? { id: nextTicket.event.id, name: nextTicket.event.name, slug: nextTicket.event.slug, startsAt: new Date(nextTicket.event.startsAt).toISOString() }
          : null,
        lastActivityAt: deriveLastActivityAt(snapshot),
        recentActivity: snapshot.slice(0, 8),
        alerts,
      };
    }),

  /** Pestaña Actividad — timeline paginado con cursor. */
  getActivity: students360ViewProcedure
    .input(z.object({
      studentProfileId: z.number().int().positive(),
      types: z.array(timelineTypeEnum).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      cursor: z.object({ occurredAt: z.string(), id: z.string() }).nullish(),
      limit: z.number().int().min(1).max(100).default(30),
    }))
    .query(async ({ input, ctx }) => {
      const detail = await loadAuthorizedStudent(input.studentProfileId, ctx);
      const filters: TimelineFilters = {
        types: input.types as TimelineEventType[] | undefined,
        from: input.from,
        to: input.to,
      };
      return getStudentActivity(detail.profile.userId, input.studentProfileId, filters, input.cursor ?? null, input.limit);
    }),

  /** Pestaña Eventos — tickets comprados + asistencias, combinados. */
  getEvents: students360ViewProcedure
    .input(z.object({ studentProfileId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const detail = await loadAuthorizedStudent(input.studentProfileId, ctx);
      const [tickets, attendance] = await Promise.all([
        listMyTickets(detail.profile.userId),
        listAttendanceByUserId(detail.profile.userId),
      ]);
      return { tickets, attendance };
    }),

  /** Pestaña Consumo — QR + POS, combinados (dos flujos que nunca se cruzan en origen, ver auditoría §C). */
  getConsumption: students360ViewProcedure
    .input(z.object({ studentProfileId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const detail = await loadAuthorizedStudent(input.studentProfileId, ctx);
      const [qr, pos] = await Promise.all([
        listQrRedemptionsByUser(detail.profile.userId, 100),
        listCommerceTransactionsByUserId(detail.profile.userId),
      ]);
      return { qr, pos };
    }),

  /** Pestaña Engagement — notificaciones in-app + preferencias del estudiante, vista admin (no existía, ver auditoría §F). */
  getEngagement: students360ViewProcedure
    .input(z.object({ studentProfileId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const detail = await loadAuthorizedStudent(input.studentProfileId, ctx);
      const [notifications, preferences, unreadCount] = await Promise.all([
        listMyNotifications(detail.profile.userId, 100),
        listMyPreferences(detail.profile.userId),
        getUnreadCount(detail.profile.userId),
      ]);
      return { notifications, preferences, unreadCount };
    }),

  /** Pestaña Administración — audit trail + histórico de login. */
  getAdminActivity: students360ViewProcedure
    .input(z.object({ studentProfileId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const detail = await loadAuthorizedStudent(input.studentProfileId, ctx);
      const [adminActions, logins] = await Promise.all([
        listAdminActionsByStudentProfileId(input.studentProfileId, 100),
        listLoginEventsByUserId(detail.profile.userId, 20),
      ]);
      return { adminActions, logins };
    }),

  /**
   * Pestaña Histórico — SEGOLIFE HISTORICAL STUDENT CLAIM (spec §16-18):
   * "ONE STUDENT 360" con actividad histórica Fourvenues ya reclamada, nunca
   * borra ni reemplaza la Historical Identity de origen (sigue viva y
   * auditable en el directorio admin). Vacío ({hasHistory:false}) es un
   * estado normal — la mayoría de Students no tienen historial reclamado.
   */
  getHistorical: students360ViewProcedure
    .input(z.object({
      studentProfileId: z.number().int().positive(),
      limit: z.number().int().min(1).max(100).default(30),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input, ctx }) => {
      const detail = await loadAuthorizedStudent(input.studentProfileId, ctx);
      const [overview, timeline] = await Promise.all([
        getHistoricalOverviewForStudent(detail.profile.userId),
        getHistoricalTimelineForStudent(detail.profile.userId, input.limit, input.offset),
      ]);
      return { overview, timeline };
    }),
});
