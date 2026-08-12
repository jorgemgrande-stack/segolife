import { describe, it, expect } from "vitest";
import { buildValueRows, sanitizeOpenText, OPEN_TEXT_MAX_LENGTH, CommunityResponseError, type ResponsePayload } from "./communityResponseService";
import type { CommunityOption } from "../../../drizzle/schema";

function option(overrides: Partial<CommunityOption> = {}): CommunityOption {
  return { id: 1, proposalId: 1, label: "Opción", sortOrder: 0, isPositiveIntent: false, createdAt: new Date(), ...overrides } as CommunityOption;
}

const OPTS = [option({ id: 1, label: "A" }), option({ id: 2, label: "B" }), option({ id: 3, label: "C" })];

function expectInvalid(payload: ResponsePayload, options: CommunityOption[] = OPTS) {
  expect(() => buildValueRows(payload, options)).toThrow(CommunityResponseError);
}

describe("buildValueRows — validación por tipo de pregunta (spec puntos 6, 28-30)", () => {
  it("single_choice: opción válida produce una fila; opción ajena a la propuesta se rechaza", () => {
    const rows = buildValueRows({ questionType: "single_choice", optionId: 1 }, OPTS);
    expect(rows).toEqual([{ optionId: 1, valueText: null, valueNumber: null }]);
    expectInvalid({ questionType: "single_choice", optionId: 999 });
  });

  it("yes_no: solo acepta 'yes'/'no'", () => {
    expect(buildValueRows({ questionType: "yes_no", value: "yes" }, [])).toEqual([{ optionId: null, valueText: "yes", valueNumber: null }]);
  });

  it("percentage_scale: cada criterio 0-100 entero; fuera de rango se rechaza", () => {
    const rows = buildValueRows({ questionType: "percentage_scale", values: [{ optionId: 1, value: 0 }, { optionId: 2, value: 100 }] }, OPTS);
    expect(rows).toHaveLength(2);
    expectInvalid({ questionType: "percentage_scale", values: [{ optionId: 1, value: 101 }] });
    expectInvalid({ questionType: "percentage_scale", values: [{ optionId: 1, value: -1 }] });
    expectInvalid({ questionType: "percentage_scale", values: [] });
  });

  it("scale_1_5: solo enteros 1-5", () => {
    expect(buildValueRows({ questionType: "scale_1_5", value: 3 }, [])).toEqual([{ optionId: null, valueText: null, valueNumber: 3 }]);
    expectInvalid({ questionType: "scale_1_5", value: 0 });
    expectInvalid({ questionType: "scale_1_5", value: 6 });
  });

  it("multiselect: rechaza vacío y duplicados", () => {
    expect(buildValueRows({ questionType: "multiselect", optionIds: [1, 2] }, OPTS)).toHaveLength(2);
    expectInvalid({ questionType: "multiselect", optionIds: [] });
    expectInvalid({ questionType: "multiselect", optionIds: [1, 1] });
  });

  it("ranking: exige TODAS las opciones sin duplicados, asigna posición 1-based", () => {
    const rows = buildValueRows({ questionType: "ranking", orderedOptionIds: [3, 1, 2] }, OPTS);
    expect(rows).toEqual([
      { optionId: 3, valueText: null, valueNumber: 1 },
      { optionId: 1, valueText: null, valueNumber: 2 },
      { optionId: 2, valueText: null, valueNumber: 3 },
    ]);
    expectInvalid({ questionType: "ranking", orderedOptionIds: [1, 2] }); // parcial — falta la opción 3
    expectInvalid({ questionType: "ranking", orderedOptionIds: [1, 1, 2] }); // duplicado
  });

  it("attendance_intention: mapea al código numérico correcto", () => {
    expect(buildValueRows({ questionType: "attendance_intention", value: "definitely" }, [])).toEqual([{ optionId: null, valueText: "definitely", valueNumber: 3 }]);
  });

  it("me_apunto: siempre produce una fila fija, sin datos de entrada", () => {
    expect(buildValueRows({ questionType: "me_apunto" }, [])).toEqual([{ optionId: null, valueText: "me_apunto", valueNumber: null }]);
  });

  it("open_text: rechaza vacío tras sanitizar (p.ej. solo HTML)", () => {
    expect(buildValueRows({ questionType: "open_text", text: "Hola" }, [])[0].valueText).toBe("Hola");
    expectInvalid({ questionType: "open_text", text: "   " });
    expectInvalid({ questionType: "open_text", text: "<script></script>" });
  });
});

describe("sanitizeOpenText — spec punto 73 (sin HTML arbitrario, longitud acotada)", () => {
  it("elimina etiquetas HTML", () => {
    expect(sanitizeOpenText("<b>hola</b> <script>alert(1)</script>")).toBe("hola alert(1)");
  });

  it("recorta espacios y trunca al máximo permitido", () => {
    expect(sanitizeOpenText("  hola  ")).toBe("hola");
    const long = "a".repeat(OPEN_TEXT_MAX_LENGTH + 500);
    expect(sanitizeOpenText(long)).toHaveLength(OPEN_TEXT_MAX_LENGTH);
  });
});
