import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Route } from "wouter";
import "@/lib/i18n";

/**
 * Explore.test.tsx — FIX-05A. Primer test de esta página. Cubre
 * específicamente el nuevo filtro "Ended Events": que usa una fuente de
 * datos DISTINTA (publicEnded, nunca publicActive filtrado en cliente —
 * publicActive nunca devuelve eventos pasados en absoluto), que nunca
 * muestra reward preview, que "All" sigue sin mezclarse con histórico, y
 * el estado vacío/las cards/el orden ya devuelto por el backend.
 */
const {
  mockActiveQuery, mockEndedQuery, mockVenuesQuery, mockRewardBatch, mockAuthMe, noopQuery,
} = vi.hoisted(() => ({
  mockActiveQuery: vi.fn(),
  mockEndedQuery: vi.fn(),
  mockVenuesQuery: vi.fn(),
  mockRewardBatch: vi.fn(),
  mockAuthMe: vi.fn(),
  noopQuery: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    events: { publicActive: { useQuery: mockActiveQuery }, publicEnded: { useQuery: mockEndedQuery } },
    venues: { publicActive: { useQuery: mockVenuesQuery } },
    tokens: { previewMyEventRewardBatch: { useQuery: mockRewardBatch } },
    communities: { list: { useQuery: noopQuery }, myMemberships: { useQuery: noopQuery } },
    home: { getSummary: { useQuery: noopQuery } },
    studentNotifications: { unreadCount: { useQuery: noopQuery } },
    students: { me: { useQuery: noopQuery } },
    config: { getPublicSettings: { useQuery: noopQuery } },
    auth: {
      me: { useQuery: mockAuthMe },
      logout: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    useUtils: () => ({ auth: { me: { setData: vi.fn() } } }),
  },
}));

vi.mock("@/contexts/CommunityContext", () => ({
  useCommunity: () => ({
    community: { id: 1, slug: "ie", name: "Segolife IE" },
    slug: "ie",
    defaultLocale: "en",
    availableLocales: ["en", "es"],
    loading: false,
    error: null,
  }),
}));

import Explore from "./Explore";

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, name: "WHITE PARTY", slug: "white-party", description: null, venueId: 1,
    startsAt: new Date("2026-09-15T20:00:00Z"), endsAt: null, capacity: null, imageUrl: null,
    status: "active" as const, isFeatured: false, venue: { id: 1, name: "Casanova", slug: "casanova" },
    communities: [], primarySalesChannel: null,
    ...overrides,
  };
}

function mockActive(events: unknown[]) {
  mockActiveQuery.mockReturnValue({ data: events, isLoading: false, isError: false, refetch: vi.fn() });
}
function mockEnded(events: unknown[]) {
  mockEndedQuery.mockReturnValue({ data: events, isLoading: false, isError: false, refetch: vi.fn() });
}

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(
    <Route path="/:community/explore">
      <Explore />
    </Route>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthMe.mockReturnValue({ data: null, isLoading: false });
  mockActive([]);
  mockEnded([]);
  mockVenuesQuery.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
  mockRewardBatch.mockReturnValue({ data: undefined, isLoading: false });
});

afterEach(cleanup);

// jsdom en este entorno resuelve el idioma por defecto a español (quirk ya
// conocido de esta suite, ver Profile.test.tsx) — toda aserción de texto
// UI va en regex bilingüe, nunca asumiendo inglés.
const ENDED_CHIP = /ended events|eventos finalizados/i;

describe("Explore — filtro Ended Events (FIX-05A)", () => {
  it("el chip 'Ended Events' está presente junto a Today/Tomorrow/This week/All", () => {
    renderAt("/ie/explore");
    expect(screen.getByText(ENDED_CHIP)).toBeInTheDocument();
    expect(screen.getByText(/^today$|^hoy$/i)).toBeInTheDocument();
    expect(screen.getByText(/^all$|^todos$/i)).toBeInTheDocument();
  });

  it("al seleccionar Ended Events, consulta publicEnded con el communityId real — nunca filtra publicActive en cliente", () => {
    mockEnded([baseEvent({ id: 10, name: "FINALIZADO YA" })]);
    renderAt("/ie/explore");
    fireEvent.click(screen.getByText(ENDED_CHIP));
    expect(mockEndedQuery).toHaveBeenCalledWith({ communityId: 1, limit: 24 }, expect.objectContaining({ enabled: true }));
    expect(screen.getByText("FINALIZADO YA")).toBeInTheDocument();
  });

  it("Ended Events vacío muestra el estado vacío ya existente (reutilizado, sin string nuevo hardcodeado)", () => {
    mockEnded([]);
    renderAt("/ie/explore");
    fireEvent.click(screen.getByText(ENDED_CHIP));
    expect(screen.getByText(/no events found|no se han encontrado eventos/i)).toBeInTheDocument();
  });

  it("un evento en Ended Events NUNCA muestra badge de recompensa, aunque el lote tuviera datos cacheados para ese id", () => {
    mockEnded([baseEvent({ id: 20, name: "EVENTO PASADO" })]);
    mockRewardBatch.mockReturnValue({ data: { "20": { conditionalRewards: [{ eligible: true, totalTokens: 50 }], totalGuaranteedTokens: 0 } }, isLoading: false });
    renderAt("/ie/explore");
    fireEvent.click(screen.getByText(ENDED_CHIP));
    expect(screen.queryByText(/\+?\s*50/)).not.toBeInTheDocument();
  });

  it("respeta el orden ya devuelto por el backend (DESC, más reciente primero) — nunca reordena en cliente", () => {
    mockEnded([baseEvent({ id: 30, name: "MAS RECIENTE" }), baseEvent({ id: 31, name: "MAS ANTIGUO" })]);
    renderAt("/ie/explore");
    fireEvent.click(screen.getByText(ENDED_CHIP));
    const names = screen.getAllByText(/MAS (RECIENTE|ANTIGUO)/).map(el => el.textContent);
    expect(names).toEqual(["MAS RECIENTE", "MAS ANTIGUO"]);
  });

  it("'All' sigue consumiendo solo publicActive — nunca se mezcla con Ended aunque ambas queries tengan datos", () => {
    mockActive([baseEvent({ id: 40, name: "EVENTO ACTIVO" })]);
    mockEnded([baseEvent({ id: 41, name: "EVENTO FINALIZADO" })]);
    renderAt("/ie/explore");
    // "all" es el filtro por defecto — Ended Events nunca se pidió, no debería llamarse habilitada.
    expect(mockEndedQuery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
    expect(screen.getByText("EVENTO ACTIVO")).toBeInTheDocument();
    expect(screen.queryByText("EVENTO FINALIZADO")).not.toBeInTheDocument();
  });
});
