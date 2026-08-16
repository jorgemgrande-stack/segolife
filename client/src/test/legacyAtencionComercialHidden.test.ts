/**
 * legacyAtencionComercialHidden.test.ts — SEGOLIFE COMMUNICATION CENTER
 * CONSOLIDATION (Fase 11, spec §4/§69/§70/§83 items 31-32). "Atención
 * Comercial" (WhatsApp GHL, Agente IA Vapi, seguimiento de presupuestos)
 * ya no debe ser un ítem de navegación activo — auditoría de esta fase
 * confirmó 0 uso real en producción (0 conversaciones GHL, 0 llamadas Vapi,
 * sin credenciales configuradas). Backend/rutas/tablas se dejan intactos a
 * propósito (spec §71: "Do NOT drop legacy tables") — este test solo cubre
 * la navegación, mismo criterio de lectura-de-fuente que
 * noLegacyBranding.test.ts (más barato/determinista que renderizar).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const ADMIN_LAYOUT_PATH = join(__dirname, "..", "components", "AdminLayout.tsx");

describe("AdminLayout — 'Atención Comercial' ya no es un ítem de navegación activo (Fase 11)", () => {
  it("el nav activo (fuera de comentarios) no contiene ningún label 'Atención Comercial'", () => {
    const source = stripComments(readFileSync(ADMIN_LAYOUT_PATH, "utf8"));
    expect(source).not.toMatch(/label:\s*"Atención Comercial"/);
  });

  it("el nav activo no contiene ninguna ruta /admin/atencion-comercial", () => {
    const source = stripComments(readFileSync(ADMIN_LAYOUT_PATH, "utf8"));
    expect(source).not.toMatch(/\/admin\/atencion-comercial/);
  });

  it("Communication Center SIGUE siendo un ítem de navegación activo (spec §87: sigue siendo la superficie canónica)", () => {
    const source = stripComments(readFileSync(ADMIN_LAYOUT_PATH, "utf8"));
    expect(source).toMatch(/label:\s*"Communication Center"/);
    expect(source).toMatch(/\/admin\/engagement\/overview/);
  });
});

// SEGOLIFE ADMIN AI/BI/COMMAND CENTER (Fase 12, spec §59, re-auditado): CRM
// (Facturas/Clientes/Propuestas) se conservó visible en Fase 9/11 "por si
// Fase 10 fiscal lo reutilizaba" — confirmado en esta fase que nunca ocurrió
// (fiscal real vive en tablas propias de SEGOLIFE). Se oculta ahora.
describe("AdminLayout — 'CRM' ya no es un ítem de navegación activo (Fase 12)", () => {
  it("el nav activo (fuera de comentarios) no contiene ningún label 'CRM' ni sus hijos Propuestas/Facturas/Clientes con key crm-*", () => {
    const source = stripComments(readFileSync(ADMIN_LAYOUT_PATH, "utf8"));
    expect(source).not.toMatch(/label:\s*"CRM"/);
    expect(source).not.toMatch(/key:\s*"crm-(propuestas|facturas|clientes)"/);
  });

  it("Command Center (Dashboard) SIGUE siendo el aterrizaje principal del admin (spec §2)", () => {
    const source = stripComments(readFileSync(ADMIN_LAYOUT_PATH, "utf8"));
    expect(source).toMatch(/href:\s*"\/admin"/);
  });
});
