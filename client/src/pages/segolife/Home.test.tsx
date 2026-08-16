import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Route } from "wouter";
import "@/lib/i18n";

/**
 * Home.test.tsx — Fase 15 (remate público): esta ruta (/:community) exigía
 * sesión SIEMPRE, así que un visitante anónimo en /ie o /uva rebotaba a
 * /login sin ver nada de su comunidad — el gap concreto que este remate
 * corrige. Cubre el despacho real: anónimo -> landing pública de la
 * comunidad (CommunityLanding), con sesión -> dashboard personalizado de
 * siempre (AuthenticatedHome), nunca los dos a la vez ni una tercera
 * aplicación aparte.
 */
const {
  mockAuthMe,
  mockHomeSummary,
  mockWalletValue,
  mockStudentsMe,
  mockEventsPublicActive,
  mockVenuesPublicActive,
  mockRewardBatch,
  mockTrack,
  noopQuery,
} = vi.hoisted(() => ({
  mockAuthMe: vi.fn(),
  mockHomeSummary: vi.fn(),
  mockWalletValue: vi.fn(),
  mockStudentsMe: vi.fn(),
  mockEventsPublicActive: vi.fn(),
  mockVenuesPublicActive: vi.fn(),
  mockRewardBatch: vi.fn(),
  mockTrack: vi.fn(),
  noopQuery: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      me: { useQuery: mockAuthMe },
      logout: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    home: { getSummary: { useQuery: mockHomeSummary } },
    tokens: {
      myWalletPromotionalValue: { useQuery: mockWalletValue },
      previewMyEventRewardBatch: { useQuery: mockRewardBatch },
    },
    students: { me: { useQuery: mockStudentsMe } },
    events: { publicActive: { useQuery: mockEventsPublicActive } },
    venues: { publicActive: { useQuery: mockVenuesPublicActive } },
    studentAnalytics: { track: { useMutation: () => ({ mutate: mockTrack }) } },
    studentNotifications: { unreadCount: { useQuery: noopQuery } },
    communities: { list: { useQuery: noopQuery }, myMemberships: { useQuery: noopQuery } },
    config: { getPublicSettings: { useQuery: noopQuery } },
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

import Home from "./Home";

function mockAnonymous() {
  mockAuthMe.mockReturnValue({ data: null, isLoading: false });
}

function mockAuthenticated() {
  mockAuthMe.mockReturnValue({
    data: { id: 42, name: "Ana", email: "ana@ie.edu" },
    isLoading: false,
  });
}

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(
    <Route path="/:community">
      <Home />
    </Route>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHomeSummary.mockReturnValue({ data: { ranking: { forYou: [], hero: null }, tonightEvents: [], featuredEvents: [], recentActivity: [], walletBalance: 0 }, isLoading: false });
  mockWalletValue.mockReturnValue({ data: undefined });
  mockStudentsMe.mockReturnValue({ data: undefined });
  mockEventsPublicActive.mockReturnValue({ data: [], isLoading: false });
  mockVenuesPublicActive.mockReturnValue({ data: [], isLoading: false });
  mockRewardBatch.mockReturnValue({ data: undefined });
});

afterEach(cleanup);

describe("Home (/:community) — visitante anónimo ve la landing pública, nunca el dashboard personal", () => {
  it("muestra el nombre real de la comunidad y NUNCA el wallet/saludo personalizado", () => {
    mockAnonymous();
    renderAt("/ie");
    expect(screen.getByRole("heading", { name: "Segolife IE" })).toBeInTheDocument();
    expect(screen.queryByText(/segotokens/i)).not.toBeInTheDocument();
  });

  it("el CTA de unirse construye /register?community=<slug> — preselección server-validated (spec remate Fase 15)", () => {
    mockAnonymous();
    renderAt("/ie");
    const joinCta = screen.getByText(/join segolife|únete a segolife/i).closest("a");
    expect(joinCta).toHaveAttribute("href", "/register?community=ie");
  });

  it("el CTA de iniciar sesión preserva la comunidad como ruta de vuelta", () => {
    mockAnonymous();
    renderAt("/ie");
    const loginCta = screen.getByText(/i have an account|ya tengo cuenta/i).closest("a");
    expect(loginCta).toHaveAttribute("href", `/login?returnTo=${encodeURIComponent("/ie")}`);
  });

  it("pide eventos y locales filtrados por la comunidad real de la URL (nunca sin filtrar, nunca otra comunidad)", () => {
    mockAnonymous();
    renderAt("/ie");
    expect(mockEventsPublicActive).toHaveBeenCalledWith({ communityId: 1 });
    expect(mockVenuesPublicActive).toHaveBeenCalledWith({ communityId: 1 });
  });

  it("sin eventos/locales reales todavía: estados vacíos editoriales, nunca un placeholder inventado", () => {
    mockAnonymous();
    renderAt("/ie");
    expect(screen.getByText(/no events published for this community yet|todavía no hay eventos publicados/i)).toBeInTheDocument();
    expect(screen.getByText(/no venues published for this community yet|todavía no hay venues publicados/i)).toBeInTheDocument();
  });

  it("con eventos reales: se pintan como cards de evento (mismo componente que Explore/Home autenticada)", () => {
    mockAnonymous();
    mockEventsPublicActive.mockReturnValue({
      data: [{ id: 1, slug: "qa-ie-party", name: "QA IE Party", imageUrl: null, startsAt: new Date(Date.now() + 86400000), isFeatured: false, venue: { name: "Casanova" } }],
      isLoading: false,
    });
    renderAt("/ie");
    const link = screen.getByText("QA IE Party").closest("a");
    expect(link).toHaveAttribute("href", "/ie/events/qa-ie-party");
  });
});

describe("Home (/:community) — estudiante autenticado ve su dashboard personal, nunca la landing de invitado", () => {
  it("muestra el saludo y el wallet personal, no el hero de 'Únete'", () => {
    mockAuthenticated();
    renderAt("/ie");
    expect(screen.getByText("SegoTokens")).toBeInTheDocument();
    expect(screen.queryByText(/join segolife|únete a segolife/i)).not.toBeInTheDocument();
  });

  it("consulta home.getSummary con la comunidad real de la URL (Fase 15, spec §11/§13)", () => {
    mockAuthenticated();
    renderAt("/ie");
    expect(mockHomeSummary).toHaveBeenCalledWith({ communityId: 1 }, expect.anything());
  });
});
