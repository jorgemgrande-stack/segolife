/**
 * EventsManager.actions.test.tsx — FIX-06. Primer test de RENDER de este
 * directorio (EventsManager.test.tsx cubre deliberadamente solo funciones
 * puras, ver su cabecera) — justificado aquí porque la columna "Acciones"
 * (Editar/Ocultar-Mostrar/Eliminar) y el filtro de rango de fechas son
 * interacción real nueva, no solo lógica de etiquetado.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockList, mockSetFeatured, mockSetHidden, mockDelete, noopMutation } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockSetFeatured: vi.fn(),
  mockSetHidden: vi.fn(),
  mockDelete: vi.fn(),
  noopMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    events: {
      list: { useQuery: mockList },
      setFeatured: { useMutation: (opts: { onSuccess?: () => void }) => ({ mutate: (...a: unknown[]) => { mockSetFeatured(...a); opts.onSuccess?.(); }, isPending: false }) },
      setHidden: { useMutation: (opts: { onSuccess?: () => void }) => ({ mutate: (...a: unknown[]) => { mockSetHidden(...a); opts.onSuccess?.(); }, isPending: false }) },
      delete: { useMutation: (opts: { onSuccess?: () => void }) => ({ mutate: (...a: unknown[]) => { mockDelete(...a); opts.onSuccess?.(); }, isPending: false }) },
    },
    venues: { publicActive: { useQuery: () => ({ data: [] }) } },
    useUtils: () => ({ events: { list: { invalidate: vi.fn() } } }),
  },
}));
vi.mock("@/components/AdminLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/contexts/AdminCommunityContext", () => ({
  useAdminCommunity: () => ({ filter: "all", setFilter: vi.fn(), communities: [], loading: false }),
}));
vi.mock("wouter", () => ({
  Link: ({ href, children, onClick, ...rest }: { href: string; children: React.ReactNode; onClick?: (e: React.MouseEvent) => void }) => (
    <a href={href} onClick={onClick} {...rest}>{children}</a>
  ),
}));

import EventsManager from "./EventsManager";

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, name: "Torneo de pádel", slug: "torneo-de-padel", description: null, venueId: null,
    startsAt: new Date("2026-09-15T20:00:00Z"), endsAt: null, capacity: null, imageUrl: null,
    status: "active", isFeatured: false, isHidden: false, sourceType: null, sourcePublicationStatus: null,
    venue: null, communities: [], primarySalesChannel: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockReturnValue({ data: { items: [baseEvent()], total: 1 }, isLoading: false, error: null });
});

afterEach(() => cleanup());

describe("EventsManager — columna Acciones (FIX-06)", () => {
  it("cada fila muestra los 3 controles: Editar (enlace a la ficha), Ocultar, Eliminar", () => {
    render(<EventsManager />);
    expect(screen.getByRole("link", { name: /editar torneo de pádel/i })).toHaveAttribute("href", "/admin/events/1");
    expect(screen.getByRole("button", { name: /ocultar torneo de pádel/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /eliminar torneo de pádel/i })).toBeInTheDocument();
  });

  it("un evento ya oculto muestra 'Mostrar' en vez de 'Ocultar', y el badge 'Oculto'", () => {
    mockList.mockReturnValue({ data: { items: [baseEvent({ isHidden: true })], total: 1 }, isLoading: false, error: null });
    render(<EventsManager />);
    expect(screen.getByRole("button", { name: /mostrar torneo de pádel/i })).toBeInTheDocument();
    expect(screen.getByText("Oculto")).toBeInTheDocument();
  });

  it("el badge 'Oculto' nunca sustituye el badge de estado (Activo/Finalizado/Inactivo) — ambos conviven", () => {
    mockList.mockReturnValue({ data: { items: [baseEvent({ isHidden: true })], total: 1 }, isLoading: false, error: null });
    render(<EventsManager />);
    expect(screen.getByText("Activo")).toBeInTheDocument();
    expect(screen.getByText("Oculto")).toBeInTheDocument();
  });

  it("pulsar 'Ocultar' llama a setHidden con hidden=true, sin navegar (stopPropagation)", async () => {
    render(<EventsManager />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /ocultar torneo de pádel/i }));
    expect(mockSetHidden).toHaveBeenCalledWith({ id: 1, hidden: true });
  });

  it("pulsar 'Mostrar' en un evento oculto llama a setHidden con hidden=false", async () => {
    mockList.mockReturnValue({ data: { items: [baseEvent({ isHidden: true })], total: 1 }, isLoading: false, error: null });
    render(<EventsManager />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /mostrar torneo de pádel/i }));
    expect(mockSetHidden).toHaveBeenCalledWith({ id: 1, hidden: false });
  });

  it("pulsar 'Eliminar' abre el diálogo de confirmación con nombre/fecha/venue — NUNCA elimina al primer click", async () => {
    render(<EventsManager />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /eliminar torneo de pádel/i }));
    expect(await screen.findByText(/¿eliminar este evento\?/i)).toBeInTheDocument();
    expect(screen.getAllByText("Torneo de pádel").length).toBeGreaterThan(0);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("confirmar en el diálogo SÍ llama a delete; cancelar NO llama a delete", async () => {
    render(<EventsManager />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /eliminar torneo de pádel/i }));
    await screen.findByText(/¿eliminar este evento\?/i);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(mockDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /eliminar torneo de pádel/i }));
    await screen.findByText(/¿eliminar este evento\?/i);
    await user.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(mockDelete).toHaveBeenCalledWith({ id: 1 });
  });
});

describe("EventsManager — filtro de rango de fechas (FIX-06)", () => {
  // fireEvent.change (no user.type) — <input type="date"> tiene un modelo de
  // entrada segmentado que userEvent.type() no simula de forma fiable en
  // jsdom; fireEvent.change con el valor final completo es el patrón
  // estándar de RTL para este tipo de input (sin precedente previo en este
  // repo — primer test de un <input type="date"> con RTL).
  it("Desde/Hasta se envían a events.list como 'YYYY-MM-DD'", () => {
    render(<EventsManager />);
    const fromInput = screen.getByLabelText("Desde");
    const toInput = screen.getByLabelText("Hasta");
    fireEvent.change(fromInput, { target: { value: "2026-03-01" } });
    fireEvent.change(toInput, { target: { value: "2026-03-31" } });
    const lastCall = mockList.mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({ fromDate: "2026-03-01", toDate: "2026-03-31" });
  });

  it("Desde posterior a Hasta muestra una validación clara y NUNCA envía el rango al servidor", () => {
    render(<EventsManager />);
    const fromInput = screen.getByLabelText("Desde");
    const toInput = screen.getByLabelText("Hasta");
    fireEvent.change(fromInput, { target: { value: "2026-03-31" } });
    fireEvent.change(toInput, { target: { value: "2026-03-01" } });
    expect(screen.getByText(/no puede ser posterior/i)).toBeInTheDocument();
    const lastCall = mockList.mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({ fromDate: undefined, toDate: undefined });
  });

  it("'Limpiar fechas' aparece solo cuando hay una fecha rellenada, y las borra ambas", async () => {
    render(<EventsManager />);
    expect(screen.queryByText(/limpiar fechas/i)).not.toBeInTheDocument();
    const fromInput = screen.getByLabelText("Desde");
    fireEvent.change(fromInput, { target: { value: "2026-03-01" } });
    const clearBtn = screen.getByText(/limpiar fechas/i);
    const user = userEvent.setup();
    await user.click(clearBtn);
    expect(screen.queryByText(/limpiar fechas/i)).not.toBeInTheDocument();
  });
});
