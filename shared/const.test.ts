import { describe, it, expect } from "vitest";
import { isSafeInternalPath } from "./const";

/**
 * const.test.ts — isSafeInternalPath es el único validador de `returnTo`
 * (spec puntos 69-71), reusado por client/src/pages/Login.tsx y
 * client/src/pages/Register.tsx. Cubre exactamente los casos que el spec
 * enumera como obligatorios a rechazar.
 */
describe("isSafeInternalPath", () => {
  it.each([
    ["/ie/events/123", true],
    ["/uva", true],
    ["/", true],
    ["/admin/students?tab=active", true],
  ])("acepta rutas internas: %s", (input, expected) => {
    expect(isSafeInternalPath(input)).toBe(expected);
  });

  it.each([
    ["http://evil.com", false],
    ["https://evil.com", false],
    ["//evil.com", false],
    ["javascript:alert(1)", false],
    ["data:text/html,<script>alert(1)</script>", false],
    ["relative/path", false],
    ["", false],
    [null, false],
    [undefined, false],
  ])("rechaza rutas no internas: %s", (input, expected) => {
    expect(isSafeInternalPath(input as string | null | undefined)).toBe(expected);
  });

  it("rechaza \\\\evil.com (algunos navegadores lo tratan como protocol-relative)", () => {
    expect(isSafeInternalPath("/\\evil.com")).toBe(false);
  });
});
