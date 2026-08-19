/**
 * ComunityModeration.test.tsx — MG-04. Corrección mínima real encontrada en
 * la auditoría (spec §20): venueId ya se guardaba pero nunca se mostraba
 * resuelto a Admin; coverImageUrl/urgency son campos nuevos que Admin debe
 * poder ver para moderar con contexto completo. Primer test de este fichero.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const { mockListStudentProposals } = vi.hoisted(() => ({
  mockListStudentProposals: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    community: {
      listStudentProposals: { useQuery: mockListStudentProposals },
      approveStudentProposal: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      rejectStudentProposal: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      convertStudentProposalToFormal: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({ community: { listStudentProposals: { invalidate: vi.fn() } } }),
  },
}));
vi.mock("@/components/AdminLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/contexts/AdminCommunityContext", () => ({
  useAdminCommunity: () => ({ filter: "all", setFilter: vi.fn(), communities: [], loading: false }),
}));

import ComunityModeration from "./ComunityModeration";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function baseIdea(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, title: "Torneo de pádel", description: "Un torneo abierto", studentName: "Ana",
    createdAt: new Date("2026-08-15"), category: null, status: "pending_moderation",
    supportCount: 3, venueName: null, coverImageUrl: null, urgency: null,
    ...overrides,
  };
}

describe("ComunityModeration — visibilidad de imagen/venue/urgencia enviados por el Student (MG-04, spec §20)", () => {
  it("muestra la miniatura de la imagen de portada cuando la idea tiene una", () => {
    mockListStudentProposals.mockReturnValue({
      data: { items: [baseIdea({ coverImageUrl: "https://cdn.example.com/community-proposals/7/x.jpg" })] },
      isLoading: false,
    });
    render(<ComunityModeration />);
    // alt="" es deliberado (imagen decorativa dentro de una card ya
    // etiquetada por su título) — ARIA la excluye de role="img", así que se
    // consulta directamente por selector, no por rol.
    const img = document.querySelector("img");
    expect(img).toHaveAttribute("src", "https://cdn.example.com/community-proposals/7/x.jpg");
  });

  it("sin imagen, no renderiza ninguna miniatura (nunca un placeholder roto)", () => {
    mockListStudentProposals.mockReturnValue({ data: { items: [baseIdea()] }, isLoading: false });
    render(<ComunityModeration />);
    expect(document.querySelector("img")).not.toBeInTheDocument();
  });

  it("muestra el nombre del venue resuelto (gap real corregido — antes solo se guardaba venueId sin mostrarse)", () => {
    mockListStudentProposals.mockReturnValue({
      data: { items: [baseIdea({ venueName: "Pádel Indoor Segovia" })] },
      isLoading: false,
    });
    render(<ComunityModeration />);
    expect(screen.getByText(/Pádel Indoor Segovia/)).toBeInTheDocument();
  });

  it("muestra un badge de urgencia cuando el Student la indicó, traducido a texto legible", () => {
    mockListStudentProposals.mockReturnValue({
      data: { items: [baseIdea({ urgency: "urgent" })] },
      isLoading: false,
    });
    render(<ComunityModeration />);
    expect(screen.getByText("Urgente")).toBeInTheDocument();
  });

  it("sin urgencia indicada, no muestra ningún badge de urgencia", () => {
    mockListStudentProposals.mockReturnValue({ data: { items: [baseIdea()] }, isLoading: false });
    render(<ComunityModeration />);
    expect(screen.queryByText(/sin prisa|pronto|urgente/i)).not.toBeInTheDocument();
  });
});
