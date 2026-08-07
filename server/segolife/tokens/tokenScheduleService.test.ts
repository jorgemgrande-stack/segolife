/**
 * tokenScheduleService.test.ts — horarios earn/spend por venue (Fase 2).
 * `resolveMadridMoment` se usa también DESDE el test para derivar el
 * day_of_week/hora reales de la fecha de prueba (en vez de calcularlos a
 * mano) — así el test es correcto sin depender de aritmética de calendario
 * manual ni de asumir en qué zona horaria corre la máquina de CI.
 */
import { describe, it, expect } from "vitest";
import {
  isWithinSchedule,
  isWithinTimeRange,
  resolveMadridMoment,
  listSchedulesByVenue,
} from "./tokenScheduleService";

function makeScheduleMockDb(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.from = () => builder;
  builder.where = () => builder;
  builder.orderBy = () => builder;
  builder.then = (resolve: (v: unknown) => void) => resolve(rows);
  return builder as unknown as Parameters<typeof isWithinSchedule>[3];
}

function blankSchedule(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, venueId: 1, operationType: "earn" as const, dayOfWeek: 1,
    startTime: "09:00", endTime: "23:00", active: true, timezone: "Europe/Madrid",
    validFrom: null, validTo: null,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("tokenScheduleService — isWithinTimeRange (pura)", () => {
  it("rango normal: dentro y fuera del intervalo", () => {
    expect(isWithinTimeRange("12:00", "09:00", "23:00")).toBe(true);
    expect(isWithinTimeRange("23:30", "09:00", "23:00")).toBe(false);
    expect(isWithinTimeRange("08:59", "09:00", "23:00")).toBe(false);
  });

  it("rango que cruza medianoche (22:00–02:00)", () => {
    expect(isWithinTimeRange("23:00", "22:00", "02:00")).toBe(true); // antes de medianoche
    expect(isWithinTimeRange("01:00", "22:00", "02:00")).toBe(true); // después de medianoche
    expect(isWithinTimeRange("12:00", "22:00", "02:00")).toBe(false); // fuera del rango nocturno
  });

  it("start === end se interpreta como 24h sin restricción", () => {
    expect(isWithinTimeRange("03:00", "09:00", "09:00")).toBe(true);
  });
});

describe("tokenScheduleService — isWithinSchedule (con BD mockeada)", () => {
  it("sin ninguna franja configurada, siempre permitido (earn)", async () => {
    const db = makeScheduleMockDb([]);
    expect(await isWithinSchedule(1, "earn", new Date(), db)).toBe(true);
  });

  it("sin ninguna franja configurada, siempre permitido (spend)", async () => {
    const db = makeScheduleMockDb([]);
    expect(await isWithinSchedule(1, "spend", new Date(), db)).toBe(true);
  });

  it("earn permitido dentro del horario configurado", async () => {
    const at = new Date("2026-08-10T10:00:00Z"); // instante fijo cualquiera
    const moment = resolveMadridMoment(at);
    const schedule = blankSchedule({ operationType: "earn", dayOfWeek: moment.dayOfWeek, startTime: "00:00", endTime: "00:00" }); // 24h ese día
    const db = makeScheduleMockDb([schedule]);
    expect(await isWithinSchedule(1, "earn", at, db)).toBe(true);
  });

  it("earn fuera del horario configurado (franja de otro día de la semana)", async () => {
    const at = new Date("2026-08-10T10:00:00Z");
    const moment = resolveMadridMoment(at);
    const otherDay = (moment.dayOfWeek + 1) % 7;
    const schedule = blankSchedule({ operationType: "earn", dayOfWeek: otherDay, startTime: "00:00", endTime: "00:00" });
    const db = makeScheduleMockDb([schedule]);
    expect(await isWithinSchedule(1, "earn", at, db)).toBe(false);
  });

  it("spend permitido dentro del horario configurado (independiente de earn)", async () => {
    const at = new Date("2026-08-10T10:00:00Z");
    const moment = resolveMadridMoment(at);
    const schedule = blankSchedule({ operationType: "spend", dayOfWeek: moment.dayOfWeek, startTime: moment.time, endTime: "23:59" });
    const db = makeScheduleMockDb([schedule]);
    expect(await isWithinSchedule(1, "spend", at, db)).toBe(true);
  });

  it("spend fuera de horario devuelve false aunque earn esté permitido a esa hora", async () => {
    // Cada llamada usa su propio mock — el SQL real filtra por operation_type
    // en el WHERE, así que cada uno solo "ve" las franjas de su propio tipo.
    const at = new Date("2026-08-10T10:00:00Z");
    const moment = resolveMadridMoment(at);
    const earnSchedule = blankSchedule({ operationType: "earn", dayOfWeek: moment.dayOfWeek, startTime: "00:00", endTime: "00:00" });
    const spendSchedule = blankSchedule({ operationType: "spend", dayOfWeek: (moment.dayOfWeek + 1) % 7, startTime: "00:00", endTime: "00:00" });
    expect(await isWithinSchedule(1, "earn", at, makeScheduleMockDb([earnSchedule]))).toBe(true);
    expect(await isWithinSchedule(1, "spend", at, makeScheduleMockDb([spendSchedule]))).toBe(false);
  });

  it("una franja inactiva (active=false) no cuenta — el SQL real ya la filtraría", async () => {
    const db = makeScheduleMockDb([]); // simula WHERE active=true sin resultados
    expect(await isWithinSchedule(1, "earn", new Date(), db)).toBe(true); // sin franjas activas = sin restricción
  });

  it("respeta valid_from/valid_to cuando la fecha cae fuera del rango", async () => {
    const at = new Date("2026-08-10T10:00:00Z");
    const moment = resolveMadridMoment(at);
    const schedule = blankSchedule({
      operationType: "earn", dayOfWeek: moment.dayOfWeek, startTime: "00:00", endTime: "00:00",
      validFrom: "2030-01-01", // todavía no empieza a aplicar
    });
    const db = makeScheduleMockDb([schedule]);
    expect(await isWithinSchedule(1, "earn", at, db)).toBe(false);
  });
});

describe("tokenScheduleService — listSchedulesByVenue", () => {
  it("devuelve las franjas del venue tal como las da la BD", async () => {
    const rows = [blankSchedule({ id: 1 }), blankSchedule({ id: 2, operationType: "spend" })];
    const db = makeScheduleMockDb(rows);
    const result = await listSchedulesByVenue(1, db as unknown as Parameters<typeof listSchedulesByVenue>[1]);
    expect(result).toHaveLength(2);
  });
});
