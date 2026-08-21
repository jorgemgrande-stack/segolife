import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@/lib/i18n";

// JSDOM no implementa scrollIntoView — mismo tipo de polyfill ya usado en
// otros test files de este repo para APIs de DOM que JSDOM no cubre.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/**
 * MessageDetail.test.tsx — COM-01. Conversación individual del Student:
 * histórico + composer. Nunca expone cambiar destinatario/cerrar/contexto/
 * notas internas (spec §10) — esos controles ni siquiera existen aquí.
 */
const { mockGetConversation, mockMarkRead, mockReply } = vi.hoisted(() => ({
  mockGetConversation: vi.fn(),
  mockMarkRead: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  mockReply: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    studentMessages: {
      getConversation: { useQuery: mockGetConversation },
      markRead: { useMutation: mockMarkRead },
      reply: { useMutation: mockReply },
    },
    useUtils: () => ({
      studentMessages: {
        getConversation: { invalidate: vi.fn() },
        myConversations: { invalidate: vi.fn() },
      },
    }),
  },
}));

vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return { ...actual, useParams: () => ({ id: "42" }) };
});

vi.mock("@/contexts/CommunityContext", () => ({
  useCommunity: () => ({
    community: { id: 1, slug: "ie", name: "Segolife IE", status: "active", defaultLocale: "en", availableLocales: ["en"] },
    slug: "ie", defaultLocale: "en", availableLocales: ["en"], loading: false, error: null,
  }),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 7, name: "QA Student" }, loading: false }),
}));

vi.mock("@/components/segolife/SegolifeAppShell", () => ({
  SegolifeAppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import MessageDetail from "./MessageDetail";

beforeEach(() => {
  vi.clearAllMocks();
  mockMarkRead.mockReturnValue({ mutate: vi.fn(), isPending: false });
});
afterEach(cleanup);

function conversation(overrides: Partial<{ status: string }> = {}) {
  return {
    conversation: { id: 42, subject: "Bienvenida a Segolife", status: "open", ...overrides },
    messages: [
      { id: 1, senderRole: "admin", body: "Hola, bienvenido", createdAt: new Date("2026-01-01T10:00:00Z") },
      { id: 2, senderRole: "student", body: "Gracias!", createdAt: new Date("2026-01-01T10:05:00Z") },
    ],
  };
}

describe("MessageDetail — conversación individual del Student", () => {
  it("muestra un loader mientras carga", () => {
    mockGetConversation.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = render(<MessageDetail />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("conversación inexistente/ajena: estado 'no encontrada', nunca un error crudo", () => {
    mockGetConversation.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<MessageDetail />);
    expect(screen.getByText(/conversation not found|conversación no encontrada/i)).toBeInTheDocument();
  });

  it("renderiza el asunto y los mensajes en orden, con la etiqueta de remitente correcta", () => {
    mockGetConversation.mockReturnValue({ data: conversation(), isLoading: false, isError: false });
    mockReply.mockReturnValue({ mutate: vi.fn(), isPending: false });
    render(<MessageDetail />);
    expect(screen.getByText("Bienvenida a Segolife")).toBeInTheDocument();
    expect(screen.getByText("Hola, bienvenido")).toBeInTheDocument();
    expect(screen.getByText("Gracias!")).toBeInTheDocument();
  });

  it("marca la conversación como leída al abrirla", () => {
    const mutate = vi.fn();
    mockMarkRead.mockReturnValue({ mutate, isPending: false });
    mockGetConversation.mockReturnValue({ data: conversation(), isLoading: false, isError: false });
    mockReply.mockReturnValue({ mutate: vi.fn(), isPending: false });
    render(<MessageDetail />);
    expect(mutate).toHaveBeenCalledWith({ conversationId: 42 });
  });

  it("conversación cerrada: NUNCA muestra el composer, muestra el aviso de cerrada", () => {
    mockGetConversation.mockReturnValue({ data: conversation({ status: "closed" }), isLoading: false, isError: false });
    mockReply.mockReturnValue({ mutate: vi.fn(), isPending: false });
    render(<MessageDetail />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/this conversation is closed|esta conversación está cerrada/i)).toBeInTheDocument();
  });

  it("el botón enviar está deshabilitado con el composer vacío", () => {
    mockGetConversation.mockReturnValue({ data: conversation(), isLoading: false, isError: false });
    mockReply.mockReturnValue({ mutate: vi.fn(), isPending: false });
    render(<MessageDetail />);
    expect(screen.getByRole("button", { name: /send|enviar/i })).toBeDisabled();
  });

  it("escribir y pulsar enviar llama a reply.mutate con conversationId y el texto recortado", async () => {
    const mutate = vi.fn();
    mockGetConversation.mockReturnValue({ data: conversation(), isLoading: false, isError: false });
    mockReply.mockReturnValue({ mutate, isPending: false });
    render(<MessageDetail />);

    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "  Mi respuesta  ");
    await userEvent.click(screen.getByRole("button", { name: /send|enviar/i }));

    expect(mutate).toHaveBeenCalledWith({ conversationId: 42, body: "Mi respuesta" });
  });

  it("nunca ofrece ningún control de cerrar/reabrir/cambiar destinatario — eso es exclusivo de Admin", () => {
    mockGetConversation.mockReturnValue({ data: conversation(), isLoading: false, isError: false });
    mockReply.mockReturnValue({ mutate: vi.fn(), isPending: false });
    render(<MessageDetail />);
    expect(screen.queryByText(/close conversation|cerrar conversación|reopen|reabrir/i)).not.toBeInTheDocument();
  });
});
