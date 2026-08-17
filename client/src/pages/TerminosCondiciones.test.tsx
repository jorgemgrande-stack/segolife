import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * TerminosCondiciones.test.tsx — PRE-16.15 (auditoría overnight, identidad
 * legal). Esta página se enlaza directamente desde el checkbox de consentimiento
 * obligatorio de Register.tsx — es la página legal que más Students reales ven
 * antes de aceptar una cuenta. Antes de este fix mostraba "Iron Elephant
 * Consulting S.L." / CIF B26987875 / Madrid (identidad heredada de otro
 * negocio, nunca la de Segolife) como titular del sitio. Este test protege
 * contra que esa identidad — o cualquier otra entidad legada (Skicenter,
 * Náyade) — vuelva a aparecer como titular legal de Segolife.
 *
 * PublicLayout se mockea de forma superficial: lo que se prueba aquí es el
 * contenido legal propio de la página, no el chrome heredado (nav/footer/
 * WhatsApp) que arrastra PublicLayout.
 */
vi.mock("@/components/PublicLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import TerminosCondiciones from "./TerminosCondiciones";

describe("TerminosCondiciones — identidad legal (HAYQUE CAPITAL, S.L.)", () => {
  it("identifica a HAYQUE CAPITAL, S.L. con su CIF y domicilio reales como titular del sitio", () => {
    render(<TerminosCondiciones />);
    expect(screen.getByText("HAYQUE CAPITAL, S.L.")).toBeInTheDocument();
    expect(screen.getByText("B13989264")).toBeInTheDocument();
    expect(screen.getByText(/Finca Lindaraja, s\/n/)).toBeInTheDocument();
  });

  it("nunca muestra una identidad legal heredada de otro negocio (Iron Elephant, Náyade, Skicenter)", () => {
    render(<TerminosCondiciones />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Iron Elephant/i);
    expect(text).not.toMatch(/B26987875/);
    expect(text).not.toMatch(/Nayade Experiences/i);
    expect(text).not.toMatch(/administracion@skicenter\.es/i);
    expect(text).not.toMatch(/reservas@nayadeexperiences\.es/i);
  });
});
