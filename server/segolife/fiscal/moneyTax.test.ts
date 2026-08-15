import { describe, it, expect } from "vitest";
import { calcTaxFromGrossCents, calcCommissionCents } from "./moneyTax";

describe("calcTaxFromGrossCents — spec §92/§93 (redondeo determinista, base+cuota=bruto siempre)", () => {
  it("#1 IVA 21% sobre 1000 céntimos: base+cuota suman exactamente el bruto", () => {
    const b = calcTaxFromGrossCents(1000, 2100);
    expect(b.taxBaseCents + b.taxAmountCents).toBe(1000);
    expect(b.taxBaseCents).toBe(826); // 1000/1.21 = 826.44... -> 826
  });

  it("#2 tipo 0% (exento): toda la base es el bruto, cuota 0", () => {
    const b = calcTaxFromGrossCents(1500, 0);
    expect(b.taxBaseCents).toBe(1500);
    expect(b.taxAmountCents).toBe(0);
  });

  it("#3 bruto 0: base y cuota son 0", () => {
    const b = calcTaxFromGrossCents(0, 2100);
    expect(b.taxBaseCents).toBe(0);
    expect(b.taxAmountCents).toBe(0);
  });

  it("#4 nunca produce céntimos fraccionarios ni descuadre (100 casos deterministas)", () => {
    for (let gross = 1; gross <= 10000; gross += 97) {
      const b = calcTaxFromGrossCents(gross, 2100);
      expect(Number.isInteger(b.taxBaseCents)).toBe(true);
      expect(Number.isInteger(b.taxAmountCents)).toBe(true);
      expect(b.taxBaseCents + b.taxAmountCents).toBe(gross);
    }
  });

  it("#5 misma entrada siempre produce la misma salida (determinista, no depende de estado)", () => {
    const a = calcTaxFromGrossCents(3333, 1000);
    const b = calcTaxFromGrossCents(3333, 1000);
    expect(a).toEqual(b);
  });

  it("#6 rechaza importes negativos o no enteros", () => {
    expect(() => calcTaxFromGrossCents(-1, 2100)).toThrow();
    expect(() => calcTaxFromGrossCents(1.5, 2100)).toThrow();
  });

  it("#7 rechaza tipos negativos o no enteros", () => {
    expect(() => calcTaxFromGrossCents(1000, -1)).toThrow();
    expect(() => calcTaxFromGrossCents(1000, 21.5)).toThrow();
  });
});

describe("calcCommissionCents — spec §58/§94 (redondeo determinista)", () => {
  it("#8 10% de 1000 céntimos = 100", () => {
    expect(calcCommissionCents(1000, 1000)).toBe(100);
  });
  it("#9 0% siempre da 0", () => {
    expect(calcCommissionCents(123456, 0)).toBe(0);
  });
  it("#10 redondeo half-up sobre céntimos fraccionarios", () => {
    expect(calcCommissionCents(3, 3333)).toBe(1); // 3 * 0.3333 = 0.9999 -> round 1
  });
  it("#11 rechaza basis points negativos", () => {
    expect(() => calcCommissionCents(1000, -1)).toThrow();
  });
});
