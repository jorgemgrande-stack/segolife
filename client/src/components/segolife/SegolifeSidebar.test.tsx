import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@/lib/i18n";

const { mockUseQuery, mockAuthMe, noopQuery } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockAuthMe: vi.fn(),
  noopQuery: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    communities: { myMemberships: { useQuery: mockUseQuery } },
    config: { getPublicSettings: { useQuery: noopQuery } },
    auth: {
      me: { useQuery: mockAuthMe },
      logout: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    useUtils: () => ({ auth: { me: { setData: vi.fn() } } }),
  },
}));

import { SegolifeSidebar } from "./SegolifeSidebar";

function mockAuthenticated() {
  mockAuthMe.mockReturnValue({ data: { id: 4, name: "Ana" }, isLoading: false });
}
function mockAnonymous() {
  mockAuthMe.mockReturnValue({ data: null, isLoading: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticated();
  mockUseQuery.mockReturnValue({ data: undefined });
});

afterEach(cleanup);

/**
 * Sidebar de escritorio (Fase 8.5) — mismo criterio de agnosticismo de
 * comunidad que SegolifeBottomNav.test.tsx: `slug` es una prop, nunca un
 * literal "ie"/"uva" en el componente. Reutiliza la MISMA rejilla de rutas
 * que el bottom nav (spec: "sistema común community-aware", no
 * IeAppShell/UvaAppShell paralelos).
 */
describe("SegolifeSidebar", () => {
  it("construye los enlaces con el slug de comunidad recibido, cualquiera que sea (nunca hardcodea ie/uva)", () => {
    window.history.pushState({}, "", "/uva");
    render(<SegolifeSidebar slug="uva" />);
    expect(screen.getByRole("link", { name: /Home|Inicio/ })).toHaveAttribute("href", "/uva");
    expect(screen.getByRole("link", { name: /Explore|Explorar/ })).toHaveAttribute("href", "/uva/explore");
    expect(screen.getByRole("link", { name: /Tickets|Entradas/ })).toHaveAttribute("href", "/uva/tickets");
    expect(screen.getByRole("link", { name: /Scan|Escanear/ })).toHaveAttribute("href", "/uva/scan");
    expect(screen.getByRole("link", { name: /Rewards|Recompensas/ })).toHaveAttribute("href", "/uva/rewards");
    expect(screen.getByRole("link", { name: /Profile|Perfil/ })).toHaveAttribute("href", "/uva/profile");
  });

  it("marca Explore como activo cuando la ruta actual empieza por /:slug/explore", () => {
    window.history.pushState({}, "", "/ie/explore");
    render(<SegolifeSidebar slug="ie" />);
    expect(screen.getByRole("link", { name: /Explore|Explorar/ })).toHaveAttribute("aria-current", "page");
  });

  it("no muestra el selector de comunidad si trpc.communities.myMemberships todavía no ha resuelto (undefined)", () => {
    window.history.pushState({}, "", "/ie");
    render(<SegolifeSidebar slug="ie" />);
    expect(screen.queryByRole("button", { expanded: false })).not.toBeInTheDocument();
  });

  it("no muestra el selector si el estudiante solo pertenece a una comunidad — bug real corregido: antes listaba TODAS las comunidades globales (communities.list), dejando 'cambiar' a una a la que no pertenecía", () => {
    mockUseQuery.mockReturnValue({ data: [{ id: 1, slug: "ie", name: "Segolife IE" }] });
    window.history.pushState({}, "", "/ie");
    render(<SegolifeSidebar slug="ie" />);
    expect(screen.queryByRole("button", { expanded: false })).not.toBeInTheDocument();
    expect(screen.queryByText("Segolife IE")).not.toBeInTheDocument();
  });

  it("muestra el selector con las comunidades REALES del usuario (myMemberships) cuando pertenece a más de una", () => {
    mockUseQuery.mockReturnValue({
      data: [
        { id: 1, slug: "ie", name: "Segolife IE" },
        { id: 2, slug: "uva", name: "Segolife UVA" },
      ],
    });
    window.history.pushState({}, "", "/ie");
    render(<SegolifeSidebar slug="ie" />);
    expect(screen.getByText("Segolife IE")).toBeInTheDocument();
  });

  it("el ítem Rewards muestra el badge de beneficio activo solo cuando benefitsBadge=true", () => {
    window.history.pushState({}, "", "/ie");
    const { container, rerender } = render(<SegolifeSidebar slug="ie" benefitsBadge={false} />);
    expect(container.querySelector(".bg-accent")).not.toBeInTheDocument();
    rerender(<SegolifeSidebar slug="ie" benefitsBadge={true} />);
    expect(container.querySelector(".bg-accent")).toBeInTheDocument();
  });

  // Fase 16 — bug real reportado con capturas: un visitante ANÓNIMO en /ie o
  // /uva rebotaba constantemente a /login. Causa real: este componente
  // llamaba a communities.myMemberships (protectedProcedure) SIN `enabled`,
  // así que se disparaba también para visitantes sin sesión — un 401 real
  // que el handler GLOBAL de main.tsx convierte en una redirección dura a
  // /login ante cualquier error con el mensaje UNAUTHED_ERR_MSG. El
  // componente se monta siempre que hideNav=false (Home/CommunityLanding/
  // Explore...), aunque esté oculto por CSS bajo el breakpoint xl:.
  describe("visitante anónimo — nunca dispara la query protegida (Fase 16, bug real corregido)", () => {
    it("sin sesión: communities.myMemberships se llama con enabled=false, nunca dispara la petición real", () => {
      mockAnonymous();
      window.history.pushState({}, "", "/ie");
      render(<SegolifeSidebar slug="ie" />);
      expect(mockUseQuery).toHaveBeenCalledWith(undefined, expect.objectContaining({ enabled: false }));
    });

    it("con sesión: communities.myMemberships se llama con enabled=true (comportamiento normal intacto)", () => {
      mockAuthenticated();
      window.history.pushState({}, "", "/ie");
      render(<SegolifeSidebar slug="ie" />);
      expect(mockUseQuery).toHaveBeenCalledWith(undefined, expect.objectContaining({ enabled: true }));
    });

    it("sin sesión, el sidebar se renderiza igualmente (enlaces de navegación pública), nunca en blanco ni lanza", () => {
      mockAnonymous();
      window.history.pushState({}, "", "/ie");
      render(<SegolifeSidebar slug="ie" />);
      expect(screen.getByRole("link", { name: /Home|Inicio/ })).toHaveAttribute("href", "/ie");
    });
  });
});
