/**
 * tokensEarnedListener.ts — Communication Center. "tokens_earned" ya vivía
 * en el catálogo tipado de engagementEvents.ts pero nunca se emitía
 * (confirmado por auditoría) — tokenEngine.ts ahora sí lo emite al final de
 * earnTokens(). Política de relevancia (spec: "NO mandar email por cada
 * movimiento diminuto") vive AQUÍ, no en el motor — in-app se procesa
 * siempre, el canal email solo se añade si el monto supera el umbral o viene
 * de una campaña.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { engagementEvents, type TokensEarnedPayload } from "./engagementEvents";
import { tokenLedger, communities, users } from "../../../drizzle/schema";
import { createNotification } from "./notificationService";
import { renderTemplate } from "./templates";
import { resolveAdditionalChannels } from "./communicationChannelMatrix";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

/** Política de relevancia (spec punto 18) — ajustable, documentada aquí en un único sitio. */
const EMAIL_RELEVANCE_THRESHOLD = 50;

export async function handleTokensEarnedForEngagement(payload: TokensEarnedPayload): Promise<void> {
  const [entry] = await _db.select().from(tokenLedger).where(eq(tokenLedger.id, payload.ledgerId)).limit(1);
  if (!entry) return;

  const isRelevant = payload.amount >= EMAIL_RELEVANCE_THRESHOLD || entry.campaignId != null;

  let communitySlug: string | null = null;
  if (payload.communityId) {
    const [community] = await _db.select().from(communities).where(eq(communities.id, payload.communityId)).limit(1);
    communitySlug = community?.slug ?? null;
  }

  const rendered = renderTemplate(
    "tokens_earned_relevant",
    { amountLabel: String(payload.amount), reason: entry.reason, balanceLabel: `${entry.balanceAfter} SegoTokens` },
    communitySlug ? `/${communitySlug}/tokens` : null,
  );

  const recipient = isRelevant
    ? (await _db.select({ email: users.email }).from(users).where(eq(users.id, payload.userId)).limit(1))[0]
    : undefined;

  await createNotification({
    userId: payload.userId,
    communityId: payload.communityId,
    type: "tokens_earned",
    category: "rewards",
    audienceType: "transactional",
    rendered,
    templateKey: "tokens_earned_relevant",
    templateVersion: 1,
    sourceType: "token_ledger",
    sourceId: payload.ledgerId,
    idempotencyKey: `tokens_earned:${payload.ledgerId}`,
    additionalChannels: isRelevant ? resolveAdditionalChannels("tokens_earned_relevant") : [],
    sendImmediately: true,
    recipient: recipient ? { email: recipient.email ?? null } : undefined,
  });
}

let registered = false;

export function registerTokensEarnedListener(): void {
  if (registered) return;
  registered = true;
  engagementEvents.onTyped("tokens_earned", handleTokensEarnedForEngagement);
}
