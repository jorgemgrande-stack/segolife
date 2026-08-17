/**
 * settlementExportRoutes.test.ts — PRE-16.16 (§9/§26/§62): confirma que
 * GET /api/settlements/:id/export-excel (motor de liquidaciones de
 * PROVEEDORES heredado — distinto del motor real de liquidaciones de venue
 * de Segolife) ya no se sirve a cualquier sesión válida cuando
 * suppliers_module_enabled está desactivado (el estado real en producción).
 * No se levanta un servidor Express real — requireModuleEnabled es
 * middleware puro (req/res/next), se prueba de forma aislada.
 */
import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

vi.mock("mysql2/promise", () => ({ default: { createPool: () => ({}) } }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => ({}) }));
vi.mock("./localAuth", () => ({ verifySessionToken: vi.fn(), COOKIE_NAME: "segolife_session" }));

const { mockGetFeatureFlag } = vi.hoisted(() => ({ mockGetFeatureFlag: vi.fn() }));
vi.mock("./config", () => ({ getFeatureFlag: mockGetFeatureFlag }));

import { requireModuleEnabled } from "./settlementExportRoutes";

function mockRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe("settlementExportRoutes — requireModuleEnabled", () => {
  it("suppliers_module_enabled desactivado (estado real de producción): 404, next() nunca se llama", async () => {
    mockGetFeatureFlag.mockResolvedValue(false);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await requireModuleEnabled({} as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("suppliers_module_enabled activado: deja pasar la petición", async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await requireModuleEnabled({} as Request, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
