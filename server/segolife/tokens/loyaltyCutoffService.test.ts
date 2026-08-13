/**
 * loyaltyCutoffService.test.ts — precedencia venue override > global > sin
 * corte (spec §8). Mock mínimo por tabla, mismo patrón que el resto de
 * *.test.ts de este módulo.
 */
import { describe, it, expect } from "vitest";
import { resolveLoyaltyCutoff, isBeforeCutoff, LOYALTY_GLOBAL_CUTOFF_SETTING_KEY } from "./loyaltyCutoffService";
import { systemSettings, venueIntegrations } from "../../../drizzle/schema";

function makeMockDb(opts: { venueIntegrationRow?: Record<string, unknown> | null; settingValue?: string | null }) {
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () => {
            if (table === venueIntegrations) return Promise.resolve(opts.venueIntegrationRow ? [opts.venueIntegrationRow] : []);
            if (table === systemSettings) return Promise.resolve(opts.settingValue !== undefined ? [{ value: opts.settingValue }] : []);
            return Promise.resolve([]);
          },
        }),
      }),
    }),
  };
  return db as unknown as Parameters<typeof resolveLoyaltyCutoff>[1];
}

describe("resolveLoyaltyCutoff — precedencia (spec §8)", () => {
  it("sin override de venue y sin corte global → null (sin corte)", async () => {
    const db = makeMockDb({ venueIntegrationRow: { loyaltyCutoffOverrideAt: null }, settingValue: null });
    expect(await resolveLoyaltyCutoff(1, db)).toBeNull();
  });

  it("con corte global configurado y sin override de venue → usa el global", async () => {
    const db = makeMockDb({ venueIntegrationRow: { loyaltyCutoffOverrideAt: null }, settingValue: "2026-09-01T00:00:00.000Z" });
    const cutoff = await resolveLoyaltyCutoff(1, db);
    expect(cutoff?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("override de venue GANA aunque haya corte global (spec: venue override > global)", async () => {
    const db = makeMockDb({
      venueIntegrationRow: { loyaltyCutoffOverrideAt: new Date("2026-07-01T00:00:00.000Z") },
      settingValue: "2026-09-01T00:00:00.000Z",
    });
    const cutoff = await resolveLoyaltyCutoff(1, db);
    expect(cutoff?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("integrationId=null (p.ej. consumo POS nativo) resuelve directamente al corte global", async () => {
    const db = makeMockDb({ settingValue: "2026-09-01T00:00:00.000Z" });
    const cutoff = await resolveLoyaltyCutoff(null, db);
    expect(cutoff?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("un valor no-fecha en system_settings (vacío/corrupto) se trata como sin corte, nunca lanza", async () => {
    const db = makeMockDb({ venueIntegrationRow: { loyaltyCutoffOverrideAt: null }, settingValue: "" });
    expect(await resolveLoyaltyCutoff(1, db)).toBeNull();
    const dbCorrupt = makeMockDb({ venueIntegrationRow: { loyaltyCutoffOverrideAt: null }, settingValue: "no-es-una-fecha" });
    expect(await resolveLoyaltyCutoff(1, dbCorrupt)).toBeNull();
  });

  it("usa la clave real esperada por la migración/admin", () => {
    expect(LOYALTY_GLOBAL_CUTOFF_SETTING_KEY).toBe("loyalty_global_cutoff_at");
  });
});

describe("isBeforeCutoff", () => {
  it("sin corte (null), nunca bloquea", () => {
    expect(isBeforeCutoff(new Date("2020-01-01"), null)).toBe(false);
  });
  it("una operación anterior al corte queda bloqueada", () => {
    expect(isBeforeCutoff(new Date("2026-01-01"), new Date("2026-06-01"))).toBe(true);
  });
  it("una operación posterior o igual al corte no se bloquea", () => {
    expect(isBeforeCutoff(new Date("2026-07-01"), new Date("2026-06-01"))).toBe(false);
    expect(isBeforeCutoff(new Date("2026-06-01"), new Date("2026-06-01"))).toBe(false);
  });
});
