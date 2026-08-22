/**
 * tokensAdjustedListener.ts — F66 (Communication Center). `tokens_adjusted_admin`
 * ya vivía en el catálogo de plantillas (contenido EN/ES completo) y en
 * engagementEvents.ts, pero ningún caller real lo emitía todavía — confirmado
 * por auditoría ("solo falta el trigger", docs/engagement/communication-center.md).
 * `adjustManualTokens()` (tokenLedgerService.ts) ahora emite el evento al
 * final; este listener es quien decide notificar, nunca el motor de tokens.
 *
 * Sin comunidad de origen (a diferencia de tokensEarnedListener.ts): un
 * ajuste manual no tiene un venue/evento/comunidad real detrás — el deep-link
 * usa la primera comunidad real del estudiante (mismo criterio que
 * notifyProposalPublished en communityAudienceService.ts cuando pertenece a
 * más de una).
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { engagementEvents, type TokensAdjustedAdminPayload } from "./engagementEvents";
import { tokenLedger, userCommunities, communities, users } from "../../../drizzle/schema";
import { createNotification } from "./notificationService";
import { renderTemplate } from "./templates";
import { resolveAdditionalChannels } from "./communicationChannelMatrix";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

export async function handleTokensAdjustedForEngagement(payload: TokensAdjustedAdminPayload): Promise<void> {
  const [entry] = await _db.select().from(tokenLedger).where(eq(tokenLedger.id, payload.ledgerId)).limit(1);
  if (!entry) return;

  const [membership] = await _db.select({ slug: communities.slug })
    .from(userCommunities)
    .innerJoin(communities, eq(userCommunities.communityId, communities.id))
    .where(eq(userCommunities.userId, payload.userId))
    .limit(1);

  const signedAmount = payload.direction === "credit" ? payload.amount : -payload.amount;
  const amountLabel = `${signedAmount > 0 ? "+" : ""}${signedAmount} SegoTokens`;

  const rendered = renderTemplate(
    "tokens_adjusted_admin",
    { amountLabel, reason: entry.reason, balanceLabel: `${entry.balanceAfter} SegoTokens` },
    membership ? `/${membership.slug}/tokens` : null,
  );

  const [recipient] = await _db.select({ email: users.email }).from(users).where(eq(users.id, payload.userId)).limit(1);

  await createNotification({
    userId: payload.userId,
    communityId: null,
    type: "tokens_adjusted_admin",
    category: "rewards",
    audienceType: "transactional",
    rendered,
    templateKey: "tokens_adjusted_admin",
    templateVersion: 1,
    sourceType: "token_ledger",
    sourceId: payload.ledgerId,
    idempotencyKey: `tokens_adjusted_admin:${payload.ledgerId}`,
    additionalChannels: resolveAdditionalChannels("tokens_adjusted_admin"),
    sendImmediately: true,
    recipient: { email: recipient?.email ?? null },
  });
}

let registered = false;

/** Se llama UNA vez desde server/_core/index.ts al arrancar — nunca desde el propio módulo. */
export function registerTokensAdjustedListener(): void {
  if (registered) return;
  registered = true;
  engagementEvents.onTyped("tokens_adjusted_admin", handleTokensAdjustedForEngagement);
}
