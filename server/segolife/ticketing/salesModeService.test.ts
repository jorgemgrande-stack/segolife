/**
 * salesModeService.test.ts — traducción de la modalidad de venta elegida
 * por el admin (Venta en SEGOLIFE / Venta en otra plataforma / Solo
 * información + "combinar") a operaciones sobre sales_channels (rediseño
 * operativo de Admin Ticketing/Sales). Foco: invariante "máximo 1 primary
 * activo por evento" (spec punto 21) y las transiciones de modo/hybrid.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockListSalesChannels, mockCreateSalesChannel, mockUpdateSalesChannel, mockSetSalesChannelStatus } = vi.hoisted(() => ({
  mockListSalesChannels: vi.fn(),
  mockCreateSalesChannel: vi.fn(),
  mockUpdateSalesChannel: vi.fn(),
  mockSetSalesChannelStatus: vi.fn(),
}));
vi.mock("./ticketingDb", () => ({
  listSalesChannels: mockListSalesChannels,
  createSalesChannel: mockCreateSalesChannel,
  updateSalesChannel: mockUpdateSalesChannel,
  setSalesChannelStatus: mockSetSalesChannelStatus,
}));

import { setPrimarySalesChannel, configureSalesMode, SalesModeError } from "./salesModeService";

function makeMockDb({ channelLookup }: { channelLookup?: Record<string, unknown> | null } = {}) {
  const updateCalls: Array<{ fields: unknown }> = [];
  const tx: any = {
    select: () => tx,
    from: () => tx,
    where: () => tx,
    limit: () => Promise.resolve(channelLookup ? [channelLookup] : []),
    update: () => ({ set: (fields: unknown) => ({ where: () => { updateCalls.push({ fields }); return Promise.resolve(); } }) }),
  };
  const db: any = { transaction: async (cb: (tx: unknown) => Promise<void>) => cb(tx) };
  return { db, updateCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateSalesChannel.mockResolvedValue({ id: 100 });
});

describe("setPrimarySalesChannel", () => {
  it("desactiva el primary del resto y activa el del canal elegido, en la misma transacción", async () => {
    const { db, updateCalls } = makeMockDb({ channelLookup: { id: 5, eventId: 10 } });
    await setPrimarySalesChannel(5, db);
    expect(updateCalls.map(c => c.fields)).toEqual([{ isPrimary: false }, { isPrimary: true }]);
  });

  it("canal inexistente → lanza SalesModeError sin tocar nada", async () => {
    const { db, updateCalls } = makeMockDb({ channelLookup: null });
    await expect(setPrimarySalesChannel(999, db)).rejects.toThrow(SalesModeError);
    expect(updateCalls).toHaveLength(0);
  });
});

describe("configureSalesMode", () => {
  it("mode='none' desactiva todos los canales activos — ninguno se borra", async () => {
    mockListSalesChannels.mockResolvedValue([
      { id: 1, salesMode: "native", status: "active" },
      { id: 2, salesMode: "external_redirect", status: "inactive" },
    ]);
    const { db } = makeMockDb();
    await configureSalesMode(10, { mode: "none", hybridEnabled: false }, db);
    expect(mockSetSalesChannelStatus).toHaveBeenCalledTimes(1);
    expect(mockSetSalesChannelStatus).toHaveBeenCalledWith(1, "inactive", expect.anything());
  });

  it("mode='native' sin canal previo → crea uno nuevo activo y lo hace primary", async () => {
    mockListSalesChannels.mockResolvedValue([]);
    mockCreateSalesChannel.mockResolvedValue({ id: 55 });
    const { db, updateCalls } = makeMockDb();
    await configureSalesMode(10, { mode: "native", hybridEnabled: false }, db);
    expect(mockCreateSalesChannel).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 10, channelType: "segolife_native", salesMode: "native", status: "active" }),
      expect.anything()
    );
    expect(updateCalls.map(c => c.fields)).toEqual([{ isPrimary: false }, { isPrimary: true }]);
  });

  it("mode='native' con canal externo activo y hybridEnabled=false → desactiva el externo (nunca hybrid por accidente)", async () => {
    mockListSalesChannels.mockResolvedValue([
      { id: 1, salesMode: "native", status: "inactive" },
      { id: 2, salesMode: "external_redirect", status: "active" },
    ]);
    const { db } = makeMockDb();
    await configureSalesMode(10, { mode: "native", hybridEnabled: false }, db);
    expect(mockSetSalesChannelStatus).toHaveBeenCalledWith(2, "inactive", expect.anything());
  });

  it("mode='native' con canal externo y hybridEnabled=true → mantiene ambos activos", async () => {
    mockListSalesChannels.mockResolvedValue([
      { id: 1, salesMode: "native", status: "inactive" },
      { id: 2, salesMode: "external_redirect", status: "active" },
    ]);
    const { db } = makeMockDb();
    await configureSalesMode(10, { mode: "native", hybridEnabled: true }, db);
    expect(mockSetSalesChannelStatus).toHaveBeenCalledWith(2, "active", expect.anything());
  });

  it("mode='external' sin datos del formulario → lanza SalesModeError", async () => {
    mockListSalesChannels.mockResolvedValue([]);
    const { db } = makeMockDb();
    await expect(configureSalesMode(10, { mode: "external", hybridEnabled: false }, db)).rejects.toThrow(SalesModeError);
  });

  it("mode='external' crea el canal con la URL dada y lo hace primary", async () => {
    mockListSalesChannels.mockResolvedValue([]);
    mockCreateSalesChannel.mockResolvedValue({ id: 77 });
    const { db, updateCalls } = makeMockDb();
    await configureSalesMode(10, {
      mode: "external", hybridEnabled: false,
      external: { channelType: "fourvenues", externalUrl: "https://fourvenues.com/e/1", buttonText: null, openInNewTab: true },
    }, db);
    expect(mockCreateSalesChannel).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 10, channelType: "fourvenues", salesMode: "external_redirect", externalUrl: "https://fourvenues.com/e/1", status: "active" }),
      expect.anything()
    );
    expect(updateCalls.map(c => c.fields)).toEqual([{ isPrimary: false }, { isPrimary: true }]);
  });

  it("mode='external' con URL vacía → guarda el canal con externalUrl=null (config incompleta, nunca inventa una URL)", async () => {
    mockListSalesChannels.mockResolvedValue([]);
    mockCreateSalesChannel.mockResolvedValue({ id: 78 });
    const { db } = makeMockDb();
    await configureSalesMode(10, {
      mode: "external", hybridEnabled: false,
      external: { channelType: "fourvenues", externalUrl: "", buttonText: null, openInNewTab: true },
    }, db);
    expect(mockCreateSalesChannel).toHaveBeenCalledWith(expect.objectContaining({ externalUrl: null }), expect.anything());
  });

  it("mode='external' existente → actualiza en vez de duplicar el canal", async () => {
    mockListSalesChannels.mockResolvedValue([{ id: 9, salesMode: "external_redirect", status: "active", channelType: "fourvenues" }]);
    const { db } = makeMockDb();
    await configureSalesMode(10, {
      mode: "external", hybridEnabled: false,
      external: { channelType: "fourvenues", externalUrl: "https://fourvenues.com/e/2", buttonText: "Comprar", openInNewTab: true },
    }, db);
    expect(mockCreateSalesChannel).not.toHaveBeenCalled();
    expect(mockUpdateSalesChannel).toHaveBeenCalledWith(9, expect.objectContaining({ externalUrl: "https://fourvenues.com/e/2" }), expect.anything());
  });
});
