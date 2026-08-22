import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route } from "wouter";
import i18n from "@/lib/i18n";

/**
 * ComunityQuestionDetail.test.tsx — COM-02 (Community Social Results).
 * Mismo arnés que Activity.test.tsx (misma SegolifeAppShell requireAuth) —
 * reutilizado, no reinventado. Foco: la ficha SOCIAL de una propuesta
 * finalizada (autor/imagen/acciones/resultado destacado) y el sheet de
 * comentarios (crear/listar/responder/borrar el propio, nunca el ajeno).
 * El flujo de votación de una propuesta ACTIVA (VoteForm) es PRE-EXISTENTE
 * y no se toca en esta fase — un test de regresión mínimo confirma que
 * sigue intacto.
 */
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const {
  mockAuthMe, mockHomeSummary, mockStudentsMe, mockUseCommunity,
  mockGetPublicById, mockToggleLike, mockListComments, mockCreateComment, mockDeleteComment, mockRespond,
  mockGetPublicRespondents, mockPreviewMyReward,
  noopQuery,
} = vi.hoisted(() => ({
  mockAuthMe: vi.fn(),
  mockHomeSummary: vi.fn(),
  mockStudentsMe: vi.fn(),
  mockUseCommunity: vi.fn(),
  mockGetPublicById: vi.fn(),
  mockToggleLike: vi.fn(),
  mockListComments: vi.fn(),
  mockCreateComment: vi.fn(),
  mockDeleteComment: vi.fn(),
  mockRespond: vi.fn(),
  mockGetPublicRespondents: vi.fn(),
  mockPreviewMyReward: vi.fn(),
  noopQuery: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      me: { useQuery: mockAuthMe },
      logout: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    home: { getSummary: { useQuery: mockHomeSummary } },
    students: { me: { useQuery: mockStudentsMe } },
    studentNotifications: { unreadCount: { useQuery: noopQuery } },
    communities: { list: { useQuery: noopQuery }, myMemberships: { useQuery: noopQuery } },
    config: { getPublicSettings: { useQuery: noopQuery } },
    tokens: { previewMyReward: { useQuery: mockPreviewMyReward } },
    community: {
      getPublicById: { useQuery: mockGetPublicById },
      getPublicRespondents: { useQuery: mockGetPublicRespondents },
      toggleLike: { useMutation: mockToggleLike },
      listComments: { useQuery: mockListComments },
      createComment: { useMutation: mockCreateComment },
      deleteComment: { useMutation: mockDeleteComment },
      respond: { useMutation: mockRespond },
      myActive: { invalidate: vi.fn() },
      myResponded: { invalidate: vi.fn() },
    },
    useUtils: () => ({
      auth: { me: { setData: vi.fn() } },
      community: {
        getPublicById: { invalidate: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined), getData: vi.fn(), setData: vi.fn() },
        listComments: { invalidate: vi.fn() },
        myActive: { invalidate: vi.fn() },
        myResponded: { invalidate: vi.fn() },
      },
    }),
  },
}));

vi.mock("@/contexts/CommunityContext", () => ({
  useCommunity: mockUseCommunity,
}));

import ComunityQuestionDetail from "./ComunityQuestionDetail";

function mockAuthenticated() {
  mockAuthMe.mockReturnValue({ data: { id: 42, name: "Ana", email: "ana@ie.edu" }, isLoading: false });
}
function mockCommunity() {
  mockUseCommunity.mockReturnValue({
    community: { id: 1, slug: "ie", name: "Segolife IE", status: "active", defaultLocale: "en", availableLocales: ["en"] },
    slug: "ie", defaultLocale: "en", availableLocales: ["en"], loading: false, error: null,
  });
}

function proposalFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    proposal: {
      id: 5, title: "Tanker's official pre", description: "Segovia vuelve a llenarse de estudiantes",
      questionType: "me_apunto", status: "closed", coverImageUrl: null, venueName: "Tanker Events",
      endsAt: new Date("2026-08-20T22:00:00Z"), allowChangeResponse: false,
    },
    options: [],
    myResponse: { response: {}, values: [] },
    hasResponded: true,
    showSocialLayer: true,
    results: { totalResponses: 2, totalAudience: 5, participationRate: 40, meApunto: { count: 2 } },
    isOpen: false,
    author: null,
    liked: false,
    likeCount: 0,
    commentCount: 0,
    latestComment: null,
    ...overrides,
  };
}

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(
    <Route path="/:community/comunity/:id">
      <ComunityQuestionDetail />
    </Route>
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
  mockAuthenticated();
  mockCommunity();
  mockHomeSummary.mockReturnValue({ data: undefined, isLoading: false });
  mockStudentsMe.mockReturnValue({ data: undefined });
  mockPreviewMyReward.mockReturnValue({ data: { totalGuaranteedTokens: 0 } });
  mockGetPublicRespondents.mockReturnValue({ data: { total: 0, items: [] } });
  mockToggleLike.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockCreateComment.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockDeleteComment.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockRespond.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockListComments.mockReturnValue({ data: { total: 0, items: [] }, isLoading: false });
});

afterEach(() => {
  cleanup();
  i18n.changeLanguage("en");
});

describe("ComunityQuestionDetail — propuesta ACTIVA sin responder: el flujo de votación existente no se toca (regresión)", () => {
  it("una propuesta activa sin respuesta propia sigue mostrando VoteForm, nunca la ficha social", async () => {
    mockGetPublicById.mockReturnValue({
      data: proposalFixture({
        proposal: { ...proposalFixture().proposal, status: "active" },
        isOpen: true, myResponse: null, hasResponded: false, showSocialLayer: false,
      }),
      isLoading: false,
    });
    renderAt("/ie/comunity/5");
    expect(await screen.findByText(/i'm in/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/comments/i)).not.toBeInTheDocument();
  });
});

describe("ComunityQuestionDetail — COM-02B: propuesta ACTIVA pero ya respondida entra en la ficha social", () => {
  it("con showSocialLayer=true (activa + ya respondió) muestra la ficha social, no el VoteForm", async () => {
    mockGetPublicById.mockReturnValue({
      data: proposalFixture({
        proposal: { ...proposalFixture().proposal, status: "active" },
        isOpen: true, showSocialLayer: true, hasResponded: true,
      }),
      isLoading: false,
    });
    renderAt("/ie/comunity/5");
    expect(await screen.findByLabelText(/comments/i)).toBeInTheDocument();
    expect(screen.queryByText(/i'm in/i)).not.toBeInTheDocument();
  });

  it("muestra 'Voting open' + tiempo restante y 'You already participated' — nunca 'Voting finished' (spec §6/§20, no aparentar cierre)", async () => {
    mockGetPublicById.mockReturnValue({
      data: proposalFixture({
        proposal: { ...proposalFixture().proposal, status: "active", endsAt: new Date(Date.now() + 36 * 3600 * 1000) },
        isOpen: true, showSocialLayer: true, hasResponded: true,
      }),
      isLoading: false,
    });
    renderAt("/ie/comunity/5");
    expect(await screen.findByText("Voting open")).toBeInTheDocument();
    expect(await screen.findByText("You already participated")).toBeInTheDocument();
    expect(screen.queryByText("Voting finished")).not.toBeInTheDocument();
  });

  it("propuesta CERRADA sigue mostrando 'Voting finished' (regresión COM-02, spec §21)", async () => {
    mockGetPublicById.mockReturnValue({ data: proposalFixture(), isLoading: false }); // default: status="closed"
    renderAt("/ie/comunity/5");
    expect(await screen.findByText("Voting finished")).toBeInTheDocument();
  });

  it("muestra 'Your response: X' para un tipo simple (yes_no) sin perder el rastro del voto propio", async () => {
    mockGetPublicById.mockReturnValue({
      data: proposalFixture({
        proposal: { ...proposalFixture().proposal, status: "active", questionType: "yes_no", endsAt: new Date(Date.now() + 3600 * 1000) },
        isOpen: true, showSocialLayer: true, hasResponded: true,
        myResponse: { response: {}, values: [{ optionId: null, valueText: "yes", valueNumber: null }] },
      }),
      isLoading: false,
    });
    renderAt("/ie/comunity/5");
    expect(await screen.findByText(/Your response:.*Yes/)).toBeInTheDocument();
  });
});

describe("ComunityQuestionDetail — COM-02: ficha social de una propuesta FINALIZADA", () => {
  it("muestra el nombre del autor real cuando la propuesta viene de una idea de Student", async () => {
    mockGetPublicById.mockReturnValue({ data: proposalFixture({ author: { userId: 77, name: "Antonio Ruiz", hasAvatar: false } }), isLoading: false });
    renderAt("/ie/comunity/5");
    expect(await screen.findByText("Antonio Ruiz")).toBeInTheDocument();
  });

  it("cae al autor de marca SEGOLIFE cuando la propuesta la creó un admin directamente (spec §33, nunca expone identidad personal de admin)", async () => {
    mockGetPublicById.mockReturnValue({ data: proposalFixture({ author: null }), isLoading: false });
    renderAt("/ie/comunity/5");
    // "SEGOLIFE" también aparece en el logo de la sidebar — se comprueba
    // aparte, en la cabecera de autor, que NO sea vacío ni un nombre inventado.
    await screen.findAllByText("SEGOLIFE");
    const authorHeading = document.querySelector("p.truncate.font-semibold.text-foreground");
    expect(authorHeading).toHaveTextContent("SEGOLIFE");
  });

  it("muestra el resultado destacado calculado a partir del results real (me_apunto)", async () => {
    mockGetPublicById.mockReturnValue({ data: proposalFixture(), isLoading: false });
    renderAt("/ie/comunity/5");
    expect(await screen.findByText(/2 attended/i)).toBeInTheDocument();
  });

  it("propuesta sin imagen de portada: fallback de marca con el título dentro del área de imagen, nunca una foto ficticia (spec §32)", async () => {
    mockGetPublicById.mockReturnValue({ data: proposalFixture(), isLoading: false });
    renderAt("/ie/comunity/5");
    // El título aparece dos veces cuando no hay portada: dentro del fallback
    // de marca (área de imagen) Y en el bloque título/descripción de abajo —
    // exactamente 1 vez significaría que el fallback no se está renderizando.
    const headings = await screen.findAllByText("Tanker's official pre");
    expect(headings.length).toBe(2);
  });
});

describe("ComunityQuestionDetail — COM-02C: pulido social (sin card 'Results (N)', participantes compactos, último comentario)", () => {
  it("nunca muestra la card administrativa 'Results (N)' — el desglose va directo en el post (spec §8/§14)", async () => {
    mockGetPublicById.mockReturnValue({ data: proposalFixture(), isLoading: false });
    renderAt("/ie/comunity/5");
    await screen.findByText(/2 attended/i);
    expect(screen.queryByText("Results (2)")).not.toBeInTheDocument();
  });

  it("participantes (me_apunto) se muestran como avatar-stack + 'joined', nunca '2 joining' como titular aparte", async () => {
    mockGetPublicRespondents.mockReturnValue({ data: { total: 2, items: [{ userId: 4, name: "Antonio Ruiz", hasAvatar: false }, { userId: 7, name: "Cristina", hasAvatar: false }] } });
    mockGetPublicById.mockReturnValue({ data: proposalFixture(), isLoading: false });
    renderAt("/ie/comunity/5");
    expect(await screen.findByText(/Antonio, Cristina joined/i)).toBeInTheDocument();
    expect(screen.queryByText(/^2 joining$/i)).not.toBeInTheDocument();
  });

  it("el último comentario visible aparece directamente en la ficha (avatar+nombre+tiempo+texto)", async () => {
    mockGetPublicById.mockReturnValue({
      data: proposalFixture({
        commentCount: 1,
        latestComment: { id: 1, content: "Qué ganas de que llegue, va a ser épico", createdAt: new Date(Date.now() - 2 * 3600 * 1000), author: { userId: 9, name: "Cristina B.", hasAvatar: false } },
      }),
      isLoading: false,
    });
    renderAt("/ie/comunity/5");
    expect(await screen.findByText("Cristina B.")).toBeInTheDocument();
    expect(await screen.findByText("Qué ganas de que llegue, va a ser épico")).toBeInTheDocument();
  });

  it("con exactamente 1 comentario muestra 'View comment' (singular) — nunca 'View all 1 comments' (spec §17)", async () => {
    mockGetPublicById.mockReturnValue({ data: proposalFixture({ commentCount: 1 }), isLoading: false });
    renderAt("/ie/comunity/5");
    expect(await screen.findByText("View comment")).toBeInTheDocument();
    expect(screen.queryByText(/view all 1 comments/i)).not.toBeInTheDocument();
  });

  it("con varios comentarios muestra 'View all N comments' (plural correcto)", async () => {
    mockGetPublicById.mockReturnValue({ data: proposalFixture({ commentCount: 7 }), isLoading: false });
    renderAt("/ie/comunity/5");
    expect(await screen.findByText("View all 7 comments")).toBeInTheDocument();
  });

  it("una descripción larga se recorta con '… more' y se expande por completo al pulsar", async () => {
    const longText = "Esta descripción es deliberadamente muy larga para forzar el recorte visual de varias líneas. ".repeat(4);
    mockGetPublicById.mockReturnValue({ data: proposalFixture({ proposal: { ...proposalFixture().proposal, description: longText } }), isLoading: false });
    const user = userEvent.setup();
    renderAt("/ie/comunity/5");
    const moreButton = await screen.findByText("… more");
    await user.click(moreButton);
    expect(screen.queryByText("… more")).not.toBeInTheDocument();
    expect(await screen.findAllByText(longText.trim(), { exact: false })).not.toHaveLength(0);
  });

  it("una descripción corta nunca muestra el botón '… more' (nada que expandir)", async () => {
    mockGetPublicById.mockReturnValue({ data: proposalFixture(), isLoading: false }); // descripción corta por defecto
    renderAt("/ie/comunity/5");
    await screen.findByText("Segovia vuelve a llenarse de estudiantes");
    expect(screen.queryByText("… more")).not.toBeInTheDocument();
  });
});

describe("ComunityQuestionDetail — COM-02: like social (nunca un voto, spec §35)", () => {
  it("pulsar el corazón llama a toggleLike con el proposalId real", async () => {
    const mutate = vi.fn();
    mockToggleLike.mockReturnValue({ mutate, isPending: false });
    mockGetPublicById.mockReturnValue({ data: proposalFixture(), isLoading: false });
    const user = userEvent.setup();
    renderAt("/ie/comunity/5");
    await user.click(await screen.findByLabelText(/like/i));
    expect(mutate).toHaveBeenCalledWith({ proposalId: 5 });
  });
});

describe("ComunityQuestionDetail — COM-02: sheet de comentarios", () => {
  it("sin comentarios: muestra 'Be the first to comment'", async () => {
    mockGetPublicById.mockReturnValue({ data: proposalFixture(), isLoading: false });
    const user = userEvent.setup();
    renderAt("/ie/comunity/5");
    await user.click(await screen.findByLabelText(/comments/i));
    // "Be the first to comment" aparece dos veces con la sheet abierta (el
    // CTA de fuera, que sigue montado detrás con aria-hidden, y el estado
    // vacío dentro de la propia sheet) — findAllBy en vez de findBy singular.
    expect(await screen.findByText(/no comments yet/i)).toBeInTheDocument();
    expect((await screen.findAllByText(/be the first to comment/i)).length).toBeGreaterThan(0);
  });

  it("lista un comentario raíz con su respuesta anidada, y muestra 'Delete' SOLO en el propio", async () => {
    mockGetPublicById.mockReturnValue({ data: proposalFixture(), isLoading: false });
    mockListComments.mockReturnValue({
      data: {
        total: 1,
        items: [{
          id: 1, proposalId: 5, content: "Qué buena idea", createdAt: new Date(), isOwn: true,
          author: { userId: 42, name: "Cristina", hasAvatar: false },
          replies: [{
            id: 2, proposalId: 5, content: "Totalmente de acuerdo", createdAt: new Date(), isOwn: false,
            author: { userId: 5, name: "Antonio", hasAvatar: false }, replies: [],
          }],
        }],
      },
      isLoading: false,
    });
    const user = userEvent.setup();
    renderAt("/ie/comunity/5");
    await user.click(await screen.findByLabelText(/comments/i));
    expect(await screen.findByText("Qué buena idea")).toBeInTheDocument();
    expect(screen.getByText("Totalmente de acuerdo")).toBeInTheDocument();
    // "Delete" (spec §15, solo el propio) — el comentario propio (Cristina) lo ofrece, la respuesta ajena (Antonio) no.
    expect(screen.getAllByText(/delete/i)).toHaveLength(1);
  });

  it("escribir y enviar un comentario llama a createComment con el contenido recortado", async () => {
    const mutate = vi.fn();
    mockCreateComment.mockReturnValue({ mutate, isPending: false });
    mockGetPublicById.mockReturnValue({ data: proposalFixture(), isLoading: false });
    const user = userEvent.setup();
    renderAt("/ie/comunity/5");
    await user.click(await screen.findByLabelText(/comments/i));
    const textarea = await screen.findByPlaceholderText(/write a comment/i);
    await user.type(textarea, "  Qué buena idea 😍  ");
    await user.click(screen.getByRole("button", { name: /post/i }));
    expect(mutate).toHaveBeenCalledWith({ proposalId: 5, content: "Qué buena idea 😍", parentCommentId: undefined });
  });

  it("el botón de enviar está deshabilitado con el campo vacío — nunca envía un comentario en blanco", async () => {
    mockGetPublicById.mockReturnValue({ data: proposalFixture(), isLoading: false });
    const user = userEvent.setup();
    renderAt("/ie/comunity/5");
    await user.click(await screen.findByLabelText(/comments/i));
    await screen.findByPlaceholderText(/write a comment/i);
    expect(screen.getByRole("button", { name: /post/i })).toBeDisabled();
  });

  it("borrar el propio comentario: pide confirmación y luego llama a deleteComment con su id", async () => {
    const mutate = vi.fn();
    mockDeleteComment.mockReturnValue({ mutate, isPending: false });
    mockGetPublicById.mockReturnValue({ data: proposalFixture(), isLoading: false });
    mockListComments.mockReturnValue({
      data: { total: 1, items: [{ id: 9, proposalId: 5, content: "mío", createdAt: new Date(), isOwn: true, author: { userId: 42, name: "Ana", hasAvatar: false }, replies: [] }] },
      isLoading: false,
    });
    const user = userEvent.setup();
    renderAt("/ie/comunity/5");
    await user.click(await screen.findByLabelText(/comments/i));
    await user.click(await screen.findByText(/delete/i));
    const confirmDialog = (await screen.findByText(/delete this comment\?/i)).closest("[role='dialog']") as HTMLElement;
    await user.click(within(confirmDialog).getByRole("button", { name: /delete/i }));
    expect(mutate).toHaveBeenCalledWith({ commentId: 9 });
  });
});
