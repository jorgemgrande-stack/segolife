/**
 * commandCenterActivity.ts — SEGOLIFE ADMIN COMMAND CENTER. `dashboard.getActivity`
 * — SEGOLIFE LIVE (spec §8): feed real de actividad reciente, paginado
 * server-side, sin PII (nunca email/teléfono).
 */
import { sql } from "drizzle-orm";
import type { AnyDbHandle } from "../tokens/tokenLedgerService";

export type ActivityItemType =
  | "registration" | "login" | "ticket_purchase" | "attendance" | "commerce"
  | "qr_redemption" | "token_earn" | "token_spend" | "benefit_granted" | "benefit_redeemed"
  | "plan_and_play_response" | "support" | "student_proposal" | "historical_claim";

export interface ActivityItem {
  timestamp: string;
  type: ActivityItemType;
  studentUserId: number | null;
  studentName: string | null;
  venueId: number | null;
  eventId: number | null;
  valueLabel: string | null;
}

/**
 * Feed unificado — mismas fuentes que activitySignals.ts (consistencia:
 * "actividad genuina" y "Segolife Live" cuentan las mismas cosas) más
 * registration/historical_claim, que no son señales de actividad recurrente
 * pero sí eventos dignos de aparecer en el feed en vivo.
 */
export async function getActivityFeed(limit: number, offset: number, communityId: number | null, db: AnyDbHandle): Promise<ActivityItem[]> {
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safeOffset = Math.max(0, offset);

  const result = await db.execute(sql`
    SELECT f.occurred_at, f.type, f.user_id, u.name AS student_name, f.venue_id, f.event_id, f.value_label
    FROM (
      SELECT o.purchased_at AS occurred_at, 'ticket_purchase' AS type, o.user_id, NULL AS venue_id, o.event_id,
             CONCAT(ROUND(o.total_cents / 100, 2), '€') AS value_label
      FROM ticket_orders o WHERE o.status = 'paid' AND o.user_id IS NOT NULL
      UNION ALL
      SELECT a.occurred_at, 'attendance', a.user_id, a.venue_id, a.event_id, NULL
      FROM event_attendance a
      UNION ALL
      SELECT c.occurred_at, 'commerce', c.user_id, c.venue_id, c.event_id, CONCAT(ROUND(c.total_cents / 100, 2), '€')
      FROM commerce_transactions c WHERE c.status = 'confirmed' AND c.user_id IS NOT NULL
      UNION ALL
      SELECT q.redeemed_at, 'qr_redemption', q.redeemed_by_user_id, q.venue_id, NULL, NULL
      FROM consumption_qr_codes q WHERE q.status = 'redeemed' AND q.redeemed_by_user_id IS NOT NULL AND q.redeemed_at IS NOT NULL
      UNION ALL
      SELECT t.created_at, IF(t.direction = 'credit', 'token_earn', 'token_spend'), t.user_id, t.venue_id, t.event_id, CONCAT(t.amount, ' tokens')
      FROM token_ledger t
      UNION ALL
      SELECT b.granted_at, 'benefit_granted', b.user_id, b.source_venue_id, b.source_event_id, NULL
      FROM user_benefits b
      UNION ALL
      SELECT b.used_at, 'benefit_redeemed', b.user_id, b.used_at_venue_id, b.used_at_event_id, NULL
      FROM user_benefits b WHERE b.used_at IS NOT NULL
      UNION ALL
      SELECT r.responded_at, 'plan_and_play_response', r.user_id, NULL, NULL, NULL
      FROM community_responses r
      UNION ALL
      SELECT s.created_at, 'support', s.user_id, NULL, NULL, NULL
      FROM community_supports s
      UNION ALL
      SELECT p.created_at, 'student_proposal', p.student_user_id, p.venue_id, NULL, p.title
      FROM community_student_proposals p
      UNION ALL
      SELECT le.occurred_at, 'login', le.user_id, NULL, NULL, NULL
      FROM student_login_events le
    ) f
    LEFT JOIN users u ON u.id = f.user_id
    WHERE 1=1 ${communityId != null ? sql`AND f.user_id IN (SELECT user_id FROM user_communities WHERE community_id = ${communityId})` : sql``}
    ORDER BY f.occurred_at DESC
    LIMIT ${safeLimit} OFFSET ${safeOffset}
  `);
  const rows = (result as unknown as [Array<{
    occurred_at: string | Date; type: ActivityItemType; user_id: number | null; student_name: string | null;
    venue_id: number | null; event_id: number | null; value_label: string | null;
  }>])[0] ?? [];

  return rows.map(r => ({
    timestamp: (r.occurred_at instanceof Date ? r.occurred_at : new Date(r.occurred_at)).toISOString(),
    type: r.type,
    studentUserId: r.user_id,
    studentName: r.student_name,
    venueId: r.venue_id,
    eventId: r.event_id,
    valueLabel: r.value_label,
  }));
}
