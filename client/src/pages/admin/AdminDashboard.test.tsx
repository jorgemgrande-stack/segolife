/**
 * AdminDashboard.test.tsx — spec §32 (CRÍTICO): un widget que falla NUNCA
 * rompe el resto de /admin. Se simula que UN widget (Segolife Live) lanza
 * una excepción real durante el render y se comprueba que los demás widgets
 * siguen renderizando con normalidad.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const { noopQuery } = vi.hoisted(() => ({
  noopQuery: () => ({ data: undefined, isLoading: true, error: null }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    communities: { list: { useQuery: noopQuery } },
    dashboard: {
      getOverview: { useQuery: noopQuery },
      getActivity: { useQuery: () => { throw new Error("fallo simulado en Segolife Live"); } },
      getCommunityPulse: { useQuery: noopQuery },
      getStudentIntelligence: { useQuery: noopQuery },
      getHistoricalAudience: { useQuery: noopQuery },
      getCrossVenue: { useQuery: noopQuery },
      getEventPerformance: { useQuery: noopQuery },
      getVenuePerformance: { useQuery: noopQuery },
      getFourvenuesHealth: { useQuery: noopQuery },
      getLoyalty: { useQuery: noopQuery },
      getBenefits: { useQuery: noopQuery },
      getCrossVenueBenefitFlow: { useQuery: noopQuery },
      getPosProducts: { useQuery: noopQuery },
      getPaymentMix: { useQuery: noopQuery },
      getPlanAndPlay: { useQuery: noopQuery },
      getCommunityFunnel: { useQuery: noopQuery },
      getAlerts: { useQuery: noopQuery },
      getExecutiveSummary: { useQuery: noopQuery },
      getExecutiveBrief: { useQuery: noopQuery },
      getFunnels: { useQuery: noopQuery },
      getRetention: { useQuery: noopQuery },
      getHeatmap: { useQuery: noopQuery },
      getReferralBi: { useQuery: noopQuery },
      getSystemHealth: { useQuery: noopQuery },
    },
    loyaltyShadow: { getStatus: { useQuery: noopQuery } },
  },
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { name: "Ana García" } }) }));
vi.mock("@/components/AdminLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/contexts/AdminCommunityContext", () => ({
  useAdminCommunity: () => ({ filter: "all", setFilter: vi.fn(), communities: [], loading: false }),
  ADMIN_COMMUNITY_FILTER_ALL: "all",
}));

import AdminDashboard from "./AdminDashboard";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("AdminDashboard — aislamiento de errores por widget (spec §32)", () => {
  it("un widget que lanza una excepción muestra su propio error boundary, y el resto del panel sigue renderizando", () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // React logea el error del boundary — esperado, no un fallo del test
    render(<AdminDashboard />);

    // El widget roto muestra su boundary, con su nombre real:
    expect(screen.getByText(/No se pudo cargar "Segolife Live"/)).toBeInTheDocument();

    // El resto de widgets (identificados por su título de Panel) siguen presentes:
    expect(screen.getByText("Community Pulse")).toBeInTheDocument();
    expect(screen.getByText("Student Intelligence")).toBeInTheDocument();
    expect(screen.getByText("Event Performance")).toBeInTheDocument();
    expect(screen.getByText("Venue Performance")).toBeInTheDocument();
    expect(screen.getByText("Fourvenues Health")).toBeInTheDocument();
    expect(screen.getByText("SegoTokens Economy")).toBeInTheDocument();
    expect(screen.getAllByText("Comunity").length).toBeGreaterThan(0); // título del Panel + acceso rápido (spec §29-30: "Plan & Play" retirado del texto visible)
    expect(screen.getByText("Requiere tu atención")).toBeInTheDocument();

    // Fase 14 — paneles nuevos, mismo criterio de aislamiento por widget:
    expect(screen.getByText("Resumen de hoy")).toBeInTheDocument();
    expect(screen.getByText("Funnels de conversión")).toBeInTheDocument();
    expect(screen.getByText("Retención")).toBeInTheDocument();
    expect(screen.getByText("Referrals")).toBeInTheDocument();
  });
});
