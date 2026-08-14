/**
 * studentRegisteredListener.ts — WELCOME_STUDENT (Communication Center,
 * spec §27). Se registra como UN LISTENER MÁS de `engagementEvents` — nunca
 * modifica registrationService.ts más allá de emitir el evento tipado (spec
 * §4: un motor de negocio nunca conoce notificationService.ts ni ningún
 * provider directamente).
 *
 * Semántica de fallo: igual que cualquier listener de engagementEvents — si
 * esto falla, el error se loguea y se descarta, NUNCA afecta al alta de
 * estudiante ya confirmada (ver engagementEvents.ts, EventEmitter con
 * try/catch por listener).
 *
 * Idempotencia real: `student_registered:<userId>` — un alta no puede
 * duplicar esta notificación de bienvenida, bloqueado por el UNIQUE real de
 * `notifications`.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { engagementEvents, type StudentRegisteredPayload } from "./engagementEvents";
import { communities, users } from "../../../drizzle/schema";
import { createNotification } from "./notificationService";
import { renderTemplate } from "./templates";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

export async function handleStudentRegisteredForEngagement(payload: StudentRegisteredPayload): Promise<void> {
  const [community] = await _db.select({ slug: communities.slug }).from(communities).where(eq(communities.id, payload.communityId)).limit(1);
  const [recipient] = await _db.select({ email: users.email }).from(users).where(eq(users.id, payload.userId)).limit(1);

  const rendered = renderTemplate(
    "account_welcome",
    { studentFirstName: payload.firstName },
    community ? `/${community.slug}` : null,
    { studentFirstName: payload.firstName }
  );

  await createNotification({
    userId: payload.userId,
    communityId: payload.communityId,
    type: "account_welcome",
    category: "account",
    audienceType: "transactional",
    rendered,
    templateKey: "account_welcome",
    templateVersion: 1,
    sourceType: "user",
    sourceId: payload.userId,
    idempotencyKey: `student_registered:${payload.userId}`,
    additionalChannels: ["email"],
    sendImmediately: true,
    recipient: { email: recipient?.email ?? null },
  });
}

let registered = false;

/** Se llama UNA vez desde server/_core/index.ts al arrancar — nunca desde el propio módulo (evita registrar el listener varias veces si el módulo se reimporta). */
export function registerStudentRegisteredListener(): void {
  if (registered) return;
  registered = true;
  engagementEvents.onTyped("student_registered", handleStudentRegisteredForEngagement);
}
