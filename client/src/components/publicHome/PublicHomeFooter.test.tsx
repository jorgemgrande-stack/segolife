import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@/lib/i18n";

const { mockCommunitiesList } = vi.hoisted(() => ({
  mockCommunitiesList: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    communities: { list: { useQuery: mockCommunitiesList } },
  },
}));

import { PublicHomeFooter } from "./PublicHomeFooter";

beforeEach(() => {
  vi.clearAllMocks();
  mockCommunitiesList.mockReturnValue({ data: undefined });
});

afterEach(cleanup);

/**
 * Fase 15.1 — hallazgo real de la auditoría: este footer tenía "IE
 * University"/"UVA Segovia" hardcodeados (texto Y href), la única
 * violación real de la regla "nunca comparar/hardcodear un slug de
 * comunidad" (CLAUDE.md) en toda la superficie pública. Ahora lee
 * communities.list (procedure público real) — una comunidad nueva
 * aparece sola, ninguna requiere tocar este archivo.
 */
describe("PublicHomeFooter — lista de comunidades dinámica, nunca hardcodeada (Fase 15.1)", () => {
  it("sin datos todavía (undefined): no revienta, no muestra la sección de comunidades", () => {
    render(<PublicHomeFooter />);
    expect(screen.queryByText("Segolife IE")).not.toBeInTheDocument();
  });

  it("renderiza cada comunidad ACTIVA real devuelta por communities.list, con su slug real como href", () => {
    mockCommunitiesList.mockReturnValue({
      data: [
        { id: 1, slug: "ie", name: "Segolife IE", status: "active" },
        { id: 2, slug: "uva", name: "Segolife UVA", status: "active" },
      ],
    });
    render(<PublicHomeFooter />);
    expect(screen.getByRole("link", { name: "Segolife IE" })).toHaveAttribute("href", "/ie");
    expect(screen.getByRole("link", { name: "Segolife UVA" })).toHaveAttribute("href", "/uva");
  });

  it("una comunidad futura (ni ie ni uva) aparece automáticamente, sin ningún cambio de código", () => {
    mockCommunitiesList.mockReturnValue({
      data: [{ id: 3, slug: "usal", name: "Segolife USAL", status: "active" }],
    });
    render(<PublicHomeFooter />);
    expect(screen.getByRole("link", { name: "Segolife USAL" })).toHaveAttribute("href", "/usal");
  });

  it("filtra comunidades no activas (draft/archived) — nunca las enlaza públicamente", () => {
    mockCommunitiesList.mockReturnValue({
      data: [
        { id: 1, slug: "ie", name: "Segolife IE", status: "active" },
        { id: 4, slug: "draft-campus", name: "Draft Campus", status: "draft" },
      ],
    });
    render(<PublicHomeFooter />);
    expect(screen.getByRole("link", { name: "Segolife IE" })).toBeInTheDocument();
    expect(screen.queryByText("Draft Campus")).not.toBeInTheDocument();
  });

  it("lista vacía de comunidades activas: no muestra la sección, no lanza", () => {
    mockCommunitiesList.mockReturnValue({ data: [] });
    render(<PublicHomeFooter />);
    expect(screen.queryByRole("link", { name: /Segolife/ })).not.toBeInTheDocument();
  });
});
