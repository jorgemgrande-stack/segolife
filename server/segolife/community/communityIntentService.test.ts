import { describe, it, expect } from "vitest";
import {
  attendanceIntentionFromCode, ATTENDANCE_INTENTION_CODES, ATTENDANCE_INTENTION_WEIGHTS,
  isPositiveAttendanceIntention, isPositiveRespondent, type AttendanceIntentionValue,
} from "./communityIntentService";
import type { CommunityOption, CommunityResponseValue } from "../../../drizzle/schema";

function value(overrides: Partial<CommunityResponseValue> = {}): CommunityResponseValue {
  return {
    id: 1, responseId: 1, optionId: null, valueText: null, valueNumber: null,
    isHidden: false, isFeatured: false, createdAt: new Date(),
    ...overrides,
  } as CommunityResponseValue;
}

function option(overrides: Partial<CommunityOption> = {}): CommunityOption {
  return {
    id: 1, proposalId: 1, label: "Opción", sortOrder: 0, isPositiveIntent: false, createdAt: new Date(),
    ...overrides,
  } as CommunityOption;
}

describe("ATTENDANCE_INTENTION — códigos y pesos (spec punto 40)", () => {
  it("codifica y decodifica el ciclo completo de valores", () => {
    (["no", "maybe", "probably", "definitely"] as AttendanceIntentionValue[]).forEach(v => {
      expect(attendanceIntentionFromCode(ATTENDANCE_INTENTION_CODES[v])).toBe(v);
    });
  });

  it("código desconocido cae a 'no' — nunca lanza ni inventa un valor", () => {
    expect(attendanceIntentionFromCode(99)).toBe("no");
  });

  it("pesos coinciden EXACTAMENTE con el ejemplo literal del encargo: no=0, maybe=0.35, probably=0.70, definitely=1.00", () => {
    expect(ATTENDANCE_INTENTION_WEIGHTS).toEqual({ no: 0, maybe: 0.35, probably: 0.70, definitely: 1.00 });
  });

  it("solo probably/definitely cuentan como intención positiva", () => {
    expect(isPositiveAttendanceIntention("no")).toBe(false);
    expect(isPositiveAttendanceIntention("maybe")).toBe(false);
    expect(isPositiveAttendanceIntention("probably")).toBe(true);
    expect(isPositiveAttendanceIntention("definitely")).toBe(true);
  });
});

describe("isPositiveRespondent — spec punto 48 (nunca inferir incorrectamente)", () => {
  it("yes_no: solo 'yes' es positivo", () => {
    expect(isPositiveRespondent({ questionType: "yes_no" }, [value({ valueText: "yes" })], [])).toBe(true);
    expect(isPositiveRespondent({ questionType: "yes_no" }, [value({ valueText: "no" })], [])).toBe(false);
  });

  it("attendance_intention: usa el código numérico + el mismo umbral probably/definitely", () => {
    expect(isPositiveRespondent({ questionType: "attendance_intention" }, [value({ valueNumber: ATTENDANCE_INTENTION_CODES.definitely })], [])).toBe(true);
    expect(isPositiveRespondent({ questionType: "attendance_intention" }, [value({ valueNumber: ATTENDANCE_INTENTION_CODES.maybe })], [])).toBe(false);
  });

  it("attendance_intention sin valor: null, nunca false por defecto", () => {
    expect(isPositiveRespondent({ questionType: "attendance_intention" }, [], [])).toBeNull();
  });

  it("me_apunto: responder ES la señal positiva por definición", () => {
    expect(isPositiveRespondent({ questionType: "me_apunto" }, [value()], [])).toBe(true);
    expect(isPositiveRespondent({ questionType: "me_apunto" }, [], [])).toBe(false);
  });

  it("single_choice: consulta el flag isPositiveIntent de la opción elegida, nunca asume", () => {
    const opts = [option({ id: 10, isPositiveIntent: true }), option({ id: 11, isPositiveIntent: false })];
    expect(isPositiveRespondent({ questionType: "single_choice" }, [value({ optionId: 10 })], opts)).toBe(true);
    expect(isPositiveRespondent({ questionType: "single_choice" }, [value({ optionId: 11 })], opts)).toBe(false);
  });

  it("single_choice con optionId que no existe en la lista de opciones: null, nunca revienta", () => {
    expect(isPositiveRespondent({ questionType: "single_choice" }, [value({ optionId: 999 })], [option({ id: 10 })])).toBeNull();
  });

  it("tipos sin semántica de intención definida (percentage_scale, ranking, scale_1_5, open_text, multiselect) devuelven null, nunca inventan una regla", () => {
    for (const questionType of ["percentage_scale", "ranking", "scale_1_5", "open_text", "multiselect"] as const) {
      expect(isPositiveRespondent({ questionType }, [value()], [])).toBeNull();
    }
  });
});
