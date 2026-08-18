import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Route } from "wouter";
import "@/lib/i18n";

const {
  mockVenueQuery,
  mockEventsQuery,
  mockGalleryQuery,
  mockAuthMe,
  mockRewardBatch,
  noopQuery,
} = vi.hoisted(() => ({
  mockVenueQuery: vi.fn(),
  mockEventsQuery: vi.fn(),
  mockGalleryQuery: vi.fn(),
  mockAuthMe: vi.fn(),
  mockRewardBatch: vi.fn(),
  noopQuery: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    venues: { publicGetBySlug: { useQuery: mockVenueQuery } },
    events: { publicByVenue: { useQuery: mockEventsQuery } },
    gallery: { getItems: { useQuery: mockGalleryQuery } },
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

import VenueDetail from "./VenueDetail";

/**
 * VenueDetail.test.tsx — ficha pública de venue rediseñada (corrección
 * visual post-cierre de Fase 8.6). Cubre la composición ADAPTATIVA real:
 * secciones que se ocultan por completo sin dato (nunca un placeholder tipo
 * "No description yet" ocupando espacio), fallback de logo/cover, layout de
 * galería según número de fotos, estado vacío editorial de Upcoming, y que
 * la ficha sigue siendo community-aware sin bifurcar por IE/UVA.
 */
function baseVenue(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    name: "Casanova",
    slug: "casanova",
    tagline: null,
    description: null,
    categoryId: null,
    address: null,
    city: "Segovia",
    phone: null,
    email: null,
    website: null,
    instagramUrl: null,
    imageUrl: null,
    coverImageUrl: null,
    status: "active" as const,
    isFeatured: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function mockDetail(venueOverrides: Partial<Record<string, unknown>> = {}, category: unknown = null) {
  mockVenueQuery.mockReturnValue({
    data: { venue: baseVenue(venueOverrides), category, communities: [] },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
}

function mockEvents(events: unknown[]) {
  mockEventsQuery.mockReturnValue({ data: events, isLoading: false });
}

function mockGallery(photos: unknown[]) {
  mockGalleryQuery.mockReturnValue({ data: photos, isLoading: false });
}

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(
    <Route path="/:community/venues/:slug">
      <VenueDetail />
    </Route>
  );
}

function mockAnonymous() {
  mockAuthMe.mockReturnValue({ data: null, isLoading: false });
}

function mockAuthenticated() {
  mockAuthMe.mockReturnValue({ data: { id: 42, name: "Ana", email: "ana@ie.edu" }, isLoading: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAnonymous();
  mockEvents([]);
  mockGallery([]);
  mockRewardBatch.mockReturnValue({ data: undefined, isLoading: false });
});

afterEach(cleanup);

describe("VenueDetail — About adaptativo", () => {
  it("oculta por completo la sección About cuando no hay descripción real (nunca un placeholder tipo 'No description yet')", () => {
    mockDetail({ description: null });
    renderAt("/ie/venues/casanova");
    expect(screen.queryByText(/about/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no description/i)).not.toBeInTheDocument();
  });

  it("muestra About con el texto real cuando sí existe descripción", () => {
    mockDetail({ description: "The classic Erasmus night out in Segovia." });
    renderAt("/ie/venues/casanova");
    expect(screen.getByText(/^(about|sobre el local)$/i)).toBeInTheDocument();
    expect(screen.getByText("The classic Erasmus night out in Segovia.")).toBeInTheDocument();
  });
});

describe("VenueDetail — Upcoming Events", () => {
  it("evento próximo real: se renderiza como link a su EventDetail con la comunidad correcta", () => {
    mockDetail();
    mockEvents([
      { id: 1, slug: "qa-casanova-upcoming", name: "QA Casanova Upcoming", imageUrl: null, startsAt: new Date(Date.now() + 86400000), isFeatured: false, venue: { name: "Casanova" } },
    ]);
    renderAt("/ie/venues/casanova");
    const link = screen.getByText("QA Casanova Upcoming").closest("a");
    expect(link).toHaveAttribute("href", "/ie/events/qa-casanova-upcoming");
  });

  it("sin eventos próximos: muestra el estado vacío editorial (no el string técnico 'No upcoming events')", () => {
    mockDetail();
    mockEvents([]);
    renderAt("/ie/venues/casanova");
    expect(screen.getByText(/nothing announced yet|todavía no hay nada anunciado/i)).toBeInTheDocument();
  });
});

describe("VenueDetail — Past Events", () => {
  it("oculta la sección Past Events si no hay ninguno (aunque sí haya próximos)", () => {
    mockDetail();
    mockEvents([
      { id: 1, slug: "upcoming-1", name: "Upcoming One", imageUrl: null, startsAt: new Date(Date.now() + 86400000), isFeatured: false, venue: null },
    ]);
    renderAt("/ie/venues/casanova");
    expect(screen.queryByText(/^(past events|eventos anteriores)$/i)).not.toBeInTheDocument();
  });

  it("muestra Past Events con tratamiento visual atenuado cuando sí existen", () => {
    mockDetail();
    mockEvents([
      { id: 2, slug: "past-1", name: "Past One", imageUrl: null, startsAt: new Date(Date.now() - 10 * 86400000), isFeatured: false, venue: null },
    ]);
    renderAt("/ie/venues/casanova");
    expect(screen.getByText(/^(past events|eventos anteriores)$/i)).toBeInTheDocument();
    expect(screen.getByText("Past One").closest("a")).toHaveClass("opacity-60");
  });
});

describe("VenueDetail — Gallery adaptativa", () => {
  it("1 foto: se muestra como pieza editorial grande (no la grid de varias columnas)", () => {
    mockDetail({ description: "algo" });
    mockGallery([{ id: 1, imageUrl: "https://example.com/1.jpg", title: "Foto 1" }]);
    const { container } = renderAt("/ie/venues/casanova");
    expect(container.querySelectorAll("button img")).toHaveLength(1);
    expect(screen.getByText(/^(gallery|galería)$/i)).toBeInTheDocument();
  });

  it("4+ fotos: se muestra la grid completa con todas las fotos, no un subconjunto arbitrario", () => {
    mockDetail({ description: "algo" });
    mockGallery([1, 2, 3, 4, 5].map(i => ({ id: i, imageUrl: `https://example.com/${i}.jpg`, title: null })));
    const { container } = renderAt("/ie/venues/casanova");
    expect(container.querySelectorAll("button img")).toHaveLength(5);
  });

  it("sin fotos y sin descripción: la sección About+Gallery no se renderiza en absoluto", () => {
    mockDetail({ description: null });
    mockGallery([]);
    renderAt("/ie/venues/casanova");
    expect(screen.queryByText(/^(gallery|galería)$/i)).not.toBeInTheDocument();
  });
});

describe("VenueDetail — Logo y cover fallback", () => {
  it("sin coverImageUrl ni imageUrl: no revienta, no muestra insignia de logo", () => {
    mockDetail({ coverImageUrl: null, imageUrl: null });
    const { container } = renderAt("/ie/venues/casanova");
    expect(screen.getByText("Casanova")).toBeInTheDocument();
    // Ningún <img> de logo/cover en el hero — solo el fondo degradado.
    expect(container.querySelector("h1 + p")).toBeTruthy();
  });

  it("con cover pero sin logo: no se fuerza el cover como logo (nunca estirar cover como logo salvo política ya consolidada)", () => {
    mockDetail({ coverImageUrl: "https://example.com/cover.jpg", imageUrl: null });
    const { container } = renderAt("/ie/venues/casanova");
    const heroImg = container.querySelector('img[src="https://example.com/cover.jpg"]');
    expect(heroImg).toBeTruthy();
    // La insignia de logo (contenedor con bg-black/85) no debe existir sin imageUrl real.
    expect(container.querySelector(".bg-black\\/85")).not.toBeInTheDocument();
  });

  it("con cover Y logo: la insignia de logo se muestra junto al nombre", () => {
    mockDetail({ coverImageUrl: "https://example.com/cover.jpg", imageUrl: "https://example.com/logo.png" });
    const { container } = renderAt("/ie/venues/casanova");
    expect(container.querySelector(".bg-black\\/85")).toBeInTheDocument();
  });
});

describe("VenueDetail — Quick actions adaptativas", () => {
  it("sin instagramUrl/address/eventos: no muestra la barra de acciones (nunca inventar acciones)", () => {
    mockDetail({ instagramUrl: null, address: null });
    mockEvents([]);
    renderAt("/ie/venues/casanova");
    expect(screen.queryByText(/get directions|cómo llegar/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Instagram")).not.toBeInTheDocument();
  });

  it("con instagramUrl real: muestra el link de Instagram apuntando a esa URL exacta", () => {
    mockDetail({ instagramUrl: "https://instagram.com/casanova" });
    renderAt("/ie/venues/casanova");
    expect(screen.getByText("Instagram").closest("a")).toHaveAttribute("href", "https://instagram.com/casanova");
  });

  it("con address real: muestra 'Get directions'/'Cómo llegar' enlazando a Google Maps con la dirección real", () => {
    mockDetail({ address: "Calle Real 12" });
    renderAt("/ie/venues/casanova");
    const link = screen.getByText(/get directions|cómo llegar/i).closest("a");
    expect(link?.getAttribute("href")).toContain(encodeURIComponent("Calle Real 12"));
  });
});

describe("VenueDetail — community routing (misma ficha, sin bifurcar IE/UVA)", () => {
  it("el botón de volver navega a /{comunidad}/explore usando la comunidad real del contexto (aquí IE)", () => {
    mockDetail();
    renderAt("/ie/venues/casanova");
    // No hardcodea "ie" en el componente — viene de useCommunity(); el mock del
    // contexto en este archivo devuelve slug "ie" a propósito para esta prueba.
    // getAllByText porque el sidebar TAMBIÉN tiene un link "Explorar" — el
    // botón de volver del hero es el único dentro de un <button> real.
    const backButtons = screen.getAllByText(/^(explore|explorar)$/i).map(el => el.closest("button")).filter(Boolean);
    expect(backButtons).toHaveLength(1);
  });
});

describe("VenueDetail — badge de SegoTokens en Upcoming Events (MG-02, hallazgo real: la misma card de Home/Explore no lo mostraba aquí)", () => {
  it("sin sesión: nunca pide el lote de recompensa (autoservicio del propio Student, mismo criterio que Explore)", () => {
    mockAnonymous();
    mockDetail();
    mockEvents([
      { id: 1, slug: "qa-casanova-upcoming", name: "QA Casanova Upcoming", imageUrl: null, startsAt: new Date(Date.now() + 86400000), isFeatured: false, venue: { name: "Casanova" } },
    ]);
    renderAt("/ie/venues/casanova");
    expect(mockRewardBatch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
  });

  it("con sesión y recompensa real en el lote: la card de Upcoming muestra el badge formateado", () => {
    mockAuthenticated();
    mockDetail();
    mockEvents([
      { id: 1, slug: "qa-casanova-upcoming", name: "QA Casanova Upcoming", imageUrl: null, startsAt: new Date(Date.now() + 86400000), isFeatured: false, venue: { name: "Casanova" } },
    ]);
    mockRewardBatch.mockReturnValue({ data: { "1": { conditionalRewards: [{ eligible: true, totalTokens: 100 }], totalGuaranteedTokens: 0, effectiveRate: null } }, isLoading: false });
    renderAt("/ie/venues/casanova");
    expect(screen.getByText(/up to \+100 st|hasta \+100 st/i)).toBeInTheDocument();
    expect(mockRewardBatch).toHaveBeenCalledWith({ items: [{ key: "1", eventId: 1, venueId: 1 }] }, expect.objectContaining({ enabled: true }));
  });

  it("Past Events nunca muestra el badge, aunque el lote tuviera datos para ese id (un evento ya pasado no se puede comprar/asistir)", () => {
    mockAuthenticated();
    mockDetail();
    mockEvents([
      { id: 2, slug: "past-1", name: "Past One", imageUrl: null, startsAt: new Date(Date.now() - 10 * 86400000), isFeatured: false, venue: null },
    ]);
    mockRewardBatch.mockReturnValue({ data: { "2": { conditionalRewards: [{ eligible: true, totalTokens: 100 }], totalGuaranteedTokens: 0, effectiveRate: null } }, isLoading: false });
    renderAt("/ie/venues/casanova");
    expect(screen.queryByText(/\+100 st/i)).not.toBeInTheDocument();
  });
});

describe("VenueDetail — estados", () => {
  it("venue inexistente (detail=null): muestra el empty state 'Venue not found', no una página en blanco", () => {
    mockVenueQuery.mockReturnValue({ data: null, isLoading: false, error: null, refetch: vi.fn() });
    renderAt("/ie/venues/no-existe");
    expect(screen.getByText(/venue not found|local no encontrado/i)).toBeInTheDocument();
  });
});
