/**
 * identityResolver.test.ts — política de resolución en orden estricto
 * (Fase 5, punto 32): mapping previo > email participante > teléfono
 * participante > email comprador > unresolved. Nunca fuzzy match por nombre.
 *
 * fakeDb devuelve, en orden, la respuesta de cada `select().from().where().limit()`
 * que resolveIdentity() realmente ejecuta para ese escenario concreto — el
 * propio código de identityResolver.ts SOLO consulta un paso si el dato de
 * entrada correspondiente está presente (early-return en cuanto resuelve),
 * así que el nº de llamadas varía por test; no hace falta introspección de
 * qué tabla es cada consulta.
 */
import { describe, it, expect } from "vitest";
import { resolveIdentity } from "./identityResolver";

function fakeDb(responses: unknown[][]) {
  let callIndex = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => responses[callIndex++] ?? [],
        }),
      }),
    }),
  } as never;
}

describe("resolveIdentity — orden estricto de resolución", () => {
  it("1. mapping previo confirmado gana (única consulta: external_identity_mappings)", async () => {
    const db = fakeDb([[{ userId: 99 }]]);
    const result = await resolveIdentity({ provider: "weezevent", externalCustomerId: "wz_cust_1", participant: { email: "a@example.invalid" } }, db);
    expect(result).toEqual({ userId: 99, method: "previous_mapping" });
  });

  it("2. sin mapping previo, resuelve por email del participante", async () => {
    // sin externalCustomerId → paso 1 no consulta nada; única llamada real = users por email.
    const db = fakeDb([[{ id: 42 }]]);
    const result = await resolveIdentity({ provider: "weezevent", participant: { email: "student@example.invalid" } }, db);
    expect(result).toEqual({ userId: 42, method: "participant_email" });
  });

  it("3. email de participante no resuelve (BD vacía) → prueba teléfono del participante", async () => {
    const db = fakeDb([
      [], // users por email — no match
      [{ id: 43 }], // users por teléfono — match
    ]);
    const result = await resolveIdentity({ provider: "weezevent", participant: { email: "sin-cuenta@example.invalid", phone: "+34600000009" } }, db);
    expect(result).toEqual({ userId: 43, method: "participant_phone" });
  });

  it("4. sin email de participante (solo teléfono, sin match), prueba email del comprador (buyer)", async () => {
    // Sin participant.email: el paso 2 (email de participante) se omite sin
    // consultar nada — el guard de "email de comprador" (paso 4) exige
    // `!participantEmail || participantEmail === buyerEmail` para no
    // asociar a un comprador que compró para OTRA persona (spec punto 4:
    // "solo si es semánticamente la misma persona").
    const db = fakeDb([
      [], // users por teléfono de participante — no match
      [{ id: 44 }], // users por email de comprador — match
    ]);
    const result = await resolveIdentity({
      provider: "fourvenues",
      participant: { phone: "+34600000000" },
      buyer: { email: "comprador@example.invalid" },
    }, db);
    expect(result).toEqual({ userId: 44, method: "buyer_email" });
  });

  it("NO usa el email del comprador si el participante tiene un email DISTINTO conocido (evita asociar la compra al comprador cuando el asistente es otra persona)", async () => {
    const db = fakeDb([[]]); // solo se consulta users por email de participante — el resto se omite
    const result = await resolveIdentity({
      provider: "fourvenues",
      participant: { email: "invitado-sin-cuenta@example.invalid" },
      buyer: { email: "comprador@example.invalid" },
    }, db);
    expect(result).toEqual({ userId: null, method: null });
  });

  it("5. sin ninguna señal que resuelva → unresolved, nunca inventa un match", async () => {
    const db = fakeDb([[], [], []]);
    const result = await resolveIdentity({
      provider: "fourvenues",
      participant: { email: "nadie@example.invalid", phone: "+34600000001" },
      buyer: { email: "nadie@example.invalid" },
    }, db);
    expect(result).toEqual({ userId: null, method: null });
  });

  it("nunca hace fuzzy match por nombre — un participante sin email/teléfono con solo `name` queda unresolved sin ninguna consulta a users", async () => {
    const db = fakeDb([]);
    const result = await resolveIdentity({ provider: "fourvenues", participant: { name: "Juan Pérez" } }, db);
    expect(result.userId).toBeNull();
  });
});

// ─── Ambigüedad (Fourvenues Casanova Historical Validation, spec §16-18) ─────
// email tiene UNIQUE real en producción, pero phone NO — nunca se debe
// elegir la primera fila si el paso encuentra 2+ candidatos.
describe("resolveIdentity — ambigüedad, nunca elige la primera fila", () => {
  it("2+ Students con el mismo teléfono de participante → NO resuelve por esa vía, prueba el siguiente paso (buyer email) y SÍ puede resolver ahí", async () => {
    const db = fakeDb([
      [{ id: 10 }, { id: 11 }], // teléfono de participante — 2 candidatos, ambiguo
      [{ id: 12 }], // email del comprador — resuelve sin ambigüedad (sin email de participante, el guard del paso 4 se cumple)
    ]);
    const result = await resolveIdentity({
      provider: "fourvenues",
      participant: { phone: "+34600000005" }, // sin email de participante — el paso 2 no consulta nada
      buyer: { email: "comprador@example.invalid" },
    }, db);
    expect(result).toEqual({ userId: 12, method: "buyer_email" });
  });

  it("2+ Students con el mismo teléfono, sin ninguna otra señal que resuelva → unresolved, pero method='ambiguous_phone' (distinguible de 'sin ningún indicio')", async () => {
    const db = fakeDb([
      [{ id: 20 }, { id: 21 }], // teléfono de participante — 2 candidatos
    ]);
    const result = await resolveIdentity({
      provider: "fourvenues",
      participant: { phone: "+34600000006" },
    }, db);
    expect(result).toEqual({ userId: null, method: "ambiguous_phone" });
  });

  it("2+ filas para email de participante (defensa en profundidad aunque email tenga UNIQUE real) → ambiguous_email, nunca elige la primera", async () => {
    const db = fakeDb([
      [{ id: 30 }, { id: 31 }], // email de participante — 2 filas (no debería poder pasar en producción, pero el código nunca debe asumirlo)
    ]);
    const result = await resolveIdentity({
      provider: "fourvenues",
      participant: { email: "duplicado@example.invalid" },
    }, db);
    expect(result).toEqual({ userId: null, method: "ambiguous_email" });
  });

  it("email de participante ambiguo, teléfono SÍ resuelve sin ambigüedad → gana el teléfono (señal más fuerte encontrada después)", async () => {
    const db = fakeDb([
      [{ id: 40 }, { id: 41 }], // email de participante — ambiguo
      [{ id: 42 }], // teléfono de participante — resuelve
    ]);
    const result = await resolveIdentity({
      provider: "fourvenues",
      participant: { email: "duplicado@example.invalid", phone: "+34600000007" },
    }, db);
    expect(result).toEqual({ userId: 42, method: "participant_phone" });
  });
});
