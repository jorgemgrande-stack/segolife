import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route } from "wouter";
import "@/lib/i18n";

/**
 * Rewards.test.tsx — FIX-03. Bug real: `?tab=benefits` (deep-link por
 * query) nunca se comprobaba en el cálculo de la pestaña inicial — solo
 * `tab=invite` tenía su rama, y el alias por PATH `/:community/benefits`
 * (Fase 4, compat) sí funcionaba. Además <Tabs> era no controlado, así que
 * un cambio de query SIN remount (navegación interna, atrás/adelante) no
 * actualizaba la pestaña visible.
 */
const { mockAuthMe, mockHomeSummary, mockStudentsMe, mockUseCommunity, mockMyBenefits, mockMarketplaceList, mockReferralsSummary, noopQuery } = vi.hoisted(() => ({
  mockAuthMe: vi.fn(),
  mockHomeSummary: vi.fn(),
  mockStudentsMe: vi.fn(),
  mockUseCommunity: vi.fn(),
  mockMyBenefits: vi.fn(),
  mockMarketplaceList: vi.fn(),
  mockReferralsSummary: vi.fn(),
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
    benefits: {
      myBenefits: { useQuery: mockMyBenefits },
      marketplaceList: { useQuery: mockMarketplaceList },
    },
    referrals: { mySummary: { useQuery: mockReferralsSummary } },
    useUtils: () => ({ auth: { me: { setData: vi.fn() } } }),
  },
}));

vi.mock("@/contexts/CommunityContext", () => ({
  useCommunity: mockUseCommunity,
}));

import Rewards, { resolveActiveTab } from "./Rewards";

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

function renderAt(path: string, routePattern: string) {
  window.history.pushState({}, "", path);
  return render(
    <Route path={routePattern}>
      <Rewards />
    </Route>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticated();
  mockCommunity();
  mockHomeSummary.mockReturnValue({ data: undefined, isLoading: false });
  mockStudentsMe.mockReturnValue({ data: undefined });
  mockMyBenefits.mockReturnValue({ data: [], isLoading: false });
  mockMarketplaceList.mockReturnValue({ data: { walletBalance: 0, items: [] }, isLoading: false, isError: false, refetch: vi.fn() });
  mockReferralsSummary.mockReturnValue({ data: undefined, isLoading: false, isError: false });
});

afterEach(cleanup);

describe("resolveActiveTab — cálculo puro de la pestaña activa (FIX-03)", () => {
  it("tab=invite → invite", () => {
    expect(resolveActiveTab("invite", "/ie/rewards")).toBe("invite");
  });

  it("REGRESIÓN — tab=benefits (deep-link por query) → benefits, nunca se comprobaba antes del fix", () => {
    expect(resolveActiveTab("benefits", "/ie/rewards")).toBe("benefits");
  });

  it("alias por PATH /:community/benefits (Fase 4, compat) sigue funcionando sin query", () => {
    expect(resolveActiveTab(null, "/ie/benefits")).toBe("benefits");
  });

  it("query inválida (valor desconocido) → spend, nunca lanza ni deja un estado indefinido", () => {
    expect(resolveActiveTab("xyz", "/ie/rewards")).toBe("spend");
  });

  it("sin query y sin alias de path → spend por defecto", () => {
    expect(resolveActiveTab(null, "/ie/rewards")).toBe("spend");
  });
});

describe("Rewards — FIX-03: deep-link ?tab=benefits abre directamente Mis Beneficios", () => {
  it("REGRESIÓN — /ie/rewards?tab=benefits abre la pestaña Beneficios directamente al cargar", () => {
    renderAt("/ie/rewards?tab=benefits", "/:community/rewards");
    const benefitsTab = screen.getByRole("tab", { name: /my benefits|mis beneficios/i });
    expect(benefitsTab).toHaveAttribute("aria-selected", "true");
  });

  it("/ie/rewards?tab=invite sigue abriendo Invitar directamente (sin regresión)", () => {
    renderAt("/ie/rewards?tab=invite", "/:community/rewards");
    const inviteTab = screen.getByRole("tab", { name: /^invite$|^invitar$/i });
    expect(inviteTab).toHaveAttribute("aria-selected", "true");
  });

  it("/ie/benefits (alias por path, sin query) sigue abriendo Beneficios directamente", () => {
    renderAt("/ie/benefits", "/:community/benefits");
    const benefitsTab = screen.getByRole("tab", { name: /my benefits|mis beneficios/i });
    expect(benefitsTab).toHaveAttribute("aria-selected", "true");
  });

  it("/ie/rewards sin query abre Spend (SegoTokens) por defecto", () => {
    renderAt("/ie/rewards", "/:community/rewards");
    const spendTab = screen.getByRole("tab", { name: /spend segotokens|gastar segotokens/i });
    expect(spendTab).toHaveAttribute("aria-selected", "true");
  });

  it("navegación interna: clicar la pestaña Beneficios desde Spend la activa (Tabs controlado, no atascado en el valor inicial)", async () => {
    renderAt("/ie/rewards", "/:community/rewards");
    const user = userEvent.setup();
    const benefitsTab = screen.getByRole("tab", { name: /my benefits|mis beneficios/i });
    await user.click(benefitsTab);
    expect(benefitsTab).toHaveAttribute("aria-selected", "true");
  });
});
