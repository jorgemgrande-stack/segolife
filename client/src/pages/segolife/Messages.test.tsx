import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@/lib/i18n";

/**
 * Messages.test.tsx — COM-01. Mismo criterio que Notifications.tsx: lista
 * del Student, siempre resuelta server-side (nunca un selector de
 * comunidad ni forma de iniciar una conversación nueva aquí — spec §11).
 */
const { mockMyConversations, noopQuery } = vi.hoisted(() => ({
  mockMyConversations: vi.fn(),
  noopQuery: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    studentMessages: { myConversations: { useQuery: mockMyConversations } },
  },
}));

vi.mock("@/contexts/CommunityContext", () => ({
  useCommunity: () => ({
    community: { id: 1, slug: "ie", name: "Segolife IE", status: "active", defaultLocale: "en", availableLocales: ["en"] },
    slug: "ie",
    defaultLocale: "en",
    availableLocales: ["en"],
    loading: false,
    error: null,
  }),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 7, name: "QA Student" }, loading: false }),
}));

vi.mock("@/components/segolife/SegolifeAppShell", () => ({
  SegolifeAppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import Messages from "./Messages";

afterEach(cleanup);

describe("Messages — inbox del Student", () => {
  it("estado vacío cuando no hay conversaciones", () => {
    mockMyConversations.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    render(<Messages />);
    expect(screen.getByText(/no messages yet|todavía no tienes mensajes/i)).toBeInTheDocument();
  });

  it("muestra skeleton mientras carga, nunca el estado vacío por error de timing", () => {
    mockMyConversations.mockReturnValue({ data: undefined, isLoading: true });
    render(<Messages />);
    expect(screen.queryByText(/no messages yet|todavía no tienes mensajes/i)).not.toBeInTheDocument();
  });

  it("renderiza cada conversación con asunto, preview y enlace a su detalle", () => {
    mockMyConversations.mockReturnValue({
      data: {
        items: [
          { id: 42, subject: "Bienvenida", lastMessagePreview: "Hola, ¿cómo va todo?", lastMessageAt: new Date(), status: "open", waitingFor: "admin", unread: false },
        ],
        total: 1,
      },
      isLoading: false,
    });
    render(<Messages />);
    expect(screen.getByText("Bienvenida")).toBeInTheDocument();
    expect(screen.getByText("Hola, ¿cómo va todo?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Bienvenida/i })).toHaveAttribute("href", "/ie/messages/42");
  });

  it("muestra 'waiting for you' cuando la conversación está abierta y espera al Student", () => {
    mockMyConversations.mockReturnValue({
      data: { items: [{ id: 1, subject: "s", lastMessagePreview: null, lastMessageAt: new Date(), status: "open", waitingFor: "student", unread: true }], total: 1 },
      isLoading: false,
    });
    render(<Messages />);
    expect(screen.getByText(/waiting for your reply|esperando tu respuesta/i)).toBeInTheDocument();
  });

  it("muestra el estado 'Closed' para una conversación cerrada", () => {
    mockMyConversations.mockReturnValue({
      data: { items: [{ id: 1, subject: "s", lastMessagePreview: null, lastMessageAt: new Date(), status: "closed", waitingFor: "none", unread: false }], total: 1 },
      isLoading: false,
    });
    render(<Messages />);
    expect(screen.getByText(/^Closed$|^Cerrada$/i)).toBeInTheDocument();
  });
});
