/**
 * httpTransport.test.ts — cierre real F71 (2026-08-23). Cubre exclusivamente
 * el bug real encontrado al contrastar contra la doc oficial de Weezevent:
 * POST /auth/access_token exige application/x-www-form-urlencoded, pero
 * request() siempre mandaba JSON.stringify(body) sin importar el
 * Content-Type solicitado por el caller — nunca se había ejercitado porque
 * Fourvenues (el único provider real hasta ahora) nunca manda un POST con
 * body.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createHttpTransport, HttpTransportError } from "./httpTransport";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchOk(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe("createHttpTransport — form-urlencoded vs JSON body", () => {
  it("sin Content-Type explícito, manda JSON.stringify(body) — comportamiento histórico intacto", async () => {
    const fetchMock = mockFetchOk({ ok: true });
    const transport = createHttpTransport("https://api.example.invalid");
    await transport.request({ method: "POST", path: "/x", body: { a: 1, b: "two" } });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(JSON.stringify({ a: 1, b: "two" }));
  });

  it("con Content-Type application/x-www-form-urlencoded, manda el body como querystring codificado — NUNCA JSON", async () => {
    const fetchMock = mockFetchOk({ accessToken: "tok" });
    const transport = createHttpTransport("https://api.weezevent.com");
    await transport.request({
      method: "POST", path: "/auth/access_token",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: { username: "admin", password: "s3cr3t", api_key: "ik_live_xyz" },
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(new URLSearchParams({ username: "admin", password: "s3cr3t", api_key: "ik_live_xyz" }).toString());
    expect(init.body).not.toContain("{"); // nunca JSON
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("sin body, no manda ningún body sea cual sea el Content-Type", async () => {
    const fetchMock = mockFetchOk({ events: [] });
    const transport = createHttpTransport("https://api.example.invalid");
    await transport.request({ method: "GET", path: "/events", query: { api_key: "k" } });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeUndefined();
  });

  it("respuesta no-ok lanza HttpTransportError con el status real, nunca expone el body del proveedor en el mensaje", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ secret: "leaked" }) }) as unknown as typeof fetch;
    const transport = createHttpTransport("https://api.example.invalid");
    await expect(transport.request({ method: "GET", path: "/x" })).rejects.toThrow(HttpTransportError);
    try {
      await transport.request({ method: "GET", path: "/x" });
    } catch (err) {
      expect(err).toBeInstanceOf(HttpTransportError);
      expect((err as HttpTransportError).status).toBe(401);
      expect((err as Error).message).not.toContain("leaked");
    }
  });
});
