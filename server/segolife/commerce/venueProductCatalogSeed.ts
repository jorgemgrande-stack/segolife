/**
 * venueProductCatalogSeed.ts — SEGOLIFE PRODUCTION MASTER DATA, VENUE POS
 * CATALOG & DEMO-READY CONFIGURATION (Fase 12.5). Catálogo BASE de barra
 * (seed/starting prices, spec §6) + planificador PURO (sin I/O) que decide
 * qué filas de `venue_products` faltan, dado el estado real ya leído de
 * producción. Nunca decide por sí mismo qué venues existen ni qué productos
 * ya hay — eso lo resuelve el script que lo invoca (scripts/seed-venue-pos-
 * catalog.ts) contra la base de datos real.
 *
 * Categorías (spec §5): texto libre reutilizando la columna
 * `venue_products.category` ya existente (varchar(64), sin tabla ni enum
 * nuevos — auditoría de esta fase confirmó que no existe ningún subsistema
 * de categorías de producto, y el spec pide explícitamente NO construir uno
 * solo para esta fase). "SIN ALCOHOL" y "OTROS" quedan como categorías
 * disponibles para el cliente pero SIN productos sembrados aquí — el spec no
 * da una lista explícita de productos para ellas y duplicar ahí bebidas que
 * ya viven en REFRESCOS/AGUA/CERVEZAS/CHUPITOS (que ya son sin alcohol en su
 * mayoría) crearía duplicados ambiguos, justo lo que el spec §20 prohíbe.
 *
 * "Sprite / 7UP" del spec se resuelve como UN único producto ("Sprite") —
 * spec §6.1 explícito: "Avoid creating both... Choose one generic/base
 * option". "Red Bull / Bebida energética" igual, un único producto
 * ("Red Bull") — es como el propio spec lo escribe como una sola línea.
 */

export interface CatalogProductSpec {
  name: string;
  category: string;
  priceEuros: number;
}

// Orden de categorías pensado para velocidad de barra (spec §17) — el motivo
// de por qué NO se aplica todavía a la query real del POS (que ordena por
// nombre) está documentado en el informe final de esta fase, no aquí: no se
// tocó `listPosProducts` para mantener el perímetro de esta fase en datos,
// no en comportamiento de query.
export const CATALOG_CATEGORY_ORDER = [
  "COPAS", "CERVEZAS", "CHUPITOS", "REFRESCOS", "ENERGÉTICAS", "AGUA", "BOTELLAS", "SIN ALCOHOL", "OTROS",
] as const;

export const CATALOG_PRODUCTS: CatalogProductSpec[] = [
  // REFRESCOS
  { name: "Coca-Cola", category: "REFRESCOS", priceEuros: 3.50 },
  { name: "Coca-Cola Zero", category: "REFRESCOS", priceEuros: 3.50 },
  { name: "Fanta Naranja", category: "REFRESCOS", priceEuros: 3.50 },
  { name: "Fanta Limón", category: "REFRESCOS", priceEuros: 3.50 },
  { name: "Sprite", category: "REFRESCOS", priceEuros: 3.50 },
  { name: "Tónica", category: "REFRESCOS", priceEuros: 3.50 },
  // AGUA
  { name: "Agua mineral", category: "AGUA", priceEuros: 3.00 },
  // ENERGÉTICAS
  { name: "Red Bull", category: "ENERGÉTICAS", priceEuros: 4.50 },
  // CERVEZAS
  { name: "Cerveza", category: "CERVEZAS", priceEuros: 4.00 },
  { name: "Cerveza premium", category: "CERVEZAS", priceEuros: 5.00 },
  { name: "Cerveza 0,0", category: "CERVEZAS", priceEuros: 4.00 },
  // CHUPITOS
  { name: "Chupito estándar", category: "CHUPITOS", priceEuros: 3.00 },
  { name: "Chupito premium", category: "CHUPITOS", priceEuros: 4.00 },
  { name: "Chupito sin alcohol", category: "CHUPITOS", priceEuros: 2.50 },
  // COPAS — GIN
  { name: "Beefeater", category: "COPAS", priceEuros: 8.00 },
  { name: "Tanqueray", category: "COPAS", priceEuros: 9.00 },
  { name: "Bombay Sapphire", category: "COPAS", priceEuros: 9.00 },
  { name: "Hendrick's", category: "COPAS", priceEuros: 11.00 },
  // COPAS — RUM
  { name: "Bacardí", category: "COPAS", priceEuros: 8.00 },
  { name: "Brugal", category: "COPAS", priceEuros: 9.00 },
  { name: "Barceló", category: "COPAS", priceEuros: 9.00 },
  { name: "Santa Teresa", category: "COPAS", priceEuros: 10.00 },
  // COPAS — WHISKY
  { name: "J&B", category: "COPAS", priceEuros: 8.00 },
  { name: "Ballantine's", category: "COPAS", priceEuros: 8.00 },
  { name: "Johnnie Walker Red", category: "COPAS", priceEuros: 9.00 },
  { name: "Jack Daniel's", category: "COPAS", priceEuros: 10.00 },
  // COPAS — VODKA
  { name: "Smirnoff", category: "COPAS", priceEuros: 8.00 },
  { name: "Absolut", category: "COPAS", priceEuros: 9.00 },
  // COPAS — TEQUILA
  { name: "Tequila estándar", category: "COPAS", priceEuros: 8.00 },
  { name: "Tequila premium", category: "COPAS", priceEuros: 10.00 },
  // BOTELLAS
  { name: "Botella estándar + refrescos", category: "BOTELLAS", priceEuros: 90.00 },
  { name: "Botella premium + refrescos", category: "BOTELLAS", priceEuros: 120.00 },
  { name: "Botella super premium + refrescos", category: "BOTELLAS", priceEuros: 150.00 },
];

export function slugifyProductName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Normaliza un nombre para detección de alias obvios (spec §20) — nunca para fusionar/borrar, solo para reportar. */
export function normalizeForAliasDetection(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’\-]/g, "")
    .replace(/\s+/g, "");
}

export interface PlannedInsert {
  venueId: number;
  name: string;
  slug: string;
  category: string;
  price: string;
}

export interface AmbiguousMatch {
  venueId: number;
  candidateName: string;
  existingName: string;
}

export interface CatalogSeedPlan {
  toInsert: PlannedInsert[];
  alreadyExists: Array<{ venueId: number; name: string; slug: string }>;
  ambiguous: AmbiguousMatch[];
}

/**
 * Planificador puro (spec §19 idempotente, §20 detección de alias). Nunca
 * escribe nada — solo decide, dado lo que YA existe por venue (slug real y
 * nombres reales, ya leídos de producción), qué haría falta insertar.
 * Idempotencia por (venueId, slug) — el único unique constraint real
 * (`venue_products_venue_slug_unique`, spec §19), nunca por nombre exacto.
 */
export function planCatalogSeed(
  venueIds: number[],
  existingByVenue: Map<number, Array<{ name: string; slug: string }>>,
  catalog: CatalogProductSpec[] = CATALOG_PRODUCTS
): CatalogSeedPlan {
  const toInsert: PlannedInsert[] = [];
  const alreadyExists: CatalogSeedPlan["alreadyExists"] = [];
  const ambiguous: AmbiguousMatch[] = [];

  for (const venueId of venueIds) {
    const existing = existingByVenue.get(venueId) ?? [];
    const existingSlugs = new Set(existing.map(p => p.slug));
    const existingNormalized = new Map(existing.map(p => [normalizeForAliasDetection(p.name), p.name]));

    for (const product of catalog) {
      const slug = slugifyProductName(product.name);
      if (existingSlugs.has(slug)) {
        alreadyExists.push({ venueId, name: product.name, slug });
        continue;
      }
      const normalized = normalizeForAliasDetection(product.name);
      const aliasMatch = existingNormalized.get(normalized);
      if (aliasMatch) {
        ambiguous.push({ venueId, candidateName: product.name, existingName: aliasMatch });
        continue;
      }
      toInsert.push({
        venueId,
        name: product.name,
        slug,
        category: product.category,
        price: product.priceEuros.toFixed(2),
      });
    }
  }

  return { toInsert, alreadyExists, ambiguous };
}
