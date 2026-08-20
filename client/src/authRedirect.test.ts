/**
 * authRedirect.test.ts — SEC-02. Cubre el handler de 401 extraído de
 * main.tsx: la confirmación en fresco antes de redirigir, la conservación
 * de returnTo, y que no se dispare una redirección por un fallo aislado.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { buildExpiredLoginUrl, handleUnauthorized, _resetConfirmingSessionDeathForTests } from "./authRedirect";

function mockLocation(pathname: string, search = "") {
  delete (window as any).location;
  (window as any).location = { pathname, search, href: "" };
}

describe("buildExpiredLoginUrl", () => {
  it("añade reason=expired preservando returnTo", () => {
    expect(buildExpiredLoginUrl("/admin/eventos")).toBe("/login?returnTo=%2Fadmin%2Feventos&reason=expired");
  });

  it("en la raíz (sin returnTo real), añade reason=expired como único parámetro", () => {
    expect(buildExpiredLoginUrl("/")).toBe("/login?reason=expired");
  });
});

describe("handleUnauthorized — no confía en un único 401 aislado, confirma en fresco antes de redirigir", () => {
  beforeEach(() => {
    _resetConfirmingSessionDeathForTests();
    mockLocation("/admin/eventos", "?tab=activos");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("si /api/auth/me confirma que la sesión sigue viva (200), NO redirige — el 401 original era transitorio", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    await handleUnauthorized();
    expect(window.location.href).toBe("");
  });

  it("si /api/auth/me confirma que la sesión está realmente muerta (401), redirige a /login preservando la ruta actual como returnTo y reason=expired", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await handleUnauthorized();
    expect(window.location.href).toBe("/login?returnTo=%2Fadmin%2Feventos%3Ftab%3Dactivos&reason=expired");
  });

  it("un fallo de red al confirmar (offline) NO se interpreta como sesión muerta — no redirige", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await handleUnauthorized();
    expect(window.location.href).toBe("");
  });

  it("deduplica: dos llamadas simultáneas (batch de varias queries fallando a la vez) solo disparan UNA confirmación real", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([handleUnauthorized(), handleUnauthorized()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("llama a /api/auth/me con cache:no-store y credentials:include (nunca una respuesta de caché de un 401 anterior)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await handleUnauthorized();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/me", { credentials: "include", cache: "no-store" });
  });
});
