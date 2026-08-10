/**
 * venuesPublic.test.ts — Fase 8.6, punto 91. Cubre los procedures `public*`
 * de venuesRouter que server/routers/venues.test.ts deja explícitamente
 * fuera de alcance (ese archivo solo prueba el rechazo RBAC de los
 * procedures admin). Aquí se prueba lo contrario: que publicGetBySlug
 * funciona SIN sesión, respeta visibilidad activo/inactivo, y que el DTO
 * público nunca depende de si el venue se llama "Tanker Events" o
 * "Selfish Poke" — mismo shape para cualquier venue (regla fundamental de
 * la fase: Tanker es un venue estándar, Selfish Poke prueba que el dominio
 * Venue no es "discoteca").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetVenueBySlug } = vi.hoisted(() => ({
  mockGetVenueBySlug: vi.fn(),
}));

vi.mock("../db/venuesDb", () => ({
  listVenues: vi.fn(),
  getVenueById: vi.fn(),
  getVenueBySlug: mockGetVenueBySlug,
  createVenue: vi.fn(),
  updateVenue: vi.fn(),
  setVenueActive: vi.fn(),
  setVenueFeatured: vi.fn(),
  setVenueCommunities: vi.fn(),
  listVenueCategories: vi.fn(),
  createVenueCategory: vi.fn(),
  listActiveVenues: vi.fn(),
  listFeaturedVenues: vi.fn(),
}));

import { venuesRouter } from "./venues";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function publicCaller() {
  return venuesRouter.createCaller({ user: null } as any);
}

function baseVenue(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    name: "Casanova",
    slug: "casanova",
    tagline: "Discoteca · Segovia centro",
    description: "La discoteca de referencia en Segovia.",
    categoryId: null,
    address: null,
    city: "Segovia",
    phone: null,
    email: null,
    website: null,
    instagramUrl: null,
    imageUrl: "https://segolife-production.up.railway.app/local-storage/nayade/uploads/logo.png",
    coverImageUrl: "https://segolife-production.up.railway.app/local-storage/nayade/uploads/cover.jpg",
    status: "active" as const,
    isFeatured: true,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("venues router — publicGetBySlug (sin sesión, punto 91: 'venue public detail')", () => {
  it("un venue activo se devuelve completo (venue/categoría/comunidades) sin necesitar sesión", async () => {
    mockGetVenueBySlug.mockResolvedValue({
      venue: baseVenue(),
      category: { id: 2, name: "Nightlife", slug: "nightlife", createdAt: new Date() },
      communities: [{ id: 1, name: "Segolife IE", slug: "ie" }],
    });
    const result = await publicCaller().publicGetBySlug({ slug: "casanova" });
    expect(result?.venue.name).toBe("Casanova");
    expect(result?.category?.slug).toBe("nightlife");
    expect(result?.communities).toEqual([{ id: 1, name: "Segolife IE", slug: "ie" }]);
  });

  it("un venue con status='inactive' nunca se expone públicamente aunque el slug exista (punto 91: 'active/inactive visibility')", async () => {
    mockGetVenueBySlug.mockResolvedValue({ venue: baseVenue({ status: "inactive" }), category: null, communities: [] });
    const result = await publicCaller().publicGetBySlug({ slug: "casanova" });
    expect(result).toBeNull();
  });

  it("un slug inexistente devuelve null sin lanzar (punto 91: 'slug')", async () => {
    mockGetVenueBySlug.mockResolvedValue(null);
    const result = await publicCaller().publicGetBySlug({ slug: "no-existe-este-venue" });
    expect(result).toBeNull();
  });

  it("Tanker Events se sirve con el MISMO shape que cualquier otro venue — sin organizerId ni campo especial (regla definitiva de la fase)", async () => {
    mockGetVenueBySlug.mockResolvedValue({
      venue: baseVenue({ id: 6, name: "Tanker Events", slug: "tanker-events", tagline: "Espacio de eventos" }),
      category: { id: 3, name: "Event Venue", slug: "event-venue", createdAt: new Date() },
      communities: [{ id: 1, name: "Segolife IE", slug: "ie" }, { id: 2, name: "Segolife UVA", slug: "uva" }],
    });
    const result = await publicCaller().publicGetBySlug({ slug: "tanker-events" });
    expect(result?.venue.name).toBe("Tanker Events");
    expect(result?.venue).not.toHaveProperty("organizerId");
    expect(Object.keys(result!.venue)).toEqual(Object.keys(baseVenue()));
  });

  it("Selfish Poke (categoría restaurante, no discoteca) se sirve con el mismo shape genérico de venue", async () => {
    mockGetVenueBySlug.mockResolvedValue({
      venue: baseVenue({ id: 5, name: "Selfish Poke", slug: "selfish-poke", tagline: "Poke bar" }),
      category: { id: 4, name: "Restaurant", slug: "restaurant", createdAt: new Date() },
      communities: [],
    });
    const result = await publicCaller().publicGetBySlug({ slug: "selfish-poke" });
    expect(result?.category?.slug).toBe("restaurant");
    expect(Object.keys(result!.venue)).toEqual(Object.keys(baseVenue()));
  });

  it("el DTO público de venue nunca incluye credenciales/tokens de integración (punto 91: 'no-credentials-in-public-DTO')", async () => {
    mockGetVenueBySlug.mockResolvedValue({ venue: baseVenue(), category: null, communities: [] });
    const result = await publicCaller().publicGetBySlug({ slug: "casanova" });
    const keys = Object.keys(result!.venue);
    expect(keys.some(k => /secret|token|apikey|api_key|credential|password/i.test(k))).toBe(false);
  });
});

describe("venues router — publicActive/publicFeatured (sin sesión)", () => {
  it("publicActive delega en listActiveVenues sin exigir sesión", async () => {
    const { listActiveVenues } = await import("../db/venuesDb");
    (listActiveVenues as ReturnType<typeof vi.fn>).mockResolvedValue([baseVenue()]);
    const result = await publicCaller().publicActive({});
    expect(result).toHaveLength(1);
  });
});
