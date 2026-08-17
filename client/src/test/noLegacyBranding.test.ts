/**
 * noLegacyBranding.test.ts — spec Fase 6, punto 48: ninguna página pública
 * de Segolife puede mostrar contenido/marca heredada de Náyade (hotel, SPA,
 * experiencias acuáticas, reservas, razón social). Test estático: lee el
 * código fuente de cada página/componente Segolife y falla si aparece
 * alguna cadena prohibida — más barato y determinista que renderizar cada
 * página para comprobar lo mismo visualmente.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const SEGOLIFE_DIRS = [
  join(__dirname, "..", "pages", "segolife"),
  join(__dirname, "..", "pages", "staff"),
  join(__dirname, "..", "components", "segolife"),
  // Fase 8.5 — nueva Home pública SEGOLIFE ("/"): vive fuera de pages/segolife
  // (esa carpeta es la app autenticada por comunidad) y de components/segolife
  // (esa carpeta es el design system de la app autenticada), así que necesita
  // su propia entrada explícita para quedar cubierta por este guard.
  join(__dirname, "..", "components", "publicHome"),
  // PRE-16.16B: el Portal del Empleado, la administración de Personal/RRHH y
  // el Portal de Gestoría son ahora funcionalidad activa de Segolife — ningún
  // guard de branding los cubría antes (confirmado: tenían Náyade real en
  // producción, ver EmployeeLayout.tsx/EmployeePortal.tsx/EmployeesList.tsx/
  // GestoriaPortal.tsx, ya corregidos en esta fase).
  join(__dirname, "..", "pages", "employee"),
  join(__dirname, "..", "pages", "admin", "hr"),
  join(__dirname, "..", "pages", "gestoria"),
];

// PublicHome.tsx vive en pages/ raíz (junto a Home.tsx, la home heredada de
// Náyade que YA NO se monta en "/" pero que el propio guard no puede barrer
// sin falsos positivos — pages/ raíz tiene decenas de páginas legacy
// intencionadamente fuera de este test). Se lista aparte, un archivo suelto.
const SEGOLIFE_SINGLE_FILES = [
  join(__dirname, "..", "pages", "PublicHome.tsx"),
  // Fase 8.5 — MaintenanceNotice envuelve TODA la app, incluidas /ie /uva —
  // sí debe pasar el guard completo (nunca debería mostrar "Hotel"/"SPA"
  // tampoco, no solo "Náyade").
  join(__dirname, "..", "pages", "MaintenanceNotice.tsx"),
  // SetPassword: pantalla de activación de cuenta genérica para cualquier
  // rol invitado, incluidos futuros roles Segolife — mismo criterio.
  join(__dirname, "..", "pages", "SetPassword.tsx"),
];

// AdminLayout.tsx y AdminDashboard.tsx son compartidos con secciones admin
// legacy (Hotel/SPA/TPV/etc., ocultas por feature flag pero con nombres de
// módulo legítimos en su propio código — "Hotel"/"SPA" no son branding
// heredado ahí, son nombres de módulo reales) — el guard genérico con
// FORBIDDEN_PATTERNS completo daría falsos positivos. Se corrigió
// específicamente el logo/nombre por defecto y el saludo del dashboard
// (ver AdminLayout.tsx:408-416, AdminDashboard.tsx:417) — el guard de
// regresión aquí se acota a "Náyade" en vez de reutilizar la lista completa.
const NAYADE_ONLY_FILES = [
  join(__dirname, "..", "components", "AdminLayout.tsx"),
  join(__dirname, "..", "pages", "admin", "AdminDashboard.tsx"),
  // Fase 8.6 — admin de Venues/Events es SEGOLIFE puro (sin secciones legacy
  // compartidas), así que se cubre igual que el resto de páginas admin
  // nuevas de esta fase: nunca debería mencionar Náyade.
  join(__dirname, "..", "pages", "admin", "venues", "VenueDetail.tsx"),
  join(__dirname, "..", "pages", "admin", "events", "EventsManager.tsx"),
  join(__dirname, "..", "pages", "admin", "events", "EventDetail.tsx"),
  join(__dirname, "..", "pages", "admin", "events", "EventCreate.tsx"),
];

const FORBIDDEN_PATTERNS = [
  /n[áa]yade/i,
  /\bhotel\b/i,
  /\bspa\b/i,
  /experiencias?\s+acu[áa]ticas?/i,
  /RAPALINAHOTELES/i,
  /reserva\s+de\s+hotel/i,
  /skicenter/i,
];

// Fase 8.5 — algunos de los archivos ahora cubiertos (AdminLayout,
// MaintenanceNotice, SetPassword, AdminDashboard) documentan en comentarios
// POR QUÉ se corrigió el branding heredado, lo que legítimamente menciona
// "Náyade" como lo que ya NO se debe mostrar — mismo criterio ya establecido
// en server/segolife/*/noLegacyBranding.test.ts (Fase 7/8): se descartan los
// comentarios antes de comprobar, solo importa el contenido que se renderiza.
function stripComments(source: string): string {
  // PRE-16.16B: negative lookbehind — no trata el "//" de una URL
  // ("https://...") como inicio de comentario (antes ocultaba literales de
  // dominio prohibidos, ej. "https://www.skicenter.es", al check de abajo).
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) && !e.name.endsWith(".test.ts") && !e.name.endsWith(".test.tsx"))
    .map(e => join(dir, e.name));
}

describe("Segolife — sin branding/contenido heredado de Náyade en páginas públicas", () => {
  const files = [...SEGOLIFE_DIRS.flatMap(listSourceFiles), ...SEGOLIFE_SINGLE_FILES];

  it("hay al menos las páginas públicas esperadas (el test no está vacío por un cambio de estructura de carpetas)", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files)("%s no contiene ninguna cadena prohibida de Náyade (fuera de comentarios)", (file) => {
    const source = stripComments(readFileSync(file, "utf8"));
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(source, `${file} contiene un patrón prohibido: ${pattern}`).not.toMatch(pattern);
    }
  });
});

describe("Admin — sin logo/nombre/saludo por defecto de Náyade (aunque el archivo comparta secciones legacy con nombre de módulo legítimo)", () => {
  it.each(NAYADE_ONLY_FILES)("%s no contiene la cadena 'Náyade' (fuera de comentarios)", (file) => {
    const source = stripComments(readFileSync(file, "utf8"));
    expect(source, `${file} todavía contiene "Náyade"`).not.toMatch(/n[áa]yade/i);
  });
});

describe("Segolife — locales (en/es) sin contenido heredado de Náyade", () => {
  const localeFiles = [
    join(__dirname, "..", "locales", "en", "segolife.json"),
    join(__dirname, "..", "locales", "es", "segolife.json"),
  ];

  it.each(localeFiles)("%s no contiene ninguna cadena prohibida de Náyade", (file) => {
    const source = readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(source, `${file} contiene un patrón prohibido: ${pattern}`).not.toMatch(pattern);
    }
  });
});

describe("Segolife — metadata global (index.html, manifest) sin branding heredado de Náyade", () => {
  const metadataFiles = [
    join(__dirname, "..", "..", "index.html"),
    join(__dirname, "..", "..", "public", "manifest.webmanifest"),
  ];

  it.each(metadataFiles)("%s no contiene ninguna cadena prohibida de Náyade", (file) => {
    const source = readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(source, `${file} contiene un patrón prohibido: ${pattern}`).not.toMatch(pattern);
    }
  });

  it("index.html no referencia el ID de GA4 de Náyade (G-8E7HXCGN3P) de forma hardcodeada", () => {
    const source = readFileSync(join(__dirname, "..", "..", "index.html"), "utf8");
    expect(source).not.toMatch(/G-8E7HXCGN3P/);
  });

  it("manifest.webmanifest tiene name/short_name SEGOLIFE y start_url neutro (no fuerza /ie)", () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "manifest.webmanifest"), "utf8"));
    expect(manifest.name).toMatch(/segolife/i);
    expect(manifest.short_name).toMatch(/segolife/i);
    expect(manifest.start_url).toBe("/");
  });
});
