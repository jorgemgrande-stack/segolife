/**
 * getEventIntegrationMatchStats.test.ts — Weezevent Live Operations
 * (2026-08-23, spec §10-11). Se prueba SOLO la orquestación de conteos
 * (qué agregados calcula, con qué filtros) — mismo criterio de fake
 * secuencial que integrationsDb.test.ts (tryAcquireSyncLock): un fake no
 * puede probar el SQL real de MySQL, eso se demuestra con evidencia real
 * (ver informe final). Archivo separado para no mezclar con el fake de
 * `fakeLockDb` (secuencia de queries completamente distinta).
 */
import { describe, it, expect } from "vitest";
import { getEventIntegrationMatchStats } from "./integrationsDb";

/**
 * Reproduce la secuencia EXACTA de `conn.select()` que hace
 * getEventIntegrationMatchStats:
 *  1. getEventIntegrationRaw()  → [integrationRow] (o [] si no existe)
 *  2. eventTickets (total/matched agregados)
 *  3. unresolvedOperations (operationType='order', con email)
 *  4. eventAttendance (matched)
 *  5. unresolvedOperations (operationType='attendance', pendiente)
 */
function fakeMatchStatsDb(responses: unknown[][]) {
  let i = 0;
  function chain(resolveValue: unknown) {
    const c: any = { from: () => c, where: () => c, limit: () => c, then: (resolve: (v: unknown) => void) => resolve(resolveValue) };
    return c;
  }
  return { select: (..._args: unknown[]) => chain(responses[i++] ?? []) } as never;
}

describe("getEventIntegrationMatchStats — solo conteos agregados, nunca una fila individual (spec §10-11)", () => {
  it("mapping no encontrado → null, sin más queries", async () => {
    const conn = fakeMatchStatsDb([[]]);
    const result = await getEventIntegrationMatchStats(1, conn);
    expect(result).toBeNull();
  });

  it("mapping sin eventId asociado → null", async () => {
    const conn = fakeMatchStatsDb([[{ id: 1, eventId: null }]]);
    const result = await getEventIntegrationMatchStats(1, conn);
    expect(result).toBeNull();
  });

  it("calcula ticketsMatched/ticketsUnmatched a partir de total/matched agregados, y expone los 4 conteos reales (spec §10: Tickets/Con email/Matched/Unmatched/Attendance matched)", async () => {
    const conn = fakeMatchStatsDb([
      [{ id: 1, eventId: 233 }],       // getEventIntegrationRaw
      [{ total: 1812, matched: 3 }],   // eventTickets agregado
      [{ n: 47 }],                     // unresolved 'order' con email
      [{ n: 3 }],                      // eventAttendance matched
      [{ n: 5 }],                      // unresolved 'attendance' pendiente
    ]);

    const result = await getEventIntegrationMatchStats(1, conn);

    expect(result).toEqual({
      ticketsTotal: 1812,
      ticketsMatched: 3,
      ticketsUnmatched: 1809,
      ticketsUnmatchedWithEmailHint: 47,
      attendanceMatched: 3,
      attendancePendingIdentity: 5,
    });
  });

  it("0 tickets sincronizados todavía (mapping recién vinculado) → todos los conteos en 0, nunca NaN/undefined", async () => {
    const conn = fakeMatchStatsDb([
      [{ id: 1, eventId: 233 }],
      [{ total: 0, matched: null }], // SUM sobre 0 filas → SQL puede devolver null
      [{ n: 0 }],
      [{ n: 0 }],
      [{ n: 0 }],
    ]);

    const result = await getEventIntegrationMatchStats(1, conn);

    expect(result).toEqual({
      ticketsTotal: 0, ticketsMatched: 0, ticketsUnmatched: 0,
      ticketsUnmatchedWithEmailHint: 0, attendanceMatched: 0, attendancePendingIdentity: 0,
    });
  });
});
