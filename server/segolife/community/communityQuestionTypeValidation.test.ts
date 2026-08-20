import { describe, it, expect } from "vitest";
import { validateQuestionTypeOptions, QUESTION_TYPES_WITH_OPTIONS, MIN_OPTIONS, MAX_OPTIONS } from "./communityQuestionTypeValidation";

describe("validateQuestionTypeOptions — tipos CON opciones discretas", () => {
  for (const type of QUESTION_TYPES_WITH_OPTIONS) {
    it(`${type}: rechaza sin opciones`, () => {
      expect(validateQuestionTypeOptions(type, [])).toMatchObject({ ok: false });
    });

    it(`${type}: rechaza con 1 sola opción`, () => {
      expect(validateQuestionTypeOptions(type, ["Jueves"])).toMatchObject({ ok: false });
    });

    it(`${type}: acepta con exactamente ${MIN_OPTIONS} opciones`, () => {
      const result = validateQuestionTypeOptions(type, ["Jueves", "Viernes"]);
      expect(result.ok).toBe(true);
      expect(result.cleanOptions).toEqual(["Jueves", "Viernes"]);
    });

    it(`${type}: rechaza más de ${MAX_OPTIONS} opciones`, () => {
      const many = Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => `Opción ${i}`);
      expect(validateQuestionTypeOptions(type, many)).toMatchObject({ ok: false });
    });

    it(`${type}: descarta opciones vacías/solo-espacios antes de contar el mínimo`, () => {
      expect(validateQuestionTypeOptions(type, ["Jueves", "   ", ""])).toMatchObject({ ok: false });
    });

    it(`${type}: recorta espacios en las opciones válidas`, () => {
      const result = validateQuestionTypeOptions(type, ["  Jueves  ", "Viernes"]);
      expect(result.cleanOptions).toEqual(["Jueves", "Viernes"]);
    });
  }
});

describe("validateQuestionTypeOptions — tipos SIN opciones (semántica fija en código)", () => {
  const typesWithoutOptions = ["yes_no", "scale_1_5", "attendance_intention", "me_apunto", "open_text"] as const;

  for (const type of typesWithoutOptions) {
    it(`${type}: acepta sin opciones`, () => {
      expect(validateQuestionTypeOptions(type, [])).toEqual({ ok: true, cleanOptions: [] });
      expect(validateQuestionTypeOptions(type, undefined)).toEqual({ ok: true, cleanOptions: [] });
      expect(validateQuestionTypeOptions(type, null)).toEqual({ ok: true, cleanOptions: [] });
    });

    it(`${type}: RECHAZA opciones arbitrarias (bug real que el servidor no comprobaba antes de MG-05)`, () => {
      expect(validateQuestionTypeOptions(type, ["Jueves", "Viernes"])).toMatchObject({ ok: false });
    });
  }
});
