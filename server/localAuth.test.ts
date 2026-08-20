/**
 * localAuth.test.ts — Fase 15 (spec §33/§34, "auth/cookie safety") + fix de
 * incidente real post-Fase 16. Cubre la lógica de domain/secure de la
 * cookie de sesión.
 *
 * Fase 15 encontró que la cookie nunca declaraba `domain`, así que una
 * sesión iniciada en www.segolife.es no viajaba a segolife.es (ni al
 * revés) — se corrigió fijando domain=".segolife.es" siempre que
 * NODE_ENV=production, sin mirar el host real de la petición.
 *
 * Eso introdujo un incidente real distinto: un admin real y una Student no
 * podían iniciar sesión desde https://segolife-production.up.railway.app
 * (el dominio público de Railway) — el navegador rechaza en silencio un
 * Set-Cookie cuyo Domain no es el host actual ni un sufijo suyo, así que el
 * login "funcionaba" en el servidor (200 OK) pero la cookie nunca se
 * guardaba, y el usuario volvía a ver el login inmediatamente. Ahora el
 * domain solo se fija cuando el host real de la petición es
 * segolife.es/www.segolife.es (o un futuro subdominio) — para cualquier
 * otro host válido (Railway, localhost, preview) la cookie es host-only,
 * que SIEMPRE funciona para el propio host que la fijó.
 */
import { describe, it, expect } from "vitest";
import { sessionCookieOptions, clearSessionCookieOptions, AUTH_SESSION_TTL_SECONDS } from "./localAuth";

describe("sessionCookieOptions — producción, host real de segolife.es", () => {
  it("host www.segolife.es: declara domain='.segolife.es' (cubre apex + www + futuros subdominios)", () => {
    expect(sessionCookieOptions("production", "www.segolife.es").domain).toBe(".segolife.es");
  });

  it("host segolife.es (apex): también declara domain='.segolife.es'", () => {
    expect(sessionCookieOptions("production", "segolife.es").domain).toBe(".segolife.es");
  });

  it("un futuro subdominio (ie.segolife.es) también coincide", () => {
    expect(sessionCookieOptions("production", "ie.segolife.es").domain).toBe(".segolife.es");
  });

  it("en producción, secure=true independientemente del host", () => {
    expect(sessionCookieOptions("production", "www.segolife.es").secure).toBe(true);
  });

  it("httpOnly siempre true, sameSite siempre 'lax', path siempre '/'", () => {
    const opts = sessionCookieOptions("production", "www.segolife.es");
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
  });

  it("maxAge sigue en lockstep con AUTH_SESSION_TTL_SECONDS (SEC-02 — antes fijo a 30 días, ahora sesión deslizante)", () => {
    expect(sessionCookieOptions("production", "www.segolife.es").maxAge).toBe(AUTH_SESSION_TTL_SECONDS * 1000);
  });
});

describe("sessionCookieOptions — producción, host NO relacionado con segolife.es (incidente real corregido)", () => {
  it("dominio público de Railway (segolife-production.up.railway.app): NUNCA declara domain — cookie host-only, la única que ese host puede fijar/leer de verdad", () => {
    const opts = sessionCookieOptions("production", "segolife-production.up.railway.app");
    expect(opts.domain).toBeUndefined();
    expect("domain" in opts).toBe(false);
  });

  it("sin hostname (llamador que no lo pasa): tampoco declara domain — nunca asumir segolife.es por defecto", () => {
    expect(sessionCookieOptions("production").domain).toBeUndefined();
  });

  it("un hostname parecido pero no real (evilsegolife.es, segolife.es.evil.com): nunca coincide (protege contra un intento de burlar el sufijo)", () => {
    expect(sessionCookieOptions("production", "evilsegolife.es").domain).toBeUndefined();
    expect(sessionCookieOptions("production", "segolife.es.evil.com").domain).toBeUndefined();
  });

  it("secure sigue siendo true en producción aunque no haya domain (el host de Railway también sirve HTTPS)", () => {
    expect(sessionCookieOptions("production", "segolife-production.up.railway.app").secure).toBe(true);
  });
});

describe("sessionCookieOptions — desarrollo local", () => {
  it("fuera de producción, NUNCA declara domain aunque el host coincida (localhost rechaza/trata mal un dominio de cookie no público)", () => {
    const opts = sessionCookieOptions("development", "www.segolife.es");
    expect(opts.domain).toBeUndefined();
    expect("domain" in opts).toBe(false);
  });

  it("fuera de producción, secure=false (permite HTTP en localhost)", () => {
    expect(sessionCookieOptions("development").secure).toBe(false);
    expect(sessionCookieOptions(undefined).secure).toBe(false);
  });
});

describe("clearSessionCookieOptions — debe coincidir EXACTAMENTE con sessionCookieOptions para el MISMO host", () => {
  it("en producción sobre www.segolife.es, mismo domain que sessionCookieOptions — si no, el logout no borraría la cookie real", () => {
    const set = sessionCookieOptions("production", "www.segolife.es");
    const clear = clearSessionCookieOptions("production", "www.segolife.es");
    expect(clear.domain).toBe(set.domain);
    expect(clear.path).toBe(set.path);
  });

  it("en producción sobre el dominio de Railway, tampoco declara domain — logout coherente con el login del incidente corregido", () => {
    const set = sessionCookieOptions("production", "segolife-production.up.railway.app");
    const clear = clearSessionCookieOptions("production", "segolife-production.up.railway.app");
    expect(clear.domain).toBe(set.domain);
    expect(clear.domain).toBeUndefined();
  });

  it("fuera de producción, ninguno declara domain", () => {
    expect(clearSessionCookieOptions("development", "www.segolife.es").domain).toBeUndefined();
  });
});
