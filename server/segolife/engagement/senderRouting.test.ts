/**
 * senderRouting.test.ts — Communication Center, routing de remitentes
 * (spec §2). Solo lógica pura, sin BD.
 */
import { describe, it, expect } from "vitest";
import { resolveSenderByAdminCategory, resolveSenderByNotificationCategory, formatSender, SENDER_IDENTITIES } from "./senderRouting";

describe("resolveSenderByAdminCategory", () => {
  it("COMMUNITY → community@segolife.es", () => {
    expect(resolveSenderByAdminCategory("COMMUNITY").email).toBe("community@segolife.es");
  });

  it("EVENTS y TICKETING → tickets@segolife.es (mismo remitente, ambos dominio de entradas)", () => {
    expect(resolveSenderByAdminCategory("EVENTS").email).toBe("tickets@segolife.es");
    expect(resolveSenderByAdminCategory("TICKETING").email).toBe("tickets@segolife.es");
  });

  it("ACCOUNT/SECURITY/SYSTEM/SEGOTOKENS/BENEFITS/PLAN_AND_PLAY/ENGAGEMENT → segolife@segolife.es (sistema, ninguno tiene remitente humano dedicado)", () => {
    for (const cat of ["ACCOUNT", "SECURITY", "SYSTEM", "SEGOTOKENS", "BENEFITS", "PLAN_AND_PLAY", "ENGAGEMENT"] as const) {
      expect(resolveSenderByAdminCategory(cat).email).toBe("segolife@segolife.es");
    }
  });

  it("sin categoría (null/undefined) cae al remitente de sistema, nunca lanza", () => {
    expect(resolveSenderByAdminCategory(null).key).toBe("system");
    expect(resolveSenderByAdminCategory(undefined).key).toBe("system");
  });
});

describe("resolveSenderByNotificationCategory (fallback sin templateKey — campañas manuales)", () => {
  it("events → tickets@segolife.es", () => {
    expect(resolveSenderByNotificationCategory("events").email).toBe("tickets@segolife.es");
  });

  it("rewards/benefits/promotions/account → segolife@segolife.es", () => {
    for (const cat of ["rewards", "benefits", "promotions", "account"] as const) {
      expect(resolveSenderByNotificationCategory(cat).email).toBe("segolife@segolife.es");
    }
  });
});

describe("formatSender", () => {
  it("formatea 'Nombre <email>' — mismo formato que sendEmailTracked/parseSender esperan", () => {
    expect(formatSender(SENDER_IDENTITIES.community)).toBe("Segolife Community <community@segolife.es>");
  });
});

describe("SENDER_IDENTITIES — las 6 direcciones reales del spec §2", () => {
  it("expone exactamente 6 remitentes, todos @segolife.es", () => {
    const keys = Object.keys(SENDER_IDENTITIES);
    expect(keys.sort()).toEqual(["community", "human", "partners", "support", "system", "tickets"]);
    for (const identity of Object.values(SENDER_IDENTITIES)) {
      expect(identity.email.endsWith("@segolife.es")).toBe(true);
    }
  });
});
