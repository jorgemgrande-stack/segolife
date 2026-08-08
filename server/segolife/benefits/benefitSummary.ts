/**
 * benefitSummary.ts — construye el objeto ligero `benefitsUnlocked[]` que se
 * añade a la respuesta inmediata de un canje (Fase 3 QR → Fase 4 Benefits,
 * ver consumptionQrService.ts). Deliberadamente separado de
 * benefitRuleEngine.ts: el motor de reglas no debería tener que conocer la
 * forma exacta de la respuesta HTTP/tRPC — este archivo es la única frontera
 * entre "qué se concedió" (UnlockedBenefit) y "qué le mostramos al
 * estudiante en el momento" (BenefitUnlockedSummary), sin datos sensibles de
 * admin (nunca incluye qrTokenHash ni metadata interna de la regla).
 */
import { inArray } from "drizzle-orm";
import { venues } from "../../../drizzle/schema";
import type { AnyDbHandle } from "../tokens/tokenLedgerService";
import type { UnlockedBenefit } from "./benefitRuleEngine";

export interface BenefitUnlockedSummary {
  userBenefitId: number;
  benefitDefinitionId: number;
  name: string;
  nameEn: string | null;
  nameEs: string | null;
  benefitType: string;
  destinationVenueId: number | null;
  destinationVenueName: string | null;
  destinationEventId: number | null;
  validFrom: Date;
  validUntil: Date | null;
  /** Token en claro del QR — el frontend lo usa para renderizar el código inmediatamente tras el desbloqueo, sin una segunda llamada. */
  qrToken: string;
}

export async function buildBenefitUnlockedSummaries(
  unlocked: UnlockedBenefit[],
  conn: AnyDbHandle
): Promise<BenefitUnlockedSummary[]> {
  if (unlocked.length === 0) return [];

  const venueIds = Array.from(new Set(
    unlocked.map(u => u.definition.destinationVenueId).filter((v): v is number => v != null)
  ));
  const venueRows = venueIds.length > 0
    ? await conn.select({ id: venues.id, name: venues.name }).from(venues).where(inArray(venues.id, venueIds))
    : [];
  const venueNameById = new Map(venueRows.map(v => [v.id, v.name]));

  return unlocked.map(u => ({
    userBenefitId: u.userBenefit.id,
    benefitDefinitionId: u.definition.id,
    name: u.definition.name,
    nameEn: u.definition.nameEn,
    nameEs: u.definition.nameEs,
    benefitType: u.definition.benefitType,
    destinationVenueId: u.definition.destinationVenueId,
    destinationVenueName: u.definition.destinationVenueId != null ? (venueNameById.get(u.definition.destinationVenueId) ?? null) : null,
    destinationEventId: u.definition.destinationEventId,
    validFrom: u.userBenefit.validFrom,
    validUntil: u.userBenefit.validUntil,
    qrToken: u.qrToken,
  }));
}
