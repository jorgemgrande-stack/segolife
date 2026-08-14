/**
 * StudentIntelligence.test.tsx — Deep Navigation (Production Polish Gate
 * spec §10/§13/§14/§26): cada segmento enlaza a `/admin/students?segment=X`
 * (el gap conocido del informe anterior — antes enlazaba siempre a la lista
 * sin filtro), e Historical Audience/Cross-Venue enlazan con los filtros
 * reales soportados por HistoricalIdentities.tsx.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const { mockStudentIntelligenceQuery, mockHistoricalQuery, mockCrossVenueQuery } = vi.hoisted(() => ({
  mockStudentIntelligenceQuery: vi.fn(),
  mockHistoricalQuery: vi.fn(),
  mockCrossVenueQuery: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    dashboard: {
      getStudentIntelligence: { useQuery: mockStudentIntelligenceQuery },
      getHistoricalAudience: { useQuery: mockHistoricalQuery },
      getCrossVenue: { useQuery: mockCrossVenueQuery },
    },
  },
}));

import { StudentIntelligence } from "./StudentIntelligence";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function intelligenceFixture() {
  return {
    totalStudents: 100,
    segments: [
      { key: "new", label: "Nuevo", count: 10, populationPct: 10 },
      { key: "active", label: "Activo", count: 40, populationPct: 40 },
      { key: "highly_engaged", label: "Muy comprometido", count: 15, populationPct: 15 },
      { key: "at_risk", label: "En riesgo", count: 17, populationPct: 17 },
      { key: "dormant", label: "Dormido", count: 8, populationPct: 8 },
      { key: "high_spend", label: "Alto gasto", count: 10, populationPct: 10 },
    ],
    multiVenue: { count: 5, populationPct: 5, avgVenuesPerActiveStudent: 2.1 },
  };
}

describe("StudentIntelligence — deep navigation", () => {
  it("el segmento AT RISK enlaza a /admin/students?segment=at_risk (el gap conocido del informe anterior)", () => {
    mockStudentIntelligenceQuery.mockReturnValue({ data: intelligenceFixture(), isLoading: false, error: null });
    mockHistoricalQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    mockCrossVenueQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    render(<StudentIntelligence filters={{}} />);
    const link = screen.getByText("En riesgo").closest("a");
    expect(link).toHaveAttribute("href", "/admin/students?segment=at_risk");
  });

  it("TODOS los segmentos enlazan con su propio ?segment=, nunca a la lista genérica sin filtro", () => {
    mockStudentIntelligenceQuery.mockReturnValue({ data: intelligenceFixture(), isLoading: false, error: null });
    mockHistoricalQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    mockCrossVenueQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    render(<StudentIntelligence filters={{}} />);
    for (const [key, label] of [["new", "Nuevo"], ["dormant", "Dormido"], ["high_spend", "Alto gasto"]] as const) {
      expect(screen.getByText(label).closest("a")).toHaveAttribute("href", `/admin/students?segment=${key}`);
    }
  });

  it("Historical Audience: 'Vinculadas' enlaza con status=LINKED, 'Cross-venue' con crossVenueOnly=true", () => {
    mockStudentIntelligenceQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    mockHistoricalQuery.mockReturnValue({
      data: { total: 6086, unregistered: 5000, possibleMatch: 400, autoMatchCandidate: 100, linked: 500, conflict: 86, crossVenue: 888 },
      isLoading: false, error: null,
    });
    mockCrossVenueQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    render(<StudentIntelligence filters={{}} />);
    expect(screen.getByText("Vinculadas").closest("a")).toHaveAttribute("href", "/admin/students/historical?status=LINKED");
    expect(screen.getByText("Cross-venue").closest("a")).toHaveAttribute("href", "/admin/students/historical?crossVenueOnly=true");
  });

  it("Cross-Venue: 'Históricos multi-venue' enlaza al mismo filtro real crossVenueOnly=true", () => {
    mockStudentIntelligenceQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    mockHistoricalQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    mockCrossVenueQuery.mockReturnValue({
      data: { registered: { singleVenue: 10, multiVenue: 2, avgVenuesPerPerson: 1.2, multiVenuePct: 16.6 }, historical: { total: 6086, crossVenue: 888, crossVenuePct: 14.6 } },
      isLoading: false, error: null,
    });
    render(<StudentIntelligence filters={{}} />);
    expect(screen.getByText("Históricos multi-venue").closest("a")).toHaveAttribute("href", "/admin/students/historical?crossVenueOnly=true");
  });
});
