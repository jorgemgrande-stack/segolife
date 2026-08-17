import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Route } from "wouter";
import i18n from "@/lib/i18n";

/**
 * ComunityHub.test.tsx — Fase 16 (auditoría). Antes de este fix, esta página
 * estaba enteramente en español hardcodeado (sin useTranslation en
 * absoluto) — un Student de IE (defaultLocale "en") la veía en español pese
 * a que el resto de la Student App (Explore, Tickets, Rewards...) es
 * bilingüe. Esta prueba verifica específicamente que cambiar el idioma
 * activo SÍ cambia lo que se renderiza — la regresión concreta que hacía
 * este bug real (no solo "el texto existe", sino "el texto responde al
 * idioma").
 */
const { mockMyActive, noopQuery, noopMutation } = vi.hoisted(() => ({
  mockMyActive: vi.fn(),
  noopQuery: () => ({ data: undefined, isLoading: false }),
  noopMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    community: {
      myActive: { useQuery: mockMyActive },
      myResponded: { useQuery: noopQuery },
      myProposals: { useQuery: noopQuery },
      trending: { useQuery: noopQuery },
      respond: { useMutation: noopMutation },
      submitProposal: { useMutation: noopMutation },
    },
    tokens: { previewMyReward: { useQuery: noopQuery } },
    useUtils: () => ({
      community: {
        myActive: { invalidate: vi.fn() },
        myResponded: { invalidate: vi.fn() },
        myProposals: { invalidate: vi.fn() },
      },
    }),
    auth: {
      // requireAuth: ComunityHub exige sesión (Community/voto es una
      // funcionalidad autenticada, ver spec) — a diferencia de Home.tsx/
      // CommunityLanding, que sí es público. Sesión simulada aquí.
      me: { useQuery: () => ({ data: { id: 42, name: "Ana", email: "ana@ie.edu" }, isLoading: false }) },
      logout: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    home: { getSummary: { useQuery: noopQuery } },
    studentNotifications: { unreadCount: { useQuery: noopQuery } },
    students: { me: { useQuery: noopQuery } },
    communities: { list: { useQuery: noopQuery }, myMemberships: { useQuery: noopQuery } },
    config: { getPublicSettings: { useQuery: noopQuery } },
  },
}));

vi.mock("@/contexts/CommunityContext", () => ({
  useCommunity: () => ({
    community: { id: 1, slug: "ie", name: "Segolife IE" },
    slug: "ie",
    defaultLocale: "en",
    availableLocales: ["en", "es"],
    loading: false,
    error: null,
  }),
}));

import ComunityHub from "./ComunityHub";

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(
    <Route path="/:community/comunity">
      <ComunityHub />
    </Route>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMyActive.mockReturnValue({ data: [], isLoading: false });
});

afterEach(() => {
  cleanup();
  i18n.changeLanguage("es");
});

describe("ComunityHub — i18n (Fase 16, DELIVERY BLOCKER corregido)", () => {
  it("en inglés (comunidad IE), las pestañas y el estado vacío se renderizan en inglés, nunca en español hardcodeado", async () => {
    await i18n.changeLanguage("en");
    renderAt("/ie/comunity");
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Responded")).toBeInTheDocument();
    expect(screen.getByText("Results")).toBeInTheDocument();
    expect(screen.getByText("Propose")).toBeInTheDocument();
    expect(screen.getByText("No active questions right now")).toBeInTheDocument();
    expect(screen.queryByText("Activas")).not.toBeInTheDocument();
    expect(screen.queryByText("Sin preguntas activas ahora mismo")).not.toBeInTheDocument();
  });

  it("en español (comunidad UVA), las mismas pestañas se renderizan en español", async () => {
    await i18n.changeLanguage("es");
    renderAt("/ie/comunity");
    expect(screen.getByText("Activas")).toBeInTheDocument();
    expect(screen.getByText("Sin preguntas activas ahora mismo")).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });

  it("una pregunta activa real muestra su tipo traducido, no el texto español fijo de lib/comunity.ts", async () => {
    await i18n.changeLanguage("en");
    mockMyActive.mockReturnValue({
      data: [{ id: 1, title: "Beach party?", questionType: "yes_no", endsAt: new Date(Date.now() + 3600_000), urgencyType: null }],
      isLoading: false,
    });
    renderAt("/ie/comunity");
    expect(screen.getByText(/Yes \/ No/)).toBeInTheDocument();
    expect(screen.queryByText(/Sí \/ No/)).not.toBeInTheDocument();
  });
});
