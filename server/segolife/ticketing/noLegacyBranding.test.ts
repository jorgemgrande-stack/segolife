/**
 * noLegacyBranding.test.ts — spec Fase 8: ningún módulo de Native
 * Ticketing/Check-in/Commerce-POS puede mostrar marca/contenido heredado
 * de Náyade/Skicenter/RAPALINAHOTELES. Mismo criterio y mecanismo que
 * server/segolife/engagement/noLegacyBranding.test.ts (Fase 7) — strip de
 * comentarios antes de comprobar, porque la disciplina arquitectónica de
 * "auditado: NO se reutiliza X heredado" se documenta en comentarios por
 * todo este módulo (ver drizzle/schema.ts, cabecera del bloque Fase 5/8).
 *
 * client/src/pages/segolife/{TicketCheckout,MyTickets,TicketDetail}.tsx y
 * client/src/pages/staff/{StaffEventScan,StaffPos}.tsx YA quedan cubiertos
 * por client/src/test/noLegacyBranding.test.ts (Fase 6) — viven en las
 * mismas carpetas que ya escanea. Este test cubre lo que aquel NO cubre:
 * los módulos de servidor nuevos y las páginas de ADMIN (fuera del alcance
 * "páginas públicas" de aquel test).
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

function stripComments(source: string): string {
  // PRE-16.16B: negative lookbehind — no trata el "//" de una URL como
  // inicio de comentario (antes ocultaba literales de dominio prohibidos).
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
}

function listSourceFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...listSourceFilesRecursive(full)); continue; }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

const TICKETING_DIRS = [
  join(ROOT, "server", "segolife", "ticketing"),
  join(ROOT, "server", "segolife", "commerce"),
];

const TICKETING_SINGLE_FILES = [
  join(ROOT, "server", "routers", "ticketPurchase.ts"),
  join(ROOT, "server", "routers", "staffCheckin.ts"),
  join(ROOT, "server", "routers", "eventTicketing.ts"),
  join(ROOT, "server", "routers", "commerce.ts"),
  join(ROOT, "server", "routers", "integrations.ts"),
  join(ROOT, "client", "src", "pages", "admin", "events", "EventTicketingTab.tsx"),
  join(ROOT, "client", "src", "pages", "admin", "venues", "VenueCommerceTab.tsx"),
];

describe("Native Ticketing/Commerce — sin branding/contenido heredado", () => {
  const files = [...TICKETING_DIRS.flatMap(listSourceFilesRecursive), ...TICKETING_SINGLE_FILES];

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

describe("Native Ticketing — locales EN/ES sin contenido heredado (bloques 'ticketing'/'eventScan'/'pos')", () => {
  const localeFiles = [
    join(ROOT, "client", "src", "locales", "en", "segolife.json"),
    join(ROOT, "client", "src", "locales", "es", "segolife.json"),
  ];

  it.each(localeFiles)("%s — bloques de Fase 8 sin cadena prohibida", (file) => {
    const json = JSON.parse(readFileSync(file, "utf8"));
    for (const block of ["ticketing", "eventScan", "pos"]) {
      expect(json[block], `${file} no tiene bloque "${block}"`).toBeTruthy();
      const serialized = JSON.stringify(json[block]);
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(serialized, `${file}#${block} contiene un patrón prohibido: ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
