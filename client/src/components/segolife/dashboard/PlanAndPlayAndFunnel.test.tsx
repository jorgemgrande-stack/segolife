/**
 * PlanAndPlayAndFunnel.test.tsx — spec §40: "No hay propuestas activas"
 * explícito cuando Plan & Play está vacío (nunca inventa datos), y el Funnel
 * muestra cada etapa con su propia población (nunca fusionadas).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const { mockPlanAndPlayQuery, mockFunnelQuery } = vi.hoisted(() => ({
  mockPlanAndPlayQuery: vi.fn(),
  mockFunnelQuery: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: { dashboard: { getPlanAndPlay: { useQuery: mockPlanAndPlayQuery }, getCommunityFunnel: { useQuery: mockFunnelQuery } } },
}));

import { PlanAndPlayAndFunnel } from "./PlanAndPlayAndFunnel";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("PlanAndPlayAndFunnel — Plan & Play vacío", () => {
  it("sin propuestas activas -> 'No hay propuestas activas', nunca inventa una propuesta", () => {
    mockPlanAndPlayQuery.mockReturnValue({
      data: { activeProposals: 0, responsesInPeriod: 0, participationPct: null, pendingModerationStudentProposals: 0, endingSoon: [], mostActive: null },
      isLoading: false, error: null,
    });
    mockFunnelQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    render(<PlanAndPlayAndFunnel filters={{}} />);
    expect(screen.getByText("No hay propuestas activas")).toBeInTheDocument();
  });

  it("propuesta más activa real (caso 'After Party Casanova') -> muestra título, respuesta dominante y % reales", () => {
    mockPlanAndPlayQuery.mockReturnValue({
      data: {
        activeProposals: 1, responsesInPeriod: 243, participationPct: 81, pendingModerationStudentProposals: 0, endingSoon: [],
        mostActive: { proposalId: 9, title: "After Party Casanova", responseCount: 243, topAnswerLabel: "yes", topAnswerPct: 82 },
      },
      isLoading: false, error: null,
    });
    mockFunnelQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    render(<PlanAndPlayAndFunnel filters={{}} />);
    expect(screen.getByText("After Party Casanova")).toBeInTheDocument();
    expect(screen.getByText(/yes 82% · 243 respuestas/)).toBeInTheDocument();
  });
});

describe("PlanAndPlayAndFunnel — Community Funnel", () => {
  it("las etapas Historical Audience y Registered Students se muestran SEPARADAS, nunca sumadas en un único número", () => {
    mockPlanAndPlayQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    mockFunnelQuery.mockReturnValue({
      data: {
        stages: [
          { key: "historical_audience", label: "Historical Audience", count: 6086, population: "Identidades históricas", period: "Histórico completo" },
          { key: "registered_students", label: "Registered Students", count: 1200, population: "Students registrados", period: "Total acumulado" },
        ],
        note: "Cada etapa usa su propia población y periodo.",
      },
      isLoading: false, error: null,
    });
    render(<PlanAndPlayAndFunnel filters={{}} />);
    // Formato de miles vía Intl (es-ES) — el separador exacto depende del ICU
    // del entorno; se acepta con o sin separador, nunca el valor SUMADO.
    expect(screen.getByText(/^6[.,]?086$/)).toBeInTheDocument();
    expect(screen.getByText(/^1[.,]?200$/)).toBeInTheDocument();
    expect(screen.queryByText(/^7[.,]?286$/)).not.toBeInTheDocument();
  });
});
