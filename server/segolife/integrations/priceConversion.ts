/**
 * priceConversion.ts — conversión euros→céntimos compartida por adapters de
 * ticketing (Fourvenues Integrations API devuelve `price`/`total_paid` en
 * EUROS, no céntimos — confirmado empíricamente 2026-08-12, ver
 * docs/integrations/fourvenues.md). SEGOLIFE usa `int` céntimos en todo el
 * schema (ticket_orders.total_cents, event_ticket_types.price_cents, etc.).
 *
 * Redondeo por valor individual (nunca acumulando floats): `eurosToCents(7)`
 * y `eurosToCents(8.35)` se calculan cada uno de forma independiente antes
 * de sumar — sumar céntimos enteros nunca arrastra el error de redondeo que
 * sumar euros en coma flotante sí produce.
 */
export function eurosToCents(amount: number | null | undefined): number {
  if (amount == null || Number.isNaN(amount)) return 0;
  return Math.round(amount * 100);
}
