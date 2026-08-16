/**
 * emailShell.test.ts — sistema de diseño de email. Cubre: escaping HTML
 * (seguridad, spec puntos 9/65 — un nombre de estudiante con markup nunca
 * debe inyectar HTML), compatibilidad básica (tabla/inline styles, sin CSS
 * moderno), y ausencia de branding heredado en el propio shell.
 */
import { describe, it, expect } from "vitest";
import { escapeHtml, ctaButton, secondaryButton, eventCard, tokensCard, benefitCard, renderEmailShell, renderPlainText } from "./emailShell";

describe("escapeHtml — seguridad", () => {
  it("escapa < > & \" ' — nunca deja pasar markup crudo", () => {
    expect(escapeHtml(`<script>alert('x')</script>`)).toBe("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
  });
  it("un nombre de estudiante con HTML nunca inyecta markup en un CTA", () => {
    const html = ctaButton(`<img src=x onerror=alert(1)>`, "https://example.invalid");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img");
  });
});

describe("componentes — forma esperada", () => {
  it("ctaButton produce un <a> con href seguro y label escapado", () => {
    const html = ctaButton("View event", "https://segolife.example/ie/events/1");
    expect(html).toContain('href="https://segolife.example/ie/events/1"');
    expect(html).toContain("View event");
  });

  it("secondaryButton usa un estilo distinto (outline) al CTA principal", () => {
    const html = secondaryButton("More info", "https://segolife.example");
    expect(html).toContain("border:1px solid");
  });

  it("eventCard incluye nombre/venue/fecha, omite el poster si no se da", () => {
    const html = eventCard({ eventName: "FOMO San Juan", venueName: "Casanova", dateLabel: "23 jun" });
    expect(html).toContain("FOMO San Juan");
    expect(html).toContain("Casanova");
    expect(html).not.toContain("<img");
  });

  it("tokensCard muestra el monto y el saldo", () => {
    const html = tokensCard({ amountLabel: "+100 ST", reason: "Attendance", balanceLabel: "1,420 ST" });
    expect(html).toContain("+100 ST");
    expect(html).toContain("1,420 ST");
  });

  it("benefitCard omite venue/expiry cuando no se dan (nunca 'undefined' visible)", () => {
    const html = benefitCard({ benefitName: "Free entry" });
    expect(html).toContain("Free entry");
    expect(html).not.toContain("undefined");
  });
});

describe("renderEmailShell — compatibilidad y branding", () => {
  const html = renderEmailShell({ locale: "en", preheader: "Test preheader", bodyRows: "<tr><td>content</td></tr>" });

  it("usa tabla 600px, sin flex/grid (compatibilidad de clientes de email)", () => {
    expect(html).toContain('width="600"');
    expect(html).not.toContain("display:flex");
    expect(html).not.toContain("display:grid");
  });

  it("incluye el preheader oculto y el bloque de contenido pasado", () => {
    expect(html).toContain("Test preheader");
    expect(html).toContain("<tr><td>content</td></tr>");
  });

  it("SIEMPRE muestra la marca SEGOLIFE, nunca Náyade/Skicenter/Rapalina", () => {
    expect(html).toContain("SEGOLIFE");
    const lower = html.toLowerCase();
    expect(lower).not.toContain("nayade");
    expect(lower).not.toContain("náyade");
    expect(lower).not.toContain("skicenter");
    expect(lower).not.toContain("rapalinahoteles");
  });

  it("no depende de fuentes externas (sin @import/link a Google Fonts u otro CDN)", () => {
    expect(html).not.toMatch(/@import|fonts\.googleapis|<link/);
  });

  it("la cabecera incluye el logo real de SEGOLIFE (icono cuadrado) con URL absoluta y alt de marca — nunca un <img> roto en un cliente de email", () => {
    expect(html).toContain('src="https://www.segolife.es/icons/segolife-icon.svg"');
    expect(html).toContain('alt="SEGOLIFE"');
  });

  it("preferencesUrl solo aparece en el footer si se pasa explícitamente", () => {
    const withPrefs = renderEmailShell({ locale: "en", preheader: "x", bodyRows: "<tr><td>x</td></tr>", preferencesUrl: "/ie/preferences" });
    expect(withPrefs).toContain("/ie/preferences");
    expect(html).not.toContain("Manage email preferences");
  });
});

describe("renderPlainText — alternativa texto plano", () => {
  it("incluye headline, párrafos y CTA si se dan", () => {
    const text = renderPlainText({ locale: "en", headline: "Your ticket is ready", paragraphs: ["Casanova — 23 Jun"], ctaLabel: "View ticket", ctaUrl: "https://x.example" });
    expect(text).toContain("Your ticket is ready");
    expect(text).toContain("Casanova — 23 Jun");
    expect(text).toContain("View ticket: https://x.example");
  });
});
