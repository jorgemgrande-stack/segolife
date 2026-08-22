/**
 * profileIncompleteScheduler.ts — F66 (Communication Center). `profile_incomplete`
 * ya tenía plantilla completa EN/ES + email desde la fase original,
 * declarada `audienceType:"marketing"` con `triggerEvent: "ProfileIncomplete
 * (job programado, no inmediato)"` — confirmado por auditoría que ningún job
 * real existía todavía (docs/engagement/communication-center.md: "requiere
 * un job programado, no un evento síncrono").
 *
 * Fuente de verdad de "¿está incompleto?": `student_profiles.profileCompleted`
 * — la MISMA columna que ya mantiene `updateStudentProfile()`
 * (server/db/studentsDb.ts, vía `computeProfileCompleted()`) y que
 * `audienceEngine.ts` ya expone como filtro de audiencia (`profileComplete`).
 * Este job nunca reinventa qué campos hacen "completo" un perfil — solo lee
 * ese booleano ya mantenido.
 *
 * IMPORTANTE (audienceType:"marketing", a diferencia de benefitExpiryScheduler.ts/
 * tokensAdjustedListener.ts que son "transactional"): NUNCA se llama con
 * `sendImmediately:true` — ese flag salta `isChannelAllowed()` por completo
 * (notificationService.ts::createAndProcessDelivery), y un nudge de
 * marketing SÍ debe respetar la preferencia de opt-out del estudiante. Se
 * deja como delivery `pending` normal, recogida por engagementScheduler.ts
 * si `ENGAGEMENT_DELIVERY_ENABLED=true` — mismo kill switch de siempre, sin
 * bypass.
 *
 * Ventana de gracia: nunca se notifica un alta con menos de
 * PROFILE_INCOMPLETE_GRACE_DAYS de antigüedad — evita un nudge de "completa
 * tu perfil" al minuto de registrarse, mientras el propio flujo de alta
 * puede seguir pidiendo esos datos. Idempotencia: `profile_incomplete:<userId>`
 * (UNIQUE real de `notifications.idempotencyKey`) — se avisa UNA vez por
 * estudiante, no un recordatorio recurrente (mismo criterio que
 * benefit_expiring: la plantilla es un nudge puntual, no una campaña
 * repetida).
 */
import cron, { type ScheduledTask } from "node-cron";
import { eq, and, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { studentProfiles, users } from "../../../drizzle/schema";
import { createNotification } from "../engagement/notificationService";
import { renderTemplate } from "../engagement/templates";
import { resolveAdditionalChannels } from "../engagement/communicationChannelMatrix";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

const PROFILE_INCOMPLETE_GRACE_DAYS = 3;

export async function tick(): Promise<void> {
  const cutoff = new Date(Date.now() - PROFILE_INCOMPLETE_GRACE_DAYS * 24 * 60 * 60 * 1000);

  const rows = await _db.select({
    userId: studentProfiles.userId,
    email: users.email,
    createdAt: users.createdAt,
  })
    .from(studentProfiles)
    .innerJoin(users, eq(studentProfiles.userId, users.id))
    .where(and(eq(studentProfiles.profileCompleted, false), lte(users.createdAt, cutoff)));

  for (const row of rows) {
    try {
      await notifyOneIncompleteProfile(row);
    } catch (err) {
      console.error(`[ProfileIncompleteScheduler] fallo al notificar userId=${row.userId}:`, err);
    }
  }
}

async function notifyOneIncompleteProfile(row: { userId: number; email: string | null }): Promise<void> {
  const rendered = renderTemplate("profile_incomplete", {}, null);

  await createNotification({
    userId: row.userId,
    communityId: null,
    type: "profile_incomplete",
    category: "account",
    audienceType: "marketing",
    rendered,
    templateKey: "profile_incomplete",
    templateVersion: 1,
    sourceType: "user",
    sourceId: row.userId,
    idempotencyKey: `profile_incomplete:${row.userId}`,
    additionalChannels: resolveAdditionalChannels("profile_incomplete"),
    // NUNCA sendImmediately aquí — ver cabecera: debe respetar isChannelAllowed().
    recipient: { email: row.email ?? null },
  });
}

let task: ScheduledTask | null = null;

export function isProfileIncompleteSchedulerRunning(): boolean {
  return task !== null;
}

/** Se llama SOLO desde server/_core/index.ts, condicionado al feature flag `profile_incomplete_reminder_enabled` — nunca desde este módulo directamente. */
export function startProfileIncompleteScheduler(): void {
  if (task) return;
  // Una vez al día (no cada hora/minuto): el nudge es de "24-48h tras el
  // alta", nunca urgente — barrer student_profiles con más frecuencia no
  // aporta nada y solo añade carga.
  task = cron.schedule("0 9 * * *", () => {
    tick().catch(err => console.error("[ProfileIncompleteScheduler] tick falló:", err));
  });
  console.log("[ProfileIncompleteScheduler] Iniciado (diario, 09:00 servidor) — profile_incomplete_reminder_enabled=true");
}

export function stopProfileIncompleteScheduler(): void {
  task?.stop();
  task = null;
}
