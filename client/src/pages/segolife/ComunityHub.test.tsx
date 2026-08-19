import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
const { mockMyActive, mockSubmitProposal, mockVenuesPublicActive, noopQuery, noopMutation } = vi.hoisted(() => ({
  mockMyActive: vi.fn(),
  mockSubmitProposal: vi.fn(),
  mockVenuesPublicActive: vi.fn(),
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
      submitProposal: { useMutation: mockSubmitProposal },
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
