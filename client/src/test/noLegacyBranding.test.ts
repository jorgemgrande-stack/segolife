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

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) && !e.name.endsWith(".test.ts") && !e.name.endsWith(".test.tsx"))
    .map(e => join(dir, e.name));
}

describe("Segolife — sin branding/contenido heredado de Náyade en páginas públicas", () => {
  const files = SEGOLIFE_DIRS.flatMap(listSourceFiles);

  it("hay al menos las páginas públicas esperadas (el test no está vacío por un cambio de estructura de carpetas)", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files)("%s no contiene ninguna cadena prohibida de Náyade", (file) => {
    const source = readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(source, `${file} contiene un patrón prohibido: ${pattern}`).not.toMatch(pattern);
    }
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
