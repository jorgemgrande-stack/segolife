/**
 * benefitGrantedListener.ts — primera automatización REAL del Engagement
 * Core (spec puntos 4 y 27). Se registra como UN LISTENER MÁS de
 * `benefitEvents` (Fase 4) — nunca modifica benefitGrantService.ts ni
 * benefitEvents.ts, nunca un segundo evento paralelo.
 *
 * Semántica de fallo: igual que cualquier listener de benefitEvents — si
 * esto falla, el error se loguea y se descarta, NUNCA afecta al Benefit ya
 * concedido (ver benefitEvents.ts).
 *
 * Idempotencia real: `benefit_granted:<userBenefitId>` — el mismo
 * BenefitGranted emitido dos veces (no debería pasar, pero por diseño
 * nunca debe poder duplicar notificación) resuelve al mismo
 * idempotency_key, bloqueado por el UNIQUE real de `notifications`.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { benefitEvents, type BenefitGrantedPayload } from "../benefits/benefitEvents";
import { benefitDefinitions, communities, users } from "../../../drizzle/schema";
import { createNotification } from "./notificationService";
import { renderTemplate } from "./templates";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

export async function handleBenefitGrantedForEngagement(payload: BenefitGrantedPayload): Promise<void> {
  const [definition] = await _db.select().from(benefitDefinitions).where(eq(benefitDefinitions.id, payload.benefitDefinitionId)).limit(1);
  if (!definition) return; // definición eliminada entre la concesión y este listener — caso extremo, no hay nada que notificar

  let communitySlug: string | null = null;
  if (payload.communityId) {
    const [community] = await _db.select().from(communities).where(eq(communities.id, payload.communityId)).limit(1);
    communitySlug = community?.slug ?? null;
  }

  const benefitNameEn = definition.nameEn ?? definition.name;
  const benefitNameEs = definition.nameEs ?? definition.name;
  const rendered = renderTemplate(
    "benefit_granted",
    { benefitName: benefitNameEn },
    communitySlug ? `/${communitySlug}/benefits/${payload.userBenefitId}` : null,
    { benefitName: benefitNameEs }
  );

  // v2 (Communication Center): la plantilla ya declaraba email como canal
  // soportado, pero nunca se pasaba additionalChannels — nunca se intentaba
  // el envío. sendImmediately:true porque "beneficio desbloqueado" es un
  // momento puntual, no debe esperar al próximo tick del scheduler.
  const [recipient] = await _db.select({ email: users.email }).from(users).where(eq(users.id, payload.userId)).limit(1);

  await createNotification({
    userId: payload.userId,
    communityId: payload.communityId,
    type: "benefit_granted",
    category: "benefits",
    audienceType: "transactional",
    rendered,
    templateKey: "benefit_granted",
    templateVersion: 2,
    sourceType: "user_benefit",
    sourceId: payload.userBenefitId,
    idempotencyKey: `benefit_granted:${payload.userBenefitId}`,
    additionalChannels: ["email"],
    sendImmediately: true,
    recipient: { email: recipient?.email ?? null },
  });
}

let registered = false;

/** Se llama UNA vez desde server/_core/index.ts al arrancar — nunca desde el propio módulo (evita registrar el listener varias veces si el módulo se reimporta). */
export function registerBenefitGrantedListener(): void {
  if (registered) return;
  registered = true;
  benefitEvents.onTyped("BenefitGranted", handleBenefitGrantedForEngagement);
}
