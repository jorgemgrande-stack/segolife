import { describe, it, expect } from "vitest";
import { eurosToCents } from "./priceConversion";

describe("eurosToCents", () => {
  it("convierte euros enteros a céntimos", () => {
    expect(eurosToCents(7)).toBe(700);
  });

  it("convierte euros con decimales a céntimos sin error de redondeo", () => {
    expect(eurosToCents(8.35)).toBe(835);
  });

  it("cero euros → cero céntimos", () => {
    expect(eurosToCents(0)).toBe(0);
  });

  it("null/undefined se manejan de forma segura → 0, nunca NaN ni excepción", () => {
    expect(eurosToCents(null)).toBe(0);
    expect(eurosToCents(undefined)).toBe(0);
  });

  it("NaN se trata como ausencia de importe → 0", () => {
    expect(eurosToCents(NaN)).toBe(0);
  });

  it("suma de céntimos ya convertidos nunca arrastra error de coma flotante (0.1+0.2 clásico)", () => {
    const total = eurosToCents(0.1) + eurosToCents(0.2);
    expect(total).toBe(30);
  });

  it("importes con más de 2 decimales redondean al céntimo más cercano", () => {
    expect(eurosToCents(8.005)).toBe(801); // redondeo estándar, no floor
    expect(eurosToCents(8.004)).toBe(800);
  });
});
