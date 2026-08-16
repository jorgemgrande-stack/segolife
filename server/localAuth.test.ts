/**
 * localAuth.test.ts — Fase 15 (spec §33/§34, "auth/cookie safety"). Cubre
 * SOLO la lógica de domain/secure de la cookie de sesión — auditoría de
 * esta fase encontró que nunca declaraba `domain`, así que una sesión
 * iniciada en www.segolife.es no viajaba a segolife.es (ni al revés),
 * provocando un logout silencioso al rebotar entre ambos hosts.
 */
import { describe, it, expect } from "vitest";
import { sessionCookieOptions, clearSessionCookieOptions } from "./localAuth";

describe("sessionCookieOptions — producción", () => {
  it("en producción, declara domain='.segolife.es' (cubre apex + www + futuros subdominios)", () => {
    const opts = sessionCookieOptions("production");
    expect(opts.domain).toBe(".segolife.es");
  });

  it("en producción, secure=true", () => {
    expect(sessionCookieOptions("production").secure).toBe(true);
  });

  it("httpOnly siempre true, sameSite siempre 'lax', path siempre '/'", () => {
    const opts = sessionCookieOptions("production");
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
  });

  it("maxAge es 30 días en milisegundos", () => {
    expect(sessionCookieOptions("production").maxAge).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe("sessionCookieOptions — desarrollo local", () => {
  it("fuera de producción, NUNCA declara domain (localhost rechaza/trata mal un dominio de cookie no público)", () => {
    const opts = sessionCookieOptions("development");
    expect(opts.domain).toBeUndefined();
    expect("domain" in opts).toBe(false);
  });

  it("fuera de producción, secure=false (permite HTTP en localhost)", () => {
    expect(sessionCookieOptions("development").secure).toBe(false);
    expect(sessionCookieOptions(undefined).secure).toBe(false);
  });
});

describe("clearSessionCookieOptions — debe coincidir EXACTAMENTE con sessionCookieOptions", () => {
  it("en producción, mismo domain que sessionCookieOptions — si no, el logout no borraría la cookie real", () => {
    const set = sessionCookieOptions("production");
    const clear = clearSessionCookieOptions("production");
    expect(clear.domain).toBe(set.domain);
    expect(clear.path).toBe(set.path);
  });

  it("fuera de producción, ninguno declara domain", () => {
    expect(clearSessionCookieOptions("development").domain).toBeUndefined();
  });
});
