/**
 * canonicalHost.test.ts — Fase 15, spec §33/§51 (segolife.es y www.segolife.es
 * deben quedar sanos, con UN solo host canónico).
 */
import { describe, it, expect, afterEach } from "vitest";
import { canonicalRedirectTarget, canonicalBaseUrl } from "./canonicalHost";

describe("canonicalRedirectTarget", () => {
  it("apex exacto (segolife.es) -> redirige a https://www.segolife.es preservando path+query", () => {
    expect(canonicalRedirectTarget("segolife.es", "/ie/events/after-party?utm=x")).toBe(
      "https://www.segolife.es/ie/events/after-party?utm=x"
    );
  });

  it("apex en la raíz -> redirige preservando '/'", () => {
    expect(canonicalRedirectTarget("segolife.es", "/")).toBe("https://www.segolife.es/");
  });

  it("ya es el host canónico (www.segolife.es) -> NUNCA redirige (evita bucle)", () => {
    expect(canonicalRedirectTarget("www.segolife.es", "/ie")).toBeNull();
  });

  it("dominio de Railway en /api/* -> nunca se toca (no rompe el propio despliegue/healthcheck ni webhooks externos)", () => {
    expect(canonicalRedirectTarget("segolife-production.up.railway.app", "/api/health")).toBeNull();
  });

  it("dominio de Railway en cualquier otra ruta /api/* -> tampoco se toca (auth, trpc, webhooks de Redsys/Brevo/GHL/Fourvenues pueden seguir apuntando aquí)", () => {
    expect(canonicalRedirectTarget("segolife-production.up.railway.app", "/api/auth/login")).toBeNull();
    expect(canonicalRedirectTarget("segolife-production.up.railway.app", "/api/trpc/config.getPublicSettings")).toBeNull();
    expect(canonicalRedirectTarget("segolife-production.up.railway.app", "/api/redsys/notification")).toBeNull();
  });

  // SEC-01 — BUG-A: la URL pública de Railway servía la app de forma
  // idéntica a www.segolife.es sin redirigir, y sessionCookieOptions
  // (correctamente) nunca comparte cookie entre ambos hosts (no son el
  // mismo parent domain) — una misma cuenta iniciaba sesión con éxito en
  // cada host por separado pero como DOS sesiones no relacionadas. Fix:
  // toda carga de página real (fuera de /api/*) en el dominio de Railway
  // redirige al host canónico ANTES de que exista ninguna sesión ahí.
  it("dominio de Railway en una ruta de app real (fuera de /api/*) -> SÍ redirige al host canónico, preservando path+query (SEC-01, BUG-A)", () => {
    expect(canonicalRedirectTarget("segolife-production.up.railway.app", "/ie/events/after-party?utm=x")).toBe(
      "https://www.segolife.es/ie/events/after-party?utm=x"
    );
  });

  it("dominio de Railway en la raíz -> redirige preservando '/' (SEC-01, BUG-A)", () => {
    expect(canonicalRedirectTarget("segolife-production.up.railway.app", "/")).toBe("https://www.segolife.es/");
  });

  it("dominio de Railway en /login -> redirige (el propio login queda en el host canónico, nunca establece sesión en Railway)", () => {
    expect(canonicalRedirectTarget("segolife-production.up.railway.app", "/login")).toBe("https://www.segolife.es/login");
  });

  it("localhost -> nunca se toca (desarrollo local)", () => {
    expect(canonicalRedirectTarget("localhost", "/")).toBeNull();
  });

  it("un host completamente distinto (preview domain, etc.) -> nunca se toca, incluso con el mismo sufijo .up.railway.app (solo el dominio EXACTO de producción se canonicaliza)", () => {
    expect(canonicalRedirectTarget("some-preview.up.railway.app", "/")).toBeNull();
  });
});

describe("canonicalBaseUrl", () => {
  const ORIGINAL_APP_URL = process.env.APP_URL;
  afterEach(() => {
    if (ORIGINAL_APP_URL === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = ORIGINAL_APP_URL;
  });

  it("sin APP_URL configurada, cae al host canónico real — NUNCA a un string vacío ni a un dominio heredado (spec §33)", () => {
    delete process.env.APP_URL;
    expect(canonicalBaseUrl()).toBe("https://www.segolife.es");
  });

  it("con APP_URL configurada, la respeta (permite apuntar a staging, etc.)", () => {
    process.env.APP_URL = "https://staging.example.com";
    expect(canonicalBaseUrl()).toBe("https://staging.example.com");
  });

  it("recorta barras finales de APP_URL para no producir '//' al concatenar rutas", () => {
    process.env.APP_URL = "https://staging.example.com/";
    expect(canonicalBaseUrl()).toBe("https://staging.example.com");
  });

  it("nunca devuelve el dominio interno de Railway ni un dominio ajeno heredado", () => {
    delete process.env.APP_URL;
    const url = canonicalBaseUrl();
    expect(url).not.toContain("railway.app");
    expect(url).not.toContain("skicenter");
    expect(url).not.toContain("nayadeexperiences");
  });
});
