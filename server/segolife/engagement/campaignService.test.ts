/**
 * campaignService.test.ts — ciclo de vida de campañas (spec puntos 23-25,
 * 70-71): crear SIEMPRE deja en draft (nunca envía nada), cancelar solo
 * desde draft/scheduled, programar fija el snapshot de audiencia en ESE
 * momento, enviar-ya llama a createNotification una vez por (usuario ×
 * mensaje) de forma deduplicada. resolveAudience/createNotification se
 * mockean vía vi.mock (mismo patrón que commercePipeline.test.ts) porque
 * campaignService.ts las importa directamente, no son inyectables.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockResolveAudience, mockCreateNotification } = vi.hoisted(() => ({
  mockResolveAudience: vi.fn(),
  mockCreateNotification: vi.fn(),
}));
vi.mock("./audienceEngine", () => ({ resolveAudience: mockResolveAudience }));
vi.mock("./notificationService", () => ({ createNotification: mockCreateNotification }));

import { createCampaign, scheduleCampaign, cancelCampaign, sendCampaignNow, CampaignError } from "./campaignService";
import { engagementCampaigns, engagementCampaignAudiences, engagementCampaignMessages } from "../../../drizzle/schema";

const DEFAULT_MESSAGE = { channel: "in_app", category: "promotions", titleEn: "T", titleEs: "T", bodyEn: "B", bodyEs: "B", deepLink: null };

function makeMockDb(config: { campaign?: any; presetAudienceUserIds?: number[]; presetMessages?: any[] } = {}) {
  const campaignRows: any[] = config.campaign ? [config.campaign] : [];
  const audienceRows: any[] = (config.presetAudienceUserIds ?? []).map(userId => ({ campaignId: config.campaign?.id, userId }));
  const messageRows: any[] = config.presetMessages ?? [];
  let nextCampaignId = config.campaign ? config.campaign.id + 1 : 1;

  let mode: "select" | "insert" | "update" = "select";
  let table: "campaigns" | "audiences" | "messages" = "campaigns";
  let pendingSet: Record<string, unknown> = {};

  const b: any = {};
  b.select = () => { mode = "select"; return b; };
  b.from = (t: unknown) => {
    table = t === engagementCampaigns ? "campaigns" : t === engagementCampaignAudiences ? "audiences" : "messages";
    return b;
  };
  b.insert = (t: unknown) => {
    mode = "insert";
    table = t === engagementCampaigns ? "campaigns" : t === engagementCampaignAudiences ? "audiences" : "messages";
    return b;
  };
  b.update = (t: unknown) => { mode = "update"; table = t === engagementCampaigns ? "campaigns" : "audiences"; return b; };
  b.ignore = () => b;
  b.set = (fields: Record<string, unknown>) => { pendingSet = fields; return b; };
  b.where = () => {
    if (mode === "update" && table === "campaigns") {
      Object.assign(campaignRows[0] ?? {}, pendingSet);
      return Promise.resolve([{}]);
    }
    return b;
  };
  b.limit = (_n: number) => {
    if (table === "campaigns") return Promise.resolve(campaignRows.slice(0, 1));
    return Promise.resolve([]);
  };
  b.values = (v: Record<string, unknown> | Array<Record<string, unknown>>) => {
    const values = Array.isArray(v) ? v : [v];
    if (table === "campaigns") {
      const row = { id: nextCampaignId++, status: "draft", audienceSnapshotAt: null, ...values[0] };
      campaignRows.push(row);
      return Promise.resolve([{ insertId: row.id }]);
    }
    if (table === "audiences") { audienceRows.push(...values); return Promise.resolve([{}]); }
    messageRows.push(...values);
    return Promise.resolve([{}]);
  };
  // Consultas que terminan en .where() sin .limit() (getCampaignMessages, y el
  // re-listado de audiencia ya snapshotada) — thenable directo sobre la tabla activa.
  b.then = (resolve: (v: unknown) => void) => resolve(table === "messages" ? messageRows : table === "audiences" ? audienceRows : []);
  return { db: b as any, campaignRows, audienceRows, messageRows };
}

beforeEach(() => {
  mockResolveAudience.mockReset();
  mockCreateNotification.mockReset();
  mockCreateNotification.mockResolvedValue({ status: "created", notification: { id: 1 } });
});

describe("campaignService — createCampaign", () => {
  it("crea la campaña SIEMPRE en estado draft — crear nunca envía nada", async () => {
    const { db, campaignRows } = makeMockDb();
    const campaign = await createCampaign({
      name: "Test", type: "manual", communityId: null, audienceDefinition: { communityIds: [1] },
      createdByUserId: 1, messages: [{ channel: "in_app", category: "promotions", titleEn: "T", titleEs: "T", bodyEn: "B", bodyEs: "B" }],
    }, db);
    expect(campaign.status).toBe("draft");
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(campaignRows).toHaveLength(1);
  });
});

describe("campaignService — cancelCampaign", () => {
  it("cancela una campaña draft", async () => {
    const { db } = makeMockDb({ campaign: { id: 1, status: "draft" } });
    const cancelled = await cancelCampaign(1, 9, db);
    expect(cancelled.status).toBe("cancelled");
  });

  it("rechaza cancelar una campaña ya completed (CampaignError INVALID_STATE)", async () => {
    const { db } = makeMockDb({ campaign: { id: 1, status: "completed" } });
    await expect(cancelCampaign(1, 9, db)).rejects.toBeInstanceOf(CampaignError);
  });

  it("rechaza cancelar una campaña inexistente (NOT_FOUND)", async () => {
    const { db } = makeMockDb();
    await expect(cancelCampaign(999, 9, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("campaignService — scheduleCampaign", () => {
  it("solo puede programarse una campaña draft, y fija audienceSnapshotAt en ese momento", async () => {
    mockResolveAudience.mockResolvedValue([1, 2, 3]);
    const { db, campaignRows } = makeMockDb({ campaign: { id: 1, status: "draft", audienceDefinition: { communityIds: [1] } } });
    const scheduled = await scheduleCampaign(1, new Date("2026-09-01T20:00:00Z"), db);
    expect(scheduled.status).toBe("scheduled");
    expect(campaignRows[0].audienceSnapshotAt).toBeTruthy();
    expect(mockResolveAudience).toHaveBeenCalledTimes(1);
  });

  it("rechaza programar una campaña que ya no está en draft", async () => {
    const { db } = makeMockDb({ campaign: { id: 1, status: "scheduled" } });
    await expect(scheduleCampaign(1, new Date(), db)).rejects.toBeInstanceOf(CampaignError);
  });
});

describe("campaignService — sendCampaignNow", () => {
  it("crea una notificación por cada (usuario × mensaje), con idempotencyKey determinista", async () => {
    mockResolveAudience.mockResolvedValue([10, 20]);
    const { db } = makeMockDb({
      campaign: { id: 5, status: "draft", communityId: null, audienceDefinition: { communityIds: [1] }, audienceSnapshotAt: null },
      presetMessages: [DEFAULT_MESSAGE],
    });
    const result = await sendCampaignNow(5, db);
    expect(result.notified).toBe(2);
    expect(mockCreateNotification).toHaveBeenCalledTimes(2); // 2 usuarios × 1 mensaje in_app
    const keys = mockCreateNotification.mock.calls.map(c => c[0].idempotencyKey);
    expect(new Set(keys).size).toBe(2); // claves únicas -> nunca doble notificación por el mismo (usuario, canal)
    expect(keys).toEqual(["campaign:5:10:in_app", "campaign:5:20:in_app"]);
  });

  it("una campaña ya programada usa el snapshot de audiencia persistido, no re-resuelve", async () => {
    const { db } = makeMockDb({
      campaign: { id: 5, status: "scheduled", communityId: null, audienceDefinition: { communityIds: [1] }, audienceSnapshotAt: new Date() },
      presetAudienceUserIds: [10, 20],
      presetMessages: [DEFAULT_MESSAGE],
    });
    const result = await sendCampaignNow(5, db);
    expect(mockResolveAudience).not.toHaveBeenCalled();
    expect(result.notified).toBe(2);
  });

  it("rechaza reenviar una campaña ya completed/cancelled", async () => {
    const { db } = makeMockDb({ campaign: { id: 5, status: "completed" } });
    await expect(sendCampaignNow(5, db)).rejects.toBeInstanceOf(CampaignError);
  });

  // Communication Center (spec §29) — audiencia mayor que CAMPAIGN_BATCH_SIZE
  // (20): el envío en lotes con pausa entre ellos no debe perder ni duplicar
  // a nadie — mismo total exacto que sin batching.
  it("una audiencia de 45 (> 1 lote de 20) notifica exactamente a los 45, sin perder ni duplicar a nadie", async () => {
    const userIds = Array.from({ length: 45 }, (_, i) => i + 1);
    mockResolveAudience.mockResolvedValue(userIds);
    const { db } = makeMockDb({
      campaign: { id: 9, status: "draft", communityId: null, audienceDefinition: { communityIds: [1] }, audienceSnapshotAt: null },
      presetMessages: [DEFAULT_MESSAGE],
    });
    const result = await sendCampaignNow(9, db);
    expect(result.notified).toBe(45);
    expect(mockCreateNotification).toHaveBeenCalledTimes(45);
    const notifiedUserIds = mockCreateNotification.mock.calls.map(c => c[0].userId);
    expect(new Set(notifiedUserIds).size).toBe(45);
  }, 10000);
});
