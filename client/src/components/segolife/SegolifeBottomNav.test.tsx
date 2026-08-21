import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@/lib/i18n";
import { SegolifeBottomNav } from "./SegolifeBottomNav";

afterEach(cleanup);

/**
 * Nav inferior (Fase 6, "navegación principal") — Home|Explore|[SCAN]|
 * Comunity|Rewards, SCAN central REALMENTE centrado (2 items a cada
 * lado), estado activo por ruta real, y agnóstica de comunidad (slug es
 * una prop, nunca un literal "ie"/"uva" en el componente — spec, "no
 * hardcodear lista de comunidades"). FIX-07: Comunity (regresión —
 * faltaba en este array aunque ya existía en SegolifeSidebar.tsx,
 * dejándolo inaccesible desde la navegación en cualquier viewport por
 * debajo del breakpoint xl:). FIX-07B: Profile se retira SOLO de aquí
 * (sigue accesible desde SegolifeHeader.tsx, ver SegolifeHeader.test.tsx)
 * y Comunity pasa a ir DESPUÉS del hueco central — con Profile fuera, un
 * grid de 6 columnas (3 items antes del hueco + 2 después) no tenía
 * columna central real y el botón SCAN quedaba descuadrado a la
 * izquierda; con 5 columnas (2 + hueco + 2) sí la tiene.
 */
describe("SegolifeBottomNav", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/ie");
  });

  it("construye los enlaces con el slug de comunidad recibido, cualquiera que sea (nunca hardcodea ie/uva)", () => {
    render(<SegolifeBottomNav slug="uva" />);
    expect(screen.getByRole("link", { name: /Home|Inicio/ })).toHaveAttribute("href", "/uva");
    expect(screen.getByRole("link", { name: /Explore|Explorar/ })).toHaveAttribute("href", "/uva/explore");
    expect(screen.getByRole("link", { name: /Scan|Escanear/ })).toHaveAttribute("href", "/uva/scan");
  });

  it("marca Home como activo cuando la ruta actual es exactamente la home de comunidad", () => {
    window.history.pushState({}, "", "/ie");
    render(<SegolifeBottomNav slug="ie" />);
    expect(screen.getByRole("link", { name: /Home|Inicio/ })).toHaveAttribute("aria-current", "page");
  });

  it("marca Rewards como activo cuando la ruta actual empieza por /:slug/rewards", () => {
    window.history.pushState({}, "", "/ie/rewards");
    render(<SegolifeBottomNav slug="ie" />);
    expect(screen.getByRole("link", { name: /Rewards|Recompensas/ })).toHaveAttribute("aria-current", "page");
  });

  it("Home NO se marca activo en una sub-ruta (coincidencia exacta, no por prefijo)", () => {
    window.history.pushState({}, "", "/ie/explore");
    render(<SegolifeBottomNav slug="ie" />);
    expect(screen.getByRole("link", { name: /Home|Inicio/ })).not.toHaveAttribute("aria-current");
  });

  it("el botón SCAN central siempre existe y apunta a /:slug/scan", () => {
    render(<SegolifeBottomNav slug="ie" />);
    expect(screen.getByRole("link", { name: /Scan|Escanear/ })).toHaveAttribute("href", "/ie/scan");
  });

  it("FIX-07 — Comunity aparece en la navegación inferior y apunta a /:slug/comunity", () => {
    render(<SegolifeBottomNav slug="uva" />);
    expect(screen.getByRole("link", { name: /Comunity|Comunidad/ })).toHaveAttribute("href", "/uva/comunity");
  });

  it("FIX-07 — Comunity se marca activo en /:slug/comunity y en sus sub-rutas (Propose, etc.)", () => {
    window.history.pushState({}, "", "/ie/comunity");
    render(<SegolifeBottomNav slug="ie" />);
    expect(screen.getByRole("link", { name: /Comunity|Comunidad/ })).toHaveAttribute("aria-current", "page");

    cleanup();
    window.history.pushState({}, "", "/ie/comunity/algo");
    render(<SegolifeBottomNav slug="ie" />);
    expect(screen.getByRole("link", { name: /Comunity|Comunidad/ })).toHaveAttribute("aria-current", "page");
  });

  it("FIX-07 — Comunity NO se marca activo fuera de /:slug/comunity", () => {
    window.history.pushState({}, "", "/ie/rewards");
    render(<SegolifeBottomNav slug="ie" />);
    expect(screen.getByRole("link", { name: /Comunity|Comunidad/ })).not.toHaveAttribute("aria-current");
  });

  it("FIX-07B — Profile NO aparece en el bottom nav (sigue accesible solo desde el header)", () => {
    render(<SegolifeBottomNav slug="ie" />);
    expect(screen.queryByRole("link", { name: /^Profile$|^Perfil$/ })).not.toBeInTheDocument();
  });

  it("FIX-07B — exactamente 5 destinos en el nav: Home, Explore, Scan, Comunity, Rewards, sin Profile", () => {
    render(<SegolifeBottomNav slug="ie" />);
    expect(screen.getAllByRole("link")).toHaveLength(5);
  });
});
