/**
 * FourvenuesHealth.test.tsx — spec §40: estados "connected" y "error" deben
 * distinguirse visualmente, y sin integraciones muestra un estado vacío
 * honesto (nunca una tabla en blanco).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const { mockFourvenuesQuery } = vi.hoisted(() => ({ mockFourvenuesQuery: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: { dashboard: { getFourvenuesHealth: { useQuery: mockFourvenuesQuery } } } }));

import { FourvenuesHealth } from "./FourvenuesHealth";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function integration(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    integrationId: 1, venueId: 10, venueName: "Casanova", providerKey: "fourvenues", environment: "production",
    enabled: true, status: "connected", syncEnabled: true, loyaltyEnabled: false, credentialsConfigured: true,
    scheduler: null, recentRuns: [],
    ...overrides,
  };
}

describe("FourvenuesHealth", () => {
  it("integración 'connected' -> badge en tono positivo, nombre real del venue", () => {
    mockFourvenuesQuery.mockReturnValue({ data: { integrations: [integration()], overallStatus: "all_healthy" }, isLoading: false, error: null });
    render(<FourvenuesHealth />);
    expect(screen.getByText("Casanova")).toBeInTheDocument();
    expect(screen.getByText("connected")).toBeInTheDocument();
  });

  it("integración 'error' -> se distingue visualmente de 'connected' (tono distinto)", () => {
    mockFourvenuesQuery.mockReturnValue({
      data: { integrations: [integration({ venueId: 11, venueName: "Tía Felisa", status: "error" })], overallStatus: "error" },
      isLoading: false, error: null,
    });
    render(<FourvenuesHealth />);
    const badge = screen.getByText("error");
    expect(badge.className).toContain("rose"); // tono "bad"
  });

  it("sin integraciones configuradas -> estado vacío honesto, nunca una tabla en blanco", () => {
    mockFourvenuesQuery.mockReturnValue({ data: { integrations: [], overallStatus: "none_configured" }, isLoading: false, error: null });
    render(<FourvenuesHealth />);
    expect(screen.getByText(/Sin integraciones configuradas/)).toBeInTheDocument();
  });

  it("fallo de red real -> mensaje de error explícito, nunca un estado vacío disfrazado de éxito", () => {
    mockFourvenuesQuery.mockReturnValue({ data: undefined, isLoading: false, error: { message: "timeout" } });
    render(<FourvenuesHealth />);
    expect(screen.getByText(/No se pudo cargar Fourvenues Health/)).toBeInTheDocument();
  });
});
