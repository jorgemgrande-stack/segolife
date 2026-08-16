import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@/lib/i18n";

/**
 * SegolifeAppShell.test.tsx — bug real reportado con capturas: Cristina
 * (Student real solo de Segolife IE) navegaba a /uva estando logueada y la
 * app la mostraba como "Segolife UVA" — el saludo y las queries de la
 * página usaban la comunidad de la URL sin comprobar si era realmente
 * miembro de ella. home.getSummary ya se defendía server-side, pero el
 * resto de la experiencia (saludo, venues, etc.) no. Un usuario logueado
 * debe acceder SIEMPRE a su comunidad real, nunca a la que diga la URL sin
 * verificarla — mismo criterio que ya usaba el selector de SegolifeSidebar
 * (myMemberships, nunca communities.list).
 */
const { mockMyMemberships, noopQuery, navigateSpy } = vi.hoisted(() => ({
  mockMyMemberships: vi.fn(),
  noopQuery: () => ({ data: undefined, isLoading: false }),
  navigateSpy: vi.fn(),
}));

vi.mock("wouter", async () => {
  const actual = await vi.importActual<typeof import("wouter")>("wouter");
  return {
    ...actual,
    useLocation: (...args: unknown[]) => {
      // @ts-expect-error — pasa a través a la implementación real de wouter
      const [path, realNavigate] = actual.useLocation(...args);
      return [path, (...navArgs: unknown[]) => { navigateSpy(...navArgs); return (realNavigate as (...a: unknown[]) => unknown)(...navArgs); }];
    },
  };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      me: { useQuery: () => ({ data: { id: 4, name: "Cristina", email: "cristina@ie.edu" }, isLoading: false }) },
      logout: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    home: { getSummary: { useQuery: noopQuery } },
    studentNotifications: { unreadCount: { useQuery: noopQuery } },
    communities: { list: { useQuery: noopQuery }, myMemberships: { useQuery: mockMyMemberships } },
    config: { getPublicSettings: { useQuery: noopQuery } },
    ticketPurchase: { myIdentityToken: { useQuery: noopQuery }, rotateMyIdentityToken: { useMutation: () => ({ mutate: vi.fn() }) } },
    useUtils: () => ({ auth: { me: { setData: vi.fn() } } }),
  },
}));

vi.mock("@/contexts/CommunityContext", () => ({
  // Mock estático a propósito: la comunidad de la URL es SIEMPRE "uva" en
  // este archivo, sea cual sea el momento — lo que se prueba aquí es que la
  // shell PIDE la redirección a la comunidad real (navigateSpy), no que
  // CommunityContext se re-resuelva tras navegar (eso ya está cubierto en
  // producción real por el propio Provider, no por este mock).
  useCommunity: () => ({
    community: { id: 2, slug: "uva", name: "Segolife UVA" },
    slug: "uva",
    defaultLocale: "es",
    availableLocales: ["es"],
    loading: false,
    error: null,
  }),
}));

import { SegolifeAppShell } from "./SegolifeAppShell";

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(
    <SegolifeAppShell title="Test">
      <div>contenido de prueba</div>
    </SegolifeAppShell>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("SegolifeAppShell — un Student autenticado nunca accede a una comunidad de la que no es miembro real", () => {
  it("Cristina (solo miembro real de IE) en /uva: se pide redirección a /ie, nunca se pinta el contenido de /uva", async () => {
    mockMyMemberships.mockReturnValue({
      data: [{ id: 1, slug: "ie", name: "Segolife IE" }],
      isLoading: false,
    });
    renderAt("/uva");
    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledWith("/ie", { replace: true });
    });
    // Mientras se resuelve la redirección nunca se llega a pintar el contenido "como si" fuera de /uva.
    expect(screen.queryByText("contenido de prueba")).not.toBeInTheDocument();
  });

  it("un estudiante multicomunidad (miembro real de IE Y UVA) nunca es redirigido al visitar cualquiera de las dos — aquí la URL real (uva) SÍ es una membresía real suya", async () => {
    mockMyMemberships.mockReturnValue({
      data: [{ id: 1, slug: "ie", name: "Segolife IE" }, { id: 2, slug: "uva", name: "Segolife UVA" }],
      isLoading: false,
    });
    renderAt("/uva");
    await waitFor(() => {
      expect(screen.getByText("contenido de prueba")).toBeInTheDocument();
    });
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("sin membresías reales todavía (cuenta recién creada, estado defensivo): nunca bloquea ni intenta redirigir a ningún sitio", async () => {
    mockMyMemberships.mockReturnValue({ data: [], isLoading: false });
    renderAt("/uva");
    await waitFor(() => {
      expect(screen.getByText("contenido de prueba")).toBeInTheDocument();
    });
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
