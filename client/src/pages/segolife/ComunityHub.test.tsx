import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route } from "wouter";
import i18n from "@/lib/i18n";

// MG-05 — jsdom no implementa estos métodos de puntero/scroll que usa
// internamente @radix-ui/react-select (selector de tipo de voto, nuevo en
// esta fase) — mismo polyfill ya establecido en Register.test.tsx.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

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
const { mockMyActive, mockSubmitProposal, mockVenuesPublicActive, mockMyProposals, mockRespond, noopQuery, noopMutation } = vi.hoisted(() => ({
  mockMyActive: vi.fn(),
  mockSubmitProposal: vi.fn(),
  mockVenuesPublicActive: vi.fn(),
  mockMyProposals: vi.fn(),
  mockRespond: vi.fn(),
  noopQuery: () => ({ data: undefined, isLoading: false }),
  noopMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    community: {
      myActive: { useQuery: mockMyActive },
      myResponded: { useQuery: noopQuery },
      myProposals: { useQuery: mockMyProposals },
      trending: { useQuery: noopQuery },
      respond: { useMutation: mockRespond },
      submitProposal: { useMutation: mockSubmitProposal },
      // F68 (Community Engagement avanzado) — SavedProposalsSheet ahora se renderiza siempre en el Hub (bottom sheet de cabecera).
      myBookmarks: { useQuery: noopQuery },
    },
    venues: { publicActive: { useQuery: mockVenuesPublicActive } },
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
  mockVenuesPublicActive.mockReturnValue({ data: [{ id: 5, name: "Casanova" }, { id: 6, name: "Tía Felisa" }], isLoading: false });
  mockSubmitProposal.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockMyProposals.mockReturnValue({ data: undefined, isLoading: false });
  mockRespond.mockReturnValue({ mutate: vi.fn(), isPending: false });
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  i18n.changeLanguage("es");
  vi.unstubAllGlobals();
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

describe("ComunityHub — ProponerTab: extensión Community Proposals (venue + fecha sugerida)", () => {
  async function openProposeTab() {
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /^propose$|^proponer$/i }));
    return user;
  }

  it("el desplegable de venue ofrece los venues reales de la comunidad, nunca hardcodeados", async () => {
    await i18n.changeLanguage("en");
    renderAt("/ie/comunity");
    await openProposeTab();
    expect(mockVenuesPublicActive).toHaveBeenCalledWith({ communityId: 1 });
    expect(screen.getByText(/related venue/i)).toBeInTheDocument();
  });

  it("el envío incluye venueId y suggestedDate cuando el Student los rellena — nunca comunidad/scope/moderación (nunca expuestos en el formulario)", async () => {
    await i18n.changeLanguage("en");
    const mockMutate = vi.fn();
    mockSubmitProposal.mockReturnValue({ mutate: mockMutate, isPending: false });
    renderAt("/ie/comunity");
    const user = await openProposeTab();

    await user.type(screen.getByPlaceholderText(/padel tournament/i), "Beach volleyball");
    await user.click(screen.getByRole("button", { name: /this weekend/i }));
    await user.click(screen.getByRole("button", { name: /submit idea/i }));

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      communityId: 1,
      title: "Beach volleyball",
      venueId: null, // no se seleccionó venue en este test — sigue siendo opcional
      suggestedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }));
    // El payload nunca incluye claves reservadas al Admin (comunidad ya va
    // como communityId real de la sesión, nunca un selector propio del
    // formulario — no hay ningún control de "alcance"/"audiencia" en el DOM).
    expect(screen.queryByText(/administrative scope|alcance administrativo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/audience|audiencia/i)).not.toBeInTheDocument();
  });

  it("sin rellenar la fecha sugerida, se envía null — nunca una fecha inventada", async () => {
    await i18n.changeLanguage("en");
    const mockMutate = vi.fn();
    mockSubmitProposal.mockReturnValue({ mutate: mockMutate, isPending: false });
    renderAt("/ie/comunity");
    const user = await openProposeTab();

    await user.type(screen.getByPlaceholderText(/padel tournament/i), "Movie night");
    await user.click(screen.getByRole("button", { name: /submit idea/i }));

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({ suggestedDate: null }));
  });
});

describe("ComunityHub — ProponerTab MG-04: imagen de portada (spec §11)", () => {
  async function openProposeTab() {
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /^propose$|^proponer$/i }));
    return user;
  }

  it("sube una imagen válida vía POST /api/community/proposal-image y la incluye en el envío", async () => {
    await i18n.changeLanguage("en");
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, url: "https://cdn.example.com/community-proposals/42/abc.jpg" }),
    });
    const mockMutate = vi.fn();
    mockSubmitProposal.mockReturnValue({ mutate: mockMutate, isPending: false });
    renderAt("/ie/comunity");
    const user = await openProposeTab();

    const file = new File(["fake-image-bytes"], "cover.jpg", { type: "image/jpeg" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    await user.upload(input, file);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      "/api/community/proposal-image",
      expect.objectContaining({ method: "POST", credentials: "include" })
    ));
    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options.body).toBeInstanceOf(FormData);

    // La preview reemplaza el botón "Add image" por uno de quitar.
    await screen.findByRole("button", { name: /remove image/i });

    await user.type(screen.getByPlaceholderText(/padel tournament/i), "Sunset picnic");
    await user.click(screen.getByRole("button", { name: /submit idea/i }));
    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      coverImageUrl: "https://cdn.example.com/community-proposals/42/abc.jpg",
    }));
  });

  it("tipo de archivo no permitido: rechazado en el cliente antes de llamar a fetch", async () => {
    await i18n.changeLanguage("en");
    renderAt("/ie/comunity");
    const user = await openProposeTab();
    const file = new File(["<svg></svg>"], "cover.svg", { type: "image/svg+xml" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /remove image/i })).not.toBeInTheDocument();
  });

  it("quitar la imagen tras subirla vuelve a mostrar 'Add image' y el envío ya no incluye coverImageUrl", async () => {
    await i18n.changeLanguage("en");
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, url: "https://cdn.example.com/community-proposals/42/abc.jpg" }),
    });
    const mockMutate = vi.fn();
    mockSubmitProposal.mockReturnValue({ mutate: mockMutate, isPending: false });
    renderAt("/ie/comunity");
    const user = await openProposeTab();

    const file = new File(["fake-image-bytes"], "cover.jpg", { type: "image/jpeg" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    const removeBtn = await screen.findByRole("button", { name: /remove image/i });
    await user.click(removeBtn);

    expect(screen.getByRole("button", { name: /add image/i })).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/padel tournament/i), "Sin imagen");
    await user.click(screen.getByRole("button", { name: /submit idea/i }));
    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({ coverImageUrl: null }));
  });

  it("sin imagen ni al servidor responder distinto, el error de subida (500) nunca bloquea seguir usando el formulario", async () => {
    await i18n.changeLanguage("en");
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({ error: "upload_failed" }) });
    renderAt("/ie/comunity");
    const user = await openProposeTab();
    const file = new File(["fake-image-bytes"], "cover.jpg", { type: "image/jpeg" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /add image/i })).toBeInTheDocument();
  });
});

describe("ComunityHub — ProponerTab MG-04: urgencia del Student (spec §16)", () => {
  async function openProposeTab() {
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /^propose$|^proponer$/i }));
    return user;
  }

  it("seleccionar un nivel de urgencia lo incluye en el envío", async () => {
    await i18n.changeLanguage("en");
    const mockMutate = vi.fn();
    mockSubmitProposal.mockReturnValue({ mutate: mockMutate, isPending: false });
    renderAt("/ie/comunity");
    const user = await openProposeTab();

    await user.type(screen.getByPlaceholderText(/padel tournament/i), "Ping pong league");
    await user.click(screen.getByRole("button", { name: /^urgent$/i }));
    await user.click(screen.getByRole("button", { name: /submit idea/i }));

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({ urgency: "urgent" }));
  });

  it("pulsar la misma urgencia dos veces la deselecciona — se envía null", async () => {
    await i18n.changeLanguage("en");
    const mockMutate = vi.fn();
    mockSubmitProposal.mockReturnValue({ mutate: mockMutate, isPending: false });
    renderAt("/ie/comunity");
    const user = await openProposeTab();

    await user.type(screen.getByPlaceholderText(/padel tournament/i), "Ping pong league");
    const soonBtn = screen.getByRole("button", { name: /^soon$/i });
    await user.click(soonBtn);
    await user.click(soonBtn);
    await user.click(screen.getByRole("button", { name: /submit idea/i }));

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({ urgency: null }));
  });

  it("sin seleccionar urgencia, se envía null — nunca un valor por defecto inventado", async () => {
    await i18n.changeLanguage("en");
    const mockMutate = vi.fn();
    mockSubmitProposal.mockReturnValue({ mutate: mockMutate, isPending: false });
    renderAt("/ie/comunity");
    const user = await openProposeTab();
    await user.type(screen.getByPlaceholderText(/padel tournament/i), "No urgency chosen");
    await user.click(screen.getByRole("button", { name: /submit idea/i }));
    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({ urgency: null }));
  });

  it("los 3 niveles de urgencia se renderizan traducidos en español", async () => {
    await i18n.changeLanguage("es");
    renderAt("/ie/comunity");
    await openProposeTab();
    expect(screen.getByRole("button", { name: /sin prisa/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^pronto$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^urgente$/i })).toBeInTheDocument();
  });

  it("el payload de envío nunca incluye campos reservados de admin (comunidad/estado/prioridad interna) aunque haya imagen y urgencia", async () => {
    await i18n.changeLanguage("en");
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, json: async () => ({ success: true, url: "https://cdn.example.com/x.jpg" }),
    });
    const mockMutate = vi.fn();
    mockSubmitProposal.mockReturnValue({ mutate: mockMutate, isPending: false });
    renderAt("/ie/comunity");
    const user = await openProposeTab();

    const file = new File(["fake-image-bytes"], "cover.jpg", { type: "image/jpeg" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    await screen.findByRole("button", { name: /remove image/i });
    await user.click(screen.getByRole("button", { name: /^urgent$/i }));
    await user.type(screen.getByPlaceholderText(/padel tournament/i), "Con imagen y urgencia");
    await user.click(screen.getByRole("button", { name: /submit idea/i }));

    const payload = mockMutate.mock.calls[0][0];
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("approved");
    expect(payload).not.toHaveProperty("moderationNotes");
    expect(payload).not.toHaveProperty("priority");
    expect(payload).not.toHaveProperty("segoTokens");
    expect(payload.communityId).toBe(1);
  });
});

describe("ComunityHub — ProponerTab MG-05: configuración de voto propuesta", () => {
  async function openProposeTab() {
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /^propose$|^proponer$/i }));
    return user;
  }
  async function fillTitleAndSubmit(user: ReturnType<typeof userEvent.setup>, title: string) {
    await user.type(screen.getByPlaceholderText(/padel tournament/i), title);
    await user.click(screen.getByRole("button", { name: /submit idea/i }));
  }

  it("por defecto (sin tocar el selector), no se propone ningún tipo de voto — proponerlo es siempre opcional", async () => {
    await i18n.changeLanguage("en");
    const mockMutate = vi.fn();
    mockSubmitProposal.mockReturnValue({ mutate: mockMutate, isPending: false });
    renderAt("/ie/comunity");
    const user = await openProposeTab();
    await fillTitleAndSubmit(user, "Sin config de voto");
    const payload = mockMutate.mock.calls[0][0];
    expect(payload.proposedQuestionType).toBeUndefined();
    expect(payload.proposedOptions).toBeUndefined();
  });

  it("Sí/No: no requiere configuración manual, se envía tal cual", async () => {
    await i18n.changeLanguage("en");
    const mockMutate = vi.fn();
    mockSubmitProposal.mockReturnValue({ mutate: mockMutate, isPending: false });
    renderAt("/ie/comunity");
    const user = await openProposeTab();
    await user.click(screen.getByText(/how should the community respond/i).closest("div")!.querySelector("[role=combobox]")!);
    await user.click(await screen.findByRole("option", { name: /^yes \/ no$/i }));
    await fillTitleAndSubmit(user, "Yes/No idea");
    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({ proposedQuestionType: "yes_no", proposedOptions: undefined }));
  });

  it("Elección única: exige al menos 2 opciones — el botón queda deshabilitado con menos", async () => {
    await i18n.changeLanguage("en");
    renderAt("/ie/comunity");
    const user = await openProposeTab();
    await user.type(screen.getByPlaceholderText(/padel tournament/i), "Single choice idea");
    await user.click(screen.getByText(/how should the community respond/i).closest("div")!.querySelector("[role=combobox]")!);
    await user.click(await screen.findByRole("option", { name: /^single choice$/i }));

    const submitBtn = screen.getByRole("button", { name: /submit idea/i });
    expect(submitBtn).toBeDisabled();

    const optionInputs = screen.getAllByPlaceholderText(/^option \d/i);
    await user.type(optionInputs[0], "Thursday");
    expect(submitBtn).toBeDisabled(); // solo 1 opción rellena todavía

    await user.type(optionInputs[1], "Friday");
    expect(submitBtn).not.toBeDisabled();
  });

  it("Elección única: añadir opción crea un input extra, y las opciones se envían recortadas", async () => {
    await i18n.changeLanguage("en");
    const mockMutate = vi.fn();
    mockSubmitProposal.mockReturnValue({ mutate: mockMutate, isPending: false });
    renderAt("/ie/comunity");
    const user = await openProposeTab();
    await user.type(screen.getByPlaceholderText(/padel tournament/i), "Con 3 opciones");
    await user.click(screen.getByText(/how should the community respond/i).closest("div")!.querySelector("[role=combobox]")!);
    await user.click(await screen.findByRole("option", { name: /^single choice$/i }));

    await user.click(screen.getByRole("button", { name: /add option/i }));
    const optionInputs = screen.getAllByPlaceholderText(/^option \d/i);
    expect(optionInputs).toHaveLength(3);
    await user.type(optionInputs[0], "  Thursday  ");
    await user.type(optionInputs[1], "Friday");
    await user.type(optionInputs[2], "Saturday");
    await user.click(screen.getByRole("button", { name: /submit idea/i }));

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      proposedQuestionType: "single_choice",
      proposedOptions: ["Thursday", "Friday", "Saturday"],
    }));
  });

  it("Escala 0-100: acepta criterios válidos (misma UI de opciones, etiqueta distinta)", async () => {
    await i18n.changeLanguage("en");
    const mockMutate = vi.fn();
    mockSubmitProposal.mockReturnValue({ mutate: mockMutate, isPending: false });
    renderAt("/ie/comunity");
    const user = await openProposeTab();
    await user.type(screen.getByPlaceholderText(/padel tournament/i), "Escala idea");
    await user.click(screen.getByText(/how should the community respond/i).closest("div")!.querySelector("[role=combobox]")!);
    await user.click(await screen.findByRole("option", { name: /0-100 scale/i }));
    expect(screen.getByText(/criteria to score/i)).toBeInTheDocument();

    const optionInputs = screen.getAllByPlaceholderText(/^option \d/i);
    await user.type(optionInputs[0], "Ambience");
    await user.type(optionInputs[1], "Price");
    await user.click(screen.getByRole("button", { name: /submit idea/i }));

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      proposedQuestionType: "percentage_scale",
      proposedOptions: ["Ambience", "Price"],
    }));
  });

  it("Escala 1-5, Intención de asistencia, Me apunto y Texto abierto: ninguno pide opciones, todos se envían tal cual", async () => {
    await i18n.changeLanguage("en");
    for (const [optionName, expectedType] of [
      [/^1-5 scale$/i, "scale_1_5"],
      [/attendance intention/i, "attendance_intention"],
      [/^i'm in$/i, "me_apunto"],
      [/^open text$/i, "open_text"],
    ] as const) {
      cleanup();
      const mockMutate = vi.fn();
      mockSubmitProposal.mockReturnValue({ mutate: mockMutate, isPending: false });
      renderAt("/ie/comunity");
      const user = await openProposeTab();
      await user.type(screen.getByPlaceholderText(/padel tournament/i), `Idea ${expectedType}`);
      await user.click(screen.getByText(/how should the community respond/i).closest("div")!.querySelector("[role=combobox]")!);
      await user.click(await screen.findByRole("option", { name: optionName }));
      expect(screen.queryByPlaceholderText(/^option \d/i)).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /submit idea/i }));
      expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({ proposedQuestionType: expectedType, proposedOptions: undefined }));
    }
  });

  it("Selección múltiple y Ranking: ambos usan la misma UI de opciones que Elección única", async () => {
    await i18n.changeLanguage("en");
    for (const [optionName, expectedType] of [
      [/multiple choice/i, "multiselect"],
      [/^ranking$/i, "ranking"],
    ] as const) {
      cleanup();
      const mockMutate = vi.fn();
      mockSubmitProposal.mockReturnValue({ mutate: mockMutate, isPending: false });
      renderAt("/ie/comunity");
      const user = await openProposeTab();
      await user.type(screen.getByPlaceholderText(/padel tournament/i), `Idea ${expectedType}`);
      await user.click(screen.getByText(/how should the community respond/i).closest("div")!.querySelector("[role=combobox]")!);
      await user.click(await screen.findByRole("option", { name: optionName }));
      const optionInputs = screen.getAllByPlaceholderText(/^option \d/i);
      await user.type(optionInputs[0], "A");
      await user.type(optionInputs[1], "B");
      await user.click(screen.getByRole("button", { name: /submit idea/i }));
      expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({ proposedQuestionType: expectedType, proposedOptions: ["A", "B"] }));
    }
  });

  it("cambiar de un tipo con opciones a Sí/No limpia la configuración incompatible (nunca envía opciones huérfanas)", async () => {
    await i18n.changeLanguage("en");
    const mockMutate = vi.fn();
    mockSubmitProposal.mockReturnValue({ mutate: mockMutate, isPending: false });
    renderAt("/ie/comunity");
    const user = await openProposeTab();
    await user.type(screen.getByPlaceholderText(/padel tournament/i), "Cambio de tipo");
    const combobox = screen.getByText(/how should the community respond/i).closest("div")!.querySelector("[role=combobox]")!;
    await user.click(combobox);
    await user.click(await screen.findByRole("option", { name: /^single choice$/i }));
    const optionInputs = screen.getAllByPlaceholderText(/^option \d/i);
    await user.type(optionInputs[0], "Thursday");
    await user.type(optionInputs[1], "Friday");

    await user.click(combobox);
    await user.click(await screen.findByRole("option", { name: /^yes \/ no$/i }));
    expect(screen.queryByPlaceholderText(/^option \d/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /submit idea/i }));
    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({ proposedQuestionType: "yes_no", proposedOptions: undefined }));
  });

  it("'No proponer' vuelve a dejar la propuesta sin configuración de voto", async () => {
    await i18n.changeLanguage("en");
    const mockMutate = vi.fn();
    mockSubmitProposal.mockReturnValue({ mutate: mockMutate, isPending: false });
    renderAt("/ie/comunity");
    const user = await openProposeTab();
    await user.type(screen.getByPlaceholderText(/padel tournament/i), "Cambio a ninguno");
    const combobox = screen.getByText(/how should the community respond/i).closest("div")!.querySelector("[role=combobox]")!;
    await user.click(combobox);
    await user.click(await screen.findByRole("option", { name: /^yes \/ no$/i }));
    await user.click(combobox);
    await user.click(await screen.findByRole("option", { name: /don't propose/i }));
    await user.click(screen.getByRole("button", { name: /submit idea/i }));
    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({ proposedQuestionType: undefined, proposedOptions: undefined }));
  });

  it("seleccionar/configurar el tipo de voto nunca dispara ninguna llamada de red por sí solo (no otorga ST, no es una actividad aparte)", async () => {
    await i18n.changeLanguage("en");
    renderAt("/ie/comunity");
    const user = await openProposeTab();
    (global.fetch as ReturnType<typeof vi.fn>).mockClear();
    const combobox = screen.getByText(/how should the community respond/i).closest("div")!.querySelector("[role=combobox]")!;
    await user.click(combobox);
    await user.click(await screen.findByRole("option", { name: /^single choice$/i }));
    const optionInputs = screen.getAllByPlaceholderText(/^option \d/i);
    await user.type(optionInputs[0], "A");
    await user.click(screen.getByRole("button", { name: /add option/i }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("las ideas propias con voto propuesto muestran un resumen compacto en 'Your ideas'", async () => {
    await i18n.changeLanguage("en");
    mockMyProposals.mockReturnValue({
      data: [{ id: 9, title: "Beach party", status: "pending_moderation", supportCount: 2, proposedQuestionType: "yes_no" }],
      isLoading: false,
    });
    renderAt("/ie/comunity");
    await openProposeTab();
    expect(await screen.findByText(/voting: yes \/ no/i)).toBeInTheDocument();
  });
});

describe("ComunityHub — Bugfix 'impedir voto múltiple' (2026-08-22): la tarjeta se bloquea tras participar", () => {
  it("me_apunto ya participado (locked=true, servidor) → 'Already joined' bloqueado, aria-disabled, nunca dispara la mutación al pulsar", async () => {
    await i18n.changeLanguage("en");
    const mockMutate = vi.fn();
    mockRespond.mockReturnValue({ mutate: mockMutate, isPending: false });
    mockMyActive.mockReturnValue({
      data: [{ id: 1, title: "BBQ night", questionType: "me_apunto", endsAt: new Date(Date.now() + 3600_000), urgencyType: null, hasParticipated: true, locked: true, allowChangeResponse: true }],
      isLoading: false,
    });
    renderAt("/ie/comunity");

    const btn = screen.getByRole("button", { name: /already joined/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button", { name: /i'm in/i })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(btn);
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("me_apunto sin participar (locked=false) → 'I'm in' sigue activo, al pulsar llama a respond con el payload real", async () => {
    await i18n.changeLanguage("en");
    const mockMutate = vi.fn();
    mockRespond.mockReturnValue({ mutate: mockMutate, isPending: false });
    mockMyActive.mockReturnValue({
      data: [{ id: 1, title: "BBQ night", questionType: "me_apunto", endsAt: new Date(Date.now() + 3600_000), urgencyType: null, hasParticipated: false, locked: false, allowChangeResponse: true }],
      isLoading: false,
    });
    renderAt("/ie/comunity");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^🙋 i'm in$/i }));
    expect(mockMutate).toHaveBeenCalledWith({ proposalId: 1, payload: { questionType: "me_apunto" } });
  });

  it("yes_no ya participado (locked=true) → estado bloqueado en vez de Yes/No, nunca dispara la mutación", async () => {
    await i18n.changeLanguage("en");
    const mockMutate = vi.fn();
    mockRespond.mockReturnValue({ mutate: mockMutate, isPending: false });
    mockMyActive.mockReturnValue({
      data: [{ id: 2, title: "Beach party?", questionType: "yes_no", endsAt: new Date(Date.now() + 3600_000), urgencyType: null, hasParticipated: true, locked: true, allowChangeResponse: false }],
      isLoading: false,
    });
    renderAt("/ie/comunity");

    const btn = screen.getByRole("button", { name: /already answered/i });
    expect(btn).toBeDisabled();
    expect(screen.queryByRole("button", { name: /yes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^👎 no$/i })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(btn);
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("yes_no sin participar → Yes/No siguen activos como siempre (sin regresión)", async () => {
    await i18n.changeLanguage("en");
    const mockMutate = vi.fn();
    mockRespond.mockReturnValue({ mutate: mockMutate, isPending: false });
    mockMyActive.mockReturnValue({
      data: [{ id: 2, title: "Beach party?", questionType: "yes_no", endsAt: new Date(Date.now() + 3600_000), urgencyType: null, hasParticipated: false, locked: false, allowChangeResponse: true }],
      isLoading: false,
    });
    renderAt("/ie/comunity");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^👍 yes$/i }));
    expect(mockMutate).toHaveBeenCalledWith({ proposalId: 2, payload: { questionType: "yes_no", value: "yes" } });
  });

  it("un intento rechazado como ALREADY_RESPONDED (carrera/doble pestaña) refresca el feed y NO muestra un toast de error redundante", async () => {
    await i18n.changeLanguage("en");
    let capturedOnError: ((e: unknown) => void) | undefined;
    mockRespond.mockImplementation((opts: { onError?: (e: unknown) => void }) => {
      capturedOnError = opts?.onError;
      return { mutate: vi.fn(), isPending: false };
    });
    mockMyActive.mockReturnValue({
      data: [{ id: 1, title: "BBQ night", questionType: "me_apunto", endsAt: new Date(Date.now() + 3600_000), urgencyType: null, hasParticipated: false, locked: false, allowChangeResponse: true }],
      isLoading: false,
    });
    renderAt("/ie/comunity");

    expect(capturedOnError).toBeTypeOf("function");
    // No debe lanzar ni requerir más que refrescar el feed — la propia
    // tarjeta se bloqueará con el estado real en el siguiente fetch.
    expect(() => capturedOnError!({ message: "Ya has respondido a esta propuesta y no admite cambios", data: { domainCode: "ALREADY_RESPONDED" } })).not.toThrow();
  });
});
