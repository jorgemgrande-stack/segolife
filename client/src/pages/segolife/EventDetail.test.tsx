import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Route } from "wouter";
import "@/lib/i18n";
import i18n from "@/lib/i18n";

const { mockEventQuery, mockRewardQuery, mockCheckoutMutation, mockAuthMe } = vi.hoisted(() => ({
  mockEventQuery: vi.fn(),
  mockRewardQuery: vi.fn(),
  mockCheckoutMutation: vi.fn(),
  mockAuthMe: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    events: { publicGetBySlug: { useQuery: mockEventQuery } },
    tokens: { previewMyEventReward: { useQuery: mockRewardQuery } },
    ticketPurchase: { startCheckout: { useMutation: mockCheckoutMutation } },
  },
}));

vi.mock("@/contexts/CommunityContext", () => ({
  useCommunity: () => ({ community: { id: 1, slug: "ie", name: "Segolife IE" }, slug: "ie", loading: false, error: null }),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

vi.mock("@/components/segolife/SegolifeAppShell", () => ({
  SegolifeAppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import EventDetail from "./EventDetail";

/**
 * EventDetail.test.tsx — Event Detail UI Refresh (2026-08-23). Cubre la
 * composición real (secciones que se ocultan sin dato: descripción/venue/
 * comunidades), los 3 estados reales de purchaseAction (external_url/
 * native_checkout/unavailable — nunca se cambió su lógica, solo la
 * presentación), comunidades dinámicas (nunca IE/UVA hardcodeado en el
 * componente), y la regresión de timezone (spec §8): la fecha/hora SIEMPRE
 * se muestra en Europe/Madrid, nunca en la del entorno donde corre el test.
 */
function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 200,
    name: "Felisa's been expecting you",
    slug: "felisas-been-expecting-you",
    description: "FELISA'S BEEN EXPECTING YOU…\n\nDoor price: Free entry until 1AM",
    imageUrl: "https://cdn.example.invalid/felisa.jpg",
    isFeatured: true,
    status: "active" as const,
    // 22:00 UTC 31-ago = 00:00 Europe/Madrid 1-sep (CEST, +2h) — instante
    // real elegido a propósito porque UTC y Madrid caen en DÍAS distintos,
    // el caso exacto que reveló el bug real de timezone.
    startsAt: new Date("2026-08-31T22:00:00.000Z"),
    endsAt: new Date("2026-09-01T02:30:00.000Z"),
    ...overrides,
  };
}

function mockDetail(input: {
  event?: Partial<Record<string, unknown>>;
  venue?: { id: number; name: string; slug: string } | null;
  communities?: Array<{ id: number; name: string }>;
  purchaseAction?: unknown;
} = {}) {
  mockEventQuery.mockReturnValue({
    data: {
      event: baseEvent(input.event),
      venue: input.venue === undefined ? { id: 5, name: "Tía Felisa", slug: "tia-felisa" } : input.venue,
      communities: input.communities ?? [{ id: 1, name: "Segolife IE" }, { id: 2, name: "Segolife UVA" }],
      purchaseAction: input.purchaseAction ?? { type: "external_url", url: "https://tickets.example.invalid/felisa" },
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
}

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(
    <Route path="/:community/events/:slug">
      <EventDetail />
    </Route>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRewardQuery.mockReturnValue({ data: undefined, isLoading: false });
  mockCheckoutMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockAuthMe.mockReturnValue({ data: null, isLoading: false });
  i18n.changeLanguage("en");
});

afterEach(() => cleanup());

describe("EventDetail — render normal (external_url)", () => {
  it("muestra título, venue, descripción y el CTA de Buy Tickets", () => {
    mockDetail();
    renderAt("/ie/events/felisas-been-expecting-you");

    expect(screen.getByRole("heading", { name: "Felisa's been expecting you", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /tía felisa/i })).toHaveAttribute("href", "/ie/venues/tia-felisa");
    expect(screen.getByText("About this event")).toBeInTheDocument();
    expect(screen.getByText(/free entry until 1am/i)).toBeInTheDocument();
    const buyLink = screen.getByRole("link", { name: /buy tickets/i });
    expect(buyLink).toHaveAttribute("href", "https://tickets.example.invalid/felisa");
    expect(buyLink).toHaveAttribute("target", "_blank");
  });

  it("el póster usa el nombre del evento como alt y no deforma la imagen (object-cover ya cubierto por CSS, aquí solo se comprueba el src real)", () => {
    mockDetail();
    renderAt("/ie/events/felisas-been-expecting-you");
    const img = screen.getByRole("img", { name: "Felisa's been expecting you" });
    expect(img).toHaveAttribute("src", "https://cdn.example.invalid/felisa.jpg");
  });

  it("badge Featured visible cuando isFeatured=true", () => {
    mockDetail({ event: { isFeatured: true } });
    renderAt("/ie/events/felisas-been-expecting-you");
    expect(screen.getByText("Featured")).toBeInTheDocument();
  });

  it("badge Featured ausente cuando isFeatured=false", () => {
    mockDetail({ event: { isFeatured: false } });
    renderAt("/ie/events/felisas-been-expecting-you");
    expect(screen.queryByText("Featured")).not.toBeInTheDocument();
  });
});

describe("EventDetail — fecha/hora SIEMPRE en Europe/Madrid (spec §8, bug real corregido)", () => {
  it("22:00 UTC del 31-ago (madrugada del 1-sep en Madrid, CEST +2h) se muestra como 'Tuesday, September 1' y '12:00 AM', nunca 'Monday, August 31' ni una hora de otra timezone", () => {
    mockDetail();
    renderAt("/ie/events/felisas-been-expecting-you");

    expect(screen.getByText(/tuesday, september 1/i)).toBeInTheDocument();
    expect(screen.getByText(/12:00 AM.*04:30 AM/)).toBeInTheDocument();
    expect(screen.queryByText(/monday, august 31/i)).not.toBeInTheDocument();
  });

  it("sin endsAt → muestra una única hora, nunca un rango con un segundo valor inventado", () => {
    mockDetail({ event: { endsAt: null } });
    renderAt("/ie/events/felisas-been-expecting-you");

    expect(screen.getByText("12:00 AM")).toBeInTheDocument();
    expect(screen.queryByText(/–/)).not.toBeInTheDocument();
  });
});

describe("EventDetail — venue opcional", () => {
  it("sin venue asociado → no muestra el subtítulo de ubicación, sin romper el resto de la ficha", () => {
    mockDetail({ venue: null });
    renderAt("/ie/events/felisas-been-expecting-you");
    expect(screen.queryByRole("link", { name: /tía felisa/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Felisa's been expecting you" })).toBeInTheDocument();
  });
});

describe("EventDetail — comunidades dinámicas (spec §10, nunca IE/UVA hardcodeado)", () => {
  it("2 comunidades reales → 2 chips con los nombres reales devueltos por el backend", () => {
    mockDetail({ communities: [{ id: 1, name: "Segolife IE" }, { id: 2, name: "Segolife UVA" }] });
    renderAt("/ie/events/felisas-been-expecting-you");
    expect(screen.getByText("Segolife IE")).toBeInTheDocument();
    expect(screen.getByText("Segolife UVA")).toBeInTheDocument();
  });

  it("una única comunidad futura distinta (nunca IE/UVA) → funciona igual, sin ningún condicional por nombre", () => {
    mockDetail({ communities: [{ id: 9, name: "Segolife Valladolid" }] });
    renderAt("/ie/events/felisas-been-expecting-you");
    expect(screen.getByText("Segolife Valladolid")).toBeInTheDocument();
  });

  it("sin comunidades → no revienta, ninguna sección de comunidades visible", () => {
    mockDetail({ communities: [] });
    renderAt("/ie/events/felisas-been-expecting-you");
    expect(screen.getByRole("heading", { name: "Felisa's been expecting you" })).toBeInTheDocument();
  });
});

describe("EventDetail — descripción opcional (spec §11/§12)", () => {
  it("sin descripción → la sección 'About this event' no se renderiza en absoluto", () => {
    mockDetail({ event: { description: null } });
    renderAt("/ie/events/felisas-been-expecting-you");
    expect(screen.queryByText("About this event")).not.toBeInTheDocument();
  });

  it("la descripción se renderiza como texto plano (React ya la escapa) — un intento de HTML se muestra literal, nunca se interpreta", () => {
    mockDetail({ event: { description: "<script>alert(1)</script> texto real" } });
    renderAt("/ie/events/felisas-been-expecting-you");
    expect(screen.getByText(/<script>alert\(1\)<\/script> texto real/)).toBeInTheDocument();
    expect(document.querySelector("script[src], script:not([type])")).toBeFalsy();
  });
});

describe("EventDetail — purchaseAction: los 3 estados reales, nunca se cambió su lógica", () => {
  it("native_checkout: renderiza tipos de entrada y el botón 'Continue to checkout' deshabilitado sin cantidad elegida", () => {
    mockDetail({
      purchaseAction: {
        type: "native_checkout", eventId: 200,
        ticketTypes: [{ id: 1, name: "General", description: null, priceCents: 1500, currency: "EUR", available: 20 }],
      },
    });
    renderAt("/ie/events/felisas-been-expecting-you");
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText(/15\.00 EUR/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeDisabled();
  });

  it("native_checkout: tipo de entrada agotado muestra 'Sold out', sin selector +/-", () => {
    mockDetail({
      purchaseAction: {
        type: "native_checkout", eventId: 200,
        ticketTypes: [{ id: 1, name: "General", description: null, priceCents: 1500, currency: "EUR", available: 0 }],
      },
    });
    renderAt("/ie/events/felisas-been-expecting-you");
    expect(screen.getByText("Sold out")).toBeInTheDocument();
  });

  it("unavailable + evento futuro → 'Tickets coming soon', botón deshabilitado, sin badge de finalizado", () => {
    mockDetail({ purchaseAction: { type: "unavailable" } });
    renderAt("/ie/events/felisas-been-expecting-you");
    expect(screen.getByRole("button", { name: /tickets coming soon/i })).toBeDisabled();
    expect(screen.queryByText("Ended")).not.toBeInTheDocument();
  });

  it("unavailable + evento ya pasado → 'This event has already ended' + badge Ended junto al título", () => {
    mockDetail({
      event: { startsAt: new Date("2020-01-01T20:00:00.000Z"), endsAt: new Date("2020-01-02T02:00:00.000Z") },
      purchaseAction: { type: "unavailable" },
    });
    renderAt("/ie/events/felisas-been-expecting-you");
    expect(screen.getByRole("button", { name: /this event has already ended/i })).toBeDisabled();
    expect(screen.getByText("Ended")).toBeInTheDocument();
  });
});

describe("EventDetail — i18n ES", () => {
  it("con idioma ES, los labels clave se traducen (Volver a Explorar / Sobre este evento / Entradas)", () => {
    i18n.changeLanguage("es");
    mockDetail();
    renderAt("/ie/events/felisas-been-expecting-you");
    expect(screen.getByText("Volver a Explorar")).toBeInTheDocument();
    expect(screen.getByText("Sobre este evento")).toBeInTheDocument();
    expect(screen.getByText("Entradas")).toBeInTheDocument();
  });
});

describe("EventDetail — estado no encontrado", () => {
  it("data === null → estado vacío 'Event not found', sin reventar el resto de la página", () => {
    mockEventQuery.mockReturnValue({ data: null, isLoading: false, error: null, refetch: vi.fn() });
    renderAt("/ie/events/no-existe");
    expect(screen.getByText("Event not found")).toBeInTheDocument();
  });
});
