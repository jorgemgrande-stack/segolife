import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Route } from "wouter";
import "@/lib/i18n";

/**
 * TicketDetail.test.tsx — MG-02 §11 "Confirmación de compra": el badge de
 * SegoTokens en esta pantalla NUNCA es un preview — o ya hay un HECHO real
 * en el ledger (tokens.myRewardForOrder → "earnedConfirmed") o, si el
 * ticket sigue "issued" y todavía no hay check-in, se explica la
 * recompensa condicional de asistencia como pendiente ("pendingCheckin",
 * misma fuente que EventDetail.tsx: tokens.previewMyEventReward). Nunca
 * los dos a la vez, y nunca ninguno si no hay nada real que mostrar.
 */
const {
  mockAuthMe,
  mockHomeSummary,
  mockStudentsMe,
  mockUseCommunity,
  mockTicketById,
  mockRewardForOrder,
  mockPreviewEventReward,
  noopQuery,
} = vi.hoisted(() => ({
  mockAuthMe: vi.fn(),
  mockHomeSummary: vi.fn(),
  mockStudentsMe: vi.fn(),
  mockUseCommunity: vi.fn(),
  mockTicketById: vi.fn(),
  mockRewardForOrder: vi.fn(),
  mockPreviewEventReward: vi.fn(),
  noopQuery: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      me: { useQuery: mockAuthMe },
      logout: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    home: { getSummary: { useQuery: mockHomeSummary } },
    students: { me: { useQuery: mockStudentsMe } },
    studentNotifications: { unreadCount: { useQuery: noopQuery } },
    communities: { myMemberships: { useQuery: noopQuery } },
    config: { getPublicSettings: { useQuery: noopQuery } },
    ticketPurchase: {
      myTicketById: { useQuery: mockTicketById },
      myIdentityToken: { useQuery: noopQuery },
      rotateMyIdentityToken: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    tokens: {
      myRewardForOrder: { useQuery: mockRewardForOrder },
      previewMyEventReward: { useQuery: mockPreviewEventReward },
    },
    useUtils: () => ({ auth: { me: { setData: vi.fn() } } }),
  },
}));

vi.mock("@/contexts/CommunityContext", () => ({
  useCommunity: mockUseCommunity,
}));

import TicketDetail from "./TicketDetail";

function mockAuthenticated() {
  mockAuthMe.mockReturnValue({ data: { id: 42, name: "Ana", email: "ana@ie.edu" }, isLoading: false });
}

function mockCommunity() {
  mockUseCommunity.mockReturnValue({
    community: { id: 1, slug: "ie", name: "Segolife IE", status: "active", defaultLocale: "en", availableLocales: ["en"] },
    slug: "ie",
    defaultLocale: "en",
    availableLocales: ["en"],
    loading: false,
    error: null,
  });
}

function baseTicket(overrides: Partial<{ status: string; orderId: number; qrToken: string | null }> = {}) {
  return {
    id: 501,
    status: overrides.status ?? "issued",
    issuedAt: new Date(),
    orderId: overrides.orderId ?? 900,
    qrToken: overrides.qrToken !== undefined ? overrides.qrToken : "qr-token-abc",
    event: { id: 7, name: "QA IE Party", slug: "qa-ie-party", startsAt: new Date(Date.now() + 3600_000), imageUrl: null },
  };
}

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(
    <Route path="/:community/tickets/:id">
      <TicketDetail />
    </Route>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticated();
  mockCommunity();
  mockHomeSummary.mockReturnValue({ data: undefined, isLoading: false });
  mockStudentsMe.mockReturnValue({ data: undefined });
  mockRewardForOrder.mockReturnValue({ data: undefined, isLoading: false });
  mockPreviewEventReward.mockReturnValue({ data: undefined, isLoading: false });
});

afterEach(cleanup);

describe("TicketDetail — confirmación de compra, badge de SegoTokens (MG-02)", () => {
  it("ticket no encontrado: estado vacío, nunca un badge de recompensa", () => {
    mockTicketById.mockReturnValue({ data: undefined, isLoading: false });
    renderAt("/ie/tickets/501");
    expect(screen.getByText(/not found|no encontrad/i)).toBeInTheDocument();
  });

  it("recompensa ya concedida de verdad (myRewardForOrder.granted): muestra el HECHO consumado, no un preview", () => {
    mockTicketById.mockReturnValue({ data: baseTicket(), isLoading: false });
    mockRewardForOrder.mockReturnValue({ data: { granted: true, amount: 15 }, isLoading: false });
    mockPreviewEventReward.mockReturnValue({
      data: { conditionalRewards: [{ eligible: true, totalTokens: 8 }] },
      isLoading: false,
    });
    renderAt("/ie/tickets/501");
    expect(screen.getByText(/you earned \+15 segotokens with this ticket|has ganado \+15 segotokens con esta entrada/i)).toBeInTheDocument();
    // Nunca ambos badges a la vez — el HECHO real desplaza siempre al preview condicional.
    expect(screen.queryByText(/you'll earn|ganarás/i)).not.toBeInTheDocument();
  });

  it("ticket 'issued' sin recompensa concedida todavía, con asistencia condicional elegible: muestra el pendiente de check-in", () => {
    mockTicketById.mockReturnValue({ data: baseTicket({ status: "issued" }), isLoading: false });
    mockRewardForOrder.mockReturnValue({ data: { granted: false, amount: null }, isLoading: false });
    mockPreviewEventReward.mockReturnValue({
      data: { conditionalRewards: [{ eligible: true, totalTokens: 8 }] },
      isLoading: false,
    });
    renderAt("/ie/tickets/501");
    expect(screen.getByText(/you'll earn \+8 segotokens when you check in|ganarás \+8 segotokens al hacer check-in/i)).toBeInTheDocument();
    expect(mockPreviewEventReward).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: true }));
  });

  it("ticket ya 'used' sin recompensa concedida: nunca ofrece el preview condicional (la ventana de check-in ya pasó)", () => {
    mockTicketById.mockReturnValue({ data: baseTicket({ status: "used", qrToken: null }), isLoading: false });
    mockRewardForOrder.mockReturnValue({ data: { granted: false, amount: null }, isLoading: false });
    renderAt("/ie/tickets/501");
    expect(mockPreviewEventReward).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
    expect(screen.queryByText(/you earned|has ganado/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/you'll earn|ganarás/i)).not.toBeInTheDocument();
  });

  it("sin recompensa real ni condicional elegible: ningún badge (recompensa cero nunca se pinta, spec 'never show +0 ST')", () => {
    mockTicketById.mockReturnValue({ data: baseTicket({ status: "issued" }), isLoading: false });
    mockRewardForOrder.mockReturnValue({ data: { granted: false, amount: null }, isLoading: false });
    mockPreviewEventReward.mockReturnValue({ data: { conditionalRewards: [] }, isLoading: false });
    renderAt("/ie/tickets/501");
    expect(screen.queryByText(/you earned|has ganado/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/you'll earn|ganarás/i)).not.toBeInTheDocument();
  });

  it("pide myRewardForOrder con el orderId real del ticket (nunca el id del ticket)", () => {
    mockTicketById.mockReturnValue({ data: baseTicket({ orderId: 777 }), isLoading: false });
    renderAt("/ie/tickets/501");
    expect(mockRewardForOrder).toHaveBeenCalledWith({ orderId: 777 }, expect.objectContaining({ enabled: true }));
  });
});
