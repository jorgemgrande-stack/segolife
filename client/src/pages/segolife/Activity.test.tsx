import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Route } from "wouter";
import i18n from "@/lib/i18n";

/**
 * Activity.test.tsx — FIX-01. Primera cobertura de esta página. El caso
 * nuevo: un movimiento de ledger con sourceType="reversal" (lo que
 * reverseTransaction() escribe SIEMPRE, ver tokenLedgerService.ts) debe
 * mostrarse como "clawback" — nunca como un "spent" normal, el Student no
 * decidió ese movimiento — y con su importe visible (regresión: el primer
 * intento de esta feature excluía "clawback" de la condición de importe,
 * ver Activity.tsx, y el Student se habría quedado sin saber cuántos
 * SegoTokens le retiraron).
 */
const { mockAuthMe, mockHomeSummary, mockStudentsMe, mockUseCommunity, mockListMyLedger, mockMyRedemptions, mockMyBenefits, mockMyPhotoActivity, mockMyConversations, noopQuery } = vi.hoisted(() => ({
  mockAuthMe: vi.fn(),
  mockHomeSummary: vi.fn(),
  mockStudentsMe: vi.fn(),
  mockUseCommunity: vi.fn(),
  mockListMyLedger: vi.fn(),
  mockMyRedemptions: vi.fn(),
  mockMyBenefits: vi.fn(),
  mockMyPhotoActivity: vi.fn(),
  mockMyConversations: vi.fn(),
  noopQuery: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      me: { useQuery: mockAuthMe },
      logout: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    home: { getSummary: { useQuery: mockHomeSummary } },
    students: { me: { useQuery: mockStudentsMe }, myPhotoActivity: { useQuery: mockMyPhotoActivity } },
    studentMessages: { myConversations: { useQuery: mockMyConversations } },
    studentNotifications: { unreadCount: { useQuery: noopQuery } },
    communities: { list: { useQuery: noopQuery }, myMemberships: { useQuery: noopQuery } },
    config: { getPublicSettings: { useQuery: noopQuery } },
    tokens: { listMyLedger: { useQuery: mockListMyLedger } },
    consumptionQr: { myRedemptions: { useQuery: mockMyRedemptions } },
    benefits: { myBenefits: { useQuery: mockMyBenefits } },
    useUtils: () => ({ auth: { me: { setData: vi.fn() } } }),
  },
}));

vi.mock("@/contexts/CommunityContext", () => ({
  useCommunity: mockUseCommunity,
}));

import Activity from "./Activity";

function mockAuthenticated() {
  mockAuthMe.mockReturnValue({ data: { id: 42, name: "Ana", email: "ana@ie.edu" }, isLoading: false });
}

function mockCommunity() {
  mockUseCommunity.mockReturnValue({
    community: { id: 1, slug: "ie", name: "Segolife IE", status: "active", defaultLocale: "en", availableLocales: ["en"] },
    slug: "ie",
    defaultLocale: "en",
    availableLocales: ["en"],
    loading: false,
    error: null,
  });
}

function ledgerEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, direction: "credit", amount: 10, reason: "Bienvenida", sourceType: "manual_adjustment",
    createdAt: new Date("2026-08-15T10:00:00Z"),
    ...overrides,
  };
}

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(
    <Route path="/:community/activity">
      <Activity />
    </Route>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticated();
  mockCommunity();
  mockHomeSummary.mockReturnValue({ data: undefined, isLoading: false });
  mockStudentsMe.mockReturnValue({ data: undefined });
  mockMyRedemptions.mockReturnValue({ data: [], isLoading: false });
  mockMyBenefits.mockReturnValue({ data: [], isLoading: false });
  mockMyPhotoActivity.mockReturnValue({ data: [], isLoading: false });
  mockMyConversations.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
});

afterEach(() => {
  cleanup();
  i18n.changeLanguage("en");
});

const CLAWBACK_KICKER = /segotokens reversed \(refund\)|segotokens revertidos \(reembolso\)/i;
const SPENT_KICKER = /segotokens spent|segotokens gastados/i;

describe("Activity — FIX-01: un clawback (sourceType='reversal') nunca se confunde con un 'spent' normal", () => {
  it("un movimiento con sourceType='reversal' se etiqueta como clawback, no como spent", () => {
    mockListMyLedger.mockReturnValue({
      data: [ledgerEntry({ id: 99, direction: "debit", amount: 100, reason: "Reembolso de entrada — pedido #900", sourceType: "reversal" })],
      isLoading: false,
    });
    renderAt("/ie/activity");
    expect(screen.getByText(CLAWBACK_KICKER)).toBeInTheDocument();
    expect(screen.queryByText(SPENT_KICKER)).not.toBeInTheDocument();
  });

  it("el clawback muestra su importe con signo negativo — nunca lo oculta (regresión real encontrada en desarrollo)", () => {
    mockListMyLedger.mockReturnValue({
      data: [ledgerEntry({ id: 99, direction: "debit", amount: 100, reason: "Reembolso de entrada — pedido #900", sourceType: "reversal" })],
      isLoading: false,
    });
    renderAt("/ie/activity");
    expect(screen.getByText("-100")).toBeInTheDocument();
  });

  it("un débito ORDINARIO (sourceType != 'reversal') sigue etiquetándose como spent, sin cambios", () => {
    mockListMyLedger.mockReturnValue({
      data: [ledgerEntry({ id: 1, direction: "debit", amount: 20, reason: "Canje universal", sourceType: "universal_spend" })],
      isLoading: false,
    });
    renderAt("/ie/activity");
    expect(screen.getByText(SPENT_KICKER)).toBeInTheDocument();
    expect(screen.queryByText(CLAWBACK_KICKER)).not.toBeInTheDocument();
  });

  it("un crédito normal sigue etiquetándose como earned, nunca como clawback aunque exista una fila de reversión en el mismo historial", () => {
    mockListMyLedger.mockReturnValue({
      data: [
        ledgerEntry({ id: 1, direction: "credit", amount: 100, reason: "Compra de entrada", sourceType: "ticket" }),
        ledgerEntry({ id: 2, direction: "debit", amount: 100, reason: "Reembolso de entrada — pedido #900", sourceType: "reversal", createdAt: new Date("2026-08-16T10:00:00Z") }),
      ],
      isLoading: false,
    });
    renderAt("/ie/activity");
    expect(screen.getByText(/segotokens earned|segotokens ganados/i)).toBeInTheDocument();
    expect(screen.getByText(CLAWBACK_KICKER)).toBeInTheDocument();
  });

  it("sin ledger/beneficios: estado vacío, nunca lanza por un array undefined", () => {
    mockListMyLedger.mockReturnValue({ data: undefined, isLoading: false });
    renderAt("/ie/activity");
    expect(screen.getByText(/no activity yet|todavía no tienes actividad/i)).toBeInTheDocument();
  });
});

describe("Activity — MG-03B: Profile Photo Activity (added/updated/removed, sin ST)", () => {
  function photoEvent(id: number, action: "added" | "updated" | "removed", occurredAt: string) {
    return { id, userId: 42, action, occurredAt: new Date(occurredAt) };
  }

  it("un evento 'added' se renderiza como 'Profile photo added' (EN)", async () => {
    await i18n.changeLanguage("en");
    mockMyPhotoActivity.mockReturnValue({ data: [photoEvent(1, "added", "2026-08-15T10:00:00Z")], isLoading: false });
    renderAt("/ie/activity");
    expect(screen.getByText("Profile photo added")).toBeInTheDocument();
  });

  it("un evento 'updated' se renderiza como 'Foto de perfil actualizada' (ES)", async () => {
    await i18n.changeLanguage("es");
    mockMyPhotoActivity.mockReturnValue({ data: [photoEvent(2, "updated", "2026-08-15T10:00:00Z")], isLoading: false });
    renderAt("/ie/activity");
    expect(screen.getByText("Foto de perfil actualizada")).toBeInTheDocument();
  });

  it("un evento 'removed' se renderiza correctamente", async () => {
    await i18n.changeLanguage("en");
    mockMyPhotoActivity.mockReturnValue({ data: [photoEvent(3, "removed", "2026-08-15T10:00:00Z")], isLoading: false });
    renderAt("/ie/activity");
    expect(screen.getByText("Profile photo removed")).toBeInTheDocument();
  });

  it("NUNCA muestra un importe de SegoTokens junto a un evento de foto — ni +0 ni ningún otro valor", async () => {
    await i18n.changeLanguage("en");
    mockMyPhotoActivity.mockReturnValue({ data: [photoEvent(1, "added", "2026-08-15T10:00:00Z")], isLoading: false });
    renderAt("/ie/activity");
    expect(screen.queryByText(/^\+0$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^-0$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
  });

  it("orden temporal correcto: un evento de foto se intercala con el ledger por fecha real, no aparece siempre al final", async () => {
    await i18n.changeLanguage("en");
    mockListMyLedger.mockReturnValue({
      data: [{ id: 1, direction: "credit", amount: 50, reason: "Compra", sourceType: "ticket", createdAt: new Date("2026-08-10T10:00:00Z") }],
      isLoading: false,
    });
    mockMyPhotoActivity.mockReturnValue({ data: [photoEvent(1, "added", "2026-08-20T10:00:00Z")], isLoading: false });
    renderAt("/ie/activity");
    const rows = screen.getAllByText(/Profile photo added|Compra/);
    // El evento de foto (20 ago) es más reciente que la compra (10 ago) — debe aparecer PRIMERO.
    expect(rows[0]).toHaveTextContent("Profile photo added");
  });
});

describe("Activity — COM-01: conversaciones (hallazgo real reportado con captura — el intercambio con un Admin no aparecía aquí)", () => {
  function conversation(id: number, subject: string, lastMessageAt: string) {
    return { id, subject, lastMessageAt: new Date(lastMessageAt) };
  }

  it("una conversación con lastMessageAt real se renderiza con su asunto como etiqueta", async () => {
    await i18n.changeLanguage("en");
    mockMyConversations.mockReturnValue({ data: { items: [conversation(1, "Fallo en la Matrix", "2026-08-21T21:02:00Z")], total: 1 }, isLoading: false });
    renderAt("/ie/activity");
    expect(screen.getByText("Fallo en la Matrix")).toBeInTheDocument();
    expect(screen.getByText(/^message$/i)).toBeInTheDocument();
  });

  it("sin lastMessageAt (conversación sin ningún mensaje todavía): no genera ninguna entrada", async () => {
    mockMyConversations.mockReturnValue({ data: { items: [{ id: 2, subject: "Sin mensajes", lastMessageAt: null }], total: 1 }, isLoading: false });
    renderAt("/ie/activity");
    expect(screen.queryByText("Sin mensajes")).not.toBeInTheDocument();
  });

  it("orden temporal correcto: la conversación se intercala con el ledger por fecha real", async () => {
    await i18n.changeLanguage("en");
    mockListMyLedger.mockReturnValue({
      data: [{ id: 1, direction: "credit", amount: 50, reason: "Compra", sourceType: "ticket", createdAt: new Date("2026-08-10T10:00:00Z") }],
      isLoading: false,
    });
    mockMyConversations.mockReturnValue({ data: { items: [conversation(3, "Fallo en la Matrix", "2026-08-20T10:00:00Z")], total: 1 }, isLoading: false });
    renderAt("/ie/activity");
    const rows = screen.getAllByText(/Fallo en la Matrix|Compra/);
    expect(rows[0]).toHaveTextContent("Fallo en la Matrix");
  });
});
