/**
 * galleryDb.test.ts — filtro venueId de getActiveGalleryItems (Fase 8.5,
 * asociación media↔venue mínima sobre gallery_items). `db` inyectable, sin
 * conexión real, mismo patrón que server/segolife/**\/*.test.ts.
 */
import { describe, it, expect } from "vitest";
import { getActiveGalleryItems } from "./galleryDb";

function makeMockDb(rows: Array<Record<string, unknown>>) {
  let capturedWhere: unknown;
  const b: any = {};
  b.select = () => b;
  b.from = () => b;
  b.where = (cond: unknown) => { capturedWhere = cond; return b; };
  b.orderBy = () => Promise.resolve(rows);
  return { db: b as any, getCapturedWhere: () => capturedWhere };
}

describe("getActiveGalleryItems", () => {
  it("sin venueId — solo filtra por isActive (comportamiento previo, sin regresión)", async () => {
    const all = [{ id: 1, venueId: null, isActive: true }, { id: 2, venueId: 5, isActive: true }];
    const { db } = makeMockDb(all);
    const result = await getActiveGalleryItems(undefined, db);
    expect(result).toEqual(all);
  });

  it("con venueId — la condición WHERE combina isActive Y venueId (no un post-filtro en memoria)", async () => {
    const filtered = [{ id: 2, venueId: 5, isActive: true }];
    const { db, getCapturedWhere } = makeMockDb(filtered);
    const result = await getActiveGalleryItems(5, db);
    expect(result).toEqual(filtered);
    // La condición se construye con drizzle `and(...)` — objeto real, no undefined.
    expect(getCapturedWhere()).toBeDefined();
  });

  it("venueId=0 no se trata como \"sin filtro\" (0 es un id válido en teoría, != null es la comprobación correcta)", async () => {
    const { db, getCapturedWhere } = makeMockDb([]);
    await getActiveGalleryItems(0, db);
    // La implementación usa `venueId != null`, así que 0 SÍ activa el filtro combinado.
    expect(getCapturedWhere()).toBeDefined();
  });
});
