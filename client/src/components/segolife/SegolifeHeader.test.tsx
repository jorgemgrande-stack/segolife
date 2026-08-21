import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@/lib/i18n";

const { noopQuery } = vi.hoisted(() => ({
  noopQuery: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    config: { getPublicSettings: { useQuery: noopQuery } },
  },
}));

import { SegolifeHeader } from "./SegolifeHeader";

afterEach(cleanup);

/**
 * FIX-07B — cobertura previamente inexistente del header móvil. El icono
 * de perfil aquí es el ÚNICO punto de acceso a Profile en mobile/tablet
 * ahora que FIX-07B lo retiró del bottom nav (SegolifeBottomNav.tsx) —
 * este test existe para que esa dependencia quede verificada, no
 * asumida. `isAuthenticated=false` en los tests que no lo necesitan evita
 * montar SegolifeIdentityQrButton (que depende de trpc.ticketPurchase.*,
 * fuera del alcance de este componente).
 */
describe("SegolifeHeader", () => {
  it("el icono de perfil apunta siempre a /:slug/profile, con el slug de comunidad recibido (nunca hardcodea ie/uva)", () => {
    render(<SegolifeHeader slug="uva" availableLocales={["en"]} />);
    expect(screen.getByRole("link", { name: /profile/i })).toHaveAttribute("href", "/uva/profile");
  });

  it("el acceso a Profile es independiente de isAuthenticated — siempre presente en el header", () => {
    render(<SegolifeHeader slug="ie" availableLocales={["en"]} isAuthenticated={false} />);
    expect(screen.getByRole("link", { name: /profile/i })).toHaveAttribute("href", "/ie/profile");
  });

  it("el logo enlaza a la home de la comunidad actual", () => {
    render(<SegolifeHeader slug="ie" availableLocales={["en"]} />);
    expect(screen.getByRole("link", { name: /segolife/i })).toHaveAttribute("href", "/ie");
  });

  it("la campana de notificaciones apunta a /:slug/notifications", () => {
    render(<SegolifeHeader slug="ie" availableLocales={["en"]} />);
    expect(screen.getByRole("link", { name: /Notifications|Notificaciones/i })).toHaveAttribute("href", "/ie/notifications");
  });

  it("el selector de idioma solo aparece si la comunidad tiene más de un idioma disponible", () => {
    render(<SegolifeHeader slug="ie" availableLocales={["en"]} />);
    expect(screen.queryByRole("button", { name: "EN" })).not.toBeInTheDocument();

    cleanup();
    render(<SegolifeHeader slug="ie" availableLocales={["en", "es"]} />);
    expect(screen.getByRole("button", { name: "EN" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ES" })).toBeInTheDocument();
  });
});
