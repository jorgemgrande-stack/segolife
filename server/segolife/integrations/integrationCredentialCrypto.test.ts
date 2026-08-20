/**
 * integrationCredentialCrypto.test.ts — FINAL ZERO-DEBT (Block J). getKey()
 * caía a un literal hardcodeado ("segolife-integrations-key-please-set-env")
 * si ni INTEGRATION_ENCRYPTION_KEY ni DATABASE_URL estaban configuradas —
 * mismo patrón ya corregido en ghlInbox.ts: un secreto conocido por
 * cualquiera con acceso al código fuente no protege nada. Ahora falla alto
 * en vez de cifrar en silencio con una clave pública.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptCredentials, decryptCredentials, last4 } from "./integrationCredentialCrypto";

describe("integrationCredentialCrypto — nunca cae a un literal público", () => {
  const originalKey = process.env.INTEGRATION_ENCRYPTION_KEY;
  const originalDbUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
    else process.env.INTEGRATION_ENCRYPTION_KEY = originalKey;
    if (originalDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDbUrl;
  });

  it("cifra y descifra correctamente con INTEGRATION_ENCRYPTION_KEY configurada", () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = "test-key-real-1";
    process.env.DATABASE_URL = "mysql://irrelevant";
    const encoded = encryptCredentials({ apiKey: "abc123", accessToken: "xyz789" });
    expect(encoded).not.toBe("");
    const decoded = decryptCredentials(encoded);
    expect(decoded).toEqual({ apiKey: "abc123", accessToken: "xyz789" });
  });

  it("cifra y descifra correctamente cayendo a DATABASE_URL si no hay INTEGRATION_ENCRYPTION_KEY", () => {
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    process.env.DATABASE_URL = "mysql://user:pass@host/db";
    const encoded = encryptCredentials({ apiKey: "solo-db-url" });
    const decoded = decryptCredentials(encoded);
    expect(decoded).toEqual({ apiKey: "solo-db-url" });
  });

  it("lanza en vez de cifrar con un literal público si NINGUNA variable está configurada", () => {
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    delete process.env.DATABASE_URL;
    expect(() => encryptCredentials({ apiKey: "should-never-encrypt" })).toThrow();
  });

  it("una clave distinta a la usada para cifrar no puede descifrar (nunca hay una clave 'universal' válida)", () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = "key-A";
    const encoded = encryptCredentials({ apiKey: "secreto" });
    process.env.INTEGRATION_ENCRYPTION_KEY = "key-B";
    expect(decryptCredentials(encoded)).toBeNull();
  });

  it("last4 nunca expone más de los últimos 4 caracteres", () => {
    expect(last4("sk_live_abcdef123456")).toBe("3456");
    expect(last4("abc")).toBeNull();
    expect(last4(null)).toBeNull();
  });
});
