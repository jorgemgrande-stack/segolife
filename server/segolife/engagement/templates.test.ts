/**
 * templates.test.ts — interpolación segura (solo variables declaradas en
 * allowedVariables, spec punto 16) y sustitución dual EN/ES cuando la
 * propia variable es un texto traducido (p.ej. nombre de un beneficio).
 * Esto es lo que respalda el requisito de idioma: IE=EN/UVA=ES se resuelve
 * en el FRONTEND eligiendo titleEn/titleEs — aquí se comprueba que ambas
 * versiones quedan correctamente renderizadas y snapshot-eadas desde ya.
 */
import { describe, it, expect } from "vitest";
import { renderTemplate, ENGAGEMENT_TEMPLATES } from "./templates";

describe("templates — renderTemplate", () => {
  it("usa la copia EXACTA del spec para benefit_granted (EN/ES)", () => {
    const rendered = renderTemplate("benefit_granted", { benefitName: "Free entry tomorrow at Casanova" });
    expect(rendered.titleEn).toBe("You unlocked a benefit");
    expect(rendered.titleEs).toBe("Has desbloqueado un beneficio");
    expect(rendered.bodyEn).toBe("Free entry tomorrow at Casanova");
  });

  it("sustituye la MISMA variable con texto distinto en EN vs ES cuando se pasa varsEs", () => {
    const rendered = renderTemplate(
      "benefit_granted",
      { benefitName: "Free Entry Tomorrow" },
      null,
      { benefitName: "Entrada gratis mañana" }
    );
    expect(rendered.bodyEn).toBe("Free Entry Tomorrow");
    expect(rendered.bodyEs).toBe("Entrada gratis mañana");
  });

  it("sin varsEs, reutiliza el mismo vars para ambos idiomas (variables no traducibles, p.ej. cantidades)", () => {
    const rendered = renderTemplate("recurrence_progress", { bonusAmount: "200" });
    expect(rendered.bodyEn).toBe("One more visit to unlock +200 SegoTokens");
    expect(rendered.bodyEs).toBe("Una visita más para desbloquear +200 SegoTokens");
  });

  it("NUNCA sustituye una variable no declarada en allowedVariables (anti-injection)", () => {
    const rendered = renderTemplate("benefit_granted", { benefitName: "X", evil: "{{__proto__}}" } as any);
    expect(rendered.bodyEn).toBe("X"); // benefitName sí declarada
    // Si alguien intentara colar {{evil}} en el propio texto de plantilla no pasaría —
    // esto se comprueba a nivel de catálogo: ninguna plantilla usa una variable no listada.
    for (const t of Object.values(ENGAGEMENT_TEMPLATES)) {
      const usedVars = [...`${t.titleEn}${t.titleEs}${t.bodyEn}${t.bodyEs}`.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
      for (const v of usedVars) expect(t.allowedVariables).toContain(v);
    }
  });

  it("una variable pasada pero no declarada se ignora silenciosamente (placeholder queda intacto)", () => {
    // recurrence_progress solo declara bonusAmount — probar con una clave extra irrelevante.
    const rendered = renderTemplate("recurrence_progress", { bonusAmount: "50", unrelated: "hacked" });
    expect(rendered.bodyEn).toBe("One more visit to unlock +50 SegoTokens");
  });

  it("lanza para una clave de plantilla desconocida", () => {
    expect(() => renderTemplate("no_existe", {})).toThrow();
  });

  it("aplica el whitelist de deep link también aquí (una URL externa nunca sobrevive al render)", () => {
    const rendered = renderTemplate("benefit_granted", { benefitName: "X" }, "https://evil.example");
    expect(rendered.deepLink).toBeNull();
  });

  // Fase 16 (auditoría) — bug real encontrado: sanitizeDeepLink() exige que
  // el deep link sea relativo (whitelist anti-phishing), pero el HTML de
  // email lo usaba TAL CUAL como href — un link relativo no navega a
  // ningún sitio dentro de un cliente de correo (no hay "página actual"
  // contra la que resolverlo). El CTA de CUALQUIER plantilla con deep link
  // quedaba roto en email (incluido password_reset_requested, la más
  // crítica: sin este fix el estudiante no podía resetear su contraseña).
  it("el deep link relativo se absolutiza con el host canónico SOLO en el HTML de email, nunca en result.deepLink (que sigue sirviendo para navegación in-app)", () => {
    const rendered = renderTemplate("password_reset_requested", { expiryMinutes: "60" }, "/nueva-contrasena?token=abc123");
    expect(rendered.deepLink).toBe("/nueva-contrasena?token=abc123");
    expect(rendered.emailHtmlEn).toContain('href="https://www.segolife.es/nueva-contrasena?token=abc123"');
    expect(rendered.emailHtmlEs).toContain('href="https://www.segolife.es/nueva-contrasena?token=abc123"');
  });

  it("sin deep link, el email nunca renderiza un botón CTA roto (ni relativo ni con host vacío)", () => {
    const rendered = renderTemplate("password_reset_requested", { expiryMinutes: "60" }, null);
    expect(rendered.emailHtmlEn).not.toContain("<a href=");
  });

  it("cada plantilla declara audienceType y esto determina si respeta preferencias (transactional siempre pasa)", () => {
    expect(ENGAGEMENT_TEMPLATES.benefit_granted.audienceType).toBe("transactional");
    expect(ENGAGEMENT_TEMPLATES.event_tonight.audienceType).toBe("marketing");
  });

  // FIX-05 — plantillas Admin del catalog sync de Fourvenues (nunca dirigidas al Student).
  describe("fourvenues_event_published / fourvenues_event_unpublished (FIX-05)", () => {
    it("fourvenues_event_published interpola venueName/eventName/dateLabel y acepta el deep link admin real", () => {
      const rendered = renderTemplate(
        "fourvenues_event_published",
        { venueName: "Casanova", eventName: "WHITE PARTY", dateLabel: "15/09/2026 00:30" },
        "/admin/events/42"
      );
      expect(rendered.titleEs).toBe("Nuevo evento publicado en Fourvenues");
      expect(rendered.bodyEs).toBe('Casanova ha publicado "WHITE PARTY" para el 15/09/2026 00:30.');
      expect(rendered.deepLink).toBe("/admin/events/42");
    });

    it("fourvenues_event_unpublished interpola eventName/venueName, nunca afirma 'cancelado'", () => {
      const rendered = renderTemplate(
        "fourvenues_event_unpublished",
        { venueName: "Tía Felisa", eventName: "MIÉRCOLES LOCOS" },
        "/admin/events/206"
      );
      expect(rendered.bodyEn).toBe('"MIÉRCOLES LOCOS" at Tía Felisa is no longer published on Fourvenues and is not visible to students.');
      expect(rendered.bodyEn.toLowerCase()).not.toContain("cancel");
      expect(rendered.deepLink).toBe("/admin/events/206");
    });

    it("ambas son solo in_app, transactional, category=events — nunca email/SMS/WhatsApp automático (spec §20/§29)", () => {
      expect(ENGAGEMENT_TEMPLATES.fourvenues_event_published.channels).toEqual(["in_app"]);
      expect(ENGAGEMENT_TEMPLATES.fourvenues_event_unpublished.channels).toEqual(["in_app"]);
      expect(ENGAGEMENT_TEMPLATES.fourvenues_event_published.audienceType).toBe("transactional");
      expect(ENGAGEMENT_TEMPLATES.fourvenues_event_unpublished.audienceType).toBe("transactional");
      expect(ENGAGEMENT_TEMPLATES.fourvenues_event_published.category).toBe("events");
      expect(ENGAGEMENT_TEMPLATES.fourvenues_event_unpublished.category).toBe("events");
    });
  });
});
