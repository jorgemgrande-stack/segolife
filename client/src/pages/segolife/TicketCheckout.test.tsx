import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route } from "wouter";
import i18n from "@/lib/i18n";

/**
 * TicketCheckout.test.tsx — F70 (PaymentProvider real). Cubre solo el
 * comportamiento NUEVO: redirección a checkout hospedado cuando
 * initiatePayment() devuelve redirectUrl, y el estado distinto
 * "esperando confirmación" para awaiting_payment (antes se confundía con
 * "pending" y volvía a ofrecer el botón de pagar sobre un pago ya en
 * curso). El resto de TicketCheckout.tsx (cotización de SegoTokens,
 * cancelación, etc.) es pre-existente y no se re-testea aquí.
 */

const {
  mockAuthMe, mockUseCommunity, mockMyOrderById, mockGetMyWallet,
  mockQuoteTokenSpend, mockPreviewMyReward, mockInitiatePayment, mockCancelMyOrder,
  noopQuery,
} = vi.hoisted(() => ({
  mockAuthMe: vi.fn(),
  mockUseCommunity: vi.fn(),
  mockMyOrderById: vi.fn(),
  mockGetMyWallet: vi.fn(),
  mockQuoteTokenSpend: vi.fn(),
  mockPreviewMyReward: vi.fn(),
  mockInitiatePayment: vi.fn(),
  mockCancelMyOrder: vi.fn(),
  noopQuery: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: { me: { useQuery: mockAuthMe }, logout: { useMutation: () => ({ mutate: vi.fn() }) } },
    home: { getSummary: { useQuery: noopQuery } },
    students: { me: { useQuery: noopQuery } },
    studentNotifications: { unreadCount: { useQuery: noopQuery } },
    communities: { list: { useQuery: noopQuery }, myMemberships: { useQuery: noopQuery } },
    config: { getPublicSettings: { useQuery: noopQuery } },
    tokens: {
      getMyWallet: { useQuery: mockGetMyWallet },
      myQuoteTokenSpend: { useQuery: mockQuoteTokenSpend },
      previewMyReward: { useQuery: mockPreviewMyReward },
    },
    ticketPurchase: {
      myOrderById: { useQuery: mockMyOrderById },
      initiatePayment: { useMutation: mockInitiatePayment },
      cancelMyOrder: { useMutation: mockCancelMyOrder },
    },
    useUtils: () => ({ ticketPurchase: { myOrders: { invalidate: vi.fn() } } }),
  },
}));

vi.mock("@/contexts/CommunityContext", () => ({ useCommunity: mockUseCommunity }));

import TicketCheckout from "./TicketCheckout";

function mockAuthenticated() {
  mockAuthMe.mockReturnValue({ data: { id: 42, name: "Ana", email: "ana@ie.edu" }, isLoading: false });
}
function mockCommunity() {
  mockUseCommunity.mockReturnValue({
    community: { id: 1, slug: "ie", name: "Segolife IE", status: "active", defaultLocale: "en", availableLocales: ["en"] },
    slug: "ie", defaultLocale: "en", availableLocales: ["en"], loading: false, error: null,
  });
}

function orderFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    order: { id: 7, status: "pending", currency: "EUR", totalCents: 1000, eventId: 1, ...overrides },
    items: [{ id: 1, ticketTypeName: "General", quantity: 1, totalPriceCents: 1000 }],
    venueId: null,
  };
}

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(
    <Route path="/:community/checkout/:orderId">
      <TicketCheckout />
    </Route>
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
  mockAuthenticated();
  mockCommunity();
  mockGetMyWallet.mockReturnValue({ data: { balance: 0 } });
  mockQuoteTokenSpend.mockReturnValue({ data: undefined });
  mockPreviewMyReward.mockReturnValue({ data: { totalGuaranteedTokens: 0 } });
  mockCancelMyOrder.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

afterEach(() => {
  cleanup();
  i18n.changeLanguage("en");
});

/**
 * jsdom no permite reasignar window.location.href directamente sin este
 * truco — patrón estándar para probar redirecciones externas. Se aplica
 * SOLO dentro del test que lo necesita (nunca en beforeEach/afterEach del
 * archivo): reemplazar window.location de forma global rompe el pathname
 * que wouter necesita leer para hacer match de <Route> en el resto de
 * tests — hallazgo real durante la propia escritura de este archivo.
 */
function withMockedLocationHref(run: () => void | Promise<void>): Promise<void> {
  const original = window.location;
  Object.defineProperty(window, "location", { value: { ...original, href: "" }, writable: true, configurable: true });
  return Promise.resolve(run()).finally(() => {
    Object.defineProperty(window, "location", { value: original, writable: true, configurable: true });
  });
}

describe("TicketCheckout — F70: redirección a checkout hospedado", () => {
  it("paymentStatus succeeded navega dentro de la app a /tickets (wouter), nunca sale a una URL externa", async () => {
    mockMyOrderById.mockReturnValue({ data: orderFixture(), isLoading: false, refetch: vi.fn() });
    mockInitiatePayment.mockImplementation(({ onSuccess }: { onSuccess: (r: unknown) => void }) => ({
      mutate: () => onSuccess({ paymentStatus: "succeeded" }),
      isPending: false,
    }));

    renderAt("/ie/checkout/7");
    await userEvent.click(await screen.findByRole("button", { name: /pay/i }));

    expect(window.location.pathname).toBe("/ie/tickets");
  });

  it("paymentStatus pending con redirectUrl SIEMPRE navega el navegador a esa URL externa (checkout hospedado)", async () => {
    mockMyOrderById.mockReturnValue({ data: orderFixture(), isLoading: false, refetch: vi.fn() });
    mockInitiatePayment.mockImplementation(({ onSuccess }: { onSuccess: (r: unknown) => void }) => ({
      mutate: () => onSuccess({ paymentStatus: "pending", redirectUrl: "https://provider.example/pay/abc123" }),
      isPending: false,
    }));

    renderAt("/ie/checkout/7");
    const payButton = await screen.findByRole("button", { name: /pay/i });

    await withMockedLocationHref(async () => {
      await userEvent.click(payButton);
      expect(window.location.href).toBe("https://provider.example/pay/abc123");
    });
  });

  it("paymentStatus failed nunca redirige ni navega — se queda en la página para reintentar", async () => {
    const refetch = vi.fn();
    mockMyOrderById.mockReturnValue({ data: orderFixture(), isLoading: false, refetch });
    mockInitiatePayment.mockImplementation(({ onSuccess }: { onSuccess: (r: unknown) => void }) => ({
      mutate: () => onSuccess({ paymentStatus: "failed", error: "Provider no configurado" }),
      isPending: false,
    }));

    renderAt("/ie/checkout/7");
    await userEvent.click(await screen.findByRole("button", { name: /pay/i }));

    expect(window.location.pathname).toBe("/ie/checkout/7");
    expect(refetch).toHaveBeenCalled();
  });
});

describe("TicketCheckout — F70: awaiting_payment nunca vuelve a ofrecer el botón de pagar", () => {
  it("con order.status='awaiting_payment' muestra el aviso de espera, NUNCA el botón de pago (evita un segundo intento sobre un pago ya en curso)", async () => {
    mockMyOrderById.mockReturnValue({ data: orderFixture({ status: "awaiting_payment" }), isLoading: false, refetch: vi.fn() });
    mockInitiatePayment.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderAt("/ie/checkout/7");

    expect(await screen.findByText(/waiting for payment confirmation/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pay/i })).not.toBeInTheDocument();
  });

  it("con order.status='pending' (regresión) el botón de pago sigue disponible como siempre", async () => {
    mockMyOrderById.mockReturnValue({ data: orderFixture({ status: "pending" }), isLoading: false, refetch: vi.fn() });
    mockInitiatePayment.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderAt("/ie/checkout/7");

    expect(await screen.findByRole("button", { name: /pay/i })).toBeInTheDocument();
    expect(screen.queryByText(/waiting for payment confirmation/i)).not.toBeInTheDocument();
  });
});
