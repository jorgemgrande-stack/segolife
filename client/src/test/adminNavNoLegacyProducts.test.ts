/**
 * adminNavNoLegacyProducts.test.ts — Fase 8.6, punto 91: "no-legacy-
 * Products-navigation-active" y punto 65 del propio spec (catálogo legacy
 * de Náyade — Experiencias/Categorías/Ubicaciones/Variantes/Lego Packs —
 * no puede seguir dominando la navegación admin de SEGOLIFE mientras sus
 * feature flags están apagados). No se borra código/rutas/tablas — ver
 * client/src/App.tsx, donde /admin/productos* sigue montado a propósito —
 * solo se comprueba que NINGÚN item del array `navItems` de AdminLayout
 * enlaza a esa sección. Test estático, mismo criterio de coste/determinismo
 * que noLegacyBranding.test.ts (leer código fuente en vez de renderizar).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("AdminLayout — sin entrada de navegación activa al catálogo legacy 'Productos'", () => {
  const source = stripComments(readFileSync(join(__dirname, "..", "components", "AdminLayout.tsx"), "utf8"));

  it("no existe ningún href de navItems apuntando a /admin/productos (fuera de comentarios)", () => {
    expect(source).not.toMatch(/href:\s*["']\/admin\/productos/);
  });

  it("no existe ninguna label de navegación llamada 'Productos'", () => {
    expect(source).not.toMatch(/label:\s*["']Productos["']/);
  });

  it("las rutas reales del catálogo legacy siguen montadas en App.tsx (código/rutas intactos, solo se oculta del menú)", () => {
    const appSource = readFileSync(join(__dirname, "..", "App.tsx"), "utf8");
    expect(appSource).toMatch(/\/admin\/productos/);
  });
});
