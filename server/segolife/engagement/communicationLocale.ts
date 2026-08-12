/**
 * communicationLocale.ts — resolución centralizada de idioma de comunicación
 * (Communication Center, regla NO NEGOCIABLE: IE → inglés, UVA → español).
 *
 * NUNCA comparar slug de comunidad en el llamador (`if (slug === "ie")`) —
 * siempre pasar por aquí. El dato ya vive en `communities.defaultLocale`
 * (sembrado correctamente: ie→en, uva→es) y opcionalmente en
 * `student_profiles.preferredLocale` como override explícito del estudiante.
 *
 * Orden de resolución:
 *  1. Preferencia explícita del usuario (`student_profiles.preferredLocale`).
 *  2. Locale por defecto de la comunidad DE ORIGEN de la comunicación
 *     (`communities.defaultLocale`) — nunca "la comunidad del usuario" en
 *     abstracto, porque un estudiante puede pertenecer a IE y UVA a la vez
 *     (`user_communities` es M2M real) — se ancla a `communityId` del evento
 *     concreto (p.ej. `notifications.community_id`).
 *  3. Fallback seguro de plataforma: "es".
 *
 * BUG CORREGIDO POR ESTE MÓDULO: antes de esto, notificationService.ts y
 * engagementScheduler.ts enviaban SIEMPRE titleEn/bodyEn a los canales
 * externos (email/push/whatsapp), ignorando comunidad y preferencia — una
 * comunicación de UVA por email salía en inglés. Este módulo es la pieza que
 * faltaba conectar (ver docs/engagement/communication-center.md).
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { communities, studentProfiles } from "../../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
type AnyDbHandle = DbHandle | TxHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export type CommunicationLocale = "en" | "es";

const VALID_LOCALES: readonly CommunicationLocale[] = ["en", "es"];

function isValidLocale(value: unknown): value is CommunicationLocale {
  return typeof value === "string" && (VALID_LOCALES as readonly string[]).includes(value);
}

export interface ResolveCommunicationLocaleInput {
  /** Usuario destinatario — se consulta su preferredLocale si lo tiene fijado. */
  userId: number;
  /** Comunidad DE ORIGEN de la comunicación concreta (no "la comunidad del usuario"). null = sin comunidad de origen (p.ej. cuenta de staff), va directo al fallback de plataforma. */
  communityId: number | null;
}

export async function resolveCommunicationLocale(input: ResolveCommunicationLocaleInput, db?: AnyDbHandle): Promise<CommunicationLocale> {
  const conn = db ?? (await getDb());

  const [profile] = await conn.select({ preferredLocale: studentProfiles.preferredLocale })
    .from(studentProfiles).where(eq(studentProfiles.userId, input.userId)).limit(1);
  if (isValidLocale(profile?.preferredLocale)) return profile.preferredLocale;

  if (input.communityId != null) {
    const [community] = await conn.select({ defaultLocale: communities.defaultLocale })
      .from(communities).where(eq(communities.id, input.communityId)).limit(1);
    if (isValidLocale(community?.defaultLocale)) return community.defaultLocale;
  }

  return "es";
}

/** Elige el valor EN/ES según locale — helper puro, sin BD, para usar tras resolver el locale una vez. */
export function pickByLocale<T>(locale: CommunicationLocale, en: T, es: T): T {
  return locale === "en" ? en : es;
}
