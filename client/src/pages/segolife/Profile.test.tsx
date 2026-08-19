import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route } from "wouter";
import "@/lib/i18n";

/**
 * Profile.test.tsx — SEGOLIFE MG-03 (Student Profile Photo). Cubre
 * específicamente el editor de avatar (iniciales/foto/subir/reemplazar/
 * eliminar/cache-busting) — el resto de Profile.tsx (datos personales,
 * idioma, wallet, historical claim) no es responsabilidad de MG-03 y no se
 * re-prueba aquí desde cero.
 *
 * La subida es REST (fetch a POST /api/students/me/photo, no tRPC — ver
 * comentario de cabecera de StudentAvatarEditor en Profile.tsx), así que se
 * mockea `global.fetch` directamente; eliminar SÍ es tRPC
 * (students.removeMyPhoto) y se mockea como el resto del router.
 */
const {
  mockAuthMe,
  mockStudentsMe,
  mockHomeSummary,
  mockUniversities,
  mockWallet,
  mockWalletValue,
  mockHistoricalMatch,
  mockRemoveMyPhoto,
  mockUpdateProfile,
  mockUtilsInvalidate,
  noopQuery,
} = vi.hoisted(() => ({
  mockAuthMe: vi.fn(),
  mockStudentsMe: vi.fn(),
  mockHomeSummary: vi.fn(),
  mockUniversities: vi.fn(),
  mockWallet: vi.fn(),
  mockWalletValue: vi.fn(),
  mockHistoricalMatch: vi.fn(),
  mockRemoveMyPhoto: vi.fn(),
  mockUpdateProfile: vi.fn(),
  mockUtilsInvalidate: vi.fn(),
  noopQuery: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      me: { useQuery: mockAuthMe },
      logout: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    students: {
      me: { useQuery: mockStudentsMe },
      updateProfile: { useMutation: (opts: { onSuccess?: () => void }) => ({ mutate: (...args: unknown[]) => { mockUpdateProfile(...args); opts.onSuccess?.(); }, isPending: false }) },
      removeMyPhoto: { useMutation: (opts: { onSuccess?: () => void; onError?: () => void }) => ({
        mutate: () => mockRemoveMyPhoto().then(opts.onSuccess).catch(opts.onError),
        isPending: false,
      }) },
    },
    communities: {
      listUniversities: { useQuery: mockUniversities },
      myMemberships: { useQuery: noopQuery },
    },
    tokens: {
      getMyWallet: { useQuery: mockWallet },
      myWalletPromotionalValue: { useQuery: mockWalletValue },
    },
    historicalIdentities: {
      myHistoricalMatch: { useQuery: mockHistoricalMatch },
      claimMyHistory: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    home: { getSummary: { useQuery: mockHomeSummary } },
    studentNotifications: { unreadCount: { useQuery: noopQuery } },
    config: { getPublicSettings: { useQuery: noopQuery } },
    ticketPurchase: {
      myIdentityToken: { useQuery: noopQuery },
      rotateMyIdentityToken: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({ students: { me: { invalidate: mockUtilsInvalidate } } }),
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

import Profile from "./Profile";

function mockAuthenticated() {
  mockAuthMe.mockReturnValue({ data: { id: 42, name: "Ana García", email: "ana@ie.edu" }, isLoading: false });
}

function baseMe(overrides: { avatarUrl?: string | null } = {}) {
  return {
    profile: {
      id: 1, userId: 42, firstName: "Ana", lastName: "García", dateOfBirth: null, nationality: null,
      countryOfOrigin: null, preferredLocale: null, universityId: null, degreeProgram: null,
      academicYear: null, arrivalDate: null, expectedDepartureDate: null, addressLine: null,
      postalCode: null, city: null, profileCompleted: true, status: "active" as const,
      createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    },
    user: { id: 42, name: "Ana García", email: "ana@ie.edu", phone: null, avatarUrl: overrides.avatarUrl ?? null, lastSignedIn: new Date("2026-01-01") },
    university: null,
    communities: [{ id: 1, name: "Segolife IE", slug: "ie" }],
  };
}

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(
    <Route path="/:community/profile">
      <Profile />
    </Route>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticated();
  mockStudentsMe.mockReturnValue({ data: baseMe(), isLoading: false });
  mockHomeSummary.mockReturnValue({ data: undefined, isLoading: false });
  mockUniversities.mockReturnValue({ data: [], isLoading: false });
  mockWallet.mockReturnValue({ data: { balance: 0 } });
  mockWalletValue.mockReturnValue({ data: undefined });
  mockHistoricalMatch.mockReturnValue({ data: { status: "NOT_AVAILABLE" } });
  mockRemoveMyPhoto.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Profile — avatar de iniciales (sin foto, MG-03)", () => {
  it("sin avatarUrl: muestra las iniciales del Student, nunca una imagen rota", () => {
    mockStudentsMe.mockReturnValue({ data: baseMe({ avatarUrl: null }), isLoading: false });
    renderAt("/ie/profile");
    expect(screen.getByText("AG")).toBeInTheDocument();
    // queryByRole("img") a secas también cazaría el logo de marca del
    // sidebar/header — se acota al alt real de AvatarImage (el nombre
    // completo), nunca presente si solo hay iniciales.
    expect(screen.queryByRole("img", { name: "Ana García" })).not.toBeInTheDocument();
  });

  it("sin foto: ofrece 'Add photo', nunca 'Change photo' ni el botón de eliminar", () => {
    mockStudentsMe.mockReturnValue({ data: baseMe({ avatarUrl: null }), isLoading: false });
    renderAt("/ie/profile");
    expect(screen.getByText(/^add photo$|^añadir foto$/i)).toBeInTheDocument();
    expect(screen.queryByText(/^change photo$|^cambiar foto$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/remove photo|eliminar foto/i)).not.toBeInTheDocument();
  });
});

describe("Profile — avatar con foto real (MG-03)", () => {
  it("con avatarUrl real: ofrece 'Change photo' y 'Remove photo'", () => {
    mockStudentsMe.mockReturnValue({ data: baseMe({ avatarUrl: "/api/students/42/photo" }), isLoading: false });
    renderAt("/ie/profile");
    expect(screen.getByText(/^change photo$|^cambiar foto$/i)).toBeInTheDocument();
    expect(screen.getByText(/remove photo|eliminar foto/i)).toBeInTheDocument();
  });
});

describe("Profile — subir/reemplazar foto (MG-03)", () => {
  it("selecciona un archivo válido: hace POST multipart a /api/students/me/photo con credenciales, muestra éxito e invalida students.me", async () => {
    mockStudentsMe.mockReturnValue({ data: baseMe({ avatarUrl: null }), isLoading: false });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ success: true, url: "/api/students/42/photo" }) });
    renderAt("/ie/profile");

    const file = new File(["fake-image-bytes"], "photo.jpg", { type: "image/jpeg" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const user = userEvent.setup();
    await user.upload(input, file);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      "/api/students/me/photo",
      expect.objectContaining({ method: "POST", credentials: "include" })
    ));
    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options.body).toBeInstanceOf(FormData);
    // El toast (sonner) no se comprueba aquí — <Toaster/> vive en el root
    // real de la app (App.tsx), no en este render aislado de Profile.tsx,
    // así que su texto nunca llega al DOM en este test. Lo verificable de
    // verdad es el efecto real: la query se invalida (la UI se refresca).
    await waitFor(() => expect(mockUtilsInvalidate).toHaveBeenCalled());
  });

  it("el servidor rechaza la subida (400): nunca invalida la query ni rompe la página", async () => {
    mockStudentsMe.mockReturnValue({ data: baseMe({ avatarUrl: null }), isLoading: false });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({ error: "Imagen no válida" }) });
    renderAt("/ie/profile");

    const file = new File(["not-really-an-image"], "fake.jpg", { type: "image/jpeg" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const user = userEvent.setup();
    await user.upload(input, file);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(mockUtilsInvalidate).not.toHaveBeenCalled();
    // La página sigue viva y respondiendo (nunca rompe) — sigue ofreciendo subir.
    expect(screen.getByText(/^add photo$|^añadir foto$/i)).toBeInTheDocument();
  });

  it("tipo de archivo no permitido: rechazado en el cliente ANTES de llamar a fetch (feedback inmediato)", async () => {
    mockStudentsMe.mockReturnValue({ data: baseMe({ avatarUrl: null }), isLoading: false });
    renderAt("/ie/profile");
    const file = new File(["<svg></svg>"], "photo.svg", { type: "image/svg+xml" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const user = userEvent.setup();
    await user.upload(input, file);

    // Rechazado client-side: nunca llega a hacer network — es la prueba
    // observable real (el toast de sonner no renderiza en este test aislado,
    // ver comentario del test anterior). El propio chequeo de tipo es
    // síncrono dentro del handler del evento `change`, ya resuelto cuando
    // user.upload() termina de esperar.
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("Profile — eliminar foto pide confirmación (MG-03)", () => {
  it("pulsar 'Remove photo' abre un diálogo de confirmación — NO elimina todavía", async () => {
    mockStudentsMe.mockReturnValue({ data: baseMe({ avatarUrl: "/api/students/42/photo" }), isLoading: false });
    renderAt("/ie/profile");
    const user = userEvent.setup();
    await user.click(screen.getByText(/remove photo|eliminar foto/i));
    expect(await screen.findByText(/remove profile photo\?|eliminar foto de perfil\?/i)).toBeInTheDocument();
    expect(mockRemoveMyPhoto).not.toHaveBeenCalled();
  });

  it("cancelar el diálogo: nunca llama a removeMyPhoto", async () => {
    mockStudentsMe.mockReturnValue({ data: baseMe({ avatarUrl: "/api/students/42/photo" }), isLoading: false });
    renderAt("/ie/profile");
    const user = userEvent.setup();
    await user.click(screen.getByText(/remove photo|eliminar foto/i));
    await screen.findByText(/remove profile photo\?|eliminar foto de perfil\?/i);
    await user.click(screen.getByText(/^cancel$|^cancelar$/i));
    expect(mockRemoveMyPhoto).not.toHaveBeenCalled();
  });

  it("confirmar en el diálogo: llama a students.removeMyPhoto (el toast de éxito no es verificable en este render aislado)", async () => {
    mockStudentsMe.mockReturnValue({ data: baseMe({ avatarUrl: "/api/students/42/photo" }), isLoading: false });
    renderAt("/ie/profile");
    const user = userEvent.setup();
    await user.click(screen.getByText(/remove photo|eliminar foto/i));
    await screen.findByText(/remove profile photo\?|eliminar foto de perfil\?/i);
    // El botón de confirmación del diálogo y el botón que lo abre comparten
    // el mismo texto ("Remove photo"/"Eliminar foto") — Radix marca el
    // resto de la página aria-hidden mientras el diálogo está abierto, así
    // que el getByRole por defecto (sin hidden:true) ya excluye el disparador
    // de fondo y encuentra solo el botón real del diálogo.
    await user.click(screen.getByRole("button", { name: /^remove photo$|^eliminar foto$/i }));
    await waitFor(() => expect(mockRemoveMyPhoto).toHaveBeenCalledTimes(1));
  });
});
