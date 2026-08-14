/**
 * LoyaltyAndBenefits.test.tsx — spec §40: badge LIVE ON/OFF refleja
 * `loyalty.data.liveStatus` (SegoTokens Live Activation, spec §19/§26),
 * Benefits con expiración perezosa y estado vacío cuando no hay Benefits
 * generados en el periodo.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const { mockLoyaltyQuery, mockBenefitsQuery, mockShadowStatusQuery } = vi.hoisted(() => ({
  mockLoyaltyQuery: vi.fn(),
  mockBenefitsQuery: vi.fn(),
  mockShadowStatusQuery: vi.fn(() => ({ data: { enabled: false }, isLoading: false, error: null })),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    dashboard: { getLoyalty: { useQuery: mockLoyaltyQuery }, getBenefits: { useQuery: mockBenefitsQuery } },
    loyaltyShadow: { getStatus: { useQuery: mockShadowStatusQuery } },
  },
}));

import { LoyaltyAndBenefits } from "./LoyaltyAndBenefits";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("LoyaltyAndBenefits — SegoTokens Economy", () => {
  it("mientras carga (sin data todavía) se muestra 'LIVE OFF' por defecto, nunca 'LIVE ON' sin confirmación", () => {
    mockLoyaltyQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    mockBenefitsQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    render(<LoyaltyAndBenefits filters={{}} />);
    expect(screen.getByText(/LIVE OFF/)).toBeInTheDocument();
  });

  it("con liveStatus='LIVE_LOCKED' real, muestra 'LIVE OFF'", () => {
    mockLoyaltyQuery.mockReturnValue({
      data: { liveStatus: "LIVE_LOCKED", earnedInPeriod: 500, spentInPeriod: 100, circulatingBalance: 4000, activeWallets: 20, avgBalance: 200, topEarningRules: [], tokensByVenue: [], tokensByEvent: [] },
      isLoading: false, error: null,
    });
    mockBenefitsQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    render(<LoyaltyAndBenefits filters={{}} />);
    expect(screen.getByText(/LIVE OFF/)).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
  });

  it("con liveStatus='LIVE_ACTIVE' real (SegoTokens Live Activation), muestra 'LIVE ON'", () => {
    mockLoyaltyQuery.mockReturnValue({
      data: { liveStatus: "LIVE_ACTIVE", earnedInPeriod: 42, spentInPeriod: 0, circulatingBalance: 42, activeWallets: 3, avgBalance: 14, topEarningRules: [], tokensByVenue: [], tokensByEvent: [] },
      isLoading: false, error: null,
    });
    mockBenefitsQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    render(<LoyaltyAndBenefits filters={{}} />);
    expect(screen.getByText("LIVE ON")).toBeInTheDocument();
    expect(screen.queryByText(/LIVE OFF/)).not.toBeInTheDocument();
  });

  it("nunca renderiza ningún KPI de 'tokens expirando' (spec §19 — no existe expires_at)", () => {
    mockLoyaltyQuery.mockReturnValue({
      data: { liveStatus: "LIVE_LOCKED", earnedInPeriod: 0, spentInPeriod: 0, circulatingBalance: 0, activeWallets: 0, avgBalance: null, topEarningRules: [], tokensByVenue: [], tokensByEvent: [] },
      isLoading: false, error: null,
    });
    mockBenefitsQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { container } = render(<LoyaltyAndBenefits filters={{}} />);
    expect(container.textContent?.toLowerCase()).not.toContain("expira");
  });
});

describe("LoyaltyAndBenefits — Benefits Performance", () => {
  it("sin Benefits generados en el periodo -> estado vacío honesto, no una tabla en blanco", () => {
    mockLoyaltyQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    mockBenefitsQuery.mockReturnValue({
      data: { generated: 0, available: 0, redeemed: 0, expired: 0, redemptionRatePct: null, expiringWithin48h: 0, mostRedeemed: [] },
      isLoading: false, error: null,
    });
    render(<LoyaltyAndBenefits filters={{}} />);
    expect(screen.getByText(/Sin Benefits generados en este rango/)).toBeInTheDocument();
  });

  it("Benefits caducando en <48h -> badge de aviso visible con el conteo real", () => {
    mockLoyaltyQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    mockBenefitsQuery.mockReturnValue({
      data: { generated: 10, available: 3, redeemed: 5, expired: 2, redemptionRatePct: 50, expiringWithin48h: 3, mostRedeemed: [] },
      isLoading: false, error: null,
    });
    render(<LoyaltyAndBenefits filters={{}} />);
    expect(screen.getByText(/3 caducan en <48h/)).toBeInTheDocument();
  });

  it("error de red en Benefits -> mensaje de error real, el widget de Loyalty sigue funcionando en paralelo", () => {
    mockLoyaltyQuery.mockReturnValue({
      data: { liveStatus: "LIVE_LOCKED", earnedInPeriod: 777, spentInPeriod: 0, circulatingBalance: 20, activeWallets: 1, avgBalance: 20, topEarningRules: [], tokensByVenue: [], tokensByEvent: [] },
      isLoading: false, error: null,
    });
    mockBenefitsQuery.mockReturnValue({ data: undefined, isLoading: false, error: { message: "Network error" } });
    render(<LoyaltyAndBenefits filters={{}} />);
    expect(screen.getByText(/No se pudo cargar Benefits/)).toBeInTheDocument();
    expect(screen.getByText("777")).toBeInTheDocument();
  });
});
