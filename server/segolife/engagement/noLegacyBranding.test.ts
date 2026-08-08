/**
 * noLegacyBranding.test.ts — spec Fase 7: ningún módulo del Engagement Core
 * (servidor, routers, UI de estudiante/admin, locales) puede mostrar
 * marca/contenido heredado de Náyade/Skicenter/RAPALINAHOTELES. Extiende
 * (sin tocar) client/src/test/noLegacyBranding.test.ts — Fase 6 — que ya
 * cubre client/src/pages/segolife/* (incluye Notifications.tsx y
 * NotificationPreferences.tsx, viven en esa misma carpeta) y
 * client/src/locales/{en,es}/segolife.json. Este test cubre lo que ese NO
 * cubre: server/segolife/engagement/**, los 2 routers nuevos, y
 * client/src/pages/admin/engagement + client/src/components/admin/engagement
 * (fuera del alcance de "páginas públicas" de aquel test).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "..", "..");

const FORBIDDEN_PATTERNS = [
  /n[áa]yade/i,
  /\bhotel\b/i,
  /\bspa\b/i,
  /experiencias?\s+acu[áa]ticas?/i,
  /RAPALINAHOTELES/i,
  /reserva\s+de\s+hotel/i,
  /skicenter/i,
];

// emailProvider.ts CONTIENE deliberadamente esas cadenas en un array de
// datos, no en un comentario — es el propio guard (FORBIDDEN_SENDER_SUBSTRINGS)
// que las detecta y bloquea en runtime, igual que deepLinkPolicy.test.ts
// referencia una URL de Náyade para probar que se rechaza. Excluirlo aquí no
// es una excepción a la regla, es la regla misma.
function isExcluded(fileName: string): boolean {
  return fileName === "emailProvider.ts";
}

/**
 * Quita comentarios de bloque y de línea antes de comprobar patrones
 * prohibidos. Casi todo este módulo documenta EXPLÍCITAMENTE, en
 * comentarios, qué NO hay que hacer y por qué (p.ej. "nunca reutilizar
 * emailTemplates.ts heredado de Náyade") — eso es disciplina arquitectónica
 * deseable, no una fuga de marca, y no debe hacer fallar este test. Lo que
 * de verdad importa es que ninguna marca ajena aparezca en código real o en
 * texto que pueda llegar a un usuario (strings, JSX, templates).
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function listSourceFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...listSourceFilesRecursive(full)); continue; }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    if (isExcluded(entry.name)) continue;
    out.push(full);
  }
  return out;
}

const ENGAGEMENT_DIRS = [
  join(ROOT, "server", "segolife", "engagement"),
  join(ROOT, "client", "src", "pages", "admin", "engagement"),
  join(ROOT, "client", "src", "components", "admin", "engagement"),
];

const ENGAGEMENT_SINGLE_FILES = [
  join(ROOT, "server", "routers", "engagement.ts"),
  join(ROOT, "server", "routers", "studentNotifications.ts"),
];

describe("Engagement Core — sin branding/contenido heredado en servidor y admin", () => {
  const files = [...ENGAGEMENT_DIRS.flatMap(listSourceFilesRecursive), ...ENGAGEMENT_SINGLE_FILES];

  it("hay al menos los módulos esperados (el test no está vacío por un cambio de estructura)", () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it.each(files)("%s no contiene ninguna cadena prohibida heredada (fuera de comentarios)", (file) => {
    const source = stripComments(readFileSync(file, "utf8"));
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(source, `${file} contiene un patrón prohibido fuera de un comentario: ${pattern}`).not.toMatch(pattern);
    }
  });
});

describe("Engagement Core — locales EN/ES sin contenido heredado (bloque 'notifications')", () => {
  const localeFiles = [
    join(ROOT, "client", "src", "locales", "en", "segolife.json"),
    join(ROOT, "client", "src", "locales", "es", "segolife.json"),
  ];

  it.each(localeFiles)("%s — bloque notifications sin cadena prohibida", (file) => {
    const json = JSON.parse(readFileSync(file, "utf8"));
    expect(json.notifications, `${file} no tiene bloque "notifications"`).toBeTruthy();
    const serialized = JSON.stringify(json.notifications);
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(serialized, `${file}#notifications contiene un patrón prohibido: ${pattern}`).not.toMatch(pattern);
    }
  });
});
