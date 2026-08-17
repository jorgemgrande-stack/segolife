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

/**
 * PRE-16.17 (QA manual, BLOCK A) — hallazgo real: este footer (el único
 * footer real de la Home pública y de /ie, /uva anónimo) portó las
 * columnas Comunidades/Producto del footer antiguo de Náyade
 * (PublicFooter.tsx) pero nunca portó los enlaces legales — Términos,
 * Privacidad, Cookies, Condiciones de cancelación quedaron sin ningún
 * punto de navegación real desde la superficie pública (confirmado:
 * /condiciones-cancelacion estaba completamente huérfana). Las 4 páginas
 * ya existían y funcionaban (PRE-16.16 las limpió de branding Náyade),
 * solo faltaba enlazarlas.
 */
describe("PublicHomeFooter — enlaces legales (PRE-16.17, hallazgo QA)", () => {
  it("enlaza las 4 páginas legales reales, con sus rutas reales", () => {
    render(<PublicHomeFooter />);
    expect(screen.getByRole("link", { name: "Términos y condiciones" })).toHaveAttribute("href", "/terminos");
    expect(screen.getByRole("link", { name: "Política de privacidad" })).toHaveAttribute("href", "/privacidad");
    expect(screen.getByRole("link", { name: "Política de cookies" })).toHaveAttribute("href", "/cookies");
    expect(screen.getByRole("link", { name: "Condiciones de cancelación" })).toHaveAttribute("href", "/condiciones-cancelacion");
  });

  it("los enlaces legales aparecen incluso sin comunidades activas cargadas todavía", () => {
    mockCommunitiesList.mockReturnValue({ data: undefined });
    render(<PublicHomeFooter />);
    expect(screen.getByRole("link", { name: "Términos y condiciones" })).toBeInTheDocument();
  });
});
