/**
 * ExecutiveBriefPanel.test.tsx — Fase 14, spec §21/§22/§36. Sin IA siempre
 * visible, recomendaciones SIEMPRE etiquetadas como tales (nunca como hecho).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const { mockBriefQuery } = vi.hoisted(() => ({ mockBriefQuery: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: { dashboard: { getExecutiveBrief: { useQuery: mockBriefQuery } } } }));
vi.mock("wouter", () => ({ Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import { ExecutiveBriefPanel } from "./ExecutiveBriefPanel";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ExecutiveBriefPanel", () => {
  it("siempre muestra el badge 'SIN IA · determinista', incluso con datos cargados", () => {
    mockBriefQuery.mockReturnValue({ data: { brief: { aiProviderConnected: false, sentences: ["No hay alertas activas."] }, recommendations: [] }, isLoading: false, error: null });
    render(<ExecutiveBriefPanel filters={{}} />);
    expect(screen.getByText(/SIN IA/)).toBeInTheDocument();
  });

  it("renderiza cada frase real del resumen", () => {
    mockBriefQuery.mockReturnValue({
      data: { brief: { aiProviderConnected: false, sentences: ["Hoy hay 3 eventos activos.", "No hay alertas activas."] }, recommendations: [] },
      isLoading: false, error: null,
    });
    render(<ExecutiveBriefPanel filters={{}} />);
    expect(screen.getByText("Hoy hay 3 eventos activos.")).toBeInTheDocument();
    expect(screen.getByText("No hay alertas activas.")).toBeInTheDocument();
  });

  it("cada recomendación se etiqueta SIEMPRE como 'RECOMENDACIÓN', nunca se presenta como un hecho", () => {
    mockBriefQuery.mockReturnValue({
      data: {
        brief: { aiProviderConnected: false, sentences: [] },
        recommendations: [{ id: "low_recurrence", title: "Considerar una campaña de recurrencia", why: "Solo el 10% de los 50 Students activos son recurrentes.", possibleAction: "Abrir Campañas de SegoTokens", deepLink: "/admin/tokens/campaigns" }],
      },
      isLoading: false, error: null,
    });
    render(<ExecutiveBriefPanel filters={{}} />);
    expect(screen.getByText("RECOMENDACIÓN")).toBeInTheDocument();
    expect(screen.getByText("Considerar una campaña de recurrencia")).toBeInTheDocument();
    expect(screen.getByText(/Solo el 10% de los 50 Students/)).toBeInTheDocument();
  });

  it("cada recomendación enlaza a un módulo canónico real, nunca ejecuta nada por sí sola", () => {
    mockBriefQuery.mockReturnValue({
      data: {
        brief: { aiProviderConnected: false, sentences: [] },
        recommendations: [{ id: "low_recurrence", title: "X", why: "Y", possibleAction: "Abrir Campañas de SegoTokens", deepLink: "/admin/tokens/campaigns" }],
      },
      isLoading: false, error: null,
    });
    render(<ExecutiveBriefPanel filters={{}} />);
    const link = screen.getByText(/Abrir Campañas de SegoTokens/).closest("a");
    expect(link).toHaveAttribute("href", "/admin/tokens/campaigns");
  });

  it("sin recomendaciones, no muestra la sección de recomendaciones", () => {
    mockBriefQuery.mockReturnValue({ data: { brief: { aiProviderConnected: false, sentences: ["No hay alertas activas."] }, recommendations: [] }, isLoading: false, error: null });
    render(<ExecutiveBriefPanel filters={{}} />);
    expect(screen.queryByText("Recomendaciones")).not.toBeInTheDocument();
  });

  it("error de red -> mensaje real", () => {
    mockBriefQuery.mockReturnValue({ data: undefined, isLoading: false, error: { message: "Network error" } });
    render(<ExecutiveBriefPanel filters={{}} />);
    expect(screen.getByText(/No se pudo calcular el resumen/)).toBeInTheDocument();
  });
});
