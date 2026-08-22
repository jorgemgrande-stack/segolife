/**
 * benefitExpiryScheduler.ts — F66 (Communication Center). `benefit_expiring`
 * ya tenía plantilla completa EN/ES + email (v2) desde la fase original,
 * declarada con `triggerEvent: "BenefitExpiring (job programado)"` — pero
 * confirmado por auditoría que ningún job real existía todavía
 * (docs/engagement/communication-center.md: "requiere un job programado,
 * no un evento síncrono — no implementado en esta fase").
 *
 * A diferencia de un listener de `engagementEvents` (reacciona a que algo
 * YA pasó), aquí no hay un evento de dominio discreto que emitir — la
 * "intención de comunicación" ES el propio barrido programado detectando la
 * condición de "caduca pronto". Por eso llama a `createNotification()`
 * directamente en vez de emitir-y-escuchar (mismo criterio pragmático que
 * `engagementScheduler.ts::processPendingDelivery`/`campaignService.ts::
 * sendCampaignNow`, que tampoco pasan por el bus de eventos).
 *
 * Ventana: BENEFIT_EXPIRING_WINDOW_HOURS (24h) — mismo orden de magnitud que
 * el nombre ya reservado `event_reminder_24h` (ese sigue sin construir,
 * documentado aparte). Idempotencia: `benefit_expiring:<userBenefitId>` —
 * UNIQUE real de `notifications.idempotencyKey`, sin necesidad de una
 * columna nueva ni migración — un beneficio con `validUntil` fijo solo
 * "está a punto de caducar" una vez en su ciclo de vida, avisar una sola
 * vez es la semántica correcta (no un recordatorio recurrente).
 *
 * Mismo criterio que engagementScheduler.ts/integrationScheduler.ts/
 * communityLifecycleScheduler.ts: node-cron, NUNCA arranca solo (feature
 * flag DB-backed vía conditionallyStartJob, default false).
 */
import cron, { type ScheduledTask } from "node-cron";
import { eq, and, gt, lte, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { userBenefits, benefitDefinitions, users } from "../../../drizzle/schema";
import { createNotification } from "../engagement/notificationService";
import { renderTemplate } from "../engagement/templates";
import { resolveAdditionalChannels } from "../engagement/communicationChannelMatrix";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

const BENEFIT_EXPIRING_WINDOW_HOURS = 24;

function formatExpiryLabel(d: Date, locale: "en" | "es"): string {
  return d.toLocaleDateString(locale === "en" ? "en-GB" : "es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export async function tick(): Promise<void> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + BENEFIT_EXPIRING_WINDOW_HOURS * 60 * 60 * 1000);

  const rows = await _db.select({
    userBenefitId: userBenefits.id,
    userId: userBenefits.userId,
    communityId: userBenefits.communityId,
    validUntil: userBenefits.validUntil,
    name: benefitDefinitions.name,
    nameEn: benefitDefinitions.nameEn,
    nameEs: benefitDefinitions.nameEs,
  })
    .from(userBenefits)
    .innerJoin(benefitDefinitions, eq(userBenefits.benefitDefinitionId, benefitDefinitions.id))
    .where(and(
      eq(userBenefits.status, "active"),
      isNotNull(userBenefits.validUntil),
      gt(userBenefits.validUntil, now),
      lte(userBenefits.validUntil, windowEnd),
    ));

  for (const row of rows) {
    try {
      await notifyOneExpiringBenefit(row);
    } catch (err) {
      console.error(`[BenefitExpiryScheduler] fallo al notificar userBenefitId=${row.userBenefitId}:`, err);
    }
  }
}

async function notifyOneExpiringBenefit(row: {
  userBenefitId: number; userId: number; communityId: number | null; validUntil: Date | null;
  name: string; nameEn: string | null; nameEs: string | null;
}): Promise<void> {
  if (!row.validUntil) return;
  const nameEn = row.nameEn ?? row.name;
  const nameEs = row.nameEs ?? row.name;

  const rendered = renderTemplate(
    "benefit_expiring",
    { benefitName: nameEn, expiryLabel: formatExpiryLabel(row.validUntil, "en") },
    null,
    { benefitName: nameEs, expiryLabel: formatExpiryLabel(row.validUntil, "es") },
  );

  const [recipient] = await _db.select({ email: users.email }).from(users).where(eq(users.id, row.userId)).limit(1);

  await createNotification({
    userId: row.userId,
    communityId: row.communityId,
    type: "benefit_expiring",
    category: "benefits",
    audienceType: "transactional",
    rendered,
    templateKey: "benefit_expiring",
    templateVersion: 2,
    sourceType: "user_benefit",
    sourceId: row.userBenefitId,
    idempotencyKey: `benefit_expiring:${row.userBenefitId}`,
    additionalChannels: resolveAdditionalChannels("benefit_expiring"),
    sendImmediately: true,
    recipient: { email: recipient?.email ?? null },
  });
}

let task: ScheduledTask | null = null;

export function isBenefitExpirySchedulerRunning(): boolean {
  return task !== null;
}

/** Se llama SOLO desde server/_core/index.ts, condicionado al feature flag `benefit_expiry_reminder_enabled` — nunca desde este módulo directamente. */
export function startBenefitExpiryScheduler(): void {
  if (task) return;
  // Cada hora (no cada minuto como el resto): una ventana de 24h no exige
  // resolución de minuto — evita 1440 barridos/día sobre user_benefits para
  // una condición que apenas cambia dentro de una misma hora.
  task = cron.schedule("0 * * * *", () => {
    tick().catch(err => console.error("[BenefitExpiryScheduler] tick falló:", err));
  });
  console.log("[BenefitExpiryScheduler] Iniciado (cada hora) — benefit_expiry_reminder_enabled=true");
}

export function stopBenefitExpiryScheduler(): void {
  task?.stop();
  task = null;
}
