/**
 * CommandCenterHeader.test.tsx — spec §40: loading/zero-activity/error del
 * resumen ejecutivo (DETERMINISTA, sin IA), KPI strip con click-through, y
 * el saludo con el nombre real del admin.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const { mockOverviewQuery, mockAuth } = vi.hoisted(() => ({
  mockOverviewQuery: vi.fn(),
  mockAuth: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({ trpc: { dashboard: { getOverview: { useQuery: mockOverviewQuery } } } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => mockAuth() }));

import { CommandCenterHeader } from "./CommandCenterHeader";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function overviewFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    students: { total: 500, newInPeriod: 12 },
    active: { activeInPeriod: 184, dau: 30, wau: 90, mau: 150 },
    tickets: { ordersInPeriod: 40, paid: 35, cancelled: 2, refunded: 1, ticketRevenueCents: 250000 },
    attendance: { confirmed: 60, eligibleTickets: 80, attendanceRatePct: 75, unresolvedHistoricalCount: 0 },
    segoTokens: { earnedInPeriod: 900, spentInPeriod: 300, circulatingBalance: 5000, liveStatus: "LIVE_LOCKED" as const },
    benefits: { generated: 20, available: 8, redeemed: 10, expired: 2, redemptionRatePct: 50 },
    ...overrides,
  };
}

describe("CommandCenterHeader", () => {
  it("estado loading: no muestra un resumen inventado mientras carga", () => {
    mockAuth.mockReturnValue({ user: { name: "Ana García" } });
    mockOverviewQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    render(<CommandCenterHeader filters={{}} />);
    expect(screen.getByText(/Calculando el estado de SEGOLIFE/)).toBeInTheDocument();
    expect(screen.getByText(/Buenos días, Ana/)).toBeInTheDocument();
  });

  it("estado error: mensaje de error real, nunca un resumen inventado ni un crash", () => {
    mockAuth.mockReturnValue({ user: { name: "Ana García" } });
    mockOverviewQuery.mockReturnValue({ data: undefined, isLoading: false, error: { message: "Network error" } });
    render(<CommandCenterHeader filters={{}} />);
    expect(screen.getByText(/No se pudo calcular el resumen ejecutivo/)).toBeInTheDocument();
  });

  it("actividad genuina > 0: el resumen incluye el número REAL de estudiantes activos, determinista (sin IA)", () => {
    mockAuth.mockReturnValue({ user: { name: "Ana García" } });
    mockOverviewQuery.mockReturnValue({ data: overviewFixture(), isLoading: false, error: null });
    render(<CommandCenterHeader filters={{ range: "30d" }} />);
    expect(screen.getByText(/SEGOLIFE está activo\. 184 estudiantes han interactuado/)).toBeInTheDocument();
  });

  it("sin actividad (activeInPeriod=0): mensaje honesto de cero actividad, NUNCA inventa números", () => {
    mockAuth.mockReturnValue({ user: { name: "Ana García" } });
    mockOverviewQuery.mockReturnValue({
      data: overviewFixture({ active: { activeInPeriod: 0, dau: 0, wau: 0, mau: 0 } }),
      isLoading: false, error: null,
    });
    render(<CommandCenterHeader filters={{ range: "today" }} />);
    expect(screen.getByText("No hay actividad significativa registrada hoy.")).toBeInTheDocument();
  });

  it("KPI strip: cada tarjeta enlaza a una ruta real del admin (click-through)", () => {
    mockAuth.mockReturnValue({ user: { name: "Ana García" } });
    mockOverviewQuery.mockReturnValue({ data: overviewFixture(), isLoading: false, error: null });
    render(<CommandCenterHeader filters={{}} />);
    const studentsLink = screen.getByText("Estudiantes").closest("a");
    expect(studentsLink).toHaveAttribute("href", "/admin/students");
    const tokensLink = screen.getByText("SegoTokens").closest("a");
    expect(tokensLink).toHaveAttribute("href", "/admin/tokens");
  });

  it("sin nombre de usuario -> cae a 'Administrador', nunca undefined visible", () => {
    mockAuth.mockReturnValue({ user: null });
    mockOverviewQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    render(<CommandCenterHeader filters={{}} />);
    expect(screen.getByText(/Buenos días, Administrador/)).toBeInTheDocument();
  });
});
