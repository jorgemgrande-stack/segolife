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

import { getLegalCompanySettings, invoicePreviewToken, verifyInvoicePreviewToken, invoicePreviewUrl } from "./invoiceHtml";

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

/**
 * invoicePreviewToken/verifyInvoicePreviewToken — FINAL ZERO-DEBT (Block J).
 * /api/invoices/preview identificaba una factura SOLO por invoiceNumber
 * (correlativo, obligatorio por normativa fiscal, por tanto siempre
 * adivinable) — cualquiera podía enumerar FAC-2026-0001, 0002... y volcar
 * nombre/email/teléfono/NIF real de cada cliente. Estas funciones firman el
 * acceso con un HMAC derivado de JWT_SECRET, nunca expuesto al cliente.
 */
describe("invoicePreviewToken / verifyInvoicePreviewToken — firma de acceso a facturas", () => {
  it("el mismo número de factura siempre produce el mismo token (determinista)", () => {
    expect(invoicePreviewToken("FAC-2026-0001")).toBe(invoicePreviewToken("FAC-2026-0001"));
  });

  it("números de factura distintos producen tokens distintos", () => {
    expect(invoicePreviewToken("FAC-2026-0001")).not.toBe(invoicePreviewToken("FAC-2026-0002"));
  });

  it("verifica el token correcto para su propio número de factura", () => {
    const token = invoicePreviewToken("FAC-2026-0005");
    expect(verifyInvoicePreviewToken("FAC-2026-0005", token)).toBe(true);
  });

  it("rechaza el token de OTRA factura — no se puede reutilizar entre números (evita enumeración)", () => {
    const tokenForOther = invoicePreviewToken("FAC-2026-0002");
    expect(verifyInvoicePreviewToken("FAC-2026-0001", tokenForOther)).toBe(false);
  });

  it("rechaza un token vacío, ausente o inventado", () => {
    expect(verifyInvoicePreviewToken("FAC-2026-0001", "")).toBe(false);
    expect(verifyInvoicePreviewToken("FAC-2026-0001", "0000000000000000000000000000000000")).toBe(false);
  });

  it("invoicePreviewUrl construye la URL con número y token firmado, ambos verificables juntos", () => {
    const url = invoicePreviewUrl("FAC-2026-0009");
    const match = url.match(/^\/api\/invoices\/preview\?n=([^&]+)&t=([0-9a-f]+)$/);
    expect(match).not.toBeNull();
    const [, n, t] = match!;
    expect(decodeURIComponent(n)).toBe("FAC-2026-0009");
    expect(verifyInvoicePreviewToken("FAC-2026-0009", t)).toBe(true);
  });
});
