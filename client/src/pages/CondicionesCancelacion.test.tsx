import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * CondicionesCancelacion.test.tsx — PRE-16.15, mismo criterio que
 * TerminosCondiciones.test.tsx: protege contra que "Nayade Experiences" (u
 * otra entidad heredada) vuelva a aparecer como la parte contratante en las
 * condiciones de cancelación públicas.
 */
vi.mock("@/components/PublicLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import CondicionesCancelacion from "./CondicionesCancelacion";

describe("CondicionesCancelacion — identidad legal (HAYQUE CAPITAL, S.L.)", () => {
  it("nunca identifica a Nayade Experiences, Skicenter u otra entidad heredada como la parte contratante", () => {
    render(<CondicionesCancelacion />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Nayade Experiences/i);
    expect(text).not.toMatch(/reservas@nayadeexperiences\.es/i);
    expect(text).not.toMatch(/skicenter\.es\/solicitar-anulacion/i);
    expect(text.match(/HAYQUE CAPITAL, S\.L\./g)?.length ?? 0).toBeGreaterThan(0);
  });
});
