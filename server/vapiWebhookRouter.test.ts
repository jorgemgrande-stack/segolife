/**
 * vapiWebhookRouter.test.ts — SEGOLIFE COMMUNICATION CENTER CONSOLIDATION
 * (Fase 11, spec §33/§57). Antes de esta fase, POST /api/vapi/webhook
 * aceptaba CUALQUIER petición sin secreto configurado (creaba leads/
 * clients/quotes reales) — auditoría confirmó 0 filas reales en vapi_calls
 * en producción y ningún secreto configurado (ni env ni BD), así que nada
 * legítimo dependía de ese comportamiento. Este archivo prueba SOLO la
 * puerta de autenticación (el cambio real de esta fase) — el resto del
 * flujo (creación de lead/presupuesto) es lógica Náyade/Skicenter heredada
 * sin cambios, fuera de alcance de esta fase (mismo criterio que
 * brevoWebhookRoutes.test.ts: Express real + fetch real, sin supertest).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "http";

const { mockCreateLead, mockGenerateDocumentNumber, mockExtractFromTranscript } = vi.hoisted(() => ({
  mockCreateLead: vi.fn().mockResolvedValue(1),
  mockGenerateDocumentNumber: vi.fn().mockResolvedValue("PRE-0001"),
  mockExtractFromTranscript: vi.fn().mockReturnValue({}),
}));

vi.mock("./db", () => ({ createLead: mockCreateLead }));
vi.mock("./documentNumbers", () => ({ generateDocumentNumber: mockGenerateDocumentNumber }));
vi.mock("./routers/vapiCalls", () => ({ extractFromTranscript: mockExtractFromTranscript }));
vi.mock("mysql2/promise", () => ({
  default: {
    createPool: () => ({
      execute: vi.fn().mockResolvedValue([[], []]),
    }),
  },
}));
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => {
    const b: any = {};
    b.insert = () => b;
    b.values = () => Promise.resolve([{ insertId: 1 }]);
    b.onDuplicateKeyUpdate = () => Promise.resolve([{}]);
    b.update = () => b;
    b.set = () => b;
    b.where = () => Promise.resolve([{}]);
    return b;
  },
}));

let server: Server;
let baseUrl: string;

async function startServer() {
  vi.resetModules();
  const vapiWebhookRouter = (await import("./vapiWebhookRouter")).default;
  const app = express();
  app.use(vapiWebhookRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopServer() {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.VAPI_WEBHOOK_SECRET;
  delete process.env.GHL_WEBHOOK_SECRET;
});

afterEach(async () => {
  await stopServer();
  process.env = { ...ORIGINAL_ENV };
});

describe("POST /api/vapi/webhook — puerta de autenticación (Fase 11)", () => {
  it("sin ningún secreto configurado (env/BD/GHL fallback): 503, nunca crea un lead", async () => {
    await startServer();
    const res = await post("/api/vapi/webhook", { email: "test@example.com" });
    expect(res.status).toBe(503);
    expect(mockCreateLead).not.toHaveBeenCalled();
  });

  it("secreto configurado pero header x-vapi-secret ausente/incorrecto: 401, nunca crea un lead", async () => {
    process.env.VAPI_WEBHOOK_SECRET = "real-secret";
    await startServer();
    const res = await post("/api/vapi/webhook", { email: "test@example.com" }, { "x-vapi-secret": "wrong" });
    expect(res.status).toBe(401);
    expect(mockCreateLead).not.toHaveBeenCalled();
  });

  it("secreto configurado y header correcto: pasa la puerta de autenticación (nunca 401/503)", async () => {
    process.env.VAPI_WEBHOOK_SECRET = "real-secret";
    await startServer();
    const res = await post("/api/vapi/webhook", { email: "test@example.com" }, { "x-vapi-secret": "real-secret" });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(503);
    expect(mockCreateLead).toHaveBeenCalledOnce();
  });

  it("acepta también ?secret= en la query string (mismo criterio que header)", async () => {
    process.env.VAPI_WEBHOOK_SECRET = "real-secret";
    await startServer();
    const res = await post("/api/vapi/webhook?secret=real-secret", { email: "test@example.com" });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(503);
  });

  // ─── PRE-16.15 — aislamiento de secretos entre integraciones ───────────────
  it("un GHL_WEBHOOK_SECRET configurado NUNCA autentica VAPI: sin VAPI_WEBHOOK_SECRET propio, sigue siendo 503", async () => {
    process.env.GHL_WEBHOOK_SECRET = "ghl-secret-no-relacionado";
    await startServer();
    const res = await post("/api/vapi/webhook", { email: "test@example.com" }, { "x-vapi-secret": "ghl-secret-no-relacionado" });
    expect(res.status).toBe(503);
    expect(mockCreateLead).not.toHaveBeenCalled();
  });

  it("con VAPI_WEBHOOK_SECRET propio configurado, enviar el GHL_WEBHOOK_SECRET (no relacionado) como credencial se rechaza con 401", async () => {
    process.env.VAPI_WEBHOOK_SECRET = "vapi-secret-real";
    process.env.GHL_WEBHOOK_SECRET = "ghl-secret-no-relacionado";
    await startServer();
    const res = await post("/api/vapi/webhook", { email: "test@example.com" }, { "x-vapi-secret": "ghl-secret-no-relacionado" });
    expect(res.status).toBe(401);
    expect(mockCreateLead).not.toHaveBeenCalled();
  });
});
