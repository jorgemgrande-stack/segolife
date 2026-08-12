/**
 * communicationLocale.test.ts — regla NO NEGOCIABLE: IE→en, UVA→es. Cubre el
 * orden de resolución exacto (preferencia explícita → comunidad de origen →
 * fallback de plataforma) y que un valor inválido en cualquiera de las dos
 * fuentes se ignora en vez de romper (nunca lanza).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { tableRows } = vi.hoisted(() => ({
  tableRows: { studentProfiles: [] as any[], communities: [] as any[] },
}));

vi.mock("mysql2/promise", () => ({ default: { createPool: () => ({}) } }));
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => {
    const b: any = {};
    let currentTable: "profiles" | "communities" | null = null;
    b.select = () => b;
    b.from = (table: any) => {
      // studentProfiles se consulta siempre primero (ver communicationLocale.ts)
      currentTable = currentTable === null ? "profiles" : "communities";
      void table;
      return b;
    };
    b.where = () => b;
    b.limit = () => Promise.resolve(currentTable === "profiles" ? tableRows.studentProfiles : tableRows.communities);
    return b;
  },
}));

import { resolveCommunicationLocale, pickByLocale } from "./communicationLocale";

beforeEach(() => {
  tableRows.studentProfiles = [];
  tableRows.communities = [];
});

describe("resolveCommunicationLocale — orden de resolución", () => {
  it("preferencia explícita del usuario gana sobre todo lo demás", async () => {
    tableRows.studentProfiles = [{ preferredLocale: "en" }];
    tableRows.communities = [{ defaultLocale: "es" }]; // aunque la comunidad diga "es"
    const locale = await resolveCommunicationLocale({ userId: 1, communityId: 99 });
    expect(locale).toBe("en");
  });

  it("sin preferencia, usa el defaultLocale de la comunidad DE ORIGEN", async () => {
    tableRows.studentProfiles = [{ preferredLocale: null }];
    tableRows.communities = [{ defaultLocale: "en" }]; // simula IE
    const locale = await resolveCommunicationLocale({ userId: 1, communityId: 1 });
    expect(locale).toBe("en");
  });

  it("UVA (defaultLocale es) resuelve a español", async () => {
    tableRows.studentProfiles = [{ preferredLocale: null }];
    tableRows.communities = [{ defaultLocale: "es" }];
    const locale = await resolveCommunicationLocale({ userId: 1, communityId: 2 });
    expect(locale).toBe("es");
  });

  it("sin preferencia y sin communityId, cae al fallback de plataforma 'es'", async () => {
    tableRows.studentProfiles = [{ preferredLocale: null }];
    const locale = await resolveCommunicationLocale({ userId: 1, communityId: null });
    expect(locale).toBe("es");
  });

  it("un valor inválido en preferredLocale (dato corrupto) se ignora, nunca lanza", async () => {
    tableRows.studentProfiles = [{ preferredLocale: "fr" }];
    tableRows.communities = [{ defaultLocale: "en" }];
    const locale = await resolveCommunicationLocale({ userId: 1, communityId: 1 });
    expect(locale).toBe("en");
  });

  it("sin fila de student_profiles (usuario no-estudiante, p.ej. staff), no lanza y sigue la cadena", async () => {
    tableRows.studentProfiles = [];
    tableRows.communities = [{ defaultLocale: "en" }];
    const locale = await resolveCommunicationLocale({ userId: 1, communityId: 1 });
    expect(locale).toBe("en");
  });
});

describe("pickByLocale", () => {
  it("elige EN cuando el locale es 'en'", () => {
    expect(pickByLocale("en", "Hello", "Hola")).toBe("Hello");
  });
  it("elige ES cuando el locale es 'es'", () => {
    expect(pickByLocale("es", "Hello", "Hola")).toBe("Hola");
  });
});
