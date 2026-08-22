import { describe, it, expect } from "vitest";
import { isProposalOpenForResponses, getVenueName, isInProposalAudience, computeResultsVisible, isProposalVisibleToUser, canAccessSocialLayer, sortActiveProposalsForFeed } from "./communityDb";
import { communityProposalCommunities, userCommunities } from "../../../drizzle/schema";
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

// Avatar-stack de respondientes (petición del cliente, 2026-08-22): la
// autorización real de "quién puede ver quién respondió" descansa en estas
// dos funciones puras — probadas aquí sin re-probar la delegación del router
// (eso ya lo cubre community.test.ts, describe "getPublicRespondents").
describe("isInProposalAudience — gate de autorización real del avatar-stack de respondientes", () => {
  function fakeDb(hasRow: boolean) {
    return {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => (hasRow ? [{ id: 1 }] : []) }) }) }),
    } as never;
  }

  it("true si existe una fila community_proposal_audiences para ese (proposalId, userId)", async () => {
    expect(await isInProposalAudience(10, 4, fakeDb(true))).toBe(true);
  });

  it("false si el userId no está en la audiencia snapshoteada de esa propuesta", async () => {
    expect(await isInProposalAudience(10, 999, fakeDb(false))).toBe(false);
  });
});

// F64 (Community FLASH 2.0) — GATE "FLASH aparece priorizada" del feed de myActive.
describe("sortActiveProposalsForFeed — FLASH siempre primero, luego por cierre más próximo", () => {
  it("una FLASH aparece antes que una scheduled, aunque la scheduled se creara/cierre antes", () => {
    const flash = proposal({ id: 1, urgencyType: "flash", endsAt: new Date("2026-08-12T20:00:00Z") });
    const scheduled = proposal({ id: 2, urgencyType: "scheduled", endsAt: new Date("2026-08-12T13:00:00Z") });
    const sorted = sortActiveProposalsForFeed([scheduled, flash]);
    expect(sorted.map(p => p.id)).toEqual([1, 2]);
  });

  it("dentro del mismo grupo (dos FLASH), la que antes cierra va primero", () => {
    const soon = proposal({ id: 1, urgencyType: "flash", endsAt: new Date("2026-08-12T13:00:00Z") });
    const later = proposal({ id: 2, urgencyType: "flash", endsAt: new Date("2026-08-12T20:00:00Z") });
    const sorted = sortActiveProposalsForFeed([later, soon]);
    expect(sorted.map(p => p.id)).toEqual([1, 2]);
  });

  it("una propuesta sin endsAt queda al final de su propio grupo (nunca 'vence' antes que una con fecha real)", () => {
    const noDeadline = proposal({ id: 1, urgencyType: "flash", endsAt: null });
    const withDeadline = proposal({ id: 2, urgencyType: "flash", endsAt: new Date("2026-08-12T20:00:00Z") });
    const sorted = sortActiveProposalsForFeed([noDeadline, withDeadline]);
    expect(sorted.map(p => p.id)).toEqual([2, 1]);
  });

  it("no muta el array original", () => {
    const list = [proposal({ id: 1, urgencyType: "scheduled" }), proposal({ id: 2, urgencyType: "flash" })];
    const sorted = sortActiveProposalsForFeed(list);
    expect(sorted).not.toBe(list);
    expect(list.map(p => p.id)).toEqual([1, 2]); // orden original intacto
  });
});

describe("computeResultsVisible — MISMA política para getPublicById y getPublicRespondents, nunca una copia que pueda divergir", () => {
  it("immediate: siempre visible, haya respondido o no", () => {
    expect(computeResultsVisible(proposal({ resultsVisibility: "immediate" }), false, NOW)).toBe(true);
    expect(computeResultsVisible(proposal({ resultsVisibility: "immediate" }), true, NOW)).toBe(true);
  });

  it("after_vote: solo visible si el propio usuario ya respondió", () => {
    expect(computeResultsVisible(proposal({ resultsVisibility: "after_vote" }), false, NOW)).toBe(false);
    expect(computeResultsVisible(proposal({ resultsVisibility: "after_vote" }), true, NOW)).toBe(true);
  });

  it("after_close: solo visible si la propuesta está cerrada o su ventana ya venció", () => {
    expect(computeResultsVisible(proposal({ resultsVisibility: "after_close", status: "active", endsAt: null }), true, NOW)).toBe(false);
    expect(computeResultsVisible(proposal({ resultsVisibility: "after_close", status: "closed" }), false, NOW)).toBe(true);
    const past = new Date(NOW.getTime() - 1000);
    expect(computeResultsVisible(proposal({ resultsVisibility: "after_close", status: "active", endsAt: past }), false, NOW)).toBe(true);
  });

  it("never: nunca visible bajo ningún criterio", () => {
    expect(computeResultsVisible(proposal({ resultsVisibility: "never", status: "closed" }), true, NOW)).toBe(false);
  });
});

describe("isProposalVisibleToUser — scoping REAL por comunidad (spec COM-02B §25: IE-only/UVA-only/IE+UVA/global)", () => {
  const IE = 1, UVA = 2;
  function fakeDb(opts: { proposalCommunityLinks: Array<{ communityId: number }>; userMemberships: Array<{ communityId: number }> }) {
    return {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () => (table === communityProposalCommunities ? opts.proposalCommunityLinks : []),
            then: (resolve: (v: unknown) => void) => {
              const rows = table === communityProposalCommunities ? opts.proposalCommunityLinks : opts.userMemberships;
              return Promise.resolve(rows).then(resolve);
            },
          }),
        }),
      }),
    } as never;
  }

  it("propuesta global (sin fila de scoping) -> visible para cualquier Student", async () => {
    const db = fakeDb({ proposalCommunityLinks: [], userMemberships: [] });
    expect(await isProposalVisibleToUser(10, 42, db)).toBe(true);
  });

  it("propuesta exclusiva de IE + Student de IE -> visible", async () => {
    const db = fakeDb({ proposalCommunityLinks: [{ communityId: IE }], userMemberships: [{ communityId: IE }] });
    expect(await isProposalVisibleToUser(10, 42, db)).toBe(true);
  });

  it("propuesta exclusiva de IE + Student de UVA -> NO visible", async () => {
    const db = fakeDb({ proposalCommunityLinks: [{ communityId: IE }], userMemberships: [{ communityId: UVA }] });
    expect(await isProposalVisibleToUser(10, 42, db)).toBe(false);
  });

  it("propuesta exclusiva de UVA + Student de IE -> NO visible (misma comprobación, dirección inversa)", async () => {
    const db = fakeDb({ proposalCommunityLinks: [{ communityId: UVA }], userMemberships: [{ communityId: IE }] });
    expect(await isProposalVisibleToUser(10, 42, db)).toBe(false);
  });

  it("propuesta compartida IE+UVA + Student de cualquiera de las dos -> visible", async () => {
    const dbIE = fakeDb({ proposalCommunityLinks: [{ communityId: IE }, { communityId: UVA }], userMemberships: [{ communityId: IE }] });
    expect(await isProposalVisibleToUser(10, 42, dbIE)).toBe(true);
    const dbUVA = fakeDb({ proposalCommunityLinks: [{ communityId: IE }, { communityId: UVA }], userMemberships: [{ communityId: UVA }] });
    expect(await isProposalVisibleToUser(10, 42, dbUVA)).toBe(true);
  });
});

describe("canAccessSocialLayer — COM-02B §3: 'ya voté' != 'la votación terminó' (dos dimensiones independientes)", () => {
  it("cerrada -> siempre true, haya respondido o no", () => {
    expect(canAccessSocialLayer("closed", false)).toBe(true);
    expect(canAccessSocialLayer("closed", true)).toBe(true);
  });

  it("activa + no ha respondido -> false (sigue siendo VoteForm)", () => {
    expect(canAccessSocialLayer("active", false)).toBe(false);
  });

  it("activa + ya respondió -> true (entra en la ficha social sin esperar al cierre)", () => {
    expect(canAccessSocialLayer("active", true)).toBe(true);
  });

  it("draft/scheduled/cancelled -> siempre false (nunca ficha social fuera de active/closed)", () => {
    expect(canAccessSocialLayer("draft", true)).toBe(false);
    expect(canAccessSocialLayer("scheduled", true)).toBe(false);
    expect(canAccessSocialLayer("cancelled", true)).toBe(false);
  });
});
