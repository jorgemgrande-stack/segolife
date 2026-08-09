import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@/lib/i18n";

const { mockUseQuery } = vi.hoisted(() => ({ mockUseQuery: vi.fn() }));
vi.mock("@/lib/trpc", () => ({
  trpc: { communities: { list: { useQuery: mockUseQuery } } },
}));

import { SegolifeSidebar } from "./SegolifeSidebar";

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
    mockUseQuery.mockReturnValue({ data: undefined });
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
    mockUseQuery.mockReturnValue({ data: undefined });
    window.history.pushState({}, "", "/ie/explore");
    render(<SegolifeSidebar slug="ie" />);
    expect(screen.getByRole("link", { name: /Explore|Explorar/ })).toHaveAttribute("aria-current", "page");
  });

  it("no muestra el selector de comunidad si trpc.communities.list todavía no ha resuelto (undefined)", () => {
    mockUseQuery.mockReturnValue({ data: undefined });
    window.history.pushState({}, "", "/ie");
    render(<SegolifeSidebar slug="ie" />);
    expect(screen.queryByRole("button", { expanded: false })).not.toBeInTheDocument();
  });

  it("muestra el selector de comunidad con las comunidades reales devueltas por communities.list (nunca una lista hardcodeada)", () => {
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
    mockUseQuery.mockReturnValue({ data: undefined });
    window.history.pushState({}, "", "/ie");
    const { container, rerender } = render(<SegolifeSidebar slug="ie" benefitsBadge={false} />);
    expect(container.querySelector(".bg-accent")).not.toBeInTheDocument();
    rerender(<SegolifeSidebar slug="ie" benefitsBadge={true} />);
    expect(container.querySelector(".bg-accent")).toBeInTheDocument();
  });
});
