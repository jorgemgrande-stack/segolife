/**
 * ghlWebhookRouter.test.ts — Fase 16 (auditoría de seguridad). Antes de este
 * fix, POST /api/ghl/webhook aceptaba CUALQUIER petición sin secreto cuando
 * GHL_LEAD_WEBHOOK_SECRET no estaba configurado (el estado real en
 * producción hoy — no aparece en las variables de entorno de Segolife) y
 * creaba un lead real en BD a partir de datos controlados por el atacante.
 * Mismo criterio ya aplicado a vapiWebhookRouter.ts: 503 si no hay secreto
 * configurado, 401 si no coincide, nunca "si no hay secreto, aceptar todo".
 * Este archivo prueba SOLO la puerta de autenticación (el cambio real de
 * esta fase) — el resto del flujo (creación de lead) es lógica Náyade/
 * Skicenter heredada sin cambios, fuera de alcance (mismo patrón que
 * vapiWebhookRouter.test.ts/brevoWebhookRoutes.test.ts: Express real + fetch
 * real, sin supertest).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "http";

const { mockCreateLead } = vi.hoisted(() => ({
  mockCreateLead: vi.fn().mockResolvedValue(1),
}));

vi.mock("./db", () => ({ createLead: mockCreateLead }));
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
  const ghlWebhookRouter = (await import("./ghlWebhookRouter")).default;
  const app = express();
  app.use(ghlWebhookRouter);
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
  delete process.env.GHL_LEAD_WEBHOOK_SECRET;
});

afterEach(async () => {
  await stopServer();
  process.env = { ...ORIGINAL_ENV };
});

describe("POST /api/ghl/webhook — puerta de autenticación (Fase 16)", () => {
  it("sin GHL_LEAD_WEBHOOK_SECRET configurado: 503, nunca crea un lead", async () => {
    await startServer();
    const res = await post("/api/ghl/webhook", { type: "ContactCreate", email: "test@example.com" });
    expect(res.status).toBe(503);
    expect(mockCreateLead).not.toHaveBeenCalled();
  });

  it("secreto configurado pero header x-ghl-secret ausente/incorrecto: 401, nunca crea un lead", async () => {
    process.env.GHL_LEAD_WEBHOOK_SECRET = "real-secret";
    await startServer();
    const res = await post("/api/ghl/webhook", { type: "ContactCreate", email: "test@example.com" }, { "x-ghl-secret": "wrong" });
    expect(res.status).toBe(401);
    expect(mockCreateLead).not.toHaveBeenCalled();
  });

  it("secreto configurado y header correcto: pasa la puerta de autenticación (nunca 401/503)", async () => {
    process.env.GHL_LEAD_WEBHOOK_SECRET = "real-secret";
    await startServer();
    const res = await post("/api/ghl/webhook", { type: "ContactCreate", email: "test@example.com" }, { "x-ghl-secret": "real-secret" });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(503);
  });

  it("acepta también ?secret= en la query string (mismo criterio que header)", async () => {
    process.env.GHL_LEAD_WEBHOOK_SECRET = "real-secret";
    await startServer();
    const res = await post("/api/ghl/webhook?secret=real-secret", { type: "ContactCreate", email: "test@example.com" });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(503);
  });
});
