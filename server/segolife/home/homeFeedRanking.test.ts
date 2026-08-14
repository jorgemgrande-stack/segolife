import { describe, it, expect } from "vitest";
import { rankHomeFeed, type HomeRankingInput } from "./homeFeedRanking";

function blankInput(overrides: Partial<HomeRankingInput> = {}): HomeRankingInput {
  return {
    hasTicketToday: false,
    activeCommunityCount: 0,
    hasActiveBenefitToUse: false,
    hasAffordableMarketplaceItem: false,
    crossVenueAvailable: false,
    profileCompletenessPercent: 100,
    hasTonightEvent: false,
    ...overrides,
  };
}

describe("rankHomeFeed — prioridad determinista (spec §8/§23)", () => {
  it("sin ninguna señal real: hero null, forYou vacío (nunca inventa urgencias)", () => {
    const result = rankHomeFeed(blankInput());
    expect(result.hero).toBeNull();
    expect(result.forYou).toEqual([]);
  });

  it("ticket de hoy siempre gana como hero, incluso con todo lo demás activo", () => {
    const result = rankHomeFeed(blankInput({
      hasTicketToday: true,
      activeCommunityCount: 2,
      hasActiveBenefitToUse: true,
      hasAffordableMarketplaceItem: true,
      crossVenueAvailable: true,
      profileCompletenessPercent: 40,
      hasTonightEvent: true,
    }));
    expect(result.hero).toBe("ticket");
  });

  it("sin ticket: community activa gana sobre benefit/marketplace/cross-venue/perfil/tonight", () => {
    const result = rankHomeFeed(blankInput({
      activeCommunityCount: 1,
      hasActiveBenefitToUse: true,
      hasAffordableMarketplaceItem: true,
      crossVenueAvailable: true,
      profileCompletenessPercent: 10,
      hasTonightEvent: true,
    }));
    expect(result.hero).toBe("community");
  });

  it("cross-venue solo aparece si no hay nada de prioridad más alta", () => {
    const result = rankHomeFeed(blankInput({ crossVenueAvailable: true, hasTonightEvent: true }));
    expect(result.hero).toBe("cross_venue");
    expect(result.forYou).toEqual(["tonight"]);
  });

  it("perfil incompleto es P2 — pierde contra community/benefit/marketplace pero gana a tonight", () => {
    const result = rankHomeFeed(blankInput({ profileCompletenessPercent: 30, hasTonightEvent: true }));
    expect(result.hero).toBe("profile");
    expect(result.forYou).toEqual(["tonight"]);
  });

  it("deduplicación por construcción: el hero nunca se repite dentro de forYou", () => {
    const result = rankHomeFeed(blankInput({
      hasTicketToday: true,
      activeCommunityCount: 1,
      hasTonightEvent: true,
    }));
    expect(result.hero).toBe("ticket");
    expect(result.forYou).not.toContain("ticket");
    expect(result.forYou).toEqual(["community", "tonight"]);
  });

  it("perfil ya completo (100%) nunca aparece como candidato", () => {
    const result = rankHomeFeed(blankInput({ profileCompletenessPercent: 100, hasTonightEvent: true }));
    expect(result.hero).toBe("tonight");
    expect(result.forYou).toEqual([]);
  });
});
