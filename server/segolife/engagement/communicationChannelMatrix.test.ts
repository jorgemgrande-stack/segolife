/**
 * communicationChannelMatrix.test.ts — la matriz central es la ÚNICA fuente
 * de qué canales adicionales se intentan (spec punto 27: "no hardcodear en
 * 20 listeners"). Cubre en particular que WhatsApp NUNCA se traduce a un
 * intento real (spec: "NO ACTIVES WHATSAPP") aunque una plantilla lo declare.
 */
import { describe, it, expect } from "vitest";
import { resolveAdditionalChannels, resolveWhatsappPolicy } from "./communicationChannelMatrix";
import { ENGAGEMENT_TEMPLATES } from "./templates";

describe("resolveAdditionalChannels", () => {
  it("una plantilla activa con canal email devuelve ['email']", () => {
    expect(resolveAdditionalChannels("benefit_granted")).toEqual(["email"]);
  });

  it("una plantilla solo in_app no devuelve ningún canal adicional", () => {
    expect(resolveAdditionalChannels("event_tonight")).toEqual([]);
  });

  it("una plantilla 'prepared' (V2, sin listener) nunca devuelve canales — nunca se dispara aunque exista en el catálogo", () => {
    expect(ENGAGEMENT_TEMPLATES.token_milestone.status).toBe("prepared");
    expect(resolveAdditionalChannels("token_milestone")).toEqual([]);
  });

  it("una clave de plantilla desconocida devuelve [] en vez de lanzar", () => {
    expect(resolveAdditionalChannels("no_existe")).toEqual([]);
  });

  it("NUNCA incluye 'whatsapp' aunque una plantilla lo declarara en channels (canal preparado, no activado)", () => {
    for (const key of Object.keys(ENGAGEMENT_TEMPLATES)) {
      expect(resolveAdditionalChannels(key)).not.toContain("whatsapp");
    }
  });

  it("NUNCA incluye 'push' (sin flujo de registro de push_subscriptions todavía)", () => {
    for (const key of Object.keys(ENGAGEMENT_TEMPLATES)) {
      expect(resolveAdditionalChannels(key)).not.toContain("push");
    }
  });
});

describe("resolveWhatsappPolicy — informativa, nunca activa un canal real", () => {
  it("una plantilla sin whatsapp en channels devuelve 'never'", () => {
    expect(resolveWhatsappPolicy("benefit_granted")).toBe("never");
  });

  it("una clave desconocida devuelve 'never'", () => {
    expect(resolveWhatsappPolicy("no_existe")).toBe("never");
  });
});
