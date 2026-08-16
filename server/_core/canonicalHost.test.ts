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

  it("dominio interno de Railway -> nunca se toca (no rompe el propio despliegue/healthcheck)", () => {
    expect(canonicalRedirectTarget("segolife-production.up.railway.app", "/api/health")).toBeNull();
  });

  it("localhost -> nunca se toca (desarrollo local)", () => {
    expect(canonicalRedirectTarget("localhost", "/")).toBeNull();
  });

  it("un host completamente distinto (preview domain, etc.) -> nunca se toca", () => {
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
