/**
 * LoyaltyAndBenefits.test.tsx — spec §40: badge "LIVE OFF" SIEMPRE visible
 * (loyalty read-only), Benefits con expiración perezosa y estado vacío
 * cuando no hay Benefits generados en el periodo.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const { mockLoyaltyQuery, mockBenefitsQuery } = vi.hoisted(() => ({
  mockLoyaltyQuery: vi.fn(),
  mockBenefitsQuery: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: { dashboard: { getLoyalty: { useQuery: mockLoyaltyQuery }, getBenefits: { useQuery: mockBenefitsQuery } } },
}));

import { LoyaltyAndBenefits } from "./LoyaltyAndBenefits";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("LoyaltyAndBenefits — SegoTokens Economy", () => {
  it("el badge 'LIVE OFF' se muestra SIEMPRE, incluso mientras carga o si hay datos (loyalty es read-only por diseño, spec §36)", () => {
    mockLoyaltyQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    mockBenefitsQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    render(<LoyaltyAndBenefits filters={{}} />);
    expect(screen.getByText(/LIVE OFF/)).toBeInTheDocument();
  });

  it("con datos reales, sigue mostrando LIVE OFF — nunca desaparece ni cambia a 'activo'", () => {
    mockLoyaltyQuery.mockReturnValue({
      data: { liveStatus: "LIVE_LOCKED", earnedInPeriod: 500, spentInPeriod: 100, circulatingBalance: 4000, activeWallets: 20, avgBalance: 200, topEarningRules: [], tokensByVenue: [], tokensByEvent: [] },
      isLoading: false, error: null,
    });
    mockBenefitsQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    render(<LoyaltyAndBenefits filters={{}} />);
    expect(screen.getByText(/LIVE OFF/)).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
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
