/**
 * ConversionFunnels.test.tsx — Fase 14, spec §14/§40.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const { mockFunnelsQuery } = vi.hoisted(() => ({ mockFunnelsQuery: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: { dashboard: { getFunnels: { useQuery: mockFunnelsQuery } } } }));

import { ConversionFunnels } from "./ConversionFunnels";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const EMPTY = { stages: [{ key: "a", label: "A", count: 0 }, { key: "b", label: "B", count: 0 }], note: "" };

describe("ConversionFunnels", () => {
  it("con actividad real, muestra las etapas de los 3 funnels con sus conteos reales", () => {
    mockFunnelsQuery.mockReturnValue({
      data: {
        event: { stages: [{ key: "orders_paid", label: "Pedidos pagados", count: 42 }, { key: "tickets_issued", label: "Entradas emitidas", count: 55 }, { key: "attendance", label: "Asistencias confirmadas", count: 38 }], note: "" },
        referral: EMPTY,
        benefit: EMPTY,
      },
      isLoading: false, error: null,
    });
    render(<ConversionFunnels filters={{}} />);
    expect(screen.getByText("Pedidos pagados")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("cada funnel sin actividad muestra su propio estado vacío honesto, independiente de los otros", () => {
    mockFunnelsQuery.mockReturnValue({
      data: { event: EMPTY, referral: EMPTY, benefit: EMPTY },
      isLoading: false, error: null,
    });
    render(<ConversionFunnels filters={{}} />);
    expect(screen.getByText(/Sin actividad de eventos en este rango/)).toBeInTheDocument();
    expect(screen.getByText(/Sin referidos en este rango/)).toBeInTheDocument();
    expect(screen.getByText(/Sin Benefits en este rango/)).toBeInTheDocument();
  });

  it("error de red -> mensaje real, no una tabla en blanco", () => {
    mockFunnelsQuery.mockReturnValue({ data: undefined, isLoading: false, error: { message: "Network error" } });
    render(<ConversionFunnels filters={{}} />);
    expect(screen.getByText(/No se pudieron cargar los funnels/)).toBeInTheDocument();
  });
});
