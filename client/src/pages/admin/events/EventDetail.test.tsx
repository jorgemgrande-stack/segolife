/**
 * EventDetail.test.tsx — FIX-06. Primer test de este fichero. Cubre
 * exclusivamente lo NUEVO (switch "Oculto", botón "Eliminar" + diálogo,
 * aviso de campos PROVIDER-MANAGED de Fourvenues) — el resto de la ficha
 * (pestañas de ticketing/ventas/attendance/integrations) no se monta en el
 * render inicial (Radix Tabs solo monta la pestaña activa, "general" por
 * defecto), así que no hace falta mockear sus queries.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockGetById, mockSetHidden, mockDelete, noopQuery } = vi.hoisted(() => ({
  mockGetById: vi.fn(),
  mockSetHidden: vi.fn(),
  mockDelete: vi.fn(),
  noopQuery: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    events: {
      getById: { useQuery: mockGetById },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setActive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setFeatured: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setHidden: { useMutation: (opts: { onSuccess?: () => void }) => ({ mutate: (...a: unknown[]) => { mockSetHidden(...a); opts.onSuccess?.(); }, isPending: false }) },
      setCommunities: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      delete: { useMutation: (opts: { onSuccess?: () => void }) => ({ mutate: (...a: unknown[]) => { mockDelete(...a); opts.onSuccess?.(); }, isPending: false }) },
    },
    venues: { publicActive: { useQuery: noopQuery } },
    communities: { list: { useQuery: noopQuery } },
    integrations: { listVenueIntegrations: { useQuery: noopQuery } },
    useUtils: () => ({ events: { getById: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } }),
  },
}));
vi.mock("@/components/AdminLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("wouter", () => ({
  useParams: () => ({ id: "1" }),
  useLocation: () => ["/admin/events/1", vi.fn()],
}));

import EventDetail from "./EventDetail";

function baseDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event: {
      id: 1, name: "Torneo de pádel", slug: "torneo-de-padel", description: null, venueId: null,
      startsAt: new Date("2026-09-15T20:00:00Z"), endsAt: null, capacity: null, imageUrl: null,
      status: "active", isFeatured: false, isHidden: false, sourceType: null, sourcePublicationStatus: null,
      ...overrides,
    },
    venue: null, communities: [],
  };
}

afterEach(() => cleanup());

describe("EventDetail — switch 'Oculto' (FIX-06)", () => {
  it("evento visible: el switch aparece desactivado", () => {
    mockGetById.mockReturnValue({ data: baseDetail(), isLoading: false, error: null });
    render(<EventDetail />);
    const switches = screen.getAllByRole("switch");
    // Activo, Destacado, Oculto (en ese orden) — el 3º es el nuevo.
    expect(switches).toHaveLength(3);
    expect(switches[2]).toHaveAttribute("aria-checked", "false");
  });

  it("evento ya oculto: el switch aparece activado", () => {
    mockGetById.mockReturnValue({ data: baseDetail({ isHidden: true }), isLoading: false, error: null });
    render(<EventDetail />);
    const switches = screen.getAllByRole("switch");
    expect(switches[2]).toHaveAttribute("aria-checked", "true");
  });

  it("activar el switch llama a setHidden({ id, hidden: true })", async () => {
    mockGetById.mockReturnValue({ data: baseDetail(), isLoading: false, error: null });
    render(<EventDetail />);
    const user = userEvent.setup();
    const switches = screen.getAllByRole("switch");
    await user.click(switches[2]);
    expect(mockSetHidden).toHaveBeenCalledWith({ id: 1, hidden: true });
  });
});

describe("EventDetail — botón Eliminar + diálogo (FIX-06)", () => {
  it("pulsar Eliminar abre el diálogo de confirmación, nunca elimina al primer click", async () => {
    mockGetById.mockReturnValue({ data: baseDetail(), isLoading: false, error: null });
    render(<EventDetail />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^eliminar$/i }));
    expect(await screen.findByText(/¿eliminar este evento\?/i)).toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("confirmar en el diálogo llama a delete con el id real de la ficha", async () => {
    mockGetById.mockReturnValue({ data: baseDetail(), isLoading: false, error: null });
    render(<EventDetail />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^eliminar$/i }));
    await screen.findByText(/¿eliminar este evento\?/i);
    await user.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(mockDelete).toHaveBeenCalledWith({ id: 1 });
  });
});

describe("EventDetail — aviso de campos PROVIDER-MANAGED (FIX-06, spec §6)", () => {
  it("evento nativo (sin sourceType): nunca muestra el bloque de origen Fourvenues ni su aviso", () => {
    mockGetById.mockReturnValue({ data: baseDetail(), isLoading: false, error: null });
    render(<EventDetail />);
    expect(screen.queryByText(/origen — fourvenues/i)).not.toBeInTheDocument();
  });

  it("evento Fourvenues: muestra el aviso de que Inicio/Fin se sobrescriben en el próximo sync", () => {
    mockGetById.mockReturnValue({
      data: baseDetail({ sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "published" }),
      isLoading: false, error: null,
    });
    render(<EventDetail />);
    expect(screen.getByText(/origen — fourvenues/i)).toBeInTheDocument();
    expect(screen.getByText(/se sobrescribirá en la/i)).toBeInTheDocument();
  });
});
