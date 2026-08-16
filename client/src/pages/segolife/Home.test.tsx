import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Route } from "wouter";
import "@/lib/i18n";

/**
 * Home.test.tsx — Fase 15.1 (corrección de un bug real reportado con
 * capturas): la versión anterior de la landing pública anónima (Fase 15
 * "remate") se pintaba DENTRO de SegolifeAppShell — el mismo shell de la
 * Student App autenticada — así que un visitante anónimo en /ie o /uva veía
 * el sidebar/bottom-nav de Home/Explore/Comunity/Tickets/Scan/Rewards/
 * Perfil y los iconos de campana/perfil, como si ya hubiera iniciado
 * sesión. Ahora Home() decide ANTES de montar cualquier shell: anónimo ->
 * CommunityPublicLanding (nunca importa SegolifeAppShell, usa el sistema
 * visual público — PublicHomeNav/Footer, nunca la Student App); con sesión
 * -> AuthenticatedHome dentro de SegolifeAppShell, sin cambios.
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
  mockUseCommunity,
  mockPendingPaymentRequests,
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
  mockUseCommunity: vi.fn(),
  mockPendingPaymentRequests: vi.fn(),
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
    tokenPaymentRequests: { myPending: { useQuery: mockPendingPaymentRequests } },
    studentAnalytics: { track: { useMutation: () => ({ mutate: mockTrack }) } },
    studentNotifications: { unreadCount: { useQuery: noopQuery } },
    communities: { list: { useQuery: noopQuery }, myMemberships: { useQuery: noopQuery } },
    config: { getPublicSettings: { useQuery: noopQuery } },
    gallery: { getItems: { useQuery: noopQuery } },
    useUtils: () => ({ auth: { me: { setData: vi.fn() } } }),
  },
}));

vi.mock("@/contexts/CommunityContext", () => ({
  useCommunity: mockUseCommunity,
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

/** El contexto de comunidad se parametriza (nunca hardcodeado): permite probar IE Y UVA con el mismo despachador genérico. */
function mockCommunity(overrides: { id: number; slug: string; name: string; defaultLocale?: string }) {
  mockUseCommunity.mockReturnValue({
    community: { id: overrides.id, slug: overrides.slug, name: overrides.name, status: "active", defaultLocale: overrides.defaultLocale ?? "en", availableLocales: ["en", "es"] },
    slug: overrides.slug,
    defaultLocale: overrides.defaultLocale ?? "en",
    availableLocales: ["en", "es"],
    loading: false,
    error: null,
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

/** El texto de los CTAs de unirse/login se repite (nav pública + hero) — busca el enlace real por su href, no por posición. */
function findLinkWithHref(textPattern: RegExp, href: string) {
  return screen.getAllByText(textPattern)
    .map(el => el.closest("a"))
    .find(a => a?.getAttribute("href") === href);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCommunity({ id: 1, slug: "ie", name: "Segolife IE", defaultLocale: "en" });
  mockHomeSummary.mockReturnValue({ data: { ranking: { forYou: [], hero: null }, tonightEvents: [], featuredEvents: [], recentActivity: [], walletBalance: 0 }, isLoading: false });
  mockWalletValue.mockReturnValue({ data: undefined });
  mockStudentsMe.mockReturnValue({ data: undefined });
  mockEventsPublicActive.mockReturnValue({ data: [], isLoading: false });
  mockVenuesPublicActive.mockReturnValue({ data: [], isLoading: false });
  mockRewardBatch.mockReturnValue({ data: undefined });
  mockPendingPaymentRequests.mockReturnValue({ data: [], isLoading: false });
});

afterEach(cleanup);

describe("Home (/:community) — visitante anónimo ve la landing PÚBLICA, nunca la Student App", () => {
  it("muestra el nombre real de la comunidad como H1 y NUNCA el wallet personal (aunque la landing SÍ explica SegoTokens como concepto, spec §5)", () => {
    mockAnonymous();
    renderAt("/ie");
    expect(screen.getByRole("heading", { level: 1, name: "Segolife IE" })).toBeInTheDocument();
    // El wallet real (tarjeta con saldo + enlace a /rewards) nunca aparece sin
    // sesión — a diferencia de la SECCIÓN explicativa "SegoTokens" (genérica,
    // reutilizada de PublicHome.tsx), que sí es contenido público esperado.
    expect(document.querySelector('a[href="/ie/rewards"]')).not.toBeInTheDocument();
  });

  // Fase 15.1 — la regresión concreta reportada con capturas.
  it("NUNCA renderiza la navegación de la Student App (sidebar/bottom-nav autenticados)", () => {
    mockAnonymous();
    renderAt("/ie");
    // Los ítems de nav autenticados usan href exacto /ie/explore, /ie/comunity, etc.
    // dentro de <SegolifeSidebar>/<SegolifeBottomNav> — ninguno debe existir.
    expect(document.querySelector('a[href="/ie/comunity"]')).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/ie/tickets"]')).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/ie/scan"]')).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/ie/rewards"]')).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/ie/profile"]')).not.toBeInTheDocument();
  });

  it("NUNCA muestra el icono de campana de notificaciones ni el acceso rápido de perfil del shell autenticado", () => {
    mockAnonymous();
    renderAt("/ie");
    expect(screen.queryByLabelText(/notifications\.bellLabel|bell/i)).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/ie/notifications"]')).not.toBeInTheDocument();
  });

  it("el CTA de unirse construye /register?community=<slug> — preselección server-validated", () => {
    mockAnonymous();
    renderAt("/ie");
    const joinCta = findLinkWithHref(/join segolife|únete a segolife/i, "/register?community=ie");
    expect(joinCta).toBeTruthy();
  });

  it("el CTA de iniciar sesión preserva la comunidad como ruta de vuelta", () => {
    mockAnonymous();
    renderAt("/ie");
    const loginCta = findLinkWithHref(/i have an account|ya tengo cuenta/i, `/login?returnTo=${encodeURIComponent("/ie")}`);
    expect(loginCta).toBeTruthy();
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

  it("con eventos reales: se pintan como tarjetas públicas con enlace real al evento", () => {
    mockAnonymous();
    mockEventsPublicActive.mockReturnValue({
      data: [{ id: 1, slug: "qa-ie-party", name: "QA IE Party", imageUrl: null, startsAt: new Date(Date.now() + 86400000), isFeatured: false, venue: { name: "Casanova" } }],
      isLoading: false,
    });
    renderAt("/ie");
    const link = screen.getByText("QA IE Party").closest("a");
    expect(link).toHaveAttribute("href", "/ie/events/qa-ie-party");
  });

  // El mismo despachador es 100% agnóstico de comunidad (nunca "ie"/"uva"
  // literal en Home.tsx ni en CommunityPublicLanding.tsx) — estas pruebas
  // usan UVA (y una comunidad futura inventada) para demostrarlo, no solo IE.
  it("anónimo en /uva: misma landing pública, con el nombre e id REALES de UVA (nunca los de IE)", () => {
    mockAnonymous();
    mockCommunity({ id: 2, slug: "uva", name: "Segolife UVA", defaultLocale: "es" });
    renderAt("/uva");
    expect(screen.getByRole("heading", { level: 1, name: "Segolife UVA" })).toBeInTheDocument();
    expect(mockEventsPublicActive).toHaveBeenCalledWith({ communityId: 2 });
    expect(mockVenuesPublicActive).toHaveBeenCalledWith({ communityId: 2 });
  });

  it("el CTA de unirse en /uva construye /register?community=uva (nunca community=ie)", () => {
    mockAnonymous();
    mockCommunity({ id: 2, slug: "uva", name: "Segolife UVA", defaultLocale: "es" });
    renderAt("/uva");
    const joinCta = findLinkWithHref(/join segolife|únete a segolife/i, "/register?community=uva");
    expect(joinCta).toBeTruthy();
  });

  it("el login en /uva preserva /uva como ruta de vuelta (nunca /ie)", () => {
    mockAnonymous();
    mockCommunity({ id: 2, slug: "uva", name: "Segolife UVA", defaultLocale: "es" });
    renderAt("/uva");
    const loginCta = findLinkWithHref(/i have an account|ya tengo cuenta/i, `/login?returnTo=${encodeURIComponent("/uva")}`);
    expect(loginCta).toBeTruthy();
  });

  it("un evento compartido entre comunidades (misma respuesta real del endpoint scoped) se pinta igual en ambas landings, sin duplicarlo ni fabricarlo", () => {
    mockAnonymous();
    const sharedEvent = { id: 9, slug: "shared-party", name: "Shared Party", imageUrl: null, startsAt: new Date(Date.now() + 86400000), isFeatured: false, venue: { name: "Casanova" } };
    mockEventsPublicActive.mockReturnValue({ data: [sharedEvent], isLoading: false });
    renderAt("/ie");
    expect(screen.getByText("Shared Party").closest("a")).toHaveAttribute("href", "/ie/events/shared-party");
    cleanup();
    mockCommunity({ id: 2, slug: "uva", name: "Segolife UVA", defaultLocale: "es" });
    renderAt("/uva");
    expect(screen.getByText("Shared Party").closest("a")).toHaveAttribute("href", "/uva/events/shared-party");
  });

  it("una comunidad futura (ni ie ni uva) reutiliza la MISMA arquitectura pública, sin ningún id hardcodeado", () => {
    mockAnonymous();
    mockCommunity({ id: 7, slug: "usal", name: "Segolife USAL", defaultLocale: "es" });
    renderAt("/usal");
    expect(screen.getByRole("heading", { level: 1, name: "Segolife USAL" })).toBeInTheDocument();
    expect(mockEventsPublicActive).toHaveBeenCalledWith({ communityId: 7 });
  });

  it("visitar /ie o /uva sin sesión nunca dispara ninguna mutación (ninguna membresía se crea solo por navegar)", () => {
    mockAnonymous();
    renderAt("/ie");
    // El único acceso mutable expuesto al mock es studentAnalytics.track (telemetría,
    // no membresía) — no existe ningún trpc.*.useMutation de comunidad/membresía
    // en el mock de este archivo, así que si CommunityPublicLanding intentara
    // llamar a una, este test lanzaría un TypeError en el propio render().
    expect(mockTrack).not.toHaveBeenCalled();
  });
});

describe("Home (/:community) — estudiante autenticado ve su dashboard personal dentro de la Student App, nunca la landing de invitado", () => {
  it("muestra el saludo y el wallet personal, no el hero de 'Únete'", () => {
    mockAuthenticated();
    renderAt("/ie");
    expect(screen.getByText("SegoTokens")).toBeInTheDocument();
    expect(screen.queryByText(/join segolife|únete a segolife/i)).not.toBeInTheDocument();
  });

  it("SÍ muestra la navegación de la Student App (a diferencia del visitante anónimo)", () => {
    mockAuthenticated();
    renderAt("/ie");
    expect(document.querySelector('a[href="/ie/explore"]')).toBeInTheDocument();
  });

  it("consulta home.getSummary con la comunidad real de la URL (Fase 15, spec §11/§13)", () => {
    mockAuthenticated();
    renderAt("/ie");
    expect(mockHomeSummary).toHaveBeenCalledWith({ communityId: 1 }, expect.anything());
  });

  // SEGOLIFE PRE-16.1 "Presential SegoTokens Payments" — banner de solicitud
  // de pago pendiente (PendingPaymentRequestBanner). Sin solicitudes
  // pendientes, el banner nunca se pinta (mismo patrón que HistoricalClaimBanner).
  it("sin solicitudes de pago pendientes: no muestra ningún banner de pago", () => {
    mockAuthenticated();
    renderAt("/ie");
    expect(document.querySelector('a[href^="/ie/payment-requests/"]')).not.toBeInTheDocument();
  });

  it("con una solicitud de pago pendiente: muestra el banner con enlace a la pantalla de confirmación real", () => {
    mockAuthenticated();
    mockPendingPaymentRequests.mockReturnValue({
      data: [{
        request: { id: 501, status: "pending" },
        reservation: {
          id: 900, communityId: 1, venueId: 12, tokensReserved: 40,
          promotionalValueCents: 800, moneyDueCents: 1200, grossAmountCents: 2000,
          expiresAt: new Date(Date.now() + 5 * 60_000),
        },
        effectiveStatus: "pending",
      }],
      isLoading: false,
    });
    renderAt("/ie");
    const link = document.querySelector('a[href="/ie/payment-requests/501"]');
    expect(link).toBeInTheDocument();
    expect(link).toHaveTextContent("40");
  });
});
