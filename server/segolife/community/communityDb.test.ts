import { describe, it, expect } from "vitest";
import { isProposalOpenForResponses, getVenueName } from "./communityDb";
import type { CommunityProposal } from "../../../drizzle/schema";

const NOW = new Date("2026-08-12T12:00:00.000Z");

function proposal(overrides: Partial<CommunityProposal> = {}): CommunityProposal {
  return {
    id: 1, title: "t", description: null, questionType: "yes_no", status: "active",
    urgencyType: "scheduled", startsAt: null, endsAt: null, resultsVisibility: "after_vote",
    allowChangeResponse: true, tokenReward: null, coverImageUrl: null, venueId: null,
    relatedEventId: null, convertedEventId: null, sourceStudentProposalId: null,
    audienceDefinition: null, audienceSnapshotAt: null, minSampleSize: 5,
    createdByUserId: 1, publishedAt: null, closedAt: null, cancelledAt: null,
    createdAt: NOW, updatedAt: NOW,
    ...overrides,
  } as CommunityProposal;
}

// Spec punto 70: "aunque el scheduler esté OFF, las queries públicas SIEMPRE
// consideran starts_at/ends_at — nunca aceptar respuesta fuera de ventana
// por confiar solo en la UI".
describe("isProposalOpenForResponses — nunca confía solo en el status, siempre revalida la ventana", () => {
  it("status distinto de 'active' siempre está cerrado, aunque la ventana sea válida", () => {
    expect(isProposalOpenForResponses(proposal({ status: "draft" }), NOW)).toBe(false);
    expect(isProposalOpenForResponses(proposal({ status: "scheduled" }), NOW)).toBe(false);
    expect(isProposalOpenForResponses(proposal({ status: "closed" }), NOW)).toBe(false);
    expect(isProposalOpenForResponses(proposal({ status: "cancelled" }), NOW)).toBe(false);
    expect(isProposalOpenForResponses(proposal({ status: "converted" }), NOW)).toBe(false);
  });

  it("active sin startsAt/endsAt: abierta (ventana no acotada)", () => {
    expect(isProposalOpenForResponses(proposal({ status: "active" }), NOW)).toBe(true);
  });

  it("active pero startsAt en el futuro: cerrada aunque el status ya diga 'active' (caso scheduler retrasado)", () => {
    const future = new Date(NOW.getTime() + 60 * 60 * 1000);
    expect(isProposalOpenForResponses(proposal({ status: "active", startsAt: future }), NOW)).toBe(false);
  });

  it("active pero endsAt ya pasado: cerrada aunque el status siga 'active' en BD (caso scheduler OFF)", () => {
    const past = new Date(NOW.getTime() - 60 * 60 * 1000);
    expect(isProposalOpenForResponses(proposal({ status: "active", endsAt: past }), NOW)).toBe(false);
  });

  it("active dentro de la ventana startsAt..endsAt: abierta", () => {
    const past = new Date(NOW.getTime() - 60 * 60 * 1000);
    const future = new Date(NOW.getTime() + 60 * 60 * 1000);
    expect(isProposalOpenForResponses(proposal({ status: "active", startsAt: past, endsAt: future }), NOW)).toBe(true);
  });
});

// Hallazgo real (2026-08-22, captura del cliente): la ubicación de una
// propuesta nunca se resolvía/mostraba al Student — getVenueName() es el
// mismo join que ya usaba listProposals() (ProposalListItem.venueName),
// ahora también expuesto a getPublicById/myActive en community.ts.
describe("getVenueName — resolución de ubicación (spec: exponer al Student, no solo al admin)", () => {
  function fakeDb(venueRows: Array<{ name: string }>) {
    let queried = false;
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => { queried = true; return venueRows; },
          }),
        }),
      }),
      __wasQueried: () => queried,
    } as never;
  }

  it("venueId null: devuelve null sin consultar la BD", async () => {
    const db = fakeDb([{ name: "Casanova" }]);
    const result = await getVenueName(null, db);
    expect(result).toBeNull();
    expect((db as unknown as { __wasQueried: () => boolean }).__wasQueried()).toBe(false);
  });

  it("venueId real con venue existente: devuelve su nombre", async () => {
    const db = fakeDb([{ name: "Casanova" }]);
    const result = await getVenueName(7, db);
    expect(result).toBe("Casanova");
  });

  it("venueId que no corresponde a ningún venue (borrado/corrupto): devuelve null, nunca lanza", async () => {
    const db = fakeDb([]);
    const result = await getVenueName(999, db);
    expect(result).toBeNull();
  });
});
