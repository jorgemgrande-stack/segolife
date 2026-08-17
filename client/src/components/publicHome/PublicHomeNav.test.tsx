import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@/lib/i18n";

vi.mock("@/lib/trpc", () => ({
  trpc: {
    config: { getPublicSettings: { useQuery: () => ({ data: undefined }) } },
  },
}));

import { PublicHomeNav } from "./PublicHomeNav";

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
});

afterEach(cleanup);

/**
 * PRE-16.17 (QA manual, Block B) — hallazgo real: el botón "Join SEGOLIFE"
 * de esta nav (visible sin hacer scroll en /ie y /uva, el más prominente
 * de la página) llamaba a getRegisterUrl() sin argumentos, así que SIEMPRE
 * perdía la comunidad de origen — a diferencia del FinalCta más abajo en
 * CommunityPublicLanding.tsx, que sí la preservaba (getRegisterUrl("/", slug)).
 * Resultado observado en QA: el mismo usuario, en la misma página /uva,
 * terminaba en /register?community=uva o en /register a secas según qué
 * botón pulsara — inconsistente y confuso. Se corrige pasando communitySlug.
 */
describe("PublicHomeNav — el CTA de registro preserva la comunidad de origen (PRE-16.17, hallazgo QA)", () => {
  it("sin communitySlug (Home master, páginas legales): /register sin query — comportamiento previo intacto", () => {
    render(<PublicHomeNav />);
    const link = screen.getByRole("link", { name: /join|únete/i });
    expect(link).toHaveAttribute("href", "/register");
  });

  it("con communitySlug='ie' (renderizada dentro de /ie): preserva ?community=ie", () => {
    render(<PublicHomeNav communitySlug="ie" />);
    const link = screen.getByRole("link", { name: /join|únete/i });
    expect(link).toHaveAttribute("href", "/register?community=ie");
  });

  it("con communitySlug='uva' (renderizada dentro de /uva): preserva ?community=uva", () => {
    render(<PublicHomeNav communitySlug="uva" />);
    const link = screen.getByRole("link", { name: /join|únete/i });
    expect(link).toHaveAttribute("href", "/register?community=uva");
  });
});
