import { describe, it, expect } from "vitest";
import { resolveOperationalDate } from "./venueVisitService";

describe("resolveOperationalDate — spec §11 (nightlife operational day, límite 06:00 Europe/Madrid, nunca medianoche de calendario)", () => {
  it("23:55 y el rescan a las 00:20 del día siguiente caen en el MISMO día operativo", () => {
    const before = resolveOperationalDate(new Date("2026-08-15T23:55:00+02:00"));
    const after = resolveOperationalDate(new Date("2026-08-16T00:20:00+02:00"));
    expect(before).toBe(after);
    expect(before).toBe("2026-08-15");
  });

  it("sigue siendo el mismo día operativo hasta justo antes de las 06:00", () => {
    expect(resolveOperationalDate(new Date("2026-08-16T05:59:00+02:00"))).toBe("2026-08-15");
  });

  it("a partir de las 06:00 en punto empieza el siguiente día operativo", () => {
    expect(resolveOperationalDate(new Date("2026-08-16T06:00:00+02:00"))).toBe("2026-08-16");
  });

  it("una visita real a mediodía (fuera de horario nocturno) usa el día de calendario normal", () => {
    expect(resolveOperationalDate(new Date("2026-08-15T13:00:00+02:00"))).toBe("2026-08-15");
  });

  it("dos visitas en noches DISTINTAS nunca colapsan en el mismo día operativo", () => {
    const night1 = resolveOperationalDate(new Date("2026-08-15T23:45:00+02:00"));
    const night2 = resolveOperationalDate(new Date("2026-08-16T23:45:00+02:00"));
    expect(night1).not.toBe(night2);
  });
});
