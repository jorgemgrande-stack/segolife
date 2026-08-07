/**
 * healthRouter.test.ts — /api/health (liveness) y /api/ready (readiness).
 *
 * Integración real (Express real, HTTP real sobre un puerto efímero) en vez
 * de mockear req/res: son endpoints tan simples que probar el enrutado real
 * es más fiable que simular Express, y evita añadir una dependencia nueva
 * (supertest) para dos rutas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "http";
import { healthRouter } from "./healthRouter";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(healthRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/health — liveness", () => {
  it("responde 200 sin necesidad de sesión/cookies/headers de auth", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
  });

  it("devuelve el JSON mínimo esperado", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("segolife");
  });

  it("no incluye secretos ni DATABASE_URL en la respuesta", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const raw = await res.text();
    expect(raw).not.toMatch(/DATABASE_URL/i);
    expect(raw).not.toMatch(/mysql:\/\//i);
    expect(raw).not.toMatch(/JWT_SECRET/i);
  });

  it("no toca la base de datos — responde 200 aunque DATABASE_URL no esté definido", async () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      expect(res.status).toBe(200);
    } finally {
      if (previous !== undefined) process.env.DATABASE_URL = previous;
    }
  });
});

describe("GET /api/ready — readiness (comprueba DB real)", () => {
  it("devuelve 503 si la base de datos no es alcanzable", async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "mysql://user:pass@127.0.0.1:1/nonexistent";
    try {
      const res = await fetch(`${baseUrl}/api/ready`);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe("error");
    } finally {
      if (previous !== undefined) process.env.DATABASE_URL = previous;
      else delete process.env.DATABASE_URL;
    }
  }, 10000);
});
