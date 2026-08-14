/**
 * studentAnalytics.ts — tracking interno mínimo de producto para la Student
 * App (STUDENT APP, PERSONALIZED HOME, spec §38). Deliberadamente NO es un
 * sistema de analytics: sin tabla nueva, sin migración, sin proveedor
 * externo nuevo (spec §38: "no enviar datos a terceros nuevos") — un evento
 * es una línea de log estructurada en el propio servicio (grepable en
 * Railway logs), best-effort y nunca bloqueante para el Student. Si algún
 * día aporta valor real tener esto consultable, se añadirá una tabla — no
 * antes (spec §61/§39: no sobreconstruir).
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";

const HOME_ANALYTICS_EVENTS = [
  "student_home_viewed",
  "home_card_clicked",
  "event_opened",
  "community_opened",
  "benefit_opened",
  "venue_opened",
  "wallet_opened",
] as const;

export const studentAnalyticsRouter = router({
  track: protectedProcedure
    .input(z.object({
      event: z.enum(HOME_ANALYTICS_EVENTS),
      kind: z.string().max(64).nullish(),
      targetId: z.union([z.string(), z.number()]).nullish(),
    }))
    .mutation(({ ctx, input }) => {
      // eslint-disable-next-line no-console
      console.log(`[ProductAnalytics] event=${input.event} userId=${ctx.user.id} kind=${input.kind ?? "-"} targetId=${input.targetId ?? "-"}`);
      return { success: true };
    }),
});
