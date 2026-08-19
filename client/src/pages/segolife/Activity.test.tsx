import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Route } from "wouter";
import "@/lib/i18n";

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
const { mockAuthMe, mockHomeSummary, mockStudentsMe, mockUseCommunity, mockListMyLedger, mockMyRedemptions, mockMyBenefits, noopQuery } = vi.hoisted(() => ({
  mockAuthMe: vi.fn(),
  mockHomeSummary: vi.fn(),
  mockStudentsMe: vi.fn(),
  mockUseCommunity: vi.fn(),
  mockListMyLedger: vi.fn(),
  mockMyRedemptions: vi.fn(),
  mockMyBenefits: vi.fn(),
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
});

afterEach(cleanup);

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
