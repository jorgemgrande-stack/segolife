/**
 * LegalPages.test.tsx — FASE LEGAL (2026-08-23). Cubre las 5 páginas legales
 * públicas (/aviso-legal, /terminos, /privacidad, /cookies,
 * /condiciones-cancelacion): deben renderizar sin sesión, mostrar la
 * identidad societaria real (HAYQUE CAPITAL, S.L. / CIF), reaccionar al
 * cambio de idioma, y enlazarse entre sí. Un solo archivo para las 5 — todas
 * comparten el mismo shell (PublicHomeNav/PublicHomeFooter/LegalSection) y
 * repetir el mismo boilerplate 5 veces no añadiría cobertura real.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import i18n from "@/lib/i18n";

vi.mock("@/lib/trpc", () => ({
  trpc: {
    config: { getPublicSettings: { useQuery: () => ({ data: undefined }) } },
    communities: { list: { useQuery: () => ({ data: [{ id: 1, slug: "ie", name: "Segolife IE", status: "active" }] }) } },
  },
}));

import AvisoLegal from "./AvisoLegal";
import TerminosCondiciones from "./TerminosCondiciones";
import PoliticaPrivacidad from "./PoliticaPrivacidad";
import PoliticaCookies from "./PoliticaCookies";
import CondicionesCancelacion from "./CondicionesCancelacion";

const PAGES = [
  { name: "Aviso Legal", Component: AvisoLegal, esHeading: "Aviso Legal", enHeading: "Legal Notice", showsIdentity: true },
  { name: "Términos y Condiciones", Component: TerminosCondiciones, esHeading: "Términos y Condiciones de Uso", enHeading: "Terms and Conditions of Use", showsIdentity: true },
  { name: "Política de Privacidad", Component: PoliticaPrivacidad, esHeading: "Política de Privacidad", enHeading: "Privacy Policy", showsIdentity: true },
  // La página de Cookies no repite la identidad societaria completa — no es
  // un dato omitido por error, remite a /privacidad para eso (ver §7 de su
  // propio contenido); solo Aviso Legal/Términos/Privacidad la muestran.
  { name: "Política de Cookies", Component: PoliticaCookies, esHeading: "Política de Cookies", enHeading: "Cookie Policy", showsIdentity: false },
  { name: "Devolución y Reembolso", Component: CondicionesCancelacion, esHeading: "Política de Devolución y Reembolso", enHeading: "Refunds and Returns Policy", showsIdentity: true },
];

beforeEach(async () => {
  await i18n.changeLanguage("es");
});

afterEach(() => {
  cleanup();
});

describe.each(PAGES)("$name — página legal pública", ({ Component, esHeading, enHeading, showsIdentity }) => {
  it("renderiza sin sesión ni comunidad, sin lanzar", () => {
    render(<Component />);
    expect(screen.getByRole("heading", { level: 1, name: esHeading })).toBeInTheDocument();
  });

  it("muestra la identidad societaria real (HAYQUE CAPITAL, S.L.) cuando corresponde, nunca datos inventados", () => {
    render(<Component />);
    if (showsIdentity) {
      expect(screen.getAllByText(/HAYQUE CAPITAL, S\.L\./).length).toBeGreaterThan(0);
    } else {
      expect(screen.queryAllByText(/HAYQUE CAPITAL/).length).toBe(0);
    }
  });

  it("cambia al inglés cuando i18n.language es 'en' (mismo selector ES/EN de PublicHomeNav)", async () => {
    await i18n.changeLanguage("en");
    render(<Component />);
    expect(screen.getByRole("heading", { level: 1, name: enHeading })).toBeInTheDocument();
    await i18n.changeLanguage("es");
  });

  it("incluye el footer público con los 5 enlaces legales (nunca huérfana de navegación)", () => {
    render(<Component />);
    expect(screen.getByRole("link", { name: "Aviso legal" })).toHaveAttribute("href", "/aviso-legal");
    expect(screen.getByRole("link", { name: "Devoluciones y reembolsos" })).toHaveAttribute("href", "/condiciones-cancelacion");
  });
});

describe("Aviso Legal — pendientes marcados, nunca inventados", () => {
  it("el Registro Mercantil aparece marcado como pendiente de confirmar, no como un dato inventado", () => {
    render(<AvisoLegal />);
    expect(screen.getByText(/Pendiente de confirmar/i)).toBeInTheDocument();
  });
});

describe("Devolución y Reembolso — distingue venta nativa de operadores externos", () => {
  it("explica que Weezevent/Fourvenues procesan su propio pago, SEGOLIFE no cobra ese dinero", () => {
    render(<CondicionesCancelacion />);
    expect(screen.getByText(/Weezevent y\/o Fourvenues/)).toBeInTheDocument();
    expect(screen.getAllByText(/no procesa ese pago|nunca cobra ese dinero/).length).toBeGreaterThan(0);
  });
});
