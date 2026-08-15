/**
 * moneyTax.ts — SEGOLIFE FASE 10 (spec §92/§93). Cálculo determinista de IVA
 * a partir de un precio bruto (con impuesto incluido, convención de venta al
 * público española) — nunca flotante, nunca redondeo en el cliente.
 *
 * Deliberadamente NO reutiliza server/taxUtils.ts (legacy Náyade): ese
 * módulo incluye el régimen REAV (agencias de viaje) y varias funciones
 * acopladas a presupuestos/reservas turísticas — spec §6 exige auditar antes
 * de reutilizar, y aquí la conclusión es que la lógica genérica es simple
 * (una sola tasa, base+cuota) y más segura reescrita mínima que adaptada.
 */

export interface TaxBreakdown {
  grossAmountCents: number;
  taxRateBasisPoints: number;
  taxBaseCents: number;
  taxAmountCents: number;
}

/**
 * Descompone un importe bruto (IVA incluido) en base imponible + cuota,
 * dado un tipo en basis points (2100 = 21,00%). Redondeo: base imponible se
 * calcula por división entera y SIEMPRE truncada hacia abajo (Math.round del
 * cociente exacto), la cuota es el resto exacto (gross - base) — así
 * base+cuota siempre suman exactamente el bruto, sin descuadres de céntimo.
 */
export function calcTaxFromGrossCents(grossAmountCents: number, taxRateBasisPoints: number): TaxBreakdown {
  if (!Number.isInteger(grossAmountCents) || grossAmountCents < 0) {
    throw new Error("[moneyTax] grossAmountCents debe ser un entero >= 0");
  }
  if (!Number.isInteger(taxRateBasisPoints) || taxRateBasisPoints < 0) {
    throw new Error("[moneyTax] taxRateBasisPoints debe ser un entero >= 0");
  }
  const taxBaseCents = Math.round((grossAmountCents * 10000) / (10000 + taxRateBasisPoints));
  const taxAmountCents = grossAmountCents - taxBaseCents;
  return { grossAmountCents, taxRateBasisPoints, taxBaseCents, taxAmountCents };
}

/** Aplica un % de comisión (basis points) a un importe — mismo criterio determinista, redondeo half-up sobre enteros. */
export function calcCommissionCents(amountCents: number, commissionBasisPoints: number): number {
  if (!Number.isInteger(amountCents)) throw new Error("[moneyTax] amountCents debe ser entero");
  if (!Number.isInteger(commissionBasisPoints) || commissionBasisPoints < 0) throw new Error("[moneyTax] commissionBasisPoints debe ser un entero >= 0");
  return Math.round((amountCents * commissionBasisPoints) / 10000);
}
