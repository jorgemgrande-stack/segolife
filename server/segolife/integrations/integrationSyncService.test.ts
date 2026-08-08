/**
 * integrationSyncService.test.ts — kill switch (Fase 5, punto 36). Es LA
 * comprobación de seguridad más importante de todo el Integration Hub: en
 * una BD nueva, o con cualquiera de las 4 condiciones sin cumplir, ningún
 * sync debe poder ejecutarse — nunca repetir el problema de jobs legacy
 * arrancando solos (ver CLAUDE.md).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isExternalIntegrationsGloballyEnabled, canSync } from "./integrationSyncService";

const ORIGINAL_ENV = process.env.EXTERNAL_INTEGRATIONS_ENABLED;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.EXTERNAL_INTEGRATIONS_ENABLED;
  else process.env.EXTERNAL_INTEGRATIONS_ENABLED = ORIGINAL_ENV;
});

function baseIntegration(overrides: Partial<{ enabled: boolean; credentialsEncrypted: string | null; syncEnabled: boolean }> = {}) {
  return { enabled: true, credentialsEncrypted: "encrypted-blob", syncEnabled: true, ...overrides };
}

describe("kill switch — EXTERNAL_INTEGRATIONS_ENABLED", () => {
  it("sin la variable de entorno definida, está deshabilitado por defecto", () => {
    delete process.env.EXTERNAL_INTEGRATIONS_ENABLED;
    expect(isExternalIntegrationsGloballyEnabled()).toBe(false);
  });

  it("con la variable en cualquier valor distinto de 'true' literal, sigue deshabilitado", () => {
    process.env.EXTERNAL_INTEGRATIONS_ENABLED = "1";
    expect(isExternalIntegrationsGloballyEnabled()).toBe(false);
    process.env.EXTERNAL_INTEGRATIONS_ENABLED = "TRUE";
    expect(isExternalIntegrationsGloballyEnabled()).toBe(false);
  });

  it("solo con 'true' exacto se habilita globalmente", () => {
    process.env.EXTERNAL_INTEGRATIONS_ENABLED = "true";
    expect(isExternalIntegrationsGloballyEnabled()).toBe(true);
  });
});

describe("canSync — las 4 condiciones deben cumplirse TODAS", () => {
  beforeEach(() => {
    process.env.EXTERNAL_INTEGRATIONS_ENABLED = "true";
  });

  it("BD nueva (integración por defecto: enabled=false, sin credenciales, syncEnabled=false) → nunca sincroniza", () => {
    expect(canSync({ enabled: false, credentialsEncrypted: null, syncEnabled: false })).toBe(false);
  });

  it("global ON pero integration.enabled=false → no sincroniza", () => {
    expect(canSync(baseIntegration({ enabled: false }))).toBe(false);
  });

  it("global ON, enabled=true, pero sin credenciales → no sincroniza", () => {
    expect(canSync(baseIntegration({ credentialsEncrypted: null }))).toBe(false);
  });

  it("global ON, enabled=true, con credenciales, pero syncEnabled=false → no sincroniza", () => {
    expect(canSync(baseIntegration({ syncEnabled: false }))).toBe(false);
  });

  it("global OFF (aunque la fila cumpla las otras 3) → no sincroniza", () => {
    process.env.EXTERNAL_INTEGRATIONS_ENABLED = "false";
    expect(canSync(baseIntegration())).toBe(false);
  });

  it("las 4 condiciones cumplidas a la vez → sincroniza", () => {
    expect(canSync(baseIntegration())).toBe(true);
  });
});
