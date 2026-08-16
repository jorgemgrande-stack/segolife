/**
 * ReferralIntelligence.test.tsx — Fase 14, spec §17/§40.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const { mockReferralQuery } = vi.hoisted(() => ({ mockReferralQuery: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: { dashboard: { getReferralBi: { useQuery: mockReferralQuery } } } }));
vi.mock("wouter", () => ({ Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import { ReferralIntelligence } from "./ReferralIntelligence";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ReferralIntelligence", () => {
  it("sin referidos en el rango -> estado vacío honesto", () => {
    mockReferralQuery.mockReturnValue({ data: { registeredInPeriod: 0, convertedInPeriod: 0, rewardedInPeriod: 0, conversionRatePct: null, tokensIssuedInPeriod: 0, uniqueInvitersInPeriod: 0, pendingReconciliation: 0, topReferrers: [] }, isLoading: false, error: null });
    render(<ReferralIntelligence filters={{}} />);
    expect(screen.getByText(/Sin referidos registrados en este rango/)).toBeInTheDocument();
  });

  it("con datos reales, muestra la tasa de conversión real", () => {
    mockReferralQuery.mockReturnValue({ data: { registeredInPeriod: 17, convertedInPeriod: 7, rewardedInPeriod: 3, conversionRatePct: 41.2, tokensIssuedInPeriod: 300, uniqueInvitersInPeriod: 12, pendingReconciliation: 0, topReferrers: [] }, isLoading: false, error: null });
    render(<ReferralIntelligence filters={{}} />);
    expect(screen.getByText("41.2%")).toBeInTheDocument();
  });

  it("con pendientes de reconciliar, muestra el enlace de aviso con el conteo real", () => {
    mockReferralQuery.mockReturnValue({ data: { registeredInPeriod: 5, convertedInPeriod: 2, rewardedInPeriod: 0, conversionRatePct: 40, tokensIssuedInPeriod: 0, uniqueInvitersInPeriod: 2, pendingReconciliation: 2, topReferrers: [] }, isLoading: false, error: null });
    render(<ReferralIntelligence filters={{}} />);
    expect(screen.getByText(/2 pendiente\(s\) de reconciliar/)).toBeInTheDocument();
  });

  it("muestra el enlace real al Referral Admin existente, nunca uno inventado", () => {
    mockReferralQuery.mockReturnValue({ data: { registeredInPeriod: 5, convertedInPeriod: 2, rewardedInPeriod: 0, conversionRatePct: 40, tokensIssuedInPeriod: 0, uniqueInvitersInPeriod: 2, pendingReconciliation: 0, topReferrers: [] }, isLoading: false, error: null });
    render(<ReferralIntelligence filters={{}} />);
    const link = screen.getByText(/Ver Referral Admin/).closest("a");
    expect(link).toHaveAttribute("href", "/admin/students/referrals");
  });

  it("error de red -> mensaje real", () => {
    mockReferralQuery.mockReturnValue({ data: undefined, isLoading: false, error: { message: "Network error" } });
    render(<ReferralIntelligence filters={{}} />);
    expect(screen.getByText(/No se pudo cargar Referrals/)).toBeInTheDocument();
  });
});
