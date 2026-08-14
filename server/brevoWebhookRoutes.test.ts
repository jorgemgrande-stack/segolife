/**
 * brevoWebhookRoutes.test.ts — Communication Center, webhook de entrega de
 * Brevo (spec §20). Express real sobre un puerto efímero + fetch real
 * (mismo criterio que healthRouter.test.ts — evita añadir supertest, no
 * instalado en este proyecto). Las dependencias de BD/servicio se mockean
 * para aislar solo el enrutado/mapeo de este archivo.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "http";

const { mockSuppressEmail, tableRows } = vi.hoisted(() => ({
  mockSuppressEmail: vi.fn().mockResolvedValue(undefined),
  tableRows: { deliveries: [] as any[] },
}));

vi.mock("./segolife/engagement/emailSuppressionService", () => ({ suppressEmail: mockSuppressEmail }));
vi.mock("mysql2/promise", () => ({ default: { createPool: () => ({}) } }));
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => {
    const b: any = {};
    let mode: "select" | "update" = "select";
    let pendingSet: Record<string, unknown> = {};
    b.select = () => { mode = "select"; return b; };
    b.from = () => b;
    b.update = () => { mode = "update"; return b; };
    b.set = (fields: Record<string, unknown>) => { pendingSet = fields; return b; };
    b.where = () => {
      if (mode === "update") {
        if (tableRows.deliveries[0]) Object.assign(tableRows.deliveries[0], pendingSet);
        return Promise.resolve([{}]);
      }
      return b;
    };
    b.limit = () => Promise.resolve(tableRows.deliveries);
    return b;
  },
}));

const TOKEN = "test-secret-token";
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.BREVO_WEBHOOK_TOKEN = TOKEN;
  const brevoWebhookRouter = (await import("./brevoWebhookRoutes")).default;
  const app = express();
  app.use(brevoWebhookRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSuppressEmail.mockResolvedValue(undefined);
  process.env.BREVO_WEBHOOK_TOKEN = TOKEN;
  tableRows.deliveries = [{ id: 1, externalMessageId: "brevo-msg-1", status: "sent" }];
});

describe("POST /api/engagement/brevo-webhook — autenticidad", () => {
  it("sin BREVO_WEBHOOK_TOKEN configurado, 503 — nunca acepta por defecto", async () => {
    delete process.env.BREVO_WEBHOOK_TOKEN;
    const res = await post("/api/engagement/brevo-webhook", { event: "delivered", "message-id": "x" });
    expect(res.status).toBe(503);
  });

  it("token incorrecto o ausente, 401", async () => {
    const res = await post("/api/engagement/brevo-webhook?token=wrong", { event: "delivered", "message-id": "x" });
    expect(res.status).toBe(401);
  });

  it("token correcto, procesa el evento", async () => {
    const res = await post(`/api/engagement/brevo-webhook?token=${TOKEN}`, { event: "delivered", "message-id": "brevo-msg-1", email: "x@example.invalid" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].handled).toBe(true);
  });
});

describe("POST /api/engagement/brevo-webhook — mapeo de eventos", () => {
  it("delivered → status=delivered + deliveredAt", async () => {
    await post(`/api/engagement/brevo-webhook?token=${TOKEN}`, { event: "delivered", "message-id": "brevo-msg-1" });
    expect(tableRows.deliveries[0].status).toBe("delivered");
    expect(tableRows.deliveries[0].deliveredAt).toBeInstanceOf(Date);
  });

  it("opened → openedAt, sin tocar status", async () => {
    await post(`/api/engagement/brevo-webhook?token=${TOKEN}`, { event: "opened", "message-id": "brevo-msg-1" });
    expect(tableRows.deliveries[0].openedAt).toBeInstanceOf(Date);
    expect(tableRows.deliveries[0].status).toBe("sent");
  });

  it("click → clickedAt", async () => {
    await post(`/api/engagement/brevo-webhook?token=${TOKEN}`, { event: "click", "message-id": "brevo-msg-1" });
    expect(tableRows.deliveries[0].clickedAt).toBeInstanceOf(Date);
  });

  it("hard_bounce → status=failed + suprime el email", async () => {
    await post(`/api/engagement/brevo-webhook?token=${TOKEN}`, { event: "hard_bounce", "message-id": "brevo-msg-1", email: "bounced@example.invalid" });
    expect(tableRows.deliveries[0].status).toBe("failed");
    expect(mockSuppressEmail).toHaveBeenCalledWith({ email: "bounced@example.invalid", reason: "hard_bounce", source: "brevo_webhook" });
  });

  it("blocked → status=failed + suprime el email", async () => {
    await post(`/api/engagement/brevo-webhook?token=${TOKEN}`, { event: "blocked", "message-id": "brevo-msg-1", email: "blocked@example.invalid" });
    expect(tableRows.deliveries[0].status).toBe("failed");
    expect(mockSuppressEmail).toHaveBeenCalledWith({ email: "blocked@example.invalid", reason: "blocked", source: "brevo_webhook" });
  });

  it("spam → suprime, NUNCA marca failed (el email sí se entregó)", async () => {
    await post(`/api/engagement/brevo-webhook?token=${TOKEN}`, { event: "spam", "message-id": "brevo-msg-1", email: "spammer-report@example.invalid" });
    expect(tableRows.deliveries[0].status).toBe("sent"); // sin cambiar
    expect(mockSuppressEmail).toHaveBeenCalledWith({ email: "spammer-report@example.invalid", reason: "spam", source: "brevo_webhook" });
  });

  it("soft_bounce → NO suprime (transitorio, distinto de hard bounce)", async () => {
    await post(`/api/engagement/brevo-webhook?token=${TOKEN}`, { event: "soft_bounce", "message-id": "brevo-msg-1", email: "temp-fail@example.invalid" });
    expect(mockSuppressEmail).not.toHaveBeenCalled();
    expect(tableRows.deliveries[0].status).toBe("sent");
  });

  it("delivery no encontrada por externalMessageId → handled:false, nunca lanza", async () => {
    tableRows.deliveries = []; // simula que ningún delivery real tiene ese external_message_id
    const res = await post(`/api/engagement/brevo-webhook?token=${TOKEN}`, { event: "delivered", "message-id": "no-existe" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].handled).toBe(false);
    expect(body.results[0].reason).toBe("delivery_not_found");
  });

  it("evento sin message-id → handled:false", async () => {
    const res = await post(`/api/engagement/brevo-webhook?token=${TOKEN}`, { event: "delivered" });
    const body = await res.json();
    expect(body.results[0].reason).toBe("no_message_id");
  });

  it("array de eventos (Brevo puede batchear), procesa todos", async () => {
    const res = await post(`/api/engagement/brevo-webhook?token=${TOKEN}`, [
      { event: "delivered", "message-id": "brevo-msg-1" },
      { event: "opened", "message-id": "brevo-msg-1" },
    ]);
    const body = await res.json();
    expect(body.processed).toBe(2);
  });

  it("reprocesar el MISMO evento (reenvío de Brevo) es idempotente — nunca lanza, nunca duplica nada", async () => {
    await post(`/api/engagement/brevo-webhook?token=${TOKEN}`, { event: "delivered", "message-id": "brevo-msg-1" });
    const res2 = await post(`/api/engagement/brevo-webhook?token=${TOKEN}`, { event: "delivered", "message-id": "brevo-msg-1" });
    expect(res2.status).toBe(200);
    const body = await res2.json();
    expect(body.results[0].handled).toBe(true);
  });
});
