/**
 * community.test.ts — mismo criterio que students360.test.ts: todas las
 * procedures exigen sesión (permissionProcedure/protectedProcedure), el
 * middleware rechaza antes de tocar BD — se puede probar sin conexión real.
 * Cubre spec punto 89 (RBAC) en su forma más barata y determinista: ningún
 * endpoint de COMUNITY es accesible sin sesión, ni de lectura ni de escritura.
 */
import { describe, it, expect } from "vitest";
import { communityRouter } from "./community";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return communityRouter.createCaller({ user: null } as any);
}

describe("community router — ningún endpoint admin es accesible sin sesión", () => {
  it("list rechaza sin sesión", async () => {
    await expect(callerWithoutSession().list({ communityId: "all", limit: 50, offset: 0 })).rejects.toThrow(/please login/i);
  });

  it("getById rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getById({ id: 1 })).rejects.toThrow(/please login/i);
  });

  it("getResults rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getResults({ id: 1 })).rejects.toThrow(/please login/i);
  });

  it("getRespondents rechaza sin sesión — drilldown de identidad nunca sin auth (spec punto 42/58)", async () => {
    await expect(callerWithoutSession().getRespondents({ id: 1 })).rejects.toThrow(/please login/i);
  });

  it("create rechaza sin sesión", async () => {
    await expect(callerWithoutSession().create({
      title: "t", questionType: "yes_no", urgencyType: "scheduled",
      resultsVisibility: "after_vote", allowChangeResponse: true, minSampleSize: 5, communityIds: [],
    })).rejects.toThrow(/please login/i);
  });

  it("publish rechaza sin sesión", async () => {
    await expect(callerWithoutSession().publish({ id: 1 })).rejects.toThrow(/please login/i);
  });

  it("convertToEvent rechaza sin sesión", async () => {
    await expect(callerWithoutSession().convertToEvent({ id: 1 })).rejects.toThrow(/please login/i);
  });

  it("duplicate rechaza sin sesión", async () => {
    await expect(callerWithoutSession().duplicate({ id: 1 })).rejects.toThrow(/please login/i);
  });

  it("setResponseValueVisibility (moderación de texto libre) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().setResponseValueVisibility({ responseValueId: 1, isHidden: true })).rejects.toThrow(/please login/i);
  });

  it("listStudentProposals / approveStudentProposal / rejectStudentProposal rechazan sin sesión", async () => {
    await expect(callerWithoutSession().listStudentProposals({ communityId: "all", limit: 50, offset: 0 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().approveStudentProposal({ id: 1 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().rejectStudentProposal({ id: 1, reasonInternal: "motivo" })).rejects.toThrow(/please login/i);
  });
});

describe("community router — autoservicio del estudiante tampoco es público (protectedProcedure)", () => {
  it("myActive/myResponded/myProposals rechazan sin sesión", async () => {
    await expect(callerWithoutSession().myActive()).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().myResponded()).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().myProposals()).rejects.toThrow(/please login/i);
  });

  it("getPublicById rechaza sin sesión — nunca expone una pregunta ni sus resultados a un anónimo", async () => {
    await expect(callerWithoutSession().getPublicById({ id: 1 })).rejects.toThrow(/please login/i);
  });

  it("respond rechaza sin sesión", async () => {
    await expect(callerWithoutSession().respond({ proposalId: 1, payload: { questionType: "yes_no", value: "yes" } })).rejects.toThrow(/please login/i);
  });

  it("submitProposal (proponer un plan) rechaza sin sesión", async () => {
    await expect(callerWithoutSession().submitProposal({ communityId: 1, title: "idea" })).rejects.toThrow(/please login/i);
  });

  it("support/unsupport/hasSupported rechazan sin sesión", async () => {
    await expect(callerWithoutSession().support({ studentProposalId: 1 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().unsupport({ studentProposalId: 1 })).rejects.toThrow(/please login/i);
    await expect(callerWithoutSession().hasSupported({ studentProposalId: 1 })).rejects.toThrow(/please login/i);
  });
});
