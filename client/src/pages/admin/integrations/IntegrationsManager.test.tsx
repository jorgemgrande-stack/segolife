import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

/**
 * IntegrationsManager.test.tsx — NEXT-01 (petición explícita del cliente):
 * la lista de integraciones Fourvenues debe mostrar el NOMBRE real del
 * venue (Casanova, Limoncello, Tía Felisa, La Finca Club...) en vez de solo
 * "venue #id". Resuelto dinámicamente contra venues.list (fuente canónica),
 * nunca un mapa VENUE_NAMES hardcodeado — soporta cualquier venue futuro
 * sin tocar este componente (mismo criterio ya aplicado en
 * HistoricalIdentities.tsx).
 */

const { mockVenueIntegrations, mockEventIntegrations, mockVenuesList, mockEventsList } = vi.hoisted(() => ({
  mockVenueIntegrations: vi.fn(),
  mockEventIntegrations: vi.fn(),
  mockVenuesList: vi.fn(),
  mockEventsList: vi.fn(),
}));

vi.mock("@/components/AdminLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    integrations: {
      getGlobalStatus: { useQuery: () => ({ data: undefined }) },
      listProviders: { useQuery: () => ({ data: [{ id: 1, key: "fourvenues_integrations", name: "Fourvenues Integrations API" }] }) },
      listVenueIntegrations: { useQuery: mockVenueIntegrations },
      listEventIntegrations: { useQuery: mockEventIntegrations },
      getSchedulerStatus: { useQuery: () => ({ data: undefined }) },
      createVenueIntegration: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      createEventIntegration: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      testVenueConnection: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      testEventConnection: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setVenueIntegrationEnabled: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      updateVenueIntegrationCredentials: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setEventIntegrationEnabled: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      previewVenueSync: { useMutation: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }) },
      syncVenueNow: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    venues: { list: { useQuery: mockVenuesList } },
    events: { list: { useQuery: mockEventsList } },
    useUtils: () => ({
      integrations: {
        listVenueIntegrations: { invalidate: vi.fn() },
        listEventIntegrations: { invalidate: vi.fn() },
      },
    }),
  },
}));

import IntegrationsManager from "./IntegrationsManager";

beforeEach(() => {
  vi.clearAllMocks();
  mockEventIntegrations.mockReturnValue({ data: [], isLoading: false });
  mockEventsList.mockReturnValue({ data: { items: [] } });
  mockVenuesList.mockReturnValue({
    data: { items: [{ id: 1, name: "Casanova" }, { id: 3, name: "La Finca Club" }] },
  });
});

afterEach(() => cleanup());

describe("IntegrationsManager — nombre real del venue (NEXT-01)", () => {
  it("muestra el nombre real del venue en vez de 'venue #id'", () => {
    mockVenueIntegrations.mockReturnValue({
      data: [{ id: 4, venueId: 3, providerKey: "fourvenues_integrations", environment: "production", enabled: true, status: "connected", credentialsConfigured: true, credentialsLast4: "abcd" }],
      isLoading: false,
    });
    render(<IntegrationsManager />);
    expect(screen.getByText(/La Finca Club/)).toBeInTheDocument();
    expect(screen.queryByText(/venue #3/)).not.toBeInTheDocument();
  });

  it("si el venue no está (aún) en venues.list, cae de forma segura a 'venue #id' en vez de romper o mostrar vacío", () => {
    mockVenueIntegrations.mockReturnValue({
      data: [{ id: 9, venueId: 999, providerKey: "fourvenues_integrations", environment: "sandbox", enabled: false, status: "configured", credentialsConfigured: false, credentialsLast4: null }],
      isLoading: false,
    });
    render(<IntegrationsManager />);
    expect(screen.getByText(/venue #999/)).toBeInTheDocument();
  });

  it("soporta un venue nuevo sin ningún cambio de código — nunca un mapa hardcodeado de nombres", () => {
    mockVenuesList.mockReturnValue({
      data: { items: [{ id: 42, name: "Un Venue Completamente Nuevo" }] },
    });
    mockVenueIntegrations.mockReturnValue({
      data: [{ id: 10, venueId: 42, providerKey: "fourvenues_integrations", environment: "production", enabled: true, status: "connected", credentialsConfigured: true, credentialsLast4: "wxyz" }],
      isLoading: false,
    });
    render(<IntegrationsManager />);
    expect(screen.getByText(/Un Venue Completamente Nuevo/)).toBeInTheDocument();
  });
});
