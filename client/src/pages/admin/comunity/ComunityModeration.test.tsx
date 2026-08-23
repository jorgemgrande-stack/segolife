/**
 * ComunityModeration.test.tsx — MG-04. Corrección mínima real encontrada en
 * la auditoría (spec §20): venueId ya se guardaba pero nunca se mostraba
 * resuelto a Admin; coverImageUrl/urgency son campos nuevos que Admin debe
 * poder ver para moderar con contexto completo. Primer test de este fichero.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// MG-05 — jsdom no implementa estos métodos de puntero/scroll que usa
// internamente @radix-ui/react-select (selector "Tipo de pregunta" del
// diálogo de conversión) — mismo polyfill ya establecido en Register.test.tsx.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const { mockListStudentProposals, mockConvertMutate } = vi.hoisted(() => ({
  mockListStudentProposals: vi.fn(),
  mockConvertMutate: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    community: {
      listStudentProposals: { useQuery: mockListStudentProposals },
      approveStudentProposal: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      rejectStudentProposal: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      convertStudentProposalToFormal: { useMutation: () => ({ mutate: mockConvertMutate, isPending: false }) },
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
    suggestedDate: null, votingClosesAt: null,
    proposedQuestionType: null, proposedOptions: null,
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

  // Timing preciso (2026-08-23) — antes se mostraba la fecha sugerida como
  // string sin formatear ("Fecha sugerida: 2027-03-20") sin hora alguna;
  // ahora se formatea con fmtDateTime (mismo helper que el resto de
  // COMUNITY) y se añade el nuevo plazo de cierre de apoyo.
  it("muestra la fecha del evento formateada (día+hora) cuando el Student la propuso", () => {
    mockListStudentProposals.mockReturnValue({
      data: { items: [baseIdea({ suggestedDate: new Date("2027-03-20T19:30:00.000Z") })] },
      isLoading: false,
    });
    render(<ComunityModeration />);
    expect(screen.getByText(/Fecha del evento:/)).toBeInTheDocument();
  });

  it("muestra el plazo de cierre de apoyo cuando el Student lo propuso", () => {
    mockListStudentProposals.mockReturnValue({
      data: { items: [baseIdea({ votingClosesAt: new Date("2027-03-15T10:00:00.000Z") })] },
      isLoading: false,
    });
    render(<ComunityModeration />);
    expect(screen.getByText(/Apoyo hasta:/)).toBeInTheDocument();
  });

  it("sin fecha de evento ni plazo de cierre, no muestra ninguno de los dos", () => {
    mockListStudentProposals.mockReturnValue({ data: { items: [baseIdea()] }, isLoading: false });
    render(<ComunityModeration />);
    expect(screen.queryByText(/Fecha del evento:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Apoyo hasta:/)).not.toBeInTheDocument();
  });

  it("sin urgencia indicada, no muestra ningún badge de urgencia", () => {
    mockListStudentProposals.mockReturnValue({ data: { items: [baseIdea()] }, isLoading: false });
    render(<ComunityModeration />);
    expect(screen.queryByText(/sin prisa|pronto|urgente/i)).not.toBeInTheDocument();
  });
});

describe("ComunityModeration — MG-05: configuración de voto propuesta por el Student", () => {
  it("sin configuración propuesta, no muestra ningún bloque de tipo de respuesta", () => {
    mockListStudentProposals.mockReturnValue({ data: { items: [baseIdea()] }, isLoading: false });
    render(<ComunityModeration />);
    expect(screen.queryByText(/tipo de respuesta propuesto/i)).not.toBeInTheDocument();
  });

  it("muestra el tipo de respuesta propuesto y sus opciones de forma legible (spec §11)", () => {
    mockListStudentProposals.mockReturnValue({
      data: { items: [baseIdea({ proposedQuestionType: "single_choice", proposedOptions: ["Jueves", "Viernes", "Sábado"] })] },
      isLoading: false,
    });
    render(<ComunityModeration />);
    expect(screen.getByText(/tipo de respuesta propuesto: elección única/i)).toBeInTheDocument();
    expect(screen.getByText("Jueves")).toBeInTheDocument();
    expect(screen.getByText("Viernes")).toBeInTheDocument();
    expect(screen.getByText("Sábado")).toBeInTheDocument();
  });

  it("un tipo sin opciones (p.ej. yes_no) muestra el tipo pero ninguna lista de opciones", () => {
    mockListStudentProposals.mockReturnValue({
      data: { items: [baseIdea({ proposedQuestionType: "yes_no" })] },
      isLoading: false,
    });
    render(<ComunityModeration />);
    expect(screen.getByText(/tipo de respuesta propuesto: sí \/ no/i)).toBeInTheDocument();
    expect(document.querySelector("ul")).not.toBeInTheDocument();
  });

  it("el diálogo de conversión se pre-rellena con lo que el Student propuso (spec §12 — sigue siendo editable, no una orden)", async () => {
    const user = userEvent.setup();
    mockListStudentProposals.mockReturnValue({
      data: { items: [baseIdea({ status: "approved", proposedQuestionType: "single_choice", proposedOptions: ["Jueves", "Viernes"] })] },
      isLoading: false,
    });
    render(<ComunityModeration />);

    // Cambiar el filtro de estado a "Aprobadas" para que aparezca el botón de convertir.
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Aprobadas" }));

    await user.click(await screen.findByRole("button", { name: /convertir en propuesta formal/i }));

    // El diálogo abre con el tipo YA seleccionado (no el default "Sí / No").
    expect(await screen.findByText("Elección única")).toBeInTheDocument();
    const optionInputs = screen.getAllByPlaceholderText(/^Opción \d/i) as HTMLInputElement[];
    expect(optionInputs.map(i => i.value)).toEqual(["Jueves", "Viernes"]);

    // El Admin sigue pudiendo editarlo antes de convertir — nunca una orden fija.
    await user.clear(optionInputs[0]);
    await user.type(optionInputs[0], "Domingo");
    await user.click(screen.getByRole("button", { name: "Convertir" }));
    expect(mockConvertMutate).toHaveBeenCalledWith({
      studentProposalId: 1, questionType: "single_choice", options: ["Domingo", "Viernes"],
    });
  });

  it("sin configuración propuesta por el Student, el diálogo de conversión abre con el default de siempre (Sí/No, sin opciones)", async () => {
    const user = userEvent.setup();
    mockListStudentProposals.mockReturnValue({
      data: { items: [baseIdea({ status: "approved" })] },
      isLoading: false,
    });
    render(<ComunityModeration />);
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Aprobadas" }));
    await user.click(await screen.findByRole("button", { name: /convertir en propuesta formal/i }));
    expect(await screen.findByText("Sí / No")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/^Opción \d/i)).not.toBeInTheDocument();
  });
});
