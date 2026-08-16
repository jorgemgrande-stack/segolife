/**
 * venueProductCatalogSeed.test.ts — SEGOLIFE PRODUCTION MASTER DATA, VENUE
 * POS CATALOG (Fase 12.5, spec §36 items 1-3, 13, 15, 19, 20). Cubre el
 * planificador puro sin tocar base de datos alguna.
 */
import { describe, it, expect } from "vitest";
import {
  planCatalogSeed, slugifyProductName, normalizeForAliasDetection, CATALOG_PRODUCTS,
  type CatalogProductSpec,
} from "./venueProductCatalogSeed";

describe("slugifyProductName", () => {
  it("normaliza acentos, apóstrofes y espacios a un slug ascii con guiones", () => {
    expect(slugifyProductName("Jack Daniel's")).toBe("jack-daniel-s");
    expect(slugifyProductName("Chupito estándar")).toBe("chupito-estandar");
    expect(slugifyProductName("Botella estándar + refrescos")).toBe("botella-estandar-refrescos");
  });
});

describe("normalizeForAliasDetection", () => {
  it("colapsa variantes de escritura del mismo producto al mismo valor", () => {
    expect(normalizeForAliasDetection("Coca-Cola")).toBe(normalizeForAliasDetection("Coca Cola"));
    expect(normalizeForAliasDetection("Jack Daniel's")).toBe(normalizeForAliasDetection("Jack Daniels"));
  });
});

describe("planCatalogSeed — idempotencia (spec §19)", () => {
  it("con un venue sin ningún producto existente, planifica insertar el catálogo completo", () => {
    const plan = planCatalogSeed([1], new Map());
    expect(plan.toInsert).toHaveLength(CATALOG_PRODUCTS.length);
    expect(plan.alreadyExists).toHaveLength(0);
    expect(plan.ambiguous).toHaveLength(0);
    expect(plan.toInsert.every(p => p.venueId === 1)).toBe(true);
  });

  it("ejecutar el plan dos veces (simulado) nunca duplica: si el slug ya existe, se omite, no se reinserta", () => {
    const firstRun = planCatalogSeed([1], new Map());
    const existingAfterFirstRun = new Map([[1, firstRun.toInsert.map(p => ({ name: p.name, slug: p.slug }))]]);
    const secondRun = planCatalogSeed([1], existingAfterFirstRun);
    expect(secondRun.toInsert).toHaveLength(0);
    expect(secondRun.alreadyExists).toHaveLength(CATALOG_PRODUCTS.length);
  });

  it("un producto ya existente en un venue no se toca (no aparece en toInsert) — spec §2 'DO NOT overwrite'", () => {
    const existing = new Map([[1, [{ name: "Coca-Cola", slug: "coca-cola" }]]]);
    const plan = planCatalogSeed([1], existing);
    expect(plan.toInsert.some(p => p.slug === "coca-cola")).toBe(false);
    expect(plan.alreadyExists).toContainEqual({ venueId: 1, name: "Coca-Cola", slug: "coca-cola" });
  });
});

describe("planCatalogSeed — independencia por venue (spec §4/§18)", () => {
  it("un producto existente en el venue A no afecta el plan del venue B", () => {
    const existing = new Map([[1, [{ name: "Coca-Cola", slug: "coca-cola" }]]]);
    const plan = planCatalogSeed([1, 2], existing);
    const venue1Insert = plan.toInsert.filter(p => p.venueId === 1);
    const venue2Insert = plan.toInsert.filter(p => p.venueId === 2);
    expect(venue1Insert.some(p => p.slug === "coca-cola")).toBe(false);
    expect(venue2Insert.some(p => p.slug === "coca-cola")).toBe(true);
    expect(venue2Insert).toHaveLength(CATALOG_PRODUCTS.length);
  });
});

describe("planCatalogSeed — detección de alias ambiguos (spec §20)", () => {
  it("una variante de escritura ya existente se reporta como ambigua, nunca se inserta ni se fusiona", () => {
    const existing = new Map([[1, [{ name: "Coca Cola", slug: "coca-cola-original" }]]]);
    const plan = planCatalogSeed([1], existing);
    expect(plan.toInsert.some(p => p.name === "Coca-Cola")).toBe(false);
    expect(plan.ambiguous).toContainEqual({ venueId: 1, candidateName: "Coca-Cola", existingName: "Coca Cola" });
  });

  it("nunca borra ni modifica el registro existente — el plan no expone ninguna operación de escritura sobre él", () => {
    const existing = new Map([[1, [{ name: "Jack Daniels", slug: "jack-daniels-legacy" }]]]);
    const plan = planCatalogSeed([1], existing);
    expect(plan.ambiguous).toHaveLength(1);
    expect(plan.toInsert.some(p => p.name.includes("Jack"))).toBe(false);
  });
});

describe("planCatalogSeed — precios (spec §8, seed únicamente)", () => {
  it("los precios planificados coinciden exactamente con el catálogo base declarado, en formato decimal string", () => {
    const plan = planCatalogSeed([1], new Map());
    const cocaCola = plan.toInsert.find(p => p.name === "Coca-Cola");
    expect(cocaCola?.price).toBe("3.50");
    const botellaPremium = plan.toInsert.find(p => p.name === "Botella premium + refrescos");
    expect(botellaPremium?.price).toBe("120.00");
  });
});

describe("planCatalogSeed — catálogo personalizado", () => {
  it("acepta un catálogo distinto al por defecto (para tests dirigidos)", () => {
    const customCatalog: CatalogProductSpec[] = [{ name: "Test Product", category: "OTROS", priceEuros: 1 }];
    const plan = planCatalogSeed([1], new Map(), customCatalog);
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.toInsert[0].category).toBe("OTROS");
  });
});
