import { describe, it, expect } from "vitest";
import { computeValidityWindow, madridWallTimeToUtc } from "./benefitValidityEngine";

describe("benefitValidityEngine", () => {
  describe("validityType='immediate'", () => {
    it("sin duración: valid_from=trigger, valid_until=null (sin caducidad, intencional)", () => {
      const trigger = new Date("2026-06-10T20:00:00Z");
      const { validFrom, validUntil } = computeValidityWindow({ validityType: "immediate" }, trigger);
      expect(validFrom.getTime()).toBe(trigger.getTime());
      expect(validUntil).toBeNull();
    });

    it("con duración: valid_until = trigger + N minutos", () => {
      const trigger = new Date("2026-06-10T20:00:00Z");
      const { validFrom, validUntil } = computeValidityWindow({ validityType: "immediate", validityDurationMinutes: 120 }, trigger);
      expect(validFrom.getTime()).toBe(trigger.getTime());
      expect(validUntil?.getTime()).toBe(trigger.getTime() + 120 * 60000);
    });
  });

  describe("validityType='offset'", () => {
    it("valid_from = trigger + offset; valid_until = valid_from + duración", () => {
      const trigger = new Date("2026-06-10T20:00:00Z");
      const { validFrom, validUntil } = computeValidityWindow(
        { validityType: "offset", validityOffsetMinutes: 30, validityDurationMinutes: 60 },
        trigger
      );
      expect(validFrom.getTime()).toBe(trigger.getTime() + 30 * 60000);
      expect(validUntil?.getTime()).toBe(trigger.getTime() + 90 * 60000);
    });

    it("sin duración: valid_until=null", () => {
      const trigger = new Date("2026-06-10T20:00:00Z");
      const { validUntil } = computeValidityWindow({ validityType: "offset", validityOffsetMinutes: 15 }, trigger);
      expect(validUntil).toBeNull();
    });
  });

  describe("validityType='day_anchored' — caso canónico viernes 23:45 → sábado 00:00–01:00", () => {
    it("ancla al día siguiente en hora de pared Madrid, cruzando medianoche del trigger", () => {
      // 2026-06-12 es viernes. 23:45 hora de Madrid en junio = CEST (UTC+2) → 21:45 UTC.
      const trigger = new Date("2026-06-12T21:45:00Z");
      const { validFrom, validUntil } = computeValidityWindow(
        { validityType: "day_anchored", validityDaysOffset: 1, validityStartTime: "00:00", validityEndTime: "01:00" },
        trigger
      );
      // Sábado 2026-06-13 00:00 Madrid (CEST, +2) = 2026-06-12T22:00:00Z.
      expect(validFrom.toISOString()).toBe("2026-06-12T22:00:00.000Z");
      // Sábado 2026-06-13 01:00 Madrid (CEST, +2) = 2026-06-12T23:00:00Z.
      expect(validUntil?.toISOString()).toBe("2026-06-12T23:00:00.000Z");
    });

    it("daysOffset=0 con start/end el mismo día no cruza a un día distinto", () => {
      const trigger = new Date("2026-06-12T10:00:00Z"); // mediodía Madrid
      const { validFrom, validUntil } = computeValidityWindow(
        { validityType: "day_anchored", validityDaysOffset: 0, validityStartTime: "18:00", validityEndTime: "23:00" },
        trigger
      );
      expect(validFrom.toISOString()).toBe("2026-06-12T16:00:00.000Z"); // 18:00 CEST = 16:00Z
      expect(validUntil?.toISOString()).toBe("2026-06-12T21:00:00.000Z"); // 23:00 CEST = 21:00Z
    });

    it("end_time <= start_time el mismo día ancla se interpreta cruzando medianoche (mismo criterio que venue_token_schedules)", () => {
      const trigger = new Date("2026-06-12T10:00:00Z");
      const { validFrom, validUntil } = computeValidityWindow(
        { validityType: "day_anchored", validityDaysOffset: 0, validityStartTime: "22:00", validityEndTime: "02:00" },
        trigger
      );
      expect(validFrom.toISOString()).toBe("2026-06-12T20:00:00.000Z"); // 22:00 CEST
      expect(validUntil?.toISOString()).toBe("2026-06-13T00:00:00.000Z"); // 02:00 CEST del día SIGUIENTE
    });

    it("start_time null: valid_from es el instante dinámico del trigger, no una hora fija", () => {
      const trigger = new Date("2026-06-12T21:45:00Z");
      const { validFrom, validUntil } = computeValidityWindow(
        { validityType: "day_anchored", validityDaysOffset: 0, validityEndTime: "23:59" },
        trigger
      );
      expect(validFrom.getTime()).toBe(trigger.getTime());
      expect(validUntil?.toISOString()).toBe("2026-06-12T21:59:00.000Z");
    });

    it("sin end_time: valid_until=null (vigencia abierta hasta que se use o se cancele)", () => {
      const trigger = new Date("2026-06-12T21:45:00Z");
      const { validUntil } = computeValidityWindow(
        { validityType: "day_anchored", validityDaysOffset: 1, validityStartTime: "00:00" },
        trigger
      );
      expect(validUntil).toBeNull();
    });
  });

  describe("medianoche — origen justo en el borde del día calendario Madrid", () => {
    it("trigger a las 23:59:59 Madrid, daysOffset=1 sigue anclando al día calendario CORRECTO (no al UTC)", () => {
      // 2026-06-12 23:59:59 Madrid (CEST +2) = 2026-06-12T21:59:59Z — el día
      // calendario Madrid es 12, aunque en UTC ya casi es 22:00. daysOffset=1
      // debe anclar al 13, no calcular mal por estar cerca de la medianoche UTC.
      const trigger = new Date("2026-06-12T21:59:59Z");
      const { validFrom } = computeValidityWindow(
        { validityType: "day_anchored", validityDaysOffset: 1, validityStartTime: "00:00" },
        trigger
      );
      expect(validFrom.toISOString()).toBe("2026-06-12T22:00:00.000Z"); // 2026-06-13T00:00 Madrid
    });

    it("trigger justo tras medianoche Madrid (00:00:01), daysOffset=0 ancla al mismo día ya iniciado", () => {
      // 2026-06-13T00:00:01 Madrid (CEST) = 2026-06-12T22:00:01Z.
      const trigger = new Date("2026-06-12T22:00:01Z");
      const { validFrom } = computeValidityWindow(
        { validityType: "day_anchored", validityDaysOffset: 0, validityStartTime: "00:00" },
        trigger
      );
      expect(validFrom.toISOString()).toBe("2026-06-12T22:00:00.000Z"); // 2026-06-13T00:00 Madrid, mismo día
    });
  });

  describe("DST (CET/CEST) — madridWallTimeToUtc", () => {
    it("00:00 Madrid en invierno (CET, UTC+1) vs verano (CEST, UTC+2) produce offsets distintos", () => {
      const winter = madridWallTimeToUtc("2026-01-15", "00:00"); // CET, +1
      const summer = madridWallTimeToUtc("2026-07-15", "00:00"); // CEST, +2
      expect(winter.toISOString()).toBe("2026-01-14T23:00:00.000Z");
      expect(summer.toISOString()).toBe("2026-07-14T22:00:00.000Z");
    });

    it("computeValidityWindow day_anchored respeta el mismo offset CET/CEST según la fecha del trigger", () => {
      const winterTrigger = new Date("2026-01-15T10:00:00Z"); // mediodía Madrid en enero
      const winterWindow = computeValidityWindow(
        { validityType: "day_anchored", validityDaysOffset: 0, validityStartTime: "20:00" },
        winterTrigger
      );
      expect(winterWindow.validFrom.toISOString()).toBe("2026-01-15T19:00:00.000Z"); // 20:00 CET = 19:00Z

      const summerTrigger = new Date("2026-07-15T10:00:00Z");
      const summerWindow = computeValidityWindow(
        { validityType: "day_anchored", validityDaysOffset: 0, validityStartTime: "20:00" },
        summerTrigger
      );
      expect(summerWindow.validFrom.toISOString()).toBe("2026-07-15T18:00:00.000Z"); // 20:00 CEST = 18:00Z
    });
  });
});
