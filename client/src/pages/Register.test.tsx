import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@/lib/i18n";

// jsdom no implementa ResizeObserver — lo usa internamente @radix-ui/react-checkbox
// (Checkbox de shadcn/ui, usado en el paso 2 para los consentimientos).
if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/**
 * Register.test.tsx — flujo de alta de estudiante en /register (SEGOLIFE —
 * STUDENT REGISTRATION & ONBOARDING). Mismo patrón de mocking que
 * client/src/pages/segolife/VenueDetail.test.tsx (vi.mock de @/lib/trpc);
 * `wouter` y `fetch` se mockean aparte porque esta página, a diferencia del
 * resto de la app, llama a POST /api/auth/register por REST directo (ver
 * CLAUDE.md — única excepción a "todo por tRPC", igual que /login).
 */

const { mockMeQuery, mockCommunitiesQuery, navigateMock, invalidateMock } = vi.hoisted(() => ({
  mockMeQuery: vi.fn(),
  mockCommunitiesQuery: vi.fn(),
  navigateMock: vi.fn(),
  invalidateMock: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/register", navigateMock],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: { me: { useQuery: mockMeQuery } },
    communities: { list: { useQuery: mockCommunitiesQuery } },
    config: { getPublicSettings: { useQuery: () => ({ data: undefined }) } },
    useUtils: () => ({ auth: { me: { invalidate: invalidateMock } } }),
  },
}));

import Register from "./Register";

const ACTIVE_COMMUNITIES = [
  { id: 1, slug: "ie", name: "IE University", status: "active" },
  { id: 2, slug: "uva", name: "Universidad de Valladolid", status: "active" },
  { id: 3, slug: "grand-valira", name: "Grand Valira", status: "onboarding" },
];

async function fillStep1(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/nombre/i), "Ada");
  await user.type(screen.getByLabelText(/apellidos/i), "Lovelace");
  await user.type(screen.getByLabelText("Email"), "ada@example.com");
  await user.type(screen.getByLabelText("Contraseña"), "password123");
  await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
  await user.click(screen.getByRole("button", { name: /continuar/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMeQuery.mockReturnValue({ data: null, isLoading: false });
  mockCommunitiesQuery.mockReturnValue({ data: ACTIVE_COMMUNITIES });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1, name: "Ada Lovelace", email: "ada@example.com", role: "user", communitySlug: "ie" }) })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Register — paso 1 (cuenta)", () => {
  it("renderiza los campos del formulario de cuenta", () => {
    render(<Register />);
    expect(screen.getByLabelText(/nombre/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
  });

  it("no avanza de paso si las contraseñas no coinciden", async () => {
    const user = userEvent.setup();
    render(<Register />);
    await user.type(screen.getByLabelText(/nombre/i), "Ada");
    await user.type(screen.getByLabelText(/apellidos/i), "Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "otra-distinta");
    await user.click(screen.getByRole("button", { name: /continuar/i }));

    expect(await screen.findByText(/no coinciden/i)).toBeInTheDocument();
    // Sigue en el paso 1 — el selector de comunidad no debe existir todavía.
    expect(screen.queryByText("IE University")).not.toBeInTheDocument();
  });

  it("contraseña demasiado corta bloquea el avance", async () => {
    const user = userEvent.setup();
    render(<Register />);
    await user.type(screen.getByLabelText(/nombre/i), "Ada");
    await user.type(screen.getByLabelText(/apellidos/i), "Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "1234567");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "1234567");
    await user.click(screen.getByRole("button", { name: /continuar/i }));

    expect(await screen.findByText(/al menos 8 caracteres/i)).toBeInTheDocument();
  });
});

describe("Register — paso 2 (comunidad)", () => {
  it("muestra solo las comunidades activas (nunca las inactive/onboarding)", async () => {
    const user = userEvent.setup();
    render(<Register />);
    await fillStep1(user);

    expect(await screen.findByText("IE University")).toBeInTheDocument();
    expect(screen.getByText("Universidad de Valladolid")).toBeInTheDocument();
    expect(screen.queryByText("Grand Valira")).not.toBeInTheDocument();
  });

  it("el botón de enviar está deshabilitado sin comunidad ni términos aceptados", async () => {
    const user = userEvent.setup();
    render(<Register />);
    await fillStep1(user);

    const submit = await screen.findByRole("button", { name: /crear mi cuenta/i });
    expect(submit).toBeDisabled();
  });

  it("email duplicado (409) muestra el error amigable, sin redirigir", async () => {
    const user = userEvent.setup();
    (global.fetch as any).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Ya existe una cuenta con este email.", code: "EMAIL_EXISTS" }),
    });

    render(<Register />);
    await fillStep1(user);
    await user.click(await screen.findByText("IE University"));
    await user.click(document.getElementById("acceptTerms")!);
    await user.click(await screen.findByRole("button", { name: /crear mi cuenta/i }));

    expect(await screen.findByText(/ya existe una cuenta/i)).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("respuesta 201 sin id (honeypot) nunca pinta éxito ni redirige — no hay sesión real que mostrar", async () => {
    const user = userEvent.setup();
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ id: 0, name: "", email: "", role: "user" }) });

    render(<Register />);
    await fillStep1(user);
    await user.click(await screen.findByText("IE University"));
    await user.click(document.getElementById("acceptTerms")!);
    await user.click(await screen.findByRole("button", { name: /crear mi cuenta/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /crear mi cuenta/i })).not.toBeDisabled());
    expect(screen.queryByText(/bienvenido/i)).not.toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("alta exitosa invalida la sesión cacheada y redirige a la comunidad elegida", async () => {
    const user = userEvent.setup();
    render(<Register />);
    await fillStep1(user);
    await user.click(await screen.findByText("IE University"));
    await user.click(document.getElementById("acceptTerms")!);
    await user.click(await screen.findByRole("button", { name: /crear mi cuenta/i }));

    await waitFor(() => expect(invalidateMock).toHaveBeenCalled());
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/ie"), { timeout: 2000 });
  });
});

describe("Register — usuario ya autenticado", () => {
  it("redirige sin mostrar el formulario", () => {
    mockMeQuery.mockReturnValue({ data: { id: 1, role: "user" }, isLoading: false });
    render(<Register />);
    expect(navigateMock).toHaveBeenCalledWith("/");
    expect(screen.queryByLabelText(/nombre/i)).not.toBeInTheDocument();
  });
});
