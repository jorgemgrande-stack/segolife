import { describe, it, expect } from "vitest";
import { VENUE_ADMIN_PERMISSION_BUNDLE, isGlobalScopePermission, isForbiddenModule } from "./venueAdminPolicy";

describe("VENUE_ADMIN_PERMISSION_BUNDLE — invariantes de seguridad (spec §22/§35, self-escalation)", () => {
  it("ningún permiso del bundle es de alcance global (.manage) — si lo fuera, getVenueStaffAccess trataría a Venue Admin como admin global y vería TODOS los venues", () => {
    for (const key of VENUE_ADMIN_PERMISSION_BUNDLE) {
      expect(isGlobalScopePermission(key)).toBe(false);
    }
  });

  it("ningún permiso del bundle pertenece a un módulo prohibido (settings/crm/engagement/integrations/students360/roles/tokens — spec §22/§28/§29/§30)", () => {
    for (const key of VENUE_ADMIN_PERMISSION_BUNDLE) {
      expect(isForbiddenModule(key)).toBe(false);
    }
  });

  it("el bundle es exactamente el sembrado en producción (Fase 4/8/9 + Fase 10: stock/caja)", () => {
    expect([...VENUE_ADMIN_PERMISSION_BUNDLE].sort()).toEqual(
      ["attendance.redeem", "benefits.redeem", "cash.operate", "cash.view", "commerce.record", "commerce.view", "stock.adjust", "stock.view"]
    );
  });

  describe("isGlobalScopePermission — detector", () => {
    it("detecta claves .manage como globales", () => {
      expect(isGlobalScopePermission("benefits.manage")).toBe(true);
      expect(isGlobalScopePermission("commerce.manage")).toBe(true);
      expect(isGlobalScopePermission("attendance.manage")).toBe(true);
      expect(isGlobalScopePermission("settings.manage")).toBe(true);
    });
    it("no marca como global un permiso .redeem/.view/.record real", () => {
      expect(isGlobalScopePermission("benefits.redeem")).toBe(false);
      expect(isGlobalScopePermission("commerce.view")).toBe(false);
      expect(isGlobalScopePermission("commerce.record")).toBe(false);
    });
  });

  describe("isForbiddenModule — dominios fuera de alcance de Venue Admin", () => {
    it("marca crm/engagement/settings/integrations/students360/roles/tokens como prohibidos", () => {
      expect(isForbiddenModule("crm.view")).toBe(true);
      expect(isForbiddenModule("engagement.manage")).toBe(true);
      expect(isForbiddenModule("settings.view")).toBe(true);
      expect(isForbiddenModule("integrations.manage")).toBe(true);
      expect(isForbiddenModule("students360.view")).toBe(true);
      expect(isForbiddenModule("tokens.manage")).toBe(true);
    });
    it("no marca benefits/commerce/attendance (dominios operativos reales de Venue Admin) como prohibidos", () => {
      expect(isForbiddenModule("benefits.redeem")).toBe(false);
      expect(isForbiddenModule("commerce.view")).toBe(false);
      expect(isForbiddenModule("attendance.redeem")).toBe(false);
    });
  });
});
