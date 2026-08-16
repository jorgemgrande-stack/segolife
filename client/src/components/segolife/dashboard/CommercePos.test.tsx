/**
 * CommercePos.test.tsx — Fase 14. SegoTokens nunca se mezcla con el bruto
 * (spec §16/§52), estados vacíos honestos, sin ventas ≠ error.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const { mockProductsQuery, mockPaymentMixQuery } = vi.hoisted(() => ({
  mockProductsQuery: vi.fn(),
  mockPaymentMixQuery: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: { dashboard: { getPosProducts: { useQuery: mockProductsQuery }, getPaymentMix: { useQuery: mockPaymentMixQuery } } },
}));

import { CommercePos } from "./CommercePos";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("CommercePos — POS productos", () => {
  it("sin ventas de POS en el rango -> estado vacío honesto, no error", () => {
    mockProductsQuery.mockReturnValue({ data: [], isLoading: false, error: null });
    mockPaymentMixQuery.mockReturnValue({ data: { rows: [], segoTokensPromotionalValueCents: 0 }, isLoading: false, error: null });
    render(<CommercePos filters={{}} />);
    expect(screen.getByText(/Sin ventas de POS en este rango/)).toBeInTheDocument();
  });

  it("con productos reales, muestra nombre, venue y unidades vendidas", () => {
    mockProductsQuery.mockReturnValue({
      data: [{ venueProductId: 1, productName: "Jack Daniel's", venueId: 7, venueName: "Tía Felisa", unitsSold: 12, grossSalesCents: 12000 }],
      isLoading: false, error: null,
    });
    mockPaymentMixQuery.mockReturnValue({ data: { rows: [], segoTokensPromotionalValueCents: 0 }, isLoading: false, error: null });
    render(<CommercePos filters={{}} />);
    expect(screen.getByText(/Jack Daniel's · Tía Felisa/)).toBeInTheDocument();
  });
});

describe("CommercePos — mezcla de pago", () => {
  it("SegoTokens se muestra SIEMPRE aparte, etiquetado 'no es ingreso' — nunca sumado al bruto", () => {
    mockProductsQuery.mockReturnValue({ data: [], isLoading: false, error: null });
    mockPaymentMixQuery.mockReturnValue({
      data: { rows: [{ paymentMethod: "cash", transactionCount: 5, grossSalesCents: 5000 }], segoTokensPromotionalValueCents: 1200 },
      isLoading: false, error: null,
    });
    render(<CommercePos filters={{}} />);
    expect(screen.getByText(/no es ingreso/)).toBeInTheDocument();
  });

  it("sin transacciones -> estado vacío honesto", () => {
    mockProductsQuery.mockReturnValue({ data: [], isLoading: false, error: null });
    mockPaymentMixQuery.mockReturnValue({ data: { rows: [], segoTokensPromotionalValueCents: 0 }, isLoading: false, error: null });
    render(<CommercePos filters={{}} />);
    expect(screen.getByText(/Sin transacciones en este rango/)).toBeInTheDocument();
  });

  it("literales de payment_method reales nunca se colapsan — cash/card/mixed_cash/mixed_card se muestran por separado", () => {
    mockProductsQuery.mockReturnValue({ data: [], isLoading: false, error: null });
    mockPaymentMixQuery.mockReturnValue({
      data: {
        rows: [
          { paymentMethod: "cash", transactionCount: 3, grossSalesCents: 3000 },
          { paymentMethod: "mixed_card", transactionCount: 1, grossSalesCents: 1000 },
        ],
        segoTokensPromotionalValueCents: 0,
      },
      isLoading: false, error: null,
    });
    render(<CommercePos filters={{}} />);
    expect(screen.getByText("Efectivo")).toBeInTheDocument();
    expect(screen.getByText("Mixto (tarjeta)")).toBeInTheDocument();
  });

  it("error de red -> mensaje real, no un estado vacío engañoso", () => {
    mockProductsQuery.mockReturnValue({ data: undefined, isLoading: false, error: { message: "Network error" } });
    mockPaymentMixQuery.mockReturnValue({ data: { rows: [], segoTokensPromotionalValueCents: 0 }, isLoading: false, error: null });
    render(<CommercePos filters={{}} />);
    expect(screen.getByText(/No se pudo cargar POS/)).toBeInTheDocument();
  });
});
