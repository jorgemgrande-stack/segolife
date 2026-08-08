import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@/lib/i18n";
import { SegolifeBottomNav } from "./SegolifeBottomNav";

afterEach(cleanup);

/**
 * Nav inferior (Fase 6, "navegación principal") — Home|Explore|[SCAN]|Rewards|
 * Profile, SCAN central elevado, estado activo por ruta real, y agnóstica
 * de comunidad (slug es una prop, nunca un literal "ie"/"uva" en el
 * componente — spec, "no hardcodear lista de comunidades").
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
});
