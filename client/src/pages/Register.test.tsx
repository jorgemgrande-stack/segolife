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
// jsdom tampoco implementa estos métodos de puntero/scroll que usa
// internamente @radix-ui/react-select (selector de universidad, paso 2).
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/**
 * Register.test.tsx — flujo de alta de estudiante en /register (SEGOLIFE —
 * STUDENT REGISTRATION & ONBOARDING). Mismo patrón de mocking que
 * client/src/pages/segolife/VenueDetail.test.tsx (vi.mock de @/lib/trpc);
 * `wouter` y `fetch` se mockean aparte porque esta página, a diferencia del
 * resto de la app, llama a POST /api/auth/register por REST directo (ver
 * CLAUDE.md — única excepción a "todo por tRPC", igual que /login).
 */

const { mockMeQuery, mockCommunitiesQuery, mockCommunityUniversitiesQuery, navigateMock, invalidateMock } = vi.hoisted(() => ({
  mockMeQuery: vi.fn(),
  mockCommunitiesQuery: vi.fn(),
  mockCommunityUniversitiesQuery: vi.fn(),
  navigateMock: vi.fn(),
  invalidateMock: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/register", navigateMock],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: { me: { useQuery: mockMeQuery } },
    communities: {
      list: { useQuery: mockCommunitiesQuery },
      getCommunityUniversities: { useQuery: mockCommunityUniversitiesQuery },
    },
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
// Una única universidad por comunidad — auto-selecciona (ver useEffect en
// Register.tsx), así los tests de flujo feliz no necesitan interactuar con
// el <Select> de Radix explícitamente.
const IE_UNIVERSITIES = [{ id: 10, name: "IE University", slug: "ie-university" }];

async function fillStep1(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/nombre/i), "Ada");
  await user.type(screen.getByLabelText(/apellidos/i), "Lovelace");
  await user.type(screen.getByLabelText("Email"), "ada@example.com");
  await user.type(screen.getByLabelText(/teléfono/i), "+34 600 123 456");
  await user.type(screen.getByLabelText("Contraseña"), "password123");
  await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
  await user.click(screen.getByRole("button", { name: /continuar/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMeQuery.mockReturnValue({ data: null, isLoading: false });
  mockCommunitiesQuery.mockReturnValue({ data: ACTIVE_COMMUNITIES });
  mockCommunityUniversitiesQuery.mockReturnValue({ data: IE_UNIVERSITIES });
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
  it("renderiza los campos del formulario de cuenta, incluido el teléfono", () => {
    render(<Register />);
    expect(screen.getByLabelText(/nombre/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText(/teléfono/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
  });

  it("teléfono con menos de 6 dígitos bloquea el avance", async () => {
    const user = userEvent.setup();
    render(<Register />);
    await user.type(screen.getByLabelText(/nombre/i), "Ada");
    await user.type(screen.getByLabelText(/apellidos/i), "Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText(/teléfono/i), "123");
    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
    await user.click(screen.getByRole("button", { name: /continuar/i }));

    expect(await screen.findByText(/teléfono introducido no es válido/i)).toBeInTheDocument();
    expect(screen.queryByText("IE University")).not.toBeInTheDocument();
  });

  it("no avanza de paso si las contraseñas no coinciden", async () => {
    const user = userEvent.setup();
    render(<Register />);
    await user.type(screen.getByLabelText(/nombre/i), "Ada");
    await user.type(screen.getByLabelText(/apellidos/i), "Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText(/teléfono/i), "+34 600 123 456");
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
    await user.type(screen.getByLabelText(/teléfono/i), "+34 600 123 456");
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

  it("alta exitosa invalida la sesión cacheada, envía teléfono/universidad y redirige a la comunidad elegida", async () => {
    const user = userEvent.setup();
    render(<Register />);
    await fillStep1(user);
    await user.click(await screen.findByText("IE University"));
    await user.click(document.getElementById("acceptTerms")!);
    await user.click(await screen.findByRole("button", { name: /crear mi cuenta/i }));

    await waitFor(() => expect(invalidateMock).toHaveBeenCalled());
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/ie"), { timeout: 2000 });

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.phone).toBe("+34 600 123 456");
    // Comunidad con una única universidad → se auto-selecciona (spec: "pedir
    // la universidad para ubicarlo en el sistema", sin fricción innecesaria
    // cuando no hay ambigüedad real).
    expect(body.universityId).toBe(IE_UNIVERSITIES[0].id);
  });

  it("comunidad con varias universidades exige elegir una explícitamente — el envío sigue bloqueado sin auto-selección", async () => {
    mockCommunityUniversitiesQuery.mockReturnValue({
      data: [
        { id: 10, name: "IE University", slug: "ie-university" },
        { id: 11, name: "IE Segovia Campus", slug: "ie-segovia" },
      ],
    });
    const user = userEvent.setup();
    render(<Register />);
    await fillStep1(user);
    await user.click(await screen.findByText("IE University"));
    await user.click(document.getElementById("acceptTerms")!);

    // A diferencia del caso de una única universidad (auto-seleccionada, ver
    // el test de "alta exitosa"), con dos opciones ninguna se elige por
    // defecto — el envío sigue bloqueado hasta que el estudiante elige.
    const combobox = screen.getByRole("combobox", { name: /universidad/i });
    expect(combobox).toHaveTextContent(/selecciona tu universidad/i);
    expect(screen.getByRole("button", { name: /crear mi cuenta/i })).toBeDisabled();
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
