/**
 * invoiceHtml.test.ts — PRE-16.16 (§17-19/§49/§61): getLegalCompanySettings
 * ahora lee de system_settings (la fuente que el panel admin realmente
 * edita — Settings.tsx "Empresa legal", ConfigPanel.tsx, OnboardingWizard.tsx)
 * en vez de la site_settings desconectada que ningún UI admin escribía.
 * Confirma el invariante que pide PRE-16.16: un único consumidor activo
 * ahora lee la fuente canónica, y ese consumidor nunca vuelve a caer en la
 * identidad heredada (Iron Elephant/Náyade) si system_settings no responde.
 */
import { describe, it, expect, vi } from "vitest";

const { mockGetSystemSetting } = vi.hoisted(() => ({ mockGetSystemSetting: vi.fn() }));
vi.mock("./config", () => ({
  getSystemSetting: mockGetSystemSetting,
  getSystemSettingSync: vi.fn().mockReturnValue(""),
}));

import { getLegalCompanySettings } from "./invoiceHtml";

describe("getLegalCompanySettings — fuente canónica (system_settings, no site_settings)", () => {
  it("lee las claves nativas de system_settings (site_legal_name/brand_nif/brand_address/site_legal_*)", async () => {
    mockGetSystemSetting.mockImplementation((key: string, fallback: string) => Promise.resolve({
      site_legal_name: "HAYQUE CAPITAL, S.L.",
      brand_nif: "B13989264",
      brand_address: "Finca Lindaraja, s/n",
      site_legal_city: "Segovia",
      site_legal_zip: "40420",
      site_legal_province: "Segovia",
      site_legal_email: "",
      site_legal_phone: "",
      site_legal_iban: "",
    }[key] ?? fallback));

    const result = await getLegalCompanySettings();

    expect(result).toEqual({
      name: "HAYQUE CAPITAL, S.L.", cif: "B13989264", address: "Finca Lindaraja, s/n",
      city: "Segovia", zip: "40420", province: "Segovia", email: "", phone: "", iban: "",
    });
    expect(mockGetSystemSetting).toHaveBeenCalledWith("site_legal_name", expect.any(String));
    expect(mockGetSystemSetting).toHaveBeenCalledWith("brand_nif", expect.any(String));
  });

  it("si system_settings no responde (DB caída), cae a HAYQUE CAPITAL — nunca a Iron Elephant/Náyade", async () => {
    mockGetSystemSetting.mockImplementation((_key: string, fallback: string) => Promise.resolve(fallback));

    const result = await getLegalCompanySettings();

    expect(result.name).toBe("HAYQUE CAPITAL, S.L.");
    expect(result.cif).toBe("B13989264");
    expect(result.name).not.toMatch(/iron elephant/i);
    expect(result.name).not.toMatch(/n[áa]yade/i);
  });
});
