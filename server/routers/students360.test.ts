/**
 * students360.test.ts — mismo criterio que students.test.ts: todas las
 * procedures de students360Router exigen sesión (permissionProcedure), el
 * middleware rechaza antes de llegar a BD — se puede probar sin tocarla.
 */
import { describe, it, expect } from "vitest";
import { students360Router } from "./students360";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerWithoutSession() {
  return students360Router.createCaller({ user: null } as any);
}

describe("students360 router — ningún endpoint es público", () => {
  it("getSummary rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getSummary({ studentProfileId: 1 })).rejects.toThrow(/please login/i);
  });

  it("getActivity rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getActivity({ studentProfileId: 1, limit: 10 })).rejects.toThrow(/please login/i);
  });

  it("getEvents rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getEvents({ studentProfileId: 1 })).rejects.toThrow(/please login/i);
  });

  it("getConsumption rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getConsumption({ studentProfileId: 1 })).rejects.toThrow(/please login/i);
  });

  it("getEngagement rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getEngagement({ studentProfileId: 1 })).rejects.toThrow(/please login/i);
  });

  it("getAdminActivity rechaza sin sesión", async () => {
    await expect(callerWithoutSession().getAdminActivity({ studentProfileId: 1 })).rejects.toThrow(/please login/i);
  });

  it("getHistorical rechaza sin sesión (SEGOLIFE HISTORICAL STUDENT CLAIM, spec §16-18/§45)", async () => {
    await expect(callerWithoutSession().getHistorical({ studentProfileId: 1 })).rejects.toThrow(/please login/i);
  });
});
