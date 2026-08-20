import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@/lib/i18n";

/**
 * Login.test.tsx — SEC-02. Cubre la señal `?reason=expired` que
 * authRedirect.ts (main.tsx) añade al redirigir tras confirmar que una
 * sesión anterior ya no es válida — Login.tsx debe mostrar un mensaje
 * claro en vez de un formulario vacío sin explicación (nunca un 401/pantalla
 * en blanco). Mismo patrón de mocking que Register.test.tsx (vi.mock de
 * @/lib/trpc y wouter).
 */

const { mockMeQuery, mockMyMembershipsQuery, navigateMock } = vi.hoisted(() => ({
  mockMeQuery: vi.fn(),
  mockMyMembershipsQuery: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/login", navigateMock],
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: { me: { useQuery: mockMeQuery } },
    communities: { myMemberships: { useQuery: mockMyMembershipsQuery } },
    config: { getPublicSettings: { useQuery: () => ({ data: undefined }) } },
    useUtils: () => ({ auth: { me: { invalidate: vi.fn(), fetch: vi.fn() } }, communities: { myMemberships: { fetch: vi.fn() } } }),
  },
}));

import Login from "./Login";

function setSearch(search: string) {
  window.history.pushState({}, "", `/login${search}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMeQuery.mockReturnValue({ data: null, isLoading: false });
  mockMyMembershipsQuery.mockReturnValue({ data: undefined });
  setSearch("");
});

afterEach(() => {
  cleanup();
});

describe("Login — señal de sesión caducada (?reason=expired, SEC-02)", () => {
  it("con ?reason=expired muestra el mensaje de sesión caducada", () => {
    setSearch("?reason=expired&returnTo=%2Fadmin%2Feventos");
    render(<Login />);
    expect(screen.getByText(/tu sesión ha caducado/i)).toBeInTheDocument();
  });

  it("sin el parámetro reason, no muestra ningún error al cargar", () => {
    render(<Login />);
    expect(screen.queryByText(/tu sesión ha caducado/i)).not.toBeInTheDocument();
  });

  it("con un reason distinto de 'expired', no muestra el mensaje de sesión caducada", () => {
    setSearch("?reason=otracosa");
    render(<Login />);
    expect(screen.queryByText(/tu sesión ha caducado/i)).not.toBeInTheDocument();
  });
});
