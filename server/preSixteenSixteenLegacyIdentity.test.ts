/**
 * preSixteenSixteenLegacyIdentity.test.ts — PRE-16.16 (§12/§47). Regresión
 * para los 5 archivos corregidos en esta fase que aún podían mostrar
 * "Náyade Experiences"/"skicenter.es" en una acción real (invitación a
 * empleado/gestoría, dossier fiscal, aviso de vencimiento, plantillas PDF).
 * Mismo patrón que server/segolife/engagement/noLegacyBranding.test.ts:
 * escanea el CÓDIGO FUENTE fuera de comentarios — los propios comentarios de
 * este cambio documentan a propósito qué se corrigió y por qué, eso no debe
 * hacer fallar el test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

const FORBIDDEN_PATTERNS = [/n[áa]yade/i, /skicenter/i];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const FILES = [
  join(ROOT, "server", "routers", "hr.ts"),
  join(ROOT, "server", "routers", "gestoria.ts"),
  join(ROOT, "server", "gestoriaDossier.ts"),
  join(ROOT, "server", "taxReminderJob.ts"),
  join(ROOT, "server", "routers", "pdfTemplatesRouter.ts"),
];

describe("PRE-16.16 — acciones reales de RRHH/Gestoría/PDF sin identidad heredada", () => {
  it.each(FILES)("%s no contiene Náyade/Skicenter fuera de comentarios", (file) => {
    const source = stripComments(readFileSync(file, "utf8"));
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(source, `${file} contiene un patrón prohibido fuera de comentario: ${pattern}`).not.toMatch(pattern);
    }
  });
});
