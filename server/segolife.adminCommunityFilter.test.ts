/**
 * segolife.adminCommunityFilter.test.ts — lógica pura del selector global de
 * comunidad del admin (Todas/IE/UVA/...). Ver shared/segolife/adminCommunityFilter.ts.
 */
import { describe, it, expect } from "vitest";
import {
  ADMIN_COMMUNITY_FILTER_ALL,
  parseAdminCommunityFilter,
  serializeAdminCommunityFilter,
  communityFilterToQueryParam,
} from "../shared/segolife/adminCommunityFilter";

describe("selector admin — parseAdminCommunityFilter", () => {
  it("valor nulo o ausente → 'all'", () => {
    expect(parseAdminCommunityFilter(null)).toBe(ADMIN_COMMUNITY_FILTER_ALL);
    expect(parseAdminCommunityFilter(undefined)).toBe(ADMIN_COMMUNITY_FILTER_ALL);
  });

  it("'all' persistido → 'all'", () => {
    expect(parseAdminCommunityFilter("all")).toBe(ADMIN_COMMUNITY_FILTER_ALL);
  });

  it("un id numérico persistido (ej. comunidad IE) se conserva", () => {
    expect(parseAdminCommunityFilter("1")).toBe(1);
  });

  it("un valor corrupto/no numérico cae a 'all' en vez de lanzar", () => {
    expect(parseAdminCommunityFilter("no-es-un-id")).toBe(ADMIN_COMMUNITY_FILTER_ALL);
    expect(parseAdminCommunityFilter("-5")).toBe(ADMIN_COMMUNITY_FILTER_ALL);
    expect(parseAdminCommunityFilter("0")).toBe(ADMIN_COMMUNITY_FILTER_ALL);
  });
});

describe("selector admin — serializeAdminCommunityFilter", () => {
  it("'all' se serializa como 'all'", () => {
    expect(serializeAdminCommunityFilter(ADMIN_COMMUNITY_FILTER_ALL)).toBe("all");
  });

  it("un id de comunidad se serializa como string", () => {
    expect(serializeAdminCommunityFilter(2)).toBe("2");
  });

  it("round-trip serialize → parse conserva el valor", () => {
    expect(parseAdminCommunityFilter(serializeAdminCommunityFilter(7))).toBe(7);
    expect(parseAdminCommunityFilter(serializeAdminCommunityFilter(ADMIN_COMMUNITY_FILTER_ALL))).toBe(
      ADMIN_COMMUNITY_FILTER_ALL
    );
  });
});

describe("selector admin — communityFilterToQueryParam", () => {
  it("'all' se traduce a undefined (sin filtro en la query)", () => {
    expect(communityFilterToQueryParam(ADMIN_COMMUNITY_FILTER_ALL)).toBeUndefined();
  });

  it("un id de comunidad se pasa tal cual como parámetro de filtro", () => {
    expect(communityFilterToQueryParam(3)).toBe(3);
  });
});
