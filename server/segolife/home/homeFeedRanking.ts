/**
 * homeFeedRanking.ts — capa de priorización de la Home Student (STUDENT APP,
 * PERSONALIZED HOME, spec §8/§23/§24). Función pura, sin BD ni red: recibe
 * booleans/números ya resueltos por homeSummaryService y decide qué card es
 * el "Next Best Action" (hero) y el orden del resto ("For You"). Reglas
 * deterministas por orden de prioridad — NADA de IA/ML/scoring difuso (spec
 * §22: "Todavía no"). El hero se excluye de forYou por construcción — así
 * un mismo hecho nunca aparece dos veces (spec §24, deduplicación).
 */
export type HomeCardKind =
  | "ticket"
  | "community"
  | "benefit_active"
  | "marketplace"
  | "cross_venue"
  | "profile"
  | "tonight";

export interface HomeRankingInput {
  hasTicketToday: boolean;
  activeCommunityCount: number;
  hasActiveBenefitToUse: boolean;
  hasAffordableMarketplaceItem: boolean;
  crossVenueAvailable: boolean;
  profileCompletenessPercent: number;
  hasTonightEvent: boolean;
}

/** Orden de prioridad fijo (spec §8/§23: P0 transaccional → P1 oportunidad con plazo → P2 progreso/cuenta → P3 descubrimiento). */
const PRIORITY_ORDER: Array<{ kind: HomeCardKind; isEligible: (i: HomeRankingInput) => boolean }> = [
  { kind: "ticket", isEligible: i => i.hasTicketToday },
  { kind: "community", isEligible: i => i.activeCommunityCount > 0 },
  { kind: "benefit_active", isEligible: i => i.hasActiveBenefitToUse },
  { kind: "marketplace", isEligible: i => i.hasAffordableMarketplaceItem },
  { kind: "cross_venue", isEligible: i => i.crossVenueAvailable },
  { kind: "profile", isEligible: i => i.profileCompletenessPercent < 100 },
  { kind: "tonight", isEligible: i => i.hasTonightEvent },
];

export interface HomeFeedRanking {
  hero: HomeCardKind | null;
  forYou: HomeCardKind[];
}

export function rankHomeFeed(input: HomeRankingInput): HomeFeedRanking {
  const eligible = PRIORITY_ORDER.filter(c => c.isEligible(input)).map(c => c.kind);
  const [hero = null, ...forYou] = eligible;
  return { hero, forYou };
}
